import { and, eq, inArray, isNull } from 'drizzle-orm';
import { normalizeModules } from '@weblion/shared';
import { DEMO_PHONE_SYSTEMS } from '../providers/demo/phone';
import type { Database } from './client';
import { organizations, phoneSystems, providerConnections } from './schema';

/** Phone systems of the demo connection (see providers/demo/phone.ts) Muster AG gets: one per site. */
const MUSTER_SYSTEMS: string[] = [DEMO_PHONE_SYSTEMS.zurich, DEMO_PHONE_SYSTEMS.bern];

/**
 * Demo data for telephony: two of the demo connection's phone systems (Zürich and Bern) go to
 * Muster AG with the "phone" module, the lab system stays unassigned for the admin assignment
 * demo. Idempotent. Called from seedDemo after the websites demo. The rows exist once the demo
 * connection was synced (seed-cli and the test app do that first); without them it does nothing.
 * Only unassigned phone systems are handed out, so one staff moved elsewhere stays there, and the
 * module is only switched on along with an assignment, so a module switched off later stays off.
 */
export async function seedPhoneDemo(db: Database, log: string[]): Promise<void> {
  const demo = await db.query.providerConnections.findFirst({
    where: eq(providerConnections.envKey, 'demo'),
  });
  if (!demo) return;
  const muster = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'muster-ag') });
  if (!muster) return;

  const result = await db.transaction(async (tx) => {
    const assigned = await tx
      .update(phoneSystems)
      .set({ orgId: muster.id })
      .where(
        and(
          eq(phoneSystems.providerConnectionId, demo.id),
          inArray(phoneSystems.externalId, MUSTER_SYSTEMS),
          isNull(phoneSystems.orgId),
        ),
      )
      .returning({ name: phoneSystems.name });
    if (assigned.length === 0) return null;
    const org = await tx.query.organizations.findFirst({ where: eq(organizations.id, muster.id) });
    const enable = !!org && !org.modules.includes('phone');
    if (org && enable) {
      await tx
        .update(organizations)
        .set({ modules: normalizeModules([...org.modules, 'phone']) })
        .where(eq(organizations.id, org.id));
    }
    return { names: assigned.map((r) => r.name).sort(), enable };
  });
  if (!result) return;
  log.push(
    `assigned phone systems ${result.names.join(', ')} to ${muster.name}${result.enable ? ', module phone' : ''}`,
  );
}
