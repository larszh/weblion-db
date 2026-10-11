import { fetch } from 'undici';
import { ProviderError } from '../../lib/errors';
import { isRecord, num } from '../http';
import type { CloudflareConfig } from '../types';
import { CLOUDFLARE_PROVIDER as PROVIDER, CLOUDFLARE_TOKEN_PERMISSIONS } from './constants';

const TIMEOUT_MS = 30_000;
/** Cloudflare has no documented concurrency limit; a few at a time keeps bursts small. */
const MAX_IN_FLIGHT = 4;
/**
 * Cloudflare allows 1200 requests per 5 minutes per user, shared by every token, script and
 * dashboard session of that user. The panel keeps each connection below 1000.
 */
const BUDGET = { max: 1000, windowMs: 300_000 };
/** A full budget or a 429 is waited out when the next request is allowed within this time. */
const RATE_LIMIT_MAX_WAIT_MS = 5000;
/** Codes of a 400 for an Authorization header Cloudflare cannot read (malformed token). */
const TOKEN_FORMAT_CODES = new Set([6003, 6111]);
/**
 * Codes of a 403 Cloudflare answers both for a token without the needed permission and for
 * one it no longer accepts (UNVERIFIED list).
 */
const AUTH_CODES = new Set([9109, 10000]);
/** Purge requests have their own plan-dependent limit. */
const PURGE_RATE_LIMIT = 1134;

export type QueryValue = string | number | boolean | (string | number)[] | null | undefined;
export type Query = Record<string, QueryValue>;
export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface CloudflareClientOptions {
  timeoutMs?: number;
  maxInFlight?: number;
  /** Requests per sliding window and connection, retries included. */
  budget?: { max: number; windowMs: number };
  rateLimitMaxWaitMs?: number;
}

export interface CfMessage {
  code: number;
  message: string;
  documentation_url?: string;
  source?: { pointer?: string };
  error_chain?: CfMessage[];
}

export interface CfResultInfo {
  page?: number;
  per_page?: number;
  count?: number;
  total_count?: number;
  total_pages?: number;
}

export interface CfEnvelope<T> {
  success: boolean;
  errors: CfMessage[];
  messages: CfMessage[];
  result: T;
  result_info?: CfResultInfo;
}

/** Details of a ProviderError raised for a Cloudflare failure. */
export interface CfErrorDetails {
  codes: number[];
  errors: { code: number; message: string }[];
}

export interface CloudflareResponse {
  status: number;
  body: unknown;
  /** Seconds from the Retry-After header, null when missing or unreadable. */
  retryAfter: number | null;
}

export interface CfRequestOptions {
  query?: Query;
  body?: unknown;
  /** What the request does, for error messages ("list zones"). */
  action?: string;
}

/** Cloudflare error codes of a failed request (e.g. 1061 "already exists"), else []. */
export function cloudflareCodes(err: unknown): number[] {
  if (!(err instanceof ProviderError) || !isRecord(err.details)) return [];
  const codes = (err.details as Partial<CfErrorDetails>).codes;
  return Array.isArray(codes) ? codes.filter((c): c is number => typeof c === 'number') : [];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

/**
 * Sliding window of request times. A full window is waited out when its oldest request
 * leaves it soon enough, otherwise the request fails before it reaches Cloudflare.
 */
class RequestBudget {
  private readonly sent: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly maxWaitMs: number,
  ) {}

  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      while (this.sent.length > 0 && now - this.sent[0]! >= this.windowMs) this.sent.shift();
      if (this.sent.length < this.max) {
        this.sent.push(now);
        return;
      }
      const wait = this.sent[0]! + this.windowMs - now;
      if (wait > this.maxWaitMs) {
        throw new ProviderError(
          PROVIDER,
          "the panel paused requests to stay below Cloudflare's limit of 1200 requests per 5 minutes, " +
            `try again in ${Math.ceil(wait / 1000)} s`,
          429,
        );
      }
      await sleep(wait);
    }
  }
}

function joinList(items: string[]): string {
  return items.length > 1
    ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
    : items.join('');
}

function isMessage(value: unknown): value is CfMessage {
  return isRecord(value) && (typeof value.message === 'string' || typeof value.code === 'number');
}

/** "message (code)", chained errors appended as " > message (code)". */
function formatMessage(m: CfMessage): string {
  const text = typeof m.message === 'string' && m.message.trim() ? m.message.trim() : 'error';
  let out = typeof m.code === 'number' ? `${text} (${m.code})` : text;
  for (const chained of Array.isArray(m.error_chain) ? m.error_chain.filter(isMessage) : []) {
    out += ` > ${formatMessage(chained)}`;
  }
  return out;
}

function collectCodes(messages: CfMessage[], out: { code: number; message: string }[] = []) {
  for (const m of messages) {
    if (typeof m.code === 'number') out.push({ code: m.code, message: String(m.message ?? '') });
    if (Array.isArray(m.error_chain)) collectCodes(m.error_chain.filter(isMessage), out);
  }
  return out;
}

/** The answer when it has Cloudflare's envelope ({ success, errors, result }), else null. */
function envelopeOf(body: unknown): CfEnvelope<unknown> | null {
  if (!isRecord(body) || typeof body.success !== 'boolean') return null;
  return {
    success: body.success,
    errors: Array.isArray(body.errors) ? body.errors.filter(isMessage) : [],
    messages: Array.isArray(body.messages) ? body.messages.filter(isMessage) : [],
    result: body.result,
    result_info: isRecord(body.result_info) ? (body.result_info as CfResultInfo) : undefined,
  };
}

function describeFailure(res: CloudflareResponse, envelope: CfEnvelope<unknown> | null, action: string) {
  const errors = envelope?.errors ?? [];
  const codes = collectCodes(errors).map((e) => e.code);
  let message: string;
  if (errors.length > 0) {
    message = `${errors.map(formatMessage).join('; ')} (HTTP ${res.status})`;
  } else if (typeof res.body === 'string' && res.body.trim() && !res.body.trimStart().startsWith('<')) {
    message = `${res.body.trim().slice(0, 200)} (HTTP ${res.status})`;
  } else if (res.status >= 200 && res.status < 300) {
    message = envelope
      ? `refused without a message (HTTP ${res.status})`
      : `no Cloudflare API answer, check the base URL (HTTP ${res.status})`;
  } else {
    // Edge error pages (502, 52x) are HTML: never shown.
    message = `HTTP ${res.status}`;
  }

  let out = `${action} failed: ${message}`;
  if (res.status === 401 || (res.status === 400 && codes.some((c) => TOKEN_FORMAT_CODES.has(c)))) {
    out += '. Check the API token (CLOUDFLARE_API_TOKEN): revoked, expired or mistyped';
  } else if (res.status === 403) {
    // A valid token without the permission gets the same 9109/10000 as a revoked one.
    const lacks = codes.some((c) => AUTH_CODES.has(c))
      ? 'The API token lacks a permission for this, or it was revoked or expired (CLOUDFLARE_API_TOKEN)'
      : 'The API token lacks a permission for this';
    out += `. ${lacks}. The panel needs ${joinList(CLOUDFLARE_TOKEN_PERMISSIONS)} on all zones of the account`;
  } else if (res.status === 429) {
    const after = res.retryAfter !== null ? `retry after ${res.retryAfter} s` : 'try again in a few minutes';
    out += codes.includes(PURGE_RATE_LIMIT)
      ? `. Cloudflare limits cache purges per zone and plan; ${after}`
      : `. Cloudflare allows 1200 API requests per 5 minutes per user; ${after}`;
  } else if (res.status >= 500) {
    out += '. Cloudflare API not available right now';
  } else if (res.status >= 300 && res.status < 400) {
    out += '. The API redirects, check the base URL';
  }
  return { message: out, details: { codes, errors: collectCodes(errors) } satisfies CfErrorDetails };
}

/**
 * Cloudflare API v4: JSON with a bearer token. Answers come in an envelope
 * { success, errors, messages, result, result_info }; failures are HTTP 4xx, but a few
 * endpoints (purge) answer 200 with success false. Requests per connection are limited by
 * a sliding window budget and a concurrency limit, see BUDGET.
 */
export class CloudflareClient {
  readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly rateLimitMaxWaitMs: number;
  private readonly slots: Limiter;
  private readonly budget: RequestBudget;

  constructor(
    private readonly config: CloudflareConfig,
    options: CloudflareClientOptions = {},
  ) {
    this.baseUrl = config.baseUrl.trim().replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
    this.rateLimitMaxWaitMs = options.rateLimitMaxWaitMs ?? RATE_LIMIT_MAX_WAIT_MS;
    this.slots = new Limiter(options.maxInFlight ?? MAX_IN_FLIGHT);
    const budget = options.budget ?? BUDGET;
    this.budget = new RequestBudget(budget.max, budget.windowMs, this.rateLimitMaxWaitMs);
  }

  /** Unwraps `result`. Throws ProviderError for HTTP >= 300 or success === false. */
  async request<T = unknown>(method: Method, path: string, options: CfRequestOptions = {}): Promise<T> {
    return (await this.requestEnvelope<T>(method, path, options)).result;
  }

  /** Same, plus result_info. */
  async requestEnvelope<T = unknown>(
    method: Method,
    path: string,
    options: CfRequestOptions = {},
  ): Promise<CfEnvelope<T>> {
    const res = await this.exchange(method, path, options);
    const envelope = envelopeOf(res.body);
    if (res.status >= 200 && res.status < 300 && envelope?.success === true) {
      return envelope as CfEnvelope<T>;
    }
    const { message, details } = describeFailure(res, envelope, options.action ?? 'request');
    throw new ProviderError(PROVIDER, this.redact(message), res.status, details);
  }

  /**
   * Every page of a list endpoint: continues while the page was not empty and
   * result_info.total_pages says more follow, at most `maxPages` pages.
   */
  async list<T>(
    path: string,
    options: { query?: Query; perPage: number; maxPages: number; action?: string },
  ): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; page <= options.maxPages; page++) {
      const envelope = await this.requestEnvelope<T[]>('GET', path, {
        query: { ...options.query, page, per_page: options.perPage },
        action: options.action,
      });
      const list = Array.isArray(envelope.result) ? envelope.result : [];
      items.push(...list);
      const info = envelope.result_info;
      const totalPages = num(info?.total_pages);
      const answeredPage = num(info?.page);
      if (list.length === 0) break;
      // A page other than the one asked for: the endpoint ignores paging, stop instead of looping.
      if (answeredPage !== null && answeredPage !== page) break;
      if (totalPages !== null ? page >= totalPages : list.length < options.perPage) break;
    }
    return items;
  }

  /** Whatever came back, failures included (explorer). Only network errors and the budget throw. */
  async raw(method: string, path: string, options: { query?: Query; body?: unknown } = {}) {
    const res = await this.exchange(method, path, options);
    return { status: res.status, body: res.body };
  }

  /** The token (also URL encoded) never leaves in a message, even if an upstream echoes it. */
  redact(text: string): string {
    let out = text;
    const token = this.config.apiToken;
    if (token && token.length >= 4) {
      for (const form of new Set([token, encodeURIComponent(token)])) {
        out = out.split(form).join('[redacted]');
      }
    }
    return out;
  }

  /** One request; a 429 is retried once when Retry-After asks for a short wait. */
  private async exchange(
    method: string,
    path: string,
    options: CfRequestOptions,
  ): Promise<CloudflareResponse> {
    const first = await this.send(method, path, options);
    if (first.status !== 429 || first.retryAfter === null) return first;
    const wait = first.retryAfter * 1000;
    if (wait > this.rateLimitMaxWaitMs) return first;
    await sleep(wait);
    return this.send(method, path, options);
  }

  private url(path: string, query?: Query): string {
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue;
      for (const v of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(v));
    }
    return url.toString();
  }

  private send(method: string, path: string, options: CfRequestOptions): Promise<CloudflareResponse> {
    const url = this.url(path, options.query);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.config.apiToken}`,
    };
    let body: string | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    return this.slots.run(async () => {
      // Every attempt counts against the budget, retries included.
      await this.budget.take();
      let status: number;
      let retryAfter: number | null;
      let text: string;
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
        const after = num(response.headers.get('retry-after'));
        retryAfter = after !== null && after >= 0 ? Math.ceil(after) : null;
        text = await response.text();
      } catch (err) {
        const cause =
          err instanceof Error ? ((err.cause as Error | undefined)?.message ?? err.message) : String(err);
        throw new ProviderError(PROVIDER, this.redact(`${options.action ?? 'request'} failed: ${cause}`));
      }
      let parsed: unknown = text;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          // Keep the text: the edge answers 5xx and 52x with HTML pages.
        }
      }
      return { status, body: parsed, retryAfter };
    });
  }
}
