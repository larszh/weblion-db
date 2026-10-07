import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import {
  allowedActions,
  can,
  TOKEN_SCOPE_POLICIES,
  type AccessSubject,
  type Permission,
  type PolicyStatement,
  type ResourceContext,
} from '@weblion/shared';
import type { Database } from '../db/client';
import { membershipPolicies, memberships, organizations, policies } from '../db/schema';
import { forbidden, unauthorized } from '../lib/errors';
import type { AuthState } from './types';

/** Organization that owns a resource (null for servers not assigned to anyone yet) plus its path. */
export interface Scope {
  orgId: string | null;
  resource: ResourceContext;
}

export const orgScope = (orgId: string): Scope => ({ orgId, resource: { path: 'org' } });
export const platformScope: Scope = { orgId: null, resource: { path: 'platform' } };

/** Read-only actions that stay available while an organization is suspended. */
const SUSPENDED_ALLOWED = ['*:read', 'server:metrics', 'server:task:read', 'billing:*'];

export function requireAuth(req: FastifyRequest): AuthState {
  const auth = req.auth;
  if (!auth || auth.mfaPending) throw unauthorized();
  return auth;
}

/** For account level actions that must not be reachable with API tokens. */
export function requireSession(req: FastifyRequest): AuthState {
  const auth = requireAuth(req);
  if (!auth.sessionId) throw forbidden('This action requires an interactive login');
  return auth;
}

export class AccessService {
  constructor(private readonly db: Database) {}

  async subject(req: FastifyRequest, orgId: string | null): Promise<AccessSubject> {
    const auth = requireAuth(req);
    const cacheKey = orgId ?? '__platform__';
    const cached = req.accessCache.get(cacheKey) as AccessSubject | undefined;
    if (cached) return cached;

    const token = auth.token;
    let subject: AccessSubject;

    if (token && orgId !== token.orgId) {
      // Tokens are bound to one organization and never carry platform privileges.
      subject = {};
    } else {
      subject = {
        platformRole: token ? null : auth.user.platformRole,
        tokenStatements: token
          ? token.scope === 'custom'
            ? (token.statements ?? [])
            : TOKEN_SCOPE_POLICIES[token.scope]
          : null,
      };
      if (orgId) {
        const [membership, org] = await Promise.all([
          this.db.query.memberships.findFirst({
            where: and(eq(memberships.orgId, orgId), eq(memberships.userId, auth.user.id)),
          }),
          this.db.query.organizations.findFirst({ where: eq(organizations.id, orgId) }),
        ]);
        if (org) {
          subject.boundary = org.status === 'suspended' ? suspendedBoundary(org.boundary) : org.boundary;
        }
        if (membership) {
          subject.orgRole = membership.role;
          subject.memberPolicies = await this.memberPolicies(membership.id);
        }
      }
    }

    req.accessCache.set(cacheKey, subject);
    return subject;
  }

  private async memberPolicies(membershipId: string): Promise<PolicyStatement[]> {
    const links = await this.db
      .select({ policyId: membershipPolicies.policyId })
      .from(membershipPolicies)
      .where(eq(membershipPolicies.membershipId, membershipId));
    if (links.length === 0) return [];
    const rows = await this.db
      .select({ statements: policies.statements })
      .from(policies)
      .where(
        inArray(
          policies.id,
          links.map((l) => l.policyId),
        ),
      );
    return rows.flatMap((r) => r.statements);
  }

  async can(req: FastifyRequest, action: Permission, scope: Scope): Promise<boolean> {
    const subject = await this.subject(req, scope.orgId);
    return can(subject, action, scope.resource);
  }

  async assert(req: FastifyRequest, action: Permission, scope: Scope): Promise<void> {
    if (!(await this.can(req, action, scope))) {
      throw forbidden(`Missing permission ${action}`);
    }
  }

  async allowed<T extends Permission>(
    req: FastifyRequest,
    actions: readonly T[],
    scope: Scope,
  ): Promise<T[]> {
    const subject = await this.subject(req, scope.orgId);
    return allowedActions(subject, actions, scope.resource);
  }

  /** True if the request may see the organization at all (member, or staff with read access). */
  async canSeeOrg(req: FastifyRequest, orgId: string): Promise<boolean> {
    return this.can(req, 'org:read', orgScope(orgId));
  }
}

/** While suspended, the normal boundary still applies and everything but reading is denied on top. */
function suspendedBoundary(boundary: PolicyStatement[]): PolicyStatement[] {
  return [
    ...boundary.filter((s) => s.effect === 'deny'),
    { sid: 'SuspendedReadOnly', effect: 'allow', actions: SUSPENDED_ALLOWED },
  ];
}
