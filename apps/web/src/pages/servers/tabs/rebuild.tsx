import { useState } from 'react';
import { Check, Disc, Lock } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import { qk, useApiMutation, useImages } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import {
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingBlock,
  Notice,
} from '@/components/ui/primitives';
import { useServerContext } from '../context';
import { NewPasswordDialog } from '../password-dialog';

export function RebuildTab() {
  const t = useT();
  const { server } = useServerContext();
  const images = useImages(server.id);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // Hetzner sets a new root password when it installs a system image.
  const [password, setPassword] = useState<string | null>(null);
  const rebuild = useApiMutation(
    () => api.post<{ password?: string }>(`/servers/${server.id}/rebuild`, { imageId: selected }),
    {
      success: t('rebuild.started'),
      invalidate: [qk.server(server.id), qk.serverSub(server.id, 'tasks')],
      onSuccess: (r) => {
        setConfirming(false);
        if (r.password) setPassword(r.password);
      },
    },
  );

  if (server.protection.rebuild) {
    return (
      <Notice tone="warning" icon={<Lock className="size-4" />} title={t('rebuild.protectedTitle')}>
        {t('rebuild.protectedText')}
      </Notice>
    );
  }

  return (
    <Card>
      <CardHeader title={t('tab.rebuild')} description={t('rebuild.subtitle')} />
      <CardBody className="space-y-5">
        <Notice tone="danger">{t('rebuild.warning')}</Notice>
        {images.isPending ? (
          <LoadingBlock rows={2} />
        ) : images.isError ? (
          <ErrorState error={images.error} />
        ) : images.data.length === 0 ? (
          <EmptyState icon={<Disc className="size-6" />} title={t('rebuild.noImages')} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {images.data.map((img) => (
              <button
                key={img.id}
                onClick={() => setSelected(img.id)}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition-colors',
                  selected === img.id
                    ? 'border-brand-blue bg-primary-soft'
                    : 'border-border hover:border-border-strong',
                )}
                aria-pressed={selected === img.id}
              >
                <span>
                  <span className="block text-sm font-medium text-text">{img.label}</span>
                  {img.family && <span className="block text-xs text-muted">{img.family}</span>}
                </span>
                {selected === img.id && <Check className="size-4 text-primary-text" />}
              </button>
            ))}
          </div>
        )}
        <Button variant="danger" disabled={!selected} onClick={() => setConfirming(true)}>
          {t('rebuild.submit')}
        </Button>
      </CardBody>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('rebuild.confirmTitle', { name: server.name })}
        description={t('rebuild.warning')}
        confirmLabel={t('rebuild.submit')}
        confirmText={server.name}
        loading={rebuild.isPending}
        onConfirm={() => rebuild.mutate(undefined)}
      />
      <NewPasswordDialog result={password ? { password } : null} onClose={() => setPassword(null)} />
    </Card>
  );
}
