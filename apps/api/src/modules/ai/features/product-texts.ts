import { z } from 'zod';
import { LOCALES, type AiProductTextsResult, type Locale } from '@weblion/shared';
import { thirdParty } from '../prompts';
import { callFeature, userTurn, type FeatureRun } from './common';

/**
 * Product name and description written or translated in up to five languages (ai 10.6). Nothing is read from the
 * database; the result only fills the product dialog, and saving is the normal product save with its audit entry.
 * Strict schemas reject records, so the texts come back as a list of { locale, name, description }.
 */

export const productTextsBody = z.object({
  mode: z.enum(['write', 'translate']),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(1000).nullable(),
  module: z.string().max(50).nullable(),
  interval: z.string().max(50).nullable(),
  notes: z.string().max(2000).nullable(),
  locales: z.array(z.enum(LOCALES)).min(1).max(5),
  locale: z.enum(LOCALES),
});
export type ProductTextsBody = z.infer<typeof productTextsBody>;

export const productTextsOutput = z.object({
  texts: z.array(
    z.object({
      locale: z.enum(LOCALES),
      name: z.string(),
      description: z.string().nullable(),
    }),
  ),
});

/** The product routes' limits (name 1 to 200 characters, description at most 1,000). */
const NAME_MAX = 200;
const DESCRIPTION_MAX = 1000;

export async function runProductTexts(
  run: FeatureRun,
  body: ProductTextsBody,
): Promise<AiProductTextsResult> {
  // translate: target languages only; German is the source.
  const wanted: Locale[] = [
    ...new Set(body.mode === 'translate' ? body.locales.filter((l) => l !== 'de') : body.locales),
  ];
  const draft = {
    mode: body.mode,
    name: body.name,
    description: body.description,
    module: body.module,
    interval: body.interval,
    notes: body.notes,
    languages: wanted,
  };
  const user = userTurn(
    run,
    null,
    `Return the product texts for exactly these languages: ${wanted.join(', ')}.`,
    thirdParty('product_draft', draft),
  );
  const { data, meta } = await callFeature(run, 'product_texts', user, productTextsOutput);
  const texts: AiProductTextsResult['texts'] = {};
  for (const t of data.texts) {
    if (!wanted.includes(t.locale) || texts[t.locale]) continue;
    const name = t.name.trim().slice(0, NAME_MAX);
    if (!name) continue;
    const description = t.description?.trim() ? t.description.trim().slice(0, DESCRIPTION_MAX) : null;
    texts[t.locale] = { name, description };
  }
  return { texts, meta };
}
