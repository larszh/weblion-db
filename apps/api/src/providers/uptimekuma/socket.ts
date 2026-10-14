import { io, type Socket } from 'socket.io-client';
import { AppError, ProviderError, badRequest } from '../../lib/errors';
import { isRecord, num } from '../http';
import { PROVIDER } from './client';
import {
  describeKumaMessage,
  isKumaMonitorJson,
  kumaFailureKind,
  type KumaMonitorJson,
  type KumaStats,
} from './parse';

export type { KumaMonitorJson };

/**
 * The only file that knows Socket.IO. Uptime Kuma has no REST API for monitors: its web UI
 * manages them over Socket.IO events, which this file speaks with a session token (a JWT from
 * Kuma's login that stays valid until the Kuma password changes). Only the events of
 * KUMA_EVENTS are ever sent with that token; it is a master key of the whole instance.
 */

const ACK_TIMEOUT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 10_000;
/** While connected Kuma pushes every heartbeat and recomputes stats for the room: close soon. */
const IDLE_MS = 180_000;
const MAX_IN_FLIGHT = 4;
/** How long the sign-in waits for the "info" event with Kuma's version. */
const VERSION_WAIT_MS = 3000;

const NO_SIGN_IN_ANSWER =
  'no answer to the sign-in. Uptime Kuma 3.x signs in differently and is not supported for ' +
  'management yet (reading through /metrics keeps working).';
const TOKEN_REFUSED =
  'the stored management session was refused (the Uptime Kuma password was changed, or the token ' +
  'belongs to another instance). Sign in again under Admin > Monitoring.';
const NOT_LOGGED_IN = 'You are not logged in.';

/** The socket events the console sends with the session token. Everything else is refused. */
export const KUMA_EVENTS = [
  'getMonitorList',
  'getMonitor',
  'add',
  'editMonitor',
  'pauseMonitor',
  'resumeMonitor',
  'deleteMonitor',
  'getMonitorChartData',
  'monitorImportantHeartbeatListPaged',
] as const;
export type KumaEvent = (typeof KUMA_EVENTS)[number];

export function isKumaEvent(value: string): value is KumaEvent {
  return (KUMA_EVENTS as readonly string[]).includes(value);
}

export interface KumaSocketOptions {
  /** Default 15 s. */
  ackTimeoutMs?: number;
  /** Default 10 s. */
  connectTimeoutMs?: number;
  /** Disconnect after this long without a call. Default 3 minutes. */
  idleMs?: number;
  /** Default 4. */
  maxInFlight?: number;
  /** Tests inject a fake clock and io(). */
  now?: () => number;
  ioFactory?: typeof io;
}

/** A Kuma answer. */
export interface KumaAck {
  ok?: boolean;
  msg?: string;
  msgi18n?: boolean;
  [key: string]: unknown;
}

/** Bounded number of concurrent tasks, the rest wait in order. */
class Limiter {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active < this.max) this.active++;
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
    try {
      return await fn();
    } finally {
      // Hand the slot straight to the next waiter, or give it back.
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}

function scrub(text: string, secrets: (string | null | undefined)[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join('[redacted]');
  }
  return out;
}

/** The reason of a failed connect, with the underlying error (engine.io wraps it in "description"). */
function connectCause(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const description = (err as { description?: unknown }).description;
  const inner =
    description instanceof Error
      ? description.message
      : isRecord(description) && typeof description.message === 'string'
        ? description.message
        : null;
  return inner && inner !== err.message ? `${err.message} (${inner})` : err.message;
}

/** A new Socket.IO connection: websocket only, no reconnects, no Origin header, no cookies. */
function openSocket(baseUrl: string, options: KumaSocketOptions): Socket {
  // The origin only: a path in the URL would be read as a Socket.IO namespace.
  const origin = new URL(baseUrl).origin;
  return (options.ioFactory ?? io)(origin, {
    path: '/socket.io',
    transports: ['websocket'],
    reconnection: false,
    timeout: options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS,
    forceNew: true,
    autoConnect: true,
  });
}

function waitConnected(socket: Socket, timeoutMs: number): Promise<void> {
  if (socket.connected) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const done = (err: unknown) => {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
      if (err) reject(err);
      else resolve();
    };
    const onConnect = () => done(null);
    const onError = (err: Error) => done(err);
    const timer = setTimeout(() => done(new Error(`no connection within ${timeoutMs / 1000} s`)), timeoutMs);
    socket.on('connect', onConnect);
    socket.on('connect_error', onError);
  });
}

/** Resolves when `register` calls its callback, or after `ms` at the latest. */
function waitAtMost(ms: number, register: (done: () => void) => void): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    register(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** The monitor id an event is about, for "not found" messages. */
function monitorIdOf(args: unknown[]): string {
  const first = args[0];
  if (isRecord(first)) return String(first.id ?? '?');
  return String(first ?? '?');
}

/** A failed answer ({ ok: false, msg }) as the error the caller gets. */
function callError(event: KumaEvent, args: unknown[], ack: KumaAck): AppError {
  const msg = typeof ack.msg === 'string' ? ack.msg : undefined;
  const text = describeKumaMessage(msg, ack.msgi18n === true);
  switch (kumaFailureKind(msg)) {
    case 'not_found':
      return new ProviderError(PROVIDER, `monitor ${monitorIdOf(args)} not found in Uptime Kuma`, 404);
    case 'rate_limited':
      return new ProviderError(PROVIDER, 'too many requests, try again in a minute', 429);
    case 'validation':
      return badRequest(`${PROVIDER}: ${text}`);
    case 'schema':
      return new ProviderError(
        PROVIDER,
        `this Uptime Kuma version does not know a field the console sends (${text}). Check the supported versions.`,
        502,
      );
    case 'not_logged_in':
      return new ProviderError(PROVIDER, `${event} failed: the management session was lost, try again`);
    default:
      return new ProviderError(PROVIDER, `${event} failed: ${text}`);
  }
}

/**
 * One management session of one instance: opened on demand with loginByToken (Kuma has no rate
 * limit on it), kept while in use, closed after `idleMs` without a call. Kuma pushes the monitor
 * list, the default notifications, its version and per-monitor stats after the sign-in; they
 * are kept here and current while connected.
 */
export class KumaSocket {
  /** From the "info" event after sign-in. */
  version: string | null = null;
  /** Ids of notifications with isDefault true (from "notificationList"). */
  defaultNotificationIds: number[] = [];
  /** Latest list from "monitorList", kept current by "updateMonitorIntoList" and "deleteMonitorFromList". */
  monitorList: { at: number; byId: Map<string, KumaMonitorJson> } | null = null;
  /** From "uptime" (24 and 720) and "avgPing" events, per monitor id. */
  stats = new Map<string, KumaStats>();

  private socket: Socket | null = null;
  private signedIn = false;
  private session: Promise<Socket> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = 0;
  /** Counts "monitorList" events, so a caller can tell a fresh list from the cached one. */
  private listSeq = 0;
  /** Counts failed sign-ins, so a call that waited for a slot during one gets that failure. */
  private signInFailures = 0;
  private lastSignInError: unknown = null;
  private listWaiters: (() => void)[] = [];
  private readonly slots: Limiter;
  private readonly ackTimeoutMs: number;
  private readonly connectTimeoutMs: number;
  private readonly idleMs: number;
  private readonly now: () => number;

  constructor(
    private readonly baseUrl: string,
    private readonly sessionToken: string,
    private readonly options: KumaSocketOptions = {},
  ) {
    this.ackTimeoutMs = options.ackTimeoutMs ?? ACK_TIMEOUT_MS;
    this.connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
    this.idleMs = options.idleMs ?? IDLE_MS;
    this.now = options.now ?? Date.now;
    this.slots = new Limiter(options.maxInFlight ?? MAX_IN_FLIGHT);
  }

  /** Signed in and the connection is up. */
  get connected(): boolean {
    return this.signedIn && !!this.socket?.connected;
  }

  /** Signs in if needed, emits with an ack timeout, throws for ok: false. */
  async call(event: KumaEvent, ...args: unknown[]): Promise<KumaAck> {
    const ack = await this.callRaw(event, ...args);
    if (ack.ok !== true) throw callError(event, args, ack);
    return ack;
  }

  /** Like call, but a refusal ({ ok: false }) is returned instead of thrown (API explorer). */
  async callRaw(event: KumaEvent, ...args: unknown[]): Promise<KumaAck> {
    // The type is not enough: explorer input reaches this at runtime.
    if (!isKumaEvent(event)) throw badRequest(`The Uptime Kuma event "${String(event)}" is not allowed`);
    const failures = this.signInFailures;
    return this.slots.run(async () => {
      let { ack, socket } = await this.emit(event, args, failures);
      if (ack.ok !== true && ack.msg === NOT_LOGGED_IN) {
        // Kuma restarted or dropped the session: sign in once more and repeat once. A
        // concurrent call may have started the new session already; that one is kept.
        if (this.socket === socket) this.disconnect();
        ({ ack, socket } = await this.emit(event, args, this.signInFailures));
      }
      return ack;
    });
  }

  /**
   * The monitor list while a session is open (Kuma pushes every change to it), without a
   * request and without keeping the session alive; null without an open session.
   */
  liveList(): Map<string, KumaMonitorJson> | null {
    return this.connected && this.monitorList ? new Map(this.monitorList.byId) : null;
  }

  /** The monitor list, from the cache if younger than maxAgeMs, else getMonitorList. */
  async listMonitors(maxAgeMs: number): Promise<Map<string, KumaMonitorJson>> {
    const cached = this.monitorList;
    if (cached && this.now() - cached.at < maxAgeMs) return new Map(cached.byId);
    const seq = this.listSeq;
    await this.call('getMonitorList');
    // Kuma emits the list before it answers, so it is normally here already.
    if (this.listSeq === seq) {
      await waitAtMost(this.ackTimeoutMs, (done) => this.listWaiters.push(done));
    }
    if (this.listSeq === seq || !this.monitorList) {
      throw new ProviderError(
        PROVIDER,
        'Uptime Kuma answered getMonitorList without sending the monitor list',
      );
    }
    return new Map(this.monitorList.byId);
  }

  close(): void {
    this.disconnect();
  }

  private async emit(
    event: KumaEvent,
    args: unknown[],
    failures: number,
  ): Promise<{ ack: KumaAck; socket: Socket }> {
    const socket = await this.ensureSession(failures);
    this.inFlight++;
    this.touch();
    let answer: unknown;
    try {
      answer = await socket.timeout(this.ackTimeoutMs).emitWithAck(event, ...args);
    } catch (err) {
      const timedOut = err instanceof Error && /timed out/i.test(err.message);
      throw new ProviderError(
        PROVIDER,
        timedOut
          ? `no answer to ${event} within ${Math.round(this.ackTimeoutMs / 1000)} s`
          : `the management connection was lost during ${event}`,
      );
    } finally {
      this.inFlight--;
      this.touch();
    }
    if (!isRecord(answer)) {
      throw new ProviderError(PROVIDER, `${event} failed: unexpected answer from Uptime Kuma`);
    }
    return { ack: answer as KumaAck, socket };
  }

  /**
   * One shared sign-in while connecting. A call that waited for a slot while a sign-in failed
   * (`failures` is the count when it arrived) gets that failure instead of waiting for another.
   */
  private ensureSession(failures: number): Promise<Socket> {
    if (this.socket && this.signedIn && this.socket.connected) return Promise.resolve(this.socket);
    if (!this.session && this.signInFailures > failures) return Promise.reject(this.lastSignInError);
    if (!this.session) {
      this.session = this.openSession().finally(() => {
        this.session = null;
      });
    }
    return this.session;
  }

  private async openSession(): Promise<Socket> {
    this.disconnect();
    const socket = openSocket(this.baseUrl, this.options);
    this.socket = socket;
    this.listen(socket);
    try {
      try {
        await waitConnected(socket, this.connectTimeoutMs);
      } catch (err) {
        throw new ProviderError(PROVIDER, this.scrub(`management connection failed: ${connectCause(err)}`));
      }
      const seq = this.listSeq;
      let answer: unknown;
      try {
        answer = await socket.timeout(this.ackTimeoutMs).emitWithAck('loginByToken', this.sessionToken);
      } catch (err) {
        const timedOut = err instanceof Error && /timed out/i.test(err.message);
        throw new ProviderError(
          PROVIDER,
          timedOut ? NO_SIGN_IN_ANSWER : 'the management connection was lost during the sign-in',
        );
      }
      const ack: KumaAck = isRecord(answer) ? answer : {};
      if (ack.ok !== true) {
        if (ack.msg === 'authUserInactiveOrDeleted') {
          throw new ProviderError(
            PROVIDER,
            'the Uptime Kuma account of the management session is inactive or deleted',
            401,
          );
        }
        if (ack.msg === 'authInvalidToken') throw new ProviderError(PROVIDER, TOKEN_REFUSED, 401);
        const text = describeKumaMessage(typeof ack.msg === 'string' ? ack.msg : undefined, ack.msgi18n);
        throw new ProviderError(PROVIDER, this.scrub(`the management sign-in failed: ${text}`));
      }
      // Kuma pushes the monitor list during the sign-in (afterLogin); wait for it a little.
      if (this.listSeq === seq) {
        await waitAtMost(this.ackTimeoutMs, (done) => this.listWaiters.push(done));
      }
      if (this.socket !== socket || !socket.connected) {
        throw new ProviderError(PROVIDER, 'the management connection was lost during the sign-in');
      }
      this.signedIn = true;
      this.touch();
      return socket;
    } catch (err) {
      if (this.socket === socket) this.disconnect();
      else socket.disconnect();
      this.signInFailures++;
      this.lastSignInError = err;
      throw err;
    }
  }

  private listen(socket: Socket) {
    const mine = () => this.socket === socket;
    socket.on('info', (info: unknown) => {
      if (mine() && isRecord(info) && typeof info.version === 'string' && info.version) {
        this.version = info.version;
      }
    });
    socket.on('notificationList', (list: unknown) => {
      if (!mine() || !Array.isArray(list)) return;
      this.defaultNotificationIds = list
        .filter(isRecord)
        .filter((n) => n.isDefault === true || n.isDefault === 1)
        .map((n) => num(n.id))
        .filter((id): id is number => id !== null && Number.isInteger(id));
    });
    socket.on('monitorList', (list: unknown) => {
      if (!mine() || !isRecord(list)) return;
      const byId = new Map<string, KumaMonitorJson>();
      for (const value of Object.values(list)) {
        if (isKumaMonitorJson(value)) byId.set(String(value.id), value);
      }
      this.monitorList = { at: this.now(), byId };
      this.listSeq++;
      const waiters = this.listWaiters;
      this.listWaiters = [];
      for (const done of waiters) done();
    });
    socket.on('updateMonitorIntoList', (list: unknown) => {
      if (!mine() || !isRecord(list) || !this.monitorList) return;
      for (const value of Object.values(list)) {
        if (isKumaMonitorJson(value)) this.monitorList.byId.set(String(value.id), value);
      }
    });
    socket.on('deleteMonitorFromList', (id: unknown) => {
      if (mine()) this.monitorList?.byId.delete(String(id));
    });
    socket.on('uptime', (monitorId: unknown, period: unknown, value: unknown) => {
      if (!mine()) return;
      const key = String(monitorId);
      const ratio = num(value);
      if (ratio === null) return;
      const stats = this.stats.get(key) ?? {};
      if (String(period) === '24') stats.uptime24h = ratio;
      else if (String(period) === '720') stats.uptime30d = ratio;
      else return;
      this.stats.set(key, stats);
    });
    socket.on('avgPing', (monitorId: unknown, value: unknown) => {
      if (!mine()) return;
      const key = String(monitorId);
      this.stats.set(key, { ...this.stats.get(key), avgPing24h: num(value) });
    });
    socket.on('disconnect', () => {
      if (!mine()) return;
      this.signedIn = false;
      this.socket = null;
      this.clearIdle();
    });
  }

  private touch() {
    this.clearIdle();
    const timer = setTimeout(() => {
      this.idleTimer = null;
      if (this.inFlight > 0) this.touch();
      else this.disconnect();
    }, this.idleMs);
    timer.unref?.();
    this.idleTimer = timer;
  }

  private clearIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private disconnect() {
    this.clearIdle();
    const socket = this.socket;
    this.socket = null;
    this.signedIn = false;
    socket?.disconnect();
  }

  private scrub(text: string): string {
    return scrub(text, [this.sessionToken]);
  }
}

/**
 * Exchanges a Kuma login (user name, password, 2FA code if enabled) for a session token on an
 * own short-lived connection. The password and the code never appear in an error and are never
 * logged; the connection is closed in any case.
 */
export async function kumaSignIn(
  baseUrl: string,
  credentials: { username: string; password: string; totp?: string },
  options: KumaSocketOptions = {},
): Promise<{ token: string; version: string | null }> {
  const secrets = [credentials.password, credentials.totp];
  const ackTimeoutMs = options.ackTimeoutMs ?? ACK_TIMEOUT_MS;
  const socket = openSocket(baseUrl, options);
  let version: string | null = null;
  let versionSeen: (() => void) | null = null;
  socket.on('info', (info: unknown) => {
    if (isRecord(info) && typeof info.version === 'string' && info.version) {
      version = info.version;
      versionSeen?.();
    }
  });
  try {
    try {
      await waitConnected(socket, options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS);
    } catch (err) {
      throw new ProviderError(PROVIDER, scrub(`connection failed: ${connectCause(err)}`, secrets));
    }
    let answer: unknown;
    try {
      answer = await socket.timeout(ackTimeoutMs).emitWithAck('login', {
        username: credentials.username,
        password: credentials.password,
        // Only with a code: Kuma also checks a code sent for an account without 2FA.
        ...(credentials.totp ? { token: credentials.totp } : {}),
      });
    } catch (err) {
      const timedOut = err instanceof Error && /timed out/i.test(err.message);
      throw new ProviderError(
        PROVIDER,
        timedOut ? NO_SIGN_IN_ANSWER : 'the connection was lost during the sign-in',
      );
    }
    const ack: KumaAck = isRecord(answer) ? answer : {};
    if (ack.ok === true && typeof ack.token === 'string' && ack.token) {
      // Kuma sends "info" with its version during the sign-in, normally before the answer.
      if (!version) await waitAtMost(VERSION_WAIT_MS, (done) => (versionSeen = done));
      return { token: ack.token, version };
    }
    if (ack.tokenRequired === true) {
      throw new AppError(400, 'totp_required', 'Uptime Kuma asks for the two-factor code of this account');
    }
    if (ack.msg === 'authInvalidToken') {
      throw new AppError(400, 'totp_invalid', 'The two-factor code was not accepted');
    }
    if (ack.msg === 'authIncorrectCreds')
      throw new ProviderError(PROVIDER, 'wrong user name or password', 401);
    if (ack.msg === 'Too frequently, try again later.') {
      throw new ProviderError(
        PROVIDER,
        'Too frequently, try again later. Uptime Kuma allows 20 sign-ins per minute for the whole instance',
        429,
      );
    }
    if (ack.ok === true) throw new ProviderError(PROVIDER, 'the sign-in answer carried no session token');
    const text = describeKumaMessage(typeof ack.msg === 'string' ? ack.msg : undefined, ack.msgi18n);
    throw new ProviderError(PROVIDER, scrub(`the sign-in failed: ${text}`, secrets));
  } finally {
    socket.disconnect();
  }
}
