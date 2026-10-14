import { and, asc, count, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  MONITOR_DEFAULT_INTERVAL_SECONDS,
  MONITOR_HISTORY_RANGES,
  MONITOR_HOST_MAX,
  MONITOR_KEYWORD_MAX,
  MONITOR_KINDS,
  MONITOR_MAX_INTERVAL_SECONDS,
  MONITOR_MAX_MONITORS_LIMIT,
  MONITOR_MIN_INTERVAL_SECONDS,
  MONITOR_NAME_MAX,
  MONITOR_ORIGINS,
  MONITOR_STATUSES,
  MONITOR_STATUS_CODE_PATTERN,
  MONITOR_STATUS_PAGE_SLUG_PATTERN,
  MONITOR_URL_MAX,
  PROVIDER_LABELS,
  isMonitorKind,
  monitorTargetHost,
  monitorTargetIssues,
  monitorTargetLabel,
  normalizeModules,
  type MonitorAllowanceDto,
  type MonitorConfig,
  type MonitorDetailDto,
  type MonitorDto,
  type MonitorHistoryDto,
  type MonitorHistoryRange,
  type MonitorKind,
  type MonitorStatusPageDto,
  type MonitorTargetInput,
  type MonitoringInstanceDto,
  type OrgMonitoringDto,
  type Permission,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import { orgScope, platformScope, requireAuth, requireSession } from '../../auth/access';
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
import {
  AppError,
  ProviderError,
  badRequest,
  conflict,
  forbidden,
  monitorLimit,
  notFound,
  unsupported,
} from '../../lib/errors';
import { parse } from '../../lib/validation';
import type {
  MonitorInput,
  MonitorPatch,
  MonitoringStatus,
  ProviderAdapter,
  RemoteMonitor,
  UptimeKumaConfig,
} from '../../providers/types';
import { assignmentTarget, loadDomain } from '../hosting/service';
import { loadOrg } from '../orgs/routes';
import { loadServer } from '../servers/service';
import {
  MONITORING_MODULE,
  canManageMonitors,
  committedMonitors,
  instanceHosts,
  kumaName,
  loadMonitor,
  loadMonitorAllowance,
  lockMonitorOrg,
  monitorAllowanceDto,
  monitorCommitments,
  monitorRow,
  monitorRowsQuery,
  monitorScope,
  noMonitorAllowance,
  readOnlyMonitor,
  requireManagement,
  requireMonitoring,
  statusPageIndex,
  statusPageUrls,
  supportsMonitoring,
  toMonitorDto,
  type LoadedMonitor,
} from './service';
import { assertPublicTarget, maskUrlSecrets } from './targets';

const idParams = z.object({ id: z.uuid() });
const orgParams = z.object({ orgId: z.uuid() });
const statusPageParams = orgParams.extend({ providerId: z.uuid() });

const name = z
  .string()
  .trim()
  .min(1)
  .max(MONITOR_NAME_MAX)
  .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), 'no control characters');
const statusCodes = z.array(z.string().regex(MONITOR_STATUS_CODE_PATTERN)).min(1).max(10);
const interval = z.number().int().min(MONITOR_MIN_INTERVAL_SECONDS).max(MONITOR_MAX_INTERVAL_SECONDS);
const method = z.enum(['GET', 'HEAD']);
const targetFields = {
  url: z.string().trim().max(MONITOR_URL_MAX).nullish(),
  hostname: z.string().trim().max(MONITOR_HOST_MAX).nullish(),
  port: z.number().int().min(1).max(65535).nullish(),
  keyword: z.string().max(MONITOR_KEYWORD_MAX).nullish(),
};
const createBody = z.object({
  kind: z.enum(MONITOR_KINDS),
  name,
  ...targetFields,
  invertKeyword: z.boolean().default(false),
  method: method.default('GET'),
  acceptedStatusCodes: statusCodes.default(['200-299']),
  intervalSeconds: interval.default(MONITOR_DEFAULT_INTERVAL_SECONDS),
  ignoreTls: z.boolean().default(false),
});
/** No defaults on patch (zod applies them inside optional fields): what is left out stays. */
const patchBody = z.object({
  name: name.optional(),
  ...targetFields,
  invertKeyword: z.boolean().optional(),
  method: method.optional(),
  acceptedStatusCodes: statusCodes.optional(),
  intervalSeconds: interval.optional(),
  ignoreTls: z.boolean().optional(),
});
const deleteBody = z.object({ confirm: z.string().max(200) });
const historyQuery = z.object({ range: z.enum(MONITOR_HISTORY_RANGES) });
const relatedQuery = z
  .object({ serverId: z.uuid().optional(), domainId: z.uuid().optional() })
  .refine((q) => !!q.serverId !== !!q.domainId, 'exactly one of serverId and domainId');
const adminListQuery = z.object({
  q: z.string().max(100).optional(),
  orgId: z.uuid().optional(),
  providerId: z.uuid().optional(),
  assigned: z.enum(['true', 'false']).optional(),
  origin: z.enum(MONITOR_ORIGINS).optional(),
  status: z.enum(MONITOR_STATUSES).optional(),
});
const assignBody = z.object({ orgId: z.uuid().nullable(), enableModule: z.boolean().default(true) });
const bulkAssignBody = z.object({
  providerId: z.uuid(),
  orgId: z.uuid(),
  enableModule: z.boolean().default(true),
});
const allowanceBody = z.object({
  providerId: z.uuid(),
  maxMonitors: z.number().int().min(1).max(MONITOR_MAX_MONITORS_LIMIT),
  minIntervalSeconds: interval,
  enableModule: z.boolean().default(true),
});
const resellerAllowanceBody = allowanceBody.omit({ providerId: true, enableModule: true });
const statusPageBody = z.object({
  providerId: z.uuid(),
  slug: z.string().trim().toLowerCase().regex(MONITOR_STATUS_PAGE_SLUG_PATTERN),
  // Shown to customers as a link: http(s) only.
  url: z
    .union([z.literal(''), z.url({ protocol: /^https?$/ }).max(500)])
    .nullish()
    .transform((v) => (v ? v : null)),
});
const signInBody = z.object({
  username: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(500),
  totp: z
    .string()
    .trim()
    .regex(/^\d{6}$/)
    .optional(),
});

/** Target fields that are read from Uptime Kuma when a patch touches them. */
const CONFIG_FIELDS = [
  'url',
  'hostname',
  'port',
  'keyword',
  'invertKeyword',
  'method',
  'acceptedStatusCodes',
  'ignoreTls',
] as const;

const NO_HISTORY = 'No history available for this monitor and range';
const NOT_SIGNED_IN = 'not signed in for management';

const like = (q: string) => `%${q.replace(/[%_]/g, '')}%`;
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
const isWeb = (kind: MonitorKind) => kind === 'http' || kind === 'keyword';
const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** Session tokens and passwords must not end up in browser or proxy caches. */
function noStore(reply: FastifyReply) {
  reply.header('cache-control', 'no-store');
}

/** The target fields of a kind, trimmed; the others are left out. */
function targetInput(
  kind: MonitorKind,
  body: { url?: string | null; hostname?: string | null; port?: number | null; keyword?: string | null },
): MonitorTargetInput {
  return {
    kind,
    url: isWeb(kind) ? (body.url?.trim() ?? null) : null,
    hostname: isWeb(kind) ? null : (body.hostname?.trim() ?? null),
    port: kind === 'port' ? (body.port ?? null) : null,
    keyword: kind === 'keyword' ? (body.keyword ?? null) : null,
  };
}

/** Display target as stored: secret-looking query values of URLs masked. */
function displayTarget(input: MonitorTargetInput): string {
  const label = monitorTargetLabel(input);
  return isWeb(input.kind) ? maskUrlSecrets(label) : label;
}

/** Audit entry of a change at the instance. */
interface InstanceEntry {
  action: string;
  orgId: string | null;
  resourceType?: string;
  resourceId: string | null;
  details: Record<string, unknown>;
}

/**
 * A change at the instance that failed inside a transaction. It is audited only after the
 * rollback: the audit needs a pool connection of its own, and awaiting one while the
 * transaction holds a connection (and the org lock) can exhaust the pool.
 */
class InstanceFailure extends Error {
  constructor(readonly error: unknown) {
    super(errorMessage(error));
  }
}

/** Runs a change at the instance inside a transaction; a failure becomes an InstanceFailure. */
async function inTransaction<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new InstanceFailure(err);
  }
}

/**
 * Monitoring: monitors of an organization (live facts, history, own monitors within an
 * allowance), related monitors of servers and domains, the admin area (inventory, assignment,
 * instances, management sign-in, allowances, status pages) and reseller allowances.
 */
export async function monitoringRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, access, audit, providers, box } = ctx;

  async function monitorFor(req: FastifyRequest, permission?: Permission): Promise<LoadedMonitor> {
    const { id } = parse(idParams, req.params);
    const loaded = await loadMonitor(ctx, req, id);
    if (permission) await access.assert(req, permission, loaded.scope);
    return loaded;
  }

  async function monitorDto(req: FastifyRequest, id: string): Promise<MonitorDto> {
    const row = await monitorRow(ctx, id);
    if (!row) throw notFound('Monitor');
    return toMonitorDto(ctx, req, row);
  }

  /** Inside a transaction pass `tx`: a second pool connection must never be awaited there. */
  async function connectionById(id: string, from: DbOrTx = db): Promise<ProviderConnection> {
    const connection = await from.query.providerConnections.findFirst({
      where: eq(providerConnections.id, id),
    });
    if (!connection) throw notFound('Provider');
    return connection;
  }

  async function orgById(id: string): Promise<Organization> {
    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, id) });
    if (!org) throw notFound('Organization');
    return org;
  }

  /** Audits a failed change at the instance. Returns the error to answer with (an AppError). */
  async function failedAtInstance(
    req: FastifyRequest,
    entry: InstanceEntry,
    err: unknown,
  ): Promise<AppError> {
    const error = err instanceof InstanceFailure ? err.error : err;
    await audit.record(req, {
      action: entry.action,
      orgId: entry.orgId,
      resourceType: entry.resourceType ?? 'monitor',
      resourceId: entry.resourceId,
      status: 'failure',
      details: { ...entry.details, error: errorMessage(error) },
    });
    return error instanceof AppError ? error : new AppError(500, 'action_failed', errorMessage(error));
  }

  /**
   * Runs a change at the instance. A failure is audited (the success is audited by the caller,
   * once it knows the outcome) and surfaces as an AppError. Inside a transaction use
   * inTransaction instead.
   */
  async function atInstance<T>(req: FastifyRequest, entry: InstanceEntry, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw await failedAtInstance(req, entry, err);
    }
  }

  /**
   * Activates the monitoring module inside the transaction. Returns whether it was off. Takes the
   * organization's row lock: call it before lockMonitorOrg, like the reseller hand-over does.
   */
  async function enableMonitoring(tx: Tx, orgId: string): Promise<boolean> {
    const [target] = await tx
      .select({ modules: organizations.modules })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .for('update');
    if (!target || target.modules.includes(MONITORING_MODULE)) return false;
    await tx
      .update(organizations)
      .set({ modules: normalizeModules([...target.modules, MONITORING_MODULE]) })
      .where(eq(organizations.id, orgId));
    return true;
  }

  /** Slug of the organization's status page on the monitor's instance. */
  async function statusPageSlug(monitor: Pick<Monitor, 'orgId' | 'providerConnectionId'>) {
    if (!monitor.orgId) return null;
    const page = await db.query.monitorStatusPages.findFirst({
      where: and(
        eq(monitorStatusPages.orgId, monitor.orgId),
        eq(monitorStatusPages.providerConnectionId, monitor.providerConnectionId),
      ),
    });
    return page?.slug ?? null;
  }

  async function statusPageDtos(orgId: string): Promise<MonitorStatusPageDto[]> {
    const rows = await db
      .select({ page: monitorStatusPages, connection: providerConnections })
      .from(monitorStatusPages)
      .innerJoin(providerConnections, eq(providerConnections.id, monitorStatusPages.providerConnectionId))
      .where(eq(monitorStatusPages.orgId, orgId))
      .orderBy(asc(providerConnections.name));
    const urls = await statusPageUrls(ctx, orgId);
    return rows.flatMap(({ page, connection }) => {
      const url = urls.get(connection.id);
      return url
        ? [
            {
              provider: { id: connection.id, type: connection.type, name: connection.name },
              slug: page.slug,
              url,
            },
          ]
        : [];
    });
  }

  /** "Not signed in" or the cached management error of the instance; null when management works. */
  async function managementError(adapter: ProviderAdapter): Promise<string | null> {
    if (!canManageMonitors(adapter)) return NOT_SIGNED_IN;
    if (!adapter.monitoringStatus) return null;
    try {
      const status = await adapter.monitoringStatus();
      return status.management === 'error' ? (status.managementError ?? 'management unavailable') : null;
    } catch (err) {
      return errorMessage(err);
    }
  }

  /** "recent" only for a monitor that is on the organization's status page. */
  async function historyRanges(
    adapter: ProviderAdapter,
    externalId: string,
    slug: string | null,
  ): Promise<MonitorHistoryRange[]> {
    if (!adapter.monitorHistoryRanges) return [];
    let pageSlug = slug;
    if (slug && adapter.getStatusPage) {
      try {
        const page = await adapter.getStatusPage(slug);
        if (!page.monitorIds.includes(externalId)) pageSlug = null;
      } catch {
        pageSlug = null;
      }
    }
    return adapter.monitorHistoryRanges({ statusPageSlug: pageSlug });
  }

  /** Stores what a live read reported, like the sync does. */
  async function storeLive(monitor: Monitor, remote: RemoteMonitor): Promise<void> {
    await db
      .update(monitors)
      .set({
        name: sql`case when ${monitors.name} = ${monitors.providerName} then ${remote.name} else ${monitors.name} end`,
        providerName: remote.name,
        target: remote.target,
        targetHost: remote.targetHost,
        status: remote.status,
        ...(remote.active !== null ? { active: remote.active } : {}),
        ...(remote.intervalSeconds !== null ? { intervalSeconds: remote.intervalSeconds } : {}),
        facts: remote.facts,
        lastSyncedAt: new Date(),
        missingSince: null,
      })
      .where(eq(monitors.id, monitor.id));
  }

  /** The configuration in Uptime Kuma, for changes that build on it. */
  async function liveConfig(loaded: LoadedMonitor): Promise<MonitorConfig> {
    const live = await loaded.adapter.getMonitor!(loaded.monitor.externalId);
    if (!live.config) {
      throw new ProviderError(
        PROVIDER_LABELS[loaded.connection.type],
        'the configuration of this monitor cannot be read right now (management unavailable)',
      );
    }
    return live.config;
  }

  async function instanceDtos(connections: ProviderConnection[]): Promise<MonitoringInstanceDto[]> {
    const counts = new Map(
      (
        await db
          .select({
            providerId: monitors.providerConnectionId,
            monitors: count(),
            assigned: count(monitors.orgId),
          })
          .from(monitors)
          .groupBy(monitors.providerConnectionId)
      ).map((r) => [r.providerId, r]),
    );
    const instances = connections.flatMap((connection) => {
      try {
        const adapter = providers.forConnection(connection);
        return supportsMonitoring(adapter) ? [{ connection, adapter }] : [];
      } catch {
        // Credentials that cannot be decrypted: not usable for anything.
        return [];
      }
    });
    return Promise.all(
      instances.map(async ({ connection, adapter }): Promise<MonitoringInstanceDto> => {
        let status: MonitoringStatus;
        try {
          status = adapter.monitoringStatus
            ? await adapter.monitoringStatus()
            : {
                version: null,
                management: canManageMonitors(adapter) ? 'ok' : 'off',
                managementError: null,
                uptimeMetrics: false,
              };
        } catch (err) {
          status = {
            version: null,
            management: 'error',
            managementError: errorMessage(err),
            uptimeMetrics: false,
          };
        }
        const n = counts.get(connection.id);
        return {
          provider: { id: connection.id, type: connection.type, name: connection.name },
          version: status.version,
          management: status.management,
          managementError: status.managementError,
          uptimeMetrics: status.uptimeMetrics,
          monitors: n?.monitors ?? 0,
          assigned: n?.assigned ?? 0,
          managedBy: connection.managedBy,
        };
      }),
    );
  }

  // --- Customer view ----------------------------------------------------------------

  app.get('/orgs/:orgId/monitoring', async (req): Promise<OrgMonitoringDto> => {
    const { orgId } = parse(orgParams, req.params);
    const org = await loadOrg(ctx, req, orgId);
    const orgLevel = await access.can(req, 'monitor:read', orgScope(orgId));
    const rows = await monitorRowsQuery(ctx).where(eq(monitors.orgId, orgId)).orderBy(asc(monitors.name));
    const visible: typeof rows = [];
    for (const row of rows) {
      if (await access.can(req, 'monitor:read', monitorScope(row.monitor))) visible.push(row);
    }
    // So the page can tell "no access" from "no monitors".
    if (!orgLevel && visible.length === 0) throw forbidden('Missing permission monitor:read');
    const pages = await statusPageUrls(ctx, orgId);
    return {
      allowance: orgLevel ? await monitorAllowanceDto(ctx, org) : null,
      monitors: await Promise.all(visible.map((row) => toMonitorDto(ctx, req, row, pages))),
      statusPages: orgLevel ? await statusPageDtos(orgId) : [],
    };
  });

  /** Monitors of the same organization that check a server's addresses or a domain's names. */
  app.get('/monitors/related', async (req): Promise<MonitorDto[]> => {
    const query = parse(relatedQuery, req.query);
    let orgId: string | null;
    let condition: SQL | undefined;
    if (query.serverId) {
      const loaded = await loadServer(ctx, req, query.serverId);
      orgId = loaded.project?.orgId ?? null;
      const hosts = [
        ...new Set(
          loaded.server.ips
            .flatMap((ip) => [ip.address, ip.rdns])
            .filter((h): h is string => typeof h === 'string' && h.length > 0)
            .map((h) =>
              h
                .trim()
                .toLowerCase()
                .replace(/^\[|\]$/g, '')
                .replace(/\.$/, ''),
            ),
        ),
      ];
      if (hosts.length === 0) return [];
      condition = inArray(monitors.targetHost, hosts);
    } else {
      const loaded = await loadDomain(ctx, req, query.domainId!);
      orgId = loaded.domain.orgId;
      const domain = loaded.domain.name.trim().toLowerCase().replace(/\.$/, '');
      // The domain or one of its subdomains, exact strings only (no DNS lookups).
      condition = or(
        eq(monitors.targetHost, domain),
        sql`right(${monitors.targetHost}, ${domain.length + 1}::int) = ${`.${domain}`}`,
      );
    }
    if (!orgId) return [];
    const rows = await monitorRowsQuery(ctx)
      .where(and(eq(monitors.orgId, orgId), condition))
      .orderBy(asc(monitors.name))
      .limit(200);
    const visible: typeof rows = [];
    for (const row of rows) {
      if (await access.can(req, 'monitor:read', monitorScope(row.monitor))) visible.push(row);
    }
    // Down first, then by name (the query's order).
    visible.sort((a, b) => Number(b.monitor.status === 'down') - Number(a.monitor.status === 'down'));
    const pages = await statusPageUrls(ctx, orgId);
    return Promise.all(visible.slice(0, 20).map((row) => toMonitorDto(ctx, req, row, pages)));
  });

  app.get('/monitors/:id', async (req): Promise<MonitorDetailDto> => {
    const loaded = await monitorFor(req);
    const { monitor, adapter } = loaded;
    const slug = await statusPageSlug(monitor);
    let config: MonitorConfig | null = null;
    let events: MonitorDetailDto['events'] = null;
    let liveError: string | null = null;
    if (adapter.getMonitor) {
      try {
        const live = await adapter.getMonitor(monitor.externalId);
        await storeLive(monitor, live.monitor);
        config = live.config;
        events = live.events;
      } catch (err) {
        liveError = errorMessage(err);
      }
    } else {
      liveError = 'This provider has no live monitor data';
    }
    const row = await monitorRow(ctx, monitor.id);
    if (!row) throw notFound('Monitor');
    return {
      ...(await toMonitorDto(ctx, req, row)),
      config,
      events,
      historyRanges: await historyRanges(adapter, monitor.externalId, slug),
      liveError,
      managementError: await managementError(adapter),
    };
  });

  app.get('/monitors/:id/history', async (req): Promise<MonitorHistoryDto> => {
    const loaded = await monitorFor(req);
    const { range } = parse(historyQuery, req.query);
    const { adapter, monitor } = loaded;
    if (!adapter.getMonitorHistory) throw new AppError(404, 'not_found', NO_HISTORY);
    const history = await adapter.getMonitorHistory(monitor.externalId, range, {
      statusPageSlug: await statusPageSlug(monitor),
    });
    if (!history) throw new AppError(404, 'not_found', NO_HISTORY);
    return history;
  });

  app.post('/orgs/:orgId/monitors', async (req): Promise<MonitorDto> => {
    const { orgId } = parse(orgParams, req.params);
    const auth = requireAuth(req);
    const org = await loadOrg(ctx, req, orgId);
    await access.assert(req, 'monitor:write', orgScope(orgId));
    const body = parse(createBody, req.body);
    const target = targetInput(body.kind, body);
    const issues = monitorTargetIssues(target);
    if (issues.length > 0) throw badRequest('Validation failed', issues);

    // The instance it goes to (checked again under the lock), then the target: DNS can take
    // seconds, so outside any transaction.
    const planned = await loadMonitorAllowance(db, orgId);
    if (!planned) throw noMonitorAllowance();
    const plannedAdapter = providers.forConnection(planned.connection);
    requireManagement(plannedAdapter);
    await assertPublicTarget(monitorTargetHost(target) ?? '', isWeb(body.kind) ? 'url' : 'hostname', {
      instanceHosts: instanceHosts(plannedAdapter),
    });

    const input: MonitorInput = {
      kind: body.kind,
      name: kumaName(org.slug, body.name),
      url: target.url ?? null,
      hostname: target.hostname ?? null,
      port: target.port ?? null,
      keyword: target.keyword ?? null,
      invertKeyword: body.kind === 'keyword' ? body.invertKeyword : false,
      method: body.method,
      acceptedStatusCodes: body.acceptedStatusCodes,
      intervalSeconds: body.intervalSeconds,
      ignoreTls: body.ignoreTls,
    };
    const details: Record<string, unknown> = {
      name: body.name,
      kind: body.kind,
      target: displayTarget(target),
      intervalSeconds: body.intervalSeconds,
      providerId: planned.connection.id,
    };
    const entry: InstanceEntry = { action: 'monitor.create', orgId, resourceId: null, details };
    // Set once the monitor exists at the instance, to remove it again if storing it fails.
    let created = null as { adapter: ProviderAdapter; externalId: string } | null;
    let id: string;
    try {
      id = await db.transaction(async (tx) => {
        // Held until the monitor is stored, so parallel requests see each other's monitors.
        // Everything in here goes through tx: no second pool connection while the lock is held.
        await lockMonitorOrg(tx, org);
        const loaded = await loadMonitorAllowance(tx, orgId);
        if (!loaded) throw noMonitorAllowance();
        const { allowance, connection } = loaded;
        if (connection.id !== planned.connection.id) {
          throw conflict('The monitoring allowance moved to another instance meanwhile. Try again.');
        }
        const adapter = providers.forConnection(connection);
        requireManagement(adapter);
        if (body.intervalSeconds < allowance.minIntervalSeconds) {
          throw badRequest('Validation failed', [
            {
              path: 'intervalSeconds',
              message: `The allowance allows an interval of ${allowance.minIntervalSeconds} seconds at the shortest`,
            },
          ]);
        }
        const usage = await monitorCommitments(tx, org, connection.id);
        if (committedMonitors(usage) + 1 > allowance.maxMonitors) {
          throw monitorLimit(`The allowance covers at most ${allowance.maxMonitors} monitors`, {
            maxMonitors: allowance.maxMonitors,
            committed: committedMonitors(usage),
          });
        }

        const remote = await inTransaction(() => adapter.createMonitor!(input));
        created = { adapter, externalId: remote.externalId };
        details.externalId = remote.externalId;
        const now = new Date();
        const values = {
          orgId,
          origin: 'console' as const,
          name: body.name,
          providerName: input.name,
          type: remote.type || body.kind,
          target: remote.target ?? displayTarget(target),
          targetHost: remote.targetHost ?? monitorTargetHost(target),
          status: remote.status,
          active: true,
          intervalSeconds: body.intervalSeconds,
          facts: remote.facts,
          createdBy: auth.user.id,
          lastSyncedAt: now,
          missingSince: null,
          // Now, not when the transaction began (before the instance had it): the sync takes
          // monitors created before it read the list as missing.
          createdAt: now,
        };
        const [row] = await tx
          .insert(monitors)
          .values({ providerConnectionId: connection.id, externalId: remote.externalId, ...values })
          // The sync found it first (its list was read after Kuma created it): take the row over,
          // but never a row another organization holds (an id Kuma gave out a second time).
          .onConflictDoUpdate({
            target: [monitors.providerConnectionId, monitors.externalId],
            set: values,
            setWhere: or(isNull(monitors.orgId), eq(monitors.orgId, orgId)),
          })
          .returning({ id: monitors.id });
        if (!row) {
          throw conflict(
            `Uptime Kuma gave the new monitor the id ${remote.externalId}, which belongs to a monitor of another organization here. It was removed again; try once more.`,
          );
        }
        return row.id;
      });
    } catch (err) {
      // After the rollback, so audit and cleanup do not wait for a connection while holding one.
      if (err instanceof InstanceFailure) throw await failedAtInstance(req, entry, err);
      if (created) {
        // At the instance, but not stored: remove it, or it runs on outside every allowance.
        const { adapter, externalId } = created;
        const removed = await adapter.deleteMonitor!(externalId).then(
          () => true,
          () => false,
        );
        await audit.record(req, {
          ...entry,
          resourceType: 'monitor',
          status: 'failure',
          details: { ...details, error: errorMessage(err), removedAtInstance: removed },
        });
      }
      throw err;
    }

    await audit.record(req, { ...entry, resourceType: 'monitor', resourceId: id, details });
    return monitorDto(req, id);
  });

  app.patch('/monitors/:id', async (req): Promise<MonitorDto> => {
    const loaded = await monitorFor(req, 'monitor:write');
    const body = parse(patchBody, req.body);
    const { monitor: current, org, adapter } = loaded;
    if (current.origin !== 'console' || !isMonitorKind(current.type)) throw readOnlyMonitor();
    requireManagement(adapter);
    const kind = current.type;
    const web = isWeb(kind);

    const patch: MonitorPatch = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const change = <K extends keyof MonitorPatch>(key: K, from: unknown, to: MonitorPatch[K]) => {
      patch[key] = to;
      before[key] = from;
      after[key] = to;
    };

    if (body.name !== undefined && body.name !== current.name) {
      change('name', current.name, org ? kumaName(org.slug, body.name) : body.name);
      before.name = current.name;
      after.name = body.name;
    }
    const config = CONFIG_FIELDS.some((k) => body[k] !== undefined) ? await liveConfig(loaded) : null;
    const currentInterval = config?.intervalSeconds ?? current.intervalSeconds;
    if (body.intervalSeconds !== undefined && body.intervalSeconds !== currentInterval) {
      change('intervalSeconds', currentInterval, body.intervalSeconds);
    }

    let next: MonitorTargetInput | null = null;
    if (config) {
      const given = targetInput(kind, body);
      next = {
        kind,
        url: web && body.url !== undefined ? (given.url ?? null) : config.url,
        hostname: !web && body.hostname !== undefined ? (given.hostname ?? null) : config.hostname,
        port: kind === 'port' && body.port !== undefined ? (given.port ?? null) : config.port,
        keyword: kind === 'keyword' && body.keyword !== undefined ? (given.keyword ?? null) : config.keyword,
      };
      for (const key of ['url', 'hostname', 'port', 'keyword'] as const) {
        if (next[key] !== config[key]) change(key, config[key], next[key] ?? null);
      }
      if (
        kind === 'keyword' &&
        body.invertKeyword !== undefined &&
        body.invertKeyword !== config.invertKeyword
      ) {
        change('invertKeyword', config.invertKeyword, body.invertKeyword);
      }
      // Method, status codes and TLS only matter for HTTP(S) checks.
      if (web && body.method !== undefined && body.method !== config.method) {
        change('method', config.method, body.method);
      }
      if (
        web &&
        body.acceptedStatusCodes !== undefined &&
        !sameList(body.acceptedStatusCodes, config.acceptedStatusCodes)
      ) {
        change('acceptedStatusCodes', config.acceptedStatusCodes, body.acceptedStatusCodes);
      }
      if (web && body.ignoreTls !== undefined && body.ignoreTls !== config.ignoreTls) {
        change('ignoreTls', config.ignoreTls, body.ignoreTls);
      }
    }
    if (Object.keys(patch).length === 0) return toMonitorDto(ctx, req, loaded);

    if (patch.intervalSeconds !== undefined && current.orgId) {
      const allowance = await loadMonitorAllowance(db, current.orgId);
      if (!allowance || allowance.connection.id !== current.providerConnectionId) {
        throw noMonitorAllowance(
          'This organization has no monitoring allowance on the instance of this monitor',
        );
      }
      if (patch.intervalSeconds < allowance.allowance.minIntervalSeconds) {
        throw badRequest('Validation failed', [
          {
            path: 'intervalSeconds',
            message: `The allowance allows an interval of ${allowance.allowance.minIntervalSeconds} seconds at the shortest`,
          },
        ]);
      }
    }
    const targetChanged = (['url', 'hostname', 'port', 'keyword'] as const).some((k) => k in patch);
    if (next && targetChanged) {
      const issues = monitorTargetIssues(next);
      if (issues.length > 0) throw badRequest('Validation failed', issues);
      if ('url' in patch || 'hostname' in patch) {
        await assertPublicTarget(monitorTargetHost(next) ?? '', web ? 'url' : 'hostname', {
          instanceHosts: instanceHosts(adapter),
        });
      }
    }

    // URLs in the audit with secret-looking query values masked.
    for (const side of [before, after]) {
      if (typeof side.url === 'string') side.url = maskUrlSecrets(side.url);
    }
    const entry: InstanceEntry = {
      action: 'monitor.update',
      orgId: current.orgId,
      resourceId: current.id,
      details: { name: current.name, externalId: current.externalId, before, after },
    };
    await atInstance(req, entry, () => adapter.updateMonitor!(current.externalId, patch));
    await db
      .update(monitors)
      .set({
        ...(body.name !== undefined && patch.name !== undefined
          ? { name: body.name, providerName: patch.name }
          : {}),
        ...(next && targetChanged
          ? { target: displayTarget(next), targetHost: monitorTargetHost(next) }
          : {}),
        ...(patch.intervalSeconds !== undefined ? { intervalSeconds: patch.intervalSeconds } : {}),
      })
      .where(eq(monitors.id, current.id));
    await audit.record(req, { ...entry, resourceType: 'monitor' });
    return monitorDto(req, current.id);
  });

  /** Pauses or resumes a console monitor at the instance. */
  async function toggle(req: FastifyRequest, action: 'pause' | 'resume'): Promise<MonitorDto> {
    const loaded = await monitorFor(req, 'monitor:write');
    const { monitor: current, adapter } = loaded;
    if (current.origin !== 'console') throw readOnlyMonitor();
    requireManagement(adapter);
    const entry: InstanceEntry = {
      action: `monitor.${action}`,
      orgId: current.orgId,
      resourceId: current.id,
      details: { name: current.name, externalId: current.externalId },
    };
    await atInstance(req, entry, () =>
      action === 'pause'
        ? adapter.pauseMonitor!(current.externalId)
        : adapter.resumeMonitor!(current.externalId),
    );
    // A resumed monitor has no status until its first check.
    await db
      .update(monitors)
      .set(action === 'pause' ? { active: false, status: 'paused' } : { active: true, status: 'pending' })
      .where(eq(monitors.id, current.id));
    await audit.record(req, { ...entry, resourceType: 'monitor' });
    return monitorDto(req, current.id);
  }

  app.post('/monitors/:id/pause', (req) => toggle(req, 'pause'));
  app.post('/monitors/:id/resume', (req) => toggle(req, 'resume'));

  app.delete('/monitors/:id', async (req) => {
    const loaded = await monitorFor(req, 'monitor:delete');
    const { monitor: current, adapter } = loaded;
    const { confirm } = parse(deleteBody, req.body ?? {});
    const missing = current.missingSince !== null;
    // Console monitors are deleted in Kuma too; rows missing there are only removed here.
    const atKuma = current.origin === 'console' && canManageMonitors(adapter);
    if (current.origin !== 'console' && !missing) throw readOnlyMonitor();
    if (current.origin === 'console' && !atKuma && !missing) requireManagement(adapter);
    if (confirm !== current.name) {
      throw badRequest('Validation failed', [
        { path: 'confirm', message: `Type the name ${current.name} to confirm` },
      ]);
    }
    const entry: InstanceEntry = {
      action: 'monitor.delete',
      orgId: current.orgId,
      resourceId: current.id,
      details: {
        name: current.name,
        providerName: current.providerName,
        target: current.target,
        origin: current.origin,
        externalId: current.externalId,
        providerId: current.providerConnectionId,
      },
    };
    if (atKuma) {
      await atInstance(req, entry, async () => {
        try {
          await adapter.deleteMonitor!(current.externalId);
        } catch (err) {
          // Gone in Kuma already (deleted there): only the row is left to remove.
          if (!(err instanceof AppError && err.statusCode === 404 && missing)) throw err;
        }
      });
    }
    await db.delete(monitors).where(eq(monitors.id, current.id));
    await audit.record(req, { ...entry, resourceType: 'monitor' });
    return { ok: true };
  });

  // --- Admin: inventory and assignment ----------------------------------------------

  app.get('/admin/monitors', async (req): Promise<MonitorDto[]> => {
    await access.assert(req, 'platform:provider:read', platformScope);
    const query = parse(adminListQuery, req.query);
    const filters: (SQL | undefined)[] = [
      query.orgId ? eq(monitors.orgId, query.orgId) : undefined,
      query.providerId ? eq(monitors.providerConnectionId, query.providerId) : undefined,
      query.assigned === 'true' ? isNotNull(monitors.orgId) : undefined,
      query.assigned === 'false' ? isNull(monitors.orgId) : undefined,
      query.origin ? eq(monitors.origin, query.origin) : undefined,
      query.status ? eq(monitors.status, query.status) : undefined,
      query.q
        ? or(
            ilike(monitors.name, like(query.q)),
            ilike(monitors.providerName, like(query.q)),
            ilike(monitors.target, like(query.q)),
          )
        : undefined,
    ];
    const rows = await monitorRowsQuery(ctx)
      .where(and(...filters))
      .orderBy(asc(monitors.name))
      .limit(1000);
    const pages = await statusPageIndex(
      ctx,
      rows.flatMap((r) => (r.monitor.orgId ? [r.monitor.orgId] : [])),
    );
    return Promise.all(
      rows.map((row) =>
        toMonitorDto(
          ctx,
          req,
          row,
          row.monitor.orgId ? (pages.get(row.monitor.orgId) ?? new Map()) : undefined,
        ),
      ),
    );
  });

  app.post('/admin/monitors/:id/assign', async (req): Promise<MonitorDto> => {
    await access.assert(req, 'platform:server:assign', platformScope);
    const { id } = parse(idParams, req.params);
    const body = parse(assignBody, req.body);
    const current = await db.query.monitors.findFirst({ where: eq(monitors.id, id) });
    if (!current) throw notFound('Monitor');
    const target = body.orgId
      ? await assignmentTarget(db, body.orgId, MONITORING_MODULE, body.enableModule)
      : null;
    // Staff decide about allowances: console monitors move without a check (the UI warns).
    const moduleEnabled = await db.transaction(async (tx) => {
      const enabled = target?.enable ? await enableMonitoring(tx, target.org.id) : false;
      await tx.update(monitors).set({ orgId: body.orgId }).where(eq(monitors.id, id));
      return enabled;
    });
    await audit.record(req, {
      action: body.orgId ? 'monitor.assign' : 'monitor.unassign',
      orgId: body.orgId ?? current.orgId,
      resourceType: 'monitor',
      resourceId: id,
      details: {
        name: current.name,
        orgId: body.orgId,
        previousOrgId: current.orgId,
        moduleEnabled: moduleEnabled ? MONITORING_MODULE : null,
      },
    });
    return monitorDto(req, id);
  });

  /** Every unassigned monitor of an instance to one organization (dedicated instances). */
  app.post('/admin/monitors/assign-bulk', async (req): Promise<{ assigned: number }> => {
    await access.assert(req, 'platform:server:assign', platformScope);
    const body = parse(bulkAssignBody, req.body);
    const connection = await connectionById(body.providerId);
    requireMonitoring(providers.forConnection(connection));
    const target = await assignmentTarget(db, body.orgId, MONITORING_MODULE, body.enableModule);
    const { assigned, moduleEnabled } = await db.transaction(async (tx) => {
      const enabled = target.enable ? await enableMonitoring(tx, body.orgId) : false;
      const rows = await tx
        .update(monitors)
        .set({ orgId: body.orgId })
        .where(and(eq(monitors.providerConnectionId, connection.id), isNull(monitors.orgId)))
        .returning({ id: monitors.id });
      return { assigned: rows.length, moduleEnabled: enabled };
    });
    await audit.record(req, {
      action: 'monitor.assign_bulk',
      orgId: body.orgId,
      resourceType: 'provider',
      resourceId: connection.id,
      details: {
        providerId: connection.id,
        orgId: body.orgId,
        count: assigned,
        moduleEnabled: moduleEnabled ? MONITORING_MODULE : null,
      },
    });
    return { assigned };
  });

  // --- Admin: instances and management sign-in ---------------------------------------

  app.get('/admin/monitoring/instances', async (req): Promise<MonitoringInstanceDto[]> => {
    await access.assert(req, 'platform:provider:read', platformScope);
    const connections = await db.select().from(providerConnections).orderBy(asc(providerConnections.name));
    return instanceDtos(connections);
  });

  async function instanceDto(id: string): Promise<MonitoringInstanceDto> {
    const [dto] = await instanceDtos([await connectionById(id)]);
    if (!dto) throw unsupported('This provider has no monitors');
    return dto;
  }

  /** An Uptime Kuma connection staff may sign in or out (not one from environment variables). */
  async function kumaConnection(req: FastifyRequest): Promise<ProviderConnection> {
    requireSession(req);
    await access.assert(req, 'platform:provider:write', platformScope);
    const connection = await connectionById(parse(idParams, req.params).id);
    if (connection.type !== 'uptimekuma') {
      throw unsupported('Only Uptime Kuma connections are signed in for management');
    }
    if (connection.managedBy === 'env') {
      throw conflict(
        'This connection comes from environment variables. Set UPTIMEKUMA_SESSION_TOKEN there (pnpm --filter @weblion/api kuma:token).',
      );
    }
    return connection;
  }

  /** Rewrites the stored configuration under the row lock; `fn` returns null to leave it. */
  async function rewriteConfig(
    id: string,
    fn: (config: UptimeKumaConfig) => UptimeKumaConfig | null,
  ): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(providerConnections)
        .where(eq(providerConnections.id, id))
        .for('update');
      if (!locked) throw notFound('Provider');
      const next = fn(providers.decryptConfig<UptimeKumaConfig>(locked));
      if (!next) return false;
      await tx
        .update(providerConnections)
        .set({ configEnc: box.encryptJson(next), status: 'unknown', lastError: null })
        .where(eq(providerConnections.id, id));
      return true;
    });
  }

  /**
   * Exchanges the Kuma login for its session token and stores only the token (encrypted with the
   * connection's configuration). Password and two-factor code are never stored, logged or audited.
   */
  app.post('/admin/providers/:id/uptimekuma/session', async (req, reply): Promise<MonitoringInstanceDto> => {
    noStore(reply);
    const connection = await kumaConnection(req);
    const body = parse(signInBody, req.body);
    const adapter = providers.forConnection(connection);
    if (typeof adapter.signInForManagement !== 'function') {
      throw unsupported('This provider cannot sign in for management');
    }
    const baseUrl = providers.decryptConfig<UptimeKumaConfig>(connection).baseUrl;
    const secrets = [body.password, body.totp].filter((s): s is string => !!s && s.length >= 4);
    const scrub = (text: string) => secrets.reduce((t, s) => t.split(s).join('***'), text);
    const entry: InstanceEntry = {
      action: 'provider.update',
      orgId: null,
      resourceType: 'provider',
      resourceId: connection.id,
      details: { monitoringSession: 'sign_in', username: body.username },
    };
    const result = await atInstance(req, entry, async () => {
      try {
        return await adapter.signInForManagement!({
          username: body.username,
          password: body.password,
          ...(body.totp ? { totp: body.totp } : {}),
        });
      } catch (err) {
        // Belt and braces: the adapter scrubs its messages already.
        if (err instanceof AppError) {
          const message = scrub(err.message);
          if (message === err.message) throw err;
          throw new AppError(err.statusCode, err.code, message);
        }
        throw new Error(scrub(errorMessage(err)));
      }
    });
    await rewriteConfig(connection.id, (config) => {
      // The token belongs to the instance it came from.
      if (config.baseUrl !== baseUrl) {
        throw conflict('The address of this connection changed meanwhile. Sign in again.');
      }
      return { ...config, sessionToken: result.sessionToken };
    });
    providers.invalidate(connection.id);
    await audit.record(req, {
      action: 'provider.update',
      resourceType: 'provider',
      resourceId: connection.id,
      details: { monitoringSession: 'signed_in', username: body.username, version: result.version },
    });
    return instanceDto(connection.id);
  });

  app.delete('/admin/providers/:id/uptimekuma/session', async (req): Promise<MonitoringInstanceDto> => {
    const connection = await kumaConnection(req);
    const removed = await rewriteConfig(connection.id, (config) => {
      if (!config.sessionToken) return null;
      const next = { ...config };
      delete next.sessionToken;
      return next;
    });
    providers.invalidate(connection.id);
    await audit.record(req, {
      action: 'provider.update',
      resourceType: 'provider',
      resourceId: connection.id,
      details: { monitoringSession: 'signed_out', ...(removed ? {} : { wasSignedIn: false }) },
    });
    return instanceDto(connection.id);
  });

  // --- Allowances (admin and reseller) ------------------------------------------------

  /** Writes an allowance, keeping the creation date of an existing one. */
  async function upsertAllowance(
    tx: Tx,
    values: Pick<
      MonitorAllowance,
      'orgId' | 'providerConnectionId' | 'maxMonitors' | 'minIntervalSeconds' | 'updatedBy'
    >,
  ): Promise<void> {
    await tx
      .insert(monitorAllowances)
      .values(values)
      .onConflictDoUpdate({
        target: monitorAllowances.orgId,
        set: {
          providerConnectionId: values.providerConnectionId,
          maxMonitors: values.maxMonitors,
          minIntervalSeconds: values.minIntervalSeconds,
          updatedBy: values.updatedBy,
          updatedAt: new Date(),
        },
      });
  }

  /**
   * Checks a new or changed allowance of `org` (locked with lockMonitorOrg) against what it has
   * committed: its console monitors and, for a reseller, its customers' allowances.
   */
  async function assertAllowanceCovers(
    tx: Tx,
    org: Organization,
    current: MonitorAllowance | undefined,
    next: { providerId: string; maxMonitors: number; minIntervalSeconds: number },
  ): Promise<void> {
    if (current && current.providerConnectionId !== next.providerId) {
      const before = await monitorCommitments(tx, org, current.providerConnectionId);
      if (before.monitors > 0) {
        throw conflict(
          `This organization still has ${before.monitors} monitors created in the console on its instance. The instance can only change without them.`,
        );
      }
      if (before.customers > 0) {
        throw conflict(
          `This reseller handed out monitors on its instance to ${before.customers} customers. The instance can only change without them.`,
        );
      }
    }
    const usage = await monitorCommitments(tx, org, next.providerId);
    if (next.maxMonitors < committedMonitors(usage)) {
      throw monitorLimit(
        `${committedMonitors(usage)} monitors exist or are handed out already. The maximum cannot be lower than that.`,
        { maxMonitors: next.maxMonitors, committed: committedMonitors(usage) },
      );
    }
    if (org.kind === 'reseller' && usage.customers > 0) {
      // Customers' minimum intervals stay within the reseller's.
      const [row] = await tx
        .select({ shortest: sql<number | null>`min(${monitorAllowances.minIntervalSeconds})` })
        .from(monitorAllowances)
        .innerJoin(organizations, eq(organizations.id, monitorAllowances.orgId))
        .where(
          and(
            eq(organizations.parentOrgId, org.id),
            eq(monitorAllowances.providerConnectionId, next.providerId),
          ),
        );
      const shortest = row?.shortest === null || row?.shortest === undefined ? null : Number(row.shortest);
      if (shortest !== null && next.minIntervalSeconds > shortest) {
        throw badRequest('Validation failed', [
          {
            path: 'minIntervalSeconds',
            message: `Customers of this reseller may check every ${shortest} seconds. Raise their minimum first.`,
          },
        ]);
      }
    }
  }

  /** Removes an allowance nothing draws from any more (no console monitors, no customer allowances). */
  async function removeAllowance(org: Organization): Promise<MonitorAllowance> {
    return db.transaction(async (tx) => {
      await lockMonitorOrg(tx, org);
      const current = await tx.query.monitorAllowances.findFirst({
        where: eq(monitorAllowances.orgId, org.id),
      });
      if (!current) throw notFound('Monitoring allowance');
      const usage = await monitorCommitments(tx, org, current.providerConnectionId);
      if (usage.monitors > 0) {
        throw conflict(
          `This organization still has ${usage.monitors} monitors created in the console. Delete them or move them to another organization first.`,
        );
      }
      if (usage.customers > 0) {
        throw conflict(
          `This reseller handed out monitors to ${usage.customers} customers. Remove their allowances first.`,
        );
      }
      await tx.delete(monitorAllowances).where(eq(monitorAllowances.orgId, org.id));
      return current;
    });
  }

  const allowanceDetails = (
    a: Pick<MonitorAllowance, 'providerConnectionId' | 'maxMonitors' | 'minIntervalSeconds'>,
  ) => ({
    providerId: a.providerConnectionId,
    maxMonitors: a.maxMonitors,
    minIntervalSeconds: a.minIntervalSeconds,
  });

  app.get('/admin/orgs/:orgId/monitor-allowance', async (req): Promise<MonitorAllowanceDto | null> => {
    await access.assert(req, 'platform:org:read', platformScope);
    const { orgId } = parse(orgParams, req.params);
    return monitorAllowanceDto(ctx, await orgById(orgId));
  });

  app.put('/admin/orgs/:orgId/monitor-allowance', async (req): Promise<MonitorAllowanceDto> => {
    const auth = requireAuth(req);
    await access.assert(req, 'platform:org:write', platformScope);
    const { orgId } = parse(orgParams, req.params);
    const body = parse(allowanceBody, req.body);
    const org = await orgById(orgId);
    const connection = await connectionById(body.providerId);
    const adapter = providers.forConnection(connection);
    requireMonitoring(adapter);
    requireManagement(adapter);
    if (body.enableModule && org.parentOrgId && !org.modules.includes(MONITORING_MODULE)) {
      const parent = await orgById(org.parentOrgId);
      if (!parent.modules.includes(MONITORING_MODULE)) {
        throw conflict(
          `The reseller "${parent.name}" does not have the module "${MONITORING_MODULE}". Activate it for the reseller first.`,
        );
      }
    }
    const next = {
      providerId: connection.id,
      maxMonitors: body.maxMonitors,
      minIntervalSeconds: body.minIntervalSeconds,
    };

    const { previous, moduleEnabled } = await db.transaction(async (tx) => {
      // The row lock first, then the monitoring lock (the order of the reseller hand-over).
      const moduleEnabled = body.enableModule ? await enableMonitoring(tx, orgId) : false;
      await lockMonitorOrg(tx, org);
      const current = await tx.query.monitorAllowances.findFirst({
        where: eq(monitorAllowances.orgId, orgId),
      });
      await assertAllowanceCovers(tx, org, current, next);
      await upsertAllowance(tx, {
        orgId,
        providerConnectionId: next.providerId,
        maxMonitors: next.maxMonitors,
        minIntervalSeconds: next.minIntervalSeconds,
        updatedBy: auth.user.id,
      });
      return { previous: current ?? null, moduleEnabled };
    });
    await audit.record(req, {
      action: 'monitor.allowance_set',
      orgId,
      resourceType: 'monitor_allowance',
      resourceId: orgId,
      details: {
        ...next,
        previous: previous ? allowanceDetails(previous) : null,
        moduleEnabled: moduleEnabled ? MONITORING_MODULE : null,
      },
    });
    return (await monitorAllowanceDto(ctx, org))!;
  });

  app.delete('/admin/orgs/:orgId/monitor-allowance', async (req) => {
    await access.assert(req, 'platform:org:write', platformScope);
    const { orgId } = parse(orgParams, req.params);
    const removed = await removeAllowance(await orgById(orgId));
    await audit.record(req, {
      action: 'monitor.allowance_delete',
      orgId,
      resourceType: 'monitor_allowance',
      resourceId: orgId,
      details: allowanceDetails(removed),
    });
    return { ok: true };
  });

  // --- Admin: status pages ------------------------------------------------------------

  app.get('/admin/orgs/:orgId/monitor-status-pages', async (req): Promise<MonitorStatusPageDto[]> => {
    await access.assert(req, 'platform:org:read', platformScope);
    const { orgId } = parse(orgParams, req.params);
    await orgById(orgId);
    return statusPageDtos(orgId);
  });

  /** Links a status page staff created in Uptime Kuma; it must exist there. */
  app.put('/admin/orgs/:orgId/monitor-status-page', async (req): Promise<MonitorStatusPageDto> => {
    const auth = requireAuth(req);
    await access.assert(req, 'platform:org:write', platformScope);
    const { orgId } = parse(orgParams, req.params);
    const body = parse(statusPageBody, req.body);
    await orgById(orgId);
    const connection = await connectionById(body.providerId);
    const adapter = providers.forConnection(connection);
    requireMonitoring(adapter);
    if (typeof adapter.getStatusPage !== 'function') throw unsupported('This provider has no status pages');
    let page: { slug: string; title: string };
    try {
      page = await adapter.getStatusPage(body.slug);
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 404) {
        throw unsupported(`Uptime Kuma has no status page "${body.slug}"`);
      }
      if (err instanceof AppError) throw err;
      throw new ProviderError(PROVIDER_LABELS[connection.type], errorMessage(err));
    }
    const slug = page.slug || body.slug;
    const previous = await db.query.monitorStatusPages.findFirst({
      where: and(
        eq(monitorStatusPages.orgId, orgId),
        eq(monitorStatusPages.providerConnectionId, connection.id),
      ),
    });
    await db
      .insert(monitorStatusPages)
      .values({ orgId, providerConnectionId: connection.id, slug, url: body.url, updatedBy: auth.user.id })
      .onConflictDoUpdate({
        target: [monitorStatusPages.orgId, monitorStatusPages.providerConnectionId],
        set: { slug, url: body.url, updatedBy: auth.user.id, updatedAt: new Date() },
      });
    await audit.record(req, {
      action: 'monitor.status_page_set',
      orgId,
      resourceType: 'monitor_status_page',
      resourceId: orgId,
      details: {
        providerId: connection.id,
        slug,
        url: body.url,
        title: page.title,
        previous: previous ? { slug: previous.slug, url: previous.url } : null,
      },
    });
    return {
      provider: { id: connection.id, type: connection.type, name: connection.name },
      slug,
      url: body.url ?? adapter.statusPageUrl?.(slug) ?? '',
    };
  });

  app.delete('/admin/orgs/:orgId/monitor-status-page/:providerId', async (req) => {
    await access.assert(req, 'platform:org:write', platformScope);
    const { orgId, providerId } = parse(statusPageParams, req.params);
    const [removed] = await db
      .delete(monitorStatusPages)
      .where(
        and(eq(monitorStatusPages.orgId, orgId), eq(monitorStatusPages.providerConnectionId, providerId)),
      )
      .returning();
    if (!removed) throw notFound('Status page link');
    await audit.record(req, {
      action: 'monitor.status_page_delete',
      orgId,
      resourceType: 'monitor_status_page',
      resourceId: orgId,
      details: { providerId, slug: removed.slug, url: removed.url },
    });
    return { ok: true };
  });

  // --- Reseller: allowances of its customers ------------------------------------------

  /** A customer and its reseller, if the caller may manage the reseller's customers (404 otherwise). */
  async function resellerCustomer(req: FastifyRequest, permission: Permission) {
    requireAuth(req);
    const { orgId } = parse(orgParams, req.params);
    const customer = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
    const reseller = customer?.parentOrgId
      ? await db.query.organizations.findFirst({ where: eq(organizations.id, customer.parentOrgId) })
      : undefined;
    if (
      !customer ||
      !reseller ||
      reseller.kind !== 'reseller' ||
      !(await access.canSeeOrg(req, reseller.id))
    ) {
      throw notFound('Customer');
    }
    await access.assert(req, permission, orgScope(reseller.id));
    return { customer, reseller };
  }

  app.get(
    '/reseller/customers/:orgId/monitor-allowance',
    async (req): Promise<MonitorAllowanceDto | null> => {
      const { customer } = await resellerCustomer(req, 'reseller:customer:read');
      return monitorAllowanceDto(ctx, customer);
    },
  );

  /** A share of the reseller's allowance, on the reseller's instance. */
  app.put('/reseller/customers/:orgId/monitor-allowance', async (req): Promise<MonitorAllowanceDto> => {
    const auth = requireAuth(req);
    const { customer, reseller } = await resellerCustomer(req, 'reseller:customer:write');
    const body = parse(resellerAllowanceBody, req.body);
    if (!reseller.modules.includes(MONITORING_MODULE)) {
      throw conflict(`Your organization does not have the module "${MONITORING_MODULE}"`);
    }

    const { previous, moduleEnabled, providerId } = await db.transaction(async (tx) => {
      // The row lock first, then the monitoring locks of reseller and customer.
      const moduleEnabled = await enableMonitoring(tx, customer.id);
      await lockMonitorOrg(tx, customer);
      const own = await loadMonitorAllowance(tx, reseller.id);
      if (!own) throw noMonitorAllowance('Your organization has no monitoring allowance to hand out');
      const { allowance: resellerAllowance } = own;
      const providerId = resellerAllowance.providerConnectionId;
      if (body.minIntervalSeconds < resellerAllowance.minIntervalSeconds) {
        throw badRequest('Validation failed', [
          {
            path: 'minIntervalSeconds',
            message: `Your allowance allows an interval of ${resellerAllowance.minIntervalSeconds} seconds at the shortest`,
          },
        ]);
      }
      const current = await tx.query.monitorAllowances.findFirst({
        where: eq(monitorAllowances.orgId, customer.id),
      });
      await assertAllowanceCovers(tx, customer, current, {
        providerId,
        maxMonitors: body.maxMonitors,
        minIntervalSeconds: body.minIntervalSeconds,
      });
      // Everything the reseller committed besides this customer, plus the new maximum.
      const committed = await monitorCommitments(tx, reseller, providerId, customer.id);
      const left = resellerAllowance.maxMonitors - committedMonitors(committed);
      if (body.maxMonitors > left) {
        throw monitorLimit(
          `Only ${Math.max(left, 0)} monitors of your allowance are left for this customer`,
          {
            maxMonitors: resellerAllowance.maxMonitors,
            committed: committedMonitors(committed),
          },
        );
      }
      await upsertAllowance(tx, {
        orgId: customer.id,
        providerConnectionId: providerId,
        maxMonitors: body.maxMonitors,
        minIntervalSeconds: body.minIntervalSeconds,
        updatedBy: auth.user.id,
      });
      return { previous: current ?? null, moduleEnabled, providerId };
    });
    await audit.record(req, {
      action: 'monitor.allowance_set',
      orgId: reseller.id,
      resourceType: 'monitor_allowance',
      resourceId: customer.id,
      details: {
        customerId: customer.id,
        customer: customer.name,
        providerId,
        maxMonitors: body.maxMonitors,
        minIntervalSeconds: body.minIntervalSeconds,
        previous: previous ? allowanceDetails(previous) : null,
        moduleEnabled: moduleEnabled ? MONITORING_MODULE : null,
      },
    });
    return (await monitorAllowanceDto(ctx, customer))!;
  });

  /** Gives the monitors back to the reseller, e.g. before the customer is deleted. */
  app.delete('/reseller/customers/:orgId/monitor-allowance', async (req) => {
    const { customer, reseller } = await resellerCustomer(req, 'reseller:customer:write');
    const removed = await removeAllowance(customer);
    await audit.record(req, {
      action: 'monitor.allowance_delete',
      orgId: reseller.id,
      resourceType: 'monitor_allowance',
      resourceId: customer.id,
      details: { customerId: customer.id, customer: customer.name, ...allowanceDetails(removed) },
    });
    return { ok: true };
  });
}
