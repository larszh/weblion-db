import { describe, expect, it } from 'vitest';
import { can, type AccessSubject } from './access';
import { isMailLocalPart, mailDomainAscii, mailPasswordIssues, type MailPasswordPolicy } from './mail';
import { moduleDenyStatements } from './modules';
import { resourcePath } from './policy';
import { DEFAULT_CUSTOMER_BOUNDARY, TOKEN_SCOPE_POLICIES } from './roles';

const mailDomain = { path: resourcePath.mailDomain('m1') };
const boundary = (modules: Parameters<typeof moduleDenyStatements>[0]) => [
  ...DEFAULT_CUSTOMER_BOUNDARY,
  ...moduleDenyStatements(modules),
];

describe('mail permissions', () => {
  it('builds the resource path of a mail domain', () => {
    expect(resourcePath.mailDomain('m1')).toBe('maildomain/m1');
  });

  it('lets viewers read and owners change mail', () => {
    const viewer: AccessSubject = { orgRole: 'viewer', boundary: boundary(['mail']) };
    expect(can(viewer, 'mail:read', mailDomain)).toBe(true);
    expect(can(viewer, 'mail:write', mailDomain)).toBe(false);
    const owner: AccessSubject = { orgRole: 'owner', boundary: boundary(['mail']) };
    expect(can(owner, 'mail:write', mailDomain)).toBe(true);
    expect(can(owner, 'mail:password', mailDomain)).toBe(true);
  });

  it('denies mail while the module is off', () => {
    const owner: AccessSubject = { orgRole: 'owner', boundary: boundary(['servers']) };
    expect(can(owner, 'mail:read', mailDomain)).toBe(false);
  });

  it('keeps mailbox passwords away from read and write tokens', () => {
    const readWrite: AccessSubject = {
      orgRole: 'owner',
      boundary: boundary(['mail']),
      tokenStatements: TOKEN_SCOPE_POLICIES.read_write,
    };
    expect(can(readWrite, 'mail:write', mailDomain)).toBe(true);
    expect(can(readWrite, 'mail:password', mailDomain)).toBe(false);
    const read: AccessSubject = { ...readWrite, tokenStatements: TOKEN_SCOPE_POLICIES.read };
    expect(can(read, 'mail:read', mailDomain)).toBe(true);
    expect(can(read, 'mail:write', mailDomain)).toBe(false);
  });
});

describe('mailDomainAscii', () => {
  it('converts unicode names to punycode', () => {
    expect(mailDomainAscii('Müller.CH')).toBe('xn--mller-kva.ch');
    expect(mailDomainAscii(' kunde.ch. ')).toBe('kunde.ch');
  });

  it('rejects addresses, IPs, single labels and bad labels', () => {
    for (const value of ['a@b.ch', '1.2.3.4', 'localhost', '-a.ch', 'a..ch', '', 'kunde.ch/x']) {
      expect(mailDomainAscii(value), value).toBeNull();
    }
  });
});

describe('isMailLocalPart', () => {
  it('accepts plain local parts', () => {
    for (const value of ['anna', 'anna.muster', 'a_b-c', 'x1'])
      expect(isMailLocalPart(value), value).toBe(true);
  });

  it('rejects dots at the ends, double dots, capitals, plus and long values', () => {
    for (const value of ['.anna', 'anna.', 'anna..m', 'Anna', 'a+b', 'a'.repeat(65), '']) {
      expect(isMailLocalPart(value), value).toBe(false);
    }
  });
});

describe('mailPasswordIssues', () => {
  const policy: MailPasswordPolicy = {
    minLength: 12,
    letters: true,
    mixedCase: true,
    digits: true,
    specialChars: true,
  };

  it('accepts a password that meets every rule', () => {
    expect(mailPasswordIssues('Sommer-2026-Kunde', policy)).toEqual([]);
  });

  it('reports each rule', () => {
    expect(mailPasswordIssues('Ab-1', policy)).toContain('length');
    expect(mailPasswordIssues(`Ab-1${'x'.repeat(130)}`, policy)).toContain('tooLong');
    expect(mailPasswordIssues('Sommer 2026-Kunde', policy)).toContain('characters');
    expect(mailPasswordIssues('123456789012-', policy)).toContain('letters');
    expect(mailPasswordIssues('sommer-2026-kunde', policy)).toContain('mixedCase');
    expect(mailPasswordIssues('Sommer-Kunde-Abc', policy)).toContain('digits');
    expect(mailPasswordIssues('Sommer2026Kunde', policy)).toContain('specialChars');
  });

  it('falls back to the panel rules without a policy', () => {
    expect(mailPasswordIssues('Sommer2026', null)).toEqual([]);
    expect(mailPasswordIssues('sommer2026', null)).toEqual(['mixedCase']);
    expect(mailPasswordIssues('Sommer26', null)).toEqual(['length']);
  });
});
