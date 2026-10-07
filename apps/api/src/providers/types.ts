import type {
  BackupInfo,
  Capability,
  DdosSettings,
  FirewallInfo,
  FirewallRule,
  ImageOption,
  IpAddress,
  IsoOption,
  MetricRange,
  MetricsResult,
  MonitoringInfo,
  PowerAction,
  ProviderTask,
  ProviderType,
  RescaleRequest,
  ServerKind,
  ServerSpecs,
  ServerStatus,
  ServerUsage,
  SnapshotInfo,
  TrafficInfo,
} from '@weblion/shared';
import type WebSocket from 'ws';

/** A server as reported by a provider, before it is stored in the panel. */
export interface RemoteServer {
  externalId: string;
  name: string;
  kind: ServerKind;
  status: ServerStatus;
  specs: ServerSpecs;
  usage?: ServerUsage | null;
  ips: IpAddress[];
  os?: string | null;
  node?: string | null;
  meta?: Record<string, unknown>;
}

/** What an adapter needs to address a stored server. */
export interface ServerRef {
  externalId: string;
  kind: ServerKind;
  node: string | null;
  meta: Record<string, unknown>;
}

export interface ActionResult {
  /** Provider side task reference (Proxmox UPID, 24fire backup id, ...). */
  providerRef?: string | null;
  message?: string;
}

export type ConsoleSession =
  | { type: 'url'; url: string }
  | {
      type: 'vnc';
      /** Password the noVNC client must send (Proxmox VNC ticket). */
      password: string;
      /** Opens the upstream websocket. Called once the browser connected to our bridge. */
      connect: () => Promise<WebSocket>;
    };

export interface InfraNode {
  name: string;
  status: string;
  cpuPercent: number | null;
  cores: number | null;
  memoryUsed: number | null;
  memoryTotal: number | null;
  uptimeSeconds: number | null;
}

export interface InfraStorage {
  name: string;
  node: string | null;
  type: string | null;
  used: number | null;
  total: number | null;
  content: string[];
  shared: boolean;
}

export interface InfraOverview {
  version?: string | null;
  nodes: InfraNode[];
  storages: InfraStorage[];
  /** Free form provider facts, e.g. 24fire account balance. */
  facts: { label: string; value: string }[];
}

export interface CreateServerRequest {
  name: string;
  node?: string;
  cores: number;
  memoryMb: number;
  diskGb: number;
  /** Template or image to start from. */
  imageId?: string;
  storage?: string;
  start?: boolean;
}

export interface RawResponse {
  status: number;
  data: unknown;
}

export interface ProviderAdapter {
  readonly type: ProviderType;

  capabilities(server?: ServerRef): Capability[];
  powerActions(server?: ServerRef): PowerAction[];

  testConnection(): Promise<Record<string, unknown>>;
  listServers(): Promise<RemoteServer[]>;
  getServer(ref: ServerRef): Promise<RemoteServer>;

  power?(ref: ServerRef, action: PowerAction): Promise<ActionResult>;
  getMetrics?(ref: ServerRef, range: MetricRange): Promise<MetricsResult>;
  getMonitoring?(ref: ServerRef): Promise<MonitoringInfo>;
  getTraffic?(ref: ServerRef): Promise<TrafficInfo>;

  listBackups?(ref: ServerRef): Promise<BackupInfo[]>;
  createBackup?(ref: ServerRef, options: { description?: string }): Promise<ActionResult>;
  restoreBackup?(ref: ServerRef, backupId: string): Promise<ActionResult>;
  deleteBackup?(ref: ServerRef, backupId: string): Promise<ActionResult>;

  listSnapshots?(ref: ServerRef): Promise<SnapshotInfo[]>;
  createSnapshot?(
    ref: ServerRef,
    options: { name: string; description?: string; includeRam?: boolean },
  ): Promise<ActionResult>;
  rollbackSnapshot?(ref: ServerRef, snapshotId: string): Promise<ActionResult>;
  deleteSnapshot?(ref: ServerRef, snapshotId: string): Promise<ActionResult>;

  getConfig?(ref: ServerRef): Promise<Record<string, unknown>>;
  rename?(ref: ServerRef, name: string): Promise<ActionResult>;
  rescale?(ref: ServerRef, request: RescaleRequest): Promise<ActionResult>;
  listImages?(ref?: ServerRef): Promise<ImageOption[]>;
  rebuild?(ref: ServerRef, imageId: string): Promise<ActionResult>;
  resetPassword?(ref: ServerRef): Promise<ActionResult & { password?: string }>;
  deleteServer?(ref: ServerRef): Promise<ActionResult>;
  createServer?(request: CreateServerRequest): Promise<ActionResult & { externalId?: string }>;

  setRdns?(ref: ServerRef, ip: string, hostname: string): Promise<ActionResult>;
  getDdos?(ref: ServerRef): Promise<DdosSettings[]>;
  setDdos?(ref: ServerRef, settings: DdosSettings): Promise<ActionResult>;

  listIsos?(ref: ServerRef): Promise<IsoOption[]>;
  mountIso?(ref: ServerRef, isoId: string): Promise<ActionResult>;
  unmountIso?(ref: ServerRef): Promise<ActionResult>;

  getFirewall?(ref: ServerRef): Promise<FirewallInfo>;
  addFirewallRule?(ref: ServerRef, rule: Omit<FirewallRule, 'pos'>): Promise<ActionResult>;
  deleteFirewallRule?(ref: ServerRef, pos: number): Promise<ActionResult>;
  setFirewallEnabled?(ref: ServerRef, enabled: boolean): Promise<ActionResult>;

  listTasks?(ref: ServerRef): Promise<ProviderTask[]>;
  /** Status of a task started earlier, so long running actions can be tracked. */
  getTaskStatus?(ref: ServerRef, providerRef: string): Promise<ProviderTask | null>;
  openConsole?(ref: ServerRef): Promise<ConsoleSession>;

  overview?(): Promise<InfraOverview>;
  /** Unfiltered access to the provider API for the admin explorer. */
  rawRequest?(method: string, path: string, body?: Record<string, unknown>): Promise<RawResponse>;
}

export interface Fire24Config {
  apiKey: string;
  baseUrl: string;
}

export interface ProxmoxConfig {
  baseUrl: string;
  tokenId: string;
  tokenSecret: string;
  verifyTls: boolean;
  /** PEM of a private CA or the self-signed node certificate. */
  caCert?: string;
  /** Default vzdump target for backups created from the panel. */
  backupStorage?: string;
}

export interface DemoConfig {
  seed?: number;
  servers?: number;
}

export type ProviderConfig = Fire24Config | ProxmoxConfig | DemoConfig;
