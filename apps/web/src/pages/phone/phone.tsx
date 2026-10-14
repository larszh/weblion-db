import { useI18n } from '@/lib/i18n';
import { PageHeader } from '@/components/ui/primitives';
import { Placeholder } from '@/components/placeholder';

/**
 * Phone systems of the organization (/o/:slug/phone), one card per site. Placeholder until the
 * page is built.
 */
export function PhonePage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('nav.phone')} />
      <Placeholder title={t('nav.phone')} />
    </>
  );
}
