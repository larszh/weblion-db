import type pg from 'pg';
import type { AppContext } from '../../context';
import { staleAfterSeconds } from './usage';

/** Session lock of a maintenance run (plan 3.3): one process at a time marks stale rows and applies retention. */
export const AI_MAINTENANCE_LOCK = 742_005;

/** Usage rows are kept 400 days, their error texts 30 days (plan decision 22). */
export const AI_USAGE_RETENTION_DAYS = 400;
export const AI_ERROR_TEXT_RETENTION_DAYS = 30;

const FIRST_RUN_MS = 5_000;
const INTERVAL_MS = 10 * 60_000;

export interface MaintenanceResult {
  stale: number;
  deleted: number;
  errorTextsCleared: number;
}

/**
 * Marks stale running ai_usage rows and applies the retention of usage rows (400 days) and error texts
 * (30 days), once 5 s after start and then every 10 minutes (ai 7.3). Running it at start clears rows a crash or
 * deploy left behind before the first request arrives (review #8); a running row only counts as live for
 * AI_TURN_TIMEOUT_SECONDS + 60 s anyway (plan O29).
 */
export class AiMaintenance {
  private timers: NodeJS.Timeout[] = [];

  constructor(
    protected readonly ctx: AppContext,
    protected readonly pool: pg.Pool,
  ) {}

  /** One run under the session lock on a dedicated client; null when another process holds the lock. */
  async run(): Promise<MaintenanceResult | null> {
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query<{ locked: boolean }>('select pg_try_advisory_lock($1) as locked', [
        AI_MAINTENANCE_LOCK,
      ]);
      if (!rows[0]?.locked) return null;
      try {
        const stale = await client.query(
          `update ai_usage set status = 'stale', reserved_micros = 0, finished_at = now(),
             duration_ms = greatest(0, (extract(epoch from (now() - created_at)) * 1000)::integer)
           where status = 'running' and created_at < now() - make_interval(secs => $1::int)`,
          [staleAfterSeconds(this.ctx.env)],
        );
        const deleted = await client.query(
          `delete from ai_usage where created_at < now() - make_interval(days => $1::int)`,
          [AI_USAGE_RETENTION_DAYS],
        );
        const cleared = await client.query(
          `update ai_usage set error_message = null
           where error_message is not null and created_at < now() - make_interval(days => $1::int)`,
          [AI_ERROR_TEXT_RETENTION_DAYS],
        );
        const result = {
          stale: stale.rowCount ?? 0,
          deleted: deleted.rowCount ?? 0,
          errorTextsCleared: cleared.rowCount ?? 0,
        };
        if (result.stale || result.deleted || result.errorTextsCleared)
          this.ctx.log.info(result, 'ai maintenance');
        return result;
      } finally {
        await client.query('select pg_advisory_unlock($1)', [AI_MAINTENANCE_LOCK]);
      }
    } finally {
      client.release();
    }
  }

  start(): void {
    const tick = () => {
      this.run().catch((err) => this.ctx.log.warn({ err, job: 'ai-maintenance' }, 'scheduled job failed'));
    };
    this.timers.push(setTimeout(tick, FIRST_RUN_MS), setInterval(tick, INTERVAL_MS));
    for (const t of this.timers) t.unref();
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}
