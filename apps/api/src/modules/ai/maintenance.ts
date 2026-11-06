import type pg from 'pg';
import type { AppContext } from '../../context';

/** Session lock of a maintenance run (plan 3.3): one process at a time marks stale rows and applies retention. */
export const AI_MAINTENANCE_LOCK = 742_005;

/**
 * Marks stale running ai_usage rows and applies the retention of usage rows (400 days) and error texts
 * (30 days), once 5 s after start and then every 10 minutes (ai 7.3). The foundation starts and stops it;
 * U3 implements the run.
 */
export class AiMaintenance {
  constructor(
    protected readonly ctx: AppContext,
    protected readonly pool: pg.Pool,
  ) {}

  start(): void {}

  stop(): void {}
}
