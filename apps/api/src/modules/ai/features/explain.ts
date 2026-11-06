import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AiExplainResult, AiExplainSource, AiPageRef, AuditEntryDto } from '@weblion/shared';
import { auditLogs, mailLog, providerConnections } from '../../../db/schema';
import { notFound } from '../../../lib/errors';
import { orgsNamedByAuditEntry } from '../org-state';
import { thirdParty, type ThirdPartyKind } from '../prompts';
import type { ConsoleReader } from '../reader';
import { callFeature, isConsolePath, userTurn, type FeatureRun } from './common';

/**
 * Explain one error, failed action or log entry (ai 10.1). The item is read by the person's own routes (or, for
 * an audit row, the one direct table read of the module, filtered by organization like the route) and sent as
 * third-party data; personal fields of audit and mail log entries are removed (plan O28).
 */

export const explainOutput = z.object({
  summary: z.string(),
  cause: z.string(),
  steps: z.array(z.string()),
  links: z.array(z.object({ label: z.string(), path: z.string() })),
  severity: z.enum(['info', 'warning', 'error']),
});

const pageRef = z.object({
  path: z
    .string()
    .max(300)
    .regex(/^\/(o|admin)(\/[^\s]*)?$/),
  title: z.string().max(200).nullable(),
});
/** Audit ids are bigserial; 15 digits stay exact as a JavaScript number. */
const auditId = z.string().regex(/^\d{1,15}$/);

/** The browser's ApiError: message at most 2,000 characters, details at most 4,000 as JSON (ai 10.1). */
const errorSource = z.object({
  kind: z.literal('error'),
  error: z.object({
    status: z.number().int().min(0).max(999),
    code: z.string().max(100),
    message: z.string().max(2_000),
    details: z
      .unknown()
      .optional()
      .refine((d) => d === undefined || (JSON.stringify(d) ?? '').length <= 4_000, 'details too long'),
  }),
  page: pageRef,
});

export const orgExplainSource = z.discriminatedUnion('kind', [
  errorSource,
  z.object({ kind: z.literal('audit'), auditId }),
  z.object({ kind: z.literal('server_action'), serverId: z.uuid(), actionId: z.uuid() }),
  z.object({ kind: z.literal('monitor'), monitorId: z.uuid() }),
  z.object({ kind: z.literal('website'), websiteId: z.uuid() }),
]);
export const adminExplainSource = z.discriminatedUnion('kind', [
  errorSource,
  z.object({ kind: z.literal('audit'), auditId }),
  z.object({ kind: z.literal('provider'), providerId: z.uuid() }),
  z.object({ kind: z.literal('mail_log'), mailLogId: z.uuid() }),
]);

/** An audit row as the audit API maps it (modules/audit/routes.ts), without the IP. */
function auditDto(row: typeof auditLogs.$inferSelect): Omit<AuditEntryDto, 'ip' | 'org'> {
  return {
    id: String(row.id),
    createdAt: row.createdAt.toISOString(),
    actor: {
      type: row.actorTokenId ? 'token' : row.actorUserId || row.actorName ? 'user' : 'system',
      id: row.actorUserId,
      name: row.actorName,
    },
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    status: row.status,
    details: row.details,
  };
}

interface Item {
  kind: ThirdPartyKind;
  value: unknown;
  personal: boolean;
  page: AiPageRef | null;
}

async function finish(run: FeatureRun, item: Item): Promise<AiExplainResult> {
  const user = userTurn(
    run,
    item.page,
    'Explain this item to the person.',
    thirdParty(item.kind, item.value, { personal: item.personal }),
  );
  const { data, meta } = await callFeature(run, 'explain', user, explainOutput);
  return {
    summary: data.summary,
    cause: data.cause,
    steps: data.steps.slice(0, 5),
    // Only console paths are links (ai 11.3); anything else is dropped.
    links: data.links.filter((l) => isConsolePath(l.path)).slice(0, 5),
    severity: data.severity,
    meta,
  };
}

function errorItem(source: Extract<AiExplainSource, { kind: 'error' }>): Item {
  return { kind: 'error', value: source.error, personal: true, page: source.page };
}

/** POST /orgs/:orgId/ai/explain: error, audit, server_action, monitor, website (ai 10.1). */
export async function explainForOrg(
  run: FeatureRun & { orgId: string },
  reader: ConsoleReader,
  source: z.infer<typeof orgExplainSource>,
): Promise<AiExplainResult> {
  const { ctx, req } = run;
  switch (source.kind) {
    case 'error':
      return finish(run, errorItem(source));
    case 'audit': {
      await ctx.access.assert(req, 'audit:read', { orgId: run.orgId, resource: { path: 'org' } });
      const [row] = await ctx.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.id, Number(source.auditId)), eq(auditLogs.orgId, run.orgId)));
      if (!row) throw notFound('Audit entry');
      // Blocked-customer filter on the single row too (plan R2, review #4): a reseller's entry about a customer
      // whose AI is off must not reach the model.
      for (const named of new Set(orgsNamedByAuditEntry(row))) {
        if (named !== run.orgId) await ctx.ai.assertOrgData(named).catch(rethrowUnlessMissing);
      }
      return finish(run, { kind: 'audit_entry', value: auditDto(row), personal: true, page: null });
    }
    case 'server_action': {
      const server = await reader.owned('server', source.serverId);
      if (!server.ok) throw notFound('Server');
      const tasks = await reader.sub<{ actions?: Array<{ id: string }> }>('server', source.serverId, 'tasks');
      const action = tasks.ok ? tasks.body.actions?.find((a) => a.id === source.actionId) : undefined;
      if (!action) throw notFound('Server action');
      const name = (server.body as { name?: string }).name ?? null;
      return finish(run, {
        kind: 'server_action',
        value: { server: name, action },
        personal: true,
        page: null,
      });
    }
    case 'monitor': {
      const monitor = await reader.owned('monitor', source.monitorId);
      if (!monitor.ok) throw notFound('Monitor');
      return finish(run, { kind: 'monitor', value: monitor.body, personal: false, page: null });
    }
    case 'website': {
      const site = await reader.owned('website', source.websiteId);
      if (!site.ok) throw notFound('Website');
      return finish(run, { kind: 'website', value: site.body, personal: false, page: null });
    }
  }
}

/** POST /admin/ai/explain: error, audit, provider, mail_log (ai 10.1). Permissions are checked by the route. */
export async function explainForAdmin(
  run: FeatureRun,
  source: z.infer<typeof adminExplainSource>,
): Promise<AiExplainResult> {
  const { ctx } = run;
  switch (source.kind) {
    case 'error':
      return finish({ ...run, scope: 'platform', orgId: null }, errorItem(source));
    case 'audit': {
      const [row] = await ctx.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.id, Number(source.auditId)));
      if (!row) throw notFound('Audit entry');
      // Every organization the entry is about must have AI on (plan 8.4 scenario 2a).
      const orgs = [...new Set([...(row.orgId ? [row.orgId] : []), ...orgsNamedByAuditEntry(row)])];
      for (const orgId of orgs) await ctx.ai.assertOrgData(orgId).catch(rethrowUnlessMissing);
      return finish(
        { ...run, scope: row.orgId ? 'staff' : 'platform', orgId: row.orgId },
        { kind: 'audit_entry', value: { ...auditDto(row), orgId: row.orgId }, personal: true, page: null },
      );
    }
    case 'provider': {
      const [row] = await ctx.db
        .select({
          type: providerConnections.type,
          name: providerConnections.name,
          status: providerConnections.status,
          lastError: providerConnections.lastError,
          lastSyncAt: providerConnections.lastSyncAt,
        })
        .from(providerConnections)
        .where(eq(providerConnections.id, source.providerId));
      if (!row) throw notFound('Provider connection');
      return finish(
        { ...run, scope: 'platform', orgId: null },
        { kind: 'provider', value: row, personal: false, page: null },
      );
    }
    case 'mail_log': {
      const [row] = await ctx.db
        .select({
          template: mailLog.template,
          status: mailLog.status,
          error: mailLog.error,
          createdAt: mailLog.createdAt,
          orgId: mailLog.orgId,
        })
        .from(mailLog)
        .where(eq(mailLog.id, source.mailLogId));
      if (!row) throw notFound('Mail log entry');
      if (row.orgId) await ctx.ai.assertOrgData(row.orgId).catch(rethrowUnlessMissing);
      return finish(
        { ...run, scope: row.orgId ? 'staff' : 'platform', orgId: row.orgId },
        {
          kind: 'mail_log',
          // The recipient is never sent (plan O28).
          value: {
            template: row.template,
            status: row.status,
            error: row.error,
            createdAt: row.createdAt,
            to: '[email]',
          },
          personal: true,
          page: null,
        },
      );
    }
  }
}

/** An organization named by an entry may be gone since; only a switched-off one stops the request. */
function rethrowUnlessMissing(err: unknown): void {
  if ((err as { code?: string })?.code === 'not_found') return;
  throw err;
}
