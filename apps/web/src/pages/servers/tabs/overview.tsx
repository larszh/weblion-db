import { Link } from 'react-router-dom';
import { Cpu, HardDrive, MemoryStick, Timer } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { formatDate, formatDuration, formatMemoryMb, formatPercent, formatRelative } from '@/lib/format';
import { useServerMetrics, useServerTasks } from '@/lib/queries';
import type { TranslationKey } from '@/i18n/de';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CopyButton,
  KeyValue,
  Mono,
  UsageBar,
} from '@/components/ui/primitives';
import { MetricChart } from '@/components/metric-chart';
import { Flag, ProviderBadge } from '@/components/server-bits';
import { useServerContext } from '../context';

function UsageTile({
  icon,
  label,
  value,
  detail,
  percent,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string;
  percent?: number | null;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-sm text-muted [&>svg]:size-4">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-xl font-semibold text-text">{value}</div>
      {detail && <div className="text-xs text-subtle">{detail}</div>}
      {percent !== undefined && <UsageBar value={percent} className="mt-3" />}
    </Card>
  );
}

export function OverviewTab() {
  const { t, locale } = useI18n();
  const { base } = useOrg();
  const { server, allowed, can } = useServerContext();
  const metrics = useServerMetrics(server.id, 'hour', allowed('metrics', 'server:metrics'));
  const tasks = useServerTasks(server.id, can('server:task:read'));
  const usage = server.usage;
  const running = server.status === 'running';
  const memPct =
    usage?.memoryUsedMb && server.specs.memoryMb ? (usage.memoryUsedMb / server.specs.memoryMb) * 100 : null;
  const diskPct =
    usage?.diskUsedGb && server.specs.diskGb ? (usage.diskUsedGb / server.specs.diskGb) * 100 : null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <UsageTile
          icon={<Cpu />}
          label={t('overview.cpu')}
          value={running ? formatPercent(usage?.cpuPercent) : '–'}
          detail={server.specs.cores ? `${server.specs.cores} vCPU` : undefined}
          percent={running ? (usage?.cpuPercent ?? null) : null}
        />
        <UsageTile
          icon={<MemoryStick />}
          label={t('overview.memory')}
          value={running && usage?.memoryUsedMb ? formatMemoryMb(Math.round(usage.memoryUsedMb)) : '–'}
          detail={
            server.specs.memoryMb
              ? t('overview.of', { total: formatMemoryMb(server.specs.memoryMb) })
              : undefined
          }
          percent={running ? memPct : null}
        />
        <UsageTile
          icon={<HardDrive />}
          label={t('overview.disk')}
          value={
            usage?.diskUsedGb
              ? `${usage.diskUsedGb.toFixed(1)} GB`
              : server.specs.diskGb
                ? `${server.specs.diskGb} GB`
                : '–'
          }
          detail={
            usage?.diskUsedGb && server.specs.diskGb
              ? t('overview.of', { total: `${server.specs.diskGb} GB` })
              : t('overview.allocated')
          }
          percent={diskPct ?? undefined}
        />
        <UsageTile
          icon={<Timer />}
          label={t('overview.uptime')}
          value={running ? formatDuration(usage?.uptimeSeconds, locale) : '–'}
          detail={t(`status.${server.status}` as TranslationKey)}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <div className="min-w-0 space-y-6">
          {allowed('metrics', 'server:metrics') && metrics.data && (
            <MetricChart
              title={t('graphs.cpu')}
              subtitle={t('graphs.lastHour')}
              points={metrics.data.points}
              series={[{ key: 'cpu', label: 'CPU', slot: 1 }]}
              format={(v) => formatPercent(v, 0)}
              range="hour"
              fetching={metrics.isFetching}
            />
          )}
          <Card>
            <CardHeader title={t('overview.ips')} />
            <CardBody className="py-2">
              {server.ips.length === 0 ? (
                <p className="py-2 text-sm text-muted">{t('overview.noIps')}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {server.ips.map((ip) => (
                    <li key={ip.address} className="flex flex-wrap items-center gap-3 py-2.5">
                      <Badge tone={ip.version === 4 ? 'primary' : 'info'}>IPv{ip.version}</Badge>
                      <Mono className="text-text">{ip.address}</Mono>
                      <CopyButton value={ip.address} />
                      {ip.rdns && <span className="text-sm text-muted">{ip.rdns}</span>}
                      {ip.interface && <span className="ml-auto text-xs text-subtle">{ip.interface}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title={t('overview.details')} />
            <CardBody className="py-1">
              <KeyValue
                items={[
                  { label: t('overview.id'), value: <Mono>{server.id.slice(0, 8)}</Mono> },
                  {
                    label: t('overview.providerId'),
                    value: (
                      <span className="inline-flex items-center gap-1">
                        <Mono>{server.externalId}</Mono>
                        <CopyButton value={server.externalId} />
                      </span>
                    ),
                  },
                  {
                    label: t('overview.provider'),
                    value: (
                      <span className="inline-flex items-center gap-2">
                        <ProviderBadge type={server.provider.type} /> {server.provider.name}
                      </span>
                    ),
                  },
                  {
                    label: t('overview.location'),
                    value: (
                      <span className="inline-flex items-center gap-2">
                        <Flag country={server.location.country} /> {server.location.label}
                      </span>
                    ),
                  },
                  ...(server.node ? [{ label: t('overview.node'), value: server.node }] : []),
                  { label: t('overview.os'), value: server.os ?? '–' },
                  { label: t('overview.kind'), value: t(`kind.${server.kind}` as TranslationKey) },
                  {
                    label: t('overview.project'),
                    value: server.project ? (
                      <Link
                        className="text-primary-text hover:underline"
                        to={`${base}/projects/${server.project.id}`}
                      >
                        {server.project.name}
                      </Link>
                    ) : (
                      '–'
                    ),
                  },
                  { label: t('overview.synced'), value: formatRelative(server.lastSyncedAt, locale) },
                  { label: t('overview.added'), value: formatDate(server.createdAt, locale, false) },
                ]}
              />
            </CardBody>
          </Card>

          {can('server:task:read') && (
            <Card>
              <CardHeader
                title={t('overview.recentActions')}
                actions={
                  <Link to="activity" className="text-sm font-medium text-primary-text hover:underline">
                    {t('common.showAll')}
                  </Link>
                }
              />
              <CardBody className="py-2">
                {tasks.data?.actions.length ? (
                  <ul className="divide-y divide-border">
                    {tasks.data.actions.slice(0, 5).map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="min-w-0 truncate">
                          <span className="font-medium text-text">{a.type}</span>
                          <span className="text-muted"> · {a.user?.name ?? 'System'}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <ActionStatus status={a.status} />
                          <span className="text-xs text-subtle">{formatRelative(a.startedAt, locale)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-2 text-sm text-muted">{t('overview.noActions')}</p>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export function ActionStatus({ status }: { status: 'running' | 'success' | 'error' | 'ok' }) {
  const { t } = useI18n();
  if (status === 'running') return <Badge tone="warning">{t('action.running')}</Badge>;
  if (status === 'error') return <Badge tone="danger">{t('action.error')}</Badge>;
  return <Badge tone="success">{t('action.success')}</Badge>;
}
