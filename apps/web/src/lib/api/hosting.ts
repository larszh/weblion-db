import { useMutation, useQuery, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  DnsRecord,
  DnsRecordInput,
  DomainDetailDto,
  DomainDto,
  WebspaceCredentials,
  WebspaceDetailDto,
  WebspaceDto,
} from '@weblion/shared';
import { ApiError, api, errorMessage } from '@/lib/api';
import { qk, useApiMutation } from '@/lib/queries';

/** Query hooks for domains/DNS and web spaces (customer views and admin inventory). */

export const hostingKeys = {
  domains: (orgId: string) => ['hosting', 'domains', orgId] as const,
  domain: (id: string) => ['hosting', 'domain', id] as const,
  dns: (id: string) => ['hosting', 'domain', id, 'dns'] as const,
  webspaces: (orgId: string) => ['hosting', 'webspaces', orgId] as const,
  webspace: (id: string) => ['hosting', 'webspace', id] as const,
  admin: (sub: 'domains' | 'webspaces', params?: object) => ['hosting', 'admin', sub, params ?? {}] as const,
};

export interface AdminHostingFilters {
  q?: string;
  assigned?: 'true' | 'false';
  providerId?: string;
}

/** POST /admin/providers/:id/sync, extended with domains and web spaces. */
export interface ProviderSyncResult {
  seen: number;
  missing: number;
  domains?: { seen: number; missing: number };
  webspaces?: { seen: number; missing: number };
}

export const useDomains = (orgId: string, enabled = true) =>
  useQuery({
    queryKey: hostingKeys.domains(orgId),
    queryFn: () => api.get<DomainDto[]>(`/orgs/${orgId}/domains`),
    enabled,
  });

export const useDomain = (id: string | undefined) =>
  useQuery({
    queryKey: hostingKeys.domain(id ?? ''),
    queryFn: () => api.get<DomainDetailDto>(`/domains/${id}`),
    enabled: !!id,
    retry: false,
  });

export const useDnsRecords = (domainId: string, enabled = true) =>
  useQuery({
    queryKey: hostingKeys.dns(domainId),
    queryFn: () => api.get<DnsRecord[]>(`/domains/${domainId}/dns`),
    enabled,
    retry: false,
  });

export const useWebspaces = (orgId: string, enabled = true) =>
  useQuery({
    queryKey: hostingKeys.webspaces(orgId),
    queryFn: () => api.get<WebspaceDto[]>(`/orgs/${orgId}/webspaces`),
    enabled,
  });

export const useWebspace = (id: string | undefined) =>
  useQuery({
    queryKey: hostingKeys.webspace(id ?? ''),
    queryFn: () => api.get<WebspaceDetailDto>(`/webspaces/${id}`),
    enabled: !!id,
    retry: false,
  });

export const useAdminDomains = (filters: AdminHostingFilters) =>
  useQuery({
    queryKey: hostingKeys.admin('domains', filters),
    queryFn: () => api.get<DomainDto[]>('/admin/domains', { ...filters }),
    placeholderData: (prev) => prev,
  });

export const useAdminWebspaces = (filters: AdminHostingFilters) =>
  useQuery({
    queryKey: hostingKeys.admin('webspaces', filters),
    queryFn: () => api.get<WebspaceDto[]>('/admin/webspaces', { ...filters }),
    placeholderData: (prev) => prev,
  });

// --- Mutations ---------------------------------------------------------------------

export function useDnsMutations(
  domainId: string,
  messages: { added: string; updated: string; deleted: string },
) {
  const invalidate = [hostingKeys.dns(domainId)];
  const add = useApiMutation(
    (input: DnsRecordInput) => api.post<DnsRecord>(`/domains/${domainId}/dns`, input),
    {
      success: messages.added,
      invalidate,
    },
  );
  const update = useApiMutation(
    ({ recordId, patch }: { recordId: string; patch: Partial<DnsRecordInput> }) =>
      api.patch<DnsRecord | { ok: true }>(`/domains/${domainId}/dns/${encodeURIComponent(recordId)}`, patch),
    { success: messages.updated, invalidate },
  );
  const remove = useApiMutation(
    (recordId: string) => api.del<{ ok: true }>(`/domains/${domainId}/dns/${encodeURIComponent(recordId)}`),
    { success: messages.deleted, invalidate },
  );
  return { add, update, remove };
}

/**
 * Secrets are fetched on demand through mutations, so they never land in the query cache.
 * Call reset() on the returned mutation to forget the value again.
 *
 * Registrars like Joker create the auth code asynchronously and answer 409 authcode_pending
 * until it is ready. That is no error for the user: the card shows a "try again" notice
 * instead of a toast (see isAuthcodePending).
 */
export const useRevealAuthcode = (domainId: string) =>
  useMutation({
    mutationFn: () => api.get<{ authcode: string | null }>(`/domains/${domainId}/authcode`),
    onError: (err) => {
      if (!isAuthcodePending(err)) toast.error(errorMessage(err));
    },
  });

export const isAuthcodePending = (err: unknown) => err instanceof ApiError && err.code === 'authcode_pending';

/**
 * Answer of the domain management routes (name servers, transfer lock, renewals). The
 * registrar may apply the change later: `providerRef` is its job reference (Joker: Proc-ID),
 * `message` its English status text.
 */
export interface DomainActionResult {
  ok: true;
  message: string | null;
  providerRef: string | null;
}

interface DomainActionOptions<TVars> {
  success: (result: DomainActionResult, vars: TVars) => string;
  onSuccess?: (result: DomainActionResult, vars: TVars) => void;
}

/** Detail view plus every list that shows expiry and auto-renew. */
const domainEverywhere = (domainId: string): QueryKey[] => [
  hostingKeys.domain(domainId),
  ['hosting', 'domains'],
  ['hosting', 'admin', 'domains'],
];

export const useSetNameservers = (domainId: string, options: DomainActionOptions<string[]>) =>
  useApiMutation(
    (nameservers: string[]) =>
      api.put<DomainActionResult>(`/domains/${domainId}/nameservers`, { nameservers }),
    { ...options, invalidate: [hostingKeys.domain(domainId)] },
  );

export const useSetDomainLock = (domainId: string, options: DomainActionOptions<boolean>) =>
  useApiMutation((locked: boolean) => api.put<DomainActionResult>(`/domains/${domainId}/lock`, { locked }), {
    ...options,
    invalidate: [hostingKeys.domain(domainId)],
  });

/** Platform staff only (permission platform:domain:write, interactive session). */
export const useSetAutoRenew = (options: DomainActionOptions<{ domainId: string; enabled: boolean }>) =>
  useApiMutation(
    ({ domainId, enabled }: { domainId: string; enabled: boolean }) =>
      api.post<DomainActionResult>(`/admin/domains/${domainId}/auto-renew`, { enabled }),
    { ...options, invalidate: ({ domainId }) => domainEverywhere(domainId) },
  );

export interface RenewVars {
  domainId: string;
  years: number;
  /** The expiry shown in the dialog. The API refuses if the domain runs longer by now. */
  expiresAt: string | null;
}

/** Platform staff only. Charged by the registrar right away. */
export const useRenewDomain = (options: DomainActionOptions<RenewVars>) =>
  useApiMutation(
    ({ domainId, years, expiresAt }: RenewVars) =>
      api.post<DomainActionResult>(`/admin/domains/${domainId}/renew`, { years, expiresAt }),
    { ...options, invalidate: ({ domainId }) => domainEverywhere(domainId) },
  );

export const useRevealWebspaceCredentials = (webspaceId: string) =>
  useApiMutation(() => api.get<WebspaceCredentials>(`/webspaces/${webspaceId}/credentials`));

export interface AssignVars {
  type: 'domain' | 'webspace';
  id: string;
  orgId: string | null;
  enableModule: boolean;
}

export const useAssignHosting = (options: {
  success: (vars: AssignVars) => string;
  onSuccess?: () => void;
}) =>
  useApiMutation(
    ({ type, id, orgId, enableModule }: AssignVars) =>
      api.post<DomainDto | WebspaceDto>(
        `/admin/${type === 'domain' ? 'domains' : 'webspaces'}/${id}/assign`,
        {
          orgId,
          enableModule,
        },
      ),
    {
      success: (_r, vars) => options.success(vars),
      // Assigning can activate a module, so organization data is stale as well.
      invalidate: [['hosting'], qk.admin('orgs'), qk.orgs, ['org']],
      onSuccess: () => options.onSuccess?.(),
    },
  );

export const useProviderSync = (success: (result: ProviderSyncResult) => string) =>
  useApiMutation(
    (providerId: string) => api.post<ProviderSyncResult>(`/admin/providers/${providerId}/sync`),
    {
      success,
      invalidate: [['hosting', 'admin'], qk.admin('providers'), qk.admin('servers'), qk.admin('stats')],
    },
  );
