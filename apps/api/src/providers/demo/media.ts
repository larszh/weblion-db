import { randomUUID } from 'node:crypto';
import {
  MEDIA_ACTIVE_WITHIN_SECONDS,
  expectedMediaPolicy,
  normalizeMediaId,
  type MediaAccess,
  type MediaLibraryRef,
  type MediaPolicyState,
} from '@weblion/shared';
import { ProviderError, badRequest, conflict } from '../../lib/errors';
import {
  JELLYFIN,
  assertJellyfinPassword,
  assertJellyfinUsername,
  jellyfinAdminRefused,
  sameJellyfinUsername,
} from '../jellyfin/rules';
import type { MediaActivity, MediaServerInfo, MediaUserInput, RemoteMediaUser } from '../types';

/**
 * Simulated Jellyfin media server for the demo provider: one instance per connection with
 * libraries and users, kept in memory like the other demo data, so changes survive adapter
 * re-creation and two demo connections are two independent instances. Refuses what the
 * Jellyfin adapter refuses (user names, duplicates in any case, empty passwords, ids, the
 * administrators the console never manages, Jellyfin's own guards for the last administrator
 * and the last enabled user) with the same errors, so the dev stack and the route tests see the
 * behaviour of a real server. Passwords are kept only to mimic Jellyfin and never returned.
 */

export const DEMO_MEDIA_URL = 'https://media.demo.weblion.one';
export const DEMO_MEDIA_SERVER = {
  name: 'Demo Jellyfin',
  version: '10.11.11',
  id: '8dd0047ed7d2f177ef00ca66157d6768',
};

/** Libraries of every demo instance. */
export const DEMO_MEDIA_LIBRARIES: MediaLibraryRef[] = [
  { id: '847f61bc736e6f8ef0f5542f43496822', name: 'Filme', type: 'movies' },
  { id: 'd91225786a8ac15d78c0c1ea46a12d75', name: 'Serien', type: 'tvshows' },
  { id: '9f0ef2e22ac1ffae415e6ddd9696b76d', name: 'Kinder', type: 'movies' },
  { id: 'a13e46539faa3b698f68cd49c93e4e18', name: 'Musik', type: 'music' },
  { id: '12c2fdf0c2d0829458a6d7772ac65b83', name: 'Dokumentationen', type: 'movies' },
];

/** Ids of the seeded users, by name. */
export const DEMO_MEDIA_IDS = {
  'weblion-admin': '84bb1f65fce351e5962eb84c1645fa51',
  'anna-kemaro': '3bc712a422452aa61a2816cf217e3788',
  'wohnzimmer-kemaro': '83b3b30ddff2dd3634a43687053b9fe9',
  'ben-kemaro': '97a3a6596b22bcba752af2adb4acce60',
  'huber-bivane': 'c48516d2ef678b278e6692684d593d4f',
  gast: '40fa2c6d9b58e2b94320a04ea1ce7f3d',
  altkunde: 'e105e849dc773e5b1a8814f45bc8d0b6',
} as const;

const library = (name: string): string => DEMO_MEDIA_LIBRARIES.find((l) => l.name === name)!.id;

/**
 * Access of the allowances db/seed-media.ts gives, by organization slug. The seeded accounts
 * start with the policy of their organization's allowance (huber-bivane with one drifted field).
 */
export const DEMO_MEDIA_ACCESS = {
  'alpen-hosting': {
    libraryIds: [library('Filme'), library('Serien'), library('Kinder'), library('Musik')],
    maxStreams: 3,
    downloads: true,
    remoteBitrateMbit: 20,
  },
  'muster-ag': {
    libraryIds: [library('Filme'), library('Serien'), library('Kinder')],
    maxStreams: 2,
    downloads: false,
    remoteBitrateMbit: 8,
  },
  'baeckerei-huber': {
    libraryIds: [library('Filme'), library('Kinder')],
    maxStreams: 2,
    downloads: false,
    // Within Alpen Hosting's 20 Mbit/s: without a limit of its own the customer would exceed its
    // reseller's allowance (mediaAccessExceeds), and every change to Alpen's would be refused.
    remoteBitrateMbit: 15,
  },
} satisfies Record<string, MediaAccess>;

export interface DemoMediaUserSeed {
  name: keyof typeof DEMO_MEDIA_IDS;
  administrator?: boolean;
  hasPassword: boolean;
  enabled: boolean;
  lockedOut?: boolean;
  blockedFolders?: boolean;
  /** How long ago the user was last active; null = never. */
  lastActivityAgoMs: number | null;
  /** Policy at the start: an allowance's expected policy, or Jellyfin's default for new users. */
  policy: MediaPolicyState;
}

export interface DemoMediaUser extends RemoteMediaUser {
  password: string | null;
  invalidLogins: number;
  signOuts: number;
}

export interface DemoMediaState {
  users: Map<string, DemoMediaUser>;
  libraries: MediaLibraryRef[];
  quickConnect: boolean;
}

const STATE = new Map<string, DemoMediaState>();
/** Sign-outs of deleted users, so tests can still read them (signOuts()). */
const DELETED = new WeakMap<DemoMediaState, Map<string, number>>();

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Failed sign-ins after which the locked-out demo user was disabled (LoginAttemptsBeforeLockout). */
const LOCKOUT_ATTEMPTS = 3;

/** Jellyfin's policy for a user created by POST /Users/New. */
export function jellyfinDefaultPolicy(): MediaPolicyState {
  return {
    administrator: false,
    hidden: true,
    remoteAccess: true,
    allLibraries: true,
    libraryIds: [],
    maxSessions: 0,
    downloads: true,
    conversion: true,
    remoteBitrateBps: 0,
    contentDeletion: false,
    remoteControlOthers: false,
    sharedDeviceControl: true,
    liveTv: true,
    metadataManagement: false,
    publicSharing: true,
    channels: true,
    syncPlay: 'CreateAndJoinGroups',
  };
}

/**
 * The users of a demo instance at the start. Two accounts of Muster AG (one locked after failed
 * sign-ins) and one of Bäckerei Huber with a drifted policy for the sync to repair are seeded by
 * db/seed-media.ts; the others stay unmanaged for the admin import: ben-kemaro (importable),
 * gast (no password: only with a new one), altkunde (legacy blocked libraries) and the
 * instance's administrator (never).
 */
export const DEMO_MEDIA_USERS: DemoMediaUserSeed[] = [
  {
    name: 'weblion-admin',
    administrator: true,
    hasPassword: true,
    enabled: true,
    lastActivityAgoMs: 1 * HOUR,
    policy: { ...jellyfinDefaultPolicy(), administrator: true },
  },
  {
    name: 'anna-kemaro',
    hasPassword: true,
    enabled: true,
    lastActivityAgoMs: 2 * HOUR,
    policy: expectedMediaPolicy(DEMO_MEDIA_ACCESS['muster-ag']),
  },
  {
    name: 'wohnzimmer-kemaro',
    hasPassword: true,
    enabled: false,
    lockedOut: true,
    lastActivityAgoMs: 6 * DAY,
    policy: expectedMediaPolicy(DEMO_MEDIA_ACCESS['muster-ag']),
  },
  {
    name: 'ben-kemaro',
    hasPassword: true,
    enabled: true,
    lastActivityAgoMs: 3 * DAY,
    policy: jellyfinDefaultPolicy(),
  },
  {
    name: 'huber-bivane',
    hasPassword: true,
    enabled: true,
    lastActivityAgoMs: 1 * DAY,
    policy: { ...expectedMediaPolicy(DEMO_MEDIA_ACCESS['baeckerei-huber']), maxSessions: 4 },
  },
  {
    name: 'gast',
    hasPassword: false,
    enabled: true,
    lastActivityAgoMs: null,
    policy: jellyfinDefaultPolicy(),
  },
  {
    name: 'altkunde',
    hasPassword: true,
    enabled: true,
    blockedFolders: true,
    lastActivityAgoMs: 40 * DAY,
    policy: jellyfinDefaultPolicy(),
  },
];

/** EnabledFolders as Jellyfin answers them and the adapter reads them: valid ids, lower case, unique, sorted. */
function libraryIdsOf(ids: readonly string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    const normalized = normalizeMediaId(String(id));
    if (normalized) out.add(normalized);
  }
  return [...out].sort();
}

function copyPolicy(policy: MediaPolicyState): MediaPolicyState {
  return { ...policy, libraryIds: libraryIdsOf(policy.libraryIds) };
}

function generate(now = Date.now()): DemoMediaState {
  const users = new Map<string, DemoMediaUser>();
  for (const seed of DEMO_MEDIA_USERS) {
    const externalId = DEMO_MEDIA_IDS[seed.name];
    const at = seed.lastActivityAgoMs === null ? null : new Date(now - seed.lastActivityAgoMs).toISOString();
    const policy = copyPolicy(seed.policy);
    users.set(externalId, {
      externalId,
      username: seed.name,
      enabled: seed.enabled,
      administrator: seed.administrator ?? policy.administrator,
      hasPassword: seed.hasPassword,
      lockedOut: seed.lockedOut ?? false,
      blockedFolders: seed.blockedFolders ?? false,
      // Jellyfin sets both on sign-in.
      lastLoginAt: at,
      lastActivityAt: at,
      policy,
      // The demo does not know the passwords of the users it starts with.
      password: null,
      invalidLogins: seed.lockedOut ? LOCKOUT_ATTEMPTS : 0,
      signOuts: 0,
    });
  }
  return {
    users,
    libraries: DEMO_MEDIA_LIBRARIES.map((l) => ({ ...l })),
    quickConnect: true,
  };
}

/** The state of one demo connection, created with the dataset on first use. */
export function demoMediaState(connectionId: string): DemoMediaState {
  let state = STATE.get(connectionId);
  if (!state) {
    state = generate();
    STATE.set(connectionId, state);
  }
  return state;
}

/** Test helper: forget all simulated streaming state. */
export function resetDemoMedia(): void {
  STATE.clear();
}

/** IsAdministrator is one field in Jellyfin; tests may set either copy of it. */
const isAdministrator = (user: DemoMediaUser): boolean => user.administrator || user.policy.administrator;

/** Same answer as the adapter for ids it cannot use. */
function userIdOf(value: string): string {
  const id = normalizeMediaId(String(value ?? ''));
  if (!id) throw badRequest('Invalid Jellyfin user id');
  return id;
}

/** Jellyfin's 403 answers of POST /Users/{id}/Policy, as the adapter reports them. */
function refusedByJellyfin(action: string, message: string): ProviderError {
  return new ProviderError(JELLYFIN, `${action} failed: ${message} (HTTP 403)`, 403);
}

/**
 * Synchronous simulation of the streaming methods of ProviderAdapter (same names and
 * arguments); DemoAdapter wraps each one in an async method.
 */
export class DemoMedia {
  constructor(private readonly state: DemoMediaState) {}

  private user(userId: string): DemoMediaUser {
    const id = userIdOf(userId);
    const user = this.state.users.get(id);
    if (!user) throw new ProviderError(JELLYFIN, `user ${id} not found`, 404);
    return user;
  }

  private view(user: DemoMediaUser): RemoteMediaUser {
    const administrator = isAdministrator(user);
    return {
      externalId: user.externalId,
      username: user.username,
      enabled: user.enabled,
      administrator,
      hasPassword: user.hasPassword,
      lockedOut: user.lockedOut,
      blockedFolders: user.blockedFolders,
      lastLoginAt: user.lastLoginAt,
      lastActivityAt: user.lastActivityAt,
      policy: { ...copyPolicy(user.policy), administrator },
    };
  }

  private signOut(user: DemoMediaUser): void {
    user.signOuts++;
  }

  /** Sorted by name, copies without password. Never throws (the demo overview counts it). */
  listMediaUsers(): RemoteMediaUser[] {
    return [...this.state.users.values()]
      .sort((a, b) => a.username.localeCompare(b.username))
      .map((u) => this.view(u));
  }

  getMediaUser(userId: string): RemoteMediaUser {
    return this.view(this.user(userId));
  }

  /** POST /Users/New with the password, then the policy, like the adapter. */
  createMediaUser(input: MediaUserInput): RemoteMediaUser {
    const username = assertJellyfinUsername(input.username);
    const password = assertJellyfinPassword(input.password);
    // Jellyfin compares names case-insensitively.
    if ([...this.state.users.values()].some((u) => sameJellyfinUsername(u.username, username))) {
      throw conflict(`The Jellyfin user "${username}" already exists`);
    }
    let externalId = randomUUID().replace(/-/g, '');
    while (this.state.users.has(externalId)) externalId = randomUUID().replace(/-/g, '');
    const policy = copyPolicy(input.policy);
    const user: DemoMediaUser = {
      externalId,
      username,
      enabled: true,
      administrator: policy.administrator,
      hasPassword: true,
      lockedOut: false,
      blockedFolders: false,
      lastLoginAt: null,
      lastActivityAt: null,
      policy,
      password,
      invalidLogins: 0,
      signOuts: 0,
    };
    this.state.users.set(externalId, user);
    return this.view(user);
  }

  /** Only the managed fields change; enabled, lockout and blocked libraries stay as they are. */
  setMediaUserPolicy(userId: string, policy: MediaPolicyState): RemoteMediaUser {
    const user = this.user(userId);
    const action = `set the access of ${user.username}`;
    if (isAdministrator(user) && !policy.administrator) {
      const administrators = [...this.state.users.values()].filter(isAdministrator).length;
      if (administrators === 1) {
        throw refusedByJellyfin(
          action,
          'There must be at least one user in the system with administrative access.',
        );
      }
    }
    // The policy written keeps IsDisabled, and Jellyfin checks it against the current administrator
    // flag: a disabled administrator cannot even be demoted.
    if (isAdministrator(user) && !user.enabled) {
      throw refusedByJellyfin(action, 'Administrators cannot be disabled.');
    }
    user.policy = copyPolicy(policy);
    user.administrator = user.policy.administrator;
    return this.view(user);
  }

  /** Disabling signs out every device; enabling also lifts a lock after failed sign-ins. */
  setMediaUserEnabled(userId: string, enabled: boolean): RemoteMediaUser {
    const user = this.user(userId);
    if (isAdministrator(user)) throw jellyfinAdminRefused();
    if (!enabled && user.enabled) {
      const enabledUsers = [...this.state.users.values()].filter((u) => u.enabled).length;
      if (enabledUsers === 1) {
        throw refusedByJellyfin(
          `disable ${user.username}`,
          'There must be at least one enabled user in the system.',
        );
      }
      // Jellyfin revokes the device tokens of a user it disables.
      this.signOut(user);
    }
    user.enabled = enabled;
    if (enabled) {
      user.lockedOut = false;
      user.invalidLogins = 0;
    }
    return this.view(user);
  }

  /** As an administrator, without the current password. Every device of the user is signed out. */
  setMediaUserPassword(userId: string, password: string): void {
    userIdOf(userId);
    assertJellyfinPassword(password);
    const user = this.user(userId);
    if (isAdministrator(user)) throw jellyfinAdminRefused();
    user.password = password;
    user.hasPassword = true;
    this.signOut(user);
  }

  /** Removes the user with its devices (signed out), playlists and watch history. */
  deleteMediaUser(userId: string): void {
    const user = this.user(userId);
    if (isAdministrator(user)) throw jellyfinAdminRefused();
    this.signOut(user);
    this.state.users.delete(user.externalId);
    let deleted = DELETED.get(this.state);
    if (!deleted) {
      deleted = new Map();
      DELETED.set(this.state, deleted);
    }
    deleted.set(user.externalId, user.signOuts);
  }

  /** Sorted by name like the adapter; copies. */
  listMediaLibraries(): MediaLibraryRef[] {
    return this.state.libraries
      .map(({ id, name, type }) => ({ id, name, type }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }

  mediaServerInfo(): MediaServerInfo {
    return {
      serverName: DEMO_MEDIA_SERVER.name,
      version: DEMO_MEDIA_SERVER.version,
      serverId: DEMO_MEDIA_SERVER.id,
      quickConnect: this.state.quickConnect,
      startupWizardCompleted: true,
    };
  }

  /**
   * Counts only. Enabled users active within MEDIA_ACTIVE_WITHIN_SECONDS have a session; the
   * first of them (by name) plays something, so the numbers stay deterministic.
   */
  mediaActivity(): MediaActivity {
    const since = Date.now() - MEDIA_ACTIVE_WITHIN_SECONDS * 1000;
    const activeSessions = [...this.state.users.values()].filter((u) => {
      const at = u.lastActivityAt ? Date.parse(u.lastActivityAt) : NaN;
      return u.enabled && Number.isFinite(at) && at >= since;
    }).length;
    return { activeSessions, playing: activeSessions > 0 ? 1 : 0 };
  }

  mediaLoginUrl(): string {
    return DEMO_MEDIA_URL;
  }

  /** Test helper: how often the user's devices were signed out (also after the user was deleted). */
  signOuts(userId: string): number {
    const id = userIdOf(userId);
    const user = this.state.users.get(id);
    if (user) return user.signOuts;
    const deleted = DELETED.get(this.state)?.get(id);
    if (deleted !== undefined) return deleted;
    throw new ProviderError(JELLYFIN, `user ${id} not found`, 404);
  }
}
