import { and, eq, gte, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  MAX_AMOUNT,
  formatMoney,
  invoiceTotals,
  lineTotal,
  type InvoiceIssuerSettings,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import type { DbOrTx, Tx } from '../../db/client';
import { orgScope, requireAuth } from '../../auth/access';
import {
  invoiceLines,
  invoices,
  memberships,
  organizations,
  payments,
  products,
  services,
  users,
  type Invoice,
  type Organization,
  type Payment,
} from '../../db/schema';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import type { MailResult } from '../../mail/types';
import { billingCurrency, creditBalance, lockOrgBilling, payFromCredit, settlePayment } from './ledger';
import {
  billingAddressOf,
  billingLink,
  canActAsIssuer,
  invoiceLink,
  invoiceLinesOf,
  loadProfile,
} from './dto';
import { getBillingSettings, issuerSettings, taxRateSchema } from './settings';
import { addDays, dateSchema, formatDateCH, nextBillingDate, todayZurich } from './dates';
import { renderInvoicePdf } from './pdf';

/**
 * Invoice lifecycle: draft -> open -> paid, or open -> void. Only finalize assigns a
 * number, so deleting drafts never leaves gaps. Every state change locks the invoice row
 * (and the organization's billing lock where money moves) inside one transaction.
 */

// --- Access ---------------------------------------------------------------------------

export interface LoadedInvoice {
  invoice: Invoice;
  org: Organization;
  /** How the caller sees the invoice: as the one who issued it or as the customer. */
  viewer: 'seller' | 'customer';
  sellerWrite: boolean;
}

/**
 * Loads an invoice for the request. Issuers see everything incl. drafts, customers with
 * billing:read see their organization's invoices except drafts. 404 for everybody else.
 */
export async function loadInvoiceFor(
  ctx: AppContext,
  req: FastifyRequest,
  id: string,
): Promise<LoadedInvoice> {
  requireAuth(req);
  const invoice = await ctx.db.query.invoices.findFirst({ where: eq(invoices.id, id) });
  if (!invoice) throw notFound('Invoice');
  const org = (await ctx.db.query.organizations.findFirst({ where: eq(organizations.id, invoice.orgId) }))!;
  if (await canActAsIssuer(ctx, req, invoice, 'read')) {
    return { invoice, org, viewer: 'seller', sellerWrite: await canActAsIssuer(ctx, req, invoice, 'write') };
  }
  if (
    invoice.status !== 'draft' &&
    (await ctx.access.canSeeOrg(req, org.id)) &&
    (await ctx.access.can(req, 'billing:read', orgScope(org.id)))
  ) {
    return { invoice, org, viewer: 'customer', sellerWrite: false };
  }
  throw notFound('Invoice');
}

/** Like loadInvoiceFor, but the caller must be allowed to change the invoice as its issuer. */
export async function loadInvoiceForSeller(
  ctx: AppContext,
  req: FastifyRequest,
  id: string,
): Promise<LoadedInvoice> {
  const loaded = await loadInvoiceFor(ctx, req, id);
  if (!loaded.sellerWrite) throw forbidden('Only the issuer of an invoice can change it');
  return loaded;
}

// --- Lines ----------------------------------------------------------------------------

export const lineInputSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number().positive().max(1_000_000).default(1),
  unit: z
    .string()
    .trim()
    .max(20)
    .nullish()
    .transform((v) => v || null),
  /** Negative for discounts. */
  unitPrice: z.number().int().min(-100_000_000).max(100_000_000),
  taxRateBp: taxRateSchema.nullish(),
  serviceId: z.uuid().nullish(),
  periodStart: dateSchema.nullish(),
  periodEnd: dateSchema.nullish(),
});
export type LineInput = z.infer<typeof lineInputSchema>;

export const linesSchema = z.array(lineInputSchema).min(1).max(200);

type NewLine = Omit<typeof invoiceLines.$inferInsert, 'invoiceId' | 'position'>;

const MAX_AMOUNT_TEXT = (MAX_AMOUNT / 100).toFixed(2);

/**
 * Why these lines can't be stored, or null when they can: a line total or an invoice
 * total beyond what the money columns hold (MAX_AMOUNT). Checked up front, so it is a
 * 400 and not a database error.
 */
export function amountsProblem(
  lines: { quantity: number; unitPrice: number; taxRateBp: number }[],
): string | null {
  for (const [i, line] of lines.entries()) {
    if (Math.abs(lineTotal(line.quantity, line.unitPrice)) > MAX_AMOUNT) {
      return `The total of line ${i + 1} is above the maximum of ${MAX_AMOUNT_TEXT}`;
    }
  }
  const totals = invoiceTotals(lines);
  if ([totals.subtotal, totals.taxTotal, totals.total].some((v) => Math.abs(v) > MAX_AMOUNT)) {
    return `The invoice total is above the maximum of ${MAX_AMOUNT_TEXT}`;
  }
  return null;
}

/** Quantity times price of a service must fit in one invoice line. */
export function serviceAmountProblem(quantity: number, unitPrice: number): string | null {
  return Math.abs(lineTotal(quantity, unitPrice)) > MAX_AMOUNT
    ? `Quantity times price is above the maximum of ${MAX_AMOUNT_TEXT}`
    : null;
}

/**
 * Validates line inputs for an organization and fills in the tax rate: the line's own,
 * else the linked service's (or its product's), else the customer's, else the issuer's.
 */
export async function buildLines(
  tx: DbOrTx,
  orgId: string,
  inputs: LineInput[],
  issuer: Pick<InvoiceIssuerSettings, 'defaultTaxRateBp'>,
): Promise<NewLine[]> {
  const profile = await loadProfile(tx, orgId);
  const fallbackRate = profile?.taxRateBp ?? issuer.defaultTaxRateBp;
  const serviceIds = [...new Set(inputs.map((l) => l.serviceId).filter((id): id is string => !!id))];
  const linked = serviceIds.length
    ? await tx
        .select({ id: services.id, taxRateBp: services.taxRateBp, productRate: products.taxRateBp })
        .from(services)
        .leftJoin(products, eq(products.id, services.productId))
        .where(and(eq(services.orgId, orgId), inArray(services.id, serviceIds)))
    : [];
  if (linked.length !== serviceIds.length) throw badRequest('Unknown service');
  const rates = new Map(linked.map((s) => [s.id, s.taxRateBp ?? s.productRate ?? fallbackRate]));

  return inputs.map((input) => {
    const quantity = Math.round(input.quantity * 1000) / 1000;
    if (quantity <= 0) throw badRequest('Quantity must be positive');
    if (input.periodStart && input.periodEnd && input.periodEnd < input.periodStart) {
      throw badRequest('The period ends before it starts');
    }
    return {
      description: input.description,
      quantity,
      unit: input.unit ?? null,
      unitPrice: input.unitPrice,
      taxRateBp: input.taxRateBp ?? (input.serviceId ? rates.get(input.serviceId)! : fallbackRate),
      total: lineTotal(quantity, input.unitPrice),
      serviceId: input.serviceId ?? null,
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
    };
  });
}

/** Replaces all lines of a draft and stores the recomputed totals. */
export async function replaceLines(tx: Tx, invoiceId: string, lines: NewLine[]): Promise<void> {
  const problem = amountsProblem(lines);
  if (problem) throw badRequest(problem);
  await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
  if (lines.length > 0) {
    await tx.insert(invoiceLines).values(lines.map((l, i) => ({ ...l, invoiceId, position: i + 1 })));
  }
  const totals = invoiceTotals(lines);
  await tx
    .update(invoices)
    .set({ subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total })
    .where(eq(invoices.id, invoiceId));
}

/** Creates a draft for an organization, issued by its seller, in its billing currency. */
export async function createDraft(
  tx: Tx,
  org: Organization,
  input: { lines: NewLine[]; notes?: string | null; issueDate?: string | null; dueDate?: string | null },
  createdBy: string | null,
): Promise<Invoice> {
  const [draft] = await tx
    .insert(invoices)
    .values({
      orgId: org.id,
      issuerOrgId: org.parentOrgId ?? null,
      status: 'draft',
      currency: await billingCurrency(tx, org.id),
      notes: input.notes ?? null,
      issueDate: input.issueDate ?? null,
      dueDate: input.dueDate ?? null,
      createdBy,
    })
    .returning();
  await replaceLines(tx, draft!.id, input.lines);
  return (await tx.query.invoices.findFirst({ where: eq(invoices.id, draft!.id) }))!;
}

/** Locks an invoice row for the rest of the transaction. */
export async function lockInvoice(tx: Tx, invoiceId: string): Promise<Invoice> {
  const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for('update');
  if (!invoice) throw notFound('Invoice');
  return invoice;
}

/**
 * Deletes a draft. Periods it billed for services become due again, but only where this
 * draft was the last thing that moved the service's billing date and no other invoice
 * bills those periods, so deleting a generated draft never loses or doubles a period.
 * Returns the services that were reset.
 */
export async function deleteDraftInTx(tx: Tx, invoiceId: string): Promise<string[]> {
  const [pre] = await tx.select({ orgId: invoices.orgId }).from(invoices).where(eq(invoices.id, invoiceId));
  if (!pre) throw notFound('Invoice');
  await lockOrgBilling(tx, pre.orgId);
  const current = await lockInvoice(tx, invoiceId);
  if (current.status !== 'draft') throw conflict('Only drafts can be deleted');

  const billed = await tx
    .select({
      serviceId: invoiceLines.serviceId,
      first: sql<string>`min(${invoiceLines.periodStart})`,
      last: sql<string>`max(${invoiceLines.periodStart})`,
    })
    .from(invoiceLines)
    .where(
      and(
        eq(invoiceLines.invoiceId, invoiceId),
        isNotNull(invoiceLines.serviceId),
        isNotNull(invoiceLines.periodStart),
      ),
    )
    .groupBy(invoiceLines.serviceId);

  const reset: string[] = [];
  for (const { serviceId, first, last } of billed) {
    const [service] = await tx.select().from(services).where(eq(services.id, serviceId!)).for('update');
    if (!service || service.status === 'cancelled' || first < service.startsAt) continue;
    if (service.nextBillingAt !== nextBillingDate(last, service.interval, service.startsAt)) continue;
    const [elsewhere] = await tx
      .select({ id: invoiceLines.id })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
      .where(
        and(
          eq(invoiceLines.serviceId, service.id),
          ne(invoiceLines.invoiceId, invoiceId),
          ne(invoices.status, 'void'),
          gte(invoiceLines.periodStart, first),
        ),
      )
      .limit(1);
    if (elsewhere) continue;
    await tx.update(services).set({ nextBillingAt: first }).where(eq(services.id, service.id));
    reset.push(service.id);
  }
  await tx.delete(invoices).where(eq(invoices.id, invoiceId));
  return reset;
}

// --- Finalize -------------------------------------------------------------------------

/** Next gapless number of an issuer in a year. Rolls back with the surrounding transaction. */
async function nextInvoiceNumber(tx: Tx, issuerOrgId: string | null, year: string): Promise<number> {
  const key = `invoice:${issuerOrgId ?? 'platform'}:${year}`;
  const result = await tx.execute<{ value: number }>(
    sql`insert into number_sequences (key, value) values (${key}, 1)
        on conflict (key) do update set value = number_sequences.value + 1
        returning value`,
  );
  return Number(result.rows[0]!.value);
}

export function formatInvoiceNumber(prefix: string, year: string, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(5, '0')}`;
}

export interface FinalizeResult {
  invoice: Invoice;
  /** Set when the invoice was (partly) paid from credit right away. */
  creditPaymentId: string | null;
}

/**
 * Turns a draft into an open invoice: number, dates, snapshots of recipient and issuer.
 * A total of 0 is paid at once; otherwise credit is applied when the settings say so.
 */
export async function finalizeInTx(
  tx: Tx,
  invoiceId: string,
  userId: string | null,
): Promise<FinalizeResult> {
  const [pre] = await tx.select({ orgId: invoices.orgId }).from(invoices).where(eq(invoices.id, invoiceId));
  if (!pre) throw notFound('Invoice');
  await lockOrgBilling(tx, pre.orgId);
  const current = await lockInvoice(tx, invoiceId);
  if (current.status !== 'draft') throw conflict('Only drafts can be finalized');

  const lines = await invoiceLinesOf(tx, invoiceId);
  if (lines.length === 0) throw conflict('An invoice without lines cannot be finalized');
  const totals = invoiceTotals(lines);
  if (totals.total < 0) throw conflict('The total of an invoice cannot be negative');

  // One query at a time: a transaction runs on a single connection.
  const org = await tx.query.organizations.findFirst({ where: eq(organizations.id, current.orgId) });
  const profile = await loadProfile(tx, current.orgId);
  const issuer = await issuerSettings(tx, current.issuerOrgId);
  const settings = await getBillingSettings(tx);
  const issueDate = current.issueDate ?? todayZurich();
  const dueDate =
    current.dueDate ?? addDays(issueDate, profile?.paymentTermsDays ?? issuer.defaultPaymentTermsDays);
  if (dueDate < issueDate) throw badRequest('The due date is before the issue date');
  const year = issueDate.slice(0, 4);
  const number = formatInvoiceNumber(
    issuer.invoicePrefix,
    year,
    await nextInvoiceNumber(tx, current.issuerOrgId, year),
  );
  const paid = totals.total === 0;

  const [invoice] = await tx
    .update(invoices)
    .set({
      number,
      status: paid ? 'paid' : 'open',
      issueDate,
      dueDate,
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      total: totals.total,
      billingAddress: billingAddressOf(org!, profile),
      issuerSnapshot: issuer,
      paidAt: paid ? new Date() : null,
    })
    .where(eq(invoices.id, invoiceId))
    .returning();

  if (!paid && settings.autoApplyCredit) {
    const balance = await creditBalance(tx, invoice!.orgId);
    const currency = await billingCurrency(tx, invoice!.orgId);
    if (balance > 0 && currency === invoice!.currency) {
      const result = await payFromCredit(tx, invoiceId, userId);
      return { invoice: result.invoice, creditPaymentId: result.payment.id };
    }
  }
  return { invoice: invoice!, creditPaymentId: null };
}

/** Runs accounting sync without letting it fail or slow down the request. */
export function inBackground(ctx: AppContext, what: string, fn: () => Promise<void>): void {
  void fn().catch((err) => ctx.log.warn({ err }, `${what} failed`));
}

/** Email and accounting after a finalize was committed. */
export async function afterFinalize(
  ctx: AppContext,
  result: FinalizeResult,
  send: boolean,
): Promise<MailResult | null> {
  const { invoice, creditPaymentId } = result;
  const mail = send ? await sendInvoiceMail(ctx, invoice.id) : null;
  if (!invoice.issuerOrgId) {
    inBackground(ctx, 'zoho invoice sync', async () => {
      await ctx.zoho.syncInvoice(invoice.id);
      if (creditPaymentId) await ctx.zoho.syncPayment(creditPaymentId);
    });
  }
  return mail;
}

// --- Void and manual payments ---------------------------------------------------------

export async function voidInTx(tx: Tx, invoiceId: string, reason: string): Promise<Invoice> {
  const [pre] = await tx.select({ orgId: invoices.orgId }).from(invoices).where(eq(invoices.id, invoiceId));
  if (!pre) throw notFound('Invoice');
  await lockOrgBilling(tx, pre.orgId);
  const current = await lockInvoice(tx, invoiceId);
  if (current.status !== 'open') throw conflict('Only open invoices can be voided');
  if (current.amountPaid !== 0) throw conflict('Invoices with payments cannot be voided');
  const [invoice] = await tx
    .update(invoices)
    .set({ status: 'void', voidedAt: new Date(), voidReason: reason })
    .where(eq(invoices.id, invoiceId))
    .returning();
  return invoice!;
}

export interface ManualPayment {
  amount?: number;
  method: 'bank_transfer' | 'cash' | 'other';
  reference?: string | null;
}

/** Books a payment staff received outside the panel (bank transfer, cash). */
export async function markPaidInTx(
  tx: Tx,
  invoiceId: string,
  input: ManualPayment,
  userId: string | null,
): Promise<{ invoice: Invoice; payment: Payment }> {
  const [pre] = await tx.select({ orgId: invoices.orgId }).from(invoices).where(eq(invoices.id, invoiceId));
  if (!pre) throw notFound('Invoice');
  await lockOrgBilling(tx, pre.orgId);
  const current = await lockInvoice(tx, invoiceId);
  if (current.status !== 'open') throw conflict('Only open invoices can be marked as paid');
  const due = current.total - current.amountPaid;
  const amount = input.amount ?? due;
  if (amount <= 0) throw badRequest('Amount must be positive');
  if (amount > due) throw conflict('The amount is higher than the amount due');

  const [pending] = await tx
    .insert(payments)
    .values({
      orgId: current.orgId,
      invoiceId: current.id,
      provider: 'manual',
      method: input.method,
      amount,
      currency: current.currency,
      status: 'pending',
      reference: input.reference ?? null,
      createdBy: userId,
    })
    .returning();
  const settled = await settlePayment(tx, pending!.id, { reference: input.reference ?? null });
  return { invoice: settled!.invoice!, payment: settled!.payment };
}

// --- PDF and email --------------------------------------------------------------------

export async function invoicePdf(ctx: AppContext, invoice: Invoice, org?: Organization): Promise<Buffer> {
  const owner =
    org ?? (await ctx.db.query.organizations.findFirst({ where: eq(organizations.id, invoice.orgId) }))!;
  const [lines, issuer, profile] = await Promise.all([
    invoiceLinesOf(ctx.db, invoice.id),
    invoice.issuerSnapshot ?? issuerSettings(ctx.db, invoice.issuerOrgId),
    invoice.billingAddress ? null : loadProfile(ctx.db, invoice.orgId),
  ]);
  return renderInvoicePdf({
    invoice,
    lines,
    org: owner,
    issuer,
    address: invoice.billingAddress ?? billingAddressOf(owner, profile),
  });
}

export function invoiceFilename(invoice: Pick<Invoice, 'number' | 'id'>): string {
  return invoice.number ? `Rechnung-${invoice.number}.pdf` : `Rechnungsentwurf-${invoice.id.slice(0, 8)}.pdf`;
}

/** Billing emails go to the profile address, else to every owner of the organization. */
export async function billingRecipients(db: DbOrTx, orgId: string): Promise<string[]> {
  const profile = await loadProfile(db, orgId);
  if (profile?.email) return [profile.email];
  const owners = await db
    .select({ email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.role, 'owner'), eq(users.status, 'active')));
  return owners.map((o) => o.email);
}

/** Emails a finalized invoice with the PDF attached and remembers when it was sent. */
export async function sendInvoiceMail(ctx: AppContext, invoiceId: string): Promise<MailResult> {
  const invoice = await ctx.db.query.invoices.findFirst({ where: eq(invoices.id, invoiceId) });
  if (!invoice || !invoice.number || (invoice.status !== 'open' && invoice.status !== 'paid')) {
    return { status: 'skipped', error: 'Only open or paid invoices can be sent' };
  }
  const org = (await ctx.db.query.organizations.findFirst({ where: eq(organizations.id, invoice.orgId) }))!;
  const to = await billingRecipients(ctx.db, org.id);
  if (to.length === 0) return { status: 'skipped', error: 'No recipient (billing email or owner)' };
  const issuer = invoice.issuerSnapshot ?? (await issuerSettings(ctx.db, invoice.issuerOrgId));
  let pdf: Buffer;
  try {
    pdf = await invoicePdf(ctx, invoice, org);
  } catch (err) {
    ctx.log.error({ err, invoiceId }, 'invoice pdf failed');
    return { status: 'failed', error: 'The PDF could not be created' };
  }
  const result = await ctx.mail.send(
    'invoice',
    {
      orgName: org.name,
      issuerName: issuer.name,
      invoiceNumber: invoice.number,
      total: formatMoney(invoice.total, invoice.currency, 'de'),
      dueDate: formatDateCH(invoice.dueDate),
      link: invoiceLink(ctx.env, org.slug, invoice.id),
      paid: invoice.status === 'paid',
    },
    {
      to,
      locale: 'de',
      replyTo: issuer.email,
      attachments: [{ filename: invoiceFilename(invoice), content: pdf, contentType: 'application/pdf' }],
      orgId: org.id,
    },
  );
  if (result.status === 'sent') {
    await ctx.db.update(invoices).set({ sentAt: new Date() }).where(eq(invoices.id, invoice.id));
  }
  return result;
}

/** Confirmation to the customer that a payment was booked. Never throws. */
export async function sendPaymentReceivedMail(ctx: AppContext, paymentId: string): Promise<MailResult> {
  const [row] = await ctx.db
    .select({ payment: payments, org: organizations, number: invoices.number })
    .from(payments)
    .innerJoin(organizations, eq(organizations.id, payments.orgId))
    .leftJoin(invoices, eq(invoices.id, payments.invoiceId))
    .where(eq(payments.id, paymentId));
  if (!row) return { status: 'skipped', error: 'Payment not found' };
  const to = await billingRecipients(ctx.db, row.org.id);
  if (to.length === 0) return { status: 'skipped', error: 'No recipient (billing email or owner)' };
  return ctx.mail.send(
    'payment_received',
    {
      orgName: row.org.name,
      amount: formatMoney(row.payment.amount, row.payment.currency, 'de'),
      invoiceNumber: row.number,
      link: row.payment.invoiceId
        ? invoiceLink(ctx.env, row.org.slug, row.payment.invoiceId)
        : billingLink(ctx.env, row.org.slug),
    },
    { to, locale: 'de', orgId: row.org.id },
  );
}
