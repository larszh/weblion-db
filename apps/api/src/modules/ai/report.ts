import { and, desc, eq, inArray, notInArray, sql, type SQL } from 'drizzle-orm';
import type {
  AiBudgetDto,
  AiErrorDto,
  AiFeature,
  AiModel,
  AiUsageReportDto,
  AiUsageStatus,
  AiUsageTotalsDto,
  Paginated,
} from '@weblion/shared';
import type { Env } from '../../config/env';
import type { DbOrTx } from '../../db/client';
import { aiUsage, organizations, users } from '../../db/schema';
import type { AiSettings } from './settings';
import { budgetMicros, budgetState } from './usage';

/**
 * The staff views of the KI page (ai 5.4, 12.2): the usage report of a month (Europe/Zurich) and the errors tab.
 * Both read only metadata of ai_usage; no prompt or answer is stored anywhere.
 */

/** The current month in Europe/Zurich, YYYY-MM. */
export function currentMonth(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit' })
    .format(now)
    .slice(0, 7);
}

/** Months between two YYYY-MM values (a - b). */
export function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (ya! - yb!) * 12 + (ma! - mb!);
}

const totalsSql = {
  requests: sql<number>`count(*)::int`,
  apiCalls: sql<number>`coalesce(sum(${aiUsage.apiCalls}), 0)::int`,
  inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::bigint`,
  outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::bigint`,
  cacheReadTokens: sql<number>`coalesce(sum(${aiUsage.cacheReadTokens}), 0)::bigint`,
  cacheWriteTokens: sql<number>`coalesce(sum(${aiUsage.cacheWriteTokens}), 0)::bigint`,
  costMicros: sql<number>`coalesce(sum(${aiUsage.costMicros}), 0)::bigint`,
};

function totals(row: Record<keyof AiUsageTotalsDto, unknown>): AiUsageTotalsDto {
  return {
    requests: Number(row.requests),
    apiCalls: Number(row.apiCalls),
    inputTokens: Number(row.inputTokens),
    outputTokens: Number(row.outputTokens),
    cacheReadTokens: Number(row.cacheReadTokens),
    cacheWriteTokens: Number(row.cacheWriteTokens),
    costMicros: Number(row.costMicros),
  };
}

/** Rows created in the month (Europe/Zurich). */
function inMonth(month: string): SQL {
  return sql`${aiUsage.createdAt} >= (to_date(${month}, 'YYYY-MM')::timestamp at time zone 'Europe/Zurich')
    and ${aiUsage.createdAt} < ((to_date(${month}, 'YYYY-MM') + interval '1 month')::timestamp at time zone 'Europe/Zurich')`;
}

/** GET /admin/ai/usage: the month's totals by feature, model (served models included), customer and day. */
export async function usageReport(
  db: DbOrTx,
  env: Env,
  settings: AiSettings,
  month: string,
): Promise<AiUsageReportDto> {
  const where = inMonth(month);
  const model = sql<string>`coalesce(${aiUsage.servedModel}, ${aiUsage.model})`;
  const day = sql<string>`to_char(${aiUsage.createdAt} at time zone 'Europe/Zurich', 'YYYY-MM-DD')`;
  const [all, byFeature, byModel, byOrg, byDay] = await Promise.all([
    db.select(totalsSql).from(aiUsage).where(where),
    db
      .select({ feature: aiUsage.feature, ...totalsSql })
      .from(aiUsage)
      .where(where)
      .groupBy(aiUsage.feature)
      .orderBy(desc(totalsSql.costMicros)),
    db
      .select({ model, ...totalsSql })
      .from(aiUsage)
      .where(where)
      .groupBy(model)
      .orderBy(desc(totalsSql.costMicros)),
    db
      .select({
        orgId: aiUsage.orgId,
        orgName: organizations.name,
        staffRequests: sql<number>`count(*) filter (where ${aiUsage.scope} = 'staff')::int`,
        ...totalsSql,
      })
      .from(aiUsage)
      .leftJoin(organizations, eq(organizations.id, aiUsage.orgId))
      .where(where)
      .groupBy(aiUsage.orgId, organizations.name)
      .orderBy(desc(totalsSql.costMicros))
      .limit(50),
    db
      .select({ date: day, ...totalsSql })
      .from(aiUsage)
      .where(where)
      .groupBy(day)
      .orderBy(day),
  ]);
  const monthTotals = totals(all[0] ?? ({} as Record<keyof AiUsageTotalsDto, unknown>));
  let budget: AiBudgetDto;
  if (month === currentMonth()) budget = await budgetState(db, env, settings);
  else {
    const micros = budgetMicros(settings);
    const percent = micros > 0 ? Math.floor((monthTotals.costMicros * 100) / micros) : 100;
    budget = {
      month,
      budgetMicros: micros,
      spentMicros: monthTotals.costMicros,
      reservedMicros: 0,
      remainingMicros: Math.max(0, micros - monthTotals.costMicros),
      percent,
      warned: percent >= settings.warnPercent,
      exhausted: monthTotals.costMicros >= micros,
    };
  }
  return {
    month,
    budget,
    totals: monthTotals,
    byFeature: byFeature.map((r) => ({ feature: r.feature as AiFeature, ...totals(r) })),
    byModel: byModel.map((r) => ({ model: r.model, ...totals(r) })),
    byOrg: byOrg.map((r) => ({
      org: r.orgId ? { id: r.orgId, name: r.orgName ?? '' } : null,
      staffRequests: Number(r.staffRequests),
      ...totals(r),
    })),
    byDay: byDay.map((r) => ({ date: r.date, ...totals(r) })),
  };
}

export const ERROR_STATUSES = ['refusal', 'incomplete', 'error', 'stale'] as const;
/** Errors of the Claude API itself; everything else is the console's own (validation, timeouts, stale rows). */
const API_ERROR_CODES = ['ai_upstream', 'ai_busy'];

export interface ErrorsQuery {
  page: number;
  perPage: number;
  feature?: AiFeature;
  status?: (typeof ERROR_STATUSES)[number];
  source?: 'api' | 'internal';
}

/** GET /admin/ai/errors: failed requests, newest first, with the redacted original message (30 days). */
export async function errorsPage(db: DbOrTx, query: ErrorsQuery): Promise<Paginated<AiErrorDto>> {
  const filters: (SQL | undefined)[] = [
    inArray(aiUsage.status, query.status ? [query.status] : [...ERROR_STATUSES]),
    query.feature ? eq(aiUsage.feature, query.feature) : undefined,
    query.source === 'api' ? inArray(aiUsage.errorCode, API_ERROR_CODES) : undefined,
    query.source === 'internal'
      ? sql`(${aiUsage.errorCode} is null or ${notInArray(aiUsage.errorCode, API_ERROR_CODES)})`
      : undefined,
  ];
  const where = and(...filters);
  const [rows, count] = await Promise.all([
    db
      .select({ usage: aiUsage, orgName: organizations.name, userName: users.name })
      .from(aiUsage)
      .leftJoin(organizations, eq(organizations.id, aiUsage.orgId))
      .leftJoin(users, eq(users.id, aiUsage.userId))
      .where(where)
      .orderBy(desc(aiUsage.createdAt), desc(aiUsage.id))
      .limit(query.perPage)
      .offset((query.page - 1) * query.perPage),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(aiUsage)
      .where(where),
  ]);
  return {
    total: Number(count[0]?.n ?? 0),
    page: query.page,
    perPage: query.perPage,
    items: rows.map(({ usage, orgName, userName }) => ({
      id: usage.id,
      createdAt: usage.createdAt.toISOString(),
      feature: usage.feature,
      scope: usage.scope,
      org: usage.orgId ? { id: usage.orgId, name: orgName ?? '' } : null,
      user: usage.userId ? { id: usage.userId, name: userName ?? '' } : null,
      model: usage.model as AiModel,
      servedModel: usage.servedModel,
      status: usage.status as AiUsageStatus,
      errorCode: usage.errorCode,
      errorReason: usage.errorReason,
      errorMessage: usage.errorMessage,
      requestId: usage.requestId,
      durationMs: usage.durationMs,
    })),
  };
}

/** This month's requests on an organization's data, every scope, staff ones counted separately (ai 5.5). */
export async function orgUsage(
  db: DbOrTx,
  orgId: string,
): Promise<{ month: string; requests: number; staffRequests: number; costMicros: number }> {
  const month = currentMonth();
  const [row] = await db
    .select({
      requests: sql<number>`count(*)::int`,
      staffRequests: sql<number>`count(*) filter (where ${aiUsage.scope} = 'staff')::int`,
      costMicros: sql<number>`coalesce(sum(${aiUsage.costMicros}), 0)::bigint`,
    })
    .from(aiUsage)
    .where(and(eq(aiUsage.orgId, orgId), inMonth(month)));
  return {
    month,
    requests: Number(row?.requests ?? 0),
    staffRequests: Number(row?.staffRequests ?? 0),
    costMicros: Number(row?.costMicros ?? 0),
  };
}
