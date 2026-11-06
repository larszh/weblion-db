// i18n:report (i18n 4.3, plan 8.2): how complete and how current the compiled translations of the repository
// are, per locale and section. The integrator uses it to find the keys added (--missing) or changed (--stale)
// after the foundation; CI prints it on every run.
//
//   pnpm --filter @weblion/api i18n:report [--locale <en|fr|it|nl>] [--missing] [--stale]
//
// missing: a German key without a value in the locale. stale: a value whose stamp is missing or was written
// against another German text (the comparison of scripts/i18n-stamp.ts). Exit code 0, 2 for a wrong argument.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isTargetLocale, TARGET_LOCALES, type SectionName, type TargetLocale } from '@weblion/shared';
import type { Stamp } from '@weblion/shared/i18n/catalog';
import { SECTION_SOURCES } from '@weblion/shared/i18n/server';
import { sourceHash } from '../src/i18n/hash';
import { readStampFile, STAMP_SECTIONS, stampFilePath } from './i18n-stamp';

export interface SectionReport {
  locale: TargetLocale;
  section: SectionName;
  keys: number;
  missing: string[];
  stale: string[];
}

/** Missing and stale keys of one locale and section, in German key order. */
export function reportSection(input: {
  german: Readonly<Record<string, string>>;
  values: Readonly<Record<string, string | undefined>>;
  stamps: Readonly<Record<string, Stamp>>;
}): { missing: string[]; stale: string[] } {
  const missing: string[] = [];
  const stale: string[] = [];
  for (const [key, de] of Object.entries(input.german)) {
    if (typeof input.values[key] !== 'string') {
      missing.push(key);
      continue;
    }
    const stamp = input.stamps[key];
    if (!stamp || stamp[0] !== sourceHash(de)) stale.push(key);
  }
  return { missing, stale };
}

/** Every selected locale and section, read from the section sources and the stamp files on disk. */
export function buildReport(
  options: { locales?: readonly TargetLocale[]; dir?: string } = {},
): SectionReport[] {
  const out: SectionReport[] = [];
  for (const locale of options.locales ?? TARGET_LOCALES) {
    for (const section of STAMP_SECTIONS) {
      const german = SECTION_SOURCES[section].de;
      const { missing, stale } = reportSection({
        german,
        values: SECTION_SOURCES[section][locale],
        stamps: readStampFile(stampFilePath(locale, section, options.dir)),
      });
      out.push({ locale, section, keys: Object.keys(german).length, missing, stale });
    }
  }
  return out;
}

interface CliOptions {
  locale: TargetLocale | null;
  missing: boolean;
  stale: boolean;
}

class UsageError extends Error {}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { locale: null, missing: false, stale: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--locale') {
      const value = argv[++i];
      if (!value || !isTargetLocale(value))
        throw new UsageError(`unknown locale ${value ?? ''} (en, fr, it, nl)`);
      options.locale = value;
    } else if (arg === '--missing') options.missing = true;
    else if (arg === '--stale') options.stale = true;
    else throw new UsageError(`unknown argument ${arg}`);
  }
  return options;
}

export function main(argv: readonly string[], print: (line: string) => void = console.log): number {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`i18n:report: ${err.message}`);
      return 2;
    }
    throw err;
  }
  const report = buildReport({ locales: options.locale ? [options.locale] : undefined });
  for (const locale of options.locale ? [options.locale] : TARGET_LOCALES) {
    const rows = report.filter((r) => r.locale === locale);
    const keys = rows.reduce((n, r) => n + r.keys, 0);
    const missing = rows.reduce((n, r) => n + r.missing.length, 0);
    const stale = rows.reduce((n, r) => n + r.stale.length, 0);
    print(`${locale}: ${keys} keys, ${missing} missing, ${stale} stale`);
    for (const row of rows) {
      if (row.missing.length === 0 && row.stale.length === 0) continue;
      print(`  ${row.section}: ${row.missing.length} missing, ${row.stale.length} stale`);
      if (options.missing) for (const key of row.missing) print(`    missing: ${key}`);
      if (options.stale) for (const key of row.stale) print(`    stale: ${key}`);
    }
  }
  return 0;
}

// Runs only as a script (tsx scripts/i18n-report.ts), not when a test imports the functions above.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main(process.argv.slice(2)));
}
