import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

// ---------------------------------------------------------------------------
// A small Seerr (3.5.1), built after its source: checkUser and isAuthenticated (X-API-Key as the
// owner, X-API-User to act as a user, 403 without a user), csurf (POST and DELETE refused while
// CSRF protection is on), express-openapi-validator for the bodies the console sends, the error
// handler ({ message, errors }), settings main (lodash merge, answer with apiKey), jellyfin
// (with Seerr's own Jellyfin key), network (with a proxy password), status, users (paging,
// import, lookup by Jellyfin id, settings with the owner, own-profile and quota rules,
// permissions with the owner and ADMIN rules, delete, quota) and requests (paging, newest
// first). Answers carry emails, TMDB ids and the like on purpose: the console must drop them.

/** Seerr generates base64 of a timestamp and a UUID (68 characters). */
export const MOCK_SEERR_API_KEY = 'MTc2MDE3MDUzMDAwMGI2YjJlOWFjLTVkNGYtNGQ2Ny04ZWNhLTVkMTJmOTA4M2E1Yg==';
/** Seerr's own Jellyfin API key (a Jellyfin administrator): must never leave the adapter. */
export const MOCK_SEERR_JELLYFIN_KEY = 'c0ffee00c0ffee00c0ffee00c0ffee00';
/** The proxy password of the network settings: must never leave the adapter. */
export const MOCK_SEERR_PROXY_PASSWORD = 'proxy-geheim-2026';
export const MOCK_SEERR_VERSION = '3.5.1';
/** Seerr's owner (user 1): a Jellyfin administrator. */
export const MOCK_OWNER_JELLYFIN_ID = '84bb1f65fce351e5962eb84c1645fa51';

/** Seerr's permission bits used here (server/lib/permissions.ts). */
const ADMIN = 2;
const MANAGE_USERS = 8;
const MANAGE_REQUESTS = 16;
const REQUEST_VIEW = 16384;
const NO_PERMISSION = 'You do not have permission to access this endpoint';

/** PLEX 1, LOCAL 2, JELLYFIN 3, EMBY 4 (server/constants/user.ts). */
const USER_TYPE_JELLYFIN = 3;

export interface MockSeerrUserSettings {
  /** The user the row is linked to (UserSettings.user): the caller that created it. */
  linkedTo: number;
  locale: string;
  discoverRegion: string | null;
  streamingRegion: string | null;
  originalLanguage: string | null;
  watchlistSyncMovies: boolean | null;
  watchlistSyncTv: boolean | null;
}

export interface MockSeerrUser {
  id: number;
  email: string;
  username: string | null;
  jellyfinUserId: string | null;
  jellyfinUsername: string | null;
  userType: number;
  permissions: number;
  movieQuotaLimit: number | null;
  movieQuotaDays: number | null;
  tvQuotaLimit: number | null;
  tvQuotaDays: number | null;
  createdAt: string;
  settings: MockSeerrUserSettings | null;
}

export interface MockSeerrRequest {
  id: number;
  /** Seerr user id. */
  requestedBy: number;
  type: 'movie' | 'tv';
  /** MediaRequestStatus: PENDING 1, APPROVED 2, DECLINED 3, FAILED 4, COMPLETED 5. */
  status: number;
  tmdbId: number;
  /** Shows up as the media's slug and IMDb id, to prove neither leaves the adapter. */
  title: string;
  /** TV: requested seasons. */
  seasons: number;
  createdAt: string;
  ignoreQuota?: boolean;
}

export interface MockSeerrRequestRecord {
  method: string;
  /** Path below /api/v1. */
  path: string;
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
  body: unknown;
}

export interface MockSeerrAnswer {
  status?: number;
  json?: unknown;
  text?: string;
  contentType?: string;
  headers?: Record<string, string>;
}

export interface MockSeerrState {
  apiKey: string;
  main: Record<string, unknown>;
  jellyfin: Record<string, unknown>;
  network: Record<string, unknown>;
  /** The users Seerr's Jellyfin server has (id to name): only these can be imported. */
  jellyfinUsers: Map<string, string>;
  users: Map<number, MockSeerrUser>;
  requests: MockSeerrRequest[];
  nextUserId: number;
  /** Users whose settings were created by another caller (Seerr links them to that caller). */
  foreignSettings: number[];
  /** GET /status calls that would have asked GitHub for updates. */
  githubChecks: number;
  delayMs: number;
  maxInFlight: number;
  /** Answers instead of the routes when it returns something (failures, odd answers). */
  override?: (req: MockSeerrRequestRecord) => MockSeerrAnswer | undefined;
}

export interface MockSeerrOptions {
  apiKey?: string;
  /** Seerr's Jellyfin server id (settings/jellyfin). */
  serverId?: string;
  /** Overrides of the main settings; default: the recommended settings applied. */
  main?: Record<string, unknown>;
  /** Seerr as installed: new sign-ins on, default permissions REQUEST (32). */
  fresh?: boolean;
  csrf?: boolean;
  delayMs?: number;
}

export interface SeerrMock {
  /** The address customers open (the client adds /api/v1). */
  url: string;
  requests: MockSeerrRequestRecord[];
  state: MockSeerrState;
  /** A Jellyfin user on Seerr's Jellyfin server (importable). */
  addJellyfinUser(id: string, name: string): void;
  /** A Seerr user as the import (or a sign-in) would have made it. */
  addUser(user: Partial<MockSeerrUser> & { email: string }): MockSeerrUser;
  addRequest(
    request: Omit<MockSeerrRequest, 'id' | 'createdAt' | 'seasons'> & Partial<MockSeerrRequest>,
  ): MockSeerrRequest;
  close(): Promise<void>;
}

const hasPermission = (user: MockSeerrUser | undefined, permission: number) =>
  !!user && (permission === 0 || (user.permissions & ADMIN) !== 0 || (user.permissions & permission) !== 0);

const json = (value: unknown, status = 200): MockSeerrAnswer => ({ status, json: value });
/** The express error handler. */
const error = (status: number, message: string, errors?: unknown): MockSeerrAnswer => ({
  status,
  json: errors === undefined ? { message } : { message, errors },
});
/** express-openapi-validator (shape UNVERIFIED, design 28.7): "request/body/apiKey is read-only". */
const invalid = (path: string, message: string): MockSeerrAnswer =>
  error(400, `request${path} ${message}`, [
    { path, message, errorCode: `${message.split(' ')[0]}.openapi.validation` },
  ]);
const denied = (): MockSeerrAnswer => ({ status: 403, json: { status: 403, error: NO_PERMISSION } });

/** normalizeJellyfinGuid (server/utils/jellyfin.ts). */
function normalizeGuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.replace(/-/g, '').toLowerCase();
  return /^[0-9a-f]{32}$/.test(id) ? id : null;
}

/** lodash merge for plain JSON (arrays replaced, as Seerr's mergeSettings does). */
function merge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const current = out[key];
    out[key] =
      value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object'
        ? merge(current as Record<string, unknown>, value as Record<string, unknown>)
        : value;
  }
  return out;
}

function headerOf(headers: IncomingHttpHeaders, name: string): string {
  const value = headers[name.toLowerCase()];
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export async function startSeerrMock(options: MockSeerrOptions = {}): Promise<SeerrMock> {
  const apiKey = options.apiKey ?? MOCK_SEERR_API_KEY;
  const requests: MockSeerrRequestRecord[] = [];
  const fresh = options.fresh === true;
  const state: MockSeerrState = {
    apiKey,
    main: {
      apiKey,
      applicationTitle: 'Seerr',
      applicationUrl: 'https://anfragen.weblion.one',
      cacheImages: false,
      defaultPermissions: fresh ? 32 : 0,
      defaultQuotas: { movie: {}, tv: {} },
      hideAvailable: false,
      hideBlocklisted: false,
      localLogin: true,
      mediaServerLogin: true,
      newPlexLogin: !fresh ? false : true,
      discoverRegion: '',
      streamingRegion: '',
      originalLanguage: '',
      mediaServerType: 2,
      partialRequestsEnabled: true,
      enableSpecialEpisodes: false,
      locale: 'en',
      youtubeUrl: '',
      ...options.main,
    },
    jellyfin: {
      name: 'Weblion Jellyfin',
      ip: 'media.weblion.one',
      port: 443,
      useSsl: true,
      urlBase: '',
      externalHostname: 'https://media.weblion.one',
      jellyfinForgotPasswordUrl: '',
      libraries: [{ id: 'f137a2dd21bbc1b99aa5c0f6bf02a805', name: 'Filme', enabled: true, type: 'movie' }],
      serverId: options.serverId ?? '8dd0047ed7d2f177ef00ca66157d6768',
      apiKey: MOCK_SEERR_JELLYFIN_KEY,
    },
    network: {
      csrfProtection: options.csrf === true,
      forceIpv4First: false,
      trustProxy: true,
      proxy: {
        enabled: false,
        hostname: 'proxy.weblion.one',
        port: 3128,
        useSsl: false,
        user: 'seerr',
        password: MOCK_SEERR_PROXY_PASSWORD,
        bypassFilter: '',
        bypassLocalAddresses: true,
      },
    },
    jellyfinUsers: new Map([[MOCK_OWNER_JELLYFIN_ID, 'admin']]),
    users: new Map(),
    requests: [],
    nextUserId: 1,
    foreignSettings: [],
    githubChecks: 0,
    delayMs: options.delayMs ?? 0,
    maxInFlight: 0,
  };

  let nextRequestId = 1;
  let clock = Date.parse('2026-10-01T08:00:00.000Z');
  const stamp = () => new Date((clock += 1000)).toISOString();

  function addUser(user: Partial<MockSeerrUser> & { email: string }): MockSeerrUser {
    const id = user.id ?? state.nextUserId;
    state.nextUserId = Math.max(state.nextUserId, id + 1);
    const full: MockSeerrUser = {
      id,
      email: user.email.toLowerCase(),
      username: user.username ?? null,
      jellyfinUserId: user.jellyfinUserId ?? null,
      jellyfinUsername: user.jellyfinUsername ?? null,
      userType: user.userType ?? USER_TYPE_JELLYFIN,
      permissions: user.permissions ?? 0,
      movieQuotaLimit: user.movieQuotaLimit ?? null,
      movieQuotaDays: user.movieQuotaDays ?? null,
      tvQuotaLimit: user.tvQuotaLimit ?? null,
      tvQuotaDays: user.tvQuotaDays ?? null,
      createdAt: user.createdAt ?? stamp(),
      settings: user.settings === undefined ? null : user.settings,
    };
    state.users.set(id, full);
    return full;
  }

  // The owner: signed in with Jellyfin during the setup, with settings and a real email.
  addUser({
    id: 1,
    email: 'betrieb@weblion.one',
    jellyfinUserId: MOCK_OWNER_JELLYFIN_ID,
    jellyfinUsername: 'admin',
    permissions: ADMIN,
    settings: {
      linkedTo: 1,
      locale: 'de',
      discoverRegion: 'CH',
      streamingRegion: 'CH',
      originalLanguage: null,
      watchlistSyncMovies: null,
      watchlistSyncTv: null,
    },
  });

  /** User.filter(showFiltered): without it no email. */
  function userJson(user: MockSeerrUser, showFiltered: boolean): Record<string, unknown> {
    const out: Record<string, unknown> = {
      id: user.id,
      ...(showFiltered ? { email: user.email } : {}),
      plexUsername: null,
      jellyfinUsername: user.jellyfinUsername,
      username: user.username,
      userType: user.userType,
      jellyfinUserId: user.jellyfinUserId,
      permissions: user.permissions,
      avatar: `/avatarproxy/${user.jellyfinUserId ?? 'local'}`,
      avatarETag: null,
      avatarVersion: null,
      createdAt: user.createdAt,
      updatedAt: user.createdAt,
      requestCount: state.requests.filter((r) => r.requestedBy === user.id).length,
      displayName: user.username || user.jellyfinUsername || user.email,
    };
    // Nullable columns: undefined ones are left out of the JSON, as TypeORM gives them.
    for (const key of ['movieQuotaLimit', 'movieQuotaDays', 'tvQuotaLimit', 'tvQuotaDays'] as const) {
      if (user[key] !== null) out[key] = user[key];
    }
    return out;
  }

  /** User.getQuota. */
  function quotaOf(user: MockSeerrUser) {
    const defaults = state.main.defaultQuotas as {
      movie: { quotaLimit?: number; quotaDays?: number };
      tv: { quotaLimit?: number; quotaDays?: number };
    };
    const bypass = hasPermission(user, MANAGE_USERS);
    const part = (type: 'movie' | 'tv') => {
      const ownLimit = type === 'movie' ? user.movieQuotaLimit : user.tvQuotaLimit;
      const ownDays = type === 'movie' ? user.movieQuotaDays : user.tvQuotaDays;
      const limit = bypass ? 0 : (ownLimit ?? defaults[type].quotaLimit ?? 0);
      const days = ownDays ?? defaults[type].quotaDays ?? 0;
      const since = days ? Date.parse('2026-10-11T12:00:00.000Z') - days * 86_400_000 : 0;
      const counted = state.requests.filter(
        (r) =>
          r.requestedBy === user.id &&
          r.type === type &&
          r.status !== 3 &&
          !r.ignoreQuota &&
          (!days || Date.parse(r.createdAt) > since),
      );
      const used = limit ? counted.reduce((sum, r) => sum + (type === 'tv' ? r.seasons : 1), 0) : 0;
      return {
        days,
        limit,
        used,
        ...(limit ? { remaining: Math.max(0, limit - used) } : {}),
        restricted: !!(limit && limit - used <= 0),
      };
    };
    return { movie: part('movie'), tv: part('tv') };
  }

  function requestJson(request: MockSeerrRequest): Record<string, unknown> {
    const by = state.users.get(request.requestedBy);
    const slug = request.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return {
      id: request.id,
      status: request.status,
      createdAt: request.createdAt,
      updatedAt: request.createdAt,
      type: request.type,
      is4k: false,
      serverId: null,
      profileId: null,
      rootFolder: null,
      languageProfileId: null,
      tags: [],
      isAutoRequest: false,
      ignoreQuota: request.ignoreQuota ?? false,
      media: {
        id: 1000 + request.id,
        mediaType: request.type,
        tmdbId: request.tmdbId,
        tvdbId: request.type === 'tv' ? 70000 + request.tmdbId : null,
        imdbId: `tt${String(request.tmdbId).padStart(7, '0')}`,
        status: request.status === 5 ? 5 : 2,
        externalServiceSlug: slug,
        jellyfinMediaId: request.status === 5 ? 'a1b2c3d4e5f60718293a4b5c6d7e8f90' : null,
        createdAt: request.createdAt,
      },
      seasons:
        request.type === 'tv'
          ? Array.from({ length: request.seasons }, (_, i) => ({
              id: request.id * 100 + i,
              seasonNumber: i + 1,
            }))
          : [],
      modifiedBy: null,
      requestedBy: by ? userJson(by, true) : null,
      seasonCount: request.type === 'tv' ? request.seasons : 0,
    };
  }

  function route(req: MockSeerrRequestRecord): MockSeerrAnswer {
    const { method, path } = req;
    const body = req.body;

    // csurf runs before the API router for every method but GET, HEAD and OPTIONS.
    if (state.network.csrfProtection === true && method !== 'GET') return error(403, 'invalid csrf token');

    // checkUser: the key makes the owner, X-API-User another user.
    let caller: MockSeerrUser | undefined;
    if (headerOf(req.headers, 'x-api-key') === state.apiKey) {
      const actAs = headerOf(req.headers, 'x-api-user');
      caller = state.users.get(actAs ? Number(actAs) : 1);
    }

    if (method === 'GET' && path === '/status') {
      const check = req.query.has('checkUpdateAvailable')
        ? req.query.get('checkUpdateAvailable')
        : 'versionCheck';
      if (check) state.githubChecks++;
      return json({ version: MOCK_SEERR_VERSION, commitTag: 'local', restartRequired: false });
    }

    // Settings: isAuthenticated(ADMIN).
    if (path.startsWith('/settings/')) {
      if (method === 'POST' && path === '/settings/main') {
        if (!body || typeof body !== 'object' || Array.isArray(body))
          return invalid('/body', 'must be object');
        if ('apiKey' in body) return invalid('/body/apiKey', 'is read-only');
      }
      if (!hasPermission(caller, ADMIN)) return denied();
      if (method === 'GET' && path === '/settings/main') return json(state.main);
      if (method === 'POST' && path === '/settings/main') {
        state.main = merge(state.main, body as Record<string, unknown>);
        return json(state.main);
      }
      if (method === 'GET' && path === '/settings/jellyfin') return json(state.jellyfin);
      if (method === 'GET' && path === '/settings/network') return json(state.network);
      return error(404, 'not found');
    }

    if (path === '/request' && method === 'GET') {
      if (!caller) return denied();
      const take = Number(req.query.get('take') ?? 10);
      const skip = Number(req.query.get('skip') ?? 0);
      const all = hasPermission(caller, MANAGE_REQUESTS) || hasPermission(caller, REQUEST_VIEW);
      const visible = state.requests
        .filter((r) => all || r.requestedBy === caller.id)
        .sort((a, b) => b.id - a.id);
      return json({
        pageInfo: {
          pages: Math.ceil(visible.length / take),
          pageSize: take,
          results: visible.length,
          page: Math.ceil(skip / take) + 1,
        },
        results: visible.slice(skip, skip + take).map(requestJson),
        serviceErrors: { radarr: [], sonarr: [] },
      });
    }

    if (!path.startsWith('/user')) return error(404, 'not found');
    // router.use('/user', isAuthenticated(), ...)
    if (!caller) return denied();
    const manager = hasPermission(caller, MANAGE_USERS);

    if (method === 'GET' && path === '/user') {
      const take = Number(req.query.get('take') ?? 10);
      const skip = Number(req.query.get('skip') ?? 0);
      const sort = req.query.get('sort');
      const users = [...state.users.values()].sort((a, b) =>
        sort === 'created' ? a.createdAt.localeCompare(b.createdAt) : a.id - b.id,
      );
      return json({
        pageInfo: {
          pages: Math.ceil(users.length / take),
          pageSize: take,
          results: users.length,
          page: Math.ceil(skip / take) + 1,
        },
        results: users.slice(skip, skip + take).map((u) => userJson(u, manager)),
      });
    }

    if (method === 'POST' && path === '/user/import-from-jellyfin') {
      const ids = (body as { jellyfinUserIds?: unknown } | undefined)?.jellyfinUserIds;
      if (!Array.isArray(ids))
        return invalid('/body/jellyfinUserIds', "must have required property 'jellyfinUserIds'");
      if (!manager) return denied();
      const created: MockSeerrUser[] = [];
      for (const raw of ids) {
        const jellyfinUserId = normalizeGuid(raw);
        if (!jellyfinUserId) continue;
        const name = state.jellyfinUsers.get(jellyfinUserId);
        if ([...state.users.values()].some((u) => u.jellyfinUserId === jellyfinUserId)) continue;
        // jellyfinUser is undefined: email undefined fails on the unique email column (inferred).
        if (name === undefined) return error(500, 'SQLITE_CONSTRAINT: UNIQUE constraint failed: user.email');
        created.push(
          addUser({
            email: name,
            jellyfinUserId,
            jellyfinUsername: name,
            permissions: state.main.defaultPermissions as number,
          }),
        );
      }
      return json(
        created.map((u) => userJson(u, false)),
        201,
      );
    }

    const byJellyfin = /^\/user\/jellyfin\/([^/]+)$/.exec(path);
    if (method === 'GET' && byJellyfin) {
      const id = normalizeGuid(decodeURIComponent(byJellyfin[1]!));
      if (!id) return error(400, 'Invalid Jellyfin User ID.');
      const user = [...state.users.values()].find((u) => u.jellyfinUserId === id);
      return user ? json(userJson(user, manager)) : error(404, 'User not found.');
    }

    const m = /^\/user\/([^/]+)(\/.*)?$/.exec(path);
    if (!m) return error(404, 'not found');
    const targetId = Number(m[1]);
    const rest = m[2] ?? '';
    const target = state.users.get(targetId);
    const ownProfile = caller.id === targetId;

    if (method === 'GET' && rest === '') {
      return target ? json(userJson(target, ownProfile || manager)) : error(404, 'User not found.');
    }

    if (rest === '/settings/main') {
      // isOwnProfileOrAdmin
      if (!manager && !ownProfile)
        return error(403, "You do not have permission to view this user's settings.");
      if (!target) return error(404, 'User not found.');
      if (method === 'GET') {
        const defaults = state.main.defaultQuotas as {
          movie: { quotaLimit?: number; quotaDays?: number };
          tv: { quotaLimit?: number; quotaDays?: number };
        };
        // JSON.stringify leaves the undefined fields of absent settings out.
        return json({
          username: target.username,
          email: target.email,
          locale: target.settings?.locale,
          discoverRegion: target.settings?.discoverRegion,
          streamingRegion: target.settings?.streamingRegion,
          originalLanguage: target.settings?.originalLanguage,
          movieQuotaLimit: target.movieQuotaLimit ?? undefined,
          movieQuotaDays: target.movieQuotaDays ?? undefined,
          tvQuotaLimit: target.tvQuotaLimit ?? undefined,
          tvQuotaDays: target.tvQuotaDays ?? undefined,
          globalMovieQuotaDays: defaults.movie.quotaDays,
          globalMovieQuotaLimit: defaults.movie.quotaLimit,
          globalTvQuotaDays: defaults.tv.quotaDays,
          globalTvQuotaLimit: defaults.tv.quotaLimit,
          watchlistSyncMovies: target.settings?.watchlistSyncMovies,
          watchlistSyncTv: target.settings?.watchlistSyncTv,
        });
      }
      if (method === 'POST') {
        if (!body || typeof body !== 'object' || Array.isArray(body))
          return invalid('/body', 'must be object');
        const b = body as Record<string, unknown>;
        for (const key of ['movieQuotaLimit', 'movieQuotaDays', 'tvQuotaLimit', 'tvQuotaDays']) {
          if (b[key] !== undefined && b[key] !== null && typeof b[key] !== 'number') {
            return invalid(`/body/${key}`, 'must be number');
          }
        }
        if (b.email !== undefined && typeof b.email !== 'string')
          return invalid('/body/email', 'must be string');
        // "Owner" user settings cannot be modified by other users.
        if (target.id === 1 && caller.id !== 1) {
          return error(403, "You do not have permission to modify this user's settings.");
        }
        // TypeORM leaves a column alone when the property is undefined (UNVERIFIED, design 28.8).
        if (b.username !== undefined) target.username = (b.username as string | null) ?? null;
        target.email = ((b.email as string) || target.jellyfinUsername || target.email).toLowerCase();
        // Quotas only when the target lacks MANAGE_USERS and the caller is not the target.
        if (!hasPermission(target, MANAGE_USERS) && caller.id !== target.id) {
          const quota = (key: string) => (typeof b[key] === 'number' ? (b[key] as number) : null);
          target.movieQuotaLimit = quota('movieQuotaLimit');
          target.movieQuotaDays = quota('movieQuotaDays');
          target.tvQuotaLimit = quota('tvQuotaLimit');
          target.tvQuotaDays = quota('tvQuotaDays');
        }
        const values = {
          locale: (b.locale as string | undefined) ?? '',
          discoverRegion: (b.discoverRegion as string | null | undefined) ?? null,
          streamingRegion: (b.streamingRegion as string | null | undefined) ?? null,
          originalLanguage: (b.originalLanguage as string | null | undefined) ?? null,
          watchlistSyncMovies: (b.watchlistSyncMovies as boolean | null | undefined) ?? null,
          watchlistSyncTv: (b.watchlistSyncTv as boolean | null | undefined) ?? null,
        };
        if (!target.settings) {
          // new UserSettings({ user: req.user, ... }): linked to the caller.
          target.settings = { linkedTo: caller.id, ...values };
          if (caller.id !== target.id) state.foreignSettings.push(target.id);
        } else {
          target.settings = { ...target.settings, ...values };
        }
        return json({
          username: target.username,
          locale: target.settings.locale,
          discoverRegion: target.settings.discoverRegion,
          streamingRegion: target.settings.streamingRegion,
          originalLanguage: target.settings.originalLanguage,
          watchlistSyncMovies: target.settings.watchlistSyncMovies,
          watchlistSyncTv: target.settings.watchlistSyncTv,
          email: target.email,
        });
      }
    }

    if (rest === '/settings/permissions') {
      if (method === 'GET') {
        if (!manager && !ownProfile)
          return error(403, "You do not have permission to view this user's settings.");
        return target ? json({ permissions: target.permissions }) : error(404, 'User not found.');
      }
      if (method === 'POST') {
        const permissions = (body as { permissions?: unknown } | undefined)?.permissions;
        if (permissions === undefined)
          return invalid('/body/permissions', "must have required property 'permissions'");
        if (typeof permissions !== 'number') return invalid('/body/permissions', 'must be number');
        if (!manager) return denied();
        if (!target) return error(404, 'User not found.');
        if (target.id === 1 || caller.id === target.id) {
          return error(403, 'You do not have permission to modify this user');
        }
        if (permissions & ADMIN && caller.id !== 1) {
          return error(403, 'You do not have permission to grant this level of access');
        }
        target.permissions = permissions;
        return json({ permissions });
      }
    }

    if (method === 'GET' && rest === '/quota') {
      if (!ownProfile && !(hasPermission(caller, MANAGE_USERS) && hasPermission(caller, MANAGE_REQUESTS))) {
        return error(403, "You do not have permission to view this user's request limits.");
      }
      return target ? json(quotaOf(target)) : error(404, 'User not found.');
    }

    if (method === 'DELETE' && rest === '') {
      if (!manager) return denied();
      if (!target) return error(404, 'User not found.');
      if (target.id === 1) return error(405, 'This account cannot be deleted.');
      if (hasPermission(target, ADMIN) && caller.id !== 1) {
        return error(405, 'You cannot delete users with administrative privileges.');
      }
      state.requests = state.requests.filter((r) => r.requestedBy !== target.id);
      state.users.delete(target.id);
      return json(userJson(target, false));
    }

    return error(404, 'not found');
  }

  let inFlight = 0;
  function send(res: ServerResponse, answer: MockSeerrAnswer) {
    res.statusCode = answer.status ?? 200;
    for (const [key, value] of Object.entries(answer.headers ?? {})) res.setHeader(key, value);
    if (answer.text !== undefined) {
      res.setHeader('content-type', answer.contentType ?? 'text/plain');
      res.end(answer.text);
    } else if (answer.json !== undefined) {
      res.setHeader('content-type', answer.contentType ?? 'application/json; charset=utf-8');
      res.end(JSON.stringify(answer.json));
    } else {
      res.end();
    }
  }

  const server = createServer((req, res) => {
    inFlight++;
    state.maxInFlight = Math.max(state.maxInFlight, inFlight);
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      let body: unknown = raw || undefined;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        // Keep the text.
      }
      const inside = url.pathname.startsWith('/api/v1/') || url.pathname === '/api/v1';
      const recorded: MockSeerrRequestRecord = {
        method: req.method ?? 'GET',
        path: inside ? url.pathname.slice('/api/v1'.length) || '/' : url.pathname,
        query: url.searchParams,
        headers: req.headers,
        body,
      };
      requests.push(recorded);
      // Outside the API Seerr serves its web app (Next.js): an HTML page.
      const answer =
        state.override?.(recorded) ??
        (inside
          ? route(recorded)
          : { text: '<!DOCTYPE html><html><body>Seerr</body></html>', contentType: 'text/html' });
      setTimeout(() => {
        inFlight--;
        send(res, answer);
      }, state.delayMs);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    state,
    addJellyfinUser: (id, name) => state.jellyfinUsers.set(id, name),
    addUser,
    addRequest: (request) => {
      const full: MockSeerrRequest = {
        seasons: request.type === 'tv' ? 1 : 0,
        createdAt: stamp(),
        ...request,
        id: request.id ?? nextRequestId,
      };
      nextRequestId = Math.max(nextRequestId, full.id + 1);
      state.requests.push(full);
      return full;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
