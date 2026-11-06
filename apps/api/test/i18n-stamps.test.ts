import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isTargetLocale, LEGAL_KEYS, TARGET_LOCALES, type TargetLocale } from '@weblion/shared';
import { buildCatalog, type Stamp } from '@weblion/shared/i18n/catalog';
import { SECTION_SOURCES } from '@weblion/shared/i18n/server';
import {
  planStamps,
  readStampFile,
  serializeStamps,
  STAMP_SECTIONS,
  stampFilePath,
  stampSection,
} from '../scripts/i18n-stamp';
import { sourceHash } from '../src/i18n/hash';

/** I18N_REQUIRE_LEGAL (i18n 4.3): '1' or 'true' = fr, it and nl; a comma list = those locales; unset = none. */
function requiredLegalLocales(): TargetLocale[] {
  const raw = process.env.I18N_REQUIRE_LEGAL?.trim().toLowerCase();
  if (!raw || raw === '0' || raw === 'false') return [];
  if (raw === '1' || raw === 'true') return ['fr', 'it', 'nl'];
  return raw
    .split(',')
    .map((l) => l.trim())
    .filter(isTargetLocale);
}

const h = sourceHash;

describe('the stamp files of the repository', () => {
  it('parse, and name only keys of their own section that have a translation', () => {
    for (const locale of TARGET_LOCALES) {
      for (const section of STAMP_SECTIONS) {
        const stamps = readStampFile(stampFilePath(locale, section));
        const german = SECTION_SOURCES[section].de;
        const values = SECTION_SOURCES[section][locale];
        for (const [key, [a, b]] of Object.entries(stamps)) {
          expect(german, `${locale}/${section}: ${key}`).toHaveProperty([key]);
          expect(typeof values[key], `${locale}/${section}: ${key} has no translation`).toBe('string');
          expect(a).toMatch(/^[0-9a-f]{16}$/);
          expect(b).toMatch(/^[0-9a-f]{16}$/);
        }
      }
    }
  });

  it('stamp every compiled translation with its current value (run i18n:stamp after a change)', () => {
    const missing: string[] = [];
    for (const locale of TARGET_LOCALES) {
      for (const section of STAMP_SECTIONS) {
        const stamps = readStampFile(stampFilePath(locale, section));
        for (const [key, value] of Object.entries(SECTION_SOURCES[section][locale])) {
          if (typeof value !== 'string') continue;
          if (stamps[key]?.[1] !== h(value)) missing.push(`${locale}/${section}: ${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('are what i18n:stamp --check expects', () => {
    const changed = planStamps()
      .filter((e) => e.changed)
      .map((e) => `${e.locale}/${e.section}`);
    expect(changed).toEqual([]);
  });

  it('keep English current: English is written together with German', () => {
    const stale: string[] = [];
    for (const section of STAMP_SECTIONS) {
      const stamps = readStampFile(stampFilePath('en', section));
      for (const [key, de] of Object.entries(SECTION_SOURCES[section].de)) {
        if (stamps[key]?.[0] !== h(de)) stale.push(`${section}: ${key}`);
      }
    }
    expect(stale).toEqual([]);
  });

  it('build the catalog of the API', () => {
    const catalog = buildCatalog();
    expect(Object.keys(catalog.stamps.en)).toHaveLength(catalog.keys.length);
    expect(catalog.stamps.en['common.actions']).toEqual([
      h(SECTION_SOURCES.core.de['common.actions']!),
      h(SECTION_SOURCES.core.en['common.actions']!),
    ]);
  });

  const legal = requiredLegalLocales();
  it.skipIf(legal.length === 0)(
    `translate the legal keys currently (I18N_REQUIRE_LEGAL=${legal.join(',')})`,
    () => {
      const problems: string[] = [];
      const catalog = buildCatalog();
      for (const locale of legal) {
        for (const key of LEGAL_KEYS) {
          const value = catalog.bundles[locale][key];
          if (value === undefined) problems.push(`${locale}: ${key} has no translation`);
          else if (catalog.stamps[locale][key]?.[0] !== h(catalog.bundles.de[key]!)) {
            problems.push(`${locale}: ${key} is stale`);
          }
        }
      }
      expect(problems).toEqual([]);
    },
  );
});

describe('i18n:stamp', () => {
  const german = { a: 'Eins', b: 'Zwei', c: 'Drei', d: 'Vier' };

  it('stamps new translations in German key order', () => {
    const { stamps, report } = stampSection({ german, values: { c: 'Three', a: 'One' }, current: {} });
    expect(Object.keys(stamps)).toEqual(['a', 'c']);
    expect(stamps.a).toEqual([h('Eins'), h('One')]);
    expect(report).toEqual({ added: ['a', 'c'], updated: [], confirmed: [], stale: [], removed: [] });
  });

  it('restamps a changed translation, keeps a stale one unless confirmed, removes the rest', () => {
    const current: Record<string, Stamp> = {
      a: [h('Eins'), h('One')], // current
      b: [h('Zwo'), h('Two')], // German changed, translation did not: stale
      c: [h('Dri'), h('Thre')], // translation changed: written against the current German
      d: [h('Vier'), h('Four')], // translation removed
      gone: [h('Weg'), h('Gone')], // key removed
    };
    const values = { a: 'One', b: 'Two', c: 'Three' };
    const kept = stampSection({ german, values, current });
    expect(kept.report).toEqual({
      added: [],
      updated: ['c'],
      confirmed: [],
      stale: ['b'],
      removed: ['d', 'gone'],
    });
    expect(kept.stamps).toEqual({ a: current.a, b: current.b, c: [h('Drei'), h('Three')] });

    const confirmed = stampSection({ german, values, current, confirm: (key) => key === 'b' });
    expect(confirmed.report.confirmed).toEqual(['b']);
    expect(confirmed.report.stale).toEqual([]);
    expect(confirmed.stamps.b).toEqual([h('Zwei'), h('Two')]);
  });

  it('writes one pair per line with a trailing newline, and {} for an empty file', () => {
    expect(serializeStamps({})).toBe('{}\n');
    expect(serializeStamps({ a: ['1', '2'], 'b.c': ['3', '4'] })).toBe(
      '{\n  "a": ["1", "2"],\n  "b.c": ["3", "4"]\n}\n',
    );
    expect(JSON.parse(serializeStamps({ a: ['1', '2'] }))).toEqual({ a: ['1', '2'] });
  });

  it('plans files without writing them and reports a stale translation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wl-stamps-'));
    try {
      mkdirSync(join(dir, 'en'));
      const de = SECTION_SOURCES.pdf.de;
      const [first] = Object.keys(de);
      // One stamp against an older German text, so the file is unchanged but the key is stale.
      const old: Record<string, Stamp> = {};
      for (const [key, value] of Object.entries(SECTION_SOURCES.pdf.en)) {
        old[key] = key === first ? [h('older German'), h(value)] : [h(de[key]!), h(value)];
      }
      const path = join(dir, 'en', 'pdf.json');
      writeFileSync(path, serializeStamps(old));
      const [entry] = planStamps({ locales: ['en'], sections: ['pdf'], dir });
      expect(entry).toMatchObject({ changed: false, path });
      expect(entry!.report.stale).toEqual([first]);

      const [confirmed] = planStamps({ locales: ['en'], sections: ['pdf'], dir, confirm: () => true });
      expect(confirmed!.changed).toBe(true);
      expect(confirmed!.report.confirmed).toEqual([first]);
      // A missing file counts as empty: every translation is new.
      const [fresh] = planStamps({ locales: ['en'], sections: ['email'], dir });
      expect(fresh!.changed).toBe(true);
      expect(fresh!.report.added).toHaveLength(Object.keys(SECTION_SOURCES.email.en).length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a stamp file that is not made of pairs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wl-stamps-'));
    try {
      const path = join(dir, 'bad.json');
      writeFileSync(path, '{ "a": ["only one"] }');
      expect(() => readStampFile(path)).toThrow(/not a pair/);
      expect(readStampFile(join(dir, 'missing.json'))).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
