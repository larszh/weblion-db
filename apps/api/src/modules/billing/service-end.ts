import { and, asc, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import type { ModuleKey } from '@weblion/shared';
import type { AppContext } from '../../context';
import type { Tx } from '../../db/client';
import { organizations, services, type Service } from '../../db/schema';
import { lockOrgBilling } from './ledger';

/**
 * The end of a service. A cancellation either ends a service at once (end date today or
 * earlier) or is scheduled for a later end date: the service then keeps its status and
 * billing date, the recurring run bills every period that starts up to the end date, and
 * the daily job ends it once the date has passed (endDueServices).
 */

/** Actor name of audit entries written by the daily billing job (it has no request). */
export const BILLING_JOB_ACTOR = 'Abrechnungsjob';

/** Removes a module from an organization. False when it did not have it. */
export async function deactivateModule(tx: Tx, orgId: string, module: ModuleKey): Promise<boolean> {
  const [org] = await tx.select().from(organizations).where(eq(organizations.id, orgId)).for('update');
  if (!org || !org.modules.includes(module)) return false;
  await tx
    .update(organizations)
    .set({ modules: org.modules.filter((m) => m !== module) })
    .where(eq(organizations.id, orgId));
  return true;
}

/** A scheduled cancellation: the service still runs, but has an end date. */
export const isScheduledEnd = (service: Pick<Service, 'status' | 'endsAt'>): boolean =>
  service.status !== 'cancelled' && service.endsAt !== null;

/**
 * Whether a period that starts on or before the end date still waits to be billed. Only
 * active services are billed, the periods of a paused one are skipped (see resumeBillingDate).
 */
export const hasUnbilledPeriod = (service: Pick<Service, 'status' | 'nextBillingAt' | 'endsAt'>): boolean =>
  service.status === 'active' &&
  service.nextBillingAt !== null &&
  service.endsAt !== null &&
  service.nextBillingAt <= service.endsAt;

/**
 * Daily step of the billing job: services whose scheduled end date is before `today` become
 * cancelled and lose their module if the seller chose that. Runs after the billing run of
 * the same day, so the last periods are usually billed already. An active service that still
 * has a period up to its end date unbilled stays active until a run has billed it: the
 * daily run tomorrow, or with BILLING_JOB_ENABLED=false (no automatic invoicing) the seller's
 * "Fällige Dienste abrechnen". The same holds for a period the run skipped (other currency,
 * an amount too large), so no period up to the end date is ever lost.
 */
export async function endDueServices(
  ctx: AppContext,
  today: string,
): Promise<{ ended: number; failed: number }> {
  const { db, log, audit } = ctx;
  const due = await db
    .select({ id: services.id, orgId: services.orgId })
    .from(services)
    .where(
      and(
        inArray(services.status, ['active', 'suspended']),
        isNotNull(services.endsAt),
        lt(services.endsAt, today),
      ),
    )
    .orderBy(asc(services.endsAt), asc(services.id));
  let ended = 0;
  let failed = 0;
  for (const { id, orgId } of due) {
    try {
      const result = await db.transaction(async (tx) => {
        // The billing lock of the organization: a billing run cannot bill the service meanwhile.
        await lockOrgBilling(tx, orgId);
        const [current] = await tx.select().from(services).where(eq(services.id, id)).for('update');
        if (!current || !isScheduledEnd(current) || current.endsAt! >= today) return null;
        if (hasUnbilledPeriod(current)) return null;
        const [row] = await tx
          .update(services)
          .set({ status: 'cancelled', nextBillingAt: null, deactivateModuleAtEnd: false })
          .where(eq(services.id, id))
          .returning();
        const deactivated =
          current.deactivateModuleAtEnd && current.module
            ? await deactivateModule(tx, current.orgId, current.module)
            : false;
        return { service: row!, deactivated };
      });
      if (!result) continue;
      ended++;
      await audit.record(null, {
        action: 'service.end',
        orgId: result.service.orgId,
        resourceType: 'service',
        resourceId: result.service.id,
        actorName: BILLING_JOB_ACTOR,
        details: {
          endsAt: result.service.endsAt,
          moduleDeactivated: result.deactivated ? result.service.module : null,
        },
      });
    } catch (err) {
      failed++;
      log.error({ err, serviceId: id }, 'ending a cancelled service failed');
    }
  }
  return { ended, failed };
}
