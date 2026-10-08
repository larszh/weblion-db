import { and, count, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { resourcePath, type Permission, type ProjectDto } from '@weblion/shared';
import type { AppContext } from '../../context';
import { orgScope, requireAuth, type Scope } from '../../auth/access';
import { projects, servers, type Project } from '../../db/schema';
import { conflict, notFound } from '../../lib/errors';
import { parse } from '../../lib/validation';
import { loadOrg } from '../orgs/routes';

const PROJECT_ACTIONS: Permission[] = ['project:read', 'project:update', 'project:delete'];

export const projectScope = (project: Pick<Project, 'id' | 'orgId'>): Scope => ({
  orgId: project.orgId,
  resource: { path: resourcePath.project(project.id) },
});

export async function loadProject(ctx: AppContext, req: FastifyRequest, projectId: string): Promise<Project> {
  requireAuth(req);
  const project = await ctx.db.query.projects.findFirst({ where: eq(projects.id, projectId) });
  if (!project || !(await ctx.access.can(req, 'project:read', projectScope(project))))
    throw notFound('Project');
  return project;
}

const projectBody = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullish(),
});

export async function projectRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, access, audit } = ctx;

  async function toDtos(req: FastifyRequest, rows: Project[]): Promise<ProjectDto[]> {
    if (rows.length === 0) return [];
    const stats = await db
      .select({
        projectId: servers.projectId,
        total: count(),
        running: sql<number>`count(*) filter (where ${servers.status} = 'running')`.mapWith(Number),
      })
      .from(servers)
      .where(
        inArray(
          servers.projectId,
          rows.map((r) => r.id),
        ),
      )
      .groupBy(servers.projectId);
    return Promise.all(
      rows.map(async (p) => {
        const s = stats.find((x) => x.projectId === p.id);
        return {
          id: p.id,
          orgId: p.orgId,
          name: p.name,
          description: p.description,
          createdAt: p.createdAt.toISOString(),
          serverCount: s?.total ?? 0,
          runningCount: s?.running ?? 0,
          permissions: await access.allowed(req, PROJECT_ACTIONS, projectScope(p)),
        };
      }),
    );
  }

  app.get('/orgs/:orgId/projects', async (req) => {
    const { orgId } = parse(z.object({ orgId: z.uuid() }), req.params);
    await loadOrg(ctx, req, orgId);
    const rows = await db.select().from(projects).where(eq(projects.orgId, orgId)).orderBy(projects.name);
    const visible: Project[] = [];
    for (const p of rows) if (await access.can(req, 'project:read', projectScope(p))) visible.push(p);
    return toDtos(req, visible);
  });

  app.post('/orgs/:orgId/projects', async (req) => {
    const { orgId } = parse(z.object({ orgId: z.uuid() }), req.params);
    await loadOrg(ctx, req, orgId);
    await access.assert(req, 'project:create', orgScope(orgId));
    const body = parse(projectBody, req.body);
    const [project] = await db
      .insert(projects)
      .values({ orgId, name: body.name, description: body.description ?? null })
      .returning();
    await audit.record(req, {
      action: 'project.create',
      orgId,
      resourceType: 'project',
      resourceId: project!.id,
      details: body,
    });
    return (await toDtos(req, [project!]))[0];
  });

  app.get('/projects/:projectId', async (req) => {
    const { projectId } = parse(z.object({ projectId: z.uuid() }), req.params);
    return (await toDtos(req, [await loadProject(ctx, req, projectId)]))[0];
  });

  app.patch('/projects/:projectId', async (req) => {
    const { projectId } = parse(z.object({ projectId: z.uuid() }), req.params);
    const project = await loadProject(ctx, req, projectId);
    await access.assert(req, 'project:update', projectScope(project));
    const body = parse(projectBody.partial(), req.body);
    const [updated] = await db
      .update(projects)
      .set({
        ...(body.name ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description ?? null } : {}),
      })
      .where(eq(projects.id, projectId))
      .returning();
    await audit.record(req, {
      action: 'project.update',
      orgId: project.orgId,
      resourceType: 'project',
      resourceId: projectId,
      details: body,
    });
    return (await toDtos(req, [updated!]))[0];
  });

  app.delete('/projects/:projectId', async (req) => {
    const { projectId } = parse(z.object({ projectId: z.uuid() }), req.params);
    const project = await loadProject(ctx, req, projectId);
    await access.assert(req, 'project:delete', projectScope(project));
    const [inUse] = await db.select({ n: count() }).from(servers).where(eq(servers.projectId, projectId));
    if ((inUse?.n ?? 0) > 0) throw conflict('Move or delete all servers in this project first');
    await db.delete(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, project.orgId)));
    await audit.record(req, {
      action: 'project.delete',
      orgId: project.orgId,
      resourceType: 'project',
      resourceId: projectId,
      details: { name: project.name },
    });
    return { ok: true };
  });
}
