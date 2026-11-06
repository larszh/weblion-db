import { describe, expect, it } from 'vitest';

/**
 * The source-time half of the chunk rule (i18n 5.4, 20.3): dictionaries reach the web only through the lazy
 * loader, so the entry chunk carries none, and the server texts (email, pdf, the catalog) never reach a
 * browser. Read through import.meta.glob, not node:fs: the web tsconfig has only vite/client types.
 */
const SOURCES = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const isTest = (path: string) => /\.test\.tsx?$/.test(path);
const DICTIONARY_IMPORT = /['"]@weblion\/shared\/i18n\/(de|en|fr|it|nl|catalog)['"]/;
const SERVER_IMPORT = /['"]@weblion\/shared\/i18n\/server['"]/;
const SECTION_IMPORT = /['"]@weblion\/shared\/i18n\/sections\//;

describe('dictionary imports in the web', () => {
  const files = Object.keys(SOURCES);

  it('finds the sources', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain('/src/lib/i18n-loader.ts');
  });

  it('imports dictionaries only in the loader, the test helper and tests', () => {
    const allowed = new Set(['/src/lib/i18n-loader.ts', '/src/test/i18n.tsx']);
    const offenders = files.filter(
      (f) => DICTIONARY_IMPORT.test(SOURCES[f]!) && !allowed.has(f) && !isTest(f),
    );
    expect(offenders).toEqual([]);
  });

  it('never imports the server texts or a section file, not even in tests', () => {
    const offenders = files.filter(
      (f) =>
        f !== '/src/lib/i18n-imports.test.ts' &&
        (SERVER_IMPORT.test(SOURCES[f]!) || SECTION_IMPORT.test(SOURCES[f]!)),
    );
    expect(offenders).toEqual([]);
  });

  it('has no file left under src/i18n/ (moved to packages/shared)', () => {
    expect(files.filter((f) => f.startsWith('/src/i18n/'))).toEqual([]);
  });

  it('loads every locale through a dynamic import in the loader', () => {
    const loader = SOURCES['/src/lib/i18n-loader.ts']!;
    for (const locale of ['de', 'en', 'fr', 'it', 'nl']) {
      expect(loader).toContain(`import('@weblion/shared/i18n/${locale}')`);
    }
    expect(loader).not.toMatch(/^import .* from '@weblion\/shared\/i18n\/(de|en|fr|it|nl)'/m);
  });
});
