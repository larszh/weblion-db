import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  MonitorAllowanceDto,
  MonitorDetailDto,
  MonitorDto,
  MonitorHistoryDto,
  MonitorHistoryRange,
  MonitorKind,
  MonitorOrigin,
  MonitorStatus,
  MonitorStatusPageDto,
  MonitoringInstanceDto,
  OrgMonitoringDto,
  ProviderConnectionDto,
} from '@weblion/shared';
import { api, errorMessage } from '@/lib/api';
import { qk } from '@/lib/queries';

/**
 * Query hooks for monitoring (module "monitoring", Uptime Kuma): the monitors of an
 * organization with their live facts and history, the related monitors of servers and domains,
 * and in the admin area the instances (management sign-in), the inventory with its assignment,
 * allowances and status page links. Reseller hooks hand a share of the allowance to customers.
 */

export const monitoringKeys = {
  all: ['monitoring'] as const,
  org: (orgId: string) => ['monitoring', 'org', orgId] as const,
  monitor: (id: string) => ['monitoring', 'monitor', id] as const,
  history: (id: string, range: MonitorHistoryRange) => ['monitoring', 'history', id, range] as const,
  related: (kind: 'server' | 'domain', id: string) => ['monitoring', 'related', kind, id] as const,
  admin: (filters?: object) => ['monitoring', 'admin', filters ?? {}] as const,
  instances: ['monitoring', 'instances'] as const,
  adminAllowance: (orgId: string) => ['monitoring', 'allowance', orgId] as const,
  statusPages: (orgId: string) => ['monitoring', 'status-pages', orgId] as const,
  resellerAllowance: (customerId: string) => ['monitoring', 'reseller', customerId] as const,
};

/**
 * Connections that can have monitors: Uptime Kuma, and the demo provider's simulation. The
 * opt-in demos with a flavor (Cloudflare, CloudPanel) are demo connections as well but simulate
 * DNS zones or websites only.
 */
export const isMonitoringProvider = (
  p: Pick<ProviderConnectionDto, 'type'> & { summary?: Record<string, string> },
) => p.type === 'uptimekuma' || (p.type === 'demo' && !p.summary?.flavor);

/** Monitors, allowances and the organization data (an allowance or assignment can switch the module on). */
const everywhere: QueryKey[] = [monitoringKeys.all, ['org'], qk.orgs, qk.admin('org'), qk.admin('orgs')];

/** Formats an error for the toast; null shows no toast (the dialog shows it at the field). */
export type MonitoringErrorFormatter = (err: unknown) => string | null;

export interface MonitoringMutationOptions<TVars, TResult> {
  success?: string | ((result: TResult, vars: TVars) => string | null);
  onSuccess?: (result: TResult, vars: TVars) => void;
  error?: MonitoringErrorFormatter;
}

/**
 * Like useApiMutation (toast on success and error, then the given keys are refreshed), with a
 * formatter for the error toast: the monitoring pages translate the API's own refusals (full
 * allowance, read-only monitors) and leave field errors to the dialog.
 */
function useMonitoringMutation<TVars, TResult>(
  fn: (vars: TVars) => Promise<TResult>,
  options: MonitoringMutationOptions<TVars, TResult> & { invalidate: QueryKey[]; gcTime?: number },
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    ...(options.gcTime !== undefined ? { gcTime: options.gcTime } : {}),
    onSuccess: (result, vars) => {
      const message = typeof options.success === 'function' ? options.success(result, vars) : options.success;
      if (message) toast.success(message);
      for (const key of options.invalidate) void qc.invalidateQueries({ queryKey: key });
      options.onSuccess?.(result, vars);
    },
    onError: (err) => {
      const message = (options.error ?? errorMessage)(err);
      if (message) toast.error(message);
    },
  });
}

// --- Customer view -----------------------------------------------------------------

/** Monitors of the organization (any instance), its allowance and status pages. */
export const useOrgMonitoring = (orgId: string, enabled = true) =>
  useQuery({
    queryKey: monitoringKeys.org(orgId),
    queryFn: () => api.get<OrgMonitoringDto>(`/orgs/${orgId}/monitoring`),
    enabled,
    retry: false,
    refetchInterval: 60_000,
  });

/** Live facts, configuration and recent events; `liveError` is set when Uptime Kuma did not answer. */
export const useMonitor = (id: string | undefined, enabled = true) =>
  useQuery({
    queryKey: monitoringKeys.monitor(id ?? ''),
    queryFn: () => api.get<MonitorDetailDto>(`/monitors/${id}`),
    enabled: !!id && enabled,
    retry: false,
    refetchInterval: 60_000,
  });

/** 404 when no history is available for the monitor and range. */
export const useMonitorHistory = (id: string, range: MonitorHistoryRange, enabled = true) =>
  useQuery({
    queryKey: monitoringKeys.history(id, range),
    queryFn: () => api.get<MonitorHistoryDto>(`/monitors/${id}/history`, { range }),
    enabled,
    retry: false,
    // Keep the previous frame while another range loads instead of flashing a skeleton.
    placeholderData: (prev) => prev,
    refetchInterval: range === 'recent' || range === '24h' ? 60_000 : false,
  });

/** Monitors of the same organization that check a server's addresses or a domain's names. */
export const useRelatedMonitors = (kind: 'server' | 'domain', id: string, enabled = true) =>
  useQuery({
    queryKey: monitoringKeys.related(kind, id),
    queryFn: () =>
      api.get<MonitorDto[]>('/monitors/related', kind === 'server' ? { serverId: id } : { domainId: id }),
    enabled: !!id && enabled,
    retry: false,
  });

/** What the form sends for a new monitor; the API applies its defaults to what is left out. */
export interface CreateMonitorInput {
  kind: MonitorKind;
  name: string;
  url?: string | null;
  hostname?: string | null;
  port?: number | null;
  keyword?: string | null;
  invertKeyword?: boolean;
  method?: 'GET' | 'HEAD';
  acceptedStatusCodes?: string[];
  intervalSeconds: number;
  ignoreTls?: boolean;
}

/** Fields left out keep their value; the kind never changes. */
export type MonitorPatchInput = Partial<Omit<CreateMonitorInput, 'kind'>>;

export const useCreateMonitor = (
  orgId: string,
  options: MonitoringMutationOptions<CreateMonitorInput, MonitorDto>,
) =>
  useMonitoringMutation(
    (body: CreateMonitorInput) => api.post<MonitorDto>(`/orgs/${orgId}/monitors`, body),
    // The organization's monitor count (dashboard) changes too.
    { ...options, invalidate: [monitoringKeys.all, ['org']] },
  );

export interface UpdateMonitorVars {
  id: string;
  patch: MonitorPatchInput;
}

export const useUpdateMonitor = (options: MonitoringMutationOptions<UpdateMonitorVars, MonitorDto>) =>
  useMonitoringMutation(
    ({ id, patch }: UpdateMonitorVars) => api.patch<MonitorDto>(`/monitors/${id}`, patch),
    { ...options, invalidate: [monitoringKeys.all] },
  );

export const usePauseMonitor = (options: MonitoringMutationOptions<MonitorDto, MonitorDto>) =>
  useMonitoringMutation((monitor: MonitorDto) => api.post<MonitorDto>(`/monitors/${monitor.id}/pause`), {
    ...options,
    invalidate: [monitoringKeys.all],
  });

export const useResumeMonitor = (options: MonitoringMutationOptions<MonitorDto, MonitorDto>) =>
  useMonitoringMutation((monitor: MonitorDto) => api.post<MonitorDto>(`/monitors/${monitor.id}/resume`), {
    ...options,
    invalidate: [monitoringKeys.all],
  });

/** Deletes the monitor and its history in Uptime Kuma. `confirm` is the display name. */
export const useDeleteMonitor = (options: MonitoringMutationOptions<MonitorDto, { ok: true }>) =>
  useMonitoringMutation(
    (monitor: MonitorDto) => api.del<{ ok: true }>(`/monitors/${monitor.id}`, { confirm: monitor.name }),
    { ...options, invalidate: [monitoringKeys.all, ['org']] },
  );

// --- Admin -------------------------------------------------------------------------

export interface AdminMonitorFilters {
  q?: string;
  orgId?: string;
  providerId?: string;
  assigned?: 'true' | 'false';
  origin?: MonitorOrigin;
  status?: MonitorStatus;
}

export const useAdminMonitors = (filters: AdminMonitorFilters) =>
  useQuery({
    queryKey: monitoringKeys.admin(filters),
    queryFn: () => api.get<MonitorDto[]>('/admin/monitors', { ...filters }),
    placeholderData: (prev) => prev,
  });

/** One entry per monitoring connection; checks the management session (cached 60 s by the adapter). */
export const useMonitoringInstances = (enabled = true) =>
  useQuery({
    queryKey: monitoringKeys.instances,
    queryFn: () => api.get<MonitoringInstanceDto[]>('/admin/monitoring/instances'),
    enabled,
  });

export interface AssignMonitorVars {
  id: string;
  orgId: string | null;
  enableModule: boolean;
}

export const useAssignMonitor = (options: MonitoringMutationOptions<AssignMonitorVars, MonitorDto>) =>
  useMonitoringMutation(
    ({ id, orgId, enableModule }: AssignMonitorVars) =>
      api.post<MonitorDto>(`/admin/monitors/${id}/assign`, { orgId, enableModule }),
    { ...options, invalidate: [...everywhere, ['reseller']] },
  );

export interface BulkAssignVars {
  providerId: string;
  orgId: string;
  enableModule: boolean;
}

/** Every unassigned monitor of an instance to one organization (dedicated instances). */
export const useBulkAssignMonitors = (
  options: MonitoringMutationOptions<BulkAssignVars, { assigned: number }>,
) =>
  useMonitoringMutation(
    (body: BulkAssignVars) => api.post<{ assigned: number }>('/admin/monitors/assign-bulk', body),
    { ...options, invalidate: [...everywhere, ['reseller']] },
  );

export const useAdminMonitorAllowance = (orgId: string, enabled = true) =>
  useQuery({
    queryKey: monitoringKeys.adminAllowance(orgId),
    queryFn: () => api.get<MonitorAllowanceDto | null>(`/admin/orgs/${orgId}/monitor-allowance`),
    enabled: !!orgId && enabled,
  });

export interface AdminMonitorAllowanceInput {
  providerId: string;
  maxMonitors: number;
  minIntervalSeconds: number;
  enableModule: boolean;
}

export const useSetAdminMonitorAllowance = (
  orgId: string,
  options: MonitoringMutationOptions<AdminMonitorAllowanceInput, MonitorAllowanceDto>,
) =>
  useMonitoringMutation(
    (body: AdminMonitorAllowanceInput) =>
      api.put<MonitorAllowanceDto>(`/admin/orgs/${orgId}/monitor-allowance`, body),
    { ...options, invalidate: [...everywhere, ['reseller']] },
  );

export const useDeleteAdminMonitorAllowance = (
  orgId: string,
  options: MonitoringMutationOptions<void, { ok: true }>,
) =>
  useMonitoringMutation(() => api.del<{ ok: true }>(`/admin/orgs/${orgId}/monitor-allowance`), {
    ...options,
    invalidate: [...everywhere, ['reseller']],
  });

export const useAdminStatusPages = (orgId: string, enabled = true) =>
  useQuery({
    queryKey: monitoringKeys.statusPages(orgId),
    queryFn: () => api.get<MonitorStatusPageDto[]>(`/admin/orgs/${orgId}/monitor-status-pages`),
    enabled: !!orgId && enabled,
  });

export interface StatusPageInput {
  providerId: string;
  slug: string;
  /** Public address when the page has a domain of its own; empty for <instance>/status/<slug>. */
  url: string;
}

export const useSetStatusPage = (
  orgId: string,
  options: MonitoringMutationOptions<StatusPageInput, MonitorStatusPageDto>,
) =>
  useMonitoringMutation(
    (body: StatusPageInput) =>
      api.put<MonitorStatusPageDto>(`/admin/orgs/${orgId}/monitor-status-page`, body),
    { ...options, invalidate: [monitoringKeys.all] },
  );

export const useDeleteStatusPage = (
  orgId: string,
  options: MonitoringMutationOptions<MonitorStatusPageDto, { ok: true }>,
) =>
  useMonitoringMutation(
    (page: MonitorStatusPageDto) =>
      api.del<{ ok: true }>(`/admin/orgs/${orgId}/monitor-status-page/${page.provider.id}`),
    { ...options, invalidate: [monitoringKeys.all] },
  );

export interface KumaSignInInput {
  username: string;
  password: string;
  totp?: string;
}

/**
 * Exchanges the Uptime Kuma login for its session token (stored encrypted by the API, never
 * returned). gcTime 0: the variables with the password leave the mutation cache as soon as the
 * dialog is gone; the dialog also resets the mutation itself.
 */
export const useKumaSignIn = (
  providerId: string,
  options: MonitoringMutationOptions<KumaSignInInput, MonitoringInstanceDto>,
) =>
  useMonitoringMutation(
    (body: KumaSignInInput) =>
      api.post<MonitoringInstanceDto>(`/admin/providers/${providerId}/uptimekuma/session`, body),
    { ...options, invalidate: [monitoringKeys.all, qk.admin('providers')], gcTime: 0 },
  );

export const useKumaSignOut = (
  providerId: string,
  options: MonitoringMutationOptions<void, MonitoringInstanceDto>,
) =>
  useMonitoringMutation(
    () => api.del<MonitoringInstanceDto>(`/admin/providers/${providerId}/uptimekuma/session`),
    { ...options, invalidate: [monitoringKeys.all, qk.admin('providers')] },
  );

// --- Reseller ----------------------------------------------------------------------

export const useResellerMonitorAllowance = (customerId: string) =>
  useQuery({
    queryKey: monitoringKeys.resellerAllowance(customerId),
    queryFn: () => api.get<MonitorAllowanceDto | null>(`/reseller/customers/${customerId}/monitor-allowance`),
    retry: false,
  });

export interface ResellerMonitorAllowanceInput {
  maxMonitors: number;
  minIntervalSeconds: number;
}

/** Saving switches the module on for the customer, so the reseller's customer data is stale too. */
export const useSetResellerMonitorAllowance = (
  customerId: string,
  options: MonitoringMutationOptions<ResellerMonitorAllowanceInput, MonitorAllowanceDto>,
) =>
  useMonitoringMutation(
    (body: ResellerMonitorAllowanceInput) =>
      api.put<MonitorAllowanceDto>(`/reseller/customers/${customerId}/monitor-allowance`, body),
    { ...options, invalidate: [...everywhere, ['reseller']] },
  );

/** Gives the monitors back to the reseller (e.g. before the customer is deleted). Only without console monitors. */
export const useDeleteResellerMonitorAllowance = (
  customerId: string,
  options: MonitoringMutationOptions<void, { ok: true }>,
) =>
  useMonitoringMutation(() => api.del<{ ok: true }>(`/reseller/customers/${customerId}/monitor-allowance`), {
    ...options,
    invalidate: [...everywhere, ['reseller']],
  });
