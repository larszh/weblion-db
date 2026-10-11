import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CdnSettingPatch,
  CdnSettings,
  DnsMovePreview,
  DnsMoveRequest,
  DnsMoveResult,
  DnsRecord,
} from '@weblion/shared';
import { api } from '@/lib/api';
import { qk, useApiMutation } from '@/lib/queries';
import { hostingKeys, type DomainActionResult } from './hosting';

/**
 * Query hooks for DNS zones (Cloudflare): CDN settings, activation check of pending zones,
 * the proxy flag of records and the platform-only DNS move.
 */

export const zoneKeys = {
  cdn: (id: string) => ['hosting', 'domain', id, 'cdn'] as const,
  move: (id: string, target?: string) => ['hosting', 'admin', 'dns-move', id, target ?? ''] as const,
};

export const useCdnSettings = (domainId: string, enabled = true) =>
  useQuery({
    queryKey: zoneKeys.cdn(domainId),
    queryFn: () => api.get<CdnSettings>(`/domains/${domainId}/cdn`),
    enabled,
    retry: false,
    // Development mode switches itself off after 3 hours: read again while it runs.
    refetchInterval: (q) => (q.state.data?.developmentMode ? 60_000 : false),
  });

/** One setting per call (sslMode, alwaysUseHttps or developmentMode). Answers the new settings. */
export function useUpdateCdnSetting(
  domainId: string,
  options: { success: (patch: CdnSettingPatch) => string },
) {
  const qc = useQueryClient();
  return useApiMutation(
    (patch: CdnSettingPatch) => api.patch<CdnSettings>(`/domains/${domainId}/cdn`, patch),
    {
      success: (_result, patch) => options.success(patch),
      invalidate: [zoneKeys.cdn(domainId)],
      onSuccess: (settings) => qc.setQueryData(zoneKeys.cdn(domainId), settings),
    },
  );
}

export const usePurgeCache = (domainId: string, options: { success: string }) =>
  useApiMutation<void, DomainActionResult>(
    () => api.post<DomainActionResult>(`/domains/${domainId}/cdn/purge`, { everything: true }),
    { success: options.success },
  );

/** Pending zones only (the API answers 409 otherwise). The status may change right away. */
export const useZoneActivationCheck = (domainId: string, options: { success: string }) =>
  useApiMutation<void, DomainActionResult>(
    () => api.post<DomainActionResult>(`/domains/${domainId}/zone/activation-check`),
    {
      success: options.success,
      invalidate: [hostingKeys.domain(domainId), ['hosting', 'domains'], ['hosting', 'admin', 'domains']],
    },
  );

export interface ToggleProxyVars {
  recordId: string;
  proxied: boolean;
  /** For the toast only, not sent. */
  name: string;
}

/** Switches the proxy of one record (PATCH with `proxied` alone). */
export const useToggleProxy = (
  domainId: string,
  options: { success?: (vars: ToggleProxyVars) => string } = {},
) =>
  useApiMutation(
    ({ recordId, proxied }: ToggleProxyVars) =>
      api.patch<DnsRecord>(`/domains/${domainId}/dns/${encodeURIComponent(recordId)}`, { proxied }),
    {
      success: options.success ? (_result, vars) => options.success!(vars) : undefined,
      invalidate: [hostingKeys.dns(domainId)],
    },
  );

/** Platform staff only. Without a target the API plans for the first zone connection. */
export const useDnsMovePreview = (domainId: string, targetId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: zoneKeys.move(domainId, targetId),
    queryFn: () =>
      api.get<DnsMovePreview>(`/admin/domains/${domainId}/dns-move`, { targetProviderId: targetId }),
    enabled,
    retry: false,
    // Reads the registrar's records live: plan again each time the dialog opens, not on focus.
    gcTime: 0,
    refetchOnWindowFocus: false,
    // The previous target's plan stays visible while another one loads (isPlaceholderData).
    placeholderData: (previous) => previous,
  });

/**
 * Creates or reuses the zone, copies the records and switches the name servers. The answer
 * reports every step, partial failures included, so there is no success toast.
 */
export const useDnsMove = (domainId: string, options: { onSuccess?: (result: DnsMoveResult) => void } = {}) =>
  useApiMutation(
    (body: DnsMoveRequest) => api.post<DnsMoveResult>(`/admin/domains/${domainId}/dns-move`, body),
    {
      // A new zone row and name servers: every domain view and the customers' counts. Not the
      // plan: it would read the registrar's records again for a dialog that shows the result.
      invalidate: [
        ['hosting', 'domains'],
        ['hosting', 'domain'],
        ['hosting', 'admin', 'domains'],
        qk.admin('orgs'),
        qk.admin('org'),
        ['org'],
      ],
      onSuccess: (result) => options.onSuccess?.(result),
    },
  );
