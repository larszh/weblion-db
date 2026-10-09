import type {
  BackupInfo,
  ImageOption,
  IpAddress,
  MetricPoint,
  MetricRange,
  ProviderLocation,
  ProviderTask,
  ServerPlan,
  ServerStatus,
  SnapshotInfo,
} from '@weblion/shared';
import { isRecord, num, str } from '../http';
import type { RemoteServer } from '../types';

// Subset of the Hetzner Cloud JSON this adapter reads (shapes from hcloud-go schema/*.go).

export interface HetznerDeprecation {
  announced: string;
  unavailable_after: string;
}

export interface HetznerLocation {
  id: number;
  /** "fsn1", "nbg1", "hel1", "ash", "hil", "sin" */
  name: string;
  description?: string;
  /** ISO 3166-1 alpha-2 */
  country: string;
  city: string;
  network_zone?: string;
}

export interface HetznerPrice {
  location: string;
  price_hourly?: { net: string; gross: string };
  /** Decimal strings, e.g. "4.5815000000000000". */
  price_monthly: { net: string; gross: string };
  included_traffic?: number;
}

export interface HetznerServerType {
  id: number;
  name: string;
  description?: string;
  cores: number;
  /** GB, may be fractional (0.5). */
  memory: number;
  disk: number;
  cpu_type?: string;
  architecture?: string;
  deprecated?: boolean | null;
  deprecation?: HetznerDeprecation | null;
  prices?: HetznerPrice[];
  locations?: { id: number; name: string; available?: boolean; deprecation?: HetznerDeprecation | null }[];
}

export type HetznerImageType = 'system' | 'app' | 'snapshot' | 'backup' | 'temporary';

export interface HetznerImage {
  id: number;
  type: HetznerImageType;
  status: string;
  name: string | null;
  description: string;
  /** GB */
  image_size: number | null;
  disk_size: number;
  created: string | null;
  created_from: { id: number; name: string } | null;
  bound_to: number | null;
  os_flavor: string;
  os_version: string | null;
  architecture: string;
  protection?: { delete: boolean };
  /** Timestamp, replaced by `deprecation`. */
  deprecated?: string | null;
  deprecation?: HetznerDeprecation | null;
  labels?: Record<string, string>;
}

export interface HetznerIso {
  id: number;
  name: string;
  description: string;
  /** "public" or "private" (uploaded for the project through support). */
  type: string;
  architecture: string | null;
  deprecation?: HetznerDeprecation | null;
}

export interface HetznerServer {
  id: number;
  name: string;
  status: string;
  created: string;
  public_net: {
    ipv4: { id?: number; ip: string; blocked?: boolean; dns_ptr: string } | null;
    ipv6: {
      id?: number;
      ip: string;
      blocked?: boolean;
      dns_ptr: { ip: string; dns_ptr: string }[] | null;
    } | null;
    floating_ips?: number[];
  };
  private_net?: { network: number; ip: string; alias_ips?: string[]; mac_address?: string }[];
  server_type: HetznerServerType;
  /** Deprecated by Hetzner (gone after 2026-10-01), `location` replaces it. */
  datacenter?: { id: number; name: string; description?: string; location: HetznerLocation } | null;
  location?: HetznerLocation | null;
  image: HetznerImage | null;
  iso: HetznerIso | null;
  rescue_enabled: boolean;
  locked: boolean;
  /** Set when backups are enabled, e.g. "22-02". */
  backup_window: string | null;
  outgoing_traffic: number | null;
  ingoing_traffic: number | null;
  included_traffic: number | null;
  protection: { delete: boolean; rebuild: boolean };
  labels: Record<string, string>;
  primary_disk_size: number;
}

export interface HetznerAction {
  id: number;
  command: string;
  status: 'running' | 'success' | 'error';
  progress: number;
  started: string | null;
  finished: string | null;
  error: { code: string; message: string } | null;
  resources?: { id: number; type: string }[];
}

// ---------------------------------------------------------------------------
// Servers

export function mapStatus(status: string | undefined, locked = false): ServerStatus {
  switch (status) {
    case 'running':
    case 'off':
      // Hetzner locks a server while an action runs on it (backup, snapshot, type change).
      if (locked) return 'locked';
      return status === 'running' ? 'running' : 'stopped';
    case 'initializing':
    case 'rebuilding':
      return 'installing';
    case 'starting':
      return 'starting';
    case 'stopping':
      return 'stopping';
    case 'migrating':
      return 'migrating';
    case 'deleting':
      return 'locked';
    default:
      return 'unknown';
  }
}

/** The server's location. Older answers only carry it inside the (deprecated) datacenter. */
export function serverLocation(server: HetznerServer): HetznerLocation | null {
  return server.location ?? server.datacenter?.location ?? null;
}

/** Expands an IPv6 address (without prefix) to 8 groups, null if it is not one. */
export function expandIpv6(address: string): number[] | null {
  const clean = address.split('/')[0]!.trim().toLowerCase();
  if (!clean.includes(':') || !/^[0-9a-f:]+$/.test(clean)) return null;
  const halves = clean.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.some((g) => g.length === 0 || g.length > 4)) return null;
  return groups.map((g) => parseInt(g, 16));
}

/** Whether `address` lies in `network` ("2a01:4f8:1c19:1403::/64"). */
export function inIpv6Network(address: string, network: string): boolean {
  const a = expandIpv6(address);
  const n = expandIpv6(network);
  if (!a || !n) return false;
  const raw = Number(network.split('/')[1] ?? 128);
  const prefix = Number.isFinite(raw) ? Math.min(128, Math.max(0, raw)) : 128;
  for (let bit = 0; bit < prefix; bit += 16) {
    const take = Math.min(16, prefix - bit);
    const mask = (0xffff << (16 - take)) & 0xffff;
    if ((a[bit / 16]! & mask) !== (n[bit / 16]! & mask)) return false;
  }
  return true;
}

export function sameIpv6(a: string, b: string): boolean {
  const x = expandIpv6(a);
  const y = expandIpv6(b);
  return !!x && !!y && x.every((g, i) => g === y[i]);
}

/**
 * Hetzner assigns a /64. Its images configure the first address (::1), which is also the
 * one shown in the Hetzner console.
 */
export function ipv6Address(network: string): string {
  const base = network.split('/')[0]!;
  return base.endsWith('::') ? `${base}1` : base;
}

/** Hetzner routes public traffic through these fixed gateways (needed for custom ISO installs). */
const IPV4_GATEWAY = '172.31.1.1';
const IPV6_GATEWAY = 'fe80::1';

export function ipsFromServer(server: HetznerServer): IpAddress[] {
  const ips: IpAddress[] = [];
  const v4 = server.public_net?.ipv4;
  if (v4?.ip) {
    ips.push({ address: v4.ip, version: 4, gateway: IPV4_GATEWAY, rdns: str(v4.dns_ptr) ?? undefined });
  }
  const v6 = server.public_net?.ipv6;
  if (v6?.ip) {
    const address = ipv6Address(v6.ip);
    const ptr = (v6.dns_ptr ?? []).find((p) => sameIpv6(p.ip, address));
    ips.push({ address, version: 6, gateway: IPV6_GATEWAY, rdns: str(ptr?.dns_ptr) ?? undefined });
  }
  for (const net of server.private_net ?? []) {
    const mac = str(net.mac_address) ?? undefined;
    for (const address of [net.ip, ...(net.alias_ips ?? [])]) {
      if (str(address)) ips.push({ address, version: address.includes(':') ? 6 : 4, mac });
    }
  }
  return ips;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** "Ubuntu 24.04" for system and app images, the OS flavor for snapshots and backups. */
export function osLabel(image: HetznerImage | null | undefined): string | null {
  if (!image) return null;
  if (image.type === 'system' || image.type === 'app') {
    const description = str(image.description);
    if (description) return description;
  }
  const flavor = str(image.os_flavor);
  if (!flavor || flavor === 'unknown') return null;
  return [capitalize(flavor), str(image.os_version)].filter(Boolean).join(' ');
}

export function memoryMb(memoryGb: number | null | undefined): number | undefined {
  const gb = num(memoryGb);
  return gb === null ? undefined : Math.round(gb * 1024);
}

export function parseServer(server: HetznerServer): RemoteServer {
  const location = serverLocation(server);
  const type = server.server_type;
  return {
    externalId: String(server.id),
    name: server.name,
    kind: 'vm',
    status: mapStatus(server.status, server.locked),
    specs: {
      cores: num(type?.cores) ?? undefined,
      memoryMb: memoryMb(type?.memory),
      // Stays at the old size after a type change without disk upgrade.
      diskGb: num(server.primary_disk_size) ?? num(type?.disk) ?? undefined,
    },
    // The list call carries no usage. Live values come from the metrics endpoint.
    usage: null,
    ips: ipsFromServer(server),
    os: osLabel(server.image),
    node: str(server.datacenter?.name) ?? str(location?.name),
    meta: {
      datacenter: location
        ? {
            name: str(server.datacenter?.name) ?? str(location.description) ?? location.name,
            city: str(location.city),
            country: str(location.country),
          }
        : null,
      location: location?.name ?? null,
      serverType: type?.name ?? null,
      architecture: type?.architecture ?? null,
      protection: { delete: !!server.protection?.delete, rebuild: !!server.protection?.rebuild },
      backupWindow: server.backup_window ?? null,
      rescueEnabled: !!server.rescue_enabled,
      locked: !!server.locked,
      iso: server.iso ? (str(server.iso.description) ?? server.iso.name) : null,
      labels: server.labels ?? {},
      created: server.created ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Server types, locations, prices

/** Deprecated server types, images and ISOs can't be ordered any more (or not much longer). */
export function isDeprecated(resource: {
  deprecated?: boolean | string | null;
  deprecation?: HetznerDeprecation | null;
}): boolean {
  return !!resource.deprecation || !!resource.deprecated;
}

/**
 * Since 2025-09 Hetzner deprecates server types per location and phases out the type wide
 * flag, so a type counts as discontinued once every location deprecated it.
 */
export function isTypeDeprecated(type: HetznerServerType): boolean {
  if (isDeprecated(type)) return true;
  const locations = type.locations ?? [];
  return locations.length > 0 && locations.every((l) => !!l.deprecation);
}

/** Locations where a server type can be ordered now (not deprecated, not sold out). */
export function planLocations(type: HetznerServerType): string[] {
  if (Array.isArray(type.locations) && type.locations.length > 0) {
    return type.locations.filter((l) => l.available !== false && !l.deprecation).map((l) => l.name);
  }
  return (type.prices ?? []).map((p) => p.location);
}

/** Decimal string in EUR ("4.5815000000") to minor units (458). */
export function priceMinor(value: string | null | undefined): number | null {
  const n = num(value);
  return n === null ? null : Math.round(n * 100);
}

/**
 * A server type as a plan. With a location: the price there. Without: the lowest price
 * over the locations where it can be ordered (a "from" price for the create dialog).
 */
export function toPlan(type: HetznerServerType, currency: string, location?: string | null): ServerPlan {
  const orderable = planLocations(type);
  const prices = (type.prices ?? [])
    .filter((p) =>
      location ? p.location === location : orderable.length === 0 || orderable.includes(p.location),
    )
    .map((p) => priceMinor(p.price_monthly?.gross))
    .filter((p): p is number => p !== null);
  return {
    id: type.name,
    label: type.name.toUpperCase(),
    cores: type.cores,
    memoryMb: memoryMb(type.memory) ?? 0,
    diskGb: type.disk,
    architecture: str(type.architecture),
    cpuType: str(type.cpu_type),
    priceMonthly: prices.length > 0 ? { amount: Math.min(...prices), currency } : null,
    locations: orderable,
    deprecated: isTypeDeprecated(type),
  };
}

export function toLocation(location: HetznerLocation): ProviderLocation {
  return {
    id: location.name,
    label: str(location.city) ? `${location.city} (${location.name})` : location.name,
    country: location.country,
    city: str(location.city),
  };
}

// ---------------------------------------------------------------------------
// Images

export function imageLabel(image: HetznerImage): string {
  return str(image.description) ?? str(image.name) ?? `Image ${image.id}`;
}

export function toImageOption(image: HetznerImage, withArchitecture = false): ImageOption {
  let label = imageLabel(image);
  if (withArchitecture && (image.type === 'system' || image.type === 'app')) {
    label += image.architecture === 'arm' ? ' (Arm64)' : ' (x86)';
  }
  if ((image.type === 'snapshot' || image.type === 'backup') && image.created) {
    label += ` (${image.created.slice(0, 10)})`;
  }
  const family =
    image.type === 'system'
      ? (str(image.os_flavor) ?? undefined)
      : image.type === 'app'
        ? 'App'
        : image.type === 'backup'
          ? 'Backup'
          : 'Snapshot';
  return { id: String(image.id), label, family };
}

export function toSnapshot(image: HetznerImage): SnapshotInfo {
  return {
    id: String(image.id),
    description: str(image.description),
    createdAt: image.created ?? null,
    // Hetzner snapshots hold the disk only.
    includesRam: false,
    parent: null,
  };
}

export function toBackup(image: HetznerImage): BackupInfo {
  const sizeGb = num(image.image_size);
  return {
    id: String(image.id),
    createdAt: image.created ?? null,
    sizeBytes: sizeGb === null ? null : Math.round(sizeGb * 1024 ** 3),
    description: str(image.description),
    status: image.status === 'available' ? 'finished' : str(image.status),
    storage: null,
    os: osLabel(image),
    protected: !!image.protection?.delete,
  };
}

export function newestFirst(a: { created: string | null }, b: { created: string | null }): number {
  return (b.created ?? '').localeCompare(a.created ?? '');
}

// ---------------------------------------------------------------------------
// Actions

export function toTask(action: HetznerAction): ProviderTask {
  const status = action.status === 'running' ? 'running' : action.status === 'success' ? 'ok' : 'error';
  return {
    id: String(action.id),
    type: action.command,
    status,
    startedAt: action.started ?? null,
    endedAt: action.finished ?? null,
    user: null,
    message: status === 'error' ? (str(action.error?.message) ?? str(action.error?.code) ?? 'failed') : null,
  };
}

// ---------------------------------------------------------------------------
// Metrics

export const RANGE_SECONDS: Record<MetricRange, number> = {
  hour: 3600,
  day: 86_400,
  week: 7 * 86_400,
  month: 30 * 86_400,
  year: 365 * 86_400,
};

/** At most ~500 points per chart. Hetzner keeps metrics for 30 days, so "year" ends up sparse. */
export function metricStep(range: MetricRange): number {
  return Math.max(30, Math.ceil(RANGE_SECONDS[range] / 500));
}

const METRIC_KEYS: Record<string, keyof Omit<MetricPoint, 't'>> = {
  cpu: 'cpu',
  'network.0.bandwidth.in': 'netIn',
  'network.0.bandwidth.out': 'netOut',
  'disk.0.bandwidth.read': 'diskRead',
  'disk.0.bandwidth.write': 'diskWrite',
};

/**
 * Merges Hetzner time series (`[[unix, "value"], ...]`) into points. Hetzner reports CPU
 * per vCPU (100 % = one core busy), so with `cores` it is scaled to the share of the whole
 * server like the other providers.
 */
export function metricPoints(timeSeries: unknown, cores?: number | null): MetricPoint[] {
  if (!isRecord(timeSeries)) return [];
  const points = new Map<number, MetricPoint>();
  for (const [name, key] of Object.entries(METRIC_KEYS)) {
    const series = timeSeries[name];
    const values = isRecord(series) && Array.isArray(series.values) ? series.values : [];
    for (const entry of values) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const t = num(entry[0]);
      if (t === null) continue;
      const second = Math.round(t);
      let value = num(entry[1]);
      if (value !== null && key === 'cpu') {
        value = Math.round((cores && cores > 0 ? value / cores : value) * 100) / 100;
      }
      const point = points.get(second) ?? { t: second };
      point[key] = value;
      points.set(second, point);
    }
  }
  return [...points.values()].sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------------------
// Secrets

/**
 * Root passwords (create, rebuild, reset_password, enable_rescue) and console access
 * (request_console: one-time VNC password and websocket URL) never leave the adapter
 * through config views or the API explorer.
 */
export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactSecrets) as T;
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = /password|passwd|secret|wss_url/i.test(key) && v !== null ? '••••••' : redactSecrets(v);
  }
  return out as T;
}
