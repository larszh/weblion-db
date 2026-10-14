import {
  EMPTY_MONITOR_FACTS,
  MONITOR_KINDS,
  MONITOR_MAX_INTERVAL_SECONDS,
  MONITOR_MIN_INTERVAL_SECONDS,
  MONITOR_STATUS_CODE_PATTERN,
  MONITOR_STATUS_PAGE_SLUG_PATTERN,
  isMonitorKind,
  monitorTargetIssues,
  type Capability,
  type MonitorHistoryDto,
  type MonitorHistoryRange,
  type MonitorInputIssue,
  type PowerAction,
} from '@weblion/shared';
import { ProviderError, badRequest, unsupported } from '../../lib/errors';
import { isRecord, str } from '../http';
import type {
  InfraOverview,
  MonitorInput,
  MonitorInventory,
  MonitorLive,
  MonitorPatch,
  MonitoringStatus,
  ProviderAdapter,
  RawResponse,
  RemoteMonitor,
  RemoteServer,
  ServerRef,
  UptimeKumaConfig,
} from '../types';
import { KumaHttpClient, PROVIDER, type KumaHttpOptions } from './client';
import {
  KUMA_ID_PATTERN,
  applyPatch,
  buildAddPayload,
  chartPoints,
  isKumaMonitorJson,
  kumaTarget,
  parseKumaMetrics,
  redactMonitorSecrets,
  remoteFromJson,
  remoteFromMetrics,
  restoreMaskedParams,
  statusPagePoints,
  toMonitorConfig,
  toMonitorEvents,
  type KumaMetrics,
  type KumaMonitorJson,
} from './parse';
import { KumaSocket, isKumaEvent, kumaSignIn, type KumaEvent, type KumaSocketOptions } from './socket';

export interface UptimeKumaAdapterOptions extends KumaHttpOptions, KumaSocketOptions {}

/** Kuma allows 60 API requests per minute for the whole instance: at most 2 of them per process. */
const METRICS_TTL_MS = 30_000;
const STATUS_TTL_MS = 60_000;
const HEARTBEAT_TTL_MS = 60_000;
const STATUS_PAGE_TTL_MS = 300_000;
const CHART_TTL_MS = 60_000;
/** Monitor list for reads (detail pages, status). */
const LIST_TTL_MS = 60_000;
/** The sync opens a management session at most this often while none is open. */
const COMPLETE_EVERY_MS = 10 * 60_000;

const CHART_HOURS = { '24h': 24, '7d': 168, '30d': 720 } as const;
/** Kuma's name column (UNVERIFIED: VARCHAR(150)); the route sends at most MONITOR_NAME_MAX plus "[<org slug>] ". */
const KUMA_NAME_MAX = 150;

const NOT_SIGNED_IN = 'This Uptime Kuma instance is not signed in for management';
const UNSUPPORTED_1X =
  'this instance reports monitors without monitor_id: Uptime Kuma 1.x is not supported, update to 2.0 or newer';
const EXPLORER_PATHS =
  'Allowed: /metrics, /api/status-page/<slug>, /api/status-page/heartbeat/<slug>, ' +
  '/api/badge/<id>/<kind>, /api/entry-page, socket/<event>';

/** Socket events the explorer may read (GET) and write (POST, audited by the admin route). */
const EXPLORER_READS = new Set<KumaEvent>([
  'getMonitorList',
  'getMonitor',
  'getMonitorChartData',
  'monitorImportantHeartbeatListPaged',
]);
const EXPLORER_WRITES = new Set<KumaEvent>([
  'add',
  'editMonitor',
  'pauseMonitor',
  'resumeMonitor',
  'deleteMonitor',
]);

/** Values per key, each shared until its TTL is over. Failed loads are not kept. */
class ReadCache {
  private readonly entries = new Map<string, { at: number; value: Promise<unknown> }>();

  constructor(private readonly now: () => number) {}

  get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const now = this.now();
    const hit = this.entries.get(key);
    if (hit && now - hit.at < ttlMs) return hit.value as Promise<T>;
    if (this.entries.size >= 500) this.prune(now);
    const value = load();
    const entry = { at: now, value };
    this.entries.set(key, entry);
    value.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return value;
  }

  /** Forgets a key and every key below it ("chart:12" also drops "chart:12:24h"). */
  forget(key: string) {
    for (const k of this.entries.keys()) if (k === key || k.startsWith(`${key}:`)) this.entries.delete(k);
  }

  clear() {
    this.entries.clear();
  }

  /** Drops what no TTL would serve anymore (the longest is STATUS_PAGE_TTL_MS). */
  private prune(now: number) {
    for (const [key, entry] of this.entries) {
      if (now - entry.at >= STATUS_PAGE_TTL_MS) this.entries.delete(key);
    }
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isNotFound(err: unknown): boolean {
  return err instanceof ProviderError && err.upstreamStatus === 404;
}

/** Kuma ids are integers: anything else is refused before a request goes out. */
function kumaId(externalId: string): number {
  if (!KUMA_ID_PATTERN.test(externalId)) {
    throw badRequest(`Invalid Uptime Kuma monitor id "${externalId.slice(0, 40)}"`);
  }
  return Number(externalId);
}

/** Kuma lower-cases slugs itself; the console only sends ones it can address. */
function statusPageSlug(slug: string): string {
  const clean = slug.trim().toLowerCase();
  if (!MONITOR_STATUS_PAGE_SLUG_PATTERN.test(clean)) {
    throw badRequest(`Invalid status page slug "${slug.slice(0, 70)}"`);
  }
  return clean;
}

/** "2.5.6" is at least 2.1. */
function versionAtLeast(version: string | null, major: number, minor: number): boolean {
  const m = /^v?(\d+)\.(\d+)/.exec(version ?? '');
  if (!m) return false;
  const [maj, min] = [Number(m[1]), Number(m[2])];
  return maj > major || (maj === major && min >= minor);
}

function assertInterval(seconds: number) {
  if (
    !Number.isInteger(seconds) ||
    seconds < MONITOR_MIN_INTERVAL_SECONDS ||
    seconds > MONITOR_MAX_INTERVAL_SECONDS
  ) {
    throw badRequest('Validation failed', [
      {
        path: 'intervalSeconds',
        message: `The interval must be ${MONITOR_MIN_INTERVAL_SECONDS} to ${MONITOR_MAX_INTERVAL_SECONDS} seconds`,
      },
    ]);
  }
}

function assertName(name: string) {
  if (!name.trim() || name.length > KUMA_NAME_MAX || /[\u0000-\u001f\u007f]/.test(name)) {
    throw badRequest('Validation failed', [{ path: 'name', message: 'Invalid monitor name' }]);
  }
}

function assertStatusCodes(codes: string[]) {
  if (codes.length < 1 || codes.length > 10 || !codes.every((c) => MONITOR_STATUS_CODE_PATTERN.test(c))) {
    throw badRequest('Validation failed', [
      { path: 'acceptedStatusCodes', message: 'Status codes like "200" or "200-299", 1 to 10 of them' },
    ]);
  }
}

function assertTarget(issues: MonitorInputIssue[]) {
  if (issues.length > 0) throw badRequest('Validation failed', issues);
}

/**
 * An Uptime Kuma 2.x instance. Reading goes through the documented surface: /metrics with an
 * API key (status, response times, certificates, uptime from 2.1) and the public status page
 * JSON (the last 100 checks). Managing monitors, the long charts, configuration, events and the
 * paused state go through the Socket.IO events of Kuma's web UI, and only when staff signed the
 * instance in for management (a session token in the config). When the socket fails, reading
 * keeps working and writes are refused. No servers.
 */
export class UptimeKumaAdapter implements ProviderAdapter {
  readonly type = 'uptimekuma' as const;
  readonly http: KumaHttpClient;
  /** Only with a session token. */
  readonly socket: KumaSocket | null;
  private readonly reads: ReadCache;
  private readonly now: () => number;
  /** When listMonitors last opened a management session (or tried to). */
  private lastAttemptAt = Number.NEGATIVE_INFINITY;
  private lastManagementError: string | null = null;
  /** A management failure seen by a read, so monitoringStatus reports it without asking again at once. */
  private managementFailure: { at: number; message: string } | null = null;

  constructor(
    private readonly config: UptimeKumaConfig,
    private readonly options: UptimeKumaAdapterOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.http = new KumaHttpClient(config, options);
    this.socket = config.sessionToken
      ? new KumaSocket(this.http.baseUrl, config.sessionToken, options)
      : null;
    this.reads = new ReadCache(this.now);
  }

  capabilities(): Capability[] {
    return [];
  }

  powerActions(): PowerAction[] {
    return [];
  }

  async listServers(): Promise<RemoteServer[]> {
    return [];
  }

  async getServer(ref: ServerRef): Promise<RemoteServer> {
    throw new ProviderError(PROVIDER, `Uptime Kuma has no servers (${ref.externalId})`, 404);
  }

  /** Closes the management session now instead of after the idle time. */
  close(): void {
    this.socket?.close();
  }

  // ---------------------------------------------------------------------------
  // Connection

  /** /metrics answers with monitors of Kuma 2.x; the management session, if any, is checked too. */
  async testConnection(): Promise<Record<string, unknown>> {
    const metrics = parseKumaMetrics(await this.http.metrics());
    this.assertSupported(metrics);
    let management = 'off';
    if (this.socket) {
      try {
        await this.socket.listMonitors(0);
        management = 'ok';
      } catch (err) {
        management = message(err);
      }
    }
    return {
      version: this.socket?.version ?? metrics.version,
      monitors: metrics.monitors.size,
      uptimeMetrics: this.uptimeFigures(metrics),
      management,
    };
  }

  async overview(): Promise<InfraOverview> {
    const [metrics, status] = await Promise.all([this.metricsCached(), this.monitoringStatus()]);
    const monitors = [...metrics.monitors.values()];
    const management =
      status.management === 'ok'
        ? 'on'
        : status.management === 'off'
          ? 'off'
          : `error: ${status.managementError ?? 'unknown'}`;
    return {
      version: status.version,
      nodes: [],
      storages: [],
      facts: [
        { label: 'Version', value: status.version ?? '–' },
        { label: 'Monitors', value: String(monitors.length) },
        { label: 'Up', value: String(monitors.filter((m) => m.status === 1).length) },
        { label: 'Down', value: String(monitors.filter((m) => m.status === 0).length) },
        { label: 'Uptime figures', value: status.uptimeMetrics ? 'available' : 'needs Uptime Kuma 2.1' },
        { label: 'Management', value: management },
        { label: 'Address', value: this.http.baseUrl },
      ],
    };
  }

  /** Version, management state (checks the session, cached for 60 s). */
  async monitoringStatus(): Promise<MonitoringStatus> {
    return this.reads.get('status', STATUS_TTL_MS, async () => {
      // The instance list must show the management state even while /metrics fails.
      const metrics = await this.metricsCached().catch(() => null);
      let management: MonitoringStatus['management'] = 'off';
      let managementError: string | null = null;
      if (this.socket) {
        const failure = this.managementFailure;
        if (failure && this.managementDown()) {
          // A read just failed: report that instead of trying again right away.
          management = 'error';
          managementError = failure.message;
        } else {
          try {
            await this.socket.listMonitors(LIST_TTL_MS);
            management = 'ok';
          } catch (err) {
            management = 'error';
            managementError = message(err);
          }
          this.lastManagementError = managementError;
          this.managementFailure = managementError ? { at: this.now(), message: managementError } : null;
        }
      }
      return {
        version: this.socket?.version ?? metrics?.version ?? null,
        management,
        managementError,
        uptimeMetrics: metrics ? this.uptimeFigures(metrics) : false,
      };
    });
  }

  /** Whether write operations are configured (a session token is stored). No network. */
  monitorManagement(): boolean {
    return this.socket !== null;
  }

  /** Exchanges a Kuma login for a session token. The password is never stored or logged. */
  async signInForManagement(credentials: {
    username: string;
    password: string;
    totp?: string;
  }): Promise<{ sessionToken: string; version: string | null }> {
    const { token, version } = await kumaSignIn(this.http.baseUrl, credentials, this.options);
    return { sessionToken: token, version };
  }

  // ---------------------------------------------------------------------------
  // Monitors

  /**
   * Every monitor /metrics reports. With management, every monitor of the instance (paused ones
   * too): from the open session's pushed list, or from a new session at most every 10 minutes.
   * The sync does not keep a session alive, so Kuma stops pushing beats once it idles out.
   */
  async listMonitors(): Promise<MonitorInventory> {
    const metrics = await this.metricsCached();
    this.assertSupported(metrics);
    let byId: Map<string, KumaMonitorJson> | null = null;
    let managementError: string | null = null;
    const socket = this.socket;
    if (socket) {
      const now = this.now();
      byId = socket.liveList();
      if (byId) {
        this.managementResult(null);
      } else if (now - this.lastAttemptAt >= COMPLETE_EVERY_MS) {
        this.lastAttemptAt = now;
        try {
          byId = await socket.listMonitors(LIST_TTL_MS);
          this.managementResult(null);
        } catch (err) {
          managementError = message(err);
          this.managementResult(managementError);
        }
      } else {
        // No session open and the last attempt is recent: /metrics only, a failure stays known.
        managementError = this.lastManagementError;
      }
    }

    const monitors: RemoteMonitor[] = [];
    if (byId && socket) {
      for (const [id, json] of byId) {
        monitors.push(remoteFromJson(json, metrics.monitors.get(id), socket.stats.get(id)));
      }
      // Created between the two reads: /metrics knows it, the list not yet.
      for (const [id, m] of metrics.monitors) if (!byId.has(id)) monitors.push(remoteFromMetrics(m));
    } else {
      for (const m of metrics.monitors.values()) monitors.push(remoteFromMetrics(m));
    }
    return { monitors, complete: byId !== null, managementError };
  }

  /**
   * Live facts, plus configuration and recent events when signed in for management. While
   * management failed recently, the facts come from /metrics without another attempt.
   */
  async getMonitor(externalId: string): Promise<MonitorLive> {
    const id = kumaId(externalId);
    const metrics = await this.metricsCached();
    const reported = metrics.monitors.get(externalId);
    const socket = this.socket;
    if (socket && !this.managementDown()) {
      try {
        const { monitor: json } = await socket.call('getMonitor', id);
        if (!isKumaMonitorJson(json)) {
          throw new ProviderError(PROVIDER, `getMonitor ${externalId}: no monitor in the answer`);
        }
        const { data } = await socket.call('monitorImportantHeartbeatListPaged', id, 0, 20);
        this.managementResult(null);
        return {
          monitor: remoteFromJson(json, reported, socket.stats.get(externalId)),
          config: toMonitorConfig(json),
          events: toMonitorEvents(data, 20),
        };
      } catch (err) {
        if (isNotFound(err)) throw err;
        // Management failed: the facts from /metrics still answer, monitoringStatus reports the error.
        this.managementResult(message(err));
      }
    }
    if (!reported) {
      throw new ProviderError(
        PROVIDER,
        `monitor ${externalId} is not reported by /metrics (paused, deleted, or not checked since Uptime Kuma started)`,
        404,
      );
    }
    return { monitor: remoteFromMetrics(reported), config: null, events: null };
  }

  /** null when no history is available for this monitor and range. */
  async getMonitorHistory(
    externalId: string,
    range: MonitorHistoryRange,
    options: { statusPageSlug: string | null },
  ): Promise<MonitorHistoryDto | null> {
    const id = kumaId(externalId);
    if (range === 'recent') {
      if (!options.statusPageSlug) return null;
      const slug = statusPageSlug(options.statusPageSlug);
      let body: unknown;
      try {
        body = await this.reads.get(`heartbeat:${slug}`, HEARTBEAT_TTL_MS, async () => {
          const res = await this.http.publicGet(`/api/status-page/heartbeat/${encodeURIComponent(slug)}`);
          return res.body;
        });
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
      const points = statusPagePoints(body, externalId);
      return points ? { range, source: 'statusPage', resolutionSeconds: null, points } : null;
    }
    const socket = this.socket;
    // The long charts need management; while it failed recently they are off (see monitorHistoryRanges).
    if (!socket || !(range in CHART_HOURS) || this.managementDown()) return null;
    let data: unknown;
    try {
      data = await this.reads.get(`chart:${externalId}:${range}`, CHART_TTL_MS, async () => {
        const ack = await socket.call('getMonitorChartData', id, CHART_HOURS[range]);
        return ack.data;
      });
    } catch (err) {
      if (!isNotFound(err)) this.managementResult(message(err));
      throw err;
    }
    const { points, resolutionSeconds } = chartPoints(data, range);
    return { range, source: 'kuma', resolutionSeconds, points };
  }

  /** Ranges getMonitorHistory can serve, without network: the long charts only while management works. */
  monitorHistoryRanges(options: { statusPageSlug: string | null }): MonitorHistoryRange[] {
    return [
      ...(options.statusPageSlug ? (['recent'] as const) : []),
      ...(this.socket && !this.managementDown() ? (['24h', '7d', '30d'] as const) : []),
    ];
  }

  /** Returns the new monitor (status "pending" until its first check). */
  async createMonitor(input: MonitorInput): Promise<RemoteMonitor> {
    const socket = this.requireSocket();
    if (!(MONITOR_KINDS as readonly string[]).includes(input.kind)) {
      throw badRequest(`Monitors of type "${String(input.kind)}" cannot be created here`);
    }
    assertName(input.name);
    assertInterval(input.intervalSeconds);
    assertStatusCodes(input.acceptedStatusCodes);
    assertTarget(monitorTargetIssues(input));

    // The keys the instance's monitors carry tell which optional fields it knows.
    const list = socket.monitorList?.byId ?? (await socket.listMonitors(COMPLETE_EVERY_MS));
    const knownKeys = new Set<string>();
    for (const json of list.values()) for (const key of Object.keys(json)) knownKeys.add(key);
    const payload = buildAddPayload(input, { notificationIds: socket.defaultNotificationIds, knownKeys });
    const ack = await socket.call('add', payload);
    this.managementResult(null);
    this.reads.forget('metrics');
    const newId = typeof ack.monitorID === 'number' ? String(ack.monitorID) : str(ack.monitorID);
    if (!newId || !KUMA_ID_PATTERN.test(newId)) {
      throw new ProviderError(PROVIDER, 'Uptime Kuma added the monitor but sent no monitor id');
    }

    try {
      const { monitor } = await this.getMonitor(newId);
      // No beat yet: Kuma starts the check right away, the first result follows.
      return monitor.status === 'unknown' ? { ...monitor, status: 'pending' } : monitor;
    } catch {
      // The monitor exists in Kuma now; failing here would leave it unmanaged.
      return {
        externalId: newId,
        name: input.name,
        type: input.kind,
        ...kumaTarget(input.kind, input.url, input.hostname, input.port),
        status: 'pending',
        active: true,
        intervalSeconds: input.intervalSeconds,
        parentId: null,
        facts: { ...EMPTY_MONITOR_FACTS },
      };
    }
  }

  /** Read-modify-write: Kuma's editMonitor sets every field and nulls what is not sent. */
  async updateMonitor(externalId: string, patch: MonitorPatch): Promise<void> {
    const socket = this.requireSocket();
    const id = kumaId(externalId);
    if (patch.name !== undefined) assertName(patch.name);
    if (patch.intervalSeconds !== undefined) assertInterval(patch.intervalSeconds);
    if (patch.acceptedStatusCodes !== undefined) assertStatusCodes(patch.acceptedStatusCodes);
    const { monitor } = await socket.call('getMonitor', id);
    if (!isKumaMonitorJson(monitor)) {
      throw new ProviderError(PROVIDER, `getMonitor ${externalId}: no monitor in the answer`);
    }
    // The console shows secret-looking query values as "***": an edited URL keeps the real ones.
    const current = str(monitor.url);
    const next = applyPatch(
      monitor,
      typeof patch.url === 'string' && current
        ? { ...patch, url: restoreMaskedParams(patch.url, current) }
        : patch,
    );
    const targetChanged = ['url', 'hostname', 'port', 'keyword'].some(
      (key) => patch[key as keyof MonitorPatch] !== undefined,
    );
    if (targetChanged && isMonitorKind(monitor.type)) {
      assertTarget(
        monitorTargetIssues({
          kind: monitor.type,
          url: str(next.url),
          hostname: str(next.hostname),
          port: typeof next.port === 'number' ? next.port : null,
          keyword: typeof next.keyword === 'string' ? next.keyword : null,
        }),
      );
    }
    await socket.call('editMonitor', next);
    this.forgetMonitor(externalId);
  }

  async pauseMonitor(externalId: string): Promise<void> {
    const socket = this.requireSocket();
    await socket.call('pauseMonitor', kumaId(externalId));
    this.forgetMonitor(externalId);
  }

  async resumeMonitor(externalId: string): Promise<void> {
    const socket = this.requireSocket();
    await socket.call('resumeMonitor', kumaId(externalId));
    this.forgetMonitor(externalId);
  }

  /** Deletes the monitor and its history in Kuma. Kuma succeeds silently for unknown ids. */
  async deleteMonitor(externalId: string): Promise<void> {
    const socket = this.requireSocket();
    // Two-argument form (id, callback): valid on 2.0 and on 2.5, which added deleteChildren.
    await socket.call('deleteMonitor', kumaId(externalId));
    this.forgetMonitor(externalId);
  }

  // ---------------------------------------------------------------------------
  // Status pages

  /** A public status page; 404 if the slug does not exist. */
  async getStatusPage(slug: string): Promise<{ slug: string; title: string; monitorIds: string[] }> {
    const clean = statusPageSlug(slug);
    const body = await this.reads.get(`page:${clean}`, STATUS_PAGE_TTL_MS, async () => {
      const res = await this.http.publicGet(`/api/status-page/${encodeURIComponent(clean)}`);
      return res.body;
    });
    if (!isRecord(body) || !isRecord(body.config)) {
      throw new ProviderError(PROVIDER, `status page "${clean}": no status page in the answer`);
    }
    const monitorIds = new Set<string>();
    for (const group of Array.isArray(body.publicGroupList) ? body.publicGroupList : []) {
      if (!isRecord(group) || !Array.isArray(group.monitorList)) continue;
      for (const monitor of group.monitorList) {
        if (isRecord(monitor) && (typeof monitor.id === 'number' || typeof monitor.id === 'string')) {
          const id = String(monitor.id);
          if (KUMA_ID_PATTERN.test(id)) monitorIds.add(id);
        }
      }
    }
    return {
      slug: str(body.config.slug) ?? clean,
      title: str(body.config.title) ?? clean,
      monitorIds: [...monitorIds],
    };
  }

  statusPageUrl(slug: string): string {
    return `${this.http.baseUrl}/status/${encodeURIComponent(slug)}`;
  }

  // ---------------------------------------------------------------------------
  // API explorer

  /**
   * GET of the documented HTTP paths (/metrics with the API key, status pages, badges, entry
   * page), and the whitelisted socket events as "socket/<event>": reads with GET and
   * ?args=[...], writes with POST and { "args": [...] }. Answers are redacted.
   */
  async rawRequest(method: string, path: string, body?: Record<string, unknown>): Promise<RawResponse> {
    const upper = method.toUpperCase();
    let clean = path.trim();
    if (clean.startsWith(this.http.baseUrl)) clean = clean.slice(this.http.baseUrl.length);
    if (/^\/?socket\//.test(clean)) return this.rawSocket(upper, clean.replace(/^\/?socket\//, ''), body);

    if (!clean.startsWith('/')) clean = `/${clean}`;
    // The key goes to the instance only: no dot segments (also encoded), no host switch.
    if (/\/\/|\.\.|\\|%2e|%2f|%5c|#/i.test(clean)) throw badRequest('Invalid path');
    const q = clean.indexOf('?');
    const pathname = q >= 0 ? clean.slice(0, q) : clean;
    const allowed =
      pathname === '/metrics' ||
      pathname === '/api/entry-page' ||
      /^\/api\/status-page\/(heartbeat\/)?[a-z0-9-]{1,64}$/i.test(pathname) ||
      /^\/api\/badge\/\d{1,10}\/(status|uptime|ping|avg-response|cert-exp|response)(\/[a-z0-9]{1,10})?$/i.test(
        pathname,
      );
    if (!allowed) throw badRequest(EXPLORER_PATHS);
    if (upper !== 'GET') throw badRequest('Uptime Kuma paths take GET; socket writes go to socket/<event>');
    if (pathname === '/metrics' && q >= 0) throw badRequest('/metrics takes no query');

    const res = await this.http.raw('GET', clean);
    if (pathname === '/metrics') return { status: res.status, data: this.http.scrub(res.text) };
    return { status: res.status, data: this.http.scrubValue(redactMonitorSecrets(res.body)) };
  }

  /** Explorer request as it is audited: socket write arguments carry monitor objects with secrets. */
  redactExplorerAudit(
    path: string,
    body: Record<string, unknown> | undefined,
  ): { path: string; body: unknown } {
    return { path, body: redactMonitorSecrets(body) };
  }

  private async rawSocket(
    method: string,
    rest: string,
    body?: Record<string, unknown>,
  ): Promise<RawResponse> {
    const socket = this.socket;
    if (!socket) throw badRequest('not signed in for management');
    const q = rest.indexOf('?');
    const event = q >= 0 ? rest.slice(0, q) : rest;
    const allowedEvents = [...EXPLORER_READS, ...EXPLORER_WRITES].join(', ');
    if (!isKumaEvent(event)) {
      throw badRequest(`The socket event "${event.slice(0, 60)}" is not allowed. Allowed: ${allowedEvents}`);
    }

    let args: unknown[];
    if (EXPLORER_READS.has(event)) {
      if (method !== 'GET') throw badRequest(`socket/${event} is a read: use GET with ?args=[...]`);
      args = this.queryArgs(q >= 0 ? rest.slice(q + 1) : '');
      if (event === 'getMonitorList') {
        if (args.length > 0) throw badRequest('getMonitorList takes no arguments');
        const list = await socket.listMonitors(0);
        return { status: 200, data: this.http.scrubValue(redactMonitorSecrets(Object.fromEntries(list))) };
      }
    } else {
      if (method !== 'POST') throw badRequest(`socket/${event} is a write: use POST with { "args": [...] }`);
      if (q >= 0) throw badRequest('Socket writes take their arguments in the body');
      args = this.bodyArgs(event, body);
    }
    const ack = await socket.callRaw(event, ...args);
    if (EXPLORER_WRITES.has(event)) this.reads.clear();
    return { status: ack.ok === true ? 200 : 400, data: this.http.scrubValue(redactMonitorSecrets(ack)) };
  }

  /** ?args=[12,24]: a JSON array of at most 3 numbers. */
  private queryArgs(query: string): unknown[] {
    const raw = new URLSearchParams(query).get('args');
    if (raw === null) return [];
    let args: unknown;
    try {
      args = JSON.parse(raw);
    } catch {
      throw badRequest('args must be a JSON array, e.g. ?args=[12,24]');
    }
    if (
      !Array.isArray(args) ||
      args.length > 3 ||
      !args.every((a) => typeof a === 'number' && Number.isFinite(a))
    ) {
      throw badRequest('args must be a JSON array of at most 3 numbers, e.g. ?args=[12,24]');
    }
    return args;
  }

  /** { "args": [...] }: a monitor object for add and editMonitor, a monitor id for the others. */
  private bodyArgs(event: KumaEvent, body?: Record<string, unknown>): unknown[] {
    const args = body?.args;
    if (!Array.isArray(args)) throw badRequest(`socket/${event} needs { "args": [...] } in the body`);
    if (event === 'add' || event === 'editMonitor') {
      if (args.length !== 1 || !isRecord(args[0])) {
        throw badRequest(`socket/${event} takes one monitor object: { "args": [{ ... }] }`);
      }
      return args;
    }
    if (args.length !== 1 || typeof args[0] !== 'number' || !Number.isInteger(args[0])) {
      throw badRequest(`socket/${event} takes one monitor id: { "args": [12] }`);
    }
    return args;
  }

  // ---------------------------------------------------------------------------
  // Helpers

  /** /metrics, parsed, shared by concurrent callers for 30 s. Failures are not kept. */
  private metricsCached(): Promise<KumaMetrics> {
    return this.reads.get('metrics', METRICS_TTL_MS, async () => parseKumaMetrics(await this.http.metrics()));
  }

  private assertSupported(metrics: KumaMetrics) {
    if (metrics.withoutId > 0 && metrics.monitors.size === 0)
      throw new ProviderError(PROVIDER, UNSUPPORTED_1X);
  }

  /** Uptime and averages in /metrics: seen in the answer, or Kuma 2.1+ without monitors yet. */
  private uptimeFigures(metrics: KumaMetrics): boolean {
    return metrics.uptimeMetrics || versionAtLeast(this.socket?.version ?? metrics.version, 2, 1);
  }

  private requireSocket(): KumaSocket {
    if (!this.socket) throw unsupported(NOT_SIGNED_IN);
    return this.socket;
  }

  /**
   * Management failed less than STATUS_TTL_MS ago: reads skip the socket instead of waiting for
   * another failing sign-in (up to the ack timeout each), monitoringStatus tries again after it.
   */
  private managementDown(): boolean {
    const failure = this.managementFailure;
    return failure !== null && this.now() - failure.at < STATUS_TTL_MS;
  }

  /** The outcome of a management attempt outside monitoringStatus; a change shows there at once. */
  private managementResult(error: string | null) {
    const changed = error !== this.lastManagementError;
    this.lastManagementError = error;
    this.managementFailure = error === null ? null : { at: this.now(), message: error };
    if (changed) this.reads.forget('status');
  }

  /** After a write: management works, the metrics and the charts of the monitor are read again. */
  private forgetMonitor(externalId: string) {
    this.managementResult(null);
    this.reads.forget('metrics');
    this.reads.forget(`chart:${externalId}`);
  }
}
