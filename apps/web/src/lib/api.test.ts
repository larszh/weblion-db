import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './api';

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
});
