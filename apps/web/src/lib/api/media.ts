import { useQuery } from '@tanstack/react-query';
import type { OrgMediaDto } from '@weblion/shared';
import { api } from '@/lib/api';

/**
 * Query hooks for streaming (module "media", Jellyfin accounts): the customer view, allowances in
 * the admin and reseller areas, instances and the account inventory of the platform.
 */

export const mediaKeys = {
  all: ['media'] as const,
  org: (orgId: string) => ['media', 'org', orgId] as const,
  adminAccounts: (filters?: object) => ['media', 'admin', 'accounts', filters ?? {}] as const,
  adminAllowance: (orgId: string) => ['media', 'admin', 'allowance', orgId] as const,
  instances: ['media', 'admin', 'instances'] as const,
  libraries: (providerId: string) => ['media', 'admin', 'libraries', providerId] as const,
  unmanaged: (providerId: string) => ['media', 'admin', 'unmanaged', providerId] as const,
  resellerAllowance: (customerId: string) => ['media', 'reseller', customerId] as const,
};

// --- Customer view -----------------------------------------------------------------

/** Allowance, accounts and login card of an organization. Used by the dashboard tile too. */
export const useOrgMedia = (orgId: string, enabled = true) =>
  useQuery({
    queryKey: mediaKeys.org(orgId),
    queryFn: () => api.get<OrgMediaDto>(`/orgs/${orgId}/media`),
    enabled,
    retry: false,
  });
