import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
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
  type PartialDictionary,
  type TranslationKey,
} from '@weblion/shared';
import { i18nLoader, type I18nLoader, type Overrides } from './i18n-loader';

/**
 * The UI language (i18n 5). Dictionaries are lazy chunks (lib/i18n-loader.ts); main.tsx waits for the first
 * one before it renders, so keys never flash and no component needs a "not loaded yet" state. The state
 * lives in a small store (createI18nStore) that the provider subscribes to and tests drive directly.
 */

export const LOCALE_STORAGE_KEY = 'wl-locale';
/**
 * Written next to every wl-locale the new code writes. A wl-locale without it is a choice of the old de/en
 * toggle, which never reached the profile; ProfileLocaleSync adopts it once (i18n 6.3).
 */
export const LOCALE_VERSION_KEY = 'wl-locale-v';
export const LOCALE_VERSION = '2';

export type TFunction = (key: TranslationKey, params?: I18nParams) => string;

export interface I18nContextValue {
  locale: Locale;
  /** Loads the chunk and overrides of `next`, then switches and stores it in localStorage['wl-locale']. */
  setLocale(next: Locale): Promise<void>;
  t: TFunction;
  /** After a save in the translation admin: one override changed (value) or was reverted (null). */
  applyOverride(locale: Locale, key: string, value: string | null): void;
  /** Replaces all overrides of a locale (background revalidation). */
  applyOverrides(locale: Locale, values: Record<string, string>): void;
}

export interface I18nBoot {
  locale: Locale;
  dictionary: Dictionary;
  overrides: Partial<Record<Locale, Record<string, string>>>;
}

// --- Stored choice --------------------------------------------------------------------

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The locale in localStorage['wl-locale'] when it is one of the five, else null. */
export function storedLocale(): Locale | null {
  try {
    const value = storage()?.getItem(LOCALE_STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

/** Whether wl-locale was written by this release (pickers, login page, setLocale) and not by the old toggle. */
export function storedLocaleIsCurrent(): boolean {
  try {
    return storage()?.getItem(LOCALE_VERSION_KEY) === LOCALE_VERSION;
  } catch {
    return false;
  }
}

/** Stores a choice with the marker of this release. */
export function storeLocale(locale: Locale): void {
  try {
    const s = storage();
    s?.setItem(LOCALE_STORAGE_KEY, locale);
    s?.setItem(LOCALE_VERSION_KEY, LOCALE_VERSION);
  } catch {
    // Private mode or blocked storage: the choice lasts for this tab only.
  }
}

/** The stored choice when it is one of the five locales, else the first supported browser language. */
export function initialLocale(): Locale {
  const stored = storedLocale();
  if (stored) return stored;
  try {
    return matchLocale(navigator.languages?.length ? navigator.languages : [navigator.language]);
  } catch {
    return 'en';
  }
}

export type ProfileLocaleDecision =
  | { action: 'none' }
  /** The profile language wins (plan decision 4): switch the UI to it. */
  | { action: 'switch'; locale: Locale }
  /** A choice of the old de/en toggle that never reached the profile: save it to the profile once. */
  | { action: 'adopt'; locale: Locale };

/**
 * What ProfileLocaleSync does after sign-in (i18n 6.3). Before this release the user menu stored the language
 * only in this browser (wl-locale without wl-locale-v), so most profiles still say 'de' for people who work in
 * English; such a legacy choice is adopted into the profile once instead of being overruled. Afterwards, and
 * for every choice the new code stored, the profile wins.
 */
export function profileLocaleDecision(input: {
  profile: Locale;
  ui: Locale;
  stored: Locale | null;
  storedIsCurrent: boolean;
}): ProfileLocaleDecision {
  if (input.stored && !input.storedIsCurrent && input.stored !== input.profile) {
    return { action: 'adopt', locale: input.stored };
  }
  if (input.ui !== input.profile) return { action: 'switch', locale: input.profile };
  return { action: 'none' };
}

// --- Store ----------------------------------------------------------------------------

export interface I18nSnapshot {
  locale: Locale;
  dictionary: Dictionary;
  overrides: Overrides;
  t: TFunction;
}

export interface I18nStore {
  getSnapshot(): I18nSnapshot;
  subscribe(listener: () => void): () => void;
  setLocale(next: Locale): Promise<void>;
  applyOverride(locale: Locale, key: string, value: string | null): void;
  /** From the admin: replaces a locale's overrides and its cached copy (the ETag is dropped). */
  applyOverrides(locale: Locale, values: Record<string, string>): void;
  /** From the background revalidation: the loader already cached the answer with its ETag. */
  receiveOverrides(locale: Locale, values: Record<string, string>): void;
}

/**
 * The dictionary on screen, highest first: overrides of the locale, its bundle, en overrides, the en bundle
 * (i18n 5.3). `base` is the compiled bundle ({ ...en, ...fr } for fr); `own` the locale's own bundle, which
 * tells which keys an en override may replace. Without it (a boot that brought only the compiled dictionary)
 * en overrides stay out of fr, it and nl, so English never covers a text that may be translated.
 */
export function composeDictionary(
  locale: Locale,
  base: Dictionary,
  own: PartialDictionary | undefined,
  overrides: Overrides,
): Dictionary {
  if (locale === 'de' || locale === 'en') return { ...base, ...overrides[locale] };
  const en: Record<string, string> = {};
  if (own) {
    for (const [key, value] of Object.entries(overrides.en ?? {})) {
      if (!(key in own)) en[key] = value;
    }
  }
  return { ...base, ...en, ...overrides[locale] } as Dictionary;
}

/** Dictionary of the store rendered last; hasKey() answers from it. Every locale has the same keys. */
let activeDictionary: Dictionary | null = null;

/**
 * A store for one provider. bootI18n() creates the app's store (it revalidates the overrides in the
 * background); tests create their own with a stubbed loader.
 */
export function createI18nStore(boot: I18nBoot, loader: I18nLoader = i18nLoader): I18nStore {
  let locale = boot.locale;
  let base = boot.dictionary;
  let own = loader.peekBundle(boot.locale);
  let overrides: Overrides = { ...boot.overrides };
  let switching = 0;
  const listeners = new Set<() => void>();

  const build = (): I18nSnapshot => {
    const dictionary = composeDictionary(locale, base, own, overrides);
    activeDictionary = dictionary;
    const t: TFunction = (key, params) => interpolate(dictionary[key] ?? key, params);
    return { locale, dictionary, overrides, t };
  };
  let snapshot = build();
  const emit = () => {
    snapshot = build();
    for (const listener of listeners) listener();
  };

  const receiveOverrides = (target: Locale, values: Record<string, string>) => {
    overrides = { ...overrides, [target]: { ...values } };
    emit();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async setLocale(next) {
      const token = ++switching;
      // A background answer that arrives while the chunk still loads is newer than what loadOverrides gave.
      const received = new Set<Locale>();
      // The old dictionary stays on screen until the new one is there; a failure keeps the old locale.
      const [dictionary, loadedOverrides] = await Promise.all([
        loader.loadDictionary(next),
        loader.loadOverrides(next, {
          onUpdate: (l, values) => {
            if (token !== switching) return;
            received.add(l);
            receiveOverrides(l, values);
          },
        }),
      ]);
      if (token !== switching) return;
      locale = next;
      base = dictionary;
      own = loader.peekBundle(next);
      const fresh = Object.entries(loadedOverrides).filter(([l]) => !received.has(l as Locale));
      overrides = { ...overrides, ...Object.fromEntries(fresh) };
      storeLocale(next);
      if (typeof document !== 'undefined') document.documentElement.lang = next;
      emit();
    },
    applyOverride(target, key, value) {
      const values = { ...overrides[target] };
      if (value === null) delete values[key];
      else values[key] = value;
      overrides = { ...overrides, [target]: values };
      loader.updateCachedOverride(target, key, value);
      emit();
    },
    applyOverrides(target, values) {
      loader.replaceCachedOverrides(target, values);
      receiveOverrides(target, values);
    },
    receiveOverrides,
  };
}

/** Stores created by bootI18n, so the provider rendered with that boot keeps receiving late overrides. */
const BOOTED = new WeakMap<I18nBoot, I18nStore>();

/**
 * Before the first render (main.tsx, i18n 5.2): the stored or browser language, its dictionary and the
 * overrides (cached copy at once, else at most 1.5 s), and html[lang]. Rejects when no dictionary loads.
 */
export async function bootI18n(loader: I18nLoader = i18nLoader): Promise<I18nBoot> {
  const locale = initialLocale();
  let store: I18nStore | null = null;
  const early: Overrides = {};
  const [dictionary, overrides] = await Promise.all([
    loader.loadDictionary(locale),
    loader.loadOverrides(locale, {
      // A late answer goes to the store once it exists, or into the boot overrides before that.
      onUpdate: (l, values) => {
        if (store) store.receiveOverrides(l, values);
        else early[l] = values;
      },
    }),
  ]);
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  const boot: I18nBoot = { locale, dictionary, overrides: { ...overrides, ...early } };
  store = createI18nStore(boot, loader);
  BOOTED.set(boot, store);
  return boot;
}

// --- React ----------------------------------------------------------------------------

const I18nContext = createContext<I18nContextValue | null>(null);

/** Only main.tsx (with the boot of bootI18n) and src/test/i18n.tsx render it. */
export function I18nProvider({ boot, children }: { boot?: I18nBoot; children: ReactNode }): JSX.Element {
  const [store] = useState<I18nStore>(
    () =>
      (boot && BOOTED.get(boot)) ??
      createI18nStore(
        boot ?? { locale: initialLocale(), dictionary: {} as Dictionary, overrides: {} },
        i18nLoader,
      ),
  );
  // The server snapshot is the same: tests render with renderToStaticMarkup.
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  useEffect(() => {
    // Without a boot nothing is loaded yet (never in the app: main.tsx always boots first).
    if (!boot) void store.setLocale(store.getSnapshot().locale).catch(() => undefined);
  }, [boot, store]);

  useEffect(() => {
    document.documentElement.lang = snapshot.locale;
  }, [snapshot.locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale: snapshot.locale,
      t: snapshot.t,
      setLocale: store.setLocale,
      applyOverride: store.applyOverride,
      applyOverrides: store.applyOverrides,
    }),
    [snapshot, store],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}

/** The UI language, or null outside the provider (components such as Flag also render without it). */
export function useOptionalLocale(): Locale | null {
  return useContext(I18nContext)?.locale ?? null;
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
  return !!activeDictionary && Object.prototype.hasOwnProperty.call(activeDictionary, key);
}
