import type { PolicyStatement } from './policy';

/**
 * Built-in roles.
 *
 * Organization roles apply to members of one customer organization. Platform roles
 * are for weblion staff and apply across every organization plus the admin area.
 * Custom access policies can be attached to members on top of their role, and every
 * organization has a permission boundary that caps what its members can ever do
 * (see DEFAULT_CUSTOMER_BOUNDARY).
 */

export const ORG_ROLES = ['owner', 'admin', 'member', 'restricted', 'viewer', 'billing'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const PLATFORM_ROLES = ['superadmin', 'support'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

const READ_ACTIONS = [
  'org:read',
  'member:read',
  'project:read',
  'server:read',
  'server:metrics',
  'server:task:read',
  'server:backup:read',
  'server:snapshot:read',
  'server:network:read',
  'server:firewall:read',
  'domain:read',
  'webspace:read',
  'cloud:read',
  'reseller:customer:read',
];

export const ORG_ROLE_POLICIES: Record<OrgRole, PolicyStatement[]> = {
  owner: [{ sid: 'OwnerFullAccess', effect: 'allow', actions: ['*'] }],
  admin: [
    { sid: 'AdminFullAccess', effect: 'allow', actions: ['*'] },
    { sid: 'AdminNoOrgDelete', effect: 'deny', actions: ['org:delete', 'billing:write'] },
  ],
  member: [
    {
      sid: 'MemberOperate',
      effect: 'allow',
      actions: [
        ...READ_ACTIONS,
        'policy:read',
        'apitoken:read',
        'apitoken:write',
        'server:power',
        'server:console',
        'server:rename',
        'server:labels',
        'server:iso',
        'server:backup:create',
        'server:snapshot:create',
        'server:network:update',
        'domain:dns:write',
        'reseller:customer:access',
      ],
    },
  ],
  restricted: [
    {
      sid: 'RestrictedBaseline',
      effect: 'allow',
      actions: ['org:read', 'apitoken:read', 'apitoken:write'],
    },
  ],
  viewer: [{ sid: 'ReadOnly', effect: 'allow', actions: [...READ_ACTIONS, 'reseller:customer:access'] }],
  billing: [{ sid: 'Billing', effect: 'allow', actions: ['org:read', 'billing:*'] }],
};

export const PLATFORM_ROLE_POLICIES: Record<PlatformRole, PolicyStatement[]> = {
  superadmin: [{ sid: 'SuperAdmin', effect: 'allow', actions: ['*'] }],
  support: [
    {
      sid: 'SupportRead',
      effect: 'allow',
      actions: [
        ...READ_ACTIONS,
        'audit:read',
        'policy:read',
        'server:config:read',
        'platform:access',
        'platform:org:read',
        'platform:user:read',
        'platform:provider:read',
        'platform:infra:read',
        'platform:audit:read',
        'platform:billing:read',
        'billing:read',
      ],
    },
    {
      sid: 'SupportOperate',
      effect: 'allow',
      actions: ['server:power', 'server:console', 'server:backup:create', 'server:snapshot:create'],
    },
  ],
};

/**
 * Default boundary for customer organizations. Destructive and cost relevant actions
 * stay with weblion staff until an admin explicitly widens the boundary for a customer.
 */
export const DEFAULT_CUSTOMER_BOUNDARY: PolicyStatement[] = [
  { sid: 'Everything', effect: 'allow', actions: ['*'] },
  {
    sid: 'StaffOnly',
    effect: 'deny',
    actions: ['server:delete', 'server:rescale', 'server:config:read', 'platform:*', 'reseller:*'],
  },
];

/**
 * Default boundary for reseller organizations: like a customer, plus managing their own
 * customers. A reseller's boundary also caps every customer below it.
 */
export const DEFAULT_RESELLER_BOUNDARY: PolicyStatement[] = [
  { sid: 'Everything', effect: 'allow', actions: ['*'] },
  {
    sid: 'StaffOnly',
    effect: 'deny',
    actions: ['server:delete', 'server:rescale', 'server:config:read', 'platform:*'],
  },
];

/** Internal organizations (weblion itself) have no extra cap besides platform actions. */
export const DEFAULT_INTERNAL_BOUNDARY: PolicyStatement[] = [
  { sid: 'Everything', effect: 'allow', actions: ['*'] },
  { sid: 'NoPlatform', effect: 'deny', actions: ['platform:*', 'reseller:*'] },
];

export function defaultBoundary(kind: 'internal' | 'customer' | 'reseller'): PolicyStatement[] {
  if (kind === 'internal') return DEFAULT_INTERNAL_BOUNDARY;
  if (kind === 'reseller') return DEFAULT_RESELLER_BOUNDARY;
  return DEFAULT_CUSTOMER_BOUNDARY;
}

/** Roles listed in ascending order of power, used to keep admins from promoting past themselves. */
export const ORG_ROLE_RANK: Record<OrgRole, number> = {
  restricted: 0,
  viewer: 1,
  billing: 1,
  member: 2,
  admin: 3,
  owner: 4,
};

export function isOrgRole(value: string): value is OrgRole {
  return (ORG_ROLES as readonly string[]).includes(value);
}

export function isPlatformRole(value: string): value is PlatformRole {
  return (PLATFORM_ROLES as readonly string[]).includes(value);
}

/** API token scopes, modelled after the Hetzner Cloud read / read & write tokens. */
export const TOKEN_SCOPES = ['read', 'read_write', 'custom'] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

export const TOKEN_SCOPE_POLICIES: Record<Exclude<TokenScope, 'custom'>, PolicyStatement[]> = {
  read: [{ sid: 'TokenRead', effect: 'allow', actions: [...READ_ACTIONS, 'audit:read', 'policy:read'] }],
  read_write: [
    { sid: 'TokenReadWrite', effect: 'allow', actions: ['*'] },
    // Tokens never manage identities. That stays an interactive, audited action.
    {
      sid: 'TokenNoIdentity',
      effect: 'deny',
      actions: [
        'member:*',
        'policy:write',
        'apitoken:write',
        'org:delete',
        'webspace:credentials',
        'domain:authcode',
        'cloud:password',
      ],
    },
  ],
};
