import { useI18n } from '@/lib/i18n';
import { PageHeader } from '@/components/ui/primitives';
import { Placeholder } from '@/components/placeholder';

/**
 * Phone systems of every connection with their assignment (/admin/phone). Placeholder until the
 * page is built.
 */
export function AdminPhonePage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('nav.admin.phone')} />
      <Placeholder title={t('nav.admin.phone')} />
    </>
  );
}
