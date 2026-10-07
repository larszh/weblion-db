/**
 * 24fire REST API v2 endpoints (https://apidocs.24fire.de/v2).
 *
 * Base URL: https://manage.24fire.de, auth header `X-Fire-Apikey`, form encoded bodies,
 * responses wrapped in `{ status, message, data }`.
 *
 * Every entry was checked against the official v2 docs (all 26 documented endpoints).
 * `plus: true` marks the endpoints the docs flag with "Nur verfügbar mit 24fire+". Keep
 * `verified: false` for anything added later without a doc reference: the adapter then
 * points at this file when 24fire answers with 404/405.
 */
export interface Fire24Endpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  verified: boolean;
  /** Requires an active 24fire+ subscription on the account. */
  plus?: boolean;
}

export const FIRE24_ENDPOINTS = {
  // Account
  account: { method: 'GET', path: '/api/account', verified: true },
  accountServices: { method: 'GET', path: '/api/account/services', verified: true },
  accountDonations: { method: 'GET', path: '/api/account/donations', verified: true },
  accountAffiliate: { method: 'GET', path: '/api/account/affiliate', verified: true },

  // Domains
  domainInfo: { method: 'GET', path: '/api/domain/{id}', verified: true },
  domainDns: { method: 'GET', path: '/api/domain/{id}/dns', verified: true },
  domainDnsAdd: { method: 'PUT', path: '/api/domain/{id}/dns/add', verified: true, plus: true },
  domainDnsEdit: { method: 'POST', path: '/api/domain/{id}/dns/edit', verified: true, plus: true },
  domainDnsRemove: { method: 'DELETE', path: '/api/domain/{id}/dns/remove', verified: true, plus: true },

  // KVM: backups
  kvmBackupList: { method: 'GET', path: '/api/kvm/{id}/backup/list', verified: true },
  kvmBackupCreate: { method: 'POST', path: '/api/kvm/{id}/backup/create', verified: true, plus: true },
  kvmBackupCreateStatus: {
    method: 'POST',
    path: '/api/kvm/{id}/backup/create/status',
    verified: true,
    plus: true,
  },
  kvmBackupRestore: { method: 'POST', path: '/api/kvm/{id}/backup/restore', verified: true, plus: true },
  kvmBackupRestoreStatus: {
    method: 'POST',
    path: '/api/kvm/{id}/backup/restore/status',
    verified: true,
    plus: true,
  },
  kvmBackupDelete: { method: 'DELETE', path: '/api/kvm/{id}/backup/delete', verified: true, plus: true },

  // KVM: traffic
  kvmTrafficCurrent: { method: 'GET', path: '/api/kvm/{id}/traffic/current', verified: true },
  kvmTrafficLog: { method: 'GET', path: '/api/kvm/{id}/traffic/log', verified: true },
  kvmTrafficChart: { method: 'POST', path: '/api/kvm/{id}/traffic/chart', verified: true, plus: true },

  // KVM: monitoring
  kvmMonitoringTimings: {
    method: 'GET',
    path: '/api/kvm/{id}/monitoring/timings',
    verified: true,
    plus: true,
  },
  kvmMonitoringIncidences: {
    method: 'GET',
    path: '/api/kvm/{id}/monitoring/incidences',
    verified: true,
    plus: true,
  },

  // KVM: DDoS protection
  kvmDdos: { method: 'GET', path: '/api/kvm/{id}/ddos', verified: true },
  kvmDdosChange: { method: 'POST', path: '/api/kvm/{id}/ddos/change', verified: true, plus: true },

  // KVM: configuration, status, power
  kvmConfig: { method: 'GET', path: '/api/kvm/{id}/config', verified: true },
  kvmStatus: { method: 'GET', path: '/api/kvm/{id}/status', verified: true },
  kvmPower: { method: 'POST', path: '/api/kvm/{id}/power', verified: true },

  // Web spaces (read only, there is no provisioning endpoint)
  webspaceInfo: { method: 'GET', path: '/api/webspace/{id}', verified: true },
} as const satisfies Record<string, Fire24Endpoint>;

export type Fire24EndpointName = keyof typeof FIRE24_ENDPOINTS;

/** Body field carrying the power action for kvmPower. */
export const FIRE24_POWER_FIELD = 'mode';

/** 24fire power modes, mapped from the panel's power actions. */
export const FIRE24_POWER_MODES = {
  start: 'start',
  stop: 'stop',
  reboot: 'restart',
} as const;

/** Values of the `ddos.layer4` and `ddos.layer7` enums. */
export const FIRE24_DDOS_LAYER4 = ['dynamic', 'permanent'] as const;
export const FIRE24_DDOS_LAYER7 = ['on', 'off'] as const;

/**
 * Backup descriptions: at most 24 characters, letters incl. umlauts and ß, spaces and
 * - _ + # ( ) . : (no digits).
 */
export const FIRE24_BACKUP_DESCRIPTION = /^[a-zA-ZäöüÄÖÜß _+#().:-]{0,24}$/;
