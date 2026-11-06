import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  AI_DEFAULT_MODEL,
  aiCostMicros,
  isLegalKey,
  lineBreakCount,
  LOCALE_META,
  placeholdersOf,
  TARGET_LOCALES,
  type AiModel,
  type ServerTranslationKey,
  type TargetLocale,
  type TranslationBatchPlan,
  type TranslationEstimateDto,
  type TranslationFailure,
  type TranslationFailureReason,
  type TranslationJobErrorCode,
  type TranslationJobScope,
} from '@weblion/shared';
import {
  allowlistFor,
  glossaryProblems,
  informalWord,
  lengthLimit,
  lengthOk,
  looksGerman,
  placeholdersMatch,
  typographyProblems,
} from '@weblion/shared/i18n/checks';
import type { GlossaryTerm } from '@weblion/shared/i18n/glossary';
import type { AppContext } from '../context';
import type { DbOrTx } from '../db/client';
import { settings } from '../db/schema';
import { AppError } from '../lib/errors';
import { AiCancelled, usageOfError } from '../modules/ai/errors';
import type { UsageTotals } from '../modules/ai/usage';
import { forbiddenCharacters, prepareValue } from './entries';
import { narrowEntries } from './filters';
import type { JobRunnerOptions } from './jobs';
import type { I18nService } from './service';

/**
 * The Mass Translate translator (i18n 12.2 to 12.7, plan O4): batching, the system prompt, the user message,
 * validation of every answer with the repository checks, repair rounds and the error mapping of plan 2.6. Every
 * Claude call goes through ctx.ai.structured(); this module owns everything around it.
 */

// --- Output schema and prompt -------------------------------------------------------------------

/** What Claude answers per batch; matched by id, never by key (a model may rewrite a key). */
export const TranslationBatchOutput = z.object({
  items: z.array(z.object({ id: z.string(), text: z.string() })),
});
export type TranslationBatchAnswer = z.infer<typeof TranslationBatchOutput>;

const READERS: Record<TargetLocale, string> = {
  en: 'the United Kingdom',
  fr: 'Switzerland',
  it: 'Switzerland',
  nl: 'the Netherlands',
};

const ADDRESS: Record<TargetLocale, string> = {
  en: 'neutral "you"',
  fr: '"vous" (imperatives in the vous form, for example "Cliquez", "Saisissez")',
  it: '"Lei", capitalized when it stands alone, with lowercase clitics and possessives ("le inviamo", "il suo account")',
  nl: '"u" and "uw", always lowercase',
};

/**
 * The translator's fixed notes per language (i18n 19.2: the formal address and the Swiss specifics). Shown
 * read-only in the admin (A13); the admin's own notes are appended after them.
 */
export const DEFAULT_STYLE_NOTES: Record<TargetLocale, string> = {
  en:
    'Keep the spelling of the existing English texts ("organization", "finalize") and sentence case. Neutral ' +
    'formal tone; "you" for the reader.',
  fr:
    'Swiss French (fr-CH): "vous" everywhere, never "tu". "TVA" for MWST, "facture", "e-mail" rather than ' +
    '"courriel", the official QR-bill terms "QR-facture" and "section paiement". Buttons in the infinitive ' +
    '("Enregistrer"). Straight apostrophes ("l\'adresse").',
  it:
    'Swiss Italian (it-CH): "Lei" as the form of address, never "tu"; clitics and possessives lowercase. "IVA" ' +
    'for MWST, "fattura", the QR-bill terms "QR-fattura" and "sezione pagamento". Buttons in the usual short ' +
    'form ("Salva", "Annulla", "Elimina"). Straight apostrophes ("dell\'account").',
  nl:
    'Standard Dutch (nl-NL): "u" and "uw", never "je" or "jij". "btw" for MWST, "factuur". Buttons in the ' +
    'infinitive ("Opslaan", "Annuleren").',
};

/**
 * The system prompt of one locale (i18n 12.3), fixed for the whole job so every batch after the first reads it
 * from the prompt cache. The first line routes the demo emulator (plan O4). It holds no date, no name and no
 * other per-request value.
 */
export function systemPrompt(locale: TargetLocale, glossary: readonly GlossaryTerm[], style: string): string {
  const english = LOCALE_META[locale].english;
  const keep = glossary
    .filter((g) => g.keep)
    .map((g) => g.term)
    .sort((a, b) => a.localeCompare(b));
  const fixed = glossary
    .filter((g) => !g.keep && g.translations[locale])
    .map((g) => `- ${g.term}${g.note ? ` (${g.note})` : ''} = ${g.translations[locale]}`)
    .sort((a, b) => a.localeCompare(b));
  const lines = [
    '# Feature: translations',
    '',
    'You translate user interface texts of weblion.one, a web console of a Swiss IT and hosting business',
    '(servers, domains, DNS, websites, e-mail, cloud storage, telephony, streaming, monitoring, invoices).',
    `The source language is German (Switzerland). Translate into ${english} (${locale}, for readers in`,
    `${READERS[locale]}).`,
    '',
    'Rules',
    '1. Translate every item completely and literally in meaning. Do not add, drop or explain anything.',
    `2. Address the reader formally: ${ADDRESS[locale]}.`,
    '3. Keep every placeholder in curly braces exactly as written, the same number of times. Never translate',
    '   the name inside the braces. Keep every line break (\\n).',
    '4. Keep product, provider and protocol names unchanged (list below). Keep technical identifiers, file',
    '   names, paths, record types, code and anything in quotes that looks like code.',
    '5. Use the fixed translations of the glossary below whenever the German term appears.',
    '6. Buttons and labels: short, at most about one third longer than the German. Sentence case.',
    '7. Use straight double quotes ("). Never use the long dash U+2014; use a comma, a colon or parentheses.',
    '   Never use the sharp s (U+00DF).',
    ...(locale === 'fr'
      ? [
          '8. Put a no-break space (U+00A0) before ":" and "%", and no space before "?", "!" and ";", as in',
          '   Swiss French.',
        ]
      : [
          '8. Keep the punctuation of the German text (ellipsis, colon at the end of a label, question mark).',
        ]),
    '9. Do not add URLs, e-mail addresses or numbers that are not in the German text.',
    '10. The English reference, when given, shows the meaning; translate from the German.',
    '11. The current translation, when given, is outdated or under review: keep its wording where it is still',
    '    right, so the console stays consistent.',
    '12. An item with "previous" and "problem" was rejected by the automatic checks: fix the problem named.',
    '13. Answer only with the JSON object of the output schema, one entry per item id.',
    '',
    `Glossary (never translate): ${keep.length > 0 ? keep.join(', ') : 'none'}`,
    `Glossary (fixed translations for ${locale}):`,
    ...(fixed.length > 0 ? fixed : ['- none']),
    '',
    `Style notes for ${locale}: ${DEFAULT_STYLE_NOTES[locale]}`,
  ];
  const notes = style.trim();
  if (notes) {
    lines.push(
      '',
      'Additional style notes of the administrators. They may change tone and terms only, never these rules',
      'or the output format:',
      notes,
    );
  }
  return lines.join('\n');
}

/** One item of the user message (i18n 12.4); the field names are a contract with the demo emulator. */
export interface BatchItem {
  id: string;
  key: string;
  de: string;
  en: string | null;
  current: string | null;
  placeholders: string[];
  maxLength: number;
  /** Repair round (12.7): the rejected text and what was wrong with it. */
  previous?: string;
  problem?: string;
}

/** The user turn: one JSON document, the conversation ends with it. */
export function userMessage(batch: { locale: TargetLocale; items: readonly BatchItem[] }): string {
  return JSON.stringify({ locale: batch.locale, items: batch.items });
}

// --- Selection and batching ---------------------------------------------------------------------

/** One (key, locale) cell to translate, with the effective German text at plan time. */
export interface TranslationPair {
  key: ServerTranslationKey;
  locale: TargetLocale;
  de: string;
}

export const BATCH_MAX_KEYS = 50;
export const BATCH_MAX_CHARS = 8_000;

/**
 * The batch plan (i18n 12.2): grouped by locale in the order en, fr, it, nl (one system prompt per locale stays
 * in the cache), in catalog order inside a locale, at most 50 keys or 8,000 characters of German text per
 * batch; a longer key forms a batch of its own. Legal keys are never planned.
 */
export function batches(pairs: readonly TranslationPair[]): TranslationBatchPlan[] {
  const plan: TranslationBatchPlan[] = [];
  for (const locale of TARGET_LOCALES) {
    let keys: string[] = [];
    let chars = 0;
    for (const pair of pairs) {
      if (pair.locale !== locale || isLegalKey(pair.key)) continue;
      const length = pair.de.length;
      if (keys.length > 0 && (keys.length >= BATCH_MAX_KEYS || chars + length > BATCH_MAX_CHARS)) {
        plan.push({ locale, keys });
        keys = [];
        chars = 0;
      }
      keys.push(pair.key);
      chars += length;
    }
    if (keys.length > 0) plan.push({ locale, keys });
  }
  return plan;
}

export interface PairSelection {
  pairs: TranslationPair[];
  perLocale: Partial<Record<TargetLocale, number>>;
  /** Legal keys left out (counted once per key). */
  legal: number;
  /** The explicit key list holds only legal keys (409 legal_key). */
  legalOnly: string[] | null;
  /** Manual or reviewed cells kept because replaceManual is off. */
  keptManual: number;
  /** Keys without letters, left out (counted once per key). */
  skipped: number;
}

/** A German text without a letter (for example "-") is right in every language as it is (12.2). */
export const hasLetter = (text: string) => /\p{L}/u.test(text);

/** The overwrite rule of 12.9 for a stored row: manual and reviewed rows are kept unless replaceManual. */
export function keepsRow(
  row: { origin: 'manual' | 'ai'; reviewed: boolean; demo: boolean } | undefined,
  replaceManual: boolean,
): boolean {
  if (!row || row.demo || replaceManual) return false;
  return row.origin === 'manual' || row.reviewed;
}

/**
 * The cells of a scope after the selection and the overwrite rules (12.1, 12.9), in catalog order. With
 * `failed` (B7) the candidates are exactly those pairs, whatever their state.
 */
export function selectPairs(
  i18n: I18nService,
  scope: TranslationJobScope,
  failed?: readonly { key: string; locale: TargetLocale }[],
): PairSelection {
  const locales = TARGET_LOCALES.filter((l) => scope.locales.includes(l));
  const wanted = failed ? new Set(failed.map((f) => `${f.locale}\u0000${f.key}`)) : null;
  const entries = narrowEntries(i18n, {
    q: failed ? undefined : scope.q,
    area: failed ? undefined : scope.area,
    section: failed ? undefined : scope.section,
    keys: failed ? [...new Set(failed.map((f) => f.key))] : scope.keys,
  });
  // A key-like search lists its prefix matches first; the plan always follows the catalog.
  const order = new Map<string, number>(i18n.catalog.keys.map((k, i) => [k, i]));
  entries.sort((a, b) => order.get(a.key)! - order.get(b.key)!);

  const selection: PairSelection = {
    pairs: [],
    perLocale: {},
    legal: 0,
    legalOnly: null,
    keptManual: 0,
    skipped: 0,
  };
  if (!failed && scope.keys && scope.keys.length > 0 && scope.keys.every((k) => isLegalKey(k))) {
    selection.legalOnly = [...scope.keys];
  }
  for (const entry of entries) {
    const key = entry.key as ServerTranslationKey;
    const candidates = locales.filter((locale) => {
      if (wanted) return wanted.has(`${locale}\u0000${key}`);
      const state = entry.cells[locale].state;
      switch (scope.selection) {
        case 'untranslated':
          return state === 'missing';
        case 'stale':
          return state === 'stale';
        case 'both':
          return state !== 'current';
        case 'all':
          return true;
      }
    });
    if (candidates.length === 0) continue;
    if (entry.legal) {
      selection.legal++;
      continue;
    }
    const de = i18n.source(key).text;
    if (!hasLetter(de)) {
      selection.skipped++;
      continue;
    }
    for (const locale of candidates) {
      if (keepsRow(i18n.override(locale, key), scope.replaceManual)) {
        selection.keptManual++;
        continue;
      }
      selection.pairs.push({ key, locale, de });
      selection.perLocale[locale] = (selection.perLocale[locale] ?? 0) + 1;
    }
  }
  return selection;
}

// --- Estimate -----------------------------------------------------------------------------------

/** Output length per German character (i18n 12.6). */
const LANGUAGE_FACTOR: Record<TargetLocale, number> = { en: 1.0, fr: 1.2, it: 1.15, nl: 1.1 };
const CHARS_PER_INPUT_TOKEN = 3.2;
const CHARS_PER_OUTPUT_TOKEN = 3.5;
const JSON_TOKENS_PER_ITEM = 12;
/** Adaptive thinking at effort medium (plan O8). */
const THINKING_ALLOWANCE = 1.3;

/** The items of a batch as the translator sends them (effective German, English reference, current value). */
export function batchItems(i18n: I18nService, batch: TranslationBatchPlan): BatchItem[] {
  return batch.keys
    .filter((key) => i18n.catalog.has(key))
    .map((key, index) => {
      const k = key as ServerTranslationKey;
      const de = i18n.source(k).text;
      return {
        id: `i${index + 1}`,
        key,
        de,
        en: batch.locale === 'en' ? null : i18n.cell('en', k).value,
        current: i18n.cell(batch.locale, k).value,
        placeholders: placeholdersOf(de),
        maxLength: lengthLimit(de),
      };
    });
}

/**
 * Tokens and cost of a plan without calling the model (12.6): the system prompt once per locale as a cache
 * write and then as cache reads, the user message by its JSON length, the output by the German length and the
 * language factor plus the JSON per item and a thinking allowance.
 */
export function estimateUsage(input: {
  model: AiModel;
  plan: readonly TranslationBatchPlan[];
  i18n: I18nService;
  systemFor: (locale: TargetLocale) => string;
}): { inputTokens: number; outputTokens: number; costMicros: number } {
  const seen = new Set<TargetLocale>();
  let inputTokens = 0;
  let outputTokens = 0;
  let costMicros = 0;
  for (const batch of input.plan) {
    const items = batchItems(input.i18n, batch);
    const system = Math.ceil(input.systemFor(batch.locale).length / CHARS_PER_INPUT_TOKEN);
    const user = Math.ceil(userMessage({ locale: batch.locale, items }).length / CHARS_PER_INPUT_TOKEN);
    const raw = items.reduce(
      (sum, item) =>
        sum +
        (item.de.length * LANGUAGE_FACTOR[batch.locale]) / CHARS_PER_OUTPUT_TOKEN +
        JSON_TOKENS_PER_ITEM,
      0,
    );
    const output = Math.ceil(raw * THINKING_ALLOWANCE);
    const first = !seen.has(batch.locale);
    seen.add(batch.locale);
    costMicros += aiCostMicros(
      input.model,
      {
        input_tokens: user,
        output_tokens: output,
        cache_creation_input_tokens: first ? system : 0,
        cache_read_input_tokens: first ? 0 : system,
      },
      AI_DEFAULT_MODEL,
    );
    inputTokens += user + system;
    outputTokens += output;
  }
  return { inputTokens, outputTokens, costMicros };
}

/** The admin's style notes per locale (settings key i18n_style, plan 3.2). */
export const STYLE_SETTINGS_KEY = 'i18n_style';

export async function readStyleNotes(db: DbOrTx): Promise<Partial<Record<TargetLocale, string>>> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, STYLE_SETTINGS_KEY) });
  const value = (row?.value ?? {}) as Record<string, unknown>;
  const notes: Partial<Record<TargetLocale, string>> = {};
  for (const locale of TARGET_LOCALES) {
    const note = value[locale];
    if (typeof note === 'string' && note.trim()) notes[locale] = note.slice(0, 2_000);
  }
  return notes;
}

/**
 * B2 and the recomputation of B3 and B7 (12.6): the selection, the plan, tokens and cost with the model of the
 * KI page, the remaining monthly budget (null in demo mode, where every batch costs 0).
 */
export async function estimate(
  ctx: AppContext,
  scope: TranslationJobScope,
  failed?: readonly { key: string; locale: TargetLocale }[],
): Promise<{ dto: TranslationEstimateDto; plan: TranslationBatchPlan[]; selection: PairSelection }> {
  const [availability, notes] = await Promise.all([
    ctx.ai.availability('translations'),
    readStyleNotes(ctx.db),
  ]);
  const selection = selectPairs(ctx.i18n, scope, failed);
  const plan = batches(selection.pairs);
  const glossary = ctx.i18n.glossaryTerms();
  const demo = availability.demo;
  const usage = demo
    ? { inputTokens: 0, outputTokens: 0, costMicros: 0 }
    : estimateUsage({
        model: availability.model,
        plan,
        i18n: ctx.i18n,
        systemFor: (locale) => systemPrompt(locale, glossary, notes[locale] ?? ''),
      });
  const budget = demo ? null : (await ctx.ai.budgetState()).remainingMicros;
  return {
    dto: {
      scope,
      model: availability.model,
      demo,
      keys: selection.pairs.length,
      perLocale: selection.perLocale,
      batches: plan.length,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costMicros: usage.costMicros,
      budgetRemainingMicros: budget,
      legal: selection.legal,
      keptManual: selection.keptManual,
      skipped: selection.skipped,
    },
    plan,
    selection,
  };
}

// --- Validation ---------------------------------------------------------------------------------

const PLACEHOLDER_TOKEN = /\{[A-Za-z][A-Za-z0-9_]*\}/g;
const URL_PATTERN = /https?:\/\/\S+/g;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** URLs, e-mail addresses and digit runs of a text (placeholders left out), for the no-new-content rule. */
function contentOf(text: string): { urls: string[]; emails: string[]; numbers: string[] } {
  const plain = text.replace(PLACEHOLDER_TOKEN, ' ');
  const urls = (plain.match(URL_PATTERN) ?? []).map((u) => u.replace(/[.,;:!?)\]}"']+$/, ''));
  const emails = plain.match(EMAIL_PATTERN) ?? [];
  const numbers = plain.replace(URL_PATTERN, ' ').replace(EMAIL_PATTERN, ' ').match(/\d+/g) ?? [];
  return { urls, emails, numbers };
}

/** Step 6 of 12.5: the first URL, e-mail address or number of the value that the German and English lack. */
function newContent(value: string, source: string, english: string | null): string | null {
  const reference = `${source}\n${english ?? ''}`;
  const known = contentOf(reference);
  const found = contentOf(value);
  for (const url of found.urls) if (!reference.includes(url)) return `new URL ${url}`;
  for (const email of found.emails) if (!reference.includes(email)) return `new e-mail address ${email}`;
  const numbers = new Set(known.numbers);
  for (const n of found.numbers) if (!numbers.has(n)) return `new number ${n}`;
  return null;
}

export type ValidationResult =
  | { ok: true; value: string; fixed: boolean }
  | { ok: false; reason: TranslationFailureReason; detail: string };

/**
 * validateItem, steps 1 to 9 of i18n 12.5, with the predicates of the repository checks and the allowlists of
 * the locale (review finding 15). Cheap structural checks first, so a repair names the most important problem.
 * The language checks are skipped for demo jobs (their "[FR] <German>" would fail them).
 */
export function validateItem(input: {
  key: string;
  locale: TargetLocale;
  source: string;
  english: string | null;
  text: unknown;
  demo: boolean;
  glossary: readonly GlossaryTerm[];
}): ValidationResult {
  const { key, locale, source, english, glossary } = input;
  if (typeof input.text !== 'string')
    return { ok: false, reason: 'missing', detail: 'no answer for this item' };
  if (input.text.trim() === '') return { ok: false, reason: 'empty', detail: 'empty text' };
  const { value, typographyFixed } = prepareValue(locale, source, input.text);

  const placeholders = placeholdersMatch(source, value);
  if (!placeholders.ok) {
    const parts = [
      ...placeholders.missing.map((p) => `missing {${p}}`),
      ...placeholders.extra.map((p) => `extra {${p}}`),
    ];
    if (!placeholders.lineBreaks) {
      parts.push(`${lineBreakCount(value)} line breaks instead of ${lineBreakCount(source)}`);
    }
    return { ok: false, reason: 'placeholders', detail: parts.join(', ') };
  }
  const characters = forbiddenCharacters(value);
  if (characters.length > 0) {
    return { ok: false, reason: 'characters', detail: `forbidden character ${characters.join(', ')}` };
  }
  const content = newContent(value, source, english);
  if (content) return { ok: false, reason: 'content', detail: content };

  if (locale !== 'en') {
    const allow = allowlistFor(locale);
    if (!input.demo) {
      if (looksGerman(value, source, locale) && !allow.germanOk.includes(key)) {
        return { ok: false, reason: 'german', detail: 'looks like German text' };
      }
      const informal = informalWord(value, locale);
      if (informal && !allow.informalOk.includes(key)) {
        return { ok: false, reason: 'formality', detail: `informal word "${informal}"` };
      }
      if (!lengthOk(source, value) && !allow.lengthOk.includes(key)) {
        return { ok: false, reason: 'length', detail: `longer than ${lengthLimit(source)} characters` };
      }
      const terms = glossaryProblems(source, value, locale, glossary);
      if (terms.length > 0 && !allow.glossaryOk.includes(key)) {
        return { ok: false, reason: 'glossary', detail: `glossary term ${terms.join(', ')}` };
      }
    }
    if (locale === 'fr') {
      const problems = typographyProblems(value);
      if (problems.length > 0 && !allow.typographyOk.includes(key)) {
        return { ok: false, reason: 'characters', detail: problems[0]! };
      }
    }
  }
  return { ok: true, value, fixed: typographyFixed };
}

// --- One batch ----------------------------------------------------------------------------------

/** A job-ending error of plan 2.6; the runner ends the job failed with { code, message }. */
export class JobStop extends Error {
  constructor(
    readonly code: TranslationJobErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'JobStop';
  }
}

/** Fixed English messages of the job error codes (plan 2.6). */
export const JOB_ERROR_MESSAGES: Record<Exclude<TranslationJobErrorCode, 'ai_upstream'>, string> & {
  ai_upstream: (reason: string) => string;
} = {
  ai_budget_job: 'The monthly AI budget was used up during the job. Finished batches stay saved.',
  cost_cap: 'Stopped: the job would have cost more than 1.5 times its estimate.',
  ai_not_configured: 'Stopped: AI was switched off during the job.',
  ai_upstream: (reason) => `Stopped: the AI service rejected the key or the account (${reason}).`,
  ai_failed: 'Stopped: three batches in a row failed.',
};

export interface BatchResult {
  saved: { key: string; locale: TargetLocale; value: string; sourceHash: string; fixed: boolean }[];
  failures: TranslationFailure[];
  /** Summed over the calls of the batch: repairs, splits and failed calls (usageOfError) included. */
  tokens: UsageTotals;
  costMicros: number;
}

/** Waits of plan 2.6. */
export const BUSY_WAITS_MS = [5_000, 15_000, 45_000, 120_000, 300_000] as const;
export const TRANSIENT_WAITS_MS = [5_000, 30_000] as const;
export const CONCURRENT_WAIT_MS = 5_000;
/** The platform cap of six live requests frees up quickly; after an hour of waiting the items fail. */
const MAX_CONCURRENT_WAITS = 720;

/** The failures a repair round may fix (12.7). */
const REPAIRABLE = new Set<TranslationFailureReason>([
  'placeholders',
  'characters',
  'content',
  'german',
  'formality',
  'length',
  'glossary',
]);

interface WorkItem extends BatchItem {
  hash: string;
}

type CallOutcome =
  | { kind: 'ok'; data: TranslationBatchAnswer }
  | { kind: 'incomplete' | 'refusal' | 'transient' | 'output' | 'busy' | 'request' | 'error' };

/** setTimeout honouring the signal; rejects with AiCancelled when it aborts. */
export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AiCancelled());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AiCancelled());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Translates one planned batch (i18n 12.4 to 12.7): calls structured() with countsForUser false and no
 * max_tokens retry, validates every item, runs one repair round for the fixable failures, splits on cut-off
 * answers, refusals and lasting errors, and maps the errors by plan 2.6. Throws JobStop for the job-ending
 * errors and AiCancelled when the job's signal aborts (the batch in flight is then discarded).
 */
export async function translateBatch(
  ctx: AppContext,
  input: {
    batch: TranslationBatchPlan;
    actor: { userId: string | null };
    demo: boolean;
    glossary: readonly GlossaryTerm[];
    style: string; // admin style notes of the locale
    signal: AbortSignal;
    sleep: JobRunnerOptions['sleep'];
  },
): Promise<BatchResult> {
  const { batch, signal } = input;
  const locale = batch.locale;
  const sleep = input.sleep ?? defaultSleep;
  const system = systemPrompt(locale, input.glossary, input.style);
  const result: BatchResult = {
    saved: [],
    failures: [],
    tokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    costMicros: 0,
  };
  const items: WorkItem[] = batchItems(ctx.i18n, batch).map((item) => ({
    ...item,
    hash: ctx.i18n.source(item.key as ServerTranslationKey).hash,
  }));

  const addUsage = (usage: { tokens: UsageTotals; costMicros: number } | null) => {
    if (!usage) return;
    result.tokens.inputTokens += usage.tokens.inputTokens;
    result.tokens.outputTokens += usage.tokens.outputTokens;
    result.tokens.cacheReadTokens += usage.tokens.cacheReadTokens;
    result.tokens.cacheWriteTokens += usage.tokens.cacheWriteTokens;
    result.costMicros += usage.costMicros;
  };
  const fail = (list: readonly WorkItem[], reason: TranslationFailureReason, detail: string | null) => {
    for (const item of list) result.failures.push({ key: item.key, locale, reason, detail });
  };
  const wait = async (ms: number) => {
    if (signal.aborted) throw new AiCancelled();
    await sleep(ms, signal);
    if (signal.aborted) throw new AiCancelled();
  };
  const halves = (list: WorkItem[]) => {
    const middle = Math.ceil(list.length / 2);
    return [list.slice(0, middle), list.slice(middle)];
  };

  /** One call with the waits and retries of plan 2.6; the outcome decides about splitting. */
  async function attempt(list: WorkItem[]): Promise<CallOutcome> {
    const user = userMessage({
      locale,
      items: list.map(({ hash: _hash, ...item }) => item),
    });
    let busy = 0;
    let transient = 0;
    let concurrent = 0;
    for (;;) {
      if (signal.aborted) throw new AiCancelled();
      try {
        const answer = await ctx.ai.structured({
          feature: 'translations',
          scope: 'platform',
          orgId: null,
          countsForUser: false,
          retryOnMaxTokens: false,
          actor: input.actor,
          system,
          user,
          schema: TranslationBatchOutput,
          signal,
        });
        addUsage(answer);
        return { kind: 'ok', data: answer.data };
      } catch (err) {
        addUsage(usageOfError(err));
        if (err instanceof AiCancelled || signal.aborted) throw new AiCancelled();
        if (!(err instanceof AppError)) {
          ctx.log.error({ err, locale, keys: list.length }, 'translation batch failed unexpectedly');
          return { kind: 'error' };
        }
        const details = (err.details ?? {}) as { limit?: unknown; reason?: unknown };
        switch (err.code) {
          case 'ai_limit':
            if (details.limit === 'budget')
              throw new JobStop('ai_budget_job', JOB_ERROR_MESSAGES.ai_budget_job);
            if (details.limit === 'concurrent') {
              // Other AI work holds the platform slots: wait, not counted as an attempt.
              if (concurrent++ < MAX_CONCURRENT_WAITS) {
                await wait(CONCURRENT_WAIT_MS);
                continue;
              }
              return { kind: 'busy' };
            }
            // Cannot occur with countsForUser false; treated like a server error.
            if (transient < TRANSIENT_WAITS_MS.length) {
              await wait(TRANSIENT_WAITS_MS[transient++]!);
              continue;
            }
            return { kind: 'transient' };
          case 'ai_busy':
            if (busy < BUSY_WAITS_MS.length) {
              await wait(BUSY_WAITS_MS[busy++]!);
              continue;
            }
            return { kind: 'busy' };
          case 'ai_timeout':
            if (transient < TRANSIENT_WAITS_MS.length) {
              await wait(TRANSIENT_WAITS_MS[transient++]!);
              continue;
            }
            return { kind: 'transient' };
          case 'ai_upstream': {
            const reason = typeof details.reason === 'string' ? details.reason : 'server';
            if (reason === 'server' || reason === 'network') {
              if (transient < TRANSIENT_WAITS_MS.length) {
                await wait(TRANSIENT_WAITS_MS[transient++]!);
                continue;
              }
              return { kind: 'transient' };
            }
            if (reason === 'output') return { kind: 'output' };
            if (reason === 'request') {
              // A malformed request is a bug of ours: logged with the request id of the usage row.
              ctx.log.error(
                { usageId: usageOfError(err)?.usageId ?? null, locale, keys: list.length },
                'translation batch request was rejected',
              );
              return { kind: 'request' };
            }
            throw new JobStop('ai_upstream', JOB_ERROR_MESSAGES.ai_upstream(reason));
          }
          case 'ai_incomplete':
            return { kind: 'incomplete' };
          case 'ai_refusal':
            return { kind: 'refusal' };
          case 'not_found': {
            // structured() asserts the feature first: AI may have been switched off during the job.
            const availability = await ctx.ai.availability('translations');
            if (!availability.available) {
              throw new JobStop('ai_not_configured', JOB_ERROR_MESSAGES.ai_not_configured);
            }
            return { kind: 'error' };
          }
          default:
            ctx.log.warn({ code: err.code, locale }, 'translation batch failed');
            return { kind: 'error' };
        }
      }
    }
  }

  /** Validates an answer; the fixable failures get one repair round (12.7). */
  async function accept(list: WorkItem[], data: TranslationBatchAnswer, repaired: boolean): Promise<void> {
    const answers = new Map<string, string>();
    for (const item of data.items) if (!answers.has(item.id)) answers.set(item.id, item.text);
    const repair: WorkItem[] = [];
    for (const item of list) {
      const text = answers.get(item.id);
      const check = validateItem({
        key: item.key,
        locale,
        source: item.de,
        english: item.en,
        text,
        demo: input.demo,
        glossary: input.glossary,
      });
      if (check.ok) {
        result.saved.push({
          key: item.key,
          locale,
          value: check.value,
          sourceHash: item.hash,
          fixed: check.fixed,
        });
      } else if (!repaired && REPAIRABLE.has(check.reason) && typeof text === 'string') {
        repair.push({ ...item, previous: text, problem: check.detail });
      } else {
        result.failures.push({ key: item.key, locale, reason: check.reason, detail: check.detail });
      }
    }
    if (repair.length > 0) await run(repair, { splitOnce: true, repaired: true });
  }

  async function run(list: WorkItem[], opts: { splitOnce: boolean; repaired: boolean }): Promise<void> {
    if (list.length === 0) return;
    const outcome = await attempt(list);
    switch (outcome.kind) {
      case 'ok':
        return accept(list, outcome.data, opts.repaired);
      case 'incomplete':
        // Cut at max_tokens: smaller batches, down to one item.
        if (list.length > 1) {
          for (const half of halves(list)) await run(half, opts);
          return;
        }
        return fail(list, 'error', 'the answer was cut off');
      case 'refusal':
        // Isolate the refused item; the others are saved.
        if (list.length > 1) {
          for (const half of halves(list)) await run(half, opts);
          return;
        }
        return fail(list, 'refusal', null);
      case 'transient':
      case 'output':
        if (opts.splitOnce && list.length > 1) {
          for (const half of halves(list)) await run(half, { ...opts, splitOnce: false });
          return;
        }
        return fail(list, 'error', outcome.kind === 'output' ? 'no valid answer' : 'the request failed');
      default:
        return fail(
          list,
          'error',
          outcome.kind === 'busy' ? 'the AI service was busy' : 'the request failed',
        );
    }
  }

  await run(items, { splitOnce: true, repaired: false });
  return result;
}
