import { useState } from 'react';
import { History } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { formatDate, formatRelative } from '@/lib/format';
import { useServerActivity, useServerTasks } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, EmptyState, ErrorState, LoadingBlock, Mono } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import { ActivityList } from '@/pages/org/audit';
import { useServerContext } from '../context';
import { ActionStatus } from './overview';

export function ActivityTab() {
  const { t, locale } = useI18n();
  const { server } = useServerContext();
  const tasks = useServerTasks(server.id);
  const [page, setPage] = useState(1);
  const activity = useServerActivity(server.id, page);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={t('activity.actions')} description={t('activity.actionsText')} />
        {tasks.isPending ? (
          <LoadingBlock />
        ) : tasks.isError ? (
          <div className="p-5">
            <ErrorState error={tasks.error} />
          </div>
        ) : tasks.data.actions.length === 0 ? (
          <EmptyState icon={<History className="size-6" />} title={t('overview.noActions')} />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>{t('activity.action')}</TH>
                <TH>{t('activity.user')}</TH>
                <TH>{t('activity.started')}</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <TBody>
              {tasks.data.actions.map((a) => (
                <tr key={a.id}>
                  <TD>
                    <Mono className="text-text">{a.type}</Mono>
                    {a.error && <div className="mt-0.5 max-w-md text-xs text-danger">{a.error}</div>}
                  </TD>
                  <TD className="text-muted">{a.user?.name ?? 'System'}</TD>
                  <TD className="tabular" title={formatDate(a.startedAt, locale)}>
                    {formatRelative(a.startedAt, locale)}
                  </TD>
                  <TD>
                    <ActionStatus status={a.status} />
                  </TD>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {tasks.data && tasks.data.providerTasks.length > 0 && (
        <Card>
          <CardHeader
            title={t('activity.providerTasks')}
            description={t('activity.providerTasksText', { provider: server.provider.name })}
          />
          <Table>
            <THead>
              <tr>
                <TH>{t('activity.type')}</TH>
                <TH>{t('activity.user')}</TH>
                <TH>{t('activity.started')}</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <TBody>
              {tasks.data.providerTasks.slice(0, 25).map((task) => (
                <tr key={task.id}>
                  <TD>
                    <Mono className="text-text">{task.type}</Mono>
                    {task.message && (
                      <div className="mt-0.5 max-w-md text-xs text-danger">{task.message}</div>
                    )}
                  </TD>
                  <TD className="text-muted">{task.user ?? '–'}</TD>
                  <TD className="tabular">{formatDate(task.startedAt, locale)}</TD>
                  <TD>
                    <ActionStatus status={task.status} />
                  </TD>
                </tr>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      <Card>
        <CardHeader title={t('activity.audit')} />
        {activity.isPending ? (
          <LoadingBlock />
        ) : activity.data && activity.data.items.length > 0 ? (
          <>
            <ActivityList items={activity.data.items} />
            {activity.data.total > activity.data.perPage && (
              <div className="flex items-center justify-between border-t border-border px-5 py-3 text-sm">
                <span className="text-muted">
                  {t('common.pageOf', {
                    page,
                    total: Math.ceil(activity.data.total / activity.data.perPage),
                  })}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    {t('common.prev')}
                  </Button>
                  <Button
                    size="sm"
                    disabled={page * activity.data.perPage >= activity.data.total}
                    onClick={() => setPage(page + 1)}
                  >
                    {t('common.next')}
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : (
          <EmptyState title={t('dashboard.activity.empty')} />
        )}
      </Card>
    </div>
  );
}
