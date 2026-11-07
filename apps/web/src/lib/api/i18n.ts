import { useCallback } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  GlossaryEntryDto,
  I18nOverridesDto,
  GlossaryInput,
  Locale,
  Paginated,
  StyleNotesDto,
  TargetLocale,
  TranslationCleanupInput,
  TranslationCleanupResultDto,
  TranslationEditResultDto,
  TranslationEntriesQuery,
  TranslationEntryDto,
  TranslationEstimateDto,
  TranslationExportScope,
  TranslationImportInput,
  TranslationImportResultDto,
  TranslationJobDetailDto,
  TranslationJobDto,
  TranslationJobScope,
  TranslationJobStartInput,
  TranslationSuggestDto,
  TranslationSummaryDto,
} from '@weblion/shared';
import { api, apiUrl } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApiMutation } from '@/lib/queries';

/**
 * Query hooks of the translation admin /admin/translations (i18n 14, 17): summary, entries, cell writes,
 * glossary, style notes, import and export, and the Mass Translate jobs.
 */

export const i18nKeys = {
  all: ['i18n-admin'] as const,
  summary: ['i18n-admin', 'summary'] as const,
  entries: (query: TranslationEntriesQuery) => ['i18n-admin', 'entries', query] as const,
  glossary: ['i18n-admin', 'glossary'] as const,
  style: ['i18n-admin', 'style'] as const,
  jobs: (page: number) => ['i18n-admin', 'jobs', page] as const,
  job: (id: string) => ['i18n-admin', 'job', id] as const,
};

const isActive = (status: TranslationJobDto['status'] | undefined) =>
  status === 'queued' || status === 'running';

/** A2; polled every 2 s while a job is queued or running, so the overview follows its progress. */
export const useTranslationSummary = () =>
  useQuery({
    queryKey: i18nKeys.summary,
    queryFn: () => api.get<TranslationSummaryDto>('/admin/i18n/summary'),
    refetchInterval: (q) => (isActive(q.state.data?.activeJob?.status) ? 2_000 : false),
  });

/** The query parameters of A3 (keys as a comma list). */
function entriesParams(query: TranslationEntriesQuery) {
  return {
    locale: query.locale,
    filter: query.filter,
    q: query.q,
    area: query.area,
    section: query.section,
    keys: query.keys?.join(','),
    page: query.page,
    pageSize: query.pageSize,
  };
}

/** A3, keeping the previous page on screen while the next one loads. */
export const useTranslationEntries = (query: TranslationEntriesQuery) =>
  useQuery({
    queryKey: i18nKeys.entries(query),
    queryFn: () => api.get<Paginated<TranslationEntryDto>>('/admin/i18n/entries', entriesParams(query)),
    placeholderData: (prev) => prev,
  });

const cellPath = (locale: Locale, key: string) => `/admin/i18n/entries/${locale}/${encodeURIComponent(key)}`;

/** Replaces one entry in every loaded page of A3 (the answer of a write), so the row updates at once. */
export function replaceEntry(qc: QueryClient, entry: TranslationEntryDto): void {
  qc.setQueriesData<Paginated<TranslationEntryDto>>({ queryKey: ['i18n-admin', 'entries'] }, (page) =>
    page ? { ...page, items: page.items.map((e) => (e.key === entry.key ? entry : e)) } : page,
  );
}

/** After a write: the counts of the overview and the other filters may change. */
function refreshAfter(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: i18nKeys.summary });
  void qc.invalidateQueries({ queryKey: ['i18n-admin', 'entries'] });
}

/** A4. */
export function useSaveTranslation() {
  const qc = useQueryClient();
  return useApiMutation(
    (vars: { locale: Locale; key: string; value: string; reviewed: boolean }) =>
      api.put<TranslationEditResultDto>(cellPath(vars.locale, vars.key), {
        value: vars.value,
        reviewed: vars.reviewed,
      }),
    {
      onSuccess: (result) => {
        replaceEntry(qc, result.entry);
        refreshAfter(qc);
      },
    },
  );
}

/** A5. */
export function useRevertTranslation() {
  const qc = useQueryClient();
  return useApiMutation(
    (vars: { locale: Locale; key: string }) => api.del<TranslationEntryDto>(cellPath(vars.locale, vars.key)),
    {
      onSuccess: (entry) => {
        replaceEntry(qc, entry);
        refreshAfter(qc);
      },
    },
  );
}

/** A6. */
export function useReviewTranslation() {
  const qc = useQueryClient();
  return useApiMutation(
    (vars: { locale: Locale; key: string; reviewed: boolean }) =>
      api.post<TranslationEntryDto>(`${cellPath(vars.locale, vars.key)}/review`, { reviewed: vars.reviewed }),
    {
      onSuccess: (entry) => {
        replaceEntry(qc, entry);
        refreshAfter(qc);
      },
    },
  );
}

/** A7. */
export function useConfirmTranslation() {
  const qc = useQueryClient();
  return useApiMutation(
    (vars: { locale: Locale; key: string }) =>
      api.post<TranslationEntryDto>(`${cellPath(vars.locale, vars.key)}/confirm`),
    {
      onSuccess: (entry) => {
        replaceEntry(qc, entry);
        refreshAfter(qc);
      },
    },
  );
}

/** A8. */
export function useCleanupTranslations(success: (result: TranslationCleanupResultDto) => string | null) {
  return useApiMutation(
    (input: TranslationCleanupInput) => api.post<TranslationCleanupResultDto>('/admin/i18n/cleanup', input),
    { success, invalidate: [i18nKeys.all] },
  );
}

// --- Glossary and style notes -------------------------------------------------------------------

export const useGlossary = () =>
  useQuery({
    queryKey: i18nKeys.glossary,
    queryFn: () => api.get<GlossaryEntryDto[]>('/admin/i18n/glossary'),
  });

/** A10 (no id) or A11 (with id). */
export function useSaveGlossaryTerm(success: string) {
  return useApiMutation(
    (vars: { id?: string; input: GlossaryInput }) =>
      vars.id
        ? api.patch<GlossaryEntryDto>(`/admin/i18n/glossary/${vars.id}`, vars.input)
        : api.post<GlossaryEntryDto>('/admin/i18n/glossary', vars.input),
    // The glossary changes the warnings of the cells too.
    { success, invalidate: [i18nKeys.all] },
  );
}

/** A12. */
export function useDeleteGlossaryTerm() {
  return useApiMutation((id: string) => api.del<{ ok: true }>(`/admin/i18n/glossary/${id}`), {
    invalidate: [i18nKeys.all],
  });
}

export const useStyleNotes = () =>
  useQuery({ queryKey: i18nKeys.style, queryFn: () => api.get<StyleNotesDto>('/admin/i18n/style') });

/** A14. */
export function useSaveStyleNotes(success: string) {
  return useApiMutation(
    (vars: { locale: TargetLocale; notes: string }) =>
      api.put<StyleNotesDto>(`/admin/i18n/style/${vars.locale}`, { notes: vars.notes }),
    { success, invalidate: [i18nKeys.style] },
  );
}

// --- Import and export --------------------------------------------------------------------------

/** A15; dry run and import are the same route. */
export function useImportTranslations() {
  const qc = useQueryClient();
  return useApiMutation(
    (input: TranslationImportInput) => api.post<TranslationImportResultDto>('/admin/i18n/import', input),
    {
      onSuccess: (result) => {
        if (!result.dryRun) void qc.invalidateQueries({ queryKey: i18nKeys.all });
      },
    },
  );
}

/** A16 as a link: the browser downloads the file (Content-Disposition: attachment). */
export function exportUrl(scope: TranslationExportScope, locale: Locale | null, onlyMissing = false): string {
  return apiUrl('/admin/i18n/export', {
    scope,
    locale: locale ?? undefined,
    only: scope === 'locale' && onlyMissing ? 'missing' : undefined,
  });
}

// --- Mass Translate -----------------------------------------------------------------------------

/** B1: nothing is saved; the editor offers the suggestion for the field. */
export function useSuggestTranslation() {
  return useApiMutation((vars: { key: string; locales: TargetLocale[] }) =>
    api.post<TranslationSuggestDto>('/admin/i18n/ai/suggest', vars),
  );
}

/** B2. */
export function useEstimateTranslation() {
  return useApiMutation((scope: TranslationJobScope) =>
    api.post<TranslationEstimateDto>('/admin/i18n/ai/estimate', scope),
  );
}

/** B3, or B7 with retryOf: a new job over the failed pairs of that job. */
export function useStartTranslationJob() {
  return useApiMutation(
    (input: TranslationJobStartInput) =>
      input.scope.retryOf
        ? api.post<TranslationJobDto>(`/admin/i18n/ai/jobs/${input.scope.retryOf}/retry`, input)
        : api.post<TranslationJobDto>('/admin/i18n/ai/jobs', input),
    // The caller handles estimate_changed itself (a new estimate, then a second confirmation).
    { errorToast: false, invalidate: [i18nKeys.all] },
  );
}

/** B6. */
export function useCancelTranslationJob() {
  return useApiMutation((id: string) => api.post<TranslationJobDto>(`/admin/i18n/ai/jobs/${id}/cancel`), {
    invalidate: [i18nKeys.all],
  });
}

export const useTranslationJobs = (page: number) =>
  useQuery({
    queryKey: i18nKeys.jobs(page),
    queryFn: () => api.get<Paginated<TranslationJobDto>>('/admin/i18n/ai/jobs', { page }),
    placeholderData: (prev) => prev,
    refetchInterval: (q) => (q.state.data?.items.some((j) => isActive(j.status)) ? 2_000 : false),
  });

/** B5, polled every 2 s while the job is queued or running (i18n 12.1 step 6). */
export const useTranslationJob = (id: string | undefined) =>
  useQuery({
    queryKey: i18nKeys.job(id ?? ''),
    queryFn: () => api.get<TranslationJobDetailDto>(`/admin/i18n/ai/jobs/${id}`),
    enabled: !!id,
    refetchInterval: (q) => (isActive(q.state.data?.status) ? 2_000 : false),
  });

/**
 * After a job: the texts of the console itself change at once (i18n 12.1 step 8). Loads the overrides of the UI
 * language and of its English fallback (A1) and hands them to the provider.
 */
export function useRefreshConsoleTexts(): () => Promise<void> {
  const { locale, applyOverrides } = useI18n();
  return useCallback(async () => {
    const locales: Locale[] = locale === 'de' || locale === 'en' ? [locale] : [locale, 'en'];
    for (const l of locales) {
      try {
        const body = await api.get<I18nOverridesDto>(`/i18n/overrides/${l}`);
        applyOverrides(l, body.values);
      } catch {
        // The next page load fetches them anyway.
      }
    }
  }, [locale, applyOverrides]);
}
