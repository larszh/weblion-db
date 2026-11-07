import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can, type AdminOrgAiDto, type OrgAiDto, type ResellerCustomerAiDto } from '@weblion/shared';
import type { AppContext } from '../../context';
import { orgScope, platformScope, requireSession } from '../../auth/access';
import { organizations, type Organization } from '../../db/schema';
import { badRequest, notFound } from '../../lib/errors';
import { parse } from '../../lib/validation';
import { loadOrg } from '../orgs/routes';
import { aiDeclineOrgOnly, aiPlatformLocked, aiResellerBlocked } from './errors';
import { loadOrgWithParent, orgStateDto, ownAiOn } from './org-state';
import { orgUsage } from './report';

/**
 * The per-organization switches (ai 5.5, plan O34): the customer's own decline (ai:settings), the staff switch
 * on the admin customer page and the reseller's switch for its customers. AI is opt-in per customer: switching
 * a customer on needs the confirmation that the customer agreed (contract or AVV addendum), recorded in the
 * audit log. None of these routes asks whether AI is available: they work before go-live, while the platform is
 * off and while the organization is suspended (plan O27).
 */

const orgParams = z.object({ orgId: z.uuid() });
const customerParams = z.object({ orgId: z.uuid(), customerId: z.uuid() });
const declineBody = z.object({ declined: z.boolean() });
const switchBody = z.object({ enabled: z.boolean(), consentConfirmed: z.boolean().optional() });

/** enabled: true needs consentConfirmed: true (plan O34): 400 bad_request with details.field. */
function parseSwitch(body: unknown): { enabled: boolean; consentConfirmed: boolean } {
  const parsed = parse(switchBody, body);
  if (parsed.enabled && parsed.consentConfirmed !== true) {
    throw badRequest('Switching AI on for a customer needs the confirmation that the customer agreed', {
      field: 'consentConfirmed',
    });
  }
  return { enabled: parsed.enabled, consentConfirmed: parsed.consentConfirmed === true };
}

export async function aiOrgRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, access, audit } = ctx;

  /** The card's data: state, platform availability and this month's request counts (never costs). */
  async function orgAiDto(org: Organization): Promise<OrgAiDto & { usageCostMicros: number }> {
    const loaded = await loadOrgWithParent(db, org.id);
    const current = loaded?.org ?? org;
    const [state, platform, used] = await Promise.all([
      orgStateDto(db, current, loaded?.parent ?? null),
      ctx.ai.availability(),
      orgUsage(db, org.id),
    ]);
    return {
      ...state,
      platform,
      usage: { month: used.month, requests: used.requests, staffRequests: used.staffRequests },
      usageCostMicros: used.costMicros,
    };
  }

  /** Counts only: customers and resellers never see costs (plan decision 21). */
  const withoutCost = ({
    usageCostMicros: _cost,
    ...dto
  }: OrgAiDto & { usageCostMicros: number }): OrgAiDto => dto;

  // --- The customer's own card -------------------------------------------------------------------

  app.get('/orgs/:orgId/ai', async (req): Promise<OrgAiDto> => {
    requireSession(req);
    const { orgId } = parse(orgParams, req.params);
    const org = await loadOrg(ctx, req, orgId);
    await access.assert(req, 'ai:settings', orgScope(orgId));
    return withoutCost(await orgAiDto(org));
  });

  app.put('/orgs/:orgId/ai/decline', async (req): Promise<OrgAiDto> => {
    const auth = requireSession(req);
    const { orgId } = parse(orgParams, req.params);
    const body = parse(declineBody, req.body);
    const org = await loadOrg(ctx, req, orgId);
    const scope = orgScope(orgId);
    await access.assert(req, 'ai:settings', scope);
    // The decline belongs to the customer (plan O34): anyone with ai:settings may decline, but only the
    // organization's own membership may withdraw it, not reseller staff or weblion staff acting inside it.
    if (!body.declined) {
      const subject = await access.subject(req, orgId);
      if (!can({ ...subject, platformRole: null, reseller: null }, 'ai:settings', scope.resource)) {
        throw aiDeclineOrgOnly();
      }
    }
    const [updated] = await db
      .update(organizations)
      .set(
        body.declined
          ? // An earlier decline keeps its date and person.
            {
              aiOptOutAt: org.aiOptOutAt ?? new Date(),
              aiOptOutBy: org.aiOptOutAt ? org.aiOptOutBy : auth.user.id,
            }
          : { aiOptOutAt: null, aiOptOutBy: null },
      )
      .where(eq(organizations.id, orgId))
      .returning();
    await audit.record(req, {
      action: body.declined ? 'ai.org_decline' : 'ai.org_allow',
      orgId,
      resourceType: 'org',
      resourceId: orgId,
      details: { declined: body.declined },
    });
    return withoutCost(await orgAiDto(updated!));
  });

  // --- Staff: the admin customer page ----------------------------------------------------------------

  async function adminOrg(req: FastifyRequest, permission: 'platform:org:read' | 'platform:org:write') {
    requireSession(req);
    await access.assert(req, permission, platformScope);
    const { orgId } = parse(orgParams, req.params);
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    if (!org) throw notFound('Organization');
    return org;
  }

  app.get('/admin/orgs/:orgId/ai', async (req): Promise<AdminOrgAiDto> => {
    const org = await adminOrg(req, 'platform:org:read');
    return orgAiDto(org);
  });

  app.put('/admin/orgs/:orgId/ai', async (req): Promise<AdminOrgAiDto> => {
    const org = await adminOrg(req, 'platform:org:write');
    const body = parseSwitch(req.body);
    // Off: by the platform. On: also allowed while the reseller is off (the card then says it is capped).
    const [updated] = await db
      .update(organizations)
      .set(
        body.enabled
          ? { aiEnabled: true, aiDisabledBy: null }
          : { aiEnabled: false, aiDisabledBy: 'platform' },
      )
      .where(eq(organizations.id, org.id))
      .returning();
    await audit.record(req, {
      action: 'ai.org_switch',
      orgId: org.id,
      resourceType: 'org',
      resourceId: org.id,
      details: { enabled: body.enabled, by: 'platform', consentConfirmed: body.consentConfirmed },
    });
    return orgAiDto(updated!);
  });

  // --- Resellers: their customer page ----------------------------------------------------------------

  /** The reseller (404 unless the caller sees it and it is a reseller) and its customer (404 otherwise). */
  async function resellerCustomer(
    req: FastifyRequest,
    permission: 'reseller:customer:read' | 'reseller:customer:write',
  ) {
    requireSession(req);
    const { orgId, customerId } = parse(customerParams, req.params);
    const reseller = await loadOrg(ctx, req, orgId);
    if (reseller.kind !== 'reseller') throw notFound('Reseller');
    await access.assert(req, permission, orgScope(orgId));
    const [customer] = await db
      .select()
      .from(organizations)
      .where(and(eq(organizations.id, customerId), eq(organizations.parentOrgId, reseller.id)));
    if (!customer) throw notFound('Customer');
    return { reseller, customer };
  }

  app.get('/orgs/:orgId/customers/:customerId/ai', async (req): Promise<ResellerCustomerAiDto> => {
    const { customer } = await resellerCustomer(req, 'reseller:customer:read');
    return withoutCost(await orgAiDto(customer));
  });

  app.put('/orgs/:orgId/customers/:customerId/ai', async (req): Promise<ResellerCustomerAiDto> => {
    const { reseller, customer } = await resellerCustomer(req, 'reseller:customer:write');
    const body = parseSwitch(req.body);
    let set: Partial<Organization>;
    if (body.enabled) {
      // A reseller cannot switch on what weblion switched off, nor while its own AI is off.
      if (!customer.aiEnabled && customer.aiDisabledBy === 'platform') throw aiPlatformLocked();
      if (!ownAiOn(reseller)) throw aiResellerBlocked();
      set = { aiEnabled: true, aiDisabledBy: null };
    } else {
      // Off by the platform stays off by the platform.
      set =
        !customer.aiEnabled && customer.aiDisabledBy === 'platform'
          ? {}
          : { aiEnabled: false, aiDisabledBy: 'reseller' };
    }
    const updated =
      Object.keys(set).length > 0
        ? (await db.update(organizations).set(set).where(eq(organizations.id, customer.id)).returning())[0]!
        : customer;
    const details = { enabled: body.enabled, by: 'reseller', consentConfirmed: body.consentConfirmed };
    // Two entries: in the reseller's log (like reseller.customer_update) and in the customer's own (ai 4.3).
    await audit.record(req, {
      action: 'ai.org_switch',
      orgId: reseller.id,
      resourceType: 'org',
      resourceId: customer.id,
      details,
    });
    await audit.record(req, {
      action: 'ai.org_switch',
      orgId: customer.id,
      resourceType: 'org',
      resourceId: customer.id,
      details,
    });
    return withoutCost(await orgAiDto(updated));
  });
}
