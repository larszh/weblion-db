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
  type Capability,
  type CreatableWebsiteType,
  type PowerAction,
  type UnmanagedWebsiteDto,
  type WebsiteServerOptions,
} from '@weblion/shared';
import { ProviderError, badRequest } from '../../lib/errors';
import type {
  CloudPanelConfig,
  ProviderAdapter,
  RawResponse,
  RemoteServer,
  RemoteWebsite,
  ServerRef,
  WebsiteDatabaseInput,
  WebsiteInput,
  WebsiteServerInfo,
  WireOps,
} from '../types';
import { CloudPanelClient, type CloudPanelLog } from './client';
import { publicKeyLine } from './keys';
import { PROVIDER, WIRE_PROTOCOL, toRemoteWebsite } from './protocol';
import { Ssh2Transport, type SshTransport } from './ssh';

const INFO_TTL_MS = 600_000;
const LIST_TTL_MS = 15_000;

/** What customers may choose unless the connection config says otherwise (open questions 19.15, 19.16). */
const DEFAULT_PHP_VERSIONS = ['8.3', '8.4'];
const DEFAULT_TEMPLATES = ['Generic', 'WordPress', 'WooCommerce'];
/** Templates CloudPanel lists for the other site types; never a choice for a PHP site. */
const TYPE_TEMPLATES = new Set(['Static', 'Nodejs', 'Python', 'ReverseProxy']);
/** Node.js majors still offered to customers. */
const MIN_NODEJS_MAJOR = 20;
/** The clpctl shebang and the clpctlWrapper privilege escalation are fixed from here on. */
const MIN_CLOUDPANEL = '2.5.0';
const SYSTEM_SCHEMAS = new Set(['mysql', 'sys', 'information_schema', 'performance_schema']);

/** Paths of the admin explorer: read operations only. */
const RAW_OPS = new Map<string, 'info' | 'list' | 'unmanaged'>([
  ['/info', 'info'],
  ['/list', 'list'],
  ['/unmanaged', 'unmanaged'],
]);

export interface CloudPanelAdapterOptions {
  /** Default: SSH with ssh2 to config.host. Tests pass a fake. */
  transport?: SshTransport;
  /** Clock for the caches, default Date.now. */
  now?: () => number;
  log?: CloudPanelLog;
  /** Calls waiting for the server before "busy", default 20. */
  maxQueue?: number;
}

interface CacheEntry<T> {
  at: number;
  value: Promise<T>;
}

/** 400 with the field in the details, as the routes' validation reports it. */
function invalid(field: string, message: string) {
  return badRequest(message, [{ path: field, message }]);
}

function assertDomain(domain: string): string {
  if (typeof domain !== 'string' || websiteDomainAscii(domain) !== domain) {
    throw invalid(
      'domain',
      `"${String(domain).slice(0, 80)}" is not a valid domain name (lower case, IDN as punycode)`,
    );
  }
  return domain;
}

function assertPassword(password: string, field: string): string {
  if (typeof password !== 'string' || !WEBSITE_PASSWORD_PATTERN.test(password)) {
    throw invalid(
      field,
      'The password needs 12 to 128 characters: letters, digits and !#%*+,-./;<=>?@^_{|}~',
    );
  }
  return password;
}

function assertDatabaseName(name: string, field: string): string {
  if (typeof name !== 'string' || !WEBSITE_DB_NAME_PATTERN.test(name) || SYSTEM_SCHEMAS.has(name)) {
    throw invalid(field, `"${String(name).slice(0, 40)}" is not a valid database name`);
  }
  return name;
}

/** "8.4" before "8.3" before "7.4". */
function comparePhpDesc(a: string, b: string): number {
  const key = (v: string) => {
    const [major = 0, minor = 0] = v.split('.').map(Number);
    return major * 100 + minor;
  };
  return key(b) - key(a);
}

/** Whether a Debian package version ("2.5.4-3+clp-noble", "1:2.5.0") is at least `min` ("2.5.0"). */
export function cloudPanelVersionAtLeast(version: string | null, min: string): boolean {
  const match = /^(?:\d+:)?(\d+)\.(\d+)(?:\.(\d+))?/.exec(version?.trim() ?? '');
  if (!match) return false;
  const have = [match[1], match[2], match[3]].map((n) => Number(n ?? 0));
  const want = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const h = have[i] ?? 0;
    const w = want[i] ?? 0;
    if (h !== w) return h > w;
  }
  return true;
}

/** An entry of config.templates: an exact name, or a prefix ending in "*" ("Laravel*"). */
function templateMatches(pattern: string, name: string): boolean {
  return pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern;
}

/**
 * A CloudPanel server (websites), reached over SSH through the root wrapper weblion-clp, which
 * runs a closed list of operations with validated arguments (wire protocol v1). No servers.
 * Websites are addressed by their ASCII domain; only sites on the server's managed list exist
 * for these methods. Passwords travel in the request's secrets only and are never kept.
 */
export class CloudPanelAdapter implements ProviderAdapter {
  readonly type = 'cloudpanel' as const;
  private readonly client: CloudPanelClient;
  private readonly now: () => number;
  private info: CacheEntry<WebsiteServerInfo> | null = null;
  private list: CacheEntry<RemoteWebsite[]> | null = null;

  constructor(
    private readonly config: CloudPanelConfig,
    options: CloudPanelAdapterOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.client = new CloudPanelClient(options.transport ?? new Ssh2Transport(config), {
      host: config.host,
      log: options.log,
      maxQueue: options.maxQueue,
    });
  }

  capabilities(): Capability[] {
    return [];
  }

  powerActions(): PowerAction[] {
    return [];
  }

  async testConnection(): Promise<Record<string, unknown>> {
    const info = await this.websiteServerInfo(true);
    if (info.protocol !== WIRE_PROTOCOL) {
      throw new ProviderError(
        PROVIDER,
        `The agent on ${this.config.host} speaks protocol ${info.protocol}, the console ${WIRE_PROTOCOL}: update weblion-clp`,
      );
    }
    if (!cloudPanelVersionAtLeast(info.cloudpanelVersion, MIN_CLOUDPANEL)) {
      throw new ProviderError(
        PROVIDER,
        `CloudPanel ${info.cloudpanelVersion ?? '(version unknown)'} on ${this.config.host} is not supported: ` +
          `the console needs ${MIN_CLOUDPANEL} or newer`,
      );
    }
    return {
      hostname: info.hostname,
      cloudpanelVersion: info.cloudpanelVersion,
      agentVersion: info.agentVersion,
      sites: info.counts.sites,
      managed: info.counts.managed,
      unmanaged: info.counts.unmanaged,
      phpVersions: info.phpVersions.join(', '),
      allowRemoteAdopt: info.allowRemoteAdopt,
      publicKey: publicKeyLine(this.config.privateKey),
    };
  }

  async listServers(): Promise<RemoteServer[]> {
    return [];
  }

  async getServer(ref: ServerRef): Promise<RemoteServer> {
    throw new ProviderError(PROVIDER, `CloudPanel has no servers (${ref.externalId})`, 404);
  }

  // --- Server facts ---------------------------------------------------------------------

  async websiteServerInfo(fresh = false): Promise<WebsiteServerInfo> {
    const now = this.now();
    let entry = this.info;
    if (fresh || !entry || now - entry.at >= INFO_TTL_MS) {
      const created: CacheEntry<WebsiteServerInfo> = {
        at: now,
        value: this.client.call('info', {}).then(({ cliVersion: _cliVersion, ...info }) => info),
      };
      this.info = entry = created;
      // A failed read is not kept: the next call asks again.
      created.value.catch(() => {
        if (this.info === created) this.info = null;
      });
    }
    return structuredClone(await entry.value);
  }

  async websiteServerOptions(): Promise<WebsiteServerOptions> {
    const info = await this.websiteServerInfo();
    const allowedPhp = this.config.phpVersions ?? DEFAULT_PHP_VERSIONS;
    const phpVersions = [...new Set(info.phpVersions)]
      .filter((v) => PHP_VERSION_PATTERN.test(v) && allowedPhp.includes(v))
      .sort(comparePhpDesc);
    const patterns = this.config.templates ?? DEFAULT_TEMPLATES;
    const templates = info.templates.filter(
      (t) =>
        WEBSITE_TEMPLATE_PATTERN.test(t.name) &&
        !TYPE_TEMPLATES.has(t.name) &&
        patterns.some((p) => templateMatches(p, t.name)),
    );
    const types: CreatableWebsiteType[] = ['php', 'static'];
    if (this.config.nodejs === true && info.nodejsEnabled) types.push('nodejs');
    const nodejsVersions = info.nodejsVersions.filter(
      (v) => (NODEJS_VERSIONS as readonly string[]).includes(v) && Number(v) >= MIN_NODEJS_MAJOR,
    );
    return {
      types,
      phpVersions,
      defaultPhpVersion: phpVersions[0] ?? null,
      templates,
      nodejsVersions,
      accessHost: this.websiteAccessHost(),
      ipv4: [...(this.config.ipv4 ?? info.ipv4)],
      ipv6: [...(this.config.ipv6 ?? info.ipv6)],
    };
  }

  websiteAccessHost(): string {
    return this.config.accessHost?.trim() || this.config.host;
  }

  // --- Reads ---------------------------------------------------------------------------

  async listWebsites(): Promise<RemoteWebsite[]> {
    const now = this.now();
    let entry = this.list;
    if (!entry || now - entry.at >= LIST_TTL_MS) {
      const created: CacheEntry<RemoteWebsite[]> = {
        at: now,
        value: this.client.call('list', {}).then((data) => data.sites.map(toRemoteWebsite)),
      };
      this.list = entry = created;
      created.value.catch(() => {
        if (this.list === created) this.list = null;
      });
    }
    return structuredClone(await entry.value);
  }

  async getWebsite(domain: string): Promise<RemoteWebsite> {
    const data = await this.client.call('get', { domain: assertDomain(domain) });
    return toRemoteWebsite(data.site);
  }

  async listUnmanagedWebsites(): Promise<{ sites: UnmanagedWebsiteDto[]; allowRemoteAdopt: boolean }> {
    return this.client.call('unmanaged', {});
  }

  // --- Changes ---------------------------------------------------------------------------

  async createWebsite(input: WebsiteInput): Promise<{ website: RemoteWebsite; warnings: string[] }> {
    // Checked again here (the agent checks once more): nothing invalid is ever sent.
    const domain = assertDomain(input.domain);
    if (!(CREATABLE_WEBSITE_TYPES as readonly string[]).includes(input.type)) {
      throw invalid('type', 'Websites are PHP, static or Node.js sites');
    }
    if (
      typeof input.siteUser !== 'string' ||
      !SITE_USER_PATTERN.test(input.siteUser) ||
      isReservedSiteUser(input.siteUser)
    ) {
      throw invalid(
        'siteUser',
        'The user name needs 3 to 32 characters: lower-case letters, digits and "-", starting with a letter',
      );
    }
    const password = assertPassword(input.password, 'password');

    const args: WireOps['create']['args'] = { domain, type: input.type, siteUser: input.siteUser };
    if (input.type === 'php') {
      if (typeof input.phpVersion !== 'string' || !PHP_VERSION_PATTERN.test(input.phpVersion)) {
        throw invalid('phpVersion', 'A PHP site needs a PHP version such as 8.4');
      }
      if (typeof input.template !== 'string' || !WEBSITE_TEMPLATE_PATTERN.test(input.template)) {
        throw invalid('template', 'A PHP site needs an application template such as WordPress');
      }
      args.phpVersion = input.phpVersion;
      args.template = input.template;
    } else if (input.type === 'nodejs') {
      if (!(NODEJS_VERSIONS as readonly (string | null)[]).includes(input.nodejsVersion)) {
        throw invalid(
          'nodejsVersion',
          `A Node.js site needs one of the versions ${NODEJS_VERSIONS.join(', ')}`,
        );
      }
      args.nodejsVersion = input.nodejsVersion!;
    }

    const secrets: WireOps['create']['secrets'] = { password };
    if (input.database) {
      const name = assertDatabaseName(input.database.name, 'database');
      const userName = assertDatabaseName(input.database.userName, 'database');
      const prefix = `${websiteDatabasePrefix(input.siteUser)}_`;
      if (!name.startsWith(prefix) || !userName.startsWith(prefix)) {
        throw invalid('database', `Database names of this website start with "${prefix}"`);
      }
      secrets.databasePassword = assertPassword(input.database.password, 'database');
      args.database = { name, userName };
    }

    return this.change(async () => {
      const data = await this.client.call('create', args, secrets);
      return { website: toRemoteWebsite(data.site), warnings: data.warnings };
    });
  }

  async deleteWebsite(domain: string): Promise<{ warnings: string[] }> {
    const args = { domain: assertDomain(domain) };
    return this.change(async () => ({ warnings: (await this.client.call('delete', args)).warnings }));
  }

  async setWebsitePassword(domain: string, password: string): Promise<void> {
    const args = { domain: assertDomain(domain) };
    const secrets = { password: assertPassword(password, 'password') };
    await this.change(() => this.client.call('password', args, secrets));
  }

  async createWebsiteDatabase(domain: string, input: WebsiteDatabaseInput): Promise<RemoteWebsite> {
    const args = {
      domain: assertDomain(domain),
      name: assertDatabaseName(input.name, 'name'),
      userName: assertDatabaseName(input.userName, 'userName'),
    };
    const secrets = { password: assertPassword(input.password, 'password') };
    return this.change(async () => toRemoteWebsite((await this.client.call('db-add', args, secrets)).site));
  }

  async setWebsiteDatabasePassword(
    domain: string,
    name: string,
    userName: string,
    password: string,
  ): Promise<void> {
    const args = {
      domain: assertDomain(domain),
      name: assertDatabaseName(name, 'name'),
      userName: assertDatabaseName(userName, 'userName'),
    };
    const secrets = { password: assertPassword(password, 'password') };
    await this.change(() => this.client.call('db-password', args, secrets));
  }

  async deleteWebsiteDatabase(domain: string, name: string): Promise<RemoteWebsite> {
    const args = { domain: assertDomain(domain), name: assertDatabaseName(name, 'name') };
    return this.change(async () => toRemoteWebsite((await this.client.call('db-delete', args)).site));
  }

  async issueWebsiteCertificate(domain: string): Promise<RemoteWebsite> {
    const args = { domain: assertDomain(domain) };
    return this.change(async () => toRemoteWebsite((await this.client.call('cert', args)).site));
  }

  async adoptWebsite(domain: string): Promise<RemoteWebsite> {
    const args = { domain: assertDomain(domain) };
    return this.change(async () => toRemoteWebsite((await this.client.call('adopt', args)).site));
  }

  async forgetWebsite(domain: string): Promise<void> {
    const args = { domain: assertDomain(domain) };
    await this.change(() => this.client.call('forget', args));
  }

  /** Explorer: the read operations only, answered as the agent sent them. */
  async rawRequest(method: string, path: string): Promise<RawResponse> {
    const op = method.trim().toUpperCase() === 'GET' ? RAW_OPS.get(path.trim()) : undefined;
    if (!op) throw badRequest('The CloudPanel explorer only offers GET /info, /list and /unmanaged');
    return { status: 200, data: await this.client.call(op, {}) };
  }

  /** A change on the server: the cached site list is outdated afterwards, whatever the outcome. */
  private async change<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } finally {
      this.list = null;
    }
  }
}
