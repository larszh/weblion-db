import type { Database } from '../db/client';
import type { ProviderConnection } from '../db/schema';
import type { ProviderAdapter } from '../providers/types';
import type { SyncCounts } from './sync';

/**
 * Phone systems of a connection (3CX: exactly one): facts and health stored, new ones
 * unassigned, vanished ones marked missing (they keep their organization). When the provider
 * cannot be read, every phone system of the connection becomes "unreachable" and the error is
 * rethrown. Placeholder until the sync is implemented.
 */
export async function syncPhoneSystems(
  _db: Database,
  _connection: ProviderConnection,
  _adapter: ProviderAdapter,
): Promise<SyncCounts> {
  return { seen: 0, missing: 0 };
}
