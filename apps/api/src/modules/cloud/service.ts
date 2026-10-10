import { randomInt } from 'node:crypto';
import { and, count, eq, ne, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import {
  ALL_PERMISSIONS,
  type CloudAccountDto,
  type CloudAllowanceDto,
  type ModuleKey,
  type Permission,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import { requireAuth, type Scope } from '../../auth/access';
import type { DbOrTx, Tx } from '../../db/client';
import {
  cloudAccounts,
  cloudAllowances,
  organizations,
  providerConnections,
  type CloudAccount,
  type CloudAllowance,
  type Organization,
  type ProviderConnection,
} from '../../db/schema';
import { AppError, notFound, unsupported } from '../../lib/errors';
import type { NextcloudConfig, ProviderAdapter, RemoteCloudAccount } from '../../providers/types';

/**
 * Cloud storage (module "storage"): Nextcloud accounts inside a storage allowance.
 *
 * An organization's allowance lives on one Nextcloud instance. Its accounts' quotas must
 * fit into it. A reseller's allowance additionally covers the allowances it hands to its
 * own customers on the same instance. Every check runs under a per-organization advisory
 * lock (see lockCloudOrg), so two parallel requests can never overshoot an allowance.
 */

export const CLOUD_PERMISSIONS = ALL_PERMISSIONS.filter((p) => p.startsWith('cloud:'));
export const CLOUD_MODULE = 'storage' as const satisfies ModuleKey;
export const DEFAULT_GROUP_PREFIX = 'weblion-';
/** Quotas are handed out in GiB (CLOUD_MIN_QUOTA_BYTES is one of them). */
export const GIB = 1024 ** 3;
/** Nextcloud user ids are at most 64 characters long. */
export const MAX_USERNAME_LENGTH = 64;

/** Methods an adapter needs to manage cloud accounts at all. */
const CLOUD_METHODS = [
  'listCloudAccounts',
  'getCloudAccount',
  'createCloudAccount',
  'updateCloudAccount',
  'setCloudAccountPassword',
  'deleteCloudAccount',
] as const satisfies readonly (keyof ProviderAdapter)[];

export interface CloudAccountRow {
  account: CloudAccount;
  org: Organization | null;
  connection: ProviderConnection;
}

export interface LoadedCloudAccount extends CloudAccountRow {
  scope: Scope;
  adapter: ProviderAdapter;
}

/** Accounts belong to their organization as a whole. Unassigned ones only reach platform staff. */
export function cloudScope(orgId: string | null): Scope {
  return { orgId, resource: { path: 'org' } };
}

export function supportsCloud(adapter: ProviderAdapter): boolean {
  return CLOUD_METHODS.every((m) => typeof adapter[m] === 'function');
}

/** Throws 422 for providers that cannot manage cloud accounts (anything but Nextcloud and demo). */
export function requireCloudSupport(adapter: ProviderAdapter): void {
  if (!supportsCloud(adapter)) throw unsupported('This provider does not support cloud accounts');
}

export const noAllowance = (message = 'This organization has no cloud storage allowance') =>
  new AppError(409, 'no_allowance', message);
export const allowanceExceeded = (message: string, details?: unknown) =>
  new AppError(409, 'allowance_exceeded', message, details);
export const accountLimit = (message: string, details?: unknown) =>
  new AppError(409, 'account_limit', message, details);

/** Human readable size for error messages, e.g. "500 GB". */
export function formatGb(bytes: number): string {
  const gb = bytes / GIB;
  return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
}

/** Nextcloud group of an organization's accounts: "<prefix><org slug>". */
export function cloudGroup(ctx: AppContext, connection: ProviderConnection, orgSlug: string): string {
  let prefix = DEFAULT_GROUP_PREFIX;
  if (connection.type === 'nextcloud') {
    prefix = ctx.providers.decryptConfig<NextcloudConfig>(connection).groupPrefix || DEFAULT_GROUP_PREFIX;
  }
  return `${prefix}${orgSlug}`;
}

/** The admin account the panel talks to the instance with. Never offered for import. */
export function cloudAdminUser(ctx: AppContext, connection: ProviderConnection): string | null {
  if (connection.type !== 'nextcloud') return null;
  return ctx.providers.decryptConfig<NextcloudConfig>(connection).username ?? null;
}

/** Members of Nextcloud's "admin" group administer the whole instance. */
export function isCloudAdmin(remote: Pick<RemoteCloudAccount, 'groups'>): boolean {
  return remote.groups.includes('admin');
}

// --- Passwords ------------------------------------------------------------------------

const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
/** Non-alphanumeric characters count as special characters in Nextcloud's password policy. */
const SYMBOLS = '-_.!#%+=?*';
const ALPHABET = LOWER + UPPER + DIGITS + SYMBOLS;

const pick = (chars: string) => chars[randomInt(chars.length)]!;

/**
 * A strong random password for a cloud account: 20 characters without look-alikes (no
 * I, l, O, 0, 1), at least one of each class so any password policy setting is satisfied.
 * Shown once, never logged or stored.
 */
export function generateCloudPassword(length = 20): string {
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < length) chars.push(pick(ALPHABET));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

// --- Allowances -----------------------------------------------------------------------

/**
 * Serializes allowance checks and changes of one organization until the transaction ends.
 * The reseller (if any) is always locked first, so lock order is the same everywhere.
 */
export async function lockCloudOrg(tx: Tx, org: Pick<Organization, 'id' | 'parentOrgId'>): Promise<void> {
  for (const id of [org.parentOrgId, org.id]) {
    if (id) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`cloud:${id}`}, 0))`);
  }
}

export interface CloudCommitments {
  /** The organization's own accounts. */
  accounts: number;
  /** Their quotas. Unlimited accounts (imported by staff) count with what they use. */
  allocatedBytes: number;
  usedBytes: number;
  /** Allowances of a reseller's customers on the instance (0 for everyone else). */
  customers: number;
  customerBytes: number;
  /** Accounts the customers may create: their maximum, or what they have without one. */
  customerAccounts: number;
  /** Customer allowances without a maximum number of accounts. */
  customersWithoutMax: number;
}

/** What an organization has committed of its allowance. Call lockCloudOrg first when acting on it. */
export async function cloudCommitments(
  db: DbOrTx,
  org: Pick<Organization, 'id' | 'kind'>,
  providerId: string | null,
  excludeCustomerId?: string,
): Promise<CloudCommitments> {
  const [own] = await db
    .select({
      accounts: count(),
      allocated: sql<
        string | null
      >`sum(coalesce(${cloudAccounts.quotaBytes}, ${cloudAccounts.usedBytes}, 0))`,
      used: sql<string | null>`sum(coalesce(${cloudAccounts.usedBytes}, 0))`,
    })
    .from(cloudAccounts)
    .where(eq(cloudAccounts.orgId, org.id));
  const result: CloudCommitments = {
    accounts: own?.accounts ?? 0,
    allocatedBytes: Number(own?.allocated ?? 0),
    usedBytes: Number(own?.used ?? 0),
    customers: 0,
    customerBytes: 0,
    customerAccounts: 0,
    customersWithoutMax: 0,
  };
  if (org.kind !== 'reseller' || !providerId) return result;
  const [customers] = await db
    .select({
      customers: count(),
      bytes: sql<string | null>`sum(${cloudAllowances.quotaBytes})`,
      accounts: sql<
        string | null
      >`sum(coalesce(${cloudAllowances.maxAccounts}, (select count(*) from ${cloudAccounts} where ${cloudAccounts.orgId} = ${cloudAllowances.orgId})))`,
      withoutMax: sql<string>`count(*) filter (where ${cloudAllowances.maxAccounts} is null)`,
    })
    .from(cloudAllowances)
    .innerJoin(organizations, eq(organizations.id, cloudAllowances.orgId))
    .where(
      and(
        eq(organizations.parentOrgId, org.id),
        eq(cloudAllowances.providerConnectionId, providerId),
        excludeCustomerId ? ne(cloudAllowances.orgId, excludeCustomerId) : undefined,
      ),
    );
  result.customers = customers?.customers ?? 0;
  result.customerBytes = Number(customers?.bytes ?? 0);
  result.customerAccounts = Number(customers?.accounts ?? 0);
  result.customersWithoutMax = Number(customers?.withoutMax ?? 0);
  return result;
}

/** Bytes of an allowance in use: own accounts plus, for resellers, what customers got. */
export const committedBytes = (c: CloudCommitments) => c.allocatedBytes + c.customerBytes;
/** Accounts counted against maxAccounts: own ones plus, for resellers, the customers' share. */
export const committedAccounts = (c: CloudCommitments) => c.accounts + c.customerAccounts;

export async function loadAllowance(
  db: DbOrTx,
  orgId: string,
): Promise<{ allowance: CloudAllowance; connection: ProviderConnection } | null> {
  const [row] = await db
    .select({ allowance: cloudAllowances, connection: providerConnections })
    .from(cloudAllowances)
    .innerJoin(providerConnections, eq(providerConnections.id, cloudAllowances.providerConnectionId))
    .where(eq(cloudAllowances.orgId, orgId))
    .limit(1);
  return row ?? null;
}

/**
 * For a reseller, allocatedBytes and accounts include what its customers got, so
 * quota - allocatedBytes is what it can still hand out (to own accounts or customers).
 */
export async function toAllowanceDto(
  ctx: AppContext,
  org: Pick<Organization, 'id' | 'kind'>,
  allowance: CloudAllowance,
  connection: ProviderConnection,
): Promise<CloudAllowanceDto> {
  const usage = await cloudCommitments(ctx.db, org, connection.id);
  return {
    orgId: allowance.orgId,
    provider: {
      id: connection.id,
      type: connection.type,
      name: connection.name,
      url: ctx.providers.forConnection(connection).cloudLoginUrl?.() ?? null,
    },
    quotaBytes: allowance.quotaBytes,
    maxAccounts: allowance.maxAccounts,
    allocatedBytes: committedBytes(usage),
    usedBytes: usage.usedBytes,
    accounts: committedAccounts(usage),
    customers: usage.customers,
    updatedAt: allowance.updatedAt.toISOString(),
  };
}

export async function allowanceDto(ctx: AppContext, org: Organization): Promise<CloudAllowanceDto | null> {
  const loaded = await loadAllowance(ctx.db, org.id);
  return loaded ? toAllowanceDto(ctx, org, loaded.allowance, loaded.connection) : null;
}

// --- Accounts -------------------------------------------------------------------------

export function cloudAccountRowsQuery(ctx: AppContext) {
  return ctx.db
    .select({ account: cloudAccounts, org: organizations, connection: providerConnections })
    .from(cloudAccounts)
    .innerJoin(providerConnections, eq(providerConnections.id, cloudAccounts.providerConnectionId))
    .leftJoin(organizations, eq(organizations.id, cloudAccounts.orgId));
}

export async function cloudAccountRow(ctx: AppContext, id: string): Promise<CloudAccountRow | null> {
  const [row] = await cloudAccountRowsQuery(ctx).where(eq(cloudAccounts.id, id)).limit(1);
  return row ?? null;
}

/** Loads an account and checks that the caller may at least see it (404 otherwise). */
export async function loadCloudAccount(
  ctx: AppContext,
  req: FastifyRequest,
  id: string,
): Promise<LoadedCloudAccount> {
  requireAuth(req);
  const row = await cloudAccountRow(ctx, id);
  if (!row) throw notFound('Cloud account');
  const scope = cloudScope(row.account.orgId);
  if (!(await ctx.access.can(req, 'cloud:read', scope))) throw notFound('Cloud account');
  return { ...row, scope, adapter: ctx.providers.forConnection(row.connection) };
}

export async function toCloudAccountDto(
  ctx: AppContext,
  req: FastifyRequest,
  row: CloudAccountRow,
): Promise<CloudAccountDto> {
  const { account, org, connection } = row;
  const permissions: Permission[] = await ctx.access.allowed(
    req,
    CLOUD_PERMISSIONS,
    cloudScope(account.orgId),
  );
  return {
    id: account.id,
    username: account.externalId,
    displayName: account.displayName,
    email: account.email,
    quotaBytes: account.quotaBytes,
    usedBytes: account.usedBytes,
    enabled: account.enabled,
    lastLoginAt: account.lastLoginAt?.toISOString() ?? null,
    provider: { id: connection.id, type: connection.type, name: connection.name },
    location: connection.location,
    org: org ? { id: org.id, name: org.name, slug: org.slug } : null,
    loginUrl: ctx.providers.forConnection(connection).cloudLoginUrl?.() ?? null,
    permissions,
    lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null,
    missingSince: account.missingSince?.toISOString() ?? null,
    createdAt: account.createdAt.toISOString(),
  };
}
