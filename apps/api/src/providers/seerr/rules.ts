import { ProviderError, badRequest, conflict } from '../../lib/errors';
import type { RemoteSeerrUser, SeerrUserAccess } from '../types';

/**
 * Seerr (the request site of a Jellyfin instance) as the console uses it: shared by the client,
 * the Jellyfin adapter, the demo and the service. Facts from the Seerr source (3.5.1); frozen
 * after the Part 2 foundation, so units can rely on the values.
 */

/** Name in errors of the Seerr client and the demo. */
export const SEERR = 'Seerr';

/** Seerr's permission bits (server/lib/permissions.ts). ADMIN passes every check. */
export const SEERR_PERMISSION = {
  NONE: 0,
  ADMIN: 2,
  MANAGE_SETTINGS: 4,
  MANAGE_USERS: 8,
  MANAGE_REQUESTS: 16,
  REQUEST: 32,
  VOTE: 64,
  AUTO_APPROVE: 128,
  AUTO_APPROVE_MOVIE: 256,
  AUTO_APPROVE_TV: 512,
  REQUEST_4K: 1024,
  REQUEST_4K_MOVIE: 2048,
  REQUEST_4K_TV: 4096,
  REQUEST_ADVANCED: 8192,
  REQUEST_VIEW: 16384,
  AUTO_APPROVE_4K: 32768,
  AUTO_APPROVE_4K_MOVIE: 65536,
  AUTO_APPROVE_4K_TV: 131072,
  REQUEST_MOVIE: 262144,
  REQUEST_TV: 524288,
  MANAGE_ISSUES: 1048576,
  VIEW_ISSUES: 2097152,
  CREATE_ISSUES: 4194304,
  AUTO_REQUEST: 8388608,
  AUTO_REQUEST_MOVIE: 16777216,
  AUTO_REQUEST_TV: 33554432,
  RECENT_VIEW: 67108864,
  WATCHLIST_VIEW: 134217728,
  MANAGE_BLOCKLIST: 268435456,
  VIEW_BLOCKLIST: 1073741824,
} as const;

/** User 1 is Seerr's owner: the plain API key acts as it, and Seerr refuses to change or delete it. */
export const SEERR_OWNER_ID = 1;

const P = SEERR_PERMISSION;

/**
 * Every bit that lets a user request or have something requested for it (REQUEST, the
 * AUTO_APPROVE, REQUEST_4K and AUTO_REQUEST families, REQUEST_MOVIE, REQUEST_TV). The sync takes
 * them from Seerr users the console does not manage.
 */
export const SEERR_REQUEST_BITS =
  P.REQUEST |
  P.AUTO_APPROVE |
  P.AUTO_APPROVE_MOVIE |
  P.AUTO_APPROVE_TV |
  P.REQUEST_4K |
  P.REQUEST_4K_MOVIE |
  P.REQUEST_4K_TV |
  P.AUTO_APPROVE_4K |
  P.AUTO_APPROVE_4K_MOVIE |
  P.AUTO_APPROVE_4K_TV |
  P.REQUEST_MOVIE |
  P.REQUEST_TV |
  P.AUTO_REQUEST |
  P.AUTO_REQUEST_MOVIE |
  P.AUTO_REQUEST_TV;

/** Staff of the Seerr instance: the console never changes their rights. */
export const SEERR_STAFF_BITS = P.ADMIN | P.MANAGE_SETTINGS | P.MANAGE_USERS | P.MANAGE_REQUESTS;

/**
 * The only bits the console grants: REQUEST_MOVIE and REQUEST_TV. Approval stays a human decision
 * in Seerr; the other bits are instance-wide views of other users.
 */
export const SEERR_GRANTABLE_BITS = P.REQUEST_MOVIE | P.REQUEST_TV;

/**
 * "Empfohlene Einstellungen": no Seerr users from unknown Jellyfin sign-ins, new users without
 * rights, sign-in with Jellyfin on. POST /settings/main merges a partial body, so exactly these
 * fields are sent (never apiKey, which is read-only in the spec).
 */
export const SEERR_SAFE_SETTINGS = {
  newPlexLogin: false,
  defaultPermissions: 0,
  mediaServerLogin: true,
} as const;

/** Seerr's mediaServerType for Jellyfin (server/constants/server.ts: PLEX 1, JELLYFIN 2, EMBY 3). */
export const SEERR_MEDIA_SERVER_JELLYFIN = 2;

/**
 * API keys: Seerr generates base64 of a timestamp and a UUID (68 characters); the env API_KEY
 * may be any string, so letters, digits and + / = . _ - from 16 to 256 characters.
 */
export const SEERR_API_KEY = /^[A-Za-z0-9+/=._-]{16,256}$/;

/** Pages of GET /request (100 each) the sync reads at most; more leaves the numbers as they were. */
export const SEERR_REQUEST_PAGES_MAX = 50;
/** Pages of GET /user (100 each) read at most. */
export const SEERR_USER_PAGES_MAX = 100;

export type SeerrAccessDriftField = 'permissions' | 'movieQuota' | 'tvQuota';

/**
 * Fields where a Seerr user differs from what the console writes. Permissions exactly (an extra
 * bit is drift too); a quota only while the permission for its type is expected. An unset limit
 * (null) differs from 0: Seerr then applies its default quota. The window only counts with a
 * limit (0 = no limit whatever the days). Used by the adapter after a write and by the sync.
 */
export function seerrAccessDrift(
  actual: RemoteSeerrUser,
  expected: SeerrUserAccess,
): SeerrAccessDriftField[] {
  const out: SeerrAccessDriftField[] = [];
  if (actual.permissions !== expected.permissions) out.push('permissions');
  const differs = (limit: number | null, days: number | null, wantLimit: number, wantDays: number) =>
    limit !== wantLimit || (wantLimit > 0 && days !== wantDays);
  if (
    expected.permissions & SEERR_PERMISSION.REQUEST_MOVIE &&
    differs(actual.movieQuotaLimit, actual.movieQuotaDays, expected.movieQuotaLimit, expected.movieQuotaDays)
  ) {
    out.push('movieQuota');
  }
  if (
    expected.permissions & SEERR_PERMISSION.REQUEST_TV &&
    differs(actual.tvQuotaLimit, actual.tvQuotaDays, expected.tvQuotaLimit, expected.tvQuotaDays)
  ) {
    out.push('tvQuota');
  }
  return out;
}

// Refusals shared by the Seerr client and the demo, so routes and tests see the same messages.

/**
 * What the console may write to a Seerr user, checked before anything is sent: whole numbers,
 * never a staff bit (ADMIN, MANAGE_*), and nothing the user does not have already except
 * REQUEST_MOVIE and REQUEST_TV. Approval, 4K and the views of other users stay Seerr staff's
 * decision; taking bits away is always allowed.
 */
export function assertSeerrAccess(access: SeerrUserAccess, current: RemoteSeerrUser): void {
  const values = [
    access.permissions,
    access.movieQuotaLimit,
    access.movieQuotaDays,
    access.tvQuotaLimit,
    access.tvQuotaDays,
  ];
  if (!values.every((v) => Number.isSafeInteger(v) && v >= 0)) {
    throw badRequest('Seerr permissions and quotas are whole numbers of 0 or more');
  }
  if (access.permissions & SEERR_STAFF_BITS) {
    throw badRequest('The console never grants administrator or manager rights in Seerr');
  }
  if (access.permissions & ~(SEERR_GRANTABLE_BITS | current.permissions)) {
    throw badRequest('The console grants only "Request Movies" and "Request Series" in Seerr');
  }
}

/** Before anything is sent: the console never changes or deletes Seerr's owner. */
export const seerrOwnerRefused = () => conflict("The console never changes Seerr's owner (user 1)");

/** The import created nothing and Seerr does not know the Jellyfin user (404), or failed (500). */
export const seerrNotImported = (reason?: string) =>
  new ProviderError(
    SEERR,
    `Seerr did not import the user: is it connected to this Jellyfin server?${reason ? ` (${reason.slice(0, 300)})` : ''}`,
    404,
  );

/** DELETE /user/{id} answered 405: the owner or an administrator. */
export const seerrDeleteRefused = () =>
  new ProviderError(SEERR, 'Seerr refuses to delete this user (owner or administrator)', 409);

/** The user read back after a write still differs (fields as seerrAccessDrift names them). */
export const seerrNotKept = (fields: readonly string[]) =>
  new ProviderError(SEERR, `Seerr did not keep the change (${fields.join(', ')})`);
