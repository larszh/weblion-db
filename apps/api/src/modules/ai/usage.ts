import { and, eq, sql } from 'drizzle-orm';
import type { BetaMessage, BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages';
import Anthropic from '@anthropic-ai/sdk';
import {
  aiCostMicros,
  intlLocale,
  normalizeLocale,
  type AiBudgetDto,
  type AiFeature,
  type AiModel,
  type AiUsageScope,
  type AiUsageTokens,
  type Locale,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import type { Env } from '../../config/env';
import type { Database, DbOrTx } from '../../db/client';
import { aiUsage, settings as settingsTable, users, type AiUsageRow } from '../../db/schema';
import type { AppError } from '../../lib/errors';
import { AI_FEATURE_EXPECTED_OUTPUT } from './client';
import { aiLimit } from './errors';
import { redactText } from './redact';
import type { AiFinishStatus } from './service';
import type { AiSettings } from './settings';

/**
 * Reservations, limits and accounting of AI requests (ai 6.7, 7.1). One ai_usage row per request (a chat turn,
 * a feature call, a translation batch, plan O22). Every limit is checked against the table, so it holds across
 * API processes; reserve() runs its checks and the insert under one transaction lock (plan 3.3).
 */

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ReserveInput {
  feature: AiFeature;
  scope: AiUsageScope;
  orgId: string | null;
  userId: string | null;
  countsForUser: boolean;
  model: AiModel;
  demo: boolean;
  estimateMicros: number;
}

export const AI_LIMITS = {
  userPerMinute: 12,
  userConcurrent: 2,
  orgConcurrent: 3,
  platformConcurrent: 6,
  orgLiveReadsPerMinute: 30,
} as const;

/** Transaction lock of reserve() (plan 3.3). */
export const AI_RESERVE_LOCK = 'ai:reserve';
/** The concurrency kinds carry this retry hint (ai 4.2). */
const CONCURRENCY_RETRY_SECONDS = 5;

/** Deliberately high for German text and JSON; no count_tokens call, which would add latency (ai 6.7). */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/** One call with uncached input and the typical output of the feature (ai 6.7). */
export function estimateCallMicros(model: AiModel, feature: AiFeature, inputTokens: number): number {
  return aiCostMicros(
    model,
    { input_tokens: inputTokens, output_tokens: AI_FEATURE_EXPECTED_OUTPUT[feature] },
    model,
  );
}

/**
 * A running row older than this is stale: ignored by every check and marked by maintenance (plan O29). The
 * longest a request can run plus a minute, so a crash or deploy locks nobody out for long.
 */
export function staleAfterSeconds(env: Env): number {
  return env.AI_TURN_TIMEOUT_SECONDS + 60;
}

/** Settings row of the monthly budget mails (plan 3.2) and the transaction lock around it (plan 3.3). */
export const AI_BUDGET_NOTICE_KEY = 'ai_budget_notice';
export const AI_BUDGET_NOTICE_LOCK = 'ai:budget-notice';

interface BudgetNotice {
  month: string;
  warnedAt: string | null;
  exhaustedAt: string | null;
}

/** USD with the code, in the mail language ("USD 81.20", "81,20 USD"). */
function usd(micros: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'code',
    minimumFractionDigits: 2,
  }).format(micros / 1_000_000);
}

/** "November 2026" for 2026-11, in the mail language. */
function monthName(month: string, locale: Locale): string {
  const [year, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat(intlLocale(locale), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year!, (m ?? 1) - 1, 15)));
}

/**
 * Monthly budget warning and exhaustion (ai 7.2), after every finish() that added cost. Under a transaction lock
 * the marks of this month in the settings row ai_budget_notice are set at most once each (a row of an earlier
 * month counts as empty); for each newly set mark one mail per language goes to the active superadmins and one
 * audit entry is written. A jump from below the warning straight to 100 percent sets both. Logs, never throws.
 */
export async function checkBudgetWarning(ctx: AppContext): Promise<void> {
  try {
    const settings = await ctx.ai.settings();
    const state = await budgetState(ctx.db, ctx.env, settings);
    // A budget of 0 refuses every request on purpose; it is no reason to mail.
    if (state.budgetMicros <= 0 || state.percent < settings.warnPercent) return;
    const marks = await ctx.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${AI_BUDGET_NOTICE_LOCK}, 0))`);
      const [row] = await tx.select().from(settingsTable).where(eq(settingsTable.key, AI_BUDGET_NOTICE_KEY));
      const stored = row?.value as Partial<BudgetNotice> | undefined;
      const current: BudgetNotice =
        stored && stored.month === state.month
          ? { month: state.month, warnedAt: stored.warnedAt ?? null, exhaustedAt: stored.exhaustedAt ?? null }
          : { month: state.month, warnedAt: null, exhaustedAt: null };
      const now = new Date().toISOString();
      const warning = state.percent >= settings.warnPercent && !current.warnedAt;
      const exhausted = state.exhausted && !current.exhaustedAt;
      if (!warning && !exhausted) return { warning, exhausted };
      const value: BudgetNotice = {
        month: state.month,
        warnedAt: warning ? now : current.warnedAt,
        exhaustedAt: exhausted ? now : current.exhaustedAt,
      };
      await tx
        .insert(settingsTable)
        .values({ key: AI_BUDGET_NOTICE_KEY, value })
        .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
      return { warning, exhausted };
    });
    if (!marks.warning && !marks.exhausted) return;
    const recipients = await ctx.db
      .select({ email: users.email, locale: users.locale })
      .from(users)
      .where(and(eq(users.platformRole, 'superadmin'), eq(users.status, 'active')));
    const byLocale = new Map<Locale, string[]>();
    for (const r of recipients) {
      const locale = normalizeLocale(r.locale) ?? 'de';
      byLocale.set(locale, [...(byLocale.get(locale) ?? []), r.email]);
    }
    const link = `${ctx.env.APP_URL.replace(/\/$/, '')}/admin/ai`;
    const kinds = [
      ...(marks.warning ? (['warning'] as const) : []),
      ...(marks.exhausted ? (['exhausted'] as const) : []),
    ];
    for (const kind of kinds) {
      for (const [locale, to] of byLocale) {
        await ctx.mail.send(
          'ai_budget',
          {
            kind,
            month: monthName(state.month, locale),
            spent: usd(state.spentMicros, locale),
            budget: usd(state.budgetMicros, locale),
            percent: state.percent,
            link,
          },
          { to, locale },
        );
      }
      await ctx.audit.record(null, {
        action: kind === 'warning' ? 'ai.budget_warning' : 'ai.budget_exhausted',
        orgId: null,
        resourceType: 'settings',
        resourceId: AI_BUDGET_NOTICE_KEY,
        actorUserId: null,
        actorName: 'AI budget',
        details:
          kind === 'warning'
            ? {
                month: state.month,
                percent: state.percent,
                spentMicros: state.spentMicros,
                budgetMicros: state.budgetMicros,
              }
            : { month: state.month, spentMicros: state.spentMicros, budgetMicros: state.budgetMicros },
      });
    }
  } catch (err) {
    ctx.log.error({ err }, 'AI budget warning failed');
  }
}

interface Counters {
  month: string;
  nextMonth: Date;
  nextDay: Date;
  spent: number;
  reserved: number;
  platformLive: number;
  orgLive: number;
  orgToday: number;
  userLive: number;
  userMinute: number;
  userToday: number;
  /** Seconds until the oldest of the person's requests of the last minute leaves the window. */
  userRateRetry: number | null;
}

type CounterRow = Record<keyof Counters, string | number | Date | null>;

/**
 * Every number the limits need in one query. Months and days are those of Europe/Zurich; the database clock
 * decides, so all processes agree.
 */
async function counters(
  db: DbOrTx,
  scope: { orgId: string | null; userId: string | null },
  staleSeconds: number,
): Promise<Counters> {
  const org = scope.orgId;
  const user = scope.userId;
  const live = sql`u.status = 'running' and u.created_at > b.now - make_interval(secs => ${staleSeconds}::int)`;
  const { rows } = await db.execute<CounterRow>(sql`
    with b as (
      select now() as now,
        date_trunc('month', now() at time zone 'Europe/Zurich') at time zone 'Europe/Zurich' as month_start,
        (date_trunc('month', now() at time zone 'Europe/Zurich') + interval '1 month') at time zone 'Europe/Zurich' as next_month,
        date_trunc('day', now() at time zone 'Europe/Zurich') at time zone 'Europe/Zurich' as day_start,
        (date_trunc('day', now() at time zone 'Europe/Zurich') + interval '1 day') at time zone 'Europe/Zurich' as next_day,
        to_char(now() at time zone 'Europe/Zurich', 'YYYY-MM') as month
    ),
    minute as (
      select u.created_at from ai_usage u, b
      where ${user}::uuid is not null and u.user_id = ${user}::uuid and u.counts_for_user
        and u.created_at > b.now - interval '60 seconds'
      order by u.created_at desc offset ${AI_LIMITS.userPerMinute - 1}::int limit 1
    )
    select
      b.month as "month",
      b.next_month as "nextMonth",
      b.next_day as "nextDay",
      coalesce(sum(u.cost_micros) filter (where u.created_at >= b.month_start), 0) as "spent",
      coalesce(sum(u.reserved_micros) filter (where ${live}), 0) as "reserved",
      count(u.id) filter (where ${live}) as "platformLive",
      count(u.id) filter (where ${live} and u.org_id = ${org}::uuid and u.scope = 'org') as "orgLive",
      count(u.id) filter (where u.created_at >= b.day_start and u.org_id = ${org}::uuid and u.scope = 'org')
        as "orgToday",
      count(u.id) filter (where ${live} and u.user_id = ${user}::uuid and u.counts_for_user) as "userLive",
      count(u.id) filter (where u.created_at > b.now - interval '60 seconds' and u.user_id = ${user}::uuid
        and u.counts_for_user) as "userMinute",
      count(u.id) filter (where u.created_at >= b.day_start and u.user_id = ${user}::uuid and u.counts_for_user)
        as "userToday",
      (select ceil(extract(epoch from (m.created_at + interval '60 seconds' - b.now))) from minute m)
        as "userRateRetry"
    from b
    left join ai_usage u on u.created_at >= least(b.month_start, b.now - make_interval(secs => ${staleSeconds}::int))
    group by b.now, b.month, b.next_month, b.next_day
  `);
  const row = rows[0]!;
  const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
  return {
    month: String(row.month),
    nextMonth: new Date(row.nextMonth as Date | string),
    nextDay: new Date(row.nextDay as Date | string),
    spent: num(row.spent),
    reserved: num(row.reserved),
    platformLive: num(row.platformLive),
    orgLive: num(row.orgLive),
    orgToday: num(row.orgToday),
    userLive: num(row.userLive),
    userMinute: num(row.userMinute),
    userToday: num(row.userToday),
    userRateRetry: row.userRateRetry === null ? null : Math.max(1, num(row.userRateRetry)),
  };
}

const secondsUntil = (date: Date) => Math.max(1, Math.ceil((date.getTime() - Date.now()) / 1000));

/** Checks 5 to 7 of ai 7.1: the person's concurrency, rate and daily limit. */
function checkPerson(c: Counters, settings: AiSettings): void {
  if (c.userLive >= AI_LIMITS.userConcurrent) {
    throw aiLimit('user_concurrent', { retryAfterSeconds: CONCURRENCY_RETRY_SECONDS });
  }
  if (c.userMinute >= AI_LIMITS.userPerMinute) {
    throw aiLimit('user_rate', { retryAfterSeconds: c.userRateRetry ?? 60 });
  }
  if (c.userToday >= settings.dailyUserLimit) {
    throw aiLimit('user_daily', {
      retryAfterSeconds: secondsUntil(c.nextDay),
      resetsAt: c.nextDay.toISOString(),
    });
  }
}

export function budgetMicros(settings: AiSettings): number {
  return Math.round(settings.budgetUsd * 1_000_000);
}

/**
 * Writes the running row after checks 1 to 7 of ai 7.1, in this order, each a 429 ai_limit: budget (every
 * request; a budget of 0 refuses all), platform concurrency (every request), organization concurrency and
 * daily limit (scope 'org' only, so staff work never uses up a customer's quota), the person's concurrency,
 * rate and daily limit (countsForUser only; Mass Translate batches skip them, plan O9).
 */
export async function reserve(
  db: Database,
  env: Env,
  settings: AiSettings,
  input: ReserveInput,
): Promise<AiUsageRow> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${AI_RESERVE_LOCK}, 0))`);
    const person = input.countsForUser ? input.userId : null;
    const c = await counters(
      tx,
      { orgId: input.scope === 'org' ? input.orgId : null, userId: person },
      staleAfterSeconds(env),
    );
    const budget = budgetMicros(settings);
    if (budget <= 0 || c.spent + c.reserved + input.estimateMicros > budget) {
      throw aiLimit('budget', { resetsAt: c.nextMonth.toISOString() });
    }
    if (c.platformLive >= AI_LIMITS.platformConcurrent) {
      throw aiLimit('concurrent', { retryAfterSeconds: CONCURRENCY_RETRY_SECONDS });
    }
    if (input.scope === 'org' && input.orgId) {
      if (c.orgLive >= AI_LIMITS.orgConcurrent) {
        throw aiLimit('org_concurrent', { retryAfterSeconds: CONCURRENCY_RETRY_SECONDS });
      }
      if (c.orgToday >= settings.dailyOrgLimit) {
        throw aiLimit('org_daily', {
          retryAfterSeconds: secondsUntil(c.nextDay),
          resetsAt: c.nextDay.toISOString(),
        });
      }
    }
    if (person) checkPerson(c, settings);
    const [row] = await tx
      .insert(aiUsage)
      .values({
        feature: input.feature,
        scope: input.scope,
        orgId: input.orgId,
        userId: input.userId,
        countsForUser: input.countsForUser,
        model: input.model,
        demo: input.demo,
        status: 'running',
        reservedMicros: Math.max(0, Math.round(input.estimateMicros)),
      })
      .returning();
    return row!;
  });
}

/**
 * Up-front check for a request that makes several structured() calls (i18n B1): the person's rate,
 * concurrency and daily limit, no row written (plan 2.4).
 */
export async function countRate(
  db: Database,
  env: Env,
  settings: AiSettings,
  actor: { userId: string },
): Promise<void> {
  const c = await counters(db, { orgId: null, userId: actor.userId }, staleAfterSeconds(env));
  checkPerson(c, settings);
}

/** Before every further call of the same request: reserved_micros = the next call's estimate. */
export async function refreshReservation(db: DbOrTx, row: AiUsageRow, estimateMicros: number): Promise<void> {
  const reserved = Math.max(0, Math.round(estimateMicros));
  await db.update(aiUsage).set({ reservedMicros: reserved }).where(eq(aiUsage.id, row.id));
  row.reservedMicros = reserved;
}

/** The usage of a message in the shape of the shared price function (iterations kept, ai 6.7). */
export function usageTokens(usage: BetaUsage): AiUsageTokens {
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_read_input_tokens: usage.cache_read_input_tokens,
    cache_creation_input_tokens: usage.cache_creation_input_tokens,
    iterations: usage.iterations
      ? usage.iterations.map((it) => ({
          type: it.type,
          model: 'model' in it ? (it.model as string | null) : null,
          input_tokens: 'input_tokens' in it ? Number(it.input_tokens) || 0 : 0,
          output_tokens: 'output_tokens' in it ? Number(it.output_tokens) || 0 : 0,
          cache_read_input_tokens:
            'cache_read_input_tokens' in it ? Number(it.cache_read_input_tokens) || 0 : 0,
          cache_creation_input_tokens:
            'cache_creation_input_tokens' in it ? Number(it.cache_creation_input_tokens) || 0 : 0,
        }))
      : null,
  };
}

/**
 * Token counts of one call. With usage.iterations the entries of type 'message' and 'fallback_message' are the
 * per-attempt truth (the top-level counts cover only the attempt that produced the message), else the
 * top-level counts. Attempts declined before any output are counted too (conservative).
 */
export function callTotals(usage: AiUsageTokens): UsageTotals {
  const entries =
    usage.iterations && usage.iterations.length > 0
      ? usage.iterations.filter((it) => it.type === 'message' || it.type === 'fallback_message')
      : [usage];
  const total: UsageTotals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  for (const e of entries) {
    total.inputTokens += e.input_tokens ?? 0;
    total.outputTokens += e.output_tokens ?? 0;
    total.cacheReadTokens += e.cache_read_input_tokens ?? 0;
    total.cacheWriteTokens += e.cache_creation_input_tokens ?? 0;
  }
  return total;
}

/** The totals of a row. */
export function rowTotals(row: AiUsageRow): UsageTotals {
  return {
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
  };
}

/**
 * After every call: tokens, cost (every iteration priced on its own; demo rows cost 0), api_calls + 1, the
 * served model when another one answered, the request id. Updates the database and the passed object.
 */
export async function addCall(
  db: DbOrTx,
  row: AiUsageRow,
  message: BetaMessage,
  call: { requestId: string | null },
): Promise<void> {
  const usage = usageTokens(message.usage);
  const totals = callTotals(usage);
  const cost = row.demo ? 0 : aiCostMicros(row.model, usage, row.model);
  const served = message.model && message.model !== row.model ? message.model : row.servedModel;
  const [updated] = await db
    .update(aiUsage)
    .set({
      apiCalls: sql`${aiUsage.apiCalls} + 1`,
      inputTokens: sql`${aiUsage.inputTokens} + ${totals.inputTokens}`,
      outputTokens: sql`${aiUsage.outputTokens} + ${totals.outputTokens}`,
      cacheReadTokens: sql`${aiUsage.cacheReadTokens} + ${totals.cacheReadTokens}`,
      cacheWriteTokens: sql`${aiUsage.cacheWriteTokens} + ${totals.cacheWriteTokens}`,
      costMicros: sql`${aiUsage.costMicros} + ${cost}`,
      servedModel: served,
      requestId: call.requestId ?? row.requestId,
    })
    .where(eq(aiUsage.id, row.id))
    .returning();
  if (updated) Object.assign(row, updated);
}

const MAX_ERROR_MESSAGE = 1_000;

/** The provider's own message of a failure: the API's error.message when there is one, else the error text. */
function originalMessage(original: unknown): string | null {
  if (original instanceof Anthropic.APIError) {
    const body = original.error as { error?: { message?: unknown } } | undefined;
    const inner = body?.error?.message;
    return typeof inner === 'string' && inner ? inner : original.message;
  }
  if (original instanceof Error) return original.message;
  return typeof original === 'string' ? original : null;
}

/** The reason stored next to the code: details.reason, .limit or .category of the AppError. */
function errorReason(error: AppError): string | null {
  const d = (error.details ?? {}) as { reason?: unknown; limit?: unknown; category?: unknown };
  const reason = d.reason ?? d.limit ?? d.category ?? null;
  return typeof reason === 'string' ? reason : null;
}

/**
 * Ends the row: status, finished_at, duration_ms, reserved_micros = 0; on failure error_code, error_reason, the
 * request id of the failed call and the redacted original message (at most 1,000 characters, for the staff
 * errors tab only). Never throws.
 */
export async function finish(
  db: DbOrTx,
  log: AppContext['log'],
  row: AiUsageRow,
  status: AiFinishStatus,
  failure?: { error: AppError; original?: unknown },
): Promise<void> {
  try {
    const message = failure?.original === undefined ? null : originalMessage(failure.original);
    const requestId =
      failure?.original instanceof Anthropic.APIError && failure.original.requestID
        ? failure.original.requestID
        : row.requestId;
    const [updated] = await db
      .update(aiUsage)
      .set({
        status,
        finishedAt: sql`now()`,
        durationMs: sql`greatest(0, (extract(epoch from (now() - ${aiUsage.createdAt})) * 1000)::integer)`,
        reservedMicros: 0,
        errorCode: failure?.error.code ?? null,
        errorReason: failure ? errorReason(failure.error) : null,
        errorMessage: message ? redactText(message).slice(0, MAX_ERROR_MESSAGE) : null,
        requestId,
      })
      .where(eq(aiUsage.id, row.id))
      .returning();
    if (updated) Object.assign(row, updated);
  } catch (err) {
    log.error({ err, usageId: row.id }, 'failed to finish ai_usage row');
  }
}

/** The current month (Europe/Zurich): budget, spent, reserved by live rows, remaining (ai 7.1). */
export async function budgetState(db: DbOrTx, env: Env, settings: AiSettings): Promise<AiBudgetDto> {
  const c = await counters(db, { orgId: null, userId: null }, staleAfterSeconds(env));
  const budget = budgetMicros(settings);
  const percent = budget > 0 ? Math.floor((c.spent * 100) / budget) : 100;
  return {
    month: c.month,
    budgetMicros: budget,
    spentMicros: c.spent,
    reservedMicros: c.reserved,
    remainingMicros: Math.max(0, budget - c.spent - c.reserved),
    percent,
    warned: percent >= settings.warnPercent,
    exhausted: c.spent >= budget,
  };
}

/** spent >= budget this month; the chat checks it after every API call (plan O29). */
export async function budgetExceeded(db: DbOrTx, env: Env, settings: AiSettings): Promise<boolean> {
  return (await budgetState(db, env, settings)).exhausted;
}

/**
 * A chat call whose answer could not be read (an unparseable tool input, ai 6.4 step 4): its real usage is
 * unknown, so it is charged as its estimate, and it counts as an API call.
 */
export async function chargeEstimate(db: DbOrTx, row: AiUsageRow, micros: number): Promise<void> {
  const cost = row.demo ? 0 : Math.max(0, Math.round(micros));
  const [updated] = await db
    .update(aiUsage)
    .set({ apiCalls: sql`${aiUsage.apiCalls} + 1`, costMicros: sql`${aiUsage.costMicros} + ${cost}` })
    .where(eq(aiUsage.id, row.id))
    .returning();
  if (updated) Object.assign(row, updated);
}

/** The tool calls of a chat turn, live ones separately (ai_usage.tool_calls, live_calls). */
export async function setToolCounts(
  db: DbOrTx,
  row: AiUsageRow,
  toolCalls: number,
  liveCalls: number,
): Promise<void> {
  if (toolCalls === 0 && liveCalls === 0) return;
  await db.update(aiUsage).set({ toolCalls, liveCalls }).where(eq(aiUsage.id, row.id));
  row.toolCalls = toolCalls;
  row.liveCalls = liveCalls;
}
