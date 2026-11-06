import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { Locale, TranslationCellDto, TranslationEntryDto } from '@weblion/shared';
import { withI18n } from '@/test/i18n';
import {
  cellBadges,
  CellEditor,
  draftValid,
  fallbackText,
  formatUsd,
  placeholderChips,
  TranslationsTable,
} from './translations-table';
import { legalFallbacks } from './translations';

/** The texts of the translation admin as static markup (plan 2.9 web test rule, i18n 20.3). */

const html = (node: ReactNode, locale: Locale = 'de') =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>{withI18n(node, locale)}</QueryClientProvider>,
  );

const cell = (locale: Locale, patch: Partial<TranslationCellDto> = {}): TranslationCellDto => ({
  locale,
  value: null,
  compiled: null,
  origin: 'repo',
  state: 'missing',
  reviewed: true,
  demo: false,
  hidden: false,
  updatedBy: null,
  updatedAt: null,
  warnings: [],
  ...patch,
});

function entry(
  patch: Partial<TranslationEntryDto> = {},
  cells: Partial<Record<Locale, Partial<TranslationCellDto>>> = {},
) {
  const base: TranslationEntryDto = {
    key: 'servers.rename.title',
    section: 'core',
    area: 'servers',
    legal: false,
    serverOnly: false,
    placeholders: ['name'],
    cells: {
      de: cell('de', {
        value: 'Server {name} umbenennen',
        compiled: 'Server {name} umbenennen',
        state: 'current',
      }),
      en: cell('en', { value: 'Rename server {name}', compiled: 'Rename server {name}', state: 'current' }),
      fr: cell('fr'),
      it: cell('it', { value: 'Rinomina il server {name}', origin: 'ai', reviewed: false, state: 'current' }),
      nl: cell('nl', {
        value: 'Server {name} hernoemen',
        compiled: 'Server {name} hernoemen',
        state: 'stale',
      }),
    },
    ...patch,
  };
  for (const [l, p] of Object.entries(cells)) base.cells[l as Locale] = { ...base.cells[l as Locale], ...p };
  return base;
}

describe('helpers', () => {
  it('computes placeholder chips, the fallback, badges and the money format', () => {
    expect(placeholderChips('Server {name} in {zone}', 'Serveur {name} {nom}')).toEqual([
      { name: 'name', ok: true, extra: false },
      { name: 'zone', ok: false, extra: false },
      { name: 'nom', ok: false, extra: true },
    ]);
    expect(draftValid('Server {name}', 'Serveur {name}')).toBe(true);
    expect(draftValid('Server {name}', 'Serveur')).toBe(false);
    expect(draftValid('Zeile\nZeile', 'Ligne Ligne')).toBe(false);
    expect(draftValid('Text', '   ')).toBe(false);
    const e = entry();
    expect(fallbackText(e, 'fr')).toBe('Rename server {name}');
    expect(fallbackText(e, 'en')).toBe('Server {name} umbenennen');
    expect(cellBadges(e.cells.fr)).toEqual(['missing']);
    expect(cellBadges(e.cells.it)).toEqual(['ai']);
    expect(cellBadges(e.cells.nl)).toEqual(['stale']);
    expect(cellBadges(cell('fr', { value: 'x', origin: 'manual', state: 'current' }))).toEqual(['manual']);
    expect(
      cellBadges(cell('fr', { value: 'x', origin: 'ai', reviewed: false, demo: true, state: 'current' })),
    ).toEqual(['ai', 'demo']);
    expect(formatUsd(12_340_000, 'en')).toBe('12.34');
    expect(formatUsd(1_234, 'en')).toBe('0.0012');
    expect(formatUsd(0, 'en')).toBe('0.00');
  });

  it('lists the legal keys shown as a fallback per language', () => {
    expect(
      legalFallbacks({
        legal: {
          keys: ['ai.notice.title', 'ai.notice.text'],
          staleOrMissing: { fr: ['ai.notice.text'], nl: ['ai.notice.text', 'ai.notice.title'] },
        },
      }),
    ).toEqual([
      { key: 'ai.notice.title', locales: ['nl'] },
      { key: 'ai.notice.text', locales: ['fr', 'nl'] },
    ]);
  });
});

describe('TranslationsTable', () => {
  it('renders an entry as a table row from md and as a card with one row per language below md', () => {
    const out = html(<TranslationsTable entries={[entry()]} canWrite canSuggest />);
    const table = out.slice(out.indexOf('hidden md:block'), out.indexOf('md:hidden'));
    const cards = out.slice(out.indexOf('md:hidden'));
    expect(table).toContain('<table');
    expect(table).toContain('servers.rename.title');
    expect(cards).toContain('data-entry-card="servers.rename.title"');
    // One row per language in the card: five buttons with the native names.
    for (const name of ['Deutsch', 'English', 'Français', 'Italiano', 'Nederlands']) {
      expect(cards).toContain(name);
    }
    expect(cards.match(/aria-expanded=/g)).toHaveLength(5);
    // Flags are decorative: the name stands next to them.
    expect(out).toContain('aria-hidden="true"');
  });

  it('shows a missing cell with "Fehlt" and the fallback, and the badges', () => {
    const out = html(
      <TranslationsTable
        entries={[
          entry({}, { en: { origin: 'manual' } }),
          entry(
            { key: 'ai.notice.text', area: 'ai', section: 'ai', legal: true, placeholders: [] },
            { fr: { value: '[FR] Hinweis', origin: 'ai', reviewed: false, demo: true, state: 'current' } },
          ),
        ]}
        canWrite
        canSuggest
      />,
    );
    expect(out).toContain('Fehlt, angezeigt wird: Rename server {name}');
    expect(out).toContain('>Fehlt<');
    expect(out).toContain('>Veraltet<');
    expect(out).toContain('>Manuell<');
    expect(out).toContain('KI, ungeprüft');
    expect(out).toContain('>Demo<');
    expect(out).toContain('Rechtstext');
  });

  it('marks a missing placeholder red and disables "Speichern"', () => {
    const out = html(
      <TranslationsTable
        entries={[entry()]}
        canWrite
        canSuggest
        initialEditing={{ key: 'servers.rename.title', locale: 'fr' }}
        initialDraft="Renommer le serveur"
      />,
    );
    expect(out).toContain('data-chip="error"');
    expect(out).toContain('Fehlt: {name}');
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Speichern<\/button>/);
    expect(out).toContain('KI-Vorschlag');
    expect(out).toContain('Deutscher Text');
    expect(out).toContain('Englische Referenz');

    const ok = html(
      <CellEditor
        entry={entry()}
        locale="fr"
        canWrite
        canSuggest
        initialDraft="Renommer le serveur {name}"
        onClose={() => undefined}
      />,
    );
    expect(ok).toContain('data-chip="ok"');
    expect(ok).not.toContain('data-chip="error"');
    expect(ok).toMatch(/<button[^>]*>Speichern<\/button>/);
    expect(ok).not.toMatch(/<button[^>]*disabled=""[^>]*>Speichern<\/button>/);
  });

  it('shows the legal hint and no AI suggestion for a legal key', () => {
    const legal = entry(
      { key: 'ai.notice.text', area: 'ai', section: 'ai', legal: true, placeholders: [] },
      {
        de: { value: 'Ihre Anfrage geht an Claude.', compiled: 'Ihre Anfrage geht an Claude.' },
        en: { value: 'Your request goes to Claude.' },
      },
    );
    const out = html(<CellEditor entry={legal} locale="fr" canWrite canSuggest onClose={() => undefined} />);
    expect(out).toContain('Rechtstext: wird nie maschinell übersetzt.');
    expect(out).not.toContain('KI-Vorschlag');
  });

  it('is read-only without platform:i18n:write', () => {
    const out = html(
      <CellEditor
        entry={entry()}
        locale="it"
        canWrite={false}
        canSuggest={false}
        onClose={() => undefined}
      />,
    );
    expect(out).toContain('Sie können Übersetzungen ansehen, aber nicht ändern.');
    expect(out).toContain('readOnly=""');
    expect(out).not.toContain('Speichern');
    expect(out).not.toContain('Als geprüft markieren');
    expect(out).not.toContain('Auf Text aus dem Code zurücksetzen');
  });

  it('offers review, confirm and revert where they apply', () => {
    const ai = html(
      <CellEditor entry={entry()} locale="it" canWrite canSuggest={false} onClose={() => undefined} />,
    );
    expect(ai).toContain('Als geprüft markieren');
    expect(ai).toContain('Auf Text aus dem Code zurücksetzen');
    expect(ai).not.toContain('KI-Vorschlag');
    const stale = html(
      <CellEditor entry={entry()} locale="nl" canWrite canSuggest onClose={() => undefined} />,
    );
    expect(stale).toContain('Als aktuell bestätigen');
    expect(stale).not.toContain('Auf Text aus dem Code zurücksetzen');
  });
});
