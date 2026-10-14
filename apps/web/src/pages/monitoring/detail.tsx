import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ExternalLink, History } from 'lucide-react';
import {
  MONITOR_MIN_INTERVAL_SECONDS,
  type MonitorConfig,
  type MonitorDetailDto,
  type MonitorEvent,
  type MonitorHistoryRange,
} from '@weblion/shared';
import type { TranslationKey } from '@/i18n/de';
import { cn } from '@/lib/cn';
import { formatDate, formatNumber, formatRelative } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { ApiError, errorMessage } from '@/lib/api';
import { useMonitor, useMonitorHistory, useOrgMonitoring } from '@/lib/api/monitoring';
import { MetricChart } from '@/components/metric-chart';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  KeyValue,
  LoadingBlock,
  Mono,
  Notice,
  PageHeader,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import {
  AvailabilityStrip,
  CHART_RANGE,
  CertBadge,
  KindLabel,
  MissingHint,
  MonitorDetailError,
  MonitorStatusBadge,
  defaultHistoryRange,
  formatResponse,
  formatUptime,
  intervalLabel,
  isWebKind,
  targetHref,
} from './bits';
import { MonitorActionButtons } from './dialogs';

/** One monitor (/o/:slug/monitoring/:monitorId): live facts, response time chart, status changes, configuration. */
export function MonitorDetailPage() {
  const { t } = useI18n();
  const { monitorId } = useParams();
  const { base } = useOrg();
  const monitor = useMonitor(monitorId);

  return (
    <>
      <Link
        to={`${base}/monitoring`}
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text"
      >
        <ChevronLeft className="size-4" /> {t('nav.uptime')}
      </Link>
      {monitor.data ? (
        <>
          {/* A failed background refresh keeps the last view. */}
          {monitor.isError && (
            <Notice tone="warning" title={t('uptime.refreshError')} className="mb-4">
              <span className="block break-words">{errorMessage(monitor.error)}</span>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                loading={monitor.isFetching}
                onClick={() => void monitor.refetch()}
              >
                {t('common.retry')}
              </Button>
            </Notice>
          )}
          <MonitorView monitor={monitor.data} />
        </>
      ) : monitor.isPending ? (
        <LoadingBlock rows={6} />
      ) : (
        <MonitorDetailError error={monitor.error} onRetry={() => void monitor.refetch()} />
      )}
    </>
  );
}

function MonitorView({ monitor }: { monitor: MonitorDetailDto }) {
  const { t, locale } = useI18n();
  const { org, base, can } = useOrg();
  const navigate = useNavigate();
  const orgMonitoring = useOrgMonitoring(org.id, can('monitor:read'));
  const allowance = orgMonitoring.data?.allowance ?? null;
  // The allowance's minimum applies on its own instance; the API checks it again.
  const minIntervalSeconds =
    allowance && allowance.provider?.id === monitor.provider.id
      ? allowance.minIntervalSeconds
      : MONITOR_MIN_INTERVAL_SECONDS;
  const href = targetHref(monitor.target);
  const facts = monitor.facts;
  const newest = monitor.events?.[0];
  const since = newest && newest.status === monitor.status ? newest.at : null;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="min-w-0 break-words">{monitor.name}</span>
            <MonitorStatusBadge status={monitor.status} className="text-base" />
          </span>
        }
        description={
          monitor.target ? (
            href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex max-w-full items-center gap-1 hover:text-text hover:underline"
              >
                <Mono className="truncate">{monitor.target}</Mono>
                <ExternalLink className="size-3.5 shrink-0" aria-hidden />
              </a>
            ) : (
              <Mono>{monitor.target}</Mono>
            )
          ) : undefined
        }
        actions={
          <MonitorActionButtons
            monitor={monitor}
            minIntervalSeconds={minIntervalSeconds}
            onDeleted={() => navigate(`${base}/monitoring`, { replace: true })}
          />
        }
      />

      <div className="space-y-6">
        {monitor.missingSince && (
          <Notice tone="warning">
            <MissingHint missingSince={monitor.missingSince} active={monitor.active} className="text-sm" />
          </Notice>
        )}
        {monitor.liveError && (
          <Notice tone="warning" title={t('uptime.liveError')}>
            <span className="block break-words">{monitor.liveError}</span>
          </Notice>
        )}
        {monitor.origin === 'console' && monitor.managementError && (
          <Notice tone="info" title={t('uptime.managementError')}>
            <span className="block break-words">{monitor.managementError}</span>
          </Notice>
        )}

        <Card>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border sm:grid-cols-3 lg:grid-cols-5">
            <Kpi label={t('uptime.col.status')}>
              <MonitorStatusBadge status={monitor.status} />
              {since && (
                <div className="mt-1 text-xs text-muted">
                  {t('uptime.since', { when: formatRelative(since, locale) })}
                </div>
              )}
            </Kpi>
            <Kpi label={t('uptime.uptime24h')}>
              <span className="text-lg font-semibold tabular">{formatUptime(facts?.uptime24h, locale)}</span>
            </Kpi>
            <Kpi label={t('uptime.uptime30d')}>
              <span className="text-lg font-semibold tabular">{formatUptime(facts?.uptime30d, locale)}</span>
            </Kpi>
            <Kpi label={t('uptime.avg24h')}>
              <span className="text-lg font-semibold tabular">
                {formatResponse(facts?.avgResponseMs24h, locale)}
              </span>
              {facts?.responseMs !== null && facts?.responseMs !== undefined && (
                <div className="mt-1 text-xs text-muted tabular">
                  {t('uptime.current', { value: formatResponse(facts.responseMs, locale) })}
                </div>
              )}
            </Kpi>
            <Kpi label={t('uptime.col.cert')}>
              <CertBadge days={facts?.certDaysRemaining} valid={facts?.certValid} />
            </Kpi>
          </div>
        </Card>

        <HistoryCard monitor={monitor} />

        <div className="grid gap-6 xl:grid-cols-2">
          {monitor.events && <EventsCard events={monitor.events} />}
          {monitor.config && <ConfigCard monitor={monitor} config={monitor.config} />}
        </div>
      </div>
    </>
  );
}

function Kpi({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bg-surface px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-text">{children}</div>
    </div>
  );
}

const RANGE_LABEL: Record<MonitorHistoryRange, TranslationKey> = {
  recent: 'uptime.range.recent',
  '24h': 'uptime.range.24h',
  '7d': 'uptime.range.7d',
  '30d': 'uptime.range.30d',
};

/** Response time chart with an availability strip; ranges as the instance can serve them. */
function HistoryCard({ monitor }: { monitor: MonitorDetailDto }) {
  const { t, locale } = useI18n();
  const ranges = monitor.historyRanges;
  const [chosen, setChosen] = useState<MonitorHistoryRange | null>(null);
  const range = chosen && ranges.includes(chosen) ? chosen : defaultHistoryRange(ranges);
  const history = useMonitorHistory(monitor.id, range ?? 'recent', !!range);

  if (!range) {
    return (
      <Card>
        <CardHeader title={t('uptime.responseTime')} />
        <CardBody>
          <Notice tone="info" icon={<History className="size-4" />}>
            {t('uptime.noHistory')}
          </Notice>
        </CardBody>
      </Card>
    );
  }

  // While another range loads, the previous one stays (dimmed) instead of an empty frame.
  const data = history.data ?? null;
  const noRange = history.error instanceof ApiError && history.error.status === 404;
  const subtitle = data
    ? data.source === 'statusPage'
      ? t('uptime.history.statusPage', { n: formatNumber(data.points.length, locale) })
      : data.resolutionSeconds
        ? t('uptime.history.kuma', { resolution: intervalLabel(t, data.resolutionSeconds) })
        : undefined
    : undefined;

  return (
    <div className="space-y-3">
      {ranges.length > 1 && (
        <div
          className="inline-flex rounded-lg border border-border bg-surface p-0.5 shadow-card"
          role="group"
          aria-label={t('graphs.range')}
        >
          {ranges.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setChosen(r)}
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
      )}
      {noRange ? (
        <Card>
          <CardHeader title={t('uptime.responseTime')} />
          <CardBody>
            <Notice tone="info">{t('uptime.noHistoryRange')}</Notice>
          </CardBody>
        </Card>
      ) : history.isError && !history.data ? (
        <ErrorState error={history.error} onRetry={() => void history.refetch()} />
      ) : history.isPending ? (
        <Card>
          <LoadingBlock rows={4} />
        </Card>
      ) : (
        <>
          <MetricChart
            title={t('uptime.responseTime')}
            subtitle={subtitle}
            points={(data?.points ?? []).map((p) => ({ t: p.t, ping: p.ping }))}
            series={[{ key: 'ping', label: t('uptime.responseTime'), slot: 1 }]}
            format={(v) => formatResponse(v, locale)}
            range={CHART_RANGE[data?.range ?? range]}
            fetching={history.isFetching}
          />
          {data && data.points.length > 0 && (
            <Card>
              <CardBody className="space-y-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                  <span>{t('uptime.strip')}</span>
                  <span className="flex flex-wrap items-center gap-3">
                    <Legend className="bg-success" label={t('uptime.strip.up')} />
                    <Legend className="bg-danger" label={t('uptime.strip.down')} />
                    <Legend className="bg-brand-blue" label={t('uptime.strip.maintenance')} />
                  </span>
                </div>
                <AvailabilityStrip points={data.points} />
              </CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('inline-block size-2 rounded-sm', className)} aria-hidden />
      {label}
    </span>
  );
}

function EventsCard({ events }: { events: MonitorEvent[] }) {
  const { t, locale } = useI18n();
  return (
    <Card className="min-w-0">
      <CardHeader title={t('uptime.events.title')} description={t('uptime.events.text')} />
      {events.length === 0 ? (
        <EmptyState className="py-8" title={t('uptime.events.empty')} />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>{t('uptime.events.time')}</TH>
              <TH>{t('uptime.col.status')}</TH>
              <TH>{t('uptime.events.message')}</TH>
            </tr>
          </THead>
          <TBody>
            {events.map((e, i) => (
              <tr key={`${e.at}-${i}`}>
                <TD className="text-sm whitespace-nowrap text-muted tabular">{formatDate(e.at, locale)}</TD>
                <TD className="w-0">
                  <MonitorStatusBadge status={e.status} />
                </TD>
                <TD className="max-w-[360px] text-sm break-words">
                  {e.message ?? <span className="text-subtle">–</span>}
                  {e.responseMs !== null && (
                    <span className="ml-2 text-xs text-muted tabular">
                      {formatResponse(e.responseMs, locale)}
                    </span>
                  )}
                </TD>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

function ConfigCard({ monitor, config }: { monitor: MonitorDetailDto; config: MonitorConfig }) {
  const { t } = useI18n();
  const web = monitor.kind ? isWebKind(monitor.kind) : !!config.url;
  const items: { label: string; value: ReactNode }[] = [
    { label: t('uptime.config.type'), value: <KindLabel type={monitor.type} /> },
  ];
  const target = web ? (config.url ?? monitor.target) : monitor.target;
  if (target) items.push({ label: t('uptime.config.target'), value: <Mono>{target}</Mono> });
  items.push({ label: t('uptime.config.interval'), value: intervalLabel(t, config.intervalSeconds) });
  if (config.maxRetries !== null) {
    items.push({
      label: t('uptime.config.retries'),
      value:
        config.maxRetries === 0
          ? t('uptime.config.noRetries')
          : t(config.maxRetries === 1 ? 'uptime.config.retry' : 'uptime.config.retriesValue', {
              n: config.maxRetries,
              interval: intervalLabel(t, config.retryIntervalSeconds ?? config.intervalSeconds),
            }),
    });
  }
  if (config.timeoutSeconds !== null) {
    items.push({ label: t('uptime.config.timeout'), value: intervalLabel(t, config.timeoutSeconds) });
  }
  if (config.keyword !== null && monitor.type === 'keyword') {
    items.push({
      label: t('uptime.config.keyword'),
      value: (
        <>
          <Mono>{config.keyword}</Mono>
          {config.invertKeyword && <span className="ml-2 text-muted">{t('uptime.config.inverted')}</span>}
        </>
      ),
    });
  }
  if (web) {
    if (config.method) items.push({ label: t('uptime.config.method'), value: <Mono>{config.method}</Mono> });
    if (config.acceptedStatusCodes.length > 0) {
      items.push({
        label: t('uptime.config.statusCodes'),
        value: <Mono>{config.acceptedStatusCodes.join(', ')}</Mono>,
      });
    }
    items.push({
      label: t('uptime.config.ignoreTls'),
      value: config.ignoreTls ? t('uptime.config.yes') : t('uptime.config.no'),
    });
  }
  if (config.upsideDown) items.push({ label: t('uptime.config.upsideDown'), value: t('uptime.config.yes') });

  return (
    <Card className="min-w-0">
      <CardHeader title={t('uptime.config.title')} description={t('uptime.config.text')} />
      <CardBody className="py-1">
        <KeyValue items={items} />
      </CardBody>
    </Card>
  );
}
