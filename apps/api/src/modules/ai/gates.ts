import type { FastifyRequest } from 'fastify';
import type { AppContext } from '../../context';
import type { Organization } from '../../db/schema';
import { orgScope, platformScope, requireSession } from '../../auth/access';
import type { RequestContext } from './context-block';
import { aiOrgDisabled } from './errors';
import { aiOrgState, loadOrgWithParent } from './org-state';

/**
 * The AI gate of the chat and the organization features (ai 9.1, plan 4.2). Members and reseller staff: the
 * organization's AI state first (so a declined organization answers ai_org_disabled and not the boundary's
 * forbidden), then ai:use. Platform staff pass every boundary, so for them ai:use and platform:ai:use, then
 * assertOrgData: that is what makes the customer's decline win over staff. Staff requests are scope 'staff' and
 * carry the customer's org_id (plan O28).
 */

export interface AiGate {
  scope: 'org' | 'staff';
  /** For the <context> block: the role only, never a name. */
  context: Omit<RequestContext, 'language'>;
  userId: string;
}

export async function aiRequestGate(
  ctx: AppContext,
  req: FastifyRequest,
  org: Organization,
): Promise<AiGate> {
  const auth = requireSession(req);
  const subject = await ctx.access.subject(req, org.id);
  if (subject.orgRole || subject.reseller) {
    const loaded = await loadOrgWithParent(ctx.db, org.id);
    const state = aiOrgState(loaded?.org ?? org, loaded?.parent ?? null);
    if (!state.enabled) throw aiOrgDisabled(state.offReasons);
    await ctx.access.assert(req, 'ai:use', orgScope(org.id));
    return {
      scope: 'org',
      userId: auth.user.id,
      context: subject.orgRole
        ? { role: subject.orgRole, access: 'member', organizationKind: org.kind }
        : { role: `reseller ${subject.reseller!.role}`, access: 'reseller', organizationKind: org.kind },
    };
  }
  await ctx.access.assert(req, 'ai:use', orgScope(org.id));
  await ctx.access.assert(req, 'platform:ai:use', platformScope);
  await ctx.ai.assertOrgData(org.id);
  return {
    scope: 'staff',
    userId: auth.user.id,
    context: {
      role: `weblion staff (${auth.user.platformRole ?? 'staff'})`,
      access: 'staff',
      organizationKind: org.kind,
    },
  };
}

/** The <context> fields of a request in the admin area (no organization). */
export function adminContext(req: FastifyRequest): Omit<RequestContext, 'language'> {
  const auth = requireSession(req);
  return {
    role: `weblion staff (${auth.user.platformRole ?? 'staff'})`,
    access: 'staff',
    organizationKind: null,
  };
}
