import { and, asc, count, eq, inArray, isNotNull, isNull, max, or, sql } from 'drizzle-orm';
import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import {
  mediaRequestsExceed,
  normalizeMediaRequests,
  sameMediaRequests,
  type MediaAccountDto,
  type MediaAccountRequestsView,
  type MediaAllowanceChangeResult,
  type MediaAllowanceConflictDetails,
  type MediaAllowanceDto,
  type MediaPolicyApplyResult,
  type MediaRequestTotals,
  type MediaRequestsAccess,
  type MediaRequestsInfoDto,
  type MediaSeerrCheck,
  type MediaSeerrDto,
  type MediaSeerrProblem,
  type MediaSeerrStatus,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import type { Database, DbOrTx } from '../../db/client';
import {
  mediaAccounts,
  mediaAllowances,
  mediaSeerr,
  organizations,
  providerConnections,
  type MediaAccount,
  type MediaAllowance,
  type MediaSeerrRow,
  type Organization,
  type ProviderConnection,
} from '../../db/schema';
import { AppError, notFound } from '../../lib/errors';
import { mapLimit } from '../../providers/http';
import {
  SEERR_OWNER_ID,
  SEERR_PERMISSION,
  SEERR_REQUEST_BITS,
  SEERR_STAFF_BITS,
  seerrAccessDrift,
  seerrOwnerRefused,
  type SeerrAccessDriftField,
} from '../../providers/seerr/rules';
import type {
  ProviderAdapter,
  RemoteSeerrUser,
  SeerrCheckResult,
  SeerrUserAccess,
} from '../../providers/types';
import {
  allowanceConflict,
  bestEffort,
  errorMessage,
  loadMediaAllowance,
  lockMediaOrg,
  mediaCommitments,
  mediaRequestsColumns,
  mediaRequestsOf,
  noAllowance,
  replaceSeerrIssues,
  toMediaAccountDto,
  toMediaAllowanceDto,
  type MediaAccountRow,
  type SeerrIssue,
} from './service';

/**
 * Requests add-on (Seerr) of the streaming module: the state of a connection's Seerr, the
 * expected Seerr access of an account and the best-effort steps that bring Seerr there.
 *
 * Seerr is optional per Jellyfin instance: configured (address and key in the connection's
 * config), switched on by staff (media_seerr.enabled), active when both. An organization's
 * allowance says whether its accounts may request (the add-on). Every Seerr step runs after the
 * Jellyfin step succeeded and never fails it: a failure is recorded as an issue of the account
 * (seerr_missing, seerr_drift) and the sync retries. Customers and resellers see numbers only;
 * titles, TMDB ids and Seerr's own data never leave the adapter.
 */

export { mediaRequestsColumns, mediaRequestsOf };

/** Seerr writes in parallel when a whole organization or instance changes. */
const SEERR_PARALLEL = 4;
/** Rounds of one account's step when the account or its allowance changed during the Seerr calls. */
const RECONCILE_ATTEMPTS = 3;
/** Budget of the Seerr step after an account action (the Jellyfin step is done already). */
export const SEERR_STEP_MS = 10_000;

const NO_RIGHTS: SeerrUserAccess = {
  permissions: 0,
  movieQuotaLimit: 0,
  movieQuotaDays: 0,
  tvQuotaLimit: 0,
  tvQuotaDays: 0,
};

// --- Errors ------------------------------------------------------------------------------

export const requestsUnavailable = () =>
  new AppError(
    409,
    'requests_unavailable',
    'No Seerr is set up for this instance: requests cannot be offered here',
  );
export const seerrNotConfigured = () =>
  new AppError(
    409,
    'seerr_not_configured',
    'No Seerr is set up for this instance. Enter its address and API key at the provider first.',
  );
export const seerrUnsafe = (problems: MediaSeerrProblem[]) =>
  new AppError(409, 'seerr_unsafe', `Seerr is not ready for customers yet (${problems.join(', ')})`, {
    problems,
  });
export const seerrShared = (organizations: number) =>
  new AppError(
    409,
    'seerr_shared',
    `${organizations} organizations have an allowance on this instance: in Seerr their accounts see each other's login names and requests. Confirm to switch requests on anyway.`,
    { organizations },
  );

// --- State -------------------------------------------------------------------------------

/** Seerr of a connection: configured (URL and key), enabled (media_seerr), active (both). */
export interface SeerrState {
  configured: boolean;
  enabled: boolean;
  active: boolean;
  row: MediaSeerrRow | null;
  adapter: ProviderAdapter;
}

export async function seerrState(
  ctx: AppContext,
  connection: ProviderConnection,
  db: DbOrTx = ctx.db,
): Promise<SeerrState> {
  const adapter = ctx.providers.forConnection(connection);
  const configured = adapter.seerrConfigured?.() ?? false;
  const [row] = await db
    .select()
    .from(mediaSeerr)
    .where(eq(mediaSeerr.providerConnectionId, connection.id))
    .limit(1);
  const enabled = row?.enabled ?? false;
  return { configured, enabled, active: configured && enabled, row: row ?? null, adapter };
}

/**
 * Section 16.2: REQUEST_MOVIE and/or REQUEST_TV with the quotas (0 = no limit, written
 * explicitly so Seerr's default quotas never apply) for an enabled, present account whose
 * organization has the add-on on this instance; otherwise no rights (the quotas are then not
 * written, the zeros only fill the type).
 */
export function expectedSeerrAccess(input: {
  enabled: boolean;
  missing: boolean;
  /** The organization's add-on on this instance; null when off, unassigned or another instance. */
  requests: MediaRequestsAccess | null;
}): SeerrUserAccess {
  const requests = input.enabled && !input.missing ? input.requests : null;
  if (!requests || (!requests.movies && !requests.tv)) return { ...NO_RIGHTS };
  const movieQuota = requests.movies ? requests.movieQuota : null;
  const tvQuota = requests.tv ? requests.tvQuota : null;
  return {
    permissions:
      (requests.movies ? SEERR_PERMISSION.REQUEST_MOVIE : 0) |
      (requests.tv ? SEERR_PERMISSION.REQUEST_TV : 0),
    movieQuotaLimit: movieQuota?.limit ?? 0,
    movieQuotaDays: movieQuota?.days ?? 0,
    tvQuotaLimit: tvQuota?.limit ?? 0,
    tvQuotaDays: tvQuota?.days ?? 0,
  };
}

/** Fields that differ (defined with the Seerr rules, so the adapter checks its writes the same way). */
export { seerrAccessDrift, type SeerrAccessDriftField } from '../../providers/seerr/rules';

const sameSeerrAccess = (a: SeerrUserAccess, b: SeerrUserAccess) =>
  a.permissions === b.permissions &&
  a.movieQuotaLimit === b.movieQuotaLimit &&
  a.movieQuotaDays === b.movieQuotaDays &&
  a.tvQuotaLimit === b.tvQuotaLimit &&
  a.tvQuotaDays === b.tvQuotaDays;

/** Outcome of a best-effort Seerr step, recorded in the main action's audit entry. */
export type SeerrOutcome = 'ok' | 'skipped' | { error: string };

/**
 * Visibility rules of 16.4: Seerr active on the allowance's instance (the state must be of that
 * connection; active implies a row) and the add-on on.
 */
export function requestsVisibleToCustomer(state: SeerrState, allowance: MediaAllowance | null): boolean {
  return (
    state.active &&
    !!allowance &&
    state.row?.providerConnectionId === allowance.providerConnectionId &&
    mediaRequestsOf(allowance) !== null
  );
}

/**
 * Problems that make Seerr unusable for the console (status "error"); the others are settings
 * staff or the recommended settings fix (status "unsafe").
 */
const UNUSABLE: readonly MediaSeerrProblem[] = ['unreachable', 'key', 'not_jellyfin', 'other_server'];

export function seerrStatusOf(problems: readonly MediaSeerrProblem[]): MediaSeerrStatus {
  if (problems.length === 0) return 'ok';
  return problems.some((p) => UNUSABLE.includes(p)) ? 'error' : 'unsafe';
}

/** The three settings "Empfohlene Einstellungen" changes, as audited. */
export const seerrSettingsOf = (check: SeerrCheckResult) => ({
  newSignIns: check.newSignIns,
  defaultPermissions: check.defaultPermissions,
  mediaServerLogin: check.mediaServerLogin,
});

/**
 * A Seerr user with request rights the console does not manage: not the owner, no staff rights,
 * not linked to an account of the connection (the sync brings those to their expected rights).
 */
export function isUnmanagedRequester(
  user: RemoteSeerrUser,
  managedJellyfinIds: ReadonlySet<string>,
): boolean {
  return (
    (user.permissions & SEERR_REQUEST_BITS) !== 0 &&
    user.id !== SEERR_OWNER_ID &&
    (user.permissions & SEERR_STAFF_BITS) === 0 &&
    !(user.jellyfinUserId && managedJellyfinIds.has(user.jellyfinUserId))
  );
}

/**
 * Stands in for a Seerr user whose rights were not read again (taking back a grant this call
 * wrote to the user it imported or confirmed): any rights, so the adapter writes the permissions
 * first (design 19.4 step 1); quotas are not touched for a revocation.
 */
const rightsUnknown = (id: number, jellyfinUserId: string): RemoteSeerrUser => ({
  id,
  jellyfinUserId,
  permissions: SEERR_REQUEST_BITS | SEERR_STAFF_BITS,
  movieQuotaLimit: null,
  movieQuotaDays: null,
  tvQuotaLimit: null,
  tvQuotaDays: null,
});

const gone = (err: unknown) => err instanceof AppError && err.statusCode === 404;

/** The Seerr user of a Jellyfin user in Seerr's list: the lowest id should Seerr have two (like the sync). */
export function seerrUserByJellyfinId(
  users: readonly RemoteSeerrUser[],
  jellyfinUserId: string,
): RemoteSeerrUser | null {
  let found: RemoteSeerrUser | null = null;
  for (const user of users) {
    if (user.jellyfinUserId === jellyfinUserId && (!found || user.id < found.id)) found = user;
  }
  return found;
}

/** The account's Seerr user behind its stored id, and whether that id has to be replaced. */
interface ConfirmedSeerrUser {
  /** The Seerr user with the account's Jellyfin id; null when Seerr has none. */
  user: RemoteSeerrUser | null;
  /** The stored id belongs to another Jellyfin user or to nobody: store `user?.id ?? null` instead. */
  stale: boolean;
}

/**
 * Confirms a stored Seerr id before anything is written to it: the Seerr user with that id must
 * have the account's Jellyfin id, from `users` when the caller has Seerr's list, otherwise read
 * alone. Stored ids of another Seerr (the address changed) or of a deleted user would otherwise
 * reach someone else, even Seerr staff. A stale id is never written to: the account's user is
 * looked up by its Jellyfin id instead (in the list, which is read only then). Throws for Seerr
 * failures, a 404 of the one user excepted.
 */
async function confirmSeerrUser(
  adapter: ProviderAdapter,
  seerrUserId: number,
  jellyfinUserId: string,
  users?: readonly RemoteSeerrUser[],
): Promise<ConfirmedSeerrUser> {
  let user: RemoteSeerrUser | null;
  if (users) {
    user = users.find((u) => u.id === seerrUserId) ?? null;
  } else {
    try {
      user = await adapter.getSeerrUser!(seerrUserId);
    } catch (err) {
      if (!gone(err)) throw err;
      user = null;
    }
  }
  if (user && user.jellyfinUserId === jellyfinUserId) return { user, stale: false };
  const list = users ?? (await adapter.listSeerrUsers!());
  return { user: seerrUserByJellyfinId(list, jellyfinUserId), stale: true };
}

/**
 * A Seerr user found by its Jellyfin id only (no confirmed stored id) whose request rights a
 * switch-off takes: not the owner, no Seerr staff (they were not set up by the console), and
 * with a request right at all.
 */
const revocableByJellyfinId = (user: RemoteSeerrUser) =>
  user.id !== SEERR_OWNER_ID &&
  (user.permissions & SEERR_REQUEST_BITS) !== 0 &&
  (user.permissions & SEERR_STAFF_BITS) === 0;

/** Seerr writes as audited: never more than the names of the accounts that failed. */
export const seerrApplyDetails = (result: MediaPolicyApplyResult) => ({
  applied: result.applied,
  failed: result.failed.map((f) => f.username),
});

// --- One account ---------------------------------------------------------------------------

/** What the steps need besides the database: the adapter of a connection and a logger. */
export interface SeerrEnv {
  db: Database;
  adapterFor: (connection: ProviderConnection) => ProviderAdapter;
  log: Pick<FastifyBaseLogger, 'warn'>;
}

const envOf = (ctx: AppContext): SeerrEnv => ({
  db: ctx.db,
  adapterFor: (connection) => ctx.providers.forConnection(connection),
  log: ctx.log,
});

/** For the sync: one connection's adapter. */
export const seerrSyncEnv = (
  db: Database,
  adapter: ProviderAdapter,
  log: Pick<FastifyBaseLogger, 'warn'> | undefined,
): SeerrEnv => ({ db, adapterFor: () => adapter, log: log ?? { warn: () => undefined } });

interface AccountPlan {
  account: MediaAccount;
  connection: ProviderConnection;
  adapter: ProviderAdapter;
  active: boolean;
  /** The organization's add-on on the account's instance (null: off, unassigned, another instance). */
  requests: MediaRequestsAccess | null;
  expected: SeerrUserAccess;
}

async function loadPlan(env: SeerrEnv, db: DbOrTx, accountId: string): Promise<AccountPlan | null> {
  const [row] = await db
    .select({
      account: mediaAccounts,
      connection: providerConnections,
      allowance: mediaAllowances,
      enabled: mediaSeerr.enabled,
    })
    .from(mediaAccounts)
    .innerJoin(providerConnections, eq(providerConnections.id, mediaAccounts.providerConnectionId))
    .leftJoin(mediaAllowances, eq(mediaAllowances.orgId, mediaAccounts.orgId))
    .leftJoin(mediaSeerr, eq(mediaSeerr.providerConnectionId, mediaAccounts.providerConnectionId))
    .where(eq(mediaAccounts.id, accountId))
    .limit(1);
  if (!row) return null;
  const adapter = env.adapterFor(row.connection);
  const active = (adapter.seerrConfigured?.() ?? false) && !!row.enabled;
  const requests =
    row.allowance && row.allowance.providerConnectionId === row.account.providerConnectionId
      ? mediaRequestsOf(row.allowance)
      : null;
  return {
    account: row.account,
    connection: row.connection,
    adapter,
    active,
    requests,
    expected: expectedSeerrAccess({
      enabled: row.account.enabled,
      missing: !!row.account.missingSince,
      requests,
    }),
  };
}

/** What one round wrote in Seerr and what the account row gets. */
interface SeerrStep {
  outcome: SeerrOutcome;
  /** undefined: leave the stored id as it is. */
  seerrUserId?: number | null;
  issues: SeerrIssue[];
  /** import: the Seerr user was created (or found) and set; access: rights or quotas written. */
  wrote: 'none' | 'import' | 'access';
  fields: SeerrAccessDriftField[];
}

/**
 * Brings the Seerr user of one account to `expected`. `known`: the Seerr user the sync's list has
 * for the account (null: none); undefined outside the sync, then a grant imports (which finds a
 * user Seerr knows by its Jellyfin id) and a revocation first reads the user of
 * `account.seerrUserId` and writes to it only while it has the account's Jellyfin id (otherwise
 * to the account's user found by its Jellyfin id, or to nobody). Never creates a Seerr user just
 * to give it no rights. Never throws.
 */
async function stepInSeerr(
  adapter: ProviderAdapter,
  account: Pick<MediaAccount, 'externalId' | 'seerrUserId'>,
  expected: SeerrUserAccess,
  known: RemoteSeerrUser | null | undefined,
): Promise<SeerrStep> {
  let current: RemoteSeerrUser | null = known ?? null;
  /** The Seerr user written to, stored also when the write failed: the sync or a switch-off retries it. */
  let target: number | null = current?.id ?? null;
  const owner = (id: number): SeerrStep => ({
    outcome: { error: seerrOwnerRefused().message },
    seerrUserId: id,
    issues: ['seerr_drift'],
    wrote: 'none',
    fields: [],
  });
  try {
    if (expected.permissions > 0) {
      const imported = !current;
      if (!current) current = await adapter.importSeerrUser!(account.externalId);
      target = current.id;
      if (current.id === SEERR_OWNER_ID) return owner(current.id);
      const fields = seerrAccessDrift(current, expected);
      const user =
        fields.length > 0 ? await adapter.setSeerrUserAccess!(current.id, expected, current) : current;
      return {
        outcome: 'ok',
        seerrUserId: user.id,
        issues: [],
        wrote: imported ? 'import' : fields.length > 0 ? 'access' : 'none',
        fields,
      };
    }
    // Outside the sync the stored id is confirmed first: one of another Seerr or another
    // Jellyfin user is never written to.
    let user: RemoteSeerrUser | null = known ?? null;
    let stale = false;
    if (known === undefined && account.seerrUserId !== null) {
      const confirmed = await confirmSeerrUser(adapter, account.seerrUserId, account.externalId);
      user = confirmed.user;
      stale = confirmed.stale;
    }
    if (!user) {
      // Nobody in Seerr to take rights from.
      return {
        outcome: 'skipped',
        seerrUserId: known === null || stale ? null : undefined,
        issues: [],
        wrote: 'none',
        fields: [],
      };
    }
    const id = user.id;
    if (id === SEERR_OWNER_ID) return owner(id);
    target = id;
    const fields = seerrAccessDrift(user, expected);
    if (fields.length === 0) return { outcome: 'ok', seerrUserId: id, issues: [], wrote: 'none', fields };
    try {
      await adapter.setSeerrUserAccess!(id, expected, user);
    } catch (err) {
      // Deleted in Seerr meanwhile: nothing is left that could request.
      if (gone(err)) return { outcome: 'ok', seerrUserId: null, issues: [], wrote: 'none', fields: [] };
      throw err;
    }
    return { outcome: 'ok', seerrUserId: id, issues: [], wrote: 'access', fields };
  } catch (err) {
    const missing = expected.permissions > 0 && !current;
    return {
      outcome: { error: errorMessage(err) },
      // The sync's list has no user for the account: a stored id is someone else's or gone.
      seerrUserId: target ?? (known === null ? null : undefined),
      issues: [missing ? 'seerr_missing' : 'seerr_drift'],
      wrote: 'none',
      fields: [],
    };
  }
}

/** Result of reconcileSeerr: the outcome and, for the sync's counts and audits, what happened. */
export interface SeerrReconciled {
  outcome: SeerrOutcome;
  /** The account's organization has the add-on on the account's instance and Seerr is active there. */
  visible: boolean;
  wrote: SeerrStep['wrote'];
  fields: SeerrAccessDriftField[];
  account: Pick<MediaAccount, 'id' | 'username' | 'orgId'> | null;
}

/**
 * One account's Seerr user brought to its expected state (see syncSeerrAccount), with the race
 * rule: the Seerr calls run outside any transaction, then the result is stored under a lock on
 * the account only if the expected state is still the one written; otherwise the step runs
 * again with the fresh state (at most RECONCILE_ATTEMPTS rounds). A grant written meanwhile
 * wrongly is taken back: by the next round when the account lost its rights (also before its
 * Seerr id was stored), here when Seerr was switched off or the account deleted (whose own steps
 * could not know the Seerr user yet). Throws only for database failures.
 */
export async function reconcileSeerr(
  env: SeerrEnv,
  accountId: string,
  known?: RemoteSeerrUser | null,
): Promise<SeerrReconciled> {
  let current = known;
  let result: SeerrReconciled = {
    outcome: 'skipped',
    visible: false,
    wrote: 'none',
    fields: [],
    account: null,
  };
  /** Seerr user that may hold rights written in this call, with the adapter that wrote them. */
  let granted: { id: number; adapter: ProviderAdapter; externalId: string } | null = null;
  /** False when a grant of this call is left in Seerr. */
  const takeBack = async (): Promise<boolean> => {
    if (!granted || granted.id === SEERR_OWNER_ID) return true;
    const { id, adapter, externalId } = granted;
    const revoked = await bestEffort(() =>
      adapter.setSeerrUserAccess!(id, NO_RIGHTS, rightsUnknown(id, externalId)),
    );
    if (!revoked.ok) env.log.warn({ accountId, error: revoked.error }, 'seerr grant not taken back');
    return revoked.ok;
  };
  for (let attempt = 0; attempt < RECONCILE_ATTEMPTS; attempt++) {
    const plan = await loadPlan(env, env.db, accountId);
    if (!plan) {
      await takeBack();
      return { ...result, outcome: 'skipped', visible: false };
    }
    if (!plan.active) {
      // Switched off meanwhile: a grant left in Seerr is a revocation still to do (seerr_drift).
      const left = !(await takeBack());
      await stripSeerrMissing(env.db, accountId, left);
      return { outcome: 'skipped', visible: false, wrote: 'none', fields: [], account: plan.account };
    }
    const planned = plan.expected;
    // A revocation also reaches the user an earlier round granted to, whose id is not stored yet.
    const step = await stepInSeerr(
      plan.adapter,
      { externalId: plan.account.externalId, seerrUserId: granted?.id ?? plan.account.seerrUserId },
      planned,
      current,
    );
    if (planned.permissions > 0 && typeof step.seerrUserId === 'number') {
      granted = { id: step.seerrUserId, adapter: plan.adapter, externalId: plan.account.externalId };
    }
    result = {
      outcome: step.outcome,
      visible: plan.requests !== null,
      wrote: step.wrote,
      fields: step.fields,
      account: plan.account,
    };
    const committed = await env.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`media-seerr:${accountId}`}, 0))`);
      const fresh = await loadPlan(env, tx, accountId);
      // Deleted meanwhile: nothing to store; a grant of this call is taken back below.
      if (!fresh) return 'deleted' as const;
      if (!fresh.active || !sameSeerrAccess(fresh.expected, planned)) return false;
      await tx
        .update(mediaAccounts)
        .set({
          ...(step.seerrUserId !== undefined ? { seerrUserId: step.seerrUserId } : {}),
          issues: replaceSeerrIssues(step.issues),
        })
        .where(eq(mediaAccounts.id, accountId));
      return true;
    });
    // The delete may have looked for the Seerr user before this call created it.
    if (committed === 'deleted') await takeBack();
    if (committed) return result;
    // Seerr's state as read before is stale now: the next round reads it again.
    current = undefined;
  }
  return result;
}

/**
 * While Seerr is not active the Seerr issues mean one thing only: seerr_drift marks request rights
 * a switch-off (or a grant it raced) could not take back yet, which the sync and the next
 * switch-off retry (see revokeSeerrConnection). seerr_missing means nothing then and goes; with
 * `revocationLeft` the account gets the mark.
 */
async function stripSeerrMissing(db: DbOrTx, accountId: string, revocationLeft: boolean): Promise<void> {
  await db
    .update(mediaAccounts)
    .set({
      issues: revocationLeft
        ? replaceSeerrIssues(['seerr_drift'])
        : sql`${mediaAccounts.issues} - 'seerr_missing'::text`,
    })
    .where(
      and(
        eq(mediaAccounts.id, accountId),
        revocationLeft ? undefined : sql`${mediaAccounts.issues} ? 'seerr_missing'`,
      ),
    );
}

/**
 * Strips seerr_missing from every account of a connection whose Seerr is not active. The rows
 * keep their updatedAt: that is no change of the account. seerr_drift stays (see
 * stripSeerrMissing).
 */
export async function stripSeerrMissingOf(db: DbOrTx, connectionId: string): Promise<void> {
  await db
    .update(mediaAccounts)
    .set({
      issues: sql`${mediaAccounts.issues} - 'seerr_missing'::text`,
      updatedAt: sql`${mediaAccounts.updatedAt}`,
    })
    .where(
      and(
        eq(mediaAccounts.providerConnectionId, connectionId),
        sql`${mediaAccounts.issues} ? 'seerr_missing'`,
      ),
    );
}

/** Accounts of a connection whose request rights a switch-off could not take back yet. */
export async function pendingSeerrRevocations(db: DbOrTx, connectionId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(mediaAccounts)
    .where(
      and(eq(mediaAccounts.providerConnectionId, connectionId), sql`${mediaAccounts.issues} ? 'seerr_drift'`),
    );
  return row?.n ?? 0;
}

/**
 * After the Seerr address of a connection changed or was removed, in the transaction of that
 * change: Seerr ids of the old Seerr mean nothing in the new one (they would name other users
 * there), so every account of the connection forgets its Seerr id, numbers and Seerr issues. The
 * next switch-on or sync finds the users again by their Jellyfin ids.
 */
export async function forgetSeerrUsers(db: DbOrTx, connectionId: string): Promise<void> {
  await db
    .update(mediaAccounts)
    .set({ seerrUserId: null, seerrRequests: null, seerrSyncedAt: null, issues: replaceSeerrIssues([]) })
    .where(
      and(
        eq(mediaAccounts.providerConnectionId, connectionId),
        or(
          isNotNull(mediaAccounts.seerrUserId),
          isNotNull(mediaAccounts.seerrRequests),
          isNotNull(mediaAccounts.seerrSyncedAt),
          sql`(${mediaAccounts.issues} ? 'seerr_missing' or ${mediaAccounts.issues} ? 'seerr_drift')`,
        ),
      ),
    );
}

/**
 * After the Seerr address of a connection was removed, in the transaction of that change: an
 * add-on needs a Seerr on its instance (requests_unavailable), so every allowance there loses it.
 * Kept, it would be an add-on nobody sees or changes any more (the staff dialog shows the add-on
 * only where Seerr is set up) that still refuses a reseller's allowance whose customers' add-ons
 * no longer fit. Returns the organizations whose add-on went, for the audit entry of the change.
 */
export async function dropMediaRequestsOf(
  db: DbOrTx,
  connectionId: string,
  updatedBy: string | null,
): Promise<string[]> {
  const rows = await db
    .update(mediaAllowances)
    .set({ ...mediaRequestsColumns(null), updatedBy })
    .where(
      and(
        eq(mediaAllowances.providerConnectionId, connectionId),
        or(eq(mediaAllowances.requestsMovies, true), eq(mediaAllowances.requestsTv, true)),
      ),
    )
    .returning({ orgId: mediaAllowances.orgId });
  return rows.map((r) => r.orgId).sort();
}

/**
 * Brings one account's Seerr user to the expected state (import when needed and entitled; never
 * creates a Seerr user just to give it 0). Updates seerr_user_id and the seerr issues of the row.
 * Never throws. 'skipped' when Seerr is not active for the account's connection (then also strips
 * seerr issues) or when there is nothing to do in Seerr (no rights expected, no Seerr user known).
 */
export async function syncSeerrAccount(ctx: AppContext, accountId: string): Promise<SeerrOutcome> {
  try {
    return (await reconcileSeerr(envOf(ctx), accountId)).outcome;
  } catch (err) {
    ctx.log.warn({ err, accountId }, 'seerr step of a streaming account failed');
    return { error: errorMessage(err) };
  }
}

/** Whether the account's organization has the add-on on the account's instance and Seerr is active there. */
export async function seerrVisibleForAccount(ctx: AppContext, accountId: string): Promise<boolean> {
  const plan = await loadPlan(envOf(ctx), ctx.db, accountId).catch(() => null);
  return !!plan && plan.active && plan.requests !== null;
}

/**
 * The Seerr step after an account action, bounded by SEERR_STEP_MS, as the audit entry records
 * it: `{ seerr: outcome }` only where requests are visible to the account's organization (others
 * see nothing of Seerr, also in their audit log), else nothing.
 */
export async function seerrAccountStep(
  ctx: AppContext,
  accountId: string,
): Promise<{ seerr?: SeerrOutcome }> {
  const run = await bestEffort(() => reconcileSeerr(envOf(ctx), accountId), SEERR_STEP_MS);
  if (run.ok) return run.value.visible ? { seerr: run.value.outcome } : {};
  if (run.error !== 'no answer in time') ctx.log.warn({ accountId, error: run.error }, 'seerr step failed');
  return (await seerrVisibleForAccount(ctx, accountId)) ? { seerr: { error: run.error } } : {};
}

/**
 * After the Jellyfin delete: deletes the Seerr user (best effort), after checking that it is
 * still the one of this Jellyfin user (never another customer's). Without a stored id the user is
 * looked up by its Jellyfin id: a first import running alongside may have created it after the
 * row was read (one that creates it later takes its rights back itself). While Seerr is switched
 * off, only the Seerr user of an account whose request rights the switch-off could not take back
 * yet (seerr_drift) is deleted: that mark goes with the row. Never throws.
 */
export async function deleteSeerrAccount(
  ctx: AppContext,
  row: Pick<MediaAccount, 'providerConnectionId' | 'seerrUserId' | 'externalId' | 'issues'>,
): Promise<SeerrOutcome> {
  try {
    const connection = await ctx.db.query.providerConnections.findFirst({
      where: eq(providerConnections.id, row.providerConnectionId),
    });
    if (!connection) return 'skipped';
    const state = await seerrState(ctx, connection);
    const revocationLeft = state.configured && row.issues.includes('seerr_drift');
    if (!state.active && !revocationLeft) return 'skipped';
    if (row.seerrUserId === SEERR_OWNER_ID) return { error: seerrOwnerRefused().message };
    const users = await state.adapter.listSeerrUsers!();
    if (row.seerrUserId === null) {
      const found = users.find((u) => u.jellyfinUserId === row.externalId);
      if (!found) return 'skipped';
      if (found.id === SEERR_OWNER_ID) return { error: seerrOwnerRefused().message };
      await state.adapter.deleteSeerrUser!(found.id);
      return 'ok';
    }
    const user = users.find((u) => u.id === row.seerrUserId);
    if (!user) return 'ok';
    if (user.jellyfinUserId !== row.externalId) {
      return { error: 'The Seerr user belongs to another Jellyfin user and was left alone' };
    }
    await state.adapter.deleteSeerrUser!(user.id);
    return 'ok';
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

// --- Organizations and instances --------------------------------------------------------

/**
 * For allowance changes and switching Seerr on: every non-missing account of the organization on
 * the connection, SEERR_PARALLEL at a time. Never throws; nothing happens while Seerr is not
 * active there.
 */
export async function applySeerrOrg(
  ctx: AppContext,
  orgId: string,
  connection: ProviderConnection,
): Promise<MediaPolicyApplyResult> {
  const result: MediaPolicyApplyResult = { applied: 0, failed: [] };
  try {
    if (!(await seerrState(ctx, connection)).active) return result;
    const rows = await ctx.db
      .select({ id: mediaAccounts.id, username: mediaAccounts.username })
      .from(mediaAccounts)
      .where(
        and(
          eq(mediaAccounts.orgId, orgId),
          eq(mediaAccounts.providerConnectionId, connection.id),
          isNull(mediaAccounts.missingSince),
        ),
      )
      .orderBy(mediaAccounts.username);
    const env = envOf(ctx);
    await mapLimit(rows, SEERR_PARALLEL, async (row) => {
      const outcome = await reconcileSeerr(env, row.id).then(
        (r) => r.outcome,
        (err: unknown): SeerrOutcome => ({ error: errorMessage(err) }),
      );
      if (outcome === 'ok') result.applied++;
      else if (typeof outcome === 'object') {
        result.failed.push({ accountId: row.id, username: row.username, error: outcome.error });
      }
    });
  } catch (err) {
    ctx.log.error({ err, orgId }, 'seerr apply: accounts could not be read');
  }
  result.failed.sort((a, b) => a.username.localeCompare(b.username));
  return result;
}

/** A stored Seerr id that named someone else or nobody, and the one found by the Jellyfin id. */
export interface StaleSeerrId {
  from: number;
  to: number | null;
}

/** What revokeSeerrAccount did; `owner`: the account's Seerr user is the owner, never changed. */
export interface SeerrRevocation {
  outcome: 'revoked' | 'nothing' | 'deferred' | 'owner';
  /** Store `to` instead of the account's id (only while the row still has `from`). */
  stale?: StaleSeerrId;
}

/**
 * Takes one account's request rights while Seerr is switched off (the switch-off and the retries
 * of what it could not finish): permissions 0 for the user of its stored id once confirmed (from
 * `listed`, Seerr's list, otherwise read alone), else for the user Seerr has for its Jellyfin id,
 * but never for the owner or Seerr staff found that way (the console did not set them up). Without
 * `listed` an account without a stored id is not reached ('nothing'). `withRightsOnly` leaves a
 * user without any permission alone; `mayWrite` is asked right before the write ('deferred' when
 * it says no). Throws for Seerr failures, a user gone meanwhile is 'nothing'.
 */
export async function revokeSeerrAccount(
  adapter: ProviderAdapter,
  row: Pick<MediaAccount, 'externalId' | 'seerrUserId'>,
  listed: readonly RemoteSeerrUser[] | undefined,
  options: { withRightsOnly?: boolean; mayWrite?: () => boolean } = {},
): Promise<SeerrRevocation> {
  let user: RemoteSeerrUser | null;
  let stale: StaleSeerrId | undefined;
  if (row.seerrUserId !== null) {
    const confirmed = await confirmSeerrUser(adapter, row.seerrUserId, row.externalId, listed);
    user = confirmed.user;
    if (confirmed.stale) {
      stale = { from: row.seerrUserId, to: user?.id ?? null };
      if (user && !revocableByJellyfinId(user)) return { outcome: 'nothing', stale };
    }
  } else {
    user = listed ? seerrUserByJellyfinId(listed, row.externalId) : null;
    if (user && !revocableByJellyfinId(user)) return { outcome: 'nothing' };
  }
  if (!user || (options.withRightsOnly && user.permissions === 0)) return { outcome: 'nothing', stale };
  if (user.id === SEERR_OWNER_ID) return { outcome: 'owner', stale };
  if (options.mayWrite && !options.mayWrite()) return { outcome: 'deferred', stale };
  try {
    await adapter.setSeerrUserAccess!(user.id, NO_RIGHTS, user);
  } catch (err) {
    if (gone(err)) return { outcome: 'nothing', stale };
    throw err;
  }
  return { outcome: 'revoked', stale };
}

/**
 * Switching Seerr off: permissions 0 for every account of the connection with a Seerr user,
 * issues and counts cleared. Never throws. Does nothing while Seerr is switched on again.
 *
 * Seerr is often switched off because it does not answer. An account whose rights could not be
 * taken (or, without Seerr's list, not be checked) keeps seerr_drift as the mark of a revocation
 * still to do: the sync retries it while Seerr is off, so does the next switch-off, and deleting
 * the account deletes its Seerr user. Only an account linked to the owner is not marked (nobody
 * ever changes the owner).
 */
export async function revokeSeerrConnection(
  ctx: AppContext,
  connection: ProviderConnection,
): Promise<MediaPolicyApplyResult> {
  const result: MediaPolicyApplyResult = { applied: 0, failed: [] };
  try {
    const state = await seerrState(ctx, connection);
    if (state.enabled) return result;
    // Without an address there is nobody to write to; issues and numbers go all the same.
    const accounts = state.configured
      ? await ctx.db
          .select({
            id: mediaAccounts.id,
            username: mediaAccounts.username,
            externalId: mediaAccounts.externalId,
            seerrUserId: mediaAccounts.seerrUserId,
          })
          .from(mediaAccounts)
          .where(eq(mediaAccounts.providerConnectionId, connection.id))
          .orderBy(mediaAccounts.username)
      : [];
    // One list for every account: it confirms the stored ids (a stored id is written to only while
    // its Seerr user has the account's Jellyfin id) and finds the Seerr users of accounts without
    // one (a grant whose id was never stored). Owner and staff found by the Jellyfin id only were
    // not set up by the console and stay as they are. Without the list each stored id is read
    // alone, and accounts without one count as failed: whether they have rights is unknown.
    let listError = 'Seerr users could not be listed';
    const listed =
      accounts.length > 0
        ? await state.adapter.listSeerrUsers!().catch((err: unknown) => {
            ctx.log.warn({ err, providerId: connection.id }, 'seerr revoke: users could not be listed');
            listError = errorMessage(err);
            return undefined;
          })
        : undefined;
    /** Accounts whose stored id was stale, with the id found by their Jellyfin id. */
    const replaced: (StaleSeerrId & { id: string })[] = [];
    /** Accounts whose revocation is still to do. */
    const left: string[] = [];
    await mapLimit(accounts, SEERR_PARALLEL, async (row) => {
      const fail = (error: string, retry: boolean) => {
        result.failed.push({ accountId: row.id, username: row.username, error });
        if (retry) left.push(row.id);
      };
      if (row.seerrUserId === null && !listed) return fail(listError, true);
      try {
        const done = await revokeSeerrAccount(state.adapter, row, listed);
        if (done.stale) replaced.push({ id: row.id, ...done.stale });
        if (done.outcome === 'owner') fail(seerrOwnerRefused().message, false);
        else if (done.outcome === 'revoked') result.applied++;
      } catch (err) {
        if (gone(err)) return;
        fail(errorMessage(err), true);
      }
    });
    await ctx.db.transaction(async (tx) => {
      for (const stale of replaced) {
        await tx
          .update(mediaAccounts)
          .set({ seerrUserId: stale.to })
          .where(and(eq(mediaAccounts.id, stale.id), eq(mediaAccounts.seerrUserId, stale.from)));
      }
      await tx
        .update(mediaAccounts)
        .set({ issues: replaceSeerrIssues([]), seerrRequests: null, seerrSyncedAt: null })
        .where(eq(mediaAccounts.providerConnectionId, connection.id));
      if (left.length > 0) {
        await tx
          .update(mediaAccounts)
          .set({ issues: replaceSeerrIssues(['seerr_drift']) })
          .where(inArray(mediaAccounts.id, left));
      }
    });
  } catch (err) {
    ctx.log.error({ err, providerId: connection.id }, 'seerr revoke: accounts could not be updated');
  }
  result.failed.sort((a, b) => a.username.localeCompare(b.username));
  return result;
}

/** Organizations with an allowance on the connection, and of them with the add-on. */
async function seerrCounts(db: DbOrTx, connectionId: string) {
  const [orgs] = await db
    .select({
      organizations: count(),
      withRequests:
        sql<number>`count(*) filter (where ${mediaAllowances.requestsMovies} or ${mediaAllowances.requestsTv})`.mapWith(
          Number,
        ),
    })
    .from(mediaAllowances)
    .where(eq(mediaAllowances.providerConnectionId, connectionId));
  const [accounts] = await db
    .select({ n: count() })
    .from(mediaAccounts)
    .where(and(eq(mediaAccounts.providerConnectionId, connectionId), isNotNull(mediaAccounts.seerrUserId)));
  return {
    organizations: orgs?.organizations ?? 0,
    organizationsWithRequests: orgs?.withRequests ?? 0,
    accountsInSeerr: accounts?.n ?? 0,
  };
}

/** Organizations with the add-on on the connection, for switching Seerr on. */
export async function organizationsWithRequests(db: DbOrTx, connectionId: string): Promise<string[]> {
  const rows = await db
    .select({ orgId: mediaAllowances.orgId })
    .from(mediaAllowances)
    .where(
      and(
        eq(mediaAllowances.providerConnectionId, connectionId),
        or(eq(mediaAllowances.requestsMovies, true), eq(mediaAllowances.requestsTv, true)),
      ),
    )
    .orderBy(asc(mediaAllowances.orgId));
  return rows.map((r) => r.orgId);
}

/** The stored state of a configured Seerr (no live call). */
export async function storedSeerrDto(
  ctx: AppContext,
  connection: ProviderConnection,
  state?: SeerrState,
): Promise<MediaSeerrDto> {
  const current = state ?? (await seerrState(ctx, connection));
  const row = current.row;
  return {
    url: current.adapter.seerrUrl?.() ?? '',
    enabled: current.enabled,
    status: row?.status ?? 'unknown',
    check: row?.lastCheck ?? null,
    checkedAt: row?.checkedAt?.toISOString() ?? null,
    lastError: row?.lastError ?? null,
    ...(await seerrCounts(ctx.db, connection.id)),
  };
}

/** Writes status and check of a connection's Seerr, creating its row (switched off) when needed. */
export async function storeSeerrCheck(
  db: DbOrTx,
  connectionId: string,
  values: Pick<MediaSeerrRow, 'status' | 'lastError' | 'lastCheck' | 'checkedAt'>,
): Promise<void> {
  await db
    .insert(mediaSeerr)
    .values({ providerConnectionId: connectionId, ...values })
    .onConflictDoUpdate({
      target: mediaSeerr.providerConnectionId,
      set: { ...values, updatedAt: new Date() },
    });
}

/**
 * Live check plus unmanaged requesters and orphans; stores status and last_check. `result`: a
 * check the caller made already (after applying the recommended settings). Never throws for
 * Seerr's problems: a failed check is status "error" with `lastError` and no `check`.
 */
export async function checkSeerr(
  ctx: AppContext,
  connection: ProviderConnection,
  result?: SeerrCheckResult,
): Promise<MediaSeerrDto> {
  const state = await seerrState(ctx, connection);
  if (!state.configured) throw seerrNotConfigured();
  let check: MediaSeerrCheck | null = null;
  let status: MediaSeerrStatus = 'error';
  let lastError: string | null = null;
  try {
    const { error, ...live } = result ?? (await state.adapter.seerrCheck!());
    check = { ...live, unmanagedRequesters: null, orphans: null };
    status = seerrStatusOf(live.problems);
    // Why the check stopped (unreachable, key): for staff, never with the key.
    if (error) lastError = error.slice(0, 300);
    if (!live.problems.includes('unreachable') && !live.problems.includes('key')) {
      try {
        const users = await state.adapter.listSeerrUsers!();
        const managed = await managedJellyfinIds(ctx.db, connection.id);
        check.unmanagedRequesters = users.filter((u) => isUnmanagedRequester(u, managed)).length;
        if (state.adapter.listMediaUsers) {
          const jellyfin = new Set((await state.adapter.listMediaUsers()).map((u) => u.externalId));
          check.orphans = users.filter((u) => u.jellyfinUserId && !jellyfin.has(u.jellyfinUserId)).length;
        }
      } catch (err) {
        lastError = errorMessage(err).slice(0, 300);
      }
    }
  } catch (err) {
    check = null;
    status = 'error';
    lastError = errorMessage(err).slice(0, 300);
  }
  await storeSeerrCheck(ctx.db, connection.id, {
    status,
    lastError,
    lastCheck: check,
    checkedAt: new Date(),
  });
  return storedSeerrDto(ctx, connection);
}

async function managedJellyfinIds(db: DbOrTx, connectionId: string): Promise<Set<string>> {
  const rows = await db
    .select({ externalId: mediaAccounts.externalId })
    .from(mediaAccounts)
    .where(eq(mediaAccounts.providerConnectionId, connectionId));
  return new Set(rows.map((r) => r.externalId));
}

// --- DTOs ----------------------------------------------------------------------------------

/** Who looks at an allowance: staff, the organization itself, or the reseller of a customer. */
export type AllowanceViewer = 'admin' | 'customer' | { reseller: Pick<Organization, 'id'> };

/**
 * What of the add-on a viewer sees (21): staff the add-on wherever Seerr is configured and the
 * totals while it is active; the organization itself only an add-on that is on and active; a
 * reseller only while its own allowance has the add-on and Seerr is active.
 */
export async function allowanceRequestsShown(
  ctx: AppContext,
  allowance: MediaAllowance,
  connection: ProviderConnection,
  viewer: AllowanceViewer,
): Promise<{ requests: boolean; totals: boolean }> {
  const state = await seerrState(ctx, connection);
  if (viewer === 'admin') return { requests: state.configured, totals: state.active };
  if (viewer === 'customer') return { requests: requestsVisibleToCustomer(state, allowance), totals: false };
  if (!state.active) return { requests: false, totals: false };
  const own = await ctx.db.query.mediaAllowances.findFirst({
    where: eq(mediaAllowances.orgId, viewer.reseller.id),
  });
  const shown = !!own && own.providerConnectionId === connection.id && mediaRequestsOf(own) !== null;
  return { requests: shown, totals: shown };
}

/** Sums over an organization's accounts on the instance (numbers only). */
export async function mediaRequestTotals(
  db: DbOrTx,
  orgId: string,
  connectionId: string,
): Promise<MediaRequestTotals> {
  const total = (key: 'pending' | 'approved' | 'available') =>
    sql<number>`coalesce(sum((${mediaAccounts.seerrRequests} ->> ${key})::int), 0)`.mapWith(Number);
  const [row] = await db
    .select({
      accounts: sql<number>`count(*) filter (where ${mediaAccounts.seerrUserId} is not null)`.mapWith(Number),
      pending: total('pending'),
      approved: total('approved'),
      available: total('available'),
    })
    .from(mediaAccounts)
    .where(
      and(
        eq(mediaAccounts.orgId, orgId),
        eq(mediaAccounts.providerConnectionId, connectionId),
        isNull(mediaAccounts.missingSince),
      ),
    );
  return {
    accounts: row?.accounts ?? 0,
    pending: row?.pending ?? 0,
    approved: row?.approved ?? 0,
    available: row?.available ?? 0,
  };
}

/** toMediaAllowanceDto plus what of the add-on the viewer may see (keys absent otherwise). */
export async function toMediaAllowanceDtoFor(
  ctx: AppContext,
  org: Pick<Organization, 'id' | 'kind'>,
  allowance: MediaAllowance,
  connection: ProviderConnection,
  viewer: AllowanceViewer,
): Promise<MediaAllowanceDto> {
  const dto = await toMediaAllowanceDto(ctx, org, allowance, connection);
  const shown = await allowanceRequestsShown(ctx, allowance, connection, viewer);
  if (shown.requests) dto.requests = mediaRequestsOf(allowance);
  if (shown.totals) dto.requestTotals = await mediaRequestTotals(ctx.db, allowance.orgId, connection.id);
  return dto;
}

export async function mediaAllowanceDtoFor(
  ctx: AppContext,
  org: Organization,
  viewer: AllowanceViewer,
): Promise<MediaAllowanceDto | null> {
  const loaded = await loadMediaAllowance(ctx.db, org.id);
  return loaded ? toMediaAllowanceDtoFor(ctx, org, loaded.allowance, loaded.connection, viewer) : null;
}

/** The customer card (OrgMediaDto.requests); undefined where requests are not visible. */
export async function mediaRequestsInfo(
  ctx: AppContext,
  allowance: MediaAllowance,
  connection: ProviderConnection,
): Promise<MediaRequestsInfoDto | undefined> {
  const state = await seerrState(ctx, connection);
  const access = mediaRequestsOf(allowance);
  if (!requestsVisibleToCustomer(state, allowance) || !access) return undefined;
  const [row] = await ctx.db
    .select({ at: max(mediaAccounts.seerrSyncedAt) })
    .from(mediaAccounts)
    .where(
      and(eq(mediaAccounts.orgId, allowance.orgId), eq(mediaAccounts.providerConnectionId, connection.id)),
    );
  return { url: state.adapter.seerrUrl?.() ?? '', access, syncedAt: row?.at?.toISOString() ?? null };
}

/** Seerr states and add-ons read once per request, for lists of accounts. */
export class SeerrLookup {
  private readonly states = new Map<string, Promise<SeerrState>>();
  private readonly allowances = new Map<string, Promise<MediaAllowance | null>>();

  constructor(private readonly ctx: AppContext) {}

  state(connection: ProviderConnection): Promise<SeerrState> {
    let state = this.states.get(connection.id);
    if (!state) {
      state = seerrState(this.ctx, connection);
      this.states.set(connection.id, state);
    }
    return state;
  }

  private allowance(orgId: string): Promise<MediaAllowance | null> {
    let allowance = this.allowances.get(orgId);
    if (!allowance) {
      allowance = this.ctx.db.query.mediaAllowances
        .findFirst({ where: eq(mediaAllowances.orgId, orgId) })
        .then((a) => a ?? null);
      this.allowances.set(orgId, allowance);
    }
    return allowance;
  }

  /** Requests visible to the organization of an account on `connection`. */
  async visibleToCustomer(orgId: string | null, connection: ProviderConnection): Promise<boolean> {
    if (!orgId) return false;
    const [state, allowance] = await Promise.all([this.state(connection), this.allowance(orgId)]);
    return requestsVisibleToCustomer(state, allowance);
  }
}

export function accountRequestsView(
  account: Pick<MediaAccount, 'seerrUserId' | 'issues' | 'seerrRequests'>,
): MediaAccountRequestsView {
  const counts = account.seerrRequests;
  return {
    ready: account.seerrUserId !== null && !account.issues.includes('seerr_missing'),
    counts: counts
      ? {
          pending: counts.pending,
          approved: counts.approved,
          available: counts.available,
          movieUsed: counts.movieUsed,
          tvUsed: counts.tvUsed,
        }
      : null,
  };
}

/**
 * toMediaAccountDto with the requests part: staff ('admin') see it wherever Seerr is active,
 * everyone else only where the account's organization has the add-on there. Where it is not
 * visible, the key is absent and the Seerr issues are left out too, except that staff see
 * seerr_drift while Seerr is switched off: request rights the switch-off could not take yet.
 */
export async function toMediaAccountDtoFor(
  ctx: AppContext,
  req: FastifyRequest,
  row: MediaAccountRow,
  lookup: SeerrLookup,
  viewer: 'admin' | 'customer',
): Promise<MediaAccountDto> {
  const dto = await toMediaAccountDto(ctx, req, row);
  const state = viewer === 'admin' ? await lookup.state(row.connection) : null;
  const visible = state ? state.active : await lookup.visibleToCustomer(row.account.orgId, row.connection);
  if (!visible) {
    const revocationLeft = !!state?.configured;
    return {
      ...dto,
      issues: dto.issues.filter((i) => i !== 'seerr_missing' && (i !== 'seerr_drift' || revocationLeft)),
    };
  }
  return { ...dto, requests: accountRequestsView(row.account) };
}

// --- Billing --------------------------------------------------------------------------------

/**
 * For billing later (section 16.5): sets or clears the add-on like the admin PUT does (the
 * instance needs a Seerr for an add-on; a reseller is never narrowed below its customers),
 * audits it as media.allowance_set and brings the organization's Seerr users along.
 */
export async function setMediaRequests(
  ctx: AppContext,
  orgId: string,
  requests: MediaRequestsAccess | null,
  actorUserId: string | null,
): Promise<MediaAllowanceChangeResult> {
  const org = await ctx.db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
  if (!org) throw notFound('Organization');
  const next = normalizeMediaRequests(requests);
  const { previous, stored, connection } = await ctx.db.transaction(async (tx) => {
    await lockMediaOrg(tx, org);
    const loaded = await loadMediaAllowance(tx, orgId);
    if (!loaded) throw noAllowance();
    const { allowance, connection } = loaded;
    if (next && !(ctx.providers.forConnection(connection).seerrConfigured?.() ?? false)) {
      throw requestsUnavailable();
    }
    const usage = await mediaCommitments(tx, org, connection.id);
    const outside: MediaAllowanceConflictDetails['customers'] = usage.customers
      .map((customer) => ({
        id: customer.orgId,
        name: customer.name,
        conflicts: mediaRequestsExceed(customer.requests, next),
      }))
      .filter((customer) => customer.conflicts.length > 0);
    if (outside.length > 0) {
      throw allowanceConflict(
        `The requests of ${outside.length} customers would no longer fit into this allowance: ${outside.map((c) => c.name).join(', ')}. Change their allowances first.`,
        { customers: outside },
      );
    }
    const [stored] = await tx
      .update(mediaAllowances)
      .set({ ...mediaRequestsColumns(next), updatedBy: actorUserId, updatedAt: new Date() })
      .where(eq(mediaAllowances.orgId, orgId))
      .returning();
    return { previous: allowance, stored: stored!, connection };
  });
  const changed = !sameMediaRequests(mediaRequestsOf(previous), next);
  const seerr =
    changed && (await seerrState(ctx, connection)).active
      ? await applySeerrOrg(ctx, orgId, connection)
      : undefined;
  // The organization reads this entry: the add-on only where it sees requests, before or after.
  const shown =
    (await allowanceRequestsShown(ctx, stored, connection, 'customer')).requests ||
    (await allowanceRequestsShown(ctx, previous, connection, 'customer')).requests;
  await ctx.audit.record(null, {
    action: 'media.allowance_set',
    orgId,
    resourceType: 'media_allowance',
    resourceId: orgId,
    actorUserId,
    ...(actorUserId ? {} : { actorName: 'Billing' }),
    details: shown
      ? {
          requests: next,
          previous: { requests: mediaRequestsOf(previous) },
          ...(seerr ? { seerr: seerrApplyDetails(seerr) } : {}),
        }
      : {},
  });
  return {
    allowance: await toMediaAllowanceDtoFor(ctx, org, stored, connection, 'admin'),
    policy: { applied: 0, failed: [] },
    ...(seerr ? { seerr } : {}),
  };
}
