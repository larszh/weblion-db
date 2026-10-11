import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  MailAliasDto,
  MailDkimKeySize,
  MailDnsApplyResult,
  MailDnsRecordKey,
  MailDnsSetupDto,
  MailDomainChangeResult,
  MailDomainDetailDto,
  MailDomainDto,
  MailRateLimit,
  MailboxDto,
  MailboxSecretDto,
  MailboxState,
} from '@weblion/shared';
import { api, errorMessage } from '@/lib/api';
import { qk } from '@/lib/queries';

/**
 * Query hooks for e-mail (module "mail", Mailcow): mail domains of an organization with
 * their mailboxes, aliases and DNS setup, and the mail domain inventory of the platform.
 * Mailboxes and aliases are read live from Mailcow; nothing of them is stored by the API.
 */

export const mailKeys = {
  all: ['mail'] as const,
  org: (orgId: string) => ['mail', 'org', orgId] as const,
  domain: (id: string) => ['mail', 'domain', id] as const,
  mailboxes: (id: string) => ['mail', 'domain', id, 'mailboxes'] as const,
  aliases: (id: string) => ['mail', 'domain', id, 'aliases'] as const,
  dns: (id: string) => ['mail', 'domain', id, 'dns'] as const,
  admin: (filters?: object) => ['mail', 'admin', filters ?? {}] as const,
};

/** Mail data and the organization data (assigning a mail domain can switch the module on). */
const everywhere: QueryKey[] = [
  mailKeys.all,
  ['org'],
  qk.orgs,
  qk.admin('org'),
  qk.admin('orgs'),
  ['reseller'],
];

/** Formats an error for the toast; the mail pages translate the panel's limit answers. */
export type MailErrorFormatter = (err: unknown) => string;

interface MailMutationOptions<TVars, TResult> {
  success?: string | ((result: TResult, vars: TVars) => string | null);
  onSuccess?: (result: TResult, vars: TVars) => void;
  error?: MailErrorFormatter;
}

/**
 * Like useApiMutation (toast on success and error), with a formatter for the error toast and
 * a refresh callback instead of a key list: the detail query of a mail domain is refreshed
 * on its own, without the DNS setup below it (which reads the whole zone).
 */
function useMailMutation<TVars, TResult>(
  fn: (vars: TVars) => Promise<TResult>,
  options: MailMutationOptions<TVars, TResult> & {
    refresh?: (result: TResult, vars: TVars) => void;
    gcTime?: number;
  },
) {
  return useMutation({
    mutationFn: fn,
    ...(options.gcTime !== undefined ? { gcTime: options.gcTime } : {}),
    onSuccess: (result, vars) => {
      const message = typeof options.success === 'function' ? options.success(result, vars) : options.success;
      if (message) toast.success(message);
      options.refresh?.(result, vars);
      options.onSuccess?.(result, vars);
    },
    onError: (err) => {
      toast.error((options.error ?? errorMessage)(err));
    },
  });
}

/** Refreshes a mail domain (usage in the header and the lists) and the given lists below it. */
function useRefreshDomain(id: string) {
  const qc = useQueryClient();
  return (...lists: ('mailboxes' | 'aliases')[]) => {
    void qc.invalidateQueries({ queryKey: mailKeys.domain(id), exact: true });
    for (const list of lists) void qc.invalidateQueries({ queryKey: [...mailKeys.domain(id), list] });
    void qc.invalidateQueries({ queryKey: ['mail', 'org'] });
    void qc.invalidateQueries({ queryKey: ['mail', 'admin'] });
  };
}

// --- Customer view -------------------------------------------------------------------

export const useOrgMailDomains = (orgId: string, enabled = true) =>
  useQuery({
    queryKey: mailKeys.org(orgId),
    queryFn: () => api.get<MailDomainDto[]>(`/orgs/${orgId}/mail/domains`),
    enabled,
    retry: false,
  });

/** Read live from Mailcow; `liveError` is set (and the stored values shown) when that fails. */
export const useMailDomain = (id: string | undefined) =>
  useQuery({
    queryKey: mailKeys.domain(id ?? ''),
    queryFn: () => api.get<MailDomainDetailDto>(`/mail/domains/${id}`),
    enabled: !!id,
    retry: false,
  });

export const useMailboxes = (id: string, enabled = true) =>
  useQuery({
    queryKey: mailKeys.mailboxes(id),
    queryFn: () => api.get<MailboxDto[]>(`/mail/domains/${id}/mailboxes`),
    enabled,
    retry: false,
  });

export const useMailAliases = (id: string, enabled = true) =>
  useQuery({
    queryKey: mailKeys.aliases(id),
    queryFn: () => api.get<MailAliasDto[]>(`/mail/domains/${id}/aliases`),
    enabled,
    retry: false,
  });

export const useMailDns = (id: string, enabled = true) =>
  useQuery({
    queryKey: mailKeys.dns(id),
    queryFn: () => api.get<MailDnsSetupDto>(`/mail/domains/${id}/dns`),
    enabled,
    retry: false,
  });

const mailboxPath = (id: string, address: string) =>
  `/mail/domains/${id}/mailboxes/${encodeURIComponent(address)}`;

export interface CreateMailboxInput {
  localPart: string;
  name?: string | null;
  /** Left out: the domain's default mailbox size. */
  quotaMb?: number;
  /** Left out: the API generates one and answers it once. */
  password?: string;
}

/** The answer carries a generated password once (null when the caller chose it). */
export const useCreateMailbox = (
  id: string,
  options: {
    success: (result: MailboxSecretDto) => string | null;
    onSuccess: (result: MailboxSecretDto) => void;
    error?: MailErrorFormatter;
  },
) => {
  const refresh = useRefreshDomain(id);
  return useMailMutation(
    (body: CreateMailboxInput) => api.post<MailboxSecretDto>(`/mail/domains/${id}/mailboxes`, body),
    // gcTime 0: the answer with the password leaves the mutation cache once the dialog is gone.
    { ...options, refresh: () => refresh('mailboxes'), gcTime: 0 },
  );
};

export interface MailboxPatchInput {
  /** Mailcow cannot remove a name, only replace it. */
  name?: string;
  quotaMb?: number;
  state?: MailboxState;
}

export const useUpdateMailbox = (
  id: string,
  options: {
    success: (mailbox: MailboxDto, vars: { address: string; patch: MailboxPatchInput }) => string;
    onSuccess?: (mailbox: MailboxDto) => void;
    error?: MailErrorFormatter;
  },
) => {
  const refresh = useRefreshDomain(id);
  return useMailMutation(
    ({ address, patch }: { address: string; patch: MailboxPatchInput }) =>
      api.patch<MailboxDto>(mailboxPath(id, address), patch),
    { ...options, refresh: () => refresh('mailboxes') },
  );
};

/**
 * A new password goes through a mutation, so it never lands in the query cache. Without
 * `password` the API generates one and answers it once. Call reset() to forget it again.
 */
export const useSetMailboxPassword = (id: string) =>
  useMutation({
    mutationFn: ({ address, password }: { address: string; password?: string }) =>
      api.post<{ password: string | null }>(
        `${mailboxPath(id, address)}/password`,
        password ? { password } : {},
      ),
    gcTime: 0,
    onError: (err) => {
      toast.error(errorMessage(err));
    },
  });

/** Deletes the mailbox and its mail. `confirm` is the address. */
export const useDeleteMailbox = (id: string, success: (address: string) => string, onSuccess: () => void) => {
  const refresh = useRefreshDomain(id);
  return useMailMutation(
    (address: string) => api.del<{ ok: true }>(mailboxPath(id, address), { confirm: address }),
    {
      success: (_r, address) => success(address),
      // Aliases that only pointed to the mailbox are gone, others lost a target.
      refresh: () => refresh('mailboxes', 'aliases'),
      onSuccess: () => onSuccess(),
    },
  );
};

export interface MailAliasInput {
  /** null: catch-all ("@domain"). */
  localPart: string | null;
  targets: string[];
  active: boolean;
}

export interface MailAliasPatchInput {
  targets?: string[];
  active?: boolean;
}

export const useCreateMailAlias = (
  id: string,
  options: {
    success: (alias: MailAliasDto) => string;
    onSuccess?: (alias: MailAliasDto) => void;
    error?: MailErrorFormatter;
  },
) => {
  const refresh = useRefreshDomain(id);
  return useMailMutation(
    (body: MailAliasInput) => api.post<MailAliasDto>(`/mail/domains/${id}/aliases`, body),
    { ...options, refresh: () => refresh('aliases') },
  );
};

export const useUpdateMailAlias = (
  id: string,
  options: {
    success: (alias: MailAliasDto, vars: { aliasId: string; patch: MailAliasPatchInput }) => string;
    onSuccess?: (alias: MailAliasDto) => void;
    error?: MailErrorFormatter;
  },
) => {
  const refresh = useRefreshDomain(id);
  return useMailMutation(
    ({ aliasId, patch }: { aliasId: string; patch: MailAliasPatchInput }) =>
      api.patch<MailAliasDto>(`/mail/domains/${id}/aliases/${encodeURIComponent(aliasId)}`, patch),
    { ...options, refresh: () => refresh('aliases') },
  );
};

export const useDeleteMailAlias = (
  id: string,
  success: (alias: MailAliasDto) => string,
  onSuccess: () => void,
) => {
  const refresh = useRefreshDomain(id);
  return useMailMutation(
    (alias: MailAliasDto) =>
      api.del<{ ok: true }>(`/mail/domains/${id}/aliases/${encodeURIComponent(alias.id)}`),
    {
      success: (_r, alias) => success(alias),
      refresh: () => refresh('aliases'),
      onSuccess: () => onSuccess(),
    },
  );
};

/** Answers the DNS setup with the new key, which replaces the cached one. */
export const useCreateDkim = (id: string, success: string) => {
  const qc = useQueryClient();
  return useMailMutation(
    (keySize: MailDkimKeySize) => api.post<MailDnsSetupDto>(`/mail/domains/${id}/dkim`, { keySize }),
    { success, refresh: (setup) => qc.setQueryData(mailKeys.dns(id), setup) },
  );
};

/** Adds the missing records to the panel's DNS zone; the zone's records change as well. */
export const useApplyMailDns = (
  id: string,
  options: {
    success: (result: MailDnsApplyResult) => string | null;
    onSuccess?: (result: MailDnsApplyResult) => void;
  },
) => {
  const qc = useQueryClient();
  return useMailMutation(
    (keys: MailDnsRecordKey[] | undefined) =>
      api.post<MailDnsApplyResult>(`/mail/domains/${id}/dns/apply`, keys ? { keys } : {}),
    {
      ...options,
      refresh: (result) => {
        qc.setQueryData(mailKeys.dns(id), result.setup);
        void qc.invalidateQueries({ queryKey: ['hosting'] });
      },
    },
  );
};

// --- Admin -------------------------------------------------------------------------

export interface AdminMailFilters {
  q?: string;
  assigned?: 'true' | 'false';
  providerId?: string;
  orgId?: string;
}

export const useAdminMailDomains = (filters: AdminMailFilters) =>
  useQuery({
    queryKey: mailKeys.admin(filters),
    queryFn: () => api.get<MailDomainDto[]>('/admin/mail/domains', { ...filters }),
    placeholderData: (prev) => prev,
  });

/** Limits as Mailcow takes them: whole MiB. */
export interface MailLimitsInput {
  maxMailboxes: number;
  maxAliases: number;
  quotaMb: number;
  defaultMailboxQuotaMb: number;
  maxMailboxQuotaMb: number;
  /** null = no rate limit. */
  rateLimit: MailRateLimit | null;
}

export interface CreateMailDomainInput {
  providerId: string;
  domain: string;
  description?: string | null;
  limits: MailLimitsInput;
  dkimKeySize: MailDkimKeySize;
  /** Restarts webmail (SOGo) of the whole instance; the request can take up to two minutes. */
  restartSogo: boolean;
  orgId: string | null;
  enableModule: boolean;
}

export interface MailDomainPatchInput {
  /** Only the limits that change. */
  limits?: Partial<MailLimitsInput>;
  active?: boolean;
}

interface AdminOptions<TVars, TResult> {
  success: (result: TResult, vars: TVars) => string;
  onSuccess?: (result: TResult, vars: TVars) => void;
  error?: MailErrorFormatter;
}

const useInvalidateEverywhere = () => {
  const qc = useQueryClient();
  return () => {
    for (const key of everywhere) void qc.invalidateQueries({ queryKey: key });
  };
};

export const useCreateMailDomain = (options: AdminOptions<CreateMailDomainInput, MailDomainChangeResult>) => {
  const refresh = useInvalidateEverywhere();
  return useMailMutation(
    (body: CreateMailDomainInput) => api.post<MailDomainChangeResult>('/admin/mail/domains', body),
    { ...options, refresh },
  );
};

export const useUpdateMailDomain = (
  options: AdminOptions<{ id: string; patch: MailDomainPatchInput }, MailDomainChangeResult>,
) => {
  const refresh = useInvalidateEverywhere();
  return useMailMutation(
    ({ id, patch }: { id: string; patch: MailDomainPatchInput }) =>
      api.patch<MailDomainChangeResult>(`/admin/mail/domains/${id}`, patch),
    { ...options, refresh },
  );
};

export interface DeleteMailDomainVars {
  id: string;
  /** The domain name (ASCII or Unicode). */
  confirm: string;
  /** Also delete the DKIM key, which Mailcow keeps after deleting a domain. */
  deleteDkim: boolean;
}

export const useDeleteMailDomain = (
  options: AdminOptions<DeleteMailDomainVars, { ok: true; warnings: string[] }>,
) => {
  const refresh = useInvalidateEverywhere();
  return useMailMutation(
    ({ id, confirm, deleteDkim }: DeleteMailDomainVars) =>
      api.del<{ ok: true; warnings: string[] }>(`/admin/mail/domains/${id}`, { confirm, deleteDkim }),
    { ...options, refresh },
  );
};

export interface AssignMailDomainVars {
  id: string;
  orgId: string | null;
  enableModule: boolean;
}

export const useAssignMailDomain = (options: AdminOptions<AssignMailDomainVars, MailDomainDto>) => {
  const refresh = useInvalidateEverywhere();
  return useMailMutation(
    ({ id, orgId, enableModule }: AssignMailDomainVars) =>
      api.post<MailDomainDto>(`/admin/mail/domains/${id}/assign`, { orgId, enableModule }),
    { ...options, refresh },
  );
};
