import type Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage, BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import {
  AI_FEATURE_EFFORT,
  AI_FEATURES,
  type AiAvailabilityDto,
  type AiBudgetDto,
  type AiFeature,
  type AiIntegrationDto,
  type AiModel,
  type AiResultMeta,
  type AiStatusDto,
  type AiUsageScope,
  type AiUsageStatus,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import type { AiUsageRow } from '../../db/schema';
import { sha256 } from '../../lib/crypto';
import { AppError, notFound } from '../../lib/errors';
import {
  AI_FEATURE_MAX_TOKENS,
  AI_MAX_TOKENS_CEILING,
  baseParams,
  createAnthropic,
  systemBlocks,
} from './client';
import { AiCancelled, aiIncomplete, aiRefusal, aiUpstream, attachUsage, classifyAiError } from './errors';
import { setAnthropicKeys } from './redact';
import { toStrictJsonSchema } from './schema';
import { readAiSettings, resolveAiKey, type AiSettings, type ResolvedAiKey } from './settings';
import * as usage from './usage';
import type { ReserveInput, UsageTotals } from './usage';

/**
 * Every Claude call of the console goes through AiService (plan 2.4, O4): JSON features and translations
 * through structured(), the chat through U3's loop on the same reservation and accounting methods.
 */

export interface StructuredInput<T> {
  feature: AiFeature;
  /** 'org': a member or reseller staff on an organization's data; 'staff': weblion staff on a customer's
   *  data; 'platform': no customer data (KI page, product texts of the platform, translations). */
  scope: AiUsageScope;
  /** The organization the data belongs to (staff requests: the customer); null for 'platform'. */
  orgId: string | null;
  /** false only for Mass Translate batches (O9): no person or organization limit, the budget applies. */
  countsForUser: boolean;
  /** Default true: one more call with max_tokens doubled (at most 64,000). Translation batches pass false (O4). */
  retryOnMaxTokens?: boolean;
  /** userId is required when countsForUser is true; null only for system work. */
  actor: { userId: string | null };
  /** SYSTEM_TEXT[feature], or the translator's prompt whose first line is "# Feature: translations". Sent as
   *  one system block with cache_control (ai 6.2); never contains a date, a name or another per-request value. */
  system: string;
  /** The one user turn; third-party data inside escaped blocks (ai 11.1). */
  user: string;
  /** Validates the answer; also sent as output_config.format through toStrictJsonSchema (ai 6.5). */
  schema: z.ZodType<T>;
  /** Combined with the turn timeout (AI_TURN_TIMEOUT_SECONDS). */
  signal?: AbortSignal;
}

export interface StructuredResult<T> {
  data: T;
  meta: AiResultMeta;
  /** The ai_usage row of this request. */
  usageId: string;
  /** Summed over the calls of this request (the max_tokens retry included). */
  tokens: UsageTotals;
  costMicros: number;
}

/** Usage of a request that failed after its reservation; attached to every error structured() throws then. */
export interface StructuredUsage {
  usageId: string;
  tokens: UsageTotals;
  costMicros: number;
}

export interface AiClient {
  client: Anthropic;
  demo: boolean;
  model: AiModel;
}
export type AiFinishStatus = Exclude<AiUsageStatus, 'running' | 'stale'>;

/** Settings, key and availability are read at most every 10 s per process (ai 5.3). */
const CACHE_MS = 10_000;

interface Cached<T> {
  at: number;
  value: T;
}

export class AiService {
  private app: FastifyInstance | null = null;
  private settingsCache: Cached<AiSettings> | null = null;
  private keyCache: Cached<ResolvedAiKey> | null = null;
  private clientCache: { fingerprint: string; client: Anthropic } | null = null;

  /** Stores ctx and reads nothing from it before the first call, so app.ts creates it after the context object. */
  constructor(private readonly ctx: AppContext) {}

  /** buildApp after the plugins (F17): keeps the app for ConsoleReader (app.inject, ai 8.1). */
  attach(app: FastifyInstance): void {
    this.app = app;
  }

  /** The app given to attach(); ConsoleReader (U3) injects its reads into it. */
  attachedApp(): FastifyInstance {
    if (!this.app) throw new Error('AiService: attach(app) was not called');
    return this.app;
  }

  // --- Settings and availability -----------------------------------------------------------------

  /** The `ai` settings row with the defaults of plan 3.2; cached 10 s per process. */
  async settings(): Promise<AiSettings> {
    const now = Date.now();
    if (this.settingsCache && now - this.settingsCache.at < CACHE_MS) return this.settingsCache.value;
    const value = await readAiSettings(this.ctx.db, this.ctx.env);
    this.settingsCache = { at: now, value };
    return value;
  }

  /** The effective key (saved, env or none); also keeps both keys in the exact values redactText removes. */
  private async key(): Promise<ResolvedAiKey> {
    const now = Date.now();
    if (this.keyCache && now - this.keyCache.at < CACHE_MS) return this.keyCache.value;
    const value = await resolveAiKey(this.ctx.db, this.ctx.box, this.ctx.env);
    setAnthropicKeys([value.key ?? '', this.ctx.env.ANTHROPIC_API_KEY ?? '']);
    this.keyCache = { at: now, value };
    return value;
  }

  /** ai 5.3. Without feature: master switch and key only. Order of reasons: disabled, not_configured, feature_off. */
  async availability(feature?: AiFeature): Promise<AiAvailabilityDto> {
    const [settings, key] = await Promise.all([this.settings(), this.key()]);
    const demo = key.source === 'none' && key.demo;
    const reason = !settings.enabled
      ? 'disabled'
      : key.source === 'none' && !key.demo
        ? 'not_configured'
        : feature && !settings.features[feature]
          ? 'feature_off'
          : null;
    return { available: reason === null, reason, demo, model: settings.model };
  }

  /** 404 not_found ("AI feature not found") unless availability(feature).available; returns the settings. */
  async assertFeature(feature: AiFeature): Promise<AiSettings> {
    const availability = await this.availability(feature);
    if (!availability.available) throw notFound('AI feature');
    return this.settings();
  }

  /** GET /ai/status. The switched-on features only while AI is available; none while it is off. */
  async status(): Promise<AiStatusDto> {
    const [availability, settings] = await Promise.all([this.availability(), this.settings()]);
    return {
      ...availability,
      features: availability.available ? AI_FEATURES.filter((f) => settings.features[f]) : [],
    };
  }

  /** IntegrationsDto.ai for modules/settings/routes.ts (F18). configured is true for ui, env and demo. */
  async integrationStatus(): Promise<AiIntegrationDto> {
    const [settings, key] = await Promise.all([this.settings(), this.key()]);
    const source = key.source !== 'none' ? key.source : key.demo ? 'demo' : 'none';
    return { configured: source !== 'none', source, enabled: settings.enabled, model: settings.model };
  }

  /** null when not configured; one cached SDK client per key source and fingerprint (ai 5.2, 6.1). */
  async client(): Promise<AiClient | null> {
    const [settings, key] = await Promise.all([this.settings(), this.key()]);
    if (key.source === 'none' && !key.demo) return null;
    // A hash, so the key is not kept around as a cache key.
    const fingerprint = sha256(`${key.source}:${key.key ?? 'demo'}`);
    if (this.clientCache?.fingerprint !== fingerprint) {
      this.clientCache = { fingerprint, client: createAnthropic(this.ctx.env, key, this.ctx.log) };
    }
    return { client: this.clientCache.client, demo: key.demo, model: settings.model };
  }

  /** Drops the cached client and the settings and availability cache; after every settings or key write. */
  resetClient(): void {
    this.clientCache = null;
    this.settingsCache = null;
    this.keyCache = null;
  }

  // --- Calls ---------------------------------------------------------------------------------------

  /**
   * ai 6.6. Throws the AppErrors of plan 2.10 (not_found, ai_limit, ai_refusal, ai_incomplete, ai_upstream,
   * ai_busy, ai_timeout) or AiCancelled when input.signal aborted; errors after the reservation carry
   * StructuredUsage (usageOfError).
   */
  async structured<T>(input: StructuredInput<T>): Promise<StructuredResult<T>> {
    const { feature } = input;
    await this.assertFeature(feature);
    const ai = await this.client();
    if (!ai) throw notFound('AI feature');
    if (input.countsForUser && !input.actor.userId) {
      throw new Error('structured(): countsForUser needs actor.userId');
    }
    const { model, demo } = ai;
    const jsonSchema = toStrictJsonSchema(input.schema);
    // Demo calls cost nothing, so they reserve nothing.
    const estimate = demo
      ? 0
      : usage.estimateCallMicros(
          model,
          feature,
          usage.approxTokens(input.system + input.user + JSON.stringify(jsonSchema)),
        );
    const row = await this.reserve({
      feature,
      scope: input.scope,
      orgId: input.orgId,
      userId: input.actor.userId,
      countsForUser: input.countsForUser,
      model,
      demo,
      estimateMicros: estimate,
    });

    const timeout = AbortSignal.timeout(this.ctx.env.AI_TURN_TIMEOUT_SECONDS * 1000);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    const retry = input.retryOnMaxTokens !== false;
    let maxTokens = AI_FEATURE_MAX_TOKENS[feature];
    try {
      for (let call = 0; ; call++) {
        if (call > 0) await this.refreshReservation(row, estimate);
        const params: BetaMessageStreamParams = {
          ...baseParams(model, feature, input.actor.userId),
          max_tokens: maxTokens,
          system: systemBlocks(input.system),
          // Always ends with the user turn: no assistant prefill (these models reject it).
          messages: [{ role: 'user', content: input.user }],
          output_config: {
            effort: AI_FEATURE_EFFORT[feature],
            format: { type: 'json_schema', schema: jsonSchema },
          },
        };
        const stream = ai.client.beta.messages.stream(params, { signal });
        const message = await stream.finalMessage();
        await this.addCall(row, message, { requestId: stream.request_id ?? null });

        // stop_reason first, before reading any content.
        if (message.stop_reason === 'refusal') throw aiRefusal(message.stop_details?.category ?? null);
        if (message.stop_reason === 'max_tokens') {
          if (retry && call === 0 && maxTokens < AI_MAX_TOKENS_CEILING) {
            maxTokens = Math.min(maxTokens * 2, AI_MAX_TOKENS_CEILING);
            continue;
          }
          throw aiIncomplete();
        }
        // After a mid-stream fallback the fallback model continues the same text, so the text blocks in order
        // are the answer.
        const text = message.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
        let data: T;
        try {
          data = input.schema.parse(JSON.parse(text));
        } catch {
          throw aiUpstream('output');
        }
        await this.finish(row, 'ok');
        await usage.checkBudgetWarning(this.ctx);
        return {
          data,
          meta: { model, servedModel: message.model || model, demo },
          usageId: row.id,
          tokens: usage.rowTotals(row),
          costMicros: row.costMicros,
        };
      }
    } catch (err) {
      let error: AppError | AiCancelled;
      try {
        error = classifyAiError(err, { timedOut: timeout.aborted });
      } catch {
        // A bug of ours: the row ends as an error and the original goes to the normal 500 handler.
        await this.finish(row, 'error', {
          error: new AppError(500, 'internal_error', 'Internal server error'),
          original: err,
        });
        throw err;
      }
      const status: AiFinishStatus =
        error instanceof AiCancelled
          ? 'cancelled'
          : error.code === 'ai_refusal'
            ? 'refusal'
            : error.code === 'ai_incomplete'
              ? 'incomplete'
              : 'error';
      if (error instanceof AppError) {
        const details = (error.details ?? {}) as { reason?: unknown };
        const api = err as { status?: unknown; type?: unknown; requestID?: unknown };
        // Never the message: it can carry Anthropic's account state.
        this.ctx.log.warn(
          {
            feature,
            usageId: row.id,
            code: error.code,
            reason: details.reason ?? null,
            status: api?.status ?? null,
            type: api?.type ?? null,
            requestId: api?.requestID ?? row.requestId,
          },
          'claude request failed',
        );
        await this.finish(row, status, { error, original: err });
      } else {
        await this.finish(row, status);
      }
      // A refused or cut-off call costs money too (ai 7.2).
      if (row.costMicros > 0) await usage.checkBudgetWarning(this.ctx);
      throw attachUsage(error, { usageId: row.id, tokens: usage.rowTotals(row), costMicros: row.costMicros });
    }
  }

  // --- Limits and usage --------------------------------------------------------------------------------

  /** Up-front check for a request that makes several structured() calls (i18n B1): the person's rate,
   *  concurrency and daily limit (ai 7.1 checks 5 to 7), no row written. 429 ai_limit. */
  async countRate(actor: { userId: string }): Promise<void> {
    await usage.countRate(this.ctx.db, this.ctx.env, await this.settings(), actor);
  }

  /** Writes the running ai_usage row after checks 1 to 7 of ai 7.1 under the transaction lock of plan 3.3. */
  async reserve(input: ReserveInput): Promise<AiUsageRow> {
    return usage.reserve(this.ctx.db, this.ctx.env, await this.settings(), input);
  }

  /** Before every further call of the same request: reserved_micros = the next call's estimate. */
  async refreshReservation(row: AiUsageRow, estimateMicros: number): Promise<void> {
    await usage.refreshReservation(this.ctx.db, row, estimateMicros);
  }

  /** After every call: tokens, cost (aiCostMicros per iteration), api_calls + 1, served model, request id;
   *  updates the row in the database and the passed object. */
  async addCall(row: AiUsageRow, message: BetaMessage, call: { requestId: string | null }): Promise<void> {
    await usage.addCall(this.ctx.db, row, message, call);
  }

  /** status, finished_at, duration_ms, reserved_micros = 0; on failure error_code, error_reason and the
   *  redacted original message (redactText, at most 1,000 characters). Never throws. */
  async finish(
    row: AiUsageRow,
    status: AiFinishStatus,
    failure?: { error: AppError; original?: unknown },
  ): Promise<void> {
    await usage.finish(this.ctx.db, this.ctx.log, row, status, failure);
  }

  /** The current month (Europe/Zurich): budget, spent, reserved by live rows, remaining (ai 7.1). */
  async budgetState(): Promise<AiBudgetDto> {
    return usage.budgetState(this.ctx.db, this.ctx.env, await this.settings());
  }

  /** spent >= budget this month; checked after every chat API call (O29). */
  async budgetExceeded(): Promise<boolean> {
    return usage.budgetExceeded(this.ctx.db, this.ctx.env, await this.settings());
  }

  // --- U3 (declared with their signatures; U3 implements them) -----------------------------------------

  /** 403 ai_org_disabled with details.reasons unless aiOrgState(org, parent).enabled (ai 5.5). */
  async assertOrgData(_orgId: string): Promise<void> {
    throw new Error('not implemented');
  }

  /** Sliding one-minute window per organization in this process, 30 live reads (O29). */
  liveReadAllowed(_orgId: string): boolean {
    throw new Error('not implemented');
  }
}
