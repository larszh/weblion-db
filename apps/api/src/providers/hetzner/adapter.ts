import type {
  BackupInfo,
  Capability,
  ImageOption,
  IsoOption,
  MetricRange,
  MetricsResult,
  PowerAction,
  ProviderLocation,
  ProviderTask,
  RescaleRequest,
  ServerPlan,
  SnapshotInfo,
  TrafficInfo,
} from '@weblion/shared';
import { badRequest, conflict, ProviderError, unsupported } from '../../lib/errors';
import { isRecord, num, str } from '../http';
import type {
  ActionResult,
  ConsoleSession,
  CreateServerRequest,
  HetznerConfig,
  InfraOverview,
  ProviderAdapter,
  RawResponse,
  RemoteServer,
  ServerRef,
} from '../types';
import { HetznerClient, PROVIDER, type HetznerClientOptions } from './client';
import {
  inIpv6Network,
  isDeprecated,
  isTypeDeprecated,
  metricPoints,
  metricStep,
  newestFirst,
  parseServer,
  planLocations,
  RANGE_SECONDS,
  redactSecrets,
  serverLocation,
  toBackup,
  toImageOption,
  toLocation,
  toPlan,
  toSnapshot,
  toTask,
  type HetznerAction,
  type HetznerImage,
  type HetznerIso,
  type HetznerLocation,
  type HetznerServer,
  type HetznerServerType,
} from './parse';

/** Panel power actions and the Hetzner server actions behind them. */
const POWER: Partial<Record<PowerAction, string>> = {
  start: 'poweron',
  shutdown: 'shutdown',
  stop: 'poweroff',
  reboot: 'reboot',
  reset: 'reset',
};
const POWER_ACTIONS = Object.keys(POWER) as PowerAction[];

/** Server types, locations and the currency rarely change. Caching them saves rate limit. */
const CATALOG_TTL_MS = 10 * 60_000;

const HOSTNAME = /^(?=.{1,63}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
const RDNS_HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i;
const NUMERIC_ID = /^\d{1,18}$/;

/** A value loaded once and shared until it expires. Failed loads are not kept. */
class Cached<T> {
  private entry: { at: number; value: Promise<T> } | null = null;

  constructor(private readonly load: () => Promise<T>) {}

  get(): Promise<T> {
    if (this.entry && Date.now() - this.entry.at < CATALOG_TTL_MS) return this.entry.value;
    const value = this.load();
    const entry = { at: Date.now(), value };
    this.entry = entry;
    value.catch(() => {
      if (this.entry === entry) this.entry = null;
    });
    return value;
  }

  clear() {
    this.entry = null;
  }
}

export class HetznerAdapter implements ProviderAdapter {
  readonly type = 'hetzner' as const;
  readonly client: HetznerClient;

  private readonly serverTypes = new Cached(() =>
    this.client.list<HetznerServerType>('/server_types', 'server_types'),
  );
  private readonly locations = new Cached(() => this.client.list<HetznerLocation>('/locations', 'locations'));
  /** Last state of actions still running, by "<server id>:<action id>". */
  private readonly runningTasks = new Map<
    string,
    { firstAt: number; checkedAt: number; task: ProviderTask }
  >();
  /** Hetzner bills in EUR. Read from /pricing anyway so a change would not go unnoticed. */
  private readonly currency = new Cached(() =>
    this.client
      .get<{ pricing?: { currency?: string } }>('/pricing')
      .then((r) => str(r.pricing?.currency) ?? 'EUR')
      .catch(() => 'EUR'),
  );

  constructor(config: HetznerConfig, options?: HetznerClientOptions) {
    this.client = new HetznerClient(config, options);
  }

  capabilities(): Capability[] {
    // No firewall: Hetzner firewalls are shared project resources, not per server.
    return [
      'power',
      'metrics',
      'traffic',
      'backups',
      'backupRestore',
      'backupDelete',
      'snapshots',
      'console',
      'rescale',
      'rebuild',
      'rdns',
      'iso',
      'passwordReset',
      'delete',
      'config',
      'tasks',
      'networkInfo',
    ];
  }

  powerActions(): PowerAction[] {
    return POWER_ACTIONS;
  }

  // ---------------------------------------------------------------------------
  // Lookup helpers

  private async server(ref: ServerRef): Promise<HetznerServer> {
    const { server } = await this.client.get<{ server: HetznerServer }>(`/servers/${serverId(ref)}`);
    return server;
  }

  /** Starts a server action. The answer carries the action plus extras (root_password, wss_url). */
  private serverAction(
    ref: ServerRef,
    name: string,
    body?: Record<string, unknown>,
  ): Promise<{ action: HetznerAction } & Record<string, unknown>> {
    return this.client.post(`/servers/${serverId(ref)}/actions/${name}`, body);
  }

  /**
   * An image of this very server: snapshots by created_from, backups by bound_to. Any other
   * image answers like a missing one, so customers can't probe for images of others.
   */
  private async ownImage(
    ref: ServerRef,
    imageId: string,
    kind: 'snapshot' | 'backup',
  ): Promise<HetznerImage> {
    const id = serverId(ref);
    const missing = new ProviderError(PROVIDER, `${kind} not found for this server`, 404);
    if (!NUMERIC_ID.test(imageId)) throw missing;
    let image: HetznerImage;
    try {
      ({ image } = await this.client.get<{ image: HetznerImage }>(`/images/${imageId}`));
    } catch (err) {
      if (err instanceof ProviderError && err.upstreamStatus === 404) throw missing;
      throw err;
    }
    if (!isOwnImage(image, id, kind)) throw missing;
    return image;
  }

  private async ownImages(ref: ServerRef, kind: 'snapshot' | 'backup'): Promise<HetznerImage[]> {
    const id = serverId(ref);
    // Snapshots can't be filtered by origin at Hetzner. Backups can, but are checked again.
    const images = await this.client.list<HetznerImage>('/images', 'images', {
      type: kind,
      ...(kind === 'backup' ? { bound_to: id } : {}),
    });
    return images.filter((image) => isOwnImage(image, id, kind)).sort(newestFirst);
  }

  // ---------------------------------------------------------------------------
  // Inventory

  async testConnection(): Promise<Record<string, unknown>> {
    const servers = await this.client.count('/servers', 'servers');
    this.locations.clear();
    const locations = await this.locations.get();
    return { servers, locations: locations.map((l) => l.name).join(', ') };
  }

  /** One paginated list call. Nothing is fetched per server: the rate limit is per project. */
  async listServers(): Promise<RemoteServer[]> {
    const servers = await this.client.list<HetznerServer>('/servers', 'servers');
    return servers.map(parseServer);
  }

  async getServer(ref: ServerRef): Promise<RemoteServer> {
    return parseServer(await this.server(ref));
  }

  async rename(ref: ServerRef, name: string): Promise<ActionResult> {
    if (!HOSTNAME.test(name)) return { message: 'Name kept locally (not a valid hostname for Hetzner)' };
    await this.client.put(`/servers/${serverId(ref)}`, { name });
    return { message: 'Renamed' };
  }

  // ---------------------------------------------------------------------------
  // Power & console

  async power(ref: ServerRef, action: PowerAction): Promise<ActionResult> {
    const command = POWER[action];
    if (!command) throw unsupported(`Hetzner does not support the power action "${action}"`);
    const { action: started } = await this.serverAction(ref, command);
    return { providerRef: String(started.id), message: `${action} started` };
  }

  async openConsole(ref: ServerRef): Promise<ConsoleSession> {
    const res = await this.serverAction(ref, 'request_console');
    const wssUrl = str(res.wss_url);
    const password = str(res.password);
    if (!wssUrl || !password) throw new ProviderError(PROVIDER, 'request_console returned no console access');
    // URL and password work once and only for a short time. The bridge connects right away.
    return { type: 'vnc', password, connect: () => this.client.openConsoleSocket(wssUrl) };
  }

  // ---------------------------------------------------------------------------
  // Metrics, traffic & tasks

  /** vCPUs of the server, from the cached server types when the stored meta names the type. */
  private async cores(ref: ServerRef): Promise<number | null> {
    const typeName = str(ref.meta.serverType);
    if (typeName) {
      const type = (await this.serverTypes.get()).find((t) => t.name === typeName);
      if (type) return num(type.cores);
    }
    return num((await this.server(ref)).server_type?.cores);
  }

  async getMetrics(ref: ServerRef, range: MetricRange): Promise<MetricsResult> {
    const step = metricStep(range);
    const end = new Date();
    const start = new Date(end.getTime() - RANGE_SECONDS[range] * 1000);
    const [data, cores] = await Promise.all([
      this.client.get<{ metrics?: { step?: number; time_series?: unknown } }>(
        `/servers/${serverId(ref)}/metrics`,
        { type: ['cpu', 'disk', 'network'], start: rfc3339(start), end: rfc3339(end), step },
      ),
      this.cores(ref).catch(() => null),
    ]);
    return {
      range,
      resolutionSeconds: num(data.metrics?.step) ?? step,
      series: [
        { key: 'cpu', unit: 'percent' },
        { key: 'netIn', unit: 'bytesPerSecond' },
        { key: 'netOut', unit: 'bytesPerSecond' },
        { key: 'diskRead', unit: 'bytesPerSecond' },
        { key: 'diskWrite', unit: 'bytesPerSecond' },
      ],
      points: metricPoints(data.metrics?.time_series, cores),
    };
  }

  /** Traffic of the current billing period. Only outgoing traffic counts against the quota. */
  async getTraffic(ref: ServerRef): Promise<TrafficInfo> {
    const server = await this.server(ref);
    let included = num(server.included_traffic);
    if (!included) {
      // Hetzner moved the included traffic into the per location server type prices.
      const location = serverLocation(server)?.name;
      const price = (server.server_type?.prices ?? []).find((p) => p.location === location);
      included = num(price?.included_traffic);
    }
    return {
      inBytes: num(server.ingoing_traffic),
      outBytes: num(server.outgoing_traffic),
      limitBytes: included && included > 0 ? included : null,
      periodStart: null,
      periodEnd: null,
    };
  }

  async listTasks(ref: ServerRef): Promise<ProviderTask[]> {
    const { actions } = await this.client.get<{ actions?: HetznerAction[] }>(
      `/servers/${serverId(ref)}/actions`,
      { sort: 'id:desc', per_page: 25 },
    );
    return (actions ?? []).map(toTask);
  }

  /**
   * The action tracker asks every few seconds while an action runs. Long running actions
   * (snapshots of big disks, migrations) are polled less often to spare the rate limit:
   * in between, the last known state is answered.
   */
  async getTaskStatus(ref: ServerRef, providerRef: string): Promise<ProviderTask | null> {
    if (!NUMERIC_ID.test(providerRef)) return null;
    const key = `${ref.externalId}:${providerRef}`;
    const now = Date.now();
    const known = this.runningTasks.get(key);
    if (known && now - known.checkedAt < taskPollInterval(now - known.firstAt)) return known.task;

    const { action } = await this.client.get<{ action: HetznerAction }>(`/actions/${providerRef}`);
    // Only actions on this server (the reference comes from our own records anyway).
    const resources = action.resources ?? [];
    if (
      resources.length > 0 &&
      !resources.some((r) => r.type === 'server' && String(r.id) === ref.externalId)
    ) {
      return null;
    }
    const task = toTask(action);
    if (task.status === 'running') {
      this.runningTasks.set(key, { firstAt: known?.firstAt ?? now, checkedAt: now, task });
      this.pruneRunningTasks(now);
    } else {
      this.runningTasks.delete(key);
    }
    return task;
  }

  /** Forgets actions nobody asked about for a while (the tracker gives up after an hour). */
  private pruneRunningTasks(now: number) {
    if (this.runningTasks.size < 200) return;
    for (const [key, entry] of this.runningTasks) {
      if (now - entry.checkedAt > 2 * 3600_000) this.runningTasks.delete(key);
    }
  }

  // ---------------------------------------------------------------------------
  // Backups (daily Hetzner backups in 7 slots, +20 % of the server price)

  async listBackups(ref: ServerRef): Promise<BackupInfo[]> {
    return (await this.ownImages(ref, 'backup')).map(toBackup);
  }

  async createBackup(ref: ServerRef, options: { description?: string }): Promise<ActionResult> {
    const server = await this.server(ref);
    // A manual backup takes one of the backup slots, which only exist with backups enabled.
    if (!server.backup_window) throw conflict('Backups are not enabled for this server at Hetzner');
    const { action } = await this.serverAction(ref, 'create_image', {
      type: 'backup',
      description: options.description?.trim() || 'weblion Console',
    });
    return { providerRef: String(action.id), message: 'Backup started' };
  }

  /** Rebuilds the server from the backup. Everything written since is lost. */
  async restoreBackup(ref: ServerRef, backupId: string): Promise<ActionResult> {
    const backup = await this.ownImage(ref, backupId, 'backup');
    await this.requireRebuildAllowed(ref);
    const { action } = await this.serverAction(ref, 'rebuild', { image: backup.id });
    return { providerRef: String(action.id), message: 'Restore started' };
  }

  async deleteBackup(ref: ServerRef, backupId: string): Promise<ActionResult> {
    const backup = await this.ownImage(ref, backupId, 'backup');
    if (backup.protection?.delete) throw conflict('This backup is protected at Hetzner');
    await this.client.delete(`/images/${backup.id}`);
    return { message: 'Backup deleted' };
  }

  // ---------------------------------------------------------------------------
  // Snapshots (images created from this server, billed per GB and month)

  async listSnapshots(ref: ServerRef): Promise<SnapshotInfo[]> {
    return (await this.ownImages(ref, 'snapshot')).map(toSnapshot);
  }

  async createSnapshot(
    ref: ServerRef,
    options: { name: string; description?: string; includeRam?: boolean },
  ): Promise<ActionResult> {
    const extra = options.description?.trim();
    const { action } = await this.serverAction(ref, 'create_image', {
      type: 'snapshot',
      description: extra ? `${options.name}: ${extra}` : options.name,
    });
    return {
      providerRef: String(action.id),
      message: options.includeRam
        ? 'Snapshot started (Hetzner snapshots contain the disk only, no RAM)'
        : 'Snapshot started',
    };
  }

  /** Hetzner has no rollback: the server is rebuilt from the snapshot, current data is lost. */
  async rollbackSnapshot(ref: ServerRef, snapshotId: string): Promise<ActionResult> {
    const snapshot = await this.ownImage(ref, snapshotId, 'snapshot');
    await this.requireRebuildAllowed(ref);
    const { action } = await this.serverAction(ref, 'rebuild', { image: snapshot.id });
    return { providerRef: String(action.id), message: 'Rollback started (rebuild from the snapshot)' };
  }

  async deleteSnapshot(ref: ServerRef, snapshotId: string): Promise<ActionResult> {
    const snapshot = await this.ownImage(ref, snapshotId, 'snapshot');
    if (snapshot.protection?.delete) throw conflict('This snapshot is protected at Hetzner');
    await this.client.delete(`/images/${snapshot.id}`);
    return { message: 'Snapshot deleted' };
  }

  // ---------------------------------------------------------------------------
  // Configuration & lifecycle

  async getConfig(ref: ServerRef): Promise<Record<string, unknown>> {
    return redactSecrets(await this.server(ref)) as unknown as Record<string, unknown>;
  }

  /**
   * Hetzner sells fixed server types, so only a plan change is possible, with the server
   * off. Without upgradeDisk the disk keeps its size and the server can be downgraded again.
   */
  async rescale(ref: ServerRef, request: RescaleRequest): Promise<ActionResult> {
    if (!request.plan) {
      throw badRequest('Hetzner sells fixed server types: choose a plan instead of cores, memory or disk');
    }
    const [server, types] = await Promise.all([this.server(ref), this.serverTypes.get()]);
    const target = types.find((t) => t.name === request.plan);
    if (!target || isTypeDeprecated(target)) {
      throw badRequest(`Unknown or discontinued server type "${request.plan}"`);
    }
    const label = target.name.toUpperCase();
    if (target.name === server.server_type?.name) throw badRequest('The server already has this server type');
    const architecture = server.server_type?.architecture;
    if (architecture && target.architecture && target.architecture !== architecture) {
      throw badRequest(`${label} has a different CPU architecture (${target.architecture})`);
    }
    const location = serverLocation(server)?.name;
    if (location && !planLocations(target).includes(location)) {
      throw badRequest(`${label} is not available in ${location}`);
    }
    if (target.disk < server.primary_disk_size) {
      throw badRequest(
        `${label} has a smaller disk (${target.disk} GB) than the server (${server.primary_disk_size} GB)`,
      );
    }
    if (server.status !== 'off') {
      throw conflict('The server must be powered off before its server type can be changed');
    }
    const upgradeDisk = !!request.upgradeDisk;
    const { action } = await this.serverAction(ref, 'change_type', {
      server_type: target.name,
      upgrade_disk: upgradeDisk,
    });
    return {
      providerRef: String(action.id),
      message: upgradeDisk
        ? `Changing to ${label} with a ${target.disk} GB disk. A downgrade is not possible afterwards.`
        : `Changing to ${label}. The disk keeps its size, so a downgrade stays possible.`,
    };
  }

  /** Server types for creating servers, or with a ref those the server can change to. */
  async listPlans(ref?: ServerRef): Promise<ServerPlan[]> {
    const [types, currency, server] = await Promise.all([
      this.serverTypes.get(),
      this.currency.get(),
      ref ? this.server(ref) : Promise.resolve(null),
    ]);
    const location = server ? (serverLocation(server)?.name ?? null) : null;
    const architecture = server?.server_type?.architecture;
    return types
      .filter((t) => !isTypeDeprecated(t))
      .filter((t) =>
        !server
          ? // Sold out or deprecated in every location: nothing to order.
            planLocations(t).length > 0
          : (!architecture || t.architecture === architecture) &&
            (!location || planLocations(t).includes(location)) &&
            // Disks can't shrink, so smaller types are out of reach.
            t.disk >= server.primary_disk_size,
      )
      .map((t) => toPlan(t, currency, location))
      .sort((a, b) => (a.priceMonthly?.amount ?? 0) - (b.priceMonthly?.amount ?? 0) || a.cores - b.cores);
  }

  async listLocations(): Promise<ProviderLocation[]> {
    return (await this.locations.get()).map(toLocation);
  }

  /**
   * Without a ref: system and app images to create servers from. With a ref: what the
   * server can be rebuilt from, i.e. images of its architecture and its own snapshots/backups.
   */
  async listImages(ref?: ServerRef): Promise<ImageOption[]> {
    const server = ref ? await this.server(ref) : null;
    const architecture = server?.server_type?.architecture;
    const [system, snapshots, backups] = await Promise.all([
      this.client.list<HetznerImage>('/images', 'images', {
        type: ['system', 'app'],
        status: 'available',
        ...(architecture ? { architecture } : {}),
      }),
      ref ? this.ownImages(ref, 'snapshot') : Promise.resolve([]),
      ref ? this.ownImages(ref, 'backup') : Promise.resolve([]),
    ]);
    const options = system
      .filter((i) => !isDeprecated(i) && (!architecture || i.architecture === architecture))
      .map((i) => toImageOption(i, !ref))
      .sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }));
    return [...options, ...[...snapshots, ...backups].map((i) => toImageOption(i))];
  }

  async rebuild(ref: ServerRef, imageId: string): Promise<ActionResult & { password?: string }> {
    if (!NUMERIC_ID.test(imageId)) throw badRequest('Unknown image');
    const server = await this.requireRebuildAllowed(ref);
    let image: HetznerImage;
    try {
      ({ image } = await this.client.get<{ image: HetznerImage }>(`/images/${imageId}`));
    } catch (err) {
      if (err instanceof ProviderError && err.upstreamStatus === 404) throw badRequest('Unknown image');
      throw err;
    }
    const architecture = server.server_type?.architecture;
    const allowed =
      ((image.type === 'system' || image.type === 'app') &&
        !isDeprecated(image) &&
        (!architecture || image.architecture === architecture)) ||
      isOwnImage(image, server.id, 'snapshot') ||
      isOwnImage(image, server.id, 'backup');
    if (!allowed) throw badRequest('Unknown image');
    const res = await this.serverAction(ref, 'rebuild', { image: image.id });
    // System images get a new root password (no SSH keys are set). Shown once, never stored.
    const password = str(res.root_password);
    return {
      providerRef: String(res.action.id),
      message: password ? 'Rebuild started. A new root password was generated.' : 'Rebuild started',
      ...(password ? { password } : {}),
    };
  }

  private async requireRebuildAllowed(ref: ServerRef): Promise<HetznerServer> {
    const server = await this.server(ref);
    if (server.protection?.rebuild)
      throw conflict('Rebuild protection is enabled for this server at Hetzner');
    return server;
  }

  async resetPassword(ref: ServerRef): Promise<ActionResult & { password?: string }> {
    const server = await this.server(ref);
    if (server.status !== 'running') {
      throw conflict(
        'The server must be running: Hetzner sets the new root password through the guest agent',
      );
    }
    const res = await this.serverAction(ref, 'reset_password');
    return {
      providerRef: String(res.action.id),
      message: 'Root password reset',
      password: str(res.root_password) ?? undefined,
    };
  }

  async deleteServer(ref: ServerRef): Promise<ActionResult> {
    const server = await this.server(ref);
    if (server.protection?.delete) throw conflict('Delete protection is enabled for this server at Hetzner');
    const res = await this.client.delete<{ action?: HetznerAction }>(`/servers/${server.id}`);
    return { providerRef: res?.action ? String(res.action.id) : null, message: 'Deletion started' };
  }

  async createServer(request: CreateServerRequest): Promise<ActionResult & { externalId?: string }> {
    if (!request.plan) throw badRequest('A server type (plan) is required to create a Hetzner server');
    if (!request.location) throw badRequest('A location is required to create a Hetzner server');
    if (!request.imageId) throw badRequest('An image is required to create a Hetzner server');
    if (!HOSTNAME.test(request.name)) throw badRequest('The name must be a valid hostname');

    const [types, locations] = await Promise.all([this.serverTypes.get(), this.locations.get()]);
    const type = types.find((t) => t.name === request.plan);
    if (!type || isTypeDeprecated(type))
      throw badRequest(`Unknown or discontinued server type "${request.plan}"`);
    const label = type.name.toUpperCase();
    if (!locations.some((l) => l.name === request.location)) {
      throw badRequest(`Unknown location "${request.location}"`);
    }
    if (!planLocations(type).includes(request.location)) {
      throw badRequest(`${label} is not available in ${request.location}`);
    }

    let image: HetznerImage | undefined;
    if (NUMERIC_ID.test(request.imageId)) {
      try {
        image = (await this.client.get<{ image: HetznerImage }>(`/images/${request.imageId}`)).image;
      } catch (err) {
        if (!(err instanceof ProviderError && err.upstreamStatus === 404)) throw err;
      }
    } else {
      // System image names ("ubuntu-24.04") exist once per architecture.
      const images = await this.client.list<HetznerImage>('/images', 'images', {
        name: request.imageId,
        architecture: type.architecture,
      });
      image = images[0];
    }
    if (!image || !['system', 'app', 'snapshot'].includes(image.type)) throw badRequest('Unknown image');
    if (type.architecture && image.architecture !== type.architecture) {
      throw badRequest(`The image is built for ${image.architecture}, ${label} is ${type.architecture}`);
    }

    const res = await this.client.post<{ server: HetznerServer; action?: HetznerAction }>('/servers', {
      name: request.name,
      server_type: type.name,
      image: image.id,
      location: request.location,
      start_after_create: request.start !== false,
    });
    // Without SSH keys Hetzner also answers with a root password. It is not passed on:
    // a password reset sets one for whoever gets the server.
    return {
      externalId: String(res.server.id),
      providerRef: res.action ? String(res.action.id) : null,
      message: 'Server created',
    };
  }

  // ---------------------------------------------------------------------------
  // Network

  async setRdns(ref: ServerRef, ip: string, hostname: string): Promise<ActionResult> {
    const server = await this.server(ref);
    const v4 = server.public_net?.ipv4?.ip;
    const v6 = server.public_net?.ipv6?.ip;
    // Any address of the server's /64 can get a pointer.
    const owned = ip.includes(':') ? !!v6 && inIpv6Network(ip, v6) : ip === v4;
    if (!owned) throw badRequest('IP does not belong to this server');
    const name = hostname.trim().replace(/\.$/, '');
    if (name && !RDNS_HOSTNAME.test(name)) throw badRequest('Invalid hostname');
    // An empty name resets the pointer to Hetzner's default.
    const { action } = await this.serverAction(ref, 'change_dns_ptr', { ip, dns_ptr: name || null });
    return { providerRef: String(action.id), message: 'Reverse DNS updated' };
  }

  // ---------------------------------------------------------------------------
  // ISO

  /** Public ISOs only: private ones are uploaded per project and may be meant for someone else. */
  async listIsos(ref: ServerRef): Promise<IsoOption[]> {
    const server = await this.server(ref);
    const architecture = server.server_type?.architecture;
    // The wildcard keeps ISOs without an architecture (virtio drivers) in a filtered list.
    const isos = await this.client.list<HetznerIso>(
      '/isos',
      'isos',
      architecture ? { architecture, include_architecture_wildcard: true } : {},
    );
    return isos
      .filter((i) => i.type === 'public' && !isDeprecated(i))
      .filter((i) => !architecture || !i.architecture || i.architecture === architecture)
      .map((i) => ({ id: String(i.id), label: str(i.description) ?? i.name }))
      .sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }));
  }

  async mountIso(ref: ServerRef, isoId: string): Promise<ActionResult> {
    const isos = await this.listIsos(ref);
    if (!isos.some((i) => i.id === isoId)) throw badRequest('Unknown ISO image');
    // Hetzner replaces a mounted ISO. The server boots from it on its next start.
    const { action } = await this.serverAction(ref, 'attach_iso', { iso: Number(isoId) });
    return {
      providerRef: String(action.id),
      message: 'ISO mounted. The server boots from it after a restart.',
    };
  }

  async unmountIso(ref: ServerRef): Promise<ActionResult> {
    const server = await this.server(ref);
    if (!server.iso) return { message: 'No ISO mounted' };
    const { action } = await this.serverAction(ref, 'detach_iso');
    return { providerRef: String(action.id), message: 'ISO removed' };
  }

  // ---------------------------------------------------------------------------
  // Admin

  async overview(): Promise<InfraOverview> {
    const [servers, locations, types] = await Promise.all([
      this.client.count('/servers', 'servers'),
      this.locations.get(),
      this.serverTypes.get(),
    ]);
    return {
      version: null,
      nodes: [],
      storages: [],
      facts: [
        { label: 'Servers', value: String(servers) },
        { label: 'Locations', value: locations.map((l) => l.name).join(', ') || '–' },
        { label: 'Server types', value: String(types.filter((t) => !isTypeDeprecated(t)).length) },
      ],
    };
  }

  /** Paths are relative to /v1, e.g. "/servers" or "/server_types?page=2". */
  async rawRequest(method: string, path: string, body?: Record<string, unknown>): Promise<RawResponse> {
    const upper = method.toUpperCase();
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(upper)) throw badRequest('Unsupported method');
    let clean = path.trim();
    if (clean.startsWith(this.client.baseUrl)) clean = clean.slice(this.client.baseUrl.length);
    clean = clean.replace(/^\/?v1(?=[/?]|$)/, '');
    if (!clean.startsWith('/')) clean = `/${clean}`;
    // Only paths below the API base: the token must not be sent anywhere else. URL parsing
    // also resolves encoded dot segments ("%2e%2e"), so those are refused as well.
    if (/^\/\/|\.\.|\\|@|%2e/i.test(clean)) throw badRequest('Invalid path');
    const query = upper === 'GET' || upper === 'DELETE';
    const res = await this.client.raw(upper, clean, {
      ...(body && query ? { query: toQuery(body) } : {}),
      ...(body && !query ? { body } : {}),
    });
    return { status: res.status, data: redactSecrets(res.body) };
  }
}

function serverId(ref: ServerRef): number {
  if (!NUMERIC_ID.test(ref.externalId)) {
    throw new ProviderError(PROVIDER, `invalid server id "${ref.externalId}"`, 404);
  }
  return Number(ref.externalId);
}

/**
 * How long the last state of a running action is reused, by the action's age: every
 * request in the first minute, then every 15 s, after ten minutes once a minute.
 */
export function taskPollInterval(ageMs: number): number {
  if (ageMs < 60_000) return 0;
  return ageMs < 10 * 60_000 ? 15_000 : 60_000;
}

function isOwnImage(image: HetznerImage, serverId: number, kind: 'snapshot' | 'backup'): boolean {
  if (image.type !== kind) return false;
  return kind === 'snapshot' ? image.created_from?.id === serverId : image.bound_to === serverId;
}

/** RFC 3339 without milliseconds, as in the Hetzner API docs. */
function rfc3339(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function toQuery(values: Record<string, unknown>): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    query[key] = Array.isArray(value)
      ? value.map(String)
      : isRecord(value)
        ? JSON.stringify(value)
        : String(value);
  }
  return query;
}
