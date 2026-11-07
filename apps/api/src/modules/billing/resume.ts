import { and, count, desc, eq, max, ne } from 'drizzle-orm';
import { INTERVAL_MONTHS, endedEarly, lineTotal, type ServicePeriodDto } from '@weblion/shared';
import type { DbOrTx } from '../../db/client';
import { auditLogs, invoiceLines, invoices, type Service } from '../../db/schema';
import { addDays, nextBillingDate, resumeBillingDate } from './dates';

/**
 * Restoring a service that a cancellation to a later date ended at once before the fix of November 2026
 * (endedEarly in the shared package): it becomes the scheduled cancellation it was meant to be, active and
 * billed up to its end date, then ended by the daily job. The old cancellation cleared the billing date, so
 * the invoices tell where billing stopped: the period after the last one billed is the first unbilled one.
 */

export { endedEarly };

export interface ResumePlan {
  /** Billing date with billFrom "missed"; for a one-off service its start date unless billed, then null. */
  firstUnbilled: string | null;
  /** Periods from firstUnbilled that began before today and on or before the end date. */
  missedPeriods: ServicePeriodDto[];
  /** Billing date with billFrom "next": the first period that begins today or later. */
  nextFromToday: string | null;
  /** Net amount the billing run bills per period (or once). */
  periodAmount: number;
}

/**
 * What the billing run would bill for the service if it had run as a scheduled cancellation. Billed means a
 * line of the service on an invoice that is not void: a draft counts, as the run moved the billing date on
 * when it created it (deleting the draft would move it back). Periods and amounts come from the same
 * functions the run uses (nextBillingDate, lineTotal), the last period ends on the end date.
 */
export async function resumePlan(
  db: DbOrTx,
  service: Pick<Service, 'id' | 'interval' | 'startsAt' | 'endsAt' | 'quantity' | 'unitPrice'>,
  today: string,
): Promise<ResumePlan> {
  const [billed] = await db
    .select({ last: max(invoiceLines.periodStart), lines: count() })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .where(and(eq(invoiceLines.serviceId, service.id), ne(invoices.status, 'void')));
  const periodAmount = lineTotal(service.quantity, service.unitPrice);
  // A one-off service is a single charge, not a period: it is billed or it is not, nothing is billed late.
  if (INTERVAL_MONTHS[service.interval] === 0) {
    const first = (billed?.lines ?? 0) > 0 ? null : service.startsAt;
    return { firstUnbilled: first, missedPeriods: [], nextFromToday: first, periodAmount };
  }
  const last = billed?.last ?? null;
  const firstUnbilled = last ? nextBillingDate(last, service.interval, service.startsAt)! : service.startsAt;
  const endsAt = service.endsAt!;
  const missedPeriods: ServicePeriodDto[] = [];
  let start: string | null = firstUnbilled;
  // Dates only grow, so the loop ends at today; endsAt is after today for a service ended early.
  while (start && start < today && start <= endsAt) {
    const following = nextBillingDate(start, service.interval, service.startsAt);
    let end = following ? addDays(following, -1) : null;
    if (end && end > endsAt) end = endsAt;
    missedPeriods.push({ start, end, amount: periodAmount });
    start = following;
  }
  return {
    firstUnbilled,
    missedPeriods,
    nextFromToday: resumeBillingDate(firstUnbilled, service.interval, service.startsAt, today),
    periodAmount,
  };
}

/**
 * Whether the cancellation switched the module off: its audit entry (service.cancel, the latest one that
 * succeeded) names the module in moduleDeactivated. The old cancellation wrote { endsAt, moduleDeactivated }.
 */
export async function moduleDeactivatedByCancel(
  db: DbOrTx,
  service: Pick<Service, 'id' | 'module'>,
): Promise<boolean> {
  if (!service.module) return false;
  const [entry] = await db
    .select({ details: auditLogs.details })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.resourceType, 'service'),
        eq(auditLogs.resourceId, service.id),
        eq(auditLogs.action, 'service.cancel'),
        eq(auditLogs.status, 'success'),
      ),
    )
    .orderBy(desc(auditLogs.id))
    .limit(1);
  return entry?.details?.moduleDeactivated === service.module;
}
