import { and, eq, inArray, isNotNull, lt, notInArray, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';
import type { DomainInfo } from '@weblion/shared';
import type { Database } from '../db/client';
import {
  cloudAccounts,
  domains,
  providerConnections,
  serverActions,
  servers,
  webspaces,
  type ProviderConnection,
} from '../db/schema';
import { settlePending } from '../modules/hosting/pending';
import { serverRef, type ProviderRegistry } from '../providers/registry';
import type {
  ProviderAdapter,
  RemoteCloudAccount,
  RemoteDomain,
  RemoteServer,
  RemoteWebspace,
} from '../providers/types';
import { syncMailDomains } from './sync-mail';

export interface SyncCounts {
  seen: number;
  missing: number;
}

/** Servers on the top level; domains, web spaces, cloud accounts and mail domains only for providers that have them. */
export interface SyncResult extends SyncCounts {
  domains?: SyncCounts;
  webspaces?: SyncCounts;
  /** `seen`: accounts the panel manages that the instance reported. */
  cloudAccounts?: SyncCounts;
  mailDomains?: SyncCounts;
}

/** Postgres advisory lock ids, so only one API instance runs each job at a time. */
const LOCKS = { sync: 742_001, actions: 742_002 } as const;

/**
 * Keeps the server inventory in sync with the providers and finishes tracked actions.
 * Data shown in lists comes from this cache; detail pages refresh live on demand.
 */
export class SyncService {
  private timers: NodeJS.Timeout[] = [];
  private running = new Set<string>();

  constructor(
    private readonly db: Database,
    private readonly pool: pg.Pool,
    private readonly providers: ProviderRegistry,
    private readonly log: FastifyBaseLogger,
  ) {}

  private async upsert(connection: ProviderConnection, remote: RemoteServer) {
    const now = new Date();
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
        set: {
          // Follow provider renames unless the server was renamed in the panel.
          name: sql`case when ${servers.name} = ${servers.providerName} then excluded.provider_name else ${servers.name} end`,
          providerName: sql`excluded.provider_name`,
          kind: sql`excluded.kind`,
          status: sql`excluded.status`,
          specs: sql`excluded.specs`,
          usage: sql`excluded.usage`,
          ips: sql`excluded.ips`,
          os: sql`coalesce(excluded.os, ${servers.os})`,
          node: sql`excluded.node`,
          meta: sql`excluded.meta`,
          lastSyncedAt: now,
          missingSince: null,
        },
      });
  }

  /**
   * Domains keep their organization (only admins assign them) and never store the auth
   * code: RemoteDomain.info has no field for it.
   */
  private async syncDomains(connection: ProviderConnection, adapter: ProviderAdapter): Promise<SyncCounts> {
    const remote: RemoteDomain[] = await adapter.listDomains!();
    const now = new Date();
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
    return { seen: remote.length, missing: missing.length };
  }

  /** Same for web spaces. The control panel password is never part of RemoteWebspace. */
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
        });
    }
    const seenIds = remote.map((w) => w.externalId);
    const missing = await this.db
      .update(webspaces)
      .set({ missingSince: sql`coalesce(${webspaces.missingSince}, now())` })
      .where(
        and(
          eq(webspaces.providerConnectionId, connection.id),
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

  async syncConnection(connection: ProviderConnection): Promise<SyncResult> {
    if (this.running.has(connection.id)) return { seen: 0, missing: 0 };
    this.running.add(connection.id);
    try {
      const adapter = this.providers.forConnection(connection);
      const remote = await adapter.listServers();
      for (const server of remote) await this.upsert(connection, server);

      const seenIds = remote.map((s) => s.externalId);
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

      const result: SyncResult = { seen: remote.length, missing: missing.length };
      if (adapter.listDomains) result.domains = await this.syncDomains(connection, adapter);
      if (adapter.listWebspaces) result.webspaces = await this.syncWebspaces(connection, adapter);
      if (adapter.listCloudAccounts) result.cloudAccounts = await this.syncCloudAccounts(connection, adapter);
      if (adapter.listMailDomains) result.mailDomains = await syncMailDomains(this.db, connection, adapter);

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
    } finally {
      this.running.delete(connection.id);
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
