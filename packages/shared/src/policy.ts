import { ALL_PERMISSIONS, type Permission } from './permissions';

/**
 * IAM-style access policies.
 *
 * A statement allows or denies a set of actions on a set of resources.
 * Resources are paths relative to the organization that owns the policy:
 *
 *   org                                   the organization itself
 *   member/<userId>                       a member
 *   token/<tokenId>                       an API token
 *   project/<projectId>                   a project
 *   project/<projectId>/server/<serverId> a server inside a project
 *
 * Both actions and resources accept `*` as a wildcard for any sequence of characters
 * (including `/` and `:`). Evaluation follows the usual rules: an explicit deny wins,
 * otherwise at least one allow must match, otherwise the request is denied.
 */

export type Effect = 'allow' | 'deny';

export interface PolicyConditions {
  /** Every listed label must be present on the server with exactly this value. */
  labels?: Record<string, string>;
}

export interface PolicyStatement {
  sid?: string;
  effect: Effect;
  actions: string[];
  /** Defaults to every resource in the organization. */
  resources?: string[];
  conditions?: PolicyConditions;
}

export interface ResourceContext {
  /** Path relative to the organization, see above. */
  path: string;
  /** Labels of the resource, used by label conditions. Only servers carry labels today. */
  labels?: Record<string, string>;
}

export type Decision = 'allow' | 'deny' | 'implicit-deny';

const globCache = new Map<string, RegExp>();

export function globToRegExp(pattern: string): RegExp {
  let re = globCache.get(pattern);
  if (!re) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    re = new RegExp(`^${escaped}$`);
    if (globCache.size > 5000) globCache.clear();
    globCache.set(pattern, re);
  }
  return re;
}

export function matchesGlob(pattern: string, value: string): boolean {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return pattern === value;
  return globToRegExp(pattern).test(value);
}

function conditionsMatch(conditions: PolicyConditions | undefined, resource: ResourceContext): boolean {
  if (!conditions) return true;
  if (conditions.labels) {
    const labels = resource.labels;
    if (!labels) return false;
    for (const [key, expected] of Object.entries(conditions.labels)) {
      if (labels[key] !== expected) return false;
    }
  }
  return true;
}

export function statementMatches(
  statement: PolicyStatement,
  action: string,
  resource: ResourceContext,
): boolean {
  if (!statement.actions.some((p) => matchesGlob(p, action))) return false;
  const resources = statement.resources && statement.resources.length > 0 ? statement.resources : ['*'];
  if (!resources.some((p) => matchesGlob(p, resource.path))) return false;
  return conditionsMatch(statement.conditions, resource);
}

export function evaluate(
  statements: readonly PolicyStatement[],
  action: string,
  resource: ResourceContext,
): Decision {
  let allowed = false;
  for (const statement of statements) {
    if (!statementMatches(statement, action, resource)) continue;
    if (statement.effect === 'deny') return 'deny';
    allowed = true;
  }
  return allowed ? 'allow' : 'implicit-deny';
}

export function isAllowed(
  statements: readonly PolicyStatement[],
  action: string,
  resource: ResourceContext,
): boolean {
  return evaluate(statements, action, resource) === 'allow';
}

/** Expands an action glob to the concrete permissions it covers. */
export function expandActionPattern(pattern: string): Permission[] {
  return ALL_PERMISSIONS.filter((p) => matchesGlob(pattern, p));
}

export interface PolicyValidationIssue {
  statement: number;
  message: string;
}

const ID_SEGMENT = /^(\*|[A-Za-z0-9_-]+\*?)$/;

export function isValidResourcePattern(pattern: string): boolean {
  if (pattern === '*' || pattern === 'org') return true;
  const segments = pattern.split('/');
  const [kind, id, third, fourth] = segments;
  if (!kind || !['member', 'token', 'project'].includes(kind)) return false;
  if (segments.length < 2 || segments.length > 4 || !id || !ID_SEGMENT.test(id)) return false;
  if (segments.length === 3) return kind === 'project' && third === '*';
  if (segments.length === 4)
    return kind === 'project' && third === 'server' && !!fourth && ID_SEGMENT.test(fourth);
  return true;
}

/** Structural checks on top of the schema validation done at the API boundary. */
export function validateStatements(statements: PolicyStatement[]): PolicyValidationIssue[] {
  const issues: PolicyValidationIssue[] = [];
  statements.forEach((s, i) => {
    if (s.effect !== 'allow' && s.effect !== 'deny') {
      issues.push({ statement: i, message: `effect must be "allow" or "deny"` });
    }
    if (!Array.isArray(s.actions) || s.actions.length === 0) {
      issues.push({ statement: i, message: 'at least one action is required' });
    } else {
      for (const action of s.actions) {
        if (expandActionPattern(action).length === 0) {
          issues.push({ statement: i, message: `action "${action}" matches no known permission` });
        }
      }
    }
    for (const resource of s.resources ?? []) {
      if (!isValidResourcePattern(resource)) {
        issues.push({ statement: i, message: `resource "${resource}" is not a valid resource path` });
      }
    }
    if (s.conditions?.labels) {
      for (const [k, v] of Object.entries(s.conditions.labels)) {
        if (typeof v !== 'string' || !k) {
          issues.push({ statement: i, message: `label condition "${k}" must map to a string` });
        }
      }
    }
  });
  return issues;
}

/** Resource path helpers so callers never build these strings by hand. */
export const resourcePath = {
  org: () => 'org',
  member: (userId: string) => `member/${userId}`,
  token: (tokenId: string) => `token/${tokenId}`,
  project: (projectId: string) => `project/${projectId}`,
  server: (projectId: string, serverId: string) => `project/${projectId}/server/${serverId}`,
};
