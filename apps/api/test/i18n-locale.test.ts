import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { desc, eq } from 'drizzle-orm';
import pino from 'pino';
import {
  DEFAULT_CUSTOMER_BOUNDARY,
  LOCALES,
  type BillingProfileDto,
  type InvoiceDetailDto,
  type InvoiceIssuerSettings,
  type Locale,
  type MeDto,
  type UserDto,
} from '@weblion/shared';
import { buildCatalog } from '@weblion/shared/i18n/catalog';
import { SECTION_SOURCES } from '@weblion/shared/i18n/server';
import {
  auditLogs,
  invoiceLines,
  invoices,
  memberships,
  organizations,
  users,
  type Invoice,
} from '../src/db/schema';
import { hashPassword } from '../src/lib/crypto';
import { toUserDto } from '../src/lib/dto';
import { I18nService } from '../src/i18n/service';
import { saveOverride } from '../src/i18n/entries';
import { catalogTranslator } from '../src/mail/templates';
import { billingLocale } from '../src/modules/billing/dto';
import {
  invoicePdfTexts,
  paymentReference,
  qrBillLanguage,
  renderInvoicePdf,
} from '../src/modules/billing/pdf';
import { checkoutLocale } from '../src/modules/payments/checkout';
import { ADMIN, Client, createTestApp, DEMO_PASSWORD, json, type TestApp } from './helpers';
import { startMockServer, type RecordedRequest } from './mock-server';

/**
 * The language of people and customers (i18n 20.2 group "locale"): users.locale through the profile, the
 * invitation and the admin; the billing language and the invoice's; the invoice PDF in five languages; the
 * Stripe Checkout page in the payer's language.
 */

let t: TestApp;
let admin: Client;
let anna: Client;
let olga: Client;
let musterId: string;
let lingId: string;
let stripe: Awaited<ReturnType<typeof startMockServer>>;

const lastAudit = async (action: string) =>
  (
    await t.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, action))
      .orderBy(desc(auditLogs.createdAt))
      .limit(1)
  )[0];

let sessionSeq = 0;
function stripeRoute(req: RecordedRequest) {
  if (req.method === 'POST' && req.path === '/v1/checkout/sessions') {
    const id = `cs_test_locale_${++sessionSeq}`;
    return { body: { id, url: `https://checkout.stripe.test/c/pay/${id}` } };
  }
  return undefined;
}

async function override(key: Parameters<I18nService['source']>[0], locale: Locale, value: string) {
  await saveOverride(t.db, {
    key,
    locale,
    value,
    origin: 'manual',
    reviewed: true,
    sourceHash: t.ctx.i18n.source(key).hash,
    userId: null,
  });
  await t.ctx.i18n.reload();
}

async function draftFor(orgId: string): Promise<InvoiceDetailDto> {
  const res = await admin.post(`/billing/customers/${orgId}/invoices`, {
    lines: [{ description: 'Cloud Server S', quantity: 1, unitPrice: 1234 }],
  });
  expect(res.statusCode, res.body).toBe(200);
  return json<InvoiceDetailDto>(res);
}

beforeAll(async () => {
  stripe = await startMockServer(stripeRoute);
  t = await createTestApp();
  Object.assign(t.ctx.env, {
    STRIPE_SECRET_KEY: 'sk_test_locale',
    STRIPE_API_BASE: stripe.url,
    STRIPE_PAYMENT_METHODS: 'card,twint',
  });
  admin = new Client(t.app);
  await admin.login(ADMIN.email, ADMIN.password);
  anna = new Client(t.app);
  await anna.login('anna@muster.example');
  const orgs = json<{ id: string; slug: string }[]>(await admin.get('/admin/orgs'));
  musterId = orgs.find((o) => o.slug === 'muster-ag')!.id;

  // A customer without credit (its invoices stay open) with two owners.
  const [org] = await t.db
    .insert(organizations)
    .values({ name: 'Lingua AG', slug: 'lingua-ag', kind: 'customer', boundary: DEFAULT_CUSTOMER_BOUNDARY })
    .returning();
  lingId = org!.id;
  const hash = await hashPassword(DEMO_PASSWORD);
  const [o1, o2] = await t.db
    .insert(users)
    .values([
      { email: 'olga@lingua.example', name: 'Olga Lingua', passwordHash: hash, locale: 'de' },
      { email: 'otto@lingua.example', name: 'Otto Lingua', passwordHash: hash, locale: 'nl' },
    ])
    .returning();
  await t.db.insert(memberships).values([
    { orgId: lingId, userId: o1!.id, role: 'owner', createdAt: new Date('2026-01-01T00:00:00Z') },
    { orgId: lingId, userId: o2!.id, role: 'owner', createdAt: new Date('2026-03-01T00:00:00Z') },
  ]);
  olga = new Client(t.app);
  await olga.login('olga@lingua.example');
});

afterAll(async () => {
  await t?.close();
  await stripe?.close();
});

describe('users.locale', () => {
  it('saves each of the five languages through PATCH /auth/me and refuses others', async () => {
    for (const locale of LOCALES) {
      const res = await anna.request('PATCH', '/auth/me', { locale });
      expect(res.statusCode, res.body).toBe(200);
      expect(json<MeDto>(res).user.locale).toBe(locale);
      expect(json<MeDto>(await anna.get('/auth/me')).user.locale).toBe(locale);
    }
    for (const locale of ['es', 'de-CH', 'EN', '']) {
      expect((await anna.request('PATCH', '/auth/me', { locale })).statusCode).toBe(400);
    }
    await anna.request('PATCH', '/auth/me', { locale: 'de' });
  });

  it('audits the profile update with the changed fields', async () => {
    await anna.request('PATCH', '/auth/me', { locale: 'it' });
    const audit = await lastAudit('auth.profile_update');
    expect(audit).toMatchObject({ resourceType: 'user', status: 'success' });
    expect(audit!.details).toEqual({ changed: ['locale'], locale: 'it' });
    await anna.request('PATCH', '/auth/me', { name: 'Anna Muster', locale: 'it' });
    expect((await lastAudit('auth.profile_update'))!.details).toEqual({ changed: [], locale: 'it' });
    await anna.request('PATCH', '/auth/me', { locale: 'de' });
  });

  it('returns one of the five for any stored value', () => {
    const base = {
      id: '00000000-0000-4000-8000-000000000000',
      email: 'x@example.test',
      name: 'X',
      platformRole: null,
      totpEnabled: false,
      status: 'active',
      createdAt: new Date(),
      lastLoginAt: null,
    };
    for (const [stored, expected] of [
      ['de-CH', 'de'],
      ['EN-gb', 'en'],
      ['fr_CH', 'fr'],
      ['xx', 'de'],
    ] as const) {
      const dto: UserDto = toUserDto({ ...base, locale: stored } as never);
      expect(dto.locale).toBe(expected);
    }
  });

  it('gives a new account the language of the invite page, and leaves an existing one alone', async () => {
    const invite = async (email: string) => {
      const res = await anna.post(`/orgs/${musterId}/invitations`, { email, role: 'member' });
      expect(res.statusCode, res.body).toBe(200);
      return json<{ link: string }>(res).link.split('/invite/')[1]!;
    };
    const guest = new Client(t.app);
    let token = await invite('francoise@example.test');
    let res = await guest.post(`/auth/invitations/${token}/accept`, {
      name: 'Françoise',
      password: 'a-long-password-1',
      locale: 'fr',
    });
    expect(res.statusCode, res.body).toBe(200);
    const [fr] = await t.db.select().from(users).where(eq(users.email, 'francoise@example.test'));
    expect(fr!.locale).toBe('fr');
    expect((await lastAudit('member.join'))!.details).toMatchObject({ accountCreated: true, locale: 'fr' });

    token = await invite('default@example.test');
    res = await new Client(t.app).post(`/auth/invitations/${token}/accept`, {
      name: 'Default',
      password: 'a-long-password-1',
    });
    expect(res.statusCode, res.body).toBe(200);
    const [plain] = await t.db.select().from(users).where(eq(users.email, 'default@example.test'));
    expect(plain!.locale).toBe('de');

    // An existing account accepts while signed in: its language stays.
    await t.db.update(users).set({ locale: 'nl' }).where(eq(users.email, 'dev@beispiel.example'));
    const dev = new Client(t.app);
    await dev.login('dev@beispiel.example');
    token = await invite('dev@beispiel.example');
    res = await dev.post(`/auth/invitations/${token}/accept`, { locale: 'it' });
    expect(res.statusCode, res.body).toBe(200);
    const [devRow] = await t.db.select().from(users).where(eq(users.email, 'dev@beispiel.example'));
    expect(devRow!.locale).toBe('nl');
    expect((await lastAudit('member.join'))!.details).not.toHaveProperty('locale');

    expect(
      (
        await new Client(t.app).post(`/auth/invitations/${await invite('bad@example.test')}/accept`, {
          name: 'Bad',
          password: 'a-long-password-1',
          locale: 'es',
        })
      ).statusCode,
    ).toBe(400);
  });

  it('creates a user in the language the admin chose', async () => {
    const res = await admin.post('/admin/users', {
      email: 'italo@example.test',
      name: 'Italo',
      locale: 'it',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<{ user: UserDto }>(res).user.locale).toBe('it');
    expect((await lastAudit('user.create'))!.details).toMatchObject({ locale: 'it' });
    const plain = await admin.post('/admin/users', { email: 'plain@example.test', name: 'Plain' });
    expect(json<{ user: UserDto }>(plain).user.locale).toBe('de');
    expect(
      (await admin.post('/admin/users', { email: 'x@example.test', name: 'X', locale: 'xx' })).statusCode,
    ).toBe(400);
  });
});

describe('billing language (i18n 9)', () => {
  it('sets and clears the profile language through both PUT routes', async () => {
    // The customer's own route.
    let res = await olga.request('PUT', `/orgs/${lingId}/billing/profile`, {
      companyName: 'Lingua AG',
      locale: 'fr',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<BillingProfileDto>(res)).toMatchObject({ locale: 'fr', effectiveLocale: 'fr' });
    expect((await lastAudit('billing.profile_update'))!.details).toMatchObject({ locale: 'fr' });
    // Leaving the field out keeps it.
    res = await olga.request('PUT', `/orgs/${lingId}/billing/profile`, { companyName: 'Lingua AG' });
    expect(json<BillingProfileDto>(res).locale).toBe('fr');
    // null: the language of the oldest active owner (Olga, de), not the newer one (Otto, nl).
    res = await olga.request('PUT', `/orgs/${lingId}/billing/profile`, {
      companyName: 'Lingua AG',
      locale: null,
    });
    expect(json<BillingProfileDto>(res)).toMatchObject({ locale: null, effectiveLocale: 'de' });
    await t.db.update(users).set({ locale: 'it' }).where(eq(users.email, 'olga@lingua.example'));
    expect(json<BillingProfileDto>(await olga.get(`/orgs/${lingId}/billing/profile`)).effectiveLocale).toBe(
      'it',
    );

    // The seller's route.
    res = await admin.request('PUT', `/billing/customers/${lingId}/profile`, { locale: 'en' });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<BillingProfileDto>(res)).toMatchObject({ locale: 'en', effectiveLocale: 'en' });
    expect((await lastAudit('billing.profile_update'))!.details).toMatchObject({
      locale: 'en',
      asSeller: true,
    });
    const seller = json<{ profile: BillingProfileDto }>(await admin.get(`/billing/customers/${lingId}`));
    expect(seller.profile.effectiveLocale).toBe('en');
    res = await admin.request('PUT', `/billing/customers/${lingId}/profile`, { locale: null });
    expect(json<BillingProfileDto>(res)).toMatchObject({ locale: null, effectiveLocale: 'it' });
    expect(
      (await admin.request('PUT', `/billing/customers/${lingId}/profile`, { locale: 'es' })).statusCode,
    ).toBe(400);

    // Without any owner: German.
    expect(
      await billingLocale(
        t.db,
        (
          await t.db
            .insert(organizations)
            .values({
              name: 'Leer AG',
              slug: 'leer-ag',
              kind: 'customer',
              boundary: DEFAULT_CUSTOMER_BOUNDARY,
            })
            .returning()
        )[0]!.id,
      ),
    ).toBe('de');
  });

  it('fixes the invoice language at finalize; drafts follow the current billing language', async () => {
    await admin.request('PUT', `/billing/customers/${lingId}/profile`, { locale: 'fr' });
    const draft = await draftFor(lingId);
    expect(draft.locale).toBe('fr');
    const [draftRow] = await t.db.select().from(invoices).where(eq(invoices.id, draft.id));
    expect(draftRow!.locale).toBeNull();
    // A draft follows a change of the profile.
    await admin.request('PUT', `/billing/customers/${lingId}/profile`, { locale: 'nl' });
    expect(json<InvoiceDetailDto>(await admin.get(`/invoices/${draft.id}`)).locale).toBe('nl');

    const finalized = json<InvoiceDetailDto>(
      await admin.post(`/invoices/${draft.id}/finalize`, { send: false }),
    );
    expect(finalized.locale).toBe('nl');
    const [row] = await t.db.select().from(invoices).where(eq(invoices.id, draft.id));
    expect(row!.locale).toBe('nl');
    // Issued: a later change of the profile does not change it.
    await admin.request('PUT', `/billing/customers/${lingId}/profile`, { locale: 'de' });
    expect(json<InvoiceDetailDto>(await admin.get(`/invoices/${draft.id}`)).locale).toBe('nl');
    expect(json<InvoiceDetailDto>(await olga.get(`/invoices/${draft.id}`)).locale).toBe('nl');
  });

  it('names the PDF download in the invoice language', async () => {
    await admin.request('PUT', `/billing/customers/${lingId}/profile`, { locale: 'en' });
    const invoice = json<InvoiceDetailDto>(
      await admin.post(`/invoices/${(await draftFor(lingId)).id}/finalize`, { send: false }),
    );
    const pdf = await admin.get(`/invoices/${invoice.id}/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-disposition']).toBe(`inline; filename="Invoice-${invoice.number}.pdf"`);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    // An override with characters outside ASCII keeps the header valid.
    await override('pdf.invoice.filename', 'en', 'Rëchnung-{number}.pdf');
    const umlaut = await admin.get(`/invoices/${invoice.id}/pdf`);
    expect(umlaut.headers['content-disposition']).toBe(
      `inline; filename="Rechnung-${invoice.number}.pdf"; filename*=UTF-8''${encodeURIComponent(`Rëchnung-${invoice.number}.pdf`)}`,
    );
  });
});

describe('invoice PDF in five languages (i18n 8.3)', () => {
  const issuer = {
    name: 'weblion.one',
    companyName: 'weblion GmbH',
    contactName: null,
    line1: 'Bahnhofstrasse 1',
    line2: null,
    postalCode: '8001',
    city: 'Zürich',
    country: 'CH',
    email: 'billing@weblion.example',
    phone: null,
    website: 'https://weblion.example',
    vatId: 'CHE-123.456.789 MWST',
    iban: 'CH9300762011623852957',
    bankName: 'Testbank',
    invoicePrefix: 'WL',
    invoiceFooter: null,
    defaultPaymentTermsDays: 30,
    defaultTaxRateBp: 810,
    defaultCurrency: 'CHF',
  } as InvoiceIssuerSettings;

  async function openInvoice(): Promise<{ invoice: Invoice; lines: (typeof invoiceLines.$inferSelect)[] }> {
    const finalized = json<InvoiceDetailDto>(
      await admin.post(`/invoices/${(await draftFor(lingId)).id}/finalize`, { send: false }),
    );
    const [invoice] = await t.db.select().from(invoices).where(eq(invoices.id, finalized.id));
    const lines = await t.db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, finalized.id));
    return { invoice: { ...invoice!, dueDate: '2026-12-31', issueDate: '2026-12-01' }, lines };
  }

  it('maps the QR bill language (Dutch uses English)', () => {
    expect(LOCALES.map(qrBillLanguage)).toEqual(['DE', 'EN', 'FR', 'IT', 'EN']);
    expect(checkoutLocale('nl')).toBe('nl');
  });

  it('gives every text in the invoice language with Swiss numbers, dates and the German reference', async () => {
    const { invoice, lines } = await openInvoice();
    const address = {
      companyName: 'Lingua AG',
      contactName: null,
      line1: 'Rue du Lac 2',
      line2: null,
      postalCode: '1003',
      city: 'Lausanne',
      country: 'DE',
      vatId: null,
    };
    const titles: Record<Locale, string> = {} as Record<Locale, string>;
    for (const locale of LOCALES) {
      const tr = t.ctx.i18n.translator(locale);
      const texts = invoicePdfTexts({
        invoice,
        lines,
        org: { name: 'Lingua AG', slug: 'lingua-ag' },
        issuer,
        address: address as never,
        locale,
        tr,
      });
      titles[locale] = texts.title;
      expect(texts.title).toBe(catalogTranslator(locale)('pdf.invoice.title', { number: invoice.number }));
      // Swiss formats in every language.
      expect(texts.meta.find(([, v]) => v === '31.12.2026')).toBeTruthy();
      expect(texts.meta.find(([, v]) => v === '01.12.2026')).toBeTruthy();
      expect(texts.period('01.10.2026', '31.10.2026')).toContain('01.10.2026');
      expect(texts.taxLine('8.1 %', '12.34')).toContain('8.1 %');
      // The payment reference stays German: bank reconciliation does not depend on the language.
      const transfer = texts.paragraphs.find((p) => p.includes('CH93 0076 2011 6238 5295 7'));
      expect(transfer, locale).toContain(`"${paymentReference(invoice.number!)}"`);
      expect(paymentReference(invoice.number!)).toBe(`Rechnung ${invoice.number}`);
      expect(texts.qr).not.toBeNull();
      expect(texts.qrLanguage).toBe(qrBillLanguage(locale));
    }
    expect(titles.de).toBe(`Rechnung ${invoice.number}`);
    expect(titles.en).toBe(`Invoice ${invoice.number}`);

    // With a French dictionary the French texts are used (until the translation units land, English).
    const catalog = buildCatalog(
      {
        ...SECTION_SOURCES,
        pdf: {
          ...SECTION_SOURCES.pdf,
          fr: { 'pdf.invoice.title': 'Facture {number}', 'pdf.invoice.meta.dueDate': 'Échéance' },
          it: { 'pdf.invoice.title': 'Fattura {number}' },
          nl: { 'pdf.invoice.title': 'Factuur {number}' },
        },
      },
      {},
    );
    const i18n = new I18nService(t.db, t.ctx.env, pino({ level: 'silent' }), catalog);
    const input = { invoice, lines, org: { name: 'Lingua AG', slug: 'lingua-ag' }, issuer, address: null };
    expect(invoicePdfTexts({ ...input, locale: 'fr', tr: i18n.translator('fr') }).title).toBe(
      `Facture ${invoice.number}`,
    );
    expect(invoicePdfTexts({ ...input, locale: 'it', tr: i18n.translator('it') }).title).toBe(
      `Fattura ${invoice.number}`,
    );
    expect(invoicePdfTexts({ ...input, locale: 'nl', tr: i18n.translator('nl') }).title).toBe(
      `Factuur ${invoice.number}`,
    );
    const fr = invoicePdfTexts({ ...input, locale: 'fr', tr: i18n.translator('fr') });
    expect(fr.meta).toContainEqual(['Échéance', '31.12.2026']);
    // A key without a French text: English, never German.
    expect(fr.columns.description).toBe('Description');
  });

  it('renders a PDF in every language, the QR bill page included', async () => {
    const { invoice, lines } = await openInvoice();
    for (const locale of LOCALES) {
      const pdf = await renderInvoicePdf({
        invoice,
        lines,
        org: { name: 'Lingua AG', slug: 'lingua-ag' },
        issuer,
        address: null,
        locale,
        tr: t.ctx.i18n.translator(locale),
      });
      expect(pdf.subarray(0, 5).toString(), locale).toBe('%PDF-');
      // One invoice page plus the QR bill page.
      expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length, locale).toBe(2);
      expect(pdf.toString('latin1')).toContain(
        `/Lang (${({ de: 'de-CH', en: 'en-GB', fr: 'fr-CH', it: 'it-CH', nl: 'nl-NL' } as const)[locale]})`,
      );
    }
  });

  it('keeps every pdf.* text of every bundle encodable in Windows-1252 (standard PDF fonts)', () => {
    const high = new TextDecoder('windows-1252').decode(Uint8Array.from({ length: 32 }, (_, i) => 0x80 + i));
    const allowed = (ch: string) => {
      const code = ch.codePointAt(0)!;
      return (
        (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || code === 0x0a || high.includes(ch)
      );
    };
    const bad: string[] = [];
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(SECTION_SOURCES.pdf[locale] ?? {})) {
        for (const ch of value)
          if (!allowed(ch)) bad.push(`${locale} ${key}: U+${ch.codePointAt(0)!.toString(16)}`);
      }
    }
    expect(bad).toEqual([]);
    // The narrow no-break space of fr-CH numbers is not in Windows-1252, the no-break space is.
    expect(allowed(' ')).toBe(false);
    expect(allowed(' ')).toBe(true);
  });
});

describe('Stripe Checkout (i18n 8.4)', () => {
  it('opens the page in the payer’s language with the line item in it', async () => {
    await override('pdf.stripe.invoiceItem', 'it', 'Fattura {number}');
    await t.db.update(users).set({ locale: 'it' }).where(eq(users.email, 'olga@lingua.example'));
    await admin.request('PUT', `/billing/customers/${lingId}/profile`, { locale: 'de' });
    const invoice = json<InvoiceDetailDto>(
      await admin.post(`/invoices/${(await draftFor(lingId)).id}/finalize`, { send: false }),
    );
    const res = await olga.post(`/invoices/${invoice.id}/pay`, { method: 'card' });
    expect(res.statusCode, res.body).toBe(200);
    const request = stripe.requests.filter((r) => r.path === '/v1/checkout/sessions').at(-1)!;
    // The payer reads the page, so her language, not the billing language (de).
    expect(request.form.get('locale')).toBe('it');
    expect(request.form.get('line_items[0][price_data][product_data][name]')).toBe(
      `Fattura ${invoice.number}`,
    );

    await t.db.update(users).set({ locale: 'nl' }).where(eq(users.email, 'olga@lingua.example'));
    const credit = await olga.post(`/orgs/${lingId}/credit/topup`, { amount: 5000, method: 'card' });
    expect(credit.statusCode, credit.body).toBe(200);
    const topup = stripe.requests.filter((r) => r.path === '/v1/checkout/sessions').at(-1)!;
    expect(topup.form.get('locale')).toBe('nl');
    expect(topup.form.get('line_items[0][price_data][product_data][name]')).toBe(
      catalogTranslator('nl')('pdf.stripe.creditItem'),
    );
  });
});
