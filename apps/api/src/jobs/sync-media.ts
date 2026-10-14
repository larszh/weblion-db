import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import {
  expectedMediaPolicy,
  mediaPolicyDrift,
  type MediaLibraryRef,
  type MediaPolicyState,
} from '@weblion/shared';
import type { AuditService } from '../audit';
import type { Database } from '../db/client';
import { mediaAccounts, mediaAllowances, type MediaAllowance, type ProviderConnection } from '../db/schema';
import {
  MAX_REPAIRS_PER_RUN,
  errorMessage,
  mediaAccessOf,
  mediaAccountIssues,
  remoteMediaFields,
} from '../modules/media/service';
import type { ProviderAdapter, RemoteMediaUser } from '../providers/types';
import type { SyncCounts } from './sync';

/** Counts of a streaming account sync; repaired: policies written, repairFailed: refused writes. */
export interface MediaSyncCounts extends SyncCounts {
  repaired: number;
  repairFailed: number;
}

/**
 * Streaming accounts of a Jellyfin connection: one user list per run, known accounts updated
 * unless the console changed them during the run, vanished ones marked missing, policy drift
 * repaired (at most MAX_REPAIRS_PER_RUN writes per run, audited as "Sync"), library snapshots of
 * the allowances on the instance refreshed. Never imports, assigns or deletes.
 *
 * Only a failed user list throws (syncConnection marks the connection). Refused repairs are
 * counted and audited, the drift stays as an issue and the next run tries again.
 */
export async function syncMediaAccounts(
  db: Database,
  connection: ProviderConnection,
  adapter: ProviderAdapter,
  audit: AuditService,
  /** For the failures that do not stop the run; syncConnection may pass its logger. */
  log?: Pick<FastifyBaseLogger, 'warn'>,
): Promise<MediaSyncCounts> {
  const started = new Date();
  const remote = await adapter.listMediaUsers!();
  const byId = new Map(remote.map((user) => [user.externalId, user]));
  const rows = await db
    .select({
      id: mediaAccounts.id,
      externalId: mediaAccounts.externalId,
      username: mediaAccounts.username,
      orgId: mediaAccounts.orgId,
      createdAt: mediaAccounts.createdAt,
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
  const expectedByOrg = new Map<string, MediaPolicyState>(
    allowances.map((allowance) => [allowance.orgId, expectedMediaPolicy(mediaAccessOf(allowance))]),
  );

  const counts: MediaSyncCounts = { seen: 0, missing: 0, repaired: 0, repairFailed: 0 };
  const missing: string[] = [];
  for (const row of rows) {
    let user: RemoteMediaUser | undefined = byId.get(row.externalId);
    if (!user) {
      // Created through the console while the list was on its way: not missing.
      if (row.createdAt < started) missing.push(row.id);
      continue;
    }
    counts.seen++;
    const allowance = row.orgId ? byOrg.get(row.orgId) : undefined;
    const expected = row.orgId ? (expectedByOrg.get(row.orgId) ?? null) : null;
    const drift = expected ? mediaPolicyDrift(user.policy, expected) : [];
    // A route that changed the account or its allowance during the run writes the policy itself.
    if (
      expected &&
      allowance &&
      drift.length > 0 &&
      counts.repaired + counts.repairFailed < MAX_REPAIRS_PER_RUN &&
      row.updatedAt < started &&
      allowance.updatedAt < started
    ) {
      const entry = {
        action: 'media.policy_repair',
        orgId: row.orgId,
        resourceType: 'media_account',
        resourceId: row.id,
        actorName: 'Sync',
      };
      try {
        user = await adapter.setMediaUserPolicy!(row.externalId, expected);
        counts.repaired++;
        await audit.record(null, { ...entry, details: { username: user.username, fields: drift } });
      } catch (err) {
        counts.repairFailed++;
        await audit.record(null, {
          ...entry,
          status: 'failure',
          details: { username: user.username, fields: drift, error: errorMessage(err) },
        });
      }
    }
    const now = new Date();
    await db
      .update(mediaAccounts)
      .set(remoteMediaFields(user, mediaAccountIssues(user, expected, !!row.orgId), now))
      // Changed through the console while the list was on its way (e.g. disabled): the list has
      // the old state. The next run catches up.
      .where(and(eq(mediaAccounts.id, row.id), lt(mediaAccounts.updatedAt, started)));
  }
  if (missing.length > 0) {
    await db
      .update(mediaAccounts)
      .set({ missingSince: sql`coalesce(${mediaAccounts.missingSince}, now())` })
      .where(inArray(mediaAccounts.id, missing));
  }
  counts.missing = missing.length;

  if (allowances.length > 0 && adapter.listMediaLibraries) {
    // Not fatal: the snapshots only name the libraries, the next run tries again.
    await refreshLibrarySnapshots(db, allowances, adapter, started).catch((err: unknown) =>
      log?.warn({ err, provider: connection.name }, 'streaming library snapshots not refreshed'),
    );
  }
  return counts;
}

/**
 * Names and types of the libraries an allowance grants, as the instance has them now; ids the
 * instance no longer has are marked missing (and unmarked when they come back). Allowances a
 * route changed during the run are left to the next run.
 */
async function refreshLibrarySnapshots(
  db: Database,
  allowances: MediaAllowance[],
  adapter: ProviderAdapter,
  started: Date,
): Promise<void> {
  const libraries = new Map((await adapter.listMediaLibraries!()).map((library) => [library.id, library]));
  for (const allowance of allowances) {
    const next: MediaLibraryRef[] = allowance.libraries.map((ref) => {
      const found = libraries.get(ref.id);
      return found ? { id: ref.id, name: found.name, type: found.type } : { ...ref, missing: true };
    });
    if (sameSnapshot(next, allowance.libraries)) continue;
    await db
      .update(mediaAllowances)
      // Not a change of the allowance: it keeps its date.
      .set({ libraries: next, updatedAt: allowance.updatedAt })
      .where(and(eq(mediaAllowances.orgId, allowance.orgId), lt(mediaAllowances.updatedAt, started)));
  }
}

function sameSnapshot(a: MediaLibraryRef[], b: MediaLibraryRef[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (ref, i) =>
        ref.id === b[i]!.id &&
        ref.name === b[i]!.name &&
        ref.type === b[i]!.type &&
        !!ref.missing === !!b[i]!.missing,
    )
  );
}
