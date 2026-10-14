import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { suggestSiteUser, websiteDatabaseName } from '@weblion/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { organizations, providerConnections, webspaces, websiteAllowances } from '../src/db/schema';
import { seedWebsitesDemo } from '../src/db/seed-websites';
import { AppError, ProviderError } from '../src/lib/errors';
import {
  DEMO_CLOUDPANEL_HOST,
  DEMO_CLOUDPANEL_IPV4,
  DEMO_CLOUDPANEL_IPV6,
  DEMO_ELSEWHERE_IPV4,
  DemoCloudPanelAdapter,
  demoCloudPanelState,
} from '../src/providers/demo/cloudpanel';
import { createAdapter } from '../src/providers/registry';
import type { DemoConfig, RemoteWebsite, WebsiteInput } from '../src/providers/types';
import { createTestApp, type TestApp } from './helpers';

const T0 = Date.parse('2026-10-11T13:30:00Z');
const DAY = 24 * 3_600_000;
const MiB = 1024 ** 2;
/** The last 6-hour measurement before T0. */
const MEASURED_AT = '2026-10-11T12:00:00Z';
const PASSWORD = 'Sicher-Passwort-2026';
const DB_PASSWORD = 'Datenbank-Passwort-7';
const MANAGED = [
  'api.muster-ag.example',
  'baeckerei-huber.example',
  'shop.muster-ag.example',
  'www.muster-ag.example',
];
const SERVER_DNS = { a: [DEMO_CLOUDPANEL_IPV4], aaaa: [DEMO_CLOUDPANEL_IPV6] };
const NO_DNS = { a: [], aaaa: [] };

/** ISO time with whole seconds, as the wrapper sends it. */
const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');

async function caught(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return err as AppError;
  }
  throw new Error('expected the promise to reject');
}

async function refused(promise: Promise<unknown>, status: number, code: string): Promise<AppError> {
  const err = await caught(promise);
  expect({ status: err.statusCode, code: err.code, message: err.message }).toMatchObject({ status, code });
  return err;
}

/** The real adapter's mapping of the wrapper's "invalid": 400 with the field as the path. */
async function invalid(promise: Promise<unknown>, field: string): Promise<AppError> {
  const err = await refused(promise, 400, 'bad_request');
  expect(err.details).toEqual([{ path: field, message: err.message }]);
  return err;
}

/** The wrapper's "exists": 409 with the field. */
async function exists(promise: Promise<unknown>, field: string): Promise<AppError> {
  const err = await refused(promise, 409, 'exists');
  expect(err.details).toEqual({ field });
  return err;
}

/** The wrapper's "not_found": a ProviderError with HTTP 404. */
async function missing(promise: Promise<unknown>): Promise<AppError> {
  const err = await refused(promise, 404, 'provider_error');
  expect(err).toBeInstanceOf(ProviderError);
  expect(err.message).toMatch(/^CloudPanel: /);
  return err;
}

const domains = (sites: RemoteWebsite[]) => sites.map((s) => s.domain);

describe('Demo CloudPanel', () => {
  let id: string;
  const cp = (config: DemoConfig = {}) => new DemoCloudPanelAdapter(id, config);
  const state = () => demoCloudPanelState(id);
  const site = (domain: string, extra: Partial<WebsiteInput> = {}): WebsiteInput => ({
    domain,
    type: 'php',
    phpVersion: '8.4',
    template: 'WordPress',
    nodejsVersion: null,
    siteUser: suggestSiteUser(domain),
    password: PASSWORD,
    database: null,
    ...extra,
  });
  const create = (domain: string, extra: Partial<WebsiteInput> = {}) =>
    cp().createWebsite(site(domain, extra));
  const listed = async () => domains(await cp().listWebsites());

  beforeEach(() => {
    DemoCloudPanelAdapter.reset();
    id = randomUUID();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is built for the cloudpanel flavor, without servers', async () => {
    const adapter = createAdapter('demo', id, { flavor: 'cloudpanel', nodejs: true });
    expect(adapter).toBeInstanceOf(DemoCloudPanelAdapter);
    expect(adapter.type).toBe('demo');
    expect(adapter.capabilities()).toEqual([]);
    expect(adapter.powerActions()).toEqual([]);
    expect(await adapter.listServers()).toEqual([]);
    const ref = { externalId: 'x', kind: 'vm' as const, node: null, meta: {} };
    await missing(adapter.getServer(ref));
    // The registry hands the connection config over: the customer options follow it.
    expect((await adapter.websiteServerOptions!()).types).toEqual(['php', 'static', 'nodejs']);
    expect(await adapter.testConnection()).toEqual({
      flavor: 'cloudpanel',
      hostname: DEMO_CLOUDPANEL_HOST,
      cloudpanelVersion: '2.5.4-3+clp-noble',
      agentVersion: '1.0.0',
      sites: 6,
      managed: 4,
      unmanaged: 2,
      phpVersions: '8.5, 8.4, 8.3, 8.2, 8.1, 7.4',
      allowRemoteAdopt: true,
      publicKey: null,
    });
  });

  it('starts with four managed sites and two the console does not manage', async () => {
    const sites = await cp().listWebsites();
    expect(domains(sites)).toEqual(MANAGED);
    const [api, bakery, shop, www] = sites;
    expect(www).toEqual({
      domain: 'www.muster-ag.example',
      facts: {
        type: 'php',
        siteUser: 'muster-ag-www',
        homeDirectory: '/home/muster-ag-www',
        webRoot: '/home/muster-ag-www/htdocs/www.muster-ag.example',
        application: 'WordPress',
        phpVersion: '8.3',
        nodejsVersion: null,
        appPort: null,
        certificate: { type: '2', letsEncrypt: true, expiresAt: iso(T0 + 60 * DAY) },
        databases: 1,
        diskBytes: 820 * MiB,
        databaseBytes: 45 * MiB,
        usageMeasuredAt: MEASURED_AT,
        createdAt: '2024-05-14T09:30:00Z',
      },
      databases: [{ name: 'muster_ag_www_wp', users: ['muster_ag_www_wp'], sizeBytes: 45 * MiB }],
    });
    expect(shop!.facts).toMatchObject({
      type: 'php',
      siteUser: 'shop-muster-ag-example',
      application: 'WooCommerce',
      phpVersion: '8.4',
      certificate: { letsEncrypt: true, expiresAt: iso(T0 + 10 * DAY) },
      databases: 1,
    });
    expect(shop!.databases.map((d) => d.name)).toEqual(['shop_muster_ag_e_shop']);
    expect(bakery!.facts).toMatchObject({
      type: 'static',
      siteUser: 'baeckerei-huber-example',
      webRoot: '/home/baeckerei-huber-example/htdocs/baeckerei-huber.example',
      application: null,
      phpVersion: null,
      certificate: {
        type: '1',
        letsEncrypt: false,
        expiresAt: iso(Date.parse('2025-06-20T08:00:00Z') + 3650 * DAY),
      },
      databases: 0,
      databaseBytes: 0,
    });
    expect(api!.facts).toMatchObject({
      type: 'nodejs',
      siteUser: 'api-muster-ag-example',
      application: null,
      nodejsVersion: '22',
      appPort: 3001,
      certificate: null,
      databases: 0,
      diskBytes: 240 * MiB,
    });
    // The seed follows the console's own naming rules.
    for (const s of [api!, bakery!, shop!]) expect(s.facts.siteUser).toBe(suggestSiteUser(s.domain));
    expect(websiteDatabaseName(shop!.facts.siteUser, 'shop')).toBe('shop_muster_ag_e_shop');
    expect(websiteDatabaseName(www!.facts.siteUser, 'wp')).toBe('muster_ag_www_wp');

    expect(await cp().listUnmanagedWebsites()).toEqual({
      sites: [
        { domain: 'cp.weblion.demo', type: 'nodejs', siteUser: 'weblion-cp', protected: true },
        { domain: 'legacy.kunde.example', type: 'php', siteUser: 'legacy', protected: false },
      ],
      allowRemoteAdopt: true,
    });
    expect(await cp().websiteServerInfo(true)).toEqual({
      agentVersion: '1.0.0',
      protocol: 1,
      cloudpanelVersion: '2.5.4-3+clp-noble',
      hostname: DEMO_CLOUDPANEL_HOST,
      os: 'Ubuntu 24.04.3 LTS',
      ipv4: [DEMO_CLOUDPANEL_IPV4],
      ipv6: [DEMO_CLOUDPANEL_IPV6],
      phpVersions: ['8.5', '8.4', '8.3', '8.2', '8.1', '7.4'],
      templates: [
        { name: 'Generic', rootDirectory: '' },
        { name: 'WordPress', rootDirectory: '' },
        { name: 'WooCommerce', rootDirectory: '' },
        { name: 'Laravel 12', rootDirectory: 'public' },
        { name: 'Static', rootDirectory: '' },
        { name: 'Nodejs', rootDirectory: '' },
        { name: 'Python', rootDirectory: '' },
        { name: 'ReverseProxy', rootDirectory: '' },
      ],
      nodejsVersions: ['18', '20', '22', '24'],
      nodejsEnabled: true,
      allowRemoteAdopt: true,
      protectedDomains: ['cp.weblion.demo'],
      counts: { sites: 6, managed: 4, unmanaged: 2 },
    });
    expect(cp().websiteAccessHost()).toBe(DEMO_CLOUDPANEL_HOST);
  });

  it('offers customers what the connection config allows', async () => {
    expect(await cp().websiteServerOptions()).toEqual({
      types: ['php', 'static'],
      phpVersions: ['8.4', '8.3'],
      defaultPhpVersion: '8.4',
      templates: [
        { name: 'Generic', rootDirectory: '' },
        { name: 'WordPress', rootDirectory: '' },
        { name: 'WooCommerce', rootDirectory: '' },
      ],
      nodejsVersions: ['20', '22', '24'],
      accessHost: DEMO_CLOUDPANEL_HOST,
      ipv4: [DEMO_CLOUDPANEL_IPV4],
      ipv6: [DEMO_CLOUDPANEL_IPV6],
    });

    // Versions the server lacks drop out, newest first; "*" matches a prefix; type templates never.
    const custom = await cp({
      phpVersions: ['7.4', '8.5', '9.9'],
      templates: ['Laravel*', 'Static', 'Nodejs', 'WordPress'],
      nodejs: true,
    }).websiteServerOptions();
    expect(custom).toMatchObject({
      types: ['php', 'static', 'nodejs'],
      phpVersions: ['8.5', '7.4'],
      defaultPhpVersion: '8.5',
      templates: [
        { name: 'WordPress', rootDirectory: '' },
        { name: 'Laravel 12', rootDirectory: 'public' },
      ],
    });
    expect(await cp({ phpVersions: ['5.6'] }).websiteServerOptions()).toMatchObject({
      phpVersions: [],
      defaultPhpVersion: null,
    });

    // Node.js needs the connection config and the server's own switch.
    state().server.nodejsEnabled = false;
    expect((await cp({ nodejs: true }).websiteServerOptions()).types).toEqual(['php', 'static']);
  });

  it('creates, lists, reads and deletes a website', async () => {
    const fresh = await create('blog.muster-ag.example', {
      siteUser: 'blog-muster',
      database: { name: 'blog_muster_wp', userName: 'blog_muster_wp', password: DB_PASSWORD },
    });
    expect(fresh).toEqual({
      website: {
        domain: 'blog.muster-ag.example',
        facts: {
          type: 'php',
          siteUser: 'blog-muster',
          homeDirectory: '/home/blog-muster',
          webRoot: '/home/blog-muster/htdocs/blog.muster-ag.example',
          application: 'WordPress',
          phpVersion: '8.4',
          nodejsVersion: null,
          appPort: null,
          certificate: { type: '1', letsEncrypt: false, expiresAt: iso(T0 + 3650 * DAY) },
          databases: 1,
          diskBytes: null,
          databaseBytes: null,
          usageMeasuredAt: null,
          createdAt: iso(T0),
        },
        databases: [{ name: 'blog_muster_wp', users: ['blog_muster_wp'], sizeBytes: null }],
      },
      warnings: [],
    });
    expect(await listed()).toEqual([
      'api.muster-ag.example',
      'baeckerei-huber.example',
      'blog.muster-ag.example',
      'shop.muster-ag.example',
      'www.muster-ag.example',
    ]);
    expect(await cp().getWebsite('blog.muster-ag.example')).toEqual(fresh.website);
    expect((await cp().websiteServerInfo()).counts).toEqual({ sites: 7, managed: 5, unmanaged: 2 });

    expect(await cp().deleteWebsite('blog.muster-ag.example')).toEqual({ warnings: [] });
    expect(await listed()).not.toContain('blog.muster-ag.example');
    await refused(cp().getWebsite('blog.muster-ag.example'), 409, 'not_managed');
    // Site user, database and its user are free again.
    const again = await create('blog.muster-ag.example', {
      siteUser: 'blog-muster',
      database: { name: 'blog_muster_wp', userName: 'blog_muster_wp', password: DB_PASSWORD },
    });
    expect(again.website.databases.map((d) => d.name)).toEqual(['blog_muster_wp']);
  });

  it('builds each site type like CloudPanel', async () => {
    const laravel = await create('app.muster-ag.example', { template: 'Laravel 12', phpVersion: '8.2' });
    expect(laravel.website.facts).toMatchObject({
      application: 'Laravel 12',
      phpVersion: '8.2',
      webRoot: '/home/app-muster-ag-example/htdocs/app.muster-ag.example/public',
    });
    // Static sites ignore PHP fields.
    const plain = await create('info.muster-ag.example', { type: 'static' });
    expect(plain.website.facts).toMatchObject({
      type: 'static',
      application: null,
      phpVersion: null,
      nodejsVersion: null,
      appPort: null,
      webRoot: '/home/info-muster-ag-example/htdocs/info.muster-ag.example',
    });
    // Node.js: the lowest free port of 3001 to 3999 (3001 is the API's).
    const node = await create('app2.muster-ag.example', {
      type: 'nodejs',
      nodejsVersion: '24',
      phpVersion: null,
      template: null,
    });
    expect(node.website.facts).toMatchObject({
      type: 'nodejs',
      application: null,
      phpVersion: null,
      nodejsVersion: '24',
      appPort: 3002,
    });
    // Ports below the range are never handed out (the console's own site holds 3000).
    await cp().deleteWebsite('api.muster-ag.example');
    state().sites.delete('cp.weblion.demo');
    const reused = await create('app3.muster-ag.example', {
      type: 'nodejs',
      nodejsVersion: '22',
      phpVersion: null,
      template: null,
    });
    expect(reused.website.facts.appPort).toBe(3001);

    // No free port left in the range: the server cannot create the site.
    const template = state().sites.get('app3.muster-ag.example')!;
    for (let port = 3002; port <= 3999; port++) {
      state().sites.set(`p${port}.example`, { ...template, domain: `p${port}.example`, appPort: port });
    }
    const full = await refused(
      create('app4.muster-ag.example', { type: 'nodejs', nodejsVersion: '22', template: null }),
      502,
      'provider_error',
    );
    expect(full.message).toBe('CloudPanel: No free app port between 3001 and 3999');
    expect(state().sites.has('app4.muster-ag.example')).toBe(false);
  });

  it('refuses invalid arguments with their field before looking at the server', async () => {
    const cases: [Partial<WebsiteInput>, string][] = [
      [{ domain: 'Shop.Muster-AG.example' }, 'domain'],
      [{ domain: 'müller.example' }, 'domain'],
      [{ domain: '203.0.113.5' }, 'domain'],
      [{ domain: 'a b.example' }, 'domain'],
      [{ domain: 'shop.example/x' }, 'domain'],
      [{ domain: 'localhost' }, 'domain'],
      [{ type: 'python' as WebsiteInput['type'] }, 'type'],
      [{ type: 'reverse-proxy' as WebsiteInput['type'] }, 'type'],
      [{ siteUser: 'Shop' }, 'siteUser'],
      [{ siteUser: 'ab' }, 'siteUser'],
      [{ siteUser: `a${'b'.repeat(32)}` }, 'siteUser'],
      [{ siteUser: 'shop;id' }, 'siteUser'],
      [{ siteUser: 'root' }, 'siteUser'],
      [{ siteUser: 'weblion-cp' }, 'siteUser'],
      [{ password: 'Kurz-123' }, 'password'],
      [{ password: 'Passwort$mitDollar' }, 'password'],
      [{ password: "Passwort'mitQuote" }, 'password'],
      [{ password: 'Passwort mit Leerzeichen' }, 'password'],
      [{ phpVersion: '8' }, 'phpVersion'],
      [{ phpVersion: '8.4; id' }, 'phpVersion'],
      [{ phpVersion: null }, 'phpVersion'],
      [{ template: 'Generic; rm -rf /' }, 'template'],
      [{ template: '$(id)' }, 'template'],
      [{ template: null }, 'template'],
      [{ type: 'nodejs', nodejsVersion: '21' }, 'nodejsVersion'],
      [{ type: 'nodejs', nodejsVersion: null }, 'nodejsVersion'],
      [{ database: { name: 'Neu-DB', userName: 'neu_muster_ag_exa_db', password: DB_PASSWORD } }, 'database'],
      [{ database: { name: 'neu_muster_ag_exa_db', userName: 'x', password: DB_PASSWORD } }, 'database'],
      [
        { database: { name: 'neu_muster_ag_exa_db', userName: 'neu_muster_ag_exa_db', password: 'Kurz$' } },
        'database',
      ],
    ];
    for (const [extra, field] of cases) {
      const err = await invalid(create('neu.muster-ag.example', extra), field);
      for (const secret of [extra.password, extra.database?.password]) {
        if (secret)
          expect(JSON.stringify({ message: err.message, details: err.details })).not.toContain(secret);
      }
    }
    expect(state().sites.size).toBe(6);
  });

  it('refuses what the server has already, with the field', async () => {
    // Linux users of every site, managed or not.
    await exists(create('neu.muster-ag.example', { siteUser: 'muster-ag-www' }), 'siteUser');
    await exists(create('neu.muster-ag.example', { siteUser: 'legacy' }), 'siteUser');
    await exists(create('shop.muster-ag.example', { siteUser: 'shop-neu' }), 'domain');
    await exists(create('legacy.kunde.example', { siteUser: 'legacy-neu' }), 'domain');
    await refused(create('cp.weblion.demo', { siteUser: 'cp-neu' }), 409, 'protected');
    // A user on the protected list, beyond the reserved names.
    state().server.protectedUsers.push('kunde-intern');
    await refused(create('neu.muster-ag.example', { siteUser: 'kunde-intern' }), 409, 'protected');

    // What the server has installed.
    await invalid(create('neu.muster-ag.example', { template: 'Joomla' }), 'template');
    await invalid(create('neu.muster-ag.example', { phpVersion: '8.0' }), 'phpVersion');
    state().server.nodejsEnabled = false;
    await invalid(
      create('neu.muster-ag.example', { type: 'nodejs', nodejsVersion: '22', template: null }),
      'type',
    );

    // Databases: the site's prefix, no system schema, names and users unique on the server.
    const db = (name: string, userName = name) => ({ name, userName, password: DB_PASSWORD });
    await invalid(
      create('neu.muster-ag.example', { siteUser: 'neu-site', database: db('anders_wp') }),
      'database',
    );
    await invalid(
      create('neu.muster-ag.example', {
        siteUser: 'neu-site',
        database: db('neu_site_wp', 'anders_wp'),
      }),
      'database',
    );
    await invalid(
      create('neu.muster-ag.example', { siteUser: 'information', database: db('information_schema') }),
      'database',
    );
    // "shop-muster-ag-eins" has the same 16-character prefix as the shop's site user.
    await exists(
      create('neu.muster-ag.example', {
        siteUser: 'shop-muster-ag-eins',
        database: db('shop_muster_ag_e_shop'),
      }),
      'database',
    );
    await exists(
      create('neu.muster-ag.example', {
        siteUser: 'shop-muster-ag-eins',
        database: db('shop_muster_ag_e_neu', 'shop_muster_ag_e_shop'),
      }),
      'database',
    );
    expect(state().sites.size).toBe(6);
    expect(state().managed.size).toBe(4);
  });

  it('creates the site but reports a database whose name contains "fail"', async () => {
    const result = await create('neu.muster-ag.example', {
      siteUser: 'neu-site',
      database: { name: 'neu_site_fail', userName: 'neu_site_fail', password: DB_PASSWORD },
    });
    expect(result.warnings).toEqual([
      'The database could not be created: clpctl db:add failed for neu_site_fail',
    ]);
    expect(result.website.databases).toEqual([]);
    expect(await listed()).toContain('neu.muster-ag.example');
  });

  it('checks passwords and keeps none of them', async () => {
    await create('neu.muster-ag.example', {
      siteUser: 'neu-site',
      database: { name: 'neu_site_wp', userName: 'neu_site_wp', password: DB_PASSWORD },
    });
    await cp().setWebsitePassword('neu.muster-ag.example', 'Neues-Passwort-42');
    await cp().setWebsiteDatabasePassword(
      'neu.muster-ag.example',
      'neu_site_wp',
      'neu_site_wp',
      'Neues-DB-Pass-42',
    );
    const err = await invalid(
      cp().setWebsitePassword('neu.muster-ag.example', 'Passwort`backtick'),
      'password',
    );
    expect(err.message).not.toContain('backtick');
    await invalid(
      cp().setWebsiteDatabasePassword('neu.muster-ag.example', 'neu_site_wp', 'neu_site_wp', 'kurz'),
      'password',
    );

    const dump = JSON.stringify({
      sites: [...state().sites.values()],
      managed: [...state().managed.entries()],
      server: state().server,
    });
    for (const secret of [PASSWORD, DB_PASSWORD, 'Neues-Passwort-42', 'Neues-DB-Pass-42']) {
      expect(dump).not.toContain(secret);
    }
  });

  it('shows and changes only managed sites', async () => {
    expect(await listed()).toEqual(MANAGED);
    const db = { name: 'x_wp', userName: 'x_wp', password: DB_PASSWORD };
    const changes = (domain: string) => [
      () => cp().deleteWebsite(domain),
      () => cp().setWebsitePassword(domain, PASSWORD),
      () => cp().createWebsiteDatabase(domain, db),
      () => cp().setWebsiteDatabasePassword(domain, 'x_wp', 'x_wp', PASSWORD),
      () => cp().deleteWebsiteDatabase(domain, 'x_wp'),
      () => cp().issueWebsiteCertificate(domain),
    ];
    for (const change of changes('cp.weblion.demo')) await refused(change(), 409, 'protected');
    for (const change of changes('legacy.kunde.example')) await refused(change(), 409, 'not_managed');
    for (const change of changes('nope.muster-ag.example')) await refused(change(), 409, 'not_managed');
    for (const change of changes('Nope.example')) await invalid(change(), 'domain');
    await refused(cp().getWebsite('legacy.kunde.example'), 409, 'not_managed');
    await refused(cp().getWebsite('cp.weblion.demo'), 409, 'not_managed');

    // Deleted in CloudPanel's own UI: left out of the list, changes answer not_found.
    state().sites.delete('baeckerei-huber.example');
    expect(await listed()).toEqual(MANAGED.filter((d) => d !== 'baeckerei-huber.example'));
    await missing(cp().getWebsite('baeckerei-huber.example'));
    await missing(cp().deleteWebsite('baeckerei-huber.example'));
    expect((await cp().websiteServerInfo()).counts).toEqual({ sites: 5, managed: 3, unmanaged: 2 });

    // The site user changed behind the console's back.
    state().sites.get('www.muster-ag.example')!.siteUser = 'jemand-anders';
    const changed = await refused(cp().deleteWebsite('www.muster-ag.example'), 409, 'not_managed');
    expect(changed.message).toContain('site user');

    // Protected entries stay protected even when they got onto the managed list.
    state().managed.set('cp.weblion.demo', { siteUser: 'weblion-cp', source: 'adopt' });
    await refused(cp().deleteWebsite('cp.weblion.demo'), 409, 'protected');
    state().server.protectedUsers.push('api-muster-ag-example');
    await refused(cp().deleteWebsite('api.muster-ag.example'), 409, 'protected');
    expect(state().sites.has('api.muster-ag.example')).toBe(true);
  });

  it('adds, re-keys and deletes databases of a managed site', async () => {
    const www = 'www.muster-ag.example';
    const added = await cp().createWebsiteDatabase(www, {
      name: 'muster_ag_www_shop',
      userName: 'muster_ag_www_shop',
      password: DB_PASSWORD,
    });
    expect(added.databases).toEqual([
      { name: 'muster_ag_www_wp', users: ['muster_ag_www_wp'], sizeBytes: 45 * MiB },
      { name: 'muster_ag_www_shop', users: ['muster_ag_www_shop'], sizeBytes: null },
    ]);
    // Not measured yet: the sum keeps the measured database.
    expect(added.facts).toMatchObject({ databases: 2, databaseBytes: 45 * MiB });

    const db = (name: string, userName = name, password = DB_PASSWORD) => ({ name, userName, password });
    await invalid(cp().createWebsiteDatabase(www, db('Muster-DB')), 'name');
    await invalid(cp().createWebsiteDatabase(www, db('muster_ag_www_x', 'X')), 'userName');
    await invalid(
      cp().createWebsiteDatabase(www, db('muster_ag_www_x', 'muster_ag_www_x', 'kurz')),
      'password',
    );
    await invalid(cp().createWebsiteDatabase(www, db('shop_muster_ag_e_x')), 'name');
    await invalid(cp().createWebsiteDatabase(www, db('muster_ag_www_x', 'shop_muster_ag_e_x')), 'userName');
    await exists(cp().createWebsiteDatabase(www, db('muster_ag_www_wp', 'muster_ag_www_y')), 'name');
    await exists(cp().createWebsiteDatabase(www, db('muster_ag_www_z', 'muster_ag_www_wp')), 'userName');
    // A failing clpctl db:add, rolled back by the wrapper.
    const failed = await refused(
      cp().createWebsiteDatabase(www, db('muster_ag_www_fail')),
      502,
      'provider_error',
    );
    expect(failed).toBeInstanceOf(ProviderError);
    expect(failed.message).toBe('CloudPanel: clpctl db:add failed for muster_ag_www_fail');
    expect(failed.details).toEqual({
      rolledBack: true,
      output: 'Database "muster_ag_www_fail" could not be created.',
    });
    expect((await cp().getWebsite(www)).databases).toHaveLength(2);

    await cp().setWebsiteDatabasePassword(www, 'muster_ag_www_shop', 'muster_ag_www_shop', PASSWORD);
    await missing(
      cp().setWebsiteDatabasePassword(www, 'shop_muster_ag_e_shop', 'shop_muster_ag_e_shop', PASSWORD),
    );
    await invalid(
      cp().setWebsiteDatabasePassword(www, 'muster_ag_www_shop', 'muster_ag_www_wp', PASSWORD),
      'userName',
    );

    // A database of another site is not this site's to delete.
    await missing(cp().deleteWebsiteDatabase(www, 'shop_muster_ag_e_shop'));
    await invalid(cp().deleteWebsiteDatabase(www, 'DROP'), 'name');
    const after = await cp().deleteWebsiteDatabase(www, 'muster_ag_www_shop');
    expect(after.databases.map((d) => d.name)).toEqual(['muster_ag_www_wp']);
    expect(after.facts.databases).toBe(1);
    await missing(cp().deleteWebsiteDatabase(www, 'muster_ag_www_shop'));
    expect((await cp().getWebsite('shop.muster-ag.example')).databases).toHaveLength(1);
  });

  it('issues Let’s Encrypt certificates where DNS points to the server', async () => {
    const shop = await cp().issueWebsiteCertificate('shop.muster-ag.example');
    expect(shop.facts.certificate).toEqual({ type: '2', letsEncrypt: true, expiresAt: iso(T0 + 90 * DAY) });

    await create('nodns.muster-ag.example');
    const err = await refused(cp().issueWebsiteCertificate('nodns.muster-ag.example'), 502, 'provider_error');
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toContain('DNS problem: NXDOMAIN looking up A for nodns.muster-ag.example');
    expect(err.details).toEqual({
      output:
        'DNS problem: NXDOMAIN looking up A for nodns.muster-ag.example - check that a DNS record exists for this domain',
    });
    expect((await cp().getWebsite('nodns.muster-ag.example')).facts.certificate).toMatchObject({
      letsEncrypt: false,
    });

    // Behind a CDN that forwards the challenge: the certificate works.
    await create('elsewhere.muster-ag.example');
    const cdn = await cp().issueWebsiteCertificate('elsewhere.muster-ag.example');
    expect(cdn.facts.certificate).toMatchObject({ letsEncrypt: true, expiresAt: iso(T0 + 90 * DAY) });
  });

  it('answers DNS for the check like public resolvers would', async () => {
    const dns = (name: string) => cp().websiteDnsOverride(name);
    expect(dns('www.muster-ag.example')).toEqual(SERVER_DNS);
    // The www counterpart, upper case and a trailing dot.
    expect(dns('muster-ag.example')).toEqual(SERVER_DNS);
    expect(dns('WWW.Shop.Muster-AG.example.')).toEqual(SERVER_DNS);
    expect(dns('legacy.kunde.example')).toEqual(NO_DNS);
    expect(dns('unbekannt.example')).toEqual(NO_DNS);
    expect(dns('nodns.muster-ag.example')).toEqual(NO_DNS);
    expect(dns('elsewhere.kunde.example')).toEqual({ a: [DEMO_ELSEWHERE_IPV4], aaaa: [] });

    await create('nodns.muster-ag.example');
    expect(dns('nodns.muster-ag.example')).toEqual(NO_DNS);
    expect(dns('www.nodns.muster-ag.example')).toEqual(NO_DNS);
    await create('neu.muster-ag.example');
    expect(dns('www.neu.muster-ag.example')).toEqual(SERVER_DNS);
    await cp().deleteWebsite('www.muster-ag.example');
    expect(dns('www.muster-ag.example')).toEqual(NO_DNS);
  });

  it('adopts and forgets sites when the server allows it', async () => {
    const adopted = await cp().adoptWebsite('legacy.kunde.example');
    expect(adopted).toEqual({
      domain: 'legacy.kunde.example',
      facts: {
        type: 'php',
        siteUser: 'legacy',
        homeDirectory: '/home/legacy',
        webRoot: '/home/legacy/htdocs/legacy.kunde.example',
        application: 'Generic',
        phpVersion: '7.4',
        nodejsVersion: null,
        appPort: null,
        certificate: { type: '2', letsEncrypt: true, expiresAt: iso(T0 + 30 * DAY) },
        databases: 1,
        diskBytes: null,
        databaseBytes: null,
        usageMeasuredAt: null,
        createdAt: '2019-11-04T12:00:00Z',
      },
      databases: [{ name: 'legacy_web', users: ['legacy_web'], sizeBytes: null }],
    });
    expect(await listed()).toContain('legacy.kunde.example');
    expect((await cp().listUnmanagedWebsites()).sites.map((s) => s.domain)).toEqual(['cp.weblion.demo']);
    await exists(cp().adoptWebsite('legacy.kunde.example'), 'domain');
    await refused(cp().adoptWebsite('cp.weblion.demo'), 409, 'protected');
    await missing(cp().adoptWebsite('nope.kunde.example'));
    await invalid(cp().adoptWebsite('nope'), 'domain');
    // Adopted sites can be changed.
    await cp().setWebsitePassword('legacy.kunde.example', PASSWORD);

    // Forgetting leaves the site on the server, unmanaged; forgetting twice is fine.
    await cp().forgetWebsite('legacy.kunde.example');
    await cp().forgetWebsite('legacy.kunde.example');
    await cp().forgetWebsite('nope.kunde.example');
    await invalid(cp().forgetWebsite('nope'), 'domain');
    expect(await listed()).toEqual(MANAGED);
    expect(state().sites.has('legacy.kunde.example')).toBe(true);
    await refused(cp().setWebsitePassword('legacy.kunde.example', PASSWORD), 409, 'not_managed');

    state().server.allowRemoteAdopt = false;
    const off = await refused(cp().adoptWebsite('legacy.kunde.example'), 409, 'adopt_disabled');
    expect(off.message).toContain('sudo weblion-clp adopt legacy.kunde.example');
    expect((await cp().listUnmanagedWebsites()).allowRemoteAdopt).toBe(false);
  });

  it('fails the next call of a method on demand, before or after its effect', async () => {
    const timeout = new AppError(504, 'timeout', 'No answer within 330 s');
    DemoCloudPanelAdapter.failNext(id, 'createWebsite', timeout);
    expect(await caught(create('neu.muster-ag.example'))).toBe(timeout);
    expect(await listed()).toEqual(MANAGED);
    // Only once, and only that method.
    await create('neu.muster-ag.example');
    expect(await listed()).toContain('neu.muster-ag.example');

    DemoCloudPanelAdapter.failNext(id, 'createWebsite', timeout, { afterEffect: true });
    expect(await caught(create('lost.muster-ag.example'))).toBe(timeout);
    expect(await listed()).toContain('lost.muster-ag.example');

    // Queued failures come one after another; a call that fails on its own uses one up.
    const first = new ProviderError('CloudPanel', 'first', undefined, { rolledBack: true });
    const second = new ProviderError('CloudPanel', 'second', undefined, { rolledBack: false });
    DemoCloudPanelAdapter.failNext(id, 'deleteWebsite', first);
    DemoCloudPanelAdapter.failNext(id, 'deleteWebsite', second, { afterEffect: true });
    DemoCloudPanelAdapter.failNext(id, 'deleteWebsite', timeout, { afterEffect: true });
    expect(await caught(cp().deleteWebsite('neu.muster-ag.example'))).toBe(first);
    expect(await caught(cp().deleteWebsite('neu.muster-ag.example'))).toBe(second);
    expect(await listed()).not.toContain('neu.muster-ag.example');
    await refused(cp().deleteWebsite('neu.muster-ag.example'), 409, 'not_managed');
    expect(await cp().deleteWebsite('lost.muster-ag.example')).toEqual({ warnings: [] });

    // Per connection: another server is not affected.
    const other = randomUUID();
    DemoCloudPanelAdapter.failNext(other, 'listWebsites', timeout);
    expect(await listed()).toEqual(MANAGED);
    expect(await caught(new DemoCloudPanelAdapter(other).listWebsites())).toBe(timeout);
  });

  it('starts over after reset() and keeps each connection apart', async () => {
    const other = randomUUID();
    await cp().deleteWebsite('www.muster-ag.example');
    await cp().adoptWebsite('legacy.kunde.example');
    // A new adapter object for the same connection sees the change, another connection does not.
    expect(await listed()).not.toContain('www.muster-ag.example');
    expect(domains(await new DemoCloudPanelAdapter(other).listWebsites())).toEqual(MANAGED);
    DemoCloudPanelAdapter.failNext(id, 'listWebsites', new Error('pending'));

    DemoCloudPanelAdapter.reset();
    expect(await listed()).toEqual(MANAGED);
    expect((await cp().listUnmanagedWebsites()).sites).toHaveLength(2);
  });

  it('offers the three read operations of the explorer, nothing else', async () => {
    const info = await cp().rawRequest('GET', '/info');
    expect(info).toMatchObject({
      status: 200,
      data: { cliVersion: 'CloudPanel CLI 6.0.8', protocol: 1, counts: { managed: 4 } },
    });
    const list = (await cp().rawRequest('get', '/list')) as { status: number; data: { sites: unknown[] } };
    expect(list.status).toBe(200);
    expect(list.data.sites).toHaveLength(4);
    // The wrapper's site shape, with usage instead of the flattened facts.
    expect(list.data.sites[3]).toMatchObject({
      domain: 'www.muster-ag.example',
      homeDirectory: '/home/muster-ag-www',
      databases: [{ name: 'muster_ag_www_wp', users: ['muster_ag_www_wp'], sizeBytes: 45 * MiB }],
      usage: { diskBytes: 820 * MiB, databaseBytes: 45 * MiB, measuredAt: MEASURED_AT },
    });
    expect(await cp().rawRequest('GET', '/unmanaged')).toEqual({
      status: 200,
      data: await cp().listUnmanagedWebsites(),
    });
    for (const [method, path] of [
      ['POST', '/list'],
      ['GET', '/create'],
      ['GET', '/../etc/passwd'],
      ['GET', '/list?x=1'],
    ] as const) {
      await refused(cp().rawRequest(method, path), 400, 'bad_request');
    }
  });
});

describe('Demo websites seed', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ env: { ENABLE_DEMO_CLOUDPANEL: 'true' } });
  });
  afterAll(async () => {
    await t?.close();
  });

  const connection = async () => {
    const found = await t.db.query.providerConnections.findFirst({
      where: eq(providerConnections.envKey, 'demo-cloudpanel'),
    });
    expect(found).toMatchObject({ type: 'demo', name: 'Demo CloudPanel' });
    return found!;
  };
  const org = async (slug: string) =>
    (await t.db.query.organizations.findFirst({ where: eq(organizations.slug, slug) }))!;
  const allowances = async () =>
    (
      await t.db
        .select({
          slug: organizations.slug,
          providerConnectionId: websiteAllowances.providerConnectionId,
          maxSites: websiteAllowances.maxSites,
          maxDatabases: websiteAllowances.maxDatabases,
          siteTypes: websiteAllowances.siteTypes,
        })
        .from(websiteAllowances)
        .innerJoin(organizations, eq(organizations.id, websiteAllowances.orgId))
        .orderBy(organizations.slug)
    ).map(({ slug, providerConnectionId, ...rest }) => ({ slug, ...rest, onDemo: providerConnectionId }));
  const owners = async (connectionId: string) =>
    (
      await t.db
        .select({ name: webspaces.externalId, org: organizations.slug })
        .from(webspaces)
        .leftJoin(organizations, eq(organizations.id, webspaces.orgId))
        .where(eq(webspaces.providerConnectionId, connectionId))
        .orderBy(webspaces.externalId)
    ).map((r) => [r.name, r.org]);

  it('sets allowances and the module before any website exists', async () => {
    const demo = await connection();
    expect(await allowances()).toEqual([
      {
        slug: 'alpen-hosting',
        maxSites: 20,
        maxDatabases: 40,
        siteTypes: ['php', 'static'],
        onDemo: demo.id,
      },
      {
        slug: 'baeckerei-huber',
        maxSites: 3,
        maxDatabases: 5,
        siteTypes: ['php', 'static'],
        onDemo: demo.id,
      },
      {
        slug: 'muster-ag',
        maxSites: 5,
        maxDatabases: 10,
        siteTypes: ['php', 'static', 'nodejs'],
        onDemo: demo.id,
      },
    ]);
    for (const slug of ['alpen-hosting', 'muster-ag', 'baeckerei-huber']) {
      expect((await org(slug)).modules).toContain('webhosting');
    }
    // The seed ran before the connection was synced: no website rows yet.
    expect(await owners(demo.id)).toEqual([]);
  });

  it('hands out the synced websites, only unassigned ones, and leaves later changes alone', async () => {
    const demo = await connection();
    // What the website sync stores: the managed sites, unassigned. The registry builds the
    // simulated server for the env connection.
    const adapter = t.ctx.providers.forConnection(demo);
    expect(adapter).toBeInstanceOf(DemoCloudPanelAdapter);
    const now = new Date();
    for (const remote of await adapter.listWebsites!()) {
      await t.db.insert(webspaces).values({
        providerConnectionId: demo.id,
        externalId: remote.domain,
        name: remote.domain,
        kind: 'website',
        lastSyncedAt: now,
      });
    }
    const log: string[] = [];
    await seedWebsitesDemo(t.db, log);
    expect(log).toEqual([
      'assigned websites api.muster-ag.example, shop.muster-ag.example, www.muster-ag.example to Muster AG',
      'assigned websites baeckerei-huber.example to Bäckerei Huber',
    ]);
    expect(await owners(demo.id)).toEqual([
      ['api.muster-ag.example', 'muster-ag'],
      ['baeckerei-huber.example', 'baeckerei-huber'],
      ['shop.muster-ag.example', 'muster-ag'],
      ['www.muster-ag.example', 'muster-ag'],
    ]);

    // Staff moved the shop and changed an allowance; a removed module stays removed.
    const beispiel = await org('beispiel-gmbh');
    const huber = await org('baeckerei-huber');
    await t.db
      .update(webspaces)
      .set({ orgId: beispiel.id })
      .where(
        and(eq(webspaces.providerConnectionId, demo.id), eq(webspaces.externalId, 'shop.muster-ag.example')),
      );
    await t.db
      .update(websiteAllowances)
      .set({ maxSites: 7 })
      .where(eq(websiteAllowances.orgId, (await org('muster-ag')).id));
    await t.db
      .update(organizations)
      .set({ modules: huber.modules.filter((m) => m !== 'webhosting') })
      .where(eq(organizations.id, huber.id));
    const again: string[] = [];
    await seedWebsitesDemo(t.db, again);
    expect(again).toEqual([]);
    expect(await owners(demo.id)).toContainEqual(['shop.muster-ag.example', 'beispiel-gmbh']);
    expect((await allowances()).find((a) => a.slug === 'muster-ag')!.maxSites).toBe(7);
    expect((await org('baeckerei-huber')).modules).not.toContain('webhosting');

    // Without an allowance the organization gets one again, with the module.
    await t.db.delete(websiteAllowances).where(eq(websiteAllowances.orgId, huber.id));
    const restored: string[] = [];
    await seedWebsitesDemo(t.db, restored);
    expect(restored).toEqual([
      'website allowance 3 sites, 5 databases (php, static) on Demo CloudPanel for Bäckerei Huber, module webhosting',
    ]);
    expect((await org('baeckerei-huber')).modules).toContain('webhosting');
  });
});

describe('Demo websites seed without the demo CloudPanel', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t?.close();
  });

  it('gives no allowance and no module', async () => {
    const log: string[] = [];
    await seedWebsitesDemo(t.db, log);
    expect(log).toEqual([]);
    expect(await t.db.select().from(websiteAllowances)).toEqual([]);
    const huber = await t.db.query.organizations.findFirst({
      where: eq(organizations.slug, 'baeckerei-huber'),
    });
    expect(huber!.modules).not.toContain('webhosting');
  });
});
