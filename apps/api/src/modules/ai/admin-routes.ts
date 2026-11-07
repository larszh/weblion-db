import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AI_FEATURES,
  LOCALES,
  type AiAuditSummaryResult,
  type AiErrorDto,
  type AiExplainResult,
  type AiFeature,
  type AiProductTextsResult,
  type AiUsageReportDto,
  type Paginated,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import { platformScope, requireSession } from '../../auth/access';
import { badRequest } from '../../lib/errors';
import { parse } from '../../lib/validation';
import { adminAuditSummary, auditFilters } from './features/audit-summary';
import type { FeatureRun } from './features/common';
import { adminExplainSource, explainForAdmin } from './features/explain';
import { productTextsBody, runProductTexts } from './features/product-texts';
import { adminContext } from './gates';
import { currentMonth, ERROR_STATUSES, errorsPage, monthsBetween, usageReport } from './report';

/**
 * The staff part of the AI module (ai 5.4, 10): the usage and errors tabs of the KI page (platform:settings, work
 * while AI is off) and the admin features (platform:ai:use plus the permission of the data source). Every admin
 * feature that reads an organization's data asks assertOrgData first, so a customer's decline wins over staff;
 * those requests carry the customer's org_id (scope 'staff', plan O28).
 */

const locale = z.enum(LOCALES);
const usageQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
});
const errorsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(50),
  feature: z.enum(AI_FEATURES).optional(),
  status: z.enum(ERROR_STATUSES).optional(),
  source: z.enum(['api', 'internal']).optional(),
});
const explainBody = z.object({ source: adminExplainSource, locale });
const auditSummaryBody = z.object({ ...auditFilters, orgId: z.uuid().nullable(), locale });

/** How far back the usage report goes: the current and the 12 previous months (ai 12.2). */
const USAGE_MONTHS_BACK = 12;

export async function aiAdminRoutes(app: FastifyInstance, ctx: AppContext) {
  const { access } = ctx;

  app.get('/admin/ai/usage', async (req): Promise<AiUsageReportDto> => {
    requireSession(req);
    await access.assert(req, 'platform:settings', platformScope);
    const { month: asked } = parse(usageQuery, req.query);
    const month = asked ?? currentMonth();
    const back = monthsBetween(currentMonth(), month);
    if (back < 0 || back > USAGE_MONTHS_BACK) {
      throw badRequest('Validation failed', [{ path: 'month', message: 'at most 12 months back' }]);
    }
    return usageReport(ctx.db, ctx.env, await ctx.ai.settings(), month);
  });

  app.get('/admin/ai/errors', async (req): Promise<Paginated<AiErrorDto>> => {
    requireSession(req);
    await access.assert(req, 'platform:settings', platformScope);
    return errorsPage(ctx.db, parse(errorsQuery, req.query));
  });

  /** session, body, availability, platform:ai:use; the run of a platform request. */
  async function prepare<T extends z.ZodType>(req: FastifyRequest, feature: AiFeature, schema: T) {
    const auth = requireSession(req);
    const body = parse(schema, req.body) as z.infer<T>;
    await ctx.ai.assertFeature(feature);
    await access.assert(req, 'platform:ai:use', platformScope);
    const run: FeatureRun = {
      ctx,
      req,
      scope: 'platform',
      orgId: null,
      userId: auth.user.id,
      context: adminContext(req),
      locale: (body as { locale: (typeof LOCALES)[number] }).locale,
    };
    return { body, run };
  }

  app.post('/admin/ai/explain', async (req): Promise<AiExplainResult> => {
    const { body, run } = await prepare(req, 'explain', explainBody);
    // The permission of the data source (ai 10.1): the same as the page that shows it.
    if (body.source.kind === 'audit') await access.assert(req, 'platform:audit:read', platformScope);
    if (body.source.kind === 'provider') await access.assert(req, 'platform:provider:read', platformScope);
    if (body.source.kind === 'mail_log') await access.assert(req, 'platform:settings', platformScope);
    return explainForAdmin(run, body.source);
  });

  app.post('/admin/ai/audit-summary', async (req): Promise<AiAuditSummaryResult> => {
    const { body, run } = await prepare(req, 'audit_summary', auditSummaryBody);
    await access.assert(req, 'platform:audit:read', platformScope);
    if (body.orgId) await ctx.ai.assertOrgData(body.orgId);
    return adminAuditSummary(
      body.orgId ? { ...run, scope: 'staff', orgId: body.orgId } : run,
      body,
      body.orgId,
    );
  });

  app.post('/admin/ai/product-texts', async (req): Promise<AiProductTextsResult> => {
    const { body, run } = await prepare(req, 'product_texts', productTextsBody);
    await access.assert(req, 'platform:billing:write', platformScope);
    if (body.mode === 'translate' && body.locales.every((l) => l === 'de')) {
      throw badRequest('Choose at least one target language');
    }
    return runProductTexts(run, body);
  });
}
