import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dictionary, Locale, PartialDictionary } from '@weblion/shared';
import {
  createI18nLoader,
  OVERRIDES_STORAGE_PREFIX,
  type ChunkLoaders,
  type LoadedChunk,
} from './i18n-loader';
import {
  bootI18n,
  composeDictionary,
  createI18nStore,
  LOCALE_STORAGE_KEY,
  LOCALE_VERSION_KEY,
  profileLocaleDecision,
  storedLocale,
  storedLocaleIsCurrent,
} from './i18n';

/** Small dictionaries: en is complete, fr partial, de complete (as in the repository). */
const BUNDLES: Record<Locale, Record<string, string>> = {
  de: { 'common.save': 'Speichern', 'common.cancel': 'Abbrechen', 'common.close': 'Schliessen' },
  en: { 'common.save': 'Save', 'common.cancel': 'Cancel', 'common.close': 'Close' },
  fr: { 'common.save': 'Enregistrer' },
  it: { 'common.save': 'Salva' },
  nl: {},
};

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

function chunks(calls: Locale[] = [], patch: Partial<Record<Locale, () => Promise<LoadedChunk>>> = {}) {
  const make = (l: Locale) => async (): Promise<LoadedChunk> => {
    calls.push(l);
    return { I18N_CHUNK: `wl-i18n-chunk:${l}`, dict: BUNDLES[l] as PartialDictionary };
  };
  return {
    de: make('de'),
    en: make('en'),
    fr: make('fr'),
    it: make('it'),
    nl: make('nl'),
    ...patch,
  } as ChunkLoaders;
}

interface FakeServer {
  values: Partial<Record<Locale, Record<string, string>>>;
  etag: Partial<Record<Locale, string>>;
  requests: { url: string; ifNoneMatch: string | null }[];
  fail?: boolean;
}

function fakeFetch(server: FakeServer) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    server.requests.push({ url, ifNoneMatch: headers.get('If-None-Match') });
    if (server.fail) throw new TypeError('Failed to fetch');
    const locale = url.split('/').pop() as Locale;
    const etag = server.etag[locale] ?? `"${locale}-1"`;
    if (headers.get('If-None-Match') === etag) return new Response(null, { status: 304 });
    return new Response(JSON.stringify({ locale, values: server.values[locale] ?? {} }), {
      status: 200,
      headers: { 'content-type': 'application/json', etag },
    });
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let storage: ReturnType<typeof memoryStorage>;
beforeEach(() => {
  storage = memoryStorage();
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loader: lazy locale chunks (i18n 5.1)', () => {
  it('merges en under fr, so a key missing in fr shows English; German is never loaded for fr', async () => {
    const calls: Locale[] = [];
    const loader = createI18nLoader({ chunks: chunks(calls), storage: () => storage });
    const fr = await loader.loadDictionary('fr');
    expect(fr['common.save' as keyof Dictionary]).toBe('Enregistrer');
    expect(fr['common.cancel' as keyof Dictionary]).toBe('Cancel');
    expect(calls.sort()).toEqual(['en', 'fr']);
    expect(loader.peekBundle('fr')).toEqual(BUNDLES.fr);
  });

  it('loads de and en alone and caches every chunk', async () => {
    const calls: Locale[] = [];
    const loader = createI18nLoader({ chunks: chunks(calls), storage: () => storage });
    expect((await loader.loadDictionary('de'))['common.save' as keyof Dictionary]).toBe('Speichern');
    expect(calls).toEqual(['de']);
    await loader.loadDictionary('en');
    await loader.loadDictionary('it');
    await loader.loadDictionary('de');
    expect(calls).toEqual(['de', 'en', 'it']);
  });

  it('rejects a chunk with the wrong marker', async () => {
    const loader = createI18nLoader({
      chunks: chunks([], { nl: async () => ({ I18N_CHUNK: 'wl-i18n-chunk:fr', dict: {} }) }),
      storage: () => storage,
      sleep: async () => {},
    });
    await expect(loader.loadDictionary('nl')).rejects.toThrow(/Wrong dictionary chunk/);
  });

  it('retries a failed import once after a pause, then gives up', async () => {
    let attempts = 0;
    const waits: number[] = [];
    const flaky = async (): Promise<LoadedChunk> => {
      attempts += 1;
      if (attempts === 1) throw new TypeError('Failed to fetch dynamically imported module');
      return { I18N_CHUNK: 'wl-i18n-chunk:it', dict: BUNDLES.it as PartialDictionary };
    };
    const loader = createI18nLoader({
      chunks: chunks([], { it: flaky }),
      storage: () => storage,
      sleep: async (ms) => void waits.push(ms),
    });
    expect((await loader.loadDictionary('it'))['common.save' as keyof Dictionary]).toBe('Salva');
    expect(attempts).toBe(2);
    expect(waits).toEqual([500]);

    let broken = 0;
    const down = createI18nLoader({
      chunks: chunks([], {
        de: async () => {
          broken += 1;
          throw new TypeError('offline');
        },
      }),
      storage: () => storage,
      sleep: async () => {},
    });
    await expect(down.loadDictionary('de')).rejects.toThrow('offline');
    expect(broken).toBe(2);
    // A later attempt tries again instead of keeping the failure.
    await expect(down.loadDictionary('de')).rejects.toThrow('offline');
    expect(broken).toBe(4);
  });
});

describe('loader: overrides with ETag and cache (i18n 5.3)', () => {
  it('waits for the server without a cached copy and stores the answer with its ETag', async () => {
    const server: FakeServer = { values: { fr: { 'common.save': 'Sauver' } }, etag: {}, requests: [] };
    const loader = createI18nLoader({ chunks: chunks(), storage: () => storage, fetch: fakeFetch(server) });
    const overrides = await loader.loadOverrides('fr');
    expect(overrides).toEqual({ fr: { 'common.save': 'Sauver' }, en: {} });
    // fr asks for fr and en, never de.
    expect(server.requests.map((r) => r.url).sort()).toEqual([
      '/api/v1/i18n/overrides/en',
      '/api/v1/i18n/overrides/fr',
    ]);
    expect(JSON.parse(storage.getItem(`${OVERRIDES_STORAGE_PREFIX}fr`)!)).toEqual({
      etag: '"fr-1"',
      values: { 'common.save': 'Sauver' },
    });
    // de asks only for de.
    server.requests.length = 0;
    await loader.loadOverrides('de');
    expect(server.requests.map((r) => r.url)).toEqual(['/api/v1/i18n/overrides/de']);
  });

  it('uses the cached copy at once, revalidates with If-None-Match, 304 keeps it', async () => {
    storage.setItem(
      `${OVERRIDES_STORAGE_PREFIX}en`,
      JSON.stringify({ etag: '"en-1"', values: { 'common.close': 'Shut' } }),
    );
    const server: FakeServer = { values: { en: { 'common.close': 'Shut' } }, etag: {}, requests: [] };
    const updates: unknown[] = [];
    const loader = createI18nLoader({ chunks: chunks(), storage: () => storage, fetch: fakeFetch(server) });
    const overrides = await loader.loadOverrides('en', { onUpdate: (l, v) => updates.push([l, v]) });
    expect(overrides).toEqual({ en: { 'common.close': 'Shut' } });
    await flush();
    expect(server.requests).toEqual([{ url: '/api/v1/i18n/overrides/en', ifNoneMatch: '"en-1"' }]);
    expect(updates).toEqual([]);
    expect(JSON.parse(storage.getItem(`${OVERRIDES_STORAGE_PREFIX}en`)!).values).toEqual({
      'common.close': 'Shut',
    });
  });

  it('replaces the cached copy on a 200 with other values and reports the update', async () => {
    storage.setItem(
      `${OVERRIDES_STORAGE_PREFIX}en`,
      JSON.stringify({ etag: '"en-1"', values: { 'common.close': 'Shut' } }),
    );
    const server: FakeServer = {
      values: { en: { 'common.close': 'Done' } },
      etag: { en: '"en-2"' },
      requests: [],
    };
    const updates: unknown[] = [];
    const loader = createI18nLoader({ chunks: chunks(), storage: () => storage, fetch: fakeFetch(server) });
    const first = await loader.loadOverrides('en', { onUpdate: (l, v) => updates.push([l, v]) });
    expect(first.en).toEqual({ 'common.close': 'Shut' });
    await flush();
    await flush();
    expect(updates).toEqual([['en', { 'common.close': 'Done' }]]);
    expect(JSON.parse(storage.getItem(`${OVERRIDES_STORAGE_PREFIX}en`)!)).toEqual({
      etag: '"en-2"',
      values: { 'common.close': 'Done' },
    });
  });

  it('keeps the cached copy on a network error, and renders without overrides when there is none', async () => {
    storage.setItem(
      `${OVERRIDES_STORAGE_PREFIX}de`,
      JSON.stringify({ etag: '"de-1"', values: { 'common.save': 'Sichern' } }),
    );
    const server: FakeServer = { values: {}, etag: {}, requests: [], fail: true };
    const loader = createI18nLoader({ chunks: chunks(), storage: () => storage, fetch: fakeFetch(server) });
    expect(await loader.loadOverrides('de')).toEqual({ de: { 'common.save': 'Sichern' } });
    await flush();
    expect(JSON.parse(storage.getItem(`${OVERRIDES_STORAGE_PREFIX}de`)!).values).toEqual({
      'common.save': 'Sichern',
    });
    expect(await loader.loadOverrides('it')).toEqual({ it: {}, en: {} });
  });

  it('does not wait longer than the boot limit and applies late overrides when they arrive', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = async (url: string, init?: RequestInit) => {
      await gate;
      return fakeFetch({ values: { nl: { 'common.save': 'Opslaan' } }, etag: {}, requests: [] })(url, init);
    };
    const updates: unknown[] = [];
    const loader = createI18nLoader({ chunks: chunks(), storage: () => storage, fetch: slow });
    const first = await loader.loadOverrides('nl', { waitMs: 5, onUpdate: (l, v) => updates.push([l, v]) });
    expect(first).toEqual({ nl: {}, en: {} });
    release();
    await flush();
    await flush();
    expect(updates).toEqual([['nl', { 'common.save': 'Opslaan' }]]);
  });
});

describe('store: merge order, overrides, switching', () => {
  const de = BUNDLES.de as Dictionary;

  it('merges fr override > fr bundle > en override > en bundle', () => {
    const base = { ...BUNDLES.en, ...BUNDLES.fr } as Dictionary;
    const dict = composeDictionary('fr', base, BUNDLES.fr as PartialDictionary, {
      en: { 'common.save': 'Save!', 'common.cancel': 'Cancel!' },
      fr: { 'common.close': 'Fermer' },
    });
    // fr has its own common.save, so the en override stays out of it; it fills the English gap.
    expect(dict['common.save' as keyof Dictionary]).toBe('Enregistrer');
    expect(dict['common.cancel' as keyof Dictionary]).toBe('Cancel!');
    expect(dict['common.close' as keyof Dictionary]).toBe('Fermer');
    // de and en take only their own overrides.
    expect(
      composeDictionary('de', de, undefined, {
        de: { 'common.save': 'Sichern' },
        en: { 'common.save': 'x' },
      })['common.save' as keyof Dictionary],
    ).toBe('Sichern');
  });

  it('applyOverride updates t and the cached copy (ETag dropped)', () => {
    storage.setItem(
      `${OVERRIDES_STORAGE_PREFIX}de`,
      JSON.stringify({ etag: '"de-7"', values: { 'common.cancel': 'Lassen' } }),
    );
    const loader = createI18nLoader({ chunks: chunks(), storage: () => storage });
    const store = createI18nStore({ locale: 'de', dictionary: de, overrides: {} }, loader);
    expect(store.getSnapshot().t('common.save')).toBe('Speichern');
    store.applyOverride('de', 'common.save', 'Sichern');
    expect(store.getSnapshot().t('common.save')).toBe('Sichern');
    expect(JSON.parse(storage.getItem(`${OVERRIDES_STORAGE_PREFIX}de`)!)).toEqual({
      etag: null,
      values: { 'common.cancel': 'Lassen', 'common.save': 'Sichern' },
    });
    store.applyOverride('de', 'common.save', null);
    expect(store.getSnapshot().t('common.save')).toBe('Speichern');
    store.applyOverrides('de', { 'common.close': 'Zu' });
    expect(store.getSnapshot().t('common.close')).toBe('Zu');
  });

  it('setLocale keeps the old dictionary until the new one is loaded, then stores the choice', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const loader = createI18nLoader({
      chunks: chunks([], {
        it: async () => {
          await gate;
          return { I18N_CHUNK: 'wl-i18n-chunk:it', dict: BUNDLES.it as PartialDictionary };
        },
      }),
      storage: () => storage,
      fetch: fakeFetch({ values: {}, etag: {}, requests: [] }),
    });
    const store = createI18nStore({ locale: 'de', dictionary: de, overrides: {} }, loader);
    let notified = 0;
    store.subscribe(() => (notified += 1));
    const switching = store.setLocale('it');
    await flush();
    expect(store.getSnapshot().locale).toBe('de');
    expect(store.getSnapshot().t('common.save')).toBe('Speichern');
    expect(notified).toBe(0);
    release();
    await switching;
    expect(store.getSnapshot().locale).toBe('it');
    expect(store.getSnapshot().t('common.save')).toBe('Salva');
    expect(store.getSnapshot().t('common.cancel')).toBe('Cancel');
    expect(storage.getItem(LOCALE_STORAGE_KEY)).toBe('it');
    expect(storage.getItem(LOCALE_VERSION_KEY)).toBe('2');
  });

  it('keeps overrides that arrive while the new chunk still loads', async () => {
    let releaseChunk: () => void = () => {};
    const chunkGate = new Promise<void>((resolve) => {
      releaseChunk = resolve;
    });
    let releaseFetch: () => void = () => {};
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const server: FakeServer = { values: { it: { 'common.close': 'Chiudi' } }, etag: {}, requests: [] };
    const loader = createI18nLoader({
      chunks: chunks([], {
        it: async () => {
          await chunkGate;
          return { I18N_CHUNK: 'wl-i18n-chunk:it', dict: BUNDLES.it as PartialDictionary };
        },
      }),
      storage: () => storage,
      fetch: async (url, init) => {
        await fetchGate;
        return fakeFetch(server)(url, init);
      },
    });
    const store = createI18nStore(
      { locale: 'de', dictionary: BUNDLES.de as Dictionary, overrides: {} },
      loader,
    );
    // The overrides are late for the boot limit (none yet), then arrive before the chunk.
    const switching = store.setLocale('it');
    await new Promise((resolve) => setTimeout(resolve, 1600));
    releaseFetch();
    await flush();
    await flush();
    releaseChunk();
    await switching;
    expect(store.getSnapshot().t('common.close')).toBe('Chiudi');
  });

  it('a failed switch rejects and keeps the locale', async () => {
    const loader = createI18nLoader({
      chunks: chunks([], {
        nl: async () => {
          throw new TypeError('offline');
        },
      }),
      storage: () => storage,
      sleep: async () => {},
      fetch: fakeFetch({ values: {}, etag: {}, requests: [] }),
    });
    const store = createI18nStore({ locale: 'de', dictionary: de, overrides: {} }, loader);
    await expect(store.setLocale('nl')).rejects.toThrow('offline');
    expect(store.getSnapshot().locale).toBe('de');
    expect(storage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });

  it('boots in the stored locale with its overrides', async () => {
    storage.setItem(LOCALE_STORAGE_KEY, 'fr');
    const loader = createI18nLoader({
      chunks: chunks(),
      storage: () => storage,
      fetch: fakeFetch({ values: { fr: { 'common.close': 'Fermer' } }, etag: {}, requests: [] }),
    });
    const boot = await bootI18n(loader);
    expect(boot.locale).toBe('fr');
    expect(boot.dictionary['common.save' as keyof Dictionary]).toBe('Enregistrer');
    expect(boot.overrides.fr).toEqual({ 'common.close': 'Fermer' });
  });
});

describe('ProfileLocaleSync rule (i18n 6.3)', () => {
  it('adopts a legacy choice once, otherwise the profile wins', () => {
    // The old toggle stored "en" without the marker; the profile still says de: save en to the profile.
    expect(profileLocaleDecision({ profile: 'de', ui: 'en', stored: 'en', storedIsCurrent: false })).toEqual({
      action: 'adopt',
      locale: 'en',
    });
    // Stored by this release (login page, picker): the profile wins.
    expect(profileLocaleDecision({ profile: 'de', ui: 'en', stored: 'en', storedIsCurrent: true })).toEqual({
      action: 'switch',
      locale: 'de',
    });
    // Nothing stored: the browser language was used before sign-in, the profile wins.
    expect(profileLocaleDecision({ profile: 'it', ui: 'en', stored: null, storedIsCurrent: false })).toEqual({
      action: 'switch',
      locale: 'it',
    });
    expect(profileLocaleDecision({ profile: 'nl', ui: 'nl', stored: 'nl', storedIsCurrent: false })).toEqual({
      action: 'none',
    });
  });

  it('reads the stored choice and its marker from localStorage', () => {
    expect(storedLocale()).toBeNull();
    storage.setItem(LOCALE_STORAGE_KEY, 'en');
    expect(storedLocale()).toBe('en');
    expect(storedLocaleIsCurrent()).toBe(false);
    storage.setItem(LOCALE_VERSION_KEY, '2');
    expect(storedLocaleIsCurrent()).toBe(true);
    storage.setItem(LOCALE_STORAGE_KEY, 'es');
    expect(storedLocale()).toBeNull();
  });
});
