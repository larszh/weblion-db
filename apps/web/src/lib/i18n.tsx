import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import {
  interpolate,
  isLocale,
  matchLocale,
  type Dictionary,
  type I18nParams,
  type Locale,
  type TranslationKey,
} from '@weblion/shared';
// Static dictionaries for now (F22): the only app module that imports them (tests and src/test/i18n.tsx may
// too). U2 replaces this with one lazy chunk per locale (lib/i18n-loader.ts, i18n 5.1) and keeps the exported
// names and types.
import { de } from '@weblion/shared/i18n/de';
import { en } from '@weblion/shared/i18n/en';
import { fr } from '@weblion/shared/i18n/fr';
import { it } from '@weblion/shared/i18n/it';
import { nl } from '@weblion/shared/i18n/nl';

type Overrides = Partial<Record<Locale, Record<string, string>>>;

/**
 * The dictionary on screen, highest first: overrides of the locale, its bundle, en overrides, the en bundle
 * (i18n 5.3). fr, it and nl are partial, so English fills their gaps; German is never a fallback in the web.
 */
function compile(locale: Locale, overrides: Overrides): Dictionary {
  if (locale === 'de') return { ...de, ...overrides.de };
  const base: Dictionary = { ...en, ...overrides.en };
  if (locale === 'en') return base;
  const bundle = { fr, it, nl }[locale];
  return { ...base, ...bundle, ...overrides[locale] } as Dictionary;
}

const STORAGE_KEY = 'wl-locale';

export type TFunction = (key: TranslationKey, params?: I18nParams) => string;

export interface I18nContextValue {
  locale: Locale;
  /** Loads the chunk and overrides of `next`, then switches and stores it in localStorage['wl-locale']. */
  setLocale(next: Locale): Promise<void>;
  t: TFunction;
  /** After a save in the translation admin: one override changed (value) or was reverted (null). F: in memory. */
  applyOverride(locale: Locale, key: string, value: string | null): void;
  /** Replaces all overrides of a locale (background revalidation). F: in memory. */
  applyOverrides(locale: Locale, values: Record<string, string>): void;
}

export interface I18nBoot {
  locale: Locale;
  dictionary: Dictionary;
  overrides: Partial<Record<Locale, Record<string, string>>>;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/** The stored choice when it is one of the five locales, else the first supported browser language. */
function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // Storage can be unavailable (private mode, tests). Fall back to the browser language.
  }
  try {
    return matchLocale(navigator.languages?.length ? navigator.languages : [navigator.language]);
  } catch {
    return 'en';
  }
}

/** U2 loads the chunk and the overrides here (i18n 5.2); F resolves with the static dictionary. */
export async function bootI18n(): Promise<I18nBoot> {
  const locale = initialLocale();
  return { locale, dictionary: compile(locale, {}), overrides: {} };
}

export function I18nProvider({ boot, children }: { boot?: I18nBoot; children: ReactNode }): JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(() => boot?.locale ?? initialLocale());
  // The static bundles are the compiled dictionaries (F), so boot.dictionary adds nothing; its overrides count.
  const [overrides, setOverrides] = useState<Overrides>(() => boot?.overrides ?? {});

  const setLocale = useCallback(async (next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  // In memory only for now; U2 adds the cached copy per locale and the background revalidation (i18n 5.3).
  const applyOverride = useCallback((target: Locale, key: string, value: string | null) => {
    setOverrides((prev) => {
      const values = { ...prev[target] };
      if (value === null) delete values[key];
      else values[key] = value;
      return { ...prev, [target]: values };
    });
  }, []);
  const applyOverrides = useCallback((target: Locale, values: Record<string, string>) => {
    setOverrides((prev) => ({ ...prev, [target]: { ...values } }));
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const dictionary = useMemo(() => compile(locale, overrides), [locale, overrides]);
  const t = useCallback<TFunction>(
    (key, params) => interpolate(dictionary[key] ?? key, params),
    [dictionary],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t, applyOverride, applyOverrides }),
    [locale, setLocale, t, applyOverride, applyOverrides],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}

export function useT(): TFunction {
  return useI18n().t;
}

/** Switches the UI language with a toast (language.loadFailed) on failure; resolves false then. Saves nothing. */
export function useChangeLocale(): (next: Locale) => Promise<boolean> {
  const { setLocale, t } = useI18n();
  return useCallback(
    async (next: Locale) => {
      try {
        await setLocale(next);
        return true;
      } catch {
        toast.error(t('language.loadFailed'));
        return false;
      }
    },
    [setLocale, t],
  );
}

/** The key exists in the dictionary on screen (localizeError builds keys at runtime, i18n 7). */
export function hasKey(key: string): boolean {
  // Every locale has the German keys (fr, it, nl are completed with English), so German answers for all.
  return Object.prototype.hasOwnProperty.call(de, key);
}
