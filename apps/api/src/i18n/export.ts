import { LOCALES, type Locale, type TargetLocale, type TranslationState } from '@weblion/shared';
import { currentHash } from './entries';
import { allEntries } from './filters';
import type { I18nService } from './service';

/**
 * The JSON exports of A16 (i18n 16.1): every change of the admin for the repository (i18n:apply), or one
 * language for an external translator. Both formats are accepted by the import (A15) and i18n:apply. The
 * TypeScript file set of the first design is dropped (i18n 16.3).
 */

export const OVERRIDES_FORMAT = 'weblion-i18n-overrides';
export const LOCALE_FORMAT = 'weblion-i18n-locale';

export interface OverridesExportEntry {
  key: string;
  locale: Locale;
  value: string;
  origin: 'manual' | 'ai';
  reviewed: boolean;
  sourceHash: string;
  /** The German text the row was written against while it is still the current one; null when stale. */
  source: string | null;
  updatedAt: string;
}

export interface OverridesExport {
  format: typeof OVERRIDES_FORMAT;
  version: 1;
  exportedAt: string;
  entries: OverridesExportEntry[];
}

export interface LocaleExportEntry {
  de: string;
  en: string | null;
  /** The value the console has for the language without fallback; null when missing. */
  value: string | null;
  state: TranslationState;
  /** Legal texts are included: a human translation is welcome, only machines never translate them. */
  legal?: true;
}

export interface LocaleExport {
  format: typeof LOCALE_FORMAT;
  version: 1;
  locale: Locale;
  exportedAt: string;
  entries: Record<string, LocaleExportEntry>;
}

/**
 * Every override row, served or not (a stale legal translation too), in catalog order, optionally of one
 * locale. Demo rows (pseudo translations) and orphans (their key is gone, nothing can apply them) are left out.
 */
export function exportOverrides(
  i18n: I18nService,
  options: { locale?: Locale; now?: Date } = {},
): OverridesExport {
  const { catalog } = i18n;
  const order = new Map<string, number>(catalog.keys.map((k, i) => [k, i]));
  const rows = i18n
    .rows()
    .filter((r) => !r.demo && catalog.has(r.key) && (!options.locale || r.locale === options.locale))
    .sort(
      (a, b) =>
        order.get(a.key)! - order.get(b.key)! || LOCALES.indexOf(a.locale) - LOCALES.indexOf(b.locale),
    );
  return {
    format: OVERRIDES_FORMAT,
    version: 1,
    exportedAt: (options.now ?? new Date()).toISOString(),
    entries: rows.map((row) => {
      const key = row.key as (typeof catalog.keys)[number];
      const basis = currentHash(i18n, key, row.locale);
      const german = row.locale === 'de' ? (catalog.bundles.de[key] ?? key) : i18n.source(key).text;
      return {
        key: row.key,
        locale: row.locale,
        value: row.value,
        origin: row.origin,
        reviewed: row.reviewed,
        sourceHash: row.sourceHash,
        source: row.sourceHash === basis ? german : null,
        updatedAt: row.updatedAt.toISOString(),
      };
    }),
  };
}

/** One language for a translator, with German and English for context; only missing and stale with onlyMissing. */
export function exportLocale(
  i18n: I18nService,
  options: { locale: TargetLocale; onlyMissing?: boolean; now?: Date },
): LocaleExport {
  const entries: Record<string, LocaleExportEntry> = {};
  for (const entry of allEntries(i18n)) {
    const cell = entry.cells[options.locale];
    if (options.onlyMissing && cell.state === 'current') continue;
    entries[entry.key] = {
      de: entry.cells.de.value ?? entry.key,
      en: entry.cells.en.value,
      value: cell.value,
      state: cell.state,
      ...(entry.legal ? { legal: true as const } : {}),
    };
  }
  return {
    format: LOCALE_FORMAT,
    version: 1,
    locale: options.locale,
    exportedAt: (options.now ?? new Date()).toISOString(),
    entries,
  };
}
