import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, isNull, like } from 'drizzle-orm';
import { isQRReferenceValid } from 'swissqrbill/utils';
import {
  DEFAULT_CUSTOMER_BOUNDARY,
  DEFAULT_RESELLER_BOUNDARY,
  invoiceTotals,
  type BillingSettingsDto,
  type CreditTransactionDto,
  type InvoiceDetailDto,
  type InvoiceDto,
  type Paginated,
  type ProductDto,
  type ServiceDto,
} from '@weblion/shared';
import {
  invoiceLines,
  invoices,
  memberships,
  organizations,
  payments,
  projects,
  servers,
  services as servicesTable,
  settings,
  users,
} from '../src/db/schema';
import { hashPassword } from '../src/lib/crypto';
import { payFromCredit, creditBalance } from '../src/modules/billing/ledger';
import { addMonths, nextBillingDate, todayZurich } from '../src/modules/billing/dates';
import { mod10CheckDigit, qrReference } from '../src/modules/billing/pdf';
import { BillingJob } from '../src/modules/billing/recurring';
import { ADMIN, Client, createTestApp, DEMO_PASSWORD, json, type TestApp } from './helpers';

let t: TestApp;
let admin: Client;
let anna: Client;
let dev: Client;
let carla: Client;
let rita: Client;
let kurt: Client;
let musterId: string;
let beispielId: string;
let resellerId: string;
let kundeId: string;
let platformProducts: ProductDto[];

const year = todayZurich().slice(0, 4);
const line = (description: string, unitPrice: number, extra: Record<string, unknown> = {}) => ({
  description,
  quantity: 1,
  unitPrice,
  ...extra,
});

/** Number of pages in a PDF made by pdfkit (page objects are written uncompressed). */
const pageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;

async function draft(client: Client, orgId: string, lines: unknown[], extra: Record<string, unknown> = {}) {
  const res = await client.post(`/billing/customers/${orgId}/invoices`, { lines, ...extra });
  expect(res.statusCode, res.body).toBe(200);
  return json<InvoiceDetailDto>(res);
}

async function finalized(
  client: Client,
  orgId: string,
  lines: unknown[],
  extra: Record<string, unknown> = {},
) {
  const d = await draft(client, orgId, lines, extra);
  const res = await client.post(`/invoices/${d.id}/finalize`, { send: false });
  expect(res.statusCode, res.body).toBe(200);
  return json<InvoiceDetailDto>(res);
}

beforeAll(async () => {
  t = await createTestApp();
  admin = new Client(t.app);
  await admin.login(ADMIN.email, ADMIN.password);
  const orgs = json<{ id: string; slug: string }[]>(await admin.get('/admin/orgs'));
  musterId = orgs.find((o) => o.slug === 'muster-ag')!.id;
  beispielId = orgs.find((o) => o.slug === 'beispiel-gmbh')!.id;

  // A reseller with one customer of its own, independent of the reseller demo seed.
  const hash = await hashPassword(DEMO_PASSWORD);
  const [reseller] = await t.db
    .insert(organizations)
    .values({
      name: 'Test Reseller AG',
      slug: 'test-reseller',
      kind: 'reseller',
      boundary: DEFAULT_RESELLER_BOUNDARY,
      modules: ['servers', 'dns'],
    })
    .returning();
  const [kunde] = await t.db
    .insert(organizations)
    .values({
      name: 'Test Kunde GmbH',
      slug: 'test-kunde',
      kind: 'customer',
      boundary: DEFAULT_CUSTOMER_BOUNDARY,
      parentOrgId: reseller!.id,
      modules: ['servers'],
    })
    .returning();
  resellerId = reseller!.id;
  kundeId = kunde!.id;
  const [ritaUser, kurtUser] = await t.db
    .insert(users)
    .values([
      { email: 'rita@reseller.example', name: 'Rita Reseller', passwordHash: hash },
      { email: 'kurt@kunde.example', name: 'Kurt Kunde', passwordHash: hash },
    ])
    .returning();
  await t.db.insert(memberships).values([
    { orgId: resellerId, userId: ritaUser!.id, role: 'owner' },
    { orgId: kundeId, userId: kurtUser!.id, role: 'owner' },
  ]);

  anna = new Client(t.app);
  await anna.login('anna@muster.example');
  dev = new Client(t.app);
  await dev.login('dev@beispiel.example');
  carla = new Client(t.app);
  await carla.login('carla@muster.example');
  rita = new Client(t.app);
  await rita.login('rita@reseller.example');
  kurt = new Client(t.app);
  await kurt.login('kurt@kunde.example');

  platformProducts = json<ProductDto[]>(await admin.get('/billing/products?owner=platform'));
});

afterAll(async () => {
  vi.restoreAllMocks();
  await t?.close();
});

describe('seed', () => {
  it('creates the platform catalog and demo invoices for Muster AG', async () => {
    expect(platformProducts.map((p) => p.name).sort()).toEqual([
      'Cloud Server M',
      'Cloud Server S',
      'Domain .ch',
      'Einrichtung',
      'Webhosting Basic',
    ]);
    const list = json<Paginated<InvoiceDto>>(await anna.get(`/orgs/${musterId}/invoices`));
    expect(list.items.map((i) => i.status).sort()).toEqual(['open', 'paid']);
    const credit = json<{ balance: number; items: CreditTransactionDto[] }>(
      await anna.get(`/orgs/${musterId}/credit`),
    );
    expect(credit.balance).toBe(5000);
    expect(credit.items[0]!.balanceAfter).toBe(5000);
    const services = json<ServiceDto[]>(await anna.get(`/orgs/${musterId}/services`));
    expect(services.find((s) => s.resource?.type === 'server')?.resource?.name).toBe('web-01');
  });
});

describe('totals and tax', () => {
  it('rounds tax per rate on the summed net amount, not per line', () => {
    const lines = [
      { quantity: 1, unitPrice: 1005, taxRateBp: 810 },
      { quantity: 1, unitPrice: 1005, taxRateBp: 810 },
      { quantity: 0.5, unitPrice: 999, taxRateBp: 0 },
    ];
    // Per line it would be 81 + 81 = 162, on the sum 2010 * 8.1 % = 162.81 -> 163.
    expect(invoiceTotals(lines)).toEqual({
      subtotal: 2010 + 500,
      taxTotal: 163,
      total: 2673,
      breakdown: [
        { rateBp: 810, net: 2010, tax: 163 },
        { rateBp: 0, net: 500, tax: 0 },
      ],
    });
  });

  it('recomputes totals on the server and fills in default tax rates', async () => {
    const d = await draft(admin, beispielId, [
      { ...line('A', 1005), total: 1, taxRateBp: 810 },
      line('B', 1005),
      line('C', 999, { quantity: 1.5, taxRateBp: 0 }),
    ]);
    // 1.5 * 999 = 1498.5 rounds to 1499; B gets the issuer default (8.1 %).
    expect(d.lines.map((l) => [l.total, l.taxRateBp])).toEqual([
      [1005, 810],
      [1005, 810],
      [1499, 0],
    ]);
    expect([d.subtotal, d.taxTotal, d.total]).toEqual([3509, 163, 3672]);
    expect(d.status).toBe('draft');
    expect(d.number).toBeNull();

    // A customer specific rate (e.g. abroad, 0 %) wins over the issuer default.
    await admin.request('PUT', `/billing/customers/${beispielId}/profile`, {
      companyName: 'Beispiel GmbH',
      country: 'DE',
      taxRateBp: 0,
    });
    const abroad = await draft(admin, beispielId, [line('Export', 10000)]);
    expect([abroad.lines[0]!.taxRateBp, abroad.taxTotal]).toEqual([0, 0]);
    await admin.request('PUT', `/billing/customers/${beispielId}/profile`, {
      companyName: 'Beispiel GmbH',
      country: 'CH',
      taxRateBp: null,
    });
    await admin.del(`/invoices/${abroad.id}`);
    await admin.del(`/invoices/${d.id}`);
  });

  it('validates line input', async () => {
    expect((await admin.post(`/billing/customers/${beispielId}/invoices`, { lines: [] })).statusCode).toBe(
      400,
    );
    expect(
      (await admin.post(`/billing/customers/${beispielId}/invoices`, { lines: [line('x', 10.5)] }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await admin.post(`/billing/customers/${beispielId}/invoices`, {
          lines: [line('x', 100, { serviceId: '00000000-0000-4000-8000-000000000000' })],
        })
      ).statusCode,
    ).toBe(400);
  });
});

describe('invoice numbers', () => {
  it('are gapless per issuer and year, and deleting drafts burns none', async () => {
    const thrownAway = await draft(admin, beispielId, [line('Wird gelöscht', 100)]);
    const a = await draft(admin, beispielId, [line('A', 100)]);
    expect((await admin.del(`/invoices/${thrownAway.id}`)).statusCode).toBe(200);
    const first = json<InvoiceDetailDto>(await admin.post(`/invoices/${a.id}/finalize`, { send: false }));
    const second = await finalized(admin, musterId, [line('B', 100)]);
    const n1 = Number(first.number!.split('-')[2]);
    expect(first.number).toMatch(new RegExp(`^WL-${year}-\\d{5}$`));
    expect(second.number).toBe(`WL-${year}-${String(n1 + 1).padStart(5, '0')}`);

    // The year comes from the issue date and has its own counter.
    const old = await finalized(admin, beispielId, [line('Alt', 100)], { issueDate: '2025-12-31' });
    expect(old.number).toBe('WL-2025-00001');
    expect(old.dueDate).toBe('2026-01-30');

    const numbers = (
      await t.db
        .select({ number: invoices.number })
        .from(invoices)
        .where(and(isNull(invoices.issuerOrgId), like(invoices.number, `WL-${year}-%`)))
    )
      .map((r) => Number(r.number!.split('-')[2]))
      .sort((x, y) => x - y);
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it('stay unique when two finalize requests race', async () => {
    const [a, b] = await Promise.all([
      draft(admin, beispielId, [line('Race A', 100)]),
      draft(admin, beispielId, [line('Race B', 100)]),
    ]);
    const results = await Promise.all([
      admin.post(`/invoices/${a.id}/finalize`, { send: false }),
      admin.post(`/invoices/${b.id}/finalize`, { send: false }),
      admin.post(`/invoices/${a.id}/finalize`, { send: false }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 200, 409]);
    const nums = results.filter((r) => r.statusCode === 200).map((r) => json<InvoiceDetailDto>(r).number);
    expect(new Set(nums).size).toBe(2);
  });
});

describe('invoice lifecycle', () => {
  it('finalizes, voids and books manual payments with the right conflicts', async () => {
    const d = await draft(admin, beispielId, [line('Beratung', 10000)], { notes: 'Danke!' });
    expect(d.can).toMatchObject({ edit: true, finalize: true, void: false });
    const patched = json<InvoiceDetailDto>(
      await admin.patch(`/invoices/${d.id}`, { lines: [line('Beratung', 20000)] }),
    );
    expect([patched.total, patched.notes]).toEqual([21620, 'Danke!']);

    const open = json<InvoiceDetailDto>(await admin.post(`/invoices/${d.id}/finalize`, { send: false }));
    expect(open.status).toBe('open');
    expect(open.issueDate).toBe(todayZurich());
    expect(open.billingAddress?.companyName).toBe('Beispiel GmbH');
    expect(open.can).toMatchObject({ edit: false, void: true, markPaid: true, send: true });
    expect((await admin.post(`/invoices/${d.id}/finalize`, {})).statusCode).toBe(409);
    expect((await admin.patch(`/invoices/${d.id}`, { notes: 'x' })).statusCode).toBe(409);
    expect((await admin.del(`/invoices/${d.id}`)).statusCode).toBe(409);

    // Partial payment, then void is no longer possible.
    let res = await admin.post(`/invoices/${d.id}/mark-paid`, { amount: 1620, method: 'bank_transfer' });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<InvoiceDetailDto>(res)).toMatchObject({ status: 'open', amountPaid: 1620, amountDue: 20000 });
    expect((await admin.post(`/invoices/${d.id}/void`, { reason: 'Fehler' })).statusCode).toBe(409);
    expect(
      (await admin.post(`/invoices/${d.id}/mark-paid`, { amount: 20001, method: 'cash' })).statusCode,
    ).toBe(409);
    res = await admin.post(`/invoices/${d.id}/mark-paid`, { method: 'cash', reference: 'Quittung 7' });
    const paid = json<InvoiceDetailDto>(res);
    expect([paid.status, paid.amountDue, paid.payments.length]).toEqual(['paid', 0, 2]);
    expect(paid.payments.every((p) => p.provider === 'manual' && p.status === 'succeeded')).toBe(true);
    expect((await admin.post(`/invoices/${d.id}/mark-paid`, { method: 'cash' })).statusCode).toBe(409);

    // Void an untouched open invoice.
    const other = await finalized(admin, beispielId, [line('Storno', 5000)]);
    const voided = json<InvoiceDetailDto>(
      await admin.post(`/invoices/${other.id}/void`, { reason: 'Doppelt' }),
    );
    expect([voided.status, voided.amountDue]).toEqual(['void', 0]);
    expect((await admin.post(`/invoices/${other.id}/void`, { reason: 'nochmals' })).statusCode).toBe(409);
    expect((await admin.post(`/invoices/${other.id}/mark-paid`, { method: 'cash' })).statusCode).toBe(409);
  });

  it('refuses to finalize an invoice without lines and pays a zero total at once', async () => {
    const [empty] = await t.db
      .insert(invoices)
      .values({ orgId: beispielId, status: 'draft', currency: 'CHF' })
      .returning();
    expect((await admin.post(`/invoices/${empty!.id}/finalize`, {})).statusCode).toBe(409);
    await admin.del(`/invoices/${empty!.id}`);

    const free = await finalized(admin, beispielId, [line('Gratis', 0)]);
    expect([free.status, free.number !== null]).toEqual(['paid', true]);
  });

  it('applies credit on finalize and emails the invoice with the PDF', async () => {
    const send = vi.spyOn(t.ctx.mail, 'send').mockResolvedValue({ status: 'sent' });
    const sync = vi.spyOn(t.ctx.zoho, 'syncInvoice').mockRejectedValue(new Error('zoho down'));
    try {
      await admin.post(`/billing/customers/${beispielId}/credit`, {
        amount: 1000,
        type: 'topup',
        description: 'Vorauszahlung',
      });
      const d = await draft(admin, beispielId, [line('Hosting', 5000)]);
      const res = await admin.post(`/invoices/${d.id}/finalize`, { send: true });
      expect(res.statusCode, res.body).toBe(200);
      const inv = json<InvoiceDetailDto>(res);
      expect(inv).toMatchObject({ status: 'open', amountPaid: 1000, amountDue: 4405 });
      expect(inv.payments[0]).toMatchObject({ provider: 'credit', method: 'credit', amount: 1000 });
      expect(inv.sentAt).not.toBeNull();
      expect(sync).toHaveBeenCalledWith(d.id);

      const [template, data, options] = send.mock.calls.at(-1)!;
      expect(template).toBe('invoice');
      expect(data).toMatchObject({ invoiceNumber: inv.number, orgName: 'Beispiel GmbH', paid: false });
      expect(options.to).toEqual(['dev@beispiel.example']);
      expect(options.attachments?.[0]?.content.subarray(0, 4).toString()).toBe('%PDF');

      const credit = json<{ balance: number; items: CreditTransactionDto[] }>(
        await dev.get(`/orgs/${beispielId}/credit`),
      );
      expect(credit.balance).toBe(0);
      expect(credit.items[0]).toMatchObject({ type: 'invoice_payment', amount: -1000, balanceAfter: 0 });
    } finally {
      send.mockRestore();
      sync.mockRestore();
    }
  });
});

describe('credit', () => {
  it('can never go below zero', async () => {
    const book = (amount: number, type = 'adjustment') =>
      admin.post(`/billing/customers/${beispielId}/credit`, { amount, type, description: 'Test' });
    const before = await creditBalance(t.db, beispielId);
    expect((await book(0)).statusCode).toBe(400);
    expect((await book(-100, 'topup')).statusCode).toBe(400);
    expect((await book(-(before + 1))).statusCode).toBe(409);
    const booked = json<CreditTransactionDto>(await book(1000, 'topup'));
    expect(booked.balanceAfter).toBe(before + 1000);

    // Two withdrawals racing for the same credit: only one goes through.
    const results = await Promise.all([book(-(before + 700)), book(-(before + 700))]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await creditBalance(t.db, beispielId)).toBe(300);
  });

  it('is spent only once when two credit payments race', async () => {
    // Finalize with no credit, then add some, then pay twice at the same time.
    const balance = await creditBalance(t.db, beispielId);
    if (balance > 0) {
      await admin.post(`/billing/customers/${beispielId}/credit`, {
        amount: -balance,
        type: 'adjustment',
        description: 'Reset',
      });
    }
    const inv = await finalized(admin, beispielId, [line('Teuer', 10000)]);
    await admin.post(`/billing/customers/${beispielId}/credit`, {
      amount: 3000,
      type: 'topup',
      description: 'Teilzahlung',
    });
    const results = await Promise.allSettled([
      t.db.transaction((tx) => payFromCredit(tx, inv.id, null)),
      t.db.transaction((tx) => payFromCredit(tx, inv.id, null)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await creditBalance(t.db, beispielId)).toBe(0);
    const [row] = await t.db.select().from(invoices).where(eq(invoices.id, inv.id));
    expect(row!.amountPaid).toBe(3000);
    const creditPayments = await t.db
      .select()
      .from(payments)
      .where(and(eq(payments.invoiceId, inv.id), eq(payments.provider, 'credit')));
    expect(creditPayments).toHaveLength(1);
  });
});

describe('visibility', () => {
  it('never shows drafts to customers and hides other organizations', async () => {
    const d = await draft(admin, musterId, [line('Entwurf', 100)]);
    expect((await anna.get(`/invoices/${d.id}`)).statusCode).toBe(404);
    expect((await anna.get(`/invoices/${d.id}/pdf`)).statusCode).toBe(404);
    const list = json<Paginated<InvoiceDto>>(await anna.get(`/orgs/${musterId}/invoices?perPage=200`));
    expect(list.items.some((i) => i.id === d.id || i.status === 'draft')).toBe(false);
    expect(list.items.every((i) => i.zoho === null)).toBe(true);

    const open = list.items.find((i) => i.status === 'open')!;
    expect((await anna.get(`/invoices/${open.id}`)).statusCode).toBe(200);
    // Customers can look, but not act as the issuer.
    expect((await anna.post(`/invoices/${open.id}/void`, { reason: 'x' })).statusCode).toBe(403);
    expect((await anna.get(`/billing/customers/${musterId}`)).statusCode).toBe(404);

    // Other customers and members without billing:read.
    expect((await dev.get(`/invoices/${open.id}`)).statusCode).toBe(404);
    expect((await dev.get(`/orgs/${musterId}/invoices`)).statusCode).toBe(404);
    expect((await carla.get(`/orgs/${musterId}/invoices`)).statusCode).toBe(403);
    expect((await carla.get(`/invoices/${open.id}`)).statusCode).toBe(404);
    expect((await rita.get(`/invoices/${open.id}`)).statusCode).toBe(404);
    await admin.del(`/invoices/${d.id}`);
  });

  it('lets customers edit their address but not their terms', async () => {
    const res = await anna.request('PUT', `/orgs/${musterId}/billing/profile`, {
      companyName: 'Muster AG',
      line1: 'Neue Strasse 1',
      postalCode: '8002',
      city: 'Zürich',
      email: 'rechnungen@muster.example',
      currency: 'EUR',
      paymentTermsDays: 365,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res)).toMatchObject({ line1: 'Neue Strasse 1', currency: 'CHF', paymentTermsDays: 30 });
    // Changing the currency while credit exists would strand the credit.
    const seller = await admin.request('PUT', `/billing/customers/${musterId}/profile`, {
      companyName: 'Muster AG',
      currency: 'EUR',
    });
    expect(seller.statusCode).toBe(409);
  });
});

describe('resellers', () => {
  it('bill only their own customers, from their own catalog, as the issuer', async () => {
    expect((await rita.get(`/billing/customers/${kundeId}`)).statusCode).toBe(200);
    expect((await rita.get(`/billing/customers/${musterId}`)).statusCode).toBe(404);
    expect(
      (await rita.post(`/billing/customers/${musterId}/invoices`, { lines: [line('x', 1)] })).statusCode,
    ).toBe(404);
    expect((await kurt.get(`/billing/customers/${kundeId}`)).statusCode).toBe(404);

    const issuer = await rita.request('PUT', `/orgs/${resellerId}/reseller/issuer`, {
      name: 'Test Reseller AG',
      line1: 'Marktgasse 5',
      postalCode: '3011',
      city: 'Bern',
      country: 'CH',
      iban: 'CH93 0076 2011 6238 5295 7',
      invoicePrefix: 'rs',
      defaultTaxRateBp: 810,
      defaultCurrency: 'CHF',
      defaultPaymentTermsDays: 10,
    });
    expect(issuer.statusCode, issuer.body).toBe(200);
    expect(json(issuer)).toMatchObject({ invoicePrefix: 'RS', iban: 'CH9300762011623852957' });
    expect((await dev.get(`/orgs/${resellerId}/reseller/issuer`)).statusCode).toBe(404);
    expect((await rita.get(`/orgs/${musterId}/reseller/issuer`)).statusCode).toBe(404);

    // Products: own catalog yes, platform catalog no; platform products can't be sold by resellers.
    expect(
      (await rita.post('/billing/products', { ownerOrgId: null, name: 'x', unitPrice: 1, interval: 'once' }))
        .statusCode,
    ).toBe(403);
    const product = json<ProductDto>(
      await rita.post('/billing/products', {
        ownerOrgId: resellerId,
        name: 'Pflege',
        unitPrice: 2500,
        interval: 'monthly',
      }),
    );
    expect(product).toMatchObject({ ownerOrgId: resellerId, currency: 'CHF', active: true });
    expect(json<ProductDto[]>(await rita.get(`/billing/products?owner=${resellerId}`))).toHaveLength(1);
    expect((await dev.get(`/billing/products?owner=${resellerId}`)).statusCode).toBe(404);
    const platformProduct = platformProducts.find((p) => p.name === 'Cloud Server S')!;
    expect(
      (await rita.post(`/billing/customers/${kundeId}/services`, { productId: platformProduct.id }))
        .statusCode,
    ).toBe(400);
    const service = json<ServiceDto>(
      await rita.post(`/billing/customers/${kundeId}/services`, { productId: product.id }),
    );
    expect(service).toMatchObject({ name: 'Pflege', unitPrice: 2500, interval: 'monthly' });

    const zoho = vi.spyOn(t.ctx.zoho, 'syncInvoice');
    const inv = await finalized(rita, kundeId, [line('Pflege Oktober', 2500, { serviceId: service.id })]);
    expect(inv.issuer).toEqual({ orgId: resellerId, name: 'Test Reseller AG' });
    expect(inv.number).toBe(`RS-${year}-00001`);
    expect(inv.zoho).toBeNull();
    expect(zoho).not.toHaveBeenCalled();
    zoho.mockRestore();

    const seen = json<InvoiceDetailDto>(await kurt.get(`/invoices/${inv.id}`));
    expect(seen.issuer.name).toBe('Test Reseller AG');
    expect(seen.can).toMatchObject({ void: false, markPaid: false });
    expect(seen.payMethods).toEqual([]);
    const summary = json(await kurt.get(`/orgs/${kundeId}/billing/summary`));
    expect(summary).toMatchObject({ seller: { orgId: resellerId, name: 'Test Reseller AG' }, openCount: 1 });

    // Rita works on her customer's invoice, platform staff can read it too.
    expect((await rita.post(`/invoices/${inv.id}/mark-paid`, { method: 'bank_transfer' })).statusCode).toBe(
      200,
    );
    expect((await admin.get(`/invoices/${inv.id}`)).statusCode).toBe(200);
    const all = json<Paginated<InvoiceDto>>(await admin.get('/admin/billing/invoices?issuer=reseller'));
    expect(all.items.some((i) => i.id === inv.id)).toBe(true);
    const platformOnly = json<Paginated<InvoiceDto>>(
      await admin.get('/admin/billing/invoices?issuer=platform'),
    );
    expect(platformOnly.items.some((i) => i.id === inv.id)).toBe(false);
  });
});

describe('services and modules', () => {
  it('activates and deactivates modules through services', async () => {
    await t.db
      .update(organizations)
      .set({ modules: ['servers'] })
      .where(eq(organizations.id, beispielId));
    const domainProduct = platformProducts.find((p) => p.module === 'dns')!;
    const webProduct = platformProducts.find((p) => p.module === 'webhosting')!;
    const created = json<ServiceDto>(
      await admin.post(`/billing/customers/${beispielId}/services`, { productId: domainProduct.id }),
    );
    expect(created).toMatchObject({ module: 'dns', interval: 'yearly', unitPrice: 1800, status: 'active' });
    let org = await t.db.query.organizations.findFirst({ where: eq(organizations.id, beispielId) });
    expect(org!.modules).toEqual(['servers', 'dns']);

    await admin.post(`/billing/customers/${beispielId}/services`, {
      productId: webProduct.id,
      activateModule: false,
    });
    org = await t.db.query.organizations.findFirst({ where: eq(organizations.id, beispielId) });
    expect(org!.modules).toEqual(['servers', 'dns']);

    const cancelled = json<ServiceDto>(
      await admin.post(`/services/${created.id}/cancel`, { deactivateModule: true }),
    );
    expect([cancelled.status, cancelled.nextBillingAt]).toEqual(['cancelled', null]);
    org = await t.db.query.organizations.findFirst({ where: eq(organizations.id, beispielId) });
    expect(org!.modules).toEqual(['servers']);
    expect((await admin.post(`/services/${created.id}/cancel`, {})).statusCode).toBe(409);
    expect((await admin.patch(`/services/${created.id}`, { unitPrice: 1 })).statusCode).toBe(409);

    // A reseller can only pass on modules it has itself.
    const res = await rita.post(`/billing/customers/${kundeId}/services`, {
      name: 'Webhosting',
      unitPrice: 1000,
      interval: 'monthly',
      module: 'webhosting',
    });
    expect(res.statusCode).toBe(409);
    expect(
      (
        await rita.post(`/billing/customers/${kundeId}/services`, {
          name: 'DNS',
          unitPrice: 500,
          interval: 'yearly',
          module: 'dns',
        })
      ).statusCode,
    ).toBe(200);
    const kunde = await t.db.query.organizations.findFirst({ where: eq(organizations.id, kundeId) });
    expect(kunde!.modules).toEqual(['servers', 'dns']);
  });

  it('links services only to resources of the same organization', async () => {
    const [musterServer] = await t.db
      .select({ id: servers.id })
      .from(servers)
      .innerJoin(projects, eq(projects.id, servers.projectId))
      .where(eq(projects.orgId, musterId))
      .limit(1);
    const foreign = await admin.post(`/billing/customers/${beispielId}/services`, {
      name: 'Server',
      unitPrice: 1000,
      interval: 'monthly',
      resourceType: 'server',
      resourceId: musterServer!.id,
    });
    expect(foreign.statusCode).toBe(400);
    const own = await admin.post(`/billing/customers/${musterId}/services`, {
      name: 'Server',
      unitPrice: 1000,
      interval: 'monthly',
      resourceType: 'server',
      resourceId: musterServer!.id,
      startsAt: addMonths(todayZurich(), 1),
    });
    expect(own.statusCode, own.body).toBe(200);
    expect(json<ServiceDto>(own).resource).toMatchObject({ type: 'server', id: musterServer!.id });
  });
});

describe('recurring billing', () => {
  it('moves billing dates month-end safe', () => {
    const chain = (start: string, interval: 'monthly' | 'quarterly' | 'yearly', n: number) => {
      const dates = [start];
      for (let i = 0; i < n; i++) dates.push(nextBillingDate(dates.at(-1)!, interval, start)!);
      return dates;
    };
    expect(chain('2026-01-31', 'monthly', 4)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
    expect(chain('2028-01-31', 'monthly', 2)).toEqual(['2028-01-31', '2028-02-29', '2028-03-31']);
    expect(chain('2026-11-30', 'quarterly', 2)).toEqual(['2026-11-30', '2027-02-28', '2027-05-30']);
    expect(chain('2028-02-29', 'yearly', 4)).toEqual([
      '2028-02-29',
      '2029-02-28',
      '2030-02-28',
      '2031-02-28',
      '2032-02-29',
    ]);
    expect(nextBillingDate('2026-10-01', 'once', '2026-10-01')).toBeNull();
    // A date moved by hand becomes the new anchor.
    expect(nextBillingDate('2026-03-15', 'monthly', '2026-01-31')).toBe('2026-04-15');
  });

  it('bills due services once per period, with the period in the description', async () => {
    const monthly = json<ServiceDto>(
      await admin.post(`/billing/customers/${beispielId}/services`, {
        name: 'Managed Server',
        unitPrice: 5000,
        quantity: 2,
        interval: 'monthly',
        startsAt: '2026-01-31',
      }),
    );
    const setup = json<ServiceDto>(
      await admin.post(`/billing/customers/${beispielId}/services`, {
        productId: platformProducts.find((p) => p.interval === 'once')!.id,
        startsAt: '2026-02-01',
      }),
    );
    // Generating twice at the same time must not bill anything twice.
    const results = await Promise.all([
      admin.post(`/billing/customers/${beispielId}/invoices/generate`, { until: '2026-04-30' }),
      admin.post(`/billing/customers/${beispielId}/invoices/generate`, { until: '2026-04-30' }),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    const bodies = results.map((r) => json<{ invoice: InvoiceDetailDto | null }>(r));
    const generated = bodies.find((b) => b.invoice)!.invoice!;
    expect(bodies.filter((b) => b.invoice)).toHaveLength(1);
    expect(generated.status).toBe('draft');
    const mine = generated.lines.filter((l) => l.serviceId === monthly.id);
    expect(mine.map((l) => l.description)).toEqual([
      'Managed Server, 31.01.2026 - 27.02.2026',
      'Managed Server, 28.02.2026 - 30.03.2026',
      'Managed Server, 31.03.2026 - 29.04.2026',
      'Managed Server, 30.04.2026 - 30.05.2026',
    ]);
    expect(mine.every((l) => l.quantity === 2 && l.total === 10000)).toBe(true);
    const once = generated.lines.filter((l) => l.serviceId === setup.id);
    expect(once).toHaveLength(1);
    expect([once[0]!.periodStart, once[0]!.periodEnd]).toEqual(['2026-02-01', null]);

    const services = json<ServiceDto[]>(await admin.get(`/billing/customers/${beispielId}/services`));
    expect(services.find((s) => s.id === monthly.id)!.nextBillingAt).toBe('2026-05-31');
    expect(services.find((s) => s.id === setup.id)!.nextBillingAt).toBeNull();
    const lineRows = await t.db.select().from(invoiceLines).where(eq(invoiceLines.serviceId, monthly.id));
    expect(lineRows).toHaveLength(4);

    // Nothing left to bill until the next period is due.
    const again = json<{ invoice: unknown }>(
      await admin.post(`/billing/customers/${beispielId}/invoices/generate`, { until: '2026-05-30' }),
    );
    expect(again.invoice).toBeNull();

    // Deleting the generated draft makes its periods due again, so nothing gets lost.
    expect((await admin.del(`/invoices/${generated.id}`)).statusCode).toBe(200);
    const reset = json<ServiceDto[]>(await admin.get(`/billing/customers/${beispielId}/services`));
    expect(reset.find((s) => s.id === monthly.id)!.nextBillingAt).toBe('2026-01-31');
    expect(reset.find((s) => s.id === setup.id)!.nextBillingAt).toBe('2026-02-01');
  });

  it('skips services in another currency and the daily job bills every due organization', async () => {
    await admin.post(`/billing/customers/${kundeId}/services`, {
      name: 'Euro Dienst',
      unitPrice: 1000,
      interval: 'monthly',
      startsAt: todayZurich(),
    });
    // Force a currency mismatch through the database (the API takes the profile currency).
    const euro = await rita.post(`/billing/customers/${kundeId}/services`, {
      name: 'Euro Dienst 2',
      unitPrice: 1000,
      interval: 'monthly',
      startsAt: todayZurich(),
    });
    await t.db
      .update(servicesTable)
      .set({ currency: 'EUR' })
      .where(eq(servicesTable.id, json<ServiceDto>(euro).id));

    const job = new BillingJob(t.ctx, null as never);
    const first = await job.runDue(todayZurich());
    expect(first.failed).toBe(0);
    expect(first.invoices).toBeGreaterThanOrEqual(1);
    // Run again the same day: everything due is billed, only the skipped service is left.
    const second = await job.runDue(todayZurich());
    expect(second).toMatchObject({ invoices: 0, failed: 0 });

    const list = json<Paginated<InvoiceDto>>(
      await rita.get(`/billing/customers/${kundeId}/invoices?status=draft`),
    );
    const generated = json<InvoiceDetailDto>(await rita.get(`/invoices/${list.items[0]!.id}`));
    expect(generated.issuer.orgId).toBe(resellerId);
    expect(generated.lines.map((l) => l.description.split(',')[0])).not.toContain('Euro Dienst 2');
  });

  it('runs the scheduled job once per day and only where it holds the lock', async () => {
    const pool = (t.db as unknown as { $client: import('pg').Pool }).$client;
    const job = new BillingJob(t.ctx, pool);
    const runDue = vi.spyOn(job, 'runDue');
    await Promise.all([job.tick(), job.tick()]);
    await job.tick();
    expect(runDue).toHaveBeenCalledTimes(1);
    const state = await t.db.query.settings.findFirst({ where: eq(settings.key, 'billing_job') });
    expect(state?.value).toMatchObject({ lastRun: todayZurich(), failed: 0 });
  });
});

describe('pdf', () => {
  it('computes QR references with the recursive mod 10 check digit', () => {
    expect(mod10CheckDigit('21000000000313947143000901')).toBe('7');
    const ref = qrReference(`WL-${year}-00042`);
    expect(ref).toHaveLength(27);
    expect(isQRReferenceValid(ref)).toBe(true);
  });

  it('renders invoices with and without QR bill and watermarks drafts', async () => {
    const open = json<Paginated<InvoiceDto>>(await anna.get(`/orgs/${musterId}/invoices?status=open`))
      .items[0]!;
    const plain = await anna.get(`/invoices/${open.id}/pdf`);
    expect(plain.statusCode).toBe(200);
    expect(plain.headers['content-type']).toBe('application/pdf');
    expect(plain.headers['content-disposition']).toContain(`Rechnung-${open.number}.pdf`);
    expect(plain.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    const plainPages = pageCount(plain.rawPayload);

    // The snapshot taken at finalization decides, so an IBAN set now only affects new invoices.
    const settings = json<BillingSettingsDto>(await admin.get('/admin/settings/billing'));
    const bad = await admin.request('PUT', '/admin/settings/billing', {
      ...settings,
      issuer: { ...settings.issuer, iban: 'CH00 1234' },
    });
    expect(bad.statusCode).toBe(400);
    expect((await anna.request('PUT', '/admin/settings/billing', settings)).statusCode).toBe(403);
    const saved = await admin.request('PUT', '/admin/settings/billing', {
      ...settings,
      issuer: {
        ...settings.issuer,
        companyName: 'weblion.one GmbH',
        line1: 'Seestrasse 1',
        postalCode: '8002',
        city: 'Zürich',
        iban: 'CH44 3199 9123 0008 8901 2',
      },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(json<BillingSettingsDto>(saved).issuer.iban).toBe('CH4431999123000889012');
    expect(pageCount((await anna.get(`/invoices/${open.id}/pdf`)).rawPayload)).toBe(plainPages);

    const qrInvoice = await finalized(admin, musterId, [line('Mit QR', 12345)]);
    const withQr = await anna.get(`/invoices/${qrInvoice.id}/pdf`);
    expect(withQr.statusCode).toBe(200);
    expect(withQr.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(withQr.rawPayload)).toBe(plainPages + 1);

    // Drafts: only for the issuer, no QR bill.
    const d = await draft(admin, musterId, [line('Entwurf mit vielen Zeilen', 100)]);
    const draftPdf = await admin.get(`/invoices/${d.id}/pdf`);
    expect(draftPdf.statusCode).toBe(200);
    expect(pageCount(draftPdf.rawPayload)).toBe(1);
    await admin.del(`/invoices/${d.id}`);

    // Long invoices flow onto more pages.
    const long = await draft(
      admin,
      musterId,
      Array.from({ length: 60 }, (_, i) => line(`Position ${i + 1} mit etwas längerer Beschreibung`, 1000)),
    );
    expect(pageCount((await admin.get(`/invoices/${long.id}/pdf`)).rawPayload)).toBeGreaterThan(1);
    await admin.del(`/invoices/${long.id}`);

    await admin.request('PUT', '/admin/settings/billing', settings);
  });
});

describe('admin', () => {
  it('lists invoices and stats for platform staff only', async () => {
    const stats = await admin.get('/admin/billing/stats');
    expect(stats.statusCode).toBe(200);
    expect(json(stats)).toMatchObject({ currency: 'CHF' });
    expect(json<{ openCount: number }>(stats).openCount).toBeGreaterThan(0);
    expect((await anna.get('/admin/billing/stats')).statusCode).toBe(403);
    expect((await rita.get('/admin/billing/invoices')).statusCode).toBe(403);
    const search = json<Paginated<InvoiceDto>>(
      await admin.get('/admin/billing/invoices?q=muster&status=open'),
    );
    expect(search.items.length).toBeGreaterThan(0);
    expect(search.items.every((i) => i.org.slug === 'muster-ag' && i.status === 'open')).toBe(true);
    expect(search.items[0]!.zoho).not.toBeNull();
  });

  it('deactivates products that are in use instead of deleting them', async () => {
    const product = json<ProductDto>(
      await admin.post('/billing/products', {
        ownerOrgId: null,
        name: 'Temp',
        unitPrice: 100,
        interval: 'monthly',
      }),
    );
    const unused = json(await admin.del(`/billing/products/${product.id}`));
    expect(unused).toEqual({ ok: true, deactivated: false });
    const used = platformProducts.find((p) => p.name === 'Cloud Server M')!;
    expect(json(await admin.del(`/billing/products/${used.id}`))).toEqual({ ok: true, deactivated: true });
    const patched = json<ProductDto>(await admin.patch(`/billing/products/${used.id}`, { active: true }));
    expect([patched.active, patched.description]).toEqual([true, used.description]);
  });
});
