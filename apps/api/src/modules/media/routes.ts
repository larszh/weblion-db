import { and, asc, count, eq, ilike, inArray, lt, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  MEDIA_ACCOUNT_CODE_PATTERN,
  MEDIA_MAX_ACCOUNTS,
  MEDIA_MAX_BITRATE_MBIT,
  MEDIA_MAX_STREAMS,
  MEDIA_PASSWORD_MAX,
  MEDIA_PASSWORD_MIN,
  MEDIA_QUICK_CONNECT_ATTEMPTS_PER_MINUTE,
  MEDIA_REQUEST_QUOTA_DAYS_MAX,
  MEDIA_REQUEST_QUOTA_MAX,
  MEDIA_SEERR_FIXABLE,
  expectedMediaPolicy,
  isMediaAccountName,
  mediaAccessExceeds,
  mediaActivityDay,
  mediaPasswordIssues,
  mediaPolicyDrift,
  mediaRequestsExceed,
  mediaUsername,
  normalizeMediaId,
  normalizeMediaRequests,
  normalizeModules,
  normalizeQuickConnectCode,
  sameMediaRequests,
  type MediaAccess,
  type MediaAccessConflict,
  type MediaAccountDto,
  type MediaAccountSecretDto,
  type MediaAllowanceChangeResult,
  type MediaAllowanceConflictDetails,
  type MediaAllowanceDto,
  type MediaConnectResultDto,
  type MediaDevicesDto,
  type MediaInstanceDto,
  type MediaLibraryRef,
  type MediaPasswordIssue,
  type MediaPasswordResultDto,
  type MediaPolicyApplyResult,
  type MediaRequestsAccess,
  type MediaRequestsConflict,
  type MediaSeerrChangeResult,
  type MediaSeerrDto,
  type MediaSignOutResultDto,
  type OrgMediaDto,
  type Permission,
  type UnmanagedMediaUserDto,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import { orgScope, platformScope, requireAuth, requireSession } from '../../auth/access';
import type { DbOrTx, Tx } from '../../db/client';
import {
  mediaAccounts,
  mediaAllowances,
  mediaSeerr,
  organizations,
  providerConnections,
  type MediaAllowance,
  type Organization,
  type ProviderConnection,
} from '../../db/schema';
import { runStart } from '../../lib/clock';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { parse } from '../../lib/validation';
import { JELLYFIN_ADMIN_REFUSED, mediaAccountDisabled } from '../../providers/jellyfin/rules';
import type { ProviderAdapter, SeerrCheckResult } from '../../providers/types';
import { loadOrg } from '../orgs/routes';
import {
  SEERR_STEP_MS,
  SeerrLookup,
  allowanceRequestsShown,
  applySeerrOrg,
  checkSeerr,
  deleteSeerrAccount,
  mediaAllowanceDtoFor,
  mediaRequestsColumns,
  mediaRequestsInfo,
  mediaRequestsOf,
  organizationsWithRequests,
  pendingSeerrRevocations,
  requestsUnavailable,
  revokeSeerrConnection,
  seerrAccountStep,
  seerrApplyDetails,
  seerrNotConfigured,
  seerrSettingsOf,
  seerrShared,
  seerrState,
  seerrUnsafe,
  seerrVisibleForAccount,
  storedSeerrDto,
  toMediaAccountDtoFor,
  toMediaAllowanceDtoFor,
  type AllowanceViewer,
  type SeerrOutcome,
} from './seerr';
import {
  MEDIA_MODULE,
  accountLimit,
  allowanceConflict,
  applyMediaPolicy,
  bestEffort,
  committedMediaAccounts,
  errorMessage,
  expectedPolicyFor,
  generateMediaAccountCode,
  generateMediaPassword,
  loadMediaAccount,
  loadMediaAllowance,
  lockMediaOrg,
  mediaAccessOf,
  mediaAccountCodeFree,
  mediaAccountIssues,
  mediaAccountRow,
  mediaAccountRowsQuery,
  mediaCommitments,
  mediaLoginDto,
  noAllowance,
  remoteCodeSuffixes,
  remoteMediaFields,
  requireMediaDevices,
  requireMediaSupport,
  sameMediaAccess,
  settleWithin,
  sortMediaIssues,
  supportsMedia,
  type LoadedMediaAccount,
} from './service';

const idParams = z.object({ id: z.uuid() });
const orgParams = z.object({ orgId: z.uuid() });

const name = z
  .string()
  .trim()
  .refine(isMediaAccountName, 'lower-case letters, digits and single dashes, 1 to 20 characters');
const PASSWORD_ISSUES: Record<MediaPasswordIssue, string> = {
  length: `at least ${MEDIA_PASSWORD_MIN} characters`,
  tooLong: `at most ${MEDIA_PASSWORD_MAX} characters`,
  characters: 'no control characters and no spaces at either end',
};
/** One message per issue the shared check finds (zod's min/max would count UTF-16 units). */
const password = z.string().superRefine((p, c) => {
  for (const issue of mediaPasswordIssues(p)) c.addIssue({ code: 'custom', message: PASSWORD_ISSUES[issue] });
});
const libraryId = z
  .string()
  .transform(
    (v, c) =>
      normalizeMediaId(v) ?? (c.addIssue({ code: 'custom', message: 'not a Jellyfin library id' }), z.NEVER),
  );
const requestQuota = z
  .object({
    limit: z.number().int().min(1).max(MEDIA_REQUEST_QUOTA_MAX),
    days: z.number().int().min(1).max(MEDIA_REQUEST_QUOTA_DAYS_MAX),
  })
  .nullable();
/**
 * The requests add-on: absent keeps it, null switches it off. "No requests" is off, never a quota
 * of 0 (Seerr reads 0 as no limit).
 */
const requestsShape = z
  .object({ movies: z.boolean(), tv: z.boolean(), movieQuota: requestQuota, tvQuota: requestQuota })
  .refine((r) => r.movies || r.tv, { message: 'movies, tv or both', path: ['movies'] })
  .nullable()
  .optional();
const accessShape = {
  maxAccounts: z.number().int().min(1).max(MEDIA_MAX_ACCOUNTS),
  libraryIds: z.array(libraryId).min(1).max(100),
  maxStreams: z.number().int().min(1).max(MEDIA_MAX_STREAMS),
  downloads: z.boolean(),
  remoteBitrateMbit: z.number().int().min(1).max(MEDIA_MAX_BITRATE_MBIT).nullable(),
  requests: requestsShape,
};
const createBody = z.object({ name, password: password.optional() });
const patchBody = z.object({ enabled: z.boolean() });
const passwordBody = z.object({ password: password.optional() });
const confirmBody = z.object({ confirm: z.string().trim().toLowerCase().max(300) });
const adminAllowanceBody = z.object({
  providerId: z.uuid(),
  accountCode: z.string().trim().toLowerCase().regex(MEDIA_ACCOUNT_CODE_PATTERN).optional(),
  ...accessShape,
  enableModule: z.boolean().default(true),
});
const resellerAllowanceBody = z.object(accessShape);
const adminListQuery = z.object({
  q: z.string().max(100).optional(),
  orgId: z.uuid().optional(),
  providerId: z.uuid().optional(),
  issues: z.enum(['true', 'false']).optional(),
});
const importBody = z.object({
  providerId: z.uuid(),
  userId: z.string().trim().min(1).max(64),
  orgId: z.uuid().nullable(),
  setPassword: z.boolean().default(false),
});
const assignBody = z.object({ orgId: z.uuid().nullable() });
const seerrBody = z.object({ enabled: z.boolean(), confirmShared: z.boolean().default(false) });
/** As typed ("123 456"); normalizeQuickConnectCode decides. The value is never echoed. */
const connectBody = z.object({ code: z.string().max(20) });

/** Budget for the live part of one instance in the admin overview. */
const INSTANCE_LIVE_TIMEOUT_MS = 10_000;
/** How long reading one account live may take before the stored state is answered. */
const LIVE_TIMEOUT_MS = 10_000;
/** Budget of the live Seerr check of the admin dialog. */
const SEERR_CHECK_TIMEOUT_MS = 10_000;

const like = (q: string) => `%${q.replace(/[%_\\]/g, '')}%`;

/** Passwords and anything answered for a Quick Connect code must not end up in browser or proxy caches. */
function noStore(reply: FastifyReply) {
  reply.header('cache-control', 'no-store');
}

/** Rejects after `ms` (the call itself goes on). */
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('The instance did not answer in time')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Ids of a request without duplicates, in the order given. */
const uniqueIds = (ids: string[]) => [...new Set(ids)];

/** Postgres unique_violation, also when drizzle wraps the driver error. */
function isUniqueViolation(err: unknown): boolean {
  const code = (e: unknown) => (e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined);
  return code(err) === '23505' || code((err as { cause?: unknown } | null)?.cause) === '23505';
}

/** The access part of an allowance as audited. */
function accessDetails(access: MediaAccess) {
  return {
    libraryIds: access.libraryIds,
    maxStreams: access.maxStreams,
    downloads: access.downloads,
    remoteBitrateMbit: access.remoteBitrateMbit,
  };
}

/**
 * The add-on only while it is on: organizations without it see nothing of requests, also here.
 * `showRequests` false leaves it out for readers who do not see the add-on (an organization whose
 * Seerr is not active, a reseller without the add-on).
 */
function allowanceDetails(allowance: MediaAllowance, showRequests: boolean) {
  const requests = showRequests ? mediaRequestsOf(allowance) : null;
  return {
    providerId: allowance.providerConnectionId,
    accountCode: allowance.accountCode,
    maxAccounts: allowance.maxAccounts,
    ...accessDetails(mediaAccessOf(allowance)),
    ...(requests ? { requests } : {}),
  };
}

/** Policy writes as audited: never more than the names of the accounts that failed. */
const policyDetails = (policy: MediaPolicyApplyResult) => ({
  applied: policy.applied,
  failed: policy.failed.map((f) => f.username),
});

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
class MediaFailure extends Error {
  constructor(readonly error: unknown) {
    super(errorMessage(error));
  }
}

/** Runs a change at the instance inside a transaction; a failure becomes a MediaFailure. */
async function inTransaction<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new MediaFailure(err);
  }
}

/** Streaming: Jellyfin accounts of an organization, allowances, instances, import and assignment. */
export async function mediaRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, access, audit, providers } = ctx;

  async function account(req: FastifyRequest, permission?: Permission): Promise<LoadedMediaAccount> {
    const { id } = parse(idParams, req.params);
    const loaded = await loadMediaAccount(ctx, req, id);
    if (permission) await access.assert(req, permission, loaded.scope);
    return loaded;
  }

  /** One account as its organization sees it: requests only where they are visible to it. */
  async function accountDto(req: FastifyRequest, id: string): Promise<MediaAccountDto> {
    const row = await mediaAccountRow(ctx, id);
    if (!row) throw notFound('Streaming account');
    return toMediaAccountDtoFor(ctx, req, row, new SeerrLookup(ctx), 'customer');
  }

  /** Inside a transaction pass `tx`: a second pool connection must never be awaited there. */
  async function connectionById(id: string, from: DbOrTx = db): Promise<ProviderConnection> {
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
    const error = err instanceof MediaFailure ? err.error : err;
    await audit.record(req, {
      action: entry.action,
      orgId: entry.orgId,
      resourceType: 'media_account',
      resourceId: entry.resourceId,
      status: 'failure',
      details: {
        ...entry.details,
        error: errorMessage(error),
        // The error code (e.g. "quick_connect_code") says why without the message's wording.
        ...(error instanceof AppError ? { code: error.code } : {}),
      },
    });
    return error instanceof AppError ? error : new AppError(500, 'action_failed', errorMessage(error));
  }

  /**
   * Stops playback before a disable or delete, best effort: audited as `ended`, never blocks the
   * action. Jellyfin's own revocation ends the sessions too, but a stream in flight may run on.
   * undefined when the adapter cannot stop playback.
   */
  async function stopPlayback(
    adapter: ProviderAdapter,
    externalId: string,
  ): Promise<{ sessions: number; stopped: number } | { error: string } | undefined> {
    if (!adapter.stopMediaUserPlayback) return undefined;
    const stop = await bestEffort(() => adapter.stopMediaUserPlayback!(externalId));
    return stop.ok ? { sessions: stop.value.sessions, stopped: stop.value.stopped } : { error: stop.error };
  }

  /**
   * After a disable: Jellyfin revoked every token if the user was enabled there, so only rows a
   * lockout left behind are still signed in. Best effort: the number signed out, null when that
   * failed, undefined when the adapter cannot sign out devices.
   */
  async function signOutLeftovers(
    adapter: ProviderAdapter,
    externalId: string,
  ): Promise<number | null | undefined> {
    if (!adapter.countMediaUserDevices || !adapter.signOutMediaUserDevices) return undefined;
    const left = await bestEffort(async () =>
      (await adapter.countMediaUserDevices!(externalId)) > 0
        ? adapter.signOutMediaUserDevices!(externalId)
        : null,
    );
    return left.ok ? (left.value?.signedOut ?? 0) : null;
  }

  /**
   * Runs a change at the instance outside a transaction. A failure is audited (the success is
   * audited by the caller, once it knows the outcome) and surfaces as an AppError.
   */
  async function atInstance<T>(req: FastifyRequest, entry: InstanceEntry, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw await failedAtInstance(req, entry, err);
    }
  }

  async function succeeded(req: FastifyRequest, entry: InstanceEntry): Promise<void> {
    await audit.record(req, { ...entry, resourceType: 'media_account' });
  }

  /** Writes an allowance, keeping the creation date of an existing one. A code in use is a 409. */
  async function upsertAllowance(
    tx: Tx,
    values: Omit<MediaAllowance, 'createdAt' | 'updatedAt'>,
  ): Promise<MediaAllowance> {
    try {
      const [row] = await tx
        .insert(mediaAllowances)
        .values(values)
        .onConflictDoUpdate({
          target: mediaAllowances.orgId,
          set: {
            providerConnectionId: values.providerConnectionId,
            accountCode: values.accountCode,
            maxAccounts: values.maxAccounts,
            libraries: values.libraries,
            maxStreams: values.maxStreams,
            downloads: values.downloads,
            remoteBitrateMbit: values.remoteBitrateMbit,
            requestsMovies: values.requestsMovies,
            requestsTv: values.requestsTv,
            movieQuotaLimit: values.movieQuotaLimit,
            movieQuotaDays: values.movieQuotaDays,
            tvQuotaLimit: values.tvQuotaLimit,
            tvQuotaDays: values.tvQuotaDays,
            updatedBy: values.updatedBy,
            updatedAt: new Date(),
          },
        })
        .returning();
      return row!;
    } catch (err) {
      // Another organization took the same code in a parallel request (different org locks).
      if (isUniqueViolation(err)) throw conflict('This account code is in use');
      throw err;
    }
  }

  /** Activates the streaming module inside the transaction. Returns whether it was off. */
  async function enableMedia(tx: Tx, orgId: string): Promise<boolean> {
    const [target] = await tx
      .select({ modules: organizations.modules })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .for('update');
    if (!target || target.modules.includes(MEDIA_MODULE)) return false;
    await tx
      .update(organizations)
      .set({ modules: normalizeModules([...target.modules, MEDIA_MODULE]) })
      .where(eq(organizations.id, orgId));
    return true;
  }

  /** The instance of an allowance can only change while nothing on the old one draws from it. */
  async function assertInstanceChange(
    tx: Tx,
    org: Organization,
    current: MediaAllowance | undefined,
    providerId: string,
  ): Promise<void> {
    if (!current || current.providerConnectionId === providerId) return;
    const before = await mediaCommitments(tx, org, current.providerConnectionId);
    if (before.accounts > 0) {
      throw conflict(
        `This organization still has ${before.accounts} streaming accounts. The instance can only change without accounts.`,
      );
    }
    if (before.customers.length > 0) {
      throw conflict(
        `This reseller handed out streaming accounts on its instance to ${before.customers.length} customers. The instance can only change without them.`,
      );
    }
  }

  /** The policy writes an allowance change causes (none when the access stayed the same). */
  async function applyIfChanged(
    orgId: string,
    previous: MediaAllowance | null,
    stored: MediaAllowance,
    connection: ProviderConnection,
  ): Promise<MediaPolicyApplyResult> {
    const changed =
      !previous ||
      previous.providerConnectionId !== stored.providerConnectionId ||
      !sameMediaAccess(mediaAccessOf(previous), mediaAccessOf(stored));
    if (!changed) return { applied: 0, failed: [] };
    return applyMediaPolicy(ctx, orgId, stored, connection);
  }

  /**
   * The Seerr writes a change of the add-on causes, while Seerr is active on the instance;
   * undefined when nothing was to write (the answer and the audit then leave `seerr` out).
   */
  async function applyRequestsIfChanged(
    orgId: string,
    previous: MediaAllowance | null,
    stored: MediaAllowance,
    connection: ProviderConnection,
  ): Promise<MediaPolicyApplyResult | undefined> {
    // A new instance means no accounts yet (assertInstanceChange): only the add-on matters.
    const changed = !sameMediaRequests(previous ? mediaRequestsOf(previous) : null, mediaRequestsOf(stored));
    if (!changed) return undefined;
    // The allowance is stored: like the policy writes, this never fails the request.
    const active = await seerrState(ctx, connection).then(
      (state) => state.active,
      (err: unknown) => {
        ctx.log.error({ err, orgId }, 'seerr state could not be read');
        return false;
      },
    );
    return active ? applySeerrOrg(ctx, orgId, connection) : undefined;
  }

  /**
   * Whether an allowance's add-on may appear in an audit entry the viewer reads: only where its
   * dialog or streaming page shows it too (an organization without active Seerr there sees
   * nothing of requests). Read after the commit, so a failure only leaves the add-on out.
   */
  async function requestsAudited(
    allowance: MediaAllowance,
    viewer: AllowanceViewer,
    connection?: ProviderConnection,
  ): Promise<boolean> {
    try {
      const at =
        connection?.id === allowance.providerConnectionId
          ? connection
          : await db.query.providerConnections.findFirst({
              where: eq(providerConnections.id, allowance.providerConnectionId),
            });
      return !!at && (await allowanceRequestsShown(ctx, allowance, at, viewer)).requests;
    } catch (err) {
      ctx.log.error({ err, orgId: allowance.orgId }, 'seerr state could not be read');
      return false;
    }
  }

  /** Removes an allowance nothing draws from any more (no accounts, no customer allowances). */
  async function removeAllowance(org: Organization): Promise<MediaAllowance> {
    return db.transaction(async (tx) => {
      await lockMediaOrg(tx, org);
      const current = await tx.query.mediaAllowances.findFirst({ where: eq(mediaAllowances.orgId, org.id) });
      if (!current) throw notFound('Streaming allowance');
      const usage = await mediaCommitments(tx, org, current.providerConnectionId);
      if (usage.accounts > 0) {
        throw conflict(
          `This organization still has ${usage.accounts} streaming accounts. Delete them or move them to another organization first.`,
        );
      }
      if (usage.customers.length > 0) {
        throw conflict(
          `This reseller handed out streaming accounts to ${usage.customers.length} customers. Remove their allowances first.`,
        );
      }
      await tx.delete(mediaAllowances).where(eq(mediaAllowances.orgId, org.id));
      return current;
    });
  }

  /**
   * The organization an account is moved to must have its allowance on the account's instance.
   * Locks the organization, so the allowance cannot change meanwhile. Returns the allowance.
   */
  async function allowanceOn(tx: Tx, org: Organization, providerId: string): Promise<MediaAllowance> {
    await lockMediaOrg(tx, org);
    const allowance = await tx.query.mediaAllowances.findFirst({ where: eq(mediaAllowances.orgId, org.id) });
    if (!allowance) throw noAllowance(`${org.name} has no streaming allowance`);
    if (allowance.providerConnectionId !== providerId) {
      throw conflict(`The streaming allowance of ${org.name} is on another instance`);
    }
    return allowance;
  }

  // --- Customer view ------------------------------------------------------------------

  app.get('/orgs/:orgId/media', async (req): Promise<OrgMediaDto> => {
    const { orgId } = parse(orgParams, req.params);
    const org = await loadOrg(ctx, req, orgId);
    await access.assert(req, 'media:read', orgScope(orgId));
    const rows = await mediaAccountRowsQuery(ctx)
      .where(eq(mediaAccounts.orgId, orgId))
      .orderBy(mediaAccounts.username);
    const loaded = await loadMediaAllowance(db, orgId);
    const lookup = new SeerrLookup(ctx);
    // Without the add-on on an instance with active Seerr, nothing of requests is in the answer.
    const requests = loaded ? await mediaRequestsInfo(ctx, loaded.allowance, loaded.connection) : undefined;
    return {
      allowance: loaded
        ? await toMediaAllowanceDtoFor(ctx, org, loaded.allowance, loaded.connection, 'customer')
        : null,
      accounts: await Promise.all(rows.map((row) => toMediaAccountDtoFor(ctx, req, row, lookup, 'customer'))),
      login: loaded ? await mediaLoginDto(ctx, loaded.allowance, loaded.connection) : null,
      ...(requests ? { requests } : {}),
    };
  });

  app.post('/orgs/:orgId/media/accounts', async (req, reply): Promise<MediaAccountSecretDto> => {
    const { orgId } = parse(orgParams, req.params);
    const auth = requireAuth(req);
    const org = await loadOrg(ctx, req, orgId);
    await access.assert(req, 'media:write', orgScope(orgId));
    const body = parse(createBody, req.body);
    // A generated password is shown once to a person. Scripts send the one they set.
    if (auth.token && body.password === undefined) {
      throw badRequest('API tokens cannot receive passwords. Send a password for the new account.');
    }
    const chosen = body.password !== undefined;
    const newPassword = body.password ?? generateMediaPassword();
    const details: Record<string, unknown> = {
      username: null,
      providerId: null,
      password: chosen ? 'chosen' : 'generated',
    };
    const entry = { action: 'media.account_create', orgId, resourceId: null, details };
    // Set once the user exists at the instance, to remove it again if storing it fails.
    let created = null as { adapter: ProviderAdapter; externalId: string } | null;
    let id: string;
    try {
      id = await db.transaction(async (tx) => {
        // Held until the account is stored, so parallel requests see each other's accounts.
        // Everything in here goes through tx: no second pool connection while the lock is held.
        await lockMediaOrg(tx, org);
        const allowance = await tx.query.mediaAllowances.findFirst({
          where: eq(mediaAllowances.orgId, orgId),
        });
        if (!allowance) throw noAllowance();
        const connection = await connectionById(allowance.providerConnectionId, tx);
        const adapter = providers.forConnection(connection);
        requireMediaSupport(adapter);
        const username = mediaUsername(body.name, allowance.accountCode);
        details.username = username;
        details.providerId = connection.id;

        const usage = await mediaCommitments(tx, org, connection.id);
        if (committedMediaAccounts(usage) + 1 > allowance.maxAccounts) {
          throw accountLimit(`The allowance covers at most ${allowance.maxAccounts} accounts`, {
            maxAccounts: allowance.maxAccounts,
            accounts: committedMediaAccounts(usage),
          });
        }
        const [existing] = await tx
          .select({ id: mediaAccounts.id })
          .from(mediaAccounts)
          .where(
            and(
              eq(mediaAccounts.providerConnectionId, connection.id),
              sql`lower(${mediaAccounts.username}) = ${username.toLowerCase()}`,
            ),
          )
          .limit(1);
        if (existing) throw conflict(`The account ${username} exists already`);

        const expected = expectedMediaPolicy(mediaAccessOf(allowance));
        const remote = await inTransaction(() =>
          adapter.createMediaUser!({ username, password: newPassword, policy: expected }),
        );
        created = { adapter, externalId: remote.externalId };
        const now = new Date();
        const issues = mediaAccountIssues(remote, expected, true);
        const [row] = await tx
          .insert(mediaAccounts)
          .values({
            providerConnectionId: connection.id,
            externalId: remote.externalId,
            orgId,
            ...remoteMediaFields(remote, issues, now),
            issues,
            // Now, not when the transaction began (before the instance had the user): the sync
            // takes accounts created before it read the user list as missing.
            createdAt: now,
          })
          .returning({ id: mediaAccounts.id });
        return row!.id;
      });
    } catch (err) {
      // After the rollback, so audit and cleanup do not wait for a connection while holding one.
      if (err instanceof MediaFailure) throw await failedAtInstance(req, entry, err);
      if (created) {
        // At the instance, but not stored: remove it, or it lives on outside every allowance.
        const { adapter, externalId } = created;
        const removed = await adapter.deleteMediaUser!(externalId).then(
          () => true,
          () => false,
        );
        await audit.record(req, {
          ...entry,
          resourceType: 'media_account',
          status: 'failure',
          details: { ...details, error: errorMessage(err), removedAtInstance: removed },
        });
      }
      throw err;
    }
    // Requests (Seerr), best effort: a failure leaves an issue for the sync, never fails the account.
    Object.assign(details, await seerrAccountStep(ctx, id));
    // Who created the account is recorded, the password itself never is.
    await succeeded(req, { ...entry, resourceId: id });
    noStore(reply);
    return { account: await accountDto(req, id), password: chosen ? null : newPassword };
  });

  // --- Customer: one account ------------------------------------------------------------

  /** Live state of one account, best effort: a route that changed the row meanwhile wins. */
  app.get('/media/accounts/:id', async (req): Promise<MediaAccountDto> => {
    const loaded = await account(req);
    const { adapter, account: current } = loaded;
    if (supportsMedia(adapter)) {
      const started = await runStart();
      try {
        const remote = await within(adapter.getMediaUser!(current.externalId), LIVE_TIMEOUT_MS);
        const expected = await expectedPolicyFor(db, current.orgId, current.providerConnectionId);
        await db
          .update(mediaAccounts)
          .set(remoteMediaFields(remote, mediaAccountIssues(remote, expected, !!current.orgId), new Date()))
          .where(and(eq(mediaAccounts.id, current.id), lt(mediaAccounts.updatedAt, started)));
      } catch (err) {
        if (err instanceof AppError && err.statusCode === 404) {
          // Gone at the instance (deleted in Jellyfin): shown as missing, like the sync does.
          await db
            .update(mediaAccounts)
            .set({ missingSince: sql`coalesce(${mediaAccounts.missingSince}, now())` })
            .where(and(eq(mediaAccounts.id, current.id), lt(mediaAccounts.createdAt, started)));
        } else {
          req.log.warn({ err, mediaAccountId: current.id }, 'live streaming account refresh failed');
        }
      }
    }
    return accountDto(req, current.id);
  });

  app.patch('/media/accounts/:id', async (req): Promise<MediaAccountDto> => {
    const loaded = await account(req, 'media:write');
    const { adapter, account: current } = loaded;
    requireMediaSupport(adapter);
    const body = parse(patchBody, req.body);
    if (body.enabled === current.enabled) return accountDto(req, current.id);
    const details: Record<string, unknown> = {
      username: current.username,
      before: { enabled: current.enabled },
      after: { enabled: body.enabled },
    };
    const entry = { action: 'media.account_update', orgId: current.orgId, resourceId: current.id, details };
    if (!body.enabled) {
      const ended = await stopPlayback(adapter, current.externalId);
      if (ended) details.ended = ended;
    }
    // Disabling signs out every device of the user; enabling also lifts a lock after failed sign-ins.
    const remote = await atInstance(req, entry, () =>
      adapter.setMediaUserEnabled!(current.externalId, body.enabled),
    );
    if (!body.enabled) {
      const signedOut = await signOutLeftovers(adapter, current.externalId);
      if (signedOut !== undefined) details.signedOut = signedOut;
    }
    const expected = await expectedPolicyFor(db, current.orgId, current.providerConnectionId);
    await db
      .update(mediaAccounts)
      .set(remoteMediaFields(remote, mediaAccountIssues(remote, expected, !!current.orgId), new Date()))
      .where(eq(mediaAccounts.id, current.id));
    // Disabled: no request rights in Seerr; enabled: restored.
    Object.assign(details, await seerrAccountStep(ctx, current.id));
    await succeeded(req, entry);
    return accountDto(req, current.id);
  });

  app.post('/media/accounts/:id/password', async (req, reply): Promise<MediaPasswordResultDto> => {
    const loaded = await account(req);
    requireSession(req);
    await access.assert(req, 'media:password', loaded.scope);
    const { adapter, account: current } = loaded;
    requireMediaSupport(adapter);
    const body = parse(passwordBody, req.body ?? {});
    const chosen = body.password !== undefined;
    const newPassword = body.password ?? generateMediaPassword();
    const entry = {
      action: 'media.password_reset',
      orgId: current.orgId,
      resourceId: current.id,
      details: { username: current.username, password: chosen ? 'chosen' : 'generated' },
    };
    // Jellyfin signs out every device of the user.
    await atInstance(req, entry, () => adapter.setMediaUserPassword!(current.externalId, newPassword));
    const [fresh] = await db
      .select({ issues: mediaAccounts.issues })
      .from(mediaAccounts)
      .where(eq(mediaAccounts.id, current.id));
    await db
      .update(mediaAccounts)
      .set({
        hasPassword: true,
        issues: (fresh?.issues ?? current.issues).filter((issue) => issue !== 'no_password'),
      })
      .where(eq(mediaAccounts.id, current.id));
    // Who set a new password is recorded, the password itself never is.
    await succeeded(req, entry);
    // Jellyfin signed out every device: the fresh count tells the dialog whether one is left.
    const devices = adapter.countMediaUserDevices
      ? await bestEffort(() => adapter.countMediaUserDevices!(current.externalId))
      : null;
    noStore(reply);
    return { password: chosen ? null : newPassword, devices: devices?.ok ? devices.value : null };
  });

  // --- Customer: devices and Quick Connect ----------------------------------------------

  /**
   * Quick Connect attempts per account and minute, wrong codes included: guessing the codes other
   * devices show stays slow. Counted in the handler, once the caller may connect the account, so
   * nobody else uses up its attempts. A route config would count before any access check and
   * replace the global limit per address, which this route keeps.
   */
  const connectAttempts = app.createRateLimit({
    max: MEDIA_QUICK_CONNECT_ATTEMPTS_PER_MINUTE,
    timeWindow: '1 minute',
    // Called only after account() loaded the account by this id, a UUID Postgres matches in any
    // case: in lower case it is the stored id, one key for every spelling.
    keyGenerator: (req) => `media-connect:${parse(idParams, req.params).id.toLowerCase()}`,
  });

  async function countConnectAttempt(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const limit = await connectAttempts(req);
    if (limit.isAllowed || !limit.isExceeded) return;
    reply.header('retry-after', limit.ttlInSeconds);
    throw new AppError(
      429,
      'rate_limited',
      `Too many attempts for this account, retry in ${limit.ttlInSeconds} seconds`,
    );
  }

  /**
   * "Fernseher verbinden": confirms the Quick Connect code a TV shows, for this account. It
   * grants a sign-in like a password does, so it needs media:password in an interactive session.
   * The code is a one-time secret: body only, never logged, stored, audited or answered.
   */
  app.post('/media/accounts/:id/connect', async (req, reply): Promise<MediaConnectResultDto> => {
    const loaded = await account(req);
    requireSession(req);
    await access.assert(req, 'media:password', loaded.scope);
    const { adapter, account: current } = loaded;
    requireMediaSupport(adapter);
    requireMediaDevices(adapter);
    await countConnectAttempt(req, reply);
    const code = normalizeQuickConnectCode(parse(connectBody, req.body ?? {}).code);
    if (!code) throw badRequest('Validation failed', [{ path: 'code', message: 'a code has 6 digits' }]);
    // Jellyfin itself would confirm the code for a disabled user; nothing is sent then.
    if (current.missingSince || !current.enabled) throw mediaAccountDisabled();
    const entry = {
      action: 'media.device_connect',
      orgId: current.orgId,
      resourceId: current.id,
      details: { username: current.username },
    };
    await atInstance(req, { ...entry, details: { ...entry.details } }, () =>
      adapter.authorizeMediaQuickConnect!(current.externalId, code),
    );
    await succeeded(req, entry);
    noStore(reply);
    return { connected: true };
  });

  /** The number of signed-in devices only (the sign-out dialog): never names, apps or times. */
  app.get('/media/accounts/:id/devices', async (req): Promise<MediaDevicesDto> => {
    const { adapter, account: current } = await account(req, 'media:write');
    requireMediaSupport(adapter);
    requireMediaDevices(adapter);
    if (current.missingSince) return { count: 0 };
    return { count: await adapter.countMediaUserDevices!(current.externalId) };
  });

  /**
   * "Alle Geräte abmelden": stops playback, then signs out every device of the account that no
   * other account is signed in on (Jellyfin would sign out both). Password and history stay.
   */
  app.post('/media/accounts/:id/signout', async (req): Promise<MediaSignOutResultDto> => {
    const { adapter, account: current } = await account(req, 'media:write');
    requireMediaSupport(adapter);
    requireMediaDevices(adapter);
    if (current.missingSince) throw conflict('This account no longer exists at Jellyfin');
    const stop = await bestEffort(() => adapter.stopMediaUserPlayback!(current.externalId));
    const stopped = stop.ok ? stop.value.stopped : 0;
    const details: Record<string, unknown> = {
      username: current.username,
      stopped,
      ...(stop.ok ? {} : { stopError: stop.error }),
    };
    const entry = { action: 'media.device_signout', orgId: current.orgId, resourceId: current.id, details };
    const result = await atInstance(req, entry, () => adapter.signOutMediaUserDevices!(current.externalId));
    await succeeded(req, {
      ...entry,
      details: {
        username: current.username,
        stopped,
        signedOut: result.signedOut,
        skipped: result.skipped,
        failed: result.failed,
        ...(stop.ok ? {} : { stopError: stop.error }),
      },
    });
    return {
      stopped,
      signedOut: result.signedOut,
      skipped: result.skipped,
      failed: result.failed,
      remaining: result.remaining,
    };
  });

  app.delete('/media/accounts/:id', async (req) => {
    const loaded = await account(req, 'media:write');
    const { adapter, account: current } = loaded;
    requireMediaSupport(adapter);
    const { confirm } = parse(confirmBody, req.body ?? {});
    if (confirm !== current.username.toLowerCase()) {
      throw badRequest('Validation failed', [
        { path: 'confirm', message: `Type the login name ${current.username} to confirm` },
      ]);
    }
    const details: Record<string, unknown> = { username: current.username };
    const entry = { action: 'media.account_delete', orgId: current.orgId, resourceId: current.id, details };
    if (!current.missingSince) {
      // DELETE /Users/{id} revokes every token itself; a stream in flight is stopped first.
      const ended = await stopPlayback(adapter, current.externalId);
      if (ended) details.ended = ended;
    }
    await atInstance(req, entry, async () => {
      try {
        // Jellyfin removes the devices (signed out), playlists and watch history with the user.
        await adapter.deleteMediaUser!(current.externalId);
      } catch (err) {
        // Gone at the instance already (deleted there): only the row is left to remove.
        if (!(err instanceof AppError && err.statusCode === 404 && current.missingSince)) throw err;
      }
    });
    // Read before the row goes: whether the organization sees requests (and so the outcome).
    const seerrVisible = await seerrVisibleForAccount(ctx, current.id);
    await db.delete(mediaAccounts).where(eq(mediaAccounts.id, current.id));
    // The Seerr user goes with its requests; a failure leaves it to the sync, which takes the
    // request rights of users without a managed account.
    const seerr = await bestEffort(() => deleteSeerrAccount(ctx, current), SEERR_STEP_MS);
    const seerrOutcome: SeerrOutcome = seerr.ok ? seerr.value : { error: seerr.error };
    if (seerrVisible) details.seerr = seerrOutcome;
    else if (typeof seerrOutcome === 'object') {
      // Not in the organization's audit log, which shows nothing of requests here.
      req.log.warn({ mediaAccountId: current.id, error: seerrOutcome.error }, 'seerr user not deleted');
    }
    await succeeded(req, entry);
    return { ok: true };
  });

  // --- Admin: allowances ----------------------------------------------------------------

  app.get('/admin/orgs/:orgId/media-allowance', async (req): Promise<MediaAllowanceDto | null> => {
    await access.assert(req, 'platform:org:read', platformScope);
    const { orgId } = parse(orgParams, req.params);
    return mediaAllowanceDtoFor(ctx, await orgById(orgId), 'admin');
  });

  app.put('/admin/orgs/:orgId/media-allowance', async (req): Promise<MediaAllowanceChangeResult> => {
    const auth = requireAuth(req);
    await access.assert(req, 'platform:media:write', platformScope);
    const { orgId } = parse(orgParams, req.params);
    const body = parse(adminAllowanceBody, req.body);
    const org = await orgById(orgId);
    const connection = await connectionById(body.providerId);
    const adapter = providers.forConnection(connection);
    requireMediaSupport(adapter);

    // Read now: libraries added in Jellyfin a minute ago must be grantable.
    const available = await adapter.listMediaLibraries!(true);
    const libraryIds = uniqueIds(body.libraryIds);
    const libraries: MediaLibraryRef[] = libraryIds.map((id) => {
      const found = available.find((l) => l.id === id);
      if (!found) throw badRequest(`Unknown library ${id} on ${connection.name}`);
      return { id: found.id, name: found.name, type: found.type };
    });
    if (body.enableModule && org.parentOrgId && !org.modules.includes(MEDIA_MODULE)) {
      const parent = await orgById(org.parentOrgId);
      if (!parent.modules.includes(MEDIA_MODULE)) {
        throw conflict(
          `The reseller "${parent.name}" does not have the module "${MEDIA_MODULE}". Activate it for the reseller first.`,
        );
      }
    }
    // Read before the transaction: names of users created in Jellyfin directly that a new code must not match.
    const taken = await remoteCodeSuffixes(adapter);
    const next: MediaAccess = {
      libraryIds,
      maxStreams: body.maxStreams,
      downloads: body.downloads,
      remoteBitrateMbit: body.remoteBitrateMbit,
    };
    const requested = body.requests === undefined ? undefined : normalizeMediaRequests(body.requests);
    const seerrConfigured = adapter.seerrConfigured?.() ?? false;

    const { previous, stored, moduleEnabled } = await db.transaction(async (tx) => {
      await lockMediaOrg(tx, org);
      const current = await tx.query.mediaAllowances.findFirst({ where: eq(mediaAllowances.orgId, orgId) });
      await assertInstanceChange(tx, org, current, connection.id);
      // Absent keeps the add-on; it never moves along to an instance without Seerr.
      const nextRequests = requested !== undefined ? requested : current ? mediaRequestsOf(current) : null;
      if (nextRequests && !seerrConfigured) throw requestsUnavailable();

      const usage = await mediaCommitments(tx, org, connection.id);
      if (body.maxAccounts < usage.accounts) {
        throw accountLimit(
          `This organization has ${usage.accounts} streaming accounts. The maximum cannot be lower than that.`,
          { maxAccounts: body.maxAccounts, accounts: committedMediaAccounts(usage) },
        );
      }
      // A reseller cannot narrow its allowance below what its customers got (they are listed).
      const accountsShort = body.maxAccounts < committedMediaAccounts(usage);
      const outside: MediaAllowanceConflictDetails['customers'] = usage.customers
        .map((customer) => ({
          id: customer.orgId,
          name: customer.name,
          conflicts: [
            ...mediaAccessExceeds(customer.access, next),
            ...mediaRequestsExceed(customer.requests, nextRequests),
            ...(accountsShort ? (['accounts'] as const) : []),
          ] as (MediaAccessConflict | MediaRequestsConflict | 'accounts')[],
        }))
        .filter((customer) => customer.conflicts.length > 0);
      if (outside.length > 0) {
        throw allowanceConflict(
          `The allowances of ${outside.length} customers would no longer fit into this one: ${outside.map((c) => c.name).join(', ')}. Change their allowances first.`,
          { customers: outside },
        );
      }

      const accountCode =
        body.accountCode ?? current?.accountCode ?? (await generateMediaAccountCode(tx, taken));
      if (accountCode !== current?.accountCode) {
        if (current && usage.accounts > 0) {
          throw conflict('The account code can only change while the organization has no streaming accounts');
        }
        if (taken.has(accountCode) || !(await mediaAccountCodeFree(tx, accountCode, orgId))) {
          throw conflict('This account code is in use');
        }
      }
      const stored = await upsertAllowance(tx, {
        orgId,
        providerConnectionId: connection.id,
        accountCode,
        maxAccounts: body.maxAccounts,
        libraries,
        maxStreams: next.maxStreams,
        downloads: next.downloads,
        remoteBitrateMbit: next.remoteBitrateMbit,
        ...mediaRequestsColumns(nextRequests),
        updatedBy: auth.user.id,
      });
      return {
        previous: current ?? null,
        stored,
        moduleEnabled: body.enableModule ? await enableMedia(tx, orgId) : false,
      };
    });

    // After the commit: the writes go to Jellyfin and Seerr, which must not hold the org lock.
    const policy = await applyIfChanged(orgId, previous, stored, connection);
    const seerr = await applyRequestsIfChanged(orgId, previous, stored, connection);
    // The organization reads this entry: the add-on only where its streaming page shows it too.
    const shown = await requestsAudited(stored, 'customer', connection);
    const shownBefore = previous ? await requestsAudited(previous, 'customer', connection) : false;
    await audit.record(req, {
      action: 'media.allowance_set',
      orgId,
      resourceType: 'media_allowance',
      resourceId: orgId,
      details: {
        ...allowanceDetails(stored, shown),
        previous: previous ? allowanceDetails(previous, shownBefore) : null,
        moduleEnabled: moduleEnabled ? MEDIA_MODULE : null,
        policy: policyDetails(policy),
        ...(seerr && (shown || shownBefore) ? { seerr: seerrApplyDetails(seerr) } : {}),
      },
    });
    return {
      allowance: (await mediaAllowanceDtoFor(ctx, org, 'admin'))!,
      policy,
      ...(seerr ? { seerr } : {}),
    };
  });

  app.delete('/admin/orgs/:orgId/media-allowance', async (req) => {
    await access.assert(req, 'platform:media:write', platformScope);
    const { orgId } = parse(orgParams, req.params);
    const removed = await removeAllowance(await orgById(orgId));
    await audit.record(req, {
      action: 'media.allowance_delete',
      orgId,
      resourceType: 'media_allowance',
      resourceId: orgId,
      details: allowanceDetails(removed, await requestsAudited(removed, 'customer')),
    });
    return { ok: true };
  });

  // --- Admin: instances and accounts ------------------------------------------------------

  /** Every connection that can do streaming, with stored counts and live facts (numbers only). */
  app.get('/admin/media/instances', async (req): Promise<MediaInstanceDto[]> => {
    await access.assert(req, 'platform:provider:read', platformScope);
    const connections = (await db.select().from(providerConnections).orderBy(asc(providerConnections.name)))
      .map((connection) => ({ connection, adapter: providers.forConnection(connection) }))
      .filter(({ adapter }) => supportsMedia(adapter));
    if (connections.length === 0) return [];
    const ids = connections.map(({ connection }) => connection.id);
    const allowanceCounts = await db
      .select({ providerId: mediaAllowances.providerConnectionId, n: count() })
      .from(mediaAllowances)
      .where(inArray(mediaAllowances.providerConnectionId, ids))
      .groupBy(mediaAllowances.providerConnectionId);
    const accountCounts = await db
      .select({
        providerId: mediaAccounts.providerConnectionId,
        n: count(),
        withIssues: sql<number>`count(*) filter (where ${mediaAccounts.issues} <> '[]'::jsonb)`.mapWith(
          Number,
        ),
      })
      .from(mediaAccounts)
      .where(inArray(mediaAccounts.providerConnectionId, ids))
      .groupBy(mediaAccounts.providerConnectionId);
    const seerrRows = await db.select().from(mediaSeerr).where(inArray(mediaSeerr.providerConnectionId, ids));
    const requestCounts = await db
      .select({ providerId: mediaAllowances.providerConnectionId, n: count() })
      .from(mediaAllowances)
      .where(
        and(
          inArray(mediaAllowances.providerConnectionId, ids),
          sql`(${mediaAllowances.requestsMovies} or ${mediaAllowances.requestsTv})`,
        ),
      )
      .groupBy(mediaAllowances.providerConnectionId);

    return Promise.all(
      connections.map(async ({ connection, adapter }): Promise<MediaInstanceDto> => {
        const accounts = accountCounts.find((c) => c.providerId === connection.id);
        let live: MediaInstanceDto['live'] = null;
        let error: string | null = null;
        const read = async () => {
          const [info, users, libraries, activity] = await Promise.all([
            adapter.mediaServerInfo
              ? adapter.mediaServerInfo()
              : Promise.resolve({ serverName: null, version: null, quickConnect: null }),
            adapter.listMediaUsers!(),
            adapter.listMediaLibraries!(),
            adapter.mediaActivity
              ? adapter.mediaActivity()
              : Promise.resolve({ activeSessions: 0, playing: 0 }),
          ]);
          return {
            serverName: info.serverName,
            version: info.version,
            users: users.length,
            libraries: libraries.length,
            activeSessions: activity.activeSessions,
            playing: activity.playing,
            quickConnect: info.quickConnect,
          };
        };
        let failure: unknown = null;
        const result = await settleWithin(
          read().catch((err: unknown) => {
            failure = err;
            throw err;
          }),
          INSTANCE_LIVE_TIMEOUT_MS,
        );
        if (result) live = result;
        else error = failure ? errorMessage(failure).slice(0, 300) : 'The instance did not answer in time';
        return {
          provider: {
            id: connection.id,
            type: connection.type,
            name: connection.name,
            url: adapter.mediaLoginUrl?.() ?? null,
            enabled: connection.enabled,
            status: connection.status,
          },
          location: connection.location,
          organizations: allowanceCounts.find((c) => c.providerId === connection.id)?.n ?? 0,
          accounts: accounts?.n ?? 0,
          accountsWithIssues: accounts?.withIssues ?? 0,
          live,
          error,
          // Stored state only: the live Seerr check runs in the admin dialog.
          seerr: adapter.seerrConfigured?.()
            ? {
                url: adapter.seerrUrl?.() ?? '',
                enabled: seerrRows.find((r) => r.providerConnectionId === connection.id)?.enabled ?? false,
                status: seerrRows.find((r) => r.providerConnectionId === connection.id)?.status ?? 'unknown',
                organizationsWithRequests: requestCounts.find((c) => c.providerId === connection.id)?.n ?? 0,
              }
            : null,
        };
      }),
    );
  });

  app.get('/admin/media/accounts', async (req): Promise<MediaAccountDto[]> => {
    await access.assert(req, 'platform:provider:read', platformScope);
    const query = parse(adminListQuery, req.query);
    const filters: (SQL | undefined)[] = [
      query.orgId ? eq(mediaAccounts.orgId, query.orgId) : undefined,
      query.providerId ? eq(mediaAccounts.providerConnectionId, query.providerId) : undefined,
      query.q ? ilike(mediaAccounts.username, like(query.q)) : undefined,
      query.issues === 'true'
        ? sql`${mediaAccounts.issues} <> '[]'::jsonb`
        : query.issues === 'false'
          ? sql`${mediaAccounts.issues} = '[]'::jsonb`
          : undefined,
    ];
    const rows = await mediaAccountRowsQuery(ctx)
      .where(and(...filters))
      .orderBy(mediaAccounts.username)
      .limit(1000);
    const lookup = new SeerrLookup(ctx);
    return Promise.all(rows.map((row) => toMediaAccountDtoFor(ctx, req, row, lookup, 'admin')));
  });

  app.get('/admin/providers/:id/media/libraries', async (req): Promise<MediaLibraryRef[]> => {
    await access.assert(req, 'platform:provider:read', platformScope);
    const connection = await connectionById(parse(idParams, req.params).id);
    const adapter = providers.forConnection(connection);
    requireMediaSupport(adapter);
    return adapter.listMediaLibraries!(true);
  });

  /** Users of the instance the console does not manage (created in Jellyfin directly). */
  app.get('/admin/providers/:id/media/unmanaged', async (req): Promise<UnmanagedMediaUserDto[]> => {
    await access.assert(req, 'platform:provider:read', platformScope);
    const connection = await connectionById(parse(idParams, req.params).id);
    const adapter = providers.forConnection(connection);
    requireMediaSupport(adapter);
    const remote = await adapter.listMediaUsers!();
    const known = new Set(
      (
        await db
          .select({ externalId: mediaAccounts.externalId })
          .from(mediaAccounts)
          .where(eq(mediaAccounts.providerConnectionId, connection.id))
      ).map((r) => r.externalId),
    );
    return remote
      .filter((r) => !known.has(r.externalId))
      .sort((a, b) => a.username.localeCompare(b.username))
      .map((r) => ({
        userId: r.externalId,
        username: r.username,
        enabled: r.enabled,
        administrator: r.administrator,
        hasPassword: r.hasPassword,
        lastActiveOn: mediaActivityDay(r.lastActivityAt),
        blocked: r.administrator ? 'administrator' : r.blockedFolders ? 'blocked_folders' : null,
      }));
  });

  // --- Admin: requests (Seerr) of an instance ------------------------------------------

  /** A streaming connection with its Seerr, 422 for providers without streaming. */
  async function seerrConnection(req: FastifyRequest) {
    const connection = await connectionById(parse(idParams, req.params).id);
    const adapter = providers.forConnection(connection);
    requireMediaSupport(adapter);
    return { connection, adapter };
  }

  /** The add-on of the instance with a live check (stored state with lastError after 10 s); null: no Seerr. */
  app.get('/admin/providers/:id/media/seerr', async (req): Promise<MediaSeerrDto | null> => {
    await access.assert(req, 'platform:provider:read', platformScope);
    const { connection } = await seerrConnection(req);
    const state = await seerrState(ctx, connection);
    if (!state.configured) return null;
    const live = await settleWithin(checkSeerr(ctx, connection), SEERR_CHECK_TIMEOUT_MS);
    if (live) return live;
    return { ...(await storedSeerrDto(ctx, connection)), lastError: 'Seerr did not answer in time' };
  });

  /**
   * Switches requests on or off for the instance. On: only with a check without problems, and for
   * an instance with several organizations only with confirmShared (their accounts see each
   * other in Seerr); then every account entitled by an add-on is set up. Off: every account's
   * request rights are taken back; Seerr users and requests stay in Seerr.
   */
  app.put('/admin/providers/:id/media/seerr', async (req): Promise<MediaSeerrChangeResult> => {
    const auth = requireAuth(req);
    await access.assert(req, 'platform:media:write', platformScope);
    requireSession(req);
    const { connection, adapter } = await seerrConnection(req);
    const body = parse(seerrBody, req.body);
    const state = await seerrState(ctx, connection);
    // Off needs no Seerr: requests left on after their address went away can always be switched
    // off (issues and numbers go, nobody is left to write to).
    if (!state.configured && (body.enabled || !state.enabled)) throw seerrNotConfigured();
    const unchanged = async (): Promise<MediaSeerrChangeResult> => ({
      seerr: await storedSeerrDto(ctx, connection),
      applied: { applied: 0, failed: [] },
    });
    if (body.enabled === state.enabled) {
      // Off again: what an earlier switch-off could not take back (Seerr did not answer) is
      // retried now, as the sync would.
      if (body.enabled || (await pendingSeerrRevocations(db, connection.id)) === 0) return unchanged();
      const applied = await revokeSeerrConnection(ctx, connection);
      const seerr = await storedSeerrDto(ctx, connection);
      await audit.record(req, {
        action: 'media.seerr_disable',
        resourceType: 'provider',
        resourceId: connection.id,
        details: {
          organizations: seerr.organizations,
          shared: seerr.organizations > 1,
          retry: true,
          ...seerrApplyDetails(applied),
        },
      });
      return { seerr, applied };
    }

    let organizations = 0;
    if (body.enabled) {
      const checked = await checkSeerr(ctx, connection);
      if (!checked.check) {
        throw new AppError(
          502,
          'provider_error',
          `Seerr could not be checked: ${checked.lastError ?? 'no answer'}`,
        );
      }
      if (checked.check.problems.length > 0) throw seerrUnsafe(checked.check.problems);
      organizations = checked.organizations;
      if (organizations > 1 && !body.confirmShared) throw seerrShared(organizations);
    }
    const changed = await db.transaction(async (tx) => {
      // The same lock as a provider edit: the address cannot change while requests go on.
      const [fresh] = await tx
        .select()
        .from(providerConnections)
        .where(eq(providerConnections.id, connection.id))
        .for('update');
      if (!fresh) throw notFound('Provider');
      if (body.enabled) {
        const freshAdapter = providers.forConnection(fresh);
        if (
          !freshAdapter.seerrConfigured?.() ||
          (freshAdapter.seerrUrl?.() ?? null) !== (adapter.seerrUrl?.() ?? null)
        ) {
          throw conflict('The Seerr address of this instance changed meanwhile. Check it again.');
        }
      }
      const [current] = await tx
        .select({ enabled: mediaSeerr.enabled })
        .from(mediaSeerr)
        .where(eq(mediaSeerr.providerConnectionId, connection.id));
      if ((current?.enabled ?? false) === body.enabled) return false;
      await tx
        .insert(mediaSeerr)
        .values({ providerConnectionId: connection.id, enabled: body.enabled, updatedBy: auth.user.id })
        .onConflictDoUpdate({
          target: mediaSeerr.providerConnectionId,
          set: { enabled: body.enabled, updatedBy: auth.user.id, updatedAt: new Date() },
        });
      return true;
    });
    if (!changed) return unchanged();

    // After the commit: the writes go to Seerr.
    const applied: MediaPolicyApplyResult = { applied: 0, failed: [] };
    if (body.enabled) {
      for (const orgId of await organizationsWithRequests(db, connection.id)) {
        const result = await applySeerrOrg(ctx, orgId, connection);
        applied.applied += result.applied;
        applied.failed.push(...result.failed);
      }
      applied.failed.sort((a, b) => a.username.localeCompare(b.username));
    } else {
      Object.assign(applied, await revokeSeerrConnection(ctx, connection));
    }
    const seerr = await storedSeerrDto(ctx, connection);
    if (!body.enabled) organizations = seerr.organizations;
    await audit.record(req, {
      action: body.enabled ? 'media.seerr_enable' : 'media.seerr_disable',
      resourceType: 'provider',
      resourceId: connection.id,
      details: { organizations, shared: organizations > 1, ...seerrApplyDetails(applied) },
    });
    return { seerr, applied };
  });

  /** "Empfohlene Einstellungen anwenden": the three safe settings, only on a Seerr of this server. */
  app.post('/admin/providers/:id/media/seerr/settings', async (req): Promise<MediaSeerrDto> => {
    await access.assert(req, 'platform:media:write', platformScope);
    requireSession(req);
    const { connection, adapter } = await seerrConnection(req);
    if (!(await seerrState(ctx, connection)).configured) throw seerrNotConfigured();
    const before = await adapter.seerrCheck!();
    // Never written to a Seerr of another server, and not past CSRF protection or a rejected key.
    const blocking = before.problems.filter((p) => !MEDIA_SEERR_FIXABLE.includes(p));
    if (blocking.length > 0) throw seerrUnsafe(blocking);
    const entry = { action: 'media.seerr_settings', resourceType: 'provider', resourceId: connection.id };
    let after: SeerrCheckResult;
    try {
      after = await adapter.seerrApplySafeSettings!();
    } catch (err) {
      await audit.record(req, {
        ...entry,
        status: 'failure',
        details: { before: seerrSettingsOf(before), error: errorMessage(err) },
      });
      throw err;
    }
    await audit.record(req, {
      ...entry,
      details: { before: seerrSettingsOf(before), after: seerrSettingsOf(after) },
    });
    return checkSeerr(ctx, connection, after);
  });

  /**
   * Takes over a user created in Jellyfin directly. With an organization its allowance's policy
   * is written; with setPassword a new password is set (and shown once). Name and watch history
   * stay. Accounts beyond the allowance's maximum are allowed for staff.
   */
  app.post('/admin/media/accounts/import', async (req, reply): Promise<MediaAccountSecretDto> => {
    await access.assert(req, 'platform:media:write', platformScope);
    const body = parse(importBody, req.body);
    if (body.setPassword) requireSession(req);
    const userId = normalizeMediaId(body.userId);
    if (!userId) throw badRequest('Invalid Jellyfin user id');
    const connection = await connectionById(body.providerId);
    const adapter = providers.forConnection(connection);
    requireMediaSupport(adapter);
    const remote = await adapter.getMediaUser!(userId);
    // Whoever manages an account can set its password: never hand out an instance administrator.
    if (remote.administrator) throw conflict(JELLYFIN_ADMIN_REFUSED);
    if (remote.blockedFolders) {
      throw conflict(
        'This user has legacy blocked libraries, which the console cannot change: library limits would not apply. Remove it in Jellyfin and create the account anew.',
      );
    }
    if (!remote.hasPassword && !body.setPassword) {
      throw new AppError(
        409,
        'no_password',
        'This user has no password: anyone who knows the name signs in. Import it with a new password.',
      );
    }
    const org = body.orgId ? await orgById(body.orgId) : null;
    const newPassword = body.setPassword ? generateMediaPassword() : null;
    const entry = {
      action: 'media.account_import',
      orgId: org?.id ?? null,
      resourceId: null,
      details: {
        username: remote.username,
        userId,
        providerId: connection.id,
        orgId: org?.id ?? null,
        passwordSet: body.setPassword,
      },
    };

    let id: string;
    try {
      id = await db.transaction(async (tx) => {
        const allowance = org ? await allowanceOn(tx, org, connection.id) : null;
        // Two imports of one user (into different organizations) must not both write a policy.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`media-user:${connection.id}:${userId}`}, 0))`,
        );
        const [existing] = await tx
          .select({ id: mediaAccounts.id })
          .from(mediaAccounts)
          .where(
            and(eq(mediaAccounts.providerConnectionId, connection.id), eq(mediaAccounts.externalId, userId)),
          )
          .limit(1);
        if (existing) throw conflict(`The account ${remote.username} is managed already`);
        const expected = allowance ? expectedMediaPolicy(mediaAccessOf(allowance)) : null;
        let user = remote;
        if (expected) user = await inTransaction(() => adapter.setMediaUserPolicy!(userId, expected));
        if (newPassword) {
          await inTransaction(() => adapter.setMediaUserPassword!(userId, newPassword));
          user = { ...user, hasPassword: true };
        }
        const now = new Date();
        const issues = mediaAccountIssues(user, expected, !!org);
        const [row] = await tx
          .insert(mediaAccounts)
          .values({
            providerConnectionId: connection.id,
            externalId: userId,
            orgId: org?.id ?? null,
            ...remoteMediaFields(user, issues, now),
            issues,
            createdAt: now,
          })
          .returning({ id: mediaAccounts.id });
        return row!.id;
      });
    } catch (err) {
      // After the rollback (see MediaFailure).
      if (err instanceof MediaFailure) throw await failedAtInstance(req, entry, err);
      if (isUniqueViolation(err)) throw conflict(`The account ${remote.username} is managed already`);
      throw err;
    }
    const seerr = await seerrAccountStep(ctx, id);
    await succeeded(req, { ...entry, resourceId: id, details: { ...entry.details, ...seerr } });
    noStore(reply);
    return { account: await accountDto(req, id), password: newPassword };
  });

  /**
   * Moves an account to an organization (its allowance's policy is written) or unassigns it.
   * An unassigned account keeps its policy and keeps working: staff disable or delete it.
   */
  app.post('/admin/media/accounts/:id/assign', async (req): Promise<MediaAccountDto> => {
    await access.assert(req, 'platform:media:write', platformScope);
    const { id } = parse(idParams, req.params);
    const body = parse(assignBody, req.body);
    const current = await db.query.mediaAccounts.findFirst({ where: eq(mediaAccounts.id, id) });
    if (!current) throw notFound('Streaming account');
    const org = body.orgId ? await orgById(body.orgId) : null;
    const entry = {
      action: 'media.account_assign',
      orgId: org?.id ?? current.orgId,
      resourceId: id,
      details: { username: current.username, orgId: org?.id ?? null, previousOrgId: current.orgId },
    };
    if (!org) {
      await db
        .update(mediaAccounts)
        .set({
          orgId: null,
          // Without an organization there is no expected policy to drift from.
          issues: sortMediaIssues(current.issues.filter((i) => i !== 'policy' && i !== 'no_allowance')),
        })
        .where(eq(mediaAccounts.id, id));
    } else {
      const connection = await connectionById(current.providerConnectionId);
      const adapter = providers.forConnection(connection);
      requireMediaSupport(adapter);
      try {
        await db.transaction(async (tx) => {
          const allowance = await allowanceOn(tx, org, current.providerConnectionId);
          const expected = expectedMediaPolicy(mediaAccessOf(allowance));
          await tx.update(mediaAccounts).set({ orgId: org.id }).where(eq(mediaAccounts.id, id));
          // A refused write rolls the assignment back.
          const remote = await inTransaction(() => adapter.setMediaUserPolicy!(current.externalId, expected));
          await tx
            .update(mediaAccounts)
            .set(remoteMediaFields(remote, mediaAccountIssues(remote, expected, true), new Date()))
            .where(eq(mediaAccounts.id, id));
        });
      } catch (err) {
        if (err instanceof MediaFailure) throw await failedAtInstance(req, entry, err);
        throw err;
      }
    }
    // Rights for the new organization's add-on, none without one.
    const seerr = await seerrAccountStep(ctx, id);
    await succeeded(req, { ...entry, details: { ...entry.details, ...seerr } });
    return accountDto(req, id);
  });

  /** Writes the allowance's policy to one account now (the sync would within a run or two). */
  app.post('/admin/media/accounts/:id/repair', async (req): Promise<MediaAccountDto> => {
    await access.assert(req, 'platform:media:write', platformScope);
    const { id } = parse(idParams, req.params);
    const current = await db.query.mediaAccounts.findFirst({ where: eq(mediaAccounts.id, id) });
    if (!current) throw notFound('Streaming account');
    const expected = await expectedPolicyFor(db, current.orgId, current.providerConnectionId);
    if (!expected) {
      throw noAllowance(
        current.orgId
          ? 'The organization of this account has no streaming allowance on its instance'
          : 'This account is not assigned to an organization',
      );
    }
    const connection = await connectionById(current.providerConnectionId);
    const adapter = providers.forConnection(connection);
    requireMediaSupport(adapter);
    const entry = {
      action: 'media.policy_repair',
      orgId: current.orgId,
      resourceId: id,
      details: { username: current.username, fields: [] as string[] },
    };
    const remote = await atInstance(req, entry, async () => {
      const before = await adapter.getMediaUser!(current.externalId);
      entry.details.fields = mediaPolicyDrift(before.policy, expected);
      return adapter.setMediaUserPolicy!(current.externalId, expected);
    });
    await db
      .update(mediaAccounts)
      .set(remoteMediaFields(remote, mediaAccountIssues(remote, expected, true), new Date()))
      .where(eq(mediaAccounts.id, id));
    // Seerr access is repaired along with the policy.
    const seerr = await seerrAccountStep(ctx, id);
    await succeeded(req, { ...entry, details: { ...entry.details, ...seerr } });
    return accountDto(req, id);
  });

  // --- Reseller: allowances of its customers ----------------------------------------------

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

  app.get('/reseller/customers/:orgId/media-allowance', async (req): Promise<MediaAllowanceDto | null> => {
    const { customer, reseller } = await resellerCustomer(req, 'reseller:customer:read');
    return mediaAllowanceDtoFor(ctx, customer, { reseller });
  });

  /** A share of the reseller's own allowance, on its instance, never beyond its access. */
  app.put('/reseller/customers/:orgId/media-allowance', async (req): Promise<MediaAllowanceChangeResult> => {
    const auth = requireAuth(req);
    const { customer, reseller } = await resellerCustomer(req, 'reseller:customer:write');
    const body = parse(resellerAllowanceBody, req.body);
    if (!reseller.modules.includes(MEDIA_MODULE)) {
      throw conflict(`Your organization does not have the module "${MEDIA_MODULE}"`);
    }
    const next: MediaAccess = {
      libraryIds: uniqueIds(body.libraryIds),
      maxStreams: body.maxStreams,
      downloads: body.downloads,
      remoteBitrateMbit: body.remoteBitrateMbit,
    };
    const requested = body.requests === undefined ? undefined : normalizeMediaRequests(body.requests);
    // A first allowance gets a generated code: read the instance's names before the transaction.
    const before = await loadMediaAllowance(db, reseller.id);
    const hasOwn = await db.query.mediaAllowances.findFirst({
      where: eq(mediaAllowances.orgId, customer.id),
    });
    const taken =
      before && !hasOwn
        ? await remoteCodeSuffixes(providers.forConnection(before.connection))
        : new Set<string>();

    const { previous, stored, moduleEnabled, connection, requestsShown } = await db.transaction(
      async (tx) => {
        // Locks the reseller first, then the customer.
        await lockMediaOrg(tx, customer);
        const own = await loadMediaAllowance(tx, reseller.id);
        if (!own) throw noAllowance('Your organization has no streaming allowance to hand out');
        const { allowance: resellerAllowance, connection } = own;
        const providerId = resellerAllowance.providerConnectionId;
        const current = await tx.query.mediaAllowances.findFirst({
          where: eq(mediaAllowances.orgId, customer.id),
        });
        // A reseller hands on only the add-on it has itself, and only while Seerr is active there.
        const seerrActive = (await seerrState(ctx, connection, tx)).active;
        const resellerRequests = seerrActive ? mediaRequestsOf(resellerAllowance) : null;
        // A reseller changes the add-on only where it sees it (its own add-on, Seerr active).
        // Elsewhere a sent null keeps the customer's add-on as it is, like an absent one: switching
        // off an add-on staff gave, or a refusal, would tell the reseller that there is one. One
        // sent on is refused below whatever the customer has.
        const ownRequests = requested === null && resellerRequests === null ? undefined : requested;
        const nextRequests: MediaRequestsAccess | null =
          ownRequests !== undefined ? ownRequests : current ? mediaRequestsOf(current) : null;

        const conflicts: (MediaAccessConflict | MediaRequestsConflict)[] = [
          ...mediaAccessExceeds(next, mediaAccessOf(resellerAllowance)),
          // A kept add-on beyond the reseller's is refused too, but only where the reseller sees it
          // (its own add-on, Seerr active) and so can narrow it. An add-on staff gave a customer of
          // a reseller without one stays as it is: the reseller sees nothing of it and could never
          // save otherwise. While Seerr is off an add-on has no effect and is left alone.
          ...(ownRequests !== undefined || resellerRequests !== null
            ? mediaRequestsExceed(nextRequests, resellerRequests)
            : []),
        ];
        if (conflicts.length > 0) {
          throw allowanceConflict(`This goes beyond your own streaming allowance (${conflicts.join(', ')})`, {
            customers: [{ id: customer.id, name: customer.name, conflicts }],
          });
        }
        // Everything the reseller committed besides this customer, plus the new allowance.
        const committed = await mediaCommitments(tx, reseller, providerId, customer.id);
        const left = resellerAllowance.maxAccounts - committedMediaAccounts(committed);
        if (body.maxAccounts > left) {
          throw accountLimit(
            `Only ${Math.max(left, 0)} accounts of your allowance are left for this customer`,
            {
              maxAccounts: resellerAllowance.maxAccounts,
              accounts: committedMediaAccounts(committed),
            },
          );
        }
        await assertInstanceChange(tx, customer, current, providerId);
        const customerUsage = await mediaCommitments(tx, customer, providerId);
        if (body.maxAccounts < customerUsage.accounts) {
          throw accountLimit(
            `This customer has ${customerUsage.accounts} streaming accounts. The maximum cannot be lower than that.`,
            { maxAccounts: body.maxAccounts, accounts: customerUsage.accounts },
          );
        }
        // Names and types as the reseller's allowance has them (its libraries are the only choice).
        const libraries = next.libraryIds.map((id) => {
          const ref = resellerAllowance.libraries.find((l) => l.id === id)!;
          return { ...ref };
        });
        // Resellers cannot choose a code: the customer keeps its own or gets a generated one.
        const accountCode = current?.accountCode ?? (await generateMediaAccountCode(tx, taken));
        const stored = await upsertAllowance(tx, {
          orgId: customer.id,
          providerConnectionId: providerId,
          accountCode,
          maxAccounts: body.maxAccounts,
          libraries,
          maxStreams: next.maxStreams,
          downloads: next.downloads,
          remoteBitrateMbit: next.remoteBitrateMbit,
          ...mediaRequestsColumns(nextRequests),
          updatedBy: auth.user.id,
        });
        return {
          previous: current ?? null,
          stored,
          moduleEnabled: await enableMedia(tx, customer.id),
          connection,
          requestsShown: resellerRequests !== null,
        };
      },
    );

    const policy = await applyIfChanged(customer.id, previous, stored, connection);
    const seerr = await applyRequestsIfChanged(customer.id, previous, stored, connection);
    await audit.record(req, {
      action: 'media.allowance_set',
      orgId: reseller.id,
      resourceType: 'media_allowance',
      resourceId: customer.id,
      details: {
        customerId: customer.id,
        customer: customer.name,
        // The reseller's audit log shows the add-on only where the reseller sees it in the dialog too.
        ...allowanceDetails(stored, requestsShown),
        previous: previous ? allowanceDetails(previous, requestsShown) : null,
        moduleEnabled: moduleEnabled ? MEDIA_MODULE : null,
        policy: policyDetails(policy),
        ...(seerr && requestsShown ? { seerr: seerrApplyDetails(seerr) } : {}),
      },
    });
    return {
      allowance: (await mediaAllowanceDtoFor(ctx, customer, { reseller }))!,
      policy,
      // Like the add-on itself: only for a reseller that sees it.
      ...(seerr && requestsShown ? { seerr } : {}),
    };
  });

  /** Gives the share back to the reseller, e.g. before the customer is deleted. Only without accounts. */
  app.delete('/reseller/customers/:orgId/media-allowance', async (req) => {
    const { customer, reseller } = await resellerCustomer(req, 'reseller:customer:write');
    const removed = await removeAllowance(customer);
    await audit.record(req, {
      action: 'media.allowance_delete',
      orgId: reseller.id,
      resourceType: 'media_allowance',
      resourceId: customer.id,
      details: {
        customerId: customer.id,
        customer: customer.name,
        // As for a change: the reseller's log shows the add-on only where its dialog does.
        ...allowanceDetails(removed, await requestsAudited(removed, { reseller })),
      },
    });
    return { ok: true };
  });
}
