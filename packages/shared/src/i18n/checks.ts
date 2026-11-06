import { LEGAL_KEYS, type TranslationCheckName } from '../translations';
import { allowlist as frA } from './allowlists/fr/a';
import { allowlist as frB } from './allowlists/fr/b';
import { allowlist as frC } from './allowlists/fr/c';
import { allowlist as itA } from './allowlists/it/a';
import { allowlist as itB } from './allowlists/it/b';
import { allowlist as itC } from './allowlists/it/c';
import { allowlist as nlA } from './allowlists/nl/a';
import { allowlist as nlB } from './allowlists/nl/b';
import { allowlist as nlC } from './allowlists/nl/c';
import type { GlossaryTerm } from './glossary';
import type { Locale, TargetLocale } from './locales';
import { comparePlaceholders, lineBreakCount } from './placeholders';

/**
 * The automated checks 1 to 11 of the translation guide (i18n 19.4). The same predicates run in the repository
 * test (i18n.test.ts), the admin save (A4), the import (A15), i18n:apply and the Mass Translate validator
 * (i18n 12.5), so a translation passes the same rules wherever it comes from.
 */

// --- Allowlists ---------------------------------------------------------------------------------

/** Keys for which a heuristic check is a known false positive; each entry has a reason comment. */
export interface Allowlist {
  germanOk?: readonly string[]; // check 3
  informalOk?: readonly string[]; // check 4
  lengthOk?: readonly string[]; // check 5
  glossaryOk?: readonly string[]; // check 6
  typographyOk?: readonly string[]; // check 11
}

/** The group files of each locale (plan 7.1: groups a, b, c). English has none. */
export const ALLOWLIST_FILES: Record<'fr' | 'it' | 'nl', Record<'a' | 'b' | 'c', Allowlist>> = {
  fr: { a: frA, b: frB, c: frC },
  it: { a: itA, b: itB, c: itC },
  nl: { a: nlA, b: nlB, c: nlC },
};

const ALLOWLIST_FIELDS = ['germanOk', 'informalOk', 'lengthOk', 'glossaryOk', 'typographyOk'] as const;

/** The three group files of a locale merged; en: all empty. */
export function allowlistFor(locale: TargetLocale): Required<Allowlist> {
  const merged = { germanOk: [], informalOk: [], lengthOk: [], glossaryOk: [], typographyOk: [] } as {
    [K in keyof Allowlist]-?: string[];
  };
  if (locale === 'en') return merged;
  for (const file of Object.values(ALLOWLIST_FILES[locale])) {
    for (const field of ALLOWLIST_FIELDS) merged[field].push(...(file[field] ?? []));
  }
  return merged;
}

// --- Check 1: key parity ------------------------------------------------------------------------

/** German keys without a value in the bundle. */
export function missingKeys(
  source: Readonly<Record<string, string>>,
  bundle: Readonly<Record<string, string | undefined>>,
): string[] {
  return Object.keys(source).filter((key) => typeof bundle[key] !== 'string');
}

/** Bundle keys that German does not have. */
export function unknownKeys(
  source: Readonly<Record<string, string>>,
  bundle: Readonly<Record<string, string | undefined>>,
): string[] {
  return Object.keys(bundle).filter((key) => !Object.prototype.hasOwnProperty.call(source, key));
}

/** Keys defined in more than one section (the aggregators would let the later one win silently). */
export function duplicateKeys(
  sections: Readonly<Record<string, Readonly<Record<string, string>>>>,
): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const section of Object.values(sections)) {
    for (const key of Object.keys(section)) {
      if (seen.has(key)) duplicates.add(key);
      seen.add(key);
    }
  }
  return [...duplicates];
}

// --- Check 2: placeholders and line breaks ------------------------------------------------------

/** Same multiset of {name} placeholders as German; lineBreaks: the same number of \n as German. */
export function placeholdersMatch(
  source: string,
  value: string,
): { ok: boolean; missing: string[]; extra: string[]; lineBreaks: boolean } {
  const { missing, extra } = comparePlaceholders(source, value);
  const lineBreaks = lineBreakCount(source) === lineBreakCount(value);
  return { ok: missing.length === 0 && extra.length === 0 && lineBreaks, missing, extra, lineBreaks };
}

// --- Check 3: leftover German -------------------------------------------------------------------

const PLACEHOLDER_TOKEN = /\{[A-Za-z][A-Za-z0-9_]*\}/g;
const WORD = /\p{L}+/gu;

/** German words that rarely occur in the other languages; matched as whole words. */
const GERMAN_MARKERS = [
  'und',
  'oder',
  'nicht',
  'der',
  'das',
  'ist',
  'sind',
  'wird',
  'werden',
  'mit',
  'für',
  'von',
  'bei',
  'auf',
  'kein',
  'keine',
  'bitte',
  'wählen',
  'löschen',
  'speichern',
  'auch',
  'wenn',
  'noch',
  'nur',
  'über',
  'zum',
  'zur',
  'den',
  'dem',
  'einen',
  'wurde',
  'haben',
  'hat',
  'können',
  'müssen',
];
/** Formal pronouns count only capitalized: lowercase "sie" or "ihr" is no sign of a German leftover. */
const GERMAN_CAPITALIZED_MARKERS = ['Sie', 'Ihr', 'Ihre', 'Ihren', 'Ihrem', 'Ihrer'];
/** Marker words that are ordinary words of a target language. */
const NOT_GERMAN_IN: Record<TargetLocale, readonly string[]> = {
  en: ['hat', 'den'],
  fr: [],
  it: [],
  nl: ['den', 'der', 'werden', 'noch'],
};

function words(text: string): string[] {
  return text.replace(PLACEHOLDER_TOKEN, ' ').match(WORD) ?? [];
}

function germanMarkersIn(text: string, locale: TargetLocale): Set<string> {
  const skip = new Set(NOT_GERMAN_IN[locale]);
  const found = new Set<string>();
  for (const word of words(text)) {
    if (GERMAN_CAPITALIZED_MARKERS.includes(word)) found.add(word);
    const lower = word.toLowerCase();
    if (GERMAN_MARKERS.includes(lower) && !skip.has(lower)) found.add(lower);
  }
  return found;
}

/**
 * A German leftover: an ä (any target), an ö or ü (fr, it, en; Dutch uses the diaeresis), two or more distinct
 * German marker words, or a value equal to the German text with three or more words of which one is a marker.
 * Applied to fr, it and nl (en shares too many words with German, i18n 19.4).
 */
export function looksGerman(value: string, source: string, locale: TargetLocale): boolean {
  const text = value.replace(PLACEHOLDER_TOKEN, ' ');
  if (/[äÄ]/.test(text)) return true;
  if (locale !== 'nl' && /[öÖüÜ]/.test(text)) return true;
  const markers = germanMarkersIn(value, locale);
  if (markers.size >= 2) return true;
  if (value.trim() === source.trim() && words(value).length >= 3 && markers.size >= 1) return true;
  return false;
}

// --- Check 4: informal address ------------------------------------------------------------------

const INFORMAL_WORDS: Record<TargetLocale, readonly string[]> = {
  en: [],
  fr: ['tu', 'te', 'toi', 'ton', 'ta', 'tes'],
  it: ['tu', 'ti', 'tuo', 'tua', 'tuoi', 'tue'],
  nl: ['je', 'jij', 'jou', 'jouw', 'jullie'],
};

/** The first informal word of the value (whole words, case-insensitive), or null. */
export function informalWord(value: string, locale: TargetLocale): string | null {
  const text = value.replace(PLACEHOLDER_TOKEN, ' ');
  if (locale === 'fr') {
    // The elided form: t'inscrire, t'aider (not the n't of English loan words).
    const elided = /(?<!\p{L})[tT]['’](?=\p{L})/u.exec(text);
    if (elided) return elided[0];
  }
  const informal = INFORMAL_WORDS[locale];
  for (const word of words(text)) if (informal.includes(word.toLowerCase())) return word;
  return null;
}

// --- Check 5: length ----------------------------------------------------------------------------

/** round(1.8 x length) + 6 for German texts up to 30 characters, round(1.5 x length) + 10 above. */
export function lengthLimit(source: string): number {
  const length = source.length;
  return length <= 30 ? Math.round(1.8 * length) + 6 : Math.round(1.5 * length) + 10;
}

export function lengthOk(source: string, value: string): boolean {
  return value.length <= lengthLimit(source);
}

// --- Check 6: glossary terms --------------------------------------------------------------------

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The term as a word of its own (Unicode-aware boundaries, case-sensitive). */
function containsTerm(text: string, term: string): boolean {
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(term)}(?![\\p{L}\\p{N}_])`, 'u').test(text);
}

/**
 * The German terms of the glossary found in the German text whose rule the value breaks: keep terms must appear
 * unchanged, fixed translations must appear (case-insensitive).
 */
export function glossaryProblems(
  source: string,
  value: string,
  locale: TargetLocale,
  glossary: readonly GlossaryTerm[],
): string[] {
  const problems: string[] = [];
  const lowerValue = value.toLowerCase();
  for (const entry of glossary) {
    if (!containsTerm(source, entry.term)) continue;
    if (entry.keep) {
      if (!value.includes(entry.term)) problems.push(entry.term);
      continue;
    }
    const expected = entry.translations[locale];
    if (expected && !lowerValue.includes(expected.toLowerCase())) problems.push(entry.term);
  }
  return problems;
}

// --- Checks 7 and 8: forbidden characters -------------------------------------------------------

/** U+00DF (and its capital U+1E9E): Swiss spelling uses ss in every language (rule 7). */
export function hasSharpS(value: string): boolean {
  return /[ßẞ]/.test(value);
}

/** U+2014: never used anywhere (rule 8). */
export function hasEmDash(value: string): boolean {
  return value.includes('—');
}

// --- Checks 9 and 10: completeness, legal keys --------------------------------------------------

/** Per locale the German keys it lacks; locales without a gap are left out. */
export function incompleteLocales(
  bundles: Partial<Record<TargetLocale, Readonly<Record<string, string | undefined>>>>,
  source: Readonly<Record<string, string>>,
  locales: readonly TargetLocale[],
): Partial<Record<TargetLocale, string[]>> {
  const result: Partial<Record<TargetLocale, string[]>> = {};
  for (const locale of locales) {
    const missing = missingKeys(source, bundles[locale] ?? {});
    if (missing.length > 0) result[locale] = missing;
  }
  return result;
}

/** "<locale>: <key>" for every legal key without a non-empty value in the given locales. */
export function legalProblems(
  bundles: Partial<Record<Locale, Readonly<Record<string, string | undefined>>>>,
  locales: readonly Locale[],
): string[] {
  const problems: string[] = [];
  for (const locale of locales) {
    for (const key of LEGAL_KEYS) {
      const value = bundles[locale]?.[key];
      if (typeof value !== 'string' || value.trim() === '') problems.push(`${locale}: ${key}`);
    }
  }
  return problems;
}

// --- Check 11: French typography ----------------------------------------------------------------

const NBSP = ' ';

/** Placeholders and "://" never take part in the spacing rules. */
function typographyMask(value: string): string {
  return value.replace(PLACEHOLDER_TOKEN, (m) => 'x'.repeat(m.length)).replace(/:\/\//g, 'x//');
}

/**
 * Swiss French spacing: a no-break space (not an ASCII space) before ":" and "%", no space at all (ASCII,
 * U+00A0, U+202F) before "?", "!" and ";". Returns one short English problem per rule broken.
 */
export function typographyProblems(value: string): string[] {
  const text = typographyMask(value);
  const problems: string[] = [];
  if (/ :/.test(text)) problems.push('ASCII space before ":" (use a no-break space)');
  if (/ %/.test(text)) problems.push('ASCII space before "%" (use a no-break space)');
  for (const mark of ['?', '!', ';']) {
    if (new RegExp(`[ \\u00A0\\u202F]\\${mark}`).test(text)) problems.push(`space before "${mark}"`);
  }
  return problems;
}

/** Fixes what typographyProblems reports; applied before saving fr values (i18n 12.5 step 3). */
export function fixFrenchTypography(value: string): string {
  const mask = typographyMask(value);
  const isSpace = (ch: string | undefined) => ch === ' ' || ch === NBSP || ch === '\u202F';
  let out = '';
  let i = 0;
  while (i < value.length) {
    if (!isSpace(value[i])) {
      out += value[i];
      i++;
      continue;
    }
    let end = i;
    while (end < value.length && isSpace(value[end])) end++;
    const run = value.slice(i, end);
    const next = mask[end];
    if (next === '?' || next === '!' || next === ';') {
      // no space at all before these marks
    } else if ((next === ':' || next === '%') && run.includes(' ')) {
      out += NBSP;
    } else {
      out += run;
    }
    i = end;
  }
  return out;
}

// --- One value ----------------------------------------------------------------------------------

/**
 * Checks 2 to 8 and 11 for one value, with the allowlists of its locale. hard: placeholders, sharpS, emDash
 * (every locale, a save is refused); soft: german, formality, length, glossary (fr, it, nl; left out with
 * skipLanguage, used for demo jobs) and typography (fr). de and en get the hard checks only.
 */
export function checkValue(input: {
  key: string;
  source: string;
  value: string;
  locale: Locale;
  glossary: readonly GlossaryTerm[];
  skipLanguage?: boolean;
}): { hard: TranslationCheckName[]; soft: TranslationCheckName[] } {
  const { key, source, value, locale, glossary } = input;
  const hard: TranslationCheckName[] = [];
  const soft: TranslationCheckName[] = [];
  if (!placeholdersMatch(source, value).ok) hard.push('placeholders');
  if (hasSharpS(value)) hard.push('sharpS');
  if (hasEmDash(value)) hard.push('emDash');
  if (locale === 'de' || locale === 'en') return { hard, soft };

  const allow = allowlistFor(locale);
  if (!input.skipLanguage) {
    if (looksGerman(value, source, locale) && !allow.germanOk.includes(key)) soft.push('german');
    if (informalWord(value, locale) && !allow.informalOk.includes(key)) soft.push('formality');
    if (!lengthOk(source, value) && !allow.lengthOk.includes(key)) soft.push('length');
    if (glossaryProblems(source, value, locale, glossary).length > 0 && !allow.glossaryOk.includes(key)) {
      soft.push('glossary');
    }
  }
  if (locale === 'fr' && typographyProblems(value).length > 0 && !allow.typographyOk.includes(key)) {
    soft.push('typography');
  }
  return { hard, soft };
}
