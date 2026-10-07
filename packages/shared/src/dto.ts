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

export type OrgKind = 'internal' | 'customer';
export type OrgStatus = 'active' | 'suspended';

export interface OrgDto {
  id: string;
  name: string;
  slug: string;
  kind: OrgKind;
  status: OrgStatus;
  createdAt: string;
  /** Actions the current user may perform at organization level. */
  permissions: Permission[];
  role: OrgRole | null;
  counts?: { projects: number; servers: number; members: number };
}

export interface AdminOrgDto extends Omit<OrgDto, 'permissions' | 'role'> {
  boundary: PolicyStatement[];
  counts: { projects: number; servers: number; members: number };
  notes: string | null;
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
