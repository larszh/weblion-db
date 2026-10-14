import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import {
  DEFAULT_CUSTOMER_BOUNDARY,
  EMPTY_MONITOR_FACTS,
  type ModuleKey,
  type MonitorAllowanceDto,
  type MonitorDetailDto,
  type MonitorDto,
  type MonitorHistoryDto,
  type MonitorStatusPageDto,
  type MonitoringInstanceDto,
  type OrgMonitoringDto,
} from '@weblion/shared';
import { syncMonitors } from '../src/jobs/sync-monitoring';
import {
  auditLogs,
  memberships,
  monitorAllowances,
  monitorStatusPages,
  monitors,
  organizations,
  providerConnections,
  servers,
  domains,
  users,
  type ProviderConnection,
} from '../src/db/schema';
import { AppError, ProviderError } from '../src/lib/errors';
import {
  assertPublicTarget,
  isPublicAddress,
  maskUrlSecrets,
  targetDns,
} from '../src/modules/monitoring/targets';
import { DemoAdapter } from '../src/providers/demo/adapter';
import { DEMO_KUMA_URL, DemoMonitoring, demoMonitoringState } from '../src/providers/demo/monitoring';
import type {
  MonitorInventory,
  ProviderAdapter,
  RemoteMonitor,
  UptimeKumaConfig,
} from '../src/providers/types';
import { ADMIN, Client, createTestApp, json, type TestApp } from './helpers';

let t: TestApp;
let admin: Client;
let anna: Client;
let carla: Client;
let dev: Client;
let reto: Client;
let hanna: Client;
let demo: ProviderConnection;
let musterId: string;
let beispielId: string;
let alpenId: string;
let huberId: string;

const STATUS_PAGE_URL = `${DEMO_KUMA_URL}/status/muster-ag`;

/** Public answers for the names the tests use; everything else does not resolve. */
const DNS: Record<string, string[]> = {
  'shop.muster-ag.ch': ['185.199.108.153'],
  'muster-shop.ch': ['185.199.108.154'],
  'www.example.com': ['93.184.215.14', '2a01:4f8:c0c:1234::1'],
  'example.com': ['93.184.215.14'],
  'alpen-hosting.ch': ['185.199.109.153'],
  'baeckerei-huber.ch': ['185.199.110.153'],
  'intranet.example.com': ['10.1.2.3'],
  'mixed.example.com': ['93.184.215.14', '192.168.1.5'],
};
const originalLookup = targetDns.lookup;
const lookups: string[] = [];

function fakeLookup(hostname: string) {
  lookups.push(hostname);
  const list = DNS[hostname];
  if (!list) {
    return Promise.reject(
      Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }),
    );
  }
  return Promise.resolve(list.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));
}

const put = (client: Client, url: string, body: unknown) => client.request('PUT', url, body);

async function orgBySlug(slug: string) {
  return (await t.db.query.organizations.findFirst({ where: eq(organizations.slug, slug) }))!;
}

async function setModules(orgId: string, modules: ModuleKey[]) {
  await t.db.update(organizations).set({ modules }).where(eq(organizations.id, orgId));
}

async function modulesOf(orgId: string) {
  return (await t.db.query.organizations.findFirst({ where: eq(organizations.id, orgId) }))!.modules;
}

async function addModule(orgId: string, module: ModuleKey) {
  const current = await modulesOf(orgId);
  if (!current.includes(module)) await setModules(orgId, [...current, module]);
  return current;
}

async function auditEntries(action: string, resourceId?: string) {
  return t.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, action), resourceId ? eq(auditLogs.resourceId, resourceId) : undefined))
    .orderBy(auditLogs.id);
}

async function row(externalId: string, connectionId = demo.id) {
  return t.db.query.monitors.findFirst({
    where: and(eq(monitors.providerConnectionId, connectionId), eq(monitors.externalId, externalId)),
  });
}

async function idOf(externalId: string) {
  return (await row(externalId))!.id;
}

async function rowById(id: string) {
  return t.db.query.monitors.findFirst({ where: eq(monitors.id, id) });
}

/** The demo instance's simulation (test helpers setStatus, removeMonitor, payloads). */
const kuma = () => new DemoMonitoring(demoMonitoringState(demo.id), () => []);

async function orgMonitoring(client: Client, orgId: string) {
  const res = await client.get(`/orgs/${orgId}/monitoring`);
  expect(res.statusCode, res.body).toBe(200);
  return json<OrgMonitoringDto>(res);
}

async function syncDemo() {
  const res = await admin.post(`/admin/providers/${demo.id}/sync`);
  expect(res.statusCode, res.body).toBe(200);
  return json<{ monitors: { seen: number; missing: number; managementError: string | null } }>(res);
}

async function createMonitor(client: Client, orgId: string, body: Record<string, unknown>) {
  return client.post(`/orgs/${orgId}/monitors`, body);
}

async function deleteMonitor(client: Client, id: string) {
  const current = await rowById(id);
  return client.del(`/monitors/${id}`, { confirm: current!.name });
}

async function newConnection(
  type: ProviderConnection['type'],
  name: string,
  config: Record<string, unknown> = {},
  managedBy: 'env' | 'ui' = 'ui',
) {
  const [connection] = await t.db
    .insert(providerConnections)
    .values({
      type,
      name,
      location: { country: 'CH', label: name },
      configEnc: t.ctx.box.encryptJson(config),
      managedBy,
    })
    .returning();
  return connection!;
}

async function newOrg(name: string, slug: string, parentOrgId: string | null = null) {
  const [org] = await t.db
    .insert(organizations)
    .values({
      name,
      slug,
      kind: 'customer',
      boundary: DEFAULT_CUSTOMER_BOUNDARY,
      parentOrgId,
      modules: ['servers'],
    })
    .returning();
  return org!;
}

async function setAllowance(orgId: string, values: { maxMonitors: number; minIntervalSeconds?: number }) {
  await t.db
    .update(monitorAllowances)
    .set({ maxMonitors: values.maxMonitors, minIntervalSeconds: values.minIntervalSeconds ?? 60 })
    .where(eq(monitorAllowances.orgId, orgId));
}

/**
 * Holds every monitor creation of the demo instance in "Kuma" (inside the creation's transaction,
 * with the monitoring locks held) until `release` is called.
 */
function holdCreations() {
  const adapter = t.ctx.providers.forConnection(demo);
  const original = adapter.createMonitor;
  let entered!: () => void;
  let release!: () => void;
  const inKuma = new Promise<void>((resolve) => (entered = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  adapter.createMonitor = async function (this: ProviderAdapter, input) {
    entered();
    await gate;
    return original!.call(this, input);
  };
  return {
    inKuma,
    release,
    restore: () => {
      release();
      adapter.createMonitor = original;
    },
  };
}

/** Runs `during` while a sync of the demo instance holds on to the monitor list it has read. */
async function duringSync(during: () => Promise<void>) {
  const original = DemoAdapter.prototype.listMonitors;
  let listed!: () => void;
  let release!: () => void;
  const read = new Promise<void>((resolve) => (listed = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  DemoAdapter.prototype.listMonitors = async function (this: DemoAdapter) {
    const inventory = await original.call(this);
    listed();
    await gate;
    return inventory;
  };
  try {
    const sync = admin.post(`/admin/providers/${demo.id}/sync`);
    await read;
    try {
      await during();
    } finally {
      release();
    }
    const res = await sync;
    expect(res.statusCode, res.body).toBe(200);
  } finally {
    DemoAdapter.prototype.listMonitors = original;
  }
}

beforeAll(async () => {
  targetDns.lookup = fakeLookup;
  t = await createTestApp();
  admin = new Client(t.app);
  await admin.login(ADMIN.email, ADMIN.password);
  anna = new Client(t.app);
  await anna.login('anna@muster.example');
  carla = new Client(t.app);
  await carla.login('carla@muster.example');
  dev = new Client(t.app);
  await dev.login('dev@beispiel.example');
  reto = new Client(t.app);
  await reto.login('reseller@alpen.example');
  hanna = new Client(t.app);
  await hanna.login('huber@baeckerei.example');
  demo = (await t.db.query.providerConnections.findFirst({ where: eq(providerConnections.envKey, 'demo') }))!;
  musterId = (await orgBySlug('muster-ag')).id;
  beispielId = (await orgBySlug('beispiel-gmbh')).id;
  alpenId = (await orgBySlug('alpen-hosting')).id;
  huberId = (await orgBySlug('baeckerei-huber')).id;
});

afterAll(async () => {
  targetDns.lookup = originalLookup;
  await t?.close();
});

// --- Targets (no database) -------------------------------------------------------------

describe('public targets', () => {
  it('tells public addresses from private and reserved ones', () => {
    for (const address of [
      '93.184.215.14',
      '8.8.8.8',
      '172.15.255.255',
      '172.32.0.0',
      '100.63.255.255',
      '100.128.0.0',
      '198.17.255.255',
      '198.20.0.0',
      '223.255.255.255',
      '2a01:4f8:c0c:1234::1',
      '[2a01:4f8::1]',
      '::ffff:93.184.215.14',
      '64:ff9b::808:808',
    ]) {
      expect(isPublicAddress(address), address).toBe(true);
    }
    for (const address of [
      '0.0.0.0',
      '10.0.0.5',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.255.255',
      '192.0.0.8',
      '192.0.2.1',
      '192.168.1.1',
      '198.18.0.1',
      '198.19.255.255',
      '198.51.100.7',
      '203.0.113.10',
      '224.0.0.1',
      '239.255.255.250',
      '255.255.255.255',
      '::',
      '::1',
      '::ffff:10.0.0.1',
      '::ffff:7f00:1',
      '::10.0.0.1',
      '64:ff9b::a00:1',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'fe80::1%eth0',
      'fec0::1',
      'ff02::1',
      '2001:db8::1',
      'example.com',
      '',
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it('refuses local names, the instance itself, private and unresolvable names', async () => {
    const lookup = async (hostname: string) => fakeLookup(hostname);
    const refused = async (host: string, message: RegExp, options = {}) => {
      const err = await assertPublicTarget(host, 'url', { lookup, ...options }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err, host).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(400);
      const details = (err as AppError).details as { path: string; message: string }[];
      expect(details[0]!.path).toBe('url');
      expect(details[0]!.message, host).toMatch(message);
    };
    lookups.length = 0;
    for (const host of [
      'localhost',
      'printer',
      'nas.local',
      'db.internal',
      'router.lan',
      'box.home.arpa',
      'a.localhost',
    ]) {
      await refused(host, /public host names/);
    }
    for (const host of ['10.0.0.5', '127.0.0.1', '[::1]', 'fd00::1', '169.254.169.254']) {
      await refused(host, /Only public addresses/);
    }
    // Neither local names nor IP literals are looked up.
    expect(lookups).toEqual([]);
    await refused('status.demo.weblion.one', /its own address/, {
      instanceHosts: ['status.demo.weblion.one'],
    });
    await refused('nowhere.example', /does not resolve/);
    await refused('intranet.example.com', /Only public addresses/);
    // One private address among public ones is enough.
    await refused('mixed.example.com', /Only public addresses/);
    await refused('empty.example', /does not resolve/, { lookup: async () => [] });
    await refused('slow.example', /right now/, { lookup: () => new Promise(() => {}), timeoutMs: 30 });
    await refused('flaky.example', /right now/, {
      lookup: async () => {
        throw Object.assign(new Error('try again'), { code: 'EAI_AGAIN' });
      },
    });

    lookups.length = 0;
    await assertPublicTarget('WWW.Example.COM.', 'hostname', { lookup });
    expect(lookups).toEqual(['www.example.com']);
    await assertPublicTarget('93.184.215.14', 'hostname', { lookup });
    await assertPublicTarget('2a01:4f8::1', 'hostname', { lookup });
    expect(lookups).toEqual(['www.example.com']);
  });

  it('masks secret-looking query values of URLs', () => {
    expect(maskUrlSecrets('https://x.ch/health?token=abc&x=1')).toBe('https://x.ch/health?token=***&x=1');
    expect(maskUrlSecrets('https://x.ch/?apiKey=1&Session=2&page=3#frag')).toBe(
      'https://x.ch/?apiKey=***&Session=***&page=3#frag',
    );
    expect(maskUrlSecrets('https://x.ch/a?b=1')).toBe('https://x.ch/a?b=1');
    expect(maskUrlSecrets('https://x.ch/a')).toBe('https://x.ch/a');
  });
});

// --- Sync -------------------------------------------------------------------------------

function remote(externalId: string, values: Partial<RemoteMonitor> = {}): RemoteMonitor {
  return {
    externalId,
    name: `Monitor ${externalId}`,
    type: 'http',
    target: `https://m${externalId}.example.com`,
    targetHost: `m${externalId}.example.com`,
    status: 'up',
    active: true,
    intervalSeconds: 60,
    parentId: null,
    facts: { ...EMPTY_MONITOR_FACTS, responseMs: 100 },
    ...values,
  };
}

function stubAdapter(inventory: MonitorInventory | (() => Promise<MonitorInventory>)): ProviderAdapter {
  return {
    listMonitors: typeof inventory === 'function' ? inventory : async () => inventory,
  } as unknown as ProviderAdapter;
}

describe('sync', () => {
  let connection: ProviderConnection;
  const stored = (externalId: string) => row(externalId, connection.id);

  beforeAll(async () => {
    connection = await newConnection('demo', 'Sync test');
  });

  afterAll(async () => {
    await t.db.delete(providerConnections).where(eq(providerConnections.id, connection.id));
  });

  it('adds new monitors unassigned and marks vanished ones missing until they return', async () => {
    const first = await syncMonitors(
      t.db,
      connection,
      stubAdapter({
        monitors: [
          remote('1', { name: 'Alpha', parentId: '3' }),
          remote('2', { name: 'Beta', status: 'down' }),
          remote('3', {
            name: 'Gruppe',
            type: 'group',
            target: null,
            targetHost: null,
            status: 'paused',
            active: false,
          }),
        ],
        complete: true,
        managementError: null,
      }),
    );
    expect(first).toEqual({ seen: 3, missing: 0, managementError: null });
    const alpha = (await stored('1'))!;
    expect(alpha).toMatchObject({
      orgId: null,
      origin: 'kuma',
      name: 'Alpha',
      providerName: 'Alpha',
      type: 'http',
      target: 'https://m1.example.com',
      targetHost: 'm1.example.com',
      status: 'up',
      active: true,
      intervalSeconds: 60,
      meta: { parentId: '3' },
      missingSince: null,
    });
    expect(alpha.facts).toEqual({ ...EMPTY_MONITOR_FACTS, responseMs: 100 });
    expect((await stored('3'))!).toMatchObject({ status: 'paused', active: false });

    // Assigned rows keep their organization and origin through every sync.
    await t.db.update(monitors).set({ orgId: beispielId }).where(eq(monitors.id, alpha.id));

    const second = await syncMonitors(
      t.db,
      connection,
      stubAdapter({
        monitors: [
          remote('1', { name: 'Alpha' }),
          remote('3', { name: 'Gruppe', type: 'group', active: false, status: 'paused' }),
        ],
        complete: true,
        managementError: 'Uptime Kuma: the stored management session was refused',
      }),
    );
    expect(second).toEqual({
      seen: 2,
      missing: 1,
      managementError: 'Uptime Kuma: the stored management session was refused',
    });
    const beta = (await stored('2'))!;
    expect(beta.status).toBe('unknown');
    expect(beta.missingSince).not.toBeNull();
    // A complete list knows that Alpha has no group any more.
    expect((await stored('1'))!).toMatchObject({ orgId: beispielId, origin: 'kuma', meta: {} });

    // Still missing: the first date stays.
    await syncMonitors(
      t.db,
      connection,
      stubAdapter({ monitors: [remote('1')], complete: true, managementError: null }),
    );
    expect((await stored('2'))!.missingSince).toEqual(beta.missingSince);

    await syncMonitors(
      t.db,
      connection,
      stubAdapter({
        monitors: [remote('1'), remote('2', { name: 'Beta' })],
        complete: true,
        managementError: null,
      }),
    );
    expect((await stored('2'))!).toMatchObject({ missingSince: null, status: 'up' });
    await t.db.update(monitors).set({ orgId: null }).where(eq(monitors.id, alpha.id));
  });

  it('follows renames unless the monitor was renamed in the console', async () => {
    await syncMonitors(
      t.db,
      connection,
      stubAdapter({
        monitors: [remote('1', { name: 'Alpha 2' }), remote('2', { name: 'Beta' })],
        complete: true,
        managementError: null,
      }),
    );
    expect((await stored('1'))!).toMatchObject({ name: 'Alpha 2', providerName: 'Alpha 2' });
    await t.db
      .update(monitors)
      .set({ name: 'Mein Alpha' })
      .where(and(eq(monitors.providerConnectionId, connection.id), eq(monitors.externalId, '1')));
    await syncMonitors(
      t.db,
      connection,
      stubAdapter({
        monitors: [remote('1', { name: 'Alpha 3' }), remote('2', { name: 'Beta' })],
        complete: true,
        managementError: null,
      }),
    );
    expect((await stored('1'))!).toMatchObject({ name: 'Mein Alpha', providerName: 'Alpha 3' });
  });

  it('keeps what the console changed while the list was on its way', async () => {
    const future = new Date(Date.now() + 3_600_000);
    await t.db
      .update(monitors)
      .set({ status: 'paused', active: false })
      .where(and(eq(monitors.providerConnectionId, connection.id), eq(monitors.externalId, '1')));
    // updatedAt after the start of the run: a console write during the sync.
    await t.db.execute(
      sql`update monitors set updated_at = ${future.toISOString()}::timestamptz where provider_connection_id = ${connection.id} and external_id in ('1', '2')`,
    );
    // Created by the console after the list was read: not missing either.
    const [fresh] = await t.db
      .insert(monitors)
      .values({
        providerConnectionId: connection.id,
        externalId: '50',
        origin: 'console',
        name: 'Neu',
        providerName: '[x] Neu',
        type: 'http',
        status: 'pending',
        createdAt: future,
      })
      .returning();
    const result = await syncMonitors(
      t.db,
      connection,
      stubAdapter({
        monitors: [remote('1', { name: 'Alpha 4', status: 'down' })],
        complete: true,
        managementError: null,
      }),
    );
    expect(result.missing).toBe(1); // only Gruppe (3)
    expect((await stored('1'))!).toMatchObject({ status: 'paused', active: false, providerName: 'Alpha 3' });
    expect((await stored('2'))!.missingSince).toBeNull();
    expect((await stored('50'))!).toMatchObject({ missingSince: null, status: 'pending' });
    expect((await stored('3'))!.missingSince).not.toBeNull();
    await t.db.delete(monitors).where(eq(monitors.id, fresh!.id));
    await t.db.execute(
      sql`update monitors set updated_at = now() - interval '1 minute' where provider_connection_id = ${connection.id}`,
    );
  });

  it('keeps paused monitors of an incomplete list and marks the others missing', async () => {
    await syncMonitors(
      t.db,
      connection,
      stubAdapter({
        monitors: [
          remote('1'),
          remote('2'),
          remote('3', {
            type: 'group',
            status: 'paused',
            active: false,
            parentId: null,
            intervalSeconds: 120,
          }),
        ],
        complete: true,
        managementError: null,
      }),
    );
    await t.db
      .update(monitors)
      .set({ meta: { parentId: '3' } })
      .where(and(eq(monitors.providerConnectionId, connection.id), eq(monitors.externalId, '2')));
    await t.db.execute(
      sql`update monitors set updated_at = now() - interval '1 minute' where provider_connection_id = ${connection.id}`,
    );
    // /metrics: paused monitors are absent, the rest is reported without interval and group.
    const result = await syncMonitors(
      t.db,
      connection,
      stubAdapter({
        monitors: [
          remote('2', {
            intervalSeconds: null,
            active: true,
            facts: { ...EMPTY_MONITOR_FACTS, responseMs: 7 },
          }),
        ],
        complete: false,
        managementError: null,
      }),
    );
    expect(result).toEqual({ seen: 1, missing: 1, managementError: null });
    expect((await stored('3'))!).toMatchObject({
      status: 'paused',
      active: false,
      missingSince: null,
      intervalSeconds: 120,
    });
    const one = (await stored('1'))!;
    expect(one.status).toBe('unknown');
    expect(one.missingSince).not.toBeNull();
    expect((await stored('2'))!).toMatchObject({
      intervalSeconds: 60,
      meta: { parentId: '3' },
      facts: { ...EMPTY_MONITOR_FACTS, responseMs: 7 },
    });
  });

  it('leaves the rows alone when the list cannot be read', async () => {
    const before = await t.db.select().from(monitors).where(eq(monitors.providerConnectionId, connection.id));
    await expect(
      syncMonitors(
        t.db,
        connection,
        stubAdapter(async () => {
          throw new ProviderError('Uptime Kuma', 'the API key was refused (HTTP 401)', 401);
        }),
      ),
    ).rejects.toThrow(/API key was refused/);
    const after = await t.db.select().from(monitors).where(eq(monitors.providerConnectionId, connection.id));
    expect(after).toEqual(before);
  });

  it('keeps a stored paused demo monitor when /metrics alone reports the instance', async () => {
    const real = await t.ctx.providers.forConnection(demo).listMonitors!();
    const reported = real.monitors
      .filter((m) => m.externalId !== '6' && m.externalId !== '7')
      .map((m) => ({ ...m, intervalSeconds: null, parentId: null }));
    const result = await syncMonitors(
      t.db,
      demo,
      stubAdapter({ monitors: reported, complete: false, managementError: null }),
    );
    expect(result.missing).toBe(1);
    expect((await row('6'))!).toMatchObject({ status: 'paused', active: false, missingSince: null });
    const seven = (await row('7'))!;
    expect(seven.status).toBe('unknown');
    expect(seven.missingSince).not.toBeNull();
    // The management session lists every monitor again.
    await syncDemo();
    expect((await row('7'))!).toMatchObject({ status: 'up', missingSince: null, intervalSeconds: 30 });
  });
});

// --- Customer ----------------------------------------------------------------------------

describe('customer view', () => {
  it('lists the monitors of Muster AG with facts, allowance and status page', async () => {
    const body = await orgMonitoring(anna, musterId);
    const byName = new Map(body.monitors.map((m) => [m.name, m]));
    expect([...byName.keys()].sort()).toEqual(
      ['Mailserver SMTP', 'Shop', 'Webserver Ping', 'muster-ag.ch Website'].sort(),
    );
    const website = byName.get('muster-ag.ch Website')!;
    expect(website).toMatchObject({
      type: 'http',
      kind: 'http',
      target: 'https://www.muster-ag.ch',
      status: 'up',
      active: true,
      intervalSeconds: 60,
      origin: 'kuma',
      manageable: false,
      statusPageUrl: STATUS_PAGE_URL,
      provider: { id: demo.id, type: 'demo' },
      org: { id: musterId, slug: 'muster-ag' },
      missingSince: null,
    });
    expect(website.facts).toMatchObject({
      responseMs: 182,
      avgResponseMs24h: 204,
      uptime24h: 0.9993,
      uptime30d: 0.99987,
      certDaysRemaining: 54,
      certValid: true,
    });
    // Found in Kuma: read-only, even for the owner.
    expect(website.permissions).toEqual(['monitor:read']);
    const shop = byName.get('Shop')!;
    expect(shop).toMatchObject({ origin: 'console', kind: 'keyword', manageable: true, status: 'up' });
    expect(shop.permissions.sort()).toEqual(['monitor:delete', 'monitor:read', 'monitor:write']);
    expect(byName.get('Mailserver SMTP')).toMatchObject({ status: 'down', target: 'mail.muster-ag.ch:25' });
    expect(byName.get('Webserver Ping')).toMatchObject({ type: 'ping', status: 'up' });

    expect(body.allowance).toMatchObject({
      orgId: musterId,
      provider: { id: demo.id },
      maxMonitors: 10,
      minIntervalSeconds: 60,
      monitors: 1,
      customers: 0,
      customerMonitors: 0,
      committed: 1,
      management: true,
    });
    expect(body.statusPages).toEqual([
      { provider: { id: demo.id, type: 'demo', name: demo.name }, slug: 'muster-ag', url: STATUS_PAGE_URL },
    ]);

    // Viewers read, and get nothing else.
    const viewed = await orgMonitoring(carla, musterId);
    expect(viewed.monitors).toHaveLength(4);
    expect(new Set(viewed.monitors.flatMap((m) => m.permissions))).toEqual(new Set(['monitor:read']));
  });

  it('refuses organizations without the module, and the module deny hides monitors from members', async () => {
    // Beispiel GmbH and Bäckerei Huber (which holds monitor 5) do not have the module.
    expect((await dev.get(`/orgs/${beispielId}/monitoring`)).statusCode).toBe(403);
    expect((await hanna.get(`/orgs/${huberId}/monitoring`)).statusCode).toBe(403);
    expect((await hanna.get(`/monitors/${await idOf('5')}`)).statusCode).toBe(404);
    const beispielServer = (
      await t.db.select({ id: servers.id }).from(servers).where(eq(servers.externalId, 'demo-42-6'))
    )[0]!;
    const related = await dev.get(`/monitors/related?serverId=${beispielServer.id}`);
    expect(related.statusCode, related.body).toBe(200);
    expect(json(related)).toEqual([]);

    const previous = await modulesOf(musterId);
    await setModules(
      musterId,
      previous.filter((m) => m !== 'monitoring'),
    );
    try {
      expect((await anna.get(`/orgs/${musterId}/monitoring`)).statusCode).toBe(403);
      expect((await anna.get(`/monitors/${await idOf('1')}`)).statusCode).toBe(404);
      const server = (
        await t.db.select({ id: servers.id }).from(servers).where(eq(servers.externalId, 'demo-42-1'))
      )[0]!;
      expect(json(await anna.get(`/monitors/related?serverId=${server.id}`))).toEqual([]);
      expect(
        (await createMonitor(anna, musterId, { kind: 'ping', name: 'X', hostname: 'example.com' }))
          .statusCode,
      ).toBe(403);
    } finally {
      await setModules(musterId, previous);
    }
  });

  it('shows a monitor live with configuration, events and the history ranges it has', async () => {
    const res = await anna.get(`/monitors/${await idOf('1')}`);
    expect(res.statusCode, res.body).toBe(200);
    const detail = json<MonitorDetailDto>(res);
    expect(detail).toMatchObject({
      name: 'muster-ag.ch Website',
      status: 'up',
      historyRanges: ['recent', '24h', '7d', '30d'],
      liveError: null,
      managementError: null,
    });
    expect(detail.config).toMatchObject({
      url: 'https://www.muster-ag.ch',
      intervalSeconds: 60,
      acceptedStatusCodes: ['200-299'],
      maxRetries: 1,
      timeoutSeconds: 48,
    });
    expect(detail.events!.length).toBeGreaterThan(0);
    expect(detail.events![0]!.at).toMatch(/Z$/);
    expect(detail.facts?.responseMs).toBe(182);

    // Not on the status page: no recent checks.
    const ping = json<MonitorDetailDto>(await anna.get(`/monitors/${await idOf('4')}`));
    expect(ping.historyRanges).toEqual(['24h', '7d', '30d']);

    // The live read updates the stored row.
    await t.db
      .update(monitors)
      .set({ status: 'unknown' })
      .where(eq(monitors.id, await idOf('3')));
    const smtp = json<MonitorDetailDto>(await anna.get(`/monitors/${await idOf('3')}`));
    expect(smtp.status).toBe('down');
    expect(smtp.events![0]).toMatchObject({
      status: 'down',
      message: 'connect ECONNREFUSED 185.101.0.25:25',
    });
    expect((await row('3'))!.status).toBe('down');
  });

  it('reports a failed live read and keeps the stored values', async () => {
    const adapter = t.ctx.providers.forConnection(demo);
    const original = adapter.getMonitor;
    adapter.getMonitor = async () => {
      throw new ProviderError('Demo', 'monitor 1 not found in Uptime Kuma', 404);
    };
    try {
      const detail = json<MonitorDetailDto>(await anna.get(`/monitors/${await idOf('1')}`));
      expect(detail).toMatchObject({ status: 'up', config: null, events: null });
      expect(detail.liveError).toMatch(/not found/);
    } finally {
      adapter.getMonitor = original;
    }
  });

  it('serves the history of a range, and 404 where there is none', async () => {
    const res = await anna.get(`/monitors/${await idOf('3')}/history?range=24h`);
    expect(res.statusCode, res.body).toBe(200);
    const history = json<MonitorHistoryDto>(res);
    expect(history).toMatchObject({ range: '24h', source: 'kuma', resolutionSeconds: 300 });
    expect(history.points.length).toBeGreaterThan(250);
    // The 20-minute outage 3 hours ago.
    expect(history.points.some((p) => p.down > 0 && p.t < Date.now() / 1000 - 2 * 3600)).toBe(true);

    const recent = json<MonitorHistoryDto>(
      await anna.get(`/monitors/${await idOf('1')}/history?range=recent`),
    );
    expect(recent).toMatchObject({ source: 'statusPage', resolutionSeconds: null });
    expect(recent.points).toHaveLength(100);

    const none = await anna.get(`/monitors/${await idOf('4')}/history?range=recent`);
    expect(none.statusCode).toBe(404);
    expect(json(none).error.message).toBe('No history available for this monitor and range');
    expect((await anna.get(`/monitors/${await idOf('4')}/history?range=1y`)).statusCode).toBe(400);
  });

  it('shows related monitors of servers and domains of the same organization', async () => {
    const serverId = async (externalId: string) =>
      (await t.db.select({ id: servers.id }).from(servers).where(eq(servers.externalId, externalId)))[0]!.id;
    const domainId = async (name: string) =>
      (await t.db.select({ id: domains.id }).from(domains).where(eq(domains.name, name)))[0]!.id;
    const names = (res: { statusCode: number; body: string }) => {
      expect(res.statusCode, res.body).toBe(200);
      return (JSON.parse(res.body) as MonitorDto[]).map((m) => m.name);
    };

    expect(names(await anna.get(`/monitors/related?serverId=${await serverId('demo-42-1')}`))).toEqual([
      'Webserver Ping',
    ]);
    // Down first.
    expect(names(await anna.get(`/monitors/related?domainId=${await domainId('muster-ag.ch')}`))).toEqual([
      'Mailserver SMTP',
      'muster-ag.ch Website',
    ]);
    expect(names(await anna.get(`/monitors/related?domainId=${await domainId('muster-shop.ch')}`))).toEqual([
      'Shop',
    ]);

    // A Muster AG monitor that pings a server of Beispiel GmbH does not show there.
    const beispielServer = (await t.db.query.servers.findFirst({
      where: eq(servers.externalId, 'demo-42-6'),
    }))!;
    const ip = beispielServer.ips.find((a) => a.version === 4)!.address;
    const created = await createMonitor(anna, musterId, {
      kind: 'ping',
      name: 'Fremder Server',
      hostname: ip,
    });
    expect(created.statusCode, created.body).toBe(200);
    try {
      expect(names(await dev.get(`/monitors/related?serverId=${beispielServer.id}`))).toEqual([]);
      expect(names(await admin.get(`/monitors/related?serverId=${beispielServer.id}`))).toEqual([]);
      // Anna does not see the server at all.
      expect((await anna.get(`/monitors/related?serverId=${beispielServer.id}`)).statusCode).toBe(404);
    } finally {
      expect((await deleteMonitor(anna, json<MonitorDto>(created).id)).statusCode).toBe(200);
    }

    expect((await anna.get('/monitors/related')).statusCode).toBe(400);
    expect(
      (
        await anna.get(
          `/monitors/related?serverId=${await serverId('demo-42-1')}&domainId=${await domainId('muster-ag.ch')}`,
        )
      ).statusCode,
    ).toBe(400);
  });

  let createdId: string;

  it('creates console monitors in Uptime Kuma with the organization prefix', async () => {
    const before = kuma().payloads().length;
    const res = await createMonitor(anna, musterId, {
      kind: 'http',
      name: 'Shop Health',
      url: 'https://shop.muster-ag.ch/health?token=geheim',
      intervalSeconds: 120,
    });
    expect(res.statusCode, res.body).toBe(200);
    const dto = json<MonitorDto>(res);
    createdId = dto.id;
    expect(dto).toMatchObject({
      name: 'Shop Health',
      origin: 'console',
      kind: 'http',
      status: 'pending',
      active: true,
      intervalSeconds: 120,
      manageable: true,
      statusPageUrl: STATUS_PAGE_URL,
      target: 'https://shop.muster-ag.ch/health?token=***',
    });
    const stored = (await rowById(createdId))!;
    expect(stored).toMatchObject({
      providerName: '[muster-ag] Shop Health',
      targetHost: 'shop.muster-ag.ch',
      orgId: musterId,
    });
    expect(stored.createdBy).not.toBeNull();
    const added = kuma().payloads().slice(before);
    expect(added).toEqual([{ event: 'add', externalId: stored.externalId }]);
    const live = demoMonitoringState(demo.id).monitors.get(stored.externalId)!;
    expect(live).toMatchObject({ name: '[muster-ag] Shop Health', intervalSeconds: 120 });

    const [entry] = await auditEntries('monitor.create', createdId);
    expect(entry).toMatchObject({ status: 'success', orgId: musterId, resourceType: 'monitor' });
    expect(entry!.details).toMatchObject({
      name: 'Shop Health',
      kind: 'http',
      target: 'https://shop.muster-ag.ch/health?token=***',
      intervalSeconds: 120,
      providerId: demo.id,
      externalId: stored.externalId,
    });
    expect(JSON.stringify(entry)).not.toContain('geheim');

    // Its first check: the next sync reports it up.
    await syncDemo();
    expect((await rowById(createdId))!.status).toBe('up');
    expect((await orgMonitoring(anna, musterId)).allowance!.committed).toBe(2);
  });

  it('refuses intervals below the minimum, private targets and monitors beyond the allowance', async () => {
    const issue = async (body: Record<string, unknown>, path: string, message?: RegExp) => {
      const res = await createMonitor(anna, musterId, body);
      expect(res.statusCode, res.body).toBe(400);
      const details = json(res).error.details as { path: string; message: string }[];
      expect(details.map((d) => d.path)).toContain(path);
      if (message) expect(details.find((d) => d.path === path)!.message).toMatch(message);
    };
    await issue(
      { kind: 'http', name: 'Zu oft', url: 'https://example.com', intervalSeconds: 30 },
      'intervalSeconds',
      /60 seconds/,
    );
    await issue({ kind: 'http', name: 'Intern', url: 'http://10.0.0.5' }, 'url', /Only public addresses/);
    await issue({ kind: 'http', name: 'Lokal', url: 'http://localhost:8080/' }, 'url', /public host names/);
    await issue(
      { kind: 'http', name: 'Gemappt', url: 'http://[::ffff:10.0.0.1]/' },
      'url',
      /Only public addresses/,
    );
    await issue(
      { kind: 'ping', name: 'Intranet', hostname: 'intranet.example.com' },
      'hostname',
      /Only public addresses/,
    );
    await issue({ kind: 'port', name: 'Loopback', hostname: '127.0.0.1', port: 22 }, 'hostname');
    await issue(
      { kind: 'http', name: 'Nirgends', url: 'https://nowhere.example' },
      'url',
      /does not resolve/,
    );
    await issue(
      { kind: 'http', name: 'Kuma selbst', url: 'https://status.demo.weblion.one/' },
      'url',
      /own address/,
    );
    // Shape checks of the shared helper.
    await issue({ kind: 'http', name: 'FTP', url: 'ftp://example.com' }, 'url');
    await issue({ kind: 'keyword', name: 'Ohne Wort', url: 'https://example.com' }, 'keyword');
    await issue({ kind: 'port', name: 'Ohne Port', hostname: 'example.com' }, 'port');
    await issue({ kind: 'http', name: 'Mit\u0007Steuerzeichen', url: 'https://example.com' }, 'name');
    await issue({ kind: 'dns', name: 'DNS', hostname: 'example.com' }, 'kind');

    const committed = (await orgMonitoring(anna, musterId)).allowance!.committed;
    await setAllowance(musterId, { maxMonitors: committed });
    try {
      const full = await createMonitor(anna, musterId, {
        kind: 'ping',
        name: 'Einer zu viel',
        hostname: 'example.com',
      });
      expect(full.statusCode, full.body).toBe(409);
      expect(json(full).error).toMatchObject({
        code: 'monitor_limit',
        details: { maxMonitors: committed, committed },
      });
    } finally {
      await setAllowance(musterId, { maxMonitors: 10 });
    }

    // Beispiel GmbH with the module but without an allowance.
    const previous = await addModule(beispielId, 'monitoring');
    try {
      const none = await createMonitor(dev, beispielId, {
        kind: 'ping',
        name: 'Ping',
        hostname: 'example.com',
      });
      expect(none.statusCode, none.body).toBe(409);
      expect(json(none).error.code).toBe('no_allowance');
    } finally {
      await setModules(beispielId, previous);
    }
    // Nothing of it reached Uptime Kuma.
    expect((await orgMonitoring(anna, musterId)).monitors).toHaveLength(5);
  });

  it('changes name, interval and keyword of a console monitor, and refuses monitors found in Kuma', async () => {
    const shop = await idOf('2');
    const res = await anna.patch(`/monitors/${shop}`, {
      name: 'Online-Shop',
      intervalSeconds: 300,
      keyword: 'Kasse',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<MonitorDto>(res)).toMatchObject({ name: 'Online-Shop', intervalSeconds: 300 });
    expect((await row('2'))!).toMatchObject({
      name: 'Online-Shop',
      providerName: '[muster-ag] Online-Shop',
      intervalSeconds: 300,
      target: 'https://muster-shop.ch',
    });
    expect(demoMonitoringState(demo.id).monitors.get('2')).toMatchObject({
      name: '[muster-ag] Online-Shop',
      keyword: 'Kasse',
      intervalSeconds: 300,
      url: 'https://muster-shop.ch',
    });
    const [entry] = (await auditEntries('monitor.update', shop)).slice(-1);
    expect(entry!.details).toMatchObject({
      before: { name: 'Shop', intervalSeconds: 120, keyword: 'Warenkorb' },
      after: { name: 'Online-Shop', intervalSeconds: 300, keyword: 'Kasse' },
    });

    // Unchanged values: nothing is sent, nothing audited.
    const audited = (await auditEntries('monitor.update', shop)).length;
    const same = await anna.patch(`/monitors/${shop}`, {
      name: 'Online-Shop',
      keyword: 'Kasse',
      method: 'GET',
    });
    expect(same.statusCode, same.body).toBe(200);
    expect((await auditEntries('monitor.update', shop)).length).toBe(audited);

    // The target of the changed URL is checked again.
    const moved = await anna.patch(`/monitors/${shop}`, { url: 'http://192.168.1.10/shop' });
    expect(moved.statusCode).toBe(400);
    expect(json(moved).error.details[0].path).toBe('url');
    expect(demoMonitoringState(demo.id).monitors.get('2')!.url).toBe('https://muster-shop.ch');
    const relocated = await anna.patch(`/monitors/${shop}`, {
      url: 'https://shop.muster-ag.ch/?session=abc',
    });
    expect(relocated.statusCode, relocated.body).toBe(200);
    expect(json<MonitorDto>(relocated).target).toBe('https://shop.muster-ag.ch/?session=***');
    expect((await row('2'))!).toMatchObject({ targetHost: 'shop.muster-ag.ch' });
    expect(demoMonitoringState(demo.id).monitors.get('2')!.url).toBe(
      'https://shop.muster-ag.ch/?session=abc',
    );
    const [relocation] = (await auditEntries('monitor.update', shop)).slice(-1);
    expect(relocation!.details).toMatchObject({
      before: { url: 'https://muster-shop.ch' },
      after: { url: 'https://shop.muster-ag.ch/?session=***' },
    });
    expect(JSON.stringify(relocation)).not.toContain('abc');
    const back = await anna.patch(`/monitors/${shop}`, { url: 'https://muster-shop.ch' });
    expect(back.statusCode, back.body).toBe(200);
    expect((await row('2'))!).toMatchObject({
      target: 'https://muster-shop.ch',
      targetHost: 'muster-shop.ch',
    });
    const empty = await anna.patch(`/monitors/${shop}`, { keyword: '  ' });
    expect(empty.statusCode).toBe(400);
    expect(json(empty).error.details[0].path).toBe('keyword');

    const below = await anna.patch(`/monitors/${shop}`, { intervalSeconds: 30 });
    expect(below.statusCode).toBe(400);
    expect(json(below).error.details[0].path).toBe('intervalSeconds');

    const readOnly = await anna.patch(`/monitors/${await idOf('1')}`, { name: 'Umbenannt' });
    expect(readOnly.statusCode).toBe(409);
    expect(json(readOnly).error.code).toBe('read_only_monitor');
    // Staff cannot change monitors found in Kuma here either.
    expect((await admin.patch(`/monitors/${await idOf('1')}`, { name: 'Umbenannt' })).statusCode).toBe(409);
    // Viewers cannot change anything.
    expect((await carla.patch(`/monitors/${shop}`, { name: 'Viewer' })).statusCode).toBe(403);
    // Back to the seed name.
    expect(
      (await anna.patch(`/monitors/${shop}`, { name: 'Shop', intervalSeconds: 120, keyword: 'Warenkorb' }))
        .statusCode,
    ).toBe(200);
  });

  it('pauses and resumes; members may, but only owners delete', async () => {
    const ben = await t.db.query.users.findFirst({ where: eq(users.email, 'ben@muster.example') });
    const membership = and(eq(memberships.orgId, musterId), eq(memberships.userId, ben!.id));
    await t.db.update(memberships).set({ role: 'member' }).where(membership);
    const benClient = new Client(t.app);
    await benClient.login('ben@muster.example');
    try {
      const paused = await benClient.post(`/monitors/${createdId}/pause`);
      expect(paused.statusCode, paused.body).toBe(200);
      expect(json<MonitorDto>(paused)).toMatchObject({ status: 'paused', active: false });
      expect((await rowById(createdId))!).toMatchObject({ status: 'paused', active: false });
      const externalId = (await rowById(createdId))!.externalId;
      expect(json<MonitorDto[]>(await admin.get(`/admin/monitors?q=Shop%20Health`))[0]!.status).toBe(
        'paused',
      );
      expect(
        demoMonitoringState(demo.id)
          .monitors.get(externalId)!
          .pauses.some((p) => p.end === null),
      ).toBe(true);
      expect(await auditEntries('monitor.pause', createdId)).toHaveLength(1);

      const resumed = await anna.post(`/monitors/${createdId}/resume`);
      expect(resumed.statusCode, resumed.body).toBe(200);
      expect(json<MonitorDto>(resumed)).toMatchObject({ status: 'pending', active: true });
      expect(await auditEntries('monitor.resume', createdId)).toHaveLength(1);

      expect((await benClient.post(`/monitors/${await idOf('1')}/pause`)).statusCode).toBe(409);
      expect((await deleteMonitor(benClient, createdId)).statusCode).toBe(403);
    } finally {
      await t.db.update(memberships).set({ role: 'restricted' }).where(membership);
    }

    const wrong = await anna.del(`/monitors/${createdId}`, { confirm: 'Shop' });
    expect(wrong.statusCode).toBe(400);
    expect(json(wrong).error.details[0].path).toBe('confirm');
    const externalId = (await rowById(createdId))!.externalId;
    const removed = await anna.del(`/monitors/${createdId}`, { confirm: 'Shop Health' });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(await rowById(createdId)).toBeUndefined();
    expect(demoMonitoringState(demo.id).monitors.has(externalId)).toBe(false);
    const [entry] = await auditEntries('monitor.delete', createdId);
    expect(entry!.details).toMatchObject({
      name: 'Shop Health',
      providerName: '[muster-ag] Shop Health',
      origin: 'console',
    });
  });

  it('deletes a monitor found in Kuma only after Kuma no longer reports it', async () => {
    const smtp = await idOf('3');
    const refused = await deleteMonitor(anna, smtp);
    expect(refused.statusCode).toBe(409);
    expect(json(refused).error.code).toBe('read_only_monitor');
    let dto = (await orgMonitoring(anna, musterId)).monitors.find((m) => m.id === smtp)!;
    expect(dto.permissions).not.toContain('monitor:delete');

    kuma().removeMonitor('3');
    const result = await syncDemo();
    expect(result.monitors.missing).toBe(1);
    dto = (await orgMonitoring(anna, musterId)).monitors.find((m) => m.id === smtp)!;
    expect(dto.missingSince).not.toBeNull();
    expect(dto.permissions).toContain('monitor:delete');
    expect((await carla.del(`/monitors/${smtp}`, { confirm: 'Mailserver SMTP' })).statusCode).toBe(403);

    const before = kuma().payloads().length;
    const removed = await deleteMonitor(anna, smtp);
    expect(removed.statusCode, removed.body).toBe(200);
    expect(await rowById(smtp)).toBeUndefined();
    // Only the row: nothing was sent to Kuma.
    expect(kuma().payloads().length).toBe(before);
  });

  it('lets read tokens read and read-write tokens create', async () => {
    const readToken = json<{ token: string }>(
      await anna.post(`/orgs/${musterId}/tokens`, { name: 'mon-read', scope: 'read' }),
    );
    const bot = new Client(t.app);
    bot.bearer = readToken.token;
    expect((await bot.get(`/orgs/${musterId}/monitoring`)).statusCode).toBe(200);
    expect(
      (await createMonitor(bot, musterId, { kind: 'ping', name: 'Bot', hostname: 'example.com' })).statusCode,
    ).toBe(403);
    expect((await bot.post(`/monitors/${await idOf('2')}/pause`)).statusCode).toBe(403);

    const writeToken = json<{ token: string }>(
      await anna.post(`/orgs/${musterId}/tokens`, { name: 'mon-write', scope: 'read_write' }),
    );
    bot.bearer = writeToken.token;
    const created = await createMonitor(bot, musterId, {
      kind: 'port',
      name: 'Bot Port',
      hostname: 'example.com',
      port: 443,
    });
    expect(created.statusCode, created.body).toBe(200);
    expect(json<MonitorDto>(created)).toMatchObject({ kind: 'port', target: 'example.com:443' });
    expect((await deleteMonitor(bot, json<MonitorDto>(created).id)).statusCode).toBe(200);
  });

  it('refuses every change with 422 while the instance is not signed in for management', async () => {
    const adapter = t.ctx.providers.forConnection(demo);
    const original = adapter.monitorManagement;
    adapter.monitorManagement = () => false;
    const shop = await idOf('2');
    try {
      const detail = json<MonitorDetailDto>(await anna.get(`/monitors/${shop}`));
      expect(detail).toMatchObject({ manageable: false, managementError: 'not signed in for management' });
      // Nothing to offer but reading (the row is not missing, so no delete either).
      expect(detail.permissions).toEqual(['monitor:read']);
      expect((await orgMonitoring(anna, musterId)).allowance!.management).toBe(false);

      const before = kuma().payloads().length;
      for (const res of [
        await createMonitor(anna, musterId, {
          kind: 'ping',
          name: 'Ohne Verwaltung',
          hostname: 'example.com',
        }),
        await anna.patch(`/monitors/${shop}`, { name: 'Anders' }),
        await anna.post(`/monitors/${shop}/pause`),
        await anna.post(`/monitors/${shop}/resume`),
        await anna.del(`/monitors/${shop}`, { confirm: 'Shop' }),
        await put(admin, `/admin/orgs/${musterId}/monitor-allowance`, {
          providerId: demo.id,
          maxMonitors: 10,
          minIntervalSeconds: 60,
        }),
      ]) {
        expect(res.statusCode, res.body).toBe(422);
        expect(json(res).error.code).toBe('unsupported');
      }
      expect(kuma().payloads().length).toBe(before);
      expect((await row('2'))!).toMatchObject({ name: 'Shop', status: 'up' });
    } finally {
      adapter.monitorManagement = original;
    }
  });

  it('never lets parallel requests create more monitors than the allowance covers', async () => {
    const committed = (await orgMonitoring(anna, musterId)).allowance!.committed;
    await setAllowance(musterId, { maxMonitors: committed + 1 });
    // Kuma takes its time: without the lock every request would have counted before any stored.
    const adapter = t.ctx.providers.forConnection(demo);
    const original = adapter.createMonitor;
    let entered = 0;
    let open!: () => void;
    const allIn = new Promise<void>((resolve) => (open = resolve));
    adapter.createMonitor = async function (this: ProviderAdapter, input) {
      entered += 1;
      if (entered === 3) open();
      await Promise.race([allIn, new Promise((resolve) => setTimeout(resolve, 300))]);
      return original!.call(this, input);
    };
    let results: Awaited<ReturnType<typeof createMonitor>>[] = [];
    try {
      results = await Promise.all(
        ['Parallel A', 'Parallel B', 'Parallel C'].map((name) =>
          createMonitor(anna, musterId, { kind: 'ping', name, hostname: 'example.com' }),
        ),
      );
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409, 409]);
      expect(entered).toBe(1);
      expect((await orgMonitoring(anna, musterId)).allowance!.committed).toBe(committed + 1);
    } finally {
      adapter.createMonitor = original;
      for (const res of results.filter((r) => r.statusCode === 200)) {
        expect((await deleteMonitor(anna, json<MonitorDto>(res).id)).statusCode).toBe(200);
      }
      await setAllowance(musterId, { maxMonitors: 10 });
    }
  });

  it('does not deadlock with an allowance change while Kuma creates a monitor', async () => {
    const { allowance } = await orgMonitoring(anna, musterId);
    const hold = holdCreations();
    let created: Awaited<ReturnType<typeof createMonitor>> | null = null;
    try {
      const creating = createMonitor(anna, musterId, {
        kind: 'ping',
        name: 'Waehrenddessen',
        hostname: 'example.com',
      });
      await hold.inKuma;
      // Staff save the allowance meanwhile: it waits for the monitoring lock the creation holds.
      const changing = put(admin, `/admin/orgs/${musterId}/monitor-allowance`, {
        providerId: demo.id,
        maxMonitors: allowance!.maxMonitors,
        minIntervalSeconds: allowance!.minIntervalSeconds,
        enableModule: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      hold.release();
      const [create, change] = await Promise.all([creating, changing]);
      created = create;
      expect(create.statusCode, create.body).toBe(200);
      expect(change.statusCode, change.body).toBe(200);
    } finally {
      hold.restore();
      if (created?.statusCode === 200) {
        expect((await deleteMonitor(anna, json<MonitorDto>(created).id)).statusCode).toBe(200);
      }
    }
  });

  it('audits a failed creation in Kuma and stores nothing', async () => {
    const adapter = t.ctx.providers.forConnection(demo);
    const original = adapter.createMonitor;
    adapter.createMonitor = async () => {
      throw new ProviderError('Demo', 'this Uptime Kuma version does not know a field the console sends');
    };
    const count = async () => (await t.db.select().from(monitors).where(eq(monitors.orgId, musterId))).length;
    const before = await count();
    try {
      const res = await createMonitor(anna, musterId, {
        kind: 'http',
        name: 'Kaputt',
        url: 'https://example.com',
      });
      expect(res.statusCode).toBe(502);
    } finally {
      adapter.createMonitor = original;
    }
    expect(await count()).toBe(before);
    const [entry] = (await auditEntries('monitor.create')).slice(-1);
    expect(entry).toMatchObject({ status: 'failure', orgId: musterId });
    expect(entry!.details).toMatchObject({
      name: 'Kaputt',
      error: expect.stringMatching(/does not know a field/),
    });
  });

  it('removes the monitor in Kuma again when it cannot be stored', async () => {
    // Kuma hands out an id that a row of another organization still holds (a stale row of a
    // monitor deleted there): the new monitor must not take that row over.
    const state = demoMonitoringState(demo.id);
    const externalId = String(state.nextId);
    const [stale] = await t.db
      .insert(monitors)
      .values({
        providerConnectionId: demo.id,
        externalId,
        orgId: beispielId,
        origin: 'kuma',
        name: 'Alt',
        providerName: 'Alt',
        type: 'http',
        status: 'unknown',
        missingSince: new Date(),
      })
      .returning();
    try {
      const before = kuma().payloads().length;
      const res = await createMonitor(anna, musterId, {
        kind: 'http',
        name: 'Fehler',
        url: 'https://example.com',
      });
      expect(res.statusCode, res.body).toBe(409);
      expect(json(res).error.message).toMatch(/removed again/);
      // Created, then deleted again in Kuma; the other organization's row is untouched.
      expect(kuma().payloads().slice(before)).toEqual([
        { event: 'add', externalId },
        { event: 'deleteMonitor', externalId },
      ]);
      expect(state.monitors.has(externalId)).toBe(false);
      expect((await rowById(stale!.id))!).toMatchObject({ orgId: beispielId, name: 'Alt', origin: 'kuma' });
      expect(await t.db.select().from(monitors).where(eq(monitors.name, 'Fehler'))).toEqual([]);
      const [entry] = (await auditEntries('monitor.create')).slice(-1);
      expect(entry).toMatchObject({ status: 'failure', orgId: musterId, resourceId: null });
      expect(entry!.details).toMatchObject({ name: 'Fehler', externalId, removedAtInstance: true });
    } finally {
      await t.db.delete(monitors).where(eq(monitors.id, stale!.id));
    }
  });
});

// --- Admin -------------------------------------------------------------------------------

describe('admin', () => {
  const list = async (query: string) => {
    const res = await admin.get(`/admin/monitors${query}`);
    expect(res.statusCode, res.body).toBe(200);
    return json<MonitorDto[]>(res);
  };

  it('filters the inventory', async () => {
    expect((await anna.get('/admin/monitors')).statusCode).toBe(403);
    const all = await list(`?providerId=${demo.id}`);
    expect(all.length).toBeGreaterThanOrEqual(7);
    expect((await list('?assigned=false')).map((m) => m.name).sort()).toEqual(
      ['Kunden-Websites', 'Status API', 'alpenblick-hotel.ch'].sort(),
    );
    expect((await list('?origin=console')).map((m) => m.name)).toEqual(['Shop']);
    expect((await list('?status=paused')).map((m) => m.name)).toEqual(['alpenblick-hotel.ch']);
    expect((await list('?q=muster-ag%5D')).map((m) => m.name)).toEqual(['Shop']);
    expect((await list('?q=alpenblick')).map((m) => m.name)).toEqual(['alpenblick-hotel.ch']);
    expect((await list(`?orgId=${huberId}`)).map((m) => m.name)).toEqual(['baeckerei-huber.ch']);
    // Staff see that the paused monitor is no customer's.
    const paused = (await list('?q=alpenblick'))[0]!;
    expect(paused).toMatchObject({ org: null, statusPageUrl: null, active: false });
    expect((await admin.get('/admin/monitors?status=broken')).statusCode).toBe(400);
  });

  it('assigns a monitor with its module, and unassigns it', async () => {
    const hotel = await idOf('6');
    const huberModules = await modulesOf(huberId);
    const alpenModules = await modulesOf(alpenId);
    try {
      // The reseller of Bäckerei Huber does not have the module.
      const refused = await admin.post(`/admin/monitors/${hotel}/assign`, {
        orgId: huberId,
        enableModule: true,
      });
      expect(refused.statusCode).toBe(409);
      await addModule(alpenId, 'monitoring');
      const res = await admin.post(`/admin/monitors/${hotel}/assign`, { orgId: huberId, enableModule: true });
      expect(res.statusCode, res.body).toBe(200);
      expect(json<MonitorDto>(res)).toMatchObject({ org: { id: huberId }, origin: 'kuma' });
      expect(await modulesOf(huberId)).toContain('monitoring');
      const [assigned] = await auditEntries('monitor.assign', hotel);
      expect(assigned!.details).toMatchObject({
        name: 'alpenblick-hotel.ch',
        orgId: huberId,
        previousOrgId: null,
        moduleEnabled: 'monitoring',
      });
      // Hanna sees it now.
      expect((await orgMonitoring(hanna, huberId)).monitors.map((m) => m.name).sort()).toEqual([
        'alpenblick-hotel.ch',
        'baeckerei-huber.ch',
      ]);

      const back = await admin.post(`/admin/monitors/${hotel}/assign`, { orgId: null });
      expect(back.statusCode, back.body).toBe(200);
      expect((await rowById(hotel))!.orgId).toBeNull();
      const [unassigned] = await auditEntries('monitor.unassign', hotel);
      expect(unassigned!.details).toMatchObject({ orgId: null, previousOrgId: huberId });
      expect((await anna.post(`/admin/monitors/${hotel}/assign`, { orgId: musterId })).statusCode).toBe(403);
    } finally {
      await setModules(huberId, huberModules);
      await setModules(alpenId, alpenModules);
    }
  });

  it('assigns every unassigned monitor of an instance at once', async () => {
    const before = await modulesOf(beispielId);
    const first = await admin.post('/admin/monitors/assign-bulk', { providerId: demo.id, orgId: beispielId });
    expect(first.statusCode, first.body).toBe(200);
    expect(json(first)).toEqual({ assigned: 3 });
    expect(await modulesOf(beispielId)).toContain('monitoring');
    const names = (await list(`?orgId=${beispielId}`)).map((m) => m.name).sort();
    expect(names).toEqual(['Kunden-Websites', 'Status API', 'alpenblick-hotel.ch'].sort());
    const [entry] = await auditEntries('monitor.assign_bulk');
    expect(entry!.details).toMatchObject({
      providerId: demo.id,
      orgId: beispielId,
      count: 3,
      moduleEnabled: 'monitoring',
    });

    const second = await admin.post('/admin/monitors/assign-bulk', {
      providerId: demo.id,
      orgId: beispielId,
    });
    expect(json(second)).toEqual({ assigned: 0 });

    await t.db.update(monitors).set({ orgId: null }).where(eq(monitors.orgId, beispielId));
    await setModules(beispielId, before);
  });

  it('sets allowances against what is committed and the instance', async () => {
    const url = `/admin/orgs/${musterId}/monitor-allowance`;
    expect(
      (await anna.request('PUT', url, { providerId: demo.id, maxMonitors: 5, minIntervalSeconds: 60 }))
        .statusCode,
    ).toBe(403);
    const set = await put(admin, url, { providerId: demo.id, maxMonitors: 12, minIntervalSeconds: 120 });
    expect(set.statusCode, set.body).toBe(200);
    expect(json<MonitorAllowanceDto>(set)).toMatchObject({
      maxMonitors: 12,
      minIntervalSeconds: 120,
      committed: 1,
      management: true,
    });
    const [entry] = (await auditEntries('monitor.allowance_set', musterId)).slice(-1);
    expect(entry!.details).toMatchObject({
      providerId: demo.id,
      maxMonitors: 12,
      minIntervalSeconds: 120,
      previous: { providerId: demo.id, maxMonitors: 10, minIntervalSeconds: 60 },
    });
    expect(json<MonitorAllowanceDto>(await admin.get(url))).toMatchObject({ maxMonitors: 12 });

    // A second console monitor, then the maximum cannot go below two.
    const second = await createMonitor(anna, musterId, {
      kind: 'ping',
      name: 'Zweiter',
      hostname: 'example.com',
      intervalSeconds: 120,
    });
    expect(second.statusCode, second.body).toBe(200);
    const lower = await put(admin, url, { providerId: demo.id, maxMonitors: 1, minIntervalSeconds: 60 });
    expect(lower.statusCode).toBe(409);
    expect(json(lower).error).toMatchObject({ code: 'monitor_limit', details: { committed: 2 } });

    // Another instance only without console monitors on the current one.
    const other = await newConnection('demo', 'Kuma 2');
    const joker = await newConnection('joker', 'Joker', {
      apiKey: 'joker-test-key',
      baseUrl: 'https://dmapi.invalid/request',
    });
    try {
      const moved = await put(admin, url, { providerId: other.id, maxMonitors: 10, minIntervalSeconds: 60 });
      expect(moved.statusCode).toBe(409);
      expect(json(moved).error.message).toMatch(/2 monitors created in the console/);
      expect(
        (await put(admin, url, { providerId: joker.id, maxMonitors: 10, minIntervalSeconds: 60 })).statusCode,
      ).toBe(422);

      expect((await admin.del(url)).statusCode).toBe(409);
      expect((await deleteMonitor(anna, json<MonitorDto>(second).id)).statusCode).toBe(200);
      expect((await deleteMonitor(anna, await idOf('2'))).statusCode).toBe(200);
      const removed = await admin.del(url);
      expect(removed.statusCode, removed.body).toBe(200);
      expect(json(await admin.get(url))).toBeNull();
      expect(await auditEntries('monitor.allowance_delete', musterId)).toHaveLength(1);
      expect((await admin.del(url)).statusCode).toBe(404);

      // Without monitors, the instance may change.
      const elsewhere = await put(admin, url, {
        providerId: other.id,
        maxMonitors: 3,
        minIntervalSeconds: 60,
      });
      expect(elsewhere.statusCode, elsewhere.body).toBe(200);
      expect(json<MonitorAllowanceDto>(elsewhere).provider!.id).toBe(other.id);
    } finally {
      await put(admin, url, { providerId: demo.id, maxMonitors: 10, minIntervalSeconds: 60 });
      await t.db.delete(providerConnections).where(eq(providerConnections.id, joker.id));
      await t.db.delete(providerConnections).where(eq(providerConnections.id, other.id));
    }
    expect((await orgMonitoring(anna, musterId)).allowance).toMatchObject({
      provider: { id: demo.id },
      committed: 0,
    });
  });

  it('links status pages that exist in Uptime Kuma', async () => {
    const base = `/admin/orgs/${beispielId}`;
    const unknown = await put(admin, `${base}/monitor-status-page`, {
      providerId: demo.id,
      slug: 'gibt-es-nicht',
    });
    expect(unknown.statusCode).toBe(422);
    expect(json(unknown).error.message).toBe('Uptime Kuma has no status page "gibt-es-nicht"');
    expect(
      (await put(admin, `${base}/monitor-status-page`, { providerId: demo.id, slug: 'Muster AG' }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await put(admin, `${base}/monitor-status-page`, {
          providerId: demo.id,
          slug: 'muster-ag',
          url: 'javascript:alert(1)',
        })
      ).statusCode,
    ).toBe(400);

    const set = await put(admin, `${base}/monitor-status-page`, { providerId: demo.id, slug: 'MUSTER-AG' });
    expect(set.statusCode, set.body).toBe(200);
    expect(json<MonitorStatusPageDto>(set)).toEqual({
      provider: { id: demo.id, type: 'demo', name: demo.name },
      slug: 'muster-ag',
      url: STATUS_PAGE_URL,
    });
    const own = await put(admin, `${base}/monitor-status-page`, {
      providerId: demo.id,
      slug: 'muster-ag',
      url: 'https://status.beispiel.de',
    });
    expect(json<MonitorStatusPageDto>(own).url).toBe('https://status.beispiel.de');
    expect(json<MonitorStatusPageDto[]>(await admin.get(`${base}/monitor-status-pages`))).toEqual([
      {
        provider: { id: demo.id, type: 'demo', name: demo.name },
        slug: 'muster-ag',
        url: 'https://status.beispiel.de',
      },
    ]);
    const [entry] = (await auditEntries('monitor.status_page_set', beispielId)).slice(-1);
    expect(entry!.details).toMatchObject({
      slug: 'muster-ag',
      url: 'https://status.beispiel.de',
      previous: { url: null },
    });
    // One link per organization and instance.
    expect(
      await t.db.select().from(monitorStatusPages).where(eq(monitorStatusPages.orgId, beispielId)),
    ).toMatchObject([
      { providerConnectionId: demo.id, slug: 'muster-ag', url: 'https://status.beispiel.de' },
    ]);

    expect((await admin.del(`${base}/monitor-status-page/${demo.id}`)).statusCode).toBe(200);
    expect((await admin.del(`${base}/monitor-status-page/${demo.id}`)).statusCode).toBe(404);
    expect(json(await admin.get(`${base}/monitor-status-pages`))).toEqual([]);
    expect(await auditEntries('monitor.status_page_delete', beispielId)).toHaveLength(1);
    expect((await anna.get(`/admin/orgs/${musterId}/monitor-status-pages`)).statusCode).toBe(403);
  });

  it('lists the instances with their management state', async () => {
    expect((await anna.get('/admin/monitoring/instances')).statusCode).toBe(403);
    const res = await admin.get('/admin/monitoring/instances');
    expect(res.statusCode, res.body).toBe(200);
    const instances = json<MonitoringInstanceDto[]>(res);
    const instance = instances.find((i) => i.provider.id === demo.id)!;
    const total = (await t.db.select().from(monitors).where(eq(monitors.providerConnectionId, demo.id)))
      .length;
    const assigned = (
      await t.db
        .select()
        .from(monitors)
        .where(and(eq(monitors.providerConnectionId, demo.id), sql`${monitors.orgId} is not null`))
    ).length;
    expect(instance).toEqual({
      provider: { id: demo.id, type: 'demo', name: demo.name },
      version: '2.5.6',
      management: 'ok',
      managementError: null,
      uptimeMetrics: true,
      monitors: total,
      assigned,
      managedBy: 'env',
    });
  });

  it('signs Uptime Kuma connections in for management and out again, storing only the token', async () => {
    // The demo instance needs no sign-in.
    const demoSession = await admin.post(`/admin/providers/${demo.id}/uptimekuma/session`, {
      username: 'admin',
      password: 'x',
    });
    expect(demoSession.statusCode).toBe(422);

    const fromEnv = await newConnection(
      'uptimekuma',
      'Kuma Env',
      { baseUrl: 'http://127.0.0.1:9', apiKey: 'uk1_abcdefghijklmnopqrstuvwxyz' },
      'env',
    );
    const kumaConfig: UptimeKumaConfig = {
      baseUrl: 'http://127.0.0.1:9',
      apiKey: 'uk2_abcdefghijklmnopqrstuvwxyz',
    };
    const ui = await newConnection('uptimekuma', 'Kuma UI', { ...kumaConfig });
    const password = 'kuma-password-123';
    const token = 'eyJhbGciOiJIUzI1NiJ9.session-token-of-the-instance';
    const calls: { username: string; password: string; totp?: string }[] = [];
    // An adapter for the UI connection that answers like Uptime Kuma, without network.
    const fake = (signedIn: boolean): ProviderAdapter =>
      ({
        type: 'uptimekuma',
        capabilities: () => [],
        powerActions: () => [],
        testConnection: async () => ({}),
        listServers: async () => [],
        getServer: async () => {
          throw new Error('no servers');
        },
        listMonitors: async () => ({ monitors: [], complete: false, managementError: null }),
        getMonitor: async () => {
          throw new ProviderError('Uptime Kuma', 'not found', 404);
        },
        monitorManagement: () => signedIn,
        monitoringStatus: async () => ({
          version: '2.5.6',
          management: signedIn ? 'ok' : 'off',
          managementError: null,
          uptimeMetrics: true,
        }),
        signInForManagement: async (credentials: { username: string; password: string; totp?: string }) => {
          calls.push(credentials);
          if (!credentials.totp) {
            throw new AppError(
              400,
              'totp_required',
              'Uptime Kuma asks for the two-factor code of this account',
            );
          }
          if (credentials.totp !== '123456') {
            throw new AppError(
              400,
              'totp_invalid',
              `The two-factor code was not accepted (${credentials.password})`,
            );
          }
          return { sessionToken: token, version: '2.5.6' };
        },
      }) as unknown as ProviderAdapter;
    const registry = t.ctx.providers;
    const original = registry.forConnection.bind(registry);
    registry.forConnection = (connection) =>
      connection.id === ui.id
        ? fake(!!registry.decryptConfig<UptimeKumaConfig>(connection).sessionToken)
        : original(connection);
    const stored = async () =>
      registry.decryptConfig<UptimeKumaConfig>(
        (await t.db.query.providerConnections.findFirst({ where: eq(providerConnections.id, ui.id) }))!,
      );
    const url = `/admin/providers/${ui.id}/uptimekuma/session`;
    try {
      const env = await admin.post(`/admin/providers/${fromEnv.id}/uptimekuma/session`, {
        username: 'admin',
        password,
      });
      expect(env.statusCode).toBe(409);
      expect(json(env).error.message).toMatch(/UPTIMEKUMA_SESSION_TOKEN/);
      expect((await admin.del(`/admin/providers/${fromEnv.id}/uptimekuma/session`)).statusCode).toBe(409);
      expect((await anna.post(url, { username: 'admin', password })).statusCode).toBe(403);
      expect((await admin.post(url, { username: 'admin', password, totp: '12345' })).statusCode).toBe(400);

      const needsCode = await admin.post(url, { username: 'admin', password });
      expect(needsCode.statusCode).toBe(400);
      expect(json(needsCode).error.code).toBe('totp_required');
      expect(needsCode.headers['cache-control']).toBe('no-store');
      const wrongCode = await admin.post(url, { username: 'admin', password, totp: '654321' });
      expect(wrongCode.statusCode).toBe(400);
      expect(json(wrongCode).error.code).toBe('totp_invalid');
      // The adapter's message carried the password: it never reaches the answer or the audit.
      expect(wrongCode.body).not.toContain(password);
      expect((await stored()).sessionToken).toBeUndefined();

      const res = await admin.post(url, { username: 'admin', password, totp: '123456' });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(json<MonitoringInstanceDto>(res)).toMatchObject({
        management: 'ok',
        version: '2.5.6',
        managedBy: 'ui',
      });
      expect(res.body).not.toContain(token);
      expect(await stored()).toEqual({ ...kumaConfig, sessionToken: token });
      expect(calls.at(-1)).toEqual({ username: 'admin', password, totp: '123456' });

      const entries = await auditEntries('provider.update', ui.id);
      expect(entries.map((e) => [e.status, e.details])).toEqual([
        ['failure', expect.objectContaining({ monitoringSession: 'sign_in', username: 'admin' })],
        ['failure', expect.objectContaining({ monitoringSession: 'sign_in', username: 'admin' })],
        ['success', { monitoringSession: 'signed_in', username: 'admin', version: '2.5.6' }],
      ]);
      const audited = JSON.stringify(entries);
      expect(audited).not.toContain(password);
      expect(audited).not.toContain('123456');
      expect(audited).not.toContain(token);

      // Tokens never sign anything in.
      const apiToken = json<{ token: string }>(
        await anna.post(`/orgs/${musterId}/tokens`, { name: 'x', scope: 'read_write' }),
      );
      const bot = new Client(t.app);
      bot.bearer = apiToken.token;
      expect((await bot.del(url)).statusCode).toBe(403);

      const out = await admin.del(url);
      expect(out.statusCode, out.body).toBe(200);
      expect(json<MonitoringInstanceDto>(out).management).toBe('off');
      expect(await stored()).toEqual(kumaConfig);
      const [last] = (await auditEntries('provider.update', ui.id)).slice(-1);
      expect(last!.details).toEqual({ monitoringSession: 'signed_out' });
    } finally {
      registry.forConnection = original;
      await t.db.delete(providerConnections).where(eq(providerConnections.id, fromEnv.id));
      await t.db.delete(providerConnections).where(eq(providerConnections.id, ui.id));
    }
  });

  it('refuses to delete an instance while its monitors are assigned', async () => {
    const other = await newConnection('demo', 'Kuma 3');
    try {
      const synced = await admin.post(`/admin/providers/${other.id}/sync`);
      expect(synced.statusCode, synced.body).toBe(200);
      expect(json(synced).monitors.seen).toBe(8);
      const monitor = (await row('1', other.id))!;
      expect((await admin.post(`/admin/monitors/${monitor.id}/assign`, { orgId: musterId })).statusCode).toBe(
        200,
      );
      const refused = await admin.del(`/admin/providers/${other.id}`);
      expect(refused.statusCode).toBe(409);
      expect(json(refused).error.message).toMatch(/Unassign all monitors of this instance/);
      expect((await admin.post(`/admin/monitors/${monitor.id}/assign`, { orgId: null })).statusCode).toBe(
        200,
      );
      const removed = await admin.del(`/admin/providers/${other.id}`);
      expect(removed.statusCode, removed.body).toBe(200);
      expect(await row('1', other.id)).toBeUndefined();
    } finally {
      await t.db.delete(providerConnections).where(eq(providerConnections.id, other.id));
    }
  });
});

// --- Reseller ----------------------------------------------------------------------------

describe('reseller', () => {
  let alpenModules: ModuleKey[];
  let huberModules: ModuleKey[];
  const url = () => `/reseller/customers/${huberId}/monitor-allowance`;

  beforeAll(async () => {
    alpenModules = await addModule(alpenId, 'monitoring');
    huberModules = await modulesOf(huberId);
  });

  afterAll(async () => {
    await setModules(alpenId, alpenModules);
    await setModules(huberId, huberModules);
  });

  it('hands a share of its allowance to a customer', async () => {
    expect((await hanna.request('PUT', url(), { maxMonitors: 5, minIntervalSeconds: 60 })).statusCode).toBe(
      404,
    );
    expect(json(await reto.get(url()))).toBeNull();

    const res = await put(reto, url(), { maxMonitors: 5, minIntervalSeconds: 60 });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<MonitorAllowanceDto>(res)).toMatchObject({
      orgId: huberId,
      provider: { id: demo.id },
      maxMonitors: 5,
      minIntervalSeconds: 60,
      committed: 0,
    });
    expect(await modulesOf(huberId)).toContain('monitoring');
    const [entry] = (await auditEntries('monitor.allowance_set', huberId)).slice(-1);
    expect(entry).toMatchObject({ orgId: alpenId });
    expect(entry!.details).toMatchObject({
      customerId: huberId,
      maxMonitors: 5,
      moduleEnabled: 'monitoring',
    });
    expect(
      json<MonitorAllowanceDto>(await admin.get(`/admin/orgs/${alpenId}/monitor-allowance`)),
    ).toMatchObject({
      maxMonitors: 50,
      customers: 1,
      customerMonitors: 5,
      committed: 5,
    });

    // More than is left of the reseller's 50.
    const tooMuch = await put(reto, url(), { maxMonitors: 51, minIntervalSeconds: 60 });
    expect(tooMuch.statusCode).toBe(409);
    expect(json(tooMuch).error).toMatchObject({
      code: 'monitor_limit',
      message: 'Only 50 monitors of your allowance are left for this customer',
    });
    const second = await newOrg('Zweitkunde', 'zweitkunde', alpenId);
    try {
      const rest = await put(reto, `/reseller/customers/${second.id}/monitor-allowance`, {
        maxMonitors: 46,
        minIntervalSeconds: 60,
      });
      expect(rest.statusCode).toBe(409);
      expect(json(rest).error.message).toBe('Only 45 monitors of your allowance are left for this customer');
    } finally {
      await t.db.delete(organizations).where(eq(organizations.id, second.id));
    }
    const fast = await put(reto, url(), { maxMonitors: 5, minIntervalSeconds: 30 });
    expect(fast.statusCode).toBe(400);
    expect(json(fast).error.details[0].path).toBe('minIntervalSeconds');

    // The reseller's own allowance cannot drop below what it handed out.
    const lower = await put(admin, `/admin/orgs/${alpenId}/monitor-allowance`, {
      providerId: demo.id,
      maxMonitors: 4,
      minIntervalSeconds: 60,
    });
    expect(lower.statusCode).toBe(409);
    const slower = await put(admin, `/admin/orgs/${alpenId}/monitor-allowance`, {
      providerId: demo.id,
      maxMonitors: 50,
      minIntervalSeconds: 120,
    });
    expect(slower.statusCode).toBe(400);
    expect((await admin.del(`/admin/orgs/${alpenId}/monitor-allowance`)).statusCode).toBe(409);

    const removed = await reto.del(url());
    expect(removed.statusCode, removed.body).toBe(200);
    expect(json(await reto.get(url()))).toBeNull();
    expect(await auditEntries('monitor.allowance_delete', huberId)).toHaveLength(1);
  });

  it('moves monitors between the reseller and its customers within the allowances', async () => {
    const resources = `/orgs/${alpenId}/customers/${huberId}/resources`;
    // A monitor found in Kuma moves freely.
    const status = await idOf('7');
    expect((await admin.post(`/admin/monitors/${status}/assign`, { orgId: alpenId })).statusCode).toBe(200);
    const moved = await reto.post(resources, { type: 'monitor', id: status });
    expect(moved.statusCode, moved.body).toBe(200);
    expect((await rowById(status))!.orgId).toBe(huberId);
    const released = await reto.post(`${resources}/release`, { type: 'monitor', id: status });
    expect(released.statusCode, released.body).toBe(200);
    expect((await rowById(status))!.orgId).toBe(alpenId);

    // A console monitor of the reseller needs a free slot at the customer.
    const own = await createMonitor(reto, alpenId, {
      kind: 'http',
      name: 'Kundenshop',
      url: 'https://baeckerei-huber.ch',
    });
    expect(own.statusCode, own.body).toBe(200);
    const ownId = json<MonitorDto>(own).id;
    const noAllowance = await reto.post(resources, { type: 'monitor', id: ownId });
    expect(noAllowance.statusCode).toBe(409);
    expect(json(noAllowance).error.code).toBe('no_allowance');

    expect((await put(reto, url(), { maxMonitors: 1, minIntervalSeconds: 60 })).statusCode).toBe(200);
    const theirs = await createMonitor(hanna, huberId, {
      kind: 'ping',
      name: 'Eigener',
      hostname: 'baeckerei-huber.ch',
    });
    expect(theirs.statusCode, theirs.body).toBe(200);
    const full = await reto.post(resources, { type: 'monitor', id: ownId });
    expect(full.statusCode).toBe(409);
    expect(json(full).error.code).toBe('monitor_limit');
    expect((await deleteMonitor(hanna, json<MonitorDto>(theirs).id)).statusCode).toBe(200);

    // A slot again, but the customer may not check every minute.
    expect((await put(reto, url(), { maxMonitors: 1, minIntervalSeconds: 300 })).statusCode).toBe(200);
    const tooFast = await reto.post(resources, { type: 'monitor', id: ownId });
    expect(tooFast.statusCode).toBe(409);
    expect(json(tooFast).error.message).toMatch(/every 60 seconds/);

    expect((await put(reto, url(), { maxMonitors: 1, minIntervalSeconds: 60 })).statusCode).toBe(200);
    expect((await reto.post(resources, { type: 'monitor', id: ownId })).statusCode).toBe(200);
    expect((await rowById(ownId))!.orgId).toBe(huberId);
    // The customer's allowance cannot be removed while the monitor uses it.
    expect((await reto.del(url())).statusCode).toBe(409);
    expect((await reto.post(`${resources}/release`, { type: 'monitor', id: ownId })).statusCode).toBe(200);
    expect((await rowById(ownId))!.orgId).toBe(alpenId);

    expect((await deleteMonitor(reto, ownId)).statusCode).toBe(200);
    expect((await reto.del(url())).statusCode).toBe(200);
    expect((await admin.post(`/admin/monitors/${status}/assign`, { orgId: null })).statusCode).toBe(200);
  });

  it('does not deadlock when a monitor moves to a customer that is creating one', async () => {
    const resources = `/orgs/${alpenId}/customers/${huberId}/resources`;
    expect((await put(reto, url(), { maxMonitors: 2, minIntervalSeconds: 60 })).statusCode).toBe(200);
    const own = await createMonitor(reto, alpenId, {
      kind: 'http',
      name: 'Umzug',
      url: 'https://baeckerei-huber.ch',
    });
    expect(own.statusCode, own.body).toBe(200);
    const ownId = json<MonitorDto>(own).id;
    const hold = holdCreations();
    let theirs: Awaited<ReturnType<typeof createMonitor>> | null = null;
    try {
      const creating = createMonitor(hanna, huberId, {
        kind: 'ping',
        name: 'Parallel',
        hostname: 'baeckerei-huber.ch',
      });
      await hold.inKuma;
      // The hand-over locks the customer's row, then waits for the monitoring lock the creation holds.
      const moving = reto.post(resources, { type: 'monitor', id: ownId });
      await new Promise((resolve) => setTimeout(resolve, 300));
      hold.release();
      const [create, move] = await Promise.all([creating, moving]);
      theirs = create;
      expect(create.statusCode, create.body).toBe(200);
      expect(move.statusCode, move.body).toBe(200);
      expect((await rowById(ownId))!.orgId).toBe(huberId);
    } finally {
      hold.restore();
      if (theirs?.statusCode === 200) {
        expect((await deleteMonitor(hanna, json<MonitorDto>(theirs).id)).statusCode).toBe(200);
      }
      if ((await rowById(ownId))!.orgId === huberId) {
        expect((await reto.post(`${resources}/release`, { type: 'monitor', id: ownId })).statusCode).toBe(
          200,
        );
      }
      expect((await deleteMonitor(reto, ownId)).statusCode).toBe(200);
      expect((await reto.del(url())).statusCode).toBe(200);
    }
  });

  it('blocks deleting an organization with monitors or an allowance', async () => {
    const org = await newOrg('Löschtest', 'loeschtest');
    const hotel = await idOf('6');
    expect((await admin.post(`/admin/monitors/${hotel}/assign`, { orgId: org.id })).statusCode).toBe(200);
    expect(
      (
        await put(admin, `/admin/orgs/${org.id}/monitor-allowance`, {
          providerId: demo.id,
          maxMonitors: 2,
          minIntervalSeconds: 60,
        })
      ).statusCode,
    ).toBe(200);
    const refused = await admin.del(`/admin/orgs/${org.id}`);
    expect(refused.statusCode).toBe(409);
    expect(json(refused).error.details).toMatchObject({ monitors: 1, monitorAllowances: 1 });
    expect(json(refused).error.message).toMatch(/1 monitors, 1 monitoring allowance/);

    expect((await admin.post(`/admin/monitors/${hotel}/assign`, { orgId: null })).statusCode).toBe(200);
    expect((await admin.del(`/admin/orgs/${org.id}/monitor-allowance`)).statusCode).toBe(200);
    expect((await admin.del(`/admin/orgs/${org.id}`)).statusCode).toBe(200);
  });
});

describe('console writes during a sync', () => {
  it('are not overwritten by the list the sync read before', async () => {
    // A console monitor to pause while the sync holds on to the list.
    const created = await createMonitor(anna, musterId, {
      kind: 'ping',
      name: 'Während Sync',
      hostname: 'example.com',
    });
    expect(created.statusCode, created.body).toBe(200);
    const id = json<MonitorDto>(created).id;
    await syncDemo();
    expect((await rowById(id))!.status).toBe('up');
    await duringSync(async () => {
      expect((await anna.post(`/monitors/${id}/pause`)).statusCode).toBe(200);
    });
    expect((await rowById(id))!).toMatchObject({ status: 'paused', active: false });
    // The next run reads the paused state from Kuma.
    await syncDemo();
    expect((await rowById(id))!).toMatchObject({ status: 'paused', active: false, missingSince: null });
    expect((await deleteMonitor(anna, id)).statusCode).toBe(200);
  });
});
