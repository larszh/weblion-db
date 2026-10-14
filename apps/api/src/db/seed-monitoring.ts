import { and, count, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { normalizeModules } from '@weblion/shared';
import { syncMonitors } from '../jobs/sync-monitoring';
import { DEMO_KUMA_STATUS_PAGE } from '../providers/demo/monitoring';
import { createAdapter } from '../providers/registry';
import type { Database } from './client';
import {
  monitorAllowances,
  monitorStatusPages,
  monitors,
  organizations,
  providerConnections,
  users,
} from './schema';

/**
 * Who gets which monitor of the demo instance (Kuma ids, see providers/demo/monitoring.ts).
 * Monitor 2 becomes Muster AG's own console monitor "Shop" (in Kuma "[muster-ag] Shop"); 6, 7
 * and 8 stay unassigned, 6 for the admin assignment demo.
 */
const ASSIGNMENTS: { externalId: string; slug: string; consoleName?: string }[] = [
  { externalId: '1', slug: 'muster-ag' },
  { externalId: '2', slug: 'muster-ag', consoleName: 'Shop' },
  { externalId: '3', slug: 'muster-ag' },
  { externalId: '4', slug: 'muster-ag' },
  { externalId: '5', slug: 'baeckerei-huber' },
];
/** Creator of the console monitor: Anna, owner of Muster AG. */
const CONSOLE_OWNER = 'anna@muster.example';
/**
 * Only Muster AG gets the module. Alpen Hosting and Bäckerei Huber keep the modules the reseller
 * seed gave them (like the cloud seed): switching "monitoring" on for them is a step to show in
 * the admin area.
 */
const MODULE_ORG = 'muster-ag';
const ALLOWANCES = [
  { slug: 'alpen-hosting', maxMonitors: 50, minIntervalSeconds: 60 },
  { slug: 'muster-ag', maxMonitors: 10, minIntervalSeconds: 60 },
];
const STATUS_PAGES = [{ slug: 'muster-ag', page: DEMO_KUMA_STATUS_PAGE }];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Demo data for monitoring: monitors of the demo connection assigned to Muster AG and Bäckerei
 * Huber (one of Muster AG's as a console monitor), the "monitoring" module for Muster AG only,
 * allowances for Muster AG and Alpen Hosting and Muster AG's status page link. Called from seedDemo
 * after the hosting and cloud seeds. Idempotent.
 *
 * The rows come from the monitor sync (seed-cli and the test app sync the demo connection first);
 * without rows it runs the sync once, and when there are still none it does nothing and logs
 * nothing. Monitors are handed out only while no monitor of the connection is assigned, so ones
 * staff moved later stay where they are, and the module is only switched on along with them, so a
 * module switched off later stays off. Allowances and the status page link are only added while
 * the organization has none.
 */
export async function seedMonitoringDemo(db: Database, log: string[]): Promise<void> {
  const demo = await db.query.providerConnections.findFirst({
    where: eq(providerConnections.envKey, 'demo'),
  });
  if (!demo) return;
  const rows = async () => {
    const [row] = await db
      .select({ n: count() })
      .from(monitors)
      .where(eq(monitors.providerConnectionId, demo.id));
    return row?.n ?? 0;
  };
  if ((await rows()) === 0) {
    // The demo keeps its state per connection in memory, the configuration does not matter here.
    const adapter = createAdapter(demo.type, demo.id, {});
    if (!adapter.listMonitors) return;
    await syncMonitors(db, demo, adapter);
    if ((await rows()) === 0) return;
  }

  const slugs = [
    ...new Set([...ASSIGNMENTS, ...ALLOWANCES, ...STATUS_PAGES].map((s) => s.slug).concat(MODULE_ORG)),
  ];
  const orgs = new Map(
    (await db.select().from(organizations).where(inArray(organizations.slug, slugs))).map((o) => [o.slug, o]),
  );
  const owner = await db.query.users.findFirst({ where: sql`lower(${users.email}) = ${CONSOLE_OWNER}` });

  const done = await db.transaction(async (tx) => {
    let assigned = 0;
    let moduleFor: string | null = null;
    const [taken] = await tx
      .select({ n: count() })
      .from(monitors)
      .where(and(eq(monitors.providerConnectionId, demo.id), isNotNull(monitors.orgId)));
    if ((taken?.n ?? 0) === 0) {
      const receivers = new Set<string>();
      for (const a of ASSIGNMENTS) {
        const org = orgs.get(a.slug);
        if (!org) continue;
        const changed = await tx
          .update(monitors)
          .set(
            a.consoleName
              ? { orgId: org.id, origin: 'console', name: a.consoleName, createdBy: owner?.id ?? null }
              : { orgId: org.id },
          )
          .where(
            and(
              eq(monitors.providerConnectionId, demo.id),
              eq(monitors.externalId, a.externalId),
              isNull(monitors.orgId),
            ),
          )
          .returning({ id: monitors.id });
        assigned += changed.length;
        if (changed.length > 0) receivers.add(a.slug);
      }
      const target = orgs.get(MODULE_ORG);
      if (target && receivers.has(MODULE_ORG)) {
        // Fresh read: other seeds of this run switch modules too.
        const current = await tx.query.organizations.findFirst({ where: eq(organizations.id, target.id) });
        if (current && !current.modules.includes('monitoring')) {
          await tx
            .update(organizations)
            .set({ modules: normalizeModules([...current.modules, 'monitoring']) })
            .where(eq(organizations.id, current.id));
          moduleFor = current.name;
        }
      }
    }

    let allowances = 0;
    for (const a of ALLOWANCES) {
      const org = orgs.get(a.slug);
      if (!org) continue;
      const added = await tx
        .insert(monitorAllowances)
        .values({
          orgId: org.id,
          providerConnectionId: demo.id,
          maxMonitors: a.maxMonitors,
          minIntervalSeconds: a.minIntervalSeconds,
        })
        .onConflictDoNothing()
        .returning({ orgId: monitorAllowances.orgId });
      allowances += added.length;
    }

    let pages = 0;
    for (const p of STATUS_PAGES) {
      const org = orgs.get(p.slug);
      if (!org) continue;
      const added = await tx
        .insert(monitorStatusPages)
        .values({ orgId: org.id, providerConnectionId: demo.id, slug: p.page })
        .onConflictDoNothing()
        .returning({ id: monitorStatusPages.id });
      pages += added.length;
    }
    return { assigned, moduleFor, allowances, pages };
  });

  const parts = [
    done.assigned > 0 ? plural(done.assigned, 'monitor assigned', 'monitors assigned') : null,
    done.moduleFor ? `module monitoring for ${done.moduleFor}` : null,
    done.allowances > 0 ? plural(done.allowances, 'allowance', 'allowances') : null,
    done.pages > 0 ? plural(done.pages, 'status page', 'status pages') : null,
  ].filter((part): part is string => part !== null);
  if (parts.length > 0) log.push(`monitoring: ${parts.join(', ')}`);
}
