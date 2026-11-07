import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, ne, or } from 'drizzle-orm';
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

/**
 * Switches the module of an ending service off, unless another service of the organization still
 * runs with it: active or paused, with no end date or one from `today` on. The seller decides when
 * cancelling, but a scheduled end takes effect weeks later, when the customer may have a new
 * service with the same module (a plan change). A service whose end date has passed does not
 * count, it only waits to be ended. 'kept' then, 'none' when the organization did not have it.
 */
export async function endModule(
  tx: Tx,
  service: Pick<Service, 'id' | 'orgId'> & { module: ModuleKey },
  today: string,
): Promise<'deactivated' | 'kept' | 'none'> {
  // The organization row first, as activateModule locks it too: a service added with this module
  // at the same time is either seen below or switches the module on again after this commit.
  const [org] = await tx
    .select()
    .from(organizations)
    .where(eq(organizations.id, service.orgId))
    .for('update');
  if (!org || !org.modules.includes(service.module)) return 'none';
  const [other] = await tx
    .select({ id: services.id })
    .from(services)
    .where(
      and(
        eq(services.orgId, service.orgId),
        eq(services.module, service.module),
        ne(services.id, service.id),
        inArray(services.status, ['active', 'suspended']),
        or(isNull(services.endsAt), gte(services.endsAt, today)),
      ),
    )
    .limit(1);
  if (other) return 'kept';
  await tx
    .update(organizations)
    .set({ modules: org.modules.filter((m) => m !== service.module) })
    .where(eq(organizations.id, service.orgId));
  return 'deactivated';
}

/** Audit details of a module choice: switched off, or kept for another service. */
export function moduleEndDetails(
  module: ModuleKey | null,
  result: 'deactivated' | 'kept' | 'none',
): { moduleDeactivated: ModuleKey | null; moduleKept?: ModuleKey } {
  return {
    moduleDeactivated: result === 'deactivated' ? module : null,
    ...(result === 'kept' && module ? { moduleKept: module } : {}),
  };
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
 * cancelled and lose their module if the seller chose that and no other running service of the
 * customer has it (endModule). Runs after the billing run of the same day, so the last periods
 * are usually billed already. An active service that still has a period up to its end date
 * unbilled stays active until a run has billed it: the daily run tomorrow, or with BILLING_JOB_ENABLED=false (no automatic invoicing) the seller's
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
        const moduleEnd =
          current.deactivateModuleAtEnd && current.module
            ? await endModule(tx, { id: current.id, orgId: current.orgId, module: current.module }, today)
            : 'none';
        return { service: row!, moduleEnd };
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
          ...moduleEndDetails(result.service.module, result.moduleEnd),
        },
      });
    } catch (err) {
      failed++;
      log.error({ err, serviceId: id }, 'ending a cancelled service failed');
    }
  }
  return { ended, failed };
}
