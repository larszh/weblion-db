import { asc, desc } from 'drizzle-orm';
import { DEFAULT_GLOSSARY, type GlossaryTerm } from '@weblion/shared/i18n/glossary';
import type { DbOrTx } from '../db/client';
import { translationGlossary } from '../db/schema';

/**
 * Inserts the DEFAULT_GLOSSARY terms that are missing (by lower(term), the unique index) with built_in = true.
 * One `insert ... on conflict do nothing`, so two API processes starting at once cannot fail on the index;
 * existing rows are never updated, so an admin's edit of a built-in term survives every start (i18n 14.2).
 */
export async function seedGlossary(db: DbOrTx): Promise<void> {
  if (DEFAULT_GLOSSARY.length === 0) return;
  await db
    .insert(translationGlossary)
    .values(
      DEFAULT_GLOSSARY.map((t) => ({
        term: t.term,
        keep: t.keep,
        translations: t.translations,
        note: t.note ?? null,
        builtIn: true,
      })),
    )
    .onConflictDoNothing();
}

/** The table as GlossaryTerm[] for the translator and the checks: built-in first, then by term. */
export async function loadGlossary(db: DbOrTx): Promise<GlossaryTerm[]> {
  const rows = await db
    .select({
      term: translationGlossary.term,
      keep: translationGlossary.keep,
      translations: translationGlossary.translations,
      note: translationGlossary.note,
    })
    .from(translationGlossary)
    .orderBy(desc(translationGlossary.builtIn), asc(translationGlossary.term));
  return rows.map((r) => ({ term: r.term, keep: r.keep, translations: r.translations, note: r.note }));
}
