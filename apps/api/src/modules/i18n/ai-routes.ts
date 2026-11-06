import { count, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  isLegalKey,
  TARGET_LOCALES,
  type Paginated,
  type ServerTranslationKey,
  type TranslationEstimateDto,
  type TranslationJobDetailDto,
  type TranslationJobDto,
  type TranslationJobScope,
  type TranslationSuggestDto,
  type TranslationSuggestionDto,
} from '@weblion/shared';
import { SECTIONS } from '@weblion/shared/i18n/sections/index';
import type { AppContext } from '../../context';
import { platformScope, requireSession } from '../../auth/access';
import { translationJobs, type TranslationJob } from '../../db/schema';
import {
  batchItems,
  estimate,
  readStyleNotes,
  systemPrompt,
  TranslationBatchOutput,
  userMessage,
  validateItem,
} from '../../i18n/translator';
import { notFound } from '../../lib/errors';
import { parse } from '../../lib/validation';
import { aiLimit, aiNotConfigured } from '../ai/errors';
import { jobDetailDto, jobDto, jobDtos } from './dto';
import { estimateChanged, jobFinished, jobRunning, legalKey, nothingToTranslate, unknownKey } from './errors';

/** A start is refused when the cost rose more than this since the confirmed estimate (plan decision 10). */
const ESTIMATE_TOLERANCE = 1.25;
const JOBS_PER_PAGE = 20;

const localesSchema = z
  .array(z.enum(TARGET_LOCALES))
  .min(1)
  .max(4)
  .refine((l) => new Set(l).size === l.length, 'each language once');

const scopeSchema = z.object({
  locales: localesSchema,
  selection: z.enum(['untranslated', 'stale', 'both', 'all']),
  area: z.string().max(100).optional(),
  section: z.enum(SECTIONS).optional(),
  q: z.string().max(200).optional(),
  keys: z.array(z.string().min(1).max(300)).max(5_000).optional(),
  retryOf: z.uuid().optional(),
  replaceManual: z.boolean(),
});

const startBody = z.object({
  scope: scopeSchema,
  confirmCostMicros: z.number().int().min(0),
});

const suggestBody = z.object({ key: z.string().min(1).max(300), locales: localesSchema });
const idParams = z.object({ id: z.uuid() });
const pageQuery = z.object({ page: z.coerce.number().int().min(1).default(1) });

/** Finished jobs: the end states of 12.8. */
const FINISHED = ['completed', 'failed', 'cancelled'] as const;

/**
 * AI and job routes of the translation admin (i18n 14.3, plan O10). B1, B2, B3 and B7 start model work and need
 * platform:i18n:write and platform:ai:use, then the translations feature (409 ai_not_configured with the
 * reason); listing and cancelling jobs work while AI is off.
 */
export async function i18nAiRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, access, audit, i18n } = ctx;

  async function reading(req: FastifyRequest) {
    const auth = requireSession(req);
    await access.assert(req, 'platform:i18n:read', platformScope);
    return auth;
  }

  async function writing(req: FastifyRequest) {
    const auth = requireSession(req);
    await access.assert(req, 'platform:i18n:write', platformScope);
    return auth;
  }

  /** The gate of the AI routes: both permissions, then the feature (O5: 409 instead of 404). */
  async function withAi(req: FastifyRequest) {
    const auth = requireSession(req);
    await access.assert(req, 'platform:i18n:write', platformScope);
    await access.assert(req, 'platform:ai:use', platformScope);
    return auth;
  }

  async function assertAvailable() {
    const availability = await ctx.ai.availability('translations');
    if (!availability.available) throw aiNotConfigured(availability.reason ?? 'disabled');
    return availability;
  }

  async function loadJob(id: string): Promise<TranslationJob> {
    const job = await db.query.translationJobs.findFirst({ where: eq(translationJobs.id, id) });
    if (!job) throw notFound('Translation job');
    return job;
  }

  /** The failed pairs of a job (never legal keys, never keys that are gone). */
  function failedPairs(job: TranslationJob, scope: TranslationJobScope) {
    const seen = new Set<string>();
    const pairs: { key: string; locale: (typeof TARGET_LOCALES)[number] }[] = [];
    for (const f of job.failures) {
      if (!scope.locales.includes(f.locale) || isLegalKey(f.key) || !i18n.catalog.has(f.key)) continue;
      const id = `${f.locale}\u0000${f.key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      pairs.push({ key: f.key, locale: f.locale });
    }
    return pairs;
  }

  /**
   * B3 and B7 (12.1 step 5): recompute the estimate; nothing to translate, a cost more than 25 percent above the
   * confirmed one, a used-up budget or a job already queued or running refuse the start. Inserts the job queued
   * with its fixed plan; the runner picks it up within one tick.
   */
  async function startJob(
    userId: string,
    scope: TranslationJobScope,
    confirmCostMicros: number,
    retryOf: TranslationJob | null,
  ): Promise<TranslationJob> {
    const availability = await assertAvailable();
    const failed = retryOf ? failedPairs(retryOf, scope) : undefined;
    const { dto, plan, selection } = await estimate(ctx, scope, failed);
    if (selection.legalOnly) throw legalKey(selection.legalOnly);
    if (dto.keys === 0) throw nothingToTranslate();
    if (dto.costMicros > ESTIMATE_TOLERANCE * confirmCostMicros) {
      throw estimateChanged(dto.costMicros, confirmCostMicros);
    }
    // Refused only when the budget is already used up; a short budget stops the job when it runs out (O22).
    if ((await ctx.ai.budgetState()).exhausted) throw aiLimit('budget');
    const active = await db.query.translationJobs.findFirst({
      where: inArray(translationJobs.status, ['queued', 'running']),
    });
    if (active) throw jobRunning(active.id);
    let job: TranslationJob;
    try {
      const [row] = await db
        .insert(translationJobs)
        .values({
          status: 'queued',
          locales: TARGET_LOCALES.filter((l) => scope.locales.includes(l)),
          scope,
          replaceManual: scope.replaceManual,
          model: availability.model,
          demo: availability.demo,
          batches: plan,
          total: dto.keys,
          estimateMicros: dto.costMicros,
          retryOf: retryOf?.id ?? null,
          createdBy: userId,
        })
        .returning();
      job = row!;
    } catch (err) {
      // Two starts at once: the partial unique index lets one through.
      if ((err as { code?: unknown })?.code === '23505') {
        const other = await db.query.translationJobs.findFirst({
          where: inArray(translationJobs.status, ['queued', 'running']),
        });
        throw jobRunning(other?.id ?? null);
      }
      throw err;
    }
    return job;
  }

  // --- B1 suggest ---------------------------------------------------------------------------------

  app.post('/admin/i18n/ai/suggest', async (req): Promise<TranslationSuggestDto> => {
    const auth = await withAi(req);
    const body = parse(suggestBody, req.body);
    const availability = await assertAvailable();
    if (!i18n.catalog.has(body.key)) throw unknownKey(body.key);
    const key = body.key as ServerTranslationKey;
    if (isLegalKey(key)) throw legalKey([key]);
    // One up-front check of the person's limits for the calls below (O9); each call reserves on its own.
    await ctx.ai.countRate({ userId: auth.user.id });
    const notes = await readStyleNotes(db);
    const glossary = i18n.glossaryTerms();
    const suggestions: TranslationSuggestionDto[] = [];
    let costMicros = 0;
    // One call per language, one after the other (plan U1); no repair round and no retries (i18n 12.4).
    for (const locale of TARGET_LOCALES.filter((l) => body.locales.includes(l))) {
      const [item] = batchItems(i18n, { locale, keys: [key] });
      const answer = await ctx.ai.structured({
        feature: 'translations',
        scope: 'platform',
        orgId: null,
        countsForUser: true,
        retryOnMaxTokens: false,
        actor: { userId: auth.user.id },
        system: systemPrompt(locale, glossary, notes[locale] ?? ''),
        user: userMessage({ locale, items: [item!] }),
        schema: TranslationBatchOutput,
      });
      costMicros += answer.costMicros;
      const text = answer.data.items.find((i) => i.id === item!.id)?.text;
      const check = validateItem({
        key,
        locale,
        source: item!.de,
        english: item!.en,
        text,
        demo: answer.meta.demo,
        glossary,
      });
      suggestions.push(
        check.ok
          ? { locale, value: check.value, reason: null, detail: null }
          : { locale, value: null, reason: check.reason, detail: check.detail },
      );
    }
    return { key, suggestions, costMicros, demo: availability.demo };
  });

  // --- B2 estimate --------------------------------------------------------------------------------

  app.post('/admin/i18n/ai/estimate', async (req): Promise<TranslationEstimateDto> => {
    await withAi(req);
    const scope = parse(scopeSchema, req.body) as TranslationJobScope;
    await assertAvailable();
    let failed: { key: string; locale: (typeof TARGET_LOCALES)[number] }[] | undefined;
    if (scope.retryOf) failed = failedPairs(await loadJob(scope.retryOf), scope);
    const { dto, selection } = await estimate(ctx, scope, failed);
    if (selection.legalOnly) throw legalKey(selection.legalOnly);
    return dto;
  });

  // --- B3 start, B7 retry ---------------------------------------------------------------------------

  app.post('/admin/i18n/ai/jobs', async (req): Promise<TranslationJobDto> => {
    const auth = await withAi(req);
    const body = parse(startBody, req.body);
    const scope = { ...body.scope, retryOf: undefined } as TranslationJobScope;
    const job = await startJob(auth.user.id, scope, body.confirmCostMicros, null);
    await audit.record(req, {
      action: 'i18n.job_start',
      orgId: null,
      resourceType: 'translation_job',
      resourceId: job.id,
      details: {
        jobId: job.id,
        locales: job.locales,
        keys: job.total,
        estimateMicros: job.estimateMicros,
        replaceManual: job.replaceManual,
        demo: job.demo,
        model: job.model,
      },
    });
    return jobDto(db, job);
  });

  app.post('/admin/i18n/ai/jobs/:id/retry', async (req): Promise<TranslationJobDto> => {
    const auth = await withAi(req);
    const { id } = parse(idParams, req.params);
    const body = parse(startBody, req.body);
    const original = await loadJob(id);
    if (!(FINISHED as readonly string[]).includes(original.status) || original.failures.length === 0) {
      throw nothingToTranslate();
    }
    const scope = { ...body.scope, retryOf: id } as TranslationJobScope;
    const job = await startJob(auth.user.id, scope, body.confirmCostMicros, original);
    await audit.record(req, {
      action: 'i18n.job_retry',
      orgId: null,
      resourceType: 'translation_job',
      resourceId: job.id,
      details: { jobId: job.id, retryOf: id, keys: job.total },
    });
    return jobDto(db, job);
  });

  // --- B4, B5 list and detail, B6 cancel ----------------------------------------------------------

  app.get('/admin/i18n/ai/jobs', async (req): Promise<Paginated<TranslationJobDto>> => {
    await reading(req);
    const { page } = parse(pageQuery, req.query);
    const [rows, [total]] = await Promise.all([
      db.query.translationJobs.findMany({
        orderBy: desc(translationJobs.createdAt),
        limit: JOBS_PER_PAGE,
        offset: (page - 1) * JOBS_PER_PAGE,
      }),
      db.select({ n: count() }).from(translationJobs),
    ]);
    return { items: await jobDtos(db, rows), total: Number(total?.n ?? 0), page, perPage: JOBS_PER_PAGE };
  });

  app.get('/admin/i18n/ai/jobs/:id', async (req): Promise<TranslationJobDetailDto> => {
    await reading(req);
    const { id } = parse(idParams, req.params);
    return jobDetailDto(db, await loadJob(id));
  });

  app.post('/admin/i18n/ai/jobs/:id/cancel', async (req): Promise<TranslationJobDto> => {
    await writing(req);
    const { id } = parse(idParams, req.params);
    await loadJob(id);
    const outcome = await ctx.i18nJobs.requestCancel(id);
    if (outcome === 'finished') throw jobFinished((await loadJob(id)).status);
    await audit.record(req, {
      action: 'i18n.job_cancel',
      orgId: null,
      resourceType: 'translation_job',
      resourceId: id,
      details: { jobId: id, status: outcome },
    });
    return jobDto(db, await loadJob(id));
  });
}
