import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  DEFAULT_CUSTOMER_BOUNDARY,
  MAIL_MIB,
  type DnsRecord,
  type MailAliasDto,
  type MailDnsApplyResult,
  type MailDnsSetupDto,
  type MailDomainChangeResult,
  type MailDomainDetailDto,
  type MailDomainDto,
  type MailboxDto,
  type MailboxSecretDto,
  type ModuleKey,
} from '@weblion/shared';
import {
  auditLogs,
  domains,
  mailDomains,
  organizations,
  providerConnections,
  users,
  type ProviderConnection,
} from '../src/db/schema';
import { hashPassword } from '../src/lib/crypto';
import { DemoAdapter } from '../src/providers/demo/adapter';
import { DEMO_MAIL_HOST, demoMailState } from '../src/providers/demo/mail';
import { ADMIN, Client, createTestApp, DEMO_PASSWORD, json, type TestApp } from './helpers';

const MiB = MAIL_MIB;

let t: TestApp;
let admin: Client;
let anna: Client;
let carla: Client;
let ben: Client;
let dev: Client;
let reto: Client;
let hanna: Client;
let support: Client;
let bot: Client;
let demo: ProviderConnection;
let musterId: string;
let beispielId: string;
let alpenId: string;
let huberId: string;

const mailState = () => demoMailState(demo.id);

async function orgBySlug(slug: string) {
  return (await t.db.query.organizations.findFirst({ where: eq(organizations.slug, slug) }))!;
}

async function modulesOf(orgId: string) {
  return (await t.db.query.organizations.findFirst({ where: eq(organizations.id, orgId) }))!.modules;
}

async function setModules(orgId: string, modules: ModuleKey[]) {
  await t.db.update(organizations).set({ modules }).where(eq(organizations.id, orgId));
}

async function auditEntries(action: string, resourceId?: string) {
  return t.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, action), resourceId ? eq(auditLogs.resourceId, resourceId) : undefined))
    .orderBy(auditLogs.createdAt);
}

async function mailRow(externalId: string, connectionId = demo.id) {
  return t.db.query.mailDomains.findFirst({
    where: and(eq(mailDomains.providerConnectionId, connectionId), eq(mailDomains.externalId, externalId)),
  });
}

async function mailId(externalId: string, connectionId = demo.id) {
  return (await mailRow(externalId, connectionId))!.id;
}

async function panelDomainId(name: string) {
  return (await t.db.query.domains.findFirst({
    where: and(eq(domains.providerConnectionId, demo.id), eq(domains.name, name)),
  }))!.id;
}

async function sync(connection: ProviderConnection = demo) {
  const res = await admin.post(`/admin/providers/${connection.id}/sync`);
  expect(res.statusCode, res.body).toBe(200);
  return json(res);
}

async function newUser(email: string, options: { platformRole?: 'support' } = {}): Promise<Client> {
  await t.db.insert(users).values({
    email,
    name: email.split('@')[0]!,
    passwordHash: await hashPassword(DEMO_PASSWORD),
    platformRole: options.platformRole ?? null,
  });
  const client = new Client(t.app);
  await client.login(email);
  return client;
}

/** A second demo connection, stored like one created in the admin UI (its own demo state). */
async function newDemoConnection(name: string) {
  const [connection] = await t.db
    .insert(providerConnections)
    .values({
      type: 'demo',
      name,
      location: { country: 'CH', label: name },
      configEnc: t.ctx.box.encryptJson({}),
    })
    .returning();
  return connection!;
}

const LIMITS = {
  maxMailboxes: 5,
  maxAliases: 50,
  quotaMb: 5120,
  defaultMailboxQuotaMb: 1024,
  maxMailboxQuotaMb: 2048,
  rateLimit: { value: 200, frame: 'h' },
};

/** Runs `during` while a sync of the demo instance holds on to the domain list it has read. */
async function duringSync(during: () => Promise<void>) {
  const original = DemoAdapter.prototype.listMailDomains;
  DemoAdapter.prototype.listMailDomains = async function (this: DemoAdapter) {
    const list = await original.call(this);
    await during();
    return list;
  };
  try {
    return await sync();
  } finally {
    DemoAdapter.prototype.listMailDomains = original;
  }
}

beforeAll(async () => {
  t = await createTestApp();
  admin = new Client(t.app);
  await admin.login(ADMIN.email, ADMIN.password);
  anna = new Client(t.app);
  await anna.login('anna@muster.example');
  carla = new Client(t.app);
  await carla.login('carla@muster.example');
  ben = new Client(t.app);
  await ben.login('ben@muster.example');
  dev = new Client(t.app);
  await dev.login('dev@beispiel.example');
  reto = new Client(t.app);
  await reto.login('reseller@alpen.example');
  hanna = new Client(t.app);
  await hanna.login('huber@baeckerei.example');
  support = await newUser('support@test.local', { platformRole: 'support' });
  demo = (await t.db.query.providerConnections.findFirst({ where: eq(providerConnections.envKey, 'demo') }))!;
  musterId = (await orgBySlug('muster-ag')).id;
  beispielId = (await orgBySlug('beispiel-gmbh')).id;
  alpenId = (await orgBySlug('alpen-hosting')).id;
  huberId = (await orgBySlug('baeckerei-huber')).id;
  const { token } = json(
    await anna.post(`/orgs/${musterId}/tokens`, { name: 'mail-bot', scope: 'read_write' }),
  );
  bot = new Client(t.app);
  bot.bearer = token;

  // The demo seed (seedMailDemo) hands out four of the six demo domains.
  const owners = Object.fromEntries(
    (await t.db.select().from(mailDomains).where(eq(mailDomains.providerConnectionId, demo.id))).map((r) => [
      r.externalId,
      r.orgId,
    ]),
  );
  expect(owners).toEqual({
    'muster-ag.ch': musterId,
    'muster-shop.ch': musterId,
    'alpen-hosting.ch': alpenId,
    'baeckerei-huber.ch': huberId,
    'xn--mller-kva.ch': null,
    'alpenblick-hotel.ch': null,
  });
  for (const id of [musterId, alpenId, huberId]) expect(await modulesOf(id)).toContain('mail');
});

afterAll(async () => {
  await t?.close();
});

describe('sync', () => {
  it('stores the demo domains with limits and usage and keeps their assignments', async () => {
    const result = await sync();
    expect(result.mailDomains).toEqual({ seen: 6, missing: 0 });
    const muster = await mailRow('muster-ag.ch');
    expect(muster).toMatchObject({ name: 'muster-ag.ch', orgId: musterId, active: true, missingSince: null });
    expect(muster!.info).toMatchObject({
      name: 'muster-ag.ch',
      relay: false,
      limits: {
        maxMailboxes: 25,
        maxAliases: 100,
        quotaBytes: 51_200 * MiB,
        defaultMailboxQuotaBytes: 2048 * MiB,
        maxMailboxQuotaBytes: 10_240 * MiB,
        rateLimit: { value: 500, frame: 'h' },
      },
      usage: { mailboxes: 4, aliases: 4, allocatedBytes: 27_648 * MiB },
    });
    expect(muster!.lastSyncedAt).not.toBeNull();
    expect(await mailRow('xn--mller-kva.ch')).toMatchObject({ name: 'müller.ch', orgId: null });
    expect(await mailRow('alpenblick-hotel.ch')).toMatchObject({ orgId: null, info: { relay: true } });

    // A domain created at Mailcow directly shows up unassigned.
    await t.ctx.providers.forConnection(demo).createMailDomain!({
      domain: 'neu-sync.ch',
      description: null,
      limits: { ...LIMITS, rateLimit: null },
      dkim: { selector: 'dkim', keySize: 2048 },
      restartSogo: false,
    });
    try {
      expect((await sync()).mailDomains).toEqual({ seen: 7, missing: 0 });
      expect(await mailRow('neu-sync.ch')).toMatchObject({ name: 'neu-sync.ch', orgId: null });
    } finally {
      mailState().domains.delete('neu-sync.ch');
      mailState().dkim.delete('neu-sync.ch');
      await t.db.delete(mailDomains).where(eq(mailDomains.externalId, 'neu-sync.ch'));
    }
  });

  it('marks a vanished domain as missing, keeps its organization and revives it', async () => {
    const saved = mailState().domains.get('muster-shop.ch')!;
    mailState().domains.delete('muster-shop.ch');
    try {
      expect((await sync()).mailDomains).toEqual({ seen: 5, missing: 1 });
      const row = await mailRow('muster-shop.ch');
      expect(row!.missingSince).not.toBeNull();
      expect(row!.orgId).toBe(musterId);
    } finally {
      mailState().domains.set('muster-shop.ch', saved);
    }
    expect((await sync()).mailDomains).toEqual({ seen: 6, missing: 0 });
    expect(await mailRow('muster-shop.ch')).toMatchObject({ missingSince: null, orgId: musterId });
  });

  it('does not overwrite a row the panel changed while the list was on its way', async () => {
    const id = await mailId('muster-ag.ch');
    const row = (await mailRow('muster-ag.ch'))!;
    const changed = { ...row.info!, limits: { ...row.info!.limits, maxMailboxes: 30 } };
    await duringSync(async () => {
      await t.db.update(mailDomains).set({ info: changed }).where(eq(mailDomains.id, id));
    });
    // The list still had 25: written back, it would undo the change.
    expect((await mailRow('muster-ag.ch'))!.info!.limits.maxMailboxes).toBe(30);
    // The next run updates the row as usual.
    await sync();
    expect((await mailRow('muster-ag.ch'))!.info!.limits.maxMailboxes).toBe(25);
  });
});

describe('access', () => {
  it('shows an organization its mail domains with the permissions of each member', async () => {
    const list = json<MailDomainDto[]>(await anna.get(`/orgs/${musterId}/mail/domains`));
    expect(list.map((d) => d.asciiName)).toEqual(['muster-ag.ch', 'muster-shop.ch']);
    expect(list[0]).toMatchObject({
      name: 'muster-ag.ch',
      active: true,
      relay: false,
      provider: { id: demo.id, type: 'demo' },
      org: { id: musterId, slug: 'muster-ag' },
      limits: { maxMailboxes: 25 },
      usage: { mailboxes: 4 },
      missingSince: null,
    });
    expect(list[0]!.permissions.sort()).toEqual(['mail:password', 'mail:read', 'mail:write']);
    const filtered = json<MailDomainDto[]>(await anna.get(`/orgs/${musterId}/mail/domains?q=shop`));
    expect(filtered.map((d) => d.asciiName)).toEqual(['muster-shop.ch']);

    const viewer = json<MailDomainDto[]>(await carla.get(`/orgs/${musterId}/mail/domains`));
    expect(viewer.map((d) => d.permissions)).toEqual([['mail:read'], ['mail:read']]);

    const musterAg = await mailId('muster-ag.ch');
    // Restricted members see nothing of the module.
    const restricted = await ben.get(`/orgs/${musterId}/mail/domains`);
    expect(restricted.statusCode).toBe(200);
    expect(json(restricted)).toEqual([]);
    expect((await ben.get(`/mail/domains/${musterAg}`)).statusCode).toBe(404);
    // Other organizations do not learn that it exists.
    expect((await dev.get(`/mail/domains/${musterAg}`)).statusCode).toBe(404);
    expect((await dev.get(`/mail/domains/${musterAg}/mailboxes`)).statusCode).toBe(404);
  });

  it('hides the module when it is switched off', async () => {
    const musterAg = await mailId('muster-ag.ch');
    const modules = await modulesOf(musterId);
    await setModules(
      musterId,
      modules.filter((m) => m !== 'mail'),
    );
    try {
      expect((await anna.get(`/mail/domains/${musterAg}`)).statusCode).toBe(404);
      expect(json(await anna.get(`/orgs/${musterId}/mail/domains`))).toEqual([]);
    } finally {
      await setModules(musterId, modules);
    }
    expect((await anna.get(`/mail/domains/${musterAg}`)).statusCode).toBe(200);
  });

  it('lets platform support read but change nothing', async () => {
    const musterAg = await mailId('muster-ag.ch');
    expect((await support.get(`/mail/domains/${musterAg}`)).statusCode).toBe(200);
    expect((await support.get(`/mail/domains/${musterAg}/mailboxes`)).statusCode).toBe(200);
    expect((await support.get('/admin/mail/domains')).statusCode).toBe(200);
    const writes = [
      await support.post(`/mail/domains/${musterAg}/mailboxes`, {
        localPart: 'support',
        password: 'Support-Pass-123',
      }),
      await support.patch(`/mail/domains/${musterAg}/mailboxes/anna@muster-ag.ch`, { name: 'X' }),
      await support.post(`/mail/domains/${musterAg}/mailboxes/anna@muster-ag.ch/password`, {}),
      await support.post(`/mail/domains/${musterAg}/aliases`, {
        localPart: 'x',
        targets: ['anna@muster-ag.ch'],
      }),
      await support.del(`/mail/domains/${musterAg}/aliases/1`),
      await support.post(`/mail/domains/${musterAg}/dkim`, {}),
      await support.post('/admin/mail/domains', {
        providerId: demo.id,
        domain: 'support.ch',
        limits: LIMITS,
      }),
      await support.patch(`/admin/mail/domains/${musterAg}`, { active: false }),
      await support.post(`/admin/mail/domains/${musterAg}/assign`, { orgId: null }),
    ];
    expect(writes.map((r) => r.statusCode)).toEqual(Array(writes.length).fill(403));
    expect(mailState().domains.get('muster-ag.ch')!.mailboxes.has('support')).toBe(false);
  });

  it('keeps reads and refuses writes while the organization is suspended', async () => {
    const musterAg = await mailId('muster-ag.ch');
    await t.db
      .update(organizations)
      .set({ status: 'suspended', suspendedBy: 'platform' })
      .where(eq(organizations.id, musterId));
    try {
      expect((await anna.get(`/mail/domains/${musterAg}`)).statusCode).toBe(200);
      expect((await anna.get(`/mail/domains/${musterAg}/aliases`)).statusCode).toBe(200);
      expect((await anna.get(`/mail/domains/${musterAg}/dns`)).statusCode).toBe(200);
      const create = await anna.post(`/mail/domains/${musterAg}/mailboxes`, { localPart: 'suspended' });
      expect(create.statusCode).toBe(403);
      expect((await anna.patch(`/mail/domains/${musterAg}/aliases/1`, { active: false })).statusCode).toBe(
        403,
      );
      expect((await anna.post(`/mail/domains/${musterAg}/dns/apply`, {})).statusCode).toBe(403);
    } finally {
      await t.db
        .update(organizations)
        .set({ status: 'active', suspendedBy: null })
        .where(eq(organizations.id, musterId));
    }
  });
});

describe('detail', () => {
  it('reads Mailcow live, stores it and adds client settings and the password policy', async () => {
    const musterAg = await mailId('muster-ag.ch');
    mailState().domains.get('muster-ag.ch')!.description = 'Muster AG neu';
    mailState().domains.get('muster-ag.ch')!.maxAliases = 120;
    const detail = json<MailDomainDetailDto>(await anna.get(`/mail/domains/${musterAg}`));
    expect(detail).toMatchObject({
      asciiName: 'muster-ag.ch',
      liveError: null,
      limits: { maxAliases: 120 },
      info: { description: 'Muster AG neu', usage: { mailboxes: 4 } },
      clientSettings: { mailHost: DEMO_MAIL_HOST, webmailUrl: `https://${DEMO_MAIL_HOST}/SOGo/` },
      passwordPolicy: { minLength: 8, mixedCase: true },
    });
    expect((await mailRow('muster-ag.ch'))!.info!.limits.maxAliases).toBe(120);
    mailState().domains.get('muster-ag.ch')!.maxAliases = 100;

    // Mailcow down: the stored values and the error.
    const original = DemoAdapter.prototype.getMailDomain;
    DemoAdapter.prototype.getMailDomain = async () => {
      throw new Error('Mailcow: connection refused');
    };
    try {
      const stale = json<MailDomainDetailDto>(await anna.get(`/mail/domains/${musterAg}`));
      expect(stale.liveError).toMatch(/connection refused/);
      expect(stale.info!.limits.maxAliases).toBe(120);
    } finally {
      DemoAdapter.prototype.getMailDomain = original;
    }
    await anna.get(`/mail/domains/${musterAg}`);
  });
});

describe('mailboxes', () => {
  it('creates a mailbox with a generated password shown once and never stored', async () => {
    const musterAg = await mailId('muster-ag.ch');
    const res = await anna.post(`/mail/domains/${musterAg}/mailboxes`, { localPart: 'Lea', name: 'Lea Neu' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const { mailbox, password } = json<MailboxSecretDto>(res);
    expect(mailbox).toMatchObject({
      address: 'lea@muster-ag.ch',
      localPart: 'lea',
      name: 'Lea Neu',
      state: 'active',
      // The domain's default size.
      quotaBytes: 2048 * MiB,
    });
    expect(password!.length).toBeGreaterThanOrEqual(20);
    expect(mailState().domains.get('muster-ag.ch')!.mailboxes.get('lea')!.password).toBe(password);
    // The usage in the list follows.
    expect((await mailRow('muster-ag.ch'))!.info!.usage.mailboxes).toBe(5);

    const [entry] = await auditEntries('mail.mailbox_create', musterAg);
    expect(entry).toMatchObject({
      status: 'success',
      orgId: musterId,
      resourceType: 'mail_domain',
      details: {
        domain: 'muster-ag.ch',
        address: 'lea@muster-ag.ch',
        name: 'Lea Neu',
        quotaBytes: 2048 * MiB,
        password: 'generated',
      },
    });
    expect(JSON.stringify(await t.db.select().from(auditLogs))).not.toContain(password!);
  });

  it('creates a mailbox with a chosen password and checks it against the policy', async () => {
    const musterAg = await mailId('muster-ag.ch');
    const weak = await anna.post(`/mail/domains/${musterAg}/mailboxes`, {
      localPart: 'max',
      password: 'abcdefghijk',
    });
    expect(weak.statusCode).toBe(400);
    expect(json(weak).error.details[0]).toMatchObject({ path: 'password', issues: ['mixedCase'] });
    expect(mailState().domains.get('muster-ag.ch')!.mailboxes.has('max')).toBe(false);

    const res = await anna.post(`/mail/domains/${musterAg}/mailboxes`, {
      localPart: 'max',
      name: null,
      quotaMb: 1024,
      password: 'Sicheres-Passwort-1',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<MailboxSecretDto>(res)).toMatchObject({
      mailbox: { address: 'max@muster-ag.ch', name: null, quotaBytes: 1024 * MiB },
      password: null,
    });
    expect(mailState().domains.get('muster-ag.ch')!.mailboxes.get('max')!.password).toBe(
      'Sicheres-Passwort-1',
    );
    const entries = await auditEntries('mail.mailbox_create', musterAg);
    expect(entries.at(-1)!.details).toMatchObject({ address: 'max@muster-ag.ch', password: 'chosen' });
    expect(JSON.stringify(await t.db.select().from(auditLogs))).not.toContain('Sicheres-Passwort-1');
  });

  it('checks the domain limits first and audits every refusal', async () => {
    const shop = await mailId('muster-shop.ch');
    const create = (body: Record<string, unknown>) => anna.post(`/mail/domains/${shop}/mailboxes`, body);
    // 5 mailboxes, 10 GB storage, at most 5 GB per mailbox; "shop" has 2 GB.
    const tooBig = await create({ localPart: 'gross', quotaMb: 6000 });
    expect(tooBig.statusCode).toBe(409);
    expect(json(tooBig).error).toMatchObject({
      code: 'mail_limit',
      details: { limit: 'mailboxSize', max: 5120 * MiB, used: 6000 * MiB },
    });
    expect((await create({ localPart: 'lager', quotaMb: 5120 })).statusCode).toBe(200);
    const noRoom = await create({ localPart: 'archiv', quotaMb: 4096 });
    expect(noRoom.statusCode).toBe(409);
    expect(json(noRoom).error).toMatchObject({
      code: 'mail_limit',
      details: { limit: 'storage', max: 10_240 * MiB, used: 7168 * MiB },
    });
    for (const local of ['a1', 'a2', 'a3']) {
      expect((await create({ localPart: local })).statusCode).toBe(200);
    }
    const full = await create({ localPart: 'a4', quotaMb: 1 });
    expect(full.statusCode).toBe(409);
    expect(json(full).error).toMatchObject({
      code: 'mail_limit',
      details: { limit: 'mailboxes', max: 5, used: 5 },
    });
    expect([...mailState().domains.get('muster-shop.ch')!.mailboxes.keys()].sort()).toEqual([
      'a1',
      'a2',
      'a3',
      'lager',
      'shop',
    ]);
    const failures = (await auditEntries('mail.mailbox_create', shop)).filter((e) => e.status === 'failure');
    expect(failures.map((e) => (e.details as { address: string }).address)).toEqual([
      'gross@muster-shop.ch',
      'archiv@muster-shop.ch',
      'a4@muster-shop.ch',
    ]);
    expect(failures.every((e) => typeof (e.details as { error?: string }).error === 'string')).toBe(true);
  });

  it('creates one mailbox at a time per domain', async () => {
    const huber = await mailId('baeckerei-huber.ch');
    // 2 of 5 mailboxes exist: leave one slot.
    for (const local of ['p1', 'p2']) {
      const res = await hanna.post(`/mail/domains/${huber}/mailboxes`, { localPart: local, quotaMb: 512 });
      expect(res.statusCode, res.body).toBe(200);
    }
    const original = DemoAdapter.prototype.createMailbox;
    let inFlight = 0;
    let most = 0;
    DemoAdapter.prototype.createMailbox = async function (this: DemoAdapter, input) {
      inFlight++;
      most = Math.max(most, inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return await original.call(this, input);
      } finally {
        inFlight--;
      }
    };
    try {
      const results = await Promise.all(
        ['race1', 'race2'].map((local) =>
          hanna.post(`/mail/domains/${huber}/mailboxes`, { localPart: local, quotaMb: 512 }),
        ),
      );
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      const refused = results.find((r) => r.statusCode === 409)!;
      // Refused by the panel's check under the lock, not by Mailcow's racy one.
      expect(json(refused).error).toMatchObject({ code: 'mail_limit', details: { limit: 'mailboxes' } });
      expect(most).toBe(1);
    } finally {
      DemoAdapter.prototype.createMailbox = original;
    }
    expect(mailState().domains.get('baeckerei-huber.ch')!.mailboxes.size).toBe(5);
  });

  it('gives API tokens no passwords', async () => {
    const musterAg = await mailId('muster-ag.ch');
    const refused = await bot.post(`/mail/domains/${musterAg}/mailboxes`, { localPart: 'bot' });
    expect(refused.statusCode).toBe(400);
    expect(json(refused).error.message).toMatch(/API tokens/);
    expect(mailState().domains.get('muster-ag.ch')!.mailboxes.has('bot')).toBe(false);

    const res = await bot.post(`/mail/domains/${musterAg}/mailboxes`, {
      localPart: 'bot',
      password: 'Bot-Passwort-123',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<MailboxSecretDto>(res).password).toBeNull();
    const detail = json<MailDomainDetailDto>(await bot.get(`/mail/domains/${musterAg}`));
    expect(detail.permissions.sort()).toEqual(['mail:read', 'mail:write']);
    const reset = await bot.post(`/mail/domains/${musterAg}/mailboxes/bot@muster-ag.ch/password`, {
      password: 'Anderes-Passwort-1',
    });
    expect(reset.statusCode).toBe(403);
    expect(mailState().domains.get('muster-ag.ch')!.mailboxes.get('bot')!.password).toBe('Bot-Passwort-123');
  });

  it('changes name, size and state, and checks a larger size against the domain', async () => {
    const musterAg = await mailId('muster-ag.ch');
    const res = await anna.patch(`/mail/domains/${musterAg}/mailboxes/lea@muster-ag.ch`, {
      name: 'Lea Muster',
      quotaMb: 1024,
      state: 'login_disabled',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<MailboxDto>(res)).toMatchObject({
      address: 'lea@muster-ag.ch',
      name: 'Lea Muster',
      quotaBytes: 1024 * MiB,
      state: 'login_disabled',
    });
    expect(mailState().domains.get('muster-ag.ch')!.mailboxes.get('lea')).toMatchObject({
      name: 'Lea Muster',
      quotaMb: 1024,
      active: 2,
    });
    const [entry] = await auditEntries('mail.mailbox_update', musterAg);
    expect(entry!.details).toMatchObject({
      address: 'lea@muster-ag.ch',
      before: { name: 'Lea Neu', quotaBytes: 2048 * MiB, state: 'active' },
      after: { name: 'Lea Muster', quotaBytes: 1024 * MiB, state: 'login_disabled' },
    });
    // Unchanged values: nothing to do, nothing audited.
    const same = await anna.patch(`/mail/domains/${musterAg}/mailboxes/LEA@muster-ag.ch`, {
      name: 'Lea Muster',
    });
    expect(same.statusCode).toBe(200);
    expect(await auditEntries('mail.mailbox_update', musterAg)).toHaveLength(1);

    // Addresses of other domains are not reachable through this one.
    const shop = await mailId('muster-shop.ch');
    expect(
      (await anna.patch(`/mail/domains/${musterAg}/mailboxes/shop@muster-shop.ch`, { name: 'X' })).statusCode,
    ).toBe(404);
    expect(
      (await anna.patch(`/mail/domains/${musterAg}/mailboxes/nobody@muster-ag.ch`, { name: 'X' })).statusCode,
    ).toBe(404);

    // muster-shop.ch is full: a larger mailbox does not fit, a smaller one does.
    const larger = await anna.patch(`/mail/domains/${shop}/mailboxes/shop@muster-shop.ch`, { quotaMb: 3072 });
    expect(larger.statusCode).toBe(409);
    expect(json(larger).error).toMatchObject({ code: 'mail_limit', details: { limit: 'storage' } });
    const tooBig = await anna.patch(`/mail/domains/${shop}/mailboxes/shop@muster-shop.ch`, { quotaMb: 6000 });
    expect(json(tooBig).error).toMatchObject({ code: 'mail_limit', details: { limit: 'mailboxSize' } });
    const smaller = await anna.patch(`/mail/domains/${shop}/mailboxes/shop@muster-shop.ch`, {
      quotaMb: 1024,
    });
    expect(smaller.statusCode, smaller.body).toBe(200);
    expect(mailState().domains.get('muster-shop.ch')!.mailboxes.get('shop')!.quotaMb).toBe(1024);
    // The freed space can be given back.
    const back = await anna.patch(`/mail/domains/${shop}/mailboxes/shop@muster-shop.ch`, { quotaMb: 2048 });
    expect(back.statusCode, back.body).toBe(200);
    const failures = (await auditEntries('mail.mailbox_update', shop)).filter((e) => e.status === 'failure');
    expect(failures).toHaveLength(2);
  });

  it('sets new passwords, generated or chosen, and audits them without the value', async () => {
    const musterAg = await mailId('muster-ag.ch');
    const url = `/mail/domains/${musterAg}/mailboxes/lea@muster-ag.ch/password`;
    const generated = await anna.post(url, {});
    expect(generated.statusCode, generated.body).toBe(200);
    expect(generated.headers['cache-control']).toBe('no-store');
    const { password } = json<{ password: string }>(generated);
    expect(password.length).toBeGreaterThanOrEqual(20);
    expect(mailState().domains.get('muster-ag.ch')!.mailboxes.get('lea')!.password).toBe(password);

    const weak = await anna.post(url, { password: 'nur-klein-123' });
    expect(weak.statusCode).toBe(400);
    const chosen = await anna.post(url, { password: 'Noch-ein-Passwort-9' });
    expect(json(chosen)).toEqual({ password: null });
    expect(mailState().domains.get('muster-ag.ch')!.mailboxes.get('lea')!.password).toBe(
      'Noch-ein-Passwort-9',
    );

    // A typo answers 404 and is not audited.
    expect(
      (await anna.post(`/mail/domains/${musterAg}/mailboxes/lae@muster-ag.ch/password`, {})).statusCode,
    ).toBe(404);
    const entries = await auditEntries('mail.password_reset', musterAg);
    expect(entries.map((e) => (e.details as { password: string }).password)).toEqual(['generated', 'chosen']);
    const all = JSON.stringify(await t.db.select().from(auditLogs));
    expect(all).not.toContain(password);
    expect(all).not.toContain('Noch-ein-Passwort-9');
    // Viewers cannot.
    expect((await carla.post(url, {})).statusCode).toBe(403);
  });

  it('deletes a mailbox only with the address typed, and removes it from aliases', async () => {
    const musterAg = await mailId('muster-ag.ch');
    const url = `/mail/domains/${musterAg}/mailboxes/ben@muster-ag.ch`;
    const wrong = await anna.del(url, { confirm: 'ben' });
    expect(wrong.statusCode).toBe(400);
    expect(json(wrong).error.details[0].path).toBe('confirm');
    expect((await anna.del(url, { confirm: 'Ben@Muster-AG.ch' })).statusCode).toBe(200);
    expect(mailState().domains.get('muster-ag.ch')!.mailboxes.has('ben')).toBe(false);
    const aliases = json<MailAliasDto[]>(await anna.get(`/mail/domains/${musterAg}/aliases`));
    expect(aliases.find((a) => a.address === 'team@muster-ag.ch')!.targets).toEqual(['anna@muster-ag.ch']);
    const [entry] = await auditEntries('mail.mailbox_delete', musterAg);
    expect(entry!.details).toMatchObject({ address: 'ben@muster-ag.ch', quotaBytes: 5120 * MiB });
    expect((await anna.del(url, { confirm: 'ben@muster-ag.ch' })).statusCode).toBe(404);
  });

  it('shows relay domains without mailboxes and aliases and creates none there', async () => {
    const relay = await mailId('alpenblick-hotel.ch');
    expect((await admin.post(`/admin/mail/domains/${relay}/assign`, { orgId: musterId })).statusCode).toBe(
      200,
    );
    try {
      expect(json(await anna.get(`/mail/domains/${relay}/mailboxes`))).toEqual([]);
      expect(json(await anna.get(`/mail/domains/${relay}/aliases`))).toEqual([]);
      const mailbox = await anna.post(`/mail/domains/${relay}/mailboxes`, { localPart: 'empfang' });
      expect(mailbox.statusCode).toBe(409);
      const alias = await anna.post(`/mail/domains/${relay}/aliases`, {
        localPart: 'info',
        targets: ['anna@muster-ag.ch'],
      });
      expect(alias.statusCode).toBe(409);
    } finally {
      await admin.post(`/admin/mail/domains/${relay}/assign`, { orgId: null });
    }
  });
});

describe('aliases', () => {
  it('creates normal and catch-all aliases within the limit', async () => {
    const musterAg = await mailId('muster-ag.ch');
    const shop = await mailId('muster-shop.ch');
    const res = await anna.post(`/mail/domains/${musterAg}/aliases`, {
      localPart: 'office',
      targets: ['Anna@Muster-AG.ch', 'extern@example.org', 'anna@muster-ag.ch'],
    });
    expect(res.statusCode, res.body).toBe(200);
    const office = json<MailAliasDto>(res);
    expect(office).toMatchObject({
      address: 'office@muster-ag.ch',
      catchAll: false,
      targets: ['anna@muster-ag.ch', 'extern@example.org'],
      special: null,
      active: true,
    });
    const [entry] = await auditEntries('mail.alias_create', musterAg);
    expect(entry!.details).toMatchObject({
      address: 'office@muster-ag.ch',
      targets: ['anna@muster-ag.ch', 'extern@example.org'],
      active: true,
    });

    const duplicate = await anna.post(`/mail/domains/${musterAg}/aliases`, {
      localPart: 'office',
      targets: ['anna@muster-ag.ch'],
    });
    expect(duplicate.statusCode).toBe(409);
    const self = await anna.post(`/mail/domains/${musterAg}/aliases`, {
      localPart: 'self',
      targets: ['self@muster-ag.ch'],
    });
    expect(self.statusCode).toBe(400);
    expect(json(self).error.details[0].path).toBe('targets');

    const catchAll = await anna.post(`/mail/domains/${shop}/aliases`, {
      localPart: null,
      targets: ['shop@muster-shop.ch'],
      active: false,
    });
    expect(catchAll.statusCode, catchAll.body).toBe(200);
    expect(json<MailAliasDto>(catchAll)).toMatchObject({
      address: '@muster-shop.ch',
      catchAll: true,
      active: false,
    });

    // The limit: muster-shop.ch has two aliases now.
    const domain = mailState().domains.get('muster-shop.ch')!;
    domain.maxAliases = 2;
    try {
      const full = await anna.post(`/mail/domains/${shop}/aliases`, {
        localPart: 'info',
        targets: ['shop@muster-shop.ch'],
      });
      expect(full.statusCode).toBe(409);
      expect(json(full).error).toMatchObject({
        code: 'mail_limit',
        details: { limit: 'aliases', max: 2, used: 2 },
      });
    } finally {
      domain.maxAliases = 20;
    }
    expect([...domain.aliases.values()].map((a) => a.address).sort()).toEqual([
      '@muster-shop.ch',
      'bestellungen@muster-shop.ch',
    ]);
  });

  it('changes targets and state, never of other domains or special aliases', async () => {
    const musterAg = await mailId('muster-ag.ch');
    const team = await anna.patch(`/mail/domains/${musterAg}/aliases/1`, {
      targets: ['anna@muster-ag.ch', 'max@muster-ag.ch'],
      active: false,
    });
    expect(team.statusCode, team.body).toBe(200);
    expect(json<MailAliasDto>(team)).toMatchObject({
      address: 'team@muster-ag.ch',
      targets: ['anna@muster-ag.ch', 'max@muster-ag.ch'],
      active: false,
    });
    const [entry] = await auditEntries('mail.alias_update', musterAg);
    expect(entry!.details).toMatchObject({
      aliasId: '1',
      before: { targets: ['anna@muster-ag.ch'], active: true },
      after: { targets: ['anna@muster-ag.ch', 'max@muster-ag.ch'], active: false },
    });

    // Alias ids are global per Mailcow instance: Bäckerei Huber's alias is not Muster AG's.
    expect((await anna.patch(`/mail/domains/${musterAg}/aliases/6`, { active: false })).statusCode).toBe(404);
    expect((await anna.del(`/mail/domains/${musterAg}/aliases/6`)).statusCode).toBe(404);
    expect(mailState().domains.get('baeckerei-huber.ch')!.aliases.get(6)!.active).toBe(true);

    // noreply@ discards mail: its targets stay, switching it off works.
    const special = await anna.patch(`/mail/domains/${musterAg}/aliases/4`, {
      targets: ['anna@muster-ag.ch'],
    });
    expect(special.statusCode).toBe(409);
    const off = await anna.patch(`/mail/domains/${musterAg}/aliases/4`, { active: false });
    expect(off.statusCode, off.body).toBe(200);
    expect(json<MailAliasDto>(off)).toMatchObject({ special: 'discard', targets: [], active: false });
    expect(mailState().domains.get('muster-ag.ch')!.aliases.get(4)!.goto).toEqual(['null@localhost']);
  });

  it('deletes an alias and audits it', async () => {
    const musterAg = await mailId('muster-ag.ch');
    const list = json<MailAliasDto[]>(await anna.get(`/mail/domains/${musterAg}/aliases`));
    const office = list.find((a) => a.address === 'office@muster-ag.ch')!;
    expect((await carla.del(`/mail/domains/${musterAg}/aliases/${office.id}`)).statusCode).toBe(403);
    expect((await anna.del(`/mail/domains/${musterAg}/aliases/${office.id}`)).statusCode).toBe(200);
    expect(mailState().domains.get('muster-ag.ch')!.aliases.has(Number(office.id))).toBe(false);
    const [entry] = await auditEntries('mail.alias_delete', musterAg);
    expect(entry).toMatchObject({
      status: 'success',
      details: { aliasId: office.id, address: 'office@muster-ag.ch', targets: office.targets },
    });
  });
});

describe('dns setup', () => {
  it('compares the panel zone of the same name with what Mailcow needs', async () => {
    const shop = await mailId('muster-shop.ch');
    const setup = json<MailDnsSetupDto>(await anna.get(`/mail/domains/${shop}/dns`));
    expect(setup).toMatchObject({
      domain: 'muster-shop.ch',
      mailHost: DEMO_MAIL_HOST,
      dkim: { selector: 'dkim', present: false, keyLength: null },
      zone: {
        domainId: await panelDomainId('muster-shop.ch'),
        name: 'muster-shop.ch',
        provider: { id: demo.id },
        writable: true,
        canEdit: true,
        // Delegated to other name servers.
        live: false,
        error: null,
      },
    });
    const byKey = Object.fromEntries(setup.records.map((r) => [r.key, r]));
    expect(byKey.mx).toMatchObject({
      status: 'conflict',
      hint: 'other_mx',
      found: ['10 mail.muster-ag.ch'],
      addable: false,
    });
    for (const key of ['spf', 'dmarc', 'autodiscover', 'autoconfig', 'autodiscover_srv']) {
      expect(byKey[key], key).toMatchObject({ status: 'missing', addable: true });
    }
    expect(byKey.dkim).toMatchObject({ status: 'missing', hint: 'no_dkim_key', data: '', addable: false });
    expect(byKey.spf!.data).toBe('v=spf1 mx ~all');
    expect(byKey.autodiscover_srv).toMatchObject({
      data: `0 1 443 ${DEMO_MAIL_HOST}`,
      fqdn: '_autodiscover._tcp.muster-shop.ch',
    });
  });

  it('adds the missing records to the zone, one audit entry each', async () => {
    const shop = await mailId('muster-shop.ch');
    const zoneId = await panelDomainId('muster-shop.ch');
    const res = await anna.post(`/mail/domains/${shop}/dns/apply`, {});
    expect(res.statusCode, res.body).toBe(200);
    const result = json<MailDnsApplyResult>(res);
    expect(result.added).toEqual(['spf', 'dmarc', 'autodiscover', 'autoconfig', 'autodiscover_srv']);
    expect(result.skipped).toEqual([
      { key: 'mx', reason: 'not_missing' },
      { key: 'dkim', reason: 'no_dkim_key' },
    ]);
    expect(result.failed).toEqual([]);
    const after = Object.fromEntries(result.setup.records.map((r) => [r.key, r]));
    for (const key of ['dmarc', 'autodiscover', 'autoconfig', 'autodiscover_srv']) {
      expect(after[key]!.status, key).toBe('ok');
    }
    // "mx" in the new SPF record only covers Mailcow once the MX points there.
    expect(after.spf).toMatchObject({ status: 'conflict', hint: 'other_spf' });

    const records = json<DnsRecord[]>(await anna.get(`/domains/${zoneId}/dns`));
    const has = (type: string, name: string, data: string) =>
      records.some((r) => r.type === type && r.name === name && r.data === data);
    expect(has('TXT', '@', 'v=spf1 mx ~all')).toBe(true);
    expect(has('TXT', '_dmarc', 'v=DMARC1; p=none')).toBe(true);
    expect(has('CNAME', 'autodiscover', DEMO_MAIL_HOST)).toBe(true);
    expect(has('CNAME', 'autoconfig', DEMO_MAIL_HOST)).toBe(true);
    expect(has('SRV', '_autodiscover._tcp', `0 1 443 ${DEMO_MAIL_HOST}`)).toBe(true);
    // The foreign MX stays as it is.
    expect(records.filter((r) => r.type === 'MX').map((r) => r.data)).toEqual(['10 mail.muster-ag.ch']);
    expect(records.find((r) => r.name === '_dmarc')!.ttl).toBe(3600);

    const added = await auditEntries('domain.dns_add', zoneId);
    expect(added).toHaveLength(5);
    expect(added.every((e) => (e.details as { source: string }).source === 'mail')).toBe(true);
    expect(added.every((e) => (e.details as { mailDomainId: string }).mailDomainId === shop)).toBe(true);
    const [apply] = await auditEntries('mail.dns_apply', shop);
    expect(apply).toMatchObject({
      status: 'success',
      details: { zoneDomainId: zoneId, added: result.added, failed: [] },
    });

    // Nothing left to add.
    const again = json<MailDnsApplyResult>(
      await anna.post(`/mail/domains/${shop}/dns/apply`, { keys: ['spf'] }),
    );
    expect(again).toMatchObject({ added: [], skipped: [{ key: 'spf', reason: 'not_missing' }] });
  });

  it('generates a DKIM key once and then adds its long record', async () => {
    const shop = await mailId('muster-shop.ch');
    const res = await anna.post(`/mail/domains/${shop}/dkim`, {});
    expect(res.statusCode, res.body).toBe(200);
    const setup = json<MailDnsSetupDto>(res);
    expect(setup.dkim).toEqual({ selector: 'dkim', present: true, keyLength: '2048' });
    const dkim = setup.records.find((r) => r.key === 'dkim')!;
    expect(dkim).toMatchObject({ status: 'missing', hint: null, addable: true, name: 'dkim._domainkey' });
    expect(dkim.data).toHaveLength(420);
    expect((await anna.post(`/mail/domains/${shop}/dkim`, { keySize: 4096 })).statusCode).toBe(409);
    expect(await auditEntries('mail.dkim_create', shop)).toHaveLength(2);
    expect((await carla.post(`/mail/domains/${shop}/dkim`, {})).statusCode).toBe(403);

    const applied = json<MailDnsApplyResult>(
      await anna.post(`/mail/domains/${shop}/dns/apply`, { keys: ['dkim'] }),
    );
    expect(applied.added).toEqual(['dkim']);
    const records = json<DnsRecord[]>(
      await anna.get(`/domains/${await panelDomainId('muster-shop.ch')}/dns`),
    );
    const txt = records.find((r) => r.name === 'dkim._domainkey')!;
    expect(txt.data).toBe(dkim.data);
    expect(txt.data).toHaveLength(420);
    expect(applied.setup.records.find((r) => r.key === 'dkim')!.status).toBe('ok');
  });

  it('adds nothing for viewers or without a panel domain', async () => {
    const musterAg = await mailId('muster-ag.ch');
    const viewer = json<MailDnsSetupDto>(await carla.get(`/mail/domains/${musterAg}/dns`));
    expect(viewer.zone).toMatchObject({ canEdit: false, writable: true });
    expect(viewer.records.every((r) => !r.addable)).toBe(true);
    // muster-ag.ch: MX, SPF and autodiscover point elsewhere, DMARC is there, DKIM is not.
    const byKey = Object.fromEntries(viewer.records.map((r) => [r.key, r]));
    expect(byKey.mx!.hint).toBe('other_mx');
    expect(byKey.spf!.hint).toBe('other_spf');
    expect(byKey.autodiscover!.hint).toBe('other_target');
    expect(byKey.dmarc!.status).toBe('ok');
    expect(byKey.dkim).toMatchObject({ status: 'missing', hint: null });
    expect((await carla.post(`/mail/domains/${musterAg}/dns/apply`, {})).statusCode).toBe(403);

    const alpen = await mailId('alpen-hosting.ch');
    const none = json<MailDnsSetupDto>(await reto.get(`/mail/domains/${alpen}/dns`));
    expect(none.zone).toBeNull();
    expect(none.dkim.present).toBe(true);
    expect(none.records.every((r) => r.status === 'unknown' && !r.addable)).toBe(true);
    const apply = await reto.post(`/mail/domains/${alpen}/dns/apply`, {});
    expect(apply.statusCode).toBe(409);
  });
});

describe('admin', () => {
  it('lists mail domains with filters', async () => {
    const names = async (query: string) =>
      json<MailDomainDto[]>(await admin.get(`/admin/mail/domains${query}`)).map((d) => d.asciiName);
    expect(await names(`?providerId=${demo.id}`)).toHaveLength(6);
    expect(await names('?assigned=false')).toEqual(['alpenblick-hotel.ch', 'xn--mller-kva.ch']);
    expect(await names('?assigned=true')).toEqual([
      'alpen-hosting.ch',
      'baeckerei-huber.ch',
      'muster-ag.ch',
      'muster-shop.ch',
    ]);
    expect(await names(`?orgId=${musterId}`)).toEqual(['muster-ag.ch', 'muster-shop.ch']);
    expect(await names('?q=xn--mller')).toEqual(['xn--mller-kva.ch']);
    expect(await names('?q=müller')).toEqual(['xn--mller-kva.ch']);
    expect((await anna.get('/admin/mail/domains')).statusCode).toBe(403);
  });

  it('creates a mail domain at the instance for a customer', async () => {
    const res = await admin.post('/admin/mail/domains', {
      providerId: demo.id,
      domain: 'Neu-Kunde.ch',
      description: 'Neukunde',
      limits: LIMITS,
      orgId: beispielId,
      restartSogo: false,
    });
    expect(res.statusCode, res.body).toBe(200);
    const { domain, warnings } = json<MailDomainChangeResult>(res);
    expect(warnings).toEqual([]);
    expect(domain).toMatchObject({
      name: 'neu-kunde.ch',
      asciiName: 'neu-kunde.ch',
      org: { id: beispielId },
      limits: {
        maxMailboxes: 5,
        quotaBytes: 5120 * MiB,
        maxMailboxQuotaBytes: 2048 * MiB,
        rateLimit: { value: 200, frame: 'h' },
      },
      usage: { mailboxes: 0 },
    });
    expect(await modulesOf(beispielId)).toContain('mail');
    expect(mailState().domains.get('neu-kunde.ch')).toMatchObject({ maxMailboxes: 5, quotaMb: 5120 });
    expect(mailState().dkim.get('neu-kunde.ch')!.keyLength).toBe('2048');
    expect(await mailRow('neu-kunde.ch')).toMatchObject({ orgId: beispielId, missingSince: null });
    const [entry] = await auditEntries('mail.domain_create', domain.id);
    expect(entry).toMatchObject({
      status: 'success',
      orgId: beispielId,
      details: { domain: 'neu-kunde.ch', providerId: demo.id, dkimKeySize: 2048, moduleEnabled: 'mail' },
    });
    // dev, the owner of Beispiel GmbH, manages it now.
    expect((await dev.get(`/mail/domains/${domain.id}`)).statusCode).toBe(200);

    expect(
      (
        await admin.post('/admin/mail/domains', {
          providerId: demo.id,
          domain: 'neu-kunde.ch',
          limits: LIMITS,
        })
      ).statusCode,
    ).toBe(409);

    // The same name on another instance: MX can only point to one server.
    const second = await newDemoConnection('Mail Zwei');
    const elsewhere = await admin.post('/admin/mail/domains', {
      providerId: second.id,
      domain: 'neu-kunde.ch',
      limits: LIMITS,
    });
    expect(elsewhere.statusCode).toBe(409);
    expect(json(elsewhere).error.message).toContain(demo.name);
    expect(demoMailState(second.id).domains.has('neu-kunde.ch')).toBe(false);

    const invalid = await admin.post('/admin/mail/domains', {
      providerId: demo.id,
      domain: 'kunde',
      limits: LIMITS,
    });
    expect(invalid.statusCode).toBe(400);
    expect(json(invalid).error.details[0].path).toBe('domain');
    const order = await admin.post('/admin/mail/domains', {
      providerId: demo.id,
      domain: 'order.ch',
      limits: { ...LIMITS, defaultMailboxQuotaMb: 4096 },
    });
    expect(order.statusCode).toBe(400);

    // A reseller's customer only gets modules its reseller has.
    const modules = await modulesOf(alpenId);
    await setModules(
      alpenId,
      modules.filter((m) => m !== 'mail'),
    );
    try {
      const refused = await admin.post('/admin/mail/domains', {
        providerId: demo.id,
        domain: 'huber-neu.ch',
        limits: LIMITS,
        orgId: huberId,
      });
      expect(refused.statusCode).toBe(409);
      expect(mailState().domains.has('huber-neu.ch')).toBe(false);
      const failures = (await auditEntries('mail.domain_create')).filter((e) => e.status === 'failure');
      expect(failures.map((e) => (e.details as { domain: string }).domain)).toEqual([
        'neu-kunde.ch',
        'neu-kunde.ch',
        'huber-neu.ch',
      ]);
    } finally {
      await setModules(alpenId, modules);
    }

    // Unicode input is created in punycode at Mailcow.
    const idn = await admin.post('/admin/mail/domains', {
      providerId: demo.id,
      domain: 'Zürich-Mail.ch',
      limits: { ...LIMITS, rateLimit: null },
      restartSogo: false,
    });
    expect(idn.statusCode, idn.body).toBe(200);
    expect(json<MailDomainChangeResult>(idn).domain).toMatchObject({
      name: 'zürich-mail.ch',
      asciiName: 'xn--zrich-mail-9db.ch',
      org: null,
    });
    expect(mailState().domains.has('xn--zrich-mail-9db.ch')).toBe(true);
  });

  it('changes limits, removes the rate limit and passes Mailcow refusals on', async () => {
    const id = await mailId('neu-kunde.ch');
    const res = await admin.patch(`/admin/mail/domains/${id}`, {
      limits: { maxMailboxes: 10, rateLimit: null },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<MailDomainChangeResult>(res)).toMatchObject({
      domain: { limits: { maxMailboxes: 10, maxAliases: 50, rateLimit: null } },
      warnings: [],
    });
    expect(mailState().domains.get('neu-kunde.ch')).toMatchObject({ maxMailboxes: 10, rateLimit: null });
    const [entry] = await auditEntries('mail.domain_update', id);
    expect(entry!.details).toEqual({
      domain: 'neu-kunde.ch',
      before: { maxMailboxes: 5, rateLimit: { value: 200, frame: 'h' } },
      after: { maxMailboxes: 10, rateLimit: null },
    });

    // Nothing changed: nothing sent, nothing audited.
    expect(
      (await admin.patch(`/admin/mail/domains/${id}`, { limits: { maxMailboxes: 10 } })).statusCode,
    ).toBe(200);
    expect(await auditEntries('mail.domain_update', id)).toHaveLength(1);

    // Mailcow's usage checks: muster-ag.ch has more mailboxes than that.
    const musterAg = await mailId('muster-ag.ch');
    const below = await admin.patch(`/admin/mail/domains/${musterAg}`, { limits: { maxMailboxes: 2 } });
    expect(below.statusCode).toBe(409);
    expect(json(below).error.message).toMatch(/Max\. mailboxes must be greater or equal to/);
    expect((await auditEntries('mail.domain_update', musterAg))[0]!.status).toBe('failure');
    const order = await admin.patch(`/admin/mail/domains/${id}`, {
      limits: { defaultMailboxQuotaMb: 4096 },
    });
    expect(order.statusCode).toBe(400);

    const inactive = await admin.patch(`/admin/mail/domains/${id}`, { active: false });
    expect(json<MailDomainChangeResult>(inactive).domain.active).toBe(false);
    expect(mailState().domains.get('neu-kunde.ch')!.active).toBe(false);
    expect((await dev.patch(`/admin/mail/domains/${id}`, { active: true })).statusCode).toBe(403);
    expect(
      json<MailDomainChangeResult>(await admin.patch(`/admin/mail/domains/${id}`, { active: true })).domain
        .active,
    ).toBe(true);
  });

  it('deletes only empty mail domains, with their DKIM key unless asked otherwise', async () => {
    const id = await mailId('neu-kunde.ch');
    const created = await admin.post(`/mail/domains/${id}/mailboxes`, {
      localPart: 'test',
      password: 'Test-Passwort-123',
    });
    expect(created.statusCode, created.body).toBe(200);

    const notEmpty = await admin.del(`/admin/mail/domains/${id}`, { confirm: 'neu-kunde.ch' });
    expect(notEmpty.statusCode).toBe(409);
    expect(json(notEmpty).error).toMatchObject({ code: 'domain_not_empty', details: { mailboxes: 1 } });
    expect(mailState().domains.has('neu-kunde.ch')).toBe(true);
    expect((await admin.del(`/admin/mail/domains/${id}`, { confirm: 'neu' })).statusCode).toBe(400);

    expect(
      (await admin.del(`/mail/domains/${id}/mailboxes/test@neu-kunde.ch`, { confirm: 'test@neu-kunde.ch' }))
        .statusCode,
    ).toBe(200);
    const res = await admin.del(`/admin/mail/domains/${id}`, { confirm: 'NEU-KUNDE.CH' });
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res)).toEqual({ ok: true, warnings: [] });
    expect(await mailRow('neu-kunde.ch')).toBeUndefined();
    expect(mailState().domains.has('neu-kunde.ch')).toBe(false);
    expect(mailState().dkim.has('neu-kunde.ch')).toBe(false);
    const entries = await auditEntries('mail.domain_delete', id);
    expect(entries.map((e) => e.status)).toEqual(['failure', 'success']);
    expect(entries[1]!.details).toMatchObject({
      domain: 'neu-kunde.ch',
      orgId: beispielId,
      deleteDkim: true,
    });

    // With deleteDkim: false the key stays (Mailcow keeps it as well).
    const idn = await mailId('xn--zrich-mail-9db.ch');
    const kept = await admin.del(`/admin/mail/domains/${idn}`, {
      confirm: 'zürich-mail.ch',
      deleteDkim: false,
    });
    expect(kept.statusCode, kept.body).toBe(200);
    expect(mailState().domains.has('xn--zrich-mail-9db.ch')).toBe(false);
    expect(mailState().dkim.has('xn--zrich-mail-9db.ch')).toBe(true);
  });

  it('removes only the row of a domain gone at Mailcow', async () => {
    const res = await admin.post('/admin/mail/domains', {
      providerId: demo.id,
      domain: 'weg.ch',
      limits: LIMITS,
      restartSogo: false,
    });
    const { domain } = json<MailDomainChangeResult>(res);
    mailState().domains.delete('weg.ch');
    // Not marked missing yet: sync first.
    expect((await admin.del(`/admin/mail/domains/${domain.id}`, { confirm: 'weg.ch' })).statusCode).toBe(404);
    await sync();
    expect((await mailRow('weg.ch'))!.missingSince).not.toBeNull();
    const gone = await admin.del(`/admin/mail/domains/${domain.id}`, { confirm: 'weg.ch' });
    expect(gone.statusCode, gone.body).toBe(200);
    expect(await mailRow('weg.ch')).toBeUndefined();
    const entries = await auditEntries('mail.domain_delete', domain.id);
    expect(entries.at(-1)!.details).toMatchObject({ goneAtMailcow: true });
  });

  it('assigns and unassigns mail domains', async () => {
    const id = await mailId('xn--mller-kva.ch');
    expect((await anna.post(`/admin/mail/domains/${id}/assign`, { orgId: musterId })).statusCode).toBe(403);
    expect((await dev.post(`/admin/mail/domains/${id}/assign`, { orgId: beispielId })).statusCode).toBe(403);
    const assigned = await admin.post(`/admin/mail/domains/${id}/assign`, { orgId: beispielId });
    expect(assigned.statusCode, assigned.body).toBe(200);
    expect(json<MailDomainDto>(assigned)).toMatchObject({ name: 'müller.ch', org: { id: beispielId } });
    expect(
      json<MailDomainDto[]>(await dev.get(`/orgs/${beispielId}/mail/domains`)).map((d) => d.name),
    ).toContain('müller.ch');
    const unassigned = await admin.post(`/admin/mail/domains/${id}/assign`, { orgId: null });
    expect(json<MailDomainDto>(unassigned).org).toBeNull();
    const entries = [
      ...(await auditEntries('mail.domain_assign', id)),
      ...(await auditEntries('mail.domain_unassign', id)),
    ];
    expect(entries.map((e) => e.details)).toEqual([
      expect.objectContaining({ orgId: beispielId, previousOrgId: null }),
      expect.objectContaining({ orgId: null, previousOrgId: beispielId }),
    ]);
    expect((await dev.get(`/mail/domains/${id}`)).statusCode).toBe(404);
  });
});

describe('reseller', () => {
  it('hands a mail domain from the pool to a customer and back', async () => {
    const id = await mailId('alpen-hosting.ch');
    const modules = await modulesOf(huberId);
    await setModules(
      huberId,
      modules.filter((m) => m !== 'mail'),
    );
    const resources = async () =>
      json<{
        mailDomains: { id: string; name: string }[];
        pool: { mailDomains: { id: string; name: string }[] };
      }>(await reto.get(`/orgs/${alpenId}/customers/${huberId}/resources`));
    expect((await resources()).pool.mailDomains).toEqual([{ id, name: 'alpen-hosting.ch' }]);

    const handed = await reto.post(`/orgs/${alpenId}/customers/${huberId}/resources`, {
      type: 'maildomain',
      id,
    });
    expect(handed.statusCode, handed.body).toBe(200);
    expect(await modulesOf(huberId)).toContain('mail');
    const moved = await resources();
    expect(moved.mailDomains.map((d) => d.name)).toEqual(['alpen-hosting.ch', 'baeckerei-huber.ch']);
    expect(moved.pool.mailDomains).toEqual([]);
    expect(
      json<MailDomainDto[]>(await hanna.get(`/orgs/${huberId}/mail/domains`)).map((d) => d.asciiName),
    ).toEqual(['alpen-hosting.ch', 'baeckerei-huber.ch']);
    const mailbox = await hanna.post(`/mail/domains/${id}/mailboxes`, { localPart: 'hanna' });
    expect(mailbox.statusCode, mailbox.body).toBe(200);
    expect(mailState().domains.get('alpen-hosting.ch')!.mailboxes.has('hanna')).toBe(true);

    const released = await reto.post(`/orgs/${alpenId}/customers/${huberId}/resources/release`, {
      type: 'maildomain',
      id,
    });
    expect(released.statusCode, released.body).toBe(200);
    expect((await resources()).pool.mailDomains).toEqual([{ id, name: 'alpen-hosting.ch' }]);
    expect((await hanna.get(`/mail/domains/${id}`)).statusCode).toBe(404);
  });
});

describe('deleting organizations and providers', () => {
  it('refuses while mail domains are assigned', async () => {
    const [org] = await t.db
      .insert(organizations)
      .values({ name: 'Temp AG', slug: 'temp-ag', kind: 'customer', boundary: DEFAULT_CUSTOMER_BOUNDARY })
      .returning();
    const id = await mailId('xn--mller-kva.ch');
    expect((await admin.post(`/admin/mail/domains/${id}/assign`, { orgId: org!.id })).statusCode).toBe(200);
    const refused = await admin.del(`/admin/orgs/${org!.id}`);
    expect(refused.statusCode).toBe(409);
    expect(json(refused).error.details.mailDomains).toBe(1);
    await admin.post(`/admin/mail/domains/${id}/assign`, { orgId: null });
    expect((await admin.del(`/admin/orgs/${org!.id}`)).statusCode).toBe(200);

    // A second instance with an assigned mail domain cannot be deleted.
    const second = (await t.db.query.providerConnections.findFirst({
      where: eq(providerConnections.name, 'Mail Zwei'),
    }))!;
    expect((await sync(second)).mailDomains).toEqual({ seen: 6, missing: 0 });
    const secondId = await mailId('muster-ag.ch', second.id);
    expect(
      (await admin.post(`/admin/mail/domains/${secondId}/assign`, { orgId: beispielId })).statusCode,
    ).toBe(200);
    const provider = await admin.del(`/admin/providers/${second.id}`);
    expect(provider.statusCode).toBe(409);
    expect(json(provider).error.message).toMatch(/mail domains/);
    await admin.post(`/admin/mail/domains/${secondId}/assign`, { orgId: null });
    expect((await admin.del(`/admin/providers/${second.id}`)).statusCode).toBe(200);
    expect(await mailRow('muster-ag.ch', second.id)).toBeUndefined();
  });
});
