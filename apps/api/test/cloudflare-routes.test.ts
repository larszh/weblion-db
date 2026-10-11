import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import type {
  CdnSettings,
  DnsMovePreview,
  DnsMoveResult,
  DnsRecord,
  DomainDetailDto,
  DomainDto,
  ModuleKey,
} from '@weblion/shared';
import { auditLogs, domains, memberships, organizations, providerConnections, users } from '../src/db/schema';
import { hashPassword } from '../src/lib/crypto';
import { ProviderError } from '../src/lib/errors';
import {
  CLOUDFLARE_DOMAIN_CAPABILITIES,
  CLOUDFLARE_RECORD_TYPES,
} from '../src/providers/cloudflare/constants';
import { DemoAdapter } from '../src/providers/demo/adapter';
import { DemoCloudflareAdapter } from '../src/providers/demo/cloudflare';
import { demoHostingState } from '../src/providers/demo/hosting';
import type { ProviderAdapter } from '../src/providers/types';
import { ADMIN, Client, createTestApp, DEMO_PASSWORD, json, type TestApp } from './helpers';

/**
 * Cloudflare zones in the API: first-sync assignment, links between registration and zone,
 * DNS records with the proxy flag, CDN settings, the activation check and the platform-only
 * DNS move. Runs on the opt-in demo Cloudflare (ENABLE_DEMO_CLOUDFLARE) next to the demo
 * registrar.
 */

type Connection = typeof providerConnections.$inferSelect;

let t: TestApp;
let admin: Client;
let anna: Client;
let carla: Client;
let dev: Client;
let mia: Client;
let hanna: Client;
let reto: Client;
let orgIds: Record<'muster' | 'beispiel' | 'huber' | 'alpen', string>;
let registrar: Connection;
let cloudflare: Connection;
let firstSync: { domains?: { seen: number; missing: number } };

const ZONE_NS = ['ana.ns.cloudflare.com', 'bob.ns.cloudflare.com'];
const DEMO_NS = ['ns1.fireapi.de', 'ns2.fireapi.de'];

async function connection(envKey: string): Promise<Connection> {
  const row = await t.db.query.providerConnections.findFirst({
    where: eq(providerConnections.envKey, envKey),
  });
  return row!;
}

/** The domain row of this name at a connection. */
async function row(conn: Connection, name: string) {
  return t.db.query.domains.findFirst({
    where: and(eq(domains.providerConnectionId, conn.id), eq(domains.name, name)),
  });
}

async function id(conn: Connection, name: string): Promise<string> {
  return (await row(conn, name))!.id;
}

async function auditEntries(action: string, resourceId: string) {
  return t.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, action), eq(auditLogs.resourceId, resourceId)))
    .orderBy(auditLogs.id);
}

async function setModules(orgId: string, modules: ModuleKey[]) {
  await t.db.update(organizations).set({ modules }).where(eq(organizations.id, orgId));
}

async function assign(domainId: string, orgId: string | null) {
  const res = await admin.post(`/admin/domains/${domainId}/assign`, { orgId, enableModule: false });
  expect(res.statusCode, res.body).toBe(200);
}

async function syncCloudflare() {
  const res = await admin.post(`/admin/providers/${cloudflare.id}/sync`);
  expect(res.statusCode, res.body).toBe(200);
  return json(res);
}

async function newUser(
  email: string,
  options: { platformRole?: 'support'; orgId?: string; role?: 'member' } = {},
): Promise<Client> {
  const [user] = await t.db
    .insert(users)
    .values({
      email,
      name: email.split('@')[0]!,
      passwordHash: await hashPassword(DEMO_PASSWORD),
      platformRole: options.platformRole ?? null,
    })
    .returning();
  if (options.orgId) {
    await t.db
      .insert(memberships)
      .values({ orgId: options.orgId, userId: user!.id, role: options.role ?? 'member' });
  }
  const client = new Client(t.app);
  await client.login(email);
  return client;
}

async function token(owner: Client, orgId: string, scope: 'read' | 'read_write'): Promise<Client> {
  const res = await owner.post(`/orgs/${orgId}/tokens`, { name: `cf-${scope}-${Date.now()}`, scope });
  expect(res.statusCode, res.body).toBe(200);
  const bot = new Client(t.app);
  bot.bearer = json(res).token;
  return bot;
}

beforeAll(async () => {
  t = await createTestApp({ env: { ENABLE_DEMO_CLOUDFLARE: 'true' } });
  admin = new Client(t.app);
  await admin.login(ADMIN.email, ADMIN.password);
  const orgs = json<{ id: string; slug: string }[]>(await admin.get('/admin/orgs'));
  const org = (slug: string) => orgs.find((o) => o.slug === slug)!.id;
  orgIds = {
    muster: org('muster-ag'),
    beispiel: org('beispiel-gmbh'),
    huber: org('baeckerei-huber'),
    alpen: org('alpen-hosting'),
  };
  anna = new Client(t.app);
  await anna.login('anna@muster.example');
  carla = new Client(t.app);
  await carla.login('carla@muster.example');
  dev = new Client(t.app);
  await dev.login('dev@beispiel.example');
  hanna = new Client(t.app);
  await hanna.login('huber@baeckerei.example');
  reto = new Client(t.app);
  await reto.login('reseller@alpen.example');
  mia = await newUser('mia@muster.example', { orgId: orgIds.muster, role: 'member' });
  registrar = await connection('demo');
  cloudflare = await connection('demo-cloudflare');
  // The test helper only syncs the demo registrar; this is the zones' first sync.
  firstSync = await syncCloudflare();
});

afterAll(async () => {
  await t?.close();
});

describe('sync', () => {
  it('stores the zones and gives the one with an assigned registration to its organization', async () => {
    expect(firstSync).toMatchObject({ seen: 0, missing: 0, domains: { seen: 3, missing: 0 } });
    const zones = json<DomainDto[]>(await admin.get(`/admin/domains?providerId=${cloudflare.id}`));
    expect(zones.map((z) => [z.name, z.kind, z.org?.id ?? null])).toEqual([
      ['alt-muster.ch', 'zone', null],
      ['beispiel-gmbh.de', 'zone', null],
      ['muster-shop.ch', 'zone', orgIds.muster],
    ]);
    for (const zone of zones) expect(zone.capabilities).toEqual([...CLOUDFLARE_DOMAIN_CAPABILITIES]);
    const registrations = json<DomainDto[]>(await admin.get(`/admin/domains?providerId=${registrar.id}`));
    expect(registrations.every((d) => d.kind === 'registration')).toBe(true);
    // Registrations without a zone of their name have no counterpart.
    for (const name of ['alpenblick-hotel.ch', 'baeckerei-huber.ch']) {
      expect(await row(cloudflare, name)).toBeUndefined();
    }

    const zoneId = await id(cloudflare, 'muster-shop.ch');
    const entries = await auditEntries('domain.assign', zoneId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      orgId: orgIds.muster,
      status: 'success',
      actorName: 'Sync',
      actorUserId: null,
      resourceType: 'domain',
    });
    expect(entries[0]!.details).toEqual({
      name: 'muster-shop.ch',
      orgId: orgIds.muster,
      previousOrgId: null,
      reason: 'matching_registration',
      registrationIds: [await id(registrar, 'muster-shop.ch')],
      moduleEnabled: null,
    });
  });

  it('stores the zone facts, no records and no secrets', async () => {
    const active = (await row(cloudflare, 'muster-shop.ch'))!;
    expect(active.status).toBe('active');
    expect(active.info).toMatchObject({
      name: 'muster-shop.ch',
      status: 'active',
      nameservers: ZONE_NS,
      providerDns: true,
      expiresAt: null,
      zone: {
        status: 'active',
        type: 'full',
        paused: false,
        originalNameservers: DEMO_NS,
        activatedAt: '2023-01-10T14:30:00.000Z',
        plan: 'Free Website',
      },
    });
    expect(active.meta).toEqual({ zoneType: 'full', plan: 'free', accountId: expect.any(String) });
    const pending = (await row(cloudflare, 'beispiel-gmbh.de'))!;
    expect(pending.info).toMatchObject({
      status: 'pending',
      providerDns: false,
      zone: { status: 'pending' },
    });
    const stored = JSON.stringify(
      await t.db.select().from(domains).where(eq(domains.providerConnectionId, cloudflare.id)),
    );
    expect(stored).not.toMatch(/token|secret|passw/i);
    // DNS records stay at the provider.
    expect(stored).not.toContain('185.101.20.11');
  });

  it('never assigns a zone again that staff took away', async () => {
    const zoneId = await id(cloudflare, 'muster-shop.ch');
    await assign(zoneId, null);
    await syncCloudflare();
    expect((await row(cloudflare, 'muster-shop.ch'))!.orgId).toBeNull();
    expect(await auditEntries('domain.assign', zoneId)).toHaveLength(1);
    await assign(zoneId, orgIds.muster);
  });

  it('assigns a new zone only when exactly one organization holds its registration', async () => {
    const insert = (externalId: string, name: string, orgId: string, missing = false) =>
      t.db
        .insert(domains)
        .values({
          providerConnectionId: registrar.id,
          externalId,
          name,
          orgId,
          status: 'OK',
          missingSince: missing ? new Date() : null,
        })
        .returning({ id: domains.id });
    const extra = ['dup-1', 'dup-2', 'one-1', 'one-2'];
    await insert('dup-1', 'doppelt.ch', orgIds.muster);
    await insert('dup-2', 'Doppelt.CH', orgIds.beispiel);
    const [kept] = await insert('one-1', 'einzeln.ch', orgIds.beispiel);
    // A registration that vanished at the registrar does not count.
    await insert('one-2', 'einzeln.ch', orgIds.muster, true);
    const adapter = t.ctx.providers.forConnection(cloudflare);
    await adapter.createZone!('doppelt.ch');
    await adapter.createZone!('einzeln.ch');
    try {
      expect((await syncCloudflare()).domains).toEqual({ seen: 5, missing: 0 });
      const doppelt = (await row(cloudflare, 'doppelt.ch'))!;
      expect(doppelt.orgId).toBeNull();
      expect(await auditEntries('domain.assign', doppelt.id)).toHaveLength(0);
      const einzeln = (await row(cloudflare, 'einzeln.ch'))!;
      expect(einzeln.orgId).toBe(orgIds.beispiel);
      const [entry] = await auditEntries('domain.assign', einzeln.id);
      expect(entry!.details).toMatchObject({ registrationIds: [kept!.id], reason: 'matching_registration' });
      // Modules stay as they were.
      const beispiel = await t.db.query.organizations.findFirst({
        where: eq(organizations.id, orgIds.beispiel),
      });
      expect(beispiel!.modules).toContain('dns');
    } finally {
      await t.db
        .delete(domains)
        .where(and(eq(domains.providerConnectionId, registrar.id), inArray(domains.externalId, extra)));
      await assign(await id(cloudflare, 'einzeln.ch'), null);
    }
  });
});

describe('links between registration and zone', () => {
  it('shows the zone on the registration and the registration on the zone', async () => {
    const registrationId = await id(registrar, 'muster-shop.ch');
    const zoneId = await id(cloudflare, 'muster-shop.ch');
    const list = json<DomainDto[]>(await anna.get(`/orgs/${orgIds.muster}/domains`));
    expect(list.filter((d) => d.name === 'muster-shop.ch').map((d) => d.kind)).toEqual(
      expect.arrayContaining(['registration', 'zone']),
    );

    const registration = json<DomainDetailDto>(await anna.get(`/domains/${registrationId}`));
    expect(registration).toMatchObject({ kind: 'registration', registration: null });
    expect(registration.dnsZone).toEqual({
      id: zoneId,
      name: 'muster-shop.ch',
      kind: 'zone',
      provider: { id: cloudflare.id, type: 'demo', name: 'Demo Cloudflare' },
      org: { id: orgIds.muster, name: 'Muster AG', slug: 'muster-ag' },
      status: 'active',
      nameservers: ZONE_NS,
      active: true,
    });

    const zone = json<DomainDetailDto>(await anna.get(`/domains/${zoneId}`));
    expect(zone).toMatchObject({
      kind: 'zone',
      dnsZone: null,
      liveError: null,
      dnsWritable: true,
      dnsRecordTypes: [...CLOUDFLARE_RECORD_TYPES],
      capabilities: [...CLOUDFLARE_DOMAIN_CAPABILITIES],
      info: { status: 'active', zone: { status: 'active' } },
    });
    expect(zone.registration).toMatchObject({
      id: registrationId,
      kind: 'registration',
      provider: { id: registrar.id, type: 'demo' },
      status: 'OK',
      nameservers: ZONE_NS,
      // The registrar delegates to Cloudflare, so it does not serve the zone itself.
      active: false,
    });
  });

  it('links only rows the caller may read and that still exist', async () => {
    const registrationId = await id(registrar, 'muster-shop.ch');
    const zoneId = await id(cloudflare, 'muster-shop.ch');
    await assign(zoneId, orgIds.beispiel);
    try {
      expect(json<DomainDetailDto>(await anna.get(`/domains/${registrationId}`)).dnsZone).toBeNull();
      expect(json<DomainDetailDto>(await dev.get(`/domains/${zoneId}`)).registration).toBeNull();
      expect(json<DomainDetailDto>(await admin.get(`/domains/${registrationId}`)).dnsZone).toMatchObject({
        id: zoneId,
        org: { slug: 'beispiel-gmbh' },
      });
    } finally {
      await assign(zoneId, orgIds.muster);
    }
    await t.db.update(domains).set({ missingSince: new Date() }).where(eq(domains.id, zoneId));
    try {
      expect(json<DomainDetailDto>(await anna.get(`/domains/${registrationId}`)).dnsZone).toBeNull();
    } finally {
      await t.db.update(domains).set({ missingSince: null }).where(eq(domains.id, zoneId));
    }
    expect(json<DomainDetailDto>(await anna.get(`/domains/${registrationId}`)).dnsZone?.id).toBe(zoneId);
  });
});

describe('DNS records of a zone', () => {
  let zoneId: string;
  const records = async () => json<DnsRecord[]>(await anna.get(`/domains/${zoneId}/dns`));

  beforeAll(async () => {
    zoneId = await id(cloudflare, 'muster-shop.ch');
  });

  it('lists records with proxy state and comments', async () => {
    const list = await records();
    expect(list.find((r) => r.type === 'CNAME' && r.name === 'www')).toMatchObject({
      data: 'muster-shop.ch',
      proxied: true,
      proxiable: true,
      ttl: 1,
    });
    expect(list.find((r) => r.type === 'TXT' && r.name === '@')).toMatchObject({
      comment: 'Google Search Console',
      ttl: 3600,
      proxiable: false,
    });
    expect(list.find((r) => r.type === 'HTTPS')).toMatchObject({ readOnly: true });
  });

  it('adds, changes and deletes records with the proxy flag and audits it', async () => {
    const created = await anna.post(`/domains/${zoneId}/dns`, {
      type: 'A',
      name: 'cdn',
      data: '192.0.2.50',
      proxied: true,
    });
    expect(created.statusCode, created.body).toBe(200);
    const record = json<DnsRecord>(created);
    expect(record).toMatchObject({ type: 'A', name: 'cdn', proxied: true, proxiable: true, ttl: 1 });
    const [added] = (await auditEntries('domain.dns_add', zoneId)).filter((e) => e.details?.name === 'cdn');
    expect(added!.details).toMatchObject({ domain: 'muster-shop.ch', proxied: true, data: '192.0.2.50' });

    const off = await anna.patch(`/domains/${zoneId}/dns/${record.id}`, { proxied: false });
    expect(off.statusCode, off.body).toBe(200);
    expect(json<DnsRecord>(off)).toMatchObject({ id: record.id, proxied: false });
    const timed = json<DnsRecord>(await anna.patch(`/domains/${zoneId}/dns/${record.id}`, { ttl: 300 }));
    expect(timed).toMatchObject({ proxied: false, ttl: 300 });
    // Proxied records always have the automatic TTL.
    const on = json<DnsRecord>(await anna.patch(`/domains/${zoneId}/dns/${record.id}`, { proxied: true }));
    expect(on).toMatchObject({ proxied: true, ttl: 1 });

    const updates = (await auditEntries('domain.dns_update', zoneId)).filter(
      (e) => e.details?.recordId === record.id,
    );
    expect(updates.map((e) => e.details)).toEqual([
      expect.objectContaining({ proxied: false, before: expect.objectContaining({ proxied: true, ttl: 1 }) }),
      expect.objectContaining({ ttl: 300, before: expect.objectContaining({ proxied: false }) }),
      expect.objectContaining({
        proxied: true,
        before: expect.objectContaining({ proxied: false, ttl: 300 }),
      }),
    ]);

    expect((await anna.del(`/domains/${zoneId}/dns/${record.id}`)).statusCode).toBe(200);
    const [deleted] = (await auditEntries('domain.dns_delete', zoneId)).filter(
      (e) => e.details?.recordId === record.id,
    );
    expect(deleted!.details).toMatchObject({ type: 'A', name: 'cdn', proxied: true });
  });

  it('refuses the proxy for records that cannot use it', async () => {
    const before = await records();
    const failuresBefore = (await auditEntries('domain.dns_add', zoneId)).length;
    for (const body of [
      { type: 'MX', name: '@', data: '20 mx2.example.ch', proxied: true },
      { type: 'TXT', name: 'proxy', data: 'hello', proxied: true },
    ]) {
      const res = await anna.post(`/domains/${zoneId}/dns`, body);
      expect(res.statusCode, body.type).toBe(400);
      expect(json(res).error.details).toEqual([
        { path: 'proxied', message: 'Only A, AAAA and CNAME records can be proxied' },
      ]);
    }
    // Refused before the provider is asked: nothing audited.
    expect(await auditEntries('domain.dns_add', zoneId)).toHaveLength(failuresBefore);

    const mx = before.find((r) => r.type === 'MX')!;
    const patched = await anna.patch(`/domains/${zoneId}/dns/${mx.id}`, { proxied: true });
    expect(patched.statusCode).toBe(400);
    expect(json(patched).error.details[0].path).toBe('proxied');
    // A proxied record that turns into a type without proxy needs the flag switched off.
    const www = before.find((r) => r.type === 'CNAME' && r.name === 'www')!;
    expect(
      (await anna.patch(`/domains/${zoneId}/dns/${www.id}`, { type: 'TXT', data: 'no proxy' })).statusCode,
    ).toBe(400);

    // Cloudflare cannot proxy private addresses: the provider's 400 comes through and is audited.
    const internal = await anna.post(`/domains/${zoneId}/dns`, {
      type: 'A',
      name: 'intranet',
      data: '10.1.2.3',
      proxied: true,
    });
    expect(internal.statusCode).toBe(400);
    expect(json(internal).error.message).toMatch(/private address/);
    const [failure] = (await auditEntries('domain.dns_add', zoneId)).filter((e) => e.status === 'failure');
    expect(failure!.details).toMatchObject({ name: 'intranet', proxied: true });
    expect(await records()).toEqual(before);
  });

  it('changes the type through a new record', async () => {
    const created = json<DnsRecord>(
      await anna.post(`/domains/${zoneId}/dns`, { type: 'A', name: 'typ', data: '192.0.2.60' }),
    );
    const res = await anna.patch(`/domains/${zoneId}/dns/${created.id}`, {
      type: 'AAAA',
      data: '2001:db8::60',
    });
    expect(res.statusCode, res.body).toBe(200);
    const changed = json<DnsRecord>(res);
    expect(changed).toMatchObject({ type: 'AAAA', name: 'typ', data: '2001:db8::60' });
    expect(changed.id).not.toBe(created.id);
    const ids = (await records()).map((r) => r.id);
    expect(ids).toContain(changed.id);
    expect(ids).not.toContain(created.id);
    expect((await anna.del(`/domains/${zoneId}/dns/${changed.id}`)).statusCode).toBe(200);
  });

  it('lets members switch the proxy and keeps viewers out', async () => {
    const www = (await records()).find((r) => r.type === 'CNAME' && r.name === 'www')!;
    const off = await mia.patch(`/domains/${zoneId}/dns/${www.id}`, { proxied: false });
    expect(off.statusCode, off.body).toBe(200);
    expect(json<DnsRecord>(off).proxied).toBe(false);
    expect((await carla.patch(`/domains/${zoneId}/dns/${www.id}`, { proxied: true })).statusCode).toBe(403);
    expect(
      (await carla.post(`/domains/${zoneId}/dns`, { type: 'A', name: 'x', data: '192.0.2.1' })).statusCode,
    ).toBe(403);
    const on = await mia.patch(`/domains/${zoneId}/dns/${www.id}`, { proxied: true });
    expect(json<DnsRecord>(on).proxied).toBe(true);
  });

  it('takes changes in a zone that waits for its name servers', async () => {
    const pendingId = await id(cloudflare, 'beispiel-gmbh.de');
    await assign(pendingId, orgIds.beispiel);
    const detail = json<DomainDetailDto>(await dev.get(`/domains/${pendingId}`));
    expect(detail).toMatchObject({
      kind: 'zone',
      dnsWritable: true,
      registration: null,
      info: {
        status: 'pending',
        providerDns: false,
        nameservers: ['ivy.ns.cloudflare.com', 'rob.ns.cloudflare.com'],
      },
    });
    const created = await dev.post(`/domains/${pendingId}/dns`, {
      type: 'TXT',
      name: '@',
      data: 'v=spf1 -all',
    });
    expect(created.statusCode, created.body).toBe(200);
    expect((await dev.del(`/domains/${pendingId}/dns/${json<DnsRecord>(created).id}`)).statusCode).toBe(200);
  });

  it('ignores the proxy flag at registrars', async () => {
    const registrationId = await id(registrar, 'muster-ag.ch');
    const res = await anna.post(`/domains/${registrationId}/dns`, {
      type: 'A',
      name: 'noproxy',
      data: '192.0.2.70',
      proxied: true,
    });
    expect(res.statusCode, res.body).toBe(200);
    const record = json<DnsRecord>(res);
    expect(record).not.toHaveProperty('proxied');
    const [entry] = (await auditEntries('domain.dns_add', registrationId)).filter(
      (e) => e.details?.name === 'noproxy',
    );
    expect(entry!.details).not.toHaveProperty('proxied');
    const alone = await anna.patch(`/domains/${registrationId}/dns/${record.id}`, { proxied: true });
    expect(alone.statusCode).toBe(400);
    expect(json(alone).error.message).toBe('Nothing to change');
    expect((await anna.del(`/domains/${registrationId}/dns/${record.id}`)).statusCode).toBe(200);
  });
});

describe('CDN settings', () => {
  let zoneId: string;
  const cdn = (client: Client) => client.get(`/domains/${zoneId}/cdn`);
  const change = (client: Client, body: unknown) => client.patch(`/domains/${zoneId}/cdn`, body);
  const purge = (client: Client, body: unknown = { everything: true }) =>
    client.post(`/domains/${zoneId}/cdn/purge`, body);

  beforeAll(async () => {
    zoneId = await id(cloudflare, 'muster-shop.ch');
  });

  it('shows the settings to every reader', async () => {
    const res = await cdn(carla);
    expect(res.statusCode, res.body).toBe(200);
    expect(json<CdnSettings>(res)).toEqual({
      sslMode: 'full',
      sslAutomatic: false,
      alwaysUseHttps: true,
      developmentMode: false,
      developmentModeRemaining: null,
      editable: { sslMode: true, alwaysUseHttps: true, developmentMode: true },
    });
  });

  it('changes one setting at a time for owners and audits before and after', async () => {
    const https = await change(anna, { alwaysUseHttps: false });
    expect(https.statusCode, https.body).toBe(200);
    expect(json<CdnSettings>(https).alwaysUseHttps).toBe(false);
    const development = json<CdnSettings>(await change(anna, { developmentMode: true }));
    expect(development.developmentMode).toBe(true);
    expect(development.developmentModeRemaining).toBeGreaterThan(3 * 3600 - 60);
    expect(json<CdnSettings>(await change(anna, { developmentMode: false }))).toMatchObject({
      developmentMode: false,
      developmentModeRemaining: null,
    });
    expect(json<CdnSettings>(await change(anna, { alwaysUseHttps: true })).alwaysUseHttps).toBe(true);

    const entries = await auditEntries('domain.cdn_update', zoneId);
    expect(entries.map((e) => [e.status, e.orgId])).toEqual(Array(4).fill(['success', orgIds.muster]));
    expect(entries.map((e) => e.details)).toEqual([
      { domain: 'muster-shop.ch', setting: 'alwaysUseHttps', before: true, after: false },
      { domain: 'muster-shop.ch', setting: 'developmentMode', before: false, after: true },
      { domain: 'muster-shop.ch', setting: 'developmentMode', before: true, after: false },
      { domain: 'muster-shop.ch', setting: 'alwaysUseHttps', before: false, after: true },
    ]);
  });

  it('switches between automatic and manual SSL/TLS', async () => {
    const auto = json<CdnSettings>(await change(anna, { sslMode: 'auto' }));
    expect(auto).toMatchObject({ sslAutomatic: true, sslMode: 'full' });
    const strict = json<CdnSettings>(await change(anna, { sslMode: 'strict' }));
    expect(strict).toMatchObject({ sslAutomatic: false, sslMode: 'strict' });
    expect(json<CdnSettings>(await change(anna, { sslMode: 'full' }))).toMatchObject({
      sslAutomatic: false,
      sslMode: 'full',
    });
    const ssl = (await auditEntries('domain.cdn_update', zoneId)).filter(
      (e) => e.details?.setting === 'sslMode',
    );
    expect(ssl.map((e) => [e.details?.before, e.details?.after])).toEqual([
      ['full', 'auto'],
      ['auto', 'strict'],
      ['strict', 'full'],
    ]);
  });

  it('validates the change', async () => {
    const before = (await auditEntries('domain.cdn_update', zoneId)).length;
    for (const body of [
      { sslMode: 'full', alwaysUseHttps: true },
      { sslMode: 'origin_pull' },
      { sslMode: 'FULL' },
      { alwaysUseHttps: 'on' },
      { developmentMode: true, minutes: 10 },
      {},
      null,
    ]) {
      expect((await change(anna, body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(await auditEntries('domain.cdn_update', zoneId)).toHaveLength(before);
  });

  it('purges the whole cache for owners and read-write tokens', async () => {
    const res = await purge(anna);
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res)).toEqual({
      ok: true,
      message: 'Purge accepted',
      providerRef: expect.stringMatching(/^demo-purge-/),
    });
    for (const body of [{}, { everything: false }, { everything: true, files: ['/'] }]) {
      expect((await purge(anna, body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    // A deploy pipeline purges with a token.
    const pipeline = await token(anna, orgIds.muster, 'read_write');
    expect((await purge(pipeline)).statusCode).toBe(200);

    const entries = await auditEntries('domain.cache_purge', zoneId);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ status: 'success', orgId: orgIds.muster });
    expect(entries[0]!.details).toEqual({ domain: 'muster-shop.ch', everything: true });
    expect(entries[1]!.actorTokenId).not.toBeNull();
  });

  it('keeps members, viewers, read tokens and other organizations out of changes', async () => {
    for (const client of [mia, carla]) {
      expect((await change(client, { alwaysUseHttps: false })).statusCode).toBe(403);
      expect((await purge(client)).statusCode).toBe(403);
    }
    expect((await cdn(mia)).statusCode).toBe(200);
    for (const res of [await cdn(dev), await change(dev, { alwaysUseHttps: false }), await purge(dev)]) {
      expect(res.statusCode).toBe(404);
    }
    const reader = await token(anna, orgIds.muster, 'read');
    expect((await cdn(reader)).statusCode).toBe(200);
    expect((await change(reader, { alwaysUseHttps: false })).statusCode).toBe(403);
    expect((await purge(reader)).statusCode).toBe(403);
    expect(json<CdnSettings>(await cdn(anna)).alwaysUseHttps).toBe(true);
  });

  it('answers 422 for registered domains', async () => {
    const registrationId = await id(registrar, 'muster-shop.ch');
    const calls = [
      anna.get(`/domains/${registrationId}/cdn`),
      anna.patch(`/domains/${registrationId}/cdn`, { alwaysUseHttps: true }),
      anna.post(`/domains/${registrationId}/cdn/purge`, { everything: true }),
      anna.post(`/domains/${registrationId}/zone/activation-check`, {}),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.statusCode, res.body).toBe(422);
      expect(json(res).error.code).toBe('unsupported');
    }
  });

  it('hides the settings while the dns module is off', async () => {
    const org = await t.db.query.organizations.findFirst({ where: eq(organizations.id, orgIds.muster) });
    await setModules(
      orgIds.muster,
      org!.modules.filter((m) => m !== 'dns'),
    );
    try {
      for (const res of [await cdn(anna), await change(anna, { alwaysUseHttps: false }), await purge(anna)]) {
        expect(res.statusCode).toBe(404);
      }
      expect((await cdn(admin)).statusCode).toBe(200);
    } finally {
      await setModules(orgIds.muster, org!.modules);
    }
  });
});

describe('activation check', () => {
  it('asks the provider to check a pending zone and audits it', async () => {
    const pendingId = await id(cloudflare, 'beispiel-gmbh.de');
    expect((await row(cloudflare, 'beispiel-gmbh.de'))!.orgId).toBe(orgIds.beispiel);
    const res = await dev.post(`/domains/${pendingId}/zone/activation-check`, {});
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res)).toEqual({ ok: true, message: 'Activation check requested', providerRef: null });
    const [entry] = await auditEntries('domain.zone_activation_check', pendingId);
    expect(entry).toMatchObject({ status: 'success', orgId: orgIds.beispiel });
    expect(entry!.details).toEqual({ domain: 'beispiel-gmbh.de', status: 'pending' });
    // Nobody delegates to it yet.
    expect((await row(cloudflare, 'beispiel-gmbh.de'))!.status).toBe('pending');
  });

  it('refuses active zones, members and viewers', async () => {
    const activeId = await id(cloudflare, 'muster-shop.ch');
    const res = await anna.post(`/domains/${activeId}/zone/activation-check`, {});
    expect(res.statusCode).toBe(409);
    expect(json(res).error.message).toMatch(/status active/);
    expect(await auditEntries('domain.zone_activation_check', activeId)).toHaveLength(0);
    for (const client of [mia, carla]) {
      expect((await client.post(`/domains/${activeId}/zone/activation-check`, {})).statusCode).toBe(403);
    }
    const max = await newUser('max@beispiel.example', { orgId: orgIds.beispiel, role: 'member' });
    const pendingId = await id(cloudflare, 'beispiel-gmbh.de');
    expect((await max.post(`/domains/${pendingId}/zone/activation-check`, {})).statusCode).toBe(403);
  });
});

describe('DNS move to Cloudflare', () => {
  let support: Client;
  const move = (client: Client, domainId: string, body: Record<string, unknown> = {}) =>
    client.post(`/admin/domains/${domainId}/dns-move`, { targetProviderId: cloudflare.id, ...body });
  const registrarState = () => demoHostingState(registrar.id);
  const registrarInfo = (name: string) =>
    [...registrarState().domains.values()].find((d) => d.info.name === name)!.info;

  beforeAll(async () => {
    support = await newUser('support@weblion.test', { platformRole: 'support' });
  });

  it('previews which records the zone takes', async () => {
    const domainId = await id(registrar, 'alpenblick-hotel.ch');
    const res = await admin.get(`/admin/domains/${domainId}/dns-move`);
    expect(res.statusCode, res.body).toBe(200);
    const preview = json<DnsMovePreview>(res);
    expect(preview).toMatchObject({
      domain: {
        id: domainId,
        name: 'alpenblick-hotel.ch',
        provider: { id: registrar.id, type: 'demo' },
        org: null,
      },
      targetProviderId: cloudflare.id,
      existingZone: null,
      recordsAvailable: true,
      recordsError: null,
      canSetNameservers: true,
      maxRecords: 500,
    });
    expect(preview.targets).toEqual([{ providerId: cloudflare.id, name: 'Demo Cloudflare', type: 'demo' }]);
    expect(preview.skipped).toEqual([
      {
        type: 'HTTP_REDIRECT',
        name: 'buchen',
        data: 'https://booking.example.com/alpenblick',
        reason: 'type',
      },
      { type: 'MAILFW', name: 'info', data: 'empfang@alpenblick-hotel.example', reason: 'type' },
    ]);
    expect(preview.records.map((r) => `${r.type} ${r.name}`)).toEqual([
      'A @',
      'AAAA @',
      'CNAME www',
      'MX @',
      'TXT @',
      'SRV _sip._tls',
      'NAPTR @',
    ]);
    expect(preview.records.find((r) => r.type === 'NAPTR')).toEqual({
      type: 'NAPTR',
      name: '@',
      data: '100 10 "u" "E2U+sip" "!^.*$!sip:empfang@alpenblick-hotel.ch!" .',
      ttl: 300,
    });

    // The registrar row shows the existing zone; other targets are refused.
    const shop = json<DnsMovePreview>(
      await admin.get(`/admin/domains/${await id(registrar, 'muster-shop.ch')}/dns-move`),
    );
    expect(shop).toMatchObject({
      recordsAvailable: false,
      records: [],
      existingZone: { id: await id(cloudflare, 'muster-shop.ch'), status: 'active', active: true },
    });
    expect(
      (await admin.get(`/admin/domains/${domainId}/dns-move?targetProviderId=${registrar.id}`)).statusCode,
    ).toBe(422);
    expect(
      (
        await admin.get(
          `/admin/domains/${domainId}/dns-move?targetProviderId=00000000-0000-4000-8000-000000000000`,
        )
      ).statusCode,
    ).toBe(404);
  });

  it('is for platform staff with the permission in an interactive session only', async () => {
    const domainId = await id(registrar, 'muster-shop.ch');
    const bot = await token(anna, orgIds.muster, 'read_write');
    for (const client of [support, anna, bot]) {
      expect((await client.get(`/admin/domains/${domainId}/dns-move`)).statusCode).toBe(403);
      expect((await move(client, domainId)).statusCode).toBe(403);
    }
    const refused = await move(bot, domainId);
    expect(json(refused).error.message).toMatch(/interactive login/);
    expect(await auditEntries('domain.dns_move', domainId)).toHaveLength(0);
  });

  it('refuses zones, missing domains and targets that cannot create zones', async () => {
    const zoneId = await id(cloudflare, 'muster-shop.ch');
    expect((await admin.get(`/admin/domains/${zoneId}/dns-move`)).statusCode).toBe(422);
    expect((await move(admin, zoneId)).statusCode).toBe(422);
    const domainId = await id(registrar, 'alpenblick-hotel.ch');
    expect((await move(admin, domainId, { targetProviderId: registrar.id })).statusCode).toBe(422);
    expect((await move(admin, domainId, { targetProviderId: 'nope' })).statusCode).toBe(400);
    await t.db.update(domains).set({ missingSince: new Date() }).where(eq(domains.id, domainId));
    try {
      expect((await admin.get(`/admin/domains/${domainId}/dns-move`)).statusCode).toBe(409);
      expect((await move(admin, domainId)).statusCode).toBe(409);
    } finally {
      await t.db.update(domains).set({ missingSince: null }).where(eq(domains.id, domainId));
    }
    expect(await row(cloudflare, 'alpenblick-hotel.ch')).toBeUndefined();
  });

  it('moves a domain completely: zone, records, name servers', async () => {
    const domainId = await id(registrar, 'baeckerei-huber.ch');
    expect((await row(registrar, 'baeckerei-huber.ch'))!.orgId).toBe(orgIds.huber);
    const externalId = (await row(registrar, 'baeckerei-huber.ch'))!.externalId;
    const source = registrarState()
      .domains.get(externalId)!
      .records.map((r) => ({ ...r }));
    const res = await move(admin, domainId, { importRecords: true, setNameservers: true });
    expect(res.statusCode, res.body).toBe(200);
    const result = json<DnsMoveResult>(res);
    const zone = (await row(cloudflare, 'baeckerei-huber.ch'))!;
    expect(zone.orgId).toBe(orgIds.huber);
    expect(result.zoneCreated).toBe(true);
    expect(result.zone).toMatchObject({
      id: zone.id,
      name: 'baeckerei-huber.ch',
      kind: 'zone',
      status: 'pending',
      active: false,
      org: { id: orgIds.huber, slug: 'baeckerei-huber' },
    });
    const nameservers = result.zone.nameservers;
    expect(nameservers).toHaveLength(2);
    for (const ns of nameservers) expect(ns).toMatch(/\.ns\.cloudflare\.com$/);
    expect(result.import).toEqual({ status: 'done', reason: null, copied: 5, failed: [], skipped: [] });
    expect(result.nameservers).toEqual({
      status: 'done',
      reason: null,
      nameservers,
      providerRef: expect.any(String),
      message: 'Name servers changed',
      error: null,
    });

    // The copy is DNS only, with the registrar's values.
    const copied = json<DnsRecord[]>(await hanna.get(`/domains/${zone.id}/dns`));
    const key = (r: DnsRecord) => `${r.type} ${r.name} ${r.data}`;
    expect(copied.map((r) => [key(r), r.ttl, r.proxied]).sort()).toEqual(
      source.map((r) => [key(r), r.ttl, false]).sort(),
    );
    expect(registrarInfo('baeckerei-huber.ch').nameservers).toEqual(nameservers);

    // The registrar now delegates to the zone: Cloudflare activates it.
    const detail = json<DomainDetailDto>(await hanna.get(`/domains/${zone.id}`));
    expect(detail).toMatchObject({
      kind: 'zone',
      status: 'active',
      info: { zone: { status: 'active' }, providerDns: true },
      registration: { id: domainId, nameservers },
    });
    const list = json<DomainDto[]>(await hanna.get(`/orgs/${orgIds.huber}/domains`));
    expect(list.map((d) => [d.name, d.kind])).toEqual(
      expect.arrayContaining([
        ['baeckerei-huber.ch', 'registration'],
        ['baeckerei-huber.ch', 'zone'],
      ]),
    );

    const [created] = await auditEntries('domain.zone_create', zone.id);
    expect(created).toMatchObject({ status: 'success', orgId: orgIds.huber });
    expect(created!.details).toEqual({
      name: 'baeckerei-huber.ch',
      providerId: cloudflare.id,
      providerName: 'Demo Cloudflare',
      sourceDomainId: domainId,
      zoneExternalId: zone.externalId,
      created: true,
    });
    const [imported] = await auditEntries('domain.dns_import', zone.id);
    expect(imported).toMatchObject({ status: 'success', orgId: orgIds.huber });
    expect(imported!.details).toMatchObject({ sourceDomainId: domainId, copied: 5, failed: [], skipped: [] });
    const [switched] = await auditEntries('domain.nameservers_update', domainId);
    expect(switched).toMatchObject({ status: 'success' });
    expect(switched!.details).toEqual({
      domain: 'baeckerei-huber.ch',
      before: DEMO_NS,
      after: nameservers,
      reason: 'dns_move',
      zoneId: zone.id,
    });
    const [summary] = await auditEntries('domain.dns_move', domainId);
    expect(summary).toMatchObject({ status: 'success', orgId: orgIds.huber });
    expect(summary!.details).toMatchObject({
      zoneId: zone.id,
      zoneCreated: true,
      import: 'done',
      nameservers: 'done',
    });
  });

  it('keeps the name servers after a partial copy and reuses the zone on a retry', async () => {
    const domainId = await id(registrar, 'alpenblick-hotel.ch');
    const spy = vi
      .spyOn(DemoCloudflareAdapter.prototype, 'addDnsRecord')
      .mockRejectedValueOnce(new ProviderError('Demo Cloudflare', 'record quota exceeded', 400));
    let first: DnsMoveResult;
    try {
      const res = await move(admin, domainId, { setNameservers: true });
      expect(res.statusCode, res.body).toBe(200);
      first = json<DnsMoveResult>(res);
    } finally {
      spy.mockRestore();
    }
    expect(first.zoneCreated).toBe(true);
    expect(first.zone.org).toBeNull();
    expect(first.import).toMatchObject({
      status: 'partial',
      reason: null,
      copied: 6,
      failed: [{ type: 'A', name: '@', error: expect.stringContaining('record quota exceeded') }],
    });
    expect(first.import.skipped.map((s) => [s.type, s.reason])).toEqual([
      ['HTTP_REDIRECT', 'type'],
      ['MAILFW', 'type'],
    ]);
    expect(first.nameservers).toMatchObject({
      status: 'skipped',
      reason: 'importIncomplete',
      nameservers: first.zone.nameservers,
      providerRef: null,
    });
    expect(registrarInfo('alpenblick-hotel.ch').nameservers).toEqual(DEMO_NS);
    const zoneId = first.zone.id;
    const [imported] = await auditEntries('domain.dns_import', zoneId);
    expect(imported).toMatchObject({ status: 'failure' });
    expect(imported!.details).toMatchObject({
      copied: 6,
      failed: [{ type: 'A', name: '@' }],
      skipped: [
        { type: 'HTTP_REDIRECT', name: 'buchen', reason: 'type' },
        { type: 'MAILFW', name: 'info', reason: 'type' },
      ],
    });
    expect((await auditEntries('domain.dns_move', domainId)).map((e) => e.status)).toEqual(['failure']);
    expect(await auditEntries('domain.nameservers_update', domainId)).toHaveLength(0);

    // A retry never copies twice into a zone that has records.
    const again = json<DnsMoveResult>(await move(admin, domainId, { setNameservers: true }));
    expect(again).toMatchObject({
      zoneCreated: false,
      zone: { id: zoneId },
      import: { status: 'skipped', reason: 'zoneNotEmpty', copied: 0 },
      nameservers: { status: 'skipped', reason: 'importIncomplete' },
    });
    expect(json<DnsRecord[]>(await admin.get(`/domains/${zoneId}/dns`))).toHaveLength(6);
    expect((await auditEntries('domain.zone_create', zoneId)).map((e) => e.details?.created)).toEqual([
      true,
      false,
    ]);
    expect(await auditEntries('domain.dns_import', zoneId)).toHaveLength(1);
  });

  it('copies nothing from a registrar that does not serve the zone', async () => {
    const domainId = await id(registrar, 'muster-shop.ch');
    const zoneId = await id(cloudflare, 'muster-shop.ch');
    const plain = json<DnsMoveResult>(await move(admin, domainId));
    expect(plain).toMatchObject({
      zoneCreated: false,
      zone: { id: zoneId, status: 'active' },
      import: { status: 'skipped', reason: 'registrarNotServing' },
      nameservers: { status: 'skipped', reason: 'notRequested', nameservers: ZONE_NS },
    });
    const withNs = json<DnsMoveResult>(await move(admin, domainId, { setNameservers: true }));
    expect(withNs.nameservers).toMatchObject({ status: 'skipped', reason: 'importIncomplete' });
    expect(registrarInfo('muster-shop.ch').nameservers).toEqual(ZONE_NS);
    expect(await auditEntries('domain.dns_import', zoneId)).toHaveLength(0);
    expect((await auditEntries('domain.dns_move', domainId)).map((e) => e.status)).toEqual([
      'failure',
      'failure',
    ]);
  });

  it('ends without a zone when the provider refuses to create it', async () => {
    const domainId = await id(registrar, 'muster-ag.ch');
    const spy = vi
      .spyOn(DemoCloudflareAdapter.prototype, 'createZone')
      .mockRejectedValueOnce(new ProviderError('Demo Cloudflare', 'zone limit reached', 400));
    try {
      const res = await move(admin, domainId, { setNameservers: true });
      expect(res.statusCode).toBe(502);
      expect(json(res).error.message).toMatch(/zone limit reached/);
    } finally {
      spy.mockRestore();
    }
    expect(await row(cloudflare, 'muster-ag.ch')).toBeUndefined();
    const [failure] = await auditEntries('domain.zone_create', domainId);
    expect(failure).toMatchObject({ status: 'failure', orgId: orgIds.muster });
    expect(failure!.details).toMatchObject({
      name: 'muster-ag.ch',
      created: false,
      zoneExternalId: null,
      error: expect.stringContaining('zone limit reached'),
    });
    expect(await auditEntries('domain.dns_move', domainId)).toHaveLength(0);
    expect(registrarInfo('muster-ag.ch').nameservers).toEqual(DEMO_NS);
  });

  it('runs one move of a domain at a time', async () => {
    const domainId = await id(registrar, 'muster-ag.ch');
    const original = DemoCloudflareAdapter.prototype.createZone;
    const spy = vi.spyOn(DemoCloudflareAdapter.prototype, 'createZone').mockImplementation(async function (
      this: DemoCloudflareAdapter,
      name: string,
    ) {
      await new Promise((r) => setTimeout(r, 150));
      return original.call(this, name);
    });
    try {
      const results = await Promise.all([
        move(admin, domainId, { importRecords: false }),
        move(admin, domainId, { importRecords: false }),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      const refused = results.find((r) => r.statusCode === 409)!;
      expect(json(refused).error.message).toMatch(/running/);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
    const zone = (await row(cloudflare, 'muster-ag.ch'))!;
    expect(zone).toMatchObject({ orgId: orgIds.muster, status: 'pending' });
    expect(json<DnsRecord[]>(await admin.get(`/domains/${zone.id}/dns`))).toEqual([]);
  });

  it('lists the name servers to set by hand when the registrar cannot switch them', async () => {
    const domainId = await id(registrar, 'muster-ag.ch');
    const zone = (await row(cloudflare, 'muster-ag.ch'))!;
    const spy = vi.spyOn(DemoAdapter.prototype, 'domainCapabilities').mockReturnValue(['dns', 'dnsTtl']);
    try {
      const preview = json<DnsMovePreview>(await admin.get(`/admin/domains/${domainId}/dns-move`));
      expect(preview).toMatchObject({ canSetNameservers: false, existingZone: { id: zone.id } });
      // The DynDNS record is read only at the registrar.
      expect(preview.skipped.map((s) => [s.type, s.reason])).toEqual([['DYNA', 'readOnly']]);
      const result = json<DnsMoveResult>(await move(admin, domainId, { setNameservers: true }));
      expect(result).toMatchObject({
        zoneCreated: false,
        import: { status: 'done', copied: 9 },
        nameservers: { status: 'manual', reason: 'unsupported', nameservers: zone.info!.nameservers },
      });
    } finally {
      spy.mockRestore();
    }
    expect(registrarInfo('muster-ag.ch').nameservers).toEqual(DEMO_NS);
    const summaries = await auditEntries('domain.dns_move', domainId);
    expect(summaries.map((e) => [e.status, e.details?.import, e.details?.nameservers])).toEqual([
      ['success', 'skipped', 'skipped'],
      ['failure', 'done', 'manual'],
    ]);
  });

  it('reports a name server change the registrar refuses', async () => {
    const domainId = await id(registrar, 'muster-ag.ch');
    const zone = (await row(cloudflare, 'muster-ag.ch'))!;
    const registrationNs = registrarInfo('muster-ag.ch').nameservers;
    // Emptied by hand, so the copy runs again.
    const adapter: ProviderAdapter = t.ctx.providers.forConnection(cloudflare);
    for (const record of await adapter.listDnsRecords!(zone.externalId)) {
      await adapter.deleteDnsRecord!(zone.externalId, record.id);
    }
    const spy = vi
      .spyOn(DemoAdapter.prototype, 'setNameservers')
      .mockRejectedValueOnce(new ProviderError('Demo', 'registry timeout', 504));
    try {
      const result = json<DnsMoveResult>(await move(admin, domainId, { setNameservers: true }));
      expect(result).toMatchObject({
        import: { status: 'done' },
        nameservers: { status: 'failed', reason: null, error: expect.stringContaining('registry timeout') },
      });
    } finally {
      spy.mockRestore();
    }
    expect(registrarInfo('muster-ag.ch').nameservers).toEqual(registrationNs);
    const [failure] = (await auditEntries('domain.nameservers_update', domainId)).filter(
      (e) => e.status === 'failure',
    );
    expect(failure!.details).toMatchObject({
      reason: 'dns_move',
      zoneId: zone.id,
      error: expect.stringContaining('registry timeout'),
    });
    expect((await auditEntries('domain.dns_move', domainId)).at(-1)).toMatchObject({ status: 'failure' });
  });
});

describe('resellers', () => {
  it('hands a zone to a customer through the resource route', async () => {
    const zoneId = await id(cloudflare, 'alt-muster.ch');
    await assign(zoneId, orgIds.alpen);
    const res = await reto.post(`/orgs/${orgIds.alpen}/customers/${orgIds.huber}/resources`, {
      type: 'domain',
      id: zoneId,
    });
    expect(res.statusCode, res.body).toBe(200);
    const list = json<DomainDto[]>(await hanna.get(`/orgs/${orgIds.huber}/domains`));
    expect(list.find((d) => d.id === zoneId)).toMatchObject({
      name: 'alt-muster.ch',
      kind: 'zone',
      status: 'moved',
    });
    const [entry] = await auditEntries('reseller.resource_assign', zoneId);
    expect(entry!.details).toMatchObject({ customerId: orgIds.huber, previousOrgId: orgIds.alpen });
  });
});
