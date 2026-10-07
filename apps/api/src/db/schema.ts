import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
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

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  kind: text('kind').$type<OrgKind>().notNull().default('customer'),
  status: text('status').$type<OrgStatus>().notNull().default('active'),
  /** Caps what any member of this organization can do. Managed by platform admins. */
  boundary: jsonb('boundary').$type<PolicyStatement[]>().notNull(),
  notes: text('notes'),
  ...timestamps,
});

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
