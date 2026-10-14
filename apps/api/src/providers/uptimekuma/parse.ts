import {
  EMPTY_MONITOR_FACTS,
  type MonitorConfig,
  type MonitorEvent,
  type MonitorFacts,
  type MonitorHistoryPoint,
  type MonitorStatus,
} from '@weblion/shared';
import { isRecord, num, str } from '../http';
import type { MonitorInput, MonitorPatch, RemoteMonitor } from '../types';

/** A monitor as Kuma's socket sends it (getMonitor, monitorList). Holds the monitor's secrets: memory only. */
export type KumaMonitorJson = Record<string, unknown> & { id: number; name: string; type: string };

/** Kuma monitor ids are integers; the console addresses them as text. */
export const KUMA_ID_PATTERN = /^\d{1,10}$/;

// ---------------------------------------------------------------------------
// Prometheus text format

export interface PromSample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

const METRIC_NAME = /[a-zA-Z_:][a-zA-Z0-9_:]*/y;
const LABEL_NAME = /[a-zA-Z_][a-zA-Z0-9_]*/y;
const FLOAT = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

/** Prometheus text format 0.0.4: skips # lines, handles \\ \" \n escapes in label values, NaN, +Inf, -Inf, optional timestamp. */
export function parsePrometheusText(text: string): PromSample[] {
  const samples: PromSample[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const sample = parseSampleLine(line);
    if (sample) samples.push(sample);
  }
  return samples;
}

/** One sample line, or null when it is not well formed (the rest of the text still counts). */
function parseSampleLine(line: string): PromSample | null {
  METRIC_NAME.lastIndex = 0;
  const name = METRIC_NAME.exec(line)?.[0];
  if (!name) return null;
  let i = name.length;
  const skipSpaces = () => {
    while (line[i] === ' ' || line[i] === '\t') i++;
  };
  const labels: Record<string, string> = {};
  if (line[i] === '{') {
    i++;
    for (;;) {
      skipSpaces();
      if (line[i] === '}') {
        i++;
        break;
      }
      LABEL_NAME.lastIndex = i;
      const label = LABEL_NAME.exec(line)?.[0];
      if (!label) return null;
      i += label.length;
      skipSpaces();
      if (line[i] !== '=') return null;
      i++;
      skipSpaces();
      if (line[i] !== '"') return null;
      i++;
      let value = '';
      for (;;) {
        const c = line[i];
        if (c === undefined) return null;
        if (c === '\\') {
          const next = line[i + 1];
          if (next === undefined) return null;
          value += next === 'n' ? '\n' : next;
          i += 2;
          continue;
        }
        i++;
        if (c === '"') break;
        value += c;
      }
      labels[label] = value;
      skipSpaces();
      if (line[i] === ',') {
        i++;
        continue;
      }
      if (line[i] === '}') {
        i++;
        break;
      }
      return null;
    }
  }
  const rest = line.slice(i).trim().split(/\s+/);
  if (!rest[0] || rest.length > 2) return null;
  const value = parseFloatValue(rest[0]);
  if (value === undefined) return null;
  if (rest[1] !== undefined && !/^-?\d+$/.test(rest[1])) return null;
  return { name, labels, value };
}

function parseFloatValue(text: string): number | undefined {
  if (text === 'NaN') return NaN;
  if (text === '+Inf' || text === 'Inf') return Infinity;
  if (text === '-Inf') return -Infinity;
  return FLOAT.test(text) ? Number(text) : undefined;
}

// ---------------------------------------------------------------------------
// /metrics of Uptime Kuma

export interface MetricsMonitor {
  id: string;
  name: string;
  type: string;
  url: string | null;
  hostname: string | null;
  port: number | null;
  /** Raw Kuma status 0..3, null if no monitor_status sample. */
  status: number | null;
  facts: MonitorFacts;
}

export interface KumaMetrics {
  /** From app_version (UNVERIFIED that it is Kuma's version). */
  version: string | null;
  monitors: Map<string, MetricsMonitor>;
  /** monitor_* samples without monitor_id (Kuma 1.x). */
  withoutId: number;
  /** monitor_uptime_ratio present (Kuma 2.1+). */
  uptimeMetrics: boolean;
}

/**
 * A label value or monitor field as text. prom-client prints null and undefined label values
 * as "null" and "undefined" (UNVERIFIED which one), so both count as missing.
 */
export function labelValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' || text === 'null' || text === 'undefined' ? null : text;
}

/** A monitor URL; Kuma's form default "https://" (kept on non-HTTP monitors) means none. */
function urlValue(value: unknown): string | null {
  const text = labelValue(value);
  return text === null || /^https?:\/\/$/i.test(text) ? null : text;
}

function portValue(value: unknown): number | null {
  const text = labelValue(value);
  if (text === null || !/^\d{1,5}$/.test(text)) return null;
  const port = Number(text);
  return port >= 1 && port <= 65535 ? port : null;
}

function finite(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function ratio(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

export function parseKumaMetrics(text: string): KumaMetrics {
  const monitors = new Map<string, MetricsMonitor>();
  let version: string | null = null;
  let withoutId = 0;
  let uptimeMetrics = false;

  for (const sample of parsePrometheusText(text)) {
    const { name, labels, value } = sample;
    if (name === 'app_version') {
      version = labelValue(labels.version) ?? version;
      continue;
    }
    if (!name.startsWith('monitor_')) continue;
    const id = labelValue(labels.monitor_id);
    if (id === null || !KUMA_ID_PATTERN.test(id)) {
      withoutId++;
      continue;
    }
    let monitor = monitors.get(id);
    if (!monitor) {
      monitor = {
        id,
        name: labelValue(labels.monitor_name) ?? `Monitor ${id}`,
        type: labelValue(labels.monitor_type) ?? 'unknown',
        url: urlValue(labels.monitor_url),
        hostname: labelValue(labels.monitor_hostname),
        port: portValue(labels.monitor_port),
        status: null,
        facts: { ...EMPTY_MONITOR_FACTS },
      };
      monitors.set(id, monitor);
    }
    const facts = monitor.facts;
    // Kuma tags (2.1+) arrive as extra labels and are ignored, like every label not read here.
    switch (name) {
      case 'monitor_status':
        monitor.status = Number.isInteger(value) && value >= 0 && value <= 3 ? value : null;
        break;
      case 'monitor_response_time':
        // -1: the beat had no ping (down, or a type without response time).
        facts.responseMs = Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
        break;
      case 'monitor_response_time_seconds': {
        const ms = Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) : null;
        if (labels.window === '1d') facts.avgResponseMs24h = ms;
        else if (labels.window === '30d') facts.avgResponseMs30d = ms;
        break;
      }
      case 'monitor_uptime_ratio':
        uptimeMetrics = true;
        if (labels.window === '1d') facts.uptime24h = ratio(value);
        else if (labels.window === '30d') facts.uptime30d = ratio(value);
        break;
      case 'monitor_cert_days_remaining': {
        const days = finite(value);
        facts.certDaysRemaining = days === null ? null : Math.round(days);
        break;
      }
      case 'monitor_cert_is_valid':
        facts.certValid = value === 1 ? true : value === 0 ? false : null;
        break;
    }
  }
  return { version, monitors, withoutId, uptimeMetrics };
}

// ---------------------------------------------------------------------------
// Monitors

/** Kuma status 0..3 to MonitorStatus; null/other to "unknown". */
export function statusFromKuma(status: number | null): MonitorStatus {
  switch (status) {
    case 1:
      return 'up';
    case 0:
      return 'down';
    case 2:
      return 'pending';
    case 3:
      return 'maintenance';
    default:
      return 'unknown';
  }
}

/** Types whose target is the URL. */
const URL_TYPES = new Set(['http', 'keyword', 'json-query', 'real-browser', 'websocket-upgrade']);
/** Types whose target is the host name alone (a port, if any, is not part of the address). */
const HOST_TYPES = new Set(['ping', 'dns', 'tailscale-ping']);

const SECRET_PARAM = /token|key|secret|pass|auth|sig|session/i;

function maskParams(part: string): string {
  return part
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq < 0) return pair;
      const rawName = pair.slice(0, eq);
      let name = rawName;
      try {
        name = decodeURIComponent(rawName.replace(/\+/g, ' '));
      } catch {
        // Keep the raw name: a broken escape is still matched as text.
      }
      return SECRET_PARAM.test(name) ? `${rawName}=***` : pair;
    })
    .join('&');
}

/** URL for display: no user info, values of query keys matching /token|key|secret|pass|auth|sig|session/i replaced by "***". */
export function sanitizeUrl(url: string): string {
  // Text based, so the URL keeps its spelling (no added slash, no re-encoding).
  let out = url.trim().replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, '$1');
  const hash = out.indexOf('#');
  let fragment = '';
  if (hash >= 0) {
    // Fragments carry tokens too (OAuth "#access_token=...").
    fragment = `#${maskParams(out.slice(hash + 1))}`;
    out = out.slice(0, hash);
  }
  const q = out.indexOf('?');
  if (q >= 0) out = `${out.slice(0, q)}?${maskParams(out.slice(q + 1))}`;
  return out + fragment;
}

function hostOfUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase() || null;
  } catch {
    return null;
  }
}

function hostWithPort(host: string, port: number): string {
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
}

/** Target and host for a Kuma monitor (any type). */
export function kumaTarget(
  type: string,
  url: string | null,
  hostname: string | null,
  port: number | null,
): { target: string | null; targetHost: string | null } {
  const cleanUrl = urlValue(url);
  const host =
    labelValue(hostname)
      ?.replace(/^\[|\]$/g, '')
      .toLowerCase() ?? null;
  const fromUrl = (value: string) => ({ target: sanitizeUrl(value), targetHost: hostOfUrl(value) });
  if (URL_TYPES.has(type) && cleanUrl) return fromUrl(cleanUrl);
  if (host) {
    if (!HOST_TYPES.has(type) && port !== null) return { target: hostWithPort(host, port), targetHost: host };
    return { target: host, targetHost: host };
  }
  return cleanUrl ? fromUrl(cleanUrl) : { target: null, targetHost: null };
}

export function remoteFromMetrics(m: MetricsMonitor): RemoteMonitor {
  return {
    externalId: m.id,
    name: m.name,
    type: m.type,
    ...kumaTarget(m.type, m.url, m.hostname, m.port),
    status: statusFromKuma(m.status),
    // A monitor /metrics reports is running: Kuma removes paused monitors from it.
    active: true,
    intervalSeconds: null,
    parentId: null,
    facts: { ...m.facts },
  };
}

/** true, 1, "1", "true" and false, 0, "0", "false"; anything else null. */
function flag(value: unknown): boolean | null {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

function integer(value: unknown): number | null {
  const n = num(value);
  return n === null ? null : Math.round(n);
}

export interface KumaStats {
  uptime24h?: number;
  uptime30d?: number;
  avgPing24h?: number | null;
}

/** From management JSON, with facts from metrics and socket stats when present. */
export function remoteFromJson(
  json: KumaMonitorJson,
  metrics: MetricsMonitor | undefined,
  stats: KumaStats | undefined,
): RemoteMonitor {
  const type = str(json.type) ?? 'unknown';
  let active = flag(json.active);
  // A paused group pauses its children without touching their own flag.
  if (json.forceInactive === true) active = false;
  const reported = metrics?.status ?? null;
  // Paused first: /metrics can still hold the last beat for the length of the cache.
  const status: MonitorStatus =
    active === false ? 'paused' : reported !== null ? statusFromKuma(reported) : 'unknown';
  const facts: MonitorFacts = { ...(metrics?.facts ?? EMPTY_MONITOR_FACTS) };
  // Kuma 2.0.x has no uptime figures in /metrics; the session's pushed stats fill them in.
  if (facts.uptime24h === null) facts.uptime24h = ratio(stats?.uptime24h);
  if (facts.uptime30d === null) facts.uptime30d = ratio(stats?.uptime30d);
  if (facts.avgResponseMs24h === null && typeof stats?.avgPing24h === 'number') {
    facts.avgResponseMs24h = Number.isFinite(stats.avgPing24h) ? Math.round(stats.avgPing24h) : null;
  }
  const parent = labelValue(json.parent);
  return {
    externalId: String(json.id),
    name: str(json.name) ?? `Monitor ${json.id}`,
    type,
    ...kumaTarget(type, urlValue(json.url), labelValue(json.hostname), portValue(json.port)),
    status,
    active,
    intervalSeconds: integer(json.interval),
    parentId: parent && KUMA_ID_PATTERN.test(parent) ? parent : null,
    facts,
  };
}

/** Whether a socket value is a monitor object Kuma sends. */
export function isKumaMonitorJson(value: unknown): value is KumaMonitorJson {
  return (
    isRecord(value) &&
    typeof value.id === 'number' &&
    Number.isInteger(value.id) &&
    value.id >= 0 &&
    typeof value.name === 'string' &&
    typeof value.type === 'string'
  );
}

export function toMonitorConfig(json: KumaMonitorJson): MonitorConfig {
  const url = urlValue(json.url);
  const keyword = typeof json.keyword === 'string' && json.keyword !== '' ? json.keyword : null;
  const codes = Array.isArray(json.accepted_statuscodes) ? json.accepted_statuscodes : [];
  return {
    url: url ? sanitizeUrl(url) : null,
    hostname: labelValue(json.hostname),
    port: portValue(json.port),
    keyword,
    invertKeyword: flag(json.invertKeyword) === true,
    method: str(json.method),
    acceptedStatusCodes: codes
      .filter((c) => typeof c === 'string' || typeof c === 'number')
      .map((c) => String(c)),
    intervalSeconds: integer(json.interval) ?? 0,
    retryIntervalSeconds: integer(json.retryInterval),
    maxRetries: integer(json.maxretries),
    timeoutSeconds: num(json.timeout),
    ignoreTls: flag(json.ignoreTls) === true,
    upsideDown: flag(json.upsideDown) === true,
  };
}

/** "2026-10-10 08:15:02.123" (UTC without zone) to ISO 8601. */
export function kumaTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  let iso: string;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,9})?$/.test(text)) {
    // Kuma stores heartbeat times in UTC and sends them without a zone.
    iso = `${text.replace(' ', 'T')}Z`;
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/i.test(text)) {
    iso = text;
  } else {
    return null;
  }
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** An "important" heartbeat (status change). `at` is empty when Kuma's time cannot be read. */
export function toMonitorEvent(row: Record<string, unknown>): MonitorEvent {
  const message = typeof row.msg === 'string' ? row.msg.trim().slice(0, 500) : '';
  const ping = num(row.ping);
  return {
    status: statusFromKuma(num(row.status)),
    at: kumaTime(row.time) ?? '',
    message: message || null,
    responseMs: ping !== null && ping >= 0 ? Math.round(ping) : null,
  };
}

/** Events of monitorImportantHeartbeatListPaged, newest first, without unreadable rows. */
export function toMonitorEvents(data: unknown, max = 20): MonitorEvent[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter(isRecord)
    .map(toMonitorEvent)
    .filter((e) => e.at !== '')
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, max);
}

// ---------------------------------------------------------------------------
// Secrets

/** Monitor fields that hold credentials or secret content (Kuma 2.5.6 toJSON with sensitive data). */
export const MONITOR_SECRET_FIELDS: readonly string[] = [
  'basic_auth_user',
  'basic_auth_pass',
  'bearer_token',
  'oauth_client_id',
  'oauth_client_secret',
  'headers',
  'body',
  'databaseConnectionString',
  'mqttUsername',
  'mqttPassword',
  'radiusUsername',
  'radiusPassword',
  'radiusSecret',
  'sshUsername',
  'sshPassword',
  'sshPrivateKey',
  'sshPassphrase',
  'rabbitmqUsername',
  'rabbitmqPassword',
  'kafkaProducerSaslOptions',
  'tlsCa',
  'tlsCert',
  'tlsKey',
  'pushToken',
  'gamedigToken',
  'grpcMetadata',
  'grpcBody',
  'authDomain',
  'authWorkstation',
  'screenshot',
];

const SECRET_FIELDS = new Set(MONITOR_SECRET_FIELDS);
const SECRET_KEY = /pass|secret|token|private_?key|connection_?string/i;

/** Deep copy with every MONITOR_SECRET_FIELDS key and every key matching /pass|secret|token|private_?key|connection_?string/i blanked to "[redacted]". */
export function redactMonitorSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactMonitorSecrets);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = SECRET_FIELDS.has(key) || SECRET_KEY.test(key) ? '[redacted]' : redactMonitorSecrets(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Writes

/** Kuma's timeout for a check: 10 s for ping (at most the interval), else 80 % of the interval up to 48 s. */
export function timeoutFor(kind: string, intervalSeconds: number): number {
  if (kind === 'ping') return Math.min(10, intervalSeconds);
  return Math.min(48, Math.floor(intervalSeconds * 0.8));
}

/**
 * The monitor object for "add". Exactly the 2.0.0 field set: Kuma freezes its schema, so a key
 * the instance does not know fails the insert. The ping options only go along when the
 * instance's own monitors carry them (`knownKeys`, the keys of its monitor list).
 */
export function buildAddPayload(
  input: MonitorInput,
  options: { notificationIds: number[]; knownKeys: ReadonlySet<string> },
): Record<string, unknown> {
  const kind = input.kind;
  const web = kind === 'http' || kind === 'keyword';
  const payload: Record<string, unknown> = {
    type: kind,
    name: input.name,
    url: web ? input.url : 'https://',
    method: input.method,
    hostname: kind === 'ping' || kind === 'port' ? input.hostname : null,
    port: kind === 'port' ? input.port : null,
    keyword: kind === 'keyword' ? input.keyword : null,
    invertKeyword: kind === 'keyword' ? input.invertKeyword : false,
    interval: input.intervalSeconds,
    retryInterval: input.intervalSeconds,
    resendInterval: 0,
    // One retry before "down" (Kuma's form default is 0): fewer false alarms.
    maxretries: 1,
    timeout: timeoutFor(kind, input.intervalSeconds),
    // Kuma's form adds the "Default enabled" notifications itself; the server does not.
    notificationIDList: Object.fromEntries(options.notificationIds.map((id) => [id, true])),
    ignoreTls: input.ignoreTls,
    upsideDown: false,
    expiryNotification: false,
    maxredirects: 10,
    accepted_statuscodes: input.acceptedStatusCodes.map(String),
    dns_resolve_type: 'A',
    dns_resolve_server: '1.1.1.1',
    docker_container: '',
    docker_host: null,
    proxyId: null,
    httpBodyEncoding: 'json',
    kafkaProducerBrokers: [],
    kafkaProducerSaslOptions: { mechanism: 'None' },
    rabbitmqNodes: [],
    conditions: [],
  };
  if (kind === 'ping' && options.knownKeys.has('ping_count')) {
    payload.ping_count = 3;
    payload.ping_numeric = true;
    payload.packetSize = 56;
    payload.ping_per_request_timeout = 2;
  }
  return payload;
}

/**
 * The full monitor object for "editMonitor": Kuma sets every field from the object and nulls
 * what is missing, so the edit starts from the instance's own JSON (secrets included, in memory
 * only) and changes only the patched keys.
 */
export function applyPatch(json: KumaMonitorJson, patch: MonitorPatch): Record<string, unknown> {
  const out: Record<string, unknown> = { ...json };
  const type = json.type;
  const web = type === 'http' || type === 'keyword';
  if (patch.name !== undefined) out.name = patch.name;
  if (patch.url !== undefined && web) out.url = patch.url;
  if (patch.hostname !== undefined && (type === 'ping' || type === 'port')) out.hostname = patch.hostname;
  if (patch.port !== undefined && type === 'port') out.port = patch.port;
  if (type === 'keyword') {
    if (patch.keyword !== undefined) out.keyword = patch.keyword;
    if (patch.invertKeyword !== undefined) out.invertKeyword = patch.invertKeyword;
  }
  if (patch.method !== undefined) out.method = patch.method;
  if (patch.acceptedStatusCodes !== undefined)
    out.accepted_statuscodes = patch.acceptedStatusCodes.map(String);
  if (patch.ignoreTls !== undefined) out.ignoreTls = patch.ignoreTls;
  if (patch.intervalSeconds !== undefined && patch.intervalSeconds !== num(json.interval)) {
    out.interval = patch.intervalSeconds;
    out.retryInterval = patch.intervalSeconds;
    out.timeout = timeoutFor(type, patch.intervalSeconds);
  }
  return out;
}

// ---------------------------------------------------------------------------
// History

const CHART_BUCKETS = {
  '24h': { size: 300, max: 288 },
  '7d': { size: 3600, max: 168 },
  '30d': { size: 21_600, max: 120 },
} as const;

function count(value: unknown): number {
  const n = num(value);
  return n !== null && n > 0 ? n : 0;
}

/**
 * getMonitorChartData entries (minutely for 24 h, hourly for 7 and 30 days) in buckets of 5
 * minutes, 1 hour and 6 hours. The ping of a bucket is the average weighted by successful checks.
 */
export function chartPoints(
  data: unknown,
  range: '24h' | '7d' | '30d',
): { points: MonitorHistoryPoint[]; resolutionSeconds: number } {
  const { size, max } = CHART_BUCKETS[range];
  const buckets = new Map<
    number,
    { up: number; down: number; maintenance: number; pingSum: number; pingWeight: number }
  >();
  for (const entry of Array.isArray(data) ? data : []) {
    if (!isRecord(entry)) continue;
    const timestamp = num(entry.timestamp);
    if (timestamp === null) continue;
    const t = Math.floor(timestamp / size) * size;
    let bucket = buckets.get(t);
    if (!bucket) {
      bucket = { up: 0, down: 0, maintenance: 0, pingSum: 0, pingWeight: 0 };
      buckets.set(t, bucket);
    }
    const up = count(entry.up);
    bucket.up += up;
    bucket.down += count(entry.down);
    bucket.maintenance += count(entry.maintenance);
    const ping = num(entry.avgPing);
    if (up > 0 && ping !== null) {
      bucket.pingSum += ping * up;
      bucket.pingWeight += up;
    }
  }
  const points = [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .slice(-max)
    .map(([t, b]) => ({
      t,
      ping: b.pingWeight > 0 ? Math.round(b.pingSum / b.pingWeight) : null,
      up: b.up,
      down: b.down,
      maintenance: b.maintenance,
    }));
  return { points, resolutionSeconds: size };
}

/** The last checks of a monitor from a status page's heartbeat answer, oldest first; null when it is not on the page. */
export function statusPagePoints(body: unknown, monitorId: string): MonitorHistoryPoint[] | null {
  if (!isRecord(body) || !isRecord(body.heartbeatList)) return null;
  const beats = body.heartbeatList[monitorId];
  if (!Array.isArray(beats)) return null;
  const points: MonitorHistoryPoint[] = [];
  for (const beat of beats) {
    if (!isRecord(beat)) continue;
    const at = kumaTime(beat.time);
    if (!at) continue;
    const status = num(beat.status);
    const ping = num(beat.ping);
    points.push({
      t: Math.floor(Date.parse(at) / 1000),
      ping: ping !== null && ping >= 0 ? Math.round(ping) : null,
      up: status === 1 ? 1 : 0,
      down: status === 0 ? 1 : 0,
      maintenance: status === 3 ? 1 : 0,
    });
  }
  return points.sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------------------
// Kuma's answers

/** Kuma's i18n keys (msgi18n: true) that reach the console as failures. */
const I18N_MESSAGES: Record<string, string> = {
  authIncorrectCreds: 'wrong user name or password',
  authInvalidToken: 'the session token or the two-factor code was refused',
  authUserInactiveOrDeleted: 'the Uptime Kuma account is inactive or deleted',
};

/** Kuma's msg as readable text: i18n keys mapped, free text cut to 300 characters. */
export function describeKumaMessage(msg: string | undefined, msgi18n: boolean | undefined): string {
  const text = (msg ?? '').trim();
  if (!text) return 'refused without a message';
  if (msgi18n) return I18N_MESSAGES[text] ?? text;
  return text.slice(0, 300);
}

export type KumaFailureKind =
  'not_logged_in' | 'not_found' | 'rate_limited' | 'validation' | 'schema' | 'other';

const VALIDATION_MESSAGE =
  /Interval cannot be|Retry interval|Timeout must be|Accepted status codes|must be between|must be valid JSON|cannot be (less|more) than|Invalid Monitor Group|is required/i;

/** What a failed answer means, from Kuma's msg (free text or i18n key). */
export function kumaFailureKind(msg: string | undefined): KumaFailureKind {
  const text = (msg ?? '').trim();
  if (text === 'You are not logged in.') return 'not_logged_in';
  // getMonitor and editMonitor of an unknown id fail on a null bean; pause and resume check the owner.
  if (text === 'You do not own this monitor.' || /Cannot read propert(y|ies) of null/.test(text)) {
    return 'not_found';
  }
  if (text === 'Too frequently, try again later.') return 'rate_limited';
  // SQLite and MariaDB wording for a column the frozen schema does not have.
  if (/has no column named|no such column|Unknown column/i.test(text)) return 'schema';
  if (VALIDATION_MESSAGE.test(text)) return 'validation';
  return 'other';
}
