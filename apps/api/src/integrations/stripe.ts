import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IntegrationsDto } from '@weblion/shared';
import type { Env } from '../config/env';
import { ProviderError } from '../lib/errors';

/**
 * Small Stripe client without the SDK: form encoded requests in Stripe's bracket notation,
 * Checkout Sessions and webhook signature checks. The base URL comes from STRIPE_API_BASE
 * so tests can point it at a local mock.
 */

const PROVIDER = 'Stripe';

export type StripeValue = string | number | boolean | null | undefined | StripeParams | StripeValue[];
export interface StripeParams {
  [key: string]: StripeValue;
}

/** Encodes nested params the way Stripe expects them: a[b]=1, line_items[0][quantity]=1. */
export function stripeForm(params: StripeParams): URLSearchParams {
  const form = new URLSearchParams();
  const add = (key: string, value: StripeValue) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) value.forEach((v, i) => add(`${key}[${i}]`, v));
    else if (typeof value === 'object') for (const [k, v] of Object.entries(value)) add(`${key}[${k}]`, v);
    else form.append(key, String(value));
  };
  for (const [key, value] of Object.entries(params)) add(key, value);
  return form;
}

/** The part of a Checkout Session we read. */
export interface CheckoutSession {
  id: string;
  url: string | null;
  status: 'open' | 'complete' | 'expired' | null;
  payment_status: 'paid' | 'unpaid' | 'no_payment_required';
  payment_intent: string | { id: string } | null;
  client_reference_id: string | null;
  metadata: Record<string, string> | null;
  amount_total: number | null;
  currency: string | null;
}

/** Payment methods enabled in STRIPE_PAYMENT_METHODS, lowercased. */
export function configuredStripeMethods(env: Pick<Env, 'STRIPE_PAYMENT_METHODS'>): string[] {
  return env.STRIPE_PAYMENT_METHODS.split(',')
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean);
}

/** Stripe part of GET /admin/integrations. Never exposes the keys themselves. */
export function stripeStatus(
  env: Pick<Env, 'STRIPE_SECRET_KEY' | 'STRIPE_WEBHOOK_SECRET' | 'STRIPE_PAYMENT_METHODS'>,
): IntegrationsDto['stripe'] {
  const key = env.STRIPE_SECRET_KEY;
  return {
    configured: !!key,
    mode: !key ? null : /^(sk|rk)_live_/.test(key) ? 'live' : /^(sk|rk)_test_/.test(key) ? 'test' : null,
    webhookConfigured: !!env.STRIPE_WEBHOOK_SECRET,
    twint: !!key && configuredStripeMethods(env).includes('twint'),
  };
}

/** Stripe masks keys in its messages, this makes sure none ever reaches a response or log. */
function redact(message: string): string {
  return message.replace(/\b(sk|rk|pk|whsec)_[A-Za-z0-9_*]+/g, '$1_***');
}

export class StripeClient {
  constructor(private readonly env: Pick<Env, 'STRIPE_SECRET_KEY' | 'STRIPE_API_BASE'>) {}

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    params?: StripeParams,
    idempotencyKey?: string,
  ): Promise<T> {
    const key = this.env.STRIPE_SECRET_KEY;
    if (!key) throw new ProviderError(PROVIDER, 'not configured');
    const headers: Record<string, string> = { Authorization: `Bearer ${key}`, Accept: 'application/json' };
    let body: string | undefined;
    if (params) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = stripeForm(params).toString();
    }
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    let response: Response;
    try {
      response = await fetch(`${this.env.STRIPE_API_BASE.replace(/\/+$/, '')}${path}`, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      const cause =
        err instanceof Error ? ((err.cause as Error | undefined)?.message ?? err.message) : String(err);
      throw new ProviderError(PROVIDER, `request failed: ${redact(cause)}`);
    }
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON, handled below.
    }
    if (!response.ok) {
      const error = (parsed as { error?: { message?: unknown } } | null)?.error;
      const message = typeof error?.message === 'string' ? error.message : `HTTP ${response.status}`;
      throw new ProviderError(PROVIDER, redact(message), response.status);
    }
    if (!parsed || typeof parsed !== 'object') throw new ProviderError(PROVIDER, 'unexpected response');
    return parsed as T;
  }

  /** Creates a Checkout Session. The idempotency key makes retries return the same session. */
  createCheckoutSession(params: StripeParams, idempotencyKey: string): Promise<CheckoutSession> {
    return this.request('POST', '/v1/checkout/sessions', params, idempotencyKey);
  }

  retrieveCheckoutSession(id: string): Promise<CheckoutSession> {
    return this.request('GET', `/v1/checkout/sessions/${encodeURIComponent(id)}`);
  }
}

/** Payment intent id of a session, expanded or not. */
export function paymentIntentId(session: Pick<CheckoutSession, 'payment_intent'>): string | null {
  const pi = session.payment_intent;
  if (!pi) return null;
  return typeof pi === 'string' ? pi : (pi.id ?? null);
}

// --- Webhooks -----------------------------------------------------------------------

export type SignatureCheck = { ok: true; timestamp: number } | { ok: false; reason: string };

/**
 * Verifies a Stripe-Signature header ("t=<unix>,v1=<hex>[,v1=...]"): HMAC-SHA256 of
 * "<t>.<raw body>" with the endpoint secret, compared in constant time, and the timestamp
 * no further than `toleranceSeconds` from now so recorded requests can't be replayed.
 */
export function verifyStripeSignature(
  payload: Buffer,
  header: string | undefined,
  secret: string,
  toleranceSeconds = 300,
  now = Date.now(),
): SignatureCheck {
  if (!header) return { ok: false, reason: 'missing Stripe-Signature header' };
  let timestamp: number | null = null;
  const signatures: Buffer[] = [];
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't' && /^\d+$/.test(value)) timestamp = Number(value);
    else if (key === 'v1' && /^[0-9a-f]+$/i.test(value)) signatures.push(Buffer.from(value, 'hex'));
  }
  if (timestamp === null || signatures.length === 0)
    return { ok: false, reason: 'malformed signature header' };

  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(payload).digest();
  const match = signatures.some((sig) => sig.length === expected.length && timingSafeEqual(sig, expected));
  if (!match) return { ok: false, reason: 'signature mismatch' };
  if (Math.abs(now / 1000 - timestamp) > toleranceSeconds) {
    return { ok: false, reason: 'timestamp outside the tolerance' };
  }
  return { ok: true, timestamp };
}

/** Builds a Stripe-Signature header, for tests and local tooling. */
export function stripeSignatureHeader(
  payload: string | Buffer,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  const signature = createHmac('sha256', secret).update(`${timestamp}.`).update(payload).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}
