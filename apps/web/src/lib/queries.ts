import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  AdminOrgDto,
  ApiTokenDto,
  AuditEntryDto,
  BackupInfo,
  FirewallInfo,
  ImageOption,
  InvitationDto,
  IsoOption,
  MeDto,
  MemberDto,
  MetricRange,
  MetricsResult,
  MonitoringInfo,
  OrgDto,
  Paginated,
  PermissionDef,
  PermissionGroup,
  PolicyDto,
  PolicyStatement,
  ProjectDto,
  ProviderConnectionDto,
  ProviderTask,
  ServerActionDto,
  ServerDto,
  SessionDto,
  SnapshotInfo,
  TrafficInfo,
  DdosSettings,
  IpAddress,
  OrgRole,
  ProviderType,
  UserDto,
} from '@weblion/shared';
import { api, errorMessage } from './api';

export const qk = {
  me: ['me'] as const,
  meta: ['meta'] as const,
  orgs: ['orgs'] as const,
  orgBySlug: (slug: string) => ['org', 'slug', slug] as const,
  projects: (orgId: string) => ['projects', orgId] as const,
  servers: (orgId: string, filters?: object) => ['servers', orgId, filters ?? {}] as const,
  server: (id: string) => ['server', id] as const,
  serverSub: (id: string, sub: string, extra?: unknown) => ['server', id, sub, extra ?? null] as const,
  members: (orgId: string) => ['members', orgId] as const,
  invitations: (orgId: string) => ['invitations', orgId] as const,
  policies: (orgId: string) => ['policies', orgId] as const,
  tokens: (orgId: string) => ['tokens', orgId] as const,
  audit: (scope: string, params: object) => ['audit', scope, params] as const,
  admin: (sub: string, params?: object) => ['admin', sub, params ?? {}] as const,
};

export interface MetaDto {
  version: string;
  permissions: Record<string, PermissionDef>;
  permissionGroups: PermissionGroup[];
  orgRoles: OrgRole[];
  orgRolePolicies: Record<OrgRole, PolicyStatement[]>;
  platformRoles: string[];
  tokenScopes: string[];
  providerTypes: ProviderType[];
  providerLabels: Record<ProviderType, string>;
  defaultCustomerBoundary: PolicyStatement[];
}

export const useMe = () =>
  useQuery({ queryKey: qk.me, queryFn: () => api.get<MeDto>('/auth/me'), retry: false, staleTime: 60_000 });

export const useMeta = () =>
  useQuery({ queryKey: qk.meta, queryFn: () => api.get<MetaDto>('/meta'), staleTime: Infinity });

export const useOrgs = () => useQuery({ queryKey: qk.orgs, queryFn: () => api.get<OrgDto[]>('/orgs') });

export const useOrgBySlug = (slug: string | undefined) =>
  useQuery({
    queryKey: qk.orgBySlug(slug ?? ''),
    queryFn: () => api.get<OrgDto>(`/orgs/by-slug/${slug}`),
    enabled: !!slug,
    retry: false,
  });

export const useProjects = (orgId: string | undefined) =>
  useQuery({
    queryKey: qk.projects(orgId ?? ''),
    queryFn: () => api.get<ProjectDto[]>(`/orgs/${orgId}/projects`),
    enabled: !!orgId,
  });

export interface ServerFilters {
  projectId?: string;
  q?: string;
  status?: string;
  label?: string;
}

const hasTransitional = (servers: ServerDto[]) =>
  servers.some((s) =>
    ['starting', 'stopping', 'rebooting', 'installing', 'backup', 'restoring', 'migrating'].includes(
      s.status,
    ),
  );

export const useServers = (orgId: string | undefined, filters: ServerFilters = {}) =>
  useQuery({
    queryKey: qk.servers(orgId ?? '', filters),
    queryFn: () => api.get<ServerDto[]>(`/orgs/${orgId}/servers`, { ...filters }),
    enabled: !!orgId,
    refetchInterval: (q) => (q.state.data && hasTransitional(q.state.data) ? 4000 : 30_000),
  });

export const useServer = (id: string | undefined) =>
  useQuery({
    queryKey: qk.server(id ?? ''),
    queryFn: () => api.get<ServerDto>(`/servers/${id}`, { refresh: true }),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && hasTransitional([q.state.data]) ? 3000 : 20_000),
  });

export const useServerMetrics = (id: string, range: MetricRange, enabled = true) =>
  useQuery({
    queryKey: qk.serverSub(id, 'metrics', range),
    queryFn: () => api.get<MetricsResult>(`/servers/${id}/metrics`, { range }),
    enabled,
    // Keep the previous frame while another range loads instead of flashing a skeleton.
    placeholderData: (prev) => prev,
    refetchInterval: range === 'hour' ? 30_000 : false,
  });

export const useServerMonitoring = (id: string, enabled = true) =>
  useQuery({
    queryKey: qk.serverSub(id, 'monitoring'),
    queryFn: () => api.get<MonitoringInfo>(`/servers/${id}/monitoring`),
    enabled,
  });

export const useServerTraffic = (id: string, enabled = true) =>
  useQuery({
    queryKey: qk.serverSub(id, 'traffic'),
    queryFn: () => api.get<TrafficInfo>(`/servers/${id}/traffic`),
    enabled,
  });

export const useBackups = (id: string, enabled = true) =>
  useQuery({
    queryKey: qk.serverSub(id, 'backups'),
    queryFn: () => api.get<BackupInfo[]>(`/servers/${id}/backups`),
    enabled,
    refetchInterval: (q) => (q.state.data?.some((b) => b.status === 'running') ? 4000 : false),
  });

export const useSnapshots = (id: string, enabled = true) =>
  useQuery({
    queryKey: qk.serverSub(id, 'snapshots'),
    queryFn: () => api.get<SnapshotInfo[]>(`/servers/${id}/snapshots`),
    enabled,
  });

export const useServerTasks = (id: string, enabled = true) =>
  useQuery({
    queryKey: qk.serverSub(id, 'tasks'),
    queryFn: () =>
      api.get<{ actions: ServerActionDto[]; providerTasks: ProviderTask[] }>(`/servers/${id}/tasks`),
    enabled,
    refetchInterval: (q) =>
      q.state.data?.actions.some((a) => a.status === 'running') ||
      q.state.data?.providerTasks.some((p) => p.status === 'running')
        ? 3000
        : 15_000,
  });

export const useServerActivity = (id: string, page: number, enabled = true) =>
  useQuery({
    queryKey: qk.serverSub(id, 'activity', page),
    queryFn: () => api.get<Paginated<AuditEntryDto>>(`/servers/${id}/activity`, { page, perPage: 25 }),
    enabled,
  });

export const useServerNetwork = (id: string, enabled = true) =>
  useQuery({
    queryKey: qk.serverSub(id, 'network'),
    queryFn: () => api.get<{ ips: IpAddress[]; ddos: DdosSettings[] }>(`/servers/${id}/network`),
    enabled,
  });

export const useFirewall = (id: string, enabled = true) =>
  useQuery({
    queryKey: qk.serverSub(id, 'firewall'),
    queryFn: () => api.get<FirewallInfo>(`/servers/${id}/firewall`),
    enabled,
  });

export const useIsos = (id: string, enabled = true) =>
  useQuery({
    queryKey: qk.serverSub(id, 'isos'),
    queryFn: () => api.get<{ isos: IsoOption[]; mounted: string | null }>(`/servers/${id}/isos`),
    enabled,
  });

export const useImages = (id: string, enabled = true) =>
  useQuery({
    queryKey: qk.serverSub(id, 'images'),
    queryFn: () => api.get<ImageOption[]>(`/servers/${id}/images`),
    enabled,
  });

export const useServerConfig = (id: string, enabled = true) =>
  useQuery({
    queryKey: qk.serverSub(id, 'config'),
    queryFn: () => api.get<Record<string, unknown>>(`/servers/${id}/config`),
    enabled,
  });

export const useMembers = (orgId: string, enabled = true) =>
  useQuery({
    queryKey: qk.members(orgId),
    queryFn: () => api.get<MemberDto[]>(`/orgs/${orgId}/members`),
    enabled,
  });

export const useInvitations = (orgId: string, enabled = true) =>
  useQuery({
    queryKey: qk.invitations(orgId),
    queryFn: () => api.get<InvitationDto[]>(`/orgs/${orgId}/invitations`),
    enabled,
  });

export const usePolicies = (orgId: string, enabled = true) =>
  useQuery({
    queryKey: qk.policies(orgId),
    queryFn: () => api.get<PolicyDto[]>(`/orgs/${orgId}/policies`),
    enabled,
  });

export const useTokens = (orgId: string, enabled = true) =>
  useQuery({
    queryKey: qk.tokens(orgId),
    queryFn: () => api.get<ApiTokenDto[]>(`/orgs/${orgId}/tokens`),
    enabled,
  });

export interface AuditParams {
  page: number;
  perPage?: number;
  action?: string;
  status?: string;
  q?: string;
}

export const useAudit = (path: string, params: AuditParams, enabled = true) =>
  useQuery({
    queryKey: qk.audit(path, params),
    queryFn: () => api.get<Paginated<AuditEntryDto>>(path, { perPage: 50, ...params }),
    enabled,
    placeholderData: (prev) => prev,
  });

export const useSessions = () =>
  useQuery({ queryKey: ['sessions'], queryFn: () => api.get<SessionDto[]>('/auth/sessions') });

// --- Admin -------------------------------------------------------------------------

export interface AdminStats {
  organizations: { customers: number; internal: number };
  users: number;
  servers: { total: number; running: number; stopped: number; missing: number; unassigned: number };
  providers: { id: string; name: string; type: ProviderType; status: string; lastSyncAt: string | null }[];
  failedActions24h: number;
}

export interface AdminUser extends UserDto {
  memberships: { orgId: string; orgName: string; orgSlug: string; role: OrgRole }[];
}

export interface InfraOverview {
  version?: string | null;
  nodes: {
    name: string;
    status: string;
    cpuPercent: number | null;
    cores: number | null;
    memoryUsed: number | null;
    memoryTotal: number | null;
    uptimeSeconds: number | null;
  }[];
  storages: {
    name: string;
    node: string | null;
    type: string | null;
    used: number | null;
    total: number | null;
    content: string[];
    shared: boolean;
  }[];
  facts: { label: string; value: string }[];
}

export const useAdminStats = () =>
  useQuery({
    queryKey: qk.admin('stats'),
    queryFn: () => api.get<AdminStats>('/admin/stats'),
    refetchInterval: 30_000,
  });

export const useAdminProviders = () =>
  useQuery({
    queryKey: qk.admin('providers'),
    queryFn: () => api.get<ProviderConnectionDto[]>('/admin/providers'),
  });

export const useAdminOrgs = (q?: string) =>
  useQuery({
    queryKey: qk.admin('orgs', { q }),
    queryFn: () => api.get<AdminOrgDto[]>('/admin/orgs', { q }),
  });

export const useAdminOrg = (id: string) =>
  useQuery({
    queryKey: qk.admin('org', { id }),
    queryFn: () => api.get<AdminOrgDto & { projects: { id: string; name: string }[] }>(`/admin/orgs/${id}`),
    enabled: !!id,
  });

export const useAdminUsers = (q?: string) =>
  useQuery({
    queryKey: qk.admin('users', { q }),
    queryFn: () => api.get<AdminUser[]>('/admin/users', { q }),
  });

export const useAdminServers = (params: {
  assigned?: string;
  providerId?: string;
  q?: string;
  orgId?: string;
}) =>
  useQuery({
    queryKey: qk.admin('servers', params),
    queryFn: () => api.get<ServerDto[]>('/admin/servers', params),
    placeholderData: (prev) => prev,
  });

export const useProviderOverview = (id: string) =>
  useQuery({
    queryKey: qk.admin('provider-overview', { id }),
    queryFn: () => api.get<InfraOverview>(`/admin/providers/${id}/overview`),
    retry: false,
  });

export const useAdminActions = () =>
  useQuery({
    queryKey: qk.admin('actions'),
    queryFn: () => api.get<(ServerActionDto & { serverName: string })[]>('/admin/actions'),
    refetchInterval: 15_000,
  });

/**
 * Mutation helper: shows a toast on success and error, then invalidates the given keys.
 */
export function useApiMutation<TVars, TResult = unknown>(
  fn: (vars: TVars) => Promise<TResult>,
  options: {
    success?: string | ((result: TResult, vars: TVars) => string | null);
    invalidate?: QueryKey[] | ((vars: TVars) => QueryKey[]);
    onSuccess?: (result: TResult, vars: TVars) => void;
  } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (result, vars) => {
      const message = typeof options.success === 'function' ? options.success(result, vars) : options.success;
      if (message) toast.success(message);
      const keys =
        typeof options.invalidate === 'function' ? options.invalidate(vars) : (options.invalidate ?? []);
      for (const key of keys) void qc.invalidateQueries({ queryKey: key });
      options.onSuccess?.(result, vars);
    },
    onError: (err) => {
      toast.error(errorMessage(err));
    },
  });
}
