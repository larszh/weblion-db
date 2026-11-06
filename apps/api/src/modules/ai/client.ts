import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessageStreamParams, BetaTextBlockParam } from '@anthropic-ai/sdk/resources/beta/messages';
import type { FastifyBaseLogger } from 'fastify';
import { AI_FEATURE_EFFORT, hasRefusalFallback, type AiFeature, type AiModel } from '@weblion/shared';
import type { Env } from '../../config/env';
import { sha256 } from '../../lib/crypto';
import { demoFetch } from './demo';
import type { ResolvedAiKey } from './settings';

/**
 * The SDK client and the request parameters every call of the module shares (ai 6.1, 6.2). Every call goes
 * through client.beta.messages.stream(...) and finalMessage(): the beta namespace because `betas` and
 * `fallbacks` live there, streaming because answers with adaptive thinking can be long.
 */

const DEMO_BASE_URL = 'http://claude-demo.invalid';
const DEMO_KEY = 'sk-ant-demo-0000000000000000';

export function createAnthropic(env: Env, key: ResolvedAiKey, log: FastifyBaseLogger): Anthropic {
  return new Anthropic({
    // Always explicit: the SDK must never pick up ANTHROPIC_AUTH_TOKEN, a CLI profile or federation
    // variables from the server's environment, and the saved key must win over ANTHROPIC_API_KEY (ai 5.2).
    apiKey: key.demo ? DEMO_KEY : key.key,
    authToken: null,
    baseURL: key.demo ? DEMO_BASE_URL : env.ANTHROPIC_BASE_URL,
    maxRetries: env.ANTHROPIC_MAX_RETRIES,
    timeout: env.AI_TURN_TIMEOUT_SECONDS * 1000,
    fetch: key.demo ? demoFetch : undefined,
    // 'warn' at most: debug logging of the SDK would print request bodies with customer data.
    logger: log.child({ module: 'anthropic' }),
    logLevel: 'warn',
    // No spans: an OTel setup of the host (or ANTHROPIC_OPEN_TELEMETRY_* variables) must never record prompts
    // or answers; the console stores none (ai 1.2).
    openTelemetry: false,
  });
}

export const AI_FEATURE_MAX_TOKENS: Record<AiFeature, number> = {
  assistant: 32_000, // per API call of a turn
  explain: 8_000,
  dns_check: 16_000,
  audit_summary: 16_000,
  server_health: 16_000,
  product_texts: 8_000,
  translations: 32_000, // plan O8
};

/** Typical output tokens incl. adaptive thinking, only for estimates (ai 7.1). */
export const AI_FEATURE_EXPECTED_OUTPUT: Record<AiFeature, number> = {
  assistant: 2_000,
  explain: 1_200,
  dns_check: 3_000,
  audit_summary: 2_500,
  server_health: 2_500,
  product_texts: 1_500,
  translations: 3_500,
};

/** Retry room of structured() after max_tokens (ai 6.6). */
export const AI_MAX_TOKENS_CEILING = 64_000;

export const REFUSAL_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

type BaseParams = Pick<
  BetaMessageStreamParams,
  'model' | 'max_tokens' | 'thinking' | 'output_config' | 'metadata' | 'betas' | 'fallbacks'
>;

/**
 * The fixed part of every request: the exact model id, adaptive thinking (the only accepted on-mode of these
 * models), the effort of the feature (fixed so the cache stays warm, plan decision 30), an opaque user id for
 * Anthropic's abuse detection, and the server-side refusal fallback on Opus and Sonnet (Haiku has none). Never
 * sampling parameters, budget_tokens or a disabled thinking mode: these models reject them.
 */
export function baseParams(model: AiModel, feature: AiFeature, userId: string | null): BaseParams {
  return {
    model, // exact id from AI_MODELS, never an alias or a dated id
    max_tokens: AI_FEATURE_MAX_TOKENS[feature],
    thinking: { type: 'adaptive' },
    output_config: { effort: AI_FEATURE_EFFORT[feature] },
    // Opaque and stable, no personal data: lets Anthropic tell end users apart for abuse detection.
    metadata: { user_id: userId ? sha256(`weblion-ai-user:${userId}`).slice(0, 32) : null },
    ...(hasRefusalFallback(model) ? { betas: [REFUSAL_FALLBACK_BETA], fallbacks: 'default' as const } : {}),
  };
}

/** The fixed system prompt of a feature with the cache breakpoint (caches tools + system). */
export function systemBlocks(text: string): BetaTextBlockParam[] {
  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];
}
