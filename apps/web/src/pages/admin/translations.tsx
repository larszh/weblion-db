import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, FileJson, Languages, ListChecks, RotateCcw, Sparkles, Upload } from 'lucide-react';
import {
  LOCALE_META,
  LOCALES,
  TARGET_LOCALES,
  type Locale,
  type TargetLocale,
  type TranslationFilter,
  type TranslationImportResultDto,
  type TranslationJobDto,
  type TranslationJobScope,
  type TranslationSummaryDto,
} from '@weblion/shared';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/queries';
import {
  exportUrl,
  useCleanupTranslations,
  useImportTranslations,
  useRefreshConsoleTexts,
  useTranslationEntries,
  useTranslationSummary,
} from '@/lib/api/i18n';
import { Flag } from '@/components/server-bits';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Input,
  LoadingBlock,
  Notice,
  PageHeader,
  Select,
  UsageBar,
} from '@/components/ui/primitives';
import { TabBar, type TabDef } from '@/pages/reseller/bits';
import { toast } from 'sonner';
import { TranslateDialog } from './translations-dialogs';
import { GlossaryTab } from './translations-glossary';
import { JobProgress, JobStatusBadge, JobsTab } from './translations-jobs';
import {
  entriesQueryOf,
  nextQuery,
  parseKeys,
  parseTranslationsQuery,
  translationsQueryString,
  TRANSLATION_FILTERS,
  type TranslationsQuery,
  type TranslationsTab,
} from './translations-query';
import { TranslationsTable } from './translations-table';

/**
 * Verwaltung > Übersetzungen (i18n 17): overview per language, every text with its five cells and the inline
 * editor, the glossary and style notes, the Mass Translate jobs, import and export. The URL holds the view
 * (translations-query.ts). Write controls need platform:i18n:write, the AI buttons platform:ai:use as well.
 */
export function TranslationsPage() {
  const { t } = useI18n();
  const me = useMe();
  const perms = me.data?.platformPermissions ?? [];
  const canWrite = perms.includes('platform:i18n:write');
  const canAi = canWrite && perms.includes('platform:ai:use');
  const [params, setParams] = useSearchParams();
  const query = parseTranslationsQuery(params);
  const setQuery = (patch: Partial<TranslationsQuery>) =>
    setParams(new URLSearchParams(translationsQueryString(nextQuery(query, patch))), { replace: true });
  const summary = useTranslationSummary();
  const ai = summary.data?.ai;
  const refreshTexts = useRefreshConsoleTexts();
  // A job that ended while the overview polled: the console's own texts change too.
  const activeJob = summary.data ? (summary.data.activeJob?.id ?? null) : undefined;
  const lastJob = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (activeJob === undefined) return;
    if (lastJob.current && activeJob === null) void refreshTexts();
    lastJob.current = activeJob;
  }, [activeJob, refreshTexts]);
  const canSuggest = canAi && !!ai?.available;
  const [translate, setTranslate] = useState<{
    narrowing: Pick<TranslationJobScope, 'area' | 'section' | 'q' | 'keys'>;
    count: number;
  } | null>(null);

  const tabs: TabDef<TranslationsTab>[] = [
    { value: 'overview', label: t('admin.i18n.tab.overview'), icon: <Languages /> },
    { value: 'entries', label: t('admin.i18n.tab.entries'), icon: <ListChecks /> },
    { value: 'glossary', label: t('admin.i18n.tab.glossary'), icon: <FileJson /> },
    { value: 'jobs', label: t('admin.i18n.tab.jobs'), icon: <Sparkles /> },
    { value: 'transfer', label: t('admin.i18n.tab.transfer'), icon: <Download /> },
  ];
  const openTranslate = (
    narrowing: Pick<TranslationJobScope, 'area' | 'section' | 'q' | 'keys'>,
    count: number,
  ) => setTranslate({ narrowing, count });
  const started = (job: TranslationJobDto) => setQuery({ tab: 'jobs', job: job.id });

  return (
    <div className="min-w-0">
      <PageHeader
        title={t('nav.admin.translations')}
        description={t('admin.i18n.description')}
        actions={
          canAi && query.tab === 'overview' ? (
            <Button
              variant="primary"
              icon={<Sparkles className="size-4" aria-hidden />}
              onClick={() => openTranslate({}, summary.data?.keys ?? 0)}
            >
              {t('admin.i18n.ai.button')}
            </Button>
          ) : undefined
        }
      />
      <TabBar
        tabs={tabs}
        current={query.tab}
        onChange={(tab) => setQuery({ tab, job: undefined })}
        label={t('nav.admin.translations')}
      />

      {query.tab === 'overview' && <OverviewTab summary={summary} canWrite={canWrite} setQuery={setQuery} />}
      {query.tab === 'entries' && (
        <EntriesTab
          query={query}
          setQuery={setQuery}
          summary={summary.data}
          canWrite={canWrite}
          canSuggest={canSuggest}
          onTranslate={canAi ? openTranslate : undefined}
        />
      )}
      {query.tab === 'glossary' && <GlossaryTab canWrite={canWrite} />}
      {query.tab === 'jobs' && (
        <JobsTab
          jobId={query.job}
          onOpenJob={(id) => setQuery({ tab: 'jobs', job: id })}
          canWrite={canWrite}
          canAi={canAi}
          ai={ai}
        />
      )}
      {query.tab === 'transfer' && <TransferTab canWrite={canWrite} />}

      {translate && ai && (
        <TranslateDialog
          open
          onOpenChange={(open) => !open && setTranslate(null)}
          ai={ai}
          narrowing={translate.narrowing}
          selectionCount={translate.count}
          onStarted={started}
        />
      )}
    </div>
  );
}

// --- Overview -----------------------------------------------------------------------------------

function OverviewTab({
  summary,
  canWrite,
  setQuery,
}: {
  summary: ReturnType<typeof useTranslationSummary>;
  canWrite: boolean;
  setQuery: (patch: Partial<TranslationsQuery>) => void;
}) {
  const { t } = useI18n();
  const cleanup = useCleanupTranslations((r) =>
    t('admin.i18n.cleanup.done', { count: r.orphans + r.sameAsCompiled + r.demo }),
  );
  if (summary.isLoading) return <LoadingBlock rows={4} />;
  if (summary.isError) return <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />;
  const data = summary.data!;
  const show = (locale: Locale, filter: TranslationFilter) =>
    setQuery({
      tab: 'entries',
      locale,
      filter,
      q: undefined,
      area: undefined,
      section: undefined,
      keys: undefined,
    });
  const legal = legalFallbacks(data);
  const toClean = data.orphans + data.sameAsCompiled + data.demoOverrides;

  return (
    <div className="space-y-6">
      {legal.length > 0 && (
        <Notice tone="warning">
          <ul className="space-y-1">
            {legal.map((l) => (
              <li key={l.key}>
                {t('admin.i18n.overview.legalFallback', {
                  key: l.key,
                  languages: l.locales.map((x) => LOCALE_META[x].native).join(', '),
                })}
              </li>
            ))}
          </ul>
        </Notice>
      )}
      {data.activeJob && (
        <Card>
          <CardBody className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex flex-wrap items-center gap-2">
                <JobStatusBadge job={data.activeJob} />
                {data.activeJob.demo && <Badge tone="info">{t('ai.demoBadge')}</Badge>}
              </span>
              <Link
                to={`/admin/translations?${translationsQueryString({ tab: 'jobs', job: data.activeJob.id })}`}
                className="inline-flex min-h-11 items-center text-sm font-medium text-primary-text underline underline-offset-2 sm:min-h-0"
              >
                {t('admin.i18n.tab.jobs')}
              </Link>
            </div>
            <JobProgress job={data.activeJob} />
          </CardBody>
        </Card>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {data.locales.map((stats) => (
          <Card key={stats.locale} data-locale-card={stats.locale}>
            <CardBody className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-[15px] font-semibold text-text">
                  <Flag country={LOCALE_META[stats.locale].flag} decorative />
                  {LOCALE_META[stats.locale].native}
                </span>
                {stats.locale === 'de' && <Badge>{t('admin.i18n.overview.source')}</Badge>}
              </div>
              {stats.locale === 'de' ? (
                <p className="text-sm text-muted">{t('admin.i18n.overview.keys', { count: stats.total })}</p>
              ) : (
                <>
                  <UsageBar value={stats.completeness * 100} tone="primary" />
                  <p className="text-sm text-text">
                    {t('admin.i18n.overview.translated', { done: stats.translated, total: stats.total })}
                  </p>
                  <ul className="space-y-0.5 text-sm text-muted">
                    <li>{t('admin.i18n.overview.upToDate', { count: stats.translated - stats.stale })}</li>
                    <li>{t('admin.i18n.overview.stale', { count: stats.stale })}</li>
                    <li>{t('admin.i18n.overview.missing', { count: stats.missing })}</li>
                    {stats.unreviewed > 0 && (
                      <li>{t('admin.i18n.overview.unreviewed', { count: stats.unreviewed })}</li>
                    )}
                  </ul>
                  <div className="flex flex-wrap gap-2">
                    {stats.missing > 0 && (
                      <Button size="sm" variant="outline" onClick={() => show(stats.locale, 'untranslated')}>
                        {t('admin.i18n.overview.showMissing')}
                      </Button>
                    )}
                    {stats.stale > 0 && (
                      <Button size="sm" variant="outline" onClick={() => show(stats.locale, 'stale')}>
                        {t('admin.i18n.overview.showStale')}
                      </Button>
                    )}
                  </div>
                </>
              )}
            </CardBody>
          </Card>
        ))}
      </div>
      {toClean > 0 && (
        <Card>
          <CardHeader
            title={t('admin.i18n.cleanup.title')}
            actions={
              canWrite ? (
                <Button
                  size="sm"
                  loading={cleanup.isPending}
                  onClick={() => cleanup.mutate({ orphans: true, sameAsCompiled: true, demo: true })}
                >
                  {t('admin.i18n.cleanup.button')}
                </Button>
              ) : undefined
            }
          />
          <CardBody className="space-y-1 text-sm text-text">
            <p>{t('admin.i18n.cleanup.text', { orphans: data.orphans, same: data.sameAsCompiled })}</p>
            {data.demoOverrides > 0 && (
              <p className="text-muted">
                {t('admin.i18n.cleanup.demoNotice', { count: data.demoOverrides })}
              </p>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

/** Legal keys shown as a fallback, with the languages where that happens. */
export function legalFallbacks(
  summary: Pick<TranslationSummaryDto, 'legal'>,
): { key: string; locales: TargetLocale[] }[] {
  return summary.legal.keys
    .map((key) => ({
      key,
      locales: TARGET_LOCALES.filter((l) => summary.legal.staleOrMissing[l]?.includes(key)),
    }))
    .filter((l) => l.locales.length > 0);
}

// --- Entries ------------------------------------------------------------------------------------

function EntriesTab({
  query,
  setQuery,
  summary,
  canWrite,
  canSuggest,
  onTranslate,
}: {
  query: TranslationsQuery;
  setQuery: (patch: Partial<TranslationsQuery>) => void;
  summary: TranslationSummaryDto | undefined;
  canWrite: boolean;
  canSuggest: boolean;
  onTranslate?: (
    narrowing: Pick<TranslationJobScope, 'area' | 'section' | 'q' | 'keys'>,
    count: number,
  ) => void;
}) {
  const { t } = useI18n();
  const entriesQuery = entriesQueryOf(query);
  const entries = useTranslationEntries(entriesQuery);
  const [search, setSearch] = useState(query.q ?? '');
  const latest = useRef(query);
  latest.current = query;
  // The search writes the URL a moment after typing stops; changing a filter starts at page 1.
  useEffect(() => {
    if (search === (latest.current.q ?? '')) return;
    const timer = setTimeout(() => setQuery({ q: search || undefined }), 300);
    return () => clearTimeout(timer);
    // Only the typing restarts the timer; setQuery changes with every render.
  }, [search]);
  useEffect(() => setSearch(query.q ?? ''), [query.q]);

  const keys = parseKeys(query.keys);
  const filtered = !!(query.q || query.area || query.section || keys.length || query.filter || query.locale);
  const data = entries.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1;
  const page = query.page ?? 1;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
        <Input
          type="search"
          className="lg:w-72"
          value={search}
          placeholder={t('admin.i18n.filter.search')}
          aria-label={t('admin.i18n.filter.search')}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          className="lg:w-44"
          aria-label={t('admin.i18n.filter.locale')}
          value={query.locale ?? 'any'}
          onChange={(e) => setQuery({ locale: e.target.value as Locale | 'any' })}
        >
          <option value="any">{t('admin.i18n.filter.anyLocale')}</option>
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_META[l].native}
            </option>
          ))}
        </Select>
        <Select
          className="lg:w-56"
          aria-label={t('admin.i18n.filter.state')}
          value={query.filter ?? 'all'}
          onChange={(e) => setQuery({ filter: e.target.value as TranslationFilter })}
        >
          {TRANSLATION_FILTERS.map((f) => (
            <option key={f} value={f}>
              {t(`admin.i18n.filter.${f}`)}
            </option>
          ))}
        </Select>
        <Select
          className="lg:w-44"
          aria-label={t('admin.i18n.filter.area')}
          value={query.area ?? ''}
          onChange={(e) => setQuery({ area: e.target.value || undefined })}
        >
          <option value="">{t('admin.i18n.filter.anyArea')}</option>
          {(summary?.areas ?? []).map((a) => (
            <option key={a.area} value={a.area}>
              {a.area} ({a.keys})
            </option>
          ))}
          {query.area && !summary?.areas.some((a) => a.area === query.area) && (
            <option value={query.area}>{query.area}</option>
          )}
        </Select>
        {filtered && (
          <Button
            variant="ghost"
            icon={<RotateCcw className="size-4" aria-hidden />}
            onClick={() =>
              setQuery({
                q: undefined,
                locale: undefined,
                filter: undefined,
                area: undefined,
                section: undefined,
                keys: undefined,
              })
            }
          >
            {t('admin.i18n.filter.reset')}
          </Button>
        )}
      </div>
      {(keys.length > 0 || query.section) && (
        <div className="flex flex-wrap gap-2">
          {keys.length > 0 && (
            <Badge tone="primary">{t('admin.i18n.filter.keys', { count: keys.length })}</Badge>
          )}
          {query.section && <Badge tone="primary">{query.section}</Badge>}
        </div>
      )}
      {keys.length > 0 && !!query.keysTotal && query.keysTotal > keys.length && (
        <Notice tone="info">
          {t('admin.i18n.filter.keysCapped', { count: keys.length, total: query.keysTotal })}
        </Notice>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {data ? t('admin.i18n.entries.count', { count: data.total }) : ''}
        </p>
        {onTranslate && data && (
          <Button
            size="sm"
            icon={<Sparkles className="size-4" aria-hidden />}
            onClick={() =>
              onTranslate(
                {
                  area: query.area,
                  section: query.section,
                  q: query.q,
                  keys: keys.length > 0 ? keys : undefined,
                },
                data.total,
              )
            }
          >
            {t('admin.i18n.ai.button')}
          </Button>
        )}
      </div>

      {entries.isLoading ? (
        <LoadingBlock rows={6} />
      ) : entries.isError ? (
        <ErrorState error={entries.error} onRetry={() => void entries.refetch()} />
      ) : data && data.items.length === 0 ? (
        <Card>
          <EmptyState title={t('admin.i18n.entries.empty')} />
        </Card>
      ) : data ? (
        <Card className="overflow-hidden">
          <TranslationsTable entries={data.items} canWrite={canWrite} canSuggest={canSuggest} />
        </Card>
      ) : null}

      {data && data.total > data.perPage && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-muted">{t('common.pageOf', { page, total: totalPages })}</span>
          <div className="flex gap-2">
            <Button size="sm" disabled={page <= 1} onClick={() => setQuery({ page: page - 1 })}>
              {t('common.prev')}
            </Button>
            <Button size="sm" disabled={page >= totalPages} onClick={() => setQuery({ page: page + 1 })}>
              {t('common.next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Import and export --------------------------------------------------------------------------

const linkButton =
  'inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium text-text shadow-card hover:bg-surface-3';

function TransferTab({ canWrite }: { canWrite: boolean }) {
  const { t } = useI18n();
  const [overridesLocale, setOverridesLocale] = useState<Locale | ''>('');
  const [targetLocale, setTargetLocale] = useState<TargetLocale>('fr');
  const [onlyMissing, setOnlyMissing] = useState(true);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={t('admin.i18n.export.title')} description={t('admin.i18n.export.applyHint')} />
        <CardBody className="space-y-5">
          <div className="flex flex-wrap items-end gap-2">
            <Select
              className="w-full sm:w-48"
              aria-label={t('admin.i18n.filter.locale')}
              value={overridesLocale}
              onChange={(e) => setOverridesLocale(e.target.value as Locale | '')}
            >
              <option value="">{t('admin.i18n.filter.anyLocale')}</option>
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_META[l].native}
                </option>
              ))}
            </Select>
            <a className={linkButton} href={exportUrl('overrides', overridesLocale || null)} download>
              <Download className="size-4" aria-hidden />
              {t('admin.i18n.export.overrides')}
            </a>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Select
              className="w-full sm:w-48"
              aria-label={t('admin.i18n.filter.locale')}
              value={targetLocale}
              onChange={(e) => setTargetLocale(e.target.value as TargetLocale)}
            >
              {TARGET_LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_META[l].native}
                </option>
              ))}
            </Select>
            <label className="inline-flex min-h-11 items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                className="size-4 accent-brand-blue"
                checked={onlyMissing}
                onChange={(e) => setOnlyMissing(e.target.checked)}
              />
              {t('admin.i18n.export.onlyMissing')}
            </label>
            <a className={linkButton} href={exportUrl('locale', targetLocale, onlyMissing)} download>
              <Download className="size-4" aria-hidden />
              {t('admin.i18n.export.locale')}
            </a>
          </div>
        </CardBody>
      </Card>
      {canWrite && <ImportCard />}
    </div>
  );
}

function ImportCard() {
  const { t } = useI18n();
  const [data, setData] = useState<unknown>(null);
  const [fileError, setFileError] = useState(false);
  const [replaceManual, setReplaceManual] = useState(false);
  const [markReviewed, setMarkReviewed] = useState(false);
  const [result, setResult] = useState<TranslationImportResultDto | null>(null);
  const run = useImportTranslations();

  const onFile = async (file: File | undefined) => {
    setResult(null);
    setFileError(false);
    setData(null);
    if (!file) return;
    try {
      setData(JSON.parse(await file.text()) as unknown);
    } catch {
      setFileError(true);
    }
  };
  const submit = (dryRun: boolean) =>
    run.mutate(
      { data, dryRun, replaceManual, markReviewed },
      {
        onSuccess: (res) => {
          setResult(res);
          if (!dryRun) toast.success(t('admin.i18n.import.done'));
        },
      },
    );
  const reset = () => setResult(null);

  return (
    <Card>
      <CardHeader title={t('admin.i18n.import.title')} />
      <CardBody className="space-y-4">
        <label className="block space-y-1.5">
          <span className="block text-[13px] font-medium text-text">{t('admin.i18n.import.file')}</span>
          <input
            type="file"
            accept="application/json,.json"
            className="block w-full text-sm text-text file:mr-3 file:rounded-lg file:border file:border-border file:bg-surface file:px-3 file:py-2 file:text-sm file:text-text"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>
        {fileError && <Notice tone="danger">{t('admin.i18n.error.import_invalid')}</Notice>}
        <div className="flex flex-wrap gap-x-6">
          <label className="inline-flex min-h-11 items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              className="size-4 accent-brand-blue"
              checked={replaceManual}
              onChange={(e) => {
                setReplaceManual(e.target.checked);
                reset();
              }}
            />
            {t('admin.i18n.import.replaceManual')}
          </label>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              className="size-4 accent-brand-blue"
              checked={markReviewed}
              onChange={(e) => {
                setMarkReviewed(e.target.checked);
                reset();
              }}
            />
            {t('admin.i18n.import.markReviewed')}
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            icon={<Upload className="size-4" aria-hidden />}
            disabled={data === null}
            loading={run.isPending && run.variables?.dryRun === true}
            onClick={() => submit(true)}
          >
            {t('admin.i18n.import.check')}
          </Button>
          <Button
            variant="primary"
            disabled={!result?.dryRun || result.created + result.updated === 0}
            loading={run.isPending && run.variables?.dryRun === false}
            onClick={() => submit(false)}
          >
            {t('admin.i18n.import.apply')}
          </Button>
        </div>
        {result && <ImportResult result={result} />}
      </CardBody>
    </Card>
  );
}

function ImportResult({ result }: { result: TranslationImportResultDto }) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      <Notice tone={result.dryRun ? 'info' : 'success'}>
        {t('admin.i18n.import.result', {
          created: result.created,
          updated: result.updated,
          unchanged: result.unchanged,
          skipped: result.skipped.length,
        })}
      </Notice>
      {result.skipped.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border text-sm">
          {result.skipped.map((s, i) => (
            <li
              key={`${s.locale}:${s.key}:${i}`}
              className="grid gap-1 px-3 py-2 sm:grid-cols-[minmax(0,2fr)_auto_minmax(0,2fr)] sm:gap-3"
            >
              <span className="font-mono text-[12.5px] break-all text-text">{s.key}</span>
              <span className="inline-flex items-center gap-1 text-muted">
                <Flag country={LOCALE_META[s.locale].flag} decorative />
                {LOCALE_META[s.locale].native}
              </span>
              <span className="min-w-0 break-words text-muted">
                {t(`admin.i18n.import.skip.${s.reason}`)}
                {s.detail ? ` (${s.detail})` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {result.warnings.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border text-sm">
          {result.warnings.map((w, i) => (
            <li
              key={`${w.locale}:${w.key}:${i}`}
              className="grid gap-1 px-3 py-2 sm:grid-cols-[minmax(0,2fr)_auto_minmax(0,2fr)] sm:gap-3"
            >
              <span className="font-mono text-[12.5px] break-all text-text">{w.key}</span>
              <span className="inline-flex items-center gap-1 text-muted">
                <Flag country={LOCALE_META[w.locale].flag} decorative />
                {LOCALE_META[w.locale].native}
              </span>
              <span className="min-w-0 break-words text-warning">
                {w.checks.map((c) => t(`admin.i18n.check.${c}`)).join(' ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
