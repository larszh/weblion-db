import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { AppError, ProviderError } from '../../lib/errors';
import { isRecord } from '../http';
import type { WireOps } from '../types';
import {
  OP_TIMEOUT_MS,
  PROVIDER,
  buildRequest,
  parseAnswer,
  parseData,
  redactSecrets,
  type WireOp,
} from './protocol';
import type { SshTransport } from './ssh';

/** Calls waiting behind the running one before the client answers "busy". */
const MAX_QUEUE = 20;
const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

/** Where failed operations are reported. Never receives a secret. */
export interface CloudPanelLog {
  warn(details: Record<string, unknown>, message: string): void;
}

let fallbackLog: CloudPanelLog | null = null;

/**
 * Adapters are built by the provider registry, which has no logger to hand over: they log
 * through their own pino instance at the level of LOG_LEVEL, like the API's logger.
 */
export function defaultCloudPanelLog(): CloudPanelLog {
  if (!fallbackLog) {
    const level = process.env.LOG_LEVEL;
    fallbackLog = pino({
      name: 'cloudpanel',
      level: level && LOG_LEVELS.includes(level) ? level : 'info',
    });
  }
  return fallbackLog;
}

export interface CloudPanelClientOptions {
  /** Default 20. */
  maxQueue?: number;
  /** Server name for messages. */
  host?: string;
  log?: CloudPanelLog;
}

/** Secrets of a request as a list, for redaction. */
function secretList(secrets: Record<string, unknown> | undefined): string[] {
  return Object.values(secrets ?? {}).filter((v): v is string => typeof v === 'string' && v !== '');
}

/**
 * The error as it may leave the client: messages and outputs redacted with the request's
 * secrets and the known password patterns, anything that is no AppError wrapped.
 */
function scrubError(err: unknown, secrets: readonly string[]): AppError {
  if (err instanceof AppError) {
    err.message = redactSecrets(err.message, secrets);
    if (isRecord(err.details) && typeof err.details.output === 'string') {
      err.details.output = redactSecrets(err.details.output, secrets);
    }
    return err;
  }
  const message = err instanceof Error ? err.message : String(err);
  return new ProviderError(PROVIDER, redactSecrets(message, secrets));
}

/**
 * The wire protocol over one SSH transport: one operation at a time (the agent serializes
 * changes with a lock anyway, and a CloudPanel server should not see a burst of SSH logins),
 * at most `maxQueue` waiting, every answer checked against the operation's schema.
 */
export class CloudPanelClient {
  private tail: Promise<unknown> = Promise.resolve();
  /** Running plus waiting calls. */
  private pending = 0;
  private readonly maxQueue: number;
  private readonly host: string;
  private readonly log: CloudPanelLog;

  constructor(
    private readonly transport: SshTransport,
    options: CloudPanelClientOptions = {},
  ) {
    this.maxQueue = options.maxQueue ?? MAX_QUEUE;
    this.host = options.host ?? 'the server';
    this.log = options.log ?? defaultCloudPanelLog();
  }

  async call<Op extends WireOp>(
    op: Op,
    args: WireOps[Op]['args'],
    secrets?: WireOps[Op]['secrets'],
  ): Promise<WireOps[Op]['data']> {
    if (this.pending > this.maxQueue) {
      throw new AppError(503, 'busy', 'The CloudPanel server is busy, try again in a minute');
    }
    this.pending++;
    const run = this.tail.then(() => this.send(op, args, secrets));
    // The next call waits for this one, whatever its outcome.
    this.tail = run.catch(() => undefined);
    try {
      return await run;
    } finally {
      this.pending--;
    }
  }

  close(): void {
    this.transport.close();
  }

  private async send<Op extends WireOp>(
    op: Op,
    args: WireOps[Op]['args'],
    secrets: WireOps[Op]['secrets'] | undefined,
  ): Promise<WireOps[Op]['data']> {
    const values = secretList(secrets as Record<string, unknown> | undefined);
    const requestId = randomUUID();
    const started = Date.now();
    try {
      const line = buildRequest(op, args, secrets, requestId);
      const result = await this.transport.exec(line, OP_TIMEOUT_MS[op]);
      const data = parseData(op, parseAnswer(result, values, this.host), this.host);
      // Warnings quote server output (a failed database step), so they are redacted like errors.
      const record = data as Record<string, unknown>;
      if (Array.isArray(record.warnings)) {
        record.warnings = record.warnings.map((w) => redactSecrets(String(w), values));
      }
      return data;
    } catch (err) {
      const error = scrubError(err, values);
      this.log.warn(
        {
          provider: PROVIDER,
          host: this.host,
          op,
          requestId,
          status: error.statusCode,
          code: error.code,
          ms: Date.now() - started,
          error: error.message.slice(0, 500),
        },
        'CloudPanel operation failed',
      );
      throw error;
    }
  }
}
