import type { FastifyInstance } from 'fastify';
import {
  ALL_PERMISSIONS,
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
import { serverDe, serverEn } from '@weblion/shared/i18n/server';
import type { AppContext } from '../../context';
import { requireAuth } from '../../auth/access';

export const API_VERSION = '0.1.0';

/**
 * The permission catalog in the shape API clients know: every action with `label: { de, en }`. The labels are
 * the dictionary keys perm.<action> (i18n 3.3); no other locale is added, /meta is a stable API.
 * F17 switches to ctx.i18n.t('de' | 'en', `perm.${p}`) so the labels include the text overrides.
 */
const PERMISSIONS_WITH_LABELS = Object.fromEntries(
  ALL_PERMISSIONS.map((p) => [
    p,
    { ...PERMISSIONS[p], label: { de: serverDe[`perm.${p}`], en: serverEn[`perm.${p}`] } },
  ]),
);

/** Static metadata the UI needs, e.g. for the policy editor. */
export async function metaRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/meta', async (req) => {
    requireAuth(req);
    return {
      version: API_VERSION,
      permissions: PERMISSIONS_WITH_LABELS,
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
