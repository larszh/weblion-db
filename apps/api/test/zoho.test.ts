import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  DEFAULT_CUSTOMER_BOUNDARY,
  DEFAULT_RESELLER_BOUNDARY,
  lineTotal,
  type InvoiceDto,
} from '@weblion/shared';
import { auditLogs, billingProfiles, invoices, organizations, payments } from '../src/db/schema';
import { ZohoService } from '../src/integrations/zoho';
import { createDraft, finalizeInTx, markPaidInTx } from '../src/modules/billing/invoices';
import { ADMIN, Client, createTestApp, json, type TestApp } from './helpers';

const ZOHO_ORG = '20000001';

let t: TestApp;
let admin: Client;
let anna: Client;
let dev: Client;
let musterId: string;
let beispielId: string;

// --- Zoho mock ------------------------------------------------------------------------

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

const TAX_RATES: Record<string, number> = { TAX810: 810, TAX0: 0 };

/** Simulated Zoho Books account. */
const books = {
  tokenSeq: 0,
  expiresIn: 3600,
  tokenError: null as string | null,
  validTokens: new Set<string>(),
  /** "line" rounds tax per line like Zoho, "rate" like we do. */
  rounding: 'rate' as 'rate' | 'line',
  invoiceError: null as { status: number; body: unknown } | null,
  seq: 0,
  contacts: [] as { contact_id: string; contact_name: string }[],
  invoices: new Map<string, { status: string; total: number; adjustment: number; body: any }>(),
};

/** Total in Zoho's way, as a decimal. */
function zohoTotal(lineItems: { rate: number; quantity: number; tax_id?: string }[], adjustment = 0) {
  let net = 0;
  let lineTax = 0;
  const byRate = new Map<number, number>();
  for (const item of lineItems) {
    const amount = Math.round(item.rate * 100 * item.quantity);
    const bp = item.tax_id ? TAX_RATES[item.tax_id]! : 0;
    net += amount;
    lineTax += Math.round((amount * bp) / 10_000);
    byRate.set(bp, (byRate.get(bp) ?? 0) + amount);
  }
  const rateTax = [...byRate].reduce((sum, [bp, amount]) => sum + Math.round((amount * bp) / 10_000), 0);
  return (net + (books.rounding === 'line' ? lineTax : rateTax)) / 100 + adjustment;
}

function zohoRoute(req: JsonRequest) {
  if (req.path === '/oauth/v2/token') {
    if (books.tokenError) return { body: { error: books.tokenError } };
    const token = `token-${++books.tokenSeq}`;
    books.validTokens.add(token);
    return { body: { access_token: token, expires_in: books.expiresIn, token_type: 'Bearer' } };
  }
  const auth = String(req.headers.authorization ?? '');
  if (!auth.startsWith('Zoho-oauthtoken ') || !books.validTokens.has(auth.slice(16))) {
    return { status: 401, body: { code: 57, message: 'You are not authorized to perform this operation' } };
  }
  if (req.query.get('organization_id') !== ZOHO_ORG) {
    return { status: 400, body: { code: 6041, message: 'Invalid organization' } };
  }
  const p = req.path.replace(/^\/books\/v3/, '');
  const m = req.method;
  if (m === 'GET' && p === '/organizations') {
    return {
      body: {
        code: 0,
        organizations: [
          { organization_id: '999', name: 'Andere AG' },
          { organization_id: ZOHO_ORG, name: 'weblion.one GmbH' },
        ],
      },
    };
  }
  if (m === 'GET' && p === '/settings/currencies') {
    return {
      body: {
        code: 0,
        currencies: [
          { currency_id: 'CUR-CHF', currency_code: 'CHF' },
          { currency_id: 'CUR-EUR', currency_code: 'EUR' },
        ],
      },
    };
  }
  if (m === 'GET' && p === '/contacts') {
    const name = req.query.get('contact_name');
    return { body: { code: 0, contacts: books.contacts.filter((c) => c.contact_name === name) } };
  }
  if (m === 'POST' && p === '/contacts') {
    // Like Zoho: contact names are unique.
    if (books.contacts.some((c) => c.contact_name === req.body.contact_name)) {
      return {
        status: 400,
        body: { code: 3062, message: `The contact "${req.body.contact_name}" already exists.` },
      };
    }
    const contact = { contact_id: `C${++books.seq}`, contact_name: req.body.contact_name };
    books.contacts.push(contact);
    return { status: 201, body: { code: 0, contact } };
  }
  if (m === 'POST' && p === '/invoices') {
    if (books.invoiceError) return books.invoiceError;
    const id = `I${++books.seq}`;
    const invoice = { status: 'draft', total: zohoTotal(req.body.line_items), adjustment: 0, body: req.body };
    books.invoices.set(id, invoice);
    return {
      status: 201,
      body: { code: 0, invoice: { invoice_id: id, status: 'draft', total: invoice.total } },
    };
  }
  const one = /^\/invoices\/([^/]+)(\/status\/(sent|void))?$/.exec(p);
  const invoice = one ? books.invoices.get(one[1]!) : undefined;
  if (one && invoice) {
    if (m === 'GET' && !one[2]) {
      return {
        body: { code: 0, invoice: { invoice_id: one[1], status: invoice.status, total: invoice.total } },
      };
    }
    if (m === 'PUT' && !one[2]) {
      invoice.adjustment = req.body.adjustment ?? 0;
      invoice.body = req.body;
      invoice.total = zohoTotal(req.body.line_items, invoice.adjustment);
      return {
        body: { code: 0, invoice: { invoice_id: one[1], status: invoice.status, total: invoice.total } },
      };
    }
    if (m === 'POST' && one[3]) {
      invoice.status = one[3] === 'sent' ? 'sent' : 'void';
      return { body: { code: 0, message: `Invoice status has been changed to ${one[3]}.` } };
    }
  }
  if (m === 'POST' && p === '/customerpayments') {
    return { status: 201, body: { code: 0, payment: { payment_id: `P${++books.seq}` } } };
  }
  return undefined;
}

let zoho: Awaited<ReturnType<typeof startJsonMock>>;

// --- Helpers --------------------------------------------------------------------------

function configure() {
  Object.assign(t.ctx.env, {
    ZOHO_CLIENT_ID: 'zoho-client',
    ZOHO_CLIENT_SECRET: 'zoho-client-secret',
    ZOHO_REFRESH_TOKEN: 'zoho-refresh-token',
    ZOHO_ORGANIZATION_ID: ZOHO_ORG,
    ZOHO_ACCOUNTS_URL: zoho.url,
    ZOHO_API_URL: `${zoho.url}/books/v3`,
    ZOHO_TAX_IDS: '810:TAX810, 0:TAX0',
  });
}

interface LineSpec {
  description: string;
  unitPrice: number;
  quantity?: number;
  taxRateBp?: number;
}

/** Finalized invoice issued by the seller of `orgId`, created without the routes (and their sync). */
async function finalizedInvoice(orgId: string, lines: LineSpec[]) {
  const org = (await t.db.query.organizations.findFirst({ where: eq(organizations.id, orgId) }))!;
  return t.db.transaction(async (tx) => {
    const draft = await createDraft(
      tx,
      org,
      {
        lines: lines.map((l) => ({
          description: l.description,
          quantity: l.quantity ?? 1,
          unit: null,
          unitPrice: l.unitPrice,
          taxRateBp: l.taxRateBp ?? 810,
          total: lineTotal(l.quantity ?? 1, l.unitPrice),
          serviceId: null,
          periodStart: null,
          periodEnd: null,
        })),
      },
      null,
    );
    return (await finalizeInTx(tx, draft.id, null)).invoice;
  });
}

async function invoiceRow(id: string) {
  return (await t.db.query.invoices.findFirst({ where: eq(invoices.id, id) }))!;
}

const calls = (method: string, pathEnd: string | RegExp) =>
  zoho.requests.filter(
    (r) =>
      r.method === method && (typeof pathEnd === 'string' ? r.path.endsWith(pathEnd) : pathEnd.test(r.path)),
  );

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 5000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(async () => {
  zoho = await startJsonMock(zohoRoute);
  t = await createTestApp();
  admin = new Client(t.app);
  await admin.login(ADMIN.email, ADMIN.password);
  const orgs = json<{ id: string; slug: string }[]>(await admin.get('/admin/orgs'));
  musterId = orgs.find((o) => o.slug === 'muster-ag')!.id;
  beispielId = orgs.find((o) => o.slug === 'beispiel-gmbh')!.id;
  anna = new Client(t.app);
  await anna.login('anna@muster.example');
  dev = new Client(t.app);
  await dev.login('dev@beispiel.example');
});

afterAll(async () => {
  await t?.close();
  await zoho?.close();
});

describe('without configuration', () => {
  it('does nothing and says so', async () => {
    expect(t.ctx.zoho.configured).toBe(false);
    expect(await t.ctx.zoho.status()).toEqual({
      configured: false,
      organizationId: null,
      lastError: null,
      lastSyncAt: null,
    });
    const invoice = await finalizedInvoice(beispielId, [{ description: 'Cloud Server S', unitPrice: 1900 }]);
    await t.ctx.zoho.syncInvoice(invoice.id);
    expect((await invoiceRow(invoice.id)).zohoStatus).toBeNull();
    expect(zoho.requests).toHaveLength(0);

    expect(json(await admin.post('/admin/integrations/zoho/test'))).toEqual({
      ok: false,
      error: 'Zoho Books is not configured',
    });
    expect((await admin.post('/admin/integrations/zoho/sync-pending')).statusCode).toBe(409);
    expect((await admin.post(`/invoices/${invoice.id}/zoho-sync`)).statusCode).toBe(409);
  });
});

describe('login', () => {
  beforeAll(configure);

  it('refreshes the access token once and reuses it', async () => {
    const res = await admin.post('/admin/integrations/zoho/test');
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res)).toEqual({ ok: true, organizationName: 'weblion.one GmbH' });

    const [token] = calls('POST', '/oauth/v2/token');
    expect(token!.body).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'zoho-refresh-token',
      client_id: 'zoho-client',
      client_secret: 'zoho-client-secret',
    });
    const [orgs] = calls('GET', '/organizations');
    expect(orgs!.headers.authorization).toBe('Zoho-oauthtoken token-1');
    expect(orgs!.query.get('organization_id')).toBe(ZOHO_ORG);

    await admin.post('/admin/integrations/zoho/test');
    expect(calls('POST', '/oauth/v2/token')).toHaveLength(1);
    expect(calls('GET', '/organizations').at(-1)!.headers.authorization).toBe('Zoho-oauthtoken token-1');
  });

  it('logs in again when Zoho rejects the token', async () => {
    books.validTokens.clear();
    expect(json(await admin.post('/admin/integrations/zoho/test')).ok).toBe(true);
    expect(calls('POST', '/oauth/v2/token')).toHaveLength(2);
    expect(calls('GET', '/organizations').at(-1)!.headers.authorization).toBe('Zoho-oauthtoken token-2');
  });

  it('refreshes tokens shortly before they expire', async () => {
    books.expiresIn = 30;
    try {
      const service = new ZohoService(t.db, t.ctx.env, t.ctx.log);
      const before = calls('POST', '/oauth/v2/token').length;
      expect((await service.testConnection()).ok).toBe(true);
      expect((await service.testConnection()).ok).toBe(true);
      expect(calls('POST', '/oauth/v2/token')).toHaveLength(before + 2);
    } finally {
      books.expiresIn = 3600;
    }
  });

  it('reports a failed login without secrets and remembers the error', async () => {
    books.tokenError = 'invalid_client';
    try {
      const service = new ZohoService(t.db, t.ctx.env, t.ctx.log);
      const result = await service.testConnection();
      expect(result).toEqual({ ok: false, error: 'Zoho login failed (invalid_client)' });
      expect((await t.ctx.zoho.status()).lastError).toBe('Zoho login failed (invalid_client)');
    } finally {
      books.tokenError = null;
    }
    const res = await admin.post('/admin/integrations/zoho/test');
    expect(res.body).not.toContain('zoho-client-secret');
    expect(await t.ctx.zoho.status()).toMatchObject({
      configured: true,
      organizationId: ZOHO_ORG,
      lastError: null,
    });
  });

  it('is for platform staff only', async () => {
    expect((await anna.post('/admin/integrations/zoho/test')).statusCode).toBe(403);
    expect((await anna.post('/admin/integrations/zoho/sync-pending')).statusCode).toBe(403);
  });
});

describe('invoices', () => {
  beforeAll(configure);
  beforeEach(() => {
    books.rounding = 'rate';
    books.invoiceError = null;
  });

  it('creates the contact and the invoice with our number, then marks it as sent', async () => {
    const invoice = await finalizedInvoice(beispielId, [
      { description: 'Cloud Server S', unitPrice: 1900 },
      { description: 'Einrichtung', unitPrice: 4900, quantity: 0.5, taxRateBp: 0 },
    ]);
    await t.ctx.zoho.syncInvoice(invoice.id);

    const [contact] = calls('POST', '/books/v3/contacts');
    expect(contact!.body).toEqual({
      contact_name: 'Beispiel GmbH',
      company_name: 'Beispiel GmbH',
      contact_type: 'customer',
      currency_id: 'CUR-CHF',
      billing_address: { country: 'Schweiz' },
    });
    const profile = await t.db.query.billingProfiles.findFirst({
      where: eq(billingProfiles.orgId, beispielId),
    });
    expect(profile).toMatchObject({ zohoContactId: 'C1', currency: 'CHF', paymentTermsDays: 30 });

    const [created] = calls('POST', '/books/v3/invoices');
    expect(created!.query.get('ignore_auto_number_generation')).toBe('true');
    expect(created!.body).toEqual({
      customer_id: 'C1',
      invoice_number: invoice.number,
      date: invoice.issueDate,
      due_date: invoice.dueDate,
      is_inclusive_tax: false,
      line_items: [
        { name: 'Cloud Server S', rate: 19, quantity: 1, tax_id: 'TAX810' },
        { name: 'Einrichtung', rate: 49, quantity: 0.5, tax_id: 'TAX0' },
      ],
    });
    const zohoId = (await invoiceRow(invoice.id)).zohoInvoiceId!;
    expect(books.invoices.get(zohoId)).toMatchObject({ status: 'sent', total: invoice.total / 100 });
    expect(await invoiceRow(invoice.id)).toMatchObject({ zohoStatus: 'synced', zohoError: null });
    expect((await t.ctx.zoho.status()).lastSyncAt).not.toBeNull();

    // The next invoice reuses the stored contact without asking Zoho.
    const second = await finalizedInvoice(beispielId, [{ description: 'Cloud Server S', unitPrice: 1900 }]);
    await t.ctx.zoho.syncInvoice(second.id);
    expect(calls('POST', '/books/v3/contacts')).toHaveLength(1);
    expect(calls('GET', '/books/v3/contacts')).toHaveLength(0);
    expect(calls('POST', '/books/v3/invoices').at(-1)!.body.customer_id).toBe('C1');
  });

  it('never adopts a Zoho contact by its name and pushes payments on the invoice', async () => {
    // Somebody else's contact with the same name: names are free input, so it is not ours.
    books.contacts.push({ contact_id: 'C-EXISTING', contact_name: 'Muster AG' });
    const [paid] = await t.db
      .select()
      .from(invoices)
      .where(and(eq(invoices.orgId, musterId), eq(invoices.status, 'paid')));
    await t.ctx.zoho.syncInvoice(paid!.id);

    const attempts = calls('POST', '/books/v3/contacts').slice(1);
    expect(attempts.map((r) => r.body.contact_name)).toEqual(['Muster AG', 'Muster AG (muster-ag)']);
    const own = books.contacts.find((c) => c.contact_name === 'Muster AG (muster-ag)')!;
    expect(own.contact_id).not.toBe('C-EXISTING');
    expect(calls('POST', '/books/v3/invoices').at(-1)!.body.customer_id).toBe(own.contact_id);
    expect(calls('GET', '/books/v3/contacts')).toHaveLength(0);
    const profile = await t.db.query.billingProfiles.findFirst({
      where: eq(billingProfiles.orgId, musterId),
    });
    expect(profile?.zohoContactId).toBe(own.contact_id);

    const [payment] = await t.db.select().from(payments).where(eq(payments.invoiceId, paid!.id));
    const [pushed] = calls('POST', '/customerpayments');
    expect(pushed!.body).toEqual({
      customer_id: own.contact_id,
      payment_mode: 'banktransfer',
      amount: paid!.total / 100,
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      reference_number: 'Zahlung via E-Banking',
      description: `Banküberweisung, weblion.one ${payment!.id}`,
      invoices: [
        { invoice_id: (await invoiceRow(paid!.id)).zohoInvoiceId, amount_applied: paid!.total / 100 },
      ],
    });
    expect(
      (await t.db.query.payments.findFirst({ where: eq(payments.id, payment!.id) }))?.zohoPaymentId,
    ).toMatch(/^P\d+$/);
  });

  it('pushes a payment once, also when asked twice at the same time', async () => {
    const invoice = await finalizedInvoice(beispielId, [{ description: 'Webhosting', unitPrice: 990 }]);
    await Promise.all([t.ctx.zoho.syncInvoice(invoice.id), t.ctx.zoho.syncInvoice(invoice.id)]);
    expect(
      calls('POST', '/books/v3/invoices').filter((r) => r.body.invoice_number === invoice.number),
    ).toHaveLength(1);

    const { payment } = await t.db.transaction((tx) =>
      markPaidInTx(tx, invoice.id, { amount: 500, method: 'cash' }, null),
    );
    const before = calls('POST', '/customerpayments').length;
    await Promise.all([t.ctx.zoho.syncPayment(payment.id), t.ctx.zoho.syncPayment(payment.id)]);
    await t.ctx.zoho.syncPayment(payment.id);
    expect(calls('POST', '/customerpayments')).toHaveLength(before + 1);
    expect(calls('POST', '/customerpayments').at(-1)!.body).toMatchObject({
      payment_mode: 'cash',
      amount: 5,
    });
  });

  it('stores errors on the invoice instead of throwing, and retries them', async () => {
    books.invoiceError = { status: 400, body: { code: 1001, message: 'Invoice number already exists.' } };
    const failing = await finalizedInvoice(beispielId, [{ description: 'Cloud Server M', unitPrice: 3900 }]);
    await expect(t.ctx.zoho.syncInvoice(failing.id)).resolves.toBeUndefined();
    expect(await invoiceRow(failing.id)).toMatchObject({
      zohoStatus: 'error',
      zohoError: 'Invoice number already exists. (code 1001)',
      zohoInvoiceId: null,
    });
    expect((await t.ctx.zoho.status()).lastError).toBe('Invoice number already exists. (code 1001)');
    const other = await finalizedInvoice(beispielId, [{ description: 'Cloud Server M', unitPrice: 3900 }]);
    await t.ctx.zoho.syncInvoice(other.id);
    books.invoiceError = null;

    // Manual retry of one invoice, then everything else that is still pending.
    expect((await dev.post(`/invoices/${failing.id}/zoho-sync`)).statusCode).toBe(403);
    const res = await admin.post(`/invoices/${failing.id}/zoho-sync`);
    expect(res.statusCode, res.body).toBe(200);
    const dto = json<InvoiceDto>(res);
    expect(dto.zoho).toMatchObject({ status: 'synced', error: null });
    expect(dto.zoho!.invoiceId).toMatch(/^I\d+$/);
    expect((await t.ctx.zoho.status()).lastError).toBeNull();

    expect(json(await admin.post('/admin/integrations/zoho/sync-pending'))).toEqual({ synced: 1, failed: 0 });
    expect((await invoiceRow(other.id)).zohoStatus).toBe('synced');
    const audit = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'invoice.zoho_sync'));
    expect(audit.map((a) => a.resourceId)).toEqual([failing.id]);
  });

  it('refuses rates without a Zoho tax id before creating anything', async () => {
    const before = zoho.requests.length;
    const invoice = await finalizedInvoice(beispielId, [
      { description: 'Alter Satz', unitPrice: 1000, taxRateBp: 770 },
    ]);
    await t.ctx.zoho.syncInvoice(invoice.id);
    expect(await invoiceRow(invoice.id)).toMatchObject({
      zohoStatus: 'error',
      zohoError: 'No Zoho tax id configured for 7.7 % (ZOHO_TAX_IDS)',
    });
    expect(zoho.requests.length).toBe(before);
  });

  it('puts a rounding difference into the adjustment', async () => {
    books.rounding = 'line';
    // Per line 3 x round(8.586) = 27, on the sum round(25.758) = 26.
    const invoice = await finalizedInvoice(
      beispielId,
      [1, 2, 3].map((n) => ({ description: `Position ${n}`, unitPrice: 106 })),
    );
    expect(invoice.total).toBe(344);
    await t.ctx.zoho.syncInvoice(invoice.id);
    const zohoId = (await invoiceRow(invoice.id)).zohoInvoiceId!;
    const update = calls('PUT', `/invoices/${zohoId}`);
    expect(update).toHaveLength(1);
    expect(update[0]!.body).toMatchObject({ adjustment: -0.01, adjustment_description: 'Rundungsdifferenz' });
    expect(books.invoices.get(zohoId)!.status).toBe('sent');
    expect(books.invoices.get(zohoId)!.total).toBeCloseTo(3.44, 6);
    expect((await invoiceRow(invoice.id)).zohoStatus).toBe('synced');
  });

  it('keeps a draft with a wrong tax mapping unsent until it is fixed', async () => {
    t.ctx.env.ZOHO_TAX_IDS = '810:TAX810,0:TAX810';
    const invoice = await finalizedInvoice(beispielId, [
      { description: 'Export', unitPrice: 10000, taxRateBp: 0 },
    ]);
    await t.ctx.zoho.syncInvoice(invoice.id);
    const row = await invoiceRow(invoice.id);
    expect(row.zohoStatus).toBe('error');
    expect(row.zohoError).toBe('Zoho Books computed a total of 108.10 instead of 100.00, check ZOHO_TAX_IDS');
    expect(books.invoices.get(row.zohoInvoiceId!)!.status).toBe('draft');

    t.ctx.env.ZOHO_TAX_IDS = '810:TAX810,0:TAX0';
    await t.ctx.zoho.syncInvoice(invoice.id);
    expect((await invoiceRow(invoice.id)).zohoStatus).toBe('synced');
    expect(books.invoices.get(row.zohoInvoiceId!)).toMatchObject({ status: 'sent', total: 100 });
    // No second invoice was created.
    expect(
      calls('POST', '/books/v3/invoices').filter((r) => r.body.invoice_number === invoice.number),
    ).toHaveLength(1);
  });

  it('voids invoices in Zoho and skips what never got there', async () => {
    const synced = await finalizedInvoice(beispielId, [{ description: 'Storno', unitPrice: 2500 }]);
    await t.ctx.zoho.syncInvoice(synced.id);
    const zohoId = (await invoiceRow(synced.id)).zohoInvoiceId!;
    const res = await admin.post(`/invoices/${synced.id}/void`, { reason: 'Doppelt verrechnet' });
    expect(res.statusCode, res.body).toBe(200);
    await waitFor(async () => books.invoices.get(zohoId)!.status === 'void');
    await waitFor(async () => (await invoiceRow(synced.id)).zohoStatus === 'synced');
    await t.ctx.zoho.voidInvoice(synced.id);
    expect(calls('POST', `/invoices/${zohoId}/status/void`)).toHaveLength(1);

    const never = await finalizedInvoice(beispielId, [{ description: 'Storno', unitPrice: 2500 }]);
    await t.db
      .update(invoices)
      .set({ status: 'void', voidedAt: new Date() })
      .where(eq(invoices.id, never.id));
    const before = zoho.requests.length;
    await t.ctx.zoho.voidInvoice(never.id);
    expect(await invoiceRow(never.id)).toMatchObject({ zohoStatus: 'skipped', zohoInvoiceId: null });
    expect(zoho.requests.length).toBe(before);
  });

  it('skips invoices of resellers', async () => {
    const [reseller] = await t.db
      .insert(organizations)
      .values({
        name: 'Zoho Reseller',
        slug: 'zoho-reseller',
        kind: 'reseller',
        boundary: DEFAULT_RESELLER_BOUNDARY,
      })
      .returning();
    const [customer] = await t.db
      .insert(organizations)
      .values({
        name: 'Zoho Kunde',
        slug: 'zoho-kunde',
        kind: 'customer',
        boundary: DEFAULT_CUSTOMER_BOUNDARY,
        parentOrgId: reseller!.id,
      })
      .returning();
    const invoice = await finalizedInvoice(customer!.id, [{ description: 'Wartung', unitPrice: 4500 }]);
    expect(invoice.issuerOrgId).toBe(reseller!.id);
    const before = zoho.requests.length;
    await t.ctx.zoho.syncInvoice(invoice.id);
    expect((await invoiceRow(invoice.id)).zohoStatus).toBe('skipped');
    expect(zoho.requests.length).toBe(before);
    expect((await admin.post(`/invoices/${invoice.id}/zoho-sync`)).statusCode).toBe(409);
  });
});
