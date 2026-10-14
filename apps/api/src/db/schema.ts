import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type {
  BillingInterval,
  CreatableWebsiteType,
  CreditType,
  Currency,
  DomainInfo,
  InvoiceIssuerSettings,
  InvoiceStatus,
  MailDomainInfo,
  MediaAccountIssue,
  MediaLibraryRef,
  ModuleKey,
  MonitorFacts,
  MonitorOrigin,
  MonitorStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  PhoneStatusReason,
  PhoneSystemInfo,
  PhoneSystemStatus,
  PostalAddress,
  ServiceResourceType,
  ServiceStatus,
  WebspaceInfo,
  WebspaceKind,
  WebspaceStatus,
  ZohoSyncStatus,
  IpAddress,
  Location,
  OrgKind,
  OrgRole,
  OrgStatus,
  PlatformRole,
  PolicyStatement,
  ProviderType,
  ServerKind,
  ServerProtection,
  ServerSpecs,
  ServerStatus,
  ServerUsage,
  SuspendedBy,
  TokenScope,
} from '@weblion/shared';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash'),
    platformRole: text('platform_role').$type<PlatformRole>(),
    status: text('status').$type<'active' | 'disabled'>().notNull().default('active'),
    locale: text('locale').notNull().default('de'),
    totpSecretEnc: text('totp_secret_enc'),
    totpEnabled: boolean('totp_enabled').notNull().default(false),
    /** Consecutive failed logins, drives the temporary lockout. */
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_email_idx').on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 of the cookie value. The raw token never touches the database. */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mfaPending: boolean('mfa_pending').notNull().default(false),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    kind: text('kind').$type<OrgKind>().notNull().default('customer'),
    status: text('status').$type<OrgStatus>().notNull().default('active'),
    /** Who suspended it, set while status is "suspended". Resellers can't lift a platform suspension. */
    suspendedBy: text('suspended_by').$type<SuspendedBy>(),
    /** Caps what any member of this organization can do. Managed by platform admins. */
    boundary: jsonb('boundary').$type<PolicyStatement[]>().notNull(),
    /** Reseller that owns this customer. Only one level: resellers have no parent. */
    parentOrgId: uuid('parent_org_id').references((): AnyPgColumn => organizations.id, {
      onDelete: 'restrict',
    }),
    /** Activated service modules, see MODULES in @weblion/shared. */
    modules: jsonb('modules').$type<ModuleKey[]>().notNull().default(['servers']),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [index('organizations_parent_idx').on(t.parentOrgId)],
);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<OrgRole>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('memberships_org_user_idx').on(t.orgId, t.userId),
    index('memberships_user_idx').on(t.userId),
  ],
);

export const policies = pgTable(
  'policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    statements: jsonb('statements').$type<PolicyStatement[]>().notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('policies_org_name_idx').on(t.orgId, t.name)],
);

export const membershipPolicies = pgTable(
  'membership_policies',
  {
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    policyId: uuid('policy_id')
      .notNull()
      .references(() => policies.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.membershipId, t.policyId] })],
);

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').$type<OrgRole>().notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('invitations_org_idx').on(t.orgId)],
);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    ...timestamps,
  },
  (t) => [index('projects_org_idx').on(t.orgId)],
);

export const providerConnections = pgTable('provider_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type').$type<ProviderType>().notNull(),
  name: text('name').notNull(),
  location: jsonb('location').$type<Location>().notNull(),
  /** AES-256-GCM encrypted JSON with credentials. See lib/crypto.ts. */
  configEnc: text('config_enc').notNull(),
  /** Connections created from environment variables are refreshed on boot and read-only in the UI. */
  managedBy: text('managed_by').$type<'env' | 'ui'>().notNull().default('ui'),
  envKey: text('env_key').unique(),
  enabled: boolean('enabled').notNull().default(true),
  status: text('status').$type<'ok' | 'error' | 'unknown'>().notNull().default('unknown'),
  lastError: text('last_error'),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  ...timestamps,
});

export const servers = pgTable(
  'servers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerConnectionId: uuid('provider_connection_id')
      .notNull()
      .references(() => providerConnections.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    /** Display name in the panel. Starts as the provider name, can be renamed locally. */
    name: text('name').notNull(),
    providerName: text('provider_name'),
    kind: text('kind').$type<ServerKind>().notNull().default('vm'),
    status: text('status').$type<ServerStatus>().notNull().default('unknown'),
    specs: jsonb('specs').$type<ServerSpecs>().notNull().default({}),
    usage: jsonb('usage').$type<ServerUsage>(),
    ips: jsonb('ips').$type<IpAddress[]>().notNull().default([]),
    os: text('os'),
    node: text('node'),
    labels: jsonb('labels').$type<Record<string, string>>().notNull().default({}),
    protection: jsonb('protection')
      .$type<ServerProtection>()
      .notNull()
      .default({ delete: false, rebuild: false }),
    /** Provider specific extras (e.g. Proxmox template flag, 24fire host system). */
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    missingSince: timestamp('missing_since', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('servers_provider_external_idx').on(t.providerConnectionId, t.externalId),
    index('servers_project_idx').on(t.projectId),
  ],
);

export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    prefix: text('prefix').notNull(),
    scope: text('scope').$type<TokenScope>().notNull(),
    statements: jsonb('statements').$type<PolicyStatement[]>(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('api_tokens_org_idx').on(t.orgId)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorTokenId: uuid('actor_token_id').references(() => apiTokens.id, { onDelete: 'set null' }),
    /** Copied so the log stays readable after a user is deleted. */
    actorName: text('actor_name'),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    status: text('status').$type<'success' | 'failure' | 'denied'>().notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    details: jsonb('details').$type<Record<string, unknown>>(),
  },
  (t) => [
    index('audit_org_created_idx').on(t.orgId, t.createdAt),
    index('audit_resource_idx').on(t.resourceType, t.resourceId),
    index('audit_created_idx').on(t.createdAt),
  ],
);

export const serverActions = pgTable(
  'server_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serverId: uuid('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    status: text('status').$type<'running' | 'success' | 'error'>().notNull(),
    /** Provider task reference, e.g. a Proxmox UPID or a 24fire backup id. */
    providerRef: text('provider_ref'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('server_actions_server_idx').on(t.serverId, t.startedAt)],
);

// --- Domains and web spaces (synced from provider accounts like servers) ------------

export const domains = pgTable(
  'domains',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerConnectionId: uuid('provider_connection_id')
      .notNull()
      .references(() => providerConnections.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    /** Organization the domain is assigned to, null = not assigned yet. */
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    status: text('status'),
    /** Last known provider facts (no secrets, never the auth code). */
    info: jsonb('info').$type<DomainInfo>(),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    missingSince: timestamp('missing_since', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('domains_provider_external_idx').on(t.providerConnectionId, t.externalId),
    index('domains_org_idx').on(t.orgId),
    // Registration and DNS zone of the same name at different providers (Cloudflare).
    index('domains_name_lower_idx').on(sql`lower(${t.name})`),
  ],
);

export const webspaces = pgTable(
  'webspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerConnectionId: uuid('provider_connection_id')
      .notNull()
      .references(() => providerConnections.id, { onDelete: 'cascade' }),
    /** Provider id. Websites (CloudPanel): the ASCII (punycode) domain, e.g. "xn--mller-kva.ch". */
    externalId: text('external_id').notNull(),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    /** Display name. Websites: the Unicode domain, e.g. "müller.ch". */
    name: text('name').notNull(),
    /** "webspace": a provider web space (24fire, Plesk). "website": a CloudPanel site. */
    kind: text('kind').$type<WebspaceKind>().notNull().default('webspace'),
    /** Websites go through creating/deleting; error = outcome unknown, the sync settles it. Web spaces stay "active". */
    status: text('status').$type<WebspaceStatus>().notNull().default('active'),
    /** Last known provider facts. Never a password. Websites: info.site holds the site facts. */
    info: jsonb('info').$type<WebspaceInfo>(),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    missingSince: timestamp('missing_since', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('webspaces_provider_external_idx').on(t.providerConnectionId, t.externalId),
    index('webspaces_org_idx').on(t.orgId),
    index('webspaces_kind_org_idx').on(t.kind, t.orgId),
  ],
);

// --- Websites (CloudPanel) ---------------------------------------------------------

/** Databases of a website (CloudPanel). Counted for allowances; passwords are never stored. */
export const webspaceDatabases = pgTable(
  'webspace_databases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    webspaceId: uuid('webspace_id')
      .notNull()
      .references(() => webspaces.id, { onDelete: 'cascade' }),
    /** Same as the website's connection; MySQL names are unique per server. */
    providerConnectionId: uuid('provider_connection_id')
      .notNull()
      .references(() => providerConnections.id, { onDelete: 'cascade' }),
    /** MySQL database name, e.g. "shop_mueller_wp". */
    name: text('name').notNull(),
    /** The database user created with it (same as the name when created by the console). */
    userName: text('user_name'),
    status: text('status').$type<WebspaceStatus>().notNull().default('active'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    missingSince: timestamp('missing_since', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('webspace_databases_provider_name_idx').on(t.providerConnectionId, t.name),
    index('webspace_databases_webspace_idx').on(t.webspaceId),
  ],
);

/** What an organization may create on CloudPanel, on one instance. */
export const websiteAllowances = pgTable('website_allowances', {
  orgId: uuid('org_id')
    .primaryKey()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  /** The CloudPanel instance new websites go to. Kept while the allowance exists (restrict). */
  providerConnectionId: uuid('provider_connection_id')
    .notNull()
    .references(() => providerConnections.id, { onDelete: 'restrict' }),
  maxSites: integer('max_sites').notNull(),
  maxDatabases: integer('max_databases').notNull(),
  siteTypes: jsonb('site_types').$type<CreatableWebsiteType[]>().notNull().default(['php', 'static']),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  ...timestamps,
});

// --- Cloud storage (Nextcloud) -----------------------------------------------------

/** Storage an organization may hand out to Nextcloud accounts, on one instance. */
export const cloudAllowances = pgTable('cloud_allowances', {
  orgId: uuid('org_id')
    .primaryKey()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  /** The Nextcloud instance. Kept while accounts exist there (restrict). */
  providerConnectionId: uuid('provider_connection_id')
    .notNull()
    .references(() => providerConnections.id, { onDelete: 'restrict' }),
  quotaBytes: bigint('quota_bytes', { mode: 'number' }).notNull(),
  /** null = no limit on the number of accounts. */
  maxAccounts: integer('max_accounts'),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  ...timestamps,
});

/** A Nextcloud user managed through the panel. The password is never stored. */
export const cloudAccounts = pgTable(
  'cloud_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerConnectionId: uuid('provider_connection_id')
      .notNull()
      .references(() => providerConnections.id, { onDelete: 'cascade' }),
    /** Nextcloud user id = login name, e.g. "anna@muster-ag". */
    externalId: text('external_id').notNull(),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    displayName: text('display_name'),
    email: text('email'),
    /** null = unlimited (only possible for accounts imported by staff). */
    quotaBytes: bigint('quota_bytes', { mode: 'number' }),
    usedBytes: bigint('used_bytes', { mode: 'number' }),
    enabled: boolean('enabled').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    missingSince: timestamp('missing_since', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('cloud_accounts_provider_external_idx').on(t.providerConnectionId, t.externalId),
    index('cloud_accounts_org_idx').on(t.orgId),
  ],
);

// --- E-mail (Mailcow) ----------------------------------------------------------------

/** A mail domain at a Mailcow server, synced like domains. Mailboxes and aliases are read live. */
export const mailDomains = pgTable(
  'mail_domains',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerConnectionId: uuid('provider_connection_id')
      .notNull()
      .references(() => providerConnections.id, { onDelete: 'cascade' }),
    /** ASCII (punycode) domain name as Mailcow stores it, e.g. "xn--mller-kva.ch". */
    externalId: text('external_id').notNull(),
    /** Organization the mail domain is assigned to, null = not assigned yet. */
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    /** Unicode name for display, e.g. "müller.ch". */
    name: text('name').notNull(),
    active: boolean('active').notNull().default(true),
    /** Limits and usage as last read from Mailcow. */
    info: jsonb('info').$type<MailDomainInfo>(),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    missingSince: timestamp('missing_since', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('mail_domains_provider_external_idx').on(t.providerConnectionId, t.externalId),
    index('mail_domains_org_idx').on(t.orgId),
  ],
);

// --- Telephony (3CX) ------------------------------------------------------------------

/** A phone system (PBX) a provider connection reports. 3CX: exactly one per connection. */
export const phoneSystems = pgTable(
  'phone_systems',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerConnectionId: uuid('provider_connection_id')
      .notNull()
      .references(() => providerConnections.id, { onDelete: 'cascade' }),
    /** The provider's id of the phone system: "pbx" for 3CX, "demo-pbx-zh" in the demo. */
    externalId: text('external_id').notNull(),
    /** Organization the phone system is assigned to, null = not assigned yet. */
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    /** Display name. Starts as the provider name, can be renamed in the panel (e.g. "Zürich"). */
    name: text('name').notNull(),
    /** Last name the provider reported (3CX: the FQDN). */
    providerName: text('provider_name'),
    /** Host name the PBX reports, for search and display. */
    fqdn: text('fqdn'),
    status: text('status').$type<PhoneSystemStatus>().notNull().default('unknown'),
    statusReasons: jsonb('status_reasons').$type<PhoneStatusReason[]>().notNull().default([]),
    /** Last known facts (no secrets, never the license key). */
    info: jsonb('info').$type<PhoneSystemInfo>(),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    missingSince: timestamp('missing_since', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('phone_systems_provider_external_idx').on(t.providerConnectionId, t.externalId),
    index('phone_systems_org_idx').on(t.orgId),
  ],
);

// --- Streaming (Jellyfin) -------------------------------------------------------------

/** What an organization may have on one Jellyfin instance, and the access its accounts get. */
export const mediaAllowances = pgTable(
  'media_allowances',
  {
    orgId: uuid('org_id')
      .primaryKey()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** The Jellyfin instance. Kept while the allowance exists (restrict). */
    providerConnectionId: uuid('provider_connection_id')
      .notNull()
      .references(() => providerConnections.id, { onDelete: 'restrict' }),
    /** Login names of new accounts end with "-<code>", e.g. "anna-kemaro". Unique on the platform. */
    accountCode: text('account_code').notNull(),
    /** Own accounts plus, for a reseller, its customers' maxAccounts on the instance. */
    maxAccounts: integer('max_accounts').notNull(),
    /** Libraries the accounts see: Jellyfin library ids with name and type as last read. */
    libraries: jsonb('libraries').$type<MediaLibraryRef[]>().notNull().default([]),
    /** Jellyfin MaxActiveSessions of every account (signed-in devices at sign-in time). */
    maxStreams: integer('max_streams').notNull(),
    downloads: boolean('downloads').notNull().default(false),
    /** Limit for clients outside the server's network, Mbit/s. null = the server's own setting. */
    remoteBitrateMbit: integer('remote_bitrate_mbit'),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('media_allowances_account_code_idx').on(t.accountCode),
    index('media_allowances_provider_idx').on(t.providerConnectionId),
  ],
);

/** A Jellyfin user managed through the console. The password is never stored. */
export const mediaAccounts = pgTable(
  'media_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerConnectionId: uuid('provider_connection_id')
      .notNull()
      .references(() => providerConnections.id, { onDelete: 'cascade' }),
    /** Jellyfin user id, 32 lower-case hex characters. Stays the same when the user is renamed. */
    externalId: text('external_id').notNull(),
    /** Login name as Jellyfin has it, e.g. "anna-kemaro". */
    username: text('username').notNull(),
    /** Organization the account belongs to, null = not assigned. */
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    enabled: boolean('enabled').notNull().default(true),
    hasPassword: boolean('has_password').notNull().default(true),
    /** As Jellyfin reports it (minute precise). The API only hands out the calendar day. */
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
    /** Problems found by the last sync or change (policy drift, administrator, ...). */
    issues: jsonb('issues').$type<MediaAccountIssue[]>().notNull().default([]),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    missingSince: timestamp('missing_since', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('media_accounts_provider_external_idx').on(t.providerConnectionId, t.externalId),
    index('media_accounts_org_idx').on(t.orgId),
    index('media_accounts_username_lower_idx').on(sql`lower(${t.username})`),
  ],
);

// --- Monitoring (Uptime Kuma) ---------------------------------------------------------

/** A monitor of an Uptime Kuma instance. Never carries the monitor's secrets. */
export const monitors = pgTable(
  'monitors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerConnectionId: uuid('provider_connection_id')
      .notNull()
      .references(() => providerConnections.id, { onDelete: 'cascade' }),
    /** Kuma's numeric monitor id as text (unique per instance only). */
    externalId: text('external_id').notNull(),
    /** Organization the monitor is assigned to, null = not assigned. */
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    /** "kuma": found by the sync (read-only for customers). "console": created in the console. */
    origin: text('origin').$type<MonitorOrigin>().notNull().default('kuma'),
    /** Display name. Follows Kuma renames unless renamed in the console (like servers). */
    name: text('name').notNull(),
    /** Name in Kuma, e.g. "[muster-ag] Website". */
    providerName: text('provider_name').notNull(),
    /** Kuma type: "http", "keyword", "ping", "port", "dns", "group", "push", ... */
    type: text('type').notNull(),
    /** Display target (URL without credentials, host, or host:port). */
    target: text('target'),
    /** Lower-case host or IP of the target, for matching servers and domains. */
    targetHost: text('target_host'),
    status: text('status').$type<MonitorStatus>().notNull().default('unknown'),
    /** false = paused. null = unknown (only /metrics, never seen in a complete list). */
    active: boolean('active'),
    intervalSeconds: integer('interval_seconds'),
    /** Last facts from /metrics (and socket stats). */
    facts: jsonb('facts').$type<MonitorFacts>(),
    /** { parentId?: string } (Kuma group). No secrets. */
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    /** Who created it in the console. */
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    missingSince: timestamp('missing_since', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('monitors_provider_external_idx').on(t.providerConnectionId, t.externalId),
    index('monitors_org_idx').on(t.orgId),
    index('monitors_org_host_idx').on(t.orgId, t.targetHost),
  ],
);

/** How many console monitors an organization may create, on which instance, how often they check. */
export const monitorAllowances = pgTable('monitor_allowances', {
  orgId: uuid('org_id')
    .primaryKey()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  /** The instance console monitors are created on. Kept while they exist (restrict). */
  providerConnectionId: uuid('provider_connection_id')
    .notNull()
    .references(() => providerConnections.id, { onDelete: 'restrict' }),
  /** Own console monitors plus, for a reseller, its customers' maxMonitors on the instance. */
  maxMonitors: integer('max_monitors').notNull(),
  /** Shortest check interval the organization may choose. */
  minIntervalSeconds: integer('min_interval_seconds').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  ...timestamps,
});

/** The public Kuma status page of an organization on one instance. */
export const monitorStatusPages = pgTable(
  'monitor_status_pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    providerConnectionId: uuid('provider_connection_id')
      .notNull()
      .references(() => providerConnections.id, { onDelete: 'cascade' }),
    /** Kuma slug, lower case, [a-z0-9-]. */
    slug: text('slug').notNull(),
    /** Public URL when the page has its own domain; null = <baseUrl>/status/<slug>. */
    url: text('url'),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [uniqueIndex('monitor_status_pages_org_provider_idx').on(t.orgId, t.providerConnectionId)],
);

// --- Billing ------------------------------------------------------------------------
// Money columns are integer minor units (Rappen/cents), tax rates basis points.

/** Billing details of an organization as a customer, plus issuer settings for resellers. */
export const billingProfiles = pgTable('billing_profiles', {
  orgId: uuid('org_id')
    .primaryKey()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  companyName: text('company_name'),
  contactName: text('contact_name'),
  line1: text('line1'),
  line2: text('line2'),
  postalCode: text('postal_code'),
  city: text('city'),
  country: text('country').notNull().default('CH'),
  email: text('email'),
  vatId: text('vat_id'),
  currency: text('currency').$type<Currency>().notNull().default('CHF'),
  paymentTermsDays: integer('payment_terms_days').notNull().default(30),
  taxRateBp: integer('tax_rate_bp'),
  /** Only for resellers: how their own invoices to their customers look. */
  issuer: jsonb('issuer').$type<InvoiceIssuerSettings>(),
  zohoContactId: text('zoho_contact_id'),
  stripeCustomerId: text('stripe_customer_id'),
  ...timestamps,
});

/** Price list. ownerOrgId null = platform catalog, otherwise a reseller's own products. */
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerOrgId: uuid('owner_org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    module: text('module').$type<ModuleKey>(),
    unitPrice: integer('unit_price').notNull(),
    currency: text('currency').$type<Currency>().notNull().default('CHF'),
    interval: text('interval').$type<BillingInterval>().notNull(),
    taxRateBp: integer('tax_rate_bp'),
    active: boolean('active').notNull().default(true),
    zohoItemId: text('zoho_item_id'),
    ...timestamps,
  },
  (t) => [index('products_owner_idx').on(t.ownerOrgId)],
);

/** Services ("Dienste") a customer has. Recurring ones produce invoice lines when due. */
export const services = pgTable(
  'services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description'),
    module: text('module').$type<ModuleKey>(),
    resourceType: text('resource_type').$type<ServiceResourceType>(),
    resourceId: uuid('resource_id'),
    unitPrice: integer('unit_price').notNull(),
    quantity: numeric('quantity', { precision: 12, scale: 3, mode: 'number' }).notNull().default(1),
    currency: text('currency').$type<Currency>().notNull().default('CHF'),
    interval: text('interval').$type<BillingInterval>().notNull(),
    taxRateBp: integer('tax_rate_bp'),
    status: text('status').$type<ServiceStatus>().notNull().default('active'),
    startsAt: date('starts_at').notNull(),
    nextBillingAt: date('next_billing_at'),
    endsAt: date('ends_at'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [index('services_org_idx').on(t.orgId), index('services_due_idx').on(t.status, t.nextBillingAt)],
);

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Assigned on finalize, unique per issuer. */
    number: text('number'),
    /** null = issued by the platform, otherwise by this reseller. */
    issuerOrgId: uuid('issuer_org_id').references(() => organizations.id, { onDelete: 'restrict' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    status: text('status').$type<InvoiceStatus>().notNull().default('draft'),
    currency: text('currency').$type<Currency>().notNull().default('CHF'),
    issueDate: date('issue_date'),
    dueDate: date('due_date'),
    subtotal: integer('subtotal').notNull().default(0),
    taxTotal: integer('tax_total').notNull().default(0),
    total: integer('total').notNull().default(0),
    amountPaid: integer('amount_paid').notNull().default(0),
    /** Snapshot of recipient and issuer at finalization, so later edits don't change old invoices. */
    billingAddress: jsonb('billing_address').$type<
      PostalAddress & { email: string | null; vatId: string | null }
    >(),
    issuerSnapshot: jsonb('issuer_snapshot').$type<InvoiceIssuerSettings>(),
    notes: text('notes'),
    zohoInvoiceId: text('zoho_invoice_id'),
    zohoStatus: text('zoho_status').$type<ZohoSyncStatus>(),
    zohoError: text('zoho_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('invoices_number_idx').on(sql`coalesce(${t.issuerOrgId}::text, 'platform')`, t.number),
    index('invoices_org_idx').on(t.orgId, t.createdAt),
    index('invoices_status_idx').on(t.status, t.dueDate),
  ],
);

export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    description: text('description').notNull(),
    quantity: numeric('quantity', { precision: 12, scale: 3, mode: 'number' }).notNull(),
    unit: text('unit'),
    unitPrice: integer('unit_price').notNull(),
    taxRateBp: integer('tax_rate_bp').notNull(),
    total: integer('total').notNull(),
    serviceId: uuid('service_id').references(() => services.id, { onDelete: 'set null' }),
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
  },
  (t) => [index('invoice_lines_invoice_idx').on(t.invoiceId, t.position)],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    /** null = credit top-up. */
    invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'restrict' }),
    provider: text('provider').$type<PaymentProvider>().notNull(),
    method: text('method').$type<PaymentMethod>().notNull(),
    amount: integer('amount').notNull(),
    currency: text('currency').$type<Currency>().notNull(),
    status: text('status').$type<PaymentStatus>().notNull().default('pending'),
    /** Stripe Checkout Session id. Unique so webhook retries can't book twice. */
    externalId: text('external_id').unique(),
    /** Free reference: Stripe payment intent, bank reference, receipt number. */
    reference: text('reference'),
    zohoPaymentId: text('zoho_payment_id'),
    error: text('error'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('payments_org_idx').on(t.orgId, t.createdAt), index('payments_invoice_idx').on(t.invoiceId)],
);

/** Credit ("Guthaben") ledger. The balance is the sum of all amounts of an organization. */
export const creditTransactions = pgTable(
  'credit_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    /** Positive adds credit, negative uses it. */
    amount: integer('amount').notNull(),
    currency: text('currency').$type<Currency>().notNull(),
    type: text('type').$type<CreditType>().notNull(),
    description: text('description').notNull(),
    invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'restrict' }),
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'restrict' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('credit_org_idx').on(t.orgId, t.createdAt)],
);

/** Gapless counters, e.g. invoice numbers per issuer and year. */
export const numberSequences = pgTable('number_sequences', {
  key: text('key').primaryKey(),
  value: integer('value').notNull(),
});

// --- Mail ---------------------------------------------------------------------------

export const mailLog = pgTable(
  'mail_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    to: text('to').notNull(),
    subject: text('subject').notNull(),
    template: text('template'),
    status: text('status').$type<'sent' | 'failed' | 'skipped'>().notNull(),
    error: text('error'),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('mail_log_created_idx').on(t.createdAt)],
);

/** Simple key/value store for platform settings and job bookkeeping. */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type User = typeof users.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ProviderConnection = typeof providerConnections.$inferSelect;
export type Server = typeof servers.$inferSelect;
export type ApiToken = typeof apiTokens.$inferSelect;
export type Policy = typeof policies.$inferSelect;
export type Domain = typeof domains.$inferSelect;
export type Webspace = typeof webspaces.$inferSelect;
export type BillingProfile = typeof billingProfiles.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Service = typeof services.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type InvoiceLine = typeof invoiceLines.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type CreditTransaction = typeof creditTransactions.$inferSelect;
export type CloudAllowance = typeof cloudAllowances.$inferSelect;
export type CloudAccount = typeof cloudAccounts.$inferSelect;
export type MailDomain = typeof mailDomains.$inferSelect;
export type WebspaceDatabase = typeof webspaceDatabases.$inferSelect;
export type WebsiteAllowance = typeof websiteAllowances.$inferSelect;
export type PhoneSystem = typeof phoneSystems.$inferSelect;
export type MediaAllowance = typeof mediaAllowances.$inferSelect;
export type MediaAccount = typeof mediaAccounts.$inferSelect;
export type Monitor = typeof monitors.$inferSelect;
export type MonitorAllowance = typeof monitorAllowances.$inferSelect;
export type MonitorStatusPage = typeof monitorStatusPages.$inferSelect;
