import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { DEFAULT_GLOSSARY } from '@weblion/shared/i18n/glossary';
import { buildCatalog, repositoryStamps, type CatalogSources } from '@weblion/shared/i18n/catalog';
import { SECTION_SOURCES } from '@weblion/shared/i18n/server';
import { LEGAL_KEYS, type I18nOverridesDto, type Locale, type ServerTranslationKey } from '@weblion/shared';
import { translationGlossary, translationOverrides } from '../src/db/schema';
import { deleteDemoOverrides, revertOverride, saveOverride, setReviewed } from '../src/i18n/entries';
import { loadGlossary, seedGlossary } from '../src/i18n/glossary';
import { sourceHash } from '../src/i18n/hash';
import { I18nService } from '../src/i18n/service';
import { etagMatches } from '../src/modules/i18n/routes';
import { ADMIN, Client, createTestApp, json, type TestApp } from './helpers';

let t: TestApp;
const log = pino({ level: 'silent' });

/**
 * The repository's German and English texts (with the English stamps) and no compiled fr, it or nl text: the
 * fallback chain and the legal substitution need a target locale without a translation, which the repository
 * no longer has. Every service of this file runs on it, except one legal-key test on the repository catalog.
 */
const catalog = buildCatalog(
  Object.fromEntries(
    Object.entries(SECTION_SOURCES).map(([section, texts]) => [section, { de: texts.de, en: texts.en }]),
  ) as CatalogSources,
  { en: repositoryStamps().en },
);

const NOTICE = 'ai.notice.text' satisfies ServerTranslationKey;

function overrides(locale: string, headers: Record<string, string> = {}) {
  return t.app.inject({ method: 'GET', url: `/api/v1/i18n/overrides/${locale}`, headers });
}

async function put(
  key: string,
  locale: Locale,
  value: string,
  extra: { demo?: boolean; hash?: string } = {},
) {
  await saveOverride(t.db, {
    key,
    locale,
    value,
    origin: extra.demo ? 'ai' : 'manual',
    reviewed: !extra.demo,
    sourceHash: extra.hash ?? t.ctx.i18n.source(key as ServerTranslationKey).hash,
    demo: extra.demo,
    userId: null,
  });
}

/** The payload values without the legal substitutions (asserted on their own below). */
function plain(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).filter(([k]) => !(LEGAL_KEYS as readonly string[]).includes(k)),
  );
}

/** A second service on the same database with another environment (no second app: that would reset it). */
function serviceWith(env: Partial<typeof t.ctx.env>): I18nService {
  return new I18nService(t.db, { ...t.ctx.env, ...env }, log, catalog);
}

beforeAll(async () => {
  t = await createTestApp({ i18nCatalog: catalog });
});

afterAll(async () => {
  await t?.close();
});

beforeEach(async () => {
  await t.db.delete(translationOverrides);
  await t.ctx.i18n.reload();
});

describe('sourceHash', () => {
  it('is 16 hex characters of SHA-256 over NFC', () => {
    expect(sourceHash('Rechnung')).toMatch(/^[0-9a-f]{16}$/);
    // "ü" composed and decomposed are the same text.
    expect(sourceHash('Grüsse')).toBe(sourceHash('Grüsse'));
    expect(sourceHash('a')).not.toBe(sourceHash('b'));
  });
});

describe('A1 GET /i18n/overrides/:locale', () => {
  it('answers without a cookie, with ETag and no-cache, and 304 for the same tag', async () => {
    await put('common.actions', 'fr', 'Actions');
    await t.ctx.i18n.reload();
    const res = await overrides('fr');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
    const etag = res.headers.etag as string;
    expect(etag).toMatch(/^"[0-9a-f]{16}"$/);
    const body = json<I18nOverridesDto>(res);
    expect(body.locale).toBe('fr');
    expect(plain(body.values)).toEqual({ 'common.actions': 'Actions' });

    const again = await overrides('fr', { 'if-none-match': etag });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');
    expect((await overrides('fr', { 'if-none-match': `W/${etag}` })).statusCode).toBe(304);
    expect((await overrides('fr', { 'if-none-match': `"other", ${etag}` })).statusCode).toBe(304);
    expect((await overrides('fr', { 'if-none-match': '"other"' })).statusCode).toBe(200);
  });

  it('answers 404 for a locale outside the five', async () => {
    for (const locale of ['es', 'xx', 'FR', 'de-CH']) {
      const res = await overrides(locale);
      expect(res.statusCode).toBe(404);
      expect(json(res).error.code).toBe('not_found');
    }
  });

  it('leaves out orphan rows and the server-only sections', async () => {
    const emailKey = t.ctx.i18n.catalog.keys.find((k) => k.startsWith('email.'))!;
    const pdfKey = t.ctx.i18n.catalog.keys.find((k) => k.startsWith('pdf.'))!;
    await put('common.add', 'it', 'Aggiungi');
    await put(emailKey, 'it', 'Oggetto');
    await put(pdfKey, 'it', 'Fattura');
    await put('gone.key.removed', 'it', 'Vecchio', { hash: sourceHash('x') });
    await t.ctx.i18n.reload();
    expect(plain(json<I18nOverridesDto>(await overrides('it')).values)).toEqual({ 'common.add': 'Aggiungi' });
    // The mails still use them.
    expect(t.ctx.i18n.t('it', emailKey as ServerTranslationKey)).toBe('Oggetto');
  });

  it('is deterministic and changes its tag after a write', async () => {
    const empty = await overrides('nl');
    await put('common.add', 'nl', 'Toevoegen');
    await put('common.actions', 'nl', 'Acties');
    await t.ctx.i18n.reload();
    const first = await overrides('nl');
    expect(first.headers.etag).not.toBe(empty.headers.etag);
    expect(Object.keys(json<I18nOverridesDto>(first).values)).toEqual([
      'ai.notice.text',
      'ai.notice.title',
      'common.actions',
      'common.add',
    ]);
    // Another instance computes the same tag from the same rows.
    const other = serviceWith({});
    await other.load();
    expect(other.payload('nl').etag).toBe(first.headers.etag);
  });

  it('matches If-None-Match lists and weak tags', () => {
    expect(etagMatches(undefined, '"a"')).toBe(false);
    expect(etagMatches('"a"', '"a"')).toBe(true);
    expect(etagMatches('W/"a"', '"a"')).toBe(true);
    expect(etagMatches('"b", W/"a"', '"a"')).toBe(true);
    expect(etagMatches('"b"', '"a"')).toBe(false);
  });
});

describe('t() and the fallback chain', () => {
  it('falls back fr -> en -> de and finally to the key', () => {
    const catalog = buildCatalog(
      {
        core: {
          de: { a: 'A de', b: 'B de', c: 'C {n} de' },
          en: { a: 'A en', b: 'B en' },
          fr: { a: 'A fr' },
        },
      },
      {},
    );
    const i18n = new I18nService(t.db, t.ctx.env, log, catalog);
    expect(i18n.t('fr', 'a' as ServerTranslationKey)).toBe('A fr');
    expect(i18n.t('fr', 'b' as ServerTranslationKey)).toBe('B en');
    expect(i18n.t('fr', 'c' as ServerTranslationKey, { n: 3 })).toBe('C 3 de');
    expect(i18n.t('it', 'a' as ServerTranslationKey)).toBe('A en');
    expect(i18n.t('de', 'b' as ServerTranslationKey)).toBe('B de');
    expect(i18n.t('fr', 'nowhere' as ServerTranslationKey)).toBe('nowhere');
    expect(i18n.translator('en')('a' as ServerTranslationKey)).toBe('A en');
  });

  it('prefers an override of the locale, and an English override in French without a French value', async () => {
    const en = t.ctx.i18n.catalog.bundles.en['common.add']!;
    expect(t.ctx.i18n.t('fr', 'common.add')).toBe(en);
    await put('common.add', 'en', 'Add it');
    await t.ctx.i18n.reload();
    expect(t.ctx.i18n.t('fr', 'common.add')).toBe('Add it');
    await put('common.add', 'fr', 'Ajouter');
    await t.ctx.i18n.reload();
    expect(t.ctx.i18n.t('fr', 'common.add')).toBe('Ajouter');
    expect(t.ctx.i18n.t('nl', 'common.add')).toBe('Add it');
    expect(t.ctx.i18n.t('de', 'common.add')).toBe(t.ctx.i18n.catalog.bundles.de['common.add']);
  });

  it('applies overrides to the permission labels of /meta', async () => {
    await put('perm.ai:use', 'en', 'Use the AI');
    await t.ctx.i18n.reload();
    const admin = new Client(t.app);
    await admin.login(ADMIN.email, ADMIN.password);
    const meta = json<{ permissions: Record<string, { label: { de: string; en: string } }> }>(
      await admin.get('/meta'),
    );
    expect(meta.permissions['ai:use']!.label).toEqual({ de: 'KI-Funktionen verwenden', en: 'Use the AI' });
  });
});

describe('demo rows', () => {
  it('are served only with the demo provider and without ANTHROPIC_API_KEY', async () => {
    await put('common.add', 'fr', '[FR] Hinzufügen', { demo: true });
    await t.ctx.i18n.reload();
    // The test app runs with ENABLE_DEMO_PROVIDER=true and no key.
    expect(json<I18nOverridesDto>(await overrides('fr')).values['common.add']).toBe('[FR] Hinzufügen');
    expect(t.ctx.i18n.t('fr', 'common.add')).toBe('[FR] Hinzufügen');

    const production = serviceWith({ ENABLE_DEMO_PROVIDER: false });
    await production.load();
    expect(production.payload('fr').body.values['common.add']).toBeUndefined();
    expect(production.t('fr', 'common.add')).toBe(t.ctx.i18n.catalog.bundles.en['common.add']);
    expect(production.cell('fr', 'common.add')).toMatchObject({ hidden: true, demo: true, origin: 'repo' });

    const withKey = serviceWith({ ENABLE_DEMO_PROVIDER: true, ANTHROPIC_API_KEY: 'sk-ant-test-0000' });
    await withKey.load();
    expect(withKey.payload('fr').body.values['common.add']).toBeUndefined();
    expect(withKey.t('fr', 'common.add')).toBe(t.ctx.i18n.catalog.bundles.en['common.add']);
  });

  it('are deleted by deleteDemoOverrides, other rows stay', async () => {
    await put('common.add', 'fr', '[FR] Hinzufügen', { demo: true });
    await put('common.add', 'it', '[IT] Hinzufügen', { demo: true });
    await put('common.actions', 'fr', 'Actions');
    expect(await deleteDemoOverrides(t.db)).toBe(2);
    const rows = await t.db.select().from(translationOverrides);
    expect(rows.map((r) => `${r.locale}:${r.key}`)).toEqual(['fr:common.actions']);
  });
});

describe('legal keys', () => {
  it('never serve a stale translation: French falls back to English, then to German', async () => {
    const en = t.ctx.i18n.catalog.bundles.en[NOTICE]!;
    await put(NOTICE, 'fr', 'Avis obsolète', { hash: sourceHash('an older German notice') });
    await t.ctx.i18n.reload();
    expect(t.ctx.i18n.t('fr', NOTICE)).toBe(en);
    expect(t.ctx.i18n.payload('fr').body.values[NOTICE]).toBe(en);
    expect(t.ctx.i18n.cell('fr', NOTICE)).toMatchObject({ hidden: true, value: null, state: 'missing' });

    // A German edit makes every translation stale, the compiled English included.
    await put(NOTICE, 'de', 'Neuer Hinweis zu den Daten.', {
      hash: sourceHash(t.ctx.i18n.catalog.bundles.de[NOTICE]!),
    });
    await t.ctx.i18n.reload();
    expect(t.ctx.i18n.t('de', NOTICE)).toBe('Neuer Hinweis zu den Daten.');
    expect(t.ctx.i18n.payload('de').body.values[NOTICE]).toBe('Neuer Hinweis zu den Daten.');
    expect(t.ctx.i18n.t('en', NOTICE)).toBe('Neuer Hinweis zu den Daten.');
    expect(t.ctx.i18n.t('fr', NOTICE)).toBe('Neuer Hinweis zu den Daten.');
    expect(t.ctx.i18n.payload('fr').body.values[NOTICE]).toBe('Neuer Hinweis zu den Daten.');
    expect(t.ctx.i18n.payload('en').body.values[NOTICE]).toBe('Neuer Hinweis zu den Daten.');
    expect(t.ctx.i18n.cell('en', NOTICE)).toMatchObject({ origin: 'repo', state: 'stale' });
    expect(t.ctx.i18n.cell('de', NOTICE)).toMatchObject({ origin: 'manual', state: 'current' });

    // An English translation written against the new German text is served again, in fr too.
    await put(NOTICE, 'en', 'New notice about the data.');
    await t.ctx.i18n.reload();
    expect(t.ctx.i18n.t('fr', NOTICE)).toBe('New notice about the data.');
    expect(t.ctx.i18n.payload('fr').body.values[NOTICE]).toBe('New notice about the data.');
  });

  it('carry the served text in the payload of a locale without a compiled translation', async () => {
    // fr has no compiled notice in this catalog: the payload names the current English text, so the web
    // never needs to work out on its own whether a translation is current.
    for (const key of LEGAL_KEYS) {
      expect(t.ctx.i18n.payload('fr').body.values[key]).toBe(t.ctx.i18n.catalog.bundles.en[key]);
    }
  });

  it('serve the compiled, stamped notices of the repository while current, German once they are stale', async () => {
    // The repository catalog, the one production runs on: fr, it and nl ship a compiled notice with its stamp.
    const repo = new I18nService(t.db, t.ctx.env, log, buildCatalog());
    await repo.reload();
    for (const locale of ['fr', 'it', 'nl'] as const) {
      expect(repo.catalog.stamps[locale][NOTICE]?.[0]).toBe(repo.source(NOTICE).hash);
      expect(repo.t(locale, NOTICE)).toBe(repo.catalog.bundles[locale][NOTICE]);
      expect(repo.payload(locale).body.values[NOTICE]).toBeUndefined();
    }

    // A German override makes every compiled stamp stale: no outdated notice is served, the German one is.
    await put(NOTICE, 'de', 'Neuer Hinweis zu den Daten.', {
      hash: sourceHash(repo.catalog.bundles.de[NOTICE]!),
    });
    await repo.reload();
    for (const locale of ['fr', 'it', 'nl', 'en'] as const) {
      expect(repo.t(locale, NOTICE)).toBe('Neuer Hinweis zu den Daten.');
      expect(repo.payload(locale).body.values[NOTICE]).toBe('Neuer Hinweis zu den Daten.');
    }
  });

  it('serve a current translation and leave the payload alone when the compiled text is current', async () => {
    expect(t.ctx.i18n.payload('en').body.values[NOTICE]).toBeUndefined();
    expect(t.ctx.i18n.t('en', NOTICE)).toBe(t.ctx.i18n.catalog.bundles.en[NOTICE]);
    await put(NOTICE, 'fr', 'Avis actuel.');
    await t.ctx.i18n.reload();
    expect(t.ctx.i18n.t('fr', NOTICE)).toBe('Avis actuel.');
    expect(t.ctx.i18n.cell('fr', NOTICE)).toMatchObject({ value: 'Avis actuel.', state: 'current' });
  });
});

describe('cells', () => {
  it('report origin, state and review for overrides and compiled values', async () => {
    expect(t.ctx.i18n.cell('fr', 'common.add')).toMatchObject({
      value: null,
      state: 'missing',
      origin: 'repo',
    });
    expect(t.ctx.i18n.cell('en', 'common.add')).toMatchObject({
      value: t.ctx.i18n.catalog.bundles.en['common.add'],
      state: 'current',
      origin: 'repo',
      reviewed: true,
    });
    await saveOverride(t.db, {
      key: 'common.add',
      locale: 'fr',
      value: 'Ajouter',
      origin: 'ai',
      reviewed: false,
      sourceHash: sourceHash('an older German text'),
      userId: null,
    });
    await t.ctx.i18n.reload();
    expect(t.ctx.i18n.cell('fr', 'common.add')).toMatchObject({
      value: 'Ajouter',
      origin: 'ai',
      reviewed: false,
      state: 'stale',
      hidden: false,
    });
    expect(await setReviewed(t.db, 'common.add', 'fr', true, (await adminId())!)).toBe(true);
    expect(await setReviewed(t.db, 'common.add', 'it', true, (await adminId())!)).toBe(false);
    await t.ctx.i18n.reload();
    expect(t.ctx.i18n.cell('fr', 'common.add')).toMatchObject({
      reviewed: true,
      updatedBy: { id: await adminId(), name: 'weblion Admin' },
    });
    expect(await revertOverride(t.db, 'common.add', 'fr')).toBe(true);
    expect(await revertOverride(t.db, 'common.add', 'fr')).toBe(false);
  });

  it('flags a German override as stale once the repository text differs from the one it was written against', async () => {
    await put('common.add', 'de', 'Dazufügen', { hash: sourceHash('Hinzufügen (alt)') });
    await t.ctx.i18n.reload();
    expect(t.ctx.i18n.cell('de', 'common.add')).toMatchObject({ value: 'Dazufügen', state: 'stale' });
    // The German override is the source now: the compiled English is stale against it.
    expect(t.ctx.i18n.source('common.add')).toEqual({ text: 'Dazufügen', hash: sourceHash('Dazufügen') });
    expect(t.ctx.i18n.cell('en', 'common.add').state).toBe('stale');
  });

  it('carry the soft check warnings of the value', async () => {
    await put('common.add', 'fr', 'Ajouter : maintenant');
    await t.ctx.i18n.reload();
    expect(t.ctx.i18n.cell('fr', 'common.add').warnings).toContain('typography');
  });
});

describe('refresh and reload', () => {
  it('sees a direct insert after reload(), and refresh() reloads only when something changed', async () => {
    const before = t.ctx.i18n.payload('it').etag;
    await t.db.insert(translationOverrides).values({
      key: 'common.add',
      locale: 'it',
      value: 'Aggiungi',
      origin: 'manual',
      sourceHash: t.ctx.i18n.source('common.add').hash,
      reviewed: true,
    });
    expect(t.ctx.i18n.t('it', 'common.add')).not.toBe('Aggiungi');
    expect(await t.ctx.i18n.refresh()).toBe(true);
    expect(t.ctx.i18n.t('it', 'common.add')).toBe('Aggiungi');
    expect(t.ctx.i18n.payload('it').etag).not.toBe(before);
    expect(await t.ctx.i18n.refresh()).toBe(false);

    await t.db
      .update(translationOverrides)
      .set({ value: 'Aggiungere', updatedAt: sql`now() + interval '1 second'` })
      .where(eq(translationOverrides.locale, 'it'));
    expect(await t.ctx.i18n.refresh()).toBe(true);
    expect(t.ctx.i18n.t('it', 'common.add')).toBe('Aggiungere');

    await t.db.delete(translationOverrides);
    await t.ctx.i18n.reload();
    expect(t.ctx.i18n.t('it', 'common.add')).toBe(t.ctx.i18n.catalog.bundles.en['common.add']);
  });
});

describe('glossary', () => {
  it('is seeded at start and never overwrites an edited built-in term', async () => {
    const rows = await t.db.select().from(translationGlossary);
    expect(rows).toHaveLength(new Set(DEFAULT_GLOSSARY.map((g) => g.term.toLowerCase())).size);
    expect(rows.every((r) => r.builtIn)).toBe(true);

    const first = DEFAULT_GLOSSARY[0]!;
    await t.db
      .update(translationGlossary)
      .set({ note: 'edited by staff' })
      .where(eq(translationGlossary.term, first.term));
    await seedGlossary(t.db);
    await seedGlossary(t.db);
    const again = await t.db.select().from(translationGlossary);
    expect(again).toHaveLength(rows.length);
    expect(again.find((r) => r.term === first.term)!.note).toBe('edited by staff');

    const loaded = await loadGlossary(t.db);
    expect(loaded).toHaveLength(rows.length);
    expect(loaded.find((g) => g.term === first.term)).toMatchObject({
      keep: first.keep,
      note: 'edited by staff',
    });
  });
});

async function adminId(): Promise<string | undefined> {
  const user = await t.db.query.users.findFirst({ where: (u, { eq: e }) => e(u.email, ADMIN.email) });
  return user?.id;
}
