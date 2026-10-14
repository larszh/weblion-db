import type { Currency } from './billing';
import type { ModuleKey } from './modules';
import type { Permission } from './permissions';
import type { PolicyStatement } from './policy';
import type { OrgRole, PlatformRole, TokenScope } from './roles';
import type {
  Capability,
  IpAddress,
  Location,
  PowerAction,
  ProviderType,
  ServerKind,
  ServerSpecs,
  ServerStatus,
  ServerUsage,
} from './providers';

/** Response shapes of the REST API, shared with the web client. */

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export interface UserDto {
  id: string;
  email: string;
  name: string;
  platformRole: PlatformRole | null;
  mfaEnabled: boolean;
  locale: string;
  status: 'active' | 'disabled';
  createdAt: string;
  lastLoginAt: string | null;
}

export interface MembershipDto {
  orgId: string;
  orgName: string;
  orgSlug: string;
  orgKind: OrgKind;
  role: OrgRole;
}

export interface MeDto {
  user: UserDto;
  memberships: MembershipDto[];
  /** Platform level permissions (admin area). Empty for customers. */
  platformPermissions: Permission[];
  /** Present while the session still waits for the second factor. */
  mfaPending?: boolean;
}

export const ORG_KINDS = ['customer', 'reseller', 'internal'] as const;
export type OrgKind = (typeof ORG_KINDS)[number];
export type OrgStatus = 'active' | 'suspended';
/**
 * Who suspended an organization. A platform suspension can only be lifted by platform
 * staff, a reseller suspension by the reseller (or platform staff).
 */
export type SuspendedBy = 'platform' | 'reseller';

export interface OrgRef {
  id: string;
  name: string;
  slug: string;
}

export interface OrgCounts {
  projects: number;
  servers: number;
  members: number;
  domains: number;
  webspaces: number;
  /** Mail domains assigned to the organization. */
  mailDomains: number;
  /** Phone systems (PBX) assigned to the organization. */
  phoneSystems: number;
  /** Streaming accounts (Jellyfin) of the organization. */
  mediaAccounts: number;
  /** Monitors (Uptime Kuma) assigned to the organization. */
  monitors: number;
  /** Customer organizations below a reseller. 0 for everyone else. */
  customers: number;
}

export interface OrgDto {
  id: string;
  name: string;
  slug: string;
  kind: OrgKind;
  status: OrgStatus;
  /** Set while suspended. */
  suspendedBy: SuspendedBy | null;
  createdAt: string;
  /** Actions the current user may perform at organization level. */
  permissions: Permission[];
  role: OrgRole | null;
  /** Activated service modules. The console only shows these. */
  modules: ModuleKey[];
  /** The reseller this organization belongs to, if any. */
  parent: OrgRef | null;
  /** How the current user got access: membership, through the reseller, or as platform staff. */
  access: 'member' | 'reseller' | 'staff';
  counts?: OrgCounts;
}

export interface AdminOrgDto extends Omit<OrgDto, 'permissions' | 'role' | 'access'> {
  boundary: PolicyStatement[];
  counts: OrgCounts;
  notes: string | null;
}

/** A customer as seen by its reseller: GET /orgs/:resellerId/customers */
export interface ResellerCustomerDto {
  id: string;
  name: string;
  slug: string;
  status: OrgStatus;
  /** Set while suspended. A platform suspension can't be lifted by the reseller. */
  suspendedBy: SuspendedBy | null;
  modules: ModuleKey[];
  notes: string | null;
  counts: OrgCounts;
  /** Currency the customer is billed in. */
  currency: Currency;
  /** Credit balance and open invoice total in `currency`, minor units. */
  balance: number;
  openTotal: number;
  createdAt: string;
}

/** Mail delivery settings as shown in the admin area. The password is never returned. */
export interface MailSettingsDto {
  /** env: configured through SMTP_* variables and read-only in the UI. */
  source: 'env' | 'ui' | 'none';
  host: string | null;
  port: number;
  /** true = implicit TLS (465), false = STARTTLS if offered (587/25). */
  secure: boolean;
  user: string | null;
  passwordSet: boolean;
  from: string | null;
  replyTo: string | null;
}

export interface MailLogDto {
  id: string;
  to: string;
  subject: string;
  template: string | null;
  status: 'sent' | 'failed' | 'skipped';
  error: string | null;
  org: { id: string; name: string } | null;
  createdAt: string;
}

/** GET /admin/integrations */
export interface IntegrationsDto {
  mail: { configured: boolean; source: 'env' | 'ui' | 'none' };
  stripe: { configured: boolean; mode: 'live' | 'test' | null; webhookConfigured: boolean; twint: boolean };
  zoho: {
    configured: boolean;
    organizationId: string | null;
    lastError: string | null;
    lastSyncAt: string | null;
  };
}

export interface ProjectDto {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  createdAt: string;
  serverCount: number;
  runningCount: number;
  permissions: Permission[];
}

export interface ServerProtection {
  delete: boolean;
  rebuild: boolean;
}

export interface ServerDto {
  id: string;
  name: string;
  provider: { id: string; type: ProviderType; name: string };
  externalId: string;
  kind: ServerKind;
  status: ServerStatus;
  specs: ServerSpecs;
  usage: ServerUsage | null;
  ips: IpAddress[];
  os: string | null;
  node: string | null;
  location: Location;
  labels: Record<string, string>;
  protection: ServerProtection;
  project: { id: string; name: string } | null;
  org: { id: string; name: string; slug: string } | null;
  capabilities: Capability[];
  powerActions: PowerAction[];
  /** Actions the current user may perform on this server. */
  permissions: Permission[];
  lastSyncedAt: string | null;
  createdAt: string;
}

export interface MemberDto {
  membershipId: string;
  userId: string;
  email: string;
  name: string;
  role: OrgRole;
  mfaEnabled: boolean;
  policies: { id: string; name: string }[];
  joinedAt: string;
  lastLoginAt: string | null;
}

export interface InvitationDto {
  id: string;
  email: string;
  role: OrgRole;
  expiresAt: string;
  createdAt: string;
  invitedBy: string | null;
  /** Only returned once, right after creation. */
  link?: string;
}

export interface InvitationInfoDto {
  email: string;
  orgName: string;
  role: OrgRole;
  userExists: boolean;
  expiresAt: string;
}

export interface PolicyDto {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  statements: PolicyStatement[];
  attachedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApiTokenDto {
  id: string;
  name: string;
  prefix: string;
  scope: TokenScope;
  statements: PolicyStatement[] | null;
  user: { id: string; name: string };
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  /** Only returned once, right after creation. */
  token?: string;
}

export interface AuditEntryDto {
  id: string;
  createdAt: string;
  actor: { type: 'user' | 'token' | 'system'; id: string | null; name: string | null };
  org: { id: string; name: string } | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  status: 'success' | 'failure' | 'denied';
  ip: string | null;
  details: Record<string, unknown> | null;
}

export interface ProviderConnectionDto {
  id: string;
  type: ProviderType;
  name: string;
  location: Location;
  enabled: boolean;
  status: 'ok' | 'error' | 'unknown';
  lastError: string | null;
  lastSyncAt: string | null;
  serverCount: number;
  /** Non secret parts of the configuration, e.g. base URL and token id. */
  summary: Record<string, string>;
  createdAt: string;
}

export interface ServerActionDto {
  id: string;
  serverId: string;
  type: string;
  status: 'running' | 'success' | 'error';
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  user: { id: string; name: string } | null;
  providerRef: string | null;
}

export interface SessionDto {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
