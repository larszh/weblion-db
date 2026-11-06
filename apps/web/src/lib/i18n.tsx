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
// Static dictionaries for now (F22): the only web module that imports them. U2 replaces this with one lazy
// chunk per locale (lib/i18n-loader.ts, i18n 5.1) and keeps the exported names and types.
import { de } from '@weblion/shared/i18n/de';
import { en } from '@weblion/shared/i18n/en';
import { fr } from '@weblion/shared/i18n/fr';
import { it } from '@weblion/shared/i18n/it';
import { nl } from '@weblion/shared/i18n/nl';

/** fr, it and nl are partial: English fills their gaps (fallbackChain without German, i18n 5.1). */
const DICTIONARIES: Record<Locale, Dictionary> = {
  de,
  en,
  fr: { ...en, ...fr },
  it: { ...en, ...it },
  nl: { ...en, ...nl },
};

const STORAGE_KEY = 'wl-locale';

export type TFunction = (key: TranslationKey, params?: I18nParams) => string;

export interface I18nContextValue {
  locale: Locale;
  /** Loads the chunk and overrides of `next`, then switches and stores it in localStorage['wl-locale']. */
  setLocale(next: Locale): Promise<void>;
  t: TFunction;
  /** After a save in the translation admin: one override changed (value) or was reverted (null). F: no-op. */
  applyOverride(locale: Locale, key: string, value: string | null): void;
  /** Replaces all overrides of a locale (background revalidation). F: no-op. */
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
  return { locale, dictionary: DICTIONARIES[locale], overrides: {} };
}

const noop = () => {};

export function I18nProvider({ boot, children }: { boot?: I18nBoot; children: ReactNode }): JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(() => boot?.locale ?? initialLocale());

  const setLocale = useCallback(async (next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback<TFunction>(
    (key, params) => interpolate(DICTIONARIES[locale][key] ?? key, params),
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t, applyOverride: noop, applyOverrides: noop }),
    [locale, setLocale, t],
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
