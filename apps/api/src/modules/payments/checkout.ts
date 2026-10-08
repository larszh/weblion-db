import { and, eq, isNull, or } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Currency } from '@weblion/shared';
import type { AppContext } from '../../context';
import { payments, type Invoice, type Organization, type Payment, type User } from '../../db/schema';
import {
  StripeClient,
  paymentIntentId,
  type CheckoutSession,
  type StripeParams,
} from '../../integrations/stripe';
import { settlePayment } from '../billing/ledger';
import { billingLink, invoiceLink, loadProfile } from '../billing/dto';
import { inBackground, sendPaymentReceivedMail } from '../billing/invoices';
import type { OnlineMethod } from './methods';

/**
 * Stripe Checkout for invoices and credit top-ups, and what happens when Stripe reports
 * back (webhook, or the console polling after the redirect). Money only moves through
 * ledger.settlePayment, which books a payment exactly once however often Stripe tells us.
 */

/** Checkout Sessions expire after an hour, the payment is then cancelled. */
const SESSION_TTL_SECONDS = 60 * 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CheckoutInput {
  org: Organization;
  /** null for a credit top-up. */
  invoice: Invoice | null;
  amount: number;
  currency: Currency;
  method: OnlineMethod;
  user: User;
}

/**
 * Creates the pending payment and its Checkout Session. When Stripe refuses, the payment
 * is kept as failed (nothing was charged) and the error goes to the caller.
 */
export async function startCheckout(
  ctx: AppContext,
  input: CheckoutInput,
): Promise<{ checkoutUrl: string; paymentId: string }> {
  const { org, invoice, amount, currency, method, user } = input;
  const [payment] = await ctx.db
    .insert(payments)
    .values({
      orgId: org.id,
      invoiceId: invoice?.id ?? null,
      provider: 'stripe',
      method,
      amount,
      currency,
      status: 'pending',
      createdBy: user.id,
    })
    .returning();
  const paymentId = payment!.id;
  const back = (result: 'success' | 'cancel') =>
    `${invoice ? invoiceLink(ctx.env, org.slug, invoice.id) : billingLink(ctx.env, org.slug)}?payment=${result}&pid=${paymentId}`;
  const metadata = { paymentId, orgId: org.id, ...(invoice ? { invoiceId: invoice.id } : {}) };
  const profile = await loadProfile(ctx.db, org.id);
  const params: StripeParams = {
    mode: 'payment',
    payment_method_types: [method],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: currency.toLowerCase(),
          unit_amount: amount,
          product_data: { name: invoice ? `Rechnung ${invoice.number}` : 'Guthaben weblion.one' },
        },
      },
    ],
    client_reference_id: paymentId,
    metadata,
    payment_intent_data: { metadata },
    success_url: back('success'),
    cancel_url: back('cancel'),
    customer_email: profile?.email ?? user.email,
    locale: user.locale === 'en' ? 'en' : 'de',
    expires_at: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };

  let session: CheckoutSession;
  try {
    session = await new StripeClient(ctx.env).createCheckoutSession(params, `checkout-${paymentId}`);
    if (!session.id || !session.url) throw new Error('Stripe returned no checkout URL');
  } catch (err) {
    ctx.log.warn({ err, paymentId }, 'stripe checkout failed');
    await ctx.db
      .update(payments)
      .set({ status: 'failed', error: 'The payment could not be started', completedAt: new Date() })
      .where(eq(payments.id, paymentId));
    throw err;
  }
  await ctx.db.update(payments).set({ externalId: session.id }).where(eq(payments.id, paymentId));
  return { checkoutUrl: session.url, paymentId };
}

/** What Stripe reported: the money arrived, it definitely failed, or the session expired. */
export type CheckoutOutcome = 'paid' | 'failed' | 'expired';

/** Outcome of a session read from the API (polling). Null while it is still open or processing. */
export function sessionOutcome(session: CheckoutSession): CheckoutOutcome | null {
  if (session.status === 'expired') return 'expired';
  if (session.status === 'complete' && session.payment_status !== 'unpaid') return 'paid';
  return null;
}

/** The payment a session belongs to: by session id, else by our id if the session id was never stored. */
export async function paymentForSession(
  ctx: AppContext,
  session: Pick<CheckoutSession, 'id' | 'client_reference_id'>,
): Promise<Payment | undefined> {
  const ref = session.client_reference_id;
  const byRef =
    ref && UUID_RE.test(ref)
      ? and(eq(payments.id, ref), eq(payments.provider, 'stripe'), isNull(payments.externalId))
      : undefined;
  const [payment] = await ctx.db
    .select()
    .from(payments)
    .where(byRef ? or(eq(payments.externalId, session.id), byRef) : eq(payments.externalId, session.id))
    .limit(1);
  return payment;
}

/**
 * Applies an outcome to the payment of a session. Idempotent: a payment that is no longer
 * pending is left alone, so webhook retries and polling never book twice. Returns what
 * changed, null when nothing did.
 */
export async function applyCheckoutOutcome(
  ctx: AppContext,
  req: FastifyRequest | null,
  session: CheckoutSession,
  outcome: CheckoutOutcome,
): Promise<'settled' | 'failed' | 'cancelled' | null> {
  const payment = await paymentForSession(ctx, session);
  if (!payment || payment.status !== 'pending') return null;
  const auditBase = {
    orgId: payment.orgId,
    resourceType: 'payment',
    resourceId: payment.id,
    actorName: 'Stripe',
  };

  if (outcome === 'paid') {
    const currency = session.currency?.toUpperCase();
    if (
      (typeof session.amount_total === 'number' && session.amount_total !== payment.amount) ||
      (currency && currency !== payment.currency)
    ) {
      // Never book an amount we did not ask for. Staff look into it.
      ctx.log.error(
        { paymentId: payment.id, sessionId: session.id, amount: session.amount_total, currency },
        'stripe reported a different amount',
      );
      await ctx.db
        .update(payments)
        .set({ error: 'Stripe reported a different amount' })
        .where(eq(payments.id, payment.id));
      await ctx.audit.record(req, {
        ...auditBase,
        action: 'payment.mismatch',
        status: 'failure',
        details: {
          expected: payment.amount,
          reported: session.amount_total,
          currency: payment.currency,
          reportedCurrency: currency ?? null,
        },
      });
      return null;
    }
    const settled = await ctx.db.transaction(async (tx) => {
      if (!payment.externalId) {
        await tx.update(payments).set({ externalId: session.id }).where(eq(payments.id, payment.id));
      }
      return settlePayment(tx, payment.id, { reference: paymentIntentId(session) });
    });
    if (!settled) return null;
    await ctx.audit.record(req, {
      ...auditBase,
      action: 'payment.succeeded',
      details: {
        invoiceId: payment.invoiceId,
        amount: payment.amount,
        currency: payment.currency,
        method: payment.method,
        credited: settled.credited,
      },
    });
    if (settled.unbooked > 0) {
      // Received but not booked: the customer's credit is kept in another currency now.
      ctx.log.error(
        { paymentId: payment.id, unbooked: settled.unbooked, currency: payment.currency },
        'payment could not be booked as credit',
      );
      await ctx.audit.record(req, {
        ...auditBase,
        action: 'payment.unbooked',
        status: 'failure',
        details: {
          invoiceId: payment.invoiceId,
          unbooked: settled.unbooked,
          currency: payment.currency,
          error: settled.payment.error,
        },
      });
    }
    inBackground(ctx, 'payment mail', async () => {
      await sendPaymentReceivedMail(ctx, payment.id);
    });
    // Zoho only takes payments of platform invoices; syncPayment checks that itself.
    if (settled.invoice && !settled.invoice.issuerOrgId) {
      inBackground(ctx, 'zoho payment sync', () => ctx.zoho.syncPayment(payment.id));
    }
    return 'settled';
  }

  const failed = outcome === 'failed';
  const [updated] = await ctx.db
    .update(payments)
    .set({
      status: failed ? 'failed' : 'cancelled',
      error: failed ? 'The payment failed' : null,
      completedAt: new Date(),
    })
    .where(and(eq(payments.id, payment.id), eq(payments.status, 'pending')))
    .returning();
  if (!updated) return null;
  await ctx.audit.record(req, {
    ...auditBase,
    action: failed ? 'payment.failed' : 'payment.cancelled',
    details: { invoiceId: payment.invoiceId, amount: payment.amount, currency: payment.currency },
  });
  return failed ? 'failed' : 'cancelled';
}

/** Last time a pending payment was checked with Stripe, so polling clients don't hammer the API. */
const lastChecked = new Map<string, number>();
const CHECK_INTERVAL_MS = 3_000;

/**
 * Asks Stripe about a pending payment directly. Covers late or missing webhooks (e.g. a
 * local setup without webhook forwarding). Never throws.
 */
export async function reconcilePayment(ctx: AppContext, payment: Payment): Promise<boolean> {
  if (
    payment.status !== 'pending' ||
    payment.provider !== 'stripe' ||
    !payment.externalId ||
    !ctx.env.STRIPE_SECRET_KEY
  ) {
    return false;
  }
  const now = Date.now();
  if (now - (lastChecked.get(payment.id) ?? 0) < CHECK_INTERVAL_MS) return false;
  if (lastChecked.size > 5_000) lastChecked.clear();
  lastChecked.set(payment.id, now);
  try {
    const session = await new StripeClient(ctx.env).retrieveCheckoutSession(payment.externalId);
    const outcome = sessionOutcome(session);
    if (!outcome) return false;
    return (await applyCheckoutOutcome(ctx, null, session, outcome)) !== null;
  } catch (err) {
    ctx.log.warn({ err, paymentId: payment.id }, 'stripe session check failed');
    return false;
  }
}
