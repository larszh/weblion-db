import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  DEFAULT_CUSTOMER_BOUNDARY,
  DEFAULT_RESELLER_BOUNDARY,
  type CreditTransactionDto,
  type InvoiceDetailDto,
  type InvoiceDto,
  type Paginated,
  type PaymentDto,
} from '@weblion/shared';
import {
  auditLogs,
  billingProfiles,
  creditTransactions,
  invoices,
  memberships,
  organizations,
  payments,
  users,
} from '../src/db/schema';
import { hashPassword } from '../src/lib/crypto';
import { stripeSignatureHeader, stripeForm } from '../src/integrations/stripe';
import { ADMIN, Client, createTestApp, DEMO_PASSWORD, json, type TestApp } from './helpers';
import { startMockServer, type RecordedRequest } from './mock-server';

const WEBHOOK_SECRET = 'whsec_test_payments';
const APP = 'http://localhost:5173';

let t: TestApp;
let admin: Client;
let anna: Client;
let carla: Client;
let dev: Client;
let rita: Client;
let kurt: Client;
let eva: Client;
let musterId: string;
let beispielId: string;
let kundeId: string;
let euroId: string;

// --- Stripe mock --------------------------------------------------------------------

type Session = Record<string, unknown> & { id: string };
const sessions = new Map<string, Session>();
let sessionSeq = 0;
let eventSeq = 0;
let stripeFails = false;

function stripeRoute(req: RecordedRequest) {
  if (req.method === 'POST' && req.path === '/v1/checkout/sessions') {
    if (stripeFails) {
      return {
        status: 400,
        body: {
          error: { type: 'invalid_request_error', message: 'Invalid API Key provided: sk_test_abcdef123456' },
        },
      };
    }
    const id = `cs_test_${++sessionSeq}`;
    const session: Session = {
      id,
      object: 'checkout.session',
      url: `https://checkout.stripe.test/c/pay/${id}`,
      status: 'open',
      payment_status: 'unpaid',
      payment_intent: null,
      client_reference_id: req.form.get('client_reference_id'),
      metadata: { paymentId: req.form.get('metadata[paymentId]') },
      amount_total: Number(req.form.get('line_items[0][price_data][unit_amount]')),
      currency: req.form.get('line_items[0][price_data][currency]'),
    };
    sessions.set(id, session);
    return { body: session };
  }
  const match = /^\/v1\/checkout\/sessions\/([^/]+)$/.exec(req.path);
  if (req.method === 'GET' && match) {
    const session = sessions.get(match[1]!);
    return session
      ? { body: session }
      : { status: 404, body: { error: { message: 'No such checkout.session' } } };
  }
  return undefined;
}

// --- Zoho mock (JSON bodies) ----------------------------------------------------------

interface JsonRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  body: any;
}

async function startJsonMock(handler: (req: JsonRequest) => { status?: number; body: unknown } | undefined) {
  const requests: JsonRequest[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const body = !raw
        ? null
        : req.headers['content-type']?.includes('json')
          ? JSON.parse(raw)
          : Object.fromEntries(new URLSearchParams(raw));
      const recorded = {
        method: req.method ?? 'GET',
        path: url.pathname,
        query: url.searchParams,
        headers: req.headers,
        body,
      };
      requests.push(recorded);
      const answer = handler(recorded) ?? { status: 404, body: { code: 404, message: 'no route' } };
      res.statusCode = answer.status ?? 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

let zohoSeq = 0;
function zohoRoute(req: JsonRequest) {
  if (req.path === '/oauth/v2/token') return { body: { access_token: 'zoho-token', expires_in: 3600 } };
  const p = req.path.replace(/^\/books\/v3/, '');
  if (req.method === 'GET' && p === '/contacts') return { body: { code: 0, contacts: [] } };
  if (req.method === 'GET' && p === '/settings/currencies') {
    return { body: { code: 0, currencies: [{ currency_id: 'CUR-CHF', currency_code: 'CHF' }] } };
  }
  if (req.method === 'POST' && p === '/contacts') {
    return { body: { code: 0, contact: { contact_id: `C${++zohoSeq}` } } };
  }
  if (req.method === 'POST' && p === '/invoices') {
    // Totals are not checked here (zoho.test.ts does that).
    return { body: { code: 0, invoice: { invoice_id: `I${++zohoSeq}`, status: 'draft' } } };
  }
  if (req.method === 'POST' && /^\/invoices\/[^/]+\/status\/sent$/.test(p)) {
    return { body: { code: 0, message: 'Invoice status has been changed to Sent.' } };
  }
  if (req.method === 'POST' && p === '/customerpayments') {
    return { body: { code: 0, payment: { payment_id: `P${++zohoSeq}` } } };
  }
  return undefined;
}

let stripe: Awaited<ReturnType<typeof startMockServer>>;
let zoho: Awaited<ReturnType<typeof startJsonMock>>;

// --- Helpers ------------------------------------------------------------------------

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 5000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Finalized platform invoice for `orgId`, created through the seller routes. */
async function invoiceFor(orgId: string, unitPrice: number, client = admin): Promise<InvoiceDetailDto> {
  const created = await client.post(`/billing/customers/${orgId}/invoices`, {
    lines: [{ description: 'Cloud Server S', quantity: 1, unitPrice }],
  });
  expect(created.statusCode, created.body).toBe(200);
  const res = await client.post(`/invoices/${json(created).id}/finalize`, { send: false });
  expect(res.statusCode, res.body).toBe(200);
  return json<InvoiceDetailDto>(res);
}

function webhook(type: string, object: Record<string, unknown>, header?: string) {
  const payload = JSON.stringify({ id: `evt_${++eventSeq}`, object: 'event', type, data: { object } });
  return t.app.inject({
    method: 'POST',
    url: '/api/v1/payments/stripe/webhook',
    payload,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'stripe-signature': header ?? stripeSignatureHeader(payload, WEBHOOK_SECRET),
    },
  });
}

/** The session Stripe would send once the customer paid. */
function paid(sessionId: string, extra: Record<string, unknown> = {}) {
  return {
    ...sessions.get(sessionId)!,
    status: 'complete',
    payment_status: 'paid',
    payment_intent: `pi_${sessionId}`,
    ...extra,
  };
}

async function paymentRow(id: string) {
  return (await t.db.query.payments.findFirst({ where: eq(payments.id, id) }))!;
}

async function invoiceRow(id: string) {
  return (await t.db.query.invoices.findFirst({ where: eq(invoices.id, id) }))!;
}

async function balance(client: Client, orgId: string) {
  return json<{ balance: number; items: CreditTransactionDto[] }>(await client.get(`/orgs/${orgId}/credit`));
}

const lastCheckout = () => stripe.requests.filter((r) => r.path === '/v1/checkout/sessions').at(-1)!;
const zohoPayments = () => zoho.requests.filter((r) => r.path.endsWith('/customerpayments'));

beforeAll(async () => {
  stripe = await startMockServer(stripeRoute);
  zoho = await startJsonMock(zohoRoute);
  t = await createTestApp();
  // The test app reads its configuration at request time.
  Object.assign(t.ctx.env, {
    STRIPE_SECRET_KEY: 'sk_test_payments',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_API_BASE: stripe.url,
    STRIPE_PAYMENT_METHODS: 'card,twint',
    ZOHO_CLIENT_ID: 'zoho-client',
    ZOHO_CLIENT_SECRET: 'zoho-client-secret',
    ZOHO_REFRESH_TOKEN: 'zoho-refresh',
    ZOHO_ORGANIZATION_ID: '20000001',
    ZOHO_ACCOUNTS_URL: zoho.url,
    ZOHO_API_URL: `${zoho.url}/books/v3`,
    ZOHO_TAX_IDS: '810:TAX810,0:TAX0',
  });

  admin = new Client(t.app);
  await admin.login(ADMIN.email, ADMIN.password);
  const orgs = json<{ id: string; slug: string }[]>(await admin.get('/admin/orgs'));
  musterId = orgs.find((o) => o.slug === 'muster-ag')!.id;
  beispielId = orgs.find((o) => o.slug === 'beispiel-gmbh')!.id;

  // A reseller with a customer, and a platform customer billed in EUR.
  const hash = await hashPassword(DEMO_PASSWORD);
  const [reseller] = await t.db
    .insert(organizations)
    .values({
      name: 'Pay Reseller AG',
      slug: 'pay-reseller',
      kind: 'reseller',
      boundary: DEFAULT_RESELLER_BOUNDARY,
    })
    .returning();
  const [kunde, euro] = await t.db
    .insert(organizations)
    .values([
      {
        name: 'Pay Kunde GmbH',
        slug: 'pay-kunde',
        kind: 'customer',
        boundary: DEFAULT_CUSTOMER_BOUNDARY,
        parentOrgId: reseller!.id,
      },
      { name: 'Euro GmbH', slug: 'euro-gmbh', kind: 'customer', boundary: DEFAULT_CUSTOMER_BOUNDARY },
    ])
    .returning();
  kundeId = kunde!.id;
  euroId = euro!.id;
  await t.db
    .insert(billingProfiles)
    .values({ orgId: euroId, companyName: 'Euro GmbH', country: 'DE', currency: 'EUR' });
  const [ritaUser, kurtUser, evaUser] = await t.db
    .insert(users)
    .values([
      { email: 'rita@pay-reseller.example', name: 'Rita Reseller', passwordHash: hash },
      { email: 'kurt@pay-kunde.example', name: 'Kurt Kunde', passwordHash: hash },
      { email: 'eva@euro.example', name: 'Eva Euro', passwordHash: hash, locale: 'en' },
    ])
    .returning();
  await t.db.insert(memberships).values([
    { orgId: reseller!.id, userId: ritaUser!.id, role: 'owner' },
    { orgId: kundeId, userId: kurtUser!.id, role: 'owner' },
    { orgId: euroId, userId: evaUser!.id, role: 'owner' },
  ]);

  anna = new Client(t.app);
  await anna.login('anna@muster.example');
  carla = new Client(t.app);
  await carla.login('carla@muster.example');
  dev = new Client(t.app);
  await dev.login('dev@beispiel.example');
  rita = new Client(t.app);
  await rita.login('rita@pay-reseller.example');
  kurt = new Client(t.app);
  await kurt.login('kurt@pay-kunde.example');
  eva = new Client(t.app);
  await eva.login('eva@euro.example');
});

afterAll(async () => {
  await t?.close();
  await stripe?.close();
  await zoho?.close();
});

describe('stripe client', () => {
  it('encodes nested params in bracket notation', () => {
    const form = stripeForm({
      mode: 'payment',
      payment_method_types: ['twint'],
      line_items: [{ quantity: 1, price_data: { currency: 'chf', product_data: { name: 'A & B' } } }],
      skipped: undefined,
    });
    expect([...form.entries()]).toEqual([
      ['mode', 'payment'],
      ['payment_method_types[0]', 'twint'],
      ['line_items[0][quantity]', '1'],
      ['line_items[0][price_data][currency]', 'chf'],
      ['line_items[0][price_data][product_data][name]', 'A & B'],
    ]);
  });
});

describe('webhook signature', () => {
  const event = { id: 'cs_unknown', payment_status: 'paid', status: 'complete' };

  it('answers 503 while no webhook secret is configured', async () => {
    t.ctx.env.STRIPE_WEBHOOK_SECRET = undefined;
    try {
      expect((await webhook('checkout.session.completed', event)).statusCode).toBe(503);
    } finally {
      t.ctx.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    }
  });

  it('rejects missing, wrong and stale signatures', async () => {
    const payload = '{"id":"evt_x","type":"checkout.session.completed","data":{"object":{}}}';
    const now = Math.floor(Date.now() / 1000);
    const cases = [
      undefined,
      't=123',
      stripeSignatureHeader(payload, 'whsec_wrong'),
      stripeSignatureHeader(payload, WEBHOOK_SECRET, now - 600),
      stripeSignatureHeader(payload, WEBHOOK_SECRET, now + 600),
    ];
    for (const header of cases) {
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/v1/payments/stripe/webhook',
        payload,
        headers: { 'content-type': 'application/json', ...(header ? { 'stripe-signature': header } : {}) },
      });
      expect(res.statusCode, header).toBe(400);
    }
    // A signature over different bytes (re-serialized JSON) does not pass either.
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/payments/stripe/webhook',
      payload: payload.replace('evt_x', 'evt_y'),
      headers: {
        'content-type': 'application/json',
        'stripe-signature': stripeSignatureHeader(payload, WEBHOOK_SECRET),
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts unknown events and sessions with 200', async () => {
    expect((await webhook('customer.created', { id: 'cus_1' })).statusCode).toBe(200);
    const res = await webhook('checkout.session.completed', event);
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res)).toEqual({ received: true });
  });
});

describe('paying an invoice online', () => {
  let invoice: InvoiceDetailDto;
  let paymentId: string;
  let sessionId: string;

  it('offers card and TWINT for platform invoices in CHF', async () => {
    invoice = await invoiceFor(beispielId, 1900);
    expect(invoice.total).toBe(2054);
    const detail = json<InvoiceDetailDto>(await dev.get(`/invoices/${invoice.id}`));
    expect(detail.payMethods).toEqual(['card', 'twint']);
    expect(detail.can.pay).toBe(true);
    // Finalizing pushed the invoice to Zoho in the background.
    await waitFor(async () => (await invoiceRow(invoice.id)).zohoStatus === 'synced');
  });

  it('starts a Checkout Session for the amount due', async () => {
    const res = await dev.post(`/invoices/${invoice.id}/pay`, { method: 'twint' });
    expect(res.statusCode, res.body).toBe(200);
    const body = json<{ checkoutUrl: string; paymentId: string }>(res);
    paymentId = body.paymentId;
    const request = lastCheckout();
    sessionId = `cs_test_${sessionSeq}`;
    expect(body.checkoutUrl).toBe(`https://checkout.stripe.test/c/pay/${sessionId}`);

    expect(request.headers.authorization).toBe('Bearer sk_test_payments');
    expect(request.headers['idempotency-key']).toBe(`checkout-${paymentId}`);
    const form = Object.fromEntries(request.form.entries());
    expect(form).toMatchObject({
      mode: 'payment',
      'payment_method_types[0]': 'twint',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'chf',
      'line_items[0][price_data][unit_amount]': '2054',
      'line_items[0][price_data][product_data][name]': `Rechnung ${invoice.number}`,
      client_reference_id: paymentId,
      'metadata[paymentId]': paymentId,
      'metadata[orgId]': beispielId,
      'metadata[invoiceId]': invoice.id,
      success_url: `${APP}/o/beispiel-gmbh/billing/invoices/${invoice.id}?payment=success&pid=${paymentId}`,
      cancel_url: `${APP}/o/beispiel-gmbh/billing/invoices/${invoice.id}?payment=cancel&pid=${paymentId}`,
      customer_email: 'dev@beispiel.example',
      locale: 'de',
    });

    const row = await paymentRow(paymentId);
    expect(row).toMatchObject({
      status: 'pending',
      provider: 'stripe',
      method: 'twint',
      amount: 2054,
      externalId: sessionId,
      invoiceId: invoice.id,
    });
    const polled = json<PaymentDto>(await dev.get(`/payments/${paymentId}`));
    expect(polled.status).toBe('pending');
    expect(polled.invoice).toEqual({ id: invoice.id, number: invoice.number });
  });

  it('books the payment once when Stripe reports it, and pushes it to Zoho', async () => {
    const res = await webhook('checkout.session.completed', paid(sessionId));
    expect(res.statusCode, res.body).toBe(200);

    const after = json<InvoiceDetailDto>(await dev.get(`/invoices/${invoice.id}`));
    expect(after.status).toBe('paid');
    expect(after.amountDue).toBe(0);
    expect(after.payMethods).toEqual([]);
    const row = await paymentRow(paymentId);
    expect(row.status).toBe('succeeded');
    expect(row.reference).toBe(`pi_${sessionId}`);

    const zohoPayment = await waitFor(async () => (await paymentRow(paymentId)).zohoPaymentId);
    expect(zohoPayment).toMatch(/^P\d+$/);
    const pushed = zohoPayments();
    expect(pushed).toHaveLength(1);
    expect(pushed[0]!.body).toMatchObject({
      payment_mode: 'others',
      amount: 20.54,
      reference_number: `pi_${sessionId}`,
      invoices: [{ invoice_id: (await invoiceRow(invoice.id)).zohoInvoiceId, amount_applied: 20.54 }],
    });

    const audit = await t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'payment.succeeded'), eq(auditLogs.resourceId, paymentId)));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorName).toBe('Stripe');
  });

  it('ignores the same event delivered again', async () => {
    for (const type of ['checkout.session.completed', 'checkout.session.async_payment_succeeded']) {
      expect((await webhook(type, paid(sessionId))).statusCode).toBe(200);
    }
    await new Promise((r) => setTimeout(r, 200));
    expect((await invoiceRow(invoice.id)).amountPaid).toBe(2054);
    const rows = await t.db.select().from(payments).where(eq(payments.invoiceId, invoice.id));
    expect(rows.map((p) => p.status)).toEqual(['succeeded']);
    expect(
      await t.db.select().from(creditTransactions).where(eq(creditTransactions.paymentId, paymentId)),
    ).toEqual([]);
    expect(zohoPayments()).toHaveLength(1);
    // A paid invoice can't be paid again.
    expect((await dev.post(`/invoices/${invoice.id}/pay`, { method: 'card' })).statusCode).toBe(409);
  });
});

describe('an invoice paid by other means meanwhile', () => {
  it('turns the online payment into credit', async () => {
    const invoice = await invoiceFor(beispielId, 1000);
    const start = json<{ paymentId: string }>(
      await dev.post(`/invoices/${invoice.id}/pay`, { method: 'card' }),
    );
    const sessionId = (await paymentRow(start.paymentId)).externalId!;
    expect(lastCheckout().form.get('payment_method_types[0]')).toBe('card');

    const marked = await admin.post(`/invoices/${invoice.id}/mark-paid`, { method: 'bank_transfer' });
    expect(marked.statusCode, marked.body).toBe(200);
    expect((await webhook('checkout.session.completed', paid(sessionId))).statusCode).toBe(200);

    expect(await paymentRow(start.paymentId)).toMatchObject({ status: 'succeeded' });
    expect((await invoiceRow(invoice.id)).amountPaid).toBe(invoice.total);
    const credit = await balance(dev, beispielId);
    expect(credit.balance).toBe(invoice.total);
    expect(credit.items[0]).toMatchObject({
      amount: invoice.total,
      type: 'topup',
      paymentId: start.paymentId,
    });

    // Zoho gets the bank transfer; the online payment reaches it once the credit is spent.
    const manual = (await t.db.select().from(payments).where(eq(payments.invoiceId, invoice.id))).find(
      (p) => p.method === 'bank_transfer',
    )!;
    await waitFor(async () => (await paymentRow(manual.id)).zohoPaymentId);
    await new Promise((r) => setTimeout(r, 200));
    expect((await paymentRow(start.paymentId)).zohoPaymentId).toBeNull();
    expect(zohoPayments().at(-1)!.body).toMatchObject({
      payment_mode: 'banktransfer',
      amount: invoice.total / 100,
    });
  });
});

describe('credit top-ups', () => {
  it('validates the amount and the payer', async () => {
    expect(
      (await dev.post(`/orgs/${beispielId}/credit/topup`, { amount: 100, method: 'card' })).statusCode,
    ).toBe(400);
    expect(
      (await dev.post(`/orgs/${beispielId}/credit/topup`, { amount: 2000, method: 'credit' })).statusCode,
    ).toBe(400);
    // Carla can see Muster AG but may not pay, Dev can't see it at all.
    expect(
      (await carla.post(`/orgs/${musterId}/credit/topup`, { amount: 2000, method: 'card' })).statusCode,
    ).toBe(403);
    expect(
      (await dev.post(`/orgs/${musterId}/credit/topup`, { amount: 2000, method: 'card' })).statusCode,
    ).toBe(404);
  });

  it('books the paid amount as credit', async () => {
    const before = (await balance(dev, beispielId)).balance;
    const res = await dev.post(`/orgs/${beispielId}/credit/topup`, { amount: 2500, method: 'twint' });
    expect(res.statusCode, res.body).toBe(200);
    const { paymentId } = json<{ paymentId: string }>(res);
    const form = lastCheckout().form;
    expect(form.get('line_items[0][price_data][product_data][name]')).toBe('Guthaben weblion.one');
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe('2500');
    expect(form.get('metadata[invoiceId]')).toBeNull();
    expect(form.get('success_url')).toBe(`${APP}/o/beispiel-gmbh/billing?payment=success&pid=${paymentId}`);

    const sessionId = (await paymentRow(paymentId)).externalId!;
    expect((await webhook('checkout.session.completed', paid(sessionId))).statusCode).toBe(200);
    expect((await webhook('checkout.session.completed', paid(sessionId))).statusCode).toBe(200);
    const credit = await balance(dev, beispielId);
    expect(credit.balance).toBe(before + 2500);
    expect(credit.items[0]).toMatchObject({ amount: 2500, type: 'topup', paymentId });
    const payment = json<PaymentDto>(await dev.get(`/payments/${paymentId}`));
    expect(payment).toMatchObject({ status: 'succeeded', invoice: null, method: 'twint' });
  });
});

describe('paying from credit', () => {
  it('uses the balance and pushes the payment and the invoice to Zoho', async () => {
    const open = json<Paginated<InvoiceDto>>(await anna.get(`/orgs/${musterId}/invoices?status=open`))
      .items[0]!;
    expect(open.amountDue).toBeGreaterThan(5000);
    expect(json<InvoiceDetailDto>(await anna.get(`/invoices/${open.id}`)).payMethods).toContain('credit');
    // Carla has no billing permissions at all.
    expect((await carla.post(`/invoices/${open.id}/pay`, { method: 'credit' })).statusCode).toBe(404);

    const res = await anna.post(`/invoices/${open.id}/pay`, { method: 'credit' });
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res)).toEqual({ status: 'partial', amount: 5000 });
    expect((await balance(anna, musterId)).balance).toBe(0);
    expect((await anna.post(`/invoices/${open.id}/pay`, { method: 'credit' })).statusCode).toBe(409);

    // The seeded invoice was never in Zoho: it goes there first, then the payment.
    const payment = (await t.db.select().from(payments).where(eq(payments.invoiceId, open.id))).find(
      (p) => p.method === 'credit',
    )!;
    await waitFor(async () => (await paymentRow(payment.id)).zohoPaymentId);
    // The invoice is marked synced only after its payments are pushed: wait for the sync to end.
    const pushed = await waitFor(async () => {
      const row = await invoiceRow(open.id);
      return row.zohoStatus !== 'pending' && row;
    });
    expect(pushed.zohoStatus).toBe('synced');
    const contact = zoho.requests.find(
      (r) => r.method === 'POST' && r.path.endsWith('/contacts') && r.body.contact_name === 'Muster AG',
    );
    expect(contact?.body).toMatchObject({
      contact_type: 'customer',
      currency_id: 'CUR-CHF',
      billing_address: { address: 'Bahnhofstrasse 10', zip: '8001', city: 'Zürich', country: 'Schweiz' },
      contact_persons: [{ first_name: 'Anna', last_name: 'Muster', email: 'buchhaltung@muster.example' }],
    });
    expect(zohoPayments().at(-1)!.body).toMatchObject({ payment_mode: 'others', amount: 50 });
  });
});

describe('restrictions', () => {
  it('does not let customers of a reseller pay online', async () => {
    const invoice = await invoiceFor(kundeId, 4500, rita);
    expect(invoice.issuer.orgId).not.toBeNull();
    const detail = json<InvoiceDetailDto>(await kurt.get(`/invoices/${invoice.id}`));
    expect(detail.payMethods).toEqual([]);
    const pay = await kurt.post(`/invoices/${invoice.id}/pay`, { method: 'card' });
    expect(pay.statusCode).toBe(409);
    expect(json(pay).error.message).toBe('Invoices from a reseller are paid to the reseller, not online');
    const topup = await kurt.post(`/orgs/${kundeId}/credit/topup`, { amount: 2000, method: 'card' });
    expect(topup.statusCode).toBe(409);
    expect(json(topup).error.message).toBe('Credit for customers of a reseller is booked by the reseller');

    // Credit the reseller booked works, by the customer or by the reseller.
    const booked = await rita.post(`/billing/customers/${kundeId}/credit`, {
      amount: 1000,
      type: 'topup',
      description: 'Vorauszahlung',
    });
    expect(booked.statusCode, booked.body).toBe(200);
    expect(json(await kurt.post(`/invoices/${invoice.id}/pay`, { method: 'credit' }))).toEqual({
      status: 'partial',
      amount: 1000,
    });
    // Reseller invoices never go to Zoho.
    expect((await invoiceRow(invoice.id)).zohoInvoiceId).toBeNull();
  });

  it('offers TWINT only in CHF', async () => {
    const invoice = await invoiceFor(euroId, 1000);
    expect(invoice.currency).toBe('EUR');
    const detail = json<InvoiceDetailDto>(await eva.get(`/invoices/${invoice.id}`));
    expect(detail.payMethods).toEqual(['card']);
    const twint = await eva.post(`/invoices/${invoice.id}/pay`, { method: 'twint' });
    expect(twint.statusCode).toBe(409);
    expect(json(twint).error.message).toBe('TWINT is only available for payments in CHF');
    expect(
      (await eva.post(`/orgs/${euroId}/credit/topup`, { amount: 2000, method: 'twint' })).statusCode,
    ).toBe(409);

    const card = await eva.post(`/orgs/${euroId}/credit/topup`, { amount: 2000, method: 'card' });
    expect(card.statusCode, card.body).toBe(200);
    expect(lastCheckout().form.get('line_items[0][price_data][currency]')).toBe('eur');
    expect(lastCheckout().form.get('locale')).toBe('en');
  });

  // Euro GmbH has no credit, so finalizing leaves these invoices open.
  it('offers nothing online without Stripe', async () => {
    const invoice = await invoiceFor(euroId, 800);
    t.ctx.env.STRIPE_SECRET_KEY = undefined;
    try {
      expect(json<InvoiceDetailDto>(await eva.get(`/invoices/${invoice.id}`)).payMethods).toEqual([]);
      const res = await eva.post(`/invoices/${invoice.id}/pay`, { method: 'card' });
      expect(res.statusCode).toBe(409);
      expect(json(res).error.message).toBe('Online payments are not set up');
    } finally {
      t.ctx.env.STRIPE_SECRET_KEY = 'sk_test_payments';
    }
  });

  it('keeps a failed payment when Stripe refuses, without leaking the key', async () => {
    const invoice = await invoiceFor(euroId, 700);
    stripeFails = true;
    try {
      const res = await eva.post(`/invoices/${invoice.id}/pay`, { method: 'card' });
      expect(res.statusCode).toBe(502);
      expect(res.body).not.toContain('abcdef123456');
    } finally {
      stripeFails = false;
    }
    const rows = await t.db.select().from(payments).where(eq(payments.invoiceId, invoice.id));
    expect(rows.map((p) => [p.status, p.externalId])).toEqual([['failed', null]]);
    expect((await invoiceRow(invoice.id)).status).toBe('open');
  });

  it('shows a payment only to the customer and the seller', async () => {
    const [row] = await t.db
      .select()
      .from(payments)
      .where(and(eq(payments.orgId, beispielId), eq(payments.method, 'twint')))
      .limit(1);
    expect((await dev.get(`/payments/${row!.id}`)).statusCode).toBe(200);
    expect((await admin.get(`/payments/${row!.id}`)).statusCode).toBe(200);
    expect((await anna.get(`/payments/${row!.id}`)).statusCode).toBe(404);
    const [annaPayment] = await t.db.select().from(payments).where(eq(payments.orgId, musterId)).limit(1);
    expect((await carla.get(`/payments/${annaPayment!.id}`)).statusCode).toBe(404);
    expect((await anna.get(`/payments/${annaPayment!.id}`)).statusCode).toBe(200);
  });
});

describe('other Checkout outcomes', () => {
  async function start(amount = 3000) {
    const res = await dev.post(`/orgs/${beispielId}/credit/topup`, { amount, method: 'card' });
    expect(res.statusCode, res.body).toBe(200);
    const { paymentId } = json<{ paymentId: string }>(res);
    return { paymentId, sessionId: (await paymentRow(paymentId)).externalId! };
  }

  it('cancels expired sessions and marks failed ones', async () => {
    const expired = await start();
    await webhook('checkout.session.expired', { ...sessions.get(expired.sessionId)!, status: 'expired' });
    expect((await paymentRow(expired.paymentId)).status).toBe('cancelled');
    // A late success for a cancelled payment books nothing.
    const before = (await balance(dev, beispielId)).balance;
    await webhook('checkout.session.completed', paid(expired.sessionId));
    expect((await balance(dev, beispielId)).balance).toBe(before);

    const failed = await start();
    await webhook('checkout.session.completed', { ...paid(failed.sessionId), payment_status: 'unpaid' });
    expect((await paymentRow(failed.paymentId)).status).toBe('pending');
    await webhook('checkout.session.async_payment_failed', {
      ...paid(failed.sessionId),
      payment_status: 'unpaid',
    });
    expect(await paymentRow(failed.paymentId)).toMatchObject({
      status: 'failed',
      error: 'The payment failed',
    });
  });

  it('settles delayed payments when they succeed', async () => {
    const delayed = await start(1500);
    const before = (await balance(dev, beispielId)).balance;
    await webhook('checkout.session.completed', { ...paid(delayed.sessionId), payment_status: 'unpaid' });
    expect((await balance(dev, beispielId)).balance).toBe(before);
    await webhook('checkout.session.async_payment_succeeded', paid(delayed.sessionId));
    expect((await balance(dev, beispielId)).balance).toBe(before + 1500);
  });

  it('finds the payment by our id when the session id was never stored', async () => {
    const lost = await start(1200);
    await t.db.update(payments).set({ externalId: null }).where(eq(payments.id, lost.paymentId));
    await webhook('checkout.session.completed', paid(lost.sessionId));
    expect(await paymentRow(lost.paymentId)).toMatchObject({
      status: 'succeeded',
      externalId: lost.sessionId,
    });
  });

  it('never books an amount Stripe did not confirm', async () => {
    const odd = await start(4000);
    await webhook('checkout.session.completed', paid(odd.sessionId, { amount_total: 400 }));
    expect(await paymentRow(odd.paymentId)).toMatchObject({
      status: 'pending',
      error: 'Stripe reported a different amount',
    });
  });

  it('asks Stripe directly while the console polls', async () => {
    const polled = await start(1800);
    expect(json<PaymentDto>(await dev.get(`/payments/${polled.paymentId}`)).status).toBe('pending');
    sessions.set(polled.sessionId, paid(polled.sessionId));
    // Checks are throttled per payment.
    await new Promise((r) => setTimeout(r, 3100));
    const payment = json<PaymentDto>(await dev.get(`/payments/${polled.paymentId}`));
    expect(payment).toMatchObject({ status: 'succeeded', reference: `pi_${polled.sessionId}` });
  });
});

describe('a billing currency change while a payment is pending', () => {
  it('is refused, and a payment that arrives in the old currency anyway is still booked', async () => {
    const [org] = await t.db
      .insert(organizations)
      .values({
        name: 'Wechsel AG',
        slug: 'wechsel-ag',
        kind: 'customer',
        boundary: DEFAULT_CUSTOMER_BOUNDARY,
      })
      .returning();
    const [owner] = await t.db
      .insert(users)
      .values({
        email: 'wanda@wechsel.example',
        name: 'Wanda Wechsel',
        passwordHash: await hashPassword(DEMO_PASSWORD),
      })
      .returning();
    await t.db.insert(memberships).values({ orgId: org!.id, userId: owner!.id, role: 'owner' });
    const wanda = new Client(t.app);
    await wanda.login('wanda@wechsel.example');

    const invoice = await invoiceFor(org!.id, 10000);
    const start = json<{ paymentId: string }>(
      await wanda.post(`/invoices/${invoice.id}/pay`, { method: 'card' }),
    );
    const sessionId = (await paymentRow(start.paymentId)).externalId!;
    const change = await admin.request('PUT', `/billing/customers/${org!.id}/profile`, {
      companyName: 'Wechsel AG',
      currency: 'EUR',
    });
    expect(change.statusCode).toBe(409);
    expect(json<{ error: { message: string } }>(change).error.message).toContain('1 pending payment(s)');

    // Part of it arrives by bank transfer, then the currency changes behind the API's back.
    expect(
      (await admin.post(`/invoices/${invoice.id}/mark-paid`, { amount: 810, method: 'bank_transfer' }))
        .statusCode,
    ).toBe(200);
    await t.db
      .insert(billingProfiles)
      .values({ orgId: org!.id, currency: 'EUR' })
      .onConflictDoUpdate({ target: billingProfiles.orgId, set: { currency: 'EUR' } });

    // Stripe charged the full amount: the invoice is paid, the 8.10 left over can't become
    // EUR credit, so it is noted for staff instead of failing the webhook forever.
    expect((await webhook('checkout.session.completed', paid(sessionId))).statusCode).toBe(200);
    expect(await paymentRow(start.paymentId)).toMatchObject({ status: 'succeeded' });
    expect((await paymentRow(start.paymentId)).error).toContain('could not be booked as credit');
    expect(await invoiceRow(invoice.id)).toMatchObject({ status: 'paid', amountPaid: invoice.total });
    expect(await t.db.select().from(creditTransactions).where(eq(creditTransactions.orgId, org!.id))).toEqual(
      [],
    );
    const [unbooked] = await t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'payment.unbooked'), eq(auditLogs.resourceId, start.paymentId)));
    expect(unbooked).toMatchObject({ status: 'failure', orgId: org!.id });
    expect(unbooked!.details).toMatchObject({ unbooked: 810, currency: 'CHF' });

    // Nothing pending, open or credited anymore: now the currency may change.
    const later = await admin.request('PUT', `/billing/customers/${org!.id}/profile`, {
      companyName: 'Wechsel AG',
      currency: 'CHF',
    });
    expect(later.statusCode, later.body).toBe(200);
  });
});
