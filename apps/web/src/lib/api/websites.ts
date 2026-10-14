import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  CreatableWebsiteType,
  UnmanagedWebsitesDto,
  WebsiteAllowanceDto,
  WebsiteCreateRequest,
  WebsiteCreatedDto,
  WebsiteCredentialsDto,
  WebsiteDatabaseDto,
  WebsiteDatabaseSecretDto,
  WebsiteDnsCheckDto,
  WebsiteOptionsDto,
  WebsiteServerOptions,
  WebspaceDetailDto,
  WebspaceDto,
} from '@weblion/shared';
import { api, errorMessage } from '@/lib/api';
import { qk } from '@/lib/queries';
import { hostingKeys } from './hosting';

/**
 * Query hooks for websites (module "webhosting", CloudPanel): options and allowance of an
 * organization, creating and deleting websites, passwords, databases, certificates and the
 * DNS check, plus the admin and reseller allowances and the admin inventory of a server.
 *
 * Websites are web space rows (kind "website"): lists and details come from the web space
 * queries in ./hosting. Answers with passwords are only ever mutation results with gcTime 0,
 * so they never land in the query cache and leave the mutation cache once nobody shows them.
 */

export const websiteKeys = {
  all: ['websites'] as const,
  options: (orgId: string) => ['websites', 'options', orgId] as const,
  dns: (id: string) => ['websites', 'dns', id] as const,
  adminList: (filters?: object) => ['websites', 'admin', 'list', filters ?? {}] as const,
  adminAllowance: (orgId: string) => ['websites', 'admin', 'allowance', orgId] as const,
  adminOptions: (providerId: string) => ['websites', 'admin', 'options', providerId] as const,
  unmanaged: (providerId: string) => ['websites', 'admin', 'unmanaged', providerId] as const,
  resellerAllowance: (customerId: string) => ['websites', 'reseller', customerId] as const,
};

/**
 * Everything a change of a website shows up in: the web space lists (organization and admin),
 * the website itself, the options (they carry the allowance counts) and the admin list.
 */
const websiteViews = (id?: string): QueryKey[] => [
  ['hosting', 'webspaces'],
  ['hosting', 'admin', 'webspaces'],
  ['websites', 'options'],
  ['websites', 'admin', 'list'],
  ...(id ? [hostingKeys.webspace(id)] : []),
];

/** Allowances can switch the module on, so organization data is stale as well. */
const allowanceViews: QueryKey[] = [
  websiteKeys.all,
  ['org'],
  qk.orgs,
  qk.admin('org'),
  qk.admin('orgs'),
  ['reseller'],
];

/** Formats an error for the toast; the website pages translate the API's codes (websiteErrorText). */
export type WebsiteErrorFormatter = (err: unknown) => string;

export interface WebsiteMutationOptions<TVars, TResult> {
  success?: string | ((result: TResult, vars: TVars) => string | null);
  onSuccess?: (result: TResult, vars: TVars) => void;
  /** Text of the error toast. `false`: no toast, the caller shows the error next to the form. */
  error?: WebsiteErrorFormatter | false;
}

/**
 * Like useApiMutation (toast on success and error, then invalidation), with a formatter for
 * the error toast. `refreshOnError`: refresh the views after a failure too, because a failed
 * create or delete can leave a row in state "error" behind.
 */
function useWebsiteMutation<TVars, TResult>(
  fn: (vars: TVars) => Promise<TResult>,
  invalidate: QueryKey[] | ((vars: TVars) => QueryKey[]),
  options: WebsiteMutationOptions<TVars, TResult> & { gcTime?: number; refreshOnError?: boolean } = {},
) {
  const qc = useQueryClient();
  const refresh = (vars: TVars) => {
    for (const key of typeof invalidate === 'function' ? invalidate(vars) : invalidate) {
      void qc.invalidateQueries({ queryKey: key });
    }
  };
  return useMutation({
    mutationFn: fn,
    ...(options.gcTime !== undefined ? { gcTime: options.gcTime } : {}),
    onSuccess: (result, vars) => {
      const message = typeof options.success === 'function' ? options.success(result, vars) : options.success;
      if (message) toast.success(message);
      options.onSuccess?.(result, vars);
      refresh(vars);
    },
    onError: (err, vars) => {
      if (options.error !== false) toast.error((options.error ?? errorMessage)(err));
      if (options.refreshOnError) refresh(vars);
    },
  });
}

// --- Organization ------------------------------------------------------------------

/** Allowance of the organization and what can be created on its instance. */
export const useWebsiteOptions = (orgId: string, enabled = true) =>
  useQuery({
    queryKey: websiteKeys.options(orgId),
    queryFn: () => api.get<WebsiteOptionsDto>(`/orgs/${orgId}/websites/options`),
    enabled: !!orgId && enabled,
    retry: false,
    // The server is asked for its PHP versions and templates; they rarely change.
    staleTime: 60_000,
  });

/** Creating takes up to a few minutes (Node.js longer). The answer carries the passwords once. */
export const useCreateWebsite = (
  orgId: string,
  options: WebsiteMutationOptions<WebsiteCreateRequest, WebsiteCreatedDto> = {},
) =>
  useWebsiteMutation(
    (body: WebsiteCreateRequest) => api.post<WebsiteCreatedDto>(`/orgs/${orgId}/websites`, body),
    [...websiteViews(), websiteKeys.options(orgId)],
    { ...options, gcTime: 0, refreshOnError: true },
  );

/** New password of the site user (SFTP/SSH). Without `password` the API generates one. */
export const useResetWebsitePassword = (
  id: string,
  options: WebsiteMutationOptions<{ password?: string }, WebsiteCredentialsDto> = {},
) =>
  useWebsiteMutation(
    (body: { password?: string }) => api.post<WebsiteCredentialsDto>(`/webspaces/${id}/password`, body),
    // The website loses its "credentials pending" flag.
    [hostingKeys.webspace(id), ['hosting', 'webspaces'], ['hosting', 'admin', 'webspaces']],
    { ...options, gcTime: 0 },
  );

export interface WebsiteDatabaseInput {
  suffix: string;
  password?: string;
}

export const useCreateWebsiteDatabase = (
  id: string,
  options: WebsiteMutationOptions<WebsiteDatabaseInput, WebsiteDatabaseSecretDto> = {},
) =>
  useWebsiteMutation(
    (body: WebsiteDatabaseInput) => api.post<WebsiteDatabaseSecretDto>(`/webspaces/${id}/databases`, body),
    websiteViews(id),
    { ...options, gcTime: 0, refreshOnError: true },
  );

export const useResetWebsiteDatabasePassword = (
  id: string,
  databaseId: string,
  options: WebsiteMutationOptions<{ password?: string }, WebsiteDatabaseSecretDto> = {},
) =>
  useWebsiteMutation(
    (body: { password?: string }) =>
      api.post<WebsiteDatabaseSecretDto>(`/webspaces/${id}/databases/${databaseId}/password`, body),
    [],
    { ...options, gcTime: 0 },
  );

/** Deletes the database and its user on the server. `confirm` is the database name. */
export const useDeleteWebsiteDatabase = (
  id: string,
  options: WebsiteMutationOptions<WebsiteDatabaseDto, { ok: true }> = {},
) =>
  useWebsiteMutation(
    (database: WebsiteDatabaseDto) =>
      api.del<{ ok: true }>(`/webspaces/${id}/databases/${database.id}`, { confirm: database.name }),
    websiteViews(id),
    { ...options, refreshOnError: true },
  );

/** Let's Encrypt for the domain and its www counterpart. `force` skips the DNS check of the API. */
export const useIssueCertificate = (
  id: string,
  options: WebsiteMutationOptions<{ force: boolean }, WebspaceDetailDto> = {},
) =>
  useWebsiteMutation(
    (body: { force: boolean }) => api.post<WebspaceDetailDto>(`/webspaces/${id}/certificate`, body),
    [...websiteViews(id), websiteKeys.dns(id)],
    options,
  );

/** What public DNS answers for the domain and its www counterpart. The API caches it 60 s. */
export const useWebsiteDnsCheck = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: websiteKeys.dns(id),
    queryFn: () => api.get<WebsiteDnsCheckDto>(`/webspaces/${id}/dns-check`),
    enabled: !!id && enabled,
    retry: false,
    staleTime: 60_000,
  });

/** Deletes the site with all files and databases. `confirm` is the domain. */
export const useDeleteWebsite = (
  id: string,
  orgId: string | null,
  options: WebsiteMutationOptions<{ confirm: string }, { ok: true; warnings: string[] }> = {},
) => {
  const qc = useQueryClient();
  return useWebsiteMutation(
    (body: { confirm: string }) => api.del<{ ok: true; warnings: string[] }>(`/webspaces/${id}`, body),
    [...websiteViews(), ...(orgId ? [websiteKeys.options(orgId)] : [])],
    {
      ...options,
      refreshOnError: true,
      onSuccess: (result, vars) => {
        // The caller leaves the page first; the detail would only answer 404 now.
        options.onSuccess?.(result, vars);
        qc.removeQueries({ queryKey: hostingKeys.webspace(id) });
        qc.removeQueries({ queryKey: websiteKeys.dns(id) });
      },
    },
  );
};

// --- Admin -------------------------------------------------------------------------

/** Websites of all CloudPanel servers, or of one (GET /admin/webspaces?kind=website). */
export const useAdminWebsites = (filters: { providerId?: string }, enabled = true) =>
  useQuery({
    queryKey: websiteKeys.adminList(filters),
    queryFn: () =>
      api.get<WebspaceDto[]>('/admin/webspaces', { kind: 'website', providerId: filters.providerId }),
    enabled,
  });

export const useAdminWebsiteAllowance = (orgId: string, enabled = true) =>
  useQuery({
    queryKey: websiteKeys.adminAllowance(orgId),
    queryFn: () => api.get<WebsiteAllowanceDto | null>(`/admin/orgs/${orgId}/website-allowance`),
    enabled: !!orgId && enabled,
  });

export interface AdminWebsiteAllowanceInput {
  providerId: string;
  maxSites: number;
  maxDatabases: number;
  siteTypes: CreatableWebsiteType[];
  enableModule: boolean;
}

export const useSetAdminWebsiteAllowance = (
  orgId: string,
  options: WebsiteMutationOptions<AdminWebsiteAllowanceInput, WebsiteAllowanceDto> = {},
) =>
  useWebsiteMutation(
    (body: AdminWebsiteAllowanceInput) =>
      api.put<WebsiteAllowanceDto>(`/admin/orgs/${orgId}/website-allowance`, body),
    allowanceViews,
    options,
  );

export const useDeleteAdminWebsiteAllowance = (
  orgId: string,
  options: WebsiteMutationOptions<void, { ok: true }> = {},
) =>
  useWebsiteMutation(
    () => api.del<{ ok: true }>(`/admin/orgs/${orgId}/website-allowance`),
    allowanceViews,
    options,
  );

export type AdminWebsiteCreateRequest = WebsiteCreateRequest & {
  providerId: string;
  /** null: unassigned, staff assign it later. */
  orgId: string | null;
};

/** Staff create on any instance, for any organization, without allowance checks. */
export const useAdminCreateWebsite = (
  options: WebsiteMutationOptions<AdminWebsiteCreateRequest, WebsiteCreatedDto> = {},
) =>
  useWebsiteMutation(
    (body: AdminWebsiteCreateRequest) => api.post<WebsiteCreatedDto>('/admin/websites', body),
    // A target organization can get the module.
    [...websiteViews(), ['org'], qk.admin('org'), qk.admin('orgs')],
    { ...options, gcTime: 0, refreshOnError: true },
  );

/** What staff can create on an instance: every application and type the server has. */
export const useAdminWebsiteOptions = (providerId: string) =>
  useQuery({
    queryKey: websiteKeys.adminOptions(providerId),
    queryFn: () => api.get<WebsiteServerOptions>(`/admin/providers/${providerId}/websites/options`),
    enabled: !!providerId,
    retry: false,
  });

/** Sites on the server the console does not manage, read live (only when asked for). */
export const useUnmanagedWebsites = (providerId: string, enabled = true) =>
  useQuery({
    queryKey: websiteKeys.unmanaged(providerId),
    queryFn: () => api.get<UnmanagedWebsitesDto>(`/admin/providers/${providerId}/websites/unmanaged`),
    enabled: !!providerId && enabled,
    retry: false,
  });

/** Only when the server allows remote adoption. The website arrives unassigned. */
export const useAdoptWebsite = (
  providerId: string,
  options: WebsiteMutationOptions<{ domain: string }, WebspaceDto> = {},
) =>
  useWebsiteMutation(
    (body: { domain: string }) =>
      api.post<WebspaceDto>(`/admin/providers/${providerId}/websites/adopt`, body),
    [...websiteViews(), websiteKeys.unmanaged(providerId)],
    options,
  );

/** Drops an unassigned or missing website from the console. The site stays on the server. */
export const useForgetWebsite = (options: WebsiteMutationOptions<WebspaceDto, { ok: true }> = {}) => {
  const qc = useQueryClient();
  return useWebsiteMutation(
    (website: WebspaceDto) => api.post<{ ok: true }>(`/admin/webspaces/${website.id}/forget`),
    (website) => [...websiteViews(), websiteKeys.unmanaged(website.provider.id)],
    {
      ...options,
      onSuccess: (result, website) => {
        options.onSuccess?.(result, website);
        qc.removeQueries({ queryKey: hostingKeys.webspace(website.id) });
      },
    },
  );
};

// --- Reseller ----------------------------------------------------------------------

export const useResellerWebsiteAllowance = (customerId: string) =>
  useQuery({
    queryKey: websiteKeys.resellerAllowance(customerId),
    queryFn: () => api.get<WebsiteAllowanceDto | null>(`/reseller/customers/${customerId}/website-allowance`),
    retry: false,
  });

export interface ResellerWebsiteAllowanceInput {
  maxSites: number;
  maxDatabases: number;
  siteTypes: CreatableWebsiteType[];
}

/** On the reseller's own instance, out of its own allowance. Switches the module on for the customer. */
export const useSetResellerWebsiteAllowance = (
  customerId: string,
  options: WebsiteMutationOptions<ResellerWebsiteAllowanceInput, WebsiteAllowanceDto> = {},
) =>
  useWebsiteMutation(
    (body: ResellerWebsiteAllowanceInput) =>
      api.put<WebsiteAllowanceDto>(`/reseller/customers/${customerId}/website-allowance`, body),
    allowanceViews,
    options,
  );

/** Gives the allowance back to the reseller. Only while the customer has no websites. */
export const useDeleteResellerWebsiteAllowance = (
  customerId: string,
  options: WebsiteMutationOptions<void, { ok: true }> = {},
) =>
  useWebsiteMutation(
    () => api.del<{ ok: true }>(`/reseller/customers/${customerId}/website-allowance`),
    allowanceViews,
    options,
  );
