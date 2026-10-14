import type { MediaLibraryRef, MediaPolicyState } from '@weblion/shared';
import { unsupported } from '../../lib/errors';
import type { MediaActivity, MediaServerInfo, MediaUserInput, RemoteMediaUser } from '../types';

/**
 * Simulated Jellyfin media server for the demo provider: one instance per connection with
 * libraries and users, kept in memory like the other demo data. Placeholder until the simulation
 * is implemented: the names and constants below are the contract the demo adapter and the tests
 * use. No users yet, so the sync of the demo connection keeps working.
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

/** The simulated users at the start. Empty until the simulation is implemented. */
export const DEMO_MEDIA_USERS: DemoMediaUserSeed[] = [];

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

const notImplemented = () => unsupported('demo streaming not implemented yet');

/** The state of one demo connection. */
export function demoMediaState(_connectionId: string): DemoMediaState {
  return { users: new Map(), libraries: [], quickConnect: true };
}

/** Test helper: forget all simulated streaming state. */
export function resetDemoMedia(): void {}

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
 * Synchronous simulation of the streaming methods of ProviderAdapter (same names and
 * arguments); DemoAdapter wraps each one in an async method.
 */
export class DemoMedia {
  constructor(private readonly state: DemoMediaState) {}

  /** Sorted by name, copies without password. */
  listMediaUsers(): RemoteMediaUser[] {
    return [];
  }

  getMediaUser(_userId: string): RemoteMediaUser {
    throw notImplemented();
  }

  createMediaUser(_input: MediaUserInput): RemoteMediaUser {
    throw notImplemented();
  }

  setMediaUserPolicy(_userId: string, _policy: MediaPolicyState): RemoteMediaUser {
    throw notImplemented();
  }

  setMediaUserEnabled(_userId: string, _enabled: boolean): RemoteMediaUser {
    throw notImplemented();
  }

  setMediaUserPassword(_userId: string, _password: string): void {
    throw notImplemented();
  }

  deleteMediaUser(_userId: string): void {
    throw notImplemented();
  }

  listMediaLibraries(): MediaLibraryRef[] {
    return [];
  }

  mediaServerInfo(): MediaServerInfo {
    return {
      serverName: null,
      version: null,
      serverId: null,
      quickConnect: null,
      startupWizardCompleted: null,
    };
  }

  mediaActivity(): MediaActivity {
    return { activeSessions: 0, playing: 0 };
  }

  mediaLoginUrl(): string {
    return DEMO_MEDIA_URL;
  }

  /** Test helper: how often the user's devices were signed out. */
  signOuts(_userId: string): number {
    throw notImplemented();
  }
}
