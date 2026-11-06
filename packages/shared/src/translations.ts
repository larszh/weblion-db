import type { AiAvailabilityDto, AiModel } from './ai';
import type { Locale, TargetLocale } from './i18n/locales';

/**
 * DTOs and vocabulary of the translation admin and Mass Translate (i18n 14.1, plan 2.6, 2.10). U1 may only
 * add to this file.
 */

// --- Legal keys ---------------------------------------------------------------------------------

/** Never machine-translated, never served stale (i18n 8.1, 12.2, plan O28). Owner-reviewed before go-live. */
export const LEGAL_KEYS = ['ai.notice.title', 'ai.notice.text'] as const;
export type LegalKey = (typeof LEGAL_KEYS)[number];

export function isLegalKey(key: string): key is LegalKey {
  return (LEGAL_KEYS as readonly string[]).includes(key);
}

// --- Error codes (plan 2.10, frozen) ------------------------------------------------------------

/** HTTP error codes of the i18n routes; web texts admin.i18n.error.<code>. */
export const I18N_ERROR_CODES = [
  'placeholder_mismatch',
  'forbidden_character',
  'unknown_key',
  'legal_key',
  'nothing_to_translate',
  'estimate_changed',
  'job_running',
  'job_finished',
  'not_stale',
  'glossary_duplicate',
  'glossary_builtin',
  'import_invalid',
] as const;
export type I18nErrorCode = (typeof I18N_ERROR_CODES)[number];

/** Codes stored in translation_jobs.error.code when a job stops (plan 2.6); no HTTP status. */
export const TRANSLATION_JOB_ERROR_CODES = [
  'ai_budget_job',
  'cost_cap',
  'ai_not_configured',
  'ai_upstream',
  'ai_failed',
] as const;
export type TranslationJobErrorCode = (typeof TRANSLATION_JOB_ERROR_CODES)[number];

// --- Public payload (A1) ------------------------------------------------------------------------

export interface I18nOverridesDto {
  locale: Locale;
  /** Key -> text; only web keys; legal substitutions included (i18n 13). */
  values: Record<string, string>;
}

// --- Cells and entries --------------------------------------------------------------------------

/** repo = compiled value from the repository, no override. */
export type TranslationOrigin = 'repo' | 'manual' | 'ai';
export type TranslationState = 'missing' | 'current' | 'stale';

export type TranslationCheckName =
  | 'placeholders'
  | 'german'
  | 'formality'
  | 'length'
  | 'glossary'
  | 'sharpS'
  | 'emDash'
  | 'typography'
  | 'content';

export interface TranslationCellDto {
  locale: Locale;
  /** What the console shows for this locale without fallback: override, else compiled; null = missing. */
  value: string | null;
  /** Compiled value in the repository, null when there is none. */
  compiled: string | null;
  origin: TranslationOrigin;
  state: TranslationState;
  /** Overrides: as stored. Compiled values count as reviewed. */
  reviewed: boolean;
  demo: boolean;
  /** The override is not served right now (demo row without the demo provider, stale legal key). */
  hidden: boolean;
  updatedBy: { id: string; name: string } | null;
  updatedAt: string | null;
  /** Soft check failures of the value (i18n 19.4 checks 3 to 6, 11); empty for de and for missing cells. */
  warnings: TranslationCheckName[];
}

export interface TranslationEntryDto {
  key: string;
  section: string; // SectionName
  /** First key segment (O24), e.g. "admin" for admin.ai.status. */
  area: string;
  legal: boolean;
  serverOnly: boolean; // email.* and pdf.*
  placeholders: string[]; // of the effective German text
  /** All five cells; cells.de.value is the effective German text. */
  cells: Record<Locale, TranslationCellDto>;
}

export type TranslationFilter =
  'all' | 'untranslated' | 'stale' | 'changed' | 'ai' | 'unreviewed' | 'attention';

/** Query of A3 (also the URL query of the admin page, i18n 17.1). */
export interface TranslationEntriesQuery {
  /** The language the state filters look at; 'any' = any target locale. Default 'any'. */
  locale?: Locale | 'any';
  filter?: TranslationFilter;
  q?: string;
  area?: string;
  section?: string;
  /** Exact keys, e.g. from a job's failures (at most 500). */
  keys?: string[];
  page?: number; // 1-based
  pageSize?: number; // default 50, at most 200
}

// --- Summary (A2) -------------------------------------------------------------------------------

export interface TranslationLocaleStatsDto {
  locale: Locale;
  total: number;
  /** Has a value (current or stale). */
  translated: number;
  missing: number;
  stale: number;
  /** Rows in translation_overrides for this locale (servable ones). */
  overrides: number;
  ai: number;
  unreviewed: number;
  attention: number;
  /** translated / total, 0 to 1. */
  completeness: number;
  /** (translated - stale) / total. */
  upToDate: number;
}

export interface TranslationSummaryDto {
  keys: number;
  locales: TranslationLocaleStatsDto[]; // de first, then en, fr, it, nl
  areas: { area: string; keys: number }[];
  sections: { section: string; keys: number }[];
  /** Overrides whose key no longer exists (cleanup A8). */
  orphans: number;
  /** Overrides equal to the compiled value (applied in the repository meanwhile, cleanup A8). */
  sameAsCompiled: number;
  /** Rows with demo = true (i18n 12.10). */
  demoOverrides: number;
  legal: { keys: LegalKey[]; staleOrMissing: Partial<Record<TargetLocale, LegalKey[]>> };
  ai: AiAvailabilityDto;
  activeJob: TranslationJobDto | null;
}

// --- Writes (A4 to A8) --------------------------------------------------------------------------

/** A4 PUT body. */
export interface TranslationEditInput {
  value: string; // 1 ... 20,000 characters
  /** Default true for a manual save; false keeps it in the "Ungeprüft" list. */
  reviewed?: boolean;
}
export interface TranslationEditResultDto {
  entry: TranslationEntryDto;
  /** French spacing was corrected before saving (i18n 12.5 step 3). */
  typographyFixed: boolean;
}
/** A6 body. */
export interface TranslationReviewInput {
  reviewed: boolean;
}
/** A8 body. */
export interface TranslationCleanupInput {
  orphans: boolean;
  sameAsCompiled: boolean;
  demo: boolean;
  dryRun?: boolean;
}
export interface TranslationCleanupResultDto {
  orphans: number;
  sameAsCompiled: number;
  demo: number;
  dryRun: boolean;
}

// --- Glossary and style notes (A9 to A14) -------------------------------------------------------

export interface GlossaryEntryDto {
  id: string;
  term: string;
  keep: boolean;
  translations: Partial<Record<TargetLocale, string>>;
  note: string | null;
  builtIn: boolean;
  updatedBy: { id: string; name: string } | null;
  updatedAt: string;
}
export interface GlossaryInput {
  term: string; // 1 ... 100
  keep: boolean;
  translations: Partial<Record<TargetLocale, string>>; // each 1 ... 100
  note?: string | null; // at most 300
}
export interface StyleNotesDto {
  /** Fixed notes of the translator per locale (i18n 12.3), read-only. */
  defaults: Record<TargetLocale, string>;
  /** The admin's additions (settings key i18n_style). */
  notes: Partial<Record<TargetLocale, string>>;
}

// --- Import and export (A15, A16) ---------------------------------------------------------------

export type TranslationExportScope = 'overrides' | 'locale';
export interface TranslationImportInput {
  /** The parsed JSON file (i18n 16.1). */
  data: unknown;
  dryRun: boolean;
  replaceManual?: boolean;
  markReviewed?: boolean;
}
export type TranslationImportSkip =
  'placeholders' | 'characters' | 'unknown_key' | 'manual' | 'legal_ai' | 'unchanged';
export interface TranslationImportResultDto {
  dryRun: boolean;
  created: number;
  updated: number;
  unchanged: number;
  skipped: { key: string; locale: Locale; reason: TranslationImportSkip; detail?: string }[]; // at most 500
  /** Warnings of the soft checks on imported values (they are imported anyway). */
  warnings: { key: string; locale: Locale; checks: TranslationCheckName[] }[]; // at most 500
}

// --- Mass Translate (B1 to B7) ------------------------------------------------------------------

export type TranslationJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type TranslationJobSelection = 'untranslated' | 'stale' | 'both' | 'all';

export interface TranslationJobScope {
  locales: TargetLocale[]; // 1 ... 4
  selection: TranslationJobSelection;
  /** Narrowing, like the entries filters: area, section, search, explicit keys (at most 5,000). */
  area?: string;
  section?: string;
  q?: string;
  keys?: string[];
  /** B7 only: the failed pairs of this job. */
  retryOf?: string;
  replaceManual: boolean;
}

/** One planned batch (i18n 12.2), stored in translation_jobs.batches. */
export interface TranslationBatchPlan {
  locale: TargetLocale;
  keys: string[];
}

export type TranslationFailureReason =
  | 'missing' // no entry for this item in the answer
  | 'empty'
  | 'placeholders' // placeholders or line breaks differ from the German text
  | 'characters' // sharp s, em dash, French spacing that could not be fixed
  | 'content' // new URL, e-mail address or number (review finding 15)
  | 'german' // leftover German (check 3)
  | 'formality' // informal address (check 4)
  | 'length' // check 5
  | 'glossary' // check 6
  | 'refusal' // Claude declined this item
  | 'error'; // the call failed after retries and splits
export interface TranslationFailure {
  key: string;
  locale: TargetLocale;
  reason: TranslationFailureReason;
  /** Short English detail, e.g. "missing {name}". */
  detail: string | null;
}

export interface TranslationEstimateDto {
  scope: TranslationJobScope;
  model: AiModel;
  demo: boolean;
  /** (key, locale) pairs that would be translated. */
  keys: number;
  perLocale: Partial<Record<TargetLocale, number>>;
  batches: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  /** AiBudgetDto.remainingMicros; null in demo mode. */
  budgetRemainingMicros: number | null;
  /** Legal keys left out (i18n 12.2). */
  legal: number;
  /** Manual or reviewed cells kept because replaceManual is off. */
  keptManual: number;
  /** Keys without letters, left out. */
  skipped: number;
}

/** B3 and B7 body. */
export interface TranslationJobStartInput {
  scope: TranslationJobScope;
  /** The costMicros of the estimate the admin confirmed. */
  confirmCostMicros: number;
}

export interface TranslationJobDto {
  id: string;
  status: TranslationJobStatus;
  scope: TranslationJobScope;
  model: AiModel;
  demo: boolean;
  total: number;
  done: number;
  failed: number;
  skipped: number;
  batches: number;
  batchesDone: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  estimateMicros: number;
  error: { code: string; message: string } | null;
  cancelRequested: boolean;
  retryOf: string | null;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
export interface TranslationJobDetailDto extends TranslationJobDto {
  failures: TranslationFailure[];
}

// --- Suggest (B1) -------------------------------------------------------------------------------

export interface TranslationSuggestInput {
  key: string;
  locales: TargetLocale[]; // 1 ... 4
}
export interface TranslationSuggestionDto {
  locale: TargetLocale;
  /** null when the suggestion failed validation (reason set). */
  value: string | null;
  reason: TranslationFailureReason | null;
  detail: string | null;
}
export interface TranslationSuggestDto {
  key: string;
  suggestions: TranslationSuggestionDto[];
  costMicros: number;
  demo: boolean;
}
