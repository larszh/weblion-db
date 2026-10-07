/**
 * 24fire REST API v2 endpoints (https://apidocs.24fire.de/v2).
 *
 * Base URL: https://manage.24fire.de, auth header `X-Fire-Apikey`, form encoded bodies,
 * responses wrapped in `{ status, requestID, message, data }`.
 *
 * `verified: true` means the method and path were taken from the official v2 docs.
 * The others follow the documented naming scheme and the v1 API but could not be
 * checked against the docs while this was written. If 24fire answers with 404/405 for
 * one of them, fix the entry here; nothing else depends on the exact path.
 */
export interface Fire24Endpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  verified: boolean;
  /** Requires an active 24fire+ subscription on the account. */
  plus?: boolean;
}

export const FIRE24_ENDPOINTS = {
  accountServices: { method: 'GET', path: '/api/account/services', verified: true },
  accountDonations: { method: 'GET', path: '/api/account/donations', verified: true },

  kvmConfig: { method: 'GET', path: '/api/kvm/{id}/config', verified: true },
  kvmStatus: { method: 'GET', path: '/api/kvm/{id}/status', verified: false },
  kvmPower: { method: 'POST', path: '/api/kvm/{id}/power', verified: false },

  kvmTrafficCurrent: { method: 'GET', path: '/api/kvm/{id}/traffic/current', verified: true },
  kvmTrafficLog: { method: 'GET', path: '/api/kvm/{id}/traffic/log', verified: true },
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

  kvmBackupList: { method: 'GET', path: '/api/kvm/{id}/backup/list', verified: false, plus: true },
  kvmBackupCreate: { method: 'PUT', path: '/api/kvm/{id}/backup/create', verified: false, plus: true },
  kvmBackupRestore: { method: 'POST', path: '/api/kvm/{id}/backup/restore', verified: false, plus: true },
  kvmBackupDelete: { method: 'DELETE', path: '/api/kvm/{id}/backup/delete', verified: false, plus: true },

  domainDnsAdd: { method: 'PUT', path: '/api/domain/{id}/dns/add', verified: true, plus: true },
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
