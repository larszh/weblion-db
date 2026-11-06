import { z } from 'zod';
import type { AiAuditPeriod, AiAuditSummaryResult, AuditEntryDto, Paginated } from '@weblion/shared';
import type { AppContext } from '../../../context';
import { queryAudit } from '../../audit/routes';
import { auditEntryBlocked, blockedOrgIds } from '../org-state';
import { thirdParty } from '../prompts';
import type { ConsoleReader } from '../reader';
import { callFeature, userTurn, type FeatureRun } from './common';

/**
 * Summary of a period of an audit log (ai 10.3). The audit API has no date filter, so the newest pages of 200 are
 * read until the first entry older than the period start, at most 500 entries go to the model (`cut`). Personal
 * fields go (plan O28), and entries about an organization whose AI is off are left out (review #4, `hidden`).
 */

export const auditSummaryOutput = z.object({
  summary: z.string(),
  highlights: z.array(z.object({ text: z.string(), audit_ids: z.array(z.string()) })),
  unusual: z.array(z.object({ text: z.string(), audit_ids: z.array(z.string()) })),
});

export const auditFilters = {
  period: z.enum(['day', 'week', 'month']),
  action: z.string().max(100).nullable(),
  resourceType: z.string().max(50).nullable(),
  status: z.enum(['success', 'failure', 'denied']).nullable(),
};

const PERIOD_DAYS: Record<AiAuditPeriod, number> = { day: 1, week: 7, month: 30 };
const PAGE = 200;
const MAX_ENTRIES = 500;
/** Pages read at most; a busy log of a month can be long, the summary covers the newest entries. */
const MAX_PAGES = 10;

export interface AuditFilter {
  period: AiAuditPeriod;
  action: string | null;
  resourceType: string | null;
  status: 'success' | 'failure' | 'denied' | null;
}

type PageReader = (page: number) => Promise<Paginated<AuditEntryDto> | null>;

/** The entries of the period, newest first: at most 500, `cut` when the period held more. */
async function collect(read: PageReader, filter: AuditFilter) {
  const since = Date.now() - PERIOD_DAYS[filter.period] * 86_400_000;
  const entries: AuditEntryDto[] = [];
  let cut = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await read(page);
    if (!result) break;
    let older = false;
    for (const entry of result.items) {
      if (new Date(entry.createdAt).getTime() < since) {
        older = true;
        break;
      }
      entries.push(entry);
    }
    if (older || result.items.length < PAGE) break;
    if (page === MAX_PAGES) cut = true;
  }
  if (entries.length > MAX_ENTRIES) cut = true;
  return { entries, cut };
}

/** Drops entries about organizations whose AI is off; `own` (the log's organization) is never dropped. */
async function filterBlocked(ctx: AppContext, entries: AuditEntryDto[], own: string | null) {
  const blocked = await blockedOrgIds(ctx.db);
  if (own) blocked.delete(own);
  const kept = entries.filter(
    (e) =>
      !auditEntryBlocked(
        {
          orgId: e.org?.id ?? null,
          resourceType: e.resourceType,
          resourceId: e.resourceId,
          details: e.details,
        },
        blocked,
      ),
  );
  return { kept, hidden: entries.length - kept.length };
}

async function summarize(
  run: FeatureRun,
  filter: AuditFilter,
  collected: { entries: AuditEntryDto[]; cut: boolean },
  own: string | null,
): Promise<AiAuditSummaryResult> {
  const { kept, hidden } = await filterBlocked(run.ctx, collected.entries, own);
  const sent = kept.slice(0, MAX_ENTRIES);
  const cut = collected.cut || kept.length > MAX_ENTRIES;
  // The IP is never sent; actor names stay (a summary must say who did what, the notice says so).
  const payload = {
    period: filter.period,
    filters: { action: filter.action, resourceType: filter.resourceType, status: filter.status },
    cut,
    entries: sent.map(({ ip: _ip, ...e }) => ({
      ...e,
      org: e.org ? { id: e.org.id, name: e.org.name } : null,
    })),
  };
  const user = userTurn(
    run,
    null,
    'Summarize these audit log entries.',
    thirdParty('audit_entries', payload, { personal: true }),
  );
  const { data, meta } = await callFeature(run, 'audit_summary', user, auditSummaryOutput);
  const ids = new Set(sent.map((e) => e.id));
  const refs = (list: Array<{ text: string; audit_ids: string[] }>) =>
    list.slice(0, 10).map((h) => ({ text: h.text, auditIds: h.audit_ids.filter((id) => ids.has(id)) }));
  return {
    summary: data.summary,
    highlights: refs(data.highlights),
    unusual: refs(data.unusual),
    entries: sent.length,
    cut,
    hidden,
    meta,
  };
}

/** POST /orgs/:orgId/ai/audit-summary: the organization's log through its own route (audit:read). */
export async function orgAuditSummary(
  run: FeatureRun & { orgId: string },
  reader: ConsoleReader,
  filter: AuditFilter,
): Promise<AiAuditSummaryResult> {
  const query: Record<string, string> = { perPage: String(PAGE) };
  if (filter.action) query.action = filter.action;
  if (filter.resourceType) query.resourceType = filter.resourceType;
  if (filter.status) query.status = filter.status;
  const collected = await collect(async (page) => {
    const res = await reader.orgGet<Paginated<AuditEntryDto>>('audit', { ...query, page: String(page) });
    return res.ok ? res.body : null;
  }, filter);
  return summarize(run, filter, collected, run.orgId);
}

/** POST /admin/ai/audit-summary: the platform log, or one organization's (assertOrgData by the route). */
export async function adminAuditSummary(
  run: FeatureRun,
  filter: AuditFilter,
  orgId: string | null,
): Promise<AiAuditSummaryResult> {
  const collected = await collect(
    (page) =>
      queryAudit(
        run.ctx,
        {
          page,
          perPage: PAGE,
          action: filter.action ?? undefined,
          resourceType: filter.resourceType ?? undefined,
          status: filter.status ?? undefined,
        },
        orgId,
      ),
    filter,
  );
  return summarize(run, filter, collected, orgId);
}
