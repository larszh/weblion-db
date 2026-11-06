import type { ServiceDto } from '@weblion/shared';

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
