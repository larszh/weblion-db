import { inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AI_FEATURES,
  AI_MODELS,
  type AiFeature,
  type AiKeyStatusDto,
  type AiSettingsDto,
  type AiStatusDto,
  type AiTestResultDto,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import { platformScope, requireAuth, requireSession } from '../../auth/access';
import { users } from '../../db/schema';
import { deleteDemoOverrides } from '../../i18n/entries';
import { AppError, badRequest } from '../../lib/errors';
import { parse } from '../../lib/validation';
import { AiCancelled, aiAdminKey, classifyAiError } from './errors';
import { setAnthropicKeys } from './redact';
import {
  AI_ADMIN_KEY_PREFIX,
  AI_KEY_PATTERN,
  AI_SETTING_RANGES,
  deleteAiKey,
  saveAiKey,
  saveAiSettings,
  storedAiKey,
  type AiSettings,
  type StoredAiSettings,
} from './settings';

/**
 * Status and the KI page (ai 5.4): GET /ai/status for everyone signed in, the settings, the key and the
 * connection test for platform:settings. None of the KI page routes asks whether AI is available: they work
 * while it is off, before go-live and without a key (plan O27).
 */

const r = AI_SETTING_RANGES;
const settingsBody = z.object({
  enabled: z.boolean(),
  model: z.enum(AI_MODELS),
  // A record with an enum key is exhaustive in zod 4: every feature must be given.
  features: z.record(z.enum(AI_FEATURES), z.boolean()),
  budgetUsd: z.number().min(r.budgetUsd.min).max(r.budgetUsd.max),
  warnPercent: z.number().int().min(r.warnPercent.min).max(r.warnPercent.max),
  dailyOrgLimit: z.number().int().min(r.dailyOrgLimit.min).max(r.dailyOrgLimit.max),
  dailyUserLimit: z.number().int().min(r.dailyUserLimit.min).max(r.dailyUserLimit.max),
  noticeChecked: z.boolean().optional(),
  goLive: z
    .object({
      contracts: z.boolean(),
      transferBasis: z.boolean(),
      noticeChecked: z.boolean(),
      workspaceChecked: z.boolean(),
    })
    .optional(),
});

/** The four checks of the go-live checklist (ai 16); no announcement date, AI is opt-in per customer (O34). */
const GO_LIVE_CHECKS = ['contracts', 'transferBasis', 'noticeChecked', 'workspaceChecked'] as const;

const keyBody = z.object({ key: z.string().trim().min(1).max(400) });

/** The fields of the settings that ai.settings_update compares. */
const COMPARED = ['enabled', 'model', 'budgetUsd', 'warnPercent', 'dailyOrgLimit', 'dailyUserLimit'] as const;

export async function aiRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, box, env, access, audit } = ctx;

  async function userRefs(ids: Array<string | null | undefined>) {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))];
    const rows = wanted.length
      ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, wanted))
      : [];
    const byId = new Map(rows.map((u) => [u.id, u]));
    return (id: string | null | undefined) => (id ? (byId.get(id) ?? null) : null);
  }

  async function keyStatus(): Promise<AiKeyStatusDto> {
    const stored = await storedAiKey(db, box);
    const ref = await userRefs([stored?.savedBy]);
    return {
      source: stored ? 'ui' : env.ANTHROPIC_API_KEY ? 'env' : 'none',
      savedAt: stored?.savedAt ?? null,
      savedBy: ref(stored?.savedBy),
      envSet: !!env.ANTHROPIC_API_KEY,
    };
  }

  async function settingsDto(): Promise<AiSettingsDto> {
    const settings = await ctx.ai.settings();
    const [key, status, budget, ref] = await Promise.all([
      keyStatus(),
      ctx.ai.availability(),
      ctx.ai.budgetState(),
      userRefs([settings.notice?.checkedBy, settings.goLive?.confirmedBy]),
    ]);
    return {
      enabled: settings.enabled,
      model: settings.model,
      features: settings.features,
      budgetUsd: settings.budgetUsd,
      warnPercent: settings.warnPercent,
      dailyOrgLimit: settings.dailyOrgLimit,
      dailyUserLimit: settings.dailyUserLimit,
      key,
      demo: status.demo,
      status,
      budget,
      notice: {
        checkedAt: settings.notice?.checkedAt ?? null,
        checkedBy: ref(settings.notice?.checkedBy),
      },
      goLive: settings.goLive
        ? {
            contracts: settings.goLive.contracts,
            transferBasis: settings.goLive.transferBasis,
            noticeChecked: settings.goLive.noticeChecked,
            workspaceChecked: settings.goLive.workspaceChecked,
            confirmedAt: settings.goLive.confirmedAt,
            confirmedBy: ref(settings.goLive.confirmedBy),
          }
        : null,
    };
  }

  /** The changed fields as { field: { from, to } }; features as features.<feature>. */
  function changes(
    before: AiSettings,
    after: StoredAiSettings,
  ): Record<string, { from: unknown; to: unknown }> {
    const out: Record<string, { from: unknown; to: unknown }> = {};
    for (const field of COMPARED) {
      if (before[field] !== after[field]) out[field] = { from: before[field], to: after[field] };
    }
    for (const f of AI_FEATURES) {
      const to = after.features[f] !== false;
      if (before.features[f] !== to) out[`features.${f}`] = { from: before.features[f], to };
    }
    return out;
  }

  app.get('/ai/status', async (req): Promise<AiStatusDto> => {
    requireAuth(req);
    return ctx.ai.status();
  });

  app.get('/admin/ai/settings', async (req): Promise<AiSettingsDto> => {
    requireSession(req);
    await access.assert(req, 'platform:settings', platformScope);
    return settingsDto();
  });

  app.put('/admin/ai/settings', async (req): Promise<AiSettingsDto> => {
    const auth = requireSession(req);
    await access.assert(req, 'platform:settings', platformScope);
    const body = parse(settingsBody, req.body);
    ctx.ai.resetClient();
    const before = await ctx.ai.settings();
    const { demo } = await ctx.ai.availability();
    const now = new Date().toISOString();

    // Off -> on asks for the go-live checklist every time, outside demo mode (ai 5.1, 16).
    const switchingOn = !before.enabled && body.enabled;
    let goLive = before.goLive;
    let confirmed = false;
    if (switchingOn) {
      const checks = body.goLive;
      const failing = GO_LIVE_CHECKS.filter((check) => checks?.[check] !== true);
      if (!demo && failing.length > 0) {
        throw badRequest(
          'Validation failed',
          checks
            ? failing.map((check) => ({
                path: `goLive.${check}`,
                message: 'must be confirmed to switch AI on',
              }))
            : [{ path: 'goLive', message: 'the go-live checklist is required to switch AI on' }],
        );
      }
      if (checks && failing.length === 0) {
        goLive = { ...checks, confirmedAt: now, confirmedBy: auth.user.id };
        confirmed = true;
      }
    }

    const next: StoredAiSettings = {
      enabled: body.enabled,
      model: body.model,
      features: Object.fromEntries(AI_FEATURES.map((f) => [f, body.features[f]])) as Record<
        AiFeature,
        boolean
      >,
      budgetUsd: body.budgetUsd,
      warnPercent: body.warnPercent,
      dailyOrgLimit: body.dailyOrgLimit,
      dailyUserLimit: body.dailyUserLimit,
      notice: body.noticeChecked ? { checkedAt: now, checkedBy: auth.user.id } : before.notice,
      goLive,
    };
    await saveAiSettings(db, next);
    ctx.ai.resetClient();

    const details: Record<string, unknown> = changes(before, next);
    if (confirmed && goLive) {
      details.goLive = {
        contracts: goLive.contracts,
        transferBasis: goLive.transferBasis,
        noticeChecked: goLive.noticeChecked,
        workspaceChecked: goLive.workspaceChecked,
      };
    }
    if (body.noticeChecked) details.noticeChecked = true;
    await audit.record(req, {
      action: 'ai.settings_update',
      resourceType: 'settings',
      resourceId: 'ai',
      details,
    });
    return settingsDto();
  });

  app.put('/admin/ai/key', async (req): Promise<AiKeyStatusDto & { demoOverridesDeleted: number }> => {
    const auth = requireSession(req);
    await access.assert(req, 'platform:settings', platformScope);
    const { key } = parse(keyBody, req.body);
    // Admin API keys manage the organization and the Messages API refuses them: never store one at rest.
    if (key.startsWith(AI_ADMIN_KEY_PREFIX)) throw aiAdminKey();
    if (!AI_KEY_PATTERN.test(key)) {
      // The message never repeats the value.
      throw badRequest('Validation failed', [
        { path: 'key', message: 'expected an API key from the Claude Console (sk-ant-...)' },
      ]);
    }
    // One transaction: with a real key the demo emulator is gone, so its pseudo translations go too (plan O11).
    const { replaced, demoOverridesDeleted } = await db.transaction(async (tx) => {
      const existing = await storedAiKey(tx, box);
      await saveAiKey(tx, box, key, auth.user.id);
      return { replaced: existing !== null, demoOverridesDeleted: await deleteDemoOverrides(tx) };
    });
    setAnthropicKeys([key, env.ANTHROPIC_API_KEY ?? '']);
    await audit.record(req, {
      action: 'ai.key_update',
      resourceType: 'settings',
      resourceId: 'ai_key',
      details: { source: 'ui', replaced, demoOverridesDeleted },
    });
    ctx.ai.resetClient();
    await ctx.i18n.reload();
    return { ...(await keyStatus()), demoOverridesDeleted };
  });

  app.delete('/admin/ai/key', async (req): Promise<AiKeyStatusDto> => {
    requireSession(req);
    await access.assert(req, 'platform:settings', platformScope);
    const deleted = await deleteAiKey(db);
    await audit.record(req, {
      action: 'ai.key_delete',
      resourceType: 'settings',
      resourceId: 'ai_key',
      details: { envFallback: !!env.ANTHROPIC_API_KEY, deleted },
    });
    ctx.ai.resetClient();
    return keyStatus();
  });

  app.post(
    '/admin/ai/test',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req): Promise<AiTestResultDto> => {
      requireSession(req);
      await access.assert(req, 'platform:settings', platformScope);
      ctx.ai.resetClient();
      const { model } = await ctx.ai.settings();
      const ai = await ctx.ai.client();
      const started = Date.now();
      // No key at all: nothing can authenticate.
      let reason: AiTestResultDto['reason'] = ai ? null : 'auth';
      if (ai) {
        try {
          // No tokens, no budget, no ai_usage row (ai 5.2).
          await ai.client.models.retrieve(model, {}, { timeout: 30_000 });
        } catch (err) {
          reason = testReason(err);
        }
      }
      const result: AiTestResultDto = {
        ok: reason === null,
        model,
        demo: ai?.demo ?? false,
        latencyMs: Date.now() - started,
        reason,
      };
      await audit.record(req, {
        action: 'ai.test',
        status: result.ok ? 'success' : 'failure',
        resourceType: 'settings',
        resourceId: 'ai',
        details: { model, reason },
      });
      return result;
    },
  );
}

/** The reason of a failed connection test, from classifyAiError (never the provider's text). */
function testReason(err: unknown): AiTestResultDto['reason'] {
  let error: AppError | AiCancelled;
  try {
    error = classifyAiError(err, { timedOut: false });
  } catch {
    return 'server';
  }
  if (error instanceof AiCancelled || error.code === 'ai_timeout') return 'timeout';
  const reason = (error.details as { reason?: unknown } | undefined)?.reason;
  if ((error.code === 'ai_upstream' || error.code === 'ai_busy') && typeof reason === 'string') {
    return reason as AiTestResultDto['reason'];
  }
  return 'server';
}
