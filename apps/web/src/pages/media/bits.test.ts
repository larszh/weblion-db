import { describe, expect, it } from 'vitest';
import {
  MEDIA_BITRATE_PRESETS_MBIT,
  MEDIA_MAX_ACCOUNTS,
  MEDIA_REQUESTS_DEFAULT,
  type MediaAccountIssue,
  type MediaRequestsAccess,
  type MediaSeerrCheck,
} from '@weblion/shared';
import { ApiError } from '@/lib/api';
import type { TFunction } from '@/lib/i18n';
import { isMediaProvider } from '@/pages/admin/media';
import { seerrBadge, seerrCanSwitchOn, seerrCheckItems, seerrOnlyFixable } from '@/pages/admin/media-seerr';
import {
  activityDayKind,
  activityDayText,
  bitrateChoiceOf,
  connectErrorKey,
  formatBitrate,
  formatMediaDay,
  groupPassword,
  mediaAllowanceFull,
  mediaRequestsFormFrom,
  mediaStatus,
  mediaToday,
  ownMediaAccounts,
  parseCount,
  previousDay,
  quickConnectField,
  readBitrate,
  readMediaRequestsForm,
  requestQuotaUsage,
  requestTypeText,
  requestTypesText,
  streamLimitOf,
  usernamePreview,
  type MediaRequestsForm,
} from './bits';
import { mediaAccessFormFrom, readMediaAccessForm, type MediaAccessLimits } from './dialogs';

/** Echoes the key and its parameters, so expectations can see which text was chosen. */
const t = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key} ${JSON.stringify(params)}` : key) as TFunction;

const account = (patch: {
  missingSince?: string | null;
  enabled?: boolean;
  hasPassword?: boolean;
  issues?: MediaAccountIssue[];
}) => ({ missingSince: null, enabled: true, hasPassword: true, issues: [], ...patch });

describe('mediaStatus', () => {
  it('is active without anything to report', () => {
    expect(mediaStatus(account({}))).toBe('active');
  });

  it('puts missing before locked, locked before disabled, disabled before no password', () => {
    const all = {
      enabled: false,
      hasPassword: false,
      issues: ['locked_out', 'no_password'] as MediaAccountIssue[],
    };
    expect(mediaStatus(account({ ...all, missingSince: '2026-10-01T00:00:00.000Z' }))).toBe('missing');
    expect(mediaStatus(account(all))).toBe('locked');
    expect(mediaStatus(account({ ...all, issues: ['no_password'] }))).toBe('disabled');
    expect(mediaStatus(account({ hasPassword: false }))).toBe('noPassword');
  });

  it('reads no password from the issue too', () => {
    expect(mediaStatus(account({ issues: ['no_password'] }))).toBe('noPassword');
  });

  it('ignores issues that are no status (policy drift, no allowance)', () => {
    expect(mediaStatus(account({ issues: ['policy', 'no_allowance', 'administrator'] }))).toBe('active');
  });
});

describe('usernamePreview', () => {
  it('joins name and account code with a dash', () => {
    expect(usernamePreview('anna', 'kemaro')).toBe('anna-kemaro');
    expect(usernamePreview('wohnzimmer-2', 'bivane')).toBe('wohnzimmer-2-bivane');
  });

  it('shows an ellipsis while no name is typed', () => {
    expect(usernamePreview('', 'kemaro')).toBe('…-kemaro');
  });
});

describe('formatBitrate', () => {
  it('formats Mbit/s in the locale', () => {
    expect(formatBitrate(8, 'de', t)).toBe('8 Mbit/s');
    expect(formatBitrate(8, 'en', t)).toBe('8 Mbit/s');
    expect(formatBitrate(1000, 'en', t)).toBe('1,000 Mbit/s');
  });

  it("names the server's setting for null", () => {
    expect(formatBitrate(null, 'de', t)).toBe('media.allowance.serverBitrate');
  });
});

describe('groupPassword', () => {
  it('splits a generated password into groups of four', () => {
    expect(groupPassword('abcdefghijkmnpqr')).toBe('abcd efgh ijkm npqr');
  });

  it('keeps a shorter last group and empty input', () => {
    expect(groupPassword('abcdef')).toBe('abcd ef');
    expect(groupPassword('')).toBe('');
  });

  it('is only for display: removing the spaces gives the password back', () => {
    expect(groupPassword('k3mar0x9pq2wzt7b').replace(/ /g, '')).toBe('k3mar0x9pq2wzt7b');
  });
});

describe('days of last activity', () => {
  it('counts today in Europe/Zurich, not in UTC', () => {
    // 22:30 UTC on 13 October is 00:30 on 14 October in Zurich (summer time).
    expect(mediaToday(new Date('2026-10-13T22:30:00Z'))).toBe('2026-10-14');
    expect(mediaToday(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
  });

  it('finds the day before across months and years', () => {
    expect(previousDay('2026-10-14')).toBe('2026-10-13');
    expect(previousDay('2026-10-01')).toBe('2026-09-30');
    expect(previousDay('2027-01-01')).toBe('2026-12-31');
    expect(previousDay('2028-03-01')).toBe('2028-02-29');
    expect(previousDay('garbage')).toBeNull();
  });

  it('reads today, yesterday, a date or never', () => {
    expect(activityDayKind('2026-10-14', '2026-10-14')).toBe('today');
    expect(activityDayKind('2026-10-13', '2026-10-14')).toBe('yesterday');
    expect(activityDayKind('2026-09-30', '2026-10-01')).toBe('yesterday');
    expect(activityDayKind('2026-10-12', '2026-10-14')).toBe('date');
    expect(activityDayKind(null, '2026-10-14')).toBe('never');
    expect(activityDayKind('2026-10-14T10:00', '2026-10-14')).toBe('never');
    // A clock a little ahead never makes a day in the future.
    expect(activityDayKind('2026-10-15', '2026-10-14')).toBe('today');
  });

  it('formats the day without a time and without shifting it', () => {
    expect(formatMediaDay('2026-10-11', 'en')).toBe('11 Oct 2026');
    expect(formatMediaDay('2026-01-01', 'de')).toMatch(/^1\. Jan\.? 2026$/);
    expect(activityDayText(t, 'de', '2026-10-13', '2026-10-14')).toBe('media.activity.yesterday');
    expect(activityDayText(t, 'de', null, '2026-10-14')).toBe('media.activity.never');
    expect(activityDayText(t, 'en', '2026-03-02', '2026-10-14')).toBe('2 Mar 2026');
  });
});

describe('allowance numbers', () => {
  it('counts own accounts without what a reseller handed out', () => {
    expect(ownMediaAccounts({ accounts: 12, customerAccounts: 10 })).toBe(2);
    expect(ownMediaAccounts({ accounts: 3, customerAccounts: 0 })).toBe(3);
  });

  it('is full once every account is taken', () => {
    expect(mediaAllowanceFull({ accounts: 5, maxAccounts: 5 })).toBe(true);
    expect(mediaAllowanceFull({ accounts: 6, maxAccounts: 5 })).toBe(true);
    expect(mediaAllowanceFull({ accounts: 4, maxAccounts: 5 })).toBe(false);
  });

  it('takes whole numbers from 1 only', () => {
    expect(parseCount('3')).toBe(3);
    expect(parseCount(' 12 ')).toBe(12);
    expect(parseCount('0')).toBeNull();
    expect(parseCount('1.5')).toBeNull();
    expect(parseCount('-1')).toBeNull();
    expect(parseCount('')).toBeNull();
  });
});

describe('bitrate choice', () => {
  it('maps a limit to the server setting, a preset or an own value', () => {
    expect(bitrateChoiceOf(null, MEDIA_BITRATE_PRESETS_MBIT)).toBe('server');
    expect(bitrateChoiceOf(8, MEDIA_BITRATE_PRESETS_MBIT)).toBe('8');
    expect(bitrateChoiceOf(20, MEDIA_BITRATE_PRESETS_MBIT)).toBe('custom');
  });

  it('reads the limit and refuses what a reseller cannot hand out', () => {
    expect(readBitrate('server', '')).toEqual({ value: null, issue: null });
    expect(readBitrate('8', '')).toEqual({ value: 8, issue: null });
    expect(readBitrate('custom', '20')).toEqual({ value: 20, issue: null });
    expect(readBitrate('custom', '0').issue).toBe('invalid');
    expect(readBitrate('custom', '1001').issue).toBe('invalid');
    expect(readBitrate('custom', 'x').issue).toBe('invalid');
    // A reseller with 20 Mbit/s: at most that, and never the server's own setting.
    expect(readBitrate('server', '', 20).issue).toBe('serverNotAllowed');
    expect(readBitrate('25', '', 20).issue).toBe('tooHigh');
    expect(readBitrate('15', '', 20)).toEqual({ value: 15, issue: null });
  });
});

describe('allowance form', () => {
  const pool: MediaAccessLimits = {
    libraryIds: ['847f61bc736e6f8ef0f5542f43496822', '9f0ef2e22ac1ffae415e6ddd9696b76d'],
    minAccounts: 1,
    maxAccounts: 4,
    maxStreams: 3,
    downloads: false,
    bitrateCap: 20,
  };

  it('starts from the current allowance', () => {
    const form = mediaAccessFormFrom(
      {
        maxAccounts: 3,
        libraries: [{ id: '847f61bc736e6f8ef0f5542f43496822', name: 'Filme', type: 'movies' }],
        maxStreams: 2,
        downloads: false,
        remoteBitrateMbit: 8,
      },
      { maxAccounts: 5, maxStreams: 2, remoteBitrateMbit: null },
    );
    expect(form).toEqual({
      maxAccounts: '3',
      libraryIds: ['847f61bc736e6f8ef0f5542f43496822'],
      maxStreams: '2',
      downloads: false,
      bitrate: '8',
      bitrateCustom: '8',
    });
  });

  it('builds the body within the limits', () => {
    const form = mediaAccessFormFrom(null, { maxAccounts: 2, maxStreams: 2, remoteBitrateMbit: 20 });
    expect(form.bitrate).toBe('custom');
    const { body, errors } = readMediaAccessForm(
      t,
      { ...form, libraryIds: ['9f0ef2e22ac1ffae415e6ddd9696b76d'] },
      pool,
    );
    expect(Object.values(errors).every((e) => e === null)).toBe(true);
    expect(body).toEqual({
      maxAccounts: 2,
      libraryIds: ['9f0ef2e22ac1ffae415e6ddd9696b76d'],
      maxStreams: 2,
      downloads: false,
      remoteBitrateMbit: 20,
    });
  });

  it("refuses what goes beyond a reseller's allowance", () => {
    const { body, errors } = readMediaAccessForm(
      t,
      {
        maxAccounts: '5',
        // A library the reseller does not have is dropped: none is left.
        libraryIds: ['d91225786a8ac15d78c0c1ea46a12d75'],
        maxStreams: '4',
        downloads: true,
        bitrate: 'server',
        bitrateCustom: '',
      },
      pool,
    );
    expect(body).toBeNull();
    expect(errors.maxAccounts).toBe('media.reseller.maxTooHigh {"n":4}');
    expect(errors.libraries).toBe('media.allowance.librariesNone');
    expect(errors.maxStreams).toBe('media.allowance.streamsInvalid {"max":3}');
    expect(errors.downloads).toBe('media.reseller.noDownloads');
    expect(errors.bitrate).toBe('media.reseller.bitrateRequired {"max":20}');
  });

  it('keeps the maximum at or above the accounts that exist', () => {
    const { errors } = readMediaAccessForm(
      t,
      {
        maxAccounts: '2',
        libraryIds: ['847f61bc736e6f8ef0f5542f43496822'],
        maxStreams: '1',
        downloads: false,
        bitrate: 'server',
        bitrateCustom: '',
      },
      { ...pool, minAccounts: 3, maxAccounts: null, bitrateCap: null, downloads: true },
    );
    expect(errors.maxAccounts).toBe('media.allowance.maxBelowAccounts {"n":3}');
    expect(errors.bitrate).toBeNull();
    const tooMany = readMediaAccessForm(
      t,
      {
        maxAccounts: String(MEDIA_MAX_ACCOUNTS + 1),
        libraryIds: ['847f61bc736e6f8ef0f5542f43496822'],
        maxStreams: '1',
        downloads: false,
        bitrate: 'server',
        bitrateCustom: '',
      },
      { ...pool, minAccounts: 0, maxAccounts: null, bitrateCap: null },
    );
    expect(tooMany.errors.maxAccounts).toBe(`media.allowance.maxTooHigh {"n":${MEDIA_MAX_ACCOUNTS}}`);
  });
});

describe('isMediaProvider', () => {
  it('takes Jellyfin and the demo without a flavor', () => {
    expect(isMediaProvider({ type: 'jellyfin' })).toBe(true);
    expect(isMediaProvider({ type: 'demo', summary: {} })).toBe(true);
    expect(isMediaProvider({ type: 'demo', summary: { flavor: 'cloudflare' } })).toBe(false);
    expect(isMediaProvider({ type: 'nextcloud' })).toBe(false);
  });
});

describe('connect a TV', () => {
  it('sends 6 digits as typed and complains only about what cannot become a code', () => {
    expect(quickConnectField('')).toEqual({ code: null, invalid: false });
    // Still typing: no error yet.
    expect(quickConnectField('123')).toEqual({ code: null, invalid: false });
    expect(quickConnectField('123 45')).toEqual({ code: null, invalid: false });
    expect(quickConnectField('123456')).toEqual({ code: '123456', invalid: false });
    expect(quickConnectField('123 456')).toEqual({ code: '123456', invalid: false });
    expect(quickConnectField('123-456')).toEqual({ code: '123456', invalid: false });
    for (const value of ['012345', '1234567', '12a', 'abc']) {
      expect(quickConnectField(value)).toEqual({ code: null, invalid: true });
    }
  });

  it('maps every refusal of the API to its text', () => {
    const refused = (code: string, status = 409, details?: unknown) =>
      new ApiError(status, code, 'x', details);
    expect(connectErrorKey(refused('quick_connect_code'))).toBe('media.connect.error.code');
    expect(connectErrorKey(refused('quick_connect_off'))).toBe('media.connect.error.off');
    expect(connectErrorKey(refused('quick_connect_failed'))).toBe('media.connect.error.failed');
    expect(connectErrorKey(refused('stream_limit'))).toBe('media.connect.error.limit');
    expect(connectErrorKey(refused('account_disabled'))).toBe('media.connect.error.disabled');
    expect(connectErrorKey(refused('rate_limited', 429))).toBe('media.connect.error.tooMany');
    // Errors with a message of their own (administrators, the instance failing, permissions).
    expect(connectErrorKey(refused('conflict'))).toBeNull();
    expect(connectErrorKey(refused('provider_error', 502))).toBeNull();
    expect(connectErrorKey(refused('quick_connect_code', 400))).toBeNull();
    expect(connectErrorKey(refused('forbidden', 403))).toBeNull();
    expect(connectErrorKey(new Error('network'))).toBeNull();
    expect(connectErrorKey(null)).toBeNull();

    expect(streamLimitOf(refused('stream_limit', 409, { maxStreams: 2, sessions: 2 }))).toBe(2);
    expect(streamLimitOf(refused('stream_limit', 409, {}))).toBeNull();
    expect(streamLimitOf(refused('conflict', 409, { maxStreams: 2 }))).toBeNull();
    expect(streamLimitOf(null)).toBeNull();
  });
});

describe('requests add-on form', () => {
  const access = (patch: Partial<MediaRequestsAccess> = {}): MediaRequestsAccess => ({
    movies: true,
    tv: true,
    movieQuota: { limit: 5, days: 30 },
    tvQuota: { limit: 3, days: 30 },
    ...patch,
  });
  const form = (patch: Partial<MediaRequestsForm> = {}): MediaRequestsForm => ({
    ...mediaRequestsFormFrom(access()),
    ...patch,
  });

  it('starts off with the suggestion of 5 movies and 3 seasons in 30 days', () => {
    expect(mediaRequestsFormFrom(null)).toEqual({
      on: false,
      movies: true,
      tv: true,
      movieLimited: true,
      movieLimit: '5',
      movieDays: '30',
      tvLimited: true,
      tvLimit: '3',
      tvDays: '30',
    });
    // Off sends null: no requests is the add-on off, never a limit of 0.
    expect(readMediaRequestsForm(t, mediaRequestsFormFrom(null))).toEqual({
      value: null,
      valid: true,
      errors: expect.objectContaining({ types: null, movies: null, tv: null }),
      conflicts: [],
    });
  });

  it('gives a stored add-on back unchanged', () => {
    for (const value of [
      access(),
      access({ tv: false, tvQuota: null }),
      access({ movies: false, movieQuota: null, tvQuota: null }),
      access({ movieQuota: null, tvQuota: { limit: 100, days: 365 } }),
    ]) {
      const read = readMediaRequestsForm(t, mediaRequestsFormFrom(value));
      expect(read.valid).toBe(true);
      expect(read.value).toEqual(value);
    }
  });

  it('keeps a number in the inputs of a type without a limit, for when one is chosen', () => {
    const f = mediaRequestsFormFrom(access({ movieQuota: null }));
    expect(f.movieLimited).toBe(false);
    expect(f.movieLimit).toBe('5');
    // A type that is off starts from the defaults (here a reseller's own add-on) once switched on.
    const reseller = access({ movieQuota: { limit: 10, days: 30 }, tvQuota: { limit: 6, days: 14 } });
    const g = mediaRequestsFormFrom(access({ tv: false, tvQuota: null }), reseller);
    expect([g.tv, g.tvLimited, g.tvLimit, g.tvDays]).toEqual([false, true, '6', '14']);
    expect(mediaRequestsFormFrom(null, reseller).movieLimit).toBe('10');
  });

  it('needs movies, series or both while it is on', () => {
    const read = readMediaRequestsForm(t, form({ movies: false, tv: false }));
    expect(read.valid).toBe(false);
    expect(read.value).toBeNull();
    expect(read.errors.types).toBe('media.requests.typeRequired');
  });

  it('takes limits from 1 to 100 and windows from 1 to 365 days', () => {
    for (const limit of ['0', '101', '1.5', '-1', '', 'x']) {
      const read = readMediaRequestsForm(t, form({ movieLimit: limit }));
      expect(read.valid).toBe(false);
      expect(read.errors.movieLimit).toBe('media.requests.quotaInvalid {"max":100}');
    }
    for (const days of ['0', '366', '']) {
      const read = readMediaRequestsForm(t, form({ tvDays: days }));
      expect(read.valid).toBe(false);
      expect(read.errors.tvDays).toBe('media.requests.daysInvalid {"max":365}');
    }
    const edge = readMediaRequestsForm(
      t,
      form({ movieLimit: '100', movieDays: '365', tvLimit: '1', tvDays: '1' }),
    );
    expect(edge.value).toEqual(
      access({ movieQuota: { limit: 100, days: 365 }, tvQuota: { limit: 1, days: 1 } }),
    );
  });

  it('sends no limit as null and ignores the inputs of a type that is off', () => {
    const unlimited = readMediaRequestsForm(t, form({ movieLimited: false, movieLimit: 'garbage' }));
    expect(unlimited.value).toEqual(access({ movieQuota: null }));
    const off = readMediaRequestsForm(t, form({ tv: false, tvLimit: '0', tvDays: '0' }));
    expect(off.valid).toBe(true);
    expect(off.value).toEqual(access({ tv: false, tvQuota: null }));
  });

  it("keeps a reseller's customer within the reseller's own add-on", () => {
    const cap = access({ tv: false, tvQuota: null, movieQuota: { limit: 10, days: 30 } });
    const within = readMediaRequestsForm(t, form({ tv: false, movieLimit: '10', movieDays: '30' }), cap);
    expect(within.valid).toBe(true);
    expect(within.value).toEqual(access({ tv: false, tvQuota: null, movieQuota: { limit: 10, days: 30 } }));
    // A longer window allows less, so it fits.
    expect(readMediaRequestsForm(t, form({ tv: false, movieLimit: '10', movieDays: '60' }), cap).valid).toBe(
      true,
    );

    for (const patch of [
      { movieLimit: '11', movieDays: '30' },
      { movieLimit: '10', movieDays: '7' },
      // No limit under a reseller with a limit.
      { movieLimited: false },
    ]) {
      const read = readMediaRequestsForm(t, form({ tv: false, ...patch }), cap);
      expect(read.valid).toBe(false);
      expect(read.value).toBeNull();
      expect(read.conflicts).toEqual(['movieQuota']);
      expect(read.errors.movies).toBe('media.reseller.requestsCap');
      expect(read.errors.tv).toBeNull();
    }
    // Series the reseller does not have.
    const tv = readMediaRequestsForm(t, form({ movieLimit: '10' }), cap);
    expect(tv.conflicts).toEqual(['requestsTv']);
    expect(tv.errors.tv).toBe('media.reseller.requestsCap');
    // A reseller without the add-on has nothing to hand on; off is always fine.
    expect(readMediaRequestsForm(t, form(), null).conflicts).toEqual(['requestsMovies', 'requestsTv']);
    expect(readMediaRequestsForm(t, form({ on: false }), null).valid).toBe(true);
    // Staff have no cap.
    expect(readMediaRequestsForm(t, form({ movieLimit: '100' })).valid).toBe(true);
  });

  it('suggests the shared defaults', () => {
    expect(mediaRequestsFormFrom(null).movieLimit).toBe(String(MEDIA_REQUESTS_DEFAULT.movieQuota!.limit));
  });
});

describe('requests texts', () => {
  const both: MediaRequestsAccess = {
    movies: true,
    tv: true,
    movieQuota: { limit: 5, days: 30 },
    tvQuota: null,
  };

  it('says what each type includes', () => {
    expect(requestTypeText(t, 'movies', both)).toBe('media.requests.movieQuota {"limit":5,"days":30}');
    expect(requestTypeText(t, 'tv', both)).toBe('media.requests.unlimited');
    expect(requestTypeText(t, 'tv', { ...both, tv: false })).toBe('media.requests.notIncluded');
    expect(requestTypeText(t, 'tv', { ...both, tvQuota: { limit: 3, days: 14 } })).toBe(
      'media.requests.tvQuota {"limit":3,"days":14}',
    );
    expect(requestTypeText(t, 'movies', null)).toBe('media.requests.notIncluded');
  });

  it('names the types', () => {
    expect(requestTypesText(t, both)).toBe('media.requests.figureBoth');
    expect(requestTypesText(t, { ...both, tv: false })).toBe('media.requests.movies');
    expect(requestTypesText(t, { ...both, movies: false })).toBe('media.requests.tv');
  });

  it('shows the quota used per type with a limit, and a dash before the sync read it', () => {
    const counts = { pending: 1, approved: 1, available: 2, movieUsed: 2, tvUsed: 4 };
    const limited = { ...both, tvQuota: { limit: 3, days: 30 } };
    expect(requestQuotaUsage(t, limited, counts)).toEqual([
      'media.requests.quotaMovies {"used":2,"limit":5}',
      'media.requests.quotaSeasons {"used":4,"limit":3}',
    ]);
    expect(requestQuotaUsage(t, limited, null)).toEqual([
      'media.requests.quotaMovies {"used":"–","limit":5}',
      'media.requests.quotaSeasons {"used":"–","limit":3}',
    ]);
    expect(requestQuotaUsage(t, both, { ...counts, tvUsed: null })).toEqual([
      'media.requests.quotaMovies {"used":2,"limit":5}',
    ]);
    // A quota of a type that is off counts for nothing.
    expect(requestQuotaUsage(t, { ...limited, movies: false }, counts)).toEqual([
      'media.requests.quotaSeasons {"used":4,"limit":3}',
    ]);
    expect(requestQuotaUsage(t, { ...both, movieQuota: null }, counts)).toEqual([]);
  });
});

describe('Seerr of an instance (admin)', () => {
  const check = (patch: Partial<MediaSeerrCheck> = {}): MediaSeerrCheck => ({
    version: '3.5.1',
    sameServer: true,
    newSignIns: false,
    defaultPermissions: 0,
    mediaServerLogin: true,
    localLogin: true,
    csrfProtection: false,
    unmanagedRequesters: 0,
    orphans: 0,
    problems: [],
    ...patch,
  });
  const states = (c: MediaSeerrCheck | null) => seerrCheckItems(c).map((i) => i.state);

  it('badges no Seerr, off and the check state while on', () => {
    expect(seerrBadge(null)).toEqual({ tone: 'neutral', key: 'media.seerr.none' });
    const seerr = { url: 'https://requests.example.com', enabled: false, organizationsWithRequests: 0 };
    // Off stays off whatever the last check said.
    expect(seerrBadge({ ...seerr, status: 'error' }).key).toBe('media.seerr.status.off');
    expect(seerrBadge({ ...seerr, enabled: true, status: 'ok' })).toEqual({
      tone: 'success',
      key: 'media.seerr.status.ok',
    });
    expect(seerrBadge({ ...seerr, enabled: true, status: 'unsafe' }).tone).toBe('warning');
    expect(seerrBadge({ ...seerr, enabled: true, status: 'error' }).tone).toBe('danger');
    expect(seerrBadge({ ...seerr, enabled: true, status: 'unknown' }).key).toBe('media.seerr.status.unknown');
  });

  it('lists every step of the check, unknown where it was never asked', () => {
    expect(seerrCheckItems(check()).map((i) => i.key)).toEqual([
      'media.seerr.check.reachable',
      'media.seerr.check.key',
      'media.seerr.check.sameServer',
      'media.seerr.check.newSignIns',
      'media.seerr.check.defaultPermissions',
      'media.seerr.check.mediaServerLogin',
      'media.seerr.check.csrf',
    ]);
    expect(states(check())).toEqual(Array(7).fill('ok'));
    expect(states(null)).toEqual(Array(7).fill('unknown'));
    const unreachable = check({
      problems: ['unreachable'],
      sameServer: null,
      newSignIns: null,
      defaultPermissions: null,
      mediaServerLogin: null,
      csrfProtection: null,
    });
    expect(states(unreachable)).toEqual(['fail', ...Array(6).fill('unknown')]);
    // A rejected key: reached, but nothing behind the key was read (even if values came along).
    expect(states(check({ problems: ['key'] }))).toEqual(['ok', 'fail', ...Array(5).fill('unknown')]);
  });

  it('marks each problem at its step', () => {
    expect(states(check({ problems: ['other_server'], sameServer: false }))[2]).toBe('fail');
    expect(states(check({ problems: ['not_jellyfin'] }))[2]).toBe('fail');
    expect(states(check({ problems: ['new_signins'], newSignIns: true }))[3]).toBe('fail');
    expect(states(check({ problems: ['default_permissions'], defaultPermissions: 32 }))[4]).toBe('fail');
    expect(states(check({ problems: ['media_server_login'], mediaServerLogin: false }))[5]).toBe('fail');
    expect(states(check({ problems: ['csrf'], csrfProtection: true }))[6]).toBe('fail');
    // A value that is not the safe one never counts as passed.
    expect(states(check({ defaultPermissions: 32 }))[4]).toBe('unknown');
  });

  it('offers the recommended settings only when nothing else is wrong', () => {
    expect(seerrOnlyFixable(check({ problems: ['new_signins', 'default_permissions'] }))).toBe(true);
    expect(seerrOnlyFixable(check({ problems: ['media_server_login'] }))).toBe(true);
    expect(seerrOnlyFixable(check({ problems: ['new_signins', 'csrf'] }))).toBe(false);
    expect(seerrOnlyFixable(check({ problems: ['other_server', 'default_permissions'] }))).toBe(false);
    expect(seerrOnlyFixable(check())).toBe(false);
    expect(seerrOnlyFixable(null)).toBe(false);
  });

  it('switches on only after a check without problems', () => {
    expect(seerrCanSwitchOn({ check: check() })).toBe(true);
    expect(seerrCanSwitchOn({ check: check({ problems: ['new_signins'] }) })).toBe(false);
    expect(seerrCanSwitchOn({ check: null })).toBe(false);
  });
});
