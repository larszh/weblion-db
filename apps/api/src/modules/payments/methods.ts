import type { Currency, PaymentMethod } from '@weblion/shared';
import type { Env } from '../../config/env';
import type { Organization } from '../../db/schema';

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
  const configured = env.STRIPE_PAYMENT_METHODS.split(',')
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean);
  const methods: PaymentMethod[] = [];
  if (configured.includes('card')) methods.push('card');
  if (configured.includes('twint') && currency === 'CHF') methods.push('twint');
  return methods;
}
