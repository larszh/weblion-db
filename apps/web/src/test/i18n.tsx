import type { ReactElement, ReactNode } from 'react';
import type { Dictionary, Locale } from '@weblion/shared';
import { de } from '@weblion/shared/i18n/de';
import { en } from '@weblion/shared/i18n/en';
import { fr } from '@weblion/shared/i18n/fr';
import { it } from '@weblion/shared/i18n/it';
import { nl } from '@weblion/shared/i18n/nl';
import { I18nProvider } from '@/lib/i18n';

/** fr, it and nl are partial: English fills their gaps, as in the app. */
const DICTIONARIES: Record<Locale, Dictionary> = {
  de,
  en,
  fr: { ...en, ...fr },
  it: { ...en, ...it },
  nl: { ...en, ...nl },
};

/**
 * Wraps a node for a static render test (renderToStaticMarkup) in the I18nProvider of one locale, English by
 * default, optionally with overrides of that locale (as the translation admin saves them).
 */
export function withI18n(
  node: ReactNode,
  locale: Locale = 'en',
  overrides?: Record<string, string>,
): ReactElement {
  return (
    <I18nProvider
      boot={{ locale, dictionary: DICTIONARIES[locale], overrides: overrides ? { [locale]: overrides } : {} }}
    >
      {node}
    </I18nProvider>
  );
}
