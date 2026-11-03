import { MEDIA_SEERR_PROBLEMS, normalizeMediaId, type MediaSeerrProblem } from '@weblion/shared';
import { ProviderError } from '../../lib/errors';
import {
  SEERR,
  SEERR_MEDIA_SERVER_JELLYFIN,
  SEERR_OWNER_ID,
  SEERR_PERMISSION,
  SEERR_REQUEST_PAGES_MAX,
  SEERR_SAFE_SETTINGS,
  SEERR_STAFF_BITS,
  assertSeerrAccess,
  seerrAccessDrift,
  seerrNotImported,
  seerrNotKept,
  seerrOwnerRefused,
} from '../seerr/rules';
import type { RemoteSeerrUser, SeerrCheckResult, SeerrRequestCounts, SeerrUserAccess } from '../types';
import { DEMO_MEDIA_IDS, DEMO_MEDIA_SERVER, demoMediaState } from './media';

/**
 * Simulated Seerr (requests add-on) of a demo connection: one per connection, kept in memory like
 * the other demo data, connected to the demo Jellyfin of the same connection (same server id).
 *
 * Follows the rules of the real Seerr as the console uses it (section 14 of the design): the
 * import skips users Seerr knows and fails for ids its Jellyfin server does not have, new users
 * get the default permissions and no user settings, the owner (user 1) is never changed or
 * deleted, quotas are written only by another caller for targets without MANAGE_USERS, a write
 * of settings for a user without settings links them to the caller (the trap the console avoids
 * by creating them as the user itself), deleting a user removes its requests, and quota usage
 * is computed from the requests in the window. Writes refuse with CSRF protection on, every call
 * refuses with a rejected key, and `fail` makes a method fail like a Seerr that does not answer.
 *
 * Request titles and TMDB ids exist only here, so tests can prove that nothing of them leaves the
 * simulation: every answer carries ids, statuses and numbers only.
 */

export const DEMO_SEERR_URL = 'https://requests.demo.weblion.one';
export const DEMO_SEERR_VERSION = '3.5.1';

/** Seerr user ids of the demo users at the start, by Jellyfin name. */
export const DEMO_SEERR_IDS = {
  'weblion-admin': 1,
  'anna-kemaro': 2,
  'wohnzimmer-kemaro': 3,
  'ben-kemaro': 4,
} as const satisfies Partial<Record<keyof typeof DEMO_MEDIA_IDS, number>>;

/** MediaRequestStatus: PENDING 1, APPROVED 2, DECLINED 3, FAILED 4, COMPLETED 5. */
export type DemoSeerrRequestStatus = 1 | 2 | 3 | 4 | 5;
const PENDING = 1;
const APPROVED = 2;
const DECLINED = 3;
const COMPLETED = 5;

/** Main settings the console reads (and Seerr's own key, which it never returns). */
export interface DemoSeerrSettings {
  /** Seerr creates users for unknown Jellyfin sign-ins while this is on. */
  newPlexLogin: boolean;
  defaultPermissions: number;
  mediaServerLogin: boolean;
  localLogin: boolean;
  /** PLEX 1, JELLYFIN 2, EMBY 3. */
  mediaServerType: number;
  /** settings/network. */
  csrfProtection: boolean;
}

export interface DemoSeerrUserSettings {
  locale: string;
  /**
   * The Seerr user the settings row belongs to: the user itself, unless a caller wrote settings
   * of a user without settings (Seerr then links the new row to the caller, design 14.3).
   */
  linkedTo: number;
}

export interface DemoSeerrUser extends RemoteSeerrUser {
  /** Seerr keeps the Jellyfin name as email of imported users. Never leaves the demo. */
  email: string;
  /** null until the first settings write, as right after an import. */
  settings: DemoSeerrUserSettings | null;
}

export interface DemoSeerrRequest {
  id: number;
  status: DemoSeerrRequestStatus;
  type: 'movie' | 'tv';
  /** Seasons of a TV request: Seerr counts them for the TV quota. */
  seasons: number;
  /** Seerr user id. */
  requestedBy: number;
  createdAt: number;
  /** Never leave the demo (the tests scan every answer for them). */
  tmdbId: number;
  title: string;
}

/** Methods the `fail` switch can make fail (like a Seerr that answers 503). */
export type DemoSeerrMethod =
  | 'seerrCheck'
  | 'seerrApplySafeSettings'
  | 'listSeerrUsers'
  | 'getSeerrUser'
  | 'importSeerrUser'
  | 'setSeerrUserAccess'
  | 'deleteSeerrUser'
  | 'seerrRequestCounts'
  | 'seerrQuotaUsage';

/** State of one demo Seerr. Tests change settings, users and requests directly. */
export interface DemoSeerrState {
  connectionId: string;
  /** Jellyfin server id Seerr is connected to (settings/jellyfin). */
  serverId: string;
  settings: DemoSeerrSettings;
  /** Seerr answers 403 to every protected route: the key is not Seerr's. */
  keyRejected: boolean;
  users: Map<number, DemoSeerrUser>;
  requests: DemoSeerrRequest[];
  nextUserId: number;
  nextRequestId: number;
  fail: Set<DemoSeerrMethod>;
}

const DAY = 24 * 3_600_000;

export interface DemoSeerrRequestSeed {
  user: keyof typeof DEMO_SEERR_IDS;
  status: DemoSeerrRequestStatus;
  type: 'movie' | 'tv';
  seasons: number;
  agoDays: number;
  tmdbId: number;
  title: string;
}

/**
 * Requests of the demo users at the start: anna-kemaro 1 open, 1 approved, 2 available (one of
 * them outside the 30-day window), ben-kemaro 1 open. Titles and TMDB ids are made up.
 */
export const DEMO_SEERR_REQUEST_SEEDS: readonly DemoSeerrRequestSeed[] = [
  {
    user: 'anna-kemaro',
    status: PENDING,
    type: 'movie',
    seasons: 0,
    agoDays: 2,
    tmdbId: 4721301,
    title: 'Gipfelglühen',
  },
  {
    user: 'anna-kemaro',
    status: APPROVED,
    type: 'tv',
    seasons: 2,
    agoDays: 5,
    tmdbId: 9183342,
    title: 'Die Nebelfahrer',
  },
  {
    user: 'anna-kemaro',
    status: COMPLETED,
    type: 'movie',
    seasons: 0,
    agoDays: 10,
    tmdbId: 6602917,
    title: 'Kalte Spur am Pilatus',
  },
  {
    user: 'anna-kemaro',
    status: COMPLETED,
    type: 'movie',
    seasons: 0,
    agoDays: 40,
    tmdbId: 7310558,
    title: 'Sommer am Seeufer',
  },
  {
    user: 'ben-kemaro',
    status: PENDING,
    type: 'movie',
    seasons: 0,
    agoDays: 1,
    tmdbId: 8854023,
    title: 'Die letzte Postkutsche',
  },
];

const P = SEERR_PERMISSION;

function generate(connectionId: string, now = Date.now()): DemoSeerrState {
  const users = new Map<number, DemoSeerrUser>();
  const user = (
    name: keyof typeof DEMO_SEERR_IDS,
    permissions: number,
    quotas: Pick<RemoteSeerrUser, 'movieQuotaLimit' | 'movieQuotaDays' | 'tvQuotaLimit' | 'tvQuotaDays'>,
  ) => {
    const id = DEMO_SEERR_IDS[name];
    users.set(id, {
      id,
      jellyfinUserId: DEMO_MEDIA_IDS[name],
      permissions,
      ...quotas,
      email: name,
      settings: { locale: 'de', linkedTo: id },
    });
  };
  const none = { movieQuotaLimit: null, movieQuotaDays: null, tvQuotaLimit: null, tvQuotaDays: null };
  const muster = { movieQuotaLimit: 5, movieQuotaDays: 30, tvQuotaLimit: 3, tvQuotaDays: 30 };
  // The instance's administrator set Seerr up: the owner.
  user('weblion-admin', P.ADMIN, none);
  user('anna-kemaro', P.REQUEST_MOVIE | P.REQUEST_TV, muster);
  // Locked out after failed sign-ins (disabled in the console): no rights.
  user('wohnzimmer-kemaro', 0, muster);
  // Signed in to Seerr while new sign-ins were on: not managed, with Seerr's old default REQUEST.
  user('ben-kemaro', P.REQUEST, none);
  const requests = DEMO_SEERR_REQUEST_SEEDS.map((seed, i): DemoSeerrRequest => ({
    id: i + 1,
    status: seed.status,
    type: seed.type,
    seasons: seed.seasons,
    requestedBy: DEMO_SEERR_IDS[seed.user],
    createdAt: now - seed.agoDays * DAY,
    tmdbId: seed.tmdbId,
    title: seed.title,
  }));
  return {
    connectionId,
    serverId: DEMO_MEDIA_SERVER.id,
    settings: {
      newPlexLogin: false,
      defaultPermissions: 0,
      mediaServerLogin: true,
      localLogin: true,
      mediaServerType: SEERR_MEDIA_SERVER_JELLYFIN,
      csrfProtection: false,
    },
    keyRejected: false,
    users,
    requests,
    nextUserId: Math.max(...users.keys()) + 1,
    nextRequestId: requests.length + 1,
    fail: new Set(),
  };
}

const STATE = new Map<string, DemoSeerrState>();

/** The state of one demo connection, created with the dataset on first use. */
export function demoSeerrState(connectionId: string): DemoSeerrState {
  let state = STATE.get(connectionId);
  if (!state) {
    state = generate(connectionId);
    STATE.set(connectionId, state);
  }
  return state;
}

/** Test helper: forget all simulated Seerr state. */
export function resetDemoSeerr(): void {
  STATE.clear();
}

/** Test helper: a Seerr user created in Seerr directly (staff, a local user, a sign-in). */
export function addDemoSeerrUser(
  state: DemoSeerrState,
  fields: Partial<Omit<DemoSeerrUser, 'id'>> = {},
): DemoSeerrUser {
  const id = state.nextUserId++;
  const user: DemoSeerrUser = {
    id,
    jellyfinUserId: null,
    permissions: 0,
    movieQuotaLimit: null,
    movieQuotaDays: null,
    tvQuotaLimit: null,
    tvQuotaDays: null,
    email: `user-${id}@seerr.demo`,
    settings: { locale: 'de', linkedTo: id },
    ...fields,
  };
  state.users.set(id, user);
  return user;
}

/** Test helper: a request of a Seerr user. */
export function addDemoSeerrRequest(
  state: DemoSeerrState,
  fields: Pick<DemoSeerrRequest, 'requestedBy'> & Partial<Omit<DemoSeerrRequest, 'id'>>,
): DemoSeerrRequest {
  const request: DemoSeerrRequest = {
    id: state.nextRequestId++,
    status: PENDING,
    type: 'movie',
    seasons: 0,
    createdAt: Date.now(),
    tmdbId: 1_000_000 + state.nextRequestId,
    title: `Demo-Titel ${state.nextRequestId}`,
    ...fields,
  };
  state.requests.push(request);
  return request;
}

/** ADMIN passes every permission check in Seerr. */
const hasPermission = (user: Pick<RemoteSeerrUser, 'permissions'>, bit: number) =>
  (user.permissions & (P.ADMIN | bit)) !== 0;

/**
 * Synchronous simulation of the Seerr methods of ProviderAdapter (same names and arguments);
 * DemoAdapter wraps each one in an async method.
 */
export class DemoSeerr {
  constructor(private readonly state: DemoSeerrState) {}

  seerrConfigured(): boolean {
    return true;
  }

  seerrUrl(): string {
    return DEMO_SEERR_URL;
  }

  /** The `fail` switch: thrown like a Seerr that answers 503. */
  private failing(method: DemoSeerrMethod): void {
    if (this.state.fail.has(method)) {
      throw new ProviderError(SEERR, `${method} failed: simulated (HTTP 503)`, 503);
    }
  }

  /** Every protected route answers 403 for a key that is not Seerr's. */
  private keyAccepted(action: string): void {
    if (this.state.keyRejected) {
      throw new ProviderError(
        SEERR,
        `${action} failed: You do not have permission to access this endpoint (HTTP 403). The API key was rejected (Seerr answers 403 for an unknown key): copy it from Seerr > Settings > General`,
        403,
      );
    }
  }

  /** With CSRF protection on, Seerr refuses every POST and DELETE without a CSRF token. */
  private writable(action: string): void {
    this.keyAccepted(action);
    if (this.state.settings.csrfProtection) {
      throw new ProviderError(
        SEERR,
        `${action} failed: invalid csrf token (HTTP 403). Seerr's CSRF protection is on: switch it off under Settings > Network`,
        403,
      );
    }
  }

  private view(user: DemoSeerrUser): RemoteSeerrUser {
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

  private user(id: number, action: string): DemoSeerrUser {
    const user = this.state.users.get(id);
    if (!user) throw new ProviderError(SEERR, `${action} failed: User not found. (HTTP 404)`, 404);
    return user;
  }

  /** GET /status, /settings/main, /settings/jellyfin, /settings/network: values only, never keys. */
  seerrCheck(): SeerrCheckResult {
    if (this.state.fail.has('seerrCheck')) {
      return {
        version: null,
        sameServer: null,
        newSignIns: null,
        defaultPermissions: null,
        mediaServerLogin: null,
        localLogin: null,
        csrfProtection: null,
        problems: ['unreachable'],
        error: 'read the status failed: simulated (HTTP 503)',
      };
    }
    if (this.state.keyRejected) {
      return {
        version: DEMO_SEERR_VERSION,
        sameServer: null,
        newSignIns: null,
        defaultPermissions: null,
        mediaServerLogin: null,
        localLogin: null,
        csrfProtection: null,
        problems: ['key'],
        error:
          'read the main settings failed: You do not have permission to access this endpoint (HTTP 403). The API key was rejected (Seerr answers 403 for an unknown key): copy it from Seerr > Settings > General',
      };
    }
    const s = this.state.settings;
    const sameServer = this.state.serverId === DEMO_MEDIA_SERVER.id;
    const found = new Set<MediaSeerrProblem>();
    if (s.mediaServerType !== SEERR_MEDIA_SERVER_JELLYFIN) found.add('not_jellyfin');
    if (!sameServer) found.add('other_server');
    if (s.csrfProtection) found.add('csrf');
    if (s.newPlexLogin !== false) found.add('new_signins');
    if (s.defaultPermissions !== 0) found.add('default_permissions');
    if (s.mediaServerLogin !== true) found.add('media_server_login');
    return {
      version: DEMO_SEERR_VERSION,
      sameServer,
      newSignIns: s.newPlexLogin,
      defaultPermissions: s.defaultPermissions,
      mediaServerLogin: s.mediaServerLogin,
      localLogin: s.localLogin,
      csrfProtection: s.csrfProtection,
      problems: MEDIA_SEERR_PROBLEMS.filter((p) => found.has(p)),
    };
  }

  /** POST /settings/main merges exactly the three safe values; other settings stay. */
  seerrApplySafeSettings(): SeerrCheckResult {
    this.failing('seerrApplySafeSettings');
    this.writable('apply the recommended settings');
    Object.assign(this.state.settings, SEERR_SAFE_SETTINGS);
    return this.seerrCheck();
  }

  /** Every user, by id; email, names and settings stay in Seerr. */
  listSeerrUsers(): RemoteSeerrUser[] {
    this.failing('listSeerrUsers');
    this.keyAccepted('list the users');
    return [...this.state.users.values()].sort((a, b) => a.id - b.id).map((u) => this.view(u));
  }

  /** GET /user/{id}: 404 for a user Seerr does not have. */
  getSeerrUser(seerrUserId: number): RemoteSeerrUser {
    this.failing('getSeerrUser');
    const action = `read user ${seerrUserId}`;
    this.keyAccepted(action);
    return this.view(this.user(seerrUserId, action));
  }

  /**
   * POST /user/import-from-jellyfin: a user Seerr knows is found, an unknown id of Seerr's Jellyfin
   * server is created with the default permissions and no settings, any other id fails.
   */
  importSeerrUser(jellyfinUserId: string): RemoteSeerrUser {
    this.failing('importSeerrUser');
    this.writable('import the user');
    const id = normalizeMediaId(String(jellyfinUserId ?? ''));
    if (!id)
      throw new ProviderError(SEERR, 'import the user failed: Invalid Jellyfin User ID. (HTTP 400)', 400);
    const known = [...this.state.users.values()].find((u) => u.jellyfinUserId === id);
    if (known) return this.view(known);
    // Seerr lists the users of its own Jellyfin server: the demo Jellyfin only while connected to it.
    const jellyfin =
      this.state.serverId === DEMO_MEDIA_SERVER.id
        ? demoMediaState(this.state.connectionId).users.get(id)
        : undefined;
    if (!jellyfin) throw seerrNotImported('HTTP 500');
    const user: DemoSeerrUser = {
      id: this.state.nextUserId++,
      jellyfinUserId: id,
      permissions: this.state.settings.defaultPermissions,
      movieQuotaLimit: null,
      movieQuotaDays: null,
      tvQuotaLimit: null,
      tvQuotaDays: null,
      email: jellyfin.username,
      settings: null,
    };
    this.state.users.set(user.id, user);
    return this.view(user);
  }

  /**
   * The console's write order (design 19.4): permissions first for staff and revocations; quotas
   * only for grants, after creating missing settings as the user itself and then as the owner;
   * remaining permissions after the quotas; read back and compared.
   */
  setSeerrUserAccess(
    seerrUserId: number,
    access: SeerrUserAccess,
    current: RemoteSeerrUser,
  ): RemoteSeerrUser {
    if (seerrUserId === SEERR_OWNER_ID) throw seerrOwnerRefused();
    // The same refusals as the real adapter, before anything is "sent".
    assertSeerrAccess(access, current);
    this.failing('setSeerrUserAccess');
    const action = `set the rights of user ${seerrUserId}`;
    this.writable(action);
    const user = this.user(seerrUserId, action);
    let permissionsWritten = false;
    if ((current.permissions & SEERR_STAFF_BITS) !== 0 || access.permissions === 0) {
      user.permissions = access.permissions;
      permissionsWritten = true;
    }
    const quotaDiffers = seerrAccessDrift(current, access).some((field) => field !== 'permissions');
    if (access.permissions > 0 && quotaDiffers) {
      // X-API-User: <id>: the caller is the user itself, so the settings are its own and the
      // quota fields of this call are ignored.
      if (!user.settings) this.writeSettings(user, user.id, access);
      this.writeSettings(user, SEERR_OWNER_ID, access);
    }
    if (!permissionsWritten && current.permissions !== access.permissions)
      user.permissions = access.permissions;
    const after = this.view(user);
    const drift = seerrAccessDrift(after, access);
    if (drift.length > 0) throw seerrNotKept(drift);
    return after;
  }

  /** POST /user/{id}/settings/main as `caller` (usersettings.ts:73-160). */
  private writeSettings(user: DemoSeerrUser, caller: number, access: SeerrUserAccess): void {
    // Seerr creates missing settings with `user: req.user`: linked to the caller.
    if (!user.settings) user.settings = { locale: '', linkedTo: caller };
    // Quotas only when the target lacks MANAGE_USERS and the caller is not the target.
    if (caller !== user.id && !hasPermission(user, P.MANAGE_USERS)) {
      user.movieQuotaLimit = access.movieQuotaLimit;
      user.movieQuotaDays = access.movieQuotaDays;
      user.tvQuotaLimit = access.tvQuotaLimit;
      user.tvQuotaDays = access.tvQuotaDays;
    }
  }

  /** DELETE /user/{id}: the requests go with the user; an unknown user is done already; never the owner. */
  deleteSeerrUser(seerrUserId: number): void {
    // Like the real adapter: the owner is refused before anything is sent.
    if (seerrUserId === SEERR_OWNER_ID) throw seerrOwnerRefused();
    this.failing('deleteSeerrUser');
    this.writable(`delete user ${seerrUserId}`);
    if (!this.state.users.delete(seerrUserId)) return;
    this.state.requests = this.state.requests.filter((r) => r.requestedBy !== seerrUserId);
  }

  /**
   * GET /request pages, newest first, at most SEERR_REQUEST_PAGES_MAX pages of 100: open,
   * approved and available per user. Nothing else of a request leaves.
   */
  seerrRequestCounts(): SeerrRequestCounts {
    this.failing('seerrRequestCounts');
    this.keyAccepted('read the requests');
    const max = SEERR_REQUEST_PAGES_MAX * 100;
    const newest = [...this.state.requests].sort((a, b) => b.id - a.id).slice(0, max);
    const byUser: SeerrRequestCounts['byUser'] = new Map();
    for (const request of newest) {
      const counts = byUser.get(request.requestedBy) ?? { pending: 0, approved: 0, available: 0 };
      if (request.status === PENDING) counts.pending++;
      else if (request.status === APPROVED) counts.approved++;
      else if (request.status === COMPLETED) counts.available++;
      byUser.set(request.requestedBy, counts);
    }
    return { byUser, complete: this.state.requests.length <= max };
  }

  /**
   * GET /user/{id}/quota (User.getQuota): requests in the window that were not declined, TV in
   * seasons; 0 without a limit, and for users with MANAGE_USERS (they bypass quotas).
   */
  seerrQuotaUsage(seerrUserId: number): { movieUsed: number; tvUsed: number } {
    this.failing('seerrQuotaUsage');
    const action = `read the quota of user ${seerrUserId}`;
    this.keyAccepted(action);
    const user = this.user(seerrUserId, action);
    const bypass = hasPermission(user, P.MANAGE_USERS);
    const used = (type: 'movie' | 'tv', limit: number | null, days: number | null) => {
      if (bypass || !limit) return 0;
      const since = Date.now() - (days ?? 0) * DAY;
      return this.state.requests
        .filter(
          (r) => r.requestedBy === user.id && r.type === type && r.status !== DECLINED && r.createdAt > since,
        )
        .reduce((sum, r) => sum + (type === 'tv' ? r.seasons : 1), 0);
    };
    return {
      movieUsed: used('movie', user.movieQuotaLimit, user.movieQuotaDays),
      tvUsed: used('tv', user.tvQuotaLimit, user.tvQuotaDays),
    };
  }
}
