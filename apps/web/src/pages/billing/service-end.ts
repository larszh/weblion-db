import { nextBillingDate, type ServiceDto } from '@weblion/shared';
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
 * The period an end date bills in full but uses only in part. The run bills every period that starts on
 * or before the end date at its whole price, not pro rata (the line only ends on the end date), so the
 * one that matters is the last period starting on or before the end date: an end on its last day uses
 * it fully, any earlier day pays for days the customer no longer has. The earlier periods are used in
 * full and are not worth a warning. null when nothing is paid for unused time: not active (a paused
 * service is not billed), billed once, ending at once (today or earlier), before the next billing date
 * or on the last day of a period. `endBefore` is the day before that period, the end without paying for
 * it, unless that day has passed (the period has begun and is due already).
 */
export function fullPeriodAhead(
  service: Pick<ServiceDto, 'status' | 'interval' | 'nextBillingAt' | 'startsAt'>,
  endsAt: string,
  today: string,
): { from: string; endBefore: string | null } | null {
  const next = service.nextBillingAt;
  if (service.status !== 'active' || service.interval === 'once' || !next) return null;
  if (!endsAt || endsAt <= today || endsAt < next) return null;
  // Step through the periods as the billing run does, keeping the day anchor of the start date.
  let from = next;
  let following = nextBillingDate(from, service.interval, service.startsAt);
  while (following && following <= endsAt) {
    from = following;
    following = nextBillingDate(from, service.interval, service.startsAt);
  }
  if (!following || endsAt >= addDaysISO(following, -1)) return null;
  const endBefore = addDaysISO(from, -1);
  return { from, endBefore: endBefore >= today ? endBefore : null };
}
