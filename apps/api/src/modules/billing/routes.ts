import { and, count, desc, eq, ilike, isNotNull, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  BILLING_INTERVALS,
  CURRENCIES,
  MODULES,
  SERVICE_RESOURCE_TYPES,
  formatMoney,
  normalizeModules,
  type BillingStatsDto,
  type InvoiceDetailDto,
  type InvoiceIssuerSettings,
  type ModuleKey,
  type Paginated,
  type InvoiceDto,
  type SellerCustomerBillingDto,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import type { Tx } from '../../db/client';
import { orgScope, platformScope, requireAuth } from '../../auth/access';
import {
  billingProfiles,
  creditTransactions,
  invoices,
  organizations,
  payments,
  products,
  services,
  type Invoice,
  type Organization,
  type Service,
} from '../../db/schema';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { paginationQuery, parse } from '../../lib/validation';
import { loadOrg } from '../orgs/routes';
import { addCredit, billingCurrency, creditBalance, lockOrgBilling } from './ledger';
import { canActAsSeller, loadCustomerAsSeller, sellerOrgId } from './seller';
import {
  billingLink,
  billingSummary,
  creditPage,
  listPayments,
  listServices,
  loadProfile,
  monthlyValue,
  resourceOfOrg,
  toBillingProfileDto,
  toCreditTransactionDto,
  toInvoiceDetailDto,
  toInvoiceDto,
  toProductDto,
  toServiceDto,
} from './dto';
import {
  afterFinalize,
  buildLines,
  createDraft,
  deleteDraftInTx,
  finalizeInTx,
  inBackground,
  invoiceFilename,
  invoicePdf,
  linesSchema,
  loadInvoiceFor,
  loadInvoiceForSeller,
  lockInvoice,
  markPaidInTx,
  replaceLines,
  sendInvoiceMail,
  sendPaymentReceivedMail,
  voidInTx,
  billingRecipients,
} from './invoices';
import { generateInTx } from './recurring';
import {
  billingSettingsSchema,
  countrySchema,
  getBillingSettings,
  issuerNames,
  issuerSchema,
  issuerSettings,
  optionalEmail,
  optionalText,
  patchText,
  resellerIssuer,
  saveBillingSettings,
  taxRateSchema,
} from './settings';
import { dateSchema, todayZurich } from './dates';

const orgParams = z.object({ orgId: z.uuid() });
const idParams = z.object({ id: z.uuid() });

const invoiceListQuery = paginationQuery.extend({
  status: z.enum(['draft', 'open', 'paid', 'void', 'overdue']).optional(),
});
const customerInvoiceQuery = paginationQuery.extend({
  status: z.enum(['open', 'paid', 'void', 'overdue']).optional(),
});

const addressShape = {
  companyName: optionalText(100),
  contactName: optionalText(100),
  line1: optionalText(100),
  line2: optionalText(100),
  postalCode: optionalText(16),
  city: optionalText(60),
  country: countrySchema.default('CH'),
  email: optionalEmail,
  vatId: optionalText(40),
};
/** Customers maintain their address; currency, terms and tax are the seller's. */
const customerProfileBody = z.object(addressShape);
const sellerProfileBody = z.object({
  ...addressShape,
  currency: z.enum(CURRENCIES).optional(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  taxRateBp: taxRateSchema.nullish(),
});

const invoiceBody = z.object({
  lines: linesSchema,
  notes: optionalText(2000),
  issueDate: dateSchema.nullish(),
  dueDate: dateSchema.nullish(),
});
const invoicePatch = z.object({
  lines: linesSchema.optional(),
  notes: patchText(2000),
  issueDate: dateSchema.nullish(),
  dueDate: dateSchema.nullish(),
});

const amountSchema = z.number().int().min(-100_000_000).max(100_000_000);

const serviceBody = z.object({
  productId: z.uuid().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  /** Missing: taken from the product. */
  description: patchText(1000),
  module: z.enum(MODULES).nullish(),
  resourceType: z.enum(SERVICE_RESOURCE_TYPES).nullish(),
  resourceId: z.uuid().nullish(),
  unitPrice: z.number().int().min(0).max(100_000_000).optional(),
  quantity: z.number().positive().max(1_000_000).optional(),
  interval: z.enum(BILLING_INTERVALS).optional(),
  taxRateBp: taxRateSchema.nullish(),
  startsAt: dateSchema.optional(),
  notes: patchText(2000),
  activateModule: z.boolean().default(true),
});
const servicePatch = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: patchText(1000),
  unitPrice: z.number().int().min(0).max(100_000_000).optional(),
  quantity: z.number().positive().max(1_000_000).optional(),
  taxRateBp: taxRateSchema.nullish(),
  nextBillingAt: dateSchema.nullish(),
  notes: patchText(2000),
  status: z.enum(['active', 'suspended']).optional(),
});

const productFields = {
  name: z.string().trim().min(1).max(200),
  description: optionalText(1000),
  module: z.enum(MODULES).nullish(),
  unitPrice: z.number().int().min(0).max(100_000_000),
  currency: z.enum(CURRENCIES),
  interval: z.enum(BILLING_INTERVALS),
  taxRateBp: taxRateSchema.nullish(),
  active: z.boolean(),
};
const productBody = z.object({
  ...productFields,
  ownerOrgId: z.uuid().nullable().default(null),
  currency: productFields.currency.optional(),
  active: productFields.active.default(true),
});
/** No defaults here: a PATCH only touches what it sends. */
const productPatch = z.object({ ...productFields, description: patchText(1000) }).partial();

/** Rounds a quantity to the three decimals the database keeps. */
const roundQuantity = (q: number) => Math.round(q * 1000) / 1000;

export async function billingRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, access, audit } = ctx;

  // --- Helpers --------------------------------------------------------------------

  /** Customer view: the organization must be visible and the permission granted on it. */
  async function customerOrg(
    req: FastifyRequest,
    orgId: string,
    action: 'billing:read' | 'billing:write',
  ): Promise<Organization> {
    const org = await loadOrg(ctx, req, orgId);
    await access.assert(req, action, orgScope(orgId));
    return org;
  }

  async function invoicePage(
    req: FastifyRequest,
    filters: (SQL | undefined)[],
    query: { page: number; perPage: number; status?: string; q?: string },
    seller: boolean,
  ): Promise<Paginated<InvoiceDto>> {
    const today = todayZurich();
    const status =
      query.status === 'overdue'
        ? and(eq(invoices.status, 'open'), lt(invoices.dueDate, today))
        : query.status
          ? eq(invoices.status, query.status as Invoice['status'])
          : undefined;
    const q = query.q?.replace(/[%_]/g, '');
    const where = and(
      ...filters,
      status,
      q ? or(ilike(invoices.number, `%${q}%`), ilike(organizations.name, `%${q}%`)) : undefined,
    );
    const [rows, total] = await Promise.all([
      db
        .select({
          invoice: invoices,
          org: { id: organizations.id, name: organizations.name, slug: organizations.slug },
        })
        .from(invoices)
        .innerJoin(organizations, eq(organizations.id, invoices.orgId))
        .where(where)
        // Drafts (no issue date) first, then the newest invoices.
        .orderBy(sql`${invoices.issueDate} desc nulls first`, desc(invoices.createdAt), desc(invoices.number))
        .limit(query.perPage)
        .offset((query.page - 1) * query.perPage),
      db
        .select({ n: count() })
        .from(invoices)
        .innerJoin(organizations, eq(organizations.id, invoices.orgId))
        .where(where),
    ]);
    const names = issuerNames(db);
    return {
      items: await Promise.all(
        rows.map((r) => toInvoiceDto(ctx, req, r.invoice, { org: r.org, seller, names })),
      ),
      total: total[0]?.n ?? 0,
      page: query.page,
      perPage: query.perPage,
    };
  }

  async function invoiceDetail(req: FastifyRequest, id: string): Promise<InvoiceDetailDto> {
    const invoice = await db.query.invoices.findFirst({ where: eq(invoices.id, id) });
    if (!invoice) throw notFound('Invoice');
    return toInvoiceDetailDto(ctx, req, invoice);
  }

  /** Drafts are the issuer's business: their audit entries go to the issuer, not the customer. */
  const auditOrgOf = (invoice: Pick<Invoice, 'status' | 'orgId' | 'issuerOrgId'>) =>
    invoice.status === 'draft' ? invoice.issuerOrgId : invoice.orgId;

  async function loadServiceAsSeller(
    req: FastifyRequest,
    id: string,
  ): Promise<{ service: Service; org: Organization }> {
    requireAuth(req);
    const service = await db.query.services.findFirst({ where: eq(services.id, id) });
    if (!service) throw notFound('Service');
    const org = (await db.query.organizations.findFirst({ where: eq(organizations.id, service.orgId) }))!;
    if (!(await canActAsSeller(ctx, req, org, 'read'))) throw notFound('Service');
    if (!(await canActAsSeller(ctx, req, org, 'write')))
      throw forbidden('Missing permission to manage services');
    return { service, org };
  }

  /** Adds a module to an organization. A reseller can only pass on modules it has itself. */
  async function activateModule(tx: Tx, orgId: string, module: ModuleKey): Promise<boolean> {
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, orgId)).for('update');
    if (!org || org.modules.includes(module)) return false;
    if (org.parentOrgId) {
      const parent = await tx.query.organizations.findFirst({ where: eq(organizations.id, org.parentOrgId) });
      if (!parent?.modules.includes(module)) {
        throw conflict(`The reseller does not have the module "${module}"`);
      }
    }
    await tx
      .update(organizations)
      .set({ modules: normalizeModules([...org.modules, module]) })
      .where(eq(organizations.id, orgId));
    return true;
  }

  async function deactivateModule(tx: Tx, orgId: string, module: ModuleKey): Promise<boolean> {
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, orgId)).for('update');
    if (!org || !org.modules.includes(module)) return false;
    await tx
      .update(organizations)
      .set({ modules: org.modules.filter((m) => m !== module) })
      .where(eq(organizations.id, orgId));
    return true;
  }

  /** Catalog access: platform catalog via platform permissions, a reseller's via reseller:billing. */
  async function assertCatalog(req: FastifyRequest, ownerOrgId: string | null, mode: 'read' | 'write') {
    requireAuth(req);
    if (!ownerOrgId) {
      await access.assert(
        req,
        mode === 'read' ? 'platform:billing:read' : 'platform:billing:write',
        platformScope,
      );
      return;
    }
    const owner = await db.query.organizations.findFirst({ where: eq(organizations.id, ownerOrgId) });
    if (owner?.kind === 'reseller') {
      if (await access.can(req, 'reseller:billing', orgScope(owner.id))) return;
      if (mode === 'read' && (await access.can(req, 'platform:billing:read', platformScope))) return;
    }
    throw notFound('Organization');
  }

  // --- Customer view --------------------------------------------------------------

  app.get('/orgs/:orgId/billing/summary', async (req) => {
    const { orgId } = parse(orgParams, req.params);
    return billingSummary(ctx, req, await customerOrg(req, orgId, 'billing:read'));
  });

  app.get('/orgs/:orgId/invoices', async (req) => {
    const { orgId } = parse(orgParams, req.params);
    await customerOrg(req, orgId, 'billing:read');
    const query = parse(customerInvoiceQuery, req.query);
    return invoicePage(req, [eq(invoices.orgId, orgId), ne(invoices.status, 'draft')], query, false);
  });

  app.get('/orgs/:orgId/services', async (req) => {
    const { orgId } = parse(orgParams, req.params);
    await customerOrg(req, orgId, 'billing:read');
    return listServices(db, orgId);
  });

  app.get('/orgs/:orgId/credit', async (req) => {
    const { orgId } = parse(orgParams, req.params);
    await customerOrg(req, orgId, 'billing:read');
    return creditPage(ctx, orgId, parse(paginationQuery, req.query));
  });

  app.get('/orgs/:orgId/payments', async (req) => {
    const { orgId } = parse(orgParams, req.params);
    await customerOrg(req, orgId, 'billing:read');
    return listPayments(ctx, orgId);
  });

  app.get('/orgs/:orgId/billing/profile', async (req) => {
    const { orgId } = parse(orgParams, req.params);
    const org = await customerOrg(req, orgId, 'billing:read');
    const [profile, issuer] = await Promise.all([
      loadProfile(db, orgId),
      issuerSettings(db, sellerOrgId(org)),
    ]);
    return toBillingProfileDto(orgId, profile, issuer);
  });

  app.put('/orgs/:orgId/billing/profile', async (req) => {
    const { orgId } = parse(orgParams, req.params);
    const org = await customerOrg(req, orgId, 'billing:write');
    const body = parse(customerProfileBody, req.body);
    const issuer = await issuerSettings(db, sellerOrgId(org));
    await db
      .insert(billingProfiles)
      .values({ orgId, ...body, paymentTermsDays: issuer.defaultPaymentTermsDays })
      .onConflictDoUpdate({ target: billingProfiles.orgId, set: body });
    await audit.record(req, {
      action: 'billing.profile_update',
      orgId,
      resourceType: 'org',
      resourceId: orgId,
      details: body,
    });
    return toBillingProfileDto(orgId, await loadProfile(db, orgId), issuer);
  });

  // --- Single invoices (customer or issuer) ---------------------------------------

  app.get('/invoices/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const { invoice, org } = await loadInvoiceFor(ctx, req, id);
    return toInvoiceDetailDto(ctx, req, invoice, { org });
  });

  app.get('/invoices/:id/pdf', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    // Drafts only reach their issuer here, rendered with an "ENTWURF" watermark.
    const { invoice, org } = await loadInvoiceFor(ctx, req, id);
    const pdf = await invoicePdf(ctx, invoice, org);
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="${invoiceFilename(invoice)}"`)
      .header('cache-control', 'private, no-store')
      .send(pdf);
  });

  app.patch('/invoices/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const { invoice, org } = await loadInvoiceForSeller(ctx, req, id);
    const body = parse(invoicePatch, req.body);
    await db.transaction(async (tx) => {
      const current = await lockInvoice(tx, invoice.id);
      if (current.status !== 'draft') throw conflict('Only drafts can be changed');
      const issueDate = body.issueDate !== undefined ? body.issueDate : current.issueDate;
      const dueDate = body.dueDate !== undefined ? body.dueDate : current.dueDate;
      if (issueDate && dueDate && dueDate < issueDate)
        throw badRequest('The due date is before the issue date');
      if (body.lines) {
        const issuer = await issuerSettings(tx, current.issuerOrgId);
        await replaceLines(tx, current.id, await buildLines(tx, org.id, body.lines, issuer));
      }
      await tx
        .update(invoices)
        .set({ issueDate, dueDate, ...(body.notes !== undefined ? { notes: body.notes } : {}) })
        .where(eq(invoices.id, current.id));
    });
    await audit.record(req, {
      action: 'invoice.update',
      orgId: invoice.issuerOrgId,
      resourceType: 'invoice',
      resourceId: invoice.id,
      details: {
        customerOrgId: org.id,
        lines: body.lines?.length ?? null,
        issueDate: body.issueDate,
        dueDate: body.dueDate,
      },
    });
    return invoiceDetail(req, invoice.id);
  });

  app.delete('/invoices/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const { invoice, org } = await loadInvoiceForSeller(ctx, req, id);
    const reset = await db.transaction((tx) => deleteDraftInTx(tx, invoice.id));
    await audit.record(req, {
      action: 'invoice.delete',
      orgId: invoice.issuerOrgId,
      resourceType: 'invoice',
      resourceId: invoice.id,
      details: { customerOrgId: org.id, total: invoice.total, servicesDueAgain: reset },
    });
    return { ok: true };
  });

  app.post('/invoices/:id/finalize', async (req) => {
    const { id } = parse(idParams, req.params);
    const auth = requireAuth(req);
    const { invoice } = await loadInvoiceForSeller(ctx, req, id);
    const body = parse(z.object({ send: z.boolean().optional() }), req.body ?? {});
    const result = await db.transaction((tx) => finalizeInTx(tx, invoice.id, auth.user.id));
    const settings = await getBillingSettings(db);
    const mail = await afterFinalize(ctx, result, body.send ?? settings.sendInvoiceEmails);
    await audit.record(req, {
      action: 'invoice.finalize',
      orgId: invoice.orgId,
      resourceType: 'invoice',
      resourceId: invoice.id,
      details: {
        number: result.invoice.number,
        total: result.invoice.total,
        currency: result.invoice.currency,
        paidFromCredit: !!result.creditPaymentId,
        mail: mail?.status ?? null,
      },
    });
    return invoiceDetail(req, invoice.id);
  });

  app.post('/invoices/:id/void', async (req) => {
    const { id } = parse(idParams, req.params);
    const { invoice } = await loadInvoiceForSeller(ctx, req, id);
    const { reason } = parse(z.object({ reason: z.string().trim().min(1).max(500) }), req.body);
    const voided = await db.transaction((tx) => voidInTx(tx, invoice.id, reason));
    if (!voided.issuerOrgId) inBackground(ctx, 'zoho void', () => ctx.zoho.voidInvoice(voided.id));
    await audit.record(req, {
      action: 'invoice.void',
      orgId: invoice.orgId,
      resourceType: 'invoice',
      resourceId: invoice.id,
      details: { number: voided.number, reason },
    });
    return invoiceDetail(req, invoice.id);
  });

  app.post('/invoices/:id/send', async (req) => {
    const { id } = parse(idParams, req.params);
    const { invoice } = await loadInvoiceForSeller(ctx, req, id);
    if (invoice.status !== 'open' && invoice.status !== 'paid') {
      throw conflict('Only open or paid invoices can be sent');
    }
    const result = await sendInvoiceMail(ctx, invoice.id);
    await audit.record(req, {
      action: 'invoice.send',
      orgId: invoice.orgId,
      resourceType: 'invoice',
      resourceId: invoice.id,
      status: result.status === 'failed' ? 'failure' : 'success',
      details: { number: invoice.number, status: result.status },
    });
    return result.error ? { status: result.status, error: result.error } : { status: result.status };
  });

  app.post('/invoices/:id/mark-paid', async (req) => {
    const { id } = parse(idParams, req.params);
    const auth = requireAuth(req);
    const { invoice } = await loadInvoiceForSeller(ctx, req, id);
    const body = parse(
      z.object({
        amount: z.number().int().positive().max(100_000_000).optional(),
        method: z.enum(['bank_transfer', 'cash', 'other']),
        reference: optionalText(200),
        notify: z.boolean().default(false),
      }),
      req.body,
    );
    const { payment } = await db.transaction((tx) => markPaidInTx(tx, invoice.id, body, auth.user.id));
    if (body.notify) await sendPaymentReceivedMail(ctx, payment.id);
    if (!invoice.issuerOrgId) inBackground(ctx, 'zoho payment sync', () => ctx.zoho.syncPayment(payment.id));
    await audit.record(req, {
      action: 'invoice.mark_paid',
      orgId: invoice.orgId,
      resourceType: 'invoice',
      resourceId: invoice.id,
      details: { number: invoice.number, paymentId: payment.id, amount: payment.amount, method: body.method },
    });
    return invoiceDetail(req, invoice.id);
  });

  // --- Seller view of one customer ------------------------------------------------

  app.get('/billing/customers/:orgId', async (req): Promise<SellerCustomerBillingDto> => {
    const { orgId } = parse(orgParams, req.params);
    const org = await loadCustomerAsSeller(ctx, req, orgId, 'read');
    const [profile, issuer, summary] = await Promise.all([
      loadProfile(db, orgId),
      issuerSettings(db, sellerOrgId(org)),
      billingSummary(ctx, req, org),
    ]);
    return {
      org: { id: org.id, name: org.name, slug: org.slug, status: org.status, modules: org.modules },
      seller: summary.seller,
      profile: toBillingProfileDto(orgId, profile, issuer),
      summary,
    };
  });

  app.put('/billing/customers/:orgId/profile', async (req) => {
    const { orgId } = parse(orgParams, req.params);
    const org = await loadCustomerAsSeller(ctx, req, orgId, 'write');
    const body = parse(sellerProfileBody, req.body);
    const issuer = await issuerSettings(db, sellerOrgId(org));
    await db.transaction(async (tx) => {
      await lockOrgBilling(tx, orgId);
      const current = await loadProfile(tx, orgId);
      if (body.currency && body.currency !== (current?.currency ?? 'CHF')) {
        // Credit is kept in the billing currency. Switching with a balance would strand it.
        if ((await creditBalance(tx, orgId)) !== 0) {
          throw conflict('The currency can only be changed while the credit balance is zero');
        }
      }
      await tx
        .insert(billingProfiles)
        .values({ orgId, paymentTermsDays: issuer.defaultPaymentTermsDays, ...body })
        .onConflictDoUpdate({ target: billingProfiles.orgId, set: body });
    });
    await audit.record(req, {
      action: 'billing.profile_update',
      orgId,
      resourceType: 'org',
      resourceId: orgId,
      details: { ...body, asSeller: true },
    });
    return toBillingProfileDto(orgId, await loadProfile(db, orgId), issuer);
  });

  app.get('/billing/customers/:orgId/invoices', async (req) => {
    const { orgId } = parse(orgParams, req.params);
    const org = await loadCustomerAsSeller(ctx, req, orgId, 'read');
    const query = parse(invoiceListQuery, req.query);
    // A reseller only sees what it issued itself, not invoices from before the customer moved.
    const all = await access.can(req, 'platform:billing:read', platformScope);
    return invoicePage(
      req,
      [
        eq(invoices.orgId, orgId),
        all
          ? undefined
          : org.parentOrgId
            ? eq(invoices.issuerOrgId, org.parentOrgId)
            : isNull(invoices.issuerOrgId),
      ],
      query,
      true,
    );
  });

  app.post('/billing/customers/:orgId/invoices', async (req) => {
    const { orgId } = parse(orgParams, req.params);
    const auth = requireAuth(req);
    const org = await loadCustomerAsSeller(ctx, req, orgId, 'write');
    const body = parse(invoiceBody, req.body);
    if (body.issueDate && body.dueDate && body.dueDate < body.issueDate) {
      throw badRequest('The due date is before the issue date');
    }
    const draft = await db.transaction(async (tx) => {
      const issuer = await issuerSettings(tx, sellerOrgId(org));
      const lines = await buildLines(tx, org.id, body.lines, issuer);
      return createDraft(tx, org, { ...body, lines }, auth.user.id);
    });
    await audit.record(req, {
      action: 'invoice.create',
      orgId: auditOrgOf(draft),
      resourceType: 'invoice',
      resourceId: draft.id,
      details: { customerOrgId: org.id, lines: body.lines.length, total: draft.total },
    });
    return toInvoiceDetailDto(ctx, req, draft, { org });
  });

  app.post('/billing/customers/:orgId/invoices/generate', async (req) => {
    const { orgId } = parse(orgParams, req.params);
    const auth = requireAuth(req);
    const org = await loadCustomerAsSeller(ctx, req, orgId, 'write');
    const body = parse(
      z.object({ until: dateSchema.optional(), finalize: z.boolean().default(false) }),
      req.body ?? {},
    );
    const until = body.until ?? todayZurich();
    const result = await db.transaction((tx) =>
      generateInTx(tx, org, until, { finalize: body.finalize, userId: auth.user.id }),
    );
    if (result.finalized) {
      const settings = await getBillingSettings(db);
      await afterFinalize(ctx, result.finalized, settings.sendInvoiceEmails);
    }
    if (result.invoiceId) {
      await audit.record(req, {
        action: 'invoice.generate',
        orgId: result.finalized ? org.id : org.parentOrgId,
        resourceType: 'invoice',
        resourceId: result.invoiceId,
        details: { customerOrgId: org.id, until, lines: result.lines, finalized: !!result.finalized },
      });
    }
    return {
      invoice: result.invoiceId ? await invoiceDetail(req, result.invoiceId) : null,
      skipped: result.skipped,
    };
  });

  app.get('/billing/customers/:orgId/credit', async (req) => {
    const { orgId } = parse(orgParams, req.params);
    await loadCustomerAsSeller(ctx, req, orgId, 'read');
    return creditPage(ctx, orgId, parse(paginationQuery, req.query));
  });

  app.post('/billing/customers/:orgId/credit', async (req) => {
    const { orgId } = parse(orgParams, req.params);
    const auth = requireAuth(req);
    const org = await loadCustomerAsSeller(ctx, req, orgId, 'write');
    const body = parse(
      z.object({
        amount: amountSchema.refine((v) => v !== 0, 'must not be 0'),
        type: z.enum(['topup', 'adjustment', 'refund']),
        description: z.string().trim().min(1).max(300),
        notify: z.boolean().default(false),
      }),
      req.body,
    );
    if (body.type === 'topup' && body.amount < 0) {
      throw badRequest('A top-up must be positive, use an adjustment or refund to take credit away');
    }
    const { row, balance } = await db.transaction(async (tx) => {
      const booked = await addCredit(tx, {
        orgId,
        amount: body.amount,
        currency: await billingCurrency(tx, orgId),
        type: body.type,
        description: body.description,
        createdBy: auth.user.id,
      });
      return { row: booked, balance: await creditBalance(tx, orgId) };
    });
    if (body.notify) {
      const to = await billingRecipients(db, orgId);
      if (to.length > 0) {
        await ctx.mail.send(
          'credit_booked',
          {
            orgName: org.name,
            amount: formatMoney(row.amount, row.currency, 'de'),
            balance: formatMoney(balance, row.currency, 'de'),
            description: row.description,
            link: billingLink(ctx.env, org.slug),
          },
          { to, locale: 'de', orgId },
        );
      }
    }
    await audit.record(req, {
      action: 'credit.book',
      orgId,
      resourceType: 'credit',
      resourceId: row.id,
      details: { amount: row.amount, currency: row.currency, type: row.type, description: row.description },
    });
    return toCreditTransactionDto(row, {
      balanceAfter: balance,
      invoiceNumber: null,
      createdByName: auth.user.name,
    });
  });

  app.get('/billing/customers/:orgId/payments', async (req) => {
    const { orgId } = parse(orgParams, req.params);
    await loadCustomerAsSeller(ctx, req, orgId, 'read');
    return listPayments(ctx, orgId);
  });

  // --- Services -------------------------------------------------------------------

  app.get('/billing/customers/:orgId/services', async (req) => {
    const { orgId } = parse(orgParams, req.params);
    await loadCustomerAsSeller(ctx, req, orgId, 'read');
    return listServices(db, orgId);
  });

  app.post('/billing/customers/:orgId/services', async (req) => {
    const { orgId } = parse(orgParams, req.params);
    const auth = requireAuth(req);
    const org = await loadCustomerAsSeller(ctx, req, orgId, 'write');
    const body = parse(serviceBody, req.body);

    const product = body.productId
      ? await db.query.products.findFirst({ where: eq(products.id, body.productId) })
      : undefined;
    // Only products from the catalog of whoever bills this customer.
    if (body.productId && (!product || product.ownerOrgId !== sellerOrgId(org))) {
      throw badRequest('Unknown product');
    }
    if (product && !product.active) throw conflict('This product is no longer offered');
    const name = body.name ?? product?.name;
    const unitPrice = body.unitPrice ?? product?.unitPrice;
    const interval = body.interval ?? product?.interval;
    if (!name || unitPrice === undefined || !interval) {
      throw badRequest('Name, price and interval are required without a product');
    }
    if (!!body.resourceType !== !!body.resourceId) {
      throw badRequest('resourceType and resourceId go together');
    }
    if (body.resourceType && body.resourceId) {
      const resource = await resourceOfOrg(db, orgId, body.resourceType, body.resourceId);
      if (!resource) throw badRequest('The resource does not belong to this organization');
    }
    const module = body.module !== undefined ? body.module : (product?.module ?? null);
    const startsAt = body.startsAt ?? todayZurich();

    const { service, activated } = await db.transaction(async (tx) => {
      const activated = module && body.activateModule ? await activateModule(tx, orgId, module) : false;
      const [created] = await tx
        .insert(services)
        .values({
          orgId,
          productId: product?.id ?? null,
          name,
          description: body.description !== undefined ? body.description : (product?.description ?? null),
          module,
          resourceType: body.resourceType ?? null,
          resourceId: body.resourceId ?? null,
          unitPrice,
          quantity: roundQuantity(body.quantity ?? 1),
          currency: product?.currency ?? (await billingCurrency(tx, orgId)),
          interval,
          taxRateBp: body.taxRateBp !== undefined ? body.taxRateBp : (product?.taxRateBp ?? null),
          startsAt,
          nextBillingAt: startsAt,
          notes: body.notes ?? null,
          createdBy: auth.user.id,
        })
        .returning();
      return { service: created!, activated };
    });
    await audit.record(req, {
      action: 'service.create',
      orgId,
      resourceType: 'service',
      resourceId: service.id,
      details: {
        name: service.name,
        productId: service.productId,
        unitPrice: service.unitPrice,
        interval: service.interval,
        moduleActivated: activated ? module : null,
      },
    });
    return toServiceDto(db, service);
  });

  app.patch('/services/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const { service } = await loadServiceAsSeller(req, id);
    const body = parse(servicePatch, req.body);
    if (service.status === 'cancelled') throw conflict('Cancelled services cannot be changed');
    const [updated] = await db
      .update(services)
      .set({
        ...body,
        ...(body.quantity !== undefined ? { quantity: roundQuantity(body.quantity) } : {}),
      })
      .where(and(eq(services.id, service.id), ne(services.status, 'cancelled')))
      .returning();
    if (!updated) throw conflict('Cancelled services cannot be changed');
    await audit.record(req, {
      action: 'service.update',
      orgId: service.orgId,
      resourceType: 'service',
      resourceId: service.id,
      details: body,
    });
    return toServiceDto(db, updated);
  });

  app.post('/services/:id/cancel', async (req) => {
    const { id } = parse(idParams, req.params);
    const { service } = await loadServiceAsSeller(req, id);
    const body = parse(
      z.object({ endsAt: dateSchema.optional(), deactivateModule: z.boolean().default(false) }),
      req.body ?? {},
    );
    const { updated, deactivated } = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(services)
        .set({
          status: 'cancelled',
          cancelledAt: new Date(),
          nextBillingAt: null,
          endsAt: body.endsAt ?? todayZurich(),
        })
        .where(and(eq(services.id, service.id), ne(services.status, 'cancelled')))
        .returning();
      if (!row) throw conflict('The service is already cancelled');
      const deactivated =
        body.deactivateModule && row.module ? await deactivateModule(tx, row.orgId, row.module) : false;
      return { updated: row, deactivated };
    });
    await audit.record(req, {
      action: 'service.cancel',
      orgId: service.orgId,
      resourceType: 'service',
      resourceId: service.id,
      details: { endsAt: updated.endsAt, moduleDeactivated: deactivated ? updated.module : null },
    });
    return toServiceDto(db, updated);
  });

  // --- Products -------------------------------------------------------------------

  app.get('/billing/products', async (req) => {
    const query = parse(
      z.object({
        owner: z.union([z.literal('platform'), z.uuid()]).default('platform'),
        active: z.enum(['true', 'false']).optional(),
      }),
      req.query,
    );
    const ownerOrgId = query.owner === 'platform' ? null : query.owner;
    await assertCatalog(req, ownerOrgId, 'read');
    const rows = await db
      .select()
      .from(products)
      .where(
        and(
          ownerOrgId ? eq(products.ownerOrgId, ownerOrgId) : isNull(products.ownerOrgId),
          query.active ? eq(products.active, query.active === 'true') : undefined,
        ),
      )
      .orderBy(desc(products.active), products.name);
    return rows.map(toProductDto);
  });

  app.post('/billing/products', async (req) => {
    const body = parse(productBody, req.body);
    await assertCatalog(req, body.ownerOrgId, 'write');
    const currency = body.currency ?? (await issuerSettings(db, body.ownerOrgId)).defaultCurrency;
    const [product] = await db
      .insert(products)
      .values({ ...body, currency, module: body.module ?? null, taxRateBp: body.taxRateBp ?? null })
      .returning();
    await audit.record(req, {
      action: 'product.create',
      orgId: product!.ownerOrgId,
      resourceType: 'product',
      resourceId: product!.id,
      details: { name: product!.name, unitPrice: product!.unitPrice, interval: product!.interval },
    });
    return toProductDto(product!);
  });

  async function loadProduct(req: FastifyRequest) {
    const { id } = parse(idParams, req.params);
    requireAuth(req);
    const product = await db.query.products.findFirst({ where: eq(products.id, id) });
    if (!product) throw notFound('Product');
    await assertCatalog(req, product.ownerOrgId, 'write');
    return product;
  }

  app.patch('/billing/products/:id', async (req) => {
    const product = await loadProduct(req);
    const body = parse(productPatch, req.body);
    // Existing services keep their price; only new services use the changed one.
    const [updated] = await db.update(products).set(body).where(eq(products.id, product.id)).returning();
    await audit.record(req, {
      action: 'product.update',
      orgId: product.ownerOrgId,
      resourceType: 'product',
      resourceId: product.id,
      details: body,
    });
    return toProductDto(updated!);
  });

  app.delete('/billing/products/:id', async (req) => {
    const product = await loadProduct(req);
    const [used] = await db.select({ n: count() }).from(services).where(eq(services.productId, product.id));
    const deactivated = (used?.n ?? 0) > 0;
    if (deactivated) {
      await db.update(products).set({ active: false }).where(eq(products.id, product.id));
    } else {
      await db.delete(products).where(eq(products.id, product.id));
    }
    await audit.record(req, {
      action: deactivated ? 'product.deactivate' : 'product.delete',
      orgId: product.ownerOrgId,
      resourceType: 'product',
      resourceId: product.id,
      details: { name: product.name },
    });
    return { ok: true, deactivated };
  });

  // --- Admin ----------------------------------------------------------------------

  app.get('/admin/billing/invoices', async (req) => {
    await access.assert(req, 'platform:billing:read', platformScope);
    const query = parse(
      invoiceListQuery.extend({
        q: z.string().trim().max(100).optional(),
        issuer: z.enum(['platform', 'reseller', 'all']).default('all'),
      }),
      req.query,
    );
    const issuer =
      query.issuer === 'platform'
        ? isNull(invoices.issuerOrgId)
        : query.issuer === 'reseller'
          ? isNotNull(invoices.issuerOrgId)
          : undefined;
    return invoicePage(req, [issuer], query, true);
  });

  app.get('/admin/billing/stats', async (req): Promise<BillingStatsDto> => {
    await access.assert(req, 'platform:billing:read', platformScope);
    const { issuer } = await getBillingSettings(db);
    const currency = issuer.defaultCurrency;
    const today = todayZurich();
    const platformInvoices = and(isNull(invoices.issuerOrgId), eq(invoices.currency, currency));
    const due = sql<string | null>`sum(${invoices.total} - ${invoices.amountPaid})`;
    const platformBilled = isNull(organizations.parentOrgId);
    const [open, overdue, drafts, zohoErrors, paid, credit, recurring] = await Promise.all([
      db
        .select({ n: count(), due })
        .from(invoices)
        .where(and(platformInvoices, eq(invoices.status, 'open'))),
      db
        .select({ n: count(), due })
        .from(invoices)
        .where(and(platformInvoices, eq(invoices.status, 'open'), lt(invoices.dueDate, today))),
      db
        .select({ n: count() })
        .from(invoices)
        .where(and(isNull(invoices.issuerOrgId), eq(invoices.status, 'draft'))),
      db
        .select({ n: count() })
        .from(invoices)
        .where(and(isNull(invoices.issuerOrgId), eq(invoices.zohoStatus, 'error'))),
      // Money received this month (Swiss time): online and manual payments, not credit use.
      db
        .select({ sum: sql<string | null>`sum(${payments.amount})` })
        .from(payments)
        .innerJoin(organizations, eq(organizations.id, payments.orgId))
        .leftJoin(invoices, eq(invoices.id, payments.invoiceId))
        .where(
          and(
            eq(payments.status, 'succeeded'),
            ne(payments.provider, 'credit'),
            eq(payments.currency, currency),
            sql`(${payments.completedAt} at time zone 'Europe/Zurich') >= date_trunc('month', now() at time zone 'Europe/Zurich')`,
            or(
              and(isNull(payments.invoiceId), platformBilled),
              and(isNotNull(payments.invoiceId), isNull(invoices.issuerOrgId)),
            ),
          ),
        ),
      db
        .select({ sum: sql<string | null>`sum(${creditTransactions.amount})` })
        .from(creditTransactions)
        .innerJoin(organizations, eq(organizations.id, creditTransactions.orgId))
        .where(and(platformBilled, eq(creditTransactions.currency, currency))),
      db
        .select({ interval: services.interval, quantity: services.quantity, unitPrice: services.unitPrice })
        .from(services)
        .innerJoin(organizations, eq(organizations.id, services.orgId))
        .where(and(platformBilled, eq(services.status, 'active'), eq(services.currency, currency))),
    ]);
    return {
      currency,
      openTotal: Number(open[0]?.due ?? 0),
      overdueTotal: Number(overdue[0]?.due ?? 0),
      openCount: open[0]?.n ?? 0,
      overdueCount: overdue[0]?.n ?? 0,
      paidThisMonth: Number(paid[0]?.sum ?? 0),
      creditOutstanding: Number(credit[0]?.sum ?? 0),
      monthlyRecurring: recurring.reduce((sum, s) => sum + monthlyValue(s), 0),
      draftCount: drafts[0]?.n ?? 0,
      zohoErrors: zohoErrors[0]?.n ?? 0,
    };
  });

  // --- Settings -------------------------------------------------------------------

  app.get('/admin/settings/billing', async (req) => {
    requireAuth(req);
    if (
      !(await access.can(req, 'platform:settings', platformScope)) &&
      !(await access.can(req, 'platform:billing:read', platformScope))
    ) {
      throw forbidden('Missing permission platform:settings');
    }
    return getBillingSettings(db);
  });

  app.put('/admin/settings/billing', async (req) => {
    await access.assert(req, 'platform:settings', platformScope);
    const body = parse(billingSettingsSchema, req.body);
    const before = await getBillingSettings(db);
    await saveBillingSettings(db, body);
    await audit.record(req, {
      action: 'settings.billing_update',
      resourceType: 'settings',
      resourceId: 'billing',
      details: { changed: changedKeys(before, body) },
    });
    return getBillingSettings(db);
  });

  /** Reseller organizations: how their invoices to their customers look. */
  async function resellerOrg(req: FastifyRequest): Promise<Organization> {
    const { orgId } = parse(orgParams, req.params);
    const org = await loadOrg(ctx, req, orgId);
    if (org.kind !== 'reseller') throw notFound('Organization');
    await access.assert(req, 'reseller:billing', orgScope(orgId));
    return org;
  }

  app.get('/orgs/:orgId/reseller/issuer', async (req): Promise<InvoiceIssuerSettings> => {
    const org = await resellerOrg(req);
    return resellerIssuer(db, org.id);
  });

  app.put('/orgs/:orgId/reseller/issuer', async (req): Promise<InvoiceIssuerSettings> => {
    const org = await resellerOrg(req);
    const body = parse(issuerSchema, req.body);
    const before = await resellerIssuer(db, org.id);
    await db
      .insert(billingProfiles)
      .values({ orgId: org.id, issuer: body })
      .onConflictDoUpdate({ target: billingProfiles.orgId, set: { issuer: body } });
    await audit.record(req, {
      action: 'reseller.issuer_update',
      orgId: org.id,
      resourceType: 'org',
      resourceId: org.id,
      details: { changed: changedKeys(before, body) },
    });
    return resellerIssuer(db, org.id);
  });
}

/** Names of top level (and issuer.*) keys that differ, for audit details without values. */
function changedKeys(before: object, after: object, prefix = ''): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const key of keys) {
    const a = (before as Record<string, unknown>)[key];
    const b = (after as Record<string, unknown>)[key];
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      changed.push(...changedKeys(a, b, `${prefix}${key}.`));
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      changed.push(`${prefix}${key}`);
    }
  }
  return changed;
}
