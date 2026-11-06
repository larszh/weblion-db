import type { JSX, ReactNode } from 'react';

/**
 * Rendered by App.tsx around the routes (plan F24). U4 keeps the DNS proposal hand-over to DomainDns here
 * (useAiProposal) and registers the explain handler (explain-action.ts) while the explain feature is
 * available (ai 12.3, 12.5). The foundation renders the children only.
 */
export function AiProvider({ children }: { children: ReactNode }): JSX.Element {
  return <>{children}</>;
}
