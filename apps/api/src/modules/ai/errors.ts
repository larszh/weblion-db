import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type {
  AiBusyReason,
  AiErrorCode,
  AiLimitKind,
  AiOrgOffReason,
  AiUnavailableReason,
  AiUpstreamReason,
} from '@weblion/shared';
import { AppError } from '../../lib/errors';
import type { StructuredUsage } from './service';

/**
 * Errors of the AI module (ai 4.2, plan 2.10). Every message is a fixed English text: Anthropic's own error
 * text can reveal the state of weblion's account (credit, limits, workspace) and is only kept, redacted, in
 * ai_usage.error_message for the staff errors tab.
 */

export const AI_LIMIT_MESSAGES: Record<AiLimitKind, string> = {
  budget: 'The monthly AI budget is used up. AI features are available again next month.',
  org_daily: 'This organization reached its daily limit of AI requests.',
  user_daily: 'You reached your daily limit of AI requests.',
  user_rate: 'Too many AI requests in a short time. Please wait a minute.',
  user_concurrent: 'You already have two AI requests running. Please wait until one is finished.',
  org_concurrent: 'This organization already has three AI requests running. Please try again shortly.',
  concurrent: 'Too many AI requests are running at the moment. Please try again shortly.',
};

export const AI_ERROR_MESSAGES: Record<Exclude<AiErrorCode, 'ai_limit'>, string> = {
  ai_refusal: 'Claude declined to answer this request.',
  ai_upstream: 'The AI service could not process the request.',
  ai_incomplete: 'The AI answer was cut off. Please try again with a shorter request.',
  ai_busy: 'The AI service is busy. Please try again in a moment.',
  ai_timeout: 'The AI answer took too long.',
  ai_org_disabled: 'AI features are switched off for this organization.',
  ai_platform_locked: 'weblion switched AI off for this customer. Only weblion staff can switch it on again.',
  ai_reseller_blocked:
    'AI is switched off for your own organization, so it cannot be switched on for a customer.',
  ai_admin_key: 'This is an Admin API key. Save a normal API key from the Claude Console.',
  ai_not_configured: 'AI is not available. Set it up under Administration > AI.',
};

export function aiLimit(
  limit: AiLimitKind,
  extra: { retryAfterSeconds?: number | null; resetsAt?: string | null } = {},
): AppError {
  return new AppError(429, 'ai_limit', AI_LIMIT_MESSAGES[limit], {
    limit,
    retryAfterSeconds: extra.retryAfterSeconds ?? null,
    resetsAt: extra.resetsAt ?? null,
  });
}

export function aiRefusal(category: string | null): AppError {
  return new AppError(422, 'ai_refusal', AI_ERROR_MESSAGES.ai_refusal, { category });
}

export function aiUpstream(reason: AiUpstreamReason): AppError {
  return new AppError(502, 'ai_upstream', AI_ERROR_MESSAGES.ai_upstream, { reason });
}

export function aiIncomplete(): AppError {
  return new AppError(502, 'ai_incomplete', AI_ERROR_MESSAGES.ai_incomplete);
}

export function aiBusy(reason: AiBusyReason, retryAfterSeconds: number | null = null): AppError {
  return new AppError(503, 'ai_busy', AI_ERROR_MESSAGES.ai_busy, { reason, retryAfterSeconds });
}

export function aiTimeout(): AppError {
  return new AppError(504, 'ai_timeout', AI_ERROR_MESSAGES.ai_timeout);
}

export function aiOrgDisabled(reasons: AiOrgOffReason[]): AppError {
  return new AppError(403, 'ai_org_disabled', AI_ERROR_MESSAGES.ai_org_disabled, { reasons });
}

export function aiPlatformLocked(): AppError {
  return new AppError(409, 'ai_platform_locked', AI_ERROR_MESSAGES.ai_platform_locked);
}

export function aiResellerBlocked(): AppError {
  return new AppError(409, 'ai_reseller_blocked', AI_ERROR_MESSAGES.ai_reseller_blocked);
}

export function aiAdminKey(): AppError {
  return new AppError(400, 'ai_admin_key', AI_ERROR_MESSAGES.ai_admin_key);
}

/** Used by the i18n AI routes (plan O5, O10): 409 with details.reason. */
export function aiNotConfigured(reason: AiUnavailableReason): AppError {
  return new AppError(409, 'ai_not_configured', AI_ERROR_MESSAGES.ai_not_configured, { reason });
}

/** The caller's signal aborted (client gone, job cancelled or stopped); never sent to a client. */
export class AiCancelled extends Error {
  constructor(message = 'AI request cancelled') {
    super(message);
    this.name = 'AiCancelled';
  }
}

/** Seconds of a Retry-After header, null when missing or not a number of seconds. */
export function retryAfterSeconds(headers: Headers | undefined | null): number | null {
  const raw = headers?.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : null;
}

/**
 * Maps whatever a Claude call threw to the module's errors (ai 6.8). Typed SDK errors, most specific first
 * (subclasses before their parents, as src/core/error.ts of the SDK defines them); never string matching on
 * messages. Anything that is not an SDK, JSON or schema error is a bug of ours and is rethrown (500).
 */
export function classifyAiError(err: unknown, run: { timedOut: boolean }): AppError | AiCancelled {
  if (err instanceof AppError || err instanceof AiCancelled) return err;
  if (err instanceof Anthropic.APIUserAbortError) return run.timedOut ? aiTimeout() : new AiCancelled();
  if (err instanceof Anthropic.APIConnectionTimeoutError) return aiTimeout();
  if (err instanceof Anthropic.APIConnectionError) return aiUpstream('network');
  if (err instanceof Anthropic.AuthenticationError) return aiUpstream('auth'); // 401
  if (err instanceof Anthropic.PermissionDeniedError) return aiUpstream('permission'); // 403
  if (err instanceof Anthropic.NotFoundError) return aiUpstream('not_found'); // 404
  if (err instanceof Anthropic.RateLimitError) return aiBusy('rate_limit', retryAfterSeconds(err.headers)); // 429
  if (err instanceof Anthropic.BadRequestError) return aiUpstream('request'); // 400
  if (err instanceof Anthropic.InternalServerError) {
    // 5xx; 529 is Anthropic's "overloaded".
    return err.status === 529 || err.type === 'overloaded_error'
      ? aiBusy('overloaded', retryAfterSeconds(err.headers))
      : aiUpstream('server');
  }
  if (err instanceof Anthropic.APIError) {
    // status undefined: an `event: error` frame in the middle of a stream. The SDK throws
    // new APIError(undefined, body, undefined, headers, type) there (src/core/streaming.ts), so only
    // err.type tells what happened.
    switch (err.type) {
      case 'overloaded_error':
        return aiBusy('overloaded');
      case 'rate_limit_error':
        return aiBusy('rate_limit');
      case 'timeout_error':
        return aiTimeout();
      case 'billing_error':
        return aiUpstream('billing');
      case 'authentication_error':
        return aiUpstream('auth');
      case 'permission_error':
        return aiUpstream('permission');
      case 'not_found_error':
        return aiUpstream('not_found');
      case 'invalid_request_error':
        return aiUpstream('request');
    }
    if (err.status === 402) return aiUpstream('billing'); // no own class in the SDK
    if (err.status === 413 || err.status === 409 || err.status === 422) return aiUpstream('request');
    return aiUpstream('server'); // api_error and anything else
  }
  // A stream that ended without message_stop, or a connection that broke while the body was read: the SDK
  // reports both as a plain AnthropicError (not an APIError).
  if (err instanceof Anthropic.AnthropicError) return aiUpstream('network');
  if (err instanceof SyntaxError || err instanceof z.ZodError) return aiUpstream('output');
  throw err;
}

const usageOfErrors = new WeakMap<object, StructuredUsage>();

/** Attaches the usage of the request to an error thrown after its reservation (structured(), plan 2.4). */
export function attachUsage<E extends object>(err: E, usage: StructuredUsage): E {
  usageOfErrors.set(err, usage);
  return err;
}

/** The StructuredUsage attached to an error thrown by structured(), else null. */
export function usageOfError(err: unknown): StructuredUsage | null {
  return err !== null && typeof err === 'object' ? (usageOfErrors.get(err) ?? null) : null;
}
