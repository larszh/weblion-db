import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  DEFAULT_CUSTOMER_BOUNDARY,
  DEFAULT_RESELLER_BOUNDARY,
  MEDIA_PASSWORD_ALPHABET,
  expectedMediaPolicy,
  type MediaAccess,
  type MediaAccountDto,
  type MediaAccountSecretDto,
  type MediaAllowanceChangeResult,
  type MediaAllowanceDto,
  type MediaInstanceDto,
  type MediaLibraryRef,
  type MediaPolicyState,
  type ModuleKey,
  type OrgKind,
  type OrgMediaDto,
  type UnmanagedMediaUserDto,
} from '@weblion/shared';
import type { MediaSyncCounts } from '../src/jobs/sync-media';
import {
  auditLogs,
  mediaAccounts,
  mediaAllowances,
  memberships,
  organizations,
  providerConnections,
  users,
  type ProviderConnection,
} from '../src/db/schema';
import { hashPassword } from '../src/lib/crypto';
import { ProviderError } from '../src/lib/errors';
import { configSummary, redactExplorerBody, redactExplorerPath } from '../src/modules/admin/routes';
import { generateMediaPassword } from '../src/modules/media/service';
import { DemoAdapter } from '../src/providers/demo/adapter';
import {
  DEMO_MEDIA_IDS,
  DEMO_MEDIA_LIBRARIES,
  DEMO_MEDIA_URL,
  DemoMedia,
  demoMediaState,
  jellyfinDefaultPolicy,
} from '../src/providers/demo/media';
import { ADMIN, Client, createTestApp, DEMO_PASSWORD, json, type TestApp } from './helpers';

let t: TestApp;
let admin: Client;
let anna: Client;
let carla: Client;
let dev: Client;
let reto: Client;
let hanna: Client;
let support: Client;
/** A read_write API token of Muster AG. */
let bot: Client;
let demo: ProviderConnection;
/** A second, empty demo instance (allowances and accounts never mix with the first). */
let second: ProviderConnection;
/** A third demo instance for the repair limit. */
let crowded: ProviderConnection;
let musterId: string;
let beispielId: string;
let alpenId: string;
let huberId: string;

/** Library ids of the demo instances by name. */
const LIB = Object.fromEntries(DEMO_MEDIA_LIBRARIES.map((l) => [l.name, l.id])) as Record<string, string>;
const MUSTER_ACCESS: MediaAccess = {
  libraryIds: [LIB.Filme!, LIB.Serien!, LIB.Kinder!],
  maxStreams: 2,
  downloads: false,
  remoteBitrateMbit: 8,
};
const HUBER_ACCESS: MediaAccess = {
  libraryIds: [LIB.Filme!, LIB.Kinder!],
  maxStreams: 2,
  downloads: false,
  remoteBitrateMbit: 15,
};
const ALPEN_ACCESS: MediaAccess = {
  libraryIds: [LIB.Filme!, LIB.Serien!, LIB.Kinder!, LIB.Musik!],
  maxStreams: 3,
  downloads: true,
  remoteBitrateMbit: 20,
};
const GENERATED = new RegExp(`^[${MEDIA_PASSWORD_ALPHABET}]{16}$`);

const put = (client: Client, url: string, body: unknown) => client.request('PUT', url, body);
/** Lets the clock move on, so a sync never starts in the millisecond of the last change. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

const musterBody = (overrides: object = {}) => ({
  providerId: demo.id,
  maxAccounts: 5,
  ...MUSTER_ACCESS,
  ...overrides,
});

async function orgBySlug(slug: string) {
  return (await t.db.query.organizations.findFirst({ where: eq(organizations.slug, slug) }))!;
}

async function setModules(orgId: string, modules: ModuleKey[]) {
  await t.db.update(organizations).set({ modules }).where(eq(organizations.id, orgId));
}

async function modulesOf(orgId: string) {
  return (await t.db.query.organizations.findFirst({ where: eq(organizations.id, orgId) }))!.modules;
}

async function auditEntries(action: string, resourceId?: string) {
  return t.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, action), resourceId ? eq(auditLogs.resourceId, resourceId) : undefined))
    .orderBy(auditLogs.id);
}

async function stored(username: string, connectionId = demo.id) {
  return t.db.query.mediaAccounts.findFirst({
    where: and(eq(mediaAccounts.username, username), eq(mediaAccounts.providerConnectionId, connectionId)),
  });
}

async function accountId(username: string) {
  return (await stored(username))!.id;
}

async function allowanceOf(orgId: string) {
  return t.db.query.mediaAllowances.findFirst({ where: eq(mediaAllowances.orgId, orgId) });
}

const demoUsers = (connectionId = demo.id) => demoMediaState(connectionId).users;

function demoUser(username: string, connectionId = demo.id) {
  return [...demoUsers(connectionId).values()].find((u) => u.username === username);
}

/** A user created in Jellyfin directly (no row in the console). */
function jellyfinOnly(username: string, connectionId = demo.id) {
  return new DemoMedia(demoMediaState(connectionId)).createMediaUser({
    username,
    password: 'direkt-angelegt-1',
    policy: jellyfinDefaultPolicy(),
  });
}

async function sync(connectionId = demo.id): Promise<MediaSyncCounts> {
  await tick();
  const res = await admin.post(`/admin/providers/${connectionId}/sync`);
  expect(res.statusCode, res.body).toBe(200);
  return json(res).mediaAccounts;
}

async function orgMedia(client: Client, orgId: string) {
  const res = await client.get(`/orgs/${orgId}/media`);
  expect(res.statusCode, res.body).toBe(200);
  return json<OrgMediaDto>(res);
}

const create = (client: Client, orgId: string, body: Record<string, unknown>) =>
  client.post(`/orgs/${orgId}/media/accounts`, body);

async function created(client: Client, orgId: string, body: Record<string, unknown>) {
  const res = await create(client, orgId, body);
  expect(res.statusCode, res.body).toBe(200);
  return json<MediaAccountSecretDto>(res);
}

const remove = (client: Client, id: string, confirm: string) =>
  client.del(`/media/accounts/${id}`, { confirm });

/** Signs in a new user, optionally as member of an organization. */
async function newUser(
  email: string,
  options: { platformRole?: 'support'; orgId?: string; role?: 'owner' | 'member' | 'viewer' } = {},
): Promise<Client> {
  const [user] = await t.db
    .insert(users)
    .values({
      email,
      name: email.split('@')[0]!,
      passwordHash: await hashPassword(DEMO_PASSWORD),
      platformRole: options.platformRole ?? null,
    })
    .returning();
  if (options.orgId) {
    await t.db
      .insert(memberships)
      .values({ orgId: options.orgId, userId: user!.id, role: options.role ?? 'member' });
  }
  const client = new Client(t.app);
  await client.login(email);
  return client;
}

async function newOrg(
  name: string,
  slug: string,
  options: { kind?: OrgKind; parentOrgId?: string; modules?: ModuleKey[] } = {},
) {
  const kind = options.kind ?? 'customer';
  const [org] = await t.db
    .insert(organizations)
    .values({
      name,
      slug,
      kind,
      boundary: kind === 'reseller' ? DEFAULT_RESELLER_BOUNDARY : DEFAULT_CUSTOMER_BOUNDARY,
      parentOrgId: options.parentOrgId ?? null,
      modules: options.modules ?? ['servers'],
    })
    .returning();
  return org!;
}

/** A further provider connection, stored like one created in the admin UI. */
async function newConnection(type: 'demo' | 'joker' | 'jellyfin', name: string, config: object = {}) {
  const [connection] = await t.db
    .insert(providerConnections)
    .values({
      type,
      name,
      location: { country: 'CH', label: name },
      configEnc: t.ctx.box.encryptJson(config),
    })
    .returning();
  return connection!;
}

/** Makes the demo refuse policy writes for one user, like Jellyfin's 403 answers. */
async function refusingPolicy<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const original = DemoAdapter.prototype.setMediaUserPolicy;
  DemoAdapter.prototype.setMediaUserPolicy = async function (
    this: DemoAdapter,
    id: string,
    policy: MediaPolicyState,
  ) {
    if (id === userId) {
      throw new ProviderError('Jellyfin', 'set the access failed: refused for the test (HTTP 403)', 403);
    }
    return original.call(this, id, policy);
  };
  try {
    return await fn();
  } finally {
    DemoAdapter.prototype.setMediaUserPolicy = original;
  }
}

/** Runs `during` while a sync of the demo instance holds on to the user list it has read. */
async function duringSync(during: () => Promise<void>): Promise<MediaSyncCounts> {
  const original = DemoAdapter.prototype.listMediaUsers;
  let listed!: () => void;
  let release!: () => void;
  const read = new Promise<void>((resolve) => (listed = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  DemoAdapter.prototype.listMediaUsers = async function (this: DemoAdapter) {
    const list = await original.call(this);
    listed();
    await gate;
    return list;
  };
  try {
    await tick();
    const pending = admin.post(`/admin/providers/${demo.id}/sync`);
    await read;
    try {
      await during();
    } finally {
      release();
    }
    const res = await pending;
    expect(res.statusCode, res.body).toBe(200);
    return json(res).mediaAccounts;
  } finally {
    DemoAdapter.prototype.listMediaUsers = original;
  }
}

beforeAll(async () => {
  t = await createTestApp();
  admin = new Client(t.app);
  await admin.login(ADMIN.email, ADMIN.password);
  anna = new Client(t.app);
  await anna.login('anna@muster.example');
  carla = new Client(t.app);
  await carla.login('carla@muster.example');
  dev = new Client(t.app);
  await dev.login('dev@beispiel.example');
  reto = new Client(t.app);
  await reto.login('reseller@alpen.example');
  hanna = new Client(t.app);
  await hanna.login('huber@baeckerei.example');
  support = await newUser('support@weblion.example', { platformRole: 'support' });
  demo = (await t.db.query.providerConnections.findFirst({ where: eq(providerConnections.envKey, 'demo') }))!;
  musterId = (await orgBySlug('muster-ag')).id;
  beispielId = (await orgBySlug('beispiel-gmbh')).id;
  alpenId = (await orgBySlug('alpen-hosting')).id;
  huberId = (await orgBySlug('baeckerei-huber')).id;
  // The seed gives the reseller and its customer allowances, but leaves their modules alone.
  for (const id of [alpenId, huberId]) await setModules(id, [...(await modulesOf(id)), 'media']);
  const { token } = json(
    await anna.post(`/orgs/${musterId}/tokens`, { name: 'media-bot', scope: 'read_write' }),
  );
  bot = new Client(t.app);
  bot.bearer = token;
});

afterAll(async () => {
  await t?.close();
});

describe('passwords', () => {
  it('generates 16 characters that are easy to type with a remote', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const password = generateMediaPassword();
      expect(password).toMatch(GENERATED);
      seen.add(password);
    }
    expect(seen.size).toBe(200);
  });
});

describe('seed and sync', () => {
  it('shows the seeded allowance and accounts with the day of the last activity only', async () => {
    const media = await orgMedia(anna, musterId);
    expect(media.allowance).toMatchObject({
      orgId: musterId,
      provider: { id: demo.id, type: 'demo', url: DEMO_MEDIA_URL },
      accountCode: 'kemaro',
      maxAccounts: 5,
      maxStreams: 2,
      downloads: false,
      remoteBitrateMbit: 8,
      accounts: 2,
      customers: 0,
      customerAccounts: 0,
    });
    expect(media.allowance!.libraries.map((l) => l.name)).toEqual(['Filme', 'Serien', 'Kinder']);
    expect(media.login).toEqual({
      url: DEMO_MEDIA_URL,
      serverName: 'Demo Jellyfin',
      quickConnect: true,
      accountCode: 'kemaro',
    });
    expect(media.accounts.map((a) => a.username)).toEqual(['anna-kemaro', 'wohnzimmer-kemaro']);
    const [first, living] = media.accounts;
    expect(first).toMatchObject({
      enabled: true,
      hasPassword: true,
      issues: [],
      loginUrl: DEMO_MEDIA_URL,
      org: { id: musterId, slug: 'muster-ag' },
      provider: { id: demo.id },
      missingSince: null,
    });
    expect(first!.lastActiveOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first!.permissions.sort()).toEqual(['media:password', 'media:read', 'media:write']);
    expect(living).toMatchObject({ enabled: false, issues: ['locked_out'] });
    // Never the time of day, nor anything a session would tell.
    expect(JSON.stringify(media)).not.toMatch(/lastActivity|lastLogin/);

    // The reseller's allowance counts what it handed to its customer.
    const alpen = json<MediaAllowanceDto>(await admin.get(`/admin/orgs/${alpenId}/media-allowance`));
    expect(alpen).toMatchObject({
      accountCode: 'alpen',
      maxAccounts: 20,
      accounts: 3,
      customers: 1,
      customerAccounts: 3,
    });
    expect((await orgMedia(hanna, huberId)).accounts.map((a) => a.username)).toEqual(['huber-bivane']);
    expect(json(await admin.get(`/admin/orgs/${beispielId}/media-allowance`))).toBeNull();
  });

  it('repairs a drifted policy and audits it as the sync', async () => {
    expect(demoUser('huber-bivane')!.policy.maxSessions).toBe(4);
    expect(await sync()).toEqual({ seen: 3, missing: 0, repaired: 1, repairFailed: 0 });
    expect(demoUser('huber-bivane')!.policy).toEqual(expectedMediaPolicy(HUBER_ACCESS));
    const id = await accountId('huber-bivane');
    const entries = await auditEntries('media.policy_repair', id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorName: 'Sync',
      actorUserId: null,
      orgId: huberId,
      status: 'success',
      details: { username: 'huber-bivane', fields: ['maxSessions'] },
    });
    expect((await stored('huber-bivane'))!.issues).toEqual([]);
    // Nothing left to repair.
    expect((await sync()).repaired).toBe(0);
  });

  it('reverts dashboard changes, demotes administrators and keeps refused repairs as issues', async () => {
    const annaUser = demoUser('anna-kemaro')!;
    annaUser.policy = { ...annaUser.policy, allLibraries: true, syncPlay: 'JoinGroups', administrator: true };
    annaUser.administrator = true;
    expect(await sync()).toMatchObject({ repaired: 1, repairFailed: 0 });
    expect(demoUser('anna-kemaro')!.policy).toEqual(expectedMediaPolicy(MUSTER_ACCESS));
    expect(demoUser('anna-kemaro')!.administrator).toBe(false);
    const annaId = await accountId('anna-kemaro');
    const [repair] = (await auditEntries('media.policy_repair', annaId)).slice(-1);
    expect(repair!.details).toEqual({
      username: 'anna-kemaro',
      fields: ['administrator', 'allLibraries', 'syncPlay'],
    });
    expect((await stored('anna-kemaro'))!.issues).toEqual([]);

    // Jellyfin refuses the write: the drift stays visible and the failure is audited.
    const huber = demoUser('huber-bivane')!;
    huber.policy = { ...huber.policy, maxSessions: 5 };
    const huberAccount = await accountId('huber-bivane');
    const refused = await refusingPolicy(DEMO_MEDIA_IDS['huber-bivane'], () => sync());
    expect(refused).toMatchObject({ repaired: 0, repairFailed: 1 });
    expect((await stored('huber-bivane'))!.issues).toEqual(['policy']);
    const [failure] = (await auditEntries('media.policy_repair', huberAccount)).slice(-1);
    expect(failure).toMatchObject({
      status: 'failure',
      actorName: 'Sync',
      details: { username: 'huber-bivane', fields: ['maxSessions'] },
    });
    expect((failure!.details as any).error).toMatch(/refused for the test/);
    // The next run repairs it.
    expect(await sync()).toMatchObject({ repaired: 1, repairFailed: 0 });
    expect((await stored('huber-bivane'))!.issues).toEqual([]);
    expect(demoUser('huber-bivane')!.policy.maxSessions).toBe(2);
  });

  it('repairs at most 25 accounts per run', async () => {
    crowded = await newConnection('demo', 'Jellyfin Viel');
    const org = await newOrg('Viel AG', 'viel-ag');
    const res = await put(admin, `/admin/orgs/${org.id}/media-allowance`, {
      providerId: crowded.id,
      maxAccounts: 40,
      libraryIds: [LIB.Filme],
      maxStreams: 1,
      downloads: false,
      remoteBitrateMbit: null,
    });
    expect(res.statusCode, res.body).toBe(200);
    const owner = await newUser('owner@viel.example', { orgId: org.id, role: 'owner' });
    for (let i = 0; i < 30; i++) await created(owner, org.id, { name: `v${i}` });
    const expected = expectedMediaPolicy({
      libraryIds: [LIB.Filme!],
      maxStreams: 1,
      downloads: false,
      remoteBitrateMbit: null,
    });
    const managed = [...demoUsers(crowded.id).values()].filter((u) => u.username.startsWith('v'));
    expect(managed).toHaveLength(30);
    for (const user of managed) {
      expect(user.policy).toEqual(expected);
      user.policy = { ...user.policy, maxSessions: 9 };
    }
    expect(await sync(crowded.id)).toEqual({ seen: 30, missing: 0, repaired: 25, repairFailed: 0 });
    expect(managed.filter((u) => u.policy.maxSessions === 9)).toHaveLength(5);
    expect(await sync(crowded.id)).toEqual({ seen: 30, missing: 0, repaired: 5, repairFailed: 0 });
    expect(managed.every((u) => u.policy.maxSessions === 1)).toBe(true);
    expect((await sync(crowded.id)).repaired).toBe(0);
    const repairs = (await auditEntries('media.policy_repair')).filter((e) => e.orgId === org.id);
    expect(repairs).toHaveLength(30);
    // The other instance was not touched.
    expect(demoUser('ben-kemaro')!.policy).toEqual(jellyfinDefaultPolicy());
  });

  it('marks vanished accounts missing, but not one created or changed during the run', async () => {
    const gone = await created(anna, musterId, { name: 'weg' });
    demoUsers().delete(demoUser('weg-kemaro')!.externalId);
    const result = await sync();
    expect(result).toMatchObject({ seen: 3, missing: 1 });
    expect((await stored('weg-kemaro'))!.missingSince).not.toBeNull();
    expect((await stored('weg-kemaro'))!.orgId).toBe(musterId);

    // A creation on its way to the instance when the sync reads the list.
    const original = DemoAdapter.prototype.createMediaUser;
    let entered!: () => void;
    let proceed!: () => void;
    const atInstance = new Promise<void>((resolve) => (entered = resolve));
    const go = new Promise<void>((resolve) => (proceed = resolve));
    DemoAdapter.prototype.createMediaUser = async function (this: DemoAdapter, input) {
      entered();
      await go;
      return original.call(this, input);
    };
    let newId = '';
    try {
      const pending = create(anna, musterId, { name: 'neu' });
      await atInstance;
      const during = await duringSync(async () => {
        proceed();
        const res = await pending;
        expect(res.statusCode, res.body).toBe(200);
        newId = json<MediaAccountSecretDto>(res).account.id;
      });
      expect(during.missing).toBe(1);
    } finally {
      DemoAdapter.prototype.createMediaUser = original;
      proceed();
    }
    expect((await stored('neu-kemaro'))!.missingSince).toBeNull();

    // Disabled while the list (with the account still enabled) was on its way.
    const annaId = await accountId('anna-kemaro');
    await duringSync(async () => {
      const res = await anna.patch(`/media/accounts/${annaId}`, { enabled: false });
      expect(res.statusCode, res.body).toBe(200);
    });
    expect((await stored('anna-kemaro'))!.enabled).toBe(false);
    expect(demoUser('anna-kemaro')!.enabled).toBe(false);
    expect((await anna.patch(`/media/accounts/${annaId}`, { enabled: true })).statusCode).toBe(200);

    expect((await remove(anna, newId, 'neu-kemaro')).statusCode).toBe(200);
    expect((await remove(anna, gone.account.id, 'weg-kemaro')).statusCode).toBe(200);
  });

  it('never stores unknown users and keeps the library snapshots current', async () => {
    const before = await t.db
      .select()
      .from(mediaAccounts)
      .where(eq(mediaAccounts.providerConnectionId, demo.id));
    const state = demoMediaState(demo.id);
    const libraries = state.libraries.map((l) => ({ ...l }));
    const allowanceBefore = (await allowanceOf(musterId))!;
    try {
      state.libraries = state.libraries
        .filter((l) => l.name !== 'Serien')
        .map((l) => (l.name === 'Kinder' ? { ...l, name: 'Kids' } : l));
      await sync();
      const after = await t.db
        .select()
        .from(mediaAccounts)
        .where(eq(mediaAccounts.providerConnectionId, demo.id));
      expect(after).toHaveLength(before.length);
      expect(await stored('ben-kemaro')).toBeUndefined();
      const allowance = (await allowanceOf(musterId))!;
      expect(allowance.libraries).toEqual<MediaLibraryRef[]>([
        { id: LIB.Filme!, name: 'Filme', type: 'movies' },
        { id: LIB.Serien!, name: 'Serien', type: 'tvshows', missing: true },
        { id: LIB.Kinder!, name: 'Kids', type: 'movies' },
      ]);
      // Not a change of the allowance.
      expect(allowance.updatedAt.getTime()).toBe(allowanceBefore.updatedAt.getTime());
      const shown = (await orgMedia(anna, musterId)).allowance!.libraries;
      expect(shown.find((l) => l.id === LIB.Serien)).toMatchObject({ missing: true });
    } finally {
      state.libraries = libraries;
    }
    await sync();
    expect((await allowanceOf(musterId))!.libraries).toEqual(allowanceBefore.libraries);
  });
});

describe('sync failures', () => {
  it('fails the run only when the user list cannot be read', async () => {
    // The libraries only name the allowance's snapshot: the run goes on without them.
    const libraries = DemoAdapter.prototype.listMediaLibraries;
    DemoAdapter.prototype.listMediaLibraries = async () => {
      throw new ProviderError('Jellyfin', 'list libraries failed: unreachable');
    };
    try {
      expect(await sync()).toEqual({ seen: 3, missing: 0, repaired: 0, repairFailed: 0 });
    } finally {
      DemoAdapter.prototype.listMediaLibraries = libraries;
    }
    const list = DemoAdapter.prototype.listMediaUsers;
    DemoAdapter.prototype.listMediaUsers = async () => {
      throw new ProviderError('Jellyfin', 'list users failed: unreachable');
    };
    try {
      await tick();
      const res = await admin.post(`/admin/providers/${demo.id}/sync`);
      expect(res.statusCode).toBe(502);
      const connection = await t.db.query.providerConnections.findFirst({
        where: eq(providerConnections.id, demo.id),
      });
      expect(connection).toMatchObject({ status: 'error' });
      expect(connection!.lastError).toMatch(/list users failed/);
      // The accounts stay as they were, none is taken as missing.
      expect((await stored('anna-kemaro'))!.missingSince).toBeNull();
    } finally {
      DemoAdapter.prototype.listMediaUsers = list;
    }
    await sync();
    expect(
      (await t.db.query.providerConnections.findFirst({ where: eq(providerConnections.id, demo.id) }))!
        .status,
    ).toBe('ok');
  });
});

describe('accounts', () => {
  it('creates an account with a generated password shown once', async () => {
    const res = await create(anna, musterId, { name: 'lea' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const { account, password } = json<MediaAccountSecretDto>(res);
    expect(password).toMatch(GENERATED);
    expect(account).toMatchObject({
      username: 'lea-kemaro',
      enabled: true,
      hasPassword: true,
      issues: [],
      lastActiveOn: null,
      org: { id: musterId },
      loginUrl: DEMO_MEDIA_URL,
    });
    const user = demoUser('lea-kemaro')!;
    expect(user.password).toBe(password);
    expect(user.policy).toEqual(expectedMediaPolicy(MUSTER_ACCESS));
    expect((await stored('lea-kemaro'))!.externalId).toBe(user.externalId);
    const entries = await auditEntries('media.account_create', account.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      orgId: musterId,
      resourceType: 'media_account',
      details: { username: 'lea-kemaro', providerId: demo.id, password: 'generated' },
    });
    expect(JSON.stringify(entries)).not.toContain(password!);
    expect((await orgMedia(anna, musterId)).allowance!.accounts).toBe(3);
  });

  it('takes a chosen password and checks it', async () => {
    const chosen = 'Ein-sicheres-Passwort-1';
    const { account, password } = await created(anna, musterId, { name: 'max', password: chosen });
    expect(password).toBeNull();
    expect(demoUser('max-kemaro')!.password).toBe(chosen);
    const [entry] = await auditEntries('media.account_create', account.id);
    expect(entry!.details).toMatchObject({ password: 'chosen' });
    expect(JSON.stringify(entry)).not.toContain(chosen);
    for (const bad of [
      'kurz12345',
      'Leerzeichen-am-Ende ',
      ' am-Anfang-1234',
      'mit\u0007Steuerzeichen',
      'x'.repeat(129),
    ]) {
      const res = await create(anna, musterId, { name: 'bad', password: bad });
      expect(res.statusCode, bad).toBe(400);
    }
    expect(demoUser('bad-kemaro')).toBeUndefined();
  });

  it('gives API tokens no passwords', async () => {
    const refused = await create(bot, musterId, { name: 'bot' });
    expect(refused.statusCode).toBe(400);
    expect(json(refused).error.message).toMatch(/API tokens cannot receive passwords/);
    expect(demoUser('bot-kemaro')).toBeUndefined();
    const res = await create(bot, musterId, { name: 'bot', password: 'Skript-Passwort-42' });
    expect(res.statusCode, res.body).toBe(200);
    const { account, password } = json<MediaAccountSecretDto>(res);
    expect(password).toBeNull();
    // Tokens manage accounts but never set passwords.
    expect(account.permissions.sort()).toEqual(['media:read', 'media:write']);
    const reset = await bot.post(`/media/accounts/${account.id}/password`, {});
    expect(reset.statusCode).toBe(403);
    expect(
      (await bot.post(`/media/accounts/${account.id}/password`, { password: 'Neues-Passwort-77' }))
        .statusCode,
    ).toBe(403);
    expect((await bot.patch(`/media/accounts/${account.id}`, { enabled: false })).statusCode).toBe(200);
    expect((await remove(bot, account.id, 'bot-kemaro')).statusCode).toBe(200);
  });

  it('accepts lower-case names only and refuses duplicates, also those only Jellyfin has', async () => {
    for (const name of ['Lea', 'a--b', 'a'.repeat(21), 'ä', '-lea', 'lea-', 'le a', '']) {
      const res = await create(anna, musterId, { name, password: 'Gutes-Passwort-11' });
      expect(res.statusCode, name).toBe(400);
    }
    const twice = await create(anna, musterId, { name: 'lea', password: 'Gutes-Passwort-11' });
    expect(twice.statusCode).toBe(409);
    expect(json(twice).error.message).toMatch(/lea-kemaro exists already/);

    // Created in Jellyfin directly, in another case: Jellyfin refuses, nothing is stored.
    const tom = jellyfinOnly('Tom-Kemaro');
    try {
      const res = await create(anna, musterId, { name: 'tom', password: 'Gutes-Passwort-11' });
      expect(res.statusCode).toBe(409);
      expect(json(res).error.message).toMatch(/already exists/);
      expect(await stored('tom-kemaro')).toBeUndefined();
      const [failure] = (await auditEntries('media.account_create')).slice(-1);
      expect(failure).toMatchObject({ status: 'failure', details: { username: 'tom-kemaro' } });
    } finally {
      demoUsers().delete(tom.externalId);
    }
  });

  it('keeps to the maximum number of accounts, also with parallel requests', async () => {
    const { allowance } = await orgMedia(anna, musterId);
    expect(allowance!.accounts).toBe(4);
    const raise = await put(admin, `/admin/orgs/${musterId}/media-allowance`, musterBody({ maxAccounts: 7 }));
    expect(raise.statusCode, raise.body).toBe(200);
    // Same access: no policy writes.
    expect(json<MediaAllowanceChangeResult>(raise).policy).toEqual({ applied: 0, failed: [] });
    try {
      const names = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'];
      const results = await Promise.all(names.map((name) => create(anna, musterId, { name })));
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 200, 200, 409, 409, 409]);
      for (const r of results.filter((r) => r.statusCode === 409))
        expect(json(r).error.code).toBe('account_limit');
      const full = await create(anna, musterId, { name: 'r7' });
      expect(full.statusCode).toBe(409);
      expect(json(full).error).toMatchObject({
        code: 'account_limit',
        details: { maxAccounts: 7, accounts: 7 },
      });
      // Only the three stored accounts exist at the instance.
      expect(names.filter((n) => demoUser(`${n}-kemaro`))).toHaveLength(3);
    } finally {
      for (const name of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']) {
        const row = await stored(`${name}-kemaro`);
        if (row) expect((await remove(anna, row.id, row.username)).statusCode).toBe(200);
      }
      expect((await put(admin, `/admin/orgs/${musterId}/media-allowance`, musterBody())).statusCode).toBe(
        200,
      );
    }
  });

  it('removes the user at the instance again when storing the account fails', async () => {
    const original = DemoAdapter.prototype.createMediaUser;
    DemoAdapter.prototype.createMediaUser = async function (this: DemoAdapter, input) {
      const remote = await original.call(this, input);
      // A row for the same Jellyfin user appears meanwhile: the insert fails on its unique index.
      await t.db.insert(mediaAccounts).values({
        providerConnectionId: demo.id,
        externalId: remote.externalId,
        username: 'clash-row',
        orgId: null,
      });
      return remote;
    };
    try {
      const res = await create(anna, musterId, { name: 'clash' });
      expect(res.statusCode).toBe(500);
      expect(demoUser('clash-kemaro')).toBeUndefined();
      const [entry] = (await auditEntries('media.account_create')).filter(
        (e) => (e.details as any).username === 'clash-kemaro',
      );
      expect(entry).toMatchObject({ status: 'failure', details: { removedAtInstance: true } });
    } finally {
      DemoAdapter.prototype.createMediaUser = original;
      await t.db.delete(mediaAccounts).where(eq(mediaAccounts.username, 'clash-row'));
    }
  });

  it('reads one account live', async () => {
    const id = await accountId('lea-kemaro');
    demoUser('lea-kemaro')!.lastActivityAt = '2026-01-15T22:30:00.000Z';
    const res = await carla.get(`/media/accounts/${id}`);
    expect(res.statusCode, res.body).toBe(200);
    // 23:30 in Zurich.
    expect(json<MediaAccountDto>(res).lastActiveOn).toBe('2026-01-15');
    expect((await stored('lea-kemaro'))!.lastActivityAt!.toISOString()).toBe('2026-01-15T22:30:00.000Z');
    expect(json<MediaAccountDto>(res).permissions).toEqual(['media:read']);
    expect((await dev.get(`/media/accounts/${id}`)).statusCode).toBe(404);
  });

  it('disables and enables accounts; enabling lifts a lock after failed sign-ins', async () => {
    const living = await accountId('wohnzimmer-kemaro');
    const res = await anna.patch(`/media/accounts/${living}`, { enabled: true });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<MediaAccountDto>(res)).toMatchObject({ enabled: true, issues: [] });
    expect(demoUser('wohnzimmer-kemaro')).toMatchObject({
      enabled: true,
      lockedOut: false,
      invalidLogins: 0,
    });

    const lea = await accountId('lea-kemaro');
    const signOuts = demoUser('lea-kemaro')!.signOuts;
    const off = await anna.patch(`/media/accounts/${lea}`, { enabled: false });
    expect(json<MediaAccountDto>(off).enabled).toBe(false);
    expect(demoUser('lea-kemaro')!.signOuts).toBe(signOuts + 1);
    expect((await stored('lea-kemaro'))!.enabled).toBe(false);
    // The same state again changes nothing.
    expect((await anna.patch(`/media/accounts/${lea}`, { enabled: false })).statusCode).toBe(200);
    const entries = await auditEntries('media.account_update', lea);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.details).toEqual({
      username: 'lea-kemaro',
      before: { enabled: true },
      after: { enabled: false },
    });
    expect((await anna.patch(`/media/accounts/${lea}`, { enabled: true })).statusCode).toBe(200);
    expect((await anna.patch(`/media/accounts/${lea}`, { enabled: 'yes' })).statusCode).toBe(400);
  });

  it('sets new passwords in interactive sessions only and audits them without the password', async () => {
    const id = await accountId('lea-kemaro');
    await t.db
      .update(mediaAccounts)
      .set({ hasPassword: false, issues: ['no_password'] })
      .where(eq(mediaAccounts.id, id));
    const signOuts = demoUser('lea-kemaro')!.signOuts;
    const res = await anna.post(`/media/accounts/${id}/password`, {});
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const { password } = json<{ password: string }>(res);
    expect(password).toMatch(GENERATED);
    expect(demoUser('lea-kemaro')!.password).toBe(password);
    expect(demoUser('lea-kemaro')!.signOuts).toBe(signOuts + 1);
    expect(await stored('lea-kemaro')).toMatchObject({ hasPassword: true, issues: [] });

    const chosen = 'Selbst-gewaehlt-123';
    const own = await anna.post(`/media/accounts/${id}/password`, { password: chosen });
    expect(json(own)).toEqual({ password: null });
    expect(demoUser('lea-kemaro')!.password).toBe(chosen);
    const short = await anna.post(`/media/accounts/${id}/password`, { password: 'kurz' });
    expect(short.statusCode).toBe(400);
    expect(json(short).error.details).toEqual([{ path: 'password', message: 'at least 10 characters' }]);
    const padded = await anna.post(`/media/accounts/${id}/password`, { password: ' Leerzeichen-davor' });
    expect(json(padded).error.details).toEqual([
      { path: 'password', message: 'no control characters and no spaces at either end' },
    ]);

    const entries = await auditEntries('media.password_reset', id);
    expect(entries.map((e) => e.details)).toEqual([
      { username: 'lea-kemaro', password: 'generated' },
      { username: 'lea-kemaro', password: 'chosen' },
    ]);
    expect(JSON.stringify(entries)).not.toContain(password);
    expect(JSON.stringify(entries)).not.toContain(chosen);

    expect((await carla.post(`/media/accounts/${id}/password`, {})).statusCode).toBe(403);
    expect((await bot.post(`/media/accounts/${id}/password`, {})).statusCode).toBe(403);
    expect((await dev.post(`/media/accounts/${id}/password`, {})).statusCode).toBe(404);
    expect(await auditEntries('media.password_reset', id)).toHaveLength(2);
  });

  it('deletes an account only with the login name as confirmation', async () => {
    const id = await accountId('max-kemaro');
    const externalId = demoUser('max-kemaro')!.externalId;
    expect((await anna.del(`/media/accounts/${id}`)).statusCode).toBe(400);
    expect((await remove(anna, id, 'max')).statusCode).toBe(400);
    expect((await remove(anna, id, 'lea-kemaro')).statusCode).toBe(400);
    expect(demoUser('max-kemaro')).toBeDefined();
    // Typed as a TV keyboard might: the case does not matter.
    expect((await remove(anna, id, 'Max-Kemaro')).statusCode).toBe(200);
    expect(demoUser('max-kemaro')).toBeUndefined();
    expect(new DemoMedia(demoMediaState(demo.id)).signOuts(externalId)).toBe(1);
    expect(await stored('max-kemaro')).toBeUndefined();
    const entries = await auditEntries('media.account_delete', id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.details).toEqual({ username: 'max-kemaro' });
    expect((await remove(anna, id, 'max-kemaro')).statusCode).toBe(404);

    // Gone at the instance already: removed from the console only.
    const gone = await created(anna, musterId, { name: 'alt' });
    demoUsers().delete(demoUser('alt-kemaro')!.externalId);
    await sync();
    expect((await stored('alt-kemaro'))!.missingSince).not.toBeNull();
    const res = await remove(anna, gone.account.id, 'alt-kemaro');
    expect(res.statusCode, res.body).toBe(200);
    expect(await stored('alt-kemaro')).toBeUndefined();
  });
});

describe('access', () => {
  it('lets members and viewers read but not change anything', async () => {
    const member = await newUser('member@muster.example', { orgId: musterId, role: 'member' });
    const id = await accountId('lea-kemaro');
    for (const client of [member, carla]) {
      const media = await orgMedia(client, musterId);
      expect(media.accounts.length).toBeGreaterThan(0);
      expect(media.accounts[0]!.permissions).toEqual(['media:read']);
      expect(
        (await create(client, musterId, { name: 'nope', password: 'Gutes-Passwort-11' })).statusCode,
      ).toBe(403);
      expect((await client.patch(`/media/accounts/${id}`, { enabled: false })).statusCode).toBe(403);
      expect((await client.post(`/media/accounts/${id}/password`, {})).statusCode).toBe(403);
      expect((await remove(client, id, 'lea-kemaro')).statusCode).toBe(403);
    }
    // A read token reads.
    const { token } = json(
      await anna.post(`/orgs/${musterId}/tokens`, { name: 'media-read', scope: 'read' }),
    );
    const reader = new Client(t.app);
    reader.bearer = token;
    expect((await reader.get(`/orgs/${musterId}/media`)).statusCode).toBe(200);
    expect((await reader.patch(`/media/accounts/${id}`, { enabled: false })).statusCode).toBe(403);
    // ben is "restricted": no streaming access at all.
    const ben = new Client(t.app);
    await ben.login('ben@muster.example');
    expect((await ben.get(`/orgs/${musterId}/media`)).statusCode).toBe(403);
    expect((await ben.get(`/media/accounts/${id}`)).statusCode).toBe(404);
  });

  it('hides everything from other organizations', async () => {
    const id = await accountId('lea-kemaro');
    expect((await dev.get(`/orgs/${musterId}/media`)).statusCode).toBe(404);
    expect((await create(dev, musterId, { name: 'x', password: 'Gutes-Passwort-11' })).statusCode).toBe(404);
    expect((await dev.get(`/media/accounts/${id}`)).statusCode).toBe(404);
    expect((await dev.patch(`/media/accounts/${id}`, { enabled: false })).statusCode).toBe(404);
    expect((await dev.post(`/media/accounts/${id}/password`, {})).statusCode).toBe(404);
    expect((await remove(dev, id, 'lea-kemaro')).statusCode).toBe(404);
    expect((await dev.get('/media/accounts/00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect((await hanna.get(`/media/accounts/${id}`)).statusCode).toBe(404);
    // Nor the accounts of a reseller's customers.
    const huberAccount = await accountId('huber-bivane');
    expect((await anna.get(`/media/accounts/${huberAccount}`)).statusCode).toBe(404);
  });

  it('closes everything while the module is off, also for the owner', async () => {
    const modules = await modulesOf(musterId);
    await setModules(
      musterId,
      modules.filter((m) => m !== 'media'),
    );
    try {
      const id = await accountId('lea-kemaro');
      expect((await anna.get(`/orgs/${musterId}/media`)).statusCode).toBe(403);
      expect((await create(anna, musterId, { name: 'off' })).statusCode).toBe(403);
      expect((await anna.get(`/media/accounts/${id}`)).statusCode).toBe(404);
      expect((await anna.patch(`/media/accounts/${id}`, { enabled: false })).statusCode).toBe(404);
      expect((await anna.post(`/media/accounts/${id}/password`, {})).statusCode).toBe(404);
      expect((await remove(anna, id, 'lea-kemaro')).statusCode).toBe(404);
      // Platform staff still see it.
      expect((await admin.get(`/orgs/${musterId}/media`)).statusCode).toBe(200);
      expect((await admin.get(`/media/accounts/${id}`)).statusCode).toBe(200);
    } finally {
      await setModules(musterId, modules);
    }
  });

  it('is read-only while the organization is suspended, and the accounts keep working', async () => {
    await t.db
      .update(organizations)
      .set({ status: 'suspended', suspendedBy: 'platform' })
      .where(eq(organizations.id, musterId));
    try {
      const id = await accountId('lea-kemaro');
      expect((await anna.get(`/orgs/${musterId}/media`)).statusCode).toBe(200);
      expect((await create(anna, musterId, { name: 'sus' })).statusCode).toBe(403);
      expect((await anna.patch(`/media/accounts/${id}`, { enabled: false })).statusCode).toBe(403);
      expect((await anna.post(`/media/accounts/${id}/password`, {})).statusCode).toBe(403);
      expect((await remove(anna, id, 'lea-kemaro')).statusCode).toBe(403);
      expect(demoUser('lea-kemaro')!.enabled).toBe(true);
    } finally {
      await t.db
        .update(organizations)
        .set({ status: 'active', suspendedBy: null })
        .where(eq(organizations.id, musterId));
    }
  });

  it('needs an allowance to create accounts', async () => {
    await setModules(beispielId, ['servers', 'media']);
    try {
      const res = await create(dev, beispielId, { name: 'dev' });
      expect(res.statusCode).toBe(409);
      expect(json(res).error.code).toBe('no_allowance');
      expect(await orgMedia(dev, beispielId)).toEqual({ allowance: null, accounts: [], login: null });
    } finally {
      await setModules(beispielId, ['servers']);
    }
  });
});

describe('admin allowances', () => {
  const beispielBody = (overrides: Record<string, unknown> = {}) => ({
    providerId: demo.id,
    maxAccounts: 3,
    libraryIds: [LIB.Filme],
    maxStreams: 1,
    downloads: false,
    remoteBitrateMbit: null,
    ...overrides,
  });

  it('is for platform staff only', async () => {
    const accountIdLea = await accountId('lea-kemaro');
    expect((await anna.get(`/admin/orgs/${musterId}/media-allowance`)).statusCode).toBe(403);
    expect((await put(anna, `/admin/orgs/${beispielId}/media-allowance`, beispielBody())).statusCode).toBe(
      403,
    );
    expect((await support.get(`/admin/orgs/${musterId}/media-allowance`)).statusCode).toBe(200);
    expect((await put(support, `/admin/orgs/${beispielId}/media-allowance`, beispielBody())).statusCode).toBe(
      403,
    );
    expect((await support.del(`/admin/orgs/${beispielId}/media-allowance`)).statusCode).toBe(403);
    expect((await support.get('/admin/media/accounts')).statusCode).toBe(200);
    expect((await support.get('/admin/media/instances')).statusCode).toBe(200);
    expect((await support.get(`/admin/providers/${demo.id}/media/unmanaged`)).statusCode).toBe(200);
    const importBody = { providerId: demo.id, userId: DEMO_MEDIA_IDS['ben-kemaro'], orgId: null };
    expect((await support.post('/admin/media/accounts/import', importBody)).statusCode).toBe(403);
    expect(
      (await support.post(`/admin/media/accounts/${accountIdLea}/assign`, { orgId: null })).statusCode,
    ).toBe(403);
    expect((await support.post(`/admin/media/accounts/${accountIdLea}/repair`)).statusCode).toBe(403);
    expect((await anna.get('/admin/media/instances')).statusCode).toBe(403);
    expect((await anna.get(`/admin/providers/${demo.id}/media/libraries`)).statusCode).toBe(403);
  });

  it('reads the libraries of an instance live', async () => {
    const res = await admin.get(`/admin/providers/${demo.id}/media/libraries`);
    expect(res.statusCode, res.body).toBe(200);
    expect(json<MediaLibraryRef[]>(res).map((l) => l.name)).toEqual([
      'Dokumentationen',
      'Filme',
      'Kinder',
      'Musik',
      'Serien',
    ]);
    const joker = await newConnection('joker', 'Joker', {
      apiKey: 'joker-test-key',
      baseUrl: 'https://dmapi.invalid/request',
    });
    expect((await admin.get(`/admin/providers/${joker.id}/media/libraries`)).statusCode).toBe(422);
    expect(
      (await put(admin, `/admin/orgs/${beispielId}/media-allowance`, beispielBody({ providerId: joker.id })))
        .statusCode,
    ).toBe(422);
    expect((await admin.del(`/admin/providers/${joker.id}`)).statusCode).toBe(200);
  });

  it('sets a new allowance with a generated code and activates the module', async () => {
    expect(await modulesOf(beispielId)).not.toContain('media');
    const res = await put(admin, `/admin/orgs/${beispielId}/media-allowance`, beispielBody());
    expect(res.statusCode, res.body).toBe(200);
    const { allowance, policy } = json<MediaAllowanceChangeResult>(res);
    expect(allowance.accountCode).toMatch(/^([bdfghjkmnprstvwz][aeiu]){3}$/);
    expect(allowance).toMatchObject({
      orgId: beispielId,
      provider: { id: demo.id, url: DEMO_MEDIA_URL },
      maxAccounts: 3,
      libraries: [{ id: LIB.Filme, name: 'Filme', type: 'movies' }],
      maxStreams: 1,
      downloads: false,
      remoteBitrateMbit: null,
      accounts: 0,
    });
    expect(policy).toEqual({ applied: 0, failed: [] });
    expect(await modulesOf(beispielId)).toContain('media');
    const [entry] = await auditEntries('media.allowance_set', beispielId);
    expect(entry).toMatchObject({
      resourceType: 'media_allowance',
      details: {
        providerId: demo.id,
        accountCode: allowance.accountCode,
        maxAccounts: 3,
        libraryIds: [LIB.Filme],
        maxStreams: 1,
        downloads: false,
        remoteBitrateMbit: null,
        previous: null,
        moduleEnabled: 'media',
        policy: { applied: 0, failed: [] },
      },
    });
    expect(json(await admin.get(`/admin/orgs/${beispielId}/media-allowance`))).toMatchObject({
      accountCode: allowance.accountCode,
    });
    // The organization can create accounts right away.
    const devAccount = await created(dev, beispielId, { name: 'dev' });
    expect(devAccount.account.username).toBe(`dev-${allowance.accountCode}`);
    expect(demoUser(devAccount.account.username)!.policy).toEqual(
      expectedMediaPolicy({
        libraryIds: [LIB.Filme!],
        maxStreams: 1,
        downloads: false,
        remoteBitrateMbit: null,
      }),
    );
    expect((await remove(dev, devAccount.account.id, devAccount.account.username)).statusCode).toBe(200);
  });

  it('checks libraries, instance and account code', async () => {
    const unknown = await put(
      admin,
      `/admin/orgs/${beispielId}/media-allowance`,
      beispielBody({ libraryIds: ['0123456789abcdef0123456789abcdef'] }),
    );
    expect(unknown.statusCode).toBe(400);
    expect(json(unknown).error.message).toMatch(/Unknown library 0123456789abcdef0123456789abcdef/);
    expect(
      (await put(admin, `/admin/orgs/${beispielId}/media-allowance`, beispielBody({ libraryIds: ['nope'] })))
        .statusCode,
    ).toBe(400);
    expect(
      (await put(admin, `/admin/orgs/${beispielId}/media-allowance`, beispielBody({ libraryIds: [] })))
        .statusCode,
    ).toBe(400);
    // Dashed ids are taken in Jellyfin's own form.
    const filme = LIB.Filme!;
    const dashed = `${filme.slice(0, 8)}-${filme.slice(8, 12)}-${filme.slice(12, 16)}-${filme.slice(16, 20)}-${filme.slice(20)}`;
    const dashedRes = await put(
      admin,
      `/admin/orgs/${beispielId}/media-allowance`,
      beispielBody({ libraryIds: [dashed.toUpperCase()] }),
    );
    expect(dashedRes.statusCode, dashedRes.body).toBe(200);
    expect(json<MediaAllowanceChangeResult>(dashedRes).allowance.libraries.map((l) => l.id)).toEqual([filme]);

    // The instance changes only without accounts.
    second = await newConnection('demo', 'Jellyfin Zwei');
    const moved = await put(
      admin,
      `/admin/orgs/${musterId}/media-allowance`,
      musterBody({ providerId: second.id }),
    );
    expect(moved.statusCode).toBe(409);
    expect(json(moved).error.message).toMatch(/instance/);
    expect((await allowanceOf(musterId))!.providerConnectionId).toBe(demo.id);

    // The code changes only without accounts, and only to a free one.
    const recode = await put(
      admin,
      `/admin/orgs/${musterId}/media-allowance`,
      musterBody({ accountCode: 'muster' }),
    );
    expect(recode.statusCode).toBe(409);
    expect(json(recode).error.message).toMatch(/account code can only change/);
    const readable = await put(
      admin,
      `/admin/orgs/${beispielId}/media-allowance`,
      beispielBody({ accountCode: 'Beispiel' }),
    );
    expect(readable.statusCode, readable.body).toBe(200);
    expect(json<MediaAllowanceChangeResult>(readable).allowance.accountCode).toBe('beispiel');
    const taken = await put(
      admin,
      `/admin/orgs/${beispielId}/media-allowance`,
      beispielBody({ accountCode: 'kemaro' }),
    );
    expect(taken.statusCode).toBe(409);
    expect(json(taken).error.message).toMatch(/in use/);
    // A managed account without organization ends with the code.
    await t.db.insert(mediaAccounts).values({
      providerConnectionId: demo.id,
      externalId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      username: 'x-zuvor',
      orgId: null,
    });
    try {
      const res = await put(
        admin,
        `/admin/orgs/${beispielId}/media-allowance`,
        beispielBody({ accountCode: 'zuvor' }),
      );
      expect(res.statusCode).toBe(409);
      expect(json(res).error.message).toMatch(/in use/);
    } finally {
      await t.db.delete(mediaAccounts).where(eq(mediaAccounts.username, 'x-zuvor'));
    }
    // A user created in Jellyfin directly ends with it.
    const direct = jellyfinOnly('Y-Jellyda');
    try {
      const res = await put(
        admin,
        `/admin/orgs/${beispielId}/media-allowance`,
        beispielBody({ accountCode: 'jellyda' }),
      );
      expect(res.statusCode).toBe(409);
    } finally {
      demoUsers().delete(direct.externalId);
    }
    expect(
      (await put(admin, `/admin/orgs/${beispielId}/media-allowance`, beispielBody({ accountCode: 'k' })))
        .statusCode,
    ).toBe(400);
    expect((await allowanceOf(beispielId))!.accountCode).toBe('beispiel');
  });

  it('applies narrowed access to every account of the organization', async () => {
    const accounts = (await orgMedia(anna, musterId)).accounts.map((a) => a.username);
    expect(accounts).toEqual(['anna-kemaro', 'lea-kemaro', 'wohnzimmer-kemaro']);
    const narrow: MediaAccess = { ...MUSTER_ACCESS, libraryIds: [LIB.Filme!, LIB.Kinder!], maxStreams: 1 };
    const res = await put(admin, `/admin/orgs/${musterId}/media-allowance`, musterBody(narrow));
    expect(res.statusCode, res.body).toBe(200);
    expect(json<MediaAllowanceChangeResult>(res).policy).toEqual({ applied: 3, failed: [] });
    for (const username of accounts) expect(demoUser(username)!.policy).toEqual(expectedMediaPolicy(narrow));
    // Unchanged access writes nothing.
    const again = await put(
      admin,
      `/admin/orgs/${musterId}/media-allowance`,
      musterBody({ ...narrow, maxAccounts: 6 }),
    );
    expect(json<MediaAllowanceChangeResult>(again).policy).toEqual({ applied: 0, failed: [] });

    // A refused write is listed and shows as an issue of the account.
    const back = await refusingPolicy(demoUser('lea-kemaro')!.externalId, () =>
      put(admin, `/admin/orgs/${musterId}/media-allowance`, musterBody()),
    );
    expect(back.statusCode, back.body).toBe(200);
    const { policy } = json<MediaAllowanceChangeResult>(back);
    expect(policy.applied).toBe(2);
    expect(policy.failed).toEqual([
      {
        accountId: await accountId('lea-kemaro'),
        username: 'lea-kemaro',
        error: expect.stringMatching(/refused/),
      },
    ]);
    expect((await stored('lea-kemaro'))!.issues).toEqual(['policy']);
    expect(demoUser('anna-kemaro')!.policy).toEqual(expectedMediaPolicy(MUSTER_ACCESS));
    const [entry] = (await auditEntries('media.allowance_set', musterId)).slice(-1);
    expect(entry!.details).toMatchObject({ policy: { applied: 2, failed: ['lea-kemaro'] } });
  });

  it('refuses a maximum below the accounts the organization has', async () => {
    const res = await put(admin, `/admin/orgs/${musterId}/media-allowance`, musterBody({ maxAccounts: 2 }));
    expect(res.statusCode).toBe(409);
    expect(json(res).error).toMatchObject({
      code: 'account_limit',
      details: { maxAccounts: 2, accounts: 3 },
    });
    expect((await allowanceOf(musterId))!.maxAccounts).toBe(5);
  });

  it('refuses to narrow a reseller below what its customers got', async () => {
    const alpenUrl = `/admin/orgs/${alpenId}/media-allowance`;
    const huberUrl = `/admin/orgs/${huberId}/media-allowance`;
    const huberBody = { providerId: demo.id, maxAccounts: 3, ...HUBER_ACCESS };
    // Staff may give a customer more than its reseller has.
    const generous = await put(admin, huberUrl, { ...huberBody, downloads: true });
    expect(generous.statusCode, generous.body).toBe(200);
    try {
      const res = await put(admin, alpenUrl, {
        providerId: demo.id,
        maxAccounts: 20,
        libraryIds: [LIB.Filme, LIB.Serien],
        maxStreams: 1,
        downloads: false,
        remoteBitrateMbit: 10,
      });
      expect(res.statusCode).toBe(409);
      expect(json(res).error).toMatchObject({
        code: 'allowance_conflict',
        details: {
          customers: [
            {
              id: huberId,
              name: 'Bäckerei Huber',
              conflicts: ['libraries', 'streams', 'downloads', 'bitrate'],
            },
          ],
        },
      });
      expect(json(res).error.message).toMatch(/Bäckerei Huber/);
      const fewer = await put(admin, alpenUrl, {
        providerId: demo.id,
        maxAccounts: 2,
        ...ALPEN_ACCESS,
        remoteBitrateMbit: null,
      });
      expect(fewer.statusCode).toBe(409);
      expect(json(fewer).error.details.customers).toEqual([
        { id: huberId, name: 'Bäckerei Huber', conflicts: ['accounts'] },
      ]);
      expect((await allowanceOf(alpenId))!.maxAccounts).toBe(20);
    } finally {
      expect((await put(admin, huberUrl, huberBody)).statusCode).toBe(200);
    }
  });

  it('deletes an allowance only without accounts and guards organization deletion', async () => {
    const del = await admin.del(`/admin/orgs/${musterId}/media-allowance`);
    expect(del.statusCode).toBe(409);
    expect(json(del).error.message).toMatch(/streaming accounts/);
    // A reseller cannot lose its allowance while customers draw from it.
    const reseller = await admin.del(`/admin/orgs/${alpenId}/media-allowance`);
    expect(reseller.statusCode).toBe(409);
    expect(json(reseller).error.message).toMatch(/customers/);

    const org = await newOrg('Weg AG', 'weg-ag');
    const res = await put(admin, `/admin/orgs/${org.id}/media-allowance`, beispielBody({ maxAccounts: 1 }));
    expect(res.statusCode, res.body).toBe(200);
    const owner = await newUser('owner@weg.example', { orgId: org.id, role: 'owner' });
    const { account } = await created(owner, org.id, { name: 'weg' });
    const blocked = await admin.del(`/admin/orgs/${org.id}`);
    expect(blocked.statusCode).toBe(409);
    expect(json(blocked).error.message).toMatch(/1 streaming accounts, 1 streaming allowance/);
    expect((await remove(owner, account.id, account.username)).statusCode).toBe(200);
    const onlyAllowance = await admin.del(`/admin/orgs/${org.id}`);
    expect(onlyAllowance.statusCode).toBe(409);
    expect(json(onlyAllowance).error.message).toMatch(/streaming allowance/);
    expect((await admin.del(`/admin/orgs/${org.id}/media-allowance`)).statusCode).toBe(200);
    const [entry] = await auditEntries('media.allowance_delete', org.id);
    expect(entry).toMatchObject({ resourceType: 'media_allowance', details: { maxAccounts: 1 } });
    expect((await admin.del(`/admin/orgs/${org.id}/media-allowance`)).statusCode).toBe(404);
    expect((await admin.del(`/admin/orgs/${org.id}`)).statusCode).toBe(200);
  });
});

describe('reseller allowances', () => {
  const url = (orgId: string) => `/reseller/customers/${orgId}/media-allowance`;
  const within = {
    maxAccounts: 3,
    libraryIds: [LIB.Kinder],
    maxStreams: 1,
    downloads: true,
    remoteBitrateMbit: 10,
  };

  it('shows and changes the allowance of its customers within its own', async () => {
    expect(json<MediaAllowanceDto>(await reto.get(url(huberId)))).toMatchObject({
      accountCode: 'bivane',
      maxAccounts: 3,
      accounts: 1,
    });
    const outside = await put(reto, url(huberId), { ...within, libraryIds: [LIB.Dokumentationen] });
    expect(outside.statusCode).toBe(409);
    expect(json(outside).error).toMatchObject({
      code: 'allowance_conflict',
      details: { customers: [{ id: huberId, conflicts: ['libraries'] }] },
    });
    const streams = await put(reto, url(huberId), { ...within, maxStreams: 4 });
    expect(json(streams).error.details.customers[0].conflicts).toEqual(['streams']);
    // Alpen limits the bitrate, so its customers need a limit too.
    const unlimited = await put(reto, url(huberId), { ...within, remoteBitrateMbit: null });
    expect(unlimited.statusCode).toBe(409);
    expect(json(unlimited).error.details.customers[0].conflicts).toEqual(['bitrate']);
    const faster = await put(reto, url(huberId), { ...within, remoteBitrateMbit: 21 });
    expect(json(faster).error.details.customers[0].conflicts).toEqual(['bitrate']);
    const many = await put(reto, url(huberId), { ...within, maxAccounts: 21 });
    expect(many.statusCode).toBe(409);
    expect(json(many).error).toMatchObject({
      code: 'account_limit',
      message: expect.stringMatching(/Only 20 accounts/),
    });

    // Within: the module switches on and the access reaches the customer's accounts.
    await setModules(
      huberId,
      (await modulesOf(huberId)).filter((m) => m !== 'media'),
    );
    const res = await put(reto, url(huberId), within);
    expect(res.statusCode, res.body).toBe(200);
    const result = json<MediaAllowanceChangeResult>(res);
    expect(result.allowance).toMatchObject({
      accountCode: 'bivane',
      provider: { id: demo.id },
      libraries: [{ id: LIB.Kinder, name: 'Kinder', type: 'movies' }],
      maxStreams: 1,
      downloads: true,
      remoteBitrateMbit: 10,
    });
    expect(result.policy).toEqual({ applied: 1, failed: [] });
    expect(await modulesOf(huberId)).toContain('media');
    expect(demoUser('huber-bivane')!.policy).toMatchObject({
      libraryIds: [LIB.Kinder],
      maxSessions: 1,
      downloads: true,
      conversion: true,
      remoteBitrateBps: 10_000_000,
      allLibraries: false,
    });
    const [entry] = (await auditEntries('media.allowance_set', huberId)).slice(-1);
    expect(entry).toMatchObject({
      orgId: alpenId,
      details: { customerId: huberId, moduleEnabled: 'media', policy: { applied: 1, failed: [] } },
    });
    expect((await orgMedia(hanna, huberId)).allowance!.maxStreams).toBe(1);
    // The reseller's own allowance counts the customer's share.
    expect(json<MediaAllowanceDto>(await admin.get(`/admin/orgs/${alpenId}/media-allowance`))).toMatchObject({
      accounts: 3,
      customers: 1,
    });
  });

  it('hands out a share to new customers with a generated code, and takes it back without accounts', async () => {
    const { customer } = json(await reto.post(`/orgs/${alpenId}/customers`, { name: 'Kurzzeit Kunde' }));
    const res = await put(reto, url(customer.id), { ...within, maxAccounts: 17 });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<MediaAllowanceChangeResult>(res).allowance.accountCode).toMatch(
      /^([bdfghjkmnprstvwz][aeiu]){3}$/,
    );
    // Alpen is fully handed out now.
    const full = await put(reto, url(huberId), { ...within, maxAccounts: 4 });
    expect(full.statusCode).toBe(409);
    expect(json(full).error.message).toMatch(/Only 3 accounts/);
    const blocked = await reto.del(`/orgs/${alpenId}/customers/${customer.id}`);
    expect(blocked.statusCode).toBe(409);
    expect(json(blocked).error.message).toMatch(/streaming allowance/);
    // Huber still has its account.
    expect((await reto.del(url(huberId))).statusCode).toBe(409);
    expect((await hanna.del(url(customer.id))).statusCode).toBe(404);
    expect((await reto.del(url(customer.id))).statusCode).toBe(200);
    const [entry] = await auditEntries('media.allowance_delete', customer.id);
    expect(entry).toMatchObject({ orgId: alpenId, details: { customerId: customer.id } });
    expect((await reto.del(url(customer.id))).statusCode).toBe(404);
    expect((await reto.del(`/orgs/${alpenId}/customers/${customer.id}`)).statusCode).toBe(200);
  });

  it('is only for the reseller of the customer, with the module and an allowance of its own', async () => {
    expect((await anna.get(url(huberId))).statusCode).toBe(404);
    expect((await put(anna, url(huberId), within)).statusCode).toBe(404);
    // The customer itself cannot raise its own allowance.
    expect((await put(hanna, url(huberId), { ...within, maxStreams: 3 })).statusCode).toBe(404);
    // Organizations without a reseller are no customers.
    expect((await reto.get(url(musterId))).statusCode).toBe(404);
    const other = await newOrg('Fremd Reseller', 'fremd-reseller', {
      kind: 'reseller',
      modules: ['servers', 'media'],
    });
    const otherOwner = await newUser('owner@fremd.example', { orgId: other.id, role: 'owner' });
    expect((await otherOwner.get(url(huberId))).statusCode).toBe(404);
    // Viewers of the reseller can look, not change.
    const viewer = await newUser('viewer@alpen.example', { orgId: alpenId, role: 'viewer' });
    expect((await viewer.get(url(huberId))).statusCode).toBe(200);
    expect((await put(viewer, url(huberId), within)).statusCode).toBe(403);
    // Without an allowance of its own, or without the module, nothing to hand out.
    const otherCustomer = await newOrg('Fremd Kunde', 'fremd-kunde', { parentOrgId: other.id });
    const none = await put(otherOwner, url(otherCustomer.id), within);
    expect(none.statusCode).toBe(409);
    expect(json(none).error.code).toBe('no_allowance');
    await setModules(other.id, ['servers']);
    const noModule = await put(otherOwner, url(otherCustomer.id), within);
    expect(noModule.statusCode).toBe(409);
    expect(json(noModule).error.message).toMatch(/module/);
  });
});

describe('admin accounts', () => {
  it('lists accounts with filters', async () => {
    const all = json<MediaAccountDto[]>(await admin.get('/admin/media/accounts'));
    expect(all.map((a) => a.username)).toEqual(
      expect.arrayContaining(['anna-kemaro', 'huber-bivane', 'lea-kemaro']),
    );
    expect(all).toHaveLength(4 + 30);
    expect(all.map((a) => a.username)).toEqual([...all.map((a) => a.username)].sort());
    const muster = json<MediaAccountDto[]>(await admin.get(`/admin/media/accounts?orgId=${musterId}`));
    expect(muster.map((a) => a.username)).toEqual(['anna-kemaro', 'lea-kemaro', 'wohnzimmer-kemaro']);
    const search = json<MediaAccountDto[]>(await admin.get('/admin/media/accounts?q=huber'));
    expect(search.map((a) => a.username)).toEqual(['huber-bivane']);
    const onDemo = json<MediaAccountDto[]>(await admin.get(`/admin/media/accounts?providerId=${demo.id}`));
    expect(onDemo.every((a) => a.provider.id === demo.id)).toBe(true);
    expect(onDemo.map((a) => a.username)).toEqual([
      'anna-kemaro',
      'huber-bivane',
      'lea-kemaro',
      'wohnzimmer-kemaro',
    ]);
    const issues = json<MediaAccountDto[]>(await admin.get('/admin/media/accounts?issues=true'));
    expect(issues.map((a) => a.username)).toEqual(['lea-kemaro']);
    expect((await admin.get('/admin/media/accounts?issues=maybe')).statusCode).toBe(400);
    expect((await anna.get('/admin/media/accounts')).statusCode).toBe(403);
  });

  it('lists the users the console does not manage, flagging those it cannot import', async () => {
    const res = await admin.get(`/admin/providers/${demo.id}/media/unmanaged`);
    expect(res.statusCode, res.body).toBe(200);
    const unmanaged = json<UnmanagedMediaUserDto[]>(res);
    expect(unmanaged.map((u) => [u.username, u.blocked])).toEqual([
      ['altkunde', 'blocked_folders'],
      ['ben-kemaro', null],
      ['gast', null],
      ['weblion-admin', 'administrator'],
    ]);
    expect(unmanaged.find((u) => u.username === 'gast')).toEqual({
      userId: DEMO_MEDIA_IDS.gast,
      username: 'gast',
      enabled: true,
      administrator: false,
      hasPassword: false,
      lastActiveOn: null,
      blocked: null,
    });
    expect(unmanaged.find((u) => u.username === 'ben-kemaro')!.lastActiveOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await anna.get(`/admin/providers/${demo.id}/media/unmanaged`)).statusCode).toBe(403);
  });

  it('imports users, with the allowance policy and a new password where needed', async () => {
    const ben = DEMO_MEDIA_IDS['ben-kemaro'];
    const res = await admin.post('/admin/media/accounts/import', {
      providerId: demo.id,
      userId: ben,
      orgId: musterId,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const { account, password } = json<MediaAccountSecretDto>(res);
    expect(password).toBeNull();
    expect(account).toMatchObject({ username: 'ben-kemaro', org: { id: musterId }, issues: [] });
    expect(demoUser('ben-kemaro')!.policy).toEqual(expectedMediaPolicy(MUSTER_ACCESS));
    expect(demoUser('ben-kemaro')!.policy.allLibraries).toBe(false);
    const [entry] = await auditEntries('media.account_import', account.id);
    expect(entry).toMatchObject({
      orgId: musterId,
      details: {
        username: 'ben-kemaro',
        userId: ben,
        providerId: demo.id,
        orgId: musterId,
        passwordSet: false,
      },
    });
    const again = await admin.post('/admin/media/accounts/import', {
      providerId: demo.id,
      userId: ben,
      orgId: null,
    });
    expect(again.statusCode).toBe(409);
    expect(json(again).error.message).toMatch(/managed already/);

    const gast = { providerId: demo.id, userId: DEMO_MEDIA_IDS.gast, orgId: null };
    const noPassword = await admin.post('/admin/media/accounts/import', gast);
    expect(noPassword.statusCode).toBe(409);
    expect(json(noPassword).error.code).toBe('no_password');
    const withPassword = await admin.post('/admin/media/accounts/import', { ...gast, setPassword: true });
    expect(withPassword.statusCode, withPassword.body).toBe(200);
    expect(withPassword.headers['cache-control']).toBe('no-store');
    const imported = json<MediaAccountSecretDto>(withPassword);
    expect(imported.password).toMatch(GENERATED);
    expect(imported.account).toMatchObject({ username: 'gast', org: null, hasPassword: true, issues: [] });
    expect(demoUser('gast')!.password).toBe(imported.password);
    // Unassigned: Jellyfin's policy stays as it is.
    expect(demoUser('gast')!.policy).toEqual(jellyfinDefaultPolicy());
    const [gastEntry] = await auditEntries('media.account_import', imported.account.id);
    expect(gastEntry!.details).toMatchObject({ passwordSet: true });
    expect(JSON.stringify(gastEntry)).not.toContain(imported.password!);

    const admins = await admin.post('/admin/media/accounts/import', {
      ...gast,
      userId: DEMO_MEDIA_IDS['weblion-admin'],
    });
    expect(admins.statusCode).toBe(409);
    expect(json(admins).error.message).toMatch(/administrators/);
    const blocked = await admin.post('/admin/media/accounts/import', {
      ...gast,
      userId: DEMO_MEDIA_IDS.altkunde,
    });
    expect(blocked.statusCode).toBe(409);
    expect(json(blocked).error.message).toMatch(/blocked libraries/);
    expect((await admin.post('/admin/media/accounts/import', { ...gast, userId: 'xyz' })).statusCode).toBe(
      400,
    );
    const nobody = await admin.post('/admin/media/accounts/import', {
      ...gast,
      userId: '0123ABCD-0123-0123-0123-0123456789AB',
    });
    expect(nobody.statusCode).toBe(404);
    const without = await newOrg('Ohne AG', 'ohne-ag');
    const noAllowance = await admin.post('/admin/media/accounts/import', {
      ...gast,
      userId: DEMO_MEDIA_IDS['wohnzimmer-kemaro'],
      orgId: without.id,
    });
    expect(noAllowance.statusCode).toBe(409);
    expect(json(noAllowance).error.code).toBe('no_allowance');
    expect(
      json(await admin.get(`/admin/providers/${demo.id}/media/unmanaged`)).map((u: any) => u.username),
    ).toEqual(['altkunde', 'weblion-admin']);
  });

  it('assigns accounts to organizations with an allowance on their instance', async () => {
    const id = await accountId('gast');
    const without = await orgBySlug('ohne-ag');
    const none = await admin.post(`/admin/media/accounts/${id}/assign`, { orgId: without.id });
    expect(none.statusCode).toBe(409);
    expect(json(none).error.code).toBe('no_allowance');
    // Viel AG has its allowance on another instance.
    const viel = await orgBySlug('viel-ag');
    const elsewhere = await admin.post(`/admin/media/accounts/${id}/assign`, { orgId: viel.id });
    expect(elsewhere.statusCode).toBe(409);
    expect(json(elsewhere).error.message).toMatch(/another instance/);
    // A refused policy write rolls the assignment back.
    const refused = await refusingPolicy(DEMO_MEDIA_IDS.gast, () =>
      admin.post(`/admin/media/accounts/${id}/assign`, { orgId: beispielId }),
    );
    expect(refused.statusCode).toBe(502);
    expect((await stored('gast'))!.orgId).toBeNull();

    const assigned = await admin.post(`/admin/media/accounts/${id}/assign`, { orgId: beispielId });
    expect(assigned.statusCode, assigned.body).toBe(200);
    expect(json<MediaAccountDto>(assigned)).toMatchObject({ org: { id: beispielId }, issues: [] });
    const beispielPolicy = expectedMediaPolicy({
      libraryIds: [LIB.Filme!],
      maxStreams: 1,
      downloads: false,
      remoteBitrateMbit: null,
    });
    expect(demoUser('gast')!.policy).toEqual(beispielPolicy);
    expect((await orgMedia(dev, beispielId)).accounts.map((a) => a.username)).toEqual(['gast']);

    // Unassigned, the account keeps its policy and keeps working.
    const unassigned = await admin.post(`/admin/media/accounts/${id}/assign`, { orgId: null });
    expect(json<MediaAccountDto>(unassigned).org).toBeNull();
    expect(demoUser('gast')).toMatchObject({ enabled: true, policy: beispielPolicy });
    const entries = await auditEntries('media.account_assign', id);
    expect(entries.map((e) => [e.status, (e.details as any).orgId])).toEqual([
      ['failure', beispielId],
      ['success', beispielId],
      ['success', null],
    ]);
    expect((await anna.post(`/admin/media/accounts/${id}/assign`, { orgId: musterId })).statusCode).toBe(403);
  });

  it('writes the policy of one account on request', async () => {
    const id = await accountId('lea-kemaro');
    expect((await stored('lea-kemaro'))!.issues).toEqual(['policy']);
    const res = await admin.post(`/admin/media/accounts/${id}/repair`);
    expect(res.statusCode, res.body).toBe(200);
    expect(json<MediaAccountDto>(res).issues).toEqual([]);
    expect(demoUser('lea-kemaro')!.policy).toEqual(expectedMediaPolicy(MUSTER_ACCESS));
    const [entry] = await auditEntries('media.policy_repair', id);
    expect(entry).toMatchObject({
      orgId: musterId,
      details: { username: 'lea-kemaro', fields: ['libraryIds', 'maxSessions'] },
    });
    expect(entry!.actorName).not.toBe('Sync');
    const unassigned = await admin.post(`/admin/media/accounts/${await accountId('gast')}/repair`);
    expect(unassigned.statusCode).toBe(409);
    expect(json(unassigned).error.code).toBe('no_allowance');
    expect((await anna.post(`/admin/media/accounts/${id}/repair`)).statusCode).toBe(403);
  });
});

describe('instances', () => {
  it('lists the instances with stored counts and live numbers only', async () => {
    let instances = json<MediaInstanceDto[]>(await admin.get('/admin/media/instances'));
    const find = (id: string) => instances.find((i) => i.provider.id === id)!;
    expect(instances.map((i) => i.provider.id)).toEqual(
      expect.arrayContaining([demo.id, second.id, crowded.id]),
    );
    const seeded = await t.db
      .select()
      .from(mediaAllowances)
      .where(eq(mediaAllowances.providerConnectionId, demo.id));
    expect(find(demo.id)).toMatchObject({
      provider: { type: 'demo', url: DEMO_MEDIA_URL, enabled: true },
      organizations: seeded.length,
      accounts: 6,
      accountsWithIssues: 0,
      // The seeded users and lea-kemaro.
      live: { serverName: 'Demo Jellyfin', version: '10.11.11', users: 8, libraries: 5, quickConnect: true },
      error: null,
    });
    expect(seeded.length).toBeGreaterThanOrEqual(3);
    expect(find(second.id)).toMatchObject({
      organizations: 0,
      accounts: 0,
      live: { version: '10.11.11', users: 7 },
    });
    expect(find(crowded.id)).toMatchObject({ organizations: 1, accounts: 30, live: { users: 37 } });
    // Counts only: never names, titles or devices.
    expect(JSON.stringify(instances)).not.toMatch(/anna-kemaro|weblion-admin/);

    // A dedicated instance: one organization, a readable code, its own accounts.
    const dedicated = await newOrg('Dediziert AG', 'dediziert-ag');
    const res = await put(admin, `/admin/orgs/${dedicated.id}/media-allowance`, {
      providerId: second.id,
      accountCode: 'dediziert',
      maxAccounts: 2,
      libraryIds: [LIB.Filme, LIB.Musik],
      maxStreams: 4,
      downloads: true,
      remoteBitrateMbit: null,
    });
    expect(res.statusCode, res.body).toBe(200);
    const owner = await newUser('owner@dediziert.example', { orgId: dedicated.id, role: 'owner' });
    const { account } = await created(owner, dedicated.id, { name: 'anna' });
    expect(account).toMatchObject({ username: 'anna-dediziert', provider: { id: second.id } });
    expect(demoUser('anna-dediziert', second.id)).toBeDefined();
    expect(demoUser('anna-dediziert')).toBeUndefined();
    // The second instance's own anna-kemaro is not the managed one of the first.
    const unmanagedHere = json<UnmanagedMediaUserDto[]>(
      await admin.get(`/admin/providers/${second.id}/media/unmanaged`),
    );
    expect(unmanagedHere.map((u) => u.username)).toContain('anna-kemaro');
    expect(unmanagedHere.map((u) => u.username)).not.toContain('anna-dediziert');
    expect(
      json<MediaAccountDto[]>(await admin.get(`/admin/media/accounts?providerId=${second.id}`)).map(
        (a) => a.username,
      ),
    ).toEqual(['anna-dediziert']);

    // Activity: two numbers.
    demoUser('anna-dediziert', second.id)!.lastActivityAt = new Date().toISOString();
    instances = json<MediaInstanceDto[]>(await admin.get('/admin/media/instances'));
    expect(find(second.id)).toMatchObject({
      organizations: 1,
      accounts: 1,
      live: { users: 8, activeSessions: 1, playing: 1 },
    });
    expect(find(demo.id).live).toMatchObject({ activeSessions: 0, playing: 0 });
    // Providers without streaming are not listed.
    expect(instances.every((i) => i.provider.type === 'demo' || i.provider.type === 'jellyfin')).toBe(true);
  });

  it('refuses to delete an instance while an allowance or an assigned account references it', async () => {
    const dedicated = await orgBySlug('dediziert-ag');
    const owner = new Client(t.app);
    await owner.login('owner@dediziert.example');
    await t.db.insert(mediaAccounts).values({
      providerConnectionId: second.id,
      externalId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      username: 'loser-benutzer',
      orgId: null,
    });
    const blocked = await admin.del(`/admin/providers/${second.id}`);
    expect(blocked.statusCode).toBe(409);
    expect(json(blocked).error.message).toMatch(/streaming/);
    const id = (await stored('anna-dediziert', second.id))!.id;
    expect((await remove(owner, id, 'anna-dediziert')).statusCode).toBe(200);
    expect((await admin.del(`/admin/providers/${second.id}`)).statusCode).toBe(409);
    expect((await admin.del(`/admin/orgs/${dedicated.id}/media-allowance`)).statusCode).toBe(200);
    expect((await admin.del(`/admin/providers/${second.id}`)).statusCode).toBe(200);
    // Unassigned rows go with it.
    expect(await stored('loser-benutzer', second.id)).toBeUndefined();
  });
});

describe('secrets', () => {
  it('audits explorer writes without passwords', async () => {
    const secret = 'Explorer-Geheimnis-4711';
    const res = await admin.post('/admin/explorer', {
      providerId: demo.id,
      method: 'POST',
      path: `/Users/Password?userId=${DEMO_MEDIA_IDS['anna-kemaro']}`,
      body: { NewPw: secret, CurrentPw: `${secret}-alt`, ResetPassword: false },
    });
    expect(res.statusCode, res.body).toBe(200);
    const [entry] = (await auditEntries('provider.explorer', demo.id)).slice(-1);
    expect(entry!.details).toMatchObject({
      method: 'POST',
      path: `/Users/Password?userId=${DEMO_MEDIA_IDS['anna-kemaro']}`,
      body: { NewPw: '[redacted]', CurrentPw: '[redacted]' },
    });
    expect(JSON.stringify(entry)).not.toContain(secret);

    await admin.post('/admin/explorer', {
      providerId: demo.id,
      method: 'POST',
      path: '/Users/New',
      body: { Name: 'explorer-test', Password: `${secret}-neu` },
    });
    const [newUserEntry] = (await auditEntries('provider.explorer', demo.id)).slice(-1);
    expect(newUserEntry!.details).toMatchObject({ body: { Name: 'explorer-test', Password: '[redacted]' } });
    expect(JSON.stringify(newUserEntry)).not.toContain(secret);

    expect(redactExplorerBody({ Pw: 'a', Pin: '1234', nested: { NewPw: 'b' }, Name: 'anna' })).toEqual({
      Pw: '[redacted]',
      Pin: '[redacted]',
      nested: { NewPw: '[redacted]' },
      Name: 'anna',
    });
    expect(redactExplorerPath('/Users/abc/Authenticate?pw=geheim&x=1')).toBe(
      '/Users/abc/Authenticate?pw=[redacted]&x=1',
    );
  });

  it('shows no part of a Jellyfin API key', async () => {
    const apiKey = 'a3f1c2d4e5b6a7980f1e2d3c4b5a6978';
    const summary = configSummary('jellyfin', { baseUrl: 'https://media.example.invalid/jellyfin', apiKey });
    expect(summary).toEqual({ baseUrl: 'https://media.example.invalid/jellyfin', apiKey: '••••••' });
    const connection = await newConnection('jellyfin', 'Jellyfin Echt', {
      baseUrl: 'https://media.example.invalid/jellyfin',
      apiKey,
    });
    try {
      const res = await admin.get('/admin/providers');
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Jellyfin Echt');
      for (const part of [apiKey, apiKey.slice(0, 6), apiKey.slice(-6)]) expect(res.body).not.toContain(part);
    } finally {
      await t.db.delete(providerConnections).where(eq(providerConnections.id, connection.id));
    }
  });
});
