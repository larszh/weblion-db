import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CirclePause, CirclePlay, FolderKanban, Plus, Server, Users } from 'lucide-react';
import type { ServerDto } from '@weblion/shared';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { useAudit, useProjects, useServers } from '@/lib/queries';
import { formatRelative } from '@/lib/format';
import {
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  Skeleton,
} from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Flag, StatusDot } from '@/components/server-bits';
import { ProjectDialog } from './projects';
import { ActivityList } from './audit';

function StatTile({
  icon,
  label,
  value,
  tone,
  to,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  tone: string;
  to?: string;
}) {
  const content = (
    <Card className="flex items-center gap-4 px-5 py-4 transition-colors hover:border-border-strong">
      <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${tone} [&>svg]:size-5`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-semibold text-text tabular">{value}</div>
        <div className="truncate text-sm text-muted">{label}</div>
      </div>
    </Card>
  );
  return to ? <Link to={to}>{content}</Link> : content;
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

export function OrgDashboard() {
  const { t, locale } = useI18n();
  const { org, base, can } = useOrg();
  const projects = useProjects(org.id);
  const servers = useServers(org.id);
  const audit = useAudit(`/orgs/${org.id}/audit`, { page: 1, perPage: 8 }, can('audit:read'));
  const [creating, setCreating] = useState(false);

  const list = servers.data ?? [];
  const running = list.filter((s) => s.status === 'running').length;
  const stopped = list.filter((s) => s.status === 'stopped').length;

  return (
    <>
      <PageHeader
        eyebrow={t('dashboard.eyebrow')}
        title={org.name}
        description={t('dashboard.subtitle')}
        actions={
          can('project:create') && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              {t('projects.new')}
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {servers.isPending ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[76px] rounded-xl" />)
        ) : (
          <>
            <StatTile
              icon={<Server />}
              label={t('dashboard.stat.servers')}
              value={list.length}
              tone="bg-primary-soft text-primary-text"
              to={`${base}/servers`}
            />
            <StatTile
              icon={<CirclePlay />}
              label={t('dashboard.stat.running')}
              value={running}
              tone="bg-success-soft text-success"
              to={`${base}/servers`}
            />
            <StatTile
              icon={<CirclePause />}
              label={t('dashboard.stat.stopped')}
              value={stopped}
              tone="bg-surface-3 text-muted"
              to={`${base}/servers`}
            />
            <StatTile
              icon={can('member:read') ? <Users /> : <FolderKanban />}
              label={can('member:read') ? t('dashboard.stat.members') : t('dashboard.stat.projects')}
              value={can('member:read') ? (org.counts?.members ?? '–') : (projects.data?.length ?? '–')}
              tone="bg-info-soft text-[#0a8d90] dark:text-brand-teal"
              to={can('member:read') ? `${base}/members` : `${base}/projects`}
            />
          </>
        )}
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-6">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-text">{t('nav.projects')}</h2>
              <Link
                to={`${base}/projects`}
                className="inline-flex items-center gap-1 text-sm font-medium text-primary-text hover:underline"
              >
                {t('common.showAll')} <ArrowRight className="size-3.5" />
              </Link>
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
                      <p className="mt-0.5 line-clamp-1 text-sm text-muted">{p.description || ' '}</p>
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
        </div>

        <Card className="h-fit">
          <CardHeader
            title={t('dashboard.activity')}
            actions={
              can('audit:read') && (
                <Link to={`${base}/audit`} className="text-sm font-medium text-primary-text hover:underline">
                  {t('common.showAll')}
                </Link>
              )
            }
          />
          {!can('audit:read') ? (
            <EmptyState title={t('dashboard.activity.noAccess')} className="py-10" />
          ) : audit.isPending ? (
            <LoadingBlock rows={4} />
          ) : audit.data && audit.data.items.length > 0 ? (
            <ActivityList items={audit.data.items} compact />
          ) : (
            <EmptyState title={t('dashboard.activity.empty')} className="py-10" />
          )}
          {audit.data && audit.data.items[0] && (
            <div className="border-t border-border px-5 py-2.5 text-xs text-subtle">
              {t('dashboard.activity.last', { when: formatRelative(audit.data.items[0].createdAt, locale) })}
            </div>
          )}
        </Card>
      </div>

      <ProjectDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
