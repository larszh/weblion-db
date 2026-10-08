import { z } from 'zod';
import { INTERVAL_MONTHS, type BillingInterval } from '@weblion/shared';

/**
 * Calendar dates as "YYYY-MM-DD" strings. Billing works with dates in Swiss local time
 * and never with timestamps, so an invoice issued late in the evening keeps its day.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A valid calendar date in the form YYYY-MM-DD. */
export const dateSchema = z
  .string()
  .regex(DATE_RE, 'expected YYYY-MM-DD')
  .refine((value) => {
    const [y, m, d] = parts(value);
    return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
  }, 'invalid date');

function parts(date: string): [number, number, number] {
  const match = DATE_RE.exec(date);
  if (!match) throw new Error(`Invalid date: ${date}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function format(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Today in Europe/Zurich. */
export function todayZurich(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = parts(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return format(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Adds months and clamps to the end of the target month (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: string, months: number, anchorDay?: number): string {
  const [y, m, d] = parts(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return format(ny, nm, Math.min(anchorDay ?? d, daysInMonth(ny, nm)));
}

/**
 * The billing date after `current` for a service that started on `startsAt`, or null for
 * one-off services. Keeps the start day where the month allows it, so a service from
 * Jan 31 is billed on Feb 28, Mar 31, Apr 30. A date moved by hand becomes the new anchor.
 */
export function nextBillingDate(current: string, interval: BillingInterval, startsAt: string): string | null {
  const months = INTERVAL_MONTHS[interval];
  if (months === 0) return null;
  const anchor = parts(startsAt)[2];
  const [y, m, d] = parts(current);
  const onAnchor = d === Math.min(anchor, daysInMonth(y, m));
  return addMonths(current, months, onAnchor ? anchor : d);
}

/**
 * The first billing date on or after `today`, stepping on from `current` like the billing
 * run does, so the day anchor stays. Used when a paused service resumes: the periods it
 * was paused for are skipped, not billed late. One-off services keep their date, they
 * are a single charge and not a period.
 */
export function resumeBillingDate(
  current: string,
  interval: BillingInterval,
  startsAt: string,
  today: string,
): string {
  if (INTERVAL_MONTHS[interval] === 0) return current;
  let next = current;
  while (next < today) next = nextBillingDate(next, interval, startsAt)!;
  return next;
}

/** "2026-10-01" -> "01.10.2026" */
export function formatDateCH(date: string | null | undefined): string {
  if (!date) return '';
  const [y, m, d] = parts(date);
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
}
