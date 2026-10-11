import { fetch } from 'undici';
import { AppError, ProviderError } from '../../lib/errors';
import { isRecord, str } from '../http';
import type { MailcowConfig } from '../types';
import {
  PROVIDER,
  entriesOf,
  mailcowError,
  mailcowMessage,
  parseWriteResult,
  type MailcowEntry,
} from './parse';

export { PROVIDER };

const TIMEOUT_MS = 30_000;
/** Creating a domain with restart_sogo waits for the SOGo container to come back. */
export const SOGO_RESTART_TIMEOUT_MS = 120_000;
/** Mailcow's PHP workers also serve webmail and the Mailcow UI, so the panel keeps a few requests at a time. */
const MAX_IN_FLIGHT = 4;

export interface MailcowClientOptions {
  timeoutMs?: number;
  maxInFlight?: number;
}

export interface MailcowResponse {
  status: number;
  body: unknown;
}

export interface MailcowWriteResult {
  entries: MailcowEntry[];
  /** Texts of warning entries, e.g. a failed SOGo restart. */
  warnings: string[];
}

export interface MailcowWriteOptions {
  /** What the request does, for messages ("create mailbox anna@kunde.ch"). */
  action: string;
  /** Values that must never show up in an error, e.g. a password sent in the body. */
  secrets?: (string | null | undefined)[];
  timeoutMs?: number;
}

interface SendOptions {
  action?: string;
  secrets?: (string | null | undefined)[];
  timeoutMs?: number;
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

/**
 * Mailcow API (json_api.php): an API key in X-API-Key, reads with GET below /api/v1/get/,
 * writes with POST and a JSON body below /api/v1/add|edit|delete/. Business failures of writes
 * come with HTTP 200 as a list of entries ({type: "danger", msg: [...]}); transport failures
 * (key, IP, method, route) as {type: "error", msg} with a 4xx status. Nothing is retried: Mailcow
 * counts a 401 as a failed login and bans the source IP after a few.
 */
export class MailcowClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly slots: Limiter;

  constructor(
    private readonly config: MailcowConfig,
    options: MailcowClientOptions = {},
  ) {
    this.baseUrl = config.baseUrl.trim().replace(/\/+$/, '');
    this.apiKey = config.apiKey.trim();
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
    this.slots = new Limiter(options.maxInFlight ?? MAX_IN_FLIGHT);
  }

  /** GET below /api/v1/get/ and the JSON body. HTTP failures become a ProviderError (404 for 404). */
  async get<T = unknown>(path: string, action: string): Promise<T> {
    const res = await this.send('GET', path, undefined, { action });
    const failed =
      res.status < 200 ||
      res.status >= 300 ||
      typeof res.body === 'string' ||
      (isRecord(res.body) && (res.body.type === 'error' || res.body.type === 'danger'));
    if (failed) throw this.failure(res, action);
    return res.body as T;
  }

  /**
   * POST of an add, edit or delete with a JSON body. Fails when Mailcow reports any danger or
   * error entry (see mailcowError for the status) or answers something that is not Mailcow's.
   */
  async write(path: string, body: unknown, options: MailcowWriteOptions): Promise<MailcowWriteResult> {
    const res = await this.send('POST', path, body, options);
    if (res.status < 200 || res.status >= 300) throw this.failure(res, options.action, options.secrets);
    const entries = entriesOf(res.body);
    if (entries.length === 0) throw this.failure(res, options.action, options.secrets);
    const result = parseWriteResult(res.body, res.status);
    if (!result.ok) {
      throw this.scrubError(mailcowError(options.action, result.errors, result.successes), options.secrets);
    }
    return { entries, warnings: result.warnings.map((w) => this.scrub(w, options.secrets)) };
  }

  /** Any request, the answer as it came (API explorer). Only network failures throw. */
  async raw(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    secrets?: (string | null | undefined)[],
  ): Promise<MailcowResponse> {
    return this.send(method, path, body, { secrets });
  }

  private async send(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    options: SendOptions,
  ): Promise<MailcowResponse> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    // Exactly these headers: a Sec-Fetch-Dest other than "empty" makes Mailcow answer 403.
    const headers: Record<string, string> = { Accept: 'application/json', 'X-API-Key': this.apiKey };
    let payload: string | undefined;
    if (method === 'POST') {
      // Without this content type Mailcow reads form fields and finds no attributes.
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body ?? {});
    }

    return this.slots.run(async () => {
      let status: number;
      let text: string;
      try {
        const response = await fetch(url, {
          method,
          headers,
          body: payload,
          // Never follow a redirect: it could carry the API key to another host.
          redirect: 'manual',
          signal: AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs),
        });
        status = response.status;
        text = await response.text();
      } catch (err) {
        const cause =
          err instanceof Error ? ((err.cause as Error | undefined)?.message ?? err.message) : String(err);
        const what = options.action ? `${options.action} failed` : 'request failed';
        throw new ProviderError(PROVIDER, this.scrub(`${what}: ${cause}`, options.secrets));
      }
      let parsed: unknown = text;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          // Keep the text: PHP fatal errors and proxies answer with HTML or plain text.
        }
      }
      return { status, body: parsed };
    });
  }

  private failure(res: MailcowResponse, action: string, secrets?: (string | null | undefined)[]) {
    const upstream = res.status >= 200 && res.status < 300 ? undefined : res.status;
    return new ProviderError(PROVIDER, this.scrub(describeFailure(res, action), secrets), upstream);
  }

  /** The API key and values sent along (a new password) never leave in a message. */
  scrub(text: string, extra: (string | null | undefined)[] = []): string {
    let out = text;
    for (const secret of [this.config.apiKey, this.apiKey, ...extra]) {
      if (secret && secret.length >= 4) out = out.split(secret).join('[redacted]');
    }
    return out;
  }

  /** Strings at any depth scrubbed like messages (explorer answers). */
  scrubValue<T>(value: T, extra: (string | null | undefined)[] = []): T {
    if (typeof value === 'string') return this.scrub(value, extra) as T;
    if (Array.isArray(value)) return value.map((v) => this.scrubValue(v, extra)) as T;
    if (!isRecord(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) out[this.scrub(key, extra)] = this.scrubValue(v, extra);
    return out as T;
  }

  private scrubError(err: AppError, secrets?: (string | null | undefined)[]): AppError {
    err.message = this.scrub(err.message, secrets);
    if (isRecord(err.details) && Array.isArray(err.details.keys)) {
      err.details.keys = err.details.keys.map((k) => (typeof k === 'string' ? this.scrub(k, secrets) : k));
    }
    return err;
  }
}

/** The msg of a transport error ({type: "error", msg}), or of the first entry of a list. */
function answerMessage(body: unknown): string | null {
  if (typeof body === 'string') {
    const text = body.trim();
    return text && !text.startsWith('<') ? text.slice(0, 200) : null;
  }
  const entry = entriesOf(body)[0];
  if (!entry) return null;
  if (typeof entry.msg === 'string') return str(entry.msg);
  const [key, ...args] = entry.msg;
  return mailcowMessage(
    String(key ?? ''),
    args.map((a) => String(a)),
  );
}

/** "<action> failed: <message> (HTTP <status>)" plus what the operator can do about it. */
export function describeFailure(res: MailcowResponse, action: string): string {
  const { status } = res;
  const msg = answerMessage(res.body);
  let message = msg;
  if (!message) {
    if (status >= 200 && status < 300) message = 'no Mailcow answer, check the base URL';
    else if (status >= 300 && status < 400) message = 'redirect';
    else message = 'no Mailcow answer';
  }
  let out = `${action} failed: ${message} (HTTP ${status})`;
  const lower = (msg ?? '').toLowerCase();
  if (status === 401) {
    const ip = /api access denied for ip\s+(\S+)/i.exec(msg ?? '')?.[1];
    if (ip) out += `. Add ${ip} to the API key's allow list in Mailcow`;
    else if (lower === 'authentication failed') {
      out +=
        ". Mailcow does not know this API key (MAILCOW_API_KEY or the provider's key). " +
        "Repeated failures make Mailcow's netfilter ban the console's IP";
    } else out += ". Repeated failures make Mailcow's netfilter ban the console's IP";
  } else if (status === 403 && lower.includes('read/write access denied')) {
    out += '. The API key is read-only; the console needs the read-write key';
  } else if (status === 404 && lower === 'route not found') {
    out += '. This Mailcow version does not know the endpoint; update Mailcow';
  } else if (status === 405) {
    out += '. Wrong HTTP method for this endpoint';
  } else if (status >= 300 && status < 400) {
    out += '. Mailcow redirects, check the base URL (https, no path)';
  }
  return out;
}
