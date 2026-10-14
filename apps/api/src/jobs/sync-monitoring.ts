import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { monitors, type ProviderConnection } from '../db/schema';
import type { ProviderAdapter } from '../providers/types';
import type { SyncCounts } from './sync';

/** Counts of a monitor sync, plus the management error of the instance (the sync still succeeds). */
export interface MonitorSyncCounts extends SyncCounts {
  managementError: string | null;
}

/**
 * Monitors of an Uptime Kuma connection: new ones unassigned (origin "kuma"), known ones updated
 * unless the console changed them during the run, vanished ones marked missing (paused monitors
 * of an incomplete list stay paused). Nothing is deleted. When /metrics cannot be read the error
 * is rethrown and the rows stay as they are. A management error is returned, not logged
 * (syncConnection logs it).
 *
 * An incomplete inventory comes from /metrics alone: paused monitors are not in it, and after a
 * Kuma restart every monitor is missing until its first check. So a stored paused monitor stays
 * paused, and the others are marked missing ("not reported") without being deleted.
 */
export async function syncMonitors(
  db: Database,
  connection: ProviderConnection,
  adapter: ProviderAdapter,
): Promise<MonitorSyncCounts> {
  const started = new Date();
  const inventory = await adapter.listMonitors!();
  const now = new Date();
  const seen = new Set<string>();

  for (const remote of inventory.monitors) {
    seen.add(remote.externalId);
    // A complete list knows the group of every monitor; /metrics never reports one.
    const meta =
      remote.parentId !== null
        ? sql`${monitors.meta} || ${JSON.stringify({ parentId: remote.parentId })}::jsonb`
        : inventory.complete
          ? sql`${monitors.meta} - 'parentId'`
          : sql`${monitors.meta}`;
    await db
      .insert(monitors)
      .values({
        providerConnectionId: connection.id,
        externalId: remote.externalId,
        name: remote.name,
        providerName: remote.name,
        type: remote.type,
        target: remote.target,
        targetHost: remote.targetHost,
        status: remote.status,
        active: remote.active,
        intervalSeconds: remote.intervalSeconds,
        facts: remote.facts,
        meta: remote.parentId !== null ? { parentId: remote.parentId } : {},
        lastSyncedAt: now,
      })
      .onConflictDoUpdate({
        target: [monitors.providerConnectionId, monitors.externalId],
        set: {
          // Follows Kuma renames unless the monitor was renamed in the console.
          name: sql`case when ${monitors.name} = ${monitors.providerName} then excluded.provider_name else ${monitors.name} end`,
          providerName: sql`excluded.provider_name`,
          type: sql`excluded.type`,
          target: sql`excluded.target`,
          targetHost: sql`excluded.target_host`,
          status: sql`excluded.status`,
          facts: sql`excluded.facts`,
          // /metrics alone cannot tell whether a monitor is paused: unknown keeps what is stored.
          ...(inventory.complete || remote.active !== null ? { active: sql`excluded.active` } : {}),
          intervalSeconds: sql`coalesce(excluded.interval_seconds, ${monitors.intervalSeconds})`,
          meta,
          lastSyncedAt: now,
          missingSince: null,
        },
        // Changed in the console while the list was on its way (a pause, an edit): the list has
        // the old state. The next run catches up.
        setWhere: lt(monitors.updatedAt, started),
      });
  }

  const absent = (
    await db
      .select({ id: monitors.id, externalId: monitors.externalId, active: monitors.active })
      .from(monitors)
      .where(
        and(
          eq(monitors.providerConnectionId, connection.id),
          // Created or changed in the console while the list was on its way: not missing.
          lt(monitors.createdAt, started),
          lt(monitors.updatedAt, started),
        ),
      )
  ).filter((row) => !seen.has(row.externalId));

  // Without the management session a stored paused monitor is expected to be absent.
  const paused = inventory.complete ? [] : absent.filter((row) => row.active === false).map((row) => row.id);
  const gone = absent.filter((row) => inventory.complete || row.active !== false).map((row) => row.id);
  if (paused.length > 0) {
    await db
      .update(monitors)
      .set({ status: 'paused' })
      .where(and(inArray(monitors.id, paused), lt(monitors.updatedAt, started)));
  }
  let missing = 0;
  if (gone.length > 0) {
    const marked = await db
      .update(monitors)
      .set({ status: 'unknown', missingSince: sql`coalesce(${monitors.missingSince}, now())` })
      .where(and(inArray(monitors.id, gone), lt(monitors.updatedAt, started)))
      .returning({ id: monitors.id });
    missing = marked.length;
  }
  return { seen: inventory.monitors.length, missing, managementError: inventory.managementError };
}
