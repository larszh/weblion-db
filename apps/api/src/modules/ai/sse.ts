import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AiSseEvent } from '@weblion/shared';
import type { AppError } from '../../lib/errors';

/**
 * Server-sent events of the chat (ai 9.3): one frame per event, a ping comment every 15 s so proxies and browsers
 * keep the connection, an `error` event built from an AppError. After open() the reply is hijacked, so Fastify's
 * hooks (helmet included) add no headers: the writer sets the few the stream needs itself.
 */

const DEFAULT_PING_MS = 15_000;

export class SseWriter {
  /** Aborted when the client closes the connection. */
  readonly signal: AbortSignal;
  private readonly controller = new AbortController();
  private opened = false;
  private ended = false;
  private ping: NodeJS.Timeout | null = null;

  constructor(
    protected readonly req: FastifyRequest,
    protected readonly reply: FastifyReply,
    protected readonly opts: { pingMs?: number } = {},
  ) {
    this.signal = this.controller.signal;
  }

  /** True once the stream ended, by close() or because the client went away. */
  get closed(): boolean {
    return this.ended;
  }

  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.reply.hijack();
    const raw = this.reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // nginx must pass the frames on at once instead of buffering them (deployment notes, plan 9).
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    });
    // The response's close event, not the request's: in Node the request emits close once its body is read,
    // the response only when the connection ends (finished by us or dropped by the client).
    raw.on('close', () => {
      if (!this.ended) this.stop(true);
    });
    raw.write(': open\n\n');
    this.ping = setInterval(() => {
      if (!this.ended) raw.write(': ping\n\n');
    }, this.opts.pingMs ?? DEFAULT_PING_MS);
    this.ping.unref();
  }

  /** One frame; false and nothing written once closed. */
  send<E extends AiSseEvent['event']>(event: E, data: Extract<AiSseEvent, { event: E }>['data']): boolean {
    if (this.ended || !this.opened) return false;
    // JSON.stringify never emits a raw line break, so the data stays on one line.
    this.reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  }

  /** One `error` event with the fields of the JSON error body plus the status, then close() (ai 9.3). */
  error(err: AppError): void {
    this.send('error', {
      status: err.statusCode,
      code: err.code,
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
    this.close();
  }

  close(): void {
    if (this.ended) return;
    this.stop(false);
    if (this.opened) this.reply.raw.end();
  }

  private stop(clientGone: boolean): void {
    this.ended = true;
    if (this.ping) clearInterval(this.ping);
    this.ping = null;
    if (clientGone) this.controller.abort();
  }
}
