import type { FastifyBaseLogger } from 'fastify';
import type { Env } from '../config/env';
import type { Database } from '../db/client';

/**
 * PLACEHOLDER: replaced by the Zoho Books integration (OAuth refresh token flow, contacts,
 * invoices, customer payments). Sync calls are fire-and-forget: they record their outcome
 * on the invoice (zohoStatus/zohoError) or payment and never throw into the caller.
 */
export class ZohoService {
  constructor(
    private readonly db: Database,
    private readonly env: Env,
    private readonly log: FastifyBaseLogger,
  ) {}

  get configured(): boolean {
    return false;
  }

  /** Pushes a finalized platform invoice (and its contact) to Zoho Books. */
  async syncInvoice(_invoiceId: string): Promise<void> {}

  /** Pushes a succeeded payment of a platform invoice to Zoho Books. */
  async syncPayment(_paymentId: string): Promise<void> {}

  /** Marks an invoice as void in Zoho Books. */
  async voidInvoice(_invoiceId: string): Promise<void> {}
}
