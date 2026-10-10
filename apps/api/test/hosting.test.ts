import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  DEFAULT_CUSTOMER_BOUNDARY,
  DEFAULT_RESELLER_BOUNDARY,
  DNS_RECORD_TYPES,
  REGISTRAR_CAPABILITIES,
  type DnsRecord,
  type DomainDetailDto,
  type DomainDto,
  type ModuleKey,
  type WebspaceCredentials,
  type WebspaceDetailDto,
  type WebspaceDto,
} from '@weblion/shared';
import {
  auditLogs,
  domains,
  memberships,
  organizations,
  providerConnections,
  users,
  webspaces,
} from '../src/db/schema';
import { hashPassword } from '../src/lib/crypto';
import { PENDING_TTL_MS } from '../src/modules/hosting/pending';
import { DemoAdapter } from '../src/providers/demo/adapter';
import { demoHostingState } from '../src/providers/demo/hosting';
import type { RemoteDomain } from '../src/providers/types';
import { ADMIN, Client, createTestApp, DEMO_PASSWORD, json, type TestApp } from './helpers';
import { startMockServer } from './mock-server';

let t: TestApp;
let admin: Client;
let anna: Client;
let carla: Client;
let dev: Client;
let musterOrgId: string;
let beispielOrgId: string;
let musterDomains: DomainDto[];
let musterWebspace: WebspaceDto;

const domainId = (name: string) => musterDomains.find((d) => d.name === name)!.id;

async function setModules(orgId: string, modules: ModuleKey[]) {
  await t.db.update(organizations).set({ modules }).where(eq(organizations.id, orgId));
}

async function auditEntries(action: string, resourceId: string) {
  return t.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, action), eq(auditLogs.resourceId, resourceId)));
}

async function demoConnection() {
  const demo = await t.db.query.providerConnections.findFirst({
    where: eq(providerConnections.type, 'demo'),
  });
  return demo!;
}

async function storedDomain(externalId: string) {
  const row = await t.db.query.domains.findFirst({ where: eq(domains.externalId, externalId) });
  return row!;
}

/** Signs in a new user, optionally with a platform role or as member of an organization. */
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

const put = (client: Client, url: string, body: unknown) => client.request('PUT', url, body);

async function waitFor<T>(fn: () => Promise<T | null | undefined>, timeoutMs = 5000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(async () => {
  t = await createTestApp();
  admin = new Client(t.app);
  await admin.login(ADMIN.email, ADMIN.password);
  const orgs = json<{ id: string; slug: string }[]>(await admin.get('/admin/orgs'));
  musterOrgId = orgs.find((o) => o.slug === 'muster-ag')!.id;
  beispielOrgId = orgs.find((o) => o.slug === 'beispiel-gmbh')!.id;
  anna = new Client(t.app);
  await anna.login('anna@muster.example');
  carla = new Client(t.app);
  await carla.login('carla@muster.example');
  dev = new Client(t.app);
  await dev.login('dev@beispiel.example');
  musterDomains = json(await anna.get(`/orgs/${musterOrgId}/domains`));
  musterWebspace = json<WebspaceDto[]>(await anna.get(`/orgs/${musterOrgId}/webspaces`))[0]!;
});

afterAll(async () => {
  await t?.close();
});

describe('sync', () => {
  it('stores domains and web spaces from the provider without secrets', async () => {
    const all = json<DomainDto[]>(await admin.get('/admin/domains'));
    expect(all.map((d) => d.name).sort()).toEqual([
      'alpenblick-hotel.ch',
      'baeckerei-huber.ch',
      'muster-ag.ch',
      'muster-shop.ch',
    ]);
    expect(json<WebspaceDto[]>(await admin.get('/admin/webspaces'))).toHaveLength(3);

    const demo = await t.db.query.providerConnections.findFirst({
      where: eq(providerConnections.type, 'demo'),
    });
    const res = await admin.post(`/admin/providers/${demo!.id}/sync`);
    expect(json(res)).toMatchObject({ domains: { seen: 4, missing: 0 }, webspaces: { seen: 3, missing: 0 } });

    const state = demoHostingState(demo!.id);
    const stored = JSON.stringify([await t.db.select().from(domains), await t.db.select().from(webspaces)]);
    for (const d of state.domains.values()) expect(stored).not.toContain(d.authcode);
    for (const w of state.webspaces.values()) expect(stored).not.toContain(w.password);
  });

  it('marks vanished domains as missing and keeps their organization', async () => {
    const demo = await t.db.query.providerConnections.findFirst({
      where: eq(providerConnections.type, 'demo'),
    });
    const state = demoHostingState(demo!.id);
    const removed = state.domains.get('demo-dom-2')!;
    state.domains.delete('demo-dom-2');
    try {
      const result = json(await admin.post(`/admin/providers/${demo!.id}/sync`));
      expect(result.domains).toEqual({ seen: 3, missing: 1 });
      const row = await t.db.query.domains.findFirst({ where: eq(domains.externalId, 'demo-dom-2') });
      expect(row!.missingSince).not.toBeNull();
      expect(row!.orgId).toBe(musterOrgId);
    } finally {
      state.domains.set('demo-dom-2', removed);
    }
    await admin.post(`/admin/providers/${demo!.id}/sync`);
    const row = await t.db.query.domains.findFirst({ where: eq(domains.externalId, 'demo-dom-2') });
    expect(row!.missingSince).toBeNull();
    expect(row!.orgId).toBe(musterOrgId);
  });

  it('keeps stored facts a partial domain list does not report', async () => {
    const demo = await demoConnection();
    const state = demoHostingState(demo.id);
    const expiresAt = '2031-01-15T00:00:00.000Z';
    // Like Joker's domain list: expiry and a few flags, no name servers, handle or status.
    const partial = (): RemoteDomain[] => [
      ...[...state.domains.values()].map((d) => ({
        externalId: d.externalId,
        name: d.info.name,
        status: null,
        info: { name: d.info.name, expiresAt, autoRenew: null, nameservers: undefined },
      })),
      {
        externalId: 'partial-new.ch',
        name: 'partial-new.ch',
        status: 'production',
        info: { expiresAt, locked: true },
      },
    ];
    const spy = vi.spyOn(DemoAdapter.prototype, 'listDomains').mockImplementation(async () => partial());
    try {
      const result = json(await admin.post(`/admin/providers/${demo.id}/sync`));
      expect(result.domains).toEqual({ seen: 5, missing: 0 });
      const known = await storedDomain('demo-dom-1');
      expect(known.status).toBe('OK');
      expect(known.info).toMatchObject({
        name: 'muster-ag.ch',
        status: 'OK',
        nameservers: ['ns1.fireapi.de', 'ns2.fireapi.de'],
        handle: 'WLDEMO1',
        autoRenew: true,
        locked: true,
        providerDns: true,
        registrant: { organization: 'Muster AG' },
        expiresAt,
      });
      // Seen for the first time: the gaps are filled with "unknown".
      expect((await storedDomain('partial-new.ch')).info).toEqual({
        name: 'partial-new.ch',
        status: 'production',
        terminated: false,
        nameservers: [],
        handle: null,
        createdAt: null,
        expiresAt,
        autoRenew: null,
        locked: true,
      });
    } finally {
      spy.mockRestore();
      await t.db.delete(domains).where(eq(domains.externalId, 'partial-new.ch'));
    }
    // A complete list overwrites again.
    await admin.post(`/admin/providers/${demo.id}/sync`);
    expect((await storedDomain('demo-dom-1')).info!.expiresAt).toBe(
      state.domains.get('demo-dom-1')!.info.expiresAt,
    );
  });
});

describe('seed', () => {
  it('gives Muster AG two domains and a web space and leaves the rest unassigned', async () => {
    expect(musterDomains.map((d) => d.name).sort()).toEqual(['muster-ag.ch', 'muster-shop.ch']);
    expect(musterWebspace.name).toBe('Plesk-Medium (musterag)');
    const org = await t.db.query.organizations.findFirst({ where: eq(organizations.id, musterOrgId) });
    expect(org!.modules).toEqual(expect.arrayContaining(['dns', 'webhosting']));
    expect(json<DomainDto[]>(await admin.get('/admin/domains?assigned=false')).length).toBeGreaterThan(0);
    expect(json<WebspaceDto[]>(await admin.get('/admin/webspaces?assigned=false')).length).toBeGreaterThan(0);
  });
});

describe('visibility', () => {
  it('lists the organization’s domains and web spaces with the caller’s permissions', async () => {
    const domain = musterDomains.find((d) => d.name === 'muster-ag.ch')!;
    expect(domain).toMatchObject({
      org: { id: musterOrgId, slug: 'muster-ag' },
      provider: { type: 'demo' },
      autoRenew: true,
      missingSince: null,
    });
    expect(domain.permissions).toEqual([
      'domain:read',
      'domain:dns:write',
      'domain:authcode',
      'domain:manage',
    ]);
    expect(musterWebspace.permissions).toEqual(['webspace:read', 'webspace:credentials']);
    expect(musterWebspace.resources?.emails).toBe(25);

    const viewer = json<DomainDto[]>(await carla.get(`/orgs/${musterOrgId}/domains`));
    expect(viewer[0]!.permissions).toEqual(['domain:read']);
  });

  it('hides domains and web spaces of other organizations', async () => {
    const id = domainId('muster-ag.ch');
    expect((await dev.get(`/orgs/${musterOrgId}/domains`)).statusCode).toBe(404);
    expect((await dev.get(`/orgs/${musterOrgId}/webspaces`)).statusCode).toBe(404);
    expect((await dev.get(`/domains/${id}`)).statusCode).toBe(404);
    expect((await dev.get(`/domains/${id}/dns`)).statusCode).toBe(404);
    expect(
      (await dev.post(`/domains/${id}/dns`, { type: 'A', name: 'x', data: '192.0.2.1' })).statusCode,
    ).toBe(404);
    expect((await dev.get(`/domains/${id}/authcode`)).statusCode).toBe(404);
    expect((await dev.get(`/webspaces/${musterWebspace.id}`)).statusCode).toBe(404);
    expect((await dev.get(`/webspaces/${musterWebspace.id}/credentials`)).statusCode).toBe(404);
    expect((await dev.get(`/domains/00000000-0000-4000-8000-000000000000`)).statusCode).toBe(404);
  });

  it('shows nothing to members without domain permissions', async () => {
    const ben = new Client(t.app);
    await ben.login('ben@muster.example');
    expect(json(await ben.get(`/orgs/${musterOrgId}/domains`))).toEqual([]);
    expect((await ben.get(`/domains/${domainId('muster-ag.ch')}`)).statusCode).toBe(404);
  });

  it('serves live details without secrets', async () => {
    const detail = json<DomainDetailDto>(await anna.get(`/domains/${domainId('muster-ag.ch')}`));
    expect(detail).toMatchObject({
      name: 'muster-ag.ch',
      liveError: null,
      dnsWritable: true,
      info: { status: 'OK', nameservers: ['ns1.fireapi.de', 'ns2.fireapi.de'], terminated: false },
    });
    expect(JSON.stringify(detail)).not.toContain('#7q');
    expect(detail.info).not.toHaveProperty('authcode');

    const ws = json<WebspaceDetailDto>(await anna.get(`/webspaces/${musterWebspace.id}`));
    expect(ws).toMatchObject({
      liveError: null,
      info: { username: 'musterag', panelUrl: expect.any(String) },
    });
    expect(JSON.stringify(ws)).not.toContain('Pl3sk');
  });
});

describe('module gating', () => {
  it('hides domains while the dns module is off, also for the owner', async () => {
    await setModules(musterOrgId, ['servers', 'webhosting']);
    try {
      const id = domainId('muster-ag.ch');
      expect(json(await anna.get(`/orgs/${musterOrgId}/domains`))).toEqual([]);
      expect((await anna.get(`/domains/${id}`)).statusCode).toBe(404);
      expect((await anna.get(`/domains/${id}/dns`)).statusCode).toBe(404);
      expect((await anna.get(`/domains/${id}/authcode`)).statusCode).toBe(404);
      // The other module stays usable, platform staff still see everything.
      expect(json<unknown[]>(await anna.get(`/orgs/${musterOrgId}/webspaces`))).toHaveLength(1);
      expect((await admin.get(`/domains/${id}`)).statusCode).toBe(200);
    } finally {
      await setModules(musterOrgId, ['servers', 'dns', 'webhosting']);
    }
  });

  it('hides web spaces while the webhosting module is off', async () => {
    await setModules(musterOrgId, ['servers', 'dns']);
    try {
      expect(json(await anna.get(`/orgs/${musterOrgId}/webspaces`))).toEqual([]);
      expect((await anna.get(`/webspaces/${musterWebspace.id}`)).statusCode).toBe(404);
      expect((await anna.get(`/webspaces/${musterWebspace.id}/credentials`)).statusCode).toBe(404);
    } finally {
      await setModules(musterOrgId, ['servers', 'dns', 'webhosting']);
    }
  });
});

describe('DNS records', () => {
  it('adds, edits and deletes records and audits every change', async () => {
    const id = domainId('muster-shop.ch');
    const before = json<DnsRecord[]>(await anna.get(`/domains/${id}/dns`));
    expect(before.some((r) => r.type === 'MX' && r.data === '10 mail.muster-ag.ch')).toBe(true);

    const created = json<DnsRecord>(
      await anna.post(`/domains/${id}/dns`, { type: 'A', name: 'test', data: '192.0.2.10' }),
    );
    expect(created).toMatchObject({ type: 'A', name: 'test', data: '192.0.2.10' });
    expect(created.id).not.toBe('');
    expect(json<DnsRecord[]>(await anna.get(`/domains/${id}/dns`))).toHaveLength(before.length + 1);

    const edited = await anna.patch(`/domains/${id}/dns/${created.id}`, { data: '192.0.2.11' });
    expect(edited.statusCode).toBe(200);
    expect(json<DnsRecord>(edited)).toMatchObject({ id: created.id, data: '192.0.2.11' });
    // Changing the type re-validates the value against the new type.
    expect((await anna.patch(`/domains/${id}/dns/${created.id}`, { type: 'AAAA' })).statusCode).toBe(400);

    expect((await anna.del(`/domains/${id}/dns/${created.id}`)).statusCode).toBe(200);
    expect(json<DnsRecord[]>(await anna.get(`/domains/${id}/dns`))).toHaveLength(before.length);
    expect((await anna.del(`/domains/${id}/dns/${created.id}`)).statusCode).toBe(404);
    expect((await anna.patch(`/domains/${id}/dns/999999`, { data: '192.0.2.1' })).statusCode).toBe(404);

    for (const action of ['domain.dns_add', 'domain.dns_update', 'domain.dns_delete']) {
      const entries = await auditEntries(action, id);
      expect(entries.length, action).toBeGreaterThan(0);
      expect(entries[0]!.orgId).toBe(musterOrgId);
    }
  });

  it('validates values per record type', async () => {
    const id = domainId('muster-shop.ch');
    const add = (body: Record<string, unknown>) => anna.post(`/domains/${id}/dns`, body);
    expect((await add({ type: 'A', name: 'x', data: 'not-an-ip' })).statusCode).toBe(400);
    expect((await add({ type: 'A', name: 'x', data: '2001:db8::1' })).statusCode).toBe(400);
    expect((await add({ type: 'AAAA', name: 'x', data: '192.0.2.1' })).statusCode).toBe(400);
    expect((await add({ type: 'CNAME', name: 'x', data: 'not a host' })).statusCode).toBe(400);
    expect((await add({ type: 'MX', name: '@', data: 'mail.example.ch' })).statusCode).toBe(400);
    expect((await add({ type: 'MX', name: '@', data: '70000 mail.example.ch' })).statusCode).toBe(400);
    expect((await add({ type: 'TXT', name: '@', data: 'x'.repeat(4097) })).statusCode).toBe(400);
    expect((await add({ type: 'TXT', name: '@', data: '' })).statusCode).toBe(400);
    expect((await add({ type: 'TXT', name: 'bad name!', data: 'x' })).statusCode).toBe(400);
    expect((await add({ type: 'BOGUS', name: '@', data: 'x' })).statusCode).toBe(400);
    const invalid = [
      { type: 'SRV', name: '_sip._tls', data: '100 1 443' },
      { type: 'SRV', name: '_sip._tls', data: '100 1 70000 sip.example.ch' },
      { type: 'SRV', name: '_sip._tls', data: '100 1 443 not a host' },
      { type: 'CAA', name: '@', data: '256 issue "letsencrypt.org"' },
      { type: 'CAA', name: '@', data: '0 is-sue "letsencrypt.org"' },
      { type: 'CAA', name: '@', data: '0 issue "letsencrypt.org" extra' },
      { type: 'NAPTR', name: '@', data: '100 10 u E2U+sip !^.*$!sip:info@example.ch! .' },
      { type: 'NAPTR', name: '@', data: '100 10 "u" "E2U+sip" "!^.*$!sip:info@example.ch!"' },
      { type: 'HTTP_REDIRECT', name: 'go', data: 'ftp://files.example.ch' },
      { type: 'HTTP_FRAME', name: 'go', data: 'www.example.ch' },
      { type: 'MAILFW', name: 'info', data: 'not-an-address' },
      { type: 'MAILFW', name: 'info', data: 'info@' },
    ];
    for (const body of invalid) {
      const res = await add(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(json(res).error.details[0]).toMatchObject({
        path: 'data',
        message: expect.stringContaining(body.type),
      });
    }

    const valid = [
      { type: 'AAAA', name: 'v6', data: '2001:db8::1' },
      { type: 'CNAME', name: 'shop', data: 'shops.example.net.' },
      { type: 'MX', name: '@', data: '20 mx2.example.ch' },
      { type: 'TXT', name: '_dmarc', data: 'v=DMARC1; p=none' },
      { type: 'SRV', name: '_sip._tls', data: '100 1 443 sip.example.ch' },
      { type: 'SRV', name: '_imap._tcp', data: '0 0 0 .' },
      { type: 'CAA', name: '@', data: '0 issue "letsencrypt.org"' },
      { type: 'CAA', name: '@', data: '128 iodef mailto:security@example.ch' },
      { type: 'NAPTR', name: '@', data: '100 10 "u" "E2U+sip" "!^.*$!sip:info@example.ch!" .' },
      { type: 'NAPTR', name: '@', data: '100 20 "S" "SIP+D2U" "" _sip._udp.example.ch.' },
      { type: 'HTTP_REDIRECT', name: 'go', data: 'https://www.example.ch/landing?ref=dns' },
      { type: 'HTTP_FRAME', name: 'frame', data: 'http://shop.example.net' },
      { type: 'MAILFW', name: 'info', data: 'info@example.net' },
    ];
    for (const body of valid) {
      const res = await add(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(200);
      await anna.del(`/domains/${id}/dns/${json<DnsRecord>(res).id}`);
    }
  });

  it('needs domain:dns:write', async () => {
    const id = domainId('muster-shop.ch');
    expect((await carla.get(`/domains/${id}/dns`)).statusCode).toBe(200);
    expect(
      (await carla.post(`/domains/${id}/dns`, { type: 'A', name: 'x', data: '192.0.2.1' })).statusCode,
    ).toBe(403);
    const [record] = json<DnsRecord[]>(await carla.get(`/domains/${id}/dns`));
    expect((await carla.del(`/domains/${id}/dns/${record!.id}`)).statusCode).toBe(403);
  });

  it('takes a TTL where the provider has one and keeps it on updates', async () => {
    const id = domainId('muster-shop.ch');
    const add = (body: Record<string, unknown>) => anna.post(`/domains/${id}/dns`, body);
    const created = json<DnsRecord>(await add({ type: 'TXT', name: 'ttl', data: 'one', ttl: 600 }));
    expect(created).toMatchObject({ data: 'one', ttl: 600 });
    const byDefault = json<DnsRecord>(await add({ type: 'TXT', name: 'ttl', data: 'two', ttl: null }));
    expect(byDefault.ttl).toBe(3600);

    const kept = json<DnsRecord>(await anna.patch(`/domains/${id}/dns/${created.id}`, { data: 'uno' }));
    expect(kept).toMatchObject({ data: 'uno', ttl: 600 });
    const changed = json<DnsRecord>(await anna.patch(`/domains/${id}/dns/${created.id}`, { ttl: 900 }));
    expect(changed).toMatchObject({ data: 'uno', ttl: 900 });
    expect((await anna.patch(`/domains/${id}/dns/${created.id}`, { ttl: null })).statusCode).toBe(400);
    const [update] = (await auditEntries('domain.dns_update', id)).filter(
      (e) => e.details?.recordId === created.id && e.details?.ttl === 900,
    );
    expect(update!.details).toMatchObject({ before: { ttl: 600 } });

    for (const ttl of [-1, 1.5, 604_801, '600']) {
      expect((await add({ type: 'TXT', name: 'ttl', data: 'x', ttl })).statusCode, String(ttl)).toBe(400);
    }
    // The demo registrar wants at least 300 s like Joker, except for SRV and NAPTR.
    const short = await add({ type: 'A', name: 'ttl', data: '192.0.2.20', ttl: 60 });
    expect(short.statusCode).toBe(400);
    expect(json(short).error.message).toMatch(/at least 300/);
    const srv = json<DnsRecord>(await add({ type: 'SRV', name: '_x._tcp', data: '0 0 0 .', ttl: 0 }));
    expect(srv.ttl).toBe(0);

    for (const record of [created, byDefault, srv]) {
      expect((await anna.del(`/domains/${id}/dns/${record.id}`)).statusCode).toBe(200);
    }
  });

  it('lists DynDNS records read only: they can be deleted, not changed', async () => {
    const id = domainId('muster-ag.ch');
    const records = json<DnsRecord[]>(await anna.get(`/domains/${id}/dns`));
    const dyn = records.find((r) => r.readOnly)!;
    expect(dyn).toMatchObject({ type: 'DYNA', name: 'home', readOnly: true });
    expect(records.filter((r) => r.readOnly)).toHaveLength(1);

    const patched = await anna.patch(`/domains/${id}/dns/${dyn.id}`, { data: '203.0.113.8' });
    expect(patched.statusCode).toBe(400);
    expect(json(patched).error.message).toMatch(/only deleted/);
    expect(json<DnsRecord[]>(await anna.get(`/domains/${id}/dns`))).toContainEqual(dyn);

    const state = demoHostingState((await demoConnection()).id).domains.get('demo-dom-1')!;
    const original = state.records.find((r) => r.id === dyn.id)!;
    try {
      expect((await anna.del(`/domains/${id}/dns/${dyn.id}`)).statusCode).toBe(200);
      const [entry] = (await auditEntries('domain.dns_delete', id)).filter(
        (e) => e.details?.recordId === dyn.id,
      );
      expect(entry!.details).toMatchObject({ type: 'DYNA', data: '203.0.113.7' });
    } finally {
      if (!state.records.includes(original)) state.records.push(original);
    }
  });
});

describe('domain management', () => {
  let mia: Client;

  beforeAll(async () => {
    mia = await newUser('mia@muster.example', { orgId: musterOrgId, role: 'member' });
  });

  it('reports the provider’s features and the registrar facts', async () => {
    const id = domainId('muster-shop.ch');
    const detail = json<DomainDetailDto>(await anna.get(`/domains/${id}`));
    expect(detail.capabilities).toEqual([...REGISTRAR_CAPABILITIES]);
    expect(detail.dnsRecordTypes).toEqual([...DNS_RECORD_TYPES]);
    expect(detail.info).toMatchObject({
      nameservers: ['ana.ns.cloudflare.com', 'bob.ns.cloudflare.com'],
      locked: true,
      privacy: 'none',
      dnssec: false,
      providerDns: false,
      registrant: { name: 'Anna Muster', organization: 'Muster AG', email: 'it@muster.example' },
    });
    expect(json<DomainDetailDto>(await anna.get(`/domains/${domainId('muster-ag.ch')}`)).info).toMatchObject({
      providerDns: true,
    });
    expect(json<DomainDetailDto>(await mia.get(`/domains/${id}`)).permissions).toEqual([
      'domain:read',
      'domain:dns:write',
    ]);
    const all = json<DomainDto[]>(await admin.get('/admin/domains'));
    for (const row of all) expect(row.capabilities, row.name).toEqual([...REGISTRAR_CAPABILITIES]);
  });

  it('merges live details into the stored info field by field', async () => {
    const id = domainId('muster-ag.ch');
    // A registrar whose detail call knows less than the sync stored (unknown = null).
    const spy = vi.spyOn(DemoAdapter.prototype, 'getDomain').mockImplementation(async () => ({
      name: 'muster-ag.ch',
      status: 'LOCKED',
      terminated: false,
      nameservers: ['ns1.fireapi.de', 'ns2.fireapi.de'],
      handle: null,
      createdAt: null,
      expiresAt: null,
      autoRenew: null,
      locked: null,
      registrant: null,
    }));
    try {
      const detail = json<DomainDetailDto>(await anna.get(`/domains/${id}`));
      expect(detail.status).toBe('LOCKED');
      const kept = {
        status: 'LOCKED',
        handle: 'WLDEMO1',
        createdAt: '2019-04-02T09:30:00.000Z',
        expiresAt: expect.any(String),
        autoRenew: true,
        locked: true,
        registrant: { organization: 'Muster AG' },
      };
      expect(detail.info).toMatchObject(kept);
      expect((await storedDomain('demo-dom-1')).info).toMatchObject(kept);
    } finally {
      spy.mockRestore();
    }
    expect(json<DomainDetailDto>(await anna.get(`/domains/${id}`)).status).toBe('OK');
  });

  it('changes name servers for owners and audits it', async () => {
    const id = domainId('muster-shop.ch');
    const original = ['ana.ns.cloudflare.com', 'bob.ns.cloudflare.com'];
    const res = await put(anna, `/domains/${id}/nameservers`, {
      nameservers: [' NS1.FireAPI.de. ', 'ns2.fireapi.de'],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res)).toEqual({ ok: true, message: 'Name servers changed', providerRef: expect.any(String) });

    const detail = json<DomainDetailDto>(await anna.get(`/domains/${id}`));
    expect(detail.info).toMatchObject({
      nameservers: ['ns1.fireapi.de', 'ns2.fireapi.de'],
      providerDns: true,
    });
    const [entry] = await auditEntries('domain.nameservers_update', id);
    expect(entry).toMatchObject({ orgId: musterOrgId, status: 'success' });
    expect(entry!.details).toMatchObject({
      domain: 'muster-shop.ch',
      before: original,
      after: ['ns1.fireapi.de', 'ns2.fireapi.de'],
    });

    // API tokens may do it too, it is a customer action.
    const { token } = json(
      await anna.post(`/orgs/${musterOrgId}/tokens`, { name: 'ns-bot', scope: 'read_write' }),
    );
    const bot = new Client(t.app);
    bot.bearer = token;
    expect((await put(bot, `/domains/${id}/nameservers`, { nameservers: original })).statusCode).toBe(200);
    expect(json<DomainDetailDto>(await anna.get(`/domains/${id}`)).info).toMatchObject({
      nameservers: original,
      providerDns: false,
    });
  });

  it('validates name servers', async () => {
    const id = domainId('muster-shop.ch');
    const cases: [unknown, string][] = [
      [{ nameservers: ['ns1.example.net'] }, 'nameservers'],
      [{ nameservers: Array.from({ length: 14 }, (_, i) => `ns${i}.example.net`) }, 'nameservers'],
      [{ nameservers: ['ns1.example.net', 'NS1.example.net.'] }, 'nameservers.1'],
      [{ nameservers: ['ns1.example.net', 'not a host'] }, 'nameservers.1'],
      [{ nameservers: ['ns1.example.net', 'localhost'] }, 'nameservers.1'],
      [{ nameservers: 'ns1.example.net' }, 'nameservers'],
      [{}, 'nameservers'],
    ];
    for (const [body, path] of cases) {
      const res = await put(anna, `/domains/${id}/nameservers`, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(json(res).error.details[0].path, JSON.stringify(body)).toBe(path);
    }
    expect(await auditEntries('domain.nameservers_update', id)).toHaveLength(2);
  });

  it('switches the transfer lock and shows it right away', async () => {
    const id = domainId('muster-ag.ch');
    const res = await put(anna, `/domains/${id}/lock`, { locked: false });
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res)).toEqual({
      ok: true,
      message: 'Transfer lock disabled',
      providerRef: expect.any(String),
    });
    expect((await storedDomain('demo-dom-1')).info!.locked).toBe(false);
    const [unlock] = await auditEntries('domain.unlock', id);
    expect(unlock!.details).toMatchObject({ domain: 'muster-ag.ch', before: true, after: false });

    expect((await put(anna, `/domains/${id}/lock`, { locked: true })).statusCode).toBe(200);
    expect((await storedDomain('demo-dom-1')).info!.locked).toBe(true);
    expect(await auditEntries('domain.lock', id)).toHaveLength(1);

    for (const body of [{}, { locked: 'yes' }, { locked: null }]) {
      expect((await put(anna, `/domains/${id}/lock`, body)).statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it('keeps members, viewers and other organizations out', async () => {
    const id = domainId('muster-ag.ch');
    const nameservers = { nameservers: ['ns1.example.net', 'ns2.example.net'] };
    for (const client of [mia, carla]) {
      expect((await put(client, `/domains/${id}/nameservers`, nameservers)).statusCode).toBe(403);
      expect((await put(client, `/domains/${id}/lock`, { locked: false })).statusCode).toBe(403);
    }
    expect((await put(dev, `/domains/${id}/nameservers`, nameservers)).statusCode).toBe(404);
    expect((await put(dev, `/domains/${id}/lock`, { locked: false })).statusCode).toBe(404);
    // A member still edits DNS records.
    const created = await mia.post(`/domains/${id}/dns`, { type: 'TXT', name: 'mia', data: 'hello' });
    expect(created.statusCode).toBe(200);
    expect((await mia.del(`/domains/${id}/dns/${json<DnsRecord>(created).id}`)).statusCode).toBe(200);
    expect((await storedDomain('demo-dom-1')).info!.locked).toBe(true);
  });

  it('audits changes the provider refuses', async () => {
    const id = domainId('muster-ag.ch');
    const state = demoHostingState((await demoConnection()).id);
    const removed = state.domains.get('demo-dom-1')!;
    state.domains.delete('demo-dom-1');
    try {
      const res = await put(anna, `/domains/${id}/lock`, { locked: false });
      expect(res.statusCode).toBe(404);
      const [failure] = (await auditEntries('domain.unlock', id)).filter((e) => e.status === 'failure');
      expect(failure!.details).toMatchObject({ error: 'Demo domain not found' });
      expect((await storedDomain('demo-dom-1')).info!.locked).toBe(true);
    } finally {
      state.domains.set('demo-dom-1', removed);
    }
  });

  it('keeps a change the registrar applies later until the registrar reports it', async () => {
    const id = domainId('muster-shop.ch');
    const demo = await demoConnection();
    const { externalId } = (await t.db.query.domains.findFirst({ where: eq(domains.id, id) }))!;
    const registrar = demoHostingState(demo.id).domains.get(externalId)!.info;
    const shown = async () => json<DomainDetailDto>(await anna.get(`/domains/${id}`)).info!;
    const stored = () => storedDomain(externalId);
    expect(registrar).toMatchObject({ locked: true, autoRenew: true });
    // Like Joker: the jobs are accepted, whois and domain list keep the old state for a while.
    const lock = vi
      .spyOn(DemoAdapter.prototype, 'setDomainLock')
      .mockResolvedValue({ providerRef: '9001', message: 'Transfer unlock requested' });
    const autoRenew = vi
      .spyOn(DemoAdapter.prototype, 'setDomainAutoRenew')
      .mockResolvedValue({ providerRef: '9002', message: 'Auto-renew disabled' });
    try {
      expect((await put(anna, `/domains/${id}/lock`, { locked: false })).statusCode).toBe(200);
      expect((await admin.post(`/admin/domains/${id}/auto-renew`, { enabled: false })).statusCode).toBe(200);
      // The UI reloads the details right away, and a sync may run before the registrar is done.
      expect(await shown()).toMatchObject({ locked: false, autoRenew: false });
      await admin.post(`/admin/providers/${demo.id}/sync`);
      expect((await stored()).info).toMatchObject({ locked: false, autoRenew: false });
      expect(await shown()).toMatchObject({ locked: false, autoRenew: false });

      // Done at the registrar: settled, from then on its state counts.
      registrar.locked = false;
      expect(await shown()).toMatchObject({ locked: false, autoRenew: false });
      expect((await stored()).meta.pending).toEqual({ autoRenew: { value: false, at: expect.any(String) } });
      registrar.autoRenew = false;
      await admin.post(`/admin/providers/${demo.id}/sync`);
      expect((await stored()).meta).not.toHaveProperty('pending');
      registrar.locked = true;
      registrar.autoRenew = true;
      expect(await shown()).toMatchObject({ locked: true, autoRenew: true });

      // A job that never goes through: after PENDING_TTL_MS the registrar's state counts again.
      expect((await put(anna, `/domains/${id}/lock`, { locked: false })).statusCode).toBe(200);
      expect((await shown()).locked).toBe(false);
      const row = await stored();
      const expired = new Date(Date.now() - PENDING_TTL_MS - 1000).toISOString();
      await t.db
        .update(domains)
        .set({ meta: { ...row.meta, pending: { locked: { value: false, at: expired } } } })
        .where(eq(domains.id, id));
      expect((await shown()).locked).toBe(true);
      expect((await stored()).meta).not.toHaveProperty('pending');
    } finally {
      lock.mockRestore();
      autoRenew.mockRestore();
      Object.assign(registrar, { locked: true, autoRenew: true });
    }
  });
});

describe('renewals', () => {
  let support: Client;

  beforeAll(async () => {
    support = await newUser('support@weblion.test', { platformRole: 'support' });
  });

  it('lets platform staff with platform:domain:write switch auto-renew', async () => {
    const id = domainId('muster-ag.ch');
    const res = await admin.post(`/admin/domains/${id}/auto-renew`, { enabled: false });
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res)).toEqual({ ok: true, message: 'Auto-renew disabled', providerRef: expect.any(String) });
    expect((await storedDomain('demo-dom-1')).info!.autoRenew).toBe(false);
    expect(
      json<DomainDto[]>(await anna.get(`/orgs/${musterOrgId}/domains`)).find((d) => d.id === id)!.autoRenew,
    ).toBe(false);
    const [entry] = await auditEntries('domain.auto_renew', id);
    expect(entry).toMatchObject({ orgId: musterOrgId, status: 'success' });
    expect(entry!.details).toMatchObject({ domain: 'muster-ag.ch', enabled: false, before: true });

    expect((await admin.post(`/admin/domains/${id}/auto-renew`, { enabled: true })).statusCode).toBe(200);
    expect((await storedDomain('demo-dom-1')).info!.autoRenew).toBe(true);
    for (const body of [{}, { enabled: 'no' }]) {
      expect((await admin.post(`/admin/domains/${id}/auto-renew`, body)).statusCode).toBe(400);
    }
  });

  it('renews by whole years and audits the expiry before', async () => {
    const id = domainId('muster-ag.ch');
    const before = (await storedDomain('demo-dom-1')).info!.expiresAt!;
    for (const years of [0, 11, 1.5, '2', null]) {
      const res = await admin.post(`/admin/domains/${id}/renew`, { years });
      expect(res.statusCode, String(years)).toBe(400);
    }
    const res = await admin.post(`/admin/domains/${id}/renew`, { years: 2 });
    expect(res.statusCode, res.body).toBe(200);
    const expected = new Date(before);
    expected.setUTCFullYear(expected.getUTCFullYear() + 2);
    expect(json(res)).toEqual({
      ok: true,
      message: `Renewed until ${expected.toISOString().slice(0, 10)}`,
      providerRef: expect.any(String),
    });
    // The stored expiry follows right away.
    expect((await storedDomain('demo-dom-1')).info!.expiresAt).toBe(expected.toISOString());
    const entries = await auditEntries('domain.renew', id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.details).toMatchObject({ domain: 'muster-ag.ch', years: 2, expiresAtBefore: before });
  });

  it('keeps support staff, customers and API tokens out', async () => {
    const id = domainId('muster-ag.ch');
    const calls = (client: Client) => [
      client.post(`/admin/domains/${id}/auto-renew`, { enabled: false }),
      client.post(`/admin/domains/${id}/renew`, { years: 1 }),
    ];
    for (const client of [support, anna]) {
      for (const res of await Promise.all(calls(client))) expect(res.statusCode).toBe(403);
    }
    // Even a token with every organization permission: renewals need an interactive login.
    const { token } = json(
      await anna.post(`/orgs/${musterOrgId}/tokens`, { name: 'renew-bot', scope: 'read_write' }),
    );
    const bot = new Client(t.app);
    bot.bearer = token;
    for (const res of await Promise.all(calls(bot))) {
      expect(res.statusCode).toBe(403);
      expect(json(res).error.message).toMatch(/interactive login/);
    }
    expect(await auditEntries('domain.renew', id)).toHaveLength(1);
    expect((await storedDomain('demo-dom-1')).info!.autoRenew).toBe(true);
    expect(
      (await admin.post('/admin/domains/00000000-0000-4000-8000-000000000000/renew', { years: 1 }))
        .statusCode,
    ).toBe(404);
  });

  it('does not renew twice when a request is repeated with the expiry seen before', async () => {
    const id = domainId('muster-shop.ch');
    const expiry = async () =>
      (await t.db.query.domains.findFirst({ where: eq(domains.id, id) }))!.info!.expiresAt;
    const seen = (await expiry())!;
    const first = await admin.post(`/admin/domains/${id}/renew`, { years: 1, expiresAt: seen });
    expect(first.statusCode, first.body).toBe(200);
    const renewed = await expiry();
    expect(renewed).not.toBe(seen);

    // The answer got lost and the dialog still shows the old expiry: nothing is renewed.
    const again = await admin.post(`/admin/domains/${id}/renew`, { years: 1, expiresAt: seen });
    expect(again.statusCode).toBe(409);
    expect(json(again).error.message).toMatch(/by now/);
    expect(await expiry()).toBe(renewed);
    const entries = await auditEntries('domain.renew', id);
    expect(entries.map((e) => e.status).sort()).toEqual(['failure', 'success']);
    expect(entries.find((e) => e.status === 'failure')!.details).toMatchObject({ expiresAtSeen: seen });

    // Without it the stored expiry counts, which the first renewal already moved on.
    expect((await admin.post(`/admin/domains/${id}/renew`, { years: 1 })).statusCode).toBe(200);
    for (const expiresAt of ['soon', 42]) {
      const res = await admin.post(`/admin/domains/${id}/renew`, { years: 1, expiresAt });
      expect(res.statusCode, String(expiresAt)).toBe(400);
    }
  });
});

describe('secrets', () => {
  it('reveals the auth code to permitted sessions only and audits it', async () => {
    const id = domainId('muster-ag.ch');
    const res = await anna.get(`/domains/${id}/authcode`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const { authcode } = json<{ authcode: string }>(res);
    expect(authcode).toMatch(/#7q$/);

    const entries = await auditEntries('domain.authcode_view', id);
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries)).not.toContain(authcode);

    expect((await carla.get(`/domains/${id}/authcode`)).statusCode).toBe(403);
    const { token } = json(
      await anna.post(`/orgs/${musterOrgId}/tokens`, { name: 'dns-bot', scope: 'read_write' }),
    );
    const bot = new Client(t.app);
    bot.bearer = token;
    expect((await bot.get(`/domains/${id}`)).statusCode).toBe(200);
    expect((await bot.post(`/domains/${id}/dns`, { type: 'TXT', name: 'bot', data: 'ok' })).statusCode).toBe(
      200,
    );
    expect((await bot.get(`/domains/${id}/authcode`)).statusCode).toBe(403);
    expect((await bot.get(`/webspaces/${musterWebspace.id}/credentials`)).statusCode).toBe(403);
    expect(await auditEntries('domain.authcode_view', id)).toHaveLength(1);
  });

  it('reveals web space credentials to permitted sessions only and audits it', async () => {
    const res = await anna.get(`/webspaces/${musterWebspace.id}/credentials`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const credentials = json<WebspaceCredentials>(res);
    expect(credentials).toMatchObject({ username: 'musterag', password: expect.stringContaining('Pl3sk') });

    const entries = await auditEntries('webspace.credentials_view', musterWebspace.id);
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries)).not.toContain(credentials.password!);
    expect((await carla.get(`/webspaces/${musterWebspace.id}/credentials`)).statusCode).toBe(403);
  });
});

describe('admin inventory', () => {
  it('assigns a domain and activates the dns module', async () => {
    const [free] = json<DomainDto[]>(await admin.get('/admin/domains?assigned=false&q=alpenblick'));
    expect(free!.name).toBe('alpenblick-hotel.ch');
    expect(json(await dev.get(`/orgs/${beispielOrgId}/domains`))).toEqual([]);

    const res = await admin.post(`/admin/domains/${free!.id}/assign`, { orgId: beispielOrgId });
    expect(res.statusCode).toBe(200);
    expect(json<DomainDto>(res).org).toMatchObject({ id: beispielOrgId });
    const org = await t.db.query.organizations.findFirst({ where: eq(organizations.id, beispielOrgId) });
    expect(org!.modules).toContain('dns');
    expect(json<DomainDto[]>(await dev.get(`/orgs/${beispielOrgId}/domains`)).map((d) => d.name)).toEqual([
      'alpenblick-hotel.ch',
    ]);
    const [entry] = await auditEntries('domain.assign', free!.id);
    expect(entry!.details).toMatchObject({ orgId: beispielOrgId, moduleEnabled: 'dns' });

    const unassigned = await admin.post(`/admin/domains/${free!.id}/assign`, { orgId: null });
    expect(json<DomainDto>(unassigned).org).toBeNull();
    expect((await dev.get(`/domains/${free!.id}`)).statusCode).toBe(404);
  });

  it('can assign without activating the module', async () => {
    const [free] = json<WebspaceDto[]>(await admin.get('/admin/webspaces?assigned=false'));
    const res = await admin.post(`/admin/webspaces/${free!.id}/assign`, {
      orgId: beispielOrgId,
      enableModule: false,
    });
    expect(res.statusCode).toBe(200);
    const org = await t.db.query.organizations.findFirst({ where: eq(organizations.id, beispielOrgId) });
    expect(org!.modules).not.toContain('webhosting');
    expect(json(await dev.get(`/orgs/${beispielOrgId}/webspaces`))).toEqual([]);
    expect(json<WebspaceDto[]>(await admin.get(`/admin/webspaces?orgId=${beispielOrgId}`))).toHaveLength(1);

    await admin.post(`/admin/webspaces/${free!.id}/assign`, { orgId: beispielOrgId });
    expect(json<WebspaceDto[]>(await dev.get(`/orgs/${beispielOrgId}/webspaces`))).toHaveLength(1);
    await admin.post(`/admin/webspaces/${free!.id}/assign`, { orgId: null });
  });

  it('refuses to activate a module the customer’s reseller does not have', async () => {
    const [reseller] = await t.db
      .insert(organizations)
      .values({
        name: 'Hosting Reseller',
        slug: 'hosting-reseller',
        kind: 'reseller',
        boundary: DEFAULT_RESELLER_BOUNDARY,
        modules: ['servers'],
      })
      .returning();
    const [customer] = await t.db
      .insert(organizations)
      .values({
        name: 'Reseller Kunde',
        slug: 'reseller-kunde',
        kind: 'customer',
        boundary: DEFAULT_CUSTOMER_BOUNDARY,
        parentOrgId: reseller!.id,
        modules: ['servers'],
      })
      .returning();
    const [free] = json<DomainDto[]>(await admin.get('/admin/domains?assigned=false'));

    const refused = await admin.post(`/admin/domains/${free!.id}/assign`, { orgId: customer!.id });
    expect(refused.statusCode).toBe(409);
    expect(json(refused).error.message).toMatch(/Hosting Reseller/);

    const plain = await admin.post(`/admin/domains/${free!.id}/assign`, {
      orgId: customer!.id,
      enableModule: false,
    });
    expect(plain.statusCode).toBe(200);

    await setModules(reseller!.id, ['servers', 'dns']);
    expect((await admin.post(`/admin/domains/${free!.id}/assign`, { orgId: customer!.id })).statusCode).toBe(
      200,
    );
    const updated = await t.db.query.organizations.findFirst({ where: eq(organizations.id, customer!.id) });
    expect(updated!.modules).toEqual(['servers', 'dns']);
    await admin.post(`/admin/domains/${free!.id}/assign`, { orgId: null });
  });

  it('keeps a billed domain or web space with the organization that pays for it', async () => {
    const [domain] = json<DomainDto[]>(await admin.get('/admin/domains?assigned=false&q=alpenblick'));
    const [webspace] = json<WebspaceDto[]>(await admin.get('/admin/webspaces?assigned=false'));
    const assign = (type: 'domains' | 'webspaces', id: string, orgId: string | null) =>
      admin.post(`/admin/${type}/${id}/assign`, { orgId });
    expect((await assign('domains', domain!.id, beispielOrgId)).statusCode).toBe(200);
    expect((await assign('webspaces', webspace!.id, beispielOrgId)).statusCode).toBe(200);
    const bill = async (resourceType: 'domain' | 'webspace', resourceId: string) => {
      const res = await admin.post(`/billing/customers/${beispielOrgId}/services`, {
        name: `Hosting ${resourceType}`,
        unitPrice: 1500,
        interval: 'monthly',
        resourceType,
        resourceId,
      });
      expect(res.statusCode, res.body).toBe(200);
      return json<{ id: string }>(res).id;
    };
    const billed = [await bill('domain', domain!.id), await bill('webspace', webspace!.id)];

    // Neither to another organization nor back to the inventory while Beispiel GmbH pays for it.
    for (const orgId of [musterOrgId, null]) {
      const refused = await assign('domains', domain!.id, orgId);
      expect(refused.statusCode).toBe(409);
      expect(json(refused).error.message).toContain('"Hosting domain"');
      expect((await assign('webspaces', webspace!.id, orgId)).statusCode).toBe(409);
    }
    const [kept] = json<DomainDto[]>(await admin.get('/admin/domains?q=alpenblick'));
    expect(kept!.org).toMatchObject({ id: beispielOrgId });

    for (const id of billed) expect((await admin.post(`/services/${id}/cancel`, {})).statusCode).toBe(200);
    expect((await assign('domains', domain!.id, null)).statusCode).toBe(200);
    expect((await assign('webspaces', webspace!.id, null)).statusCode).toBe(200);
  });

  it('validates input and keeps customers out', async () => {
    const [domain] = json<DomainDto[]>(await admin.get('/admin/domains'));
    expect((await admin.post(`/admin/domains/${domain!.id}/assign`, { orgId: 'nope' })).statusCode).toBe(400);
    expect(
      (
        await admin.post(`/admin/domains/${domain!.id}/assign`, {
          orgId: '00000000-0000-4000-8000-000000000000',
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await admin.post(`/admin/domains/00000000-0000-4000-8000-000000000000/assign`, { orgId: null }))
        .statusCode,
    ).toBe(404);
    expect((await anna.get('/admin/domains')).statusCode).toBe(403);
    expect((await anna.get('/admin/webspaces')).statusCode).toBe(403);
    expect((await anna.post(`/admin/domains/${domain!.id}/assign`, { orgId: musterOrgId })).statusCode).toBe(
      403,
    );
  });
});

describe('server DDoS settings', () => {
  it('accepts only the documented values and the server’s own IPv4 addresses', async () => {
    const [server] = json<{ id: string; ips: { address: string; version: number }[] }[]>(
      await admin.get(`/orgs/${musterOrgId}/servers`),
    );
    const ip = server!.ips.find((i) => i.version === 4)!.address;
    const network = json<{ ddos: { ip: string }[] }>(await admin.get(`/servers/${server!.id}/network`));
    expect(network.ddos.map((d) => d.ip)).toEqual([ip]);

    const set = (body: Record<string, unknown>) => admin.post(`/servers/${server!.id}/ddos`, body);
    expect((await set({ ip, layer4: 'permanent', layer7: 'on' })).statusCode).toBe(200);
    expect((await set({ ip, layer4: 'always' })).statusCode).toBe(400);
    expect((await set({ ip })).statusCode).toBe(400);
    expect((await set({ ip: '203.0.113.9', layer7: 'off' })).statusCode).toBe(400);
  });
});

describe('24fire provider', () => {
  const DOMAIN_ID = 'fire-domain-1';
  const WEBSPACE_ID = 'fire-webspace-1';
  let mock: Awaited<ReturnType<typeof startMockServer>>;
  let providerId: string;

  beforeAll(async () => {
    const ok = (data: unknown) => ({ body: { status: 'success', message: 'ok', data } });
    mock = await startMockServer((req) => {
      if (req.headers['x-fire-apikey'] !== 'fire-test-key') return { status: 401, body: { status: 'error' } };
      switch (req.path) {
        case '/api/account':
          return ok({ id: 7, firstname: 'Test', lastname: 'Account', balance: 12.5, is_plus_user: false });
        case '/api/account/services':
          return ok({
            services: {
              WEBSPACE: [{ internal_id: WEBSPACE_ID, name: 'Plesk-Small', username: 'firetest' }],
              KVM: [],
              DOMAIN: [{ internal_id: DOMAIN_ID, name: 'fire-test.de', accounting: { auto_renew: true } }],
            },
          });
        case `/api/domain/${DOMAIN_ID}`:
          return ok({
            domain: { name: 'fire-test.de', authcode: 'FIRE-AUTH-CODE', status: 'OK', terminated: false },
            nameserver: { ns1: 'ns1.fireapi.de', ns2: 'ns2.fireapi.de' },
            timings: { create: '2023-03-14 15:53:44', expire: '2027-03-14 15:53:44' },
          });
        case `/api/domain/${DOMAIN_ID}/dns`:
          return ok([{ record_id: 1, type: 'A', name: '@', data: '192.0.2.1', ttl: 300 }]);
        case `/api/webspace/${WEBSPACE_ID}`:
          return ok({
            resources: { domains: 1, emails: 3, ssd_storage: 5 },
            access: { host: 'plesk.24fire.de:8443', username: 'firetest', password: 'FIRE-PLESK-PASS' },
          });
      }
      return undefined;
    });
    const created = await admin.post('/admin/providers', {
      type: 'fire24',
      name: '24fire Test',
      location: { country: 'DE', city: 'Frankfurt', label: 'Frankfurt (24fire)' },
      config: { apiKey: 'fire-test-key', baseUrl: mock.url },
    });
    providerId = json<{ id: string }>(created).id;
    // Creating a provider starts the first sync in the background.
    await waitFor(async () => {
      const row = await t.db.query.providerConnections.findFirst({
        where: eq(providerConnections.id, providerId),
      });
      return row?.lastSyncAt ?? null;
    });
  });

  afterAll(async () => {
    await mock?.close();
  });

  it('syncs domains and web spaces without auth code or password', async () => {
    const result = json(await admin.post(`/admin/providers/${providerId}/sync`));
    expect(result).toMatchObject({ seen: 0, domains: { seen: 1 }, webspaces: { seen: 1 } });
    const rows = JSON.stringify([
      await t.db.select().from(domains).where(eq(domains.providerConnectionId, providerId)),
      await t.db.select().from(webspaces).where(eq(webspaces.providerConnectionId, providerId)),
    ]);
    expect(rows).toContain('fire-test.de');
    expect(rows).toContain('Plesk-Small (firetest)');
    expect(rows).not.toContain('FIRE-AUTH-CODE');
    expect(rows).not.toContain('FIRE-PLESK-PASS');
  });

  it('reports DNS as read only without 24fire+', async () => {
    const [domain] = json<DomainDto[]>(await admin.get(`/admin/domains?providerId=${providerId}`));
    const detail = json<DomainDetailDto>(await admin.get(`/domains/${domain!.id}`));
    expect(detail).toMatchObject({
      dnsWritable: false,
      liveError: null,
      info: { expiresAt: '2027-03-14T15:53:44', autoRenew: true },
    });
    expect(json<DnsRecord[]>(await admin.get(`/domains/${domain!.id}/dns`))).toHaveLength(1);
    const res = await admin.post(`/domains/${domain!.id}/dns`, { type: 'A', name: 'www', data: '192.0.2.2' });
    expect(res.statusCode).toBe(422);
    expect(json(res).error.code).toBe('plus_required');
    const [failure] = await auditEntries('domain.dns_add', domain!.id);
    expect(failure!.status).toBe('failure');
  });

  it('offers only what 24fire supports', async () => {
    const [domain] = json<DomainDto[]>(await admin.get(`/admin/domains?providerId=${providerId}`));
    expect(domain!.capabilities).toEqual(['dns', 'authcode']);
    const detail = json<DomainDetailDto>(await admin.get(`/domains/${domain!.id}`));
    expect(detail.dnsRecordTypes).toHaveLength(15);
    expect(detail.dnsRecordTypes).not.toContain('NAPTR');
    expect(detail.dnsRecordTypes).not.toContain('MAILFW');

    const id = domain!.id;
    const refused = [
      await put(admin, `/domains/${id}/nameservers`, { nameservers: ['ns1.example.net', 'ns2.example.net'] }),
      await put(admin, `/domains/${id}/lock`, { locked: true }),
      await admin.post(`/admin/domains/${id}/auto-renew`, { enabled: false }),
      await admin.post(`/admin/domains/${id}/renew`, { years: 1 }),
    ];
    for (const res of refused) {
      expect(res.statusCode).toBe(422);
      expect(json(res).error.code).toBe('unsupported');
    }

    // Types 24fire does not take never reach it; a TTL is dropped before the provider sees it.
    const naptr = await admin.post(`/domains/${id}/dns`, {
      type: 'NAPTR',
      name: '@',
      data: '100 10 "u" "E2U+sip" "!^.*$!sip:info@fire-test.de!" .',
    });
    expect(naptr.statusCode).toBe(400);
    expect(json(naptr).error.details[0]).toMatchObject({ path: 'type' });
    const withTtl = await admin.post(`/domains/${id}/dns`, {
      type: 'A',
      name: 'ttl',
      data: '192.0.2.3',
      ttl: 600,
    });
    expect(json(withTtl).error.code).toBe('plus_required');
    const [failure] = (await auditEntries('domain.dns_add', id)).filter((e) => e.details?.name === 'ttl');
    expect(failure!.status).toBe('failure');
    expect(failure!.details).not.toHaveProperty('ttl');
    const [record] = json<DnsRecord[]>(await admin.get(`/domains/${id}/dns`));
    const ttlOnly = await admin.patch(`/domains/${id}/dns/${record!.id}`, { ttl: 600 });
    expect(ttlOnly.statusCode).toBe(400);
    expect(json(ttlOnly).error.message).toBe('Nothing to change');
  });

  it('reveals the 24fire secrets only through the reveal routes', async () => {
    const [domain] = json<DomainDto[]>(await admin.get(`/admin/domains?providerId=${providerId}`));
    expect(json(await admin.get(`/domains/${domain!.id}/authcode`))).toEqual({ authcode: 'FIRE-AUTH-CODE' });
    const [webspace] = json<WebspaceDto[]>(await admin.get(`/admin/webspaces?providerId=${providerId}`));
    expect(
      json<WebspaceCredentials>(await admin.get(`/webspaces/${webspace!.id}/credentials`)),
    ).toMatchObject({
      panelUrl: 'https://plesk.24fire.de:8443',
      username: 'firetest',
      password: 'FIRE-PLESK-PASS',
    });
  });
});
