import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  AdminOrgDto,
  BillingSummaryDto,
  IntegrationsDto,
  MailLogDto,
  MailSettingsDto,
  ModuleKey,
  OrgKind,
  OrgStatus,
  Paginated,
  ResellerCustomerDto,
} from '@weblion/shared';
import { api } from '@/lib/api';
import { qk, useApiMutation } from '@/lib/queries';

/**
 * Query hooks for the reseller area, customer management in the admin area and the
 * platform settings (mail, integrations).
 */

export const adminKeys = {
  customers: (resellerId: string) => ['reseller', resellerId, 'customers'] as const,
  customer: (resellerId: string, customerId: string) =>
    ['reseller', resellerId, 'customers', customerId] as const,
  resources: (resellerId: string, customerId: string) =>
    ['reseller', resellerId, 'customers', customerId, 'resources'] as const,
  mailSettings: ['settings', 'mail'] as const,
  mailLog: (params: object) => ['settings', 'mail-log', params] as const,
  integrations: ['settings', 'integrations'] as const,
  // Under the billing prefix so billing mutations that invalidate ['billing'] refresh these too.
  billingSummary: (orgId: string) => ['billing', 'summary', orgId] as const,
};

export type MailResult = { status: 'sent' | 'failed' | 'skipped'; error?: string };

// --- Admin organizations -----------------------------------------------------------

export interface AdminOrgFilters {
  q?: string;
  kind?: OrgKind;
  parentOrgId?: string;
}

/** GET /admin/orgs with filters. Keyed below qk.admin('orgs') so existing invalidations apply. */
export const useAdminOrgList = (filters: AdminOrgFilters, enabled = true) =>
  useQuery({
    queryKey: qk.admin('orgs', filters),
    queryFn: () => api.get<AdminOrgDto[]>('/admin/orgs', { ...filters }),
    enabled,
    placeholderData: (prev) => prev,
  });

export interface AdminOrgInput {
  name: string;
  kind: OrgKind;
  parentOrgId?: string | null;
  modules?: ModuleKey[];
  ownerEmail?: string;
  notes?: string;
}

export type AdminOrgCreated = AdminOrgDto & { inviteLink: string | null; mail: MailResult | null };

export const useCreateAdminOrg = (onSuccess: (result: AdminOrgCreated) => void) =>
  useApiMutation((body: AdminOrgInput) => api.post<AdminOrgCreated>('/admin/orgs', body), {
    invalidate: [qk.admin('orgs'), qk.admin('stats')],
    onSuccess,
  });

export interface AdminOrgPatch {
  name?: string;
  kind?: OrgKind;
  parentOrgId?: string | null;
  modules?: ModuleKey[];
  status?: OrgStatus;
  notes?: string | null;
  boundary?: unknown;
}

/** PATCH /admin/orgs/:id. A module or kind change affects the org pages and resellers too. */
export const useUpdateAdminOrg = (orgId: string, success: string) =>
  useApiMutation((body: AdminOrgPatch) => api.patch<AdminOrgDto>(`/admin/orgs/${orgId}`, body), {
    success,
    invalidate: [qk.admin('org', { id: orgId }), qk.admin('orgs'), ['org'], ['reseller'], qk.orgs],
  });

/**
 * Deleting answers 409 with the attached records (counts) as details. The page shows them
 * in the dialog, so errors are not toasted here.
 */
export function useDeleteOrg(path: string, success: string, onSuccess: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del<{ ok: true }>(path),
    onSuccess: () => {
      toast.success(success);
      void qc.invalidateQueries({ queryKey: qk.admin('orgs') });
      void qc.invalidateQueries({ queryKey: qk.admin('stats') });
      void qc.invalidateQueries({ queryKey: ['reseller'] });
      void qc.invalidateQueries({ queryKey: qk.orgs });
      onSuccess();
    },
  });
}

// --- Reseller area -----------------------------------------------------------------

export const useResellerCustomers = (resellerId: string, enabled = true) =>
  useQuery({
    queryKey: adminKeys.customers(resellerId),
    queryFn: () => api.get<ResellerCustomerDto[]>(`/orgs/${resellerId}/customers`),
    enabled,
  });

export const useResellerCustomer = (resellerId: string, customerId: string | undefined) =>
  useQuery({
    queryKey: adminKeys.customer(resellerId, customerId ?? ''),
    queryFn: () => api.get<ResellerCustomerDto>(`/orgs/${resellerId}/customers/${customerId}`),
    enabled: !!customerId,
    retry: false,
  });

export interface ResellerCustomerInput {
  name: string;
  ownerEmail?: string;
  modules: ModuleKey[];
  notes?: string;
}

export interface ResellerCustomerCreated {
  customer: ResellerCustomerDto;
  inviteLink: string | null;
  mail: MailResult | null;
}

export const useCreateResellerCustomer = (
  resellerId: string,
  onSuccess: (result: ResellerCustomerCreated) => void,
) =>
  useApiMutation(
    (body: ResellerCustomerInput) => api.post<ResellerCustomerCreated>(`/orgs/${resellerId}/customers`, body),
    { invalidate: [adminKeys.customers(resellerId), ['org']], onSuccess },
  );

export interface ResellerCustomerPatch {
  name?: string;
  status?: OrgStatus;
  modules?: ModuleKey[];
  notes?: string | null;
}

export const useUpdateResellerCustomer = (resellerId: string, customerId: string, success: string) =>
  useApiMutation(
    (body: ResellerCustomerPatch) =>
      api.patch<ResellerCustomerDto>(`/orgs/${resellerId}/customers/${customerId}`, body),
    // The customer's own org page (modules, status) is cached under ['org', ...] as well.
    { success, invalidate: [adminKeys.customers(resellerId), ['org'], ['billing']] },
  );

export interface CustomerResources {
  servers: { id: string; name: string; projectId: string }[];
  domains: { id: string; name: string }[];
  webspaces: { id: string; name: string }[];
  mailDomains: { id: string; name: string }[];
  /** What the reseller organization itself holds and can hand out. */
  pool: {
    servers: { id: string; name: string; projectId: string }[];
    domains: { id: string; name: string }[];
    webspaces: { id: string; name: string }[];
    mailDomains: { id: string; name: string }[];
  };
}

export type ResourceType = 'server' | 'domain' | 'webspace' | 'maildomain';

export const useCustomerResources = (resellerId: string, customerId: string, enabled = true) =>
  useQuery({
    queryKey: adminKeys.resources(resellerId, customerId),
    queryFn: () => api.get<CustomerResources>(`/orgs/${resellerId}/customers/${customerId}/resources`),
    enabled,
  });

export function useMoveResource(
  resellerId: string,
  customerId: string,
  direction: 'assign' | 'release',
  success: string,
) {
  return useApiMutation(
    (body: { type: ResourceType; id: string }) =>
      api.post<{ ok: true }>(
        `/orgs/${resellerId}/customers/${customerId}/resources${direction === 'release' ? '/release' : ''}`,
        body,
      ),
    {
      success,
      // Counts, modules (assigning can switch one on) and the hosting/server lists change.
      invalidate: [['reseller', resellerId], ['org'], ['hosting'], ['mail'], ['servers'], ['projects']],
    },
  );
}

// --- Dashboard ---------------------------------------------------------------------

export const useBillingSummary = (orgId: string, enabled = true) =>
  useQuery({
    queryKey: adminKeys.billingSummary(orgId),
    queryFn: () => api.get<BillingSummaryDto>(`/orgs/${orgId}/billing/summary`),
    enabled,
    retry: false,
  });

// --- Settings: mail ----------------------------------------------------------------

export const useMailSettings = (enabled = true) =>
  useQuery({
    queryKey: adminKeys.mailSettings,
    queryFn: () => api.get<MailSettingsDto>('/admin/settings/mail'),
    enabled,
  });

export interface MailSettingsInput {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  /** Omitted keeps the stored password, "" removes it. */
  password?: string;
  from: string;
  replyTo: string | null;
}

export const useSaveMailSettings = (success: string) =>
  useApiMutation((body: MailSettingsInput) => api.put<MailSettingsDto>('/admin/settings/mail', body), {
    success,
    invalidate: [adminKeys.mailSettings, adminKeys.integrations],
  });

export const useDeleteMailSettings = (success: string, onSuccess?: () => void) =>
  useApiMutation(() => api.del<MailSettingsDto>('/admin/settings/mail'), {
    success,
    invalidate: [adminKeys.mailSettings, adminKeys.integrations],
    onSuccess,
  });

export const useTestMail = () =>
  useApiMutation((to: string) => api.post<MailResult>('/admin/settings/mail/test', { to }), {
    invalidate: [['settings', 'mail-log']],
  });

export interface MailLogParams {
  page: number;
  perPage?: number;
  status?: MailLogDto['status'];
}

export const useMailLog = (params: MailLogParams, enabled = true) =>
  useQuery({
    queryKey: adminKeys.mailLog(params),
    queryFn: () => api.get<Paginated<MailLogDto>>('/admin/mail-log', { perPage: 25, ...params }),
    enabled,
    placeholderData: (prev) => prev,
  });

// --- Settings: integrations --------------------------------------------------------

export const useIntegrations = () =>
  useQuery({
    queryKey: adminKeys.integrations,
    queryFn: () => api.get<IntegrationsDto>('/admin/integrations'),
  });

export const useZohoTest = () =>
  useApiMutation(
    () =>
      api.post<{ ok: boolean; organizationName?: string; error?: string }>('/admin/integrations/zoho/test'),
    { invalidate: [adminKeys.integrations] },
  );

export const useZohoSyncPending = (success: (r: { synced: number; failed: number }) => string) =>
  useApiMutation(
    () => api.post<{ synced: number; failed: number }>('/admin/integrations/zoho/sync-pending'),
    { success, invalidate: [adminKeys.integrations, ['billing']] },
  );
