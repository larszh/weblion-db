import { and, eq, sql } from 'drizzle-orm';
import type { Currency, CreditType } from '@weblion/shared';
import type { DbOrTx, Tx } from '../../db/client';
import {
  billingProfiles,
  creditTransactions,
  invoices,
  payments,
  type CreditTransaction,
  type Invoice,
  type Payment,
} from '../../db/schema';
import { badRequest, conflict, notFound } from '../../lib/errors';

/**
 * Money primitives shared by billing, payments and webhooks. Every function that moves
 * money expects to run inside a transaction and takes the per-organization lock first,
 * so concurrent requests (two tabs, a webhook retry) can never spend the same credit
 * twice or push an invoice past its total.
 */

/** Serializes money movements of one organization until the transaction ends. */
export async function lockOrgBilling(tx: Tx, orgId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing:${orgId}`}, 0))`);
}

/** Currency the organization is billed in (its billing profile, CHF by default). */
export async function billingCurrency(db: DbOrTx, orgId: string): Promise<Currency> {
  const profile = await db.query.billingProfiles.findFirst({ where: eq(billingProfiles.orgId, orgId) });
  return profile?.currency ?? 'CHF';
}

/** Current credit balance in minor units. Call lockOrgBilling first when you act on it. */
export async function creditBalance(db: DbOrTx, orgId: string): Promise<number> {
  const [row] = await db
    .select({ sum: sql<string | null>`sum(${creditTransactions.amount})` })
    .from(creditTransactions)
    .where(eq(creditTransactions.orgId, orgId));
  return Number(row?.sum ?? 0);
}

export interface CreditEntry {
  orgId: string;
  /** Positive adds credit, negative uses it. */
  amount: number;
  currency: Currency;
  type: CreditType;
  description: string;
  invoiceId?: string | null;
  paymentId?: string | null;
  createdBy?: string | null;
}

/**
 * Books one ledger entry. Rejects entries that would take the balance below zero, so
 * credit can only be spent once. Takes the organization lock itself.
 */
export async function addCredit(tx: Tx, entry: CreditEntry): Promise<CreditTransaction> {
  if (!Number.isInteger(entry.amount) || entry.amount === 0) {
    throw badRequest('Amount must be a non-zero integer in minor units');
  }
  await lockOrgBilling(tx, entry.orgId);
  const currency = await billingCurrency(tx, entry.orgId);
  if (entry.currency !== currency) {
    throw conflict(`Credit is kept in ${currency}, not ${entry.currency}`);
  }
  if (entry.amount < 0) {
    const balance = await creditBalance(tx, entry.orgId);
    if (balance + entry.amount < 0) throw conflict('Not enough credit');
  }
  const [row] = await tx
    .insert(creditTransactions)
    .values({
      orgId: entry.orgId,
      amount: entry.amount,
      currency: entry.currency,
      type: entry.type,
      description: entry.description,
      invoiceId: entry.invoiceId ?? null,
      paymentId: entry.paymentId ?? null,
      createdBy: entry.createdBy ?? null,
    })
    .returning();
  return row!;
}

/**
 * Applies up to `amount` to an open invoice and marks it paid once nothing is due.
 * Returns how much was applied. The rest (`excess`, e.g. the invoice was paid twice or
 * voided meanwhile) is the caller's to book as credit; it is never silently dropped.
 */
export async function applyToInvoice(
  tx: Tx,
  invoiceId: string,
  amount: number,
): Promise<{ invoice: Invoice; applied: number; excess: number }> {
  if (!Number.isInteger(amount) || amount <= 0) throw badRequest('Amount must be a positive integer');
  const [current] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for('update');
  if (!current) throw notFound('Invoice');
  if (current.status !== 'open') return { invoice: current, applied: 0, excess: amount };
  const due = current.total - current.amountPaid;
  const applied = Math.min(amount, due);
  const amountPaid = current.amountPaid + applied;
  const [invoice] = await tx
    .update(invoices)
    .set({
      amountPaid,
      ...(amountPaid >= current.total ? { status: 'paid' as const, paidAt: new Date() } : {}),
    })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.status, 'open')))
    .returning();
  return { invoice: invoice!, applied, excess: amount - applied };
}

/**
 * Pays an open invoice from the customer's credit, as much as the balance covers.
 * Creates a succeeded payment (provider "credit") and the matching ledger entry.
 */
export async function payFromCredit(
  tx: Tx,
  invoiceId: string,
  createdBy: string | null,
): Promise<{ invoice: Invoice; payment: Payment; amount: number }> {
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) throw notFound('Invoice');
  await lockOrgBilling(tx, inv.orgId);
  const [current] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for('update');
  if (!current || current.status !== 'open') throw conflict('Only open invoices can be paid');
  const currency = await billingCurrency(tx, current.orgId);
  if (currency !== current.currency) {
    throw conflict(`Credit is kept in ${currency}, the invoice is in ${current.currency}`);
  }
  const balance = await creditBalance(tx, current.orgId);
  const amount = Math.min(balance, current.total - current.amountPaid);
  if (amount <= 0) throw conflict('No credit available');

  const [payment] = await tx
    .insert(payments)
    .values({
      orgId: current.orgId,
      invoiceId: current.id,
      provider: 'credit',
      method: 'credit',
      amount,
      currency: current.currency,
      status: 'succeeded',
      createdBy,
      completedAt: new Date(),
    })
    .returning();
  await addCredit(tx, {
    orgId: current.orgId,
    amount: -amount,
    currency: current.currency,
    type: 'invoice_payment',
    description: current.number ? `Rechnung ${current.number}` : 'Rechnung',
    invoiceId: current.id,
    paymentId: payment!.id,
    createdBy,
  });
  const { invoice } = await applyToInvoice(tx, current.id, amount);
  return { invoice, payment: payment!, amount };
}

/**
 * Marks a pending payment as succeeded exactly once and settles it: applied to its
 * invoice, anything left over (or a top-up without invoice) is booked as credit.
 * Returns null when the payment was not pending anymore (webhook retry, double click).
 */
export async function settlePayment(
  tx: Tx,
  paymentId: string,
  update: { reference?: string | null } = {},
): Promise<{ payment: Payment; invoice: Invoice | null; credited: number } | null> {
  const [pending] = await tx.select().from(payments).where(eq(payments.id, paymentId));
  if (!pending) throw notFound('Payment');
  await lockOrgBilling(tx, pending.orgId);
  const [payment] = await tx
    .update(payments)
    .set({
      status: 'succeeded',
      completedAt: new Date(),
      error: null,
      ...(update.reference !== undefined ? { reference: update.reference } : {}),
    })
    .where(and(eq(payments.id, paymentId), eq(payments.status, 'pending')))
    .returning();
  if (!payment) return null;

  let invoice: Invoice | null = null;
  let credited = payment.amount;
  if (payment.invoiceId) {
    const result = await applyToInvoice(tx, payment.invoiceId, payment.amount);
    invoice = result.invoice;
    credited = result.excess;
  }
  if (credited > 0) {
    await addCredit(tx, {
      orgId: payment.orgId,
      amount: credited,
      currency: payment.currency,
      type: 'topup',
      description: payment.invoiceId
        ? 'Überzahlung einer Rechnung als Guthaben'
        : `Guthaben aufgeladen (${payment.method})`,
      invoiceId: payment.invoiceId,
      paymentId: payment.id,
      createdBy: payment.createdBy,
    });
  }
  return { payment, invoice, credited };
}
