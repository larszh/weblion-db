import { useDeferredValue, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, Server } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { useMe, useProjects, useServers } from '@/lib/queries';
import {
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingBlock,
  PageHeader,
  Select,
} from '@/components/ui/primitives';
import { ServerTable } from '@/components/server-table';

const STATUS_FILTERS = ['running', 'stopped', 'paused', 'missing'] as const;

export function ServersPage() {
  const t = useT();
  const { org, base } = useOrg();
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const deferredQ = useDeferredValue(q);
  const projectId = params.get('project') ?? undefined;
  const status = params.get('status') ?? undefined;
  const projects = useProjects(org.id);
  const servers = useServers(org.id, { projectId, status, q: deferredQ || undefined });

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const isStaff = me.data?.platformPermissions.includes('platform:server:assign');

  return (
    <>
      <PageHeader
        title={t('nav.servers')}
        description={t('servers.subtitle')}
        actions={
          isStaff && (
            <Link
              to="/admin/servers?assigned=no"
              className="text-sm font-medium text-primary-text hover:underline"
            >
              {t('servers.assignMore')}
            </Link>
          )
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setParam('q', e.target.value);
              }}
              placeholder={t('servers.search')}
              className="pl-9"
              aria-label={t('servers.search')}
            />
          </div>
          <Select
            value={projectId ?? ''}
            onChange={(e) => setParam('project', e.target.value)}
            className="w-auto min-w-[180px]"
            aria-label={t('servers.col.project')}
          >
            <option value="">{t('servers.allProjects')}</option>
            {projects.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select
            value={status ?? ''}
            onChange={(e) => setParam('status', e.target.value)}
            className="w-auto min-w-[150px]"
            aria-label="Status"
          >
            <option value="">{t('servers.allStatuses')}</option>
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </Select>
        </div>
        {servers.isError ? (
          <div className="p-5">
            <ErrorState error={servers.error} onRetry={() => void servers.refetch()} />
          </div>
        ) : servers.isPending ? (
          <LoadingBlock rows={5} />
        ) : servers.data.length === 0 ? (
          <EmptyState
            icon={<Server className="size-6" />}
            title={q || projectId || status ? t('servers.empty.filtered') : t('servers.empty.title')}
            description={q || projectId || status ? undefined : t('servers.empty.text')}
          />
        ) : (
          <ServerTable servers={servers.data} linkFor={(s) => `${base}/servers/${s.id}`} />
        )}
      </Card>
    </>
  );
}
