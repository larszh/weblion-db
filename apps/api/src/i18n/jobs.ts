import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { and, asc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type pg from 'pg';
import { isLegalKey } from '@weblion/shared';
import type { GlossaryTerm } from '@weblion/shared/i18n/glossary';
import type { AppContext } from '../context';
import { translationJobs, translationOverrides, type TranslationJob } from '../db/schema';
import { notFound } from '../lib/errors';
import { AiCancelled } from '../modules/ai/errors';
import { loadGlossary } from './glossary';
import {
  defaultSleep,
  JOB_ERROR_MESSAGES,
  JobStop,
  keepsRow,
  readStyleNotes,
  translateBatch,
  type BatchResult,
} from './translator';

/** Session advisory lock that serializes claiming a translation job across API processes (plan 3.3). */
export const I18N_JOB_LOCK = 742_004;

export interface JobRunnerOptions {
  /** Injected for tests; default setTimeout-based sleep honouring the abort signal. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => Date;
  tickMs?: number; // 5,000
  heartbeatMs?: number; // 30,000
  /** A running job without heartbeat for this long is taken over. */
  staleAfterMs?: number; // 120,000
  concurrency?: number; // env I18N_AI_CONCURRENCY (1 to 4, default 2)
}

/** The job stops at this multiple of its estimate (i18n 12.6, plan O29). */
export const COST_CAP_FACTOR = 1.5;
/** Three batches in a row without one saved item end the job (plan 2.6). */
const FAILED_BATCHES_IN_A_ROW = 3;

/** The commit's fence matched no row: another runner owns the job, or a cancel was requested. */
class LostJob extends Error {}

interface ActiveRun {
  jobId: string;
  abort: AbortController;
  /** stop(): the job goes back to the queue. */
  stopping: boolean;
  /** B6 asked to cancel. */
  cancelled: boolean;
  /** Another runner took the job over (or it is gone): this runner leaves it alone. */
  lost: boolean;
  done: Promise<void>;
}

/**
 * Runs Mass Translate jobs (i18n 12.8). One job at a time across all API processes: a tick claims a queued job,
 * or takes over a running one whose runner stopped sending heartbeats, under the advisory lock I18N_JOB_LOCK, and
 * runs it outside the lock. Every batch commits on its own, fenced by `runner = me`, so a runner that lost the
 * job after a takeover writes nothing. Times come from the injected clock, never the database (case m).
 */
export class TranslationJobRunner {
  /** `${hostname}:${pid}:${random}`, so a restarted process never mistakes the old row for its own. */
  readonly instanceId = `${hostname()}:${process.pid}:${randomBytes(4).toString('hex')}`;
  private timer: NodeJS.Timeout | null = null;
  private active: ActiveRun | null = null;

  constructor(
    protected readonly ctx: AppContext,
    protected readonly pool: pg.Pool,
    protected readonly options: JobRunnerOptions = {},
  ) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private get concurrency(): number {
    const value = this.options.concurrency ?? this.ctx.env.I18N_AI_CONCURRENCY ?? 2;
    return Math.min(4, Math.max(1, Math.floor(value)));
  }

  /** Tick every tickMs, timers unref()ed, like BillingJob.start (modules/billing/recurring.ts). */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) =>
        this.ctx.log.warn({ err, job: 'translations' }, 'translation job tick failed'),
      );
    }, this.options.tickMs ?? 5_000);
    this.timer.unref();
  }

  /** Aborts in-flight calls, re-queues the job this runner owns (runner = null), clears the timers. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const active = this.active;
    if (!active) return;
    active.stopping = true;
    active.abort.abort();
    await active.done;
  }

  /** Resolves when the job this runner works on is done (tests; a tick only starts the run). */
  async whenIdle(): Promise<void> {
    await this.active?.done;
  }

  /** The job this runner works on right now, if any. */
  get activeJobId(): string | null {
    return this.active?.jobId ?? null;
  }

  /** One tick: claim under the advisory lock I18N_JOB_LOCK and run or resume a job. Exported for tests. */
  async tick(): Promise<void> {
    if (this.active) return;
    const client = await this.pool.connect();
    let job: TranslationJob | null = null;
    try {
      const { rows } = await client.query<{ locked: boolean }>('select pg_try_advisory_lock($1) as locked', [
        I18N_JOB_LOCK,
      ]);
      if (!rows[0]?.locked) return;
      try {
        if (!this.active) job = await this.claim();
      } finally {
        await client.query('select pg_advisory_unlock($1)', [I18N_JOB_LOCK]);
      }
    } finally {
      client.release();
    }
    if (job) this.begin(job);
  }

  /**
   * B6: queued -> 'cancelled' at once; running -> cancel_requested, 'requested' (the owner aborts within one
   * heartbeat or at its next commit, at once when it is this runner); finished -> 'finished'. 404 for an unknown id.
   */
  async requestCancel(jobId: string): Promise<'cancelled' | 'requested' | 'finished'> {
    const { db } = this.ctx;
    const [queued] = await db
      .update(translationJobs)
      .set({ status: 'cancelled', cancelRequested: true, finishedAt: this.now() })
      .where(and(eq(translationJobs.id, jobId), eq(translationJobs.status, 'queued')))
      .returning({ id: translationJobs.id });
    if (queued) return 'cancelled';
    const [running] = await db
      .update(translationJobs)
      .set({ cancelRequested: true })
      .where(and(eq(translationJobs.id, jobId), eq(translationJobs.status, 'running')))
      .returning({ id: translationJobs.id });
    if (running) {
      const active = this.active;
      if (active?.jobId === jobId) {
        active.cancelled = true;
        active.abort.abort();
      }
      return 'requested';
    }
    const job = await db.query.translationJobs.findFirst({ where: eq(translationJobs.id, jobId) });
    if (!job) throw notFound('Translation job');
    return 'finished';
  }

  /** The claim statement of 12.8 step 3: the oldest queued job, or a running one without fresh heartbeat. */
  private async claim(): Promise<TranslationJob | null> {
    const now = this.now();
    const staleBefore = new Date(now.getTime() - (this.options.staleAfterMs ?? 120_000));
    const candidate = this.ctx.db
      .select({ id: translationJobs.id })
      .from(translationJobs)
      .where(
        or(
          eq(translationJobs.status, 'queued'),
          and(
            eq(translationJobs.status, 'running'),
            or(isNull(translationJobs.heartbeatAt), lt(translationJobs.heartbeatAt, staleBefore)),
          ),
        ),
      )
      .orderBy(asc(translationJobs.createdAt))
      .limit(1);
    const [job] = await this.ctx.db
      .update(translationJobs)
      .set({
        status: 'running',
        runner: this.instanceId,
        heartbeatAt: now,
        startedAt: sql`coalesce(${translationJobs.startedAt}, ${now})`,
      })
      .where(inArray(translationJobs.id, candidate))
      .returning();
    return job ?? null;
  }

  private begin(job: TranslationJob): void {
    const active: ActiveRun = {
      jobId: job.id,
      abort: new AbortController(),
      stopping: false,
      cancelled: false,
      lost: false,
      done: Promise.resolve(),
    };
    this.active = active;
    active.done = this.run(job, active)
      .catch((err) => this.ctx.log.error({ err, jobId: job.id }, 'translation job failed'))
      .finally(() => {
        if (this.active === active) this.active = null;
      });
  }

  /** Heartbeat on its own timer (12.8): keeps the job from being taken over while a long call runs. */
  private async heartbeat(job: TranslationJob, active: ActiveRun): Promise<void> {
    const [row] = await this.ctx.db
      .update(translationJobs)
      .set({ heartbeatAt: this.now() })
      .where(
        and(
          eq(translationJobs.id, job.id),
          eq(translationJobs.runner, this.instanceId),
          eq(translationJobs.status, 'running'),
        ),
      )
      .returning({ cancelRequested: translationJobs.cancelRequested });
    if (!row) {
      active.lost = true;
      active.abort.abort();
    } else if (row.cancelRequested) {
      active.cancelled = true;
      active.abort.abort();
    }
  }

  private async run(job: TranslationJob, active: ActiveRun): Promise<void> {
    const { ctx } = this;
    const signal = active.abort.signal;
    const heartbeat = setInterval(() => {
      this.heartbeat(job, active).catch((err) =>
        ctx.log.warn({ err, jobId: job.id }, 'translation job heartbeat failed'),
      );
    }, this.options.heartbeatMs ?? 30_000);
    heartbeat.unref();
    try {
      if (job.cancelRequested) active.cancelled = true;
      let stop: JobStop | null = null;
      if (!active.cancelled) {
        const [glossary, notes] = await Promise.all([loadGlossary(ctx.db), readStyleNotes(ctx.db)]);
        const done = new Set(job.doneBatches);
        const pending = job.batches.map((_, i) => i).filter((i) => !done.has(i));
        let cost = job.costMicros;
        let failedInARow = 0;
        let next = 0;
        const capReached = () => job.estimateMicros > 0 && cost > COST_CAP_FACTOR * job.estimateMicros;
        const halt = (reason: JobStop) => {
          stop ??= reason;
          active.abort.abort();
        };

        const worker = async () => {
          while (!stop && !signal.aborted) {
            if (capReached()) {
              halt(new JobStop('cost_cap', JOB_ERROR_MESSAGES.cost_cap));
              break;
            }
            const index = pending[next++];
            if (index === undefined) break;
            try {
              const availability = await ctx.ai.availability('translations');
              // A demo job must not continue with a real key (or the other way round): its results are marked.
              if (availability.available && availability.demo !== job.demo) {
                halt(new JobStop('ai_not_configured', JOB_ERROR_MESSAGES.ai_not_configured));
                break;
              }
              const { result, attempted, skipped } = await this.translate(
                job,
                index,
                glossary,
                notes,
                signal,
              );
              const committed = await this.commit(job, index, result, skipped);
              cost = committed.costMicros;
              await ctx.i18n.reload();
              if (attempted > 0 && result.saved.length === 0) failedInARow++;
              else failedInARow = 0;
              if (failedInARow >= FAILED_BATCHES_IN_A_ROW) {
                halt(new JobStop('ai_failed', JOB_ERROR_MESSAGES.ai_failed));
              } else if (capReached()) {
                halt(new JobStop('cost_cap', JOB_ERROR_MESSAGES.cost_cap));
              }
            } catch (err) {
              if (err instanceof JobStop) halt(err);
              else if (err instanceof LostJob) await this.lostOrCancelled(job, active);
              else if (!(err instanceof AiCancelled) && !signal.aborted) {
                ctx.log.error({ err, jobId: job.id, batch: index }, 'translation batch failed');
                halt(new JobStop('ai_failed', JOB_ERROR_MESSAGES.ai_failed));
              }
              break;
            }
          }
        };
        await Promise.all(
          Array.from({ length: Math.max(1, Math.min(this.concurrency, pending.length)) }, worker),
        );
      }

      if (active.lost) return;
      if (active.stopping) {
        await this.requeue(job);
        return;
      }
      if (active.cancelled) await this.finish(job, 'cancelled', null);
      else if (stop)
        await this.finish(job, 'failed', {
          code: (stop as JobStop).code,
          message: (stop as JobStop).message,
        });
      else await this.finish(job, 'completed', null);
    } finally {
      clearInterval(heartbeat);
    }
  }

  /** Reads the batch's cells at run time, leaves out what the overwrite rules now exclude, and translates. */
  private async translate(
    job: TranslationJob,
    index: number,
    glossary: readonly GlossaryTerm[],
    notes: Partial<Record<string, string>>,
    signal: AbortSignal,
  ): Promise<{ result: BatchResult; attempted: number; skipped: number }> {
    const plan = job.batches[index]!;
    const { i18n } = this.ctx;
    const keys: string[] = [];
    let skipped = 0;
    for (const key of plan.keys) {
      // A key removed by a deploy, a legal key (never planned), or a cell a person edited meanwhile (12.9).
      if (
        !i18n.catalog.has(key) ||
        isLegalKey(key) ||
        keepsRow(i18n.override(plan.locale, key), job.replaceManual)
      ) {
        skipped++;
        continue;
      }
      keys.push(key);
    }
    const empty: BatchResult = {
      saved: [],
      failures: [],
      tokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costMicros: 0,
    };
    if (keys.length === 0) return { result: empty, attempted: 0, skipped };
    const result = await translateBatch(this.ctx, {
      batch: { locale: plan.locale, keys },
      actor: { userId: job.createdBy },
      demo: job.demo,
      glossary,
      style: notes[plan.locale] ?? '',
      signal,
      sleep: this.options.sleep ?? defaultSleep,
    });
    return { result, attempted: keys.length, skipped };
  }

  /**
   * Commits one batch in one transaction (12.8): the overrides with the guard of 12.9 (a cell edited by a person
   * meanwhile wins and counts as skipped), then the counters, fenced by runner, status and cancel. Zero rows on
   * the job: rolled back, nothing of the batch is written.
   */
  private async commit(
    job: TranslationJob,
    index: number,
    result: BatchResult,
    skipped: number,
  ): Promise<{ costMicros: number }> {
    const now = this.now();
    return this.ctx.db.transaction(async (tx) => {
      let written = 0;
      if (result.saved.length > 0) {
        const rows = await tx
          .insert(translationOverrides)
          .values(
            result.saved.map((s) => ({
              key: s.key,
              locale: s.locale,
              value: s.value,
              origin: 'ai' as const,
              reviewed: false,
              sourceHash: s.sourceHash,
              demo: job.demo,
              updatedBy: job.createdBy,
              updatedAt: now,
            })),
          )
          .onConflictDoUpdate({
            target: [translationOverrides.key, translationOverrides.locale],
            set: {
              value: sql`excluded.value`,
              origin: sql`excluded.origin`,
              reviewed: sql`excluded.reviewed`,
              sourceHash: sql`excluded.source_hash`,
              demo: sql`excluded.demo`,
              updatedBy: sql`excluded.updated_by`,
              updatedAt: sql`excluded.updated_at`,
            },
            setWhere: sql`${translationOverrides.demo} or (${translationOverrides.origin} = 'ai' and not ${translationOverrides.reviewed}) or ${job.replaceManual}`,
          })
          .returning({ key: translationOverrides.key });
        written = rows.length;
      }
      const kept = result.saved.length - written;
      const failures = JSON.stringify(result.failures);
      const [updated] = await tx
        .update(translationJobs)
        .set({
          doneBatches: sql`array_append(${translationJobs.doneBatches}, ${index}::integer)`,
          done: sql`${translationJobs.done} + ${written}`,
          failed: sql`${translationJobs.failed} + ${result.failures.length}`,
          skipped: sql`${translationJobs.skipped} + ${skipped + kept}`,
          inputTokens: sql`${translationJobs.inputTokens} + ${result.tokens.inputTokens}`,
          outputTokens: sql`${translationJobs.outputTokens} + ${result.tokens.outputTokens}`,
          cacheReadTokens: sql`${translationJobs.cacheReadTokens} + ${result.tokens.cacheReadTokens}`,
          cacheWriteTokens: sql`${translationJobs.cacheWriteTokens} + ${result.tokens.cacheWriteTokens}`,
          costMicros: sql`${translationJobs.costMicros} + ${result.costMicros}`,
          // At most 1,000 entries; the failed counter keeps counting.
          failures: sql`(select coalesce(jsonb_agg(e order by n), '[]'::jsonb) from (select e, n from jsonb_array_elements(${translationJobs.failures} || ${failures}::jsonb) with ordinality as t(e, n) order by n limit 1000) s)`,
          heartbeatAt: now,
        })
        .where(
          and(
            eq(translationJobs.id, job.id),
            eq(translationJobs.runner, this.instanceId),
            eq(translationJobs.status, 'running'),
            eq(translationJobs.cancelRequested, false),
          ),
        )
        .returning({ costMicros: translationJobs.costMicros });
      if (!updated) throw new LostJob();
      return updated;
    });
  }

  /** After a fenced commit failed: a cancel of this runner's job, or the job belongs to another runner now. */
  private async lostOrCancelled(job: TranslationJob, active: ActiveRun): Promise<void> {
    const row = await this.ctx.db.query.translationJobs.findFirst({ where: eq(translationJobs.id, job.id) });
    if (row && row.runner === this.instanceId && row.status === 'running' && row.cancelRequested) {
      active.cancelled = true;
    } else {
      active.lost = true;
    }
    active.abort.abort();
  }

  /** stop(): back to the queue; the next tick on this or another instance resumes from done_batches. */
  private async requeue(job: TranslationJob): Promise<void> {
    await this.ctx.db
      .update(translationJobs)
      .set({ status: 'queued', runner: null })
      .where(
        and(
          eq(translationJobs.id, job.id),
          eq(translationJobs.runner, this.instanceId),
          eq(translationJobs.status, 'running'),
        ),
      );
  }

  /** The end of a job: status, error, finished_at, runner = null, and the audit entry i18n.job_finish. */
  private async finish(
    job: TranslationJob,
    status: 'completed' | 'failed' | 'cancelled',
    error: { code: string; message: string } | null,
  ): Promise<void> {
    const [row] = await this.ctx.db
      .update(translationJobs)
      .set({ status, error, finishedAt: this.now(), runner: null })
      .where(
        and(
          eq(translationJobs.id, job.id),
          eq(translationJobs.runner, this.instanceId),
          eq(translationJobs.status, 'running'),
        ),
      )
      .returning();
    if (!row) return;
    await this.ctx.audit.record(null, {
      action: 'i18n.job_finish',
      orgId: null,
      resourceType: 'translation_job',
      resourceId: row.id,
      status: status === 'failed' ? 'failure' : 'success',
      actorUserId: row.createdBy,
      actorName: 'Translation job',
      details: {
        jobId: row.id,
        status,
        done: row.done,
        failed: row.failed,
        skipped: row.skipped,
        costMicros: row.costMicros,
        error,
      },
    });
  }
}
