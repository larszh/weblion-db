import type { ServiceDto } from '@weblion/shared';
import { addDaysISO } from './money';

/**
 * The rules of a scheduled cancellation as the API applies them (apps/api/src/modules/billing/
 * service-end.ts), so the pages show what will happen instead of what the seller might expect.
 * Pure functions, `today` is passed in (YYYY-MM-DD).
 */

type EndFields = Pick<ServiceDto, 'status' | 'endsAt'>;

/**
 * End date of a scheduled cancellation: the service still runs (active or paused) and is billed up to
 * this day, then the daily billing job ends it. null without one or once the service has ended.
 */
export function scheduledEndOf(service: EndFields): string | null {
  return service.status !== 'cancelled' ? service.endsAt : null;
}

/**
 * Whether the scheduled end date has passed. The service then only waits for the daily job (and, if a
 * period up to the end date is unbilled, for that billing), so it can be neither changed nor withdrawn.
 */
export function endPassed(service: EndFields, today: string): boolean {
  const end = scheduledEndOf(service);
  return !!end && end < today;
}

/** The end date has passed but a period up to it is not billed yet: it ends once a run has billed it. */
export function waitsForBilling(
  service: Pick<ServiceDto, 'status' | 'endsAt' | 'nextBillingAt'>,
  today: string,
): boolean {
  return (
    endPassed(service, today) &&
    service.status === 'active' &&
    !!service.nextBillingAt &&
    service.nextBillingAt <= service.endsAt!
  );
}

/**
 * Other services of the customer that keep the module of `service` on: same module, active or paused,
 * without an end date or with one from today on. While one of them runs, "Modul sperren" keeps it.
 */
export function servicesKeepingModule(service: ServiceDto, all: ServiceDto[], today: string): ServiceDto[] {
  if (!service.module) return [];
  return all.filter(
    (s) =>
      s.id !== service.id &&
      s.module === service.module &&
      s.status !== 'cancelled' &&
      (s.endsAt === null || s.endsAt >= today),
  );
}

/**
 * The next period that an end date still bills in full. The run bills every period that starts on or
 * before the end date at its whole price, not pro rata (the line only ends on the end date), so an end
 * on or just after a billing date costs one more period. null when the end date bills nothing more:
 * not active (a paused service is not billed), billed once, ending at once (today or earlier) or
 * before the next billing date. `endBefore` is the day before that period, the end without a further
 * invoice, unless that day has passed (the period has begun and is due already).
 */
export function fullPeriodAhead(
  service: Pick<ServiceDto, 'status' | 'interval' | 'nextBillingAt'>,
  endsAt: string,
  today: string,
): { from: string; endBefore: string | null } | null {
  const next = service.nextBillingAt;
  if (service.status !== 'active' || service.interval === 'once' || !next) return null;
  if (!endsAt || endsAt <= today || endsAt < next) return null;
  const endBefore = addDaysISO(next, -1);
  return { from: next, endBefore: endBefore >= today ? endBefore : null };
}
