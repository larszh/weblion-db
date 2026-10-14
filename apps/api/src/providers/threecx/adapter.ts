import {
  PHONE_EXTENSION_MAX_DIGITS,
  PHONE_EXTENSION_MIN_DIGITS,
  isValidExtension,
  type Capability,
  type PhoneRingGroup,
  type PhoneTrunk,
  type PhoneUser,
  type PowerAction,
} from '@weblion/shared';
import { ProviderError, badRequest, conflict, notFound } from '../../lib/errors';
import { isRecord, num, str } from '../http';
import type {
  InfraOverview,
  PhoneUserInput,
  PhoneUserPatch,
  ProviderAdapter,
  RawResponse,
  RemotePhoneSystem,
  RemoteServer,
  ServerRef,
  ThreeCxConfig,
} from '../types';
import { PROVIDER, ThreeCxClient, XAPI_PATH, type Query, type ThreeCxClientOptions } from './client';
import {
  RING_GROUP_SELECT,
  SYSTEM_STATUS_SELECT,
  TRUNK_SELECT,
  USER_EXPAND,
  USER_SELECT,
  assertXapiId,
  odataOf,
  odataString,
  parseRingGroup,
  parseSystemInfo,
  parseTrunk,
  parseUser,
  redactSecrets,
  throwWriteError,
  userCreatePayload,
  userPatchPayload,
} from './parse';

/** External id of the one phone system a 3CX connection reports. */
export const THREECX_SYSTEM_ID = 'pbx';

// Viewers poll, every 3CX shares one small VM with the calls: answers are shared this long.
const PARAMS_TTL_MS = 10 * 60_000;
const STATUS_TTL_MS = 30_000;
const USERS_TTL_MS = 20_000;
const RING_GROUPS_TTL_MS = 30_000;
const TRUNKS_TTL_MS = 60_000;
const LONGEST_TTL_MS = PARAMS_TTL_MS;

/** Explorer paths: an entity set or singleton below /xapi/v1, e.g. /Users(42) or /SystemStatus. */
const EXPLORER_PATH = /^\/[A-Za-z][A-Za-z0-9]*/;

/** Values per key, each shared until its TTL is over. Failed loads are not kept. */
class ReadCache {
  private readonly entries = new Map<string, { at: number; value: Promise<unknown> }>();

  constructor(private readonly now: () => number) {}

  get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const now = this.now();
    const hit = this.entries.get(key);
    if (hit && now - hit.at < ttlMs) return hit.value as Promise<T>;
    if (this.entries.size >= 100) this.prune(now);
    const value = load();
    const entry = { at: now, value };
    this.entries.set(key, entry);
    value.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return value;
  }

  forget(...keys: string[]) {
    for (const key of keys) this.entries.delete(key);
  }

  /** Drops what no TTL would serve anymore. */
  private prune(now: number) {
    for (const [key, entry] of this.entries) {
      if (now - entry.at >= LONGEST_TTL_MS) this.entries.delete(key);
    }
  }
}

/** One write at a time per key (ring group members are read, changed and written as a whole). */
class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => (release = resolve));
    const tail = previous.then(() => current);
    this.tails.set(key, tail);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

function isNotFound(err: unknown): boolean {
  return err instanceof ProviderError && err.upstreamStatus === 404;
}

/** The PBX refused the nested role $expand of the users list (older builds, other OData stacks). */
function expandRefused(err: unknown): boolean {
  if (!(err instanceof ProviderError) || err.upstreamStatus !== 400) return false;
  const odata = odataOf(err);
  const text = [err.message, odata?.message, ...(odata?.details ?? []).map((d) => d.message)].join(' ');
  return /(\$|%24)expand|groups|rights/i.test(text);
}

function byNumber<T extends { number: string }>(a: T, b: T): number {
  return a.number.length - b.number.length || a.number.localeCompare(b.number);
}

/** Calendar day in Zurich (the PBX's 2027-01-31T00:00:00+01:00 is the 31st, not the 30th). */
const DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Zurich',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function dateOnly(iso: string | null): string {
  return iso ? DAY.format(new Date(iso)) : '–';
}

function figure(n: number | null, of: number | null = null): string {
  if (n === null) return '–';
  return of === null ? String(n) : `${n} / ${of}`;
}

/** Explorer body values as query parameters: arrays joined by commas, objects as JSON. */
function toQuery(body: Record<string, unknown>): Query {
  const query: Query = {};
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value))
      query[key] = value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(',');
    else if (typeof value === 'object') query[key] = JSON.stringify(value);
    else query[key] = value as string | number | boolean;
  }
  return query;
}

/**
 * A 3CX V20 phone system (PBX), reached through its Configuration API (XAPI) with an API client
 * of its own (needs a 3CX Enterprise license and the System Admin role). One phone system per
 * connection (external id "pbx"); users, ring groups and trunks are read live and cached for
 * seconds. Every read selects its properties explicitly, so no password, PIN or license key is
 * ever transferred; the answers of writes are only read for Id and Number.
 */
export class ThreeCxAdapter implements ProviderAdapter {
  readonly type = 'threecx' as const;
  readonly client: ThreeCxClient;
  private readonly reads: ReadCache;
  private readonly ringGroupLocks = new KeyedMutex();
  /** false after the PBX refused the role $expand of the users list once. */
  private rolesExpand = true;

  constructor(config: ThreeCxConfig, options?: ThreeCxClientOptions) {
    this.client = new ThreeCxClient(config, options);
    this.reads = new ReadCache(this.client.now);
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
    throw new ProviderError(PROVIDER, `3CX has no servers (${ref.externalId})`, 404);
  }

  /**
   * Signs in and probes every area the panel reads (sequentially, 6 requests with the token), so
   * a missing role shows up here and not on the first customer click.
   */
  async testConnection(): Promise<Record<string, unknown>> {
    const probe = async <T>(area: string, run: () => Promise<T>): Promise<T> => {
      try {
        return await run();
      } catch (err) {
        if (err instanceof ProviderError && err.upstreamStatus === 403) {
          throw new ProviderError(
            PROVIDER,
            `the API client may not read ${area}: give it the System Admin role in the default group ` +
              '(3CX Admin > Integrations > API); the XAPI needs an Enterprise license',
            403,
          );
        }
        throw err;
      }
    };
    const params = await probe('system status', () =>
      this.client.request('GET', '/Defs/Pbx.GetSystemParameters()', { action: 'read the system parameters' }),
    );
    const status = await probe('system status', () =>
      this.client.request('GET', '/SystemStatus', {
        query: { $select: 'FQDN,Version,UserExtensions,TrunksTotal,LicenseActive' },
        action: 'read the system status',
      }),
    );
    const users = await probe('users', () =>
      this.client.request('GET', '/Users', {
        query: { $top: 1, $select: 'Id', $count: true },
        action: 'list users',
        collection: true,
      }),
    );
    await probe('ring groups', () =>
      this.client.request('GET', '/RingGroups', {
        query: { $top: 1, $select: 'Id' },
        action: 'list ring groups',
        collection: true,
      }),
    );
    await probe('trunks', () =>
      this.client.request('GET', '/Trunks', {
        query: { $top: 1, $select: 'Id' },
        action: 'list trunks',
        collection: true,
      }),
    );
    const info = parseSystemInfo(status, params, this.client.baseUrl);
    return {
      version: info.version,
      fqdn: info.fqdn,
      edition: info.edition,
      users: info.users ?? (isRecord(users) ? num(users['@odata.count']) : null),
      numberLength: info.numberLength,
      licenseActive: info.licenseActive,
    };
  }

  async overview(): Promise<InfraOverview> {
    const { info } = await this.getPhoneSystem(THREECX_SYSTEM_ID);
    const edition = [info.edition, info.productCode].filter(Boolean).join(', ');
    return {
      version: info.version,
      nodes: [],
      storages: [],
      facts: [
        { label: 'Version', value: info.version ?? '–' },
        { label: 'FQDN', value: info.fqdn ?? '–' },
        { label: 'Edition', value: edition || '–' },
        { label: 'License valid until', value: dateOnly(info.licenseExpiresAt) },
        { label: 'Maintenance until', value: dateOnly(info.maintenanceExpiresAt) },
        { label: 'Simultaneous calls', value: figure(info.activeCalls, info.maxSimCalls) },
        { label: 'Users', value: figure(info.users, info.maxUsers) },
        { label: 'Extensions registered', value: figure(info.extensionsRegistered, info.extensionsTotal) },
        { label: 'Trunks registered', value: figure(info.trunksRegistered, info.trunksTotal) },
        { label: 'Number length', value: figure(info.numberLength) },
        { label: 'Web client', value: info.webClientUrl ?? '–' },
      ],
    };
  }

  // ---------------------------------------------------------------------------
  // Phone system

  async listPhoneSystems(): Promise<RemotePhoneSystem[]> {
    return [await this.getPhoneSystem(THREECX_SYSTEM_ID)];
  }

  async getPhoneSystem(systemId: string): Promise<RemotePhoneSystem> {
    this.assertSystem(systemId);
    const [status, params] = await Promise.all([this.systemStatus(), this.systemParameters()]);
    const info = parseSystemInfo(status, params, this.client.baseUrl);
    return { externalId: THREECX_SYSTEM_ID, name: info.fqdn ?? new URL(this.client.baseUrl).hostname, info };
  }

  private systemStatus(): Promise<Record<string, unknown>> {
    return this.reads.get('status', STATUS_TTL_MS, () =>
      this.record('/SystemStatus', 'read the system status', { $select: SYSTEM_STATUS_SELECT }),
    );
  }

  private systemParameters(): Promise<Record<string, unknown>> {
    return this.reads.get('params', PARAMS_TTL_MS, () =>
      this.record('/Defs/Pbx.GetSystemParameters()', 'read the system parameters'),
    );
  }

  /** A request whose answer must be one JSON object (singletons, functions). */
  private async record(path: string, action: string, query?: Query): Promise<Record<string, unknown>> {
    const body = await this.client.request('GET', path, { query, action });
    if (!isRecord(body)) throw new ProviderError(PROVIDER, `${action} failed: unexpected answer for ${path}`);
    return body;
  }

  private assertSystem(systemId: string) {
    if (systemId !== THREECX_SYSTEM_ID) {
      throw new ProviderError(PROVIDER, `unknown phone system "${String(systemId).slice(0, 64)}"`, 404);
    }
  }

  // ---------------------------------------------------------------------------
  // Users

  async listPhoneUsers(systemId: string): Promise<PhoneUser[]> {
    this.assertSystem(systemId);
    return this.reads.get('users', USERS_TTL_MS, async () => {
      const raw = await this.withRoles((expand) =>
        this.client.list(
          '/Users',
          { $select: USER_SELECT, $expand: expand, $orderby: 'Number' },
          'list users',
        ),
      );
      // A user created between two pages shifts the offsets; the map drops the duplicate.
      const byId = new Map<string, PhoneUser>();
      for (const entry of raw) {
        const user = parseUser(entry);
        if (user) byId.set(user.id, user);
      }
      return [...byId.values()].sort(byNumber);
    });
  }

  async getPhoneUser(systemId: string, userId: string): Promise<PhoneUser> {
    this.assertSystem(systemId);
    const id = assertXapiId(userId, 'phone user');
    let raw: unknown;
    try {
      raw = await this.withRoles((expand) =>
        this.client.request('GET', `/Users(${id})`, {
          query: { $select: USER_SELECT, $expand: expand },
          action: `read user ${id}`,
        }),
      );
    } catch (err) {
      if (isNotFound(err)) throw new ProviderError(PROVIDER, `phone user ${id} not found`, 404);
      throw err;
    }
    const user = parseUser(raw);
    if (!user) throw new ProviderError(PROVIDER, `read user ${id} failed: no user data in the answer`);
    return user;
  }

  async nextPhoneNumber(systemId: string): Promise<string | null> {
    this.assertSystem(systemId);
    const body = await this.client.request('GET', '/Users/Pbx.GetFirstAvailableExtensionNumber()', {
      action: 'read the next free extension number',
    });
    return isRecord(body) ? str(body.Number) : null;
  }

  /**
   * Checks the number against the PBX's extension length and its users, creates the user and
   * reads it back. The answer of the creation carries the whole entity (credentials included):
   * only Id and Number are taken from it. Once the user exists, a failed read-back does not
   * fail the creation.
   */
  async createPhoneUser(systemId: string, input: PhoneUserInput): Promise<PhoneUser> {
    this.assertSystem(systemId);
    const number = input.number || undefined;
    if (number !== undefined) {
      const { numberLength } = parseSystemInfo({}, await this.systemParameters(), this.client.baseUrl);
      if (!isValidExtension(number, numberLength)) {
        throw badRequest(
          numberLength
            ? `The extension number must have ${numberLength} digits`
            : `The extension number must have ${PHONE_EXTENSION_MIN_DIGITS} to ${PHONE_EXTENSION_MAX_DIGITS} digits`,
        );
      }
      if ((await this.lookupNumber(number, 'Id')) !== null) {
        throw conflict(`The extension number ${number} is in use at the phone system`);
      }
    }

    let created: unknown;
    try {
      created = await this.client.request('POST', '/Users', {
        body: userCreatePayload({ ...input, number }),
        action: number ? `create user ${number}` : 'create user',
      });
    } catch (err) {
      throwWriteError(err, { what: 'phone user', number, creating: true });
    } finally {
      this.reads.forget('users', 'status');
    }

    const createdId = isRecord(created) ? num(created.Id) : null;
    const createdNumber = (isRecord(created) ? str(created.Number) : null) ?? number ?? null;
    if (createdId === null) {
      if (createdNumber !== null) {
        const found = await this.lookupNumber(createdNumber, USER_SELECT).catch(() => null);
        const user = parseUser(found);
        if (user) return user;
      }
      throw new ProviderError(
        PROVIDER,
        'create user: the PBX created the user but did not report its id, reload the user list',
      );
    }
    try {
      return await this.getPhoneUser(systemId, String(createdId));
    } catch {
      // The user exists now; the next list shows the PBX's values.
      const displayName = [input.firstName, input.lastName].filter(Boolean).join(' ') || null;
      return {
        id: String(createdId),
        number: createdNumber ?? '',
        firstName: input.firstName,
        lastName: input.lastName,
        displayName,
        email: input.email.toLowerCase(),
        mobile: input.mobile,
        outboundCallerId: input.outboundCallerId,
        language: input.language,
        enabled: null,
        registered: null,
        role: null,
        admin: false,
        system: false,
      };
    }
  }

  async updatePhoneUser(systemId: string, userId: string, patch: PhoneUserPatch): Promise<PhoneUser> {
    this.assertSystem(systemId);
    const id = assertXapiId(userId, 'phone user');
    const payload = userPatchPayload(patch);
    if (Object.keys(payload).length > 0) {
      try {
        await this.client.request('PATCH', `/Users(${id})`, { body: payload, action: `change user ${id}` });
      } catch (err) {
        throwWriteError(err, { what: `phone user ${id}` });
      } finally {
        this.reads.forget('users');
      }
    }
    return this.getPhoneUser(systemId, String(id));
  }

  async deletePhoneUser(systemId: string, userId: string): Promise<void> {
    this.assertSystem(systemId);
    const id = assertXapiId(userId, 'phone user');
    try {
      await this.client.request('DELETE', `/Users(${id})`, { action: `delete user ${id}` });
    } catch (err) {
      throwWriteError(err, { what: `phone user ${id}` });
    } finally {
      // The PBX drops the extension from its ring groups as well.
      this.reads.forget('users', 'status', 'ringGroups');
    }
  }

  /** The PBX sends its welcome e-mail (login and apps) to the user's address. */
  async sendPhoneWelcome(systemId: string, userId: string): Promise<void> {
    this.assertSystem(systemId);
    const id = assertXapiId(userId, 'phone user');
    let user: unknown;
    try {
      user = await this.client.request('GET', `/Users(${id})`, {
        query: { $select: 'Id,EmailAddress' },
        action: `read user ${id}`,
      });
    } catch (err) {
      if (isNotFound(err)) throw new ProviderError(PROVIDER, `phone user ${id} not found`, 404);
      throw err;
    }
    if (!isRecord(user) || !str(user.EmailAddress)) throw badRequest('This user has no e-mail address');
    try {
      await this.client.request('POST', `/Users(${id})/Pbx.SendWelcomeEmail`, {
        action: `send the welcome e-mail to user ${id}`,
      });
    } catch (err) {
      throwWriteError(err, { what: `phone user ${id}` });
    }
  }

  /**
   * The user with the extension (alternate key Number), null when there is none (that the XAPI
   * answers 404 for a free number is UNVERIFIED; any other failure throws).
   */
  private async lookupNumber(number: string, select: string): Promise<unknown> {
    try {
      const raw = await this.client.request(
        'GET',
        `/Users(Number=${encodeURIComponent(odataString(number))})`,
        {
          query: { $select: select },
          action: `look up extension ${number}`,
        },
      );
      return raw ?? null;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  /**
   * Runs a users read with the role $expand, and without it from the first time the PBX refuses
   * the nested options (role then null, admin false) for the lifetime of the adapter.
   */
  private async withRoles<T>(read: (expand: string | undefined) => Promise<T>): Promise<T> {
    if (!this.rolesExpand) return read(undefined);
    try {
      return await read(USER_EXPAND);
    } catch (err) {
      if (!expandRefused(err)) throw err;
      this.rolesExpand = false;
      return read(undefined);
    }
  }

  // ---------------------------------------------------------------------------
  // Ring groups

  async listPhoneRingGroups(systemId: string): Promise<PhoneRingGroup[]> {
    this.assertSystem(systemId);
    return this.reads.get('ringGroups', RING_GROUPS_TTL_MS, async () => {
      const raw = await this.client.list(
        '/RingGroups',
        { $select: RING_GROUP_SELECT, $expand: 'Members', $orderby: 'Number' },
        'list ring groups',
      );
      const byId = new Map<string, PhoneRingGroup>();
      for (const entry of raw) {
        const group = parseRingGroup(entry);
        if (group) byId.set(group.id, group);
      }
      return [...byId.values()].sort(byNumber);
    });
  }

  async addPhoneRingGroupMember(systemId: string, groupId: string, number: string): Promise<PhoneRingGroup> {
    return this.changeMembers(systemId, groupId, number, (members) =>
      members.includes(number) ? null : [...members, number],
    );
  }

  async removePhoneRingGroupMember(
    systemId: string,
    groupId: string,
    number: string,
  ): Promise<PhoneRingGroup> {
    return this.changeMembers(systemId, groupId, number, (members) => {
      if (!members.includes(number)) throw notFound('Ring group member');
      return members.filter((m) => m !== number);
    });
  }

  /**
   * The XAPI replaces Members as a whole: read the group right before the PATCH and write the
   * full list in ring order, one change at a time per group in this process. `change` returns
   * the new list, or null when nothing changes.
   */
  private async changeMembers(
    systemId: string,
    groupId: string,
    number: string,
    change: (members: string[]) => string[] | null,
  ): Promise<PhoneRingGroup> {
    this.assertSystem(systemId);
    const id = assertXapiId(groupId, 'ring group');
    if (!/^[0-9]{1,20}$/.test(number)) throw badRequest('The extension number must consist of digits');
    return this.ringGroupLocks.run(String(id), async () => {
      const current = await this.ringGroup(id);
      const members = change(current.members.map((m) => m.number));
      if (members === null) return current;
      try {
        await this.client.request('PATCH', `/RingGroups(${id})`, {
          body: { Members: members.map((m) => ({ Number: m })) },
          action: `change the members of ring group ${id}`,
        });
      } catch (err) {
        throwWriteError(err, { what: `ring group ${id}`, number });
      } finally {
        this.reads.forget('ringGroups');
      }
      return this.ringGroup(id);
    });
  }

  private async ringGroup(id: number): Promise<PhoneRingGroup> {
    let raw: unknown;
    try {
      raw = await this.client.request('GET', `/RingGroups(${id})`, {
        query: { $select: RING_GROUP_SELECT, $expand: 'Members' },
        action: `read ring group ${id}`,
      });
    } catch (err) {
      if (isNotFound(err)) throw new ProviderError(PROVIDER, `ring group ${id} not found`, 404);
      throw err;
    }
    const group = parseRingGroup(raw);
    if (!group)
      throw new ProviderError(PROVIDER, `read ring group ${id} failed: no ring group in the answer`);
    return group;
  }

  // ---------------------------------------------------------------------------
  // Trunks (read only)

  async listPhoneTrunks(systemId: string): Promise<PhoneTrunk[]> {
    this.assertSystem(systemId);
    return this.reads.get('trunks', TRUNKS_TTL_MS, async () => {
      const raw = await this.client.list(
        '/Trunks',
        { $select: TRUNK_SELECT, $orderby: 'Number' },
        'list trunks',
      );
      const byId = new Map<string, PhoneTrunk>();
      for (const entry of raw) {
        const trunk = parseTrunk(entry);
        if (trunk) byId.set(trunk.id, trunk);
      }
      return [...byId.values()].sort(byNumber);
    });
  }

  // ---------------------------------------------------------------------------
  // API explorer

  /**
   * XAPI paths below /xapi/v1, e.g. "/Users?$select=Id,Number&$top=10" (the base URL and
   * /xapi/v1 may be included). GET and DELETE send the body as query, POST and PATCH as JSON.
   * The token goes to this PBX only, and the panel's own API client cannot be changed here.
   * Secret values in the answer are blanked.
   */
  async rawRequest(method: string, path: string, body?: Record<string, unknown>): Promise<RawResponse> {
    const upper = method.toUpperCase();
    if (upper === 'PUT') throw badRequest('3CX updates use PATCH');
    if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(upper)) throw badRequest('Unsupported method');

    let clean = path.trim();
    if (clean.startsWith(this.client.baseUrl)) clean = clean.slice(this.client.baseUrl.length);
    if (clean.startsWith(XAPI_PATH)) clean = clean.slice(XAPI_PATH.length);
    const q = clean.indexOf('?');
    const pathname = q >= 0 ? clean.slice(0, q) : clean;
    if (!EXPLORER_PATH.test(pathname)) {
      throw badRequest('Only XAPI paths are allowed, e.g. /Users?$top=10 or /SystemStatus');
    }
    if (/\.\.|\/\/|\\|@|#|%2e|%2f|%5c/i.test(pathname) || clean.includes('#'))
      throw badRequest('Invalid path');
    if (/\/connect\//i.test(pathname))
      throw badRequest('The token endpoint cannot be called through the explorer');
    if (
      /Pbx\.GenerateAppToken|Pbx\.APIToken/i.test(pathname) ||
      (/ServicePrincipals/i.test(pathname) && upper !== 'GET')
    ) {
      throw badRequest('The API client of the panel cannot be changed through the explorer');
    }

    const asQuery = upper === 'GET' || upper === 'DELETE';
    const res = await this.client.raw(upper, clean, {
      query: body && asQuery ? toQuery(body) : undefined,
      body: body && !asQuery ? body : undefined,
    });
    if (upper !== 'GET') this.reads.forget('params', 'status', 'users', 'ringGroups', 'trunks');
    return {
      status: res.status,
      data: res.status === 204 || res.body === '' ? null : redactSecrets(res.body),
    };
  }
}
