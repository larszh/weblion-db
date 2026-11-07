/** The five languages of the console (i18n 2). German is the source of every text. */
export const LOCALES = ['de', 'en', 'fr', 'it', 'nl'] as const;
export type Locale = (typeof LOCALES)[number];

/** Every locale except the source: translations, stamps, product translations, Mass Translate. */
export const TARGET_LOCALES = ['en', 'fr', 'it', 'nl'] as const;
export type TargetLocale = (typeof TARGET_LOCALES)[number];

export const SOURCE_LOCALE = 'de' satisfies Locale;

export interface LocaleMeta {
  /** Name of the language in itself, shown next to the flag in every UI language. */
  native: string;
  /** English name, for logs, scripts and prompts. */
  english: string;
  /** ISO 3166-1 alpha-2 code of the flag (i18n 6.4). */
  flag: 'DE' | 'GB' | 'FR' | 'IT' | 'NL';
  /** BCP 47 tag for every Intl call (i18n 2.3). */
  intl: 'de-CH' | 'en-GB' | 'fr-CH' | 'it-CH' | 'nl-NL';
}

export const LOCALE_META: Record<Locale, LocaleMeta> = {
  de: { native: 'Deutsch', english: 'German', flag: 'DE', intl: 'de-CH' },
  en: { native: 'English', english: 'English', flag: 'GB', intl: 'en-GB' },
  fr: { native: 'Français', english: 'French', flag: 'FR', intl: 'fr-CH' },
  it: { native: 'Italiano', english: 'Italian', flag: 'IT', intl: 'it-CH' },
  nl: { native: 'Nederlands', english: 'Dutch', flag: 'NL', intl: 'nl-NL' },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function isTargetLocale(value: unknown): value is TargetLocale {
  return typeof value === 'string' && (TARGET_LOCALES as readonly string[]).includes(value);
}

/**
 * 'fr', 'FR', 'fr-CH', 'fr_CH' -> 'fr'; 'gsw' (Swiss German) -> 'de'; anything else -> null.
 * Used for stored values (users.locale, billing_profiles.locale), query strings and headers.
 */
export function normalizeLocale(value: unknown): Locale | null {
  if (typeof value !== 'string') return null;
  const primary = value.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  if (primary === 'gsw') return 'de';
  return isLocale(primary) ? primary : null;
}

/**
 * First supported language of a list such as navigator.languages, in order. Each entry goes through
 * normalizeLocale. Without a match: fallback (default 'en': a browser in Spanish gets English, which more
 * people read than German).
 */
export function matchLocale(candidates: readonly string[], fallback: Locale = 'en'): Locale {
  for (const candidate of candidates) {
    const locale = normalizeLocale(candidate);
    if (locale) return locale;
  }
  return fallback;
}

const CHAINS: Record<Locale, readonly Locale[]> = {
  de: ['de'],
  en: ['en', 'de'],
  fr: ['fr', 'en', 'de'],
  it: ['it', 'en', 'de'],
  nl: ['nl', 'en', 'de'],
};

/**
 * Lookup order for a key: fr, it, nl -> [l, 'en', 'de']; en -> ['en', 'de']; de -> ['de'] (plan decision 1).
 * English is complete by type, and a French, Italian or Dutch reader understands it better than German.
 */
export function fallbackChain(locale: Locale): readonly Locale[] {
  return CHAINS[locale];
}

/** The BCP 47 tag of a locale for Intl (LOCALE_META[locale].intl). */
export function intlLocale(locale: Locale): LocaleMeta['intl'] {
  return LOCALE_META[locale].intl;
}
