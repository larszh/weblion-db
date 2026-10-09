import { badRequest, conflict, notFound } from '../../lib/errors';
import {
  DEFAULT_GROUP_PREFIX,
  assertDisplayName,
  assertEmail,
  assertGroupId,
  assertQuota,
  assertUserId,
} from '../nextcloud/parse';
import type { CloudAccountInput, CloudAccountPatch, RemoteCloudAccount } from '../types';

/**
 * Simulated Nextcloud users for the demo provider. Deterministic, kept in memory per
 * connection like the demo servers, so changes survive adapter re-creation. Checks like the
 * Nextcloud adapter (login names, quotas, duplicates) so the dev stack shows the same errors.
 */

interface DemoCloudUser {
  externalId: string;
  displayName: string | null;
  email: string | null;
  quotaBytes: number | null;
  usedBytes: number;
  enabled: boolean;
  lastLoginAt: string | null;
  groups: string[];
  /** Kept only to mimic Nextcloud; never returned. */
  password: string | null;
  /** Welcome mails sent, for tests and the dev stack. */
  invites: number;
}

export interface DemoCloudState {
  users: Map<string, DemoCloudUser>;
  groups: Set<string>;
}

const STATE = new Map<string, DemoCloudState>();

export const DEMO_CLOUD_URL = 'https://cloud.demo.weblion.one';
/** The account the panel signs in with. Like at Nextcloud it cannot delete or disable itself. */
export const DEMO_CLOUD_ADMIN = 'admin';
/** Nextcloud's default password policy: at least 10 characters. */
const MIN_PASSWORD_LENGTH = 10;

const GiB = 1024 ** 3;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface UserSeed {
  id: string;
  displayName: string;
  email: string | null;
  quotaGb: number | null;
  usedBytes: number;
  enabled?: boolean;
  /** How long ago the user last logged in; null = never. */
  lastLoginAgoMs: number | null;
  groups: string[];
}

/** Org slugs of the demo seed (seed.ts, seed-reseller.ts). */
const group = (slug: string) => `${DEFAULT_GROUP_PREFIX}${slug}`;

/** Users already at the instance. The panel manages them once they are imported or seeded. */
export const DEMO_CLOUD_USERS: UserSeed[] = [
  {
    id: DEMO_CLOUD_ADMIN,
    displayName: 'weblion Admin',
    email: 'cloud-admin@weblion.example',
    quotaGb: null,
    usedBytes: Math.round(3.2 * GiB),
    lastLoginAgoMs: 2 * HOUR,
    groups: ['admin'],
  },
  {
    id: 'anna@muster-ag',
    displayName: 'Anna Muster',
    email: 'anna@muster.example',
    quotaGb: 50,
    usedBytes: Math.round(12.4 * GiB),
    lastLoginAgoMs: 3 * HOUR,
    groups: [group('muster-ag')],
  },
  {
    id: 'ben@muster-ag',
    displayName: 'Ben Beispiel',
    email: 'ben@muster.example',
    quotaGb: 20,
    usedBytes: Math.round(3.1 * GiB),
    lastLoginAgoMs: 4 * DAY,
    groups: [group('muster-ag')],
  },
  {
    id: 'buchhaltung@muster-ag',
    displayName: 'Buchhaltung',
    email: null,
    quotaGb: 10,
    usedBytes: Math.round(9.6 * GiB),
    enabled: false,
    lastLoginAgoMs: 45 * DAY,
    groups: [group('muster-ag')],
  },
  {
    id: 'hanna@baeckerei-huber',
    displayName: 'Hanna Huber',
    email: 'huber@baeckerei.example',
    quotaGb: 10,
    usedBytes: Math.round(1.2 * GiB),
    lastLoginAgoMs: 1 * DAY,
    groups: [group('baeckerei-huber')],
  },
  {
    id: 'dev@beispiel-gmbh',
    displayName: 'Dev Beispiel',
    email: 'dev@beispiel.example',
    quotaGb: 5,
    usedBytes: 0,
    lastLoginAgoMs: null,
    groups: [group('beispiel-gmbh')],
  },
];

function generate(now = Date.now()): DemoCloudState {
  const state: DemoCloudState = { users: new Map(), groups: new Set(['admin']) };
  for (const seed of DEMO_CLOUD_USERS) {
    for (const g of seed.groups) state.groups.add(g);
    state.users.set(seed.id, {
      externalId: seed.id,
      displayName: seed.displayName,
      email: seed.email,
      quotaBytes: seed.quotaGb === null ? null : seed.quotaGb * GiB,
      usedBytes: seed.usedBytes,
      enabled: seed.enabled ?? true,
      lastLoginAt: seed.lastLoginAgoMs === null ? null : new Date(now - seed.lastLoginAgoMs).toISOString(),
      groups: [...seed.groups],
      password: null,
      invites: 0,
    });
  }
  return state;
}

export function demoCloudState(connectionId: string): DemoCloudState {
  let state = STATE.get(connectionId);
  if (!state) {
    state = generate();
    STATE.set(connectionId, state);
  }
  return state;
}

export function resetDemoCloud() {
  STATE.clear();
}

function checkPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`Password needs to be at least ${MIN_PASSWORD_LENGTH} characters long`);
  }
}

export class DemoCloud {
  constructor(private readonly state: DemoCloudState) {}

  private user(externalId: string): DemoCloudUser {
    const user = this.state.users.get(assertUserId(externalId));
    // 404 like the Nextcloud adapter's "User does not exist".
    if (!user) throw notFound('Nextcloud user');
    return user;
  }

  private view(user: DemoCloudUser): RemoteCloudAccount {
    return {
      externalId: user.externalId,
      displayName: user.displayName,
      email: user.email,
      quotaBytes: user.quotaBytes,
      usedBytes: user.usedBytes,
      enabled: user.enabled,
      lastLoginAt: user.lastLoginAt,
      groups: [...user.groups],
    };
  }

  listCloudAccounts(): RemoteCloudAccount[] {
    return [...this.state.users.values()]
      .sort((a, b) => a.externalId.localeCompare(b.externalId))
      .map((u) => this.view(u));
  }

  getCloudAccount(externalId: string): RemoteCloudAccount {
    return this.view(this.user(externalId));
  }

  createCloudAccount(input: CloudAccountInput): RemoteCloudAccount {
    const username = assertUserId(input.username);
    const quotaBytes = assertQuota(input.quotaBytes);
    const email = assertEmail(input.email);
    const displayName = assertDisplayName(input.displayName);
    const groups = [...new Set(input.groups)].map(assertGroupId);
    const password = input.password ?? '';
    if (password) checkPassword(password);
    else if (!email)
      throw badRequest('An e-mail address is required when Nextcloud is to send the invitation');
    // Nextcloud compares login names case-insensitively.
    const lower = username.toLowerCase();
    if ([...this.state.users.keys()].some((id) => id.toLowerCase() === lower)) {
      throw conflict(`The Nextcloud user "${username}" already exists`);
    }
    for (const g of groups) this.state.groups.add(g);
    const user: DemoCloudUser = {
      externalId: username,
      displayName: displayName ?? username,
      email: email || null,
      quotaBytes,
      usedBytes: 0,
      enabled: true,
      lastLoginAt: null,
      groups,
      password: password || null,
      // Nextcloud sends the welcome mail to every new user with an address.
      invites: email ? 1 : 0,
    };
    this.state.users.set(username, user);
    return this.view(user);
  }

  updateCloudAccount(externalId: string, patch: CloudAccountPatch): void {
    const user = this.user(externalId);
    // Check everything before changing anything.
    const displayName = patch.displayName !== undefined ? assertDisplayName(patch.displayName) : undefined;
    const email = patch.email !== undefined ? assertEmail(patch.email) : undefined;
    const quotaBytes = patch.quotaBytes !== undefined ? assertQuota(patch.quotaBytes) : undefined;
    if (patch.enabled === false && user.externalId === DEMO_CLOUD_ADMIN) {
      throw badRequest('The account the panel signs in with cannot be disabled');
    }
    if (displayName !== undefined) user.displayName = displayName ?? user.externalId;
    if (email !== undefined) user.email = email || null;
    // A quota below the usage is allowed: Nextcloud then refuses new uploads.
    if (quotaBytes !== undefined) user.quotaBytes = quotaBytes;
    if (patch.enabled !== undefined) user.enabled = patch.enabled;
  }

  setCloudAccountPassword(externalId: string, password: string): void {
    const user = this.user(externalId);
    checkPassword(password);
    user.password = password;
  }

  deleteCloudAccount(externalId: string): void {
    const user = this.user(externalId);
    if (user.externalId === DEMO_CLOUD_ADMIN) {
      throw badRequest('The account the panel signs in with cannot be deleted');
    }
    this.state.users.delete(user.externalId);
  }

  resendCloudInvite(externalId: string): void {
    const user = this.user(externalId);
    if (!user.email) throw badRequest('Email address not available');
    user.invites++;
  }

  /** Test helper: how many welcome mails a user got. */
  invitesSent(externalId: string): number {
    return this.user(externalId).invites;
  }

  groups(): string[] {
    return [...this.state.groups].sort();
  }

  cloudLoginUrl(): string {
    return DEMO_CLOUD_URL;
  }
}
