import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { formatMoney } from '@weblion/shared';
import type { AppContext } from '../../context';
import { orgScope, requireAuth } from '../../auth/access';
import { invoices, organizations, payments } from '../../db/schema';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { parse } from '../../lib/validation';
import { verifyStripeSignature, type CheckoutSession } from '../../integrations/stripe';
import { loadOrg } from '../orgs/routes';
import { billingCurrency, payFromCredit } from '../billing/ledger';
import { canActAsSeller } from '../billing/seller';
import { toPaymentDto } from '../billing/dto';
import { inBackground, loadInvoiceFor } from '../billing/invoices';
import {
  applyCheckoutOutcome,
  reconcilePayment,
  startCheckout,
  type CheckoutInput,
  type CheckoutOutcome,
} from './checkout';
import { MIN_ONLINE_AMOUNT, ONLINE_METHODS, onlinePayProblem } from './methods';
import { zohoRoutes } from './zoho';

const idParams = z.object({ id: z.uuid() });
const orgParams = z.object({ orgId: z.uuid() });

const payBody = z.object({ method: z.enum(['credit', ...ONLINE_METHODS]) });
const topupBody = z.object({
  /** 5.00 to 10'000.00 */
  amount: z.number().int().min(500).max(1_000_000),
  method: z.enum(ONLINE_METHODS),
});

const webhookEvent = z.object({
  id: z.string(),
  type: z.string(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});

const sessionSchema = z.object({
  id: z.string().min(1),
  url: z.string().nullish(),
  status: z.enum(['open', 'complete', 'expired']).nullish(),
  payment_status: z.string(),
  payment_intent: z.union([z.string(), z.object({ id: z.string() })]).nullish(),
  client_reference_id: z.string().nullish(),
  metadata: z.record(z.string(), z.string()).nullish(),
  amount_total: z.number().nullish(),
  currency: z.string().nullish(),
});

function toSession(raw: z.infer<typeof sessionSchema>): CheckoutSession {
  return {
    id: raw.id,
    url: raw.url ?? null,
    status: raw.status ?? null,
    payment_status: raw.payment_status as CheckoutSession['payment_status'],
    payment_intent: raw.payment_intent ?? null,
    client_reference_id: raw.client_reference_id ?? null,
    metadata: raw.metadata ?? null,
    amount_total: raw.amount_total ?? null,
    currency: raw.currency ?? null,
  };
}

/** What a Checkout event means for its payment. Null for events we don't act on. */
function eventOutcome(type: string, object: Record<string, unknown>): CheckoutOutcome | null {
  switch (type) {
    case 'checkout.session.completed':
      // Delayed methods complete "unpaid" and report later through the async events.
      return object.payment_status === 'unpaid' ? null : 'paid';
    case 'checkout.session.async_payment_succeeded':
      return 'paid';
    case 'checkout.session.async_payment_failed':
      return 'failed';
    case 'checkout.session.expired':
      return 'expired';
    default:
      return null;
  }
}

/** Online payments (Stripe Checkout incl. TWINT), paying from credit and the Stripe webhook. */
export async function paymentRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, access, audit } = ctx;

  /** Starts a checkout and records the attempt, also when Stripe refuses it. */
  async function checkout(
    req: FastifyRequest,
    input: CheckoutInput,
  ): Promise<{ checkoutUrl: string; paymentId: string }> {
    const details = {
      invoiceId: input.invoice?.id ?? null,
      number: input.invoice?.number ?? null,
      method: input.method,
      amount: input.amount,
      currency: input.currency,
    };
    try {
      const result = await startCheckout(ctx, input);
      await audit.record(req, {
        action: input.invoice ? 'payment.checkout' : 'credit.topup_checkout',
        orgId: input.org.id,
        resourceType: 'payment',
        resourceId: result.paymentId,
        details,
      });
      return result;
    } catch (err) {
      await audit.record(req, {
        action: input.invoice ? 'payment.checkout' : 'credit.topup_checkout',
        orgId: input.org.id,
        resourceType: 'payment',
        status: 'failure',
        details,
      });
      throw err;
    }
  }

  // --- Paying invoices ------------------------------------------------------------

  app.post('/invoices/:id/pay', async (req) => {
    const { id } = parse(idParams, req.params);
    const auth = requireAuth(req);
    const { invoice, org, sellerWrite } = await loadInvoiceFor(ctx, req, id);
    const { method } = parse(payBody, req.body);
    const customerPay = await access.can(req, 'billing:pay', orgScope(invoice.orgId));
    if (invoice.status !== 'open') throw conflict('Only open invoices can be paid');

    if (method === 'credit') {
      // The seller may settle an invoice from the customer's credit as well.
      if (!customerPay && !sellerWrite) throw forbidden('Missing permission billing:pay');
      const result = await db.transaction((tx) => payFromCredit(tx, invoice.id, auth.user.id));
      if (!invoice.issuerOrgId) {
        inBackground(ctx, 'zoho payment sync', () => ctx.zoho.syncPayment(result.payment.id));
      }
      await audit.record(req, {
        action: 'invoice.pay_credit',
        orgId: invoice.orgId,
        resourceType: 'invoice',
        resourceId: invoice.id,
        details: { number: invoice.number, paymentId: result.payment.id, amount: result.amount },
      });
      return { status: result.invoice.status === 'paid' ? 'paid' : 'partial', amount: result.amount };
    }

    if (!customerPay) throw forbidden('Missing permission billing:pay');
    const problem = onlinePayProblem(
      ctx.env,
      { parentOrgId: invoice.issuerOrgId },
      invoice.currency,
      method,
      'invoice',
    );
    if (problem) throw conflict(problem);
    const amount = invoice.total - invoice.amountPaid;
    if (amount < MIN_ONLINE_AMOUNT) {
      throw conflict(
        `Amounts below ${formatMoney(MIN_ONLINE_AMOUNT, invoice.currency, 'en')} can't be paid online`,
      );
    }
    return checkout(req, { org, invoice, amount, currency: invoice.currency, method, user: auth.user });
  });

  // --- Credit top-ups -------------------------------------------------------------

  app.post('/orgs/:orgId/credit/topup', async (req) => {
    const { orgId } = parse(orgParams, req.params);
    const auth = requireAuth(req);
    const org = await loadOrg(ctx, req, orgId);
    await access.assert(req, 'billing:pay', orgScope(orgId));
    const body = parse(topupBody, req.body);
    const currency = await billingCurrency(db, orgId);
    const problem = onlinePayProblem(ctx.env, org, currency, body.method, 'topup');
    if (problem) throw conflict(problem);
    return checkout(req, {
      org,
      invoice: null,
      amount: body.amount,
      currency,
      method: body.method,
      user: auth.user,
    });
  });

  // --- Payment status (polled by the console after the Stripe redirect) ----------

  app.get('/payments/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    requireAuth(req);
    let payment = await db.query.payments.findFirst({ where: eq(payments.id, id) });
    if (!payment) throw notFound('Payment');
    const invoice = payment.invoiceId
      ? await db.query.invoices.findFirst({ where: eq(invoices.id, payment.invoiceId) })
      : undefined;
    const org = (await db.query.organizations.findFirst({ where: eq(organizations.id, payment.orgId) }))!;
    // The seller of an invoice payment is its issuer, of a top-up whoever bills the organization.
    const seller = invoice ? { parentOrgId: invoice.issuerOrgId } : org;
    const visible =
      (await canActAsSeller(ctx, req, seller, 'read')) ||
      ((await access.canSeeOrg(req, org.id)) && (await access.can(req, 'billing:read', orgScope(org.id))));
    if (!visible) throw notFound('Payment');
    if (await reconcilePayment(ctx, payment)) {
      payment = (await db.query.payments.findFirst({ where: eq(payments.id, id) }))!;
    }
    return toPaymentDto(ctx, payment, invoice?.number ?? null);
  });

  // --- Stripe webhook -------------------------------------------------------------

  await app.register(async (scoped) => {
    // Stripe signs the exact bytes it sent, so this route keeps the raw body.
    scoped.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) =>
      done(null, body),
    );

    scoped.post('/payments/stripe/webhook', async (req) => {
      const secret = ctx.env.STRIPE_WEBHOOK_SECRET;
      if (!secret) throw new AppError(503, 'not_configured', 'Stripe webhooks are not set up');
      if (!Buffer.isBuffer(req.body)) throw badRequest('Expected a JSON body');
      const header = req.headers['stripe-signature'];
      const check = verifyStripeSignature(req.body, Array.isArray(header) ? header[0] : header, secret);
      if (!check.ok) {
        req.log.warn({ reason: check.reason }, 'stripe webhook rejected');
        throw badRequest(`Invalid Stripe signature: ${check.reason}`);
      }
      let payload: unknown;
      try {
        payload = JSON.parse(req.body.toString('utf8'));
      } catch {
        throw badRequest('Invalid JSON');
      }
      const event = parse(webhookEvent, payload);
      const outcome = eventOutcome(event.type, event.data.object);
      // Unknown events, sessions and payments that are already settled are fine: 200,
      // so Stripe does not retry them.
      if (outcome) {
        const session = toSession(parse(sessionSchema, event.data.object));
        await applyCheckoutOutcome(ctx, req, session, outcome);
      }
      return { received: true };
    });
  });

  await zohoRoutes(app, ctx);
}
