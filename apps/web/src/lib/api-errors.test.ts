import { describe, expect, it } from 'vitest';
import {
  AI_ERROR_CODES,
  AI_LIMIT_KINDS,
  I18N_ERROR_CODES,
  interpolate,
  TRANSLATION_JOB_ERROR_CODES,
  type TranslationKey,
} from '@weblion/shared';
import { de } from '@weblion/shared/i18n/de';
import { en } from '@weblion/shared/i18n/en';
import { ApiError } from './api';
import { aiErrorKeys, localizeError, translationJobErrorKey } from './api-errors';
import type { TFunction } from './i18n';

const tFor =
  (dict: Record<string, string>): TFunction =>
  (key: TranslationKey, params) =>
    interpolate(dict[key] ?? key, params);
const tDe = tFor(de);
const tEn = tFor(en);

describe('localizeError (i18n 7)', () => {
  it('rule 1: no response at all is a network error', () => {
    expect(localizeError(new TypeError('Failed to fetch'), tDe)).toBe(de['error.network']);
    expect(localizeError(new TypeError('NetworkError when attempting to fetch resource.'), tEn)).toBe(
      en['error.network'],
    );
  });

  it('rule 2: AI codes, ai_limit by its kind', () => {
    const limit = new ApiError(429, 'ai_limit', 'The monthly AI budget is used up.', {
      limit: 'budget',
      retryAfterSeconds: null,
      resetsAt: '2026-12-01T00:00:00.000Z',
    });
    expect(localizeError(limit, tDe)).toBe(de['ai.error.limit.budget']);
    expect(localizeError(limit, tEn)).toBe(en['ai.error.limit.budget']);
    const rate = new ApiError(429, 'ai_limit', 'x', { limit: 'user_rate', retryAfterSeconds: 30 });
    expect(localizeError(rate, tDe)).toBe(de['ai.error.limit.user_rate']);
    expect(localizeError(new ApiError(403, 'ai_org_disabled', 'x', { reasons: ['declined'] }), tDe)).toBe(
      de['ai.error.orgDisabled'],
    );
    expect(localizeError(new ApiError(502, 'ai_upstream', 'x', { reason: 'billing' }), tEn)).toBe(
      en['ai.error.upstream'],
    );
    expect(localizeError(new ApiError(409, 'ai_not_configured', 'x', { reason: 'feature_off' }), tDe)).toBe(
      de['ai.error.notConfigured'],
    );
  });

  it('rule 2: a kind without a text keeps the API message', () => {
    const odd = new ApiError(429, 'ai_limit', 'Some new limit', { limit: 'galaxy' });
    expect(localizeError(odd, tDe)).toBe('Some new limit');
    expect(localizeError(new ApiError(400, 'ai_something_new', 'Later code'), tDe)).toBe('Later code');
  });

  it('rule 3: i18n codes with their details', () => {
    const mismatch = new ApiError(400, 'placeholder_mismatch', 'x', { missing: ['name', 'org'], extra: [] });
    expect(localizeError(mismatch, tDe)).toBe(
      interpolate(de['admin.i18n.error.placeholder_mismatch'], { missing: 'name, org', extra: '-' }),
    );
    expect(localizeError(mismatch, tEn)).toContain('Missing: name, org. Extra: -.');
    expect(localizeError(new ApiError(409, 'job_running', 'x', { jobId: 'j1' }), tEn)).toBe(
      en['admin.i18n.error.job_running'],
    );
  });

  it('rule 4: generic codes, whatever the API message says', () => {
    expect(localizeError(new ApiError(401, 'unauthorized', 'Authentication required'), tDe)).toBe(
      de['error.unauthorized'],
    );
    expect(localizeError(new ApiError(403, 'forbidden', 'You are not allowed to do this'), tDe)).toBe(
      de['error.forbidden'],
    );
    expect(localizeError(new ApiError(404, 'not_found', 'Server not found'), tEn)).toBe(
      en['error.not_found'],
    );
    expect(localizeError(new ApiError(429, 'rate_limited', 'Rate limit exceeded'), tDe)).toBe(
      de['error.rate_limited'],
    );
    expect(localizeError(new ApiError(500, 'internal_error', 'Internal error'), tDe)).toBe(
      de['error.internal_error'],
    );
    // A proxy page in front of the API: no JSON body, so the code is 'error'.
    for (const status of [502, 503, 504]) {
      expect(localizeError(new ApiError(status, 'error', 'Bad Gateway'), tDe)).toBe(de['error.unavailable']);
    }
    expect(localizeError(new ApiError(500, 'error', 'Internal Server Error'), tDe)).toBe(
      'Internal Server Error',
    );
  });

  it('rule 5: every other code keeps the English API message', () => {
    expect(localizeError(new ApiError(409, 'conflict', 'This person is already a member'), tDe)).toBe(
      'This person is already a member',
    );
    expect(
      localizeError(
        new ApiError(400, 'bad_request', 'Validation failed', [{ path: 'email', message: 'Invalid email' }]),
        tDe,
      ),
    ).toBe('Validation failed: email Invalid email');
    expect(localizeError(new ApiError(409, 'monitor_limit', 'No monitor left'), tDe)).toBe('No monitor left');
    expect(localizeError(new Error('Something broke'), tDe)).toBe('Something broke');
  });
});

describe('every frozen code of plan 2.10 has a text in de and en', () => {
  const has = (key: string) => key in de && key in en;

  it('AI codes', () => {
    for (const code of AI_ERROR_CODES) {
      if (code === 'ai_limit') {
        for (const kind of AI_LIMIT_KINDS)
          expect(has(aiErrorKeys(code, { limit: kind })[0]!), kind).toBe(true);
      } else {
        expect(has(aiErrorKeys(code, null).at(-1)!), code).toBe(true);
      }
    }
  });

  it('i18n codes', () => {
    for (const code of I18N_ERROR_CODES) expect(has(`admin.i18n.error.${code}`), code).toBe(true);
  });

  it('job error codes', () => {
    for (const code of TRANSLATION_JOB_ERROR_CODES)
      expect(has(translationJobErrorKey(code)), code).toBe(true);
  });

  it('generic codes', () => {
    for (const key of [
      'error.network',
      'error.unauthorized',
      'error.forbidden',
      'error.not_found',
      'error.rate_limited',
      'error.internal_error',
      'error.unavailable',
    ]) {
      expect(has(key), key).toBe(true);
    }
  });

  it('every code is translated, not passed through as the API message', () => {
    for (const code of I18N_ERROR_CODES) {
      const err = new ApiError(400, code, 'ENGLISH', { missing: [], extra: [] });
      expect(localizeError(err, tDe), code).not.toBe('ENGLISH');
    }
    for (const code of AI_ERROR_CODES) {
      const err = new ApiError(400, code, 'ENGLISH', { limit: 'budget' });
      expect(localizeError(err, tDe), code).not.toBe('ENGLISH');
    }
  });
});
