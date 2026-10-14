import type {
  BackupInfo,
  Capability,
  CdnSettingPatch,
  CdnSettings,
  CreatableWebsiteType,
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
  MediaLibraryRef,
  MediaPolicyState,
  MetricRange,
  MetricsResult,
  MonitorConfig,
  MonitorEvent,
  MonitorFacts,
  MonitorHistoryDto,
  MonitorHistoryRange,
  MonitorKind,
  MonitorStatus,
  MonitoringInfo,
  PhoneRingGroup,
  PhoneSystemInfo,
  PhoneTrunk,
  PhoneUser,
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
  UnmanagedWebsiteDto,
  WebsiteFacts,
  WebsiteServerOptions,
  WebsiteTemplate,
  WebsiteType,
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

/** A managed website as the server reports it. Never carries a password. */
export interface RemoteWebsite {
  /** ASCII domain = webspaces.external_id. */
  domain: string;
  facts: WebsiteFacts;
  databases: RemoteWebsiteDatabase[];
}

export interface RemoteWebsiteDatabase {
  name: string;
  /** Database users with access to it (CloudPanel's database_user rows). */
  users: string[];
  sizeBytes: number | null;
}

/** Facts of a CloudPanel server (the wrapper's "info"). Cached 10 minutes by the adapter. */
export interface WebsiteServerInfo {
  agentVersion: string;
  /** Wire protocol version the wrapper speaks (1). */
  protocol: number;
  /** Package version, e.g. "2.5.4-3+clp-noble". */
  cloudpanelVersion: string | null;
  hostname: string;
  os: string | null;
  /** Global addresses of the server. */
  ipv4: string[];
  ipv6: string[];
  /** Installed PHP versions, newest first. */
  phpVersions: string[];
  templates: WebsiteTemplate[];
  nodejsVersions: string[];
  /** config.json "nodejs" on the server (Node.js sites allowed there at all). */
  nodejsEnabled: boolean;
  allowRemoteAdopt: boolean;
  protectedDomains: string[];
  counts: { sites: number; managed: number; unmanaged: number };
}

export interface WebsiteDatabaseInput {
  /** Full name, e.g. "shop_mueller_wp". */
  name: string;
  userName: string;
  password: string;
}

export interface WebsiteInput {
  /** ASCII domain. */
  domain: string;
  type: CreatableWebsiteType;
  phpVersion: string | null;
  template: string | null;
  nodejsVersion: string | null;
  siteUser: string;
  password: string;
  database: WebsiteDatabaseInput | null;
}

// --- CloudPanel wire protocol v1 -------------------------------------------------------
// The contract between the CloudPanel adapter and the root wrapper weblion-clp on each server:
// one SSH exec per operation, one JSON line (WireRequest) on stdin, one JSON line (WireAnswer)
// on stdout, exit code 0 with ok: true or 1 with ok: false. Unknown request fields are an
// "invalid" error on the server; unknown answer fields are ignored by the console.

export type WireOp =
  | 'info'
  | 'list'
  | 'get'
  | 'unmanaged'
  | 'create'
  | 'delete'
  | 'password'
  | 'db-add'
  | 'db-delete'
  | 'db-password'
  | 'cert'
  | 'adopt'
  | 'forget';

/** Closed list of the wrapper's error codes. */
export type WireErrorCode =
  | 'invalid'
  | 'exists'
  | 'not_found'
  | 'not_managed'
  | 'protected'
  | 'adopt_disabled'
  | 'busy'
  | 'version'
  | 'clpctl_failed'
  | 'timeout'
  | 'internal';

export interface WireError {
  code: WireErrorCode;
  message: string;
  /** The argument that failed (invalid, exists). */
  field?: string;
  /** create: true = nothing of the new site is left on the server. */
  rolledBack?: boolean;
  /** clpctl's text, redacted and truncated by the wrapper. */
  output?: string;
}

export interface WireCertificate {
  type: string | null;
  letsEncrypt: boolean | null;
  /** ISO time. */
  expiresAt: string | null;
}

export interface WireDatabase {
  name: string;
  users: string[];
  sizeBytes: number | null;
}

/** null until the server measured once (weblion-clp refresh-usage). */
export interface WireUsage {
  diskBytes: number | null;
  databaseBytes: number | null;
  measuredAt: string | null;
}

/** A managed site as the wrapper reports it ("site" in every answer that returns one). */
export interface WireSite {
  domain: string;
  type: WebsiteType;
  siteUser: string;
  homeDirectory: string;
  webRoot: string | null;
  application: string | null;
  phpVersion: string | null;
  nodejsVersion: string | null;
  appPort: number | null;
  /** ISO time, null on old panels. */
  createdAt: string | null;
  certificate: WireCertificate | null;
  databases: WireDatabase[];
  usage: WireUsage | null;
}

/** Answer of "info": the server facts plus the first line of `clpctl --version`. */
export type WireInfo = WebsiteServerInfo & { cliVersion: string | null };

/** Arguments, secrets and answer data of every operation. Passwords only ever travel in secrets. */
export interface WireOps {
  info: { args: Record<string, never>; secrets: never; data: WireInfo };
  list: { args: Record<string, never>; secrets: never; data: { sites: WireSite[] } };
  get: { args: { domain: string }; secrets: never; data: { site: WireSite } };
  unmanaged: {
    args: Record<string, never>;
    secrets: never;
    data: { sites: UnmanagedWebsiteDto[]; allowRemoteAdopt: boolean };
  };
  create: {
    args: {
      domain: string;
      type: CreatableWebsiteType;
      phpVersion?: string;
      template?: string;
      nodejsVersion?: string;
      siteUser: string;
      database?: { name: string; userName: string };
    };
    secrets: { password: string; databasePassword?: string };
    data: { site: WireSite; warnings: string[] };
  };
  delete: { args: { domain: string }; secrets: never; data: { warnings: string[] } };
  password: { args: { domain: string }; secrets: { password: string }; data: Record<string, never> };
  'db-add': {
    args: { domain: string; name: string; userName: string };
    secrets: { password: string };
    data: { site: WireSite };
  };
  'db-delete': { args: { domain: string; name: string }; secrets: never; data: { site: WireSite } };
  'db-password': {
    args: { domain: string; name: string; userName: string };
    secrets: { password: string };
    data: Record<string, never>;
  };
  cert: { args: { domain: string }; secrets: never; data: { site: WireSite } };
  adopt: { args: { domain: string }; secrets: never; data: { site: WireSite } };
  forget: { args: { domain: string }; secrets: never; data: Record<string, never> };
}

/** One line of JSON on the wrapper's stdin. `secrets` is left out when the operation has none. */
export interface WireRequest<Op extends WireOp = WireOp> {
  v: 1;
  op: Op;
  /** UUID, for the wrapper's log. */
  requestId: string;
  args: WireOps[Op]['args'];
  secrets?: WireOps[Op]['secrets'];
}

/** One line of JSON on the wrapper's stdout. */
export type WireAnswer<Op extends WireOp = WireOp> =
  { v: 1; ok: true; data: WireOps[Op]['data'] } | { v: 1; ok: false; error: WireError };

/** A phone system as a provider reports it. */
export interface RemotePhoneSystem {
  /** 3CX: always "pbx" (one PBX per connection). */
  externalId: string;
  /** 3CX: the FQDN, else the host of the base URL. */
  name: string;
  info: PhoneSystemInfo;
  /**
   * false: the provider knows the phone system but cannot reach it right now (demo). The sync
   * keeps the stored facts and marks it "unreachable". 3CX throws instead.
   */
  reachable?: boolean;
}

/** A new phone user. All values are checked and normalized by the API before. */
export interface PhoneUserInput {
  /** Omitted: the PBX picks the next free number. */
  number?: string;
  firstName: string;
  lastName: string | null;
  email: string;
  mobile: string | null;
  outboundCallerId: string | null;
  language: string | null;
}

/** Fields left out keep their value. null clears an optional field. */
export type PhoneUserPatch = Partial<Omit<PhoneUserInput, 'number'>>;

/** A Jellyfin user as the server reports it. Never carries a password or a token. */
export interface RemoteMediaUser {
  /** Jellyfin user id, 32 lower-case hex characters. */
  externalId: string;
  username: string;
  enabled: boolean;
  administrator: boolean;
  hasPassword: boolean;
  /** Disabled by Jellyfin after failed sign-ins (InvalidLoginAttemptCount reached LoginAttemptsBeforeLockout). */
  lockedOut: boolean;
  /** Legacy BlockedMediaFolders set: Jellyfin then ignores EnabledFolders, and no API clears it. */
  blockedFolders: boolean;
  lastLoginAt: string | null;
  lastActivityAt: string | null;
  policy: MediaPolicyState;
}

/** A new Jellyfin user. Name and password are checked by the API before. */
export interface MediaUserInput {
  /** Final login name, e.g. "anna-kemaro". */
  username: string;
  /** Never empty: a Jellyfin user without a password signs in without one. */
  password: string;
  policy: MediaPolicyState;
}

export interface MediaServerInfo {
  serverName: string | null;
  version: string | null;
  /** Jellyfin's server id, 32 hex. */
  serverId: string | null;
  /** null when it could not be read. */
  quickConnect: boolean | null;
  startupWizardCompleted: boolean | null;
}

/** Counts only: never titles, user names, devices or addresses. */
export interface MediaActivity {
  /** Sessions with a user, active within MEDIA_ACTIVE_WITHIN_SECONDS. */
  activeSessions: number;
  /** Of them playing something now. */
  playing: number;
}

/** A monitor as Uptime Kuma reports it. Never carries the monitor's secrets. */
export interface RemoteMonitor {
  /** Kuma's numeric monitor id as text. */
  externalId: string;
  name: string;
  /** Kuma type: "http", "keyword", "ping", "port", "dns", "group", "push", ... */
  type: string;
  /** URL (without credentials, secret-looking query values masked), host, or host:port. */
  target: string | null;
  /** Lower-case host or IP of the target. */
  targetHost: string | null;
  status: MonitorStatus;
  /** false = paused. null = unknown (only /metrics). */
  active: boolean | null;
  intervalSeconds: number | null;
  /** Kuma group (parent monitor) id. */
  parentId: string | null;
  facts: MonitorFacts;
}

export interface MonitorInventory {
  monitors: RemoteMonitor[];
  /**
   * true: the list holds every monitor of the instance, paused ones too (from the management
   * session). false: only what /metrics reports (paused monitors are absent).
   */
  complete: boolean;
  /** Set when management is configured but failed; the list then comes from /metrics. */
  managementError: string | null;
}

export interface MonitorLive {
  monitor: RemoteMonitor;
  /** null without management. */
  config: MonitorConfig | null;
  /** Newest first, at most 20. null without management. */
  events: MonitorEvent[] | null;
}

export interface MonitorInput {
  kind: MonitorKind;
  /** Name as it should appear in Kuma (the route adds the "[<org slug>] " prefix). */
  name: string;
  url: string | null;
  hostname: string | null;
  port: number | null;
  keyword: string | null;
  invertKeyword: boolean;
  method: 'GET' | 'HEAD';
  acceptedStatusCodes: string[];
  intervalSeconds: number;
  ignoreTls: boolean;
}

/** Fields left out keep their value. The kind never changes. */
export type MonitorPatch = Partial<Omit<MonitorInput, 'kind'>>;

export interface MonitoringStatus {
  version: string | null;
  management: 'off' | 'ok' | 'error';
  managementError: string | null;
  uptimeMetrics: boolean;
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

  // Web spaces (module "webhosting", kind "webspace"): read only, 24fire/Plesk offer no provisioning API.
  listWebspaces?(): Promise<RemoteWebspace[]>;
  getWebspace?(externalId: string): Promise<WebspaceInfo>;
  /** Control panel login. Only for the audited reveal route, never stored. */
  getWebspaceCredentials?(externalId: string): Promise<WebspaceCredentials>;

  // Websites (module "webhosting", CloudPanel). Addressed by ASCII domain. Only sites on the
  // server's managed list exist for these methods; others answer 409 not_managed or 404.
  /** Every managed site of the server with facts and databases. */
  listWebsites?(): Promise<RemoteWebsite[]>;
  getWebsite?(domain: string): Promise<RemoteWebsite>;
  /** Sites on the server the console does not manage (admin import hints). */
  listUnmanagedWebsites?(): Promise<{ sites: UnmanagedWebsiteDto[]; allowRemoteAdopt: boolean }>;
  /** Cached 10 minutes; `fresh` asks the server (connection test). */
  websiteServerInfo?(fresh?: boolean): Promise<WebsiteServerInfo>;
  /** What customers may choose here: server facts filtered by the connection config. */
  websiteServerOptions?(): Promise<WebsiteServerOptions>;
  /** SFTP/SSH host shown to customers. */
  websiteAccessHost?(): string;
  /** Rolls back a failed site; a failed database leaves the site and reports a warning. */
  createWebsite?(input: WebsiteInput): Promise<{ website: RemoteWebsite; warnings: string[] }>;
  /** Deletes the site with files, databases and site user (clpctl site:delete --force). */
  deleteWebsite?(domain: string): Promise<{ warnings: string[] }>;
  /** Only for the audited password route; the password is never stored. */
  setWebsitePassword?(domain: string, password: string): Promise<void>;
  createWebsiteDatabase?(domain: string, input: WebsiteDatabaseInput): Promise<RemoteWebsite>;
  setWebsiteDatabasePassword?(
    domain: string,
    name: string,
    userName: string,
    password: string,
  ): Promise<void>;
  deleteWebsiteDatabase?(domain: string, name: string): Promise<RemoteWebsite>;
  /** Let's Encrypt for the domain and its www counterpart. */
  issueWebsiteCertificate?(domain: string): Promise<RemoteWebsite>;
  /** Only when the server allows remote adoption; refuses protected sites. */
  adoptWebsite?(domain: string): Promise<RemoteWebsite>;
  /** Drops the site from the managed list. The site itself stays on the server. */
  forgetWebsite?(domain: string): Promise<void>;
  /** Demo only: simulated public DNS answers for the DNS check (real adapters leave it out). */
  websiteDnsOverride?(name: string): { a: string[]; aaaa: string[] } | null;

  // Telephony (module "phone"). Addressed by the provider's id of the phone system
  // (RemotePhoneSystem.externalId) and the PBX's ids of users and ring groups.
  /** Every phone system of the connection (3CX: exactly one). */
  listPhoneSystems?(): Promise<RemotePhoneSystem[]>;
  getPhoneSystem?(systemId: string): Promise<RemotePhoneSystem>;
  /** Every user of the phone system, ordered by number. */
  listPhoneUsers?(systemId: string): Promise<PhoneUser[]>;
  getPhoneUser?(systemId: string, userId: string): Promise<PhoneUser>;
  /** Next free user extension, null when the PBX has none left. */
  nextPhoneNumber?(systemId: string): Promise<string | null>;
  createPhoneUser?(systemId: string, input: PhoneUserInput): Promise<PhoneUser>;
  /** Returns the user as the PBX has it after the change. */
  updatePhoneUser?(systemId: string, userId: string, patch: PhoneUserPatch): Promise<PhoneUser>;
  deletePhoneUser?(systemId: string, userId: string): Promise<void>;
  /** The PBX sends its welcome e-mail to the user's address. Needs an e-mail address. */
  sendPhoneWelcome?(systemId: string, userId: string): Promise<void>;
  listPhoneRingGroups?(systemId: string): Promise<PhoneRingGroup[]>;
  /** Appends the extension to the ring group. Already a member: no change. Returns the group. */
  addPhoneRingGroupMember?(systemId: string, groupId: string, number: string): Promise<PhoneRingGroup>;
  /** Not a member: 404. Returns the group. */
  removePhoneRingGroupMember?(systemId: string, groupId: string, number: string): Promise<PhoneRingGroup>;
  listPhoneTrunks?(systemId: string): Promise<PhoneTrunk[]>;

  // Streaming (module "media", Jellyfin). Users by their Jellyfin id (32 hex). Missing users
  // throw a ProviderError with upstreamStatus 404.
  /** Every user of the instance (the sync only updates accounts the console knows). */
  listMediaUsers?(): Promise<RemoteMediaUser[]>;
  getMediaUser?(userId: string): Promise<RemoteMediaUser>;
  /** Creates the user with its password, then writes the policy. A failed policy removes the user again. */
  createMediaUser?(input: MediaUserInput): Promise<RemoteMediaUser>;
  /** Read, modify, write of the whole Jellyfin policy: only the fields of MediaPolicyState change. */
  setMediaUserPolicy?(userId: string, policy: MediaPolicyState): Promise<RemoteMediaUser>;
  /** Disabling signs out every device of the user; enabling also clears the failed sign-in counter. */
  setMediaUserEnabled?(userId: string, enabled: boolean): Promise<RemoteMediaUser>;
  /** Only for the audited password routes, never stored. Signs out every device of the user. */
  setMediaUserPassword?(userId: string, password: string): Promise<void>;
  /** Deletes the user with its devices (sessions end), playlists and watch history. */
  deleteMediaUser?(userId: string): Promise<void>;
  /** Libraries with an id, cached 5 minutes; `fresh` reads them now. */
  listMediaLibraries?(fresh?: boolean): Promise<MediaLibraryRef[]>;
  /** Cached 10 minutes; `fresh` reads it now. */
  mediaServerInfo?(fresh?: boolean): Promise<MediaServerInfo>;
  /** Aggregate counts for the admin overview, cached 30 seconds. */
  mediaActivity?(): Promise<MediaActivity>;
  /** Where users sign in and what they enter in the apps, e.g. https://media.weblion.one. */
  mediaLoginUrl?(): string;

  // Monitoring (module "monitoring", Uptime Kuma). Monitors by Kuma id (text). Missing monitors
  // throw a ProviderError with upstreamStatus 404.
  /** Every monitor /metrics (and, when signed in, the management session) reports. */
  listMonitors?(): Promise<MonitorInventory>;
  /** Live facts, plus configuration and recent events when signed in for management. */
  getMonitor?(externalId: string): Promise<MonitorLive>;
  /** null when no history is available for this monitor and range. */
  getMonitorHistory?(
    externalId: string,
    range: MonitorHistoryRange,
    options: { statusPageSlug: string | null },
  ): Promise<MonitorHistoryDto | null>;
  /** Ranges getMonitorHistory can serve, without network. */
  monitorHistoryRanges?(options: { statusPageSlug: string | null }): MonitorHistoryRange[];
  /** Whether write operations are configured (a session token is stored). No network. */
  monitorManagement?(): boolean;
  /** Version, management state (checks the session, cached for 60 s). */
  monitoringStatus?(): Promise<MonitoringStatus>;
  /** Returns the new monitor (status "pending" until its first check). */
  createMonitor?(input: MonitorInput): Promise<RemoteMonitor>;
  updateMonitor?(externalId: string, patch: MonitorPatch): Promise<void>;
  pauseMonitor?(externalId: string): Promise<void>;
  resumeMonitor?(externalId: string): Promise<void>;
  /** Deletes the monitor and its history in Kuma. */
  deleteMonitor?(externalId: string): Promise<void>;
  /** A public status page; 404 if the slug does not exist. */
  getStatusPage?(slug: string): Promise<{ slug: string; title: string; monitorIds: string[] }>;
  statusPageUrl?(slug: string): string;
  /** Exchanges a Kuma login for a session token. The password is never stored or logged. */
  signInForManagement?(credentials: {
    username: string;
    password: string;
    totp?: string;
  }): Promise<{ sessionToken: string; version: string | null }>;

  /** Unfiltered access to the provider API for the admin explorer. */
  rawRequest?(method: string, path: string, body?: Record<string, unknown>): Promise<RawResponse>;
  /**
   * Explorer request as it is audited, secrets blanked. The generic redaction of the admin route
   * runs on the result as well.
   */
  redactExplorerAudit?(
    path: string,
    body: Record<string, unknown> | undefined,
  ): { path: string; body: unknown };
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

/** A CloudPanel server, reached over SSH through the root wrapper weblion-clp. */
export interface CloudPanelConfig {
  /** SSH host name or IP address. */
  host: string;
  /** Default 22. */
  port: number;
  /** Default "weblion-agent". */
  username: string;
  /** Unencrypted OpenSSH ed25519 private key ("-----BEGIN OPENSSH PRIVATE KEY-----"). */
  privateKey: string;
  /** "SHA256:<base64>" of the server's ed25519 host key (ssh-keygen -lf). */
  hostKeySha256: string;
  /** Host customers use for SFTP/SSH, e.g. "web1.weblion.cloud". Default: host. */
  accessHost?: string;
  /** Public addresses for the DNS check. Default: what the server reports. */
  ipv4?: string[];
  ipv6?: string[];
  /** PHP versions customers may choose. Default ["8.3", "8.4"]. */
  phpVersions?: string[];
  /** Templates customers may choose: exact names or prefixes ending in "*". Default ["Generic", "WordPress", "WooCommerce"]. */
  templates?: string[];
  /** Node.js sites for customers on this server (they also need it in their allowance). Default false. */
  nodejs?: boolean;
}

/** 3CX V20 Configuration API (XAPI), one PBX per connection. Needs a 3CX Enterprise license. */
export interface ThreeCxConfig {
  /** https://<PBX FQDN>[:port] without path, e.g. https://muster.3cx.ch. */
  baseUrl: string;
  /** Client ID of the API client (3CX Admin > Integrations > API). */
  clientId: string;
  /** API key shown once when the client was created. */
  clientSecret: string;
}

/** Jellyfin media server, one instance per connection. */
export interface JellyfinConfig {
  /**
   * Where the console reaches the API and users sign in, with Jellyfin's base URL path if one is
   * set, without a trailing slash, e.g. https://media.weblion.one or https://weblion.one/jellyfin.
   */
  baseUrl: string;
  /** API key from Dashboard > API Keys: 32 lower-case hex characters, full administrator rights. */
  apiKey: string;
}

/** Uptime Kuma 2.x. API key for /metrics; session token only when signed in for management. */
export interface UptimeKumaConfig {
  /** e.g. https://status.weblion.one (no path, no trailing slash) */
  baseUrl: string;
  /** "uk<id>_<key>" from Kuma Settings > API Keys. */
  apiKey: string;
  /** JWT from Kuma's login (management sign-in). Absent = read-only. */
  sessionToken?: string;
}

export interface DemoConfig extends Pick<CloudPanelConfig, 'phpVersions' | 'templates' | 'nodejs'> {
  seed?: number;
  servers?: number;
  /**
   * Second, opt-in demo connections: a Cloudflare account, or a CloudPanel server. The simulated
   * CloudPanel server reads phpVersions, templates and nodejs like a real connection.
   */
  flavor?: 'cloudflare' | 'cloudpanel';
}

export type ProviderConfig =
  | Fire24Config
  | ProxmoxConfig
  | HetznerConfig
  | JokerConfig
  | NextcloudConfig
  | CloudflareConfig
  | MailcowConfig
  | CloudPanelConfig
  | ThreeCxConfig
  | JellyfinConfig
  | UptimeKumaConfig
  | DemoConfig;
