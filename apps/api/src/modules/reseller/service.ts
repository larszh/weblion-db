import { asc, count, eq, or } from 'drizzle-orm';
import type { ModuleKey, OrgRole } from '@weblion/shared';
import type { AppContext } from '../../context';
import type { DbOrTx } from '../../db/client';
import {
  creditTransactions,
  domains,
  invitations,
  invoices,
  organizations,
  payments,
  projects,
  servers,
  services,
  webspaces,
  type Organization,
  type Project,
} from '../../db/schema';
import { randomToken, sha256 } from '../../lib/crypto';
import { AppError } from '../../lib/errors';
import { slugify } from '../../lib/validation';

/**
 * Organization helpers shared by the reseller area and the admin organization routes:
 * slugs, owner invitations, delete protection and module rules between a reseller and
 * its customers.
 */

/** Module each movable resource belongs to. */
export const RESOURCE_MODULES = {
  server: 'servers',
  domain: 'dns',
  webspace: 'webhosting',
} as const satisfies Record<string, ModuleKey>;

export async function uniqueSlug(db: DbOrTx, base: string): Promise<string> {
  const root = slugify(base) || 'org';
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? root : `${root}-${i + 1}`;
    const taken = await db.query.organizations.findFirst({ where: eq(organizations.slug, slug) });
    if (!taken) return slug;
  }
  return `${root}-${randomToken(4).toLowerCase()}`;
}

export const inviteLink = (ctx: AppContext, token: string) =>
  `${ctx.env.APP_URL.replace(/\/$/, '')}/invite/${token}`;

/** Creates an invitation and returns its one-time link. The token itself is never stored. */
export async function createInvitation(
  ctx: AppContext,
  db: DbOrTx,
  input: { orgId: string; email: string; role: OrgRole; invitedBy: string | null; days: number },
): Promise<{ id: string; link: string; expiresAt: Date }> {
  const token = randomToken(24);
  const [invitation] = await db
    .insert(invitations)
    .values({
      orgId: input.orgId,
      email: input.email.toLowerCase(),
      role: input.role,
      tokenHash: sha256(token),
      invitedBy: input.invitedBy,
      expiresAt: new Date(Date.now() + input.days * 86_400_000),
    })
    .returning();
  return { id: invitation!.id, link: inviteLink(ctx, token), expiresAt: invitation!.expiresAt };
}

/** The organization's first project, or a new "Default" one when it has none. */
export async function defaultProject(db: DbOrTx, orgId: string): Promise<Project> {
  const [first] = await db
    .select()
    .from(projects)
    .where(eq(projects.orgId, orgId))
    .orderBy(asc(projects.createdAt), asc(projects.name))
    .limit(1);
  if (first) return first;
  const [created] = await db.insert(projects).values({ orgId, name: 'Default' }).returning();
  return created!;
}

/** Customers of a reseller always stay within the reseller's own modules. */
export function assertModulesWithin(parent: Pick<Organization, 'name' | 'modules'>, modules: ModuleKey[]) {
  const missing = modules.filter((m) => !parent.modules.includes(m));
  if (missing.length > 0) {
    throw new AppError(
      409,
      'conflict',
      `The reseller "${parent.name}" does not have the module(s) ${missing.join(', ')}. Activate them for the reseller first.`,
      { missing },
    );
  }
}

export interface DeleteBlockers {
  customers: number;
  servers: number;
  domains: number;
  webspaces: number;
  invoices: number;
  payments: number;
  creditTransactions: number;
  services: number;
}

const BLOCKER_LABELS: Record<keyof DeleteBlockers, string> = {
  customers: 'customers',
  servers: 'servers',
  domains: 'domains',
  webspaces: 'web spaces',
  invoices: 'invoices',
  payments: 'payments',
  creditTransactions: 'credit transactions',
  services: 'services',
};

/** Everything that keeps an organization from being deleted. */
export async function deleteBlockers(db: DbOrTx, orgId: string): Promise<DeleteBlockers> {
  const n = (rows: { n: number }[]) => rows[0]?.n ?? 0;
  // Sequential on purpose: `db` may be a transaction, which runs one query at a time.
  return {
    customers: n(
      await db.select({ n: count() }).from(organizations).where(eq(organizations.parentOrgId, orgId)),
    ),
    servers: n(
      await db
        .select({ n: count() })
        .from(servers)
        .innerJoin(projects, eq(projects.id, servers.projectId))
        .where(eq(projects.orgId, orgId)),
    ),
    domains: n(await db.select({ n: count() }).from(domains).where(eq(domains.orgId, orgId))),
    webspaces: n(await db.select({ n: count() }).from(webspaces).where(eq(webspaces.orgId, orgId))),
    // Invoices it received and, for resellers, invoices it issued.
    invoices: n(
      await db
        .select({ n: count() })
        .from(invoices)
        .where(or(eq(invoices.orgId, orgId), eq(invoices.issuerOrgId, orgId))),
    ),
    payments: n(await db.select({ n: count() }).from(payments).where(eq(payments.orgId, orgId))),
    creditTransactions: n(
      await db.select({ n: count() }).from(creditTransactions).where(eq(creditTransactions.orgId, orgId)),
    ),
    services: n(await db.select({ n: count() }).from(services).where(eq(services.orgId, orgId))),
  };
}

/** 409 with a readable list ("2 servers, 1 invoices") when anything is still attached. */
export async function assertDeletable(db: DbOrTx, orgId: string): Promise<void> {
  const blockers = await deleteBlockers(db, orgId);
  const attached = (Object.keys(blockers) as (keyof DeleteBlockers)[]).filter((k) => blockers[k] > 0);
  if (attached.length === 0) return;
  const list = attached.map((k) => `${blockers[k]} ${BLOCKER_LABELS[k]}`).join(', ');
  throw new AppError(
    409,
    'conflict',
    `This organization still has ${list}. Move, unassign or remove them before deleting it. Organizations with billing history cannot be deleted, suspend them instead.`,
    blockers,
  );
}
