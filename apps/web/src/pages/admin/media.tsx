import type { AdminOrgDto, ProviderConnectionDto } from '@weblion/shared';
import { useI18n } from '@/lib/i18n';
import { PageHeader } from '@/components/ui/primitives';
import { Placeholder } from '@/components/placeholder';

/**
 * Streaming on every Jellyfin connection (/admin/media, ?provider=<id> preselects the
 * instance): instances, the account inventory, the import of users created in Jellyfin,
 * assignment and policy repair. Placeholder until the page is built.
 */
export function AdminMediaPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('nav.admin.media')} />
      <Placeholder title={t('nav.admin.media')} />
    </>
  );
}

/** Connections with streaming: Jellyfin, and the demo without a flavor (Cloudflare, CloudPanel have none). */
export const isMediaProvider = (
  p: Pick<ProviderConnectionDto, 'type'> & { summary?: Record<string, string> },
) => p.type === 'jellyfin' || (p.type === 'demo' && !p.summary?.flavor);

/**
 * Streaming allowance of an organization (instance, account code, accounts, libraries,
 * streams, downloads, bitrate), on the overview tab of Admin > Customers below the cloud
 * storage allowance. Checks its permissions itself (writes need platform:media:write) and renders
 * nothing when there is nothing to show. Placeholder until the card is built.
 */
export function MediaAllowanceAdminCard(_: {
  org: AdminOrgDto;
  parent: AdminOrgDto | undefined;
  canWrite: boolean;
}) {
  return null;
}
