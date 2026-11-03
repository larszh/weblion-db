import { and, eq, lt, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import {
  MEDIA_SEERR_FIXABLE,
  type MediaAccountRequestsDto,
  type MediaRequestsAccess,
  type MediaSeerrCheck,
} from '@weblion/shared';
import type { AuditService } from '../audit';
import type { Database } from '../db/client';
import { mediaAccounts, mediaAllowances, mediaSeerr, type ProviderConnection } from '../db/schema';
import { runStart } from '../lib/clock';
import {
  expectedSeerrAccess,
  isUnmanagedRequester,
  reconcileSeerr,
  seerrAccessDrift,
  seerrSettingsOf,
  seerrStatusOf,
  seerrSyncEnv,
  storeSeerrCheck,
  stripSeerrIssuesOf,
  type SeerrOutcome,
} from '../modules/media/seerr';
import { errorMessage, mediaRequestsOf, replaceSeerrIssues, type SeerrIssue } from '../modules/media/service';
import { SEERR_OWNER_ID, SEERR_REQUEST_BITS } from '../providers/seerr/rules';
import type { ProviderAdapter, RemoteSeerrUser, SeerrCheckResult } from '../providers/types';

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
  // 0. Switched off: the Seerr issues mean nothing any more.
  if (!row?.enabled) {
    await stripSeerrIssuesOf(db, connection.id);
    return counts;
  }
  const entry = { resourceType: 'provider', resourceId: connection.id, actorName: SYNC } as const;
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
    // Seerr's owner is never changed; its drift stays visible.
    const needsWrite = needsImport || (fields.length > 0 && user!.id !== SEERR_OWNER_ID);
    const orgId = requests ? account.orgId : null;
    const audited = {
      ...entry,
      action: 'media.seerr_repair',
      orgId,
      resourceType: 'media_account',
      resourceId: account.id,
    };
    if (needsWrite && writes < MAX_SEERR_WRITES_PER_RUN) {
      writes++;
      const what = needsImport ? { imported: true } : { fields };
      const result = await reconcileSeerr(env, account.id, user).catch((err: unknown) => ({
        outcome: { error: errorMessage(err) } as SeerrOutcome,
        wrote: 'none' as const,
      }));
      if (typeof result.outcome === 'object') {
        counts.failed++;
        await audit.record(null, {
          ...audited,
          status: 'failure',
          details: { username: account.username, ...what, error: result.outcome.error },
        });
      } else if (result.outcome === 'ok' && result.wrote !== 'none') {
        if (result.wrote === 'import') counts.imported++;
        else counts.repaired++;
        await audit.record(null, { ...audited, details: { username: account.username, ...what } });
      }
      continue;
    }
    // Nothing to write (or no budget left): the stored id and issues follow what Seerr has.
    const issues: SeerrIssue[] = needsImport ? ['seerr_missing'] : fields.length > 0 ? ['seerr_drift'] : [];
    const seerrUserId = user?.id ?? null;
    const storedIssues = account.issues.filter(
      (i): i is SeerrIssue => i === 'seerr_missing' || i === 'seerr_drift',
    );
    if (seerrUserId === account.seerrUserId && sameIssues(storedIssues, issues)) continue;
    await db
      .update(mediaAccounts)
      .set({ seerrUserId, issues: replaceSeerrIssues(issues) })
      .where(and(eq(mediaAccounts.id, account.id), lt(mediaAccounts.updatedAt, started)));
  }

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
      await audit.record(null, {
        ...audited,
        status: 'failure',
        details: { ...audited.details, error: errorMessage(err) },
      });
    }
  }

  // 5. and 6. The numbers: requests per account, quota usage of the entitled accounts.
  try {
    lastError = (await refreshNumbers(db, connection.id, adapter, requestsOf, counts, log)) ?? lastError;
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

const sameIssues = (a: SeerrIssue[], b: SeerrIssue[]) =>
  a.length === b.length && a.every((i) => b.includes(i));

/**
 * Steps 5 and 6. Numbers are not a change of the account: the rows keep their updatedAt. Returns
 * a note for last_error when the numbers could not all be refreshed.
 */
async function refreshNumbers(
  db: Database,
  connectionId: string,
  adapter: ProviderAdapter,
  requestsOf: (orgId: string | null) => MediaRequestsAccess | null,
  counts: { counted: number },
  log?: Pick<FastifyBaseLogger, 'warn'>,
): Promise<string | null> {
  // Read again: step 3 imported some.
  const rows = await db
    .select({
      id: mediaAccounts.id,
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
