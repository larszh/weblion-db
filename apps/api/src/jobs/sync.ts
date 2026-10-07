import { and, eq, isNotNull, lt, notInArray, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';
import type { Database } from '../db/client';
import { providerConnections, serverActions, servers, type ProviderConnection } from '../db/schema';
import { serverRef, type ProviderRegistry } from '../providers/registry';
import type { RemoteServer } from '../providers/types';

export interface SyncResult {
  seen: number;
  missing: number;
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

      await this.db
        .update(providerConnections)
        .set({ status: 'ok', lastError: null, lastSyncAt: new Date() })
        .where(eq(providerConnections.id, connection.id));
      return { seen: remote.length, missing: missing.length };
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
