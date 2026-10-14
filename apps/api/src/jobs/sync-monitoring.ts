import type { Database } from '../db/client';
import type { ProviderConnection } from '../db/schema';
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
 * is rethrown and the rows stay as they are. Placeholder until the sync is implemented.
 */
export async function syncMonitors(
  _db: Database,
  _connection: ProviderConnection,
  _adapter: ProviderAdapter,
): Promise<MonitorSyncCounts> {
  return { seen: 0, missing: 0, managementError: null };
}
