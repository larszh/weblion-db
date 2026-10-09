import type { Location, ProviderType } from './providers';
import type { Permission } from './permissions';

/**
 * Cloud storage (module "storage"): Nextcloud accounts sold with a storage allowance.
 *
 * weblion runs its own Nextcloud instance(s), connected as provider connections of type
 * "nextcloud". Platform staff (or the reseller) give an organization an allowance on one
 * instance: total storage and optionally a maximum number of accounts. Within it the
 * organization creates accounts with a quota each. Usage is synced from Nextcloud.
 *
 * Login names are "<name>@<org slug>" (e.g. "anna@muster-ag"), so names never collide
 * between customers on a shared instance. Every account of an organization is in the
 * Nextcloud group "<group prefix><org slug>", so colleagues can share with each other.
 */

/** Smallest quota of one account. */
export const CLOUD_MIN_QUOTA_BYTES = 1024 ** 3;

/** Local part of a login name: what the customer types before "@<org slug>". */
export const CLOUD_ACCOUNT_NAME_PATTERN = /^[a-z0-9]([a-z0-9._-]{0,30}[a-z0-9])?$/;

export interface CloudAllowanceDto {
  orgId: string;
  /** The Nextcloud instance the accounts live on. */
  provider: { id: string; type: ProviderType; name: string; url: string | null } | null;
  /** Total storage the organization may hand out to its accounts. */
  quotaBytes: number;
  /** null = no limit on the number of accounts. */
  maxAccounts: number | null;
  /** Sum of the quotas of the organization's accounts. */
  allocatedBytes: number;
  /** Sum of what the accounts actually use (as last synced). */
  usedBytes: number;
  accounts: number;
  updatedAt: string | null;
}

export interface CloudAccountDto {
  id: string;
  /** Nextcloud login name, e.g. "anna@muster-ag". */
  username: string;
  displayName: string | null;
  email: string | null;
  quotaBytes: number | null;
  usedBytes: number | null;
  enabled: boolean;
  lastLoginAt: string | null;
  provider: { id: string; type: ProviderType; name: string };
  location: Location;
  org: { id: string; name: string; slug: string } | null;
  /** Where the user logs in (the instance's base URL). */
  loginUrl: string | null;
  /** Actions the current user may perform on this account. */
  permissions: Permission[];
  lastSyncedAt: string | null;
  missingSince: string | null;
  createdAt: string;
}

/** GET /orgs/:orgId/cloud */
export interface OrgCloudDto {
  allowance: CloudAllowanceDto | null;
  accounts: CloudAccountDto[];
}

/** Answer of creating an account or setting a new password: the password is shown once. */
export interface CloudAccountSecretDto {
  account: CloudAccountDto;
  /** Generated password. null when the user sets it via Nextcloud's invitation mail. */
  password: string | null;
}
