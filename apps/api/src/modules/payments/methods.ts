import type { Currency, PaymentMethod } from '@weblion/shared';
import type { Env } from '../../config/env';
import type { Organization } from '../../db/schema';
import { configuredStripeMethods } from '../../integrations/stripe';

/** Methods that go through Stripe Checkout. */
export const ONLINE_METHODS = ['card', 'twint'] as const;
export type OnlineMethod = (typeof ONLINE_METHODS)[number];

/** Stripe does not accept smaller charges (0.50 in CHF and EUR). */
export const MIN_ONLINE_AMOUNT = 50;

/**
 * Online payment methods a customer can use right now. Only invoices the platform issues
 * can be paid online (resellers bill their customers themselves), Stripe must be set up,
 * and TWINT only works in CHF.
 */
export function onlinePayMethods(
  env: Env,
  org: Pick<Organization, 'parentOrgId'>,
  currency: Currency,
): PaymentMethod[] {
  if (org.parentOrgId || !env.STRIPE_SECRET_KEY) return [];
  const configured = configuredStripeMethods(env);
  const methods: PaymentMethod[] = [];
  if (configured.includes('card')) methods.push('card');
  if (configured.includes('twint') && currency === 'CHF') methods.push('twint');
  return methods;
}

/**
 * Why `method` can't be used for a payment to the seller of `org` in `currency`, or null
 * when it can. `org` is the billed organization, or { parentOrgId: issuerOrgId } for an
 * invoice. The message is shown to the customer.
 */
export function onlinePayProblem(
  env: Env,
  org: Pick<Organization, 'parentOrgId'>,
  currency: Currency,
  method: OnlineMethod,
  purpose: 'invoice' | 'topup',
): string | null {
  if (org.parentOrgId) {
    return purpose === 'invoice'
      ? 'Invoices from a reseller are paid to the reseller, not online'
      : 'Credit for customers of a reseller is booked by the reseller';
  }
  if (!env.STRIPE_SECRET_KEY) return 'Online payments are not set up';
  if (onlinePayMethods(env, org, currency).includes(method)) return null;
  if (method === 'twint' && currency !== 'CHF' && configuredStripeMethods(env).includes('twint')) {
    return 'TWINT is only available for payments in CHF';
  }
  return `The payment method ${method} is not available`;
}
