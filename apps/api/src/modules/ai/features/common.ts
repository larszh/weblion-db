import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { AiPageRef, AiResultMeta, AiUsageScope, Locale } from '@weblion/shared';
import type { AppContext } from '../../../context';
import { contextBlock, todayZurich, type RequestContext } from '../context-block';
import { SYSTEM_TEXT } from '../prompts';
import type { FeatureWithPrompt } from '../prompts';

/**
 * What every JSON feature shares (ai 10): one structured() call with the feature's fixed system prompt, a user
 * turn that starts with the <context> block and carries third-party data in escaped blocks, and the request's
 * scope (staff requests carry the customer's org_id, plan O28).
 */

export interface FeatureRun {
  ctx: AppContext;
  req: FastifyRequest;
  scope: AiUsageScope;
  /** The organization the data belongs to; null for platform requests. */
  orgId: string | null;
  userId: string;
  context: Omit<RequestContext, 'language'>;
  locale: Locale;
}

/** The <context> block and the parts of a feature's user turn, joined by blank lines. */
export function userTurn(run: FeatureRun, page: AiPageRef | null, ...parts: string[]): string {
  return [contextBlock({ ...run.context, language: run.locale }, page, todayZurich()), ...parts].join('\n\n');
}

export async function callFeature<T>(
  run: FeatureRun,
  feature: Exclude<FeatureWithPrompt, 'assistant'>,
  user: string,
  schema: z.ZodType<T>,
): Promise<{ data: T; meta: AiResultMeta }> {
  const result = await run.ctx.ai.structured({
    feature,
    scope: run.scope,
    orgId: run.orgId,
    countsForUser: true,
    actor: { userId: run.userId },
    system: SYSTEM_TEXT[feature],
    user,
    schema,
  });
  return { data: result.data, meta: result.meta };
}

/** A console path a link may point to (ai 11.3); the same rule as isConsolePath in the web. */
export function isConsolePath(path: string): boolean {
  return (
    path.length <= 300 &&
    !path.includes('//') &&
    !path.includes('\\') &&
    /^\/(o|admin)(\/[A-Za-z0-9._~%-]+)*\/?(\?[A-Za-z0-9._~%&=-]*)?$/.test(path)
  );
}
