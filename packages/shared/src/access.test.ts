import { describe, expect, it } from 'vitest';
import { can, type AccessSubject } from './access';
import { moduleDenyStatements, normalizeModules } from './modules';
import { resourcePath, validateStatements } from './policy';
import { DEFAULT_CUSTOMER_BOUNDARY, DEFAULT_RESELLER_BOUNDARY, TOKEN_SCOPE_POLICIES } from './roles';

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
    expect(moduleDenyStatements(['servers', 'dns', 'webhosting', 'storage', 'mail'])).toEqual([]);
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
