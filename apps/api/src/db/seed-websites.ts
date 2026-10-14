import { and, eq, inArray, isNull } from 'drizzle-orm';
import { normalizeModules, type CreatableWebsiteType } from '@weblion/shared';
import type { Database } from './client';
import { organizations, providerConnections, webspaces, websiteAllowances } from './schema';

interface AllowanceSeed {
  slug: string;
  maxSites: number;
  maxDatabases: number;
  siteTypes: CreatableWebsiteType[];
}

/**
 * Website allowances on the demo CloudPanel, the reseller first: Bäckerei Huber's allowance
 * comes out of Alpen Hosting's. Only Muster AG may create Node.js sites (the demo connection
 * itself offers them only once its config allows them).
 */
const ALLOWANCES: AllowanceSeed[] = [
  { slug: 'alpen-hosting', maxSites: 20, maxDatabases: 40, siteTypes: ['php', 'static'] },
  { slug: 'muster-ag', maxSites: 5, maxDatabases: 10, siteTypes: ['php', 'static', 'nodejs'] },
  { slug: 'baeckerei-huber', maxSites: 3, maxDatabases: 5, siteTypes: ['php', 'static'] },
];

/**
 * Managed sites of the demo CloudPanel (see providers/demo/cloudpanel.ts) by organization slug.
 * The protected console site and the site waiting for adoption are never website rows.
 */
const ASSIGNMENTS: { slug: string; domains: string[] }[] = [
  {
    slug: 'muster-ag',
    domains: ['www.muster-ag.example', 'shop.muster-ag.example', 'api.muster-ag.example'],
  },
  { slug: 'baeckerei-huber', domains: ['baeckerei-huber.example'] },
];

/**
 * Demo data for websites: allowances on the demo CloudPanel connection (ENABLE_DEMO_CLOUDPANEL)
 * with the webhosting module, and who gets the connection's websites. Idempotent. Called from
 * seedDemo after the mail demo. An organization is only given an allowance (and the module)
 * while it has none, so later changes stay. Website rows exist once the connection was synced
 * (seed-cli does that first; the test app seeds before any sync): without rows only the
 * allowances are set, a later run hands out the rows that are still unassigned, so a website
 * staff moved elsewhere stays there.
 */
export async function seedWebsitesDemo(db: Database, log: string[]): Promise<void> {
  const cloudpanel = await db.query.providerConnections.findFirst({
    where: eq(providerConnections.envKey, 'demo-cloudpanel'),
  });
  if (!cloudpanel) return;

  for (const seed of ALLOWANCES) {
    const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, seed.slug) });
    if (!org) continue;
    const enable = !org.modules.includes('webhosting');
    const created = await db.transaction(async (tx) => {
      const rows = await tx
        .insert(websiteAllowances)
        .values({
          orgId: org.id,
          providerConnectionId: cloudpanel.id,
          maxSites: seed.maxSites,
          maxDatabases: seed.maxDatabases,
          siteTypes: seed.siteTypes,
        })
        .onConflictDoNothing()
        .returning({ orgId: websiteAllowances.orgId });
      if (rows.length > 0 && enable) {
        await tx
          .update(organizations)
          .set({ modules: normalizeModules([...org.modules, 'webhosting']) })
          .where(eq(organizations.id, org.id));
      }
      return rows.length > 0;
    });
    if (!created) continue;
    log.push(
      `website allowance ${seed.maxSites} sites, ${seed.maxDatabases} databases (${seed.siteTypes.join(', ')}) on ${cloudpanel.name} for ${org.name}${enable ? ', module webhosting' : ''}`,
    );
  }

  for (const seed of ASSIGNMENTS) {
    const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, seed.slug) });
    if (!org) continue;
    const assigned = await db
      .update(webspaces)
      .set({ orgId: org.id })
      .where(
        and(
          eq(webspaces.providerConnectionId, cloudpanel.id),
          eq(webspaces.kind, 'website'),
          inArray(webspaces.externalId, seed.domains),
          isNull(webspaces.orgId),
        ),
      )
      .returning({ externalId: webspaces.externalId });
    if (assigned.length > 0) {
      const names = assigned.map((r) => r.externalId).sort();
      log.push(`assigned websites ${names.join(', ')} to ${org.name}`);
    }
  }
}
