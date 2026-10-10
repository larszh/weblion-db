/**
 * Provider neutral vocabulary. Every infrastructure backend (24fire, Proxmox, later
 * Hetzner, webhosting panels, ...) maps its own data onto these types so the panel,
 * the public API and the UI never care where a server actually runs.
 */

export const PROVIDER_TYPES = [
  'fire24',
  'proxmox',
  'hetzner',
  'joker',
  'nextcloud',
  'cloudflare',
  'mailcow',
  'demo',
] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const PROVIDER_LABELS: Record<ProviderType, string> = {
  fire24: '24fire',
  proxmox: 'Proxmox VE',
  hetzner: 'Hetzner Cloud',
  joker: 'Joker.com',
  nextcloud: 'Nextcloud',
  cloudflare: 'Cloudflare',
  mailcow: 'Mailcow',
  demo: 'Demo',
};

export const CAPABILITIES = [
  'power',
  'metrics',
  'monitoring',
  'traffic',
  'backups',
  'backupRestore',
  'backupDelete',
  'snapshots',
  'console',
  'rescale',
  'rebuild',
  'rdns',
  'ddos',
  'iso',
  'passwordReset',
  'firewall',
  'delete',
  'config',
  'tasks',
  'networkInfo',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const POWER_ACTIONS = ['start', 'shutdown', 'stop', 'reboot', 'reset', 'suspend', 'resume'] as const;
export type PowerAction = (typeof POWER_ACTIONS)[number];

export const METRIC_RANGES = ['hour', 'day', 'week', 'month', 'year'] as const;
export type MetricRange = (typeof METRIC_RANGES)[number];

export type ServerStatus =
  | 'running'
  | 'stopped'
  | 'paused'
  | 'starting'
  | 'stopping'
  | 'rebooting'
  | 'installing'
  | 'backup'
  | 'restoring'
  | 'migrating'
  | 'locked'
  | 'missing'
  | 'error'
  | 'unknown';

export type ServerKind = 'vm' | 'container' | 'dedicated';

export interface Location {
  country: string;
  city?: string;
  label: string;
}

export interface ServerSpecs {
  cores?: number;
  memoryMb?: number;
  diskGb?: number;
  networkMbit?: number;
  backupSlots?: number;
}

export interface ServerUsage {
  cpuPercent?: number;
  memoryUsedMb?: number;
  memoryTotalMb?: number;
  diskUsedGb?: number;
  uptimeSeconds?: number;
}

export interface IpAddress {
  address: string;
  version: 4 | 6;
  gateway?: string;
  rdns?: string;
  ddosProtection?: string;
  interface?: string;
  mac?: string;
}

export interface MetricSeries {
  key: 'cpu' | 'memUsed' | 'memTotal' | 'netIn' | 'netOut' | 'diskRead' | 'diskWrite' | 'ping';
  unit: 'percent' | 'bytes' | 'bytesPerSecond' | 'ms';
}

export interface MetricPoint {
  /** Unix time in seconds. */
  t: number;
  cpu?: number | null;
  memUsed?: number | null;
  memTotal?: number | null;
  netIn?: number | null;
  netOut?: number | null;
  diskRead?: number | null;
  diskWrite?: number | null;
  ping?: number | null;
}

export interface MetricsResult {
  range: MetricRange;
  series: MetricSeries[];
  points: MetricPoint[];
  /** Some providers only sample every few minutes. */
  resolutionSeconds?: number;
}

export interface BackupInfo {
  id: string;
  createdAt: string | null;
  sizeBytes?: number | null;
  description?: string | null;
  status?: string | null;
  storage?: string | null;
  os?: string | null;
  protected?: boolean;
}

export interface SnapshotInfo {
  id: string;
  description?: string | null;
  createdAt?: string | null;
  includesRam?: boolean;
  parent?: string | null;
}

export interface ProviderTask {
  id: string;
  type: string;
  status: 'running' | 'ok' | 'error';
  startedAt: string | null;
  endedAt?: string | null;
  user?: string | null;
  message?: string | null;
}

export interface MonitoringPeriod {
  key: string;
  availability: number | null;
  downtimeMinutes: number | null;
  incidences: number | null;
  longestIncidenceMinutes?: number | null;
}

export interface MonitoringIncident {
  start: string;
  end: string | null;
  downtimeMinutes: number | null;
  type: string;
}

export interface MonitoringInfo {
  periods: MonitoringPeriod[];
  incidents: MonitoringIncident[];
}

export interface TrafficInfo {
  inBytes?: number | null;
  outBytes?: number | null;
  limitBytes?: number | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  log?: { t: number; inBytes: number | null; outBytes: number | null }[];
}

export interface ImageOption {
  id: string;
  label: string;
  family?: string;
}

export interface IsoOption {
  id: string;
  label: string;
}

export interface FirewallRule {
  pos: number;
  enabled: boolean;
  direction: 'in' | 'out';
  action: 'ACCEPT' | 'DROP' | 'REJECT';
  protocol?: string | null;
  dport?: string | null;
  sport?: string | null;
  source?: string | null;
  dest?: string | null;
  comment?: string | null;
}

export interface FirewallInfo {
  enabled: boolean;
  policyIn?: string | null;
  policyOut?: string | null;
  rules: FirewallRule[];
}

export interface DdosSettings {
  ip: string;
  layer4?: string | null;
  layer7?: string | null;
}

export interface RescaleRequest {
  cores?: number;
  memoryMb?: number;
  /** Disks can only grow. */
  diskGb?: number;
  /** Providers with fixed sizes (Hetzner server types) take a plan id instead of the numbers. */
  plan?: string;
  /** Hetzner: also grow the disk to the plan's size. Without it the server can be downgraded again. */
  upgradeDisk?: boolean;
}

/** A fixed size a provider sells (Hetzner server type), e.g. "cx32". */
export interface ServerPlan {
  id: string;
  /** e.g. "CX32" */
  label: string;
  cores: number;
  memoryMb: number;
  diskGb: number;
  /** "x86" or "arm" */
  architecture: string | null;
  /** Shared or dedicated vCPU. */
  cpuType: string | null;
  /** Monthly price at the provider (gross, minor units), for staff only. */
  priceMonthly: { amount: number; currency: string } | null;
  /** Location ids where the plan can be ordered. Empty = everywhere. */
  locations: string[];
  deprecated: boolean;
}

/** A location a provider can create servers in, e.g. Hetzner "fsn1". */
export interface ProviderLocation {
  id: string;
  label: string;
  /** ISO 3166-1 alpha-2 */
  country: string;
  city: string | null;
}

export function isPowerAction(value: string): value is PowerAction {
  return (POWER_ACTIONS as readonly string[]).includes(value);
}

export function isMetricRange(value: string): value is MetricRange {
  return (METRIC_RANGES as readonly string[]).includes(value);
}
