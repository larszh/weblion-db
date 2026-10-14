import type { PhoneEdition, PhoneRingGroup, PhoneRingStrategy, PhoneTrunk, PhoneUser } from '@weblion/shared';
import { unsupported } from '../../lib/errors';
import type { PhoneUserInput, PhoneUserPatch, RemotePhoneSystem } from '../types';

/**
 * Simulated 3CX phone systems for the demo provider: three sites with users, ring groups and
 * trunks, kept in memory per connection like the other demo data. Placeholder until the
 * simulation is implemented: the names below are the contract the demo adapter and the tests
 * use. No phone systems yet, so the sync of the demo connection keeps working.
 */

/** External ids of the simulated phone systems. */
export const DEMO_PHONE_SYSTEMS = {
  zurich: 'demo-pbx-zh',
  bern: 'demo-pbx-be',
  lab: 'demo-pbx-lab',
} as const;

export interface DemoPhoneUser {
  /** "1", "2", ... per system. */
  id: string;
  number: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  mobile: string | null;
  outboundCallerId: string | null;
  language: string | null;
  enabled: boolean;
  registered: boolean;
  /** "system_owners" | "system_admins" | "users" | ... */
  role: string;
  /** e.g. ["FaxServer"]. */
  tags: string[];
  /** Welcome e-mails sent, for tests and the dev stack. */
  welcomeMails: number;
}

export interface DemoRingGroup {
  id: string;
  number: string;
  name: string;
  strategy: PhoneRingStrategy;
  ringTimeSeconds: number;
  /** Extension numbers in ring order. */
  members: string[];
}

export interface DemoPhoneSystem {
  externalId: string;
  /** The FQDN. */
  name: string;
  version: string;
  edition: PhoneEdition;
  productCode: string;
  /** ISO, relative to the time the state was created. */
  licenseExpiresAt: string;
  maintenanceExpiresAt: string;
  maxSimCalls: number;
  /** Enforced limit, null = none. */
  maxUsers: number | null;
  numberLength: number;
  servicesDown: boolean;
  /** By id. */
  users: Map<string, DemoPhoneUser>;
  /** By id. */
  ringGroups: Map<string, DemoRingGroup>;
  trunks: PhoneTrunk[];
  nextId: number;
  /** Tests: listPhoneSystems reports it with reachable false, every other call throws 502. */
  unreachable: boolean;
}

export interface DemoPhoneState {
  systems: Map<string, DemoPhoneSystem>;
}

const notImplemented = () => unsupported('demo telephony not implemented yet');

/** The state of one demo connection. */
export function demoPhoneState(_connectionId: string): DemoPhoneState {
  return { systems: new Map() };
}

/** Test helper: forget all simulated telephony state. */
export function resetDemoPhone(): void {}

/**
 * Synchronous simulation of the telephony methods of ProviderAdapter (same names and
 * arguments); DemoAdapter wraps each one in an async method.
 */
export class DemoPhone {
  constructor(private readonly state: DemoPhoneState) {}

  /** Every simulated phone system, unreachable ones with `reachable: false`. */
  listPhoneSystems(): RemotePhoneSystem[] {
    return [];
  }

  getPhoneSystem(_systemId: string): RemotePhoneSystem {
    throw notImplemented();
  }

  listPhoneUsers(_systemId: string): PhoneUser[] {
    throw notImplemented();
  }

  getPhoneUser(_systemId: string, _userId: string): PhoneUser {
    throw notImplemented();
  }

  nextPhoneNumber(_systemId: string): string | null {
    throw notImplemented();
  }

  createPhoneUser(_systemId: string, _input: PhoneUserInput): PhoneUser {
    throw notImplemented();
  }

  updatePhoneUser(_systemId: string, _userId: string, _patch: PhoneUserPatch): PhoneUser {
    throw notImplemented();
  }

  deletePhoneUser(_systemId: string, _userId: string): void {
    throw notImplemented();
  }

  sendPhoneWelcome(_systemId: string, _userId: string): void {
    throw notImplemented();
  }

  listPhoneRingGroups(_systemId: string): PhoneRingGroup[] {
    throw notImplemented();
  }

  addPhoneRingGroupMember(_systemId: string, _groupId: string, _number: string): PhoneRingGroup {
    throw notImplemented();
  }

  removePhoneRingGroupMember(_systemId: string, _groupId: string, _number: string): PhoneRingGroup {
    throw notImplemented();
  }

  listPhoneTrunks(_systemId: string): PhoneTrunk[] {
    throw notImplemented();
  }
}
