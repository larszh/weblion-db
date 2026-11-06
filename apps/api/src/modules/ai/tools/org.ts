import { z } from 'zod';
import type { AuditEntryDto, Paginated } from '@weblion/shared';
import { auditEntryBlocked, blockedOrgIds } from '../org-state';
import { consolePath, listOf, readFailure, slim, tool } from './types';

/** Organization, billing and audit tools (ai 8.3, 19 to 21). */

export const getOrgOverview = tool({
  name: 'get_org_overview',
  description: 'Name, kind, status, active modules and resource counts of the organization.',
  input: z.object({}),
  live: false,
  personal: false,
  routes: ['/orgs/:orgId'],
  async run(_input, { reader, org }) {
    const res = await reader.orgGet('');
    if (!res.ok) return readFailure(res);
    return { result: slim(res.body), sources: [{ path: consolePath(org), title: org.name }] };
  },
});

export const getBillingSummary = tool({
  name: 'get_billing_summary',
  description: 'Credit balance, open invoices and active services of the organization.',
  input: z.object({}),
  live: false,
  personal: false,
  routes: ['/orgs/:orgId/billing/summary', '/orgs/:orgId/invoices'],
  async run(_input, { reader, org }) {
    // Viewers lack billing:read: the route answers 403 and the model is told so.
    const summary = await reader.orgGet('billing/summary');
    if (!summary.ok) return readFailure(summary);
    const open = await reader.orgGet('invoices', { status: 'open', perPage: '20' });
    return {
      result: {
        summary: slim(summary.body),
        openInvoices: open.ok ? listOf(open.body) : { error: open.error },
      },
      sources: [{ path: consolePath(org, 'billing'), title: null }],
    };
  },
});

export const getAuditLog = tool({
  name: 'get_audit_log',
  description:
    'Newest audit log entries of the organization, filterable by action prefix, resource type and status. IP and e-mail addresses are removed.',
  input: z.object({
    action: z.string().max(100).nullable(),
    resource_type: z.string().max(50).nullable(),
    status: z.enum(['success', 'failure', 'denied']).nullable(),
  }),
  live: false,
  personal: true,
  routes: ['/orgs/:orgId/audit'],
  async run(input, { reader, org, ctx }) {
    const query: Record<string, string> = { perPage: '50' };
    if (input.action) query.action = input.action;
    if (input.resource_type) query.resourceType = input.resource_type;
    if (input.status) query.status = input.status;
    const res = await reader.orgGet<Paginated<AuditEntryDto>>('audit', query);
    if (!res.ok) return readFailure(res);
    // Blocked-customer filter (ai 8.3, review #4): entries of a reseller's log about a customer whose AI is off
    // never reach the model.
    const blocked = await blockedOrgIds(ctx.db);
    blocked.delete(org.id);
    const entries = res.body.items ?? [];
    const kept = entries.filter(
      (e) =>
        !auditEntryBlocked(
          { orgId: null, resourceType: e.resourceType, resourceId: e.resourceId, details: e.details },
          blocked,
        ),
    );
    return {
      result: { ...listOf(kept), hidden: entries.length - kept.length, totalInLog: res.body.total },
      sources: [{ path: consolePath(org, 'audit'), title: null }],
    };
  },
});
