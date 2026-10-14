import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebsiteDnsCheckDto, WebsiteDnsName, WebspaceDto } from '@weblion/shared';
import { ApiError } from '@/lib/api';
import type { TFunction } from '@/lib/i18n';
import {
  DNS_STATUS_TONE,
  TRUSTED_MAX_DAYS,
  allowanceRoom,
  certificateState,
  databaseNamePreview,
  defaultDatabaseSuffix,
  deleteConfirmValue,
  dnsBlocker,
  errorField,
  expectedDnsRecords,
  foreignDnsAnswers,
  normalizeIp,
  outcomeUnknown,
  ownWebsiteUsage,
  parseCount,
  passwordReady,
  sftpUrl,
  sshCommand,
  sshTunnelCommand,
  templateWantsDatabase,
  usageText,
  websiteErrorText,
  websiteTypeLabel,
  websiteUrl,
  websiteUsageBytes,
  websitesFirst,
} from './website-bits';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-12T12:00:00Z');
const inDays = (days: number) => new Date(NOW + days * DAY).toISOString();

/** Returns the key with its parameters, so the tests see which text was chosen. */
const t = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key} ${JSON.stringify(params)}` : key) as TFunction;

describe('certificateState', () => {
  const le = (days: number | null) => ({
    type: '2',
    letsEncrypt: true,
    expiresAt: days === null ? null : inDays(days),
  });

  it('is ok from 30 days on, amber below 30 days and red below 14 days', () => {
    expect(certificateState(le(60), NOW)).toMatchObject({ kind: 'letsEncrypt', level: 'ok', days: 60 });
    expect(certificateState(le(30), NOW).level).toBe('ok');
    expect(certificateState(le(29.9), NOW)).toMatchObject({ level: 'warning', days: 29 });
    expect(certificateState(le(14), NOW).level).toBe('warning');
    expect(certificateState(le(13.9), NOW)).toMatchObject({ level: 'danger', days: 13 });
    expect(certificateState(le(-2), NOW)).toMatchObject({ level: 'danger', days: -2 });
  });

  it('is red without a certificate', () => {
    expect(certificateState(null, NOW)).toEqual({
      kind: 'none',
      level: 'danger',
      expiresAt: null,
      days: null,
    });
  });

  it("treats CloudPanel's self-signed certificate (another issuer, years ahead) as invalid", () => {
    const selfSigned = { type: '1', letsEncrypt: false, expiresAt: inDays(3650) };
    expect(certificateState(selfSigned, NOW)).toMatchObject({ kind: 'invalid', level: 'danger', days: null });
    // Another issuer without a known expiry cannot be told apart from it either.
    expect(certificateState({ type: null, letsEncrypt: false, expiresAt: null }, NOW).kind).toBe('invalid');
    // Nor can it when the server could not read the issuer: no trusted certificate runs that long.
    expect(certificateState({ type: '1', letsEncrypt: null, expiresAt: inDays(3650) }, NOW)).toMatchObject({
      kind: 'invalid',
      level: 'danger',
    });
    expect(
      certificateState({ type: '1', letsEncrypt: null, expiresAt: inDays(TRUSTED_MAX_DAYS + 1) }, NOW).kind,
    ).toBe('invalid');
    // Let's Encrypt is trusted by name, whatever its expiry says.
    expect(certificateState(le(TRUSTED_MAX_DAYS + 1), NOW).kind).toBe('letsEncrypt');
  });

  it('shows a certificate of another issuer with a trusted lifetime by its expiry', () => {
    const imported = { type: '3', letsEncrypt: false, expiresAt: inDays(TRUSTED_MAX_DAYS) };
    expect(certificateState(imported, NOW)).toMatchObject({ kind: 'other', level: 'ok' });
    expect(certificateState({ ...imported, expiresAt: inDays(20) }, NOW)).toMatchObject({
      kind: 'other',
      level: 'warning',
    });
  });

  it('keeps an unknown issuer or expiry neutral', () => {
    expect(certificateState({ type: null, letsEncrypt: null, expiresAt: inDays(5) }, NOW)).toMatchObject({
      kind: 'other',
      level: 'danger',
    });
    expect(certificateState(le(null), NOW)).toEqual({
      kind: 'letsEncrypt',
      level: 'ok',
      expiresAt: null,
      days: null,
    });
    expect(certificateState({ type: '2', letsEncrypt: true, expiresAt: 'soon' }, NOW).days).toBeNull();
  });
});

describe('usage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds files and databases, null only while nothing was measured', () => {
    expect(websiteUsageBytes({ diskBytes: 800 * 1024 ** 2, databaseBytes: 20 * 1024 ** 2 })).toBe(
      820 * 1024 ** 2,
    );
    expect(websiteUsageBytes({ diskBytes: 1024, databaseBytes: null })).toBe(1024);
    expect(websiteUsageBytes({ diskBytes: null, databaseBytes: 0 })).toBe(0);
    expect(websiteUsageBytes({ diskBytes: null, databaseBytes: null })).toBeNull();
  });

  it('formats the size with the time of the measurement', () => {
    const site = {
      diskBytes: 800 * 1024 ** 2,
      databaseBytes: 20 * 1024 ** 2,
      usageMeasuredAt: new Date(NOW - 3 * 3_600_000).toISOString(),
    };
    expect(usageText(t, 'de', site)).toBe('websites.usage.measured {"size":"820 MB","when":"vor 3 Stunden"}');
    expect(usageText(t, 'en', site)).toBe('websites.usage.measured {"size":"820 MB","when":"3 hours ago"}');
    expect(usageText(t, 'de', { ...site, usageMeasuredAt: null })).toBe('820 MB');
    expect(usageText(t, 'de', { diskBytes: null, databaseBytes: null, usageMeasuredAt: null })).toBe(
      'websites.usage.notMeasured',
    );
  });
});

describe('websiteTypeLabel', () => {
  const base = { phpVersion: null, nodejsVersion: null, application: null };
  it('names PHP with version and application, Node.js with version, others by type', () => {
    expect(websiteTypeLabel(t, { ...base, type: 'php', phpVersion: '8.4', application: 'WordPress' })).toBe(
      'PHP 8.4 · WordPress',
    );
    expect(websiteTypeLabel(t, { ...base, type: 'php' })).toBe('PHP');
    expect(websiteTypeLabel(t, { ...base, type: 'nodejs', nodejsVersion: '22' })).toBe('Node.js 22');
    expect(websiteTypeLabel(t, { ...base, type: 'static' })).toBe('websites.type.static');
  });
});

// --- DNS ---------------------------------------------------------------------------------

const dnsName = (patch: Partial<WebsiteDnsName> & { name: string }): WebsiteDnsName => ({
  a: [],
  aaaa: [],
  status: 'missing',
  ...patch,
});

const check = (names: WebsiteDnsName[], ready = false): WebsiteDnsCheckDto => ({
  expected: { ipv4: ['203.0.113.10'], ipv6: ['2001:db8::10'] },
  names,
  ready,
  panelDomain: null,
  checkedAt: new Date(NOW).toISOString(),
});

describe('DNS status mapping', () => {
  it('gives every status its tone', () => {
    expect(DNS_STATUS_TONE).toEqual({
      ok: 'success',
      elsewhere: 'warning',
      missing: 'danger',
      error: 'neutral',
    });
  });

  it('names the worst blocker: a failed lookup, then a foreign address, then a missing record', () => {
    expect(dnsBlocker(check([dnsName({ name: 'a.ch', status: 'ok' })], true))).toBeNull();
    expect(
      dnsBlocker(
        check([dnsName({ name: 'a.ch', status: 'missing' }), dnsName({ name: 'www.a.ch', status: 'ok' })]),
      ),
    ).toBe('missing');
    expect(
      dnsBlocker(
        check([
          dnsName({ name: 'a.ch', status: 'missing' }),
          dnsName({ name: 'www.a.ch', status: 'elsewhere' }),
        ]),
      ),
    ).toBe('elsewhere');
    expect(
      dnsBlocker(
        check([
          dnsName({ name: 'a.ch', status: 'elsewhere' }),
          dnsName({ name: 'www.a.ch', status: 'error' }),
        ]),
      ),
    ).toBe('error');
    // Not ready although both names look fine (the API decides): still a reason to show.
    expect(dnsBlocker(check([dnsName({ name: 'a.ch', status: 'ok' })], false))).toBe('missing');
  });

  it('lists the expected A and AAAA records per name with what exists already', () => {
    const records = expectedDnsRecords(
      check([
        dnsName({ name: 'a.ch', a: ['203.0.113.10'], aaaa: ['2001:DB8:0:0:0:0:0:10'], status: 'ok' }),
        dnsName({ name: 'www.a.ch', a: ['198.51.100.7'], status: 'elsewhere' }),
      ]),
    );
    expect(records).toEqual([
      { name: 'a.ch', type: 'A', value: '203.0.113.10', present: true },
      { name: 'a.ch', type: 'AAAA', value: '2001:db8::10', present: true },
      { name: 'www.a.ch', type: 'A', value: '203.0.113.10', present: false },
      { name: 'www.a.ch', type: 'AAAA', value: '2001:db8::10', present: false },
    ]);
  });

  it('collects foreign answers once', () => {
    expect(
      foreignDnsAnswers(
        check([
          dnsName({ name: 'a.ch', a: ['198.51.100.7', '203.0.113.10'], aaaa: ['2001:db8:0::10'] }),
          dnsName({ name: 'www.a.ch', a: ['198.51.100.7'], aaaa: ['2001:db8::99'] }),
        ]),
      ),
    ).toEqual(['198.51.100.7', '2001:db8::99']);
  });

  it('compares IPv6 addresses in any spelling', () => {
    expect(normalizeIp('2001:DB8::10')).toBe('2001:db8:0:0:0:0:0:10');
    expect(normalizeIp('2001:0db8:0000:0000:0000:0000:0000:0010')).toBe('2001:db8:0:0:0:0:0:10');
    expect(normalizeIp('::1')).toBe('0:0:0:0:0:0:0:1');
    expect(normalizeIp('fe80::')).toBe('fe80:0:0:0:0:0:0:0');
    expect(normalizeIp(' 203.0.113.10 ')).toBe('203.0.113.10');
  });
});

// --- Databases ---------------------------------------------------------------------------

describe('databaseNamePreview', () => {
  it('shows the fixed prefix and the full name', () => {
    expect(databaseNamePreview('shop-mueller-ch', 'wp')).toEqual({
      prefix: 'shop_mueller_ch_',
      name: 'shop_mueller_ch_wp',
      issue: null,
    });
  });

  it('cuts the prefix to 16 characters', () => {
    expect(databaseNamePreview('a-very-long-site-user-name', 'wordpress_db')).toEqual({
      prefix: 'a_very_long_site_',
      name: 'a_very_long_site_wordpress_db',
      issue: null,
    });
  });

  it('names the problem when there is no valid name', () => {
    expect(databaseNamePreview('shop', '').issue).toBe('empty');
    expect(databaseNamePreview('shop', '_wp').issue).toBe('suffix');
    expect(databaseNamePreview('shop', 'WP').issue).toBe('suffix');
    expect(databaseNamePreview('shop', 'a'.repeat(16)).issue).toBe('suffix');
    expect(databaseNamePreview('Shop!', 'wp')).toMatchObject({ name: null, issue: 'siteUser' });
    expect(databaseNamePreview('', 'wp').issue).toBe('siteUser');
  });

  it('switches the database on for WordPress and WooCommerce', () => {
    expect(templateWantsDatabase('WordPress')).toBe(true);
    expect(templateWantsDatabase('WooCommerce')).toBe(true);
    expect(templateWantsDatabase('wordpress')).toBe(true);
    expect(templateWantsDatabase('Generic')).toBe(false);
    expect(templateWantsDatabase('WordPressish')).toBe(false);
    expect(templateWantsDatabase(null)).toBe(false);
    expect(defaultDatabaseSuffix('WordPress')).toBe('wp');
    expect(defaultDatabaseSuffix('Laravel 12')).toBe('db');
  });
});

// --- Lists, allowances, forms ------------------------------------------------------------

describe('lists and allowances', () => {
  const item = (name: string, kind: WebspaceDto['kind']) => ({ name, kind });

  it('puts websites first by name, web spaces after in their order', () => {
    expect(
      websitesFirst([
        item('z-space', 'webspace'),
        item('shop.ch', 'website'),
        item('a-space', 'webspace'),
        item('alpha.ch', 'website'),
      ]).map((w) => w.name),
    ).toEqual(['alpha.ch', 'shop.ch', 'z-space', 'a-space']);
  });

  it('computes the room left, never negative', () => {
    expect(allowanceRoom({ maxSites: 5, sites: 3, maxDatabases: 10, databases: 4 })).toEqual({
      sites: 2,
      databases: 6,
    });
    // Staff may create beyond the allowance.
    expect(allowanceRoom({ maxSites: 1, sites: 2, maxDatabases: 0, databases: 1 })).toEqual({
      sites: 0,
      databases: 0,
    });
  });

  it('counts the websites and databases of an organization without allowance', () => {
    const site = (databases: number) => ({ site: { databases } as WebspaceDto['site'] });
    expect(ownWebsiteUsage([site(1), site(0), { site: null }, site(2)])).toEqual({ sites: 4, databases: 3 });
    expect(ownWebsiteUsage([])).toEqual({ sites: 0, databases: 0 });
  });

  it('parses whole numbers within the maximum', () => {
    expect(parseCount('0', 10)).toBe(0);
    expect(parseCount(' 7 ', 10)).toBe(7);
    expect(parseCount('11', 10)).toBeNull();
    expect(parseCount('1.5', 10)).toBeNull();
    expect(parseCount('-1', 10)).toBeNull();
    expect(parseCount('', 10)).toBeNull();
  });

  it('accepts generated passwords and chosen ones that follow the rules', () => {
    expect(passwordReady('generate', '')).toBe(true);
    expect(passwordReady('choose', 'Abcdefgh1234')).toBe(true);
    expect(passwordReady('choose', 'Abcdefgh123')).toBe(false);
    expect(passwordReady('choose', 'Abcdefgh1234$')).toBe(false);
  });

  it('accepts the Unicode or ASCII domain to confirm a delete', () => {
    expect(deleteConfirmValue('müller.ch', 'müller.ch')).toBe('müller.ch');
    expect(deleteConfirmValue(' MÜLLER.CH ', 'müller.ch')).toBe('müller.ch');
    expect(deleteConfirmValue('xn--mller-kva.ch', 'müller.ch')).toBe('xn--mller-kva.ch');
    expect(deleteConfirmValue('mueller.ch', 'müller.ch')).toBeNull();
    expect(deleteConfirmValue('', 'müller.ch')).toBeNull();
  });

  it('builds the access lines and the website link', () => {
    expect(sshCommand('shop', 'web1.weblion.cloud', 22)).toBe('ssh shop@web1.weblion.cloud');
    expect(sshCommand('shop', 'web1.weblion.cloud', 2222)).toBe('ssh -p 2222 shop@web1.weblion.cloud');
    expect(sftpUrl('shop', 'web1.weblion.cloud', 22)).toBe('sftp://shop@web1.weblion.cloud');
    expect(sftpUrl('shop', 'web1.weblion.cloud', 2222)).toBe('sftp://shop@web1.weblion.cloud:2222');
    expect(sshTunnelCommand('shop', 'web1.weblion.cloud', 22)).toBe(
      'ssh -L 3306:127.0.0.1:3306 shop@web1.weblion.cloud',
    );
    expect(websiteUrl('müller.ch')).toBe('https://xn--mller-kva.ch');
  });
});

// --- Errors ------------------------------------------------------------------------------

describe('errors', () => {
  it('finds the field in 409 details and in validation details', () => {
    expect(errorField(new ApiError(409, 'exists', 'taken', { field: 'siteUser' }))).toBe('siteUser');
    expect(
      errorField(new ApiError(400, 'bad_request', 'Validation failed', [{ path: 'database.suffix' }])),
    ).toBe('database');
    expect(errorField(new ApiError(400, 'bad_request', 'x', [{ path: ['domain'] }]))).toBe('domain');
    expect(errorField(new ApiError(409, 'allowance_exceeded', 'full', { sites: 5 }))).toBeNull();
    expect(errorField(new Error('x'))).toBeNull();
  });

  it('knows when the server may have finished a change', () => {
    expect(outcomeUnknown(new ApiError(502, 'website_error', 'may exist', { rolledBack: false }))).toBe(true);
    expect(outcomeUnknown(new ApiError(504, 'timeout', 'no answer'))).toBe(true);
    // A failure the server reported (e.g. Let's Encrypt refused) or rolled back changed nothing.
    expect(
      outcomeUnknown(new ApiError(502, 'provider_error', 'CloudPanel: DNS problem', { output: 'x' })),
    ).toBe(false);
    expect(outcomeUnknown(new ApiError(502, 'provider_error', 'failed', { rolledBack: true }))).toBe(false);
    expect(outcomeUnknown(new ApiError(409, 'website_error', 'earlier change'))).toBe(false);
    expect(outcomeUnknown(new ApiError(409, 'exists', 'taken'))).toBe(false);
    expect(outcomeUnknown(new ApiError(503, 'busy', 'busy'))).toBe(false);
    expect(outcomeUnknown(null)).toBe(false);
    // No answer of the API: the connection broke, or a proxy gave up waiting (its own error page).
    expect(outcomeUnknown(new TypeError('Failed to fetch'))).toBe(true);
    expect(outcomeUnknown(new SyntaxError('Unexpected token <'))).toBe(true);
    expect(outcomeUnknown(new ApiError(502, 'error', 'Bad Gateway'))).toBe(true);
    expect(outcomeUnknown(new ApiError(504, 'error', 'Gateway Timeout'))).toBe(true);
  });

  it('translates the website codes and leaves other messages as the API sent them', () => {
    // Allowance and "exists" refusals keep the API's text: it has the figures and the reason.
    expect(
      websiteErrorText(
        t,
        new ApiError(409, 'allowance_exceeded', 'Your allowance has room for 0 more websites'),
      ),
    ).toBe('websites.errors.allowance_exceeded Your allowance has room for 0 more websites');
    expect(
      websiteErrorText(
        t,
        new ApiError(
          409,
          'type_not_allowed',
          'Customers of this reseller may create static websites. Take the type away from them first.',
        ),
      ),
    ).toBe(
      'websites.errors.type_not_allowed Customers of this reseller may create static websites. Take the type away from them first.',
    );
    expect(websiteErrorText(t, new ApiError(409, 'no_allowance', ''))).toBe('websites.errors.no_allowance');
    expect(
      websiteErrorText(
        t,
        new ApiError(409, 'exists', 'shop.ch is still listed as a missing website on web1.', {
          field: 'domain',
        }),
      ),
    ).toBe('websites.errors.exists.domain shop.ch is still listed as a missing website on web1.');
    expect(websiteErrorText(t, new ApiError(503, 'busy', 'The server is busy'))).toBe('websites.errors.busy');
    expect(websiteErrorText(t, new ApiError(409, 'website_error', 'earlier change'))).toBe(
      'websites.errors.website_error',
    );
    expect(websiteErrorText(t, new ApiError(502, 'website_error', 'may exist', { rolledBack: false }))).toBe(
      'websites.errors.unknownOutcomeText',
    );
    expect(websiteErrorText(t, new ApiError(409, 'exists', 'Other text', { field: 'other' }))).toBe(
      'Other text',
    );
    expect(
      websiteErrorText(t, new ApiError(502, 'provider_error', 'CloudPanel: DNS problem: NXDOMAIN')),
    ).toBe('CloudPanel: DNS problem: NXDOMAIN');
  });
});
