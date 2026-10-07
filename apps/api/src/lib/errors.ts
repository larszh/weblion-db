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
