import { and, eq, ilike, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  DNS_PROXIABLE_TYPES,
  WEBSPACE_KINDS,
  normalizeModules,
  type DnsRecord,
  type DnsRecordInput,
  type DomainDetailDto,
  type DomainInfo,
  type Permission,
  type WebspaceDetailDto,
  type WebspaceInfo,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import { platformScope, requireSession } from '../../auth/access';
import { domains, organizations, webspaces } from '../../db/schema';
import { badRequest, notFound, unsupported } from '../../lib/errors';
import { parse } from '../../lib/validation';
import type { DnsRecordPatch, ProviderAdapter } from '../../providers/types';
import { loadOrg } from '../orgs/routes';
import { assertNoLinkedService } from '../reseller/service';
import { dnsDataIssue, dnsRecordBody, dnsRecordPatchBody, nameserversBody } from './dns';
import { pendingChanges, type PendingField } from './pending';
import {
  HOSTING_MODULES,
  actionResponse,
  assertRecordType,
  assignmentTarget,
  dnsRecordTypes,
  dnsWritable,
  domainCapabilities,
  domainChange,
  domainRowsQuery,
  domainScope,
  emptyDomainInfo,
  linkedDomains,
  loadAdminDomain,
  loadDomain,
  loadWebspace,
  providerTtl,
  refreshDomainInfo,
  requireDomainCapability,
  requireSupport,
  toDomainDto,
  toWebspaceDto,
  webspaceRowsQuery,
  webspaceScope,
  type LoadedDomain,
  type LoadedWebspace,
} from './service';
import { websiteDetail } from './website-service';

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
const adminWebspaceQuery = adminListQuery.extend({ kind: z.enum(WEBSPACE_KINDS).optional() });
const assignBody = z.object({ orgId: z.uuid().nullable(), enableModule: z.boolean().default(true) });
const lockBody = z.object({ locked: z.boolean() });
const autoRenewBody = z.object({ enabled: z.boolean() });
const renewBody = z.object({
  years: z.number().int().min(1).max(10),
  /** The expiry the operator saw. Without it the stored one counts (see renewDomain). */
  expiresAt: z
    .string()
    .max(40)
    .refine((v) => !Number.isNaN(Date.parse(v)), 'invalid date')
    .nullable()
    .optional(),
});

const like = (q: string) => `%${q.replace(/[%_]/g, '')}%`;
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Secrets must not end up in browser or proxy caches. */
function noStore(reply: FastifyReply) {
  reply.header('cache-control', 'no-store');
}

const PROXIABLE_TYPES: readonly string[] = DNS_PROXIABLE_TYPES;

/** Providers without the "dnsProxy" capability never see the proxy flag. */
function providerProxied<T extends { proxied?: boolean }>(adapter: ProviderAdapter, input: T): T {
  if (domainCapabilities(adapter).includes('dnsProxy')) return input;
  const copy = { ...input };
  delete copy.proxied;
  return copy;
}

/** 400 when a record that cannot go through the proxy would end up proxied. */
function assertProxiable(type: string, proxied: boolean | undefined): void {
  if (proxied && !PROXIABLE_TYPES.includes(type.toUpperCase())) {
    throw badRequest('Validation failed', [
      { path: 'proxied', message: 'Only A, AAAA and CNAME records can be proxied' },
    ]);
  }
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

  /** Domain for the platform routes, no organization check: callers assert a platform permission. */
  async function adminDomain(req: FastifyRequest): Promise<LoadedDomain> {
    const { id } = parse(idParams, req.params);
    return loadAdminDomain(ctx, id);
  }

  /**
   * Stores what a successful change implies. Registrars like Joker apply it later: until live
   * data reports it (or PENDING_TTL_MS passed), detail views and the sync keep this value.
   */
  async function storeInfo(
    loaded: LoadedDomain,
    patch: Partial<Record<PendingField, boolean>>,
  ): Promise<void> {
    const base = emptyDomainInfo(loaded.domain.name);
    const pending = pendingChanges(patch);
    await db
      .update(domains)
      .set({
        info: sql`coalesce(${domains.info}, ${JSON.stringify(base)}::jsonb) || ${JSON.stringify(patch)}::jsonb`,
        meta: sql`${domains.meta} || jsonb_build_object('pending', coalesce(${domains.meta} -> 'pending', '{}'::jsonb) || ${JSON.stringify(pending)}::jsonb)`,
      })
      .where(eq(domains.id, loaded.domain.id));
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
        info = await refreshDomainInfo(ctx, loaded);
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
      dnsRecordTypes: dnsRecordTypes(loaded.adapter),
      // Registration and DNS zone of the same name (e.g. at Cloudflare) link each other.
      ...(await linkedDomains(ctx, req, loaded)),
    };
  });

  app.get('/domains/:id/authcode', async (req, reply) => {
    const loaded = await domain(req);
    requireSession(req);
    await access.assert(req, 'domain:authcode', loaded.scope);
    requireDomainCapability(loaded.adapter, 'authcode', 'getDomainAuthcode', 'auth codes');
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

  app.put('/domains/:id/nameservers', async (req) => {
    const loaded = await domain(req, 'domain:manage');
    requireDomainCapability(loaded.adapter, 'nameservers', 'setNameservers', 'name server changes');
    const { nameservers } = parse(nameserversBody, req.body);
    const before = loaded.domain.info?.nameservers ?? [];
    // Not stored: the registry applies it later, the next detail view or sync shows it.
    const result = await domainChange(
      ctx,
      req,
      loaded,
      'nameservers_update',
      { before, after: nameservers },
      () => loaded.adapter.setNameservers!(loaded.domain.externalId, nameservers),
    );
    return actionResponse(result);
  });

  app.put('/domains/:id/lock', async (req) => {
    const loaded = await domain(req, 'domain:manage');
    requireDomainCapability(loaded.adapter, 'lock', 'setDomainLock', 'transfer lock changes');
    const { locked } = parse(lockBody, req.body);
    const result = await domainChange(
      ctx,
      req,
      loaded,
      locked ? 'lock' : 'unlock',
      { before: loaded.domain.info?.locked ?? null, after: locked },
      () => loaded.adapter.setDomainLock!(loaded.domain.externalId, locked),
    );
    await storeInfo(loaded, { locked });
    return actionResponse(result);
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
    const body = parse(dnsRecordBody, req.body);
    assertRecordType(loaded.adapter, body.type);
    const input: DnsRecordInput = providerProxied(loaded.adapter, providerTtl(loaded.adapter, body));
    assertProxiable(input.type, input.proxied);
    const record = await domainChange(ctx, req, loaded, 'dns_add', { ...input }, () =>
      loaded.adapter.addDnsRecord!(loaded.domain.externalId, input),
    );
    // Providers that do not report the new record back: the client reloads the list.
    return record ?? { id: '', ...input, ttl: input.ttl ?? null };
  });

  app.patch('/domains/:id/dns/:recordId', async (req) => {
    const loaded = await domain(req, 'domain:dns:write');
    requireSupport(loaded.adapter, 'updateDnsRecord', 'DNS changes');
    const { recordId } = parse(recordParams, req.params);
    const patch: DnsRecordPatch = providerProxied(
      loaded.adapter,
      providerTtl(loaded.adapter, parse(dnsRecordPatchBody, req.body)),
    );
    if (
      [patch.type, patch.name, patch.data, patch.ttl, patch.proxied].every(
        (v) => v === undefined || v === null,
      )
    ) {
      throw badRequest('Nothing to change');
    }
    const current = await findRecord(loaded, recordId);
    if (current.readOnly) throw badRequest('This record cannot be changed in the panel, only deleted');
    const type = patch.type ?? current.type;
    assertRecordType(loaded.adapter, type);
    const data = patch.data ?? current.data;
    if (patch.type !== undefined || patch.data !== undefined) {
      const issue = dnsDataIssue(type, data);
      if (issue) throw badRequest('Validation failed', [{ path: 'data', message: issue }]);
    }
    assertProxiable(type, patch.proxied ?? current.proxied);
    const before = {
      type: current.type,
      name: current.name,
      data: current.data,
      ttl: current.ttl,
      proxied: current.proxied ?? null,
    };
    const record = await domainChange(ctx, req, loaded, 'dns_update', { recordId, before, ...patch }, () =>
      loaded.adapter.updateDnsRecord!(loaded.domain.externalId, recordId, patch),
    );
    return record ?? { ok: true };
  });

  app.delete('/domains/:id/dns/:recordId', async (req) => {
    const loaded = await domain(req, 'domain:dns:write');
    requireSupport(loaded.adapter, 'deleteDnsRecord', 'DNS changes');
    const { recordId } = parse(recordParams, req.params);
    const current = await findRecord(loaded, recordId);
    await domainChange(
      ctx,
      req,
      loaded,
      'dns_delete',
      {
        recordId,
        type: current.type,
        name: current.name,
        data: current.data,
        proxied: current.proxied ?? null,
      },
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
    if (loaded.webspace.kind === 'website') return websiteDetail(ctx, req, loaded);
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
    return { ...(await toWebspaceDto(ctx, req, loaded)), info, liveError, access: null, databases: [] };
  });

  app.get('/webspaces/:id/credentials', async (req, reply) => {
    const loaded = await webspace(req);
    if (loaded.webspace.kind === 'website') {
      throw unsupported('Websites have no panel login; set a new SFTP password instead');
    }
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
    const target = body.orgId ? await assignmentTarget(db, body.orgId, module, body.enableModule) : null;
    await db.transaction(async (tx) => {
      if (target?.enable) {
        await tx
          .update(organizations)
          .set({ modules: normalizeModules([...target.org.modules, module]) })
          .where(eq(organizations.id, target.org.id));
      }
      // Not while the previous owner is billed for it.
      if (current.orgId !== body.orgId) await assertNoLinkedService(tx, 'domain', id, body.orgId);
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

  // Renewals cost money at the registrar: platform staff only, never with an API token.

  app.post('/admin/domains/:id/auto-renew', async (req) => {
    requireSession(req);
    await access.assert(req, 'platform:domain:write', platformScope);
    const loaded = await adminDomain(req);
    requireDomainCapability(loaded.adapter, 'autoRenew', 'setDomainAutoRenew', 'auto-renew');
    const { enabled } = parse(autoRenewBody, req.body);
    const result = await domainChange(
      ctx,
      req,
      loaded,
      'auto_renew',
      { enabled, before: loaded.domain.info?.autoRenew ?? null },
      () => loaded.adapter.setDomainAutoRenew!(loaded.domain.externalId, enabled),
    );
    await storeInfo(loaded, { autoRenew: enabled });
    return actionResponse(result);
  });

  app.post('/admin/domains/:id/renew', async (req) => {
    requireSession(req);
    await access.assert(req, 'platform:domain:write', platformScope);
    const loaded = await adminDomain(req);
    requireDomainCapability(loaded.adapter, 'renew', 'renewDomain', 'renewals');
    const body = parse(renewBody, req.body);
    const { years } = body;
    // The renewal counts from the expiry the operator saw. A repeated request (lost answer,
    // second click) still carries the old one, so the provider refuses instead of renewing
    // from the new expiry a second time.
    const expiresAt = body.expiresAt !== undefined ? body.expiresAt : (loaded.domain.info?.expiresAt ?? null);
    const result = await domainChange(
      ctx,
      req,
      loaded,
      'renew',
      { years, expiresAtBefore: loaded.domain.info?.expiresAt ?? null, expiresAtSeen: expiresAt },
      () => loaded.adapter.renewDomain!(loaded.domain.externalId, years, expiresAt),
    );
    // Best effort, so the inventory shows the new expiry; the sync catches up otherwise.
    if (loaded.adapter.getDomain) {
      await refreshDomainInfo(ctx, loaded).catch((err) =>
        req.log.warn({ err, domainId: loaded.domain.id }, 'domain info after renewal failed'),
      );
    }
    return actionResponse(result);
  });

  app.get('/admin/webspaces', async (req) => {
    await access.assert(req, 'platform:provider:read', platformScope);
    const query = parse(adminWebspaceQuery, req.query);
    const filters: (SQL | undefined)[] = [
      query.kind ? eq(webspaces.kind, query.kind) : undefined,
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
    const target = body.orgId ? await assignmentTarget(db, body.orgId, module, body.enableModule) : null;
    await db.transaction(async (tx) => {
      if (target?.enable) {
        await tx
          .update(organizations)
          .set({ modules: normalizeModules([...target.org.modules, module]) })
          .where(eq(organizations.id, target.org.id));
      }
      if (current.orgId !== body.orgId) await assertNoLinkedService(tx, 'webspace', id, body.orgId);
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
