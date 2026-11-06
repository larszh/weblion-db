import type { ApiErrorBody } from '@weblion/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Query parameters of a GET: undefined, null and '' are left out. */
export type ApiQuery = Record<string, string | number | boolean | undefined | null>;

/** The URL of an API route, for request() and for links to GET routes (exports, the chat stream). */
export function apiUrl(path: string, query?: ApiQuery): string {
  const url = `/api/v1${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

/** Required by the API for cookie authenticated writes (CSRF protection). */
export const WRITE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'X-Requested-With': 'weblion-console',
});

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

/**
 * A non-2xx answer as ApiError. Callers that read the body themselves (the chat stream) use it too, so
 * every error looks the same: the code and message of the API, or for an error page of a proxy in between
 * (502, 504) the status with code 'error'. A 401 outside /auth/ calls the unauthorized handler.
 */
export async function apiErrorFromResponse(res: Response, path: string): Promise<ApiError> {
  const text = await res.text().catch(() => '');
  let data: unknown = null;
  try {
    data = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    // No JSON: a proxy page. Its status still says what happened.
  }
  const err = data && typeof data === 'object' ? (data as Partial<ApiErrorBody>).error : undefined;
  if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.();
  return new ApiError(res.status, err?.code ?? 'error', err?.message ?? res.statusText, err?.details);
}

async function request<T>(method: string, path: string, body?: unknown, query?: ApiQuery): Promise<T> {
  const res = await fetch(apiUrl(path, query), {
    method,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...WRITE_HEADERS,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await apiErrorFromResponse(res, path);
  const text = await res.text();
  // A successful answer that is no JSON is a bug somewhere in between, so the SyntaxError is thrown.
  return (text ? (JSON.parse(text) as unknown) : null) as T;
}

export const api = {
  get: <T>(path: string, query?: ApiQuery) => request<T>('GET', path, undefined, query),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string, body?: unknown, query?: ApiQuery) => request<T>('DELETE', path, body, query),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (Array.isArray(err.details) && err.details.length > 0) {
      const first = err.details[0] as { path?: string; message?: string };
      if (first?.message) return `${err.message}: ${first.path ? `${first.path} ` : ''}${first.message}`;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
