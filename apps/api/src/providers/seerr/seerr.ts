import type { MediaSeerrProblem } from '@weblion/shared';
import { ProviderError, badRequest } from '../../lib/errors';
import { isRecord } from '../http';
import type { RemoteSeerrUser, SeerrCheckResult, SeerrRequestCounts, SeerrUserAccess } from '../types';
import { SeerrClient, type SeerrClientOptions, type SeerrRequestOptions } from './client';
import {
  SEERR_REQUEST_STATUS,
  parseRequestPage,
  parseSeerrJellyfinSettings,
  parseSeerrMainSettings,
  parseSeerrNetworkSettings,
  parseSeerrQuota,
  parseSeerrStatus,
  parseSeerrUser,
  parseSeerrUserPage,
  seerrHasUserSettings,
  seerrJellyfinId,
  seerrMessage,
  seerrSettingsCopy,
  seerrSettingsProblems,
  sortSeerrProblems,
} from './parse';
import {
  SEERR,
  SEERR_OWNER_ID,
  SEERR_REQUEST_PAGES_MAX,
  SEERR_SAFE_SETTINGS,
  SEERR_STAFF_BITS,
  SEERR_USER_PAGES_MAX,
  assertSeerrAccess,
  seerrAccessDrift,
  seerrDeleteRefused,
  seerrNotImported,
  seerrNotKept,
  seerrOwnerRefused,
} from './rules';

/** Entries per page of GET /user and GET /request. */
const PAGE_SIZE = 100;

export interface SeerrApiConfig {
  /** Where customers open Seerr, without trailing slash. */
  url: string;
  /** Seerr's API key: the owner, full rights. */
  apiKey: string;
}

function unexpected(action: string): ProviderError {
  return new ProviderError(SEERR, `${action} failed: unexpected answer`);
}

/** A step of the check that ended it: the problem and why. */
interface SeerrReadFailure {
  ok: false;
  problem: 'key' | 'unreachable';
  error: string;
}

/** An answer of the right status but not of the expected shape (a proxy page, another app). */
const unusable = (action: string): SeerrReadFailure => ({
  ok: false,
  problem: 'unreachable',
  error: unexpected(action).message,
});

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function isUpstream(err: unknown, status: number): boolean {
  return err instanceof ProviderError && err.upstreamStatus === status;
}

/** A Seerr user id as the console sends it in a path: a positive integer. */
function seerrUserIdOf(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw badRequest('Invalid Seerr user id');
  return value;
}

/** A Jellyfin user id as Seerr's import and lookup take it: 32 lower-case hex. */
function jellyfinUserIdOf(value: string): string {
  const id = seerrJellyfinId(String(value ?? ''));
  if (!id) throw badRequest('Invalid Jellyfin user id');
  return id;
}

/**
 * The Seerr of a Jellyfin connection (design 19.3, 19.4), used by JellyfinAdapter. Users by
 * their Seerr id; the owner (user 1) is never changed or deleted. Writes to one user never
 * interleave. Seerr failures throw a ProviderError (name SEERR) without the key; the check
 * reports them as problems instead.
 */
export class SeerrApi {
  readonly client: SeerrClient;
  /** Tail of the writes per user: a read and its write never interleave with another write. */
  private readonly locks = new Map<string, Promise<void>>();

  constructor(config: SeerrApiConfig, options: SeerrClientOptions = {}) {
    this.client = new SeerrClient(config.url, config.apiKey, options);
  }

  // ---------------------------------------------------------------------------
  // Check and settings

  /**
   * Design 19.3: status, main settings, Jellyfin settings (server id) and network settings
   * (CSRF). A request without a usable answer ends the check with `unreachable`, a 403 with
   * `key`. `jellyfinServerId` is the id of the connection's own Jellyfin server; without it the
   * same server cannot be confirmed and `other_server` stays. Never throws for Seerr's answers.
   */
  async check(jellyfinServerId: string | null): Promise<SeerrCheckResult> {
    const result: SeerrCheckResult = {
      version: null,
      sameServer: null,
      newSignIns: null,
      defaultPermissions: null,
      mediaServerLogin: null,
      localLogin: null,
      csrfProtection: null,
      problems: [],
    };
    const done = (problems: MediaSeerrProblem[]) => ({ ...result, problems: sortSeerrProblems(problems) });
    /** A step without a usable answer ends the check, with the reason for staff. */
    const stopped = (problems: MediaSeerrProblem[], failure: SeerrReadFailure): SeerrCheckResult => ({
      ...done([...problems, failure.problem]),
      error: failure.error,
    });

    // Step 1: public. The empty value keeps Seerr from asking GitHub for updates.
    const status = await this.read('/status', { checkUpdateAvailable: '' }, 'read the status');
    if (!status.ok) return stopped([], status);
    result.version = parseSeerrStatus(status.body).version;

    // Step 2: the key's first real test (Seerr answers 403 for an unknown key).
    const rawMain = await this.read('/settings/main', undefined, 'read the main settings');
    if (!rawMain.ok) return stopped([], rawMain);
    const main = parseSeerrMainSettings(rawMain.body);
    if (!main) return stopped([], unusable('read the main settings'));
    result.newSignIns = main.newPlexLogin;
    result.defaultPermissions = main.defaultPermissions;
    result.mediaServerLogin = main.mediaServerLogin;
    result.localLogin = main.localLogin;
    const problems = seerrSettingsProblems(main);

    // Step 3: which Jellyfin server Seerr serves.
    const rawJellyfin = await this.read('/settings/jellyfin', undefined, 'read the Jellyfin settings');
    if (!rawJellyfin.ok) return stopped(problems, rawJellyfin);
    const jellyfin = parseSeerrJellyfinSettings(rawJellyfin.body);
    if (!jellyfin) return stopped(problems, unusable('read the Jellyfin settings'));
    result.sameServer =
      jellyfinServerId === null ? null : jellyfin.serverId !== null && jellyfin.serverId === jellyfinServerId;
    if (result.sameServer !== true) problems.push('other_server');

    // Step 4: CSRF protection would refuse every POST of the console.
    const rawNetwork = await this.read('/settings/network', undefined, 'read the network settings');
    if (!rawNetwork.ok) return stopped(problems, rawNetwork);
    const network = parseSeerrNetworkSettings(rawNetwork.body);
    if (!network) return stopped(problems, unusable('read the network settings'));
    result.csrfProtection = network.csrfProtection;
    if (network.csrfProtection !== false) problems.push('csrf');

    return done(problems);
  }

  /**
   * "Empfohlene Einstellungen": POST /settings/main with exactly SEERR_SAFE_SETTINGS (Seerr
   * merges a partial body; apiKey is read-only and never sent). The answer carries the API key
   * and is only checked for its shape. Then the check runs again.
   */
  async applySafeSettings(jellyfinServerId: string | null): Promise<SeerrCheckResult> {
    const action = 'apply the recommended settings';
    const answer = await this.client.request('POST', '/settings/main', {
      json: { ...SEERR_SAFE_SETTINGS },
      action,
    });
    if (!parseSeerrMainSettings(answer)) throw unexpected(action);
    return this.check(jellyfinServerId);
  }

  /**
   * A GET of the check: the body when it is a JSON object, else the problem it stands for and
   * why (the client's message: the key scrubbed).
   */
  private async read(
    path: string,
    query: SeerrRequestOptions['query'],
    action: string,
  ): Promise<{ ok: true; body: Record<string, unknown> } | SeerrReadFailure> {
    const options: SeerrRequestOptions = { query, action };
    let res;
    try {
      res = await this.client.raw('GET', path, options);
    } catch (err) {
      return { ok: false, problem: 'unreachable', error: errorText(err) };
    }
    const failed = res.status < 200 || res.status >= 300;
    // /status is public: a 403 there comes from a proxy, not from Seerr's key check.
    if (res.status === 403 && path !== '/status') {
      return { ok: false, problem: 'key', error: this.client.failure(res, options).message };
    }
    if (failed)
      return { ok: false, problem: 'unreachable', error: this.client.failure(res, options).message };
    if (!isRecord(res.body)) return unusable(action);
    return { ok: true, body: res.body };
  }

  // ---------------------------------------------------------------------------
  // Users

  /**
   * Every user, page by page in creation order (users added meanwhile come last), at most
   * SEERR_USER_PAGES_MAX pages. Users seen twice (a page shifted while reading) count once.
   * Seerr always has its owner, so an empty answer is an error, never "no users".
   */
  async listUsers(): Promise<RemoteSeerrUser[]> {
    const action = 'list users';
    const byId = new Map<number, RemoteSeerrUser>();
    for (let page = 0; page < SEERR_USER_PAGES_MAX; page++) {
      const body = await this.client.request('GET', '/user', {
        query: { take: PAGE_SIZE, skip: page * PAGE_SIZE, sort: 'created' },
        action,
      });
      const parsed = parseSeerrUserPage(body);
      if (!parsed) throw unexpected(action);
      for (const user of parsed.users) byId.set(user.id, user);
      const pages = parsed.pages ?? (parsed.entries < PAGE_SIZE ? page + 1 : page + 2);
      if (parsed.entries === 0 || page + 1 >= pages) break;
    }
    if (byId.size === 0) throw unexpected(action);
    return [...byId.values()].sort((a, b) => a.id - b.id);
  }

  /**
   * POST /user/import-from-jellyfin for one id. Seerr creates the user with its default
   * permissions (0 once the recommended settings are on) and answers the created users only, so
   * a user Seerr knows already is looked up by its Jellyfin id. Seerr fails with 500 for an id its
   * Jellyfin server does not have.
   */
  async importUser(jellyfinUserId: string): Promise<RemoteSeerrUser> {
    const id = jellyfinUserIdOf(jellyfinUserId);
    return this.exclusive(`jellyfin:${id}`, async () => {
      const options: SeerrRequestOptions = {
        json: { jellyfinUserIds: [id] },
        action: 'import a Jellyfin user',
      };
      const res = await this.client.raw('POST', '/user/import-from-jellyfin', options);
      if (res.status === 500) throw seerrNotImported(this.client.scrub(seerrMessage(res.body) ?? ''));
      if (res.status < 200 || res.status >= 300) throw this.client.failure(res, options);
      if (!Array.isArray(res.body)) throw unexpected('import a Jellyfin user');
      const created = res.body.map(parseSeerrUser).find((u) => u?.jellyfinUserId === id);
      if (created) return created;
      try {
        return await this.readUser(`/user/jellyfin/${id}`, 'find the imported user');
      } catch (err) {
        if (isUpstream(err, 404)) throw seerrNotImported();
        throw err;
      }
    });
  }

  /** GET /user/{id}; 404 as a ProviderError with upstream status 404. */
  async getUser(seerrUserId: number): Promise<RemoteSeerrUser> {
    const id = seerrUserIdOf(seerrUserId);
    return this.readUser(`/user/${id}`, `read Seerr user ${id}`);
  }

  /**
   * Design 19.4. Brings the user to `access`, starting from `current` (as the caller read it):
   *
   * 1. Rights are taken away first (access 0) and staff bits removed first, because Seerr writes
   *    quotas only for users without MANAGE_USERS, and a revocation never waits for a quota.
   * 2. Quotas (only with rights, only when one differs): the user's settings as read, created
   *    first as the user itself (X-API-User) when it has none, so Seerr links them to the user and
   *    not to its owner; then the same fields plus the four quotas as the owner. 0 is written for
   *    "no limit", never left unset (Seerr would apply its default quota).
   * 3. Rights granted last, so a grant never runs without its limit.
   * 4. The user read back and compared: a difference left throws.
   *
   * Never for the owner (refused before anything is sent). A revocation is always written (the
   * caller's copy may be stale); a grant with nothing to change sends no request.
   */
  async setAccess(
    seerrUserId: number,
    access: SeerrUserAccess,
    current: RemoteSeerrUser,
  ): Promise<RemoteSeerrUser> {
    const id = seerrUserIdOf(seerrUserId);
    if (id === SEERR_OWNER_ID) throw seerrOwnerRefused();
    assertSeerrAccess(access, current);
    return this.exclusive(`user:${id}`, async () => {
      const action = `set the access of Seerr user ${id}`;
      let wrote = false;
      let permissionsWritten = false;
      const writePermissions = async () => {
        await this.write(id, `/user/${id}/settings/permissions`, {
          json: { permissions: access.permissions },
          action,
        });
        permissionsWritten = true;
        wrote = true;
      };

      // Step 1.
      if (access.permissions === 0 || current.permissions & SEERR_STAFF_BITS) await writePermissions();

      // Step 2.
      const quotaDrift = seerrAccessDrift(current, access).filter((f) => f !== 'permissions');
      if (access.permissions > 0 && quotaDrift.length > 0) {
        const settings = await this.request(id, 'GET', `/user/${id}/settings/main`, { action });
        if (!isRecord(settings)) throw unexpected(action);
        let copy = seerrSettingsCopy(settings);
        if (!seerrHasUserSettings(settings)) {
          // As the user: Seerr ignores the quota fields here (caller and target are the same).
          const created = await this.request(id, 'POST', `/user/${id}/settings/main`, {
            json: copy,
            actAs: id,
            action,
          });
          // The answer has the settings as stored now (defaults filled): the next write keeps them.
          if (isRecord(created)) copy = seerrSettingsCopy({ ...copy, ...created });
        }
        await this.write(id, `/user/${id}/settings/main`, {
          json: {
            ...copy,
            movieQuotaLimit: access.movieQuotaLimit,
            movieQuotaDays: access.movieQuotaDays,
            tvQuotaLimit: access.tvQuotaLimit,
            tvQuotaDays: access.tvQuotaDays,
          },
          action,
        });
        wrote = true;
      }

      // Step 3.
      if (!permissionsWritten && current.permissions !== access.permissions) await writePermissions();

      if (!wrote) return { ...current };

      // Step 4.
      const after = await this.readUser(`/user/${id}`, `read Seerr user ${id}`);
      const drift = seerrAccessDrift(after, access);
      if (drift.length > 0) throw seerrNotKept(drift);
      return after;
    });
  }

  /**
   * DELETE /user/{id}: Seerr removes the user's requests too, and its session stops working.
   * A user Seerr does not know (404) counts as deleted; 405 (owner, administrators) is a 409.
   */
  async deleteUser(seerrUserId: number): Promise<void> {
    const id = seerrUserIdOf(seerrUserId);
    if (id === SEERR_OWNER_ID) throw seerrOwnerRefused();
    await this.exclusive(`user:${id}`, async () => {
      try {
        await this.client.request('DELETE', `/user/${id}`, { action: `delete Seerr user ${id}` });
      } catch (err) {
        if (isUpstream(err, 404)) return;
        if (isUpstream(err, 405)) throw seerrDeleteRefused();
        throw err;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Numbers

  /**
   * Open, approved and available requests per Seerr user, from GET /request (every status), at
   * most SEERR_REQUEST_PAGES_MAX pages. A request seen twice (new ones shift the pages, newest
   * first) counts once. Nothing but the counts leaves this method.
   */
  async requestCounts(): Promise<SeerrRequestCounts> {
    const action = 'count requests';
    const byUser: SeerrRequestCounts['byUser'] = new Map();
    const seen = new Set<number>();
    let complete = true;
    for (let page = 0; ; page++) {
      if (page >= SEERR_REQUEST_PAGES_MAX) {
        complete = false;
        break;
      }
      const body = await this.client.request('GET', '/request', {
        query: { take: PAGE_SIZE, skip: page * PAGE_SIZE },
        action,
      });
      const parsed = parseRequestPage(body);
      if (!parsed) throw unexpected(action);
      for (const request of parsed.requests) {
        if (seen.has(request.id)) continue;
        seen.add(request.id);
        const counts = byUser.get(request.requestedBy) ?? { pending: 0, approved: 0, available: 0 };
        if (request.status === SEERR_REQUEST_STATUS.PENDING) counts.pending++;
        else if (request.status === SEERR_REQUEST_STATUS.APPROVED) counts.approved++;
        else if (request.status === SEERR_REQUEST_STATUS.COMPLETED) counts.available++;
        byUser.set(request.requestedBy, counts);
      }
      const pages = parsed.pages ?? (parsed.entries < PAGE_SIZE ? page + 1 : page + 2);
      if (parsed.entries === 0 || page + 1 >= pages) break;
    }
    return { byUser, complete };
  }

  /** GET /user/{id}/quota: requests in the movie window and seasons in the TV window. */
  async quotaUsage(seerrUserId: number): Promise<{ movieUsed: number; tvUsed: number }> {
    const id = seerrUserIdOf(seerrUserId);
    const action = `read the quota of Seerr user ${id}`;
    const body = await this.request(id, 'GET', `/user/${id}/quota`, { action });
    const quota = parseSeerrQuota(body);
    if (!quota) throw unexpected(action);
    return quota;
  }

  // ---------------------------------------------------------------------------
  // Helpers

  private async readUser(path: string, action: string): Promise<RemoteSeerrUser> {
    const body = await this.client.request('GET', path, { action });
    const user = parseSeerrUser(body);
    if (!user) throw unexpected(action);
    return user;
  }

  /** A request about one user; 404 as "Seerr user <id> not found" (upstream 404). */
  private async request(
    id: number,
    method: 'GET' | 'POST',
    path: string,
    options: SeerrRequestOptions,
  ): Promise<unknown> {
    try {
      return await this.client.request(method, path, options);
    } catch (err) {
      if (isUpstream(err, 404)) throw new ProviderError(SEERR, `Seerr user ${id} not found`, 404);
      throw err;
    }
  }

  private async write(id: number, path: string, options: SeerrRequestOptions): Promise<void> {
    await this.request(id, 'POST', path, options);
  }

  /** Runs `fn` after every earlier write to the same key has settled. */
  private async exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.then(fn);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(key, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }
}
