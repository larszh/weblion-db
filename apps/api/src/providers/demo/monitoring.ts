import {
  EMPTY_MONITOR_FACTS,
  MONITOR_KINDS,
  MONITOR_MAX_INTERVAL_SECONDS,
  MONITOR_MIN_INTERVAL_SECONDS,
  MONITOR_STATUS_CODE_PATTERN,
  MONITOR_STATUS_PAGE_SLUG_PATTERN,
  isMonitorKind,
  monitorTargetIssues,
} from '@weblion/shared';
import type {
  MonitorConfig,
  MonitorEvent,
  MonitorFacts,
  MonitorHistoryDto,
  MonitorHistoryPoint,
  MonitorHistoryRange,
  MonitorInputIssue,
  MonitorKind,
  MonitorStatus,
} from '@weblion/shared';
import { ProviderError, badRequest } from '../../lib/errors';
import type {
  MonitorInput,
  MonitorInventory,
  MonitorLive,
  MonitorPatch,
  MonitoringStatus,
  RemoteMonitor,
} from '../types';

/**
 * Simulated Uptime Kuma 2.5.6 instance for the demo provider: eight monitors (one paused, one
 * group), the status page of Muster AG and generated history, kept in memory per connection like
 * the other demo data, so changes survive adapter re-creation. Management is always on. Checks
 * like the Uptime Kuma adapter (monitor ids, names, intervals, status codes, targets through the
 * shared helpers), errors with the provider name "Demo". No network.
 *
 * Time line: the checks of a monitor lie on a grid of its interval anchored at CLOCK_ANCHOR, so a
 * check keeps its time and its response time while the clock moves on. Outages and pauses are
 * stretches of that time line (unix seconds); the status, the events and the history are derived
 * from them and agree with each other.
 */

export const DEMO_KUMA_URL = 'https://status.demo.weblion.one';
export const DEMO_KUMA_VERSION = '2.5.6';
/** Slug of the dataset's public status page (Muster AG, monitors 1, 2 and 3). */
export const DEMO_KUMA_STATUS_PAGE = 'muster-ag';

const PROVIDER = 'Demo';
/** Checks lie on a grid anchored here (unix seconds). */
const CLOCK_ANCHOR = Date.UTC(2026, 9, 10, 8, 0) / 1000;
const MINUTE = 60;
const HOUR = 3600;
const DAY = 86_400;
/** How long the dataset's monitors have been checked (a multiple of every dataset interval). */
const DATASET_AGE = 180 * DAY;
/** Kuma ids of monitors created in the demo start here. */
const FIRST_CREATED_ID = 100;
const ID_PATTERN = /^\d{1,10}$/;
/** Kuma's name column (VARCHAR(150)). */
const NAME_MAX = 150;
/** The public status page JSON carries the last 100 checks (Kuma 2.x). */
const RECENT_CHECKS = 100;
/** monitorImportantHeartbeatListPaged as the adapter asks for it. */
const MAX_EVENTS = 20;
/** Monitor 4 pings the first IPv4 address of this demo server, or the fallback without it. */
const PING_SERVER = 'demo-42-1';
const PING_FALLBACK = '203.0.113.10';
/**
 * getMonitorChartData answers minutely entries up to 24 hours and hourly ones up to 30 days; the
 * console puts them into buckets of `size` seconds and keeps the last `max` (like the Uptime Kuma
 * adapter's chartPoints).
 */
const CHART = {
  '24h': { entry: MINUTE, entries: 24 * 60, size: 5 * MINUTE, max: 288 },
  '7d': { entry: HOUR, entries: 7 * 24, size: HOUR, max: 168 },
  '30d': { entry: HOUR, entries: 30 * 24, size: 6 * HOUR, max: 120 },
} as const;
type ChartRange = keyof typeof CHART;
/** Query keys whose values are masked in displayed URLs, like the Uptime Kuma adapter does. */
const SECRET_PARAM = /token|key|secret|pass|auth|sig|session/i;

type DemoKind = MonitorKind | 'group';
type CheckState = 'up' | 'down' | 'maintenance';

/** Failed checks or a maintenance window, unix seconds, `end` exclusive; null = ongoing. */
interface DemoOutage {
  kind: 'down' | 'maintenance';
  start: number;
  end: number | null;
  /** Kuma's message of the first check of the stretch. */
  message: string;
}

/** A pause, unix seconds, `end` exclusive; null = still paused. */
interface DemoPause {
  start: number;
  end: number | null;
}

/** A simulated monitor (Kuma ids are numbers, kept as text). Never returned as it is. */
export interface DemoMonitor {
  externalId: string;
  name: string;
  type: DemoKind;
  url: string | null;
  hostname: string | null;
  port: number | null;
  keyword: string | null;
  invertKeyword: boolean;
  method: 'GET' | 'HEAD';
  acceptedStatusCodes: string[];
  intervalSeconds: number;
  ignoreTls: boolean;
  parentId: string | null;
  /** Demo server whose first IPv4 address becomes `hostname` once the adapter knows it. */
  hostOfServer: string | null;
  /** Facts while the monitor is up; null fields are not reported. */
  facts: MonitorFacts;
  /** Typical response time for the generated checks; null for groups. */
  basePingMs: number | null;
  /** First check (unix seconds); null until a created monitor had its first check. */
  startedAt: number | null;
  /** Created (or set "pending") and not listed since: the next listMonitors turns it up. */
  pending: boolean;
  outages: DemoOutage[];
  pauses: DemoPause[];
}

export interface DemoMonitoringState {
  /** By Kuma id. */
  monitors: Map<string, DemoMonitor>;
  /** Next Kuma id for created monitors (from 100). */
  nextId: number;
  /** Status pages by slug. */
  statusPages: Map<string, { title: string; monitorIds: string[] }>;
  /** Socket events the console sent, for tests. */
  payloads: { event: string; externalId: string | null }[];
}

interface DatasetMonitor {
  id: string;
  name: string;
  type: DemoKind;
  url?: string;
  hostname?: string;
  port?: number;
  keyword?: string;
  hostOfServer?: string;
  intervalSeconds: number;
  basePingMs: number | null;
  facts: Partial<MonitorFacts>;
  /** Stretches relative to the last check: the first check of it `ago` seconds before. */
  outages?: { kind: 'down' | 'maintenance'; ago: number; duration: number | null; message: string }[];
  /** Paused this many seconds before its last check. */
  pausedAgo?: number;
}

/** The instance as staff set it up in Kuma. */
const DATASET: DatasetMonitor[] = [
  {
    id: '1',
    name: 'muster-ag.ch Website',
    type: 'http',
    url: 'https://www.muster-ag.ch',
    intervalSeconds: 60,
    basePingMs: 204,
    facts: {
      responseMs: 182,
      avgResponseMs24h: 204,
      avgResponseMs30d: 198,
      uptime24h: 0.9993,
      uptime30d: 0.99987,
      certDaysRemaining: 54,
      certValid: true,
    },
    outages: [{ kind: 'down', ago: 2 * DAY, duration: 2 * MINUTE, message: 'timeout of 48000ms exceeded' }],
  },
  {
    id: '2',
    name: '[muster-ag] Shop',
    type: 'keyword',
    url: 'https://muster-shop.ch',
    keyword: 'Warenkorb',
    intervalSeconds: 120,
    basePingMs: 251,
    facts: {
      responseMs: 240,
      avgResponseMs24h: 251,
      avgResponseMs30d: 247,
      uptime24h: 1,
      uptime30d: 0.9991,
      certDaysRemaining: 12,
      certValid: true,
    },
  },
  {
    id: '3',
    name: 'Mailserver SMTP',
    type: 'port',
    hostname: 'mail.muster-ag.ch',
    port: 25,
    intervalSeconds: 60,
    basePingMs: 35,
    facts: { uptime24h: 0.9512, uptime30d: 0.9971 },
    outages: [
      { kind: 'down', ago: 3 * HOUR, duration: 20 * MINUTE, message: 'connect ETIMEDOUT 185.101.0.25:25' },
      // The last six checks failed (this one and the five before it), and it is still down.
      { kind: 'down', ago: 5 * MINUTE, duration: null, message: 'connect ECONNREFUSED 185.101.0.25:25' },
    ],
  },
  {
    id: '4',
    name: 'Webserver Ping',
    type: 'ping',
    hostname: PING_FALLBACK,
    hostOfServer: PING_SERVER,
    intervalSeconds: 60,
    basePingMs: 13,
    facts: { responseMs: 12, avgResponseMs24h: 13, avgResponseMs30d: 13, uptime24h: 1, uptime30d: 1 },
  },
  {
    id: '5',
    name: 'baeckerei-huber.ch',
    type: 'http',
    url: 'https://baeckerei-huber.ch',
    intervalSeconds: 300,
    basePingMs: 310,
    facts: {
      responseMs: 320,
      avgResponseMs24h: 310,
      avgResponseMs30d: 305,
      uptime24h: 1,
      uptime30d: 0.9998,
      certDaysRemaining: 6,
      certValid: true,
    },
  },
  {
    id: '6',
    name: 'alpenblick-hotel.ch',
    type: 'http',
    url: 'https://alpenblick-hotel.ch',
    intervalSeconds: 60,
    basePingMs: 280,
    facts: {},
    pausedAgo: 2 * DAY,
  },
  {
    id: '7',
    name: 'Status API',
    type: 'http',
    url: 'https://api.weblion.example/health',
    intervalSeconds: 30,
    basePingMs: 99,
    facts: {
      responseMs: 95,
      avgResponseMs24h: 101,
      avgResponseMs30d: 99,
      uptime24h: 1,
      uptime30d: 1,
      certDaysRemaining: 80,
      certValid: true,
    },
  },
  {
    id: '8',
    name: 'Kunden-Websites',
    type: 'group',
    intervalSeconds: 60,
    basePingMs: null,
    facts: { uptime24h: 0.99 },
  },
];

const nowSeconds = () => Math.floor(Date.now() / 1000);
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

/** The last check of a monitor with this interval at or before `now`. */
function lastCheck(interval: number, now: number): number {
  return CLOCK_ANCHOR + Math.floor((now - CLOCK_ANCHOR) / interval) * interval;
}

/** Index of the first check at or after `t`. */
function checkIndex(interval: number, t: number): number {
  return Math.ceil((t - CLOCK_ANCHOR) / interval);
}

/** Number of checks in [from, to). */
function checksIn(interval: number, from: number, to: number): number {
  return Math.max(0, checkIndex(interval, to) - checkIndex(interval, from));
}

/** Deterministic noise in [0, 1) for a monitor and a check (or an entry start). */
function noise(seed: number, k: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(k | 0, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
}

function generate(now: number): DemoMonitoringState {
  const monitors = new Map<string, DemoMonitor>();
  for (const d of DATASET) {
    const last = lastCheck(d.intervalSeconds, now);
    monitors.set(d.id, {
      externalId: d.id,
      name: d.name,
      type: d.type,
      url: d.url ?? null,
      hostname: d.hostname ?? null,
      port: d.port ?? null,
      keyword: d.keyword ?? null,
      invertKeyword: false,
      method: 'GET',
      acceptedStatusCodes: ['200-299'],
      intervalSeconds: d.intervalSeconds,
      ignoreTls: false,
      parentId: null,
      hostOfServer: d.hostOfServer ?? null,
      facts: { ...EMPTY_MONITOR_FACTS, ...d.facts },
      basePingMs: d.basePingMs,
      startedAt: last - DATASET_AGE,
      pending: false,
      outages: (d.outages ?? []).map((o) => ({
        kind: o.kind,
        start: last - o.ago,
        end: o.duration === null ? null : last - o.ago + o.duration,
        message: o.message,
      })),
      pauses: d.pausedAgo === undefined ? [] : [{ start: last - d.pausedAgo, end: null }],
    });
  }
  return {
    monitors,
    nextId: FIRST_CREATED_ID,
    statusPages: new Map([
      [DEMO_KUMA_STATUS_PAGE, { title: 'Muster AG Status', monitorIds: ['1', '2', '3'] }],
    ]),
    payloads: [],
  };
}

const STATE = new Map<string, DemoMonitoringState>();

/** The state of one demo connection, generated at its first use. */
export function demoMonitoringState(connectionId: string): DemoMonitoringState {
  let state = STATE.get(connectionId);
  if (!state) {
    state = generate(nowSeconds());
    STATE.set(connectionId, state);
  }
  return state;
}

/** Test helper: forget all simulated monitoring state. */
export function resetDemoMonitoring(): void {
  STATE.clear();
}

// --- Validation, like the Uptime Kuma adapter -----------------------------------------

function invalid(path: string, message: string): never {
  throw badRequest('Validation failed', [{ path, message }]);
}

function assertName(name: string): void {
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name.length > NAME_MAX ||
    /[\u0000-\u001f\u007f]/.test(name)
  ) {
    invalid('name', 'Invalid monitor name');
  }
}

function assertInterval(seconds: number): void {
  if (
    !Number.isInteger(seconds) ||
    seconds < MONITOR_MIN_INTERVAL_SECONDS ||
    seconds > MONITOR_MAX_INTERVAL_SECONDS
  ) {
    invalid(
      'intervalSeconds',
      `The interval must be ${MONITOR_MIN_INTERVAL_SECONDS} to ${MONITOR_MAX_INTERVAL_SECONDS} seconds`,
    );
  }
}

function assertStatusCodes(codes: string[]): void {
  if (
    !Array.isArray(codes) ||
    codes.length < 1 ||
    codes.length > 10 ||
    !codes.every((c) => typeof c === 'string' && MONITOR_STATUS_CODE_PATTERN.test(c))
  ) {
    invalid('acceptedStatusCodes', 'Status codes like "200" or "200-299", 1 to 10 of them');
  }
}

function assertMethod(method: string): void {
  if (method !== 'GET' && method !== 'HEAD') invalid('method', 'GET or HEAD');
}

function assertTarget(issues: MonitorInputIssue[]): void {
  if (issues.length > 0) throw badRequest('Validation failed', issues);
}

/** Kuma lower-cases slugs; the console only asks for ones it can address. */
function statusPageSlug(slug: string): string {
  const clean = slug.trim().toLowerCase();
  if (!MONITOR_STATUS_PAGE_SLUG_PATTERN.test(clean)) {
    throw badRequest(`Invalid status page slug "${slug.slice(0, 70)}"`);
  }
  return clean;
}

const trimmed = (value: string | null | undefined) => (typeof value === 'string' ? value.trim() : null);

// --- What the instance reports ---------------------------------------------------------

function maskParams(part: string): string {
  return part
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq < 0) return pair;
      let name = pair.slice(0, eq);
      try {
        name = decodeURIComponent(name.replace(/\+/g, ' '));
      } catch {
        // A broken escape is matched as text.
      }
      return SECRET_PARAM.test(name) ? `${pair.slice(0, eq)}=***` : pair;
    })
    .join('&');
}

/** URL for display like the Uptime Kuma adapter: no user info, secret-looking values masked. */
function displayUrl(url: string): string {
  let out = url.trim().replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, '$1');
  let fragment = '';
  const hash = out.indexOf('#');
  if (hash >= 0) {
    fragment = `#${maskParams(out.slice(hash + 1))}`;
    out = out.slice(0, hash);
  }
  const q = out.indexOf('?');
  if (q >= 0) out = `${out.slice(0, q)}?${maskParams(out.slice(q + 1))}`;
  return out + fragment;
}

function targetOf(m: DemoMonitor): { target: string | null; targetHost: string | null } {
  if (m.type === 'http' || m.type === 'keyword') {
    if (!m.url) return { target: null, targetHost: null };
    let host: string | null = null;
    try {
      host = new URL(m.url.trim()).hostname.replace(/^\[|\]$/g, '').toLowerCase() || null;
    } catch {
      host = null;
    }
    return { target: displayUrl(m.url), targetHost: host };
  }
  const host =
    m.hostname
      ?.trim()
      .replace(/^\[|\]$/g, '')
      .toLowerCase() || null;
  if (!host) return { target: null, targetHost: null };
  if (m.type === 'port' && m.port !== null) {
    return { target: host.includes(':') ? `[${host}]:${m.port}` : `${host}:${m.port}`, targetHost: host };
  }
  return { target: host, targetHost: host };
}

function isPaused(m: DemoMonitor): boolean {
  return m.pauses.some((p) => p.end === null);
}

/** What a check at `t` reports, pauses aside. */
function stateAt(m: DemoMonitor, t: number): CheckState {
  const covers = (o: DemoOutage) => o.start <= t && (o.end === null || t < o.end);
  if (m.outages.some((o) => o.kind === 'maintenance' && covers(o))) return 'maintenance';
  if (m.outages.some((o) => o.kind === 'down' && covers(o))) return 'down';
  return 'up';
}

function statusOf(m: DemoMonitor, now: number): MonitorStatus {
  if (isPaused(m)) return 'paused';
  if (m.pending || m.startedAt === null) return 'pending';
  return stateAt(m, now);
}

/** Paused and pending monitors report nothing (/metrics drops paused ones); failed checks no ping. */
function factsOf(m: DemoMonitor, status: MonitorStatus): MonitorFacts {
  if (status === 'paused' || status === 'pending') return { ...EMPTY_MONITOR_FACTS };
  const facts = { ...m.facts };
  facts.responseMs = status === 'up' ? (facts.responseMs ?? m.basePingMs) : null;
  return facts;
}

/** Facts after the first successful check of a created monitor. */
function firstFacts(m: DemoMonitor): MonitorFacts {
  const ping = m.basePingMs;
  const tls = (m.type === 'http' || m.type === 'keyword') && /^https:/i.test(m.url?.trim() ?? '');
  return {
    responseMs: ping,
    avgResponseMs24h: ping,
    avgResponseMs30d: ping,
    uptime24h: 1,
    uptime30d: 1,
    certDaysRemaining: tls ? 60 + (Number(m.externalId) % 30) : null,
    certValid: tls ? true : null,
  };
}

function createdPing(kind: MonitorKind, id: number): number {
  if (kind === 'ping') return 8 + (id % 12);
  if (kind === 'port') return 20 + (id % 30);
  return 80 + ((id * 37) % 160);
}

/** Kuma's request timeout for a new monitor, like the adapter sends it. */
function timeoutFor(kind: DemoKind, interval: number): number {
  return kind === 'ping' ? Math.min(10, interval) : Math.min(48, Math.floor(interval * 0.8));
}

function upMessage(m: DemoMonitor): string | null {
  if (m.type === 'http') return '200 - OK';
  if (m.type === 'keyword') return `200 - OK, keyword ${m.invertKeyword ? 'not' : 'is'} found`;
  if (m.type === 'group') return 'All children up and running';
  return null;
}

function downMessage(m: DemoMonitor): string {
  if (m.type === 'http' || m.type === 'keyword') return 'Request failed with status code 503';
  if (m.type === 'ping') return '100% packet loss';
  if (m.type === 'port') return `connect ECONNREFUSED ${targetOf(m).target ?? ''}`;
  return 'Child inaccessible';
}

function configOf(m: DemoMonitor): MonitorConfig {
  return {
    url: m.url ? displayUrl(m.url) : null,
    hostname: m.hostname,
    port: m.port,
    keyword: m.keyword,
    invertKeyword: m.invertKeyword,
    method: m.method,
    acceptedStatusCodes: [...m.acceptedStatusCodes],
    intervalSeconds: m.intervalSeconds,
    retryIntervalSeconds: m.intervalSeconds,
    maxRetries: 1,
    timeoutSeconds: timeoutFor(m.type, m.intervalSeconds),
    ignoreTls: m.ignoreTls,
    upsideDown: false,
  };
}

/** Status changes (Kuma's important heartbeats), newest first, at most 20. */
function eventsOf(m: DemoMonitor, now: number): MonitorEvent[] {
  const started = m.startedAt;
  if (started === null) return [];
  const list: { t: number; seq: number; event: MonitorEvent }[] = [];
  const add = (t: number, status: CheckState, message: string | null) =>
    list.push({
      t,
      seq: list.length,
      event: { status, at: iso(t), message, responseMs: status === 'up' ? m.basePingMs : null },
    });
  if (stateAt(m, started) === 'up') add(started, 'up', upMessage(m));
  for (const o of m.outages) {
    if (o.start < started || o.start > now) continue;
    add(o.start, o.kind, o.message);
    if (o.end !== null && o.end <= now && stateAt(m, o.end) === 'up') add(o.end, 'up', upMessage(m));
  }
  return list
    .sort((a, b) => b.t - a.t || b.seq - a.seq)
    .slice(0, MAX_EVENTS)
    .map((e) => e.event);
}

/** Stretches with checks, oldest first: from the first check to now, pauses left out. */
function segments(m: DemoMonitor, now: number): { start: number; end: number; state: CheckState }[] {
  const started = m.startedAt;
  if (started === null) return [];
  const until = now + 1;
  const cuts = new Set([started, until]);
  for (const o of m.outages) {
    cuts.add(o.start);
    if (o.end !== null) cuts.add(o.end);
  }
  for (const p of m.pauses) {
    cuts.add(p.start);
    if (p.end !== null) cuts.add(p.end);
  }
  const points = [...cuts].filter((c) => c >= started && c <= until).sort((a, b) => a - b);
  const out: { start: number; end: number; state: CheckState }[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const start = points[i]!;
    const end = points[i + 1]!;
    if (m.pauses.some((p) => p.start <= start && (p.end === null || start < p.end))) continue;
    const state = stateAt(m, start);
    const prev = out.at(-1);
    if (prev && prev.end === start && prev.state === state) prev.end = end;
    else out.push({ start, end, state });
  }
  return out;
}

function pingAt(m: DemoMonitor, k: number): number | null {
  if (m.basePingMs === null) return null;
  return Math.max(1, Math.round(m.basePingMs * (0.85 + 0.3 * noise(Number(m.externalId), k))));
}

/** The last 100 checks, oldest first, like the status page heartbeat list. */
function recentChecks(m: DemoMonitor, now: number): MonitorHistoryPoint[] {
  const interval = m.intervalSeconds;
  const points: MonitorHistoryPoint[] = [];
  const segs = segments(m, now);
  for (let i = segs.length - 1; i >= 0 && points.length < RECENT_CHECKS; i--) {
    const s = segs[i]!;
    const first = checkIndex(interval, s.start);
    for (let k = checkIndex(interval, s.end) - 1; k >= first && points.length < RECENT_CHECKS; k--) {
      points.push({
        t: CLOCK_ANCHOR + k * interval,
        ping: s.state === 'up' ? pingAt(m, k) : null,
        up: s.state === 'up' ? 1 : 0,
        down: s.state === 'down' ? 1 : 0,
        maintenance: s.state === 'maintenance' ? 1 : 0,
      });
    }
  }
  return points.reverse();
}

interface ChartEntry {
  timestamp: number;
  up: number;
  down: number;
  maintenance: number;
  avgPing: number | null;
}

/** What getMonitorChartData answers: one entry per minute or hour that had checks. */
function chartEntries(m: DemoMonitor, range: ChartRange, now: number): ChartEntry[] {
  const { entry, entries } = CHART[range];
  const segs = segments(m, now);
  const lastStart = Math.floor(now / entry) * entry;
  const out: ChartEntry[] = [];
  for (let i = entries - 1; i >= 0; i--) {
    const from = lastStart - i * entry;
    const to = Math.min(from + entry, now + 1);
    const counts = { up: 0, down: 0, maintenance: 0 };
    for (const s of segs) {
      if (s.end <= from || s.start >= to) continue;
      counts[s.state] += checksIn(m.intervalSeconds, Math.max(from, s.start), Math.min(to, s.end));
    }
    if (counts.up + counts.down + counts.maintenance === 0) continue;
    out.push({ timestamp: from, ...counts, avgPing: counts.up > 0 ? pingAt(m, from) : null });
  }
  return out;
}

/** The console's bucketing of chart entries (the Uptime Kuma adapter's chartPoints). */
function chartPoints(entries: ChartEntry[], range: ChartRange): MonitorHistoryPoint[] {
  const { size, max } = CHART[range];
  const buckets = new Map<
    number,
    { up: number; down: number; maintenance: number; pingSum: number; pingWeight: number }
  >();
  for (const e of entries) {
    const t = Math.floor(e.timestamp / size) * size;
    let b = buckets.get(t);
    if (!b) {
      b = { up: 0, down: 0, maintenance: 0, pingSum: 0, pingWeight: 0 };
      buckets.set(t, b);
    }
    b.up += e.up;
    b.down += e.down;
    b.maintenance += e.maintenance;
    if (e.up > 0 && e.avgPing !== null) {
      b.pingSum += e.avgPing * e.up;
      b.pingWeight += e.up;
    }
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .slice(-max)
    .map(([t, b]) => ({
      t,
      ping: b.pingWeight > 0 ? Math.round(b.pingSum / b.pingWeight) : null,
      up: b.up,
      down: b.down,
      maintenance: b.maintenance,
    }));
}

/**
 * The monitoring methods of ProviderAdapter (same names and arguments, async like the contract);
 * DemoAdapter delegates to them. `serverIps` gives the addresses of a demo server by external id.
 */
export class DemoMonitoring {
  constructor(
    private readonly state: DemoMonitoringState,
    private readonly serverIps: (externalId: string) => string[],
  ) {
    this.bindServerTargets();
  }

  /** Monitor 4 pings a demo server: its first IPv4 address once this adapter knows the servers. */
  private bindServerTargets(): void {
    for (const m of this.state.monitors.values()) {
      if (!m.hostOfServer) continue;
      const ipv4 = this.serverIps(m.hostOfServer).find((address) => address.includes('.'));
      if (ipv4) {
        m.hostname = ipv4;
        m.hostOfServer = null;
      }
    }
  }

  /** Kuma ids are integers: anything else is refused before it is sent. */
  private id(externalId: string): string {
    if (typeof externalId !== 'string' || !ID_PATTERN.test(externalId)) {
      throw badRequest(`Invalid Uptime Kuma monitor id "${String(externalId).slice(0, 40)}"`);
    }
    return String(Number(externalId));
  }

  private find(id: string): DemoMonitor {
    const m = this.state.monitors.get(id);
    if (!m) throw new ProviderError(PROVIDER, `monitor ${id} not found in Uptime Kuma`, 404);
    return m;
  }

  private record(event: string, externalId: string | null): void {
    this.state.payloads.push({ event, externalId });
  }

  private view(m: DemoMonitor, now: number): RemoteMonitor {
    const status = statusOf(m, now);
    return {
      externalId: m.externalId,
      name: m.name,
      type: m.type,
      ...targetOf(m),
      status,
      active: status !== 'paused',
      intervalSeconds: m.intervalSeconds,
      parentId: m.parentId,
      facts: factsOf(m, status),
    };
  }

  /** The first check of a monitor that had none: it starts its history and reports up. */
  private firstCheck(m: DemoMonitor, now: number): void {
    m.pending = false;
    if (m.startedAt === null) {
      m.startedAt = now;
      m.facts = firstFacts(m);
    }
  }

  private forget(id: string): void {
    this.state.monitors.delete(id);
    for (const page of this.state.statusPages.values()) {
      page.monitorIds = page.monitorIds.filter((monitorId) => monitorId !== id);
    }
  }

  /** Every simulated monitor, paused ones too (management is always on). */
  async listMonitors(): Promise<MonitorInventory> {
    const now = nowSeconds();
    // New monitors had their first check by now: "pending" turns "up".
    for (const m of this.state.monitors.values()) {
      if (m.pending && !isPaused(m)) this.firstCheck(m, now);
    }
    const monitors = [...this.state.monitors.values()]
      .sort((a, b) => Number(a.externalId) - Number(b.externalId))
      .map((m) => this.view(m, now));
    return { monitors, complete: true, managementError: null };
  }

  /** Live facts, configuration and the recent status changes. */
  async getMonitor(externalId: string): Promise<MonitorLive> {
    const m = this.find(this.id(externalId));
    const now = nowSeconds();
    return { monitor: this.view(m, now), config: configOf(m), events: eventsOf(m, now) };
  }

  /**
   * "recent": the last 100 checks of a monitor on the given status page (null when the slug is
   * unknown or the monitor is not on it). 24h, 7d, 30d: Kuma's chart data in the console's
   * buckets, up to the pause for paused monitors.
   */
  async getMonitorHistory(
    externalId: string,
    range: MonitorHistoryRange,
    options: { statusPageSlug: string | null },
  ): Promise<MonitorHistoryDto | null> {
    const m = this.find(this.id(externalId));
    const now = nowSeconds();
    if (range === 'recent') {
      if (!options.statusPageSlug) return null;
      const page = this.state.statusPages.get(statusPageSlug(options.statusPageSlug));
      if (!page?.monitorIds.includes(m.externalId)) return null;
      return { range, source: 'statusPage', resolutionSeconds: null, points: recentChecks(m, now) };
    }
    if (!Object.hasOwn(CHART, range)) return null;
    const chart = range as ChartRange;
    return {
      range: chart,
      source: 'kuma',
      resolutionSeconds: CHART[chart].size,
      points: chartPoints(chartEntries(m, chart, now), chart),
    };
  }

  /** Ranges getMonitorHistory can serve: "recent" only with a status page, the rest always. */
  monitorHistoryRanges(options: { statusPageSlug: string | null }): MonitorHistoryRange[] {
    return [...(options.statusPageSlug ? (['recent'] as const) : []), '24h', '7d', '30d'];
  }

  monitorManagement(): boolean {
    return true;
  }

  async monitoringStatus(): Promise<MonitoringStatus> {
    return { version: DEMO_KUMA_VERSION, management: 'ok', managementError: null, uptimeMetrics: true };
  }

  /** Returns the new monitor, "pending" until the next listMonitors (its first check). */
  async createMonitor(input: MonitorInput): Promise<RemoteMonitor> {
    if (!(MONITOR_KINDS as readonly string[]).includes(input.kind)) {
      throw badRequest(`Monitors of type "${String(input.kind)}" cannot be created here`);
    }
    assertName(input.name);
    assertInterval(input.intervalSeconds);
    assertStatusCodes(input.acceptedStatusCodes);
    assertMethod(input.method);
    assertTarget(monitorTargetIssues(input));

    const kind = input.kind;
    const number = this.state.nextId++;
    const id = String(number);
    const web = kind === 'http' || kind === 'keyword';
    const m: DemoMonitor = {
      externalId: id,
      name: input.name,
      type: kind,
      url: web ? trimmed(input.url) : null,
      hostname: web ? null : trimmed(input.hostname),
      port: kind === 'port' ? input.port : null,
      keyword: kind === 'keyword' ? input.keyword : null,
      invertKeyword: kind === 'keyword' && input.invertKeyword === true,
      method: input.method,
      acceptedStatusCodes: [...input.acceptedStatusCodes],
      intervalSeconds: input.intervalSeconds,
      ignoreTls: input.ignoreTls === true,
      parentId: null,
      hostOfServer: null,
      facts: { ...EMPTY_MONITOR_FACTS },
      basePingMs: createdPing(kind, number),
      startedAt: null,
      pending: true,
      outages: [],
      pauses: [],
    };
    this.state.monitors.set(id, m);
    this.record('add', id);
    return this.view(m, nowSeconds());
  }

  /** Fields left out keep their value; fields that do not belong to the kind are ignored. */
  async updateMonitor(externalId: string, patch: MonitorPatch): Promise<void> {
    const m = this.find(this.id(externalId));
    if (patch.name !== undefined) assertName(patch.name);
    if (patch.intervalSeconds !== undefined) assertInterval(patch.intervalSeconds);
    if (patch.acceptedStatusCodes !== undefined) assertStatusCodes(patch.acceptedStatusCodes);
    if (patch.method !== undefined) assertMethod(patch.method);
    const kind = m.type;
    const web = kind === 'http' || kind === 'keyword';
    const next = {
      url: web && patch.url !== undefined ? trimmed(patch.url) : m.url,
      hostname:
        (kind === 'ping' || kind === 'port') && patch.hostname !== undefined
          ? trimmed(patch.hostname)
          : m.hostname,
      port: kind === 'port' && patch.port !== undefined ? patch.port : m.port,
      keyword: kind === 'keyword' && patch.keyword !== undefined ? patch.keyword : m.keyword,
      invertKeyword:
        kind === 'keyword' && patch.invertKeyword !== undefined
          ? patch.invertKeyword === true
          : m.invertKeyword,
    };
    const targetChanged = (['url', 'hostname', 'port', 'keyword'] as const).some(
      (k) => patch[k] !== undefined,
    );
    if (targetChanged && isMonitorKind(kind)) assertTarget(monitorTargetIssues({ kind, ...next }));

    this.record('editMonitor', m.externalId);
    if (next.hostname !== m.hostname) m.hostOfServer = null;
    Object.assign(m, next);
    if (patch.name !== undefined) m.name = patch.name;
    if (patch.method !== undefined) m.method = patch.method;
    if (patch.acceptedStatusCodes !== undefined) m.acceptedStatusCodes = [...patch.acceptedStatusCodes];
    if (patch.intervalSeconds !== undefined) m.intervalSeconds = patch.intervalSeconds;
    if (patch.ignoreTls !== undefined) m.ignoreTls = patch.ignoreTls === true;
  }

  async pauseMonitor(externalId: string): Promise<void> {
    const id = this.id(externalId);
    this.record('pauseMonitor', id);
    const m = this.find(id);
    if (!isPaused(m)) m.pauses.push({ start: nowSeconds(), end: null });
  }

  /** Checks start again; the status is what the next check reports. */
  async resumeMonitor(externalId: string): Promise<void> {
    const id = this.id(externalId);
    this.record('resumeMonitor', id);
    const m = this.find(id);
    const now = nowSeconds();
    for (const p of m.pauses) if (p.end === null) p.end = now;
  }

  /** Deletes the monitor and its history. Unknown ids succeed silently, like Kuma. */
  async deleteMonitor(externalId: string): Promise<void> {
    const id = this.id(externalId);
    this.record('deleteMonitor', id);
    this.forget(id);
  }

  /** A public status page; 404 like Kuma's "Status Page Not Found". */
  async getStatusPage(slug: string): Promise<{ slug: string; title: string; monitorIds: string[] }> {
    const clean = statusPageSlug(slug);
    const page = this.state.statusPages.get(clean);
    if (!page) throw new ProviderError(PROVIDER, 'Status Page Not Found', 404);
    return {
      slug: clean,
      title: page.title,
      monitorIds: page.monitorIds.filter((id) => this.state.monitors.has(id)),
    };
  }

  statusPageUrl(slug: string): string {
    return `${DEMO_KUMA_URL}/status/${encodeURIComponent(slug)}`;
  }

  /** Test helper: a status as Kuma would report it after the next check. */
  setStatus(externalId: string, status: 'up' | 'down' | 'pending' | 'maintenance'): void {
    const m = this.find(this.id(externalId));
    if (status === 'pending') {
      m.pending = true;
      return;
    }
    const now = nowSeconds();
    this.firstCheck(m, now);
    for (const o of m.outages) if (o.end === null && o.kind !== status) o.end = now;
    if (status !== 'up' && !m.outages.some((o) => o.end === null && o.kind === status)) {
      m.outages.push({
        kind: status,
        start: now,
        end: null,
        message: status === 'down' ? downMessage(m) : 'Monitor under maintenance',
      });
    }
  }

  /** Test helper: simulates a deletion in Uptime Kuma (the sync then marks the row missing). */
  removeMonitor(externalId: string): void {
    this.forget(this.find(this.id(externalId)).externalId);
  }

  /** Test helper: the socket events sent so far, oldest first. */
  payloads(): { event: string; externalId: string | null }[] {
    return this.state.payloads.map((p) => ({ ...p }));
  }
}
