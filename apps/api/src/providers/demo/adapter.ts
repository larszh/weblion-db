import { randomUUID } from 'node:crypto';
import type {
  BackupInfo,
  Capability,
  DdosSettings,
  DnsRecord,
  DnsRecordInput,
  DnsRecordType,
  DomainCapability,
  DomainInfo,
  FirewallInfo,
  FirewallRule,
  ImageOption,
  IsoOption,
  MetricPoint,
  MetricRange,
  MetricsResult,
  MonitoringInfo,
  PowerAction,
  ProviderLocation,
  ProviderTask,
  RescaleRequest,
  ServerPlan,
  ServerStatus,
  SnapshotInfo,
  TrafficInfo,
  WebspaceCredentials,
  WebspaceInfo,
} from '@weblion/shared';
import { DNS_RECORD_TYPES, DOMAIN_CAPABILITIES } from '@weblion/shared';
import { badRequest, conflict, notFound } from '../../lib/errors';
import type {
  ActionResult,
  CreateServerRequest,
  DemoConfig,
  DnsRecordPatch,
  InfraOverview,
  ProviderAdapter,
  RawResponse,
  RemoteDomain,
  RemoteServer,
  RemoteWebspace,
  ServerRef,
} from '../types';
import { DemoHosting, demoHostingState, resetDemoHosting } from './hosting';

/**
 * Simulated provider for local development, UI work and automated tests.
 * State lives in memory per connection and survives adapter re-creation.
 */

interface DemoServer extends RemoteServer {
  backups: BackupInfo[];
  snapshots: SnapshotInfo[];
  tasks: ProviderTask[];
  firewall: FirewallInfo;
  ddos: DdosSettings[];
  iso: string | null;
  seed: number;
  architecture: 'x86' | 'arm';
}

const STATE = new Map<string, Map<string, DemoServer>>();

const NAMES = [
  'web-01',
  'web-02',
  'db-primary',
  'db-replica',
  'mail',
  'git',
  'monitoring',
  'vpn-gw',
  'ci-runner',
  'backup-box',
];
const IMAGES: ImageOption[] = [
  { id: 'debian-12', label: 'Debian 12', family: 'debian' },
  { id: 'debian-13', label: 'Debian 13', family: 'debian' },
  { id: 'ubuntu-24.04', label: 'Ubuntu 24.04 LTS', family: 'ubuntu' },
  { id: 'rocky-9', label: 'Rocky Linux 9', family: 'rhel' },
  { id: 'windows-2022', label: 'Windows Server 2022', family: 'windows' },
];
const ISOS: IsoOption[] = [
  { id: 'local:iso/debian-12.7.0-amd64-netinst.iso', label: 'debian-12.7.0-amd64-netinst.iso' },
  { id: 'local:iso/systemrescue-11.02-amd64.iso', label: 'systemrescue-11.02-amd64.iso' },
];

function demoPlan(
  id: string,
  cores: number,
  architecture: 'x86' | 'arm',
  priceCents: number,
  extra: { deprecated?: boolean; cpuType?: string; locations?: string[] } = {},
): ServerPlan {
  return {
    id,
    label: id.toUpperCase(),
    cores,
    memoryMb: cores * 2048,
    diskGb: cores * 40,
    architecture,
    cpuType: extra.cpuType ?? 'shared',
    priceMonthly: { amount: priceCents, currency: 'EUR' },
    locations: extra.locations ?? [],
    deprecated: extra.deprecated ?? false,
  };
}

/**
 * Fixed sizes like Hetzner server types, so plan pickers can be tried without a Hetzner
 * project. The generated servers match the x86 plans (cores x 2 GB RAM, cores x 40 GB disk)
 * and count as x86.
 */
const PLANS: ServerPlan[] = [
  demoPlan('d1', 1, 'x86', 490, { deprecated: true }),
  demoPlan('d2', 2, 'x86', 890),
  demoPlan('d4', 4, 'x86', 1690),
  demoPlan('d8', 8, 'x86', 3290),
  demoPlan('d16', 16, 'x86', 6490),
  demoPlan('d8-dedicated', 8, 'x86', 5990, { cpuType: 'dedicated', locations: ['fsn1', 'hel1'] }),
  demoPlan('d4-arm', 4, 'arm', 790, { locations: ['fsn1'] }),
];
const LOCATIONS: ProviderLocation[] = [
  { id: 'zrh1', label: 'Zürich', country: 'CH', city: 'Zürich' },
  { id: 'fsn1', label: 'Falkenstein DC Park 1', country: 'DE', city: 'Falkenstein' },
  { id: 'hel1', label: 'Helsinki DC Park 1', country: 'FI', city: 'Helsinki' },
];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export class DemoAdapter implements ProviderAdapter {
  readonly type = 'demo' as const;
  private readonly servers: Map<string, DemoServer>;
  private readonly hosting: DemoHosting;

  constructor(
    private readonly connectionId: string,
    private readonly config: DemoConfig,
  ) {
    let state = STATE.get(connectionId);
    if (!state) {
      state = this.generate();
      STATE.set(connectionId, state);
    }
    this.servers = state;
    this.hosting = new DemoHosting(demoHostingState(connectionId));
  }

  /** Test helper: forget all simulated state. */
  static reset() {
    STATE.clear();
    resetDemoHosting();
  }

  private generate(): Map<string, DemoServer> {
    const seed = this.config.seed ?? 42;
    const rand = rng(seed);
    const count = this.config.servers ?? 6;
    const map = new Map<string, DemoServer>();
    for (let i = 0; i < count; i++) {
      const id = `demo-${seed}-${i + 1}`;
      const cores = [2, 4, 4, 8, 16][Math.floor(rand() * 5)]!;
      const memoryMb = cores * 2048;
      const status: ServerStatus = i === count - 1 ? 'stopped' : 'running';
      map.set(id, {
        externalId: id,
        name: NAMES[i % NAMES.length]! + (i >= NAMES.length ? `-${i}` : ''),
        kind: i % 4 === 3 ? 'container' : 'vm',
        status,
        specs: { cores, memoryMb, diskGb: cores * 40, networkMbit: 1000, backupSlots: 3 },
        usage: null,
        ips: [
          {
            address: `185.${100 + i}.${Math.floor(rand() * 250)}.${10 + i}`,
            version: 4,
            gateway: `185.${100 + i}.0.1`,
            rdns: `${NAMES[i % NAMES.length]}.example.ch`,
          },
          { address: `2a0e:${(1000 + i).toString(16)}::${i + 1}`, version: 6 },
        ],
        os: IMAGES[i % 4]!.label,
        node: i % 2 === 0 ? 'demo-node-1' : 'demo-node-2',
        meta: {},
        backups: [
          {
            id: randomUUID(),
            createdAt: new Date(Date.now() - 86_400_000 * (i + 1)).toISOString(),
            sizeBytes: Math.round((2 + rand() * 20) * 1024 ** 3),
            description: 'Automatisches Backup',
            status: 'finished',
          },
        ],
        snapshots: [],
        tasks: [],
        firewall: {
          enabled: true,
          policyIn: 'DROP',
          policyOut: 'ACCEPT',
          rules: [
            {
              pos: 0,
              enabled: true,
              direction: 'in',
              action: 'ACCEPT',
              protocol: 'tcp',
              dport: '22',
              comment: 'SSH',
            },
            {
              pos: 1,
              enabled: true,
              direction: 'in',
              action: 'ACCEPT',
              protocol: 'tcp',
              dport: '80,443',
              comment: 'HTTP(S)',
            },
          ],
        },
        ddos: [],
        iso: null,
        seed: seed + i,
        architecture: 'x86',
      });
    }
    // DDoS settings exist per IPv4 address of the server, like at 24fire.
    for (const server of map.values()) {
      server.ddos = server.ips
        .filter((ip) => ip.version === 4)
        .map((ip) => ({ ip: ip.address, layer4: 'dynamic', layer7: 'off' }));
    }
    return map;
  }

  private get(ref: ServerRef): DemoServer {
    const server = this.servers.get(ref.externalId);
    if (!server) throw notFound('Demo server');
    return server;
  }

  private task(server: DemoServer, type: string, durationMs = 1500, then?: () => void): string {
    const task: ProviderTask = {
      id: `DEMO:${randomUUID()}`,
      type,
      status: 'running',
      startedAt: new Date().toISOString(),
      user: 'weblion-console',
    };
    server.tasks.unshift(task);
    server.tasks.splice(50);
    setTimeout(() => {
      task.status = 'ok';
      task.endedAt = new Date().toISOString();
      then?.();
    }, durationMs).unref();
    return task.id;
  }

  capabilities(): Capability[] {
    return [
      'power',
      'metrics',
      'monitoring',
      'traffic',
      'backups',
      'backupRestore',
      'backupDelete',
      'snapshots',
      'rescale',
      'rebuild',
      'rdns',
      'ddos',
      'iso',
      'passwordReset',
      'firewall',
      'delete',
      'config',
      'tasks',
      'networkInfo',
    ];
  }

  powerActions(): PowerAction[] {
    return ['start', 'shutdown', 'stop', 'reboot', 'reset'];
  }

  async testConnection() {
    return { servers: this.servers.size, mode: 'simulated' };
  }

  private snapshot(server: DemoServer): RemoteServer {
    const rand = rng(server.seed + Math.floor(Date.now() / 60_000));
    const running = server.status === 'running';
    return {
      externalId: server.externalId,
      name: server.name,
      kind: server.kind,
      status: server.status,
      specs: { ...server.specs },
      usage: running
        ? {
            cpuPercent: Math.round(rand() * 6000) / 100,
            memoryUsedMb: Math.round((server.specs.memoryMb ?? 0) * (0.3 + rand() * 0.5)),
            memoryTotalMb: server.specs.memoryMb,
            uptimeSeconds: 86_400 * 3 + Math.floor(rand() * 10_000),
          }
        : null,
      ips: server.ips.map((ip) => ({ ...ip })),
      os: server.os,
      node: server.node,
      meta: { ...server.meta, iso: server.iso },
    };
  }

  async listServers(): Promise<RemoteServer[]> {
    return [...this.servers.values()].map((s) => this.snapshot(s));
  }

  async getServer(ref: ServerRef): Promise<RemoteServer> {
    return this.snapshot(this.get(ref));
  }

  async power(ref: ServerRef, action: PowerAction): Promise<ActionResult> {
    const s = this.get(ref);
    const target: ServerStatus = action === 'stop' || action === 'shutdown' ? 'stopped' : 'running';
    if (action === 'start' && s.status === 'running') throw conflict('Server is already running');
    s.status =
      action === 'start' ? 'starting' : action === 'reboot' || action === 'reset' ? 'rebooting' : 'stopping';
    const id = this.task(s, `power:${action}`, 2000, () => {
      s.status = target;
    });
    return { providerRef: id, message: `${action} started` };
  }

  async getMetrics(ref: ServerRef, range: MetricRange): Promise<MetricsResult> {
    const s = this.get(ref);
    const steps = 70;
    const span = { hour: 3600, day: 86_400, week: 604_800, month: 2_678_400, year: 31_622_400 }[range];
    const step = Math.floor(span / steps);
    const now = Math.floor(Date.now() / 1000 / step) * step;
    const rand = rng(s.seed);
    const memTotal = (s.specs.memoryMb ?? 1024) * 1024 * 1024;
    const points: MetricPoint[] = [];
    for (let i = steps; i >= 0; i--) {
      const t = now - i * step;
      const wave = (Math.sin(t / (span / 6)) + 1) / 2;
      const noise = rand();
      const running = s.status === 'running';
      points.push({
        t,
        cpu: running ? Math.round((5 + wave * 35 + noise * 15) * 100) / 100 : 0,
        memUsed: running ? Math.round(memTotal * (0.35 + wave * 0.3 + noise * 0.05)) : 0,
        memTotal,
        netIn: running ? Math.round((50 + wave * 900 + noise * 200) * 1024) : 0,
        netOut: running ? Math.round((80 + wave * 1500 + noise * 300) * 1024) : 0,
        diskRead: running ? Math.round((wave * 4 + noise * 2) * 1024 * 1024) : 0,
        diskWrite: running ? Math.round((wave * 2 + noise * 3) * 1024 * 1024) : 0,
        ping: running ? Math.round(8 + noise * 6) : null,
      });
    }
    return {
      range,
      resolutionSeconds: step,
      series: [
        { key: 'cpu', unit: 'percent' },
        { key: 'memUsed', unit: 'bytes' },
        { key: 'memTotal', unit: 'bytes' },
        { key: 'netIn', unit: 'bytesPerSecond' },
        { key: 'netOut', unit: 'bytesPerSecond' },
        { key: 'diskRead', unit: 'bytesPerSecond' },
        { key: 'diskWrite', unit: 'bytesPerSecond' },
        { key: 'ping', unit: 'ms' },
      ],
      points,
    };
  }

  async getMonitoring(ref: ServerRef): Promise<MonitoringInfo> {
    this.get(ref);
    return {
      periods: [
        { key: 'LAST_24_HOURS', availability: 100, downtimeMinutes: 0, incidences: 0 },
        { key: 'LAST_7_DAYS', availability: 99.98, downtimeMinutes: 2, incidences: 1 },
        { key: 'LAST_30_DAYS', availability: 99.95, downtimeMinutes: 21, incidences: 3 },
        { key: 'LAST_90_DAYS', availability: 99.97, downtimeMinutes: 39, incidences: 5 },
      ],
      incidents: [
        {
          start: new Date(Date.now() - 3 * 86_400_000).toISOString(),
          end: new Date(Date.now() - 3 * 86_400_000 + 120_000).toISOString(),
          downtimeMinutes: 2,
          type: 'PING_TIMEOUT',
        },
      ],
    };
  }

  async getTraffic(ref: ServerRef): Promise<TrafficInfo> {
    const s = this.get(ref);
    const rand = rng(s.seed);
    const day = 86_400;
    const now = Math.floor(Date.now() / 1000 / day) * day;
    return {
      inBytes: Math.round(rand() * 200 * 1024 ** 3),
      outBytes: Math.round(rand() * 600 * 1024 ** 3),
      limitBytes: 20 * 1024 ** 4,
      periodStart: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
      log: Array.from({ length: 30 }, (_, i) => ({
        t: now - (29 - i) * day,
        inBytes: Math.round(rand() * 8 * 1024 ** 3),
        outBytes: Math.round(rand() * 20 * 1024 ** 3),
      })),
    };
  }

  async listBackups(ref: ServerRef) {
    return [...this.get(ref).backups];
  }

  async createBackup(ref: ServerRef, options: { description?: string }): Promise<ActionResult> {
    const s = this.get(ref);
    if (s.backups.length >= (s.specs.backupSlots ?? 3)) throw conflict('All backup slots are in use');
    const backup: BackupInfo = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      sizeBytes: null,
      description: options.description ?? null,
      status: 'running',
    };
    s.backups.unshift(backup);
    const id = this.task(s, 'backup', 3000, () => {
      backup.status = 'finished';
      backup.sizeBytes = 4.2 * 1024 ** 3;
    });
    return { providerRef: id, message: 'Backup started' };
  }

  async restoreBackup(ref: ServerRef, backupId: string): Promise<ActionResult> {
    const s = this.get(ref);
    if (!s.backups.some((b) => b.id === backupId)) throw notFound('Backup');
    s.status = 'restoring';
    return { providerRef: this.task(s, 'restore', 3000, () => (s.status = 'running')) };
  }

  async deleteBackup(ref: ServerRef, backupId: string): Promise<ActionResult> {
    const s = this.get(ref);
    const before = s.backups.length;
    s.backups = s.backups.filter((b) => b.id !== backupId);
    if (s.backups.length === before) throw notFound('Backup');
    return { message: 'Backup deleted' };
  }

  async listSnapshots(ref: ServerRef) {
    return [...this.get(ref).snapshots];
  }

  async createSnapshot(
    ref: ServerRef,
    options: { name: string; description?: string; includeRam?: boolean },
  ) {
    const s = this.get(ref);
    if (s.snapshots.some((x) => x.id === options.name)) throw conflict('A snapshot with this name exists');
    s.snapshots.unshift({
      id: options.name,
      description: options.description ?? null,
      createdAt: new Date().toISOString(),
      includesRam: !!options.includeRam,
      parent: s.snapshots[0]?.id ?? null,
    });
    return { providerRef: this.task(s, 'snapshot', 1000) };
  }

  async rollbackSnapshot(ref: ServerRef, snapshotId: string): Promise<ActionResult> {
    const s = this.get(ref);
    if (!s.snapshots.some((x) => x.id === snapshotId)) throw notFound('Snapshot');
    return { providerRef: this.task(s, 'rollback', 1500) };
  }

  async deleteSnapshot(ref: ServerRef, snapshotId: string): Promise<ActionResult> {
    const s = this.get(ref);
    s.snapshots = s.snapshots.filter((x) => x.id !== snapshotId);
    return { providerRef: this.task(s, 'delsnapshot', 500) };
  }

  async getConfig(ref: ServerRef) {
    const s = this.get(ref);
    return {
      name: s.name,
      cores: s.specs.cores,
      memory: s.specs.memoryMb,
      disk: `${s.specs.diskGb}G`,
      os: s.os,
      iso: s.iso,
    };
  }

  async rename(ref: ServerRef, name: string): Promise<ActionResult> {
    this.get(ref).name = name;
    return { message: 'Renamed' };
  }

  async rescale(ref: ServerRef, request: RescaleRequest): Promise<ActionResult> {
    const s = this.get(ref);
    if (request.plan) return this.changePlan(s, request.plan, !!request.upgradeDisk);
    if (request.diskGb && request.diskGb <= (s.specs.diskGb ?? 0)) throw badRequest('Disks can only grow');
    s.specs = {
      ...s.specs,
      cores: request.cores ?? s.specs.cores,
      memoryMb: request.memoryMb ?? s.specs.memoryMb,
      diskGb: request.diskGb ?? s.specs.diskGb,
    };
    return { providerRef: this.task(s, 'rescale', 1000) };
  }

  /** Like Hetzner change_type: the disk only grows with upgradeDisk, and never shrinks. */
  private changePlan(s: DemoServer, planId: string, upgradeDisk: boolean): ActionResult {
    const plan = PLANS.find((p) => p.id === planId && p.architecture === s.architecture);
    if (!plan || plan.deprecated) throw badRequest('Unknown plan');
    const disk = s.specs.diskGb ?? 0;
    if (plan.diskGb < disk) {
      throw conflict(`The disk (${disk} GB) is larger than the disk of ${plan.label} (${plan.diskGb} GB)`);
    }
    s.specs = {
      ...s.specs,
      cores: plan.cores,
      memoryMb: plan.memoryMb,
      diskGb: upgradeDisk ? plan.diskGb : disk,
    };
    s.meta = { ...s.meta, plan: plan.id };
    return { providerRef: this.task(s, 'change_type', 1000), message: `Changed to ${plan.label}` };
  }

  async listPlans(ref?: ServerRef): Promise<ServerPlan[]> {
    // A server keeps its architecture, so it only sees plans it can change to.
    const architecture = ref ? this.get(ref).architecture : null;
    return PLANS.filter((p) => !architecture || p.architecture === architecture).map((p) => ({
      ...p,
      locations: [...p.locations],
    }));
  }

  async listLocations(): Promise<ProviderLocation[]> {
    return LOCATIONS.map((l) => ({ ...l }));
  }

  async listImages() {
    return IMAGES;
  }

  async rebuild(ref: ServerRef, imageId: string): Promise<ActionResult> {
    const s = this.get(ref);
    const image = IMAGES.find((i) => i.id === imageId);
    if (!image) throw badRequest('Unknown image');
    s.status = 'installing';
    return {
      providerRef: this.task(s, 'rebuild', 4000, () => {
        s.status = 'running';
        s.os = image.label;
      }),
    };
  }

  async resetPassword(ref: ServerRef) {
    this.get(ref);
    return { message: 'Password reset', password: randomUUID().replace(/-/g, '').slice(0, 20) };
  }

  async deleteServer(ref: ServerRef): Promise<ActionResult> {
    const s = this.get(ref);
    if (s.status !== 'stopped') throw conflict('The server must be stopped before it can be deleted');
    this.servers.delete(ref.externalId);
    return { message: 'Deleted' };
  }

  async createServer(request: CreateServerRequest) {
    const id = `demo-${this.config.seed ?? 42}-${randomUUID().slice(0, 8)}`;
    const image = IMAGES.find((i) => i.id === request.imageId) ?? IMAGES[0]!;
    const plan = request.plan ? PLANS.find((p) => p.id === request.plan) : undefined;
    if (request.plan && (!plan || plan.deprecated)) throw badRequest('Unknown plan');
    const location = request.location ? LOCATIONS.find((l) => l.id === request.location) : undefined;
    if (request.location && !location) throw badRequest('Unknown location');
    if (plan && location && plan.locations.length > 0 && !plan.locations.includes(location.id)) {
      throw badRequest(`${plan.label} is not available in ${location.label}`);
    }
    const size = plan ?? request;
    this.servers.set(id, {
      externalId: id,
      name: request.name,
      kind: 'vm',
      status: 'running',
      specs: { cores: size.cores, memoryMb: size.memoryMb, diskGb: size.diskGb, backupSlots: 3 },
      ips: [{ address: `185.200.1.${this.servers.size + 10}`, version: 4 }],
      os: image.label,
      node: request.node ?? 'demo-node-1',
      // Same shape as the Hetzner adapter, so the console shows the location per server.
      meta: {
        ...(plan ? { plan: plan.id } : {}),
        ...(location
          ? { datacenter: { name: location.id, city: location.city, country: location.country } }
          : {}),
      },
      backups: [],
      snapshots: [],
      tasks: [],
      firewall: { enabled: false, rules: [] },
      ddos: [],
      iso: null,
      seed: this.servers.size + 100,
      architecture: plan?.architecture === 'arm' ? 'arm' : 'x86',
    });
    return { externalId: id, message: 'Server created' };
  }

  async setRdns(ref: ServerRef, ip: string, hostname: string): Promise<ActionResult> {
    const entry = this.get(ref).ips.find((i) => i.address === ip);
    if (!entry) throw notFound('IP address');
    entry.rdns = hostname;
    return { message: 'rDNS updated' };
  }

  async getDdos(ref: ServerRef) {
    return this.get(ref).ddos.map((d) => ({ ...d }));
  }

  async setDdos(ref: ServerRef, settings: DdosSettings): Promise<ActionResult> {
    const s = this.get(ref);
    const entry = s.ddos.find((d) => d.ip === settings.ip);
    if (!entry) throw notFound('IP address');
    Object.assign(entry, settings);
    return { message: 'DDoS settings updated' };
  }

  async listIsos() {
    return ISOS;
  }

  async mountIso(ref: ServerRef, isoId: string): Promise<ActionResult> {
    if (!ISOS.some((i) => i.id === isoId)) throw badRequest('Unknown ISO');
    this.get(ref).iso = isoId;
    return { message: 'ISO mounted' };
  }

  async unmountIso(ref: ServerRef): Promise<ActionResult> {
    this.get(ref).iso = null;
    return { message: 'ISO removed' };
  }

  async getFirewall(ref: ServerRef): Promise<FirewallInfo> {
    const fw = this.get(ref).firewall;
    return { ...fw, rules: fw.rules.map((r) => ({ ...r })) };
  }

  async addFirewallRule(ref: ServerRef, rule: Omit<FirewallRule, 'pos'>): Promise<ActionResult> {
    const fw = this.get(ref).firewall;
    fw.rules = [{ ...rule, pos: 0 }, ...fw.rules].map((r, i) => ({ ...r, pos: i }));
    return { message: 'Rule added' };
  }

  async deleteFirewallRule(ref: ServerRef, pos: number): Promise<ActionResult> {
    const fw = this.get(ref).firewall;
    fw.rules = fw.rules.filter((r) => r.pos !== pos).map((r, i) => ({ ...r, pos: i }));
    return { message: 'Rule deleted' };
  }

  async setFirewallEnabled(ref: ServerRef, enabled: boolean): Promise<ActionResult> {
    this.get(ref).firewall.enabled = enabled;
    return { message: 'ok' };
  }

  async listTasks(ref: ServerRef) {
    return this.get(ref).tasks.map((t) => ({ ...t }));
  }

  async getTaskStatus(ref: ServerRef, providerRef: string) {
    return this.get(ref).tasks.find((t) => t.id === providerRef) ?? null;
  }

  async overview(): Promise<InfraOverview> {
    const servers = [...this.servers.values()];
    return {
      version: 'demo',
      nodes: ['demo-node-1', 'demo-node-2'].map((name, i) => ({
        name,
        status: 'online',
        cpuPercent: 18 + i * 9,
        cores: 32,
        memoryUsed: (96 + i * 40) * 1024 ** 3,
        memoryTotal: 256 * 1024 ** 3,
        uptimeSeconds: 86_400 * (40 + i),
      })),
      storages: [
        {
          name: 'local-zfs',
          node: 'demo-node-1',
          type: 'zfspool',
          used: 1.2 * 1024 ** 4,
          total: 3.5 * 1024 ** 4,
          content: ['images', 'rootdir'],
          shared: false,
        },
        {
          name: 'pbs',
          node: null,
          type: 'pbs',
          used: 4.1 * 1024 ** 4,
          total: 12 * 1024 ** 4,
          content: ['backup'],
          shared: true,
        },
      ],
      facts: [
        { label: 'Servers', value: String(servers.length) },
        { label: 'Running', value: String(servers.filter((s) => s.status === 'running').length) },
        { label: 'Domains', value: String(this.hosting.listDomains().length) },
        { label: 'Web spaces', value: String(this.hosting.listWebspaces().length) },
      ],
    };
  }

  // --- Domains & web spaces -------------------------------------------------------

  /** Everything, so the dev stack shows every domain feature. */
  domainCapabilities(): DomainCapability[] {
    return [...DOMAIN_CAPABILITIES];
  }

  dnsRecordTypes(): DnsRecordType[] {
    return [...DNS_RECORD_TYPES];
  }

  async listDomains(): Promise<RemoteDomain[]> {
    return this.hosting.listDomains();
  }

  async getDomain(externalId: string): Promise<DomainInfo> {
    return this.hosting.getDomain(externalId);
  }

  async getDomainAuthcode(externalId: string): Promise<string | null> {
    return this.hosting.getDomainAuthcode(externalId);
  }

  async listDnsRecords(externalId: string): Promise<DnsRecord[]> {
    return this.hosting.listDnsRecords(externalId);
  }

  async addDnsRecord(externalId: string, input: DnsRecordInput): Promise<DnsRecord> {
    return this.hosting.addDnsRecord(externalId, input);
  }

  async updateDnsRecord(externalId: string, recordId: string, patch: DnsRecordPatch): Promise<DnsRecord> {
    return this.hosting.updateDnsRecord(externalId, recordId, patch);
  }

  async deleteDnsRecord(externalId: string, recordId: string): Promise<void> {
    this.hosting.deleteDnsRecord(externalId, recordId);
  }

  async dnsWritable(): Promise<boolean> {
    return true;
  }

  async setNameservers(externalId: string, nameservers: string[]): Promise<ActionResult> {
    return this.hosting.setNameservers(externalId, nameservers);
  }

  async setDomainLock(externalId: string, locked: boolean): Promise<ActionResult> {
    return this.hosting.setDomainLock(externalId, locked);
  }

  async setDomainAutoRenew(externalId: string, enabled: boolean): Promise<ActionResult> {
    return this.hosting.setDomainAutoRenew(externalId, enabled);
  }

  async renewDomain(externalId: string, years: number, expiresAt?: string | null): Promise<ActionResult> {
    return this.hosting.renewDomain(externalId, years, expiresAt);
  }

  async listWebspaces(): Promise<RemoteWebspace[]> {
    return this.hosting.listWebspaces();
  }

  async getWebspace(externalId: string): Promise<WebspaceInfo> {
    return this.hosting.getWebspace(externalId);
  }

  async getWebspaceCredentials(externalId: string): Promise<WebspaceCredentials> {
    return this.hosting.getWebspaceCredentials(externalId);
  }

  async rawRequest(method: string, path: string, body?: Record<string, unknown>): Promise<RawResponse> {
    return { status: 200, data: { method, path, body: body ?? null, note: 'Demo provider echo' } };
  }
}
