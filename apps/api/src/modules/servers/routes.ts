import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { METRIC_RANGES, POWER_ACTIONS, type Permission, type ServerActionDto } from '@weblion/shared';
import type { AppContext } from '../../context';
import { requireSession } from '../../auth/access';
import { projects, serverActions, servers, users } from '../../db/schema';
import { badRequest, forbidden, locked, notFound, unsupported } from '../../lib/errors';
import { labelsSchema, paginationQuery, parse } from '../../lib/validation';
import { loadOrg } from '../orgs/routes';
import { projectScope } from '../projects/routes';
import { queryAudit } from '../audit/routes';
import {
  loadServer,
  requireCapability,
  runServerAction,
  serverRowsQuery,
  serverScope,
  toServerDto,
  type LoadedServer,
} from './service';

const idParams = z.object({ id: z.uuid() });

const firewallRuleBody = z.object({
  direction: z.enum(['in', 'out']),
  action: z.enum(['ACCEPT', 'DROP', 'REJECT']),
  enabled: z.boolean().default(true),
  protocol: z.string().max(20).nullish(),
  dport: z
    .string()
    .regex(/^[0-9,:\-]*$/)
    .max(100)
    .nullish(),
  sport: z
    .string()
    .regex(/^[0-9,:\-]*$/)
    .max(100)
    .nullish(),
  source: z.string().max(200).nullish(),
  dest: z.string().max(200).nullish(),
  comment: z.string().max(200).nullish(),
});

export async function serverRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, access } = ctx;

  async function load(req: FastifyRequest, permission?: Permission): Promise<LoadedServer> {
    const { id } = parse(idParams, req.params);
    const loaded = await loadServer(ctx, req, id);
    if (permission) await access.assert(req, permission, loaded.scope);
    return loaded;
  }

  // --- Listing --------------------------------------------------------------------

  app.get('/orgs/:orgId/servers', async (req) => {
    const { orgId } = parse(z.object({ orgId: z.uuid() }), req.params);
    await loadOrg(ctx, req, orgId);
    const query = parse(
      z.object({
        projectId: z.uuid().optional(),
        q: z.string().max(100).optional(),
        status: z.string().max(20).optional(),
        label: z.string().max(130).optional(),
      }),
      req.query,
    );
    const filters: (SQL | undefined)[] = [
      eq(projects.orgId, orgId),
      query.projectId ? eq(servers.projectId, query.projectId) : undefined,
      query.status ? eq(servers.status, query.status as never) : undefined,
      query.q
        ? or(
            ilike(servers.name, `%${query.q.replace(/[%_]/g, '')}%`),
            sql`${servers.ips}::text ilike ${`%${query.q.replace(/[%_]/g, '')}%`}`,
          )
        : undefined,
    ];
    if (query.label) {
      const [key, value] = query.label.split('=');
      filters.push(
        value !== undefined ? sql`${servers.labels} ->> ${key} = ${value}` : sql`${servers.labels} ? ${key}`,
      );
    }
    const rows = await serverRowsQuery(ctx)
      .where(and(...filters))
      .orderBy(servers.name);
    const visible = [];
    for (const row of rows) {
      if (await access.can(req, 'server:read', serverScope(row)))
        visible.push(await toServerDto(ctx, req, row));
    }
    return visible;
  });

  app.get('/servers/:id', async (req) => {
    const loaded = await load(req);
    const { refresh } = parse(z.object({ refresh: z.coerce.boolean().optional() }), req.query);
    if (refresh) {
      try {
        await ctx.sync.refreshServer(loaded.server.id);
        return toServerDto(ctx, req, { ...(await loadServer(ctx, req, loaded.server.id)) });
      } catch (err) {
        req.log.warn({ err }, 'live refresh failed, serving cached state');
      }
    }
    return toServerDto(ctx, req, loaded);
  });

  app.patch('/servers/:id', async (req) => {
    const loaded = await load(req);
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(63).optional(),
        labels: labelsSchema.optional(),
        protection: z.object({ delete: z.boolean(), rebuild: z.boolean() }).partial().optional(),
      }),
      req.body,
    );
    if (body.name !== undefined) await access.assert(req, 'server:rename', loaded.scope);
    if (body.labels !== undefined) await access.assert(req, 'server:labels', loaded.scope);
    if (body.protection !== undefined) await access.assert(req, 'server:protection', loaded.scope);

    if (body.name && body.name !== loaded.server.name && loaded.adapter.rename) {
      await loaded.adapter
        .rename(loaded.ref, body.name)
        .catch((err) => req.log.warn({ err }, 'provider rename failed'));
    }
    await db
      .update(servers)
      .set({
        ...(body.name ? { name: body.name, providerName: body.name } : {}),
        ...(body.labels ? { labels: body.labels } : {}),
        ...(body.protection ? { protection: { ...loaded.server.protection, ...body.protection } } : {}),
      })
      .where(eq(servers.id, loaded.server.id));
    await ctx.audit.record(req, {
      action: 'server.update',
      orgId: loaded.scope.orgId,
      resourceType: 'server',
      resourceId: loaded.server.id,
      details: body,
    });
    return toServerDto(ctx, req, await loadServer(ctx, req, loaded.server.id));
  });

  app.post('/servers/:id/move', async (req) => {
    const loaded = await load(req, 'server:move');
    const { projectId } = parse(z.object({ projectId: z.uuid() }), req.body);
    const target = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
    if (!target) throw notFound('Project');
    if (target.orgId !== loaded.scope.orgId)
      throw forbidden('Servers can only be moved within the organization');
    await access.assert(req, 'project:update', projectScope(target));
    await db.update(servers).set({ projectId }).where(eq(servers.id, loaded.server.id));
    await ctx.audit.record(req, {
      action: 'server.move',
      orgId: loaded.scope.orgId,
      resourceType: 'server',
      resourceId: loaded.server.id,
      details: { from: loaded.project?.id, to: projectId },
    });
    return { ok: true };
  });

  // --- Power & console ------------------------------------------------------------

  app.post('/servers/:id/power', async (req) => {
    const loaded = await load(req, 'server:power');
    requireCapability(loaded, 'power');
    const { action } = parse(z.object({ action: z.enum(POWER_ACTIONS) }), req.body);
    if (!loaded.adapter.powerActions(loaded.ref).includes(action)) {
      throw unsupported(`Power action "${action}" is not available for this server`);
    }
    return runServerAction(ctx, req, loaded, `power.${action}`, { action }, () =>
      loaded.adapter.power!(loaded.ref, action),
    );
  });

  app.post('/servers/:id/console', async (req) => {
    const loaded = await load(req, 'server:console');
    requireCapability(loaded, 'console');
    const auth = requireSession(req);
    const session = await loaded.adapter.openConsole!(loaded.ref);
    await ctx.audit.record(req, {
      action: 'server.console',
      orgId: loaded.scope.orgId,
      resourceType: 'server',
      resourceId: loaded.server.id,
    });
    if (session.type === 'url') return { type: 'url', url: session.url };
    const ticket = ctx.consoleTickets.issue(loaded.server.id, auth.user.id, session);
    return {
      type: 'vnc',
      path: `/api/v1/servers/${loaded.server.id}/console/ws?ticket=${encodeURIComponent(ticket)}`,
      password: session.password,
    };
  });

  // --- Monitoring -----------------------------------------------------------------

  app.get('/servers/:id/metrics', async (req) => {
    const loaded = await load(req, 'server:metrics');
    requireCapability(loaded, 'metrics');
    const { range } = parse(z.object({ range: z.enum(METRIC_RANGES).default('hour') }), req.query);
    return loaded.adapter.getMetrics!(loaded.ref, range);
  });

  app.get('/servers/:id/monitoring', async (req) => {
    const loaded = await load(req, 'server:metrics');
    requireCapability(loaded, 'monitoring');
    return loaded.adapter.getMonitoring!(loaded.ref);
  });

  app.get('/servers/:id/traffic', async (req) => {
    const loaded = await load(req, 'server:metrics');
    requireCapability(loaded, 'traffic');
    return loaded.adapter.getTraffic!(loaded.ref);
  });

  app.get('/servers/:id/tasks', async (req) => {
    const loaded = await load(req, 'server:task:read');
    const rows = await db
      .select({ action: serverActions, userName: users.name })
      .from(serverActions)
      .leftJoin(users, eq(users.id, serverActions.userId))
      .where(eq(serverActions.serverId, loaded.server.id))
      .orderBy(desc(serverActions.startedAt))
      .limit(50);
    const actions: ServerActionDto[] = rows.map(({ action, userName }) => ({
      id: action.id,
      serverId: action.serverId,
      type: action.type,
      status: action.status,
      startedAt: action.startedAt.toISOString(),
      finishedAt: action.finishedAt?.toISOString() ?? null,
      error: action.error,
      user: action.userId ? { id: action.userId, name: userName ?? '' } : null,
      providerRef: action.providerRef,
    }));
    let providerTasks: unknown[] = [];
    if (loaded.adapter.listTasks) {
      providerTasks = await loaded.adapter.listTasks(loaded.ref).catch((err) => {
        req.log.warn({ err }, 'listing provider tasks failed');
        return [];
      });
    }
    return { actions, providerTasks };
  });

  app.get('/servers/:id/activity', async (req) => {
    const loaded = await load(req, 'server:task:read');
    const query = parse(paginationQuery, req.query);
    return queryAudit(ctx, { ...query, resourceType: 'server', resourceId: loaded.server.id }, null);
  });

  // --- Backups --------------------------------------------------------------------

  app.get('/servers/:id/backups', async (req) => {
    const loaded = await load(req, 'server:backup:read');
    requireCapability(loaded, 'backups');
    return loaded.adapter.listBackups!(loaded.ref);
  });

  app.post('/servers/:id/backups', async (req) => {
    const loaded = await load(req, 'server:backup:create');
    requireCapability(loaded, 'backups');
    const body = parse(z.object({ description: z.string().trim().max(200).optional() }), req.body ?? {});
    return runServerAction(ctx, req, loaded, 'backup.create', body, () =>
      loaded.adapter.createBackup!(loaded.ref, body),
    );
  });

  app.post('/servers/:id/backups/restore', async (req) => {
    const loaded = await load(req, 'server:backup:restore');
    requireCapability(loaded, 'backupRestore');
    const { backupId } = parse(z.object({ backupId: z.string().min(1).max(300) }), req.body);
    return runServerAction(ctx, req, loaded, 'backup.restore', { backupId }, () =>
      loaded.adapter.restoreBackup!(loaded.ref, backupId),
    );
  });

  app.delete('/servers/:id/backups', async (req) => {
    const loaded = await load(req, 'server:backup:delete');
    requireCapability(loaded, 'backupDelete');
    const { backupId } = parse(z.object({ backupId: z.string().min(1).max(300) }), req.query);
    return runServerAction(ctx, req, loaded, 'backup.delete', { backupId }, () =>
      loaded.adapter.deleteBackup!(loaded.ref, backupId),
    );
  });

  // --- Snapshots ------------------------------------------------------------------

  const snapshotParams = idParams.extend({ snapshot: z.string().min(1).max(60) });

  app.get('/servers/:id/snapshots', async (req) => {
    const loaded = await load(req, 'server:snapshot:read');
    requireCapability(loaded, 'snapshots');
    return loaded.adapter.listSnapshots!(loaded.ref);
  });

  app.post('/servers/:id/snapshots', async (req) => {
    const loaded = await load(req, 'server:snapshot:create');
    requireCapability(loaded, 'snapshots');
    const body = parse(
      z.object({
        name: z.string().min(2).max(40),
        description: z.string().max(200).optional(),
        includeRam: z.boolean().optional(),
      }),
      req.body,
    );
    return runServerAction(ctx, req, loaded, 'snapshot.create', body, () =>
      loaded.adapter.createSnapshot!(loaded.ref, body),
    );
  });

  app.post('/servers/:id/snapshots/:snapshot/rollback', async (req) => {
    const loaded = await load(req, 'server:snapshot:rollback');
    requireCapability(loaded, 'snapshots');
    const { snapshot } = parse(snapshotParams, req.params);
    return runServerAction(ctx, req, loaded, 'snapshot.rollback', { snapshot }, () =>
      loaded.adapter.rollbackSnapshot!(loaded.ref, snapshot),
    );
  });

  app.delete('/servers/:id/snapshots/:snapshot', async (req) => {
    const loaded = await load(req, 'server:snapshot:delete');
    requireCapability(loaded, 'snapshots');
    const { snapshot } = parse(snapshotParams, req.params);
    return runServerAction(ctx, req, loaded, 'snapshot.delete', { snapshot }, () =>
      loaded.adapter.deleteSnapshot!(loaded.ref, snapshot),
    );
  });

  // --- Configuration & lifecycle ---------------------------------------------------

  app.get('/servers/:id/config', async (req) => {
    const loaded = await load(req, 'server:config:read');
    requireCapability(loaded, 'config');
    return loaded.adapter.getConfig!(loaded.ref);
  });

  app.post('/servers/:id/rescale', async (req) => {
    const loaded = await load(req, 'server:rescale');
    requireCapability(loaded, 'rescale');
    const body = parse(
      z
        .object({
          cores: z.number().int().min(1).max(256).optional(),
          memoryMb: z
            .number()
            .int()
            .min(256)
            .max(4 * 1024 * 1024)
            .optional(),
          diskGb: z.number().int().min(1).max(100_000).optional(),
        })
        .refine((b) => b.cores || b.memoryMb || b.diskGb, 'Nothing to change'),
      req.body,
    );
    return runServerAction(ctx, req, loaded, 'rescale', body, () =>
      loaded.adapter.rescale!(loaded.ref, body),
    );
  });

  app.get('/servers/:id/images', async (req) => {
    const loaded = await load(req, 'server:rebuild');
    requireCapability(loaded, 'rebuild');
    return loaded.adapter.listImages!(loaded.ref);
  });

  app.post('/servers/:id/rebuild', async (req) => {
    const loaded = await load(req, 'server:rebuild');
    requireCapability(loaded, 'rebuild');
    if (loaded.server.protection.rebuild) throw locked('Rebuild protection is enabled for this server');
    const { imageId } = parse(z.object({ imageId: z.string().min(1).max(200) }), req.body);
    return runServerAction(ctx, req, loaded, 'rebuild', { imageId }, () =>
      loaded.adapter.rebuild!(loaded.ref, imageId),
    );
  });

  app.post('/servers/:id/password-reset', async (req) => {
    const loaded = await load(req, 'server:password-reset');
    requireCapability(loaded, 'passwordReset');
    requireSession(req);
    return runServerAction(ctx, req, loaded, 'password_reset', null, () =>
      loaded.adapter.resetPassword!(loaded.ref),
    );
  });

  app.delete('/servers/:id', async (req) => {
    const loaded = await load(req, 'server:delete');
    requireCapability(loaded, 'delete');
    requireSession(req);
    if (loaded.server.protection.delete) throw locked('Delete protection is enabled for this server');
    const { confirm } = parse(z.object({ confirm: z.string() }), req.body ?? {});
    if (confirm !== loaded.server.name) throw badRequest('Type the server name to confirm');
    const result = await runServerAction(ctx, req, loaded, 'delete', { name: loaded.server.name }, () =>
      loaded.adapter.deleteServer!(loaded.ref),
    );
    await db
      .update(servers)
      .set({ status: 'missing', missingSince: new Date() })
      .where(eq(servers.id, loaded.server.id));
    return result;
  });

  // --- Networking -----------------------------------------------------------------

  app.get('/servers/:id/network', async (req) => {
    const loaded = await load(req, 'server:network:read');
    const ddos = loaded.adapter.getDdos ? await loaded.adapter.getDdos(loaded.ref).catch(() => []) : [];
    return { ips: loaded.server.ips, ddos };
  });

  app.post('/servers/:id/rdns', async (req) => {
    const loaded = await load(req, 'server:network:update');
    requireCapability(loaded, 'rdns');
    const body = parse(
      z.object({
        ip: z.string().min(2).max(60),
        hostname: z
          .string()
          .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}\.?$/i, 'invalid hostname'),
      }),
      req.body,
    );
    if (!loaded.server.ips.some((ip) => ip.address === body.ip))
      throw badRequest('IP does not belong to this server');
    return runServerAction(ctx, req, loaded, 'rdns', body, () =>
      loaded.adapter.setRdns!(loaded.ref, body.ip, body.hostname),
    );
  });

  app.post('/servers/:id/ddos', async (req) => {
    const loaded = await load(req, 'server:network:update');
    requireCapability(loaded, 'ddos');
    const body = parse(
      z.object({
        ip: z.string().min(2).max(60),
        layer4: z.string().max(30).optional(),
        layer7: z.string().max(30).optional(),
      }),
      req.body,
    );
    return runServerAction(ctx, req, loaded, 'ddos', body, () => loaded.adapter.setDdos!(loaded.ref, body));
  });

  // --- ISO ------------------------------------------------------------------------

  app.get('/servers/:id/isos', async (req) => {
    const loaded = await load(req, 'server:iso');
    requireCapability(loaded, 'iso');
    const [isos, config] = await Promise.all([
      loaded.adapter.listIsos!(loaded.ref),
      loaded.adapter.getConfig?.(loaded.ref).catch(() => null) ?? Promise.resolve(null),
    ]);
    const mounted =
      (config?.ide2 as string | undefined)?.split(',')[0] ??
      (config?.iso as string | null | undefined) ??
      null;
    return { isos, mounted: mounted && mounted !== 'none' ? mounted : null };
  });

  app.post('/servers/:id/iso', async (req) => {
    const loaded = await load(req, 'server:iso');
    requireCapability(loaded, 'iso');
    const { isoId } = parse(z.object({ isoId: z.string().min(1).max(300) }), req.body);
    return runServerAction(ctx, req, loaded, 'iso.mount', { isoId }, () =>
      loaded.adapter.mountIso!(loaded.ref, isoId),
    );
  });

  app.delete('/servers/:id/iso', async (req) => {
    const loaded = await load(req, 'server:iso');
    requireCapability(loaded, 'iso');
    return runServerAction(ctx, req, loaded, 'iso.unmount', null, () =>
      loaded.adapter.unmountIso!(loaded.ref),
    );
  });

  // --- Firewall -------------------------------------------------------------------

  app.get('/servers/:id/firewall', async (req) => {
    const loaded = await load(req, 'server:firewall:read');
    requireCapability(loaded, 'firewall');
    return loaded.adapter.getFirewall!(loaded.ref);
  });

  app.post('/servers/:id/firewall/rules', async (req) => {
    const loaded = await load(req, 'server:firewall:write');
    requireCapability(loaded, 'firewall');
    const rule = parse(firewallRuleBody, req.body);
    return runServerAction(ctx, req, loaded, 'firewall.rule_add', rule, () =>
      loaded.adapter.addFirewallRule!(loaded.ref, rule),
    );
  });

  app.delete('/servers/:id/firewall/rules/:pos', async (req) => {
    const loaded = await load(req, 'server:firewall:write');
    requireCapability(loaded, 'firewall');
    const { pos } = parse(idParams.extend({ pos: z.coerce.number().int().min(0) }), req.params);
    return runServerAction(ctx, req, loaded, 'firewall.rule_delete', { pos }, () =>
      loaded.adapter.deleteFirewallRule!(loaded.ref, pos),
    );
  });

  app.post('/servers/:id/firewall/enabled', async (req) => {
    const loaded = await load(req, 'server:firewall:write');
    requireCapability(loaded, 'firewall');
    const { enabled } = parse(z.object({ enabled: z.boolean() }), req.body);
    return runServerAction(ctx, req, loaded, enabled ? 'firewall.enable' : 'firewall.disable', null, () =>
      loaded.adapter.setFirewallEnabled!(loaded.ref, enabled),
    );
  });
}
