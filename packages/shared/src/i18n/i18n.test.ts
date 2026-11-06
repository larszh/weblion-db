import { describe, expect, it } from 'vitest';
import { LEGAL_KEYS } from '../translations';
import { buildCatalog, loadCatalog } from './catalog';
import {
  ALLOWLIST_FILES,
  allowlistFor,
  checkValue,
  duplicateKeys,
  fixFrenchTypography,
  glossaryProblems,
  hasEmDash,
  hasSharpS,
  incompleteLocales,
  informalWord,
  legalProblems,
  lengthLimit,
  lengthOk,
  looksGerman,
  missingKeys,
  placeholdersMatch,
  typographyProblems,
  unknownKeys,
} from './checks';
import { de } from './de';
import { en } from './en';
import { fr } from './fr';
import { DEFAULT_GLOSSARY } from './glossary';
import { interpolate } from './interpolate';
import { it as itBundle } from './it';
import { fallbackChain, intlLocale, LOCALES, matchLocale, normalizeLocale, TARGET_LOCALES } from './locales';
import type { Locale, TargetLocale } from './locales';
import { nl } from './nl';
import { comparePlaceholders, lineBreakCount, placeholdersOf } from './placeholders';
import { SECTION_GROUPS, SECTIONS, SERVER_ONLY_SECTIONS, WEB_SECTIONS } from './sections';
import { SECTION_SOURCES, serverDe, serverEn } from './server';

// packages/shared has no Node types; vitest runs in Node, so process exists (i18n 4.3).
declare const process: { env: Record<string, string | undefined> };

/** I18N_REQUIRE_COMPLETE: "1" or "true" = fr, it, nl; a comma list = those locales; unset = none. */
function requiredLocales(): TargetLocale[] {
  const raw = (process.env.I18N_REQUIRE_COMPLETE ?? '').trim().toLowerCase();
  if (!raw || raw === '0' || raw === 'false') return [];
  if (raw === '1' || raw === 'true') return ['fr', 'it', 'nl'];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is TargetLocale => (TARGET_LOCALES as readonly string[]).includes(s) && s !== 'en');
}

const HEURISTIC_LOCALES = ['fr', 'it', 'nl'] as const;
const GROUP_OF = Object.fromEntries(
  Object.entries(SECTION_GROUPS).flatMap(([group, sections]) => sections.map((s) => [s, group])),
) as Record<(typeof SECTIONS)[number], 'a' | 'b' | 'c'>;

/** Where to add an allowlist entry for a key of a section (named in every failure message). */
const allowlistFile = (locale: string, section: string) =>
  `packages/shared/src/i18n/allowlists/${locale}/${GROUP_OF[section as (typeof SECTIONS)[number]]}.ts`;

const entries = (texts: Readonly<Record<string, string | undefined>>) =>
  Object.entries(texts).filter((e): e is [string, string] => typeof e[1] === 'string');

describe('locales', () => {
  it('normalizes stored and browser values', () => {
    expect(normalizeLocale('fr')).toBe('fr');
    expect(normalizeLocale('FR')).toBe('fr');
    expect(normalizeLocale('fr-CH')).toBe('fr');
    expect(normalizeLocale('fr_CH')).toBe('fr');
    expect(normalizeLocale('EN-gb')).toBe('en');
    expect(normalizeLocale('gsw')).toBe('de');
    expect(normalizeLocale('gsw-CH')).toBe('de');
    expect(normalizeLocale('es')).toBeNull();
    expect(normalizeLocale('')).toBeNull();
    expect(normalizeLocale(null)).toBeNull();
    expect(normalizeLocale(42)).toBeNull();
  });

  it('matches the first supported browser language and falls back to English', () => {
    expect(matchLocale(['es-ES', 'it-CH', 'de'])).toBe('it');
    expect(matchLocale(['es', 'pt'])).toBe('en');
    expect(matchLocale([], 'de')).toBe('de');
  });

  it('falls back from fr, it, nl to English, then German', () => {
    expect(fallbackChain('fr')).toEqual(['fr', 'en', 'de']);
    expect(fallbackChain('it')).toEqual(['it', 'en', 'de']);
    expect(fallbackChain('nl')).toEqual(['nl', 'en', 'de']);
    expect(fallbackChain('en')).toEqual(['en', 'de']);
    expect(fallbackChain('de')).toEqual(['de']);
  });

  it('uses the Swiss variants for de, fr, it and en-GB, nl-NL', () => {
    expect(LOCALES.map(intlLocale)).toEqual(['de-CH', 'en-GB', 'fr-CH', 'it-CH', 'nl-NL']);
  });
});

describe('interpolate and placeholders', () => {
  it('replaces known placeholders and keeps unknown ones', () => {
    expect(interpolate('Hallo {name}, {count} neu', { name: 'Anna', count: 3 })).toBe('Hallo Anna, 3 neu');
    expect(interpolate('{a} {b}', { a: null })).toBe(' {b}');
    expect(interpolate('{ "a": 1 } {x}', { a: 'no' })).toBe('{ "a": 1 } {x}');
    expect(interpolate('{x}')).toBe('{x}');
  });

  it('lists placeholders in order with duplicates and compares them as multisets', () => {
    expect(placeholdersOf('{a} und {b_2} und {a}, nicht { "a": 1 } oder {9x}')).toEqual(['a', 'b_2', 'a']);
    expect(comparePlaceholders('{a} {a} {b}', '{a} {c}')).toEqual({ missing: ['a', 'b'], extra: ['c'] });
    expect(comparePlaceholders('{a} {b}', '{b} {a}')).toEqual({ missing: [], extra: [] });
    expect(lineBreakCount('a\nb\n\nc')).toBe(3);
  });
});

describe('catalog', () => {
  const catalog = loadCatalog();

  it('lists every key in German order, section by section', () => {
    const expected = SECTIONS.flatMap((s) => Object.keys(SECTION_SOURCES[s].de));
    expect(catalog.keys).toEqual(expected);
    expect(catalog.sections).toEqual([...SECTIONS]);
    expect(catalog.keys[0]).toBe(Object.keys(SECTION_SOURCES.core.de)[0]);
  });

  it('knows the section of a key and the server-only keys', () => {
    expect(catalog.sectionOf('common.save')).toBe('core');
    expect(catalog.sectionOf('ai.notice.text')).toBe('ai');
    expect(catalog.sectionOf('admin.ai.subtitle')).toBe('ai');
    expect(catalog.sectionOf('admin.i18n.description')).toBe('translations');
    expect(catalog.sectionOf('email.layout.footer')).toBe('email');
    expect(catalog.sectionOf('nope')).toBeUndefined();
    expect(catalog.has('pdf.invoice.title')).toBe(true);
    expect(catalog.serverOnly.has('pdf.invoice.title')).toBe(true);
    expect(catalog.serverOnly.has('common.save')).toBe(false);
    expect(catalog.bundles.de['common.save']).toBe(de['common.save']);
    expect(catalog.bundles.en['email.layout.footer']).toBe(serverEn['email.layout.footer']);
  });

  it('builds small catalogs from a few sections and stamps', () => {
    const small = buildCatalog(
      {
        core: {
          de: { 'a.one': 'Eins', 'a.two': 'Zwei' },
          en: { 'a.one': 'One' },
          fr: { 'a.one': 'Un', 'x.y': 'Z' },
        },
        email: { de: { 'email.x': 'Mail' } },
      },
      { en: { core: { 'a.one': ['0123456789abcdef', 'fedcba9876543210'] } }, fr: {}, it: {}, nl: {} },
    );
    expect(small.keys).toEqual(['a.one', 'a.two', 'email.x']);
    expect(small.sections).toEqual(['core', 'email']);
    expect(small.bundles.fr).toEqual({ 'a.one': 'Un' });
    expect((small.stamps.en as Record<string, unknown>)['a.one']).toEqual([
      '0123456789abcdef',
      'fedcba9876543210',
    ]);
    expect([...small.serverOnly]).toEqual(['email.x']);
  });

  it('keeps email and pdf out of the web aggregators', () => {
    expect(WEB_SECTIONS).toEqual(SECTIONS.filter((s) => s !== 'email' && s !== 'pdf'));
    for (const key of Object.keys(de)) expect(key).not.toMatch(/^(email|pdf)\./);
    const webKeys = WEB_SECTIONS.flatMap((s) => Object.keys(SECTION_SOURCES[s].de));
    expect(Object.keys(de).sort()).toEqual([...webKeys].sort());
    const serverKeys = SECTIONS.flatMap((s) => Object.keys(SECTION_SOURCES[s].de));
    expect(Object.keys(serverDe).sort()).toEqual([...serverKeys].sort());
    expect(SERVER_ONLY_SECTIONS).toEqual(['email', 'pdf']);
  });
});

describe('check 1: key parity', () => {
  it('defines no key in two sections', () => {
    const germanSections = Object.fromEntries(SECTIONS.map((s) => [s, SECTION_SOURCES[s].de]));
    expect(duplicateKeys(germanSections), 'keys defined in more than one sections/<s>.de.ts').toEqual([]);
  });

  for (const section of SECTIONS) {
    const source = SECTION_SOURCES[section].de;
    it(`en has exactly the German keys of ${section}`, () => {
      const bundle = SECTION_SOURCES[section].en;
      expect(missingKeys(source, bundle), `missing in sections/${section}.en.ts`).toEqual([]);
      expect(unknownKeys(source, bundle), `not in sections/${section}.de.ts`).toEqual([]);
    });
    for (const locale of HEURISTIC_LOCALES) {
      it(`${locale} has no key outside German in ${section}`, () => {
        const bundle = SECTION_SOURCES[section][locale];
        expect(unknownKeys(source, bundle), `remove from sections/${section}.${locale}.ts`).toEqual([]);
      });
    }
  }

  for (const locale of HEURISTIC_LOCALES) {
    for (const [group, sections] of Object.entries(SECTION_GROUPS) as [
      'a' | 'b' | 'c',
      readonly string[],
    ][]) {
      it(`allowlists/${locale}/${group}.ts names only keys of its sections`, () => {
        const known = new Set(
          sections.flatMap((s) => Object.keys(SECTION_SOURCES[s as keyof typeof SECTION_SOURCES].de)),
        );
        const file = ALLOWLIST_FILES[locale][group];
        const unknown = Object.values(file)
          .flatMap((keys) => keys ?? [])
          .filter((key) => !known.has(key));
        expect(unknown, `stale entries in allowlists/${locale}/${group}.ts`).toEqual([]);
      });
    }
  }
});

describe('check 2: placeholders and line breaks', () => {
  for (const locale of ['en', ...HEURISTIC_LOCALES] as const) {
    for (const section of SECTIONS) {
      it(`${locale} ${section}`, () => {
        const source = SECTION_SOURCES[section].de;
        const problems = entries(SECTION_SOURCES[section][locale])
          .filter(([key]) => key in source)
          .map(([key, value]) => ({ key, value, ...placeholdersMatch(source[key]!, value) }))
          .filter((r) => !r.ok)
          .map(
            (r) =>
              `${r.key}: missing ${r.missing.join(', ') || '-'}, extra ${r.extra.join(', ') || '-'}, line breaks ${r.lineBreaks ? 'ok' : 'differ'}`,
          );
        expect(problems, `fix in sections/${section}.${locale}.ts`).toEqual([]);
      });
    }
  }
});

/** One soft check over the repository bundles of fr, it, nl with the allowlists. */
function softCheck(
  name: string,
  field: 'germanOk' | 'informalOk' | 'lengthOk' | 'glossaryOk' | 'typographyOk',
  locales: readonly ('fr' | 'it' | 'nl')[],
  fails: (source: string, value: string, locale: 'fr' | 'it' | 'nl') => string | null,
) {
  describe(name, () => {
    for (const locale of locales) {
      const allow = new Set(allowlistFor(locale)[field]);
      for (const section of SECTIONS) {
        it(`${locale} ${section}`, () => {
          const source = SECTION_SOURCES[section].de;
          const problems = entries(SECTION_SOURCES[section][locale])
            .filter(([key]) => key in source && !allow.has(key))
            .map(([key, value]) => {
              const why = fails(source[key]!, value, locale);
              return why === null ? null : `${key}: ${why}: ${JSON.stringify(value)}`;
            })
            .filter((p): p is string => p !== null);
          expect(
            problems,
            `fix the texts or add the keys to ${field} in ${allowlistFile(locale, section)}`,
          ).toEqual([]);
        });
      }
    }
  });
}

softCheck('check 3: leftover German', 'germanOk', HEURISTIC_LOCALES, (source, value, locale) =>
  looksGerman(value, source, locale) ? 'looks German' : null,
);
softCheck('check 4: informal address', 'informalOk', HEURISTIC_LOCALES, (_source, value, locale) => {
  const word = informalWord(value, locale);
  return word ? `informal "${word}"` : null;
});
softCheck('check 5: length', 'lengthOk', HEURISTIC_LOCALES, (source, value) =>
  lengthOk(source, value) ? null : `${value.length} characters, limit ${lengthLimit(source)}`,
);
softCheck('check 6: glossary terms', 'glossaryOk', HEURISTIC_LOCALES, (source, value, locale) => {
  const terms = glossaryProblems(source, value, locale, DEFAULT_GLOSSARY);
  return terms.length ? `glossary terms ${terms.join(', ')}` : null;
});
softCheck('check 11: French typography', 'typographyOk', ['fr'], (_source, value) => {
  const problems = typographyProblems(value);
  return problems.length ? problems.join('; ') : null;
});

describe('checks 7 and 8: no sharp s, no em dash', () => {
  for (const locale of LOCALES) {
    for (const section of SECTIONS) {
      it(`${locale} ${section}`, () => {
        const bad = entries(SECTION_SOURCES[section][locale])
          .filter(([, value]) => hasSharpS(value) || hasEmDash(value))
          .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
        expect(bad, `use ss and a comma, colon or parentheses in sections/${section}.${locale}.ts`).toEqual(
          [],
        );
      });
    }
  }
});

describe('check 9: completeness (I18N_REQUIRE_COMPLETE)', () => {
  const required = requiredLocales();
  it.skipIf(required.length === 0)(
    `fr, it, nl have every key (${required.join(', ') || 'not required'})`,
    () => {
      for (const section of SECTIONS) {
        const bundles = Object.fromEntries(required.map((l) => [l, SECTION_SOURCES[section][l]]));
        const missing = incompleteLocales(bundles, SECTION_SOURCES[section].de, required);
        expect(missing, `missing keys in sections/${section}.<locale>.ts`).toEqual({});
      }
    },
  );
});

describe('check 10: legal keys', () => {
  it('en has every legal key', () => {
    expect(legalProblems({ en: en as Record<string, string> }, ['en'])).toEqual([]);
    for (const key of LEGAL_KEYS) expect(key in de).toBe(true);
  });

  const required = requiredLocales();
  it.skipIf(required.length === 0)(`legal keys are translated in ${required.join(', ') || '-'}`, () => {
    const bundles: Partial<Record<Locale, Readonly<Record<string, string | undefined>>>> = {
      fr,
      it: itBundle,
      nl,
    };
    expect(legalProblems(bundles, required)).toEqual([]);
  });
});

describe('glossary', () => {
  it('has unique terms (translation_glossary has a unique index on lower(term))', () => {
    const lower = DEFAULT_GLOSSARY.map((g) => g.term.toLowerCase());
    expect(lower.filter((term, i) => lower.indexOf(term) !== i)).toEqual([]);
  });

  it('keeps names without translations and translates every other term into all four languages', () => {
    for (const entry of DEFAULT_GLOSSARY) {
      if (entry.keep) expect(entry.translations, entry.term).toEqual({});
      else expect(Object.keys(entry.translations).sort(), entry.term).toEqual([...TARGET_LOCALES].sort());
    }
    for (const name of ['Anthropic', 'Claude', 'Claude Opus 5.5', 'Claude Console', 'USD', 'CHF']) {
      expect(DEFAULT_GLOSSARY.find((g) => g.term === name)?.keep, name).toBe(true);
    }
    expect(DEFAULT_GLOSSARY.find((g) => g.term === 'KI')?.translations).toEqual({
      en: 'AI',
      fr: 'IA',
      it: 'IA',
      nl: 'AI',
    });
  });

  it('contains no sharp s and no em dash', () => {
    for (const entry of DEFAULT_GLOSSARY) {
      for (const text of [entry.term, entry.note ?? '', ...Object.values(entry.translations)]) {
        expect(hasSharpS(text) || hasEmDash(text), text).toBe(false);
      }
    }
  });
});

describe('check predicates', () => {
  it('finds placeholder and line break differences', () => {
    expect(placeholdersMatch('{a} von {b}', '{b} of {a}').ok).toBe(true);
    expect(placeholdersMatch('{a}\n{b}', '{a} {b}')).toMatchObject({ ok: false, lineBreaks: false });
    expect(placeholdersMatch('{a}', '{A}')).toMatchObject({ ok: false, missing: ['a'], extra: ['A'] });
  });

  it('recognizes German leftovers', () => {
    expect(looksGerman('Serveur gelöscht', 'Server gelöscht', 'fr')).toBe(true); // ö
    expect(looksGerman('Bitte warten und speichern', 'Bitte warten', 'it')).toBe(true); // markers
    expect(looksGerman('Annuler et enregistrer', 'Abbrechen', 'fr')).toBe(false);
    expect(looksGerman('Coördinatie', 'Koordination', 'nl')).toBe(false); // Dutch diaeresis
    expect(looksGerman('Er werden noch fouten gevonden', 'Fehler', 'nl')).toBe(false); // Dutch words
    expect(looksGerman('Server ist offline', 'Server ist offline', 'it')).toBe(true); // copied German
    expect(looksGerman('Sie {count}', 'x', 'fr')).toBe(false); // one marker only
  });

  it('recognizes informal address', () => {
    expect(informalWord('Vous pouvez enregistrer', 'fr')).toBeNull();
    expect(informalWord('Tu peux enregistrer', 'fr')).toBe('Tu');
    expect(informalWord("Pour t'inscrire", 'fr')).toBe("t'");
    expect(informalWord('Puoi salvare il tuo file', 'it')).toBe('tuo');
    expect(informalWord('Sla je bestand op', 'nl')).toBe('je');
    expect(informalWord('Sla uw bestand op', 'nl')).toBeNull();
    expect(informalWord('Hello {tu}', 'fr')).toBeNull();
  });

  it('limits the length', () => {
    expect(lengthLimit('Speichern')).toBe(Math.round(1.8 * 9) + 6);
    expect(lengthLimit('x'.repeat(40))).toBe(70);
    expect(lengthOk('Speichern', 'Enregistrer')).toBe(true);
    expect(lengthOk('OK', 'x'.repeat(20))).toBe(false);
  });

  it('applies glossary terms as words of their own', () => {
    expect(glossaryProblems('Server löschen', 'Supprimer le serveur', 'fr', DEFAULT_GLOSSARY)).toEqual([]);
    expect(glossaryProblems('Server löschen', 'Supprimer la machine', 'fr', DEFAULT_GLOSSARY)).toEqual([
      'Server',
    ]);
    expect(glossaryProblems('Servern', 'machines', 'fr', DEFAULT_GLOSSARY)).toEqual([]);
    expect(glossaryProblems('Mit Cloudflare', 'Avec CloudFlare', 'fr', DEFAULT_GLOSSARY)).toEqual([
      'Cloudflare',
    ]);
    expect(glossaryProblems('KI-Assistent', 'assistant IA', 'fr', DEFAULT_GLOSSARY)).toEqual([]);
  });

  it('finds forbidden characters', () => {
    expect(hasSharpS('Grüsse')).toBe(false);
    expect(hasSharpS('Grü\u00DFe')).toBe(true);
    expect(hasEmDash('a, b')).toBe(false);
    expect(hasEmDash('a \u2014 b')).toBe(true);
  });

  it('checks and fixes French spacing', () => {
    expect(typographyProblems('Statut\u00A0: actif, 12\u00A0%, voir https://x.ch, {count}\u00A0?')).toEqual([
      'space before "?"',
    ]);
    expect(typographyProblems('Statut : 12 %')).toHaveLength(2);
    expect(typographyProblems('Vraiment ?')).toEqual(['space before "?"']);
    expect(typographyProblems('Vraiment?')).toEqual([]);
    expect(fixFrenchTypography('Statut : 12 % ! Oui ; non  ? https://x.ch')).toBe(
      'Statut\u00A0: 12\u00A0%! Oui; non? https://x.ch',
    );
    expect(typographyProblems(fixFrenchTypography('A : b ? c ; d !'))).toEqual([]);
  });

  it('runs the hard checks everywhere and the soft checks for fr, it and nl', () => {
    const base = { key: 'x.y', glossary: DEFAULT_GLOSSARY };
    expect(
      checkValue({ ...base, source: '{a} Server', value: 'Server \u2014 \u00DF', locale: 'en' }),
    ).toEqual({
      hard: ['placeholders', 'sharpS', 'emDash'],
      soft: [],
    });
    expect(
      checkValue({ ...base, source: 'Server löschen', value: 'Tu supprimes la machine : ok', locale: 'fr' }),
    ).toEqual({ hard: [], soft: ['formality', 'glossary', 'typography'] });
    expect(
      checkValue({
        ...base,
        source: 'Server löschen',
        value: 'Tu supprimes la machine : ok',
        locale: 'fr',
        skipLanguage: true,
      }),
    ).toEqual({ hard: [], soft: ['typography'] });
    expect(checkValue({ ...base, source: 'Abbrechen', value: 'Annulla', locale: 'it' })).toEqual({
      hard: [],
      soft: [],
    });
  });

  it('merges the allowlists of a locale and has none for English', () => {
    expect(allowlistFor('en')).toEqual({
      germanOk: [],
      informalOk: [],
      lengthOk: [],
      glossaryOk: [],
      typographyOk: [],
    });
    expect(Object.keys(allowlistFor('fr')).sort()).toEqual(
      ['germanOk', 'glossaryOk', 'informalOk', 'lengthOk', 'typographyOk'].sort(),
    );
  });

  it('reports missing keys per locale and missing legal texts', () => {
    expect(incompleteLocales({ fr: { a: 'x' } }, { a: 'A', b: 'B' }, ['fr', 'it'])).toEqual({
      fr: ['b'],
      it: ['a', 'b'],
    });
    expect(legalProblems({ fr: { 'ai.notice.title': 'Avis' } }, ['fr'])).toEqual(['fr: ai.notice.text']);
  });
});
