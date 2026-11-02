import { and, eq, inArray, isNotNull, isNull, lt, ne, notInArray, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';
import type { DomainInfo, IpAddress } from '@weblion/shared';
import { AuditService } from '../audit';
import type { Database } from '../db/client';
import {
  cloudAccounts,
  domains,
  projects,
  providerConnections,
  serverActions,
  servers,
  webspaces,
  type ProviderConnection,
} from '../db/schema';
import { AppError, isScopeMissing } from '../lib/errors';
import { settlePending } from '../modules/hosting/pending';
import { domainKind } from '../modules/hosting/service';
import { serverRef, type ProviderRegistry } from '../providers/registry';
import type {
  ProviderAdapter,
  RemoteCloudAccount,
  RemoteDomain,
  RemoteServer,
  RemoteWebspace,
} from '../providers/types';
import { syncMailDomains } from './sync-mail';
import { syncMediaAccounts, type MediaSyncCounts } from './sync-media';
import { syncMonitors, type MonitorSyncCounts } from './sync-monitoring';
import { syncPhoneSystems } from './sync-phone';
import { syncWebsites } from './sync-websites';

export interface SyncCounts {
  seen: number;
  missing: number;
  /** Stored rows that took over a changed provider id (adapters with rekeyOnSync), only when > 0. */
  rekeyed?: number;
}

/**
 * Servers on the top level; domains, web spaces, cloud accounts, mail domains, websites, phone
 * systems, streaming accounts and monitors only for providers that have them.
 */
export interface SyncResult extends SyncCounts {
  domains?: SyncCounts;
  webspaces?: SyncCounts;
  /** `seen`: accounts the panel manages that the instance reported. */
  cloudAccounts?: SyncCounts;
  mailDomains?: SyncCounts;
  /** CloudPanel: managed sites; `databases`: their databases. */
  websites?: SyncCounts & { databases: number };
  /** 3CX: the phone system of the connection (the demo has three). */
  phoneSystems?: SyncCounts;
  /** Jellyfin: accounts the console manages; repaired: policies written. */
  mediaAccounts?: MediaSyncCounts;
  /** Uptime Kuma: monitors of the instance; managementError when the management session failed. */
  monitors?: MonitorSyncCounts;
  /**
   * Scopes the provider's access token lacks (24fire): the steps that need them were skipped and
   * nothing of theirs was marked missing.
   */
  skipped?: string[];
}

/** Postgres advisory lock ids, so only one API instance runs each job at a time. */
const LOCKS = { sync: 742_001, actions: 742_002 } as const;

/** Syncs in a row a partial new server with an ambiguous name is held back for (see rekeyServers). */
const HOLD_PARTIAL_SYNCS = 3;

/**
 * Keeps the server inventory in sync with the providers and finishes tracked actions.
 * Data shown in lists comes from this cache; detail pages refresh live on demand.
 */
export class SyncService {
  private timers: NodeJS.Timeout[] = [];
  /** The sync of each connection that is running now. */
  private running = new Map<string, Promise<SyncResult>>();
  /** At most one follow-up sync per connection, shared by everyone who asked while one was running. */
  private followUps = new Map<string, { connection: ProviderConnection; result: Promise<SyncResult> }>();
  /** For changes the sync makes on its own (zone assignments). */
  private readonly audit: AuditService;
  /** Per connection: the new server ids held back by rekeyServers and for how many syncs in a row. */
  private readonly heldBack = new Map<string, Map<string, number>>();

  constructor(
    private readonly db: Database,
    private readonly pool: pg.Pool,
    private readonly providers: ProviderRegistry,
    private readonly log: FastifyBaseLogger,
  ) {
    this.audit = new AuditService(db, log);
  }

  private async upsert(connection: ProviderConnection, remote: RemoteServer) {
    const now = new Date();
    const current = {
      // Follow provider renames unless the server was renamed in the panel.
      name: sql`case when ${servers.name} = ${servers.providerName} then excluded.provider_name else ${servers.name} end`,
      providerName: sql`excluded.provider_name`,
      status: sql`excluded.status`,
      lastSyncedAt: now,
      missingSince: null,
    };
    await this.db
      .insert(servers)
      .values({
        providerConnectionId: connection.id,
        externalId: remote.externalId,
        name: remote.name,
        providerName: remote.name,
        kind: remote.kind,
        status: remote.status,
        specs: remote.specs,
        usage: remote.usage ?? null,
        ips: remote.ips,
        os: remote.os ?? null,
        node: remote.node ?? null,
        meta: remote.meta ?? {},
        lastSyncedAt: now,
      })
      .onConflictDoUpdate({
        target: [servers.providerConnectionId, servers.externalId],
        // A partial server (a per-server call failed) only knows name, status and some meta: the
        // stored specs, usage, IPs, OS and node stay, the meta is merged.
        set: remote.partial
          ? { ...current, meta: sql`coalesce(${servers.meta}, '{}'::jsonb) || excluded.meta` }
          : {
              ...current,
              kind: sql`excluded.kind`,
              specs: sql`excluded.specs`,
              usage: sql`excluded.usage`,
              ips: sql`excluded.ips`,
              os: sql`coalesce(excluded.os, ${servers.os})`,
              node: sql`excluded.node`,
              meta: sql`excluded.meta`,
            },
      });
  }

  /** Re-keys, stores and marks missing the servers of one listing. */
  private async syncServers(
    connection: ProviderConnection,
    adapter: ProviderAdapter,
    remote: RemoteServer[],
  ): Promise<SyncCounts> {
    // Before the upserts, so the upsert updates the re-keyed row instead of inserting a new one.
    const { rekeyed, held, kept } = adapter.rekeyOnSync?.servers
      ? await this.rekeyServers(connection, remote)
      : { rekeyed: 0, held: new Set<string>(), kept: [] };
    for (const server of remote) {
      if (!held.has(server.externalId)) await this.upsert(connection, server);
    }

    const seenIds = [...remote.map((s) => s.externalId), ...kept];
    const missing = await this.db
      .update(servers)
      .set({ status: 'missing', missingSince: sql`coalesce(${servers.missingSince}, now())` })
      .where(
        and(
          eq(servers.providerConnectionId, connection.id),
          seenIds.length > 0 ? notInArray(servers.externalId, seenIds) : undefined,
        ),
      )
      .returning({ id: servers.id });
    return { seen: remote.length, missing: missing.length, ...(rekeyed > 0 ? { rekeyed } : {}) };
  }

  /**
   * Adopts changed provider ids into the stored rows (24fire: API v1 ids are very likely the v2
   * ids, but that is not verified), so the row id, and with it project, labels, protection, actions
   * and billing references, stays with the server and no duplicate appears.
   *
   * Conservative: only new ids (no row on this connection) and rows that were present at the last
   * sync and are gone now take part, and only one-to-one matches are applied. Pass 1: same
   * provider name and kind, at least one shared IPv4 address, one candidate on both sides. Pass 2,
   * only where one side has no IPv4 (a partial server): same name and kind, unique among the new
   * ids and among the vanished rows that pass 1 left. Anything ambiguous is left alone: the old row
   * goes missing and the new one comes unassigned, as without the step.
   *
   * A new id that is partial (its config failed, so its addresses are unknown) and still has
   * vanished rows of its name left is held back: it is not stored, and those rows are not marked
   * missing (`kept`), so the next sync can match it by name and IPv4. Without that, the re-key
   * would have one chance only: the new row is stored, and the old one is no longer a candidate
   * once it is missing. After HOLD_PARTIAL_SYNCS syncs in a row it is stored as without the step.
   */
  private async rekeyServers(
    connection: ProviderConnection,
    remote: RemoteServer[],
  ): Promise<{ rekeyed: number; held: Set<string>; kept: string[] }> {
    const rows = await this.db
      .select({
        id: servers.id,
        externalId: servers.externalId,
        providerName: servers.providerName,
        kind: servers.kind,
        ips: servers.ips,
        missingSince: servers.missingSince,
        orgId: projects.orgId,
      })
      .from(servers)
      .leftJoin(projects, eq(projects.id, servers.projectId))
      .where(eq(servers.providerConnectionId, connection.id));
    const stored = new Set(rows.map((r) => r.externalId));
    const listed = new Set(remote.map((r) => r.externalId));
    const unknown = remote.filter((r) => !stored.has(r.externalId));
    const orphans = rows.filter((r) => !listed.has(r.externalId) && r.missingSince === null);
    const heldBefore = this.heldBack.get(connection.id);
    this.heldBack.delete(connection.id);
    if (unknown.length === 0 || orphans.length === 0) return { rekeyed: 0, held: new Set(), kept: [] };

    const ipv4 = (ips: IpAddress[]) => new Set(ips.filter((ip) => ip.version === 4).map((ip) => ip.address));
    const shares = (a: Set<string>, b: Set<string>) => [...a].some((address) => b.has(address));
    const sameName = (u: RemoteServer, o: (typeof rows)[number]) =>
      o.providerName !== null && o.providerName === u.name && o.kind === u.kind;
    const byIp = (u: RemoteServer, o: (typeof rows)[number]) =>
      sameName(u, o) && shares(ipv4(u.ips), ipv4(o.ips));

    const matches: { row: (typeof rows)[number]; remote: RemoteServer; matchedBy: 'name+ipv4' | 'name' }[] =
      [];
    for (const u of unknown) {
      const candidates = orphans.filter((o) => byIp(u, o));
      if (candidates.length !== 1) continue;
      const row = candidates[0]!;
      if (unknown.filter((x) => byIp(x, row)).length !== 1) continue;
      matches.push({ row, remote: u, matchedBy: 'name+ipv4' });
    }
    // Pass 2 counts only what pass 1 left: a twin matched by its address no longer makes the
    // name of the other twin ambiguous.
    const byAddress = new Set<unknown>(matches.flatMap((m) => [m.row, m.remote]));
    const leftRows = orphans.filter((o) => !byAddress.has(o));
    const leftUnknown = unknown.filter((u) => !byAddress.has(u));
    for (const u of leftUnknown) {
      const named = leftRows.filter((o) => sameName(u, o));
      if (named.length !== 1) continue;
      if (leftUnknown.filter((x) => x.name === u.name && x.kind === u.kind).length !== 1) continue;
      const row = named[0]!;
      if (matches.some((m) => m.row === row)) continue;
      // Both sides know their IPv4 addresses and share none: two different servers.
      if (ipv4(u.ips).size > 0 && ipv4(row.ips).size > 0) continue;
      matches.push({ row, remote: u, matchedBy: 'name' });
    }

    const held = new Map<string, number>();
    const kept = new Set<string>();
    for (const u of leftUnknown) {
      if (!u.partial || matches.some((m) => m.remote === u)) continue;
      const named = leftRows.filter((o) => sameName(u, o) && !matches.some((m) => m.row === o));
      const syncs = heldBefore?.get(u.externalId) ?? 0;
      if (named.length === 0 || syncs >= HOLD_PARTIAL_SYNCS) continue;
      held.set(u.externalId, syncs + 1);
      for (const o of named) kept.add(o.externalId);
    }
    if (held.size > 0) {
      this.heldBack.set(connection.id, held);
      this.log.info(
        { provider: connection.name, newIds: held.size, vanished: kept.size },
        'new servers held back until their addresses are known',
      );
    }

    let rekeyed = 0;
    for (const { row, remote: server, matchedBy } of matches) {
      const details = { from: row.externalId, to: server.externalId, name: server.name, matchedBy };
      try {
        const updated = await this.db
          .update(servers)
          .set({ externalId: server.externalId })
          .where(
            and(eq(servers.id, row.id), eq(servers.externalId, row.externalId), isNull(servers.missingSince)),
          )
          .returning({ id: servers.id });
        if (updated.length === 0) continue;
      } catch (err) {
        // A parallel sync stored the new id meanwhile: leave both rows as they are.
        this.log.warn(
          { err, provider: connection.name, serverId: row.id, ...details },
          'server re-key failed',
        );
        continue;
      }
      rekeyed++;
      this.log.info({ provider: connection.name, serverId: row.id, ...details }, 'server re-keyed');
      await this.audit.record(null, {
        action: 'server.rekey',
        orgId: row.orgId,
        resourceType: 'server',
        resourceId: row.id,
        actorName: 'Sync',
        details,
      });
    }
    const left = unknown.length - rekeyed - held.size;
    if (left > 0 && orphans.length > rekeyed + kept.size) {
      this.log.info(
        { provider: connection.name, newIds: left, vanished: orphans.length - rekeyed - kept.size },
        'servers not re-keyed: no unambiguous match',
      );
    }
    return { rekeyed, held: new Set(held.keys()), kept: [...kept] };
  }

  /**
   * The same for domains: a new id and a row that vanished since the last sync with the same name
   * (case-insensitive), each the only one of that name. Audited as domain.rekey.
   */
  private async rekeyDomains(connection: ProviderConnection, remote: RemoteDomain[]): Promise<number> {
    const rows = await this.db
      .select({
        id: domains.id,
        externalId: domains.externalId,
        name: domains.name,
        orgId: domains.orgId,
        missingSince: domains.missingSince,
      })
      .from(domains)
      .where(eq(domains.providerConnectionId, connection.id));
    const stored = new Set(rows.map((r) => r.externalId));
    const listed = new Set(remote.map((r) => r.externalId));
    const unknown = remote.filter((r) => !stored.has(r.externalId));
    const orphans = rows.filter((r) => !listed.has(r.externalId) && r.missingSince === null);
    if (unknown.length === 0 || orphans.length === 0) return 0;

    const key = (name: string) => name.trim().toLowerCase().replace(/\.$/, '');
    let rekeyed = 0;
    for (const u of unknown) {
      const name = key(u.name);
      if (!name) continue;
      const candidates = orphans.filter((o) => key(o.name) === name);
      if (candidates.length !== 1 || unknown.filter((x) => key(x.name) === name).length !== 1) continue;
      const row = candidates[0]!;
      const details = { from: row.externalId, to: u.externalId, name: u.name, matchedBy: 'name' };
      try {
        const updated = await this.db
          .update(domains)
          .set({ externalId: u.externalId })
          .where(
            and(eq(domains.id, row.id), eq(domains.externalId, row.externalId), isNull(domains.missingSince)),
          )
          .returning({ id: domains.id });
        if (updated.length === 0) continue;
      } catch (err) {
        this.log.warn(
          { err, provider: connection.name, domainId: row.id, ...details },
          'domain re-key failed',
        );
        continue;
      }
      rekeyed++;
      this.log.info({ provider: connection.name, domainId: row.id, ...details }, 'domain re-keyed');
      await this.audit.record(null, {
        action: 'domain.rekey',
        orgId: row.orgId,
        resourceType: 'domain',
        resourceId: row.id,
        actorName: 'Sync',
        details,
      });
    }
    return rekeyed;
  }

  /**
   * Domains keep their organization (only admins assign them) and never store the auth
   * code: RemoteDomain.info has no field for it. DNS zones seen for the first time follow the
   * registered domain of the same name (see assignNewZone).
   */
  private async syncDomains(connection: ProviderConnection, adapter: ProviderAdapter): Promise<SyncCounts> {
    const remote: RemoteDomain[] = await adapter.listDomains!();
    // Before anything reads the stored ids (zones, pending changes, upserts).
    const rekeyed = adapter.rekeyOnSync?.domains ? await this.rekeyDomains(connection, remote) : 0;
    const now = new Date();
    const zones = domainKind(adapter) === 'zone';
    const known = zones
      ? new Set(
          (
            await this.db
              .select({ externalId: domains.externalId })
              .from(domains)
              .where(eq(domains.providerConnectionId, connection.id))
          ).map((r) => r.externalId),
        )
      : null;
    // Lock and auto-renew changes the registrar has not applied yet: the list does not undo
    // them, and the meta keeps them until it reports them (see settlePending).
    const pendingRows = await this.db
      .select({ externalId: domains.externalId, meta: domains.meta })
      .from(domains)
      .where(
        and(eq(domains.providerConnectionId, connection.id), sql`${domains.meta} -> 'pending' is not null`),
      );
    const pending = new Map(pendingRows.map((r) => [r.externalId, r.meta.pending]));
    for (const domain of remote) {
      const settled = pending.has(domain.externalId)
        ? settlePending(domain.info ?? {}, { ...domain.meta, pending: pending.get(domain.externalId) })
        : null;
      const reported = settled && domain.info ? settled.info : domain.info;
      // Only the fields the provider reported overwrite what is stored (see RemoteDomain.info).
      const known = reported ? knownFields(reported) : null;
      const complete = known ? completeDomainInfo(domain, known) : null;
      await this.db
        .insert(domains)
        .values({
          providerConnectionId: connection.id,
          externalId: domain.externalId,
          name: domain.name,
          status: domain.status,
          info: complete,
          meta: settled?.meta ?? domain.meta ?? {},
          lastSyncedAt: now,
        })
        .onConflictDoUpdate({
          target: [domains.providerConnectionId, domains.externalId],
          set: {
            name: sql`excluded.name`,
            // Like the info fields: a list without the status keeps the stored one.
            status: sql`coalesce(excluded.status, ${domains.status})`,
            info: known
              ? sql`coalesce(${domains.info}, ${JSON.stringify(complete)}::jsonb) || ${JSON.stringify(known)}::jsonb`
              : sql`${domains.info}`,
            meta: sql`excluded.meta`,
            lastSyncedAt: now,
            missingSince: null,
          },
        });
    }
    if (known) {
      for (const zone of remote) {
        if (known.has(zone.externalId)) continue;
        await this.assignNewZone(connection, zone).catch((err) =>
          this.log.warn({ err, provider: connection.name, zone: zone.name }, 'zone assignment failed'),
        );
      }
    }
    const seenIds = remote.map((d) => d.externalId);
    const missing = await this.db
      .update(domains)
      .set({ missingSince: sql`coalesce(${domains.missingSince}, now())` })
      .where(
        and(
          eq(domains.providerConnectionId, connection.id),
          seenIds.length > 0 ? notInArray(domains.externalId, seenIds) : undefined,
        ),
      )
      .returning({ id: domains.id });
    return { seen: remote.length, missing: missing.length, ...(rekeyed > 0 ? { rekeyed } : {}) };
  }

  /**
   * A zone the sync has not seen before goes to the organization of the registered domain of
   * the same name: exactly one organization among the assigned, not missing registrations at
   * other connections. Several organizations: left for staff. Later syncs never re-assign, so
   * a zone staff took away stays unassigned. Modules are not touched.
   */
  private async assignNewZone(connection: ProviderConnection, remote: RemoteDomain): Promise<void> {
    const zone = await this.db.query.domains.findFirst({
      where: and(eq(domains.providerConnectionId, connection.id), eq(domains.externalId, remote.externalId)),
    });
    if (!zone || zone.orgId) return;
    const rows = await this.db
      .select({ id: domains.id, orgId: domains.orgId, connection: providerConnections })
      .from(domains)
      .innerJoin(providerConnections, eq(providerConnections.id, domains.providerConnectionId))
      .where(
        and(
          sql`lower(${domains.name}) = lower(${zone.name})`,
          ne(domains.providerConnectionId, connection.id),
          isNotNull(domains.orgId),
          isNull(domains.missingSince),
        ),
      );
    const registrations = rows.filter(
      (r) => domainKind(this.providers.forConnection(r.connection)) === 'registration',
    );
    const orgIds = [...new Set(registrations.map((r) => r.orgId!))];
    if (orgIds.length === 0) return;
    if (orgIds.length > 1) {
      this.log.warn(
        { provider: connection.name, zone: zone.name, orgIds },
        'zone not assigned: registrations of this name belong to several organizations',
      );
      return;
    }
    const orgId = orgIds[0]!;
    const assigned = await this.db
      .update(domains)
      .set({ orgId })
      .where(and(eq(domains.id, zone.id), isNull(domains.orgId)))
      .returning({ id: domains.id });
    if (assigned.length === 0) return;
    await this.audit.record(null, {
      action: 'domain.assign',
      orgId,
      resourceType: 'domain',
      resourceId: zone.id,
      actorName: 'Sync',
      details: {
        name: zone.name,
        orgId,
        previousOrgId: null,
        reason: 'matching_registration',
        registrationIds: registrations.map((r) => r.id),
        moduleEnabled: null,
      },
    });
  }

  /**
   * Same for web spaces (kind "webspace"; websites of the same table have their own sync). The
   * control panel password is never part of RemoteWebspace.
   */
  private async syncWebspaces(connection: ProviderConnection, adapter: ProviderAdapter): Promise<SyncCounts> {
    const remote: RemoteWebspace[] = await adapter.listWebspaces!();
    const now = new Date();
    for (const webspace of remote) {
      await this.db
        .insert(webspaces)
        .values({
          providerConnectionId: connection.id,
          externalId: webspace.externalId,
          name: webspace.name,
          kind: 'webspace',
          info: webspace.info,
          meta: webspace.meta ?? {},
          lastSyncedAt: now,
        })
        .onConflictDoUpdate({
          target: [webspaces.providerConnectionId, webspaces.externalId],
          set: {
            name: sql`excluded.name`,
            info: sql`coalesce(excluded.info, ${webspaces.info})`,
            meta: sql`excluded.meta`,
            lastSyncedAt: now,
            missingSince: null,
          },
          setWhere: eq(webspaces.kind, 'webspace'),
        });
    }
    const seenIds = remote.map((w) => w.externalId);
    const missing = await this.db
      .update(webspaces)
      .set({ missingSince: sql`coalesce(${webspaces.missingSince}, now())` })
      .where(
        and(
          eq(webspaces.providerConnectionId, connection.id),
          eq(webspaces.kind, 'webspace'),
          seenIds.length > 0 ? notInArray(webspaces.externalId, seenIds) : undefined,
        ),
      )
      .returning({ id: webspaces.id });
    return { seen: remote.length, missing: missing.length };
  }

  /**
   * Usage and settings of the cloud accounts the panel manages. Users the panel does not
   * know are left alone (staff import them from the "unmanaged" list), so no row is created.
   */
  private async syncCloudAccounts(
    connection: ProviderConnection,
    adapter: ProviderAdapter,
  ): Promise<SyncCounts> {
    const started = new Date();
    const remote: RemoteCloudAccount[] = await adapter.listCloudAccounts!();
    const byId = new Map(remote.map((r) => [r.externalId, r]));
    const rows = await this.db
      .select({
        id: cloudAccounts.id,
        externalId: cloudAccounts.externalId,
        createdAt: cloudAccounts.createdAt,
      })
      .from(cloudAccounts)
      .where(eq(cloudAccounts.providerConnectionId, connection.id));
    const now = new Date();
    let seen = 0;
    const missing: string[] = [];
    for (const row of rows) {
      const account = byId.get(row.externalId);
      if (!account) {
        // Created through the panel while the list was on its way: not missing.
        if (row.createdAt < started) missing.push(row.id);
        continue;
      }
      seen++;
      // Neither quota nor usage means Nextcloud could not read the user's storage (an empty
      // quota object), not "unlimited": keep what is stored, or the allowance looks freer.
      const storageUnknown = account.quotaBytes === null && account.usedBytes === null;
      await this.db
        .update(cloudAccounts)
        .set({
          displayName: account.displayName,
          email: account.email,
          ...(storageUnknown ? {} : { quotaBytes: account.quotaBytes, usedBytes: account.usedBytes }),
          enabled: account.enabled,
          lastLoginAt: account.lastLoginAt ? new Date(account.lastLoginAt) : null,
          lastSyncedAt: now,
          missingSince: null,
        })
        // Changed in the panel while the list was on its way (e.g. a raised quota): the list
        // has the old values, which would free room in the allowance. The next run catches up.
        .where(and(eq(cloudAccounts.id, row.id), lt(cloudAccounts.updatedAt, started)));
    }
    if (missing.length > 0) {
      await this.db
        .update(cloudAccounts)
        .set({ missingSince: sql`coalesce(${cloudAccounts.missingSince}, now())` })
        .where(inArray(cloudAccounts.id, missing));
    }
    return { seen, missing: missing.length };
  }

  /**
   * Syncs one connection. While a sync of the same connection is running (the initial sync of a new
   * connection, the timer), the caller gets a follow-up sync that starts when it is done, so the
   * result always covers the provider as it was at the call, never an empty "skipped" answer.
   */
  syncConnection(connection: ProviderConnection): Promise<SyncResult> {
    const current = this.running.get(connection.id);
    if (!current) {
      const run = this.runSync(connection).finally(() => this.running.delete(connection.id));
      this.running.set(connection.id, run);
      return run;
    }
    const queued = this.followUps.get(connection.id);
    if (queued) {
      queued.connection = connection;
      return queued.result;
    }
    const followUp: { connection: ProviderConnection; result: Promise<SyncResult> } = {
      connection,
      result: current
        .catch(() => undefined)
        .then((): Promise<SyncResult> => {
          this.followUps.delete(connection.id);
          return this.syncConnection(followUp.connection);
        }),
    };
    this.followUps.set(connection.id, followUp);
    return followUp.result;
  }

  private async runSync(connection: ProviderConnection): Promise<SyncResult> {
    try {
      const adapter = this.providers.forConnection(connection);
      // A list the access token may not read (24fire scopes) is skipped: nothing of it is marked
      // missing, the other lists still sync.
      const skipped: string[] = [];
      const optional = async <T>(step: () => Promise<T>): Promise<T | undefined> => {
        try {
          return await step();
        } catch (err) {
          if (!isScopeMissing(err)) throw err;
          const scope = (err.details as { scope?: string } | undefined)?.scope ?? 'unknown';
          skipped.push(scope);
          this.log.warn(
            { provider: connection.name, scope },
            'sync step skipped: the access token lacks a scope',
          );
          return undefined;
        }
      };
      let steps = 1;
      const remote = await optional(() => adapter.listServers());
      const result: SyncResult = remote
        ? await this.syncServers(connection, adapter, remote)
        : { seen: 0, missing: 0 };
      if (adapter.listDomains) {
        steps++;
        const counts = await optional(() => this.syncDomains(connection, adapter));
        if (counts) result.domains = counts;
      }
      if (adapter.listWebspaces) {
        steps++;
        const counts = await optional(() => this.syncWebspaces(connection, adapter));
        if (counts) result.webspaces = counts;
      }
      if (skipped.length === steps) {
        throw new AppError(
          502,
          'provider_scope_missing',
          `${connection.name}: the access token has none of the read scopes the console needs (${skipped.join(', ')})`,
          { scopes: skipped },
        );
      }
      if (skipped.length > 0) result.skipped = skipped;
      if (adapter.listCloudAccounts) result.cloudAccounts = await this.syncCloudAccounts(connection, adapter);
      if (adapter.listMailDomains) result.mailDomains = await syncMailDomains(this.db, connection, adapter);
      if (adapter.listWebsites) result.websites = await syncWebsites(this.db, connection, adapter);
      if (adapter.listPhoneSystems)
        result.phoneSystems = await syncPhoneSystems(this.db, connection, adapter);
      if (adapter.listMediaUsers)
        result.mediaAccounts = await syncMediaAccounts(this.db, connection, adapter, this.audit, this.log);
      if (adapter.listMonitors) {
        result.monitors = await syncMonitors(this.db, connection, adapter);
        // The monitors came from /metrics anyway; the connection stays "ok".
        if (result.monitors.managementError) {
          this.log.warn(
            { provider: connection.name, error: result.monitors.managementError },
            'monitor management unavailable',
          );
        }
      }

      await this.db
        .update(providerConnections)
        .set({ status: 'ok', lastError: null, lastSyncAt: new Date() })
        .where(eq(providerConnections.id, connection.id));
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.db
        .update(providerConnections)
        .set({ status: 'error', lastError: message.slice(0, 1000), lastSyncAt: new Date() })
        .where(eq(providerConnections.id, connection.id));
      throw err;
    }
  }

  async syncAll(): Promise<void> {
    const connections = await this.db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.enabled, true));
    for (const connection of connections) {
      try {
        const result = await this.syncConnection(connection);
        this.log.debug({ provider: connection.name, ...result }, 'provider synced');
      } catch (err) {
        this.log.warn({ err, provider: connection.name }, 'provider sync failed');
      }
    }
  }

  async refreshServer(serverId: string): Promise<void> {
    const [row] = await this.db
      .select({ server: servers, connection: providerConnections })
      .from(servers)
      .innerJoin(providerConnections, eq(providerConnections.id, servers.providerConnectionId))
      .where(eq(servers.id, serverId))
      .limit(1);
    if (!row) return;
    const adapter = this.providers.forConnection(row.connection);
    const remote = await adapter.getServer(serverRef(row.server));
    await this.upsert(row.connection, remote);
  }

  /** Refreshes a server a few times after an action so status transitions show up quickly. */
  refreshSoon(serverId: string) {
    for (const delay of [3000, 10_000, 30_000]) {
      setTimeout(() => {
        this.refreshServer(serverId).catch((err) =>
          this.log.debug({ err, serverId }, 'refresh after action failed'),
        );
      }, delay).unref();
    }
  }

  /** Finishes actions whose provider task has completed. */
  async trackActions(): Promise<void> {
    const rows = await this.db
      .select({ action: serverActions, server: servers, connection: providerConnections })
      .from(serverActions)
      .innerJoin(servers, eq(servers.id, serverActions.serverId))
      .innerJoin(providerConnections, eq(providerConnections.id, servers.providerConnectionId))
      .where(and(eq(serverActions.status, 'running'), isNotNull(serverActions.providerRef)))
      .limit(50);

    for (const { action, server, connection } of rows) {
      const adapter = this.providers.forConnection(connection);
      try {
        const task = await adapter.getTaskStatus?.(serverRef(server), action.providerRef!);
        if (!task || task.status === 'running') continue;
        await this.db
          .update(serverActions)
          .set({
            status: task.status === 'ok' ? 'success' : 'error',
            error: task.status === 'ok' ? null : (task.message ?? 'Task failed'),
            finishedAt: task.endedAt ? new Date(task.endedAt) : new Date(),
          })
          .where(eq(serverActions.id, action.id));
        this.refreshSoon(server.id);
      } catch (err) {
        this.log.debug({ err, actionId: action.id }, 'tracking action failed');
      }
    }

    // Anything still running after an hour without a provider task is considered lost.
    await this.db
      .update(serverActions)
      .set({ status: 'error', error: 'Timed out', finishedAt: new Date() })
      .where(
        and(
          eq(serverActions.status, 'running'),
          lt(serverActions.startedAt, new Date(Date.now() - 3600_000)),
        ),
      );
  }

  /** Runs a job only if this instance holds the advisory lock. Lock and unlock share one connection. */
  private async withLock(lockId: number, fn: () => Promise<void>): Promise<void> {
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query<{ locked: boolean }>('select pg_try_advisory_lock($1) as locked', [
        lockId,
      ]);
      if (!rows[0]?.locked) return;
      try {
        await fn();
      } finally {
        await client.query('select pg_advisory_unlock($1)', [lockId]);
      }
    } finally {
      client.release();
    }
  }

  start(intervalSeconds: number) {
    const job = (name: keyof typeof LOCKS, fn: () => Promise<void>) => () => {
      this.withLock(LOCKS[name], fn).catch((err) =>
        this.log.warn({ err, job: name }, 'scheduled job failed'),
      );
    };
    const sync = job('sync', () => this.syncAll());
    const track = job('actions', () => this.trackActions());
    this.timers.push(setTimeout(sync, 2000));
    this.timers.push(setInterval(sync, intervalSeconds * 1000));
    this.timers.push(setInterval(track, 5000));
    for (const t of this.timers) t.unref();
  }

  stop() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}

/** The fields of a provider's domain info that carry a value. */
function knownFields(info: Partial<DomainInfo>): Partial<DomainInfo> {
  return Object.fromEntries(
    Object.entries(info).filter(([, value]) => value !== undefined && value !== null),
  ) as Partial<DomainInfo>;
}

/** Stored domain info for a domain seen for the first time. */
function completeDomainInfo(domain: RemoteDomain, known: Partial<DomainInfo>): DomainInfo {
  return {
    name: domain.name,
    status: domain.status,
    terminated: false,
    nameservers: [],
    handle: null,
    createdAt: null,
    expiresAt: null,
    autoRenew: null,
    ...known,
  };
}
