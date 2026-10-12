import { describe, expect, it } from 'vitest';
import { GIB, MAX_MIB, MIB, formatMailSize, fromBytes, toMib } from './units';

describe('toMib', () => {
  it('converts GB and MB to whole MiB', () => {
    expect(toMib('2', 'GB')).toBe(2048);
    expect(toMib('2.5', 'GB')).toBe(2560);
    expect(toMib('2,5', 'GB')).toBe(2560);
    expect(toMib('500', 'MB')).toBe(500);
    expect(toMib(' 10 ', 'GB')).toBe(10_240);
    expect(toMib('1.0', 'MB')).toBe(1);
    expect(toMib('0.5', 'GB')).toBe(512);
    // 1/1024 GB is exactly one MB.
    expect(toMib('0.0009765625', 'GB')).toBe(1);
  });

  it('refuses values that are no whole number of MB', () => {
    expect(toMib('0.0001', 'GB')).toBeNull();
    expect(toMib('1.5', 'MB')).toBeNull();
    expect(toMib('1.1', 'GB')).toBeNull();
    expect(toMib('0.3', 'GB')).toBeNull();
  });

  it('refuses empty, invalid, too small and too large values', () => {
    expect(toMib('', 'GB')).toBeNull();
    expect(toMib('   ', 'MB')).toBeNull();
    expect(toMib('abc', 'GB')).toBeNull();
    expect(toMib('-2', 'GB')).toBeNull();
    expect(toMib('2e3', 'MB')).toBeNull();
    expect(toMib('1.', 'GB')).toBeNull();
    expect(toMib('.5', 'GB')).toBeNull();
    expect(toMib('1.000.000', 'MB')).toBeNull();
    expect(toMib('0', 'MB')).toBeNull();
    expect(toMib('0', 'GB')).toBeNull();
    expect(toMib(String(MAX_MIB), 'MB')).toBe(MAX_MIB);
    expect(toMib(String(MAX_MIB + 1), 'MB')).toBeNull();
    expect(toMib('10000', 'GB')).toBeNull();
  });
});

describe('fromBytes', () => {
  it('picks GB for whole GB and MB otherwise', () => {
    expect(fromBytes(10 * GIB)).toEqual({ value: '10', unit: 'GB' });
    expect(fromBytes(2048 * MIB)).toEqual({ value: '2', unit: 'GB' });
    expect(fromBytes(2560 * MIB)).toEqual({ value: '2560', unit: 'MB' });
    expect(fromBytes(512 * MIB)).toEqual({ value: '512', unit: 'MB' });
  });

  it('round-trips through toMib without rounding', () => {
    for (const mib of [1, 500, 1024, 1536, 3072, 10_240, 51_200]) {
      const { value, unit } = fromBytes(mib * MIB);
      expect(toMib(value, unit)).toBe(mib);
    }
  });
});

/** The group separator of de-CH in this Node.js build. */
const SWISS_GROUP = new Intl.NumberFormat('de-CH').format(1000).charAt(1);

describe('formatMailSize', () => {
  it('formats whole GB and MB', () => {
    expect(formatMailSize(2 * GIB, 'de')).toBe('2 GB');
    expect(formatMailSize(2 * GIB, 'en')).toBe('2 GB');
    expect(formatMailSize(512 * MIB, 'de')).toBe('512 MB');
    expect(formatMailSize(512 * MIB, 'en')).toBe('512 MB');
  });

  it('formats like the rest of the console (de-CH and en-GB)', () => {
    // Swiss German writes a decimal point and groups with an apostrophe. Which apostrophe (’ or ')
    // depends on the ICU data of the Node.js build, so the test asks Intl for it.
    expect(formatMailSize(1.5 * GIB, 'de')).toBe('1.5 GB');
    expect(formatMailSize(1.5 * GIB, 'en')).toBe('1.5 GB');
    expect(formatMailSize(2048 * GIB, 'de')).toBe(`2${SWISS_GROUP}048 GB`);
    expect(formatMailSize(2048 * GIB, 'en')).toBe('2,048 GB');
  });

  it('shows sizes Mailcow keeps exactly and rounds usage', () => {
    // 1280 MiB is 1.25 GB: shown in MB rather than rounded.
    expect(formatMailSize(1280 * MIB, 'en')).toBe('1,280 MB');
    expect(formatMailSize(1280 * MIB, 'de')).toBe(`1${SWISS_GROUP}280 MB`);
    // What a mailbox stores is any number of bytes: one decimal is enough.
    expect(formatMailSize(Math.round(3.4 * GIB), 'de')).toBe('3.4 GB');
    expect(formatMailSize(Math.round(0.6 * GIB), 'en')).toBe('614.4 MB');
    expect(formatMailSize(50 * GIB, 'en')).toBe('50 GB');
  });

  it('reads 0 as unlimited only for quotas', () => {
    expect(formatMailSize(0, 'de', { zeroUnlimited: true })).toBe('unbegrenzt');
    expect(formatMailSize(0, 'en', { zeroUnlimited: true })).toBe('unlimited');
    expect(formatMailSize(0, 'de')).toBe('0 MB');
    expect(formatMailSize(null, 'de')).toBe('–');
  });
});
