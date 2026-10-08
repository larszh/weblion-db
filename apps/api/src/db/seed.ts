import { and, eq, isNull, sql } from 'drizzle-orm';
import { DEFAULT_CUSTOMER_BOUNDARY } from '@weblion/shared';
import type { Database } from './client';
import {
  memberships,
  organizations,
  policies,
  projects,
  providerConnections,
  servers,
  users,
} from './schema';
import { hashPassword } from '../lib/crypto';
import { seedBillingDemo } from './seed-billing';
import { seedHostingDemo } from './seed-hosting';
import { seedResellerDemo } from './seed-reseller';

/**
 * Development seed: two customer organizations with users in different roles, and the
 * demo provider's servers spread across projects. Idempotent, safe to run repeatedly.
 */
export async function seedDemo(db: Database, password: string): Promise<string[]> {
  const log: string[] = [];
  const hash = await hashPassword(password);

  async function user(email: string, name: string) {
    const existing = await db.query.users.findFirst({ where: sql`lower(${users.email}) = ${email}` });
    if (existing) return existing;
    const [created] = await db.insert(users).values({ email, name, passwordHash: hash }).returning();
    log.push(`user ${email}`);
    return created!;
  }

  async function org(name: string, slug: string) {
    const existing = await db.query.organizations.findFirst({ where: eq(organizations.slug, slug) });
    if (existing) return existing;
    const [created] = await db
      .insert(organizations)
      .values({ name, slug, kind: 'customer', boundary: DEFAULT_CUSTOMER_BOUNDARY })
      .returning();
    log.push(`org ${name}`);
    return created!;
  }

  async function project(orgId: string, name: string, description?: string) {
    const existing = await db.query.projects.findFirst({
      where: and(eq(projects.orgId, orgId), eq(projects.name, name)),
    });
    if (existing) return existing;
    const [created] = await db
      .insert(projects)
      .values({ orgId, name, description: description ?? null })
      .returning();
    return created!;
  }

  async function member(
    orgId: string,
    userId: string,
    role: 'owner' | 'admin' | 'member' | 'viewer' | 'restricted',
  ) {
    await db.insert(memberships).values({ orgId, userId, role }).onConflictDoNothing();
  }

  const muster = await org('Muster AG', 'muster-ag');
  const beispiel = await org('Beispiel GmbH', 'beispiel-gmbh');
  const musterWeb = await project(muster.id, 'Webshop', 'Produktiver Shop und Datenbank');
  const musterInt = await project(muster.id, 'Intern', 'Mail, Git, VPN');
  const beispielDefault = await project(beispiel.id, 'Default');

  const anna = await user('anna@muster.example', 'Anna Muster');
  const ben = await user('ben@muster.example', 'Ben Beispiel');
  const carla = await user('carla@muster.example', 'Carla Viewer');
  const dev = await user('dev@beispiel.example', 'Dev Beispiel');
  await member(muster.id, anna.id, 'owner');
  await member(muster.id, ben.id, 'restricted');
  await member(muster.id, carla.id, 'viewer');
  await member(beispiel.id, dev.id, 'owner');

  const existingPolicy = await db.query.policies.findFirst({
    where: and(eq(policies.orgId, muster.id), eq(policies.name, 'Webshop Operator')),
  });
  if (!existingPolicy) {
    const [policy] = await db
      .insert(policies)
      .values({
        orgId: muster.id,
        name: 'Webshop Operator',
        description: 'Darf Webshop-Server sehen, neu starten und Backups erstellen',
        statements: [
          {
            sid: 'SeeProject',
            effect: 'allow',
            actions: ['project:read'],
            resources: [`project/${musterWeb.id}`],
          },
          {
            sid: 'OperateServers',
            effect: 'allow',
            actions: ['server:read', 'server:metrics', 'server:power', 'server:backup:*', 'server:task:read'],
            resources: [`project/${musterWeb.id}/*`],
          },
          { sid: 'NoRestore', effect: 'deny', actions: ['server:backup:restore', 'server:backup:delete'] },
        ],
      })
      .returning();
    const benMembership = await db.query.memberships.findFirst({
      where: and(eq(memberships.orgId, muster.id), eq(memberships.userId, ben.id)),
    });
    await db.execute(
      sql`insert into membership_policies (membership_id, policy_id) values (${benMembership!.id}, ${policy!.id}) on conflict do nothing`,
    );
    log.push('policy Webshop Operator');
  }

  // Spread unassigned demo servers over the projects.
  const demo = await db.query.providerConnections.findFirst({ where: eq(providerConnections.type, 'demo') });
  if (demo) {
    const unassigned = await db
      .select()
      .from(servers)
      .where(and(eq(servers.providerConnectionId, demo.id), isNull(servers.projectId)))
      .orderBy(servers.externalId);
    const targets = [
      musterWeb.id,
      musterWeb.id,
      musterWeb.id,
      musterInt.id,
      musterInt.id,
      beispielDefault.id,
    ];
    for (const [i, server] of unassigned.entries()) {
      const target = targets[i];
      if (!target) break;
      await db
        .update(servers)
        .set({
          projectId: target,
          labels: i < 3 ? { env: i === 0 ? 'prod' : 'staging', team: 'shop' } : { env: 'prod' },
        })
        .where(eq(servers.id, server.id));
    }
    if (unassigned.length > 0)
      log.push(`assigned ${Math.min(unassigned.length, targets.length)} demo servers`);
  }

  // Area specific demo data. Order matters: resellers create organizations the other two use.
  await seedResellerDemo(db, log, hash);
  await seedHostingDemo(db, log);
  await seedBillingDemo(db, log);
  return log;
}
