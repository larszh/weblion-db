import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError, ProviderError } from '../src/lib/errors';
import { DemoAdapter } from '../src/providers/demo/adapter';
import {
  DEMO_MEDIA_IDS,
  demoMediaState,
  jellyfinDefaultPolicy,
  DemoMedia,
} from '../src/providers/demo/media';
import {
  DEMO_SEERR_IDS,
  DEMO_SEERR_REQUEST_SEEDS,
  DEMO_SEERR_URL,
  DEMO_SEERR_VERSION,
  DemoSeerr,
  addDemoSeerrRequest,
  addDemoSeerrUser,
  demoSeerrState,
  resetDemoSeerr,
  type DemoSeerrMethod,
} from '../src/providers/demo/seerr';
import { SEERR_PERMISSION as P, SEERR_SAFE_SETTINGS } from '../src/providers/seerr/rules';
import type { RemoteSeerrUser, SeerrUserAccess } from '../src/providers/types';

/**
 * The demo Seerr follows the rules of the real one as the console uses it (design 14 and 22):
 * the route tests rely on it, so its rules are pinned here without a database.
 */

let connectionId: string;
let seerr: DemoSeerr;
const state = () => demoSeerrState(connectionId);

beforeEach(() => {
  connectionId = randomUUID();
  seerr = new DemoSeerr(demoSeerrState(connectionId));
});

afterEach(() => {
  resetDemoSeerr();
});

/** A Jellyfin user of the demo instance that Seerr does not know yet. */
function jellyfinUser(username = 'neu-kemaro'): string {
  return new DemoMedia(demoMediaState(connectionId)).createMediaUser({
    username,
    password: 'ein-langes-passwort',
    policy: jellyfinDefaultPolicy(),
  }).externalId;
}

const grant: SeerrUserAccess = {
  permissions: P.REQUEST_MOVIE | P.REQUEST_TV,
  movieQuotaLimit: 5,
  movieQuotaDays: 30,
  tvQuotaLimit: 3,
  tvQuotaDays: 30,
};
const none: SeerrUserAccess = {
  permissions: 0,
  movieQuotaLimit: 0,
  movieQuotaDays: 0,
  tvQuotaLimit: 0,
  tvQuotaDays: 0,
};

function refused(fn: () => unknown): AppError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return err as AppError;
  }
  throw new Error('expected a refusal');
}

/** Everything a method answers, as JSON, for scans. */
const dump = (value: unknown) =>
  JSON.stringify(value, (_k, v: unknown) => (v instanceof Map ? Object.fromEntries(v) : v));

describe('start', () => {
  it('has the owner, two managed users and an unmanaged requester, connected to the demo Jellyfin', () => {
    expect(seerr.seerrConfigured()).toBe(true);
    expect(seerr.seerrUrl()).toBe(DEMO_SEERR_URL);
    expect(seerr.listSeerrUsers()).toEqual<RemoteSeerrUser[]>([
      {
        id: 1,
        jellyfinUserId: DEMO_MEDIA_IDS['weblion-admin'],
        permissions: P.ADMIN,
        movieQuotaLimit: null,
        movieQuotaDays: null,
        tvQuotaLimit: null,
        tvQuotaDays: null,
      },
      {
        id: 2,
        jellyfinUserId: DEMO_MEDIA_IDS['anna-kemaro'],
        permissions: P.REQUEST_MOVIE | P.REQUEST_TV,
        movieQuotaLimit: 5,
        movieQuotaDays: 30,
        tvQuotaLimit: 3,
        tvQuotaDays: 30,
      },
      {
        id: 3,
        jellyfinUserId: DEMO_MEDIA_IDS['wohnzimmer-kemaro'],
        permissions: 0,
        movieQuotaLimit: 5,
        movieQuotaDays: 30,
        tvQuotaLimit: 3,
        tvQuotaDays: 30,
      },
      {
        id: 4,
        jellyfinUserId: DEMO_MEDIA_IDS['ben-kemaro'],
        permissions: P.REQUEST,
        movieQuotaLimit: null,
        movieQuotaDays: null,
        tvQuotaLimit: null,
        tvQuotaDays: null,
      },
    ]);
    expect(DEMO_SEERR_IDS).toEqual({
      'weblion-admin': 1,
      'anna-kemaro': 2,
      'wohnzimmer-kemaro': 3,
      'ben-kemaro': 4,
    });
    expect(seerr.seerrCheck()).toEqual({
      version: DEMO_SEERR_VERSION,
      sameServer: true,
      newSignIns: false,
      defaultPermissions: 0,
      mediaServerLogin: true,
      localLogin: true,
      csrfProtection: false,
      problems: [],
    });
  });

  it('counts the requests per user and the quota in its window, numbers only', () => {
    const counts = seerr.seerrRequestCounts();
    expect(counts.complete).toBe(true);
    expect(Object.fromEntries(counts.byUser)).toEqual({
      2: { pending: 1, approved: 1, available: 2 },
      4: { pending: 1, approved: 0, available: 0 },
    });
    // anna-kemaro: two movies in 30 days (the third is 40 days old), one series with two seasons.
    expect(seerr.seerrQuotaUsage(2)).toEqual({ movieUsed: 2, tvUsed: 2 });
    // ben-kemaro has no limit: Seerr counts nothing then.
    expect(seerr.seerrQuotaUsage(4)).toEqual({ movieUsed: 0, tvUsed: 0 });
    const answers = dump([seerr.listSeerrUsers(), counts, seerr.seerrQuotaUsage(2), seerr.seerrCheck()]);
    for (const request of DEMO_SEERR_REQUEST_SEEDS) {
      expect(answers).not.toContain(request.title);
      expect(answers).not.toContain(String(request.tmdbId));
    }
    expect(answers).not.toContain('email');
    expect(answers).not.toContain('anna-kemaro');
  });

  it('keeps every connection apart and forgets everything on reset', () => {
    state().users.delete(2);
    const other = new DemoSeerr(demoSeerrState(randomUUID()));
    expect(other.listSeerrUsers().map((u) => u.id)).toEqual([1, 2, 3, 4]);
    expect(seerr.listSeerrUsers().map((u) => u.id)).toEqual([1, 3, 4]);
    resetDemoSeerr();
    expect(new DemoSeerr(demoSeerrState(connectionId)).listSeerrUsers().map((u) => u.id)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it('is wrapped by the demo adapter', async () => {
    const adapter = new DemoAdapter(connectionId, {});
    expect(adapter.seerrConfigured()).toBe(true);
    expect(adapter.seerrUrl()).toBe(DEMO_SEERR_URL);
    expect((await adapter.listSeerrUsers()).map((u) => u.id)).toEqual([1, 2, 3, 4]);
    expect(await adapter.seerrQuotaUsage(2)).toEqual({ movieUsed: 2, tvUsed: 2 });
    await adapter.deleteSeerrUser(4);
    expect(state().users.has(4)).toBe(false);
  });
});

describe('check and settings', () => {
  it('finds each problem from its setting', () => {
    const settings = state().settings;
    const problems = () => seerr.seerrCheck().problems;
    settings.newPlexLogin = true;
    expect(problems()).toEqual(['new_signins']);
    settings.defaultPermissions = P.REQUEST;
    settings.mediaServerLogin = false;
    expect(problems()).toEqual(['new_signins', 'default_permissions', 'media_server_login']);
    Object.assign(settings, SEERR_SAFE_SETTINGS, { mediaServerType: 1 });
    expect(problems()).toEqual(['not_jellyfin']);
    settings.mediaServerType = 2;
    settings.csrfProtection = true;
    expect(problems()).toEqual(['csrf']);
    settings.csrfProtection = false;
    state().serverId = '0123456789abcdef0123456789abcdef';
    expect(seerr.seerrCheck()).toMatchObject({ sameServer: false, problems: ['other_server'] });
    state().keyRejected = true;
    expect(seerr.seerrCheck()).toMatchObject({
      version: DEMO_SEERR_VERSION,
      newSignIns: null,
      problems: ['key'],
    });
    state().fail.add('seerrCheck');
    expect(seerr.seerrCheck()).toMatchObject({ version: null, problems: ['unreachable'] });
  });

  it('applies exactly the three safe settings and leaves the others', () => {
    Object.assign(state().settings, {
      newPlexLogin: true,
      defaultPermissions: P.REQUEST | P.AUTO_APPROVE,
      mediaServerLogin: false,
      localLogin: false,
    });
    expect(seerr.seerrApplySafeSettings()).toMatchObject({ problems: [], localLogin: false });
    expect(state().settings).toEqual({
      ...SEERR_SAFE_SETTINGS,
      localLogin: false,
      mediaServerType: 2,
      csrfProtection: false,
    });
  });

  it('refuses every write with CSRF protection on and everything with a rejected key', () => {
    state().settings.csrfProtection = true;
    state().settings.newPlexLogin = true;
    expect(refused(() => seerr.seerrApplySafeSettings()).message).toContain('invalid csrf token');
    expect(state().settings.newPlexLogin).toBe(true);
    expect(refused(() => seerr.importSeerrUser(jellyfinUser())).statusCode).toBe(502);
    expect(refused(() => seerr.setSeerrUserAccess(3, grant, seerr.listSeerrUsers()[2]!)).message).toContain(
      'csrf',
    );
    expect(refused(() => seerr.deleteSeerrUser(4)).message).toContain('csrf');
    expect(state().users.has(4)).toBe(true);
    // Reads still work.
    expect(seerr.listSeerrUsers()).toHaveLength(4);
    state().keyRejected = true;
    expect(refused(() => seerr.listSeerrUsers()).message).toContain('The API key was rejected');
    expect(refused(() => seerr.seerrRequestCounts()).message).toContain('HTTP 403');
  });
});

describe('users', () => {
  it('imports an unknown Jellyfin user with the default permissions and no settings, and finds a known one', () => {
    const jellyfinId = jellyfinUser();
    const created = seerr.importSeerrUser(jellyfinId);
    expect(created).toEqual({
      id: 5,
      jellyfinUserId: jellyfinId,
      permissions: 0,
      movieQuotaLimit: null,
      movieQuotaDays: null,
      tvQuotaLimit: null,
      tvQuotaDays: null,
    });
    expect(state().users.get(5)).toMatchObject({ email: 'neu-kemaro', settings: null });
    // Known: found, nothing created (dashes and case as Jellyfin may write the id).
    const dashed = `${jellyfinId.slice(0, 8)}-${jellyfinId.slice(8, 12)}-${jellyfinId.slice(12, 16)}-${jellyfinId.slice(16, 20)}-${jellyfinId.slice(20)}`;
    expect(seerr.importSeerrUser(dashed.toUpperCase()).id).toBe(5);
    expect(seerr.importSeerrUser(DEMO_MEDIA_IDS['anna-kemaro']).id).toBe(2);
    expect(state().users.size).toBe(5);
    // New users get Seerr's default permissions (the check requires 0).
    state().settings.defaultPermissions = P.REQUEST;
    expect(seerr.importSeerrUser(jellyfinUser('zwei-kemaro')).permissions).toBe(P.REQUEST);
  });

  it('cannot import a user its Jellyfin server does not have', () => {
    const unknown = refused(() => seerr.importSeerrUser('0123456789abcdef0123456789abcdef'));
    expect(unknown).toBeInstanceOf(ProviderError);
    expect(unknown.statusCode).toBe(404);
    expect(unknown.message).toContain('Seerr did not import the user');
    expect(refused(() => seerr.importSeerrUser('kein-id')).message).toContain('Invalid Jellyfin User ID');
    // Connected to another server: the demo Jellyfin's users are unknown to it.
    state().serverId = '0123456789abcdef0123456789abcdef';
    expect(refused(() => seerr.importSeerrUser(jellyfinUser())).statusCode).toBe(404);
    expect(state().users.size).toBe(4);
  });

  it('grants a fresh import with settings of its own, quotas as the owner, then the permissions', () => {
    const user = seerr.importSeerrUser(jellyfinUser());
    expect(seerr.setSeerrUserAccess(user.id, grant, user)).toEqual({
      ...user,
      permissions: grant.permissions,
      movieQuotaLimit: 5,
      movieQuotaDays: 30,
      tvQuotaLimit: 3,
      tvQuotaDays: 30,
    });
    // The settings belong to the user itself, never to the owner whose key made the call.
    expect(state().users.get(user.id)!.settings).toEqual({ locale: '', linkedTo: user.id });
    // "No limit" is written as 0.
    const unlimited = { ...grant, movieQuotaLimit: 0, movieQuotaDays: 0 };
    expect(seerr.setSeerrUserAccess(user.id, unlimited, seerr.listSeerrUsers()[4]!)).toMatchObject({
      movieQuotaLimit: 0,
      movieQuotaDays: 0,
      tvQuotaLimit: 3,
    });
  });

  it('revokes by permissions only and keeps the quotas', () => {
    const anna = seerr.listSeerrUsers()[1]!;
    expect(seerr.setSeerrUserAccess(2, none, anna)).toEqual({ ...anna, permissions: 0 });
  });

  it('never changes the owner and cannot set quotas of a user with MANAGE_USERS', () => {
    state().fail.add('setSeerrUserAccess');
    const owner = refused(() => seerr.setSeerrUserAccess(1, none, seerr.listSeerrUsers()[0]!));
    // Refused before anything is sent: no simulated failure.
    expect({ status: owner.statusCode, code: owner.code }).toEqual({ status: 409, code: 'conflict' });
    state().fail.delete('setSeerrUserAccess');
    expect(state().users.get(1)!.permissions).toBe(P.ADMIN);

    // Staff first lose their rights, so the quotas are written after.
    const staff = addDemoSeerrUser(state(), { permissions: P.MANAGE_USERS, jellyfinUserId: jellyfinUser() });
    expect(seerr.setSeerrUserAccess(staff.id, grant, staff)).toMatchObject({
      permissions: grant.permissions,
      movieQuotaLimit: 5,
      tvQuotaLimit: 3,
    });
    // Seerr skips quotas of a target with MANAGE_USERS: with a stale "current" the write is not kept.
    const stale = addDemoSeerrUser(state(), { permissions: P.MANAGE_USERS });
    const err = refused(() => seerr.setSeerrUserAccess(stale.id, grant, { ...stale, permissions: 0 }));
    expect(err.message).toBe('Seerr: Seerr did not keep the change (movieQuota, tvQuota)');
    expect(refused(() => seerr.setSeerrUserAccess(99, none, { ...staff, id: 99 })).statusCode).toBe(404);
  });

  it('deletes a user with its requests, takes an unknown one as done and never deletes the owner', () => {
    seerr.deleteSeerrUser(2);
    expect(state().users.has(2)).toBe(false);
    expect(state().requests.map((r) => r.requestedBy)).toEqual([4]);
    expect(Object.fromEntries(seerr.seerrRequestCounts().byUser)).toEqual({
      4: { pending: 1, approved: 0, available: 0 },
    });
    seerr.deleteSeerrUser(2);
    // Refused before anything is sent, like the real adapter does.
    state().fail.add('deleteSeerrUser');
    const owner = refused(() => seerr.deleteSeerrUser(1));
    state().fail.delete('deleteSeerrUser');
    expect({ status: owner.statusCode, code: owner.code }).toEqual({ status: 409, code: 'conflict' });
    expect(state().users.has(1)).toBe(true);
  });

  it('refuses what the real adapter refuses before sending: staff bits, other bits, bad numbers', () => {
    const anna = seerr.listSeerrUsers()[1]!;
    const cases: SeerrUserAccess[] = [
      { ...grant, permissions: grant.permissions | P.MANAGE_REQUESTS },
      { ...grant, permissions: grant.permissions | P.AUTO_APPROVE },
      { ...grant, permissions: P.REQUEST },
      { ...grant, movieQuotaLimit: -1 },
      { ...grant, tvQuotaDays: 1.5 },
    ];
    for (const access of cases) {
      const err = refused(() => seerr.setSeerrUserAccess(2, access, anna));
      expect({ status: err.statusCode, code: err.code }, JSON.stringify(access)).toEqual({
        status: 400,
        code: 'bad_request',
      });
    }
    expect(state().users.get(2)!.permissions).toBe(anna.permissions);
    // A bit the user has already may stay; taking bits away is always allowed.
    const ben = seerr.listSeerrUsers()[3]!;
    expect(seerr.setSeerrUserAccess(4, { ...grant, permissions: ben.permissions }, ben).permissions).toBe(
      P.REQUEST,
    );
    expect(seerr.setSeerrUserAccess(4, none, ben).permissions).toBe(0);
  });
});

describe('requests', () => {
  it('reads at most 50 pages and says so', () => {
    for (let i = 0; i < 5000 - DEMO_SEERR_REQUEST_SEEDS.length; i++)
      addDemoSeerrRequest(state(), { requestedBy: 3 });
    expect(seerr.seerrRequestCounts().complete).toBe(true);
    addDemoSeerrRequest(state(), { requestedBy: 3 });
    const counts = seerr.seerrRequestCounts();
    expect(counts.complete).toBe(false);
    // The newest 5000: the oldest request (anna-kemaro's first) is left out.
    expect(counts.byUser.get(2)).toEqual({ pending: 0, approved: 1, available: 2 });
  });

  it('counts declined requests nowhere and TV in seasons', () => {
    const now = Date.now();
    addDemoSeerrRequest(state(), { requestedBy: 2, status: 3, createdAt: now });
    addDemoSeerrRequest(state(), { requestedBy: 2, type: 'tv', seasons: 4, status: 4, createdAt: now });
    expect(seerr.seerrQuotaUsage(2)).toEqual({ movieUsed: 2, tvUsed: 6 });
    expect(seerr.seerrRequestCounts().byUser.get(2)).toEqual({ pending: 1, approved: 1, available: 2 });
    // MANAGE_USERS bypasses quotas.
    state().users.get(2)!.permissions |= P.MANAGE_USERS;
    expect(seerr.seerrQuotaUsage(2)).toEqual({ movieUsed: 0, tvUsed: 0 });
    expect(refused(() => seerr.seerrQuotaUsage(99)).statusCode).toBe(404);
  });
});

describe('fail switches', () => {
  it('make each method fail like a Seerr that does not answer', () => {
    const user = seerr.listSeerrUsers()[2]!;
    const calls: Record<Exclude<DemoSeerrMethod, 'seerrCheck'>, () => unknown> = {
      seerrApplySafeSettings: () => seerr.seerrApplySafeSettings(),
      listSeerrUsers: () => seerr.listSeerrUsers(),
      importSeerrUser: () => seerr.importSeerrUser(jellyfinUser()),
      setSeerrUserAccess: () => seerr.setSeerrUserAccess(3, grant, user),
      deleteSeerrUser: () => seerr.deleteSeerrUser(3),
      seerrRequestCounts: () => seerr.seerrRequestCounts(),
      seerrQuotaUsage: () => seerr.seerrQuotaUsage(2),
    };
    for (const [method, call] of Object.entries(calls)) {
      state().fail.add(method as DemoSeerrMethod);
      const err = refused(call);
      expect(err.message, method).toBe(`Seerr: ${method} failed: simulated (HTTP 503)`);
      state().fail.delete(method as DemoSeerrMethod);
    }
    expect(state().users.get(3)!.permissions).toBe(0);
    expect(state().users.size).toBe(4);
  });
});
