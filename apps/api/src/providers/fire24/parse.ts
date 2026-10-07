import type {
  BackupInfo,
  IpAddress,
  MetricPoint,
  MonitoringInfo,
  MonitoringPeriod,
  ServerSpecs,
  ServerStatus,
  ServerUsage,
  TrafficInfo,
} from '@weblion/shared';
import { isRecord, num, str } from '../http';

/**
 * Tolerant parsers for 24fire responses. Field names follow the documented examples;
 * every accessor falls back gracefully so a renamed field degrades one value instead
 * of breaking the whole server page.
 */

export interface Fire24ServiceRef {
  internalId: string;
  name: string;
  type: string;
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

/**
 * `/api/account/services` lists every product of the account. The docs only promise that
 * KVM entries carry an `internal_id`; the grouping is handled both as a flat list with a
 * type field and as an object keyed by service type.
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
        found.set(id, { internalId: id, type, name: firstString(value, NAME_KEYS) ?? id, raw: value });
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
  iso: string | null;
}

export function parseConfig(data: unknown): ParsedConfig {
  const root = isRecord(data) ? data : {};
  const config = isRecord(root.config) ? root.config : root;
  const os = isRecord(config.os) ? (str(config.os.displayname) ?? str(config.os.name)) : str(config.os);
  return {
    hostname: str(config.hostname) ?? str(config.name),
    specs: {
      cores: num(config.cores) ?? undefined,
      memoryMb: num(config.mem) ?? num(config.memory) ?? undefined,
      diskGb: num(config.disk) ?? undefined,
      networkMbit: num(config.network_speed) ?? undefined,
      backupSlots: num(config.backup_slots) ?? undefined,
    },
    os,
    ips: parseIps(config),
    hostsystem: isRecord(root.hostsystem) ? root.hostsystem : null,
    iso: isRecord(config.iso) ? (str(config.iso.name) ?? str(config.iso.displayname)) : str(config.iso),
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
  return {
    status: mapStatus(root.status ?? root.state),
    task: str(root.task),
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
      memUsed: memGb === null ? null : memGb * 1024 ** 3,
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

export function parseIncidences(data: unknown): MonitoringInfo {
  const root = isRecord(data) ? data : {};
  const statistic = isRecord(root.statistic) ? root.statistic : {};
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
    .sort((a, b) => PERIOD_ORDER.indexOf(a.key) - PERIOD_ORDER.indexOf(b.key));

  const incidents = (Array.isArray(root.incidences) ? root.incidences : []).filter(isRecord).map((i) => ({
    start: str(i.start) ?? '',
    end: str(i.end),
    downtimeMinutes: num(i.downtime),
    type: str(i.type) ?? 'UNKNOWN',
  }));
  return { periods, incidents };
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    if (key in obj) {
      const v = obj[key];
      const n = isRecord(v) ? num(v.data ?? v.value ?? v.bytes) : num(v);
      if (n !== null) return n;
    }
  }
  return null;
}

const IN_KEYS = ['in', 'incoming', 'inbound', 'rx', 'traffic_in', 'download'];
const OUT_KEYS = ['out', 'outgoing', 'outbound', 'tx', 'traffic_out', 'upload'];

export function parseTrafficCurrent(data: unknown): TrafficInfo {
  const root = isRecord(data) ? data : {};
  const inner = isRecord(root.traffic) ? root.traffic : root;
  return {
    inBytes: pickNumber(inner, IN_KEYS),
    outBytes: pickNumber(inner, OUT_KEYS),
    limitBytes: pickNumber(inner, ['limit', 'max', 'quota', 'included']),
    periodStart: str(inner.start) ?? str(inner.period_start) ?? null,
    periodEnd: str(inner.end) ?? str(inner.period_end) ?? null,
  };
}

export function parseTrafficLog(data: unknown): NonNullable<TrafficInfo['log']> {
  const root = isRecord(data) ? data : {};
  const list = Array.isArray(data)
    ? data
    : Array.isArray(root.log)
      ? root.log
      : Array.isArray(root.traffic)
        ? root.traffic
        : [];
  return list
    .filter(isRecord)
    .map((entry) => ({
      t: toEpochSeconds(entry.date ?? entry.time ?? entry.timestamp) ?? 0,
      inBytes: pickNumber(entry, IN_KEYS),
      outBytes: pickNumber(entry, OUT_KEYS),
    }))
    .filter((p) => p.t > 0)
    .sort((a, b) => a.t - b.t);
}

export function parseBackups(data: unknown): BackupInfo[] {
  const root = isRecord(data) ? data : {};
  const list = Array.isArray(data) ? data : Array.isArray(root.backups) ? root.backups : [];
  return list.filter(isRecord).map((b) => {
    const sizeMb = num(b.size);
    return {
      id: str(b.backup_id) ?? str(b.id) ?? '',
      createdAt: str(b.created) ?? str(b.created_at) ?? null,
      // Documented sizes are in MB.
      sizeBytes: sizeMb === null ? null : sizeMb * 1024 * 1024,
      description: str(b.backup_description) ?? str(b.description),
      status: str(b.status),
      os: str(b.backup_os),
    };
  });
}
