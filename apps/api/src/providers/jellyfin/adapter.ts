import {
  MEDIA_ACTIVE_WITHIN_SECONDS,
  type Capability,
  type MediaLibraryRef,
  type MediaPolicyState,
  type PowerAction,
} from '@weblion/shared';
import { ProviderError, badRequest, conflict } from '../../lib/errors';
import type {
  InfraOverview,
  JellyfinConfig,
  MediaActivity,
  MediaServerInfo,
  MediaUserInput,
  ProviderAdapter,
  RawResponse,
  RemoteMediaUser,
  RemoteServer,
  ServerRef,
} from '../types';
import {
  JellyfinClient,
  PROVIDER,
  type JellyfinClientOptions,
  type JellyfinRequestOptions,
  type Query,
} from './client';
import {
  applyPolicyState,
  isObject,
  jellyfinId,
  parseActivity,
  parseJellyfinUser,
  parseLibraries,
  parseServerInfo,
  redactJellyfin,
  versionAtLeast,
} from './parse';
import {
  assertJellyfinPassword,
  assertJellyfinUsername,
  jellyfinAdminRefused,
  sameJellyfinUsername,
} from './rules';

/** Oldest Jellyfin the console manages (same user, policy and password endpoints as 10.11). */
export const JELLYFIN_MIN_VERSION = '10.10.0';

const LIBRARIES_TTL_MS = 5 * 60_000;
const SERVER_INFO_TTL_MS = 10 * 60_000;
const ACTIVITY_TTL_MS = 30_000;

/** Body keys whose values never show up in an explorer answer (the admin route blanks them in the audit). */
const EXPLORER_SECRET_KEY = /pass|secret|token|api_?key|pw$|pin$/i;

/**
 * Paths the explorer refuses, compared in lower case without the base URL: they hand out or
 * create credentials (every API key is a full administrator, sign-ins answer device tokens).
 */
const EXPLORER_BLOCKED = [
  /^\/auth\/keys(\/|$)/,
  /^\/startup(\/|$)/,
  /^\/users\/authenticatebyname(\/|$)/,
  /^\/users\/authenticatewithquickconnect(\/|$)/,
  /^\/users\/[^/]+\/authenticate(\/|$)/,
  /^\/quickconnect\/authorize(\/|$)/,
  /^\/users\/forgotpassword(\/|$)/,
];

/** One cached read shared by concurrent callers. A failed read is not kept. */
class Cached<T> {
  private entry: { at: number; value: Promise<T> } | null = null;

  constructor(
    private readonly ttlMs: number,
    private readonly load: () => Promise<T>,
  ) {}

  get(fresh = false): Promise<T> {
    const now = Date.now();
    if (!fresh && this.entry && now - this.entry.at < this.ttlMs) return this.entry.value;
    const entry = { at: now, value: this.load() };
    this.entry = entry;
    entry.value.catch(() => {
      if (this.entry === entry) this.entry = null;
    });
    return entry.value;
  }
}

function isNotFound(err: unknown): boolean {
  return err instanceof ProviderError && err.upstreamStatus === 404;
}

/** A user id as Jellyfin writes it (32 hex). Dashed ids are fine, anything else never reaches the server. */
function userIdOf(value: string): string {
  const id = jellyfinId(String(value ?? ''));
  if (!id) throw badRequest('Invalid Jellyfin user id');
  return id;
}

/** The message of a ProviderError without the "Jellyfin: " prefix. */
function reasonOf(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.startsWith(`${PROVIDER}: `) ? message.slice(PROVIDER.length + 2) : message;
}

/** Explorer values as query parameters: lists comma separated (Jellyfin's convention), objects as JSON. */
function queryValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value) && value.every((v) => typeof v !== 'object' || v === null)) return value.join(',');
  if (typeof value === 'object') return JSON.stringify(value);
  return value as string | number | boolean;
}

/** String values of secret-looking keys at any depth (provider ids are no secrets). */
function explorerSecrets(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) explorerSecrets(v, out);
  } else if (isObject(value)) {
    for (const [key, v] of Object.entries(value)) {
      if (EXPLORER_SECRET_KEY.test(key) && !/providerid$/i.test(key) && typeof v === 'string') out.push(v);
      else explorerSecrets(v, out);
    }
  }
  return out;
}

/**
 * A Jellyfin media server (streaming): its users, managed with an API key from the dashboard
 * (every key is a full administrator). No servers. Users are addressed by their Jellyfin id
 * (32 hex), which stays when a user is renamed. The console owns 17 policy fields
 * (MediaPolicyState) and writes them read, modify, write, keeping every other field.
 */
export class JellyfinAdapter implements ProviderAdapter {
  readonly type = 'jellyfin' as const;
  readonly client: JellyfinClient;
  /** Tail of the writes per user: a read and its write never interleave with another write. */
  private readonly locks = new Map<string, Promise<void>>();
  private readonly libraries = new Cached(LIBRARIES_TTL_MS, () => this.readLibraries());
  private readonly serverInfo = new Cached(SERVER_INFO_TTL_MS, () => this.readServerInfo());
  private readonly activity = new Cached(ACTIVITY_TTL_MS, () => this.readActivity());

  constructor(config: JellyfinConfig, options: JellyfinClientOptions = {}) {
    this.client = new JellyfinClient(config, options);
  }

  capabilities(): Capability[] {
    return [];
  }

  powerActions(): PowerAction[] {
    return [];
  }

  async listServers(): Promise<RemoteServer[]> {
    return [];
  }

  async getServer(ref: ServerRef): Promise<RemoteServer> {
    throw new ProviderError(PROVIDER, `Jellyfin has no servers (${ref.externalId})`, 404);
  }

  /** Reachable, key accepted, Jellyfin 10.10 or newer, first-start wizard done. */
  async testConnection(): Promise<Record<string, unknown>> {
    const info = await this.mediaServerInfo(true);
    if (!info.version) {
      throw new ProviderError(PROVIDER, 'the server reported no version: is this a Jellyfin server?');
    }
    if (!versionAtLeast(info.version, JELLYFIN_MIN_VERSION)) {
      throw new ProviderError(
        PROVIDER,
        `Jellyfin ${info.version} is too old: the console needs 10.10 or newer`,
      );
    }
    if (info.startupWizardCompleted === false) {
      throw new ProviderError(PROVIDER, 'finish the first-start wizard of Jellyfin first');
    }
    const [users, libraries] = await Promise.all([this.listMediaUsers(), this.listMediaLibraries(true)]);
    return {
      version: info.version,
      serverName: info.serverName,
      users: users.length,
      administrators: users.filter((u) => u.administrator).length,
      libraries: libraries.length,
    };
  }

  async overview(): Promise<InfraOverview> {
    const [info, users, libraries, activity] = await Promise.all([
      this.mediaServerInfo(),
      this.listMediaUsers(),
      this.listMediaLibraries(),
      this.mediaActivity(),
    ]);
    const quickConnect = info.quickConnect === null ? 'unknown' : info.quickConnect ? 'on' : 'off';
    return {
      version: info.version,
      nodes: [],
      storages: [],
      facts: [
        { label: 'Version', value: info.version ?? '–' },
        { label: 'Server name', value: info.serverName ?? '–' },
        { label: 'Users', value: String(users.length) },
        { label: 'Libraries', value: String(libraries.length) },
        { label: 'Active sessions', value: String(activity.activeSessions) },
        { label: 'Playing', value: String(activity.playing) },
        { label: 'Quick Connect', value: quickConnect },
        { label: 'Login', value: this.mediaLoginUrl() },
      ],
    };
  }

  // ---------------------------------------------------------------------------
  // Users

  /** Every user of the instance, in one answer (Jellyfin does not page /Users). */
  async listMediaUsers(): Promise<RemoteMediaUser[]> {
    const body = await this.client.request('GET', '/Users', { action: 'list users' });
    // Jellyfin never has zero users (the last one cannot be deleted): an empty or odd answer
    // must not make the sync think every account is gone.
    if (!Array.isArray(body) || body.length === 0) {
      throw new ProviderError(PROVIDER, 'list users failed: unexpected answer');
    }
    return body.map(parseJellyfinUser).filter((u): u is RemoteMediaUser => u !== null);
  }

  async getMediaUser(userId: string): Promise<RemoteMediaUser> {
    const id = userIdOf(userId);
    return this.userFrom(await this.readUser(id), id);
  }

  /**
   * Creates the user with its password, then writes its policy. Until then the user has
   * Jellyfin's defaults (all libraries, Live TV, public sharing), so a failed policy write
   * removes the user again. Once the policy is written, a failed read-back does not fail the
   * creation: the user is built from what was sent.
   */
  async createMediaUser(input: MediaUserInput): Promise<RemoteMediaUser> {
    const username = assertJellyfinUsername(input.username);
    // A user created without a password signs in with the name alone.
    const password = assertJellyfinPassword(input.password);
    const secrets = [password];

    let created: Record<string, unknown>;
    try {
      const body = await this.client.request('POST', '/Users/New', {
        json: { Name: username, Password: password },
        action: `create user ${username}`,
        secrets,
      });
      if (!isObject(body))
        throw new ProviderError(PROVIDER, `create user ${username} failed: unexpected answer`);
      created = body;
    } catch (err) {
      // Jellyfin answers 400 "Error processing request." for invalid and for taken names alike.
      if (err instanceof ProviderError && err.upstreamStatus === 400 && (await this.nameTaken(username))) {
        throw conflict(`The Jellyfin user "${username}" already exists`);
      }
      throw err;
    }
    const id = jellyfinId(created.Id);
    if (!id) throw new ProviderError(PROVIDER, `create user ${username} failed: the answer has no user id`);

    let policy: Record<string, unknown>;
    try {
      let current = isObject(created.Policy) ? created.Policy : null;
      // Without the provider ids Jellyfin refuses the policy (400): read the user first.
      if (!current || typeof current.AuthenticationProviderId !== 'string') {
        const read = await this.readUser(id, secrets);
        current = isObject(read.Policy) ? read.Policy : null;
        if (!current) throw new ProviderError(PROVIDER, 'the user has no policy to change');
      }
      policy = applyPolicyState(current, input.policy);
      await this.client.request('POST', `/Users/${id}/Policy`, { json: policy, secrets });
    } catch (err) {
      const removed = await this.removeHalfCreated(id);
      throw new ProviderError(
        PROVIDER,
        this.client.scrub(
          `create user ${username} failed while setting its access: ${reasonOf(err)}. ` +
            (removed
              ? 'The user was removed again'
              : 'Removing the user failed too: delete it in Jellyfin (it has all libraries)'),
          secrets,
        ),
      );
    }

    try {
      return this.userFrom(await this.readUser(id, secrets), id);
    } catch {
      // The user exists with its policy now: failing here would leave it behind unmanaged.
      const user = parseJellyfinUser({ ...created, Policy: policy, HasPassword: true });
      if (!user) throw new ProviderError(PROVIDER, `create user ${username} failed: unexpected answer`);
      return { ...user, policy: input.policy };
    }
  }

  async setMediaUserPolicy(userId: string, policy: MediaPolicyState): Promise<RemoteMediaUser> {
    const id = userIdOf(userId);
    return this.exclusive(id, async () => {
      const current = await this.readUser(id);
      const body = applyPolicyState(this.policyOf(current, id), policy);
      await this.write(id, `/Users/${id}/Policy`, {
        json: body,
        action: `set the access of ${this.nameOf(current, id)}`,
      });
      return this.userFrom({ ...current, Policy: body }, id);
    });
  }

  async setMediaUserEnabled(userId: string, enabled: boolean): Promise<RemoteMediaUser> {
    const id = userIdOf(userId);
    return this.exclusive(id, async () => {
      const current = await this.readUser(id);
      const policy = this.policyOf(current, id);
      if (policy.IsAdministrator === true) throw jellyfinAdminRefused();
      // Enabling also resets the failed sign-ins, or the next failure locks the user again.
      const body = { ...policy, IsDisabled: !enabled, ...(enabled ? { InvalidLoginAttemptCount: 0 } : {}) };
      await this.write(id, `/Users/${id}/Policy`, {
        json: body,
        action: `${enabled ? 'enable' : 'disable'} ${this.nameOf(current, id)}`,
      });
      return this.userFrom({ ...current, Policy: body }, id);
    });
  }

  /** As an administrator (API key) without the current password. Jellyfin signs out every device. */
  async setMediaUserPassword(userId: string, password: string): Promise<void> {
    const id = userIdOf(userId);
    assertJellyfinPassword(password);
    const secrets = [password];
    await this.exclusive(id, async () => {
      const current = await this.readUser(id, secrets);
      if (this.policyOf(current, id).IsAdministrator === true) throw jellyfinAdminRefused();
      // Never ResetPassword: true, which leaves the user without a password.
      await this.write(id, '/Users/Password', {
        query: { userId: id },
        json: { NewPw: password, ResetPassword: false },
        action: `set the password of ${this.nameOf(current, id)}`,
        secrets,
      });
    });
  }

  /** Jellyfin signs out the user's devices and deletes its playlists, watch history and favorites. */
  async deleteMediaUser(userId: string): Promise<void> {
    const id = userIdOf(userId);
    await this.exclusive(id, async () => {
      const current = await this.readUser(id);
      if (this.policyOf(current, id).IsAdministrator === true) throw jellyfinAdminRefused();
      try {
        await this.client.request('DELETE', `/Users/${id}`, {
          action: `delete user ${this.nameOf(current, id)}`,
        });
      } catch (err) {
        if (isNotFound(err)) throw this.userNotFound(id);
        throw err;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Libraries, server, activity

  async listMediaLibraries(fresh = false): Promise<MediaLibraryRef[]> {
    return (await this.libraries.get(fresh)).map((library) => ({ ...library }));
  }

  async mediaServerInfo(fresh = false): Promise<MediaServerInfo> {
    return { ...(await this.serverInfo.get(fresh)) };
  }

  /** Two numbers for the admin overview: never titles, names, devices or addresses. */
  async mediaActivity(): Promise<MediaActivity> {
    return { ...(await this.activity.get()) };
  }

  mediaLoginUrl(): string {
    return this.client.baseUrl;
  }

  private async readLibraries(): Promise<MediaLibraryRef[]> {
    const body = await this.client.request('GET', '/Library/VirtualFolders', { action: 'list libraries' });
    if (!Array.isArray(body)) throw new ProviderError(PROVIDER, 'list libraries failed: unexpected answer');
    return parseLibraries(body);
  }

  private async readServerInfo(): Promise<MediaServerInfo> {
    const [system, quickConnect] = await Promise.all([
      this.client.request('GET', '/System/Info', { action: 'read the server info' }),
      // Anonymous and optional: the login card simply leaves Quick Connect out when unknown.
      this.client.request('GET', '/QuickConnect/Enabled', { action: 'read Quick Connect' }).then(
        (value) =>
          typeof value === 'boolean' ? value : value === 'true' ? true : value === 'false' ? false : null,
        () => null,
      ),
    ]);
    if (!isObject(system))
      throw new ProviderError(PROVIDER, 'read the server info failed: unexpected answer');
    return { ...parseServerInfo(system), quickConnect };
  }

  private async readActivity(): Promise<MediaActivity> {
    const body = await this.client.request('GET', '/Sessions', {
      query: { activeWithinSeconds: MEDIA_ACTIVE_WITHIN_SECONDS },
      action: 'list sessions',
    });
    if (!Array.isArray(body)) throw new ProviderError(PROVIDER, 'list sessions failed: unexpected answer');
    return parseActivity(body);
  }

  // ---------------------------------------------------------------------------
  // Helpers

  /** The UserDto of a user; 404 as "user <id> not found". */
  private async readUser(id: string, secrets?: string[]): Promise<Record<string, unknown>> {
    let body: unknown;
    try {
      body = await this.client.request('GET', `/Users/${id}`, { action: `read user ${id}`, secrets });
    } catch (err) {
      if (isNotFound(err)) throw this.userNotFound(id);
      throw err;
    }
    if (!isObject(body)) throw new ProviderError(PROVIDER, `read user ${id} failed: unexpected answer`);
    return body;
  }

  /** POST to a user that was just read; a 404 means it was deleted meanwhile. */
  private async write(id: string, path: string, options: JellyfinRequestOptions): Promise<void> {
    try {
      await this.client.request('POST', path, options);
    } catch (err) {
      if (isNotFound(err)) throw this.userNotFound(id);
      throw err;
    }
  }

  private userFrom(raw: Record<string, unknown>, id: string): RemoteMediaUser {
    const user = parseJellyfinUser(raw);
    if (!user) throw new ProviderError(PROVIDER, `read user ${id} failed: the answer has no id or name`);
    return user;
  }

  /** The whole policy as read. Without it nothing can be written (Jellyfin resets missing fields). */
  private policyOf(raw: Record<string, unknown>, id: string): Record<string, unknown> {
    if (!isObject(raw.Policy)) {
      throw new ProviderError(PROVIDER, `read user ${id} failed: the answer has no policy`);
    }
    return raw.Policy;
  }

  private nameOf(raw: Record<string, unknown>, id: string): string {
    return typeof raw.Name === 'string' && raw.Name ? raw.Name : id;
  }

  private userNotFound(id: string): ProviderError {
    return new ProviderError(PROVIDER, `user ${id} not found`, 404);
  }

  /** Whether a user with this name exists (Jellyfin compares names case-insensitively). */
  private async nameTaken(username: string): Promise<boolean> {
    try {
      const users = await this.listMediaUsers();
      return users.some((u) => sameJellyfinUsername(u.username, username));
    } catch {
      return false;
    }
  }

  /** Best effort: the error of the creation is what the caller needs to see. */
  private async removeHalfCreated(id: string): Promise<boolean> {
    try {
      await this.client.request('DELETE', `/Users/${id}`, { action: `remove half-created user ${id}` });
      return true;
    } catch (err) {
      return isNotFound(err);
    }
  }

  /** Runs `fn` after every earlier write to the same user has settled. */
  private async exclusive<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const run = previous.then(fn);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(id, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(id) === tail) this.locks.delete(id);
    }
  }

  // ---------------------------------------------------------------------------
  // API explorer

  /**
   * Paths below the base URL, e.g. "/Users" (the base URL may be included). GET and DELETE send
   * the body as query, POST as JSON. Paths that hand out or create credentials are refused
   * before anything is sent; tokens, keys and passwords in answers are blanked.
   */
  async rawRequest(method: string, path: string, body?: Record<string, unknown>): Promise<RawResponse> {
    const upper = method.toUpperCase();
    if (upper !== 'GET' && upper !== 'POST' && upper !== 'DELETE') throw badRequest('Unsupported method');
    let clean = path.trim();
    if (clean.startsWith(this.client.baseUrl)) clean = clean.slice(this.client.baseUrl.length);
    if (clean.includes('#')) throw badRequest('Invalid path');
    const q = clean.indexOf('?');
    const pathname = q >= 0 ? clean.slice(0, q) : clean;
    if (!pathname.startsWith('/')) throw badRequest('The path must start with /, e.g. /Users');
    // The key goes to this instance only: no dot segments (also encoded), no host or path switch.
    if (
      !/^\/[A-Za-z0-9/_.~-]*$/.test(pathname) ||
      /\/\/|\\|%2e|%2f|%5c/i.test(pathname) ||
      pathname.split('/').some((segment) => segment === '.' || segment === '..')
    ) {
      throw badRequest('Invalid path');
    }
    // Compared without trailing dots of segments, in case a server ever ignores them ("/Auth/Keys.").
    const lower = pathname
      .toLowerCase()
      .split('/')
      .map((segment) => segment.replace(/\.+$/, ''))
      .join('/');
    if (EXPLORER_BLOCKED.some((blocked) => blocked.test(lower))) {
      throw badRequest('This path hands out or creates credentials and is not available in the explorer');
    }

    const query: Query = {};
    const secrets: string[] = explorerSecrets(body);
    for (const [key, value] of new URLSearchParams(q >= 0 ? clean.slice(q + 1) : '')) {
      query[key] = value;
      if (EXPLORER_SECRET_KEY.test(key) && !/providerid$/i.test(key)) secrets.push(value);
    }
    const asQuery = upper !== 'POST';
    if (body && asQuery) {
      for (const [key, value] of Object.entries(body)) query[key] = queryValue(value);
    }
    const res = await this.client.raw(upper, pathname, { query, json: asQuery ? undefined : body, secrets });
    return { status: res.status, data: this.client.scrubValue(redactJellyfin(res.body), secrets) };
  }
}
