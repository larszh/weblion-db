import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  DEFAULT_CUSTOMER_BOUNDARY,
  DEFAULT_RESELLER_BOUNDARY,
  WEBSITE_PASSWORD_PATTERN,
  suggestSiteUser,
  websiteDomainAscii,
  type ModuleKey,
  type OrgKind,
  type UnmanagedWebsitesDto,
  type WebsiteAllowanceDto,
  type WebsiteCreatedDto,
  type WebsiteCredentialsDto,
  type WebsiteDatabaseSecretDto,
  type WebsiteDnsCheckDto,
  type WebsiteOptionsDto,
  type WebsiteServerOptions,
  type WebspaceDetailDto,
  type WebspaceDto,
} from '@weblion/shared';
import { seedWebsitesDemo } from '../src/db/seed-websites';
import {
  auditLogs,
  memberships,
  organizations,
  providerConnections,
  services,
  users,
  webspaceDatabases,
  webspaces,
  type ProviderConnection,
} from '../src/db/schema';
import { AppError, ProviderError } from '../src/lib/errors';
import { assertNotPlatformName } from '../src/modules/hosting/website-service';
import { hashPassword } from '../src/lib/crypto';
import {
  DEMO_CLOUDPANEL_HOST,
  DEMO_CLOUDPANEL_IPV4,
  DemoCloudPanelAdapter,
  demoCloudPanelState,
} from '../src/providers/demo/cloudpanel';
import { ADMIN, Client, createTestApp, DEMO_PASSWORD, json, type TestApp } from './helpers';

let t: TestApp;
let admin: Client;
let anna: Client;
let carla: Client;
let dev: Client;
let reto: Client;
let hanna: Client;
let cp: ProviderConnection;
let musterId: string;
let beispielId: string;
let alpenId: string;
let huberId: string;

const put = (client: Client, url: string, body: unknown) => client.request('PUT', url, body);
const demo = () => demoCloudPanelState(cp.id);
const PASSWORD = 'Chosen-Pass.2026';

async function orgBySlug(slug: string) {
  return (await t.db.query.organizations.findFirst({ where: eq(organizations.slug, slug) }))!;
}

async function websiteRow(domain: string, connectionId = cp.id) {
  return t.db.query.webspaces.findFirst({
    where: and(eq(webspaces.providerConnectionId, connectionId), eq(webspaces.externalId, domain)),
  });
}

async function websiteRows(connectionId = cp.id) {
  return t.db
    .select()
    .from(webspaces)
    .where(and(eq(webspaces.providerConnectionId, connectionId), eq(webspaces.kind, 'website')))
    .orderBy(webspaces.externalId);
}

async function databasesOf(webspaceId: string) {
  return t.db
    .select()
    .from(webspaceDatabases)
    .where(eq(webspaceDatabases.webspaceId, webspaceId))
    .orderBy(webspaceDatabases.name);
}

async function auditEntries(action: string) {
  return t.db.select().from(auditLogs).where(eq(auditLogs.action, action)).orderBy(auditLogs.id);
}

/** Everything stored about websites, to search it for passwords. */
async function storedText() {
  return JSON.stringify([
    await t.db.select().from(auditLogs),
    await t.db.select().from(webspaces),
    await t.db.select().from(webspaceDatabases),
  ]);
}

async function create(client: Client, orgId: string, body: Record<string, unknown>) {
  return client.post(`/orgs/${orgId}/websites`, body);
}

async function created(client: Client, orgId: string, body: Record<string, unknown>) {
  const res = await create(client, orgId, body);
  expect(res.statusCode, res.body).toBe(201);
  return json<WebsiteCreatedDto>(res);
}

async function sync(connection = cp) {
  const result = await t.ctx.sync.syncConnection(connection);
  return result.websites!;
}

async function setAllowance(orgId: string, body: Record<string, unknown>) {
  const res = await put(admin, `/admin/orgs/${orgId}/website-allowance`, { providerId: cp.id, ...body });
  expect(res.statusCode, res.body).toBe(200);
  return json<WebsiteAllowanceDto>(res);
}

async function newUser(email: string, orgId: string, role: 'owner' | 'member' | 'viewer' = 'owner') {
  const [user] = await t.db
    .insert(users)
    .values({ email, name: email.split('@')[0]!, passwordHash: await hashPassword(DEMO_PASSWORD) })
    .returning();
  await t.db.insert(memberships).values({ orgId, userId: user!.id, role });
  const client = new Client(t.app);
  await client.login(email);
  return client;
}

async function newOrg(
  name: string,
  slug: string,
  options: { kind?: OrgKind; parentOrgId?: string; modules?: ModuleKey[] } = {},
) {
  const [org] = await t.db
    .insert(organizations)
    .values({
      name,
      slug,
      kind: options.kind ?? 'customer',
      boundary: DEFAULT_CUSTOMER_BOUNDARY,
      parentOrgId: options.parentOrgId ?? null,
      modules: options.modules ?? ['servers'],
    })
    .returning();
  return org!;
}

/** A second simulated CloudPanel server, stored like one created in the admin UI. */
async function newCloudPanelConnection(name: string, config: Record<string, unknown>) {
  const [connection] = await t.db
    .insert(providerConnections)
    .values({
      type: 'demo',
      name,
      location: { country: 'CH', city: 'Bern', label: name },
      configEnc: t.ctx.box.encryptJson({ flavor: 'cloudpanel', ...config }),
    })
    .returning();
  return connection!;
}

const timeout = () => new AppError(504, 'timeout', 'No answer from web1 within 330 s.');

beforeAll(async () => {
  t = await createTestApp({ env: { ENABLE_DEMO_CLOUDPANEL: 'true' } });
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
  cp = (await t.db.query.providerConnections.findFirst({
    where: eq(providerConnections.envKey, 'demo-cloudpanel'),
  }))!;
  musterId = (await orgBySlug('muster-ag')).id;
  beispielId = (await orgBySlug('beispiel-gmbh')).id;
  alpenId = (await orgBySlug('alpen-hosting')).id;
  huberId = (await orgBySlug('baeckerei-huber')).id;
});

afterAll(async () => {
  await t?.close();
});

describe('sync', () => {
  it('lists the managed sites unassigned, and the seed hands them out', async () => {
    expect(await websiteRows()).toEqual([]);
    expect(await sync()).toEqual({ seen: 4, missing: 0, databases: 2 });

    const rows = await websiteRows();
    expect(rows.map((r) => r.externalId)).toEqual([
      'api.muster-ag.example',
      'baeckerei-huber.example',
      'shop.muster-ag.example',
      'www.muster-ag.example',
    ]);
    expect(rows.every((r) => r.orgId === null && r.status === 'active' && r.kind === 'website')).toBe(true);
    const www = rows.find((r) => r.externalId === 'www.muster-ag.example')!;
    expect(www).toMatchObject({
      name: 'www.muster-ag.example',
      missingSince: null,
      info: {
        name: 'www.muster-ag.example',
        username: 'muster-ag-www',
        panelUrl: null,
        resources: { databases: 1, ipAddress: DEMO_CLOUDPANEL_IPV4 },
        site: {
          type: 'php',
          siteUser: 'muster-ag-www',
          application: 'WordPress',
          phpVersion: '8.3',
          databases: 1,
          certificate: { letsEncrypt: true },
        },
      },
    });
    expect((await databasesOf(www.id)).map((d) => [d.name, d.userName, d.status])).toEqual([
      ['muster_ag_www_wp', 'muster_ag_www_wp', 'active'],
    ]);
    // Protected and unmanaged sites never become rows.
    expect(await websiteRow('cp.weblion.demo')).toBeUndefined();
    expect(await websiteRow('legacy.kunde.example')).toBeUndefined();

    await seedWebsitesDemo(t.db, []);
    const owners = Object.fromEntries((await websiteRows()).map((r) => [r.externalId, r.orgId]));
    expect(owners).toEqual({
      'api.muster-ag.example': musterId,
      'baeckerei-huber.example': huberId,
      'shop.muster-ag.example': musterId,
      'www.muster-ag.example': musterId,
    });
  });

  it('changes nothing on a second sync', async () => {
    const snapshot = async () => ({
      sites: (await websiteRows()).map(
        ({ id, name, orgId, status, info, meta, missingSince, createdAt }) => ({
          id,
          name,
          orgId,
          status,
          info,
          meta,
          missingSince,
          createdAt,
        }),
      ),
      databases: (await t.db.select().from(webspaceDatabases).orderBy(webspaceDatabases.name)).map(
        ({ id, webspaceId, name, userName, status, sizeBytes, missingSince }) => ({
          id,
          webspaceId,
          name,
          userName,
          status,
          sizeBytes,
          missingSince,
        }),
      ),
    });
    const before = await snapshot();
    expect(await sync()).toEqual({ seen: 4, missing: 0, databases: 2 });
    expect(await snapshot()).toEqual(before);
  });

  it('adds sites that appear on the server and marks vanished ones missing', async () => {
    const adapter = t.ctx.providers.forConnection(cp);
    const plainWebspaces = await t.db.select().from(webspaces).where(eq(webspaces.kind, 'webspace'));
    await adapter.createWebsite!({
      domain: 'gone.example',
      type: 'static',
      phpVersion: null,
      template: null,
      nodejsVersion: null,
      siteUser: 'gone-example',
      password: PASSWORD,
      database: null,
    });
    expect(await sync()).toEqual({ seen: 5, missing: 0, databases: 2 });
    const row = (await websiteRow('gone.example'))!;
    expect(row).toMatchObject({ orgId: null, status: 'active', missingSince: null });

    demo().sites.delete('gone.example');
    demo().managed.delete('gone.example');
    expect(await sync()).toEqual({ seen: 4, missing: 1, databases: 2 });
    const missing = (await websiteRow('gone.example'))!;
    expect(missing.missingSince).toBeInstanceOf(Date);
    await sync();
    expect((await websiteRow('gone.example'))!.missingSince).toEqual(missing.missingSince);
    // Web spaces of other providers are not touched.
    expect(await t.db.select().from(webspaces).where(eq(webspaces.kind, 'webspace'))).toEqual(plainWebspaces);
    await t.db.delete(webspaces).where(eq(webspaces.id, row.id));
  });

  it('settles creations and deletions that lost their route', async () => {
    const adapter = t.ctx.providers.forConnection(cp);
    await adapter.createWebsite!({
      domain: 'stuck.example',
      type: 'static',
      phpVersion: null,
      template: null,
      nodejsVersion: null,
      siteUser: 'stuck-example',
      password: PASSWORD,
      database: null,
    });
    await adapter.createWebsite!({
      domain: 'kept.example',
      type: 'static',
      phpVersion: null,
      template: null,
      nodejsVersion: null,
      siteUser: 'kept-example',
      password: PASSWORD,
      database: { name: 'kept_example_db', userName: 'kept_example_db', password: PASSWORD },
    });
    const old = new Date(Date.now() - 11 * 60_000);
    const placeholder = (domain: string, status: 'creating' | 'deleting', at: Date) => ({
      providerConnectionId: cp.id,
      externalId: domain,
      name: domain,
      kind: 'website' as const,
      status,
      orgId: musterId,
      createdAt: at,
      updatedAt: at,
    });
    const rows = await t.db
      .insert(webspaces)
      .values([
        placeholder('stuck.example', 'creating', old),
        placeholder('recent.example', 'creating', new Date()),
        placeholder('leaving.example', 'deleting', new Date()),
        // Their route died (a restart): one is gone on the server, one was never deleted.
        placeholder('left.example', 'deleting', old),
        placeholder('kept.example', 'deleting', old),
      ])
      .returning();
    const kept = rows.find((r) => r.externalId === 'kept.example')!;
    await t.db.insert(webspaceDatabases).values([
      {
        webspaceId: kept.id,
        providerConnectionId: cp.id,
        name: 'kept_example_db',
        status: 'deleting',
        createdAt: old,
        updatedAt: old,
      },
      {
        webspaceId: kept.id,
        providerConnectionId: cp.id,
        name: 'kept_example_gone',
        status: 'deleting',
        createdAt: old,
        updatedAt: old,
      },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await sync();
    expect(await websiteRow('stuck.example')).toMatchObject({
      status: 'active',
      orgId: musterId,
      meta: { credentialsDelivered: false },
      info: { site: { siteUser: 'stuck-example' } },
    });
    // Still on its way: neither settled nor removed. A deletion is not taken as missing.
    expect(await websiteRow('recent.example')).toMatchObject({ status: 'creating', missingSince: null });
    expect(await websiteRow('leaving.example')).toMatchObject({ status: 'deleting', missingSince: null });
    // A deletion whose route was lost: gone on the server, the row goes; still there, it is active.
    expect(await websiteRow('left.example')).toBeUndefined();
    expect(await websiteRow('kept.example')).toMatchObject({
      status: 'active',
      missingSince: null,
      meta: {},
      info: { site: { siteUser: 'kept-example' } },
    });
    expect((await databasesOf(kept.id)).map((d) => [d.name, d.status])).toEqual([
      ['kept_example_db', 'active'],
    ]);

    for (const domain of ['stuck.example', 'recent.example', 'leaving.example', 'kept.example']) {
      await t.db.delete(webspaces).where(eq(webspaces.externalId, domain));
    }
    for (const domain of ['stuck.example', 'kept.example']) {
      demo().sites.delete(domain);
      demo().managed.delete(domain);
    }
  });
});

describe('customer views', () => {
  it('lists websites next to web spaces', async () => {
    const list = json<WebspaceDto[]>(await anna.get(`/orgs/${musterId}/webspaces`));
    const sites = list.filter((w) => w.kind === 'website');
    expect(sites.map((w) => w.name)).toEqual([
      'api.muster-ag.example',
      'shop.muster-ag.example',
      'www.muster-ag.example',
    ]);
    expect(sites.find((w) => w.name === 'api.muster-ag.example')).toMatchObject({
      status: 'active',
      provider: { id: cp.id },
      site: { type: 'nodejs', nodejsVersion: '22', appPort: 3001 },
      credentialsPending: false,
    });
    expect(sites[0]!.permissions.sort()).toEqual([
      'webspace:credentials',
      'webspace:delete',
      'webspace:read',
      'webspace:write',
    ]);
    // The web space of the main demo provider stays what it was.
    expect(list.filter((w) => w.kind === 'webspace')).toEqual([
      expect.objectContaining({ kind: 'webspace', status: 'active', site: null, credentialsPending: false }),
    ]);
    const huber = json<WebspaceDto[]>(await hanna.get(`/orgs/${huberId}/webspaces`));
    expect(huber.map((w) => w.name)).toEqual(['baeckerei-huber.example']);
  });

  it('shows the access data and databases, read live when the stored facts are old', async () => {
    const row = (await websiteRow('www.muster-ag.example'))!;
    const detail = json<WebspaceDetailDto>(await carla.get(`/webspaces/${row.id}`));
    expect(detail).toMatchObject({
      kind: 'website',
      liveError: null,
      access: {
        host: DEMO_CLOUDPANEL_HOST,
        port: 22,
        username: 'muster-ag-www',
        homeDirectory: '/home/muster-ag-www',
        webRoot: '/home/muster-ag-www/htdocs/www.muster-ag.example',
      },
      databases: [
        {
          name: 'muster_ag_www_wp',
          userName: 'muster_ag_www_wp',
          status: 'active',
          host: '127.0.0.1',
          port: 3306,
          missingSince: null,
        },
      ],
    });
    expect(detail.permissions).toEqual(['webspace:read']);

    const old = new Date(Date.now() - 120_000);
    await t.db.update(webspaces).set({ lastSyncedAt: old }).where(eq(webspaces.id, row.id));
    demo().sites.get('www.muster-ag.example')!.phpVersion = '8.4';
    const live = json<WebspaceDetailDto>(await anna.get(`/webspaces/${row.id}`));
    expect(live.site?.phpVersion).toBe('8.4');
    expect(new Date(live.lastSyncedAt!).getTime()).toBeGreaterThan(old.getTime());

    await t.db.update(webspaces).set({ lastSyncedAt: old }).where(eq(webspaces.id, row.id));
    DemoCloudPanelAdapter.failNext(
      cp.id,
      'getWebsite',
      new ProviderError('CloudPanel', 'SSH connection failed'),
    );
    const failed = json<WebspaceDetailDto>(await anna.get(`/webspaces/${row.id}`));
    expect(failed.liveError).toBe('CloudPanel: SSH connection failed');
    expect(failed.site?.phpVersion).toBe('8.4');
    expect((await dev.get(`/webspaces/${row.id}`)).statusCode).toBe(404);
  });

  it('offers what the instance and the allowance allow', async () => {
    const options = json<WebsiteOptionsDto>(await anna.get(`/orgs/${musterId}/websites/options`));
    expect(options).toMatchObject({
      allowance: {
        orgId: musterId,
        provider: { id: cp.id, name: 'Demo CloudPanel', location: { city: 'Demo' } },
        maxSites: 5,
        maxDatabases: 10,
        siteTypes: ['php', 'static', 'nodejs'],
        sites: 3,
        databases: 2,
        customers: 0,
      },
      options: {
        // The connection does not offer Node.js, whatever the allowance says.
        types: ['php', 'static'],
        phpVersions: ['8.4', '8.3'],
        defaultPhpVersion: '8.4',
        nodejsVersions: ['20', '22', '24'],
        accessHost: DEMO_CLOUDPANEL_HOST,
        ipv4: [DEMO_CLOUDPANEL_IPV4],
      },
      optionsError: null,
    });
    expect(options.options!.templates.map((t) => t.name)).toEqual(['Generic', 'WordPress', 'WooCommerce']);
    // Without the module there is nothing to read; with it but without an allowance, no options.
    expect((await dev.get(`/orgs/${beispielId}/websites/options`)).statusCode).toBe(403);
    const plain = await newOrg('Ohne Kontingent AG', 'ohne-kontingent-ag', {
      modules: ['servers', 'webhosting'],
    });
    const owner = await newUser('owner@ohne-kontingent.example', plain.id);
    expect(json(await owner.get(`/orgs/${plain.id}/websites/options`))).toEqual({
      allowance: null,
      options: null,
      optionsError: null,
    });
    const refused = await create(owner, plain.id, { domain: 'none.example', type: 'static' });
    expect(refused.statusCode).toBe(409);
    expect(json(refused).error).toMatchObject({
      code: 'no_allowance',
      message: 'This organization has no website allowance',
    });
    DemoCloudPanelAdapter.failNext(cp.id, 'websiteServerOptions', new ProviderError('CloudPanel', 'down'));
    const failing = json<WebsiteOptionsDto>(await anna.get(`/orgs/${musterId}/websites/options`));
    expect(failing).toMatchObject({
      options: null,
      optionsError: 'CloudPanel: down',
      allowance: { maxSites: 5 },
    });
    expect((await dev.get(`/orgs/${musterId}/websites/options`)).statusCode).toBe(404);

    const nodejs = await create(anna, musterId, {
      domain: 'node.muster-ag.ch',
      type: 'nodejs',
      nodejsVersion: '22',
    });
    expect(nodejs.statusCode).toBe(409);
    expect(json(nodejs).error.code).toBe('type_not_allowed');
  });

  it('creates Node.js websites where the instance and the allowance allow them', async () => {
    const node = await newCloudPanelConnection('CloudPanel Node', { nodejs: true });
    const org = await newOrg('Node AG', 'node-ag');
    const owner = await newUser('owner@node.example', org.id);
    const allowance = await put(admin, `/admin/orgs/${org.id}/website-allowance`, {
      providerId: node.id,
      maxSites: 2,
      maxDatabases: 2,
      siteTypes: ['nodejs', 'php'],
    });
    expect(json(allowance)).toMatchObject({ siteTypes: ['php', 'nodejs'], provider: { id: node.id } });
    const options = json<WebsiteOptionsDto>(await owner.get(`/orgs/${org.id}/websites/options`));
    expect(options.options!.types).toEqual(['php', 'nodejs']);

    const result = await created(owner, org.id, {
      domain: 'app.node.example',
      type: 'nodejs',
      nodejsVersion: '24',
    });
    expect(result.website.site).toMatchObject({ type: 'nodejs', nodejsVersion: '24', application: null });
    expect(result.website.site!.appPort).toBeGreaterThan(3000);
    expect(result.access).toMatchObject({ host: DEMO_CLOUDPANEL_HOST, username: 'app-node-example' });
    const missingVersion = await create(owner, org.id, { domain: 'app2.node.example', type: 'nodejs' });
    expect(json(missingVersion).error.details).toEqual([
      { path: 'nodejsVersion', message: 'Choose a Node.js version' },
    ]);
    const oldVersion = await create(owner, org.id, {
      domain: 'app2.node.example',
      type: 'nodejs',
      nodejsVersion: '18',
    });
    expect(json(oldVersion).error.details[0].path).toBe('nodejsVersion');
    const staticSite = await create(owner, org.id, { domain: 'app2.node.example', type: 'static' });
    expect(json(staticSite).error.code).toBe('type_not_allowed');
  });
});

describe('create', () => {
  let blog: WebsiteCreatedDto;

  it('creates a PHP website with a database and shows the passwords once', async () => {
    const res = await create(anna, musterId, {
      domain: 'Blog.Muster-AG.ch',
      type: 'php',
      template: 'WordPress',
      database: { suffix: 'wp' },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    blog = json<WebsiteCreatedDto>(res);
    expect(blog.website).toMatchObject({
      name: 'blog.muster-ag.ch',
      kind: 'website',
      status: 'active',
      org: { id: musterId },
      site: {
        type: 'php',
        application: 'WordPress',
        phpVersion: '8.4',
        siteUser: 'blog-muster-ag-ch',
        databases: 1,
      },
      credentialsPending: false,
    });
    expect(blog.access).toMatchObject({
      host: DEMO_CLOUDPANEL_HOST,
      port: 22,
      username: 'blog-muster-ag-ch',
    });
    expect(blog.access.password).toMatch(/^[A-HJ-NP-Za-km-z2-9]{24}$/);
    expect(blog.database).toMatchObject({
      database: {
        name: 'blog_muster_ag_c_wp',
        userName: 'blog_muster_ag_c_wp',
        status: 'active',
        host: '127.0.0.1',
      },
    });
    expect(blog.database!.password).toMatch(WEBSITE_PASSWORD_PATTERN);
    expect(blog.database!.password).not.toBe(blog.access.password);
    expect(blog.warnings).toEqual([]);

    const row = (await websiteRow('blog.muster-ag.ch'))!;
    expect(row).toMatchObject({ status: 'active', orgId: musterId, meta: { createdBy: expect.any(String) } });
    expect((await databasesOf(row.id)).map((d) => [d.name, d.status])).toEqual([
      ['blog_muster_ag_c_wp', 'active'],
    ]);
    expect(demo().managed.get('blog.muster-ag.ch')).toMatchObject({ siteUser: 'blog-muster-ag-ch' });

    const entry = (await auditEntries('website.create')).find((e) => e.resourceId === row.id);
    expect(entry).toMatchObject({
      status: 'success',
      orgId: musterId,
      resourceType: 'webspace',
      resourceId: row.id,
      details: {
        domain: 'blog.muster-ag.ch',
        type: 'php',
        template: 'WordPress',
        phpVersion: '8.4',
        siteUser: 'blog-muster-ag-ch',
        database: 'blog_muster_ag_c_wp',
        instance: 'Demo CloudPanel',
        password: 'generated',
        databasePassword: 'generated',
        warnings: [],
      },
    });
    const text = await storedText();
    expect(text).not.toContain(blog.access.password!);
    expect(text).not.toContain(blog.database!.password!);
  });

  it('keeps the allowance', async () => {
    await setAllowance(musterId, { maxSites: 4, maxDatabases: 10, siteTypes: ['php', 'static', 'nodejs'] });
    const over = await create(anna, musterId, { domain: 'over.muster-ag.ch', type: 'static' });
    expect(over.statusCode).toBe(409);
    expect(json(over).error).toMatchObject({
      code: 'allowance_exceeded',
      message: 'Your allowance has room for 0 more websites',
      details: { maxSites: 4, sites: 4 },
    });
    expect(await websiteRow('over.muster-ag.ch')).toBeUndefined();
    const failure = (await auditEntries('website.create')).find(
      (e) => e.details?.domain === 'over.muster-ag.ch',
    );
    expect(failure).toMatchObject({ status: 'failure', details: { error: expect.stringContaining('room') } });
    await setAllowance(musterId, { maxSites: 20, maxDatabases: 3, siteTypes: ['php', 'static', 'nodejs'] });
    const noDatabase = await create(anna, musterId, {
      domain: 'over.muster-ag.ch',
      type: 'php',
      database: { suffix: 'db' },
    });
    expect(json(noDatabase).error).toMatchObject({
      code: 'allowance_exceeded',
      details: { maxDatabases: 3 },
    });
    await setAllowance(musterId, { maxSites: 20, maxDatabases: 30, siteTypes: ['php', 'static', 'nodejs'] });

    const huberNode = await create(hanna, huberId, {
      domain: 'node.baeckerei-huber.ch',
      type: 'nodejs',
      nodejsVersion: '22',
    });
    expect(huberNode.statusCode).toBe(409);
    expect(json(huberNode).error.code).toBe('type_not_allowed');
    expect(
      (await auditEntries('website.create')).find((e) => e.details?.domain === 'node.baeckerei-huber.ch'),
    ).toMatchObject({
      orgId: huberId,
      status: 'failure',
      details: { type: 'nodejs', error: 'The website allowance does not include Node.js websites' },
    });
    // Beispiel GmbH has no webhosting module: refused before the allowance is even looked at.
    expect((await create(dev, beispielId, { domain: 'beispiel.example', type: 'static' })).statusCode).toBe(
      403,
    );
  });

  it('refuses viewers, strangers and API tokens without a password', async () => {
    expect(
      (await create(carla, musterId, { domain: 'viewer.muster-ag.ch', type: 'static' })).statusCode,
    ).toBe(403);
    expect((await create(dev, musterId, { domain: 'dev.muster-ag.ch', type: 'static' })).statusCode).toBe(
      404,
    );

    const token = json(
      await anna.post(`/orgs/${musterId}/tokens`, { name: 'site-bot', scope: 'read_write' }),
    ).token;
    const bot = new Client(t.app);
    bot.bearer = token;
    const without = await create(bot, musterId, { domain: 'bot.muster-ag.ch', type: 'static' });
    expect(without.statusCode).toBe(400);
    expect(json(without).error.message).toBe('API tokens cannot receive passwords. Send one.');
    const dbWithout = await create(bot, musterId, {
      domain: 'bot.muster-ag.ch',
      type: 'php',
      password: PASSWORD,
      database: { suffix: 'db' },
    });
    expect(dbWithout.statusCode).toBe(400);
    const withPassword = await created(bot, musterId, {
      domain: 'bot.muster-ag.ch',
      type: 'php',
      password: PASSWORD,
      database: { suffix: 'db', password: `${PASSWORD}x` },
    });
    expect(withPassword.access.password).toBeNull();
    expect(withPassword.database!.password).toBeNull();
    const [entry] = (await auditEntries('website.create')).filter(
      (e) => e.details?.domain === 'bot.muster-ag.ch',
    );
    expect(entry!.details).toMatchObject({ password: 'chosen', databasePassword: 'chosen' });
    expect(await storedText()).not.toContain(PASSWORD);
    // Tokens never set passwords afterwards.
    expect((await bot.post(`/webspaces/${withPassword.website.id}/password`, {})).statusCode).toBe(403);
  });

  it('validates the input', async () => {
    const bad = async (body: Record<string, unknown>, path: string) => {
      const res = await create(anna, musterId, { type: 'static', ...body });
      expect(res.statusCode, res.body).toBe(400);
      expect(json(res).error.details[0].path).toBe(path);
    };
    await bad({ domain: '1.2.3.4' }, 'domain');
    await bad({ domain: 'localhost' }, 'domain');
    await bad({ domain: 'shop.ch/x' }, 'domain');
    await bad({ domain: 'ok.muster-ag.ch', siteUser: 'Root' }, 'siteUser');
    await bad({ domain: 'ok.muster-ag.ch', siteUser: 'weblion-cp' }, 'siteUser');
    await bad({ domain: 'ok.muster-ag.ch', siteUser: 'mysql' }, 'siteUser');
    await bad({ domain: 'ok.muster-ag.ch', password: 'short' }, 'password');
    await bad({ domain: 'ok.muster-ag.ch', password: 'with$dollar-sign1' }, 'password');
    await bad({ domain: 'ok.muster-ag.ch', type: 'python' }, 'type');
    await bad({ domain: 'ok.muster-ag.ch', type: 'php', phpVersion: '7.4' }, 'phpVersion');
    await bad({ domain: 'ok.muster-ag.ch', type: 'php', template: 'Generic; rm -rf /' }, 'template');
    await bad({ domain: 'ok.muster-ag.ch', type: 'php', template: 'Laravel 12' }, 'template');
    await bad({ domain: 'ok.muster-ag.ch', type: 'php', template: 'Nodejs' }, 'template');
    await bad({ domain: 'ok.muster-ag.ch', database: { suffix: '_x' } }, 'database.suffix');
    await bad({ domain: 'ok.muster-ag.ch', database: { suffix: 'a234567890123456' } }, 'database.suffix');
    expect(await websiteRow('ok.muster-ag.ch')).toBeUndefined();
  });

  it('refuses domains that are taken and stores IDN domains as punycode', async () => {
    const taken = await create(anna, musterId, { domain: 'www.muster-ag.example', type: 'static' });
    expect(taken.statusCode).toBe(409);
    expect(json(taken).error).toMatchObject({
      code: 'exists',
      message: 'www.muster-ag.example is already a website on Demo CloudPanel',
      details: { field: 'domain' },
    });
    // One website serves its www counterpart as well.
    const counterpart = await create(anna, musterId, { domain: 'muster-ag.example', type: 'static' });
    expect(json(counterpart).error.message).toContain('serves muster-ag.example as well');
    // The DNS module has the domain for Muster AG.
    const foreign = await create(hanna, huberId, { domain: 'www.muster-ag.ch', type: 'static' });
    expect(foreign.statusCode).toBe(409);
    expect(json(foreign).error).toMatchObject({
      message: 'muster-ag.ch belongs to another customer in the DNS module',
      details: { field: 'domain' },
    });
    // Nor below it: a website there would serve names of Muster AG.
    const below = await create(hanna, huberId, { domain: 'shop.muster-ag.ch', type: 'static' });
    expect(below.statusCode).toBe(409);
    expect(json(below).error).toMatchObject({
      message: 'shop.muster-ag.ch is below muster-ag.ch, which belongs to another customer in the DNS module',
      details: { field: 'domain' },
    });
    // The host customers use for SFTP/SSH (and every name below it) belongs to the platform.
    for (const domain of [
      DEMO_CLOUDPANEL_HOST,
      `www.${DEMO_CLOUDPANEL_HOST}`,
      `shop.${DEMO_CLOUDPANEL_HOST}`,
    ]) {
      const platform = await create(anna, musterId, { domain, type: 'static' });
      expect(platform.statusCode, domain).toBe(409);
      expect(json(platform).error).toMatchObject({
        code: 'exists',
        message: expect.stringContaining(`is a name of the platform (${DEMO_CLOUDPANEL_HOST})`),
        details: { field: 'domain' },
      });
    }
    expect(
      (
        await admin.post('/admin/websites', {
          providerId: cp.id,
          orgId: null,
          domain: DEMO_CLOUDPANEL_HOST,
          type: 'static',
        })
      ).statusCode,
    ).toBe(409);
    expect(await websiteRow(DEMO_CLOUDPANEL_HOST)).toBeUndefined();
    // The console's own host too; IP addresses and names without a dot are no domains.
    expect(() => assertNotPlatformName('x.cp.weblion.cloud', ['cp.weblion.cloud'])).toThrow(/platform/);
    expect(() => assertNotPlatformName('weblion.cloud', ['www.weblion.cloud'])).toThrow(/platform/);
    expect(() =>
      assertNotPlatformName('shop.example.ch', [
        'localhost',
        '203.0.113.10',
        null,
        undefined,
        'example.ch.x',
      ]),
    ).not.toThrow();
    // The server refuses a Linux user that exists: nothing is kept.
    const user = await create(anna, musterId, {
      domain: 'legacy.muster-ag.ch',
      type: 'static',
      siteUser: 'legacy',
    });
    expect(user.statusCode).toBe(409);
    expect(json(user).error.details).toEqual({ field: 'siteUser' });
    expect(await websiteRow('legacy.muster-ag.ch')).toBeUndefined();

    const idn = await created(anna, musterId, { domain: 'Müller-Shop.ch', type: 'static' });
    const ascii = websiteDomainAscii('müller-shop.ch')!;
    expect(ascii).toMatch(/^xn--/);
    expect(idn.website.name).toBe('müller-shop.ch');
    expect((await websiteRow(ascii))!.externalId).toBe(ascii);
    expect(demo().sites.has(ascii)).toBe(true);
    expect(idn.access.username).toBe(suggestSiteUser(ascii));
  });

  it('gives the slot back when the server rolled back, and keeps unknown outcomes for the sync', async () => {
    const before = (await websiteRows()).length;
    DemoCloudPanelAdapter.failNext(
      cp.id,
      'createWebsite',
      new ProviderError('CloudPanel', 'clpctl site:add:php failed', undefined, {
        rolledBack: true,
        output: 'x',
      }),
    );
    const rolledBack = await create(anna, musterId, {
      domain: 'rb.muster-ag.ch',
      type: 'php',
      database: { suffix: 'db' },
    });
    expect(rolledBack.statusCode).toBe(502);
    expect(json(rolledBack).error.details).toEqual({ rolledBack: true, output: 'x' });
    expect(await websiteRow('rb.muster-ag.ch')).toBeUndefined();
    expect(
      await t.db.query.webspaceDatabases.findFirst({
        where: eq(webspaceDatabases.name, 'rb_muster_ag_ch_db'),
      }),
    ).toBeUndefined();
    expect((await websiteRows()).length).toBe(before);

    // The answer got lost after the server created the site.
    DemoCloudPanelAdapter.failNext(cp.id, 'createWebsite', timeout(), { afterEffect: true });
    const lost = await create(anna, musterId, {
      domain: 'lost.muster-ag.ch',
      type: 'php',
      database: { suffix: 'db' },
    });
    expect(lost.statusCode).toBe(502);
    expect(json(lost).error).toMatchObject({
      code: 'website_error',
      message: 'The website may have been created; the next sync shows it. Set a new password to get access.',
      details: { rolledBack: false },
    });
    const row = (await websiteRow('lost.muster-ag.ch'))!;
    expect(row).toMatchObject({
      status: 'error',
      meta: { credentialsDelivered: false, lastError: expect.any(String) },
    });
    expect((await databasesOf(row.id)).map((d) => d.status)).toEqual(['error']);
    const pending = json<WebspaceDetailDto>(await anna.get(`/webspaces/${row.id}`));
    expect(pending).toMatchObject({ status: 'error', credentialsPending: true });
    const notYet = await anna.post(`/webspaces/${row.id}/password`, {});
    expect(json(notYet).error.code).toBe('website_error');

    await sync();
    const settled = (await websiteRow('lost.muster-ag.ch'))!;
    expect(settled.status).toBe('active');
    expect(settled.meta).toEqual({ createdBy: expect.any(String), credentialsDelivered: false });
    expect(settled.info?.site?.siteUser).toBe('lost-muster-ag-ch');
    expect((await databasesOf(row.id)).map((d) => [d.name, d.status])).toEqual([
      ['lost_muster_ag_c_db', 'active'],
    ]);
    const reset = await anna.post(`/webspaces/${row.id}/password`, {});
    expect(reset.statusCode, reset.body).toBe(200);
    const after = json<WebspaceDetailDto>(await anna.get(`/webspaces/${row.id}`));
    expect(after).toMatchObject({ status: 'active', credentialsPending: false });

    // The server never got the request: the sync removes the row once it is old enough.
    DemoCloudPanelAdapter.failNext(cp.id, 'createWebsite', timeout());
    expect((await create(anna, musterId, { domain: 'never.muster-ag.ch', type: 'static' })).statusCode).toBe(
      502,
    );
    const never = (await websiteRow('never.muster-ag.ch'))!;
    expect(never.status).toBe('error');
    await sync();
    expect(await websiteRow('never.muster-ag.ch')).toBeDefined();
    const old = new Date(Date.now() - 11 * 60_000);
    await t.db.update(webspaces).set({ createdAt: old, updatedAt: old }).where(eq(webspaces.id, never.id));
    await sync();
    expect(await websiteRow('never.muster-ag.ch')).toBeUndefined();
  });

  it('keeps the site when only its database failed', async () => {
    const result = await created(anna, musterId, {
      domain: 'partial.muster-ag.ch',
      type: 'php',
      database: { suffix: 'fail' },
    });
    expect(result.database).toBeNull();
    expect(result.warnings).toEqual([expect.stringContaining('could not be created')]);
    const row = (await websiteRow('partial.muster-ag.ch'))!;
    expect(await databasesOf(row.id)).toEqual([]);
  });
});

describe('passwords', () => {
  it('sets a generated or chosen password for the site user', async () => {
    const row = (await websiteRow('shop.muster-ag.example'))!;
    const res = await anna.post(`/webspaces/${row.id}/password`, {});
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const generated = json<WebsiteCredentialsDto>(res);
    expect(generated).toMatchObject({
      host: DEMO_CLOUDPANEL_HOST,
      port: 22,
      username: 'shop-muster-ag-example',
    });
    expect(generated.password).toHaveLength(24);
    const chosen = json<WebsiteCredentialsDto>(
      await anna.post(`/webspaces/${row.id}/password`, { password: PASSWORD }),
    );
    expect(chosen.password).toBe(PASSWORD);
    const entries = await auditEntries('website.password_reset');
    expect(entries.map((e) => e.details?.password)).toContain('chosen');
    expect(await storedText()).not.toContain(generated.password!);

    const dollar = await anna.post(`/webspaces/${row.id}/password`, { password: 'Abcd1234$XYZabc' });
    expect(dollar.statusCode).toBe(400);
    expect((await carla.post(`/webspaces/${row.id}/password`, {})).statusCode).toBe(403);
    expect((await dev.post(`/webspaces/${row.id}/password`, {})).statusCode).toBe(404);

    DemoCloudPanelAdapter.failNext(
      cp.id,
      'setWebsitePassword',
      new ProviderError('CloudPanel', 'chpasswd failed'),
    );
    expect((await anna.post(`/webspaces/${row.id}/password`, {})).statusCode).toBe(502);
    expect((await auditEntries('website.password_reset')).filter((e) => e.status === 'failure')).toHaveLength(
      1,
    );
  });

  it('refuses websites that are missing on the server', async () => {
    const row = (await websiteRow('api.muster-ag.example'))!;
    await t.db.update(webspaces).set({ missingSince: new Date() }).where(eq(webspaces.id, row.id));
    const res = await anna.post(`/webspaces/${row.id}/password`, {});
    expect(res.statusCode).toBe(409);
    expect(json(res).error.code).toBe('website_missing');
    await t.db.update(webspaces).set({ missingSince: null }).where(eq(webspaces.id, row.id));
  });
});

describe('databases', () => {
  it('adds a database inside the allowance and shows its password once', async () => {
    const row = (await websiteRow('www.muster-ag.example'))!;
    const res = await anna.post(`/webspaces/${row.id}/databases`, { suffix: 'shop' });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const result = json<WebsiteDatabaseSecretDto>(res);
    expect(result.database).toMatchObject({ name: 'muster_ag_www_shop', status: 'active', port: 3306 });
    expect(result.password).toHaveLength(24);
    expect((await databasesOf(row.id)).map((d) => d.name)).toEqual([
      'muster_ag_www_shop',
      'muster_ag_www_wp',
    ]);
    expect(
      demo()
        .sites.get('www.muster-ag.example')!
        .databases.map((d) => d.name),
    ).toContain('muster_ag_www_shop');
    expect(await storedText()).not.toContain(result.password!);

    const twice = await anna.post(`/webspaces/${row.id}/databases`, { suffix: 'shop' });
    expect(twice.statusCode).toBe(409);
    expect(json(twice).error).toMatchObject({ code: 'exists', details: { field: 'database' } });

    const allowance = json<WebsiteAllowanceDto>(await admin.get(`/admin/orgs/${musterId}/website-allowance`));
    await setAllowance(musterId, {
      maxSites: 20,
      maxDatabases: allowance.databases,
      siteTypes: ['php', 'static'],
    });
    const full = await anna.post(`/webspaces/${row.id}/databases`, { suffix: 'more' });
    expect(json(full).error.code).toBe('allowance_exceeded');
    // Staff are not held by the allowance.
    expect((await admin.post(`/webspaces/${row.id}/databases`, { suffix: 'staff' })).statusCode).toBe(201);
    await setAllowance(musterId, { maxSites: 20, maxDatabases: 30, siteTypes: ['php', 'static', 'nodejs'] });

    // The server rolls back a failed database: nothing stays behind.
    const failed = await anna.post(`/webspaces/${row.id}/databases`, { suffix: 'fail' });
    expect(failed.statusCode).toBe(502);
    expect((await databasesOf(row.id)).map((d) => d.name)).not.toContain('muster_ag_www_fail');
    expect((await carla.post(`/webspaces/${row.id}/databases`, { suffix: 'viewer' })).statusCode).toBe(403);
    expect((await anna.post(`/webspaces/${row.id}/databases`, { suffix: 'Bad-Name' })).statusCode).toBe(400);
  });

  it('sets database passwords and deletes databases of this website only', async () => {
    const row = (await websiteRow('www.muster-ag.example'))!;
    const shop = (await websiteRow('shop.muster-ag.example'))!;
    const [shopDatabase] = await databasesOf(shop.id);
    const database = (await databasesOf(row.id)).find((d) => d.name === 'muster_ag_www_shop')!;

    const reset = await anna.post(`/webspaces/${row.id}/databases/${database.id}/password`, {});
    expect(reset.statusCode, reset.body).toBe(200);
    expect(reset.headers['cache-control']).toBe('no-store');
    expect(json<WebsiteDatabaseSecretDto>(reset)).toMatchObject({ database: { name: 'muster_ag_www_shop' } });
    expect(json<WebsiteDatabaseSecretDto>(reset).password).toHaveLength(24);
    const [entry] = await auditEntries('website.db_password_reset');
    expect(entry!.details).toMatchObject({ database: 'muster_ag_www_shop', userName: 'muster_ag_www_shop' });
    expect(
      (await anna.post(`/webspaces/${row.id}/databases/${shopDatabase!.id}/password`, {})).statusCode,
    ).toBe(404);

    expect(
      (await anna.del(`/webspaces/${row.id}/databases/${shopDatabase!.id}`, { confirm: shopDatabase!.name }))
        .statusCode,
    ).toBe(404);
    const wrong = await anna.del(`/webspaces/${row.id}/databases/${database.id}`, {
      confirm: 'muster_ag_www_wp',
    });
    expect(wrong.statusCode).toBe(400);
    expect(json(wrong).error.details[0].path).toBe('confirm');
    const deleted = await anna.del(`/webspaces/${row.id}/databases/${database.id}`, {
      confirm: database.name,
    });
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect((await databasesOf(row.id)).map((d) => d.name)).not.toContain('muster_ag_www_shop');
    expect(
      demo()
        .sites.get('www.muster-ag.example')!
        .databases.map((d) => d.name),
    ).not.toContain('muster_ag_www_shop');
    expect(await auditEntries('website.db_delete')).toHaveLength(1);

    // A database already gone on the server is removed here as well.
    const staff = (await databasesOf(row.id)).find((d) => d.name === 'muster_ag_www_staff')!;
    const site = demo().sites.get('www.muster-ag.example')!;
    site.databases = site.databases.filter((d) => d.name !== staff.name);
    const gone = await anna.del(`/webspaces/${row.id}/databases/${staff.id}`, { confirm: staff.name });
    expect(gone.statusCode, gone.body).toBe(200);
    expect(
      await t.db.query.webspaceDatabases.findFirst({ where: eq(webspaceDatabases.id, staff.id) }),
    ).toBeUndefined();
  });
});

describe('certificate and DNS', () => {
  it('checks DNS before issuing and issues anyway on request', async () => {
    const site = await created(anna, musterId, { domain: 'nodns.muster-ag.ch', type: 'static' });
    const check = json<WebsiteDnsCheckDto>(await anna.get(`/webspaces/${site.website.id}/dns-check`));
    expect(check).toMatchObject({
      expected: { ipv4: [DEMO_CLOUDPANEL_IPV4] },
      names: [
        { name: 'nodns.muster-ag.ch', a: [], aaaa: [], status: 'missing' },
        { name: 'www.nodns.muster-ag.ch', status: 'missing' },
      ],
      ready: false,
      panelDomain: null,
    });
    const refused = await anna.post(`/webspaces/${site.website.id}/certificate`, {});
    expect(refused.statusCode).toBe(409);
    expect(json(refused).error).toMatchObject({
      code: 'dns_not_ready',
      details: { ready: false, names: [{ status: 'missing' }, { status: 'missing' }] },
    });
    const forced = await anna.post(`/webspaces/${site.website.id}/certificate`, { force: true });
    expect(forced.statusCode).toBe(502);
    expect(json(forced).error.message).toContain('DNS problem: NXDOMAIN');
    const entries = await auditEntries('website.certificate');
    expect(entries.map((e) => [e.status, e.details?.force])).toEqual([
      ['failure', false],
      ['failure', true],
    ]);
    expect((await carla.post(`/webspaces/${site.website.id}/certificate`, {})).statusCode).toBe(403);
  });

  it('issues a certificate when DNS points to the server and links the DNS module', async () => {
    const shop = (await websiteRow('shop.muster-ag.example'))!;
    const check = json<WebsiteDnsCheckDto>(await carla.get(`/webspaces/${shop.id}/dns-check`));
    expect(check.ready).toBe(true);
    const res = await anna.post(`/webspaces/${shop.id}/certificate`, {});
    expect(res.statusCode, res.body).toBe(200);
    const detail = json<WebspaceDetailDto>(res);
    expect(detail.site!.certificate).toMatchObject({ letsEncrypt: true });
    const days = (Date.parse(detail.site!.certificate!.expiresAt!) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(80);
    expect((await auditEntries('website.certificate')).at(-1)).toMatchObject({
      status: 'success',
      details: { force: false, dnsReady: true },
    });

    // The website's www counterpart is a domain of Muster AG in the DNS module.
    const linked = await created(anna, musterId, { domain: 'www.muster-ag.ch', type: 'static' });
    const withDomain = json<WebsiteDnsCheckDto>(await anna.get(`/webspaces/${linked.website.id}/dns-check`));
    expect(withDomain).toMatchObject({ ready: true, panelDomain: { name: 'muster-ag.ch' } });
    expect((await hanna.get(`/webspaces/${linked.website.id}/dns-check`)).statusCode).toBe(404);
  });
});

describe('delete', () => {
  it('needs the domain typed and no active billing service', async () => {
    const site = await created(anna, musterId, {
      domain: 'old.muster-ag.ch',
      type: 'php',
      database: { suffix: 'db' },
    });
    const id = site.website.id;
    const wrong = await anna.del(`/webspaces/${id}`, { confirm: 'other.muster-ag.ch' });
    expect(wrong.statusCode).toBe(400);
    expect(json(wrong).error.details[0].path).toBe('confirm');
    expect((await carla.del(`/webspaces/${id}`, { confirm: 'old.muster-ag.ch' })).statusCode).toBe(403);

    const [service] = await t.db
      .insert(services)
      .values({
        orgId: musterId,
        name: 'Website S',
        resourceType: 'webspace',
        resourceId: id,
        unitPrice: 900,
        interval: 'monthly',
        startsAt: '2026-01-01',
      })
      .returning();
    const billed = await anna.del(`/webspaces/${id}`, { confirm: 'old.muster-ag.ch' });
    expect(billed.statusCode).toBe(409);
    expect(json(billed).error.message).toContain('"Website S"');
    await t.db.update(services).set({ status: 'cancelled' }).where(eq(services.id, service!.id));

    const res = await anna.del(`/webspaces/${id}`, { confirm: 'OLD.muster-ag.ch' });
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res)).toEqual({ ok: true, warnings: [] });
    expect(await websiteRow('old.muster-ag.ch')).toBeUndefined();
    expect(await databasesOf(id)).toEqual([]);
    expect(demo().sites.has('old.muster-ag.ch')).toBe(false);
    expect((await auditEntries('website.delete')).at(-1)).toMatchObject({
      status: 'success',
      resourceId: id,
      details: { domain: 'old.muster-ag.ch', warnings: [] },
    });
  });

  it('removes rows the server no longer manages, and keeps timeouts for the sync', async () => {
    const forgotten = await created(anna, musterId, { domain: 'forgotten.muster-ag.ch', type: 'static' });
    // Deleted in the CloudPanel UI meanwhile: the server no longer manages it.
    demo().managed.delete('forgotten.muster-ag.ch');
    demo().sites.delete('forgotten.muster-ag.ch');
    const res = await anna.del(`/webspaces/${forgotten.website.id}`, { confirm: 'forgotten.muster-ag.ch' });
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res).warnings).toEqual([expect.stringContaining('not managed')]);
    expect(await websiteRow('forgotten.muster-ag.ch')).toBeUndefined();

    const slow = await created(anna, musterId, { domain: 'slow.muster-ag.ch', type: 'static' });
    DemoCloudPanelAdapter.failNext(cp.id, 'deleteWebsite', timeout(), { afterEffect: true });
    expect(
      (await anna.del(`/webspaces/${slow.website.id}`, { confirm: 'slow.muster-ag.ch' })).statusCode,
    ).toBe(504);
    expect((await websiteRow('slow.muster-ag.ch'))!.status).toBe('error');
    // Customers wait for the sync; staff may clear it.
    const customer = await anna.del(`/webspaces/${slow.website.id}`, { confirm: 'slow.muster-ag.ch' });
    expect(json(customer).error.code).toBe('website_error');
    const staff = await admin.del(`/webspaces/${slow.website.id}`, { confirm: 'slow.muster-ag.ch' });
    expect(staff.statusCode, staff.body).toBe(200);
    expect(await websiteRow('slow.muster-ag.ch')).toBeUndefined();

    const busy = await created(anna, musterId, { domain: 'busy.muster-ag.ch', type: 'static' });
    DemoCloudPanelAdapter.failNext(cp.id, 'deleteWebsite', new AppError(503, 'busy', 'The server is busy'));
    expect(
      (await anna.del(`/webspaces/${busy.website.id}`, { confirm: 'busy.muster-ag.ch' })).statusCode,
    ).toBe(503);
    expect((await websiteRow('busy.muster-ag.ch'))!.status).toBe('active');
    expect((await auditEntries('website.delete')).filter((e) => e.status === 'failure')).toHaveLength(2);
  });

  it('leaves a delete whose answer was lost to the sync, and keeps refused ones', async () => {
    const staffCreated = async (domain: string) => {
      const res = await admin.post('/admin/websites', {
        providerId: cp.id,
        orgId: musterId,
        domain,
        type: 'static',
      });
      expect(res.statusCode, res.body).toBe(201);
      return json<WebsiteCreatedDto>(res).website.id;
    };
    const old = new Date(Date.now() - 11 * 60_000);
    // The connection dropped after the server deleted the site.
    const dropped = await staffCreated('dropped.muster-ag.ch');
    DemoCloudPanelAdapter.failNext(
      cp.id,
      'deleteWebsite',
      new ProviderError('CloudPanel', 'The connection to web1 ended before the agent answered.'),
      { afterEffect: true },
    );
    const res = await anna.del(`/webspaces/${dropped}`, { confirm: 'dropped.muster-ag.ch' });
    expect(res.statusCode).toBe(502);
    expect(await websiteRow('dropped.muster-ag.ch')).toMatchObject({
      status: 'error',
      meta: { lastError: expect.stringContaining('ended before the agent answered') },
    });
    expect(demo().sites.has('dropped.muster-ag.ch')).toBe(false);
    await t.db.update(webspaces).set({ createdAt: old, updatedAt: old }).where(eq(webspaces.id, dropped));
    await sync();
    expect(await websiteRow('dropped.muster-ag.ch')).toBeUndefined();

    // A refusal left the site as it was.
    const kept = await staffCreated('kept.muster-ag.ch');
    DemoCloudPanelAdapter.failNext(
      cp.id,
      'deleteWebsite',
      new AppError(409, 'protected', 'kept.muster-ag.ch is on the protected list of this server'),
    );
    expect((await anna.del(`/webspaces/${kept}`, { confirm: 'kept.muster-ag.ch' })).statusCode).toBe(409);
    expect((await websiteRow('kept.muster-ag.ch'))!.status).toBe('active');

    // Databases alike.
    const added = await admin.post(`/webspaces/${kept}/databases`, { suffix: 'x' });
    expect(added.statusCode, added.body).toBe(201);
    const database = json<WebsiteDatabaseSecretDto>(added).database;
    DemoCloudPanelAdapter.failNext(cp.id, 'deleteWebsiteDatabase', new AppError(503, 'busy', 'busy'));
    const busy = await anna.del(`/webspaces/${kept}/databases/${database.id}`, { confirm: database.name });
    expect(busy.statusCode).toBe(503);
    expect((await databasesOf(kept)).map((d) => d.status)).toEqual(['active']);
    DemoCloudPanelAdapter.failNext(
      cp.id,
      'deleteWebsiteDatabase',
      new ProviderError('CloudPanel', 'The connection to web1 ended before the agent answered.'),
      { afterEffect: true },
    );
    const lost = await anna.del(`/webspaces/${kept}/databases/${database.id}`, { confirm: database.name });
    expect(lost.statusCode).toBe(502);
    expect((await databasesOf(kept)).map((d) => d.status)).toEqual(['error']);
    await t.db
      .update(webspaceDatabases)
      .set({ createdAt: old, updatedAt: old })
      .where(eq(webspaceDatabases.id, database.id));
    await sync();
    expect(await databasesOf(kept)).toEqual([]);
  });
});

describe('admin', () => {
  it('creates websites for any organization without allowance, and unassigned ones', async () => {
    const res = await admin.post('/admin/websites', {
      providerId: cp.id,
      orgId: beispielId,
      domain: 'app.beispiel.example',
      type: 'php',
      template: 'Laravel 12',
      phpVersion: '8.3',
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const result = json<WebsiteCreatedDto>(res);
    expect(result.website).toMatchObject({
      org: { id: beispielId },
      site: { application: 'Laravel 12', phpVersion: '8.3' },
    });
    expect((await orgBySlug('beispiel-gmbh')).modules).toContain('webhosting');
    const entry = (await auditEntries('website.create')).find((e) => e.resourceId === result.website.id);
    expect(entry!.details).toMatchObject({ moduleEnabled: 'webhosting', template: 'Laravel 12' });

    const unassigned = json<WebsiteCreatedDto>(
      await admin.post('/admin/websites', {
        providerId: cp.id,
        orgId: null,
        domain: 'spare.example',
        type: 'nodejs',
        nodejsVersion: '22',
      }),
    );
    expect(unassigned.website).toMatchObject({ org: null, site: { type: 'nodejs' } });
    expect(
      (
        await anna.post('/admin/websites', {
          providerId: cp.id,
          orgId: musterId,
          domain: 'x.example',
          type: 'static',
        })
      ).statusCode,
    ).toBe(403);
    const demoMain = (await t.db.query.providerConnections.findFirst({
      where: eq(providerConnections.envKey, 'demo'),
    }))!;
    const noWebsites = await admin.post('/admin/websites', {
      providerId: demoMain.id,
      orgId: null,
      domain: 'y.example',
      type: 'static',
    });
    expect(noWebsites.statusCode).toBe(422);
  });

  it('offers staff every application and type of the server', async () => {
    const res = await admin.get(`/admin/providers/${cp.id}/websites/options`);
    expect(res.statusCode, res.body).toBe(200);
    const options = json<WebsiteServerOptions>(res);
    // Node.js because the server allows it (the connection offers customers no Node.js).
    expect(options.types).toEqual(['php', 'static', 'nodejs']);
    expect(options.templates.map((tpl) => tpl.name)).toEqual([
      'Generic',
      'WordPress',
      'WooCommerce',
      'Laravel 12',
    ]);
    expect(options.phpVersions).toEqual(['8.4', '8.3']);
    expect(options.accessHost).toBe(DEMO_CLOUDPANEL_HOST);
    expect((await anna.get(`/admin/providers/${cp.id}/websites/options`)).statusCode).toBe(403);
    const demoMain = (await t.db.query.providerConnections.findFirst({
      where: eq(providerConnections.envKey, 'demo'),
    }))!;
    expect((await admin.get(`/admin/providers/${demoMain.id}/websites/options`)).statusCode).toBe(422);
  });

  it('lists unmanaged sites, adopts one and forgets unassigned ones', async () => {
    const unmanaged = json<UnmanagedWebsitesDto>(
      await admin.get(`/admin/providers/${cp.id}/websites/unmanaged`),
    );
    expect(unmanaged).toEqual({
      allowRemoteAdopt: true,
      sites: [
        { domain: 'cp.weblion.demo', type: 'nodejs', siteUser: 'weblion-cp', protected: true },
        { domain: 'legacy.kunde.example', type: 'php', siteUser: 'legacy', protected: false },
      ],
    });
    expect((await anna.get(`/admin/providers/${cp.id}/websites/unmanaged`)).statusCode).toBe(403);

    const protectedSite = await admin.post(`/admin/providers/${cp.id}/websites/adopt`, {
      domain: 'cp.weblion.demo',
    });
    expect(protectedSite.statusCode).toBe(409);
    expect(json(protectedSite).error.code).toBe('protected');
    const adopted = await admin.post(`/admin/providers/${cp.id}/websites/adopt`, {
      domain: 'Legacy.Kunde.Example',
    });
    expect(adopted.statusCode, adopted.body).toBe(200);
    expect(json<WebspaceDto>(adopted)).toMatchObject({
      name: 'legacy.kunde.example',
      org: null,
      kind: 'website',
      status: 'active',
    });
    const row = (await websiteRow('legacy.kunde.example'))!;
    expect((await databasesOf(row.id)).map((d) => d.name)).toEqual(['legacy_web']);
    const adoptions = await auditEntries('website.adopt');
    expect(adoptions.map((e) => [e.status, e.details?.domain])).toEqual([
      ['failure', 'cp.weblion.demo'],
      ['success', 'legacy.kunde.example'],
    ]);
    expect(adoptions[1]).toMatchObject({ resourceId: row.id, details: { siteUser: 'legacy' } });

    const assigned = (await websiteRow('www.muster-ag.example'))!;
    const refused = await admin.post(`/admin/webspaces/${assigned.id}/forget`);
    expect(refused.statusCode).toBe(409);
    expect(json(refused).error.message).toContain('Unassign it first');
    const forgot = await admin.post(`/admin/webspaces/${row.id}/forget`);
    expect(forgot.statusCode, forgot.body).toBe(200);
    expect(await websiteRow('legacy.kunde.example')).toBeUndefined();
    expect(demo().managed.has('legacy.kunde.example')).toBe(false);
    expect(demo().sites.has('legacy.kunde.example')).toBe(true);
    expect(await auditEntries('website.forget')).toHaveLength(1);
    // Web spaces of other providers are no websites.
    const plain = (await t.db.query.webspaces.findFirst({ where: eq(webspaces.kind, 'webspace') }))!;
    expect((await admin.post(`/admin/webspaces/${plain.id}/forget`)).statusCode).toBe(404);
  });
});

describe('reseller', () => {
  async function poolSite(domain: string) {
    const res = await admin.post('/admin/websites', {
      providerId: cp.id,
      orgId: alpenId,
      domain,
      type: 'static',
    });
    expect(res.statusCode, res.body).toBe(201);
    return json<WebsiteCreatedDto>(res).website.id;
  }
  const move = (id: string, customerId = huberId) =>
    reto.post(`/orgs/${alpenId}/customers/${customerId}/resources`, { type: 'webspace', id });

  it('moves websites to customers inside their allowance and back', async () => {
    // Huber: 3 sites allowed, 1 in use.
    const first = await poolSite('one.alpen.example');
    const second = await poolSite('two.alpen.example');
    const third = await poolSite('three.alpen.example');
    expect((await move(first)).statusCode).toBe(200);
    expect((await move(second)).statusCode).toBe(200);
    const full = await move(third);
    expect(full.statusCode).toBe(409);
    expect(json(full).error).toMatchObject({
      code: 'allowance_exceeded',
      details: { maxSites: 3, sites: 3 },
    });
    expect((await websiteRow('three.alpen.example'))!.orgId).toBe(alpenId);

    const release = await reto.post(`/orgs/${alpenId}/customers/${huberId}/resources/release`, {
      type: 'webspace',
      id: first,
    });
    expect(release.statusCode, release.body).toBe(200);
    expect((await websiteRow('one.alpen.example'))!.orgId).toBe(alpenId);
    expect((await move(third)).statusCode).toBe(200);

    const bare = await newOrg('Ohne Kontingent', 'ohne-kontingent', { parentOrgId: alpenId });
    const none = await move(first, bare.id);
    expect(none.statusCode).toBe(409);
    expect(json(none).error.code).toBe('no_allowance');
  });

  it('sets customer allowances within its own', async () => {
    const url = `/reseller/customers/${huberId}/website-allowance`;
    const current = json<WebsiteAllowanceDto>(await reto.get(url));
    expect(current).toMatchObject({ maxSites: 3, sites: 3, provider: { id: cp.id } });

    const raised = await put(reto, url, { maxSites: 5, maxDatabases: 10, siteTypes: ['static', 'php'] });
    expect(raised.statusCode, raised.body).toBe(200);
    expect(json(raised)).toMatchObject({ maxSites: 5, siteTypes: ['php', 'static'] });
    const alpen = json<WebsiteAllowanceDto>(await admin.get(`/admin/orgs/${alpenId}/website-allowance`));
    // Its own pool website plus what Huber got.
    expect(alpen).toMatchObject({ maxSites: 20, sites: 1 + 5, databases: 10, customers: 1 });

    const tooMuch = await put(reto, url, { maxSites: 20, maxDatabases: 10, siteTypes: ['php'] });
    expect(json(tooMuch).error).toMatchObject({ code: 'allowance_exceeded' });
    expect(json(tooMuch).error.message).toContain('Only 19 websites');
    const nodejs = await put(reto, url, { maxSites: 5, maxDatabases: 10, siteTypes: ['php', 'nodejs'] });
    expect(json(nodejs).error.code).toBe('type_not_allowed');
    const below = await put(reto, url, { maxSites: 2, maxDatabases: 10, siteTypes: ['php'] });
    expect(json(below).error.code).toBe('allowance_exceeded');
    expect((await reto.del(url)).statusCode).toBe(409);
    expect((await hanna.get(url)).statusCode).toBe(404);
    expect(
      (
        await put(reto, `/admin/orgs/${huberId}/website-allowance`, {
          providerId: cp.id,
          maxSites: 1,
          maxDatabases: 1,
          siteTypes: ['php'],
        })
      ).statusCode,
    ).toBe(403);

    const fresh = await newOrg('Neu GmbH', 'neu-gmbh', { parentOrgId: alpenId });
    const freshUrl = `/reseller/customers/${fresh.id}/website-allowance`;
    expect(json(await reto.get(freshUrl))).toBeNull();
    const set = await put(reto, freshUrl, { maxSites: 1, maxDatabases: 1, siteTypes: ['static'] });
    expect(set.statusCode, set.body).toBe(200);
    expect((await orgBySlug('neu-gmbh')).modules).toContain('webhosting');
    expect((await reto.del(freshUrl)).statusCode).toBe(200);
    expect(json(await reto.get(freshUrl))).toBeNull();
    const sets = await auditEntries('reseller.website_allowance_set');
    expect(sets.filter((e) => e.status === 'success').map((e) => e.orgId)).toEqual([alpenId, alpenId]);
    // The three refused changes are audited on the reseller with the reason.
    const refused = sets.filter((e) => e.status === 'failure');
    expect(refused.map((e) => e.orgId)).toEqual([alpenId, alpenId, alpenId]);
    expect(refused.map((e) => e.details?.error)).toEqual([
      expect.stringContaining('Only 19 websites'),
      expect.stringContaining('nodejs'),
      expect.stringContaining('cannot be lower'),
    ]);
    const deletes = await auditEntries('reseller.website_allowance_delete');
    expect(deletes.map((e) => e.status)).toEqual(['failure', 'success']);
  });
});

describe('reseller release', () => {
  it('keeps a released website inside the reseller allowance', async () => {
    const berg = await newOrg('Berg Hosting', 'berg-hosting', {
      kind: 'reseller',
      modules: ['servers', 'webhosting'],
    });
    await t.db
      .update(organizations)
      .set({ boundary: DEFAULT_RESELLER_BOUNDARY })
      .where(eq(organizations.id, berg.id));
    const bergUser = await newUser('reseller@berg.example', berg.id);
    const kunde = await newOrg('Kunde Eins', 'kunde-eins', { parentOrgId: berg.id, modules: ['servers'] });
    const kundeUser = await newUser('kunde@eins.example', kunde.id);
    await setAllowance(berg.id, { maxSites: 3, maxDatabases: 2, siteTypes: ['php', 'static'] });
    await setAllowance(kunde.id, { maxSites: 3, maxDatabases: 2, siteTypes: ['php', 'static'] });
    const ids: string[] = [];
    for (const domain of ['a.kunde-eins.example', 'b.kunde-eins.example', 'c.kunde-eins.example']) {
      const res = await admin.post('/admin/websites', {
        providerId: cp.id,
        orgId: kunde.id,
        domain,
        type: 'php',
        ...(domain.startsWith('a.') ? { database: { suffix: 'wp' } } : {}),
      });
      expect(res.statusCode, res.body).toBe(201);
      ids.push(json<WebsiteCreatedDto>(res).website.id);
    }
    const release = (id: string) =>
      bergUser.post(`/orgs/${berg.id}/customers/${kunde.id}/resources/release`, { type: 'webspace', id });
    const allowanceOf = async (orgId: string) =>
      json<WebsiteAllowanceDto>(await admin.get(`/admin/orgs/${orgId}/website-allowance`));

    // Berg handed its whole allowance to the customer: each website takes its slot along.
    for (const id of ids) {
      const res = await release(id);
      expect(res.statusCode, res.body).toBe(200);
    }
    expect(await allowanceOf(kunde.id)).toMatchObject({
      maxSites: 0,
      maxDatabases: 1,
      sites: 0,
      databases: 0,
    });
    expect(await allowanceOf(berg.id)).toMatchObject({
      maxSites: 3,
      sites: 3,
      maxDatabases: 2,
      databases: 2,
    });
    const entry = (await auditEntries('reseller.resource_release')).find((e) => e.resourceId === ids[0]);
    expect(entry!.details).toMatchObject({ customerWebsiteAllowance: { maxSites: 2, maxDatabases: 1 } });
    // The customer cannot fill the slots again.
    const again = await create(kundeUser, kunde.id, { domain: 'd.kunde-eins.example', type: 'static' });
    expect(json(again).error.code).toBe('allowance_exceeded');

    // A website without a slot in the customer's allowance does not fit the full reseller.
    const extra = await admin.post('/admin/websites', {
      providerId: cp.id,
      orgId: kunde.id,
      domain: 'e.kunde-eins.example',
      type: 'static',
    });
    const extraId = json<WebsiteCreatedDto>(extra).website.id;
    const refused = await release(extraId);
    expect(refused.statusCode).toBe(409);
    expect(json(refused).error).toMatchObject({
      code: 'allowance_exceeded',
      details: { maxSites: 3, sites: 3 },
    });
    expect((await websiteRow('e.kunde-eins.example'))!.orgId).toBe(kunde.id);
    // With room left the customer keeps its allowance.
    await setAllowance(berg.id, { maxSites: 4, maxDatabases: 2, siteTypes: ['php', 'static'] });
    expect((await release(extraId)).statusCode).toBe(200);
    expect(await allowanceOf(kunde.id)).toMatchObject({ maxSites: 0, maxDatabases: 1 });
    expect(await allowanceOf(berg.id)).toMatchObject({ maxSites: 4, sites: 4 });
  });
});

describe('providers and suspension', () => {
  it('refuses to delete a provider a website allowance points to', async () => {
    const connection = await newCloudPanelConnection('CloudPanel Spare', {});
    const org = await newOrg('Spare AG', 'spare-ag');
    await put(admin, `/admin/orgs/${org.id}/website-allowance`, {
      providerId: connection.id,
      maxSites: 1,
      maxDatabases: 1,
      siteTypes: ['php'],
    });
    const refused = await admin.del(`/admin/providers/${connection.id}`);
    expect(refused.statusCode).toBe(409);
    expect(json(refused).error.message).toContain('website allowances');
    expect((await admin.del(`/admin/orgs/${org.id}/website-allowance`)).statusCode).toBe(200);
    expect((await admin.del(`/admin/providers/${connection.id}`)).statusCode).toBe(200);
  });

  it('lets suspended organizations read, not change', async () => {
    await t.db.update(organizations).set({ status: 'suspended' }).where(eq(organizations.id, huberId));
    try {
      const list = json<WebspaceDto[]>(await hanna.get(`/orgs/${huberId}/webspaces`));
      const site = list.find((w) => w.name === 'baeckerei-huber.example')!;
      expect(site.permissions).toEqual(['webspace:read']);
      expect((await hanna.get(`/webspaces/${site.id}`)).statusCode).toBe(200);
      expect((await hanna.get(`/orgs/${huberId}/websites/options`)).statusCode).toBe(200);
      expect((await create(hanna, huberId, { domain: 'suspended.example', type: 'static' })).statusCode).toBe(
        403,
      );
      expect((await hanna.del(`/webspaces/${site.id}`, { confirm: site.name })).statusCode).toBe(403);
      expect((await hanna.post(`/webspaces/${site.id}/databases`, { suffix: 'db' })).statusCode).toBe(403);
    } finally {
      await t.db.update(organizations).set({ status: 'active' }).where(eq(organizations.id, huberId));
    }
  });
});
