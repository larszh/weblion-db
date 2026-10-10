import type { DnsRecordType, DomainCapability } from '@weblion/shared';

/**
 * Fixed facts of the Cloudflare integration, shared by the adapter and the demo simulation.
 * Frozen: the client, the adapter and the demo build on these values.
 */

export const CLOUDFLARE_PROVIDER = 'Cloudflare';
export const CLOUDFLARE_DEFAULT_BASE_URL = 'https://api.cloudflare.com/client/v4';
/** Record types the panel adds and changes at Cloudflare. */
export const CLOUDFLARE_RECORD_TYPES = [
  'A',
  'AAAA',
  'CNAME',
  'MX',
  'SRV',
  'TXT',
  'CAA',
  'PTR',
  'NS',
  'TLSA',
  'DS',
  'NAPTR',
] as const satisfies readonly DnsRecordType[];
export const CLOUDFLARE_DOMAIN_CAPABILITIES: DomainCapability[] = [
  'dns',
  'dnsTtl',
  'dnsTtlAuto',
  'dnsProxy',
  'cnameFlattening',
  'cdn',
];
export const CLOUDFLARE_TTL_MIN = 60;
export const CLOUDFLARE_TTL_MAX = 86_400;
/** Hex ids of zones, records and accounts. */
export const CLOUDFLARE_ID = /^[0-9a-f]{32}$/;
/** Permissions named in error hints and docs. */
export const CLOUDFLARE_TOKEN_PERMISSIONS = [
  'Zone:Edit',
  'DNS:Edit',
  'Zone Settings:Edit',
  'Cache Purge:Purge',
];
