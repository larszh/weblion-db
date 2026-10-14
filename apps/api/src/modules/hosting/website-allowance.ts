import { and, count, eq, ne, sql } from 'drizzle-orm';
import {
  CREATABLE_WEBSITE_TYPES,
  type CreatableWebsiteType,
  type WebsiteAllowanceDto,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import type { Database, DbOrTx, Tx } from '../../db/client';
import {
  organizations,
  providerConnections,
  webspaceDatabases,
  webspaces,
  websiteAllowances,
  type Organization,
  type ProviderConnection,
  type WebsiteAllowance,
} from '../../db/schema';
import { AppError, conflict, notFound } from '../../lib/errors';
import { allowanceExceeded, noAllowance } from '../cloud/service';

/**
 * Website allowances (module "webhosting", CloudPanel): how many websites and databases an
 * organization may create, of which types, and on which instance.
 *
 * Own websites count on every instance and in every state (a website being created or in an
 * unknown state holds its slot). A reseller's allowance additionally covers the allowances it
 * hands to its customers on the same instance. Every check runs under a per-organization
 * advisory lock (see lockWebsiteOrg), the reseller first, like cloud storage.
 */

/** The types in their canonical order, without duplicates. */
export function normalizeSiteTypes(types: readonly string[]): CreatableWebsiteType[] {
  return CREATABLE_WEBSITE_TYPES.filter((t) => types.includes(t));
}

export const typeNotAllowed = (message: string, details?: unknown) =>
  new AppError(409, 'type_not_allowed', message, details);

/**
 * Serializes website allowance checks and changes of one organization until the transaction
 * ends. The reseller (if any) is always locked first, so lock order is the same everywhere.
 */
export async function lockWebsiteOrg(tx: Tx, org: Pick<Organization, 'id' | 'parentOrgId'>): Promise<void> {
  for (const id of [org.parentOrgId, org.id]) {
    if (id) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`website:${id}`}, 0))`);
  }
}

export interface WebsiteCommitments {
  /** The organization's own websites, on any instance and in any state. */
  sites: number;
  /** Their databases, in any state. */
  databases: number;
  /** Website allowances of a reseller's customers on the instance (0 for everyone else). */
  customers: number;
  /** Their maxSites and maxDatabases. */
  customerSites: number;
  customerDatabases: number;
}

/** What an organization has committed of its allowance. Call lockWebsiteOrg first when acting on it. */
export async function websiteCommitments(
  db: DbOrTx,
  org: Pick<Organization, 'id' | 'kind'>,
  providerId: string | null,
  excludeCustomerId?: string,
): Promise<WebsiteCommitments> {
  const own = and(eq(webspaces.orgId, org.id), eq(webspaces.kind, 'website'));
  const [sites] = await db.select({ n: count() }).from(webspaces).where(own);
  const [databases] = await db
    .select({ n: count() })
    .from(webspaceDatabases)
    .innerJoin(webspaces, eq(webspaces.id, webspaceDatabases.webspaceId))
    .where(own);
  const result: WebsiteCommitments = {
    sites: sites?.n ?? 0,
    databases: databases?.n ?? 0,
    customers: 0,
    customerSites: 0,
    customerDatabases: 0,
  };
  if (org.kind !== 'reseller' || !providerId) return result;
  const [customers] = await db
    .select({
      customers: count(),
      sites: sql<string | null>`sum(${websiteAllowances.maxSites})`,
      databases: sql<string | null>`sum(${websiteAllowances.maxDatabases})`,
    })
    .from(websiteAllowances)
    .innerJoin(organizations, eq(organizations.id, websiteAllowances.orgId))
    .where(
      and(
        eq(organizations.parentOrgId, org.id),
        eq(websiteAllowances.providerConnectionId, providerId),
        excludeCustomerId ? ne(websiteAllowances.orgId, excludeCustomerId) : undefined,
      ),
    );
  result.customers = customers?.customers ?? 0;
  result.customerSites = Number(customers?.sites ?? 0);
  result.customerDatabases = Number(customers?.databases ?? 0);
  return result;
}

/** Websites counted against maxSites: own ones plus, for resellers, the customers' maxima. */
export const committedSites = (c: WebsiteCommitments) => c.sites + c.customerSites;
/** Databases counted against maxDatabases: own ones plus, for resellers, the customers' maxima. */
export const committedDatabases = (c: WebsiteCommitments) => c.databases + c.customerDatabases;

export async function loadWebsiteAllowance(
  db: DbOrTx,
  orgId: string,
): Promise<{ allowance: WebsiteAllowance; connection: ProviderConnection } | null> {
  const [row] = await db
    .select({ allowance: websiteAllowances, connection: providerConnections })
    .from(websiteAllowances)
    .innerJoin(providerConnections, eq(providerConnections.id, websiteAllowances.providerConnectionId))
    .where(eq(websiteAllowances.orgId, orgId))
    .limit(1);
  return row ?? null;
}

/**
 * For a reseller, sites and databases include what its customers got, so maxSites - sites is
 * what it can still hand out (to own websites or customers).
 */
export async function toWebsiteAllowanceDto(
  ctx: AppContext,
  org: Pick<Organization, 'id' | 'kind'>,
  allowance: WebsiteAllowance,
  connection: ProviderConnection,
): Promise<WebsiteAllowanceDto> {
  const usage = await websiteCommitments(ctx.db, org, connection.id);
  return {
    orgId: allowance.orgId,
    provider: {
      id: connection.id,
      type: connection.type,
      name: connection.name,
      location: connection.location,
    },
    maxSites: allowance.maxSites,
    maxDatabases: allowance.maxDatabases,
    siteTypes: normalizeSiteTypes(allowance.siteTypes),
    sites: committedSites(usage),
    databases: committedDatabases(usage),
    customers: usage.customers,
    updatedAt: allowance.updatedAt.toISOString(),
  };
}

export async function websiteAllowanceDto(
  ctx: AppContext,
  org: Pick<Organization, 'id' | 'kind'>,
): Promise<WebsiteAllowanceDto | null> {
  const loaded = await loadWebsiteAllowance(ctx.db, org.id);
  return loaded ? toWebsiteAllowanceDto(ctx, org, loaded.allowance, loaded.connection) : null;
}

export interface WebsiteAllowanceInput {
  providerId: string;
  maxSites: number;
  maxDatabases: number;
  siteTypes: CreatableWebsiteType[];
}

/**
 * Checks a new or changed allowance of `org` (locked with lockWebsiteOrg) against what it has
 * committed: its websites and databases and, for a reseller, its customers' allowances. A
 * customer of a reseller gets its allowance out of the reseller's: on the same instance, with
 * types the reseller has, and within what the reseller has left.
 */
export async function assertWebsiteAllowanceCovers(
  tx: Tx,
  org: Organization,
  current: WebsiteAllowance | undefined,
  next: WebsiteAllowanceInput,
): Promise<void> {
  if (org.kind === 'reseller' && current && current.providerConnectionId !== next.providerId) {
    const before = await websiteCommitments(tx, org, current.providerConnectionId);
    if (before.customers > 0) {
      throw conflict(
        `This reseller handed out websites on its instance to ${before.customers} customers. The instance can only change without them.`,
      );
    }
  }
  const usage = await websiteCommitments(tx, org, next.providerId);
  if (next.maxSites < committedSites(usage)) {
    throw allowanceExceeded(
      `${committedSites(usage)} websites exist or are handed out already. The maximum cannot be lower than that.`,
      { sites: committedSites(usage) },
    );
  }
  if (next.maxDatabases < committedDatabases(usage)) {
    throw allowanceExceeded(
      `${committedDatabases(usage)} databases exist or are handed out already. The maximum cannot be lower than that.`,
      { databases: committedDatabases(usage) },
    );
  }
  if (org.kind === 'reseller' && usage.customers > 0) {
    // Customers' types stay within the reseller's.
    const rows = await tx
      .select({ siteTypes: websiteAllowances.siteTypes })
      .from(websiteAllowances)
      .innerJoin(organizations, eq(organizations.id, websiteAllowances.orgId))
      .where(
        and(
          eq(organizations.parentOrgId, org.id),
          eq(websiteAllowances.providerConnectionId, next.providerId),
        ),
      );
    const handedOut = normalizeSiteTypes(rows.flatMap((r) => r.siteTypes));
    const missing = handedOut.filter((t) => !next.siteTypes.includes(t));
    if (missing.length > 0) {
      throw typeNotAllowed(
        `Customers of this reseller may create ${missing.join(', ')} websites. Take the type away from them first.`,
        { types: missing },
      );
    }
  }

  if (!org.parentOrgId) return;
  const parent = await tx.query.organizations.findFirst({ where: eq(organizations.id, org.parentOrgId) });
  if (!parent || parent.kind !== 'reseller') return;
  const own = await loadWebsiteAllowance(tx, parent.id);
  if (!own) throw noAllowance(`The reseller "${parent.name}" has no website allowance to hand out`);
  const { allowance: resellerAllowance, connection } = own;
  if (resellerAllowance.providerConnectionId !== next.providerId) {
    throw conflict(
      `Customers of ${parent.name} get their websites on the reseller's instance ${connection.name}`,
    );
  }
  const extra = next.siteTypes.filter((t) => !resellerAllowance.siteTypes.includes(t));
  if (extra.length > 0) {
    throw typeNotAllowed(`The allowance of ${parent.name} does not include ${extra.join(', ')} websites`, {
      types: extra,
    });
  }
  // Everything the reseller committed besides this customer, plus the new maxima.
  const committed = await websiteCommitments(tx, parent, resellerAllowance.providerConnectionId, org.id);
  const sitesLeft = resellerAllowance.maxSites - committedSites(committed);
  if (next.maxSites > sitesLeft) {
    throw allowanceExceeded(
      `Only ${Math.max(sitesLeft, 0)} websites of the allowance of ${parent.name} are left for this customer`,
      { maxSites: resellerAllowance.maxSites, sites: committedSites(committed) },
    );
  }
  const databasesLeft = resellerAllowance.maxDatabases - committedDatabases(committed);
  if (next.maxDatabases > databasesLeft) {
    throw allowanceExceeded(
      `Only ${Math.max(databasesLeft, 0)} databases of the allowance of ${parent.name} are left for this customer`,
      { maxDatabases: resellerAllowance.maxDatabases, databases: committedDatabases(committed) },
    );
  }
}

/** Writes an allowance, keeping the creation date of an existing one. */
export async function upsertWebsiteAllowance(
  tx: Tx,
  values: Pick<
    WebsiteAllowance,
    'orgId' | 'providerConnectionId' | 'maxSites' | 'maxDatabases' | 'siteTypes' | 'updatedBy'
  >,
): Promise<void> {
  await tx
    .insert(websiteAllowances)
    .values(values)
    .onConflictDoUpdate({
      target: websiteAllowances.orgId,
      set: {
        providerConnectionId: values.providerConnectionId,
        maxSites: values.maxSites,
        maxDatabases: values.maxDatabases,
        siteTypes: values.siteTypes,
        updatedBy: values.updatedBy,
        updatedAt: new Date(),
      },
    });
}

/** Removes an allowance nothing draws from any more (no websites, no customer allowances). */
export async function removeWebsiteAllowance(db: Database, org: Organization): Promise<WebsiteAllowance> {
  return db.transaction(async (tx) => {
    await lockWebsiteOrg(tx, org);
    const current = await tx.query.websiteAllowances.findFirst({
      where: eq(websiteAllowances.orgId, org.id),
    });
    if (!current) throw notFound('Website allowance');
    const usage = await websiteCommitments(tx, org, current.providerConnectionId);
    if (usage.sites > 0) {
      throw conflict(
        `This organization still has ${usage.sites} websites. Delete them or move them to another organization first.`,
      );
    }
    if (usage.customers > 0) {
      throw conflict(
        `This reseller handed out websites to ${usage.customers} customers. Remove their allowances first.`,
      );
    }
    await tx.delete(websiteAllowances).where(eq(websiteAllowances.orgId, org.id));
    return current;
  });
}
