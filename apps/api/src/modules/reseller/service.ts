import { and, asc, count, eq, inArray, ne, notInArray, or } from 'drizzle-orm';
import {
  formatMoney,
  type Currency,
  type ModuleKey,
  type OrgRole,
  type ServiceResourceType,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import type { DbOrTx, Tx } from '../../db/client';
import {
  cloudAccounts,
  cloudAllowances,
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
import { billingCurrency, creditBalance, lockOrgBilling } from '../billing/ledger';

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
  cloudAccounts: number;
  /** 0 or 1: a cloud storage allowance (Nextcloud accounts would lose their organization). */
  cloudAllowances: number;
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
  cloudAccounts: 'cloud accounts',
  cloudAllowances: 'cloud storage allowance',
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
    cloudAccounts: n(
      await db.select({ n: count() }).from(cloudAccounts).where(eq(cloudAccounts.orgId, orgId)),
    ),
    cloudAllowances: n(
      await db.select({ n: count() }).from(cloudAllowances).where(eq(cloudAllowances.orgId, orgId)),
    ),
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

// --- Seller changes ------------------------------------------------------------------

/** Billing state an organization has with its current seller (the platform or its reseller). */
export interface SellerChangeBlockers {
  /** Credit balance in minor units of `currency`. */
  balance: number;
  currency: Currency;
  /** Draft and open invoices. */
  invoices: number;
  /** Payments still waiting for the payment provider. */
  payments: number;
  /** Active and paused services. */
  services: number;
}

/**
 * Credit, invoices, payments and services all belong to the seller that issued them, and
 * credit is not kept per seller. Moving an organization to another seller while any of
 * them is left would let one seller's credit pay the other's invoices, or bill the old
 * seller's services through the new one. Takes the billing lock, so nothing is booked
 * between this check and the move in the same transaction.
 */
export async function assertSellerChangeable(tx: Tx, orgId: string): Promise<void> {
  await lockOrgBilling(tx, orgId);
  const n = (rows: { n: number }[]) => rows[0]?.n ?? 0;
  const blockers: SellerChangeBlockers = {
    balance: await creditBalance(tx, orgId),
    currency: await billingCurrency(tx, orgId),
    invoices: n(
      await tx
        .select({ n: count() })
        .from(invoices)
        .where(and(eq(invoices.orgId, orgId), inArray(invoices.status, ['draft', 'open']))),
    ),
    payments: n(
      await tx
        .select({ n: count() })
        .from(payments)
        .where(and(eq(payments.orgId, orgId), eq(payments.status, 'pending'))),
    ),
    services: n(
      await tx
        .select({ n: count() })
        .from(services)
        .where(and(eq(services.orgId, orgId), inArray(services.status, ['active', 'suspended']))),
    ),
  };
  const parts = [
    blockers.balance !== 0
      ? `a credit balance of ${formatMoney(blockers.balance, blockers.currency, 'en')}`
      : null,
    blockers.invoices > 0 ? `${blockers.invoices} draft or open invoices` : null,
    blockers.payments > 0 ? `${blockers.payments} pending payments` : null,
    blockers.services > 0 ? `${blockers.services} active or paused services` : null,
  ].filter((p): p is string => p !== null);
  if (parts.length === 0) return;
  throw new AppError(
    409,
    'conflict',
    `This organization still has ${parts.join(', ')} with its current seller. Settle, refund or cancel them before changing its reseller.`,
    blockers,
  );
}

// --- Resources linked to services ----------------------------------------------------

const RESOURCE_LABELS: Record<ServiceResourceType, string> = {
  server: 'server',
  domain: 'domain',
  webspace: 'web space',
};

/**
 * A resource that a service bills for stays where it is: moving it would keep billing the
 * previous organization (or bill it twice once the new owner gets a service as well).
 * Services of the new owner `to` (null = unassigned) stay right after the move, and so do
 * those of its reseller: the platform bills a reseller for a resource it hands on to one
 * of its customers.
 */
export async function assertNoLinkedService(
  db: DbOrTx,
  type: ServiceResourceType,
  resourceId: string,
  to: string | null,
): Promise<void> {
  const keep: string[] = [];
  if (to) {
    const owner = await db.query.organizations.findFirst({
      where: eq(organizations.id, to),
      columns: { parentOrgId: true },
    });
    keep.push(to, ...(owner?.parentOrgId ? [owner.parentOrgId] : []));
  }
  const linked = await db
    .select({ id: services.id, name: services.name, orgId: services.orgId })
    .from(services)
    .where(
      and(
        eq(services.resourceType, type),
        eq(services.resourceId, resourceId),
        ne(services.status, 'cancelled'),
        keep.length > 0 ? notInArray(services.orgId, keep) : undefined,
      ),
    );
  if (linked.length === 0) return;
  const names = linked.map((s) => `"${s.name}"`).join(', ');
  throw new AppError(
    409,
    'conflict',
    `This ${RESOURCE_LABELS[type]} is billed through the service ${names}. Cancel the service before moving the ${RESOURCE_LABELS[type]}, then add one for its new owner if needed.`,
    { services: linked },
  );
}
