import net from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import type { IntegrationsDto, MailLogDto, MailSettingsDto, Paginated } from '@weblion/shared';
import { auditLogs, mailLog, settings, users } from '../src/db/schema';
import { MailService, smtpTransport, type TransportFactory } from '../src/mail/service';
import { renderMail } from '../src/mail/templates';
import type { MailTemplateName, MailTemplates } from '../src/mail/types';
import { ADMIN, Client, createTestApp, json, type TestApp } from './helpers';

let t: TestApp;
let admin: Client;
let anna: Client;
let musterOrgId: string;

interface Captured {
  from: string;
  to: string[];
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
}
const sent: Captured[] = [];

/** Delivers into `sent` instead of an SMTP server. */
const capture: TransportFactory = () =>
  nodemailer.createTransport({
    name: 'capture',
    version: '1',
    send(mail, done) {
      const d = mail.data;
      sent.push({
        from: String(d.from),
        to: ([] as unknown[]).concat(d.to ?? []).map(String),
        replyTo: d.replyTo ? String(d.replyTo) : undefined,
        subject: String(d.subject),
        text: String(d.text),
        html: String(d.html),
      });
      done(null, { envelope: mail.message.getEnvelope(), messageId: `<test-${sent.length}@weblion.test>` });
    },
  });

/** Every delivery fails like an unreachable server. */
const broken: TransportFactory = () =>
  nodemailer.createTransport({
    name: 'broken',
    version: '1',
    send(_mail, done) {
      done(new Error('connect ECONNREFUSED 127.0.0.1:2525'), undefined);
    },
  });

const mailer = () => t.ctx.mail as MailService;
const put = (c: Client, url: string, body: unknown) => c.request('PUT', url, body);

const SETTINGS = {
  host: 'smtp.example.test',
  port: 587,
  secure: false,
  user: 'mailer@example.test',
  password: 'smtp-secret-password-42',
  from: 'weblion.one <noreply@example.test>',
  replyTo: 'support@example.test',
};

async function lastLog(template?: string) {
  const [row] = await t.db
    .select()
    .from(mailLog)
    .where(template ? eq(mailLog.template, template) : undefined)
    .orderBy(desc(mailLog.createdAt))
    .limit(1);
  return row;
}

beforeAll(async () => {
  t = await createTestApp();
  admin = new Client(t.app);
  await admin.login(ADMIN.email, ADMIN.password);
  anna = new Client(t.app);
  await anna.login('anna@muster.example');
  const orgs = json<{ id: string; slug: string }[]>(await admin.get('/admin/orgs'));
  musterOrgId = orgs.find((o) => o.slug === 'muster-ag')!.id;
});

afterEach(() => {
  sent.length = 0;
});

afterAll(async () => {
  await t?.close();
});

describe('templates', () => {
  const samples: { [K in MailTemplateName]: MailTemplates[K] } = {
    invitation: {
      orgName: 'Muster AG',
      inviterName: 'Anna Muster',
      role: 'Admin',
      link: 'https://console.example/invite/abc',
      expiresAt: '14. Oktober 2026',
    },
    invoice: {
      orgName: 'Muster AG',
      issuerName: 'weblion.one',
      invoiceNumber: 'WL-2026-0001',
      total: 'CHF 123.45',
      dueDate: '31.10.2026',
      link: 'https://console.example/o/muster-ag/billing/invoices/1',
      paid: false,
    },
    invoice_reminder: {
      orgName: 'Muster AG',
      issuerName: 'weblion.one',
      invoiceNumber: 'WL-2026-0001',
      amountDue: 'CHF 123.45',
      dueDate: '31.10.2026',
      link: 'https://console.example/o/muster-ag/billing/invoices/1',
    },
    payment_received: {
      orgName: 'Muster AG',
      amount: 'CHF 50.00',
      invoiceNumber: null,
      link: 'https://console.example/o/muster-ag/billing',
    },
    credit_booked: {
      orgName: 'Muster AG',
      amount: 'CHF 50.00',
      balance: 'CHF 80.00',
      description: 'Gutschrift',
      link: 'https://console.example/o/muster-ag/billing',
    },
    test: { sentBy: 'weblion Admin' },
  };

  it('renders every template in German and English with a text and an HTML part', () => {
    for (const name of Object.keys(samples) as MailTemplateName[]) {
      const de = renderMail(name, samples[name], 'de');
      const en = renderMail(name, samples[name], 'en');
      for (const mail of [de, en]) {
        expect(mail.subject.length).toBeGreaterThan(0);
        expect(mail.text).not.toMatch(/<[a-z]/i);
        expect(mail.html).toContain('<!doctype html>');
        expect(mail.html).toContain('#00C8CB');
        expect(mail.html).toContain('weblion.one');
        expect(mail.html).toMatch(/width="600"/);
      }
      expect(de.subject).not.toBe(en.subject);
      expect(de.html).toContain('lang="de"');
      expect(en.html).toContain('lang="en"');
    }
    const invoice = renderMail('invoice', samples.invoice, 'de');
    expect(invoice.text).toContain('CHF 123.45');
    expect(invoice.text).toContain(samples.invoice.link);
    expect(invoice.html).toContain(`href="${samples.invoice.link}"`);
    expect(renderMail('invoice', { ...samples.invoice, paid: true }, 'en').subject).toContain('(paid)');
  });

  it('escapes every interpolated value and drops unsafe links', () => {
    const mail = renderMail(
      'invitation',
      {
        orgName: '<script>alert("x")</script> & Co',
        inviterName: '<b>Mallory</b>',
        role: 'Owner',
        link: 'https://console.example/invite/a?x=1&y="2"',
        expiresAt: '<img src=x onerror=alert(1)>',
      },
      'de',
    );
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('<b>Mallory</b>');
    expect(mail.html).not.toContain('<img');
    expect(mail.html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; Co');
    expect(mail.html).toContain('href="https://console.example/invite/a?x=1&amp;y=&quot;2&quot;"');
    // The text part stays readable.
    expect(mail.text).toContain('<b>Mallory</b> hat Sie eingeladen');

    const evil = renderMail('invitation', { ...samples.invitation, link: 'javascript:alert(1)' }, 'en');
    expect(evil.html).not.toContain('javascript:');
    const header = renderMail('test', { sentBy: 'x' }, 'de');
    expect(header.subject).not.toMatch(/[\r\n]/);
    const injected = renderMail(
      'payment_received',
      { ...samples.payment_received, amount: 'CHF 1\r\nBcc: a@b.c' },
      'de',
    );
    expect(injected.subject).not.toMatch(/[\r\n]/);
  });
});

describe('settings', () => {
  it('stores SMTP settings encrypted and never returns the password', async () => {
    const initial = json<MailSettingsDto>(await admin.get('/admin/settings/mail'));
    expect(initial).toMatchObject({ source: 'none', host: null, passwordSet: false });

    const saved = await put(admin, '/admin/settings/mail', SETTINGS);
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain(SETTINGS.password);
    expect(json<MailSettingsDto>(saved)).toEqual({
      source: 'ui',
      host: SETTINGS.host,
      port: 587,
      secure: false,
      user: SETTINGS.user,
      passwordSet: true,
      from: SETTINGS.from,
      replyTo: SETTINGS.replyTo,
    });
    const row = await t.db.query.settings.findFirst({ where: eq(settings.key, 'smtp') });
    expect(JSON.stringify(row!.value)).not.toContain(SETTINGS.password);
    expect(JSON.stringify(row!.value)).not.toContain(SETTINGS.host);

    // Omitted password: keep the stored one.
    const kept = json<MailSettingsDto>(
      await put(admin, '/admin/settings/mail', { ...SETTINGS, password: undefined, port: 2525 }),
    );
    expect(kept).toMatchObject({ port: 2525, passwordSet: true });
    expect(await mailer().isConfigured()).toBe(true);
    const audits = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'settings.mail_update'));
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toContain(SETTINGS.password);

    // Empty password: remove it.
    const cleared = json<MailSettingsDto>(
      await put(admin, '/admin/settings/mail', { ...SETTINGS, password: '' }),
    );
    expect(cleared.passwordSet).toBe(false);
  });

  it('validates input and keeps customers out', async () => {
    expect(
      (await put(admin, '/admin/settings/mail', { ...SETTINGS, from: 'not an address' })).statusCode,
    ).toBe(400);
    expect((await put(admin, '/admin/settings/mail', { ...SETTINGS, port: 70000 })).statusCode).toBe(400);
    expect(
      (await put(admin, '/admin/settings/mail', { ...SETTINGS, from: 'a@b.ch\r\nBcc: x@y.ch' })).statusCode,
    ).toBe(400);
    expect((await anna.get('/admin/settings/mail')).statusCode).toBe(403);
    expect((await put(anna, '/admin/settings/mail', SETTINGS)).statusCode).toBe(403);
    expect((await anna.post('/admin/settings/mail/test', { to: 'a@b.ch' })).statusCode).toBe(403);
    expect((await anna.get('/admin/mail-log')).statusCode).toBe(403);
  });

  it('treats SMTP_* environment variables as read only', async () => {
    const env = t.ctx.env;
    Object.assign(env, { SMTP_HOST: 'smtp.env.test', SMTP_USER: 'env-user', SMTP_PASSWORD: 'env-secret-pw' });
    try {
      const res = await admin.get('/admin/settings/mail');
      expect(res.body).not.toContain('env-secret-pw');
      expect(json<MailSettingsDto>(res)).toMatchObject({
        source: 'env',
        host: 'smtp.env.test',
        user: 'env-user',
        passwordSet: true,
      });
      expect((await put(admin, '/admin/settings/mail', SETTINGS)).statusCode).toBe(409);
      const integrations = json<IntegrationsDto>(await admin.get('/admin/integrations'));
      expect(integrations.mail).toEqual({ configured: true, source: 'env' });
    } finally {
      Object.assign(env, { SMTP_HOST: undefined, SMTP_USER: undefined, SMTP_PASSWORD: undefined });
    }
    expect(json<MailSettingsDto>(await admin.get('/admin/settings/mail')).source).toBe('ui');
  });

  it('removes the stored settings', async () => {
    const res = await admin.del('/admin/settings/mail');
    expect(json<MailSettingsDto>(res)).toMatchObject({ source: 'none', host: null, passwordSet: false });
    expect(await mailer().isConfigured()).toBe(false);
    // Without SMTP every mail is skipped and still logged.
    const result = json(await admin.post('/admin/settings/mail/test', { to: 'ops@example.test' }));
    expect(result).toEqual({ status: 'skipped', error: 'SMTP is not configured' });
    expect(await lastLog('test')).toMatchObject({ status: 'skipped', to: 'ops@example.test' });
  });
});

describe('delivery', () => {
  it('sends a test mail and logs it as sent', async () => {
    mailer().useTransportFactory(capture);
    await put(admin, '/admin/settings/mail', SETTINGS);
    const res = await admin.post('/admin/settings/mail/test', { to: 'ops@example.test' });
    expect(json(res)).toEqual({ status: 'sent' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      from: SETTINGS.from,
      to: ['ops@example.test'],
      replyTo: SETTINGS.replyTo,
      subject: 'Test-E-Mail von weblion.one',
    });
    expect(sent[0]!.text).toContain('weblion Admin');
    expect(sent[0]!.html).toContain('weblion Admin');

    const log = json<Paginated<MailLogDto>>(await admin.get('/admin/mail-log?status=sent'));
    expect(log.items[0]).toMatchObject({
      to: 'ops@example.test',
      template: 'test',
      status: 'sent',
      error: null,
      org: null,
    });
    expect(log.total).toBeGreaterThanOrEqual(1);
    const audit = await t.db.query.auditLogs.findFirst({ where: eq(auditLogs.action, 'settings.mail_test') });
    expect(audit).toBeTruthy();
  });

  it('logs a failing transport as failed without throwing', async () => {
    mailer().useTransportFactory(broken);
    const res = await admin.post('/admin/settings/mail/test', { to: 'ops@example.test' });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({ status: 'failed', error: expect.stringContaining('ECONNREFUSED') });
    const direct = await t.ctx.mail.send(
      'test',
      { sentBy: 'x' },
      { to: 'a@example.test', orgId: musterOrgId },
    );
    expect(direct.status).toBe('failed');
    const log = json<Paginated<MailLogDto>>(await admin.get('/admin/mail-log?status=failed&perPage=1'));
    expect(log.items[0]).toMatchObject({ status: 'failed', org: { id: musterOrgId, name: 'Muster AG' } });
    expect(log.items[0]!.error).toContain('ECONNREFUSED');
    mailer().useTransportFactory(capture);
  });

  it('talks SMTP to a real server and fails cleanly when it is gone', async () => {
    const smtp = await mockSmtpServer();
    mailer().useTransportFactory(smtpTransport);
    try {
      await put(admin, '/admin/settings/mail', {
        host: '127.0.0.1',
        port: smtp.port,
        secure: false,
        user: null,
        password: '',
        from: 'noreply@example.test',
        replyTo: null,
      });
      const res = await admin.post('/admin/settings/mail/test', { to: 'ops@example.test' });
      expect(json(res)).toEqual({ status: 'sent' });
      expect(smtp.messages).toHaveLength(1);
      expect(smtp.messages[0]!.rcpt).toEqual(['<ops@example.test>']);
      expect(smtp.messages[0]!.data).toContain('multipart/alternative');
      expect(smtp.messages[0]!.data).toMatch(/text\/plain/);
      expect(smtp.messages[0]!.data).toMatch(/text\/html/);
    } finally {
      await smtp.close();
    }
    const res = await admin.post('/admin/settings/mail/test', { to: 'ops@example.test' });
    expect(json(res)).toMatchObject({ status: 'failed' });
    expect(await lastLog('test')).toMatchObject({ status: 'failed' });
    mailer().useTransportFactory(capture);
    await put(admin, '/admin/settings/mail', SETTINGS);
  });
});

describe('invitations', () => {
  it('emails org invitations in the inviter’s language', async () => {
    mailer().useTransportFactory(capture);
    await put(admin, '/admin/settings/mail', SETTINGS);
    const res = await anna.post(`/orgs/${musterOrgId}/invitations`, {
      email: 'neu@muster.example',
      role: 'member',
    });
    expect(res.statusCode).toBe(200);
    const { link } = json<{ link: string }>(res);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: ['neu@muster.example'],
      subject: 'Einladung zu Muster AG auf weblion.one',
    });
    expect(sent[0]!.text).toContain(link);
    expect(sent[0]!.text).toContain('Anna Muster');
    expect(sent[0]!.html).toContain(`href="${link}"`);
    expect(await lastLog('invitation')).toMatchObject({ status: 'sent', orgId: musterOrgId });

    await t.db.update(users).set({ locale: 'en' }).where(eq(users.email, 'anna@muster.example'));
    try {
      const english = new Client(t.app);
      await english.login('anna@muster.example');
      await english.post(`/orgs/${musterOrgId}/invitations`, { email: 'new@muster.example', role: 'viewer' });
      expect(sent[1]).toMatchObject({ subject: 'Invitation to Muster AG on weblion.one' });
      expect(sent[1]!.text).toContain('Read only');
    } finally {
      await t.db.update(users).set({ locale: 'de' }).where(eq(users.email, 'anna@muster.example'));
    }
  });

  it('emails the owner invitation of a new customer created by an admin', async () => {
    mailer().useTransportFactory(capture);
    const created = json<{ id: string; inviteLink: string; mail: { status: string } }>(
      await admin.post('/admin/orgs', { name: 'Mailkunde AG', ownerEmail: 'chefin@mailkunde.example' }),
    );
    expect(created.mail).toEqual({ status: 'sent' });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual(['chefin@mailkunde.example']);
    expect(sent[0]!.text).toContain(created.inviteLink);
    const row = await t.db.query.mailLog.findFirst({
      where: and(eq(mailLog.orgId, created.id), eq(mailLog.template, 'invitation')),
    });
    expect(row?.status).toBe('sent');
  });

  it('still returns the invitation link when the mail fails', async () => {
    mailer().useTransportFactory(broken);
    try {
      const res = await anna.post(`/orgs/${musterOrgId}/invitations`, {
        email: 'third@muster.example',
        role: 'viewer',
      });
      expect(res.statusCode).toBe(200);
      expect(json<{ link: string }>(res).link).toContain('/invite/');
      expect(await lastLog('invitation')).toMatchObject({ status: 'failed', to: 'third@muster.example' });
    } finally {
      mailer().useTransportFactory(capture);
    }
  });
});

describe('integrations', () => {
  it('summarizes mail, Stripe and Zoho without secrets', async () => {
    const env = t.ctx.env;
    const before = json<IntegrationsDto>(await admin.get('/admin/integrations'));
    expect(before.stripe).toEqual({ configured: false, mode: null, webhookConfigured: false, twint: false });
    expect(before.mail).toEqual({ configured: true, source: 'ui' });
    expect(before.zoho).toMatchObject({ configured: false });

    Object.assign(env, { STRIPE_SECRET_KEY: 'sk_test_abc123secret', STRIPE_WEBHOOK_SECRET: 'whsec_123' });
    try {
      const res = await admin.get('/admin/integrations');
      expect(res.body).not.toContain('sk_test_abc123secret');
      expect(json<IntegrationsDto>(res).stripe).toEqual({
        configured: true,
        mode: 'test',
        webhookConfigured: true,
        twint: true,
      });
      Object.assign(env, { STRIPE_SECRET_KEY: 'sk_live_abc', STRIPE_PAYMENT_METHODS: 'card' });
      expect(json<IntegrationsDto>(await admin.get('/admin/integrations')).stripe).toMatchObject({
        mode: 'live',
        twint: false,
      });
    } finally {
      Object.assign(env, {
        STRIPE_SECRET_KEY: undefined,
        STRIPE_WEBHOOK_SECRET: undefined,
        STRIPE_PAYMENT_METHODS: 'card,twint',
      });
    }
    expect((await anna.get('/admin/integrations')).statusCode).toBe(403);
  });
});

/** Just enough SMTP to accept messages: EHLO, MAIL, RCPT, DATA, QUIT. */
async function mockSmtpServer() {
  const messages: { from: string; rcpt: string[]; data: string }[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buffer = '';
    let inData = false;
    let current = { from: '', rcpt: [] as string[], data: '' };
    socket.write('220 mock ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end === -1) return;
          current.data = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          messages.push(current);
          current = { from: '', rcpt: [], data: '' };
          inData = false;
          socket.write('250 OK queued\r\n');
          continue;
        }
        const eol = buffer.indexOf('\r\n');
        if (eol === -1) return;
        const line = buffer.slice(0, eol);
        buffer = buffer.slice(eol + 2);
        const verb = line.split(' ')[0]!.toUpperCase();
        if (verb === 'EHLO' || verb === 'HELO') socket.write('250-mock\r\n250 8BITMIME\r\n');
        else if (verb === 'MAIL') {
          current.from = line.slice(10);
          socket.write('250 OK\r\n');
        } else if (verb === 'RCPT') {
          current.rcpt.push(line.slice(8));
          socket.write('250 OK\r\n');
        } else if (verb === 'DATA') {
          inData = true;
          socket.write('354 go ahead\r\n');
        } else if (verb === 'QUIT') {
          socket.end('221 bye\r\n');
          return;
        } else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    messages,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
