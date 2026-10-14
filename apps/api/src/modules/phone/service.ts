import { eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import {
  ALL_PERMISSIONS,
  phoneSystemHealth,
  resourcePath,
  type ModuleKey,
  type Permission,
  type PhoneCapability,
  type PhoneRingGroup,
  type PhoneSystemDto,
  type PhoneSystemInfo,
  type PhoneTrunk,
  type PhoneUser,
  type PhoneUserDto,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import { platformScope, requireAuth, type Scope } from '../../auth/access';
import type { DbOrTx } from '../../db/client';
import {
  organizations,
  phoneSystems,
  providerConnections,
  type Organization,
  type PhoneSystem,
  type ProviderConnection,
} from '../../db/schema';
import { AppError, notFound, unsupported } from '../../lib/errors';
import type { ProviderAdapter, RemotePhoneSystem } from '../../providers/types';

/**
 * Telephony (module "phone"): phone systems (3CX PBXs) of a provider connection.
 *
 * Only the phone systems are stored (synced like domains, with their facts and health). Users,
 * ring groups and trunks are read live through the adapter of the system's own connection, which
 * caches them for a few seconds, and never written to the database. The panel never reads or
 * sets a password or PIN of the PBX.
 */

export const PHONE_PERMISSIONS = ALL_PERMISSIONS.filter((p) => p.startsWith('phone:'));
export const PHONE_MODULE = 'phone' as const satisfies ModuleKey;

/** Methods an adapter needs before the panel treats it as a phone provider at all. */
const PHONE_METHODS = [
  'listPhoneSystems',
  'getPhoneSystem',
] as const satisfies readonly (keyof ProviderAdapter)[];

export interface PhoneSystemRow {
  system: PhoneSystem;
  org: Organization | null;
  connection: ProviderConnection;
}

export interface LoadedPhoneSystem extends PhoneSystemRow {
  scope: Scope;
  adapter: ProviderAdapter;
}

/** Unassigned phone systems have no organization: only platform roles reach them. */
export function phoneSystemScope(system: Pick<PhoneSystem, 'id' | 'orgId'>): Scope {
  return { orgId: system.orgId, resource: { path: resourcePath.phoneSystem(system.id) } };
}

export function phoneSystemRowsQuery(ctx: AppContext) {
  return ctx.db
    .select({ system: phoneSystems, org: organizations, connection: providerConnections })
    .from(phoneSystems)
    .innerJoin(providerConnections, eq(providerConnections.id, phoneSystems.providerConnectionId))
    .leftJoin(organizations, eq(organizations.id, phoneSystems.orgId));
}

export async function phoneSystemRow(ctx: AppContext, id: string): Promise<PhoneSystemRow | null> {
  const [row] = await phoneSystemRowsQuery(ctx).where(eq(phoneSystems.id, id)).limit(1);
  return row ?? null;
}

/** Loads a phone system and checks that the caller may at least see it (404 otherwise). */
export async function loadPhoneSystem(
  ctx: AppContext,
  req: FastifyRequest,
  id: string,
): Promise<LoadedPhoneSystem> {
  requireAuth(req);
  const row = await phoneSystemRow(ctx, id);
  if (!row) throw notFound('Phone system');
  const scope = phoneSystemScope(row.system);
  if (!(await ctx.access.can(req, 'phone:read', scope))) throw notFound('Phone system');
  return { ...row, scope, adapter: ctx.providers.forConnection(row.connection) };
}

export function supportsPhone(adapter: ProviderAdapter): boolean {
  return PHONE_METHODS.every((m) => typeof adapter[m] === 'function');
}

const has = (adapter: ProviderAdapter, ...methods: (keyof ProviderAdapter)[]) =>
  methods.every((m) => typeof adapter[m] === 'function');

/** What a provider can do with its phone systems, from the methods it implements. */
export function phoneCapabilities(adapter: ProviderAdapter): PhoneCapability[] {
  if (!supportsPhone(adapter)) return [];
  const capabilities: PhoneCapability[] = [];
  if (
    has(adapter, 'listPhoneUsers', 'getPhoneUser', 'createPhoneUser', 'updatePhoneUser', 'deletePhoneUser')
  ) {
    capabilities.push('users');
  }
  if (has(adapter, 'nextPhoneNumber')) capabilities.push('nextNumber');
  if (has(adapter, 'sendPhoneWelcome')) capabilities.push('welcomeMail');
  if (has(adapter, 'listPhoneRingGroups')) capabilities.push('ringGroups');
  if (has(adapter, 'addPhoneRingGroupMember', 'removePhoneRingGroupMember')) {
    capabilities.push('ringGroupMembers');
  }
  if (has(adapter, 'listPhoneTrunks')) capabilities.push('trunks');
  return capabilities;
}

const CAPABILITY_LABELS: Record<PhoneCapability, string> = {
  users: 'phone users',
  nextNumber: 'proposing extension numbers',
  welcomeMail: 'welcome e-mails',
  ringGroups: 'ring groups',
  ringGroupMembers: 'ring group changes',
  trunks: 'trunks',
};

/** 422 unless the adapter has `method` and announces the capability, which is what the UI goes by. */
export function requirePhoneCapability(
  adapter: ProviderAdapter,
  capability: PhoneCapability,
  method: keyof ProviderAdapter,
): void {
  if (typeof adapter[method] !== 'function' || !phoneCapabilities(adapter).includes(capability)) {
    throw unsupported(`This phone system does not support ${CAPABILITY_LABELS[capability]}`);
  }
}

/** The facts a caller may see: the vendor's product code is for platform staff only. */
async function visibleInfo(
  ctx: AppContext,
  req: FastifyRequest,
  info: PhoneSystemInfo | null,
): Promise<PhoneSystemInfo | null> {
  if (!info) return null;
  if (await ctx.access.can(req, 'platform:provider:read', platformScope)) return { ...info };
  return { ...info, productCode: null };
}

export async function toPhoneSystemDto(
  ctx: AppContext,
  req: FastifyRequest,
  row: PhoneSystemRow,
): Promise<PhoneSystemDto> {
  const { system, org, connection } = row;
  const permissions: Permission[] = await ctx.access.allowed(
    req,
    PHONE_PERMISSIONS,
    phoneSystemScope(system),
  );
  const webClientUrl = system.info?.webClientUrl ?? null;
  return {
    id: system.id,
    name: system.name,
    provider: { id: connection.id, type: connection.type, name: connection.name },
    location: connection.location,
    org: org ? { id: org.id, name: org.name, slug: org.slug } : null,
    status: system.status,
    statusReasons: system.statusReasons,
    info: await visibleInfo(ctx, req, system.info),
    webClientUrl: webClientUrl?.startsWith('https://') ? webClientUrl : null,
    capabilities: phoneCapabilities(ctx.providers.forConnection(connection)),
    permissions,
    lastSyncedAt: system.lastSyncedAt?.toISOString() ?? null,
    missingSince: system.missingSince?.toISOString() ?? null,
    createdAt: system.createdAt.toISOString(),
  };
}

/**
 * Administrators and system users are protected: only weblion staff delete them or change their
 * e-mail address. So is a user whose role the PBX did not report (3CX without the nested role
 * $expand): it may be an administrator.
 */
export function isProtectedPhoneUser(user: Pick<PhoneUser, 'admin' | 'system' | 'role'>): boolean {
  return user.admin || user.system || user.role === null;
}

/** A user as the API answers it, field by field, so nothing an adapter might carry along leaves. */
export function toPhoneUserDto(user: PhoneUser): PhoneUserDto {
  return {
    id: user.id,
    number: user.number,
    firstName: user.firstName,
    lastName: user.lastName,
    displayName: user.displayName,
    email: user.email,
    mobile: user.mobile,
    outboundCallerId: user.outboundCallerId,
    language: user.language,
    enabled: user.enabled,
    registered: user.registered,
    role: user.role,
    admin: user.admin,
    system: user.system,
    protected: isProtectedPhoneUser(user),
  };
}

export function toPhoneRingGroup(group: PhoneRingGroup): PhoneRingGroup {
  return {
    id: group.id,
    number: group.number,
    name: group.name,
    strategy: group.strategy,
    ringTimeSeconds: group.ringTimeSeconds,
    members: group.members.map((m) => ({ number: m.number, name: m.name })),
  };
}

export function toPhoneTrunk(trunk: PhoneTrunk): PhoneTrunk {
  return {
    id: trunk.id,
    number: trunk.number,
    name: trunk.name,
    host: trunk.host,
    online: trunk.online,
    direction: trunk.direction,
    externalNumber: trunk.externalNumber,
    simultaneousCalls: trunk.simultaneousCalls,
    didCount: trunk.didCount,
    configurationIssue: trunk.configurationIssue,
  };
}

/**
 * Writes provider facts and their health into the row (sync, live refresh). A phone system the
 * provider cannot reach right now (`reachable: false`) keeps its stored facts; only its health
 * changes, judged on those facts. The name follows the provider's name until it is renamed in
 * the panel (same rule as servers). The organization is never touched.
 */
export async function storePhoneSystem(
  db: DbOrTx,
  rowId: string,
  remote: RemotePhoneSystem,
  now: Date,
): Promise<PhoneSystem> {
  if (remote.reachable === false) {
    const [stored] = await db
      .select({ info: phoneSystems.info })
      .from(phoneSystems)
      .where(eq(phoneSystems.id, rowId))
      .limit(1);
    if (!stored) throw notFound('Phone system');
    const health = phoneSystemHealth(stored.info, false, now);
    const [updated] = await db
      .update(phoneSystems)
      .set({ status: health.status, statusReasons: health.reasons, missingSince: null })
      .where(eq(phoneSystems.id, rowId))
      .returning();
    if (!updated) throw notFound('Phone system');
    return updated;
  }
  const health = phoneSystemHealth(remote.info, true, now);
  const [updated] = await db
    .update(phoneSystems)
    .set({
      name: sql`case when ${phoneSystems.name} = ${phoneSystems.providerName} then ${remote.name}::text else ${phoneSystems.name} end`,
      providerName: remote.name,
      fqdn: remote.info.fqdn,
      info: remote.info,
      status: health.status,
      statusReasons: health.reasons,
      lastSyncedAt: now,
      missingSince: null,
    })
    .where(eq(phoneSystems.id, rowId))
    .returning();
  if (!updated) throw notFound('Phone system');
  return updated;
}

/**
 * Best effort live refresh after a write (user count), so lists show it before the next sync.
 * Failures are logged, never thrown; an unreachable answer is left to the sync.
 */
export async function refreshPhoneSystem(
  ctx: AppContext,
  loaded: LoadedPhoneSystem,
  log: FastifyBaseLogger,
): Promise<void> {
  if (!loaded.adapter.getPhoneSystem) return;
  try {
    const remote = await loaded.adapter.getPhoneSystem(loaded.system.externalId);
    if (remote.reachable === false) return;
    loaded.system = await storePhoneSystem(ctx.db, loaded.system.id, remote, new Date());
  } catch (err) {
    log.warn({ err, phoneSystemId: loaded.system.id }, 'phone system refresh failed');
  }
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Runs a change at the PBX and audits it, failures included (like domainChange). No database
 * transaction is held while the PBX is called. `successDetails` adds what only the result knows
 * (the number the PBX assigned) to the success entry.
 */
export async function phoneChange<T>(
  ctx: AppContext,
  req: FastifyRequest,
  loaded: LoadedPhoneSystem,
  action: string,
  details: Record<string, unknown>,
  fn: () => Promise<T>,
  successDetails?: (result: T) => Record<string, unknown>,
): Promise<T> {
  const entry = {
    action: `phone.${action}`,
    orgId: loaded.system.orgId,
    resourceType: 'phone_system',
    resourceId: loaded.system.id,
  };
  let result: T;
  try {
    result = await fn();
  } catch (err) {
    await ctx.audit.record(req, {
      ...entry,
      status: 'failure',
      details: { phoneSystem: loaded.system.name, ...details, error: errorMessage(err) },
    });
    throw err instanceof AppError ? err : new AppError(500, 'action_failed', errorMessage(err));
  }
  await ctx.audit.record(req, {
    ...entry,
    details: { phoneSystem: loaded.system.name, ...details, ...(successDetails?.(result) ?? {}) },
  });
  return result;
}
