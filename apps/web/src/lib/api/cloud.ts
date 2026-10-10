import { useMutation, useQuery, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CloudAccountDto, CloudAccountSecretDto, CloudAllowanceDto, OrgCloudDto } from '@weblion/shared';
import { api, errorMessage } from '@/lib/api';
import { qk, useApiMutation } from '@/lib/queries';

/**
 * Query hooks for cloud storage (module "storage", Nextcloud accounts): the customer view,
 * allowances in the admin and reseller areas and the account inventory of the platform.
 */

export const cloudKeys = {
  all: ['cloud'] as const,
  org: (orgId: string) => ['cloud', 'org', orgId] as const,
  adminAccounts: (filters?: object) => ['cloud', 'admin', 'accounts', filters ?? {}] as const,
  adminAllowance: (orgId: string) => ['cloud', 'admin', 'allowance', orgId] as const,
  unmanaged: (providerId: string) => ['cloud', 'admin', 'unmanaged', providerId] as const,
  resellerAllowance: (customerId: string) => ['cloud', 'reseller', customerId] as const,
};

/** Accounts, allowances and the organization data (an allowance can switch the module on). */
const everywhere: QueryKey[] = [cloudKeys.all, ['org'], qk.orgs, qk.admin('org'), qk.admin('orgs')];

// --- Customer view -----------------------------------------------------------------

export const useOrgCloud = (orgId: string, enabled = true) =>
  useQuery({
    queryKey: cloudKeys.org(orgId),
    queryFn: () => api.get<OrgCloudDto>(`/orgs/${orgId}/cloud`),
    enabled,
    retry: false,
  });

export interface CreateCloudAccountInput {
  name: string;
  displayName?: string;
  email?: string;
  quotaGb: number;
  invite: boolean;
}

/** The answer carries the generated password once (null for invitations). */
export const useCreateCloudAccount = (
  orgId: string,
  options: {
    success: (result: CloudAccountSecretDto) => string | null;
    onSuccess: (result: CloudAccountSecretDto) => void;
  },
) =>
  useApiMutation(
    (body: CreateCloudAccountInput) => api.post<CloudAccountSecretDto>(`/orgs/${orgId}/cloud/accounts`, body),
    // gcTime 0: the answer with the password leaves the mutation cache once the dialog is gone.
    { success: options.success, invalidate: [cloudKeys.all], onSuccess: options.onSuccess, gcTime: 0 },
  );

export interface CloudAccountPatch {
  displayName?: string | null;
  email?: string | null;
  quotaGb?: number;
  enabled?: boolean;
}

export const useUpdateCloudAccount = (options: {
  success: (account: CloudAccountDto, vars: { id: string; patch: CloudAccountPatch }) => string;
  onSuccess?: (account: CloudAccountDto) => void;
}) =>
  useApiMutation(
    ({ id, patch }: { id: string; patch: CloudAccountPatch }) =>
      api.patch<CloudAccountDto>(`/cloud/accounts/${id}`, patch),
    { success: options.success, invalidate: [cloudKeys.all], onSuccess: options.onSuccess },
  );

/**
 * A new password is fetched through a mutation, so it never lands in the query cache.
 * Call reset() on the returned mutation to forget it again.
 */
export const useResetCloudPassword = () =>
  useMutation({
    mutationFn: (id: string) => api.post<{ password: string }>(`/cloud/accounts/${id}/password`),
    gcTime: 0,
    onError: (err) => {
      toast.error(errorMessage(err));
    },
  });

export const useResendCloudInvite = (success: (account: CloudAccountDto) => string) =>
  useApiMutation(
    (account: CloudAccountDto) => api.post<{ ok: true }>(`/cloud/accounts/${account.id}/invite`),
    { success: (_r, account) => success(account) },
  );

/** Deletes the user and all of its files at Nextcloud. `confirm` is the login name. */
export const useDeleteCloudAccount = (success: (account: CloudAccountDto) => string, onSuccess: () => void) =>
  useApiMutation(
    (account: CloudAccountDto) =>
      api.del<{ ok: true }>(`/cloud/accounts/${account.id}`, { confirm: account.username }),
    { success: (_r, account) => success(account), invalidate: [cloudKeys.all], onSuccess },
  );

// --- Admin -------------------------------------------------------------------------

export interface AdminCloudFilters {
  q?: string;
  orgId?: string;
  providerId?: string;
}

export const useAdminCloudAccounts = (filters: AdminCloudFilters) =>
  useQuery({
    queryKey: cloudKeys.adminAccounts(filters),
    queryFn: () => api.get<CloudAccountDto[]>('/admin/cloud/accounts', { ...filters }),
    placeholderData: (prev) => prev,
  });

export const useAdminCloudAllowance = (orgId: string) =>
  useQuery({
    queryKey: cloudKeys.adminAllowance(orgId),
    queryFn: () => api.get<CloudAllowanceDto | null>(`/admin/orgs/${orgId}/cloud-allowance`),
  });

export interface AdminAllowanceInput {
  providerId: string;
  quotaGb: number;
  maxAccounts: number | null;
  enableModule: boolean;
}

export const useSetAdminCloudAllowance = (orgId: string, success: string, onSuccess: () => void) =>
  useApiMutation(
    (body: AdminAllowanceInput) => api.put<CloudAllowanceDto>(`/admin/orgs/${orgId}/cloud-allowance`, body),
    { success, invalidate: everywhere, onSuccess },
  );

export const useDeleteAdminCloudAllowance = (orgId: string, success: string, onSuccess: () => void) =>
  useApiMutation(() => api.del<{ ok: true }>(`/admin/orgs/${orgId}/cloud-allowance`), {
    success,
    invalidate: everywhere,
    onSuccess,
  });

/** A user at the instance that the panel does not manage (created at Nextcloud directly). */
export interface UnmanagedCloudUser {
  username: string;
  displayName: string | null;
  email: string | null;
  quotaBytes: number | null;
  usedBytes: number | null;
  enabled: boolean;
}

export const useUnmanagedCloudUsers = (providerId: string, enabled = true) =>
  useQuery({
    queryKey: cloudKeys.unmanaged(providerId),
    queryFn: () => api.get<UnmanagedCloudUser[]>(`/admin/providers/${providerId}/cloud/unmanaged`),
    enabled: !!providerId && enabled,
    retry: false,
  });

export const useImportCloudAccount = (success: (account: CloudAccountDto) => string, onSuccess: () => void) =>
  useApiMutation(
    (body: { providerId: string; username: string; orgId: string | null }) =>
      api.post<CloudAccountDto>('/admin/cloud/accounts/import', body),
    { success: (account) => success(account), invalidate: [cloudKeys.all], onSuccess },
  );

export const useAssignCloudAccount = (
  success: (account: CloudAccountDto, orgId: string | null) => string,
  onSuccess: () => void,
) =>
  useApiMutation(
    ({ id, orgId }: { id: string; orgId: string | null }) =>
      api.post<CloudAccountDto>(`/admin/cloud/accounts/${id}/assign`, { orgId }),
    { success: (account, vars) => success(account, vars.orgId), invalidate: [cloudKeys.all], onSuccess },
  );

// --- Reseller ----------------------------------------------------------------------

export const useResellerCloudAllowance = (customerId: string) =>
  useQuery({
    queryKey: cloudKeys.resellerAllowance(customerId),
    queryFn: () => api.get<CloudAllowanceDto | null>(`/reseller/customers/${customerId}/cloud-allowance`),
    retry: false,
  });

/** Saving switches the module on for the customer, so the reseller's customer data is stale too. */
export const useSetResellerCloudAllowance = (customerId: string, success: string, onSuccess: () => void) =>
  useApiMutation(
    (body: { quotaGb: number; maxAccounts: number | null }) =>
      api.put<CloudAllowanceDto>(`/reseller/customers/${customerId}/cloud-allowance`, body),
    { success, invalidate: [...everywhere, ['reseller']], onSuccess },
  );

/** Gives the storage back to the reseller (e.g. before the customer is deleted). Only without accounts. */
export const useDeleteResellerCloudAllowance = (customerId: string, success: string, onSuccess: () => void) =>
  useApiMutation(() => api.del<{ ok: true }>(`/reseller/customers/${customerId}/cloud-allowance`), {
    success,
    invalidate: [...everywhere, ['reseller']],
    onSuccess,
  });
