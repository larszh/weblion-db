import { readFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server, type Socket } from 'socket.io';

// ---------------------------------------------------------------------------
// A small Uptime Kuma 2.5.6, built from its source (server.js, auth.js, rate-limiter.js,
// prometheus.js, status-page-router.js, chart-socket-handler.js, model/monitor.js): /metrics
// behind HTTP Basic with an API key, the public status page JSON, and the Socket.IO events of
// its web UI with Kuma's answers, error texts and pushes.

const FIXTURES = new URL('./fixtures/uptimekuma/', import.meta.url);

export function kumaFixture(name: string): string {
  return readFileSync(new URL(name, FIXTURES), 'utf8');
}

export const KUMA_API_KEY = 'uk3_Zx8kQ2mVnR8sLtW4yZaB9cDeF1gH2jK3';
export const KUMA_USER = 'admin';
export const KUMA_PASSWORD = 'kuma-password-123';
export const KUMA_TOTP = '123456';
export const KUMA_VERSION = '2.5.6';
/** The minute the generated history ends (unix seconds), 2026-10-10 08:00 UTC. */
export const KUMA_NOW = Date.UTC(2026, 9, 10, 8, 0) / 1000;
export const KUMA_STATUS_PAGE = 'muster-ag';

/**
 * Keys "add" accepts: the 2.0.0 fields of editMonitor (the columns of its frozen schema) plus
 * what add consumes itself. Kuma's insert fails on any other key.
 */
export const KUMA_2_0_0_ADD_KEYS = [
  'accepted_statuscodes',
  'active',
  'authDomain',
  'authMethod',
  'authWorkstation',
  'basic_auth_pass',
  'basic_auth_user',
  'body',
  'cacheBust',
  'conditions',
  'databaseConnectionString',
  'databaseQuery',
  'description',
  'dns_resolve_server',
  'dns_resolve_type',
  'docker_container',
  'docker_host',
  'expectedValue',
  'expiryNotification',
  'game',
  'gamedigGivenPortOnly',
  'grpcBody',
  'grpcEnableTls',
  'grpcMetadata',
  'grpcMethod',
  'grpcProtobuf',
  'grpcServiceName',
  'grpcUrl',
  'headers',
  'hostname',
  'httpBodyEncoding',
  'ignoreTls',
  'interval',
  'invertKeyword',
  'ipFamily',
  'jsonPath',
  'jsonPathOperator',
  'kafkaProducerAllowAutoTopicCreation',
  'kafkaProducerBrokers',
  'kafkaProducerMessage',
  'kafkaProducerSaslOptions',
  'kafkaProducerSsl',
  'kafkaProducerTopic',
  'keyword',
  'manual_status',
  'maxredirects',
  'maxretries',
  'method',
  'mqttCheckType',
  'mqttPassword',
  'mqttSuccessMessage',
  'mqttTopic',
  'mqttUsername',
  'mqttWebsocketPath',
  'name',
  'notificationIDList',
  'oauth_audience',
  'oauth_auth_method',
  'oauth_client_id',
  'oauth_client_secret',
  'oauth_scopes',
  'oauth_token_url',
  'packetSize',
  'parent',
  'ping_count',
  'ping_numeric',
  'ping_per_request_timeout',
  'port',
  'proxyId',
  'pushToken',
  'rabbitmqNodes',
  'rabbitmqPassword',
  'rabbitmqUsername',
  'radiusCalledStationId',
  'radiusCallingStationId',
  'radiusPassword',
  'radiusSecret',
  'radiusUsername',
  'remote_browser',
  'resendInterval',
  'retryInterval',
  'smtpSecurity',
  'snmpOid',
  'snmpVersion',
  'timeout',
  'tlsCa',
  'tlsCert',
  'tlsKey',
  'type',
  'upsideDown',
  'url',
];

/** toJSON keys editMonitor does not set from the object it receives. */
const NOT_EDITED = new Set([
  'id',
  'path',
  'pathName',
  'childrenIDs',
  'weight',
  'active',
  'forceInactive',
  'tags',
  'maintenance',
  'screenshot',
  'includeSensitiveData',
  'dns_last_result',
  'notificationIDList',
]);

export type KumaMonitor = Record<string, unknown> & {
  id: number;
  name: string;
  type: string;
  active: boolean;
};

const SECRET_DEFAULTS: Record<string, unknown> = {
  headers: null,
  body: null,
  basic_auth_user: null,
  basic_auth_pass: null,
  oauth_client_id: null,
  oauth_client_secret: null,
  bearer_token: null,
  tlsKey: null,
  authMethod: null,
};

/** The fixture monitor (id 1, with secrets) and the others built from it without secrets. */
export function kumaMonitors(): KumaMonitor[] {
  const first = JSON.parse(kumaFixture('monitor-2.5.6.json')) as KumaMonitor;
  const blank = { ...first, ...SECRET_DEFAULTS, parent: null, tags: [], notificationIDList: {} };
  const make = (fields: Record<string, unknown>) =>
    ({ ...blank, path: [fields.name], pathName: fields.name, ...fields }) as KumaMonitor;
  return [
    first,
    make({
      id: 2,
      name: 'Shop "Warenkorb" \\ Check',
      type: 'keyword',
      url: 'https://shop.muster-ag.ch',
      keyword: 'Warenkorb',
      interval: 120,
      retryInterval: 120,
    }),
    make({
      id: 3,
      name: 'Router Ping',
      type: 'ping',
      url: 'https://',
      hostname: '198.51.100.7',
      timeout: 10,
    }),
    make({
      id: 4,
      name: 'Mail SMTP',
      type: 'port',
      url: 'https://',
      hostname: 'mail.muster-ag.ch',
      port: 587,
    }),
    make({ id: 5, name: 'Kunden', type: 'group', url: 'https://', childrenIDs: [1] }),
    make({
      id: 6,
      name: 'Alpenblick Hotel',
      type: 'http',
      url: 'https://alpenblick-hotel.ch',
      active: false,
    }),
  ];
}

/** "YYYY-MM-DD HH:mm:ss.SSS" in UTC, as Kuma stores heartbeat times. */
export function kumaTimeText(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace('T', ' ').replace('Z', '');
}

/**
 * getMonitorChartData as UptimeCalculator.getDataArray builds it: newest first, one entry per
 * minute (24 h), hour (up to 30 days) or day. Monitor 2 was down for 20 minutes 3 hours ago,
 * monitor 1 in maintenance for 5 minutes 10 hours ago. A minute without an up beat keeps
 * avgPing 0, like Kuma.
 */
export function kumaChartData(monitorId: number, periodHours: number): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (periodHours <= 24) {
    for (let i = 0; i < periodHours * 60; i++) {
      const timestamp = KUMA_NOW - 60 * i;
      if (monitorId === 2 && i >= 180 && i < 200) {
        out.push({ up: 0, down: 1, avgPing: 0, minPing: 0, maxPing: 0, timestamp });
      } else if (monitorId === 1 && i >= 600 && i < 605) {
        out.push({ up: 0, down: 0, maintenance: 1, avgPing: 0, minPing: 0, maxPing: 0, timestamp });
      } else {
        const ping = 180 + (i % 10);
        out.push({ up: 1, down: 0, avgPing: ping, minPing: ping - 5, maxPing: ping + 5, timestamp });
      }
    }
  } else {
    const hours = Math.min(periodHours, 720);
    for (let i = 0; i < hours; i++) {
      const timestamp = KUMA_NOW - 3600 * i;
      const down = monitorId === 2 && i === 3 ? 20 : 0;
      const ping = 190 + (i % 24);
      out.push({ up: 60 - down, down, avgPing: ping, minPing: ping - 20, maxPing: ping + 40, timestamp });
    }
  }
  return out;
}

/** Status changes of a monitor, newest first: 25 for monitor 1, down with Kuma's error text, up with the HTTP status. */
function importantBeats(monitorId: number): Record<string, unknown>[] {
  if (monitorId !== 1) return [];
  return Array.from({ length: 25 }, (_, i) => {
    const down = i % 2 === 0;
    return {
      monitorID: monitorId,
      status: down ? 0 : 1,
      time: kumaTimeText(KUMA_NOW - 7200 * i - 13),
      msg: down ? `connect ECONNREFUSED 185.101.0.25:443 (${i})` : '200 - OK',
      ping: down ? null : 180 + i,
      important: 1,
      duration: 7200,
      retries: 0,
      response: null,
    };
  });
}

export interface RecordedKumaRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
}

export interface RecordedKumaEvent {
  event: string;
  args: unknown[];
}

export type KumaHttpAnswer = {
  status: number;
  body: string;
  headers?: Record<string, string>;
};

export interface KumaMockOptions {
  /** Like Kuma 3.0 (master): no login and loginByToken events, so a sign-in gets no answer. */
  version3?: boolean;
  /** The account has 2FA on (code KUMA_TOTP). */
  twoFactor?: boolean;
  /** /metrics text, default the 2.5.6 fixture. */
  metrics?: string;
  /** Kuma's API bucket: 60 requests per minute for the whole instance. */
  metricsPerMinute?: number;
  /** Kuma's login limiter: 20 per minute for the whole instance. */
  loginsPerMinute?: number;
}

/** A fixed window per minute, like the effect of Kuma's token buckets in a test. */
class Window {
  private start = Date.now();
  private used = 0;

  constructor(private readonly limit: number) {}

  take(): boolean {
    if (Date.now() - this.start >= 60_000) {
      this.start = Date.now();
      this.used = 0;
    }
    this.used++;
    return this.used <= this.limit;
  }
}

function base64url(text: string): string {
  return Buffer.from(text).toString('base64url');
}

export async function startKumaMock(options: KumaMockOptions = {}) {
  const requests: RecordedKumaRequest[] = [];
  const events: RecordedKumaEvent[] = [];
  const handshakes: IncomingHttpHeaders[] = [];
  const monitors = new Map<number, KumaMonitor>(kumaMonitors().map((m) => [m.id, m]));
  const addKeys = new Set(KUMA_2_0_0_ADD_KEYS);
  const notifications = [
    { id: 1, name: 'Ops', isDefault: true, active: true, config: '{"smtpPassword":"notification-secret"}' },
    { id: 2, name: 'Customer X', isDefault: false, active: true, config: '{}' },
  ];
  let metrics = options.metrics ?? kumaFixture('metrics-2.5.6.txt');
  let generation = 1;
  let lastTotp: string | null = null;
  let nextId = 100;
  const metricsWindow = new Window(options.metricsPerMinute ?? 60);
  const loginWindow = new Window(options.loginsPerMinute ?? 20);
  const signedIn = new Set<string>();

  const state = {
    /** Answers HTTP requests before the routes when it returns an answer. */
    override: null as ((req: RecordedKumaRequest) => KumaHttpAnswer | undefined) | null,
  };

  const token = () =>
    `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${base64url(JSON.stringify({ username: KUMA_USER, h: generation }))}.mock`;

  const statusPage = () => ({
    config: {
      slug: KUMA_STATUS_PAGE,
      title: 'Muster AG Status',
      description: null,
      icon: '/icon.svg',
      published: true,
      showTags: false,
      showCertificateExpiry: false,
    },
    incidents: [],
    publicGroupList: [
      {
        id: 1,
        name: 'Dienste',
        weight: 1,
        monitorList: [
          { id: 1, name: 'Muster Website', sendUrl: 0, type: 'http' },
          { id: 2, name: 'Shop', sendUrl: 0, type: 'keyword' },
        ],
      },
    ],
    maintenanceList: [],
  });

  const heartbeats = () => {
    const list: Record<string, unknown[]> = {};
    for (const id of [1, 2]) {
      list[String(id)] = Array.from({ length: 100 }, (_, i) => {
        const age = 99 - i;
        const down = id === 2 && age < 3;
        return {
          status: down ? 0 : 1,
          time: kumaTimeText(KUMA_NOW - 60 * age + 2),
          msg: '',
          ping: down ? null : 150 + (i % 7),
        };
      });
    }
    return { heartbeatList: list, uptimeList: { '1_24': 0.9993, '2_24': 0.95 } };
  };

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };

  const server = createServer((req, res) => {
    const recorded: RecordedKumaRequest = {
      method: req.method ?? 'GET',
      path: req.url ?? '/',
      headers: req.headers,
    };
    requests.push(recorded);
    const answer = state.override?.(recorded);
    if (answer) {
      res.statusCode = answer.status;
      for (const [k, v] of Object.entries(answer.headers ?? {})) res.setHeader(k, v);
      res.end(answer.body);
      return;
    }
    const url = new URL(req.url ?? '/', 'http://kuma');
    if (url.pathname === '/metrics') {
      // express-basic-auth with challenge: 401, a Basic challenge and no body.
      const refuse = () => {
        res.statusCode = 401;
        res.setHeader('WWW-Authenticate', 'Basic realm=""');
        res.end();
      };
      const header = req.headers.authorization ?? '';
      if (!header.startsWith('Basic ')) return refuse();
      // Kuma checks the bucket first and counts every attempt, also failed ones.
      if (!metricsWindow.take()) return refuse();
      const decoded = Buffer.from(header.slice(6), 'base64').toString();
      const password = decoded.slice(decoded.indexOf(':') + 1);
      if (password !== KUMA_API_KEY) return refuse();
      res.statusCode = 200;
      res.setHeader('content-type', 'text/plain; version=0.0.4; charset=utf-8');
      res.end(metrics);
      return;
    }
    const heartbeat = /^\/api\/status-page\/heartbeat\/([^/]+)$/.exec(url.pathname);
    if (heartbeat) {
      // Unknown slugs: no monitors of the page, so empty lists (status-page-router.js).
      const slug = decodeURIComponent(heartbeat[1] ?? '').toLowerCase();
      return json(res, 200, slug === KUMA_STATUS_PAGE ? heartbeats() : { heartbeatList: {}, uptimeList: {} });
    }
    const page = /^\/api\/status-page\/([^/]+)$/.exec(url.pathname);
    if (page) {
      const slug = decodeURIComponent(page[1] ?? '').toLowerCase();
      if (slug !== KUMA_STATUS_PAGE) return json(res, 404, { status: 'fail', msg: 'Status Page Not Found' });
      return json(res, 200, statusPage());
    }
    if (url.pathname === '/api/entry-page')
      return json(res, 200, { type: 'entryPage', entryPage: 'dashboard' });
    const badge = /^\/api\/badge\/(\d+)\/status$/.exec(url.pathname);
    if (badge) {
      res.setHeader('content-type', 'image/svg+xml');
      res.end('<svg xmlns="http://www.w3.org/2000/svg"><text>Up</text></svg>');
      return;
    }
    // The single page app answers every other path.
    res.statusCode = 200;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!DOCTYPE html><html><head><title>Uptime Kuma</title></head><body></body></html>');
  });

  const io = new Server(server, {
    path: '/socket.io',
    serveClient: false,
    // uptime-kuma-server.js: no Origin is fine, an Origin must match the Host.
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      if (!origin) return callback(null, true);
      callback(null, URL.canParse(origin) && new URL(origin).host === req.headers.host);
    },
  });

  const listJson = (only?: number) => {
    const out: Record<string, unknown> = {};
    for (const [id, m] of monitors) if (only === undefined || only === id) out[id] = { ...m };
    return out;
  };

  /** afterLogin: the list, info, notifications, then per monitor its beats and stats. */
  const afterLogin = (socket: Socket) => {
    signedIn.add(socket.id);
    socket.emit('monitorList', listJson());
    socket.emit('info', { version: KUMA_VERSION, latestVersion: KUMA_VERSION, primaryBaseURL: null });
    socket.emit('notificationList', notifications);
    socket.emit('proxyList', []);
    for (const id of monitors.keys()) {
      socket.emit('heartbeatList', String(id), [], true);
      socket.emit('avgPing', String(id), id === 3 ? 13.21 : 204.5);
      socket.emit('uptime', String(id), 24, id === 2 ? 0.95 : 0.9993);
      socket.emit('uptime', String(id), 720, 0.99987);
      socket.emit('uptime', String(id), '1y', 0.9995);
      socket.emit('certInfo', String(id), '{"valid":true}');
    }
  };

  io.on('connection', (socket) => {
    handshakes.push(socket.handshake.headers);
    // Before the sign-in Kuma sends the info without its version.
    socket.emit('info', { primaryBaseURL: null, serverTimezone: 'Europe/Zurich' });
    socket.onAny((event: string, ...args: unknown[]) => {
      events.push({
        event,
        args: JSON.parse(JSON.stringify(args.filter((a) => typeof a !== 'function'))) as unknown[],
      });
    });
    socket.on('disconnect', () => signedIn.delete(socket.id));

    type Ack = (answer: unknown) => void;
    /** Monitor events: checkLogin first, errors as { ok: false, msg: e.message }. */
    const on = (event: string, handler: (args: unknown[]) => unknown) => {
      socket.on(event, (...raw: unknown[]) => {
        const callback = raw.at(-1);
        if (typeof callback !== 'function') return;
        const args = raw.slice(0, -1);
        try {
          if (!signedIn.has(socket.id)) throw new Error('You are not logged in.');
          (callback as Ack)(handler(args));
        } catch (err) {
          (callback as Ack)({ ok: false, msg: err instanceof Error ? err.message : String(err) });
        }
      });
    };
    const find = (id: unknown, field = 'id') => {
      const monitor = monitors.get(Number(id));
      if (!monitor) throw new TypeError(`Cannot read properties of null (reading '${field}')`);
      return monitor;
    };
    const validate = (m: Record<string, unknown>) => {
      if (Number(m.interval) < 20) throw new Error('Interval cannot be less than 20 seconds');
      if (Number(m.retryInterval) < 20) throw new Error('Retry interval cannot be less than 20 seconds');
    };
    const pushUpdate = (id: number) => socket.emit('updateMonitorIntoList', listJson(id));

    if (!options.version3) {
      socket.on('login', (data: Record<string, unknown> | undefined, callback: Ack) => {
        if (typeof callback !== 'function' || !data) return;
        if (!loginWindow.take()) return callback({ ok: false, msg: 'Too frequently, try again later.' });
        if (data.username !== KUMA_USER || data.password !== KUMA_PASSWORD) {
          return callback({ ok: false, msg: 'authIncorrectCreds', msgi18n: true });
        }
        if (options.twoFactor) {
          if (!data.token) return callback({ tokenRequired: true });
          if (data.token !== KUMA_TOTP || data.token === lastTotp) {
            return callback({ ok: false, msg: 'authInvalidToken', msgi18n: true });
          }
          lastTotp = String(data.token);
        }
        afterLogin(socket);
        callback({ ok: true, token: token() });
      });
      socket.on('loginByToken', (value: unknown, callback: Ack) => {
        if (typeof callback !== 'function') return;
        if (value !== token()) return callback({ ok: false, msg: 'authInvalidToken', msgi18n: true });
        afterLogin(socket);
        callback({ ok: true });
      });
    }

    on('getMonitorList', () => {
      socket.emit('monitorList', listJson());
      return { ok: true };
    });
    on('getMonitor', ([id]) => ({ ok: true, monitor: { ...find(id) } }));
    on('add', ([input]) => {
      const monitor = { ...(input as Record<string, unknown>) };
      const notificationIDList = (monitor.notificationIDList ?? {}) as Record<string, boolean>;
      if (!Array.isArray(monitor.accepted_statuscodes)) {
        throw new TypeError("Cannot read properties of undefined (reading 'every')");
      }
      if (!monitor.accepted_statuscodes.every((code) => typeof code === 'string')) {
        throw new Error('Accepted status codes are not all strings');
      }
      // R.freeze(true): the insert fails on a key that is no column.
      const unknown = Object.keys(monitor).find((key) => !addKeys.has(key));
      if (unknown) {
        throw new Error(
          `insert into \`monitor\` - SQLITE_ERROR: table monitor has no column named ${unknown}`,
        );
      }
      validate(monitor);
      const id = nextId++;
      const template = kumaMonitors()[1] as KumaMonitor;
      const stored = {
        ...template,
        ...monitor,
        id,
        path: [monitor.name],
        pathName: monitor.name,
        active: monitor.active !== false,
        notificationIDList,
      } as KumaMonitor;
      monitors.set(id, stored);
      pushUpdate(id);
      return { ok: true, msg: 'successAdded', msgi18n: true, monitorID: id };
    });
    on('editMonitor', ([input]) => {
      const monitor = input as Record<string, unknown>;
      const stored = find(monitor.id, 'user_id');
      if (!Array.isArray(monitor.accepted_statuscodes)) {
        throw new TypeError("Cannot read properties of undefined (reading 'every')");
      }
      if (!monitor.accepted_statuscodes.every((code) => typeof code === 'string')) {
        throw new Error('Accepted status codes are not all strings');
      }
      validate(monitor);
      // bean.x = monitor.x for every field: what is not sent becomes null.
      const next = { ...stored };
      for (const key of Object.keys(stored)) {
        if (!NOT_EDITED.has(key)) next[key] = monitor[key] ?? null;
      }
      next.notificationIDList = monitor.notificationIDList ?? {};
      monitors.set(stored.id, next as KumaMonitor);
      pushUpdate(stored.id);
      return { ok: true, msg: 'Saved.', msgi18n: true, monitorID: stored.id };
    });
    const setActive = (id: unknown, active: boolean) => {
      const monitor = monitors.get(Number(id));
      if (!monitor) throw new Error('You do not own this monitor.');
      monitor.active = active;
      pushUpdate(monitor.id);
    };
    on('pauseMonitor', ([id]) => {
      setActive(id, false);
      return { ok: true, msg: 'successPaused', msgi18n: true };
    });
    on('resumeMonitor', ([id]) => {
      setActive(id, true);
      return { ok: true, msg: 'successResumed', msgi18n: true };
    });
    on('deleteMonitor', ([id]) => {
      // Two-argument form (id, callback) and 2.5's (id, deleteChildren, callback) both work.
      monitors.delete(Number(id));
      socket.emit('deleteMonitorFromList', Number(id));
      return { ok: true, msg: 'successDeleted', msgi18n: true };
    });
    on('getMonitorChartData', ([id, period]) => {
      if (period === null || period === undefined) throw new Error('Invalid period.');
      return { ok: true, data: monitors.has(Number(id)) ? kumaChartData(Number(id), Number(period)) : [] };
    });
    on('monitorImportantHeartbeatListPaged', ([id, offset, count]) => ({
      ok: true,
      data: importantBeats(Number(id)).slice(Number(offset), Number(offset) + Number(count)),
    }));
    // Events the console must never send; Kuma has them, so they would succeed.
    for (const event of ['setSettings', 'addAPIKey', 'uploadBackup', 'changePassword', 'getSettings']) {
      on(event, () => ({ ok: true }));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    events,
    handshakes,
    monitors,
    addKeys,
    state,
    /** The token a password sign-in returns now. */
    token,
    setMetrics(text: string) {
      metrics = text;
    },
    /** A password change: every token issued so far is refused. */
    rotatePassword() {
      generation++;
    },
    /** Disconnects every socket, like a Kuma restart. */
    kick() {
      io.disconnectSockets(true);
    },
    /** Forgets every sign-in without disconnecting: the next event answers "You are not logged in.". */
    forgetSessions() {
      signedIn.clear();
    },
    connectedSockets(): number {
      return io.of('/').sockets.size;
    },
    eventCount(event: string): number {
      return events.filter((e) => e.event === event).length;
    },
    async close() {
      io.disconnectSockets(true);
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export type KumaMock = Awaited<ReturnType<typeof startKumaMock>>;
