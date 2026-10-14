import type { AuditService } from '../audit';
import type { Database } from '../db/client';
import type { ProviderConnection } from '../db/schema';
import type { ProviderAdapter } from '../providers/types';
import type { SyncCounts } from './sync';

/** Counts of a streaming account sync; repaired: policies written, repairFailed: refused writes. */
export interface MediaSyncCounts extends SyncCounts {
  repaired: number;
  repairFailed: number;
}

/**
 * Streaming accounts of a Jellyfin connection: one user list per run, known accounts updated
 * unless the console changed them during the run, vanished ones marked missing, policy drift
 * repaired (a limited number per run, audited as "Sync"), library snapshots of the allowances on
 * the instance refreshed. Never imports, assigns or deletes. Placeholder until the sync is
 * implemented.
 */
export async function syncMediaAccounts(
  _db: Database,
  _connection: ProviderConnection,
  _adapter: ProviderAdapter,
  _audit: AuditService,
): Promise<MediaSyncCounts> {
  return { seen: 0, missing: 0, repaired: 0, repairFailed: 0 };
}
