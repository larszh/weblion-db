import type { JSX } from 'react';

/** The assistant launcher and panel, rendered once by AppShell (plan F25). U4 builds it (ai 12.3). */
export function AiAssistant(): JSX.Element | null {
  return null;
}

/**
 * True inside an organization (/o/:slug/*) while the status is available with the assistant feature and the
 * person may use it (ai:use; staff also platform:ai:use). AppShell adds pb-20 sm:pb-0 to the main area
 * meanwhile, so the launcher never covers content. The foundation has no assistant yet: false.
 */
export function useAiLauncherVisible(): boolean {
  return false;
}
