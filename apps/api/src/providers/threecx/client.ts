import { FormData, fetch } from 'undici';
import { ProviderError } from '../../lib/errors';
import { isRecord, num, str } from '../http';
import type { ThreeCxConfig } from '../types';
import { PROVIDER, describeError, parseODataError, type XapiErrorDetails } from './parse';

export { PROVIDER };
/** XAPI base path below the PBX address. */
export const XAPI_PATH = '/xapi/v1';

const TIMEOUT_MS = 20_000;
const TOKEN_TIMEOUT_MS = 15_000;
/** The PBX is a small VM that also carries the calls: the panel keeps a few requests at a time. */
const MAX_IN_FLIGHT = 4;
/** A 429 is retried once when Retry-After asks for at most this long, else it fails. */
const RATE_LIMIT_MAX_WAIT_MS = 5_000;
/** After a refused sign-in no new attempt for this long (3CX blacklists IPs after failed logins). */
const SIGN_IN_BACKOFF_MS = 60_000;
/** Token lifetime when the answer has no usable expires_in. */
const DEFAULT_TOKEN_SECONDS = 300;
/** Collections are read in pages of this size. */
const PAGE_SIZE = 100;
/** 100 pages of 100 entries, far beyond a PBX's users. Stops runaway loops. */
const MAX_PAGES = 100;

export interface ThreeCxClientOptions {
  /** Per API request, default 20 s. */
  timeoutMs?: number;
  /** For /connect/token, default 15 s. */
  tokenTimeoutMs?: number;
  /** Requests at a time per PBX (token requests included), default 4. */
  maxInFlight?: number;
  /** Longest Retry-After of a 429 that is waited for, default 5 s. */
  rateLimitMaxWaitMs?: number;
  /** Fail-fast window after a refused sign-in, default 60 s. */
  signInBackoffMs?: number;
  /** Clock for token expiry, sign-in backoff and caches (tests). */
  now?: () => number;
}

export type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue>;

export interface XapiResponse {
  status: number;
  body: unknown;
}

export interface XapiRequestOptions {
  query?: Query;
  /** Sent as JSON. */
  body?: unknown;
  /** What the request does, for error messages ("list users"). */
  action?: string;
  /** The request lists an entity set: a 404 means the PBX does not know the path. */
  collection?: boolean;
}

/** Bounded number of concurrent tasks, the rest wait in order (copy of the Nextcloud client's). */
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

interface Answer {
  status: number;
  body: unknown;
  retryAfter: string | null;
  /** The access token the request was sent with, blanked in messages. */
  token: string;
}

/** Milliseconds a Retry-After header asks for (seconds or an HTTP date), null when absent. */
export function retryAfterMs(header: string | null, now: number): number | null {
  if (!header) return null;
  const seconds = num(header.trim());
  if (seconds !== null) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/** How long a token is used: until 60 s before it expires, half its lifetime when that is short. */
export function tokenLifetimeMs(expiresIn: unknown): number {
  const seconds = num(expiresIn);
  if (seconds === null || seconds <= 0) return DEFAULT_TOKEN_SECONDS * 1000;
  return (seconds > 120 ? seconds - 60 : seconds / 2) * 1000;
}

function causeOf(err: unknown): string {
  return err instanceof Error ? ((err.cause as Error | undefined)?.message ?? err.message) : String(err);
}

/**
 * The 3CX V20 Configuration API (XAPI, OData v4 below /xapi/v1) with an OAuth2 client of its own
 * (client credentials at /connect/token). 3CX keeps one valid access token per API client, so
 * the token is shared by every request of this client (single flight) and renewed once when the
 * PBX refuses it. After a refused sign-in the client fails fast for a minute, so a wrong secret
 * cannot run into the PBX's brute force protection.
 */
export class ThreeCxClient {
  readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly tokenTimeoutMs: number;
  private readonly rateLimitMaxWaitMs: number;
  private readonly signInBackoffMs: number;
  private readonly slots: Limiter;
  readonly now: () => number;

  private cached: { accessToken: string; expiresAt: number } | null = null;
  private pending: Promise<string> | null = null;
  private refused: { message: string; status: number; until: number } | null = null;

  constructor(
    private readonly config: ThreeCxConfig,
    options: ThreeCxClientOptions = {},
  ) {
    this.baseUrl = config.baseUrl.trim().replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
    this.tokenTimeoutMs = options.tokenTimeoutMs ?? TOKEN_TIMEOUT_MS;
    this.rateLimitMaxWaitMs = options.rateLimitMaxWaitMs ?? RATE_LIMIT_MAX_WAIT_MS;
    this.signInBackoffMs = options.signInBackoffMs ?? SIGN_IN_BACKOFF_MS;
    this.slots = new Limiter(options.maxInFlight ?? MAX_IN_FLIGHT);
    this.now = options.now ?? Date.now;
  }

  /**
   * JSON request below /xapi/v1 (`path` e.g. "/Users(42)"). 2xx: the parsed body, null for an
   * empty answer (204). Anything else becomes a ProviderError with the PBX's OData message and
   * HTTP status (details.odata carries the parsed error).
   */
  async request<T = unknown>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    options: XapiRequestOptions = {},
  ): Promise<T> {
    const res = await this.exchange(method, path, options);
    const what = options.action ? `${options.action} failed` : 'request failed';
    if (res.status >= 200 && res.status < 300) {
      if (res.body === '') return null as T;
      // A PBX without the XAPI (no Enterprise license, access off) may answer with its web app.
      if (typeof res.body === 'string') {
        throw new ProviderError(
          PROVIDER,
          `${what}: the PBX answered without JSON. Check the address and that the XAPI is available ` +
            '(3CX Enterprise license, "XAPI Access Enabled" for the API client)',
          res.status,
        );
      }
      return res.body as T;
    }
    if (res.status === 401) {
      throw new ProviderError(
        PROVIDER,
        `${what}: the PBX refused the access token twice. Another program may use the same API client ` +
          '(3CX allows one valid token per client), or the client was removed',
        401,
      );
    }
    const odata = parseODataError(res.body);
    throw new ProviderError(
      PROVIDER,
      this.scrub(describeError(res.status, res.body, options.action, { collection: options.collection }), [
        res.token,
      ]),
      res.status,
      { odata: odata ? this.scrubDeep(odata, [res.token]) : null } satisfies XapiErrorDetails,
    );
  }

  /**
   * Every page of a collection (`path` e.g. "/Users", `query` without $top/$skip/$count). The
   * XAPI has no next links: pages of 100 with $count=true until the count is reached, an empty
   * page, or MAX_PAGES. A PBX that ignores $skip (a page starting like the one before) fails.
   */
  async list<T = Record<string, unknown>>(path: string, query: Query, action: string): Promise<T[]> {
    const items: T[] = [];
    let previousFirst: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await this.request<unknown>('GET', path, {
        // $skip by what arrived so far: a PBX that caps pages below 100 loses nothing.
        query: { ...query, $top: PAGE_SIZE, $skip: items.length, $count: true },
        action,
        collection: true,
      });
      if (!isRecord(body) || !Array.isArray(body.value)) {
        throw new ProviderError(PROVIDER, `${action} failed: unexpected answer for ${path}`);
      }
      const values = body.value as T[];
      if (values.length === 0) break;
      const first = identity(values[0]);
      if (previousFirst !== null && first === previousFirst) {
        throw new ProviderError(PROVIDER, `${action} failed: the PBX ignores $skip (${path})`);
      }
      previousFirst = first;
      items.push(...values);
      const count = num(body['@odata.count']);
      if (count !== null && items.length >= count) break;
    }
    return items;
  }

  /**
   * Like request, but returns any HTTP answer (explorer). The token is renewed once on a 401
   * and a short 429 is waited for, like for request. Network failures and a refused sign-in
   * throw. Echoed secrets are blanked in the answer.
   */
  async raw(
    method: string,
    path: string,
    options: { query?: Query; body?: unknown } = {},
  ): Promise<XapiResponse> {
    const res = await this.exchange(method, path, options);
    return { status: res.status, body: this.scrubDeep(res.body, [res.token]) };
  }

  /** Drops the cached token (tests, credential changes). */
  forgetToken(): void {
    this.cached = null;
  }

  /** Sends with the shared token: a 401 renews it once, a short 429 is retried once. */
  private async exchange(method: string, path: string, options: XapiRequestOptions): Promise<Answer> {
    let renewed = false;
    let waited = false;
    for (;;) {
      const token = await this.token();
      const res = await this.send(method, path, options, token);
      if (res.status === 401 && !renewed) {
        // Another program (or a second panel process) took the token, or it expired early.
        renewed = true;
        this.dropToken(token);
        continue;
      }
      if (res.status === 429 && !waited) {
        const wait = retryAfterMs(res.retryAfter, this.now());
        if (wait !== null && wait <= this.rateLimitMaxWaitMs) {
          waited = true;
          await new Promise((resolve) => setTimeout(resolve, wait));
          continue;
        }
      }
      return res;
    }
  }

  private async send(
    method: string,
    path: string,
    options: XapiRequestOptions,
    token: string,
  ): Promise<Answer> {
    const url = this.url(path, options.query);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    };
    let body: string | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    return this.slots.run(async () => {
      let status: number;
      let text: string;
      let retryAfter: string | null;
      try {
        const response = await fetch(url, {
          method,
          headers,
          body,
          // Never follow a redirect: it could carry the token to another host.
          redirect: 'manual',
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        status = response.status;
        retryAfter = response.headers.get('retry-after');
        text = await response.text();
      } catch (err) {
        const what = options.action ? `${options.action} failed` : 'request failed';
        throw new ProviderError(PROVIDER, this.scrub(`${what}: ${causeOf(err)}`, [token]));
      }
      return { status, body: parseBody(text), retryAfter, token };
    });
  }

  private url(path: string, query?: Query): string {
    const url = new URL(`${this.baseUrl}${XAPI_PATH}${path.startsWith('/') ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  /** The shared access token: cached, one request at a time, fail-fast after a refusal. */
  private token(): Promise<string> {
    const now = this.now();
    if (this.cached && now < this.cached.expiresAt) return Promise.resolve(this.cached.accessToken);
    if (this.refused && now < this.refused.until) {
      const seconds = Math.ceil((this.refused.until - now) / 1000);
      return Promise.reject(
        signInError(
          `${this.refused.message} (failed recently, next attempt in ${seconds} s)`,
          this.refused.status,
        ),
      );
    }
    if (!this.pending) {
      const pending = this.slots.run(() => this.signIn());
      this.pending = pending;
      const clear = () => {
        if (this.pending === pending) this.pending = null;
      };
      pending.then(clear, clear);
    }
    return this.pending;
  }

  /** Forgets the token only when it is still the one that was refused (no renewal storms). */
  private dropToken(token: string) {
    if (this.cached?.accessToken === token) this.cached = null;
  }

  private async signIn(): Promise<string> {
    const startedAt = this.now();
    const form = new FormData();
    form.append('client_id', this.config.clientId);
    form.append('client_secret', this.config.clientSecret);
    form.append('grant_type', 'client_credentials');

    let status: number;
    let text: string;
    try {
      const response = await fetch(`${this.baseUrl}/connect/token`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: form,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.tokenTimeoutMs),
      });
      status = response.status;
      text = await response.text();
    } catch (err) {
      throw signInError(this.scrub(`sign-in at the phone system failed: ${causeOf(err)}`), null);
    }
    const body = parseBody(text);

    if (status >= 200 && status < 300) {
      const accessToken = isRecord(body) && typeof body.access_token === 'string' ? body.access_token : '';
      if (!accessToken) {
        throw signInError('sign-in at the phone system failed: the token answer has no access_token', status);
      }
      this.cached = {
        accessToken,
        expiresAt: startedAt + tokenLifetimeMs(isRecord(body) ? body.expires_in : null),
      };
      this.refused = null;
      return accessToken;
    }

    let reason: string;
    if (status >= 300 && status < 400) reason = 'the PBX redirects, check the address (https, port)';
    else {
      const oauth = isRecord(body) ? (str(body.error_description) ?? str(body.error)) : null;
      reason = oauth?.replace(/\.+$/, '') ?? `HTTP ${status}`;
    }
    const message = this.scrub(
      `sign-in at the phone system failed: ${reason}. Check the client ID and API key ` +
        '(3CX Admin > Integrations > API) and that "XAPI Access Enabled" is on',
    );
    // A refused sign-in is kept: every token request in the window fails without a new attempt.
    if (status >= 400 && status < 500) {
      this.refused = { message, status, until: this.now() + this.signInBackoffMs };
    }
    throw signInError(message, status);
  }

  /** Neither the client secret nor an access token ever leaves in a message. */
  private scrub(text: string, extra: string[] = []): string {
    let out = text;
    const secrets = [this.config.clientSecret, this.cached?.accessToken, ...extra];
    for (const secret of secrets) {
      if (!secret || secret.length < 4) continue;
      out = out.split(secret).join('[redacted]');
      const encoded = encodeURIComponent(secret);
      if (encoded !== secret) out = out.split(encoded).join('[redacted]');
    }
    return out;
  }

  private scrubDeep<T>(value: T, extra: string[] = []): T {
    if (typeof value === 'string') return this.scrub(value, extra) as T;
    if (Array.isArray(value)) return value.map((v) => this.scrubDeep(v, extra)) as T;
    if (!isRecord(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.scrubDeep(v, extra)])) as T;
  }
}

/** What a failed sign-in carries in details: the HTTP status of /connect/token. */
export interface SignInErrorDetails {
  signInStatus: number | null;
}

/**
 * A failed sign-in. It has no upstreamStatus, so it is never read as an XAPI answer (a 404 of
 * /connect/token is no unknown user, a 400 no invalid write): it surfaces as 502 with its hint.
 */
function signInError(message: string, status: number | null): ProviderError {
  return new ProviderError(PROVIDER, message, undefined, {
    signInStatus: status,
  } satisfies SignInErrorDetails);
}

function parseBody(text: string): unknown {
  if (!text) return '';
  try {
    return JSON.parse(text);
  } catch {
    // Keep the text: proxies and update pages answer with HTML.
    return text;
  }
}

/** Compares the first entries of two pages: by Id, else by the whole entry. */
function identity(value: unknown): string {
  if (isRecord(value) && value.Id !== undefined && value.Id !== null) return `id:${String(value.Id)}`;
  return JSON.stringify(value);
}
