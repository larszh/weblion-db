import { describe, expect, it } from 'vitest';
import {
  entriesQueryOf,
  failuresHref,
  nextQuery,
  parseKeys,
  parseTranslationsQuery,
  translationsHref,
  translationsQueryString,
} from './translations-query';

/** The URL contract of /admin/translations (i18n 17.1, plan 2.9, O18). */

const parse = (qs: string) => parseTranslationsQuery(new URLSearchParams(qs));

describe('translations query', () => {
  it('parses every parameter and serializes it back', () => {
    const qs =
      'tab=entries&q=Rechnung&locale=fr&filter=untranslated&area=admin&section=core&keys=common.save%2Cnav.billing&page=2';
    const query = parse(qs);
    expect(query).toEqual({
      tab: 'entries',
      q: 'Rechnung',
      locale: 'fr',
      filter: 'untranslated',
      area: 'admin',
      section: 'core',
      keys: 'common.save,nav.billing',
      page: 2,
    });
    expect(parse(translationsQueryString(query))).toEqual(query);
    const job = parse('tab=jobs&job=0b7a2c1e-1234-4abc-9def-0123456789ab');
    expect(job).toEqual({ tab: 'jobs', job: '0b7a2c1e-1234-4abc-9def-0123456789ab' });
    expect(parse(translationsQueryString(job))).toEqual(job);
  });

  it('drops the defaults', () => {
    expect(translationsQueryString({ tab: 'overview', locale: 'any', filter: 'all', page: 1 })).toBe('');
    expect(translationsHref({ tab: 'overview' })).toBe('/admin/translations');
    expect(translationsQueryString({ tab: 'entries', locale: 'any', q: 'x' })).toBe('tab=entries&q=x');
  });

  it('falls back to the defaults for unknown values', () => {
    expect(parse('tab=nope&locale=es&filter=bogus&section=nope&area=%3Cscript%3E&job=1&page=-3')).toEqual({
      tab: 'overview',
    });
    expect(parse('page=0')).toEqual({ tab: 'overview' });
    expect(parse('page=2.5')).toEqual({ tab: 'overview' });
    expect(parse('locale=any')).toEqual({ tab: 'overview', locale: 'any' });
    expect(parse('q=%20%20')).toEqual({ tab: 'overview' });
  });

  it('reads the link of the KI page to the data notice', () => {
    const query = parse('tab=entries&q=ai.notice.text');
    expect(query).toEqual({ tab: 'entries', q: 'ai.notice.text' });
    expect(entriesQueryOf(query)).toMatchObject({
      q: 'ai.notice.text',
      locale: 'any',
      filter: 'all',
      page: 1,
    });
  });

  it('takes a comma list of keys, without malformed ones, at most 500', () => {
    expect(parseKeys('common.save, nav.billing,,<b>,perm.platform:i18n:read')).toEqual([
      'common.save',
      'nav.billing',
      'perm.platform:i18n:read',
    ]);
    const many = Array.from({ length: 600 }, (_, i) => `k.k${i}`).join(',');
    expect(parseKeys(many)).toHaveLength(500);
    expect(entriesQueryOf(parse('keys=a.b,c.d')).keys).toEqual(['a.b', 'c.d']);
    expect(entriesQueryOf(parse('')).keys).toBeUndefined();
  });

  it('resets the page when a filter changes and keeps it otherwise', () => {
    const current = parse('tab=entries&filter=stale&page=3');
    expect(nextQuery(current, { filter: 'untranslated' })).toEqual({
      tab: 'entries',
      filter: 'untranslated',
    });
    expect(nextQuery(current, { q: 'facture' })).toEqual({ tab: 'entries', filter: 'stale', q: 'facture' });
    expect(nextQuery(current, { page: 4 })).toEqual({ tab: 'entries', filter: 'stale', page: 4 });
    expect(nextQuery(current, { filter: 'stale' })).toEqual(current);
    expect(nextQuery(current, { tab: 'jobs' })).toEqual({ tab: 'jobs', filter: 'stale', page: 3 });
    expect(nextQuery(current, { filter: undefined })).toEqual({ tab: 'entries' });
  });

  it('links the failures of a job to the entries tab', () => {
    expect(
      failuresHref([
        { key: 'common.save', locale: 'fr' },
        { key: 'nav.billing', locale: 'fr' },
        { key: 'common.save', locale: 'fr' },
      ]),
    ).toBe('/admin/translations?tab=entries&locale=fr&keys=common.save%2Cnav.billing');
    expect(
      failuresHref([
        { key: 'common.save', locale: 'fr' },
        { key: 'common.save', locale: 'it' },
      ]),
    ).toBe('/admin/translations?tab=entries&keys=common.save');
  });
});
