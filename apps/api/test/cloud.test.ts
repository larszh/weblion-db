import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  DEFAULT_CUSTOMER_BOUNDARY,
  DEFAULT_RESELLER_BOUNDARY,
  type CloudAccountDto,
  type CloudAccountSecretDto,
  type CloudAllowanceDto,
  type ModuleKey,
  type OrgCloudDto,
  type OrgKind,
} from '@weblion/shared';
import {
  auditLogs,
  cloudAccounts,
  cloudAllowances,
  memberships,
  organizations,
  providerConnections,
  users,
  type ProviderConnection,
} from '../src/db/schema';
import { hashPassword } from '../src/lib/crypto';
import { configSummary } from '../src/modules/admin/routes';
import { generateCloudPassword } from '../src/modules/cloud/service';
import { DemoAdapter } from '../src/providers/demo/adapter';
import { DEMO_CLOUD_URL, demoCloudState } from '../src/providers/demo/cloud';
import { ADMIN, Client, createTestApp, DEMO_PASSWORD, json, type TestApp } from './helpers';

const GiB = 1024 ** 3;

let t: TestApp;
let admin: Client;
let anna: Client;
let carla: Client;
let dev: Client;
let reto: Client;
let hanna: Client;
let demo: ProviderConnection;
let musterId: string;
let beispielId: string;
let alpenId: string;
let huberId: string;

const put = (client: Client, url: string, body: unknown) => client.request('PUT', url, body);

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
    .where(and(eq(auditLogs.action, action), resourceId ? eq(auditLogs.resourceId, resourceId) : undefined));
}

async function storedAccount(externalId: string) {
  return t.db.query.cloudAccounts.findFirst({ where: eq(cloudAccounts.externalId, externalId) });
}

const demoUsers = () => demoCloudState(demo.id).users;

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

/** A second provider connection, stored like one created in the admin UI. */
async function newConnection(type: 'demo' | 'joker', name: string) {
  const config =
    type === 'demo' ? {} : { apiKey: 'joker-test-key', baseUrl: 'https://dmapi.invalid/request' };
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

async function create(client: Client, orgId: string, body: Record<string, unknown>) {
  return client.post(`/orgs/${orgId}/cloud/accounts`, body);
}

async function orgCloud(client: Client, orgId: string) {
  return json<OrgCloudDto>(await client.get(`/orgs/${orgId}/cloud`));
}

async function accountId(externalId: string) {
  return (await storedAccount(externalId))!.id;
}

/** Runs `during` while a sync of the demo instance holds on to the user list it has read. */
async function duringSync(during: () => Promise<void>) {
  const original = DemoAdapter.prototype.listCloudAccounts;
  let listed!: () => void;
  let release!: () => void;
  const read = new Promise<void>((resolve) => (listed = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  DemoAdapter.prototype.listCloudAccounts = async function (this: DemoAdapter) {
    const users = await original.call(this);
    listed();
    await gate;
    return users;
  };
  try {
    const sync = admin.post(`/admin/providers/${demo.id}/sync`);
    await read;
    try {
      await during();
    } finally {
      release();
    }
    const res = await sync;
    expect(res.statusCode, res.body).toBe(200);
    return json(res);
  } finally {
    DemoAdapter.prototype.listCloudAccounts = original;
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
  demo = (await t.db.query.providerConnections.findFirst({ where: eq(providerConnections.type, 'demo') }))!;
  musterId = (await orgBySlug('muster-ag')).id;
  beispielId = (await orgBySlug('beispiel-gmbh')).id;
  alpenId = (await orgBySlug('alpen-hosting')).id;
  huberId = (await orgBySlug('baeckerei-huber')).id;
  // The seed gives the reseller and its customer allowances, but leaves their modules alone.
  for (const id of [alpenId, huberId]) await setModules(id, [...(await modulesOf(id)), 'storage']);
});

afterAll(async () => {
  await t?.close();
});

describe('passwords', () => {
  it('generates 20 characters of every class without look-alikes', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const password = generateCloudPassword();
      expect(password).toHaveLength(20);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[2-9]/);
      expect(password).toMatch(/[^a-zA-Z0-9]/);
      expect(password).not.toMatch(/[IlO01\s'"\\]/);
      seen.add(password);
    }
    expect(seen.size).toBe(200);
  });
});

describe('seed and sync', () => {
  it('seeds allowances and accounts from the demo instance', async () => {
    const cloud = await orgCloud(anna, musterId);
    expect(cloud.allowance).toMatchObject({
      orgId: musterId,
      provider: { id: demo.id, type: 'demo', url: DEMO_CLOUD_URL },
      quotaBytes: 500 * GiB,
      maxAccounts: 10,
      allocatedBytes: 60 * GiB,
      accounts: 2,
      customers: 0,
    });
    expect(cloud.allowance!.usedBytes).toBe(Math.round(12.4 * GiB) + Math.round(9.6 * GiB));
    expect(cloud.accounts.map((a) => a.username)).toEqual(['anna@muster-ag', 'buchhaltung@muster-ag']);
    const [annaAccount, books] = cloud.accounts;
    expect(annaAccount).toMatchObject({
      displayName: 'Anna Muster',
      email: 'anna@muster.example',
      quotaBytes: 50 * GiB,
      enabled: true,
      loginUrl: DEMO_CLOUD_URL,
      org: { id: musterId, slug: 'muster-ag' },
      missingSince: null,
    });
    expect(annaAccount!.permissions.sort()).toEqual(['cloud:password', 'cloud:read', 'cloud:write']);
    expect(books).toMatchObject({ enabled: false, email: null });
    expect(await modulesOf(musterId)).toContain('storage');

    // The reseller's allowance counts what it handed to its customer.
    const alpen = json<CloudAllowanceDto>(await admin.get(`/admin/orgs/${alpenId}/cloud-allowance`));
    expect(alpen).toMatchObject({
      quotaBytes: 1000 * GiB,
      maxAccounts: 50,
      allocatedBytes: 100 * GiB,
      accounts: 5,
      customers: 1,
    });
    expect((await orgCloud(hanna, huberId)).accounts.map((a) => a.username)).toEqual([
      'hanna@baeckerei-huber',
    ]);
    expect(json(await admin.get(`/admin/orgs/${beispielId}/cloud-allowance`))).toBeNull();
  });

  it('updates usage of known accounts and marks vanished ones as missing', async () => {
    const users = demoUsers();
    users.get('anna@muster-ag')!.usedBytes = 20 * GiB;
    users.get('anna@muster-ag')!.lastLoginAt = '2026-10-01T08:00:00.000Z';
    const removed = users.get('buchhaltung@muster-ag')!;
    users.delete('buchhaltung@muster-ag');
    const before = await t.db.select().from(cloudAccounts);
    try {
      const result = json(await admin.post(`/admin/providers/${demo.id}/sync`));
      expect(result.cloudAccounts).toEqual({ seen: 2, missing: 1 });
      const annaRow = await storedAccount('anna@muster-ag');
      expect(annaRow).toMatchObject({ usedBytes: 20 * GiB, missingSince: null });
      expect(annaRow!.lastLoginAt!.toISOString()).toBe('2026-10-01T08:00:00.000Z');
      expect(annaRow!.lastSyncedAt!.getTime()).toBeGreaterThan(before[0]!.lastSyncedAt!.getTime() - 1);
      const books = await storedAccount('buchhaltung@muster-ag');
      expect(books!.missingSince).not.toBeNull();
      expect(books!.orgId).toBe(musterId);
      // Users the panel does not manage never get a row.
      expect(await t.db.select().from(cloudAccounts)).toHaveLength(before.length);
    } finally {
      users.set('buchhaltung@muster-ag', removed);
    }
    await admin.post(`/admin/providers/${demo.id}/sync`);
    expect((await storedAccount('buchhaltung@muster-ag'))!.missingSince).toBeNull();
  });

  it('does not undo a change made while the user list was on its way', async () => {
    const id = await accountId('anna@muster-ag');
    await duringSync(async () => {
      const res = await anna.patch(`/cloud/accounts/${id}`, { quotaGb: 60 });
      expect(res.statusCode, res.body).toBe(200);
    });
    // The list still had 50 GB: written back, it would free 10 GB of the allowance.
    expect((await storedAccount('anna@muster-ag'))!.quotaBytes).toBe(60 * GiB);
    expect(demoUsers().get('anna@muster-ag')!.quotaBytes).toBe(60 * GiB);
    // The next run updates the row as usual.
    const remote = demoUsers().get('anna@muster-ag')!;
    remote.usedBytes += GiB;
    await admin.post(`/admin/providers/${demo.id}/sync`);
    expect((await storedAccount('anna@muster-ag'))!.usedBytes).toBe(remote.usedBytes);
    expect((await anna.patch(`/cloud/accounts/${id}`, { quotaGb: 50 })).statusCode).toBe(200);
  });

  it('does not take an account created during a sync as missing', async () => {
    const original = DemoAdapter.prototype.createCloudAccount;
    let entered!: () => void;
    let proceed!: () => void;
    const atInstance = new Promise<void>((resolve) => (entered = resolve));
    const go = new Promise<void>((resolve) => (proceed = resolve));
    DemoAdapter.prototype.createCloudAccount = async function (this: DemoAdapter, input) {
      entered();
      await go;
      return original.call(this, input);
    };
    let id = '';
    try {
      // The creation is on its way to the instance when the sync starts and reads the list.
      const created = create(anna, musterId, { name: 'during-sync', quotaGb: 1 });
      await atInstance;
      const result = await duringSync(async () => {
        proceed();
        const res = await created;
        expect(res.statusCode, res.body).toBe(200);
        id = json<CloudAccountSecretDto>(res).account.id;
      });
      expect(result.cloudAccounts.missing).toBe(0);
    } finally {
      DemoAdapter.prototype.createCloudAccount = original;
      proceed();
    }
    expect((await storedAccount('during-sync@muster-ag'))!.missingSince).toBeNull();
    expect((await anna.del(`/cloud/accounts/${id}`, { confirm: 'during-sync@muster-ag' })).statusCode).toBe(
      200,
    );
  });

  it('keeps quota and usage when Nextcloud cannot read a user’s storage', async () => {
    const remote = demoUsers().get('anna@muster-ag')!;
    const before = (await storedAccount('anna@muster-ag'))!;
    const { quotaBytes, usedBytes } = remote;
    // Nextcloud then answers with an empty quota object: neither quota nor usage.
    remote.quotaBytes = null;
    remote.usedBytes = null as unknown as number;
    try {
      await admin.post(`/admin/providers/${demo.id}/sync`);
      const row = (await storedAccount('anna@muster-ag'))!;
      expect(row).toMatchObject({ quotaBytes: before.quotaBytes, usedBytes: before.usedBytes });
      expect(row.lastSyncedAt!.getTime()).toBeGreaterThanOrEqual(before.lastSyncedAt!.getTime());
    } finally {
      remote.quotaBytes = quotaBytes;
      remote.usedBytes = usedBytes;
    }
  });
});

describe('accounts', () => {
  it('creates an account with a password shown once', async () => {
    const res = await create(anna, musterId, { name: 'max', displayName: 'Max Muster', quotaGb: 20 });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const { account, password } = json<CloudAccountSecretDto>(res);
    expect(password).toHaveLength(20);
    expect(account).toMatchObject({
      username: 'max@muster-ag',
      displayName: 'Max Muster',
      quotaBytes: 20 * GiB,
      usedBytes: 0,
      enabled: true,
      org: { id: musterId },
      loginUrl: DEMO_CLOUD_URL,
    });
    const remote = demoUsers().get('max@muster-ag')!;
    expect(remote.groups).toEqual(['weblion-muster-ag']);
    expect(remote.password).toBe(password);
    expect(remote.invites).toBe(0);

    const entries = await auditEntries('cloud.account_create', account.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.details).toMatchObject({ username: 'max@muster-ag', quotaBytes: 20 * GiB });
    expect(JSON.stringify(entries)).not.toContain(password!);
    expect(JSON.stringify(await t.db.select().from(cloudAccounts))).not.toContain(password!);
  });

  it('validates names and refuses duplicates', async () => {
    for (const name of ['Max', '-max', 'max-', 'a'.repeat(33), 'max muster', 'max@x', '']) {
      const res = await create(anna, musterId, { name, quotaGb: 1 });
      expect(res.statusCode, name).toBe(400);
    }
    expect((await create(anna, musterId, { name: 'ok', quotaGb: 0 })).statusCode).toBe(400);
    expect((await create(anna, musterId, { name: 'ok', quotaGb: 1.5 })).statusCode).toBe(400);
    // Nextcloud keeps 2000 GB as "2 TB" (2048 GB): from 1024 GB on only steps of 512 GB.
    for (const quotaGb of [1025, 1100, 2000]) {
      const res = await create(anna, musterId, { name: 'ok', quotaGb });
      expect(res.statusCode, String(quotaGb)).toBe(400);
      expect(json(res).error.details[0].path).toBe('quotaGb');
    }
    expect(json(await create(anna, musterId, { name: 'ok', quotaGb: 1536 })).error.code).toBe(
      'allowance_exceeded',
    );
    const max = await accountId('max@muster-ag');
    expect((await anna.patch(`/cloud/accounts/${max}`, { quotaGb: 1500 })).statusCode).toBe(400);
    expect(demoUsers().has('ok@muster-ag')).toBe(false);
    const dup = await create(anna, musterId, { name: 'max', quotaGb: 1 });
    expect(dup.statusCode).toBe(409);
    // ben@muster-ag exists at the instance, unmanaged.
    const unmanaged = await create(anna, musterId, { name: 'ben', quotaGb: 1 });
    expect(unmanaged.statusCode).toBe(409);
    expect(await storedAccount('ben@muster-ag')).toBeUndefined();
    const failed = await auditEntries('cloud.account_create');
    expect(
      failed.some((e) => e.status === 'failure' && (e.details as any).username === 'ben@muster-ag'),
    ).toBe(true);
  });

  it('keeps display names within what Nextcloud stores (64 characters)', async () => {
    const long = await create(anna, musterId, { name: 'longname', displayName: 'x'.repeat(65), quotaGb: 1 });
    expect(long.statusCode).toBe(400);
    expect(demoUsers().has('longname@muster-ag')).toBe(false);
    const res = await create(anna, musterId, { name: 'longname', displayName: 'x'.repeat(64), quotaGb: 1 });
    expect(res.statusCode, res.body).toBe(200);
    const { account } = json<CloudAccountSecretDto>(res);
    expect(account.displayName).toHaveLength(64);
    const patched = await anna.patch(`/cloud/accounts/${account.id}`, { displayName: 'y'.repeat(65) });
    expect(patched.statusCode).toBe(400);
    expect(
      (await anna.del(`/cloud/accounts/${account.id}`, { confirm: 'longname@muster-ag' })).statusCode,
    ).toBe(200);
  });

  it('lets Nextcloud invite the user instead', async () => {
    expect((await create(anna, musterId, { name: 'lea', quotaGb: 1, invite: true })).statusCode).toBe(400);
    const res = await create(anna, musterId, {
      name: 'lea',
      quotaGb: 1,
      invite: true,
      email: 'lea@muster.example',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<CloudAccountSecretDto>(res)).toMatchObject({
      password: null,
      account: { username: 'lea@muster-ag', email: 'lea@muster.example' },
    });
    expect(demoUsers().get('lea@muster-ag')!).toMatchObject({ password: null, invites: 1 });
  });

  it('gives API tokens no passwords', async () => {
    const { token } = json(
      await anna.post(`/orgs/${musterId}/tokens`, { name: 'cloud-bot', scope: 'read_write' }),
    );
    const bot = new Client(t.app);
    bot.bearer = token;
    const refused = await create(bot, musterId, { name: 'bot', quotaGb: 1 });
    expect(refused.statusCode).toBe(400);
    expect(json(refused).error.message).toMatch(/invite/);
    expect(demoUsers().has('bot@muster-ag')).toBe(false);
    const res = await create(bot, musterId, {
      name: 'bot',
      quotaGb: 1,
      invite: true,
      email: 'bot@muster.example',
    });
    expect(res.statusCode, res.body).toBe(200);
    const { account, password } = json<CloudAccountSecretDto>(res);
    expect(password).toBeNull();
    // Tokens can manage accounts but never set passwords.
    expect(account.permissions.sort()).toEqual(['cloud:read', 'cloud:write']);
    expect((await bot.post(`/cloud/accounts/${account.id}/password`)).statusCode).toBe(403);
    // Nor through the address that gets the invitation and password reset links.
    const takeover = await bot.patch(`/cloud/accounts/${account.id}`, { email: 'evil@attacker.example' });
    expect(takeover.statusCode).toBe(403);
    expect((await bot.post(`/cloud/accounts/${account.id}/invite`)).statusCode).toBe(403);
    expect(demoUsers().get('bot@muster-ag')).toMatchObject({ email: 'bot@muster.example', invites: 1 });
    expect((await bot.patch(`/cloud/accounts/${account.id}`, { quotaGb: 2 })).statusCode).toBe(200);
    expect((await bot.del(`/cloud/accounts/${account.id}`, { confirm: 'bot@muster-ag' })).statusCode).toBe(
      200,
    );
  });

  it('keeps accounts within the allowance', async () => {
    const { allowance } = await orgCloud(anna, musterId);
    const free = (allowance!.quotaBytes - allowance!.allocatedBytes) / GiB;
    const res = await create(anna, musterId, { name: 'big', quotaGb: free + 1 });
    expect(res.statusCode).toBe(409);
    expect(json(res).error.code).toBe('allowance_exceeded');
    expect(demoUsers().has('big@muster-ag')).toBe(false);
    const fits = await create(anna, musterId, { name: 'big', quotaGb: free });
    expect(fits.statusCode, fits.body).toBe(200);
    expect((await orgCloud(anna, musterId)).allowance!.allocatedBytes).toBe(500 * GiB);
    expect(
      (
        await anna.del(`/cloud/accounts/${json<CloudAccountSecretDto>(fits).account.id}`, {
          confirm: 'big@muster-ag',
        })
      ).statusCode,
    ).toBe(200);
  });

  it('keeps to the maximum number of accounts', async () => {
    const { allowance } = await orgCloud(anna, musterId);
    const body = { providerId: demo.id, quotaGb: 500, maxAccounts: allowance!.accounts };
    expect((await put(admin, `/admin/orgs/${musterId}/cloud-allowance`, body)).statusCode).toBe(200);
    try {
      const res = await create(anna, musterId, { name: 'one-more', quotaGb: 1 });
      expect(res.statusCode).toBe(409);
      expect(json(res).error.code).toBe('account_limit');
    } finally {
      await put(admin, `/admin/orgs/${musterId}/cloud-allowance`, { ...body, maxAccounts: 10 });
    }
  });

  it('does not overshoot the allowance with parallel requests', async () => {
    const { allowance } = await orgCloud(anna, musterId);
    const free = (allowance!.quotaBytes - allowance!.allocatedBytes) / GiB;
    // Room for one of the two only.
    const quotaGb = Math.floor(free / 2) + 1;
    const results = await Promise.all([
      create(anna, musterId, { name: 'race-a', quotaGb }),
      create(anna, musterId, { name: 'race-b', quotaGb }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const after = (await orgCloud(anna, musterId)).allowance!;
    expect(after.allocatedBytes).toBeLessThanOrEqual(after.quotaBytes);

    // Same for the number of accounts.
    await put(admin, `/admin/orgs/${musterId}/cloud-allowance`, {
      providerId: demo.id,
      quotaGb: 500,
      maxAccounts: after.accounts + 1,
    });
    try {
      const pair = await Promise.all([
        create(anna, musterId, { name: 'race-c', quotaGb: 1 }),
        create(anna, musterId, { name: 'race-d', quotaGb: 1 }),
      ]);
      expect(pair.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      expect((await orgCloud(anna, musterId)).accounts).toHaveLength(after.accounts + 1);
    } finally {
      await put(admin, `/admin/orgs/${musterId}/cloud-allowance`, {
        providerId: demo.id,
        quotaGb: 500,
        maxAccounts: 20,
      });
    }
    // Clean up, so later tests have room.
    for (const name of ['race-a', 'race-b', 'race-c', 'race-d']) {
      const row = await storedAccount(`${name}@muster-ag`);
      if (row) await anna.del(`/cloud/accounts/${row.id}`, { confirm: row.externalId });
    }
  });

  it('creates many accounts in parallel without exhausting the database pool', async () => {
    const org = await newOrg('Pool AG', 'pool-ag', { modules: ['servers', 'storage'] });
    const body = { providerId: demo.id, quotaGb: 100, maxAccounts: null };
    expect((await put(admin, `/admin/orgs/${org.id}/cloud-allowance`, body)).statusCode).toBe(200);
    const owner = await newUser('owner@pool.example', { orgId: org.id, role: 'owner' });
    // Some fail at the instance (taken there already): their audit must not wait in the lock either.
    const ben = demoUsers().get('ben@muster-ag')!;
    for (let i = 0; i < 5; i++) {
      demoUsers().set(`taken${i}@pool-ag`, { ...ben, externalId: `taken${i}@pool-ag`, groups: [] });
    }
    // More requests than the pool has connections, each waiting for the org lock on one.
    const names = [
      ...Array.from({ length: 20 }, (_, i) => `p${i}`),
      ...[0, 1, 2, 3, 4].map((i) => `taken${i}`),
    ];
    const results = await Promise.all(names.map((name) => create(owner, org.id, { name, quotaGb: 1 })));
    expect(results.map((r) => r.statusCode)).toEqual([...Array(20).fill(200), ...Array(5).fill(409)]);
    const failed = (await auditEntries('cloud.account_create')).filter(
      (e) => e.status === 'failure' && e.orgId === org.id,
    );
    expect(failed).toHaveLength(5);
    expect((await orgCloud(owner, org.id)).allowance).toMatchObject({
      accounts: 20,
      allocatedBytes: 20 * GiB,
    });
    for (let i = 0; i < 5; i++) demoUsers().delete(`taken${i}@pool-ag`);
  });

  it('removes the user at the instance again when storing the account fails', async () => {
    const original = DemoAdapter.prototype.createCloudAccount;
    DemoAdapter.prototype.createCloudAccount = async function (this: DemoAdapter, input) {
      const remote = await original.call(this, input);
      // A row with the same login name appears meanwhile: the insert fails on its unique index.
      await t.db
        .insert(cloudAccounts)
        .values({ providerConnectionId: demo.id, externalId: input.username, orgId: null });
      return remote;
    };
    try {
      const res = await create(anna, musterId, { name: 'clash', quotaGb: 1 });
      expect(res.statusCode).toBe(500);
      expect(demoUsers().has('clash@muster-ag')).toBe(false);
      const [entry] = (await auditEntries('cloud.account_create')).filter(
        (e) => (e.details as any).username === 'clash@muster-ag',
      );
      expect(entry).toMatchObject({ status: 'failure', details: { removedAtInstance: true } });
    } finally {
      DemoAdapter.prototype.createCloudAccount = original;
      await t.db.delete(cloudAccounts).where(eq(cloudAccounts.externalId, 'clash@muster-ag'));
    }
  });

  it('changes quota, name, e-mail and state', async () => {
    const id = await accountId('max@muster-ag');
    const res = await anna.patch(`/cloud/accounts/${id}`, {
      quotaGb: 30,
      displayName: 'Max M.',
      email: 'max@muster.example',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<CloudAccountDto>(res)).toMatchObject({
      quotaBytes: 30 * GiB,
      displayName: 'Max M.',
      email: 'max@muster.example',
    });
    expect(demoUsers().get('max@muster-ag')).toMatchObject({
      quotaBytes: 30 * GiB,
      email: 'max@muster.example',
    });

    const tooBig = await anna.patch(`/cloud/accounts/${id}`, { quotaGb: 600 });
    expect(tooBig.statusCode).toBe(409);
    expect(json(tooBig).error.code).toBe('allowance_exceeded');
    expect(demoUsers().get('max@muster-ag')!.quotaBytes).toBe(30 * GiB);

    // Below what it uses: allowed, Nextcloud just stops new uploads.
    demoUsers().get('max@muster-ag')!.usedBytes = 8 * GiB;
    await admin.post(`/admin/providers/${demo.id}/sync`);
    const below = json<CloudAccountDto>(await anna.patch(`/cloud/accounts/${id}`, { quotaGb: 5 }));
    expect(below).toMatchObject({ quotaBytes: 5 * GiB, usedBytes: 8 * GiB });

    const disabled = json<CloudAccountDto>(await anna.patch(`/cloud/accounts/${id}`, { enabled: false }));
    expect(disabled.enabled).toBe(false);
    expect(demoUsers().get('max@muster-ag')!.enabled).toBe(false);
    expect(json<CloudAccountDto>(await anna.patch(`/cloud/accounts/${id}`, { enabled: true })).enabled).toBe(
      true,
    );

    const cleared = json<CloudAccountDto>(await anna.patch(`/cloud/accounts/${id}`, { email: '' }));
    expect(cleared.email).toBeNull();
    expect(demoUsers().get('max@muster-ag')!.email).toBeNull();
    expect((await anna.patch(`/cloud/accounts/${id}`, { email: 'nope' })).statusCode).toBe(400);

    const entries = await auditEntries('cloud.account_update', id);
    expect(entries.length).toBeGreaterThanOrEqual(5);
    expect(entries[0]!.details).toMatchObject({
      username: 'max@muster-ag',
      before: { quotaBytes: 20 * GiB, displayName: 'Max Muster', email: null },
      after: { quotaBytes: 30 * GiB, displayName: 'Max M.', email: 'max@muster.example' },
    });
  });

  it('sets a new password for interactive sessions only and audits it without the password', async () => {
    const id = await accountId('max@muster-ag');
    const res = await anna.post(`/cloud/accounts/${id}/password`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const { password } = json<{ password: string }>(res);
    expect(password).toHaveLength(20);
    expect(demoUsers().get('max@muster-ag')!.password).toBe(password);
    const entries = await auditEntries('cloud.password_reset', id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.details).toEqual({ username: 'max@muster-ag' });
    expect(JSON.stringify(entries)).not.toContain(password);

    expect((await carla.post(`/cloud/accounts/${id}/password`)).statusCode).toBe(403);
    expect((await dev.post(`/cloud/accounts/${id}/password`)).statusCode).toBe(404);
    expect(await auditEntries('cloud.password_reset', id)).toHaveLength(1);
  });

  it('resends the invitation to accounts with an e-mail address', async () => {
    const lea = await accountId('lea@muster-ag');
    expect((await anna.post(`/cloud/accounts/${lea}/invite`)).statusCode).toBe(200);
    expect(demoUsers().get('lea@muster-ag')!.invites).toBe(2);
    expect(await auditEntries('cloud.invite', lea)).toHaveLength(1);
    const books = await accountId('buchhaltung@muster-ag');
    const res = await anna.post(`/cloud/accounts/${books}/invite`);
    expect(res.statusCode).toBe(400);
    expect(json(res).error.message).toMatch(/e-mail/);
    expect((await carla.post(`/cloud/accounts/${lea}/invite`)).statusCode).toBe(403);
  });

  it('deletes an account only with the login name as confirmation', async () => {
    const id = await accountId('lea@muster-ag');
    expect((await anna.del(`/cloud/accounts/${id}`)).statusCode).toBe(400);
    expect((await anna.del(`/cloud/accounts/${id}`, { confirm: 'lea' })).statusCode).toBe(400);
    expect(demoUsers().has('lea@muster-ag')).toBe(true);
    expect((await anna.del(`/cloud/accounts/${id}`, { confirm: 'lea@muster-ag' })).statusCode).toBe(200);
    expect(demoUsers().has('lea@muster-ag')).toBe(false);
    expect(await storedAccount('lea@muster-ag')).toBeUndefined();
    const entries = await auditEntries('cloud.account_delete', id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.details).toMatchObject({ username: 'lea@muster-ag' });
    expect((await anna.del(`/cloud/accounts/${id}`, { confirm: 'lea@muster-ag' })).statusCode).toBe(404);
  });

  it('removes accounts that are gone at the instance already', async () => {
    const created = json<CloudAccountSecretDto>(await create(anna, musterId, { name: 'gone', quotaGb: 1 }));
    demoUsers().delete('gone@muster-ag');
    await admin.post(`/admin/providers/${demo.id}/sync`);
    expect((await storedAccount('gone@muster-ag'))!.missingSince).not.toBeNull();
    const res = await anna.del(`/cloud/accounts/${created.account.id}`, { confirm: 'gone@muster-ag' });
    expect(res.statusCode, res.body).toBe(200);
    expect(await storedAccount('gone@muster-ag')).toBeUndefined();
  });
});

describe('access', () => {
  it('lets members and viewers read but not change anything', async () => {
    const member = await newUser('member@muster.example', { orgId: musterId, role: 'member' });
    const id = await accountId('max@muster-ag');
    for (const client of [member, carla]) {
      const cloud = await orgCloud(client, musterId);
      expect(cloud.accounts.length).toBeGreaterThan(0);
      expect(cloud.accounts[0]!.permissions).toEqual(['cloud:read']);
      expect((await create(client, musterId, { name: 'nope', quotaGb: 1 })).statusCode).toBe(403);
      expect((await client.patch(`/cloud/accounts/${id}`, { quotaGb: 2 })).statusCode).toBe(403);
      expect((await client.post(`/cloud/accounts/${id}/password`)).statusCode).toBe(403);
      expect((await client.post(`/cloud/accounts/${id}/invite`)).statusCode).toBe(403);
      expect((await client.del(`/cloud/accounts/${id}`, { confirm: 'max@muster-ag' })).statusCode).toBe(403);
    }
    // ben is "restricted": no cloud access at all.
    const ben = new Client(t.app);
    await ben.login('ben@muster.example');
    expect((await ben.get(`/orgs/${musterId}/cloud`)).statusCode).toBe(403);
  });

  it('hides everything from other organizations', async () => {
    const id = await accountId('max@muster-ag');
    expect((await dev.get(`/orgs/${musterId}/cloud`)).statusCode).toBe(404);
    expect((await create(dev, musterId, { name: 'x', quotaGb: 1 })).statusCode).toBe(404);
    expect((await dev.patch(`/cloud/accounts/${id}`, { quotaGb: 2 })).statusCode).toBe(404);
    expect((await dev.del(`/cloud/accounts/${id}`, { confirm: 'max@muster-ag' })).statusCode).toBe(404);
    expect((await dev.patch('/cloud/accounts/00000000-0000-4000-8000-000000000000', {})).statusCode).toBe(
      404,
    );
  });

  it('closes everything while the storage module is off, also for the owner', async () => {
    const modules = await modulesOf(musterId);
    await setModules(
      musterId,
      modules.filter((m) => m !== 'storage'),
    );
    try {
      const id = await accountId('max@muster-ag');
      expect((await anna.get(`/orgs/${musterId}/cloud`)).statusCode).toBe(403);
      expect((await create(anna, musterId, { name: 'off', quotaGb: 1 })).statusCode).toBe(403);
      expect((await anna.patch(`/cloud/accounts/${id}`, { quotaGb: 2 })).statusCode).toBe(404);
      expect((await anna.post(`/cloud/accounts/${id}/password`)).statusCode).toBe(404);
      expect((await anna.del(`/cloud/accounts/${id}`, { confirm: 'max@muster-ag' })).statusCode).toBe(404);
      // Platform staff still see it.
      expect((await admin.get(`/orgs/${musterId}/cloud`)).statusCode).toBe(200);
    } finally {
      await setModules(musterId, modules);
    }
  });

  it('is read-only while the organization is suspended', async () => {
    await t.db
      .update(organizations)
      .set({ status: 'suspended', suspendedBy: 'platform' })
      .where(eq(organizations.id, musterId));
    try {
      const id = await accountId('max@muster-ag');
      expect((await anna.get(`/orgs/${musterId}/cloud`)).statusCode).toBe(200);
      expect((await create(anna, musterId, { name: 'sus', quotaGb: 1 })).statusCode).toBe(403);
      expect((await anna.patch(`/cloud/accounts/${id}`, { enabled: false })).statusCode).toBe(403);
      expect((await anna.post(`/cloud/accounts/${id}/password`)).statusCode).toBe(403);
      expect((await anna.del(`/cloud/accounts/${id}`, { confirm: 'max@muster-ag' })).statusCode).toBe(403);
    } finally {
      await t.db
        .update(organizations)
        .set({ status: 'active', suspendedBy: null })
        .where(eq(organizations.id, musterId));
    }
  });

  it('needs an allowance to create accounts', async () => {
    await setModules(beispielId, ['servers', 'storage']);
    try {
      const res = await create(dev, beispielId, { name: 'dev2', quotaGb: 1 });
      expect(res.statusCode).toBe(409);
      expect(json(res).error.code).toBe('no_allowance');
      expect(await orgCloud(dev, beispielId)).toEqual({ allowance: null, accounts: [] });
    } finally {
      await setModules(beispielId, ['servers']);
    }
  });
});

describe('admin allowances', () => {
  it('is for platform staff only', async () => {
    const body = { providerId: demo.id, quotaGb: 50, maxAccounts: null };
    expect((await anna.get(`/admin/orgs/${musterId}/cloud-allowance`)).statusCode).toBe(403);
    expect((await put(anna, `/admin/orgs/${beispielId}/cloud-allowance`, body)).statusCode).toBe(403);
    const support = await newUser('support@weblion.example', { platformRole: 'support' });
    expect((await support.get(`/admin/orgs/${musterId}/cloud-allowance`)).statusCode).toBe(200);
    expect((await put(support, `/admin/orgs/${beispielId}/cloud-allowance`, body)).statusCode).toBe(403);
    expect((await support.del(`/admin/orgs/${beispielId}/cloud-allowance`)).statusCode).toBe(403);
    expect((await support.get('/admin/cloud/accounts')).statusCode).toBe(200);
    expect(
      (
        await support.post('/admin/cloud/accounts/import', {
          providerId: demo.id,
          username: 'x',
          orgId: null,
        })
      ).statusCode,
    ).toBe(403);
  });

  it('sets an allowance and activates the storage module', async () => {
    expect(await modulesOf(beispielId)).not.toContain('storage');
    const res = await put(admin, `/admin/orgs/${beispielId}/cloud-allowance`, {
      providerId: demo.id,
      quotaGb: 50,
      maxAccounts: null,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<CloudAllowanceDto>(res)).toMatchObject({
      orgId: beispielId,
      provider: { id: demo.id },
      quotaBytes: 50 * GiB,
      maxAccounts: null,
      allocatedBytes: 0,
      accounts: 0,
    });
    expect(await modulesOf(beispielId)).toContain('storage');
    const [entry] = await auditEntries('cloud.allowance_set', beispielId);
    expect(entry!.details).toMatchObject({ quotaBytes: 50 * GiB, previous: null, moduleEnabled: 'storage' });

    // The customer can use it right away.
    const created = await create(dev, beispielId, { name: 'dev', quotaGb: 5 });
    expect(created.statusCode).toBe(409); // dev@beispiel-gmbh exists at the instance, unmanaged
    expect((await create(dev, beispielId, { name: 'team', quotaGb: 5 })).statusCode).toBe(200);
  });

  it('can leave the module off', async () => {
    const org = await newOrg('Modul AG', 'modul-ag');
    const res = await put(admin, `/admin/orgs/${org.id}/cloud-allowance`, {
      providerId: demo.id,
      quotaGb: 10,
      maxAccounts: 2,
      enableModule: false,
    });
    expect(res.statusCode).toBe(200);
    expect(await modulesOf(org.id)).toEqual(['servers']);
  });

  it('refuses allowances below what is allocated', async () => {
    const { allowance } = await orgCloud(anna, musterId);
    const allocatedGb = allowance!.allocatedBytes / GiB;
    const lower = await put(admin, `/admin/orgs/${musterId}/cloud-allowance`, {
      providerId: demo.id,
      quotaGb: Math.floor(allocatedGb) - 1,
      maxAccounts: 20,
    });
    expect(lower.statusCode).toBe(409);
    expect(json(lower).error.code).toBe('allowance_exceeded');
    const fewer = await put(admin, `/admin/orgs/${musterId}/cloud-allowance`, {
      providerId: demo.id,
      quotaGb: 500,
      maxAccounts: allowance!.accounts - 1,
    });
    expect(fewer.statusCode).toBe(409);
    expect(json(fewer).error.code).toBe('account_limit');
    expect((await orgCloud(anna, musterId)).allowance!.quotaBytes).toBe(500 * GiB);
  });

  it('changes the instance only while no accounts exist', async () => {
    const second = await newConnection('demo', 'Nextcloud 2');
    const moved = await put(admin, `/admin/orgs/${musterId}/cloud-allowance`, {
      providerId: second.id,
      quotaGb: 500,
      maxAccounts: 20,
    });
    expect(moved.statusCode).toBe(409);
    expect(json(moved).error.message).toMatch(/instance/);

    const org = await newOrg('Wechsel AG', 'wechsel-ag');
    const body = { providerId: demo.id, quotaGb: 10, maxAccounts: null };
    expect((await put(admin, `/admin/orgs/${org.id}/cloud-allowance`, body)).statusCode).toBe(200);
    const res = await put(admin, `/admin/orgs/${org.id}/cloud-allowance`, { ...body, providerId: second.id });
    expect(res.statusCode).toBe(200);
    expect(json<CloudAllowanceDto>(res).provider!.id).toBe(second.id);

    // Providers without cloud accounts are refused.
    const joker = await newConnection('joker', 'Joker');
    const unsupported = await put(admin, `/admin/orgs/${org.id}/cloud-allowance`, {
      ...body,
      providerId: joker.id,
    });
    expect(unsupported.statusCode).toBe(422);

    // The instance cannot be removed while an allowance is on it.
    const del = await admin.del(`/admin/providers/${second.id}`);
    expect(del.statusCode).toBe(409);
    expect(json(del).error.message).toMatch(/cloud/);
    expect((await admin.del(`/admin/orgs/${org.id}/cloud-allowance`)).statusCode).toBe(200);
    expect((await admin.del(`/admin/providers/${second.id}`)).statusCode).toBe(200);
  });

  it('refuses a module the reseller does not have', async () => {
    const reseller = await newOrg('Nomod Reseller', 'nomod-reseller', { kind: 'reseller' });
    const customer = await newOrg('Nomod Kunde', 'nomod-kunde', { parentOrgId: reseller.id });
    const res = await put(admin, `/admin/orgs/${customer.id}/cloud-allowance`, {
      providerId: demo.id,
      quotaGb: 10,
      maxAccounts: null,
    });
    expect(res.statusCode).toBe(409);
    expect(json(res).error.message).toMatch(/module/);
  });

  it('deletes an allowance only without accounts and guards organization deletion', async () => {
    const del = await admin.del(`/admin/orgs/${musterId}/cloud-allowance`);
    expect(del.statusCode).toBe(409);
    expect(json(del).error.message).toMatch(/cloud accounts/);
    // A reseller cannot lose its allowance while customers draw from it.
    const reseller = await admin.del(`/admin/orgs/${alpenId}/cloud-allowance`);
    expect(reseller.statusCode).toBe(409);
    expect(json(reseller).error.message).toMatch(/customers/);

    const org = await newOrg('Weg AG', 'weg-ag');
    await put(admin, `/admin/orgs/${org.id}/cloud-allowance`, {
      providerId: demo.id,
      quotaGb: 5,
      maxAccounts: null,
    });
    const orgDelete = await admin.del(`/admin/orgs/${org.id}`);
    expect(orgDelete.statusCode).toBe(409);
    expect(json(orgDelete).error.message).toMatch(/cloud storage allowance/);
    expect((await admin.del(`/admin/orgs/${org.id}/cloud-allowance`)).statusCode).toBe(200);
    expect(await auditEntries('cloud.allowance_delete', org.id)).toHaveLength(1);
    expect((await admin.del(`/admin/orgs/${org.id}/cloud-allowance`)).statusCode).toBe(404);
    expect((await admin.del(`/admin/orgs/${org.id}`)).statusCode).toBe(200);
  });
});

describe('reseller allowances', () => {
  const url = (orgId: string) => `/reseller/customers/${orgId}/cloud-allowance`;

  it('shows and changes the allowance of its customers within its own', async () => {
    expect(json<CloudAllowanceDto>(await reto.get(url(huberId)))).toMatchObject({
      quotaBytes: 100 * GiB,
      maxAccounts: 5,
      accounts: 1,
    });
    const res = await put(reto, url(huberId), { quotaGb: 200, maxAccounts: 5 });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<CloudAllowanceDto>(res)).toMatchObject({ quotaBytes: 200 * GiB, provider: { id: demo.id } });
    const own = json<CloudAllowanceDto>(await admin.get(`/admin/orgs/${alpenId}/cloud-allowance`));
    expect(own.allocatedBytes).toBe(200 * GiB);
    const [entry] = await auditEntries('cloud.allowance_set', huberId);
    expect(entry).toMatchObject({ orgId: alpenId });

    const tooMuch = await put(reto, url(huberId), { quotaGb: 1001, maxAccounts: 5 });
    expect(tooMuch.statusCode).toBe(409);
    expect(json(tooMuch).error.code).toBe('allowance_exceeded');
    // Not below what the customer has handed out already (hanna@baeckerei-huber: 10 GB).
    expect((await put(reto, url(huberId), { quotaGb: 5, maxAccounts: 5 })).statusCode).toBe(409);
    // The reseller limits the number of accounts, so its customers need a limit too.
    const unlimited = await put(reto, url(huberId), { quotaGb: 200, maxAccounts: null });
    expect(unlimited.statusCode).toBe(409);
    expect(json(unlimited).error.code).toBe('account_limit');
    expect((await put(reto, url(huberId), { quotaGb: 200, maxAccounts: 51 })).statusCode).toBe(409);
  });

  it('counts the reseller’s own accounts and its customers together', async () => {
    const own = await create(reto, alpenId, { name: 'reto', quotaGb: 700 });
    expect(own.statusCode, own.body).toBe(200);
    // 700 GB own: of 1000 GB, at most 300 GB are left for Huber (its 200 GB included).
    const res = await put(reto, url(huberId), { quotaGb: 400, maxAccounts: 5 });
    expect(res.statusCode).toBe(409);
    expect(json(res).error.message).toMatch(/Only 300 GB/);
    expect((await put(reto, url(huberId), { quotaGb: 300, maxAccounts: 5 })).statusCode).toBe(200);
    // Full now: no room for another own account either.
    const full = await create(reto, alpenId, { name: 'more', quotaGb: 1 });
    expect(full.statusCode).toBe(409);
    expect(json(full).error.code).toBe('allowance_exceeded');
    const allowance = (await orgCloud(reto, alpenId)).allowance!;
    expect(allowance).toMatchObject({ quotaBytes: 1000 * GiB, allocatedBytes: 1000 * GiB });

    // The customer works within its share.
    const hannaCreate = await create(hanna, huberId, { name: 'laden', quotaGb: 50 });
    expect(hannaCreate.statusCode, hannaCreate.body).toBe(200);
    expect(json<CloudAccountSecretDto>(hannaCreate).account.username).toBe('laden@baeckerei-huber');
    expect(demoUsers().get('laden@baeckerei-huber')!.groups).toEqual(['weblion-baeckerei-huber']);
  });

  it('limits a reseller’s accounts only once every customer has a maximum', async () => {
    const reseller = await newOrg('Max Reseller', 'max-reseller', {
      kind: 'reseller',
      modules: ['servers', 'storage'],
    });
    const customer = await newOrg('Max Kunde', 'max-kunde', { parentOrgId: reseller.id });
    const owner = await newUser('owner@max-reseller.example', { orgId: reseller.id, role: 'owner' });
    const setOwn = (maxAccounts: number | null) =>
      put(admin, `/admin/orgs/${reseller.id}/cloud-allowance`, {
        providerId: demo.id,
        quotaGb: 100,
        maxAccounts,
      });
    expect((await setOwn(null)).statusCode).toBe(200);
    expect((await put(owner, url(customer.id), { quotaGb: 10, maxAccounts: null })).statusCode).toBe(200);
    // Max Kunde counts with its 0 accounts and could create any number: 3 would not bind.
    const capped = await setOwn(3);
    expect(capped.statusCode).toBe(409);
    expect(json(capped).error.code).toBe('account_limit');
    expect(
      json<CloudAllowanceDto>(await admin.get(`/admin/orgs/${reseller.id}/cloud-allowance`)),
    ).toMatchObject({ maxAccounts: null, customers: 1 });
    expect((await put(owner, url(customer.id), { quotaGb: 10, maxAccounts: 2 })).statusCode).toBe(200);
    expect((await setOwn(3)).statusCode).toBe(200);
  });

  it('activates the module for new customers and needs an allowance of its own', async () => {
    const { customer } = json(
      await reto.post(`/orgs/${alpenId}/customers`, { name: 'Neukunde Cloud', modules: ['servers'] }),
    );
    expect(await modulesOf(customer.id)).toEqual(['servers']);
    // Alpen is full: nothing left to hand out.
    expect((await put(reto, url(customer.id), { quotaGb: 1, maxAccounts: 1 })).statusCode).toBe(409);
    await put(reto, url(huberId), { quotaGb: 290, maxAccounts: 5 });
    const res = await put(reto, url(customer.id), { quotaGb: 10, maxAccounts: 2 });
    expect(res.statusCode, res.body).toBe(200);
    expect(await modulesOf(customer.id)).toContain('storage');

    // A reseller without an allowance has nothing to hand out.
    const other = await newOrg('Leer Reseller', 'leer-reseller', {
      kind: 'reseller',
      modules: ['servers', 'storage'],
    });
    const otherCustomer = await newOrg('Leer Kunde', 'leer-kunde', { parentOrgId: other.id });
    const owner = await newUser('owner@leer.example', { orgId: other.id, role: 'owner' });
    const none = await put(owner, url(otherCustomer.id), { quotaGb: 1, maxAccounts: 1 });
    expect(none.statusCode).toBe(409);
    expect(json(none).error.code).toBe('no_allowance');
    // Nor one without the module.
    await setModules(other.id, ['servers']);
    expect((await put(owner, url(otherCustomer.id), { quotaGb: 1, maxAccounts: 1 })).statusCode).toBe(409);
  });

  it('takes an allowance back only without accounts, so the customer can be deleted', async () => {
    const { customer } = json(await reto.post(`/orgs/${alpenId}/customers`, { name: 'Kurzzeit Kunde' }));
    // Alpen has handed out everything: make room first.
    expect((await put(reto, url(huberId), { quotaGb: 280, maxAccounts: 5 })).statusCode).toBe(200);
    expect((await put(reto, url(customer.id), { quotaGb: 1, maxAccounts: 1 })).statusCode).toBe(200);
    const blocked = await reto.del(`/orgs/${alpenId}/customers/${customer.id}`);
    expect(blocked.statusCode).toBe(409);
    expect(json(blocked).error.message).toMatch(/cloud storage allowance/);
    // Huber still has accounts.
    expect((await reto.del(url(huberId))).statusCode).toBe(409);
    expect((await hanna.del(url(customer.id))).statusCode).toBe(404);
    expect((await reto.del(url(customer.id))).statusCode).toBe(200);
    expect(await auditEntries('cloud.allowance_delete', customer.id)).toHaveLength(1);
    expect((await reto.del(url(customer.id))).statusCode).toBe(404);
    expect((await reto.del(`/orgs/${alpenId}/customers/${customer.id}`)).statusCode).toBe(200);
  });

  it('is only for the reseller of the customer', async () => {
    expect((await anna.get(url(huberId))).statusCode).toBe(404);
    expect((await put(anna, url(huberId), { quotaGb: 1, maxAccounts: 1 })).statusCode).toBe(404);
    // The customer itself cannot raise its own allowance.
    expect((await put(hanna, url(huberId), { quotaGb: 999, maxAccounts: 5 })).statusCode).toBe(404);
    // Organizations without a reseller are no customers.
    expect((await reto.get(url(musterId))).statusCode).toBe(404);
    // Viewers of the reseller can look, not change.
    const viewer = await newUser('viewer@alpen.example', { orgId: alpenId, role: 'viewer' });
    expect((await viewer.get(url(huberId))).statusCode).toBe(200);
    expect((await put(viewer, url(huberId), { quotaGb: 1, maxAccounts: 1 })).statusCode).toBe(403);
  });
});

describe('admin accounts', () => {
  it('lists accounts with filters', async () => {
    const all = json<CloudAccountDto[]>(await admin.get('/admin/cloud/accounts'));
    expect(all.map((a) => a.username)).toEqual(
      expect.arrayContaining(['anna@muster-ag', 'hanna@baeckerei-huber']),
    );
    const muster = json<CloudAccountDto[]>(await admin.get(`/admin/cloud/accounts?orgId=${musterId}`));
    expect(muster.every((a) => a.org?.id === musterId)).toBe(true);
    const search = json<CloudAccountDto[]>(await admin.get('/admin/cloud/accounts?q=hanna'));
    expect(search.map((a) => a.username)).toEqual(['hanna@baeckerei-huber']);
    expect(
      json<CloudAccountDto[]>(await admin.get(`/admin/cloud/accounts?providerId=${demo.id}`)),
    ).toHaveLength(all.length);
    expect((await anna.get('/admin/cloud/accounts')).statusCode).toBe(403);
  });

  it('lists users the panel does not manage, without instance admins', async () => {
    const res = await admin.get(`/admin/providers/${demo.id}/cloud/unmanaged`);
    expect(res.statusCode, res.body).toBe(200);
    const unmanaged = json<{ username: string; quotaBytes: number | null }[]>(res);
    expect(unmanaged.map((u) => u.username)).toEqual(['ben@muster-ag', 'dev@beispiel-gmbh']);
    expect(unmanaged[0]).toMatchObject({ quotaBytes: 20 * GiB, enabled: true, email: 'ben@muster.example' });
    expect((await anna.get(`/admin/providers/${demo.id}/cloud/unmanaged`)).statusCode).toBe(403);
  });

  it('imports users and assigns them to organizations', async () => {
    const ben = await admin.post('/admin/cloud/accounts/import', {
      providerId: demo.id,
      username: 'ben@muster-ag',
      orgId: musterId,
    });
    expect(ben.statusCode, ben.body).toBe(200);
    expect(json<CloudAccountDto>(ben)).toMatchObject({
      username: 'ben@muster-ag',
      quotaBytes: 20 * GiB,
      org: { id: musterId },
    });
    expect(await auditEntries('cloud.account_import', json(ben).id)).toHaveLength(1);
    const again = { providerId: demo.id, username: 'ben@muster-ag', orgId: null };
    expect((await admin.post('/admin/cloud/accounts/import', again)).statusCode).toBe(409);
    expect(
      (await admin.post('/admin/cloud/accounts/import', { ...again, username: 'admin' })).statusCode,
    ).toBe(409);
    expect(
      (await admin.post('/admin/cloud/accounts/import', { ...again, username: 'nobody@nowhere' })).statusCode,
    ).toBe(404);
    const noAllowance = await newOrg('Ohne AG', 'ohne-ag');
    const refused = await admin.post('/admin/cloud/accounts/import', {
      providerId: demo.id,
      username: 'dev@beispiel-gmbh',
      orgId: noAllowance.id,
    });
    expect(refused.statusCode).toBe(409);
    expect(json(refused).error.code).toBe('no_allowance');

    const devRes = await admin.post('/admin/cloud/accounts/import', {
      providerId: demo.id,
      username: 'dev@beispiel-gmbh',
      orgId: null,
    });
    expect(devRes.statusCode).toBe(200);
    const devAccount = json<CloudAccountDto>(devRes);
    expect(devAccount.org).toBeNull();
    expect(json(await admin.get(`/admin/providers/${demo.id}/cloud/unmanaged`))).toEqual([]);

    // Beispiel GmbH has its allowance on the demo instance (see "admin allowances").
    const assigned = await admin.post(`/admin/cloud/accounts/${devAccount.id}/assign`, { orgId: beispielId });
    expect(assigned.statusCode, assigned.body).toBe(200);
    expect(json<CloudAccountDto>(assigned).org!.id).toBe(beispielId);
    expect((await orgCloud(dev, beispielId)).accounts.map((a) => a.username)).toContain('dev@beispiel-gmbh');
    expect(
      (await admin.post(`/admin/cloud/accounts/${devAccount.id}/assign`, { orgId: noAllowance.id }))
        .statusCode,
    ).toBe(409);
    const unassigned = await admin.post(`/admin/cloud/accounts/${devAccount.id}/assign`, { orgId: null });
    expect(json<CloudAccountDto>(unassigned).org).toBeNull();
    const entries = await auditEntries('cloud.account_assign', devAccount.id);
    expect(entries.map((e) => (e.details as any).orgId)).toEqual([beispielId, null]);
    expect(
      (await anna.post(`/admin/cloud/accounts/${devAccount.id}/assign`, { orgId: musterId })).statusCode,
    ).toBe(403);
  });

  it('refuses an allowance on another instance when assigning', async () => {
    const second = await newConnection('demo', 'Nextcloud 3');
    const org = await newOrg('Andere Instanz AG', 'andere-instanz-ag');
    await put(admin, `/admin/orgs/${org.id}/cloud-allowance`, {
      providerId: second.id,
      quotaGb: 5,
      maxAccounts: null,
    });
    const id = await accountId('dev@beispiel-gmbh');
    const res = await admin.post(`/admin/cloud/accounts/${id}/assign`, { orgId: org.id });
    expect(res.statusCode).toBe(409);
    expect(json(res).error.message).toMatch(/another instance/);
  });

  it('does not reuse the slug of a deleted organization whose accounts live on', async () => {
    // Unassigned before the organization was deleted: still in Nextcloud, in group weblion-alt-ag.
    await t.db
      .insert(cloudAccounts)
      .values({ providerConnectionId: demo.id, externalId: 'anna@alt-ag', orgId: null });
    const { customer } = json(await reto.post(`/orgs/${alpenId}/customers`, { name: 'Alt AG' }));
    expect(customer.slug).toBe('alt-ag-2');
  });

  it('refuses to delete organizations that still have cloud accounts', async () => {
    const org = await newOrg('Konto AG', 'konto-ag');
    await put(admin, `/admin/orgs/${org.id}/cloud-allowance`, {
      providerId: demo.id,
      quotaGb: 5,
      maxAccounts: null,
    });
    const id = await accountId('dev@beispiel-gmbh');
    await admin.post(`/admin/cloud/accounts/${id}/assign`, { orgId: org.id });
    const res = await admin.del(`/admin/orgs/${org.id}`);
    expect(res.statusCode).toBe(409);
    expect(json(res).error.message).toMatch(/1 cloud accounts/);
    expect(
      await t.db.query.cloudAllowances.findFirst({ where: eq(cloudAllowances.orgId, org.id) }),
    ).toBeDefined();
  });
});

describe('secrets', () => {
  it('audits explorer writes without passwords', async () => {
    const secret = 'Explorer-Secret-4711';
    const res = await admin.post('/admin/explorer', {
      providerId: demo.id,
      method: 'PUT',
      path: `/ocs/v2.php/cloud/users/anna@muster-ag?format=json&password=${secret}-q`,
      body: { key: 'password', value: secret, nested: { appPassword: `${secret}-n` } },
    });
    expect(res.statusCode, res.body).toBe(200);
    const [entry] = (await auditEntries('provider.explorer', demo.id)).slice(-1);
    expect(entry!.details).toMatchObject({
      method: 'PUT',
      path: '/ocs/v2.php/cloud/users/anna@muster-ag?format=json&password=[redacted]',
      body: { key: 'password', value: '[redacted]', nested: { appPassword: '[redacted]' } },
    });
    expect(JSON.stringify(entry)).not.toContain(secret);

    // Other edits keep their value, so the log still tells what changed.
    await admin.post('/admin/explorer', {
      providerId: demo.id,
      method: 'PUT',
      path: '/ocs/v2.php/cloud/users/anna@muster-ag',
      body: { key: 'quota', value: '10 GB' },
    });
    const [quota] = (await auditEntries('provider.explorer', demo.id)).slice(-1);
    expect(quota!.details).toMatchObject({ body: { key: 'quota', value: '10 GB' } });

    // Nextcloud takes key and value from the query too, also mixed with the body.
    const user = '/ocs/v2.php/cloud/users/anna@muster-ag';
    const cases: [string, Record<string, unknown> | undefined, unknown][] = [
      [`${user}?key=password&value=${secret}-1`, undefined, `${user}?key=password&value=[redacted]`],
      [`${user}?k%65y=password&v%61lue=${secret}-2`, undefined, `${user}?k%65y=password&v%61lue=[redacted]`],
      [`${user}?key=password`, { value: `${secret}-3` }, `${user}?key=password`],
      [`${user}?value=${secret}-4`, { key: 'password' }, `${user}?value=[redacted]`],
    ];
    for (const [path, body, audited] of cases) {
      await admin.post('/admin/explorer', {
        providerId: demo.id,
        method: 'PUT',
        path,
        ...(body ? { body } : {}),
      });
      const [entry] = (await auditEntries('provider.explorer', demo.id)).slice(-1);
      expect(entry!.details).toMatchObject({ path: audited });
      expect(JSON.stringify(entry), path).not.toContain(secret);
    }
    await admin.post('/admin/explorer', {
      providerId: demo.id,
      method: 'PUT',
      path: `${user}?key=quota&value=5%20GB`,
    });
    const [plain] = (await auditEntries('provider.explorer', demo.id)).slice(-1);
    expect(plain!.details).toMatchObject({ path: `${user}?key=quota&value=5%20GB` });
  });

  it('shows no part of a Nextcloud app password in the provider summary', async () => {
    const summary = configSummary('nextcloud', {
      baseUrl: 'https://cloud.example',
      username: 'admin',
      appPassword: 'AbCdE-fGhIj-KlMnO-pQrSt-UvWxY',
    });
    expect(summary).toMatchObject({ baseUrl: 'https://cloud.example', username: 'admin' });
    expect(JSON.stringify(summary)).not.toMatch(/AbCd|UvWxY/);
  });
});
