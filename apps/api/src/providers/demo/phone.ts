import {
  PHONE_EMAIL_MAX_LENGTH,
  PHONE_LANGUAGES,
  PHONE_NAME_MAX_LENGTH,
  isValidExtension,
  isValidExternalNumber,
  type PhoneEdition,
  type PhoneRingGroup,
  type PhoneRingStrategy,
  type PhoneSystemInfo,
  type PhoneTrunk,
  type PhoneUser,
} from '@weblion/shared';
import { ProviderError, badRequest, conflict, notFound, phoneUserLimit } from '../../lib/errors';
import type { PhoneUserInput, PhoneUserPatch, RemotePhoneSystem } from '../types';

/**
 * Simulated 3CX phone systems for the demo provider: three sites with users, ring groups and
 * trunks, kept in memory per connection like the other demo data, so changes survive adapter
 * re-creation. Refuses what the 3CX adapter refuses (number length, numbers in use, the license's
 * user limit, the fax server) with the same statuses, so the dev stack and the route tests see
 * the same behaviour as with a real PBX. Never holds a password or PIN.
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

const STATE = new Map<string, DemoPhoneState>();

const PROVIDER = 'Demo';
const DAY = 86_400_000;
/** Role names that administer the PBX, as the 3CX adapter reads them (design 1.10). */
const ADMIN_ROLES = ['system_owners', 'system_admins'];
/** User tags of users that are not people (3CX Pbx.UserTag). */
const SYSTEM_TAGS = ['FaxServer', 'WakeUp', 'Principal', 'AI'];
/** 3CX refuses to delete its fax server (WARNINGS.FAX_SERVER_CANNOT_BE_DELETED). */
const FAX_TAG = 'FaxServer';
const EMAIL = /^[^\s@]+@[^\s@]+$/;

interface UserSeed {
  number: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  mobile?: string;
  outboundCallerId?: string;
  language?: string;
  /** Default true. */
  registered?: boolean;
  /** Default "users". */
  role?: string;
  tags?: string[];
}

interface SystemSeed {
  externalId: string;
  name: string;
  version: string;
  edition: PhoneEdition;
  productCode: string;
  /** License (and maintenance) end, days after the state was created. */
  licenseDays: number;
  maxSimCalls: number;
  maxUsers: number | null;
  numberLength: number;
  users: UserSeed[];
  ringGroups: Omit<DemoRingGroup, 'id'>[];
  trunks: Omit<PhoneTrunk, 'id'>[];
}

/**
 * Zürich and Bern are the two sites of Muster AG (seed-phone.ts), the lab system stays
 * unassigned for the admin assignment demo. Zürich is fine, Bern has a trunk that does not
 * register, the lab's license runs out soon and allows 10 users (9 exist).
 */
const SYSTEMS: SystemSeed[] = [
  {
    externalId: DEMO_PHONE_SYSTEMS.zurich,
    name: 'pbx-zuerich.demo.weblion.one',
    version: '20.0.10.1479',
    edition: 'enterprise',
    productCode: 'DEMO-ENT-16',
    licenseDays: 300,
    maxSimCalls: 16,
    maxUsers: null,
    numberLength: 3,
    users: [
      {
        number: '100',
        firstName: 'Anna',
        lastName: 'Muster',
        email: 'anna@muster.example',
        mobile: '+41791234500',
        language: 'de',
        role: 'system_owners',
      },
      { number: '101', firstName: 'Ben', lastName: 'Beispiel', email: 'ben@muster.example', language: 'de' },
      {
        number: '102',
        firstName: 'Carla',
        lastName: 'Rossi',
        email: 'carla@muster.example',
        language: 'it',
        registered: false,
      },
      {
        number: '103',
        firstName: 'Daniel',
        lastName: 'Keller',
        email: 'daniel@muster.example',
        mobile: '+41791234503',
        language: 'de',
      },
      {
        number: '104',
        firstName: 'Empfang',
        lastName: null,
        email: 'empfang@muster.example',
        outboundCallerId: '+41441234500',
        language: 'de',
      },
      { number: '105', firstName: 'Fax', lastName: null, email: null, tags: [FAX_TAG] },
    ],
    ringGroups: [
      {
        number: '800',
        name: 'Zentrale',
        strategy: 'ring_all',
        ringTimeSeconds: 20,
        members: ['100', '101', '104'],
      },
      { number: '801', name: 'Support', strategy: 'hunt', ringTimeSeconds: 15, members: ['102', '103'] },
    ],
    trunks: [
      {
        number: '10000',
        name: 'Swisscom SIP',
        host: 'sip.swisscom.example',
        online: true,
        direction: 'both',
        externalNumber: '+41441234500',
        simultaneousCalls: 8,
        didCount: 10,
        configurationIssue: null,
      },
      {
        number: '10001',
        name: 'Peoplefone',
        host: 'sip.peoplefone.example',
        online: true,
        direction: 'outbound',
        externalNumber: '+41445005000',
        simultaneousCalls: 4,
        didCount: 0,
        configurationIssue: null,
      },
    ],
  },
  {
    externalId: DEMO_PHONE_SYSTEMS.bern,
    name: 'pbx-bern.demo.weblion.one',
    version: '20.0.9.1375',
    edition: 'professional',
    productCode: 'DEMO-PRO-8',
    licenseDays: 200,
    maxSimCalls: 8,
    maxUsers: null,
    numberLength: 3,
    users: [
      {
        number: '200',
        firstName: 'Eva',
        lastName: 'Brunner',
        email: 'eva@muster.example',
        language: 'de',
        role: 'system_admins',
      },
      {
        number: '201',
        firstName: 'Fritz',
        lastName: 'Meier',
        email: 'fritz@muster.example',
        language: 'de',
        registered: false,
      },
      { number: '202', firstName: 'Lager', lastName: null, email: 'lager@muster.example', language: 'de' },
    ],
    ringGroups: [
      { number: '810', name: 'Bern', strategy: 'ring_all', ringTimeSeconds: 20, members: ['200', '201'] },
    ],
    trunks: [
      {
        number: '10000',
        name: 'Peoplefone Bern',
        host: 'sip.peoplefone.example',
        online: false,
        direction: 'both',
        externalNumber: '+41315005000',
        simultaneousCalls: 4,
        didCount: 3,
        configurationIssue: 'Registration failed: 403 Forbidden',
      },
    ],
  },
  {
    externalId: DEMO_PHONE_SYSTEMS.lab,
    name: 'pbx-lab.demo.weblion.one',
    version: '20.0.10.1479',
    edition: 'standard',
    productCode: 'DEMO-STD-4',
    licenseDays: 10,
    maxSimCalls: 4,
    maxUsers: 10,
    numberLength: 4,
    users: Array.from({ length: 9 }, (_, i) => ({
      number: String(1000 + i),
      firstName: 'Test',
      lastName: String(i + 1),
      email: `test${i + 1}@lab.example`,
      language: 'en',
      registered: false,
    })),
    ringGroups: [],
    trunks: [],
  },
];

function generate(now = Date.now()): DemoPhoneState {
  const systems = new Map<string, DemoPhoneSystem>();
  for (const seed of SYSTEMS) {
    // One id sequence per system for users, ring groups and trunks, like 3CX's DN ids.
    let nextId = 1;
    const users = new Map<string, DemoPhoneUser>();
    for (const u of seed.users) {
      const id = String(nextId++);
      users.set(id, {
        id,
        number: u.number,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        mobile: u.mobile ?? null,
        outboundCallerId: u.outboundCallerId ?? null,
        language: u.language ?? null,
        enabled: true,
        registered: u.registered ?? true,
        role: u.role ?? 'users',
        tags: [...(u.tags ?? [])],
        welcomeMails: 0,
      });
    }
    const ringGroups = new Map<string, DemoRingGroup>();
    for (const g of seed.ringGroups) {
      const id = String(nextId++);
      ringGroups.set(id, { ...g, id, members: [...g.members] });
    }
    const trunks = seed.trunks.map((t) => ({ ...t, id: String(nextId++) }));
    const expires = new Date(now + seed.licenseDays * DAY).toISOString();
    systems.set(seed.externalId, {
      externalId: seed.externalId,
      name: seed.name,
      version: seed.version,
      edition: seed.edition,
      productCode: seed.productCode,
      licenseExpiresAt: expires,
      maintenanceExpiresAt: expires,
      maxSimCalls: seed.maxSimCalls,
      maxUsers: seed.maxUsers,
      numberLength: seed.numberLength,
      servicesDown: false,
      users,
      ringGroups,
      trunks,
      nextId,
      unreachable: false,
    });
  }
  return { systems };
}

/** The state of one demo connection. */
export function demoPhoneState(connectionId: string): DemoPhoneState {
  let state = STATE.get(connectionId);
  if (!state) {
    state = generate();
    STATE.set(connectionId, state);
  }
  return state;
}

/** Test helper: forget all simulated telephony state. */
export function resetDemoPhone(): void {
  STATE.clear();
}

/** Ids from requests in error messages: never more than 64 characters. */
const clip = (value: string) => String(value).slice(0, 64);

/** Like the 3CX adapter: shorter numbers first, then alphabetically. */
function byNumber<T extends { number: string }>(a: T, b: T): number {
  return a.number.length - b.number.length || a.number.localeCompare(b.number);
}

function displayName(user: Pick<DemoPhoneUser, 'firstName' | 'lastName'>): string | null {
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || null;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** FNV-1a, to seed the generator per system and minute. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Calls in progress: the same value for a minute, from 0 to half the licensed calls. */
function activeCalls(system: DemoPhoneSystem, now = Date.now()): number {
  const rand = rng(hash(`${system.externalId}:${Math.floor(now / 60_000)}`));
  return Math.floor(rand() * (Math.floor(system.maxSimCalls / 2) + 1));
}

/** Every number of the system's one namespace: users, ring groups and trunks. */
function usedNumbers(system: DemoPhoneSystem): Set<string> {
  return new Set([
    ...[...system.users.values()].map((u) => u.number),
    ...[...system.ringGroups.values()].map((g) => g.number),
    ...system.trunks.map((t) => t.number),
  ]);
}

/** The lowest free number of the system's length, null when none is left. */
function firstFreeNumber(system: DemoPhoneSystem): string | null {
  const taken = usedNumbers(system);
  const last = 10 ** system.numberLength - 1;
  for (let n = 10 ** (system.numberLength - 1); n <= last; n++) {
    if (!taken.has(String(n))) return String(n);
  }
  return null;
}

// Checks the PBX makes itself. The API checks and normalizes every value before, so these only
// catch what slips through.

function checkName(value: unknown, label: string, required: true): string;
function checkName(value: unknown, label: string, required: false): string | null;
function checkName(value: unknown, label: string, required: boolean): string | null {
  if (value !== null && value !== undefined && typeof value !== 'string') {
    throw badRequest(`Invalid ${label}`);
  }
  const text = (value ?? '').trim();
  if (!text) {
    if (required) throw badRequest(`The ${label} is required`);
    return null;
  }
  if (text.length > PHONE_NAME_MAX_LENGTH) {
    throw badRequest(`The ${label} may have at most ${PHONE_NAME_MAX_LENGTH} characters`);
  }
  return text;
}

function checkEmail(value: unknown): string {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!text || text.length > PHONE_EMAIL_MAX_LENGTH || !EMAIL.test(text)) {
    throw badRequest('Invalid e-mail address');
  }
  return text;
}

function checkExternalNumber(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !isValidExternalNumber(value)) throw badRequest(`Invalid ${label}`);
  return value;
}

function checkLanguage(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (!(PHONE_LANGUAGES as readonly unknown[]).includes(value)) throw badRequest('Unknown language');
  return value as string;
}

/**
 * Synchronous simulation of the telephony methods of ProviderAdapter (same names and
 * arguments); DemoAdapter wraps each one in an async method. Every read returns copies.
 */
export class DemoPhone {
  constructor(private readonly state: DemoPhoneState) {}

  /** A reachable phone system: 404 for unknown ids, 502 while it is marked unreachable. */
  private system(systemId: string): DemoPhoneSystem {
    const system = this.state.systems.get(systemId);
    if (!system) throw new ProviderError(PROVIDER, `unknown phone system "${clip(systemId)}"`, 404);
    if (system.unreachable) {
      throw new ProviderError(PROVIDER, `the phone system ${system.name} does not answer`);
    }
    return system;
  }

  private user(system: DemoPhoneSystem, userId: string): DemoPhoneUser {
    const user = system.users.get(userId);
    if (!user) throw new ProviderError(PROVIDER, `phone user ${clip(userId)} not found`, 404);
    return user;
  }

  private ringGroup(system: DemoPhoneSystem, groupId: string): DemoRingGroup {
    const group = system.ringGroups.get(groupId);
    if (!group) throw new ProviderError(PROVIDER, `ring group ${clip(groupId)} not found`, 404);
    return group;
  }

  private info(system: DemoPhoneSystem): PhoneSystemInfo {
    const users = [...system.users.values()];
    return {
      fqdn: system.name,
      version: system.version,
      edition: system.edition,
      productCode: system.productCode,
      activated: true,
      licenseActive: true,
      licenseExpiresAt: system.licenseExpiresAt,
      maintenanceExpiresAt: system.maintenanceExpiresAt,
      maxSimCalls: system.maxSimCalls,
      activeCalls: activeCalls(system),
      users: users.length,
      maxUsers: system.maxUsers,
      extensionsTotal: users.length + system.ringGroups.size,
      extensionsRegistered: users.filter((u) => u.registered).length,
      trunksTotal: system.trunks.length,
      trunksRegistered: system.trunks.filter((t) => t.online).length,
      servicesDown: system.servicesDown,
      numberLength: system.numberLength,
      webClientUrl: `https://${system.name}/webclient/`,
    };
  }

  private remote(system: DemoPhoneSystem): RemotePhoneSystem {
    return {
      externalId: system.externalId,
      name: system.name,
      info: this.info(system),
      reachable: !system.unreachable,
    };
  }

  private userView(user: DemoPhoneUser): PhoneUser {
    return {
      id: user.id,
      number: user.number,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: displayName(user),
      email: user.email,
      mobile: user.mobile,
      outboundCallerId: user.outboundCallerId,
      language: user.language,
      enabled: user.enabled,
      registered: user.registered,
      role: user.role,
      admin: ADMIN_ROLES.includes(user.role),
      system: user.tags.some((t) => SYSTEM_TAGS.includes(t)),
    };
  }

  private groupView(system: DemoPhoneSystem, group: DemoRingGroup): PhoneRingGroup {
    const names = new Map([...system.users.values()].map((u) => [u.number, displayName(u)]));
    return {
      id: group.id,
      number: group.number,
      name: group.name,
      strategy: group.strategy,
      ringTimeSeconds: group.ringTimeSeconds,
      members: group.members.map((number) => ({ number, name: names.get(number) ?? null })),
    };
  }

  /** Every simulated phone system, unreachable ones with `reachable: false`. Never throws. */
  listPhoneSystems(): RemotePhoneSystem[] {
    return [...this.state.systems.values()].map((s) => this.remote(s));
  }

  getPhoneSystem(systemId: string): RemotePhoneSystem {
    return this.remote(this.system(systemId));
  }

  listPhoneUsers(systemId: string): PhoneUser[] {
    return [...this.system(systemId).users.values()].sort(byNumber).map((u) => this.userView(u));
  }

  getPhoneUser(systemId: string, userId: string): PhoneUser {
    return this.userView(this.user(this.system(systemId), userId));
  }

  nextPhoneNumber(systemId: string): string | null {
    return firstFreeNumber(this.system(systemId));
  }

  /** Without a number the system picks the next free one. Sends no welcome e-mail. */
  createPhoneUser(systemId: string, input: PhoneUserInput): PhoneUser {
    const system = this.system(systemId);
    const firstName = checkName(input.firstName, 'first name', true);
    const lastName = checkName(input.lastName, 'last name', false);
    const email = checkEmail(input.email);
    const mobile = checkExternalNumber(input.mobile, 'mobile number');
    const outboundCallerId = checkExternalNumber(input.outboundCallerId, 'outbound caller ID');
    const language = checkLanguage(input.language);
    let number = input.number || null;
    if (number !== null) {
      if (!isValidExtension(number, system.numberLength)) {
        throw badRequest(`The extension number must have ${system.numberLength} digits`);
      }
      // One namespace for users, ring groups and trunks, like 3CX's DNs.
      if (usedNumbers(system).has(number)) {
        throw conflict(`The extension number ${number} is in use at the phone system`);
      }
    }
    if (system.maxUsers !== null && system.users.size >= system.maxUsers) {
      throw phoneUserLimit('The license of this phone system allows no more users');
    }
    number ??= firstFreeNumber(system);
    // 3CX: WARNINGS.NO_MORE_NUMBERS_AVAILABLE, mapped like the user limit.
    if (number === null) throw phoneUserLimit('The phone system has no free extension number left');

    const id = String(system.nextId++);
    const user: DemoPhoneUser = {
      id,
      number,
      firstName,
      lastName,
      email,
      mobile,
      outboundCallerId,
      language,
      enabled: true,
      registered: false,
      role: 'users',
      tags: [],
      welcomeMails: 0,
    };
    system.users.set(id, user);
    return this.userView(user);
  }

  /** Only the keys present change; null clears an optional field. The number cannot change. */
  updatePhoneUser(systemId: string, userId: string, patch: PhoneUserPatch): PhoneUser {
    const user = this.user(this.system(systemId), userId);
    // Check everything before changing anything.
    const next: Partial<DemoPhoneUser> = {};
    if (patch.firstName !== undefined) next.firstName = checkName(patch.firstName, 'first name', true);
    if (patch.lastName !== undefined) next.lastName = checkName(patch.lastName, 'last name', false);
    if (patch.email !== undefined) next.email = checkEmail(patch.email);
    if (patch.mobile !== undefined) next.mobile = checkExternalNumber(patch.mobile, 'mobile number');
    if (patch.outboundCallerId !== undefined) {
      next.outboundCallerId = checkExternalNumber(patch.outboundCallerId, 'outbound caller ID');
    }
    if (patch.language !== undefined) next.language = checkLanguage(patch.language);
    Object.assign(user, next);
    return this.userView(user);
  }

  /** Removes the extension, also from its ring groups. The fax server cannot be deleted. */
  deletePhoneUser(systemId: string, userId: string): void {
    const system = this.system(systemId);
    const user = this.user(system, userId);
    if (user.tags.includes(FAX_TAG)) throw conflict('The fax server cannot be deleted');
    system.users.delete(user.id);
    for (const group of system.ringGroups.values()) {
      group.members = group.members.filter((m) => m !== user.number);
    }
  }

  sendPhoneWelcome(systemId: string, userId: string): void {
    const user = this.user(this.system(systemId), userId);
    if (!user.email) throw badRequest('This user has no e-mail address');
    user.welcomeMails++;
  }

  listPhoneRingGroups(systemId: string): PhoneRingGroup[] {
    const system = this.system(systemId);
    return [...system.ringGroups.values()].sort(byNumber).map((g) => this.groupView(system, g));
  }

  /** Appends a user's extension; a member already is no change. */
  addPhoneRingGroupMember(systemId: string, groupId: string, number: string): PhoneRingGroup {
    const system = this.system(systemId);
    const group = this.ringGroup(system, groupId);
    if (!/^[0-9]{1,20}$/.test(number)) throw badRequest('The extension number must consist of digits');
    if (!group.members.includes(number)) {
      if (![...system.users.values()].some((u) => u.number === number)) {
        throw badRequest(`Extension ${number} is not a user of this phone system`);
      }
      group.members.push(number);
    }
    return this.groupView(system, group);
  }

  /** Keeps the order of the others. Not a member: 404. */
  removePhoneRingGroupMember(systemId: string, groupId: string, number: string): PhoneRingGroup {
    const system = this.system(systemId);
    const group = this.ringGroup(system, groupId);
    if (!group.members.includes(number)) throw notFound('Ring group member');
    group.members = group.members.filter((m) => m !== number);
    return this.groupView(system, group);
  }

  listPhoneTrunks(systemId: string): PhoneTrunk[] {
    return [...this.system(systemId).trunks].sort(byNumber).map((t) => ({ ...t }));
  }
}
