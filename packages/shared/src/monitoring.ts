import type { Location, ProviderType } from './providers';
import type { Permission } from './permissions';

/**
 * Monitoring (module "monitoring"): Uptime Kuma monitors of one or more instances, connected
 * as provider connections of type "uptimekuma". Staff assign monitors to organizations; with an
 * allowance on an instance that staff signed in for management, organizations create their own
 * HTTP(S), keyword, ping and port monitors there ("console" monitors).
 */

export const MONITOR_STATUSES = ['up', 'down', 'pending', 'maintenance', 'paused', 'unknown'] as const;
export type MonitorStatus = (typeof MONITOR_STATUSES)[number];

/** Kuma types customers create themselves (Kuma type names). */
export const MONITOR_KINDS = ['http', 'keyword', 'ping', 'port'] as const;
export type MonitorKind = (typeof MONITOR_KINDS)[number];

export const MONITOR_ORIGINS = ['kuma', 'console'] as const;
export type MonitorOrigin = (typeof MONITOR_ORIGINS)[number];

/** Kuma 2.0 refuses intervals below 20 s. */
export const MONITOR_MIN_INTERVAL_SECONDS = 20;
export const MONITOR_MAX_INTERVAL_SECONDS = 86_400;
export const MONITOR_DEFAULT_INTERVAL_SECONDS = 60;
/** Interval choices in the UI; only those >= the allowance's minimum are offered. */
export const MONITOR_INTERVAL_CHOICES = [20, 30, 60, 120, 300, 600, 900, 1800, 3600] as const;
export const MONITOR_DEFAULT_MAX_MONITORS = 10;
export const MONITOR_DEFAULT_MIN_INTERVAL_SECONDS = 60;
export const MONITOR_MAX_MONITORS_LIMIT = 10_000;
export const MONITOR_NAME_MAX = 80;
export const MONITOR_URL_MAX = 2000;
export const MONITOR_HOST_MAX = 253;
export const MONITOR_KEYWORD_MAX = 200;
/** One accepted status code or range, like Kuma: "200", "200-299". */
export const MONITOR_STATUS_CODE_PATTERN = /^[1-5]\d{2}(-[1-5]\d{2})?$/;
/** Status page slugs as Kuma takes them (it lower-cases them). */
export const MONITOR_STATUS_PAGE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** "recent": the last 100 checks from the public status page. The others need management. */
export const MONITOR_HISTORY_RANGES = ['recent', '24h', '7d', '30d'] as const;
export type MonitorHistoryRange = (typeof MONITOR_HISTORY_RANGES)[number];

export function isMonitorKind(type: string): type is MonitorKind {
  return (MONITOR_KINDS as readonly string[]).includes(type);
}

/** Last known check facts. null = Kuma does not report it (version, type, or not checked yet). */
export interface MonitorFacts {
  /** Last response time in ms. */
  responseMs: number | null;
  avgResponseMs24h: number | null;
  avgResponseMs30d: number | null;
  /** Ratios 0..1 (display with floor, see formatUptime in the web). */
  uptime24h: number | null;
  uptime30d: number | null;
  /** Days until the TLS certificate expires (HTTPS monitors). Negative = expired. */
  certDaysRemaining: number | null;
  certValid: boolean | null;
}

export const EMPTY_MONITOR_FACTS: MonitorFacts = {
  responseMs: null,
  avgResponseMs24h: null,
  avgResponseMs30d: null,
  uptime24h: null,
  uptime30d: null,
  certDaysRemaining: null,
  certValid: null,
};

/** What a customer enters for a monitor. Fields that do not belong to the kind are ignored. */
export interface MonitorTargetInput {
  kind: MonitorKind;
  /** http, keyword: http(s) URL without user name or password. */
  url?: string | null;
  /** ping, port: host name, IPv4 or IPv6 (without brackets). */
  hostname?: string | null;
  /** port: 1..65535. */
  port?: number | null;
  /** keyword: text that must appear in the answer (or must not, with invertKeyword). */
  keyword?: string | null;
}

export interface MonitorInputIssue {
  path: 'url' | 'hostname' | 'port' | 'keyword';
  message: string;
}

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6 = /^[0-9a-f:]+(:\d{1,3}(\.\d{1,3}){3})?$/i;

/** Host name, IPv4 or IPv6 (no brackets, no port, no scheme). */
export function isMonitorHost(value: string): boolean {
  if (!value || value.length > MONITOR_HOST_MAX) return false;
  if (IPV4.test(value)) return true;
  if (value.includes(':')) return IPV6.test(value) && value.split(':').length >= 3;
  return HOSTNAME.test(value) && value.includes('.');
}

/** Format checks of the target fields (no DNS, no address ranges: the API does those). */
export function monitorTargetIssues(input: MonitorTargetInput): MonitorInputIssue[] {
  const issues: MonitorInputIssue[] = [];
  if (input.kind === 'http' || input.kind === 'keyword') {
    const raw = (input.url ?? '').trim();
    let url: URL | null = null;
    try {
      url = raw ? new URL(raw) : null;
    } catch {
      url = null;
    }
    if (!url || !['http:', 'https:'].includes(url.protocol) || !url.hostname) {
      issues.push({ path: 'url', message: 'An http:// or https:// address is required' });
    } else if (url.username || url.password) {
      issues.push({ path: 'url', message: 'The address must not contain a user name or password' });
    } else if (raw.length > MONITOR_URL_MAX) {
      issues.push({ path: 'url', message: `At most ${MONITOR_URL_MAX} characters` });
    }
    if (input.kind === 'keyword') {
      const keyword = input.keyword ?? '';
      if (!keyword.trim()) issues.push({ path: 'keyword', message: 'A keyword is required' });
      else if (keyword.length > MONITOR_KEYWORD_MAX)
        issues.push({ path: 'keyword', message: `At most ${MONITOR_KEYWORD_MAX} characters` });
    }
  } else {
    const host = (input.hostname ?? '').trim();
    if (!isMonitorHost(host)) {
      issues.push({
        path: 'hostname',
        message: 'A host name or IP address is required, without http:// or port',
      });
    }
    if (input.kind === 'port') {
      const port = input.port;
      if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
        issues.push({ path: 'port', message: 'A port between 1 and 65535 is required' });
      }
    }
  }
  return issues;
}

/** Display target of a console monitor: URL, host, or host:port ([v6]:port). */
export function monitorTargetLabel(input: MonitorTargetInput): string {
  if (input.kind === 'http' || input.kind === 'keyword') return (input.url ?? '').trim();
  const host = (input.hostname ?? '').trim();
  if (input.kind === 'port') return host.includes(':') ? `[${host}]:${input.port}` : `${host}:${input.port}`;
  return host;
}

/** Lower-case host of a target (URL host without brackets, or the host field). */
export function monitorTargetHost(input: MonitorTargetInput): string | null {
  if (input.kind === 'http' || input.kind === 'keyword') {
    try {
      return new URL((input.url ?? '').trim()).hostname.replace(/^\[|\]$/g, '').toLowerCase() || null;
    } catch {
      return null;
    }
  }
  const host = (input.hostname ?? '').trim().toLowerCase();
  return host || null;
}

export interface MonitorDto {
  id: string;
  name: string;
  /** Kuma type, e.g. "http", "keyword", "ping", "port", "dns", "group". */
  type: string;
  /** Set for the self-service kinds. */
  kind: MonitorKind | null;
  target: string | null;
  status: MonitorStatus;
  /** false = paused; null = unknown. */
  active: boolean | null;
  intervalSeconds: number | null;
  origin: MonitorOrigin;
  facts: MonitorFacts | null;
  provider: { id: string; type: ProviderType; name: string };
  location: Location;
  org: { id: string; name: string; slug: string } | null;
  /** The organization's public status page on this instance, if one is linked. */
  statusPageUrl: string | null;
  /** origin "console" and the instance is signed in for management. */
  manageable: boolean;
  /** Actions the current user may perform on this monitor. */
  permissions: Permission[];
  lastSyncedAt: string | null;
  missingSince: string | null;
  createdAt: string;
}

/** Configuration as read live from Kuma (management only). Never contains secrets. */
export interface MonitorConfig {
  url: string | null;
  hostname: string | null;
  port: number | null;
  keyword: string | null;
  invertKeyword: boolean;
  method: string | null;
  acceptedStatusCodes: string[];
  intervalSeconds: number;
  retryIntervalSeconds: number | null;
  maxRetries: number | null;
  timeoutSeconds: number | null;
  ignoreTls: boolean;
  upsideDown: boolean;
}

/** A status change (Kuma "important" heartbeat). */
export interface MonitorEvent {
  status: MonitorStatus;
  /** ISO 8601 UTC. */
  at: string;
  message: string | null;
  responseMs: number | null;
}

export interface MonitorDetailDto extends MonitorDto {
  config: MonitorConfig | null;
  /** Newest first, at most 20. null without management. */
  events: MonitorEvent[] | null;
  /** Ranges the chart can show for this monitor right now. */
  historyRanges: MonitorHistoryRange[];
  /** Set when live data could not be loaded (the stored data is shown). */
  liveError: string | null;
  /** Set when the instance is not signed in for management or management failed. */
  managementError: string | null;
}

export interface MonitorHistoryPoint {
  /** Unix time in seconds (start of the bucket). */
  t: number;
  /** Average response time of successful checks in ms. */
  ping: number | null;
  up: number;
  down: number;
  maintenance: number;
}

export interface MonitorHistoryDto {
  range: MonitorHistoryRange;
  /** "kuma": aggregated chart data. "statusPage": the last checks from the public status page. */
  source: 'kuma' | 'statusPage';
  /** Bucket size; null for single checks. */
  resolutionSeconds: number | null;
  points: MonitorHistoryPoint[];
}

export interface MonitorAllowanceDto {
  orgId: string;
  provider: { id: string; type: ProviderType; name: string } | null;
  maxMonitors: number;
  minIntervalSeconds: number;
  /** Own console monitors on the instance. */
  monitors: number;
  /** For a reseller: customers with an allowance on the instance, and their maxMonitors sum. */
  customers: number;
  customerMonitors: number;
  /** monitors + customerMonitors: what counts against maxMonitors. */
  committed: number;
  /** The instance is signed in for management (creating works). */
  management: boolean;
  updatedAt: string | null;
}

export interface MonitorStatusPageDto {
  provider: { id: string; type: ProviderType; name: string };
  slug: string;
  /** Where the public page is. */
  url: string;
}

/** GET /orgs/:orgId/monitoring */
export interface OrgMonitoringDto {
  allowance: MonitorAllowanceDto | null;
  monitors: MonitorDto[];
  statusPages: MonitorStatusPageDto[];
}

/** GET /admin/monitoring/instances: one per monitoring connection. */
export interface MonitoringInstanceDto {
  provider: { id: string; type: ProviderType; name: string };
  /** Kuma version, when known. */
  version: string | null;
  management: 'off' | 'ok' | 'error';
  managementError: string | null;
  /** Uptime and average figures come from /metrics (Kuma 2.1+). */
  uptimeMetrics: boolean;
  monitors: number;
  assigned: number;
  managedBy: 'env' | 'ui';
}
