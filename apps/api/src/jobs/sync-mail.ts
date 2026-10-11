import { and, eq, lt, notInArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { mailDomains, type ProviderConnection } from '../db/schema';
import type { ProviderAdapter, RemoteMailDomain } from '../providers/types';
import type { SyncCounts } from './sync';

/**
 * Mail domains of a Mailcow connection: one list call per run (rate limit friendly; mailboxes,
 * aliases and DKIM keys are read on demand), new ones unassigned, vanished ones marked missing
 * with their organization kept. A row the panel changed while the list was on its way (a limit
 * change, a creation) keeps its fresher values until the next run.
 */
export async function syncMailDomains(
  db: Database,
  connection: ProviderConnection,
  adapter: ProviderAdapter,
): Promise<SyncCounts> {
  const started = new Date();
  const remote: RemoteMailDomain[] = await adapter.listMailDomains!();
  const now = new Date();
  for (const domain of remote) {
    await db
      .insert(mailDomains)
      .values({
        providerConnectionId: connection.id,
        externalId: domain.externalId,
        name: domain.info.displayName,
        active: domain.info.active,
        info: domain.info,
        lastSyncedAt: now,
      })
      .onConflictDoUpdate({
        target: [mailDomains.providerConnectionId, mailDomains.externalId],
        set: {
          name: sql`excluded.name`,
          active: sql`excluded.active`,
          info: sql`excluded.info`,
          lastSyncedAt: now,
          missingSince: null,
        },
        setWhere: lt(mailDomains.updatedAt, started),
      });
  }
  const seenIds = remote.map((d) => d.externalId);
  const missing = await db
    .update(mailDomains)
    .set({ missingSince: sql`coalesce(${mailDomains.missingSince}, now())` })
    .where(
      and(
        eq(mailDomains.providerConnectionId, connection.id),
        seenIds.length > 0 ? notInArray(mailDomains.externalId, seenIds) : undefined,
        // Created through the panel while the list was on its way: not missing.
        lt(mailDomains.createdAt, started),
      ),
    )
    .returning({ id: mailDomains.id });
  return { seen: remote.length, missing: missing.length };
}
