import type { AdminOrgDto, ProviderConnectionDto } from '@weblion/shared';

/** Connections that have websites (CloudPanel servers, and the opt-in demo CloudPanel). */
export const isWebsiteProvider = (p: Pick<ProviderConnectionDto, 'type' | 'summary'>) =>
  p.type === 'cloudpanel' || (p.type === 'demo' && p.summary?.flavor === 'cloudpanel');

/**
 * Websites part of the web space tab in Admin > Domains & Webspaces: create for a customer,
 * unmanaged sites of the server, adoption. Placeholder until the panel is built.
 */
export function AdminWebsitesPanel(_props: { providerId?: string }) {
  return null;
}

/** Website allowance of a customer (Admin > Kunden > Kunde). Placeholder until the card is built. */
export function WebsiteAllowanceAdminCard(_props: {
  org: AdminOrgDto;
  parent: AdminOrgDto | undefined;
  canWrite: boolean;
}) {
  return null;
}
