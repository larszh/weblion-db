import { useState } from 'react';
import { Disc3, Eject } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { qk, useApiMutation, useIsos } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Input,
  LoadingBlock,
  Mono,
  Notice,
} from '@/components/ui/primitives';
import { useServerContext } from '../context';

export function IsoTab() {
  const t = useT();
  const { server } = useServerContext();
  const isos = useIsos(server.id);
  const [filter, setFilter] = useState('');
  const keys = [qk.serverSub(server.id, 'isos')];
  const mount = useApiMutation((isoId: string) => api.post(`/servers/${server.id}/iso`, { isoId }), {
    success: t('iso.mounted'),
    invalidate: keys,
  });
  const unmount = useApiMutation(() => api.del(`/servers/${server.id}/iso`), {
    success: t('iso.unmounted'),
    invalidate: keys,
  });

  if (isos.isPending) return <LoadingBlock />;
  if (isos.isError) return <ErrorState error={isos.error} />;
  const list = isos.data.isos.filter((i) => i.label.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-4">
      <Notice tone="info">{t('iso.hint')}</Notice>
      {isos.data.mounted && (
        <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-3">
            <Disc3 className="size-5 text-primary-text" />
            <div>
              <div className="text-sm text-muted">{t('iso.current')}</div>
              <Mono className="text-text">{isos.data.mounted.split('/').pop()}</Mono>
            </div>
          </div>
          <Button
            icon={<Eject className="size-4" />}
            loading={unmount.isPending}
            onClick={() => unmount.mutate(undefined)}
          >
            {t('iso.unmount')}
          </Button>
        </Card>
      )}
      <Card>
        <CardHeader
          title={t('iso.available')}
          actions={
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('common.search')}
              className="w-56"
            />
          }
        />
        {list.length === 0 ? (
          <EmptyState icon={<Disc3 className="size-6" />} title={t('iso.empty')} />
        ) : (
          <CardBody className="divide-y divide-border py-0">
            {list.map((iso) => (
              <div key={iso.id} className="flex items-center justify-between gap-3 py-3">
                <Mono className="truncate text-text">{iso.label}</Mono>
                <Button
                  size="sm"
                  disabled={isos.data.mounted === iso.id || mount.isPending}
                  onClick={() => mount.mutate(iso.id)}
                >
                  {t('iso.mount')}
                </Button>
              </div>
            ))}
          </CardBody>
        )}
      </Card>
    </div>
  );
}
