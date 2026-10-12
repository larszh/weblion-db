import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import {
  ALL_PERMISSIONS,
  DNS_RECORD_TYPES,
  resourcePath,
  type DnsRecordType,
  type DomainCapability,
  type DomainDto,
  type DomainInfo,
  type DomainKind,
  type LinkedDomain,
  type ModuleKey,
  type Permission,
  type WebspaceDto,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import { requireAuth, type Scope } from '../../auth/access';
import type { DbOrTx } from '../../db/client';
import {
  domains,
  organizations,
  providerConnections,
  webspaces,
  type Domain,
  type Organization,
  type ProviderConnection,
  type Webspace,
} from '../../db/schema';
import { AppError, badRequest, conflict, notFound, unsupported } from '../../lib/errors';
import type { ActionResult, ProviderAdapter } from '../../providers/types';
import { settlePending } from './pending';

export const DOMAIN_PERMISSIONS = ALL_PERMISSIONS.filter((p) => p.startsWith('domain:'));
export const WEBSPACE_PERMISSIONS = ALL_PERMISSIONS.filter((p) => p.startsWith('webspace:'));

/** Module each resource type belongs to. Assigning one activates it for the organization. */
export const HOSTING_MODULES = { domain: 'dns', webspace: 'webhosting' } as const satisfies Record<
  string,
  ModuleKey
>;

/** Websites (CloudPanel) are web spaces of kind "website" and share their module. */
export const WEBSITE_MODULE = HOSTING_MODULES.webspace;

export interface DomainRow {
  domain: Domain;
  org: Organization | null;
  connection: ProviderConnection;
}

export interface WebspaceRow {
  webspace: Webspace;
  org: Organization | null;
  connection: ProviderConnection;
}

export interface LoadedDomain extends DomainRow {
  scope: Scope;
  adapter: ProviderAdapter;
}

export interface LoadedWebspace extends WebspaceRow {
  scope: Scope;
  adapter: ProviderAdapter;
}

/** Unassigned domains have no organization, only platform roles reach them. */
export function domainScope(domain: Pick<Domain, 'id' | 'orgId'>): Scope {
  return { orgId: domain.orgId, resource: { path: resourcePath.domain(domain.id) } };
}

export function webspaceScope(webspace: Pick<Webspace, 'id' | 'orgId'>): Scope {
  return { orgId: webspace.orgId, resource: { path: resourcePath.webspace(webspace.id) } };
}

export function domainRowsQuery(ctx: AppContext) {
  return ctx.db
    .select({ domain: domains, org: organizations, connection: providerConnections })
    .from(domains)
    .innerJoin(providerConnections, eq(providerConnections.id, domains.providerConnectionId))
    .leftJoin(organizations, eq(organizations.id, domains.orgId));
}

export function webspaceRowsQuery(ctx: AppContext) {
  return ctx.db
    .select({ webspace: webspaces, org: organizations, connection: providerConnections })
    .from(webspaces)
    .innerJoin(providerConnections, eq(providerConnections.id, webspaces.providerConnectionId))
    .leftJoin(organizations, eq(organizations.id, webspaces.orgId));
}

/** Loads a domain and checks that the caller may at least see it (404 otherwise). */
export async function loadDomain(
  ctx: AppContext,
  req: FastifyRequest,
  domainId: string,
): Promise<LoadedDomain> {
  requireAuth(req);
  const [row] = await domainRowsQuery(ctx).where(eq(domains.id, domainId)).limit(1);
  if (!row) throw notFound('Domain');
  const scope = domainScope(row.domain);
  if (!(await ctx.access.can(req, 'domain:read', scope))) throw notFound('Domain');
  return { ...row, scope, adapter: ctx.providers.forConnection(row.connection) };
}

/** Loads a domain for a platform route, without organization check: callers assert a platform permission. */
export async function loadAdminDomain(ctx: AppContext, domainId: string): Promise<LoadedDomain> {
  const [row] = await domainRowsQuery(ctx).where(eq(domains.id, domainId)).limit(1);
  if (!row) throw notFound('Domain');
  return { ...row, scope: domainScope(row.domain), adapter: ctx.providers.forConnection(row.connection) };
}

/** Loads a web space and checks that the caller may at least see it (404 otherwise). */
export async function loadWebspace(
  ctx: AppContext,
  req: FastifyRequest,
  webspaceId: string,
): Promise<LoadedWebspace> {
  requireAuth(req);
  const [row] = await webspaceRowsQuery(ctx).where(eq(webspaces.id, webspaceId)).limit(1);
  if (!row) throw notFound('Web space');
  const scope = webspaceScope(row.webspace);
  if (!(await ctx.access.can(req, 'webspace:read', scope))) throw notFound('Web space');
  return { ...row, scope, adapter: ctx.providers.forConnection(row.connection) };
}

/** Throws 422 when the provider has no implementation for a hosting operation. */
export function requireSupport(adapter: ProviderAdapter, method: keyof ProviderAdapter, what: string): void {
  if (typeof adapter[method] !== 'function') throw unsupported(`This provider does not support ${what}`);
}

/** DNS changes need a provider implementation and, at 24fire, an active 24fire+ plan. */
export async function dnsWritable(adapter: ProviderAdapter): Promise<boolean> {
  if (typeof adapter.addDnsRecord !== 'function') return false;
  if (!adapter.dnsWritable) return true;
  return adapter.dnsWritable().catch(() => false);
}

/** Domain features of a provider. Adapters without the method get what they implement. */
export function domainCapabilities(adapter: ProviderAdapter): DomainCapability[] {
  if (adapter.domainCapabilities) return adapter.domainCapabilities();
  const capabilities: DomainCapability[] = [];
  if (adapter.listDnsRecords) capabilities.push('dns');
  if (adapter.getDomainAuthcode) capabilities.push('authcode');
  return capabilities;
}

/** Record types a provider accepts for new or changed records. */
export function dnsRecordTypes(adapter: ProviderAdapter): DnsRecordType[] {
  return adapter.dnsRecordTypes?.() ?? [...DNS_RECORD_TYPES];
}

/** A registered domain, or a DNS zone only (Cloudflare). */
export function domainKind(adapter: ProviderAdapter): DomainKind {
  return adapter.domainKind?.() ?? 'registration';
}

/** Whether the connection can create DNS zones (Cloudflare: only with an account id). */
export function canCreateZones(adapter: ProviderAdapter): boolean {
  return typeof adapter.createZone === 'function' && (adapter.canCreateZones?.() ?? true);
}

/** 400 for record types the provider does not take when adding or changing records. */
export function assertRecordType(adapter: ProviderAdapter, type: string): void {
  const accepted: string[] = dnsRecordTypes(adapter);
  if (!accepted.includes(type.toUpperCase())) {
    throw badRequest('Validation failed', [
      { path: 'type', message: `${type} records cannot be added or changed at this provider` },
    ]);
  }
}

/** Providers without the "dnsTtl" capability never see a TTL. */
export function providerTtl<T extends { ttl?: number | null }>(adapter: ProviderAdapter, input: T): T {
  if (domainCapabilities(adapter).includes('dnsTtl')) return input;
  const copy = { ...input };
  delete copy.ttl;
  return copy;
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Answer of the domain management routes. Providers may apply the change later. */
export function actionResponse(result: ActionResult) {
  return { ok: true as const, message: result.message ?? null, providerRef: result.providerRef ?? null };
}

/** Runs a domain or DNS change at the provider and audits it, failures included. */
export async function domainChange<T>(
  ctx: AppContext,
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
    await ctx.audit.record(req, { ...entry, details: { domain: loaded.domain.name, ...details } });
    return result;
  } catch (err) {
    await ctx.audit.record(req, {
      ...entry,
      status: 'failure',
      details: { domain: loaded.domain.name, ...details, error: errorMessage(err) },
    });
    throw err instanceof AppError ? err : new AppError(500, 'action_failed', errorMessage(err));
  }
}

/**
 * Target organization of an assignment. With `enableModule` the module is activated for
 * it; a customer below a reseller can only get modules the reseller has itself.
 */
export async function assignmentTarget(
  db: DbOrTx,
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

/**
 * Throws 422 unless the provider implements a domain operation and also announces the
 * matching capability, which is what the UI goes by.
 */
export function requireDomainCapability(
  adapter: ProviderAdapter,
  capability: DomainCapability,
  method: keyof ProviderAdapter,
  what: string,
): void {
  requireSupport(adapter, method, what);
  if (!domainCapabilities(adapter).includes(capability)) {
    throw unsupported(`This provider does not support ${what}`);
  }
}

/** Domain info for a domain nothing is known about yet. */
export function emptyDomainInfo(name: string): DomainInfo {
  return {
    name,
    status: null,
    terminated: false,
    nameservers: [],
    handle: null,
    createdAt: null,
    expiresAt: null,
    autoRenew: null,
  };
}

/**
 * Merges provider facts into the stored info field by field: what the provider leaves out
 * or reports as null keeps its stored value (e.g. the renewal setting only the list knows).
 */
export function mergeDomainInfo(
  name: string,
  stored: DomainInfo | null,
  update: Partial<DomainInfo>,
): DomainInfo {
  const known = Object.fromEntries(
    Object.entries(update).filter(([, value]) => value !== undefined && value !== null),
  ) as Partial<DomainInfo>;
  return { ...(stored ?? emptyDomainInfo(name)), ...known };
}

/** Live info from the provider, merged into and stored with what the panel knows. */
export async function refreshDomainInfo(ctx: AppContext, loaded: LoadedDomain): Promise<DomainInfo> {
  const live = await loaded.adapter.getDomain!(loaded.domain.externalId);
  // A lock or auto-renew change the registrar has not applied yet is not undone.
  const settled = settlePending(live, loaded.domain.meta);
  // Field by field: what the live call does not know (e.g. 24fire's renewal setting, which
  // only the sync sees) keeps its stored value.
  const info = mergeDomainInfo(loaded.domain.name, loaded.domain.info, settled.info);
  await ctx.db
    .update(domains)
    .set({
      info,
      status: info.status,
      lastSyncedAt: new Date(),
      ...(settled.meta !== loaded.domain.meta ? { meta: settled.meta } : {}),
    })
    .where(eq(domains.id, loaded.domain.id));
  loaded.domain = { ...loaded.domain, info, meta: settled.meta, status: info.status };
  return info;
}

export async function toDomainDto(ctx: AppContext, req: FastifyRequest, row: DomainRow): Promise<DomainDto> {
  const { domain, org, connection } = row;
  const permissions: Permission[] = await ctx.access.allowed(req, DOMAIN_PERMISSIONS, domainScope(domain));
  const adapter = ctx.providers.forConnection(connection);
  return {
    id: domain.id,
    name: domain.name,
    status: domain.status,
    provider: { id: connection.id, type: connection.type, name: connection.name },
    location: connection.location,
    org: org ? { id: org.id, name: org.name, slug: org.slug } : null,
    expiresAt: domain.info?.expiresAt ?? null,
    autoRenew: domain.info?.autoRenew ?? null,
    permissions,
    capabilities: domainCapabilities(adapter),
    kind: domainKind(adapter),
    lastSyncedAt: domain.lastSyncedAt?.toISOString() ?? null,
    missingSince: domain.missingSince?.toISOString() ?? null,
    createdAt: domain.createdAt.toISOString(),
  };
}

/** Zone status, also for rows stored before the zone facts existed. */
function zoneStatus(domain: Domain): string | null {
  return domain.info?.zone?.status ?? domain.status;
}

/** Zones that serve DNS first, then those waiting for their name servers, then the rest. */
function zoneRank(domain: Domain): number {
  const status = zoneStatus(domain);
  return status === 'active' ? 0 : status === 'pending' ? 1 : 2;
}

/** A row as the other side of a registration/zone pair. */
export function toLinkedDomain(ctx: AppContext, row: DomainRow): LinkedDomain {
  const { domain, org, connection } = row;
  const kind = domainKind(ctx.providers.forConnection(connection));
  const status = kind === 'zone' ? zoneStatus(domain) : domain.status;
  return {
    id: domain.id,
    name: domain.name,
    kind,
    provider: { id: connection.id, type: connection.type, name: connection.name },
    org: org ? { id: org.id, name: org.name, slug: org.slug } : null,
    status,
    nameservers: domain.info?.nameservers ?? [],
    active:
      kind === 'zone' ? (status === null ? null : status === 'active') : (domain.info?.providerDns ?? null),
  };
}

/**
 * Rows of the same name and the other kind (not missing), best first: zones by status, then
 * the oldest. Callers filter by what they may see.
 */
export async function counterparts(ctx: AppContext, loaded: LoadedDomain): Promise<DomainRow[]> {
  const kind = domainKind(loaded.adapter);
  const rows = await domainRowsQuery(ctx).where(
    and(
      sql`lower(${domains.name}) = lower(${loaded.domain.name})`,
      ne(domains.id, loaded.domain.id),
      isNull(domains.missingSince),
    ),
  );
  return rows
    .filter((row) => domainKind(ctx.providers.forConnection(row.connection)) !== kind)
    .sort(
      (a, b) =>
        zoneRank(a.domain) - zoneRank(b.domain) ||
        a.domain.createdAt.getTime() - b.domain.createdAt.getTime(),
    );
}

/**
 * The registration and DNS zone of the same name link each other (e.g. a Joker domain and its
 * Cloudflare zone). Only rows the caller may read count.
 */
export async function linkedDomains(
  ctx: AppContext,
  req: FastifyRequest,
  loaded: LoadedDomain,
): Promise<{ dnsZone: LinkedDomain | null; registration: LinkedDomain | null }> {
  let linked: LinkedDomain | null = null;
  for (const row of await counterparts(ctx, loaded)) {
    if (await ctx.access.can(req, 'domain:read', domainScope(row.domain))) {
      linked = toLinkedDomain(ctx, row);
      break;
    }
  }
  return domainKind(loaded.adapter) === 'zone'
    ? { dnsZone: null, registration: linked }
    : { dnsZone: linked, registration: null };
}

export async function toWebspaceDto(
  ctx: AppContext,
  req: FastifyRequest,
  row: WebspaceRow,
): Promise<WebspaceDto> {
  const { webspace, org, connection } = row;
  const permissions: Permission[] = await ctx.access.allowed(
    req,
    WEBSPACE_PERMISSIONS,
    webspaceScope(webspace),
  );
  return {
    id: webspace.id,
    name: webspace.name,
    kind: webspace.kind,
    status: webspace.status,
    provider: { id: connection.id, type: connection.type, name: connection.name },
    location: connection.location,
    org: org ? { id: org.id, name: org.name, slug: org.slug } : null,
    resources: webspace.info?.resources ?? null,
    panelUrl: webspace.info?.panelUrl ?? null,
    expiresAt: webspace.info?.expiresAt ?? null,
    site: webspace.kind === 'website' ? (webspace.info?.site ?? null) : null,
    credentialsPending: webspace.meta.credentialsDelivered === false,
    permissions,
    lastSyncedAt: webspace.lastSyncedAt?.toISOString() ?? null,
    missingSince: webspace.missingSince?.toISOString() ?? null,
    createdAt: webspace.createdAt.toISOString(),
  };
}
