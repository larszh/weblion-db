import type { Database } from '../db/client';
import type { ProviderConnection } from '../db/schema';
import type { ProviderAdapter } from '../providers/types';
import type { SyncCounts } from './sync';

/**
 * Websites of a CloudPanel connection: the managed sites of the server, new ones unassigned,
 * vanished ones marked missing, unfinished creations settled. Only rows of kind "website".
 * Placeholder until the sync is implemented.
 */
export async function syncWebsites(
  _db: Database,
  _connection: ProviderConnection,
  _adapter: ProviderAdapter,
): Promise<SyncCounts & { databases: number }> {
  return { seen: 0, missing: 0, databases: 0 };
}
