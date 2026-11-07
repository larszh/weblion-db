import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, ne, notExists, or, sql } from 'drizzle-orm';
import { INTERVAL_MONTHS, endedEarly, lineTotal, type ServicePeriodDto } from '@weblion/shared';
import type { DbOrTx } from '../../db/client';
import {
  auditLogs,
  invoiceLines,
  invoices,
  products,
  type Organization,
  type Service,
} from '../../db/schema';
import { addDays, nextBillingDate, resumeBillingDate } from './dates';
import { sellerOrgId } from './seller';

/**
 * Restoring a service that a cancellation to a later date ended at once before the fix of November 2026
 * (endedEarly in the shared package): it becomes the scheduled cancellation it was meant to be, billed up to
 * its end date, then ended by the daily job. The old cancellation set the status to cancelled and cleared the
 * billing date, so both come back from what was written before it: the audit log of the service (the changes
 * made by hand) and the invoices (what the billing run billed).
 */

export { endedEarly };

/** Upper bound of periods a preview lists, far more than any end date a seller sets. */
const MAX_PERIODS = 600;

type ResumeService = Pick<Service, 'id' | 'interval' | 'startsAt' | 'endsAt' | 'quantity' | 'unitPrice'>;

export interface ResumePlan {
  /** The billing date as it stood at the cancellation (billFrom "missed", and a paused service's date). */
  firstUnbilled: string | null;
  /** The service was paused then: it is restored paused, with no missed or upcoming periods. */
  pausedBeforeCancel: boolean;
  /** Periods from firstUnbilled that began before today and on or before the end date. */
  missedPeriods: ServicePeriodDto[];
  /** Billing date with billFrom "next": the first period that begins today or later. */
  nextFromToday: string | null;
  /** Periods from nextFromToday up to the end date, billed with either choice. */
  upcomingPeriods: ServicePeriodDto[];
  /** Net amount the billing run bills per period (or once). */
  periodAmount: number;
}

/** What the audit log of the service says about the time before the old cancellation. */
interface BeforeCancel {
  /** Status the last change set (service.update with a status), null when none did. */
  status: unknown;
  /** Billing date the last change set (a date moved by hand, or a pause resumed), with its time. */
  billingDate: { value: string | null; at: Date } | null;
}

async function beforeCancel(db: DbOrTx, serviceId: string): Promise<BeforeCancel> {
  const entries = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      details: auditLogs.details,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.resourceType, 'service'),
        eq(auditLogs.resourceId, serviceId),
        inArray(auditLogs.action, ['service.update', 'service.cancel']),
        eq(auditLogs.status, 'success'),
      ),
    )
    .orderBy(asc(auditLogs.id));
  // The latest cancellation is the old one. A cancelled service cannot be changed, so every change is before
  // it; the cut keeps it so.
  const cancelAt = entries.findLastIndex((e) => e.action === 'service.cancel');
  const changes = (cancelAt >= 0 ? entries.slice(0, cancelAt) : entries).filter(
    (e) => e.action === 'service.update' && e.details,
  );
  const withStatus = changes.findLast((e) => 'status' in e.details!);
  const withDate = changes.findLast((e) => 'nextBillingAt' in e.details!);
  const date = withDate?.details!.nextBillingAt;
  return {
    status: withStatus?.details!.status ?? null,
    billingDate:
      withDate && (date === null || typeof date === 'string')
        ? { value: date, at: withDate.createdAt }
        : null,
  };
}

/**
 * The billing date as it stood when the old cancellation cleared it, the way the billing run had left it. The
 * run moves it on when it creates an invoice (a draft too) and never back when that invoice is voided, so a line
 * of the service counts on any invoice, on a void one unless it was made by hand (audit invoice.create: those
 * lines never moved the date). A change by hand (a date moved, a pause resumed) set it too: whichever was written
 * later wins. Without either, billing starts on the start date.
 */
async function billingDateAtCancel(
  db: DbOrTx,
  service: ResumeService,
  setByHand: BeforeCancel['billingDate'],
): Promise<string | null> {
  const madeByHand = db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, 'invoice.create'),
        eq(auditLogs.resourceType, 'invoice'),
        eq(auditLogs.resourceId, sql`${invoices.id}::text`),
      ),
    );
  const once = INTERVAL_MONTHS[service.interval] === 0;
  const [last] = await db
    .select({ start: invoiceLines.periodStart, at: invoices.createdAt })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .where(
      and(
        eq(invoiceLines.serviceId, service.id),
        or(ne(invoices.status, 'void'), notExists(madeByHand)),
        // A one-off service is billed by any line, a period by a line that names its start.
        once ? undefined : isNotNull(invoiceLines.periodStart),
      ),
    )
    .orderBy(desc(invoiceLines.periodStart), desc(invoices.createdAt))
    .limit(1);
  if (setByHand && (!last || setByHand.at > last.at)) return setByHand.value;
  if (!last) return service.startsAt;
  return once ? null : nextBillingDate(last.start!, service.interval, service.startsAt);
}

/** The periods from `from` as the billing run bills them while `keep` holds, the last one ends on the end date. */
function periods(
  service: ResumeService,
  from: string | null,
  keep: (start: string) => boolean,
  amount: number,
): ServicePeriodDto[] {
  const endsAt = service.endsAt!;
  const out: ServicePeriodDto[] = [];
  for (let start = from; start && start <= endsAt && keep(start) && out.length < MAX_PERIODS;) {
    const following = nextBillingDate(start, service.interval, service.startsAt);
    let end = following ? addDays(following, -1) : null;
    if (end && end > endsAt) end = endsAt;
    out.push({ start, end, amount });
    start = following;
  }
  return out;
}

/**
 * What the billing run would bill for the service if it had run as a scheduled cancellation. Periods and amounts
 * come from the same functions the run uses (nextBillingDate, lineTotal), the last period ends on the end date.
 * A service paused at the cancellation stays paused, so nothing of it is billed until the seller resumes it.
 */
export async function resumePlan(db: DbOrTx, service: ResumeService, today: string): Promise<ResumePlan> {
  const history = await beforeCancel(db, service.id);
  const firstUnbilled = await billingDateAtCancel(db, service, history.billingDate);
  const pausedBeforeCancel = history.status === 'suspended';
  const periodAmount = lineTotal(service.quantity, service.unitPrice);
  // A one-off service is a single charge, not a period: it is billed or it is not, nothing is billed late.
  if (INTERVAL_MONTHS[service.interval] === 0) {
    return {
      firstUnbilled,
      pausedBeforeCancel,
      missedPeriods: [],
      nextFromToday: firstUnbilled,
      upcomingPeriods: [],
      periodAmount,
    };
  }
  const nextFromToday = firstUnbilled
    ? resumeBillingDate(firstUnbilled, service.interval, service.startsAt, today)
    : null;
  const billed = !pausedBeforeCancel;
  return {
    firstUnbilled,
    pausedBeforeCancel,
    missedPeriods: billed ? periods(service, firstUnbilled, (start) => start < today, periodAmount) : [],
    nextFromToday,
    upcomingPeriods: billed ? periods(service, nextFromToday, () => true, periodAmount) : [],
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

/**
 * Whether the customer's seller (the platform or a reseller) is not the one that sold the service. A service
 * belongs to the seller that sold it: another one must not bill it (as assertSellerChangeable keeps it for
 * running services). Told by the first move in the audit log after the service was created (org.admin_update
 * with another parentOrgId, it names the seller before), a product from another seller's catalog or a line on
 * another issuer's invoice.
 */
export async function soldByAnotherSeller(
  db: DbOrTx,
  service: Pick<Service, 'id' | 'productId' | 'createdAt'>,
  org: Pick<Organization, 'id' | 'parentOrgId'>,
): Promise<boolean> {
  const seller = sellerOrgId(org);
  const moves = await db
    .select({ details: auditLogs.details })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, 'org.admin_update'),
        eq(auditLogs.resourceType, 'org'),
        eq(auditLogs.resourceId, org.id),
        eq(auditLogs.status, 'success'),
        gt(auditLogs.createdAt, service.createdAt),
      ),
    )
    .orderBy(asc(auditLogs.id));
  // The seller when the service was sold: the one the first move after that left.
  const firstMove = moves.find(
    ({ details }) =>
      !!details &&
      'previousParentOrgId' in details &&
      (details.parentOrgId ?? null) !== (details.previousParentOrgId ?? null),
  );
  if (firstMove && (firstMove.details!.previousParentOrgId ?? null) !== seller) return true;
  if (service.productId) {
    const product = await db.query.products.findFirst({
      where: eq(products.id, service.productId),
      columns: { ownerOrgId: true },
    });
    if (product && product.ownerOrgId !== seller) return true;
  }
  const [foreign] = await db
    .select({ id: invoiceLines.id })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .where(
      and(
        eq(invoiceLines.serviceId, service.id),
        seller
          ? or(isNull(invoices.issuerOrgId), ne(invoices.issuerOrgId, seller))
          : isNotNull(invoices.issuerOrgId),
      ),
    )
    .limit(1);
  return !!foreign;
}

/**
 * Invoices of the seller to the customer since the cancellation, not void, with a line that names no service:
 * where the seller billed periods of the service by hand, the restore would bill them a second time.
 */
export async function manualInvoicesSince(
  db: DbOrTx,
  service: Pick<Service, 'orgId' | 'cancelledAt'>,
  issuerOrgId: string | null,
): Promise<{ id: string; number: string | null }[]> {
  if (!service.cancelledAt) return [];
  return db
    .selectDistinct({ id: invoices.id, number: invoices.number, createdAt: invoices.createdAt })
    .from(invoices)
    .innerJoin(invoiceLines, eq(invoiceLines.invoiceId, invoices.id))
    .where(
      and(
        eq(invoices.orgId, service.orgId),
        issuerOrgId ? eq(invoices.issuerOrgId, issuerOrgId) : isNull(invoices.issuerOrgId),
        ne(invoices.status, 'void'),
        gt(invoices.createdAt, service.cancelledAt),
        isNull(invoiceLines.serviceId),
      ),
    )
    .orderBy(asc(invoices.createdAt), asc(invoices.id))
    .limit(10)
    .then((rows) => rows.map(({ id, number }) => ({ id, number })));
}
