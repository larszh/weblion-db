import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, HeartPulse, Plus, Search } from 'lucide-react';
import {
  MONITOR_MIN_INTERVAL_SECONDS,
  type MonitorAllowanceDto,
  type MonitorDto,
  type MonitorStatusPageDto,
} from '@weblion/shared';
import type { TranslationKey } from '@/i18n/de';
import { formatNumber, formatRelative } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { ApiError } from '@/lib/api';
import { useOrgMonitoring } from '@/lib/api/monitoring';
import { Button } from '@/components/ui/button';
import { Menu, MenuItem, MenuLabel, Tooltip } from '@/components/ui/menu';
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
  PageHeader,
  Select,
  UsageBar,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ModuleOffState, PanelLink, safePanelUrl } from '@/pages/hosting/bits';
import {
  CertBadge,
  KindLabel,
  MissingHint,
  MonitorStatusBadge,
  STATUS_FILTERS,
  filterMonitors,
  formatResponse,
  formatUptime,
  freeMonitorSlots,
  instanceCount,
  intervalLabel,
  sortMonitors,
  type StatusFilter,
} from './bits';
import { CreateMonitorDialog, MonitorActionsMenu } from './dialogs';

/** Monitors of an organization (/o/:slug/monitoring): status, uptime, response time and its allowance. */
export function MonitoringPage() {
  const { t } = useI18n();
  const { org, can, hasModule } = useOrg();
  const moduleOn = hasModule('monitoring');
  const canRead = can('monitor:read');
  // Policies can grant single monitors: the API answers 403 only when nothing is readable.
  const monitoring = useOrgMonitoring(org.id, moduleOn || canRead);
  const [creating, setCreating] = useState(false);

  const allowance = monitoring.data?.allowance ?? null;
  const monitors = monitoring.data?.monitors ?? [];
  const statusPages = (monitoring.data?.statusPages ?? []).filter((p) => safePanelUrl(p.url));
  const canCreate = !!allowance && allowance.management && can('monitor:write');
  const full = !!allowance && freeMonitorSlots(allowance) === 0;
  const forbidden = monitoring.error instanceof ApiError && monitoring.error.status === 403;

  let body;
  if ((!moduleOn && !canRead) || (!moduleOn && monitoring.isError)) {
    body = (
      <Card>
        <ModuleOffState module="monitoring" />
      </Card>
    );
  } else if (forbidden) {
    body = (
      <Card>
        <EmptyState title={t('uptime.noAccess')} description={t('uptime.noAccessText')} />
      </Card>
    );
  } else if (monitoring.isPending) {
    body = <LoadingBlock rows={6} />;
  } else if (monitoring.isError) {
    body = <ErrorState error={monitoring.error} onRetry={() => void monitoring.refetch()} />;
  } else if (!allowance && monitors.length === 0) {
    body = (
      <Card>
        <EmptyState
          icon={<HeartPulse className="size-6" />}
          title={t('uptime.none.title')}
          description={
            org.parent ? t('uptime.none.textReseller', { reseller: org.parent.name }) : t('uptime.none.text')
          }
        />
      </Card>
    );
  } else {
    body = (
      <div className="space-y-6">
        {!moduleOn && <Notice tone="warning">{t('hosting.moduleOff.staff')}</Notice>}
        {allowance && <AllowanceCard allowance={allowance} reseller={org.kind === 'reseller'} />}
        <MonitorsCard
          monitors={monitors}
          minIntervalSeconds={allowance?.minIntervalSeconds ?? MONITOR_MIN_INTERVAL_SECONDS}
          onCreate={canCreate && !full ? () => setCreating(true) : undefined}
        />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={t('nav.uptime')}
        description={t('uptime.subtitle')}
        actions={
          <>
            <StatusPageButton pages={statusPages} />
            {canCreate &&
              (full ? (
                <Tooltip content={t('uptime.allowance.full')}>
                  {/* A disabled button gets no pointer events: the wrapper carries the tooltip. */}
                  <span tabIndex={0}>
                    <Button variant="primary" icon={<Plus className="size-4" />} disabled>
                      {t('uptime.create')}
                    </Button>
                  </span>
                </Tooltip>
              ) : (
                <Button
                  variant="primary"
                  icon={<Plus className="size-4" />}
                  onClick={() => setCreating(true)}
                >
                  {t('uptime.create')}
                </Button>
              ))}
          </>
        }
      />
      {body}
      {creating && allowance && (
        <CreateMonitorDialog orgId={org.id} allowance={allowance} onClose={() => setCreating(false)} />
      )}
    </>
  );
}

/** One link to the public status page, or a menu when there are pages on several instances. */
function StatusPageButton({ pages }: { pages: MonitorStatusPageDto[] }) {
  const { t } = useI18n();
  if (pages.length === 0) return null;
  if (pages.length === 1) {
    return (
      <PanelLink href={pages[0]!.url} variant="secondary">
        {t('uptime.openStatusPage')}
      </PanelLink>
    );
  }
  return (
    <Menu trigger={<Button icon={<ExternalLink className="size-4" />}>{t('uptime.openStatusPage')}</Button>}>
      <MenuLabel>{t('uptime.statusPages')}</MenuLabel>
      {pages.map((p) => (
        <MenuItem
          key={p.provider.id}
          icon={<ExternalLink />}
          hint={p.slug}
          onSelect={() => window.open(p.url, '_blank', 'noopener,noreferrer')}
        >
          {p.provider.name}
        </MenuItem>
      ))}
    </Menu>
  );
}

function AllowanceCard({ allowance, reseller }: { allowance: MonitorAllowanceDto; reseller: boolean }) {
  const { t, locale } = useI18n();
  const pct = allowance.maxMonitors > 0 ? (allowance.committed / allowance.maxMonitors) * 100 : 100;
  return (
    <Card>
      <CardHeader title={t('uptime.allowance.title')} description={t('uptime.allowance.text')} />
      <CardBody className="space-y-3">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="text-xs text-muted">{t('uptime.allowance.monitors')}</div>
            <div className="mt-1 text-lg font-semibold text-text tabular">
              {t('uptime.allowance.used', {
                n: formatNumber(allowance.committed, locale),
                max: formatNumber(allowance.maxMonitors, locale),
              })}
            </div>
            <UsageBar value={pct} className="mt-2 max-w-xs" />
            {reseller && allowance.customers > 0 && (
              <p className="mt-1.5 text-xs text-muted">
                {t('uptime.allowance.toCustomers', {
                  n: formatNumber(allowance.customerMonitors, locale),
                  customers: allowance.customers,
                })}
              </p>
            )}
          </div>
          <div>
            <div className="text-xs text-muted">{t('uptime.allowance.minInterval')}</div>
            <div className="mt-1 text-lg font-semibold text-text">
              {intervalLabel(t, allowance.minIntervalSeconds)}
            </div>
          </div>
        </div>
        {!allowance.management && <Notice tone="info">{t('uptime.managementOff')}</Notice>}
      </CardBody>
    </Card>
  );
}

const FILTER_LABEL: Record<StatusFilter, TranslationKey> = {
  all: 'uptime.filter.all',
  down: 'uptime.filter.down',
  up: 'uptime.filter.up',
  paused: 'uptime.filter.paused',
};

function MonitorsCard({
  monitors,
  minIntervalSeconds,
  onCreate,
}: {
  monitors: MonitorDto[];
  minIntervalSeconds: number;
  onCreate?: () => void;
}) {
  const { t, locale } = useI18n();
  const { base } = useOrg();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const list = sortMonitors(filterMonitors(monitors, q, status));
  const multi = instanceCount(monitors) > 1;
  const withActions = monitors.some(
    (m) => m.permissions.includes('monitor:write') || m.permissions.includes('monitor:delete'),
  );
  const lastSync = monitors
    .map((m) => m.lastSyncedAt)
    .filter((v): v is string => !!v)
    .sort()
    .at(-1);

  return (
    <Card>
      <CardHeader
        title={t('uptime.monitors')}
        description={
          lastSync
            ? t('uptime.lastSync', { when: formatRelative(lastSync, locale) })
            : t('uptime.monitorsText')
        }
      />
      {monitors.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('uptime.search')}
              className="pl-9"
              aria-label={t('uptime.search')}
            />
          </div>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="w-auto"
            aria-label={t('uptime.filter.label')}
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f} value={f}>
                {t(FILTER_LABEL[f])}
              </option>
            ))}
          </Select>
        </div>
      )}
      {monitors.length === 0 ? (
        <EmptyState
          icon={<HeartPulse className="size-6" />}
          title={t('uptime.empty')}
          description={onCreate ? t('uptime.emptyText') : t('uptime.emptyTextAssigned')}
          action={
            onCreate && (
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={onCreate}>
                {t('uptime.create')}
              </Button>
            )
          }
        />
      ) : list.length === 0 ? (
        <EmptyState icon={<Search className="size-6" />} title={t('hosting.noMatch')} />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>{t('uptime.col.status')}</TH>
              <TH>{t('uptime.col.name')}</TH>
              <TH className="hidden lg:table-cell">{t('uptime.col.type')}</TH>
              <TH className="hidden sm:table-cell">{t('uptime.col.uptime24h')}</TH>
              <TH className="hidden md:table-cell">{t('uptime.col.uptime30d')}</TH>
              <TH className="hidden md:table-cell">{t('uptime.col.response')}</TH>
              <TH className="hidden xl:table-cell">{t('uptime.col.cert')}</TH>
              <TH className="hidden xl:table-cell">{t('uptime.col.interval')}</TH>
              {multi && <TH className="hidden lg:table-cell">{t('uptime.col.instance')}</TH>}
              {withActions && <TH />}
            </tr>
          </THead>
          <TBody>
            {list.map((m) => (
              <TR key={m.id}>
                <TD className="w-0">
                  <MonitorStatusBadge status={m.status} />
                </TD>
                <TD className="max-w-[320px]">
                  <Link
                    to={`${base}/monitoring/${m.id}`}
                    className="block truncate font-medium text-text hover:underline"
                  >
                    {m.name}
                  </Link>
                  {m.target && <Mono className="block truncate text-muted">{m.target}</Mono>}
                  <MissingHint missingSince={m.missingSince} active={m.active} className="mt-0.5" />
                  {/* Uptime moves below the name on narrow screens. */}
                  <div className="mt-0.5 text-xs text-muted sm:hidden">
                    {t('uptime.uptime24h')}: {formatUptime(m.facts?.uptime24h, locale)}
                  </div>
                </TD>
                <TD className="hidden lg:table-cell">
                  <KindLabel type={m.type} />
                </TD>
                <TD className="hidden tabular sm:table-cell">{formatUptime(m.facts?.uptime24h, locale)}</TD>
                <TD className="hidden tabular md:table-cell">{formatUptime(m.facts?.uptime30d, locale)}</TD>
                <TD className="hidden md:table-cell">
                  <div className="tabular">{formatResponse(m.facts?.responseMs, locale)}</div>
                  {m.facts?.avgResponseMs24h !== null && m.facts?.avgResponseMs24h !== undefined && (
                    <div className="text-xs text-muted tabular">
                      {t('uptime.avgShort', { value: formatResponse(m.facts.avgResponseMs24h, locale) })}
                    </div>
                  )}
                </TD>
                <TD className="hidden xl:table-cell">
                  <CertBadge days={m.facts?.certDaysRemaining} valid={m.facts?.certValid} />
                </TD>
                <TD className="hidden text-sm whitespace-nowrap text-muted xl:table-cell">
                  {intervalLabel(t, m.intervalSeconds)}
                </TD>
                {multi && (
                  <TD className="hidden text-sm whitespace-nowrap text-muted lg:table-cell">
                    {m.provider.name}
                  </TD>
                )}
                {withActions && (
                  <TD className="w-12 text-right">
                    <MonitorActionsMenu monitor={m} minIntervalSeconds={minIntervalSeconds} />
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
