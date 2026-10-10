import type {
  BackupInfo,
  Capability,
  DdosSettings,
  DnsRecord,
  DnsRecordInput,
  DnsRecordType,
  DomainCapability,
  DomainInfo,
  MetricRange,
  MetricsResult,
  MonitoringInfo,
  PowerAction,
  ProviderTask,
  WebspaceCredentials,
  WebspaceInfo,
} from '@weblion/shared';
import { AppError, ProviderError, badRequest, unsupported } from '../../lib/errors';
import { httpRequest, isRecord, mapLimit, str, type HttpResponse } from '../http';
import type {
  ActionResult,
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
import {
  FIRE24_BACKUP_DESCRIPTION,
  FIRE24_DDOS_LAYER4,
  FIRE24_DDOS_LAYER7,
  FIRE24_ENDPOINTS,
  FIRE24_POWER_FIELD,
  FIRE24_POWER_MODES,
  type Fire24EndpointName,
} from './endpoints';
import {
  aggregateTraffic,
  domainInfoFromService,
  isDomainService,
  isKvmService,
  isWebspaceService,
  parseAccount,
  parseBackupTask,
  parseBackups,
  parseConfig,
  parseDdos,
  parseDnsRecords,
  parseDomain,
  parseIncidences,
  parseServices,
  parseStatus,
  parseTimings,
  parseTrafficCurrent,
  parseTrafficLog,
  parseWebspace,
  webspaceInfoFromService,
  type Fire24Account,
  type Fire24ServiceRef,
  type Fire24TrafficInfo,
} from './parse';

const PROVIDER = '24fire';

const RANGE_SECONDS: Record<MetricRange, number> = {
  hour: 3600,
  day: 86_400,
  week: 7 * 86_400,
  month: 31 * 86_400,
  year: 366 * 86_400,
};

/** Account facts (24fire+ state, balance) are cached for a few minutes. */
const ACCOUNT_TTL_MS = 5 * 60_000;
/** One sync lists servers, domains and web spaces; they share one services call. */
const SERVICES_TTL_MS = 10_000;

const DEFAULT_BACKUP_DESCRIPTION = 'weblion Console';

/** Record types the 24fire DNS editor takes. No TTL field: the panel's TTL is ignored. */
const RECORD_TYPES: DnsRecordType[] = [
  'A',
  'AAAA',
  'CNAME',
  'ALIAS',
  'MX',
  'SRV',
  'TXT',
  'CAA',
  'PTR',
  'NS',
  'TLSA',
  'DS',
  'DNSKEY',
  'HTTP_REDIRECT',
  'HTTP_FRAME',
];

/** Backup tasks are tracked as `backup-create:<id>` / `backup-restore:<id>`. */
const BACKUP_TASK_REF = /^backup-(create|restore):(.+)$/;

/** What a 24fire+ endpoint is for, used in the error shown when the plan is missing. */
function plusFeature(name: Fire24EndpointName): string {
  if (name.startsWith('domainDns')) return 'DNS changes';
  if (name.startsWith('kvmBackup')) return 'Creating, restoring and deleting backups';
  if (name.startsWith('kvmMonitoring')) return 'Monitoring';
  if (name.startsWith('kvmDdos')) return 'Changing the DDoS protection';
  if (name.startsWith('kvmTraffic')) return 'Traffic charts';
  return `${FIRE24_ENDPOINTS[name].method} ${FIRE24_ENDPOINTS[name].path}`;
}

function plusRequired(name: Fire24EndpointName): AppError {
  return new AppError(
    422,
    'plus_required',
    `${PROVIDER}: ${plusFeature(name)} needs an active 24fire+ subscription on the provider account`,
  );
}

interface Envelope {
  status?: string;
  message?: string;
  requestID?: string;
  data?: unknown;
}

export class Fire24Adapter implements ProviderAdapter {
  readonly type = 'fire24' as const;
  private readonly baseUrl: string;
  private accountCache: { at: number; value: Fire24Account | null } | null = null;
  private accountPending: Promise<Fire24Account | null> | null = null;
  /** Last known 24fire+ state. Outlives the cache so capabilities() can stay synchronous. */
  private plusKnown: boolean | null = null;
  private servicesCache: { at: number; value: Promise<Fire24ServiceRef[]> } | null = null;

  constructor(private readonly config: Fire24Config) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
  }

  capabilities(): Capability[] {
    const caps: Capability[] = [
      'power',
      'metrics',
      'monitoring',
      'traffic',
      'backups',
      'backupRestore',
      'backupDelete',
      'ddos',
      'networkInfo',
      'config',
    ];
    // Monitoring and backup actions need 24fire+. Hide what cannot work once we know.
    if (this.plusKnown !== false) return caps;
    return caps.filter((c) => !['metrics', 'monitoring', 'backupRestore', 'backupDelete'].includes(c));
  }

  powerActions(): PowerAction[] {
    return ['start', 'stop', 'reboot'];
  }

  private async send(method: string, path: string, form?: Record<string, unknown>): Promise<HttpResponse> {
    return httpRequest(PROVIDER, {
      method,
      url: `${this.baseUrl}${path}`,
      headers: { 'X-Fire-Apikey': this.config.apiKey },
      form,
    });
  }

  private async call<T = unknown>(
    name: Fire24EndpointName,
    id?: string,
    form?: Record<string, unknown>,
  ): Promise<T> {
    const endpoint = FIRE24_ENDPOINTS[name];
    const plus = 'plus' in endpoint && endpoint.plus;
    if (plus) await this.requirePlus(name);
    const path = endpoint.path.replace('{id}', encodeURIComponent(id ?? ''));
    const res = await this.send(endpoint.method, path, form);
    const body = (isRecord(res.body) ? res.body : {}) as Envelope;

    if (res.status >= 400 || body.status === 'error') {
      let message =
        str(body.message) ?? (typeof res.body === 'string' ? res.body.slice(0, 200) : `HTTP ${res.status}`);
      if (res.status === 401) message = 'API key rejected (401). Check FIRE24_API_KEY.';
      // What 24fire answers without 24fire+ is not documented, so hint on the likely codes.
      if (plus && [400, 402, 403].includes(res.status)) {
        message = `${message} (${plusFeature(name)} needs an active 24fire+ subscription)`;
      }
      if ((res.status === 404 || res.status === 405) && !endpoint.verified) {
        message = `${message}. ${endpoint.method} ${endpoint.path} is not verified against the 24fire docs yet, see providers/fire24/endpoints.ts`;
      }
      throw new ProviderError(PROVIDER, message, res.status, { requestId: body.requestID });
    }
    return body.data as T;
  }

  // --- Account --------------------------------------------------------------------

  private async loadAccount(): Promise<Fire24Account> {
    const account = parseAccount(await this.call('account'));
    this.accountCache = { at: Date.now(), value: account };
    this.plusKnown = account.plus;
    return account;
  }

  /** Cached account facts, null if 24fire did not answer (the actual call will tell why). */
  private async cachedAccount(): Promise<Fire24Account | null> {
    if (this.accountCache && Date.now() - this.accountCache.at < ACCOUNT_TTL_MS) {
      return this.accountCache.value;
    }
    this.accountPending ??= this.loadAccount()
      .catch(() => {
        this.accountCache = { at: Date.now(), value: null };
        return null;
      })
      .finally(() => {
        this.accountPending = null;
      });
    return this.accountPending;
  }

  /** Fails early with a clear message instead of a vague upstream error. */
  private async requirePlus(name: Fire24EndpointName): Promise<void> {
    const account = await this.cachedAccount();
    if (account && !account.plus) throw plusRequired(name);
  }

  private services(): Promise<Fire24ServiceRef[]> {
    if (this.servicesCache && Date.now() - this.servicesCache.at < SERVICES_TTL_MS) {
      return this.servicesCache.value;
    }
    const value = this.call('accountServices').then(parseServices);
    this.servicesCache = { at: Date.now(), value };
    value.catch(() => {
      if (this.servicesCache?.value === value) this.servicesCache = null;
    });
    return value;
  }

  async testConnection(): Promise<Record<string, unknown>> {
    const account = await this.loadAccount();
    this.servicesCache = null;
    const services = await this.services();
    return {
      account: account.name,
      plus: account.plus,
      balance: account.balance,
      services: services.length,
      kvm: services.filter((s) => isKvmService(s) === 'yes').length,
      domains: services.filter(isDomainService).length,
      webspaces: services.filter(isWebspaceService).length,
    };
  }

  // --- Servers --------------------------------------------------------------------

  async listServers(): Promise<RemoteServer[]> {
    // Keeps the 24fire+ state fresh for capabilities() (one call per few minutes).
    await this.cachedAccount();
    const services = (await this.services()).filter((s) => isKvmService(s) !== 'no');
    const results = await mapLimit(services, 4, async (service) => {
      try {
        return await this.loadServer(service.internalId, service.name, service.raw);
      } catch (err) {
        // A "maybe" service that is not a KVM answers with an error, skip it quietly.
        if (isKvmService(service) === 'maybe') return null;
        throw err;
      }
    });
    return results.filter((s): s is RemoteServer => s !== null);
  }

  async getServer(ref: ServerRef): Promise<RemoteServer> {
    const service = await this.service(ref.externalId);
    return this.loadServer(ref.externalId, service?.name ?? null, service?.raw ?? null);
  }

  private async loadServer(
    internalId: string,
    serviceName: string | null,
    serviceRaw: Record<string, unknown> | null,
  ): Promise<RemoteServer> {
    const [configData, statusData] = await Promise.all([
      this.call('kvmConfig', internalId),
      this.call('kvmStatus', internalId).catch(() => null),
    ]);
    const config = parseConfig(configData);
    const status = statusData ? parseStatus(statusData) : null;
    const datacenter = isRecord(config.hostsystem?.datacenter) ? config.hostsystem.datacenter : null;

    return {
      externalId: internalId,
      // The name from the 24fire panel. The OS hostname is no use as a name: it is "24fire"
      // on every server installed from a 24fire image.
      name: (serviceName !== internalId ? serviceName : null) ?? config.hostname ?? internalId,
      kind: 'vm',
      status: status?.status ?? 'unknown',
      specs: config.specs,
      usage: status ? { ...status.usage, memoryTotalMb: config.specs.memoryMb } : null,
      ips: config.ips,
      os: config.os,
      node: str(config.hostsystem?.node) ?? str(config.hostsystem?.name),
      meta: {
        hostname: config.hostname,
        hostsystem: config.hostsystem,
        datacenter: datacenter
          ? { name: str(datacenter.name), city: str(datacenter.city), country: str(datacenter.country) }
          : null,
        iso: config.iso,
        task: status?.task ?? null,
        abuseStatus: config.abuseStatus,
        maxConfig: config.maxConfig,
        monitoring: config.monitoring,
        service: serviceRaw,
      },
    };
  }

  async power(ref: ServerRef, action: PowerAction): Promise<ActionResult> {
    const mode = FIRE24_POWER_MODES[action as keyof typeof FIRE24_POWER_MODES];
    if (!mode) throw unsupported(`24fire does not support the power action "${action}"`);
    await this.call('kvmPower', ref.externalId, { [FIRE24_POWER_FIELD]: mode });
    return { message: `Power command "${mode}" sent` };
  }

  async getMetrics(ref: ServerRef, range: MetricRange): Promise<MetricsResult> {
    const points = parseTimings(await this.call('kvmMonitoringTimings', ref.externalId));
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
    return parseIncidences(await this.call('kvmMonitoringIncidences', ref.externalId));
  }

  /** Current month in bytes; the 10 minute log is summed up per hour. */
  async getTraffic(ref: ServerRef): Promise<Fire24TrafficInfo> {
    const [current, log] = await Promise.all([
      this.call('kvmTrafficCurrent', ref.externalId),
      this.call('kvmTrafficLog', ref.externalId).catch(() => null),
    ]);
    return {
      ...parseTrafficCurrent(current),
      log: log ? aggregateTraffic(parseTrafficLog(log), 3600) : [],
    };
  }

  // --- Backups --------------------------------------------------------------------

  async listBackups(ref: ServerRef): Promise<BackupInfo[]> {
    return parseBackups(await this.call('kvmBackupList', ref.externalId));
  }

  async createBackup(ref: ServerRef, options: { description?: string }): Promise<ActionResult> {
    const description = options.description?.trim() || DEFAULT_BACKUP_DESCRIPTION;
    if (!FIRE24_BACKUP_DESCRIPTION.test(description)) {
      throw badRequest(
        '24fire allows backup descriptions of at most 24 characters: letters, spaces and - _ + # ( ) . : (no digits)',
      );
    }
    const data = await this.call('kvmBackupCreate', ref.externalId, { description });
    const backupId = isRecord(data) ? str(data.backup_id) : null;
    return {
      providerRef: backupId ? `backup-create:${backupId}` : null,
      message: 'Backup started',
    };
  }

  async restoreBackup(ref: ServerRef, backupId: string): Promise<ActionResult> {
    const data = await this.call('kvmBackupRestore', ref.externalId, { backup_id: backupId });
    const id = (isRecord(data) ? str(data.backup_id) : null) ?? backupId;
    return { providerRef: `backup-restore:${id}`, message: 'Restore started' };
  }

  async deleteBackup(ref: ServerRef, backupId: string): Promise<ActionResult> {
    await this.call('kvmBackupDelete', ref.externalId, { backup_id: backupId });
    return { message: 'Backup deleted' };
  }

  /** Progress of backup creation and restore, polled by the action tracker. */
  async getTaskStatus(ref: ServerRef, providerRef: string): Promise<ProviderTask | null> {
    const match = BACKUP_TASK_REF.exec(providerRef);
    if (!match) return null;
    const [, kind, backupId] = match;
    const data = await this.call(
      kind === 'create' ? 'kvmBackupCreateStatus' : 'kvmBackupRestoreStatus',
      ref.externalId,
      { backup_id: backupId },
    );
    return parseBackupTask(data, providerRef, `backup.${kind}`);
  }

  // --- Network --------------------------------------------------------------------

  async getDdos(ref: ServerRef): Promise<DdosSettings[]> {
    return parseDdos(await this.call('kvmDdos', ref.externalId));
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
    await this.call('kvmDdosChange', ref.externalId, {
      layer4: layer4 ?? undefined,
      layer7: layer7 ?? undefined,
      ip_address: settings.ip,
    });
    return { message: 'DDoS settings changed' };
  }

  async getConfig(ref: ServerRef): Promise<Record<string, unknown>> {
    const data = await this.call('kvmConfig', ref.externalId);
    return redactSecrets(isRecord(data) ? data : { data });
  }

  // --- Domains & DNS --------------------------------------------------------------

  /** Name servers, lock and renewals are managed in the 24fire panel only. */
  domainCapabilities(): DomainCapability[] {
    return ['dns', 'authcode'];
  }

  dnsRecordTypes(): DnsRecordType[] {
    return [...RECORD_TYPES];
  }

  async listDomains(): Promise<RemoteDomain[]> {
    const services = (await this.services()).filter(isDomainService);
    return mapLimit(services, 4, async (service) => {
      let info: DomainInfo;
      try {
        info = parseDomain(await this.call('domainInfo', service.internalId), service).info;
      } catch {
        // The services list alone still gives name and renewal date.
        info = domainInfoFromService(service);
      }
      return {
        externalId: service.internalId,
        name: info.name || service.name,
        status: info.status,
        info,
        meta: { target: str(service.raw.target), accounting: service.accounting },
      };
    });
  }

  private async service(internalId: string): Promise<Fire24ServiceRef | null> {
    const services = await this.services().catch(() => []);
    return services.find((s) => s.internalId === internalId) ?? null;
  }

  async getDomain(externalId: string): Promise<DomainInfo> {
    const [data, service] = await Promise.all([
      this.call('domainInfo', externalId),
      this.service(externalId),
    ]);
    return parseDomain(data, service).info;
  }

  async getDomainAuthcode(externalId: string): Promise<string | null> {
    return parseDomain(await this.call('domainInfo', externalId)).authcode;
  }

  async listDnsRecords(externalId: string): Promise<DnsRecord[]> {
    return parseDnsRecords(await this.call('domainDns', externalId));
  }

  /**
   * 24fire answers with `data: null`, so the new record is found by comparing the lists.
   * Only type, name and data are sent (24fire sets the TTL itself).
   */
  async addDnsRecord(externalId: string, input: DnsRecordInput): Promise<DnsRecord | null> {
    await this.requirePlus('domainDnsAdd');
    const before = new Set((await this.listDnsRecords(externalId)).map((r) => r.id));
    await this.call('domainDnsAdd', externalId, { type: input.type, name: input.name, data: input.data });
    const added = (await this.listDnsRecords(externalId)).filter((r) => !before.has(r.id));
    return (
      added.find((r) => r.type === input.type && r.data === input.data) ??
      added.find((r) => r.type === input.type) ??
      added[0] ??
      null
    );
  }

  async updateDnsRecord(
    externalId: string,
    recordId: string,
    patch: DnsRecordPatch,
  ): Promise<DnsRecord | null> {
    await this.call('domainDnsEdit', externalId, {
      record_id: recordId,
      type: patch.type,
      name: patch.name,
      data: patch.data,
    });
    const records = await this.listDnsRecords(externalId);
    return records.find((r) => r.id === recordId) ?? null;
  }

  async deleteDnsRecord(externalId: string, recordId: string): Promise<void> {
    await this.call('domainDnsRemove', externalId, { record_id: recordId });
  }

  async dnsWritable(): Promise<boolean> {
    const account = await this.cachedAccount();
    return account?.plus ?? this.plusKnown ?? false;
  }

  // --- Web spaces -----------------------------------------------------------------

  async listWebspaces(): Promise<RemoteWebspace[]> {
    const services = (await this.services()).filter(isWebspaceService);
    return mapLimit(services, 4, async (service) => {
      let info: WebspaceInfo;
      try {
        info = parseWebspace(await this.call('webspaceInfo', service.internalId), service).info;
      } catch {
        info = webspaceInfoFromService(service);
      }
      return {
        externalId: service.internalId,
        name: info.name,
        info,
        meta: { accounting: service.accounting },
      };
    });
  }

  async getWebspace(externalId: string): Promise<WebspaceInfo> {
    const [data, service] = await Promise.all([
      this.call('webspaceInfo', externalId),
      this.service(externalId),
    ]);
    return parseWebspace(data, service).info;
  }

  async getWebspaceCredentials(externalId: string): Promise<WebspaceCredentials> {
    return parseWebspace(await this.call('webspaceInfo', externalId)).credentials;
  }

  // --- Admin ----------------------------------------------------------------------

  async overview(): Promise<InfraOverview> {
    this.servicesCache = null;
    const [account, services] = await Promise.all([this.loadAccount().catch(() => null), this.services()]);
    const facts: InfraOverview['facts'] = [];
    if (account) {
      if (account.name) facts.push({ label: 'Account', value: account.name });
      if (account.balance !== null)
        facts.push({ label: 'Balance', value: `${account.balance.toFixed(2)} EUR` });
      facts.push({ label: '24fire+', value: account.plus ? 'active' : 'inactive' });
    }
    facts.push(
      { label: 'KVM', value: String(services.filter((s) => isKvmService(s) === 'yes').length) },
      { label: 'Domains', value: String(services.filter(isDomainService).length) },
      { label: 'Web spaces', value: String(services.filter(isWebspaceService).length) },
    );
    const other = services.filter(
      (s) => isKvmService(s) !== 'yes' && !isDomainService(s) && !isWebspaceService(s),
    );
    if (other.length > 0) facts.push({ label: 'Other services', value: String(other.length) });
    return { nodes: [], storages: [], facts };
  }

  async rawRequest(method: string, path: string, body?: Record<string, unknown>): Promise<RawResponse> {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    if (!normalized.startsWith('/api/')) throw unsupported('24fire paths must start with /api/');
    const res = await this.send(method.toUpperCase(), normalized, body);
    return { status: res.status, data: redactSecrets(res.body) };
  }
}

/**
 * The KVM config contains the root password, domain info the transfer auth code and web
 * space info the Plesk password. None of it leaves the API outside the reveal routes.
 */
export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactSecrets) as T;
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = /password|passwd|secret|auth_?code/i.test(key) ? '••••••' : redactSecrets(v);
  }
  return out as T;
}
