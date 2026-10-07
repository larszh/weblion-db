import { and, asc, count, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import {
  INTERVAL_MONTHS,
  invoiceTotals,
  lineTotal,
  type BillingProfileDto,
  type BillingSummaryDto,
  type CreditTransactionDto,
  type Currency,
  type InvoiceDetailDto,
  type InvoiceDto,
  type InvoiceIssuerSettings,
  type InvoiceLineDto,
  type OrgRef,
  type PaymentDto,
  type PaymentMethod,
  type PostalAddress,
  type ProductDto,
  type ServiceDto,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import type { Env } from '../../config/env';
import type { Database, DbOrTx } from '../../db/client';
import { orgScope } from '../../auth/access';
import {
  billingProfiles,
  creditTransactions,
  domains,
  invoiceLines,
  invoices,
  organizations,
  payments,
  products,
  projects,
  servers,
  services,
  users,
  webspaces,
  type BillingProfile,
  type CreditTransaction,
  type Invoice,
  type Organization,
  type Payment,
  type Product,
  type Service,
} from '../../db/schema';
import { iso } from '../../lib/dto';
import { onlinePayMethods } from '../payments/methods';
import { billingCurrency, creditBalance } from './ledger';
import { canActAsSeller, sellerOrgId } from './seller';
import { issuerNames, issuerSettings } from './settings';
import { todayZurich } from './dates';

/**
 * DTO builders for billing. Shared with the payments module, so they live here and not
 * in routes.ts. Builders that depend on the caller (zoho details, can flags, payment
 * methods) take the request and check permissions themselves unless told.
 */

export type BillingAddress = PostalAddress & { email: string | null; vatId: string | null };

export function appUrl(env: Env): string {
  return env.APP_URL.replace(/\/$/, '');
}

/** Console link to an invoice, used in emails and Stripe return URLs. */
export function invoiceLink(env: Env, orgSlug: string, invoiceId: string): string {
  return `${appUrl(env)}/o/${orgSlug}/billing/invoices/${invoiceId}`;
}

export function billingLink(env: Env, orgSlug: string): string {
  return `${appUrl(env)}/o/${orgSlug}/billing`;
}

/** Whether the request may see (read) or change (write) an invoice as the party that issued it. */
export function canActAsIssuer(
  ctx: AppContext,
  req: FastifyRequest,
  invoice: Pick<Invoice, 'issuerOrgId'>,
  mode: 'read' | 'write',
): Promise<boolean> {
  return canActAsSeller(ctx, req, { parentOrgId: invoice.issuerOrgId }, mode);
}

/** Recipient address: the billing profile, falling back to the organization name. */
export function billingAddressOf(
  org: Pick<Organization, 'name'>,
  profile: BillingProfile | null | undefined,
): BillingAddress {
  return {
    companyName: profile?.companyName || org.name,
    contactName: profile?.contactName ?? null,
    line1: profile?.line1 ?? null,
    line2: profile?.line2 ?? null,
    postalCode: profile?.postalCode ?? null,
    city: profile?.city ?? null,
    country: profile?.country ?? 'CH',
    email: profile?.email ?? null,
    vatId: profile?.vatId ?? null,
  };
}

export async function loadProfile(db: DbOrTx, orgId: string): Promise<BillingProfile | undefined> {
  return db.query.billingProfiles.findFirst({ where: eq(billingProfiles.orgId, orgId) });
}

export function toBillingProfileDto(
  orgId: string,
  profile: BillingProfile | null | undefined,
  issuer: Pick<InvoiceIssuerSettings, 'defaultPaymentTermsDays'>,
): BillingProfileDto {
  return {
    orgId,
    companyName: profile?.companyName ?? null,
    contactName: profile?.contactName ?? null,
    line1: profile?.line1 ?? null,
    line2: profile?.line2 ?? null,
    postalCode: profile?.postalCode ?? null,
    city: profile?.city ?? null,
    country: profile?.country ?? 'CH',
    email: profile?.email ?? null,
    vatId: profile?.vatId ?? null,
    // Without a profile the ledger bills in CHF (see billingCurrency).
    currency: profile?.currency ?? 'CHF',
    paymentTermsDays: profile?.paymentTermsDays ?? issuer.defaultPaymentTermsDays,
    taxRateBp: profile?.taxRateBp ?? null,
    updatedAt: iso(profile?.updatedAt),
  };
}

export function isOverdue(invoice: Pick<Invoice, 'status' | 'dueDate'>, today = todayZurich()): boolean {
  return invoice.status === 'open' && !!invoice.dueDate && invoice.dueDate < today;
}

export interface InvoiceDtoOptions {
  /** The invoiced organization, loaded when missing. */
  org?: OrgRef;
  /** Whether the caller sees the invoice as its issuer. Checked when missing. */
  seller?: boolean;
  names?: (issuerOrgId: string | null) => Promise<string>;
}

export async function toInvoiceDto(
  ctx: AppContext,
  req: FastifyRequest,
  invoice: Invoice,
  opts: InvoiceDtoOptions = {},
): Promise<InvoiceDto> {
  const org =
    opts.org ?? (await ctx.db.query.organizations.findFirst({ where: eq(organizations.id, invoice.orgId) }))!;
  const seller = opts.seller ?? (await canActAsIssuer(ctx, req, invoice, 'read'));
  const issuerName =
    invoice.issuerSnapshot?.name ?? (await (opts.names ?? issuerNames(ctx.db))(invoice.issuerOrgId));
  return {
    id: invoice.id,
    number: invoice.number,
    org: { id: org.id, name: org.name, slug: org.slug },
    issuer: { orgId: invoice.issuerOrgId, name: issuerName },
    status: invoice.status,
    currency: invoice.currency,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    subtotal: invoice.subtotal,
    taxTotal: invoice.taxTotal,
    total: invoice.total,
    amountPaid: invoice.amountPaid,
    amountDue: invoice.status === 'void' ? 0 : invoice.total - invoice.amountPaid,
    overdue: isOverdue(invoice),
    // Accounting sync only exists for platform invoices and is none of the customer's business.
    zoho:
      seller && !invoice.issuerOrgId
        ? { status: invoice.zohoStatus, invoiceId: invoice.zohoInvoiceId, error: invoice.zohoError }
        : null,
    sentAt: iso(invoice.sentAt),
    paidAt: iso(invoice.paidAt),
    createdAt: invoice.createdAt.toISOString(),
  };
}

export function toInvoiceLineDto(line: typeof invoiceLines.$inferSelect): InvoiceLineDto {
  return {
    id: line.id,
    position: line.position,
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: line.unitPrice,
    taxRateBp: line.taxRateBp,
    total: line.total,
    serviceId: line.serviceId,
    periodStart: line.periodStart,
    periodEnd: line.periodEnd,
  };
}

export async function invoiceLinesOf(db: DbOrTx, invoiceId: string) {
  return db
    .select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoiceId))
    .orderBy(asc(invoiceLines.position));
}

/**
 * Full invoice with lines, payments and what the caller may do with it. Seller rights are
 * checked against the invoice's issuer, customer rights against the invoiced organization.
 */
export async function toInvoiceDetailDto(
  ctx: AppContext,
  req: FastifyRequest,
  invoice: Invoice,
  opts: { org?: Organization } = {},
): Promise<InvoiceDetailDto> {
  const { db, access } = ctx;
  const org =
    opts.org ?? (await db.query.organizations.findFirst({ where: eq(organizations.id, invoice.orgId) }))!;
  const [sellerRead, sellerWrite, customerPay, lines, paymentRows] = await Promise.all([
    canActAsIssuer(ctx, req, invoice, 'read'),
    canActAsIssuer(ctx, req, invoice, 'write'),
    access.can(req, 'billing:pay', orgScope(invoice.orgId)),
    invoiceLinesOf(db, invoice.id),
    db.select().from(payments).where(eq(payments.invoiceId, invoice.id)).orderBy(asc(payments.createdAt)),
  ]);
  const base = await toInvoiceDto(ctx, req, invoice, { org, seller: sellerRead });
  const open = invoice.status === 'open';

  const payMethods: PaymentMethod[] = [];
  if (open && customerPay) {
    payMethods.push(...onlinePayMethods(ctx.env, { parentOrgId: invoice.issuerOrgId }, invoice.currency));
  }
  if (open && (customerPay || sellerWrite)) {
    const [balance, currency] = await Promise.all([
      creditBalance(db, invoice.orgId),
      billingCurrency(db, invoice.orgId),
    ]);
    if (balance > 0 && currency === invoice.currency) payMethods.push('credit');
  }

  const billingAddress =
    invoice.billingAddress ??
    (invoice.status === 'draft' ? billingAddressOf(org, await loadProfile(db, org.id)) : null);
  const draft = invoice.status === 'draft';
  return {
    ...base,
    lines: lines.map(toInvoiceLineDto),
    taxBreakdown: invoiceTotals(lines).breakdown,
    billingAddress,
    notes: invoice.notes,
    payments: paymentRows.map((p) => paymentDtoFrom(p, { id: invoice.id, number: invoice.number })),
    can: {
      edit: sellerWrite && draft,
      finalize: sellerWrite && draft,
      void: sellerWrite && open && invoice.amountPaid === 0,
      markPaid: sellerWrite && open,
      pay: payMethods.length > 0,
      send: sellerWrite && (open || invoice.status === 'paid'),
    },
    payMethods,
  };
}

// --- Payments -------------------------------------------------------------------------

export function paymentDtoFrom(
  payment: Payment,
  invoice: { id: string; number: string | null } | null,
): PaymentDto {
  return {
    id: payment.id,
    orgId: payment.orgId,
    invoice,
    provider: payment.provider,
    method: payment.method,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    reference: payment.reference,
    error: payment.error,
    createdAt: payment.createdAt.toISOString(),
    completedAt: iso(payment.completedAt),
  };
}

/** PaymentDto for one payment, looks up the invoice number when not given. */
export async function toPaymentDto(
  ctx: AppContext,
  payment: Payment,
  invoiceNumber?: string | null,
): Promise<PaymentDto> {
  if (!payment.invoiceId) return paymentDtoFrom(payment, null);
  let number = invoiceNumber;
  if (number === undefined) {
    const invoice = await ctx.db.query.invoices.findFirst({ where: eq(invoices.id, payment.invoiceId) });
    number = invoice?.number ?? null;
  }
  return paymentDtoFrom(payment, { id: payment.invoiceId, number });
}

/** Payments of one organization, newest first. */
export async function listPayments(ctx: AppContext, orgId: string, limit = 200): Promise<PaymentDto[]> {
  const rows = await ctx.db
    .select({ payment: payments, number: invoices.number })
    .from(payments)
    .leftJoin(invoices, eq(invoices.id, payments.invoiceId))
    .where(eq(payments.orgId, orgId))
    .orderBy(desc(payments.createdAt))
    .limit(limit);
  return rows.map(({ payment, number }) =>
    paymentDtoFrom(payment, payment.invoiceId ? { id: payment.invoiceId, number } : null),
  );
}

// --- Credit ---------------------------------------------------------------------------

export function toCreditTransactionDto(
  row: CreditTransaction,
  extra: { balanceAfter: number; invoiceNumber: string | null; createdByName: string | null },
): CreditTransactionDto {
  return {
    id: row.id,
    amount: row.amount,
    currency: row.currency,
    type: row.type,
    description: row.description,
    invoice: row.invoiceId ? { id: row.invoiceId, number: extra.invoiceNumber } : null,
    paymentId: row.paymentId,
    createdBy: row.createdBy && extra.createdByName ? { id: row.createdBy, name: extra.createdByName } : null,
    createdAt: row.createdAt.toISOString(),
    balanceAfter: extra.balanceAfter,
  };
}

export interface CreditPage {
  balance: number;
  currency: Currency;
  items: CreditTransactionDto[];
  total: number;
  page: number;
  perPage: number;
}

/** Credit ledger of one organization, newest first, with the running balance per entry. */
export async function creditPage(
  ctx: AppContext,
  orgId: string,
  query: { page: number; perPage: number },
): Promise<CreditPage> {
  const { db } = ctx;
  const ordered = db
    .select({
      id: creditTransactions.id,
      balanceAfter:
        sql<string>`sum(${creditTransactions.amount}) over (order by ${creditTransactions.createdAt}, ${creditTransactions.id} rows between unbounded preceding and current row)`.as(
          'balance_after',
        ),
    })
    .from(creditTransactions)
    .where(eq(creditTransactions.orgId, orgId))
    .as('running');
  const [rows, totalRows, balance, currency] = await Promise.all([
    db
      .select({
        tx: creditTransactions,
        balanceAfter: ordered.balanceAfter,
        invoiceNumber: invoices.number,
        createdByName: users.name,
      })
      .from(creditTransactions)
      .innerJoin(ordered, eq(ordered.id, creditTransactions.id))
      .leftJoin(invoices, eq(invoices.id, creditTransactions.invoiceId))
      .leftJoin(users, eq(users.id, creditTransactions.createdBy))
      .orderBy(desc(creditTransactions.createdAt), desc(creditTransactions.id))
      .limit(query.perPage)
      .offset((query.page - 1) * query.perPage),
    db.select({ n: count() }).from(creditTransactions).where(eq(creditTransactions.orgId, orgId)),
    creditBalance(db, orgId),
    billingCurrency(db, orgId),
  ]);
  return {
    balance,
    currency,
    items: rows.map((r) =>
      toCreditTransactionDto(r.tx, {
        balanceAfter: Number(r.balanceAfter),
        invoiceNumber: r.invoiceNumber,
        createdByName: r.createdByName,
      }),
    ),
    total: totalRows[0]?.n ?? 0,
    page: query.page,
    perPage: query.perPage,
  };
}

// --- Products and services ------------------------------------------------------------

export function toProductDto(product: Product): ProductDto {
  return {
    id: product.id,
    ownerOrgId: product.ownerOrgId,
    name: product.name,
    description: product.description,
    module: product.module,
    unitPrice: product.unitPrice,
    currency: product.currency,
    interval: product.interval,
    taxRateBp: product.taxRateBp,
    active: product.active,
    createdAt: product.createdAt.toISOString(),
  };
}

/** Service DTOs with product and resource names, looked up in batches. */
export async function serviceDtos(db: Database, rows: Service[]): Promise<ServiceDto[]> {
  const ids = (type: string) => [
    ...new Set(rows.filter((s) => s.resourceType === type && s.resourceId).map((s) => s.resourceId!)),
  ];
  const productIds = [...new Set(rows.map((s) => s.productId).filter((id): id is string => !!id))];
  const [productRows, serverRows, domainRows, webspaceRows] = await Promise.all([
    productIds.length
      ? db
          .select({ id: products.id, name: products.name })
          .from(products)
          .where(inArray(products.id, productIds))
      : [],
    ids('server').length
      ? db
          .select({ id: servers.id, name: servers.name })
          .from(servers)
          .where(inArray(servers.id, ids('server')))
      : [],
    ids('domain').length
      ? db
          .select({ id: domains.id, name: domains.name })
          .from(domains)
          .where(inArray(domains.id, ids('domain')))
      : [],
    ids('webspace').length
      ? db
          .select({ id: webspaces.id, name: webspaces.name })
          .from(webspaces)
          .where(inArray(webspaces.id, ids('webspace')))
      : [],
  ]);
  const names = new Map<string, string>(
    [...productRows, ...serverRows, ...domainRows, ...webspaceRows].map((r) => [r.id, r.name]),
  );
  return rows.map((s) => ({
    id: s.id,
    orgId: s.orgId,
    product: s.productId ? { id: s.productId, name: names.get(s.productId) ?? s.name } : null,
    name: s.name,
    description: s.description,
    module: s.module,
    resource:
      s.resourceType && s.resourceId
        ? { type: s.resourceType, id: s.resourceId, name: names.get(s.resourceId) ?? null }
        : null,
    unitPrice: s.unitPrice,
    quantity: s.quantity,
    currency: s.currency,
    interval: s.interval,
    taxRateBp: s.taxRateBp,
    status: s.status,
    startsAt: s.startsAt,
    nextBillingAt: s.nextBillingAt,
    endsAt: s.endsAt,
    cancelledAt: iso(s.cancelledAt),
    notes: s.notes,
    createdAt: s.createdAt.toISOString(),
  }));
}

export async function toServiceDto(db: Database, service: Service): Promise<ServiceDto> {
  return (await serviceDtos(db, [service]))[0]!;
}

export async function listServices(db: Database, orgId: string): Promise<ServiceDto[]> {
  const rows = await db
    .select()
    .from(services)
    .where(eq(services.orgId, orgId))
    .orderBy(
      sql`case ${services.status} when 'active' then 0 when 'suspended' then 1 else 2 end`,
      asc(services.name),
    );
  return serviceDtos(db, rows);
}

/** Net monthly value of recurring services (yearly ones count with a twelfth). */
export function monthlyValue(service: Pick<Service, 'interval' | 'quantity' | 'unitPrice'>): number {
  const months = INTERVAL_MONTHS[service.interval];
  return months ? Math.round(lineTotal(service.quantity, service.unitPrice) / months) : 0;
}

// --- Summary --------------------------------------------------------------------------

/** Totals of what an organization owes and has, for the customer and the seller view. */
export async function billingSummary(
  ctx: AppContext,
  req: FastifyRequest,
  org: Organization,
): Promise<BillingSummaryDto> {
  const { db } = ctx;
  const today = todayZurich();
  const seller = sellerOrgId(org);
  const [currency, balance, open, overdue, activeServices, issuer, mayPay] = await Promise.all([
    billingCurrency(db, org.id),
    creditBalance(db, org.id),
    db
      .select({
        n: count(),
        due: sql<string | null>`sum(${invoices.total} - ${invoices.amountPaid})`,
      })
      .from(invoices)
      .where(and(eq(invoices.orgId, org.id), eq(invoices.status, 'open'))),
    db
      .select({ due: sql<string | null>`sum(${invoices.total} - ${invoices.amountPaid})` })
      .from(invoices)
      .where(and(eq(invoices.orgId, org.id), eq(invoices.status, 'open'), lt(invoices.dueDate, today))),
    db
      .select()
      .from(services)
      .where(and(eq(services.orgId, org.id), eq(services.status, 'active'))),
    issuerSettings(db, seller),
    ctx.access.can(req, 'billing:pay', orgScope(org.id)),
  ]);
  return {
    currency,
    balance,
    openTotal: Number(open[0]?.due ?? 0),
    overdueTotal: Number(overdue[0]?.due ?? 0),
    openCount: open[0]?.n ?? 0,
    seller: { orgId: seller, name: issuer.name },
    payMethods: mayPay ? onlinePayMethods(ctx.env, org, currency) : [],
    activeServices: activeServices.length,
    monthlyRecurring: activeServices
      .filter((s) => s.currency === currency)
      .reduce((sum, s) => sum + monthlyValue(s), 0),
  };
}

/**
 * Billing records of an organization. Any of them blocks deleting it (the foreign keys
 * restrict), so the admin and reseller delete routes answer 409 while this is non-zero.
 */
export async function billingRecordCounts(
  db: Database,
  orgId: string,
): Promise<{ services: number; invoices: number; payments: number; credit: number }> {
  const [s, i, p, c] = await Promise.all([
    db.select({ n: count() }).from(services).where(eq(services.orgId, orgId)),
    db.select({ n: count() }).from(invoices).where(eq(invoices.orgId, orgId)),
    db.select({ n: count() }).from(payments).where(eq(payments.orgId, orgId)),
    db.select({ n: count() }).from(creditTransactions).where(eq(creditTransactions.orgId, orgId)),
  ]);
  return { services: s[0]?.n ?? 0, invoices: i[0]?.n ?? 0, payments: p[0]?.n ?? 0, credit: c[0]?.n ?? 0 };
}

/** Resolves the resource a service links to, scoped to the organization. Null when it isn't there. */
export async function resourceOfOrg(
  db: DbOrTx,
  orgId: string,
  type: 'server' | 'domain' | 'webspace',
  id: string,
): Promise<{ id: string; name: string } | null> {
  if (type === 'server') {
    const [row] = await db
      .select({ id: servers.id, name: servers.name })
      .from(servers)
      .innerJoin(projects, eq(projects.id, servers.projectId))
      .where(and(eq(servers.id, id), eq(projects.orgId, orgId)));
    return row ?? null;
  }
  const table = type === 'domain' ? domains : webspaces;
  const [row] = await db
    .select({ id: table.id, name: table.name })
    .from(table)
    .where(and(eq(table.id, id), eq(table.orgId, orgId)));
  return row ?? null;
}
