import type { AdminOrgDto } from '@weblion/shared';
import { useI18n } from '@/lib/i18n';
import { PageHeader } from '@/components/ui/primitives';
import { Placeholder } from '@/components/placeholder';

/**
 * Monitors of every Uptime Kuma connection (/admin/monitoring, ?provider=<id> filters by
 * instance): instances with management sign-in, inventory and assignment. Placeholder until the
 * page is built.
 */
export function AdminMonitoringPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('nav.admin.uptime')} />
      <Placeholder title={t('nav.admin.uptime')} />
    </>
  );
}

/**
 * Monitoring allowance and status page links of an organization, on the overview tab of
 * Admin > Customers next to the cloud storage allowance. Checks its permissions itself and
 * renders nothing without the module. Placeholder until the card is built.
 */
export function MonitorAllowanceAdminCard(_: {
  org: AdminOrgDto;
  parent: AdminOrgDto | undefined;
  canWrite: boolean;
}) {
  return null;
}
