import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import pino from 'pino';
import {
  DEFAULT_CUSTOMER_BOUNDARY,
  formatMoney,
  LOCALES,
  type InvoiceDetailDto,
  type Locale,
} from '@weblion/shared';
import { buildCatalog } from '@weblion/shared/i18n/catalog';
import { SECTION_SOURCES } from '@weblion/shared/i18n/server';
import { billingProfiles, mailLog, memberships, organizations, users } from '../src/db/schema';
import { I18nService } from '../src/i18n/service';
import { saveOverride } from '../src/i18n/entries';
import type { MailService, TransportFactory } from '../src/mail/service';
import { catalogTranslator, renderMail } from '../src/mail/templates';
import type { MailTemplateName, MailTemplates } from '../src/mail/types';
import { ADMIN, Client, createTestApp, json, type TestApp } from './helpers';

/**
 * Mails from the email.* keys (i18n 8.2, 20.2 group "mail"): every template in every language, de and en
 * byte-identical to the templates before the move, overrides, and the language each mail goes out in.
 */

let t: TestApp;
let admin: Client;
let anna: Client;
let musterId: string;
/** A customer without credit, so a finalized invoice stays open. */
let sprachId: string;
const chf = (minor: number) => formatMoney(minor, 'CHF', 'de');

interface Captured {
  to: string[];
  subject: string;
  text: string;
  html: string;
}
const sent: Captured[] = [];
const capture: TransportFactory = () =>
  nodemailer.createTransport({
    name: 'capture',
    version: '1',
    send(mail, done) {
      const d = mail.data;
      sent.push({
        to: ([] as unknown[]).concat(d.to ?? []).map(String),
        subject: String(d.subject),
        text: String(d.text),
        html: String(d.html),
      });
      done(null, { envelope: mail.message.getEnvelope(), messageId: `<i18n-${sent.length}@weblion.test>` });
    },
  });

/** The data of every template, some twice (paid invoice, payment with an invoice, budget used up). */
const SAMPLES: unknown[] = [];
const SAMPLE_NAMES: MailTemplateName[] = [];
function sample<K extends MailTemplateName>(name: K, data: MailTemplates[K]) {
  SAMPLE_NAMES.push(name);
  SAMPLES.push(data);
}
sample('invitation', {
  orgName: 'Muster AG',
  inviterName: 'Anna Muster',
  role: 'Admin',
  link: 'https://console.example/invite/abc',
  expiresAt: '14. Oktober 2026',
});
sample('invitation', {
  orgName: 'Muster <AG>',
  inviterName: null,
  role: 'Owner',
  link: 'javascript:alert(1)',
  expiresAt: '14 October 2026',
});
sample('invoice', {
  orgName: 'Muster AG',
  issuerName: 'weblion.one',
  invoiceNumber: 'WL-2026-00001',
  total: 'CHF 123.45',
  dueDate: '31.10.2026',
  link: 'https://console.example/o/muster-ag/billing/invoices/1',
  paid: false,
});
sample('invoice', {
  orgName: 'Muster AG',
  issuerName: 'Alpen Hosting',
  invoiceNumber: 'AH-2026-00002',
  total: 'CHF 0.00',
  dueDate: '31.10.2026',
  link: 'https://console.example/x',
  paid: true,
});
sample('invoice_reminder', {
  orgName: 'Muster AG',
  issuerName: 'weblion.one',
  invoiceNumber: 'WL-2026-00001',
  amountDue: 'CHF 123.45',
  dueDate: '31.10.2026',
  link: 'https://console.example/i/1',
});
sample('payment_received', {
  orgName: 'Muster AG',
  amount: 'CHF 50.00',
  invoiceNumber: null,
  link: 'https://console.example/o/muster-ag/billing',
});
sample('payment_received', {
  orgName: 'Muster AG',
  amount: 'CHF 50.00',
  invoiceNumber: 'WL-2026-00001',
  link: 'https://console.example/o/muster-ag/billing/invoices/1',
});
sample('credit_booked', {
  orgName: 'Muster AG',
  amount: 'CHF 50.00',
  balance: 'CHF 80.00',
  description: 'Gutschrift',
  link: 'https://console.example/o/muster-ag/billing',
});
sample('test', { sentBy: 'weblion Admin' });
sample('ai_budget', {
  kind: 'warning',
  month: 'November 2026',
  spent: 'USD 81.20',
  budget: 'USD 100.00',
  percent: 81,
  link: 'https://console.example/admin/ai',
});
sample('ai_budget', {
  kind: 'exhausted',
  month: 'November 2026',
  spent: 'USD 100.20',
  budget: 'USD 100.00',
  percent: 100,
  link: 'https://console.example/admin/ai',
});

/**
 * SHA-256 (first 16 hex) of subject, text and html of the de/en templates before the move to keys, taken from
 * the old mail/templates.ts with the samples above (in order, de then en).
 */
const LEGACY = [
  ['78d164ce8c3900f7', 'aca2f8b3d6ade750'],
  ['82900c2f01734c22', 'db12c6751c833473'],
  ['a7de00fc5c4adfd1', '37a99f36018bc185'],
  ['f00fd680be23e91a', '73209a6ef67ee985'],
  ['6f10f9b1f6ae2140', '0ec7900e0f6f9077'],
  ['48c32039da7d91dd', 'a5073d68ddb0a485'],
  ['a4aa1ee0736098a8', '5f244dbfecb71ccb'],
  ['b52368d2609f5aa0', '5fa7aa912d4408f7'],
  ['cc449c3dede7a340', '89881b31a52cc166'],
  ['7cea7234f44ce3e1', '3439ac5237fe917f'],
  ['ef7244b6d2c6aa67', '4d57e1681dcb06dd'],
] as const;

const hash = (m: { subject: string; text: string; html: string }) =>
  createHash('sha256').update(`${m.subject}\u0000${m.text}\u0000${m.html}`).digest('hex').slice(0, 16);

const EM_DASH = String.fromCharCode(0x2014);
const mailer = () => t.ctx.mail as MailService;

async function lastSubject(template: MailTemplateName): Promise<string | undefined> {
  const [row] = await t.db
    .select({ subject: mailLog.subject })
    .from(mailLog)
    .where(eq(mailLog.template, template))
    .orderBy(desc(mailLog.createdAt))
    .limit(1);
  return row?.subject;
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

async function setLocale(email: string, locale: Locale) {
  await t.db.update(users).set({ locale }).where(eq(users.email, email));
}

beforeAll(async () => {
  t = await createTestApp();
  admin = new Client(t.app);
  await admin.login(ADMIN.email, ADMIN.password);
  anna = new Client(t.app);
  await anna.login('anna@muster.example');
  const orgs = json<{ id: string; slug: string }[]>(await admin.get('/admin/orgs'));
  musterId = orgs.find((o) => o.slug === 'muster-ag')!.id;
  const [org] = await t.db
    .insert(organizations)
    .values({ name: 'Sprach AG', slug: 'sprach-ag', kind: 'customer', boundary: DEFAULT_CUSTOMER_BOUNDARY })
    .returning();
  sprachId = org!.id;
  const [olga, otto] = await t.db
    .insert(users)
    .values([
      { email: 'olga@sprach.example', name: 'Olga Owner', locale: 'de' },
      { email: 'otto@sprach.example', name: 'Otto Owner', locale: 'de' },
    ])
    .returning();
  await t.db.insert(memberships).values([
    { orgId: sprachId, userId: olga!.id, role: 'owner', createdAt: new Date('2026-01-01T00:00:00Z') },
    { orgId: sprachId, userId: otto!.id, role: 'owner', createdAt: new Date('2026-02-01T00:00:00Z') },
  ]);
  mailer().useTransportFactory(capture);
  const smtp = await admin.request('PUT', '/admin/settings/mail', {
    host: 'smtp.example.test',
    port: 587,
    secure: false,
    user: 'mailer@example.test',
    password: 'smtp-secret-password-42',
    from: 'weblion.one <noreply@example.test>',
    replyTo: null,
  });
  expect(smtp.statusCode, smtp.body).toBe(200);
});

afterEach(() => {
  sent.length = 0;
});

afterAll(async () => {
  await t?.close();
});

describe('templates from keys', () => {
  it('renders every template in each of the five languages', () => {
    for (const locale of LOCALES) {
      SAMPLE_NAMES.forEach((name, i) => {
        const mail = renderMail(name, SAMPLES[i] as never, locale);
        expect(mail.subject.length, `${name} ${locale}`).toBeGreaterThan(0);
        expect(mail.subject).not.toMatch(/[\r\n]/);
        expect(mail.text.split('\n')[0]!.length).toBeGreaterThan(0);
        expect(mail.html).toContain(`<html lang="${locale}">`);
        expect(mail.html).toContain('<!doctype html>');
        // No raw key and no em dash anywhere.
        for (const part of [mail.subject, mail.text, mail.html]) {
          expect(part).not.toMatch(/email\.[a-zA-Z]+\./);
          expect(part).not.toContain(EM_DASH);
        }
      });
    }
  });

  it('keeps the German and English mails byte for byte as before the move to keys', () => {
    SAMPLE_NAMES.forEach((name, i) => {
      expect(hash(renderMail(name, SAMPLES[i] as never, 'de')), `${name} #${i} de`).toBe(LEGACY[i]![0]);
      expect(hash(renderMail(name, SAMPLES[i] as never, 'en')), `${name} #${i} en`).toBe(LEGACY[i]![1]);
    });
  });

  it('reads the dictionary of the mail language, falling back to English, then German', () => {
    const catalog = buildCatalog(
      {
        ...SECTION_SOURCES,
        email: {
          ...SECTION_SOURCES.email,
          fr: {
            'email.invitation.subject': 'Invitation à {org} sur weblion.one',
            'email.common.greeting': 'Bonjour',
          },
          it: {},
        },
      },
      {},
    );
    const i18n = new I18nService(t.db, t.ctx.env, pino({ level: 'silent' }), catalog);
    const data = SAMPLES[0] as MailTemplates['invitation'];
    const fr = renderMail('invitation', data, 'fr', i18n.translator('fr'));
    expect(fr.subject).toBe('Invitation à Muster AG sur weblion.one');
    expect(fr.text).toContain('Bonjour');
    // A key without a French text: English, never German.
    expect(fr.text).toContain('Accept invitation');
    expect(fr.text).not.toContain('Einladung annehmen');
    const it = renderMail('invitation', data, 'it', i18n.translator('it'));
    expect(it.subject).toBe('Invitation to Muster AG on weblion.one');
    expect(it.html).toContain('<html lang="it">');
    // The default translator is the compiled catalog with the same chain.
    expect(catalogTranslator('nl')('email.common.greeting')).toBe('Hello');
    expect(catalogTranslator('de')('email.common.greeting')).toBe('Guten Tag');
  });

  it('uses an override of the mail language at once (after reload)', async () => {
    await setLocale('anna@muster.example', 'fr');
    await override('email.invitation.subject', 'fr', 'Invitation à {org} (override)');
    const res = await anna.post(`/orgs/${musterId}/invitations`, {
      email: 'neu.fr@example.test',
      role: 'member',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await lastSubject('invitation')).toBe('Invitation à Muster AG (override)');
    expect(sent.at(-1)!.html).toContain('<html lang="fr">');
  });
});

describe('the language of each mail (i18n 8.2)', () => {
  it('invites an existing account in its language, a new address in the inviter’s', async () => {
    await override('email.invitation.subject', 'it', 'Invito a {org}');
    await override('email.invitation.subject', 'nl', 'Uitnodiging voor {org}');
    // Anna writes French; dev has an account and reads Italian.
    await setLocale('anna@muster.example', 'fr');
    await setLocale('dev@beispiel.example', 'it');
    let res = await anna.post(`/orgs/${musterId}/invitations`, {
      email: 'dev@beispiel.example',
      role: 'viewer',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await lastSubject('invitation')).toBe('Invito a Muster AG');
    // The role in the mail comes from the core keys in the mail's language (English fallback for it).
    expect(sent.at(-1)!.text).toContain('Read only');

    await setLocale('anna@muster.example', 'nl');
    res = await anna.post(`/orgs/${musterId}/invitations`, {
      email: 'nobody.yet@example.test',
      role: 'member',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await lastSubject('invitation')).toBe('Uitnodiging voor Muster AG');
    await setLocale('anna@muster.example', 'de');
    await setLocale('dev@beispiel.example', 'de');
  });

  it('sends the test mail in the admin’s language', async () => {
    await override('email.test.subject', 'nl', 'Testmail van weblion.one');
    await setLocale(ADMIN.email, 'nl');
    const res = await admin.post('/admin/settings/mail/test', { to: 'ops@example.test' });
    expect(json(res)).toEqual({ status: 'sent' });
    expect(await lastSubject('test')).toBe('Testmail van weblion.one');
    await setLocale(ADMIN.email, 'de');
  });

  it('bills in the billing language: invoice and payment in the invoice’s, credit in the profile’s', async () => {
    await override('email.invoice.subject', 'fr', 'Facture {number} de {issuer}');
    await override('email.payment.subject', 'fr', 'Paiement reçu : {amount}');
    await override('email.credit.subject', 'it', 'Credito registrato: {amount}');
    await t.db
      .insert(billingProfiles)
      .values({
        orgId: sprachId,
        companyName: 'Sprach AG',
        email: 'buchhaltung@sprach.example',
        locale: 'fr',
      });

    const draft = await admin.post(`/billing/customers/${sprachId}/invoices`, {
      lines: [{ description: 'Cloud Server S', quantity: 1, unitPrice: 1000 }],
    });
    expect(draft.statusCode, draft.body).toBe(200);
    const finalized = await admin.post(`/invoices/${json(draft).id}/finalize`, { send: true });
    expect(finalized.statusCode, finalized.body).toBe(200);
    const invoice = json<InvoiceDetailDto>(finalized);
    expect(invoice.status).toBe('open');
    expect(invoice.locale).toBe('fr');
    expect(await lastSubject('invoice')).toBe(`Facture ${invoice.number} de weblion.one`);
    expect(sent.at(-1)!.to).toEqual(['buchhaltung@sprach.example']);
    // Amounts stay in Swiss format in every language, as on the PDF.
    expect(sent.at(-1)!.text).toContain(chf(invoice.total));

    // The profile changes later: the issued invoice keeps French, the credit mail follows the profile.
    await t.db.update(billingProfiles).set({ locale: 'it' }).where(eq(billingProfiles.orgId, sprachId));
    const paid = await admin.post(`/invoices/${invoice.id}/mark-paid`, {
      method: 'bank_transfer',
      notify: true,
    });
    expect(paid.statusCode, paid.body).toBe(200);
    expect(await lastSubject('payment_received')).toBe(`Paiement reçu : ${chf(invoice.total)}`);

    const credit = await admin.post(`/billing/customers/${sprachId}/credit`, {
      amount: 500,
      type: 'topup',
      description: 'Gutschrift',
      notify: true,
    });
    expect(credit.statusCode, credit.body).toBe(200);
    expect(await lastSubject('credit_booked')).toBe(`Credito registrato: ${chf(500)}`);
  });

  it('falls back to the oldest active owner’s language when the profile has none', async () => {
    await t.db.update(billingProfiles).set({ locale: null }).where(eq(billingProfiles.orgId, sprachId));
    const credit = (amount: number) =>
      admin.post(`/billing/customers/${sprachId}/credit`, {
        amount,
        type: 'topup',
        description: 'Gutschrift',
        notify: true,
      });
    // Otto joined later: his language does not count while Olga is an active owner.
    await setLocale('otto@sprach.example', 'nl');
    expect((await credit(100)).statusCode).toBe(200);
    expect(await lastSubject('credit_booked')).toBe(`Guthaben verbucht: ${chf(100)}`);
    await setLocale('olga@sprach.example', 'it');
    expect((await credit(200)).statusCode).toBe(200);
    expect(await lastSubject('credit_booked')).toBe(`Credito registrato: ${chf(200)}`);
    // A disabled owner is skipped.
    await t.db.update(users).set({ status: 'disabled' }).where(eq(users.email, 'olga@sprach.example'));
    await override('email.credit.subject', 'nl', 'Tegoed geboekt: {amount}');
    expect((await credit(300)).statusCode).toBe(200);
    expect(await lastSubject('credit_booked')).toBe(`Tegoed geboekt: ${chf(300)}`);
    await t.db.update(users).set({ status: 'active' }).where(eq(users.email, 'olga@sprach.example'));
  });

  it('sends the AI budget mail in the language it is asked for (one send per superadmin locale, U3)', async () => {
    await override('email.aiBudget.warning.subject', 'it', 'Budget IA usato al {percent} %');
    const result = await t.ctx.mail.send('ai_budget', SAMPLES[9] as MailTemplates['ai_budget'], {
      to: 'admin@test.local',
      locale: 'it',
    });
    expect(result.status).toBe('sent');
    expect(await lastSubject('ai_budget')).toBe('Budget IA usato al 81 %');
    expect(sent.at(-1)!.html).toContain('<html lang="it">');
  });
});
