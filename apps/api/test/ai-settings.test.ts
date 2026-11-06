import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, inArray, like } from 'drizzle-orm';
import {
  AI_FEATURES,
  type AiFeature,
  type AiKeyStatusDto,
  type AiSettingsDto,
  type AiSettingsInput,
  type AiStatusDto,
  type AiTestResultDto,
  type IntegrationsDto,
  type ServerTranslationKey,
} from '@weblion/shared';
import type { AppContext } from '../src/context';
import { auditLogs, settings, translationOverrides, users } from '../src/db/schema';
import { saveOverride } from '../src/i18n/entries';
import { hashPassword } from '../src/lib/crypto';
import { AiService } from '../src/modules/ai/service';
import { readAiSettings, resolveAiKey, saveAiKey } from '../src/modules/ai/settings';
import { MOCK_API_KEY, startClaudeMock } from './claude-mock';
import { ADMIN, Client, createTestApp, DEMO_PASSWORD, json, type TestApp } from './helpers';

/** The KI page routes (ai 5.1 to 5.4, 15.2 "ai-settings"). */

let t: TestApp;
let mock: Awaited<ReturnType<typeof startClaudeMock>>;
let admin: Client;
let support: Client;
let anna: Client;

const ENV_KEY = 'sk-ant-api03-ENVENVENVENVENVENVENV';
const ALL_ON = Object.fromEntries(AI_FEATURES.map((f) => [f, true])) as Record<AiFeature, boolean>;
const GO_LIVE = { contracts: true, transferBasis: true, noticeChecked: true, workspaceChecked: true };

function body(extra: Partial<AiSettingsInput> = {}): AiSettingsInput {
  return {
    enabled: true,
    model: 'claude-opus-5-5',
    features: ALL_ON,
    budgetUsd: 100,
    warnPercent: 80,
    dailyOrgLimit: 200,
    dailyUserLimit: 50,
    ...extra,
  };
}

const putSettings = (client: Client, value: unknown) => client.request('PUT', '/admin/ai/settings', value);
const putKey = (client: Client, key: string) => client.request('PUT', '/admin/ai/key', { key });

/** A second service on the same database with another environment (a second app would reset the database). */
function serviceWith(env: Partial<AppContext['env']>): AiService {
  return new AiService({ ...t.ctx, env: { ...t.ctx.env, ...env } } as AppContext);
}

async function auditOf(action: string) {
  return t.db.select().from(auditLogs).where(eq(auditLogs.action, action));
}

beforeAll(async () => {
  mock = await startClaudeMock();
  t = await createTestApp({ env: { ANTHROPIC_BASE_URL: mock.url } });
  admin = new Client(t.app);
  await admin.login(ADMIN.email, ADMIN.password);
  await t.db.insert(users).values({
    email: 'support@weblion.test',
    name: 'Support',
    passwordHash: await hashPassword(DEMO_PASSWORD),
    platformRole: 'support',
  });
  support = new Client(t.app);
  await support.login('support@weblion.test');
  anna = new Client(t.app);
  await anna.login('anna@muster.example');
});

afterAll(async () => {
  await t?.close();
  await mock?.close();
});

beforeEach(() => {
  t.ctx.ai.resetClient();
});

describe('defaults and status', () => {
  it('starts with the defaults of plan 3.2 (demo provider: master switch on, no key)', async () => {
    const res = await admin.get('/admin/ai/settings');
    expect(res.statusCode).toBe(200);
    const dto = json<AiSettingsDto>(res);
    expect(dto).toMatchObject({
      enabled: true,
      model: 'claude-opus-5-5',
      features: ALL_ON,
      budgetUsd: 100,
      warnPercent: 80,
      dailyOrgLimit: 200,
      dailyUserLimit: 50,
      demo: true,
      notice: { checkedAt: null, checkedBy: null },
      goLive: null,
    });
    expect(dto.key).toEqual({ source: 'none', savedAt: null, savedBy: null, envSet: false });
    expect(dto.status).toEqual({ available: true, reason: null, demo: true, model: 'claude-opus-5-5' });
    expect(dto.budget).toMatchObject({ budgetMicros: 100_000_000, spentMicros: 0, exhausted: false });
  });

  it('is off without the demo provider (production)', async () => {
    const defaults = await readAiSettings(t.db, { ...t.ctx.env, ENABLE_DEMO_PROVIDER: false });
    expect(defaults.enabled).toBe(false);
    expect(defaults.features).toEqual(ALL_ON);
    expect(await serviceWith({ ENABLE_DEMO_PROVIDER: false }).availability()).toMatchObject({
      available: false,
      reason: 'disabled',
      demo: false,
    });
  });

  it('GET /ai/status answers every signed-in person and names the reasons', async () => {
    expect((await new Client(t.app).get('/ai/status')).statusCode).toBe(401);
    const status = json<AiStatusDto>(await anna.get('/ai/status'));
    expect(status).toEqual({
      available: true,
      reason: null,
      demo: true,
      model: 'claude-opus-5-5',
      features: [...AI_FEATURES],
    });

    // A feature switched off: still available, the feature is missing; availability(feature) says why.
    expect((await putSettings(admin, body({ features: { ...ALL_ON, explain: false } }))).statusCode).toBe(
      200,
    );
    const withoutExplain = json<AiStatusDto>(await anna.get('/ai/status'));
    expect(withoutExplain.features).not.toContain('explain');
    expect(await t.ctx.ai.availability('explain')).toMatchObject({ available: false, reason: 'feature_off' });
    expect(await t.ctx.ai.availability('dns_check')).toMatchObject({ available: true, reason: null });

    // On, but neither a key nor the demo provider: not configured.
    expect(await serviceWith({ ENABLE_DEMO_PROVIDER: false }).availability('explain')).toMatchObject({
      available: false,
      reason: 'not_configured',
    });

    // Master switch off wins over everything.
    expect((await putSettings(admin, body({ enabled: false }))).statusCode).toBe(200);
    expect(json<AiStatusDto>(await anna.get('/ai/status'))).toMatchObject({
      available: false,
      reason: 'disabled',
      features: [],
    });
    expect(await t.ctx.ai.availability('explain')).toMatchObject({ reason: 'disabled' });
    expect((await putSettings(admin, body())).statusCode).toBe(200); // demo mode: no go-live needed
  });

  it('fills IntegrationsDto.ai', async () => {
    const res = json<IntegrationsDto>(await admin.get('/admin/integrations'));
    expect(res.ai).toEqual({ configured: true, source: 'demo', enabled: true, model: 'claude-opus-5-5' });
    expect(await serviceWith({ ENABLE_DEMO_PROVIDER: false }).integrationStatus()).toMatchObject({
      configured: false,
      source: 'none',
    });
  });
});

describe('permissions', () => {
  it('needs platform:settings for every KI page route (support and members 403)', async () => {
    for (const client of [support, anna]) {
      expect((await client.get('/admin/ai/settings')).statusCode).toBe(403);
      expect((await putSettings(client, body())).statusCode).toBe(403);
      expect((await putKey(client, MOCK_API_KEY)).statusCode).toBe(403);
      expect((await client.del('/admin/ai/key')).statusCode).toBe(403);
      expect((await client.post('/admin/ai/test', {})).statusCode).toBe(403);
    }
    expect(await t.db.select().from(settings).where(eq(settings.key, 'ai_key'))).toHaveLength(0);
  });

  it('refuses API tokens on the KI page (requireSession); the status answers them', async () => {
    const orgs = json<Array<{ id: string; slug: string }>>(await anna.get('/orgs'));
    const muster = orgs.find((o) => o.slug === 'muster-ag')!;
    const { token } = json<{ token: string }>(
      await anna.post(`/orgs/${muster.id}/tokens`, { name: 'ai', scope: 'read_write' }),
    );
    const bot = new Client(t.app);
    bot.bearer = token;
    expect((await bot.get('/admin/ai/settings')).statusCode).toBe(403);
    expect((await bot.request('PUT', '/admin/ai/key', { key: MOCK_API_KEY })).statusCode).toBe(403);
    expect((await bot.get('/ai/status')).statusCode).toBe(200);
  });
});

describe('validation', () => {
  const invalid: Array<[string, unknown]> = [
    ['budget below 0', body({ budgetUsd: -1 })],
    ['budget above 100,000', body({ budgetUsd: 100_001 })],
    ['warning below 10', body({ warnPercent: 9 })],
    ['warning above 99', body({ warnPercent: 100 })],
    ['warning not an integer', body({ warnPercent: 50.5 })],
    ['organization limit 0', body({ dailyOrgLimit: 0 })],
    ['organization limit above 10,000', body({ dailyOrgLimit: 10_001 })],
    ['person limit 0', body({ dailyUserLimit: 0 })],
    ['person limit above 10,000', body({ dailyUserLimit: 10_001 })],
    ['unknown model', body({ model: 'claude-x' as never })],
    ['a missing feature', body({ features: { explain: true } as never })],
    ['no body', undefined],
  ];
  for (const [name, value] of invalid) {
    it(`400 for ${name}`, async () => {
      const res = await putSettings(admin, value);
      expect(res.statusCode).toBe(400);
      expect(json(res).error.code).toBe('bad_request');
    });
  }

  it('accepts the bounds (0 budget refuses every request, 99 percent)', async () => {
    const res = await putSettings(
      admin,
      body({ budgetUsd: 0, warnPercent: 99, dailyOrgLimit: 10_000, dailyUserLimit: 1 }),
    );
    expect(res.statusCode).toBe(200);
    expect(json<AiSettingsDto>(res)).toMatchObject({ budgetUsd: 0, warnPercent: 99, dailyUserLimit: 1 });
    expect(json<AiSettingsDto>(res).budget.exhausted).toBe(true);
    expect((await putSettings(admin, body())).statusCode).toBe(200);
  });
});

describe('the key', () => {
  it('refuses an Admin API key and malformed keys without repeating them', async () => {
    const adminKey = 'sk-ant-admin01-AAAAAAAAAAAAAAAAAAAAAAAA';
    const res = await putKey(admin, adminKey);
    expect(res.statusCode).toBe(400);
    expect(json(res).error.code).toBe('ai_admin_key');
    expect(res.body).not.toContain(adminKey);

    for (const key of ['not-a-key-at-all-xxxxxxxxxx', 'sk-ant-short', 'sk-ant-has space inside-xxxxxxxx']) {
      const bad = await putKey(admin, key);
      expect(bad.statusCode).toBe(400);
      expect(json(bad).error.code).toBe('bad_request');
      expect(bad.body).not.toContain(key);
    }
    expect(await t.db.select().from(settings).where(eq(settings.key, 'ai_key'))).toHaveLength(0);
  });

  it('saves the key, deletes the demo translations in the same request, and never returns the key', async () => {
    const hash = t.ctx.i18n.source('ai.notice.title' as ServerTranslationKey).hash;
    await saveOverride(t.db, {
      key: 'nav.dashboard',
      locale: 'fr',
      value: '[FR] Dashboard',
      origin: 'ai',
      reviewed: false,
      sourceHash: hash,
      demo: true,
      userId: null,
    });
    await saveOverride(t.db, {
      key: 'nav.servers',
      locale: 'it',
      value: '[IT] Server',
      origin: 'ai',
      reviewed: false,
      sourceHash: hash,
      demo: true,
      userId: null,
    });
    await saveOverride(t.db, {
      key: 'nav.servers',
      locale: 'fr',
      value: 'Serveurs',
      origin: 'manual',
      reviewed: true,
      sourceHash: hash,
      userId: null,
    });

    const res = await putKey(admin, `  ${MOCK_API_KEY}  `);
    expect(res.statusCode).toBe(200);
    const dto = json<AiKeyStatusDto & { demoOverridesDeleted: number }>(res);
    expect(dto).toMatchObject({ source: 'ui', envSet: false, demoOverridesDeleted: 2 });
    expect(dto.savedAt).not.toBeNull();
    expect(dto.savedBy?.name).toBe('weblion Admin');
    expect(res.body).not.toContain(MOCK_API_KEY);

    const left = await t.db.select().from(translationOverrides);
    expect(left.map((r) => `${r.locale}:${r.key}`)).toEqual(['fr:nav.servers']);

    // The row holds only ciphertext.
    const row = await t.db.query.settings.findFirst({ where: eq(settings.key, 'ai_key') });
    expect(JSON.stringify(row?.value)).not.toContain(MOCK_API_KEY);

    const [entry] = await auditOf('ai.key_update');
    expect(entry?.details).toEqual({ source: 'ui', replaced: false, demoOverridesDeleted: 2 });

    // Demo mode ended: the status says so.
    const settingsDto = json<AiSettingsDto>(await admin.get('/admin/ai/settings'));
    expect(settingsDto.demo).toBe(false);
    expect(settingsDto.key.source).toBe('ui');
    expect(settingsDto.status).toMatchObject({ available: true, demo: false });

    for (const path of ['/admin/ai/settings', '/admin/integrations', '/ai/status']) {
      expect((await admin.get(path)).body).not.toContain(MOCK_API_KEY);
    }
    const all = await t.db.select().from(auditLogs);
    expect(JSON.stringify(all)).not.toContain(MOCK_API_KEY);
  });

  it('replacing the key is audited as replaced', async () => {
    expect((await putKey(admin, MOCK_API_KEY)).statusCode).toBe(200);
    const entries = await auditOf('ai.key_update');
    expect(entries.at(-1)?.details).toEqual({ source: 'ui', replaced: true, demoOverridesDeleted: 0 });
  });

  it('the saved key wins over ANTHROPIC_API_KEY; a delete falls back to the env key', async () => {
    const env = { ...t.ctx.env, ANTHROPIC_API_KEY: ENV_KEY };
    expect(await resolveAiKey(t.db, t.ctx.box, env)).toEqual({
      source: 'ui',
      key: MOCK_API_KEY,
      demo: false,
    });

    const withEnv = serviceWith({ ANTHROPIC_API_KEY: ENV_KEY });
    expect(await withEnv.integrationStatus()).toMatchObject({ source: 'ui', configured: true });

    const res = await admin.del('/admin/ai/key');
    expect(res.statusCode).toBe(200);
    expect(json<AiKeyStatusDto>(res)).toEqual({
      source: 'none',
      savedAt: null,
      savedBy: null,
      envSet: false,
    });
    expect((await auditOf('ai.key_delete')).at(-1)?.details).toEqual({ envFallback: false, deleted: true });

    expect(await resolveAiKey(t.db, t.ctx.box, env)).toEqual({ source: 'env', key: ENV_KEY, demo: false });
    withEnv.resetClient();
    expect(await withEnv.integrationStatus()).toMatchObject({ source: 'env', configured: true });
    // Without either key the demo provider takes over again.
    expect(await resolveAiKey(t.db, t.ctx.box, t.ctx.env)).toEqual({ source: 'none', key: null, demo: true });
  });

  it('a key saved under another ENCRYPTION_KEY counts as missing', async () => {
    await saveAiKey(t.db, t.ctx.box, MOCK_API_KEY, (await t.db.query.users.findFirst())!.id);
    const other = { ...t.ctx.env, ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64') };
    const { SecretBox } = await import('../src/lib/crypto');
    expect(await resolveAiKey(t.db, new SecretBox(other.ENCRYPTION_KEY), other)).toMatchObject({
      source: 'none',
    });
    await admin.del('/admin/ai/key');
  });
});

describe('the connection test', () => {
  it('answers ok against the mock and audits it', async () => {
    expect((await putKey(admin, MOCK_API_KEY)).statusCode).toBe(200);
    const before = mock.requests.length;
    const res = await admin.post('/admin/ai/test', {});
    expect(res.statusCode).toBe(200);
    expect(json<AiTestResultDto>(res)).toMatchObject({
      ok: true,
      model: 'claude-opus-5-5',
      demo: false,
      reason: null,
    });
    const request = mock.requests[before]!;
    expect(request).toMatchObject({ method: 'GET', path: '/v1/models/claude-opus-5-5' });
    expect(request.headers.authorization).toBe(`Bearer ${MOCK_API_KEY}`);
    expect((await auditOf('ai.test')).at(-1)).toMatchObject({
      status: 'success',
      details: { model: 'claude-opus-5-5', reason: null },
    });
  });

  it('answers ok: false with the reason auth for a wrong key, without the provider text', async () => {
    const wrong = 'sk-ant-api03-WRONGWRONGWRONGWRONG';
    expect((await putKey(admin, wrong)).statusCode).toBe(200);
    const res = await admin.post('/admin/ai/test', {});
    expect(res.statusCode).toBe(200);
    expect(json<AiTestResultDto>(res)).toMatchObject({ ok: false, reason: 'auth' });
    expect(res.body).not.toContain('x-api-key');
    expect((await auditOf('ai.test')).at(-1)).toMatchObject({
      status: 'failure',
      details: { model: 'claude-opus-5-5', reason: 'auth' },
    });
    expect((await putKey(admin, MOCK_API_KEY)).statusCode).toBe(200);
  });

  it('works in demo mode without an Anthropic account', async () => {
    await admin.del('/admin/ai/key');
    const res = json<AiTestResultDto>(await admin.post('/admin/ai/test', {}));
    expect(res).toMatchObject({ ok: true, demo: true, reason: null });
  });

  it('works while AI is switched off', async () => {
    expect((await putSettings(admin, body({ enabled: false }))).statusCode).toBe(200);
    expect((await putKey(admin, MOCK_API_KEY)).statusCode).toBe(200);
    expect(json<AiTestResultDto>(await admin.post('/admin/ai/test', {})).ok).toBe(true);
  });
});

describe('switching on (go-live checklist, plan O34)', () => {
  it('outside demo mode needs all four checks, no announcement date', async () => {
    // State from above: a key is saved (no demo mode) and the master switch is off.
    const missing = await putSettings(admin, body());
    expect(missing.statusCode).toBe(400);
    expect(json(missing).error).toMatchObject({ code: 'bad_request', details: [{ path: 'goLive' }] });

    const oneFalse = await putSettings(admin, body({ goLive: { ...GO_LIVE, transferBasis: false } }));
    expect(oneFalse.statusCode).toBe(400);
    expect(json(oneFalse).error.details).toEqual([
      { path: 'goLive.transferBasis', message: 'must be confirmed to switch AI on' },
    ]);
    expect(json<AiSettingsDto>(await admin.get('/admin/ai/settings')).enabled).toBe(false);

    const ok = await putSettings(admin, body({ goLive: GO_LIVE }));
    expect(ok.statusCode).toBe(200);
    const dto = json<AiSettingsDto>(ok);
    expect(dto.enabled).toBe(true);
    expect(dto.goLive).toMatchObject({ ...GO_LIVE, confirmedBy: { name: 'weblion Admin' } });
    expect(dto.goLive?.confirmedAt).not.toBeNull();

    expect((await auditOf('ai.settings_update')).at(-1)?.details).toEqual({
      enabled: { from: false, to: true },
      goLive: GO_LIVE,
    });
  });

  it('asks again every time the switch goes from off to on', async () => {
    expect((await putSettings(admin, body({ enabled: false }))).statusCode).toBe(200);
    expect((await putSettings(admin, body())).statusCode).toBe(400);
    expect((await putSettings(admin, body({ goLive: GO_LIVE }))).statusCode).toBe(200);
    // Staying on needs nothing.
    expect((await putSettings(admin, body({ model: 'claude-sonnet-5-5' }))).statusCode).toBe(200);
    expect((await auditOf('ai.settings_update')).at(-1)?.details).toEqual({
      model: { from: 'claude-opus-5-5', to: 'claude-sonnet-5-5' },
    });
  });

  it('demo mode needs no go-live checklist', async () => {
    await admin.del('/admin/ai/key');
    expect((await putSettings(admin, body({ enabled: false }))).statusCode).toBe(200);
    expect((await putSettings(admin, body())).statusCode).toBe(200);
  });

  it('records the changed features and the notice check with date and person', async () => {
    const res = await putSettings(
      admin,
      body({ features: { ...ALL_ON, audit_summary: false }, noticeChecked: true }),
    );
    expect(res.statusCode).toBe(200);
    const dto = json<AiSettingsDto>(res);
    expect(dto.features.audit_summary).toBe(false);
    expect(dto.notice.checkedBy?.name).toBe('weblion Admin');
    expect(Date.parse(dto.notice.checkedAt!)).toBeGreaterThan(Date.now() - 60_000);
    expect((await auditOf('ai.settings_update')).at(-1)?.details).toEqual({
      'features.audit_summary': { from: true, to: false },
      noticeChecked: true,
    });
    // The check stays when a later save does not send it.
    expect(json<AiSettingsDto>(await putSettings(admin, body())).notice.checkedAt).toBe(dto.notice.checkedAt);
  });
});

describe('the audit trail', () => {
  it('never holds the key or a part of it', async () => {
    expect((await putKey(admin, MOCK_API_KEY)).statusCode).toBe(200);
    const rows = await t.db
      .select()
      .from(auditLogs)
      .where(and(like(auditLogs.action, 'ai.%'), inArray(auditLogs.resourceType, ['settings'])));
    expect(rows.length).toBeGreaterThan(5);
    const text = JSON.stringify(rows);
    expect(text).not.toContain(MOCK_API_KEY);
    expect(text).not.toContain(MOCK_API_KEY.slice(-12));
  });
});
