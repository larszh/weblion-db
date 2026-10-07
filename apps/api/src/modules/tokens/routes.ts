import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TOKEN_SCOPES, type ApiTokenDto } from '@weblion/shared';
import type { AppContext } from '../../context';
import { orgScope, requireSession } from '../../auth/access';
import { generateApiToken } from '../../auth/sessions';
import { apiTokens, users } from '../../db/schema';
import { badRequest, notFound } from '../../lib/errors';
import { iso } from '../../lib/dto';
import { parse, parseStatements } from '../../lib/validation';
import { loadOrg } from '../orgs/routes';

const orgParams = z.object({ orgId: z.uuid() });

export async function tokenRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, access, audit } = ctx;

  app.get('/orgs/:orgId/tokens', async (req): Promise<ApiTokenDto[]> => {
    const { orgId } = parse(orgParams, req.params);
    const auth = requireSession(req);
    await loadOrg(ctx, req, orgId);
    await access.assert(req, 'apitoken:read', orgScope(orgId));
    // Admins (member:update) see every token of the organization, others only their own.
    const seeAll = await access.can(req, 'member:update', orgScope(orgId));
    const rows = await db
      .select({ token: apiTokens, userName: users.name })
      .from(apiTokens)
      .innerJoin(users, eq(users.id, apiTokens.userId))
      .where(
        and(
          eq(apiTokens.orgId, orgId),
          isNull(apiTokens.revokedAt),
          seeAll ? undefined : eq(apiTokens.userId, auth.user.id),
        ),
      )
      .orderBy(sql`${apiTokens.createdAt} desc`);
    return rows.map(({ token, userName }) => ({
      id: token.id,
      name: token.name,
      prefix: token.prefix,
      scope: token.scope,
      statements: token.statements,
      user: { id: token.userId, name: userName },
      lastUsedAt: iso(token.lastUsedAt),
      expiresAt: iso(token.expiresAt),
      createdAt: token.createdAt.toISOString(),
    }));
  });

  app.post('/orgs/:orgId/tokens', async (req): Promise<ApiTokenDto> => {
    const { orgId } = parse(orgParams, req.params);
    const auth = requireSession(req);
    await loadOrg(ctx, req, orgId);
    await access.assert(req, 'apitoken:write', orgScope(orgId));
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(80),
        scope: z.enum(TOKEN_SCOPES),
        statements: z.unknown().optional(),
        expiresInDays: z.number().int().min(1).max(3650).nullish(),
      }),
      req.body,
    );
    if (body.scope === 'custom' && body.statements === undefined)
      throw badRequest('Custom tokens need statements');
    const statements = body.scope === 'custom' ? parseStatements(body.statements) : null;
    const generated = generateApiToken();
    const [token] = await db
      .insert(apiTokens)
      .values({
        userId: auth.user.id,
        orgId,
        name: body.name,
        tokenHash: generated.hash,
        prefix: generated.prefix,
        scope: body.scope,
        statements,
        expiresAt: body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86_400_000) : null,
      })
      .returning();
    await audit.record(req, {
      action: 'apitoken.create',
      orgId,
      resourceType: 'token',
      resourceId: token!.id,
      details: { name: body.name, scope: body.scope },
    });
    return {
      id: token!.id,
      name: token!.name,
      prefix: token!.prefix,
      scope: token!.scope,
      statements: token!.statements,
      user: { id: auth.user.id, name: auth.user.name },
      lastUsedAt: null,
      expiresAt: iso(token!.expiresAt),
      createdAt: token!.createdAt.toISOString(),
      token: generated.token,
    };
  });

  app.delete('/orgs/:orgId/tokens/:tokenId', async (req) => {
    const { orgId, tokenId } = parse(orgParams.extend({ tokenId: z.uuid() }), req.params);
    const auth = requireSession(req);
    await loadOrg(ctx, req, orgId);
    await access.assert(req, 'apitoken:write', orgScope(orgId));
    const token = await db.query.apiTokens.findFirst({
      where: and(eq(apiTokens.id, tokenId), eq(apiTokens.orgId, orgId)),
    });
    if (!token) throw notFound('Token');
    if (token.userId !== auth.user.id) await access.assert(req, 'member:update', orgScope(orgId));
    await db.update(apiTokens).set({ revokedAt: new Date() }).where(eq(apiTokens.id, tokenId));
    await audit.record(req, { action: 'apitoken.revoke', orgId, resourceType: 'token', resourceId: tokenId });
    return { ok: true };
  });
}
