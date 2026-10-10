import type {
  BackupInfo,
  Capability,
  CdnSettingPatch,
  CdnSettings,
  DdosSettings,
  DnsRecord,
  DnsRecordInput,
  DnsRecordType,
  DomainCapability,
  DomainInfo,
  DomainKind,
  FirewallInfo,
  FirewallRule,
  ImageOption,
  IpAddress,
  IsoOption,
  MailAliasDto,
  MailClientSettings,
  MailDomainInfo,
  MailPasswordPolicy,
  MailRateLimit,
  MailboxDto,
  MailboxState,
  MetricRange,
  MetricsResult,
  MonitoringInfo,
  PowerAction,
  ProviderLocation,
  ProviderTask,
  ProviderType,
  RescaleRequest,
  ServerKind,
  ServerPlan,
  ServerSpecs,
  ServerStatus,
  ServerUsage,
  SnapshotInfo,
  TrafficInfo,
  WebspaceCredentials,
  WebspaceInfo,
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
  /** Providers with fixed sizes (Hetzner): plan id instead of cores/memory/disk. */
  plan?: string;
  /** Provider location id (Hetzner "fsn1", ...). */
  location?: string;
}

export interface RawResponse {
  status: number;
  data: unknown;
}

/** A domain as reported by a provider. `info` never contains the auth code. */
export interface RemoteDomain {
  externalId: string;
  name: string;
  status: string | null;
  /**
   * The facts the list call knows. Fields left out (or null) keep their stored value, so a
   * cheap list call (Joker: expiry and flags only) does not wipe what a detail call stored.
   */
  info: Partial<DomainInfo> | null;
  /** Provider extras without secrets (e.g. 24fire accounting data). */
  meta?: Record<string, unknown>;
}

/** A web space as reported by a provider. `info` never contains the password. */
export interface RemoteWebspace {
  externalId: string;
  name: string;
  info: WebspaceInfo | null;
  meta?: Record<string, unknown>;
}

/** A Nextcloud user as the instance reports it. Never carries a password. */
export interface RemoteCloudAccount {
  /** Nextcloud user id = login name. */
  externalId: string;
  displayName: string | null;
  email: string | null;
  /** null = unlimited. */
  quotaBytes: number | null;
  usedBytes: number | null;
  enabled: boolean;
  lastLoginAt: string | null;
  groups: string[];
}

export interface CloudAccountInput {
  /** Full Nextcloud user id, e.g. "anna@muster-ag". */
  username: string;
  /** Without a password Nextcloud mails the user an invitation link (needs email). */
  password?: string;
  displayName?: string | null;
  email?: string | null;
  quotaBytes: number;
  /** Groups the account joins; missing ones are created. */
  groups: string[];
  /** BCP 47 language for Nextcloud's UI and mails, e.g. "de". */
  language?: string;
}

/** Fields left out keep their current value. */
export interface CloudAccountPatch {
  displayName?: string | null;
  email?: string | null;
  quotaBytes?: number;
  enabled?: boolean;
}

/** Partial DNS change. Fields left out keep their current value. */
export type DnsRecordPatch = Partial<DnsRecordInput>;

/** A mail domain as Mailcow reports it. */
export interface RemoteMailDomain {
  /** ASCII name (Mailcow domain_name). */
  externalId: string;
  info: MailDomainInfo;
}

/** Limits as Mailcow takes them: MiB integers. */
export interface MailDomainLimitsInput {
  maxMailboxes: number;
  maxAliases: number;
  quotaMb: number;
  defaultMailboxQuotaMb: number;
  maxMailboxQuotaMb: number;
  /** null = no rate limit. */
  rateLimit: MailRateLimit | null;
}

export interface MailDomainInput {
  /** ASCII name, checked with mailDomainAscii. */
  domain: string;
  description: string | null;
  limits: MailDomainLimitsInput;
  dkim: { selector: string; keySize: number };
  /** Restart SOGo so webmail knows the domain (interrupts webmail for every user briefly). */
  restartSogo: boolean;
}

/** Fields left out keep their value. rateLimit null removes it. */
export type MailDomainPatch = Partial<MailDomainLimitsInput> & { active?: boolean };

export interface MailboxInput {
  localPart: string;
  /** ASCII domain. */
  domain: string;
  name: string | null;
  quotaMb: number;
  /** Required: Mailcow has no invitation flow. */
  password: string;
}

export interface MailboxPatch {
  /** Mailcow cannot clear a name, only replace it. */
  name?: string;
  quotaMb?: number;
  state?: MailboxState;
}

export interface MailAliasInput {
  /** "info@kunde.ch" or "@kunde.ch" (catch-all), ASCII domain. */
  address: string;
  targets: string[];
  active: boolean;
}

export interface MailAliasPatch {
  targets?: string[];
  active?: boolean;
}

export interface DkimKey {
  selector: string;
  /** Base64 public key (the p= value). */
  publicKey: string;
  keyLength: string | null;
  /** "v=DKIM1;k=rsa;t=s;s=email;p=<publicKey>", one unquoted string. */
  txt: string;
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
  /** `password`: a new root password the provider set (Hetzner system images). Shown once, never stored. */
  rebuild?(ref: ServerRef, imageId: string): Promise<ActionResult & { password?: string }>;
  resetPassword?(ref: ServerRef): Promise<ActionResult & { password?: string }>;
  deleteServer?(ref: ServerRef): Promise<ActionResult>;
  createServer?(request: CreateServerRequest): Promise<ActionResult & { externalId?: string }>;
  /** Fixed sizes for rescale and create (Hetzner server types). With a ref: what this server can change to. */
  listPlans?(ref?: ServerRef): Promise<ServerPlan[]>;
  /** Locations for createServer. */
  listLocations?(): Promise<ProviderLocation[]>;

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

  // Domains & DNS (module "dns"). Addressed by the provider's id of the domain.
  listDomains?(): Promise<RemoteDomain[]>;
  getDomain?(externalId: string): Promise<DomainInfo>;
  /** Transfer auth code. Only for the audited reveal route, never stored. */
  getDomainAuthcode?(externalId: string): Promise<string | null>;
  listDnsRecords?(externalId: string): Promise<DnsRecord[]>;
  /** Returns the created record, or null if the provider does not report it back. */
  addDnsRecord?(externalId: string, input: DnsRecordInput): Promise<DnsRecord | null>;
  /** Returns the changed record, or null if the provider does not report it back. */
  updateDnsRecord?(externalId: string, recordId: string, patch: DnsRecordPatch): Promise<DnsRecord | null>;
  deleteDnsRecord?(externalId: string, recordId: string): Promise<void>;
  /** Whether DNS changes are possible right now (24fire: only with an active 24fire+ plan). */
  dnsWritable?(): Promise<boolean>;
  /** Domain features beyond listing. Without it: "dns" and "authcode" as far as implemented. */
  domainCapabilities?(): DomainCapability[];
  /** Record types addDnsRecord/updateDnsRecord accept. Without it: all DNS_RECORD_TYPES. */
  dnsRecordTypes?(): DnsRecordType[];
  /** Replaces the delegation. Takes effect at the registry, possibly with a delay. */
  setNameservers?(externalId: string, nameservers: string[]): Promise<ActionResult>;
  setDomainLock?(externalId: string, locked: boolean): Promise<ActionResult>;
  /** Charged to the provider account on expiry. Platform staff only. */
  setDomainAutoRenew?(externalId: string, enabled: boolean): Promise<ActionResult>;
  /**
   * Extends the registration by whole years, charged right away. Platform staff only.
   * `expiresAt` is the expiry the renewal counts from, as the operator saw it: when the
   * domain runs longer by now (a renewal went through meanwhile), nothing is sent (409).
   */
  renewDomain?(externalId: string, years: number, expiresAt?: string | null): Promise<ActionResult>;
  /** "zone" for providers that host DNS zones only (Cloudflare). Default "registration". */
  domainKind?(): DomainKind;
  /** Whether createZone works with this connection (Cloudflare: account id configured). Default true when createZone exists. */
  canCreateZones?(): boolean;
  /** Creates a DNS zone, or returns the one that already exists for this name in the account (created: false). Never imports records. */
  createZone?(name: string): Promise<{ zone: RemoteDomain; created: boolean }>;
  /** Asks the provider to check the delegation of a pending zone again now. 409 if the zone is not pending. */
  checkZoneActivation?(externalId: string): Promise<ActionResult>;
  getCdnSettings?(externalId: string): Promise<CdnSettings>;
  /** One setting per call. Returns the settings after the change. 422 if the setting is not editable. */
  updateCdnSetting?(externalId: string, patch: CdnSettingPatch): Promise<CdnSettings>;
  /** Purges the whole cache of the zone. providerRef: the provider's request id. */
  purgeCache?(externalId: string): Promise<ActionResult>;

  // Cloud storage (module "storage", Nextcloud). Addressed by the user id.
  /** Every user of the instance (the sync only updates accounts the panel knows). */
  listCloudAccounts?(): Promise<RemoteCloudAccount[]>;
  getCloudAccount?(externalId: string): Promise<RemoteCloudAccount>;
  createCloudAccount?(input: CloudAccountInput): Promise<RemoteCloudAccount>;
  updateCloudAccount?(externalId: string, patch: CloudAccountPatch): Promise<void>;
  /** Only for the audited password route, the password is never stored. */
  setCloudAccountPassword?(externalId: string, password: string): Promise<void>;
  /** Deletes the user and all of its files. */
  deleteCloudAccount?(externalId: string): Promise<void>;
  /** Sends the instance's welcome mail again (with a set-password link while none is set). Needs an email. */
  resendCloudInvite?(externalId: string): Promise<void>;
  /** Where users log in, e.g. https://cloud.weblion.ch. */
  cloudLoginUrl?(): string;

  // E-mail (module "mail", Mailcow). Domains by ASCII name, mailboxes by address, aliases by
  // Mailcow's numeric id. Missing objects throw a ProviderError with upstreamStatus 404.
  listMailDomains?(): Promise<RemoteMailDomain[]>;
  getMailDomain?(domain: string): Promise<RemoteMailDomain>;
  /** warnings: non-fatal notes from Mailcow, e.g. a failed SOGo restart. */
  createMailDomain?(input: MailDomainInput): Promise<{ domain: RemoteMailDomain; warnings: string[] }>;
  updateMailDomain?(domain: string, patch: MailDomainPatch): Promise<void>;
  /** Refused (409) while mailboxes exist. Leaves the DKIM key, see deleteDkim. */
  deleteMailDomain?(domain: string): Promise<{ warnings: string[] }>;
  listMailboxes?(domain: string): Promise<MailboxDto[]>;
  getMailbox?(address: string): Promise<MailboxDto>;
  createMailbox?(input: MailboxInput): Promise<MailboxDto>;
  updateMailbox?(address: string, patch: MailboxPatch): Promise<void>;
  /** Only for the audited password route; the password is never stored. */
  setMailboxPassword?(address: string, password: string): Promise<void>;
  /** Deletes the mailbox and its mail. */
  deleteMailbox?(address: string): Promise<void>;
  listMailAliases?(domain: string): Promise<MailAliasDto[]>;
  getMailAlias?(id: string): Promise<MailAliasDto>;
  createMailAlias?(input: MailAliasInput): Promise<MailAliasDto>;
  updateMailAlias?(id: string, patch: MailAliasPatch): Promise<void>;
  deleteMailAlias?(id: string): Promise<void>;
  /** null when the domain has no key. Never returns the private key. */
  getDkim?(domain: string): Promise<DkimKey | null>;
  /** 409 when a key exists. */
  createDkim?(domain: string, options: { selector: string; keySize: number }): Promise<DkimKey>;
  deleteDkim?(domain: string): Promise<void>;
  mailPasswordPolicy?(): Promise<MailPasswordPolicy>;
  mailClientSettings?(): MailClientSettings;

  // Web spaces (module "webhosting"). Read only: providers offer no provisioning API.
  listWebspaces?(): Promise<RemoteWebspace[]>;
  getWebspace?(externalId: string): Promise<WebspaceInfo>;
  /** Control panel login. Only for the audited reveal route, never stored. */
  getWebspaceCredentials?(externalId: string): Promise<WebspaceCredentials>;

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

/** Hetzner Cloud API, one project per connection. */
export interface HetznerConfig {
  /** Project API token (read & write). */
  apiToken: string;
  /** https://api.hetzner.cloud/v1 */
  baseUrl: string;
}

/** Nextcloud OCS API with an admin account (an app password, not the login password). */
export interface NextcloudConfig {
  /** e.g. https://cloud.weblion.ch */
  baseUrl: string;
  username: string;
  appPassword: string;
  /** Prefix of the per-organization groups, default "weblion-". */
  groupPrefix?: string;
}

/** Joker.com DMAPI. Either an API key (recommended) or reseller username and password. */
export interface JokerConfig {
  apiKey?: string;
  username?: string;
  password?: string;
  /** https://dmapi.joker.com/request, or https://dmapi.ote.joker.com/request for OT&E tests. */
  baseUrl: string;
}

/** Cloudflare API v4, one API token per connection. */
export interface CloudflareConfig {
  /** API token (Bearer), never the Global API Key. */
  apiToken: string;
  /** https://api.cloudflare.com/client/v4 */
  baseUrl: string;
  /** 32 hex characters. Only needed to create zones (DNS move); also filters the zone list. */
  accountId?: string;
}

/** Mailcow (e-mail). */
export interface MailcowConfig {
  /** Where the API answers, e.g. https://mail.weblion.one */
  baseUrl: string;
  /** Read-write API key, characters a-z A-Z 0-9 and "-". */
  apiKey: string;
  /** Public host name for MX, IMAP, SMTP and webmail. Default: host of baseUrl. */
  mailHost?: string;
}

export interface DemoConfig {
  seed?: number;
  servers?: number;
  /** Simulated Cloudflare account instead of the demo cloud (second, opt-in demo connection). */
  flavor?: 'cloudflare';
}

export type ProviderConfig =
  | Fire24Config
  | ProxmoxConfig
  | HetznerConfig
  | JokerConfig
  | NextcloudConfig
  | CloudflareConfig
  | MailcowConfig
  | DemoConfig;
