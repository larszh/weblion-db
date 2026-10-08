import type { Location, ProviderType } from './providers';
import type { Permission } from './permissions';

/**
 * Domains (module "dns") and web spaces (module "webhosting").
 *
 * Both come from provider accounts (24fire, Joker.com for domains) and are synced into the
 * panel like servers. Platform staff assign them to an organization. Live details (DNS
 * records, Plesk credentials) are fetched from the provider on demand and never stored.
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
  'NAPTR',
  'MAILFW',
] as const;
export type DnsRecordType = (typeof DNS_RECORD_TYPES)[number];

/**
 * Value formats in `data`, the same for every provider (adapters convert):
 * A/AAAA address, CNAME/ALIAS/NS host name, MX "priority host", SRV "priority weight port
 * target", CAA "flags tag value" (value quoted), TXT the plain text without quotes, NAPTR
 * "order preference "flags" "service" "regexp" replacement", HTTP_REDIRECT/HTTP_FRAME the
 * target URL, MAILFW the address mail is forwarded to.
 */
export interface DnsRecord {
  id: string;
  type: DnsRecordType | string;
  /** Host part relative to the zone, "@" or "" for the apex. */
  name: string;
  data: string;
  ttl: number | null;
  /** Shown but not editable in the panel (e.g. Joker DynDNS records). Can still be deleted. */
  readOnly?: boolean;
}

export interface DnsRecordInput {
  type: DnsRecordType;
  name: string;
  data: string;
  /** Seconds. Only used by providers with the "dnsTtl" capability, ignored otherwise. */
  ttl?: number | null;
}

/** What a provider can do with a domain besides listing it. */
export const DOMAIN_CAPABILITIES = [
  /** DNS records can be listed (and changed, see dnsWritable). */
  'dns',
  /** DNS records take a TTL. */
  'dnsTtl',
  /** Name servers can be changed. */
  'nameservers',
  /** Transfer lock can be switched. */
  'lock',
  /** Auto-renew can be switched (platform staff only, costs money). */
  'autoRenew',
  /** Registration can be extended (platform staff only, costs money). */
  'renew',
  /** The transfer auth code can be fetched. */
  'authcode',
] as const;
export type DomainCapability = (typeof DOMAIN_CAPABILITIES)[number];

/** Registrant as shown by the registrar, no handles or addresses. */
export interface DomainRegistrant {
  name: string | null;
  organization: string | null;
  email: string | null;
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
  /** Transfer lock. Optional: rows synced before this field existed lack it. */
  locked?: boolean | null;
  /** Whois privacy ("basic", "pro", "none"), if the provider exposes it. */
  privacy?: string | null;
  /** DNSSEC active at the registry. */
  dnssec?: boolean | null;
  /** The zone is served by the provider's name servers, i.e. DNS records there are live. */
  providerDns?: boolean | null;
  registrant?: DomainRegistrant | null;
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
  /** What the provider supports for this domain. The UI combines it with `permissions`. */
  capabilities: DomainCapability[];
  /** Record types the provider accepts when adding or changing records. */
  dnsRecordTypes: DnsRecordType[];
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
