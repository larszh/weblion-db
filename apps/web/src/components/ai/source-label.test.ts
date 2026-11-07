import { describe, expect, it } from 'vitest';
import { interpolate } from '@weblion/shared';
import { de } from '@weblion/shared/i18n/de';
import type { TFunction } from '@/lib/i18n';
import { sourceLabel } from './source-label';

const t: TFunction = (key, params) => interpolate(de[key], params);

describe('sourceLabel', () => {
  it('names a section page without a title by its navigation label', () => {
    expect(sourceLabel({ label: '/o/muster-ag/domains', path: '/o/muster-ag/domains' }, t)).toBe(
      de['nav.domains'],
    );
    expect(sourceLabel({ label: '/o/muster-ag/monitoring', path: '/o/muster-ag/monitoring' }, t)).toBe(
      de['nav.uptime'],
    );
  });

  it('keeps a title the tool sent and a path it does not know', () => {
    expect(sourceLabel({ label: 'muster-ag.ch', path: '/o/muster-ag/domains/1' }, t)).toBe('muster-ag.ch');
    expect(sourceLabel({ label: '/o/muster-ag/unknown', path: '/o/muster-ag/unknown' }, t)).toBe(
      '/o/muster-ag/unknown',
    );
  });
});
