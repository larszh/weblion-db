import { useT } from '@/lib/i18n';
import { useMe } from '@/lib/queries';
import { PageHeader } from '@/components/ui/primitives';
import { AuditView } from '@/pages/org/audit';

export function AdminAuditPage() {
  const t = useT();
  const me = useMe();
  // The summary and the explanations need the audit log itself (platform:audit:read, ai 10.1, 10.3).
  const ai = me.data?.platformPermissions.includes('platform:audit:read') ? 'admin' : undefined;
  return (
    <>
      <PageHeader title={t('nav.admin.audit')} description={t('audit.globalSubtitle')} />
      <AuditView path="/admin/audit" showOrg ai={ai} />
    </>
  );
}
