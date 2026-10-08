import { and, count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { PolicyDto } from '@weblion/shared';
import type { AppContext } from '../../context';
import { orgScope, requireSession } from '../../auth/access';
import { membershipPolicies, policies, type Policy } from '../../db/schema';
import { conflict, notFound } from '../../lib/errors';
import { parse, parseStatements } from '../../lib/validation';
import { loadOrg } from '../orgs/routes';

const orgParams = z.object({ orgId: z.uuid() });
const policyParams = orgParams.extend({ policyId: z.uuid() });
const policyBody = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullish(),
  statements: z.unknown(),
});

export async function policyRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, access, audit } = ctx;

  async function toDto(policy: Policy): Promise<PolicyDto> {
    const [attached] = await db
      .select({ n: count() })
      .from(membershipPolicies)
      .where(eq(membershipPolicies.policyId, policy.id));
    return {
      id: policy.id,
      orgId: policy.orgId,
      name: policy.name,
      description: policy.description,
      statements: policy.statements,
      attachedCount: attached?.n ?? 0,
      createdAt: policy.createdAt.toISOString(),
      updatedAt: policy.updatedAt.toISOString(),
    };
  }

  async function nameTaken(orgId: string, name: string, exceptId?: string) {
    const existing = await db.query.policies.findFirst({
      where: and(eq(policies.orgId, orgId), eq(policies.name, name)),
    });
    return !!existing && existing.id !== exceptId;
  }

  app.get('/orgs/:orgId/policies', async (req) => {
    const { orgId } = parse(orgParams, req.params);
    await loadOrg(ctx, req, orgId);
    await access.assert(req, 'policy:read', orgScope(orgId));
    const rows = await db.select().from(policies).where(eq(policies.orgId, orgId)).orderBy(policies.name);
    return Promise.all(rows.map(toDto));
  });

  app.post('/orgs/:orgId/policies', async (req) => {
    const { orgId } = parse(orgParams, req.params);
    requireSession(req);
    await loadOrg(ctx, req, orgId);
    await access.assert(req, 'policy:write', orgScope(orgId));
    const body = parse(policyBody, req.body);
    const statements = parseStatements(body.statements);
    if (await nameTaken(orgId, body.name)) throw conflict('A policy with this name exists');
    const [policy] = await db
      .insert(policies)
      .values({ orgId, name: body.name, description: body.description ?? null, statements })
      .returning();
    await audit.record(req, {
      action: 'policy.create',
      orgId,
      resourceType: 'policy',
      resourceId: policy!.id,
      details: { name: body.name, statements },
    });
    return toDto(policy!);
  });

  app.patch('/orgs/:orgId/policies/:policyId', async (req) => {
    const { orgId, policyId } = parse(policyParams, req.params);
    requireSession(req);
    await loadOrg(ctx, req, orgId);
    await access.assert(req, 'policy:write', orgScope(orgId));
    const body = parse(policyBody.partial(), req.body);
    const existing = await db.query.policies.findFirst({
      where: and(eq(policies.id, policyId), eq(policies.orgId, orgId)),
    });
    if (!existing) throw notFound('Policy');
    if (body.name && (await nameTaken(orgId, body.name, policyId)))
      throw conflict('A policy with this name exists');
    const statements = body.statements !== undefined ? parseStatements(body.statements) : undefined;
    const [policy] = await db
      .update(policies)
      .set({
        ...(body.name ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description ?? null } : {}),
        ...(statements ? { statements } : {}),
      })
      .where(eq(policies.id, policyId))
      .returning();
    await audit.record(req, {
      action: 'policy.update',
      orgId,
      resourceType: 'policy',
      resourceId: policyId,
      details: { before: existing.statements, after: policy!.statements },
    });
    return toDto(policy!);
  });

  app.delete('/orgs/:orgId/policies/:policyId', async (req) => {
    const { orgId, policyId } = parse(policyParams, req.params);
    requireSession(req);
    await loadOrg(ctx, req, orgId);
    await access.assert(req, 'policy:write', orgScope(orgId));
    const deleted = await db
      .delete(policies)
      .where(and(eq(policies.id, policyId), eq(policies.orgId, orgId)))
      .returning({ id: policies.id, name: policies.name });
    if (deleted.length === 0) throw notFound('Policy');
    await audit.record(req, {
      action: 'policy.delete',
      orgId,
      resourceType: 'policy',
      resourceId: policyId,
      details: { name: deleted[0]!.name },
    });
    return { ok: true };
  });
}
