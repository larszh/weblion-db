import { useI18n } from '@/lib/i18n';
import { Placeholder } from '@/components/placeholder';

/** One phone system (/o/:slug/phone/:systemId). Placeholder until the page is built. */
export function PhoneSystemPage() {
  const { t } = useI18n();
  return <Placeholder title={t('nav.phone')} />;
}
