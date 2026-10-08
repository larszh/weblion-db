import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { AppContext } from '../../context';
import { orgScope, platformScope, requireAuth } from '../../auth/access';
import { organizations, type Organization } from '../../db/schema';
import { notFound } from '../../lib/errors';

/**
 * Who bills whom.
 *
 * A customer below a reseller is billed by that reseller, every other organization by the
 * platform. "Seller" access means: may see (read) or change (write) invoices, credit,
 * services and prices of a customer as the one who bills it.
 */

/** The organization that issues invoices to `org`: its reseller, or null for the platform. */
export function sellerOrgId(org: Pick<Organization, 'parentOrgId'>): string | null {
  return org.parentOrgId ?? null;
}

export async function canActAsSeller(
  ctx: AppContext,
  req: FastifyRequest,
  org: Pick<Organization, 'parentOrgId'>,
  mode: 'read' | 'write',
): Promise<boolean> {
  if (org.parentOrgId) {
    // Superadmins pass this through their platform role as well.
    if (await ctx.access.can(req, 'reseller:billing', orgScope(org.parentOrgId))) return true;
    return mode === 'read' && ctx.access.can(req, 'platform:billing:read', platformScope);
  }
  return ctx.access.can(
    req,
    mode === 'read' ? 'platform:billing:read' : 'platform:billing:write',
    platformScope,
  );
}

/** Loads a customer organization the request may bill. 404 when it may not, to hide existence. */
export async function loadCustomerAsSeller(
  ctx: AppContext,
  req: FastifyRequest,
  orgId: string,
  mode: 'read' | 'write',
): Promise<Organization> {
  requireAuth(req);
  const org = await ctx.db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
  if (!org || !(await canActAsSeller(ctx, req, org, mode))) throw notFound('Organization');
  return org;
}

/** Display name of a seller: the reseller's name or the platform issuer name. */
export async function sellerName(
  ctx: AppContext,
  sellerId: string | null,
  platformName: string,
): Promise<string> {
  if (!sellerId) return platformName;
  const org = await ctx.db.query.organizations.findFirst({ where: eq(organizations.id, sellerId) });
  return org?.name ?? platformName;
}
