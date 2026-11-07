import {
  endedEarly,
  nextBillingDate,
  type ServiceDto,
  type ServiceResumeInput,
  type ServiceResumePreviewDto,
  type ServiceResumeRefusal,
} from '@weblion/shared';
import { ApiError } from '@/lib/api';
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

/**
 * A service a cancellation to a later date ended at once, the way it worked until the fix of November 2026
 * (cancelled, end date after today): the seller can restore it as a scheduled cancellation.
 */
export { endedEarly };

type ResumeFacts = Pick<
  ServiceResumePreviewDto,
  | 'startsAt'
  | 'endsAt'
  | 'interval'
  | 'pausedBeforeCancel'
  | 'missedPeriods'
  | 'nextFromToday'
  | 'upcomingPeriods'
  | 'module'
  | 'moduleActive'
  | 'moduleDeactivatedByCancel'
  | 'sellerHasModule'
>;

/**
 * Defaults of the restore dialog. While the module the cancellation switched off is still off, the customer
 * could not use the service: the missed periods are not billed and the module comes back (if the seller has it).
 * Otherwise the customer could use it unbilled (the module stayed on, or someone switched it on again): bill
 * them. The module goes off at the end date when the cancellation switched it off, as the seller chose then.
 */
export function resumeDefaults(
  preview: Pick<ResumeFacts, 'moduleDeactivatedByCancel' | 'moduleActive' | 'sellerHasModule'>,
): ServiceResumeInput {
  const off = preview.moduleDeactivatedByCancel && !preview.moduleActive;
  return {
    billFrom: off ? 'next' : 'missed',
    activateModule: off && preview.sellerHasModule,
    deactivateModuleAtEnd: preview.moduleDeactivatedByCancel,
  };
}

/**
 * The switches the dialog shows: a module to switch on again only while the customer does not have it, and only
 * usable when the seller has it itself (a reseller passes on only its own modules, the API refuses otherwise).
 */
export function resumeSwitches(preview: Pick<ResumeFacts, 'module' | 'moduleActive' | 'sellerHasModule'>): {
  activate: boolean;
  canActivate: boolean;
  deactivateAtEnd: boolean;
} {
  return {
    activate: !!preview.module && !preview.moduleActive,
    canActivate: preview.sellerHasModule,
    deactivateAtEnd: !!preview.module,
  };
}

/** Whether a period begins on or after today and up to the end date, so "bill only from {date}" bills one. */
export function billsFromNext(preview: Pick<ResumeFacts, 'nextFromToday' | 'endsAt'>): boolean {
  return !!preview.nextFromToday && preview.nextFromToday <= preview.endsAt;
}

/**
 * What the billing run bills up to the end date with a choice: the missed periods (billFrom missed) and the
 * upcoming ones, from `from` to `to`. `fullPeriod` is the last one when the end date cuts it short, as the run
 * bills it in full (fullPeriodAhead says the same when cancelling). null for a one-off or paused service, which
 * the dialog explains apart.
 */
export function resumeBilling(
  preview: ResumeFacts,
  billFrom: ServiceResumeInput['billFrom'],
): {
  total: number;
  from: string | null;
  to: string | null;
  fullPeriod: { from: string; price: number } | null;
} | null {
  if (preview.interval === 'once' || preview.pausedBeforeCancel) return null;
  const billed = [...(billFrom === 'missed' ? preview.missedPeriods : []), ...preview.upcomingPeriods];
  const last = billed.at(-1);
  const following = last ? nextBillingDate(last.start, preview.interval, preview.startsAt) : null;
  // The line ends on the end date, the period would have run until the day before the next one.
  const cut = !!last?.end && !!following && last.end < addDaysISO(following, -1);
  return {
    total: billed.reduce((sum, p) => sum + p.amount, 0),
    from: billed[0]?.start ?? null,
    to: last?.end ?? null,
    fullPeriod: last && cut ? { from: last.start, price: last.amount } : null,
  };
}

/** What the dialog sends: a choice the dialog does not show (or cannot be used) has no effect. */
export function resumeBody(preview: ResumeFacts, choice: ServiceResumeInput): ServiceResumeInput {
  const switches = resumeSwitches(preview);
  return {
    // Without missed periods both choices give the same billing date; a paused service keeps its date anyway.
    billFrom: preview.missedPeriods.length > 0 && !preview.pausedBeforeCancel ? choice.billFrom : 'missed',
    activateModule: switches.activate && switches.canActivate && choice.activateModule,
    deactivateModuleAtEnd: switches.deactivateAtEnd && choice.deactivateModuleAtEnd,
  };
}

/** The reason of a 409 from the restore routes (ServiceResumeRefusal), null for any other error. */
export function resumeRefusal(error: unknown): ServiceResumeRefusal | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const reason = (error.details as { reason?: unknown } | null | undefined)?.reason;
  return reason === 'notEndedEarly' || reason === 'sellerChanged' ? reason : null;
}
