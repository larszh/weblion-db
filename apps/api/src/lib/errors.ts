export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Authentication required') =>
  new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'You are not allowed to do this') =>
  new AppError(403, 'forbidden', message);
export const notFound = (what = 'Resource') => new AppError(404, 'not_found', `${what} not found`);
export const conflict = (message: string) => new AppError(409, 'conflict', message);
export const locked = (message: string) => new AppError(423, 'locked', message);
export const unsupported = (message: string) => new AppError(422, 'unsupported', message);
/** The license of a phone system allows no more users (3CX). */
export const phoneUserLimit = (message: string, details?: unknown) =>
  new AppError(409, 'phone_user_limit', message, details);
/** A monitoring allowance has no free monitor left, or would fall below what is committed. */
export const monitorLimit = (message: string, details?: unknown) =>
  new AppError(409, 'monitor_limit', message, details);

/**
 * The provider's access token lacks a scope the call needs (24fire Personal Access Tokens).
 * 502 like other provider failures; `details.scope` names the scope so callers can hide features.
 */
export const providerScopeMissing = (provider: string, scope: string) =>
  new AppError(
    502,
    'provider_scope_missing',
    `${provider}: the access token lacks the scope "${scope}". Add it to the token at the provider.`,
    { scope },
  );
export const isScopeMissing = (err: unknown): err is AppError =>
  err instanceof AppError && err.code === 'provider_scope_missing';
/** The provider still throttled after the client waited and retried. */
export const providerRateLimited = (provider: string, retryAfterSeconds: number | null) =>
  new AppError(
    429,
    'provider_rate_limited',
    `${provider}: too many requests${retryAfterSeconds ? `, try again in ${retryAfterSeconds} s` : ''}`,
    { retryAfterSeconds },
  );

/** An upstream provider API failed. Surfaced as 502 so clients can tell it apart from our own bugs. */
export class ProviderError extends AppError {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly upstreamStatus?: number,
    details?: unknown,
  ) {
    super(upstreamStatus === 404 ? 404 : 502, 'provider_error', `${provider}: ${message}`, details);
    this.name = 'ProviderError';
  }
}
