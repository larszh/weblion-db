import { and, eq, ilike, or, type SQL } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CLOUD_ACCOUNT_NAME_PATTERN,
  CLOUD_QUOTA_TB_STEP_GB,
  isExactCloudQuotaGb,
  normalizeModules,
  type CloudAccountDto,
  type CloudAccountSecretDto,
  type CloudAllowanceDto,
  type OrgCloudDto,
  type Permission,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import { orgScope, platformScope, requireAuth, requireSession } from '../../auth/access';
import type { DbOrTx, Tx } from '../../db/client';
import {
  cloudAccounts,
  cloudAllowances,
  organizations,
  providerConnections,
  type CloudAllowance,
  type Organization,
} from '../../db/schema';
import { AppError, badRequest, conflict, notFound, unsupported } from '../../lib/errors';
import { parse } from '../../lib/validation';
import type { CloudAccountPatch, ProviderAdapter, RemoteCloudAccount } from '../../providers/types';
import { loadOrg } from '../orgs/routes';
import {
  CLOUD_MODULE,
  GIB,
  MAX_USERNAME_LENGTH,
  accountLimit,
  allowanceDto,
  allowanceExceeded,
  cloudAccountRow,
  cloudAccountRowsQuery,
  cloudAdminUser,
  cloudCommitments,
  cloudGroup,
  committedAccounts,
  committedBytes,
  formatGb,
  generateCloudPassword,
  isCloudAdmin,
  loadAllowance,
  loadCloudAccount,
  lockCloudOrg,
  noAllowance,
  requireCloudSupport,
  toAllowanceDto,
  toCloudAccountDto,
  type LoadedCloudAccount,
} from './service';

const idParams = z.object({ id: z.uuid() });
const orgParams = z.object({ orgId: z.uuid() });

const quotaGb = z.number().int().min(1).max(1_000_000);
/** Account quotas are stored at Nextcloud, which rounds some of them (see isExactCloudQuotaGb). */
const accountQuotaGb = quotaGb.refine(
  isExactCloudQuotaGb,
  `From 1024 GB on, quotas go in steps of ${CLOUD_QUOTA_TB_STEP_GB} GB (Nextcloud rounds other values)`,
);
const maxAccounts = z.number().int().min(1).max(100_000).nullable();
/** Empty strings from forms mean "none". */
const optionalText = (schema: z.ZodString | z.ZodEmail) =>
  z
    .union([z.literal(''), schema])
    .nullish()
    .transform((v) => (v === '' ? null : v));
/** Nextcloud stores display names of up to 64 characters. */
const displayName = optionalText(z.string().trim().max(64));
const email = optionalText(z.email().max(200));

const createBody = z.object({
  name: z
    .string()
    .trim()
    .regex(CLOUD_ACCOUNT_NAME_PATTERN, 'lower-case letters, digits, dot, dash, underscore'),
  displayName,
  email,
  quotaGb: accountQuotaGb,
  invite: z.boolean().default(false),
});
const patchBody = z.object({
  displayName,
  email,
  quotaGb: accountQuotaGb.optional(),
  enabled: z.boolean().optional(),
});
const deleteBody = z.object({ confirm: z.string().max(200) });

const adminListQuery = z.object({
  q: z.string().max(100).optional(),
  orgId: z.uuid().optional(),
  providerId: z.uuid().optional(),
});
const adminAllowanceBody = z.object({
  providerId: z.uuid(),
  quotaGb,
  maxAccounts,
  enableModule: z.boolean().default(true),
});
const resellerAllowanceBody = z.object({ quotaGb, maxAccounts });
const importBody = z.object({
  providerId: z.uuid(),
  username: z.string().trim().min(1).max(MAX_USERNAME_LENGTH),
  orgId: z.uuid().nullable(),
});
const assignBody = z.object({ orgId: z.uuid().nullable() });

const like = (q: string) => `%${q.replace(/[%_]/g, '')}%`;
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Passwords must not end up in browser or proxy caches. */
function noStore(reply: FastifyReply) {
  reply.header('cache-control', 'no-store');
}

/** Row values of a Nextcloud user as the instance reports it. */
function remoteFields(remote: RemoteCloudAccount, now: Date) {
  return {
    displayName: remote.displayName,
    email: remote.email,
    quotaBytes: remote.quotaBytes,
    usedBytes: remote.usedBytes,
    enabled: remote.enabled,
    lastLoginAt: remote.lastLoginAt ? new Date(remote.lastLoginAt) : null,
    lastSyncedAt: now,
    missingSince: null,
  };
}

/** Audit entry of a change at the instance. */
interface InstanceEntry {
  action: string;
  orgId: string | null;
  resourceId: string | null;
  details: Record<string, unknown>;
}

/**
 * A change at the instance that failed inside a transaction. It is audited only after the
 * rollback: the audit needs a pool connection of its own, and awaiting one while the
 * transaction holds a connection (and the org lock, which queued requests wait for on
 * connections of their own) can exhaust the pool for good.
 */
class InstanceFailure extends Error {
  constructor(readonly error: unknown) {
    super(errorMessage(error));
  }
}

/** Runs a change at the instance inside a transaction; a failure becomes an InstanceFailure. */
async function inTransaction<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new InstanceFailure(err);
  }
}

/** Cloud storage: Nextcloud accounts of an organization, allowances, admin inventory. */
export async function cloudRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, access, audit, providers } = ctx;

  async function account(req: FastifyRequest, permission?: Permission): Promise<LoadedCloudAccount> {
    const { id } = parse(idParams, req.params);
    const loaded = await loadCloudAccount(ctx, req, id);
    if (permission) await access.assert(req, permission, loaded.scope);
    return loaded;
  }

  async function accountDto(req: FastifyRequest, id: string): Promise<CloudAccountDto> {
    const row = await cloudAccountRow(ctx, id);
    if (!row) throw notFound('Cloud account');
    return toCloudAccountDto(ctx, req, row);
  }

  /** Inside a transaction pass `tx`: a second pool connection must never be awaited there. */
  async function connectionById(id: string, from: DbOrTx = db) {
    const connection = await from.query.providerConnections.findFirst({
      where: eq(providerConnections.id, id),
    });
    if (!connection) throw notFound('Provider');
    return connection;
  }

  async function orgById(id: string): Promise<Organization> {
    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, id) });
    if (!org) throw notFound('Organization');
    return org;
  }

  /** Audits a failed change at the instance. Returns the error to answer with (an AppError). */
  async function failedAtInstance(
    req: FastifyRequest,
    entry: InstanceEntry,
    err: unknown,
  ): Promise<AppError> {
    const error = err instanceof InstanceFailure ? err.error : err;
    await audit.record(req, {
      action: entry.action,
      orgId: entry.orgId,
      resourceType: 'cloud_account',
      resourceId: entry.resourceId,
      status: 'failure',
      details: { ...entry.details, error: errorMessage(error) },
    });
    return error instanceof AppError ? error : new AppError(500, 'action_failed', errorMessage(error));
  }

  /**
   * Runs a change at the instance. A failure is audited (the success is audited by the
   * caller, once it knows the outcome) and surfaces as an AppError. Inside a transaction use
   * inTransaction instead.
   */
  async function atInstance<T>(req: FastifyRequest, entry: InstanceEntry, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw await failedAtInstance(req, entry, err);
    }
  }

  /** Writes an allowance, keeping the creation date of an existing one. */
  async function upsertAllowance(
    tx: Tx,
    values: Pick<
      CloudAllowance,
      'orgId' | 'providerConnectionId' | 'quotaBytes' | 'maxAccounts' | 'updatedBy'
    >,
  ): Promise<void> {
    await tx
      .insert(cloudAllowances)
      .values(values)
      .onConflictDoUpdate({
        target: cloudAllowances.orgId,
        set: {
          providerConnectionId: values.providerConnectionId,
          quotaBytes: values.quotaBytes,
          maxAccounts: values.maxAccounts,
          updatedBy: values.updatedBy,
          updatedAt: new Date(),
        },
      });
  }

  /** Activates the storage module inside the transaction. Returns whether it was off. */
  async function enableStorage(tx: Tx, orgId: string): Promise<boolean> {
    const [target] = await tx
      .select({ modules: organizations.modules })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .for('update');
    if (!target || target.modules.includes(CLOUD_MODULE)) return false;
    await tx
      .update(organizations)
      .set({ modules: normalizeModules([...target.modules, CLOUD_MODULE]) })
      .where(eq(organizations.id, orgId));
    return true;
  }

  /**
   * Checks a new or changed allowance of `org` against what it has committed already:
   * its accounts and, for a reseller, its customers' allowances on the same instance.
   */
  async function assertAllowanceCovers(
    tx: Tx,
    org: Organization,
    current: CloudAllowance | undefined,
    next: { providerId: string; quotaBytes: number; maxAccounts: number | null },
  ): Promise<void> {
    if (current && current.providerConnectionId !== next.providerId) {
      const before = await cloudCommitments(tx, org, current.providerConnectionId);
      if (before.accounts > 0 || before.customers > 0) {
        throw conflict(
          before.accounts > 0
            ? `This organization still has ${before.accounts} cloud accounts on its instance. The instance can only change without accounts.`
            : `This reseller handed out cloud storage on its instance to ${before.customers} customers. The instance can only change without them.`,
        );
      }
    }
    const usage = await cloudCommitments(tx, org, next.providerId);
    if (next.quotaBytes < committedBytes(usage)) {
      throw allowanceExceeded(
        `${formatGb(committedBytes(usage))} are allocated already. The allowance cannot be lower than that.`,
        { allocatedBytes: committedBytes(usage) },
      );
    }
    if (next.maxAccounts !== null && next.maxAccounts < committedAccounts(usage)) {
      throw accountLimit(
        `${committedAccounts(usage)} accounts are in use or handed out already. The maximum cannot be lower than that.`,
        { accounts: committedAccounts(usage) },
      );
    }
    // A reseller's maximum only binds when its customers have one too: one without counts with
    // the accounts it has and can create more. Keeping an unchanged maximum stays possible.
    if (
      next.maxAccounts !== null &&
      next.maxAccounts !== current?.maxAccounts &&
      usage.customersWithoutMax > 0
    ) {
      throw accountLimit(
        `${usage.customersWithoutMax} customers of this reseller have no maximum number of accounts. Give each of them one first.`,
        { customersWithoutMax: usage.customersWithoutMax },
      );
    }
  }

  // --- Customer view ----------------------------------------------------------------

  app.get('/orgs/:orgId/cloud', async (req): Promise<OrgCloudDto> => {
    const { orgId } = parse(orgParams, req.params);
    const org = await loadOrg(ctx, req, orgId);
    await access.assert(req, 'cloud:read', orgScope(orgId));
    const rows = await cloudAccountRowsQuery(ctx)
      .where(eq(cloudAccounts.orgId, orgId))
      .orderBy(cloudAccounts.externalId);
    return {
      allowance: await allowanceDto(ctx, org),
      accounts: await Promise.all(rows.map((row) => toCloudAccountDto(ctx, req, row))),
    };
  });

  app.post('/orgs/:orgId/cloud/accounts', async (req, reply): Promise<CloudAccountSecretDto> => {
    const { orgId } = parse(orgParams, req.params);
    const auth = requireAuth(req);
    const org = await loadOrg(ctx, req, orgId);
    await access.assert(req, 'cloud:write', orgScope(orgId));
    const body = parse(createBody, req.body);
    if (body.invite && !body.email) {
      throw badRequest('Validation failed', [
        { path: 'email', message: 'An invitation needs an e-mail address' },
      ]);
    }
    // A generated password is shown once to a person. Scripts let Nextcloud mail the user.
    if (auth.token && !body.invite) {
      throw badRequest(
        'API tokens cannot receive passwords. Create the account with invite: true and an e-mail address.',
      );
    }
    const username = `${body.name}@${org.slug}`;
    if (username.length > MAX_USERNAME_LENGTH) {
      throw badRequest('Validation failed', [
        {
          path: 'name',
          message: `The login name ${username} is longer than ${MAX_USERNAME_LENGTH} characters`,
        },
      ]);
    }
    const quotaBytes = body.quotaGb * GIB;
    const password = body.invite ? null : generateCloudPassword();
    const details = {
      username,
      displayName: body.displayName ?? null,
      email: body.email ?? null,
      quotaBytes,
      invite: body.invite,
    };

    const entry = { action: 'cloud.account_create', orgId, resourceId: null, details };
    // Set once the user exists at the instance, to remove it again if storing it fails.
    let created = null as ProviderAdapter | null;
    let id: string;
    try {
      id = await db.transaction(async (tx) => {
        // Held until the account is stored, so parallel requests see each other's accounts.
        // Everything in here goes through tx: no second pool connection while the lock is held.
        await lockCloudOrg(tx, org);
        const allowance = await tx.query.cloudAllowances.findFirst({
          where: eq(cloudAllowances.orgId, orgId),
        });
        if (!allowance) throw noAllowance();
        const connection = await connectionById(allowance.providerConnectionId, tx);
        const adapter = providers.forConnection(connection);
        requireCloudSupport(adapter);

        const usage = await cloudCommitments(tx, org, connection.id);
        if (allowance.maxAccounts !== null && committedAccounts(usage) + 1 > allowance.maxAccounts) {
          throw accountLimit(`The allowance covers at most ${allowance.maxAccounts} accounts`, {
            maxAccounts: allowance.maxAccounts,
            accounts: committedAccounts(usage),
          });
        }
        const free = allowance.quotaBytes - committedBytes(usage);
        if (quotaBytes > free) {
          throw allowanceExceeded(
            `Only ${formatGb(Math.max(free, 0))} of the allowance of ${formatGb(allowance.quotaBytes)} are left`,
            { quotaBytes: allowance.quotaBytes, allocatedBytes: committedBytes(usage) },
          );
        }
        const existing = await tx.query.cloudAccounts.findFirst({
          where: and(
            eq(cloudAccounts.providerConnectionId, connection.id),
            eq(cloudAccounts.externalId, username),
          ),
        });
        if (existing) throw conflict(`The account ${username} exists already`);

        const remote = await inTransaction(() =>
          adapter.createCloudAccount!({
            username,
            ...(password ? { password } : {}),
            displayName: body.displayName ?? null,
            email: body.email ?? null,
            quotaBytes,
            groups: [cloudGroup(ctx, connection, org.slug)],
            language: auth.user.locale,
          }),
        );
        created = adapter;
        const now = new Date();
        const [row] = await tx
          .insert(cloudAccounts)
          .values({
            providerConnectionId: connection.id,
            externalId: username,
            orgId,
            ...remoteFields(remote, now),
            // What was asked for, in case the instance reports the new user incompletely.
            displayName: remote.displayName ?? body.displayName ?? null,
            email: remote.email ?? body.email ?? null,
            quotaBytes: remote.quotaBytes ?? quotaBytes,
            // Now, not when the transaction began (before the instance had the user): the sync
            // takes accounts created before it read the user list as missing.
            createdAt: now,
          })
          .returning({ id: cloudAccounts.id });
        return row!.id;
      });
    } catch (err) {
      // After the rollback, so audit and cleanup do not wait for a connection while holding one.
      if (err instanceof InstanceFailure) throw await failedAtInstance(req, entry, err);
      if (created) {
        // At the instance, but not stored: remove it, or it lives on outside every allowance.
        const removed = await created.deleteCloudAccount!(username).then(
          () => true,
          () => false,
        );
        await audit.record(req, {
          ...entry,
          resourceType: 'cloud_account',
          status: 'failure',
          details: { ...details, error: errorMessage(err), removedAtInstance: removed },
        });
      }
      throw err;
    }

    await audit.record(req, {
      action: 'cloud.account_create',
      orgId,
      resourceType: 'cloud_account',
      resourceId: id,
      details,
    });
    noStore(reply);
    return { account: await accountDto(req, id), password };
  });

  app.patch('/cloud/accounts/:id', async (req): Promise<CloudAccountDto> => {
    const loaded = await account(req, 'cloud:write');
    const body = parse(patchBody, req.body);
    const { account: current } = loaded;
    const patch: CloudAccountPatch = {};
    if (body.displayName !== undefined && body.displayName !== current.displayName) {
      patch.displayName = body.displayName;
    }
    if (body.email !== undefined && body.email !== current.email) patch.email = body.email;
    if (body.enabled !== undefined && body.enabled !== current.enabled) patch.enabled = body.enabled;
    if (body.quotaGb !== undefined && body.quotaGb * GIB !== current.quotaBytes) {
      patch.quotaBytes = body.quotaGb * GIB;
    }
    if (Object.keys(patch).length === 0) return toCloudAccountDto(ctx, req, loaded);
    // Invitations and password reset links go to this address: changing it hands out access
    // to the account like setting a password does (interactive session, cloud:password).
    if (patch.email !== undefined) {
      requireSession(req);
      await access.assert(req, 'cloud:password', loaded.scope);
    }

    const before = Object.fromEntries(
      Object.keys(patch).map((k) => [k, current[k as keyof CloudAccountPatch]]),
    );
    const entry = {
      action: 'cloud.account_update',
      orgId: current.orgId,
      resourceId: current.id,
      details: { username: current.externalId, before, after: patch },
    };

    try {
      await db.transaction(async (tx) => {
        const quota = patch.quotaBytes;
        const counted = current.quotaBytes ?? current.usedBytes ?? 0;
        // Only a larger quota needs room in the allowance. Smaller ones always fit; one below
        // what the account uses just stops new uploads at Nextcloud.
        if (quota !== undefined && quota > counted && loaded.org) {
          await lockCloudOrg(tx, loaded.org);
          const allowance = await tx.query.cloudAllowances.findFirst({
            where: eq(cloudAllowances.orgId, loaded.org.id),
          });
          if (!allowance) throw noAllowance();
          const [fresh] = await tx
            .select({ quotaBytes: cloudAccounts.quotaBytes, usedBytes: cloudAccounts.usedBytes })
            .from(cloudAccounts)
            .where(eq(cloudAccounts.id, current.id));
          const usage = await cloudCommitments(tx, loaded.org, allowance.providerConnectionId);
          const others = committedBytes(usage) - (fresh?.quotaBytes ?? fresh?.usedBytes ?? 0);
          if (others + quota > allowance.quotaBytes) {
            throw allowanceExceeded(
              `At most ${formatGb(Math.max(allowance.quotaBytes - others, 0))} fit into the allowance of ${formatGb(allowance.quotaBytes)}`,
              { quotaBytes: allowance.quotaBytes, allocatedBytes: committedBytes(usage) },
            );
          }
        }
        await inTransaction(() => loaded.adapter.updateCloudAccount!(current.externalId, patch));
        await tx
          .update(cloudAccounts)
          .set({
            ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
            ...(patch.email !== undefined ? { email: patch.email } : {}),
            ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
            ...(patch.quotaBytes !== undefined ? { quotaBytes: patch.quotaBytes } : {}),
          })
          .where(eq(cloudAccounts.id, current.id));
      });
    } catch (err) {
      // After the rollback (see InstanceFailure).
      if (err instanceof InstanceFailure) throw await failedAtInstance(req, entry, err);
      throw err;
    }
    await audit.record(req, { ...entry, resourceType: 'cloud_account' });
    return accountDto(req, current.id);
  });

  app.post('/cloud/accounts/:id/password', async (req, reply) => {
    const loaded = await account(req);
    requireSession(req);
    await access.assert(req, 'cloud:password', loaded.scope);
    requireCloudSupport(loaded.adapter);
    const { account: current } = loaded;
    const password = generateCloudPassword();
    const entry = {
      action: 'cloud.password_reset',
      orgId: current.orgId,
      resourceId: current.id,
      details: { username: current.externalId },
    };
    await atInstance(req, entry, () => loaded.adapter.setCloudAccountPassword!(current.externalId, password));
    // Who set a new password is recorded, the password itself never is.
    await audit.record(req, { ...entry, resourceType: 'cloud_account' });
    noStore(reply);
    return { password };
  });

  app.post('/cloud/accounts/:id/invite', async (req) => {
    const loaded = await account(req);
    // With a pending invitation the mail carries a new set-password link: like setting a
    // password, only in an interactive session with cloud:password.
    requireSession(req);
    await access.assert(req, 'cloud:password', loaded.scope);
    const { account: current } = loaded;
    if (!current.email) throw badRequest('This account has no e-mail address. Add one first.');
    const { adapter } = loaded;
    if (typeof adapter.resendCloudInvite !== 'function') {
      throw unsupported('This provider cannot send invitations');
    }
    const entry = {
      action: 'cloud.invite',
      orgId: current.orgId,
      resourceId: current.id,
      details: { username: current.externalId, email: current.email },
    };
    await atInstance(req, entry, () => adapter.resendCloudInvite!(current.externalId));
    await audit.record(req, { ...entry, resourceType: 'cloud_account' });
    return { ok: true };
  });

  app.delete('/cloud/accounts/:id', async (req) => {
    const loaded = await account(req, 'cloud:write');
    const { account: current } = loaded;
    const { confirm } = parse(deleteBody, req.body ?? {});
    if (confirm !== current.externalId) {
      throw badRequest('Validation failed', [
        { path: 'confirm', message: `Type the login name ${current.externalId} to confirm` },
      ]);
    }
    const entry = {
      action: 'cloud.account_delete',
      orgId: current.orgId,
      resourceId: current.id,
      details: {
        username: current.externalId,
        quotaBytes: current.quotaBytes,
        usedBytes: current.usedBytes,
      },
    };
    await atInstance(req, entry, async () => {
      try {
        await loaded.adapter.deleteCloudAccount!(current.externalId);
      } catch (err) {
        // Gone at the instance already (deleted there): only the row is left to remove.
        if (!(err instanceof AppError && err.statusCode === 404 && current.missingSince)) throw err;
      }
    });
    await db.delete(cloudAccounts).where(eq(cloudAccounts.id, current.id));
    await audit.record(req, { ...entry, resourceType: 'cloud_account' });
    return { ok: true };
  });

  // --- Admin: allowances --------------------------------------------------------------

  app.get('/admin/orgs/:orgId/cloud-allowance', async (req): Promise<CloudAllowanceDto | null> => {
    await access.assert(req, 'platform:org:read', platformScope);
    const { orgId } = parse(orgParams, req.params);
    return allowanceDto(ctx, await orgById(orgId));
  });

  app.put('/admin/orgs/:orgId/cloud-allowance', async (req): Promise<CloudAllowanceDto> => {
    const auth = requireAuth(req);
    await access.assert(req, 'platform:org:write', platformScope);
    const { orgId } = parse(orgParams, req.params);
    const body = parse(adminAllowanceBody, req.body);
    const org = await orgById(orgId);
    const connection = await connectionById(body.providerId);
    requireCloudSupport(providers.forConnection(connection));
    if (body.enableModule && org.parentOrgId && !org.modules.includes(CLOUD_MODULE)) {
      const parent = await orgById(org.parentOrgId);
      if (!parent.modules.includes(CLOUD_MODULE)) {
        throw conflict(
          `The reseller "${parent.name}" does not have the module "${CLOUD_MODULE}". Activate it for the reseller first.`,
        );
      }
    }
    const next = { providerId: connection.id, quotaBytes: body.quotaGb * GIB, maxAccounts: body.maxAccounts };

    const { previous, moduleEnabled } = await db.transaction(async (tx) => {
      await lockCloudOrg(tx, org);
      const current = await tx.query.cloudAllowances.findFirst({ where: eq(cloudAllowances.orgId, orgId) });
      await assertAllowanceCovers(tx, org, current, next);
      await upsertAllowance(tx, {
        orgId,
        providerConnectionId: next.providerId,
        quotaBytes: next.quotaBytes,
        maxAccounts: next.maxAccounts,
        updatedBy: auth.user.id,
      });
      return {
        previous: current ?? null,
        moduleEnabled: body.enableModule ? await enableStorage(tx, orgId) : false,
      };
    });
    await audit.record(req, {
      action: 'cloud.allowance_set',
      orgId,
      resourceType: 'cloud_allowance',
      resourceId: orgId,
      details: {
        providerId: next.providerId,
        quotaBytes: next.quotaBytes,
        maxAccounts: next.maxAccounts,
        previous: previous
          ? {
              providerId: previous.providerConnectionId,
              quotaBytes: previous.quotaBytes,
              maxAccounts: previous.maxAccounts,
            }
          : null,
        moduleEnabled: moduleEnabled ? CLOUD_MODULE : null,
      },
    });
    return (await allowanceDto(ctx, org))!;
  });

  /** Removes an allowance nothing draws from any more (no accounts, no customer allowances). */
  async function removeAllowance(org: Organization): Promise<CloudAllowance> {
    return db.transaction(async (tx) => {
      await lockCloudOrg(tx, org);
      const current = await tx.query.cloudAllowances.findFirst({ where: eq(cloudAllowances.orgId, org.id) });
      if (!current) throw notFound('Cloud storage allowance');
      const usage = await cloudCommitments(tx, org, current.providerConnectionId);
      if (usage.accounts > 0) {
        throw conflict(
          `This organization still has ${usage.accounts} cloud accounts. Delete them or move them to another organization first.`,
        );
      }
      if (usage.customers > 0) {
        throw conflict(
          `This reseller handed out cloud storage to ${usage.customers} customers. Remove their allowances first.`,
        );
      }
      await tx.delete(cloudAllowances).where(eq(cloudAllowances.orgId, org.id));
      return current;
    });
  }

  app.delete('/admin/orgs/:orgId/cloud-allowance', async (req) => {
    await access.assert(req, 'platform:org:write', platformScope);
    const { orgId } = parse(orgParams, req.params);
    const removed = await removeAllowance(await orgById(orgId));
    await audit.record(req, {
      action: 'cloud.allowance_delete',
      orgId,
      resourceType: 'cloud_allowance',
      resourceId: orgId,
      details: {
        providerId: removed.providerConnectionId,
        quotaBytes: removed.quotaBytes,
        maxAccounts: removed.maxAccounts,
      },
    });
    return { ok: true };
  });

  // --- Admin: accounts ----------------------------------------------------------------

  app.get('/admin/cloud/accounts', async (req): Promise<CloudAccountDto[]> => {
    await access.assert(req, 'platform:provider:read', platformScope);
    const query = parse(adminListQuery, req.query);
    const filters: (SQL | undefined)[] = [
      query.orgId ? eq(cloudAccounts.orgId, query.orgId) : undefined,
      query.providerId ? eq(cloudAccounts.providerConnectionId, query.providerId) : undefined,
      query.q
        ? or(
            ilike(cloudAccounts.externalId, like(query.q)),
            ilike(cloudAccounts.displayName, like(query.q)),
            ilike(cloudAccounts.email, like(query.q)),
          )
        : undefined,
    ];
    const rows = await cloudAccountRowsQuery(ctx)
      .where(and(...filters))
      .orderBy(cloudAccounts.externalId)
      .limit(1000);
    return Promise.all(rows.map((row) => toCloudAccountDto(ctx, req, row)));
  });

  /** Users at the instance the panel does not manage (created at Nextcloud directly). */
  app.get('/admin/providers/:id/cloud/unmanaged', async (req) => {
    await access.assert(req, 'platform:provider:read', platformScope);
    const connection = await connectionById(parse(idParams, req.params).id);
    const adapter = providers.forConnection(connection);
    requireCloudSupport(adapter);
    const remote = await adapter.listCloudAccounts!();
    const known = new Set(
      (
        await db
          .select({ externalId: cloudAccounts.externalId })
          .from(cloudAccounts)
          .where(eq(cloudAccounts.providerConnectionId, connection.id))
      ).map((r) => r.externalId),
    );
    const adminUser = cloudAdminUser(ctx, connection);
    return remote
      .filter((r) => !known.has(r.externalId) && r.externalId !== adminUser && !isCloudAdmin(r))
      .sort((a, b) => a.externalId.localeCompare(b.externalId))
      .map((r) => ({
        username: r.externalId,
        displayName: r.displayName,
        email: r.email,
        quotaBytes: r.quotaBytes,
        usedBytes: r.usedBytes,
        enabled: r.enabled,
      }));
  });

  /**
   * The organization an account is moved to must have its allowance on the account's
   * instance. Locks the organization, so the allowance cannot change meanwhile.
   */
  async function assertAllowanceOn(tx: Tx, org: Organization, providerId: string): Promise<void> {
    await lockCloudOrg(tx, org);
    const allowance = await tx.query.cloudAllowances.findFirst({ where: eq(cloudAllowances.orgId, org.id) });
    if (!allowance) throw noAllowance(`${org.name} has no cloud storage allowance`);
    if (allowance.providerConnectionId !== providerId) {
      throw conflict(`The cloud storage allowance of ${org.name} is on another instance`);
    }
  }

  /** Takes over a user created at Nextcloud directly. Name and quota stay as they are. */
  app.post('/admin/cloud/accounts/import', async (req): Promise<CloudAccountDto> => {
    await access.assert(req, 'platform:org:write', platformScope);
    const body = parse(importBody, req.body);
    const connection = await connectionById(body.providerId);
    const adapter = providers.forConnection(connection);
    requireCloudSupport(adapter);
    if (body.username === cloudAdminUser(ctx, connection)) {
      throw conflict('The admin account of the instance cannot be imported');
    }
    const org = body.orgId ? await orgById(body.orgId) : null;
    const id = await db.transaction(async (tx) => {
      if (org) await assertAllowanceOn(tx, org, connection.id);
      const existing = await tx.query.cloudAccounts.findFirst({
        where: and(
          eq(cloudAccounts.providerConnectionId, connection.id),
          eq(cloudAccounts.externalId, body.username),
        ),
      });
      if (existing) throw conflict(`The account ${body.username} is managed already`);
      const remote = await adapter.getCloudAccount!(body.username);
      // Whoever manages an account can set its password: never hand out an instance admin.
      if (isCloudAdmin(remote)) throw conflict('Nextcloud administrators cannot be managed in the panel');
      const [row] = await tx
        .insert(cloudAccounts)
        .values({
          providerConnectionId: connection.id,
          externalId: remote.externalId,
          orgId: org?.id ?? null,
          ...remoteFields(remote, new Date()),
        })
        .returning({ id: cloudAccounts.id });
      return row!.id;
    });
    await audit.record(req, {
      action: 'cloud.account_import',
      orgId: org?.id ?? null,
      resourceType: 'cloud_account',
      resourceId: id,
      details: { username: body.username, providerId: connection.id, orgId: org?.id ?? null },
    });
    return accountDto(req, id);
  });

  app.post('/admin/cloud/accounts/:id/assign', async (req): Promise<CloudAccountDto> => {
    await access.assert(req, 'platform:org:write', platformScope);
    const { id } = parse(idParams, req.params);
    const body = parse(assignBody, req.body);
    const current = await db.query.cloudAccounts.findFirst({ where: eq(cloudAccounts.id, id) });
    if (!current) throw notFound('Cloud account');
    const org = body.orgId ? await orgById(body.orgId) : null;
    await db.transaction(async (tx) => {
      if (org) await assertAllowanceOn(tx, org, current.providerConnectionId);
      await tx
        .update(cloudAccounts)
        .set({ orgId: org?.id ?? null })
        .where(eq(cloudAccounts.id, id));
    });
    await audit.record(req, {
      action: 'cloud.account_assign',
      orgId: org?.id ?? current.orgId,
      resourceType: 'cloud_account',
      resourceId: id,
      details: { username: current.externalId, orgId: org?.id ?? null, previousOrgId: current.orgId },
    });
    return accountDto(req, id);
  });

  // --- Reseller: allowances of its customers ------------------------------------------

  /** A customer and its reseller, if the caller may manage the reseller's customers (404 otherwise). */
  async function resellerCustomer(req: FastifyRequest, permission: Permission) {
    requireAuth(req);
    const { orgId } = parse(orgParams, req.params);
    const customer = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
    const reseller = customer?.parentOrgId
      ? await db.query.organizations.findFirst({ where: eq(organizations.id, customer.parentOrgId) })
      : undefined;
    if (
      !customer ||
      !reseller ||
      reseller.kind !== 'reseller' ||
      !(await access.canSeeOrg(req, reseller.id))
    ) {
      throw notFound('Customer');
    }
    await access.assert(req, permission, orgScope(reseller.id));
    return { customer, reseller };
  }

  app.get('/reseller/customers/:orgId/cloud-allowance', async (req): Promise<CloudAllowanceDto | null> => {
    const { customer } = await resellerCustomer(req, 'reseller:customer:read');
    return allowanceDto(ctx, customer);
  });

  app.put('/reseller/customers/:orgId/cloud-allowance', async (req): Promise<CloudAllowanceDto> => {
    const auth = requireAuth(req);
    const { customer, reseller } = await resellerCustomer(req, 'reseller:customer:write');
    const body = parse(resellerAllowanceBody, req.body);
    if (!reseller.modules.includes(CLOUD_MODULE)) {
      throw conflict(`Your organization does not have the module "${CLOUD_MODULE}"`);
    }
    const quotaBytes = body.quotaGb * GIB;

    const { previous, moduleEnabled, providerId } = await db.transaction(async (tx) => {
      await lockCloudOrg(tx, customer);
      const own = await loadAllowance(tx, reseller.id);
      if (!own) throw noAllowance('Your organization has no cloud storage allowance to hand out');
      const { allowance: resellerAllowance } = own;
      const providerId = resellerAllowance.providerConnectionId;
      const current = await tx.query.cloudAllowances.findFirst({
        where: eq(cloudAllowances.orgId, customer.id),
      });
      const next = { providerId, quotaBytes, maxAccounts: body.maxAccounts };
      await assertAllowanceCovers(tx, customer, current, next);

      // Everything the reseller committed besides this customer, plus the new allowance.
      const committed = await cloudCommitments(tx, reseller, providerId, customer.id);
      const free = resellerAllowance.quotaBytes - committedBytes(committed);
      if (quotaBytes > free) {
        throw allowanceExceeded(
          `Only ${formatGb(Math.max(free, 0))} of your allowance of ${formatGb(resellerAllowance.quotaBytes)} are left for this customer`,
          { quotaBytes: resellerAllowance.quotaBytes, allocatedBytes: committedBytes(committed) },
        );
      }
      if (resellerAllowance.maxAccounts !== null) {
        const left = resellerAllowance.maxAccounts - committedAccounts(committed);
        if (body.maxAccounts === null) {
          throw accountLimit(
            `Your allowance covers at most ${resellerAllowance.maxAccounts} accounts, so customers need a maximum as well (at most ${Math.max(left, 0)})`,
          );
        }
        if (body.maxAccounts > left) {
          throw accountLimit(
            `Only ${Math.max(left, 0)} accounts of your allowance are left for this customer`,
            {
              maxAccounts: resellerAllowance.maxAccounts,
              accounts: committedAccounts(committed),
            },
          );
        }
      }
      await upsertAllowance(tx, {
        orgId: customer.id,
        providerConnectionId: providerId,
        quotaBytes,
        maxAccounts: body.maxAccounts,
        updatedBy: auth.user.id,
      });
      return { previous: current ?? null, moduleEnabled: await enableStorage(tx, customer.id), providerId };
    });
    await audit.record(req, {
      action: 'cloud.allowance_set',
      orgId: reseller.id,
      resourceType: 'cloud_allowance',
      resourceId: customer.id,
      details: {
        customerId: customer.id,
        customer: customer.name,
        providerId,
        quotaBytes,
        maxAccounts: body.maxAccounts,
        previous: previous ? { quotaBytes: previous.quotaBytes, maxAccounts: previous.maxAccounts } : null,
        moduleEnabled: moduleEnabled ? CLOUD_MODULE : null,
      },
    });
    return (await allowanceDto(ctx, customer))!;
  });

  /** Gives the storage back to the reseller, e.g. before the customer is deleted. Only without accounts. */
  app.delete('/reseller/customers/:orgId/cloud-allowance', async (req) => {
    const { customer, reseller } = await resellerCustomer(req, 'reseller:customer:write');
    const removed = await removeAllowance(customer);
    await audit.record(req, {
      action: 'cloud.allowance_delete',
      orgId: reseller.id,
      resourceType: 'cloud_allowance',
      resourceId: customer.id,
      details: {
        customerId: customer.id,
        customer: customer.name,
        providerId: removed.providerConnectionId,
        quotaBytes: removed.quotaBytes,
        maxAccounts: removed.maxAccounts,
      },
    });
    return { ok: true };
  });
}
