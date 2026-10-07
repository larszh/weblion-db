import { and, eq, ilike, isNotNull, isNull, or, type SQL } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  normalizeModules,
  type DnsRecord,
  type DomainDetailDto,
  type DomainInfo,
  type ModuleKey,
  type Permission,
  type WebspaceDetailDto,
  type WebspaceInfo,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import { platformScope, requireSession } from '../../auth/access';
import { domains, organizations, webspaces, type Organization } from '../../db/schema';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { parse } from '../../lib/validation';
import { loadOrg } from '../orgs/routes';
import { dnsDataIssue, dnsRecordBody, dnsRecordPatchBody } from './dns';
import {
  HOSTING_MODULES,
  dnsWritable,
  domainRowsQuery,
  domainScope,
  loadDomain,
  loadWebspace,
  requireSupport,
  toDomainDto,
  toWebspaceDto,
  webspaceRowsQuery,
  webspaceScope,
  type LoadedDomain,
  type LoadedWebspace,
} from './service';

const idParams = z.object({ id: z.uuid() });
const orgParams = z.object({ orgId: z.uuid() });
const recordParams = idParams.extend({ recordId: z.string().trim().min(1).max(100) });

const listQuery = z.object({ q: z.string().max(100).optional() });
const adminListQuery = z.object({
  q: z.string().max(100).optional(),
  assigned: z.enum(['true', 'false']).optional(),
  providerId: z.uuid().optional(),
  orgId: z.uuid().optional(),
});
const assignBody = z.object({ orgId: z.uuid().nullable(), enableModule: z.boolean().default(true) });

const like = (q: string) => `%${q.replace(/[%_]/g, '')}%`;
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Secrets must not end up in browser or proxy caches. */
function noStore(reply: FastifyReply) {
  reply.header('cache-control', 'no-store');
}

/** Domains/DNS and web spaces (customer views and admin inventory). */
export async function hostingRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, access, audit } = ctx;

  async function domain(req: FastifyRequest, permission?: Permission): Promise<LoadedDomain> {
    const { id } = parse(idParams, req.params);
    const loaded = await loadDomain(ctx, req, id);
    if (permission) await access.assert(req, permission, loaded.scope);
    return loaded;
  }

  async function webspace(req: FastifyRequest, permission?: Permission): Promise<LoadedWebspace> {
    const { id } = parse(idParams, req.params);
    const loaded = await loadWebspace(ctx, req, id);
    if (permission) await access.assert(req, permission, loaded.scope);
    return loaded;
  }

  /** Runs a DNS change at the provider and audits it, failures included. */
  async function dnsChange<T>(
    req: FastifyRequest,
    loaded: LoadedDomain,
    action: string,
    details: Record<string, unknown>,
    fn: () => Promise<T>,
  ): Promise<T> {
    const entry = {
      action: `domain.${action}`,
      orgId: loaded.domain.orgId,
      resourceType: 'domain',
      resourceId: loaded.domain.id,
    };
    try {
      const result = await fn();
      await audit.record(req, { ...entry, details: { domain: loaded.domain.name, ...details } });
      return result;
    } catch (err) {
      await audit.record(req, {
        ...entry,
        status: 'failure',
        details: { domain: loaded.domain.name, ...details, error: errorMessage(err) },
      });
      throw err instanceof AppError ? err : new AppError(500, 'action_failed', errorMessage(err));
    }
  }

  async function findRecord(loaded: LoadedDomain, recordId: string): Promise<DnsRecord> {
    const records = await loaded.adapter.listDnsRecords!(loaded.domain.externalId);
    const record = records.find((r) => r.id === recordId);
    if (!record) throw notFound('DNS record');
    return record;
  }

  // --- Domains --------------------------------------------------------------------

  app.get('/orgs/:orgId/domains', async (req) => {
    const { orgId } = parse(orgParams, req.params);
    await loadOrg(ctx, req, orgId);
    const query = parse(listQuery, req.query);
    const rows = await domainRowsQuery(ctx)
      .where(and(eq(domains.orgId, orgId), query.q ? ilike(domains.name, like(query.q)) : undefined))
      .orderBy(domains.name);
    const visible = [];
    for (const row of rows) {
      if (await access.can(req, 'domain:read', domainScope(row.domain)))
        visible.push(await toDomainDto(ctx, req, row));
    }
    return visible;
  });

  app.get('/domains/:id', async (req): Promise<DomainDetailDto> => {
    const loaded = await domain(req);
    let info: DomainInfo | null = loaded.domain.info;
    let liveError: string | null = null;
    if (loaded.adapter.getDomain) {
      try {
        const live = await loaded.adapter.getDomain(loaded.domain.externalId);
        // The provider's domain endpoint may not know the renewal setting, the sync does.
        info = { ...live, autoRenew: live.autoRenew ?? info?.autoRenew ?? null };
        await db
          .update(domains)
          .set({ info, status: info.status, lastSyncedAt: new Date() })
          .where(eq(domains.id, loaded.domain.id));
        loaded.domain = { ...loaded.domain, info, status: info.status };
      } catch (err) {
        req.log.warn({ err, domainId: loaded.domain.id }, 'live domain info failed');
        liveError = errorMessage(err);
      }
    }
    return {
      ...(await toDomainDto(ctx, req, loaded)),
      info,
      liveError,
      dnsWritable: await dnsWritable(loaded.adapter),
    };
  });

  app.get('/domains/:id/authcode', async (req, reply) => {
    const loaded = await domain(req);
    requireSession(req);
    await access.assert(req, 'domain:authcode', loaded.scope);
    requireSupport(loaded.adapter, 'getDomainAuthcode', 'auth codes');
    const authcode = await loaded.adapter.getDomainAuthcode!(loaded.domain.externalId);
    // Who looked at it is recorded, the code itself never is.
    await audit.record(req, {
      action: 'domain.authcode_view',
      orgId: loaded.domain.orgId,
      resourceType: 'domain',
      resourceId: loaded.domain.id,
      details: { domain: loaded.domain.name },
    });
    noStore(reply);
    return { authcode };
  });

  // --- DNS ------------------------------------------------------------------------

  app.get('/domains/:id/dns', async (req) => {
    const loaded = await domain(req);
    requireSupport(loaded.adapter, 'listDnsRecords', 'DNS records');
    return loaded.adapter.listDnsRecords!(loaded.domain.externalId);
  });

  app.post('/domains/:id/dns', async (req): Promise<DnsRecord> => {
    const loaded = await domain(req, 'domain:dns:write');
    requireSupport(loaded.adapter, 'addDnsRecord', 'DNS changes');
    const input = parse(dnsRecordBody, req.body);
    const record = await dnsChange(req, loaded, 'dns_add', { ...input }, () =>
      loaded.adapter.addDnsRecord!(loaded.domain.externalId, input),
    );
    // Providers that do not report the new record back: the client reloads the list.
    return record ?? { id: '', ...input, ttl: null };
  });

  app.patch('/domains/:id/dns/:recordId', async (req) => {
    const loaded = await domain(req, 'domain:dns:write');
    requireSupport(loaded.adapter, 'updateDnsRecord', 'DNS changes');
    const { recordId } = parse(recordParams, req.params);
    const patch = parse(dnsRecordPatchBody, req.body);
    const current = await findRecord(loaded, recordId);
    const type = patch.type ?? current.type;
    const data = patch.data ?? current.data;
    if (patch.type !== undefined || patch.data !== undefined) {
      const issue = dnsDataIssue(type, data);
      if (issue) throw badRequest('Validation failed', [{ path: 'data', message: issue }]);
    }
    const before = { type: current.type, name: current.name, data: current.data };
    const record = await dnsChange(req, loaded, 'dns_update', { recordId, before, ...patch }, () =>
      loaded.adapter.updateDnsRecord!(loaded.domain.externalId, recordId, patch),
    );
    return record ?? { ok: true };
  });

  app.delete('/domains/:id/dns/:recordId', async (req) => {
    const loaded = await domain(req, 'domain:dns:write');
    requireSupport(loaded.adapter, 'deleteDnsRecord', 'DNS changes');
    const { recordId } = parse(recordParams, req.params);
    const current = await findRecord(loaded, recordId);
    await dnsChange(
      req,
      loaded,
      'dns_delete',
      { recordId, type: current.type, name: current.name, data: current.data },
      () => loaded.adapter.deleteDnsRecord!(loaded.domain.externalId, recordId),
    );
    return { ok: true };
  });

  // --- Web spaces -----------------------------------------------------------------

  app.get('/orgs/:orgId/webspaces', async (req) => {
    const { orgId } = parse(orgParams, req.params);
    await loadOrg(ctx, req, orgId);
    const query = parse(listQuery, req.query);
    const rows = await webspaceRowsQuery(ctx)
      .where(and(eq(webspaces.orgId, orgId), query.q ? ilike(webspaces.name, like(query.q)) : undefined))
      .orderBy(webspaces.name);
    const visible = [];
    for (const row of rows) {
      if (await access.can(req, 'webspace:read', webspaceScope(row.webspace)))
        visible.push(await toWebspaceDto(ctx, req, row));
    }
    return visible;
  });

  app.get('/webspaces/:id', async (req): Promise<WebspaceDetailDto> => {
    const loaded = await webspace(req);
    let info: WebspaceInfo | null = loaded.webspace.info;
    let liveError: string | null = null;
    if (loaded.adapter.getWebspace) {
      try {
        info = await loaded.adapter.getWebspace(loaded.webspace.externalId);
        await db
          .update(webspaces)
          .set({ info, lastSyncedAt: new Date() })
          .where(eq(webspaces.id, loaded.webspace.id));
        loaded.webspace = { ...loaded.webspace, info };
      } catch (err) {
        req.log.warn({ err, webspaceId: loaded.webspace.id }, 'live web space info failed');
        liveError = errorMessage(err);
      }
    }
    return { ...(await toWebspaceDto(ctx, req, loaded)), info, liveError };
  });

  app.get('/webspaces/:id/credentials', async (req, reply) => {
    const loaded = await webspace(req);
    requireSession(req);
    await access.assert(req, 'webspace:credentials', loaded.scope);
    requireSupport(loaded.adapter, 'getWebspaceCredentials', 'login credentials');
    const credentials = await loaded.adapter.getWebspaceCredentials!(loaded.webspace.externalId);
    await audit.record(req, {
      action: 'webspace.credentials_view',
      orgId: loaded.webspace.orgId,
      resourceType: 'webspace',
      resourceId: loaded.webspace.id,
      details: { webspace: loaded.webspace.name },
    });
    noStore(reply);
    return credentials;
  });

  // --- Admin inventory ------------------------------------------------------------

  /**
   * Target organization of an assignment. With `enableModule` the module is activated for
   * it; a customer below a reseller can only get modules the reseller has itself.
   */
  async function assignTarget(
    orgId: string,
    module: ModuleKey,
    enableModule: boolean,
  ): Promise<{ org: Organization; enable: boolean }> {
    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
    if (!org) throw notFound('Organization');
    if (!enableModule) return { org, enable: false };
    if (org.parentOrgId) {
      const parent = await db.query.organizations.findFirst({
        where: eq(organizations.id, org.parentOrgId),
      });
      if (parent && !parent.modules.includes(module)) {
        throw conflict(
          `The reseller "${parent.name}" does not have the module "${module}". Activate it for the reseller first.`,
        );
      }
    }
    return { org, enable: !org.modules.includes(module) };
  }

  app.get('/admin/domains', async (req) => {
    await access.assert(req, 'platform:provider:read', platformScope);
    const query = parse(adminListQuery, req.query);
    const filters: (SQL | undefined)[] = [
      query.assigned === 'true' ? isNotNull(domains.orgId) : undefined,
      query.assigned === 'false' ? isNull(domains.orgId) : undefined,
      query.providerId ? eq(domains.providerConnectionId, query.providerId) : undefined,
      query.orgId ? eq(domains.orgId, query.orgId) : undefined,
      query.q ? or(ilike(domains.name, like(query.q)), ilike(domains.externalId, like(query.q))) : undefined,
    ];
    const rows = await domainRowsQuery(ctx)
      .where(and(...filters))
      .orderBy(domains.name)
      .limit(1000);
    return Promise.all(rows.map((r) => toDomainDto(ctx, req, r)));
  });

  app.post('/admin/domains/:id/assign', async (req) => {
    await access.assert(req, 'platform:server:assign', platformScope);
    const { id } = parse(idParams, req.params);
    const body = parse(assignBody, req.body);
    const current = await db.query.domains.findFirst({ where: eq(domains.id, id) });
    if (!current) throw notFound('Domain');
    const module = HOSTING_MODULES.domain;
    const target = body.orgId ? await assignTarget(body.orgId, module, body.enableModule) : null;
    await db.transaction(async (tx) => {
      if (target?.enable) {
        await tx
          .update(organizations)
          .set({ modules: normalizeModules([...target.org.modules, module]) })
          .where(eq(organizations.id, target.org.id));
      }
      await tx.update(domains).set({ orgId: body.orgId }).where(eq(domains.id, id));
    });
    await audit.record(req, {
      action: body.orgId ? 'domain.assign' : 'domain.unassign',
      orgId: body.orgId ?? current.orgId,
      resourceType: 'domain',
      resourceId: id,
      details: {
        name: current.name,
        orgId: body.orgId,
        previousOrgId: current.orgId,
        moduleEnabled: target?.enable ? module : null,
      },
    });
    const [row] = await domainRowsQuery(ctx).where(eq(domains.id, id)).limit(1);
    return toDomainDto(ctx, req, row!);
  });

  app.get('/admin/webspaces', async (req) => {
    await access.assert(req, 'platform:provider:read', platformScope);
    const query = parse(adminListQuery, req.query);
    const filters: (SQL | undefined)[] = [
      query.assigned === 'true' ? isNotNull(webspaces.orgId) : undefined,
      query.assigned === 'false' ? isNull(webspaces.orgId) : undefined,
      query.providerId ? eq(webspaces.providerConnectionId, query.providerId) : undefined,
      query.orgId ? eq(webspaces.orgId, query.orgId) : undefined,
      query.q
        ? or(ilike(webspaces.name, like(query.q)), ilike(webspaces.externalId, like(query.q)))
        : undefined,
    ];
    const rows = await webspaceRowsQuery(ctx)
      .where(and(...filters))
      .orderBy(webspaces.name)
      .limit(1000);
    return Promise.all(rows.map((r) => toWebspaceDto(ctx, req, r)));
  });

  app.post('/admin/webspaces/:id/assign', async (req) => {
    await access.assert(req, 'platform:server:assign', platformScope);
    const { id } = parse(idParams, req.params);
    const body = parse(assignBody, req.body);
    const current = await db.query.webspaces.findFirst({ where: eq(webspaces.id, id) });
    if (!current) throw notFound('Web space');
    const module = HOSTING_MODULES.webspace;
    const target = body.orgId ? await assignTarget(body.orgId, module, body.enableModule) : null;
    await db.transaction(async (tx) => {
      if (target?.enable) {
        await tx
          .update(organizations)
          .set({ modules: normalizeModules([...target.org.modules, module]) })
          .where(eq(organizations.id, target.org.id));
      }
      await tx.update(webspaces).set({ orgId: body.orgId }).where(eq(webspaces.id, id));
    });
    await audit.record(req, {
      action: body.orgId ? 'webspace.assign' : 'webspace.unassign',
      orgId: body.orgId ?? current.orgId,
      resourceType: 'webspace',
      resourceId: id,
      details: {
        name: current.name,
        orgId: body.orgId,
        previousOrgId: current.orgId,
        moduleEnabled: target?.enable ? module : null,
      },
    });
    const [row] = await webspaceRowsQuery(ctx).where(eq(webspaces.id, id)).limit(1);
    return toWebspaceDto(ctx, req, row!);
  });
}
