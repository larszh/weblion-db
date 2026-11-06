import { useT } from '@/lib/i18n';
import { PageHeader } from '@/components/ui/primitives';

/** The translation admin /admin/translations (i18n 17). Foundation stub with the header only; U1 builds it. */
export function TranslationsPage() {
  const t = useT();
  return <PageHeader title={t('nav.admin.translations')} description={t('admin.i18n.description')} />;
}
