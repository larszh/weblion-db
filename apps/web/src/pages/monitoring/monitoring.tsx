import { useI18n } from '@/lib/i18n';
import { PageHeader } from '@/components/ui/primitives';
import { Placeholder } from '@/components/placeholder';

/**
 * Monitors of the organization (/o/:slug/monitoring) with status, uptime and response time, the
 * allowance and the status page link. Placeholder until the page is built.
 */
export function MonitoringPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('nav.uptime')} />
      <Placeholder title={t('nav.uptime')} />
    </>
  );
}
