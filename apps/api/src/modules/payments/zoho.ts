import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { platformScope, requireAuth } from '../../auth/access';
import { invoices } from '../../db/schema';
import { conflict, notFound } from '../../lib/errors';
import { parse } from '../../lib/validation';
import { toInvoiceDto } from '../billing/dto';

const idParams = z.object({ id: z.uuid() });

/** Zoho Books: manual sync of one invoice, connection test and retrying what failed. */
export async function zohoRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, access, audit } = ctx;

  app.post('/invoices/:id/zoho-sync', async (req) => {
    const { id } = parse(idParams, req.params);
    requireAuth(req);
    await access.assert(req, 'platform:billing:write', platformScope);
    const invoice = await db.query.invoices.findFirst({ where: eq(invoices.id, id) });
    if (!invoice) throw notFound('Invoice');
    if (invoice.issuerOrgId) throw conflict('Only invoices issued by the platform go to Zoho Books');
    if (invoice.status === 'draft') throw conflict('Drafts are not synced, finalize the invoice first');
    if (!ctx.zoho.configured) throw conflict('Zoho Books is not set up');
    await ctx.zoho.syncInvoice(invoice.id);
    const synced = (await db.query.invoices.findFirst({ where: eq(invoices.id, id) }))!;
    await audit.record(req, {
      action: 'invoice.zoho_sync',
      orgId: invoice.orgId,
      resourceType: 'invoice',
      resourceId: invoice.id,
      status: synced.zohoStatus === 'error' ? 'failure' : 'success',
      details: { number: invoice.number, zohoStatus: synced.zohoStatus },
    });
    return toInvoiceDto(ctx, req, synced);
  });

  app.post('/admin/integrations/zoho/test', async (req) => {
    requireAuth(req);
    await access.assert(req, 'platform:settings', platformScope);
    const result = await ctx.zoho.testConnection();
    await audit.record(req, {
      action: 'integration.zoho_test',
      status: result.ok ? 'success' : 'failure',
      details: { error: result.error ?? null },
    });
    return result;
  });

  app.post('/admin/integrations/zoho/sync-pending', async (req) => {
    requireAuth(req);
    await access.assert(req, 'platform:billing:write', platformScope);
    if (!ctx.zoho.configured) throw conflict('Zoho Books is not set up');
    const result = await ctx.zoho.syncPending();
    await audit.record(req, {
      action: 'integration.zoho_sync_pending',
      status: result.failed > 0 ? 'failure' : 'success',
      details: result,
    });
    return result;
  });
}
