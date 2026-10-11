import { MAIL_MIB } from '@weblion/shared';
import type { Locale } from '@/lib/format';
import { mailDe } from '@/i18n/sections/mail.de';
import { mailEn } from '@/i18n/sections/mail.en';

/**
 * Sizes of mail domains and mailboxes. Mailcow takes whole MiB, the API answers in bytes.
 * Forms enter a number with the unit MB or GB, binary like Mailcow shows them
 * (1 GB = 1024 MB = 1024 MiB). Nothing is rounded: a value that is no whole number of MB is
 * refused instead.
 */

export type SizeUnit = 'MB' | 'GB';
export const SIZE_UNITS: readonly SizeUnit[] = ['MB', 'GB'];

export const MIB = MAIL_MIB;
export const GIB = 1024 * MAIL_MIB;
/** Largest size the API takes (MiB). */
export const MAX_MIB = 10_000_000;

const UNIT_MIB: Record<SizeUnit, bigint> = { MB: 1n, GB: 1024n };

/**
 * Whole MiB from a form value ("2", "2.5", "2,5") and its unit, or null when the value is
 * empty, not a number, no whole number of MB, below 1 MB or above what the API takes.
 * Computed with integers, so "2.5 GB" is exactly 2560 MB.
 */
export function toMib(value: string, unit: SizeUnit): number | null {
  const match = /^(\d{1,9})(?:[.,](\d{1,12}))?$/.exec(value.trim());
  if (!match) return null;
  const whole = BigInt(match[1]!);
  const fraction = match[2] ?? '';
  const scale = 10n ** BigInt(fraction.length);
  const fractionMib = BigInt(fraction || '0') * UNIT_MIB[unit];
  if (fractionMib % scale !== 0n) return null;
  const mib = whole * UNIT_MIB[unit] + fractionMib / scale;
  if (mib < 1n || mib > BigInt(MAX_MIB)) return null;
  return Number(mib);
}

export interface SizeValue {
  value: string;
  unit: SizeUnit;
}

/** Form value for a size in bytes: GB when it is a whole number of GB, else MB. */
export function fromBytes(bytes: number): SizeValue {
  if (bytes % GIB === 0) return { value: String(bytes / GIB), unit: 'GB' };
  const mb = bytes / MIB;
  return { value: Number.isInteger(mb) ? String(mb) : String(Math.round(mb * 100) / 100), unit: 'MB' };
}

const UNLIMITED: Record<Locale, string> = {
  de: mailDe['mail.units.unlimited'],
  en: mailEn['mail.units.unlimited'],
};

const number = (value: number, locale: Locale, digits: number) =>
  new Intl.NumberFormat(locale === 'de' ? 'de-CH' : 'en-GB', { maximumFractionDigits: digits }).format(value);

/**
 * A size for display: "2 GB", "512 MB", "1.5 GB", "1’280 MB" (de-CH like every number of the
 * console; en-GB groups with a comma). Sizes Mailcow keeps
 * (whole MiB) read exactly: a GB value with more than one decimal is shown in MB instead.
 * Usage (any number of bytes) is rounded to one decimal. With `zeroUnlimited`, 0 reads as
 * "unbegrenzt" (a mailbox quota of 0 has no limit).
 */
export function formatMailSize(
  bytes: number | null | undefined,
  locale: Locale,
  options: { zeroUnlimited?: boolean } = {},
): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '–';
  if (bytes === 0 && options.zeroUnlimited) return UNLIMITED[locale];
  const wholeMib = bytes % MIB === 0;
  const gb = bytes / GIB;
  if (Math.abs(gb) >= 1 && (!wholeMib || Number.isInteger(gb * 10))) return `${number(gb, locale, 1)} GB`;
  const mb = bytes / MIB;
  return `${number(mb, locale, wholeMib ? 0 : 1)} MB`;
}
