import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { MAIL_MIB, mailClientSettings } from '@weblion/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mailDomains, organizations, providerConnections } from '../src/db/schema';
import { seedDemo } from '../src/db/seed';
import { seedMailDemo } from '../src/db/seed-mail';
import { AppError } from '../src/lib/errors';
import { DemoAdapter } from '../src/providers/demo/adapter';
import {
  DEMO_MAIL_DOMAINS,
  DEMO_MAIL_HOST,
  DEMO_MAIL_POLICY,
  DemoMail,
  demoDkimKey,
  demoMailState,
  resetDemoMail,
} from '../src/providers/demo/mail';
import type { MailDomainInput, MailDomainLimitsInput, MailboxInput } from '../src/providers/types';
import { DEMO_PASSWORD, createTestApp, type TestApp } from './helpers';

const GiB = 1024 ** 3;
const T0 = Date.parse('2026-10-11T12:00:00.000Z');
const SEEDED_AT = '2024-03-01T10:00:00.000Z';
/** Passes the demo policy and the panel's minimum of 10 characters. */
const PASSWORD = 'Sicher-Passwort';
const DKIM_PREFIX = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA';

const used = (gb: number) => Math.round(gb * GiB);
const messages = (gb: number) => Math.round(used(gb) / 153_600);

async function caught(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return err as AppError;
  }
  throw new Error('expected the promise to reject');
}

async function refused(promise: Promise<unknown>, status: number, message?: string): Promise<AppError> {
  const err = await caught(promise);
  expect(err.statusCode).toBe(status);
  if (message !== undefined) expect(err.message).toBe(message);
  return err;
}

const LIMITS: MailDomainLimitsInput = {
  maxMailboxes: 10,
  maxAliases: 50,
  quotaMb: 10_240,
  defaultMailboxQuotaMb: 2048,
  maxMailboxQuotaMb: 5120,
  rateLimit: null,
};

const domainInput = (domain: string, extra: Partial<MailDomainInput> = {}): MailDomainInput => ({
  domain,
  description: null,
  limits: { ...LIMITS },
  dkim: { selector: 'dkim', keySize: 2048 },
  restartSogo: true,
  ...extra,
});

describe('Demo Mailcow', () => {
  let id: string;
  const mail = () => new DemoAdapter(id, {});
  const mailbox = (domain: string, localPart: string, extra: Partial<MailboxInput> = {}) =>
    mail().createMailbox({ localPart, domain, name: null, quotaMb: 1024, password: PASSWORD, ...extra });

  beforeEach(() => {
    resetDemoMail();
    id = randomUUID();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('seeds six mail domains with their limits, usage, mailboxes and aliases', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const domains = await mail().listMailDomains();
    expect(domains.map((d) => d.externalId)).toEqual([
      'alpen-hosting.ch',
      'alpenblick-hotel.ch',
      'baeckerei-huber.ch',
      'muster-ag.ch',
      'muster-shop.ch',
      'xn--mller-kva.ch',
    ]);
    expect(DEMO_MAIL_DOMAINS.map((d) => d.name).sort()).toEqual(domains.map((d) => d.externalId));

    const musterAg = domains.find((d) => d.externalId === 'muster-ag.ch')!;
    expect(musterAg.info).toEqual({
      name: 'muster-ag.ch',
      displayName: 'muster-ag.ch',
      description: 'Muster AG',
      active: true,
      relay: false,
      limits: {
        maxMailboxes: 25,
        maxAliases: 100,
        quotaBytes: 51_200 * MAIL_MIB,
        defaultMailboxQuotaBytes: 2048 * MAIL_MIB,
        maxMailboxQuotaBytes: 10_240 * MAIL_MIB,
        rateLimit: { value: 500, frame: 'h' },
      },
      usage: {
        mailboxes: 4,
        aliases: 4,
        allocatedBytes: 27_648 * MAIL_MIB,
        usedBytes: used(3.4) + used(1.1) + used(0.6) + used(7.9),
        messages: messages(3.4) + messages(1.1) + messages(0.6) + messages(7.9),
      },
      createdAt: SEEDED_AT,
      modifiedAt: null,
    });
    const byName = Object.fromEntries(domains.map((d) => [d.externalId, d.info]));
    expect(byName['xn--mller-kva.ch']).toMatchObject({
      name: 'xn--mller-kva.ch',
      displayName: 'müller.ch',
      description: null,
      usage: { mailboxes: 0, aliases: 0, allocatedBytes: 0, usedBytes: 0, messages: 0 },
    });
    expect(byName['alpenblick-hotel.ch']).toMatchObject({ relay: true, description: 'Hotel Alpenblick AG' });
    expect(byName['muster-shop.ch']!.limits).toEqual({
      maxMailboxes: 5,
      maxAliases: 20,
      quotaBytes: 10_240 * MAIL_MIB,
      defaultMailboxQuotaBytes: 1024 * MAIL_MIB,
      maxMailboxQuotaBytes: 5120 * MAIL_MIB,
      rateLimit: null,
    });
    expect(byName['baeckerei-huber.ch']).toMatchObject({
      description: 'Bäckerei Huber',
      limits: { rateLimit: { value: 100, frame: 'h' } },
      usage: { mailboxes: 2, aliases: 1, allocatedBytes: 3072 * MAIL_MIB },
    });
    expect(byName['alpen-hosting.ch']!.usage).toMatchObject({ mailboxes: 1, aliases: 0 });
    expect(await mail().getMailDomain('Muster-AG.ch')).toEqual(musterAg);

    expect(await mail().listMailboxes('muster-ag.ch')).toEqual([
      {
        address: 'anna@muster-ag.ch',
        localPart: 'anna',
        name: 'Anna Muster',
        state: 'active',
        quotaBytes: 10_240 * MAIL_MIB,
        usedBytes: used(3.4),
        messages: messages(3.4),
        lastLoginAt: new Date(T0 - 2 * 3_600_000).toISOString(),
        createdAt: SEEDED_AT,
        modifiedAt: null,
      },
      expect.objectContaining({ address: 'ben@muster-ag.ch', state: 'active' }),
      expect.objectContaining({
        address: 'buchhaltung@muster-ag.ch',
        state: 'inactive',
        lastLoginAt: new Date(T0 - 60 * 86_400_000).toISOString(),
      }),
      expect.objectContaining({ address: 'info@muster-ag.ch', state: 'login_disabled', lastLoginAt: null }),
    ]);
    // Catch-all last, special targets as such, no passwords anywhere.
    const aliases = await mail().listMailAliases('muster-ag.ch');
    expect(aliases.map((a) => [a.id, a.address, a.targets, a.special, a.active])).toEqual([
      ['2', 'kontakt@muster-ag.ch', ['info@muster-ag.ch'], null, true],
      ['4', 'noreply@muster-ag.ch', [], 'discard', true],
      ['1', 'team@muster-ag.ch', ['anna@muster-ag.ch', 'ben@muster-ag.ch'], null, true],
      ['3', '@muster-ag.ch', ['info@muster-ag.ch'], null, false],
    ]);
    expect(aliases.at(-1)!.catchAll).toBe(true);
    expect(await mail().listMailAliases('muster-shop.ch')).toEqual([
      expect.objectContaining({
        id: '5',
        targets: ['shop@muster-shop.ch', 'anna@muster-ag.ch'],
        catchAll: false,
      }),
    ]);
    expect(JSON.stringify(await mail().listMailboxes('muster-ag.ch'))).not.toContain('Demo-Passwort');
    expect(demoMailState(id).domains.get('muster-ag.ch')!.mailboxes.get('anna')!.password).toBe(
      'Demo-Passwort-2024',
    );
    expect(demoMailState(id).nextAliasId).toBe(100);

    expect((await mail().overview()).facts).toContainEqual({ label: 'Mail domains', value: '6' });
    await refused(mail().getMailDomain('unknown.ch'), 404);
    await refused(mail().listMailboxes('unknown.ch'), 404);
    await refused(mail().listMailAliases('unknown.ch'), 404);
  });

  it('returns copies, never the stored objects', async () => {
    const domain = await mail().getMailDomain('muster-ag.ch');
    domain.info.limits.rateLimit!.value = 1;
    domain.info.usage.mailboxes = 99;
    const [alias] = await mail().listMailAliases('muster-shop.ch');
    alias!.targets.push('evil@example.com');
    const dkim = (await mail().getDkim('muster-ag.ch'))!;
    dkim.publicKey = 'changed';
    const policy = await mail().mailPasswordPolicy();
    policy.minLength = 1;

    expect((await mail().getMailDomain('muster-ag.ch')).info).toMatchObject({
      limits: { rateLimit: { value: 500 } },
      usage: { mailboxes: 4 },
    });
    expect((await mail().getMailAlias('5')).targets).toEqual(['shop@muster-shop.ch', 'anna@muster-ag.ch']);
    expect((await mail().getDkim('muster-ag.ch'))!.publicKey).toBe(
      demoDkimKey('muster-ag.ch', 2048).publicKey,
    );
    expect(await mail().mailPasswordPolicy()).toEqual(DEMO_MAIL_POLICY);
  });

  describe('mail domains', () => {
    it('creates mail domains with their DKIM key and refuses what Mailcow refuses', async () => {
      const { domain, warnings } = await mail().createMailDomain(
        domainInput('xn--bcher-kva.ch', {
          limits: { ...LIMITS, rateLimit: { value: 200, frame: 'm' } },
          dkim: { selector: 'mail2026', keySize: 4096 },
        }),
      );
      expect(warnings).toEqual([]);
      expect(domain.externalId).toBe('xn--bcher-kva.ch');
      expect(domain.info).toMatchObject({
        name: 'xn--bcher-kva.ch',
        displayName: 'bücher.ch',
        // Without a description the Mailcow adapter sends the name, which Mailcow keeps.
        description: 'xn--bcher-kva.ch',
        active: true,
        relay: false,
        limits: {
          maxMailboxes: 10,
          maxAliases: 50,
          quotaBytes: 10_240 * MAIL_MIB,
          defaultMailboxQuotaBytes: 2048 * MAIL_MIB,
          maxMailboxQuotaBytes: 5120 * MAIL_MIB,
          rateLimit: { value: 200, frame: 'm' },
        },
        usage: { mailboxes: 0, aliases: 0, allocatedBytes: 0, usedBytes: 0, messages: 0 },
        modifiedAt: null,
      });
      expect(await mail().getMailDomain('xn--bcher-kva.ch')).toEqual(domain);
      const key = (await mail().getDkim('xn--bcher-kva.ch'))!;
      expect(key).toMatchObject({ selector: 'mail2026', keyLength: '4096' });
      expect(key.publicKey).toHaveLength(736);
      expect(
        (await mail().createMailDomain(domainInput('kunde.ch', { description: 'Kunde AG' }))).domain.info,
      ).toMatchObject({ description: 'Kunde AG', limits: { rateLimit: null } });
      expect((await mail().listMailDomains()).map((d) => d.externalId)).toContain('kunde.ch');

      const create = (input: MailDomainInput) => mail().createMailDomain(input);
      await refused(
        create(domainInput('Kunde2.ch')),
        400,
        'create mail domain Kunde2.ch failed: Domain name is empty or invalid',
      );
      await refused(create(domainInput('bücher.ch')), 400);
      await refused(create(domainInput('localhost')), 400);
      await refused(
        create(domainInput(DEMO_MAIL_HOST)),
        400,
        `create mail domain ${DEMO_MAIL_HOST} failed: Domain cannot match hostname`,
      );
      await refused(
        create(domainInput('muster-ag.ch')),
        409,
        'create mail domain muster-ag.ch failed: Domain muster-ag.ch already exists',
      );
      const limits = (patch: Partial<MailDomainLimitsInput>) =>
        create(domainInput('neu.ch', { limits: { ...LIMITS, ...patch } }));
      await refused(limits({ defaultMailboxQuotaMb: 6000 }), 400);
      await refused(limits({ maxMailboxQuotaMb: 20_000 }), 400);
      await refused(limits({ maxAliases: 0 }), 400);
      await refused(limits({ maxMailboxes: -1 }), 400);
      await refused(limits({ quotaMb: 1.5 }), 400);
      await refused(limits({ rateLimit: { value: 0, frame: 'h' } }), 400);
      await refused(limits({ rateLimit: { value: 1_000_001, frame: 'h' } }), 400);
      await refused(limits({ rateLimit: { value: 10, frame: 'w' as 'h' } }), 400);
      await refused(create(domainInput('neu.ch', { dkim: { selector: 'dkim', keySize: 1024 } })), 400);
      await refused(create(domainInput('neu.ch', { dkim: { selector: '-dkim', keySize: 2048 } })), 400);
      // Nothing of the refused domains was stored.
      await refused(mail().getMailDomain('neu.ch'), 404);
      expect(await mail().getDkim('neu.ch')).toBeNull();
      // A maximum of 0 mailboxes is a valid limit (a domain for aliases only).
      expect((await limits({ maxMailboxes: 0 })).domain.info.limits.maxMailboxes).toBe(0);
    });

    it('refuses limits below what is in use with Mailcow texts and removes the rate limit', async () => {
      const update = (patch: object) => mail().updateMailDomain('muster-ag.ch', patch);
      const prefix = 'change mail domain muster-ag.ch failed: ';
      await refused(
        update({ maxMailboxes: 3 }),
        409,
        `${prefix}Max. mailboxes must be greater or equal to 4`,
      );
      await refused(update({ maxAliases: 3 }), 409, `${prefix}Max. aliases must be greater or equal to 4`);
      await refused(
        update({ quotaMb: 20_000 }),
        409,
        `${prefix}Domain quota must be greater or equal to 27648 MiB`,
      );
      await refused(
        update({ maxMailboxQuotaMb: 5000 }),
        409,
        `${prefix}Mailbox quota must be greater or equal to 10240 MiB`,
      );
      // The first of Mailcow's checks wins.
      await refused(
        update({ maxMailboxes: 1, maxAliases: 1, quotaMb: 10_240 }),
        409,
        `${prefix}Max. mailboxes must be greater or equal to 4`,
      );
      // The ordering rule and the values the panel never sends.
      await refused(update({ defaultMailboxQuotaMb: 20_000 }), 400);
      await refused(update({ maxMailboxQuotaMb: 60_000 }), 400);
      await refused(update({ maxAliases: 0 }), 400);
      await refused(update({ defaultMailboxQuotaMb: 0 }), 400);
      await refused(update({ rateLimit: { value: 0, frame: 'h' } }), 400);
      await refused(mail().updateMailDomain('unknown.ch', { maxMailboxes: 5 }), 404);
      // A refused change changes nothing, not even the fields that were fine.
      await refused(update({ maxMailboxes: 30, quotaMb: 20_000 }), 409);
      const unchanged = (await mail().getMailDomain('muster-ag.ch')).info;
      expect(unchanged.limits.maxMailboxes).toBe(25);
      expect(unchanged.modifiedAt).toBeNull();

      await update({ maxMailboxes: 4, maxAliases: 4, quotaMb: 27_648, rateLimit: null, active: false });
      const changed = (await mail().getMailDomain('muster-ag.ch')).info;
      expect(changed).toMatchObject({
        active: false,
        limits: { maxMailboxes: 4, maxAliases: 4, quotaBytes: 27_648 * MAIL_MIB, rateLimit: null },
      });
      expect(changed.modifiedAt).not.toBeNull();
      // Fields left out keep their value.
      await mail().updateMailDomain('muster-shop.ch', { rateLimit: { value: 50, frame: 'd' } });
      expect((await mail().getMailDomain('muster-shop.ch')).info.limits).toMatchObject({
        maxMailboxes: 5,
        quotaBytes: 10_240 * MAIL_MIB,
        rateLimit: { value: 50, frame: 'd' },
      });
    });

    it('deletes only empty mail domains, with their aliases but not their DKIM key', async () => {
      const key = await mail().getDkim('muster-ag.ch');
      expect(key).toEqual(demoDkimKey('muster-ag.ch', 2048));
      await refused(
        mail().deleteMailDomain('muster-ag.ch'),
        409,
        'delete mail domain muster-ag.ch failed: Cannot remove non-empty domain muster-ag.ch',
      );
      expect((await mail().listMailboxes('muster-ag.ch')).length).toBe(4);

      for (const m of await mail().listMailboxes('muster-ag.ch')) await mail().deleteMailbox(m.address);
      expect(await mail().deleteMailDomain('muster-ag.ch')).toEqual({ warnings: [] });
      await refused(mail().getMailDomain('muster-ag.ch'), 404);
      await refused(mail().listMailAliases('muster-ag.ch'), 404);
      await refused(mail().getMailAlias('1'), 404);
      await refused(mail().getMailAlias('4'), 404);
      expect(await mail().getDkim('muster-ag.ch')).toEqual(key);
      await refused(mail().deleteMailDomain('muster-ag.ch'), 404);

      // Created again, the domain keeps the key that was left (Mailcow: domain_add_dkim_available).
      await mail().createMailDomain(
        domainInput('muster-ag.ch', { dkim: { selector: 'dkim', keySize: 4096 } }),
      );
      expect(await mail().getDkim('muster-ag.ch')).toEqual(key);
      expect((await mail().getMailDomain('muster-ag.ch')).info.usage).toMatchObject({
        mailboxes: 0,
        aliases: 0,
      });
    });
  });

  describe('mailboxes', () => {
    it('creates mailboxes within the limits and refuses like Mailcow', async () => {
      const created = await mailbox('muster-shop.ch', 'kasse', { name: 'Kasse', quotaMb: 5120 });
      expect(created).toEqual({
        address: 'kasse@muster-shop.ch',
        localPart: 'kasse',
        name: 'Kasse',
        state: 'active',
        quotaBytes: 5120 * MAIL_MIB,
        usedBytes: 0,
        messages: 0,
        lastLoginAt: null,
        createdAt: expect.any(String),
        modifiedAt: null,
      });
      expect(await mail().getMailbox('KASSE@muster-shop.ch')).toEqual(created);
      expect(demoMailState(id).domains.get('muster-shop.ch')!.mailboxes.get('kasse')!.password).toBe(
        PASSWORD,
      );
      expect((await mailbox('muster-shop.ch', 'ohne-name')).name).toBeNull();

      const prefix = (address: string) => `create mailbox ${address} failed: `;
      // Above the largest mailbox size, then above the storage that is left (10240 - 2048 - 5120 - 1024).
      await refused(
        mailbox('muster-shop.ch', 'gross', { quotaMb: 5121 }),
        409,
        `${prefix('gross@muster-shop.ch')}Quota exceeds the domain limit (max. 5120 MiB)`,
      );
      await refused(
        mailbox('muster-shop.ch', 'gross', { quotaMb: 3000 }),
        409,
        `${prefix('gross@muster-shop.ch')}Not enough space left (space left: 2048 MiB)`,
      );
      await refused(mailbox('muster-shop.ch', 'null', { quotaMb: 0 }), 400);
      // Policy: letters in upper and lower case, and the panel's 10 characters.
      await refused(
        mailbox('muster-shop.ch', 'schwach', { password: 'nur-kleinbuchstaben' }),
        400,
        `${prefix('schwach@muster-shop.ch')}Password does not meet the policy`,
      );
      await refused(mailbox('muster-shop.ch', 'kurz', { password: 'Kurz-Pw' }), 400);
      // Existing mailbox, alias address, invalid name, unknown domain; in Mailcow's order.
      await refused(
        mailbox('muster-shop.ch', 'shop', { password: 'schwach' }),
        409,
        `${prefix('shop@muster-shop.ch')}Object shop@muster-shop.ch already exists`,
      );
      await refused(
        mailbox('muster-shop.ch', 'bestellungen'),
        409,
        `${prefix('bestellungen@muster-shop.ch')}bestellungen@muster-shop.ch is already known as an alias address`,
      );
      await refused(
        mailbox('muster-shop.ch', 'Anna'),
        400,
        `${prefix('Anna@muster-shop.ch')}Mailbox name is invalid`,
      );
      await refused(mailbox('muster-shop.ch', 'a+b'), 400);
      await refused(mailbox('muster-shop.ch', '.anna'), 400);
      await refused(mailbox('unknown.ch', 'anna'), 404);

      // Fill the domain to its 5 mailboxes: the sixth is refused before its size is looked at.
      await mailbox('muster-shop.ch', 'lager', { quotaMb: 512 });
      await mailbox('muster-shop.ch', 'buero', { quotaMb: 512 });
      expect((await mail().getMailDomain('muster-shop.ch')).info.usage).toMatchObject({
        mailboxes: 5,
        allocatedBytes: 9216 * MAIL_MIB,
      });
      await refused(
        mailbox('muster-shop.ch', 'sechs', { quotaMb: 1 }),
        409,
        `${prefix('sechs@muster-shop.ch')}Max. mailboxes exceeded (5 of 5)`,
      );
      expect(await mail().listMailboxes('muster-shop.ch')).toHaveLength(5);
    });

    it('changes mailboxes, refuses an empty name and sizes above what is left', async () => {
      const prefix = 'change mailbox shop@muster-shop.ch failed: ';
      await refused(mail().updateMailbox('shop@muster-shop.ch', { name: '' }), 400);
      await refused(mail().updateMailbox('shop@muster-shop.ch', { name: '   ' }), 400);
      await refused(mail().updateMailbox('shop@muster-shop.ch', { name: 'a<b>' }), 400);
      await refused(mail().updateMailbox('shop@muster-shop.ch', { name: 'x'.repeat(256) }), 400);
      expect((await mail().getMailbox('shop@muster-shop.ch')).name).toBe('Webshop');

      // 10240 MiB storage, the other mailboxes take 5120 + 2048: 3072 are left for shop@.
      await mailbox('muster-shop.ch', 'gross', { quotaMb: 5120 });
      await mailbox('muster-shop.ch', 'mittel', { quotaMb: 2048 });
      await refused(
        mail().updateMailbox('shop@muster-shop.ch', { quotaMb: 3073 }),
        409,
        `${prefix}Not enough space left (space left: 3072 MiB)`,
      );
      // Never more than the largest mailbox size, even with storage left.
      await refused(mail().updateMailbox('anna@muster-ag.ch', { quotaMb: 10_241 }), 409);
      await refused(mail().updateMailbox('shop@muster-shop.ch', { quotaMb: 0 }), 400);
      // A refused change keeps every field.
      await refused(mail().updateMailbox('shop@muster-shop.ch', { name: 'Neu', quotaMb: 4000 }), 409);
      expect(await mail().getMailbox('shop@muster-shop.ch')).toMatchObject({
        name: 'Webshop',
        quotaBytes: 2048 * MAIL_MIB,
        modifiedAt: null,
      });

      await mail().updateMailbox('shop@muster-shop.ch', { quotaMb: 3072, name: ' Webshop Kasse ' });
      expect(await mail().getMailbox('shop@muster-shop.ch')).toMatchObject({
        name: 'Webshop Kasse',
        quotaBytes: 3072 * MAIL_MIB,
        modifiedAt: expect.any(String),
      });
      // Below the usage is allowed (Mailcow then refuses new mail); usage stays as it is.
      await mail().updateMailbox('buchhaltung@muster-ag.ch', { quotaMb: 1024 });
      expect(await mail().getMailbox('buchhaltung@muster-ag.ch')).toMatchObject({
        quotaBytes: 1024 * MAIL_MIB,
        usedBytes: used(7.9),
      });

      for (const state of ['login_disabled', 'inactive', 'active'] as const) {
        await mail().updateMailbox('anna@muster-ag.ch', { state });
        expect((await mail().getMailbox('anna@muster-ag.ch')).state).toBe(state);
      }
      expect(demoMailState(id).domains.get('muster-ag.ch')!.mailboxes.get('info')!.active).toBe(2);
      await refused(mail().updateMailbox('nobody@muster-ag.ch', { state: 'active' }), 404);
      await refused(mail().updateMailbox('anna@unknown.ch', { state: 'active' }), 404);
      await refused(mail().getMailbox('anna'), 404);
    });

    it('sets passwords that meet the policy', async () => {
      await mail().setMailboxPassword('anna@muster-ag.ch', 'Neues-Passwort-1');
      const anna = demoMailState(id).domains.get('muster-ag.ch')!.mailboxes.get('anna')!;
      expect(anna.password).toBe('Neues-Passwort-1');
      expect(anna.modifiedAt).not.toBeNull();
      await refused(
        mail().setMailboxPassword('anna@muster-ag.ch', 'alles-klein-hier'),
        400,
        'set the password of anna@muster-ag.ch failed: Password does not meet the policy',
      );
      expect(anna.password).toBe('Neues-Passwort-1');
      await refused(mail().setMailboxPassword('nobody@muster-ag.ch', PASSWORD), 404);
    });

    it('removes a deleted mailbox from the aliases of the whole instance', async () => {
      await mail().deleteMailbox('ben@muster-ag.ch');
      await refused(mail().getMailbox('ben@muster-ag.ch'), 404);
      expect((await mail().getMailAlias('1')).targets).toEqual(['anna@muster-ag.ch']);
      expect((await mail().getMailAlias('1')).modifiedAt).not.toBeNull();

      // info@ was the only target of kontakt@ and of the catch-all: both are deleted.
      await mail().deleteMailbox('info@muster-ag.ch');
      expect((await mail().listMailAliases('muster-ag.ch')).map((a) => a.address)).toEqual([
        'noreply@muster-ag.ch',
        'team@muster-ag.ch',
      ]);
      await refused(mail().getMailAlias('2'), 404);
      await refused(mail().getMailAlias('3'), 404);

      // An alias of another domain loses the address as well.
      await mail().deleteMailbox('anna@muster-ag.ch');
      expect((await mail().getMailAlias('5')).targets).toEqual(['shop@muster-shop.ch']);
      await refused(mail().getMailAlias('1'), 404);
      expect((await mail().getMailDomain('muster-ag.ch')).info.usage).toMatchObject({
        mailboxes: 1,
        aliases: 1,
        allocatedBytes: 10_240 * MAIL_MIB,
      });
      await refused(mail().deleteMailbox('anna@muster-ag.ch'), 404);
    });
  });

  describe('aliases', () => {
    it('creates aliases and catch-alls and refuses like Mailcow', async () => {
      const catchAll = await mail().createMailAlias({
        address: '@muster-shop.ch',
        targets: ['Shop@Muster-Shop.ch', 'shop@muster-shop.ch'],
        active: true,
      });
      expect(catchAll).toEqual({
        id: '100',
        address: '@muster-shop.ch',
        catchAll: true,
        targets: ['shop@muster-shop.ch'],
        special: null,
        active: true,
        createdAt: expect.any(String),
        modifiedAt: null,
      });
      const external = await mail().createMailAlias({
        address: 'Info@muster-shop.ch',
        targets: ['jemand@example.com', 'anna@muster-ag.ch'],
        active: false,
      });
      expect(external).toMatchObject({
        id: '101',
        address: 'info@muster-shop.ch',
        catchAll: false,
        targets: ['jemand@example.com', 'anna@muster-ag.ch'],
        active: false,
      });
      expect(await mail().getMailAlias('101')).toEqual(external);
      expect((await mail().listMailAliases('muster-shop.ch')).map((a) => a.address)).toEqual([
        'bestellungen@muster-shop.ch',
        'info@muster-shop.ch',
        '@muster-shop.ch',
      ]);

      const create = (address: string, targets: string[]) =>
        mail().createMailAlias({ address, targets, active: true });
      const prefix = (address: string) => `create alias ${address} failed: `;
      const taken = (address: string) =>
        `${prefix(address)}${address} is already known as an alias, a mailbox or an alias address expanded from an alias domain.`;
      await refused(create('@muster-shop.ch', ['shop@muster-shop.ch']), 409, taken('@muster-shop.ch'));
      await refused(create('team@muster-ag.ch', ['anna@muster-ag.ch']), 409, taken('team@muster-ag.ch'));
      await refused(create('anna@muster-ag.ch', ['ben@muster-ag.ch']), 409, taken('anna@muster-ag.ch'));
      await refused(
        create('self@muster-shop.ch', ['shop@muster-shop.ch', 'self@muster-shop.ch']),
        400,
        `${prefix('self@muster-shop.ch')}Alias and goto address must not be identical`,
      );
      await refused(
        create('kaputt@muster-shop.ch', ['niemand']),
        400,
        `${prefix('kaputt@muster-shop.ch')}Goto address niemand is invalid`,
      );
      await refused(create('kaputt@muster-shop.ch', ['a@localhost']), 400);
      await refused(create('kaputt@muster-shop.ch', ['@muster-shop.ch']), 400);
      await refused(create('kaputt@muster-shop.ch', []), 400);
      await refused(
        create(
          'viele@muster-shop.ch',
          Array.from({ length: 51 }, (_, i) => `t${i}@example.com`),
        ),
        400,
      );
      await refused(create('a..b@muster-shop.ch', ['shop@muster-shop.ch']), 400);
      await refused(create('a+b@muster-shop.ch', ['shop@muster-shop.ch']), 400);
      await refused(create('ohne-domain', ['shop@muster-shop.ch']), 400);
      await refused(create('neu@unknown.ch', ['shop@muster-shop.ch']), 404);
      // 50 targets are fine.
      expect(
        (
          await create(
            'viele@muster-shop.ch',
            Array.from({ length: 50 }, (_, i) => `t${i}@example.com`),
          )
        ).targets,
      ).toHaveLength(50);

      // The alias limit counts every alias of the domain (4 now).
      await mail().updateMailDomain('muster-shop.ch', { maxAliases: 4 });
      await refused(
        create('fuenf@muster-shop.ch', ['shop@muster-shop.ch']),
        409,
        `${prefix('fuenf@muster-shop.ch')}Max. aliases exceeded`,
      );
      expect(demoMailState(id).nextAliasId).toBe(103);
    });

    it('changes and deletes aliases and shows special targets', async () => {
      const noreply = await mail().getMailAlias('4');
      expect(noreply).toMatchObject({ address: 'noreply@muster-ag.ch', special: 'discard', targets: [] });

      await mail().updateMailAlias('1', { targets: ['Ben@muster-ag.ch', 'extern@example.org'] });
      expect(await mail().getMailAlias('1')).toMatchObject({
        targets: ['ben@muster-ag.ch', 'extern@example.org'],
        active: true,
        modifiedAt: expect.any(String),
      });
      await mail().updateMailAlias('1', { active: false });
      expect(await mail().getMailAlias('1')).toMatchObject({
        targets: ['ben@muster-ag.ch', 'extern@example.org'],
        active: false,
      });
      await refused(
        mail().updateMailAlias('1', { targets: ['team@muster-ag.ch'] }),
        400,
        'change alias team@muster-ag.ch failed: Alias and goto address must not be identical',
      );
      await refused(mail().updateMailAlias('1', { targets: [] }), 400);
      await refused(mail().updateMailAlias('1', { targets: ['kaputt'], active: true }), 400);
      expect((await mail().getMailAlias('1')).active).toBe(false);
      await refused(mail().updateMailAlias('999', { active: true }), 404);
      await refused(mail().updateMailAlias('abc', { active: true }), 404);

      await mail().deleteMailAlias('1');
      await refused(mail().getMailAlias('1'), 404);
      await refused(mail().deleteMailAlias('1'), 404);
      await refused(mail().getMailAlias('1e2'), 404);
      await refused(mail().getMailAlias(''), 404);
      expect((await mail().getMailDomain('muster-ag.ch')).info.usage.aliases).toBe(3);
    });
  });

  it('keeps DKIM keys per domain and creates 2048 bit keys with a 420 character TXT value', async () => {
    expect(await mail().getDkim('muster-shop.ch')).toBeNull();
    expect(await mail().getDkim('xn--mller-kva.ch')).toBeNull();
    expect(await mail().getDkim('unknown.ch')).toBeNull();

    const key = await mail().createDkim('muster-shop.ch', { selector: 'dkim', keySize: 2048 });
    expect(key).toEqual(demoDkimKey('muster-shop.ch', 2048));
    expect(key.selector).toBe('dkim');
    expect(key.keyLength).toBe('2048');
    expect(key.publicKey).toHaveLength(392);
    expect(key.publicKey.startsWith(DKIM_PREFIX)).toBe(true);
    expect(key.publicKey).toMatch(/^[A-Za-z0-9+/]+$/);
    expect(key.txt).toBe(`v=DKIM1;k=rsa;t=s;s=email;p=${key.publicKey}`);
    expect(key.txt).toHaveLength(420);
    expect(await mail().getDkim('muster-shop.ch')).toEqual(key);
    await refused(
      mail().createDkim('muster-shop.ch', { selector: 'dkim', keySize: 2048 }),
      409,
      'create a DKIM key for muster-shop.ch failed: A DKIM key exists already',
    );

    // Deterministic per domain and size, as long as real keys.
    expect(demoDkimKey('muster-shop.ch', 2048)).toEqual(key);
    expect(demoDkimKey('kunde.ch', 2048).publicKey).not.toBe(key.publicKey);
    expect(demoDkimKey('kunde.ch', 3072).publicKey).toHaveLength(564);
    expect(demoDkimKey('kunde.ch', 4096).publicKey).toHaveLength(736);
    for (const name of ['muster-ag.ch', 'baeckerei-huber.ch', 'alpen-hosting.ch']) {
      expect(await mail().getDkim(name)).toEqual(demoDkimKey(name, 2048));
    }

    await refused(mail().createDkim('unknown.ch', { selector: 'dkim', keySize: 2048 }), 404);
    await refused(mail().createDkim('xn--mller-kva.ch', { selector: '-dkim', keySize: 2048 }), 400);
    await refused(mail().createDkim('xn--mller-kva.ch', { selector: 'dkim', keySize: 1024 }), 400);
    const custom = await mail().createDkim('xn--mller-kva.ch', { selector: 's2026', keySize: 3072 });
    expect(custom).toMatchObject({ selector: 's2026', keyLength: '3072' });
    expect(custom.txt.endsWith(custom.publicKey)).toBe(true);

    await mail().deleteDkim('muster-shop.ch');
    expect(await mail().getDkim('muster-shop.ch')).toBeNull();
    await mail().deleteDkim('muster-shop.ch');
    await mail().deleteDkim('unknown.ch');
  });

  it('keeps the state per connection across adapter instances', async () => {
    await mailbox('muster-shop.ch', 'kasse');
    expect((await new DemoAdapter(id, {}).getMailbox('kasse@muster-shop.ch')).address).toBe(
      'kasse@muster-shop.ch',
    );
    expect(new DemoMail(demoMailState(id)).getMailbox('kasse@muster-shop.ch').localPart).toBe('kasse');
    expect(demoMailState(id)).toBe(demoMailState(id));

    const other = new DemoAdapter(randomUUID(), {});
    await refused(other.getMailbox('kasse@muster-shop.ch'), 404);
    expect(await other.listMailboxes('muster-shop.ch')).toHaveLength(1);

    resetDemoMail();
    await refused(mail().getMailbox('kasse@muster-shop.ch'), 404);
    expect(await mail().listMailDomains()).toHaveLength(6);
  });

  it('answers the demo host as client settings and the demo password policy', async () => {
    expect(mail().mailClientSettings()).toEqual(mailClientSettings('mail.demo.weblion.one'));
    expect(DEMO_MAIL_HOST).toBe('mail.demo.weblion.one');
    expect(await mail().mailPasswordPolicy()).toEqual({
      minLength: 8,
      letters: true,
      mixedCase: true,
      digits: false,
      specialChars: false,
    });
    // The policy of a connection decides, like Mailcow's settings.
    demoMailState(id).policy.digits = true;
    await refused(mailbox('muster-shop.ch', 'ziffer', { password: 'Ohne-Ziffern-hier' }), 400);
    expect((await mailbox('muster-shop.ch', 'ziffer', { password: 'Mit-Ziffer-1' })).address).toBe(
      'ziffer@muster-shop.ch',
    );
  });
});

// ---------------------------------------------------------------------------------------

describe('Demo mail seed', () => {
  let t: TestApp;
  let demoId: string;

  beforeAll(async () => {
    t = await createTestApp();
    const demo = await t.db.query.providerConnections.findFirst({
      where: eq(providerConnections.envKey, 'demo'),
    });
    demoId = demo!.id;
  });
  afterAll(async () => {
    await t?.close();
  });

  const owners = async () =>
    (
      await t.db
        .select({ externalId: mailDomains.externalId, name: mailDomains.name, org: organizations.slug })
        .from(mailDomains)
        .leftJoin(organizations, eq(organizations.id, mailDomains.orgId))
        .where(eq(mailDomains.providerConnectionId, demoId))
        .orderBy(mailDomains.externalId)
    ).map((r) => [r.externalId, r.name, r.org]);
  const modules = async (slug: string) =>
    (await t.db.query.organizations.findFirst({ where: eq(organizations.slug, slug) }))!.modules;
  const row = (externalId: string) =>
    t.db.query.mailDomains.findFirst({
      where: and(eq(mailDomains.providerConnectionId, demoId), eq(mailDomains.externalId, externalId)),
    });

  it('stores the demo mail domains and hands them out with the mail module', async () => {
    expect(await owners()).toEqual([
      ['alpen-hosting.ch', 'alpen-hosting.ch', 'alpen-hosting'],
      ['alpenblick-hotel.ch', 'alpenblick-hotel.ch', null],
      ['baeckerei-huber.ch', 'baeckerei-huber.ch', 'baeckerei-huber'],
      ['muster-ag.ch', 'muster-ag.ch', 'muster-ag'],
      ['muster-shop.ch', 'muster-shop.ch', 'muster-ag'],
      ['xn--mller-kva.ch', 'müller.ch', null],
    ]);
    const adapter = new DemoAdapter(demoId, {});
    const musterAg = await row('muster-ag.ch');
    expect(musterAg).toMatchObject({
      active: true,
      info: (await adapter.getMailDomain('muster-ag.ch')).info,
      missingSince: null,
    });
    expect(musterAg!.lastSyncedAt).toBeInstanceOf(Date);
    expect((await row('alpenblick-hotel.ch'))!.info).toMatchObject({ relay: true });

    for (const slug of ['alpen-hosting', 'muster-ag', 'baeckerei-huber']) {
      expect(await modules(slug)).toContain('mail');
    }
    expect(await modules('beispiel-gmbh')).not.toContain('mail');
    // The reseller keeps the modules its customer has.
    const huber = await modules('baeckerei-huber');
    const alpen = await modules('alpen-hosting');
    expect(huber.every((m) => alpen.includes(m))).toBe(true);
  });

  it('is idempotent and leaves what staff changed alone', async () => {
    const beispiel = await t.db.query.organizations.findFirst({
      where: eq(organizations.slug, 'beispiel-gmbh'),
    });
    // Staff moved the shop domain to Beispiel GmbH and renamed the stored IDN row.
    await t.db
      .update(mailDomains)
      .set({ orgId: beispiel!.id })
      .where(and(eq(mailDomains.providerConnectionId, demoId), eq(mailDomains.externalId, 'muster-shop.ch')));
    await t.db
      .update(mailDomains)
      .set({ name: 'Müller (alt)' })
      .where(
        and(eq(mailDomains.providerConnectionId, demoId), eq(mailDomains.externalId, 'xn--mller-kva.ch')),
      );

    const log = await seedDemo(t.db, DEMO_PASSWORD);
    expect(log.filter((line) => line.includes('mail domains') || line.startsWith('module mail'))).toEqual([]);
    expect(await owners()).toEqual([
      ['alpen-hosting.ch', 'alpen-hosting.ch', 'alpen-hosting'],
      ['alpenblick-hotel.ch', 'alpenblick-hotel.ch', null],
      ['baeckerei-huber.ch', 'baeckerei-huber.ch', 'baeckerei-huber'],
      ['muster-ag.ch', 'muster-ag.ch', 'muster-ag'],
      ['muster-shop.ch', 'muster-shop.ch', 'beispiel-gmbh'],
      ['xn--mller-kva.ch', 'Müller (alt)', null],
    ]);
  });

  it('stores domains new at the instance and hands out unassigned ones again', async () => {
    // A domain created at the instance directly is stored without a sync, unassigned.
    new DemoMail(demoMailState(demoId)).createMailDomain(domainInput('kunde.ch'));
    // The reseller's domain was taken back, and Huber lost the module.
    await t.db
      .update(mailDomains)
      .set({ orgId: null })
      .where(
        and(eq(mailDomains.providerConnectionId, demoId), eq(mailDomains.externalId, 'alpen-hosting.ch')),
      );
    await t.db
      .update(organizations)
      .set({ modules: ['servers', 'dns'] })
      .where(eq(organizations.slug, 'baeckerei-huber'));

    const log: string[] = [];
    await seedMailDemo(t.db, log);
    expect(log).toEqual([
      'assigned mail domains alpen-hosting.ch to Alpen Hosting',
      'module mail for Bäckerei Huber',
    ]);
    expect(await owners()).toContainEqual(['kunde.ch', 'kunde.ch', null]);
    expect(await owners()).toContainEqual(['alpen-hosting.ch', 'alpen-hosting.ch', 'alpen-hosting']);
    expect((await row('kunde.ch'))!.info).toMatchObject({ name: 'kunde.ch', usage: { mailboxes: 0 } });
    expect(await modules('baeckerei-huber')).toEqual(['servers', 'dns', 'mail']);
  });
});
