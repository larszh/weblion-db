import { and, eq, inArray, isNull } from 'drizzle-orm';
import { normalizeModules } from '@weblion/shared';
import { createAdapter } from '../providers/registry';
import type { Database } from './client';
import { mailDomains, organizations, providerConnections } from './schema';

/**
 * Mail domains of the demo instance (see providers/demo/mail.ts) by organization slug. The
 * reseller comes first, so its customer stays within the reseller's modules. müller.ch and the
 * relay domain alpenblick-hotel.ch stay unassigned for the admin inventory.
 */
const ASSIGNMENTS: { slug: string; domains: string[] }[] = [
  { slug: 'alpen-hosting', domains: ['alpen-hosting.ch'] },
  { slug: 'muster-ag', domains: ['muster-ag.ch', 'muster-shop.ch'] },
  { slug: 'baeckerei-huber', domains: ['baeckerei-huber.ch'] },
];

/**
 * Demo data for e-mail: the demo connection's mail domains and who gets them. Idempotent.
 * Called from seedDemo after the cloud demo. Stores the domains itself, so it does not depend
 * on a sync having run. Only unassigned domains are handed out, so a domain staff moved
 * elsewhere stays there; organizations get the mail module when they lack it.
 */
export async function seedMailDemo(db: Database, log: string[]): Promise<void> {
  const demo = await db.query.providerConnections.findFirst({
    where: eq(providerConnections.envKey, 'demo'),
  });
  if (!demo) return;
  // The demo keeps its state per connection in memory, the configuration does not matter here.
  const adapter = createAdapter(demo.type, demo.id, {});
  if (!adapter.listMailDomains) return;

  const now = new Date();
  for (const remote of await adapter.listMailDomains()) {
    await db
      .insert(mailDomains)
      .values({
        providerConnectionId: demo.id,
        externalId: remote.externalId,
        name: remote.info.displayName,
        active: remote.info.active,
        info: remote.info,
        lastSyncedAt: now,
      })
      .onConflictDoNothing({ target: [mailDomains.providerConnectionId, mailDomains.externalId] });
  }

  for (const seed of ASSIGNMENTS) {
    const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, seed.slug) });
    if (!org) continue;
    const enable = !org.modules.includes('mail');
    const assigned = await db.transaction(async (tx) => {
      const rows = await tx
        .update(mailDomains)
        .set({ orgId: org.id })
        .where(
          and(
            eq(mailDomains.providerConnectionId, demo.id),
            inArray(mailDomains.externalId, seed.domains),
            isNull(mailDomains.orgId),
          ),
        )
        .returning({ name: mailDomains.name });
      if (enable) {
        await tx
          .update(organizations)
          .set({ modules: normalizeModules([...org.modules, 'mail']) })
          .where(eq(organizations.id, org.id));
      }
      return rows.map((r) => r.name).sort();
    });
    if (assigned.length > 0 || enable) {
      const parts = [
        ...(assigned.length > 0 ? [`assigned mail domains ${assigned.join(', ')} to ${org.name}`] : []),
        ...(enable ? [`module mail for ${org.name}`] : []),
      ];
      log.push(parts.join(', '));
    }
  }
}
