import { useT } from '@/lib/i18n';
import { PageHeader } from '@/components/ui/primitives';
import { AuditView } from '@/pages/org/audit';

export function AdminAuditPage() {
  const t = useT();
  return (
    <>
      <PageHeader title={t('nav.admin.audit')} description={t('audit.globalSubtitle')} />
      <AuditView path="/admin/audit" showOrg />
    </>
  );
}
