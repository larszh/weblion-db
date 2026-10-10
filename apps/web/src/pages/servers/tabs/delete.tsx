import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { useApiMutation } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Card, CardBody, CardHeader, Notice } from '@/components/ui/primitives';
import { useServerContext } from '../context';

export function DeleteTab() {
  const t = useT();
  const { base } = useOrg();
  const navigate = useNavigate();
  const { server } = useServerContext();
  const [open, setOpen] = useState(false);
  const remove = useApiMutation(() => api.del(`/servers/${server.id}`, { confirm: server.name }), {
    success: t('delete.done'),
    invalidate: [['servers']],
    onSuccess: () => navigate(`${base}/servers`),
  });

  return (
    <Card className="border-danger/40">
      <CardHeader title={t('delete.title')} description={t('delete.subtitle')} />
      <CardBody className="space-y-4">
        {server.protection.delete ? (
          <Notice tone="warning" icon={<Lock className="size-4" />} title={t('delete.protectedTitle')}>
            {t('delete.protectedText')}
          </Notice>
        ) : (
          <>
            <Notice tone="danger">{t('delete.warning')}</Notice>
            {server.provider.type === 'hetzner' ? (
              <Notice tone="warning">{t('delete.hetznerHint')}</Notice>
            ) : (
              server.status !== 'stopped' &&
              server.provider.type !== 'fire24' && <Notice tone="warning">{t('delete.stopFirst')}</Notice>
            )}
            <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setOpen(true)}>
              {t('delete.submit')}
            </Button>
          </>
        )}
      </CardBody>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('delete.confirmTitle', { name: server.name })}
        description={t('delete.warning')}
        confirmLabel={t('delete.submit')}
        confirmText={server.name}
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
    </Card>
  );
}
