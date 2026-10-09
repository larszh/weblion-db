import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CLOUD_MIN_QUOTA_BYTES } from '@weblion/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError, ProviderError } from '../src/lib/errors';
import { DemoAdapter } from '../src/providers/demo/adapter';
import { DEMO_CLOUD_URL, DemoCloud, demoCloudState } from '../src/providers/demo/cloud';
import { NextcloudAdapter } from '../src/providers/nextcloud/adapter';
import { NextcloudClient, ocsStatus, toForm } from '../src/providers/nextcloud/client';
import {
  isValidUserId,
  nextcloudLanguage,
  parseCloudUser,
  parseHumanSize,
  parseQuota,
  parseUsersDetails,
  redactPasswords,
} from '../src/providers/nextcloud/parse';
import type { CloudAccountInput } from '../src/providers/types';
import { startMockServer, type RecordedRequest } from './mock-server';

// ---------------------------------------------------------------------------
// A small Nextcloud: OCS v2 envelopes, Basic auth, users and groups in memory. Shapes follow
// the provisioning_api OpenAPI spec and UsersController/AUserDataOCSController.

const USER = 'weblion-panel';
const APP_PASSWORD = 'Xk7pQ-2mVnR-8sLtW-4yZaB-9cDeF';
const AUTH = `Basic ${Buffer.from(`${USER}:${APP_PASSWORD}`).toString('base64')}`;
const GiB = 1024 ** 3;
const OCS = '/ocs/v2.php';

interface MockUser {
  id: string;
  displayname: string;
  email: string | null;
  /** Bytes, or a negative number for unlimited like FileInfo::SPACE_UNLIMITED. */
  quota: number;
  used: number;
  enabled: boolean;
  lastLogin: number;
  groups: string[];
}

type Answer = { status?: number; body: unknown } | undefined;

const ok = (data: unknown = []): Answer => ({
  status: 200,
  body: { ocs: { meta: { status: 'ok', statuscode: 200, message: 'OK' }, data } },
});
const fail = (status: number, statuscode: number, message = ''): Answer => ({
  status,
  body: { ocs: { meta: { status: 'failure', statuscode, message }, data: [] } },
});

function details(u: MockUser) {
  return {
    enabled: u.enabled,
    storageLocation: `/var/www/data/${u.id}`,
    id: u.id,
    firstLoginTimestamp: u.lastLogin ? 1700000000 : -1,
    lastLoginTimestamp: Math.floor(u.lastLogin / 1000),
    lastLogin: u.lastLogin,
    backend: 'Database',
    subadmin: [],
    quota:
      u.quota >= 0
        ? { free: u.quota - u.used, used: u.used, total: u.quota, relative: 1.5, quota: u.quota }
        : { free: -3, used: u.used, total: -3, relative: 0, quota: -3 },
    manager: '',
    email: u.email,
    additional_mail: [],
    displayname: u.displayname,
    'display-name': u.displayname,
    phone: '',
    groups: u.groups,
    language: 'de',
    locale: '',
    backendCapabilities: { setDisplayName: true, setPassword: true },
  };
}

class MockNextcloud {
  users = new Map<string, MockUser>();
  groups = new Set<string>(['admin']);
  /** Overrides for single requests: return an answer to short-circuit. */
  override: ((req: RecordedRequest) => Answer) | null = null;

  constructor() {
    this.add({ id: USER, displayname: 'Panel', groups: ['admin'], quota: -3, used: 1024 });
  }

  add(u: Partial<MockUser> & { id: string }): MockUser {
    const user: MockUser = {
      displayname: u.id,
      email: null,
      quota: 5 * GiB,
      used: 0,
      enabled: true,
      lastLogin: 0,
      groups: [],
      ...u,
    };
    this.users.set(user.id, user);
    return user;
  }

  handle = (req: RecordedRequest): Answer => {
    if (req.headers.authorization !== AUTH) return fail(401, 401, 'Current user is not logged in');
    if (req.headers['ocs-apirequest'] !== 'true') return fail(412, 412, 'CSRF check failed');
    const answer = this.override?.(req);
    if (answer) return answer;
    if (!req.path.startsWith(`${OCS}/`)) return undefined;
    const path = req.path.slice(OCS.length);
    const segments = path.split('/').slice(1).map(decodeURIComponent);

    if (req.method === 'GET' && path === '/cloud/capabilities') {
      return ok({
        version: { major: 31, minor: 0, micro: 4, string: '31.0.4', edition: '', extendedSupport: false },
        capabilities: { core: { pollinterval: 60 } },
      });
    }
    if (req.method === 'GET' && path === '/cloud/user') return ok(details(this.users.get(USER)!));
    if (req.method === 'GET' && path === '/cloud/users') return ok({ users: [...this.users.keys()] });
    if (req.method === 'GET' && path === '/cloud/users/details') {
      const limit = Number(req.query.get('limit') ?? 1000);
      const offset = Number(req.query.get('offset') ?? 0);
      const page = [...this.users.values()].slice(offset, offset + limit);
      return ok({ users: Object.fromEntries(page.map((u) => [u.id, details(u)])), groups: [] });
    }
    if (req.method === 'POST' && path === '/cloud/users') {
      const id = req.form.get('userid')!;
      if (this.users.has(id)) return fail(400, 102, 'User already exists');
      const groups = req.form.getAll('groups[]');
      for (const g of groups) if (!this.groups.has(g)) return fail(400, 104, `Group ${g} does not exist`);
      const password = req.form.get('password') ?? '';
      const email = req.form.get('email') ?? '';
      if (!password && !email) {
        return fail(400, 108, 'An email address is required, to send a password link to the user.');
      }
      this.add({
        id,
        displayname: req.form.get('displayName') || id,
        email: email || null,
        quota: Number(req.form.get('quota') ?? -3),
        groups,
      });
      return ok({ id });
    }
    if (segments[0] === 'cloud' && segments[1] === 'users' && segments[2]) {
      const user = this.users.get(segments[2]);
      if (!user) return fail(404, 404, '');
      const action = segments[3];
      if (req.method === 'GET' && !action) return ok(details(user));
      if (req.method === 'DELETE' && !action) {
        if (user.id === USER) return fail(400, 101, '');
        this.users.delete(user.id);
        return ok();
      }
      if (req.method === 'PUT' && (action === 'enable' || action === 'disable')) {
        user.enabled = action === 'enable';
        return ok();
      }
      if (req.method === 'POST' && action === 'welcome') {
        return user.email ? ok() : fail(400, 101, 'Email address not available');
      }
      if (req.method === 'PUT' && !action) {
        const key = req.form.get('key');
        const value = req.form.get('value') ?? '';
        if (key === 'displayname') user.displayname = value || user.displayname;
        else if (key === 'email') user.email = value || null;
        else if (key === 'quota') user.quota = Number(value);
        else if (key === 'password') {
          if (value.length < 10) return fail(400, 107, `Password "${value}" is too short`);
        } else return fail(400, 113, '');
        return ok();
      }
    }
    if (req.method === 'GET' && path === '/cloud/groups') {
      const search = (req.query.get('search') ?? '').toLowerCase();
      return ok({ groups: [...this.groups].filter((g) => g.toLowerCase().includes(search)) });
    }
    if (req.method === 'POST' && path === '/cloud/groups') {
      const id = req.form.get('groupid')!;
      if (this.groups.has(id)) return fail(400, 102, 'group exists');
      this.groups.add(id);
      return ok();
    }
    return undefined;
  };
}

let nc: MockNextcloud;
let mock: Awaited<ReturnType<typeof startMockServer>>;

beforeAll(async () => {
  mock = await startMockServer((req) => nc.handle(req));
});
afterAll(async () => {
  await mock.close();
});
beforeEach(() => {
  nc = new MockNextcloud();
  mock.requests.length = 0;
});

const demoAdapter = () => new DemoAdapter('demo-quota-test', {});

function adapter(extra: { groupPrefix?: string; baseUrl?: string; appPassword?: string } = {}) {
  return new NextcloudAdapter({
    baseUrl: extra.baseUrl ?? `${mock.url}/`,
    username: USER,
    appPassword: extra.appPassword ?? APP_PASSWORD,
    ...(extra.groupPrefix ? { groupPrefix: extra.groupPrefix } : {}),
  });
}

/** Requests that changed something, as "METHOD path". */
const writes = () =>
  mock.requests.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path.slice(OCS.length)}`);

async function caught(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return err as AppError;
  }
  throw new Error('expected an error');
}

const input = (over: Partial<CloudAccountInput> = {}): CloudAccountInput => ({
  username: 'anna@muster-ag',
  password: 'Str0ng-and-l0ng-enough',
  displayName: 'Anna Muster',
  email: 'anna@muster.example',
  quotaBytes: 10 * GiB,
  groups: ['weblion-muster-ag'],
  language: 'de',
  ...over,
});

// ---------------------------------------------------------------------------

describe('Nextcloud parsing', () => {
  it('reads quotas in bytes, negative or "none" as unlimited', () => {
    expect(parseQuota(21474836480)).toBe(20 * GiB);
    expect(parseQuota('5368709120')).toBe(5 * GiB);
    expect(parseQuota(-3)).toBeNull();
    expect(parseQuota(-1)).toBeNull();
    expect(parseQuota('none')).toBeNull();
    expect(parseQuota('5 GB')).toBe(5 * GiB);
    expect(parseQuota(undefined)).toBeNull();
    expect(parseHumanSize('1.5 TB')).toBe(1.5 * 1024 ** 4);
    expect(parseHumanSize('512 MB')).toBe(512 * 1024 ** 2);
    expect(parseHumanSize('lots')).toBeNull();
  });

  it('parses a user with usage, last login and groups', () => {
    const user = parseCloudUser({
      id: 'anna@muster-ag',
      enabled: false,
      lastLogin: 1578283711000,
      quota: { free: 1, used: 842011482, total: 21474836480, relative: 3.92, quota: 21474836480 },
      email: '',
      displayname: 'Anna Muster',
      groups: { 0: 'weblion-muster-ag', 2: 'team' },
    });
    expect(user).toEqual({
      externalId: 'anna@muster-ag',
      displayName: 'Anna Muster',
      email: null,
      quotaBytes: 20 * GiB,
      usedBytes: 842011482,
      enabled: false,
      lastLoginAt: '2020-01-06T04:08:31.000Z',
      groups: ['weblion-muster-ag', 'team'],
    });
  });

  it('handles users that never logged in and missing storage info', () => {
    // No home folder yet: Nextcloud answers {quota: <bytes> | "none", used: 0}.
    expect(parseCloudUser({ id: 'new', lastLogin: 0, quota: { quota: 'none', used: 0 } })).toMatchObject({
      quotaBytes: null,
      usedBytes: 0,
      lastLoginAt: null,
      enabled: true,
      displayName: null,
    });
    // Storage lookup failed: an empty quota object.
    expect(parseCloudUser({ id: 'x', quota: [] })).toMatchObject({ quotaBytes: null, usedBytes: null });
  });

  it('reads users/details as map or list', () => {
    const map = parseUsersDetails({ users: { 'a@x': { id: 'a@x' }, 'b@x': { enabled: true } } });
    expect(map.count).toBe(2);
    expect(map.users.map((u) => u.externalId)).toEqual(['a@x', 'b@x']);
    // Numeric user ids turn the PHP map into a JSON list.
    const list = parseUsersDetails({ users: [{ id: '0' }, { id: '1' }] });
    expect(list.users.map((u) => u.externalId)).toEqual(['0', '1']);
    expect(parseUsersDetails([]).count).toBe(0);
  });

  it('validates login names like Nextcloud', () => {
    for (const ok of ['anna@muster-ag', 'max.muster@baeckerei-huber', "o'neil", 'a b', 'A_1']) {
      expect(isValidUserId(ok)).toBe(true);
    }
    for (const bad of ['', '.', '..', 'a/b', ' anna', 'anna ', 'ä@x', 'a%40b', 'x'.repeat(65), 'a\\b']) {
      expect(isValidUserId(bad)).toBe(false);
    }
  });

  it('maps languages to Nextcloud codes', () => {
    expect(nextcloudLanguage('de')).toBe('de');
    expect(nextcloudLanguage('de-CH')).toBe('de');
    expect(nextcloudLanguage('de_DE')).toBe('de_DE');
    expect(nextcloudLanguage('EN')).toBe('en');
    expect(nextcloudLanguage('klingon!')).toBeNull();
    expect(nextcloudLanguage(undefined)).toBeNull();
  });

  it('encodes arrays as PHP form arrays', () => {
    expect(toForm({ userid: 'a@b', groups: ['g1', 'g2'], skip: undefined, flag: true }).toString()).toBe(
      'userid=a%40b&groups%5B%5D=g1&groups%5B%5D=g2&flag=true',
    );
  });

  it('redacts password-like values', () => {
    expect(
      redactPasswords({ apppassword: 'abc', nested: [{ password: 'x', name: 'n' }], token: '', other: 1 }),
    ).toEqual({ apppassword: '••••••', nested: [{ password: '••••••', name: 'n' }], token: '', other: 1 });
  });
});

describe('Nextcloud client', () => {
  it('sends Basic auth, the OCS header and asks for JSON on the v2 API', async () => {
    const client = new NextcloudClient({
      baseUrl: `${mock.url}//`,
      username: USER,
      appPassword: APP_PASSWORD,
    });
    const data = await client.ocs<{ version: { string: string } }>('GET', '/cloud/capabilities');
    expect(data.version.string).toBe('31.0.4');
    const req = mock.requests[0]!;
    expect(req.path).toBe('/ocs/v2.php/cloud/capabilities');
    expect(req.query.get('format')).toBe('json');
    expect(req.headers.authorization).toBe(AUTH);
    expect(req.headers['ocs-apirequest']).toBe('true');
    expect(req.headers.accept).toBe('application/json');
    expect(client.baseUrl).toBe(mock.url);
  });

  it('maps OCS failures with message and status code', async () => {
    nc.override = () => fail(400, 102, 'User already exists');
    const err = await caught(adapter().getCloudAccount('anna@muster-ag'));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toBe(
      'Nextcloud: read user anna@muster-ag failed: User already exists (OCS 102, HTTP 400)',
    );
    expect(ocsStatus(err)).toBe(102);
    expect((err as ProviderError).upstreamStatus).toBe(400);
    expect(err.statusCode).toBe(502);
  });

  it('treats a v1 style failure inside HTTP 200 as an error', async () => {
    nc.override = () => ({
      status: 200,
      body: { ocs: { meta: { status: 'failure', statuscode: 997, message: 'Unauthorised' }, data: [] } },
    });
    const err = await caught(adapter().getCloudAccount('anna@muster-ag'));
    expect(err.message).toContain('Unauthorised (OCS 997, HTTP 200)');
  });

  it('never leaks the app password, even when Nextcloud echoes it', async () => {
    nc.override = () => fail(500, 996, `secret was ${APP_PASSWORD} / ${AUTH}`);
    const err = await caught(adapter().listCloudAccounts());
    expect(err.message).not.toContain(APP_PASSWORD);
    expect(err.message).not.toContain(AUTH.slice(6));
    expect(err.message).toContain('[redacted]');
  });

  it('explains a wrong app password and a missing admin right', async () => {
    const wrong = await caught(adapter({ appPassword: 'not-the-right-one' }).listCloudAccounts());
    expect(wrong.message).toContain('Current user is not logged in (OCS 401, HTTP 401)');
    expect(wrong.message).toContain('app password');
    expect(wrong.message).not.toContain('not-the-right-one');

    nc.override = () => fail(403, 403, 'Logged in account must be an admin');
    const forbidden = await caught(adapter().listCloudAccounts());
    expect(forbidden.message).toContain(`"${USER}" must be a Nextcloud admin`);
  });

  it('reports answers without OCS envelope and network failures', async () => {
    nc.override = () => ({ status: 502, body: '<html>Bad Gateway</html>' });
    const html = await caught(adapter().listCloudAccounts());
    expect(html.message).toBe('Nextcloud: list users failed: no OCS answer (HTTP 502)');

    nc.override = () => ({ status: 200, body: { hello: 'world' } });
    const plain = await caught(adapter().listCloudAccounts());
    expect(plain.message).toBe('Nextcloud: list users failed: no OCS answer, check the base URL (HTTP 200)');

    const closed = new NextcloudAdapter({
      baseUrl: 'http://127.0.0.1:1',
      username: USER,
      appPassword: APP_PASSWORD,
    });
    const network = await caught(closed.listCloudAccounts());
    expect(network).toBeInstanceOf(ProviderError);
    expect(network.message).toMatch(/^Nextcloud: list users failed: /);
    expect(network.message).not.toContain(APP_PASSWORD);
  });

  it('keeps at most 4 requests in flight', async () => {
    let active = 0;
    let peak = 0;
    const server: Server = createServer((_req, res) => {
      active++;
      peak = Math.max(peak, active);
      setTimeout(() => {
        active--;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ocs: { meta: { status: 'ok', statuscode: 200 }, data: [] } }));
      }, 40);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const client = new NextcloudClient({
        baseUrl: `http://127.0.0.1:${port}`,
        username: USER,
        appPassword: APP_PASSWORD,
      });
      await Promise.all(Array.from({ length: 10 }, () => client.ocs('GET', '/cloud/capabilities')));
      expect(peak).toBe(4);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('Nextcloud connection', () => {
  it('tests the connection: version, admin account, user count', async () => {
    nc.add({ id: 'anna@muster-ag' });
    expect(await adapter().testConnection()).toEqual({ version: '31.0.4', user: USER, users: 2 });
  });

  it('refuses an account that is not an admin', async () => {
    nc.users.get(USER)!.groups = ['everyone'];
    const err = await caught(adapter().testConnection());
    expect(err.message).toContain(`"${USER}" is not a Nextcloud admin`);
  });

  it('has no servers', async () => {
    const a = adapter();
    expect(a.capabilities()).toEqual([]);
    expect(a.powerActions()).toEqual([]);
    expect(await a.listServers()).toEqual([]);
    const err = await caught(a.getServer({ externalId: 'x', kind: 'vm', node: null, meta: {} }));
    expect(err.statusCode).toBe(404);
    expect(a.cloudLoginUrl()).toBe(mock.url);
  });

  it('summarizes the instance with the groups of the prefix', async () => {
    nc.groups.add('weblion-muster-ag').add('weblion-baeckerei-huber').add('team-weblion-x');
    const overview = await adapter().overview();
    expect(overview.version).toBe('31.0.4');
    expect(overview.facts).toEqual([
      { label: 'Version', value: '31.0.4' },
      { label: 'Users', value: '1' },
      { label: 'Groups weblion-*', value: '2' },
      { label: 'Login', value: mock.url },
    ]);
    const custom = await adapter({ groupPrefix: 'team-' }).overview();
    expect(custom.facts[2]).toEqual({ label: 'Groups team-*', value: '1' });
  });
});

describe('Nextcloud accounts', () => {
  it('lists every user in pages of 100 with quota and usage', async () => {
    for (let i = 0; i < 229; i++) nc.add({ id: `user${String(i).padStart(3, '0')}@muster-ag`, used: i });
    nc.add({ id: 'unlimited', quota: -3, used: 7 * GiB, lastLogin: 1759917600000, enabled: false });
    const users = await adapter().listCloudAccounts();
    expect(users).toHaveLength(231);
    const pages = mock.requests.filter((r) => r.path === `${OCS}/cloud/users/details`);
    expect(pages.map((r) => [r.query.get('limit'), r.query.get('offset')])).toEqual([
      ['100', '0'],
      ['100', '100'],
      ['100', '200'],
    ]);
    expect(users.find((u) => u.externalId === 'user005@muster-ag')).toMatchObject({
      quotaBytes: 5 * GiB,
      usedBytes: 5,
      enabled: true,
      lastLoginAt: null,
    });
    expect(users.find((u) => u.externalId === 'unlimited')).toMatchObject({
      quotaBytes: null,
      usedBytes: 7 * GiB,
      enabled: false,
      lastLoginAt: '2025-10-08T10:00:00.000Z',
    });
  });

  it('stops after a full last page that is followed by an empty one', async () => {
    for (let i = 0; i < 99; i++) nc.add({ id: `u${i}` });
    expect(await adapter().listCloudAccounts()).toHaveLength(100);
    expect(mock.requests.filter((r) => r.path === `${OCS}/cloud/users/details`)).toHaveLength(2);
  });

  it('reads one user with the id URL-encoded', async () => {
    nc.add({ id: 'anna@muster-ag', displayname: 'Anna', email: 'anna@muster.example', used: 3 * GiB });
    const user = await adapter().getCloudAccount('anna@muster-ag');
    expect(mock.requests[0]!.path).toBe('/ocs/v2.php/cloud/users/anna%40muster-ag');
    expect(user).toMatchObject({ externalId: 'anna@muster-ag', displayName: 'Anna', usedBytes: 3 * GiB });

    const missing = await caught(adapter().getCloudAccount('nobody@muster-ag'));
    expect(missing.statusCode).toBe(404);
    expect(missing.message).toContain('User does not exist');
  });

  it('refuses invalid user ids before sending anything', async () => {
    for (const id of ['../admin', 'a/b', ' anna', '..', 'anna%40x']) {
      const err = await caught(adapter().getCloudAccount(id));
      expect(err.statusCode).toBe(400);
    }
    await caught(adapter().deleteCloudAccount('x/../../admin'));
    expect(mock.requests).toHaveLength(0);
  });

  it('creates a user in its group, creating a missing group first', async () => {
    const created = await adapter().createCloudAccount(input());
    expect(writes()).toEqual(['POST /cloud/groups', 'POST /cloud/users']);
    const group = mock.requests.find((r) => r.method === 'POST' && r.path === `${OCS}/cloud/groups`)!;
    expect(group.form.get('groupid')).toBe('weblion-muster-ag');
    const post = mock.requests.find((r) => r.method === 'POST' && r.path === `${OCS}/cloud/users`)!;
    expect(Object.fromEntries(post.form)).toEqual({
      userid: 'anna@muster-ag',
      password: 'Str0ng-and-l0ng-enough',
      displayName: 'Anna Muster',
      email: 'anna@muster.example',
      'groups[]': 'weblion-muster-ag',
      quota: String(10 * GiB),
      language: 'de',
    });
    expect(post.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(created).toMatchObject({
      externalId: 'anna@muster-ag',
      displayName: 'Anna Muster',
      email: 'anna@muster.example',
      quotaBytes: 10 * GiB,
      usedBytes: 0,
      groups: ['weblion-muster-ag'],
    });
    // The returned account is read back from Nextcloud.
    expect(mock.requests.at(-1)!.method).toBe('GET');
    expect(mock.requests.at(-1)!.path).toBe('/ocs/v2.php/cloud/users/anna%40muster-ag');
  });

  it('does not recreate an existing group', async () => {
    nc.groups.add('weblion-muster-ag');
    nc.groups.add('weblion-muster-ag-old');
    await adapter().createCloudAccount(input({ groups: ['weblion-muster-ag', 'weblion-muster-ag'] }));
    expect(writes()).toEqual(['POST /cloud/users']);
    const lookup = mock.requests.find((r) => r.path === `${OCS}/cloud/groups`)!;
    expect(lookup.query.get('search')).toBe('weblion-muster-ag');
  });

  it('accepts a group another request created meanwhile', async () => {
    nc.override = (req) =>
      req.method === 'GET' && req.path === `${OCS}/cloud/groups` ? ok({ groups: [] }) : undefined;
    nc.groups.add('weblion-muster-ag');
    await adapter().createCloudAccount(input());
    expect(writes()).toEqual(['POST /cloud/groups', 'POST /cloud/users']);
    expect(nc.users.has('anna@muster-ag')).toBe(true);
  });

  it('invites by e-mail without a password, and needs the address for it', async () => {
    await adapter().createCloudAccount(input({ password: undefined }));
    const post = mock.requests.find((r) => r.method === 'POST' && r.path === `${OCS}/cloud/users`)!;
    expect(post.form.has('password')).toBe(false);
    expect(post.form.get('email')).toBe('anna@muster.example');

    mock.requests.length = 0;
    const err = await caught(
      adapter().createCloudAccount(input({ username: 'ben@muster-ag', password: undefined, email: null })),
    );
    expect(err.statusCode).toBe(400);
    expect(mock.requests).toHaveLength(0);
  });

  it('validates quota, names and language before creating', async () => {
    expect((await caught(adapter().createCloudAccount(input({ quotaBytes: 1024 })))).statusCode).toBe(400);
    expect((await caught(adapter().createCloudAccount(input({ quotaBytes: GiB + 0.5 })))).statusCode).toBe(
      400,
    );
    expect((await caught(adapter().createCloudAccount(input({ username: 'a/b' })))).statusCode).toBe(400);
    expect((await caught(adapter().createCloudAccount(input({ groups: ['a/b'] })))).statusCode).toBe(400);
    expect((await caught(adapter().createCloudAccount(input({ email: 'no-mail' })))).statusCode).toBe(400);
    expect(
      (await caught(adapter().createCloudAccount(input({ displayName: 'x'.repeat(65) })))).statusCode,
    ).toBe(400);
    expect(mock.requests).toHaveLength(0);

    await adapter().createCloudAccount(input({ language: 'de-CH', quotaBytes: CLOUD_MIN_QUOTA_BYTES }));
    const post = mock.requests.find((r) => r.method === 'POST' && r.path === `${OCS}/cloud/users`)!;
    expect(post.form.get('language')).toBe('de');
    expect(post.form.get('quota')).toBe(String(GiB));
  });

  it('only sends quotas Nextcloud stores exactly', async () => {
    // Nextcloud keeps a quota as "<size> GB/TB" with one decimal: 2000 GB would read back as
    // "2 TB" = 2048 GB, 1025 GB as 1024 GB. Whole GB below 1024 GB and steps of 512 GB are exact.
    for (const gb of [1025, 1100, 1500, 2000]) {
      const err = await caught(adapter().createCloudAccount(input({ quotaBytes: gb * GiB })));
      expect(err.statusCode, String(gb)).toBe(400);
      const edit = await caught(adapter().updateCloudAccount('anna@muster-ag', { quotaBytes: gb * GiB }));
      expect(edit.statusCode, String(gb)).toBe(400);
    }
    expect((await caught(adapter().createCloudAccount(input({ quotaBytes: 1.5 * GiB })))).statusCode).toBe(
      400,
    );
    expect(mock.requests).toHaveLength(0);
    for (const gb of [1023, 1024, 1536, 2048]) {
      await adapter().createCloudAccount(input({ username: `u${gb}@muster-ag`, quotaBytes: gb * GiB }));
    }
    expect(
      (await caught(demoAdapter().createCloudAccount(input({ username: 'x', quotaBytes: 2000 * GiB }))))
        .statusCode,
    ).toBe(400);
  });

  it('keeps a created user when only reading it back fails', async () => {
    nc.override = (req) =>
      req.method === 'GET' &&
      req.path === `${OCS}/cloud/users/anna%40muster-ag` &&
      nc.users.has('anna@muster-ag')
        ? { status: 503, body: '<html>Service Unavailable</html>' }
        : undefined;
    const created = await adapter().createCloudAccount(input({ password: undefined }));
    expect(created).toEqual({
      externalId: 'anna@muster-ag',
      displayName: 'Anna Muster',
      email: 'anna@muster.example',
      quotaBytes: 10 * GiB,
      usedBytes: 0,
      enabled: true,
      lastLoginAt: null,
      groups: ['weblion-muster-ag'],
    });
    expect(nc.users.has('anna@muster-ag')).toBe(true);
    expect(writes()).toEqual(['POST /cloud/groups', 'POST /cloud/users']);
  });

  it('answers 409 for an existing user', async () => {
    nc.add({ id: 'anna@muster-ag' });
    const err = await caught(adapter().createCloudAccount(input()));
    expect(err.statusCode).toBe(409);
    expect(writes()).toEqual([]);

    // Created by someone else between the check and the request.
    nc.users.delete('anna@muster-ag');
    nc.override = (req) =>
      req.method === 'POST' && req.path === `${OCS}/cloud/users`
        ? fail(400, 102, 'User already exists')
        : undefined;
    const race = await caught(adapter().createCloudAccount(input()));
    expect(race.statusCode).toBe(409);
    expect(writes()).not.toContain('DELETE /cloud/users/anna%40muster-ag');
  });

  it('removes a half-created user when a later step fails, without leaking the password', async () => {
    nc.override = (req) => {
      if (req.method !== 'POST' || req.path !== `${OCS}/cloud/users`) return undefined;
      // Nextcloud created the user, then failed setting the quota.
      nc.add({ id: req.form.get('userid')! });
      return fail(400, 101, `Invalid quota value. Exceeding the maximum quota (${req.form.get('password')})`);
    };
    const err = await caught(adapter().createCloudAccount(input()));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toContain('create user anna@muster-ag failed: Invalid quota value');
    expect(err.message).not.toContain('Str0ng-and-l0ng-enough');
    expect(writes()).toEqual([
      'POST /cloud/groups',
      'POST /cloud/users',
      'DELETE /cloud/users/anna%40muster-ag',
    ]);
    expect(nc.users.has('anna@muster-ag')).toBe(false);
  });

  it('updates name, e-mail and quota field by field, then the state', async () => {
    const user = nc.add({ id: 'anna@muster-ag', displayname: 'Anna', email: 'old@muster.example' });
    await adapter().updateCloudAccount('anna@muster-ag', {
      displayName: 'Anna Muster',
      email: 'Anna@Muster.example',
      quotaBytes: 20 * GiB,
      enabled: false,
    });
    expect(writes()).toEqual([
      'PUT /cloud/users/anna%40muster-ag',
      'PUT /cloud/users/anna%40muster-ag',
      'PUT /cloud/users/anna%40muster-ag',
      'PUT /cloud/users/anna%40muster-ag/disable',
    ]);
    expect(mock.requests.slice(0, 3).map((r) => Object.fromEntries(r.form))).toEqual([
      { key: 'displayname', value: 'Anna Muster' },
      { key: 'email', value: 'anna@muster.example' },
      { key: 'quota', value: String(20 * GiB) },
    ]);
    expect(user).toMatchObject({ displayname: 'Anna Muster', email: 'anna@muster.example', enabled: false });
    expect(user.quota).toBe(20 * GiB);

    mock.requests.length = 0;
    await adapter().updateCloudAccount('anna@muster-ag', { enabled: true, email: null, displayName: null });
    expect(writes()).toEqual([
      'PUT /cloud/users/anna%40muster-ag',
      'PUT /cloud/users/anna%40muster-ag',
      'PUT /cloud/users/anna%40muster-ag/enable',
    ]);
    // Without a display name Nextcloud shows the user id; an empty e-mail clears it.
    expect(mock.requests.slice(0, 2).map((r) => Object.fromEntries(r.form))).toEqual([
      { key: 'displayname', value: 'anna@muster-ag' },
      { key: 'email', value: '' },
    ]);
    expect(user.enabled).toBe(true);
    expect(user.email).toBeNull();
  });

  it('checks the whole change before sending any of it', async () => {
    nc.add({ id: 'anna@muster-ag' });
    const err = await caught(
      adapter().updateCloudAccount('anna@muster-ag', { displayName: 'Anna', quotaBytes: 100 }),
    );
    expect(err.statusCode).toBe(400);
    expect(mock.requests).toHaveLength(0);
  });

  it('maps a field Nextcloud refuses without message', async () => {
    nc.add({ id: 'anna@muster-ag' });
    nc.override = (req) => (req.method === 'PUT' ? fail(400, 113, '') : undefined);
    const err = await caught(adapter().updateCloudAccount('anna@muster-ag', { email: 'a@b.ch' }));
    expect(err.message).toBe(
      'Nextcloud: change email of anna@muster-ag failed: This field cannot be edited (OCS 113, HTTP 400)',
    );
  });

  it('sets a password without it ever appearing in an error', async () => {
    nc.add({ id: 'anna@muster-ag' });
    await adapter().setCloudAccountPassword('anna@muster-ag', 'N3w-Passw0rd-long');
    const put = mock.requests[0]!;
    expect(put.method).toBe('PUT');
    expect(put.path).toBe('/ocs/v2.php/cloud/users/anna%40muster-ag');
    expect(Object.fromEntries(put.form)).toEqual({ key: 'password', value: 'N3w-Passw0rd-long' });

    const err = await caught(adapter().setCloudAccountPassword('anna@muster-ag', 'short-pw'));
    expect(ocsStatus(err)).toBe(107);
    expect(err.message).toContain('is too short');
    expect(err.message).not.toContain('short-pw');
  });

  it('deletes a user and reports a missing one as 404', async () => {
    nc.add({ id: 'anna@muster-ag' });
    await adapter().deleteCloudAccount('anna@muster-ag');
    expect(writes()).toEqual(['DELETE /cloud/users/anna%40muster-ag']);
    expect(nc.users.has('anna@muster-ag')).toBe(false);

    const again = await caught(adapter().deleteCloudAccount('anna@muster-ag'));
    expect(again.statusCode).toBe(404);

    const self = await caught(adapter().deleteCloudAccount(USER));
    expect(self.message).toContain('cannot delete itself');
  });

  it('resends the welcome mail', async () => {
    nc.add({ id: 'anna@muster-ag', email: 'anna@muster.example' });
    nc.add({ id: 'ben@muster-ag' });
    await adapter().resendCloudInvite('anna@muster-ag');
    expect(writes()).toEqual(['POST /cloud/users/anna%40muster-ag/welcome']);
    const err = await caught(adapter().resendCloudInvite('ben@muster-ag'));
    expect(err.message).toContain('Email address not available (OCS 101, HTTP 400)');
  });
});

describe('Nextcloud API explorer', () => {
  it('sends OCS requests with query and form, with or without the base URL', async () => {
    nc.add({ id: 'anna@muster-ag' });
    const a = adapter();
    const list = await a.rawRequest('GET', '/ocs/v2.php/cloud/users?search=anna', { limit: 5 });
    expect(list.status).toBe(200);
    expect(mock.requests[0]!.query.get('search')).toBe('anna');
    expect(mock.requests[0]!.query.get('limit')).toBe('5');
    expect(mock.requests[0]!.query.get('format')).toBe('json');

    await a.rawRequest('POST', `${mock.url}/ocs/v2.php/cloud/groups`, { groupid: 'team' });
    expect(mock.requests[1]!.form.get('groupid')).toBe('team');
    expect(nc.groups.has('team')).toBe(true);

    const failed = await a.rawRequest('GET', 'ocs/v2.php/cloud/users/nobody');
    expect(failed.status).toBe(404);
  });

  it('only allows OCS paths on the instance', async () => {
    const a = adapter();
    for (const path of [
      '/index.php/settings/users',
      '/remote.php/dav/files/admin',
      '/ocs/v2.php/../index.php',
      '/ocs/v2.php/cloud/%2e%2e/x',
      '//evil.example/ocs/v2.php/cloud/users',
      '/ocs/v2.php/core/apppassword',
      '/ocs/v2.php/core/getapppassword',
      'https://evil.example/ocs/v2.php/cloud/users',
    ]) {
      const err = await caught(a.rawRequest('GET', path));
      expect(err.statusCode).toBe(400);
    }
    await caught(a.rawRequest('PATCH', '/ocs/v2.php/cloud/users'));
    expect(mock.requests).toHaveLength(0);
  });

  it('blanks out password values in answers', async () => {
    nc.override = () => ok({ apppassword: 'leaked-app-password', user: { id: 'x', password: 'pw' } });
    const res = await adapter().rawRequest('GET', '/ocs/v2.php/cloud/whatever');
    expect(res.data).toEqual({
      ocs: {
        meta: { status: 'ok', statuscode: 200, message: 'OK' },
        data: { apppassword: '••••••', user: { id: 'x', password: '••••••' } },
      },
    });
  });
});

// ---------------------------------------------------------------------------

describe('Demo cloud', () => {
  beforeEach(() => DemoAdapter.reset());
  afterEach(() => DemoAdapter.reset());

  const demo = () => new DemoAdapter('demo-cloud-test', {});

  it('starts with users of the demo orgs and an unmanaged admin', async () => {
    const users = await demo().listCloudAccounts();
    const ids = users.map((u) => u.externalId);
    expect(ids).toEqual(expect.arrayContaining(['admin', 'anna@muster-ag', 'hanna@baeckerei-huber']));
    const anna = users.find((u) => u.externalId === 'anna@muster-ag')!;
    expect(anna).toMatchObject({ quotaBytes: 50 * GiB, enabled: true, groups: ['weblion-muster-ag'] });
    expect(anna.usedBytes).toBeGreaterThan(0);
    expect(anna.lastLoginAt).not.toBeNull();
    expect(users.find((u) => u.externalId === 'admin')).toMatchObject({
      quotaBytes: null,
      groups: ['admin'],
    });
    expect(demo().cloudLoginUrl()).toBe(DEMO_CLOUD_URL);
  });

  it('creates, changes and deletes accounts, kept across adapter instances', async () => {
    const created = await demo().createCloudAccount(input({ username: 'carla@muster-ag' }));
    expect(created).toMatchObject({ externalId: 'carla@muster-ag', quotaBytes: 10 * GiB, usedBytes: 0 });
    expect(new DemoCloud(demoCloudState('demo-cloud-test')).invitesSent('carla@muster-ag')).toBe(1);

    await demo().updateCloudAccount('carla@muster-ag', {
      quotaBytes: 2 * GiB,
      enabled: false,
      displayName: null,
    });
    expect(await demo().getCloudAccount('carla@muster-ag')).toMatchObject({
      quotaBytes: 2 * GiB,
      enabled: false,
      displayName: 'carla@muster-ag',
    });
    await demo().setCloudAccountPassword('carla@muster-ag', 'An0ther-long-pw');
    await demo().resendCloudInvite('carla@muster-ag');
    expect(new DemoCloud(demoCloudState('demo-cloud-test')).invitesSent('carla@muster-ag')).toBe(2);

    await demo().deleteCloudAccount('carla@muster-ag');
    expect((await caught(demo().getCloudAccount('carla@muster-ag'))).statusCode).toBe(404);
  });

  it('validates like Nextcloud', async () => {
    const d = demo();
    expect((await caught(d.createCloudAccount(input({ username: 'Anna@Muster-AG' })))).statusCode).toBe(409);
    expect((await caught(d.createCloudAccount(input({ username: 'x', quotaBytes: 100 })))).statusCode).toBe(
      400,
    );
    expect((await caught(d.createCloudAccount(input({ username: 'a/b' })))).statusCode).toBe(400);
    expect(
      (await caught(d.createCloudAccount(input({ username: 'x', password: undefined, email: null }))))
        .statusCode,
    ).toBe(400);
    expect((await caught(d.createCloudAccount(input({ username: 'x', password: 'short' })))).statusCode).toBe(
      400,
    );
    expect(await caught(d.setCloudAccountPassword('anna@muster-ag', 'short'))).toBeInstanceOf(AppError);
    expect(await caught(d.updateCloudAccount('anna@muster-ag', { quotaBytes: 5 }))).toBeInstanceOf(AppError);
    expect((await caught(d.resendCloudInvite('buchhaltung@muster-ag'))).message).toBe(
      'Email address not available',
    );
    expect((await caught(d.deleteCloudAccount('admin'))).statusCode).toBe(400);
    expect((await caught(d.updateCloudAccount('admin', { enabled: false }))).statusCode).toBe(400);
    // A quota below the usage is accepted, like at Nextcloud.
    await d.updateCloudAccount('anna@muster-ag', { quotaBytes: GiB });
    expect((await d.getCloudAccount('anna@muster-ag')).quotaBytes).toBe(GiB);
  });

  it('forgets everything on reset', async () => {
    await demo().deleteCloudAccount('anna@muster-ag');
    DemoAdapter.reset();
    expect((await demo().getCloudAccount('anna@muster-ag')).externalId).toBe('anna@muster-ag');
  });
});
