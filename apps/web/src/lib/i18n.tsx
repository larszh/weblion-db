import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { de, type TranslationKey } from '@/i18n/de';
import { en } from '@/i18n/en';
import type { Locale } from './format';

const DICTIONARIES: Record<Locale, Record<TranslationKey, string>> = { de, en };

type Params = Record<string, string | number | null | undefined>;

export type TFunction = (key: TranslationKey, params?: Params) => string;

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TFunction;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem('wl-locale');
    if (stored === 'de' || stored === 'en') return stored;
  } catch {
    // Storage can be unavailable (private mode). Fall back to the browser language.
  }
  return navigator.language.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem('wl-locale', next);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback<TFunction>(
    (key, params) => {
      let text = DICTIONARIES[locale][key] ?? de[key] ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) text = text.replaceAll(`{${k}}`, String(v ?? ''));
      }
      return text;
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
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
