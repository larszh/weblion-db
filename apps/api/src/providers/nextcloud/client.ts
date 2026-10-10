import { fetch } from 'undici';
import { ProviderError } from '../../lib/errors';
import { isRecord } from '../http';
import type { NextcloudConfig } from '../types';
import { isOcsSuccess, parseEnvelope, type OcsMeta } from './parse';

export const PROVIDER = 'Nextcloud';

const TIMEOUT_MS = 30_000;
/** Nextcloud runs on PHP workers shared with the users, so the panel keeps a few requests at a time. */
const MAX_IN_FLIGHT = 4;
/** Base path of the OCS v2 API. v2 answers with real HTTP status codes, v1 always with 200. */
export const OCS_V2 = '/ocs/v2.php';

export type FormValue = string | number | boolean | null | undefined | (string | number)[];
export type Form = Record<string, FormValue>;
export type Query = Record<string, string | number | boolean | null | undefined>;

export interface NextcloudClientOptions {
  timeoutMs?: number;
  maxInFlight?: number;
}

export interface OcsRequestOptions {
  query?: Query;
  /** Sent as application/x-www-form-urlencoded, arrays as "key[]=a&key[]=b". */
  form?: Form;
  /** What the request does, for error messages ("create user anna@muster-ag"). */
  action?: string;
  /** Messages for OCS status codes Nextcloud answers without a message (editUser: 113). */
  codes?: Record<number, string>;
  /** Values that must never show up in an error, e.g. a password sent in the form. */
  secrets?: (string | null | undefined)[];
}

export interface NextcloudResponse {
  status: number;
  body: unknown;
}

/** Details of a ProviderError raised for an OCS failure. */
export interface OcsErrorDetails {
  statuscode: number | null;
}

/** The OCS status code of a failed request (e.g. 102 "user already exists"), else null. */
export function ocsStatus(err: unknown): number | null {
  if (!(err instanceof ProviderError) || !isRecord(err.details)) return null;
  const code = (err.details as Partial<OcsErrorDetails>).statuscode;
  return typeof code === 'number' ? code : null;
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

/** Form body as Nextcloud (PHP) reads it: arrays as repeated "key[]". */
export function toForm(values: Form): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) for (const v of value) params.append(`${key}[]`, String(v));
    else if (typeof value === 'boolean') params.append(key, value ? 'true' : 'false');
    else params.append(key, String(value));
  }
  return params;
}

/**
 * Nextcloud OCS API (provisioning_api and core): HTTP Basic auth with an admin account and
 * one of its app passwords, the OCS-APIRequest header (else Nextcloud answers 412 for CSRF)
 * and ?format=json. Answers are wrapped in {ocs: {meta: {status, statuscode, message}, data}}.
 */
export class NextcloudClient {
  readonly baseUrl: string;
  private readonly authorization: string;
  private readonly timeoutMs: number;
  private readonly slots: Limiter;

  constructor(
    private readonly config: NextcloudConfig,
    options: NextcloudClientOptions = {},
  ) {
    this.baseUrl = config.baseUrl.trim().replace(/\/+$/, '');
    this.authorization = `Basic ${Buffer.from(`${config.username}:${config.appPassword}`).toString('base64')}`;
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
    this.slots = new Limiter(options.maxInFlight ?? MAX_IN_FLIGHT);
  }

  /**
   * Sends an OCS v2 request (`path` below /ocs/v2.php, e.g. "/cloud/users") and returns
   * `ocs.data`. Anything but success becomes a ProviderError with Nextcloud's message and
   * OCS status code (details.statuscode).
   */
  async ocs<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    options: OcsRequestOptions = {},
  ): Promise<T> {
    const res = await this.raw(method, `${OCS_V2}${path}`, options);
    const envelope = parseEnvelope(res.body);
    if (res.status >= 200 && res.status < 300 && envelope && isOcsSuccess(envelope.meta)) {
      return envelope.data as T;
    }
    const meta = envelope?.meta ?? { status: null, statuscode: null, message: null };
    const message = describeFailure(res, envelope !== null, meta, options, this.config.username);
    throw new ProviderError(PROVIDER, this.scrub(message, options.secrets), res.status, {
      statuscode: meta.statuscode,
    } satisfies OcsErrorDetails);
  }

  /**
   * Sends a request to any path of the instance (`path` from the root, e.g.
   * "/ocs/v2.php/cloud/users") and returns whatever came back, failures included. Only
   * network failures throw.
   */
  async raw(method: string, path: string, options: OcsRequestOptions = {}): Promise<NextcloudResponse> {
    const url = this.url(path, options.query);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'OCS-APIRequest': 'true',
      Authorization: this.authorization,
    };
    let body: string | undefined;
    if (options.form && Object.keys(options.form).length > 0) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = toForm(options.form).toString();
    }

    return this.slots.run(async () => {
      let status: number;
      let text: string;
      try {
        const response = await fetch(url, {
          method,
          headers,
          body,
          // Never follow a redirect: it could carry the credentials to another host.
          redirect: 'manual',
          signal: AbortSignal.timeout(this.timeoutMs),
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
          // Keep the text: proxies and maintenance pages answer with HTML.
        }
      }
      return { status, body: parsed };
    });
  }

  private url(path: string, query?: Query): string {
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
    if (!url.searchParams.has('format')) url.searchParams.set('format', 'json');
    return url.toString();
  }

  /** Neither the app password nor values sent along (a new password) leave in a message. */
  private scrub(text: string, extra: (string | null | undefined)[] = []): string {
    let out = text;
    const basic = this.authorization.slice('Basic '.length);
    for (const secret of [this.config.appPassword, basic, ...extra]) {
      if (secret && secret.length >= 4) out = out.split(secret).join('[redacted]');
    }
    return out;
  }
}

function describeFailure(
  res: NextcloudResponse,
  isOcs: boolean,
  meta: OcsMeta,
  options: OcsRequestOptions,
  username: string,
): string {
  const code = meta.statuscode;
  let message = meta.message;
  if (!message && code !== null) message = options.codes?.[code] ?? null;
  if (!message && typeof res.body === 'string') {
    const text = res.body.trim();
    if (text && !text.startsWith('<')) message = text.slice(0, 200);
  }
  if (!message && isOcs) message = 'refused without a message';
  if (!message) message = res.status < 300 ? 'no OCS answer, check the base URL' : 'no OCS answer';

  const where = [code !== null ? `OCS ${code}` : null, `HTTP ${res.status}`].filter(Boolean).join(', ');
  let out = `${options.action ? `${options.action} failed: ` : ''}${message} (${where})`;
  if (res.status === 401) {
    out += `. Wrong user name or app password: check the app password of "${username}" (Nextcloud: Personal settings > Security > Devices & sessions)`;
  } else if (res.status === 403) {
    out += `. The account "${username}" must be a Nextcloud admin (member of the "admin" group)`;
  } else if (res.status === 429) {
    out += '. Nextcloud throttles this client after failed logins, try again later';
  } else if (res.status === 503) {
    out += '. Nextcloud may be in maintenance mode';
  } else if (res.status >= 300 && res.status < 400) {
    out += '. The instance redirects, check the base URL (https, path of the installation)';
  }
  return out;
}
