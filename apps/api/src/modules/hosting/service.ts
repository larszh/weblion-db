import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import {
  ALL_PERMISSIONS,
  DNS_RECORD_TYPES,
  resourcePath,
  type DnsRecordType,
  type DomainCapability,
  type DomainDto,
  type ModuleKey,
  type Permission,
  type WebspaceDto,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import { requireAuth, type Scope } from '../../auth/access';
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
import { notFound, unsupported } from '../../lib/errors';
import type { ProviderAdapter } from '../../providers/types';

export const DOMAIN_PERMISSIONS = ALL_PERMISSIONS.filter((p) => p.startsWith('domain:'));
export const WEBSPACE_PERMISSIONS = ALL_PERMISSIONS.filter((p) => p.startsWith('webspace:'));

/** Module each resource type belongs to. Assigning one activates it for the organization. */
export const HOSTING_MODULES = { domain: 'dns', webspace: 'webhosting' } as const satisfies Record<
  string,
  ModuleKey
>;

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

export async function toDomainDto(ctx: AppContext, req: FastifyRequest, row: DomainRow): Promise<DomainDto> {
  const { domain, org, connection } = row;
  const permissions: Permission[] = await ctx.access.allowed(req, DOMAIN_PERMISSIONS, domainScope(domain));
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
    lastSyncedAt: domain.lastSyncedAt?.toISOString() ?? null,
    missingSince: domain.missingSince?.toISOString() ?? null,
    createdAt: domain.createdAt.toISOString(),
  };
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
    provider: { id: connection.id, type: connection.type, name: connection.name },
    location: connection.location,
    org: org ? { id: org.id, name: org.name, slug: org.slug } : null,
    resources: webspace.info?.resources ?? null,
    panelUrl: webspace.info?.panelUrl ?? null,
    expiresAt: webspace.info?.expiresAt ?? null,
    permissions,
    lastSyncedAt: webspace.lastSyncedAt?.toISOString() ?? null,
    missingSince: webspace.missingSince?.toISOString() ?? null,
    createdAt: webspace.createdAt.toISOString(),
  };
}
