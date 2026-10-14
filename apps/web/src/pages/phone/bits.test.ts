import { describe, expect, it } from 'vitest';
import {
  PHONE_LICENSE_WARN_DAYS,
  PHONE_STATUS_REASONS,
  phoneSystemHealth,
  type PhoneStatusReason,
  type PhoneSystemInfo,
  type PhoneUserDto,
} from '@weblion/shared';
import { ApiError } from '@/lib/api';
import type { TFunction } from '@/lib/i18n';
import { isPhoneProvider } from '@/lib/api/phone';
import {
  canChangePhoneEmail,
  canDeletePhoneUser,
  emptyPhoneUserForm,
  languageLabel,
  licenseState,
  matchesPhoneUser,
  memberLabel,
  numberRuleText,
  ofMax,
  percentOf,
  phoneErrorField,
  phoneErrorText,
  phoneServerFieldText,
  phoneUserCreateBody,
  phoneUserFormFrom,
  phoneUserFormIssues,
  phoneUserName,
  phoneUserPatchBody,
  reasonTone,
  ringGroupCandidates,
  ringGroupLabel,
  type PhoneUserForm,
} from './bits';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-14T12:00:00Z');
const inDays = (days: number) => new Date(NOW + days * DAY).toISOString();

/** Returns the key with its parameters, so the tests see which text was chosen. */
const t = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key} ${JSON.stringify(params)}` : key) as TFunction;

const user = (over: Partial<PhoneUserDto> = {}): PhoneUserDto => ({
  id: '1',
  number: '101',
  firstName: 'Ben',
  lastName: 'Beispiel',
  displayName: null,
  email: 'ben@muster.example',
  mobile: '+41791234567',
  outboundCallerId: null,
  language: 'de',
  enabled: true,
  registered: true,
  role: 'users',
  admin: false,
  system: false,
  protected: false,
  ...over,
});

const info = (over: Partial<PhoneSystemInfo> = {}): PhoneSystemInfo => ({
  fqdn: 'pbx.example',
  version: '20.0.10.1479',
  edition: 'enterprise',
  productCode: null,
  activated: true,
  licenseActive: true,
  licenseExpiresAt: inDays(300),
  maintenanceExpiresAt: inDays(300),
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
  webClientUrl: 'https://pbx.example/webclient/',
  ...over,
});

const form = (over: Partial<PhoneUserForm> = {}): PhoneUserForm => ({
  ...emptyPhoneUserForm(),
  firstName: 'Anna',
  email: 'anna@muster.example',
  ...over,
});

describe('figures', () => {
  it('shows "n / max", n without maximum, a dash when unknown', () => {
    expect(ofMax(3, 16, 'de')).toBe('3 / 16');
    // The Swiss group separator depends on the ICU build (’ or ').
    const group = new Intl.NumberFormat('de-CH').format(1000).charAt(1);
    expect(ofMax(1200, null, 'de')).toBe(`1${group}200`);
    expect(ofMax(null, 16, 'en')).toBe('–');
    expect(ofMax(undefined, undefined, 'en')).toBe('–');
  });

  it('gives a bar share only with a positive maximum, capped at 100', () => {
    expect(percentOf(4, 16)).toBe(25);
    expect(percentOf(20, 16)).toBe(100);
    expect(percentOf(4, 0)).toBeNull();
    expect(percentOf(4, null)).toBeNull();
    expect(percentOf(null, 16)).toBeNull();
  });
});

describe('status', () => {
  /** Facts that make phoneSystemHealth report exactly this one reason. */
  const only: Record<PhoneStatusReason, () => ReturnType<typeof phoneSystemHealth>> = {
    unreachable: () => phoneSystemHealth(null, false, new Date(NOW)),
    not_activated: () => phoneSystemHealth(info({ activated: false }), true, new Date(NOW)),
    license_inactive: () => phoneSystemHealth(info({ licenseActive: false }), true, new Date(NOW)),
    license_expired: () => phoneSystemHealth(info({ licenseExpiresAt: inDays(-1) }), true, new Date(NOW)),
    license_expiring: () => phoneSystemHealth(info({ licenseExpiresAt: inDays(10) }), true, new Date(NOW)),
    maintenance_expired: () =>
      phoneSystemHealth(info({ maintenanceExpiresAt: inDays(-1) }), true, new Date(NOW)),
    services_down: () => phoneSystemHealth(info({ servicesDown: true }), true, new Date(NOW)),
    trunks_down: () => phoneSystemHealth(info({ trunksRegistered: 1 }), true, new Date(NOW)),
    user_limit_reached: () => phoneSystemHealth(info({ users: 10, maxUsers: 10 }), true, new Date(NOW)),
  };

  it.each(PHONE_STATUS_REASONS)('colours %s like the status it causes', (reason) => {
    const health = only[reason]();
    expect(health.reasons).toEqual([reason]);
    expect(reasonTone(reason)).toBe(health.status === 'error' ? 'danger' : 'warning');
  });

  it('tells an expired, an expiring and a valid license apart like phoneSystemHealth', () => {
    expect(licenseState(null, PHONE_LICENSE_WARN_DAYS, NOW)).toBe('none');
    expect(licenseState('0001-01-01T00:00:00Z', PHONE_LICENSE_WARN_DAYS, NOW)).toBe('expired');
    expect(licenseState('not a date', PHONE_LICENSE_WARN_DAYS, NOW)).toBe('none');
    expect(licenseState(inDays(-1), PHONE_LICENSE_WARN_DAYS, NOW)).toBe('expired');
    expect(licenseState(inDays(29), PHONE_LICENSE_WARN_DAYS, NOW)).toBe('expiring');
    expect(licenseState(inDays(31), PHONE_LICENSE_WARN_DAYS, NOW)).toBe('valid');
    expect(phoneSystemHealth(info({ licenseExpiresAt: inDays(29) }), true, new Date(NOW)).reasons).toContain(
      'license_expiring',
    );
    expect(phoneSystemHealth(info({ licenseExpiresAt: inDays(31) }), true, new Date(NOW)).status).toBe('ok');
  });
});

describe('users', () => {
  it('names a user by display name, else first and last name, else the number', () => {
    expect(phoneUserName(user({ displayName: 'Ben B.' }))).toBe('Ben B.');
    expect(phoneUserName(user())).toBe('Ben Beispiel');
    expect(phoneUserName(user({ firstName: 'Empfang', lastName: null }))).toBe('Empfang');
    expect(phoneUserName(user({ firstName: null, lastName: ' ', displayName: ' ' }))).toBe('101');
  });

  it('labels the offered languages, the PBX default and unknown codes', () => {
    expect(languageLabel(t, 'DE')).toBe('phone.language.de');
    expect(languageLabel(t, null)).toBe('phone.user.language.default');
    expect(languageLabel(t, '')).toBe('phone.user.language.default');
    expect(languageLabel(t, 'es')).toBe('es');
  });

  it('searches number, names and e-mail address', () => {
    const u = user({ displayName: 'Ben Beispiel' });
    expect(matchesPhoneUser(u, '')).toBe(true);
    expect(matchesPhoneUser(u, '10')).toBe(true);
    expect(matchesPhoneUser(u, 'beisp')).toBe(true);
    expect(matchesPhoneUser(u, 'MUSTER.example')).toBe(true);
    expect(matchesPhoneUser(u, 'carla')).toBe(false);
  });

  it('lets only weblion staff delete protected users or change their e-mail address', () => {
    const owner = ['phone:read', 'phone:write', 'phone:credentials'] as const;
    const staff = ['platform:provider:write'] as const;
    expect(canDeletePhoneUser(user(), owner, [])).toBe(true);
    expect(canDeletePhoneUser(user({ protected: true }), owner, [])).toBe(false);
    expect(canDeletePhoneUser(user({ protected: true }), owner, staff)).toBe(true);
    expect(canDeletePhoneUser(user(), ['phone:read'], staff)).toBe(false);
    expect(canChangePhoneEmail(user(), owner, [])).toBe(true);
    expect(canChangePhoneEmail(user(), ['phone:read', 'phone:write'], [])).toBe(false);
    expect(canChangePhoneEmail(user({ protected: true }), owner, [])).toBe(false);
    expect(canChangePhoneEmail(user({ protected: true }), owner, staff)).toBe(true);
  });
});

describe('user form', () => {
  it('checks the extension against the number length; empty lets the PBX pick', () => {
    expect(phoneUserFormIssues(form({ number: '' }), 3)).toEqual({});
    expect(phoneUserFormIssues(form({ number: '101' }), 3)).toEqual({});
    expect(phoneUserFormIssues(form({ number: '1001' }), 3)).toEqual({ number: 'invalid' });
    expect(phoneUserFormIssues(form({ number: '10a' }), 3)).toEqual({ number: 'invalid' });
    expect(phoneUserFormIssues(form({ number: '1' }), null)).toEqual({ number: 'invalid' });
    expect(phoneUserFormIssues(form({ number: '1234567890' }), null)).toEqual({});
    expect(phoneUserFormIssues(form({ number: '12345678901' }), null)).toEqual({ number: 'invalid' });
  });

  it('requires a first name and a valid e-mail address, checks lengths and external numbers', () => {
    expect(phoneUserFormIssues(form({ firstName: ' ', email: '' }), 3)).toEqual({
      firstName: 'required',
      email: 'required',
    });
    expect(phoneUserFormIssues(form({ firstName: 'x'.repeat(51), lastName: 'y'.repeat(51) }), 3)).toEqual({
      firstName: 'tooLong',
      lastName: 'tooLong',
    });
    expect(phoneUserFormIssues(form({ email: 'anna@' }), 3)).toEqual({ email: 'invalid' });
    expect(
      phoneUserFormIssues(form({ mobile: '+41 79 123 45 67', outboundCallerId: '044/123.45.00' }), 3),
    ).toEqual({});
    expect(phoneUserFormIssues(form({ mobile: '12', outboundCallerId: '+' }), 3)).toEqual({
      mobile: 'invalid',
      outboundCallerId: 'invalid',
    });
    expect(phoneUserFormIssues(form({ mobile: '1'.repeat(41) }), 3)).toEqual({ mobile: 'tooLong' });
  });

  it('keeps what the PBX already has when editing and skips a locked e-mail address', () => {
    const fax = user({ firstName: null, email: null, system: true, protected: true });
    expect(phoneUserFormIssues(phoneUserFormFrom(fax), 3, fax, false)).toEqual({});
    expect(phoneUserFormIssues(phoneUserFormFrom(fax), 3, fax, true)).toEqual({});
    const ben = user();
    expect(phoneUserFormIssues({ ...phoneUserFormFrom(ben), firstName: '' }, 3, ben)).toEqual({
      firstName: 'required',
    });
    expect(phoneUserFormIssues({ ...phoneUserFormFrom(ben), email: 'nope' }, 3, ben, true)).toEqual({
      email: 'invalid',
    });
    expect(phoneUserFormIssues({ ...phoneUserFormFrom(ben), email: 'nope' }, 3, ben, false)).toEqual({});
    // External numbers the PBX has are kept; a changed one is checked.
    const odd = user({ mobile: '12', outboundCallerId: 'intern' });
    expect(phoneUserFormIssues({ ...phoneUserFormFrom(odd), firstName: 'Bea' }, 3, odd)).toEqual({});
    expect(phoneUserFormIssues({ ...phoneUserFormFrom(odd), mobile: '123a' }, 3, odd)).toEqual({
      mobile: 'invalid',
    });
    // The number of an existing user is never checked: it cannot be changed.
    expect(phoneUserFormIssues({ ...phoneUserFormFrom(ben), number: 'x' }, 3, ben)).toEqual({});
  });

  it('builds the create body: trimmed, cleaned numbers, empty fields null, empty number left out', () => {
    expect(
      phoneUserCreateBody(
        form({
          number: ' 106 ',
          firstName: ' Anna ',
          lastName: ' ',
          email: ' Anna@Muster.Example ',
          mobile: '+41 79 123 45 67',
          outboundCallerId: '',
          language: 'fr',
        }),
      ),
    ).toEqual({
      number: '106',
      firstName: 'Anna',
      lastName: null,
      email: 'anna@muster.example',
      mobile: '+41791234567',
      outboundCallerId: null,
      language: 'fr',
      sendWelcome: true,
    });
    const body = phoneUserCreateBody(form({ number: '', language: '', sendWelcome: false }));
    expect(body).not.toHaveProperty('number');
    expect(body.language).toBeNull();
    expect(body.sendWelcome).toBe(false);
  });

  it('sends only the fields that changed when editing', () => {
    const ben = user({ mobile: '+41791234567', language: 'DE', outboundCallerId: '+41441234500' });
    const unchanged = phoneUserFormFrom(ben);
    expect(phoneUserPatchBody(ben, unchanged, true)).toEqual({});
    // Separators and case are no change.
    expect(
      phoneUserPatchBody(
        ben,
        { ...unchanged, mobile: '+41 79 123 45 67', email: 'BEN@muster.example' },
        true,
      ),
    ).toEqual({});
    expect(
      phoneUserPatchBody(
        ben,
        {
          ...unchanged,
          firstName: 'Benjamin ',
          lastName: '',
          mobile: '',
          language: '',
          email: 'b@muster.example',
        },
        true,
      ),
    ).toEqual({
      firstName: 'Benjamin',
      lastName: null,
      mobile: null,
      language: null,
      email: 'b@muster.example',
    });
    // Without phone:credentials the address is never sent.
    expect(phoneUserPatchBody(ben, { ...unchanged, email: 'b@muster.example' }, false)).toEqual({});
    expect(phoneUserPatchBody(ben, { ...unchanged, language: 'it' }, true)).toEqual({ language: 'it' });
  });

  it('keeps a language the panel does not offer as the PBX has it', () => {
    const es = user({ language: 'es' });
    const unchanged = phoneUserFormFrom(es);
    expect(unchanged.language).toBe('es');
    expect(phoneUserPatchBody(es, { ...unchanged, firstName: 'Bea' }, true)).toEqual({ firstName: 'Bea' });
  });

  it('words the number rule for exact lengths and for the 2 to 10 digit fallback', () => {
    expect(numberRuleText(t, 3, 'hint')).toBe('phone.user.numberHint {"n":3}');
    expect(numberRuleText(t, null, 'invalid')).toBe('phone.user.numberInvalidRange {"min":2,"max":10}');
  });
});

describe('ring groups', () => {
  const users = [
    user({ id: '1', number: '100', firstName: 'Anna', lastName: 'Muster' }),
    user({ id: '2', number: '1001', firstName: 'Lab' }),
    user({ id: '3', number: '105', firstName: 'Fax', lastName: null, system: true, protected: true }),
    user({ id: '4', number: '20', firstName: 'Eva' }),
    user({ id: '5', number: '101' }),
  ];

  it('offers the people that are not members yet, by extension', () => {
    const group = { members: [{ number: '101', name: 'Ben Beispiel' }] };
    expect(ringGroupCandidates(users, group).map((u) => u.number)).toEqual(['20', '100', '1001']);
  });

  it('labels members with the PBX name, else the user name, else the number', () => {
    expect(memberLabel({ number: '101', name: 'Ben B.' }, users)).toBe('101 Ben B.');
    expect(memberLabel({ number: '100', name: null }, users)).toBe('100 Anna Muster');
    expect(memberLabel({ number: '999', name: null }, users)).toBe('999');
    expect(memberLabel({ number: '999', name: null }, undefined)).toBe('999');
    expect(ringGroupLabel({ number: '800', name: 'Zentrale' })).toBe('800 Zentrale');
    expect(ringGroupLabel({ number: '800', name: null })).toBe('800');
  });
});

describe('API errors', () => {
  const fieldError = (path: string) =>
    new ApiError(400, 'bad_request', 'Validation failed', [{ path, message: 'Invalid' }]);

  it('finds the form field of the panel checks, of the PBX refusals and of a taken number', () => {
    expect(phoneErrorField(fieldError('email'))).toBe('email');
    expect(phoneErrorField(fieldError('number'))).toBe('number');
    expect(phoneErrorField(fieldError('outboundCallerId'))).toBe('outboundCallerId');
    expect(phoneErrorField(fieldError('confirm'))).toBeNull();
    expect(
      phoneErrorField(
        new ApiError(400, 'bad_request', '3CX: WARNINGS.XAPI.OUT_OF_THE_RANGE', {
          target: 'OutboundCallerID',
          code: 'WARNINGS.XAPI.OUT_OF_THE_RANGE',
        }),
      ),
    ).toBe('outboundCallerId');
    expect(
      phoneErrorField(new ApiError(400, 'bad_request', '3CX: bad', { target: 'EmailAddress', code: null })),
    ).toBe('email');
    expect(
      phoneErrorField(new ApiError(400, 'bad_request', '3CX: bad', { target: 'Groups', code: null })),
    ).toBeNull();
    expect(
      phoneErrorField(
        new ApiError(409, 'conflict', 'The extension number 101 is in use at the phone system'),
      ),
    ).toBe('number');
    expect(
      phoneErrorField(new ApiError(409, 'conflict', '3CX: WARNINGS.FAX_SERVER_CANNOT_BE_DELETED')),
    ).toBeNull();
    expect(
      phoneErrorField(new ApiError(409, 'phone_user_limit', 'The license allows no more users')),
    ).toBeNull();
    expect(phoneErrorField(new Error('network'))).toBeNull();
  });

  it('words field errors in the user language and keeps the PBX reason', () => {
    expect(
      phoneServerFieldText(
        t,
        new ApiError(409, 'conflict', 'The extension number 101 is in use'),
        'number',
        3,
      ),
    ).toBe('phone.user.numberTaken');
    expect(phoneServerFieldText(t, fieldError('email'), 'email', 3)).toBe('phone.user.emailInvalid');
    expect(phoneServerFieldText(t, fieldError('number'), 'number', 3)).toBe(
      'phone.user.numberInvalid {"n":3}',
    );
    expect(phoneServerFieldText(t, fieldError('mobile'), 'mobile', 3)).toBe('phone.user.externalInvalid');
    expect(
      phoneServerFieldText(
        t,
        new ApiError(400, 'bad_request', '3CX: too long', { target: 'FirstName' }),
        'firstName',
        3,
      ),
    ).toBe('3CX: too long');
  });

  it('translates the license limit and passes everything else through', () => {
    expect(phoneErrorText(t, new ApiError(409, 'phone_user_limit', 'The license allows no more users'))).toBe(
      'phone.user.limitReached',
    );
    expect(phoneErrorText(t, new ApiError(502, 'provider_error', '3CX: sign-in failed'))).toBe(
      '3CX: sign-in failed',
    );
  });
});

describe('providers', () => {
  it('treats 3CX and the plain demo as phone providers, not the flavored demos', () => {
    expect(isPhoneProvider({ type: 'threecx', summary: {} })).toBe(true);
    expect(isPhoneProvider({ type: 'demo', summary: {} })).toBe(true);
    expect(isPhoneProvider({ type: 'demo', summary: { flavor: 'cloudflare' } })).toBe(false);
    expect(isPhoneProvider({ type: 'mailcow', summary: {} })).toBe(false);
  });
});
