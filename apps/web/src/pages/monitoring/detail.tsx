import { useI18n } from '@/lib/i18n';
import { PageHeader } from '@/components/ui/primitives';
import { Placeholder } from '@/components/placeholder';

/**
 * One monitor (/o/:slug/monitoring/:monitorId): live facts, response time chart, recent status
 * changes and configuration. Placeholder until the page is built.
 */
export function MonitorDetailPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('nav.uptime')} />
      <Placeholder title={t('nav.uptime')} />
    </>
  );
}
