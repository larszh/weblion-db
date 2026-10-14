import { and, eq, notInArray, sql } from 'drizzle-orm';
import { phoneSystemHealth } from '@weblion/shared';
import type { Database } from '../db/client';
import { phoneSystems, type ProviderConnection } from '../db/schema';
import { storePhoneSystem } from '../modules/phone/service';
import type { ProviderAdapter, RemotePhoneSystem } from '../providers/types';
import type { SyncCounts } from './sync';

/**
 * Phone systems of a connection (3CX: exactly one): facts and health stored, new ones
 * unassigned, vanished ones marked missing (they keep their organization and status). When the
 * provider cannot be read, every phone system of the connection becomes "unreachable" with its
 * facts kept, and the error is rethrown (the connection becomes "error"). Users, ring groups and
 * trunks are not synced: the pages read them live.
 */
export async function syncPhoneSystems(
  db: Database,
  connection: ProviderConnection,
  adapter: ProviderAdapter,
): Promise<SyncCounts> {
  let remote: RemotePhoneSystem[];
  try {
    remote = await adapter.listPhoneSystems!();
  } catch (err) {
    await db
      .update(phoneSystems)
      .set({ status: 'error', statusReasons: ['unreachable'] })
      .where(eq(phoneSystems.providerConnectionId, connection.id));
    throw err;
  }
  const now = new Date();
  const rows = await db
    .select({ id: phoneSystems.id, externalId: phoneSystems.externalId })
    .from(phoneSystems)
    .where(eq(phoneSystems.providerConnectionId, connection.id));
  const known = new Map(rows.map((r) => [r.externalId, r.id]));

  for (const system of remote) {
    const id = known.get(system.externalId);
    if (id) {
      await storePhoneSystem(db, id, system, now);
      continue;
    }
    // Seen for the first time: unassigned. Without an answer from it there are no facts yet.
    const reachable = system.reachable !== false;
    const info = reachable ? system.info : null;
    const health = phoneSystemHealth(info, reachable, now);
    const [inserted] = await db
      .insert(phoneSystems)
      .values({
        providerConnectionId: connection.id,
        externalId: system.externalId,
        name: system.name,
        providerName: system.name,
        fqdn: info?.fqdn ?? null,
        status: health.status,
        statusReasons: health.reasons,
        info,
        lastSyncedAt: reachable ? now : null,
      })
      .onConflictDoNothing()
      .returning({ id: phoneSystems.id });
    if (inserted) {
      known.set(system.externalId, inserted.id);
    } else {
      // Inserted meanwhile by a parallel run: updated like a known one.
      const [existing] = await db
        .select({ id: phoneSystems.id })
        .from(phoneSystems)
        .where(
          and(
            eq(phoneSystems.providerConnectionId, connection.id),
            eq(phoneSystems.externalId, system.externalId),
          ),
        )
        .limit(1);
      if (existing) await storePhoneSystem(db, existing.id, system, now);
    }
  }

  const seenIds = [...new Set(remote.map((s) => s.externalId))];
  const missing = await db
    .update(phoneSystems)
    .set({ missingSince: sql`coalesce(${phoneSystems.missingSince}, now())` })
    .where(
      and(
        eq(phoneSystems.providerConnectionId, connection.id),
        seenIds.length > 0 ? notInArray(phoneSystems.externalId, seenIds) : undefined,
      ),
    )
    .returning({ id: phoneSystems.id });
  return { seen: seenIds.length, missing: missing.length };
}
