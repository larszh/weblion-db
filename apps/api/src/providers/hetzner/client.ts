import { fetch } from 'undici';
import WebSocket from 'ws';
import { ProviderError } from '../../lib/errors';
import { isRecord, num, str } from '../http';
import type { HetznerConfig } from '../types';

export const PROVIDER = 'Hetzner';

/** Hetzner's maximum page size. */
const PER_PAGE = 50;
/** 50 pages of 50 = 2500 items, far beyond a project's limits. Stops runaway loops. */
const MAX_PAGES = 50;
/** A 429 is retried once when the next request is allowed within this time, else it fails. */
const RATE_LIMIT_MAX_WAIT_MS = 5000;

export type QueryValue = string | number | boolean | (string | number)[] | null | undefined;
export type Query = Record<string, QueryValue>;

export interface HetznerResponse {
  status: number;
  body: unknown;
  rateLimit: { limit: number | null; remaining: number | null; reset: number | null };
}

export interface HetznerClientOptions {
  timeoutMs?: number;
  rateLimitMaxWaitMs?: number;
}

export interface Pagination {
  page: number;
  per_page: number;
  previous_page: number | null;
  next_page: number | null;
  last_page: number | null;
  total_entries: number | null;
}

/**
 * Thin wrapper around the Hetzner Cloud API (JSON, bearer token, one project per token).
 * The rate limit is 3600 requests per hour and project, so callers keep requests few.
 */
export class HetznerClient {
  readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly rateLimitMaxWaitMs: number;

  constructor(
    private readonly config: HetznerConfig,
    options: HetznerClientOptions = {},
  ) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.rateLimitMaxWaitMs = options.rateLimitMaxWaitMs ?? RATE_LIMIT_MAX_WAIT_MS;
  }

  async request<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    options: { query?: Query; body?: unknown } = {},
  ): Promise<T> {
    const res = await this.raw(method, path, options);
    if (res.status >= 400) {
      const error = isRecord(res.body) && isRecord(res.body.error) ? res.body.error : null;
      throw new ProviderError(
        PROVIDER,
        this.redact(describeError(res)),
        res.status,
        error ? { code: str(error.code), details: error.details ?? null } : undefined,
      );
    }
    return res.body as T;
  }

  get<T = unknown>(path: string, query?: Query) {
    return this.request<T>('GET', path, { query });
  }
  post<T = unknown>(path: string, body?: unknown) {
    return this.request<T>('POST', path, { body });
  }
  put<T = unknown>(path: string, body?: unknown) {
    return this.request<T>('PUT', path, { body });
  }
  delete<T = unknown>(path: string) {
    return this.request<T>('DELETE', path);
  }

  /**
   * Sends a request and returns whatever Hetzner answered. On 429 it waits for the next
   * free request and retries once, but only if that is a few seconds away.
   */
  async raw(method: string, path: string, options: { query?: Query; body?: unknown } = {}) {
    const first = await this.send(method, path, options);
    if (first.status !== 429) return first;
    const wait = rateLimitWait(first, Date.now());
    if (wait === null || wait > this.rateLimitMaxWaitMs) return first;
    await new Promise((resolve) => setTimeout(resolve, wait));
    return this.send(method, path, options);
  }

  /** Fetches every page of a list endpoint. `key` is the list's property ("servers", "images"). */
  async list<T>(path: string, key: string, query: Query = {}): Promise<T[]> {
    const items: T[] = [];
    let page = 1;
    for (let i = 0; i < MAX_PAGES; i++) {
      const body = await this.get<Record<string, unknown>>(path, { ...query, page, per_page: PER_PAGE });
      const list = isRecord(body) && Array.isArray(body[key]) ? (body[key] as T[]) : [];
      items.push(...list);
      const next = num(pagination(body)?.next_page);
      if (!next || next <= page || list.length === 0) return items;
      page = next;
    }
    return items;
  }

  /** Number of entries of a list endpoint, read from the pagination of a one item page. */
  async count(path: string, key: string, query: Query = {}): Promise<number> {
    const body = await this.get<Record<string, unknown>>(path, { ...query, page: 1, per_page: 1 });
    const total = num(pagination(body)?.total_entries);
    if (total !== null) return total;
    return isRecord(body) && Array.isArray(body[key]) ? body[key].length : 0;
  }

  /**
   * Opens the VNC websocket from request_console. The URL carries a one-time token and is
   * never put into error messages. The API token is not sent along.
   */
  openConsoleSocket(wssUrl: string): Promise<WebSocket> {
    let url: URL;
    try {
      url = new URL(wssUrl);
    } catch {
      return Promise.reject(new ProviderError(PROVIDER, 'request_console returned an invalid console URL'));
    }
    if (url.protocol !== 'wss:' && url.protocol !== 'ws:') {
      return Promise.reject(new ProviderError(PROVIDER, 'request_console returned no websocket URL'));
    }
    const ws = new WebSocket(url, ['binary'], { handshakeTimeout: 15_000 });
    return new Promise((resolve, reject) => {
      ws.once('open', () => resolve(ws));
      ws.once('error', (err) => {
        const message = err.message.split(wssUrl).join('…').split(url.href).join('…');
        reject(new ProviderError(PROVIDER, `console websocket failed: ${message}`));
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

  private url(path: string, query?: Query): string {
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue;
      for (const v of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(v));
    }
    return url.toString();
  }

  private async send(
    method: string,
    path: string,
    options: { query?: Query; body?: unknown },
  ): Promise<HetznerResponse> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.config.apiToken}`,
    };
    let body: string | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    let text: string;
    let response;
    try {
      response = await fetch(this.url(path, options.query), {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      text = await response.text();
    } catch (err) {
      const cause =
        err instanceof Error ? ((err.cause as Error | undefined)?.message ?? err.message) : String(err);
      throw new ProviderError(PROVIDER, this.redact(`request failed: ${cause}`));
    }

    let parsed: unknown = text;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // Keep the text, proxies in front of the API answer with HTML.
      }
    }
    return {
      status: response.status,
      body: parsed,
      rateLimit: {
        limit: num(response.headers.get('ratelimit-limit')),
        remaining: num(response.headers.get('ratelimit-remaining')),
        reset: num(response.headers.get('ratelimit-reset')),
      },
    };
  }

  /** The token never shows up in messages, even if an upstream echoes it. */
  private redact(message: string): string {
    const token = this.config.apiToken;
    return token && token.length >= 4 ? message.split(token).join('***') : message;
  }
}

export function pagination(body: unknown): Pagination | null {
  if (!isRecord(body) || !isRecord(body.meta) || !isRecord(body.meta.pagination)) return null;
  return body.meta.pagination as unknown as Pagination;
}

/**
 * Milliseconds until the next request is allowed. RateLimit-Reset is when the limit is
 * full again, but it refills gradually (3600/h = one request per second), so the wait for
 * a single request is at most one refill interval.
 */
export function rateLimitWait(res: HetznerResponse, now: number): number | null {
  const { limit, reset } = res.rateLimit;
  const untilReset = reset !== null ? Math.max(0, reset * 1000 - now) : null;
  const perRequest = limit !== null && limit > 0 ? Math.ceil(3_600_000 / limit) : null;
  if (untilReset === null) return perRequest;
  return perRequest === null ? untilReset : Math.min(untilReset, perRequest);
}

function describeError(res: HetznerResponse): string {
  const error = isRecord(res.body) && isRecord(res.body.error) ? res.body.error : null;
  const code = str(error?.code) ?? (res.status === 429 ? 'rate_limit_exceeded' : `http_${res.status}`);
  let message =
    str(error?.message) ??
    (typeof res.body === 'string' && res.body.trim() && !res.body.trimStart().startsWith('<')
      ? res.body.trim().slice(0, 200)
      : `HTTP ${res.status}`);

  // invalid_input lists the offending fields.
  const fields = isRecord(error?.details) && Array.isArray(error.details.fields) ? error.details.fields : [];
  const fieldText = fields
    .filter(isRecord)
    .map((f) => `${str(f.name) ?? '?'}: ${Array.isArray(f.messages) ? f.messages.join(', ') : ''}`)
    .join('; ');
  if (fieldText) message += ` (${fieldText})`;

  if (res.status === 401) message += '. Check the API token (HETZNER_API_TOKEN)';
  else if (code === 'forbidden') message += '. The API token needs "Read & Write" permission';
  else if (code === 'locked')
    message += '. Another action is still running on this resource, try again shortly';
  else if (res.status === 429) {
    const { limit, reset } = res.rateLimit;
    message +=
      `. Hetzner allows ${limit ?? 3600} API requests per hour per project, ` +
      (reset ? `fully available again at ${new Date(reset * 1000).toISOString()}` : 'try again later');
  }
  return `${code}: ${message}`;
}
