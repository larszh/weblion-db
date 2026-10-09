import { useState } from 'react';
import { ArrowRight, Cpu, HardDrive, MemoryStick, Wallet } from 'lucide-react';
import { formatMoney, type ServerPlan } from '@weblion/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useI18n, useT } from '@/lib/i18n';
import { formatMemoryMb } from '@/lib/format';
import { isUnsupported, qk, useApiMutation, useServerPlans, type PlanOption } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Notice,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import { useServerContext } from '../context';

/**
 * Providers with fixed sizes (Hetzner server types) offer plans, everything else (Proxmox)
 * takes cores, memory and disk. The plans route answers 422 for the latter.
 */
export function RescaleTab() {
  const { server } = useServerContext();
  const plans = useServerPlans(server.id);
  if (plans.isPending) return <LoadingBlock />;
  if (plans.isError) {
    if (isUnsupported(plans.error)) return <SpecsRescale />;
    return <ErrorState error={plans.error} onRetry={() => void plans.refetch()} />;
  }
  return <PlanRescale plans={plans.data} />;
}

function SummaryRow({
  icon,
  label,
  current,
  next,
}: {
  icon: React.ReactNode;
  label: string;
  current: string;
  next?: string;
}) {
  return (
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
}

/** Shared vCPU first, then by size, like the Hetzner Console. */
function planOrder(a: ServerPlan, b: ServerPlan): number {
  const dedicated = (p: ServerPlan) => (p.cpuType === 'dedicated' ? 1 : 0);
  return (
    dedicated(a) - dedicated(b) ||
    a.cores - b.cores ||
    a.memoryMb - b.memoryMb ||
    a.diskGb - b.diskGb ||
    a.label.localeCompare(b.label)
  );
}

function PlanRescale({ plans }: { plans: PlanOption[] }) {
  const { t, locale } = useI18n();
  const { server } = useServerContext();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [upgradeDisk, setUpgradeDisk] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const disk = server.specs.diskGb ?? 0;
  const sorted = [...plans].sort(planOrder);
  const selected = sorted.find((p) => p.id === selectedId) ?? null;
  // Prices only reach staff, the API strips them for everybody else.
  const showPrices = plans.some((p) => p.priceMonthly);
  // The API marks the type the last sync stored. Without one (a server synced before), the
  // sizes decide, and two types with equal sizes both count.
  const known = plans.some((p) => p.current);
  const isCurrent = (p: PlanOption) =>
    known ? !!p.current : p.cores === server.specs.cores && p.memoryMb === server.specs.memoryMb;
  const current = sorted.find(isCurrent) ?? null;
  const blockedBy = (p: PlanOption) =>
    known && p.current
      ? t('plans.current')
      : p.deprecated
        ? t('plans.deprecated')
        : p.diskGb < disk
          ? t('plans.diskTooSmall')
          : null;
  const canGrow = !!selected && selected.diskGb > disk;
  const growDisk = canGrow && upgradeDisk;
  const price = (p: PlanOption | null) =>
    p?.priceMonthly ? formatMoney(p.priceMonthly.amount, p.priceMonthly.currency, locale) : '–';

  const rescale = useApiMutation(
    () => api.post(`/servers/${server.id}/rescale`, { plan: selected!.id, upgradeDisk: growDisk }),
    {
      success: t('rescale.done'),
      invalidate: [qk.server(server.id), qk.serverSub(server.id, 'tasks'), qk.serverSub(server.id, 'plans')],
      onSuccess: () => {
        setConfirming(false);
        setSelectedId(null);
        setUpgradeDisk(false);
      },
    },
  );

  const select = (p: PlanOption) => {
    if (blockedBy(p)) return;
    setSelectedId(p.id);
    setUpgradeDisk(false);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <Card className="min-w-0">
        <CardHeader title={t('plans.title')} description={t('plans.subtitle')} />
        {sorted.length === 0 ? (
          <EmptyState icon={<Cpu className="size-6" />} title={t('plans.empty')} />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH className="w-10" />
                <TH>{t('plans.type')}</TH>
                <TH className="text-right">vCPU</TH>
                <TH className="text-right">RAM</TH>
                <TH className="text-right">Disk</TH>
                {showPrices && <TH className="text-right">{t('plans.price')}</TH>}
              </tr>
            </THead>
            <TBody>
              {sorted.map((p) => {
                const blocked = blockedBy(p);
                return (
                  <tr
                    key={p.id}
                    onClick={() => select(p)}
                    className={cn(
                      'transition-colors',
                      blocked ? !isCurrent(p) && 'opacity-50' : 'cursor-pointer hover:bg-surface-2',
                      selectedId === p.id && 'bg-primary-soft hover:bg-primary-soft',
                    )}
                  >
                    <TD>
                      <input
                        type="radio"
                        name="plan"
                        className="size-4 accent-[var(--primary)]"
                        checked={selectedId === p.id}
                        disabled={!!blocked}
                        onChange={() => select(p)}
                        aria-label={p.label}
                      />
                    </TD>
                    <TD>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium text-text">{p.label}</span>
                        {isCurrent(p) && <Badge tone="primary">{t('plans.current')}</Badge>}
                        {p.cpuType === 'dedicated' && <Badge tone="info">{t('plans.dedicated')}</Badge>}
                        {p.architecture === 'arm' && <Badge>Arm64</Badge>}
                        {blocked && !isCurrent(p) && <Badge tone="warning">{blocked}</Badge>}
                      </div>
                    </TD>
                    <TD className="text-right tabular">{p.cores}</TD>
                    <TD className="text-right tabular">{formatMemoryMb(p.memoryMb)}</TD>
                    <TD className="text-right tabular">{p.diskGb} GB</TD>
                    {showPrices && <TD className="text-right tabular">{price(p)}</TD>}
                  </tr>
                );
              })}
            </TBody>
          </Table>
        )}
        <CardBody className="space-y-4 border-t border-border">
          {sorted.some((p) => !p.deprecated && p.diskGb < disk) && (
            <p className="text-xs text-muted">{t('plans.diskTooSmallHint', { disk })}</p>
          )}
          {showPrices && <p className="text-xs text-muted">{t('plans.priceStaff')}</p>}
          {selected && canGrow && (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-surface-2">
              <input
                type="checkbox"
                className="mt-1 size-4 accent-[var(--primary)]"
                checked={upgradeDisk}
                onChange={(e) => setUpgradeDisk(e.target.checked)}
              />
              <span>
                <span className="block text-sm font-medium">
                  {t('plans.upgradeDisk', { disk: selected.diskGb })}
                </span>
                <span className="block text-xs text-muted">
                  {t('plans.upgradeDiskHint', { current: disk })}
                </span>
              </span>
            </label>
          )}
          {server.provider.type === 'hetzner' ? (
            <Notice tone={server.status === 'stopped' ? 'info' : 'warning'}>{t('plans.hetznerOff')}</Notice>
          ) : (
            <Notice tone="warning">{t('plans.hint')}</Notice>
          )}
          <Button
            variant="primary"
            disabled={!selected || !!blockedBy(selected)}
            onClick={() => setConfirming(true)}
          >
            {t('rescale.apply')}
          </Button>
        </CardBody>
      </Card>
      <Card className="h-fit">
        <CardHeader title={t('rescale.summary')} />
        <CardBody className="space-y-3">
          <SummaryRow
            icon={<Cpu />}
            label="vCPU"
            current={String(server.specs.cores ?? '–')}
            next={selected ? String(selected.cores) : undefined}
          />
          <SummaryRow
            icon={<MemoryStick />}
            label="RAM"
            current={formatMemoryMb(server.specs.memoryMb)}
            next={selected ? formatMemoryMb(selected.memoryMb) : undefined}
          />
          <SummaryRow
            icon={<HardDrive />}
            label={t('server.disk')}
            current={`${server.specs.diskGb ?? '–'} GB`}
            next={growDisk ? `${selected!.diskGb} GB` : undefined}
          />
          {showPrices && (
            <SummaryRow
              icon={<Wallet />}
              label={t('plans.price')}
              current={price(current)}
              next={selected ? price(selected) : undefined}
            />
          )}
          {!selected && <p className="pt-1 text-xs text-muted">{t('plans.select')}</p>}
        </CardBody>
      </Card>
      <ConfirmDialog
        open={confirming && !!selected}
        onOpenChange={setConfirming}
        title={t('rescale.confirmTitle', { name: server.name })}
        description={
          selected
            ? [
                t('plans.confirmText', {
                  plan: selected.label,
                  cores: selected.cores,
                  memory: formatMemoryMb(selected.memoryMb),
                }),
                growDisk ? t('plans.confirmDisk', { disk: selected.diskGb }) : null,
              ]
                .filter(Boolean)
                .join(' ')
            : undefined
        }
        confirmLabel={t('rescale.apply')}
        danger={false}
        loading={rescale.isPending}
        onConfirm={() => rescale.mutate(undefined)}
      />
    </div>
  );
}

/** Free sizes (Proxmox, 24fire): cores, memory and disk as numbers. */
function SpecsRescale() {
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
          <SummaryRow
            icon={<Cpu />}
            label="vCPU"
            current={String(server.specs.cores ?? '–')}
            next={changes.cores ? String(changes.cores) : undefined}
          />
          <SummaryRow
            icon={<MemoryStick />}
            label="RAM"
            current={formatMemoryMb(server.specs.memoryMb)}
            next={changes.memoryMb ? formatMemoryMb(changes.memoryMb) : undefined}
          />
          <SummaryRow
            icon={<HardDrive />}
            label={t('server.disk')}
            current={`${server.specs.diskGb ?? '–'} GB`}
            next={changes.diskGb ? `${changes.diskGb} GB` : undefined}
          />
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
