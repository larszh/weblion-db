import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { AiDnsProposalDto, AiExplainSource, OrgDto } from '@weblion/shared';
import { api, ApiError } from '@/lib/api';
import { qk } from '@/lib/queries';
import { useOptionalOrg } from '@/lib/org-context';
import { useAiStatus, type AiScope } from '@/lib/api/ai';
import { aiAllowed, useCachedMe, type AiArea } from './bits';
import { registerExplainHandler } from './explain-action';
import { ExplainDialog } from './explain-dialog';

/**
 * Rendered by App.tsx around the routes, outside Suspense (plan F24), so a lazy route never remounts it. It
 * does two things only (plan U4):
 *
 * 1. The DNS proposal hand-over (ai 12.3): "Vorschlag übernehmen" in the assistant or a DNS check stores the
 *    proposal here and navigates to the domain's DNS tab, where DomainDns takes it (useAiProposal) and opens
 *    the record form pre-filled.
 * 2. "Mit KI erklären" on error toasts and error boxes (ai 12.5): while the explain feature is available to
 *    the person on the current page, it registers the handler of explain-action.ts and shows the dialog.
 */

interface AiContextValue {
  proposal: AiDnsProposalDto | null;
  setProposal: (proposal: AiDnsProposalDto | null) => void;
}

const AiContext = createContext<AiContextValue | null>(null);

/** The browser's error object as the explain route takes it (ai 10.1: message 2,000, details 4,000). */
export function errorSource(err: ApiError, page: { path: string; title: string | null }): AiExplainSource {
  let details: unknown = err.details;
  try {
    if (details !== undefined && JSON.stringify(details).length > 4000) details = undefined;
  } catch {
    details = undefined;
  }
  return {
    kind: 'error',
    error: {
      status: err.status,
      code: err.code,
      message: err.message.slice(0, 2000),
      ...(details !== undefined ? { details } : {}),
    },
    page: { path: page.path.slice(0, 300), title: page.title ? page.title.slice(0, 200) : null },
  };
}

export function AiProvider({ children }: { children: ReactNode }): JSX.Element {
  const [proposal, setProposal] = useState<AiDnsProposalDto | null>(null);
  const location = useLocation();
  const slug = matchPath('/o/:slug/*', location.pathname)?.params.slug;
  const inAdmin = location.pathname === '/admin' || location.pathname.startsWith('/admin/');
  const area: AiArea | null = slug ? 'org' : inAdmin ? 'admin' : null;
  const me = useCachedMe();
  // The same query as OrgLayout's (shared cache); only once signed in, so the login page starts nothing.
  const org = useQuery({
    queryKey: qk.orgBySlug(slug ?? ''),
    queryFn: () => api.get<OrgDto>(`/orgs/by-slug/${slug}`),
    enabled: !!slug && !!me,
    retry: false,
  });
  const status = useAiStatus(!!me && !!area);

  const allowed =
    !!area &&
    aiAllowed({
      status: status.data,
      feature: 'explain',
      area,
      org: area === 'org' ? (org.data ?? null) : null,
      platformPermissions: me?.platformPermissions ?? [],
    });
  const orgId = area === 'org' ? org.data?.id : undefined;
  const scope = useMemo<AiScope | null>(
    () => (!allowed ? null : area === 'admin' ? 'admin' : orgId ? { orgId } : null),
    [allowed, area, orgId],
  );

  const [explaining, setExplaining] = useState<{ scope: AiScope; source: AiExplainSource } | null>(null);
  const path = useRef(location.pathname);
  path.current = location.pathname;

  useEffect(() => {
    if (!scope) {
      registerExplainHandler(null);
      return;
    }
    registerExplainHandler((err) => {
      if (!(err instanceof ApiError)) return;
      setExplaining({ scope, source: errorSource(err, { path: path.current, title: document.title }) });
    });
    return () => registerExplainHandler(null);
  }, [scope]);

  const value = useMemo(() => ({ proposal, setProposal }), [proposal]);
  return (
    <AiContext.Provider value={value}>
      {children}
      {explaining && (
        <ExplainDialog
          scope={explaining.scope}
          source={explaining.source}
          onClose={() => setExplaining(null)}
        />
      )}
    </AiContext.Provider>
  );
}

/**
 * The proposal waiting for this domain's DNS tab, and `clear` to take it. Null outside the provider (tests)
 * and for another domain.
 */
export function useAiProposal(domainId: string): { proposal: AiDnsProposalDto | null; clear: () => void } {
  const ctx = useContext(AiContext);
  const proposal = ctx?.proposal && ctx.proposal.domainId === domainId ? ctx.proposal : null;
  const setProposal = ctx?.setProposal;
  const clear = useCallback(() => setProposal?.(null), [setProposal]);
  return { proposal, clear };
}

/** "Vorschlag übernehmen": hand the proposal over and open the domain's DNS tab in this organization. */
export function useApplyProposal(): (proposal: AiDnsProposalDto) => void {
  const ctx = useContext(AiContext);
  const org = useOptionalOrg();
  const navigate = useNavigate();
  const setProposal = ctx?.setProposal;
  const slug = org?.org.slug;
  return useCallback(
    (proposal: AiDnsProposalDto) => {
      if (!proposal.domainId || !slug) return;
      setProposal?.(proposal);
      navigate(`/o/${slug}/domains/${proposal.domainId}?tab=dns`);
    },
    [setProposal, slug, navigate],
  );
}
