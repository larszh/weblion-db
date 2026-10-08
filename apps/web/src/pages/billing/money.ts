import type { BillingInterval } from '@weblion/shared';
import type { Locale } from '@/lib/format';

/**
 * Input helpers for the billing forms. Money is entered as a decimal string ("19.90") and
 * sent as integer minor units, tax rates are entered in percent and sent as basis points.
 * Nothing here goes through floating point arithmetic on the amount itself.
 */

const intl = (locale: Locale) => (locale === 'de' ? 'de-CH' : 'en-GB');

/** Swiss users type 1'250.50 or 19,90; both are accepted. */
function normalizeDecimal(input: string): string {
  return input
    .trim()
    .replace(/['’\s]/g, '')
    .replace(',', '.');
}

/** "19.90" -> 1990, "-5" -> -500. null when the text is not an amount with at most two decimals. */
export function parseMoney(input: string): number | null {
  const m = /^([+-])?(\d+)(?:\.(\d{0,2}))?$/.exec(normalizeDecimal(input));
  if (!m) return null;
  const value = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(value)) return null;
  return m[1] === '-' ? -value : value;
}

/** Minor units -> "19.90" for an input field. */
export function moneyInput(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '';
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** "8.1" -> 810. null when not a rate between 0 and 100 % with at most two decimals. */
export function parsePercent(input: string): number | null {
  const m = /^(\d+)(?:\.(\d{0,2}))?$/.exec(normalizeDecimal(input));
  if (!m) return null;
  const bp = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return bp <= 10_000 ? bp : null;
}

/** 810 -> "8.1" for an input field. */
export function percentInput(bp: number | null | undefined): string {
  if (bp === null || bp === undefined) return '';
  return String(bp / 100);
}

/** 810 -> "8.1 %" */
export function formatRate(bp: number, locale: Locale): string {
  return `${new Intl.NumberFormat(intl(locale), { maximumFractionDigits: 2 }).format(bp / 100)} %`;
}

/** "1.5" -> 1.5. Quantities keep three decimals and must be positive. */
export function parseQuantity(input: string): number | null {
  const m = /^(\d+)(?:\.(\d{0,3}))?$/.exec(normalizeDecimal(input));
  if (!m) return null;
  const value = Number(`${m[1]}.${m[2] || '0'}`);
  return value > 0 && value <= 1_000_000 ? value : null;
}

export function formatQuantity(value: number, locale: Locale): string {
  return new Intl.NumberFormat(intl(locale), { maximumFractionDigits: 3 }).format(value);
}

// --- Dates ("YYYY-MM-DD", no time zone) ---------------------------------------------------

/** Today as YYYY-MM-DD in the browser's time zone. */
export function todayISO(): string {
  return toISODate(new Date());
}

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDaysISO(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return toISODate(new Date(y!, m! - 1, d! + days));
}

/** Formats a date without time. Parsed as a local date so it never shifts by a day. */
export function formatDay(date: string | null | undefined, locale: Locale): string {
  if (!date) return '–';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(date);
  if (Number.isNaN(d.getTime())) return '–';
  return new Intl.DateTimeFormat(intl(locale), { dateStyle: 'medium' }).format(d);
}

/**
 * Whether a line needs its billing period printed below the description. Generated lines
 * already name it ("Cloud Server M, 01.10.2026 - 31.10.2026"), like the PDF checks.
 */
export function showPeriod(line: {
  description: string;
  periodStart: string | null;
  periodEnd: string | null;
}) {
  if (!line.periodStart || !line.periodEnd) return false;
  const [y, m, d] = line.periodStart.split('-');
  return !line.description.includes(`${d}.${m}.${y}`);
}

/** Default unit for an invoice line taken from a product with this interval. */
export function unitForInterval(interval: BillingInterval, locale: Locale): string {
  const units: Record<BillingInterval, { de: string; en: string }> = {
    once: { de: 'Stk.', en: 'pcs' },
    monthly: { de: 'Monat', en: 'month' },
    quarterly: { de: 'Quartal', en: 'quarter' },
    yearly: { de: 'Jahr', en: 'year' },
  };
  return units[interval][locale];
}
