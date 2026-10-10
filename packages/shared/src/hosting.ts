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
  /** Seconds. 1 = automatic at providers with "dnsTtlAuto". */
  ttl: number | null;
  /** Shown but not editable in the panel (e.g. Joker DynDNS records). Can still be deleted. */
  readOnly?: boolean;
  /** Traffic goes through the provider's proxy (only with "dnsProxy"). */
  proxied?: boolean;
  /** Whether the provider can proxy this record (A, AAAA, CNAME with a public target). */
  proxiable?: boolean;
  /** Note stored with the record at the provider (Cloudflare comment). Read only in the panel. */
  comment?: string | null;
}

export interface DnsRecordInput {
  type: DnsRecordType;
  name: string;
  data: string;
  /** Seconds. Only used by providers with the "dnsTtl" capability, ignored otherwise. */
  ttl?: number | null;
  /** Only used by providers with the "dnsProxy" capability, ignored otherwise. A, AAAA, CNAME only. */
  proxied?: boolean;
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
  /** TTL 1 means "automatic" (Cloudflare). Other TTLs: 60 to 86400 s. */
  'dnsTtlAuto',
  /** Records can be routed through the provider's proxy/CDN (Cloudflare "orange cloud"). */
  'dnsProxy',
  /** CNAME records are allowed at the zone apex (the provider flattens them). */
  'cnameFlattening',
  /** SSL/TLS mode, Always Use HTTPS, development mode and cache purge (see CdnSettings). */
  'cdn',
] as const;
export type DomainCapability = (typeof DOMAIN_CAPABILITIES)[number];

/** What a registrar can offer (the demo registrar claims exactly these). */
export const REGISTRAR_CAPABILITIES = [
  'dns',
  'dnsTtl',
  'nameservers',
  'lock',
  'autoRenew',
  'renew',
  'authcode',
] as const satisfies readonly DomainCapability[];

/** Record types a proxy can carry. */
export const DNS_PROXIABLE_TYPES = ['A', 'AAAA', 'CNAME'] as const satisfies readonly DnsRecordType[];

/** TTL meaning "automatic" at providers with the "dnsTtlAuto" capability. */
export const DNS_TTL_AUTO = 1;

/** "registration": a registered domain (registrar). "zone": a DNS zone only (Cloudflare). */
export const DOMAIN_KINDS = ['registration', 'zone'] as const;
export type DomainKind = (typeof DOMAIN_KINDS)[number];

/** Facts of a DNS zone (kind "zone"). DomainInfo.nameservers are the assigned name servers. */
export interface DnsZoneInfo {
  /** "initializing" | "pending" | "active" | "moved" (Cloudflare). */
  status: string;
  /** "full" (provider is authoritative), "partial" (CNAME setup), "secondary". */
  type: string | null;
  /** DNS only: no proxy, no CDN. */
  paused: boolean;
  /** Delegation the provider saw before the zone became active. */
  originalNameservers: string[];
  originalRegistrar: string | null;
  activatedAt: string | null;
  /** Plan name, e.g. "Free Website". */
  plan: string | null;
}

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
  /** Only for kind "zone". */
  zone?: DnsZoneInfo | null;
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
  /** What the provider supports for this domain. The UI combines it with `permissions`. */
  capabilities: DomainCapability[];
  /** A registered domain, or a DNS zone only (Cloudflare). */
  kind: DomainKind;
  lastSyncedAt: string | null;
  missingSince: string | null;
  createdAt: string;
}

/** The other side of a registration/zone pair with the same name, as the caller may see it. */
export interface LinkedDomain {
  id: string;
  name: string;
  kind: DomainKind;
  provider: { id: string; type: ProviderType; name: string };
  org: { id: string; name: string; slug: string } | null;
  status: string | null;
  /** Zone: the name servers to delegate to. Registration: the current delegation. */
  nameservers: string[];
  /** Zone: active at the provider. Registration: the registrar serves the DNS (providerDns). */
  active: boolean | null;
}

export interface DomainDetailDto extends DomainDto {
  info: DomainInfo | null;
  /** Set when live data could not be loaded from the provider. */
  liveError: string | null;
  /** DNS changes need the provider's premium plan (24fire+). */
  dnsWritable: boolean;
  /** Record types the provider accepts when adding or changing records. */
  dnsRecordTypes: DnsRecordType[];
  /** Registration only: a zone of the same name in the panel (e.g. at Cloudflare). */
  dnsZone: LinkedDomain | null;
  /** Zone only: the registration of the same name in the panel. */
  registration: LinkedDomain | null;
}

// --- CDN ---------------------------------------------------------------------------

/** "auto" = Automatic SSL/TLS: Cloudflare chooses the mode and may raise it. */
export const CDN_SSL_MODES = ['auto', 'off', 'flexible', 'full', 'strict'] as const;
export type CdnSslMode = (typeof CDN_SSL_MODES)[number];

export interface CdnSettings {
  /** Effective mode, never "auto". Unknown values (e.g. "origin_pull") are passed through. */
  sslMode: string;
  /** Automatic SSL/TLS is on. null = could not be read. */
  sslAutomatic: boolean | null;
  alwaysUseHttps: boolean;
  developmentMode: boolean;
  /** Seconds until development mode switches itself off, null while off. */
  developmentModeRemaining: number | null;
  /** What the zone's plan lets the panel change. */
  editable: { sslMode: boolean; alwaysUseHttps: boolean; developmentMode: boolean };
}

/** Exactly one setting per change. */
export type CdnSettingPatch =
  { sslMode: CdnSslMode } | { alwaysUseHttps: boolean } | { developmentMode: boolean };

// --- DNS move (platform only) ------------------------------------------------------

export interface DnsMoveTarget {
  providerId: string;
  name: string;
  type: ProviderType;
}

export interface DnsMoveRecord {
  type: DnsRecordType;
  name: string;
  data: string;
  ttl: number | null;
  /** Converted type, e.g. "ALIAS" became CNAME (flattened at the apex). */
  convertedFrom?: string;
  /** Original TTL when it had to change (outside 60..86400 becomes automatic or 86400). */
  ttlFrom?: number | null;
}

export type DnsMoveSkipReason = 'type' | 'readOnly' | 'apexNs';

export interface DnsMoveSkipped {
  type: string;
  name: string;
  data: string;
  reason: DnsMoveSkipReason;
}

export interface DnsMovePreview {
  domain: {
    id: string;
    name: string;
    provider: { id: string; type: ProviderType; name: string };
    org: { id: string; name: string; slug: string } | null;
  };
  /** Enabled connections that can create zones. Empty: nothing to move to. */
  targets: DnsMoveTarget[];
  /** The target the plan below was made for. */
  targetProviderId: string | null;
  /** A zone of this name already in the panel (any organization). */
  existingZone: LinkedDomain | null;
  /** The registrar serves the live zone, so its records can be copied. */
  recordsAvailable: boolean;
  recordsError: string | null;
  records: DnsMoveRecord[];
  skipped: DnsMoveSkipped[];
  /** The registrar can switch name servers through the panel. */
  canSetNameservers: boolean;
  /** More records than this are not copied (tooManyRecords). */
  maxRecords: number;
}

export interface DnsMoveRequest {
  targetProviderId: string;
  importRecords: boolean;
  setNameservers: boolean;
}

export interface DnsMoveResult {
  zone: LinkedDomain;
  /** false: an existing zone was reused (in the panel or at Cloudflare). */
  zoneCreated: boolean;
  import: {
    status: 'done' | 'partial' | 'skipped' | 'failed';
    reason:
      null | 'notRequested' | 'registrarNotServing' | 'zoneNotEmpty' | 'tooManyRecords' | 'recordsUnreadable';
    copied: number;
    failed: { type: string; name: string; error: string }[];
    skipped: DnsMoveSkipped[];
  };
  nameservers: {
    status: 'done' | 'skipped' | 'failed' | 'manual';
    reason: null | 'notRequested' | 'importIncomplete' | 'unsupported';
    nameservers: string[];
    providerRef: string | null;
    message: string | null;
    error: string | null;
  };
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
