import { sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  isLegalKey,
  LOCALES,
  type Locale,
  type ServerTranslationKey,
  type TranslationCheckName,
  type TranslationImportResultDto,
  type TranslationImportSkip,
} from '@weblion/shared';
import { checkValue, placeholdersMatch } from '@weblion/shared/i18n/checks';
import type { DbOrTx } from '../db/client';
import { translationOverrides } from '../db/schema';
import { importInvalid } from '../modules/i18n/errors';
import { checkSource, currentHash, forbiddenCharacters, prepareValue } from './entries';
import { LOCALE_FORMAT, OVERRIDES_FORMAT } from './export';
import type { I18nService } from './service';

/**
 * The import of A15 (i18n 16.2): both export formats, the same checks as a cell save, and a dry run that writes
 * nothing. Rows that pass are written in one transaction as manual edits; AI rows of an overrides file keep
 * their origin and reviewed flag, so a move between installations never turns unchecked AI texts into checked
 * ones.
 */

const MAX_VALUE = 20_000;
const MAX_LISTED = 500;

const overridesFile = z.object({
  format: z.literal(OVERRIDES_FORMAT),
  version: z.literal(1),
  entries: z
    .array(
      z.object({
        key: z.string().min(1).max(300),
        locale: z.enum(LOCALES),
        value: z.string().max(MAX_VALUE),
        origin: z.enum(['manual', 'ai']).optional(),
        reviewed: z.boolean().optional(),
        sourceHash: z
          .string()
          .regex(/^[0-9a-f]{16}$/)
          .optional(),
      }),
    )
    .max(100_000),
});

const localeFile = z.object({
  format: z.literal(LOCALE_FORMAT),
  version: z.literal(1),
  locale: z.enum(LOCALES),
  entries: z.record(
    z.string().min(1).max(300),
    z.object({ value: z.string().max(MAX_VALUE).nullable().optional() }),
  ),
});

const importFile = z.discriminatedUnion('format', [overridesFile, localeFile]);

/** One value of a file, before the checks. */
export interface ImportRow {
  key: string;
  locale: Locale;
  value: string;
  origin: 'manual' | 'ai';
  /** The file's reviewed flag (overrides format only). */
  reviewed: boolean | null;
  /** The file's source hash (overrides format only): staleness travels with the text. */
  sourceHash: string | null;
}

/** Step 1: the shape of either format; 400 import_invalid with at most 20 problems otherwise. */
export function parseImportFile(data: unknown): ImportRow[] {
  const parsed = importFile.safeParse(data);
  if (!parsed.success) {
    throw importInvalid(
      parsed.error.issues.map((i) => `${i.path.length > 0 ? `${i.path.join('.')}: ` : ''}${i.message}`),
    );
  }
  const file = parsed.data;
  if (file.format === OVERRIDES_FORMAT) {
    return file.entries.map((e) => ({
      key: e.key,
      locale: e.locale,
      value: e.value,
      origin: e.origin ?? 'manual',
      reviewed: e.reviewed ?? null,
      sourceHash: e.sourceHash ?? null,
    }));
  }
  const rows: ImportRow[] = [];
  for (const [key, entry] of Object.entries(file.entries)) {
    // Not filled in by the translator: nothing to import.
    if (typeof entry.value !== 'string' || entry.value.trim() === '') continue;
    rows.push({
      key,
      locale: file.locale,
      value: entry.value,
      origin: 'manual',
      reviewed: null,
      sourceHash: null,
    });
  }
  return rows;
}

/** A row that passed and is written. */
export interface ImportWrite {
  key: string;
  locale: Locale;
  value: string;
  origin: 'manual' | 'ai';
  reviewed: boolean;
  sourceHash: string;
  created: boolean;
}

/**
 * Step 2: every row through the checks of a save. Unknown keys, empty values, failed hard checks, AI texts for
 * legal keys and manual or reviewed cells (without replaceManual) are skipped; equal values are unchanged; the soft checks are
 * warnings only (a human wrote the text).
 */
export function planImport(
  i18n: I18nService,
  rows: readonly ImportRow[],
  options: { dryRun: boolean; replaceManual: boolean; markReviewed: boolean },
): { result: TranslationImportResultDto; writes: ImportWrite[]; skippedTotal: number } {
  const result: TranslationImportResultDto = {
    dryRun: options.dryRun,
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: [],
    warnings: [],
  };
  let skippedCount = 0;
  const skip = (row: ImportRow, reason: TranslationImportSkip, detail?: string) => {
    skippedCount++;
    if (result.skipped.length < MAX_LISTED) {
      result.skipped.push({ key: row.key, locale: row.locale, reason, ...(detail ? { detail } : {}) });
    }
  };
  // The same cell twice in one file: the last one counts.
  const last = new Map<string, ImportRow>();
  for (const row of rows) last.set(`${row.locale}\u0000${row.key}`, row);

  const writes: ImportWrite[] = [];
  for (const row of last.values()) {
    if (!i18n.catalog.has(row.key)) {
      skip(row, 'unknown_key');
      continue;
    }
    const key = row.key as ServerTranslationKey;
    const source = checkSource(i18n, key, row.locale);
    const { value } = prepareValue(row.locale, source, row.value);
    // The rule of A4: an empty text would blank the label, button or notice in that language.
    if (value.trim() === '') {
      skip(row, 'empty');
      continue;
    }
    const placeholders = placeholdersMatch(source, value);
    if (!placeholders.ok) {
      const detail = [
        ...placeholders.missing.map((p) => `missing {${p}}`),
        ...placeholders.extra.map((p) => `extra {${p}}`),
        ...(placeholders.lineBreaks ? [] : ['line breaks differ']),
      ].join(', ');
      skip(row, 'placeholders', detail);
      continue;
    }
    const characters = forbiddenCharacters(value, i18n.catalog.sectionOf(key));
    if (characters.length > 0) {
      skip(row, 'characters', characters.join(', '));
      continue;
    }
    if (row.origin === 'ai' && isLegalKey(key)) {
      skip(row, 'legal_ai');
      continue;
    }
    const existing = i18n.override(row.locale, key);
    if (value === i18n.cell(row.locale, key).value) {
      result.unchanged++;
      continue;
    }
    if (
      existing &&
      !existing.demo &&
      (existing.origin === 'manual' || existing.reviewed) &&
      existing.value !== value &&
      !options.replaceManual
    ) {
      skip(row, 'manual');
      continue;
    }
    const soft: TranslationCheckName[] = checkValue({
      key,
      source,
      value,
      locale: row.locale,
      glossary: i18n.glossaryTerms(),
    }).soft;
    if (soft.length > 0 && result.warnings.length < MAX_LISTED) {
      result.warnings.push({ key, locale: row.locale, checks: soft });
    }
    const created = !existing;
    if (created) result.created++;
    else result.updated++;
    writes.push({
      key,
      locale: row.locale,
      value,
      origin: row.origin,
      // AI rows keep their flag; manual rows are reviewed when asked or when the file says so.
      reviewed: row.origin === 'ai' ? row.reviewed === true : options.markReviewed || row.reviewed === true,
      sourceHash: row.sourceHash ?? currentHash(i18n, key, row.locale),
      created,
    });
  }
  // skippedTotal stays exact although the list is capped at 500.
  return { result, writes, skippedTotal: skippedCount };
}

/** Step 3: one transaction for every accepted row (upserts of 500 rows at a time). */
export async function applyImport(tx: DbOrTx, writes: readonly ImportWrite[], userId: string): Promise<void> {
  const now = new Date();
  for (let i = 0; i < writes.length; i += 500) {
    const chunk = writes.slice(i, i + 500);
    await tx
      .insert(translationOverrides)
      .values(
        chunk.map((w) => ({
          key: w.key,
          locale: w.locale,
          value: w.value,
          origin: w.origin,
          reviewed: w.reviewed,
          sourceHash: w.sourceHash,
          demo: false,
          updatedBy: userId,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [translationOverrides.key, translationOverrides.locale],
        set: {
          value: sql`excluded.value`,
          origin: sql`excluded.origin`,
          reviewed: sql`excluded.reviewed`,
          sourceHash: sql`excluded.source_hash`,
          demo: sql`excluded.demo`,
          updatedBy: sql`excluded.updated_by`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
}
