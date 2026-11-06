import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import type pg from 'pg';
import type { AppContext } from '../context';

/** Session advisory lock that serializes claiming a translation job across API processes (plan 3.3). */
export const I18N_JOB_LOCK = 742_004;

export interface JobRunnerOptions {
  /** Injected for tests; default setTimeout-based sleep honouring the abort signal. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => Date;
  tickMs?: number; // 5,000
  heartbeatMs?: number; // 30,000
  /** A running job without heartbeat for this long is taken over. */
  staleAfterMs?: number; // 120,000
  concurrency?: number; // env I18N_AI_CONCURRENCY (1 to 4, default 2)
}

/**
 * Runs Mass Translate jobs (i18n 12.8). The foundation wires the class into the context and the process
 * lifecycle; start, stop and tick do nothing yet and requestCancel throws. U1 implements the runner.
 */
export class TranslationJobRunner {
  /** `${hostname}:${pid}:${random}`, so a restarted process never mistakes the old row for its own. */
  readonly instanceId = `${hostname()}:${process.pid}:${randomBytes(4).toString('hex')}`;

  constructor(
    protected readonly ctx: AppContext,
    protected readonly pool: pg.Pool,
    protected readonly options: JobRunnerOptions = {},
  ) {}

  /** Tick every tickMs, timers unref()ed, like BillingJob.start (modules/billing/recurring.ts). */
  start(): void {}

  /** Aborts in-flight calls, re-queues the job this runner owns (runner = null), clears the timers. */
  async stop(): Promise<void> {}

  /** One tick: claim under the advisory lock I18N_JOB_LOCK and run or resume a job. Exported for tests. */
  async tick(): Promise<void> {}

  /** B6: queued -> 'cancelled' at once; running -> cancel_requested, 'requested'; finished -> 'finished'. */
  async requestCancel(_jobId: string): Promise<'cancelled' | 'requested' | 'finished'> {
    throw new Error('not implemented');
  }
}
