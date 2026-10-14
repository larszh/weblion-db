import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  PhoneRingGroup,
  PhoneSystemDetailDto,
  PhoneSystemDto,
  PhoneTrunk,
  PhoneUserCreateBody,
  PhoneUserCreatedDto,
  PhoneUserDto,
  PhoneUserListDto,
  PhoneUserPatchBody,
  ProviderConnectionDto,
} from '@weblion/shared';
import { api, errorMessage } from '@/lib/api';
import { qk } from '@/lib/queries';

/**
 * Query hooks for telephony (module "phone", 3CX): phone systems of an organization with their
 * users, ring groups and trunks, and the phone system inventory of the platform. Users, ring
 * groups and trunks are read live from the PBX; the API stores none of them.
 */

export const phoneKeys = {
  all: ['phone'] as const,
  org: (orgId: string) => ['phone', 'org', orgId] as const,
  system: (id: string) => ['phone', 'system', id] as const,
  users: (id: string) => ['phone', 'system', id, 'users'] as const,
  ringGroups: (id: string) => ['phone', 'system', id, 'ring-groups'] as const,
  trunks: (id: string) => ['phone', 'system', id, 'trunks'] as const,
  admin: (filters?: object) => ['phone', 'admin', filters ?? {}] as const,
};

/**
 * Connections that can have phone systems: 3CX, and the demo provider's simulation. The opt-in
 * demos with a flavor (Cloudflare, CloudPanel) are demo connections as well but simulate DNS
 * zones or websites only.
 */
export const isPhoneProvider = (
  p: Pick<ProviderConnectionDto, 'type'> & { summary?: Record<string, string> },
) => p.type === 'threecx' || (p.type === 'demo' && !p.summary?.flavor);

/** Formats an error for the toast; null shows no toast (the dialog shows it at the field). */
export type PhoneErrorFormatter = (err: unknown) => string | null;

interface PhoneMutationOptions<TVars, TResult> {
  success?: string | ((result: TResult, vars: TVars) => string | null);
  onSuccess?: (result: TResult, vars: TVars) => void;
  error?: PhoneErrorFormatter;
}

/** A query key to refresh; `exact` leaves the queries below it alone (live lists of the PBX). */
type Refresh = QueryKey | { queryKey: QueryKey; exact: true };

/**
 * Like useApiMutation (toast on success and error, then the given keys are refreshed), with a
 * formatter for the error toast: the phone pages translate the panel's own answers (user limit,
 * taken numbers) and leave field errors to the dialog.
 */
function usePhoneMutation<TVars, TResult>(
  fn: (vars: TVars) => Promise<TResult>,
  options: PhoneMutationOptions<TVars, TResult> & { invalidate?: (vars: TVars) => Refresh[] },
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (result, vars) => {
      const message = typeof options.success === 'function' ? options.success(result, vars) : options.success;
      if (message) toast.success(message);
      for (const key of options.invalidate?.(vars) ?? []) {
        void qc.invalidateQueries('exact' in key ? key : { queryKey: key });
      }
      options.onSuccess?.(result, vars);
    },
    onError: (err) => {
      const message = (options.error ?? errorMessage)(err);
      if (message) toast.error(message);
    },
  });
}

/**
 * The phone system itself (its facts: user count, status) and the lists that show it, without
 * the users, ring groups and trunks below it, which are read live from the PBX.
 */
const systemEverywhere = (id: string): Refresh[] => [
  { queryKey: phoneKeys.system(id), exact: true },
  ['phone', 'org'],
  ['phone', 'admin'],
];

// --- Customer view -----------------------------------------------------------------

export const useOrgPhoneSystems = (orgId: string, enabled = true) =>
  useQuery({
    queryKey: phoneKeys.org(orgId),
    queryFn: () => api.get<PhoneSystemDto[]>(`/orgs/${orgId}/phone-systems`),
    enabled,
    retry: false,
  });

/** Facts read live from the PBX; `liveError` is set (and the stored facts shown) when that fails. */
export const usePhoneSystem = (id: string | undefined) =>
  useQuery({
    queryKey: phoneKeys.system(id ?? ''),
    queryFn: () => api.get<PhoneSystemDetailDto>(`/phone-systems/${id}`),
    enabled: !!id,
    refetchInterval: 30_000,
    retry: false,
  });

export const usePhoneUsers = (id: string, enabled = true) =>
  useQuery({
    queryKey: phoneKeys.users(id),
    queryFn: () => api.get<PhoneUserListDto>(`/phone-systems/${id}/users`),
    enabled,
    retry: false,
  });

/** The PBX's next free extension; called when the create dialog opens, never cached. */
export const fetchNextPhoneNumber = (id: string) =>
  api.get<{ number: string | null }>(`/phone-systems/${id}/users/next-number`);

export const useCreatePhoneUser = (
  id: string,
  options: PhoneMutationOptions<PhoneUserCreateBody, PhoneUserCreatedDto>,
) =>
  usePhoneMutation(
    (body: PhoneUserCreateBody) => api.post<PhoneUserCreatedDto>(`/phone-systems/${id}/users`, body),
    {
      ...options,
      invalidate: () => [phoneKeys.users(id), ...systemEverywhere(id)],
    },
  );

export interface UpdatePhoneUserVars {
  userId: string;
  patch: PhoneUserPatchBody;
}

export const useUpdatePhoneUser = (
  id: string,
  options: PhoneMutationOptions<UpdatePhoneUserVars, PhoneUserDto>,
) =>
  usePhoneMutation(
    ({ userId, patch }: UpdatePhoneUserVars) =>
      api.patch<PhoneUserDto>(`/phone-systems/${id}/users/${encodeURIComponent(userId)}`, patch),
    // Ring groups show the members' names.
    { ...options, invalidate: () => [phoneKeys.users(id), phoneKeys.ringGroups(id)] },
  );

export interface DeletePhoneUserVars {
  userId: string;
  /** The extension number, typed by the user as confirmation. */
  confirm: string;
}

export const useDeletePhoneUser = (
  id: string,
  options: PhoneMutationOptions<DeletePhoneUserVars, { ok: true }>,
) =>
  usePhoneMutation(
    ({ userId, confirm }: DeletePhoneUserVars) =>
      api.del<{ ok: true }>(`/phone-systems/${id}/users/${encodeURIComponent(userId)}`, { confirm }),
    {
      ...options,
      invalidate: () => [phoneKeys.users(id), phoneKeys.ringGroups(id), ...systemEverywhere(id)],
    },
  );

/** The PBX sends its welcome e-mail with the user's access again (interactive session only). */
export const useSendPhoneWelcome = (id: string, options: PhoneMutationOptions<string, { ok: true }>) =>
  usePhoneMutation(
    (userId: string) =>
      api.post<{ ok: true }>(`/phone-systems/${id}/users/${encodeURIComponent(userId)}/welcome`),
    options,
  );

export const usePhoneRingGroups = (id: string, enabled = true) =>
  useQuery({
    queryKey: phoneKeys.ringGroups(id),
    queryFn: () => api.get<PhoneRingGroup[]>(`/phone-systems/${id}/ring-groups`),
    enabled,
    retry: false,
  });

export interface RingGroupMemberVars {
  groupId: string;
  number: string;
}

export const useAddRingGroupMember = (
  id: string,
  options: PhoneMutationOptions<RingGroupMemberVars, PhoneRingGroup>,
) =>
  usePhoneMutation(
    ({ groupId, number }: RingGroupMemberVars) =>
      api.post<PhoneRingGroup>(`/phone-systems/${id}/ring-groups/${encodeURIComponent(groupId)}/members`, {
        number,
      }),
    { ...options, invalidate: () => [phoneKeys.ringGroups(id)] },
  );

export const useRemoveRingGroupMember = (
  id: string,
  options: PhoneMutationOptions<RingGroupMemberVars, PhoneRingGroup>,
) =>
  usePhoneMutation(
    ({ groupId, number }: RingGroupMemberVars) =>
      api.del<PhoneRingGroup>(
        `/phone-systems/${id}/ring-groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(number)}`,
      ),
    { ...options, invalidate: () => [phoneKeys.ringGroups(id)] },
  );

export const usePhoneTrunks = (id: string, enabled = true) =>
  useQuery({
    queryKey: phoneKeys.trunks(id),
    queryFn: () => api.get<PhoneTrunk[]>(`/phone-systems/${id}/trunks`),
    enabled,
    retry: false,
  });

export interface RenamePhoneSystemVars {
  id: string;
  name: string;
}

/** The site label in the console; changes nothing at the PBX. */
export const useRenamePhoneSystem = (options: PhoneMutationOptions<RenamePhoneSystemVars, PhoneSystemDto>) =>
  usePhoneMutation(
    ({ id, name }: RenamePhoneSystemVars) => api.patch<PhoneSystemDto>(`/phone-systems/${id}`, { name }),
    { ...options, invalidate: ({ id }) => systemEverywhere(id) },
  );

// --- Admin -------------------------------------------------------------------------

export interface AdminPhoneFilters {
  q?: string;
  assigned?: 'true' | 'false';
  providerId?: string;
  orgId?: string;
}

export const useAdminPhoneSystems = (filters: AdminPhoneFilters) =>
  useQuery({
    queryKey: phoneKeys.admin(filters),
    queryFn: () => api.get<PhoneSystemDto[]>('/admin/phone-systems', { ...filters }),
    placeholderData: (prev) => prev,
  });

export interface AssignPhoneSystemVars {
  id: string;
  /** null: unassign. */
  orgId: string | null;
  enableModule: boolean;
}

/** Assigning can switch the module on, so organization data is stale as well. */
export const useAssignPhoneSystem = (options: PhoneMutationOptions<AssignPhoneSystemVars, PhoneSystemDto>) =>
  usePhoneMutation(
    ({ id, orgId, enableModule }: AssignPhoneSystemVars) =>
      api.post<PhoneSystemDto>(`/admin/phone-systems/${id}/assign`, { orgId, enableModule }),
    {
      ...options,
      invalidate: () => [phoneKeys.all, ['org'], qk.orgs, qk.admin('org'), qk.admin('orgs'), ['reseller']],
    },
  );
