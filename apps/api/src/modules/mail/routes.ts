import { domainToUnicode } from 'node:url';
import { and, eq, ilike, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  MAILBOX_STATES,
  MAIL_DKIM_SELECTOR,
  MAIL_DNS_RECORD_KEYS,
  MAIL_DNS_TTL,
  MAIL_MAX_ALIAS_TARGETS,
  MAIL_MIB,
  MAIL_PASSWORD_MAX,
  MAIL_PASSWORD_MIN,
  MAIL_RATE_LIMIT_FRAMES,
  isMailLocalPart,
  mailDomainAscii,
  mailLimitsIssue,
  normalizeModules,
  type DnsRecordInput,
  type MailAliasDto,
  type MailDnsApplyResult,
  type MailDnsRecordKey,
  type MailDnsSetupDto,
  type MailDomainChangeResult,
  type MailDomainDetailDto,
  type MailDomainDto,
  type MailDomainInfo,
  type MailRateLimit,
  type MailboxDto,
  type MailboxSecretDto,
  type Permission,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import { platformScope, requireAuth, requireSession } from '../../auth/access';
import { mailDomains, organizations, providerConnections } from '../../db/schema';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { parse } from '../../lib/validation';
import type {
  MailAliasPatch,
  MailDomainLimitsInput,
  MailDomainPatch,
  MailboxPatch,
  ProviderAdapter,
  RemoteMailDomain,
} from '../../providers/types';
import { dnsDataIssue } from '../hosting/dns';
import {
  assertRecordType,
  assignmentTarget,
  dnsWritable,
  domainCapabilities,
  domainChange,
  providerTtl,
  requireSupport,
} from '../hosting/service';
import { loadOrg } from '../orgs/routes';
import { buildMailDnsSetup, findMailZone } from './dns';
import {
  MAIL_MODULE,
  aliasDomain,
  assertAliasSlot,
  assertMailPassword,
  assertMailboxFits,
  assertMailboxSlot,
  assertNotRelay,
  generateMailPassword,
  loadMailDomain,
  lockMailDomain,
  mailDomainRow,
  mailDomainRowsQuery,
  mailDomainScope,
  mailboxAddress,
  requireMailSupport,
  storeMailDomainInfo,
  toMailDomainDto,
  type LoadedMailDomain,
  type MailDomainRow,
} from './service';

const idParams = z.object({ id: z.uuid() });
const orgParams = z.object({ orgId: z.uuid() });
const mailboxParams = idParams.extend({ address: z.string().trim().toLowerCase().min(3).max(254) });
const aliasParams = idParams.extend({ aliasId: z.string().regex(/^\d{1,10}$/) });

const localPart = z
  .string()
  .trim()
  .toLowerCase()
  .refine(isMailLocalPart, 'a-z, 0-9, dot, dash and underscore; a letter or digit at both ends');
const quotaMb = z.number().int().min(1).max(10_000_000);
const mailboxName = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[^<>]*$/, 'without < and >');
const password = z.string().min(MAIL_PASSWORD_MIN).max(MAIL_PASSWORD_MAX);
const target = z.string().trim().toLowerCase().pipe(z.email().max(254));
const keySize = z.union([z.literal(2048), z.literal(3072), z.literal(4096)]).default(2048);

const listQuery = z.object({ q: z.string().max(100).optional() });
const createMailboxBody = z.object({
  localPart,
  name: mailboxName.nullish(),
  /** Left out: the domain's default mailbox size. */
  quotaMb: quotaMb.optional(),
  /** Left out: the panel generates one (interactive sessions only). */
  password: password.optional(),
});
const patchMailboxBody = z
  .object({
    name: mailboxName.optional(),
    quotaMb: quotaMb.optional(),
    state: z.enum(MAILBOX_STATES).optional(),
  })
  .refine(
    (b) => b.name !== undefined || b.quotaMb !== undefined || b.state !== undefined,
    'Nothing to change',
  );
const passwordBody = z.object({ password: password.optional() });
const confirmBody = z.object({ confirm: z.string().trim().toLowerCase().max(320) });
const aliasBody = z.object({
  /** null: catch-all ("@domain"). */
  localPart: localPart.nullable(),
  targets: z.array(target).min(1).max(MAIL_MAX_ALIAS_TARGETS),
  active: z.boolean().default(true),
});
const aliasPatchBody = z
  .object({
    targets: z.array(target).min(1).max(MAIL_MAX_ALIAS_TARGETS).optional(),
    active: z.boolean().optional(),
  })
  .refine((b) => b.targets !== undefined || b.active !== undefined, 'Nothing to change');
const dkimBody = z.object({ keySize });
const dnsApplyBody = z.object({ keys: z.array(z.enum(MAIL_DNS_RECORD_KEYS)).min(1).optional() });

const rateLimit = z.object({
  value: z.number().int().min(1).max(1_000_000),
  frame: z.enum(MAIL_RATE_LIMIT_FRAMES),
});
const limitsShape = {
  maxMailboxes: z.number().int().min(0).max(100_000),
  maxAliases: z.number().int().min(1).max(100_000),
  quotaMb,
  defaultMailboxQuotaMb: quotaMb,
  maxMailboxQuotaMb: quotaMb,
  rateLimit: rateLimit.nullable(),
};
/** Mailcow's ordering rule on the MiB values. */
function orderIssue(
  limits: { quotaMb: number; defaultMailboxQuotaMb: number; maxMailboxQuotaMb: number },
  ctx: z.RefinementCtx,
) {
  const issue = mailLimitsIssue(limits);
  if (issue) ctx.addIssue({ code: 'custom', message: issue });
}
const createDomainBody = z.object({
  providerId: z.uuid(),
  domain: z.string().trim().min(3).max(253),
  description: z.string().trim().max(255).nullish(),
  limits: z.object(limitsShape).superRefine(orderIssue),
  dkimKeySize: keySize,
  restartSogo: z.boolean().default(true),
  orgId: z.uuid().nullable().default(null),
  enableModule: z.boolean().default(true),
});
const patchDomainBody = z.object({
  /** Merged with the current limits, then checked with mailLimitsIssue. */
  limits: z.object(limitsShape).partial().optional(),
  active: z.boolean().optional(),
});
const deleteDomainBody = z.object({
  confirm: z.string().trim().toLowerCase().max(253),
  deleteDkim: z.boolean().default(true),
});
const assignBody = z.object({ orgId: z.uuid().nullable(), enableModule: z.boolean().default(true) });
const adminListQuery = z.object({
  q: z.string().max(100).optional(),
  assigned: z.enum(['true', 'false']).optional(),
  providerId: z.uuid().optional(),
  orgId: z.uuid().optional(),
});

const MiB = MAIL_MIB;
const LIMIT_KEYS = [
  'maxMailboxes',
  'maxAliases',
  'quotaMb',
  'defaultMailboxQuotaMb',
  'maxMailboxQuotaMb',
] as const;

const like = (q: string) => `%${q.replace(/[%_]/g, '')}%`;
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Passwords must not end up in browser or proxy caches. */
function noStore(reply: FastifyReply) {
  reply.header('cache-control', 'no-store');
}

/** Mailcow's password policy, null when it cannot be read (the panel's own rules apply then). */
async function passwordPolicy(adapter: ProviderAdapter) {
  return adapter.mailPasswordPolicy ? adapter.mailPasswordPolicy().catch(() => null) : null;
}

/** Limits of a mail domain as Mailcow takes them (MiB). */
function limitsInput(info: MailDomainInfo): MailDomainLimitsInput {
  const { limits } = info;
  return {
    maxMailboxes: limits.maxMailboxes,
    maxAliases: limits.maxAliases,
    quotaMb: Math.floor(limits.quotaBytes / MiB),
    defaultMailboxQuotaMb: Math.floor(limits.defaultMailboxQuotaBytes / MiB),
    maxMailboxQuotaMb: Math.floor(limits.maxMailboxQuotaBytes / MiB),
    rateLimit: limits.rateLimit,
  };
}

const sameRate = (a: MailRateLimit | null, b: MailRateLimit | null) =>
  a === b || (!!a && !!b && a.value === b.value && a.frame === b.frame);

const sameTargets = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

/** Audit entry of a change at Mailcow; `details.domain` is the unicode name. */
interface MailEntry {
  action: string;
  orgId: string | null;
  resourceId: string | null;
  details: Record<string, unknown>;
}

function entryFor(row: MailDomainRow, action: string, details: Record<string, unknown>): MailEntry {
  return {
    action,
    orgId: row.mailDomain.orgId,
    resourceId: row.mailDomain.id,
    details: { domain: row.mailDomain.name, ...details },
  };
}

/**
 * A change at Mailcow that failed inside a transaction. It is audited only after the
 * rollback: the audit needs a pool connection of its own, and awaiting one while the
 * transaction holds a connection (and the domain lock, which queued requests wait for on
 * connections of their own) can exhaust the pool for good.
 */
class MailcowFailure extends Error {
  constructor(readonly error: unknown) {
    super(errorMessage(error));
  }
}

/** Runs a call to Mailcow inside a transaction; a failure becomes a MailcowFailure. */
async function inTransaction<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new MailcowFailure(err);
  }
}

/** E-mail: mail domains of an organization, mailboxes, aliases, DNS setup, admin inventory. */
export async function mailRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, access, audit, providers } = ctx;

  async function mailDomain(req: FastifyRequest, permission?: Permission): Promise<LoadedMailDomain> {
    const { id } = parse(idParams, req.params);
    const loaded = await loadMailDomain(ctx, req, id);
    if (permission) await access.assert(req, permission, loaded.scope);
    return loaded;
  }

  /** Mail domain for the platform routes, no organization check: callers assert a platform permission. */
  async function adminMailDomain(req: FastifyRequest): Promise<LoadedMailDomain> {
    const { id } = parse(idParams, req.params);
    const row = await mailDomainRow(ctx, id);
    if (!row) throw notFound('Mail domain');
    return {
      ...row,
      scope: mailDomainScope(row.mailDomain),
      adapter: providers.forConnection(row.connection),
    };
  }

  async function mailDomainDto(req: FastifyRequest, id: string): Promise<MailDomainDto> {
    const row = await mailDomainRow(ctx, id);
    if (!row) throw notFound('Mail domain');
    return toMailDomainDto(ctx, req, row);
  }

  async function connectionById(id: string) {
    const connection = await db.query.providerConnections.findFirst({
      where: eq(providerConnections.id, id),
    });
    if (!connection) throw notFound('Provider');
    return connection;
  }

  /**
   * Audits a failed change (pre-checks included). Returns the error to answer with: the
   * AppError as it came (limits, Mailcow's answers), anything else as a 500.
   */
  async function failedAtMailcow(req: FastifyRequest, entry: MailEntry, err: unknown): Promise<AppError> {
    const error = err instanceof MailcowFailure ? err.error : err;
    await audit.record(req, {
      action: entry.action,
      orgId: entry.orgId,
      resourceType: 'mail_domain',
      resourceId: entry.resourceId,
      status: 'failure',
      details: { ...entry.details, error: errorMessage(error) },
    });
    return error instanceof AppError ? error : new AppError(500, 'action_failed', errorMessage(error));
  }

  /**
   * Runs a change at Mailcow outside a transaction. A failure is audited (the success is
   * audited by the caller, once it knows the outcome) and surfaces as an AppError.
   */
  async function atMailcow<T>(req: FastifyRequest, entry: MailEntry, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw await failedAtMailcow(req, entry, err);
    }
  }

  async function succeeded(req: FastifyRequest, entry: MailEntry): Promise<void> {
    await audit.record(req, { ...entry, resourceType: 'mail_domain' });
  }

  /** Best effort, so lists show the new usage; the sync catches up otherwise. */
  async function refreshUsage(req: FastifyRequest, loaded: LoadedMailDomain): Promise<void> {
    try {
      const remote = await loaded.adapter.getMailDomain!(loaded.mailDomain.externalId);
      await storeMailDomainInfo(db, loaded.mailDomain.id, remote);
    } catch (err) {
      req.log.warn({ err, mailDomainId: loaded.mailDomain.id }, 'mail domain usage refresh failed');
    }
  }

  /** An alias of this mail domain. Alias ids are global per instance: others answer 404. */
  async function domainAlias(loaded: LoadedMailDomain, aliasId: string): Promise<MailAliasDto> {
    const alias = await loaded.adapter.getMailAlias!(aliasId);
    if (aliasDomain(alias.address) !== loaded.mailDomain.externalId) throw notFound('Alias');
    return alias;
  }

  // --- Customer: mail domains ----------------------------------------------------------

  app.get('/orgs/:orgId/mail/domains', async (req): Promise<MailDomainDto[]> => {
    const { orgId } = parse(orgParams, req.params);
    await loadOrg(ctx, req, orgId);
    const query = parse(listQuery, req.query);
    const rows = await mailDomainRowsQuery(ctx)
      .where(
        and(
          eq(mailDomains.orgId, orgId),
          query.q
            ? or(ilike(mailDomains.name, like(query.q)), ilike(mailDomains.externalId, like(query.q)))
            : undefined,
        ),
      )
      .orderBy(mailDomains.name);
    const visible: MailDomainDto[] = [];
    for (const row of rows) {
      if (await access.can(req, 'mail:read', mailDomainScope(row.mailDomain))) {
        visible.push(await toMailDomainDto(ctx, req, row));
      }
    }
    return visible;
  });

  app.get('/mail/domains/:id', async (req): Promise<MailDomainDetailDto> => {
    const loaded = await mailDomain(req);
    const { adapter } = loaded;
    let info = loaded.mailDomain.info;
    let liveError: string | null = null;
    if (adapter.getMailDomain) {
      try {
        const remote = await adapter.getMailDomain(loaded.mailDomain.externalId);
        await storeMailDomainInfo(db, loaded.mailDomain.id, remote);
        info = remote.info;
        loaded.mailDomain = {
          ...loaded.mailDomain,
          info,
          name: info.displayName,
          active: info.active,
          lastSyncedAt: new Date(),
          missingSince: null,
        };
      } catch (err) {
        req.log.warn({ err, mailDomainId: loaded.mailDomain.id }, 'live mail domain info failed');
        liveError = errorMessage(err);
      }
    }
    return {
      ...(await toMailDomainDto(ctx, req, loaded)),
      info,
      liveError,
      clientSettings: adapter.mailClientSettings?.() ?? null,
      passwordPolicy: await passwordPolicy(adapter),
    };
  });

  // --- Customer: mailboxes -------------------------------------------------------------

  app.get('/mail/domains/:id/mailboxes', async (req): Promise<MailboxDto[]> => {
    const loaded = await mailDomain(req);
    requireMailSupport(loaded.adapter);
    if (loaded.mailDomain.info?.relay) return [];
    return loaded.adapter.listMailboxes!(loaded.mailDomain.externalId);
  });

  app.post('/mail/domains/:id/mailboxes', async (req, reply): Promise<MailboxSecretDto> => {
    const auth = requireAuth(req);
    const loaded = await mailDomain(req, 'mail:write');
    const { adapter, mailDomain: row } = loaded;
    requireMailSupport(adapter);
    assertNotRelay(row.info);
    const body = parse(createMailboxBody, req.body);
    // A generated password is shown once to a person. Scripts send the one they set.
    if (auth.token && !body.password) {
      throw badRequest('API tokens cannot receive passwords. Send a password for the new mailbox.');
    }
    const policy = await passwordPolicy(adapter);
    if (body.password) assertMailPassword(body.password, policy, 'password');
    const ascii = row.externalId;
    const address = `${body.localPart}@${ascii}`;
    const chosen = body.password !== undefined;
    const newPassword = body.password ?? generateMailPassword(policy);
    const entry = entryFor(loaded, 'mail.mailbox_create', {
      address,
      name: body.name ?? null,
      quotaBytes: body.quotaMb !== undefined ? body.quotaMb * MiB : null,
      password: chosen ? 'chosen' : 'generated',
    });

    let mailbox: MailboxDto;
    try {
      mailbox = await db.transaction(async (tx) => {
        // Held while Mailcow creates the mailbox: its own count check and insert are not
        // atomic. Everything in here goes through tx, no second pool connection.
        await lockMailDomain(tx, row.id);
        const live = await inTransaction(() => adapter.getMailDomain!(ascii));
        await storeMailDomainInfo(tx, row.id, live);
        assertNotRelay(live.info);
        assertMailboxSlot(live.info);
        const size = body.quotaMb ?? Math.floor(live.info.limits.defaultMailboxQuotaBytes / MiB);
        entry.details.quotaBytes = size * MiB;
        assertMailboxFits(live.info, size * MiB);
        return inTransaction(() =>
          adapter.createMailbox!({
            localPart: body.localPart,
            domain: ascii,
            name: body.name ?? null,
            quotaMb: size,
            password: newPassword,
          }),
        );
      });
    } catch (err) {
      // After the rollback (see MailcowFailure).
      throw await failedAtMailcow(req, entry, err);
    }
    await refreshUsage(req, loaded);
    // Who created the mailbox is recorded, the password itself never is.
    await succeeded(req, entry);
    noStore(reply);
    return { mailbox, password: chosen ? null : newPassword };
  });

  app.patch('/mail/domains/:id/mailboxes/:address', async (req): Promise<MailboxDto> => {
    const loaded = await mailDomain(req, 'mail:write');
    const { adapter, mailDomain: row } = loaded;
    requireMailSupport(adapter);
    const params = parse(mailboxParams, req.params);
    const body = parse(patchMailboxBody, req.body);
    const address = mailboxAddress(loaded, params.address);
    const current = await adapter.getMailbox!(address);

    const patch: MailboxPatch = {};
    if (body.name !== undefined && body.name !== current.name) patch.name = body.name;
    if (body.quotaMb !== undefined && body.quotaMb * MiB !== current.quotaBytes) patch.quotaMb = body.quotaMb;
    if (body.state !== undefined && body.state !== current.state) patch.state = body.state;
    if (Object.keys(patch).length === 0) return current;

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    if (patch.name !== undefined) [before.name, after.name] = [current.name, patch.name];
    if (patch.quotaMb !== undefined) {
      [before.quotaBytes, after.quotaBytes] = [current.quotaBytes, patch.quotaMb * MiB];
    }
    if (patch.state !== undefined) [before.state, after.state] = [current.state, patch.state];
    const entry = entryFor(loaded, 'mail.mailbox_update', { address, before, after });

    const nextBytes = patch.quotaMb !== undefined ? patch.quotaMb * MiB : null;
    try {
      // Only a larger mailbox needs room in the domain. A smaller one always fits, even below
      // what it stores (Mailcow then refuses new mail for it).
      if (nextBytes !== null && nextBytes > current.quotaBytes) {
        await db.transaction(async (tx) => {
          await lockMailDomain(tx, row.id);
          const live = await inTransaction(() => adapter.getMailDomain!(row.externalId));
          await storeMailDomainInfo(tx, row.id, live);
          // Read again under the lock: a parallel change may have resized it meanwhile.
          const fresh = await inTransaction(() => adapter.getMailbox!(address));
          assertMailboxFits(live.info, nextBytes, fresh.quotaBytes);
          await inTransaction(() => adapter.updateMailbox!(address, patch));
        });
      } else {
        await adapter.updateMailbox!(address, patch);
      }
    } catch (err) {
      throw await failedAtMailcow(req, entry, err);
    }
    if (nextBytes !== null) await refreshUsage(req, loaded);
    await succeeded(req, entry);
    return adapter.getMailbox!(address);
  });

  app.post('/mail/domains/:id/mailboxes/:address/password', async (req, reply) => {
    const loaded = await mailDomain(req);
    requireSession(req);
    await access.assert(req, 'mail:password', loaded.scope);
    const { adapter } = loaded;
    requireMailSupport(adapter);
    const params = parse(mailboxParams, req.params);
    const body = parse(passwordBody, req.body ?? {});
    const address = mailboxAddress(loaded, params.address);
    // 404 first, so nothing is audited for a typo.
    await adapter.getMailbox!(address);
    const policy = await passwordPolicy(adapter);
    if (body.password) assertMailPassword(body.password, policy, 'password');
    const chosen = body.password !== undefined;
    const newPassword = body.password ?? generateMailPassword(policy);
    const entry = entryFor(loaded, 'mail.password_reset', {
      address,
      password: chosen ? 'chosen' : 'generated',
    });
    await atMailcow(req, entry, () => adapter.setMailboxPassword!(address, newPassword));
    // Who set a new password is recorded, the password itself never is.
    await succeeded(req, entry);
    noStore(reply);
    return { password: chosen ? null : newPassword };
  });

  app.delete('/mail/domains/:id/mailboxes/:address', async (req) => {
    const loaded = await mailDomain(req, 'mail:write');
    const { adapter } = loaded;
    requireMailSupport(adapter);
    const params = parse(mailboxParams, req.params);
    const { confirm } = parse(confirmBody, req.body ?? {});
    const address = mailboxAddress(loaded, params.address);
    if (confirm !== address) {
      throw badRequest('Validation failed', [
        { path: 'confirm', message: `Type the address ${address} to confirm` },
      ]);
    }
    const current = await adapter.getMailbox!(address);
    const entry = entryFor(loaded, 'mail.mailbox_delete', {
      address,
      quotaBytes: current.quotaBytes,
      usedBytes: current.usedBytes,
      messages: current.messages,
    });
    await atMailcow(req, entry, () => adapter.deleteMailbox!(address));
    await refreshUsage(req, loaded);
    await succeeded(req, entry);
    return { ok: true };
  });

  // --- Customer: aliases ---------------------------------------------------------------

  app.get('/mail/domains/:id/aliases', async (req): Promise<MailAliasDto[]> => {
    const loaded = await mailDomain(req);
    requireMailSupport(loaded.adapter);
    if (loaded.mailDomain.info?.relay) return [];
    return loaded.adapter.listMailAliases!(loaded.mailDomain.externalId);
  });

  app.post('/mail/domains/:id/aliases', async (req): Promise<MailAliasDto> => {
    const loaded = await mailDomain(req, 'mail:write');
    const { adapter, mailDomain: row } = loaded;
    requireMailSupport(adapter);
    assertNotRelay(row.info);
    const body = parse(aliasBody, req.body);
    const ascii = row.externalId;
    const address = body.localPart === null ? `@${ascii}` : `${body.localPart}@${ascii}`;
    const targets = [...new Set(body.targets)];
    if (targets.includes(address)) {
      throw badRequest('Validation failed', [
        { path: 'targets', message: 'An alias cannot forward to itself' },
      ]);
    }
    const entry = entryFor(loaded, 'mail.alias_create', { address, targets, active: body.active });

    let alias: MailAliasDto;
    try {
      alias = await db.transaction(async (tx) => {
        await lockMailDomain(tx, row.id);
        const live = await inTransaction(() => adapter.getMailDomain!(ascii));
        await storeMailDomainInfo(tx, row.id, live);
        assertNotRelay(live.info);
        assertAliasSlot(live.info);
        return inTransaction(() => adapter.createMailAlias!({ address, targets, active: body.active }));
      });
    } catch (err) {
      throw await failedAtMailcow(req, entry, err);
    }
    await refreshUsage(req, loaded);
    await succeeded(req, { ...entry, details: { ...entry.details, aliasId: alias.id } });
    return alias;
  });

  app.patch('/mail/domains/:id/aliases/:aliasId', async (req): Promise<MailAliasDto> => {
    const loaded = await mailDomain(req, 'mail:write');
    const { adapter } = loaded;
    requireMailSupport(adapter);
    const { aliasId } = parse(aliasParams, req.params);
    const body = parse(aliasPatchBody, req.body);
    const current = await domainAlias(loaded, aliasId);

    const patch: MailAliasPatch = {};
    if (body.targets !== undefined) {
      if (current.special !== null) {
        throw conflict('This alias discards or learns mail. Change it in Mailcow.');
      }
      const targets = [...new Set(body.targets)];
      if (targets.includes(current.address)) {
        throw badRequest('Validation failed', [
          { path: 'targets', message: 'An alias cannot forward to itself' },
        ]);
      }
      if (!sameTargets(targets, current.targets)) patch.targets = targets;
    }
    if (body.active !== undefined && body.active !== current.active) patch.active = body.active;
    if (Object.keys(patch).length === 0) return current;

    const before: Record<string, unknown> = {};
    if (patch.targets !== undefined) before.targets = current.targets;
    if (patch.active !== undefined) before.active = current.active;
    const entry = entryFor(loaded, 'mail.alias_update', {
      aliasId,
      address: current.address,
      before,
      after: patch,
    });
    await atMailcow(req, entry, () => adapter.updateMailAlias!(aliasId, patch));
    await succeeded(req, entry);
    return adapter.getMailAlias!(aliasId);
  });

  app.delete('/mail/domains/:id/aliases/:aliasId', async (req) => {
    const loaded = await mailDomain(req, 'mail:write');
    const { adapter } = loaded;
    requireMailSupport(adapter);
    const { aliasId } = parse(aliasParams, req.params);
    const current = await domainAlias(loaded, aliasId);
    const entry = entryFor(loaded, 'mail.alias_delete', {
      aliasId,
      address: current.address,
      targets: current.special ? [current.special] : current.targets,
    });
    await atMailcow(req, entry, () => adapter.deleteMailAlias!(aliasId));
    await refreshUsage(req, loaded);
    await succeeded(req, entry);
    return { ok: true };
  });

  // --- Customer: DNS setup -------------------------------------------------------------

  app.get('/mail/domains/:id/dns', async (req): Promise<MailDnsSetupDto> => {
    const loaded = await mailDomain(req);
    requireMailSupport(loaded.adapter);
    return buildMailDnsSetup(ctx, req, loaded);
  });

  app.post('/mail/domains/:id/dkim', async (req): Promise<MailDnsSetupDto> => {
    const loaded = await mailDomain(req, 'mail:write');
    const { adapter } = loaded;
    requireMailSupport(adapter);
    requireSupport(adapter, 'createDkim', 'DKIM keys');
    const body = parse(dkimBody, req.body ?? {});
    const options = { selector: MAIL_DKIM_SELECTOR, keySize: body.keySize };
    const entry = entryFor(loaded, 'mail.dkim_create', options);
    await atMailcow(req, entry, () => adapter.createDkim!(loaded.mailDomain.externalId, options));
    await succeeded(req, entry);
    return buildMailDnsSetup(ctx, req, loaded);
  });

  /**
   * Adds the missing records to the panel domain of the same name, one after another (Joker
   * rewrites the whole zone per change), each audited as domain.dns_add like a manual one.
   * Records that are there already, or conflict, are never touched.
   */
  app.post('/mail/domains/:id/dns/apply', async (req): Promise<MailDnsApplyResult> => {
    const loaded = await mailDomain(req);
    requireMailSupport(loaded.adapter);
    const body = parse(dnsApplyBody, req.body ?? {});
    const zone = await findMailZone(ctx, req, loaded.mailDomain);
    if (!zone) {
      throw conflict(
        'No domain with this name in the console that you may manage. Add the records at your DNS provider.',
      );
    }
    await access.assert(req, 'domain:dns:write', zone.scope);
    requireSupport(zone.adapter, 'addDnsRecord', 'DNS changes');
    if (!(await dnsWritable(zone.adapter))) {
      throw conflict('DNS changes are not possible at this provider right now');
    }
    const entry = entryFor(loaded, 'mail.dns_apply', { zoneDomainId: zone.domain.id });
    const setup = await buildMailDnsSetup(ctx, req, loaded, zone);
    if (setup.zone?.error) {
      // Without the records nothing can be told apart from what is there: add nothing.
      throw await failedAtMailcow(
        req,
        entry,
        new AppError(
          502,
          'provider_error',
          `The DNS records of ${zone.domain.name} could not be read: ${setup.zone.error}`,
        ),
      );
    }

    const selected = new Set<MailDnsRecordKey>(body.keys ?? MAIL_DNS_RECORD_KEYS);
    const added: MailDnsApplyResult['added'] = [];
    const skipped: MailDnsApplyResult['skipped'] = [];
    const failed: MailDnsApplyResult['failed'] = [];
    // Mail records never go through a proxy: MX targets and autodiscover need the real host.
    const proxy = domainCapabilities(zone.adapter).includes('dnsProxy');
    for (const record of setup.records) {
      if (!selected.has(record.key)) continue;
      if (record.status !== 'missing') {
        skipped.push({ key: record.key, reason: 'not_missing' });
        continue;
      }
      if (record.hint === 'no_dkim_key') {
        skipped.push({ key: record.key, reason: 'no_dkim_key' });
        continue;
      }
      if (!record.addable) {
        skipped.push({ key: record.key, reason: 'not_supported' });
        continue;
      }
      try {
        const input: DnsRecordInput = providerTtl(zone.adapter, {
          type: record.type,
          name: record.name,
          data: record.data,
          ttl: MAIL_DNS_TTL,
          ...(proxy ? { proxied: false } : {}),
        });
        assertRecordType(zone.adapter, input.type);
        const issue = dnsDataIssue(input.type, input.data);
        if (issue) throw badRequest(issue);
        await domainChange(
          ctx,
          req,
          zone,
          'dns_add',
          { ...input, source: 'mail', mailDomainId: loaded.mailDomain.id },
          () => zone.adapter.addDnsRecord!(zone.domain.externalId, input),
        );
        added.push(record.key);
      } catch (err) {
        failed.push({ key: record.key, error: errorMessage(err) });
      }
    }
    await audit.record(req, {
      ...entry,
      resourceType: 'mail_domain',
      status: failed.length > 0 ? 'failure' : 'success',
      details: { ...entry.details, added, skipped, failed },
    });
    return { added, skipped, failed, setup: await buildMailDnsSetup(ctx, req, loaded, zone) };
  });

  // --- Admin: inventory ----------------------------------------------------------------

  app.get('/admin/mail/domains', async (req): Promise<MailDomainDto[]> => {
    await access.assert(req, 'platform:provider:read', platformScope);
    const query = parse(adminListQuery, req.query);
    const filters: (SQL | undefined)[] = [
      query.assigned === 'true' ? isNotNull(mailDomains.orgId) : undefined,
      query.assigned === 'false' ? isNull(mailDomains.orgId) : undefined,
      query.providerId ? eq(mailDomains.providerConnectionId, query.providerId) : undefined,
      query.orgId ? eq(mailDomains.orgId, query.orgId) : undefined,
      query.q
        ? or(ilike(mailDomains.name, like(query.q)), ilike(mailDomains.externalId, like(query.q)))
        : undefined,
    ];
    const rows = await mailDomainRowsQuery(ctx)
      .where(and(...filters))
      .orderBy(mailDomains.name)
      .limit(1000);
    return Promise.all(rows.map((row) => toMailDomainDto(ctx, req, row)));
  });

  /**
   * Creates a mail domain at a Mailcow instance and stores it, optionally for a customer.
   * With the SOGo restart this can take up to two minutes.
   */
  app.post('/admin/mail/domains', async (req): Promise<MailDomainChangeResult> => {
    await access.assert(req, 'platform:mail:write', platformScope);
    const body = parse(createDomainBody, req.body);
    const connection = await connectionById(body.providerId);
    const adapter = providers.forConnection(connection);
    requireSupport(adapter, 'createMailDomain', 'creating mail domains');
    const ascii = mailDomainAscii(body.domain);
    if (!ascii) {
      throw badRequest('Validation failed', [
        { path: 'domain', message: 'Enter a domain name such as kunde.ch' },
      ]);
    }
    const display = domainToUnicode(ascii) || ascii;
    const entry: MailEntry = {
      action: 'mail.domain_create',
      orgId: body.orgId,
      resourceId: null,
      details: {
        domain: display,
        providerId: connection.id,
        limits: body.limits,
        dkimKeySize: body.dkimKeySize,
        restartSogo: body.restartSogo,
        orgId: body.orgId,
      },
    };

    let created: { domain: RemoteMailDomain; warnings: string[] };
    let target: Awaited<ReturnType<typeof assignmentTarget>> | null;
    try {
      const existing = await db
        .select({
          connectionId: mailDomains.providerConnectionId,
          missingSince: mailDomains.missingSince,
          instance: providerConnections.name,
        })
        .from(mailDomains)
        .innerJoin(providerConnections, eq(providerConnections.id, mailDomains.providerConnectionId))
        .where(eq(mailDomains.externalId, ascii));
      // A row marked missing is created again at Mailcow and revived below.
      if (existing.some((r) => r.connectionId === connection.id && !r.missingSince)) {
        throw conflict('This mail domain is in the console already');
      }
      const elsewhere = existing.find((r) => r.connectionId !== connection.id && !r.missingSince);
      if (elsewhere) {
        throw conflict(
          `${display} is a mail domain on ${elsewhere.instance} already. MX records can only point to one server.`,
        );
      }
      target = body.orgId ? await assignmentTarget(db, body.orgId, MAIL_MODULE, body.enableModule) : null;
      created = await adapter.createMailDomain!({
        domain: ascii,
        description: body.description || null,
        limits: body.limits,
        dkim: { selector: MAIL_DKIM_SELECTOR, keySize: body.dkimKeySize },
        restartSogo: body.restartSogo,
      });
    } catch (err) {
      throw await failedAtMailcow(req, entry, err);
    }

    const { info } = created.domain;
    const now = new Date();
    let stored: { id: string; orgId: string | null; moduleEnabled: boolean };
    try {
      stored = await db.transaction(async (tx) => {
        let moduleEnabled = false;
        if (target?.enable) {
          const [org] = await tx
            .select({ modules: organizations.modules })
            .from(organizations)
            .where(eq(organizations.id, target.org.id))
            .for('update');
          if (org && !org.modules.includes(MAIL_MODULE)) {
            await tx
              .update(organizations)
              .set({ modules: normalizeModules([...org.modules, MAIL_MODULE]) })
              .where(eq(organizations.id, target.org.id));
            moduleEnabled = true;
          }
        }
        const [row] = await tx
          .insert(mailDomains)
          .values({
            providerConnectionId: connection.id,
            externalId: ascii,
            name: info.displayName,
            active: info.active,
            info,
            orgId: target?.org.id ?? null,
            lastSyncedAt: now,
            // Now, not when the transaction began: the sync takes rows created before it read
            // the list as missing.
            createdAt: now,
          })
          .onConflictDoUpdate({
            target: [mailDomains.providerConnectionId, mailDomains.externalId],
            set: {
              info,
              name: info.displayName,
              active: info.active,
              lastSyncedAt: now,
              missingSince: null,
              // A sync may have inserted it meanwhile (unassigned); an assignment stays.
              orgId: sql`coalesce(${mailDomains.orgId}, excluded.org_id)`,
            },
          })
          .returning({ id: mailDomains.id, orgId: mailDomains.orgId });
        return { id: row!.id, orgId: row!.orgId, moduleEnabled };
      });
    } catch (err) {
      // At Mailcow, but not stored: the next sync shows it unassigned.
      await audit.record(req, {
        ...entry,
        resourceType: 'mail_domain',
        status: 'failure',
        details: { ...entry.details, error: errorMessage(err), createdAtMailcow: true },
      });
      throw err;
    }

    await audit.record(req, {
      ...entry,
      orgId: stored.orgId,
      resourceType: 'mail_domain',
      resourceId: stored.id,
      details: {
        ...entry.details,
        domain: info.displayName,
        orgId: stored.orgId,
        moduleEnabled: stored.moduleEnabled ? MAIL_MODULE : null,
        warnings: created.warnings,
      },
    });
    return { domain: await mailDomainDto(req, stored.id), warnings: created.warnings };
  });

  /** Limits and the active switch. Mailcow's usage checks come back as 409 through the adapter. */
  app.patch('/admin/mail/domains/:id', async (req): Promise<MailDomainChangeResult> => {
    await access.assert(req, 'platform:mail:write', platformScope);
    const loaded = await adminMailDomain(req);
    const { adapter, mailDomain: row } = loaded;
    requireSupport(adapter, 'updateMailDomain', 'changing mail domains');
    const body = parse(patchDomainBody, req.body);
    const entry = entryFor(loaded, 'mail.domain_update', {});

    let changed = false;
    try {
      // Live, not the stored copy: limits changed in Mailcow directly would be missed.
      const live = await adapter.getMailDomain!(row.externalId);
      await storeMailDomainInfo(db, row.id, live);
      const current = limitsInput(live.info);
      const requested = body.limits ?? {};
      const merged: MailDomainLimitsInput = {
        maxMailboxes: requested.maxMailboxes ?? current.maxMailboxes,
        maxAliases: requested.maxAliases ?? current.maxAliases,
        quotaMb: requested.quotaMb ?? current.quotaMb,
        defaultMailboxQuotaMb: requested.defaultMailboxQuotaMb ?? current.defaultMailboxQuotaMb,
        maxMailboxQuotaMb: requested.maxMailboxQuotaMb ?? current.maxMailboxQuotaMb,
        rateLimit: requested.rateLimit !== undefined ? requested.rateLimit : current.rateLimit,
      };
      const issue = mailLimitsIssue(merged);
      if (issue) throw badRequest('Validation failed', [{ path: 'limits', message: issue }]);

      const patch: MailDomainPatch = {};
      const before: Record<string, unknown> = {};
      for (const key of LIMIT_KEYS) {
        if (merged[key] !== current[key]) {
          patch[key] = merged[key];
          before[key] = current[key];
        }
      }
      if (!sameRate(merged.rateLimit, current.rateLimit)) {
        patch.rateLimit = merged.rateLimit;
        before.rateLimit = current.rateLimit;
      }
      if (body.active !== undefined && body.active !== live.info.active) {
        patch.active = body.active;
        before.active = live.info.active;
      }
      entry.details = { ...entry.details, before, after: patch };
      if (Object.keys(patch).length > 0) {
        await adapter.updateMailDomain!(row.externalId, patch);
        changed = true;
      }
    } catch (err) {
      throw await failedAtMailcow(req, entry, err);
    }
    if (changed) {
      await refreshUsage(req, loaded);
      await succeeded(req, entry);
    }
    return { domain: await mailDomainDto(req, row.id), warnings: [] };
  });

  /**
   * Mailcow only deletes empty domains: the panel checks first. Aliases go with the domain,
   * the mail to Mailcow's garbage folder (MAILDIR_GC_TIME, 5 days by default). The DKIM key,
   * which Mailcow keeps, is deleted too unless asked otherwise.
   */
  app.delete('/admin/mail/domains/:id', async (req) => {
    await access.assert(req, 'platform:mail:write', platformScope);
    const loaded = await adminMailDomain(req);
    const { adapter, mailDomain: row } = loaded;
    requireSupport(adapter, 'deleteMailDomain', 'deleting mail domains');
    const body = parse(deleteDomainBody, req.body ?? {});
    if (body.confirm !== row.externalId && body.confirm !== row.name.toLowerCase()) {
      throw badRequest('Validation failed', [
        { path: 'confirm', message: `Type the domain name ${row.name} to confirm` },
      ]);
    }
    const entry = entryFor(loaded, 'mail.domain_delete', {
      providerId: row.providerConnectionId,
      orgId: row.orgId,
      deleteDkim: body.deleteDkim,
    });

    let remote: RemoteMailDomain | null = null;
    try {
      remote = await adapter.getMailDomain!(row.externalId);
    } catch (err) {
      // Gone at Mailcow already (and the sync noticed): only the row is left to remove.
      if (!(err instanceof AppError && err.statusCode === 404 && row.missingSince)) {
        throw await failedAtMailcow(req, entry, err);
      }
    }
    if (!remote) {
      await db.delete(mailDomains).where(eq(mailDomains.id, row.id));
      await succeeded(req, { ...entry, details: { ...entry.details, goneAtMailcow: true } });
      return { ok: true, warnings: [] };
    }

    const warnings: string[] = [];
    const { mailboxes, aliases } = remote.info.usage;
    try {
      if (mailboxes > 0) {
        throw new AppError(
          409,
          'domain_not_empty',
          `Mailcow only deletes empty mail domains: ${mailboxes} mailboxes left. Delete them first (the customer can, under E-Mail).`,
          { mailboxes },
        );
      }
      warnings.push(...(await adapter.deleteMailDomain!(row.externalId)).warnings);
    } catch (err) {
      throw await failedAtMailcow(req, entry, err);
    }
    if (body.deleteDkim) {
      try {
        if (!adapter.deleteDkim) throw new Error('this provider cannot delete DKIM keys');
        await adapter.deleteDkim(row.externalId);
      } catch (err) {
        warnings.push(`The DKIM key could not be deleted: ${errorMessage(err)}`);
      }
    }
    await db.delete(mailDomains).where(eq(mailDomains.id, row.id));
    await succeeded(req, { ...entry, details: { ...entry.details, aliases, warnings } });
    return { ok: true, warnings };
  });

  app.post('/admin/mail/domains/:id/assign', async (req): Promise<MailDomainDto> => {
    await access.assert(req, 'platform:server:assign', platformScope);
    const { id } = parse(idParams, req.params);
    const body = parse(assignBody, req.body);
    const current = await db.query.mailDomains.findFirst({ where: eq(mailDomains.id, id) });
    if (!current) throw notFound('Mail domain');
    const target = body.orgId ? await assignmentTarget(db, body.orgId, MAIL_MODULE, body.enableModule) : null;
    await db.transaction(async (tx) => {
      if (target?.enable) {
        await tx
          .update(organizations)
          .set({ modules: normalizeModules([...target.org.modules, MAIL_MODULE]) })
          .where(eq(organizations.id, target.org.id));
      }
      // No billing link for mail domains yet, so no service can block the move.
      await tx.update(mailDomains).set({ orgId: body.orgId }).where(eq(mailDomains.id, id));
    });
    await audit.record(req, {
      action: body.orgId ? 'mail.domain_assign' : 'mail.domain_unassign',
      orgId: body.orgId ?? current.orgId,
      resourceType: 'mail_domain',
      resourceId: id,
      details: {
        domain: current.name,
        name: current.name,
        orgId: body.orgId,
        previousOrgId: current.orgId,
        moduleEnabled: target?.enable ? MAIL_MODULE : null,
      },
    });
    return mailDomainDto(req, id);
  });
}
