import { and, count, desc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  DEFAULT_MODULES,
  MODULES,
  ORG_KINDS,
  PLATFORM_ROLES,
  PROVIDER_TYPES,
  defaultBoundary,
  normalizeModules,
  type AdminOrgDto,
  type ProviderConnectionDto,
  type ProviderType,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import { platformScope, requireSession } from '../../auth/access';
import {
  cloudAccounts,
  cloudAllowances,
  domains,
  memberships,
  organizations,
  projects,
  providerConnections,
  serverActions,
  servers,
  sessions,
  users,
  webspaces,
  type Organization,
  type ProviderConnection,
} from '../../db/schema';
import { hashPassword, randomToken } from '../../lib/crypto';
import { toUserDto } from '../../lib/dto';
import { AppError, badRequest, conflict, forbidden, notFound, unsupported } from '../../lib/errors';
import { parse, parseStatements } from '../../lib/validation';
import type {
  CreateServerRequest,
  DemoConfig,
  Fire24Config,
  HetznerConfig,
  JokerConfig,
  NextcloudConfig,
  ProviderConfig,
  ProxmoxConfig,
} from '../../providers/types';
import { sendInvitationMail } from '../../mail/invitation';
import { orgCounts, orgRef } from '../orgs/routes';
import {
  assertDeletable,
  assertModulesWithin,
  assertNoLinkedService,
  assertSellerChangeable,
  createInvitation,
  uniqueSlug,
} from '../reseller/service';
import { serverRowsQuery, toServerDto } from '../servers/service';

const idParams = z.object({ id: z.uuid() });

const locationSchema = z.object({
  country: z.string().trim().min(2).max(2).toUpperCase(),
  city: z.string().trim().max(80).optional(),
  label: z.string().trim().min(1).max(80),
});

const fire24ConfigSchema = z.object({
  apiKey: z.string().min(8).max(500),
  baseUrl: z.url().default('https://manage.24fire.de'),
});
const proxmoxConfigSchema = z.object({
  baseUrl: z.url(),
  tokenId: z.string().regex(/^[^@\s]+@[^!\s]+![\w.-]+$/, 'expected user@realm!tokenid'),
  tokenSecret: z.string().min(8).max(200),
  verifyTls: z.boolean().default(true),
  caCert: z.string().max(20_000).optional(),
  backupStorage: z.string().max(100).optional(),
});
const hetznerConfigSchema = z.object({
  apiToken: z.string().trim().min(32).max(200),
  baseUrl: z.url().default('https://api.hetzner.cloud/v1'),
});
const nextcloudConfigSchema = z.object({
  baseUrl: z.url(),
  username: z.string().trim().min(1).max(200),
  appPassword: z.string().min(8).max(500),
  groupPrefix: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9._-]{0,30}$/, 'lower-case letters, digits, dot, dash, underscore')
    .optional(),
});
/** An API key wins over username and password when both are stored. */
const jokerConfigSchema = z
  .object({
    apiKey: z.string().trim().min(8).max(500).optional(),
    username: z.string().trim().min(1).max(200).optional(),
    password: z.string().min(1).max(500).optional(),
    baseUrl: z.url().default('https://dmapi.joker.com/request'),
  })
  .refine((c) => !!c.apiKey || (!!c.username && !!c.password), {
    message: 'Either an API key or username and password are required',
    path: ['apiKey'],
  });
const demoConfigSchema = z.object({
  seed: z.number().int().optional(),
  servers: z.number().int().min(1).max(50).optional(),
});

function parseProviderConfig(type: ProviderType, raw: unknown): ProviderConfig {
  switch (type) {
    case 'fire24':
      return parse(fire24ConfigSchema, raw) as Fire24Config;
    case 'proxmox':
      return parse(proxmoxConfigSchema, raw) as ProxmoxConfig;
    case 'hetzner':
      return parse(hetznerConfigSchema, raw) as HetznerConfig;
    case 'joker':
      return parse(jokerConfigSchema, raw) as JokerConfig;
    case 'nextcloud':
      return parse(nextcloudConfigSchema, raw) as NextcloudConfig;
    case 'demo':
      return parse(demoConfigSchema, raw ?? {}) as DemoConfig;
  }
}

/** Non secret parts of a provider config for display. */
export function configSummary(type: ProviderType, config: ProviderConfig): Record<string, string> {
  switch (type) {
    case 'fire24': {
      const c = config as Fire24Config;
      return { baseUrl: c.baseUrl, apiKey: `${c.apiKey.slice(0, 4)}…${c.apiKey.slice(-3)}` };
    }
    case 'proxmox': {
      const c = config as ProxmoxConfig;
      return {
        baseUrl: c.baseUrl,
        tokenId: c.tokenId,
        verifyTls: String(c.verifyTls),
        ...(c.backupStorage ? { backupStorage: c.backupStorage } : {}),
      };
    }
    case 'hetzner': {
      const c = config as HetznerConfig;
      return { baseUrl: c.baseUrl, apiToken: `${c.apiToken.slice(0, 4)}…${c.apiToken.slice(-3)}` };
    }
    case 'joker': {
      const c = config as JokerConfig;
      return {
        baseUrl: c.baseUrl,
        ...(c.apiKey
          ? { apiKey: `${c.apiKey.slice(0, 4)}…${c.apiKey.slice(-3)}` }
          : { username: c.username ?? '' }),
      };
    }
    case 'nextcloud': {
      const c = config as NextcloudConfig;
      return {
        baseUrl: c.baseUrl,
        username: c.username,
        // An app password is a full password of the admin account: not even a part of it leaves.
        appPassword: '••••••',
        ...(c.groupPrefix ? { groupPrefix: c.groupPrefix } : {}),
      };
    }
    case 'demo':
      return { servers: String((config as DemoConfig).servers ?? 6) };
  }
}

const SECRET_KEY = /passw(or)?d|secret|token|auth_?code|api_?key/i;

/**
 * An explorer request as it is audited: values of password-like keys blanked, including the
 * "value" of a Nextcloud user edit with key=password (PUT /ocs/v2.php/cloud/users/{id}).
 */
export function redactExplorerBody(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactExplorerBody);
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const secretEdit = typeof record.key === 'string' && SECRET_KEY.test(record.key);
  return Object.fromEntries(
    Object.entries(record).map(([k, v]) => [
      k,
      SECRET_KEY.test(k) || (secretEdit && k === 'value') ? '[redacted]' : redactExplorerBody(v),
    ]),
  );
}

/** Query parameters with password-like names blanked in an explorer path. */
export function redactExplorerPath(path: string): string {
  return path.replace(
    /([?&][^=&#]*(?:passw(?:or)?d|secret|token|auth_?code|api_?key)[^=&#]*=)[^&#]*/gi,
    '$1[redacted]',
  );
}

export async function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, access, audit, providers, box } = ctx;
  const can = (req: FastifyRequest, action: Parameters<typeof access.assert>[1]) =>
    access.assert(req, action, platformScope);

  // --- Overview -------------------------------------------------------------------

  app.get('/admin/stats', async (req) => {
    await can(req, 'platform:access');
    const [orgRows, userRows, serverRows, providerRows, recentFailures] = await Promise.all([
      db.select({ kind: organizations.kind, n: count() }).from(organizations).groupBy(organizations.kind),
      db.select({ n: count() }).from(users),
      db
        .select({
          status: servers.status,
          assigned: sql<boolean>`${servers.projectId} is not null`,
          n: count(),
        })
        .from(servers)
        .groupBy(servers.status, sql`${servers.projectId} is not null`),
      db.select().from(providerConnections).orderBy(providerConnections.name),
      db
        .select({ n: count() })
        .from(serverActions)
        .where(
          and(
            eq(serverActions.status, 'error'),
            sql`${serverActions.startedAt} > now() - interval '24 hours'`,
          ),
        ),
    ]);
    const totalServers = serverRows.reduce((sum, r) => sum + r.n, 0);
    return {
      organizations: {
        customers: orgRows.find((r) => r.kind === 'customer')?.n ?? 0,
        resellers: orgRows.find((r) => r.kind === 'reseller')?.n ?? 0,
        internal: orgRows.find((r) => r.kind === 'internal')?.n ?? 0,
      },
      users: userRows[0]?.n ?? 0,
      servers: {
        total: totalServers,
        running: serverRows.filter((r) => r.status === 'running').reduce((s, r) => s + r.n, 0),
        stopped: serverRows.filter((r) => r.status === 'stopped').reduce((s, r) => s + r.n, 0),
        missing: serverRows.filter((r) => r.status === 'missing').reduce((s, r) => s + r.n, 0),
        unassigned: serverRows.filter((r) => !r.assigned).reduce((s, r) => s + r.n, 0),
      },
      providers: providerRows.map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        status: p.status,
        lastSyncAt: p.lastSyncAt,
      })),
      failedActions24h: recentFailures[0]?.n ?? 0,
    };
  });

  // --- Providers ------------------------------------------------------------------

  async function toProviderDto(connection: ProviderConnection): Promise<ProviderConnectionDto> {
    const [row] = await db
      .select({ n: count() })
      .from(servers)
      .where(eq(servers.providerConnectionId, connection.id));
    let summary: Record<string, string> = {};
    try {
      summary = configSummary(connection.type, providers.decryptConfig(connection));
    } catch {
      summary = { error: 'credentials cannot be decrypted (ENCRYPTION_KEY changed?)' };
    }
    return {
      id: connection.id,
      type: connection.type,
      name: connection.name,
      location: connection.location,
      enabled: connection.enabled,
      status: connection.status,
      lastError: connection.lastError,
      lastSyncAt: connection.lastSyncAt?.toISOString() ?? null,
      serverCount: row?.n ?? 0,
      summary: { ...summary, managedBy: connection.managedBy },
      createdAt: connection.createdAt.toISOString(),
    };
  }

  async function loadConnection(id: string) {
    const connection = await db.query.providerConnections.findFirst({
      where: eq(providerConnections.id, id),
    });
    if (!connection) throw notFound('Provider');
    return connection;
  }

  app.get('/admin/providers', async (req) => {
    await can(req, 'platform:provider:read');
    const rows = await db.select().from(providerConnections).orderBy(providerConnections.name);
    return Promise.all(rows.map(toProviderDto));
  });

  app.get('/admin/providers/:id', async (req) => {
    await can(req, 'platform:provider:read');
    return toProviderDto(await loadConnection(parse(idParams, req.params).id));
  });

  app.post('/admin/providers', async (req) => {
    requireSession(req);
    await can(req, 'platform:provider:write');
    const body = parse(
      z.object({
        type: z.enum(PROVIDER_TYPES),
        name: z.string().trim().min(2).max(80),
        location: locationSchema,
        config: z.unknown(),
        enabled: z.boolean().default(true),
      }),
      req.body,
    );
    const config = parseProviderConfig(body.type, body.config);
    const [connection] = await db
      .insert(providerConnections)
      .values({
        type: body.type,
        name: body.name,
        location: body.location,
        enabled: body.enabled,
        configEnc: box.encryptJson(config),
      })
      .returning();
    await audit.record(req, {
      action: 'provider.create',
      resourceType: 'provider',
      resourceId: connection!.id,
      details: { type: body.type, name: body.name, ...configSummary(body.type, config) },
    });
    ctx.sync.syncConnection(connection!).catch((err) => req.log.warn({ err }, 'initial sync failed'));
    return toProviderDto(connection!);
  });

  app.patch('/admin/providers/:id', async (req) => {
    requireSession(req);
    await can(req, 'platform:provider:write');
    const { id } = parse(idParams, req.params);
    const connection = await loadConnection(id);
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(80).optional(),
        location: locationSchema.optional(),
        enabled: z.boolean().optional(),
        config: z.record(z.string(), z.unknown()).optional(),
      }),
      req.body,
    );
    if (body.config && connection.managedBy === 'env') {
      throw conflict('Credentials of this provider come from environment variables. Change them there.');
    }
    let configEnc: string | undefined;
    if (body.config) {
      // Empty secret fields keep the stored value so the UI never needs to know it; null
      // removes it (e.g. a Joker API key when switching to username and password).
      const current = providers.decryptConfig<ProviderConfig>(connection) as unknown as Record<
        string,
        unknown
      >;
      const merged = { ...current };
      for (const [k, v] of Object.entries(body.config)) {
        if (v === null) delete merged[k];
        else if (v !== '' && v !== undefined) merged[k] = v;
      }
      configEnc = box.encryptJson(parseProviderConfig(connection.type, merged));
    }
    const [updated] = await db
      .update(providerConnections)
      .set({
        ...(body.name ? { name: body.name } : {}),
        ...(body.location ? { location: body.location } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(configEnc ? { configEnc, status: 'unknown' as const, lastError: null } : {}),
      })
      .where(eq(providerConnections.id, id))
      .returning();
    providers.invalidate(id);
    await audit.record(req, {
      action: 'provider.update',
      resourceType: 'provider',
      resourceId: id,
      details: { name: body.name, enabled: body.enabled, credentialsChanged: !!configEnc },
    });
    return toProviderDto(updated!);
  });

  app.delete('/admin/providers/:id', async (req) => {
    requireSession(req);
    await can(req, 'platform:provider:write');
    const { id } = parse(idParams, req.params);
    const connection = await loadConnection(id);
    if (connection.managedBy === 'env')
      throw conflict('Remove the environment variables to delete this provider');
    const [assigned] = await db
      .select({ n: count() })
      .from(servers)
      .where(and(eq(servers.providerConnectionId, id), isNotNull(servers.projectId)));
    if ((assigned?.n ?? 0) > 0) throw conflict('Unassign all servers of this provider first');
    // Domains and web spaces would silently disappear from their organizations with the provider.
    const [assignedDomains] = await db
      .select({ n: count() })
      .from(domains)
      .where(and(eq(domains.providerConnectionId, id), isNotNull(domains.orgId)));
    const [assignedWebspaces] = await db
      .select({ n: count() })
      .from(webspaces)
      .where(and(eq(webspaces.providerConnectionId, id), isNotNull(webspaces.orgId)));
    if ((assignedDomains?.n ?? 0) + (assignedWebspaces?.n ?? 0) > 0) {
      throw conflict('Unassign all domains and web spaces of this provider first');
    }
    // Allowances reference the instance (restrict), and accounts would vanish from their organizations.
    const [allowances] = await db
      .select({ n: count() })
      .from(cloudAllowances)
      .where(eq(cloudAllowances.providerConnectionId, id));
    const [assignedAccounts] = await db
      .select({ n: count() })
      .from(cloudAccounts)
      .where(and(eq(cloudAccounts.providerConnectionId, id), isNotNull(cloudAccounts.orgId)));
    if ((allowances?.n ?? 0) + (assignedAccounts?.n ?? 0) > 0) {
      throw conflict(
        'Remove the cloud storage allowances on this instance and unassign or delete its cloud accounts first',
      );
    }
    await db.delete(providerConnections).where(eq(providerConnections.id, id));
    providers.invalidate(id);
    await audit.record(req, {
      action: 'provider.delete',
      resourceType: 'provider',
      resourceId: id,
      details: { name: connection.name },
    });
    return { ok: true };
  });

  app.post('/admin/providers/:id/test', async (req) => {
    await can(req, 'platform:provider:read');
    const connection = await loadConnection(parse(idParams, req.params).id);
    const started = Date.now();
    try {
      const info = await providers.forConnection(connection).testConnection();
      await db
        .update(providerConnections)
        .set({ status: 'ok', lastError: null })
        .where(eq(providerConnections.id, connection.id));
      return { ok: true, latencyMs: Date.now() - started, info };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(providerConnections)
        .set({ status: 'error', lastError: message.slice(0, 1000) })
        .where(eq(providerConnections.id, connection.id));
      return { ok: false, latencyMs: Date.now() - started, error: message };
    }
  });

  app.post('/admin/providers/:id/sync', async (req) => {
    await can(req, 'platform:provider:read');
    const connection = await loadConnection(parse(idParams, req.params).id);
    const result = await ctx.sync.syncConnection(connection);
    await audit.record(req, {
      action: 'provider.sync',
      resourceType: 'provider',
      resourceId: connection.id,
      details: { ...result },
    });
    return result;
  });

  app.get('/admin/providers/:id/overview', async (req) => {
    await can(req, 'platform:infra:read');
    const connection = await loadConnection(parse(idParams, req.params).id);
    const adapter = providers.forConnection(connection);
    if (!adapter.overview) return { nodes: [], storages: [], facts: [] };
    return adapter.overview();
  });

  app.get('/admin/providers/:id/images', async (req) => {
    await can(req, 'platform:server:create');
    const connection = await loadConnection(parse(idParams, req.params).id);
    const adapter = providers.forConnection(connection);
    return adapter.listImages ? adapter.listImages() : [];
  });

  // Plans and locations exist only at providers with fixed sizes (Hetzner). 422 tells the
  // create dialog to ask for cores, memory and disk instead.
  app.get('/admin/providers/:id/plans', async (req) => {
    await can(req, 'platform:server:create');
    const connection = await loadConnection(parse(idParams, req.params).id);
    const adapter = providers.forConnection(connection);
    if (!adapter.listPlans) throw unsupported('This provider has no plans');
    return adapter.listPlans();
  });

  app.get('/admin/providers/:id/locations', async (req) => {
    await can(req, 'platform:server:create');
    const connection = await loadConnection(parse(idParams, req.params).id);
    const adapter = providers.forConnection(connection);
    if (!adapter.listLocations) throw unsupported('This provider has no locations');
    return adapter.listLocations();
  });

  // --- Server inventory -----------------------------------------------------------

  app.get('/admin/servers', async (req) => {
    await can(req, 'platform:access');
    const query = parse(
      z.object({
        assigned: z.enum(['all', 'yes', 'no']).default('all'),
        providerId: z.uuid().optional(),
        orgId: z.uuid().optional(),
        q: z.string().max(100).optional(),
        includeMissing: z.coerce.boolean().default(true),
      }),
      req.query,
    );
    const filters: (SQL | undefined)[] = [
      query.assigned === 'yes'
        ? isNotNull(servers.projectId)
        : query.assigned === 'no'
          ? isNull(servers.projectId)
          : undefined,
      query.providerId ? eq(servers.providerConnectionId, query.providerId) : undefined,
      query.orgId ? eq(projects.orgId, query.orgId) : undefined,
      query.includeMissing ? undefined : sql`${servers.status} <> 'missing'`,
      query.q
        ? or(
            ilike(servers.name, `%${query.q.replace(/[%_]/g, '')}%`),
            ilike(servers.externalId, `%${query.q.replace(/[%_]/g, '')}%`),
            sql`${servers.ips}::text ilike ${`%${query.q.replace(/[%_]/g, '')}%`}`,
          )
        : undefined,
    ];
    const rows = await serverRowsQuery(ctx)
      .where(and(...filters))
      .orderBy(servers.name)
      .limit(1000);
    return Promise.all(rows.map((r) => toServerDto(ctx, req, r)));
  });

  app.post('/admin/servers/:id/assign', async (req) => {
    await can(req, 'platform:server:assign');
    const { id } = parse(idParams, req.params);
    const { projectId } = parse(z.object({ projectId: z.uuid().nullable() }), req.body);
    const server = await db.query.servers.findFirst({ where: eq(servers.id, id) });
    if (!server) throw notFound('Server');
    let orgId: string | null = null;
    if (projectId) {
      const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
      if (!project) throw notFound('Project');
      orgId = project.orgId;
    }
    const previous = server.projectId
      ? await db.query.projects.findFirst({ where: eq(projects.id, server.projectId) })
      : undefined;
    // Another project of the same organization is fine, another owner is not while it is billed.
    if ((previous?.orgId ?? null) !== orgId) await assertNoLinkedService(db, 'server', id, orgId);
    await db.update(servers).set({ projectId }).where(eq(servers.id, id));
    await audit.record(req, {
      action: projectId ? 'server.assign' : 'server.unassign',
      orgId,
      resourceType: 'server',
      resourceId: id,
      details: { name: server.name, projectId, previousProjectId: server.projectId },
    });
    return { ok: true };
  });

  app.post('/admin/servers/import', async (req) => {
    await can(req, 'platform:server:assign');
    const body = parse(
      z.object({
        providerId: z.uuid(),
        externalId: z.string().trim().min(1).max(200),
        projectId: z.uuid().nullish(),
      }),
      req.body,
    );
    const connection = await loadConnection(body.providerId);
    const adapter = providers.forConnection(connection);
    const remote = await adapter.getServer({ externalId: body.externalId, kind: 'vm', node: null, meta: {} });
    const [server] = await db
      .insert(servers)
      .values({
        providerConnectionId: connection.id,
        externalId: remote.externalId,
        name: remote.name,
        providerName: remote.name,
        kind: remote.kind,
        status: remote.status,
        specs: remote.specs,
        usage: remote.usage ?? null,
        ips: remote.ips,
        os: remote.os ?? null,
        node: remote.node ?? null,
        meta: remote.meta ?? {},
        projectId: body.projectId ?? null,
        lastSyncedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning();
    if (!server) throw conflict('This server is already in the inventory');
    await audit.record(req, {
      action: 'server.import',
      resourceType: 'server',
      resourceId: server.id,
      details: { provider: connection.name, externalId: body.externalId },
    });
    return { id: server.id };
  });

  app.post('/admin/servers', async (req) => {
    const auth = requireSession(req);
    await can(req, 'platform:server:create');
    const body = parse(
      z
        .object({
          providerId: z.uuid(),
          name: z.string().trim().min(1).max(63),
          node: z.string().max(100).optional(),
          cores: z.number().int().min(1).max(128).optional(),
          memoryMb: z
            .number()
            .int()
            .min(512)
            .max(1024 * 1024)
            .optional(),
          diskGb: z.number().int().min(5).max(20_000).optional(),
          plan: z.string().trim().min(1).max(100).optional(),
          location: z.string().trim().min(1).max(100).optional(),
          imageId: z.string().max(200).optional(),
          storage: z.string().max(100).optional(),
          projectId: z.uuid().nullish(),
        })
        .refine((b) => !!b.plan || (!!b.cores && !!b.memoryMb && !!b.diskGb), {
          message: 'Either a plan or cores, memory and disk are required',
          path: ['plan'],
        }),
      req.body,
    );
    const connection = await loadConnection(body.providerId);
    const adapter = providers.forConnection(connection);
    if (!adapter.createServer) throw badRequest('This provider cannot create servers from the panel');

    if (body.location) {
      if (!adapter.listLocations) throw unsupported('This provider has no locations');
      const locations = await adapter.listLocations();
      if (!locations.some((l) => l.id === body.location)) throw badRequest('Unknown location');
    }
    // With a plan (Hetzner server type) the plan decides cores, memory and disk.
    let size = { cores: body.cores ?? 0, memoryMb: body.memoryMb ?? 0, diskGb: body.diskGb ?? 0 };
    if (body.plan) {
      if (!adapter.listPlans) throw unsupported('This provider has no plans');
      const plan = (await adapter.listPlans()).find((p) => p.id === body.plan);
      if (!plan) throw badRequest('Unknown plan');
      if (plan.deprecated) throw badRequest('This plan can no longer be ordered');
      if (body.location && plan.locations.length > 0 && !plan.locations.includes(body.location)) {
        throw badRequest('The plan is not available in this location');
      }
      size = { cores: plan.cores, memoryMb: plan.memoryMb, diskGb: plan.diskGb };
    }
    const request: CreateServerRequest = {
      name: body.name,
      node: body.node,
      ...size,
      imageId: body.imageId,
      storage: body.storage,
      plan: body.plan,
      location: body.location,
    };

    // Cloning can take minutes, so it runs in the background and reports through the audit log.
    const jobId = randomToken(8);
    void (async () => {
      try {
        const result = await adapter.createServer!(request);
        await ctx.sync.syncConnection(connection);
        if (result.externalId && body.projectId) {
          await db
            .update(servers)
            .set({ projectId: body.projectId })
            .where(
              and(eq(servers.providerConnectionId, connection.id), eq(servers.externalId, result.externalId)),
            );
        }
        await audit.record(null, {
          action: 'server.create',
          status: 'success',
          actorUserId: auth.user.id,
          actorName: auth.user.name,
          resourceType: 'server',
          resourceId: result.externalId ?? null,
          details: { jobId, provider: connection.name, ...body },
        });
      } catch (err) {
        await audit.record(null, {
          action: 'server.create',
          status: 'failure',
          actorUserId: auth.user.id,
          actorName: auth.user.name,
          details: {
            jobId,
            provider: connection.name,
            ...body,
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
    })();
    return { jobId, status: 'started' };
  });

  // --- Organizations --------------------------------------------------------------

  const modulesSchema = z.array(z.enum(MODULES)).max(MODULES.length);

  async function toAdminOrgDto(org: Organization): Promise<AdminOrgDto> {
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      kind: org.kind,
      status: org.status,
      suspendedBy: org.status === 'suspended' ? org.suspendedBy : null,
      createdAt: org.createdAt.toISOString(),
      boundary: org.boundary,
      notes: org.notes,
      modules: org.modules,
      parent: await orgRef(ctx, org.parentOrgId),
      counts: await orgCounts(ctx, org.id),
    };
  }

  /** A parent must exist and be a reseller. Only one level: resellers have no parent themselves. */
  async function loadParent(parentOrgId: string): Promise<Organization> {
    const parent = await db.query.organizations.findFirst({ where: eq(organizations.id, parentOrgId) });
    if (!parent) throw badRequest('Unknown parent organization');
    if (parent.kind !== 'reseller') throw conflict('The parent organization must be a reseller');
    return parent;
  }

  app.get('/admin/orgs', async (req) => {
    await can(req, 'platform:org:read');
    const { q, kind, parentOrgId } = parse(
      z.object({
        q: z.string().max(100).optional(),
        kind: z.enum(ORG_KINDS).optional(),
        parentOrgId: z.uuid().optional(),
      }),
      req.query,
    );
    const rows = await db
      .select()
      .from(organizations)
      .where(
        and(
          q
            ? or(
                ilike(organizations.name, `%${q.replace(/[%_]/g, '')}%`),
                ilike(organizations.slug, `%${q.replace(/[%_]/g, '')}%`),
              )
            : undefined,
          kind ? eq(organizations.kind, kind) : undefined,
          parentOrgId ? eq(organizations.parentOrgId, parentOrgId) : undefined,
        ),
      )
      .orderBy(organizations.name);
    return Promise.all(rows.map(toAdminOrgDto));
  });

  app.get('/admin/orgs/:id', async (req) => {
    await can(req, 'platform:org:read');
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, parse(idParams, req.params).id),
    });
    if (!org) throw notFound('Organization');
    const projectRows = await db
      .select()
      .from(projects)
      .where(eq(projects.orgId, org.id))
      .orderBy(projects.name);
    return { ...(await toAdminOrgDto(org)), projects: projectRows.map((p) => ({ id: p.id, name: p.name })) };
  });

  app.post('/admin/orgs', async (req) => {
    const auth = requireSession(req);
    await can(req, 'platform:org:write');
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(100),
        slug: z.string().trim().max(48).optional(),
        kind: z.enum(ORG_KINDS).default('customer'),
        parentOrgId: z.uuid().nullish(),
        modules: modulesSchema.optional(),
        ownerEmail: z.email().optional(),
        notes: z.string().max(2000).optional(),
      }),
      req.body,
    );
    const parent = body.parentOrgId ? await loadParent(body.parentOrgId) : null;
    if (parent && body.kind !== 'customer') {
      throw conflict('Resellers and internal organizations cannot belong to a reseller');
    }
    const modules = body.modules
      ? normalizeModules(body.modules)
      : DEFAULT_MODULES.filter((m) => !parent || parent.modules.includes(m));
    if (parent) assertModulesWithin(parent, modules);

    const slug = await uniqueSlug(db, body.slug || body.name);
    const result = await db.transaction(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({
          name: body.name,
          slug,
          kind: body.kind,
          notes: body.notes ?? null,
          boundary: defaultBoundary(body.kind),
          parentOrgId: parent?.id ?? null,
          modules,
        })
        .returning();
      await tx.insert(projects).values({ orgId: org!.id, name: 'Default' });
      let invitation: Awaited<ReturnType<typeof createInvitation>> | null = null;
      if (body.ownerEmail) {
        const existing = await tx.query.users.findFirst({
          where: sql`lower(${users.email}) = lower(${body.ownerEmail})`,
        });
        if (existing) {
          await tx.insert(memberships).values({ orgId: org!.id, userId: existing.id, role: 'owner' });
        } else {
          invitation = await createInvitation(ctx, tx, {
            orgId: org!.id,
            email: body.ownerEmail,
            role: 'owner',
            invitedBy: auth.user.id,
            days: 14,
          });
        }
      }
      return { org: org!, invitation };
    });
    await audit.record(req, {
      action: 'org.create',
      orgId: result.org.id,
      resourceType: 'org',
      resourceId: result.org.id,
      details: {
        name: body.name,
        kind: body.kind,
        parentOrgId: parent?.id ?? null,
        modules,
        ownerEmail: body.ownerEmail,
      },
    });
    const mail = result.invitation
      ? await sendInvitationMail(ctx.mail, {
          email: body.ownerEmail!,
          orgId: result.org.id,
          orgName: result.org.name,
          role: 'owner',
          link: result.invitation.link,
          expiresAt: result.invitation.expiresAt,
          inviter: auth.user,
        })
      : null;
    return {
      ...(await toAdminOrgDto(result.org)),
      inviteLink: result.invitation?.link ?? null,
      mail,
    };
  });

  app.patch('/admin/orgs/:id', async (req) => {
    requireSession(req);
    await can(req, 'platform:org:write');
    const { id } = parse(idParams, req.params);
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(100).optional(),
        kind: z.enum(ORG_KINDS).optional(),
        parentOrgId: z.uuid().nullable().optional(),
        modules: modulesSchema.optional(),
        status: z.enum(['active', 'suspended']).optional(),
        notes: z.string().max(2000).nullish(),
        boundary: z.unknown().optional(),
      }),
      req.body,
    );
    const current = await db.query.organizations.findFirst({ where: eq(organizations.id, id) });
    if (!current) throw notFound('Organization');

    const kind = body.kind ?? current.kind;
    const kindChanged = kind !== current.kind;
    const parentOrgId = body.parentOrgId !== undefined ? body.parentOrgId : current.parentOrgId;
    if (parentOrgId === id) throw conflict('An organization cannot be its own reseller');
    const parent = parentOrgId ? await loadParent(parentOrgId) : null;
    if (parent && kind !== 'customer') {
      throw conflict('Resellers and internal organizations cannot belong to a reseller');
    }
    const customers = await db
      .select({ id: organizations.id, modules: organizations.modules })
      .from(organizations)
      .where(eq(organizations.parentOrgId, id));
    if (kindChanged && customers.length > 0) {
      throw conflict('This reseller still has customers. Move or delete them before changing its kind.');
    }
    const modules = body.modules ? normalizeModules(body.modules) : current.modules;
    if (parent && (body.modules || parentOrgId !== current.parentOrgId)) assertModulesWithin(parent, modules);
    // A reseller that loses a module takes it away from its customers as well.
    const removed = current.modules.filter((m) => !modules.includes(m));

    // A new kind gets the default boundary of that kind unless one is given explicitly.
    const boundary =
      body.boundary !== undefined
        ? parseStatements(body.boundary)
        : kindChanged
          ? defaultBoundary(kind)
          : undefined;
    const sellerChanged = parentOrgId !== current.parentOrgId;
    const org = await db.transaction(async (tx) => {
      // Credit, invoices and services belong to the seller that issued them.
      if (sellerChanged) await assertSellerChangeable(tx, id);
      const [updated] = await tx
        .update(organizations)
        .set({
          ...(body.name ? { name: body.name } : {}),
          ...(body.kind ? { kind: body.kind } : {}),
          ...(body.parentOrgId !== undefined ? { parentOrgId: body.parentOrgId } : {}),
          ...(body.modules ? { modules } : {}),
          // Staff can lift any suspension; one they set themselves the reseller can't lift.
          ...(body.status
            ? { status: body.status, suspendedBy: body.status === 'suspended' ? ('platform' as const) : null }
            : {}),
          ...(body.notes !== undefined ? { notes: body.notes ?? null } : {}),
          ...(boundary ? { boundary } : {}),
        })
        .where(eq(organizations.id, id))
        .returning();
      if (removed.length > 0) {
        for (const customer of customers) {
          const kept = customer.modules.filter((m) => !removed.includes(m));
          if (kept.length !== customer.modules.length) {
            await tx.update(organizations).set({ modules: kept }).where(eq(organizations.id, customer.id));
          }
        }
      }
      return updated!;
    });
    await audit.record(req, {
      action: 'org.admin_update',
      orgId: id,
      resourceType: 'org',
      resourceId: id,
      details: {
        ...body,
        ...(kindChanged ? { previousKind: current.kind, boundaryReset: body.boundary === undefined } : {}),
        ...(body.parentOrgId !== undefined ? { previousParentOrgId: current.parentOrgId } : {}),
        ...(body.status ? { previousStatus: current.status, previousSuspendedBy: current.suspendedBy } : {}),
        ...(removed.length > 0 && customers.length > 0 ? { modulesRemovedFromCustomers: removed } : {}),
      },
    });
    return toAdminOrgDto(org);
  });

  app.delete('/admin/orgs/:id', async (req) => {
    requireSession(req);
    await can(req, 'platform:org:write');
    const { id } = parse(idParams, req.params);
    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, id) });
    if (!org) throw notFound('Organization');
    await assertDeletable(db, id);
    await db.delete(organizations).where(eq(organizations.id, id));
    await audit.record(req, {
      action: 'org.delete',
      resourceType: 'org',
      resourceId: id,
      details: { name: org.name, kind: org.kind },
    });
    return { ok: true };
  });

  // --- Users ----------------------------------------------------------------------

  app.get('/admin/users', async (req) => {
    await can(req, 'platform:user:read');
    const { q } = parse(z.object({ q: z.string().max(100).optional() }), req.query);
    const rows = await db
      .select()
      .from(users)
      .where(
        q
          ? or(
              ilike(users.email, `%${q.replace(/[%_]/g, '')}%`),
              ilike(users.name, `%${q.replace(/[%_]/g, '')}%`),
            )
          : undefined,
      )
      .orderBy(users.name)
      .limit(500);
    const memberRows = await db
      .select({
        userId: memberships.userId,
        role: memberships.role,
        orgId: organizations.id,
        orgName: organizations.name,
        orgSlug: organizations.slug,
      })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId));
    return rows.map((u) => ({
      ...toUserDto(u),
      memberships: memberRows
        .filter((m) => m.userId === u.id)
        .map((m) => ({ orgId: m.orgId, orgName: m.orgName, orgSlug: m.orgSlug, role: m.role })),
    }));
  });

  app.post('/admin/users', async (req) => {
    requireSession(req);
    await can(req, 'platform:user:write');
    const body = parse(
      z.object({
        email: z.email().max(200),
        name: z.string().trim().min(1).max(100),
        platformRole: z.enum(PLATFORM_ROLES).nullish(),
        orgId: z.uuid().optional(),
        orgRole: z.enum(['owner', 'admin', 'member', 'restricted', 'viewer', 'billing']).optional(),
      }),
      req.body,
    );
    await assertCanSetPlatformRole(req, body.platformRole ?? null);
    const existing = await db.query.users.findFirst({
      where: sql`lower(${users.email}) = lower(${body.email})`,
    });
    if (existing) throw conflict('A user with this email exists');
    const password = randomToken(12);
    const user = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({
          email: body.email.toLowerCase(),
          name: body.name,
          platformRole: body.platformRole ?? null,
          passwordHash: await hashPassword(password),
        })
        .returning();
      if (body.orgId) {
        await tx
          .insert(memberships)
          .values({ orgId: body.orgId, userId: created!.id, role: body.orgRole ?? 'member' });
      }
      return created!;
    });
    await audit.record(req, {
      action: 'user.create',
      orgId: body.orgId ?? null,
      resourceType: 'user',
      resourceId: user.id,
      details: { email: body.email, platformRole: body.platformRole ?? null, orgRole: body.orgRole },
    });
    return { user: toUserDto(user), initialPassword: password };
  });

  async function assertCanSetPlatformRole(req: FastifyRequest, role: string | null) {
    if (!role) return;
    const subject = await access.subject(req, null);
    if (subject.platformRole !== 'superadmin') throw forbidden('Only superadmins can grant platform roles');
  }

  async function superadminCount() {
    const [row] = await db
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.platformRole, 'superadmin'), eq(users.status, 'active')));
    return row?.n ?? 0;
  }

  app.patch('/admin/users/:id', async (req) => {
    const auth = requireSession(req);
    await can(req, 'platform:user:write');
    const { id } = parse(idParams, req.params);
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(100).optional(),
        platformRole: z.enum(PLATFORM_ROLES).nullable().optional(),
        status: z.enum(['active', 'disabled']).optional(),
      }),
      req.body,
    );
    const user = await db.query.users.findFirst({ where: eq(users.id, id) });
    if (!user) throw notFound('User');
    if (body.platformRole !== undefined) {
      const subject = await access.subject(req, null);
      if (subject.platformRole !== 'superadmin')
        throw forbidden('Only superadmins can change platform roles');
    }
    const losesSuperadmin =
      user.platformRole === 'superadmin' &&
      ((body.platformRole !== undefined && body.platformRole !== 'superadmin') || body.status === 'disabled');
    if (losesSuperadmin && (await superadminCount()) <= 1)
      throw conflict('There must be at least one active superadmin');
    if (id === auth.user.id && body.status === 'disabled') throw conflict('You cannot disable yourself');

    const [updated] = await db
      .update(users)
      .set({
        ...(body.name ? { name: body.name } : {}),
        ...(body.platformRole !== undefined ? { platformRole: body.platformRole } : {}),
        ...(body.status ? { status: body.status } : {}),
      })
      .where(eq(users.id, id))
      .returning();
    if (body.status === 'disabled') await db.delete(sessions).where(eq(sessions.userId, id));
    await audit.record(req, { action: 'user.update', resourceType: 'user', resourceId: id, details: body });
    return toUserDto(updated!);
  });

  app.post('/admin/users/:id/reset-password', async (req) => {
    requireSession(req);
    await can(req, 'platform:user:write');
    const { id } = parse(idParams, req.params);
    const user = await db.query.users.findFirst({ where: eq(users.id, id) });
    if (!user) throw notFound('User');
    if (user.platformRole === 'superadmin') {
      const subject = await access.subject(req, null);
      if (subject.platformRole !== 'superadmin') throw forbidden();
    }
    const password = randomToken(12);
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null })
      .where(eq(users.id, id));
    await db.delete(sessions).where(eq(sessions.userId, id));
    await audit.record(req, { action: 'user.password_reset', resourceType: 'user', resourceId: id });
    return { initialPassword: password };
  });

  app.post('/admin/users/:id/reset-mfa', async (req) => {
    requireSession(req);
    await can(req, 'platform:user:write');
    const { id } = parse(idParams, req.params);
    await db.update(users).set({ totpEnabled: false, totpSecretEnc: null }).where(eq(users.id, id));
    await audit.record(req, { action: 'user.mfa_reset', resourceType: 'user', resourceId: id });
    return { ok: true };
  });

  // --- API explorer ---------------------------------------------------------------

  app.post('/admin/explorer', async (req) => {
    requireSession(req);
    await can(req, 'platform:explorer');
    const body = parse(
      z.object({
        providerId: z.uuid(),
        method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
        path: z.string().min(1).max(500),
        body: z.record(z.string(), z.unknown()).optional(),
      }),
      req.body,
    );
    const connection = await loadConnection(body.providerId);
    const adapter = providers.forConnection(connection);
    if (!adapter.rawRequest) throw badRequest('This provider has no raw API access');
    const started = Date.now();
    let result;
    try {
      result = await adapter.rawRequest(body.method, body.path, body.body);
    } catch (err) {
      result = {
        status: err instanceof AppError ? err.statusCode : 500,
        data: { error: err instanceof Error ? err.message : String(err) },
      };
    }
    // Reads are not audited to keep the log useful, every write is (without passwords).
    if (body.method !== 'GET') {
      await audit.record(req, {
        action: 'provider.explorer',
        resourceType: 'provider',
        resourceId: connection.id,
        details: {
          method: body.method,
          path: redactExplorerPath(body.path),
          body: body.body ? redactExplorerBody(body.body) : null,
          status: result.status,
        },
      });
    }
    return { ...result, durationMs: Date.now() - started };
  });

  app.get('/admin/actions', async (req) => {
    await can(req, 'platform:access');
    const rows = await db
      .select({ action: serverActions, serverName: servers.name, userName: users.name })
      .from(serverActions)
      .innerJoin(servers, eq(servers.id, serverActions.serverId))
      .leftJoin(users, eq(users.id, serverActions.userId))
      .orderBy(desc(serverActions.startedAt))
      .limit(100);
    return rows.map(({ action, serverName, userName }) => ({
      id: action.id,
      serverId: action.serverId,
      serverName,
      type: action.type,
      status: action.status,
      startedAt: action.startedAt.toISOString(),
      finishedAt: action.finishedAt?.toISOString() ?? null,
      error: action.error,
      user: action.userId ? { id: action.userId, name: userName ?? '' } : null,
    }));
  });
}
