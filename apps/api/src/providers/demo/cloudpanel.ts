import type {
  Capability,
  PowerAction,
  UnmanagedWebsiteDto,
  WebsiteCertificate,
  WebsiteServerOptions,
  WebsiteTemplate,
  WebsiteType,
} from '@weblion/shared';
import {
  CREATABLE_WEBSITE_TYPES,
  NODEJS_VERSIONS,
  PHP_VERSION_PATTERN,
  SITE_USER_PATTERN,
  WEBSITE_DB_NAME_PATTERN,
  WEBSITE_PASSWORD_PATTERN,
  WEBSITE_TEMPLATE_PATTERN,
  isReservedSiteUser,
  websiteDatabasePrefix,
  websiteDomainAscii,
  wwwCounterpart,
} from '@weblion/shared';
import { AppError, ProviderError, badRequest } from '../../lib/errors';
import type {
  DemoConfig,
  ProviderAdapter,
  RawResponse,
  RemoteServer,
  RemoteWebsite,
  ServerRef,
  WebsiteDatabaseInput,
  WebsiteInput,
  WebsiteServerInfo,
  WireInfo,
  WireSite,
} from '../types';

/**
 * Simulated CloudPanel server for the opt-in demo connection (DemoConfig.flavor "cloudpanel",
 * ENABLE_DEMO_CLOUDPANEL). Deterministic, kept in memory per connection like the other demo
 * data, so changes survive adapter re-creation. Behaves like the root wrapper weblion-clp behind
 * the real adapter, synchronously: the same checks with the shared patterns in the same order,
 * a managed list and a protected list, and the errors the real adapter maps the wrapper's codes
 * to (invalid, exists with its field, not_found, not_managed, protected, adopt_disabled,
 * clpctl_failed). Passwords are checked and dropped, never kept. The config carries the customer
 * options of a real connection (phpVersions, templates, nodejs).
 */

const PROVIDER = 'CloudPanel';
const MiB = 1024 ** 2;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** The server measures disk usage every 6 hours (weblion-clp refresh-usage). */
const USAGE_INTERVAL = 6 * HOUR;
/** Let's Encrypt certificates the simulated server issues. */
const CERTIFICATE_DAYS = 90;
/** CloudPanel's own certificate of a new site. */
const SELF_SIGNED_DAYS = 3650;
/** CloudPanel's certificate.type values are undocumented; these are the demo's. */
const CERT_TYPE_SELF_SIGNED = '1';
const CERT_TYPE_LETS_ENCRYPT = '2';
/** App ports the wrapper hands out to Node.js sites (config.json nodejsPorts). */
const NODEJS_PORTS = { first: 3001, last: 3999 };
/** Linux users that exist on every CloudPanel server running the agent. */
const SYSTEM_USERS = ['root', 'clp', 'weblion-agent'];
const SYSTEM_SCHEMAS = ['mysql', 'sys', 'information_schema', 'performance_schema'];
/** Site types of CloudPanel's vhost template list, never offered as applications. */
const TYPE_TEMPLATES = ['Static', 'Nodejs', 'Python', 'ReverseProxy'];
/** What customers may choose when the connection config says nothing (same as the real adapter). */
const DEFAULT_PHP_VERSIONS = ['8.3', '8.4'];
const DEFAULT_TEMPLATES = ['Generic', 'WordPress', 'WooCommerce'];
/** Node.js versions offered to customers: the current LTS lines. */
const MIN_NODEJS_OFFERED = 20;

export const DEMO_CLOUDPANEL_HOST = 'web1.demo.weblion.example';
export const DEMO_CLOUDPANEL_IPV4 = '203.0.113.10';
export const DEMO_CLOUDPANEL_IPV6 = '2001:db8::10';
/** Where names containing "elsewhere" point (another host or a CDN). */
export const DEMO_ELSEWHERE_IPV4 = '198.51.100.7';

/** The server facts the wrapper's "info" reports, plus its protected list. Tests may change them. */
export interface DemoCloudPanelServer {
  hostname: string;
  os: string;
  cloudpanelVersion: string;
  cliVersion: string;
  agentVersion: string;
  protocol: number;
  ipv4: string[];
  ipv6: string[];
  /** Newest first. */
  phpVersions: string[];
  templates: WebsiteTemplate[];
  nodejsVersions: string[];
  /** config.json "nodejs" on the server. */
  nodejsEnabled: boolean;
  /** config.json "allowRemoteAdopt": on in the demo, so the admin adopt flow can be tried. */
  allowRemoteAdopt: boolean;
  /** protected.conf: these sites and users can never be adopted, created, changed or deleted. */
  protectedDomains: string[];
  protectedUsers: string[];
}

export interface DemoWebsiteDatabase {
  name: string;
  users: string[];
  /** null until the server measured it. */
  sizeBytes: number | null;
}

/** A site in CloudPanel's database, managed or not. */
export interface DemoWebsite {
  /** ASCII domain. */
  domain: string;
  type: WebsiteType;
  siteUser: string;
  /** Vhost template of PHP sites. */
  application: string | null;
  /** Below the domain folder, "" for the folder itself. */
  rootDirectory: string;
  phpVersion: string | null;
  nodejsVersion: string | null;
  appPort: number | null;
  /** ISO time. */
  createdAt: string;
  certificate: WebsiteCertificate | null;
  databases: DemoWebsiteDatabase[];
  /** Files of the home directory at the last measurement; null until measured. */
  usage: { diskBytes: number; measuredAt: string } | null;
}

/** An entry of the wrapper's managed list (managed.json). */
export interface DemoManagedSite {
  siteUser: string;
  source: 'create' | 'adopt';
}

/** Website methods a test can make fail once (failNext). */
export type DemoCloudPanelMethod =
  | 'testConnection'
  | 'listWebsites'
  | 'getWebsite'
  | 'listUnmanagedWebsites'
  | 'websiteServerInfo'
  | 'websiteServerOptions'
  | 'createWebsite'
  | 'deleteWebsite'
  | 'setWebsitePassword'
  | 'createWebsiteDatabase'
  | 'setWebsiteDatabasePassword'
  | 'deleteWebsiteDatabase'
  | 'issueWebsiteCertificate'
  | 'adoptWebsite'
  | 'forgetWebsite';

interface DemoFailure {
  error: Error;
  /** Throw after the change was applied (a lost answer), not before. */
  afterEffect: boolean;
}

export interface DemoCloudPanelState {
  server: DemoCloudPanelServer;
  /** Every site in CloudPanel, key: ASCII domain. */
  sites: Map<string, DemoWebsite>;
  /** The wrapper's managed list, key: ASCII domain. */
  managed: Map<string, DemoManagedSite>;
  /** Pending failNext errors per method, oldest first. */
  failures: Map<DemoCloudPanelMethod, DemoFailure[]>;
}

const STATE = new Map<string, DemoCloudPanelState>();

/** ISO time with whole seconds, as the wrapper sends CloudPanel's times. */
const iso = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');

interface SiteSeed {
  domain: string;
  type: WebsiteType;
  siteUser: string;
  application?: string;
  rootDirectory?: string;
  phpVersion?: string;
  nodejsVersion?: string;
  appPort?: number;
  createdAt: string;
  certificate: { kind: 'letsencrypt'; days: number } | { kind: 'self-signed' } | null;
  databases: { name: string; sizeMb: number | null }[];
  /** MiB of files, null = never measured (unmanaged sites). */
  diskMb: number | null;
  managed: boolean;
}

/**
 * Muster AG's shop, its WordPress site and an API, and the bakery's static page are managed.
 * The shop's certificate runs out in 10 days, the bakery has only CloudPanel's self-signed one,
 * the API none. The console's own site is protected; an old PHP site waits to be adopted.
 */
const SITES: SiteSeed[] = [
  {
    domain: 'www.muster-ag.example',
    type: 'php',
    siteUser: 'muster-ag-www',
    application: 'WordPress',
    phpVersion: '8.3',
    createdAt: '2024-05-14T09:30:00Z',
    certificate: { kind: 'letsencrypt', days: 60 },
    databases: [{ name: 'muster_ag_www_wp', sizeMb: 45 }],
    diskMb: 820,
    managed: true,
  },
  {
    domain: 'shop.muster-ag.example',
    type: 'php',
    siteUser: 'shop-muster-ag-example',
    application: 'WooCommerce',
    phpVersion: '8.4',
    createdAt: '2025-02-03T14:10:00Z',
    certificate: { kind: 'letsencrypt', days: 10 },
    databases: [{ name: 'shop_muster_ag_e_shop', sizeMb: 310 }],
    diskMb: 2150,
    managed: true,
  },
  {
    domain: 'baeckerei-huber.example',
    type: 'static',
    siteUser: 'baeckerei-huber-example',
    createdAt: '2025-06-20T08:00:00Z',
    certificate: { kind: 'self-signed' },
    databases: [],
    diskMb: 18,
    managed: true,
  },
  {
    domain: 'api.muster-ag.example',
    type: 'nodejs',
    siteUser: 'api-muster-ag-example',
    nodejsVersion: '22',
    appPort: 3001,
    createdAt: '2026-03-02T16:45:00Z',
    certificate: null,
    databases: [],
    diskMb: 240,
    managed: true,
  },
  {
    domain: 'cp.weblion.demo',
    type: 'nodejs',
    siteUser: 'weblion-cp',
    nodejsVersion: '22',
    appPort: 3000,
    createdAt: '2024-01-08T10:00:00Z',
    certificate: { kind: 'letsencrypt', days: 45 },
    databases: [{ name: 'weblion', sizeMb: null }],
    diskMb: null,
    managed: false,
  },
  {
    domain: 'legacy.kunde.example',
    type: 'php',
    siteUser: 'legacy',
    application: 'Generic',
    phpVersion: '7.4',
    createdAt: '2019-11-04T12:00:00Z',
    certificate: { kind: 'letsencrypt', days: 30 },
    databases: [{ name: 'legacy_web', sizeMb: null }],
    diskMb: null,
    managed: false,
  },
];

const TEMPLATES: WebsiteTemplate[] = [
  { name: 'Generic', rootDirectory: '' },
  { name: 'WordPress', rootDirectory: '' },
  { name: 'WooCommerce', rootDirectory: '' },
  { name: 'Laravel 12', rootDirectory: 'public' },
  { name: 'Static', rootDirectory: '' },
  { name: 'Nodejs', rootDirectory: '' },
  { name: 'Python', rootDirectory: '' },
  { name: 'ReverseProxy', rootDirectory: '' },
];

const letsEncrypt = (expiresMs: number): WebsiteCertificate => ({
  type: CERT_TYPE_LETS_ENCRYPT,
  letsEncrypt: true,
  expiresAt: iso(expiresMs),
});

const selfSigned = (fromMs: number): WebsiteCertificate => ({
  type: CERT_TYPE_SELF_SIGNED,
  letsEncrypt: false,
  expiresAt: iso(fromMs + SELF_SIGNED_DAYS * DAY),
});

function generate(): DemoCloudPanelState {
  const now = Date.now();
  const measuredAt = iso(Math.floor(now / USAGE_INTERVAL) * USAGE_INTERVAL);
  const state: DemoCloudPanelState = {
    server: {
      hostname: DEMO_CLOUDPANEL_HOST,
      os: 'Ubuntu 24.04.3 LTS',
      cloudpanelVersion: '2.5.4-3+clp-noble',
      cliVersion: 'CloudPanel CLI 6.0.8',
      agentVersion: '1.0.0',
      protocol: 1,
      ipv4: [DEMO_CLOUDPANEL_IPV4],
      ipv6: [DEMO_CLOUDPANEL_IPV6],
      phpVersions: ['8.5', '8.4', '8.3', '8.2', '8.1', '7.4'],
      templates: TEMPLATES.map((t) => ({ ...t })),
      nodejsVersions: ['18', '20', '22', '24'],
      nodejsEnabled: true,
      allowRemoteAdopt: true,
      protectedDomains: ['cp.weblion.demo'],
      protectedUsers: ['root', 'clp', 'weblion-agent', 'weblion-cp'],
    },
    sites: new Map(),
    managed: new Map(),
    failures: new Map(),
  };
  for (const seed of SITES) {
    const measured = seed.diskMb !== null;
    state.sites.set(seed.domain, {
      domain: seed.domain,
      type: seed.type,
      siteUser: seed.siteUser,
      application: seed.application ?? null,
      rootDirectory: seed.rootDirectory ?? '',
      phpVersion: seed.phpVersion ?? null,
      nodejsVersion: seed.nodejsVersion ?? null,
      appPort: seed.appPort ?? null,
      createdAt: seed.createdAt,
      certificate:
        seed.certificate === null
          ? null
          : seed.certificate.kind === 'letsencrypt'
            ? letsEncrypt(now + seed.certificate.days * DAY)
            : selfSigned(Date.parse(seed.createdAt)),
      databases: seed.databases.map((d) => ({
        name: d.name,
        users: [d.name],
        sizeBytes: measured && d.sizeMb !== null ? d.sizeMb * MiB : null,
      })),
      usage: measured ? { diskBytes: seed.diskMb! * MiB, measuredAt } : null,
    });
    if (seed.managed) state.managed.set(seed.domain, { siteUser: seed.siteUser, source: 'create' });
  }
  return state;
}

/** The simulated server of a connection, created with the seed on first use. */
export function demoCloudPanelState(connectionId: string): DemoCloudPanelState {
  let state = STATE.get(connectionId);
  if (!state) {
    state = generate();
    STATE.set(connectionId, state);
  }
  return state;
}

// --- Errors as the real adapter maps the wrapper's codes -------------------------------

const invalid = (field: string, message: string) => badRequest(message, [{ path: field, message }]);
const exists = (field: string, message: string) => new AppError(409, 'exists', message, { field });
const notManaged = (message: string) => new AppError(409, 'not_managed', message);
const protectedSite = (message: string) => new AppError(409, 'protected', message);
const notFound = (message: string) => new ProviderError(PROVIDER, message, 404);
const clpctlFailed = (message: string, details: { rolledBack?: boolean; output?: string }) =>
  new ProviderError(PROVIDER, message, undefined, details);

// --- Checks (the wrapper's argument patterns) ------------------------------------------

function checkDomain(domain: string): void {
  if (typeof domain !== 'string' || domain.length < 4 || websiteDomainAscii(domain) !== domain) {
    throw invalid(
      'domain',
      `${String(domain).slice(0, 80)} is not a valid domain name (lower-case ASCII, e.g. shop.example.ch)`,
    );
  }
}

function checkSiteUser(siteUser: string): void {
  if (typeof siteUser !== 'string' || !SITE_USER_PATTERN.test(siteUser)) {
    throw invalid('siteUser', 'Site users have 3 to 32 characters: a-z, 0-9 and "-", starting with a letter');
  }
  if (isReservedSiteUser(siteUser)) throw invalid('siteUser', `${siteUser} is a reserved user name`);
}

/** Never puts the password into the message. */
function checkPassword(field: string, password: string): void {
  if (typeof password !== 'string' || !WEBSITE_PASSWORD_PATTERN.test(password)) {
    throw invalid(field, 'Passwords need 12 to 128 characters: letters, digits and !#%*+,-./;<=>?@^_{|}~');
  }
}

function checkDatabaseName(field: string, name: string): void {
  if (typeof name !== 'string' || !WEBSITE_DB_NAME_PATTERN.test(name)) {
    throw invalid(
      field,
      `${String(name).slice(0, 40)} is not a valid database name (a-z, 0-9 and "_", at most 32 characters)`,
    );
  }
}

/** Database and user of a site start with "<prefix>_"; system schemas are never touched. */
function checkDatabasePrefix(field: string, siteUser: string, names: string[]): void {
  const prefix = `${websiteDatabasePrefix(siteUser)}_`;
  for (const name of names) {
    if (!name.startsWith(prefix)) throw invalid(field, `Databases of this site start with ${prefix}`);
    if (SYSTEM_SCHEMAS.includes(name)) throw invalid(field, `${name} is a system schema`);
  }
}

/** "8.4" before "8.3" before "7.4". */
function newestFirst(a: string, b: string): number {
  const [aMajor, aMinor] = a.split('.').map(Number) as [number, number];
  const [bMajor, bMinor] = b.split('.').map(Number) as [number, number];
  return bMajor - aMajor || bMinor - aMinor;
}

/** Exact names, or prefixes before a trailing "*" ("Laravel*" matches "Laravel 12"). */
function templateAllowed(name: string, patterns: string[]): boolean {
  return patterns.some((p) => (p.endsWith('*') ? name.startsWith(p.slice(0, -1)) : name === p));
}

// --- Mapping: the wrapper's answer, then the adapter's ---------------------------------

function webRoot(site: DemoWebsite): string {
  const folder = `/home/${site.siteUser}/htdocs/${site.domain}`;
  return site.rootDirectory ? `${folder}/${site.rootDirectory}` : folder;
}

function toWireSite(site: DemoWebsite): WireSite {
  const measured = site.databases.filter((d) => d.sizeBytes !== null);
  return {
    domain: site.domain,
    type: site.type,
    siteUser: site.siteUser,
    homeDirectory: `/home/${site.siteUser}`,
    webRoot: webRoot(site),
    application: site.application,
    phpVersion: site.phpVersion,
    nodejsVersion: site.nodejsVersion,
    appPort: site.appPort,
    createdAt: site.createdAt,
    certificate: site.certificate ? { ...site.certificate } : null,
    databases: site.databases.map((d) => ({ name: d.name, users: [...d.users], sizeBytes: d.sizeBytes })),
    usage: site.usage
      ? {
          diskBytes: site.usage.diskBytes,
          databaseBytes: measured.reduce((sum, d) => sum + d.sizeBytes!, 0),
          measuredAt: site.usage.measuredAt,
        }
      : null,
  };
}

function toRemote(site: DemoWebsite): RemoteWebsite {
  const wire = toWireSite(site);
  return {
    domain: wire.domain,
    facts: {
      type: wire.type,
      siteUser: wire.siteUser,
      homeDirectory: wire.homeDirectory,
      webRoot: wire.webRoot,
      application: wire.application,
      phpVersion: wire.phpVersion,
      nodejsVersion: wire.nodejsVersion,
      appPort: wire.appPort,
      certificate: wire.certificate,
      databases: wire.databases.length,
      diskBytes: wire.usage?.diskBytes ?? null,
      databaseBytes: wire.usage?.databaseBytes ?? null,
      usageMeasuredAt: wire.usage?.measuredAt ?? null,
      createdAt: wire.createdAt,
    },
    databases: wire.databases,
  };
}

// --- Adapter ---------------------------------------------------------------------------

export class DemoCloudPanelAdapter implements ProviderAdapter {
  readonly type = 'demo' as const;

  constructor(
    private readonly connectionId: string,
    private readonly config: DemoConfig = {},
  ) {}

  /** Forgets the simulated state of every connection (tests). */
  static reset(): void {
    STATE.clear();
  }

  /**
   * Test hook: the next call of `method` on this connection throws `error`, before it does
   * anything, or with `afterEffect` after its change was applied (an answer lost on the way).
   * A call that fails on its own still throws its own error and uses the hook up.
   */
  static failNext(
    connectionId: string,
    method: DemoCloudPanelMethod,
    error: Error,
    options: { afterEffect?: boolean } = {},
  ): void {
    const failures = demoCloudPanelState(connectionId).failures;
    failures.set(method, [
      ...(failures.get(method) ?? []),
      { error, afterEffect: options.afterEffect ?? false },
    ]);
  }

  /** Looked up on every call, so a cached adapter sees the state after reset(). */
  private get state(): DemoCloudPanelState {
    return demoCloudPanelState(this.connectionId);
  }

  /** Runs one operation like one request to the wrapper, with the failNext hook around it. */
  private async run<T>(
    method: DemoCloudPanelMethod,
    operation: (state: DemoCloudPanelState) => T,
  ): Promise<T> {
    const state = this.state;
    const failure = state.failures.get(method)?.shift();
    if (failure && !failure.afterEffect) throw failure.error;
    const result = operation(state);
    if (failure) throw failure.error;
    return result;
  }

  private isProtectedDomain(state: DemoCloudPanelState, domain: string): boolean {
    return state.server.protectedDomains.includes(domain);
  }

  private isProtectedUser(state: DemoCloudPanelState, user: string): boolean {
    return state.server.protectedUsers.includes(user);
  }

  /** The wrapper's guard for every change: not protected, managed, in CloudPanel, same site user. */
  private guard(state: DemoCloudPanelState, domain: string): DemoWebsite {
    if (this.isProtectedDomain(state, domain)) {
      throw protectedSite(`${domain} is on the protected list of this server`);
    }
    const entry = state.managed.get(domain);
    if (!entry) throw notManaged(`${domain} is not managed by the console on this server`);
    const site = state.sites.get(domain);
    if (!site) throw notFound(`There is no site ${domain} in CloudPanel`);
    if (this.isProtectedUser(state, site.siteUser)) {
      throw protectedSite(`The user ${site.siteUser} of ${domain} is on the protected list of this server`);
    }
    if (site.siteUser !== entry.siteUser) {
      throw notManaged(`The site user of ${domain} changed in CloudPanel`);
    }
    return site;
  }

  private managedSites(state: DemoCloudPanelState): DemoWebsite[] {
    return [...state.managed.keys()]
      .sort()
      .map((domain) => state.sites.get(domain))
      .filter((site): site is DemoWebsite => site !== undefined);
  }

  private unmanaged(state: DemoCloudPanelState): { sites: UnmanagedWebsiteDto[]; allowRemoteAdopt: boolean } {
    const sites = [...state.sites.values()]
      .filter((site) => !state.managed.has(site.domain))
      .sort((a, b) => (a.domain < b.domain ? -1 : 1))
      .map((site) => ({
        domain: site.domain,
        type: site.type,
        siteUser: site.siteUser,
        protected: this.isProtectedDomain(state, site.domain) || this.isProtectedUser(state, site.siteUser),
      }));
    return { sites, allowRemoteAdopt: state.server.allowRemoteAdopt };
  }

  private info(state: DemoCloudPanelState): WireInfo {
    const server = state.server;
    const managed = this.managedSites(state).length;
    return {
      agentVersion: server.agentVersion,
      protocol: server.protocol,
      cloudpanelVersion: server.cloudpanelVersion,
      cliVersion: server.cliVersion,
      hostname: server.hostname,
      os: server.os,
      ipv4: [...server.ipv4],
      ipv6: [...server.ipv6],
      phpVersions: [...server.phpVersions],
      templates: server.templates.map((t) => ({ ...t })),
      nodejsVersions: [...server.nodejsVersions],
      nodejsEnabled: server.nodejsEnabled,
      allowRemoteAdopt: server.allowRemoteAdopt,
      protectedDomains: [...server.protectedDomains],
      counts: { sites: state.sites.size, managed, unmanaged: state.sites.size - managed },
    };
  }

  private linuxUsers(state: DemoCloudPanelState): Set<string> {
    return new Set([...SYSTEM_USERS, ...[...state.sites.values()].map((s) => s.siteUser)]);
  }

  private databases(state: DemoCloudPanelState): DemoWebsiteDatabase[] {
    return [...state.sites.values()].flatMap((s) => s.databases);
  }

  /** Lowest port of the range no site uses. */
  private freePort(state: DemoCloudPanelState): number {
    const used = new Set([...state.sites.values()].map((s) => s.appPort));
    for (let port = NODEJS_PORTS.first; port <= NODEJS_PORTS.last; port++) {
      if (!used.has(port)) return port;
    }
    throw new ProviderError(
      PROVIDER,
      `No free app port between ${NODEJS_PORTS.first} and ${NODEJS_PORTS.last}`,
    );
  }

  /** MySQL names are per server: database names and user names of every site count. */
  private checkDatabaseFree(
    state: DemoCloudPanelState,
    db: { name: string; userName: string },
    fields: { name: string; userName: string },
  ): void {
    const all = this.databases(state);
    if (all.some((d) => d.name === db.name)) {
      throw exists(fields.name, `The database ${db.name} already exists on this server`);
    }
    if (all.some((d) => d.users.includes(db.userName))) {
      throw exists(fields.userName, `The database user ${db.userName} already exists on this server`);
    }
  }

  capabilities(): Capability[] {
    return [];
  }

  powerActions(): PowerAction[] {
    return [];
  }

  async testConnection(): Promise<Record<string, unknown>> {
    return this.run('testConnection', (state) => {
      const info = this.info(state);
      return {
        flavor: 'cloudpanel',
        hostname: info.hostname,
        cloudpanelVersion: info.cloudpanelVersion,
        agentVersion: info.agentVersion,
        sites: info.counts.sites,
        managed: info.counts.managed,
        unmanaged: info.counts.unmanaged,
        phpVersions: info.phpVersions.join(', '),
        allowRemoteAdopt: info.allowRemoteAdopt,
        publicKey: null,
      };
    });
  }

  async listServers(): Promise<RemoteServer[]> {
    return [];
  }

  async getServer(ref: ServerRef): Promise<RemoteServer> {
    throw new ProviderError(PROVIDER, `CloudPanel has no servers (${ref.externalId})`, 404);
  }

  // --- Server -------------------------------------------------------------------------

  async websiteServerInfo(_fresh?: boolean): Promise<WebsiteServerInfo> {
    return this.run('websiteServerInfo', (state) => {
      const { cliVersion: _cliVersion, ...info } = this.info(state);
      return info;
    });
  }

  /** Server facts filtered by the connection config, exactly like the real adapter. */
  async websiteServerOptions(): Promise<WebsiteServerOptions> {
    return this.run('websiteServerOptions', (state) => {
      const server = state.server;
      const allowedPhp = this.config.phpVersions ?? DEFAULT_PHP_VERSIONS;
      const phpVersions = server.phpVersions.filter((v) => allowedPhp.includes(v)).sort(newestFirst);
      const allowedTemplates = this.config.templates ?? DEFAULT_TEMPLATES;
      return {
        types: [
          'php' as const,
          'static' as const,
          ...(this.config.nodejs && server.nodejsEnabled ? ['nodejs' as const] : []),
        ],
        phpVersions,
        defaultPhpVersion: phpVersions[0] ?? null,
        templates: server.templates
          .filter((t) => !TYPE_TEMPLATES.includes(t.name) && templateAllowed(t.name, allowedTemplates))
          .map((t) => ({ ...t })),
        nodejsVersions: server.nodejsVersions.filter((v) => Number(v) >= MIN_NODEJS_OFFERED),
        accessHost: this.websiteAccessHost(),
        ipv4: [...server.ipv4],
        ipv6: [...server.ipv6],
      };
    });
  }

  websiteAccessHost(): string {
    return DEMO_CLOUDPANEL_HOST;
  }

  /**
   * Simulated public DNS for the DNS check: managed sites and their www counterparts point to
   * the server, names containing "nodns" have no answer, names containing "elsewhere" point to
   * another host. Every other name has no answer, so the demo never asks real DNS.
   */
  websiteDnsOverride(name: string): { a: string[]; aaaa: string[] } {
    const host = name.trim().toLowerCase().replace(/\.$/, '');
    if (host.includes('nodns')) return { a: [], aaaa: [] };
    if (host.includes('elsewhere')) return { a: [DEMO_ELSEWHERE_IPV4], aaaa: [] };
    const state = this.state;
    const served = this.managedSites(state).some(
      (s) => s.domain === host || wwwCounterpart(s.domain) === host,
    );
    return served ? { a: [...state.server.ipv4], aaaa: [...state.server.ipv6] } : { a: [], aaaa: [] };
  }

  // --- Sites --------------------------------------------------------------------------

  async listWebsites(): Promise<RemoteWebsite[]> {
    return this.run('listWebsites', (state) => this.managedSites(state).map(toRemote));
  }

  async getWebsite(domain: string): Promise<RemoteWebsite> {
    return this.run('getWebsite', (state) => {
      checkDomain(domain);
      if (!state.managed.has(domain)) {
        throw notManaged(`${domain} is not managed by the console on this server`);
      }
      const site = state.sites.get(domain);
      if (!site) throw notFound(`There is no site ${domain} in CloudPanel`);
      return toRemote(site);
    });
  }

  async listUnmanagedWebsites(): Promise<{ sites: UnmanagedWebsiteDto[]; allowRemoteAdopt: boolean }> {
    return this.run('listUnmanagedWebsites', (state) => this.unmanaged(state));
  }

  /** Checks in the wrapper's order: arguments, protected list, existing users and sites, server facts. */
  async createWebsite(input: WebsiteInput): Promise<{ website: RemoteWebsite; warnings: string[] }> {
    return this.run('createWebsite', (state) => {
      const { domain, type, siteUser, database } = input;
      checkDomain(domain);
      if (!(CREATABLE_WEBSITE_TYPES as readonly string[]).includes(type)) {
        throw invalid('type', `Sites of type ${String(type)} cannot be created`);
      }
      checkSiteUser(siteUser);
      checkPassword('password', input.password);
      if (type === 'php') {
        if (!input.phpVersion || !PHP_VERSION_PATTERN.test(input.phpVersion)) {
          throw invalid('phpVersion', `${String(input.phpVersion).slice(0, 16)} is not a PHP version`);
        }
        if (!input.template || !WEBSITE_TEMPLATE_PATTERN.test(input.template)) {
          throw invalid('template', `${String(input.template).slice(0, 40)} is not a vhost template name`);
        }
      }
      if (
        type === 'nodejs' &&
        !(NODEJS_VERSIONS as readonly (string | null)[]).includes(input.nodejsVersion)
      ) {
        throw invalid(
          'nodejsVersion',
          `${String(input.nodejsVersion).slice(0, 16)} is not a Node.js LTS version`,
        );
      }
      if (database) {
        checkDatabaseName('database', database.name);
        checkDatabaseName('database', database.userName);
        checkPassword('database', database.password);
      }

      if (this.isProtectedDomain(state, domain)) {
        throw protectedSite(`${domain} is on the protected list of this server`);
      }
      if (this.isProtectedUser(state, siteUser)) {
        throw protectedSite(`${siteUser} is on the protected list of this server`);
      }
      if (this.linuxUsers(state).has(siteUser)) {
        throw exists('siteUser', `The Linux user ${siteUser} already exists`);
      }
      if (state.sites.has(domain)) {
        throw exists('domain', `The site ${domain} already exists in CloudPanel`);
      }

      let template: WebsiteTemplate | undefined;
      if (type === 'php') {
        template = state.server.templates.find((t) => t.name === input.template);
        if (!template) throw invalid('template', `CloudPanel has no vhost template ${input.template}`);
        if (!state.server.phpVersions.includes(input.phpVersion!)) {
          throw invalid('phpVersion', `PHP ${input.phpVersion} is not installed on this server`);
        }
      }
      let appPort: number | null = null;
      if (type === 'nodejs') {
        if (!state.server.nodejsEnabled) {
          throw invalid('type', 'Node.js sites are switched off on this server');
        }
        appPort = this.freePort(state);
      }
      if (database) {
        checkDatabasePrefix('database', siteUser, [database.name, database.userName]);
        this.checkDatabaseFree(state, database, { name: 'database', userName: 'database' });
      }

      const now = Date.now();
      const site: DemoWebsite = {
        domain,
        type,
        siteUser,
        application: template?.name ?? null,
        rootDirectory: template?.rootDirectory ?? '',
        phpVersion: type === 'php' ? input.phpVersion : null,
        nodejsVersion: type === 'nodejs' ? input.nodejsVersion : null,
        appPort,
        createdAt: iso(now),
        certificate: selfSigned(now),
        databases: [],
        usage: null,
      };
      state.sites.set(domain, site);
      state.managed.set(domain, { siteUser, source: 'create' });
      const warnings: string[] = [];
      if (database) {
        // A name with "fail" plays a failing clpctl db:add: the site stays, like on a real server.
        if (database.name.includes('fail')) {
          warnings.push(`The database could not be created: clpctl db:add failed for ${database.name}`);
        } else {
          site.databases.push({ name: database.name, users: [database.userName], sizeBytes: null });
        }
      }
      return { website: toRemote(site), warnings };
    });
  }

  async deleteWebsite(domain: string): Promise<{ warnings: string[] }> {
    return this.run('deleteWebsite', (state) => {
      checkDomain(domain);
      this.guard(state, domain);
      state.sites.delete(domain);
      state.managed.delete(domain);
      return { warnings: [] };
    });
  }

  /** The password is checked and dropped. */
  async setWebsitePassword(domain: string, password: string): Promise<void> {
    return this.run('setWebsitePassword', (state) => {
      checkDomain(domain);
      checkPassword('password', password);
      this.guard(state, domain);
    });
  }

  // --- Databases ----------------------------------------------------------------------

  async createWebsiteDatabase(domain: string, input: WebsiteDatabaseInput): Promise<RemoteWebsite> {
    return this.run('createWebsiteDatabase', (state) => {
      checkDomain(domain);
      checkDatabaseName('name', input.name);
      checkDatabaseName('userName', input.userName);
      checkPassword('password', input.password);
      const site = this.guard(state, domain);
      checkDatabasePrefix('name', site.siteUser, [input.name]);
      checkDatabasePrefix('userName', site.siteUser, [input.userName]);
      this.checkDatabaseFree(state, input, { name: 'name', userName: 'userName' });
      // A name with "fail" plays a failing clpctl db:add, which the wrapper rolls back.
      if (input.name.includes('fail')) {
        const output = `Database "${input.name}" could not be created.`;
        throw clpctlFailed(`clpctl db:add failed for ${input.name}`, { rolledBack: true, output });
      }
      site.databases.push({ name: input.name, users: [input.userName], sizeBytes: null });
      return toRemote(site);
    });
  }

  /** The password is checked and dropped. */
  async setWebsiteDatabasePassword(
    domain: string,
    name: string,
    userName: string,
    password: string,
  ): Promise<void> {
    return this.run('setWebsiteDatabasePassword', (state) => {
      checkDomain(domain);
      checkDatabaseName('name', name);
      checkDatabaseName('userName', userName);
      checkPassword('password', password);
      const site = this.guard(state, domain);
      const database = site.databases.find((d) => d.name === name);
      if (!database) throw notFound(`The database ${name} does not belong to ${domain}`);
      if (!database.users.includes(userName)) {
        throw invalid('userName', `${userName} is not a user of the database ${name}`);
      }
    });
  }

  async deleteWebsiteDatabase(domain: string, name: string): Promise<RemoteWebsite> {
    return this.run('deleteWebsiteDatabase', (state) => {
      checkDomain(domain);
      checkDatabaseName('name', name);
      const site = this.guard(state, domain);
      if (!site.databases.some((d) => d.name === name)) {
        throw notFound(`The database ${name} does not belong to ${domain}`);
      }
      site.databases = site.databases.filter((d) => d.name !== name);
      return toRemote(site);
    });
  }

  // --- Certificates, adoption ---------------------------------------------------------

  /**
   * Let's Encrypt for the domain and its www counterpart. Fails like Let's Encrypt when the
   * simulated DNS has no answer for one of them; a name pointing elsewhere (a CDN that forwards
   * the challenge) gets its certificate.
   */
  async issueWebsiteCertificate(domain: string): Promise<RemoteWebsite> {
    return this.run('issueWebsiteCertificate', (state) => {
      checkDomain(domain);
      const site = this.guard(state, domain);
      for (const name of [domain, wwwCounterpart(domain)]) {
        const answer = this.websiteDnsOverride(name);
        if (answer.a.length === 0 && answer.aaaa.length === 0) {
          const output = `DNS problem: NXDOMAIN looking up A for ${name} - check that a DNS record exists for this domain`;
          throw clpctlFailed(`Let's Encrypt refused the certificate: ${output}`, { output });
        }
      }
      site.certificate = letsEncrypt(Date.now() + CERTIFICATE_DAYS * DAY);
      return toRemote(site);
    });
  }

  async adoptWebsite(domain: string): Promise<RemoteWebsite> {
    return this.run('adoptWebsite', (state) => {
      checkDomain(domain);
      if (!state.server.allowRemoteAdopt) {
        throw new AppError(
          409,
          'adopt_disabled',
          `Adopting sites from the console is switched off on this server. Run "sudo weblion-clp adopt ${domain}" there.`,
        );
      }
      const site = state.sites.get(domain);
      if (!site) throw notFound(`There is no site ${domain} in CloudPanel`);
      if (this.isProtectedDomain(state, domain) || this.isProtectedUser(state, site.siteUser)) {
        throw protectedSite(`${domain} is on the protected list of this server`);
      }
      if (state.managed.has(domain)) throw exists('domain', `${domain} is managed already`);
      state.managed.set(domain, { siteUser: site.siteUser, source: 'adopt' });
      return toRemote(site);
    });
  }

  /** Drops the site from the managed list (fine when it is not on it); the site stays. */
  async forgetWebsite(domain: string): Promise<void> {
    return this.run('forgetWebsite', (state) => {
      checkDomain(domain);
      state.managed.delete(domain);
    });
  }

  /** Explorer: the three read operations of the real adapter, with the wrapper's answers. */
  async rawRequest(method: string, path: string): Promise<RawResponse> {
    const state = this.state;
    if (method.trim().toUpperCase() === 'GET') {
      const op = path.trim();
      if (op === '/info') return { status: 200, data: this.info(state) };
      if (op === '/list') return { status: 200, data: { sites: this.managedSites(state).map(toWireSite) } };
      if (op === '/unmanaged') return { status: 200, data: this.unmanaged(state) };
    }
    throw badRequest('The CloudPanel explorer only offers GET /info, /list and /unmanaged');
  }
}
