import { describe, expect, it } from 'vitest';
import { can, type AccessSubject } from './access';
import { moduleDenyStatements } from './modules';
import {
  isMonitorHost,
  isMonitorKind,
  monitorTargetHost,
  monitorTargetIssues,
  monitorTargetLabel,
} from './monitoring';
import { resourcePath } from './policy';
import { DEFAULT_CUSTOMER_BOUNDARY, TOKEN_SCOPE_POLICIES } from './roles';

const paths = (issues: { path: string }[]) => issues.map((i) => i.path);

describe('monitorTargetIssues', () => {
  it('accepts http and https addresses', () => {
    expect(monitorTargetIssues({ kind: 'http', url: 'https://www.muster.ch/health' })).toEqual([]);
    expect(monitorTargetIssues({ kind: 'http', url: 'http://muster.ch' })).toEqual([]);
  });

  it('refuses other schemes, garbage and credentials in the address', () => {
    expect(paths(monitorTargetIssues({ kind: 'http', url: 'ftp://muster.ch' }))).toEqual(['url']);
    expect(paths(monitorTargetIssues({ kind: 'http', url: 'muster.ch' }))).toEqual(['url']);
    expect(paths(monitorTargetIssues({ kind: 'http', url: '' }))).toEqual(['url']);
    expect(paths(monitorTargetIssues({ kind: 'http', url: 'https://user:pw@x.ch' }))).toEqual(['url']);
  });

  it('needs a keyword for keyword monitors', () => {
    expect(paths(monitorTargetIssues({ kind: 'keyword', url: 'https://x.ch', keyword: ' ' }))).toEqual([
      'keyword',
    ]);
    expect(monitorTargetIssues({ kind: 'keyword', url: 'https://x.ch', keyword: 'Warenkorb' })).toEqual([]);
  });

  it('needs a plain host for ping and port monitors', () => {
    expect(paths(monitorTargetIssues({ kind: 'ping', hostname: 'https://x.ch' }))).toEqual(['hostname']);
    expect(monitorTargetIssues({ kind: 'ping', hostname: 'x.ch' })).toEqual([]);
    expect(monitorTargetIssues({ kind: 'ping', hostname: '2001:db8::1' })).toEqual([]);
  });

  it('needs a port between 1 and 65535 for port monitors', () => {
    expect(paths(monitorTargetIssues({ kind: 'port', hostname: 'x.ch', port: 0 }))).toEqual(['port']);
    expect(paths(monitorTargetIssues({ kind: 'port', hostname: 'x.ch', port: 70000 }))).toEqual(['port']);
    expect(paths(monitorTargetIssues({ kind: 'port', hostname: 'x.ch' }))).toEqual(['port']);
    expect(monitorTargetIssues({ kind: 'port', hostname: 'x.ch', port: 443 })).toEqual([]);
  });
});

describe('isMonitorHost', () => {
  it('takes host names with a dot, IPv4 and IPv6', () => {
    expect(isMonitorHost('example.ch')).toBe(true);
    // Address ranges are the API's job.
    expect(isMonitorHost('10.0.0.1')).toBe(true);
    expect(isMonitorHost('2001:db8::1')).toBe(true);
  });

  it('refuses single labels, spaces and empty values', () => {
    expect(isMonitorHost('localhost')).toBe(false);
    expect(isMonitorHost('exa mple.ch')).toBe(false);
    expect(isMonitorHost('')).toBe(false);
  });
});

describe('monitor targets', () => {
  it('labels port targets with brackets around IPv6', () => {
    expect(monitorTargetLabel({ kind: 'port', hostname: '2001:db8::1', port: 443 })).toBe(
      '[2001:db8::1]:443',
    );
    expect(monitorTargetLabel({ kind: 'port', hostname: 'mail.x.ch', port: 25 })).toBe('mail.x.ch:25');
    expect(monitorTargetLabel({ kind: 'ping', hostname: ' x.ch ' })).toBe('x.ch');
  });

  it('takes the lower-case host of a target', () => {
    expect(monitorTargetHost({ kind: 'http', url: 'https://WWW.Muster.ch/a' })).toBe('www.muster.ch');
    expect(monitorTargetHost({ kind: 'http', url: 'https://[2001:db8::1]:8443/' })).toBe('2001:db8::1');
    expect(monitorTargetHost({ kind: 'port', hostname: 'Mail.Muster.ch', port: 25 })).toBe('mail.muster.ch');
    expect(monitorTargetHost({ kind: 'http', url: 'not a url' })).toBeNull();
  });

  it('knows the kinds customers create', () => {
    expect(isMonitorKind('keyword')).toBe(true);
    expect(isMonitorKind('dns')).toBe(false);
  });
});

describe('monitor permissions', () => {
  const monitor = { path: resourcePath.monitor('m1') };
  const boundary = (modules: Parameters<typeof moduleDenyStatements>[0]) => [
    ...DEFAULT_CUSTOMER_BOUNDARY,
    ...moduleDenyStatements(modules),
  ];

  it('lets viewers read, members change but not delete, owners delete', () => {
    const viewer: AccessSubject = { orgRole: 'viewer', boundary: boundary(['monitoring']) };
    expect(can(viewer, 'monitor:read', monitor)).toBe(true);
    expect(can(viewer, 'monitor:write', monitor)).toBe(false);
    const member: AccessSubject = { orgRole: 'member', boundary: boundary(['monitoring']) };
    expect(can(member, 'monitor:write', monitor)).toBe(true);
    expect(can(member, 'monitor:delete', monitor)).toBe(false);
    const owner: AccessSubject = { orgRole: 'owner', boundary: boundary(['monitoring']) };
    expect(can(owner, 'monitor:delete', monitor)).toBe(true);
  });

  it('denies monitoring while the module is off', () => {
    const owner: AccessSubject = { orgRole: 'owner', boundary: boundary(['servers']) };
    expect(can(owner, 'monitor:read', monitor)).toBe(false);
  });

  it('gives read tokens read access and read and write tokens everything', () => {
    const read: AccessSubject = {
      orgRole: 'owner',
      boundary: boundary(['monitoring']),
      tokenStatements: TOKEN_SCOPE_POLICIES.read,
    };
    expect(can(read, 'monitor:read', monitor)).toBe(true);
    expect(can(read, 'monitor:write', monitor)).toBe(false);
    const readWrite: AccessSubject = {
      orgRole: 'owner',
      boundary: boundary(['monitoring']),
      tokenStatements: TOKEN_SCOPE_POLICIES.read_write,
    };
    expect(can(readWrite, 'monitor:delete', monitor)).toBe(true);
  });
});
