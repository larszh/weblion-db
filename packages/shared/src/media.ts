import type { Location, ProviderType } from './providers';
import type { Permission } from './permissions';

/**
 * Streaming (module "media"): accounts on Jellyfin media servers, sold with an allowance.
 *
 * weblion runs Jellyfin instances, connected as provider connections of type "jellyfin".
 * Platform staff (or the reseller) give an organization an allowance on one instance: how many
 * accounts, which libraries they see, how many devices may stream at once, whether downloads are
 * allowed and an optional bitrate limit outside the server's network. Within it the organization
 * creates accounts. The console sets every account's Jellyfin policy from the allowance and
 * repairs it when it drifts. Accounts are never administrators.
 *
 * Login names are "<name>-<account code>" (e.g. "anna-kemaro"). The code belongs to the
 * allowance, so names never collide between customers and do not name the customer: every
 * account of a Jellyfin server can list all accounts of that server.
 */

// --- Login names ------------------------------------------------------------------------

/** Name part of a login name, before "-<account code>": a-z, 0-9 and single dashes, 1 to 20 characters. */
export const MEDIA_ACCOUNT_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,18}[a-z0-9])?$/;
/** Account codes staff choose: 3 to 12 lower-case letters. */
export const MEDIA_ACCOUNT_CODE_PATTERN = /^[a-z]{3,12}$/;
/** Generated codes alternate these letters, e.g. "kemaro": easy to read out and to type. */
export const MEDIA_CODE_CONSONANTS = 'bdfghjkmnprstvwz';
export const MEDIA_CODE_VOWELS = 'aeiu';
export const MEDIA_GENERATED_CODE_LENGTH = 6;
/** Longest login name the console creates: 20 + "-" + 12. */
export const MEDIA_USERNAME_MAX = 33;

export function isMediaAccountName(value: string): boolean {
  return MEDIA_ACCOUNT_NAME_PATTERN.test(value) && !value.includes('--');
}

export function isMediaAccountCode(value: string): boolean {
  return MEDIA_ACCOUNT_CODE_PATTERN.test(value);
}

/** "anna" and "kemaro" give "anna-kemaro". Codes have no dash, so the last dash separates. */
export function mediaUsername(name: string, accountCode: string): string {
  return `${name}-${accountCode}`;
}

// --- Passwords ---------------------------------------------------------------------------

/** Panel minimum for chosen passwords. Jellyfin itself accepts any non-empty password. */
export const MEDIA_PASSWORD_MIN = 10;
export const MEDIA_PASSWORD_MAX = 128;
/** Generated passwords: lower-case letters and digits without look-alikes, about 80 bits. */
export const MEDIA_GENERATED_PASSWORD_LENGTH = 16;
export const MEDIA_PASSWORD_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

export type MediaPasswordIssue = 'length' | 'tooLong' | 'characters';

/** The panel's rules for a chosen password: length, no control characters, no spaces at the ends. */
export function mediaPasswordIssues(password: string): MediaPasswordIssue[] {
  const issues: MediaPasswordIssue[] = [];
  const length = [...password].length;
  if (length < MEDIA_PASSWORD_MIN) issues.push('length');
  if (length > MEDIA_PASSWORD_MAX) issues.push('tooLong');
  if (/\p{Cc}/u.test(password) || password.trim() !== password) issues.push('characters');
  return issues;
}

// --- Ids and libraries -------------------------------------------------------------------

/** Jellyfin ids (users, libraries) as the console keeps them: 32 lower-case hex characters. */
export const MEDIA_ID_PATTERN = /^[0-9a-f]{32}$/;
const DASHED_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Jellyfin writes ids without dashes and reads both forms. null for anything else. */
export function normalizeMediaId(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (MEDIA_ID_PATTERN.test(v)) return v;
  return DASHED_GUID.test(v) ? v.replace(/-/g, '') : null;
}

/** Jellyfin CollectionTypeOptions. */
export const MEDIA_LIBRARY_TYPES = [
  'movies',
  'tvshows',
  'music',
  'musicvideos',
  'homevideos',
  'boxsets',
  'books',
  'mixed',
] as const;
export type MediaLibraryType = (typeof MEDIA_LIBRARY_TYPES)[number];

export function isMediaLibraryType(value: string): value is MediaLibraryType {
  return (MEDIA_LIBRARY_TYPES as readonly string[]).includes(value);
}

/** A library (Jellyfin "virtual folder"), addressed by its ItemId as EnabledFolders holds it. */
export interface MediaLibraryRef {
  id: string;
  name: string;
  /** null: mixed content without a type, or a type this version does not know. */
  type: MediaLibraryType | null;
  /** Set by the sync when the instance no longer has the library. */
  missing?: boolean;
}

// --- Allowance limits ----------------------------------------------------------------------

export const MEDIA_MAX_ACCOUNTS = 10_000;
export const MEDIA_MAX_STREAMS = 20;
/** Jellyfin keeps the limit as an int of bits per second (at most about 2147 Mbit/s). */
export const MEDIA_MAX_BITRATE_MBIT = 1000;
/** Suggestions in the allowance dialog. */
export const MEDIA_BITRATE_PRESETS_MBIT = [4, 8, 15, 25, 40] as const;
/** Sessions count as active for the admin overview when seen within this many seconds. */
export const MEDIA_ACTIVE_WITHIN_SECONDS = 600;

/** The access part of an allowance: what every account of the organization gets. */
export interface MediaAccess {
  libraryIds: string[];
  maxStreams: number;
  downloads: boolean;
  /** null = the server's own setting. */
  remoteBitrateMbit: number | null;
}

export type MediaAccessConflict = 'libraries' | 'streams' | 'downloads' | 'bitrate';

/** What `child` grants beyond `parent` (a customer's allowance within its reseller's). Empty = within. */
export function mediaAccessExceeds(child: MediaAccess, parent: MediaAccess): MediaAccessConflict[] {
  const out: MediaAccessConflict[] = [];
  if (child.libraryIds.some((id) => !parent.libraryIds.includes(id))) out.push('libraries');
  if (child.maxStreams > parent.maxStreams) out.push('streams');
  if (child.downloads && !parent.downloads) out.push('downloads');
  if (
    parent.remoteBitrateMbit !== null &&
    (child.remoteBitrateMbit === null || child.remoteBitrateMbit > parent.remoteBitrateMbit)
  ) {
    out.push('bitrate');
  }
  return out;
}

export function mediaBitrateBps(mbit: number | null): number {
  return mbit ? mbit * 1_000_000 : 0;
}

// --- Policy ----------------------------------------------------------------------------------

export const MEDIA_SYNCPLAY_ACCESS = ['CreateAndJoinGroups', 'JoinGroups', 'None'] as const;
export type MediaSyncPlayAccess = (typeof MEDIA_SYNCPLAY_ACCESS)[number];
/** SyncPlay lists other users' groups with their names: off on shared instances. */
export const MEDIA_SYNCPLAY_DEFAULT: MediaSyncPlayAccess = 'None';

/** The policy fields the console owns, as the server has them (see the mapping in the design). */
export interface MediaPolicyState {
  administrator: boolean;
  hidden: boolean;
  remoteAccess: boolean;
  allLibraries: boolean;
  /** Sorted, lower case. */
  libraryIds: string[];
  /** 0 = unlimited. */
  maxSessions: number;
  downloads: boolean;
  /** Sync transcoding or media conversion (offline copies). */
  conversion: boolean;
  /** 0 = the server's setting. */
  remoteBitrateBps: number;
  contentDeletion: boolean;
  remoteControlOthers: boolean;
  sharedDeviceControl: boolean;
  liveTv: boolean;
  /** Collection, subtitle or lyric management. */
  metadataManagement: boolean;
  publicSharing: boolean;
  channels: boolean;
  syncPlay: MediaSyncPlayAccess;
}

export type MediaPolicyField = keyof MediaPolicyState;

export const MEDIA_POLICY_FIELDS: readonly MediaPolicyField[] = [
  'administrator',
  'hidden',
  'remoteAccess',
  'allLibraries',
  'libraryIds',
  'maxSessions',
  'downloads',
  'conversion',
  'remoteBitrateBps',
  'contentDeletion',
  'remoteControlOthers',
  'sharedDeviceControl',
  'liveTv',
  'metadataManagement',
  'publicSharing',
  'channels',
  'syncPlay',
];

/** The policy every account of an allowance gets. */
export function expectedMediaPolicy(access: MediaAccess): MediaPolicyState {
  return {
    administrator: false,
    hidden: true,
    remoteAccess: true,
    allLibraries: false,
    libraryIds: [...new Set(access.libraryIds.map((id) => id.toLowerCase()))].sort(),
    maxSessions: access.maxStreams,
    downloads: access.downloads,
    conversion: access.downloads,
    remoteBitrateBps: mediaBitrateBps(access.remoteBitrateMbit),
    contentDeletion: false,
    remoteControlOthers: false,
    sharedDeviceControl: false,
    liveTv: false,
    metadataManagement: false,
    publicSharing: false,
    channels: false,
    syncPlay: MEDIA_SYNCPLAY_DEFAULT,
  };
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a.map((id) => id.toLowerCase()));
  const right = new Set(b.map((id) => id.toLowerCase()));
  return left.size === right.size && [...left].every((id) => right.has(id));
}

/** Fields where `actual` differs from `expected`, in MEDIA_POLICY_FIELDS order. */
export function mediaPolicyDrift(actual: MediaPolicyState, expected: MediaPolicyState): MediaPolicyField[] {
  return MEDIA_POLICY_FIELDS.filter((field) =>
    field === 'libraryIds'
      ? !sameIds(actual.libraryIds, expected.libraryIds)
      : actual[field] !== expected[field],
  );
}

// --- Accounts --------------------------------------------------------------------------------

/**
 * policy: the policy differs from the allowance (repair pending or failed).
 * administrator: a Jellyfin administrator (only possible when changed in Jellyfin).
 * blocked_folders: legacy blocked libraries; library limits cannot be enforced for this user.
 * no_password: anyone who knows the name signs in without a password.
 * locked_out: disabled by Jellyfin after failed sign-ins.
 * no_allowance: the organization has no allowance on this instance, the policy is not managed.
 */
export const MEDIA_ACCOUNT_ISSUES = [
  'policy',
  'administrator',
  'blocked_folders',
  'no_password',
  'locked_out',
  'no_allowance',
] as const;
export type MediaAccountIssue = (typeof MEDIA_ACCOUNT_ISSUES)[number];

/** Days of last activity are given in this zone (the console's customers are in Switzerland). */
export const MEDIA_ACTIVITY_TIME_ZONE = 'Europe/Zurich';

/** "2026-10-11" for an ISO timestamp, null for null or garbage. Never the time of day. */
export function mediaActivityDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MEDIA_ACTIVITY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(time);
}

export interface MediaAllowanceDto {
  orgId: string;
  /** The Jellyfin instance; url = where users sign in. */
  provider: { id: string; type: ProviderType; name: string; url: string | null } | null;
  /** Login names of new accounts end with "-<accountCode>". */
  accountCode: string;
  maxAccounts: number;
  libraries: MediaLibraryRef[];
  maxStreams: number;
  downloads: boolean;
  remoteBitrateMbit: number | null;
  /** Counted against maxAccounts: own accounts plus, for a reseller, its customers' maxAccounts. */
  accounts: number;
  /** Customer allowances of a reseller on the instance (0 for everyone else). */
  customers: number;
  /** Sum of those customers' maxAccounts. */
  customerAccounts: number;
  updatedAt: string | null;
}

export interface MediaAccountDto {
  id: string;
  /** Jellyfin login name, e.g. "anna-kemaro". */
  username: string;
  enabled: boolean;
  hasPassword: boolean;
  /** Calendar day of the last activity (Europe/Zurich), e.g. "2026-10-11"; null = never. */
  lastActiveOn: string | null;
  issues: MediaAccountIssue[];
  provider: { id: string; type: ProviderType; name: string };
  location: Location;
  org: { id: string; name: string; slug: string } | null;
  /** Where the user signs in (the instance's address). */
  loginUrl: string | null;
  /** Actions the current user may perform on this account. */
  permissions: Permission[];
  lastSyncedAt: string | null;
  missingSince: string | null;
  createdAt: string;
}

/** How users sign in on the organization's instance. */
export interface MediaLoginDto {
  /** The address users enter in the apps. */
  url: string;
  /** Server name the apps show; null when the instance could not be read. */
  serverName: string | null;
  /** Quick Connect (sign in on a TV by confirming a code); null = unknown. */
  quickConnect: boolean | null;
  accountCode: string;
}

/** GET /orgs/:orgId/media */
export interface OrgMediaDto {
  allowance: MediaAllowanceDto | null;
  accounts: MediaAccountDto[];
  /** null without an allowance. */
  login: MediaLoginDto | null;
}

/** Creating an account, setting a password or importing with a new one: the password is shown once. */
export interface MediaAccountSecretDto {
  account: MediaAccountDto;
  /** null when the caller chose the password (or the import set none). */
  password: string | null;
}

export interface MediaPolicyApplyResult {
  /** Accounts whose policy was written. */
  applied: number;
  failed: { accountId: string; username: string; error: string }[];
}

/** Answer of setting an allowance: the new allowance and the policy writes it caused. */
export interface MediaAllowanceChangeResult {
  allowance: MediaAllowanceDto;
  policy: MediaPolicyApplyResult;
}

/** A user at an instance the console does not manage (created in Jellyfin directly). */
export interface UnmanagedMediaUserDto {
  userId: string;
  username: string;
  enabled: boolean;
  administrator: boolean;
  hasPassword: boolean;
  lastActiveOn: string | null;
  /** Why it cannot be imported; null = it can. */
  blocked: 'administrator' | 'blocked_folders' | null;
}

/** One Jellyfin instance in the admin overview. */
export interface MediaInstanceDto {
  provider: {
    id: string;
    type: ProviderType;
    name: string;
    url: string | null;
    enabled: boolean;
    status: 'ok' | 'error' | 'unknown';
  };
  location: Location;
  /** Organizations with an allowance here. 1 = a dedicated instance. */
  organizations: number;
  /** Accounts the console manages here, assigned or not. */
  accounts: number;
  accountsWithIssues: number;
  /** Read live; null when the instance could not be read (see error). Counts only. */
  live: {
    serverName: string | null;
    version: string | null;
    users: number;
    libraries: number;
    activeSessions: number;
    playing: number;
    quickConnect: boolean | null;
  } | null;
  error: string | null;
}

/** `details` of a 409 "account_limit". */
export interface MediaAccountLimitDetails {
  maxAccounts: number;
  accounts: number;
}

/** `details` of a 409 "allowance_conflict": customer allowances a change would leave outside. */
export interface MediaAllowanceConflictDetails {
  customers: { id: string; name: string; conflicts: (MediaAccessConflict | 'accounts')[] }[];
}
