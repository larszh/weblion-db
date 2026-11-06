import { describe, expect, it } from 'vitest';
import { can, type AccessSubject } from './access';
import { aiDenyStatements } from './ai';
import { MODULES, moduleDenyStatements, normalizeModules } from './modules';
import { resourcePath, validateStatements } from './policy';
import {
  DEFAULT_CUSTOMER_BOUNDARY,
  DEFAULT_RESELLER_BOUNDARY,
  ORG_ROLES,
  TOKEN_SCOPE_POLICIES,
} from './roles';

const org = { path: 'org' };
const srv = { path: resourcePath.server('p1', 's1') };
const dom = { path: resourcePath.domain('d1') };
const web = { path: resourcePath.webspace('w1') };

const customerBoundary = (modules: Parameters<typeof moduleDenyStatements>[0] = ['servers']) => [
  ...DEFAULT_CUSTOMER_BOUNDARY,
  ...moduleDenyStatements(modules),
];
const resellerBoundary = (modules: Parameters<typeof moduleDenyStatements>[0] = ['servers', 'dns']) => [
  ...DEFAULT_RESELLER_BOUNDARY,
  ...moduleDenyStatements(modules),
];

describe('modules', () => {
  it('denies actions of inactive modules only', () => {
    const subject: AccessSubject = { orgRole: 'owner', boundary: customerBoundary(['servers']) };
    expect(can(subject, 'server:power', srv)).toBe(true);
    expect(can(subject, 'project:create', org)).toBe(true);
    expect(can(subject, 'domain:read', dom)).toBe(false);
    expect(can(subject, 'webspace:read', org)).toBe(false);
    expect(can(subject, 'billing:read', org)).toBe(true);
    expect(can(subject, 'member:invite', org)).toBe(true);
  });

  it('produces valid statements and normalizes input', () => {
    expect(validateStatements(moduleDenyStatements([]))).toEqual([]);
    expect(moduleDenyStatements([...MODULES])).toEqual([]);
    expect(moduleDenyStatements(['servers'])[0]!.actions).toContain('mail:*');
    expect(normalizeModules(['dns', 'bogus', 'servers', 'dns'])).toEqual(['servers', 'dns']);
  });

  it('does not limit platform staff', () => {
    const subject: AccessSubject = { platformRole: 'superadmin', boundary: customerBoundary([]) };
    expect(can(subject, 'domain:read', dom)).toBe(true);
  });
});

describe('customers and resellers', () => {
  it('keeps reseller actions away from plain customers', () => {
    const subject: AccessSubject = { orgRole: 'owner', boundary: customerBoundary() };
    expect(can(subject, 'reseller:customer:read', org)).toBe(false);
    expect(can(subject, 'reseller:billing', org)).toBe(false);
  });

  it('lets reseller owners manage their customers', () => {
    const subject: AccessSubject = { orgRole: 'owner', boundary: resellerBoundary() };
    expect(can(subject, 'reseller:customer:write', org)).toBe(true);
    expect(can(subject, 'reseller:billing', org)).toBe(true);
    expect(can(subject, 'server:delete', srv)).toBe(false);
  });

  it('gives reseller staff their own role inside customer organizations', () => {
    const asOwner: AccessSubject = {
      boundary: customerBoundary(['servers', 'dns']),
      parentBoundary: resellerBoundary(),
      reseller: { role: 'owner', memberPolicies: [], boundary: resellerBoundary() },
    };
    expect(can(asOwner, 'server:power', srv)).toBe(true);
    expect(can(asOwner, 'member:invite', org)).toBe(true);
    expect(can(asOwner, 'domain:dns:write', dom)).toBe(true);
    // Caps still apply: customer boundary and staff-only actions.
    expect(can(asOwner, 'server:delete', srv)).toBe(false);
    // Reseller actions never apply inside a customer.
    expect(can(asOwner, 'reseller:customer:write', org)).toBe(false);
    expect(can(asOwner, 'platform:access', org)).toBe(false);

    const asViewer: AccessSubject = { ...asOwner, reseller: { ...asOwner.reseller!, role: 'viewer' } };
    expect(can(asViewer, 'server:read', srv)).toBe(true);
    expect(can(asViewer, 'server:power', srv)).toBe(false);

    const asRestricted: AccessSubject = {
      ...asOwner,
      reseller: { ...asOwner.reseller!, role: 'restricted' },
    };
    expect(can(asRestricted, 'org:read', org)).toBe(false);
  });

  it('requires reseller:customer:access to enter a customer', () => {
    const subject: AccessSubject = {
      boundary: customerBoundary(),
      parentBoundary: resellerBoundary(),
      reseller: {
        role: 'owner',
        memberPolicies: [],
        boundary: [...resellerBoundary(), { effect: 'deny', actions: ['reseller:customer:access'] }],
      },
    };
    expect(can(subject, 'server:read', srv)).toBe(false);

    const denyByPolicy: AccessSubject = {
      ...subject,
      reseller: {
        role: 'admin',
        memberPolicies: [{ effect: 'deny', actions: ['reseller:customer:access'] }],
        boundary: resellerBoundary(),
      },
    };
    expect(can(denyByPolicy, 'server:read', srv)).toBe(false);
  });

  it('caps customers with the reseller boundary and modules', () => {
    // The customer has dns enabled, but the reseller lost it: the customer loses it too.
    const member: AccessSubject = {
      orgRole: 'owner',
      boundary: customerBoundary(['servers', 'dns']),
      parentBoundary: resellerBoundary(['servers']),
    };
    expect(can(member, 'domain:read', dom)).toBe(false);
    expect(can(member, 'server:read', srv)).toBe(true);
  });

  it('applies token narrowing on the reseller path', () => {
    const subject: AccessSubject = {
      tokenStatements: TOKEN_SCOPE_POLICIES.read,
      boundary: customerBoundary(),
      parentBoundary: resellerBoundary(),
      reseller: { role: 'owner', memberPolicies: [], boundary: resellerBoundary() },
    };
    expect(can(subject, 'server:read', srv)).toBe(true);
    expect(can(subject, 'server:power', srv)).toBe(false);
  });
});

describe('websites', () => {
  it('lets read-write tokens create and delete websites, never see credentials', () => {
    const token: AccessSubject = {
      orgRole: 'owner',
      boundary: customerBoundary(['webhosting']),
      tokenStatements: TOKEN_SCOPE_POLICIES.read_write,
    };
    expect(can(token, 'webspace:write', org)).toBe(true);
    expect(can(token, 'webspace:write', web)).toBe(true);
    expect(can(token, 'webspace:delete', web)).toBe(true);
    expect(can(token, 'webspace:credentials', web)).toBe(false);
    const read: AccessSubject = { ...token, tokenStatements: TOKEN_SCOPE_POLICIES.read };
    expect(can(read, 'webspace:read', web)).toBe(true);
    expect(can(read, 'webspace:write', web)).toBe(false);
  });

  it('lets viewers read websites only', () => {
    const viewer: AccessSubject = { orgRole: 'viewer', boundary: customerBoundary(['webhosting']) };
    expect(can(viewer, 'webspace:read', web)).toBe(true);
    expect(can(viewer, 'webspace:write', org)).toBe(false);
    expect(can(viewer, 'webspace:delete', web)).toBe(false);
    expect(can(viewer, 'webspace:credentials', web)).toBe(false);
  });

  it('denies website changes while the module is off', () => {
    const owner: AccessSubject = { orgRole: 'owner', boundary: customerBoundary(['servers']) };
    expect(can(owner, 'webspace:delete', web)).toBe(false);
    expect(can(owner, 'webspace:write', org)).toBe(false);
    const on: AccessSubject = { orgRole: 'owner', boundary: customerBoundary(['webhosting']) };
    expect(can(on, 'webspace:delete', web)).toBe(true);
  });

  it('keeps the platform permission away from organizations', () => {
    const owner: AccessSubject = { orgRole: 'owner', boundary: customerBoundary(['webhosting']) };
    expect(can(owner, 'platform:website:write', org)).toBe(false);
  });
});

describe('streaming', () => {
  it('lets read-write tokens manage accounts, never set passwords', () => {
    const token: AccessSubject = {
      orgRole: 'owner',
      boundary: customerBoundary(['media']),
      tokenStatements: TOKEN_SCOPE_POLICIES.read_write,
    };
    expect(can(token, 'media:write', org)).toBe(true);
    expect(can(token, 'media:password', org)).toBe(false);
    const read: AccessSubject = { ...token, tokenStatements: TOKEN_SCOPE_POLICIES.read };
    expect(can(read, 'media:read', org)).toBe(true);
    expect(can(read, 'media:write', org)).toBe(false);
  });

  it('lets members read only and owners do everything', () => {
    const member: AccessSubject = { orgRole: 'member', boundary: customerBoundary(['media']) };
    expect(can(member, 'media:read', org)).toBe(true);
    expect(can(member, 'media:write', org)).toBe(false);
    expect(can(member, 'media:password', org)).toBe(false);
    const owner: AccessSubject = { orgRole: 'owner', boundary: customerBoundary(['media']) };
    expect(can(owner, 'media:write', org)).toBe(true);
    expect(can(owner, 'media:password', org)).toBe(true);
    expect(can(owner, 'platform:media:write', org)).toBe(false);
  });

  it('denies everything of media while the module is off', () => {
    const owner: AccessSubject = { orgRole: 'owner', boundary: customerBoundary(['servers']) };
    expect(can(owner, 'media:read', org)).toBe(false);
    expect(can(owner, 'media:write', org)).toBe(false);
    expect(can(owner, 'media:password', org)).toBe(false);
  });
});

describe('ai', () => {
  const on = { aiEnabled: true, aiOptOutAt: null };
  const off = { aiEnabled: false, aiOptOutAt: null };
  const declined = { aiEnabled: true, aiOptOutAt: '2026-11-01T00:00:00.000Z' };
  const withAi = (
    ai: Parameters<typeof aiDenyStatements>[0],
    modules?: Parameters<typeof moduleDenyStatements>[0],
  ) => [...customerBoundary(modules), ...aiDenyStatements(ai)];
  const resellerWithAi = (ai: Parameters<typeof aiDenyStatements>[0]) => [
    ...resellerBoundary(),
    ...aiDenyStatements(ai),
  ];
  // Mirrors effectiveBoundary of a suspended organization (apps/api/src/auth/access.ts): the boundary's deny
  // statements, an allow list of SUSPENDED_ALLOWED (with 'ai:settings', ai 3.3, F14), then modules and AI.
  const suspended = (ai: Parameters<typeof aiDenyStatements>[0]) => [
    ...DEFAULT_CUSTOMER_BOUNDARY.filter((s) => s.effect === 'deny'),
    {
      effect: 'allow' as const,
      actions: [
        '*:read',
        'server:metrics',
        'server:task:read',
        'billing:*',
        'reseller:customer:access',
        'ai:settings',
      ],
    },
    ...moduleDenyStatements(['servers']),
    ...aiDenyStatements(ai),
  ];

  it('lets owners, admins, members and viewers use AI while the organization is switched on', () => {
    for (const orgRole of ['owner', 'admin', 'member', 'viewer'] as const) {
      expect(can({ orgRole, boundary: withAi(on) }, 'ai:use', org), orgRole).toBe(true);
    }
    for (const orgRole of ['restricted', 'billing'] as const) {
      expect(can({ orgRole, boundary: withAi(on) }, 'ai:use', org), orgRole).toBe(false);
    }
    expect(can({ orgRole: 'owner', boundary: withAi(on) }, 'ai:settings', org)).toBe(true);
    expect(can({ orgRole: 'admin', boundary: withAi(on) }, 'ai:settings', org)).toBe(true);
    expect(can({ orgRole: 'member', boundary: withAi(on) }, 'ai:settings', org)).toBe(false);
    expect(can({ orgRole: 'viewer', boundary: withAi(on) }, 'ai:settings', org)).toBe(false);
  });

  it('denies ai:use while switched off (the default, plan O34) or declined, never ai:settings', () => {
    for (const state of [off, declined]) {
      for (const orgRole of ORG_ROLES) {
        expect(can({ orgRole, boundary: withAi(state) }, 'ai:use', org)).toBe(false);
      }
      expect(can({ orgRole: 'owner', boundary: withAi(state) }, 'ai:settings', org)).toBe(true);
      expect(can({ orgRole: 'admin', boundary: withAi(state) }, 'ai:settings', org)).toBe(true);
    }
  });

  it('cascades a reseller that is off or declined to its customers, members and reseller staff', () => {
    for (const parentState of [off, declined]) {
      const member: AccessSubject = {
        orgRole: 'owner',
        boundary: withAi(on),
        parentBoundary: resellerWithAi(parentState),
      };
      expect(can(member, 'ai:use', org)).toBe(false);
      expect(can(member, 'ai:settings', org)).toBe(true);
      const staff: AccessSubject = {
        boundary: withAi(on),
        parentBoundary: resellerWithAi(parentState),
        reseller: { role: 'owner', memberPolicies: [], boundary: resellerWithAi(parentState) },
      };
      expect(can(staff, 'ai:use', org)).toBe(false);
    }
    const allOn: AccessSubject = {
      boundary: withAi(on),
      parentBoundary: resellerWithAi(on),
      reseller: { role: 'member', memberPolicies: [], boundary: resellerWithAi(on) },
    };
    expect(can(allOn, 'ai:use', org)).toBe(true);
    // The customer's own switch still applies below a reseller that is on.
    expect(can({ ...allOn, boundary: withAi(off) }, 'ai:use', org)).toBe(false);
  });

  it('keeps ai:settings and drops ai:use in a suspended organization', () => {
    const owner: AccessSubject = { orgRole: 'owner', boundary: suspended(on) };
    expect(can(owner, 'ai:use', org)).toBe(false);
    expect(can(owner, 'ai:settings', org)).toBe(true);
    expect(can({ orgRole: 'owner', boundary: suspended(declined) }, 'ai:settings', org)).toBe(true);
  });

  it('gives support AI use and reading translations, not editing them', () => {
    const support: AccessSubject = { platformRole: 'support', boundary: withAi(off) };
    expect(can(support, 'ai:use', org)).toBe(true);
    expect(can(support, 'platform:ai:use', org)).toBe(true);
    expect(can(support, 'platform:i18n:read', org)).toBe(true);
    expect(can(support, 'platform:i18n:write', org)).toBe(false);
    expect(can(support, 'ai:settings', org)).toBe(false);
    const superadmin: AccessSubject = { platformRole: 'superadmin' };
    for (const action of [
      'ai:use',
      'ai:settings',
      'platform:ai:use',
      'platform:i18n:read',
      'platform:i18n:write',
    ]) {
      expect(can(superadmin, action, org), action).toBe(true);
    }
  });

  it('never grants the platform AI and translation actions through an organization role', () => {
    for (const orgRole of ORG_ROLES) {
      const subject: AccessSubject = { orgRole, boundary: [{ effect: 'allow', actions: ['*'] }] };
      expect(can(subject, 'platform:ai:use', org)).toBe(false);
      expect(can(subject, 'platform:i18n:read', org)).toBe(false);
      expect(can(subject, 'platform:i18n:write', org)).toBe(false);
    }
  });

  it('keeps AI out of read tokens and lets read-write tokens through the engine', () => {
    const read: AccessSubject = {
      orgRole: 'owner',
      boundary: withAi(on),
      tokenStatements: TOKEN_SCOPE_POLICIES.read,
    };
    expect(can(read, 'ai:use', org)).toBe(false);
    // read_write passes the engine; every AI route still calls requireSession (plan 4.1).
    const write: AccessSubject = { ...read, tokenStatements: TOKEN_SCOPE_POLICIES.read_write };
    expect(can(write, 'ai:use', org)).toBe(true);
  });

  it('accepts ai:* patterns in policies', () => {
    expect(validateStatements([{ effect: 'allow', actions: ['ai:*'] }])).toEqual([]);
    expect(validateStatements([{ effect: 'deny', actions: ['ai:use', 'platform:i18n:*'] }])).toEqual([]);
  });
});
