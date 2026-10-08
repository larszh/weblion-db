import { useState } from 'react';
import { Activity, AlertTriangle, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { METRIC_RANGES, type MetricRange } from '@weblion/shared';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { formatBytes, formatDate, formatPercent, formatRate } from '@/lib/format';
import { useServerMetrics, useServerMonitoring, useServerTraffic } from '@/lib/queries';
import type { TranslationKey } from '@/i18n/de';
import { MetricChart } from '@/components/metric-chart';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  LoadingBlock,
  UsageBar,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import { useServerContext } from '../context';

const RANGE_LABEL: Record<MetricRange, TranslationKey> = {
  hour: 'graphs.range.hour',
  day: 'graphs.range.day',
  week: 'graphs.range.week',
  month: 'graphs.range.month',
  year: 'graphs.range.year',
};

const PERIOD_LABEL: Record<string, TranslationKey> = {
  LAST_24_HOURS: 'monitoring.24h',
  LAST_7_DAYS: 'monitoring.7d',
  LAST_14_DAYS: 'monitoring.14d',
  LAST_30_DAYS: 'monitoring.30d',
  LAST_90_DAYS: 'monitoring.90d',
  LAST_180_DAYS: 'monitoring.180d',
};

function MonitoringCard() {
  const { t, locale } = useI18n();
  const { server } = useServerContext();
  const monitoring = useServerMonitoring(server.id);
  return (
    <Card>
      <CardHeader title={t('monitoring.title')} description={t('monitoring.subtitle')} />
      {monitoring.isPending ? (
        <LoadingBlock rows={2} />
      ) : monitoring.isError ? (
        <CardBody>
          <ErrorState error={monitoring.error} />
        </CardBody>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-6">
            {monitoring.data.periods.map((p) => (
              <div key={p.key} className="bg-surface px-4 py-3">
                <div className="text-xs text-muted">
                  {PERIOD_LABEL[p.key] ? t(PERIOD_LABEL[p.key]!) : p.key}
                </div>
                <div className="mt-1 text-lg font-semibold text-text">
                  {p.availability !== null ? `${p.availability.toFixed(2)} %` : '–'}
                </div>
                <div className="text-xs text-subtle">
                  {t('monitoring.incidents', { n: p.incidences ?? 0 })} · {p.downtimeMinutes ?? 0} min
                </div>
              </div>
            ))}
          </div>
          {monitoring.data.incidents.length > 0 && (
            <Table>
              <THead>
                <tr>
                  <TH>{t('monitoring.start')}</TH>
                  <TH>{t('monitoring.end')}</TH>
                  <TH>{t('monitoring.downtime')}</TH>
                  <TH>{t('monitoring.type')}</TH>
                </tr>
              </THead>
              <TBody>
                {monitoring.data.incidents.slice(0, 10).map((i) => (
                  <tr key={i.start}>
                    <TD className="tabular">{formatDate(i.start, locale)}</TD>
                    <TD className="tabular">
                      {i.end ? (
                        formatDate(i.end, locale)
                      ) : (
                        <Badge tone="danger">{t('monitoring.ongoing')}</Badge>
                      )}
                    </TD>
                    <TD className="tabular">{i.downtimeMinutes ?? '–'} min</TD>
                    <TD>
                      <Badge tone="warning">
                        <AlertTriangle className="size-3" />
                        {i.type}
                      </Badge>
                    </TD>
                  </tr>
                ))}
              </TBody>
            </Table>
          )}
        </>
      )}
    </Card>
  );
}

function TrafficCard() {
  const { t, locale } = useI18n();
  const { server } = useServerContext();
  const traffic = useServerTraffic(server.id);
  if (traffic.isPending) return <LoadingBlock rows={2} />;
  if (traffic.isError) return <ErrorState error={traffic.error} />;
  const d = traffic.data;
  const total = (d.inBytes ?? 0) + (d.outBytes ?? 0);
  const pct = d.limitBytes ? (total / d.limitBytes) * 100 : null;
  return (
    <Card>
      <CardHeader
        title={t('traffic.title')}
        description={
          d.periodStart ? t('traffic.since', { date: formatDate(d.periodStart, locale, false) }) : undefined
        }
      />
      <CardBody className="grid gap-4 sm:grid-cols-3">
        <div>
          <div className="flex items-center gap-1.5 text-sm text-muted">
            <ArrowDownToLine className="size-4" /> {t('traffic.in')}
          </div>
          <div className="mt-1 text-xl font-semibold">{formatBytes(d.inBytes)}</div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-sm text-muted">
            <ArrowUpFromLine className="size-4" /> {t('traffic.out')}
          </div>
          <div className="mt-1 text-xl font-semibold">{formatBytes(d.outBytes)}</div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-sm text-muted">
            <Activity className="size-4" /> {t('traffic.included')}
          </div>
          <div className="mt-1 text-xl font-semibold">{d.limitBytes ? formatBytes(d.limitBytes) : '–'}</div>
          {pct !== null && (
            <>
              <UsageBar value={pct} className="mt-2" />
              <div className="mt-1 text-xs text-subtle">{formatPercent(pct)}</div>
            </>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

export function GraphsTab() {
  const { t } = useI18n();
  const { server, has } = useServerContext();
  const [range, setRange] = useState<MetricRange>('day');
  const metrics = useServerMetrics(server.id, range);
  const keys = new Set(metrics.data?.series.map((s) => s.key) ?? []);
  const memTotal =
    metrics.data?.points.findLast((p) => p.memTotal)?.memTotal ??
    (server.specs.memoryMb ? server.specs.memoryMb * 1024 * 1024 : null);

  return (
    <div className="space-y-6">
      {/* One filter row above everything it scopes. */}
      <div className="flex flex-wrap items-center gap-3">
        <div
          className="inline-flex rounded-lg border border-border bg-surface p-0.5 shadow-card"
          role="group"
          aria-label={t('graphs.range')}
        >
          {METRIC_RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                range === r ? 'bg-primary text-white' : 'text-muted hover:text-text',
              )}
            >
              {t(RANGE_LABEL[r])}
            </button>
          ))}
        </div>
        {metrics.data?.resolutionSeconds && (
          <span className="text-xs text-subtle">
            {t('graphs.resolution', { s: Math.round(metrics.data.resolutionSeconds / 60) || 1 })}
          </span>
        )}
      </div>

      {metrics.isError ? (
        <ErrorState error={metrics.error} onRetry={() => void metrics.refetch()} />
      ) : metrics.isPending ? (
        <LoadingBlock rows={4} />
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          {keys.has('cpu') && (
            <MetricChart
              title={t('graphs.cpu')}
              points={metrics.data.points}
              series={[{ key: 'cpu', label: 'CPU', slot: 1 }]}
              format={(v) => formatPercent(v, 0)}
              range={range}
              fetching={metrics.isFetching}
            />
          )}
          {keys.has('memUsed') && (
            <MetricChart
              title={t('graphs.memory')}
              subtitle={memTotal ? t('overview.of', { total: formatBytes(memTotal) }) : undefined}
              points={metrics.data.points}
              series={[{ key: 'memUsed', label: t('graphs.used'), slot: 1 }]}
              format={(v) => formatBytes(v)}
              range={range}
              fetching={metrics.isFetching}
            />
          )}
          {keys.has('netIn') && (
            <MetricChart
              title={t('graphs.network')}
              points={metrics.data.points}
              series={[
                { key: 'netIn', label: t('graphs.in'), slot: 1 },
                { key: 'netOut', label: t('graphs.out'), slot: 2 },
              ]}
              format={(v) => formatRate(v)}
              range={range}
              fetching={metrics.isFetching}
            />
          )}
          {keys.has('diskRead') && (
            <MetricChart
              title={t('graphs.disk')}
              points={metrics.data.points}
              series={[
                { key: 'diskRead', label: t('graphs.read'), slot: 1 },
                { key: 'diskWrite', label: t('graphs.write'), slot: 2 },
              ]}
              format={(v) => formatRate(v)}
              range={range}
              fetching={metrics.isFetching}
            />
          )}
          {keys.has('ping') && (
            <MetricChart
              title={t('graphs.ping')}
              points={metrics.data.points}
              series={[{ key: 'ping', label: 'Ping', slot: 1 }]}
              format={(v) => `${Math.round(v)} ms`}
              range={range}
              fetching={metrics.isFetching}
            />
          )}
        </div>
      )}

      {has('traffic') && <TrafficCard />}
      {has('monitoring') && <MonitoringCard />}
    </div>
  );
}
