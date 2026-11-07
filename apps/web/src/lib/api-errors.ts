import {
  AI_ERROR_CODES,
  I18N_ERROR_CODES,
  isLocale,
  type I18nParams,
  type Locale,
  type TranslationJobErrorCode,
  type TranslationKey,
} from '@weblion/shared';
import { ApiError, errorMessage } from './api';
import { formatDate } from './format';
import type { TFunction } from './i18n';

/**
 * Error texts in the UI language (i18n 7, plan O25). API messages are the public API contract and stay
 * English (plan decision 7), so only what the console knows is translated: network failures, every AI and
 * i18n code of plan 2.10, and the generic codes, whose default messages say nothing the translated text does
 * not. Everything else (bad_request, conflict, provider_error, module codes) keeps the API's message.
 */

const GENERIC: Record<string, TranslationKey> = {
  unauthorized: 'error.unauthorized',
  forbidden: 'error.forbidden',
  not_found: 'error.not_found',
  rate_limited: 'error.rate_limited',
  internal_error: 'error.internal_error',
};

const AI_CODES: ReadonlySet<string> = new Set(AI_ERROR_CODES);
const I18N_CODES: ReadonlySet<string> = new Set(I18N_ERROR_CODES);

/** ai_org_disabled -> orgDisabled: the code without "ai_", in camel case (plan 2.10). */
export function aiErrorCamel(code: string): string {
  return code.replace(/^ai_/, '').replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * The keys to try for an AI code, most specific first: ai_limit names its kind (ai.error.limit.budget), the
 * other codes their reason when such a key exists (ai.error.upstream.<reason>), then the plain key.
 */
export function aiErrorKeys(code: string, details: unknown): string[] {
  const camel = aiErrorCamel(code);
  const d = (details && typeof details === 'object' ? details : {}) as Record<string, unknown>;
  const detail = code === 'ai_limit' ? d.limit : d.reason;
  const keys = typeof detail === 'string' && detail ? [`ai.error.${camel}.${detail}`] : [];
  // ai_limit has no plain key: a kind without a text keeps the API message (rule 5).
  keys.push(`ai.error.${camel}`);
  return keys;
}

/** The key of a Mass Translate job error (translation_jobs.error.code, plan 2.6). */
export function translationJobErrorKey(code: TranslationJobErrorCode): TranslationKey {
  return code === 'ai_budget_job' ? 'admin.i18n.job.budgetJob' : `admin.i18n.job.error.${code}`;
}

/** The UI language for dates in error texts: the provider keeps html[lang] in sync with it. */
function documentLocale(): Locale {
  try {
    const lang = typeof document === 'undefined' ? null : document.documentElement.lang;
    return isLocale(lang) ? lang : 'en';
  } catch {
    return 'en';
  }
}

/** The details of an error as interpolation parameters: lists joined, empty lists as "-" (i18n 7 rule 3). */
function detailParams(details: unknown): I18nParams {
  const params: I18nParams = {};
  if (!details || typeof details !== 'object' || Array.isArray(details)) return params;
  for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
    if (typeof value === 'string' || typeof value === 'number') params[key] = value;
    else if (Array.isArray(value)) params[key] = value.length ? value.map(String).join(', ') : '-';
  }
  const retry = (details as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  if (typeof retry === 'number') params.seconds = retry;
  const resets = (details as { resetsAt?: unknown }).resetsAt;
  if (typeof resets === 'string') params.date = formatDate(resets, documentLocale());
  return params;
}

/** The text of a key when the dictionary on screen has it (keys built at runtime may not exist). */
function lookup(t: TFunction, key: string, params: I18nParams): string | null {
  const text = t(key as TranslationKey, params);
  return text === key ? null : text;
}

/** Text for an error in the UI language: translated for known codes, the API's English message otherwise. */
export function localizeError(err: unknown, t: TFunction): string {
  // 1. No response at all: fetch rejects with a TypeError.
  if (err instanceof TypeError) return t('error.network');
  if (err instanceof ApiError) {
    const params = detailParams(err.details);
    // 2. AI codes (ai 4.2).
    if (AI_CODES.has(err.code) || err.code.startsWith('ai_')) {
      for (const key of aiErrorKeys(err.code, err.details)) {
        const text = lookup(t, key, params);
        if (text) return text;
      }
    }
    // 3. i18n codes (i18n 11.4), with their reason first when it has a text (forbidden_character.pdf).
    if (I18N_CODES.has(err.code)) {
      const reason = (err.details as { reason?: unknown } | null | undefined)?.reason;
      const keys = typeof reason === 'string' && reason ? [`admin.i18n.error.${err.code}.${reason}`] : [];
      keys.push(`admin.i18n.error.${err.code}`);
      for (const key of keys) {
        const text = lookup(t, key, params);
        if (text) return text;
      }
    }
    // 4. Generic codes, whatever the message says; a proxy page (no JSON body) in front of the API.
    const generic = GENERIC[err.code];
    if (generic) return t(generic);
    if (err.code === 'error' && (err.status === 502 || err.status === 503 || err.status === 504)) {
      return t('error.unavailable');
    }
  }
  // 5. Everything else: the API's English message, as before.
  return errorMessage(err);
}
