import { useI18n } from '@/lib/i18n';
import { PageHeader } from '@/components/ui/primitives';
import { Placeholder } from '@/components/placeholder';

/** Mail domains of the organization (/o/:slug/mail). Placeholder until the page is built. */
export function MailDomainsPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('nav.mail')} />
      <Placeholder title={t('nav.mail')} />
    </>
  );
}
