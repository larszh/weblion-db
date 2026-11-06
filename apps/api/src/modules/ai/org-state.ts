import { eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import type { AiOrgOffReason, AiOrgStateDto } from '@weblion/shared';
import type { DbOrTx } from '../../db/client';
import { organizations, users, type Organization } from '../../db/schema';

/**
 * The effective AI state of one organization (ai 5.5): its own switch (opt-in per customer, plan O34), the
 * customer's own decline and the reseller cascade (ai 3.4). The same three conditions that the boundary deny of
 * effectiveBoundary applies to members are checked here explicitly, so routes can answer ai_org_disabled with the
 * reasons, and staff (who pass every boundary) are stopped too.
 */

type OrgAiFields = Pick<
  Organization,
  'id' | 'name' | 'aiEnabled' | 'aiDisabledBy' | 'aiOptOutAt' | 'aiOptOutBy' | 'parentOrgId'
>;

/** The organization's own AI is usable: switched on and not declined. */
export function ownAiOn(org: Pick<Organization, 'aiEnabled' | 'aiOptOutAt'>): boolean {
  return org.aiEnabled && !org.aiOptOutAt;
}

/**
 * Reasons in the order of AiOrgOffReason (most binding first): declined, the own switch (who switched it off;
 * an organization that was never switched on has no `aiDisabledBy` and counts as 'platform', the default state
 * of plan O34, while `switch.by` stays null so the card can say "not switched on yet"), then the reseller.
 */
export function aiOrgState(
  org: OrgAiFields,
  parent: Pick<Organization, 'id' | 'name' | 'aiEnabled' | 'aiOptOutAt'> | null,
  declinedBy: { id: string; name: string } | null = null,
): AiOrgStateDto {
  const offReasons: AiOrgOffReason[] = [];
  if (org.aiOptOutAt) offReasons.push('declined');
  if (!org.aiEnabled) offReasons.push(org.aiDisabledBy === 'reseller' ? 'reseller' : 'platform');
  if (parent && !ownAiOn(parent)) offReasons.push('parent');
  return {
    enabled: offReasons.length === 0,
    offReasons,
    switch: { enabled: org.aiEnabled, by: org.aiEnabled ? null : (org.aiDisabledBy ?? null) },
    reseller: parent ? { id: parent.id, name: parent.name, enabled: ownAiOn(parent) } : null,
    declined: org.aiOptOutAt ? { at: org.aiOptOutAt.toISOString(), by: declinedBy } : null,
  };
}

/** The organization and its parent, or null when the organization does not exist. */
export async function loadOrgWithParent(
  db: DbOrTx,
  orgId: string,
): Promise<{ org: Organization; parent: Organization | null } | null> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org) return null;
  const parent = org.parentOrgId
    ? ((await db.select().from(organizations).where(eq(organizations.id, org.parentOrgId)))[0] ?? null)
    : null;
  return { org, parent };
}

/** aiOrgState with the name of the person who declined, for the switch cards. */
export async function orgStateDto(
  db: DbOrTx,
  org: Organization,
  parent: Organization | null,
): Promise<AiOrgStateDto> {
  let by: { id: string; name: string } | null = null;
  if (org.aiOptOutAt && org.aiOptOutBy) {
    const [user] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.id, org.aiOptOutBy));
    by = user ?? null;
  }
  return aiOrgState(org, parent, by);
}

/**
 * Every organization whose AI is off right now (aiOrgState(...).enabled false): switched off or never switched
 * on, declined, or a customer of such a reseller. One query; used by the blocked-customer filter of the audit
 * tool and the audit summaries (ai 8.3, 10.3, review #4).
 */
export async function blockedOrgIds(db: DbOrTx): Promise<Set<string>> {
  const rows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(
      or(
        sql`not ${organizations.aiEnabled}`,
        isNotNull(organizations.aiOptOutAt),
        inArray(
          organizations.parentOrgId,
          db
            .select({ id: organizations.id })
            .from(organizations)
            .where(or(sql`not ${organizations.aiEnabled}`, isNotNull(organizations.aiOptOutAt))),
        ),
      ),
    );
  return new Set(rows.map((r) => r.id));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Detail keys through which audit entries name another organization (reseller and billing entries). */
const ORG_DETAIL_KEYS = ['customerOrgId', 'customerId', 'orgId'] as const;

/**
 * The organizations an audit entry is about besides its own org_id: the resource of resourceType 'org' and the
 * organizations named in its details (reseller.customer_*, reseller.resource_*, the billing job).
 */
export function orgsNamedByAuditEntry(entry: {
  resourceType: string | null;
  resourceId: string | null;
  details: unknown;
}): string[] {
  const out: string[] = [];
  if (entry.resourceType === 'org' && entry.resourceId) out.push(entry.resourceId);
  const details = entry.details;
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    for (const key of ORG_DETAIL_KEYS) {
      const value = (details as Record<string, unknown>)[key];
      if (typeof value === 'string') out.push(value);
    }
  }
  // Only organization ids: free text in details is no reference.
  return out.filter((id) => UUID.test(id));
}

/** True when the entry concerns one of the blocked organizations (other than through its own org_id). */
export function auditEntryBlocked(
  entry: { orgId: string | null; resourceType: string | null; resourceId: string | null; details: unknown },
  blocked: ReadonlySet<string>,
): boolean {
  if (entry.orgId && blocked.has(entry.orgId)) return true;
  return orgsNamedByAuditEntry(entry).some((id) => blocked.has(id));
}
