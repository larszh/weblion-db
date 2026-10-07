import type {
  BackupInfo,
  Capability,
  FirewallInfo,
  FirewallRule,
  ImageOption,
  IsoOption,
  MetricRange,
  MetricsResult,
  PowerAction,
  ProviderTask,
  RescaleRequest,
  SnapshotInfo,
} from '@weblion/shared';
import { badRequest, conflict, ProviderError, unsupported } from '../../lib/errors';
import { isRecord, mapLimit, num, str } from '../http';
import type {
  ActionResult,
  ConsoleSession,
  CreateServerRequest,
  InfraOverview,
  ProviderAdapter,
  ProxmoxConfig,
  RawResponse,
  RemoteServer,
  ServerRef,
} from '../types';
import { nodeFromUpid, ProxmoxClient } from './client';
import {
  ipsFromAgent,
  ipsFromConfig,
  ipsFromLxcInterfaces,
  mapStatus,
  mergeIps,
  osLabel,
  parseExternalId,
  parsePropertyString,
  parseTags,
  primaryDisk,
  type ClusterVmResource,
  type GuestType,
} from './parse';

const QEMU_POWER: PowerAction[] = ['start', 'shutdown', 'stop', 'reboot', 'reset', 'suspend', 'resume'];
const LXC_POWER: PowerAction[] = ['start', 'shutdown', 'stop', 'reboot', 'suspend', 'resume'];

const HOSTNAME = /^(?=.{1,63}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

interface Guest {
  type: GuestType;
  vmid: number;
  node: string;
  base: string;
}

export class ProxmoxAdapter implements ProviderAdapter {
  readonly type = 'proxmox' as const;
  readonly client: ProxmoxClient;
  private resourceCache: { at: number; items: ClusterVmResource[] } | null = null;

  constructor(private readonly config: ProxmoxConfig) {
    this.client = new ProxmoxClient(config);
  }

  capabilities(server?: ServerRef): Capability[] {
    const caps: Capability[] = [
      'power',
      'metrics',
      'backups',
      'backupRestore',
      'backupDelete',
      'snapshots',
      'console',
      'rescale',
      'firewall',
      'delete',
      'config',
      'tasks',
      'networkInfo',
    ];
    if (!server || server.kind === 'vm') caps.push('iso');
    return caps;
  }

  powerActions(server?: ServerRef): PowerAction[] {
    return server?.kind === 'container' ? LXC_POWER : QEMU_POWER;
  }

  // ---------------------------------------------------------------------------
  // Lookup helpers

  private async clusterVms(maxAgeMs = 5000): Promise<ClusterVmResource[]> {
    if (this.resourceCache && Date.now() - this.resourceCache.at < maxAgeMs) return this.resourceCache.items;
    const items = await this.client.get<ClusterVmResource[]>('/cluster/resources', { type: 'vm' });
    this.resourceCache = { at: Date.now(), items };
    return items;
  }

  /** Resolves the current node. VMs can migrate inside a cluster, so the stored node is only a hint. */
  private async guest(ref: ServerRef): Promise<Guest> {
    const { type, vmid } = parseExternalId(ref.externalId);
    const resources = await this.clusterVms();
    const found = resources.find((r) => r.type === type && r.vmid === vmid);
    const node = found?.node ?? ref.node;
    if (!node) throw new ProviderError('Proxmox', `${type}/${vmid} not found in cluster`, 404);
    return { type, vmid, node, base: `/nodes/${encodeURIComponent(node)}/${type}/${vmid}` };
  }

  private invalidate() {
    this.resourceCache = null;
  }

  // ---------------------------------------------------------------------------
  // Inventory

  async testConnection(): Promise<Record<string, unknown>> {
    const version = await this.client.get<{ version: string; release?: string }>('/version');
    const nodes = await this.client.get<{ node: string; status: string }[]>('/nodes');
    if (nodes.length === 0) {
      throw new ProviderError(
        'Proxmox',
        'token works but sees no nodes. With privilege separation enabled the token needs its own ACLs (e.g. PVEAdmin or Administrator on /).',
      );
    }
    return { version: version.version, nodes: nodes.map((n) => `${n.node} (${n.status})`).join(', ') };
  }

  async listServers(): Promise<RemoteServer[]> {
    const resources = (await this.clusterVms(0)).filter((r) => !r.template);
    return mapLimit(resources, 6, (r) => this.enrich(r));
  }

  async getServer(ref: ServerRef): Promise<RemoteServer> {
    this.invalidate();
    const { type, vmid } = parseExternalId(ref.externalId);
    const resource = (await this.clusterVms()).find((r) => r.type === type && r.vmid === vmid);
    if (!resource) throw new ProviderError('Proxmox', `${ref.externalId} not found in cluster`, 404);
    return this.enrich(resource, true);
  }

  private async enrich(r: ClusterVmResource, detailed = false): Promise<RemoteServer> {
    const base = `/nodes/${encodeURIComponent(r.node)}/${r.type}/${r.vmid}`;
    const config = await this.client
      .get<Record<string, unknown>>(`${base}/config`)
      .catch(() => ({}) as Record<string, unknown>);
    const running = r.status === 'running';
    let agentIps: ReturnType<typeof ipsFromAgent> = [];
    let os = osLabel(r.type, config);
    let qmpstatus: string | undefined;

    if (running && r.type === 'qemu' && agentEnabled(config)) {
      const [net, osinfo] = await Promise.all([
        this.client.get(`${base}/agent/network-get-interfaces`).catch(() => null),
        this.client.get<{ result?: Record<string, unknown> }>(`${base}/agent/get-osinfo`).catch(() => null),
      ]);
      agentIps = ipsFromAgent(net);
      const pretty = str(osinfo?.result?.['pretty-name']);
      if (pretty) os = pretty;
    } else if (running && r.type === 'lxc') {
      agentIps = ipsFromLxcInterfaces(await this.client.get(`${base}/interfaces`).catch(() => null));
    }
    if (detailed && r.type === 'qemu' && running) {
      const current = await this.client
        .get<{ qmpstatus?: string }>(`${base}/status/current`)
        .catch(() => null);
      qmpstatus = current?.qmpstatus;
    }

    const disk = primaryDisk(r.type, config);
    const maxmem = num(r.maxmem);
    const mem = num(r.mem);
    return {
      externalId: `${r.type}/${r.vmid}`,
      name: r.name ?? str(config.name) ?? str(config.hostname) ?? `${r.type}-${r.vmid}`,
      kind: r.type === 'lxc' ? 'container' : 'vm',
      status: mapStatus(r.status, r.lock, qmpstatus),
      specs: {
        cores: num(r.maxcpu) ?? undefined,
        memoryMb: maxmem !== null ? Math.round(maxmem / 1024 / 1024) : undefined,
        diskGb:
          disk?.sizeGb ?? (num(r.maxdisk) !== null ? Math.round(num(r.maxdisk)! / 1024 ** 3) : undefined),
      },
      usage: running
        ? {
            cpuPercent: num(r.cpu) !== null ? Math.round(num(r.cpu)! * 10000) / 100 : undefined,
            memoryUsedMb: mem !== null ? Math.round(mem / 1024 / 1024) : undefined,
            memoryTotalMb: maxmem !== null ? Math.round(maxmem / 1024 / 1024) : undefined,
            uptimeSeconds: num(r.uptime) ?? undefined,
          }
        : null,
      ips: mergeIps(agentIps, ipsFromConfig(r.type, config)),
      os,
      node: r.node,
      meta: {
        vmid: r.vmid,
        type: r.type,
        tags: parseTags(r.tags),
        pool: r.pool ?? null,
        lock: r.lock ?? null,
        hastate: r.hastate ?? null,
        description: str(config.description),
        onboot: config.onboot === 1 || config.onboot === '1',
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Power & console

  async power(ref: ServerRef, action: PowerAction): Promise<ActionResult> {
    const g = await this.guest(ref);
    if (!(g.type === 'lxc' ? LXC_POWER : QEMU_POWER).includes(action)) {
      throw unsupported(`Power action "${action}" is not available for ${g.type}`);
    }
    const upid = await this.client.post<string>(`${g.base}/status/${action}`);
    this.invalidate();
    return { providerRef: upid, message: `${action} started` };
  }

  async openConsole(ref: ServerRef): Promise<ConsoleSession> {
    const g = await this.guest(ref);
    const proxy = await this.client.post<{ port: string | number; ticket: string }>(`${g.base}/vncproxy`, {
      websocket: 1,
    });
    return {
      type: 'vnc',
      password: proxy.ticket,
      connect: () =>
        this.client.openWebSocket(`${g.base}/vncwebsocket`, {
          port: String(proxy.port),
          vncticket: proxy.ticket,
        }),
    };
  }

  // ---------------------------------------------------------------------------
  // Metrics & tasks

  async getMetrics(ref: ServerRef, range: MetricRange): Promise<MetricsResult> {
    const g = await this.guest(ref);
    const rows = await this.client.get<Record<string, unknown>[]>(`${g.base}/rrddata`, {
      timeframe: range,
      cf: 'AVERAGE',
    });
    const points = rows
      .map((row) => {
        const cpu = num(row.cpu);
        return {
          t: num(row.time) ?? 0,
          cpu: cpu === null ? null : Math.round(cpu * 10000) / 100,
          memUsed: num(row.mem),
          memTotal: num(row.maxmem),
          netIn: num(row.netin),
          netOut: num(row.netout),
          diskRead: num(row.diskread),
          diskWrite: num(row.diskwrite),
        };
      })
      .filter((p) => p.t > 0);
    return {
      range,
      resolutionSeconds: points.length > 1 ? points[1]!.t - points[0]!.t : undefined,
      series: [
        { key: 'cpu', unit: 'percent' },
        { key: 'memUsed', unit: 'bytes' },
        { key: 'memTotal', unit: 'bytes' },
        { key: 'netIn', unit: 'bytesPerSecond' },
        { key: 'netOut', unit: 'bytesPerSecond' },
        { key: 'diskRead', unit: 'bytesPerSecond' },
        { key: 'diskWrite', unit: 'bytesPerSecond' },
      ],
      points,
    };
  }

  async listTasks(ref: ServerRef): Promise<ProviderTask[]> {
    const g = await this.guest(ref);
    const tasks = await this.client.get<Record<string, unknown>[]>(
      `/nodes/${encodeURIComponent(g.node)}/tasks`,
      {
        vmid: g.vmid,
        limit: 50,
        source: 'all',
      },
    );
    return tasks.map(toTask);
  }

  async getTaskStatus(_ref: ServerRef, upid: string): Promise<ProviderTask | null> {
    const node = nodeFromUpid(upid);
    if (!node) return null;
    const s = await this.client.get<Record<string, unknown>>(
      `/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status`,
    );
    return toTask({ ...s, upid, status: s.status === 'running' ? undefined : s.exitstatus });
  }

  // ---------------------------------------------------------------------------
  // Snapshots

  async listSnapshots(ref: ServerRef): Promise<SnapshotInfo[]> {
    const g = await this.guest(ref);
    const list = await this.client.get<Record<string, unknown>[]>(`${g.base}/snapshot`);
    return list
      .filter((s) => s.name !== 'current')
      .map((s) => ({
        id: String(s.name),
        description: str(s.description),
        createdAt: num(s.snaptime) ? new Date(num(s.snaptime)! * 1000).toISOString() : null,
        includesRam: s.vmstate === 1 || s.vmstate === '1',
        parent: str(s.parent),
      }))
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  }

  async createSnapshot(
    ref: ServerRef,
    options: { name: string; description?: string; includeRam?: boolean },
  ): Promise<ActionResult> {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{1,39}$/.test(options.name)) {
      throw badRequest(
        'Snapshot names must start with a letter and contain only letters, digits, - and _ (2-40 chars)',
      );
    }
    const g = await this.guest(ref);
    const upid = await this.client.post<string>(`${g.base}/snapshot`, {
      snapname: options.name,
      description: options.description,
      ...(g.type === 'qemu' && options.includeRam ? { vmstate: 1 } : {}),
    });
    return { providerRef: upid, message: 'Snapshot started' };
  }

  async rollbackSnapshot(ref: ServerRef, snapshotId: string): Promise<ActionResult> {
    const g = await this.guest(ref);
    const upid = await this.client.post<string>(
      `${g.base}/snapshot/${encodeURIComponent(snapshotId)}/rollback`,
    );
    return { providerRef: upid, message: 'Rollback started' };
  }

  async deleteSnapshot(ref: ServerRef, snapshotId: string): Promise<ActionResult> {
    const g = await this.guest(ref);
    const upid = await this.client.delete<string>(`${g.base}/snapshot/${encodeURIComponent(snapshotId)}`);
    return { providerRef: upid, message: 'Snapshot deletion started' };
  }

  // ---------------------------------------------------------------------------
  // Backups (vzdump)

  private async backupStorages(node: string): Promise<string[]> {
    const storages = await this.client.get<{ storage: string; active?: number; enabled?: number }[]>(
      `/nodes/${encodeURIComponent(node)}/storage`,
      { content: 'backup' },
    );
    return storages.filter((s) => s.active !== 0 && s.enabled !== 0).map((s) => s.storage);
  }

  async listBackups(ref: ServerRef): Promise<BackupInfo[]> {
    const g = await this.guest(ref);
    const storages = await this.backupStorages(g.node);
    const lists = await mapLimit(storages, 4, (storage) =>
      this.client
        .get<Record<string, unknown>[]>(
          `/nodes/${encodeURIComponent(g.node)}/storage/${encodeURIComponent(storage)}/content`,
          {
            content: 'backup',
            vmid: g.vmid,
          },
        )
        .catch(() => [] as Record<string, unknown>[]),
    );
    const seen = new Set<string>();
    const backups: BackupInfo[] = [];
    lists.forEach((list, i) => {
      for (const b of list) {
        const volid = str(b.volid);
        if (!volid || seen.has(volid)) continue;
        seen.add(volid);
        backups.push({
          id: volid,
          createdAt: num(b.ctime) ? new Date(num(b.ctime)! * 1000).toISOString() : null,
          sizeBytes: num(b.size),
          description: str(b.notes),
          status: 'finished',
          storage: storages[i] ?? null,
          protected: b.protected === 1 || b.protected === '1',
        });
      }
    });
    return backups.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  }

  async createBackup(ref: ServerRef, options: { description?: string }): Promise<ActionResult> {
    const g = await this.guest(ref);
    const storage = this.config.backupStorage ?? (await this.backupStorages(g.node))[0];
    if (!storage) throw conflict('No backup storage is configured on this Proxmox node');
    const upid = await this.client.post<string>(`/nodes/${encodeURIComponent(g.node)}/vzdump`, {
      vmid: g.vmid,
      storage,
      mode: 'snapshot',
      compress: 'zstd',
      'notes-template': options.description ?? '{{guestname}} (weblion.one Console)',
    });
    return { providerRef: upid, message: `Backup to ${storage} started` };
  }

  async restoreBackup(ref: ServerRef, backupId: string): Promise<ActionResult> {
    const g = await this.guest(ref);
    const status = await this.client.get<{ status: string }>(`${g.base}/status/current`);
    if (status.status !== 'stopped')
      throw conflict('The server must be stopped before a backup can be restored');
    const nodeBase = `/nodes/${encodeURIComponent(g.node)}/${g.type}`;
    const upid =
      g.type === 'qemu'
        ? await this.client.post<string>(nodeBase, { vmid: g.vmid, archive: backupId, force: 1 })
        : await this.client.post<string>(nodeBase, {
            vmid: g.vmid,
            ostemplate: backupId,
            restore: 1,
            force: 1,
          });
    this.invalidate();
    return { providerRef: upid, message: 'Restore started' };
  }

  async deleteBackup(ref: ServerRef, backupId: string): Promise<ActionResult> {
    const g = await this.guest(ref);
    // Make sure the volume really belongs to this guest before deleting anything.
    const backups = await this.listBackups(ref);
    const backup = backups.find((b) => b.id === backupId);
    if (!backup) throw new ProviderError('Proxmox', 'backup not found for this server', 404);
    if (backup.protected) throw conflict('This backup is protected in Proxmox');
    const storage = backupId.split(':')[0]!;
    const upid = await this.client.delete<string>(
      `/nodes/${encodeURIComponent(g.node)}/storage/${encodeURIComponent(storage)}/content/${encodeURIComponent(backupId)}`,
    );
    return { providerRef: upid, message: 'Backup deleted' };
  }

  // ---------------------------------------------------------------------------
  // Configuration

  async getConfig(ref: ServerRef): Promise<Record<string, unknown>> {
    const g = await this.guest(ref);
    return this.client.get<Record<string, unknown>>(`${g.base}/config`);
  }

  async rename(ref: ServerRef, name: string): Promise<ActionResult> {
    if (!HOSTNAME.test(name)) return { message: 'Name kept locally (not a valid hostname for Proxmox)' };
    const g = await this.guest(ref);
    await this.client.put(`${g.base}/config`, g.type === 'qemu' ? { name } : { hostname: name });
    this.invalidate();
    return { message: 'Renamed' };
  }

  async rescale(ref: ServerRef, request: RescaleRequest): Promise<ActionResult> {
    const g = await this.guest(ref);
    const config = await this.client.get<Record<string, unknown>>(`${g.base}/config`);
    const changes: Record<string, unknown> = {};
    if (request.cores) changes.cores = request.cores;
    if (request.memoryMb) changes.memory = request.memoryMb;
    if (Object.keys(changes).length > 0) await this.client.put(`${g.base}/config`, changes);

    let upid: string | null = null;
    if (request.diskGb) {
      const disk = primaryDisk(g.type, config);
      if (!disk) throw conflict('Could not determine the primary disk');
      if (disk.sizeGb !== null && request.diskGb <= disk.sizeGb) {
        throw badRequest(`Disks can only grow (currently ${disk.sizeGb} GB)`);
      }
      upid = await this.client.put<string | null>(`${g.base}/resize`, {
        disk: disk.key,
        size: `${request.diskGb}G`,
      });
    }
    this.invalidate();
    return {
      providerRef: upid,
      message: 'Resources updated. CPU and memory changes may need a reboot unless hotplug is enabled.',
    };
  }

  async listImages(): Promise<ImageOption[]> {
    const templates = (await this.clusterVms(0)).filter((r) => r.template);
    return templates.map((t) => ({
      id: `${t.type}/${t.vmid}`,
      label: `${t.name ?? t.vmid} (${t.node})`,
      family: t.type,
    }));
  }

  async deleteServer(ref: ServerRef): Promise<ActionResult> {
    const g = await this.guest(ref);
    const status = await this.client.get<{ status: string }>(`${g.base}/status/current`);
    if (status.status !== 'stopped') throw conflict('The server must be stopped before it can be deleted');
    const upid = await this.client.delete<string>(g.base, { purge: 1, 'destroy-unreferenced-disks': 1 });
    this.invalidate();
    return { providerRef: upid, message: 'Deletion started' };
  }

  async createServer(request: CreateServerRequest): Promise<ActionResult & { externalId?: string }> {
    if (!request.imageId) throw badRequest('A template is required to create a Proxmox server');
    const template = parseExternalId(request.imageId);
    if (template.type !== 'qemu') throw unsupported('Only QEMU templates can be cloned');
    const source = (await this.clusterVms(0)).find(
      (r) => r.type === 'qemu' && r.vmid === template.vmid && r.template,
    );
    if (!source) throw badRequest('Template not found');
    if (!HOSTNAME.test(request.name)) throw badRequest('The name must be a valid hostname');

    const newid = Number(await this.client.get<string | number>('/cluster/nextid'));
    const target = request.node ?? source.node;
    const cloneUpid = await this.client.post<string>(
      `/nodes/${encodeURIComponent(source.node)}/qemu/${source.vmid}/clone`,
      {
        newid,
        name: request.name,
        full: 1,
        target,
        ...(request.storage ? { storage: request.storage } : {}),
      },
    );
    await this.client.waitForTask(cloneUpid);

    const base = `/nodes/${encodeURIComponent(target)}/qemu/${newid}`;
    await this.client.put(`${base}/config`, { cores: request.cores, memory: request.memoryMb });
    const config = await this.client.get<Record<string, unknown>>(`${base}/config`);
    const disk = primaryDisk('qemu', config);
    if (disk && disk.sizeGb !== null && request.diskGb > disk.sizeGb) {
      await this.client.put(`${base}/resize`, { disk: disk.key, size: `${request.diskGb}G` });
    }
    if (request.start !== false) await this.client.post(`${base}/status/start`);
    this.invalidate();
    return { externalId: `qemu/${newid}`, providerRef: cloneUpid, message: 'Server created' };
  }

  // ---------------------------------------------------------------------------
  // ISO

  async listIsos(ref: ServerRef): Promise<IsoOption[]> {
    const g = await this.guest(ref);
    const storages = await this.client.get<{ storage: string }[]>(
      `/nodes/${encodeURIComponent(g.node)}/storage`,
      {
        content: 'iso',
      },
    );
    const lists = await mapLimit(storages, 4, (s) =>
      this.client
        .get<{ volid: string }[]>(
          `/nodes/${encodeURIComponent(g.node)}/storage/${encodeURIComponent(s.storage)}/content`,
          {
            content: 'iso',
          },
        )
        .catch(() => []),
    );
    return lists.flat().map((i) => ({ id: i.volid, label: i.volid.split('/').pop() ?? i.volid }));
  }

  async mountIso(ref: ServerRef, isoId: string): Promise<ActionResult> {
    const g = await this.guest(ref);
    if (g.type !== 'qemu') throw unsupported('ISO images are only available for virtual machines');
    const isos = await this.listIsos(ref);
    if (!isos.some((i) => i.id === isoId)) throw badRequest('Unknown ISO image');
    await this.client.put(`${g.base}/config`, { ide2: `${isoId},media=cdrom` });
    return { message: 'ISO mounted' };
  }

  async unmountIso(ref: ServerRef): Promise<ActionResult> {
    const g = await this.guest(ref);
    if (g.type !== 'qemu') throw unsupported('ISO images are only available for virtual machines');
    await this.client.put(`${g.base}/config`, { ide2: 'none,media=cdrom' });
    return { message: 'ISO removed' };
  }

  // ---------------------------------------------------------------------------
  // Firewall

  async getFirewall(ref: ServerRef): Promise<FirewallInfo> {
    const g = await this.guest(ref);
    const [options, rules] = await Promise.all([
      this.client.get<Record<string, unknown>>(`${g.base}/firewall/options`),
      this.client.get<Record<string, unknown>[]>(`${g.base}/firewall/rules`),
    ]);
    return {
      enabled: options.enable === 1 || options.enable === '1',
      policyIn: str(options.policy_in) ?? 'DROP',
      policyOut: str(options.policy_out) ?? 'ACCEPT',
      rules: rules
        .filter((r) => r.type === 'in' || r.type === 'out')
        .map((r) => ({
          pos: num(r.pos) ?? 0,
          enabled: r.enable === 1 || r.enable === '1',
          direction: r.type as 'in' | 'out',
          action: (str(r.action) ?? 'ACCEPT') as FirewallRule['action'],
          protocol: str(r.proto) ?? str(r.macro),
          dport: str(r.dport),
          sport: str(r.sport),
          source: str(r.source),
          dest: str(r.dest),
          comment: str(r.comment),
        })),
    };
  }

  async addFirewallRule(ref: ServerRef, rule: Omit<FirewallRule, 'pos'>): Promise<ActionResult> {
    const g = await this.guest(ref);
    await this.client.post(`${g.base}/firewall/rules`, {
      type: rule.direction,
      action: rule.action,
      enable: rule.enabled ? 1 : 0,
      proto: rule.protocol ?? undefined,
      dport: rule.dport ?? undefined,
      sport: rule.sport ?? undefined,
      source: rule.source ?? undefined,
      dest: rule.dest ?? undefined,
      comment: rule.comment ?? undefined,
    });
    return { message: 'Rule added' };
  }

  async deleteFirewallRule(ref: ServerRef, pos: number): Promise<ActionResult> {
    const g = await this.guest(ref);
    await this.client.delete(`${g.base}/firewall/rules/${pos}`);
    return { message: 'Rule deleted' };
  }

  async setFirewallEnabled(ref: ServerRef, enabled: boolean): Promise<ActionResult> {
    const g = await this.guest(ref);
    await this.client.put(`${g.base}/firewall/options`, { enable: enabled ? 1 : 0 });
    return { message: enabled ? 'Firewall enabled' : 'Firewall disabled' };
  }

  // ---------------------------------------------------------------------------
  // Admin

  async overview(): Promise<InfraOverview> {
    const [version, nodes, storages] = await Promise.all([
      this.client.get<{ version: string }>('/version').catch(() => null),
      this.client.get<Record<string, unknown>[]>('/nodes'),
      this.client.get<Record<string, unknown>[]>('/cluster/resources', { type: 'storage' }),
    ]);
    const vms = await this.clusterVms(0);
    return {
      version: version?.version ?? null,
      nodes: nodes.map((n) => ({
        name: String(n.node),
        status: str(n.status) ?? 'unknown',
        cpuPercent: num(n.cpu) !== null ? Math.round(num(n.cpu)! * 10000) / 100 : null,
        cores: num(n.maxcpu),
        memoryUsed: num(n.mem),
        memoryTotal: num(n.maxmem),
        uptimeSeconds: num(n.uptime),
      })),
      storages: storages.map((s) => ({
        name: String(s.storage),
        node: str(s.node),
        type: str(s.plugintype),
        used: num(s.disk),
        total: num(s.maxdisk),
        content: (str(s.content) ?? '').split(',').filter(Boolean),
        shared: s.shared === 1,
      })),
      facts: [
        { label: 'VMs', value: String(vms.filter((v) => v.type === 'qemu' && !v.template).length) },
        { label: 'Container', value: String(vms.filter((v) => v.type === 'lxc').length) },
        { label: 'Templates', value: String(vms.filter((v) => v.template).length) },
        { label: 'Running', value: String(vms.filter((v) => v.status === 'running').length) },
      ],
    };
  }

  async rawRequest(method: string, path: string, body?: Record<string, unknown>): Promise<RawResponse> {
    const upper = method.toUpperCase();
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(upper)) throw badRequest('Unsupported method');
    const clean = path.replace(/^\/?api2\/json/, '');
    const res = await this.client.raw(upper, clean, body);
    this.invalidate();
    return {
      status: res.status,
      data: isRecord(res.body) && 'data' in res.body ? res.body : { message: res.statusText, body: res.body },
    };
  }
}

function agentEnabled(config: Record<string, unknown>): boolean {
  const props = parsePropertyString(config.agent);
  return (props.enabled ?? props._) === '1';
}

function toTask(t: Record<string, unknown>): ProviderTask {
  const exit = str(t.status) ?? str(t.exitstatus);
  const running = !t.endtime && !exit;
  return {
    id: String(t.upid ?? ''),
    type: str(t.type) ?? 'task',
    status: running ? 'running' : exit === 'OK' ? 'ok' : 'error',
    startedAt: num(t.starttime) ? new Date(num(t.starttime)! * 1000).toISOString() : null,
    endedAt: num(t.endtime) ? new Date(num(t.endtime)! * 1000).toISOString() : null,
    user: str(t.user),
    message: exit && exit !== 'OK' ? exit : null,
  };
}
