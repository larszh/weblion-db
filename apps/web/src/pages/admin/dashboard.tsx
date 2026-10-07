import { Link } from 'react-router-dom';
import { AlertTriangle, Building2, CircleAlert, Cloud, Server, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import type { TranslationKey } from '@/i18n/de';
import { formatRelative } from '@/lib/format';
import { useAdminActions, useAdminStats } from '@/lib/queries';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingBlock,
  Mono,
  Notice,
  PageHeader,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import { ProviderBadge } from '@/components/server-bits';
import { ActionStatus } from '@/pages/servers/tabs/overview';

function Tile({
  icon,
  label,
  value,
  sub,
  to,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  to: string;
}) {
  return (
    <Link to={to}>
      <Card className="h-full p-5 transition-colors hover:border-border-strong">
        <div className="flex items-center gap-2 text-sm text-muted [&>svg]:size-4">
          {icon}
          {label}
        </div>
        <div className="mt-2 text-3xl font-semibold text-text">{value}</div>
        {sub && <div className="mt-1 text-sm text-muted">{sub}</div>}
      </Card>
    </Link>
  );
}

export function AdminDashboard() {
  const { t, locale } = useI18n();
  const stats = useAdminStats();
  const actions = useAdminActions();

  if (stats.isPending) return <LoadingBlock rows={6} />;
  if (stats.isError) return <ErrorState error={stats.error} />;
  const s = stats.data;
  const brokenProviders = s.providers.filter((p) => p.status === 'error');

  return (
    <>
      <PageHeader
        eyebrow={t('nav.section.admin')}
        title={t('admin.title')}
        description={t('admin.subtitle')}
      />
      {brokenProviders.length > 0 && (
        <Notice
          tone="danger"
          className="mb-6"
          icon={<AlertTriangle className="size-4" />}
          title={t('admin.providerErrors')}
        >
          {brokenProviders.map((p) => p.name).join(', ')} ·{' '}
          <Link to="/admin/providers" className="font-medium underline">
            {t('admin.checkProviders')}
          </Link>
        </Notice>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          icon={<Server />}
          label={t('admin.stat.servers')}
          value={s.servers.total}
          sub={t('admin.stat.serversSub', { running: s.servers.running, stopped: s.servers.stopped })}
          to="/admin/servers"
        />
        <Tile
          icon={<CircleAlert />}
          label={t('admin.stat.unassigned')}
          value={s.servers.unassigned}
          sub={
            s.servers.missing
              ? t('admin.stat.missing', { n: s.servers.missing })
              : t('admin.stat.unassignedSub')
          }
          to="/admin/servers?assigned=no"
        />
        <Tile
          icon={<Building2 />}
          label={t('admin.stat.customers')}
          value={s.organizations.customers}
          sub={t('admin.stat.internal', { n: s.organizations.internal })}
          to="/admin/customers"
        />
        <Tile icon={<Users />} label={t('admin.stat.users')} value={s.users} to="/admin/users" />
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[400px_1fr]">
        <Card className="h-fit">
          <CardHeader
            title={t('nav.admin.providers')}
            actions={
              <Link to="/admin/providers" className="text-sm font-medium text-primary-text hover:underline">
                {t('common.showAll')}
              </Link>
            }
          />
          {s.providers.length === 0 ? (
            <EmptyState icon={<Cloud className="size-6" />} title={t('providers.empty')} />
          ) : (
            <ul className="divide-y divide-border">
              {s.providers.map((p) => (
                <li key={p.id}>
                  <Link
                    to={`/admin/providers/${p.id}`}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2"
                  >
                    <ProviderBadge type={p.type} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                    <Badge tone={p.status === 'ok' ? 'success' : p.status === 'error' ? 'danger' : 'neutral'}>
                      {t(`providers.status.${p.status}` as TranslationKey)}
                    </Badge>
                    <span className="text-xs text-subtle">{formatRelative(p.lastSyncAt, locale)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title={t('admin.recentActions')}
            description={s.failedActions24h > 0 ? t('admin.failed24h', { n: s.failedActions24h }) : undefined}
          />
          {actions.isPending ? (
            <LoadingBlock />
          ) : !actions.data?.length ? (
            <EmptyState title={t('overview.noActions')} />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>{t('activity.action')}</TH>
                  <TH>Server</TH>
                  <TH className="hidden md:table-cell">{t('activity.user')}</TH>
                  <TH>{t('activity.started')}</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              <TBody>
                {actions.data.slice(0, 15).map((a) => (
                  <tr key={a.id}>
                    <TD>
                      <Mono className="text-text">{a.type}</Mono>
                      {a.error && (
                        <div className="max-w-xs truncate text-xs text-danger" title={a.error}>
                          {a.error}
                        </div>
                      )}
                    </TD>
                    <TD className="font-medium">{a.serverName}</TD>
                    <TD className="hidden text-muted md:table-cell">{a.user?.name ?? 'System'}</TD>
                    <TD className="text-muted tabular">{formatRelative(a.startedAt, locale)}</TD>
                    <TD>
                      <ActionStatus status={a.status} />
                    </TD>
                  </tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
