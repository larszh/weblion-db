import { and, count, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  isOrgRole,
  ORG_PERMISSIONS,
  ORG_ROLE_RANK,
  ORG_ROLES,
  type InvitationDto,
  type MemberDto,
  type OrgCounts,
  type OrgDto,
  type OrgRef,
  type OrgRole,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import { orgScope, requireAuth, requireSession } from '../../auth/access';
import {
  domains,
  invitations,
  membershipPolicies,
  memberships,
  organizations,
  policies,
  projects,
  servers,
  users,
  webspaces,
  type Organization,
} from '../../db/schema';
import { randomToken, sha256 } from '../../lib/crypto';
import { iso } from '../../lib/dto';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { parse } from '../../lib/validation';

const orgParams = z.object({ orgId: z.uuid() });
const memberParams = orgParams.extend({ membershipId: z.uuid() });
const invitationParams = orgParams.extend({ invitationId: z.uuid() });

export async function loadOrg(ctx: AppContext, req: FastifyRequest, orgId: string): Promise<Organization> {
  requireAuth(req);
  const org = await ctx.db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
  // Hide existence from people who cannot see it.
  if (!org || !(await ctx.access.canSeeOrg(req, orgId))) throw notFound('Organization');
  return org;
}

export async function orgCounts(ctx: AppContext, orgId: string): Promise<OrgCounts> {
  const [p, s, m, d, w, c] = await Promise.all([
    ctx.db.select({ n: count() }).from(projects).where(eq(projects.orgId, orgId)),
    ctx.db
      .select({ n: count() })
      .from(servers)
      .innerJoin(projects, eq(projects.id, servers.projectId))
      .where(eq(projects.orgId, orgId)),
    ctx.db.select({ n: count() }).from(memberships).where(eq(memberships.orgId, orgId)),
    ctx.db.select({ n: count() }).from(domains).where(eq(domains.orgId, orgId)),
    ctx.db.select({ n: count() }).from(webspaces).where(eq(webspaces.orgId, orgId)),
    ctx.db.select({ n: count() }).from(organizations).where(eq(organizations.parentOrgId, orgId)),
  ]);
  return {
    projects: p[0]?.n ?? 0,
    servers: s[0]?.n ?? 0,
    members: m[0]?.n ?? 0,
    domains: d[0]?.n ?? 0,
    webspaces: w[0]?.n ?? 0,
    customers: c[0]?.n ?? 0,
  };
}

export async function orgRef(ctx: AppContext, orgId: string | null): Promise<OrgRef | null> {
  if (!orgId) return null;
  const org = await ctx.db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
  return org ? { id: org.id, name: org.name, slug: org.slug } : null;
}

export async function toOrgDto(ctx: AppContext, req: FastifyRequest, org: Organization): Promise<OrgDto> {
  const subject = await ctx.access.subject(req, org.id);
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    kind: org.kind,
    status: org.status,
    createdAt: org.createdAt.toISOString(),
    role: subject.orgRole ?? null,
    permissions: await ctx.access.allowed(req, ORG_PERMISSIONS, orgScope(org.id)),
    modules: org.modules,
    parent: await orgRef(ctx, org.parentOrgId),
    access: subject.orgRole ? 'member' : subject.reseller ? 'reseller' : 'staff',
    counts: await orgCounts(ctx, org.id),
  };
}

export async function orgRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, access, audit } = ctx;

  app.get('/orgs', async (req) => {
    const auth = requireAuth(req);
    const rows = await db
      .select({ org: organizations })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(
        auth.token
          ? and(eq(memberships.userId, auth.user.id), eq(memberships.orgId, auth.token.orgId))
          : eq(memberships.userId, auth.user.id),
      )
      .orderBy(organizations.name);
    return Promise.all(rows.map((r) => toOrgDto(ctx, req, r.org)));
  });

  app.get('/orgs/:orgId', async (req) => {
    const { orgId } = parse(orgParams, req.params);
    return toOrgDto(ctx, req, await loadOrg(ctx, req, orgId));
  });

  /** The console uses slugs in URLs. Staff can open organizations they are not a member of. */
  app.get('/orgs/by-slug/:slug', async (req) => {
    const { slug } = parse(z.object({ slug: z.string().min(1).max(60) }), req.params);
    requireAuth(req);
    const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, slug) });
    if (!org) throw notFound('Organization');
    return toOrgDto(ctx, req, await loadOrg(ctx, req, org.id));
  });

  app.patch('/orgs/:orgId', async (req) => {
    const { orgId } = parse(orgParams, req.params);
    await loadOrg(ctx, req, orgId);
    await access.assert(req, 'org:update', orgScope(orgId));
    const body = parse(z.object({ name: z.string().trim().min(2).max(100) }), req.body);
    const [org] = await db.update(organizations).set(body).where(eq(organizations.id, orgId)).returning();
    await audit.record(req, {
      action: 'org.update',
      orgId,
      resourceType: 'org',
      resourceId: orgId,
      details: body,
    });
    return toOrgDto(ctx, req, org!);
  });

  // --- Members --------------------------------------------------------------------

  async function listMembers(orgId: string): Promise<MemberDto[]> {
    const rows = await db
      .select({ membership: memberships, user: users })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.orgId, orgId))
      .orderBy(users.name);
    const links = rows.length
      ? await db
          .select({ membershipId: membershipPolicies.membershipId, id: policies.id, name: policies.name })
          .from(membershipPolicies)
          .innerJoin(policies, eq(policies.id, membershipPolicies.policyId))
          .where(
            inArray(
              membershipPolicies.membershipId,
              rows.map((r) => r.membership.id),
            ),
          )
      : [];
    return rows.map(({ membership, user }) => ({
      membershipId: membership.id,
      userId: user.id,
      email: user.email,
      name: user.name,
      role: membership.role,
      mfaEnabled: user.totpEnabled,
      policies: links
        .filter((l) => l.membershipId === membership.id)
        .map((l) => ({ id: l.id, name: l.name })),
      joinedAt: membership.createdAt.toISOString(),
      lastLoginAt: iso(user.lastLoginAt),
    }));
  }

  app.get('/orgs/:orgId/members', async (req) => {
    const { orgId } = parse(orgParams, req.params);
    await loadOrg(ctx, req, orgId);
    await access.assert(req, 'member:read', orgScope(orgId));
    return listMembers(orgId);
  });

  /** Owners manage owners. Everyone else can only hand out roles below their own. */
  async function assertCanGrant(req: FastifyRequest, orgId: string, role: OrgRole) {
    const subject = await access.subject(req, orgId);
    if (subject.platformRole === 'superadmin') return;
    const mine = subject.orgRole;
    if (!mine) throw forbidden();
    if (mine === 'owner') return;
    if (ORG_ROLE_RANK[role] >= ORG_ROLE_RANK[mine])
      throw forbidden(`Only owners can grant the role "${role}"`);
  }

  async function ownerCount(orgId: string) {
    const [row] = await db
      .select({ n: count() })
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.role, 'owner')));
    return row?.n ?? 0;
  }

  app.patch('/orgs/:orgId/members/:membershipId', async (req) => {
    const { orgId, membershipId } = parse(memberParams, req.params);
    requireSession(req);
    await loadOrg(ctx, req, orgId);
    const body = parse(
      z.object({ role: z.enum(ORG_ROLES).optional(), policyIds: z.array(z.uuid()).max(20).optional() }),
      req.body,
    );
    const member = await db.query.memberships.findFirst({
      where: and(eq(memberships.id, membershipId), eq(memberships.orgId, orgId)),
    });
    if (!member) throw notFound('Member');
    await access.assert(req, 'member:update', { orgId, resource: { path: `member/${member.userId}` } });
    // Changing an owner (or making someone owner) is reserved to owners.
    await assertCanGrant(req, orgId, member.role === 'owner' ? 'owner' : (body.role ?? member.role));
    if (body.role) await assertCanGrant(req, orgId, body.role);

    if (body.role && body.role !== 'owner' && member.role === 'owner' && (await ownerCount(orgId)) <= 1) {
      throw conflict('An organization needs at least one owner');
    }

    await db.transaction(async (tx) => {
      if (body.role)
        await tx.update(memberships).set({ role: body.role }).where(eq(memberships.id, membershipId));
      if (body.policyIds) {
        if (body.policyIds.length > 0) {
          const owned = await tx
            .select({ id: policies.id })
            .from(policies)
            .where(and(eq(policies.orgId, orgId), inArray(policies.id, body.policyIds)));
          if (owned.length !== new Set(body.policyIds).size) throw badRequest('Unknown policy');
        }
        await tx.delete(membershipPolicies).where(eq(membershipPolicies.membershipId, membershipId));
        if (body.policyIds.length > 0) {
          await tx
            .insert(membershipPolicies)
            .values([...new Set(body.policyIds)].map((policyId) => ({ membershipId, policyId })));
        }
      }
    });
    await audit.record(req, {
      action: 'member.update',
      orgId,
      resourceType: 'user',
      resourceId: member.userId,
      details: { ...body, previousRole: member.role },
    });
    return (await listMembers(orgId)).find((m) => m.membershipId === membershipId);
  });

  app.delete('/orgs/:orgId/members/:membershipId', async (req) => {
    const { orgId, membershipId } = parse(memberParams, req.params);
    const auth = requireSession(req);
    await loadOrg(ctx, req, orgId);
    const member = await db.query.memberships.findFirst({
      where: and(eq(memberships.id, membershipId), eq(memberships.orgId, orgId)),
    });
    if (!member) throw notFound('Member');
    const leaving = member.userId === auth.user.id;
    if (!leaving) {
      await access.assert(req, 'member:remove', { orgId, resource: { path: `member/${member.userId}` } });
      await assertCanGrant(req, orgId, member.role);
    }
    if (member.role === 'owner' && (await ownerCount(orgId)) <= 1) {
      throw conflict('The last owner cannot leave or be removed');
    }
    await db.delete(memberships).where(eq(memberships.id, membershipId));
    await audit.record(req, {
      action: leaving ? 'member.leave' : 'member.remove',
      orgId,
      resourceType: 'user',
      resourceId: member.userId,
    });
    return { ok: true };
  });

  // --- Invitations ----------------------------------------------------------------

  app.get('/orgs/:orgId/invitations', async (req): Promise<InvitationDto[]> => {
    const { orgId } = parse(orgParams, req.params);
    await loadOrg(ctx, req, orgId);
    await access.assert(req, 'member:read', orgScope(orgId));
    const rows = await db
      .select({ invitation: invitations, inviter: users.name })
      .from(invitations)
      .leftJoin(users, eq(users.id, invitations.invitedBy))
      .where(
        and(
          eq(invitations.orgId, orgId),
          isNull(invitations.acceptedAt),
          gt(invitations.expiresAt, new Date()),
        ),
      )
      .orderBy(sql`${invitations.createdAt} desc`);
    return rows.map(({ invitation, inviter }) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
      invitedBy: inviter,
    }));
  });

  app.post('/orgs/:orgId/invitations', async (req): Promise<InvitationDto> => {
    const { orgId } = parse(orgParams, req.params);
    const auth = requireSession(req);
    await loadOrg(ctx, req, orgId);
    await access.assert(req, 'member:invite', orgScope(orgId));
    const body = parse(z.object({ email: z.email().max(200), role: z.string() }), req.body);
    if (!isOrgRole(body.role)) throw badRequest('Unknown role');
    await assertCanGrant(req, orgId, body.role);

    const existing = await db
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.orgId, orgId), sql`lower(${users.email}) = lower(${body.email})`))
      .limit(1);
    if (existing.length > 0) throw conflict('This person is already a member');

    const token = randomToken(24);
    const [invitation] = await db
      .insert(invitations)
      .values({
        orgId,
        email: body.email.toLowerCase(),
        role: body.role,
        tokenHash: sha256(token),
        invitedBy: auth.user.id,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      })
      .returning();
    await audit.record(req, {
      action: 'member.invite',
      orgId,
      resourceType: 'invitation',
      resourceId: invitation!.id,
      details: { email: body.email, role: body.role },
    });
    return {
      id: invitation!.id,
      email: invitation!.email,
      role: invitation!.role,
      expiresAt: invitation!.expiresAt.toISOString(),
      createdAt: invitation!.createdAt.toISOString(),
      invitedBy: auth.user.name,
      link: `${ctx.env.APP_URL.replace(/\/$/, '')}/invite/${token}`,
    };
  });

  app.delete('/orgs/:orgId/invitations/:invitationId', async (req) => {
    const { orgId, invitationId } = parse(invitationParams, req.params);
    requireSession(req);
    await loadOrg(ctx, req, orgId);
    await access.assert(req, 'member:invite', orgScope(orgId));
    await db.delete(invitations).where(and(eq(invitations.id, invitationId), eq(invitations.orgId, orgId)));
    await audit.record(req, {
      action: 'member.invite_revoke',
      orgId,
      resourceType: 'invitation',
      resourceId: invitationId,
    });
    return { ok: true };
  });
}
