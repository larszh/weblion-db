import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import {
  ALL_PERMISSIONS,
  resourcePath,
  type Capability,
  type Location,
  type Permission,
  type ServerDto,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import { requireAuth, type Scope } from '../../auth/access';
import {
  organizations,
  projects,
  providerConnections,
  serverActions,
  servers,
  type Organization,
  type Project,
  type ProviderConnection,
  type Server,
} from '../../db/schema';
import { AppError, notFound, unsupported } from '../../lib/errors';
import { serverRef } from '../../providers/registry';
import type { ActionResult, ProviderAdapter, ServerRef } from '../../providers/types';

export const SERVER_PERMISSIONS = ALL_PERMISSIONS.filter((p) => p.startsWith('server:'));

export interface ServerRow {
  server: Server;
  project: Project | null;
  org: Organization | null;
  connection: ProviderConnection;
}

export interface LoadedServer extends ServerRow {
  scope: Scope;
  adapter: ProviderAdapter;
  ref: ServerRef;
}

export function serverScope(row: Pick<ServerRow, 'server' | 'project'>): Scope {
  const { server, project } = row;
  return {
    orgId: project?.orgId ?? null,
    resource: {
      // Unassigned servers have no organization, only platform roles reach them.
      path: project ? resourcePath.server(project.id, server.id) : `unassigned/server/${server.id}`,
      labels: server.labels,
    },
  };
}

export function serverRowsQuery(ctx: AppContext) {
  return ctx.db
    .select({ server: servers, project: projects, org: organizations, connection: providerConnections })
    .from(servers)
    .innerJoin(providerConnections, eq(providerConnections.id, servers.providerConnectionId))
    .leftJoin(projects, eq(projects.id, servers.projectId))
    .leftJoin(organizations, eq(organizations.id, projects.orgId));
}

/** Loads a server and checks that the caller may at least see it (404 otherwise). */
export async function loadServer(
  ctx: AppContext,
  req: FastifyRequest,
  serverId: string,
): Promise<LoadedServer> {
  requireAuth(req);
  const [row] = await serverRowsQuery(ctx).where(eq(servers.id, serverId)).limit(1);
  if (!row) throw notFound('Server');
  const scope = serverScope(row);
  if (!(await ctx.access.can(req, 'server:read', scope))) throw notFound('Server');
  return { ...row, scope, adapter: ctx.providers.forConnection(row.connection), ref: serverRef(row.server) };
}

export function locationOf(row: Pick<ServerRow, 'server' | 'connection'>): Location {
  const base = row.connection.location;
  const dc = row.server.meta.datacenter as { city?: string | null } | null | undefined;
  return dc?.city ? { ...base, city: dc.city } : base;
}

/** Capabilities the adapter declares and actually implements. */
export function effectiveCapabilities(adapter: ProviderAdapter, ref: ServerRef): Capability[] {
  const methods: Partial<Record<Capability, keyof ProviderAdapter>> = {
    power: 'power',
    metrics: 'getMetrics',
    monitoring: 'getMonitoring',
    traffic: 'getTraffic',
    backups: 'listBackups',
    backupRestore: 'restoreBackup',
    backupDelete: 'deleteBackup',
    snapshots: 'listSnapshots',
    console: 'openConsole',
    rescale: 'rescale',
    rebuild: 'rebuild',
    rdns: 'setRdns',
    ddos: 'getDdos',
    iso: 'listIsos',
    passwordReset: 'resetPassword',
    firewall: 'getFirewall',
    delete: 'deleteServer',
    config: 'getConfig',
    tasks: 'listTasks',
  };
  return adapter.capabilities(ref).filter((cap) => {
    const method = methods[cap];
    return !method || typeof adapter[method] === 'function';
  });
}

export function requireCapability(loaded: LoadedServer, capability: Capability): void {
  if (!effectiveCapabilities(loaded.adapter, loaded.ref).includes(capability)) {
    throw unsupported(`This server's provider does not support "${capability}"`);
  }
}

export async function toServerDto(ctx: AppContext, req: FastifyRequest, row: ServerRow): Promise<ServerDto> {
  const { server, project, org, connection } = row;
  const adapter = ctx.providers.forConnection(connection);
  const ref = serverRef(server);
  const scope = serverScope(row);
  const permissions: Permission[] = await ctx.access.allowed(req, SERVER_PERMISSIONS, scope);
  return {
    id: server.id,
    name: server.name,
    provider: { id: connection.id, type: connection.type, name: connection.name },
    externalId: server.externalId,
    kind: server.kind,
    status: server.status,
    specs: server.specs,
    usage: server.usage ?? null,
    ips: server.ips,
    os: server.os,
    node: server.node,
    location: locationOf(row),
    labels: server.labels,
    protection: server.protection,
    project: project ? { id: project.id, name: project.name } : null,
    org: org ? { id: org.id, name: org.name, slug: org.slug } : null,
    capabilities: effectiveCapabilities(adapter, ref),
    powerActions: adapter.powerActions(ref),
    permissions,
    lastSyncedAt: server.lastSyncedAt?.toISOString() ?? null,
    createdAt: server.createdAt.toISOString(),
  };
}

/**
 * Runs a provider operation and records it as a server action plus an audit entry.
 * Operations that return a provider task reference stay "running" until the action
 * tracker sees the task finish.
 */
export async function runServerAction<T extends ActionResult>(
  ctx: AppContext,
  req: FastifyRequest,
  loaded: LoadedServer,
  type: string,
  details: Record<string, unknown> | null,
  fn: () => Promise<T>,
): Promise<T & { actionId: string }> {
  const auth = requireAuth(req);
  const [action] = await ctx.db
    .insert(serverActions)
    .values({ serverId: loaded.server.id, userId: auth.user.id, type, status: 'running' })
    .returning();
  const auditBase = {
    action: `server.${type}`,
    orgId: loaded.scope.orgId,
    resourceType: 'server',
    resourceId: loaded.server.id,
  };
  try {
    const result = await fn();
    const tracked = !!result.providerRef && typeof loaded.adapter.getTaskStatus === 'function';
    await ctx.db
      .update(serverActions)
      .set({
        providerRef: result.providerRef ?? null,
        status: tracked ? 'running' : 'success',
        finishedAt: tracked ? null : new Date(),
      })
      .where(eq(serverActions.id, action!.id));
    await ctx.audit.record(req, { ...auditBase, details: { ...details, result: result.message ?? null } });
    // Pick up state changes shortly after the provider had time to act.
    ctx.sync.refreshSoon(loaded.server.id);
    return { ...result, actionId: action!.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.db
      .update(serverActions)
      .set({ status: 'error', error: message.slice(0, 1000), finishedAt: new Date() })
      .where(eq(serverActions.id, action!.id));
    await ctx.audit.record(req, { ...auditBase, status: 'failure', details: { ...details, error: message } });
    throw err instanceof AppError ? err : new AppError(500, 'action_failed', message);
  }
}
