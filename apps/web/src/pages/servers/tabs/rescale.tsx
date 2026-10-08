import { useState } from 'react';
import { ArrowRight, Cpu, HardDrive, MemoryStick } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { formatMemoryMb } from '@/lib/format';
import { qk, useApiMutation } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Card, CardBody, CardHeader, Field, Input, Notice } from '@/components/ui/primitives';
import { useServerContext } from '../context';

export function RescaleTab() {
  const t = useT();
  const { server } = useServerContext();
  const [cores, setCores] = useState(String(server.specs.cores ?? ''));
  const [memoryGb, setMemoryGb] = useState(server.specs.memoryMb ? String(server.specs.memoryMb / 1024) : '');
  const [diskGb, setDiskGb] = useState(String(server.specs.diskGb ?? ''));
  const [confirming, setConfirming] = useState(false);

  const changes = {
    cores: Number(cores) !== server.specs.cores && Number(cores) > 0 ? Number(cores) : undefined,
    memoryMb:
      Math.round(Number(memoryGb) * 1024) !== server.specs.memoryMb && Number(memoryGb) > 0
        ? Math.round(Number(memoryGb) * 1024)
        : undefined,
    diskGb: Number(diskGb) !== server.specs.diskGb && Number(diskGb) > 0 ? Number(diskGb) : undefined,
  };
  const diskShrinks =
    changes.diskGb !== undefined && server.specs.diskGb !== undefined && changes.diskGb < server.specs.diskGb;
  const hasChanges = Object.values(changes).some((v) => v !== undefined);

  const rescale = useApiMutation(() => api.post(`/servers/${server.id}/rescale`, changes), {
    success: t('rescale.done'),
    invalidate: [qk.server(server.id), qk.serverSub(server.id, 'tasks')],
    onSuccess: () => setConfirming(false),
  });

  const row = (icon: React.ReactNode, label: string, current: string, next?: string) => (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-muted [&>svg]:size-4">{icon}</span>
      <span className="w-24 text-muted">{label}</span>
      <span className="font-medium">{current}</span>
      {next && (
        <>
          <ArrowRight className="size-4 text-subtle" />
          <span className="font-semibold text-primary-text">{next}</span>
        </>
      )}
    </div>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader title={t('tab.rescale')} description={t('rescale.subtitle')} />
        <CardBody className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('rescale.cores')} htmlFor="r-cores">
              <Input
                id="r-cores"
                type="number"
                min={1}
                max={256}
                value={cores}
                onChange={(e) => setCores(e.target.value)}
              />
            </Field>
            <Field label={t('rescale.memory')} htmlFor="r-mem">
              <Input
                id="r-mem"
                type="number"
                min={0.5}
                step={0.5}
                value={memoryGb}
                onChange={(e) => setMemoryGb(e.target.value)}
              />
            </Field>
            <Field
              label={t('rescale.disk')}
              hint={t('rescale.diskHint')}
              error={diskShrinks ? t('rescale.diskShrink') : undefined}
              htmlFor="r-disk"
            >
              <Input
                id="r-disk"
                type="number"
                min={server.specs.diskGb ?? 1}
                value={diskGb}
                onChange={(e) => setDiskGb(e.target.value)}
              />
            </Field>
          </div>
          <Notice tone="warning">
            {server.provider.type === 'proxmox' ? t('rescale.proxmoxHint') : t('rescale.hint')}
          </Notice>
          <Button variant="primary" disabled={!hasChanges || diskShrinks} onClick={() => setConfirming(true)}>
            {t('rescale.apply')}
          </Button>
        </CardBody>
      </Card>
      <Card className="h-fit">
        <CardHeader title={t('rescale.summary')} />
        <CardBody className="space-y-3">
          {row(
            <Cpu />,
            'vCPU',
            String(server.specs.cores ?? '–'),
            changes.cores ? String(changes.cores) : undefined,
          )}
          {row(
            <MemoryStick />,
            'RAM',
            formatMemoryMb(server.specs.memoryMb),
            changes.memoryMb ? formatMemoryMb(changes.memoryMb) : undefined,
          )}
          {row(
            <HardDrive />,
            t('server.disk'),
            `${server.specs.diskGb ?? '–'} GB`,
            changes.diskGb ? `${changes.diskGb} GB` : undefined,
          )}
        </CardBody>
      </Card>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('rescale.confirmTitle', { name: server.name })}
        description={t('rescale.confirmText')}
        confirmLabel={t('rescale.apply')}
        danger={false}
        loading={rescale.isPending}
        onConfirm={() => rescale.mutate(undefined)}
      />
    </div>
  );
}
