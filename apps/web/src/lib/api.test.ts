import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, WRITE_HEADERS, api, apiErrorFromResponse, apiUrl, setUnauthorizedHandler } from './api';

function answer(status: number, body: string, statusText = '') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body, { status, statusText })),
  );
}

describe('api', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('turns an error of the API into an ApiError', async () => {
    answer(
      409,
      JSON.stringify({ error: { code: 'exists', message: 'taken', details: { field: 'domain' } } }),
    );
    await expect(api.post('/x', {})).rejects.toMatchObject({
      status: 409,
      code: 'exists',
      message: 'taken',
      details: { field: 'domain' },
    });
  });

  it('keeps the status of an error page that is no JSON (a proxy in between)', async () => {
    answer(504, '<html><body>504 Gateway Time-out</body></html>', 'Gateway Timeout');
    const err = await api.post('/orgs/1/websites', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 504, code: 'error', message: 'Gateway Timeout' });
  });

  it('still refuses a successful answer that is no JSON', async () => {
    answer(200, '<html></html>');
    await expect(api.get('/x')).rejects.toBeInstanceOf(SyntaxError);
  });

  it('sends the CSRF header with every request', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await api.put('/x', { a: 1 });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toMatchObject({ ...WRITE_HEADERS, 'Content-Type': 'application/json' });
    expect(WRITE_HEADERS).toEqual({ 'X-Requested-With': 'weblion-console' });
  });
});

describe('apiUrl', () => {
  it('prefixes the API path and leaves empty parameters out', () => {
    expect(apiUrl('/orgs/1/ai/chat')).toBe('/api/v1/orgs/1/ai/chat');
    expect(apiUrl('/x', { a: 'b c', n: 2, t: true, e: '', u: undefined, z: null })).toBe(
      '/api/v1/x?a=b+c&n=2&t=true',
    );
    expect(apiUrl('/x', { e: '' })).toBe('/api/v1/x');
  });
});

describe('apiErrorFromResponse', () => {
  afterEach(() => {
    setUnauthorizedHandler(() => {});
  });

  it('reads the code, message and details of the API', async () => {
    const res = new Response(
      JSON.stringify({ error: { code: 'ai_limit', message: 'limit', details: { limit: 'budget' } } }),
      { status: 429 },
    );
    const err = await apiErrorFromResponse(res, '/orgs/1/ai/chat');
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 429,
      code: 'ai_limit',
      message: 'limit',
      details: { limit: 'budget' },
    });
  });

  it('keeps the status of a proxy page and calls the unauthorized handler outside /auth/', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    const proxy = await apiErrorFromResponse(
      new Response('<html>502</html>', { status: 502, statusText: 'Bad Gateway' }),
      '/x',
    );
    expect(proxy).toMatchObject({ status: 502, code: 'error', message: 'Bad Gateway' });
    expect(handler).not.toHaveBeenCalled();
    await apiErrorFromResponse(new Response('', { status: 401 }), '/auth/login');
    expect(handler).not.toHaveBeenCalled();
    await apiErrorFromResponse(new Response('', { status: 401 }), '/orgs/1/ai/chat');
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
