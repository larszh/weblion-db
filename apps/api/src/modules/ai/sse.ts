import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AiSseEvent } from '@weblion/shared';
import type { AppError } from '../../lib/errors';

/**
 * Server-sent events of the chat (ai 9.3): one frame per event, a ping comment every 15 s, an `error` event
 * built from an AppError. The foundation declares the members; U3 implements them.
 */
export class SseWriter {
  /** Aborted when the client closes the connection. */
  readonly signal: AbortSignal;
  private readonly controller = new AbortController();

  constructor(
    protected readonly req: FastifyRequest,
    protected readonly reply: FastifyReply,
    protected readonly opts: { pingMs?: number } = {},
  ) {
    this.signal = this.controller.signal;
  }

  get closed(): boolean {
    throw new Error('not implemented');
  }

  open(): void {
    throw new Error('not implemented');
  }

  send<E extends AiSseEvent['event']>(_event: E, _data: Extract<AiSseEvent, { event: E }>['data']): boolean {
    throw new Error('not implemented');
  }

  error(_err: AppError): void {
    throw new Error('not implemented');
  }

  close(): void {
    throw new Error('not implemented');
  }
}
