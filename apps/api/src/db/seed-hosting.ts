import { and, eq, inArray, isNull } from 'drizzle-orm';
import { normalizeModules } from '@weblion/shared';
import type { Database } from './client';
import { domains, organizations, providerConnections, webspaces } from './schema';

/** Demo domains and web spaces (see providers/demo/hosting.ts) and who gets them. */
const MUSTER_DOMAINS = ['muster-ag.ch', 'muster-shop.ch'];
const MUSTER_WEBSPACE = 'demo-web-1';
const HUBER_DOMAIN = 'baeckerei-huber.ch';

/**
 * Demo data for the hosting area. Idempotent. Called from seedDemo after the base data exists.
 *
 * Muster AG gets two domains and a web space with the dns and webhosting modules active.
 * Bäckerei Huber (created by the reseller seed, if present) gets one domain. The rest stays
 * unassigned for the admin inventory. Only unassigned entries are touched.
 */
export async function seedHostingDemo(db: Database, log: string[]): Promise<void> {
  const demo = await db.query.providerConnections.findFirst({ where: eq(providerConnections.type, 'demo') });
  const muster = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'muster-ag') });
  if (!demo || !muster) return;

  const unassignedDomains = (names: string[]) =>
    and(eq(domains.providerConnectionId, demo.id), inArray(domains.name, names), isNull(domains.orgId));

  const musterDomains = await db
    .update(domains)
    .set({ orgId: muster.id })
    .where(unassignedDomains(MUSTER_DOMAINS))
    .returning({ id: domains.id });
  const musterWebspaces = await db
    .update(webspaces)
    .set({ orgId: muster.id })
    .where(
      and(
        eq(webspaces.providerConnectionId, demo.id),
        eq(webspaces.externalId, MUSTER_WEBSPACE),
        isNull(webspaces.orgId),
      ),
    )
    .returning({ id: webspaces.id });
  const modules = normalizeModules([...muster.modules, 'dns', 'webhosting']);
  if (modules.length !== muster.modules.length) {
    await db.update(organizations).set({ modules }).where(eq(organizations.id, muster.id));
  }
  if (musterDomains.length > 0 || musterWebspaces.length > 0) {
    log.push(`assigned ${musterDomains.length} domains and ${musterWebspaces.length} web space to Muster AG`);
  }

  const huber = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'baeckerei-huber') });
  if (huber) {
    const huberDomains = await db
      .update(domains)
      .set({ orgId: huber.id })
      .where(unassignedDomains([HUBER_DOMAIN]))
      .returning({ id: domains.id });
    if (huberDomains.length > 0) log.push(`assigned ${HUBER_DOMAIN} to ${huber.name}`);
  }
}
