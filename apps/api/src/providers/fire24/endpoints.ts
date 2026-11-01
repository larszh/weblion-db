import { FIRE24_SCOPES_FULL, FIRE24_SCOPES_READ_ONLY } from '@weblion/shared';

/**
 * 24fire Customer REST API v1 (OpenAPI 3.1 "24fire Customer REST API" 1.0.0, a copy is in
 * apps/api/test/fixtures/fire24/openapi-v1.json).
 *
 * Base URL https://api.24fire.de, every path under /v1, `Authorization: Bearer <PAT>`, form
 * encoded bodies, answers `{ status: "success", data, meta? }` or
 * `{ status: "error", type, message, errors? }`. Lists have 25 entries per page (`?page=`).
 *
 * One row per operation the console knows. A test compares every row with the spec copy
 * (method, path, scope), and every operation of the spec must be a row or in
 * FIRE24_UNUSED_OPERATIONS, so a new spec copy with new operations fails until someone decides.
 *
 * `documented: false` means the spec only shows `"data": "example"`: the shape is a guess
 * (mostly the v2 payload, passed through) and the parsers in parse.ts take it tolerantly.
 */

/** `x-required-scope` values of the spec. */
export type Fire24Scope =
  | 'account:read'
  | 'status:read'
  | 'services:read'
  | 'servers:read'
  | 'server:read'
  | 'server:power'
  | 'server:console'
  | 'server:reinstall'
  | 'server:credentials'
  | 'server:backups'
  | 'server:network'
  | 'server:ssh'
  | 'server:iso'
  | 'server:monitoring'
  | 'domains:read'
  | 'domain:read'
  | 'domain:dns'
  | 'domain:nameserver'
  | 'webspaces:read'
  | 'webspace:read'
  | 'webspace:credentials'
  | 'donations:read'
  | 'affiliate:read';

// The shared lists (provider form, docs) may only name scopes of this table.
FIRE24_SCOPES_FULL satisfies readonly Fire24Scope[];
FIRE24_SCOPES_READ_ONLY satisfies readonly Fire24Scope[];

export interface Fire24Endpoint {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Placeholders: {server} {domain} {webspace} {backup} {record} {sshKey}. */
  path: string;
  /** x-required-scope of the operation. */
  scope: Fire24Scope;
  /** The spec shows the shape of `data` (true) or only "example" (false). Request bodies are documented. */
  documented: boolean;
  /** ?page= and meta. */
  paginated?: boolean;
}

export const FIRE24_ENDPOINTS = {
  // Account, status, services
  account: { method: 'GET', path: '/v1/account', scope: 'account:read', documented: true },
  status: { method: 'GET', path: '/v1/status', scope: 'status:read', documented: true },
  /** `?category=` kvm, domain, plesk or dedicated. */
  services: {
    method: 'GET',
    path: '/v1/services',
    scope: 'services:read',
    documented: true,
    paginated: true,
  },

  // Servers: overview
  servers: { method: 'GET', path: '/v1/servers', scope: 'servers:read', documented: true, paginated: true },
  server: { method: 'GET', path: '/v1/servers/{server}', scope: 'server:read', documented: true },
  serverStatus: {
    method: 'GET',
    path: '/v1/servers/{server}/status',
    scope: 'server:read',
    documented: false,
  },
  serverConfig: {
    method: 'GET',
    path: '/v1/servers/{server}/config',
    scope: 'server:read',
    documented: false,
  },
  serverNetwork: {
    method: 'GET',
    path: '/v1/servers/{server}/network',
    scope: 'server:read',
    documented: false,
  },
  serverTraffic: {
    method: 'GET',
    path: '/v1/servers/{server}/traffic',
    scope: 'server:read',
    documented: false,
  },
  serverAbuses: {
    method: 'GET',
    path: '/v1/servers/{server}/abuses',
    scope: 'server:read',
    documented: false,
  },
  serverOsList: {
    method: 'GET',
    path: '/v1/servers/{server}/os-list',
    scope: 'server:read',
    documented: false,
  },
  serverIsoList: {
    method: 'GET',
    path: '/v1/servers/{server}/iso-list',
    scope: 'server:read',
    documented: false,
  },
  reinstallStatus: {
    method: 'GET',
    path: '/v1/servers/{server}/reinstall/status',
    scope: 'server:read',
    documented: false,
  },

  // Servers: power, console, operating system and access
  /** Body `mode` (power_mode). */
  power: { method: 'POST', path: '/v1/servers/{server}/power', scope: 'server:power', documented: false },
  console: {
    method: 'POST',
    path: '/v1/servers/{server}/console',
    scope: 'server:console',
    documented: false,
  },
  /** Body `os` (required), `hostname`, `password_login`, `ssh_key`, `motd`. */
  reinstall: {
    method: 'POST',
    path: '/v1/servers/{server}/reinstall',
    scope: 'server:reinstall',
    documented: false,
  },
  /** Returns the new root password once. Refused in the explorer. */
  passwordReset: {
    method: 'POST',
    path: '/v1/servers/{server}/password-reset',
    scope: 'server:credentials',
    documented: false,
  },

  // Servers: backups (one scope for reading and writing)
  backups: {
    method: 'GET',
    path: '/v1/servers/{server}/backups',
    scope: 'server:backups',
    documented: false,
  },
  /** No request body in the spec (v2 took a description). */
  backupCreate: {
    method: 'POST',
    path: '/v1/servers/{server}/backups',
    scope: 'server:backups',
    documented: false,
  },
  backupCreateStatus: {
    method: 'GET',
    path: '/v1/servers/{server}/backups/{backup}/create-status',
    scope: 'server:backups',
    documented: false,
  },
  backupRestore: {
    method: 'POST',
    path: '/v1/servers/{server}/backups/{backup}/restore',
    scope: 'server:backups',
    documented: false,
  },
  backupRestoreStatus: {
    method: 'GET',
    path: '/v1/servers/{server}/backups/{backup}/restore-status',
    scope: 'server:backups',
    documented: false,
  },
  backupDelete: {
    method: 'DELETE',
    path: '/v1/servers/{server}/backups/{backup}',
    scope: 'server:backups',
    documented: false,
  },

  // Servers: network
  rdns: { method: 'GET', path: '/v1/servers/{server}/rdns', scope: 'server:read', documented: false },
  /** Body `ip_address`, `ptr` (required), `note`. */
  rdnsSet: { method: 'PUT', path: '/v1/servers/{server}/rdns', scope: 'server:network', documented: false },
  /** Query `ip_address`. */
  rdnsDelete: {
    method: 'DELETE',
    path: '/v1/servers/{server}/rdns',
    scope: 'server:network',
    documented: false,
  },
  ddos: { method: 'GET', path: '/v1/servers/{server}/ddos', scope: 'server:read', documented: false },
  /** Body `layer4`, `layer7`, `ip_address`. */
  ddosSet: { method: 'POST', path: '/v1/servers/{server}/ddos', scope: 'server:network', documented: false },

  // Servers: SSH keys. In the table for the explorer and the scope test; the adapter does not use them yet.
  sshKeys: { method: 'GET', path: '/v1/servers/{server}/ssh-keys', scope: 'server:ssh', documented: false },
  /** Body `public_key` (required), `name`. */
  sshKeyAdd: {
    method: 'POST',
    path: '/v1/servers/{server}/ssh-keys',
    scope: 'server:ssh',
    documented: false,
  },
  /** Returns a private key once. Refused in the explorer. */
  sshKeyGenerate: {
    method: 'POST',
    path: '/v1/servers/{server}/ssh-keys/generate',
    scope: 'server:ssh',
    documented: false,
  },
  sshKeyDelete: {
    method: 'DELETE',
    path: '/v1/servers/{server}/ssh-keys/{sshKey}',
    scope: 'server:ssh',
    documented: false,
  },

  // Servers: ISO and monitoring
  /** Body `iso`. */
  isoMount: { method: 'PUT', path: '/v1/servers/{server}/iso', scope: 'server:iso', documented: false },
  isoEject: { method: 'DELETE', path: '/v1/servers/{server}/iso', scope: 'server:iso', documented: false },
  /** Timings and incidences in one answer. */
  monitoring: {
    method: 'GET',
    path: '/v1/servers/{server}/monitoring',
    scope: 'server:monitoring',
    documented: false,
  },
  /** Body `enabled`, `port`. Not used by the adapter yet. */
  monitoringSet: {
    method: 'POST',
    path: '/v1/servers/{server}/monitoring',
    scope: 'server:monitoring',
    documented: false,
  },

  // Domains and DNS. {domain} is the id from the list, not the FQDN.
  domains: { method: 'GET', path: '/v1/domains', scope: 'domains:read', documented: true, paginated: true },
  /** "The auth code is never returned." */
  domain: { method: 'GET', path: '/v1/domains/{domain}', scope: 'domain:read', documented: false },
  dns: { method: 'GET', path: '/v1/domains/{domain}/dns', scope: 'domain:read', documented: false },
  /** Body `type` (dns_type), `name`, `data`, all required. Answers `{ created: true }`. */
  dnsCreate: { method: 'POST', path: '/v1/domains/{domain}/dns', scope: 'domain:dns', documented: true },
  /** Same body, all three fields required. Answers `{ updated: true }`. */
  dnsUpdate: {
    method: 'PATCH',
    path: '/v1/domains/{domain}/dns/{record}',
    scope: 'domain:dns',
    documented: true,
  },
  dnsDelete: {
    method: 'DELETE',
    path: '/v1/domains/{domain}/dns/{record}',
    scope: 'domain:dns',
    documented: true,
  },
  nameservers: {
    method: 'GET',
    path: '/v1/domains/{domain}/nameservers',
    scope: 'domain:read',
    documented: false,
  },
  /** Body `ns1`, `ns2` (required), `ns3` to `ns5` in order. */
  nameserversSet: {
    method: 'PUT',
    path: '/v1/domains/{domain}/nameservers',
    scope: 'domain:nameserver',
    documented: false,
  },

  // Web spaces (Plesk)
  webspaces: {
    method: 'GET',
    path: '/v1/webspaces',
    scope: 'webspaces:read',
    documented: true,
    paginated: true,
  },
  /** `resources` is null in the spec example. */
  webspace: { method: 'GET', path: '/v1/webspaces/{webspace}', scope: 'webspace:read', documented: true },
  /** `{ package, resources }`, the shape of resources is unknown. */
  webspaceUsage: {
    method: 'GET',
    path: '/v1/webspaces/{webspace}/usage',
    scope: 'webspace:read',
    documented: false,
  },
  /** `{ login_url }`, a short-lived Plesk sign-in link. Refused in the explorer. */
  webspaceLogin: {
    method: 'POST',
    path: '/v1/webspaces/{webspace}/login',
    scope: 'webspace:credentials',
    documented: true,
  },
} as const satisfies Record<string, Fire24Endpoint>;

export type Fire24EndpointName = keyof typeof FIRE24_ENDPOINTS;

/** Operations of the spec the console does not use (and does not ask a scope for). */
export const FIRE24_UNUSED_OPERATIONS = [
  'GET /v1/donations',
  'GET /v1/donations/stats',
  'GET /v1/donations/list',
  'GET /v1/affiliate',
  'GET /v1/affiliate/stats',
  'GET /v1/affiliate/leads',
] as const;

/** 24fire power modes (spec enum power_mode), mapped from the panel's power actions. */
export const FIRE24_POWER_MODES = {
  start: 'start',
  stop: 'stop',
  reboot: 'restart',
} as const;

/** Spec enums ddos_layer4 and ddos_layer7. */
export const FIRE24_DDOS_LAYER4 = ['dynamic', 'permanent'] as const;
export const FIRE24_DDOS_LAYER7 = ['on', 'off'] as const;

/** Spec enum dns_type. No TTL field: 24fire sets it. HTTP_FRAME of API v2 is gone. */
export const FIRE24_DNS_TYPES = [
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
] as const;

/** Spec enum services_category. "plesk" are the web spaces. */
export const FIRE24_SERVICE_CATEGORIES = ['kvm', 'domain', 'plesk', 'dedicated'] as const;
