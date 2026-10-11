import { eq, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import {
  ALL_PERMISSIONS,
  MAIL_MIB,
  MAIL_PASSWORD_MAX,
  MAIL_PASSWORD_MIN,
  mailDomainAscii,
  mailPasswordIssues,
  resourcePath,
  type MailDomainDto,
  type MailDomainInfo,
  type MailLimitDetails,
  type MailPasswordIssue,
  type MailPasswordPolicy,
  type ModuleKey,
  type Permission,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import { requireAuth, type Scope } from '../../auth/access';
import type { DbOrTx, Tx } from '../../db/client';
import {
  mailDomains,
  organizations,
  providerConnections,
  type MailDomain,
  type Organization,
  type ProviderConnection,
} from '../../db/schema';
import { AppError, badRequest, conflict, notFound, unsupported } from '../../lib/errors';
import type { ProviderAdapter, RemoteMailDomain } from '../../providers/types';
import { generateCloudPassword } from '../cloud/service';

/**
 * E-mail (module "mail"): mail domains on Mailcow servers, sold with limits.
 *
 * Only the mail domains are stored (synced like domains). Mailboxes and aliases are read live
 * through the adapter of the domain's own connection, never written to the database, and so
 * are passwords. Mailcow enforces the limits; the panel checks them first for clear answers
 * and creates mailboxes and aliases of one domain one at a time (see lockMailDomain), because
 * Mailcow's own count check and insert are not atomic.
 */

export const MAIL_PERMISSIONS = ALL_PERMISSIONS.filter((p) => p.startsWith('mail:'));
export const MAIL_MODULE = 'mail' as const satisfies ModuleKey;

/** Methods an adapter needs to serve the customer pages. */
const MAIL_METHODS = [
  'listMailDomains',
  'getMailDomain',
  'listMailboxes',
  'getMailbox',
  'createMailbox',
  'updateMailbox',
  'setMailboxPassword',
  'deleteMailbox',
  'listMailAliases',
  'getMailAlias',
  'createMailAlias',
  'updateMailAlias',
  'deleteMailAlias',
  'getDkim',
  'mailClientSettings',
] as const satisfies readonly (keyof ProviderAdapter)[];

export function supportsMail(adapter: ProviderAdapter): boolean {
  return MAIL_METHODS.every((m) => typeof adapter[m] === 'function');
}

/** Throws 422 for providers that cannot manage e-mail (anything but Mailcow and demo). */
export function requireMailSupport(adapter: ProviderAdapter): void {
  if (!supportsMail(adapter)) throw unsupported('This provider does not support e-mail');
}

/** Unassigned mail domains have no organization: only platform roles reach them. */
export function mailDomainScope(row: Pick<MailDomain, 'id' | 'orgId'>): Scope {
  return { orgId: row.orgId, resource: { path: resourcePath.mailDomain(row.id) } };
}

export interface MailDomainRow {
  mailDomain: MailDomain;
  org: Organization | null;
  connection: ProviderConnection;
}

export interface LoadedMailDomain extends MailDomainRow {
  scope: Scope;
  adapter: ProviderAdapter;
}

export function mailDomainRowsQuery(ctx: AppContext) {
  return ctx.db
    .select({ mailDomain: mailDomains, org: organizations, connection: providerConnections })
    .from(mailDomains)
    .innerJoin(providerConnections, eq(providerConnections.id, mailDomains.providerConnectionId))
    .leftJoin(organizations, eq(organizations.id, mailDomains.orgId));
}

export async function mailDomainRow(ctx: AppContext, id: string): Promise<MailDomainRow | null> {
  const [row] = await mailDomainRowsQuery(ctx).where(eq(mailDomains.id, id)).limit(1);
  return row ?? null;
}

/** Loads a mail domain and checks that the caller may at least see it (404 otherwise). */
export async function loadMailDomain(
  ctx: AppContext,
  req: FastifyRequest,
  id: string,
): Promise<LoadedMailDomain> {
  requireAuth(req);
  const row = await mailDomainRow(ctx, id);
  if (!row) throw notFound('Mail domain');
  const scope = mailDomainScope(row.mailDomain);
  if (!(await ctx.access.can(req, 'mail:read', scope))) throw notFound('Mail domain');
  return { ...row, scope, adapter: ctx.providers.forConnection(row.connection) };
}

export async function toMailDomainDto(
  ctx: AppContext,
  req: FastifyRequest,
  row: MailDomainRow,
): Promise<MailDomainDto> {
  const { mailDomain, org, connection } = row;
  const permissions: Permission[] = await ctx.access.allowed(
    req,
    MAIL_PERMISSIONS,
    mailDomainScope(mailDomain),
  );
  return {
    id: mailDomain.id,
    name: mailDomain.name,
    asciiName: mailDomain.externalId,
    active: mailDomain.active,
    relay: mailDomain.info?.relay ?? false,
    provider: { id: connection.id, type: connection.type, name: connection.name },
    location: connection.location,
    org: org ? { id: org.id, name: org.name, slug: org.slug } : null,
    limits: mailDomain.info?.limits ?? null,
    usage: mailDomain.info?.usage ?? null,
    permissions,
    lastSyncedAt: mailDomain.lastSyncedAt?.toISOString() ?? null,
    missingSince: mailDomain.missingSince?.toISOString() ?? null,
    createdAt: mailDomain.createdAt.toISOString(),
  };
}

// --- Limits ---------------------------------------------------------------------------

/** Serializes limit checks and creations of one mail domain until the transaction ends. */
export async function lockMailDomain(tx: Tx, mailDomainId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`mail:${mailDomainId}`}, 0))`);
}

/** 409 of the panel's own limit checks; `details` says which limit (MailLimitDetails). */
export const mailLimit = (message: string, details: MailLimitDetails) =>
  new AppError(409, 'mail_limit', message, details);

/** "10 GB" / "512 MB" for messages (binary units, like the UI). */
export function formatMailSize(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (Math.abs(gb) >= 1) return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
  const mb = bytes / MAIL_MIB;
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

/** 409 mail_limit "mailboxes" when the domain has as many mailboxes as it may. */
export function assertMailboxSlot(info: MailDomainInfo): void {
  const { maxMailboxes } = info.limits;
  const used = info.usage.mailboxes;
  if (used >= maxMailboxes) {
    throw mailLimit(`This mail domain may have at most ${maxMailboxes} mailboxes (${used} exist)`, {
      limit: 'mailboxes',
      max: maxMailboxes,
      used,
    });
  }
}

/**
 * 409 mail_limit "mailboxSize" when a mailbox would be larger than the domain allows, or
 * "storage" when the domain's storage cannot take it (`currentBytes`: what the mailbox has
 * now, when it is changed rather than created).
 */
export function assertMailboxFits(info: MailDomainInfo, nextBytes: number, currentBytes = 0): void {
  const { maxMailboxQuotaBytes, quotaBytes } = info.limits;
  if (nextBytes > maxMailboxQuotaBytes) {
    throw mailLimit(`A mailbox of this domain may have at most ${formatMailSize(maxMailboxQuotaBytes)}`, {
      limit: 'mailboxSize',
      max: maxMailboxQuotaBytes,
      used: nextBytes,
    });
  }
  const allocated = info.usage.allocatedBytes;
  if (allocated - currentBytes + nextBytes > quotaBytes) {
    const free = Math.max(quotaBytes - (allocated - currentBytes), 0);
    throw mailLimit(
      `Only ${formatMailSize(free)} of the domain's ${formatMailSize(quotaBytes)} are left for this mailbox`,
      { limit: 'storage', max: quotaBytes, used: allocated },
    );
  }
}

/** 409 mail_limit "aliases" when the domain has as many aliases as it may. */
export function assertAliasSlot(info: MailDomainInfo): void {
  const { maxAliases } = info.limits;
  const used = info.usage.aliases;
  if (used >= maxAliases) {
    throw mailLimit(`This mail domain may have at most ${maxAliases} forwarding addresses (${used} exist)`, {
      limit: 'aliases',
      max: maxAliases,
      used,
    });
  }
}

/** Relay (backup MX) domains pass mail on; the panel creates nothing there. */
export function assertNotRelay(info: MailDomainInfo | null): void {
  if (info?.relay) throw conflict('Relay domains have no mailboxes or aliases in the panel');
}

// --- Passwords ------------------------------------------------------------------------

/** A random password that satisfies any policy: at least 20 characters, every class. */
export function generateMailPassword(policy: MailPasswordPolicy | null): string {
  return generateCloudPassword(Math.min(Math.max(20, policy?.minLength ?? 0), MAIL_PASSWORD_MAX));
}

const PASSWORD_ISSUES: Record<MailPasswordIssue, (policy: MailPasswordPolicy | null) => string> = {
  length: (p) => `at least ${Math.max(MAIL_PASSWORD_MIN, p?.minLength ?? 0)} characters`,
  tooLong: () => `at most ${MAIL_PASSWORD_MAX} characters`,
  characters: () => 'only letters, digits and printable ASCII symbols, no spaces',
  letters: () => 'a letter',
  mixedCase: () => 'upper and lower case letters',
  digits: () => 'a digit',
  specialChars: () => 'a special character',
};

/**
 * 400 "Validation failed" unless the password meets the panel's rules and Mailcow's policy.
 * The one entry of `details` names the field, says what is missing and lists the issue keys
 * (`issues`, see MailPasswordIssue) for the console's checklist.
 */
export function assertMailPassword(
  password: string,
  policy: MailPasswordPolicy | null,
  path = 'password',
): void {
  const issues = mailPasswordIssues(password, policy);
  if (issues.length === 0) return;
  throw badRequest('Validation failed', [
    {
      path,
      message: `The password needs ${issues.map((issue) => PASSWORD_ISSUES[issue](policy)).join(', ')}`,
      issues,
    },
  ]);
}

// --- Addresses ------------------------------------------------------------------------

/** Local parts Mailcow may hold (mailboxes created outside the panel included). */
const LOCAL_PART = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}$/;

/** "<local>@<ascii>" of this mail domain, lower-cased; 404 "Mailbox not found" for anything else. */
export function mailboxAddress(loaded: LoadedMailDomain, raw: string): string {
  const value = raw.trim().toLowerCase();
  const at = value.lastIndexOf('@');
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const ascii = loaded.mailDomain.externalId;
  if (at < 1 || !LOCAL_PART.test(local) || (domain !== ascii && mailDomainAscii(domain) !== ascii)) {
    throw notFound('Mailbox');
  }
  return `${local}@${ascii}`;
}

/** The ASCII domain of an alias address ("@d" or "x@d"). */
export function aliasDomain(address: string): string {
  return address.slice(address.lastIndexOf('@') + 1).toLowerCase();
}

/** Writes Mailcow's facts to the row: info, name, active, lastSyncedAt = now, missingSince = null. */
export async function storeMailDomainInfo(db: DbOrTx, id: string, remote: RemoteMailDomain): Promise<void> {
  await db
    .update(mailDomains)
    .set({
      info: remote.info,
      name: remote.info.displayName,
      active: remote.info.active,
      lastSyncedAt: new Date(),
      missingSince: null,
    })
    .where(eq(mailDomains.id, id));
}
