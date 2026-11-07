import { fallbackChain, type Dictionary, type Locale, type PartialDictionary } from '@weblion/shared';
import { apiUrl } from './api';

/**
 * Lazy locale chunks and the database overrides of the texts (i18n 5.1, 5.3). The only web module that
 * imports dictionary values: every locale is its own dynamic import, so Vite emits one chunk per locale and
 * the entry chunk carries none (lib/i18n-imports.test.ts, scripts/check-i18n-chunks.mjs).
 */

export type Overrides = Partial<Record<Locale, Record<string, string>>>;

/** What a locale chunk exports: its marker (kept in the chunk for the build check) and the dictionary. */
export interface LoadedChunk {
  I18N_CHUNK: string;
  dict: PartialDictionary;
}

export type ChunkLoaders = Record<Locale, () => Promise<LoadedChunk>>;

const CHUNKS: ChunkLoaders = {
  de: () => import('@weblion/shared/i18n/de').then((m) => ({ I18N_CHUNK: m.I18N_CHUNK, dict: m.de })),
  en: () => import('@weblion/shared/i18n/en').then((m) => ({ I18N_CHUNK: m.I18N_CHUNK, dict: m.en })),
  fr: () => import('@weblion/shared/i18n/fr').then((m) => ({ I18N_CHUNK: m.I18N_CHUNK, dict: m.fr })),
  it: () => import('@weblion/shared/i18n/it').then((m) => ({ I18N_CHUNK: m.I18N_CHUNK, dict: m.it })),
  nl: () => import('@weblion/shared/i18n/nl').then((m) => ({ I18N_CHUNK: m.I18N_CHUNK, dict: m.nl })),
};

/** localStorage key of the cached overrides of a locale: { etag, values }. */
export const OVERRIDES_STORAGE_PREFIX = 'wl-i18n-overrides:';
/** Without a cached copy the boot waits this long for the overrides, then renders without them (i18n 5.3). */
export const OVERRIDES_BOOT_WAIT_MS = 1500;
/** A request that hangs longer than this is given up; the cached copy (or none) stays. */
const OVERRIDES_FETCH_TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 500;
/**
 * Prefix of the chunk markers ("wl-i18n-chunk:de"). Joined at runtime, so the literal exists only in the
 * locale chunks and the build check can tell them apart from the entry set, where this loader lives.
 */
const MARKER_PREFIX = `${['wl', 'i18n', 'chunk'].join('-')}:`;

interface CachedOverrides {
  etag: string | null;
  values: Record<string, string>;
}

export interface LoaderDeps {
  chunks: ChunkLoaders;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** Storage for the cached overrides; null when the browser has none (private mode, tests). */
  storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  sleep: (ms: number) => Promise<void>;
}

export interface LoadOverridesOptions {
  /** Called when a background request brings values that differ from what was returned. */
  onUpdate?: (locale: Locale, values: Record<string, string>) => void;
  /** How long to wait for a locale without a cached copy (default 1,500 ms). */
  waitMs?: number;
}

export interface I18nLoader {
  /** The bundles of fallbackChain(locale) without 'de' (except for 'de' itself), loaded in parallel. */
  loadBundles(locale: Locale): Promise<Partial<Record<Locale, PartialDictionary>>>;
  /** Compiled dictionary of a locale: fr = { ...en, ...fr }; de and en alone. Cached per locale. */
  loadDictionary(locale: Locale): Promise<Dictionary>;
  /** The locale's own bundle when it is loaded already (fr without the English it falls back to). */
  peekBundle(locale: Locale): PartialDictionary | undefined;
  /** Overrides of every locale of the chain except 'de' (de: 'de'), newest from the server or the cache. */
  loadOverrides(locale: Locale, options?: LoadOverridesOptions): Promise<Overrides>;
  /** After a save in the admin: one override in the cached copy, and its ETag dropped (i18n 5.3). */
  updateCachedOverride(locale: Locale, key: string, value: string | null): void;
  /** Replaces the cached values of a locale and drops its ETag. */
  replaceCachedOverrides(locale: Locale, values: Record<string, string>): void;
  /**
   * Whether this session received the locale's overrides from the server (a 200, or a 304 for the cached copy).
   * Only that payload carries the current legal texts (i18n 8.1): the chunk or a cached copy can be outdated.
   */
  hasFreshOverrides(locale: Locale): boolean;
  /** Asks the server again for one locale (with the cached ETag): its values, or null when the request failed. */
  refreshOverrides(locale: Locale): Promise<Record<string, string> | null>;
}

/** The locales whose overrides apply to a UI language: German alone, else the chain without German. */
export function overrideLocales(locale: Locale): Locale[] {
  return locale === 'de' ? ['de'] : fallbackChain(locale).filter((l) => l !== 'de');
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function createI18nLoader(deps: Partial<LoaderDeps> = {}): I18nLoader {
  const chunks = deps.chunks ?? CHUNKS;
  const doFetch = deps.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const storage = deps.storage ?? defaultStorage;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const bundles = new Map<Locale, Promise<PartialDictionary>>();
  const loaded = new Map<Locale, PartialDictionary>();
  const dictionaries = new Map<Locale, Promise<Dictionary>>();
  /** Locales whose overrides arrived from the server in this session. */
  const fresh = new Set<Locale>();

  async function importChunk(locale: Locale): Promise<PartialDictionary> {
    const once = async () => {
      const chunk = await chunks[locale]();
      // The marker proves the chunk is the dictionary of this locale (and keeps the export in the build).
      if (chunk.I18N_CHUNK !== `${MARKER_PREFIX}${locale}`) {
        throw new Error(`Wrong dictionary chunk for ${locale}: ${String(chunk.I18N_CHUNK)}`);
      }
      return chunk.dict;
    };
    try {
      return await once();
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Wrong dictionary chunk')) throw err;
      // A flaky network: one more try after a short pause, then give up.
      await sleep(RETRY_DELAY_MS);
      return once();
    }
  }

  function loadBundle(locale: Locale): Promise<PartialDictionary> {
    let pending = bundles.get(locale);
    if (!pending) {
      pending = importChunk(locale).then(
        (dict) => {
          loaded.set(locale, dict);
          return dict;
        },
        (err: unknown) => {
          // A later switch to this locale tries again.
          bundles.delete(locale);
          throw err;
        },
      );
      bundles.set(locale, pending);
    }
    return pending;
  }

  async function loadBundles(locale: Locale): Promise<Partial<Record<Locale, PartialDictionary>>> {
    // German is never a fallback in the web: English is complete by type (i18n 5.1).
    const needed = locale === 'de' ? (['de'] as Locale[]) : overrideLocales(locale);
    const dicts = await Promise.all(needed.map(loadBundle));
    return Object.fromEntries(needed.map((l, i) => [l, dicts[i]]));
  }

  function loadDictionary(locale: Locale): Promise<Dictionary> {
    let pending = dictionaries.get(locale);
    if (!pending) {
      pending = loadBundles(locale).then(
        (b) => (locale === 'de' || locale === 'en' ? b[locale] : { ...b.en, ...b[locale] }) as Dictionary,
        (err: unknown) => {
          dictionaries.delete(locale);
          throw err;
        },
      );
      dictionaries.set(locale, pending);
    }
    return pending;
  }

  function readCache(locale: Locale): CachedOverrides | null {
    try {
      const raw = storage()?.getItem(OVERRIDES_STORAGE_PREFIX + locale);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<CachedOverrides>;
      if (!parsed || typeof parsed !== 'object' || !parsed.values || typeof parsed.values !== 'object') {
        return null;
      }
      const values: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed.values)) if (typeof v === 'string') values[k] = v;
      return { etag: typeof parsed.etag === 'string' ? parsed.etag : null, values };
    } catch {
      return null;
    }
  }

  function writeCache(locale: Locale, entry: CachedOverrides): void {
    try {
      storage()?.setItem(OVERRIDES_STORAGE_PREFIX + locale, JSON.stringify(entry));
    } catch {
      // A full or blocked storage only costs the cache.
    }
  }

  /** The current values of a locale from the server, or null when the request failed (the cache stays). */
  async function revalidate(
    locale: Locale,
    cached: CachedOverrides | null,
  ): Promise<Record<string, string> | null> {
    try {
      const res = await doFetch(apiUrl(`/i18n/overrides/${locale}`), {
        cache: 'no-store',
        credentials: 'omit',
        headers: { Accept: 'application/json', ...(cached?.etag ? { 'If-None-Match': cached.etag } : {}) },
        signal: AbortSignal.timeout(OVERRIDES_FETCH_TIMEOUT_MS),
      });
      if (res.status === 304 && cached) {
        fresh.add(locale);
        return cached.values;
      }
      if (!res.ok) return null;
      const body = (await res.json()) as { values?: Record<string, unknown> };
      const values: Record<string, string> = {};
      for (const [k, v] of Object.entries(body?.values ?? {})) if (typeof v === 'string') values[k] = v;
      writeCache(locale, { etag: res.headers.get('etag'), values });
      fresh.add(locale);
      return values;
    } catch {
      return null;
    }
  }

  async function loadOverrides(locale: Locale, options: LoadOverridesOptions = {}): Promise<Overrides> {
    const waitMs = options.waitMs ?? OVERRIDES_BOOT_WAIT_MS;
    const entries = await Promise.all(
      overrideLocales(locale).map(async (l): Promise<[Locale, Record<string, string>]> => {
        const cached = readCache(l);
        const fresh = revalidate(l, cached);
        if (cached) {
          // Render with the cached copy at once; a different answer updates the screen later.
          void fresh.then((values) => {
            if (values && !sameValues(values, cached.values)) options.onUpdate?.(l, values);
          });
          return [l, cached.values];
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const late = new Promise<'late'>((resolve) => {
          timer = setTimeout(() => resolve('late'), waitMs);
        });
        const first = await Promise.race([fresh, late]);
        clearTimeout(timer);
        if (first === 'late') {
          // Too slow for the first render: show the compiled texts and apply the overrides when they arrive.
          void fresh.then((values) => {
            if (values && Object.keys(values).length > 0) options.onUpdate?.(l, values);
          });
          return [l, {}];
        }
        return [l, first ?? {}];
      }),
    );
    return Object.fromEntries(entries);
  }

  function updateCachedOverride(locale: Locale, key: string, value: string | null): void {
    const values = { ...(readCache(locale)?.values ?? {}) };
    if (value === null) delete values[key];
    else values[key] = value;
    // Without the ETag the next load asks the server again instead of trusting this copy.
    writeCache(locale, { etag: null, values });
  }

  function replaceCachedOverrides(locale: Locale, values: Record<string, string>): void {
    writeCache(locale, { etag: null, values: { ...values } });
  }

  return {
    loadBundles,
    loadDictionary,
    peekBundle: (locale) => loaded.get(locale),
    loadOverrides,
    updateCachedOverride,
    replaceCachedOverrides,
    hasFreshOverrides: (locale) => fresh.has(locale),
    refreshOverrides: (locale) => revalidate(locale, readCache(locale)),
  };
}

function sameValues(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => a[k] === b[k]);
}

/** The loader of the app. */
export const i18nLoader: I18nLoader = createI18nLoader();

/** The bundles of fallbackChain(locale) without 'de' (except for 'de' itself), loaded in parallel. */
export function loadBundles(locale: Locale): Promise<Partial<Record<Locale, PartialDictionary>>> {
  return i18nLoader.loadBundles(locale);
}

/** Compiled dictionary of a locale: fr = { ...en, ...fr }; de and en alone. Cached per locale. */
export function loadDictionary(locale: Locale): Promise<Dictionary> {
  return i18nLoader.loadDictionary(locale);
}

/** Overrides of every locale in fallbackChain(locale) except 'de', newest from the server or the cache. */
export function loadOverrides(locale: Locale, options?: LoadOverridesOptions): Promise<Overrides> {
  return i18nLoader.loadOverrides(locale, options);
}
