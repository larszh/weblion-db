import { useState } from 'react';
import { ChevronDown, ChevronRight, KeyRound, Search, ShieldAlert, User, Workflow } from 'lucide-react';
import type { AuditEntryDto } from '@weblion/shared';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { formatDate, formatRelative } from '@/lib/format';
import { useAudit, type AuditParams } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingBlock,
  Mono,
  PageHeader,
  Select,
} from '@/components/ui/primitives';

function ActorIcon({ type }: { type: AuditEntryDto['actor']['type'] }) {
  const Icon = type === 'token' ? KeyRound : type === 'system' ? Workflow : User;
  return <Icon className="size-4 text-muted" />;
}

export function ActivityList({
  items,
  compact,
  showOrg,
}: {
  items: AuditEntryDto[];
  compact?: boolean;
  showOrg?: boolean;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="divide-y divide-border">
      {items.map((item) => {
        const expanded = open === item.id;
        const hasDetails = !!item.details && Object.keys(item.details).length > 0;
        return (
          <li key={item.id}>
            <button
              className={cn(
                'flex w-full items-start gap-3 px-5 py-3 text-left',
                hasDetails && !compact && 'hover:bg-surface-2',
              )}
              onClick={() => hasDetails && !compact && setOpen(expanded ? null : item.id)}
              disabled={!hasDetails || compact}
            >
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-3">
                {item.status === 'success' ? (
                  <ActorIcon type={item.actor.type} />
                ) : (
                  <ShieldAlert className="size-4 text-danger" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Mono className="text-text">{item.action}</Mono>
                  {item.status !== 'success' && (
                    <Badge tone="danger">{t(`audit.status.${item.status}`)}</Badge>
                  )}
                  {showOrg && item.org && <Badge tone="neutral">{item.org.name}</Badge>}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted">
                  {item.actor.name ?? 'System'}
                  {!compact && item.ip && ` · ${item.ip}`}
                  {!compact && item.resourceType && ` · ${item.resourceType}`}
                </span>
              </span>
              <span
                className="shrink-0 text-xs text-subtle tabular"
                title={formatDate(item.createdAt, locale)}
              >
                {formatRelative(item.createdAt, locale)}
              </span>
              {hasDetails &&
                !compact &&
                (expanded ? (
                  <ChevronDown className="mt-0.5 size-4 text-subtle" />
                ) : (
                  <ChevronRight className="mt-0.5 size-4 text-subtle" />
                ))}
            </button>
            {expanded && (
              <pre className="mx-5 mb-3 max-h-64 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-xs text-text">
                {JSON.stringify(item.details, null, 2)}
              </pre>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function AuditView({ path, showOrg }: { path: string; showOrg?: boolean }) {
  const { t } = useI18n();
  const [params, setParams] = useState<AuditParams>({ page: 1 });
  const [q, setQ] = useState('');
  const audit = useAudit(path, params);
  const totalPages = audit.data ? Math.max(1, Math.ceil(audit.data.total / audit.data.perPage)) : 1;

  return (
    <Card>
      <form
        className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          setParams({ ...params, page: 1, q: q || undefined });
        }}
      >
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('audit.search')}
            className="pl-9"
          />
        </div>
        <Input
          placeholder={t('audit.actionPrefix')}
          className="w-48 font-mono"
          onChange={(e) => setParams({ ...params, page: 1, action: e.target.value || undefined })}
        />
        <Select
          className="w-auto"
          value={params.status ?? ''}
          onChange={(e) => setParams({ ...params, page: 1, status: e.target.value || undefined })}
        >
          <option value="">{t('audit.allStatuses')}</option>
          <option value="success">{t('audit.status.success')}</option>
          <option value="failure">{t('audit.status.failure')}</option>
          <option value="denied">{t('audit.status.denied')}</option>
        </Select>
      </form>
      {audit.isError ? (
        <div className="p-5">
          <ErrorState error={audit.error} />
        </div>
      ) : audit.isPending ? (
        <LoadingBlock rows={6} />
      ) : audit.data.items.length === 0 ? (
        <EmptyState title={t('audit.empty')} />
      ) : (
        <div className={cn(audit.isFetching && 'opacity-60')}>
          <ActivityList items={audit.data.items} showOrg={showOrg} />
        </div>
      )}
      {audit.data && audit.data.total > 0 && (
        <div className="flex items-center justify-between border-t border-border px-5 py-3 text-sm">
          <span className="text-muted">
            {t('audit.count', { n: audit.data.total })} ·{' '}
            {t('common.pageOf', { page: params.page, total: totalPages })}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={params.page <= 1}
              onClick={() => setParams({ ...params, page: params.page - 1 })}
            >
              {t('common.prev')}
            </Button>
            <Button
              size="sm"
              disabled={params.page >= totalPages}
              onClick={() => setParams({ ...params, page: params.page + 1 })}
            >
              {t('common.next')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export function OrgAuditPage() {
  const { t } = useI18n();
  const { org } = useOrg();
  return (
    <>
      <PageHeader title={t('nav.audit')} description={t('audit.subtitle')} />
      <AuditView path={`/orgs/${org.id}/audit`} />
    </>
  );
}
