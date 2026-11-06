import { inArray } from 'drizzle-orm';
import type { TranslationJobDetailDto, TranslationJobDto } from '@weblion/shared';
import type { DbOrTx } from '../../db/client';
import { users, type TranslationJob } from '../../db/schema';

/** The job rows as TranslationJobDto (i18n 14.1), with the starter's name. */
export async function jobDtos(db: DbOrTx, rows: readonly TranslationJob[]): Promise<TranslationJobDto[]> {
  const ids = [...new Set(rows.map((r) => r.createdBy).filter((id): id is string => !!id))];
  const people = ids.length
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))
    : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    scope: row.scope,
    model: row.model,
    demo: row.demo,
    total: row.total,
    done: row.done,
    failed: row.failed,
    skipped: row.skipped,
    batches: row.batches.length,
    batchesDone: row.doneBatches.length,
    inputTokens: row.inputTokens + row.cacheReadTokens + row.cacheWriteTokens,
    outputTokens: row.outputTokens,
    costMicros: row.costMicros,
    estimateMicros: row.estimateMicros,
    error: row.error,
    cancelRequested: row.cancelRequested,
    retryOf: row.retryOf,
    createdBy: row.createdBy ? (byId.get(row.createdBy) ?? null) : null,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  }));
}

export async function jobDto(db: DbOrTx, row: TranslationJob): Promise<TranslationJobDto> {
  return (await jobDtos(db, [row]))[0]!;
}

export async function jobDetailDto(db: DbOrTx, row: TranslationJob): Promise<TranslationJobDetailDto> {
  return { ...(await jobDto(db, row)), failures: row.failures };
}
