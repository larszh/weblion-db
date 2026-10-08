import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  DEFAULT_CUSTOMER_BOUNDARY,
  DEFAULT_RESELLER_BOUNDARY,
  type DnsRecord,
  type DomainDetailDto,
  type DomainDto,
  type ModuleKey,
  type WebspaceCredentials,
  type WebspaceDetailDto,
  type WebspaceDto,
} from '@weblion/shared';
import { auditLogs, domains, organizations, providerConnections, webspaces } from '../src/db/schema';
import { demoHostingState } from '../src/providers/demo/hosting';
import { ADMIN, Client, createTestApp, json, type TestApp } from './helpers';
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
    expect(domain.permissions).toEqual(['domain:read', 'domain:dns:write', 'domain:authcode']);
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

    const valid = [
      { type: 'AAAA', name: 'v6', data: '2001:db8::1' },
      { type: 'CNAME', name: 'shop', data: 'shops.example.net.' },
      { type: 'MX', name: '@', data: '20 mx2.example.ch' },
      { type: 'TXT', name: '_dmarc', data: 'v=DMARC1; p=none' },
      { type: 'SRV', name: '_sip._tls', data: '100 1 443 sip.example.ch' },
      { type: 'CAA', name: '@', data: '0 issue "letsencrypt.org"' },
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
