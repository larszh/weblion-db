import { useI18n } from '@/lib/i18n';
import { Placeholder } from '@/components/placeholder';

/** One mail domain (/o/:slug/mail/:mailDomainId). Placeholder until the page is built. */
export function MailDomainDetailPage() {
  const { t } = useI18n();
  return <Placeholder title={t('nav.mail')} />;
}
