import { useI18n } from '@/lib/i18n';
import { PageHeader } from '@/components/ui/primitives';
import { Placeholder } from '@/components/placeholder';

/**
 * Streaming accounts of the organization (/o/:slug/media): allowance, login card and the
 * accounts on the organization's Jellyfin instance. Placeholder until the page is built.
 */
export function MediaPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('nav.media')} />
      <Placeholder title={t('nav.media')} />
    </>
  );
}
