import { fetch, type Dispatcher } from 'undici';
import { ProviderError } from '../lib/errors';

export interface HttpRequestOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
  /** Sent as application/x-www-form-urlencoded, which both 24fire and Proxmox accept. */
  form?: Record<string, unknown>;
  dispatcher?: Dispatcher;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  body: unknown;
  text: string;
}

export function toForm(values: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'boolean') params.append(key, value ? '1' : '0');
    else params.append(key, String(value));
  }
  return params;
}

export async function httpRequest(provider: string, options: HttpRequestOptions): Promise<HttpResponse> {
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  let body: string | undefined;
  if (options.form && Object.keys(options.form).length > 0) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = toForm(options.form).toString();
  }

  let response;
  try {
    response = await fetch(options.url, {
      method: options.method,
      headers,
      body,
      dispatcher: options.dispatcher,
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    });
  } catch (err) {
    const cause =
      err instanceof Error ? ((err.cause as Error | undefined)?.message ?? err.message) : String(err);
    throw new ProviderError(provider, `request failed: ${cause}`);
  }

  const text = await response.text();
  let parsed: unknown = text;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Keep the raw text, some endpoints answer with plain strings.
    }
  }
  return { status: response.status, statusText: response.statusText, body: parsed, text };
}

/** Runs async work over a list with bounded concurrency. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
