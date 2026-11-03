import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError, ProviderError } from '../src/lib/errors';
import { JellyfinAdapter } from '../src/providers/jellyfin/adapter';
import { SEERR_TIMEOUT_MS, SeerrClient } from '../src/providers/seerr/client';
import {
  describeSeerrError,
  parseRequestPage,
  parseSeerrMainSettings,
  parseSeerrQuota,
  parseSeerrUser,
  parseSeerrUserPage,
  redactSeerr,
  seerrHasUserSettings,
  seerrMessage,
  seerrSettingsCopy,
  seerrSettingsProblems,
  sortSeerrProblems,
} from '../src/providers/seerr/parse';
import { SEERR_PERMISSION, SEERR_SAFE_SETTINGS } from '../src/providers/seerr/rules';
import { SeerrApi } from '../src/providers/seerr/seerr';
import type { JellyfinConfig, RemoteSeerrUser, SeerrUserAccess } from '../src/providers/types';
import {
  MOCK_API_KEY,
  MOCK_SERVER_ID,
  mockUser,
  startJellyfinMock,
  type JellyfinMock,
} from './jellyfin-mock';
import {
  MOCK_SEERR_API_KEY,
  MOCK_SEERR_JELLYFIN_KEY,
  MOCK_SEERR_PROXY_PASSWORD,
  startSeerrMock,
  type MockSeerrOptions,
  type MockSeerrRequestRecord,
  type MockSeerrUser,
  type SeerrMock,
} from './seerr-mock';

const P = SEERR_PERMISSION;
const ANNA_JF = '3bc712a422452aa61a2816cf217e3788';
const BEN_JF = '97a3a6596b22bcba752af2adb4acce60';
const UNKNOWN_JF = 'e105e849dc773e5b1a8814f45bc8d0b6';
const OTHER_SERVER = '1f2e3d4c5b6a79880f1e2d3c4b5a6978';

/** Muster AG: movies and series, 5 movies and 3 seasons in 30 days. */
const MUSTER: SeerrUserAccess = {
  permissions: P.REQUEST_MOVIE | P.REQUEST_TV,
  movieQuotaLimit: 5,
  movieQuotaDays: 30,
  tvQuotaLimit: 3,
  tvQuotaDays: 30,
};
const NONE: SeerrUserAccess = {
  permissions: 0,
  movieQuotaLimit: 0,
  movieQuotaDays: 0,
  tvQuotaLimit: 0,
  tvQuotaDays: 0,
};

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

/** JSON of a value for deep scans (Maps as entries). */
function deep(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (v instanceof Map ? [...v.entries()] : v));
}

// ---------------------------------------------------------------------------
// Parse (pure)

describe('Seerr parse', () => {
  it('keeps ids, rights and quotas of a user, never email, names or avatar', () => {
    const raw = {
      id: 7,
      email: 'anna@kemaro.ch',
      plexUsername: null,
      jellyfinUsername: 'anna-kemaro',
      username: 'Anna',
      userType: 3,
      jellyfinUserId: dashed(ANNA_JF),
      permissions: P.REQUEST_MOVIE,
      avatar: '/avatarproxy/3bc7',
      movieQuotaLimit: 5,
      movieQuotaDays: 30,
      createdAt: '2026-10-01T08:00:00.000Z',
      requestCount: 3,
      displayName: 'Anna',
    };
    expect(parseSeerrUser(raw)).toEqual({
      id: 7,
      jellyfinUserId: ANNA_JF,
      permissions: P.REQUEST_MOVIE,
      movieQuotaLimit: 5,
      movieQuotaDays: 30,
      tvQuotaLimit: null,
      tvQuotaDays: null,
    });
    expect(parseSeerrUser({ ...raw, jellyfinUserId: '0'.repeat(32) })?.jellyfinUserId).toBeNull();
    expect(parseSeerrUser({ ...raw, jellyfinUserId: null })?.jellyfinUserId).toBeNull();
    expect(parseSeerrUser({ ...raw, jellyfinUserId: 'plex-42' })?.jellyfinUserId).toBeNull();
    expect(parseSeerrUser({ ...raw, movieQuotaLimit: 0 })?.movieQuotaLimit).toBe(0);
    // Without a valid id or permissions the console never guesses.
    expect(parseSeerrUser({ ...raw, id: 0 })).toBeNull();
    expect(parseSeerrUser({ ...raw, id: '7' })).toBeNull();
    expect(parseSeerrUser({ ...raw, permissions: undefined })).toBeNull();
    expect(parseSeerrUser({ ...raw, permissions: -1 })).toBeNull();
    expect(parseSeerrUser(null)).toBeNull();
    expect(parseSeerrUser([raw])).toBeNull();

    const page = parseSeerrUserPage({ pageInfo: { pages: 3 }, results: [raw, { id: 'x' }] });
    expect(page).toMatchObject({ entries: 2, pages: 3 });
    expect(page?.users).toHaveLength(1);
    expect(parseSeerrUserPage({ results: 'nope' })).toBeNull();
    expect(parseSeerrUserPage({ pageInfo: {}, results: [] })).toEqual({ users: [], entries: 0, pages: null });
  });

  it('reads id, status and requester of a request, nothing of the media', () => {
    const page = parseRequestPage({
      pageInfo: { pages: 1, pageSize: 100, results: 2, page: 1 },
      results: [
        {
          id: 4,
          status: 2,
          type: 'movie',
          createdAt: '2026-10-01T08:00:00.000Z',
          media: { tmdbId: 603, imdbId: 'tt0133093', externalServiceSlug: 'the-matrix' },
          requestedBy: { id: 7, email: 'anna@kemaro.ch', jellyfinUsername: 'anna-kemaro' },
        },
        { id: 5, status: 1, requestedBy: null },
        { id: 'x', status: 1, requestedBy: { id: 7 } },
      ],
    });
    expect(page).toEqual({ requests: [{ id: 4, status: 2, requestedBy: 7 }], entries: 3, pages: 1 });
    expect(parseRequestPage({ results: {} })).toBeNull();
  });

  it('reads the quota usage and the settings the check needs, never keys', () => {
    expect(parseSeerrQuota({ movie: { used: 2, limit: 5 }, tv: { used: 3 } })).toEqual({
      movieUsed: 2,
      tvUsed: 3,
    });
    expect(parseSeerrQuota({ movie: {}, tv: {} })).toEqual({ movieUsed: 0, tvUsed: 0 });
    expect(parseSeerrQuota({ movie: 2 })).toBeNull();
    const main = parseSeerrMainSettings({
      apiKey: MOCK_SEERR_API_KEY,
      newPlexLogin: false,
      defaultPermissions: 0,
      mediaServerLogin: true,
      localLogin: true,
      mediaServerType: 2,
    });
    expect(main).toEqual({
      newPlexLogin: false,
      defaultPermissions: 0,
      mediaServerLogin: true,
      localLogin: true,
      mediaServerType: 2,
    });
    expect(seerrSettingsProblems(main!)).toEqual([]);
    expect(
      seerrSettingsProblems({
        newPlexLogin: null,
        defaultPermissions: null,
        mediaServerLogin: null,
        localLogin: null,
        mediaServerType: null,
      }),
    ).toEqual(['not_jellyfin', 'new_signins', 'default_permissions', 'media_server_login']);
    expect(sortSeerrProblems(['csrf', 'key', 'csrf', 'unreachable'])).toEqual(['unreachable', 'key', 'csrf']);
  });

  it('copies the user settings as read: absent stays absent, never the global or own quotas', () => {
    const read = {
      username: null,
      email: 'anna-kemaro',
      locale: 'de',
      discoverRegion: 'CH',
      movieQuotaLimit: 5,
      tvQuotaDays: 30,
      globalMovieQuotaLimit: 10,
      watchlistSyncTv: false,
    };
    expect(seerrSettingsCopy(read)).toEqual({
      username: null,
      email: 'anna-kemaro',
      locale: 'de',
      discoverRegion: 'CH',
      watchlistSyncTv: false,
    });
    expect(seerrHasUserSettings(read)).toBe(true);
    expect(seerrHasUserSettings({ email: 'anna-kemaro' })).toBe(false);
  });

  it('describes errors with what the operator can do', () => {
    expect(
      describeSeerrError(
        { status: 403, body: { status: 403, error: 'You do not have permission to access this endpoint' } },
        'list users',
      ),
    ).toBe(
      'list users failed: You do not have permission to access this endpoint (HTTP 403). The API key was rejected (Seerr answers 403 for an unknown key): copy it from Seerr > Settings > General',
    );
    expect(
      describeSeerrError(
        { status: 403, body: { status: 403, error: 'You do not have permission to access this endpoint' } },
        'set the access of Seerr user 7',
        { actingAsUser: true },
      ),
    ).toContain('Seerr does not know this user (any more)');
    expect(describeSeerrError({ status: 403, body: { message: 'invalid csrf token' } }, 'apply')).toBe(
      "apply failed: invalid csrf token (HTTP 403). Seerr's CSRF protection is on: switch it off under Settings > Network",
    );
    expect(describeSeerrError({ status: 302, body: null })).toBe(
      'redirect (HTTP 302). Seerr redirects: check the address',
    );
    for (const status of [502, 503, 504]) {
      expect(describeSeerrError({ status, body: '<html>Bad Gateway</html>' })).toBe(
        `refused without a reason (HTTP ${status}). Seerr or its proxy is not available`,
      );
    }
    expect(
      describeSeerrError({
        status: 400,
        body: {
          errors: [{ path: '/body/permissions', message: "must have required property 'permissions'" }],
        },
      }),
    ).toBe("/body/permissions: must have required property 'permissions' (HTTP 400)");
    expect(
      seerrMessage({ message: 'User already exists with submitted email.', errors: ['USER_EXISTS'] }),
    ).toBe('User already exists with submitted email.');
    expect(seerrMessage({ errors: ['USER_EXISTS'] })).toBe('USER_EXISTS');
    expect(seerrMessage('Service Unavailable')).toBe('Service Unavailable');
    expect(seerrMessage({ message: 'x'.repeat(500) })).toHaveLength(300);
    expect(seerrMessage({})).toBeNull();
  });

  it('redacts keys, passwords and tokens at any depth', () => {
    expect(
      redactSeerr({
        apiKey: MOCK_SEERR_API_KEY,
        jellyfin: { apiKey: MOCK_SEERR_JELLYFIN_KEY, serverId: MOCK_SERVER_ID },
        proxy: { user: 'seerr', password: MOCK_SEERR_PROXY_PASSWORD },
        users: [{ jellyfinAuthToken: 'tok', plexToken: '', id: 1 }],
      }),
    ).toEqual({
      apiKey: '[redacted]',
      jellyfin: { apiKey: '[redacted]', serverId: MOCK_SERVER_ID },
      proxy: { user: 'seerr', password: '[redacted]' },
      users: [{ jellyfinAuthToken: '[redacted]', plexToken: '', id: 1 }],
    });
  });
});

// ---------------------------------------------------------------------------
// Against the mock server

let seerr: SeerrMock;

async function start(options: MockSeerrOptions = {}) {
  await seerr?.close();
  seerr = await startSeerrMock(options);
  return seerr;
}

beforeEach(async () => {
  seerr = await startSeerrMock();
});

afterEach(async () => {
  await seerr.close();
});

const api = (options = {}, apiKey = MOCK_SEERR_API_KEY, url = seerr.url) =>
  new SeerrApi({ url, apiKey }, options);

/** "GET /user/7" lines of the recorded requests. */
const lines = (requests: MockSeerrRequestRecord[] = seerr.requests) =>
  requests.map((r) => `${r.method} ${r.path}`);

/** A Jellyfin user known to Seerr's Jellyfin, imported as Seerr would (permissions 0, no settings). */
function imported(jellyfinUserId: string, name: string, extra: Partial<MockSeerrUser> = {}): MockSeerrUser {
  seerr.addJellyfinUser(jellyfinUserId, name);
  return seerr.addUser({ email: name, jellyfinUserId, jellyfinUsername: name, ...extra });
}

function remote(user: MockSeerrUser): RemoteSeerrUser {
  return {
    id: user.id,
    jellyfinUserId: user.jellyfinUserId,
    permissions: user.permissions,
    movieQuotaLimit: user.movieQuotaLimit,
    movieQuotaDays: user.movieQuotaDays,
    tvQuotaLimit: user.tvQuotaLimit,
    tvQuotaDays: user.tvQuotaDays,
  };
}

describe('Seerr client', () => {
  it('sends the key in X-Api-Key on every request, never in the URL, X-API-User only to create settings', async () => {
    const anna = imported(ANNA_JF, 'anna-kemaro');
    seerr.addJellyfinUser(BEN_JF, 'ben-kemaro');
    const a = api();
    await a.check(MOCK_SERVER_ID);
    await a.listUsers();
    const ben = await a.importUser(BEN_JF);
    await a.setAccess(anna.id, MUSTER, remote(anna));
    await a.setAccess(ben.id, MUSTER, ben);
    await a.requestCounts();
    await a.quotaUsage(anna.id);
    await a.deleteUser(ben.id);
    expect(seerr.requests.length).toBeGreaterThan(15);
    for (const req of seerr.requests) {
      expect(req.headers['x-api-key']).toBe(MOCK_SEERR_API_KEY);
      expect(req.headers.accept).toBe('application/json');
      expect(`${req.path}?${req.query}`).not.toContain(MOCK_SEERR_API_KEY);
      expect(`${req.path}?${req.query}`).not.toContain(encodeURIComponent(MOCK_SEERR_API_KEY));
    }
    const actingAs = seerr.requests.filter((r) => r.headers['x-api-user'] !== undefined);
    expect(actingAs.map((r) => `${r.method} ${r.path} as ${r.headers['x-api-user']}`)).toEqual([
      `POST /user/${anna.id}/settings/main as ${anna.id}`,
      `POST /user/${ben.id}/settings/main as ${ben.id}`,
    ]);
    const writes = seerr.requests.filter((r) => r.method === 'POST');
    expect(writes.every((r) => r.headers['content-type'] === 'application/json')).toBe(true);
  });

  it('never shows the key, also when Seerr echoes it, and names it on 403', async () => {
    const wrong = 'd3Jvbmcta2V5LXdyb25nLWtleS13cm9uZw==';
    const denied = await caught(api({}, wrong).listUsers());
    expect(denied).toBeInstanceOf(ProviderError);
    expect(denied.statusCode).toBe(502);
    expect((denied as ProviderError).upstreamStatus).toBe(403);
    expect(denied.message).toBe(
      'Seerr: list users failed: You do not have permission to access this endpoint (HTTP 403). The API key was rejected (Seerr answers 403 for an unknown key): copy it from Seerr > Settings > General',
    );
    expect(denied.message).not.toContain(wrong);

    seerr.state.override = () => ({
      status: 500,
      json: { message: `key ${MOCK_SEERR_API_KEY} (${encodeURIComponent(MOCK_SEERR_API_KEY)}) is broken` },
    });
    const echoed = await caught(api().listUsers());
    expect(echoed.message).toBe('Seerr: list users failed: key [redacted] ([redacted]) is broken (HTTP 500)');
    const echoedImport = await caught(api().importUser(ANNA_JF));
    expect(echoedImport.message).not.toContain(MOCK_SEERR_API_KEY);
    expect(echoedImport.message).toContain('[redacted]');

    // A key with spaces around it is trimmed and still scrubbed.
    seerr.state.override = () => ({ status: 400, text: `bad ${MOCK_SEERR_API_KEY}` });
    const padded = await caught(api({}, ` ${MOCK_SEERR_API_KEY} `).listUsers());
    expect(padded.message).not.toContain(MOCK_SEERR_API_KEY);
  });

  it('never follows a redirect (the key would travel along)', async () => {
    const elsewhere = await startSeerrMock();
    try {
      seerr.state.override = (req) => ({
        status: 302,
        headers: { location: `${elsewhere.url}/api/v1${req.path}` },
      });
      const err = await caught(api().listUsers());
      expect(err.message).toBe(
        'Seerr: list users failed: redirect (HTTP 302). Seerr redirects: check the address',
      );
      expect((await api().check(MOCK_SERVER_ID)).problems).toEqual(['unreachable']);
      expect(elsewhere.requests).toEqual([]);
    } finally {
      await elsewhere.close();
    }
  });

  it('gives up after 15 s by default and says so, network failures without the key', async () => {
    expect(new SeerrClient(seerr.url, MOCK_SEERR_API_KEY).timeoutMs).toBe(SEERR_TIMEOUT_MS);
    expect(SEERR_TIMEOUT_MS).toBe(15_000);
    seerr.state.delayMs = 1300;
    const slow = await caught(api({ timeoutMs: 1000 }).listUsers());
    expect(slow).toBeInstanceOf(ProviderError);
    expect(slow.statusCode).toBe(502);
    expect(slow.message).toBe('Seerr: list users failed: no answer within 1 s');
    seerr.state.delayMs = 0;

    const closed = await caught(api({}, MOCK_SEERR_API_KEY, 'http://127.0.0.1:1').listUsers());
    expect(closed).toBeInstanceOf(ProviderError);
    expect(closed.statusCode).toBe(502);
    expect(closed.message).toMatch(/^Seerr: list users failed: /);
    expect(closed.message).not.toContain(MOCK_SEERR_API_KEY);
  });

  it('keeps at most 4 requests in flight, below /api/v1 of the address', async () => {
    await start({ delayMs: 30 });
    const client = new SeerrClient(`${seerr.url}//`, MOCK_SEERR_API_KEY);
    expect(client.baseUrl).toBe(seerr.url);
    await Promise.all(Array.from({ length: 10 }, () => client.request('GET', '/status')));
    expect(seerr.state.maxInFlight).toBe(4);
    expect(lines().every((l) => l === 'GET /status')).toBe(true);

    seerr.state.maxInFlight = 0;
    const two = new SeerrClient(seerr.url, MOCK_SEERR_API_KEY, { maxInFlight: 2 });
    await Promise.all(Array.from({ length: 6 }, () => two.request('GET', '/status')));
    expect(seerr.state.maxInFlight).toBe(2);
  });

  it('hands on answers with keys and passwords already replaced', async () => {
    const client = new SeerrClient(seerr.url, MOCK_SEERR_API_KEY);
    const bodies = await Promise.all(
      ['/settings/main', '/settings/jellyfin', '/settings/network'].map((p) => client.request('GET', p)),
    );
    const text = deep(bodies);
    for (const secret of [MOCK_SEERR_API_KEY, MOCK_SEERR_JELLYFIN_KEY, MOCK_SEERR_PROXY_PASSWORD]) {
      expect(text).not.toContain(secret);
    }
    expect(bodies[1]).toMatchObject({ serverId: MOCK_SERVER_ID, apiKey: '[redacted]' });
  });
});

describe('Seerr check', () => {
  it('passes a safe Seerr of the same server and asks GitHub nothing', async () => {
    const result = await api().check(MOCK_SERVER_ID);
    expect(result).toEqual({
      version: '3.5.1',
      sameServer: true,
      newSignIns: false,
      defaultPermissions: 0,
      mediaServerLogin: true,
      localLogin: true,
      csrfProtection: false,
      problems: [],
    });
    expect(lines()).toEqual([
      'GET /status',
      'GET /settings/main',
      'GET /settings/jellyfin',
      'GET /settings/network',
    ]);
    const status = seerr.requests[0]!;
    expect(status.query.has('checkUpdateAvailable')).toBe(true);
    expect(status.query.get('checkUpdateAvailable')).toBe('');
    expect(seerr.state.githubChecks).toBe(0);
    // The mock counts a status call without the parameter (versionCheck on).
    await fetch(`${seerr.url}/api/v1/status`);
    expect(seerr.state.githubChecks).toBe(1);
  });

  it('finds each problem from its setting', async () => {
    const problems = async (options: MockSeerrOptions, serverId: string | null = MOCK_SERVER_ID) => {
      await start(options);
      return (await api().check(serverId)).problems;
    };
    expect(await problems({ fresh: true })).toEqual(['new_signins', 'default_permissions']);
    expect(await problems({ main: { newPlexLogin: true } })).toEqual(['new_signins']);
    expect(await problems({ main: { defaultPermissions: 32 } })).toEqual(['default_permissions']);
    expect(await problems({ main: { mediaServerLogin: false } })).toEqual(['media_server_login']);
    expect(await problems({ main: { mediaServerType: 1 } })).toEqual(['not_jellyfin']);
    expect(await problems({ csrf: true })).toEqual(['csrf']);
    // Same server whatever the form of the id.
    expect(await problems({ serverId: dashed(MOCK_SERVER_ID) })).toEqual([]);
    expect(await problems({ serverId: MOCK_SERVER_ID.toUpperCase() })).toEqual([]);
    expect(await problems({ serverId: OTHER_SERVER })).toEqual(['other_server']);
    expect(await problems({ serverId: dashed(OTHER_SERVER) })).toEqual(['other_server']);
    expect(await problems({ serverId: '' })).toEqual(['other_server']);
    // The Jellyfin side could not tell its id: the same server is not confirmed.
    await start();
    const unknown = await api().check(null);
    expect(unknown.sameServer).toBeNull();
    expect(unknown.problems).toEqual(['other_server']);

    await start({ fresh: true, csrf: true, serverId: OTHER_SERVER, main: { mediaServerLogin: false } });
    expect((await api().check(MOCK_SERVER_ID)).problems).toEqual([
      'other_server',
      'csrf',
      'new_signins',
      'default_permissions',
      'media_server_login',
    ]);
  });

  it('stops at a rejected key and at a Seerr without usable answers', async () => {
    const wrongKey = 'd3Jvbmcta2V5LXdyb25nLWtleS13cm9uZw==';
    const wrong = await api({}, wrongKey).check(MOCK_SERVER_ID);
    expect(wrong).toMatchObject({ version: '3.5.1', newSignIns: null, sameServer: null, problems: ['key'] });
    // The reason for staff names the rejected key's hint, never the key.
    expect(wrong.error).toContain('The API key was rejected');
    expect(wrong.error).not.toContain(wrongKey);
    expect(lines()).toEqual(['GET /status', 'GET /settings/main']);

    const closed = await api({}, MOCK_SEERR_API_KEY, 'http://127.0.0.1:1').check(MOCK_SERVER_ID);
    expect(closed).toEqual({
      version: null,
      sameServer: null,
      newSignIns: null,
      defaultPermissions: null,
      mediaServerLogin: null,
      localLogin: null,
      csrfProtection: null,
      problems: ['unreachable'],
      error: expect.stringContaining('read the status failed'),
    });
    expect(closed.error).not.toContain(MOCK_SEERR_API_KEY);

    const failing = async (path: string, answer: { status: number; text?: string; json?: unknown }) => {
      seerr.requests.length = 0;
      seerr.state.override = (req) => (req.path === path ? answer : undefined);
      return api().check(MOCK_SERVER_ID);
    };
    const gateway = await failing('/status', { status: 502, text: 'Bad Gateway' });
    expect(gateway.problems).toEqual(['unreachable']);
    expect(gateway.error).toContain('Seerr or its proxy is not available');
    expect(lines()).toEqual(['GET /status']);
    // A proxy's 403 on the public status is no key problem.
    expect((await failing('/status', { status: 403, text: 'Forbidden' })).problems).toEqual(['unreachable']);
    expect((await failing('/settings/main', { status: 500, json: { message: 'boom' } })).problems).toEqual([
      'unreachable',
    ]);
    expect((await failing('/settings/main', { status: 200, text: '<html></html>' })).problems).toEqual([
      'unreachable',
    ]);
    const jellyfin = await failing('/settings/jellyfin', { status: 500, json: { message: 'boom' } });
    expect(jellyfin.problems).toEqual(['unreachable']);
    expect(jellyfin.newSignIns).toBe(false);
    expect((await failing('/settings/network', { status: 403, json: { error: 'no' } })).problems).toEqual([
      'key',
    ]);
    // Seerr behind the wrong address: its web app answers HTML for everything.
    seerr.state.override = undefined;
    const site = await api({}, MOCK_SEERR_API_KEY, `${seerr.url}/requests`).check(MOCK_SERVER_ID);
    expect(site.problems).toEqual(['unreachable']);
  });

  it('returns settings values only: no key, Jellyfin key or proxy password (deep scan)', async () => {
    await start({ fresh: true, csrf: true });
    const result = await api().check(MOCK_SERVER_ID);
    const text = deep(result);
    for (const secret of [MOCK_SEERR_API_KEY, MOCK_SEERR_JELLYFIN_KEY, MOCK_SEERR_PROXY_PASSWORD]) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toMatch(/apikey|password|redacted/i);
    expect(Object.keys(result).sort()).toEqual(
      [
        'csrfProtection',
        'defaultPermissions',
        'localLogin',
        'mediaServerLogin',
        'newSignIns',
        'problems',
        'sameServer',
        'version',
      ].sort(),
    );
  });
});

describe('Seerr recommended settings', () => {
  it('sends exactly the three fields, never apiKey, and leaves every other setting alone', async () => {
    await start({ fresh: true });
    const before = structuredClone(seerr.state.main);
    const result = await api().applySafeSettings(MOCK_SERVER_ID);
    expect(result.problems).toEqual([]);
    const post = seerr.requests.find((r) => r.method === 'POST')!;
    expect(post.path).toBe('/settings/main');
    expect(post.body).toEqual({ newPlexLogin: false, defaultPermissions: 0, mediaServerLogin: true });
    expect(post.body).toEqual(SEERR_SAFE_SETTINGS);
    expect(Object.keys(post.body as object)).not.toContain('apiKey');
    expect(seerr.state.main).toEqual({ ...before, ...SEERR_SAFE_SETTINGS });
    expect(seerr.state.main.apiKey).toBe(MOCK_SEERR_API_KEY);
    expect(lines()).toEqual([
      'POST /settings/main',
      'GET /status',
      'GET /settings/main',
      'GET /settings/jellyfin',
      'GET /settings/network',
    ]);
    expect(deep(result)).not.toContain(MOCK_SEERR_API_KEY);
  });

  it('mimics Seerr refusing a read-only apiKey in the body (mock check)', async () => {
    const res = await fetch(`${seerr.url}/api/v1/settings/main`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': MOCK_SEERR_API_KEY },
      body: JSON.stringify({ apiKey: 'new', newPlexLogin: false }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toBe('request/body/apiKey is read-only');
    expect(seerr.state.main.apiKey).toBe(MOCK_SEERR_API_KEY);
  });

  it('names CSRF protection when Seerr refuses the write', async () => {
    await start({ fresh: true, csrf: true });
    const err = await caught(api().applySafeSettings(MOCK_SERVER_ID));
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).upstreamStatus).toBe(403);
    expect(err.message).toBe(
      "Seerr: apply the recommended settings failed: invalid csrf token (HTTP 403). Seerr's CSRF protection is on: switch it off under Settings > Network",
    );
    expect(seerr.state.main.newPlexLogin).toBe(true);
  });
});

describe('Seerr users', () => {
  it('lists every page in creation order and drops emails and names (deep scan)', async () => {
    for (let i = 0; i < 249; i++) {
      seerr.addUser({
        email: `kunde-${i}@example.ch`,
        username: `Kunde ${i}`,
        jellyfinUsername: `kunde-${i}`,
        jellyfinUserId: i % 2 ? i.toString(16).padStart(32, 'a') : null,
        permissions: i % 3 ? P.REQUEST_MOVIE : 0,
      });
    }
    const users = await api().listUsers();
    expect(users).toHaveLength(250);
    expect(users.map((u) => u.id)).toEqual(Array.from({ length: 250 }, (_, i) => i + 1));
    expect(lines()).toEqual(['GET /user', 'GET /user', 'GET /user']);
    expect(seerr.requests.map((r) => r.query.toString())).toEqual([
      'take=100&skip=0&sort=created',
      'take=100&skip=100&sort=created',
      'take=100&skip=200&sort=created',
    ]);
    for (const user of users) {
      expect(Object.keys(user).sort()).toEqual(
        [
          'id',
          'jellyfinUserId',
          'movieQuotaDays',
          'movieQuotaLimit',
          'permissions',
          'tvQuotaDays',
          'tvQuotaLimit',
        ].sort(),
      );
    }
    const text = deep(users);
    expect(text).not.toMatch(/kunde|example\.ch|weblion\.one|admin|avatar/i);
    expect(users[0]).toEqual({
      id: 1,
      jellyfinUserId: '84bb1f65fce351e5962eb84c1645fa51',
      permissions: P.ADMIN,
      movieQuotaLimit: null,
      movieQuotaDays: null,
      tvQuotaLimit: null,
      tvQuotaDays: null,
    });
  });

  it('counts a user seen twice once and refuses an empty or odd answer', async () => {
    for (let i = 0; i < 150; i++) seerr.addUser({ email: `kunde-${i}` });
    // A user that sorts first shows up while reading: the second page starts with the last
    // user of the first one (user 100), and the newcomer itself is not seen this time.
    let added = false;
    seerr.state.override = (req) => {
      if (req.path === '/user' && req.query.get('skip') === '100' && !added) {
        added = true;
        seerr.addUser({ email: 'spaet', createdAt: '2026-01-01T00:00:00.000Z' });
      }
      return undefined;
    };
    const users = await api().listUsers();
    expect(seerr.requests.map((r) => r.query.get('skip'))).toEqual(['0', '100']);
    expect(users.map((u) => u.id)).toEqual(Array.from({ length: 151 }, (_, i) => i + 1));

    seerr.state.override = (req) =>
      req.path === '/user' ? { json: { pageInfo: { pages: 0 }, results: [] } } : undefined;
    expect((await caught(api().listUsers())).message).toBe('Seerr: list users failed: unexpected answer');
    seerr.state.override = (req) =>
      req.path === '/user' ? { text: '<html></html>', contentType: 'text/html' } : undefined;
    expect((await caught(api().listUsers())).message).toBe('Seerr: list users failed: unexpected answer');
  });

  it('stops after 100 pages', async () => {
    seerr.state.override = (req) =>
      req.path === '/user'
        ? {
            json: {
              pageInfo: { pages: 500 },
              results: [{ id: Number(req.query.get('skip')) + 1, permissions: 0 }],
            },
          }
        : undefined;
    const users = await api().listUsers();
    expect(users).toHaveLength(100);
    expect(seerr.requests).toHaveLength(100);
  });

  it('imports a new Jellyfin user with one request', async () => {
    seerr.addJellyfinUser(ANNA_JF, 'anna-kemaro');
    const user = await api().importUser(dashed(ANNA_JF));
    expect(user).toEqual({
      id: 2,
      jellyfinUserId: ANNA_JF,
      permissions: 0,
      movieQuotaLimit: null,
      movieQuotaDays: null,
      tvQuotaLimit: null,
      tvQuotaDays: null,
    });
    expect(lines()).toEqual(['POST /user/import-from-jellyfin']);
    expect(seerr.requests[0]!.body).toEqual({ jellyfinUserIds: [ANNA_JF] });
    expect(seerr.state.users.get(2)).toMatchObject({ email: 'anna-kemaro', settings: null });
  });

  it('finds a user Seerr knows already (the import answers an empty list)', async () => {
    const anna = imported(ANNA_JF, 'anna-kemaro', { permissions: P.REQUEST_MOVIE, movieQuotaLimit: 5 });
    const user = await api().importUser(ANNA_JF);
    expect(user).toMatchObject({
      id: anna.id,
      jellyfinUserId: ANNA_JF,
      permissions: P.REQUEST_MOVIE,
      movieQuotaLimit: 5,
    });
    expect(lines()).toEqual(['POST /user/import-from-jellyfin', `GET /user/jellyfin/${ANNA_JF}`]);
    expect(seerr.state.users.size).toBe(2);
  });

  it('maps an id Seerr cannot import and a lookup that finds nobody', async () => {
    const unknown = await caught(api().importUser(UNKNOWN_JF));
    expect(unknown).toBeInstanceOf(ProviderError);
    expect(unknown.statusCode).toBe(404);
    expect(unknown.message).toBe(
      'Seerr: Seerr did not import the user: is it connected to this Jellyfin server? (SQLITE_CONSTRAINT: UNIQUE constraint failed: user.email)',
    );

    // Seerr skipped the id and does not know it either.
    seerr.state.override = (req) =>
      req.path === '/user/import-from-jellyfin' ? { status: 201, json: [] } : undefined;
    const nobody = await caught(api().importUser(UNKNOWN_JF));
    expect(nobody.statusCode).toBe(404);
    expect(nobody.message).toBe(
      'Seerr: Seerr did not import the user: is it connected to this Jellyfin server?',
    );
    expect(lines().slice(-1)).toEqual([`GET /user/jellyfin/${UNKNOWN_JF}`]);

    seerr.requests.length = 0;
    expect((await caught(api().importUser('not-an-id'))).statusCode).toBe(400);
    expect((await caught(api().importUser('0'.repeat(32)))).statusCode).toBe(400);
    expect(seerr.requests).toEqual([]);

    seerr.state.override = (req) =>
      req.path === '/user/import-from-jellyfin'
        ? { status: 403, json: { message: 'invalid csrf token' } }
        : undefined;
    expect((await caught(api().importUser(ANNA_JF))).message).toContain("Seerr's CSRF protection is on");
  });

  it('reads one user, 404 as not found', async () => {
    const anna = imported(ANNA_JF, 'anna-kemaro');
    expect((await api().getUser(anna.id)).jellyfinUserId).toBe(ANNA_JF);
    const missing = await caught(api().getUser(99));
    expect(missing.statusCode).toBe(404);
    expect((missing as ProviderError).upstreamStatus).toBe(404);
    expect((await caught(api().getUser(0))).statusCode).toBe(400);
  });
});

describe('Seerr access', () => {
  it('grants a fresh import: settings as the user first, quotas as the owner, rights last', async () => {
    seerr.addJellyfinUser(ANNA_JF, 'anna-kemaro');
    const a = api();
    const fresh = await a.importUser(ANNA_JF);
    seerr.requests.length = 0;
    const owner = structuredClone(seerr.state.users.get(1));

    const after = await a.setAccess(fresh.id, MUSTER, fresh);
    const id = fresh.id;
    expect(lines()).toEqual([
      `GET /user/${id}/settings/main`,
      `POST /user/${id}/settings/main`,
      `POST /user/${id}/settings/main`,
      `POST /user/${id}/settings/permissions`,
      `GET /user/${id}`,
    ]);
    const [, create, quotas, permissions] = seerr.requests;
    expect(create!.headers['x-api-user']).toBe(String(id));
    // Exactly as read: the import set no username (null) and no settings (fields left out).
    expect(create!.body).toEqual({ username: null, email: 'anna-kemaro' });
    expect(quotas!.headers['x-api-user']).toBeUndefined();
    expect(quotas!.body).toEqual({
      username: null,
      email: 'anna-kemaro',
      locale: '',
      discoverRegion: null,
      streamingRegion: null,
      originalLanguage: null,
      watchlistSyncMovies: null,
      watchlistSyncTv: null,
      movieQuotaLimit: 5,
      movieQuotaDays: 30,
      tvQuotaLimit: 3,
      tvQuotaDays: 30,
    });
    expect(permissions!.body).toEqual({ permissions: P.REQUEST_MOVIE | P.REQUEST_TV });

    const user = seerr.state.users.get(id)!;
    expect(user.settings?.linkedTo).toBe(id);
    expect(seerr.state.foreignSettings).toEqual([]);
    expect(user).toMatchObject({
      email: 'anna-kemaro',
      permissions: P.REQUEST_MOVIE | P.REQUEST_TV,
      movieQuotaLimit: 5,
      movieQuotaDays: 30,
      tvQuotaLimit: 3,
      tvQuotaDays: 30,
    });
    expect(after).toEqual({ ...remote(user) });
    // The owner was never touched.
    expect(seerr.state.users.get(1)).toEqual(owner);
  });

  it('mimics Seerr linking settings to the owner when it writes them for a user without (mock check)', async () => {
    const anna = imported(ANNA_JF, 'anna-kemaro');
    const res = await fetch(`${seerr.url}/api/v1/user/${anna.id}/settings/main`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': MOCK_SEERR_API_KEY },
      body: JSON.stringify({ email: 'anna-kemaro', movieQuotaLimit: 5, movieQuotaDays: 30 }),
    });
    expect(res.status).toBe(200);
    expect(seerr.state.foreignSettings).toEqual([anna.id]);
    expect(seerr.state.users.get(anna.id)?.settings?.linkedTo).toBe(1);
  });

  it('writes settings once when the user has them, as read, and 0 for no limit', async () => {
    const anna = imported(ANNA_JF, 'anna-kemaro', {
      username: 'Anna',
      permissions: P.REQUEST_MOVIE,
      movieQuotaLimit: 5,
      movieQuotaDays: 30,
      settings: {
        linkedTo: 0,
        locale: 'de',
        discoverRegion: 'CH',
        streamingRegion: 'CH',
        originalLanguage: 'de',
        watchlistSyncMovies: false,
        watchlistSyncTv: false,
      },
    });
    anna.settings!.linkedTo = anna.id;
    const unlimited: SeerrUserAccess = { ...NONE, permissions: P.REQUEST_MOVIE | P.REQUEST_TV };
    const after = await api().setAccess(anna.id, unlimited, remote(anna));
    expect(lines()).toEqual([
      `GET /user/${anna.id}/settings/main`,
      `POST /user/${anna.id}/settings/main`,
      `POST /user/${anna.id}/settings/permissions`,
      `GET /user/${anna.id}`,
    ]);
    expect(seerr.requests.every((r) => r.headers['x-api-user'] === undefined)).toBe(true);
    expect(seerr.requests[1]!.body).toEqual({
      username: 'Anna',
      email: 'anna-kemaro',
      locale: 'de',
      discoverRegion: 'CH',
      streamingRegion: 'CH',
      originalLanguage: 'de',
      watchlistSyncMovies: false,
      watchlistSyncTv: false,
      movieQuotaLimit: 0,
      movieQuotaDays: 0,
      tvQuotaLimit: 0,
      tvQuotaDays: 0,
    });
    // "No limit" is an explicit 0, never left unset (Seerr's default quota would apply).
    expect(after).toMatchObject({ movieQuotaLimit: 0, movieQuotaDays: 0, tvQuotaLimit: 0, tvQuotaDays: 0 });
    expect(seerr.state.users.get(anna.id)).toMatchObject({ username: 'Anna', email: 'anna-kemaro' });
    seerr.state.main.defaultQuotas = {
      movie: { quotaLimit: 2, quotaDays: 7 },
      tv: { quotaLimit: 1, quotaDays: 7 },
    };
    seerr.addRequest({ requestedBy: anna.id, type: 'movie', status: 1, tmdbId: 603, title: 'The Matrix' });
    const quota = await (
      await fetch(`${seerr.url}/api/v1/user/${anna.id}/quota`, {
        headers: { 'X-Api-Key': MOCK_SEERR_API_KEY },
      })
    ).json();
    expect(quota).toMatchObject({ movie: { limit: 0, restricted: false }, tv: { limit: 0 } });
  });

  it('revokes with one permissions write and leaves the quotas alone', async () => {
    const anna = imported(ANNA_JF, 'anna-kemaro', {
      permissions: P.REQUEST_MOVIE | P.REQUEST_TV,
      movieQuotaLimit: 5,
      movieQuotaDays: 30,
    });
    const after = await api().setAccess(anna.id, NONE, remote(anna));
    expect(lines()).toEqual([`POST /user/${anna.id}/settings/permissions`, `GET /user/${anna.id}`]);
    expect(seerr.requests[0]!.body).toEqual({ permissions: 0 });
    expect(after).toMatchObject({ permissions: 0, movieQuotaLimit: 5, movieQuotaDays: 30 });

    // Also when the caller's copy is stale: a revocation is always written.
    seerr.requests.length = 0;
    seerr.state.users.get(anna.id)!.permissions = P.REQUEST;
    await api().setAccess(anna.id, NONE, { ...remote(anna), permissions: 0 });
    expect(seerr.state.users.get(anna.id)!.permissions).toBe(0);
  });

  it('takes manager rights away first, or Seerr ignores the quotas', async () => {
    const boss = imported(ANNA_JF, 'anna-kemaro', {
      permissions: P.MANAGE_USERS | P.MANAGE_REQUESTS | P.REQUEST,
    });
    const after = await api().setAccess(boss.id, MUSTER, remote(boss));
    expect(lines()).toEqual([
      `POST /user/${boss.id}/settings/permissions`,
      `GET /user/${boss.id}/settings/main`,
      `POST /user/${boss.id}/settings/main`,
      `POST /user/${boss.id}/settings/main`,
      `GET /user/${boss.id}`,
    ]);
    expect(after).toEqual({ ...remote(boss), ...MUSTER, id: boss.id, jellyfinUserId: ANNA_JF });
    expect(seerr.state.users.get(boss.id)).toMatchObject({
      permissions: MUSTER.permissions,
      movieQuotaLimit: 5,
    });
  });

  it('refuses the owner, staff rights and any bit beyond requests without a request', async () => {
    const anna = imported(ANNA_JF, 'anna-kemaro', { permissions: P.REQUEST_MOVIE | P.VOTE });
    const owner = remote(seerr.state.users.get(1)!);
    const refusedOwner = await caught(api().setAccess(1, NONE, owner));
    expect(refusedOwner.statusCode).toBe(409);
    expect(refusedOwner.message).toBe("The console never changes Seerr's owner (user 1)");
    expect((await caught(api().deleteUser(1))).statusCode).toBe(409);
    for (const bit of [
      P.ADMIN,
      P.MANAGE_USERS,
      P.AUTO_APPROVE,
      P.AUTO_APPROVE_MOVIE,
      P.REQUEST_4K,
      P.REQUEST_VIEW,
      P.REQUEST,
    ]) {
      const err = await caught(
        api().setAccess(anna.id, { ...MUSTER, permissions: MUSTER.permissions | bit }, remote(anna)),
      );
      expect(err.statusCode).toBe(400);
    }
    expect(
      (await caught(api().setAccess(anna.id, { ...MUSTER, movieQuotaLimit: -1 }, remote(anna)))).statusCode,
    ).toBe(400);
    expect(
      (await caught(api().setAccess(anna.id, { ...MUSTER, tvQuotaDays: 1.5 }, remote(anna)))).statusCode,
    ).toBe(400);
    expect(seerr.requests).toEqual([]);
    // Taking request bits away keeps a bit the user had (the sync's revocation of unmanaged users).
    await api().setAccess(anna.id, { ...NONE, permissions: P.VOTE }, remote(anna));
    expect(seerr.state.users.get(anna.id)!.permissions).toBe(P.VOTE);
  });

  it('throws when Seerr did not keep the change, and does nothing when nothing differs', async () => {
    const anna = imported(ANNA_JF, 'anna-kemaro');
    seerr.state.override = (req) =>
      req.path.endsWith('/settings/permissions') ? { json: { permissions: MUSTER.permissions } } : undefined;
    const err = await caught(api().setAccess(anna.id, MUSTER, remote(anna)));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toBe('Seerr: Seerr did not keep the change (permissions)');

    const ben = imported(BEN_JF, 'ben-kemaro');
    seerr.state.override = (req) =>
      req.method === 'POST' && req.path.endsWith('/settings/main') ? { json: {} } : undefined;
    const quotas = await caught(api().setAccess(ben.id, MUSTER, remote(ben)));
    expect(quotas.message).toBe('Seerr: Seerr did not keep the change (movieQuota, tvQuota)');
    seerr.state.override = undefined;

    await api().setAccess(anna.id, MUSTER, remote(seerr.state.users.get(anna.id)!));
    seerr.requests.length = 0;
    const same = remote(seerr.state.users.get(anna.id)!);
    expect(await api().setAccess(anna.id, MUSTER, same)).toEqual(same);
    expect(seerr.requests).toEqual([]);
  });

  it('maps a user deleted meanwhile to not found and an unknown acting user', async () => {
    const anna = imported(ANNA_JF, 'anna-kemaro');
    const gone = remote(anna);
    seerr.state.users.delete(anna.id);
    const err = await caught(api().setAccess(anna.id, MUSTER, gone));
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe(`Seerr: Seerr user ${anna.id} not found`);

    // The settings answer came, then the user vanished before the creation as itself.
    const ben = imported(BEN_JF, 'ben-kemaro');
    seerr.state.override = (req) => {
      if (req.headers['x-api-user']) seerr.state.users.delete(ben.id);
      return undefined;
    };
    const vanished = await caught(api().setAccess(ben.id, MUSTER, remote(ben)));
    expect(vanished.message).toContain('Seerr does not know this user (any more)');
    expect(vanished.message).not.toContain('API key');
  });

  it('never interleaves two writes to the same user', async () => {
    seerr.addJellyfinUser(ANNA_JF, 'anna-kemaro');
    const a = api();
    const fresh = await a.importUser(ANNA_JF);
    seerr.requests.length = 0;
    seerr.state.delayMs = 10;
    await Promise.all([
      a.setAccess(fresh.id, MUSTER, fresh),
      a.setAccess(fresh.id, NONE, { ...fresh, permissions: 1 << 18 }),
    ]);
    expect(lines()).toEqual([
      `GET /user/${fresh.id}/settings/main`,
      `POST /user/${fresh.id}/settings/main`,
      `POST /user/${fresh.id}/settings/main`,
      `POST /user/${fresh.id}/settings/permissions`,
      `GET /user/${fresh.id}`,
      `POST /user/${fresh.id}/settings/permissions`,
      `GET /user/${fresh.id}`,
    ]);
    expect(seerr.state.users.get(fresh.id)!.permissions).toBe(0);
  });
});

describe('Seerr delete', () => {
  it('deletes the user with its requests, 404 counts as done, 405 is a 409', async () => {
    const anna = imported(ANNA_JF, 'anna-kemaro');
    seerr.addRequest({ requestedBy: anna.id, type: 'movie', status: 1, tmdbId: 603, title: 'The Matrix' });
    seerr.addRequest({ requestedBy: 1, type: 'movie', status: 5, tmdbId: 604, title: 'The Matrix Reloaded' });
    await api().deleteUser(anna.id);
    expect(lines()).toEqual([`DELETE /user/${anna.id}`]);
    expect(seerr.state.users.has(anna.id)).toBe(false);
    expect(seerr.state.requests.map((r) => r.requestedBy)).toEqual([1]);

    await api().deleteUser(anna.id);
    await api().deleteUser(4711);

    seerr.state.override = (req) =>
      req.method === 'DELETE'
        ? { status: 405, json: { message: 'You cannot delete users with administrative privileges.' } }
        : undefined;
    const refused = await caught(api().deleteUser(5));
    expect(refused).toBeInstanceOf(ProviderError);
    expect(refused.statusCode).toBe(502);
    expect((refused as ProviderError).upstreamStatus).toBe(409);
    expect(refused.message).toBe('Seerr: Seerr refuses to delete this user (owner or administrator)');

    seerr.state.override = (req) =>
      req.method === 'DELETE' ? { status: 500, json: { message: 'boom' } } : undefined;
    expect((await caught(api().deleteUser(5))).message).toBe(
      'Seerr: delete Seerr user 5 failed: boom (HTTP 500)',
    );
  });
});

describe('Seerr numbers', () => {
  const STATUSES = [1, 2, 3, 4, 5];

  function fill(count: number, users: number[]) {
    for (let i = 0; i < count; i++) {
      seerr.addRequest({
        requestedBy: users[i % users.length]!,
        type: i % 2 ? 'tv' : 'movie',
        status: STATUSES[i % STATUSES.length]!,
        tmdbId: 9000 + i,
        title: `Geheimer Titel ${i}`,
      });
    }
  }

  function expected(users: number[]) {
    const out = new Map<number, { pending: number; approved: number; available: number }>();
    for (const request of seerr.state.requests) {
      if (!users.includes(request.requestedBy)) continue;
      const counts = out.get(request.requestedBy) ?? { pending: 0, approved: 0, available: 0 };
      if (request.status === 1) counts.pending++;
      if (request.status === 2) counts.approved++;
      if (request.status === 5) counts.available++;
      out.set(request.requestedBy, counts);
    }
    return out;
  }

  it('aggregates three pages by requester, a request seen twice counted once (deep scan)', async () => {
    const anna = imported(ANNA_JF, 'anna-kemaro');
    const ben = imported(BEN_JF, 'ben-kemaro');
    const users = [1, anna.id, ben.id];
    fill(250, users);
    const want = expected(users);
    // A new request while reading: the newest come first, so the second page repeats one.
    let added = false;
    seerr.state.override = (req) => {
      if (req.path === '/request' && req.query.get('skip') === '100' && !added) {
        added = true;
        seerr.addRequest({ requestedBy: anna.id, type: 'movie', status: 1, tmdbId: 1, title: 'Neu' });
      }
      return undefined;
    };
    const counts = await api().requestCounts();
    expect(counts.complete).toBe(true);
    expect(lines()).toEqual(['GET /request', 'GET /request', 'GET /request']);
    expect(seerr.requests.map((r) => r.query.toString())).toEqual([
      'take=100&skip=0',
      'take=100&skip=100',
      'take=100&skip=200',
    ]);
    expect(counts.byUser).toEqual(want);
    const total = [...counts.byUser.values()].reduce((s, c) => s + c.pending + c.approved + c.available, 0);
    expect(total).toBe(150);
    const text = deep(counts);
    expect(text).not.toMatch(/geheimer|titel|tt00|tmdb|9\d{3}|anna|ben-|weblion\.one|movie|tv/i);
  });

  it('reads at most 50 pages: 51 give complete: false, 50 complete', async () => {
    fill(5100, [1]);
    const partial = await api().requestCounts();
    expect(partial.complete).toBe(false);
    expect(seerr.requests).toHaveLength(50);
    expect(seerr.requests.at(-1)!.query.get('skip')).toBe('4900');

    await start();
    fill(5000, [1]);
    const whole = await api().requestCounts();
    expect(whole.complete).toBe(true);
    expect(seerr.requests).toHaveLength(50);
    expect(whole.byUser.get(1)).toEqual({ pending: 1000, approved: 1000, available: 1000 });

    await start();
    const none = await api().requestCounts();
    expect(none).toEqual({ byUser: new Map(), complete: true });
    seerr.state.override = () => ({ json: { results: 'x' } });
    expect((await caught(api().requestCounts())).message).toBe(
      'Seerr: count requests failed: unexpected answer',
    );
  });

  it('reads the quota usage: requests in the movie window, seasons in the TV window', async () => {
    const anna = imported(ANNA_JF, 'anna-kemaro', {
      permissions: MUSTER.permissions,
      movieQuotaLimit: 5,
      movieQuotaDays: 30,
      tvQuotaLimit: 3,
      tvQuotaDays: 30,
    });
    seerr.addRequest({ requestedBy: anna.id, type: 'movie', status: 1, tmdbId: 603, title: 'The Matrix' });
    seerr.addRequest({ requestedBy: anna.id, type: 'movie', status: 5, tmdbId: 604, title: 'Reloaded' });
    seerr.addRequest({ requestedBy: anna.id, type: 'movie', status: 3, tmdbId: 605, title: 'Declined' });
    seerr.addRequest({ requestedBy: anna.id, type: 'tv', status: 2, tmdbId: 1399, title: 'Got', seasons: 2 });
    expect(await api().quotaUsage(anna.id)).toEqual({ movieUsed: 2, tvUsed: 2 });
    expect(lines()).toEqual([`GET /user/${anna.id}/quota`]);
    const missing = await caught(api().quotaUsage(99));
    expect(missing.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// The Jellyfin adapter's Seerr part

describe('Jellyfin adapter with Seerr', () => {
  let jellyfin: JellyfinMock;

  beforeEach(async () => {
    jellyfin = await startJellyfinMock();
  });

  afterEach(async () => {
    await jellyfin.close();
  });

  const adapter = (config: Partial<JellyfinConfig> = {}) =>
    new JellyfinAdapter({
      baseUrl: jellyfin.url,
      apiKey: MOCK_API_KEY,
      seerrUrl: seerr.url,
      seerrApiKey: MOCK_SEERR_API_KEY,
      ...config,
    });

  it('has no Seerr without address and key, and refuses its methods without a request', async () => {
    const without = new JellyfinAdapter({ baseUrl: jellyfin.url, apiKey: MOCK_API_KEY });
    expect(without.seerrConfigured()).toBe(false);
    expect(without.seerrUrl()).toBeNull();
    const half = new JellyfinAdapter({ baseUrl: jellyfin.url, apiKey: MOCK_API_KEY, seerrUrl: seerr.url });
    expect(half.seerrConfigured()).toBe(false);
    expect(half.seerrUrl()).toBe(seerr.url);
    const keyOnly = new JellyfinAdapter({
      baseUrl: jellyfin.url,
      apiKey: MOCK_API_KEY,
      seerrApiKey: MOCK_SEERR_API_KEY,
    });
    expect(keyOnly.seerrConfigured()).toBe(false);

    const calls: Promise<unknown>[] = [
      without.seerrCheck(),
      without.seerrApplySafeSettings(),
      without.listSeerrUsers(),
      without.importSeerrUser(ANNA_JF),
      without.setSeerrUserAccess(2, MUSTER, { ...remote(seerr.state.users.get(1)!), id: 2 }),
      without.deleteSeerrUser(2),
      without.seerrRequestCounts(),
      without.seerrQuotaUsage(2),
      half.seerrCheck(),
    ];
    for (const call of calls) {
      const err = await caught(call);
      expect(err.statusCode).toBe(422);
      expect(err.code).toBe('unsupported');
    }
    expect(seerr.requests).toEqual([]);
    expect(jellyfin.requests).toEqual([]);
  });

  it("checks against its own Jellyfin server's id and applies the recommended settings", async () => {
    const a = adapter();
    expect(a.seerrConfigured()).toBe(true);
    expect(a.seerrUrl()).toBe(seerr.url);
    expect((await a.seerrCheck()).sameServer).toBe(true);
    expect(jellyfin.requests.some((r) => r.path.toLowerCase() === '/system/info')).toBe(true);

    await start({ fresh: true, serverId: dashed(MOCK_SERVER_ID) });
    const b = adapter();
    expect((await b.seerrCheck()).problems).toEqual(['new_signins', 'default_permissions']);
    expect((await b.seerrApplySafeSettings()).problems).toEqual([]);

    await start({ serverId: OTHER_SERVER });
    expect((await adapter().seerrCheck()).problems).toEqual(['other_server']);

    // Jellyfin cannot tell its id: Jellyfin's error, not a Seerr problem.
    const down = new JellyfinAdapter({
      baseUrl: 'http://127.0.0.1:1',
      apiKey: MOCK_API_KEY,
      seerrUrl: seerr.url,
      seerrApiKey: MOCK_SEERR_API_KEY,
    });
    const err = await caught(down.seerrCheck());
    expect(err.message).toMatch(/^Jellyfin: read the server info failed/);
  });

  it('delegates users, access, numbers and delete to the Seerr of the connection', async () => {
    const a = adapter();
    seerr.addJellyfinUser(ANNA_JF, 'anna-kemaro');
    const fresh = await a.importSeerrUser(ANNA_JF);
    const set = await a.setSeerrUserAccess(fresh.id, MUSTER, fresh);
    expect(set).toMatchObject({ permissions: MUSTER.permissions, movieQuotaLimit: 5, tvQuotaLimit: 3 });
    expect((await a.listSeerrUsers()).map((u) => u.id)).toEqual([1, fresh.id]);
    seerr.addRequest({ requestedBy: fresh.id, type: 'movie', status: 1, tmdbId: 603, title: 'The Matrix' });
    expect((await a.seerrRequestCounts()).byUser.get(fresh.id)).toEqual({
      pending: 1,
      approved: 0,
      available: 0,
    });
    expect(await a.seerrQuotaUsage(fresh.id)).toEqual({ movieUsed: 1, tvUsed: 0 });
    await a.deleteSeerrUser(fresh.id);
    expect(seerr.state.users.has(fresh.id)).toBe(false);
    // None of this asked Jellyfin anything.
    expect(jellyfin.requests).toEqual([]);
  });

  it('never lets a Seerr failure reach a Jellyfin action', async () => {
    const anna = mockUser('anna-kemaro', { id: ANNA_JF });
    jellyfin.state.users.set(anna.id, anna);
    // Seerr is down.
    const a = adapter({ seerrUrl: 'http://127.0.0.1:1' });
    expect((await a.testConnection()).version).toBe('10.11.11');
    expect((await a.listMediaUsers()).map((u) => u.username)).toContain('anna-kemaro');
    await a.setMediaUserEnabled(ANNA_JF, false);
    await a.deleteMediaUser(ANNA_JF);
    expect((await a.overview()).facts.length).toBeGreaterThan(3);
    expect((await caught(a.listSeerrUsers())).message).toMatch(/^Seerr: list users failed: /);
  });
});
