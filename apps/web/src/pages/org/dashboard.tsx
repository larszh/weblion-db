import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Briefcase,
  CirclePause,
  CirclePlay,
  FolderKanban,
  Globe,
  HardDrive,
  Layers,
  Mail,
  PackageX,
  Plus,
  Server,
  Users,
} from 'lucide-react';
import { formatMoney, type ServerDto } from '@weblion/shared';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { useAudit, useProjects, useServers } from '@/lib/queries';
import { formatRelative } from '@/lib/format';
import { useBillingSummary, useResellerCustomers } from '@/lib/api/admin';
import { useDomains, useWebspaces } from '@/lib/api/hosting';
import { useOrgCloud } from '@/lib/api/cloud';
import {
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingBlock,
  Notice,
  PageHeader,
  Skeleton,
} from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Flag, StatusDot } from '@/components/server-bits';
import { DomainStatusBadge, ExpiryText } from '@/pages/hosting/bits';
import { ModuleBadges, StatusBadge } from '@/pages/reseller/bits';
import { formatQuota } from '@/pages/cloud/bits';
import { MailCard } from '@/pages/mail/dashboard-card';
import { ProjectDialog } from './projects';
import { ActivityList } from './audit';

function StatTile({
  icon,
  label,
  value,
  tone,
  to,
  sub,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  tone: string;
  to?: string;
  sub?: ReactNode;
}) {
  const content = (
    <Card className="flex min-w-0 flex-1 items-center gap-4 px-5 py-4 transition-colors hover:border-border-strong">
      <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${tone} [&>svg]:size-5`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-semibold text-text tabular">{value}</div>
        <div className="truncate text-sm text-muted">{label}</div>
        {sub && <div className="truncate text-xs text-subtle tabular">{sub}</div>}
      </div>
    </Card>
  );
  // Flex wrappers so every tile in a row gets the same height, with or without a sub line.
  return to ? (
    <Link to={to} className="flex min-w-0">
      {content}
    </Link>
  ) : (
    <div className="flex min-w-0">{content}</div>
  );
}

function locationSummary(servers: ServerDto[]) {
  const map = new Map<string, { country: string; label: string; count: number; running: number }>();
  for (const s of servers) {
    const key = `${s.location.country}:${s.location.label}`;
    const entry = map.get(key) ?? {
      country: s.location.country,
      label: s.location.label,
      count: 0,
      running: 0,
    };
    entry.count += 1;
    if (s.status === 'running') entry.running += 1;
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/** Card header link to the full list. */
function ShowAll({ to }: { to: string }) {
  const { t } = useI18n();
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 text-sm font-medium text-primary-text hover:underline"
    >
      {t('common.showAll')} <ArrowRight className="size-3.5" />
    </Link>
  );
}

/** How many rows the service cards show before "show all". */
const PREVIEW_ROWS = 5;

function DomainsCard() {
  const { t } = useI18n();
  const { org, base } = useOrg();
  const domains = useDomains(org.id);
  return (
    <Card>
      <CardHeader title={t('nav.domains')} actions={<ShowAll to={`${base}/domains`} />} />
      {domains.isPending ? (
        <LoadingBlock rows={2} />
      ) : domains.isError ? (
        <div className="p-5">
          <ErrorState error={domains.error} onRetry={() => void domains.refetch()} />
        </div>
      ) : domains.data.length === 0 ? (
        <CardBody className="text-sm text-muted">{t('admin.dash.noDomains')}</CardBody>
      ) : (
        <ul className="divide-y divide-border">
          {domains.data.slice(0, PREVIEW_ROWS).map((d) => (
            <li key={d.id}>
              <Link
                to={`${base}/domains/${d.id}`}
                className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2"
              >
                <Globe className="size-4 shrink-0 text-subtle" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{d.name}</span>
                <span className="hidden text-sm text-muted sm:inline">
                  <ExpiryText expiresAt={d.expiresAt} autoRenew={d.autoRenew} />
                </span>
                <DomainStatusBadge domain={d} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function WebspacesCard() {
  const { t } = useI18n();
  const { org, base } = useOrg();
  const webspaces = useWebspaces(org.id);
  return (
    <Card>
      <CardHeader title={t('nav.webhosting')} actions={<ShowAll to={`${base}/webhosting`} />} />
      {webspaces.isPending ? (
        <LoadingBlock rows={2} />
      ) : webspaces.isError ? (
        <div className="p-5">
          <ErrorState error={webspaces.error} onRetry={() => void webspaces.refetch()} />
        </div>
      ) : webspaces.data.length === 0 ? (
        <CardBody className="text-sm text-muted">{t('admin.dash.noWebspaces')}</CardBody>
      ) : (
        <ul className="divide-y divide-border">
          {webspaces.data.slice(0, PREVIEW_ROWS).map((w) => (
            <li key={w.id}>
              <Link
                to={`${base}/webhosting/${w.id}`}
                className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2"
              >
                <Layers className="size-4 shrink-0 text-subtle" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{w.name}</span>
                <span className="inline-flex shrink-0 items-center gap-2 text-sm text-muted">
                  <Flag country={w.location.country} />
                  <span className="hidden sm:inline">{w.location.label}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function CustomersCard() {
  const { t } = useI18n();
  const { org, base, can } = useOrg();
  const customers = useResellerCustomers(org.id);
  return (
    <Card>
      <CardHeader title={t('nav.customers')} actions={<ShowAll to={`${base}/customers`} />} />
      {customers.isPending ? (
        <LoadingBlock rows={2} />
      ) : customers.isError ? (
        <div className="p-5">
          <ErrorState error={customers.error} onRetry={() => void customers.refetch()} />
        </div>
      ) : customers.data.length === 0 ? (
        <EmptyState
          className="py-8"
          icon={<Briefcase className="size-6" />}
          title={t('admin.reseller.empty')}
          action={
            can('reseller:customer:write') && (
              <Link
                to={`${base}/customers`}
                className="text-sm font-medium text-primary-text hover:underline"
              >
                {t('admin.reseller.new')}
              </Link>
            )
          }
        />
      ) : (
        <ul className="divide-y divide-border">
          {customers.data.slice(0, PREVIEW_ROWS).map((c) => (
            <li key={c.id}>
              <Link
                to={`${base}/customers/${c.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3 transition-colors hover:bg-surface-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{c.name}</span>
                <span className="hidden md:block">
                  <ModuleBadges modules={c.modules} empty={t('admin.modules.none')} />
                </span>
                {c.status === 'suspended' && (
                  <StatusBadge status={c.status} suspendedBy={c.suspendedBy} viewer="reseller" />
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function BillingCard() {
  const { t, locale } = useI18n();
  const { org, base } = useOrg();
  const summary = useBillingSummary(org.id);
  const s = summary.data;
  return (
    <Card>
      <CardHeader title={t('nav.billing')} actions={<ShowAll to={`${base}/billing`} />} />
      {summary.isPending ? (
        <LoadingBlock rows={2} />
      ) : summary.isError || !s ? (
        <div className="p-5">
          <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
        </div>
      ) : (
        <>
          <CardBody className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-muted">{t('admin.balance')}</div>
              <div className="mt-0.5 text-xl font-semibold text-text tabular">
                {formatMoney(s.balance, s.currency, locale)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">{t('admin.openTotal')}</div>
              <div
                className={cn(
                  'mt-0.5 text-xl font-semibold tabular',
                  s.overdueTotal > 0 ? 'text-danger' : s.openTotal > 0 ? 'text-warning' : 'text-text',
                )}
              >
                {formatMoney(s.openTotal, s.currency, locale)}
              </div>
              {s.openCount > 0 && (
                <div className="text-xs text-muted">{t('admin.dash.openInvoices', { n: s.openCount })}</div>
              )}
            </div>
          </CardBody>
          {s.overdueTotal > 0 && (
            <div className="px-5 pb-4">
              <Notice tone="danger">
                {t('admin.dash.overdue', { amount: formatMoney(s.overdueTotal, s.currency, locale) })}
              </Notice>
            </div>
          )}
          <div className="space-y-1 border-t border-border px-5 py-2.5 text-xs text-subtle">
            {s.activeServices > 0 && (
              <div className="tabular">
                {t('admin.dash.recurring', {
                  n: s.activeServices,
                  amount: formatMoney(s.monthlyRecurring, s.currency, locale),
                })}
              </div>
            )}
            <div className="truncate">{t('admin.dash.seller', { name: s.seller.name })}</div>
          </div>
        </>
      )}
    </Card>
  );
}

export function OrgDashboard() {
  const { t, locale } = useI18n();
  const { org, base, can, hasModule } = useOrg();
  const hasServers = hasModule('servers');
  const showDomains = hasModule('dns') && can('domain:read');
  const showWebspaces = hasModule('webhosting') && can('webspace:read');
  const showCloud = hasModule('storage') && can('cloud:read');
  const showMail = hasModule('mail') && can('mail:read');
  const showCustomers = org.kind === 'reseller' && can('reseller:customer:read');
  const projects = useProjects(hasServers ? org.id : undefined);
  const servers = useServers(hasServers ? org.id : undefined);
  const cloud = useOrgCloud(org.id, showCloud);
  const allowance = cloud.data?.allowance ?? null;
  const audit = useAudit(`/orgs/${org.id}/audit`, { page: 1, perPage: 8 }, can('audit:read'));
  const [creating, setCreating] = useState(false);

  const list = servers.data ?? [];
  const running = list.filter((s) => s.status === 'running').length;
  const stopped = list.filter((s) => s.status === 'stopped').length;
  const counts = org.counts;
  const membersTile = can('member:read') ? (
    <StatTile
      key="members"
      icon={<Users />}
      label={t('dashboard.stat.members')}
      value={counts?.members ?? '–'}
      tone="bg-info-soft text-[#0a8d90] dark:text-brand-teal"
      to={`${base}/members`}
    />
  ) : hasServers ? (
    <StatTile
      key="projects"
      icon={<FolderKanban />}
      label={t('dashboard.stat.projects')}
      value={projects.data?.length ?? '–'}
      tone="bg-info-soft text-[#0a8d90] dark:text-brand-teal"
      to={`${base}/projects`}
    />
  ) : null;

  // Servers only: the classic tiles. With more modules one tile per service instead.
  const serversOnly =
    hasServers && !showDomains && !showWebspaces && !showCloud && !showMail && !showCustomers;
  const tiles: ReactNode[] = serversOnly
    ? [
        <StatTile
          key="servers"
          icon={<Server />}
          label={t('dashboard.stat.servers')}
          value={list.length}
          tone="bg-primary-soft text-primary-text"
          to={`${base}/servers`}
        />,
        <StatTile
          key="running"
          icon={<CirclePlay />}
          label={t('dashboard.stat.running')}
          value={running}
          tone="bg-success-soft text-success"
          to={`${base}/servers`}
        />,
        <StatTile
          key="stopped"
          icon={<CirclePause />}
          label={t('dashboard.stat.stopped')}
          value={stopped}
          tone="bg-surface-3 text-muted"
          to={`${base}/servers`}
        />,
        membersTile,
      ]
    : [
        hasServers && (
          <StatTile
            key="servers"
            icon={<Server />}
            label={t('dashboard.stat.servers')}
            value={list.length}
            sub={t('admin.dash.serversSub', { running, stopped })}
            tone="bg-primary-soft text-primary-text"
            to={`${base}/servers`}
          />
        ),
        showDomains && (
          <StatTile
            key="domains"
            icon={<Globe />}
            label={t('admin.resources.domains')}
            value={counts?.domains ?? '–'}
            tone="bg-primary-soft text-primary-text"
            to={`${base}/domains`}
          />
        ),
        showWebspaces && (
          <StatTile
            key="webspaces"
            icon={<Layers />}
            label={t('admin.resources.webspaces')}
            value={counts?.webspaces ?? '–'}
            tone="bg-primary-soft text-primary-text"
            to={`${base}/webhosting`}
          />
        ),
        showCloud && (
          <StatTile
            key="cloud"
            icon={<HardDrive />}
            label={t('storage.admin.tab')}
            value={cloud.data ? cloud.data.accounts.length : '–'}
            sub={
              allowance
                ? t('storage.dashboardSub', {
                    allocated: formatQuota(allowance.allocatedBytes, locale),
                    quota: formatQuota(allowance.quotaBytes, locale),
                  })
                : undefined
            }
            tone="bg-primary-soft text-primary-text"
            to={`${base}/cloud`}
          />
        ),
        showMail && (
          <StatTile
            key="mail"
            icon={<Mail />}
            label={t('admin.resources.mailDomains')}
            value={counts?.mailDomains ?? '–'}
            tone="bg-primary-soft text-primary-text"
            to={`${base}/mail`}
          />
        ),
        showCustomers && (
          <StatTile
            key="customers"
            icon={<Briefcase />}
            label={t('nav.customers')}
            value={counts?.customers ?? '–'}
            tone="bg-success-soft text-success"
            to={`${base}/customers`}
          />
        ),
        membersTile,
      ]
        .filter(Boolean)
        .slice(0, 4);
  const visibleTiles = tiles.filter(Boolean);
  const cols = ['', 'sm:grid-cols-2', 'sm:grid-cols-2', 'sm:grid-cols-3', 'lg:grid-cols-4'][
    Math.min(visibleTiles.length, 4)
  ];

  return (
    <>
      <PageHeader
        eyebrow={t('dashboard.eyebrow')}
        title={org.name}
        description={hasServers ? t('dashboard.subtitle') : t('admin.dash.subtitle')}
        actions={
          hasServers &&
          can('project:create') && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              {t('projects.new')}
            </Button>
          )
        }
      />

      {org.access === 'reseller' && org.parent && (
        <Notice tone="info" className="mb-6" icon={<Briefcase className="size-4" />}>
          {t('admin.dash.viaReseller', { name: org.parent.name })}{' '}
          <Link
            to={`/o/${org.parent.slug}/customers/${org.id}`}
            className="font-medium underline underline-offset-2"
          >
            {t('admin.dash.backToReseller')}
          </Link>
        </Notice>
      )}

      {visibleTiles.length > 0 && (
        <div className={cn('grid grid-cols-2 gap-4', cols)}>
          {hasServers && servers.isPending
            ? visibleTiles.map((_, i) => <Skeleton key={i} className="h-[76px] rounded-xl" />)
            : visibleTiles}
        </div>
      )}

      <div className={cn('grid gap-6 xl:grid-cols-[1fr_380px]', visibleTiles.length > 0 && 'mt-8')}>
        <div className="min-w-0 space-y-6">
          {hasServers && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[15px] font-semibold text-text">{t('nav.projects')}</h2>
                <ShowAll to={`${base}/projects`} />
              </div>
              {projects.isError ? (
                <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />
              ) : projects.isPending ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Skeleton className="h-32 rounded-xl" />
                  <Skeleton className="h-32 rounded-xl" />
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {projects.data.map((p) => (
                    <Link key={p.id} to={`${base}/projects/${p.id}`}>
                      <Card className="h-full p-5 transition-all hover:border-brand-blue/50 hover:shadow-pop">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex size-9 items-center justify-center rounded-lg bg-primary-soft text-primary-text">
                            <FolderKanban className="size-[18px]" />
                          </div>
                          <ArrowRight className="size-4 text-subtle" />
                        </div>
                        <h3 className="mt-3 truncate font-semibold text-text">{p.name}</h3>
                        <p className="mt-0.5 line-clamp-1 text-sm text-muted">{p.description || ' '}</p>
                        <div className="mt-3 flex items-center gap-4 text-sm text-muted">
                          <span className="tabular">{t('projects.serverCount', { n: p.serverCount })}</span>
                          {p.serverCount > 0 && (
                            <span className="inline-flex items-center gap-1.5 tabular">
                              <StatusDot status="running" className="size-2" />
                              {p.runningCount} {t('status.running').toLowerCase()}
                            </span>
                          )}
                        </div>
                      </Card>
                    </Link>
                  ))}
                  {can('project:create') && (
                    <button
                      onClick={() => setCreating(true)}
                      className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border text-sm font-medium text-muted transition-colors hover:border-brand-blue/50 hover:text-primary-text"
                    >
                      <Plus className="size-5" />
                      {t('projects.new')}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {showCustomers && <CustomersCard />}

          {(showDomains || showWebspaces) && (
            <div className={cn('grid gap-6', showDomains && showWebspaces && '2xl:grid-cols-2')}>
              {showDomains && <DomainsCard />}
              {showWebspaces && <WebspacesCard />}
            </div>
          )}

          {showMail && <MailCard />}

          {list.length > 0 && (
            <Card>
              <CardHeader title={t('dashboard.locations')} />
              <CardBody className="space-y-3">
                {locationSummary(list).map((l) => (
                  <div key={l.label} className="flex items-center gap-3">
                    <Flag country={l.country} />
                    <span className="flex-1 text-sm text-text">{l.label}</span>
                    <span className="text-sm text-muted tabular">
                      {l.running}/{l.count} {t('status.running').toLowerCase()}
                    </span>
                  </div>
                ))}
              </CardBody>
            </Card>
          )}

          {!hasServers && !showDomains && !showWebspaces && !showMail && !showCustomers && (
            <Card>
              <EmptyState
                icon={<PackageX className="size-6" />}
                title={t('admin.dash.noModules')}
                description={t('admin.dash.noModulesText')}
              />
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {can('billing:read') && <BillingCard />}
          <Card className="h-fit">
            <CardHeader
              title={t('dashboard.activity')}
              actions={
                can('audit:read') && (
                  <Link
                    to={`${base}/audit`}
                    className="text-sm font-medium text-primary-text hover:underline"
                  >
                    {t('common.showAll')}
                  </Link>
                )
              }
            />
            {!can('audit:read') ? (
              <EmptyState title={t('dashboard.activity.noAccess')} className="py-10" />
            ) : audit.isPending ? (
              <LoadingBlock rows={4} />
            ) : audit.isError ? (
              <div className="p-5">
                <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />
              </div>
            ) : audit.data.items.length > 0 ? (
              <ActivityList items={audit.data.items} compact />
            ) : (
              <EmptyState title={t('dashboard.activity.empty')} className="py-10" />
            )}
            {audit.data && audit.data.items[0] && (
              <div className="border-t border-border px-5 py-2.5 text-xs text-subtle">
                {t('dashboard.activity.last', {
                  when: formatRelative(audit.data.items[0].createdAt, locale),
                })}
              </div>
            )}
          </Card>
        </div>
      </div>

      {hasServers && <ProjectDialog open={creating} onOpenChange={setCreating} />}
    </>
  );
}
