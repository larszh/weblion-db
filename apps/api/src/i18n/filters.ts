import {
  isLegalKey,
  LEGAL_KEYS,
  LOCALES,
  placeholdersOf,
  TARGET_LOCALES,
  type LegalKey,
  type Locale,
  type Paginated,
  type ServerTranslationKey,
  type TargetLocale,
  type TranslationCellDto,
  type TranslationEntriesQuery,
  type TranslationEntryDto,
  type TranslationFilter,
  type TranslationLocaleStatsDto,
  type TranslationSummaryDto,
} from '@weblion/shared';
import type { I18nCatalog } from '@weblion/shared/i18n/catalog';
import type { I18nService } from './service';

/**
 * Filters and statistics of the translation admin (i18n 15): pure functions over the catalog and the
 * in-memory overrides of I18nService, so A2 and A3 run without a query per key. The entries are built once per
 * load of the service (its `version`) and reused by every request until the next write.
 */

// --- Search -------------------------------------------------------------------------------------

/**
 * Accent folding for the search: NFD without combining marks, lower case, the sharp s as "ss", whitespace
 * collapsed. "Facturé" and "facture", "Grüsse" and "Grusse" fold to the same text.
 */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[\u00DF\u1E9E]/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A query that looks like a key also matches by key prefix, and those keys come first (O18). */
export function looksLikeKey(q: string): boolean {
  return /^[a-z][\w.:-]*$/i.test(q) && q.includes('.');
}

/** The first key segment (O24): admin.ai.status is in area "admin", ai.notice.text in "ai". */
export function areaOf(key: string): string {
  const dot = key.indexOf('.');
  return dot === -1 ? key : key.slice(0, dot);
}

const searchIndexes = new WeakMap<I18nCatalog, ReadonlyMap<string, string>>();

/**
 * Folded key and compiled values of every key, one string per key. Built once per catalog at the first search
 * (about 23,000 texts); the overridden cells are folded per load of the service on top of it.
 */
export function buildSearchIndex(catalog: I18nCatalog): ReadonlyMap<string, string> {
  const cached = searchIndexes.get(catalog);
  if (cached) return cached;
  const index = new Map<string, string>();
  for (const key of catalog.keys) {
    const parts = [fold(key)];
    for (const locale of LOCALES) {
      const value = catalog.bundles[locale][key];
      if (value) parts.push(fold(value));
    }
    index.set(key, parts.join('\n'));
  }
  searchIndexes.set(catalog, index);
  return index;
}

// --- Entries ------------------------------------------------------------------------------------

/** All five cells of a key with its metadata (TranslationEntryDto, i18n 14.1). */
export function entryOf(i18n: I18nService, key: ServerTranslationKey): TranslationEntryDto {
  const cells = {} as Record<Locale, TranslationCellDto>;
  for (const locale of LOCALES) cells[locale] = i18n.cell(locale, key);
  return {
    key,
    section: i18n.catalog.sectionOf(key) ?? '',
    area: areaOf(key),
    legal: isLegalKey(key),
    serverOnly: i18n.catalog.serverOnly.has(key),
    placeholders: placeholdersOf(i18n.source(key).text),
    cells,
  };
}

interface Snapshot {
  version: number;
  entries: TranslationEntryDto[];
  byKey: Map<string, TranslationEntryDto>;
  /** Folded key and effective values of the keys that have a served override; the rest is in the index. */
  folded: Map<string, string>;
  summary: Omit<TranslationSummaryDto, 'ai' | 'activeJob'> | null;
}

const snapshots = new WeakMap<I18nService, Snapshot>();

/** Every entry in catalog order, rebuilt only when the service loaded again. */
function snapshot(i18n: I18nService): Snapshot {
  const cached = snapshots.get(i18n);
  if (cached && cached.version === i18n.version) return cached;
  const entries = i18n.catalog.keys.map((key) => entryOf(i18n, key));
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const folded = new Map<string, string>();
  for (const row of i18n.rows()) {
    const entry = byKey.get(row.key);
    if (!entry || folded.has(row.key) || !i18n.isServable(row)) continue;
    const parts = [fold(entry.key)];
    for (const locale of LOCALES) {
      const value = entry.cells[locale].value;
      if (value) parts.push(fold(value));
    }
    folded.set(row.key, parts.join('\n'));
  }
  const next: Snapshot = { version: i18n.version, entries, byKey, folded, summary: null };
  snapshots.set(i18n, next);
  return next;
}

/** One entry of the current state; undefined for a key outside the catalog. */
export function cachedEntry(i18n: I18nService, key: string): TranslationEntryDto | undefined {
  return snapshot(i18n).byKey.get(key);
}

/** Every entry in catalog order (shared, do not modify). */
export function allEntries(i18n: I18nService): readonly TranslationEntryDto[] {
  return snapshot(i18n).entries;
}

/** The filter of i18n 15.2 for one cell. */
export function cellMatches(cell: TranslationCellDto, filter: TranslationFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'untranslated':
      return cell.state === 'missing';
    case 'stale':
      return cell.state === 'stale';
    case 'changed':
      // Waiting for export: a served override, or a stored one that is hidden right now (a stale legal
      // translation). Demo rows are pseudo translations and never exported.
      return cell.origin !== 'repo' || (cell.hidden && !cell.demo);
    case 'ai':
      return cell.origin === 'ai';
    case 'unreviewed':
      return cell.origin === 'ai' && !cell.reviewed;
    case 'attention':
      // A legal key whose served text is a fallback has no current value in the locale: missing or stale.
      return cell.state !== 'current' || (cell.origin === 'ai' && !cell.reviewed) || cell.warnings.length > 0;
  }
}

/** The state filter on the chosen column; 'any' matches when any target locale matches. */
export function entryMatches(
  entry: TranslationEntryDto,
  filter: TranslationFilter,
  locale: Locale | 'any',
): boolean {
  if (filter === 'all') return true;
  if (locale !== 'any') return cellMatches(entry.cells[locale], filter);
  return TARGET_LOCALES.some((l) => cellMatches(entry.cells[l], filter));
}

export interface EntryNarrowing {
  q?: string;
  area?: string;
  section?: string;
  keys?: readonly string[];
}

/**
 * The entries of the narrowing (search, area, section, explicit keys) in catalog order; for a query that looks
 * like a key, the keys starting with it come first.
 */
export function narrowEntries(i18n: I18nService, narrowing: EntryNarrowing): TranslationEntryDto[] {
  const snap = snapshot(i18n);
  const keys = narrowing.keys && narrowing.keys.length > 0 ? new Set(narrowing.keys) : null;
  const q = narrowing.q ? fold(narrowing.q) : '';
  const index = q ? buildSearchIndex(i18n.catalog) : null;
  const keyLike = narrowing.q ? looksLikeKey(narrowing.q.trim()) : false;
  const prefix = keyLike ? narrowing.q!.trim().toLowerCase() : '';

  const first: TranslationEntryDto[] = [];
  const rest: TranslationEntryDto[] = [];
  for (const entry of snap.entries) {
    if (keys && !keys.has(entry.key)) continue;
    if (narrowing.section && entry.section !== narrowing.section) continue;
    if (narrowing.area && entry.area !== narrowing.area) continue;
    if (q) {
      if (keyLike && entry.key.toLowerCase().startsWith(prefix)) {
        first.push(entry);
        continue;
      }
      const haystack = snap.folded.get(entry.key) ?? index!.get(entry.key) ?? '';
      if (!haystack.includes(q)) continue;
    }
    rest.push(entry);
  }
  return first.length > 0 ? [...first, ...rest] : rest;
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/** A3: the filtered entries, one page of them. */
export function queryEntries(
  i18n: I18nService,
  query: TranslationEntriesQuery,
): Paginated<TranslationEntryDto> {
  const filter = query.filter ?? 'all';
  const locale = query.locale ?? 'any';
  const matching = narrowEntries(i18n, query).filter((e) => entryMatches(e, filter, locale));
  const perPage = Math.min(Math.max(query.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const page = Math.max(query.page ?? 1, 1);
  return {
    items: matching.slice((page - 1) * perPage, page * perPage),
    total: matching.length,
    page,
    perPage,
  };
}

// --- Statistics ---------------------------------------------------------------------------------

/** A2 without the AI availability and the active job: the counts of i18n 15.3, cached until the next load. */
export function summaryStats(i18n: I18nService): Omit<TranslationSummaryDto, 'ai' | 'activeJob'> {
  const snap = snapshot(i18n);
  if (snap.summary) return snap.summary;
  const { catalog } = i18n;
  const total = snap.entries.length;

  const stats = new Map<Locale, TranslationLocaleStatsDto>(
    LOCALES.map((locale) => [
      locale,
      {
        locale,
        total,
        translated: 0,
        missing: 0,
        stale: 0,
        overrides: 0,
        ai: 0,
        unreviewed: 0,
        attention: 0,
        completeness: 0,
        upToDate: 0,
      },
    ]),
  );
  const areas = new Map<string, number>();
  const sections = new Map<string, number>(catalog.sections.map((s) => [s, 0]));
  for (const entry of snap.entries) {
    areas.set(entry.area, (areas.get(entry.area) ?? 0) + 1);
    sections.set(entry.section, (sections.get(entry.section) ?? 0) + 1);
    for (const locale of LOCALES) {
      const cell = entry.cells[locale];
      const s = stats.get(locale)!;
      if (cell.value !== null) s.translated++;
      if (cell.state === 'missing') s.missing++;
      if (cell.state === 'stale') s.stale++;
      if (cell.origin === 'ai') s.ai++;
      if (cell.origin === 'ai' && !cell.reviewed) s.unreviewed++;
      if (cellMatches(cell, 'attention')) s.attention++;
    }
  }

  let orphans = 0;
  let sameAsCompiled = 0;
  let demoOverrides = 0;
  for (const row of i18n.rows()) {
    if (row.demo) demoOverrides++;
    if (!catalog.has(row.key)) {
      orphans++;
      continue;
    }
    if (!row.demo && catalog.bundles[row.locale][row.key] === row.value) sameAsCompiled++;
    if (i18n.isServable(row)) stats.get(row.locale)!.overrides++;
  }
  for (const s of stats.values()) {
    s.completeness = total > 0 ? s.translated / total : 0;
    s.upToDate = total > 0 ? (s.translated - s.stale) / total : 0;
  }

  const legalKeys = LEGAL_KEYS.filter((k) => catalog.has(k));
  const staleOrMissing: Partial<Record<TargetLocale, LegalKey[]>> = {};
  for (const locale of TARGET_LOCALES) {
    // Legal keys take only current values; without one the console shows the next locale of the chain.
    const fallback = legalKeys.filter((k) => snap.byKey.get(k)!.cells[locale].state !== 'current');
    if (fallback.length > 0) staleOrMissing[locale] = fallback;
  }

  snap.summary = {
    keys: total,
    locales: LOCALES.map((l) => stats.get(l)!),
    areas: [...areas].map(([area, keys]) => ({ area, keys })).sort((a, b) => a.area.localeCompare(b.area)),
    sections: [...sections].map(([section, keys]) => ({ section, keys })),
    orphans,
    sameAsCompiled,
    demoOverrides,
    legal: { keys: legalKeys, staleOrMissing },
  };
  return snap.summary;
}
