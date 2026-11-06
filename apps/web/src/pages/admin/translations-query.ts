import { isLocale, type Locale, type TranslationEntriesQuery, type TranslationFilter } from '@weblion/shared';
import { SECTIONS } from '@weblion/shared/i18n/sections/index';

/**
 * The URL query of /admin/translations (i18n 17.1, plan 2.9): every parameter is optional, unknown values fall
 * back to the default, and the defaults are left out of the URL, so a link reproduces a view. Other pages link
 * with plain URLs, for example the KI page's notice `?tab=entries&q=ai.notice.text`.
 */

export const TRANSLATIONS_TABS = ['overview', 'entries', 'glossary', 'jobs', 'transfer'] as const;
export type TranslationsTab = (typeof TRANSLATIONS_TABS)[number];

export const TRANSLATION_FILTERS: readonly TranslationFilter[] = [
  'all',
  'untranslated',
  'stale',
  'changed',
  'ai',
  'unreviewed',
  'attention',
];

export interface TranslationsQuery extends Omit<TranslationEntriesQuery, 'pageSize' | 'keys'> {
  tab: TranslationsTab;
  /** Job detail open in the jobs tab. */
  job?: string;
  /** Comma list of keys (from a job's failures). */
  keys?: string;
}

/** At most this many keys in the URL (A3 takes 500). */
export const MAX_QUERY_KEYS = 500;

const AREA = /^[a-z][a-z0-9_-]{0,99}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z][\w.:-]{0,299}$/;

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/** The exact keys of a comma list, without empty or malformed entries, at most 500. */
export function parseKeys(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((k) => k.trim())
    .filter((k) => KEY.test(k))
    .slice(0, MAX_QUERY_KEYS);
}

/** Reads the URL; anything unknown takes the default. */
export function parseTranslationsQuery(params: URLSearchParams): TranslationsQuery {
  const query: TranslationsQuery = { tab: oneOf(params.get('tab'), TRANSLATIONS_TABS) ?? 'overview' };
  const locale = params.get('locale');
  if (locale && (locale === 'any' || isLocale(locale))) query.locale = locale as Locale | 'any';
  const filter = oneOf(params.get('filter'), TRANSLATION_FILTERS);
  if (filter) query.filter = filter;
  const q = params.get('q');
  if (q && q.trim()) query.q = q.slice(0, 200);
  const area = params.get('area');
  if (area && AREA.test(area)) query.area = area;
  const section = oneOf(params.get('section'), SECTIONS);
  if (section) query.section = section;
  const keys = parseKeys(params.get('keys'));
  if (keys.length > 0) query.keys = keys.join(',');
  const job = params.get('job');
  if (job && UUID.test(job)) query.job = job;
  const page = Number(params.get('page'));
  if (Number.isInteger(page) && page > 1) query.page = page;
  return query;
}

/** The URL query without the defaults (tab overview, locale any, filter all, page 1), without a leading "?". */
export function translationsQueryString(query: Partial<TranslationsQuery>): string {
  const params = new URLSearchParams();
  if (query.tab && query.tab !== 'overview') params.set('tab', query.tab);
  if (query.q) params.set('q', query.q);
  if (query.locale && query.locale !== 'any') params.set('locale', query.locale);
  if (query.filter && query.filter !== 'all') params.set('filter', query.filter);
  if (query.area) params.set('area', query.area);
  if (query.section) params.set('section', query.section);
  if (query.keys) params.set('keys', query.keys);
  if (query.job) params.set('job', query.job);
  if (query.page && query.page > 1) params.set('page', String(query.page));
  return params.toString();
}

/** A link to the translation admin with this view. */
export function translationsHref(query: Partial<TranslationsQuery>): string {
  const qs = translationsQueryString(query);
  return qs ? `/admin/translations?${qs}` : '/admin/translations';
}

/** The filters of the entries tab; changing one of them starts at page 1 again. */
const FILTER_FIELDS = ['locale', 'filter', 'q', 'area', 'section', 'keys'] as const;

/** The next query after a change: a changed filter resets the page, a tab change keeps the filters. */
export function nextQuery(current: TranslationsQuery, patch: Partial<TranslationsQuery>): TranslationsQuery {
  const next = { ...current, ...patch };
  const filterChanged = FILTER_FIELDS.some((f) => f in patch && patch[f] !== current[f]);
  if (filterChanged && !('page' in patch)) delete next.page;
  for (const field of Object.keys(next) as (keyof TranslationsQuery)[]) {
    if (next[field] === undefined || next[field] === '') delete next[field];
  }
  return next;
}

/** The A3 query of the entries tab. */
export function entriesQueryOf(query: TranslationsQuery, pageSize = 50): TranslationEntriesQuery {
  const keys = parseKeys(query.keys);
  return {
    locale: query.locale ?? 'any',
    filter: query.filter ?? 'all',
    q: query.q,
    area: query.area,
    section: query.section,
    keys: keys.length > 0 ? keys : undefined,
    page: query.page ?? 1,
    pageSize,
  };
}

/** The entries tab filtered to the failed pairs of a job (i18n 12.1 step 7). */
export function failuresHref(failures: readonly { key: string; locale: Locale }[]): string {
  const keys = [...new Set(failures.map((f) => f.key))].slice(0, MAX_QUERY_KEYS);
  const locales = [...new Set(failures.map((f) => f.locale))];
  return translationsHref({
    tab: 'entries',
    keys: keys.join(','),
    locale: locales.length === 1 ? locales[0] : undefined,
  });
}
