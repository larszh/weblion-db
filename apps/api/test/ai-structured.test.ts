import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AI_FEATURE_EFFORT, AI_FEATURES, AI_MODELS, type AiFeature, type AiModel } from '@weblion/shared';
import type { AppContext } from '../src/context';
import { aiUsage, organizations, users } from '../src/db/schema';
import { AppError } from '../src/lib/errors';
import { AI_FEATURE_MAX_TOKENS } from '../src/modules/ai/client';
import { AI_ERROR_MESSAGES, AiCancelled, usageOfError } from '../src/modules/ai/errors';
import { SYSTEM_TEXT } from '../src/modules/ai/prompts';
import { toStrictJsonSchema } from '../src/modules/ai/schema';
import { AiService, type StructuredInput } from '../src/modules/ai/service';
import { MOCK_API_KEY, startClaudeMock, type MockTurn } from './claude-mock';
import { ADMIN, Client, configureAi, createTestApp, json, type TestApp } from './helpers';

/** The one Claude call path of the JSON features and translations (plan 2.4, F20, ai 6.6, 15.2). */

let t: TestApp;
let mock: Awaited<ReturnType<typeof startClaudeMock>>;
let admin: Client;
let musterId: string;
let annaId: string;
let adminId: string;

const ALL_ON = Object.fromEntries(AI_FEATURES.map((f) => [f, true])) as Record<AiFeature, boolean>;
const GO_LIVE = { contracts: true, transferBasis: true, noticeChecked: true, workspaceChecked: true };

const Explain = z.object({ summary: z.string(), severity: z.enum(['info', 'warning', 'error']) });
const ANSWER = { summary: 'The certificate of the website expired yesterday evening.', severity: 'warning' };
const TranslationBatchOutput = z.object({ items: z.array(z.object({ id: z.string(), text: z.string() })) });
const USER_TURN = '<context>\nrole: owner\naccess: member\nlanguage: en\n</context>\n\nExplain this error.';

async function configure(extra: {
  model?: AiModel;
  enabled?: boolean;
  features?: Record<AiFeature, boolean>;
}) {
  const res = await admin.request('PUT', '/admin/ai/settings', {
    enabled: extra.enabled ?? true,
    model: extra.model ?? 'claude-opus-5-5',
    features: extra.features ?? ALL_ON,
    budgetUsd: 100,
    warnPercent: 80,
    dailyOrgLimit: 200,
    dailyUserLimit: 50,
    goLive: GO_LIVE,
  });
  expect(res.statusCode).toBe(200);
}

function explain(extra: Partial<StructuredInput<z.infer<typeof Explain>>> = {}) {
  return t.ctx.ai.structured({
    feature: 'explain',
    scope: 'org',
    orgId: musterId,
    countsForUser: true,
    actor: { userId: annaId },
    system: SYSTEM_TEXT.explain,
    user: USER_TURN,
    schema: Explain,
    ...extra,
  });
}

/** Runs the call and returns what it threw. */
async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return err as AppError;
  }
  throw new Error('expected the call to fail');
}

const script = (...turns: MockTurn[]) =>
  mock.setScript((_body, index) => turns[Math.min(index, turns.length - 1)]);
const lastRow = async () =>
  (
    await t.db
      .select()
      .from(aiUsage)
      .orderBy(sql`${aiUsage.createdAt} desc`)
      .limit(1)
  )[0]!;

beforeAll(async () => {
  mock = await startClaudeMock();
  t = await createTestApp({ env: { ANTHROPIC_BASE_URL: mock.url } });
  admin = new Client(t.app);
  await admin.login(ADMIN.email, ADMIN.password);
  musterId = (await t.db.query.organizations.findFirst({ where: eq(organizations.slug, 'muster-ag') }))!.id;
  annaId = (await t.db.query.users.findFirst({ where: eq(users.email, 'anna@muster.example') }))!.id;
  adminId = (await t.db.query.users.findFirst({ where: eq(users.email, ADMIN.email) }))!.id;
  await configureAi(admin);
});

afterAll(async () => {
  await t?.close();
  await mock?.close();
});

beforeEach(async () => {
  // Every test starts without usage, so no limit of an earlier test applies.
  await t.db.delete(aiUsage);
  mock.requests.length = 0;
  mock.setScript(() => ({ json: ANSWER }));
});

describe('request shape', () => {
  for (const model of AI_MODELS) {
    it(`${model}: exact model, adaptive thinking, effort, format, cached system, streamed, no sampling`, async () => {
      await configure({ model });
      const result = await explain();
      expect(result.data).toEqual(ANSWER);
      expect(result.meta).toEqual({ model, servedModel: model, demo: false });

      expect(mock.requests).toHaveLength(1);
      const { body, headers, path } = mock.requests[0]!;
      expect(path).toBe('/v1/messages');
      expect(headers['anthropic-version']).toBe('2026-10-21');
      expect(body.model).toBe(model);
      expect(body.stream).toBe(true);
      expect(body.max_tokens).toBe(AI_FEATURE_MAX_TOKENS.explain);
      expect(body.thinking).toEqual({ type: 'adaptive' });
      expect(body.output_config).toEqual({
        effort: 'low',
        format: { type: 'json_schema', schema: toStrictJsonSchema(Explain) },
      });
      expect(body.system).toEqual([
        { type: 'text', text: SYSTEM_TEXT.explain, cache_control: { type: 'ephemeral' } },
      ]);
      expect(body.messages).toEqual([{ role: 'user', content: USER_TURN }]);
      expect(body.messages.at(-1).role).toBe('user');
      for (const field of ['temperature', 'top_p', 'top_k', 'tool_choice', 'tools', 'stop_sequences']) {
        expect(body).not.toHaveProperty(field);
      }
      expect(JSON.stringify(body)).not.toContain('budget_tokens');
      expect(body.metadata.user_id).toMatch(/^[0-9a-f]{32}$/);
      expect(JSON.stringify(body)).not.toContain(annaId);

      if (model === 'claude-haiku-5-5') {
        // No server-side fallback on Haiku: neither the beta nor the parameter.
        expect(headers['anthropic-beta'] ?? '').not.toContain('server-side-fallback');
        expect(body).not.toHaveProperty('fallbacks');
      } else {
        expect(String(headers['anthropic-beta']).split(',')).toContain('server-side-fallback-2026-07-01');
        expect(body.fallbacks).toBe('default');
      }

      const row = await lastRow();
      expect(row).toMatchObject({
        feature: 'explain',
        scope: 'org',
        orgId: musterId,
        userId: annaId,
        countsForUser: true,
        model,
        servedModel: null,
        status: 'ok',
        demo: false,
        apiCalls: 1,
        reservedMicros: 0,
        requestId: expect.stringMatching(/^req_mock_\d+$/),
      });
      expect(row.finishedAt).not.toBeNull();
      expect(row.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.usageId).toBe(row.id);
    });
  }

  it('sets the effort and max_tokens of each feature (medium for dns_check, server_health, translations)', async () => {
    await configure({});
    const Any = z.object({ ok: z.boolean() });
    for (const feature of AI_FEATURES.filter((f) => f !== 'assistant')) {
      mock.requests.length = 0;
      mock.setScript(() => ({ json: { ok: true } }));
      await t.ctx.ai.structured({
        feature,
        scope: 'platform',
        orgId: null,
        countsForUser: false,
        actor: { userId: adminId },
        system: feature === 'translations' ? '# Feature: translations\n\nTranslate.' : SYSTEM_TEXT[feature],
        user: '{"locale":"fr","items":[]}',
        schema: Any,
      });
      const { body } = mock.requests[0]!;
      expect(body.output_config.effort, feature).toBe(AI_FEATURE_EFFORT[feature]);
      expect(body.max_tokens, feature).toBe(AI_FEATURE_MAX_TOKENS[feature]);
    }
    expect(AI_FEATURE_EFFORT).toMatchObject({
      dns_check: 'medium',
      server_health: 'medium',
      translations: 'medium',
      explain: 'low',
      audit_summary: 'low',
      product_texts: 'low',
    });
  });
});

describe('accounting', () => {
  it('stores tokens and cost on the row and returns them', async () => {
    script({
      json: ANSWER,
      usage: {
        input_tokens: 1_000,
        output_tokens: 500,
        cache_read_input_tokens: 2_000,
        cache_creation_input_tokens: 300,
      },
    });
    const result = await explain();
    // Opus 5.5: 1,000 x 4 + 500 x 20 + 2,000 x 0.2 + 300 x 5 micro-USD.
    expect(result.costMicros).toBe(15_900);
    expect(result.tokens).toEqual({
      inputTokens: 1_000,
      outputTokens: 500,
      cacheReadTokens: 2_000,
      cacheWriteTokens: 300,
    });
    expect(await lastRow()).toMatchObject({
      inputTokens: 1_000,
      outputTokens: 500,
      cacheReadTokens: 2_000,
      cacheWriteTokens: 300,
      costMicros: 15_900,
    });
    expect(await t.ctx.ai.budgetState()).toMatchObject({ spentMicros: 15_900, reservedMicros: 0 });
  });

  it('prices every iteration of a server-side fallback and stores the served model', async () => {
    script({
      json: ANSWER,
      usage: { input_tokens: 5_000, output_tokens: 800 },
      fallbackTo: {
        model: 'claude-opus-5',
        afterFrames: 1,
        declinedUsage: { input_tokens: 5_000, output_tokens: 0 },
      },
    });
    const result = await explain();
    // The text continues after the switch point, so the answer is whole.
    expect(result.data).toEqual(ANSWER);
    expect(result.meta).toEqual({ model: 'claude-opus-5-5', servedModel: 'claude-opus-5', demo: false });
    // Declined attempt at Opus 5.5 prices, the unlisted fallback at Opus 5.5 x 1.25 (ai 6.7).
    expect(result.costMicros).toBe(5_000 * 4 + (5_000 * 4 + 800 * 20) * 1.25);
    expect(result.tokens).toMatchObject({ inputTokens: 10_000, outputTokens: 800 });
    expect(await lastRow()).toMatchObject({ servedModel: 'claude-opus-5', costMicros: 65_000, status: 'ok' });
  });
});

describe('stop reasons', () => {
  it('a refusal is 422 ai_refusal with the category; the row is a refusal with its usage attached', async () => {
    script({ stopReason: 'refusal', refusalCategory: 'cyber', text: '' });
    const err = await failure(explain());
    expect(err).toMatchObject({ statusCode: 422, code: 'ai_refusal', details: { category: 'cyber' } });
    expect(err.message).toBe(AI_ERROR_MESSAGES.ai_refusal);
    const row = await lastRow();
    expect(row).toMatchObject({
      status: 'refusal',
      errorCode: 'ai_refusal',
      errorReason: 'cyber',
      apiCalls: 1,
    });
    expect(usageOfError(err)).toEqual({
      usageId: row.id,
      tokens: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costMicros: row.costMicros,
    });
  });

  it('max_tokens is retried once with double room, then 502 ai_incomplete', async () => {
    script({ stopReason: 'max_tokens', text: '{"summary":"cut' });
    const err = await failure(explain());
    expect(err).toMatchObject({ statusCode: 502, code: 'ai_incomplete' });
    expect(mock.requests.map((r) => r.body.max_tokens)).toEqual([8_000, 16_000]);
    expect(await lastRow()).toMatchObject({ status: 'incomplete', apiCalls: 2, reservedMicros: 0 });
  });

  it('max_tokens and then an answer gives the answer', async () => {
    script({ stopReason: 'max_tokens', text: '{"summary":"cut' }, { json: ANSWER });
    expect((await explain()).data).toEqual(ANSWER);
    expect(await lastRow()).toMatchObject({ status: 'ok', apiCalls: 2 });
  });

  it('retryOnMaxTokens: false sends no second request', async () => {
    script({ stopReason: 'max_tokens', text: '{"items":[' });
    const err = await failure(explain({ retryOnMaxTokens: false }));
    expect(err.code).toBe('ai_incomplete');
    expect(mock.requests).toHaveLength(1);
  });

  it('an answer that is not JSON or does not match the schema is ai_upstream output', async () => {
    script({ text: 'Sorry, here is no JSON.' });
    expect((await failure(explain())).details).toEqual({ reason: 'output' });
    script({ json: { summary: 'x', severity: 'fatal' } });
    expect((await failure(explain())).details).toEqual({ reason: 'output' });
    expect(await lastRow()).toMatchObject({
      status: 'error',
      errorCode: 'ai_upstream',
      errorReason: 'output',
    });
  });
});

describe('errors of the Claude API', () => {
  const cases: Array<[string, MockTurn, { statusCode: number; code: string; details?: unknown }]> = [
    [
      '401 authentication_error',
      { error: { status: 401, type: 'authentication_error', message: 'invalid x-api-key' } },
      { statusCode: 502, code: 'ai_upstream', details: { reason: 'auth' } },
    ],
    [
      '403 permission_error',
      { error: { status: 403, type: 'permission_error', message: 'no access' } },
      { statusCode: 502, code: 'ai_upstream', details: { reason: 'permission' } },
    ],
    [
      '404 not_found_error',
      { error: { status: 404, type: 'not_found_error', message: 'model: x' } },
      { statusCode: 502, code: 'ai_upstream', details: { reason: 'not_found' } },
    ],
    [
      '400 invalid_request_error',
      { error: { status: 400, type: 'invalid_request_error', message: 'bad' } },
      { statusCode: 502, code: 'ai_upstream', details: { reason: 'request' } },
    ],
    [
      '429 rate_limit_error with retry-after',
      {
        error: {
          status: 429,
          type: 'rate_limit_error',
          message: 'slow down',
          headers: { 'retry-after': '10' },
        },
      },
      { statusCode: 503, code: 'ai_busy', details: { reason: 'rate_limit', retryAfterSeconds: 10 } },
    ],
    [
      '529 overloaded_error',
      { error: { status: 529, type: 'overloaded_error', message: 'Overloaded' } },
      { statusCode: 503, code: 'ai_busy', details: { reason: 'overloaded', retryAfterSeconds: null } },
    ],
    [
      '500 api_error',
      { error: { status: 500, type: 'api_error', message: 'Internal error' } },
      { statusCode: 502, code: 'ai_upstream', details: { reason: 'server' } },
    ],
    [
      'mid-stream overloaded_error',
      { json: ANSWER, midStreamError: { type: 'overloaded_error', afterFrames: 2 } },
      { statusCode: 503, code: 'ai_busy', details: { reason: 'overloaded', retryAfterSeconds: null } },
    ],
    [
      'mid-stream api_error',
      { json: ANSWER, midStreamError: { type: 'api_error', afterFrames: 3 } },
      { statusCode: 502, code: 'ai_upstream', details: { reason: 'server' } },
    ],
    [
      'mid-stream rate_limit_error',
      { json: ANSWER, midStreamError: { type: 'rate_limit_error', afterFrames: 1 } },
      { statusCode: 503, code: 'ai_busy', details: { reason: 'rate_limit', retryAfterSeconds: null } },
    ],
  ];
  for (const [name, turn, expected] of cases) {
    it(`${name} -> ${expected.code}`, async () => {
      script(turn);
      const err = await failure(explain());
      expect(err).toMatchObject(expected);
      const row = await lastRow();
      expect(row).toMatchObject({ status: 'error', errorCode: expected.code, reservedMicros: 0 });
      expect(usageOfError(err)?.usageId).toBe(row.id);
    });
  }

  it('402 billing_error: a fixed message for the client, the redacted original only for staff', async () => {
    script({
      error: {
        status: 402,
        type: 'billing_error',
        message:
          'Your credit balance is too low to access the Anthropic API. Key sk-ant-api03-LEAKEDLEAKEDLEAKED',
      },
    });
    const err = await failure(explain());
    expect(err).toMatchObject({ statusCode: 502, code: 'ai_upstream', details: { reason: 'billing' } });
    expect(err.message).toBe('The AI service could not process the request.');
    expect(err.message).not.toMatch(/credit|balance/i);
    const row = await lastRow();
    expect(row.errorReason).toBe('billing');
    expect(row.errorMessage).toContain('Your credit balance is too low');
    expect(row.errorMessage).not.toContain('LEAKED');
    expect(row.errorMessage).toContain('[hidden]');
    expect(row.requestId).toMatch(/^req_mock_\d+$/);
  });

  it('a wrong key is ai_upstream auth', async () => {
    const other = await startClaudeMock({ apiKey: 'sk-ant-test-1111111111111111111111' });
    try {
      const service = new AiService({
        ...t.ctx,
        env: { ...t.ctx.env, ANTHROPIC_BASE_URL: other.url },
      } as AppContext);
      const err = await failure(
        service.structured({
          feature: 'explain',
          scope: 'platform',
          orgId: null,
          countsForUser: false,
          actor: { userId: adminId },
          system: SYSTEM_TEXT.explain,
          user: USER_TURN,
          schema: Explain,
        }),
      );
      expect(err).toMatchObject({ code: 'ai_upstream', details: { reason: 'auth' } });
    } finally {
      await other.close();
    }
  });

  it('an aborted signal is AiCancelled; the row is cancelled', async () => {
    let release!: () => void;
    script({ json: ANSWER, gate: new Promise<void>((resolve) => (release = resolve)) });
    const controller = new AbortController();
    const pending = explain({ signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    const err = await pending.catch((e: unknown) => e);
    release();
    expect(err).toBeInstanceOf(AiCancelled);
    expect(usageOfError(err)).not.toBeNull();
    expect(await lastRow()).toMatchObject({ status: 'cancelled', errorCode: null, reservedMicros: 0 });
  });
});

describe('limits', () => {
  it('refuses with 429 budget before any request when the month is used up', async () => {
    await t.db.insert(aiUsage).values({
      feature: 'explain',
      scope: 'platform',
      model: 'claude-opus-5-5',
      status: 'ok',
      costMicros: 100_000_000,
    });
    const err = await failure(explain());
    expect(err).toMatchObject({
      statusCode: 429,
      code: 'ai_limit',
      details: { limit: 'budget', retryAfterSeconds: null },
    });
    expect((err.details as { resetsAt: string }).resetsAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(mock.requests).toHaveLength(0);
    expect(usageOfError(err)).toBeNull();
    expect(await t.ctx.ai.budgetExceeded()).toBe(true);
    expect(await t.ctx.ai.budgetState()).toMatchObject({ exhausted: true, percent: 100, remainingMicros: 0 });
  });

  it('refuses with 429 concurrent at six live requests on the platform; stale rows do not count', async () => {
    const running = Array.from({ length: 6 }, () => ({
      feature: 'translations' as const,
      scope: 'platform' as const,
      countsForUser: false,
      model: 'claude-opus-5-5' as const,
      status: 'running' as const,
      reservedMicros: 1_000,
    }));
    const rows = await t.db.insert(aiUsage).values(running).returning();
    const err = await failure(explain());
    expect(err).toMatchObject({
      statusCode: 429,
      code: 'ai_limit',
      details: { limit: 'concurrent', retryAfterSeconds: 5 },
    });
    expect(mock.requests).toHaveLength(0);
    expect(await t.ctx.ai.budgetState()).toMatchObject({ reservedMicros: 6_000 });

    // Older than AI_TURN_TIMEOUT_SECONDS + 60 s: stale, ignored by every check (plan O29).
    const stale = t.ctx.env.AI_TURN_TIMEOUT_SECONDS + 61;
    await t.db
      .update(aiUsage)
      .set({ createdAt: sql`now() - make_interval(secs => ${stale}::int)` })
      .where(sql`${aiUsage.id} in ${rows.map((r) => r.id)}`);
    expect((await explain()).data).toEqual(ANSWER);
    expect(await t.ctx.ai.budgetState()).toMatchObject({ reservedMicros: 0 });
  });

  it('countsForUser needs a person', async () => {
    await expect(explain({ actor: { userId: null } })).rejects.toThrow(/countsForUser/);
  });
});

describe('availability', () => {
  it('404 while the master switch is off, the feature is off or nothing is configured', async () => {
    await configure({ enabled: false });
    expect(await failure(explain())).toMatchObject({ statusCode: 404, code: 'not_found' });
    expect(await t.ctx.ai.availability('explain')).toMatchObject({ available: false, reason: 'disabled' });

    await configure({ features: { ...ALL_ON, explain: false } });
    expect(await failure(explain())).toMatchObject({ statusCode: 404, code: 'not_found' });
    expect(await t.ctx.ai.availability('explain')).toMatchObject({ reason: 'feature_off' });
    expect(await t.ctx.ai.availability('dns_check')).toMatchObject({ available: true });

    await configure({});
    const unconfigured = new AiService({
      ...t.ctx,
      env: { ...t.ctx.env, ENABLE_DEMO_PROVIDER: false },
      box: new (await import('../src/lib/crypto')).SecretBox(Buffer.alloc(32, 3).toString('base64')),
    } as AppContext);
    expect(await unconfigured.availability('explain')).toMatchObject({
      available: false,
      reason: 'not_configured',
    });
    expect(mock.requests).toHaveLength(0);
    expect(await t.db.select().from(aiUsage)).toHaveLength(0);
  });
});

describe('demo mode', () => {
  it('answers translations as [FR] <German text> at cost 0, without reaching Claude', async () => {
    expect((await admin.del('/admin/ai/key')).statusCode).toBe(200);
    try {
      expect(await t.ctx.ai.availability('translations')).toMatchObject({ available: true, demo: true });
      const user = JSON.stringify({
        locale: 'fr',
        items: [
          {
            id: 'i1',
            key: 'billing.invoice.title',
            de: 'Rechnung {number}\nbezahlt',
            en: 'Invoice {number}\npaid',
          },
          { id: 'i2', key: 'nav.admin.ai', de: 'KI', en: 'AI' },
        ],
      });
      const result = await t.ctx.ai.structured({
        feature: 'translations',
        scope: 'platform',
        orgId: null,
        countsForUser: false,
        retryOnMaxTokens: false,
        actor: { userId: adminId },
        system: '# Feature: translations\n\nYou translate user interface texts.',
        user,
        schema: TranslationBatchOutput,
      });
      expect(result.data).toEqual({
        items: [
          { id: 'i1', text: '[FR] Rechnung {number}\nbezahlt' },
          { id: 'i2', text: '[FR] KI' },
        ],
      });
      expect(result.costMicros).toBe(0);
      expect(result.meta).toEqual({ model: 'claude-opus-5-5', servedModel: 'claude-opus-5-5', demo: true });
      expect(result.tokens.inputTokens).toBeGreaterThan(0);
      expect(mock.requests).toHaveLength(0);
      expect(await lastRow()).toMatchObject({
        feature: 'translations',
        scope: 'platform',
        orgId: null,
        countsForUser: false,
        demo: true,
        costMicros: 0,
        status: 'ok',
        requestId: expect.stringMatching(/^req_demo_\d+$/),
      });
    } finally {
      expect((await admin.request('PUT', '/admin/ai/key', { key: MOCK_API_KEY })).statusCode).toBe(200);
    }
  });

  it('answers a JSON feature with a valid minimal object (U3 completes the feature answers)', async () => {
    expect((await admin.del('/admin/ai/key')).statusCode).toBe(200);
    try {
      const result = await explain();
      expect(result.data.summary).toMatch(/^\[Demo\]/);
      expect(result.meta.demo).toBe(true);
    } finally {
      expect((await admin.request('PUT', '/admin/ai/key', { key: MOCK_API_KEY })).statusCode).toBe(200);
    }
  });
});

describe('the KI page answer', () => {
  it('shows the budget with what the requests spent', async () => {
    script({ json: ANSWER, usage: { input_tokens: 1_000, output_tokens: 0 } });
    await explain();
    const dto = json<{ budget: { spentMicros: number } }>(await admin.get('/admin/ai/settings'));
    expect(dto.budget.spentMicros).toBe(4_000);
  });
});
