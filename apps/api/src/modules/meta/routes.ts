import type { FastifyInstance } from 'fastify';
import {
  DEFAULT_CUSTOMER_BOUNDARY,
  ORG_ROLE_POLICIES,
  ORG_ROLES,
  PERMISSION_GROUPS,
  PERMISSIONS,
  PLATFORM_ROLES,
  PROVIDER_LABELS,
  PROVIDER_TYPES,
  TOKEN_SCOPES,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import { requireAuth } from '../../auth/access';

export const API_VERSION = '0.1.0';

/** Static metadata the UI needs, e.g. for the policy editor. */
export async function metaRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/meta', async (req) => {
    requireAuth(req);
    return {
      version: API_VERSION,
      permissions: PERMISSIONS,
      permissionGroups: PERMISSION_GROUPS,
      orgRoles: ORG_ROLES,
      orgRolePolicies: ORG_ROLE_POLICIES,
      platformRoles: PLATFORM_ROLES,
      tokenScopes: TOKEN_SCOPES,
      providerTypes: PROVIDER_TYPES.filter((t) => t !== 'demo' || ctx.env.ENABLE_DEMO_PROVIDER),
      providerLabels: PROVIDER_LABELS,
      defaultCustomerBoundary: DEFAULT_CUSTOMER_BOUNDARY,
    };
  });
}
