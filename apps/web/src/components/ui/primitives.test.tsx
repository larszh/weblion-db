import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Dictionary } from '@weblion/shared';
import { en } from '@weblion/shared/i18n/en';
import { fr } from '@weblion/shared/i18n/fr';
import { ApiError } from '@/lib/api';
import { I18nProvider } from '@/lib/i18n';
import { withI18n } from '@/test/i18n';
import { Flag } from '@/components/server-bits';
import { ErrorState, Spinner } from './primitives';

describe('primitives in the UI language', () => {
  it('labels the spinner in the current language, overrides first', () => {
    expect(renderToStaticMarkup(withI18n(<Spinner />))).toContain('aria-label="Loading"');
    expect(renderToStaticMarkup(withI18n(<Spinner />, 'de'))).toContain('aria-label="Wird geladen"');
    expect(renderToStaticMarkup(withI18n(<Spinner />, 'fr'))).toContain(`aria-label="${fr['aria.loading']}"`);
    // An override of the locale wins over its compiled text.
    expect(
      renderToStaticMarkup(withI18n(<Spinner />, 'fr', { 'aria.loading': 'Chargement en cours' })),
    ).toContain('aria-label="Chargement en cours"');
    // A key without a French text: English fills the gap. The French bundle here lacks the key by
    // construction and is composed like the loader composes it ({ ...en, ...fr }).
    const untranslated = Object.fromEntries(Object.entries(fr).filter(([key]) => key !== 'aria.loading'));
    const gap = renderToStaticMarkup(
      <I18nProvider
        boot={{ locale: 'fr', dictionary: { ...en, ...untranslated } as Dictionary, overrides: {} }}
      >
        <Spinner />
      </I18nProvider>,
    );
    expect(gap).toContain('aria-label="Loading"');
  });

  it('shows the API message in ErrorState (localizeError, i18n 7)', () => {
    const html = renderToStaticMarkup(
      withI18n(<ErrorState error={new ApiError(409, 'conflict', 'Already exists')} onRetry={() => {}} />),
    );
    expect(html).toContain('Already exists');
    expect(html).toContain('role="alert"');
  });
});

describe('Flag', () => {
  it('draws the flags of the five languages', () => {
    for (const country of ['DE', 'GB', 'FR', 'IT', 'NL']) {
      const html = renderToStaticMarkup(<Flag country={country} />);
      expect(html).toMatch(/^<svg /);
      expect(html).toContain('role="img"');
      expect(html).toMatch(/aria-label="[^"]+"/);
    }
  });

  it('hides a decorative flag from screen readers', () => {
    for (const country of ['GB', 'FR', 'IT', 'CH', 'XX']) {
      const html = renderToStaticMarkup(<Flag country={country} decorative />);
      expect(html).toContain('aria-hidden="true"');
      expect(html).not.toContain('role=');
      expect(html).not.toContain('aria-label');
    }
  });

  it('keeps the text badge for unknown codes', () => {
    expect(renderToStaticMarkup(<Flag country="xx" />)).toContain('>XX</span>');
  });
});
