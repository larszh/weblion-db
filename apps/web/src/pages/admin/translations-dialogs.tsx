import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import {
  LOCALE_META,
  TARGET_LOCALES,
  type AiAvailabilityDto,
  type TargetLocale,
  type TranslationEstimateDto,
  type TranslationJobDto,
  type TranslationJobScope,
  type TranslationJobSelection,
} from '@weblion/shared';
import { ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useEstimateTranslation, useStartTranslationJob } from '@/lib/api/i18n';
import { Flag } from '@/components/server-bits';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, ErrorState, Notice } from '@/components/ui/primitives';
import { formatUsd } from './translations-table';

/**
 * "Mit KI übersetzen" (i18n 12.1, 17.1): languages, which texts, the replace flag, the estimate with the
 * remaining budget, and the start with the confirmed cost. Also the retry of a job's failed texts (B7).
 */

const SELECTIONS: TranslationJobSelection[] = ['untranslated', 'stale', 'both', 'all'];

/** "Claude Opus 5.5" for claude-opus-5-5. */
export function modelLabel(model: string): string {
  const match = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(model);
  if (!match) return model;
  return `Claude ${match[1]!.charAt(0).toUpperCase()}${match[1]!.slice(1)} ${match[2]}.${match[3]}`;
}

export interface TranslateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ai: AiAvailabilityDto;
  /** The narrowing of the current selection (the filters of the entries tab). */
  narrowing?: Pick<TranslationJobScope, 'area' | 'section' | 'q' | 'keys'>;
  /** Number of texts in the current selection, for "Alle Texte der aktuellen Auswahl". */
  selectionCount?: number;
  /** B7: a new job over the failed texts of this job. */
  retry?: TranslationJobDto | null;
  onStarted: (job: TranslationJobDto) => void;
}

export function TranslateDialog({
  open,
  onOpenChange,
  ai,
  narrowing = {},
  selectionCount,
  retry = null,
  onStarted,
}: TranslateDialogProps) {
  const { t, locale } = useI18n();
  const [locales, setLocales] = useState<TargetLocale[]>(() =>
    retry ? [...retry.scope.locales] : ['fr', 'it', 'nl'],
  );
  const [selection, setSelection] = useState<TranslationJobSelection>('both');
  const [replaceManual, setReplaceManual] = useState(false);
  const [estimate, setEstimate] = useState<TranslationEstimateDto | null>(null);
  const [costChanged, setCostChanged] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const estimating = useEstimateTranslation();
  const start = useStartTranslationJob();

  const scope: TranslationJobScope = retry
    ? { locales, selection: 'all', replaceManual, retryOf: retry.id }
    : { locales, selection, replaceManual, ...narrowing };

  const changed = () => {
    setEstimate(null);
    setCostChanged(null);
    setError(null);
  };
  const toggle = (l: TargetLocale) => {
    setLocales((prev) => (prev.includes(l) ? prev.filter((x) => x !== l) : [...prev, l]));
    changed();
  };
  const runEstimate = () =>
    estimating.mutate(scope, {
      onSuccess: (dto) => {
        setEstimate(dto);
        setError(null);
      },
    });

  const startJob = () => {
    if (!estimate) return;
    start.mutate(
      { scope, confirmCostMicros: estimate.costMicros },
      {
        onSuccess: (job) => {
          toast.success(t('admin.i18n.ai.started'));
          onStarted(job);
          onOpenChange(false);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === 'estimate_changed') {
            // The texts grew since the estimate: show the new cost and ask again (plan decision 10).
            const cost = (err.details as { costMicros?: number } | undefined)?.costMicros ?? null;
            setCostChanged(cost);
            runEstimate();
            return;
          }
          setError(err);
        },
      },
    );
  };

  const remaining = estimate?.budgetRemainingMicros ?? null;
  const short = estimate !== null && remaining !== null && estimate.costMicros > remaining;
  const unavailable = !ai.available;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          <Sparkles className="size-4 text-primary-text" aria-hidden />
          {retry ? t('admin.i18n.job.retry') : t('admin.i18n.ai.button')}
          {ai.demo && <Badge tone="info">{t('ai.demoBadge')}</Badge>}
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          {!unavailable && (
            <>
              <Button disabled={locales.length === 0} loading={estimating.isPending} onClick={runEstimate}>
                {t('admin.i18n.ai.estimate')}
              </Button>
              <Button
                variant="primary"
                disabled={!estimate || estimate.keys === 0 || estimating.isPending}
                loading={start.isPending}
                onClick={startJob}
              >
                {t('admin.i18n.ai.start')}
              </Button>
            </>
          )}
        </>
      }
    >
      {unavailable ? (
        <Notice tone="warning">
          <p>
            {ai.reason === 'feature_off' ? t('admin.i18n.ai.featureOff') : t('admin.i18n.ai.notConfigured')}
          </p>
          <Link to="/admin/ai" className="mt-1 inline-block font-medium underline underline-offset-2">
            {t('admin.i18n.ai.setup')}
          </Link>
        </Notice>
      ) : (
        <div className="space-y-4">
          {ai.demo && <Notice tone="info">{t('admin.i18n.ai.demoNote')}</Notice>}
          <fieldset className="space-y-1.5">
            <legend className="text-[13px] font-medium text-text">{t('admin.i18n.ai.locales')}</legend>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {TARGET_LOCALES.map((l) => (
                <label key={l} className="inline-flex min-h-11 items-center gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand-blue"
                    checked={locales.includes(l)}
                    onChange={() => toggle(l)}
                  />
                  <Flag country={LOCALE_META[l].flag} decorative />
                  {LOCALE_META[l].native}
                </label>
              ))}
            </div>
          </fieldset>
          {!retry && (
            <fieldset className="space-y-1.5">
              <legend className="text-[13px] font-medium text-text">{t('admin.i18n.ai.selection')}</legend>
              {SELECTIONS.map((s) => (
                <label key={s} className="flex min-h-11 items-center gap-2 text-sm text-text">
                  <input
                    type="radio"
                    name="translate-selection"
                    className="size-4 accent-brand-blue"
                    checked={selection === s}
                    onChange={() => {
                      setSelection(s);
                      changed();
                    }}
                  />
                  {s === 'all'
                    ? t('admin.i18n.ai.selection.all', { count: selectionCount ?? 0 })
                    : t(`admin.i18n.ai.selection.${s}`)}
                </label>
              ))}
            </fieldset>
          )}
          <label className="flex min-h-11 items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              className="size-4 accent-brand-blue"
              checked={replaceManual}
              onChange={(e) => {
                setReplaceManual(e.target.checked);
                changed();
              }}
            />
            {t('admin.i18n.ai.replaceManual')}
          </label>

          {costChanged !== null && (
            <Notice tone="warning">
              {t('admin.i18n.ai.costChanged', { cost: formatUsd(costChanged, locale) })}
            </Notice>
          )}
          {estimate && <EstimateSummary estimate={estimate} short={short} />}
          {error !== null && <ErrorState error={error} />}
          <p className="text-xs text-muted">{t('admin.i18n.ai.reviewNote')}</p>
          <p className="text-xs text-muted">{t('admin.i18n.ai.costCapNote')}</p>
        </div>
      )}
    </Dialog>
  );
}

/** The estimate of B2 as the dialog shows it (i18n 12.1 step 4). */
export function EstimateSummary({ estimate, short }: { estimate: TranslationEstimateDto; short: boolean }) {
  const { t, locale } = useI18n();
  const remaining = estimate.budgetRemainingMicros;
  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm text-text">
      <p className="font-medium">
        {t('admin.i18n.ai.estimateResult', {
          keys: estimate.keys,
          batches: estimate.batches,
          cost: formatUsd(estimate.costMicros, locale),
        })}
      </p>
      <p className="text-muted">{t('admin.i18n.ai.estimateModel', { model: modelLabel(estimate.model) })}</p>
      {estimate.keptManual > 0 && <p>{t('admin.i18n.ai.estimateKept', { count: estimate.keptManual })}</p>}
      {estimate.legal > 0 && <p>{t('admin.i18n.ai.estimateLegal', { count: estimate.legal })}</p>}
      {remaining !== null && (
        <p className="text-muted">
          {t('admin.i18n.ai.budgetRemaining', { remaining: formatUsd(remaining, locale) })}
        </p>
      )}
      {short && remaining !== null && (
        <Notice tone="warning">
          {t('admin.i18n.ai.budgetWarning', { remaining: formatUsd(remaining, locale) })}
        </Notice>
      )}
    </div>
  );
}
