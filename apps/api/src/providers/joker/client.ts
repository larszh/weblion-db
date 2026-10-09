import { ProviderError } from '../../lib/errors';
import { httpRequest } from '../http';
import type { JokerConfig } from '../types';
import { headerValue, parseReply, replyFailure, statusCode, type DmapiReply } from './parse';

const PROVIDER = 'Joker';
const TIMEOUT_MS = 30_000;
/** Joker allows only a few parallel requests per account. */
const MAX_IN_FLIGHT = 3;
/** DMAPI status code for a missing, expired or invalid session. */
const AUTH_ERROR = 2200;

export type DmapiParams = Record<string, string | number | boolean | null | undefined>;

export interface DmapiResponse extends DmapiReply {
  httpStatus: number;
}

export interface DmapiClientOptions {
  timeoutMs?: number;
  maxInFlight?: number;
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

function isAuthFailure(res: DmapiResponse): boolean {
  return res.httpStatus === 401 || statusCode(res) === AUTH_ERROR;
}

/**
 * Joker.com DMAPI: form-encoded POSTs to `<baseUrl>/<request>`, plain text replies. Every
 * request except login carries the session id (auth-sid). The session is kept, shared by
 * concurrent callers and renewed once when Joker reports it as expired.
 */
export class DmapiClient {
  private readonly baseUrl: string;
  private readonly slots: Limiter;
  private sid: string | null = null;
  /** Recent session ids, kept only to scrub them from error messages. */
  private readonly recentSids: string[] = [];
  private loginPending: Promise<DmapiResponse> | null = null;

  constructor(
    private readonly config: JokerConfig,
    private readonly options: DmapiClientOptions = {},
  ) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.slots = new Limiter(options.maxInFlight ?? MAX_IN_FLIGHT);
  }

  /** Logs in (again) and keeps the new session. Concurrent callers share one login. */
  login(): Promise<DmapiResponse> {
    this.loginPending ??= this.doLogin().finally(() => {
      this.loginPending = null;
    });
    return this.loginPending;
  }

  /** Sends a request and throws a ProviderError for anything but success. */
  async call(request: string, params: DmapiParams = {}): Promise<DmapiResponse> {
    const res = await this.raw(request, params);
    const failure = replyFailure(res.httpStatus, res);
    if (failure) {
      throw new ProviderError(PROVIDER, this.scrub(`${request} failed: ${failure}`), res.httpStatus, {
        statusCode: statusCode(res),
        trackingId: headerValue(res, 'Tracking-Id'),
      });
    }
    return res;
  }

  /** Sends a request with the session and returns the reply as it is, failures included. */
  async raw(request: string, params: DmapiParams = {}): Promise<DmapiResponse> {
    const sid = await this.session();
    const res = await this.exchange(request, { ...params, 'auth-sid': sid });
    if (!isAuthFailure(res)) return res;
    // Joker ended the session (timeout after an hour of inactivity, or invalidated): log in
    // again once and retry once. Callers that fail at the same time share the new login.
    if (this.sid === sid) this.sid = null;
    const fresh = await this.session();
    return this.exchange(request, { ...params, 'auth-sid': fresh });
  }

  private async session(): Promise<string> {
    if (this.sid) return this.sid;
    const res = await this.login();
    return headerValue(res, 'Auth-SID')!;
  }

  private credentials(): DmapiParams {
    if (this.config.apiKey) return { 'api-key': this.config.apiKey };
    if (this.config.username && this.config.password) {
      return { username: this.config.username, password: this.config.password };
    }
    throw new ProviderError(PROVIDER, 'no API key or username and password configured');
  }

  private async doLogin(): Promise<DmapiResponse> {
    const res = await this.exchange('login', this.credentials());
    const failure = replyFailure(res.httpStatus, res);
    if (failure) {
      const what = this.config.apiKey ? 'the API key' : 'username and password';
      throw new ProviderError(
        PROVIDER,
        this.scrub(`login failed: ${failure}. Check ${what} of the Joker.com reseller account.`),
        res.httpStatus,
      );
    }
    const sid = headerValue(res, 'Auth-SID');
    if (!sid) throw new ProviderError(PROVIDER, 'login returned no session id (Auth-SID)');
    this.sid = sid;
    this.recentSids.unshift(sid);
    this.recentSids.length = Math.min(this.recentSids.length, 3);
    return res;
  }

  private async exchange(request: string, params: DmapiParams): Promise<DmapiResponse> {
    const res = await this.slots.run(() =>
      httpRequest(PROVIDER, {
        method: 'POST',
        url: `${this.baseUrl}/${encodeURIComponent(request)}`,
        headers: { Accept: 'text/plain' },
        // In the body, so neither the key nor the session id ends up in access logs.
        form: params,
        timeoutMs: this.options.timeoutMs ?? TIMEOUT_MS,
      }),
    );
    return { httpStatus: res.status, ...parseReply(res.text) };
  }

  /** Joker might echo a parameter in an error; credentials never leave in a message. */
  private scrub(text: string): string {
    let out = text;
    for (const secret of [this.config.apiKey, this.config.password, ...this.recentSids]) {
      if (secret && secret.length >= 4) out = out.split(secret).join('[redacted]');
    }
    return out;
  }
}
