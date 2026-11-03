import { and, desc, eq, lt, sql, type SQL } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import {
  MEDIA_SEERR_FIXABLE,
  type MediaAccountRequestsDto,
  type MediaRequestsAccess,
  type MediaSeerrCheck,
} from '@weblion/shared';
import type { AuditService } from '../audit';
import type { Database } from '../db/client';
import { auditLogs, mediaAccounts, mediaAllowances, mediaSeerr, type ProviderConnection } from '../db/schema';
import { runStart } from '../lib/clock';
import {
  expectedSeerrAccess,
  isUnmanagedRequester,
  reconcileSeerr,
  seerrAccessDrift,
  seerrSettingsOf,
  seerrStatusOf,
  seerrSyncEnv,
  revokeSeerrAccount,
  storeSeerrCheck,
  stripSeerrMissingOf,
  type SeerrAccessDriftField,
  type SeerrOutcome,
  type SeerrRevocation,
} from '../modules/media/seerr';
import { errorMessage, mediaRequestsOf, replaceSeerrIssues, type SeerrIssue } from '../modules/media/service';
import { SEERR_OWNER_ID, SEERR_REQUEST_BITS } from '../providers/seerr/rules';
import type { ProviderAdapter, RemoteSeerrUser, SeerrCheckResult, SeerrUserAccess } from '../providers/types';

/** Counts of a Seerr sync run (requests add-on of a Jellyfin connection). */
export interface SeerrSyncCounts {
  imported: number;
  repaired: number;
  revoked: number;
  failed: number;
  /** Accounts whose numbers were refreshed. */
  counted: number;
}

/** Imports, repairs and revocations per run and connection, together. */
export const MAX_SEERR_WRITES_PER_RUN = 25;
/** Quota reads per run (one request each), oldest numbers first. */
export const SEERR_QUOTA_READS_PER_RUN = 50;
/** last_error while the numbers stay as they were (more requests than the pages read). */
export const SEERR_COUNTS_INCOMPLETE = 'more than 5000 requests: numbers not refreshed';

const SYNC = 'Sync';

/**
 * The Seerr of a Jellyfin connection (section 20.3 of the design): re-checks and re-applies the
 * safe settings, imports and repairs the managed accounts, takes request rights from users the
 * console does not manage and stores the numbers. Called by syncConnection after the streaming
 * accounts when the adapter has a Seerr configured. Records Seerr failures in media_seerr
 * instead of throwing, so a Seerr outage never marks the Jellyfin connection.
 *
 * Accounts and allowances a route changed during the run are left alone (the route ran its own
 * Seerr step), and every write to Seerr goes through reconcileSeerr, which stores its result only
 * while the expected state is still the one written. Audited as "Sync"; entries of accounts whose
 * organization has no requests stay out of that organization's audit log.
 */
export async function syncSeerr(
  db: Database,
  connection: ProviderConnection,
  adapter: ProviderAdapter,
  audit: AuditService,
  log?: Pick<FastifyBaseLogger, 'warn'>,
): Promise<SeerrSyncCounts> {
  const counts: SeerrSyncCounts = { imported: 0, repaired: 0, revoked: 0, failed: 0, counted: 0 };
  const started = await runStart();
  const [row] = await db
    .select()
    .from(mediaSeerr)
    .where(eq(mediaSeerr.providerConnectionId, connection.id))
    .limit(1);
  const entry = { resourceType: 'provider', resourceId: connection.id, actorName: SYNC } as const;
  // 0. Switched off: only what the switch-off could not finish.
  if (!row?.enabled) {
    await finishRevocations(db, connection, adapter, audit, entry, counts, started, log);
    return counts;
  }
  const previous = {
    unmanagedRequesters: row.lastCheck?.unmanagedRequesters ?? null,
    orphans: row.lastCheck?.orphans ?? null,
  };
  const stored = (
    { error: _error, ...check }: SeerrCheckResult,
    unmanagedRequesters = previous.unmanagedRequesters,
  ): MediaSeerrCheck => ({
    ...check,
    unmanagedRequesters,
    orphans: previous.orphans,
  });
  const failedRun = async (err: unknown, check: MediaSeerrCheck | null = row.lastCheck) => {
    log?.warn({ err, provider: connection.name }, 'seerr sync stopped');
    await storeSeerrCheck(db, connection.id, {
      status: 'error',
      lastError: errorMessage(err).slice(0, 300),
      lastCheck: check,
      checkedAt: new Date(),
    });
    return counts;
  };

  // 1. Settings: the three safe values are re-applied when they drifted; anything else stops the run.
  let check: SeerrCheckResult;
  try {
    check = await adapter.seerrCheck!();
  } catch (err) {
    return failedRun(err, null);
  }
  let lastError: string | null = null;
  if (check.problems.length > 0 && check.problems.every((p) => MEDIA_SEERR_FIXABLE.includes(p))) {
    const before = seerrSettingsOf(check);
    try {
      check = await adapter.seerrApplySafeSettings!();
      await audit.record(null, {
        ...entry,
        action: 'media.seerr_settings',
        details: { before, after: seerrSettingsOf(check) },
      });
    } catch (err) {
      lastError = errorMessage(err).slice(0, 300);
      await audit.record(null, {
        ...entry,
        action: 'media.seerr_settings',
        status: 'failure',
        details: { before, error: lastError },
      });
    }
  }
  if (check.problems.length > 0) {
    await storeSeerrCheck(db, connection.id, {
      status: seerrStatusOf(check.problems),
      lastError: lastError ?? check.error?.slice(0, 300) ?? null,
      lastCheck: stored(check),
      checkedAt: new Date(),
    });
    return counts;
  }

  // 2. Seerr's users by Jellyfin user (the lowest id wins should Seerr have two).
  let users: RemoteSeerrUser[];
  try {
    users = await adapter.listSeerrUsers!();
  } catch (err) {
    return failedRun(err, stored(check));
  }
  const byJellyfin = new Map<string, RemoteSeerrUser>();
  for (const user of [...users].sort((a, b) => a.id - b.id)) {
    if (user.jellyfinUserId && !byJellyfin.has(user.jellyfinUserId))
      byJellyfin.set(user.jellyfinUserId, user);
  }

  // 3. The managed accounts.
  const accounts = await db
    .select({
      id: mediaAccounts.id,
      externalId: mediaAccounts.externalId,
      username: mediaAccounts.username,
      orgId: mediaAccounts.orgId,
      enabled: mediaAccounts.enabled,
      missingSince: mediaAccounts.missingSince,
      issues: mediaAccounts.issues,
      seerrUserId: mediaAccounts.seerrUserId,
      updatedAt: mediaAccounts.updatedAt,
    })
    .from(mediaAccounts)
    .where(eq(mediaAccounts.providerConnectionId, connection.id))
    .orderBy(mediaAccounts.username);
  const allowances = await db
    .select()
    .from(mediaAllowances)
    .where(eq(mediaAllowances.providerConnectionId, connection.id));
  const byOrg = new Map(allowances.map((allowance) => [allowance.orgId, allowance]));
  const requestsOf = (orgId: string | null): MediaRequestsAccess | null => {
    const allowance = orgId ? byOrg.get(orgId) : undefined;
    return allowance ? mediaRequestsOf(allowance) : null;
  };
  const managed = new Set(accounts.map((a) => a.externalId));
  const env = seerrSyncEnv(db, adapter, log);
  let writes = 0;

  /** Nothing to write (or no budget left): the stored id and issues follow what Seerr has. */
  const follow = async (planned: Planned) => {
    const { account, user, needsImport, fields } = planned;
    const issues: SeerrIssue[] = needsImport ? ['seerr_missing'] : fields.length > 0 ? ['seerr_drift'] : [];
    const seerrUserId = user?.id ?? null;
    if (seerrUserId === account.seerrUserId && sameIssues(storedSeerrIssues(account.issues), issues)) return;
    await db
      .update(mediaAccounts)
      .set({ seerrUserId, issues: replaceSeerrIssues(issues) })
      .where(and(eq(mediaAccounts.id, account.id), lt(mediaAccounts.updatedAt, started)));
  };
  const repair = async (planned: Planned) => {
    if (writes >= MAX_SEERR_WRITES_PER_RUN) return follow(planned);
    writes++;
    const { account, user, needsImport, fields, requests } = planned;
    const audited = {
      ...entry,
      action: 'media.seerr_repair',
      orgId: requests ? account.orgId : null,
      resourceType: 'media_account',
      resourceId: account.id,
    };
    const what = needsImport ? { imported: true } : { fields };
    const result = await reconcileSeerr(env, account.id, user).catch((err: unknown) => ({
      outcome: { error: errorMessage(err) } as SeerrOutcome,
      wrote: 'none' as const,
    }));
    if (typeof result.outcome === 'object') {
      counts.failed++;
      const error = result.outcome.error;
      // The same failure as the last entry of this account (a Seerr that refuses every run) is
      // not entered again: the issue stays and says so.
      if (!(await sameFailure(db, 'media.seerr_repair', { type: 'media_account', id: account.id }, error))) {
        await audit.record(null, {
          ...audited,
          status: 'failure',
          details: { username: account.username, ...what, error },
        });
      }
    } else if (result.outcome === 'ok' && result.wrote !== 'none') {
      if (result.wrote === 'import') counts.imported++;
      else counts.repaired++;
      await audit.record(null, { ...audited, details: { username: account.username, ...what } });
    }
  };

  const planned: Planned[] = [];
  for (const account of accounts) {
    const allowance = account.orgId ? byOrg.get(account.orgId) : undefined;
    // A route changed the account or its allowance during the run: it ran its own Seerr step.
    if (account.updatedAt >= started || (allowance && allowance.updatedAt >= started)) continue;
    const requests = requestsOf(account.orgId);
    const expected = expectedSeerrAccess({
      enabled: account.enabled,
      missing: !!account.missingSince,
      requests,
    });
    const user = byJellyfin.get(account.externalId) ?? null;
    const fields = user ? seerrAccessDrift(user, expected) : [];
    const needsImport = expected.permissions > 0 && !user;
    const plan: Planned = { account, user, requests, expected, fields, needsImport };
    // Seerr's owner is never changed; its drift stays visible.
    if (needsImport || (fields.length > 0 && user!.id !== SEERR_OWNER_ID)) planned.push(plan);
    else await follow(plan);
  }

  // The budget goes to taking rights first: managed accounts with rights they should not have
  // (disabled, deleted in Jellyfin, add-on off, extra bits), then users the console does not manage.
  // Then to grants: those that did not fail before, and last, from a random start, those that did,
  // so imports Seerr refuses every run never starve the accounts behind them.
  const takesRights = (p: Planned) => !!p.user && (p.user.permissions & ~p.expected.permissions) !== 0;
  const failedBefore = (p: Planned) =>
    storedSeerrIssues(p.account.issues).includes(p.needsImport ? 'seerr_missing' : 'seerr_drift');
  for (const p of planned.filter(takesRights)) await repair(p);

  // 4. Request rights of Seerr users the console does not manage (owner and staff excluded).
  let unmanaged = 0;
  for (const user of users) {
    if (!isUnmanagedRequester(user, managed)) continue;
    unmanaged++;
    if (writes >= MAX_SEERR_WRITES_PER_RUN) continue;
    writes++;
    const audited = {
      ...entry,
      action: 'media.seerr_revoke',
      details: { seerrUserId: user.id, jellyfinUserId: user.jellyfinUserId },
    };
    try {
      await adapter.setSeerrUserAccess!(
        user.id,
        {
          permissions: user.permissions & ~SEERR_REQUEST_BITS,
          movieQuotaLimit: user.movieQuotaLimit ?? 0,
          movieQuotaDays: user.movieQuotaDays ?? 0,
          tvQuotaLimit: user.tvQuotaLimit ?? 0,
          tvQuotaDays: user.tvQuotaDays ?? 0,
        },
        user,
      );
      counts.revoked++;
      await audit.record(null, audited);
    } catch (err) {
      counts.failed++;
      const error = errorMessage(err);
      const of = sql`${auditLogs.details} ->> 'seerrUserId' = ${String(user.id)}`;
      if (
        !(await sameFailure(db, 'media.seerr_revoke', { type: 'provider', id: connection.id, of }, error))
      ) {
        await audit.record(null, { ...audited, status: 'failure', details: { ...audited.details, error } });
      }
    }
  }

  const grants = planned.filter((p) => !takesRights(p));
  for (const p of grants.filter((p) => !failedBefore(p))) await repair(p);
  for (const p of rotated(grants.filter(failedBefore))) await repair(p);

  // 5. and 6. The numbers: requests per account, quota usage of the entitled accounts.
  try {
    lastError =
      (await refreshNumbers(db, connection.id, adapter, { users, byJellyfin }, requestsOf, counts, log)) ??
      lastError;
  } catch (err) {
    lastError = errorMessage(err).slice(0, 300);
    log?.warn({ err, provider: connection.name }, 'seerr numbers not refreshed');
  }

  // 7. The check of this run; orphans are counted by the live admin check only.
  await storeSeerrCheck(db, connection.id, {
    status: 'ok',
    lastError,
    lastCheck: stored(check, unmanaged),
    checkedAt: new Date(),
  });
  return counts;
}

/**
 * Step 0, while Seerr is switched off: seerr_missing means nothing any more and goes; seerr_drift
 * marks accounts whose request rights the switch-off could not take back (Seerr did not answer,
 * which is often why it was switched off). Those are taken now, confirmed against Seerr's list
 * like the switch-off does, at most MAX_SEERR_WRITES_PER_RUN writes, each audited as a repair
 * (orgId null: no organization sees requests while they are off). Done, the mark goes, unless the
 * account changed during the run or Seerr was switched on meanwhile; a failure keeps it for the
 * next run without another audit entry (the switch-off recorded it).
 */
async function finishRevocations(
  db: Database,
  connection: ProviderConnection,
  adapter: ProviderAdapter,
  audit: AuditService,
  entry: { resourceType: 'provider'; resourceId: string; actorName: string },
  counts: SeerrSyncCounts,
  started: Date,
  log?: Pick<FastifyBaseLogger, 'warn'>,
): Promise<void> {
  await stripSeerrMissingOf(db, connection.id);
  const pending = await db
    .select({
      id: mediaAccounts.id,
      username: mediaAccounts.username,
      externalId: mediaAccounts.externalId,
      seerrUserId: mediaAccounts.seerrUserId,
    })
    .from(mediaAccounts)
    .where(
      and(
        eq(mediaAccounts.providerConnectionId, connection.id),
        sql`${mediaAccounts.issues} ? 'seerr_drift'`,
      ),
    )
    .orderBy(mediaAccounts.username);
  if (pending.length === 0) return;
  let users: RemoteSeerrUser[];
  try {
    users = await adapter.listSeerrUsers!();
  } catch (err) {
    log?.warn({ err, provider: connection.name }, 'seerr revocations not retried');
    counts.failed += pending.length;
    return;
  }
  let writes = 0;
  for (const account of pending) {
    let done: SeerrRevocation;
    try {
      done = await revokeSeerrAccount(adapter, account, users, {
        withRightsOnly: true,
        mayWrite: () => writes++ < MAX_SEERR_WRITES_PER_RUN,
      });
    } catch {
      counts.failed++;
      continue;
    }
    if (done.outcome === 'deferred') continue;
    if (done.outcome === 'revoked') {
      counts.revoked++;
      await audit.record(null, {
        ...entry,
        action: 'media.seerr_repair',
        orgId: null,
        resourceType: 'media_account',
        resourceId: account.id,
        details: { username: account.username, fields: ['permissions'] },
      });
    }
    // Nothing left to take (the owner included, whom nobody changes): the mark goes.
    await db
      .update(mediaAccounts)
      .set({
        ...(done.stale ? { seerrUserId: done.stale.to } : {}),
        issues: replaceSeerrIssues([]),
      })
      .where(
        and(
          eq(mediaAccounts.id, account.id),
          lt(mediaAccounts.updatedAt, started),
          done.stale ? eq(mediaAccounts.seerrUserId, done.stale.from) : undefined,
          sql`not exists (select 1 from media_seerr s where s.provider_connection_id = ${connection.id} and s.enabled)`,
        ),
      );
  }
}

const sameIssues = (a: SeerrIssue[], b: SeerrIssue[]) =>
  a.length === b.length && a.every((i) => b.includes(i));

const storedSeerrIssues = (issues: readonly string[]) =>
  issues.filter((i): i is SeerrIssue => i === 'seerr_missing' || i === 'seerr_drift');

/** A managed account of step 3 with what its Seerr user should have. */
interface Planned {
  account: {
    id: string;
    externalId: string;
    username: string;
    orgId: string | null;
    issues: string[];
    seerrUserId: number | null;
  };
  /** Its Seerr user in the list of step 2. */
  user: RemoteSeerrUser | null;
  requests: MediaRequestsAccess | null;
  expected: SeerrUserAccess;
  fields: SeerrAccessDriftField[];
  needsImport: boolean;
}

/** `items` starting at a random one: every account gets its turn over the runs. */
function rotated<T>(items: T[]): T[] {
  const start = Math.floor(Math.random() * items.length);
  return [...items.slice(start), ...items.slice(0, start)];
}

/**
 * Whether the last entry of `action` for the resource (and `of`, e.g. one Seerr user of a
 * connection) is a failure with the same error.
 */
async function sameFailure(
  db: Database,
  action: 'media.seerr_repair' | 'media.seerr_revoke',
  resource: { type: string; id: string; of?: SQL },
  error: string,
): Promise<boolean> {
  const [last] = await db
    .select({ status: auditLogs.status, details: auditLogs.details })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.resourceType, resource.type),
        eq(auditLogs.resourceId, resource.id),
        eq(auditLogs.action, action),
        resource.of,
      ),
    )
    .orderBy(desc(auditLogs.id))
    .limit(1);
  return last?.status === 'failure' && last.details?.error === error;
}

/**
 * Steps 5 and 6. Numbers are not a change of the account: the rows keep their updatedAt. Returns
 * a note for last_error when the numbers could not all be refreshed.
 *
 * Stored ids are checked against the list of step 2 first (no extra request): an id that Seerr
 * lists with another Jellyfin id (an account a route changed during the run, so step 3 left it)
 * is stale and replaced by the account's user found by its Jellyfin id, so no account ever shows
 * or reads the numbers of someone else. Ids the list does not have are kept: step 3 or a route
 * may have imported them after the list was read.
 */
async function refreshNumbers(
  db: Database,
  connectionId: string,
  adapter: ProviderAdapter,
  seerr: { users: readonly RemoteSeerrUser[]; byJellyfin: ReadonlyMap<string, RemoteSeerrUser> },
  requestsOf: (orgId: string | null) => MediaRequestsAccess | null,
  counts: { counted: number },
  log?: Pick<FastifyBaseLogger, 'warn'>,
): Promise<string | null> {
  // Read again: step 3 imported some.
  const read = await db
    .select({
      id: mediaAccounts.id,
      externalId: mediaAccounts.externalId,
      orgId: mediaAccounts.orgId,
      enabled: mediaAccounts.enabled,
      missingSince: mediaAccounts.missingSince,
      seerrUserId: mediaAccounts.seerrUserId,
      seerrRequests: mediaAccounts.seerrRequests,
      seerrSyncedAt: mediaAccounts.seerrSyncedAt,
    })
    .from(mediaAccounts)
    .where(eq(mediaAccounts.providerConnectionId, connectionId));
  const keepDate = { updatedAt: sql`${mediaAccounts.updatedAt}` };
  const listed = new Map(seerr.users.map((user) => [user.id, user]));
  const rows: typeof read = [];
  for (const row of read) {
    const user = row.seerrUserId === null ? undefined : listed.get(row.seerrUserId);
    if (!user || user.jellyfinUserId === row.externalId) {
      rows.push(row);
      continue;
    }
    const seerrUserId = seerr.byJellyfin.get(row.externalId)?.id ?? null;
    // Only while the row still has the stale id (a route may store a confirmed one meanwhile).
    const [updated] = await db
      .update(mediaAccounts)
      .set({ seerrUserId, seerrRequests: null, seerrSyncedAt: null, ...keepDate })
      .where(and(eq(mediaAccounts.id, row.id), eq(mediaAccounts.seerrUserId, row.seerrUserId!)))
      .returning({ seerrUserId: mediaAccounts.seerrUserId });
    if (updated) rows.push({ ...row, seerrUserId, seerrRequests: null, seerrSyncedAt: null });
  }
  let note: string | null = null;

  const requestCounts = await adapter.seerrRequestCounts!();
  if (!requestCounts.complete) note = SEERR_COUNTS_INCOMPLETE;
  const numbers = new Map<string, MediaAccountRequestsDto>();
  const quotaReads: typeof rows = [];
  for (const row of rows) {
    if (row.seerrUserId === null) {
      // No Seerr user (any more): no numbers.
      if (row.seerrRequests) {
        await db
          .update(mediaAccounts)
          .set({ seerrRequests: null, seerrSyncedAt: null, ...keepDate })
          .where(eq(mediaAccounts.id, row.id));
      }
      continue;
    }
    const requests = requestsOf(row.orgId);
    const entitled =
      expectedSeerrAccess({ enabled: row.enabled, missing: !!row.missingSince, requests }).permissions > 0;
    const withQuota = entitled && !!(requests?.movieQuota || requests?.tvQuota);
    const before = row.seerrRequests;
    if (!requestCounts.complete && !before) continue;
    const found = requestCounts.complete ? requestCounts.byUser.get(row.seerrUserId) : undefined;
    const next: MediaAccountRequestsDto = {
      pending: requestCounts.complete ? (found?.pending ?? 0) : before!.pending,
      approved: requestCounts.complete ? (found?.approved ?? 0) : before!.approved,
      available: requestCounts.complete ? (found?.available ?? 0) : before!.available,
      movieUsed: withQuota && requests?.movieQuota ? (before?.movieUsed ?? null) : null,
      tvUsed: withQuota && requests?.tvQuota ? (before?.tvUsed ?? null) : null,
    };
    numbers.set(row.id, next);
    if (withQuota) quotaReads.push(row);
    if (requestCounts.complete) counts.counted++;
    await db
      .update(mediaAccounts)
      .set({
        seerrRequests: next,
        // Numbers without a quota are complete now; with one they are once the quota is read.
        ...(withQuota || !requestCounts.complete ? {} : { seerrSyncedAt: new Date() }),
        ...keepDate,
      })
      .where(eq(mediaAccounts.id, row.id));
  }

  const oldestFirst = quotaReads.sort(
    (a, b) => (a.seerrSyncedAt?.getTime() ?? 0) - (b.seerrSyncedAt?.getTime() ?? 0),
  );
  for (const row of oldestFirst.slice(0, SEERR_QUOTA_READS_PER_RUN)) {
    const requests = requestsOf(row.orgId);
    try {
      const usage = await adapter.seerrQuotaUsage!(row.seerrUserId!);
      const current = numbers.get(row.id)!;
      await db
        .update(mediaAccounts)
        .set({
          seerrRequests: {
            ...current,
            movieUsed: requests?.movieQuota ? usage.movieUsed : null,
            tvUsed: requests?.tvQuota ? usage.tvUsed : null,
          },
          seerrSyncedAt: new Date(),
          ...keepDate,
        })
        .where(eq(mediaAccounts.id, row.id));
    } catch (err) {
      log?.warn({ err, accountId: row.id }, 'seerr quota not read');
    }
  }
  return note;
}
