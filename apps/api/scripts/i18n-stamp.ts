// i18n:stamp (i18n 4.3): records, per target locale and section, which German text each compiled translation was
// written against, so the console can tell an outdated translation ("Veraltet") from a current one.
//
//   pnpm --filter @weblion/api i18n:stamp [--locale <en|fr|it|nl>] [--section <name>] [--key <key>]
//                                         [--confirm] [--yes] [--check]
//
// Stamps describe the repository, never the database: the German side is always the compiled German text.
// --check writes nothing and exits 1 when a file would change. --confirm stamps stale translations as current;
// without --section or --key it asks on the terminal first, unless --yes is given.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isTargetLocale, TARGET_LOCALES, type SectionName, type TargetLocale } from '@weblion/shared';
import type { Stamp } from '@weblion/shared/i18n/catalog';
import { SECTION_SOURCES } from '@weblion/shared/i18n/server';
import { sourceHash } from '../src/i18n/hash';

/** The stamp files of the shared package: stamps/<locale>/<section>.json. */
export const STAMPS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../packages/shared/src/i18n/stamps',
);

/** Every section in German key order (SECTION_SOURCES follows SECTIONS). */
export const STAMP_SECTIONS = Object.keys(SECTION_SOURCES) as SectionName[];

export interface StampReport {
  /** Translations without a stamp so far. */
  added: string[];
  /** The translation changed since it was stamped: the translator wrote it against the current German. */
  updated: string[];
  /** Stale translations stamped as current with --confirm. */
  confirmed: string[];
  /** The German text changed since the translation was stamped, and the translation did not. */
  stale: string[];
  /** Stamps of keys that have no translation or no longer exist. */
  removed: string[];
}

/**
 * Steps 1 and 2 of i18n 4.3 for one locale and section. Returns the new stamps in German key order and what
 * changed. `confirm` decides per stale key whether it is stamped as current.
 */
export function stampSection(input: {
  german: Readonly<Record<string, string>>;
  values: Readonly<Record<string, string | undefined>>;
  current: Readonly<Record<string, Stamp>>;
  confirm?: (key: string) => boolean;
}): { stamps: Record<string, Stamp>; report: StampReport } {
  const { german, values, current } = input;
  const report: StampReport = { added: [], updated: [], confirmed: [], stale: [], removed: [] };
  const stamps: Record<string, Stamp> = {};
  for (const [key, de] of Object.entries(german)) {
    const value = values[key];
    if (typeof value !== 'string') continue;
    const fresh: Stamp = [sourceHash(de), sourceHash(value)];
    const stamp = current[key];
    if (!stamp) {
      stamps[key] = fresh;
      report.added.push(key);
    } else if (stamp[1] !== fresh[1]) {
      stamps[key] = fresh;
      report.updated.push(key);
    } else if (stamp[0] !== fresh[0]) {
      if (input.confirm?.(key)) {
        stamps[key] = fresh;
        report.confirmed.push(key);
      } else {
        stamps[key] = [stamp[0], stamp[1]];
        report.stale.push(key);
      }
    } else {
      stamps[key] = [stamp[0], stamp[1]];
    }
  }
  for (const key of Object.keys(current)) if (!(key in stamps)) report.removed.push(key);
  return { stamps, report };
}

/** Two-space indent, one key per line with its pair inline, trailing newline (i18n 4.2). */
export function serializeStamps(stamps: Readonly<Record<string, Stamp>>): string {
  const entries = Object.entries(stamps);
  if (entries.length === 0) return '{}\n';
  const lines = entries.map(
    ([key, [a, b]], i) =>
      `  ${JSON.stringify(key)}: [${JSON.stringify(a)}, ${JSON.stringify(b)}]${i < entries.length - 1 ? ',' : ''}`,
  );
  return `{\n${lines.join('\n')}\n}\n`;
}

export function stampFilePath(locale: TargetLocale, section: SectionName, dir = STAMPS_DIR): string {
  return resolve(dir, locale, `${section}.json`);
}

/** A stamp file from disk; a missing file counts as empty. Throws on anything but pairs of strings. */
export function readStampFile(path: string): Record<string, Stamp> {
  if (!existsSync(path)) return {};
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${path}: not a JSON object`);
  const out: Record<string, Stamp> = {};
  for (const [key, pair] of Object.entries(raw)) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      typeof pair[0] !== 'string' ||
      typeof pair[1] !== 'string'
    ) {
      throw new Error(`${path}: the stamp of ${key} is not a pair of hashes`);
    }
    out[key] = [pair[0], pair[1]];
  }
  return out;
}

export interface StampPlanEntry {
  locale: TargetLocale;
  section: SectionName;
  path: string;
  report: StampReport;
  /** The file content after the run. */
  content: string;
  /** content differs from the file on disk. */
  changed: boolean;
}

/** Computes every selected file without writing anything (the --check run and the stamps test use it). */
export function planStamps(
  options: {
    locales?: readonly TargetLocale[];
    sections?: readonly SectionName[];
    confirm?: (key: string) => boolean;
    dir?: string;
  } = {},
): StampPlanEntry[] {
  const plan: StampPlanEntry[] = [];
  for (const locale of options.locales ?? TARGET_LOCALES) {
    for (const section of options.sections ?? STAMP_SECTIONS) {
      const path = stampFilePath(locale, section, options.dir);
      const before = existsSync(path) ? readFileSync(path, 'utf8') : null;
      const { stamps, report } = stampSection({
        german: SECTION_SOURCES[section].de,
        values: SECTION_SOURCES[section][locale],
        current: readStampFile(path),
        confirm: options.confirm,
      });
      const content = serializeStamps(stamps);
      plan.push({ locale, section, path, report, content, changed: content !== before });
    }
  }
  return plan;
}

interface CliOptions {
  locale: TargetLocale | null;
  section: SectionName | null;
  key: string | null;
  confirm: boolean;
  yes: boolean;
  check: boolean;
}

class UsageError extends Error {}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    locale: null,
    section: null,
    key: null,
    confirm: false,
    yes: false,
    check: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new UsageError(`${arg} needs a value`);
      return value;
    };
    if (arg === '--') continue;
    else if (arg === '--locale') {
      const value = next();
      if (!isTargetLocale(value)) throw new UsageError(`unknown locale ${value} (en, fr, it, nl)`);
      options.locale = value;
    } else if (arg === '--section') {
      const value = next();
      if (!(STAMP_SECTIONS as readonly string[]).includes(value)) {
        throw new UsageError(`unknown section ${value} (${STAMP_SECTIONS.join(', ')})`);
      }
      options.section = value as SectionName;
    } else if (arg === '--key') options.key = next();
    else if (arg === '--confirm') options.confirm = true;
    else if (arg === '--yes') options.yes = true;
    else if (arg === '--check') options.check = true;
    else throw new UsageError(`unknown argument ${arg}`);
  }
  if (options.key) {
    const section = STAMP_SECTIONS.find((s) => options.key! in SECTION_SOURCES[s].de);
    if (!section) throw new UsageError(`unknown key ${options.key}`);
    if (options.section && options.section !== section) {
      throw new UsageError(`${options.key} belongs to section ${section}, not ${options.section}`);
    }
    options.section = section;
  }
  if (options.check && options.confirm) throw new UsageError('--check and --confirm exclude each other');
  return options;
}

function summary(entry: StampPlanEntry): string | null {
  const r = entry.report;
  const counts = [
    [r.added.length, 'new'],
    [r.updated.length, 'updated'],
    [r.confirmed.length, 'confirmed'],
    [r.stale.length, 'stale'],
    [r.removed.length, 'removed'],
  ] as const;
  if (counts.every(([n]) => n === 0) && !entry.changed) return null;
  return `${entry.locale}/${entry.section}: ${counts.map(([n, label]) => `${n} ${label}`).join(', ')}`;
}

async function askToConfirm(count: number): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`Stamp ${count} stale translation(s) as current? [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function main(argv: readonly string[]): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`i18n:stamp: ${err.message}`);
      return 2;
    }
    throw err;
  }
  const selection = {
    locales: options.locale ? [options.locale] : undefined,
    sections: options.section ? [options.section] : undefined,
  };
  const confirm = options.confirm ? (key: string) => options.key === null || options.key === key : undefined;

  if (confirm && !options.section && !options.yes) {
    const stale = planStamps(selection).reduce((n, e) => n + e.report.stale.length, 0);
    if (stale > 0 && !(await askToConfirm(stale))) {
      console.error('i18n:stamp: nothing confirmed');
      return 1;
    }
  }

  const plan = planStamps({ ...selection, confirm });
  for (const entry of plan) {
    const line = summary(entry);
    if (line) console.log(line);
    for (const key of entry.report.stale) console.log(`  stale: ${key}`);
    if (!options.check && entry.changed) writeFileSync(entry.path, entry.content);
  }
  const changed = plan.filter((e) => e.changed);
  const stale = plan.reduce((n, e) => n + e.report.stale.length, 0);
  if (options.check) {
    console.log(
      changed.length === 0
        ? `i18n:stamp --check: ${plan.length} files up to date, ${stale} stale`
        : `i18n:stamp --check: ${changed.length} file(s) would change, run i18n:stamp`,
    );
    return changed.length === 0 ? 0 : 1;
  }
  console.log(`i18n:stamp: ${changed.length} of ${plan.length} files written, ${stale} stale`);
  return 0;
}

// Runs only as a script (tsx scripts/i18n-stamp.ts), not when a test imports the functions above.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err);
      process.exit(1);
    },
  );
}
