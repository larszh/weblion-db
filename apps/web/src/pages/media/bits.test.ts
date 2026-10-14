import { describe, expect, it } from 'vitest';
import { MEDIA_BITRATE_PRESETS_MBIT, MEDIA_MAX_ACCOUNTS, type MediaAccountIssue } from '@weblion/shared';
import type { TFunction } from '@/lib/i18n';
import { isMediaProvider } from '@/pages/admin/media';
import {
  activityDayKind,
  activityDayText,
  bitrateChoiceOf,
  formatBitrate,
  formatMediaDay,
  groupPassword,
  mediaAllowanceFull,
  mediaStatus,
  mediaToday,
  ownMediaAccounts,
  parseCount,
  previousDay,
  readBitrate,
  usernamePreview,
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
