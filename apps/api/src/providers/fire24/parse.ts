import type {
  BackupInfo,
  DdosSettings,
  DnsRecord,
  DomainInfo,
  IpAddress,
  MetricPoint,
  MonitoringInfo,
  MonitoringPeriod,
  ProviderTask,
  ServerSpecs,
  ServerStatus,
  ServerUsage,
  TrafficInfo,
  WebspaceResources,
} from '@weblion/shared';
import { isRecord, num, str } from '../http';
import { FIRE24_DNS_TYPES } from './endpoints';

/**
 * Tolerant parsers for 24fire Customer REST API v1 answers.
 *
 * The list endpoints, the account, the global status and the web space detail are DOCUMENTED.
 * Everything else is shown as `"data": "example"` in the spec: those payloads are read with the
 * parsers of API v2 (v1 very likely passes the upstream data through), made tolerant:
 * 1. they take `unknown` and never throw; garbage gives empty values;
 * 2. `unwrap`: the v2 shape as is, or one wrapper level ({ data }, { result }, { <name> });
 * 3. `listOf`: a plain array, an array under a key, or an object keyed by id;
 * 4. numbers may come as strings, booleans as 1/0/"true", unknown enum values pass through;
 * 5. "recognised nothing" is reported (null, or `recognised: false`), so the adapter can note
 *    the top-level key names of the shape (never values) for the live test.
 */

const MB = 1024 * 1024;
const GB = 1024 * MB;

export function bool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return null;
}

// --- Shape helpers -----------------------------------------------------------------

/** Wrapper keys every payload may carry once. */
const WRAPPERS = ['data', 'result'];
/** Keys a list may sit under, besides the endpoint's own name. */
const LIST_WRAPPERS = ['data', 'result', 'items', 'list'];

/**
 * The payload itself, or what one wrapper level holds: an object with exactly one key, which is
 * `data`, `result` or one of `names`, and a record or array as its value. The v2 shapes carry
 * several keys, so they pass unchanged.
 */
export function unwrap(data: unknown, names: readonly string[] = []): unknown {
  if (!isRecord(data)) return data;
  const keys = Object.keys(data);
  if (keys.length !== 1) return data;
  const key = keys[0]!;
  if (!WRAPPERS.includes(key) && !names.includes(key)) return data;
  const value = data[key];
  return isRecord(value) || Array.isArray(value) ? value : data;
}

/**
 * Entries of a list payload: a plain array, an array under one of `names` (or data, result,
 * items, list), or an object keyed by id whose values are records (the key becomes `id` when the
 * entry has none). `scalars`: an object of plain values counts too (`{ key: "label" }` gives
 * `{ id: key, value: "label" }`), as do plain values in an array (`{ value }`). Null when the
 * payload is no list at all; `{}` is an empty list.
 */
export function listOf(
  data: unknown,
  names: readonly string[] = [],
  scalars = false,
): Record<string, unknown>[] | null {
  if (Array.isArray(data)) return entries(data, scalars);
  if (!isRecord(data)) return null;
  const wrappers = [...names, ...LIST_WRAPPERS];
  for (const key of wrappers) {
    const value = data[key];
    if (Array.isArray(value)) return entries(value, scalars);
  }
  const keys = Object.keys(data);
  if (keys.length === 1 && wrappers.includes(keys[0]!) && isRecord(data[keys[0]!])) {
    return keyed(data[keys[0]!] as Record<string, unknown>, scalars);
  }
  return keyed(data, scalars);
}

function entries(list: unknown[], scalars: boolean): Record<string, unknown>[] {
  return list.flatMap((entry) => {
    if (isRecord(entry)) return [entry];
    if (scalars && (typeof entry === 'string' || typeof entry === 'number'))
      return [{ value: String(entry) }];
    return [];
  });
}

function keyed(obj: Record<string, unknown>, scalars: boolean): Record<string, unknown>[] | null {
  const pairs = Object.entries(obj);
  if (pairs.every(([, v]) => isRecord(v))) {
    return pairs.map(([key, v]) => {
      const entry = v as Record<string, unknown>;
      return { ...entry, id: str(entry.id) ?? key };
    });
  }
  if (scalars && pairs.every(([, v]) => typeof v === 'string' || typeof v === 'number')) {
    // One entry ({ name, displayname }, { ip_address, ptr }) or a notice, not a list keyed by id.
    if (SINGLE_ENTRY_KEYS.some((k) => k in obj)) return [obj];
    if (NOTICE_KEYS.some((k) => k in obj)) return null;
    return pairs.map(([key, v]) => ({ id: key, value: String(v) }));
  }
  return null;
}

const SINGLE_ENTRY_KEYS = ['id', 'name', 'ip_address', 'ip'];
const NOTICE_KEYS = ['message', 'status', 'error'];

/**
 * Top-level key names of a payload for the shape notes, at most 12. Never values: a plain
 * value is only named by its type.
 */
export function shapeKeys(data: unknown): string[] {
  if (data === null || data === undefined) return ['(null)'];
  if (Array.isArray(data)) return [`(array of ${data.length})`];
  if (!isRecord(data)) return [`(${typeof data})`];
  const keys = Object.keys(data);
  return keys.length > 0 ? keys.slice(0, 12).map((k) => k.slice(0, 40)) : ['(empty object)'];
}

// --- Documented payloads -----------------------------------------------------------

export interface Fire24Account {
  name: string | null;
  customerNumber: string | null;
  email: string | null;
  /** Prepaid balance in EUR. */
  balance: number | null;
  /** Active 24fire+ subscription. */
  plus: boolean;
  registeredAt: string | null;
}

/** `GET /v1/account`. Phone, birth date and billing address are never read into the panel. */
export function parseAccount(data: unknown): Fire24Account {
  const root = isRecord(data) ? data : {};
  const name = [str(root.firstname), str(root.lastname)].filter(Boolean).join(' ');
  return {
    name: name || null,
    customerNumber: str(root.customer_number),
    email: str(root.email),
    balance: num(root.balance),
    // v2 called it is_plus_user.
    plus: bool(root.plus_user ?? root.is_plus_user) ?? false,
    registeredAt: str(root.registered_at ?? root.registry_date),
  };
}

/** Renewal facts of every product in the lists (stored in meta.renewal). */
export interface Fire24Renewal {
  date: string | null;
  price: number | null;
  intervalDays: number | null;
  autoRenew: boolean | null;
  /** e.g. "renewing"; meaning not documented. */
  state: string | null;
  cancellationPending: boolean | null;
  remainingDays: number | null;
  /** Meaning not documented, only stored (open question Q3). */
  disabled: boolean | null;
  type: string | null;
}

export function parseRenewal(item: unknown): Fire24Renewal {
  const root = isRecord(item) ? item : {};
  return {
    date: str(root.renew_date),
    price: num(root.renew_price),
    intervalDays: num(root.renew_interval_days ?? root.renew_interval),
    autoRenew: bool(root.auto_renew),
    state: str(root.renew_state),
    cancellationPending: bool(root.cancellation_pending),
    remainingDays: num(root.remaining_days),
    disabled: bool(root.disabled),
    type: str(root.type),
  };
}

export interface Fire24ServerItem {
  id: string;
  name: string | null;
  type: string | null;
  renewal: Fire24Renewal;
}

/** An entry of `GET /v1/servers` (also the shape of `GET /v1/servers/{server}`). */
export function parseServerItem(item: unknown): Fire24ServerItem | null {
  if (!isRecord(item)) return null;
  const id = str(item.id);
  if (!id) return null;
  return { id, name: str(item.name), type: str(item.type), renewal: parseRenewal(item) };
}

export interface Fire24DomainItem {
  id: string;
  /** The FQDN (`domain`), else `name`. */
  name: string | null;
  renewal: Fire24Renewal;
}

export function parseDomainItem(item: unknown): Fire24DomainItem | null {
  if (!isRecord(item)) return null;
  const id = str(item.id);
  if (!id) return null;
  return { id, name: str(item.domain) ?? str(item.name), renewal: parseRenewal(item) };
}

export interface Fire24WebspaceItem {
  id: string;
  /** Product name, e.g. "Plesk-Medium". */
  name: string | null;
  primaryDomain: string | null;
  provisioningStatus: string | null;
  /** Detail only. */
  package: string | null;
  renewal: Fire24Renewal;
}

export function parseWebspaceItem(item: unknown): Fire24WebspaceItem | null {
  if (!isRecord(item)) return null;
  const id = str(item.id);
  if (!id) return null;
  return {
    id,
    name: str(item.name),
    primaryDomain: str(item.primary_domain),
    provisioningStatus: str(item.provisioning_status),
    package: str(item.package),
    renewal: parseRenewal(item),
  };
}

export interface Fire24ServiceItem {
  id: string;
  name: string | null;
  type: string | null;
  /** kvm, domain, plesk or dedicated (unknown values pass through, lower case). */
  category: string | null;
  manageable: boolean | null;
}

/** An entry of `GET /v1/services`. */
export function parseServiceItem(item: unknown): Fire24ServiceItem | null {
  if (!isRecord(item)) return null;
  const id = str(item.id);
  if (!id) return null;
  return {
    id,
    name: str(item.name),
    type: str(item.type),
    category: str(item.category)?.toLowerCase() ?? null,
    manageable: bool(item.manageable),
  };
}

export interface Fire24Attention {
  operational: boolean | null;
  items: { severity: string; title: string; description: string | null }[];
}

/** `GET /v1/status`: the dashboard attention centre of the account. */
export function parseStatusAttention(data: unknown): Fire24Attention {
  const root = isRecord(data) ? data : {};
  const items = (Array.isArray(root.attention_items) ? root.attention_items : []).filter(isRecord);
  return {
    operational: bool(root.operational),
    items: items.flatMap((item) => {
      const title = str(item.title);
      const description = str(item.description);
      if (!title && !description) return [];
      return [{ severity: str(item.severity) ?? 'info', title: title ?? '', description }];
    }),
  };
}

/** Resource limits with the v2 keys (`ssd_storage` in GB). Null when there is no object. */
export function parseWebspaceResources(value: unknown): WebspaceResources | null {
  if (!isRecord(value)) return null;
  const storageGb = num(value.ssd_storage);
  return {
    domains: num(value.domains),
    subdomains: num(value.subdomains),
    emails: num(value.emails),
    databases: num(value.databases),
    // Documented in v2 as 5 for a small plan, i.e. GB.
    storageMb: storageGb === null ? null : storageGb * 1024,
    trafficGb: num(value.traffic),
    memoryLimitMb: num(value.memory_limit),
    ipAddress: str(value.ip_address),
  };
}

export const EMPTY_WEBSPACE_RESOURCES: WebspaceResources = {
  domains: null,
  subdomains: null,
  emails: null,
  databases: null,
  storageMb: null,
  trafficGb: null,
  memoryLimitMb: null,
  ipAddress: null,
};

export interface Fire24WebspaceDetail {
  item: Fire24WebspaceItem | null;
  /** Null while 24fire answers `resources: null` (as in the spec example). */
  resources: WebspaceResources | null;
  /** From a v2 style `access` object, if 24fire sends one. The password is never read. */
  panelUrl: string | null;
  username: string | null;
  email: string | null;
}

function panelUrl(host: string | null): string | null {
  if (!host) return null;
  return /^https?:\/\//i.test(host) ? host : `https://${host}`;
}

/** `GET /v1/webspaces/{webspace}` (DOCUMENTED, resources UNVERIFIED) and `.../usage`. */
export function parseWebspaceDetail(data: unknown): Fire24WebspaceDetail {
  const root = isRecord(data) ? data : {};
  const access = isRecord(root.access) ? root.access : {};
  return {
    item: parseWebspaceItem(root),
    resources: parseWebspaceResources(root.resources),
    panelUrl: panelUrl(str(access.host) ?? str(access.url)),
    username: str(access.username),
    email: str(access.email),
  };
}

/** `POST /v1/webspaces/{webspace}/login`: the one-time Plesk link, only as an https URL. */
export function parseLoginUrl(data: unknown): string | null {
  const root = unwrap(data, ['login']);
  const value = typeof root === 'string' ? root : isRecord(root) ? str(root.login_url ?? root.url) : null;
  return value && isUrl(value, ['https:']) ? value : null;
}

function isUrl(value: string, protocols: string[]): boolean {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** Display name: product name plus primary domain, since several web spaces share a product name. */
export function webspaceName(product: string | null, domain: string | null, fallback: string): string {
  if (product && domain) return `${product} (${domain})`;
  return product ?? domain ?? fallback;
}

// --- Servers (UNVERIFIED payloads, v2 shapes) ---------------------------------------

/** IPv4 and IPv6 lists (`ipv4`, `ipv6`), or one mixed list (`ips`, `ip_addresses`, `addresses`). */
export function parseIps(config: Record<string, unknown>): IpAddress[] {
  const ips: IpAddress[] = [];
  const add = (list: unknown, version: 4 | 6 | null) => {
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      const address =
        typeof entry === 'string'
          ? str(entry)
          : isRecord(entry)
            ? (str(entry.ip_address) ?? str(entry.ip) ?? str(entry.address))
            : null;
      if (!address) continue;
      const v = version ?? (address.includes(':') ? 6 : 4);
      if (!isRecord(entry)) {
        ips.push({ address, version: v });
        continue;
      }
      ips.push({
        address,
        version: v,
        gateway: str(entry.ip_gateway) ?? str(entry.gateway) ?? undefined,
        rdns: str(entry.rdns) ?? str(entry.ptr) ?? undefined,
        ddosProtection: str(entry.ddos_protection) ?? undefined,
      });
    }
  };
  add(config.ipv4, 4);
  add(config.ipv6, 6);
  if (ips.length === 0) add(config.ips ?? config.ip_addresses ?? config.addresses, null);
  return ips;
}

export interface ParsedConfig {
  hostname: string | null;
  specs: ServerSpecs;
  os: string | null;
  ips: IpAddress[];
  hostsystem: Record<string, unknown> | null;
  /** Attached ISO, null when none is attached. */
  iso: string | null;
  /** CLEAN, WARNED, STATEMENT_EXPECTED or BLOCKED (v2). */
  abuseStatus: string | null;
  /** Largest bookable configuration of this server. */
  maxConfig: (ServerSpecs & { ipv4?: number }) | null;
  monitoring: { enabled: boolean | null; port: number | null } | null;
  /** Anything usable was found (hostname, OS, IPs or specs). */
  recognised: boolean;
}

function specsOf(config: Record<string, unknown>): ServerSpecs {
  return {
    cores: num(config.cores) ?? undefined,
    // Documented values look like MB (2048) for memory and GB for the disk.
    memoryMb: num(config.mem) ?? num(config.memory) ?? undefined,
    diskGb: num(config.disk) ?? undefined,
    networkMbit: num(config.network_speed) ?? undefined,
    backupSlots: num(config.backup_slots) ?? undefined,
  };
}

export function hasSpecs(specs: ServerSpecs): boolean {
  return Object.values(specs).some((v) => v !== undefined);
}

/** `GET config`: v2 `{ hostsystem, config: { cores, mem, ipv4, ... }, max_config, abuse_status }`. */
export function parseConfig(data: unknown): ParsedConfig {
  const root = (() => {
    const value = unwrap(data, ['config', 'server']);
    return isRecord(value) ? value : {};
  })();
  const config = isRecord(root.config) ? root.config : root;
  const os = isRecord(config.os) ? (str(config.os.displayname) ?? str(config.os.name)) : str(config.os);
  let iso: string | null;
  if (isRecord(config.iso)) {
    iso = bool(config.iso.attached) === false ? null : (str(config.iso.displayname) ?? str(config.iso.name));
  } else {
    iso = str(config.iso);
  }
  const max = isRecord(root.max_config) ? root.max_config : null;
  const monitoring = isRecord(config.monitoring) ? config.monitoring : null;
  const hostname = str(config.hostname) ?? str(config.name);
  const specs = specsOf(config);
  const ips = parseIps(config);
  return {
    hostname,
    specs,
    os,
    ips,
    hostsystem: isRecord(root.hostsystem) ? root.hostsystem : null,
    iso,
    abuseStatus: str(root.abuse_status),
    maxConfig: max ? { ...specsOf(max), ipv4: num(max.ipv4) ?? undefined } : null,
    monitoring: monitoring ? { enabled: bool(monitoring.enabled), port: num(monitoring.port) } : null,
    recognised: !!hostname || !!os || ips.length > 0 || hasSpecs(specs),
  };
}

/** `GET network`: the IP fallback when the config has none. */
export function parseNetwork(data: unknown): IpAddress[] {
  const root = unwrap(data, ['network', 'ips']);
  if (Array.isArray(root)) return parseIps({ ips: root });
  if (!isRecord(root)) return [];
  return parseIps(isRecord(root.config) ? root.config : root);
}

export function mapStatus(value: unknown): ServerStatus {
  const s = String(value ?? '').toLowerCase();
  if (['running', 'online', 'started', 'on'].includes(s)) return 'running';
  if (['stopped', 'offline', 'shutoff', 'off'].includes(s)) return 'stopped';
  if (s.includes('install')) return 'installing';
  if (s.includes('backup')) return 'backup';
  if (s.includes('restor')) return 'restoring';
  if (s.includes('start')) return 'starting';
  if (s.includes('stop')) return 'stopping';
  if (s.includes('restart') || s.includes('reboot')) return 'rebooting';
  if (s.includes('pause') || s.includes('suspend')) return 'paused';
  if (s.includes('lock')) return 'locked';
  return 'unknown';
}

/** Running tasks (`task` in the status response) that change what the panel shows. */
const TASK_STATUS: Record<string, ServerStatus> = {
  BOOTING: 'starting',
  REINSTALL: 'installing',
  BACKUP_CREATE: 'backup',
  BACKUP_RESTORE: 'restoring',
};

function usageValue(value: unknown): { value: number | null; unit: string | null } {
  if (isRecord(value)) return { value: num(value.data ?? value.value), unit: str(value.unit) };
  return { value: num(value), unit: null };
}

function toMb(value: number | null, unit: string | null): number | undefined {
  if (value === null) return undefined;
  switch ((unit ?? 'mb').toLowerCase()) {
    case 'gb':
    case 'gib':
      return value * 1024;
    case 'kb':
    case 'kib':
      return value / 1024;
    default:
      return value;
  }
}

/**
 * `GET status`: `running` or `stopped` plus the task the VM is busy with (BOOTING, REINSTALL,
 * BACKUP_CREATE, BACKUP_RESTORE, HDD_MOUNT). Known tasks override the plain status.
 */
export function parseStatus(data: unknown): {
  status: ServerStatus;
  usage: ServerUsage;
  task: string | null;
  recognised: boolean;
} {
  const value = unwrap(data, ['status', 'server']);
  const root = isRecord(value) ? value : typeof value === 'string' ? { status: value } : {};
  const usage = isRecord(root.usage) ? root.usage : {};
  const cpu = usageValue(usage.cpu);
  const mem = usageValue(usage.mem ?? usage.memory);
  const disk = usageValue(usage.nvme_storage ?? usage.disk ?? usage.storage);
  const task = str(root.task);
  const status = (task ? TASK_STATUS[task.toUpperCase()] : undefined) ?? mapStatus(root.status ?? root.state);
  const result: ServerUsage = {
    cpuPercent: cpu.value ?? undefined,
    memoryUsedMb: toMb(mem.value, mem.unit),
    diskUsedGb: disk.value ?? undefined,
    uptimeSeconds: num(root.uptime) ?? undefined,
  };
  return {
    status,
    task,
    usage: result,
    recognised: status !== 'unknown' || Object.values(result).some((v) => v !== undefined),
  };
}

function toEpochSeconds(value: unknown): number | null {
  const s = str(value);
  if (!s) return null;
  const n = Number(s);
  if (Number.isFinite(n)) return n > 1e12 ? Math.floor(n / 1000) : n;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/**
 * Domain timings come as `YYYY-MM-DD HH:MM:SS` without a time zone, everything else as
 * ISO 8601. The former is passed on as local ISO time (`YYYY-MM-DDTHH:MM:SS`).
 */
export function parseFireDate(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) return s.replace(' ', 'T');
  return s;
}

/** The timings list: `timings`, `timings.timings` or a plain array. Null when there is none. */
function timingsList(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (!isRecord(data)) return null;
  if (Array.isArray(data.timings)) return data.timings;
  if (isRecord(data.timings) && Array.isArray(data.timings.timings)) return data.timings.timings;
  return null;
}

/** Monitoring timings: cpu in percent, mem in GB, ping in ms, one sample every 10 minutes. */
export function parseTimings(data: unknown): MetricPoint[] {
  const points: MetricPoint[] = [];
  for (const entry of timingsList(data) ?? []) {
    if (!isRecord(entry)) continue;
    const t = toEpochSeconds(entry.date ?? entry.time ?? entry.timestamp);
    if (t === null) continue;
    const memGb = num(entry.mem);
    points.push({
      t,
      cpu: num(entry.cpu),
      memUsed: memGb === null ? null : memGb * GB,
      ping: num(entry.ping),
    });
  }
  return points.sort((a, b) => a.t - b.t);
}

const PERIOD_ORDER = [
  'LAST_24_HOURS',
  'LAST_7_DAYS',
  'LAST_14_DAYS',
  'LAST_30_DAYS',
  'LAST_90_DAYS',
  'LAST_180_DAYS',
];

/**
 * Incidences: downtimes in minutes, availability in percent, `end` null while ongoing.
 * `statistic` at the top or under `incidences`; incidents as `incidences` (array) or
 * `incidences.incidences`.
 */
export function parseIncidences(data: unknown): MonitoringInfo {
  const root = isRecord(data) ? data : {};
  const nested = isRecord(root.incidences) ? root.incidences : {};
  const statistic = isRecord(root.statistic)
    ? root.statistic
    : isRecord(nested.statistic)
      ? nested.statistic
      : {};
  const order = (key: string) => {
    const i = PERIOD_ORDER.indexOf(key);
    return i === -1 ? PERIOD_ORDER.length : i;
  };
  const periods: MonitoringPeriod[] = Object.entries(statistic)
    .filter(([, v]) => isRecord(v))
    .map(([key, v]) => {
      const p = v as Record<string, unknown>;
      return {
        key,
        availability: num(p.availability),
        downtimeMinutes: num(p.downtime),
        incidences: num(p.incidences),
        longestIncidenceMinutes: num(p.longest_incidence),
      };
    })
    .sort((a, b) => order(a.key) - order(b.key));

  const list = Array.isArray(root.incidences)
    ? root.incidences
    : Array.isArray(nested.incidences)
      ? nested.incidences
      : [];
  const incidents = list.filter(isRecord).map((i) => ({
    start: str(i.start) ?? '',
    end: str(i.end),
    downtimeMinutes: num(i.downtime),
    type: str(i.type) ?? 'UNKNOWN',
  }));
  return { periods, incidents };
}

/** `GET monitoring`: timings and incidences in one answer (v2 had two 24fire+ endpoints). */
export function parseMonitoring(data: unknown): {
  points: MetricPoint[];
  info: MonitoringInfo;
  recognised: boolean;
} {
  const root = unwrap(data, ['monitoring']);
  const points = parseTimings(root);
  const info = parseIncidences(root);
  const record = isRecord(root) ? root : {};
  const recognised =
    timingsList(root) !== null ||
    isRecord(record.statistic) ||
    Array.isArray(record.incidences) ||
    isRecord(record.incidences);
  return { points, info, recognised };
}

const MONTHS: Record<string, number> = {
  JANUARY: 1,
  JANUAR: 1,
  JAN: 1,
  FEBRUARY: 2,
  FEBRUAR: 2,
  FEB: 2,
  MARCH: 3,
  MÄRZ: 3,
  MAERZ: 3,
  MARZ: 3,
  MAR: 3,
  APRIL: 4,
  APR: 4,
  MAY: 5,
  MAI: 5,
  JUNE: 6,
  JUNI: 6,
  JUN: 6,
  JULY: 7,
  JULE: 7,
  JULI: 7,
  JUL: 7,
  AUGUST: 8,
  AUG: 8,
  SEPTEMBER: 9,
  SEP: 9,
  SEPT: 9,
  OCTOBER: 10,
  OKTOBER: 10,
  OCT: 10,
  OKT: 10,
  NOVEMBER: 11,
  NOV: 11,
  DECEMBER: 12,
  DEZEMBER: 12,
  DEC: 12,
  DEZ: 12,
};

/**
 * Month enum of the traffic endpoint (1-12). The v2 docs list `MAI` and `JULE`, which may be
 * typos for MAY and JULY; both spellings (and the German names) are accepted.
 */
export function parseMonth(value: unknown): number | null {
  if (typeof value === 'number') return value >= 1 && value <= 12 ? value : null;
  const s = str(value)?.toUpperCase();
  if (!s) return null;
  if (/^\d{1,2}$/.test(s)) return parseMonth(Number(s));
  return MONTHS[s] ?? null;
}

/** First instant of the given month (or the current one), going back a year if needed. */
function monthPeriod(month: number | null, now = new Date()): { start: string; end: string } {
  const current = now.getUTCMonth() + 1;
  const m = month ?? current;
  const year = m > current ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  return {
    start: new Date(Date.UTC(year, m - 1, 1)).toISOString(),
    end: new Date(Date.UTC(year, m, 1)).toISOString(),
  };
}

/** TrafficInfo plus what 24fire reports on top (remaining volume, throttling). */
export interface Fire24TrafficInfo extends TrafficInfo {
  totalBytes: number | null;
  /** Volume left this month. `limitBytes` is the monthly volume plus `additionalBytes`. */
  remainingBytes: number | null;
  /** Additionally booked volume, null if none. */
  additionalBytes: number | null;
  /** `limit.vm_status`: normal or throttled. */
  vmStatus: string | null;
  throttled: boolean | null;
}

const gbToBytes = (value: unknown) => {
  const n = num(value);
  return n === null ? null : Math.round(n * GB);
};

/** `GET traffic`: usage of the current month in GB (total, in, out) and the limits. */
export function parseTrafficCurrent(data: unknown, now = new Date()): Fire24TrafficInfo {
  const value = unwrap(data, ['traffic', 'current']);
  const root = isRecord(value) ? value : {};
  const usage = isRecord(root.usage) ? root.usage : {};
  const limit = isRecord(root.limit) ? root.limit : {};
  const monthly = gbToBytes(limit.monthly);
  const additional = gbToBytes(limit.additional);
  const inBytes = gbToBytes(usage.in);
  const outBytes = gbToBytes(usage.out);
  const total = gbToBytes(usage.total);
  const vmStatus = str(limit.vm_status);
  const period = monthPeriod(parseMonth(root.month), now);
  return {
    inBytes,
    outBytes,
    totalBytes: total ?? (inBytes !== null || outBytes !== null ? (inBytes ?? 0) + (outBytes ?? 0) : null),
    limitBytes: monthly === null ? null : monthly + (additional ?? 0),
    additionalBytes: additional,
    remainingBytes: gbToBytes(limit.remaining),
    vmStatus,
    throttled: vmStatus ? vmStatus.toLowerCase() === 'throttled' : null,
    periodStart: period.start,
    periodEnd: period.end,
  };
}

/** Backup status `pending` is reported as `running`, like the other providers do. */
function backupStatus(value: unknown): string | null {
  const s = str(value);
  return s?.toLowerCase() === 'pending' ? 'running' : s;
}

/** `GET backups`: array, `{ backups: [...] }` or keyed by id. Null when no list is recognised. */
export function parseBackups(data: unknown): BackupInfo[] | null {
  const list = listOf(data, ['backups']);
  if (!list) return null;
  return list.flatMap((b) => {
    const id = str(b.backup_id) ?? str(b.id);
    if (!id) return [];
    const sizeMb = num(b.size);
    return [
      {
        id,
        createdAt: str(b.created) ?? str(b.created_at) ?? null,
        // Sizes look like MB in the v2 docs (583.31).
        sizeBytes: sizeMb === null ? null : sizeMb * MB,
        description: str(b.backup_description) ?? str(b.description),
        status: backupStatus(b.status),
        os: str(b.backup_os),
      },
    ];
  });
}

/** The backup id in the answer of `POST backups` (`backup_id` or `id`, one wrapper level). */
export function parseBackupId(data: unknown): string | null {
  const root = unwrap(data, ['backup']);
  if (!isRecord(root)) return null;
  return str(root.backup_id) ?? str(root.id);
}

/**
 * `GET backups/{backup}/create-status` and `.../restore-status`: `pending` with a progress
 * object (percentage, for creation also GB stored of total) or `finished`. Null when no state
 * is recognised.
 */
export function parseBackupTask(data: unknown, id: string, type: string): ProviderTask | null {
  const value = unwrap(data, ['status', 'task', 'backup']);
  const root = isRecord(value) ? value : typeof value === 'string' ? { status: value } : null;
  const state = root ? str(root.status ?? root.state) : null;
  if (!root || !state) return null;
  const status = state.toLowerCase();
  const progress = isRecord(root.progress) ? root.progress : null;
  const percentage = progress ? num(progress.percentage) : num(root.progress ?? root.percentage);
  const stored = progress ? num(progress.data_stored) : null;
  const total = progress ? num(progress.total_data) : null;
  const finished = ['finished', 'done', 'success', 'completed', 'complete'].includes(status);
  const failed = /fail|error|abort|cancel/.test(status);
  let message: string | null = null;
  if (failed) message = str(root.message) ?? `24fire reported "${state}"`;
  else if (!finished && percentage !== null) {
    message =
      stored !== null && total !== null ? `${percentage} % (${stored} of ${total} GB)` : `${percentage} %`;
  }
  return {
    id,
    type,
    status: finished ? 'ok' : failed ? 'error' : 'running',
    startedAt: null,
    endedAt: finished || failed ? new Date().toISOString() : null,
    message,
  };
}

const looksLikeIp = (value: string) => /^[\d.]+$|:/.test(value);

/** `GET ddos`: object keyed by IPv4 address with `layer4` and `layer7`, or a list with `ip_address`. */
export function parseDdos(data: unknown): DdosSettings[] | null {
  const root = unwrap(data, ['ddos']);
  // One address as a plain object.
  if (isRecord(root) && str(root.ip_address) && ('layer4' in root || 'layer7' in root)) {
    return [{ ip: str(root.ip_address)!, layer4: str(root.layer4), layer7: str(root.layer7) }];
  }
  const list = listOf(root, ['ddos', 'ips']);
  if (!list) return null;
  return list.flatMap((entry) => {
    const ip = str(entry.ip_address) ?? str(entry.ip) ?? str(entry.id);
    return ip && looksLikeIp(ip) ? [{ ip, layer4: str(entry.layer4), layer7: str(entry.layer7) }] : [];
  });
}

/**
 * `GET rdns`: a list or an object keyed by IP. The PUT fields suggest `ip_address` and `ptr`;
 * `ip`, `address`, `rdns`, `hostname` and `name` are accepted as well.
 */
export function parseRdns(data: unknown): { ip: string; ptr: string | null }[] | null {
  const list = listOf(unwrap(data, ['rdns']), ['rdns', 'records', 'entries'], true);
  if (!list) return null;
  return list.flatMap((entry) => {
    const ip = str(entry.ip_address) ?? str(entry.ip) ?? str(entry.address) ?? str(entry.id);
    if (!ip || !looksLikeIp(ip)) return [];
    const ptr =
      str(entry.ptr) ?? str(entry.rdns) ?? str(entry.hostname) ?? str(entry.name) ?? str(entry.value);
    return [{ ip, ptr: ptr ? ptr.replace(/\.$/, '') : null }];
  });
}

/**
 * OS and ISO lists: strings, `{ name, displayname }` (the v2 config shape), `{ id, name, ... }`
 * or an object keyed by name. The id is `name`, else `id`, else the key; the label is the
 * display name. Null when no list is recognised.
 */
export function parseOptions(
  data: unknown,
  names: readonly string[],
): { id: string; label: string }[] | null {
  const list = listOf(unwrap(data, names), names, true);
  if (!list) return null;
  const seen = new Set<string>();
  return list.flatMap((entry) => {
    const id = str(entry.name) ?? str(entry.id) ?? str(entry.value);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const label =
      str(entry.displayname) ??
      str(entry.display_name) ??
      str(entry.label) ??
      str(entry.title) ??
      str(entry.name) ??
      str(entry.value) ??
      id;
    return [{ id, label }];
  });
}

const DONE = [
  'finished',
  'done',
  'success',
  'successful',
  'completed',
  'complete',
  'ok',
  'installed',
  'ready',
];
const FAILED = /fail|error|abort|cancel/;

/**
 * `GET reinstall/status`: a `status`/`state` string (finished, done, success, completed: ok;
 * fail, error, abort: error; others running), booleans `finished`/`done`/`installing`, a
 * `progress`/`percentage` for the message. Null when nothing is recognised.
 */
export function parseReinstallStatus(
  data: unknown,
): { status: 'running' | 'ok' | 'error'; message: string | null } | null {
  const value = unwrap(data, ['status', 'reinstall', 'installation']);
  const root = isRecord(value) ? value : typeof value === 'string' ? { status: value } : null;
  if (!root) return null;
  const progressValue = isRecord(root.progress) ? root.progress.percentage : root.progress;
  const progress = num(progressValue ?? root.percentage);
  const progressMessage = progress !== null ? `${progress} %` : null;
  const state = str(root.status) ?? str(root.state);
  if (state) {
    const s = state.toLowerCase();
    if (DONE.includes(s)) return { status: 'ok', message: null };
    if (FAILED.test(s))
      return { status: 'error', message: str(root.message) ?? `24fire reported "${state}"` };
    return { status: 'running', message: progressMessage };
  }
  const finished = bool(root.finished) ?? bool(root.done);
  if (finished === true) return { status: 'ok', message: null };
  if (finished === false || bool(root.installing) === true)
    return { status: 'running', message: progressMessage };
  if (progress !== null)
    return progress >= 100
      ? { status: 'ok', message: null }
      : { status: 'running', message: progressMessage };
  return null;
}

const PASSWORD_KEYS = ['password', 'root_password', 'new_password', 'pass'];

function usableSecret(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const s = String(value);
  // 24fire masks secrets in some answers ("***********").
  return s.trim() === '' || /^\*+$/.test(s.trim()) ? null : s;
}

/**
 * `POST password-reset`: `data` as a string, or `password`, `root_password`, `new_password` or
 * `pass` (one wrapper level). The value is shown once and never stored or logged.
 */
export function parsePassword(data: unknown): string | null {
  const root = unwrap(data, ['credentials']);
  if (!isRecord(root)) return usableSecret(root);
  for (const key of PASSWORD_KEYS) {
    const value = usableSecret(root[key]);
    if (value) return value;
  }
  return null;
}

export type Fire24ConsoleAccess =
  { type: 'url'; url: string } | { type: 'vnc'; wssUrl: string; password: string };

const CONSOLE_PAGE_KEYS = ['url', 'console_url', 'novnc_url', 'link'];
const CONSOLE_SOCKET_KEYS = ['wss_url', 'websocket_url', 'ws_url', 'websocket'];
const CONSOLE_SECRET_KEYS = ['password', 'ticket', 'token', 'vnc_password'];

/**
 * `POST console`: an https page (noVNC) under `url`, `console_url`, `novnc_url`, `link` or as
 * `data` itself; or a ws/wss address under `wss_url`, `websocket_url`, `ws_url`, `websocket`
 * with a `password`/`ticket`/`token`. Null when neither is found. Both carry one-time secrets.
 */
export function parseConsole(data: unknown): Fire24ConsoleAccess | null {
  const root = unwrap(data, ['console', 'session']);
  if (typeof root === 'string') return isUrl(root, ['https:']) ? { type: 'url', url: root } : null;
  if (!isRecord(root)) return null;
  for (const key of CONSOLE_PAGE_KEYS) {
    const value = str(root[key]);
    if (value && isUrl(value, ['https:'])) return { type: 'url', url: value };
  }
  const socket = [...CONSOLE_SOCKET_KEYS, ...CONSOLE_PAGE_KEYS]
    .map((key) => str(root[key]))
    .find((value): value is string => !!value && isUrl(value, ['wss:', 'ws:']));
  const password = CONSOLE_SECRET_KEYS.map((key) => usableSecret(root[key])).find((v) => v !== null);
  return socket && password ? { type: 'vnc', wssUrl: socket, password } : null;
}

const hostOf = (value: unknown): string | null => {
  const host = str(
    isRecord(value) ? (value.name ?? value.host ?? value.nameserver ?? value.hostname) : value,
  );
  return host ? host.toLowerCase().replace(/\.$/, '') : null;
};

/**
 * Name servers: an array of strings or of `{ name | host | nameserver }`, an object
 * `{ ns1..ns5 }` (the v2 detail shape, nulls dropped, by number), or either under `nameservers`.
 * Lower case, without a trailing dot. Null when nothing is recognised.
 */
export function parseNameservers(data: unknown): string[] | null {
  const root = unwrap(data, ['nameservers', 'nameserver', 'ns']);
  if (Array.isArray(root)) return root.map(hostOf).filter((h): h is string => !!h);
  if (!isRecord(root)) return null;
  const keys = Object.keys(root)
    .filter((k) => /^ns\d+$/i.test(k))
    .sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
  if (keys.length === 0) return null;
  return keys.map((k) => hostOf(root[k])).filter((h): h is string => !!h);
}

/** The v2 detail is `{ domain: {...}, handle, nameserver, timings }`. */
const isDomainDetail = (value: Record<string, unknown>) =>
  isRecord(value.domain) || 'handle' in value || 'nameserver' in value || 'timings' in value;

/**
 * `GET /v1/domains/{domain}` (v2 shape: status, terminated, name servers, handle, created and
 * expiry from `timings`). Only the fields found are returned, so they win over the list facts
 * field by field; `{}` means nothing was recognised. The auth code is never read (v1 does not
 * return it).
 */
export function parseDomain(data: unknown): Partial<DomainInfo> {
  let root = unwrap(data);
  if (
    isRecord(root) &&
    Object.keys(root).length === 1 &&
    isRecord(root.domain) &&
    isDomainDetail(root.domain)
  ) {
    root = root.domain;
  }
  if (!isRecord(root)) return {};
  const domain = isRecord(root.domain) ? root.domain : root;
  const handle = isRecord(root.handle) ? root.handle : {};
  const timings = isRecord(root.timings) ? root.timings : {};
  const sld = str(domain.sld);
  const tld = str(domain.tld);
  const nameservers = parseNameservers(root.nameserver ?? root.nameservers ?? null);
  const info: Partial<DomainInfo> = {};
  const name =
    (typeof root.domain === 'string' ? str(root.domain) : null) ??
    str(domain.name) ??
    (sld && tld ? `${sld}.${tld}` : null);
  if (name) info.name = name;
  const status = str(domain.status);
  if (status) info.status = status;
  const terminated = bool(domain.terminated);
  if (terminated !== null) info.terminated = terminated;
  if (nameservers && nameservers.length > 0) info.nameservers = nameservers;
  const owner = str(handle.ownerC) ?? str(handle.owner_c);
  if (owner) info.handle = owner;
  const created = parseFireDate(timings.create);
  if (created) info.createdAt = created;
  const expires = parseFireDate(timings.expire);
  if (expires) info.expiresAt = expires;
  return info;
}

/**
 * `GET dns`: list of `{ record_id, type, name, data, ttl }` (array, `{ records }` or keyed).
 * Types 24fire no longer takes (HTTP_FRAME of v2) are read only; they can still be deleted.
 */
export function parseDnsRecords(data: unknown): DnsRecord[] | null {
  const list = listOf(unwrap(data, ['dns']), ['records', 'dns']);
  if (!list) return null;
  const types: readonly string[] = FIRE24_DNS_TYPES;
  return list.flatMap((r) => {
    const id = str(r.record_id) ?? str(r.id);
    const type = str(r.type)?.toUpperCase();
    if (!id || !type) return [];
    const record: DnsRecord = {
      id,
      type,
      name: str(r.name) ?? '',
      data: String(r.data ?? r.content ?? r.value ?? ''),
      ttl: num(r.ttl),
    };
    if (!types.includes(type)) record.readOnly = true;
    return [record];
  });
}
