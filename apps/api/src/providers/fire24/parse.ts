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
  WebspaceCredentials,
  WebspaceInfo,
} from '@weblion/shared';
import { isRecord, num, str } from '../http';

/**
 * Tolerant parsers for 24fire responses. Field names follow the documented examples
 * (REST API v2); every accessor falls back gracefully so a renamed field degrades one
 * value instead of breaking the whole page. Enum values are never validated strictly:
 * the docs say they can change, unknown values are passed through.
 */

const MB = 1024 * 1024;
const GB = 1024 * MB;

export interface Fire24Accounting {
  buyDate: string | null;
  buyPrice: number | null;
  renewDate: string | null;
  renewPrice: number | null;
  /** Days between renewals (30 or 365 in the docs). */
  renewIntervalDays: number | null;
  autoRenew: boolean | null;
}

export interface Fire24ServiceRef {
  internalId: string;
  name: string;
  /** Lower case service type: kvm, domain, webspace (or whatever 24fire adds later). */
  type: string;
  accounting: Fire24Accounting | null;
  raw: Record<string, unknown>;
}

const SERVICE_TYPE_KEYS = ['type', 'service', 'service_type', 'product', 'category', 'kind'];
const NAME_KEYS = ['name', 'hostname', 'display_name', 'displayname', 'description', 'title', 'domain'];

function firstString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = str(obj[key]);
    if (value) return value;
  }
  return null;
}

function idOf(obj: Record<string, unknown>): string | null {
  return str(obj.internal_id) ?? str(obj.internalId) ?? str(obj.internal_identifier);
}

function bool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return null;
}

export function parseAccounting(value: unknown): Fire24Accounting | null {
  if (!isRecord(value)) return null;
  return {
    buyDate: str(value.buy_date),
    buyPrice: num(value.buy_price),
    renewDate: str(value.renew_date),
    renewPrice: num(value.renew_price),
    renewIntervalDays: num(value.renew_interval),
    autoRenew: bool(value.auto_renew),
  };
}

/**
 * `/api/account/services` lists every active product, grouped by type:
 * `{ services: { WEBSPACE: [...], KVM: [...], DOMAIN: [...] } }`. Flat lists with a type
 * field are understood as well.
 */
export function parseServices(data: unknown): Fire24ServiceRef[] {
  const found = new Map<string, Fire24ServiceRef>();

  const visit = (value: unknown, typeHint: string | null, depth: number) => {
    if (depth > 4) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, typeHint, depth + 1);
      return;
    }
    if (!isRecord(value)) return;

    const id = idOf(value);
    if (id) {
      const type = (firstString(value, SERVICE_TYPE_KEYS) ?? typeHint ?? 'unknown').toLowerCase();
      if (!found.has(id)) {
        found.set(id, {
          internalId: id,
          type,
          name: firstString(value, NAME_KEYS) ?? id,
          accounting: parseAccounting(value.accounting),
          raw: value,
        });
      }
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (Array.isArray(child) || isRecord(child)) visit(child, key, depth + 1);
    }
  };

  visit(data, null, 0);
  return [...found.values()];
}

/**
 * KVM entries are recognized by their type. Unknown types are kept: the adapter then
 * asks for the KVM config and drops the service if 24fire does not know it as a KVM.
 */
export function isKvmService(service: Fire24ServiceRef): 'yes' | 'no' | 'maybe' {
  if (/kvm|vps|vserver|rootserver/.test(service.type)) return 'yes';
  if (/domain|webspace|webhosting|storage|mail|dedicated|gameserver/.test(service.type)) return 'no';
  return 'maybe';
}

export const isDomainService = (service: Fire24ServiceRef) => /domain/.test(service.type);
export const isWebspaceService = (service: Fire24ServiceRef) => /webspace|webhosting/.test(service.type);

export interface Fire24Account {
  id: string | null;
  name: string | null;
  email: string | null;
  /** Prepaid balance in EUR. */
  balance: number | null;
  /** Active 24fire+ subscription. */
  plus: boolean;
}

export function parseAccount(data: unknown): Fire24Account {
  const root = isRecord(data) ? data : {};
  const name = [str(root.firstname), str(root.lastname)].filter(Boolean).join(' ');
  return {
    id: str(root.id),
    name: name || null,
    email: str(root.email),
    balance: num(root.balance),
    plus: bool(root.is_plus_user) ?? false,
  };
}

export function parseIps(config: Record<string, unknown>): IpAddress[] {
  const ips: IpAddress[] = [];
  const add = (list: unknown, version: 4 | 6) => {
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      if (typeof entry === 'string') {
        ips.push({ address: entry, version });
      } else if (isRecord(entry)) {
        const address = str(entry.ip_address) ?? str(entry.ip) ?? str(entry.address);
        if (!address) continue;
        ips.push({
          address,
          version,
          gateway: str(entry.ip_gateway) ?? str(entry.gateway) ?? undefined,
          rdns: str(entry.rdns) ?? undefined,
          ddosProtection: str(entry.ddos_protection) ?? undefined,
        });
      }
    }
  };
  add(config.ipv4, 4);
  add(config.ipv6, 6);
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
  /** CLEAN, WARNED, STATEMENT_EXPECTED or BLOCKED. */
  abuseStatus: string | null;
  /** Largest bookable configuration of this server. */
  maxConfig: (ServerSpecs & { ipv4?: number }) | null;
  monitoring: { enabled: boolean | null; port: number | null } | null;
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

export function parseConfig(data: unknown): ParsedConfig {
  const root = isRecord(data) ? data : {};
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
  return {
    hostname: str(config.hostname) ?? str(config.name),
    specs: specsOf(config),
    os,
    ips: parseIps(config),
    hostsystem: isRecord(root.hostsystem) ? root.hostsystem : null,
    iso,
    abuseStatus: str(root.abuse_status),
    maxConfig: max ? { ...specsOf(max), ipv4: num(max.ipv4) ?? undefined } : null,
    monitoring: monitoring ? { enabled: bool(monitoring.enabled), port: num(monitoring.port) } : null,
  };
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
 * `/status`: `running` or `stopped` plus the task the VM is busy with (BOOTING, REINSTALL,
 * BACKUP_CREATE, BACKUP_RESTORE, HDD_MOUNT). Known tasks override the plain status.
 */
export function parseStatus(data: unknown): {
  status: ServerStatus;
  usage: ServerUsage;
  task: string | null;
} {
  const root = isRecord(data) ? data : {};
  const usage = isRecord(root.usage) ? root.usage : {};
  const cpu = usageValue(usage.cpu);
  const mem = usageValue(usage.mem ?? usage.memory);
  const disk = usageValue(usage.nvme_storage ?? usage.disk ?? usage.storage);
  const task = str(root.task);
  return {
    status: (task ? TASK_STATUS[task.toUpperCase()] : undefined) ?? mapStatus(root.status ?? root.state),
    task,
    usage: {
      cpuPercent: cpu.value ?? undefined,
      memoryUsedMb: toMb(mem.value, mem.unit),
      diskUsedGb: disk.value ?? undefined,
      uptimeSeconds: num(root.uptime) ?? undefined,
    },
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

/** Monitoring timings: cpu in percent, mem in GB, ping in ms, one sample every 10 minutes. */
export function parseTimings(data: unknown): MetricPoint[] {
  const root = isRecord(data) ? data : {};
  const list = Array.isArray(root.timings) ? root.timings : Array.isArray(data) ? data : [];
  const points: MetricPoint[] = [];
  for (const entry of list) {
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

/** Incidences: downtimes in minutes, availability in percent. `end` is null while ongoing. */
export function parseIncidences(data: unknown): MonitoringInfo {
  const root = isRecord(data) ? data : {};
  const statistic = isRecord(root.statistic) ? root.statistic : {};
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

  const incidents = (Array.isArray(root.incidences) ? root.incidences : []).filter(isRecord).map((i) => ({
    start: str(i.start) ?? '',
    end: str(i.end),
    downtimeMinutes: num(i.downtime),
    type: str(i.type) ?? 'UNKNOWN',
  }));
  return { periods, incidents };
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
 * Month enum of the traffic endpoints (1-12). The docs list `MAI` and `JULE`, which may
 * be typos for MAY and JULY; both spellings (and the German names) are accepted.
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

/** `/traffic/current`: usage of the current month in GB (total, in, out) and the limits. */
export function parseTrafficCurrent(data: unknown, now = new Date()): Fire24TrafficInfo {
  const root = isRecord(data) ? data : {};
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

/**
 * `/traffic/log`: one measurement every 10 minutes in MB, each value is the traffic since
 * the previous measurement (not cumulative).
 */
export function parseTrafficLog(data: unknown): NonNullable<TrafficInfo['log']> {
  const root = isRecord(data) ? data : {};
  const list = Array.isArray(data) ? data : Array.isArray(root.log) ? root.log : [];
  const mbToBytes = (value: unknown) => {
    const n = num(value);
    return n === null ? null : Math.round(n * MB);
  };
  return list
    .filter(isRecord)
    .map((entry) => ({
      t: toEpochSeconds(entry.date ?? entry.time ?? entry.timestamp) ?? 0,
      inBytes: mbToBytes(entry.in),
      outBytes: mbToBytes(entry.out),
    }))
    .filter((p) => p.t > 0)
    .sort((a, b) => a.t - b.t);
}

/** Sums non-cumulative traffic samples into buckets (e.g. hours) to keep responses small. */
export function aggregateTraffic(
  points: NonNullable<TrafficInfo['log']>,
  bucketSeconds: number,
): NonNullable<TrafficInfo['log']> {
  const buckets = new Map<number, { t: number; inBytes: number | null; outBytes: number | null }>();
  for (const p of points) {
    const t = Math.floor(p.t / bucketSeconds) * bucketSeconds;
    const bucket = buckets.get(t) ?? { t, inBytes: null, outBytes: null };
    if (p.inBytes !== null) bucket.inBytes = (bucket.inBytes ?? 0) + p.inBytes;
    if (p.outBytes !== null) bucket.outBytes = (bucket.outBytes ?? 0) + p.outBytes;
    buckets.set(t, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}

/** Backup status `pending` is reported as `running`, like the other providers do. */
function backupStatus(value: unknown): string | null {
  const s = str(value);
  return s?.toLowerCase() === 'pending' ? 'running' : s;
}

export function parseBackups(data: unknown): BackupInfo[] {
  const root = isRecord(data) ? data : {};
  const list = Array.isArray(data) ? data : Array.isArray(root.backups) ? root.backups : [];
  return list.filter(isRecord).map((b) => {
    const sizeMb = num(b.size);
    return {
      id: str(b.backup_id) ?? str(b.id) ?? '',
      createdAt: str(b.created) ?? str(b.created_at) ?? null,
      // Sizes look like MB in the docs (583.31).
      sizeBytes: sizeMb === null ? null : sizeMb * MB,
      description: str(b.backup_description) ?? str(b.description),
      status: backupStatus(b.status),
      os: str(b.backup_os),
    };
  });
}

/**
 * `/backup/create/status` and `/backup/restore/status`: `pending` with a progress object
 * (percentage, for creation also GB stored of total) or `finished`.
 */
export function parseBackupTask(data: unknown, id: string, type: string): ProviderTask {
  const root = isRecord(data) ? data : {};
  const status = String(root.status ?? '').toLowerCase();
  const progress = isRecord(root.progress) ? root.progress : null;
  const percentage = progress ? num(progress.percentage) : null;
  const stored = progress ? num(progress.data_stored) : null;
  const total = progress ? num(progress.total_data) : null;
  const finished = status === 'finished' || status === 'done' || status === 'success';
  const failed = /fail|error|abort|cancel/.test(status);
  let message: string | null = null;
  if (failed) message = str(root.message) ?? `24fire reported "${status}"`;
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

/** `/ddos`: object keyed by IPv4 address with `layer4` (dynamic|permanent) and `layer7` (on|off). */
export function parseDdos(data: unknown): DdosSettings[] {
  if (Array.isArray(data)) {
    return data.filter(isRecord).flatMap((entry) => {
      const ip = str(entry.ip_address) ?? str(entry.ip);
      return ip ? [{ ip, layer4: str(entry.layer4), layer7: str(entry.layer7) }] : [];
    });
  }
  if (!isRecord(data)) return [];
  return Object.entries(data)
    .filter(([, v]) => isRecord(v))
    .map(([ip, v]) => {
      const entry = v as Record<string, unknown>;
      return { ip, layer4: str(entry.layer4), layer7: str(entry.layer7) };
    });
}

/**
 * `/api/domain/:id`. The auth code is returned separately and must never be stored or
 * logged; DomainInfo has no field for it.
 */
export function parseDomain(
  data: unknown,
  service?: Fire24ServiceRef | null,
): { info: DomainInfo; authcode: string | null } {
  const root = isRecord(data) ? data : {};
  const domain = isRecord(root.domain) ? root.domain : {};
  const handle = isRecord(root.handle) ? root.handle : {};
  const nameserver = root.nameserver;
  const timings = isRecord(root.timings) ? root.timings : {};
  const nameservers = Array.isArray(nameserver)
    ? nameserver.map(str).filter((s): s is string => !!s)
    : isRecord(nameserver)
      ? Object.keys(nameserver)
          .sort()
          .map((k) => str(nameserver[k]))
          .filter((s): s is string => !!s)
      : [];
  const sld = str(domain.sld);
  const tld = str(domain.tld);
  return {
    info: {
      name: str(domain.name) ?? (sld && tld ? `${sld}.${tld}` : (service?.name ?? '')),
      status: str(domain.status),
      terminated: bool(domain.terminated) ?? false,
      nameservers,
      handle: str(handle.ownerC) ?? str(handle.owner_c) ?? null,
      createdAt: parseFireDate(timings.create) ?? service?.accounting?.buyDate ?? null,
      expiresAt: parseFireDate(timings.expire) ?? service?.accounting?.renewDate ?? null,
      autoRenew: service?.accounting?.autoRenew ?? null,
    },
    authcode: str(domain.authcode),
  };
}

/** Basic facts from the services list, used when the domain endpoint fails. */
export function domainInfoFromService(service: Fire24ServiceRef): DomainInfo {
  return {
    name: service.name,
    status: null,
    terminated: false,
    nameservers: [],
    handle: null,
    createdAt: service.accounting?.buyDate ?? null,
    expiresAt: service.accounting?.renewDate ?? null,
    autoRenew: service.accounting?.autoRenew ?? null,
  };
}

/** `/api/domain/:id/dns`: list of `{ record_id, type, name, data, ttl }`. */
export function parseDnsRecords(data: unknown): DnsRecord[] {
  const root = isRecord(data) ? data : {};
  const list = Array.isArray(data) ? data : Array.isArray(root.records) ? root.records : [];
  return list.filter(isRecord).flatMap((r) => {
    const id = str(r.record_id) ?? str(r.id);
    const type = str(r.type);
    if (!id || !type) return [];
    return [
      { id, type: type.toUpperCase(), name: str(r.name) ?? '', data: String(r.data ?? ''), ttl: num(r.ttl) },
    ];
  });
}

/** 24fire masks the password in some responses ("***********"). */
const MASKED = /^\*+$/;

function panelUrl(host: string | null): string | null {
  if (!host) return null;
  return /^https?:\/\//i.test(host) ? host : `https://${host}`;
}

/** Display name: product name plus login, since several web spaces share a product name. */
export function webspaceName(product: string | null, username: string | null, fallback: string): string {
  if (product && username) return `${product} (${username})`;
  return product ?? username ?? fallback;
}

/**
 * `/api/webspace/:id`: accounting, resources and the Plesk access. The password is only
 * returned in `credentials`; WebspaceInfo has no field for it.
 */
export function parseWebspace(
  data: unknown,
  service?: Fire24ServiceRef | null,
): { info: WebspaceInfo; credentials: WebspaceCredentials } {
  const root = isRecord(data) ? data : {};
  const resources = isRecord(root.resources) ? root.resources : {};
  const access = isRecord(root.access) ? root.access : {};
  const accounting = parseAccounting(root.accounting) ?? service?.accounting ?? null;
  const storageGb = num(resources.ssd_storage);
  const username = str(access.username) ?? (service ? str(service.raw.username) : null);
  const email = str(access.email) ?? (service ? str(service.raw.email) : null);
  const url = panelUrl(str(access.host));
  const password = str(access.password);
  return {
    info: {
      name: webspaceName(service?.name ?? null, username, service?.internalId ?? ''),
      resources: {
        domains: num(resources.domains),
        subdomains: num(resources.subdomains),
        emails: num(resources.emails),
        databases: num(resources.databases),
        // Documented as 5 for a small plan, i.e. GB.
        storageMb: storageGb === null ? null : storageGb * 1024,
        trafficGb: num(resources.traffic),
        memoryLimitMb: num(resources.memory_limit),
        ipAddress: str(resources.ip_address),
      },
      panelUrl: url,
      username,
      email,
      expiresAt: accounting?.renewDate ?? null,
    },
    credentials: {
      panelUrl: url,
      username,
      password: password && !MASKED.test(password) ? password : null,
      email,
    },
  };
}

/** Basic facts from the services list, used when the web space endpoint fails. */
export function webspaceInfoFromService(service: Fire24ServiceRef): WebspaceInfo {
  const username = str(service.raw.username);
  return {
    name: webspaceName(service.name, username, service.internalId),
    resources: {
      domains: null,
      subdomains: null,
      emails: null,
      databases: null,
      storageMb: null,
      trafficGb: null,
      memoryLimitMb: null,
      ipAddress: null,
    },
    panelUrl: null,
    username,
    email: str(service.raw.email),
    expiresAt: service.accounting?.renewDate ?? null,
  };
}
