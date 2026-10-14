import { expectedMediaPolicy, type MediaPolicyState, type MediaSyncPlayAccess } from '@weblion/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError, ProviderError } from '../src/lib/errors';
import { JellyfinAdapter } from '../src/providers/jellyfin/adapter';
import { JellyfinClient, PROVIDER } from '../src/providers/jellyfin/client';
import {
  applyPolicyState,
  describeJellyfinError,
  parseActivity,
  parseJellyfinDate,
  parseJellyfinUser,
  parseLibraries,
  parsePolicyState,
  parseServerInfo,
  redactJellyfin,
  versionAtLeast,
} from '../src/providers/jellyfin/parse';
import { JELLYFIN_ADMIN_REFUSED } from '../src/providers/jellyfin/rules';
import type { JellyfinConfig } from '../src/providers/types';
import {
  AUTH_PROVIDER,
  MOCK_API_KEY,
  MOCK_LISTED_KEY,
  MOCK_PLAYING_TITLE,
  MOCK_SERVER_ID,
  RESET_PROVIDER,
  defaultPolicy,
  mockUser,
  startJellyfinMock,
  type JellyfinMock,
  type MockJellyfinOptions,
  type MockJellyfinRequest,
  type MockJellyfinUser,
} from './jellyfin-mock';

const PASSWORD = 'kemaro-sonne-2026';
const FILME = 'f137a2dd21bbc1b99aa5c0f6bf02a805';
const SERIEN = 'a656b907eb3a73532e40e44b968d0225';
const MUSIK = '7e64e319657a9516ec78490da03edccb';
const ADMIN_ID = '84bb1f65fce351e5962eb84c1645fa51';
const ANNA_ID = '3bc712a422452aa61a2816cf217e3788';
const BEN_ID = '97a3a6596b22bcba752af2adb4acce60';
const UNKNOWN_ID = 'e105e849dc773e5b1a8814f45bc8d0b6';

/** What muster-ag's allowance gives every account. */
const MUSTER = expectedMediaPolicy({
  libraryIds: [SERIEN, FILME],
  maxStreams: 2,
  downloads: false,
  remoteBitrateMbit: 8,
});

function dashed(id: string): string {
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`.toUpperCase();
}

async function caught(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return err as AppError;
  }
  throw new Error('expected an error');
}

// ---------------------------------------------------------------------------
// Parse (pure)

describe('Jellyfin parse', () => {
  it('reads Jellyfin dates: 7 fractional digits, with or without offset, MinValue as never', () => {
    expect(parseJellyfinDate('2026-10-11T08:15:30.1234567Z')).toBe('2026-10-11T08:15:30.123Z');
    expect(parseJellyfinDate('2026-10-11T08:15:30.1234567')).toBe('2026-10-11T08:15:30.123Z');
    expect(parseJellyfinDate('2026-10-11T08:15:30.0000000Z')).toBe('2026-10-11T08:15:30.000Z');
    expect(parseJellyfinDate('2026-10-11T08:15:30Z')).toBe('2026-10-11T08:15:30.000Z');
    expect(parseJellyfinDate('2026-10-11T10:15:30.5+02:00')).toBe('2026-10-11T08:15:30.500Z');
    expect(parseJellyfinDate('0001-01-01T00:00:00.0000000Z')).toBeNull();
    expect(parseJellyfinDate('0001-01-01T00:00:00')).toBeNull();
    expect(parseJellyfinDate('gestern')).toBeNull();
    expect(parseJellyfinDate('2026-13-45T08:15:30Z')).toBeNull();
    expect(parseJellyfinDate('')).toBeNull();
    expect(parseJellyfinDate(undefined)).toBeNull();
    expect(parseJellyfinDate(null)).toBeNull();
    expect(parseJellyfinDate(1760170530)).toBeNull();
  });

  it('turns dashed and upper-case ids of answers into 32 lower-case hex characters', () => {
    const user = parseJellyfinUser({
      Id: dashed(ANNA_ID),
      Name: 'anna-kemaro',
      Policy: { EnabledFolders: [dashed(SERIEN), FILME.toUpperCase(), 'not-an-id', FILME] },
    });
    expect(user?.externalId).toBe(ANNA_ID);
    expect(user?.policy.libraryIds).toEqual([SERIEN, FILME].sort());
    expect(parseLibraries([{ ItemId: dashed(FILME), Name: 'Filme' }])[0]?.id).toBe(FILME);
    expect(parseServerInfo({ Id: dashed(MOCK_SERVER_ID) }).serverId).toBe(MOCK_SERVER_ID);
  });

  it('maps a full UserDto and never reads more than the console needs', () => {
    const raw = {
      Name: 'anna-kemaro',
      ServerId: MOCK_SERVER_ID,
      Id: ANNA_ID,
      PrimaryImageTag: 'a1b2c3',
      HasPassword: true,
      HasConfiguredPassword: true,
      HasConfiguredEasyPassword: false,
      EnableAutoLogin: false,
      LastLoginDate: '2026-10-10T19:02:11.4870000Z',
      LastActivityDate: '2026-10-11T21:14:00.0000000Z',
      Configuration: { AudioLanguagePreference: 'deu', OrderedViews: [FILME] },
      Policy: applyPolicyState(defaultPolicy(), MUSTER),
    };
    expect(parseJellyfinUser(raw)).toEqual({
      externalId: ANNA_ID,
      username: 'anna-kemaro',
      enabled: true,
      administrator: false,
      hasPassword: true,
      lockedOut: false,
      blockedFolders: false,
      lastLoginAt: '2026-10-10T19:02:11.487Z',
      lastActivityAt: '2026-10-11T21:14:00.000Z',
      policy: MUSTER,
    });
  });

  it('maps users who never signed in, locked out, blocked, administrators and missing policies', () => {
    const never = parseJellyfinUser({
      Id: BEN_ID,
      Name: 'ben-kemaro',
      HasPassword: false,
      Policy: defaultPolicy(),
    });
    expect(never).toMatchObject({ hasPassword: false, lastLoginAt: null, lastActivityAt: null });

    const policy = (extra: Record<string, unknown>) => ({
      Id: BEN_ID,
      Name: 'ben',
      Policy: { ...defaultPolicy(), ...extra },
    });
    const locked = parseJellyfinUser(
      policy({ IsDisabled: true, LoginAttemptsBeforeLockout: 3, InvalidLoginAttemptCount: 3 }),
    );
    expect(locked).toMatchObject({ enabled: false, lockedOut: true });
    // Disabled by staff, below the limit, without a limit, or enabled again with old failures.
    expect(
      parseJellyfinUser(
        policy({ IsDisabled: true, LoginAttemptsBeforeLockout: 3, InvalidLoginAttemptCount: 2 }),
      )?.lockedOut,
    ).toBe(false);
    expect(
      parseJellyfinUser(
        policy({ IsDisabled: true, LoginAttemptsBeforeLockout: -1, InvalidLoginAttemptCount: 9 }),
      )?.lockedOut,
    ).toBe(false);
    expect(
      parseJellyfinUser(
        policy({ IsDisabled: false, LoginAttemptsBeforeLockout: 3, InvalidLoginAttemptCount: 3 }),
      )?.lockedOut,
    ).toBe(false);

    expect(parseJellyfinUser(policy({ BlockedMediaFolders: [FILME] }))?.blockedFolders).toBe(true);
    expect(parseJellyfinUser(policy({ BlockedMediaFolders: [] }))?.blockedFolders).toBe(false);
    const admin = parseJellyfinUser(policy({ IsAdministrator: true }));
    expect(admin).toMatchObject({ administrator: true });
    expect(admin?.policy.administrator).toBe(true);

    // No Policy: Jellyfin's defaults, so everything the console owns shows up as drift.
    const bare = parseJellyfinUser({ Id: BEN_ID, Name: 'ben' });
    expect(bare).toMatchObject({
      enabled: true,
      administrator: false,
      lockedOut: false,
      blockedFolders: false,
    });
    expect(bare?.policy).toEqual(parsePolicyState({}));

    expect(parseJellyfinUser({ Id: 'abc', Name: 'ben' })).toBeNull();
    expect(parseJellyfinUser({ Id: '0'.repeat(32), Name: 'ben' })).toBeNull();
    expect(parseJellyfinUser({ Id: BEN_ID, Name: '' })).toBeNull();
    expect(parseJellyfinUser({ Id: BEN_ID })).toBeNull();
    expect(parseJellyfinUser('ben')).toBeNull();
    expect(parseJellyfinUser([{ Id: BEN_ID, Name: 'ben' }])).toBeNull();
  });

  it('reads missing policy keys as the UserPolicy defaults and combines the composite fields', () => {
    expect(parsePolicyState({})).toEqual({
      administrator: false,
      hidden: true,
      remoteAccess: true,
      allLibraries: true,
      libraryIds: [],
      maxSessions: 0,
      downloads: true,
      conversion: true,
      remoteBitrateBps: 0,
      contentDeletion: false,
      remoteControlOthers: false,
      sharedDeviceControl: true,
      liveTv: true,
      metadataManagement: false,
      publicSharing: true,
      channels: true,
      syncPlay: 'CreateAndJoinGroups',
    });
    const off = applyPolicyState(defaultPolicy(), MUSTER);
    expect(parsePolicyState({ ...off, EnableContentDeletionFromFolders: [FILME] }).contentDeletion).toBe(
      true,
    );
    expect(parsePolicyState({ ...off, EnableLiveTvManagement: true }).liveTv).toBe(true);
    expect(parsePolicyState({ ...off, EnabledChannels: ['5d2c1fbb0e6d4a0b9c3f1e2d3c4b5a69'] }).channels).toBe(
      true,
    );
    expect(parsePolicyState({ ...off, EnableMediaConversion: true }).conversion).toBe(true);
    expect(parsePolicyState({ ...off, EnableLyricManagement: true }).metadataManagement).toBe(true);
    expect(parsePolicyState({ ...off, MaxActiveSessions: '3' }).maxSessions).toBe(3);
    expect(parsePolicyState({ ...off, SyncPlayAccess: 'JoinGroups' }).syncPlay).toBe('JoinGroups');
    expect(parsePolicyState({ ...off, SyncPlayAccess: 2 }).syncPlay).toBe('None');
    // An enum value this code does not know reads as Jellyfin's default, so it shows as drift.
    expect(parsePolicyState({ ...off, SyncPlayAccess: 'Everything' }).syncPlay).toBe('CreateAndJoinGroups');
    expect(parsePolicyState(off)).toEqual(MUSTER);
  });

  it('writes the managed policy keys and keeps every other key', () => {
    const input = {
      ...defaultPolicy(),
      MaxParentalRating: 16,
      MaxParentalSubRating: 12,
      AccessSchedules: [{ DayOfWeek: 'Sunday', StartHour: 8, EndHour: 20 }],
      IsDisabled: true,
      InvalidLoginAttemptCount: 2,
      LoginAttemptsBeforeLockout: 3,
      BlockedMediaFolders: [MUSIK],
      EnableContentDeletion: true,
      EnableContentDeletionFromFolders: [FILME],
      EnabledChannels: ['5d2c1fbb0e6d4a0b9c3f1e2d3c4b5a69'],
      EnableLiveTvManagement: true,
      EnableCollectionManagement: true,
      FutureField: 7,
    };
    const frozen = structuredClone(input);
    const out = applyPolicyState(input, MUSTER);
    expect(input).toEqual(frozen);
    expect(out).toEqual({
      ...input,
      IsAdministrator: false,
      IsHidden: true,
      EnableRemoteAccess: true,
      EnableAllFolders: false,
      EnabledFolders: [FILME, SERIEN].sort(),
      MaxActiveSessions: 2,
      EnableContentDownloading: false,
      EnableSyncTranscoding: false,
      EnableMediaConversion: false,
      RemoteClientBitrateLimit: 8_000_000,
      EnableContentDeletion: false,
      EnableContentDeletionFromFolders: [],
      EnableRemoteControlOfOtherUsers: false,
      EnableSharedDeviceControl: false,
      EnableLiveTvAccess: false,
      EnableLiveTvManagement: false,
      EnableCollectionManagement: false,
      EnableSubtitleManagement: false,
      EnableLyricManagement: false,
      EnablePublicSharing: false,
      EnableAllChannels: false,
      EnabledChannels: [],
      SyncPlayAccess: 'None',
    });
    expect(out).toMatchObject({
      MaxParentalSubRating: 12,
      AuthenticationProviderId: AUTH_PROVIDER,
      PasswordResetProviderId: RESET_PROVIDER,
      AccessSchedules: input.AccessSchedules,
      IsDisabled: true,
      InvalidLoginAttemptCount: 2,
      LoginAttemptsBeforeLockout: 3,
      BlockedMediaFolders: [MUSIK],
      FutureField: 7,
    });
    // Allowed deletion and channels keep their lists.
    const open = applyPolicyState(input, { ...MUSTER, contentDeletion: true, channels: true });
    expect(open.EnableContentDeletionFromFolders).toEqual([FILME]);
    expect(open.EnabledChannels).toEqual(['5d2c1fbb0e6d4a0b9c3f1e2d3c4b5a69']);
  });

  it('reads back exactly what it wrote, for random states', () => {
    let seed = 20261011;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const bool = () => random() < 0.5;
    const hex = () =>
      Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(random() * 16)]).join('');
    const syncPlay: MediaSyncPlayAccess[] = ['CreateAndJoinGroups', 'JoinGroups', 'None'];
    for (let i = 0; i < 200; i++) {
      const state: MediaPolicyState = {
        administrator: bool(),
        hidden: bool(),
        remoteAccess: bool(),
        allLibraries: bool(),
        libraryIds: [...new Set(Array.from({ length: Math.floor(random() * 4) }, hex))].sort(),
        maxSessions: Math.floor(random() * 21),
        downloads: bool(),
        conversion: bool(),
        remoteBitrateBps: Math.floor(random() * 40) * 1_000_000,
        contentDeletion: bool(),
        remoteControlOthers: bool(),
        sharedDeviceControl: bool(),
        liveTv: bool(),
        metadataManagement: bool(),
        publicSharing: bool(),
        channels: bool(),
        syncPlay: syncPlay[Math.floor(random() * 3)]!,
      };
      const base = bool()
        ? defaultPolicy()
        : { ...defaultPolicy(), EnableContentDeletionFromFolders: [FILME], EnabledChannels: [hex()] };
      expect(parsePolicyState(applyPolicyState(base, state))).toEqual(state);
    }
  });

  it('lists libraries with an id only, sorted by name, without reading their paths', () => {
    const scanned = (ItemId: string | null, Name: string, CollectionType?: string) => {
      const entry: Record<string, unknown> = { Name, ItemId, CollectionType, RefreshStatus: 'Idle' };
      Object.defineProperty(entry, 'Locations', {
        enumerable: true,
        get() {
          throw new Error('Locations are server paths and must not be read');
        },
      });
      return entry;
    };
    expect(
      parseLibraries([
        scanned(SERIEN, 'Zeichentrick', 'tvshows'),
        scanned(null, 'Neu hinzugefügt', 'movies'),
        scanned(MUSIK, 'Hörbücher', 'audiobooks'),
        scanned(FILME, 'Ältere Filme', 'Movies'),
        scanned('5d2c1fbb0e6d4a0b9c3f1e2d3c4b5a69', 'Gemischt'),
        { ItemId: '0d3f1c2b4a5968778695a4b3c2d1e0f9', Name: '' },
        'garbage',
      ]),
    ).toEqual([
      { id: FILME, name: 'Ältere Filme', type: 'movies' },
      { id: '5d2c1fbb0e6d4a0b9c3f1e2d3c4b5a69', name: 'Gemischt', type: null },
      { id: MUSIK, name: 'Hörbücher', type: null },
      { id: SERIEN, name: 'Zeichentrick', type: 'tvshows' },
    ]);
    expect(parseLibraries({ Items: [] })).toEqual([]);
  });

  it('reduces sessions to two numbers and nothing else', () => {
    const activity = parseActivity(mock.state.sessions);
    // The third session has no user (Guid.Empty): a device that has not signed in.
    expect(activity).toEqual({ activeSessions: 2, playing: 1 });
    const json = JSON.stringify(activity);
    for (const leak of [MOCK_PLAYING_TITLE, 'anna-kemaro', 'Wohnzimmer TV', '203.0.113.7', ANNA_ID]) {
      expect(json).not.toContain(leak);
    }
    expect(parseActivity('nope')).toEqual({ activeSessions: 0, playing: 0 });
  });

  it('describes every error shape Jellyfin answers with', () => {
    expect(
      describeJellyfinError(
        { status: 404, body: { title: 'Not Found', status: 404, traceId: 'x' } },
        'delete user x',
      ),
    ).toBe('delete user x failed: Not Found (HTTP 404)');
    expect(
      describeJellyfinError(
        {
          status: 400,
          body: {
            title: 'One or more validation errors occurred.',
            status: 400,
            errors: { AuthenticationProviderId: ['The AuthenticationProviderId field is required.'] },
          },
        },
        'set the access of anna-kemaro',
      ),
    ).toBe(
      'set the access of anna-kemaro failed: One or more validation errors occurred: ' +
        'The AuthenticationProviderId field is required. (HTTP 400)',
    );
    expect(describeJellyfinError({ status: 404, body: 'User not found' }, 'read user x')).toBe(
      'read user x failed: User not found (HTTP 404)',
    );
    // A 403 with a reason needs no guessing.
    expect(
      describeJellyfinError({ status: 403, body: 'Administrators cannot be disabled.' }, 'disable x'),
    ).toBe('disable x failed: Administrators cannot be disabled. (HTTP 403)');
    expect(describeJellyfinError({ status: 502, body: 'upstream connect error' })).toBe(
      'upstream connect error (HTTP 502)',
    );
    expect(describeJellyfinError({ status: 502, body: '<html><body>Bad Gateway</body></html>' })).toBe(
      'refused without a reason (HTTP 502)',
    );
    expect(describeJellyfinError({ status: 500, body: 'x'.repeat(500) })).toBe(
      `${'x'.repeat(200)} (HTTP 500)`,
    );
    expect(
      describeJellyfinError({ status: 400, body: 'Error processing request.' }, 'create user anna'),
    ).toBe(
      'create user anna failed: refused without a reason (HTTP 400). Jellyfin does not tell why (check the server log)',
    );
    expect(describeJellyfinError({ status: 401, body: null }, 'list users')).toBe(
      'list users failed: refused without a reason (HTTP 401). The API key was rejected: create a new one in Dashboard > API Keys',
    );
    expect(describeJellyfinError({ status: 403, body: null })).toBe(
      "refused without a reason (HTTP 403). The key is not allowed to do this, or remote access to the server is off for the console's address",
    );
    expect(describeJellyfinError({ status: 302, body: null }, 'read the server info')).toBe(
      "read the server info failed: redirect (HTTP 302). The server redirects: check the base URL (https, Jellyfin's base URL path)",
    );
    expect(describeJellyfinError({ status: 503, body: '' })).toBe(
      'refused without a reason (HTTP 503). The server is starting or under maintenance',
    );
  });

  it('blanks tokens, keys, passwords and PINs at any depth', () => {
    expect(
      redactJellyfin({
        AccessToken: 'device-token',
        HasPassword: true,
        User: { Name: 'anna', Password: 'pw', Policy: { IsHidden: true } },
        Items: [
          { NewPw: 'n', CurrentPw: 'c', Pin: '1234', Nested: [{ api_key: 'k', ApiKey: 'k2', Token: null }] },
        ],
      }),
    ).toEqual({
      AccessToken: '••••••',
      HasPassword: true,
      User: { Name: 'anna', Password: '••••••', Policy: { IsHidden: true } },
      Items: [
        {
          NewPw: '••••••',
          CurrentPw: '••••••',
          Pin: '••••••',
          Nested: [{ api_key: '••••••', ApiKey: '••••••', Token: null }],
        },
      ],
    });
    expect(redactJellyfin('plain')).toBe('plain');
  });

  it('compares versions', () => {
    expect(versionAtLeast('10.11.11', '10.10.0')).toBe(true);
    expect(versionAtLeast('10.10.0', '10.10.0')).toBe(true);
    expect(versionAtLeast('10.10', '10.10.0')).toBe(true);
    expect(versionAtLeast('10.10.7-rc1', '10.10.0')).toBe(true);
    expect(versionAtLeast('11.0.0', '10.10.0')).toBe(true);
    expect(versionAtLeast('10.9.11', '10.10.0')).toBe(false);
    expect(versionAtLeast('9.12.0', '10.10.0')).toBe(false);
    expect(versionAtLeast(null, '10.10.0')).toBe(false);
    expect(versionAtLeast('unknown', '10.10.0')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Client and adapter against the mock server

let mock: JellyfinMock;

async function start(options: MockJellyfinOptions = {}) {
  await mock?.close();
  mock = await startJellyfinMock(options);
  return mock;
}

beforeEach(async () => {
  mock = await startJellyfinMock();
});

afterEach(async () => {
  await mock.close();
});

function config(overrides: Partial<JellyfinConfig> = {}): JellyfinConfig {
  return { baseUrl: mock.url, apiKey: MOCK_API_KEY, ...overrides };
}

const adapter = (overrides: Partial<JellyfinConfig> = {}, options = {}) =>
  new JellyfinAdapter(config(overrides), options);

function add(user: MockJellyfinUser): MockJellyfinUser {
  mock.state.users.set(user.id, user);
  return user;
}

/** "GET /Users/<id>" lines of the recorded requests. */
const lines = (requests: MockJellyfinRequest[] = mock.requests) =>
  requests.map((r) => `${r.method} ${r.path}`);

describe('Jellyfin client', () => {
  it('authenticates with the Authorization header only, also without legacy authorization', async () => {
    await start({ legacyAuthorization: false });
    const anna = add(mockUser('anna-kemaro', { id: ANNA_ID }));
    const a = adapter();
    await a.testConnection();
    await a.setMediaUserPolicy(anna.id, MUSTER);
    await a.createMediaUser({ username: 'ben-kemaro', password: PASSWORD, policy: MUSTER });
    expect(mock.requests.length).toBeGreaterThan(6);
    for (const req of mock.requests) {
      expect(req.headers.authorization).toBe(`MediaBrowser Token="${MOCK_API_KEY}"`);
      expect(req.headers.accept).toBe('application/json');
      for (const header of ['x-emby-token', 'x-mediabrowser-token', 'x-emby-authorization']) {
        expect(req.headers[header]).toBeUndefined();
      }
      expect([...req.query.keys()].map((k) => k.toLowerCase())).not.toContain('api_key');
      expect([...req.query.keys()].map((k) => k.toLowerCase())).not.toContain('apikey');
      expect(`${req.path}?${req.query}`).not.toContain(MOCK_API_KEY);
    }
    const writes = mock.requests.filter((r) => r.method === 'POST');
    expect(writes.every((r) => r.headers['content-type'] === 'application/json')).toBe(true);
  });

  it('mimics the legacy switch of the server (mock check)', async () => {
    const legacy = async (on: boolean) => {
      await start({ legacyAuthorization: on });
      const res = await fetch(`${mock.url}/Users`, { headers: { 'X-Emby-Token': MOCK_API_KEY } });
      return res.status;
    };
    expect(await legacy(true)).toBe(200);
    expect(await legacy(false)).toBe(401);
  });

  it('works below a base path and never follows a redirect', async () => {
    await start({ basePath: '/jellyfin' });
    expect(mock.url).toMatch(/\/jellyfin$/);
    const a = adapter();
    expect((await a.testConnection()).version).toBe('10.11.11');
    expect(mock.requests.every((r) => r.path.startsWith('/jellyfin/'))).toBe(true);
    expect(a.mediaLoginUrl()).toBe(mock.url);

    mock.requests.length = 0;
    const outside = adapter({ baseUrl: `${mock.origin}/` });
    const err = await caught(outside.listMediaUsers());
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.statusCode).toBe(502);
    expect(err.message).toBe(
      "Jellyfin: list users failed: redirect (HTTP 302). The server redirects: check the base URL (https, Jellyfin's base URL path)",
    );
    // The redirect target never got a request (and with it the key).
    expect(lines()).toEqual(['GET /Users']);
  });

  it('names the API key on 401 and never shows it, even when the server echoes it', async () => {
    const wrong = 'b'.repeat(32);
    const denied = await caught(adapter({ apiKey: wrong }).listMediaUsers());
    expect(denied.statusCode).toBe(502);
    expect((denied as ProviderError).upstreamStatus).toBe(401);
    expect(denied.message).toContain('The API key was rejected: create a new one in Dashboard > API Keys');
    expect(denied.message).not.toContain(wrong);

    mock.state.override = () => ({ status: 500, text: `token ${MOCK_API_KEY} is broken` });
    const echoed = await caught(adapter().listMediaUsers());
    expect(echoed.message).toBe('Jellyfin: list users failed: token [redacted] is broken (HTTP 500)');
    mock.state.override = () => ({ status: 400, json: { title: `bad key ${MOCK_API_KEY.toUpperCase()}` } });
    const upper = await caught(adapter({ apiKey: ` ${MOCK_API_KEY} ` }).listMediaUsers());
    expect(upper.message).not.toContain(MOCK_API_KEY);
  });

  it('keeps at most 4 requests in flight', async () => {
    await start({ delayMs: 40 });
    const client = new JellyfinClient(config());
    await Promise.all(Array.from({ length: 10 }, () => client.request('GET', '/System/Info')));
    expect(mock.state.maxInFlight).toBe(4);

    mock.state.maxInFlight = 0;
    const two = new JellyfinClient(config(), { maxInFlight: 2 });
    await Promise.all(Array.from({ length: 6 }, () => two.request('GET', '/System/Info')));
    expect(mock.state.maxInFlight).toBe(2);
  });

  it('turns timeouts and network failures into a 502 without the key', async () => {
    await start({ delayMs: 300 });
    const slow = await caught(adapter({}, { timeoutMs: 50 }).listMediaUsers());
    expect(slow).toBeInstanceOf(ProviderError);
    expect(slow.statusCode).toBe(502);
    expect(slow.message).toBe('Jellyfin: list users failed: no answer within 50 ms');

    const closed = new JellyfinAdapter({ baseUrl: 'http://127.0.0.1:1', apiKey: MOCK_API_KEY });
    const network = await caught(closed.listMediaUsers());
    expect(network).toBeInstanceOf(ProviderError);
    expect(network.statusCode).toBe(502);
    expect(network.message).toMatch(/^Jellyfin: list users failed: /);
    expect(network.message).not.toContain(MOCK_API_KEY);
  });

  it('parses JSON, problem JSON, JSON-looking text and plain text bodies', async () => {
    const client = new JellyfinClient(config());
    mock.state.override = (req) => {
      if (req.path === '/a') return { json: { Name: 'x' } };
      if (req.path === '/b')
        return { status: 404, json: { title: 'Not Found' }, contentType: 'application/problem+json' };
      if (req.path === '/c') return { text: '"quoted"', contentType: 'text/plain' };
      if (req.path === '/d') return { text: 'Jellyfin Server' };
      if (req.path === '/e') return { status: 204 };
      return { text: '{ broken', contentType: 'application/json' };
    };
    expect(await client.raw('GET', '/a')).toMatchObject({ status: 200, body: { Name: 'x' } });
    expect((await client.raw('GET', '/b')).body).toEqual({ title: 'Not Found' });
    expect((await client.raw('GET', '/c')).body).toBe('quoted');
    expect((await client.raw('GET', '/d')).body).toBe('Jellyfin Server');
    expect(await client.request('POST', '/e')).toBeNull();
    expect((await client.raw('GET', '/f')).body).toBe('{ broken');
    // Query values: null skipped, booleans as true/false.
    await client.raw('GET', '/a', { query: { isHidden: false, isDisabled: null, limit: 5 } });
    expect(mock.requests.at(-1)!.query.toString()).toBe('isHidden=false&limit=5');
  });
});

describe('Jellyfin connection', () => {
  it('tests the connection and reports facts', async () => {
    add(mockUser('anna-kemaro', { id: ANNA_ID }));
    expect(await adapter().testConnection()).toEqual({
      version: '10.11.11',
      serverName: 'weblion Media',
      users: 2,
      administrators: 1,
      libraries: 3,
    });
    mock.state.version = '10.10.7';
    expect((await adapter().testConnection()).version).toBe('10.10.7');
  });

  it('refuses Jellyfin before 10.10 and an unfinished first-start wizard', async () => {
    mock.state.version = '10.9.11';
    const old = await caught(adapter().testConnection());
    expect(old.statusCode).toBe(502);
    expect(old.message).toBe('Jellyfin: Jellyfin 10.9.11 is too old: the console needs 10.10 or newer');

    mock.state.version = '10.11.11';
    mock.state.startupWizardCompleted = false;
    const wizard = await caught(adapter().testConnection());
    expect(wizard.statusCode).toBe(502);
    expect(wizard.message).toBe('Jellyfin: finish the first-start wizard of Jellyfin first');
  });

  it('reads the server info fresh when testing, and caches it otherwise', async () => {
    const a = adapter();
    expect((await a.mediaServerInfo()).version).toBe('10.11.11');
    mock.state.version = '10.9.11';
    expect((await a.mediaServerInfo()).version).toBe('10.11.11');
    expect((await caught(a.testConnection())).message).toContain('10.9.11 is too old');
    expect((await a.mediaServerInfo()).version).toBe('10.9.11');
  });

  it('has no servers and gives an overview with counts only', async () => {
    const a = adapter();
    expect(a.capabilities()).toEqual([]);
    expect(a.powerActions()).toEqual([]);
    expect(await a.listServers()).toEqual([]);
    const err = await caught(a.getServer({ externalId: 'x', kind: 'vm', node: null, meta: {} }));
    expect(err.statusCode).toBe(404);

    const overview = await a.overview();
    expect(overview.version).toBe('10.11.11');
    expect(overview.nodes).toEqual([]);
    expect(overview.storages).toEqual([]);
    expect(overview.facts).toEqual([
      { label: 'Version', value: '10.11.11' },
      { label: 'Server name', value: 'weblion Media' },
      { label: 'Users', value: '1' },
      { label: 'Libraries', value: '3' },
      { label: 'Active sessions', value: '2' },
      { label: 'Playing', value: '1' },
      { label: 'Quick Connect', value: 'on' },
      { label: 'Login', value: mock.url },
    ]);
    expect(JSON.stringify(overview)).not.toContain(MOCK_PLAYING_TITLE);
  });
});

describe('Jellyfin users', () => {
  it('lists and reads users', async () => {
    add(
      mockUser('anna-kemaro', {
        id: ANNA_ID,
        policy: applyPolicyState(defaultPolicy(), MUSTER),
        lastActivityDate: '2026-10-11T20:01:12.1234567Z',
      }),
    );
    const a = adapter();
    const users = await a.listMediaUsers();
    expect(users.map((u) => u.username)).toEqual(['admin', 'anna-kemaro']);
    expect(users[0]).toMatchObject({ externalId: ADMIN_ID, administrator: true, enabled: true });
    expect(users[1]).toMatchObject({
      externalId: ANNA_ID,
      administrator: false,
      hasPassword: true,
      lastLoginAt: null,
      lastActivityAt: '2026-10-11T20:01:12.123Z',
      policy: MUSTER,
    });

    mock.requests.length = 0;
    expect(await a.getMediaUser(dashed(ANNA_ID))).toEqual(users[1]);
    expect(lines()).toEqual([`GET /Users/${ANNA_ID}`]);
  });

  it('answers 404 for unknown users and refuses invalid ids without a request', async () => {
    const a = adapter();
    const missing = await caught(a.getMediaUser(UNKNOWN_ID));
    expect(missing).toBeInstanceOf(ProviderError);
    expect(missing.statusCode).toBe(404);
    expect((missing as ProviderError).upstreamStatus).toBe(404);
    expect(missing.message).toBe(`Jellyfin: user ${UNKNOWN_ID} not found`);

    mock.requests.length = 0;
    for (const id of ['abc', '0'.repeat(32), `${ANNA_ID}/Policy`, '../Auth/Keys', '']) {
      const err = await caught(a.getMediaUser(id));
      expect(err.statusCode).toBe(400);
      expect(err.message).toBe('Invalid Jellyfin user id');
      for (const write of [
        () => a.setMediaUserPolicy(id, MUSTER),
        () => a.setMediaUserEnabled(id, false),
        () => a.setMediaUserPassword(id, PASSWORD),
        () => a.deleteMediaUser(id),
      ]) {
        expect((await caught(write())).statusCode).toBe(400);
      }
    }
    expect(mock.requests).toEqual([]);
  });

  it('answers 404 when the user is deleted between the read and the write', async () => {
    add(mockUser('anna-kemaro', { id: ANNA_ID }));
    mock.state.override = (req) => {
      if (req.method !== 'POST') return undefined;
      mock.state.users.delete(ANNA_ID);
      return { status: 404, json: { title: 'Not Found', status: 404 } };
    };
    const a = adapter();
    for (const write of [
      () => a.setMediaUserPolicy(ANNA_ID, MUSTER),
      () => a.setMediaUserEnabled(ANNA_ID, false),
      () => a.setMediaUserPassword(ANNA_ID, PASSWORD),
    ]) {
      add(mockUser('anna-kemaro', { id: ANNA_ID }));
      const err = await caught(write());
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe(`Jellyfin: user ${ANNA_ID} not found`);
    }
  });

  it('refuses odd user lists so the sync never takes them for "everyone is gone"', async () => {
    mock.state.override = (req) => (req.path === '/Users' ? { json: [] } : undefined);
    expect((await caught(adapter().listMediaUsers())).message).toBe(
      'Jellyfin: list users failed: unexpected answer',
    );
    mock.state.override = (req) =>
      req.path === '/Users' ? { text: '<html>Sign in</html>', contentType: 'text/html' } : undefined;
    expect((await caught(adapter().listMediaUsers())).statusCode).toBe(502);
    mock.state.override = (req) =>
      req.path === '/Users'
        ? {
            json: [
              { Id: 'broken', Name: 'x' },
              { Id: ADMIN_ID, Name: 'admin' },
            ],
          }
        : undefined;
    expect((await adapter().listMediaUsers()).map((u) => u.externalId)).toEqual([ADMIN_ID]);
  });

  it('creates a user with its password, then its policy, then reads it back', async () => {
    const a = adapter();
    const user = await a.createMediaUser({ username: 'anna-kemaro', password: PASSWORD, policy: MUSTER });
    expect(user).toMatchObject({
      username: 'anna-kemaro',
      enabled: true,
      administrator: false,
      hasPassword: true,
      lockedOut: false,
      lastActivityAt: null,
      policy: MUSTER,
    });
    expect(user.externalId).toMatch(/^[0-9a-f]{32}$/);
    expect(lines()).toEqual([
      'POST /Users/New',
      `POST /Users/${user.externalId}/Policy`,
      `GET /Users/${user.externalId}`,
    ]);
    expect(mock.requests[0]!.body).toEqual({ Name: 'anna-kemaro', Password: PASSWORD });
    const sent = mock.requests[1]!.body as Record<string, unknown>;
    expect(sent).toMatchObject({
      AuthenticationProviderId: AUTH_PROVIDER,
      PasswordResetProviderId: RESET_PROVIDER,
      IsAdministrator: false,
      IsHidden: true,
      IsDisabled: false,
      EnableAllFolders: false,
      EnabledFolders: [FILME, SERIEN].sort(),
      MaxActiveSessions: 2,
      RemoteClientBitrateLimit: 8_000_000,
      EnableLiveTvAccess: false,
      EnablePublicSharing: false,
      EnableAllChannels: false,
      SyncPlayAccess: 'None',
    });
    const stored = mock.state.users.get(user.externalId)!;
    expect(stored.password).toBe(PASSWORD);
    expect(parsePolicyState(stored.policy)).toEqual(MUSTER);
    expect(JSON.stringify(user)).not.toContain(PASSWORD);
  });

  it('reads the user first when the create answer has no usable policy', async () => {
    mock.state.override = (req) => {
      if (req.path !== '/Users/New') return undefined;
      mock.state.override = undefined;
      const body = req.body as { Name: string; Password: string };
      const user = add(mockUser(body.Name, { password: body.Password }));
      return { json: { Name: user.name, Id: user.id, HasPassword: true, Policy: { IsHidden: true } } };
    };
    const user = await adapter().createMediaUser({
      username: 'ben-kemaro',
      password: PASSWORD,
      policy: MUSTER,
    });
    expect(lines()).toEqual([
      'POST /Users/New',
      `GET /Users/${user.externalId}`,
      `POST /Users/${user.externalId}/Policy`,
      `GET /Users/${user.externalId}`,
    ]);
    expect((mock.requests[2]!.body as Record<string, unknown>).AuthenticationProviderId).toBe(AUTH_PROVIDER);
    expect(user.policy).toEqual(MUSTER);
  });

  it('keeps a created user when only the read-back fails', async () => {
    mock.state.override = (req) =>
      req.method === 'GET' && /^\/Users\/[0-9a-f]{32}$/.test(req.path)
        ? { status: 500, text: 'Error processing request.' }
        : undefined;
    const user = await adapter().createMediaUser({
      username: 'lea-kemaro',
      password: PASSWORD,
      policy: MUSTER,
    });
    expect(user).toMatchObject({ username: 'lea-kemaro', hasPassword: true, enabled: true, policy: MUSTER });
    expect(mock.state.users.has(user.externalId)).toBe(true);
  });

  it('refuses taken names (any case), invalid names and empty passwords', async () => {
    add(mockUser('Anna-Kemaro', { id: ANNA_ID }));
    const a = adapter();
    const taken = await caught(
      a.createMediaUser({ username: 'anna-kemaro', password: PASSWORD, policy: MUSTER }),
    );
    expect(taken.statusCode).toBe(409);
    expect(taken.code).toBe('conflict');
    expect(taken.message).toBe('The Jellyfin user "anna-kemaro" already exists');
    expect(lines()).toEqual(['POST /Users/New', 'GET /Users']);
    expect(mock.state.users.size).toBe(2);

    mock.requests.length = 0;
    for (const username of ['anna?', ' anna', 'anna ', '', 'a/b']) {
      const err = await caught(a.createMediaUser({ username, password: PASSWORD, policy: MUSTER }));
      expect(err.statusCode).toBe(400);
      expect(err.message).toMatch(/^Invalid Jellyfin user name/);
    }
    const empty = await caught(a.createMediaUser({ username: 'lea-kemaro', password: '', policy: MUSTER }));
    expect(empty.statusCode).toBe(400);
    expect(empty.message).toBe('The password must not be empty');
    expect(mock.requests).toEqual([]);

    // A 400 for a name that is free: Jellyfin's reason stays in its log.
    mock.state.override = (req) =>
      req.path === '/Users/New' ? { status: 400, text: 'Error processing request.' } : undefined;
    const odd = await caught(
      a.createMediaUser({ username: 'lea-kemaro', password: PASSWORD, policy: MUSTER }),
    );
    expect(odd.statusCode).toBe(502);
    expect(odd.message).toBe(
      'Jellyfin: create user lea-kemaro failed: refused without a reason (HTTP 400). Jellyfin does not tell why (check the server log)',
    );
  });

  it('removes the user again when its policy is refused, without the password in the message', async () => {
    mock.state.override = (req) =>
      req.path.endsWith('/Policy')
        ? {
            status: 400,
            json: {
              title: 'One or more validation errors occurred.',
              status: 400,
              errors: { NewPw: [`The value ${PASSWORD} is odd.`] },
            },
          }
        : undefined;
    const err = await caught(
      adapter().createMediaUser({ username: 'lea-kemaro', password: PASSWORD, policy: MUSTER }),
    );
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.statusCode).toBe(502);
    expect(err.message).toBe(
      'Jellyfin: create user lea-kemaro failed while setting its access: One or more validation errors occurred: ' +
        'The value [redacted] is odd. (HTTP 400). The user was removed again',
    );
    expect(err.message).not.toContain(PASSWORD);
    const id = /^POST \/Users\/([0-9a-f]{32})\/Policy$/.exec(lines()[1] ?? '')![1]!;
    expect(lines()).toEqual(['POST /Users/New', `POST /Users/${id}/Policy`, `DELETE /Users/${id}`]);
    expect([...mock.state.users.values()].map((u) => u.name)).toEqual(['admin']);

    // When removing fails too, the message says what to do.
    mock.state.override = (req) =>
      req.path.endsWith('/Policy') || req.method === 'DELETE'
        ? { status: 500, text: 'Error processing request.' }
        : undefined;
    const stuck = await caught(
      adapter().createMediaUser({ username: 'mia-kemaro', password: PASSWORD, policy: MUSTER }),
    );
    expect(stuck.message).toContain('Removing the user failed too: delete it in Jellyfin');
    expect(stuck.message).not.toContain(PASSWORD);
  });

  it('changes only the managed policy fields, read, modify, write', async () => {
    const anna = add(
      mockUser('anna-kemaro', {
        id: ANNA_ID,
        policy: {
          IsDisabled: true,
          InvalidLoginAttemptCount: 1,
          LoginAttemptsBeforeLockout: 5,
          MaxParentalSubRating: 12,
          FutureField: 7,
        },
      }),
    );
    const user = await adapter().setMediaUserPolicy(ANNA_ID, MUSTER);
    expect(lines()).toEqual([`GET /Users/${ANNA_ID}`, `POST /Users/${ANNA_ID}/Policy`]);
    expect(mock.requests[1]!.body).toMatchObject({
      FutureField: 7,
      MaxParentalSubRating: 12,
      IsDisabled: true,
      InvalidLoginAttemptCount: 1,
      LoginAttemptsBeforeLockout: 5,
      AuthenticationProviderId: AUTH_PROVIDER,
    });
    expect(anna.policy).toMatchObject({ FutureField: 7, IsDisabled: true, InvalidLoginAttemptCount: 1 });
    expect(parsePolicyState(anna.policy)).toEqual(MUSTER);
    expect(user).toMatchObject({ externalId: ANNA_ID, enabled: false, policy: MUSTER });
  });

  it('demotes administrators, unless Jellyfin refuses for the last one', async () => {
    const second = add(mockUser('chef', { id: BEN_ID, policy: { IsAdministrator: true } }));
    const demoted = await adapter().setMediaUserPolicy(BEN_ID, MUSTER);
    expect(demoted.administrator).toBe(false);
    expect(second.policy.IsAdministrator).toBe(false);

    const last = await caught(adapter().setMediaUserPolicy(ADMIN_ID, MUSTER));
    expect(last.statusCode).toBe(502);
    expect(last.message).toBe(
      'Jellyfin: set the access of admin failed: There must be at least one user in the system with administrative access. (HTTP 403)',
    );
  });

  it('never interleaves two writes to one user, and runs writes to two users in parallel', async () => {
    await start({ delayMs: 30 });
    add(mockUser('anna-kemaro', { id: ANNA_ID }));
    add(mockUser('ben-kemaro', { id: BEN_ID }));
    const a = adapter();
    const wide = { ...MUSTER, maxSessions: 4 };
    await Promise.all([a.setMediaUserPolicy(ANNA_ID, MUSTER), a.setMediaUserPolicy(ANNA_ID, wide)]);
    expect(lines()).toEqual([
      `GET /Users/${ANNA_ID}`,
      `POST /Users/${ANNA_ID}/Policy`,
      `GET /Users/${ANNA_ID}`,
      `POST /Users/${ANNA_ID}/Policy`,
    ]);
    expect(mock.state.users.get(ANNA_ID)!.policy.MaxActiveSessions).toBe(4);

    // A failed write does not block the next one.
    mock.requests.length = 0;
    mock.state.override = (req) =>
      req.method === 'POST' && mock.requests.length <= 2 ? { status: 500 } : undefined;
    const [failed, ok] = await Promise.allSettled([
      a.setMediaUserPolicy(ANNA_ID, MUSTER),
      a.setMediaUserPolicy(ANNA_ID, MUSTER),
    ]);
    expect(failed.status).toBe('rejected');
    expect(ok.status).toBe('fulfilled');
    mock.state.override = undefined;

    mock.requests.length = 0;
    await Promise.all([a.setMediaUserPolicy(ANNA_ID, MUSTER), a.setMediaUserPolicy(BEN_ID, MUSTER)]);
    expect(lines().slice(0, 2).sort()).toEqual([`GET /Users/${ANNA_ID}`, `GET /Users/${BEN_ID}`]);
  });

  it('disables (devices signed out) and enables (failed sign-ins reset), never administrators', async () => {
    const anna = add(mockUser('anna-kemaro', { id: ANNA_ID, devices: 2 }));
    const a = adapter();
    const disabled = await a.setMediaUserEnabled(ANNA_ID, false);
    expect(disabled.enabled).toBe(false);
    expect(anna.policy.IsDisabled).toBe(true);
    expect(anna.devices).toBe(0);
    expect(lines()).toEqual([`GET /Users/${ANNA_ID}`, `POST /Users/${ANNA_ID}/Policy`]);

    // Locked out by Jellyfin after failed sign-ins.
    anna.policy = { ...anna.policy, LoginAttemptsBeforeLockout: 3, InvalidLoginAttemptCount: 3 };
    expect((await a.getMediaUser(ANNA_ID)).lockedOut).toBe(true);
    const enabled = await a.setMediaUserEnabled(ANNA_ID, true);
    expect(enabled).toMatchObject({ enabled: true, lockedOut: false });
    expect(anna.policy).toMatchObject({
      IsDisabled: false,
      InvalidLoginAttemptCount: 0,
      LoginAttemptsBeforeLockout: 3,
    });

    mock.requests.length = 0;
    for (const enable of [true, false]) {
      const refused = await caught(a.setMediaUserEnabled(ADMIN_ID, enable));
      expect(refused.statusCode).toBe(409);
      expect(refused.message).toBe(JELLYFIN_ADMIN_REFUSED);
    }
    expect(lines()).toEqual([`GET /Users/${ADMIN_ID}`, `GET /Users/${ADMIN_ID}`]);
  });

  it('sets a password as administrator: no current password, never a reset, devices signed out', async () => {
    const anna = add(mockUser('anna-kemaro', { id: ANNA_ID, password: 'old-password-1', devices: 3 }));
    const a = adapter();
    await a.setMediaUserPassword(dashed(ANNA_ID), PASSWORD);
    expect(lines()).toEqual([`GET /Users/${ANNA_ID}`, 'POST /Users/Password']);
    const req = mock.requests[1]!;
    expect(req.query.get('userId')).toBe(ANNA_ID);
    expect(req.body).toEqual({ NewPw: PASSWORD, ResetPassword: false });
    expect(anna.password).toBe(PASSWORD);
    expect(anna.devices).toBe(0);

    mock.state.override = (r) =>
      r.path === '/Users/Password' ? { status: 500, text: `could not hash ${PASSWORD}` } : undefined;
    const failed = await caught(a.setMediaUserPassword(ANNA_ID, PASSWORD));
    expect(failed.message).toBe(
      'Jellyfin: set the password of anna-kemaro failed: could not hash [redacted] (HTTP 500)',
    );
    mock.state.override = undefined;

    mock.requests.length = 0;
    const admin = await caught(a.setMediaUserPassword(ADMIN_ID, PASSWORD));
    expect(admin.statusCode).toBe(409);
    expect(admin.message).toBe(JELLYFIN_ADMIN_REFUSED);
    const empty = await caught(a.setMediaUserPassword(ANNA_ID, ''));
    expect(empty.statusCode).toBe(400);
    expect(lines()).toEqual([`GET /Users/${ADMIN_ID}`]);
    const missing = await caught(a.setMediaUserPassword(UNKNOWN_ID, PASSWORD));
    expect(missing.statusCode).toBe(404);
  });

  it('deletes users, 404 at either step, never administrators', async () => {
    const anna = add(mockUser('anna-kemaro', { id: ANNA_ID, devices: 1 }));
    const a = adapter();
    await a.deleteMediaUser(ANNA_ID);
    expect(lines()).toEqual([`GET /Users/${ANNA_ID}`, `DELETE /Users/${ANNA_ID}`]);
    expect(mock.state.users.has(ANNA_ID)).toBe(false);
    expect(anna.devices).toBe(0);

    const gone = await caught(a.deleteMediaUser(ANNA_ID));
    expect(gone.statusCode).toBe(404);
    expect(gone.message).toBe(`Jellyfin: user ${ANNA_ID} not found`);

    add(mockUser('ben-kemaro', { id: BEN_ID }));
    mock.state.override = (req) =>
      req.method === 'DELETE' ? { status: 404, json: { title: 'Not Found', status: 404 } } : undefined;
    const raced = await caught(a.deleteMediaUser(BEN_ID));
    expect(raced.statusCode).toBe(404);
    expect(raced.message).toBe(`Jellyfin: user ${BEN_ID} not found`);
    mock.state.override = undefined;

    mock.requests.length = 0;
    const admin = await caught(a.deleteMediaUser(ADMIN_ID));
    expect(admin.statusCode).toBe(409);
    expect(lines()).toEqual([`GET /Users/${ADMIN_ID}`]);
    expect(mock.state.users.has(ADMIN_ID)).toBe(true);
  });
});

describe('Jellyfin libraries, server info and activity', () => {
  it('caches libraries for 5 minutes unless asked fresh', async () => {
    mock.state.libraries.push({ ItemId: null, Name: 'Neu' });
    const a = adapter();
    const libraries = await a.listMediaLibraries();
    expect(libraries).toEqual([
      { id: FILME, name: 'Filme', type: 'movies' },
      { id: MUSIK, name: 'Musik', type: 'music' },
      { id: SERIEN, name: 'Serien', type: 'tvshows' },
    ]);
    libraries[0]!.name = 'changed by a caller';
    expect((await a.listMediaLibraries())[0]!.name).toBe('Filme');
    expect(lines()).toEqual(['GET /Library/VirtualFolders']);

    mock.state.libraries[0]!.Name = 'Spielfilme';
    expect((await a.listMediaLibraries(true)).map((l) => l.name)).toContain('Spielfilme');
    expect(lines()).toEqual(['GET /Library/VirtualFolders', 'GET /Library/VirtualFolders']);

    mock.state.override = () => ({ json: { Items: [] } });
    expect((await caught(a.listMediaLibraries(true))).message).toBe(
      'Jellyfin: list libraries failed: unexpected answer',
    );
  });

  it('caches the server info for 10 minutes; Quick Connect is null when it cannot be read', async () => {
    const a = adapter();
    expect(await a.mediaServerInfo()).toEqual({
      serverName: 'weblion Media',
      version: '10.11.11',
      serverId: MOCK_SERVER_ID,
      quickConnect: true,
      startupWizardCompleted: true,
    });
    await a.mediaServerInfo();
    expect(lines().sort()).toEqual(['GET /QuickConnect/Enabled', 'GET /System/Info']);
    // Quick Connect is anonymous: no key needed, but the client sends it the same way.
    await a.mediaServerInfo(true);
    expect(lines()).toHaveLength(4);

    mock.state.quickConnect = false;
    expect((await a.mediaServerInfo(true)).quickConnect).toBe(false);
    mock.state.override = (req) => (req.path === '/QuickConnect/Enabled' ? { status: 500 } : undefined);
    expect((await a.mediaServerInfo(true)).quickConnect).toBeNull();

    // A failed read is not kept: the next call reads again.
    mock.state.version = '10.11.12';
    mock.state.override = (req) => (req.path === '/System/Info' ? { status: 503 } : undefined);
    const err = await caught(a.mediaServerInfo(true));
    expect(err.message).toContain('The server is starting or under maintenance');
    mock.state.override = undefined;
    expect((await a.mediaServerInfo()).version).toBe('10.11.12');
  });

  it('counts sessions without letting anything else out, cached for 30 seconds', async () => {
    const a = adapter();
    const activity = await a.mediaActivity();
    expect(activity).toEqual({ activeSessions: 2, playing: 1 });
    await a.mediaActivity();
    expect(lines()).toEqual(['GET /Sessions']);
    expect(mock.requests[0]!.query.get('activeWithinSeconds')).toBe('600');
    expect(JSON.stringify(activity)).not.toContain(MOCK_PLAYING_TITLE);
  });
});

describe('Jellyfin API explorer', () => {
  it('sends GET and DELETE bodies as query, POST bodies as JSON, base URL prefix accepted', async () => {
    const anna = add(mockUser('anna-kemaro', { id: ANNA_ID }));
    const a = adapter();
    const users = await a.rawRequest('GET', '/Users', { isHidden: true, ids: [ANNA_ID, BEN_ID], skip: null });
    expect(users.status).toBe(200);
    expect(Array.isArray(users.data)).toBe(true);
    expect(mock.requests.at(-1)!.query.get('isHidden')).toBe('true');
    expect(mock.requests.at(-1)!.query.get('ids')).toBe(`${ANNA_ID},${BEN_ID}`);
    expect(mock.requests.at(-1)!.query.has('skip')).toBe(false);

    const info = await a.rawRequest('get', `${mock.url}/System/Info?x=1`);
    expect(info.status).toBe(200);
    expect(mock.requests.at(-1)!.path).toBe('/System/Info');
    expect(mock.requests.at(-1)!.query.get('x')).toBe('1');

    const policy = { ...anna.policy, MaxActiveSessions: 3 };
    const written = await a.rawRequest('POST', `/Users/${ANNA_ID}/Policy`, policy);
    expect(written).toEqual({ status: 204, data: null });
    expect(mock.requests.at(-1)!.body).toEqual(policy);
    expect(anna.policy.MaxActiveSessions).toBe(3);

    const removed = await a.rawRequest('DELETE', `/Users/${ANNA_ID}`);
    expect(removed.status).toBe(204);
    expect(mock.state.users.has(ANNA_ID)).toBe(false);

    // Failures come back as they are.
    expect((await a.rawRequest('GET', `/Users/${UNKNOWN_ID}`)).status).toBe(404);
    expect((await caught(a.rawRequest('PUT', '/Users'))).message).toBe('Unsupported method');
  });

  it('refuses paths that leave the instance or hand out credentials, before any request', async () => {
    const a = adapter();
    for (const path of [
      '/Users/../Auth/Keys',
      '/Users/./x',
      '/Users/%2e%2e/Auth/Keys',
      '/Users%2fx',
      '/Users%5cx',
      '//evil.example/Users',
      '/Users\\x',
      '/Users#x',
      '/Users/a b',
      'Users',
      'http://evil.example/Users',
    ]) {
      const err = await caught(a.rawRequest('GET', path));
      expect(err.statusCode).toBe(400);
    }
    for (const path of [
      '/Auth/Keys',
      '/auth/keys/x',
      '/AUTH/KEYS?limit=1',
      '/Auth/Keys/',
      '/Auth/Keys.',
      '/Auth./Keys',
      '/Startup/User',
      '/startup',
      '/Users/AuthenticateByName',
      '/Users/AuthenticateWithQuickConnect',
      `/Users/${ANNA_ID}/Authenticate`,
      '/QuickConnect/Authorize',
      '/Users/ForgotPassword',
      '/Users/ForgotPassword/Pin',
    ]) {
      for (const method of ['GET', 'POST', 'DELETE']) {
        const err = await caught(a.rawRequest(method, path, { Pw: 'x' }));
        expect(err.statusCode).toBe(400);
        expect(err.message).toBe(
          'This path hands out or creates credentials and is not available in the explorer',
        );
      }
    }
    expect(mock.requests).toEqual([]);
  });

  it('blanks tokens and passwords in answers, also echoes of what was sent', async () => {
    add(mockUser('anna-kemaro', { id: ANNA_ID }));
    const a = adapter();
    mock.state.override = (req) => {
      if (req.path === '/Devices') {
        return {
          json: { Items: [{ Name: 'Wohnzimmer TV', AccessToken: 'device-token-1', LastUserName: 'anna' }] },
        };
      }
      if (req.path === '/Users/Password') {
        return {
          status: 400,
          json: { title: `bad ${(req.body as { NewPw: string }).NewPw} for key ${MOCK_API_KEY}` },
        };
      }
      return undefined;
    };
    const devices = await a.rawRequest('GET', '/Devices');
    expect(devices.data).toEqual({
      Items: [{ Name: 'Wohnzimmer TV', AccessToken: '••••••', LastUserName: 'anna' }],
    });

    const echoed = await a.rawRequest('POST', `/Users/Password?userId=${ANNA_ID}`, {
      NewPw: 'Geheim-Passwort-42',
      ResetPassword: false,
    });
    expect(echoed.status).toBe(400);
    expect(JSON.stringify(echoed.data)).not.toContain('Geheim-Passwort-42');
    expect(JSON.stringify(echoed.data)).not.toContain(MOCK_API_KEY);
    expect(echoed.data).toEqual({ title: 'bad [redacted] for key [redacted]' });
    expect(mock.requests.at(-1)!.query.get('userId')).toBe(ANNA_ID);
    mock.state.override = undefined;

    // The key list exists at the mock, the explorer never reads it.
    const keys = await fetch(`${mock.url}/Auth/Keys`, {
      headers: { Authorization: `MediaBrowser Token="${MOCK_API_KEY}"` },
    });
    expect(JSON.stringify(await keys.json())).toContain(MOCK_LISTED_KEY);
    expect((await caught(a.rawRequest('GET', '/Auth/Keys'))).statusCode).toBe(400);
  });

  it('uses the provider name in every error', () => {
    expect(PROVIDER).toBe('Jellyfin');
  });
});
