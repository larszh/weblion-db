import { fetch } from 'undici';
import { ProviderError } from '../../lib/errors';
import { isRecord } from '../http';
import type { JellyfinConfig } from '../types';
import { describeJellyfinError } from './parse';
import { JELLYFIN } from './rules';

export { JELLYFIN as PROVIDER } from './rules';

const TIMEOUT_MS = 30_000;
/** Jellyfin serves streams and transcodes on the same process: the console keeps a few requests at a time. */
const MAX_IN_FLIGHT = 4;

export interface JellyfinClientOptions {
  timeoutMs?: number;
  maxInFlight?: number;
}

export type Query = Record<string, string | number | boolean | null | undefined>;

export interface JellyfinRequestOptions {
  query?: Query;
  /** Sent as application/json. */
  json?: unknown;
  /** What the request does, for messages ("create user anna-kemaro"). */
  action?: string;
  /** Values that must never show up in an error, e.g. a password sent in the body. */
  secrets?: (string | null | undefined)[];
}

export interface JellyfinResponse {
  status: number;
  body: unknown;
  contentType: string | null;
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

/** JSON when the server says so or the text looks like it; else the text. Empty: null. */
function parseBody(text: string, contentType: string | null): unknown {
  if (!text) return null;
  const json = /^application\/(problem\+)?json\b/i.test(contentType ?? '') || /^\s*[{["]/.test(text);
  if (!json) return text;
  try {
    return JSON.parse(text);
  } catch {
    // Keep the text: proxies and maintenance pages answer with HTML or plain text.
    return text;
  }
}

/**
 * Jellyfin's REST API with an API key from Dashboard > API Keys, sent only in the
 * Authorization header ("MediaBrowser" scheme). X-Emby-Token, X-MediaBrowser-Token and the
 * api_key query are legacy (off by default from 10.12) and would put the key into logs.
 * Answers are PascalCase JSON. Redirects are never followed and nothing is retried.
 */
export class JellyfinClient {
  /** Trimmed, without trailing slash, with Jellyfin's base URL path if one is set. */
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly authorization: string;
  private readonly timeoutMs: number;
  private readonly slots: Limiter;

  constructor(config: JellyfinConfig, options: JellyfinClientOptions = {}) {
    this.baseUrl = config.baseUrl.trim().replace(/\/+$/, '');
    this.apiKey = config.apiKey.trim();
    this.authorization = `MediaBrowser Token="${this.apiKey}"`;
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
    this.slots = new Limiter(options.maxInFlight ?? MAX_IN_FLIGHT);
  }

  /** 2xx: the parsed body (null for 204). Anything else: a ProviderError with Jellyfin's reason. */
  async request<T = unknown>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    options: JellyfinRequestOptions = {},
  ): Promise<T> {
    const res = await this.raw(method, path, options);
    if (res.status >= 200 && res.status < 300) return res.body as T;
    throw new ProviderError(
      JELLYFIN,
      this.scrub(describeJellyfinError(res, options.action), options.secrets),
      res.status,
    );
  }

  /** Any request, the answer as it came (explorer). Only network failures and timeouts throw. */
  async raw(method: string, path: string, options: JellyfinRequestOptions = {}): Promise<JellyfinResponse> {
    const url = this.url(path, options.query);
    const headers: Record<string, string> = { Accept: 'application/json', Authorization: this.authorization };
    let body: string | undefined;
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.json);
    }

    return this.slots.run(async () => {
      try {
        const response = await fetch(url, {
          method,
          headers,
          body,
          // Never follow a redirect: the API key would travel along to wherever it points.
          redirect: 'manual',
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const contentType = response.headers.get('content-type');
        const text = await response.text();
        return { status: response.status, body: parseBody(text, contentType), contentType };
      } catch (err) {
        const timedOut = err instanceof Error && err.name === 'TimeoutError';
        const cause = timedOut
          ? `no answer within ${this.timeoutMs >= 1000 ? `${Math.round(this.timeoutMs / 1000)} s` : `${this.timeoutMs} ms`}`
          : err instanceof Error
            ? ((err.cause as Error | undefined)?.message ?? err.message)
            : String(err);
        const what = options.action ? `${options.action} failed` : 'request failed';
        throw new ProviderError(JELLYFIN, this.scrub(`${what}: ${cause}`, options.secrets));
      }
    });
  }

  /** `path` below the base URL ("/Users"), the query appended without null values. */
  private url(path: string, query?: Query): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue;
      params.append(key, typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value));
    }
    const qs = params.toString();
    const target = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    return qs ? `${target}${target.includes('?') ? '&' : '?'}${qs}` : target;
  }

  /** Replaces the API key and `secrets` in a text (longest first). */
  scrub(text: string, secrets: (string | null | undefined)[] = []): string {
    const values = [this.apiKey, ...secrets]
      .filter((s): s is string => typeof s === 'string' && s.length > 0)
      .sort((a, b) => b.length - a.length);
    let out = text;
    for (const secret of values) out = out.split(secret).join('[redacted]');
    return out;
  }

  /** Strings and keys at any depth scrubbed like messages (explorer answers). */
  scrubValue(value: unknown, secrets: (string | null | undefined)[] = []): unknown {
    if (typeof value === 'string') return this.scrub(value, secrets);
    if (Array.isArray(value)) return value.map((v) => this.scrubValue(v, secrets));
    if (!isRecord(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) out[this.scrub(key, secrets)] = this.scrubValue(v, secrets);
    return out;
  }
}
