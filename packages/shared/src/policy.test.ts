import { describe, expect, it } from 'vitest';
import {
  evaluate,
  expandActionPattern,
  isValidResourcePattern,
  matchesGlob,
  resourcePath,
  validateStatements,
  type PolicyStatement,
} from './policy';
import { can } from './access';
import { DEFAULT_CUSTOMER_BOUNDARY, TOKEN_SCOPE_POLICIES } from './roles';

const server = (projectId: string, serverId: string, labels?: Record<string, string>) => ({
  path: resourcePath.server(projectId, serverId),
  labels,
});

describe('matchesGlob', () => {
  it('handles exact values and wildcards', () => {
    expect(matchesGlob('server:power', 'server:power')).toBe(true);
    expect(matchesGlob('server:*', 'server:backup:create')).toBe(true);
    expect(matchesGlob('*:read', 'server:backup:read')).toBe(true);
    expect(matchesGlob('server:*', 'project:read')).toBe(false);
    expect(matchesGlob('project/p1/*', 'project/p1/server/s1')).toBe(true);
    expect(matchesGlob('project/p1/*', 'project/p1')).toBe(false);
  });

  it('treats regex characters literally', () => {
    expect(matchesGlob('a.b', 'axb')).toBe(false);
    expect(matchesGlob('a.b', 'a.b')).toBe(true);
  });
});

describe('evaluate', () => {
  const statements: PolicyStatement[] = [
    { effect: 'allow', actions: ['server:*'], resources: ['project/p1/*'] },
    { effect: 'deny', actions: ['server:delete'] },
  ];

  it('allows matching actions on matching resources', () => {
    expect(evaluate(statements, 'server:power', server('p1', 's1'))).toBe('allow');
  });

  it('lets explicit deny win', () => {
    expect(evaluate(statements, 'server:delete', server('p1', 's1'))).toBe('deny');
  });

  it('denies implicitly outside the granted resources', () => {
    expect(evaluate(statements, 'server:power', server('p2', 's1'))).toBe('implicit-deny');
  });

  it('applies label conditions', () => {
    const labelled: PolicyStatement[] = [
      { effect: 'allow', actions: ['server:power'], conditions: { labels: { env: 'dev' } } },
    ];
    expect(evaluate(labelled, 'server:power', server('p1', 's1', { env: 'dev' }))).toBe('allow');
    expect(evaluate(labelled, 'server:power', server('p1', 's1', { env: 'prod' }))).toBe('implicit-deny');
    expect(evaluate(labelled, 'server:power', server('p1', 's1'))).toBe('implicit-deny');
  });
});

describe('can', () => {
  const resource = server('p1', 's1');

  it('gives owners everything except what the boundary denies', () => {
    const subject = { orgRole: 'owner' as const, boundary: DEFAULT_CUSTOMER_BOUNDARY };
    expect(can(subject, 'server:power', resource)).toBe(true);
    expect(can(subject, 'server:rebuild', resource)).toBe(true);
    expect(can(subject, 'server:delete', resource)).toBe(false);
    expect(can(subject, 'platform:access', { path: 'org' })).toBe(false);
  });

  it('keeps viewers read only', () => {
    const subject = { orgRole: 'viewer' as const };
    expect(can(subject, 'server:read', resource)).toBe(true);
    expect(can(subject, 'server:power', resource)).toBe(false);
  });

  it('lets restricted members act only where a policy grants it', () => {
    const subject = {
      orgRole: 'restricted' as const,
      memberPolicies: [
        {
          effect: 'allow' as const,
          actions: ['server:read', 'server:power'],
          resources: ['project/p1/server/s1'],
        },
      ],
    };
    expect(can(subject, 'server:power', resource)).toBe(true);
    expect(can(subject, 'server:power', server('p1', 's2'))).toBe(false);
  });

  it('lets attached deny policies narrow a role', () => {
    const subject = {
      orgRole: 'admin' as const,
      memberPolicies: [{ effect: 'deny' as const, actions: ['server:console'] }],
    };
    expect(can(subject, 'server:console', resource)).toBe(false);
    expect(can(subject, 'server:power', resource)).toBe(true);
  });

  it('gives superadmins everything regardless of membership', () => {
    expect(can({ platformRole: 'superadmin' }, 'server:delete', resource)).toBe(true);
    expect(can({ platformRole: 'superadmin' }, 'platform:explorer', { path: 'org' })).toBe(true);
  });

  it('lets support read but not destroy', () => {
    expect(can({ platformRole: 'support' }, 'server:read', resource)).toBe(true);
    expect(can({ platformRole: 'support' }, 'server:delete', resource)).toBe(false);
  });

  it('narrows access to the token scope', () => {
    const subject = { orgRole: 'owner' as const, tokenStatements: TOKEN_SCOPE_POLICIES.read };
    expect(can(subject, 'server:read', resource)).toBe(true);
    expect(can(subject, 'server:power', resource)).toBe(false);
  });

  it('never lets a token grant more than its owner has', () => {
    const subject = { orgRole: 'viewer' as const, tokenStatements: TOKEN_SCOPE_POLICIES.read_write };
    expect(can(subject, 'server:power', resource)).toBe(false);
  });
});

describe('validation', () => {
  it('accepts sane resource patterns', () => {
    for (const p of [
      '*',
      'org',
      'project/abc',
      'project/*',
      'project/abc/*',
      'project/*/server/*',
      'member/u1',
      'maildomain/abc',
      'maildomain/*',
    ]) {
      expect(isValidResourcePattern(p), p).toBe(true);
    }
  });

  it('rejects malformed resource patterns', () => {
    for (const p of [
      '',
      'server/abc',
      'project/abc/foo',
      'member/u1/server/x',
      'project/a b',
      'maildomain',
      'maildomain/abc/x',
    ]) {
      expect(isValidResourcePattern(p), p).toBe(false);
    }
  });

  it('accepts phone systems as resources', () => {
    expect(isValidResourcePattern('phone/0b6f3c2e-6a1d-4c8e-9f6b-2d7a1e5c4b3a')).toBe(true);
    expect(isValidResourcePattern('phone/*')).toBe(true);
    expect(isValidResourcePattern('phone')).toBe(false);
    expect(resourcePath.phoneSystem('p1')).toBe('phone/p1');
  });

  it('accepts monitors as resources', () => {
    expect(isValidResourcePattern('monitor/0b6f3c2e-6a1d-4c8e-9f6b-2d7a1e5c4b3a')).toBe(true);
    expect(isValidResourcePattern('monitor/*')).toBe(true);
    expect(isValidResourcePattern('monitor')).toBe(false);
    expect(resourcePath.monitor('m1')).toBe('monitor/m1');
  });

  it('reports unknown actions', () => {
    const issues = validateStatements([{ effect: 'allow', actions: ['server:explode'] }]);
    expect(issues).toHaveLength(1);
    expect(expandActionPattern('server:backup:*')).toContain('server:backup:restore');
  });
});
