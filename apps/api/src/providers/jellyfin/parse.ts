import {
  MEDIA_SYNCPLAY_ACCESS,
  isMediaLibraryType,
  normalizeMediaId,
  type MediaLibraryRef,
  type MediaPolicyState,
  type MediaSyncPlayAccess,
} from '@weblion/shared';
import { isRecord, num, str } from '../http';
import type { MediaActivity, MediaServerInfo, RemoteMediaUser } from '../types';

// Pure mapping of Jellyfin answers (PascalCase JSON, ids as 32 hex characters without dashes)
// to the console's types, and back for the policy. Shapes as in Jellyfin 10.10 and 10.11.

/** JSON object check without arrays. */
export function isObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

/** Guid.Empty: Jellyfin writes it for "no user" (SessionInfoDto.UserId) and refuses it as an id. */
const EMPTY_ID = '0'.repeat(32);

/** A Jellyfin id as the console keeps it (32 lower-case hex), null for anything else and for Guid.Empty. */
export function jellyfinId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = normalizeMediaId(value);
  return id && id !== EMPTY_ID ? id : null;
}

// ---------------------------------------------------------------------------
// Dates

const DATE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?$/i;

/** Jellyfin dates: 7 fractional digits, possibly without offset (then UTC). null for missing or garbage. */
export function parseJellyfinDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = DATE.exec(value.trim());
  if (!m) return null;
  const [, year, month, day, hour, minute, second = '00', fraction = '', zone] = m;
  // DateTime.MinValue (0001-01-01) stands for "never"; nothing the console reads is older than 1970.
  if (Number(year) < 1970) return null;
  const millis = fraction.slice(0, 3).padEnd(3, '0');
  let offset = zone ? zone.toUpperCase() : 'Z';
  if (/^[+-]\d{4}$/.test(offset)) offset = `${offset.slice(0, 3)}:${offset.slice(3)}`;
  const time = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}.${millis}${offset}`);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

// ---------------------------------------------------------------------------
// Policy

function flag(policy: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = policy[key];
  return typeof value === 'boolean' ? value : fallback;
}

function count(policy: Record<string, unknown>, key: string): number {
  return num(policy[key]) ?? 0;
}

function list(policy: Record<string, unknown>, key: string): unknown[] {
  const value = policy[key];
  return Array.isArray(value) ? value : [];
}

/** Library ids as the console compares them: valid ids only, lower case, unique, sorted. */
function libraryIdsOf(values: readonly unknown[]): string[] {
  const ids = new Set<string>();
  for (const value of values) {
    const id = jellyfinId(value);
    if (id) ids.add(id);
  }
  return [...ids].sort();
}

/** SyncPlayAccess as Jellyfin writes it (a string); numbers as the enum values. Unknown: Jellyfin's default. */
function syncPlayOf(value: unknown): MediaSyncPlayAccess {
  if (typeof value === 'number') return MEDIA_SYNCPLAY_ACCESS[value] ?? 'CreateAndJoinGroups';
  const known = MEDIA_SYNCPLAY_ACCESS.find((v) => typeof value === 'string' && v === value);
  return known ?? 'CreateAndJoinGroups';
}

/**
 * The managed fields of a Jellyfin policy object (design 5.1). Missing keys read as the C#
 * defaults of UserPolicy, so a policy Jellyfin would reset shows up as drift.
 */
export function parsePolicyState(policy: Record<string, unknown>): MediaPolicyState {
  return {
    administrator: flag(policy, 'IsAdministrator', false),
    hidden: flag(policy, 'IsHidden', true),
    remoteAccess: flag(policy, 'EnableRemoteAccess', true),
    allLibraries: flag(policy, 'EnableAllFolders', true),
    libraryIds: libraryIdsOf(list(policy, 'EnabledFolders')),
    maxSessions: count(policy, 'MaxActiveSessions'),
    downloads: flag(policy, 'EnableContentDownloading', true),
    conversion: flag(policy, 'EnableSyncTranscoding', true) || flag(policy, 'EnableMediaConversion', true),
    remoteBitrateBps: count(policy, 'RemoteClientBitrateLimit'),
    contentDeletion:
      flag(policy, 'EnableContentDeletion', false) ||
      list(policy, 'EnableContentDeletionFromFolders').length > 0,
    remoteControlOthers: flag(policy, 'EnableRemoteControlOfOtherUsers', false),
    sharedDeviceControl: flag(policy, 'EnableSharedDeviceControl', true),
    liveTv: flag(policy, 'EnableLiveTvAccess', true) || flag(policy, 'EnableLiveTvManagement', true),
    metadataManagement:
      flag(policy, 'EnableCollectionManagement', false) ||
      flag(policy, 'EnableSubtitleManagement', false) ||
      flag(policy, 'EnableLyricManagement', false),
    publicSharing: flag(policy, 'EnablePublicSharing', true),
    channels: flag(policy, 'EnableAllChannels', true) || list(policy, 'EnabledChannels').length > 0,
    syncPlay: syncPlayOf(policy.SyncPlayAccess),
  };
}

/**
 * A copy of `policy` with the managed fields set from `state`; every other key kept as it is,
 * also keys this code does not know (fields of newer Jellyfin versions). Never touches
 * IsDisabled, InvalidLoginAttemptCount, BlockedMediaFolders or the provider ids.
 */
export function applyPolicyState(
  policy: Record<string, unknown>,
  state: MediaPolicyState,
): Record<string, unknown> {
  return {
    ...policy,
    IsAdministrator: state.administrator,
    IsHidden: state.hidden,
    EnableRemoteAccess: state.remoteAccess,
    EnableAllFolders: state.allLibraries,
    EnabledFolders: libraryIdsOf(state.libraryIds),
    MaxActiveSessions: state.maxSessions,
    EnableContentDownloading: state.downloads,
    EnableSyncTranscoding: state.conversion,
    EnableMediaConversion: state.conversion,
    RemoteClientBitrateLimit: state.remoteBitrateBps,
    EnableContentDeletion: state.contentDeletion,
    ...(state.contentDeletion ? {} : { EnableContentDeletionFromFolders: [] }),
    EnableRemoteControlOfOtherUsers: state.remoteControlOthers,
    EnableSharedDeviceControl: state.sharedDeviceControl,
    EnableLiveTvAccess: state.liveTv,
    EnableLiveTvManagement: state.liveTv,
    EnableCollectionManagement: state.metadataManagement,
    EnableSubtitleManagement: state.metadataManagement,
    EnableLyricManagement: state.metadataManagement,
    EnablePublicSharing: state.publicSharing,
    EnableAllChannels: state.channels,
    ...(state.channels ? {} : { EnabledChannels: [] }),
    SyncPlayAccess: state.syncPlay,
  };
}

// ---------------------------------------------------------------------------
// Users

/** A UserDto as RemoteMediaUser, or null without a valid Id or Name. Never reads Configuration. */
export function parseJellyfinUser(raw: unknown): RemoteMediaUser | null {
  if (!isObject(raw)) return null;
  const externalId = jellyfinId(raw.Id);
  const username = typeof raw.Name === 'string' && raw.Name.trim() ? raw.Name : null;
  if (!externalId || !username) return null;
  const policy = isObject(raw.Policy) ? raw.Policy : {};
  const limit = num(policy.LoginAttemptsBeforeLockout) ?? -1;
  const failed = num(policy.InvalidLoginAttemptCount) ?? 0;
  const disabled = policy.IsDisabled === true;
  return {
    externalId,
    username,
    enabled: !disabled,
    administrator: policy.IsAdministrator === true,
    hasPassword: raw.HasPassword === true,
    lockedOut: disabled && limit > 0 && failed >= limit,
    blockedFolders: Array.isArray(policy.BlockedMediaFolders) && policy.BlockedMediaFolders.length > 0,
    lastLoginAt: parseJellyfinDate(raw.LastLoginDate),
    lastActivityAt: parseJellyfinDate(raw.LastActivityDate),
    policy: parsePolicyState(policy),
  };
}

// ---------------------------------------------------------------------------
// Libraries, server, sessions

/** VirtualFolderInfo[] as libraries: only entries with an ItemId, sorted by name (de collation). */
export function parseLibraries(raw: unknown): MediaLibraryRef[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, MediaLibraryRef>();
  for (const entry of raw) {
    if (!isObject(entry)) continue;
    // A library added but not scanned yet has no ItemId and cannot be granted.
    const id = jellyfinId(entry.ItemId);
    const name = str(entry.Name);
    if (!id || !name) continue;
    const type = typeof entry.CollectionType === 'string' ? entry.CollectionType.toLowerCase() : '';
    byId.set(id, { id, name, type: isMediaLibraryType(type) ? type : null });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

export function parseServerInfo(raw: unknown): Omit<MediaServerInfo, 'quickConnect'> {
  const info = isObject(raw) ? raw : {};
  return {
    serverName: str(info.ServerName),
    version: str(info.Version),
    serverId: jellyfinId(info.Id),
    startupWizardCompleted:
      typeof info.StartupWizardCompleted === 'boolean' ? info.StartupWizardCompleted : null,
  };
}

/** SessionInfoDto[] reduced to counts. Reads only UserId and whether NowPlayingItem is there. */
export function parseActivity(raw: unknown): MediaActivity {
  let activeSessions = 0;
  let playing = 0;
  for (const session of Array.isArray(raw) ? raw : []) {
    if (!isObject(session) || !jellyfinId(session.UserId)) continue;
    activeSessions++;
    if (isObject(session.NowPlayingItem)) playing++;
  }
  return { activeSessions, playing };
}

/** "10.11.11" >= "10.10.0". Suffixes ("-rc1") are ignored; null and garbage are never enough. */
export function versionAtLeast(version: string | null, minimum: string): boolean {
  const parts = (v: string | null) => {
    const m = /^\s*v?(\d+(?:\.\d+)*)/.exec(v ?? '');
    return m ? m[1]!.split('.').map(Number) : null;
  };
  const have = parts(version);
  const need = parts(minimum);
  if (!have || !need) return false;
  for (let i = 0; i < Math.max(have.length, need.length); i++) {
    const a = have[i] ?? 0;
    const b = need[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Errors

/** The text ExceptionMiddleware answers outside development: the reason stays in the server log. */
export const JELLYFIN_OPAQUE_ERROR = 'Error processing request.';

/** First message of a ValidationProblemDetails "errors" object. */
function firstValidationError(errors: unknown): string | null {
  if (!isObject(errors)) return null;
  for (const messages of Object.values(errors)) {
    const first = Array.isArray(messages) ? messages.find((m) => typeof m === 'string' && m.trim()) : null;
    if (typeof first === 'string') return first.trim();
  }
  return null;
}

/** What the answer says, from the shapes Jellyfin uses (design 1.4); null when it says nothing usable. */
function answerMessage(body: unknown): string | null {
  if (isObject(body)) {
    const title = str(body.title);
    const detail = str(body.detail) ?? firstValidationError(body.errors);
    if (title && detail) return `${title.replace(/\.$/, '')}: ${detail}`.slice(0, 300);
    return (title ?? detail)?.slice(0, 300) ?? null;
  }
  if (typeof body === 'string') {
    const text = body.trim();
    if (!text || text === JELLYFIN_OPAQUE_ERROR || text.startsWith('<')) return null;
    return text.slice(0, 200);
  }
  return null;
}

function isEmptyBody(body: unknown): boolean {
  return body === null || body === undefined || (typeof body === 'string' && body.trim() === '');
}

/** "<action> failed: <message> (HTTP <status>)" plus what the operator can do about it. */
export function describeJellyfinError(res: { status: number; body: unknown }, action?: string): string {
  const { status, body } = res;
  const redirect = status >= 300 && status < 400;
  const message = answerMessage(body) ?? (redirect ? 'redirect' : 'refused without a reason');
  let hint: string | null = null;
  if (status === 401) hint = 'the API key was rejected: create a new one in Dashboard > API Keys';
  else if (status === 403 && isEmptyBody(body)) {
    hint =
      "the key is not allowed to do this, or remote access to the server is off for the console's address";
  } else if (redirect) hint = "the server redirects: check the base URL (https, Jellyfin's base URL path)";
  else if (status === 503) hint = 'the server is starting or under maintenance';
  else if (typeof body === 'string' && body.trim() === JELLYFIN_OPAQUE_ERROR) {
    hint = 'Jellyfin does not tell why (check the server log)';
  }
  const out = `${action ? `${action} failed: ` : ''}${message} (HTTP ${status})`;
  return hint ? `${out}. ${hint.charAt(0).toUpperCase()}${hint.slice(1)}` : out;
}

// ---------------------------------------------------------------------------
// Explorer

/** Keys whose values never leave an explorer answer: tokens, keys, passwords, PINs. */
export const SECRET_RESPONSE_KEY =
  /^(accesstoken|password|newpw|currentpw|currentpassword|pw|pin|apikey|api_key|token)$/i;

/** Explorer answers: values of secret keys blanked, recursively. */
export function redactJellyfin(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactJellyfin);
  if (!isObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] =
      SECRET_RESPONSE_KEY.test(key) && v !== null && v !== undefined && v !== ''
        ? '••••••'
        : redactJellyfin(v);
  }
  return out;
}
