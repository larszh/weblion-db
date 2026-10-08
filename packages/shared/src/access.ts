import { isAllowed, type PolicyStatement, type ResourceContext } from './policy';
import { ORG_ROLE_POLICIES, PLATFORM_ROLE_POLICIES, type OrgRole, type PlatformRole } from './roles';
import type { Permission } from './permissions';

/** A user acting inside a customer organization through the reseller that owns it. */
export interface ResellerAccess {
  /** The user's role in the reseller organization. */
  role: OrgRole;
  /** Custom policies attached to that reseller membership. */
  memberPolicies: PolicyStatement[];
  /** Boundary of the reseller organization itself (incl. its module and suspension caps). */
  boundary: PolicyStatement[];
}

/** Everything that decides whether one request may perform one action. */
export interface AccessSubject {
  platformRole?: PlatformRole | null;
  /** Role in the organization that owns the resource, if the user is a member. */
  orgRole?: OrgRole | null;
  /** Custom policies attached to that membership. */
  memberPolicies?: PolicyStatement[];
  /** Permission boundary of the organization that owns the resource. */
  boundary?: PolicyStatement[] | null;
  /**
   * Boundary of the reseller that owns the organization. Caps the organization's own
   * members as well: a reseller can never hand out more than it has itself.
   */
  parentBoundary?: PolicyStatement[] | null;
  /** Set when the user is no member of the organization but of its reseller. */
  reseller?: ResellerAccess | null;
  /** Set when the request is authenticated with an API token instead of a session. */
  tokenStatements?: PolicyStatement[] | null;
}

const ORG_RESOURCE: ResourceContext = { path: 'org' };

function withinBoundaries(subject: AccessSubject, action: string, resource: ResourceContext): boolean {
  if (subject.boundary && !isAllowed(subject.boundary, action, resource)) return false;
  if (subject.parentBoundary && !isAllowed(subject.parentBoundary, action, resource)) return false;
  return true;
}

/**
 * Combines the layers:
 *  1. An API token can only narrow what its owner may do.
 *  2. Platform roles (weblion staff) apply everywhere.
 *  3. A member's role plus attached policies must allow the action, and the organization's
 *     boundary (plus its reseller's boundary, if any) must allow it as well.
 *  4. Staff of the reseller that owns the organization act with their reseller role and
 *     policies, gated by `reseller:customer:access` and capped by the same boundaries.
 */
export function can(subject: AccessSubject, action: Permission | string, resource: ResourceContext): boolean {
  if (subject.tokenStatements && !isAllowed(subject.tokenStatements, action, resource)) return false;

  if (subject.platformRole && isAllowed(PLATFORM_ROLE_POLICIES[subject.platformRole], action, resource)) {
    return true;
  }

  if (action.startsWith('platform:')) return false;

  if (subject.orgRole) {
    const memberStatements = [...ORG_ROLE_POLICIES[subject.orgRole], ...(subject.memberPolicies ?? [])];
    if (isAllowed(memberStatements, action, resource) && withinBoundaries(subject, action, resource)) {
      return true;
    }
  }

  const reseller = subject.reseller;
  if (reseller && !action.startsWith('reseller:')) {
    const resellerStatements = [...ORG_ROLE_POLICIES[reseller.role], ...reseller.memberPolicies];
    const entry = 'reseller:customer:access';
    if (
      isAllowed(resellerStatements, entry, ORG_RESOURCE) &&
      isAllowed(reseller.boundary, entry, ORG_RESOURCE) &&
      isAllowed(resellerStatements, action, resource) &&
      withinBoundaries(subject, action, resource)
    ) {
      return true;
    }
  }

  return false;
}

export function allowedActions<T extends string>(
  subject: AccessSubject,
  candidates: readonly T[],
  resource: ResourceContext,
): T[] {
  return candidates.filter((action) => can(subject, action, resource));
}
