import { and, eq, inArray } from 'drizzle-orm';
import {
  isTargetLocale,
  lineBreakCount,
  LOCALES,
  type Locale,
  type ServerTranslationKey,
  type TranslationCleanupInput,
  type TranslationCleanupResultDto,
} from '@weblion/shared';
import type { I18nCatalog } from '@weblion/shared/i18n/catalog';
import { fixFrenchTypography, hasEmDash, hasSharpS, placeholdersMatch } from '@weblion/shared/i18n/checks';
import type { DbOrTx } from '../db/client';
import { translationOverrides } from '../db/schema';
import { forbiddenCharacter, notStale, placeholderMismatch } from '../modules/i18n/errors';
import { sourceHash } from './hash';
import type { I18nService } from './service';

/**
 * Writes of translation_overrides (i18n 14.2). Every caller runs ctx.i18n.reload() after its transaction
 * committed, so the change is live at once on this instance and within 15 s on the others.
 */

/** Inserts or replaces the override of one cell. */
export async function saveOverride(
  tx: DbOrTx,
  input: {
    key: string;
    locale: Locale;
    value: string;
    origin: 'manual' | 'ai';
    reviewed: boolean;
    sourceHash: string;
    demo?: boolean;
    userId: string | null;
  },
): Promise<void> {
  const values = {
    value: input.value,
    origin: input.origin,
    reviewed: input.reviewed,
    sourceHash: input.sourceHash,
    demo: input.demo ?? false,
    updatedBy: input.userId,
    // Set explicitly on update too: the refresh signature of I18nService compares max(updated_at).
    updatedAt: new Date(),
  };
  await tx
    .insert(translationOverrides)
    .values({ key: input.key, locale: input.locale, ...values })
    .onConflictDoUpdate({ target: [translationOverrides.key, translationOverrides.locale], set: values });
}

/** Deletes the override; false when there was none. */
export async function revertOverride(tx: DbOrTx, key: string, locale: Locale): Promise<boolean> {
  const rows = await tx
    .delete(translationOverrides)
    .where(and(eq(translationOverrides.key, key), eq(translationOverrides.locale, locale)))
    .returning({ key: translationOverrides.key });
  return rows.length > 0;
}

/** false when there is no override. */
export async function setReviewed(
  tx: DbOrTx,
  key: string,
  locale: Locale,
  reviewed: boolean,
  userId: string,
): Promise<boolean> {
  const rows = await tx
    .update(translationOverrides)
    .set({ reviewed, updatedBy: userId, updatedAt: new Date() })
    .where(and(eq(translationOverrides.key, key), eq(translationOverrides.locale, locale)))
    .returning({ key: translationOverrides.key });
  return rows.length > 0;
}

/**
 * The hash a saved value of the cell is written against: the effective German text for a translation, the
 * compiled German for a German edit (so a later deploy that changes the German marks the edit stale, i18n 8.1).
 */
export function currentHash(i18n: I18nService, key: ServerTranslationKey, locale: Locale): string {
  if (locale === 'de') return sourceHash(i18n.catalog.bundles.de[key] ?? key);
  return i18n.source(key).hash;
}

/** The German text a value of the cell is checked against (placeholders, line breaks, length). */
export function checkSource(i18n: I18nService, key: ServerTranslationKey, locale: Locale): string {
  // A German edit keeps the placeholders of the code, which passes exactly those parameters.
  if (locale === 'de') return i18n.catalog.bundles.de[key] ?? key;
  return i18n.source(key).text;
}

/**
 * Steps 2 and 3 of i18n 12.5 for every value that is saved (A4, import, Mass Translate): line breaks as \n,
 * NFC, outer whitespace trimmed unless the German text has it, and the Swiss French spacing for fr.
 */
export function prepareValue(
  locale: Locale,
  source: string,
  value: string,
): { value: string; typographyFixed: boolean } {
  let text = value.replace(/\r\n?/g, '\n').normalize('NFC');
  const lead = /^\s/.test(source);
  const trail = /\s$/.test(source);
  if (!lead) text = text.replace(/^\s+/, '');
  if (!trail) text = text.replace(/\s+$/, '');
  if (locale !== 'fr') return { value: text, typographyFixed: false };
  const fixed = fixFrenchTypography(text);
  return { value: fixed, typographyFixed: fixed !== text };
}

/** Code points of the forbidden characters in a value (checks 7 and 8), as U+XXXX. */
export function forbiddenCharacters(value: string): string[] {
  const found: string[] = [];
  // The capital sharp s counts as a sharp s (checks.ts); the message names U+00DF either way.
  if (hasSharpS(value)) found.push('U+00DF');
  if (hasEmDash(value)) found.push('U+2014');
  return found;
}

/**
 * The hard checks of a save (i18n 19.4: 2, 7, 8): throws 400 placeholder_mismatch with the lists (and the line
 * breaks when only they differ) or 400 forbidden_character with the code points.
 */
export function assertHardChecks(source: string, value: string): void {
  const placeholders = placeholdersMatch(source, value);
  if (!placeholders.ok) {
    throw placeholderMismatch({
      missing: placeholders.missing,
      extra: placeholders.extra,
      ...(placeholders.lineBreaks
        ? {}
        : { lineBreaks: { expected: lineBreakCount(source), actual: lineBreakCount(value) } }),
    });
  }
  const characters = forbiddenCharacters(value);
  if (characters.length > 0) throw forbiddenCharacter(characters);
}

/**
 * A7 (i18n 14.2), "Als aktuell bestätigen": an override gets the current hash and reviewed = true; a stale
 * compiled value gets an override with the same text (origin manual, reviewed, current hash), which export and
 * i18n:apply turn into a current stamp. 409 not_stale when the cell is not stale.
 */
export async function confirmCurrent(
  tx: DbOrTx,
  i18n: I18nService,
  key: string,
  locale: Locale,
  userId: string,
): Promise<void> {
  if (!i18n.catalog.has(key)) throw notStale();
  const hash = currentHash(i18n, key, locale);
  const row = i18n.override(locale, key);
  // A demo row that is not served is a leftover; the cell is the compiled text then.
  if (row && (!row.demo || i18n.isServable(row))) {
    if (row.sourceHash === hash) throw notStale();
    await tx
      .update(translationOverrides)
      .set({ sourceHash: hash, reviewed: true, updatedBy: userId, updatedAt: new Date() })
      .where(and(eq(translationOverrides.key, key), eq(translationOverrides.locale, locale)));
    return;
  }
  const cell = i18n.cell(locale, key);
  if (cell.state !== 'stale' || cell.origin !== 'repo' || cell.compiled === null) throw notStale();
  await saveOverride(tx, {
    key,
    locale,
    value: cell.compiled,
    origin: 'manual',
    reviewed: true,
    sourceHash: hash,
    userId,
  });
}

/**
 * An override the repository already holds (A8 "same as compiled" and its count in A2). For German the value
 * is enough. A translation must also carry the source hash of its compiled stamp: an A7 confirmation of a stale
 * compiled value has the same text with a newer hash, and only export and i18n:apply carry that into the
 * repository; deleting it before would make the cell stale again.
 */
export function sameAsCompiled(
  catalog: I18nCatalog,
  row: { key: string; locale: Locale; value: string; sourceHash: string },
): boolean {
  if (!catalog.has(row.key)) return false;
  if (catalog.bundles[row.locale][row.key] !== row.value) return false;
  if (!isTargetLocale(row.locale)) return true;
  return catalog.stamps[row.locale][row.key]?.[0] === row.sourceHash;
}

/**
 * A8 (i18n 14.2): deletes orphan overrides (the key is gone), overrides equal to the compiled value (the export
 * reached the repository) and, with `demo`, every demo row (plan O11). A row is counted once, in this order:
 * orphan, demo, same as compiled. `dryRun` only counts.
 */
export async function cleanup(
  tx: DbOrTx,
  i18n: I18nService,
  input: TranslationCleanupInput,
): Promise<TranslationCleanupResultDto> {
  const { catalog } = i18n;
  const rows = await tx
    .select({
      key: translationOverrides.key,
      locale: translationOverrides.locale,
      value: translationOverrides.value,
      sourceHash: translationOverrides.sourceHash,
      demo: translationOverrides.demo,
    })
    .from(translationOverrides)
    .for('update');
  const result: TranslationCleanupResultDto = {
    orphans: 0,
    sameAsCompiled: 0,
    demo: 0,
    dryRun: !!input.dryRun,
  };
  const doomed = new Map<Locale, string[]>(LOCALES.map((l) => [l, []]));
  for (const row of rows) {
    let kind: 'orphans' | 'demo' | 'sameAsCompiled' | null = null;
    if (!catalog.has(row.key)) kind = input.orphans ? 'orphans' : null;
    else if (row.demo) kind = input.demo ? 'demo' : null;
    else if (sameAsCompiled(catalog, row)) kind = input.sameAsCompiled ? 'sameAsCompiled' : null;
    if (!kind) continue;
    result[kind]++;
    doomed.get(row.locale)?.push(row.key);
  }
  if (input.dryRun) return result;
  for (const [locale, keys] of doomed) {
    for (let i = 0; i < keys.length; i += 1000) {
      await tx
        .delete(translationOverrides)
        .where(
          and(
            eq(translationOverrides.locale, locale),
            inArray(translationOverrides.key, keys.slice(i, i + 1000)),
          ),
        );
    }
  }
  return result;
}

/**
 * In the transaction of PUT /admin/ai/key (ai 5.4, plan O11): with a real key the demo emulator is gone, so
 * its pseudo translations must not stay. Returns the number of rows deleted.
 */
export async function deleteDemoOverrides(tx: DbOrTx): Promise<number> {
  const rows = await tx
    .delete(translationOverrides)
    .where(eq(translationOverrides.demo, true))
    .returning({ key: translationOverrides.key });
  return rows.length;
}
