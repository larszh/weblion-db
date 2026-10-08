import type { Location, ProviderType } from './providers';
import type { Permission } from './permissions';

/**
 * Domains (module "dns") and web spaces (module "webhosting").
 *
 * Both come from provider accounts (today 24fire) and are synced into the panel like
 * servers. Platform staff assign them to an organization. Live details (DNS records,
 * Plesk credentials) are fetched from the provider on demand and never stored.
 */

export const DNS_RECORD_TYPES = [
  'A',
  'AAAA',
  'CNAME',
  'ALIAS',
  'MX',
  'SRV',
  'TXT',
  'CAA',
  'PTR',
  'NS',
  'TLSA',
  'DS',
  'DNSKEY',
  'HTTP_REDIRECT',
  'HTTP_FRAME',
] as const;
export type DnsRecordType = (typeof DNS_RECORD_TYPES)[number];

export interface DnsRecord {
  id: string;
  type: DnsRecordType | string;
  /** Host part relative to the zone, "@" or "" for the apex. */
  name: string;
  data: string;
  ttl: number | null;
}

export interface DnsRecordInput {
  type: DnsRecordType;
  name: string;
  data: string;
}

/** Normalized domain facts from the provider. */
export interface DomainInfo {
  name: string;
  status: string | null;
  terminated: boolean;
  nameservers: string[];
  /** Registrant handle at the registry, if the provider exposes it. */
  handle: string | null;
  createdAt: string | null;
  expiresAt: string | null;
  autoRenew: boolean | null;
}

export interface WebspaceResources {
  domains: number | null;
  subdomains: number | null;
  emails: number | null;
  databases: number | null;
  /** MB */
  storageMb: number | null;
  /** GB per month, null = unlimited or unknown */
  trafficGb: number | null;
  memoryLimitMb: number | null;
  ipAddress: string | null;
}

/** Normalized web space facts from the provider (no secrets). */
export interface WebspaceInfo {
  name: string;
  resources: WebspaceResources;
  /** Control panel (Plesk) address, e.g. https://plesk.24fire.de:8443 */
  panelUrl: string | null;
  username: string | null;
  email: string | null;
  expiresAt: string | null;
}

export interface WebspaceCredentials {
  panelUrl: string | null;
  username: string | null;
  password: string | null;
  email: string | null;
}

export interface DomainDto {
  id: string;
  name: string;
  status: string | null;
  provider: { id: string; type: ProviderType; name: string };
  location: Location;
  org: { id: string; name: string; slug: string } | null;
  expiresAt: string | null;
  autoRenew: boolean | null;
  /** Actions the current user may perform on this domain. */
  permissions: Permission[];
  lastSyncedAt: string | null;
  missingSince: string | null;
  createdAt: string;
}

export interface DomainDetailDto extends DomainDto {
  info: DomainInfo | null;
  /** Set when live data could not be loaded from the provider. */
  liveError: string | null;
  /** DNS changes need the provider's premium plan (24fire+). */
  dnsWritable: boolean;
}

export interface WebspaceDto {
  id: string;
  name: string;
  provider: { id: string; type: ProviderType; name: string };
  location: Location;
  org: { id: string; name: string; slug: string } | null;
  resources: WebspaceResources | null;
  panelUrl: string | null;
  expiresAt: string | null;
  permissions: Permission[];
  lastSyncedAt: string | null;
  missingSince: string | null;
  createdAt: string;
}

export interface WebspaceDetailDto extends WebspaceDto {
  info: WebspaceInfo | null;
  liveError: string | null;
}
