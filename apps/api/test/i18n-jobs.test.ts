import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { desc, eq } from 'drizzle-orm';
import type pg from 'pg';
import type {
  Locale,
  ServerTranslationKey,
  TranslationEstimateDto,
  TranslationJobDto,
  TranslationJobScope,
} from '@weblion/shared';
import { DEFAULT_GLOSSARY } from '@weblion/shared/i18n/glossary';
import type { AppContext } from '../src/context';
import { aiUsage, auditLogs, translationJobs, translationOverrides, users } from '../src/db/schema';
import { saveOverride } from '../src/i18n/entries';
import { sourceHash } from '../src/i18n/hash';
import { TranslationJobRunner } from '../src/i18n/jobs';
import { validateItem } from '../src/i18n/translator';
import { AiService } from '../src/modules/ai/service';
import { MOCK_API_KEY, startClaudeMock, type MockTurn } from './claude-mock';
import { ADMIN, Client, configureAi, createTestApp, json, type TestApp } from './helpers';
import { testCatalog } from './i18n-fixtures';

/** Mass Translate, cases a to o of i18n 20.2 (group "jobs"), against the Claude mock of the foundation. */

let t: TestApp;
let mock: Awaited<ReturnType<typeof startClaudeMock>>;
let admin: Client;
let adminId: string;
let runner: TranslationJobRunner;
const waits: number[] = [];
const runners: TranslationJobRunner[] = [];

const NBSP = '\u00A0';
const EM_DASH = '\u2014';

const BULK: Record<string, string> = {};
for (let i = 1; i <= 120; i++)
  BULK[`bulk.k${String(i).padStart(3, '0')}`] = `Eintrag ${String(i).padStart(3, '0')}`;
BULK['bulk.long'] = Array.from({ length: 1_800 }, () => 'Wort').join(' ') + ' Ende.';
const JOBS: Record<string, string> = {
  'jobs.rename': 'Eintrag {name} umbenennen',
  'jobs.copy': 'Eintrag {name} kopieren',
  'jobs.move': 'Eintrag {name} verschieben',
  'jobs.open': 'Eintrag {name} anzeigen',
};

/** Injected sleep: records the wait, never waits (cases i and m). */
const sleep = async (ms: number, signal?: AbortSignal) => {
  waits.push(ms);
  if (signal?.aborted) throw new Error('aborted');
};

function newRunner(
  options: ConstructorParameters<typeof TranslationJobRunner>[2] = {},
): TranslationJobRunner {
  const r = new TranslationJobRunner(t.ctx, (t.db as unknown as { $client: pg.Pool }).$client, {
    sleep,
    concurrency: 1,
    heartbeatMs: 20,
    ...options,
  });
  runners.push(r);
  return r;
}

const WORD: Record<string, string> = { en: 'Entry', fr: 'Entrée', it: 'Voce', nl: 'Item' };
interface Item {
  id: string;
  key: string;
  de: string;
  previous?: string;
  problem?: string;
}

/** A translation that passes every check: the word, the number and the placeholders of the German text. */
function good(item: Item, locale: string): string {
  if (item.key === 'bulk.long') return WORD[locale]!;
  const number = /\d+/.exec(item.de)?.[0];
  const placeholders = item.de.match(/\{[A-Za-z]+\}/g)?.join(' ');
  return [WORD[locale], number, placeholders].filter(Boolean).join(' ');
}

const batchOf = (body: any) => JSON.parse(body.messages.at(-1).content) as { locale: string; items: Item[] };

/** The mock answers each item with fn(item, locale); undefined leaves the item out. */
function answerWith(
  fn: (item: Item, locale: string, index: number) => string | undefined,
  extra: (body: any, index: number) => Partial<MockTurn> | undefined = () => undefined,
) {
  mock.setScript((body, index) => {
    const batch = batchOf(body);
    const more = extra(body, index);
    if (more?.error || more?.stopReason === 'refusal' || more?.stopReason === 'max_tokens') {
      return more as MockTurn;
    }
    return {
      json: {
        items: batch.items
          .map((item) => ({ id: item.id, text: fn(item, batch.locale, index) }))
          .filter((i) => i.text !== undefined),
      },
      ...more,
    };
  });
}

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
}

async function until(check: () => boolean | Promise<boolean>, what: string) {
  for (let i = 0; i < 400; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const scopeOf = (extra: Partial<TranslationJobScope>): TranslationJobScope => ({
  locales: ['fr'],
  selection: 'untranslated',
  replaceManual: false,
  ...extra,
});

async function estimateOf(scope: TranslationJobScope): Promise<TranslationEstimateDto> {
  const res = await admin.post('/admin/i18n/ai/estimate', scope);
  expect(res.statusCode, res.body).toBe(200);
  return json<TranslationEstimateDto>(res);
}

async function startJob(scope: TranslationJobScope): Promise<TranslationJobDto> {
  const estimate = await estimateOf(scope);
  const res = await admin.post('/admin/i18n/ai/jobs', { scope, confirmCostMicros: estimate.costMicros });
  expect(res.statusCode, res.body).toBe(200);
  return json<TranslationJobDto>(res);
}

async function run(r = runner) {
  await r.tick();
  await r.whenIdle();
}

const jobRow = async (id: string) =>
  (await t.db.query.translationJobs.findFirst({ where: eq(translationJobs.id, id) }))!;

const overridesOf = async (locale?: Locale) =>
  (await t.db.select().from(translationOverrides)).filter((r) => !locale || r.locale === locale);

const hashOf = (key: string) => t.ctx.i18n.source(key as ServerTranslationKey).hash;

beforeAll(async () => {
  mock = await startClaudeMock();
  t = await createTestApp({
    env: { ANTHROPIC_BASE_URL: mock.url },
    i18nCatalog: testCatalog({ extra: { hosting: { de: BULK }, websites: { de: JOBS } } }),
  });
  admin = new Client(t.app);
  await admin.login(ADMIN.email, ADMIN.password);
  adminId = (await t.db.query.users.findFirst({ where: eq(users.email, ADMIN.email) }))!.id;
  await configureAi(admin);
});

afterAll(async () => {
  await t?.close();
  await mock?.close();
});

beforeEach(async () => {
  await t.db.delete(translationOverrides);
  await t.db.delete(translationJobs);
  await t.db.delete(aiUsage);
  await t.ctx.i18n.reload();
  mock.requests.length = 0;
  waits.length = 0;
  answerWith(good);
  runner = newRunner();
  t.ctx.i18nJobs = runner;
});

afterEach(async () => {
  for (const r of runners.splice(0)) await r.stop();
});

describe('a. estimate', () => {
  it('counts pairs per locale, batches, legal keys, kept manual cells, cost and the remaining budget', async () => {
    await saveOverride(t.db, {
      key: 'common.delete',
      locale: 'fr',
      value: 'Supprimer',
      origin: 'manual',
      reviewed: true,
      sourceHash: sourceHash('Entfernen'),
      userId: adminId,
    });
    await t.ctx.i18n.reload();
    await t.db.insert(aiUsage).values({
      feature: 'explain',
      scope: 'platform',
      model: 'claude-opus-5-5',
      status: 'ok',
      costMicros: 1_000_000,
    });
    const scope = scopeOf({
      locales: ['fr', 'it'],
      selection: 'both',
      keys: [
        'common.edit',
        'common.delete',
        'nav.dashboard',
        'servers.rename.title',
        'common.none',
        'ai.notice.title',
        'ai.notice.text',
        'common.save',
      ],
    });
    const estimate = await estimateOf(scope);
    expect(estimate).toMatchObject({
      model: 'claude-opus-5-5',
      demo: false,
      keys: 7,
      perLocale: { fr: 3, it: 4 },
      batches: 2,
      legal: 2,
      keptManual: 1,
      skipped: 1,
      budgetRemainingMicros: 100_000_000 - 1_000_000,
    });
    expect(estimate.costMicros).toBeGreaterThan(0);
    expect(estimate.inputTokens).toBeGreaterThan(0);
    expect(estimate.outputTokens).toBeGreaterThan(0);
    // Opus is priced higher than Haiku for the same plan.
    await configureAi(admin, { model: 'claude-haiku-5-5' });
    const haiku = await estimateOf(scope);
    expect(haiku.model).toBe('claude-haiku-5-5');
    expect(haiku.costMicros).toBeLessThan(estimate.costMicros);
    await configureAi(admin);
    expect(mock.requests).toHaveLength(0);
  });
});

describe('b. gates', () => {
  it('answers 409 ai_not_configured with the reason, and 403 without the permissions', async () => {
    const scope = scopeOf({ keys: ['common.edit'] });
    const original = t.ctx.ai;
    // No key and no demo provider: a second service with another environment (a second app would reset the db).
    expect((await admin.del('/admin/ai/key')).statusCode).toBe(200);
    t.ctx.ai = new AiService({ ...t.ctx, env: { ...t.ctx.env, ENABLE_DEMO_PROVIDER: false } } as AppContext);
    try {
      for (const res of [
        await admin.post('/admin/i18n/ai/estimate', scope),
        await admin.post('/admin/i18n/ai/jobs', { scope, confirmCostMicros: 0 }),
        await admin.post('/admin/i18n/ai/suggest', { key: 'common.edit', locales: ['fr'] }),
      ]) {
        expect(res.statusCode).toBe(409);
        expect(json(res).error).toMatchObject({
          code: 'ai_not_configured',
          details: { reason: 'not_configured' },
        });
      }
    } finally {
      t.ctx.ai = original;
      expect((await admin.request('PUT', '/admin/ai/key', { key: MOCK_API_KEY })).statusCode).toBe(200);
    }
    await configureAi(admin, { features: { translations: false } });
    const off = await admin.post('/admin/i18n/ai/estimate', scope);
    expect(json(off).error).toMatchObject({ code: 'ai_not_configured', details: { reason: 'feature_off' } });
    const disabled = await admin.request('PUT', '/admin/ai/settings', {
      enabled: false,
      model: 'claude-opus-5-5',
      features: {
        assistant: true,
        explain: true,
        dns_check: true,
        audit_summary: true,
        server_health: true,
        product_texts: true,
        translations: true,
      },
      budgetUsd: 100,
      warnPercent: 80,
      dailyOrgLimit: 200,
      dailyUserLimit: 50,
    });
    expect(disabled.statusCode).toBe(200);
    const res = await admin.post('/admin/i18n/ai/estimate', scope);
    expect(json(res).error).toMatchObject({ code: 'ai_not_configured', details: { reason: 'disabled' } });
    // Listing and cancelling stay possible while AI is off.
    expect((await admin.get('/admin/i18n/ai/jobs')).statusCode).toBe(200);
    await configureAi(admin);
    expect(mock.requests).toHaveLength(0);
  });
});

describe('c. start refusals', () => {
  it('refuses a risen estimate, a second job, a used-up budget, an empty scope and legal keys only', async () => {
    const scope = scopeOf({ area: 'jobs' });
    const estimate = await estimateOf(scope);
    // The German texts grow, so the cost rises by more than a quarter.
    for (const [key, de] of Object.entries(JOBS)) {
      await saveOverride(t.db, {
        key,
        locale: 'de',
        value: `${de} ${'und noch viel mehr Text '.repeat(40)}`,
        origin: 'manual',
        reviewed: true,
        sourceHash: sourceHash(de),
        userId: adminId,
      });
    }
    await t.ctx.i18n.reload();
    const risen = await admin.post('/admin/i18n/ai/jobs', { scope, confirmCostMicros: estimate.costMicros });
    expect(risen.statusCode).toBe(409);
    expect(json(risen).error).toMatchObject({
      code: 'estimate_changed',
      details: { confirmedMicros: estimate.costMicros },
    });
    expect(json(risen).error.details.costMicros).toBeGreaterThan(estimate.costMicros * 1.25);
    await t.db.delete(translationOverrides);
    await t.ctx.i18n.reload();

    const first = await startJob(scope);
    expect(first.status).toBe('queued');
    const second = await admin.post('/admin/i18n/ai/jobs', { scope, confirmCostMicros: estimate.costMicros });
    expect(second.statusCode).toBe(409);
    expect(json(second).error).toMatchObject({ code: 'job_running', details: { jobId: first.id } });
    await t.db.delete(translationJobs);

    await t.db.insert(aiUsage).values({
      feature: 'explain',
      scope: 'platform',
      model: 'claude-opus-5-5',
      status: 'ok',
      costMicros: 100_000_000,
    });
    const budget = await admin.post('/admin/i18n/ai/jobs', { scope, confirmCostMicros: estimate.costMicros });
    expect(budget.statusCode).toBe(429);
    expect(json(budget).error).toMatchObject({ code: 'ai_limit', details: { limit: 'budget' } });
    await t.db.delete(aiUsage);

    const empty = await admin.post('/admin/i18n/ai/jobs', {
      scope: scopeOf({ keys: ['common.save'] }),
      confirmCostMicros: 0,
    });
    expect(empty.statusCode).toBe(409);
    expect(json(empty).error.code).toBe('nothing_to_translate');
    const legal = await admin.post('/admin/i18n/ai/estimate', scopeOf({ keys: ['ai.notice.text'] }));
    expect(legal.statusCode).toBe(409);
    expect(json(legal).error).toMatchObject({ code: 'legal_key', details: { keys: ['ai.notice.text'] } });
    expect(await t.db.select().from(translationJobs)).toHaveLength(0);
  });
});

describe('d. happy path', () => {
  it('saves AI overrides, completes the job, sums tokens and cost and writes one usage row per batch', async () => {
    const job = await startJob(scopeOf({ locales: ['fr', 'nl'], area: 'jobs' }));
    expect(job).toMatchObject({
      status: 'queued',
      total: 8,
      batches: 2,
      demo: false,
      model: 'claude-opus-5-5',
    });
    await run();
    const row = await jobRow(job.id);
    expect(row).toMatchObject({
      status: 'completed',
      done: 8,
      failed: 0,
      skipped: 0,
      runner: null,
      error: null,
    });
    expect(row.doneBatches.sort()).toEqual([0, 1]);
    // The mock's default usage: 100 input and 20 output tokens per call.
    expect(row).toMatchObject({ inputTokens: 200, outputTokens: 40 });
    expect(row.costMicros).toBe(2 * (100 * 4 + 20 * 20));

    const overrides = await overridesOf();
    expect(overrides).toHaveLength(8);
    for (const o of overrides) {
      expect(o).toMatchObject({ origin: 'ai', reviewed: false, demo: false, updatedBy: adminId });
      expect(o.sourceHash).toBe(hashOf(o.key));
    }
    expect(overrides.find((o) => o.key === 'jobs.rename' && o.locale === 'fr')?.value).toBe('Entrée {name}');
    // Live at once.
    expect(t.ctx.i18n.t('nl', 'jobs.copy' as ServerTranslationKey, { name: 'X' })).toBe('Item X');

    const usage = await t.db.select().from(aiUsage);
    expect(usage).toHaveLength(2);
    for (const u of usage) {
      expect(u).toMatchObject({
        feature: 'translations',
        scope: 'platform',
        orgId: null,
        userId: adminId,
        countsForUser: false,
        status: 'ok',
      });
    }
    expect(mock.requests).toHaveLength(2);
    for (const request of mock.requests) {
      const { body } = request;
      expect(body.stream).toBe(true);
      expect(body.max_tokens).toBe(32_000);
      expect(body.output_config.effort).toBe('medium');
      expect(body.system[0].text).toMatch(/^# Feature: translations\n/);
      expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
      expect(body.system[0].text).not.toMatch(/\u2014|claude-(opus|sonnet|haiku)/);
    }
    expect(batchOf(mock.requests[0]!.body).locale).toBe('fr');
    expect(batchOf(mock.requests[1]!.body).locale).toBe('nl');

    const [start] = await t.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'i18n.job_start'))
      .orderBy(desc(auditLogs.id));
    expect(start?.details).toMatchObject({ jobId: job.id, locales: ['fr', 'nl'], keys: 8, demo: false });
    const [finish] = await t.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'i18n.job_finish'))
      .orderBy(desc(auditLogs.id));
    expect(finish).toMatchObject({ actorUserId: adminId, actorName: 'Translation job', resourceId: job.id });
    expect(finish?.details).toMatchObject({
      jobId: job.id,
      status: 'completed',
      done: 8,
      failed: 0,
      error: null,
    });
  });
});

describe('e. batching', () => {
  it('plans 50, 50 and 20 short keys and a long key on its own; legal keys never reach Claude', async () => {
    const job = await startJob(scopeOf({ area: 'bulk' }));
    const row = await jobRow(job.id);
    expect(row.batches.map((b) => b.keys.length)).toEqual([50, 50, 20, 1]);
    expect(row.batches[3]!.keys).toEqual(['bulk.long']);
    await run();
    expect(await jobRow(job.id)).toMatchObject({ status: 'completed', done: 121 });

    await t.db.delete(translationJobs);
    mock.requests.length = 0;
    answerWith((item) => (item.key === 'ai.assistant.title' ? 'Assistente IA' : 'Chieda qualcosa su {org}'));
    const legal = await startJob(scopeOf({ locales: ['it'], area: 'ai' }));
    expect(legal.total).toBe(2);
    await run();
    expect(mock.requests).toHaveLength(1);
    expect(JSON.stringify(mock.requests[0]!.body)).not.toContain('ai.notice');
    expect(batchOf(mock.requests[0]!.body).items.map((i) => i.key)).toEqual([
      'ai.assistant.title',
      'ai.assistant.placeholder',
    ]);
  });
});

describe('f. repair', () => {
  it('sends a failed item once more with previous and problem, then saves or records it', async () => {
    answerWith((item, locale, index) =>
      index === 0 && item.key === 'jobs.copy' ? 'Entrée sans nom' : good(item, locale),
    );
    const job = await startJob(scopeOf({ area: 'jobs' }));
    await run();
    expect(mock.requests).toHaveLength(2);
    const repair = batchOf(mock.requests[1]!.body);
    expect(repair.items).toHaveLength(1);
    expect(repair.items[0]).toMatchObject({
      key: 'jobs.copy',
      previous: 'Entrée sans nom',
      problem: 'missing {name}',
    });
    expect(await jobRow(job.id)).toMatchObject({ status: 'completed', done: 4, failed: 0 });

    await t.db.delete(translationJobs);
    await t.db.delete(translationOverrides);
    await t.ctx.i18n.reload();
    mock.requests.length = 0;
    answerWith((item, locale) => (item.key === 'jobs.copy' ? 'Entrée sans nom' : good(item, locale)));
    const again = await startJob(scopeOf({ area: 'jobs' }));
    await run();
    expect(mock.requests).toHaveLength(2);
    const row = await jobRow(again.id);
    expect(row).toMatchObject({ status: 'completed', done: 3, failed: 1 });
    expect(row.failures).toEqual([
      { key: 'jobs.copy', locale: 'fr', reason: 'placeholders', detail: 'missing {name}' },
    ]);
  });
});

describe('g. validator', () => {
  const check = (
    locale: 'fr' | 'it' | 'nl' | 'en',
    source: string,
    text: string,
    english: string | null = null,
  ) =>
    validateItem({ key: 'test.key', locale, source, english, text, demo: false, glossary: DEFAULT_GLOSSARY });

  it('fixes French spacing and applies the checks of the repository', () => {
    expect(check('fr', 'Status: {state}', 'Statut : {state}')).toEqual({
      ok: true,
      value: `Statut${NBSP}: {state}`,
      fixed: true,
    });
    expect(check('fr', 'Abbrechen?', 'Annuler ?')).toEqual({ ok: true, value: 'Annuler?', fixed: true });
    expect(check('fr', 'Status', `Statut ${EM_DASH} actif`)).toMatchObject({
      ok: false,
      reason: 'characters',
    });
    expect(check('fr', 'Status', 'Statut, voir https://evil.example')).toMatchObject({
      ok: false,
      reason: 'content',
      detail: 'new URL https://evil.example',
    });
    expect(check('fr', 'Schreiben Sie uns', 'Écrivez à phish@evil.example')).toMatchObject({
      ok: false,
      reason: 'content',
    });
    expect(check('fr', 'Preis {amount}', 'Prix 99 {amount}')).toMatchObject({
      ok: false,
      reason: 'content',
      detail: 'new number 99',
    });
    expect(check('fr', 'Auf 24fire', 'Sur 24fire')).toMatchObject({ ok: true });
    expect(check('fr', 'Mehr unter https://weblion.one', 'Plus sur https://weblion.one.')).toMatchObject({
      ok: true,
    });
    expect(check('it', 'Bitte wählen Sie eine Datei', 'Bitte wählen Sie eine Datei')).toMatchObject({
      ok: false,
      reason: 'german',
    });
    expect(check('fr', 'Speichern Sie die Datei', 'Enregistre ton fichier, tu peux')).toMatchObject({
      ok: false,
      reason: 'formality',
    });
    expect(check('nl', 'Ok', 'Dit is een veel te lange vertaling')).toMatchObject({
      ok: false,
      reason: 'length',
    });
    expect(check('fr', 'Rechnung', 'Note')).toMatchObject({
      ok: false,
      reason: 'glossary',
      detail: 'glossary term Rechnung',
    });
    expect(check('fr', 'Rechnung', 'Facture')).toEqual({ ok: true, value: 'Facture', fixed: false });
    expect(check('fr', 'Name {name}', 'Nom')).toMatchObject({ ok: false, reason: 'placeholders' });
    expect(check('fr', 'Zeile\nZeile', 'Ligne Ligne')).toMatchObject({ ok: false, reason: 'placeholders' });
    expect(
      validateItem({
        key: 'k',
        locale: 'fr',
        source: 'x',
        english: null,
        text: undefined,
        demo: false,
        glossary: [],
      }),
    ).toMatchObject({ ok: false, reason: 'missing' });
    expect(check('fr', 'Name', '   ')).toMatchObject({ ok: false, reason: 'empty' });
    // Demo jobs skip the language checks: their "[FR] <German>" would fail them.
    expect(
      validateItem({
        key: 'k',
        locale: 'fr',
        source: 'Bitte wählen Sie eine Rechnung',
        english: null,
        text: '[FR] Bitte wählen Sie eine Rechnung',
        demo: true,
        glossary: DEFAULT_GLOSSARY,
      }),
    ).toMatchObject({ ok: true });
  });
});

describe('h. overwrite rules', () => {
  it('keeps manual and reviewed cells unless replaceManual, and never overwrites an edit made during the job', async () => {
    const manual = async (
      key: string,
      locale: Locale,
      extra: { origin?: 'manual' | 'ai'; reviewed?: boolean } = {},
    ) =>
      saveOverride(t.db, {
        key,
        locale,
        value: `Manuel ${key}`,
        origin: extra.origin ?? 'manual',
        reviewed: extra.reviewed ?? true,
        sourceHash: sourceHash('older German'),
        userId: adminId,
      });
    await manual('jobs.rename', 'fr');
    await manual('jobs.copy', 'fr', { origin: 'ai', reviewed: true });
    await manual('jobs.move', 'fr', { origin: 'ai', reviewed: false });
    await t.ctx.i18n.reload();
    const kept = await estimateOf(scopeOf({ area: 'jobs', selection: 'both' }));
    expect(kept).toMatchObject({ keys: 2, keptManual: 2 });
    const replace = await estimateOf(scopeOf({ area: 'jobs', selection: 'both', replaceManual: true }));
    expect(replace).toMatchObject({ keys: 4, keptManual: 0 });
    const job = await startJob(scopeOf({ area: 'jobs', selection: 'both', replaceManual: true }));
    await run();
    expect(await jobRow(job.id)).toMatchObject({ status: 'completed', done: 4 });
    expect((await overridesOf('fr')).every((o) => o.origin === 'ai' && !o.reviewed)).toBe(true);

    // Edits while the job runs: one in the batch in flight (the guard of the commit), one in the next batch.
    await t.db.delete(translationJobs);
    await t.db.delete(translationOverrides);
    await t.ctx.i18n.reload();
    const hold = gate();
    mock.requests.length = 0;
    answerWith(good, (_body, index) => (index === 0 ? { gate: hold.promise } : undefined));
    const during = await startJob(scopeOf({ locales: ['fr', 'it'], area: 'jobs' }));
    await runner.tick();
    await until(() => mock.requests.length === 1, 'the first batch');
    const edit = (key: string, locale: Locale) =>
      admin.request('PUT', `/admin/i18n/entries/${locale}/${key}`, { value: `Edit {name} ${locale}` });
    expect((await edit('jobs.copy', 'fr')).statusCode).toBe(200);
    expect((await edit('jobs.move', 'it')).statusCode).toBe(200);
    hold.open();
    await runner.whenIdle();
    const row = await jobRow(during.id);
    expect(row).toMatchObject({ status: 'completed', done: 6, skipped: 2 });
    const fr = await overridesOf('fr');
    expect(fr.find((o) => o.key === 'jobs.copy')).toMatchObject({
      origin: 'manual',
      value: 'Edit {name} fr',
    });
    const it = await overridesOf('it');
    expect(it.find((o) => o.key === 'jobs.move')).toMatchObject({ origin: 'manual' });
    // The second batch never asked for the edited cell.
    expect(batchOf(mock.requests.at(-1)!.body).items.map((i) => i.key)).not.toContain('jobs.move');
  });
});

describe('i. transient errors', () => {
  it('waits and retries on overload and server errors, and stops on a rejected key', async () => {
    const overloaded = { error: { status: 529 as const, type: 'overloaded_error', message: 'Overloaded' } };
    answerWith(good, (_body, index) => (index < 2 ? overloaded : undefined));
    const busy = await startJob(scopeOf({ keys: ['jobs.rename'] }));
    await run();
    expect(await jobRow(busy.id)).toMatchObject({ status: 'completed', done: 1 });
    expect(waits).toEqual([5_000, 15_000]);

    await t.db.delete(translationJobs);
    await t.db.delete(translationOverrides);
    await t.ctx.i18n.reload();
    waits.length = 0;
    mock.requests.length = 0;
    answerWith(good, (_body, index) =>
      index === 0 ? { midStreamError: { type: 'api_error', afterFrames: 2 } } : undefined,
    );
    const midStream = await startJob(scopeOf({ keys: ['jobs.copy'] }));
    await run();
    expect(await jobRow(midStream.id)).toMatchObject({ status: 'completed', done: 1 });
    expect(waits).toEqual([5_000]);

    await t.db.delete(translationJobs);
    await t.db.delete(translationOverrides);
    await t.ctx.i18n.reload();
    mock.requests.length = 0;
    answerWith(good, (_body, index) =>
      index >= 1
        ? { error: { status: 401, type: 'authentication_error', message: 'invalid x-api-key' } }
        : undefined,
    );
    const auth = await startJob(scopeOf({ locales: ['fr', 'it', 'nl'], keys: ['jobs.move'] }));
    await run();
    const row = await jobRow(auth.id);
    expect(row).toMatchObject({ status: 'failed', done: 1 });
    expect(row.error).toEqual({
      code: 'ai_upstream',
      message: 'Stopped: the AI service rejected the key or the account (auth).',
    });
    expect(await overridesOf()).toHaveLength(1);
    const [finish] = await t.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'i18n.job_finish'))
      .orderBy(desc(auditLogs.id));
    expect(finish).toMatchObject({ status: 'failure', resourceId: auth.id });
  });
});

describe('stops of plan 2.6', () => {
  it('stops after three batches in a row that failed completely', async () => {
    // A malformed request is not retried: the items of each batch fail at once.
    answerWith(good, () => ({
      error: { status: 400, type: 'invalid_request_error', message: 'bad request' },
    }));
    const job = await startJob(scopeOf({ locales: ['fr', 'it', 'nl', 'en'], keys: ['jobs.rename'] }));
    await run();
    const row = await jobRow(job.id);
    expect(row).toMatchObject({ status: 'failed', done: 0, failed: 3 });
    expect(row.error).toEqual({ code: 'ai_failed', message: 'Stopped: three batches in a row failed.' });
    expect(mock.requests).toHaveLength(3);
    expect(row.failures.map((f) => f.reason)).toEqual(['error', 'error', 'error']);
  });

  it('stops when the translations feature is switched off during the job', async () => {
    const hold = gate();
    answerWith(good, (_body, index) => (index === 0 ? { gate: hold.promise } : undefined));
    const job = await startJob(scopeOf({ locales: ['fr', 'it'], keys: ['jobs.rename'] }));
    await runner.tick();
    await until(() => mock.requests.length === 1, 'the first batch');
    await configureAi(admin, { features: { translations: false } });
    hold.open();
    await runner.whenIdle();
    try {
      const row = await jobRow(job.id);
      expect(row).toMatchObject({ status: 'failed', done: 1 });
      expect(row.error).toEqual({
        code: 'ai_not_configured',
        message: 'Stopped: AI was switched off during the job.',
      });
      expect(mock.requests).toHaveLength(1);
    } finally {
      await configureAi(admin);
    }
  });
});

describe('j. refusal and max_tokens', () => {
  it('isolates a refused item by halves and splits a cut-off answer without a same-size retry', async () => {
    answerWith(good, (body) =>
      batchOf(body).items.some((i) => i.key === 'jobs.move')
        ? { stopReason: 'refusal', refusalCategory: 'cyber' }
        : undefined,
    );
    const refused = await startJob(scopeOf({ area: 'jobs' }));
    await run();
    const row = await jobRow(refused.id);
    expect(row).toMatchObject({ status: 'completed', done: 3, failed: 1 });
    expect(row.failures).toEqual([{ key: 'jobs.move', locale: 'fr', reason: 'refusal', detail: null }]);
    // 4 items, then 2 and 2, then 1 and 1 of the refused half.
    expect(mock.requests.map((r) => batchOf(r.body).items.length)).toEqual([4, 2, 2, 1, 1]);

    await t.db.delete(translationJobs);
    await t.db.delete(translationOverrides);
    await t.ctx.i18n.reload();
    mock.requests.length = 0;
    answerWith(good, (body) => (batchOf(body).items.length > 1 ? { stopReason: 'max_tokens' } : undefined));
    const cut = await startJob(scopeOf({ area: 'jobs' }));
    await run();
    expect(await jobRow(cut.id)).toMatchObject({ status: 'completed', done: 4, failed: 0 });
    expect(mock.requests.map((r) => batchOf(r.body).items.length)).toEqual([4, 2, 1, 1, 2, 1, 1]);
    expect(mock.requests.every((r) => r.body.max_tokens === 32_000)).toBe(true);
  });
});

describe('k. budget and cost cap', () => {
  it('stops when the budget runs out and keeps the finished batches', async () => {
    await configureAi(admin, { budgetUsd: 5 });
    try {
      // 2.5 USD per call: after two batches the budget of 5 USD is spent.
      answerWith(good, () => ({ usage: { input_tokens: 0, output_tokens: 125_000 } }));
      const job = await startJob(scopeOf({ locales: ['fr', 'it', 'nl'], keys: ['jobs.rename'] }));
      // A generous estimate, so the cost cap does not stop the job first.
      await t.db
        .update(translationJobs)
        .set({ estimateMicros: 100_000_000 })
        .where(eq(translationJobs.id, job.id));
      await run();
      const row = await jobRow(job.id);
      expect(row).toMatchObject({ status: 'failed', done: 2 });
      expect(row.error).toEqual({
        code: 'ai_budget_job',
        message: 'The monthly AI budget was used up during the job. Finished batches stay saved.',
      });
      expect(await overridesOf()).toHaveLength(2);
      expect(mock.requests).toHaveLength(2);
    } finally {
      await configureAi(admin);
    }
  });

  it('stops after the batch that crossed 1.5 times the estimate', async () => {
    answerWith(good, () => ({ usage: { input_tokens: 100, output_tokens: 50_000 } }));
    const job = await startJob(scopeOf({ locales: ['fr', 'it', 'nl'], keys: ['jobs.rename'] }));
    const perCall = 100 * 4 + 50_000 * 20;
    await t.db.update(translationJobs).set({ estimateMicros: perCall }).where(eq(translationJobs.id, job.id));
    await run();
    const row = await jobRow(job.id);
    expect(row).toMatchObject({ status: 'failed', done: 2, costMicros: 2 * perCall });
    expect(row.error?.code).toBe('cost_cap');
    expect(mock.requests).toHaveLength(2);
  });

  it('lets the batch in flight commit after the cap, so the job cost is the sum of its calls', async () => {
    const fr = gate();
    const repair = gate();
    answerWith(
      (item, locale) => (locale === 'it' && !item.previous ? 'Voce senza nome' : good(item, locale)),
      (body) => {
        const batch = batchOf(body);
        const usage = { input_tokens: 100, output_tokens: 50_000 };
        if (batch.locale === 'fr') return { gate: fr.promise, usage };
        if (batch.items.some((i) => i.previous)) return { gate: repair.promise, usage };
        return { usage };
      },
    );
    const job = await startJob(scopeOf({ locales: ['fr', 'it', 'nl'], keys: ['jobs.rename'] }));
    const perCall = 100 * 4 + 50_000 * 20;
    // The first commit crosses 1.5 times the estimate.
    await t.db
      .update(translationJobs)
      .set({ estimateMicros: perCall / 2 })
      .where(eq(translationJobs.id, job.id));
    const parallel = newRunner({ concurrency: 2 });
    t.ctx.i18nJobs = parallel;
    await parallel.tick();
    // fr waits for its answer; it got a first answer (paid) and waits in its repair round.
    await until(() => mock.requests.length === 3, 'the fr call and the it repair round');
    fr.open();
    await until(async () => (await jobRow(job.id)).costMicros > 0, 'the fr commit');
    repair.open();
    await parallel.whenIdle();

    const row = await jobRow(job.id);
    expect(row).toMatchObject({ status: 'failed', done: 2, failed: 0 });
    expect(row.error?.code).toBe('cost_cap');
    // No batch was claimed after the cap (nl), and nothing that was paid for got lost.
    expect(mock.requests).toHaveLength(3);
    const usage = await t.db.select().from(aiUsage);
    expect(usage).toHaveLength(3);
    expect(row.costMicros).toBe(usage.reduce((sum, u) => sum + u.costMicros, 0));
    expect(row.costMicros).toBe(3 * perCall);
    expect((await overridesOf()).map((o) => o.locale).sort()).toEqual(['fr', 'it']);
  });
});

describe('l. cancel', () => {
  it('aborts the batch in flight, cancels a queued job at once and refuses a finished one', async () => {
    const hold = gate();
    answerWith(good, () => ({ gate: hold.promise }));
    const job = await startJob(scopeOf({ area: 'jobs' }));
    await runner.tick();
    await until(() => mock.requests.length === 1, 'the call in flight');
    expect((await jobRow(job.id)).status).toBe('running');
    const res = await admin.post(`/admin/i18n/ai/jobs/${job.id}/cancel`);
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({ cancelRequested: true });
    await runner.whenIdle();
    hold.open();
    expect(await jobRow(job.id)).toMatchObject({ status: 'cancelled', done: 0, runner: null });
    expect(await overridesOf()).toHaveLength(0);
    const [usage] = await t.db.select().from(aiUsage);
    expect(usage?.status).toBe('cancelled');
    const [cancelAudit] = await t.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'i18n.job_cancel'))
      .orderBy(desc(auditLogs.id));
    expect(cancelAudit?.details).toEqual({ jobId: job.id, status: 'requested' });

    answerWith(good);
    const queued = await startJob(scopeOf({ area: 'jobs' }));
    const now = await admin.post(`/admin/i18n/ai/jobs/${queued.id}/cancel`);
    expect(json(now)).toMatchObject({ status: 'cancelled' });
    await run();
    expect(mock.requests).toHaveLength(1);
    const finished = await admin.post(`/admin/i18n/ai/jobs/${job.id}/cancel`);
    expect(finished.statusCode).toBe(409);
    expect(json(finished).error).toMatchObject({ code: 'job_finished', details: { status: 'cancelled' } });
  });
});

describe('m. restart and takeover', () => {
  it('re-queues on stop and resumes only the batches that are left', async () => {
    const hold = gate();
    answerWith(good, (_body, index) => (index === 1 ? { gate: hold.promise } : undefined));
    const job = await startJob(scopeOf({ locales: ['fr', 'it'], area: 'jobs' }));
    await runner.tick();
    await until(() => mock.requests.length === 2, 'the second batch');
    await runner.stop();
    hold.open();
    const stopped = await jobRow(job.id);
    expect(stopped).toMatchObject({ status: 'queued', runner: null, done: 4 });
    expect(stopped.doneBatches).toEqual([0]);

    answerWith(good);
    mock.requests.length = 0;
    const next = newRunner();
    await run(next);
    expect(await jobRow(job.id)).toMatchObject({ status: 'completed', done: 8 });
    expect(mock.requests).toHaveLength(1);
    expect(batchOf(mock.requests[0]!.body).locale).toBe('it');
  });

  it('takes over a job without heartbeat for two minutes, never a fresh one, and never twice', async () => {
    const job = await startJob(scopeOf({ area: 'jobs' }));
    await t.db
      .update(translationJobs)
      .set({ status: 'running', runner: 'gone:1:dead', heartbeatAt: new Date() })
      .where(eq(translationJobs.id, job.id));
    const fresh = newRunner();
    await run(fresh);
    expect(await jobRow(job.id)).toMatchObject({ status: 'running', runner: 'gone:1:dead' });
    expect(mock.requests).toHaveLength(0);

    const later = () => new Date(Date.now() + 3 * 60_000);
    const a = newRunner({ now: later });
    const b = newRunner({ now: later });
    await Promise.all([a.tick(), b.tick()]);
    expect([a.activeJobId, b.activeJobId].filter(Boolean)).toEqual([job.id]);
    await Promise.all([a.whenIdle(), b.whenIdle()]);
    const row = await jobRow(job.id);
    expect(row).toMatchObject({ status: 'completed', done: 4, runner: null });
    expect(mock.requests).toHaveLength(1);
  });

  it('fences the commit of a runner that lost the job', async () => {
    const hold = gate();
    answerWith(good, () => ({ gate: hold.promise }));
    const job = await startJob(scopeOf({ area: 'jobs' }));
    // No heartbeat during the test: the commit itself must notice.
    const slow = newRunner({ heartbeatMs: 600_000 });
    await slow.tick();
    await until(() => mock.requests.length === 1, 'the call in flight');
    // Another instance took the job over meanwhile.
    await t.db.update(translationJobs).set({ runner: 'other:2:alive' }).where(eq(translationJobs.id, job.id));
    hold.open();
    await slow.whenIdle();
    expect(await t.db.select().from(aiUsage)).toMatchObject([{ status: 'ok' }]);
    expect(await jobRow(job.id)).toMatchObject({ status: 'running', runner: 'other:2:alive', done: 0 });
    expect(await overridesOf()).toHaveLength(0);
  });
});

describe('n. retry failed', () => {
  it('creates a job over exactly the failed pairs, never legal keys', async () => {
    const [failed] = await t.db
      .insert(translationJobs)
      .values({
        status: 'completed',
        locales: ['fr', 'it'],
        scope: scopeOf({ locales: ['fr', 'it'] }),
        model: 'claude-opus-5-5',
        batches: [],
        total: 4,
        estimateMicros: 1,
        createdBy: adminId,
        failures: [
          { key: 'jobs.copy', locale: 'fr', reason: 'error', detail: null },
          { key: 'jobs.open', locale: 'it', reason: 'placeholders', detail: 'missing {name}' },
          { key: 'ai.notice.text', locale: 'fr', reason: 'error', detail: null },
          { key: 'gone.key', locale: 'fr', reason: 'error', detail: null },
        ],
      })
      .returning();
    const scope = scopeOf({ locales: ['fr', 'it'], retryOf: failed!.id });
    const estimate = await estimateOf(scope);
    expect(estimate).toMatchObject({ keys: 2, perLocale: { fr: 1, it: 1 } });
    const res = await admin.post(`/admin/i18n/ai/jobs/${failed!.id}/retry`, {
      scope,
      confirmCostMicros: estimate.costMicros,
    });
    expect(res.statusCode, res.body).toBe(200);
    const retry = json<TranslationJobDto>(res);
    expect(retry).toMatchObject({ retryOf: failed!.id, total: 2 });
    const row = await jobRow(retry.id);
    expect(row.batches).toEqual([
      { locale: 'fr', keys: ['jobs.copy'] },
      { locale: 'it', keys: ['jobs.open'] },
    ]);
    const [audit] = await t.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'i18n.job_retry'))
      .orderBy(desc(auditLogs.id));
    expect(audit?.details).toEqual({ jobId: retry.id, retryOf: failed!.id, keys: 2 });
    await run();
    expect(await jobRow(retry.id)).toMatchObject({ status: 'completed', done: 2 });

    const none = await admin.post(`/admin/i18n/ai/jobs/${retry.id}/retry`, { scope, confirmCostMicros: 0 });
    expect(none.statusCode).toBe(409);
    expect(json(none).error.code).toBe('nothing_to_translate');
  });
});

describe('o. demo', () => {
  it('saves [FR] <German> as demo rows at cost 0, serves them, and a saved key deletes them', async () => {
    expect((await admin.del('/admin/ai/key')).statusCode).toBe(200);
    try {
      const scope = scopeOf({ keys: ['nav.dashboard', 'servers.count', 'login.hero.text'] });
      const estimate = await estimateOf(scope);
      expect(estimate).toMatchObject({ demo: true, costMicros: 0, budgetRemainingMicros: null, keys: 3 });
      const job = await startJob(scope);
      expect(job.demo).toBe(true);
      await run();
      const row = await jobRow(job.id);
      expect(row).toMatchObject({ status: 'completed', done: 3, demo: true, costMicros: 0 });
      const overrides = await overridesOf('fr');
      expect(overrides.map((o) => [o.key, o.value, o.demo]).sort()).toEqual([
        ['login.hero.text', '[FR] Melden Sie sich an, um Ihre Server zu verwalten.', true],
        ['nav.dashboard', '[FR] Übersicht', true],
        ['servers.count', '[FR] {count} Server', true],
      ]);
      expect(mock.requests).toHaveLength(0);
      const usage = await t.db.select().from(aiUsage);
      expect(usage.every((u) => u.demo && u.costMicros === 0)).toBe(true);
      const served = json(await t.app.inject({ method: 'GET', url: '/api/v1/i18n/overrides/fr' }));
      expect(served.values['nav.dashboard']).toBe('[FR] Übersicht');
      const saved = await admin.request('PUT', '/admin/ai/key', { key: MOCK_API_KEY });
      expect(saved.statusCode).toBe(200);
      expect(json(saved).demoOverridesDeleted).toBe(3);
    } finally {
      await admin.request('PUT', '/admin/ai/key', { key: MOCK_API_KEY });
    }
    expect(await overridesOf()).toHaveLength(0);
    // Demo rows written by another demo installation are cleaned up by A8 with demo: true.
    await saveOverride(t.db, {
      key: 'nav.servers',
      locale: 'it',
      value: '[IT] Server',
      origin: 'ai',
      reviewed: false,
      sourceHash: hashOf('nav.servers'),
      demo: true,
      userId: null,
    });
    await t.ctx.i18n.reload();
    const cleanup = await admin.post('/admin/i18n/cleanup', {
      orphans: false,
      sameAsCompiled: false,
      demo: true,
    });
    expect(json(cleanup)).toMatchObject({ demo: 1 });
    expect(await overridesOf()).toHaveLength(0);
  });
});
