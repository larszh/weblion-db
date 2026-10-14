import { and, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { webspaces, type ProviderConnection } from '../db/schema';
import {
  STALE_CHANGE_MS,
  applyRemoteWebsite,
  syncWebsiteDatabases,
  toWebspaceInfo,
  websiteDisplayName,
  websiteServerAddress,
} from '../modules/hosting/website-service';
import type { ProviderAdapter } from '../providers/types';
import type { SyncCounts } from './sync';

/**
 * Websites of a CloudPanel connection: the managed sites of the server, new ones unassigned,
 * vanished ones marked missing, unfinished creations settled. Only rows of kind "website";
 * organizations are never assigned and active rows never deleted here.
 *
 * Rows a route changed after the server was asked (updatedAt after `started`) keep their
 * fresher state: a website created or deleted while the list was on its way is neither
 * overwritten nor taken as missing. `databases` counts the databases of the listed sites.
 */
export async function syncWebsites(
  db: Database,
  connection: ProviderConnection,
  adapter: ProviderAdapter,
): Promise<SyncCounts & { databases: number }> {
  const started = new Date();
  const remote = await adapter.listWebsites!();
  // Only for new rows and their info; an unreachable options call keeps the stored address.
  const ipAddress = (await websiteServerAddress(adapter)) ?? undefined;
  const rows = await db
    .select()
    .from(webspaces)
    .where(and(eq(webspaces.providerConnectionId, connection.id), eq(webspaces.kind, 'website')));
  const byDomain = new Map(rows.map((r) => [r.externalId, r]));
  const stale = new Date(started.getTime() - STALE_CHANGE_MS);
  let databases = 0;

  for (const site of remote) {
    databases += site.databases.length;
    const row = byDomain.get(site.domain);
    if (!row) {
      // Adopted on the server, or created there by the console and the row was lost: unassigned.
      const [inserted] = await db
        .insert(webspaces)
        .values({
          providerConnectionId: connection.id,
          externalId: site.domain,
          name: websiteDisplayName(site.domain),
          kind: 'website',
          status: 'active',
          info: toWebspaceInfo(site, ipAddress ?? null),
          lastSyncedAt: new Date(),
        })
        // A row a route inserted meanwhile (or a web space row of this id) stays as it is.
        .onConflictDoNothing()
        .returning();
      if (inserted) {
        await syncWebsiteDatabases(db, inserted.id, connection.id, site, started);
      }
      continue;
    }
    // A creation still on its way (or a deletion) is finished by its route. An "error" row the
    // server has is active (a creation that lost its answer keeps credentialsDelivered: false
    // from its route). A creation stuck in "creating" for longer than any answer takes lost its
    // route: the site exists, nobody saw its password.
    const lost = row.status === 'creating' && row.updatedAt < stale;
    if (row.status !== 'active' && row.status !== 'error' && !lost) continue;
    await applyRemoteWebsite(db, row, site, {
      since: started,
      ipAddress,
      ...(row.status !== 'active' ? { status: 'active' as const, credentialsPending: lost } : {}),
      where: and(lt(webspaces.updatedAt, started), eq(webspaces.status, row.status)),
    });
  }

  const listed = new Set(remote.map((s) => s.domain));
  const absent = rows.filter((r) => !listed.has(r.externalId));
  const gone = absent.filter((r) => r.status === 'active').map((r) => r.id);
  let missing = 0;
  if (gone.length > 0) {
    const marked = await db
      .update(webspaces)
      .set({ missingSince: sql`coalesce(${webspaces.missingSince}, now())` })
      .where(
        and(
          inArray(webspaces.id, gone),
          eq(webspaces.status, 'active'),
          lt(webspaces.createdAt, started),
          lt(webspaces.updatedAt, started),
        ),
      )
      .returning({ id: webspaces.id });
    missing = marked.length;
  }
  // Creations that never happened on the server (their databases cascade). Deletions are left
  // to their route.
  const unfinished = absent.filter((r) => r.status === 'creating' || r.status === 'error').map((r) => r.id);
  if (unfinished.length > 0) {
    await db
      .delete(webspaces)
      .where(
        and(
          inArray(webspaces.id, unfinished),
          or(eq(webspaces.status, 'creating'), eq(webspaces.status, 'error')),
          lt(webspaces.createdAt, stale),
          lt(webspaces.updatedAt, started),
        ),
      );
  }
  return { seen: remote.length, missing, databases };
}
