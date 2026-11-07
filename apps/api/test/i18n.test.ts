import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  PLATFORM_ROLE_POLICIES,
  type GlossaryEntryDto,
  type Locale,
  type Paginated,
  type ServerTranslationKey,
  type StyleNotesDto,
  type TranslationCleanupResultDto,
  type TranslationEditResultDto,
  type TranslationEntryDto,
  type TranslationImportResultDto,
  type TranslationSuggestDto,
  type TranslationSummaryDto,
} from '@weblion/shared';
import {
  aiUsage,
  auditLogs,
  translationGlossary,
  translationJobs,
  translationOverrides,
  users,
} from '../src/db/schema';
import { loadCatalog } from '@weblion/shared/i18n/catalog';
import { checkValue } from '@weblion/shared/i18n/checks';
import { DEFAULT_GLOSSARY } from '@weblion/shared/i18n/glossary';
import { insertI18nDemo } from '../src/db/seed-i18n';
import { saveOverride } from '../src/i18n/entries';
import { seedGlossary } from '../src/i18n/glossary';
import { sourceHash } from '../src/i18n/hash';
import { hashPassword } from '../src/lib/crypto';
import { startClaudeMock, type MockTurn } from './claude-mock';
import { ADMIN, Client, configureAi, createTestApp, DEMO_PASSWORD, json, type TestApp } from './helpers';
import { STALE_FR, testCatalog } from './i18n-fixtures';
import { SECTION_SOURCES } from '@weblion/shared/i18n/server';
import { parseImportFile } from '../src/i18n/import';
import { literal, planApply, planFiles, replaceInPlace, SECTIONS_DIR } from '../scripts/i18n-apply';
import { reportSection } from '../scripts/i18n-report';
import { STAMPS_DIR } from '../scripts/i18n-stamp';

/** The translation admin A2 to A16 and B1, B4 to B6 without a running job (i18n 20.2 group "admin"). */

let t: TestApp;
let mock: Awaited<ReturnType<typeof startClaudeMock>>;
let admin: Client;
let support: Client;
let adminId: string;

/** Copies of the shared section and stamp files for the i18n:apply test. */
const temp = mkdtempSync(join(tmpdir(), 'wl-i18n-apply-'));

const SHARP_S = '\u00DF';
const EM_DASH = '\u2014';
const NBSP = '\u00A0';

const hashOf = (key: string) => t.ctx.i18n.source(key as ServerTranslationKey).hash;

async function put(
  key: string,
  locale: Locale,
  value: string,
  extra: { origin?: 'manual' | 'ai'; reviewed?: boolean; demo?: boolean; hash?: string } = {},
) {
  await saveOverride(t.db, {
    key,
    locale,
    value,
    origin: extra.origin ?? 'manual',
    reviewed: extra.reviewed ?? extra.origin !== 'ai',
    sourceHash:
      extra.hash ??
      (locale === 'de'
        ? sourceHash(t.ctx.i18n.catalog.bundles.de[key as ServerTranslationKey] ?? key)
        : hashOf(key)),
    demo: extra.demo,
    userId: adminId,
  });
}

const entries = (query: Record<string, string>, client = admin) =>
  client.get(`/admin/i18n/entries?${new URLSearchParams(query).toString()}`);
const keysOf = (res: { json(): unknown }) =>
  (res.json() as Paginated<TranslationEntryDto>).items.map((e) => e.key);
const cellUrl = (locale: string, key: string) => `/admin/i18n/entries/${locale}/${encodeURIComponent(key)}`;

/** The audit entries of an action, newest first. */
async function audits(action: string) {
  return t.db.select().from(auditLogs).where(eq(auditLogs.action, action)).orderBy(desc(auditLogs.id));
}

/** The mock answers every item with fn(item); the batch is the user turn of the request. */
function answerWith(
  fn: (item: { id: string; key: string; de: string }, locale: string) => string | undefined,
) {
  mock.setScript((body): MockTurn => {
    const batch = JSON.parse(body.messages.at(-1).content) as {
      locale: string;
      items: { id: string; key: string; de: string }[];
    };
    return {
      json: {
        items: batch.items
          .map((item) => ({ id: item.id, text: fn(item, batch.locale) }))
          .filter((i) => i.text !== undefined),
      },
    };
  });
}

beforeAll(async () => {
  mock = await startClaudeMock();
  t = await createTestApp({ env: { ANTHROPIC_BASE_URL: mock.url }, i18nCatalog: testCatalog() });
  admin = new Client(t.app);
  await admin.login(ADMIN.email, ADMIN.password);
  adminId = (await t.db.query.users.findFirst({ where: eq(users.email, ADMIN.email) }))!.id;
  await t.db.insert(users).values({
    email: 'support@weblion.test',
    name: 'Support',
    passwordHash: await hashPassword(DEMO_PASSWORD),
    platformRole: 'support',
  });
  support = new Client(t.app);
  await support.login('support@weblion.test');
  await configureAi(admin);
});

afterAll(async () => {
  await t?.close();
  await mock?.close();
  rmSync(temp, { recursive: true, force: true });
});

beforeEach(async () => {
  await t.db.delete(translationOverrides);
  await t.db.delete(translationJobs);
  await t.db.delete(aiUsage);
  await t.ctx.i18n.reload();
  mock.requests.length = 0;
  answerWith((item, locale) => `[${locale}] ${item.de}`);
});

describe('permissions', () => {
  const uuid = '00000000-0000-4000-8000-000000000000';
  const scope = { locales: ['fr'], selection: 'untranslated', replaceManual: false };
  const ROUTES: { method: string; url: string; body?: unknown; kind: 'read' | 'write' | 'ai' }[] = [
    { method: 'GET', url: '/admin/i18n/summary', kind: 'read' },
    { method: 'GET', url: '/admin/i18n/entries', kind: 'read' },
    { method: 'PUT', url: cellUrl('fr', 'common.edit'), body: { value: 'Modifier' }, kind: 'write' },
    { method: 'DELETE', url: cellUrl('fr', 'common.edit'), kind: 'write' },
    {
      method: 'POST',
      url: `${cellUrl('fr', 'common.edit')}/review`,
      body: { reviewed: true },
      kind: 'write',
    },
    { method: 'POST', url: `${cellUrl('fr', 'common.edit')}/confirm`, kind: 'write' },
    {
      method: 'POST',
      url: '/admin/i18n/cleanup',
      body: { orphans: true, sameAsCompiled: true, demo: true, dryRun: true },
      kind: 'write',
    },
    { method: 'GET', url: '/admin/i18n/glossary', kind: 'read' },
    {
      method: 'POST',
      url: '/admin/i18n/glossary',
      body: { term: 'Permissions-Test', keep: true, translations: {} },
      kind: 'write',
    },
    { method: 'PATCH', url: `/admin/i18n/glossary/${uuid}`, body: { keep: true }, kind: 'write' },
    { method: 'DELETE', url: `/admin/i18n/glossary/${uuid}`, kind: 'write' },
    { method: 'GET', url: '/admin/i18n/style', kind: 'read' },
    { method: 'PUT', url: '/admin/i18n/style/fr', body: { notes: '' }, kind: 'write' },
    {
      method: 'POST',
      url: '/admin/i18n/import',
      body: { data: { format: 'weblion-i18n-locale', version: 1, locale: 'fr', entries: {} }, dryRun: true },
      kind: 'write',
    },
    { method: 'GET', url: '/admin/i18n/export?scope=overrides', kind: 'read' },
    {
      method: 'POST',
      url: '/admin/i18n/ai/suggest',
      body: { key: 'common.edit', locales: ['fr'] },
      kind: 'ai',
    },
    { method: 'POST', url: '/admin/i18n/ai/estimate', body: scope, kind: 'ai' },
    { method: 'POST', url: '/admin/i18n/ai/jobs', body: { scope, confirmCostMicros: 0 }, kind: 'ai' },
    { method: 'GET', url: '/admin/i18n/ai/jobs', kind: 'read' },
    { method: 'GET', url: `/admin/i18n/ai/jobs/${uuid}`, kind: 'read' },
    { method: 'POST', url: `/admin/i18n/ai/jobs/${uuid}/cancel`, kind: 'write' },
    {
      method: 'POST',
      url: `/admin/i18n/ai/jobs/${uuid}/retry`,
      body: { scope, confirmCostMicros: 0 },
      kind: 'ai',
    },
  ];

  it('asks for a session on every route', async () => {
    const anonymous = new Client(t.app);
    for (const route of ROUTES) {
      const res = await anonymous.request(route.method, route.url, route.body);
      expect(res.statusCode, `${route.method} ${route.url}`).toBe(401);
    }
  });

  it('lets support read and refuses every write and every AI route', async () => {
    for (const route of ROUTES) {
      const res = await support.request(route.method, route.url, route.body);
      if (route.kind === 'read') {
        expect([200, 404], `${route.method} ${route.url}: ${res.body}`).toContain(res.statusCode);
      } else {
        expect(res.statusCode, `${route.method} ${route.url}`).toBe(403);
        expect(json(res).error.code).toBe('forbidden');
      }
    }
  });

  it('refuses only the AI routes to a superadmin without platform:ai:use', async () => {
    const original = PLATFORM_ROLE_POLICIES.superadmin;
    PLATFORM_ROLE_POLICIES.superadmin = [
      ...original,
      { sid: 'NoAi', effect: 'deny', actions: ['platform:ai:use'] },
    ];
    try {
      const restricted = new Client(t.app);
      await restricted.login(ADMIN.email, ADMIN.password);
      for (const route of ROUTES) {
        const res = await restricted.request(route.method, route.url, route.body);
        if (route.kind === 'ai') expect(res.statusCode, `${route.method} ${route.url}`).toBe(403);
        else expect(res.statusCode, `${route.method} ${route.url}: ${res.body}`).not.toBe(403);
      }
    } finally {
      PLATFORM_ROLE_POLICIES.superadmin = original;
    }
  });
});

describe('A2 summary', () => {
  it('counts per locale, lists areas and sections, orphans, applied and demo rows, AI and the active job', async () => {
    await put('common.save', 'fr', 'Enregistrer'); // equal to the compiled text
    await put('gone.key', 'fr', 'Ancien', { hash: sourceHash('x') });
    await put('nav.billing', 'it', '[IT] Abrechnung', { origin: 'ai', demo: true });
    await put('nav.dashboard', 'fr', "Vue d'ensemble", { origin: 'ai', reviewed: false });
    await t.ctx.i18n.reload();
    const res = await admin.get('/admin/i18n/summary');
    expect(res.statusCode).toBe(200);
    const summary = json<TranslationSummaryDto>(res);
    const total = t.ctx.i18n.catalog.keys.length;
    expect(summary.keys).toBe(total);
    expect(summary.locales.map((l) => l.locale)).toEqual(['de', 'en', 'fr', 'it', 'nl']);
    const fr = summary.locales.find((l) => l.locale === 'fr')!;
    expect(fr.total).toBe(total);
    expect(fr.translated + fr.missing).toBe(total);
    expect(fr.stale).toBe(STALE_FR.length);
    expect(fr.ai).toBe(1);
    expect(fr.unreviewed).toBe(1);
    expect(fr.overrides).toBe(2);
    expect(fr.completeness).toBeCloseTo(fr.translated / total);
    expect(summary.locales[0]).toMatchObject({ locale: 'de', missing: 0, translated: total });
    expect(summary.orphans).toBe(1);
    expect(summary.sameAsCompiled).toBe(1);
    expect(summary.demoOverrides).toBe(1);
    expect(summary.areas).toContainEqual({ area: 'admin', keys: 3 });
    expect(summary.sections.map((s) => s.section)).toEqual(['core', 'admin', 'ai', 'email']);
    expect(summary.legal.keys).toEqual(['ai.notice.title', 'ai.notice.text']);
    // fr has a current notice title but no text; it and nl have neither.
    expect(summary.legal.staleOrMissing).toEqual({
      fr: ['ai.notice.text'],
      it: ['ai.notice.title', 'ai.notice.text'],
      nl: ['ai.notice.title', 'ai.notice.text'],
    });
    expect(summary.ai).toMatchObject({ available: true, reason: null, demo: false });
    expect(summary.activeJob).toBeNull();
  });
});

describe('A3 entries', () => {
  beforeEach(async () => {
    await put('nav.dashboard', 'fr', "Vue d'ensemble"); // changed, current
    await put('common.delete', 'fr', 'Supprimer', { hash: sourceHash('Entfernen') }); // stale override
    await put('nav.billing', 'it', 'Fatturazione', { origin: 'ai', reviewed: false }); // unreviewed
    await put('nav.settings', 'nl', 'Instellingen', { origin: 'ai', reviewed: true }); // AI reviewed
    await put('login.hero.text', 'fr', 'Melden Sie sich an, um Ihre Server zu verwalten.'); // warnings
    await t.ctx.i18n.reload();
  });

  it('filters by state on one locale', async () => {
    const untranslated = keysOf(await entries({ locale: 'fr', filter: 'untranslated', pageSize: '200' }));
    expect(untranslated).toContain('common.edit');
    expect(untranslated).not.toContain('common.save');
    expect(untranslated).not.toContain('nav.dashboard');

    expect(keysOf(await entries({ locale: 'fr', filter: 'stale' }))).toEqual(['common.delete', ...STALE_FR]);
    expect(keysOf(await entries({ locale: 'fr', filter: 'changed' }))).toEqual([
      'common.delete',
      'nav.dashboard',
      'login.hero.text',
    ]);
    expect(keysOf(await entries({ filter: 'ai' }))).toEqual(['nav.billing', 'nav.settings']);
    expect(keysOf(await entries({ filter: 'unreviewed' }))).toEqual(['nav.billing']);
    const attention = keysOf(await entries({ locale: 'fr', filter: 'attention', pageSize: '200' }));
    expect(attention).toEqual(expect.arrayContaining(['common.edit', 'common.delete', 'login.hero.text']));
    expect(attention).not.toContain('nav.dashboard');
    expect(keysOf(await entries({ locale: 'it', filter: 'attention', pageSize: '200' }))).toContain(
      'nav.billing',
    );
    // de with "changed" lists German edits.
    await put('nav.servers', 'de', 'Maschinen');
    await t.ctx.i18n.reload();
    expect(keysOf(await entries({ locale: 'de', filter: 'changed' }))).toEqual(['nav.servers']);
  });

  it('marks the warnings of a value', async () => {
    const [entry] = json<Paginated<TranslationEntryDto>>(await entries({ keys: 'login.hero.text' })).items;
    expect(entry!.cells.fr.warnings).toContain('german');
    expect(entry!.cells.fr.origin).toBe('manual');
    expect(entry!.cells.de.value).toBe('Melden Sie sich an, um Ihre Server zu verwalten.');
  });

  it('searches with accent folding and finds a key first', async () => {
    expect(keysOf(await entries({ q: 'facture' }))).toContain('billing.invoice.status.invoiced');
    expect(keysOf(await entries({ q: 'Grusse' }))).toEqual(['mail.greeting']);
    expect(keysOf(await entries({ q: "VUE D'ENSEMBLE" }))).toEqual(['nav.dashboard']);
    const notice = keysOf(await entries({ q: 'ai.notice.text' }));
    // help.notice comes before ai.notice.text in the catalog, but the key itself is listed first (O18).
    expect(notice[0]).toBe('ai.notice.text');
    expect(notice).toContain('help.notice');
  });

  it('narrows by area, section and keys, pages in catalog order', async () => {
    const admins = keysOf(await entries({ area: 'admin' }));
    expect(admins).toEqual(['admin.ai.title', 'admin.ai.subtitle', 'admin.users.title']);
    expect(keysOf(await entries({ area: 'ai' }))).toEqual([
      'ai.notice.title',
      'ai.notice.text',
      'ai.assistant.title',
      'ai.assistant.placeholder',
    ]);
    expect(keysOf(await entries({ section: 'email' }))).toEqual([
      'email.invitation.subject',
      'email.invitation.text',
    ]);
    expect(keysOf(await entries({ keys: 'nav.servers,common.save,gone.key' }))).toEqual([
      'common.save',
      'nav.servers',
    ]);
    const page = json<Paginated<TranslationEntryDto>>(await entries({ pageSize: '5', page: '2' }));
    expect(page.total).toBe(t.ctx.i18n.catalog.keys.length);
    expect(page.page).toBe(2);
    expect(page.perPage).toBe(5);
    expect(page.items.map((e) => e.key)).toEqual(t.ctx.i18n.catalog.keys.slice(5, 10));
    const [email] = json<Paginated<TranslationEntryDto>>(
      await entries({ keys: 'email.invitation.text' }),
    ).items;
    expect(email).toMatchObject({
      serverOnly: true,
      area: 'email',
      section: 'email',
      placeholders: ['name'],
    });
    expect((await entries({ locale: 'es' })).statusCode).toBe(400);
  });
});

describe('A4 save', () => {
  it('refuses wrong placeholders and forbidden characters', async () => {
    const missing = await admin.request('PUT', cellUrl('fr', 'servers.rename.title'), {
      value: 'Renommer le serveur',
    });
    expect(missing.statusCode).toBe(400);
    expect(json(missing).error).toMatchObject({
      code: 'placeholder_mismatch',
      details: { missing: ['name'], extra: [] },
    });
    const extra = await admin.request('PUT', cellUrl('fr', 'servers.rename.title'), {
      value: 'Renommer {name} {nom}',
    });
    expect(json(extra).error.details).toMatchObject({ missing: [], extra: ['nom'] });
    const breaks = await admin.request('PUT', cellUrl('fr', 'servers.delete.text'), {
      value: 'Le serveur {name} est supprimé. Irréversible.',
    });
    expect(json(breaks).error).toMatchObject({
      code: 'placeholder_mismatch',
      details: { missing: [], extra: [], lineBreaks: { expected: 1, actual: 0 } },
    });
    for (const [char, code] of [
      [SHARP_S, 'U+00DF'],
      [EM_DASH, 'U+2014'],
    ]) {
      const res = await admin.request('PUT', cellUrl('fr', 'common.edit'), { value: `Modifier ${char} ici` });
      expect(res.statusCode).toBe(400);
      expect(json(res).error).toMatchObject({ code: 'forbidden_character', details: { characters: [code] } });
    }
    expect((await admin.request('PUT', cellUrl('fr', 'gone.key'), { value: 'x' })).statusCode).toBe(404);
    expect(json(await admin.request('PUT', cellUrl('fr', 'gone.key'), { value: 'x' })).error).toMatchObject({
      code: 'unknown_key',
      details: { key: 'gone.key' },
    });
    expect((await admin.request('PUT', cellUrl('es', 'common.edit'), { value: 'x' })).statusCode).toBe(400);
    expect(await t.db.select().from(translationOverrides)).toHaveLength(0);
  });

  it('saves, fixes French spacing, returns warnings, audits and serves the value at once', async () => {
    const before = await t.app.inject({ method: 'GET', url: '/api/v1/i18n/overrides/fr' });
    const res = await admin.request('PUT', cellUrl('fr', 'billing.invoice.total'), {
      value: '  Total : {amount} ',
    });
    expect(res.statusCode).toBe(200);
    const result = json<TranslationEditResultDto>(res);
    expect(result.typographyFixed).toBe(true);
    expect(result.entry.cells.fr).toMatchObject({
      value: `Total${NBSP}: {amount}`,
      origin: 'manual',
      reviewed: true,
      state: 'current',
    });
    const [row] = await t.db
      .select()
      .from(translationOverrides)
      .where(
        and(eq(translationOverrides.key, 'billing.invoice.total'), eq(translationOverrides.locale, 'fr')),
      );
    expect(row).toMatchObject({
      value: `Total${NBSP}: {amount}`,
      origin: 'manual',
      demo: false,
      updatedBy: adminId,
    });
    expect(row!.sourceHash).toBe(hashOf('billing.invoice.total'));

    const [entry] = await audits('i18n.override_update');
    expect(entry).toMatchObject({
      orgId: null,
      resourceType: 'translation',
      resourceId: 'fr:billing.invoice.total',
    });
    expect(entry!.details).toEqual({
      key: 'billing.invoice.total',
      locale: 'fr',
      origin: 'manual',
      reviewed: true,
      before: null,
      after: `Total${NBSP}: {amount}`,
      typographyFixed: true,
    });

    const after = await t.app.inject({ method: 'GET', url: '/api/v1/i18n/overrides/fr' });
    expect(after.headers.etag).not.toBe(before.headers.etag);
    expect(json(after).values['billing.invoice.total']).toBe(`Total${NBSP}: {amount}`);

    const german = await admin.request('PUT', cellUrl('fr', 'login.hero.text'), {
      value: 'Melden Sie sich an, um Ihre Server zu verwalten.',
      reviewed: false,
    });
    expect(json<TranslationEditResultDto>(german).entry.cells.fr).toMatchObject({ reviewed: false });
    expect(json<TranslationEditResultDto>(german).entry.cells.fr.warnings).toContain('german');
  });

  it('saves a German edit against the compiled German and makes the translations stale', async () => {
    const res = await admin.request('PUT', cellUrl('de', 'nav.servers'), { value: 'Maschinen' });
    expect(res.statusCode).toBe(200);
    const { entry } = json<TranslationEditResultDto>(res);
    expect(entry.cells.de).toMatchObject({ value: 'Maschinen', state: 'current' });
    expect(entry.cells.fr.state).toBe('stale');
    expect(entry.cells.en.state).toBe('stale');
    const [row] = await t.db.select().from(translationOverrides);
    expect(row!.sourceHash).toBe(sourceHash('Server'));
  });

  it('hides overrides written before a placeholder rename and checks against the compiled German', async () => {
    // Written while the code still passed {label}; the code and the compiled German now use {name}.
    const key = 'servers.rename.title' as ServerTranslationKey;
    const oldGerman = 'Server {label} umbenennen';
    await put(key, 'de', oldGerman);
    await put(key, 'fr', 'Renommer {label}', { hash: sourceHash(oldGerman) });
    await t.ctx.i18n.reload();
    expect(t.ctx.i18n.t('de', key, { name: 'web1' })).toBe('Server web1 umbenennen');
    expect(t.ctx.i18n.t('fr', key, { name: 'web1' })).toBe('Rename server web1');
    expect(t.ctx.i18n.cell('de', key)).toMatchObject({ hidden: true, value: 'Server {name} umbenennen' });
    expect(t.ctx.i18n.cell('fr', key)).toMatchObject({ hidden: true });
    expect(t.ctx.i18n.source(key).text).toBe('Server {name} umbenennen');
    expect(
      json(await t.app.inject({ method: 'GET', url: '/api/v1/i18n/overrides/fr' })).values,
    ).not.toHaveProperty(key);

    // The corrected translation is checked against the placeholders of the code, not the old German row.
    const res = await admin.request('PUT', cellUrl('fr', key), { value: 'Renommer le serveur {name}' });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<TranslationEditResultDto>(res).entry.cells.fr).toMatchObject({
      value: 'Renommer le serveur {name}',
      state: 'current',
      hidden: false,
    });
    expect(t.ctx.i18n.t('fr', key, { name: 'web1' })).toBe('Renommer le serveur web1');
  });
});

describe('A5 to A8', () => {
  it('reverts, reviews and confirms', async () => {
    await put('common.edit', 'fr', 'Modifier', { origin: 'ai', reviewed: false });
    await t.ctx.i18n.reload();
    const reviewed = await admin.post(`${cellUrl('fr', 'common.edit')}/review`, { reviewed: true });
    expect(reviewed.statusCode).toBe(200);
    expect(json<TranslationEntryDto>(reviewed).cells.fr).toMatchObject({ origin: 'ai', reviewed: true });
    expect((await audits('i18n.override_review'))[0]!.details).toEqual({
      key: 'common.edit',
      locale: 'fr',
      reviewed: true,
    });

    const reverted = await admin.del(cellUrl('fr', 'common.edit'));
    expect(reverted.statusCode).toBe(200);
    expect(json<TranslationEntryDto>(reverted).cells.fr).toMatchObject({
      value: null,
      state: 'missing',
      origin: 'repo',
    });
    expect((await audits('i18n.override_revert'))[0]!.details).toEqual({
      key: 'common.edit',
      locale: 'fr',
      origin: 'ai',
      before: 'Modifier',
    });
    expect((await admin.del(cellUrl('fr', 'common.edit'))).statusCode).toBe(404);
    expect((await admin.post(`${cellUrl('fr', 'common.edit')}/review`, { reviewed: true })).statusCode).toBe(
      404,
    );
  });

  it('confirms a stale override and a stale compiled value, and refuses a current one', async () => {
    await put('common.delete', 'fr', 'Supprimer', { hash: sourceHash('Entfernen'), reviewed: false });
    await t.ctx.i18n.reload();
    const override = await admin.post(`${cellUrl('fr', 'common.delete')}/confirm`);
    expect(override.statusCode).toBe(200);
    expect(json<TranslationEntryDto>(override).cells.fr).toMatchObject({ state: 'current', reviewed: true });

    const compiledKey = STALE_FR[0];
    const compiled = await admin.post(`${cellUrl('fr', compiledKey)}/confirm`);
    expect(compiled.statusCode).toBe(200);
    expect(json<TranslationEntryDto>(compiled).cells.fr).toMatchObject({
      state: 'current',
      origin: 'manual',
      value: 'En marche',
    });
    const [row] = await t.db
      .select()
      .from(translationOverrides)
      .where(eq(translationOverrides.key, compiledKey));
    expect(row).toMatchObject({
      value: 'En marche',
      origin: 'manual',
      reviewed: true,
      sourceHash: hashOf(compiledKey),
    });

    for (const [locale, key] of [
      ['fr', 'common.save'],
      ['fr', 'common.edit'],
      ['de', 'common.save'],
    ]) {
      const res = await admin.post(`${cellUrl(locale!, key!)}/confirm`);
      expect(res.statusCode, `${locale}:${key}`).toBe(409);
      expect(json(res).error.code).toBe('not_stale');
    }
    expect(await audits('i18n.override_confirm')).toHaveLength(2);
  });

  it('cleans up orphans, applied changes and demo rows, counting on a dry run', async () => {
    await put('common.save', 'fr', 'Enregistrer');
    await put('gone.key', 'fr', 'Ancien', { hash: sourceHash('x') });
    await put('nav.billing', 'it', '[IT] Abrechnung', { origin: 'ai', demo: true });
    await put('nav.dashboard', 'fr', "Vue d'ensemble");
    await t.ctx.i18n.reload();
    const all = { orphans: true, sameAsCompiled: true, demo: true };
    const dry = await admin.post('/admin/i18n/cleanup', { ...all, dryRun: true });
    expect(json<TranslationCleanupResultDto>(dry)).toEqual({
      orphans: 1,
      sameAsCompiled: 1,
      demo: 1,
      dryRun: true,
    });
    expect(await t.db.select().from(translationOverrides)).toHaveLength(4);
    expect(await audits('i18n.cleanup')).toHaveLength(0);

    const noDemo = await admin.post('/admin/i18n/cleanup', {
      orphans: true,
      sameAsCompiled: false,
      demo: false,
    });
    expect(json<TranslationCleanupResultDto>(noDemo)).toEqual({
      orphans: 1,
      sameAsCompiled: 0,
      demo: 0,
      dryRun: false,
    });
    const rest = await admin.post('/admin/i18n/cleanup', all);
    expect(json<TranslationCleanupResultDto>(rest)).toEqual({
      orphans: 0,
      sameAsCompiled: 1,
      demo: 1,
      dryRun: false,
    });
    const left = await t.db.select().from(translationOverrides);
    expect(left.map((r) => `${r.locale}:${r.key}`)).toEqual(['fr:nav.dashboard']);
    expect((await audits('i18n.cleanup')).map((a) => a.details)).toContainEqual({
      orphans: 0,
      sameAsCompiled: 1,
      demo: 1,
      deleted: 2,
    });
    const summary = json<TranslationSummaryDto>(await admin.get('/admin/i18n/summary'));
    expect(summary).toMatchObject({ orphans: 0, sameAsCompiled: 0, demoOverrides: 0 });
  });

  it('keeps an A7 confirmation of a stale compiled value until the repository holds its stamp', async () => {
    const key = STALE_FR[0];
    expect((await admin.post(`${cellUrl('fr', key)}/confirm`)).statusCode).toBe(200);
    // The same text as compiled, but the stamp of the repository is still the old one; a German row equal to
    // the compiled German is in the repository already.
    await put('common.cancel', 'de', 'Abbrechen');
    await t.ctx.i18n.reload();
    const summary = json<TranslationSummaryDto>(await admin.get('/admin/i18n/summary'));
    expect(summary.sameAsCompiled).toBe(1);
    const all = { orphans: true, sameAsCompiled: true, demo: true };
    expect(json<TranslationCleanupResultDto>(await admin.post('/admin/i18n/cleanup', all))).toMatchObject({
      sameAsCompiled: 1,
    });
    const left = await t.db.select().from(translationOverrides);
    expect(left.map((r) => `${r.locale}:${r.key}`)).toEqual([`fr:${key}`]);
    expect(t.ctx.i18n.cell('fr', key as ServerTranslationKey)).toMatchObject({
      state: 'current',
      origin: 'manual',
    });
  });
});

describe('A9 to A12 glossary', () => {
  afterEach(async () => {
    await t.db.delete(translationGlossary).where(eq(translationGlossary.builtIn, false));
  });

  it('adds, refuses duplicates, edits built-in terms, never deletes them, and keeps edits over the seed', async () => {
    const list = json<GlossaryEntryDto[]>(await admin.get('/admin/i18n/glossary'));
    expect(list.length).toBeGreaterThan(10);
    expect(list[0]!.builtIn).toBe(true);
    const rechnung = list.find((g) => g.term === 'Rechnung')!;

    const created = await admin.post('/admin/i18n/glossary', {
      term: 'Rechenzentrum',
      keep: false,
      translations: { fr: 'centre de données', it: 'centro dati' },
      note: 'Data center',
    });
    expect(created.statusCode).toBe(200);
    const term = json<GlossaryEntryDto>(created);
    expect(term).toMatchObject({ term: 'Rechenzentrum', builtIn: false, note: 'Data center' });
    expect(term.updatedBy).toEqual({ id: adminId, name: expect.any(String) });
    const duplicate = await admin.post('/admin/i18n/glossary', {
      term: 'rechenzentrum',
      keep: true,
      translations: {},
    });
    expect(duplicate.statusCode).toBe(409);
    expect(json(duplicate).error).toMatchObject({
      code: 'glossary_duplicate',
      details: { term: 'rechenzentrum' },
    });

    const edited = await admin.patch(`/admin/i18n/glossary/${rechnung.id}`, {
      translations: { ...rechnung.translations, fr: 'facture client' },
    });
    expect(edited.statusCode).toBe(200);
    expect(json<GlossaryEntryDto>(edited)).toMatchObject({
      builtIn: true,
      translations: { fr: 'facture client' },
    });
    const renamed = await admin.patch(`/admin/i18n/glossary/${rechnung.id}`, { term: 'Faktura' });
    expect(renamed.statusCode).toBe(400);
    const clash = await admin.patch(`/admin/i18n/glossary/${term.id}`, { term: 'Rechnung' });
    expect(json(clash).error.code).toBe('glossary_duplicate');

    const builtin = await admin.del(`/admin/i18n/glossary/${rechnung.id}`);
    expect(builtin.statusCode).toBe(409);
    expect(json(builtin).error).toMatchObject({ code: 'glossary_builtin', details: { term: 'Rechnung' } });
    expect((await admin.del(`/admin/i18n/glossary/${term.id}`)).statusCode).toBe(200);
    expect((await admin.del(`/admin/i18n/glossary/${term.id}`)).statusCode).toBe(404);

    await seedGlossary(t.db);
    const after = await t.db.query.translationGlossary.findFirst({
      where: eq(translationGlossary.id, rechnung.id),
    });
    expect(after!.translations.fr).toBe('facture client');
    for (const action of ['i18n.glossary_create', 'i18n.glossary_update', 'i18n.glossary_delete']) {
      expect((await audits(action)).length, action).toBeGreaterThan(0);
    }
    const [update] = await audits('i18n.glossary_update');
    expect(update!.details).toMatchObject({ id: rechnung.id, term: 'Rechnung', changed: ['translations'] });
    // Restore the default for the other tests.
    await t.db
      .update(translationGlossary)
      .set({ translations: rechnung.translations })
      .where(eq(translationGlossary.id, rechnung.id));
    await t.ctx.i18n.reload();
  });
});

describe('A13, A14 style notes', () => {
  it('shows the defaults and saves and removes notes per locale', async () => {
    const before = json<StyleNotesDto>(await admin.get('/admin/i18n/style'));
    expect(Object.keys(before.defaults)).toEqual(['en', 'fr', 'it', 'nl']);
    expect(before.notes).toEqual({});
    const saved = await admin.request('PUT', '/admin/i18n/style/fr', {
      notes: '  Bitte kurz und sachlich.  ',
    });
    expect(saved.statusCode).toBe(200);
    expect(json<StyleNotesDto>(saved).notes).toEqual({ fr: 'Bitte kurz und sachlich.' });
    expect((await audits('i18n.style_update'))[0]!.details).toEqual({ locale: 'fr', length: 24 });
    const removed = await admin.request('PUT', '/admin/i18n/style/fr', { notes: '' });
    expect(json<StyleNotesDto>(removed).notes).toEqual({});
    expect((await admin.request('PUT', '/admin/i18n/style/de', { notes: 'x' })).statusCode).toBe(400);
    expect((await admin.request('PUT', '/admin/i18n/style/fr', { notes: 'x'.repeat(2001) })).statusCode).toBe(
      400,
    );
  });
});

describe('A15 import and A16 export', () => {
  const localeFile = (entries: Record<string, { value: string | null }>, locale = 'fr') => ({
    format: 'weblion-i18n-locale',
    version: 1,
    locale,
    entries,
  });

  it('checks on a dry run without writing, then imports', async () => {
    await put('nav.dashboard', 'fr', 'Tableau de bord');
    await put('nav.settings', 'fr', 'Réglages', { origin: 'ai', reviewed: false });
    await t.ctx.i18n.reload();
    const data = localeFile({
      'common.edit': { value: 'Modifier' },
      'common.delete': { value: 'Supprimer' },
      'servers.rename.title': { value: 'Renommer le serveur' },
      'common.cancel': { value: 'Annuler' },
      'nav.dashboard': { value: 'Aperçu' },
      'nav.settings': { value: 'Paramètres' },
      'billing.invoice.total': { value: 'Total : {amount}' },
      'login.hero.text': { value: 'Melden Sie sich an, um Ihre Server zu verwalten.' },
      'gone.key': { value: 'x' },
      'common.search': { value: `Rechercher${EM_DASH}` },
      'nav.servers': { value: null },
    });
    const dry = await admin.post('/admin/i18n/import', { data, dryRun: true });
    expect(dry.statusCode).toBe(200);
    const result = json<TranslationImportResultDto>(dry);
    expect(result).toMatchObject({ dryRun: true, created: 4, updated: 1, unchanged: 1 });
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { key: 'servers.rename.title', locale: 'fr', reason: 'placeholders', detail: 'missing {name}' },
        { key: 'nav.dashboard', locale: 'fr', reason: 'manual' },
        { key: 'gone.key', locale: 'fr', reason: 'unknown_key' },
        { key: 'common.search', locale: 'fr', reason: 'characters', detail: 'U+2014' },
      ]),
    );
    // German leftovers, and the glossary term "Server" without "serveur".
    expect(result.warnings).toEqual([
      { key: 'login.hero.text', locale: 'fr', checks: ['german', 'glossary'] },
    ]);
    expect(await t.db.select().from(translationOverrides)).toHaveLength(2);
    expect(await audits('i18n.import')).toHaveLength(0);

    const applied = json<TranslationImportResultDto>(
      await admin.post('/admin/i18n/import', { data, dryRun: false, markReviewed: true }),
    );
    expect(applied).toMatchObject({ dryRun: false, created: 4, updated: 1, unchanged: 1 });
    const total = await t.db
      .select()
      .from(translationOverrides)
      .where(eq(translationOverrides.key, 'billing.invoice.total'));
    expect(total[0]).toMatchObject({ value: `Total${NBSP}: {amount}`, origin: 'manual', reviewed: true });
    const settings = await t.db
      .select()
      .from(translationOverrides)
      .where(eq(translationOverrides.key, 'nav.settings'));
    expect(settings[0]).toMatchObject({ value: 'Paramètres', origin: 'manual' });
    expect((await audits('i18n.import'))[0]!.details).toEqual({
      locales: ['fr'],
      created: 4,
      updated: 1,
      unchanged: 1,
      skipped: 4,
      replaceManual: false,
      markReviewed: true,
    });

    const replace = json<TranslationImportResultDto>(
      await admin.post('/admin/i18n/import', {
        data: localeFile({ 'nav.dashboard': { value: 'Aperçu' } }),
        dryRun: false,
        replaceManual: true,
      }),
    );
    expect(replace).toMatchObject({ updated: 1, skipped: [] });
  });

  it('keeps the origin of AI rows from an overrides file, refuses AI texts for legal keys and bad files', async () => {
    const data = {
      format: 'weblion-i18n-overrides',
      version: 1,
      exportedAt: '2026-11-06T10:00:00.000Z',
      entries: [
        {
          key: 'common.edit',
          locale: 'it',
          value: 'Modifica',
          origin: 'ai',
          reviewed: false,
          sourceHash: hashOf('common.edit'),
        },
        {
          key: 'common.delete',
          locale: 'it',
          value: 'Elimina',
          origin: 'manual',
          reviewed: true,
          sourceHash: sourceHash('Entfernen'),
        },
        { key: 'ai.notice.text', locale: 'it', value: 'La sua richiesta', origin: 'ai', reviewed: true },
      ],
    };
    const res = json<TranslationImportResultDto>(
      await admin.post('/admin/i18n/import', { data, dryRun: false }),
    );
    expect(res).toMatchObject({ created: 2 });
    expect(res.skipped).toEqual([{ key: 'ai.notice.text', locale: 'it', reason: 'legal_ai' }]);
    const rows = await t.db.select().from(translationOverrides).where(eq(translationOverrides.locale, 'it'));
    expect(rows.find((r) => r.key === 'common.edit')).toMatchObject({ origin: 'ai', reviewed: false });
    // Staleness travels with the text.
    expect(rows.find((r) => r.key === 'common.delete')).toMatchObject({
      origin: 'manual',
      sourceHash: sourceHash('Entfernen'),
    });

    const bad = await admin.post('/admin/i18n/import', { data: { format: 'something' }, dryRun: true });
    expect(bad.statusCode).toBe(400);
    expect(json(bad).error.code).toBe('import_invalid');
    expect(json(bad).error.details.problems.length).toBeGreaterThan(0);
  });

  it('skips empty and whitespace-only values like a cell save, also in i18n:apply', async () => {
    const data = {
      format: 'weblion-i18n-overrides',
      version: 1,
      entries: [
        { key: 'ai.notice.title', locale: 'en', value: '   ', sourceHash: hashOf('ai.notice.title') },
        { key: 'nav.servers', locale: 'fr', value: '', sourceHash: hashOf('nav.servers') },
        { key: 'common.edit', locale: 'fr', value: ' Modifier ', sourceHash: hashOf('common.edit') },
      ],
    };
    const res = json<TranslationImportResultDto>(
      await admin.post('/admin/i18n/import', { data, dryRun: false }),
    );
    expect(res).toMatchObject({ created: 1, updated: 0 });
    expect(res.skipped).toEqual([
      { key: 'ai.notice.title', locale: 'en', reason: 'empty' },
      { key: 'nav.servers', locale: 'fr', reason: 'empty' },
    ]);
    expect(t.ctx.i18n.t('en', 'ai.notice.title' as ServerTranslationKey)).toBe('Privacy notice');
    expect(t.ctx.i18n.t('fr', 'common.edit' as ServerTranslationKey)).toBe('Modifier');

    const plan = planApply(
      parseImportFile({
        format: 'weblion-i18n-overrides',
        version: 1,
        entries: [{ key: 'common.cancel', locale: 'en', value: ' \n ', origin: 'manual', reviewed: true }],
      }),
      {},
    );
    expect(plan.values).toEqual([]);
    expect(plan.failures).toEqual([]);
    expect(plan.ignored).toEqual(['en:common.cancel: empty value']);
  });

  it('exports both scopes, round-trips through the import and limits to 10 per minute', async () => {
    await put('nav.dashboard', 'fr', 'Tableau de bord');
    await put('common.delete', 'fr', 'Supprimer', { hash: sourceHash('Entfernen') });
    await put('nav.billing', 'it', 'Fatturazione', { origin: 'ai', reviewed: false });
    await put('nav.servers', 'it', '[IT] Server', { origin: 'ai', demo: true });
    await put('gone.key', 'fr', 'Ancien', { hash: sourceHash('x') });
    await t.ctx.i18n.reload();
    const overrides = await admin.get('/admin/i18n/export?scope=overrides');
    expect(overrides.statusCode).toBe(200);
    expect(overrides.headers['content-disposition']).toMatch(
      /^attachment; filename="weblion-i18n-overrides-/,
    );
    const file = json(overrides);
    expect(file).toMatchObject({ format: 'weblion-i18n-overrides', version: 1 });
    expect(file.entries.map((e: { key: string; locale: string }) => `${e.locale}:${e.key}`)).toEqual([
      'fr:common.delete',
      'fr:nav.dashboard',
      'it:nav.billing',
    ]);
    expect(file.entries[0]).toMatchObject({ source: null, sourceHash: sourceHash('Entfernen') });
    expect(file.entries[1]).toMatchObject({ source: 'Übersicht', origin: 'manual', reviewed: true });

    const locale = json(await admin.get('/admin/i18n/export?scope=locale&locale=fr&only=missing'));
    expect(locale).toMatchObject({ format: 'weblion-i18n-locale', locale: 'fr' });
    expect(locale.entries['common.edit']).toEqual({
      de: 'Bearbeiten',
      en: 'Edit',
      value: null,
      state: 'missing',
    });
    expect(locale.entries['common.delete']).toMatchObject({ value: 'Supprimer', state: 'stale' });
    expect(locale.entries['ai.notice.text']).toMatchObject({ legal: true });
    expect(locale.entries['common.save']).toBeUndefined();
    expect((await admin.get('/admin/i18n/export?scope=locale')).statusCode).toBe(400);

    for (const data of [file, json(await admin.get('/admin/i18n/export?scope=locale&locale=fr'))]) {
      const again = json<TranslationImportResultDto>(
        await admin.post('/admin/i18n/import', { data, dryRun: true }),
      );
      expect(again).toMatchObject({ created: 0, updated: 0, skipped: [] });
    }

    // 10 per minute per person and route; the requests above already counted.
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++)
      statuses.push((await admin.get('/admin/i18n/export?scope=overrides')).statusCode);
    expect(statuses).toContain(429);
    const limited = await admin.get('/admin/i18n/export?scope=overrides');
    expect(limited.statusCode).toBe(429);
    expect(json(limited).error.code).toBe('rate_limited');
    expect(limited.headers['retry-after']).toBeDefined();
    // The import has its own count.
    const importStatuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      importStatuses.push(
        (await admin.post('/admin/i18n/import', { data: localeFile({}), dryRun: true })).statusCode,
      );
    }
    expect(importStatuses).toContain(429);
  });
});

describe('B1 suggest', () => {
  it('calls once per language, records the usage, validates and saves nothing', async () => {
    const answers: Record<string, string> = {
      fr: 'Renommer le serveur {name}',
      it: 'Rinomina il server {name}',
    };
    answerWith((_item, locale) => answers[locale]);
    const res = await admin.post('/admin/i18n/ai/suggest', {
      key: 'servers.rename.title',
      locales: ['it', 'fr'],
    });
    expect(res.statusCode).toBe(200);
    const dto = json<TranslationSuggestDto>(res);
    expect(dto.suggestions).toEqual([
      { locale: 'fr', value: 'Renommer le serveur {name}', reason: null, detail: null },
      { locale: 'it', value: 'Rinomina il server {name}', reason: null, detail: null },
    ]);
    expect(dto.demo).toBe(false);
    expect(dto.costMicros).toBeGreaterThan(0);
    expect(mock.requests).toHaveLength(2);
    expect(mock.requests[0]!.body.system[0].text).toMatch(/^# Feature: translations\n/);
    const usage = await t.db.select().from(aiUsage);
    expect(usage).toHaveLength(2);
    for (const row of usage) {
      expect(row).toMatchObject({
        feature: 'translations',
        scope: 'platform',
        orgId: null,
        countsForUser: true,
        userId: adminId,
      });
    }
    expect(await t.db.select().from(translationOverrides)).toHaveLength(0);
  });

  it('returns a failed check as the reason', async () => {
    answerWith(() => 'Rinominare il server');
    const dto = json<TranslationSuggestDto>(
      await admin.post('/admin/i18n/ai/suggest', { key: 'servers.rename.title', locales: ['it'] }),
    );
    expect(dto.suggestions).toEqual([
      { locale: 'it', value: null, reason: 'placeholders', detail: 'missing {name}' },
    ]);
  });

  it('refuses legal and unknown keys and the 13th request of a minute', async () => {
    const legal = await admin.post('/admin/i18n/ai/suggest', { key: 'ai.notice.text', locales: ['fr'] });
    expect(legal.statusCode).toBe(409);
    expect(json(legal).error).toMatchObject({ code: 'legal_key', details: { keys: ['ai.notice.text'] } });
    expect(
      (await admin.post('/admin/i18n/ai/suggest', { key: 'gone.key', locales: ['fr'] })).statusCode,
    ).toBe(404);
    for (let i = 0; i < 12; i++) {
      const ok = await admin.post('/admin/i18n/ai/suggest', { key: 'common.edit', locales: ['fr'] });
      expect(ok.statusCode, `request ${i + 1}`).toBe(200);
    }
    const limited = await admin.post('/admin/i18n/ai/suggest', { key: 'common.edit', locales: ['fr'] });
    expect(limited.statusCode).toBe(429);
    expect(json(limited).error).toMatchObject({ code: 'ai_limit', details: { limit: 'user_rate' } });
    expect(mock.requests).toHaveLength(12);
  });

  it('answers an AI error with its own code', async () => {
    mock.setScript(() => ({
      error: { status: 401, type: 'authentication_error', message: 'invalid x-api-key' },
    }));
    const res = await admin.post('/admin/i18n/ai/suggest', { key: 'common.edit', locales: ['fr'] });
    expect(res.statusCode).toBe(502);
    expect(json(res).error).toMatchObject({ code: 'ai_upstream', details: { reason: 'auth' } });
  });
});

describe('B4, B5, B6 without a running job', () => {
  it('lists jobs newest first, shows one, cancels a queued one and refuses a finished one', async () => {
    const base = {
      locales: ['fr'] as const,
      scope: { locales: ['fr'], selection: 'untranslated', replaceManual: false },
      model: 'claude-opus-5-5' as const,
      batches: [{ locale: 'fr' as const, keys: ['common.edit'] }],
      total: 1,
      estimateMicros: 100,
      createdBy: adminId,
    };
    const [old] = await t.db
      .insert(translationJobs)
      .values({
        ...base,
        locales: ['fr'],
        scope: { locales: ['fr'], selection: 'untranslated', replaceManual: false },
        status: 'completed',
        createdAt: new Date(Date.now() - 60_000),
        failures: [{ key: 'common.edit', locale: 'fr', reason: 'error', detail: null }],
      })
      .returning();
    const [queued] = await t.db
      .insert(translationJobs)
      .values({
        ...base,
        locales: ['fr'],
        scope: { locales: ['fr'], selection: 'untranslated', replaceManual: false },
      })
      .returning();
    const list = json<Paginated<{ id: string; status: string }>>(await admin.get('/admin/i18n/ai/jobs'));
    expect(list.items.map((j) => j.id)).toEqual([queued!.id, old!.id]);
    expect(list).toMatchObject({ total: 2, page: 1, perPage: 20 });
    const detail = json(await admin.get(`/admin/i18n/ai/jobs/${old!.id}`));
    expect(detail).toMatchObject({ status: 'completed', batches: 1, failures: [{ key: 'common.edit' }] });
    expect(detail.createdBy).toEqual({ id: adminId, name: expect.any(String) });
    const summary = json<TranslationSummaryDto>(await admin.get('/admin/i18n/summary'));
    expect(summary.activeJob?.id).toBe(queued!.id);

    const cancelled = await admin.post(`/admin/i18n/ai/jobs/${queued!.id}/cancel`);
    expect(cancelled.statusCode).toBe(200);
    expect(json(cancelled)).toMatchObject({ status: 'cancelled', cancelRequested: true });
    expect((await audits('i18n.job_cancel'))[0]!.details).toEqual({ jobId: queued!.id, status: 'cancelled' });
    const finished = await admin.post(`/admin/i18n/ai/jobs/${old!.id}/cancel`);
    expect(finished.statusCode).toBe(409);
    expect(json(finished).error).toMatchObject({ code: 'job_finished', details: { status: 'completed' } });
    expect(
      (await admin.post('/admin/i18n/ai/jobs/00000000-0000-4000-8000-000000000000/cancel')).statusCode,
    ).toBe(404);
  });
});

describe('demo seed', () => {
  it('inserts the three overrides of i18n 21.3 once, showing manual, AI unreviewed and stale', async () => {
    await insertI18nDemo(t.db);
    await insertI18nDemo(t.db);
    await t.ctx.i18n.reload();
    const rows = await t.db.select().from(translationOverrides);
    expect(rows.map((r) => `${r.locale}:${r.key}`).sort()).toEqual([
      'fr:nav.overview',
      'it:nav.theme',
      'nl:login.hero.title',
    ]);
    expect(rows.every((r) => !r.demo && r.updatedBy === adminId)).toBe(true);
    // None equals the compiled text of the repository, so "Aufräumen" keeps all three examples, and each passes
    // every check with the real glossary, so a cell shows only the state it is meant to show.
    const real = loadCatalog().bundles;
    for (const r of rows) {
      const key = r.key as ServerTranslationKey;
      expect(r.value).not.toBe(real[r.locale][key]);
      expect(
        checkValue({
          key,
          source: real.de[key]!,
          value: r.value,
          locale: r.locale,
          glossary: DEFAULT_GLOSSARY,
        }),
      ).toEqual({ hard: [], soft: [] });
    }
    const byKey = Object.fromEntries(rows.map((r) => [`${r.locale}:${r.key}`, r]));
    expect(byKey['fr:nav.overview']).toMatchObject({ origin: 'manual', reviewed: true });
    expect(byKey['it:nav.theme']).toMatchObject({ origin: 'ai', reviewed: false });
    // The stale example is in the test catalog: written against an older German text.
    expect(t.ctx.i18n.cell('nl', 'login.hero.title' as ServerTranslationKey)).toMatchObject({
      state: 'stale',
    });
  });
});

describe('every write is audited', () => {
  it('records the action of each write route', async () => {
    // A second superadmin: the import and export limits count per person, and the tests above used them up.
    await t.db.insert(users).values({
      email: 'editor@weblion.test',
      name: 'Editor',
      passwordHash: await hashPassword(DEMO_PASSWORD),
      platformRole: 'superadmin',
    });
    const editor = new Client(t.app);
    await editor.login('editor@weblion.test');
    await t.db.delete(auditLogs).where(sql`${auditLogs.action} like 'i18n.%'`);
    await put('common.delete', 'fr', 'Supprimer', {
      hash: sourceHash('Entfernen'),
      origin: 'ai',
      reviewed: false,
    });
    await t.ctx.i18n.reload();
    expect(
      (await editor.request('PUT', cellUrl('fr', 'common.edit'), { value: 'Modifier' })).statusCode,
    ).toBe(200);
    expect(
      (await editor.post(`${cellUrl('fr', 'common.delete')}/review`, { reviewed: true })).statusCode,
    ).toBe(200);
    expect((await editor.post(`${cellUrl('fr', 'common.delete')}/confirm`)).statusCode).toBe(200);
    expect((await editor.del(cellUrl('fr', 'common.edit'))).statusCode).toBe(200);
    expect(
      (await editor.post('/admin/i18n/cleanup', { orphans: true, sameAsCompiled: true, demo: true }))
        .statusCode,
    ).toBe(200);
    const term = json<GlossaryEntryDto>(
      await editor.post('/admin/i18n/glossary', { term: 'Audit-Begriff', keep: true, translations: {} }),
    );
    expect((await editor.patch(`/admin/i18n/glossary/${term.id}`, { keep: false })).statusCode).toBe(200);
    expect((await editor.del(`/admin/i18n/glossary/${term.id}`)).statusCode).toBe(200);
    expect((await editor.request('PUT', '/admin/i18n/style/nl', { notes: 'Kort.' })).statusCode).toBe(200);
    expect(
      (
        await editor.post('/admin/i18n/import', {
          data: {
            format: 'weblion-i18n-locale',
            version: 1,
            locale: 'nl',
            entries: { 'common.edit': { value: 'Bewerken' } },
          },
          dryRun: false,
        })
      ).statusCode,
    ).toBe(200);
    const actions = (
      await t.db
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(sql`${auditLogs.action} like 'i18n.%'`)
    ).map((a) => a.action);
    expect(new Set(actions)).toEqual(
      new Set([
        'i18n.override_update',
        'i18n.override_review',
        'i18n.override_confirm',
        'i18n.override_revert',
        'i18n.cleanup',
        'i18n.glossary_create',
        'i18n.glossary_update',
        'i18n.glossary_delete',
        'i18n.style_update',
        'i18n.import',
      ]),
    );
    await editor.request('PUT', '/admin/i18n/style/nl', { notes: '' });
  });
});

// --- i18n:apply (i18n 16.2) and i18n:report (i18n 4.3, plan 8.2), against copies of the shared files ---

describe('i18n:apply', () => {
  it('applies checked values: fr regenerated, en replaced in place, stamps with the hash of the row', async () => {
    const sections = join(temp, 'sections');
    const stamps = join(temp, 'stamps');
    cpSync(SECTIONS_DIR, sections, { recursive: true });
    cpSync(STAMPS_DIR, stamps, { recursive: true });
    const german = SECTION_SOURCES.core.de;
    const rows = parseImportFile({
      format: 'weblion-i18n-overrides',
      version: 1,
      entries: [
        {
          key: 'common.save',
          locale: 'fr',
          value: 'Enregistrer',
          origin: 'manual',
          reviewed: true,
          sourceHash: sourceHash(german['common.save']!),
        },
        // Stale: written against an older German text; it stays stale in the repository.
        {
          key: 'common.pageOf',
          locale: 'fr',
          value: 'Page {page} : {total}',
          origin: 'manual',
          reviewed: true,
          sourceHash: sourceHash('Seite {page} aus {total}'),
        },
        { key: 'common.cancel', locale: 'en', value: 'Abort', origin: 'manual', reviewed: true },
        // Not applied: a placeholder is missing.
        { key: 'common.pageOf', locale: 'it', value: 'Pagina', origin: 'manual', reviewed: true },
        // Not reviewed: left out with --only-reviewed.
        { key: 'common.edit', locale: 'fr', value: 'Modifier', origin: 'ai', reviewed: false },
        { key: 'gone.key', locale: 'fr', value: 'x', origin: 'manual', reviewed: true },
      ],
    });
    const plan = planApply(rows, { onlyReviewed: true });
    expect(plan.values.map((v) => `${v.locale}:${v.key}`)).toEqual([
      'fr:common.save',
      'fr:common.pageOf',
      'en:common.cancel',
    ]);
    // The French spacing is fixed before the checks.
    expect(plan.values[1]!.value).toBe(`Page {page}${NBSP}: {total}`);
    expect(plan.failures).toHaveLength(1);
    expect(plan.failures[0]).toMatch(/^it:common\.pageOf: missing \{page\}, missing \{total\}/);
    expect(plan.ignored).toEqual(['fr:common.edit: not reviewed', 'fr:gone.key: unknown key']);

    const changes = await planFiles(plan, { sections, stamps });
    const fr = changes.find((c) => c.path.endsWith('core.fr.ts'))!;
    expect(fr.after).toContain("import type { coreDe } from './core.de';");
    expect(fr.after).toContain('export const coreFr: Partial<Record<keyof typeof coreDe, string>> = {');
    expect(fr.after).toContain("'common.save': 'Enregistrer',");
    expect(fr.after).toContain("'common.pageOf': 'Page {page}\\u00A0: {total}',");
    // German key order: pageOf comes before save.
    expect(fr.after.indexOf('common.pageOf')).toBeLessThan(fr.after.indexOf('common.save'));

    const en = changes.find((c) => c.path.endsWith('core.en.ts'))!;
    expect(en.after).toContain("'common.cancel': 'Abort',");
    expect(en.after.split('\n').length).toBe(en.before!.split('\n').length);
    expect(en.after.replace("'common.cancel': 'Abort',", "'common.cancel': 'Cancel',")).toBe(en.before);

    const frStamps = JSON.parse(changes.find((c) => c.path.endsWith(join('fr', 'core.json')))!.after);
    expect(frStamps['common.save']).toEqual([sourceHash(german['common.save']!), sourceHash('Enregistrer')]);
    expect(frStamps['common.pageOf'][0]).toBe(sourceHash('Seite {page} aus {total}'));
    const enStamps = JSON.parse(changes.find((c) => c.path.endsWith(join('en', 'core.json')))!.after);
    expect(enStamps['common.cancel']).toEqual([sourceHash(german['common.cancel']!), sourceHash('Abort')]);
    // Nothing was written: planFiles only computes.
    expect(readFileSync(join(sections, 'core.fr.ts'), 'utf8')).toBe(fr.before);
  });

  it('keeps the stamp of a locale file value left as it is, a stale legal notice included', async () => {
    const sections = join(temp, 'sections-unchanged');
    const stamps = join(temp, 'stamps-unchanged');
    cpSync(SECTIONS_DIR, sections, { recursive: true });
    cpSync(STAMPS_DIR, stamps, { recursive: true });
    // The German notice changed after the French one was stamped: the cell is stale.
    const stampPath = join(stamps, 'fr', 'ai.json');
    const before = JSON.parse(readFileSync(stampPath, 'utf8')) as Record<string, [string, string]>;
    const staleStamp: [string, string] = ['0000000000000000', before['ai.notice.text']![1]];
    writeFileSync(stampPath, JSON.stringify({ ...before, 'ai.notice.text': staleStamp }, null, 2));
    const fr = SECTION_SOURCES.ai.fr;
    const rows = parseImportFile({
      format: 'weblion-i18n-locale',
      version: 1,
      locale: 'fr',
      entries: {
        // Exported with its old value and left alone by the translator.
        'ai.notice.text': { value: fr['ai.notice.text'] },
        // Filled in or changed by the translator.
        'ai.assistant.title': { value: 'Assistant du site' },
      },
    });
    const plan = planApply(rows, {});
    expect(plan.unchanged).toEqual(['fr:ai.notice.text']);
    expect(plan.values.map((v) => `${v.locale}:${v.key}`)).toEqual(['fr:ai.assistant.title']);
    expect(plan.failures).toEqual([]);

    const changes = await planFiles(plan, { sections, stamps });
    const frStamps = JSON.parse(changes.find((c) => c.path === stampPath)!.after) as Record<
      string,
      [string, string]
    >;
    // Still stale: the outdated notice is not served as current after the deploy.
    expect(frStamps['ai.notice.text']).toEqual(staleStamp);
    // The changed value is stamped against the current German.
    expect(frStamps['ai.assistant.title']).toEqual([
      sourceHash(SECTION_SOURCES.ai.de['ai.assistant.title']!),
      sourceHash('Assistant du site'),
    ]);
  });

  it('replaces only one string literal and refuses what it cannot replace', () => {
    const text = "export const x = {\n  // a comment\n  'a.b': 'old',\n  'a.c':\n    'long old value',\n};\n";
    expect(replaceInPlace(text, 'a.b', "it's new")).toBe(
      "export const x = {\n  // a comment\n  'a.b': \"it's new\",\n  'a.c':\n    'long old value',\n};\n",
    );
    expect(replaceInPlace(text, 'a.c', 'new\nline')).toContain('\'a.c\':\n    "new\\nline",');
    expect(() => replaceInPlace(text, 'a.d', 'x')).toThrow(/not found/);
    expect(() => replaceInPlace("const x = { 'a.b': 'x' + 'y' };", 'a.b', 'z')).toThrow(
      /single string literal/,
    );
    expect(literal(`a${NBSP}b`)).toBe('"a\\u00A0b"');
  });
});

describe('i18n:report', () => {
  it('counts missing keys and stale or unstamped values', () => {
    const german = { 'a.one': 'Eins', 'a.two': 'Zwei', 'a.three': 'Drei', 'a.four': 'Vier' };
    const report = reportSection({
      german,
      values: { 'a.one': 'Un', 'a.two': 'Deux', 'a.three': 'Trois' },
      stamps: {
        'a.one': [sourceHash('Eins'), sourceHash('Un')],
        'a.two': [sourceHash('Zwei alt'), sourceHash('Deux')],
      },
    });
    expect(report).toEqual({ missing: ['a.four'], stale: ['a.two', 'a.three'] });
  });
});
