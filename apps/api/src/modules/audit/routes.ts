import { and, count, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuditEntryDto, Paginated } from '@weblion/shared';
import type { AppContext } from '../../context';
import { orgScope, platformScope } from '../../auth/access';
import { auditLogs, organizations } from '../../db/schema';
import { paginationQuery, parse } from '../../lib/validation';
import { loadOrg } from '../orgs/routes';

const auditQuery = paginationQuery.extend({
  action: z.string().max(100).optional(),
  resourceType: z.string().max(50).optional(),
  resourceId: z.string().max(100).optional(),
  status: z.enum(['success', 'failure', 'denied']).optional(),
  q: z.string().max(100).optional(),
});

export async function queryAudit(
  ctx: AppContext,
  query: z.infer<typeof auditQuery>,
  orgId: string | null,
): Promise<Paginated<AuditEntryDto>> {
  const filters: (SQL | undefined)[] = [
    orgId ? eq(auditLogs.orgId, orgId) : undefined,
    query.action ? ilike(auditLogs.action, `${query.action.replace(/[%_]/g, '')}%`) : undefined,
    query.resourceType ? eq(auditLogs.resourceType, query.resourceType) : undefined,
    query.resourceId ? eq(auditLogs.resourceId, query.resourceId) : undefined,
    query.status ? eq(auditLogs.status, query.status) : undefined,
    query.q
      ? or(
          ilike(auditLogs.actorName, `%${query.q.replace(/[%_]/g, '')}%`),
          ilike(auditLogs.action, `%${query.q.replace(/[%_]/g, '')}%`),
          ilike(auditLogs.ip, `%${query.q.replace(/[%_]/g, '')}%`),
        )
      : undefined,
  ];
  const where = and(...filters);
  const [rows, total] = await Promise.all([
    ctx.db
      .select({ log: auditLogs, orgName: organizations.name })
      .from(auditLogs)
      .leftJoin(organizations, eq(organizations.id, auditLogs.orgId))
      .where(where)
      .orderBy(sql`${auditLogs.createdAt} desc, ${auditLogs.id} desc`)
      .limit(query.perPage)
      .offset((query.page - 1) * query.perPage),
    ctx.db.select({ n: count() }).from(auditLogs).where(where),
  ]);
  return {
    total: total[0]?.n ?? 0,
    page: query.page,
    perPage: query.perPage,
    items: rows.map(({ log, orgName }) => ({
      id: String(log.id),
      createdAt: log.createdAt.toISOString(),
      actor: {
        type: log.actorTokenId ? 'token' : log.actorUserId || log.actorName ? 'user' : 'system',
        id: log.actorUserId,
        name: log.actorName,
      },
      org: log.orgId ? { id: log.orgId, name: orgName ?? '' } : null,
      action: log.action,
      resourceType: log.resourceType,
      resourceId: log.resourceId,
      status: log.status,
      ip: log.ip,
      details: log.details,
    })),
  };
}

export async function auditRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/orgs/:orgId/audit', async (req) => {
    const { orgId } = parse(z.object({ orgId: z.uuid() }), req.params);
    await loadOrg(ctx, req, orgId);
    await ctx.access.assert(req, 'audit:read', orgScope(orgId));
    return queryAudit(ctx, parse(auditQuery, req.query), orgId);
  });

  app.get('/admin/audit', async (req) => {
    await ctx.access.assert(req, 'platform:audit:read', platformScope);
    return queryAudit(ctx, parse(auditQuery, req.query), null);
  });
}
