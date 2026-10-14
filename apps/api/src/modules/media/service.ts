import { randomInt } from 'node:crypto';
import { and, count, eq, isNull, ne, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import {
  ALL_PERMISSIONS,
  MEDIA_ACCOUNT_ISSUES,
  MEDIA_CODE_CONSONANTS,
  MEDIA_CODE_VOWELS,
  MEDIA_GENERATED_CODE_LENGTH,
  MEDIA_GENERATED_PASSWORD_LENGTH,
  MEDIA_PASSWORD_ALPHABET,
  expectedMediaPolicy,
  mediaActivityDay,
  mediaPolicyDrift,
  type MediaAccess,
  type MediaAccountDto,
  type MediaAccountIssue,
  type MediaAccountLimitDetails,
  type MediaAllowanceConflictDetails,
  type MediaAllowanceDto,
  type MediaLoginDto,
  type MediaPolicyApplyResult,
  type MediaPolicyState,
  type ModuleKey,
  type Permission,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import { requireAuth, type Scope } from '../../auth/access';
import type { DbOrTx, Tx } from '../../db/client';
import {
  mediaAccounts,
  mediaAllowances,
  organizations,
  providerConnections,
  type MediaAccount,
  type MediaAllowance,
  type Organization,
  type ProviderConnection,
} from '../../db/schema';
import { AppError, conflict, notFound, unsupported } from '../../lib/errors';
import { mapLimit } from '../../providers/http';
import type { ProviderAdapter, RemoteMediaUser } from '../../providers/types';

/**
 * Streaming (module "media"): Jellyfin accounts inside an allowance.
 *
 * An organization's allowance lives on one Jellyfin instance and says how many accounts it may
 * have and what every account gets (libraries, streams, downloads, remote bitrate). The console
 * writes that access into each account's Jellyfin policy and the sync repairs drift. A
 * reseller's allowance also covers the allowances it hands to its customers on the same
 * instance. Every check runs under a per-organization advisory lock (see lockMediaOrg), so two
 * parallel requests can never overshoot an allowance.
 */

export const MEDIA_PERMISSIONS = ALL_PERMISSIONS.filter((p) => p.startsWith('media:'));
export const MEDIA_MODULE = 'media' as const satisfies ModuleKey;
/** Policy repairs per sync run and connection. */
export const MAX_REPAIRS_PER_RUN = 25;
/** Policy writes in parallel when an allowance changes (the adapter keeps 4 requests in flight). */
const POLICY_PARALLEL = 4;
/** How long the customer page waits for the (cached) server info of the login card. */
const LOGIN_INFO_TIMEOUT_MS = 5_000;
/** Attempts to find a free generated account code. */
const CODE_ATTEMPTS = 20;

/** Methods an adapter needs to manage streaming accounts at all. */
const MEDIA_METHODS = [
  'listMediaUsers',
  'getMediaUser',
  'createMediaUser',
  'setMediaUserPolicy',
  'setMediaUserEnabled',
  'setMediaUserPassword',
  'deleteMediaUser',
  'listMediaLibraries',
  'mediaLoginUrl',
] as const satisfies readonly (keyof ProviderAdapter)[];

export function supportsMedia(adapter: ProviderAdapter): boolean {
  return MEDIA_METHODS.every((m) => typeof adapter[m] === 'function');
}

/** 422 for providers without streaming (anything but Jellyfin and the flavorless demo). */
export function requireMediaSupport(adapter: ProviderAdapter): void {
  if (!supportsMedia(adapter)) throw unsupported('This provider does not support streaming accounts');
}

/** Accounts belong to their organization as a whole, like cloud accounts. Unassigned ones reach platform staff only. */
export function mediaScope(orgId: string | null): Scope {
  return { orgId, resource: { path: 'org' } };
}

export const noAllowance = (message = 'This organization has no streaming allowance') =>
  new AppError(409, 'no_allowance', message);
export const accountLimit = (message: string, details?: MediaAccountLimitDetails) =>
  new AppError(409, 'account_limit', message, details);
export const allowanceConflict = (message: string, details: MediaAllowanceConflictDetails) =>
  new AppError(409, 'allowance_conflict', message, details);

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

// --- Passwords and account codes -------------------------------------------------------

const pick = (chars: string) => chars[randomInt(chars.length)]!;

/**
 * A random password for a streaming account: MEDIA_GENERATED_PASSWORD_LENGTH characters of
 * lower-case letters and digits without look-alikes (about 80 bits), easy to type with a remote.
 * Shown once, never logged or stored.
 */
export function generateMediaPassword(): string {
  let password = '';
  while (password.length < MEDIA_GENERATED_PASSWORD_LENGTH) password += pick(MEDIA_PASSWORD_ALPHABET);
  return password;
}

/** Consonant, vowel, consonant, ...: e.g. "kemaro". */
function randomAccountCode(): string {
  let code = '';
  for (let i = 0; i < MEDIA_GENERATED_CODE_LENGTH; i++) {
    code += pick(i % 2 === 0 ? MEDIA_CODE_CONSONANTS : MEDIA_CODE_VOWELS);
  }
  return code;
}

/**
 * Whether a code is free: no other allowance has it and no managed account name ends with
 * "-<code>" (in any case). Codes are lower-case letters only, so they need no escaping in LIKE.
 */
export async function mediaAccountCodeFree(db: DbOrTx, code: string, exceptOrgId?: string): Promise<boolean> {
  const [allowance] = await db
    .select({ orgId: mediaAllowances.orgId })
    .from(mediaAllowances)
    .where(
      and(
        eq(mediaAllowances.accountCode, code),
        exceptOrgId ? ne(mediaAllowances.orgId, exceptOrgId) : undefined,
      ),
    )
    .limit(1);
  if (allowance) return false;
  const [account] = await db
    .select({ id: mediaAccounts.id })
    .from(mediaAccounts)
    .where(sql`lower(${mediaAccounts.username}) like ${`%-${code.toLowerCase()}`}`)
    .limit(1);
  return !account;
}

/**
 * A generated code nobody uses; 409 when CODE_ATTEMPTS random codes were all taken. `taken`:
 * name endings the instance has already (see remoteCodeSuffixes).
 */
export async function generateMediaAccountCode(
  db: DbOrTx,
  taken: ReadonlySet<string> = new Set(),
): Promise<string> {
  for (let i = 0; i < CODE_ATTEMPTS; i++) {
    const code = randomAccountCode();
    if (!taken.has(code) && (await mediaAccountCodeFree(db, code))) return code;
  }
  throw conflict('No free account code was found. Try again or choose a code.');
}

/**
 * What follows the last dash in the names of every user of the instance, managed or not, so a
 * new code never matches users created in Jellyfin directly. Best effort: empty when the list
 * cannot be read (mediaAccountCodeFree still checks the managed accounts, and Jellyfin refuses
 * a name that exists).
 */
export async function remoteCodeSuffixes(adapter: ProviderAdapter): Promise<Set<string>> {
  if (!adapter.listMediaUsers) return new Set();
  try {
    const names = (await adapter.listMediaUsers()).map((user) => user.username.toLowerCase());
    return new Set(names.filter((n) => n.includes('-')).map((n) => n.slice(n.lastIndexOf('-') + 1)));
  } catch {
    return new Set();
  }
}

// --- Allowances ---------------------------------------------------------------------------

/**
 * Serializes allowance checks and changes of one organization until the transaction ends.
 * The reseller (if any) is always locked first, so lock order is the same everywhere.
 */
export async function lockMediaOrg(tx: Tx, org: Pick<Organization, 'id' | 'parentOrgId'>): Promise<void> {
  for (const id of [org.parentOrgId, org.id]) {
    if (id) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`media:${id}`}, 0))`);
  }
}

export interface MediaCommitments {
  /** The organization's own accounts (all instances). */
  accounts: number;
  /** Customer allowances of a reseller on the instance, with their access. */
  customers: { orgId: string; name: string; maxAccounts: number; access: MediaAccess }[];
  customerAccounts: number;
}

export function mediaAccessOf(
  allowance: Pick<MediaAllowance, 'libraries' | 'maxStreams' | 'downloads' | 'remoteBitrateMbit'>,
): MediaAccess {
  return {
    libraryIds: allowance.libraries.map((l) => l.id),
    maxStreams: allowance.maxStreams,
    downloads: allowance.downloads,
    remoteBitrateMbit: allowance.remoteBitrateMbit,
  };
}

/** Same libraries (as a set), streams, downloads and bitrate. */
export function sameMediaAccess(a: MediaAccess, b: MediaAccess): boolean {
  const left = new Set(a.libraryIds.map((id) => id.toLowerCase()));
  const right = new Set(b.libraryIds.map((id) => id.toLowerCase()));
  return (
    left.size === right.size &&
    [...left].every((id) => right.has(id)) &&
    a.maxStreams === b.maxStreams &&
    a.downloads === b.downloads &&
    a.remoteBitrateMbit === b.remoteBitrateMbit
  );
}

/** What an organization has committed of its allowance. Call lockMediaOrg first when acting on it. */
export async function mediaCommitments(
  db: DbOrTx,
  org: Pick<Organization, 'id' | 'kind'>,
  providerId: string | null,
  excludeCustomerId?: string,
): Promise<MediaCommitments> {
  const [own] = await db.select({ n: count() }).from(mediaAccounts).where(eq(mediaAccounts.orgId, org.id));
  const result: MediaCommitments = { accounts: own?.n ?? 0, customers: [], customerAccounts: 0 };
  if (org.kind !== 'reseller' || !providerId) return result;
  const rows = await db
    .select({ allowance: mediaAllowances, name: organizations.name })
    .from(mediaAllowances)
    .innerJoin(organizations, eq(organizations.id, mediaAllowances.orgId))
    .where(
      and(
        eq(organizations.parentOrgId, org.id),
        eq(mediaAllowances.providerConnectionId, providerId),
        excludeCustomerId ? ne(mediaAllowances.orgId, excludeCustomerId) : undefined,
      ),
    )
    .orderBy(organizations.name);
  result.customers = rows.map(({ allowance, name }) => ({
    orgId: allowance.orgId,
    name,
    maxAccounts: allowance.maxAccounts,
    access: mediaAccessOf(allowance),
  }));
  result.customerAccounts = result.customers.reduce((sum, c) => sum + c.maxAccounts, 0);
  return result;
}

/** Accounts counted against maxAccounts: own ones plus, for resellers, the customers' maximums. */
export const committedMediaAccounts = (c: MediaCommitments) => c.accounts + c.customerAccounts;

export async function loadMediaAllowance(
  db: DbOrTx,
  orgId: string,
): Promise<{ allowance: MediaAllowance; connection: ProviderConnection } | null> {
  const [row] = await db
    .select({ allowance: mediaAllowances, connection: providerConnections })
    .from(mediaAllowances)
    .innerJoin(providerConnections, eq(providerConnections.id, mediaAllowances.providerConnectionId))
    .where(eq(mediaAllowances.orgId, orgId))
    .limit(1);
  return row ?? null;
}

/** For a reseller, accounts include its customers' maximums: maxAccounts - accounts is what is left. */
export async function toMediaAllowanceDto(
  ctx: AppContext,
  org: Pick<Organization, 'id' | 'kind'>,
  allowance: MediaAllowance,
  connection: ProviderConnection,
): Promise<MediaAllowanceDto> {
  const usage = await mediaCommitments(ctx.db, org, connection.id);
  return {
    orgId: allowance.orgId,
    provider: {
      id: connection.id,
      type: connection.type,
      name: connection.name,
      url: ctx.providers.forConnection(connection).mediaLoginUrl?.() ?? null,
    },
    accountCode: allowance.accountCode,
    maxAccounts: allowance.maxAccounts,
    libraries: allowance.libraries,
    maxStreams: allowance.maxStreams,
    downloads: allowance.downloads,
    remoteBitrateMbit: allowance.remoteBitrateMbit,
    accounts: committedMediaAccounts(usage),
    customers: usage.customers.length,
    customerAccounts: usage.customerAccounts,
    updatedAt: allowance.updatedAt.toISOString(),
  };
}

export async function mediaAllowanceDto(
  ctx: AppContext,
  org: Organization,
): Promise<MediaAllowanceDto | null> {
  const loaded = await loadMediaAllowance(ctx.db, org.id);
  return loaded ? toMediaAllowanceDto(ctx, org, loaded.allowance, loaded.connection) : null;
}

/** Resolves with null when `promise` fails or takes longer than `ms`. */
export function settleWithin<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise.catch(() => null), timeout]).finally(() => clearTimeout(timer));
}

/** Login card: url from mediaLoginUrl(), server name and Quick Connect from the cached server info (errors: null). */
export async function mediaLoginDto(
  ctx: AppContext,
  allowance: MediaAllowance,
  connection: ProviderConnection,
): Promise<MediaLoginDto> {
  const adapter = ctx.providers.forConnection(connection);
  const info = adapter.mediaServerInfo
    ? await settleWithin(adapter.mediaServerInfo(), LOGIN_INFO_TIMEOUT_MS)
    : null;
  return {
    url: adapter.mediaLoginUrl?.() ?? '',
    serverName: info?.serverName ?? null,
    quickConnect: info?.quickConnect ?? null,
    accountCode: allowance.accountCode,
  };
}

// --- Accounts -----------------------------------------------------------------------------

export interface MediaAccountRow {
  account: MediaAccount;
  org: Organization | null;
  connection: ProviderConnection;
}

export interface LoadedMediaAccount extends MediaAccountRow {
  scope: Scope;
  adapter: ProviderAdapter;
}

export function mediaAccountRowsQuery(ctx: AppContext) {
  return ctx.db
    .select({ account: mediaAccounts, org: organizations, connection: providerConnections })
    .from(mediaAccounts)
    .innerJoin(providerConnections, eq(providerConnections.id, mediaAccounts.providerConnectionId))
    .leftJoin(organizations, eq(organizations.id, mediaAccounts.orgId));
}

export async function mediaAccountRow(ctx: AppContext, id: string): Promise<MediaAccountRow | null> {
  const [row] = await mediaAccountRowsQuery(ctx).where(eq(mediaAccounts.id, id)).limit(1);
  return row ?? null;
}

/** 404 unless the caller has media:read on the account's organization. */
export async function loadMediaAccount(
  ctx: AppContext,
  req: FastifyRequest,
  id: string,
): Promise<LoadedMediaAccount> {
  requireAuth(req);
  const row = await mediaAccountRow(ctx, id);
  if (!row) throw notFound('Streaming account');
  const scope = mediaScope(row.account.orgId);
  if (!(await ctx.access.can(req, 'media:read', scope))) throw notFound('Streaming account');
  return { ...row, scope, adapter: ctx.providers.forConnection(row.connection) };
}

/** Never the time of the last activity, only its calendar day (Europe/Zurich). */
export async function toMediaAccountDto(
  ctx: AppContext,
  req: FastifyRequest,
  row: MediaAccountRow,
): Promise<MediaAccountDto> {
  const { account, org, connection } = row;
  const permissions: Permission[] = await ctx.access.allowed(
    req,
    MEDIA_PERMISSIONS,
    mediaScope(account.orgId),
  );
  return {
    id: account.id,
    username: account.username,
    enabled: account.enabled,
    hasPassword: account.hasPassword,
    lastActiveOn: mediaActivityDay(account.lastActivityAt?.toISOString()),
    issues: account.issues,
    provider: { id: connection.id, type: connection.type, name: connection.name },
    location: connection.location,
    org: org ? { id: org.id, name: org.name, slug: org.slug } : null,
    loginUrl: ctx.providers.forConnection(connection).mediaLoginUrl?.() ?? null,
    permissions,
    lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null,
    missingSince: account.missingSince?.toISOString() ?? null,
    createdAt: account.createdAt.toISOString(),
  };
}

/** In MEDIA_ACCOUNT_ISSUES order, without duplicates. */
export function sortMediaIssues(issues: Iterable<MediaAccountIssue>): MediaAccountIssue[] {
  const found = new Set(issues);
  return MEDIA_ACCOUNT_ISSUES.filter((issue) => found.has(issue));
}

/** Issues of a user against the policy it should have (null: unassigned or no allowance here). */
export function mediaAccountIssues(
  remote: RemoteMediaUser,
  expected: MediaPolicyState | null,
  assigned: boolean,
): MediaAccountIssue[] {
  const issues: MediaAccountIssue[] = [];
  if (remote.administrator) issues.push('administrator');
  if (expected && mediaPolicyDrift(remote.policy, expected).length > 0) issues.push('policy');
  if (assigned && !expected) issues.push('no_allowance');
  if (remote.blockedFolders) issues.push('blocked_folders');
  if (!remote.hasPassword) issues.push('no_password');
  if (remote.lockedOut) issues.push('locked_out');
  return sortMediaIssues(issues);
}

/** Row values from a Jellyfin user as the instance reports it. */
export function remoteMediaFields(remote: RemoteMediaUser, issues: MediaAccountIssue[], now: Date) {
  return {
    username: remote.username,
    enabled: remote.enabled,
    hasPassword: remote.hasPassword,
    lastActivityAt: remote.lastActivityAt ? new Date(remote.lastActivityAt) : null,
    issues,
    lastSyncedAt: now,
    missingSince: null,
  };
}

/** The policy an account of `orgId` on `connectionId` should have; null when its organization has no allowance there. */
export async function expectedPolicyFor(
  db: DbOrTx,
  orgId: string | null,
  connectionId: string,
): Promise<MediaPolicyState | null> {
  if (!orgId) return null;
  const allowance = await db.query.mediaAllowances.findFirst({ where: eq(mediaAllowances.orgId, orgId) });
  if (!allowance || allowance.providerConnectionId !== connectionId) return null;
  return expectedMediaPolicy(mediaAccessOf(allowance));
}

/**
 * Writes the allowance's policy to every non-missing account of the organization on the
 * allowance's instance, POLICY_PARALLEL at a time, updating each row's issues. Never throws:
 * the allowance is stored already, a failed write is listed and the sync retries it.
 */
export async function applyMediaPolicy(
  ctx: AppContext,
  orgId: string,
  allowance: MediaAllowance,
  connection: ProviderConnection,
): Promise<MediaPolicyApplyResult> {
  const result: MediaPolicyApplyResult = { applied: 0, failed: [] };
  const adapter = ctx.providers.forConnection(connection);
  if (!adapter.setMediaUserPolicy) return result;
  const expected = expectedMediaPolicy(mediaAccessOf(allowance));
  let rows: Pick<MediaAccount, 'id' | 'externalId' | 'username' | 'issues'>[];
  try {
    rows = await ctx.db
      .select({
        id: mediaAccounts.id,
        externalId: mediaAccounts.externalId,
        username: mediaAccounts.username,
        issues: mediaAccounts.issues,
      })
      .from(mediaAccounts)
      .where(
        and(
          eq(mediaAccounts.orgId, orgId),
          eq(mediaAccounts.providerConnectionId, connection.id),
          isNull(mediaAccounts.missingSince),
        ),
      )
      .orderBy(mediaAccounts.username);
  } catch (err) {
    ctx.log.error({ err, orgId }, 'streaming policy apply: accounts could not be read');
    return result;
  }
  await mapLimit(rows, POLICY_PARALLEL, async (row) => {
    try {
      const remote = await adapter.setMediaUserPolicy!(row.externalId, expected);
      result.applied++;
      await ctx.db
        .update(mediaAccounts)
        .set(remoteMediaFields(remote, mediaAccountIssues(remote, expected, true), new Date()))
        .where(eq(mediaAccounts.id, row.id))
        .catch((err: unknown) => ctx.log.warn({ err, accountId: row.id }, 'streaming account update failed'));
    } catch (err) {
      result.failed.push({ accountId: row.id, username: row.username, error: errorMessage(err) });
      await ctx.db
        .update(mediaAccounts)
        .set({ issues: sortMediaIssues([...row.issues, 'policy']) })
        .where(eq(mediaAccounts.id, row.id))
        .catch((e: unknown) =>
          ctx.log.warn({ err: e, accountId: row.id }, 'streaming account update failed'),
        );
    }
  });
  result.failed.sort((a, b) => a.username.localeCompare(b.username));
  return result;
}
