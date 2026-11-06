import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  LOCALES,
  type AiAuditSummaryResult,
  type AiDnsCheckResult,
  type AiExplainResult,
  type AiFeature,
  type AiProductTextsResult,
  type AiServerHealthResult,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import { orgScope, requireSession } from '../../auth/access';
import type { Organization } from '../../db/schema';
import { badRequest, notFound } from '../../lib/errors';
import { parse } from '../../lib/validation';
import { loadOrg } from '../orgs/routes';
import { auditFilters, orgAuditSummary } from './features/audit-summary';
import type { FeatureRun } from './features/common';
import { runDnsCheck } from './features/dns-check';
import { explainForOrg, orgExplainSource } from './features/explain';
import { productTextsBody, runProductTexts } from './features/product-texts';
import { runServerHealth } from './features/server-health';
import { aiRequestGate } from './gates';
import { ConsoleReader } from './reader';

/**
 * The AI features of an organization (ai 10): read only, one structured() call each. Order of the checks
 * (plan 4.2): session, body, organization (404), availability (404 while AI or the feature is off), the AI gate
 * of ai 9.1 (organization state, ai:use; staff: platform:ai:use and the customer's state), the feature's own
 * permission, then the reservation inside structured(). Every resource is read through the person's own routes
 * by the ConsoleReader, which checks that it belongs to this organization.
 */

const orgParams = z.object({ orgId: z.uuid() });
const locale = z.enum(LOCALES);

const explainBody = z.object({ source: orgExplainSource, locale });
const dnsCheckBody = z
  .object({ domainId: z.uuid().nullable(), mailDomainId: z.uuid().nullable(), locale })
  .refine((b) => !!b.domainId !== !!b.mailDomainId, 'exactly one of domainId and mailDomainId');
const auditSummaryBody = z.object({ ...auditFilters, locale });
const serverHealthBody = z.object({ serverId: z.uuid(), range: z.enum(['day', 'week']), locale });

export async function aiFeatureRoutes(app: FastifyInstance, ctx: AppContext) {
  /** The common part of every route up to the feature's own permission. */
  async function prepare<T extends z.ZodType>(
    req: FastifyRequest,
    feature: AiFeature,
    schema: T,
  ): Promise<{
    org: Organization;
    body: z.infer<T>;
    run: FeatureRun & { orgId: string };
    reader: ConsoleReader;
  }> {
    requireSession(req);
    const body = parse(schema, req.body) as z.infer<T>;
    const { orgId } = parse(orgParams, req.params);
    const org = await loadOrg(ctx, req, orgId);
    await ctx.ai.assertFeature(feature);
    const gate = await aiRequestGate(ctx, req, org);
    const run = {
      ctx,
      req,
      scope: gate.scope,
      orgId: org.id,
      userId: gate.userId,
      context: gate.context,
      locale: (body as { locale: (typeof LOCALES)[number] }).locale,
    };
    const reader = new ConsoleReader(
      ctx.ai.attachedApp(),
      req,
      org.id,
      AbortSignal.timeout(ctx.env.AI_TURN_TIMEOUT_SECONDS * 1000),
      // Live provider reads count against the organization's 30 per minute (ai 7.1).
      { liveGuard: () => ctx.ai.liveReadAllowed(org.id) },
    );
    return { org, body, run, reader };
  }

  app.post('/orgs/:orgId/ai/explain', async (req): Promise<AiExplainResult> => {
    const { body, run, reader } = await prepare(req, 'explain', explainBody);
    return explainForOrg(run, reader, body.source);
  });

  app.post('/orgs/:orgId/ai/dns-check', async (req): Promise<AiDnsCheckResult> => {
    const { body, run, reader } = await prepare(req, 'dns_check', dnsCheckBody);
    // domain:read or mail:read are checked by the routes the reader calls.
    return runDnsCheck(
      run,
      reader,
      body.domainId ? { domainId: body.domainId } : { mailDomainId: body.mailDomainId! },
    );
  });

  app.post('/orgs/:orgId/ai/audit-summary', async (req): Promise<AiAuditSummaryResult> => {
    const { body, run, reader, org } = await prepare(req, 'audit_summary', auditSummaryBody);
    await ctx.access.assert(req, 'audit:read', orgScope(org.id));
    return orgAuditSummary(run, reader, body);
  });

  app.post('/orgs/:orgId/ai/server-health', async (req): Promise<AiServerHealthResult> => {
    const { body, run, reader } = await prepare(req, 'server_health', serverHealthBody);
    return runServerHealth(run, reader, body);
  });

  app.post('/orgs/:orgId/ai/product-texts', async (req): Promise<AiProductTextsResult> => {
    const { body, run, org } = await prepare(req, 'product_texts', productTextsBody);
    // Resellers write the texts of their own products (reseller:billing); other organizations have none.
    if (org.kind !== 'reseller') throw notFound('Reseller');
    await ctx.access.assert(req, 'reseller:billing', orgScope(org.id));
    if (body.mode === 'translate' && body.locales.every((l) => l === 'de')) {
      throw badRequest('Choose at least one target language');
    }
    return runProductTexts(run, body);
  });
}
