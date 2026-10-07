import { isAllowed, type PolicyStatement, type ResourceContext } from './policy';
import { ORG_ROLE_POLICIES, PLATFORM_ROLE_POLICIES, type OrgRole, type PlatformRole } from './roles';
import type { Permission } from './permissions';

/** Everything that decides whether one request may perform one action. */
export interface AccessSubject {
  platformRole?: PlatformRole | null;
  /** Role in the organization that owns the resource, if the user is a member. */
  orgRole?: OrgRole | null;
  /** Custom policies attached to that membership. */
  memberPolicies?: PolicyStatement[];
  /** Permission boundary of the organization that owns the resource. */
  boundary?: PolicyStatement[] | null;
  /** Set when the request is authenticated with an API token instead of a session. */
  tokenStatements?: PolicyStatement[] | null;
}

/**
 * Combines the layers:
 *  1. An API token can only narrow what its owner may do.
 *  2. Platform roles (weblion staff) apply everywhere.
 *  3. Otherwise the member's role plus attached policies must allow the action,
 *     and the organization's boundary must allow it as well.
 */
export function can(subject: AccessSubject, action: Permission | string, resource: ResourceContext): boolean {
  if (subject.tokenStatements && !isAllowed(subject.tokenStatements, action, resource)) return false;

  if (subject.platformRole && isAllowed(PLATFORM_ROLE_POLICIES[subject.platformRole], action, resource)) {
    return true;
  }

  if (!subject.orgRole || action.startsWith('platform:')) return false;

  const memberStatements = [...ORG_ROLE_POLICIES[subject.orgRole], ...(subject.memberPolicies ?? [])];
  if (!isAllowed(memberStatements, action, resource)) return false;

  if (subject.boundary && !isAllowed(subject.boundary, action, resource)) return false;
  return true;
}

export function allowedActions<T extends string>(
  subject: AccessSubject,
  candidates: readonly T[],
  resource: ResourceContext,
): T[] {
  return candidates.filter((action) => can(subject, action, resource));
}
