import { MEDIA_SEERR_PROBLEMS, normalizeMediaId, type MediaSeerrProblem } from '@weblion/shared';
import { isRecord, str } from '../http';
import type { RemoteSeerrUser } from '../types';
import { SEERR_MEDIA_SERVER_JELLYFIN } from './rules';

// Pure mapping of Seerr answers (camelCase JSON, user ids as integers, Jellyfin ids as 32 hex) to
// the console's types. Every parser keeps only what the console needs: never emails, names,
// avatars, titles, TMDB ids, request ids beyond counting, tokens or keys. Shapes as in Seerr 3.5.

// ---------------------------------------------------------------------------
// Values

/** A Seerr id (users, requests): a positive integer, else null. */
export function seerrId(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** A count or bit set: a non-negative integer, else null. */
function whole(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/** Guid.Empty is never a user. */
const EMPTY_ID = '0'.repeat(32);

/** A Jellyfin id as Seerr stores it (any case, with or without dashes) as 32 lower-case hex, else null. */
export function seerrJellyfinId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = normalizeMediaId(value);
  return id && id !== EMPTY_ID ? id : null;
}

// ---------------------------------------------------------------------------
// Users

/**
 * A User of GET /user, /user/{id}, /user/jellyfin/{id} or the import answer as RemoteSeerrUser:
 * ids, permissions and the four quota columns. Email, names, avatar and user type are dropped.
 * null without a valid id or permissions (the console never guesses rights).
 */
export function parseSeerrUser(raw: unknown): RemoteSeerrUser | null {
  if (!isRecord(raw)) return null;
  const id = seerrId(raw.id);
  const permissions = whole(raw.permissions);
  if (id === null || permissions === null) return null;
  return {
    id,
    jellyfinUserId: seerrJellyfinId(raw.jellyfinUserId),
    permissions,
    // Nullable columns: JSON null, or left out when undefined.
    movieQuotaLimit: whole(raw.movieQuotaLimit),
    movieQuotaDays: whole(raw.movieQuotaDays),
    tvQuotaLimit: whole(raw.tvQuotaLimit),
    tvQuotaDays: whole(raw.tvQuotaDays),
  };
}

/** pageInfo.pages of a paged answer; null when missing or garbage. */
function pagesOf(raw: Record<string, unknown>): number | null {
  return isRecord(raw.pageInfo) ? whole(raw.pageInfo.pages) : null;
}

export interface SeerrUserPage {
  users: RemoteSeerrUser[];
  /** Entries on the page, parsable or not (an empty page ends the paging). */
  entries: number;
  pages: number | null;
}

/** One page of GET /user; null when the answer is not a page at all. */
export function parseSeerrUserPage(raw: unknown): SeerrUserPage | null {
  if (!isRecord(raw) || !Array.isArray(raw.results)) return null;
  return {
    users: raw.results.map(parseSeerrUser).filter((u): u is RemoteSeerrUser => u !== null),
    entries: raw.results.length,
    pages: pagesOf(raw),
  };
}

/** GET /user/{id}/quota: what the user used in each window. null when the answer is no quota. */
export function parseSeerrQuota(raw: unknown): { movieUsed: number; tvUsed: number } | null {
  if (!isRecord(raw) || !isRecord(raw.movie) || !isRecord(raw.tv)) return null;
  return { movieUsed: whole(raw.movie.used) ?? 0, tvUsed: whole(raw.tv.used) ?? 0 };
}

/**
 * The fields of GET /user/{id}/settings/main that POST /user/{id}/settings/main overwrites from
 * its body, exactly as read: a key that was left out stays out. Never the global quotas (read
 * only) and never the user's own quotas (the caller adds them where it means to write them).
 */
const SETTINGS_COPY = [
  'username',
  'email',
  'locale',
  'discoverRegion',
  'streamingRegion',
  'originalLanguage',
  'watchlistSyncMovies',
  'watchlistSyncTv',
] as const;

export function seerrSettingsCopy(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SETTINGS_COPY) {
    if (key in raw && raw[key] !== undefined) out[key] = raw[key];
  }
  return out;
}

/**
 * Whether the user has user settings: the answer carries `locale` only then (Seerr reads it from
 * the settings row, and JSON leaves undefined values out). Users made by the import have none.
 */
export function seerrHasUserSettings(raw: Record<string, unknown>): boolean {
  return 'locale' in raw && raw.locale !== undefined;
}

// ---------------------------------------------------------------------------
// Requests (counts only)

/** Seerr's MediaRequestStatus (server/constants/media.ts). */
export const SEERR_REQUEST_STATUS = {
  PENDING: 1,
  APPROVED: 2,
  DECLINED: 3,
  FAILED: 4,
  COMPLETED: 5,
} as const;

/** One request as the console keeps it: its id (to count it once), status and requester. */
export interface SeerrRequestRef {
  id: number;
  status: number;
  requestedBy: number;
}

export interface SeerrRequestPage {
  requests: SeerrRequestRef[];
  entries: number;
  pages: number | null;
}

/**
 * One page of GET /request. Reads `id`, `status` and `requestedBy.id` only: media (TMDB ids,
 * titles), seasons, dates and the requester's email never leave this function.
 */
export function parseRequestPage(raw: unknown): SeerrRequestPage | null {
  if (!isRecord(raw) || !Array.isArray(raw.results)) return null;
  const requests: SeerrRequestRef[] = [];
  for (const entry of raw.results) {
    if (!isRecord(entry)) continue;
    const id = seerrId(entry.id);
    const status = whole(entry.status);
    const requestedBy = isRecord(entry.requestedBy) ? seerrId(entry.requestedBy.id) : null;
    if (id !== null && status !== null && requestedBy !== null) requests.push({ id, status, requestedBy });
  }
  return { requests, entries: raw.results.length, pages: pagesOf(raw) };
}

// ---------------------------------------------------------------------------
// Settings and check

/** The fields of the main settings the check reads. Never apiKey. */
export interface SeerrMainSettings {
  newPlexLogin: boolean | null;
  defaultPermissions: number | null;
  mediaServerLogin: boolean | null;
  localLogin: boolean | null;
  mediaServerType: number | null;
}

/** GET or POST /settings/main; null when the answer is no settings object. */
export function parseSeerrMainSettings(raw: unknown): SeerrMainSettings | null {
  if (!isRecord(raw)) return null;
  return {
    newPlexLogin: bool(raw.newPlexLogin),
    defaultPermissions: whole(raw.defaultPermissions),
    mediaServerLogin: bool(raw.mediaServerLogin),
    localLogin: bool(raw.localLogin),
    mediaServerType: whole(raw.mediaServerType),
  };
}

/**
 * GET /settings/jellyfin: the server id only (null when Seerr has none). The answer's apiKey is
 * Seerr's own Jellyfin key, a full Jellyfin administrator: it is never read.
 */
export function parseSeerrJellyfinSettings(raw: unknown): { serverId: string | null } | null {
  if (!isRecord(raw)) return null;
  return { serverId: seerrJellyfinId(raw.serverId) };
}

/** GET /settings/network: whether CSRF protection is on. The proxy password is never read. */
export function parseSeerrNetworkSettings(raw: unknown): { csrfProtection: boolean | null } | null {
  if (!isRecord(raw)) return null;
  return { csrfProtection: bool(raw.csrfProtection) };
}

/** GET /status (public). */
export function parseSeerrStatus(raw: unknown): { version: string | null } {
  return { version: isRecord(raw) ? str(raw.version) : null };
}

/**
 * Problems of the main settings (design 19.3 step 2): not set up for Jellyfin, sign-ins of
 * unknown Jellyfin users create Seerr users, new users get rights, Jellyfin sign-in off. A value
 * that could not be read counts as a problem: the console only switches on what it verified.
 */
export function seerrSettingsProblems(main: SeerrMainSettings): MediaSeerrProblem[] {
  const out: MediaSeerrProblem[] = [];
  if (main.mediaServerType !== SEERR_MEDIA_SERVER_JELLYFIN) out.push('not_jellyfin');
  if (main.newPlexLogin !== false) out.push('new_signins');
  if (main.defaultPermissions !== 0) out.push('default_permissions');
  if (main.mediaServerLogin !== true) out.push('media_server_login');
  return out;
}

/** Problems unique and in the order of MEDIA_SEERR_PROBLEMS, so checks compare and display alike. */
export function sortSeerrProblems(problems: readonly MediaSeerrProblem[]): MediaSeerrProblem[] {
  const set = new Set(problems);
  return MEDIA_SEERR_PROBLEMS.filter((p) => set.has(p));
}

// ---------------------------------------------------------------------------
// Errors

/** The text of Seerr's 403 for a request without a (known) user: a wrong key, or X-API-User unknown. */
export const SEERR_NO_PERMISSION = 'You do not have permission to access this endpoint';

/**
 * What an error answer says: `message` or `error` (the express error handler and
 * isAuthenticated), else the first entry of `errors` (OpenAPI validation objects with a path,
 * or Seerr's error codes as strings), else plain text that is not an HTML page. At most 300
 * characters; null when it says nothing usable.
 */
export function seerrMessage(body: unknown): string | null {
  if (isRecord(body)) {
    const direct = str(body.message) ?? str(body.error);
    if (direct) return direct.slice(0, 300);
    if (Array.isArray(body.errors)) {
      for (const entry of body.errors) {
        if (typeof entry === 'string' && entry.trim()) return entry.trim().slice(0, 300);
        if (isRecord(entry)) {
          const message = str(entry.message);
          if (!message) continue;
          const path = str(entry.path);
          return (path ? `${path}: ${message}` : message).slice(0, 300);
        }
      }
    }
    return null;
  }
  if (typeof body === 'string') {
    const text = body.trim();
    if (!text || text.startsWith('<')) return null;
    return text.slice(0, 300);
  }
  return null;
}

/**
 * "<action> failed: <message> (HTTP <status>)" plus what the operator can do about it. A 403 with
 * Seerr's permission text means the key was rejected, unless the request acted as a user
 * (X-API-User), where it means Seerr does not know that user.
 */
export function describeSeerrError(
  res: { status: number; body: unknown },
  action?: string,
  options: { actingAsUser?: boolean } = {},
): string {
  const { status, body } = res;
  const redirect = status >= 300 && status < 400;
  const message = seerrMessage(body) ?? (redirect ? 'redirect' : 'refused without a reason');
  let hint: string | null = null;
  if (status === 403 && /csrf/i.test(message)) {
    hint = "Seerr's CSRF protection is on: switch it off under Settings > Network";
  } else if (status === 403 && message.includes(SEERR_NO_PERMISSION)) {
    hint = options.actingAsUser
      ? 'Seerr does not know this user (any more)'
      : 'the API key was rejected (Seerr answers 403 for an unknown key): copy it from Seerr > Settings > General';
  } else if (redirect) {
    hint = 'Seerr redirects: check the address';
  } else if (status === 502 || status === 503 || status === 504) {
    hint = 'Seerr or its proxy is not available';
  }
  const out = `${action ? `${action} failed: ` : ''}${message} (HTTP ${status})`;
  return hint ? `${out}. ${hint.charAt(0).toUpperCase()}${hint.slice(1)}` : out;
}

/**
 * Keys whose values never leave the client: Seerr's API key (in the main settings), its Jellyfin
 * administrator key (settings/jellyfin), the proxy password (settings/network), user tokens and
 * other secrets of settings the console does not read.
 */
const SECRET_KEY = /^(api_?key|password|.*token|.*secret|vapidprivate|resetpasswordguid)$/i;

/** Every answer as the client hands it on: values of secret keys replaced, at any depth. */
export function redactSeerr(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSeerr);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] =
      SECRET_KEY.test(key) && v !== null && v !== undefined && v !== '' ? '[redacted]' : redactSeerr(v);
  }
  return out;
}
