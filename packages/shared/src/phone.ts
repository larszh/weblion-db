import type { Location, ProviderType } from './providers';
import type { Permission } from './permissions';

/**
 * Telephony (module "phone"): phone systems (PBX) and their users, ring groups and trunks.
 *
 * Every 3CX phone system is one provider connection of type "threecx" and reports exactly one
 * phone system (external id "pbx"). Platform staff assign it to an organization; a reseller can
 * hand it to its customers. An organization can have several (one per site). Users, ring groups
 * and trunks are read live from the PBX and never stored; the panel stores only the facts lists
 * and assignment need (PhoneSystemInfo). The panel never reads or sets any PBX password or PIN.
 */

/** Editions the panel tells apart. null in PhoneSystemInfo = unknown. */
export const PHONE_EDITIONS = ['standard', 'professional', 'enterprise'] as const;
export type PhoneEdition = (typeof PHONE_EDITIONS)[number];

export type PhoneSystemStatus = 'ok' | 'warning' | 'error' | 'unknown';

/** Why a phone system is not "ok". The first four make it an error, the others a warning. */
export const PHONE_STATUS_REASONS = [
  'unreachable',
  'not_activated',
  'license_inactive',
  'license_expired',
  'license_expiring',
  'maintenance_expired',
  'services_down',
  'trunks_down',
  'user_limit_reached',
] as const;
export type PhoneStatusReason = (typeof PHONE_STATUS_REASONS)[number];

const ERROR_REASONS: readonly PhoneStatusReason[] = [
  'unreachable',
  'not_activated',
  'license_inactive',
  'license_expired',
];

/** From this many days before the license expiry on, the phone system shows a warning. */
export const PHONE_LICENSE_WARN_DAYS = 30;

/** Facts of a phone system as the provider reports them. No secrets, never the license key. */
export interface PhoneSystemInfo {
  /** Host name the PBX reports (3CX SystemStatus.FQDN). */
  fqdn: string | null;
  /** e.g. "20.0.10.1479". */
  version: string | null;
  edition: PhoneEdition | null;
  /** Vendor product code, for support (3CX ProductCode). */
  productCode: string | null;
  activated: boolean | null;
  licenseActive: boolean | null;
  /** ISO 8601. null = none or unknown. */
  licenseExpiresAt: string | null;
  /** End of updates and support. ISO 8601 or null. */
  maintenanceExpiresAt: string | null;
  /** Simultaneous calls the license allows. */
  maxSimCalls: number | null;
  /** Calls in progress when the facts were read. */
  activeCalls: number | null;
  /** User extensions. */
  users: number | null;
  /** Maximum number of users, only when the license enforces one. null = no limit. */
  maxUsers: number | null;
  extensionsTotal: number | null;
  extensionsRegistered: number | null;
  trunksTotal: number | null;
  trunksRegistered: number | null;
  /** Some PBX services are not running. */
  servicesDown: boolean | null;
  /** Digits of a user extension number. null = unknown (then 2 to 10 digits are accepted). */
  numberLength: number | null;
  /** Web client (users and admins log in there), https only. */
  webClientUrl: string | null;
}

/** Status and reasons of a phone system from its facts. `reachable` false = last read failed. */
export function phoneSystemHealth(
  info: PhoneSystemInfo | null,
  reachable: boolean,
  now: Date = new Date(),
): { status: PhoneSystemStatus; reasons: PhoneStatusReason[] } {
  const reasons: PhoneStatusReason[] = [];
  if (!reachable) reasons.push('unreachable');
  if (info) {
    if (info.activated === false) reasons.push('not_activated');
    if (info.licenseActive === false) reasons.push('license_inactive');
    const expires = info.licenseExpiresAt ? Date.parse(info.licenseExpiresAt) : Number.NaN;
    if (!Number.isNaN(expires)) {
      if (expires <= now.getTime()) reasons.push('license_expired');
      else if (expires - now.getTime() <= PHONE_LICENSE_WARN_DAYS * 86_400_000) {
        reasons.push('license_expiring');
      }
    }
    const maintenance = info.maintenanceExpiresAt ? Date.parse(info.maintenanceExpiresAt) : Number.NaN;
    if (!Number.isNaN(maintenance) && maintenance <= now.getTime()) reasons.push('maintenance_expired');
    if (info.servicesDown === true) reasons.push('services_down');
    if (
      info.trunksTotal !== null &&
      info.trunksRegistered !== null &&
      info.trunksRegistered < info.trunksTotal
    ) {
      reasons.push('trunks_down');
    }
    if (info.maxUsers !== null && info.users !== null && info.users >= info.maxUsers) {
      reasons.push('user_limit_reached');
    }
  }
  const status: PhoneSystemStatus = reasons.some((r) => ERROR_REASONS.includes(r))
    ? 'error'
    : reasons.length > 0
      ? 'warning'
      : info
        ? 'ok'
        : 'unknown';
  return { status, reasons };
}

/** What a provider can do with a phone system besides showing its facts. */
export const PHONE_CAPABILITIES = [
  /** List, create, change and delete users. */
  'users',
  /** Propose the next free extension number. */
  'nextNumber',
  /** Send the PBX's welcome e-mail again. */
  'welcomeMail',
  /** List ring groups. */
  'ringGroups',
  /** Add and remove ring group members. */
  'ringGroupMembers',
  /** List trunks (read only). */
  'trunks',
] as const;
export type PhoneCapability = (typeof PHONE_CAPABILITIES)[number];

/** Languages the panel offers for a user (PBX user language). */
export const PHONE_LANGUAGES = ['de', 'en', 'fr', 'it'] as const;
export type PhoneLanguage = (typeof PHONE_LANGUAGES)[number];

/** 3CX refuses longer names (WARNINGS.LENGTH_NOT_MORE_50_CHARS). */
export const PHONE_NAME_MAX_LENGTH = 50;
export const PHONE_EMAIL_MAX_LENGTH = 254;
/** Lengths of user extension numbers when the phone system does not report one. */
export const PHONE_EXTENSION_MIN_DIGITS = 2;
export const PHONE_EXTENSION_MAX_DIGITS = 10;

/** Whether `number` is a valid user extension for a phone system with `numberLength` digits. */
export function isValidExtension(number: string, numberLength: number | null): boolean {
  if (!/^[0-9]+$/.test(number)) return false;
  if (numberLength !== null && numberLength > 0) return number.length === numberLength;
  return number.length >= PHONE_EXTENSION_MIN_DIGITS && number.length <= PHONE_EXTENSION_MAX_DIGITS;
}

/**
 * External numbers (mobile, outbound caller ID) as typed by people: spaces, dots, dashes,
 * slashes and brackets are removed, "00" stays as typed. Empty becomes null.
 */
export function normalizeExternalNumber(value: string | null | undefined): string | null {
  const cleaned = (value ?? '').replace(/[\s.\-/()]/g, '');
  return cleaned === '' ? null : cleaned;
}

/** After normalizeExternalNumber: optional "+", then 3 to 20 digits. */
export function isValidExternalNumber(value: string): boolean {
  return /^\+?[0-9]{3,20}$/.test(value);
}

/** A user of a phone system as the provider reports it. Never carries a password or PIN. */
export interface PhoneUser {
  /** Provider id of the user (3CX: the numeric Id as a string). */
  id: string;
  /** Extension number. Cannot be changed after creation. */
  number: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  email: string | null;
  mobile: string | null;
  outboundCallerId: string | null;
  language: string | null;
  enabled: boolean | null;
  /** An app or phone is registered for the extension right now. */
  registered: boolean | null;
  /** Role name as the PBX reports it (3CX Rights.RoleName), null when unknown. */
  role: string | null;
  /** The user administers the phone system (3CX system owner or system admin). */
  admin: boolean;
  /** Not a person: fax server, wake-up service, AI agent, service principal. */
  system: boolean;
}

export interface PhoneUserDto extends PhoneUser {
  /**
   * admin or system, or the role is unknown (null): only platform staff may delete it or change
   * its e-mail address.
   */
  protected: boolean;
}

/** GET /phone-systems/:id/users */
export interface PhoneUserListDto {
  users: PhoneUserDto[];
  /** Digits of a new extension number, from the stored facts. null = 2 to 10. */
  numberLength: number | null;
  /** From the stored facts: users and the enforced maximum (null = none). */
  usersCount: number | null;
  maxUsers: number | null;
}

/** POST /phone-systems/:id/users. Empty strings in optional fields mean "none". */
export interface PhoneUserCreateBody {
  /** Omitted or null: the PBX picks the next free number. */
  number?: string | null;
  firstName: string;
  lastName?: string | null;
  email: string;
  mobile?: string | null;
  outboundCallerId?: string | null;
  language?: PhoneLanguage | null;
  /** Default true: ask the PBX to send its welcome e-mail after creating the user. */
  sendWelcome?: boolean;
}

/** PATCH /phone-systems/:id/users/:userId. Fields left out keep their value. */
export interface PhoneUserPatchBody {
  firstName?: string;
  lastName?: string | null;
  email?: string;
  mobile?: string | null;
  outboundCallerId?: string | null;
  language?: PhoneLanguage | null;
}

/** Answer of POST /phone-systems/:id/users. */
export interface PhoneUserCreatedDto {
  user: PhoneUserDto;
  welcomeSent: boolean;
  /** Set when the user was created but the welcome e-mail failed. */
  welcomeError: string | null;
}

export type PhoneRingStrategy = 'hunt' | 'ring_all' | 'paging';

export interface PhoneRingGroup {
  id: string;
  number: string;
  name: string | null;
  strategy: PhoneRingStrategy | null;
  ringTimeSeconds: number | null;
  /** In ring order. */
  members: { number: string; name: string | null }[];
}

export type PhoneTrunkDirection = 'inbound' | 'outbound' | 'both' | 'none';

/** A trunk (SIP provider line), read only. Never carries credentials. */
export interface PhoneTrunk {
  id: string;
  number: string;
  /** Provider or gateway name (3CX Gateway.Name). */
  name: string | null;
  host: string | null;
  online: boolean | null;
  direction: PhoneTrunkDirection | null;
  externalNumber: string | null;
  simultaneousCalls: number | null;
  /** Number of DIDs routed over the trunk. */
  didCount: number;
  /** The PBX's description of a configuration problem, if any. */
  configurationIssue: string | null;
}

export interface PhoneSystemDto {
  id: string;
  name: string;
  provider: { id: string; type: ProviderType; name: string };
  location: Location;
  org: { id: string; name: string; slug: string } | null;
  status: PhoneSystemStatus;
  statusReasons: PhoneStatusReason[];
  info: PhoneSystemInfo | null;
  /** info.webClientUrl when it is https, else null. */
  webClientUrl: string | null;
  /** What the provider supports. The UI combines it with `permissions`. */
  capabilities: PhoneCapability[];
  /** Actions the current user may perform on this phone system. */
  permissions: Permission[];
  lastSyncedAt: string | null;
  missingSince: string | null;
  createdAt: string;
}

/** GET /phone-systems/:id: facts refreshed live when possible. */
export interface PhoneSystemDetailDto extends PhoneSystemDto {
  /** Set when live data could not be loaded; the stored facts are shown then. */
  liveError: string | null;
}

/** Error code of a refused user creation because the license allows no more users. */
export const PHONE_USER_LIMIT_CODE = 'phone_user_limit';
