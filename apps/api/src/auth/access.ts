import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import {
  allowedActions,
  can,
  moduleDenyStatements,
  TOKEN_SCOPE_POLICIES,
  type AccessSubject,
  type Permission,
  type PolicyStatement,
  type ResourceContext,
} from '@weblion/shared';
import type { Database } from '../db/client';
import { membershipPolicies, memberships, organizations, policies, type Organization } from '../db/schema';
import { forbidden, unauthorized } from '../lib/errors';
import type { AuthState } from './types';

/** Organization that owns a resource (null for servers not assigned to anyone yet) plus its path. */
export interface Scope {
  orgId: string | null;
  resource: ResourceContext;
}

export const orgScope = (orgId: string): Scope => ({ orgId, resource: { path: 'org' } });
export const platformScope: Scope = { orgId: null, resource: { path: 'platform' } };

/** Read-only actions. */
const READ_ONLY = ['*:read', 'server:metrics', 'server:task:read'];

/**
 * What stays available while an organization is suspended: reading, and paying its own
 * bills. Staff of a suspended reseller still enter their customers
 * (reseller:customer:access), but only to read there (see AccessService.subject).
 */
const SUSPENDED_ALLOWED = [...READ_ONLY, 'billing:*', 'reseller:customer:access'];

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
    const org = orgId
      ? await this.db.query.organizations.findFirst({ where: eq(organizations.id, orgId) })
      : undefined;
    const parent = org?.parentOrgId
      ? await this.db.query.organizations.findFirst({ where: eq(organizations.id, org.parentOrgId) })
      : undefined;

    let subject: AccessSubject;
    // Tokens are bound to one organization (plus the customers below it, if it is a reseller)
    // and never carry platform privileges.
    const tokenReach = token && (orgId === token.orgId || (!!parent && parent.id === token.orgId));
    if (token && !tokenReach) {
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
      if (org) {
        subject.boundary = effectiveBoundary(org);
        if (parent) subject.parentBoundary = effectiveBoundary(parent);
        const membership = await this.membership(org.id, auth.user.id);
        // A token bound to the reseller acts through the reseller even if its owner is
        // also a member of the customer.
        if (membership && !(token && token.orgId !== org.id)) {
          subject.orgRole = membership.role;
          subject.memberPolicies = await this.memberPolicies(membership.id);
        } else if (parent) {
          const resellerMembership = await this.membership(parent.id, auth.user.id);
          if (resellerMembership) {
            subject.reseller = {
              role: resellerMembership.role,
              memberPolicies: await this.memberPolicies(resellerMembership.id),
              boundary: effectiveBoundary(parent),
            };
            // The billing:* of a suspended reseller is for its own bills, not its customers'.
            if (parent.status === 'suspended') subject.parentBoundary = effectiveBoundary(parent, READ_ONLY);
          }
        }
      }
    }

    req.accessCache.set(cacheKey, subject);
    return subject;
  }

  private membership(orgId: string, userId: string) {
    return this.db.query.memberships.findFirst({
      where: and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)),
    });
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

/**
 * Boundary, suspension and inactive modules of one organization combined into one statement
 * list. `suspendedAllowed` is what a suspension leaves open.
 */
export function effectiveBoundary(
  org: Pick<Organization, 'boundary' | 'status' | 'modules'>,
  suspendedAllowed: string[] = SUSPENDED_ALLOWED,
): PolicyStatement[] {
  const base = org.status === 'suspended' ? suspendedBoundary(org.boundary, suspendedAllowed) : org.boundary;
  return [...base, ...moduleDenyStatements(org.modules)];
}

/** While suspended, the normal boundary still applies and everything but `allowed` is denied on top. */
function suspendedBoundary(boundary: PolicyStatement[], allowed: string[]): PolicyStatement[] {
  return [
    ...boundary.filter((s) => s.effect === 'deny'),
    { sid: 'SuspendedReadOnly', effect: 'allow', actions: allowed },
  ];
}
