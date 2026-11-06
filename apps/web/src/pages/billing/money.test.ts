import { describe, expect, it } from 'vitest';
import { BILLING_INTERVALS, interpolate, LOCALES, type TranslationKey } from '@weblion/shared';
import { de } from '@weblion/shared/i18n/de';
import { en } from '@weblion/shared/i18n/en';
import type { TFunction } from '@/lib/i18n';
import { formatQuantity, formatRate, parseMoney, unitForInterval } from './money';

const tFor =
  (dict: Record<string, string>): TFunction =>
  (key: TranslationKey, params) =>
    interpolate(dict[key] ?? key, params);

describe('parseMoney', () => {
  it('reads Swiss, Dutch and French input', () => {
    expect(parseMoney('19.90')).toBe(1990);
    expect(parseMoney('19,90')).toBe(1990);
    expect(parseMoney("1'250.50")).toBe(125050);
    expect(parseMoney('1’250.50')).toBe(125050);
    expect(parseMoney('1 250,50')).toBe(125050);
    expect(parseMoney('-5')).toBe(-500);
  });

  it('never reads Dutch or French thousands separators as decimals (review finding 18)', () => {
    // Three decimals are no amount, so "1.250" cannot become 1.25 and "12.500" not 12.5.
    expect(parseMoney('1.250')).toBeNull();
    expect(parseMoney('12.500')).toBeNull();
    // Two separators are refused as well.
    expect(parseMoney('1.250,50')).toBeNull();
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
  });
});

describe('unitForInterval', () => {
  it('takes the unit from the billing.unit.* keys', () => {
    expect(unitForInterval('once', tFor(de))).toBe('Stk.');
    expect(unitForInterval('monthly', tFor(de))).toBe('Monat');
    expect(unitForInterval('quarterly', tFor(en))).toBe('quarter');
    expect(unitForInterval('yearly', tFor(en))).toBe('year');
    for (const interval of BILLING_INTERVALS) {
      expect(unitForInterval(interval, tFor(en))).toBe(en[`billing.unit.${interval}`]);
    }
  });
});

describe('formatRate and formatQuantity', () => {
  it('format with the Intl tag of each locale', () => {
    expect(formatRate(810, 'de')).toBe('8.1 %');
    expect(formatRate(810, 'en')).toBe('8.1 %');
    expect(formatRate(810, 'fr')).toBe('8,1 %');
    expect(formatRate(810, 'nl')).toBe('8,1 %');
    expect(formatQuantity(1.5, 'it')).toBe(new Intl.NumberFormat('it-CH').format(1.5));
    expect(formatQuantity(1.5, 'nl')).toBe('1,5');
    for (const locale of LOCALES) expect(formatQuantity(2, locale)).toBe('2');
  });
});
