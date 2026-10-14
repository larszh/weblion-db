import type { Tx } from '../../db/client';
import type { Organization } from '../../db/schema';

/**
 * A console monitor (origin "console") moves into an organization only with a monitoring
 * allowance on the monitor's instance, a free slot and a minimum interval the monitor meets (409
 * otherwise, under the organization's monitoring lock). Monitors found in Uptime Kuma (origin
 * "kuma") move freely. The reseller resource hand-over calls it inside its transaction, for the
 * customer on assign and for the reseller on release. Placeholder: every monitor moves.
 */
export async function assertMonitorMoveAllowed(
  _tx: Tx,
  _monitorId: string,
  _to: Pick<Organization, 'id' | 'parentOrgId' | 'kind'>,
): Promise<void> {}
