import { fetch } from 'undici';
import { ProviderError } from '../../lib/errors';
import { describeSeerrError, redactSeerr } from './parse';
import { SEERR } from './rules';

/** Seerr answers from its own database; a request that takes longer than this is not coming. */
export const SEERR_TIMEOUT_MS = 15_000;
/** Each GET /request also asks every Radarr and Sonarr for profiles: a few requests at a time. */
const MAX_IN_FLIGHT = 4;

export interface SeerrClientOptions {
  timeoutMs?: number;
  maxInFlight?: number;
}

export type SeerrQuery = Record<string, string | number | boolean | null | undefined>;

export interface SeerrRequestOptions {
  query?: SeerrQuery;
  /** Sent as application/json. */
  json?: unknown;
  /**
   * X-API-User: the request acts as this Seerr user instead of the owner. Only for creating a
   * user's own settings (design 19.4), where Seerr links the new settings row to the caller.
   */
  actAs?: number;
  /** What the request does, for messages ("set the access of Seerr user 7"). */
  action?: string;
  /** Values that must never show up in an error. */
  secrets?: (string | null | undefined)[];
}

export interface SeerrResponse {
  status: number;
  /** Parsed JSON (else the text, null when empty), values of secret keys already replaced. */
  body: unknown;
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
 * Seerr's REST API below `<address>/api/v1` with the API key from Seerr > Settings > General,
 * sent only in the X-Api-Key header. The key makes every request Seerr's owner (user 1, ADMIN):
 * it is in no message, no answer the client hands on and no URL. Redirects are never followed,
 * nothing is retried. Answers pass through `redactSeerr`, so keys and passwords in settings never
 * reach the callers.
 */
export class SeerrClient {
  /** The address as configured, trimmed, without trailing slash (without /api/v1). */
  readonly baseUrl: string;
  readonly timeoutMs: number;
  private readonly apiKey: string;
  private readonly slots: Limiter;

  constructor(url: string, apiKey: string, options: SeerrClientOptions = {}) {
    this.baseUrl = url.trim().replace(/\/+$/, '');
    this.apiKey = apiKey.trim();
    this.timeoutMs = options.timeoutMs ?? SEERR_TIMEOUT_MS;
    this.slots = new Limiter(options.maxInFlight ?? MAX_IN_FLIGHT);
  }

  /** 2xx: the parsed body (null when empty). Anything else: a ProviderError with Seerr's reason. */
  async request<T = unknown>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    options: SeerrRequestOptions = {},
  ): Promise<T> {
    const res = await this.raw(method, path, options);
    if (res.status >= 200 && res.status < 300) return res.body as T;
    throw this.failure(res, options);
  }

  /** The ProviderError for an answer that is not 2xx, Seerr's status as upstream status. */
  failure(res: SeerrResponse, options: SeerrRequestOptions = {}): ProviderError {
    const message = describeSeerrError(res, options.action, { actingAsUser: options.actAs !== undefined });
    return new ProviderError(SEERR, this.scrub(message, options.secrets), res.status);
  }

  /** Any request, the answer as it came (redacted). Only network failures and timeouts throw. */
  async raw(method: string, path: string, options: SeerrRequestOptions = {}): Promise<SeerrResponse> {
    const url = this.url(path, options.query);
    const headers: Record<string, string> = { Accept: 'application/json', 'X-Api-Key': this.apiKey };
    if (options.actAs !== undefined) headers['X-API-User'] = String(options.actAs);
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
        const text = await response.text();
        const parsed = parseBody(text, response.headers.get('content-type'));
        return { status: response.status, body: redactSeerr(parsed) };
      } catch (err) {
        const timedOut = err instanceof Error && err.name === 'TimeoutError';
        const cause = timedOut
          ? `no answer within ${this.timeoutMs >= 1000 ? `${Math.round(this.timeoutMs / 1000)} s` : `${this.timeoutMs} ms`}`
          : err instanceof Error
            ? ((err.cause as Error | undefined)?.message ?? err.message)
            : String(err);
        const what = options.action ? `${options.action} failed` : 'request failed';
        throw new ProviderError(SEERR, this.scrub(`${what}: ${cause}`, options.secrets));
      }
    });
  }

  /** `path` below /api/v1 ("/user"), the query appended without null values (empty strings kept). */
  private url(path: string, query?: SeerrQuery): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue;
      params.append(key, typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value));
    }
    const qs = params.toString();
    const target = `${this.baseUrl}/api/v1${path.startsWith('/') ? path : `/${path}`}`;
    return qs ? `${target}?${qs}` : target;
  }

  /** Replaces the API key (also URL-encoded) and `secrets` in a text, longest first. */
  scrub(text: string, secrets: (string | null | undefined)[] = []): string {
    const values = [this.apiKey, encodeURIComponent(this.apiKey), ...secrets]
      .filter((s): s is string => typeof s === 'string' && s.length > 0)
      .sort((a, b) => b.length - a.length);
    let out = text;
    for (const secret of values) out = out.split(secret).join('[redacted]');
    return out;
  }
}
