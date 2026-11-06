// Type-only imports: no dictionary reaches a bundle through these types (i18n 2.2).
import type { de } from './de';
import type { serverDe } from './server';
import type { SECTIONS } from './sections';

/** Web keys (14 sections). An email.* or pdf.* key in the web is a type error. */
export type TranslationKey = keyof typeof de;
/** All 16 sections, for the API (ctx.i18n.t, the mail translator, the PDF). */
export type ServerTranslationKey = keyof typeof serverDe;
export type Dictionary = Record<TranslationKey, string>;
export type PartialDictionary = Partial<Dictionary>;
export type ServerDictionary = Record<ServerTranslationKey, string>;
export type SectionName = (typeof SECTIONS)[number];
