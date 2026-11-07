import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, RotateCcw, Square } from 'lucide-react';
import {
  LOCALE_META,
  type AiAvailabilityDto,
  type TranslationJobDetailDto,
  type TranslationJobDto,
  type TranslationFailureReason,
  type TranslationJobStatus,
} from '@weblion/shared';
import { useI18n, type TFunction } from '@/lib/i18n';
import { formatNumber, formatRelative } from '@/lib/format';
import {
  i18nKeys,
  useCancelTranslationJob,
  useRefreshConsoleTexts,
  useTranslationJob,
  useTranslationJobs,
} from '@/lib/api/i18n';
import { Flag } from '@/components/server-bits';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingBlock,
  Notice,
  UsageBar,
} from '@/components/ui/primitives';
import { TranslateDialog } from './translations-dialogs';
import { failuresHref } from './translations-query';
import { formatUsd } from './translations-table';

/**
 * The jobs tab (i18n 17.1, 12.1 steps 6 and 7): the job list, and the detail with progress, cost against the
 * estimate, the error, the failed texts, cancel and "retry failed". Running jobs are polled every 2 s.
 */

const STATUS_TONE: Record<TranslationJobStatus, 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = {
  queued: 'neutral',
  running: 'info',
  completed: 'success',
  failed: 'danger',
  cancelled: 'warning',
};

const active = (job: Pick<TranslationJobDto, 'status'>) =>
  job.status === 'queued' || job.status === 'running';

/**
 * The detail of a failed item in the language of the console. The API stores a short English detail (i18n 12.1,
 * it also goes into the repair prompt), so only its language-neutral parts are shown: the placeholder names with
 * the chips' texts, a new URL, address or number, the glossary terms, the informal word or the character.
 * Line break counts, lengths and French typography notes add nothing to the translated reason and are left out.
 */
export function failureDetailText(
  t: TFunction,
  failure: { reason: TranslationFailureReason; detail: string | null },
): string | null {
  const detail = failure.detail;
  if (!detail) return null;
  switch (failure.reason) {
    case 'placeholders': {
      const parts = [...detail.matchAll(/\b(missing|extra) (\{[^}]+\})/g)].map(([, kind, name]) =>
        t(kind === 'missing' ? 'admin.i18n.cell.placeholderMissing' : 'admin.i18n.cell.placeholderExtra', {
          name: name!,
        }),
      );
      return parts.length > 0 ? parts.join(', ') : null;
    }
    case 'content':
      return /^new (?:URL|e-mail address|number) (.+)$/.exec(detail)?.[1] ?? null;
    case 'glossary':
      return /^glossary term (.+)$/.exec(detail)?.[1] ?? null;
    case 'formality':
      return /^informal word "(.+)"$/.exec(detail)?.[1] ?? null;
    case 'characters':
      return /^forbidden character (.+)$/.exec(detail)?.[1] ?? null;
    default:
      return null;
  }
}

/** The text of a job error code (plan 2.6); the budget stop has its own key. */
export function jobErrorText(t: TFunction, error: { code: string; message: string }): string {
  switch (error.code) {
    case 'ai_budget_job':
      return t('admin.i18n.job.budgetJob');
    case 'cost_cap':
      return t('admin.i18n.job.error.cost_cap');
    case 'ai_not_configured':
      return t('admin.i18n.job.error.ai_not_configured');
    case 'ai_upstream':
      return t('admin.i18n.job.error.ai_upstream');
    case 'ai_failed':
      return t('admin.i18n.job.error.ai_failed');
    default:
      return error.message;
  }
}

export function JobStatusBadge({ job }: { job: Pick<TranslationJobDto, 'status' | 'cancelRequested'> }) {
  const { t } = useI18n();
  if (job.cancelRequested && active(job))
    return <Badge tone="warning">{t('admin.i18n.job.cancelRequested')}</Badge>;
  return <Badge tone={STATUS_TONE[job.status]}>{t(`admin.i18n.job.status.${job.status}`)}</Badge>;
}

/** Progress, counts and cost of a job; also the active job on the overview. */
export function JobProgress({ job }: { job: TranslationJobDto }) {
  const { t, locale } = useI18n();
  const handled = job.done + job.failed + job.skipped;
  return (
    <div className="space-y-1.5 text-sm">
      <UsageBar value={job.total > 0 ? (handled / job.total) * 100 : 0} tone="primary" />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted">
        <span>{t('admin.i18n.job.progress', { done: job.done, total: job.total })}</span>
        {job.failed > 0 && (
          <span className="text-danger">{t('admin.i18n.job.failedCount', { count: job.failed })}</span>
        )}
        {job.skipped > 0 && <span>{t('admin.i18n.job.skippedCount', { count: job.skipped })}</span>}
        <span>
          {t('admin.i18n.job.cost', {
            cost: formatUsd(job.costMicros, locale),
            estimate: formatUsd(job.estimateMicros, locale),
          })}
        </span>
      </div>
    </div>
  );
}

function JobLocales({ job }: { job: TranslationJobDto }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {job.scope.locales.map((l) => (
        <span key={l} className="inline-flex items-center gap-1 text-sm text-text">
          <Flag country={LOCALE_META[l].flag} decorative />
          {LOCALE_META[l].native}
        </span>
      ))}
    </span>
  );
}

export function JobsTab({
  jobId,
  onOpenJob,
  canWrite,
  canAi,
  ai,
}: {
  jobId?: string;
  onOpenJob: (id: string | undefined) => void;
  canWrite: boolean;
  canAi: boolean;
  ai: AiAvailabilityDto | undefined;
}) {
  if (jobId) {
    return (
      <JobDetail
        id={jobId}
        onBack={() => onOpenJob(undefined)}
        onOpenJob={onOpenJob}
        canWrite={canWrite}
        canAi={canAi}
        ai={ai}
      />
    );
  }
  return <JobList onOpenJob={onOpenJob} />;
}

function JobList({ onOpenJob }: { onOpenJob: (id: string) => void }) {
  const { t, locale } = useI18n();
  const [page, setPage] = useState(1);
  const jobs = useTranslationJobs(page);
  if (jobs.isLoading) return <LoadingBlock />;
  if (jobs.isError) return <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} />;
  const data = jobs.data!;
  if (data.items.length === 0) {
    return (
      <Card>
        <EmptyState title={t('admin.i18n.job.empty')} />
      </Card>
    );
  }
  const totalPages = Math.max(1, Math.ceil(data.total / data.perPage));
  return (
    <Card>
      <ul className="divide-y divide-border">
        {data.items.map((job) => (
          <li key={job.id}>
            <button
              type="button"
              onClick={() => onOpenJob(job.id)}
              className="block w-full space-y-2 px-5 py-4 text-left hover:bg-surface-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <JobStatusBadge job={job} />
                {job.demo && <Badge tone="info">{t('ai.demoBadge')}</Badge>}
                <JobLocales job={job} />
              </div>
              <JobProgress job={job} />
              <p className="text-xs text-muted">
                {job.createdBy
                  ? t('admin.i18n.job.startedBy', {
                      name: job.createdBy.name,
                      when: formatRelative(job.createdAt, locale),
                    })
                  : formatRelative(job.createdAt, locale)}
                {job.retryOf ? ` · ${t('admin.i18n.job.retryOf')}` : ''}
              </p>
            </button>
          </li>
        ))}
      </ul>
      {data.total > data.perPage && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm">
          <span className="text-muted">{t('common.pageOf', { page, total: totalPages })}</span>
          <div className="flex gap-2">
            <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              {t('common.prev')}
            </Button>
            <Button size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
              {t('common.next')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function JobDetail({
  id,
  onBack,
  onOpenJob,
  canWrite,
  canAi,
  ai,
}: {
  id: string;
  onBack: () => void;
  onOpenJob: (id: string) => void;
  canWrite: boolean;
  canAi: boolean;
  ai: AiAvailabilityDto | undefined;
}) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const job = useTranslationJob(id);
  const cancel = useCancelTranslationJob();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [retryOpen, setRetryOpen] = useState(false);
  const wasActive = useRef<boolean | null>(null);

  const refreshTexts = useRefreshConsoleTexts();

  // When the job ends, the texts, the overview and the console's own texts have new values.
  const isActive = job.data ? active(job.data) : null;
  useEffect(() => {
    if (isActive === false && wasActive.current === true) {
      void qc.invalidateQueries({ queryKey: i18nKeys.all });
      void refreshTexts();
    }
    if (isActive !== null) wasActive.current = isActive;
  }, [isActive, qc, refreshTexts]);

  const back = (
    <Button size="sm" variant="ghost" icon={<ArrowLeft className="size-4" aria-hidden />} onClick={onBack}>
      {t('admin.i18n.tab.jobs')}
    </Button>
  );
  if (job.isLoading) return <LoadingBlock />;
  if (job.isError) {
    return (
      <div className="space-y-3">
        {back}
        <ErrorState error={job.error} onRetry={() => void job.refetch()} />
      </div>
    );
  }
  const data: TranslationJobDetailDto = job.data!;
  const finished = !active(data);

  return (
    <div className="space-y-4">
      {back}
      <Card>
        <CardHeader
          title={
            <span className="inline-flex flex-wrap items-center gap-2">
              <JobStatusBadge job={data} />
              {data.demo && <Badge tone="info">{t('ai.demoBadge')}</Badge>}
              <JobLocales job={data} />
            </span>
          }
          description={
            data.createdBy
              ? t('admin.i18n.job.startedBy', {
                  name: data.createdBy.name,
                  when: formatRelative(data.createdAt, locale),
                })
              : undefined
          }
          actions={
            <>
              {canWrite && !finished && !data.cancelRequested && (
                <Button
                  size="sm"
                  variant="danger-soft"
                  icon={<Square className="size-4" aria-hidden />}
                  onClick={() => setCancelOpen(true)}
                >
                  {t('admin.i18n.job.cancel')}
                </Button>
              )}
              {canWrite && canAi && finished && data.failures.length > 0 && (
                <Button
                  size="sm"
                  icon={<RotateCcw className="size-4" aria-hidden />}
                  onClick={() => setRetryOpen(true)}
                >
                  {t('admin.i18n.job.retry')}
                </Button>
              )}
            </>
          }
        />
        <CardBody className="space-y-3">
          {data.error && <Notice tone="danger">{jobErrorText(t, data.error)}</Notice>}
          {data.retryOf && <p className="text-sm text-muted">{t('admin.i18n.job.retryOf')}</p>}
          <JobProgress job={data} />
          <p className="text-xs text-muted">
            {t('admin.i18n.job.tokens', {
              input: formatNumber(data.inputTokens, locale),
              output: formatNumber(data.outputTokens, locale),
            })}
          </p>
        </CardBody>
      </Card>

      {data.failures.length > 0 && (
        <Card>
          <CardHeader
            title={t('admin.i18n.job.failures')}
            actions={
              <Link
                to={failuresHref(data.failures)}
                className="inline-flex min-h-11 items-center text-sm font-medium text-primary-text underline underline-offset-2 sm:min-h-0"
              >
                {t('admin.i18n.job.showInEntries')}
              </Link>
            }
          />
          <ul className="divide-y divide-border">
            {data.failures.map((f, i) => {
              const detail = failureDetailText(t, f);
              return (
                <li
                  key={`${f.locale}:${f.key}:${i}`}
                  className="grid gap-1 px-5 py-2.5 text-sm sm:grid-cols-[minmax(0,2fr)_auto_minmax(0,2fr)] sm:gap-3"
                >
                  <span className="font-mono text-[12.5px] break-all text-text">{f.key}</span>
                  <span className="inline-flex items-center gap-1 text-muted">
                    <Flag country={LOCALE_META[f.locale].flag} decorative />
                    {LOCALE_META[f.locale].native}
                  </span>
                  <span className="min-w-0 break-words text-muted">
                    {t(`admin.i18n.job.reason.${f.reason}`)}
                    {detail ? ` (${detail})` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={t('admin.i18n.job.cancelTitle')}
        description={t('admin.i18n.job.cancelText')}
        confirmLabel={t('admin.i18n.job.cancel')}
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate(data.id, { onSuccess: () => setCancelOpen(false) })}
      />
      {retryOpen && ai && (
        <TranslateDialog
          open
          onOpenChange={setRetryOpen}
          ai={ai}
          retry={data}
          onStarted={(next) => onOpenJob(next.id)}
        />
      )}
    </div>
  );
}
