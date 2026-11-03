import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  MediaAccountDto,
  MediaAccountSecretDto,
  MediaAllowanceChangeResult,
  MediaAllowanceDto,
  MediaConnectResultDto,
  MediaDevicesDto,
  MediaInstanceDto,
  MediaLibraryRef,
  MediaPasswordResultDto,
  MediaSignOutResultDto,
  OrgMediaDto,
  UnmanagedMediaUserDto,
} from '@weblion/shared';
import { api, errorMessage } from '@/lib/api';
import { qk, useApiMutation } from '@/lib/queries';

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
  devices: (accountId: string) => ['media', 'devices', accountId] as const,
};

/** Accounts, allowances and the organization data (an allowance can switch the module on). */
const everywhere: QueryKey[] = [mediaKeys.all, ['org'], qk.orgs, qk.admin('org'), qk.admin('orgs')];

/** Accounts and the account counts of the organizations (dashboard tile, customer lists). */
const accountsChanged: QueryKey[] = [mediaKeys.all, ['org'], qk.admin('org'), qk.admin('orgs'), ['reseller']];

// --- Customer view -----------------------------------------------------------------

/** Allowance, accounts and login card of an organization. Used by the dashboard tile too. */
export const useOrgMedia = (orgId: string, enabled = true) =>
  useQuery({
    queryKey: mediaKeys.org(orgId),
    queryFn: () => api.get<OrgMediaDto>(`/orgs/${orgId}/media`),
    enabled,
    retry: false,
  });

export interface CreateMediaAccountInput {
  /** Name part of the login name, e.g. "anna" for "anna-kemaro". */
  name: string;
  /** A chosen password; without one the API generates one and answers it once. */
  password?: string;
}

/** The answer carries the generated password once (null for a chosen one). */
export const useCreateMediaAccount = (
  orgId: string,
  options: {
    success: (result: MediaAccountSecretDto) => string | null;
    onSuccess: (result: MediaAccountSecretDto) => void;
  },
) =>
  useApiMutation(
    (body: CreateMediaAccountInput) => api.post<MediaAccountSecretDto>(`/orgs/${orgId}/media/accounts`, body),
    // gcTime 0: the answer with the password leaves the mutation cache once the dialog is gone.
    { success: options.success, invalidate: accountsChanged, onSuccess: options.onSuccess, gcTime: 0 },
  );

/** Disables (stops playback, signs out every device) or enables (also lifts a lock after failed sign-ins). */
export const useUpdateMediaAccount = (options: {
  success: (account: MediaAccountDto, enabled: boolean) => string;
  onSuccess?: (account: MediaAccountDto) => void;
}) =>
  useApiMutation(
    ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch<MediaAccountDto>(`/media/accounts/${id}`, { enabled }),
    {
      success: (account, vars) => options.success(account, vars.enabled),
      invalidate: [mediaKeys.all],
      onSuccess: options.onSuccess,
    },
  );

/**
 * A new password is set through a mutation, so a generated one never lands in the query cache.
 * Call reset() on the returned mutation to forget it again. Every device of the user is signed out;
 * the answer has the fresh device count (null when unknown).
 */
export const useSetMediaPassword = (onDone: (result: MediaPasswordResultDto) => void) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, password }: { id: string; password?: string }) =>
      api.post<MediaPasswordResultDto>(`/media/accounts/${id}/password`, password ? { password } : {}),
    gcTime: 0,
    onSuccess: (result) => {
      // The account has a password now ("no_password" is gone).
      void qc.invalidateQueries({ queryKey: mediaKeys.all });
      // Here, not in mutate's callbacks: those are dropped when the dialog closed meanwhile, and a
      // generated password is answered only once.
      onDone(result);
    },
    onError: (err) => {
      toast.error(errorMessage(err));
    },
  });
};

/** The count only; fetched when the sign-out dialog opens, never cached for long. */
export const useMediaDevices = (accountId: string, enabled: boolean) =>
  useQuery({
    queryKey: mediaKeys.devices(accountId),
    queryFn: () => api.get<MediaDevicesDto>(`/media/accounts/${accountId}/devices`),
    enabled,
    gcTime: 0,
    retry: false,
  });

/**
 * Confirms the Quick Connect code a TV shows. gcTime 0 and no toast on error: the dialog shows
 * the error code inline. The code is never kept (call reset() when the dialog closes).
 */
export const useConnectMediaDevice = (onDone: () => void) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, code }: { id: string; code: string }) =>
      api.post<MediaConnectResultDto>(`/media/accounts/${id}/connect`, { code }),
    gcTime: 0,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['media', 'devices'] });
      onDone();
    },
  });
};

/** Stops playback and signs out every device of the account no other account is signed in on. */
export const useSignOutMediaDevices = (options: {
  success: (result: MediaSignOutResultDto) => string;
  onSuccess: (result: MediaSignOutResultDto) => void;
}) =>
  useApiMutation((id: string) => api.post<MediaSignOutResultDto>(`/media/accounts/${id}/signout`, {}), {
    success: options.success,
    invalidate: [mediaKeys.all],
    onSuccess: options.onSuccess,
  });

/** Deletes the user with its watch history at Jellyfin. `confirm` is the login name. */
export const useDeleteMediaAccount = (success: (account: MediaAccountDto) => string, onSuccess: () => void) =>
  useApiMutation(
    (account: MediaAccountDto) =>
      api.del<{ ok: true }>(`/media/accounts/${account.id}`, { confirm: account.username }),
    { success: (_r, account) => success(account), invalidate: accountsChanged, onSuccess },
  );

// --- Admin -------------------------------------------------------------------------

export interface AdminMediaFilters {
  q?: string;
  orgId?: string;
  providerId?: string;
  /** 'true': only accounts with issues. */
  issues?: 'true';
}

export const useAdminMediaAccounts = (filters: AdminMediaFilters) =>
  useQuery({
    queryKey: mediaKeys.adminAccounts(filters),
    queryFn: () => api.get<MediaAccountDto[]>('/admin/media/accounts', { ...filters }),
    placeholderData: (prev) => prev,
  });

/** Every streaming instance with stored counts and live facts (numbers only). */
export const useMediaInstances = () =>
  useQuery({
    queryKey: mediaKeys.instances,
    queryFn: () => api.get<MediaInstanceDto[]>('/admin/media/instances'),
    refetchInterval: 60_000,
  });

/** Libraries of an instance, read live (the allowance dialog). */
export const useMediaLibraries = (providerId: string, enabled = true) =>
  useQuery({
    queryKey: mediaKeys.libraries(providerId),
    queryFn: () => api.get<MediaLibraryRef[]>(`/admin/providers/${providerId}/media/libraries`),
    enabled: !!providerId && enabled,
    retry: false,
  });

/** Users of an instance the console does not manage (created in Jellyfin directly). */
export const useUnmanagedMediaUsers = (providerId: string, enabled = true) =>
  useQuery({
    queryKey: mediaKeys.unmanaged(providerId),
    queryFn: () => api.get<UnmanagedMediaUserDto[]>(`/admin/providers/${providerId}/media/unmanaged`),
    enabled: !!providerId && enabled,
    retry: false,
  });

export interface ImportMediaUserInput {
  providerId: string;
  userId: string;
  orgId: string | null;
  /** Sets a generated password, answered once. Needed for users without a password. */
  setPassword: boolean;
}

/** The answer carries a generated password once, when one was set. */
export const useImportMediaUser = (
  success: (result: MediaAccountSecretDto) => string,
  onSuccess: (result: MediaAccountSecretDto) => void,
) =>
  useApiMutation(
    (body: ImportMediaUserInput) => api.post<MediaAccountSecretDto>('/admin/media/accounts/import', body),
    { success: (result) => success(result), invalidate: accountsChanged, onSuccess, gcTime: 0 },
  );

/** Moves an account to an organization (its allowance's policy is written) or unassigns it (orgId null). */
export const useAssignMediaAccount = (
  success: (account: MediaAccountDto, orgId: string | null) => string,
  onSuccess: () => void,
) =>
  useApiMutation(
    ({ id, orgId }: { id: string; orgId: string | null }) =>
      api.post<MediaAccountDto>(`/admin/media/accounts/${id}/assign`, { orgId }),
    { success: (account, vars) => success(account, vars.orgId), invalidate: accountsChanged, onSuccess },
  );

/** Writes the allowance's policy to one account now. */
export const useRepairMediaAccount = (success: (account: MediaAccountDto) => string) =>
  useApiMutation(
    (account: MediaAccountDto) => api.post<MediaAccountDto>(`/admin/media/accounts/${account.id}/repair`),
    { success: (account) => success(account), invalidate: [mediaKeys.all] },
  );

export interface MediaAllowanceInput {
  providerId: string;
  /** Only to set a readable code; left out, the current one stays (or one is generated). */
  accountCode?: string;
  maxAccounts: number;
  libraryIds: string[];
  maxStreams: number;
  downloads: boolean;
  remoteBitrateMbit: number | null;
  enableModule: boolean;
}

export type ResellerMediaAllowanceInput = Omit<
  MediaAllowanceInput,
  'providerId' | 'accountCode' | 'enableModule'
>;

export const useAdminMediaAllowance = (orgId: string) =>
  useQuery({
    queryKey: mediaKeys.adminAllowance(orgId),
    queryFn: () => api.get<MediaAllowanceDto | null>(`/admin/orgs/${orgId}/media-allowance`),
    enabled: !!orgId,
  });

/** The answer lists the policy writes the change caused (accounts whose write failed included). */
export const useSetAdminMediaAllowance = (
  orgId: string,
  success: (result: MediaAllowanceChangeResult) => string,
  onResult: (result: MediaAllowanceChangeResult) => void,
) =>
  useApiMutation(
    (body: MediaAllowanceInput) =>
      api.put<MediaAllowanceChangeResult>(`/admin/orgs/${orgId}/media-allowance`, body),
    { success: (result) => success(result), invalidate: everywhere, onSuccess: (result) => onResult(result) },
  );

export const useDeleteAdminMediaAllowance = (orgId: string, success: string, onSuccess: () => void) =>
  useApiMutation(() => api.del<{ ok: true }>(`/admin/orgs/${orgId}/media-allowance`), {
    success,
    invalidate: everywhere,
    onSuccess,
  });

// --- Reseller ----------------------------------------------------------------------

export const useResellerMediaAllowance = (customerId: string) =>
  useQuery({
    queryKey: mediaKeys.resellerAllowance(customerId),
    queryFn: () => api.get<MediaAllowanceDto | null>(`/reseller/customers/${customerId}/media-allowance`),
    retry: false,
  });

/** Saving switches the module on for the customer, so the reseller's customer data is stale too. */
export const useSetResellerMediaAllowance = (
  customerId: string,
  success: (result: MediaAllowanceChangeResult) => string,
  onResult: (result: MediaAllowanceChangeResult) => void,
) =>
  useApiMutation(
    (body: ResellerMediaAllowanceInput) =>
      api.put<MediaAllowanceChangeResult>(`/reseller/customers/${customerId}/media-allowance`, body),
    {
      success: (result) => success(result),
      invalidate: [...everywhere, ['reseller']],
      onSuccess: (result) => onResult(result),
    },
  );

/** Gives the accounts back to the reseller (e.g. before the customer is deleted). Only without accounts. */
export const useDeleteResellerMediaAllowance = (customerId: string, success: string, onSuccess: () => void) =>
  useApiMutation(() => api.del<{ ok: true }>(`/reseller/customers/${customerId}/media-allowance`), {
    success,
    invalidate: [...everywhere, ['reseller']],
    onSuccess,
  });
