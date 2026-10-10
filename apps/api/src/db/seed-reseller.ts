import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import {
  DEFAULT_CUSTOMER_BOUNDARY,
  DEFAULT_RESELLER_BOUNDARY,
  type ModuleKey,
  type OrgKind,
} from '@weblion/shared';
import type { Database } from './client';
import { memberships, organizations, projects, providerConnections, servers, users } from './schema';

/**
 * Demo data for the reseller area. Idempotent. Called from seedDemo after the base data exists.
 *
 * The reseller "Alpen Hosting" with its owner and one customer, "Bäckerei Huber", which
 * gets one of the demo servers that are still unassigned.
 */
export async function seedResellerDemo(db: Database, log: string[], passwordHash: string): Promise<void> {
  async function user(email: string, name: string) {
    const existing = await db.query.users.findFirst({ where: sql`lower(${users.email}) = ${email}` });
    if (existing) return existing;
    const [created] = await db.insert(users).values({ email, name, passwordHash }).returning();
    log.push(`user ${email}`);
    return created!;
  }

  async function org(input: {
    name: string;
    slug: string;
    kind: OrgKind;
    parentOrgId: string | null;
    modules: ModuleKey[];
  }) {
    const existing = await db.query.organizations.findFirst({ where: eq(organizations.slug, input.slug) });
    if (existing) return existing;
    const [created] = await db
      .insert(organizations)
      .values({
        ...input,
        boundary: input.kind === 'reseller' ? DEFAULT_RESELLER_BOUNDARY : DEFAULT_CUSTOMER_BOUNDARY,
      })
      .returning();
    log.push(`org ${input.name}`);
    return created!;
  }

  async function defaultProject(orgId: string) {
    const existing = await db.query.projects.findFirst({
      where: and(eq(projects.orgId, orgId), eq(projects.name, 'Default')),
    });
    if (existing) return existing;
    const [created] = await db.insert(projects).values({ orgId, name: 'Default' }).returning();
    return created!;
  }

  const alpen = await org({
    name: 'Alpen Hosting',
    slug: 'alpen-hosting',
    kind: 'reseller',
    parentOrgId: null,
    modules: ['servers', 'dns', 'webhosting'],
  });
  await defaultProject(alpen.id);
  const reto = await user('reseller@alpen.example', 'Reto Alpen');
  await db
    .insert(memberships)
    .values({ orgId: alpen.id, userId: reto.id, role: 'owner' })
    .onConflictDoNothing();

  const huber = await org({
    name: 'Bäckerei Huber',
    slug: 'baeckerei-huber',
    kind: 'customer',
    parentOrgId: alpen.id,
    modules: ['servers', 'dns'],
  });
  const huberDefault = await defaultProject(huber.id);
  const hanna = await user('huber@baeckerei.example', 'Hanna Huber');
  await db
    .insert(memberships)
    .values({ orgId: huber.id, userId: hanna.id, role: 'owner' })
    .onConflictDoNothing();

  // One server for the customer, taken from the demo servers nobody has yet.
  const [held] = await db
    .select({ n: count() })
    .from(servers)
    .innerJoin(projects, eq(projects.id, servers.projectId))
    .where(eq(projects.orgId, huber.id));
  const demo = await db.query.providerConnections.findFirst({
    where: eq(providerConnections.envKey, 'demo'),
  });
  if (demo && (held?.n ?? 0) === 0) {
    const [free] = await db
      .select()
      .from(servers)
      .where(and(eq(servers.providerConnectionId, demo.id), isNull(servers.projectId)))
      .orderBy(asc(servers.externalId))
      .limit(1);
    if (free) {
      await db
        .update(servers)
        .set({ projectId: huberDefault.id, labels: { env: 'prod' } })
        .where(eq(servers.id, free.id));
      log.push(`assigned demo server ${free.name} to ${huber.name}`);
    }
  }
}
