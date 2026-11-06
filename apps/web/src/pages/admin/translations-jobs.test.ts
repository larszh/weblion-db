import { describe, expect, it } from 'vitest';
import { interpolate } from '@weblion/shared';
import { de } from '@weblion/shared/i18n/de';
import type { TFunction } from '@/lib/i18n';
import { failureDetailText } from './translations-jobs';

/** The failure details of a job in the console's language: only the language-neutral parts of the API's English. */

const t: TFunction = (key, params) => interpolate(de[key], params);

describe('failureDetailText', () => {
  it('shows placeholder names with the texts of the placeholder chips', () => {
    expect(
      failureDetailText(t, {
        reason: 'placeholders',
        detail: 'missing {remaining}, extra {n}, 2 line breaks instead of 1',
      }),
    ).toBe('Fehlt: {remaining}, Nicht im deutschen Text: {n}');
    expect(failureDetailText(t, { reason: 'placeholders', detail: '0 line breaks instead of 1' })).toBeNull();
  });

  it('keeps only the value of the other details and drops English sentences', () => {
    expect(failureDetailText(t, { reason: 'content', detail: 'new URL https://x.example' })).toBe(
      'https://x.example',
    );
    expect(failureDetailText(t, { reason: 'glossary', detail: 'glossary term Rechnung, Guthaben' })).toBe(
      'Rechnung, Guthaben',
    );
    expect(failureDetailText(t, { reason: 'formality', detail: 'informal word "tu"' })).toBe('tu');
    expect(failureDetailText(t, { reason: 'characters', detail: 'forbidden character ß' })).toBe('ß');
    expect(
      failureDetailText(t, { reason: 'characters', detail: 'ASCII space before ":" (use a no-break space)' }),
    ).toBeNull();
    expect(failureDetailText(t, { reason: 'length', detail: 'longer than 22 characters' })).toBeNull();
    expect(failureDetailText(t, { reason: 'error', detail: 'the request failed' })).toBeNull();
    expect(failureDetailText(t, { reason: 'refusal', detail: null })).toBeNull();
  });
});
