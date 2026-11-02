import WebSocket from 'ws';
import { AppError, ProviderError, providerRateLimited } from '../../lib/errors';
import { httpRequest, isRecord, num, str, type HttpResponse } from '../http';
import type { Fire24Config } from '../types';
import { FIRE24_DEFAULT_BASE_URL, fire24BaseUrl, fire24TokenKind } from './config';
import { FIRE24_ENDPOINTS, type Fire24EndpointName, type Fire24Scope } from './endpoints';

export const PROVIDER = '24fire';

/** A scope refused with 403 insufficient_scope is remembered this long (capabilities hide). */
const SCOPE_TTL_MS = 10 * 60_000;
/** A 429 is retried once when 24fire asks to wait at most this long. */
const RATE_LIMIT_MAX_WAIT_MS = 10_000;
/** Wait before that retry when the answer names no time (the spec documents no headers). */
const RATE_LIMIT_DEFAULT_WAIT_MS = 2000;
/** 200 pages of 25 = 5000 products, far beyond an account. Stops runaway loops. */
const MAX_PAGES = 200;
const READ_TIMEOUT_MS = 20_000;
/** Reinstall and backups answer slowly. */
const WRITE_TIMEOUT_MS = 45_000;

const LEGACY_KEY_MESSAGE =
  '24fire: the configured key is a key of the old API v2. Create a Personal Access Token (format ' +
  '123|cra_...) in the 24fire account settings and set it as FIRE24_API_KEY or in the connection.';
const REJECTED_MESSAGE =
  '24fire rejected the access token (401): it is wrong, expired or revoked. Create a new Personal ' +
  'Access Token in the 24fire account settings and set it as FIRE24_API_KEY or in the connection.';

/** Ids in paths: no separators, encodings or dot segments, so a request never leaves its resource. */
const UNSAFE_ID = /[/\\%?#]|\.\./;
const MAX_ID_LENGTH = 128;
/** DNS record ids are integers in the spec. */
const RECORD_ID = /^\d{1,12}$/;

export interface Fire24ClientOptions {
  /** Requests in flight at once per connection; the sync and the UI share them. */
  maxConcurrent?: number;
  rateLimitMaxWaitMs?: number;
  rateLimitDefaultWaitMs?: number;
  maxPages?: number;
}

/** Values for the placeholders of FIRE24_ENDPOINTS paths. */
export type Fire24PathParams = Partial<
  Record<'server' | 'domain' | 'webspace' | 'backup' | 'record' | 'sshKey', string>
>;

export interface Fire24CallOptions {
  /** Form body (POST, PUT, PATCH). */
  form?: Record<string, unknown>;
  query?: Record<string, unknown>;
}

export interface Fire24Meta {
  currentPage: number | null;
  perPage: number | null;
  total: number | null;
  lastPage: number | null;
}

export interface Fire24Answer {
  data: unknown;
  meta: Fire24Meta | null;
}

/**
 * HTTP client for the 24fire Customer REST API v1: Bearer token, the error envelope, the
 * required scope of every call, pagination, 429 handling, id checks and redaction. The adapter
 * only maps payloads. The token never appears in a message or a log.
 */
export class Fire24Client {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly maxConcurrent: number;
  private readonly rateLimitMaxWaitMs: number;
  private readonly rateLimitDefaultWaitMs: number;
  private readonly maxPages: number;
  /** Scopes 24fire refused, with the time the memory ends. */
  private readonly missing = new Map<Fire24Scope, number>();
  private inFlight = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(config: Fire24Config, options: Fire24ClientOptions = {}) {
    this.baseUrl = fire24BaseUrl(config.baseUrl || FIRE24_DEFAULT_BASE_URL);
    // fetch trims header values; the token check and the redaction use the same value.
    this.token = (config.apiKey ?? '').trim();
    this.maxConcurrent = options.maxConcurrent ?? 4;
    this.rateLimitMaxWaitMs = options.rateLimitMaxWaitMs ?? RATE_LIMIT_MAX_WAIT_MS;
    this.rateLimitDefaultWaitMs = options.rateLimitDefaultWaitMs ?? RATE_LIMIT_DEFAULT_WAIT_MS;
    this.maxPages = options.maxPages ?? MAX_PAGES;
  }

  // --- Learned scopes -------------------------------------------------------------

  /** True while 24fire refused this scope within the last 10 minutes. */
  scopeMissing(scope: Fire24Scope): boolean {
    const until = this.missing.get(scope);
    if (until === undefined) return false;
    if (until > Date.now()) return true;
    this.missing.delete(scope);
    return false;
  }

  missingScopes(): Fire24Scope[] {
    return [...this.missing.keys()].filter((scope) => this.scopeMissing(scope));
  }

  // --- Calls ----------------------------------------------------------------------

  /** One operation of the endpoint table. Throws the mapped error of section 1.4 of the design. */
  async call(
    name: Fire24EndpointName,
    params: Fire24PathParams = {},
    options: Fire24CallOptions = {},
  ): Promise<Fire24Answer> {
    const endpoint = FIRE24_ENDPOINTS[name];
    this.requireToken();
    const path = endpoint.path.replace(/\{(\w+)\}/g, (_, key: keyof Fire24PathParams) =>
      encodeURIComponent(checkId(key, params[key])),
    );
    const res = await this.withRetry(endpoint.method, this.url(path, options.query), options.form, true);
    const body = isRecord(res.body) ? res.body : null;
    if (res.status >= 400 || body?.status === 'error') throw this.toError(name, res);
    if (res.text.trim() !== '' && body === null && !Array.isArray(res.body)) {
      // HTML from a proxy or a wrong base URL, never a v1 answer.
      throw new ProviderError(PROVIDER, this.unexpected(res), res.status);
    }
    this.missing.delete(endpoint.scope);
    if (body === null) return { data: Array.isArray(res.body) ? res.body : null, meta: null };
    // Tolerant: an answer without the envelope is taken as the data itself.
    const data = 'data' in body || body.status === 'success' ? body.data : body;
    return { data, meta: parseMeta(body.meta) };
  }

  async data(name: Fire24EndpointName, params?: Fire24PathParams, options?: Fire24CallOptions) {
    return (await this.call(name, params, options)).data;
  }

  /** Page 1 of a list with its total (meta.total, else the length of the page). */
  async firstPage(
    name: Fire24EndpointName,
    query: Record<string, unknown> = {},
  ): Promise<{ items: Record<string, unknown>[]; total: number }> {
    const { data, meta } = await this.call(name, {}, { query: { ...query, page: 1 } });
    const items = pageItems(data);
    return { items, total: meta?.total ?? items.length };
  }

  /**
   * Every page of a list: page 1, then up to meta.last_page. Ends on an empty page, without
   * meta, or once current_page reaches last_page. Items are deduplicated by id, a later page wins.
   */
  async listAll(
    name: Fire24EndpointName,
    query: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>[]> {
    const byId = new Map<string, Record<string, unknown>>();
    const withoutId: Record<string, unknown>[] = [];
    for (let page = 1; ; page++) {
      if (page > this.maxPages) {
        const { method, path } = FIRE24_ENDPOINTS[name];
        throw new ProviderError(PROVIDER, `${method} ${path}: pagination did not end`);
      }
      const { data, meta } = await this.call(name, {}, { query: { ...query, page } });
      const items = pageItems(data);
      for (const item of items) {
        const id = str(item.id);
        if (id) byId.set(id, item);
        else withoutId.push(item);
      }
      if (items.length === 0 || !meta || meta.lastPage === null) break;
      if ((meta.currentPage ?? page) >= meta.lastPage) break;
    }
    return [...byId.values(), ...withoutId];
  }

  /**
   * Explorer access: the answer as 24fire sent it, errors included. The path (with query) is
   * already checked by the adapter. A throttled request is retried once like any other.
   */
  async raw(method: string, pathWithQuery: string, form?: Record<string, unknown>): Promise<HttpResponse> {
    this.requireToken();
    return this.withRetry(method, `${this.baseUrl}${pathWithQuery}`, form, false);
  }

  /**
   * Opens the noVNC websocket of a console session. The URL carries a one-time token: it is never
   * put into error messages, and the API token is not sent along.
   */
  openConsoleSocket(wssUrl: string): Promise<WebSocket> {
    let url: URL;
    try {
      url = new URL(wssUrl);
    } catch {
      return Promise.reject(new ProviderError(PROVIDER, 'the console session has an invalid address'));
    }
    if (url.protocol !== 'wss:' && url.protocol !== 'ws:') {
      return Promise.reject(new ProviderError(PROVIDER, 'the console session has no websocket address'));
    }
    const ws = new WebSocket(url, ['binary'], { handshakeTimeout: 15_000 });
    return new Promise((resolve, reject) => {
      ws.once('open', () => resolve(ws));
      ws.once('error', (err) => {
        const message = err.message.split(wssUrl).join('…').split(url.href).join('…');
        reject(new ProviderError(PROVIDER, `console websocket failed: ${this.redact(message)}`));
      });
      ws.once('unexpected-response', (_req, res) => {
        ws.terminate();
        reject(
          new ProviderError(
            PROVIDER,
            `console websocket rejected: HTTP ${res.statusCode} ${res.statusMessage ?? ''}`.trim(),
          ),
        );
      });
    });
  }

  /** The token never shows up in messages, even if an upstream echoes it. */
  redact(message: string): string {
    return this.token.length >= 4 ? message.split(this.token).join('***') : message;
  }

  // --- Internals ------------------------------------------------------------------

  /** A v2 key (no "|") would only earn a 401; say what to replace before sending anything. */
  private requireToken() {
    if (fire24TokenKind(this.token) === 'legacy')
      throw new AppError(502, 'provider_auth', LEGACY_KEY_MESSAGE);
  }

  private url(path: string, query?: Record<string, unknown>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) params.append(key, String(value));
    }
    const qs = params.toString();
    return `${this.baseUrl}${path}${qs ? `?${qs}` : ''}`;
  }

  /**
   * A throttled request was not processed, so it is retried once for every method when 24fire
   * asks for a short wait. `fail`: a second 429 (or a long wait) throws instead of returning it.
   */
  private async withRetry(
    method: string,
    url: string,
    form: Record<string, unknown> | undefined,
    fail: boolean,
  ): Promise<HttpResponse> {
    const first = await this.send(method, url, form);
    if (!isThrottled(first)) return first;
    const wait = retryAfterMs(first.headers) ?? this.rateLimitDefaultWaitMs;
    if (wait > this.rateLimitMaxWaitMs) {
      if (!fail) return first;
      throw providerRateLimited(PROVIDER, Math.ceil(wait / 1000));
    }
    await new Promise((resolve) => setTimeout(resolve, wait));
    const second = await this.send(method, url, form);
    if (!isThrottled(second) || !fail) return second;
    const again = retryAfterMs(second.headers);
    throw providerRateLimited(PROVIDER, again === null ? null : Math.ceil(again / 1000));
  }

  private async send(method: string, url: string, form?: Record<string, unknown>): Promise<HttpResponse> {
    await this.acquire();
    try {
      return await httpRequest(PROVIDER, {
        method,
        url,
        headers: { Authorization: `Bearer ${this.token}` },
        form,
        timeoutMs: method === 'GET' ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS,
      });
    } catch (err) {
      if (err instanceof ProviderError) {
        throw new ProviderError(
          PROVIDER,
          this.redact(err.message.replace(/^24fire: /, '')),
          err.upstreamStatus,
        );
      }
      throw err;
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.inFlight < this.maxConcurrent) {
      this.inFlight++;
      return;
    }
    // The releasing request hands its slot over, so inFlight stays the same.
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private release() {
    const next = this.waiting.shift();
    if (next) next();
    else this.inFlight--;
  }

  private unexpected(res: HttpResponse): string {
    let message = `unexpected answer (HTTP ${res.status})`;
    if (res.status === 404 && !/^https:\/\/api\.24fire\.de$/i.test(this.baseUrl)) {
      message += `, check the base URL ${this.baseUrl}`;
    }
    return message;
  }

  /** The error of a failed call, as in section 1.4 of the design. */
  private toError(name: Fire24EndpointName, res: HttpResponse): AppError {
    const endpoint = FIRE24_ENDPOINTS[name];
    const body = isRecord(res.body) ? res.body : null;
    const requestId = str(res.headers['x-request-id']);
    const extra = requestId ? { requestId } : {};
    if (res.status === 401 || body?.type === 'unauthorized') {
      return new AppError(502, 'provider_auth', REJECTED_MESSAGE, extra);
    }
    if (!body)
      return new ProviderError(PROVIDER, this.unexpected(res), res.status, requestId ? extra : undefined);

    const type = str(body.type);
    const message = this.redact((str(body.message) ?? `HTTP ${res.status}`).slice(0, 300));
    if (type === 'insufficient_scope') {
      // The scope comes from the table: the message only says "missing the required scope".
      this.missing.set(endpoint.scope, Date.now() + SCOPE_TTL_MS);
      return new AppError(
        502,
        'provider_scope_missing',
        `24fire: the access token lacks the scope "${endpoint.scope}". Add it to the token in the 24fire account settings.`,
        { scope: endpoint.scope, ...extra },
      );
    }
    // v1 documents no 24fire+ endpoints. Should 24fire still refuse one for the plan, say so.
    if (/24fire\s*(\+|plus)|\bplus\b/i.test(message)) {
      return new AppError(
        422,
        'plus_required',
        `24fire: this needs an active 24fire+ subscription on the provider account (${message})`,
        extra,
      );
    }
    if (type === 'validation_failed' || res.status === 422) {
      // Field names and 24fire's texts; the values are not echoed.
      const errors = isRecord(body.errors) ? body.errors : null;
      return new AppError(422, 'provider_validation', `24fire: ${message}`, { errors, ...extra });
    }
    if (type === 'dns_error') {
      return new AppError(422, 'dns_rejected', `24fire rejected the DNS record: ${message}`, extra);
    }
    if (res.status === 403) {
      return new ProviderError(
        PROVIDER,
        `refused access (the token's product allowlist may exclude this product): ${message}`,
        403,
        extra,
      );
    }
    if (type === 'upstream_error' || res.status === 502) {
      return new ProviderError(PROVIDER, `the 24fire backend failed: ${message}`, 502, extra);
    }
    return new ProviderError(PROVIDER, message, res.status, extra);
  }
}

/** Id for a path placeholder. A bad one is a 404 without a request. */
export function checkId(kind: string, value: unknown): string {
  const id = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  if (kind === 'record') {
    if (!RECORD_ID.test(id)) throw new ProviderError(PROVIDER, 'invalid DNS record id', 404);
    return id;
  }
  if (!id.trim() || id.length > MAX_ID_LENGTH || UNSAFE_ID.test(id) || /^\.+$/.test(id)) {
    throw new ProviderError(PROVIDER, `invalid ${kind} id`, 404);
  }
  return id;
}

function isThrottled(res: HttpResponse): boolean {
  return res.status === 429 || (isRecord(res.body) && res.body.type === 'too_many_requests');
}

/**
 * Milliseconds until 24fire takes requests again: `Retry-After` in seconds or as an HTTP date,
 * else `X-RateLimit-Reset` (epoch seconds, or seconds from now when small). Null when neither
 * is sent; the spec documents no rate limit headers.
 */
export function retryAfterMs(headers: Record<string, string>, now = Date.now()): number | null {
  const retryAfter = headers['retry-after']?.trim();
  if (retryAfter) {
    if (/^\d+(\.\d+)?$/.test(retryAfter)) return Math.round(Number(retryAfter) * 1000);
    const at = Date.parse(retryAfter);
    if (Number.isFinite(at)) return Math.max(0, at - now);
  }
  const reset = num(headers['x-ratelimit-reset']);
  if (reset !== null) return Math.max(0, reset > 1e9 ? reset * 1000 - now : reset * 1000);
  return null;
}

export function parseMeta(value: unknown): Fire24Meta | null {
  if (!isRecord(value)) return null;
  return {
    currentPage: num(value.current_page),
    perPage: num(value.per_page),
    total: num(value.total),
    lastPage: num(value.last_page),
  };
}

/** Entries of one list page: the documented array, or one under `data`/`items`. */
function pageItems(data: unknown): Record<string, unknown>[] {
  const list = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.data)
      ? data.data
      : isRecord(data) && Array.isArray(data.items)
        ? data.items
        : [];
  return list.filter(isRecord);
}
