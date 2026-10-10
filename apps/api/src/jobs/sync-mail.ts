import type { Database } from '../db/client';
import type { ProviderConnection } from '../db/schema';
import type { ProviderAdapter } from '../providers/types';
import type { SyncCounts } from './sync';

/**
 * Mail domains of a Mailcow connection: one list call per run, new ones unassigned, vanished
 * ones marked missing. Placeholder until the sync is implemented.
 */
export async function syncMailDomains(
  _db: Database,
  _connection: ProviderConnection,
  _adapter: ProviderAdapter,
): Promise<SyncCounts> {
  return { seen: 0, missing: 0 };
}
