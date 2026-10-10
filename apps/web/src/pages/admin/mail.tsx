import type { ProviderConnectionDto } from '@weblion/shared';

/** Connections that can have mail domains (Mailcow, and the demo provider's simulation). */
export const isMailProvider = (p: Pick<ProviderConnectionDto, 'type'>) =>
  p.type === 'mailcow' || p.type === 'demo';

/** "E-Mail-Domains" tab of Admin > Domains & Webspaces. Placeholder until the tab is built. */
export function AdminMailTab() {
  return null;
}
