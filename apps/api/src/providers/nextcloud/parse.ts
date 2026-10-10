import { CLOUD_MIN_QUOTA_BYTES, CLOUD_QUOTA_TB_STEP_GB, isExactCloudQuotaGb } from '@weblion/shared';
import { badRequest } from '../../lib/errors';
import { isRecord, num, str } from '../http';
import type { RemoteCloudAccount } from '../types';

/** Prefix of the per-organization groups when the connection sets none. */
export const DEFAULT_GROUP_PREFIX = 'weblion-';

/** Nextcloud's IUser::MAX_USERID_LENGTH. */
const MAX_USER_ID_LENGTH = 64;
/** Characters Nextcloud allows in a login name (OC\User\Manager::validateUserId). */
const USER_ID_CHARS = /^[a-zA-Z0-9 _.@\-']+$/;
/** Group ids the panel creates or joins: the prefix plus an org slug. Kept to safe characters. */
const GROUP_ID = /^[a-zA-Z0-9_.@-][a-zA-Z0-9 _.@-]{0,63}$/;
/** Nextcloud stores display names of up to 64 characters. */
export const MAX_DISPLAY_NAME_LENGTH = 64;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface OcsMeta {
  status: string | null;
  statuscode: number | null;
  message: string | null;
}

export interface OcsEnvelope {
  meta: OcsMeta;
  data: unknown;
}

/** The {ocs: {meta, data}} envelope of an OCS answer, or null for anything else (HTML, proxies). */
export function parseEnvelope(body: unknown): OcsEnvelope | null {
  if (!isRecord(body) || !isRecord(body.ocs)) return null;
  const meta = isRecord(body.ocs.meta) ? body.ocs.meta : {};
  return {
    meta: { status: str(meta.status), statuscode: num(meta.statuscode), message: str(meta.message) },
    data: body.ocs.data ?? null,
  };
}

/** v1 answers "ok"/100, v2 "ok"/200. Both carry status "ok" on success. */
export function isOcsSuccess(meta: OcsMeta): boolean {
  if (meta.status) return meta.status.toLowerCase() === 'ok';
  return meta.statuscode === 100 || meta.statuscode === 200;
}

/** Whether Nextcloud accepts the string as a login name. */
export function isValidUserId(id: string): boolean {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= MAX_USER_ID_LENGTH &&
    USER_ID_CHARS.test(id) &&
    id.trim() === id &&
    id !== '.' &&
    id !== '..'
  );
}

/** Refuses login names Nextcloud would reject, before anything is sent. */
export function assertUserId(id: string): string {
  if (!isValidUserId(id)) {
    throw badRequest(
      `Invalid Nextcloud login name "${String(id).slice(0, 80)}": at most ${MAX_USER_ID_LENGTH} characters ` +
        `of a-z, A-Z, 0-9, space and _.@-' without leading or trailing spaces`,
    );
  }
  return id;
}

export function assertGroupId(id: string): string {
  if (typeof id !== 'string' || !GROUP_ID.test(id) || id.trim() !== id) {
    throw badRequest(`Invalid Nextcloud group "${String(id).slice(0, 80)}"`);
  }
  return id;
}

/**
 * Quotas are whole GB (CLOUD_MIN_QUOTA_BYTES each) that Nextcloud stores exactly: from 1024 GB
 * on only multiples of 512 GB, as it rounds everything else to 0.1 TB (see isExactCloudQuotaGb).
 * A rounded quota would differ from what the allowance counts.
 */
export function assertQuota(bytes: number): number {
  if (
    !Number.isSafeInteger(bytes) ||
    bytes % CLOUD_MIN_QUOTA_BYTES !== 0 ||
    !isExactCloudQuotaGb(bytes / CLOUD_MIN_QUOTA_BYTES)
  ) {
    throw badRequest(
      `The quota must be whole GB (${CLOUD_MIN_QUOTA_BYTES} bytes each), at least 1 GB, from 1024 GB on ` +
        `a multiple of ${CLOUD_QUOTA_TB_STEP_GB} GB: Nextcloud rounds other quotas`,
    );
  }
  return bytes;
}

/** Empty clears the address. */
export function assertEmail(email: string | null | undefined): string {
  const value = (email ?? '').trim().toLowerCase();
  if (value && (!EMAIL.test(value) || value.length > 254))
    throw badRequest(`Invalid e-mail address "${value}"`);
  return value;
}

export function assertDisplayName(name: string | null | undefined): string | null {
  const value = (name ?? '').trim();
  if (value.length > MAX_DISPLAY_NAME_LENGTH) {
    throw badRequest(`The display name may have at most ${MAX_DISPLAY_NAME_LENGTH} characters`);
  }
  return value || null;
}

/**
 * Nextcloud language codes are "de", "de_DE", "pt_BR". A BCP 47 tag with a region ("de-CH")
 * is reduced to its language: Nextcloud fails the whole user creation on unknown codes.
 */
export function nextcloudLanguage(language: string | null | undefined): string | null {
  const value = (language ?? '').trim();
  if (/^[a-z]{2,3}$/i.test(value)) return value.toLowerCase();
  if (/^[a-z]{2,3}_[A-Z]{2}$/.test(value)) return value;
  const primary = /^([a-z]{2,3})-/i.exec(value);
  return primary ? primary[1]!.toLowerCase() : null;
}

const UNITS: Record<string, number> = {
  b: 1,
  k: 1024,
  kb: 1024,
  m: 1024 ** 2,
  mb: 1024 ** 2,
  g: 1024 ** 3,
  gb: 1024 ** 3,
  t: 1024 ** 4,
  tb: 1024 ** 4,
  p: 1024 ** 5,
  pb: 1024 ** 5,
};

/** Nextcloud's human readable sizes ("5 GB", "512 MB", "1.5 TB"), like Util::computerFileSize. */
export function parseHumanSize(value: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i.exec(value);
  if (!match) return null;
  const factor = UNITS[(match[2] ?? '').toLowerCase() || 'b'];
  if (factor === undefined) return null;
  return Math.round(Number(match[1]) * factor);
}

/**
 * A quota in bytes. Nextcloud reports unlimited as a negative number (FileInfo::SPACE_UNLIMITED
 * = -3) or "none" for users without a home yet; both, and anything unreadable, become null.
 */
export function parseQuota(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (!text || text === 'none' || text === 'default') return null;
  const n = num(text);
  if (n !== null) return n >= 0 ? Math.round(n) : null;
  return parseHumanSize(text);
}

function parseUsed(value: unknown): number | null {
  const n = num(value);
  return n !== null && n >= 0 ? Math.round(n) : null;
}

function parseBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false' || value === '') return false;
  return fallback;
}

/** PHP lists come as JSON arrays, but as objects once their keys are not 0..n. */
function listOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return isRecord(value) ? Object.values(value) : [];
}

/** lastLogin is in milliseconds, 0 for users who never logged in. */
function parseLastLogin(data: Record<string, unknown>): string | null {
  const ms = num(data.lastLogin) ?? (num(data.lastLoginTimestamp) ?? 0) * 1000;
  if (!ms || ms <= 0) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** One user of GET /cloud/users/{id} or of the users/details map. `fallbackId` is the map key. */
export function parseCloudUser(data: unknown, fallbackId?: string): RemoteCloudAccount | null {
  if (!isRecord(data)) return null;
  const externalId = str(data.id) ?? fallbackId ?? null;
  if (!externalId) return null;
  // Current versions report {quota, used, free, total, relative}; old ones a bare quota value.
  // An empty quota object means Nextcloud could not read the storage of this user.
  const quota = isRecord(data.quota) ? data.quota : null;
  return {
    externalId,
    displayName: str(data.displayname) ?? str(data['display-name']),
    email: str(data.email),
    quotaBytes: quota ? parseQuota(quota.quota) : parseQuota(data.quota),
    usedBytes: quota ? parseUsed(quota.used) : null,
    enabled: parseBool(data.enabled, true),
    lastLoginAt: parseLastLogin(data),
    groups: listOf(data.groups)
      .map((g) => str(g))
      .filter((g): g is string => g !== null),
  };
}

/**
 * A page of GET /cloud/users/details: {users: {<id>: details}}. `count` is the number of
 * entries Nextcloud returned, so the caller knows whether another page follows.
 */
export function parseUsersDetails(data: unknown): { users: RemoteCloudAccount[]; count: number } {
  const raw = isRecord(data) ? data.users : null;
  const entries: [string | undefined, unknown][] = Array.isArray(raw)
    ? raw.map((v) => [undefined, v])
    : isRecord(raw)
      ? Object.entries(raw)
      : [];
  const users: RemoteCloudAccount[] = [];
  for (const [key, value] of entries) {
    const user = parseCloudUser(value, key);
    if (user) users.push(user);
  }
  return { users, count: entries.length };
}

/** A string list of {users: [...]} or {groups: [...]}. */
export function parseIdList(data: unknown, key: 'users' | 'groups'): string[] {
  const raw = isRecord(data) ? data[key] : null;
  return listOf(raw)
    .map((v) => str(v))
    .filter((v): v is string => v !== null);
}

export interface NextcloudVersion {
  string: string | null;
  edition: string | null;
}

/** GET /cloud/capabilities: data.version.string, e.g. "31.0.4". */
export function parseVersion(data: unknown): NextcloudVersion {
  const version = isRecord(data) && isRecord(data.version) ? data.version : null;
  const parts = version ? [num(version.major), num(version.minor), num(version.micro)] : [];
  const joined = parts.every((p) => p !== null) && parts.length === 3 ? parts.join('.') : null;
  return { string: str(version?.string) ?? joined, edition: str(version?.edition) };
}

/** Blanks out every value whose key looks like a password, token or secret. */
export function redactPasswords<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactPasswords) as T;
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] =
      /passw(or)?d|secret|token/i.test(key) && v !== null && v !== '' ? '••••••' : redactPasswords(v);
  }
  return out as T;
}
