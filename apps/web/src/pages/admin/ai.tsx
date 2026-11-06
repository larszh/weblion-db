import { useT } from '@/lib/i18n';
import { PageHeader } from '@/components/ui/primitives';

/** The KI page /admin/ai (ai 12.2). Foundation stub with the header only; U4 builds the three tabs. */
export function AdminAiPage() {
  const t = useT();
  return <PageHeader title={t('nav.admin.ai')} description={t('admin.ai.subtitle')} />;
}
