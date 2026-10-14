import { fetch } from 'undici';
import { ProviderError } from '../../lib/errors';
import { isRecord } from '../http';
import type { UptimeKumaConfig } from '../types';

export const PROVIDER = 'Uptime Kuma';

const TIMEOUT_MS = 20_000;

const UNAUTHORIZED =
  'the API key was refused (HTTP 401). Check the key in Uptime Kuma under Settings > API Keys ' +
  '(active, not expired). Uptime Kuma also answers 401 when its limit of 60 API requests per ' +
  'minute is used up, e.g. by a Prometheus server scraping too often.';

export interface KumaHttpOptions {
  /** Default 20 s. */
  timeoutMs?: number;
}

export interface KumaHttpResponse {
  status: number;
  contentType: string | null;
  /** JSON when the answer parses as JSON, else the text. */
  body: unknown;
  text: string;
}

function isHtml(res: KumaHttpResponse): boolean {
  return /html/i.test(res.contentType ?? '') || /^\s*</.test(res.text);
}

/** ": <first 200 characters>" of a body that is not an HTML page, else nothing. */
function snippet(res: KumaHttpResponse): string {
  const text = res.text.trim();
  return text && !isHtml(res) ? `: ${text.slice(0, 200)}` : '';
}

/**
 * The HTTP side of Uptime Kuma: /metrics with an API key (HTTP Basic, the password is the key,
 * the user name is ignored) and the public status page JSON without credentials. Redirects are
 * never followed, so the key cannot be carried to another host.
 */
export class KumaHttpClient {
  /** Trimmed, no trailing slash. */
  readonly baseUrl: string;
  private readonly authorization: string;
  private readonly secrets: string[];
  private readonly timeoutMs: number;

  constructor(config: UptimeKumaConfig, options: KumaHttpOptions = {}) {
    this.baseUrl = config.baseUrl.trim().replace(/\/+$/, '');
    const basic = Buffer.from(`weblion:${config.apiKey}`).toString('base64');
    this.authorization = `Basic ${basic}`;
    this.secrets = [config.apiKey, basic, config.sessionToken ?? ''].filter((s) => s.length >= 4);
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  }

  /** GET /metrics with the API key. Returns the text. */
  async metrics(): Promise<string> {
    const res = await this.send('/metrics', true, 'text/plain');
    const { status } = res;
    if (status === 200) {
      if (!isHtml(res) && /# TYPE|monitor_|app_version/.test(res.text)) return res.text;
      throw this.error(
        'no Prometheus metrics in the answer, check the base URL (it must be the Uptime Kuma address without path)',
      );
    }
    if (status === 401) throw this.error(UNAUTHORIZED, 401);
    if (status >= 300 && status < 400) {
      throw this.error('the instance redirects, check the base URL (https, no path)', status);
    }
    let message = `GET /metrics failed: HTTP ${status}${snippet(res)}`;
    if (status === 403 || status === 404) {
      message += '. A reverse proxy in front of Uptime Kuma may block /metrics';
    }
    // A 404 here is no missing monitor: callers read upstream 404 as "not found in Kuma".
    throw this.error(message, status === 404 ? undefined : status);
  }

  /**
   * GET a public path (status pages, badges). No credentials are sent. Kuma's error body
   * { status: "fail", msg } becomes a ProviderError with that message (upstream 404 for 404).
   */
  async publicGet(path: string): Promise<KumaHttpResponse> {
    const res = await this.send(path, false, 'application/json');
    if (res.status >= 200 && res.status < 300) return res;
    if (res.status >= 300 && res.status < 400) {
      throw this.error(
        `GET ${path}: the instance redirects, check the base URL (https, no path)`,
        res.status,
      );
    }
    const msg =
      isRecord(res.body) && typeof res.body.msg === 'string' ? res.body.msg.trim().slice(0, 200) : '';
    const detail = msg ? `${msg} (HTTP ${res.status})` : `HTTP ${res.status}${snippet(res)}`;
    throw this.error(`GET ${path} failed: ${detail}`, res.status);
  }

  /** Any path, credentials only for /metrics. Only network errors throw. */
  async raw(method: 'GET', path: string): Promise<KumaHttpResponse> {
    const pathname = path.split('?')[0];
    return this.send(path, pathname === '/metrics', '*/*', method);
  }

  private async send(
    path: string,
    withKey: boolean,
    accept: string,
    method: 'GET' = 'GET',
  ): Promise<KumaHttpResponse> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const headers: Record<string, string> = { Accept: accept };
    if (withKey) headers.Authorization = this.authorization;
    let status: number;
    let contentType: string | null;
    let text: string;
    try {
      const response = await fetch(url, {
        method,
        headers,
        // Never follow a redirect: it could carry the API key to another host.
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      status = response.status;
      contentType = response.headers.get('content-type');
      text = await response.text();
    } catch (err) {
      const cause =
        err instanceof Error ? ((err.cause as Error | undefined)?.message ?? err.message) : String(err);
      throw this.error(`request failed: ${cause}`);
    }
    let body: unknown = text;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        // Keep the text: /metrics, badges (SVG) and proxies answer with text.
      }
    }
    return { status, contentType, body, text };
  }

  private error(message: string, upstreamStatus?: number): ProviderError {
    return new ProviderError(PROVIDER, this.scrub(message), upstreamStatus);
  }

  /** Neither the API key, its Basic header value nor the session token leave in a message. */
  scrub(text: string, extra: (string | null | undefined)[] = []): string {
    let out = text;
    for (const secret of [...this.secrets, ...extra]) {
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
}
