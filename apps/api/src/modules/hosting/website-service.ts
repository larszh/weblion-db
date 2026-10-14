import { randomInt } from 'node:crypto';
import { domainToUnicode } from 'node:url';
import { and, count, eq, inArray, isNotNull, isNull, lt, ne, notInArray, sql, type SQL } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import {
  normalizeModules,
  wwwCounterpart,
  type Permission,
  type WebsiteAccess,
  type WebsiteDatabaseDto,
  type WebspaceDetailDto,
  type WebspaceInfo,
  type WebspaceStatus,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import type { DbOrTx, Tx } from '../../db/client';
import {
  domains,
  organizations,
  providerConnections,
  services,
  webspaceDatabases,
  webspaces,
  websiteAllowances,
  type Organization,
  type Webspace,
  type WebspaceDatabase,
} from '../../db/schema';
import { AppError, conflict, notFound, unsupported } from '../../lib/errors';
import type { ProviderAdapter, RemoteWebsite } from '../../providers/types';
import { allowanceExceeded, noAllowance } from '../cloud/service';
import { WEBSITE_MODULE, loadWebspace, toWebspaceDto, type LoadedWebspace } from './service';
import { committedDatabases, committedSites, lockWebsiteOrg, websiteCommitments } from './website-allowance';

/**
 * Websites (module "webhosting", CloudPanel): rows of the web space table with kind "website".
 * Loading and state checks, generated passwords, what the server reports stored into the row
 * and its databases, the live detail, and the checks before a website is created or moved.
 * Passwords are never stored: not in the row, its meta, the audit log or a log line.
 */

/** Customers reach the files over SFTP/SSH on this port. */
export const WEBSITE_SSH_PORT = 22;
/** Applications on the server reach their databases here. */
export const WEBSITE_DB_HOST = '127.0.0.1';
export const WEBSITE_DB_PORT = 3306;
/** The detail view reads the site live when the stored facts are older than this. */
const LIVE_AFTER_MS = 60_000;
/**
 * A creation or deletion still unfinished after this long has lost its answer for good (the
 * longest operation waits 330 s): the sync settles it by what the server reports.
 */
export const STALE_CHANGE_MS = 10 * 60_000;

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Display form of an ASCII domain ("xn--mller-kva.ch" gives "müller.ch"). */
export function websiteDisplayName(ascii: string): string {
  return domainToUnicode(ascii) || ascii;
}

/** Loads a website the caller may see (404 otherwise, also for web spaces), then checks `permission`. */
export async function loadWebsite(
  ctx: AppContext,
  req: FastifyRequest,
  id: string,
  permission?: Permission,
): Promise<LoadedWebspace> {
  const loaded = await loadWebspace(ctx, req, id);
  if (loaded.webspace.kind !== 'website') throw notFound('Website');
  if (permission) await ctx.access.assert(req, permission, loaded.scope);
  return loaded;
}

/**
 * 409 unless the website (or database) can be changed now: not while it is being created or
 * deleted, not while the outcome of its last change is unknown, not while the server misses it.
 */
export function requireActive(
  row: Pick<Webspace | WebspaceDatabase, 'status' | 'missingSince'>,
  options: { allowError?: boolean; allowMissing?: boolean; what?: string } = {},
): void {
  const what = options.what ?? 'website';
  if (row.status === 'creating' || row.status === 'deleting') {
    throw new AppError(409, 'website_busy', `This ${what} is being created or deleted`);
  }
  if (row.status === 'error' && !options.allowError) {
    throw new AppError(
      409,
      'website_error',
      `The last change of this ${what} did not finish; the next sync settles it`,
    );
  }
  if (row.missingSince && !options.allowMissing) {
    throw new AppError(409, 'website_missing', `This ${what} is missing on the server`);
  }
}

/** The adapter methods every website route needs. */
export function supportsWebsites(adapter: ProviderAdapter): boolean {
  return (
    typeof adapter.createWebsite === 'function' &&
    typeof adapter.listWebsites === 'function' &&
    typeof adapter.websiteServerOptions === 'function'
  );
}

/** Throws 422 for providers that cannot manage websites (anything but CloudPanel and its demo). */
export function requireWebsiteSupport(adapter: ProviderAdapter): void {
  if (!supportsWebsites(adapter)) throw unsupported('This provider does not support websites');
}

// --- Passwords ------------------------------------------------------------------------

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const ALPHABET = UPPER + LOWER + DIGITS;

const pick = (chars: string) => chars[randomInt(chars.length)]!;

/**
 * A password for a site user or database user: 24 characters without look-alikes (no I, l,
 * O, 0, 1) and without symbols, so it is easy to type into SFTP clients and config files
 * (still about 140 bits). At least one upper-case letter, lower-case letter and digit. Shown
 * once, never logged or stored.
 */
export function generateWebsitePassword(length = 24): string {
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS)];
  while (chars.length < length) chars.push(pick(ALPHABET));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

// --- Server facts into rows -------------------------------------------------------------

/** Stored facts of a website: the site in info.site, the web space fields it has. */
export function toWebspaceInfo(remote: RemoteWebsite, ipAddress: string | null): WebspaceInfo {
  return {
    name: remote.domain,
    resources: {
      domains: null,
      subdomains: null,
      emails: null,
      databases: remote.databases.length,
      storageMb: null,
      trafficGb: null,
      memoryLimitMb: null,
      ipAddress,
    },
    panelUrl: null,
    username: remote.facts.siteUser,
    email: null,
    expiresAt: null,
    site: remote.facts,
  };
}

/** First IPv4 address of the server for info.resources, null when it cannot be asked. */
export async function websiteServerAddress(adapter: ProviderAdapter): Promise<string | null> {
  if (!adapter.websiteServerOptions) return null;
  const options = await adapter.websiteServerOptions().catch(() => null);
  return options?.ipv4[0] ?? null;
}

/**
 * Stores the databases the server reports for a website: listed ones become active (with
 * their first user and size), unlisted active ones are marked missing, placeholders whose
 * creation never showed up are removed after STALE_CHANGE_MS. Rows changed or created after
 * `since` (when the server was asked) keep their fresher state. Returns the listed count.
 */
export async function syncWebsiteDatabases(
  db: DbOrTx,
  webspaceId: string,
  connectionId: string,
  remote: RemoteWebsite,
  since: Date,
): Promise<number> {
  const now = new Date();
  for (const database of remote.databases) {
    await db
      .insert(webspaceDatabases)
      .values({
        webspaceId,
        providerConnectionId: connectionId,
        name: database.name,
        userName: database.users[0] ?? null,
        status: 'active',
        sizeBytes: database.sizeBytes,
        lastSyncedAt: now,
      })
      .onConflictDoUpdate({
        target: [webspaceDatabases.providerConnectionId, webspaceDatabases.name],
        set: {
          // MySQL names are per server: the database belongs to the site that reports it.
          webspaceId,
          userName: sql`coalesce(excluded.user_name, ${webspaceDatabases.userName})`,
          status: 'active',
          sizeBytes: sql`excluded.size_bytes`,
          lastSyncedAt: now,
          missingSince: null,
        },
        setWhere: and(lt(webspaceDatabases.updatedAt, since), ne(webspaceDatabases.status, 'deleting')),
      });
  }
  const names = remote.databases.map((d) => d.name);
  const unlisted = and(
    eq(webspaceDatabases.webspaceId, webspaceId),
    names.length > 0 ? notInArray(webspaceDatabases.name, names) : undefined,
  );
  // Rows a route changed after the server was asked (e.g. a database it just created) stay.
  const unchanged = lt(webspaceDatabases.updatedAt, since);
  await db
    .update(webspaceDatabases)
    .set({ missingSince: sql`coalesce(${webspaceDatabases.missingSince}, now())` })
    .where(and(unlisted, unchanged, eq(webspaceDatabases.status, 'active')));
  await db
    .delete(webspaceDatabases)
    .where(
      and(
        unlisted,
        unchanged,
        inArray(webspaceDatabases.status, ['creating', 'error']),
        lt(webspaceDatabases.createdAt, new Date(since.getTime() - STALE_CHANGE_MS)),
      ),
    );
  return names.length;
}

/**
 * Stores what the server reports for a website (after a change, a live read or the sync):
 * facts, name, sync time, `status` when given (becoming active drops `meta.lastError`;
 * `credentialsPending` marks that nobody saw a password), and its databases (see
 * syncWebsiteDatabases). The server address stays as stored unless `ipAddress` is given.
 * With `where` only a row matching it is changed. Returns the stored row, null when nothing
 * matched (the row is gone, or `where` did not match).
 */
export async function applyRemoteWebsite(
  db: DbOrTx,
  row: Pick<Webspace, 'id' | 'providerConnectionId' | 'info'>,
  remote: RemoteWebsite,
  opts: {
    since: Date;
    ipAddress?: string | null;
    status?: WebspaceStatus;
    credentialsPending?: boolean;
    where?: SQL;
  },
): Promise<Webspace | null> {
  const ipAddress = opts.ipAddress !== undefined ? opts.ipAddress : (row.info?.resources.ipAddress ?? null);
  let meta: SQL | undefined;
  if (opts.status === 'active') meta = sql`${webspaces.meta} - 'lastError'`;
  if (opts.credentialsPending) {
    meta = sql`${meta ?? webspaces.meta} || '{"credentialsDelivered": false}'::jsonb`;
  }
  const [updated] = await db
    .update(webspaces)
    .set({
      info: toWebspaceInfo(remote, ipAddress),
      name: websiteDisplayName(remote.domain),
      lastSyncedAt: new Date(),
      missingSince: null,
      ...(opts.status ? { status: opts.status } : {}),
      ...(meta ? { meta } : {}),
    })
    .where(and(eq(webspaces.id, row.id), opts.where))
    .returning();
  if (!updated) return null;
  await syncWebsiteDatabases(db, row.id, row.providerConnectionId, remote, opts.since);
  return updated;
}

// --- Detail -------------------------------------------------------------------------------

/** How customers reach the files; null without site facts or a provider that knows the host. */
export function websiteAccess(row: Pick<Webspace, 'info'>, adapter: ProviderAdapter): WebsiteAccess | null {
  const site = row.info?.site;
  if (!site || typeof adapter.websiteAccessHost !== 'function') return null;
  return {
    host: adapter.websiteAccessHost(),
    port: WEBSITE_SSH_PORT,
    username: site.siteUser,
    homeDirectory: site.homeDirectory,
    webRoot: site.webRoot,
  };
}

export function toDatabaseDto(row: WebspaceDatabase): WebsiteDatabaseDto {
  return {
    id: row.id,
    name: row.name,
    userName: row.userName,
    status: row.status,
    sizeBytes: row.sizeBytes,
    host: WEBSITE_DB_HOST,
    port: WEBSITE_DB_PORT,
    createdAt: row.createdAt.toISOString(),
    missingSince: row.missingSince?.toISOString() ?? null,
  };
}

/** The databases of a website, ordered by name. */
export async function websiteDatabaseRows(db: DbOrTx, webspaceId: string): Promise<WebspaceDatabase[]> {
  return db
    .select()
    .from(webspaceDatabases)
    .where(eq(webspaceDatabases.webspaceId, webspaceId))
    .orderBy(webspaceDatabases.name);
}

/**
 * GET /webspaces/:id for a row of kind "website". Facts older than a minute are read live
 * (an active website on a provider that can) and stored; a failed read shows the stored facts
 * with `liveError`.
 */
export async function websiteDetail(
  ctx: AppContext,
  req: FastifyRequest,
  loaded: LoadedWebspace,
): Promise<WebspaceDetailDto> {
  const { adapter } = loaded;
  let liveError: string | null = null;
  const synced = loaded.webspace.lastSyncedAt?.getTime() ?? 0;
  if (
    loaded.webspace.status === 'active' &&
    Date.now() - synced > LIVE_AFTER_MS &&
    typeof adapter.getWebsite === 'function'
  ) {
    try {
      const since = new Date();
      const remote = await adapter.getWebsite(loaded.webspace.externalId);
      // Not over a change that started meanwhile (it sets its own status).
      const stored = await applyRemoteWebsite(ctx.db, loaded.webspace, remote, {
        since,
        where: eq(webspaces.status, 'active'),
      });
      if (stored) loaded.webspace = stored;
    } catch (err) {
      req.log.warn({ err, webspaceId: loaded.webspace.id }, 'live website info failed');
      liveError = errorMessage(err);
    }
  }
  const databases = await websiteDatabaseRows(ctx.db, loaded.webspace.id);
  return {
    ...(await toWebspaceDto(ctx, req, loaded)),
    info: loaded.webspace.info,
    liveError,
    access: websiteAccess(loaded.webspace, adapter),
    databases: databases.map(toDatabaseDto),
  };
}

// --- Checks -------------------------------------------------------------------------------

/**
 * Called by the reseller move inside its transaction before a web space changes hands. Web
 * spaces (kind "webspace") always pass; a website must fit the target's website allowance on
 * the website's instance. Locks the target (lockWebsiteOrg) until the transaction ends.
 */
export async function assertWebsiteMoveAllowed(
  tx: Tx,
  webspaceId: string,
  to: Pick<Organization, 'id' | 'parentOrgId' | 'kind'>,
): Promise<void> {
  const row = await tx.query.webspaces.findFirst({
    where: eq(webspaces.id, webspaceId),
    columns: { id: true, kind: true, name: true, providerConnectionId: true },
  });
  if (!row || row.kind !== 'website') return;
  await lockWebsiteOrg(tx, to);
  const allowance = await tx.query.websiteAllowances.findFirst({ where: eq(websiteAllowances.orgId, to.id) });
  if (!allowance) throw noAllowance('The customer has no website allowance');
  if (allowance.providerConnectionId !== row.providerConnectionId) {
    throw conflict(`The website allowance of the customer is on another instance than ${row.name}`);
  }
  const [databases] = await tx
    .select({ n: count() })
    .from(webspaceDatabases)
    .where(eq(webspaceDatabases.webspaceId, row.id));
  const usage = await websiteCommitments(tx, to, allowance.providerConnectionId);
  if (committedSites(usage) + 1 > allowance.maxSites) {
    throw allowanceExceeded(
      `The website allowance of the customer has room for ${Math.max(allowance.maxSites - committedSites(usage), 0)} more websites`,
      { maxSites: allowance.maxSites, sites: committedSites(usage) },
    );
  }
  const moving = databases?.n ?? 0;
  if (committedDatabases(usage) + moving > allowance.maxDatabases) {
    throw allowanceExceeded(
      `The website has ${moving} databases; the allowance of the customer has room for ${Math.max(allowance.maxDatabases - committedDatabases(usage), 0)} more`,
      { maxDatabases: allowance.maxDatabases, databases: committedDatabases(usage) },
    );
  }
}

const domainTaken = (message: string) => new AppError(409, 'exists', message, { field: 'domain' });

/**
 * 409 (code "exists", field "domain") unless a new website for `ascii` may be created on
 * `connectionId`: no other website serves the domain or its www counterpart on any instance
 * (CloudPanel answers both names for one site), no website row of it waits as missing on this
 * instance, and, with a target organization, the DNS module holds neither name for another
 * organization (the target's reseller may hold it).
 */
export async function assertDomainFree(
  db: DbOrTx,
  ascii: string,
  connectionId: string,
  target: Pick<Organization, 'id' | 'parentOrgId'> | null,
): Promise<void> {
  const display = websiteDisplayName(ascii);
  const counterpart = wwwCounterpart(ascii);
  const rows = await db
    .select({
      externalId: webspaces.externalId,
      connectionId: webspaces.providerConnectionId,
      missingSince: webspaces.missingSince,
      instance: providerConnections.name,
    })
    .from(webspaces)
    .innerJoin(providerConnections, eq(providerConnections.id, webspaces.providerConnectionId))
    .where(and(eq(webspaces.kind, 'website'), inArray(webspaces.externalId, [ascii, counterpart])));
  const same = rows.find((r) => r.externalId === ascii && !r.missingSince);
  if (same) throw domainTaken(`${display} is already a website on ${same.instance}`);
  const other = rows.find((r) => r.externalId === counterpart && !r.missingSince);
  if (other) {
    throw domainTaken(
      `${websiteDisplayName(counterpart)} is a website on ${other.instance}, and that website serves ${display} as well`,
    );
  }
  const waiting = rows.find((r) => r.externalId === ascii && r.connectionId === connectionId);
  if (waiting) {
    throw domainTaken(
      `${display} is still listed as a missing website on ${waiting.instance}. Staff remove it from the console first.`,
    );
  }
  if (!target) return;
  const names = [...new Set([ascii, counterpart].flatMap((n) => [n, websiteDisplayName(n).toLowerCase()]))];
  const owners = [target.id, ...(target.parentOrgId ? [target.parentOrgId] : [])];
  const [foreign] = await db
    .select({ id: domains.id, name: domains.name })
    .from(domains)
    .where(
      and(
        inArray(sql`lower(${domains.name})`, names),
        isNull(domains.missingSince),
        isNotNull(domains.orgId),
        notInArray(domains.orgId, owners),
      ),
    )
    .limit(1);
  if (foreign) throw domainTaken(`${foreign.name} belongs to another customer in the DNS module`);
}

/** 409 while a billing service that is not cancelled points at the website. */
export async function assertNoActiveService(db: DbOrTx, webspaceId: string): Promise<void> {
  const linked = await db
    .select({ id: services.id, name: services.name })
    .from(services)
    .where(
      and(
        eq(services.resourceType, 'webspace'),
        eq(services.resourceId, webspaceId),
        ne(services.status, 'cancelled'),
      ),
    );
  if (linked.length === 0) return;
  const names = linked.map((s) => `"${s.name}"`).join(', ');
  throw new AppError(
    409,
    'conflict',
    `This website is billed through the service ${names}. Cancel it before deleting the website.`,
    { services: linked },
  );
}

/**
 * Activates the webhosting module of an organization inside the transaction (row lock on the
 * organization, taken before lockWebsiteOrg like the reseller move does). Returns whether it
 * was off.
 */
export async function enableWebsiteModule(tx: Tx, orgId: string): Promise<boolean> {
  const [target] = await tx
    .select({ modules: organizations.modules })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .for('update');
  if (!target || target.modules.includes(WEBSITE_MODULE)) return false;
  await tx
    .update(organizations)
    .set({ modules: normalizeModules([...target.modules, WEBSITE_MODULE]) })
    .where(eq(organizations.id, orgId));
  return true;
}

// --- Outcome of a change at the server --------------------------------------------------

/**
 * True when a failed change certainly left the server as it was: a refusal (status below 500:
 * validation, exists, protected, not managed, version), the server's or console's queue being
 * busy (nothing ran), or a failure the server rolled back. Timeouts, dropped connections and
 * failures without a rollback leave the outcome unknown.
 */
export function changeRefused(err: unknown): boolean {
  if (!(err instanceof AppError)) return false;
  if (err.statusCode < 500 || err.code === 'busy') return true;
  return (err.details as { rolledBack?: unknown } | undefined)?.rolledBack === true;
}

/** The server finished the change or not; the sync settles it. Answered as 502. */
export function outcomeUnknown(message: string, err: unknown): AppError {
  return new AppError(502, 'website_error', message, { rolledBack: false, error: errorMessage(err) });
}

/** The server no longer has the site, or no longer manages it for the console. */
export function siteGone(err: unknown): boolean {
  return err instanceof AppError && (err.statusCode === 404 || err.code === 'not_managed');
}
