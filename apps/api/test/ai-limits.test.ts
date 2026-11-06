import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import pg from 'pg';
import { z } from 'zod';
import { AI_FEATURES } from '@weblion/shared';
import { aiUsage, auditLogs, mailLog, organizations, settings, users } from '../src/db/schema';
import { AiMaintenance } from '../src/modules/ai/maintenance';
import { AI_BUDGET_NOTICE_KEY, checkBudgetWarning } from '../src/modules/ai/usage';
import { ADMIN, Client, createTestApp, json, type TestApp } from './helpers';

/**
 * Limits of ai 7.1 through the real routes (Retry-After included), the staff and Mass Translate exceptions,
 * stale rows and the retention of AiMaintenance (ai 7.3), and the monthly budget mails (ai 7.2). Demo mode: the
 * emulator answers, every limit check runs unchanged.
 */

let t: TestApp;
let admin: Client;
let anna: Client;
let pool: pg.Pool;
let musterId: string;
let annaId: string;
let adminId: string;

const ALL_ON = Object.fromEntries(AI_FEATURES.map((f) => [f, true]));

async function configure(extra: {
  budgetUsd?: number;
  dailyOrgLimit?: number;
  dailyUserLimit?: number;
  warnPercent?: number;
}) {
  const res = await admin.request('PUT', '/admin/ai/settings', {
    enabled: true,
    model: 'claude-opus-5-5',
    features: ALL_ON,
    budgetUsd: extra.budgetUsd ?? 100,
    warnPercent: extra.warnPercent ?? 80,
    dailyOrgLimit: extra.dailyOrgLimit ?? 200,
    dailyUserLimit: extra.dailyUserLimit ?? 50,
  });
  expect(res.statusCode).toBe(200);
}

const explainBody = {
  source: {
    kind: 'error',
    error: { status: 500, code: 'provider_error', message: 'The provider failed' },
    page: { path: '/o/muster-ag/servers', title: 'Server' },
  },
  locale: 'de',
};
const explain = (client: Client = anna) => client.post(`/orgs/${musterId}/ai/explain`, explainBody);

/** Usage rows; createdAt may be a SQL expression (now() - interval ...). */
function insert(n: number, values: Record<string, unknown>) {
  return t.db.insert(aiUsage).values(
    Array.from({ length: n }, () => ({
      feature: 'explain' as const,
      scope: 'org' as const,
      model: 'claude-opus-5-5' as const,
      status: 'ok' as const,
      ...values,
    })),
  );
}

beforeAll(async () => {
  t = await createTestApp();
  pool = new pg.Pool({ connectionString: t.ctx.env.DATABASE_URL, max: 2 });
  admin = new Client(t.app);
  await admin.login(ADMIN.email, ADMIN.password);
  anna = new Client(t.app);
  await anna.login('anna@muster.example');
  musterId = (await t.db.query.organizations.findFirst({ where: eq(organizations.slug, 'muster-ag') }))!.id;
  annaId = (await t.db.query.users.findFirst({ where: eq(users.email, 'anna@muster.example') }))!.id;
  adminId = (await t.db.query.users.findFirst({ where: eq(users.email, ADMIN.email) }))!.id;
});
afterAll(async () => {
  await pool?.end();
  await t?.close();
});

beforeEach(async () => {
  await t.db.delete(aiUsage);
  await t.db.delete(settings).where(eq(settings.key, AI_BUDGET_NOTICE_KEY));
  await configure({});
});

describe('limits through the routes', () => {
  it('a request in demo mode goes through and leaves one row', async () => {
    const res = await explain();
    expect(res.statusCode).toBe(200);
    expect(json(res).meta).toMatchObject({ demo: true });
    const rows = await t.db.select().from(aiUsage);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      feature: 'explain',
      scope: 'org',
      orgId: musterId,
      userId: annaId,
      status: 'ok',
      demo: true,
    });
  });

  it('each kind answers 429 ai_limit in the order of ai 7.1, with Retry-After when the wait is known', async () => {
    // budget: no Retry-After (the reset is the first day of next month), resetsAt set.
    await configure({ budgetUsd: 1 });
    await insert(1, { scope: 'platform', costMicros: 1_000_000 });
    let res = await explain();
    expect(res.statusCode).toBe(429);
    expect(json(res).error).toMatchObject({
      code: 'ai_limit',
      details: { limit: 'budget', retryAfterSeconds: null },
    });
    expect(res.headers['retry-after']).toBeUndefined();
    await t.db.delete(aiUsage);
    await configure({});

    // concurrent: six live requests on the platform.
    await insert(6, { scope: 'platform', status: 'running', countsForUser: false, feature: 'translations' });
    res = await explain();
    expect(json(res).error.details).toMatchObject({ limit: 'concurrent', retryAfterSeconds: 5 });
    expect(res.headers['retry-after']).toBe('5');
    await t.db.delete(aiUsage);

    // org_concurrent: three live requests of the organization.
    await insert(3, { orgId: musterId, status: 'running' });
    res = await explain();
    expect(json(res).error.details).toMatchObject({ limit: 'org_concurrent' });
    expect(res.headers['retry-after']).toBe('5');
    await t.db.delete(aiUsage);

    // org_daily, until midnight in Zurich.
    await configure({ dailyOrgLimit: 2 });
    await insert(2, { orgId: musterId });
    res = await explain();
    expect(json(res).error.details).toMatchObject({ limit: 'org_daily' });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(res.headers['retry-after'])).toBeLessThanOrEqual(86_400 + 3_600);
    await t.db.delete(aiUsage);
    await configure({});

    // user_concurrent, user_rate, user_daily.
    await insert(2, { scope: 'platform', userId: annaId, status: 'running' });
    res = await explain();
    expect(json(res).error.details).toMatchObject({ limit: 'user_concurrent', retryAfterSeconds: 5 });
    await t.db.delete(aiUsage);
    await insert(12, { scope: 'platform', userId: annaId });
    res = await explain();
    expect(json(res).error.details).toMatchObject({ limit: 'user_rate' });
    const wait = Number(res.headers['retry-after']);
    expect(wait).toBeGreaterThanOrEqual(1);
    expect(wait).toBeLessThanOrEqual(60);
    await t.db.delete(aiUsage);
    await configure({ dailyUserLimit: 3 });
    await insert(3, { scope: 'platform', userId: annaId, createdAt: sql`now() - interval '2 minutes'` });
    res = await explain();
    expect(json(res).error.details).toMatchObject({ limit: 'user_daily' });
    expect(json(res).error.details.resetsAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("staff requests count for the staff member, not against the customer's organization limits", async () => {
    await configure({ dailyOrgLimit: 1 });
    await insert(5, { orgId: musterId, scope: 'staff', userId: adminId });
    // The customer's own quota is untouched by staff work.
    expect((await explain()).statusCode).toBe(200);
    // Now the organization used its one request: the member is refused, staff is not.
    expect(json(await explain()).error.details.limit).toBe('org_daily');
    const staff = await explain(admin);
    expect(staff.statusCode).toBe(200);
    const [row] = await t.db
      .select()
      .from(aiUsage)
      .where(and(eq(aiUsage.userId, adminId), eq(aiUsage.status, 'ok'), eq(aiUsage.demo, true)));
    expect(row).toMatchObject({ scope: 'staff', orgId: musterId });
  });

  it('Mass Translate batches (countsForUser: false) skip the person and organization limits, not the budget', async () => {
    const batch = () =>
      t.ctx.ai.structured({
        feature: 'translations',
        scope: 'platform',
        orgId: null,
        countsForUser: false,
        retryOnMaxTokens: false,
        actor: { userId: adminId },
        system: '# Feature: translations\n\nTranslate.',
        user: JSON.stringify({ locale: 'fr', items: [{ id: 'a', de: 'Speichern' }] }),
        schema: z.object({ items: z.array(z.object({ id: z.string(), text: z.string() })) }),
      });
    await insert(12, { scope: 'platform', userId: adminId });
    await insert(3, { orgId: musterId, status: 'running', userId: adminId });
    const result = await batch();
    expect(result.data.items).toEqual([{ id: 'a', text: '[FR] Speichern' }]);
    expect(result.costMicros).toBe(0);
    await configure({ budgetUsd: 1 });
    await insert(1, { scope: 'platform', costMicros: 1_000_000 });
    await expect(batch()).rejects.toMatchObject({ code: 'ai_limit', details: { limit: 'budget' } });
  });
});

describe('AiMaintenance (ai 7.3)', () => {
  it('marks stale running rows, which no check counts before either', async () => {
    const stale = t.ctx.env.AI_TURN_TIMEOUT_SECONDS + 61;
    await insert(3, {
      orgId: musterId,
      userId: annaId,
      status: 'running',
      reservedMicros: 50_000,
      createdAt: sql`now() - make_interval(secs => ${stale}::int)`,
    });
    // Stale rows are ignored by every check even before maintenance ran (plan O29).
    expect((await explain()).statusCode).toBe(200);
    expect(await t.ctx.ai.budgetState()).toMatchObject({ reservedMicros: 0 });
    const result = await new AiMaintenance(t.ctx, pool).run();
    expect(result).toMatchObject({ stale: 3 });
    const rows = await t.db.select().from(aiUsage).where(eq(aiUsage.status, 'stale'));
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.reservedMicros).toBe(0);
      expect(row.finishedAt).not.toBeNull();
    }
    // A fresh running row stays.
    await insert(1, { status: 'running' });
    expect(await new AiMaintenance(t.ctx, pool).run()).toMatchObject({ stale: 0 });
  });

  it('deletes rows older than 400 days and clears error texts older than 30 days', async () => {
    await insert(1, { createdAt: sql`now() - interval '401 days'`, errorMessage: 'old' });
    await insert(1, {
      createdAt: sql`now() - interval '31 days'`,
      status: 'error',
      errorMessage: 'gone soon',
    });
    await insert(1, { createdAt: sql`now() - interval '29 days'`, status: 'error', errorMessage: 'kept' });
    const result = await new AiMaintenance(t.ctx, pool).run();
    expect(result).toMatchObject({ deleted: 1, errorTextsCleared: 1 });
    const rows = await t.db.select().from(aiUsage).orderBy(aiUsage.createdAt);
    expect(rows.map((r) => r.errorMessage)).toEqual([null, 'kept']);
  });

  it('skips the run while another process holds the lock', async () => {
    const client = await pool.connect();
    try {
      await client.query('select pg_advisory_lock(742005)');
      const other = new pg.Pool({ connectionString: t.ctx.env.DATABASE_URL, max: 1 });
      try {
        expect(await new AiMaintenance(t.ctx, other).run()).toBeNull();
      } finally {
        await other.end();
      }
    } finally {
      await client.query('select pg_advisory_unlock(742005)');
      client.release();
    }
  });
});

describe('budget warning and exhaustion (ai 7.2)', () => {
  const budgetMails = () =>
    t.db.select().from(mailLog).where(eq(mailLog.template, 'ai_budget')).orderBy(mailLog.createdAt);
  const budgetAudits = () =>
    t.db
      .select()
      .from(auditLogs)
      .where(sql`${auditLogs.action} in ('ai.budget_warning', 'ai.budget_exhausted')`)
      .orderBy(auditLogs.id);

  beforeEach(async () => {
    await t.db.delete(mailLog);
    await t.db.delete(auditLogs);
  });

  it('warns once per month at the warning mark, then once at exhaustion, to every superadmin in their language', async () => {
    const [english] = await t.db
      .insert(users)
      .values({ email: 'owner-en@test.local', name: 'Owner', platformRole: 'superadmin', locale: 'en' })
      .onConflictDoNothing()
      .returning();
    await t.db
      .insert(users)
      .values({ email: 'gone@test.local', name: 'Gone', platformRole: 'superadmin', status: 'disabled' })
      .onConflictDoNothing();
    try {
      await configure({ budgetUsd: 1, warnPercent: 80 });
      await insert(1, { scope: 'platform', costMicros: 500_000 });
      await checkBudgetWarning(t.ctx);
      expect(await budgetMails()).toHaveLength(0);

      await insert(1, { scope: 'platform', costMicros: 320_000 });
      await checkBudgetWarning(t.ctx);
      await checkBudgetWarning(t.ctx);
      let mails = await budgetMails();
      // One mail per language: German to admin@test.local, English to the second superadmin; nobody disabled.
      expect(mails.map((m) => m.to).sort()).toEqual([ADMIN.email, 'owner-en@test.local'].sort());
      expect(mails.find((m) => m.to === ADMIN.email)!.subject).toBe('KI-Budget zu 82 % verbraucht');
      expect(mails.find((m) => m.to === 'owner-en@test.local')!.subject).toBe('AI budget 82 % used');
      let entries = await budgetAudits();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        action: 'ai.budget_warning',
        orgId: null,
        resourceType: 'settings',
        resourceId: 'ai_budget_notice',
        actorName: 'AI budget',
        actorUserId: null,
        ip: null,
      });
      expect(entries[0]!.details).toMatchObject({
        percent: 82,
        spentMicros: 820_000,
        budgetMicros: 1_000_000,
      });

      // Raising the budget in the same month sends no second warning.
      await configure({ budgetUsd: 2, warnPercent: 80 });
      await insert(1, { scope: 'platform', costMicros: 900_000 });
      await checkBudgetWarning(t.ctx);
      expect(await budgetMails()).toHaveLength(2);

      await configure({ budgetUsd: 1, warnPercent: 80 });
      await checkBudgetWarning(t.ctx);
      await checkBudgetWarning(t.ctx);
      mails = await budgetMails();
      expect(mails).toHaveLength(4);
      expect(mails.filter((m) => m.subject === 'KI-Budget aufgebraucht')).toHaveLength(1);
      entries = await budgetAudits();
      expect(entries.map((e) => e.action)).toEqual(['ai.budget_warning', 'ai.budget_exhausted']);
      expect(entries[1]!.details).toMatchObject({ spentMicros: 1_720_000, budgetMicros: 1_000_000 });
      expect(entries[1]!.details).not.toHaveProperty('percent');
    } finally {
      if (english) await t.db.delete(users).where(eq(users.id, english.id));
      await t.db.delete(users).where(eq(users.email, 'gone@test.local'));
    }
  });

  it('a jump from below the warning straight to 100 percent sends both at once', async () => {
    await configure({ budgetUsd: 1 });
    await insert(1, { scope: 'platform', costMicros: 1_200_000 });
    await checkBudgetWarning(t.ctx);
    expect((await budgetMails()).map((m) => m.subject)).toEqual([
      'KI-Budget zu 120 % verbraucht',
      'KI-Budget aufgebraucht',
    ]);
    expect((await budgetAudits()).map((e) => e.action)).toEqual(['ai.budget_warning', 'ai.budget_exhausted']);
  });

  it('a row of an earlier month counts as empty; a request that costs something triggers the check', async () => {
    await t.db.insert(settings).values({
      key: AI_BUDGET_NOTICE_KEY,
      value: { month: '2001-01', warnedAt: '2001-01-02T00:00:00Z', exhaustedAt: '2001-01-03T00:00:00Z' },
    });
    await configure({ budgetUsd: 1 });
    await insert(1, { scope: 'platform', costMicros: 900_000 });
    await checkBudgetWarning(t.ctx);
    expect((await budgetAudits()).map((e) => e.action)).toEqual(['ai.budget_warning']);
    const [row] = await t.db.select().from(settings).where(eq(settings.key, AI_BUDGET_NOTICE_KEY));
    expect(row!.value).toMatchObject({ month: expect.stringMatching(/^\d{4}-\d{2}$/), exhaustedAt: null });
  });
});
