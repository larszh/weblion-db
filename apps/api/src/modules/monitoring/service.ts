import { and, count, eq, inArray, ne, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import {
  ALL_PERMISSIONS,
  isMonitorKind,
  resourcePath,
  type ModuleKey,
  type MonitorAllowanceDto,
  type MonitorDto,
  type Permission,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import { requireAuth, type Scope } from '../../auth/access';
import type { DbOrTx, Tx } from '../../db/client';
import {
  monitorAllowances,
  monitorStatusPages,
  monitors,
  organizations,
  providerConnections,
  type Monitor,
  type MonitorAllowance,
  type Organization,
  type ProviderConnection,
} from '../../db/schema';
import { AppError, conflict, monitorLimit, notFound, unsupported } from '../../lib/errors';
import type { ProviderAdapter } from '../../providers/types';

/**
 * Monitoring (module "monitoring"): monitors of Uptime Kuma instances.
 *
 * The sync finds the monitors of every instance (origin "kuma", read-only in the console), staff
 * assign them to organizations. With an allowance on an instance that staff signed in for
 * management, an organization creates its own monitors there (origin "console") up to
 * maxMonitors, checking at most every minIntervalSeconds. A reseller's allowance additionally
 * covers the allowances it hands to its customers on the same instance. Every allowance check
 * runs under a per-organization advisory lock (see lockMonitorOrg), like cloud storage.
 */

export const MONITOR_PERMISSIONS = ALL_PERMISSIONS.filter((p) => p.startsWith('monitor:'));
export const MONITORING_MODULE = 'monitoring' as const satisfies ModuleKey;

/** Methods an adapter needs to have monitors at all (read side). */
const READ_METHODS = ['listMonitors', 'getMonitor'] as const satisfies readonly (keyof ProviderAdapter)[];
/** And to manage them. */
const WRITE_METHODS = [
  'createMonitor',
  'updateMonitor',
  'pauseMonitor',
  'resumeMonitor',
  'deleteMonitor',
] as const satisfies readonly (keyof ProviderAdapter)[];

export interface MonitorRow {
  monitor: Monitor;
  org: Organization | null;
  connection: ProviderConnection;
}

export interface LoadedMonitor extends MonitorRow {
  scope: Scope;
  adapter: ProviderAdapter;
}

/** Unassigned monitors have no organization, only platform roles reach them. */
export function monitorScope(m: Pick<Monitor, 'id' | 'orgId'>): Scope {
  return { orgId: m.orgId, resource: { path: resourcePath.monitor(m.id) } };
}

export function supportsMonitoring(adapter: ProviderAdapter): boolean {
  return READ_METHODS.every((m) => typeof adapter[m] === 'function');
}

/** The adapter can write monitors and the instance is signed in for management. No network. */
export function canManageMonitors(adapter: ProviderAdapter): boolean {
  return (
    WRITE_METHODS.every((m) => typeof adapter[m] === 'function') && adapter.monitorManagement?.() === true
  );
}

/** Throws 422 for providers without monitors (anything but Uptime Kuma and demo). */
export function requireMonitoring(adapter: ProviderAdapter): void {
  if (!supportsMonitoring(adapter)) throw unsupported('This provider has no monitors');
}

/** Throws 422 unless monitors of the instance can be created and changed. */
export function requireManagement(adapter: ProviderAdapter): void {
  if (!canManageMonitors(adapter)) {
    throw unsupported('This Uptime Kuma instance is not signed in for management');
  }
}

export const noMonitorAllowance = (message = 'This organization has no monitoring allowance') =>
  new AppError(409, 'no_allowance', message);
export const readOnlyMonitor = () =>
  new AppError(
    409,
    'read_only_monitor',
    'This monitor is managed by weblion.one in Uptime Kuma and cannot be changed here',
  );

/** Name of a console monitor in Uptime Kuma, so staff recognize its organization there. */
export function kumaName(orgSlug: string, name: string): string {
  return `[${orgSlug}] ${name}`;
}

/** Host names of the instance (from its public status page address), for the target check. */
export function instanceHosts(adapter: ProviderAdapter): string[] {
  try {
    const url = adapter.statusPageUrl?.('x');
    return url ? [new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase()] : [];
  } catch {
    return [];
  }
}

export function monitorRowsQuery(ctx: AppContext) {
  return ctx.db
    .select({ monitor: monitors, org: organizations, connection: providerConnections })
    .from(monitors)
    .innerJoin(providerConnections, eq(providerConnections.id, monitors.providerConnectionId))
    .leftJoin(organizations, eq(organizations.id, monitors.orgId));
}

export async function monitorRow(ctx: AppContext, id: string): Promise<MonitorRow | null> {
  const [row] = await monitorRowsQuery(ctx).where(eq(monitors.id, id)).limit(1);
  return row ?? null;
}

/** Loads a monitor and checks monitor:read (404 otherwise). */
export async function loadMonitor(ctx: AppContext, req: FastifyRequest, id: string): Promise<LoadedMonitor> {
  requireAuth(req);
  const row = await monitorRow(ctx, id);
  if (!row) throw notFound('Monitor');
  const scope = monitorScope(row.monitor);
  if (!(await ctx.access.can(req, 'monitor:read', scope))) throw notFound('Monitor');
  return { ...row, scope, adapter: ctx.providers.forConnection(row.connection) };
}

/** The public address of a linked status page: its own domain, else the instance's /status/<slug>. */
function statusPageAddress(
  ctx: AppContext,
  connection: ProviderConnection,
  page: { slug: string; url: string | null },
): string | null {
  if (page.url) return page.url;
  try {
    return ctx.providers.forConnection(connection).statusPageUrl?.(page.slug) ?? null;
  } catch {
    return null;
  }
}

/** Status page URL per provider id for an org. */
export async function statusPageUrls(ctx: AppContext, orgId: string): Promise<Map<string, string>> {
  return (await statusPageIndex(ctx, [orgId])).get(orgId) ?? new Map();
}

/** Status page URLs per organization and provider id, for lists that span organizations. */
export async function statusPageIndex(
  ctx: AppContext,
  orgIds: string[],
): Promise<Map<string, Map<string, string>>> {
  const index = new Map<string, Map<string, string>>();
  const ids = [...new Set(orgIds)];
  if (ids.length === 0) return index;
  const rows = await ctx.db
    .select({ page: monitorStatusPages, connection: providerConnections })
    .from(monitorStatusPages)
    .innerJoin(providerConnections, eq(providerConnections.id, monitorStatusPages.providerConnectionId))
    .where(inArray(monitorStatusPages.orgId, ids));
  for (const { page, connection } of rows) {
    const url = statusPageAddress(ctx, connection, page);
    if (!url) continue;
    let byProvider = index.get(page.orgId);
    if (!byProvider) {
      byProvider = new Map();
      index.set(page.orgId, byProvider);
    }
    byProvider.set(connection.id, url);
  }
  return index;
}

/**
 * `statusPages`: the status page URLs of the monitor's organization per provider id (see
 * statusPageUrls); loaded when left out. Write and delete are only offered where they work:
 * console monitors on an instance signed in for management, and deleting rows that are missing
 * in Uptime Kuma.
 */
export async function toMonitorDto(
  ctx: AppContext,
  req: FastifyRequest,
  row: MonitorRow,
  statusPages?: Map<string, string>,
): Promise<MonitorDto> {
  const { monitor, org, connection } = row;
  let manageable = false;
  try {
    manageable = monitor.origin === 'console' && canManageMonitors(ctx.providers.forConnection(connection));
  } catch {
    // Credentials that cannot be decrypted: the stored data is still shown, nothing can change.
  }
  const allowed: Permission[] = await ctx.access.allowed(req, MONITOR_PERMISSIONS, monitorScope(monitor));
  const permissions = manageable
    ? allowed
    : allowed.filter(
        (p) => p !== 'monitor:write' && (p !== 'monitor:delete' || monitor.missingSince !== null),
      );
  const pages = monitor.orgId ? (statusPages ?? (await statusPageUrls(ctx, monitor.orgId))) : null;
  return {
    id: monitor.id,
    name: monitor.name,
    type: monitor.type,
    kind: isMonitorKind(monitor.type) ? monitor.type : null,
    target: monitor.target,
    status: monitor.status,
    active: monitor.active,
    intervalSeconds: monitor.intervalSeconds,
    origin: monitor.origin,
    facts: monitor.facts ?? null,
    provider: { id: connection.id, type: connection.type, name: connection.name },
    location: connection.location,
    org: org ? { id: org.id, name: org.name, slug: org.slug } : null,
    statusPageUrl: pages?.get(connection.id) ?? null,
    manageable,
    permissions,
    lastSyncedAt: monitor.lastSyncedAt?.toISOString() ?? null,
    missingSince: monitor.missingSince?.toISOString() ?? null,
    createdAt: monitor.createdAt.toISOString(),
  };
}

// --- Allowances -----------------------------------------------------------------------

/**
 * Serializes monitoring allowance checks and changes of one organization until the transaction
 * ends. The reseller (if any) is always locked first, so lock order is the same everywhere.
 */
export async function lockMonitorOrg(tx: Tx, org: Pick<Organization, 'id' | 'parentOrgId'>): Promise<void> {
  for (const id of [org.parentOrgId, org.id]) {
    if (id) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`monitor:${id}`}, 0))`);
  }
}

export interface MonitorCommitments {
  /** The organization's own console monitors on the instance. */
  monitors: number;
  /** Monitoring allowances of a reseller's customers on the instance (0 for everyone else). */
  customers: number;
  /** Their maxMonitors. */
  customerMonitors: number;
}

/**
 * Own console monitors on the instance, plus for a reseller its customers' allowances there.
 * Call lockMonitorOrg first when acting on it.
 */
export async function monitorCommitments(
  db: DbOrTx,
  org: Pick<Organization, 'id' | 'kind'>,
  providerId: string,
  excludeCustomerId?: string,
): Promise<MonitorCommitments> {
  const [own] = await db
    .select({ n: count() })
    .from(monitors)
    .where(
      and(
        eq(monitors.orgId, org.id),
        eq(monitors.origin, 'console'),
        eq(monitors.providerConnectionId, providerId),
      ),
    );
  const result: MonitorCommitments = { monitors: own?.n ?? 0, customers: 0, customerMonitors: 0 };
  if (org.kind !== 'reseller') return result;
  const [customers] = await db
    .select({ customers: count(), monitors: sql<string | null>`sum(${monitorAllowances.maxMonitors})` })
    .from(monitorAllowances)
    .innerJoin(organizations, eq(organizations.id, monitorAllowances.orgId))
    .where(
      and(
        eq(organizations.parentOrgId, org.id),
        eq(monitorAllowances.providerConnectionId, providerId),
        excludeCustomerId ? ne(monitorAllowances.orgId, excludeCustomerId) : undefined,
      ),
    );
  result.customers = customers?.customers ?? 0;
  result.customerMonitors = Number(customers?.monitors ?? 0);
  return result;
}

/** What counts against maxMonitors: own console monitors plus, for resellers, the customers' maxima. */
export const committedMonitors = (c: MonitorCommitments) => c.monitors + c.customerMonitors;

export async function loadMonitorAllowance(
  db: DbOrTx,
  orgId: string,
): Promise<{ allowance: MonitorAllowance; connection: ProviderConnection } | null> {
  const [row] = await db
    .select({ allowance: monitorAllowances, connection: providerConnections })
    .from(monitorAllowances)
    .innerJoin(providerConnections, eq(providerConnections.id, monitorAllowances.providerConnectionId))
    .where(eq(monitorAllowances.orgId, orgId))
    .limit(1);
  return row ?? null;
}

export async function toMonitorAllowanceDto(
  ctx: AppContext,
  org: Pick<Organization, 'id' | 'kind'>,
  allowance: MonitorAllowance,
  connection: ProviderConnection,
): Promise<MonitorAllowanceDto> {
  const usage = await monitorCommitments(ctx.db, org, connection.id);
  let management = false;
  try {
    management = canManageMonitors(ctx.providers.forConnection(connection));
  } catch {
    // Credentials that cannot be decrypted: nothing can be created there.
  }
  return {
    orgId: allowance.orgId,
    provider: { id: connection.id, type: connection.type, name: connection.name },
    maxMonitors: allowance.maxMonitors,
    minIntervalSeconds: allowance.minIntervalSeconds,
    monitors: usage.monitors,
    customers: usage.customers,
    customerMonitors: usage.customerMonitors,
    committed: committedMonitors(usage),
    management,
    updatedAt: allowance.updatedAt.toISOString(),
  };
}

export async function monitorAllowanceDto(
  ctx: AppContext,
  org: Pick<Organization, 'id' | 'kind'>,
): Promise<MonitorAllowanceDto | null> {
  const loaded = await loadMonitorAllowance(ctx.db, org.id);
  return loaded ? toMonitorAllowanceDto(ctx, org, loaded.allowance, loaded.connection) : null;
}

/**
 * A console monitor (origin "console") moves into an organization only with a monitoring
 * allowance on the monitor's instance, a free slot and a minimum interval the monitor meets (409
 * otherwise, under the organization's monitoring lock). Monitors found in Uptime Kuma (origin
 * "kuma") move freely. The reseller resource hand-over calls it inside its transaction, for the
 * customer on assign and for the reseller on release.
 */
export async function assertMonitorMoveAllowed(
  tx: Tx,
  monitorId: string,
  to: Pick<Organization, 'id' | 'parentOrgId' | 'kind'>,
): Promise<void> {
  const row = await tx.query.monitors.findFirst({
    where: eq(monitors.id, monitorId),
    columns: { name: true, origin: true, providerConnectionId: true, intervalSeconds: true },
  });
  if (!row || row.origin !== 'console') return;
  await lockMonitorOrg(tx, to);
  const allowance = await tx.query.monitorAllowances.findFirst({ where: eq(monitorAllowances.orgId, to.id) });
  if (!allowance) {
    throw noMonitorAllowance(
      `The monitor "${row.name}" was created in the console and needs a monitoring allowance of the organization it moves to`,
    );
  }
  if (allowance.providerConnectionId !== row.providerConnectionId) {
    throw conflict(`The monitoring allowance of the organization is on another instance than "${row.name}"`);
  }
  const usage = await monitorCommitments(tx, to, allowance.providerConnectionId);
  if (committedMonitors(usage) + 1 > allowance.maxMonitors) {
    throw monitorLimit(
      `The monitoring allowance of the organization has room for ${Math.max(allowance.maxMonitors - committedMonitors(usage), 0)} more monitors`,
      { maxMonitors: allowance.maxMonitors, committed: committedMonitors(usage) },
    );
  }
  if (row.intervalSeconds !== null && row.intervalSeconds < allowance.minIntervalSeconds) {
    throw conflict(
      `"${row.name}" checks every ${row.intervalSeconds} seconds; the monitoring allowance of the organization allows ${allowance.minIntervalSeconds} seconds at the shortest`,
    );
  }
}
