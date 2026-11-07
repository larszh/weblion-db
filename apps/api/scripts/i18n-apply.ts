// i18n:apply (i18n 16.2): writes an export of the translation admin into the section files of the repository,
// so the changes made in Verwaltung > Übersetzungen flow back into the code.
//
//   pnpm --filter @weblion/api i18n:apply <file.json> [--locale <l>] [--dry-run] [--only-reviewed]
//
// Reads either export format (overrides or one language). Every value runs the checks of a save: placeholders,
// line breaks, sharp s, em dash and French spacing are hard failures (the value is not applied and the script
// exits 1); leftover German, informal address, length and glossary terms are printed as warnings. fr, it and nl
// files are regenerated in German key order; in de and en only the string of each applied key is replaced, so
// their comments stay. The stamps of the touched files are updated like i18n:stamp does, with one difference:
// an applied value is stamped with the source hash of its row, so a stale override stays stale and a confirmed
// one (A7) becomes current. A value of a locale file (no source hash) that equals the compiled one is left out
// as unchanged and keeps its stamp; a changed one is stamped against the current German.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isLocale, LOCALES, type Locale, type SectionName, type TargetLocale } from '@weblion/shared';
import type { Stamp } from '@weblion/shared/i18n/catalog';
import { checkValue, placeholdersMatch, typographyProblems } from '@weblion/shared/i18n/checks';
import { DEFAULT_GLOSSARY } from '@weblion/shared/i18n/glossary';
import { SECTION_SOURCES } from '@weblion/shared/i18n/server';
import { forbiddenCharacters, prepareValue } from '../src/i18n/entries';
import { sourceHash } from '../src/i18n/hash';
import { parseImportFile, type ImportRow } from '../src/i18n/import';
import { readStampFile, serializeStamps, stampFilePath, stampSection, STAMP_SECTIONS } from './i18n-stamp';

/** The section files of the shared package: sections/<section>.<locale>.ts. */
export const SECTIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../packages/shared/src/i18n/sections',
);

export interface ApplyValue {
  key: string;
  locale: Locale;
  section: SectionName;
  value: string;
  /** The German text the value counts as written against (for the stamp). */
  sourceHash: string;
}

export interface ApplyPlan {
  values: ApplyValue[];
  /** Hard failures: not applied. */
  failures: string[];
  /** Soft check results: applied anyway. */
  warnings: string[];
  /** Entries left out on purpose (not reviewed, unknown key, empty value). */
  ignored: string[];
  /**
   * Entries of a locale file whose value equals the compiled one: not applied, so their stamp stays as it is
   * (a stale translation the translator left alone stays stale).
   */
  unchanged: string[];
}

const sectionByKey = new Map<string, SectionName>();
for (const section of STAMP_SECTIONS) {
  for (const key of Object.keys(SECTION_SOURCES[section].de)) {
    if (!sectionByKey.has(key)) sectionByKey.set(key, section);
  }
}

/** Checks every row of a file and decides what is applied (steps 1 and 2). */
export function planApply(
  rows: readonly ImportRow[],
  options: { locale?: Locale | null; onlyReviewed?: boolean },
): ApplyPlan {
  const plan: ApplyPlan = { values: [], failures: [], warnings: [], ignored: [], unchanged: [] };
  // German first: a translation of the same run is checked against the German it was written for.
  const german = new Map<string, string>();
  const ordered = [...rows].sort((a, b) => (a.locale === 'de' ? 0 : 1) - (b.locale === 'de' ? 0 : 1));
  for (const row of ordered) {
    const id = `${row.locale}:${row.key}`;
    if (options.locale && row.locale !== options.locale) continue;
    if (options.onlyReviewed && row.reviewed === false) {
      plan.ignored.push(`${id}: not reviewed`);
      continue;
    }
    const section = sectionByKey.get(row.key);
    if (!section) {
      plan.ignored.push(`${id}: unknown key`);
      continue;
    }
    const compiledGerman = SECTION_SOURCES[section].de[row.key]!;
    const source = row.locale === 'de' ? compiledGerman : (german.get(row.key) ?? compiledGerman);
    const { value } = prepareValue(row.locale, source, row.value);
    // The rule of A4: an empty text would blank the label, button or notice in that language.
    if (value.trim() === '') {
      plan.ignored.push(`${id}: empty value`);
      continue;
    }
    // A locale file carries no source hash, and its export holds stale cells with their old value. A value the
    // translator left as it is must keep its stamp: stamping it against the current German would turn a stale
    // translation, a legal notice included, into a current one (only A7 or i18n:stamp --confirm may do that).
    if (row.sourceHash === null && value === SECTION_SOURCES[section][row.locale][row.key]) {
      plan.unchanged.push(id);
      continue;
    }
    const problems: string[] = [];
    const placeholders = placeholdersMatch(source, value);
    if (!placeholders.ok) {
      problems.push(
        [
          ...placeholders.missing.map((p) => `missing {${p}}`),
          ...placeholders.extra.map((p) => `extra {${p}}`),
          ...(placeholders.lineBreaks ? [] : ['line breaks differ']),
        ].join(', '),
      );
    }
    const characters = forbiddenCharacters(value, section);
    if (characters.length > 0) problems.push(`forbidden character ${characters.join(', ')}`);
    if (row.locale === 'fr') problems.push(...typographyProblems(value));
    if (problems.length > 0) {
      plan.failures.push(`${id}: ${problems.join('; ')} (${JSON.stringify(value)})`);
      continue;
    }
    const soft = checkValue({
      key: row.key,
      source,
      value,
      locale: row.locale,
      glossary: DEFAULT_GLOSSARY,
    }).soft;
    if (soft.length > 0) plan.warnings.push(`${id}: ${soft.join(', ')}`);
    if (row.locale === 'de') german.set(row.key, value);
    plan.values.push({
      key: row.key,
      locale: row.locale,
      section,
      value,
      sourceHash: row.sourceHash ?? sourceHash(source),
    });
  }
  return plan;
}

const capitalized = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A string literal as the section files write it; prettier then picks the quotes. */
export function literal(value: string): string {
  return JSON.stringify(value)
    .replace(/\u00A0/g, '\\u00A0')
    .replace(/\u202F/g, '\\u202F');
}

/** A whole fr, it or nl section file: keys in German order, no comments (step 3). */
export function regeneratedSectionFile(
  section: SectionName,
  locale: Exclude<Locale, 'de' | 'en'>,
  values: Readonly<Record<string, string | undefined>>,
): string {
  const german = Object.keys(SECTION_SOURCES[section].de);
  const lines = german
    .filter((key) => typeof values[key] === 'string')
    .map((key) => `  ${literal(key)}: ${literal(values[key]!)},`);
  const de = `${section}De`;
  const name = `${section}${capitalized(locale)}`;
  return (
    `import type { ${de} } from './${section}.de';\n\n` +
    `export const ${name}: Partial<Record<keyof typeof ${de}, string>> = {` +
    (lines.length > 0 ? `\n${lines.join('\n')}\n` : '') +
    '};\n'
  );
}

/** The end of the JS string literal starting at `start` (a quote), or -1. */
function literalEnd(text: string, start: number): number {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') {
      i++;
      continue;
    }
    if (text[i] === quote) return i + 1;
    if (text[i] === '\n') return -1;
  }
  return -1;
}

/**
 * Replaces the string literal of a key in a de or en file in place (step 3), keeping every comment and every
 * other key. Throws when the key is missing or its value is not one string literal.
 */
export function replaceInPlace(text: string, key: string, value: string): string {
  for (const quote of ["'", '"']) {
    const token = `${quote}${key}${quote}:`;
    const at = text.indexOf(token);
    if (at === -1) continue;
    let start = at + token.length;
    while (start < text.length && /\s/.test(text[start]!)) start++;
    if (text[start] !== "'" && text[start] !== '"')
      throw new Error(`${key}: the value is not a string literal`);
    const end = literalEnd(text, start);
    if (end === -1) throw new Error(`${key}: the string literal does not end on its line`);
    if (/^\s*\+/.test(text.slice(end))) throw new Error(`${key}: the value is not a single string literal`);
    return text.slice(0, start) + literal(value) + text.slice(end);
  }
  throw new Error(`${key}: not found in the file`);
}

export interface FileChange {
  path: string;
  before: string | null;
  after: string;
  applied: string[];
}

async function formatTs(path: string, text: string): Promise<string> {
  // The repository's prettier (a root dev dependency) with the repository's configuration, also for copies of
  // the files outside the checkout (the test); the script only runs in a checkout.
  const prettier = await import('prettier');
  const config = (await prettier.resolveConfig(resolve(SECTIONS_DIR, 'index.ts'))) ?? {};
  return prettier.format(text, { ...config, filepath: path });
}

/** The new section and stamp files of a plan (steps 3 and 4), without writing anything. */
export async function planFiles(
  plan: ApplyPlan,
  dirs: { sections?: string; stamps?: string } = {},
): Promise<FileChange[]> {
  const sectionsDir = dirs.sections ?? SECTIONS_DIR;
  const changes: FileChange[] = [];
  const touched = new Map<string, ApplyValue[]>();
  for (const v of plan.values) {
    const id = `${v.section}.${v.locale}`;
    touched.set(id, [...(touched.get(id) ?? []), v]);
  }
  // German of this run, for the stamps of the target files.
  const germanBySection = new Map<SectionName, Record<string, string>>();
  for (const section of STAMP_SECTIONS) germanBySection.set(section, { ...SECTION_SOURCES[section].de });
  for (const v of plan.values) if (v.locale === 'de') germanBySection.get(v.section)![v.key] = v.value;

  for (const [id, values] of touched) {
    const [section, locale] = id.split('.') as [SectionName, Locale];
    const path = resolve(sectionsDir, `${section}.${locale}.ts`);
    const before = readFileSync(path, 'utf8');
    let text: string;
    if (locale === 'de' || locale === 'en') {
      text = before;
      for (const v of values) text = replaceInPlace(text, v.key, v.value);
    } else {
      const merged: Record<string, string | undefined> = { ...SECTION_SOURCES[section][locale] };
      for (const v of values) merged[v.key] = v.value;
      text = regeneratedSectionFile(section, locale, merged);
    }
    const after = await formatTs(path, text);
    changes.push({ path, before, after, applied: values.map((v) => v.key) });

    if (locale === 'de') continue;
    // Step 4: the stamps of this locale and section.
    const stampPath = stampFilePath(locale as TargetLocale, section, dirs.stamps);
    const merged: Record<string, string | undefined> = { ...SECTION_SOURCES[section][locale] };
    for (const v of values) merged[v.key] = v.value;
    const { stamps } = stampSection({
      german: germanBySection.get(section)!,
      values: merged,
      current: readStampFile(stampPath),
    });
    const applied: Record<string, Stamp> = { ...stamps };
    for (const v of values) applied[v.key] = [v.sourceHash, sourceHash(v.value)];
    const stampBefore = (() => {
      try {
        return readFileSync(stampPath, 'utf8');
      } catch {
        return null;
      }
    })();
    changes.push({ path: stampPath, before: stampBefore, after: serializeStamps(applied), applied: [] });
  }
  return changes;
}

interface CliOptions {
  file: string;
  locale: Locale | null;
  dryRun: boolean;
  onlyReviewed: boolean;
}

class UsageError extends Error {}

function parseArgs(argv: readonly string[]): CliOptions {
  let file: string | null = null;
  const options = { locale: null as Locale | null, dryRun: false, onlyReviewed: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--') continue;
    if (arg === '--locale') {
      const value = argv[++i];
      if (!value || !isLocale(value))
        throw new UsageError(`unknown locale ${value ?? ''} (${LOCALES.join(', ')})`);
      options.locale = value;
    } else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--only-reviewed') options.onlyReviewed = true;
    else if (arg.startsWith('--')) throw new UsageError(`unknown argument ${arg}`);
    else if (file) throw new UsageError('only one file');
    else file = arg;
  }
  if (!file) throw new UsageError('a JSON file of the translation export is required');
  return { file, ...options };
}

async function main(argv: readonly string[]): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`i18n:apply: ${err.message}`);
      return 2;
    }
    throw err;
  }
  let rows: ImportRow[];
  try {
    // pnpm runs the script in apps/api; a relative path is meant from where it was typed.
    const path = resolve(process.env.INIT_CWD ?? process.cwd(), options.file);
    rows = parseImportFile(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  } catch (err) {
    const details = (err as { details?: { problems?: string[] } }).details;
    console.error(`i18n:apply: ${err instanceof Error ? err.message : String(err)}`);
    for (const problem of details?.problems ?? []) console.error(`  ${problem}`);
    return 1;
  }
  const plan = planApply(rows, { locale: options.locale, onlyReviewed: options.onlyReviewed });
  for (const line of plan.ignored) console.log(`ignored: ${line}`);
  for (const line of plan.unchanged) console.log(`unchanged: ${line}`);
  for (const line of plan.warnings) console.log(`warning: ${line}`);
  for (const line of plan.failures) console.error(`not applied: ${line}`);
  const changes = await planFiles(plan);
  for (const change of changes) {
    if (change.before === change.after) continue;
    const what = change.applied.length > 0 ? `${change.applied.length} value(s)` : 'stamps';
    console.log(`${options.dryRun ? 'would write' : 'wrote'} ${change.path} (${what})`);
    if (!options.dryRun) writeFileSync(change.path, change.after);
  }
  console.log(
    `i18n:apply: ${plan.values.length} applied, ${plan.unchanged.length} unchanged, ${plan.failures.length} not applied, ${plan.warnings.length} warning(s)` +
      (options.dryRun ? ' (dry run, nothing written)' : ''),
  );
  return plan.failures.length > 0 ? 1 : 0;
}

// Runs only as a script (tsx scripts/i18n-apply.ts), not when a test imports the functions above.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err);
      process.exit(1);
    },
  );
}
