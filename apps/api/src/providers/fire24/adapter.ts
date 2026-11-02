import type {
  BackupInfo,
  Capability,
  DdosSettings,
  DnsRecord,
  DnsRecordInput,
  DnsRecordType,
  DomainCapability,
  DomainInfo,
  ImageOption,
  IpAddress,
  IsoOption,
  MetricRange,
  MetricsResult,
  MonitoringInfo,
  PowerAction,
  ProviderTask,
  ServerUsage,
  WebspaceCredentials,
  WebspaceInfo,
  WebspaceResources,
} from '@weblion/shared';
import { AppError, ProviderError, badRequest, isScopeMissing, unsupported } from '../../lib/errors';
import { isRecord, mapLimit, str } from '../http';
import type {
  ActionResult,
  ConsoleSession,
  DnsRecordPatch,
  Fire24Config,
  InfraOverview,
  ProviderAdapter,
  RawResponse,
  RemoteDomain,
  RemoteServer,
  RemoteWebspace,
  ServerRef,
} from '../types';
import { checkId, Fire24Client, PROVIDER, type Fire24ClientOptions } from './client';
import {
  FIRE24_DDOS_LAYER4,
  FIRE24_DDOS_LAYER7,
  FIRE24_DNS_TYPES,
  FIRE24_ENDPOINTS,
  FIRE24_POWER_MODES,
  type Fire24EndpointName,
  type Fire24Scope,
} from './endpoints';
import {
  EMPTY_WEBSPACE_RESOURCES,
  hasSpecs,
  parseAccount,
  parseBackupId,
  parseBackupTask,
  parseBackups,
  parseConfig,
  parseConsole,
  parseDdos,
  parseDnsRecords,
  parseDomain,
  parseDomainItem,
  parseLoginUrl,
  parseMonitoring,
  parseNameservers,
  parseNetwork,
  parseOptions,
  parsePassword,
  parseRdns,
  parseReinstallStatus,
  parseRenewal,
  parseServerItem,
  parseServiceItem,
  parseStatus,
  parseStatusAttention,
  parseTrafficCurrent,
  parseWebspaceDetail,
  parseWebspaceItem,
  shapeKeys,
  webspaceName,
  type Fire24Account,
  type Fire24DomainItem,
  type Fire24ServerItem,
  type Fire24TrafficInfo,
  type Fire24WebspaceDetail,
  type Fire24WebspaceItem,
  type ParsedConfig,
} from './parse';

export type Fire24AdapterOptions = Fire24ClientOptions;

const RANGE_SECONDS: Record<MetricRange, number> = {
  hour: 3600,
  day: 86_400,
  week: 7 * 86_400,
  month: 31 * 86_400,
  year: 366 * 86_400,
};

const MINUTE = 60_000;
/** Cache lifetimes, see section 1.7 of the design. */
const TTL = {
  account: 5 * MINUTE,
  rdns: 10 * MINUTE,
  monitoring: MINUTE,
  options: 60 * MINUTE,
  detail: 30 * MINUTE,
  /** A refused 24fire+ DNS write is remembered like a missing scope. */
  plusRefusal: 10 * MINUTE,
} as const;

/** Capabilities and the token scope each one needs. A scope 24fire refused hides its capabilities. */
const CAPABILITY_SCOPES = {
  power: 'server:power',
  console: 'server:console',
  rebuild: 'server:reinstall',
  passwordReset: 'server:credentials',
  backups: 'server:backups',
  backupRestore: 'server:backups',
  backupDelete: 'server:backups',
  metrics: 'server:monitoring',
  monitoring: 'server:monitoring',
  traffic: 'server:read',
  ddos: 'server:read',
  rdns: 'server:network',
  iso: 'server:iso',
  config: 'server:read',
  networkInfo: 'server:read',
} as const satisfies Partial<Record<Capability, Fire24Scope>>;

/** Backup tasks are tracked as `backup-create:<id>` / `backup-restore:<id>`. */
const BACKUP_TASK_REF = /^backup-(create|restore):(.+)$/;
/** The reinstall is tracked with this ref; 24fire has one reinstall per server at a time. */
const REINSTALL_REF = 'reinstall';

const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
/** Name servers of 24fire's own DNS (v2 used ns1.fireapi.de, ns2.fireapi.de). */
const FIRE24_NAMESERVER = /\.(fireapi|24fire)\.de$/i;

/** The read probes of the connection test: the list scopes plus one detail per product type. */
const LIST_PROBES = [
  ['servers', 'servers:read'],
  ['domains', 'domains:read'],
  ['webspaces', 'webspaces:read'],
  ['services', 'services:read'],
] as const;

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

const nonNull = <T>(value: T | null): value is T => value !== null;

/** The key, the token or the connection is wrong: every other call would fail the same way. */
function isFatal(err: unknown): boolean {
  if (err instanceof ProviderError) return err.upstreamStatus === undefined;
  return err instanceof AppError && err.code === 'provider_auth';
}

/**
 * Values per key for a while, one load at a time per key. Failures are not kept. Dropping a key
 * also discards loads that started before, so a change is never overwritten by an older answer.
 */
class TtlCache<V> {
  private readonly values = new Map<string, { at: number; value: V }>();
  private readonly pending = new Map<string, Promise<V>>();
  /** Bumped by clear() for every key and by delete() for one key. */
  private epoch = 0;
  private readonly versions = new Map<string, number>();

  constructor(private readonly ttlMs: number) {}

  get(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.peek(key);
    if (hit !== undefined) return Promise.resolve(hit);
    const running = this.pending.get(key);
    if (running) return running;
    const version = this.version(key);
    const promise = load()
      .then((value) => {
        if (this.ttlMs > 0 && version === this.version(key)) this.values.set(key, { at: Date.now(), value });
        return value;
      })
      .finally(() => {
        if (this.pending.get(key) === promise) this.pending.delete(key);
      });
    this.pending.set(key, promise);
    return promise;
  }

  peek(key: string): V | undefined {
    const hit = this.values.get(key);
    return hit && Date.now() - hit.at < this.ttlMs ? hit.value : undefined;
  }

  delete(key: string) {
    this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
    this.values.delete(key);
    this.pending.delete(key);
  }

  clear() {
    this.epoch++;
    this.versions.clear();
    this.values.clear();
    this.pending.clear();
  }

  private version(key: string): string {
    return `${this.epoch}:${this.versions.get(key) ?? 0}`;
  }
}

interface StatusState {
  status: RemoteServer['status'];
  usage: ServerUsage;
  task: string | null;
}

/**
 * 24fire Customer REST API v1: KVM servers, domains with DNS and web spaces (Plesk).
 *
 * Most payloads below the lists are UNVERIFIED (see endpoints.ts). Unknown shapes never fail the
 * sync: a server keeps its stored facts (`partial`), and the top-level key names of the shape are
 * noted for the connection test and the overview, so the live test shows the real shapes.
 */
export class Fire24Adapter implements ProviderAdapter {
  readonly type = 'fire24' as const;
  /** v1 ids are very likely the v2 internal_id values, but that is not verified (see sync). */
  readonly rekeyOnSync = { servers: true, domains: true } as const;
  private readonly client: Fire24Client;

  private readonly account = new TtlCache<Fire24Account>(TTL.account);
  /**
   * In-flight dedupe only: lists, config and status are always read fresh. One sync reads each
   * list once and getServer uses the detail endpoint, so a list cache would only serve stale
   * lists to the next sync or import.
   */
  private readonly lists = new TtlCache<Record<string, unknown>[]>(0);
  private readonly fresh = new TtlCache<unknown>(0);
  private readonly rdnsCache = new TtlCache<{ ip: string; ptr: string | null }[] | null>(TTL.rdns);
  private readonly monitoringCache = new TtlCache<unknown>(TTL.monitoring);
  private readonly osLists = new TtlCache<{ id: string; label: string }[]>(TTL.options);
  private readonly isoLists = new TtlCache<{ id: string; label: string }[]>(TTL.options);
  private readonly domainDetails = new TtlCache<Partial<DomainInfo>>(TTL.detail);
  private readonly webspaceDetails = new TtlCache<Fire24WebspaceDetail>(TTL.detail);

  /** Last complete result per server, used when its config fails or has an unknown shape. */
  private readonly lastGood = new Map<string, RemoteServer>();
  private readonly lastStatus = new Map<string, StatusState>();
  /** List facts of the domains, for getDomain (the detail has no renewal facts). */
  private readonly domainItems = new Map<string, Fire24DomainItem>();
  /** Unrecognised payloads: top-level key names per endpoint, never values. Last one wins. */
  private readonly notes = new Map<Fire24EndpointName, string[]>();
  private plusRefusedAt: number | null = null;

  constructor(config: Fire24Config, options: Fire24AdapterOptions = {}) {
    this.client = new Fire24Client(config, options);
  }

  capabilities(): Capability[] {
    return (Object.keys(CAPABILITY_SCOPES) as (keyof typeof CAPABILITY_SCOPES)[]).filter(
      (capability) => !this.client.scopeMissing(CAPABILITY_SCOPES[capability]),
    );
  }

  powerActions(): PowerAction[] {
    return ['start', 'stop', 'reboot'];
  }

  // --- Shape notes ----------------------------------------------------------------

  private note(name: Fire24EndpointName, data: unknown) {
    this.notes.set(name, shapeKeys(data));
  }

  /** Payloads the parsers did not recognise since this adapter was built. */
  unrecognised(): { endpoint: Fire24EndpointName; call: string; keys: string[] }[] {
    return [...this.notes].map(([endpoint, keys]) => {
      const { method, path } = FIRE24_ENDPOINTS[endpoint];
      return { endpoint, call: `${method} ${path}`, keys };
    });
  }

  // --- Account and lists ----------------------------------------------------------

  private cachedAccount(): Promise<Fire24Account> {
    return this.account.get('account', async () => parseAccount(await this.client.data('account')));
  }

  private list(name: 'servers' | 'domains' | 'webspaces'): Promise<Record<string, unknown>[]> {
    return this.lists.get(name, () => this.client.listAll(name));
  }

  /**
   * Account, the first page of every list (counts from meta.total), one detail per product type
   * and the global status. Each probe may miss its scope; the result lists the missing ones.
   * Throws for a legacy key, a refused token, an unreachable API, or when no probe got through.
   */
  async testConnection(): Promise<Record<string, unknown>> {
    this.account.clear();
    const [account, status, ...pages] = await Promise.all([
      settle(this.cachedAccount()),
      settle(this.client.data('status')),
      ...LIST_PROBES.map(([name]) => settle(this.client.firstPage(name))),
    ]);
    const probes: { scope: Fire24Scope; call: string; result: Settled<unknown> }[] = [
      { scope: 'account:read', call: 'GET /v1/account', result: account },
      { scope: 'status:read', call: 'GET /v1/status', result: status },
      ...LIST_PROBES.map(([name, scope], i) => ({
        scope,
        call: `GET ${FIRE24_ENDPOINTS[name].path}`,
        result: pages[i]! as Settled<unknown>,
      })),
    ];
    // Detail scopes need a product: the first one of each list.
    const details = [
      ['server', 'server:read', 0, 'server'],
      ['domain', 'domain:read', 1, 'domain'],
      ['webspace', 'webspace:read', 2, 'webspace'],
    ] as const;
    const detailResults = await Promise.all(
      details.map(async ([name, scope, page, param]) => {
        const listed = pages[page]!;
        const first = listed.ok ? str(listed.value.items[0]?.id) : null;
        if (!first) return null;
        return {
          scope,
          call: `GET ${FIRE24_ENDPOINTS[name].path}`,
          result: await settle(this.client.data(name, { [param]: first })),
        };
      }),
    );
    probes.push(...detailResults.filter(nonNull));

    const fatal = probes.find((p) => !p.result.ok && isFatal(p.result.error));
    if (fatal && !fatal.result.ok) throw fatal.result.error;
    const scopesOk = probes.filter((p) => p.result.ok).map((p) => p.scope);
    const refused = probes.filter((p) => !p.result.ok && isScopeMissing(p.result.error)).map((p) => p.scope);
    const failed = probes.flatMap((p) =>
      !p.result.ok && !isScopeMissing(p.result.error)
        ? [{ call: p.call, message: p.result.error instanceof Error ? p.result.error.message : 'failed' }]
        : [],
    );
    if (scopesOk.length === 0) {
      const other = probes.find((p) => !p.result.ok && !isScopeMissing(p.result.error));
      if (other && !other.result.ok) throw other.result.error;
      throw new AppError(
        502,
        'provider_scope_missing',
        `24fire: the access token has none of the read scopes the console needs (${refused.join(', ')}). Add them to the token in the 24fire account settings.`,
        { scopes: refused },
      );
    }
    const scopesMissing = [...new Set([...refused, ...this.client.missingScopes()])].filter(
      (scope) => !scopesOk.includes(scope),
    );
    const acc = account.ok ? account.value : null;
    const total = (i: number) => {
      const page = pages[i]!;
      return page.ok ? page.value.total : null;
    };
    return {
      api: 'v1',
      account: acc?.name ?? null,
      customerNumber: acc?.customerNumber ?? null,
      plus: acc?.plus ?? null,
      balance: acc?.balance ?? null,
      servers: total(0),
      domains: total(1),
      webspaces: total(2),
      services: total(3),
      scopesOk,
      scopesMissing,
      ...(failed.length > 0 ? { failed } : {}),
      unrecognised: this.unrecognised(),
    };
  }

  // --- Servers --------------------------------------------------------------------

  async listServers(): Promise<RemoteServer[]> {
    const items = (await this.list('servers')).map(parseServerItem).filter(nonNull);
    return mapLimit(items, 3, (item) => this.loadServer(item));
  }

  /** The detail endpoint (an unknown id answers 404), then the per-server calls. */
  async getServer(ref: ServerRef): Promise<RemoteServer> {
    const data = await this.client.data('server', { server: ref.externalId });
    const item = parseServerItem(data);
    return this.loadServer({
      id: ref.externalId,
      name: item?.name ?? null,
      type: item?.type ?? null,
      renewal: item?.renewal ?? parseRenewal(data),
    });
  }

  /**
   * One server from its list entry plus config, status and rDNS. Never throws for a per-server
   * call: without a usable config the last good result is reused, else the server is partial.
   */
  private async loadServer(item: Fire24ServerItem): Promise<RemoteServer> {
    const id = item.id;
    const [configResult, statusResult, rdns] = await Promise.all([
      settle(this.fresh.get(`config:${id}`, () => this.client.data('serverConfig', { server: id }))),
      settle(this.fresh.get(`status:${id}`, () => this.client.data('serverStatus', { server: id }))),
      this.rdnsCache.get(id, () => this.loadRdns(id)).catch(() => null),
    ]);

    if (statusResult.ok) {
      const parsed = parseStatus(statusResult.value);
      if (parsed.recognised) {
        this.lastStatus.set(id, { status: parsed.status, usage: parsed.usage, task: parsed.task });
      } else {
        this.note('serverStatus', statusResult.value);
      }
    }
    // A failed or unknown status keeps the last known one.
    const state = this.lastStatus.get(id) ?? null;
    const status = state?.status ?? 'unknown';

    let config: ParsedConfig | null = null;
    let ips: IpAddress[] = [];
    if (configResult.ok) {
      config = parseConfig(configResult.value);
      if (!config.recognised) this.note('serverConfig', configResult.value);
      ips = config.ips;
      if (config.recognised && ips.length === 0) ips = await this.networkIps(id);
    }
    const last = this.lastGood.get(id);
    const name = item.name ?? config?.hostname ?? last?.name ?? id;
    const withRdns = (list: IpAddress[]) => mergeRdns(list, rdns);

    // Specs and addresses are needed together: either missing would wipe stored facts.
    if (config && hasSpecs(config.specs) && ips.length > 0) {
      const hostsystem = config.hostsystem;
      const datacenter = isRecord(hostsystem?.datacenter) ? hostsystem.datacenter : null;
      const server: RemoteServer = {
        externalId: id,
        // The name from the 24fire panel. The OS hostname is no use as a name: it is "24fire"
        // on every server installed from a 24fire image.
        name,
        kind: 'vm',
        status,
        specs: config.specs,
        usage: state ? { ...state.usage, memoryTotalMb: config.specs.memoryMb } : null,
        ips: withRdns(ips),
        os: config.os,
        node: str(hostsystem?.node) ?? str(hostsystem?.name),
        meta: {
          hostname: config.hostname,
          hostsystem,
          datacenter: datacenter
            ? { name: str(datacenter.name), city: str(datacenter.city), country: str(datacenter.country) }
            : null,
          iso: config.iso,
          task: state?.task ?? null,
          abuseStatus: config.abuseStatus,
          maxConfig: config.maxConfig,
          monitoring: config.monitoring,
          renewal: item.renewal,
        },
      };
      this.lastGood.set(id, server);
      return server;
    }
    if (last) {
      return {
        ...last,
        name,
        status,
        usage: state ? { ...state.usage, memoryTotalMb: last.specs.memoryMb } : last.usage,
        ips: withRdns(last.ips),
        meta: { ...last.meta, task: state?.task ?? null, renewal: item.renewal },
      };
    }
    return {
      externalId: id,
      name,
      kind: 'vm',
      status,
      specs: {},
      ips: [],
      meta: { renewal: item.renewal, ...(state ? { task: state.task } : {}) },
      partial: true,
    };
  }

  private async loadRdns(id: string): Promise<{ ip: string; ptr: string | null }[] | null> {
    const data = await this.client.data('rdns', { server: id });
    const entries = parseRdns(data);
    if (!entries) this.note('rdns', data);
    return entries;
  }

  /** `GET network` as the IP fallback when the config has none. */
  private async networkIps(id: string): Promise<IpAddress[]> {
    const result = await settle(this.client.data('serverNetwork', { server: id }));
    if (!result.ok) return [];
    const ips = parseNetwork(result.value);
    if (ips.length === 0) this.note('serverNetwork', result.value);
    return ips;
  }

  async power(ref: ServerRef, action: PowerAction): Promise<ActionResult> {
    const mode = FIRE24_POWER_MODES[action as keyof typeof FIRE24_POWER_MODES];
    if (!mode) throw unsupported(`24fire does not support the power action "${action}"`);
    await this.client.call('power', { server: ref.externalId }, { form: { mode } });
    return { message: `Power command "${mode}" sent` };
  }

  /** Raw config without secrets, plus the attached ISO as parsed (`iso`, read by the ISO tab). */
  async getConfig(ref: ServerRef): Promise<Record<string, unknown>> {
    const data = await this.client.data('serverConfig', { server: ref.externalId });
    const parsed = parseConfig(data);
    if (!parsed.recognised) this.note('serverConfig', data);
    return { ...redactSecrets(isRecord(data) ? data : { data }), iso: parsed.iso };
  }

  /** Current month only; v1 has no traffic log. */
  async getTraffic(ref: ServerRef): Promise<Fire24TrafficInfo> {
    const data = await this.client.data('serverTraffic', { server: ref.externalId });
    const traffic = parseTrafficCurrent(data);
    if (traffic.totalBytes === null && traffic.limitBytes === null && traffic.remainingBytes === null) {
      this.note('serverTraffic', data);
    }
    return { ...traffic, log: [] };
  }

  /** One `GET monitoring` serves the graphs and the availability card (cached 60 s). */
  private async monitoring(ref: ServerRef) {
    const id = ref.externalId;
    const data = await this.monitoringCache.get(id, () => this.client.data('monitoring', { server: id }));
    const parsed = parseMonitoring(data);
    if (!parsed.recognised) this.note('monitoring', data);
    return parsed;
  }

  async getMetrics(ref: ServerRef, range: MetricRange): Promise<MetricsResult> {
    const { points } = await this.monitoring(ref);
    const since = Math.floor(Date.now() / 1000) - RANGE_SECONDS[range];
    return {
      range,
      resolutionSeconds: 600,
      series: [
        { key: 'cpu', unit: 'percent' },
        { key: 'memUsed', unit: 'bytes' },
        { key: 'ping', unit: 'ms' },
      ],
      points: points.filter((p) => p.t >= since),
    };
  }

  async getMonitoring(ref: ServerRef): Promise<MonitoringInfo> {
    return (await this.monitoring(ref)).info;
  }

  // --- Network --------------------------------------------------------------------

  async getDdos(ref: ServerRef): Promise<DdosSettings[]> {
    const data = await this.client.data('ddos', { server: ref.externalId });
    const settings = parseDdos(data);
    if (!settings) this.note('ddos', data);
    return settings ?? [];
  }

  async setDdos(ref: ServerRef, settings: DdosSettings): Promise<ActionResult> {
    const { layer4, layer7 } = settings;
    if (layer4 && !(FIRE24_DDOS_LAYER4 as readonly string[]).includes(layer4)) {
      throw badRequest(`Layer 4 must be one of: ${FIRE24_DDOS_LAYER4.join(', ')}`);
    }
    if (layer7 && !(FIRE24_DDOS_LAYER7 as readonly string[]).includes(layer7)) {
      throw badRequest(`Layer 7 must be one of: ${FIRE24_DDOS_LAYER7.join(', ')}`);
    }
    if (!layer4 && !layer7) throw badRequest('Nothing to change');
    await this.client.call(
      'ddosSet',
      { server: ref.externalId },
      { form: { layer4: layer4 ?? undefined, layer7: layer7 ?? undefined, ip_address: settings.ip } },
    );
    return { message: 'DDoS settings changed' };
  }

  /** The route checked that the IP belongs to the server. An empty host name removes the entry. */
  async setRdns(ref: ServerRef, ip: string, hostname: string): Promise<ActionResult> {
    const id = ref.externalId;
    const ptr = hostname.trim().replace(/\.$/, '');
    if (ptr) await this.client.call('rdnsSet', { server: id }, { form: { ip_address: ip, ptr } });
    else await this.client.call('rdnsDelete', { server: id }, { query: { ip_address: ip } });
    this.rdnsCache.delete(id);
    return { message: ptr ? 'Reverse DNS set' : 'Reverse DNS removed' };
  }

  // --- Operating system, console, ISO -----------------------------------------------

  async listImages(ref?: ServerRef): Promise<ImageOption[]> {
    if (!ref) return [];
    const id = ref.externalId;
    const options = await this.osLists.get(id, async () => {
      const data = await this.client.data('serverOsList', { server: id });
      const parsed = parseOptions(data, ['os', 'os_list', 'images', 'operating_systems']);
      if (!parsed) this.note('serverOsList', data);
      return parsed ?? [];
    });
    // The first word of the label ("Debian 12", or "debian_12" when only names come).
    return options.map((o) => ({ ...o, family: o.label.split(/[\s_]+/)[0]!.toLowerCase() }));
  }

  /**
   * Reinstalls with the current host name and password login on (decision Q4). v1 strips any
   * root password from the answer: the customer resets it once the reinstall is done.
   */
  async rebuild(ref: ServerRef, imageId: string): Promise<ActionResult & { password?: string }> {
    const images = await this.listImages(ref);
    if (!images.some((image) => image.id === imageId)) throw badRequest('Unknown operating system');
    const hostname = await this.currentHostname(ref);
    await this.client.call(
      'reinstall',
      { server: ref.externalId },
      { form: { os: imageId, hostname: hostname ?? undefined, password_login: true } },
    );
    return {
      providerRef: REINSTALL_REF,
      message: 'Reinstall started. Reset the root password once it is done.',
    };
  }

  private async currentHostname(ref: ServerRef): Promise<string | null> {
    const stored = str(ref.meta.hostname);
    if (stored && HOSTNAME.test(stored)) return stored;
    const data = await this.client.data('serverConfig', { server: ref.externalId }).catch(() => null);
    const live = data === null ? null : parseConfig(data).hostname;
    return live && HOSTNAME.test(live) ? live : null;
  }

  /** The new root password, shown once by the route. Never cached, logged or put in an error. */
  async resetPassword(ref: ServerRef): Promise<ActionResult & { password?: string }> {
    const data = await this.client.data('passwordReset', { server: ref.externalId });
    const password = parsePassword(data);
    if (!password) {
      this.note('passwordReset', data);
      throw new ProviderError(PROVIDER, 'reported success but returned no password');
    }
    return { message: 'Root password reset', password };
  }

  /** The URL and the password work once; neither is logged or put in an error. */
  async openConsole(ref: ServerRef): Promise<ConsoleSession> {
    const data = await this.client.data('console', { server: ref.externalId });
    const access = parseConsole(data);
    if (!access) {
      this.note('console', data);
      throw new ProviderError(PROVIDER, 'returned no console access');
    }
    if (access.type === 'url') return access;
    return {
      type: 'vnc',
      password: access.password,
      connect: () => this.client.openConsoleSocket(access.wssUrl),
    };
  }

  async listIsos(ref: ServerRef): Promise<IsoOption[]> {
    const id = ref.externalId;
    return this.isoLists.get(id, async () => {
      const data = await this.client.data('serverIsoList', { server: id });
      const parsed = parseOptions(data, ['isos', 'iso', 'iso_list', 'images']);
      if (!parsed) this.note('serverIsoList', data);
      return parsed ?? [];
    });
  }

  async mountIso(ref: ServerRef, isoId: string): Promise<ActionResult> {
    const isos = await this.listIsos(ref);
    if (!isos.some((iso) => iso.id === isoId)) throw badRequest('Unknown ISO image');
    await this.client.call('isoMount', { server: ref.externalId }, { form: { iso: isoId } });
    return { message: 'ISO mounted. The server boots from it after a restart.' };
  }

  async unmountIso(ref: ServerRef): Promise<ActionResult> {
    await this.client.call('isoEject', { server: ref.externalId });
    return { message: 'ISO removed' };
  }

  // --- Backups --------------------------------------------------------------------

  async listBackups(ref: ServerRef): Promise<BackupInfo[]> {
    const data = await this.client.data('backups', { server: ref.externalId });
    const backups = parseBackups(data);
    if (!backups) this.note('backups', data);
    return backups ?? [];
  }

  /**
   * v1 takes no body (no description, decision Q5). The id comes from the answer, else from the
   * list before and after (the new entry, a running one first).
   */
  async createBackup(ref: ServerRef, _options: { description?: string }): Promise<ActionResult> {
    const before = await this.listBackups(ref).catch(() => null);
    const data = await this.client.data('backupCreate', { server: ref.externalId });
    let backupId = parseBackupId(data);
    if (!backupId && before) {
      const known = new Set(before.map((b) => b.id));
      const added = (await this.listBackups(ref).catch(() => [])).filter((b) => !known.has(b.id));
      added.sort(
        (a, b) =>
          Number(b.status === 'running') - Number(a.status === 'running') ||
          String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')),
      );
      backupId = added[0]?.id ?? null;
    }
    return { providerRef: backupId ? `backup-create:${backupId}` : null, message: 'Backup started' };
  }

  async restoreBackup(ref: ServerRef, backupId: string): Promise<ActionResult> {
    await this.client.call('backupRestore', { server: ref.externalId, backup: backupId });
    return { providerRef: `backup-restore:${backupId}`, message: 'Restore started' };
  }

  async deleteBackup(ref: ServerRef, backupId: string): Promise<ActionResult> {
    await this.client.call('backupDelete', { server: ref.externalId, backup: backupId });
    return { message: 'Backup deleted' };
  }

  /** Progress of the reinstall and of backup creation and restore, polled by the action tracker. */
  async getTaskStatus(ref: ServerRef, providerRef: string): Promise<ProviderTask | null> {
    if (providerRef === REINSTALL_REF) {
      const data = await this.client.data('reinstallStatus', { server: ref.externalId });
      const parsed = parseReinstallStatus(data);
      if (parsed) return taskOf(providerRef, 'reinstall', parsed.status, parsed.message);
      this.note('reinstallStatus', data);
      return this.taskFromServerStatus(ref, providerRef, 'reinstall', /REINSTALL/i);
    }
    const match = BACKUP_TASK_REF.exec(providerRef);
    if (!match) return null;
    const [, kind, backupId] = match;
    const name = kind === 'create' ? 'backupCreateStatus' : 'backupRestoreStatus';
    const data = await this.client.data(name, { server: ref.externalId, backup: backupId });
    const task = parseBackupTask(data, providerRef, `backup.${kind}`);
    if (task) return task;
    this.note(name, data);
    return this.taskFromServerStatus(ref, providerRef, `backup.${kind}`, /BACKUP/i);
  }

  /**
   * Fallback for an unrecognised task answer: done once the server status shows no such task and
   * the server is running or stopped.
   */
  private async taskFromServerStatus(
    ref: ServerRef,
    providerRef: string,
    type: string,
    busy: RegExp,
  ): Promise<ProviderTask> {
    const status = parseStatus(await this.client.data('serverStatus', { server: ref.externalId }));
    const done =
      status.recognised && !busy.test(status.task ?? '') && ['running', 'stopped'].includes(status.status);
    return taskOf(providerRef, type, done ? 'ok' : 'running', null);
  }

  // --- Domains & DNS --------------------------------------------------------------

  /** Lock, auto-renew, renewals and the auth code are managed in the 24fire panel only. */
  domainCapabilities(): DomainCapability[] {
    return ['dns', 'nameservers'];
  }

  dnsRecordTypes(): DnsRecordType[] {
    return [...FIRE24_DNS_TYPES];
  }

  async listDomains(): Promise<RemoteDomain[]> {
    const items = (await this.list('domains')).map(parseDomainItem).filter(nonNull);
    for (const item of items) this.domainItems.set(item.id, item);
    return mapLimit(items, 3, async (item) => {
      // A failed detail leaves the list facts; the sync keeps stored fields for the rest.
      const detail = await this.domainDetail(item.id).catch(() => null);
      return remoteDomain(item, detail);
    });
  }

  private domainDetail(id: string): Promise<Partial<DomainInfo>> {
    return this.domainDetails.get(id, async () => {
      const data = await this.client.data('domain', { domain: id });
      const info = parseDomain(data);
      if (Object.keys(info).length === 0) this.note('domain', data);
      return info;
    });
  }

  private async domainItem(id: string): Promise<Fire24DomainItem | null> {
    const known = this.domainItems.get(id);
    if (known) return known;
    const items = (await this.list('domains')).map(parseDomainItem).filter(nonNull);
    for (const item of items) this.domainItems.set(item.id, item);
    return this.domainItems.get(id) ?? null;
  }

  /** Detail and name servers fresh (the detail refills the cache), list facts for the renewal. */
  async getDomain(externalId: string): Promise<DomainInfo> {
    this.domainDetails.delete(externalId);
    const [detail, nameservers, item] = await Promise.all([
      this.domainDetail(externalId),
      this.client
        .data('nameservers', { domain: externalId })
        .then((data) => {
          const parsed = parseNameservers(data);
          if (parsed === null) this.note('nameservers', data);
          return parsed;
        })
        .catch(() => null),
      this.domainItem(externalId).catch(() => null),
    ]);
    const remote = remoteDomain(item ?? { id: externalId, name: null, renewal: parseRenewal(null) }, detail);
    const info = remote.info ?? {};
    const ns = nameservers && nameservers.length > 0 ? nameservers : (info.nameservers ?? []);
    return {
      name: remote.name,
      status: info.status ?? null,
      terminated: info.terminated ?? false,
      nameservers: ns,
      handle: info.handle ?? null,
      createdAt: info.createdAt ?? null,
      expiresAt: info.expiresAt ?? null,
      autoRenew: info.autoRenew ?? null,
      providerDns: providerDns(ns),
    };
  }

  async listDnsRecords(externalId: string): Promise<DnsRecord[]> {
    const data = await this.client.data('dns', { domain: externalId });
    const records = parseDnsRecords(data);
    if (!records) this.note('dns', data);
    return records ?? [];
  }

  /** A refused 24fire+ write closes DNS editing for a while (dnsWritable). */
  private async dnsWrite<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (err) {
      if (err instanceof AppError && err.code === 'plus_required') this.plusRefusedAt = Date.now();
      throw err;
    }
  }

  /**
   * 24fire answers `{ created: true }`, so the new record is found by comparing the lists.
   * Only type, name and data are sent (24fire sets the TTL itself).
   */
  async addDnsRecord(externalId: string, input: DnsRecordInput): Promise<DnsRecord | null> {
    return this.dnsWrite(async () => {
      const before = new Set((await this.listDnsRecords(externalId)).map((r) => r.id));
      await this.client.call(
        'dnsCreate',
        { domain: externalId },
        { form: { type: input.type, name: input.name, data: input.data } },
      );
      const added = (await this.listDnsRecords(externalId)).filter((r) => !before.has(r.id));
      return (
        added.find((r) => r.type === input.type && r.data === input.data) ??
        added.find((r) => r.type === input.type) ??
        added[0] ??
        null
      );
    });
  }

  /** PATCH takes type, name and data together: the patch is merged into the current record. */
  async updateDnsRecord(
    externalId: string,
    recordId: string,
    patch: DnsRecordPatch,
  ): Promise<DnsRecord | null> {
    checkId('record', recordId);
    return this.dnsWrite(async () => {
      const current = (await this.listDnsRecords(externalId)).find((r) => r.id === recordId);
      if (!current) throw new ProviderError(PROVIDER, 'DNS record not found', 404);
      await this.client.call(
        'dnsUpdate',
        { domain: externalId, record: recordId },
        {
          form: {
            type: patch.type ?? current.type,
            name: patch.name ?? current.name,
            data: patch.data ?? current.data,
          },
        },
      );
      return (await this.listDnsRecords(externalId)).find((r) => r.id === recordId) ?? null;
    });
  }

  async deleteDnsRecord(externalId: string, recordId: string): Promise<void> {
    await this.dnsWrite(() => this.client.call('dnsDelete', { domain: externalId, record: recordId }));
  }

  async dnsWritable(): Promise<boolean> {
    if (this.client.scopeMissing('domain:dns')) return false;
    return this.plusRefusedAt === null || Date.now() - this.plusRefusedAt >= TTL.plusRefusal;
  }

  /** ns1 and ns2 are required, ns3 to ns5 follow in order. */
  async setNameservers(externalId: string, nameservers: string[]): Promise<ActionResult> {
    const hosts = nameservers.map((h) => h.trim().toLowerCase().replace(/\.$/, '')).filter(Boolean);
    if (hosts.length < 2 || hosts.length > 5) throw badRequest('24fire takes 2 to 5 name servers');
    if (new Set(hosts).size !== hosts.length) throw badRequest('Name servers must be different');
    await this.client.call(
      'nameserversSet',
      { domain: externalId },
      { form: Object.fromEntries(hosts.map((host, i) => [`ns${i + 1}`, host])) },
    );
    this.domainDetails.delete(externalId);
    return { message: 'Name server change submitted' };
  }

  // --- Web spaces -----------------------------------------------------------------

  async listWebspaces(): Promise<RemoteWebspace[]> {
    const items = (await this.list('webspaces')).map(parseWebspaceItem).filter(nonNull);
    return mapLimit(items, 3, async (item) => {
      const detail = await this.webspaceDetail(item.id).catch(() => null);
      return {
        externalId: item.id,
        name: webspaceName(item.name, item.primaryDomain, item.id),
        info: webspaceInfo(item, detail, null),
        meta: {
          package: detail?.item?.package ?? null,
          provisioningStatus: item.provisioningStatus,
          renewal: item.renewal,
        },
      };
    });
  }

  private webspaceDetail(id: string): Promise<Fire24WebspaceDetail> {
    return this.webspaceDetails.get(id, async () => {
      const data = await this.client.data('webspace', { webspace: id });
      const detail = parseWebspaceDetail(data);
      if (!detail.item) this.note('webspace', data);
      return detail;
    });
  }

  /** Detail fresh, plus the usage call, whose resources fill what the detail left null. */
  async getWebspace(externalId: string): Promise<WebspaceInfo> {
    this.webspaceDetails.delete(externalId);
    const [detail, usage] = await Promise.all([
      this.webspaceDetail(externalId),
      this.client
        .data('webspaceUsage', { webspace: externalId })
        .then((data) => parseWebspaceDetail(data).resources)
        .catch(() => null),
    ]);
    const item = detail.item ?? parseWebspaceItem({ id: externalId })!;
    return webspaceInfo(item, detail, usage);
  }

  /**
   * A one-time Plesk sign-in link (v1 gives no password). Nothing is cached; the route shows it
   * once, audited and with no-store.
   */
  async getWebspaceCredentials(externalId: string): Promise<WebspaceCredentials> {
    const data = await this.client.data('webspaceLogin', { webspace: externalId });
    const loginUrl = parseLoginUrl(data);
    if (!loginUrl) throw new ProviderError(PROVIDER, 'returned no valid login link');
    return {
      panelUrl: new URL(loginUrl).origin,
      username: this.webspaceDetails.peek(externalId)?.username ?? null,
      password: null,
      email: null,
      loginUrl,
    };
  }

  // --- Admin ----------------------------------------------------------------------

  async overview(): Promise<InfraOverview> {
    this.account.clear();
    const [account, status, services] = await Promise.all([
      settle(this.cachedAccount()),
      settle(this.client.data('status').then(parseStatusAttention)),
      settle(this.client.listAll('services').then((items) => items.map(parseServiceItem).filter(nonNull))),
    ]);
    const results = [account, status, services];
    const fatal = results.find((r) => !r.ok && isFatal(r.error));
    if (fatal && !fatal.ok) throw fatal.error;

    const facts: InfraOverview['facts'] = [];
    const problem = (label: string, result: Settled<unknown>) => {
      if (result.ok) return;
      facts.push({
        label,
        value: isScopeMissing(result.error)
          ? `missing scope ${(result.error.details as { scope?: string } | undefined)?.scope ?? ''}`.trim()
          : result.error instanceof Error
            ? result.error.message
            : 'failed',
      });
    };

    if (account.ok) {
      const a = account.value;
      if (a.name) facts.push({ label: 'Account', value: a.name });
      if (a.customerNumber) facts.push({ label: 'Customer number', value: a.customerNumber });
      if (a.balance !== null) facts.push({ label: 'Balance', value: `${a.balance.toFixed(2)} EUR` });
      facts.push({ label: '24fire+', value: a.plus ? 'active' : 'inactive' });
    } else problem('Account', account);

    if (services.ok) {
      const count = (category: string) =>
        String(services.value.filter((s) => s.category === category).length);
      facts.push(
        { label: 'KVM', value: count('kvm') },
        { label: 'Domains', value: count('domain') },
        { label: 'Web spaces', value: count('plesk') },
        { label: 'Dedicated', value: count('dedicated') },
      );
      const other = services.value.filter(
        (s) => !['kvm', 'domain', 'plesk', 'dedicated'].includes(s.category ?? ''),
      );
      if (other.length > 0) facts.push({ label: 'Other services', value: String(other.length) });
    } else problem('Services', services);

    if (status.ok) {
      const { operational, items } = status.value;
      if (operational !== null) {
        facts.push({ label: 'Status', value: operational ? 'operational' : 'attention needed' });
      }
      for (const item of items.slice(0, 10)) {
        facts.push({
          label: `Attention (${item.severity})`,
          value: item.description ? `${item.title}: ${item.description}` : item.title,
        });
      }
    } else problem('Status', status);

    for (const note of this.unrecognised()) {
      facts.push({
        label: 'Unrecognised 24fire data',
        value: `${note.call} (keys: ${note.keys.join(', ')})`,
      });
    }
    return { nodes: [], storages: [], facts };
  }

  /**
   * Explorer. Paths below /v1 ("v1/x", "/x" and the full URL are accepted). GET and DELETE send
   * the body as the query, the others as form data. Calls that create a secret shown only once
   * are refused, and every answer is redacted.
   */
  async rawRequest(method: string, path: string, body?: Record<string, unknown>): Promise<RawResponse> {
    const upper = method.toUpperCase();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(upper)) throw badRequest('Unsupported method');
    let clean = path.trim();
    if (clean.toLowerCase().startsWith(this.client.baseUrl.toLowerCase())) {
      clean = clean.slice(this.client.baseUrl.length);
    }
    if (/^\/?api(\/|\?|$)/i.test(clean))
      throw unsupported('24fire API v2 paths no longer exist, use /v1/...');
    // Only paths below the API base: the token must not be sent anywhere else.
    if (/\/\/|\.\.|\\|@|%2e/i.test(clean)) throw badRequest('Invalid path');
    clean = clean.replace(/^\//, '');
    if (!/^v1(\/|\?|$)/i.test(clean)) clean = `v1/${clean}`;
    const [pathname = '', search = ''] = `/${clean}`.split(/\?(.*)/s);
    // 24fire decodes the path before routing, so encoded characters could hide a blocked call. fetch
    // normalises the URL before sending it (drops "." segments, tabs, line breaks and the fragment,
    // encodes spaces): the blocks must see the path 24fire receives, so a path the URL parser would
    // change is refused.
    if (pathname.includes('%') || new URL(pathname, 'https://fire24.invalid').pathname !== pathname) {
      throw badRequest('Invalid path');
    }
    const blocked = BLOCKED_EXPLORER_CALLS.find((b) => b.path.test(pathname));
    if (blocked) throw unsupported(blocked.message);

    const query = new URLSearchParams(search);
    let form: Record<string, unknown> | undefined;
    if (upper === 'GET' || upper === 'DELETE') {
      for (const [key, value] of Object.entries(body ?? {})) {
        if (value !== undefined && value !== null) query.append(key, String(value));
      }
    } else {
      form = body;
    }
    const qs = query.toString();
    const res = await this.client.raw(upper, `${pathname}${qs ? `?${qs}` : ''}`, form);
    const data = redactSecrets(res.body);
    if (!CONSOLE_CALL.test(pathname)) return { status: res.status, data };
    // A console session is a secret as a whole, and its shape is not documented (a page URL, a
    // websocket with a password, ...): only its key names are shown. Error envelopes stay readable.
    if (!isRecord(data)) return { status: res.status, data: blankValues(data) };
    return { status: res.status, data: 'data' in data ? { ...data, data: blankValues(data.data) } : data };
  }
}

const CONSOLE_CALL = /^\/v1\/servers\/[^/]+\/console\/?$/i;

/** Explorer calls that create a secret shown only once; the explorer would have to blank it. */
const BLOCKED_EXPLORER_CALLS = [
  {
    path: /^\/v1\/servers\/[^/]+\/password-reset\/?$/i,
    message: 'Use "Reset root password" in the server settings; the explorer would lose the new password',
  },
  {
    path: /^\/v1\/servers\/[^/]+\/ssh-keys\/generate\/?$/i,
    message: 'Generating SSH keys is refused here: the private key is shown only once',
  },
  {
    path: /^\/v1\/webspaces\/[^/]+\/login\/?$/i,
    message: 'Use "Open Plesk" on the web space page; the explorer would lose the one-time link',
  },
];

function taskOf(
  id: string,
  type: string,
  status: ProviderTask['status'],
  message: string | null,
): ProviderTask {
  return {
    id,
    type,
    status,
    startedAt: null,
    endedAt: status === 'running' ? null : new Date().toISOString(),
    message,
  };
}

/** rDNS names from `GET rdns` win over the config's. */
function mergeRdns(ips: IpAddress[], rdns: { ip: string; ptr: string | null }[] | null): IpAddress[] {
  if (!rdns) return ips;
  const names = new Map(rdns.filter((r) => r.ptr).map((r) => [r.ip, r.ptr!]));
  return ips.map((ip) => (names.has(ip.address) ? { ...ip, rdns: names.get(ip.address) } : ip));
}

/** True when every name server is 24fire's, false when none is, null when unknown or mixed. */
function providerDns(nameservers: string[]): boolean | null {
  if (nameservers.length === 0) return null;
  const own = nameservers.filter((ns) => FIRE24_NAMESERVER.test(ns)).length;
  if (own === nameservers.length) return true;
  return own === 0 ? false : null;
}

/** List facts, overridden field by field by what the detail reported. The list keeps the name. */
function remoteDomain(item: Fire24DomainItem, detail: Partial<DomainInfo> | null): RemoteDomain {
  const name = item.name ?? detail?.name ?? item.id;
  const info: Partial<DomainInfo> = {
    expiresAt: item.renewal.date,
    autoRenew: item.renewal.autoRenew,
    ...detail,
    name,
  };
  if (info.nameservers) info.providerDns = providerDns(info.nameservers);
  return {
    externalId: item.id,
    name,
    status: detail?.status ?? null,
    info,
    meta: { renewal: item.renewal },
  };
}

function webspaceInfo(
  item: Fire24WebspaceItem,
  detail: Fire24WebspaceDetail | null,
  usage: WebspaceResources | null,
): WebspaceInfo {
  const base = detail?.resources ?? EMPTY_WEBSPACE_RESOURCES;
  const resources = Object.fromEntries(
    Object.entries(base).map(([key, value]) => [
      key,
      value ?? usage?.[key as keyof WebspaceResources] ?? null,
    ]),
  ) as unknown as WebspaceResources;
  return {
    name: webspaceName(item.name, item.primaryDomain, item.id),
    resources,
    panelUrl: detail?.panelUrl ?? null,
    username: detail?.username ?? null,
    email: detail?.email ?? null,
    expiresAt: item.renewal.date,
  };
}

const SECRET_KEY =
  /pass(word)?|passwd|secret|auth_?code|token|ticket|private|login_?url|console_?url|novnc|vnc|wss?_?url|socket|^wss?$|^url$|^link$/i;
/**
 * Blanked wherever they appear: PEM blocks, 24fire access tokens, websocket addresses, and links
 * with a query, fragment or user part (one-time console and login links carry their secret there).
 */
const SECRET_VALUE = /^-----BEGIN|\d+\|cra_|^wss?:\/\/|^https?:\/\/\S*[?#@]/i;

/** Every value blanked, keys and nesting kept. */
function blankValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(blankValues);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, blankValues(v)]));
  return value === null || value === undefined ? value : '••••••';
}

/**
 * Config, explorer answers and console sessions may carry root passwords, console URLs and
 * tokens, login links and private keys. None of it leaves the API outside the reveal routes.
 */
export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactSecrets) as T;
  if (typeof value === 'string') return (SECRET_VALUE.test(value) ? '••••••' : value) as T;
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = SECRET_KEY.test(key) && v !== null && v !== undefined ? '••••••' : redactSecrets(v);
  }
  return out as T;
}
