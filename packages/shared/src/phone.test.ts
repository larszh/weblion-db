import { describe, expect, it } from 'vitest';
import { can, type AccessSubject } from './access';
import { moduleDenyStatements } from './modules';
import {
  isValidExtension,
  isValidExternalNumber,
  normalizeExternalNumber,
  phoneSystemHealth,
  type PhoneSystemInfo,
} from './phone';
import { resourcePath } from './policy';
import { DEFAULT_CUSTOMER_BOUNDARY, TOKEN_SCOPE_POLICIES } from './roles';

const NOW = new Date('2026-06-01T12:00:00Z');
const DAY = 86_400_000;

/** A healthy phone system; tests change single facts. */
const info = (patch: Partial<PhoneSystemInfo> = {}): PhoneSystemInfo => ({
  fqdn: 'pbx.example.ch',
  version: '20.0.10.1479',
  edition: 'enterprise',
  productCode: '3CXPSPROFSPLA',
  activated: true,
  licenseActive: true,
  licenseExpiresAt: new Date(NOW.getTime() + 300 * DAY).toISOString(),
  maintenanceExpiresAt: new Date(NOW.getTime() + 300 * DAY).toISOString(),
  maxSimCalls: 16,
  activeCalls: 2,
  users: 6,
  maxUsers: null,
  extensionsTotal: 8,
  extensionsRegistered: 5,
  trunksTotal: 2,
  trunksRegistered: 2,
  servicesDown: false,
  numberLength: 3,
  webClientUrl: 'https://pbx.example.ch/webclient/',
  ...patch,
});

describe('phoneSystemHealth', () => {
  it('is ok with healthy facts and unknown without facts', () => {
    expect(phoneSystemHealth(info(), true, NOW)).toEqual({ status: 'ok', reasons: [] });
    expect(phoneSystemHealth(null, true, NOW)).toEqual({ status: 'unknown', reasons: [] });
  });

  it('is an error when unreachable, even with stored facts', () => {
    expect(phoneSystemHealth(info(), false, NOW)).toEqual({ status: 'error', reasons: ['unreachable'] });
    expect(phoneSystemHealth(null, false, NOW)).toEqual({ status: 'error', reasons: ['unreachable'] });
  });

  it('is an error when the license expired', () => {
    const expired = info({ licenseExpiresAt: new Date(NOW.getTime() - DAY).toISOString() });
    expect(phoneSystemHealth(expired, true, NOW)).toEqual({ status: 'error', reasons: ['license_expired'] });
  });

  it('warns 30 days before the license expires', () => {
    const in29 = info({ licenseExpiresAt: new Date(NOW.getTime() + 29 * DAY).toISOString() });
    expect(phoneSystemHealth(in29, true, NOW)).toEqual({ status: 'warning', reasons: ['license_expiring'] });
    const in31 = info({ licenseExpiresAt: new Date(NOW.getTime() + 31 * DAY).toISOString() });
    expect(phoneSystemHealth(in31, true, NOW)).toEqual({ status: 'ok', reasons: [] });
  });

  it('warns about expired maintenance, stopped services and trunks down', () => {
    const maintenance = info({ maintenanceExpiresAt: new Date(NOW.getTime() - DAY).toISOString() });
    expect(phoneSystemHealth(maintenance, true, NOW)).toEqual({
      status: 'warning',
      reasons: ['maintenance_expired'],
    });
    expect(phoneSystemHealth(info({ servicesDown: true }), true, NOW)).toEqual({
      status: 'warning',
      reasons: ['services_down'],
    });
    expect(phoneSystemHealth(info({ trunksRegistered: 1, trunksTotal: 2 }), true, NOW)).toEqual({
      status: 'warning',
      reasons: ['trunks_down'],
    });
  });

  it('reports the user limit only when the license enforces one', () => {
    expect(phoneSystemHealth(info({ users: 10, maxUsers: 10 }), true, NOW)).toEqual({
      status: 'warning',
      reasons: ['user_limit_reached'],
    });
    expect(phoneSystemHealth(info({ users: 9, maxUsers: 10 }), true, NOW).status).toBe('ok');
    expect(phoneSystemHealth(info({ users: 500, maxUsers: null }), true, NOW).status).toBe('ok');
  });

  it('errors on an inactive or not activated license', () => {
    expect(phoneSystemHealth(info({ licenseActive: false }), true, NOW)).toEqual({
      status: 'error',
      reasons: ['license_inactive'],
    });
    expect(phoneSystemHealth(info({ activated: false }), true, NOW)).toEqual({
      status: 'error',
      reasons: ['not_activated'],
    });
  });
});

describe('isValidExtension', () => {
  it('requires exactly the number length the phone system reports', () => {
    expect(isValidExtension('101', 3)).toBe(true);
    expect(isValidExtension('1001', 3)).toBe(false);
    expect(isValidExtension('10a', 3)).toBe(false);
  });

  it('accepts 2 to 10 digits without a reported length', () => {
    expect(isValidExtension('10', null)).toBe(true);
    expect(isValidExtension('1234567890', null)).toBe(true);
    expect(isValidExtension('1', null)).toBe(false);
    expect(isValidExtension('12345678901', null)).toBe(false);
    expect(isValidExtension('', null)).toBe(false);
    expect(isValidExtension('+41', null)).toBe(false);
  });
});

describe('external numbers', () => {
  it('removes what people type between digits', () => {
    expect(normalizeExternalNumber('+41 44 123 45 67')).toBe('+41441234567');
    expect(normalizeExternalNumber('(044) 123.45-67/8')).toBe('04412345678');
    expect(normalizeExternalNumber('0041 44 123 45 67')).toBe('0041441234567');
    expect(normalizeExternalNumber('')).toBeNull();
    expect(normalizeExternalNumber('  ')).toBeNull();
    expect(normalizeExternalNumber(null)).toBeNull();
    expect(normalizeExternalNumber(undefined)).toBeNull();
  });

  it('accepts an optional plus and 3 to 20 digits', () => {
    expect(isValidExternalNumber('+41441234567')).toBe(true);
    expect(isValidExternalNumber('117')).toBe(true);
    expect(isValidExternalNumber('12')).toBe(false);
    expect(isValidExternalNumber('+')).toBe(false);
    expect(isValidExternalNumber('+41a')).toBe(false);
    expect(isValidExternalNumber('1'.repeat(21))).toBe(false);
  });
});

describe('phone permissions', () => {
  const phoneSystem = { path: resourcePath.phoneSystem('p1') };
  const boundary = (modules: Parameters<typeof moduleDenyStatements>[0]) => [
    ...DEFAULT_CUSTOMER_BOUNDARY,
    ...moduleDenyStatements(modules),
  ];

  it('builds the resource path of a phone system', () => {
    expect(resourcePath.phoneSystem('p1')).toBe('phone/p1');
  });

  it('lets viewers and members read, owners change', () => {
    for (const orgRole of ['viewer', 'member'] as const) {
      const subject: AccessSubject = { orgRole, boundary: boundary(['phone']) };
      expect(can(subject, 'phone:read', phoneSystem)).toBe(true);
      expect(can(subject, 'phone:write', phoneSystem)).toBe(false);
      expect(can(subject, 'phone:credentials', phoneSystem)).toBe(false);
    }
    const owner: AccessSubject = { orgRole: 'owner', boundary: boundary(['phone']) };
    expect(can(owner, 'phone:write', phoneSystem)).toBe(true);
    expect(can(owner, 'phone:credentials', phoneSystem)).toBe(true);
  });

  it('denies telephony while the module is off', () => {
    const owner: AccessSubject = { orgRole: 'owner', boundary: boundary(['servers']) };
    expect(can(owner, 'phone:read', phoneSystem)).toBe(false);
  });

  it('keeps user credentials away from read and write tokens', () => {
    const readWrite: AccessSubject = {
      orgRole: 'owner',
      boundary: boundary(['phone']),
      tokenStatements: TOKEN_SCOPE_POLICIES.read_write,
    };
    expect(can(readWrite, 'phone:write', phoneSystem)).toBe(true);
    expect(can(readWrite, 'phone:credentials', phoneSystem)).toBe(false);
    const read: AccessSubject = {
      orgRole: 'owner',
      boundary: boundary(['phone']),
      tokenStatements: TOKEN_SCOPE_POLICIES.read,
    };
    expect(can(read, 'phone:read', phoneSystem)).toBe(true);
    expect(can(read, 'phone:write', phoneSystem)).toBe(false);
  });
});
