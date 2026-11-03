import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  DEFAULT_CUSTOMER_BOUNDARY,
  type MediaAccess,
  type MediaAccountDto,
  type MediaAllowanceChangeResult,
  type MediaAllowanceDto,
  type MediaInstanceDto,
  type MediaRequestsAccess,
  type MediaSeerrChangeResult,
  type MediaSeerrDto,
  type OrgMediaDto,
} from '@weblion/shared';
import type { SeerrSyncCounts } from '../src/jobs/sync-seerr';
import {
  auditLogs,
  mediaAccounts,
  mediaAllowances,
  mediaSeerr,
  organizations,
  providerConnections,
  users,
  type ProviderConnection,
} from '../src/db/schema';
import { hashPassword } from '../src/lib/crypto';
import { deleteSeerrAccount, setMediaRequests, syncSeerrAccount } from '../src/modules/media/seerr';
import { DemoAdapter } from '../src/providers/demo/adapter';
import { DEMO_MEDIA_LIBRARIES, DEMO_MEDIA_SERVER, demoMediaState } from '../src/providers/demo/media';
import {
  DEMO_SEERR_REQUEST_SEEDS,
  DEMO_SEERR_URL,
  addDemoSeerrRequest,
  addDemoSeerrUser,
  demoSeerrState,
  type DemoSeerrUser,
} from '../src/providers/demo/seerr';
import { SEERR_PERMISSION as P } from '../src/providers/seerr/rules';
import type { RemoteSeerrUser, SeerrUserAccess } from '../src/providers/types';
import { ADMIN, Client, createTestApp, DEMO_PASSWORD, json, type TestApp } from './helpers';

/**
 * The requests add-on (Seerr) through the API with the demo provider (design 20 to 22 and 25):
 * visibility, the account lifecycle, allowances of staff and resellers, switching per instance,
 * the sync and privacy. The demo instance has Seerr switched on by the seed; Muster AG and Alpen
 * Hosting have the add-on, Bäckerei Huber has none.
 */

let t: TestApp;
let admin: Client;
let anna: Client;
let reto: Client;
let hanna: Client;
let support: Client;
/** A read_write API token of Muster AG. */
let bot: Client;
let demo: ProviderConnection;
let musterId: string;
let alpenId: string;
let huberId: string;

const LIB = Object.fromEntries(DEMO_MEDIA_LIBRARIES.map((l) => [l.name, l.id])) as Record<string, string>;
const MUSTER_ACCESS: MediaAccess = {
  libraryIds: [LIB.Filme!, LIB.Serien!, LIB.Kinder!],
  maxStreams: 2,
  downloads: false,
  remoteBitrateMbit: 8,
};
const ALPEN_ACCESS: MediaAccess = {
  libraryIds: [LIB.Filme!, LIB.Serien!, LIB.Kinder!, LIB.Musik!],
  maxStreams: 3,
  downloads: true,
  remoteBitrateMbit: 20,
};
const HUBER_ACCESS: MediaAccess = {
  libraryIds: [LIB.Filme!, LIB.Kinder!],
  maxStreams: 2,
  downloads: false,
  remoteBitrateMbit: 15,
};
const MUSTER_REQUESTS: MediaRequestsAccess = {
  movies: true,
  tv: true,
  movieQuota: { limit: 5, days: 30 },
  tvQuota: { limit: 3, days: 30 },
};
const ALPEN_REQUESTS: MediaRequestsAccess = {
  movies: true,
  tv: true,
  movieQuota: { limit: 10, days: 30 },
  tvQuota: { limit: 6, days: 30 },
};
const BOTH = P.REQUEST_MOVIE | P.REQUEST_TV;
const MUSTER_SEERR: SeerrUserAccess = {
  permissions: BOTH,
  movieQuotaLimit: 5,
  movieQuotaDays: 30,
  tvQuotaLimit: 3,
  tvQuotaDays: 30,
};
const TITLES = DEMO_SEERR_REQUEST_SEEDS.map((r) => r.title);
const TMDB_IDS = DEMO_SEERR_REQUEST_SEEDS.map((r) => String(r.tmdbId));

const put = (client: Client, url: string, body: unknown) => client.request('PUT', url, body);
/** Lets the clock move on, so a sync never starts in the millisecond of the last change. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

const seerr = () => demoSeerrState(demo.id);
const jellyfinIdOf = (username: string) =>
  [...demoMediaState(demo.id).users.values()].find((u) => u.username === username)?.externalId;
/** The demo Seerr user of a Jellyfin user, by its Jellyfin id. */
function seerrUserOf(username: string): DemoSeerrUser | undefined {
  const id = jellyfinIdOf(username);
  return id ? [...seerr().users.values()].find((u) => u.jellyfinUserId === id) : undefined;
}
const rightsOf = (user: DemoSeerrUser | undefined): SeerrUserAccess | undefined =>
  user && {
    permissions: user.permissions,
    movieQuotaLimit: user.movieQuotaLimit!,
    movieQuotaDays: user.movieQuotaDays!,
    tvQuotaLimit: user.tvQuotaLimit!,
    tvQuotaDays: user.tvQuotaDays!,
  };

async function stored(username: string) {
  return t.db.query.mediaAccounts.findFirst({
    where: and(eq(mediaAccounts.username, username), eq(mediaAccounts.providerConnectionId, demo.id)),
  });
}

async function auditEntries(action: string, resourceId?: string) {
  return t.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, action), resourceId ? eq(auditLogs.resourceId, resourceId) : undefined))
    .orderBy(auditLogs.id);
}

async function lastAudit(action: string, resourceId?: string) {
  return (await auditEntries(action, resourceId)).at(-1);
}

async function sync(connectionId = demo.id): Promise<SeerrSyncCounts> {
  await tick();
  const res = await admin.post(`/admin/providers/${connectionId}/sync`);
  expect(res.statusCode, res.body).toBe(200);
  return json(res).seerr;
}

async function orgMedia(client: Client, orgId: string): Promise<OrgMediaDto> {
  const res = await client.get(`/orgs/${orgId}/media`);
  expect(res.statusCode, res.body).toBe(200);
  return json<OrgMediaDto>(res);
}

/** Every key anywhere in a JSON value. */
function keysOf(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysOf(v, out);
    }
  }
  return out;
}

async function createAccount(client: Client, orgId: string, name: string) {
  const res = await client.post(`/orgs/${orgId}/media/accounts`, { name });
  expect(res.statusCode, res.body).toBe(200);
  return json<{ account: MediaAccountDto }>(res).account;
}

const remove = (client: Client, id: string, confirm: string) =>
  client.del(`/media/accounts/${id}`, { confirm });

const musterBody = (requests?: MediaRequestsAccess | null) => ({
  providerId: demo.id,
  maxAccounts: 5,
  ...MUSTER_ACCESS,
  ...(requests !== undefined ? { requests } : {}),
});
const alpenBody = (requests?: MediaRequestsAccess | null) => ({
  providerId: demo.id,
  maxAccounts: 20,
  ...ALPEN_ACCESS,
  enableModule: false,
  ...(requests !== undefined ? { requests } : {}),
});
const huberBody = (requests?: MediaRequestsAccess | null) => ({
  maxAccounts: 3,
  ...HUBER_ACCESS,
  ...(requests !== undefined ? { requests } : {}),
});

async function setSeerrEnabled(enabled: boolean) {
  await t.db.update(mediaSeerr).set({ enabled }).where(eq(mediaSeerr.providerConnectionId, demo.id));
}

/** A further demo instance, stored like one created in the admin UI. */
async function newDemoConnection(name: string): Promise<ProviderConnection> {
  const [connection] = await t.db
    .insert(providerConnections)
    .values({
      type: 'demo',
      name,
      location: { country: 'CH', label: name },
      configEnc: t.ctx.box.encryptJson({}),
    })
    .returning();
  return connection!;
}

async function newOrg(name: string, slug: string) {
  const [org] = await t.db
    .insert(organizations)
    .values({ name, slug, kind: 'customer', boundary: DEFAULT_CUSTOMER_BOUNDARY, modules: ['media'] })
    .returning();
  return org!;
}

/** Demo connections whose ids are listed have no Seerr configured while `fn` runs. */
async function withoutSeerr<T>(ids: string[], fn: () => Promise<T>): Promise<T> {
  const original = DemoAdapter.prototype.seerrConfigured;
  const spy = vi.spyOn(DemoAdapter.prototype, 'seerrConfigured').mockImplementation(function (
    this: DemoAdapter,
  ) {
    return ids.includes((this as unknown as { connectionId: string }).connectionId)
      ? false
      : original.call(this);
  });
  try {
    return await fn();
  } finally {
    spy.mockRestore();
  }
}

beforeAll(async () => {
  t = await createTestApp();
  admin = new Client(t.app);
  await admin.login(ADMIN.email, ADMIN.password);
  anna = new Client(t.app);
  await anna.login('anna@muster.example');
  reto = new Client(t.app);
  await reto.login('reseller@alpen.example');
  hanna = new Client(t.app);
  await hanna.login('huber@baeckerei.example');
  demo = (await t.db.query.providerConnections.findFirst({ where: eq(providerConnections.envKey, 'demo') }))!;
  const orgId = async (slug: string) =>
    (await t.db.query.organizations.findFirst({ where: eq(organizations.slug, slug) }))!.id;
  musterId = await orgId('muster-ag');
  alpenId = await orgId('alpen-hosting');
  huberId = await orgId('baeckerei-huber');
  // The seed gives the reseller and its customer allowances, but leaves their modules alone.
  for (const id of [alpenId, huberId]) {
    const org = (await t.db.query.organizations.findFirst({ where: eq(organizations.id, id) }))!;
    await t.db
      .update(organizations)
      .set({ modules: [...org.modules, 'media'] })
      .where(eq(organizations.id, id));
  }
  await t.db.insert(users).values({
    email: 'support@weblion.example',
    name: 'support',
    passwordHash: await hashPassword(DEMO_PASSWORD),
    platformRole: 'support',
  });
  support = new Client(t.app);
  await support.login('support@weblion.example');
  const { token } = json(
    await anna.post(`/orgs/${musterId}/tokens`, { name: 'seerr-bot', scope: 'read_write' }),
  );
  bot = new Client(t.app);
  bot.bearer = token;
});

afterAll(async () => {
  await t?.close();
});

describe('seed and first sync', () => {
  it('switches requests on for the shared demo instance with the add-on for two organizations', async () => {
    const row = await t.db.query.mediaSeerr.findFirst({
      where: eq(mediaSeerr.providerConnectionId, demo.id),
    });
    expect(row).toMatchObject({ enabled: true, status: 'unknown' });
    const allowance = async (orgId: string) =>
      (await t.db.query.mediaAllowances.findFirst({ where: eq(mediaAllowances.orgId, orgId) }))!;
    expect(await allowance(musterId)).toMatchObject({
      requestsMovies: true,
      requestsTv: true,
      movieQuotaLimit: 5,
      movieQuotaDays: 30,
      tvQuotaLimit: 3,
      tvQuotaDays: 30,
    });
    expect(await allowance(alpenId)).toMatchObject({ movieQuotaLimit: 10, tvQuotaLimit: 6 });
    expect(await allowance(huberId)).toMatchObject({
      requestsMovies: false,
      requestsTv: false,
      movieQuotaLimit: null,
    });
    expect((await stored('anna-kemaro'))!.seerrUserId).toBe(2);
    expect((await stored('wohnzimmer-kemaro'))!.seerrUserId).toBe(3);
    expect((await stored('huber-bivane'))!.seerrUserId).toBeNull();
    expect(seerrUserOf('huber-bivane')).toBeUndefined();
  });

  it('takes the unmanaged requester its rights and stores the numbers', async () => {
    expect(seerr().users.get(4)!.permissions).toBe(P.REQUEST);
    expect(await sync()).toEqual({ imported: 0, repaired: 0, revoked: 1, failed: 0, counted: 2 });
    expect(seerr().users.get(4)!.permissions).toBe(0);
    expect(seerr().users.get(1)!.permissions).toBe(P.ADMIN);
    // Bäckerei Huber has no add-on: its account gets no Seerr user.
    expect(seerrUserOf('huber-bivane')).toBeUndefined();
    const revoke = await lastAudit('media.seerr_revoke');
    expect(revoke).toMatchObject({
      actorName: 'Sync',
      orgId: null,
      resourceType: 'provider',
      resourceId: demo.id,
      details: { seerrUserId: 4, jellyfinUserId: jellyfinIdOf('ben-kemaro') },
    });
    const annaRow = (await stored('anna-kemaro'))!;
    expect(annaRow.seerrRequests).toEqual({ pending: 1, approved: 1, available: 2, movieUsed: 2, tvUsed: 2 });
    expect(annaRow.seerrSyncedAt).toBeInstanceOf(Date);
    // Disabled: numbers without quota usage.
    expect((await stored('wohnzimmer-kemaro'))!.seerrRequests).toEqual({
      pending: 0,
      approved: 0,
      available: 0,
      movieUsed: null,
      tvUsed: null,
    });
    const row = (await t.db.query.mediaSeerr.findFirst({
      where: eq(mediaSeerr.providerConnectionId, demo.id),
    }))!;
    expect(row).toMatchObject({ status: 'ok', lastError: null });
    expect(row.lastCheck).toMatchObject({ problems: [], unmanagedRequesters: 1, sameServer: true });
    expect(row.checkedAt).toBeInstanceOf(Date);
    // Nothing left to do.
    expect(await sync()).toEqual({ imported: 0, repaired: 0, revoked: 0, failed: 0, counted: 2 });
  });
});

describe('visibility', () => {
  it('shows a customer without the add-on nothing of requests', async () => {
    const res = await hanna.get(`/orgs/${huberId}/media`);
    expect(res.statusCode).toBe(200);
    const keys = keysOf(json(res));
    expect(keys.has('requests')).toBe(false);
    expect(keys.has('requestTotals')).toBe(false);
    expect(res.body).not.toContain(DEMO_SEERR_URL);
    expect(res.body).not.toContain('seerr');
    const account = (await stored('huber-bivane'))!;
    const single = await hanna.get(`/media/accounts/${account.id}`);
    expect(keysOf(json(single)).has('requests')).toBe(false);
  });

  it('shows the add-on, the address and numbers per account to a customer with it', async () => {
    const media = await orgMedia(anna, musterId);
    expect(media.requests).toEqual({
      url: DEMO_SEERR_URL,
      access: MUSTER_REQUESTS,
      syncedAt: expect.any(String),
    });
    expect(media.allowance!.requests).toEqual(MUSTER_REQUESTS);
    expect(keysOf(media.allowance).has('requestTotals')).toBe(false);
    const byName = Object.fromEntries(media.accounts.map((a) => [a.username, a.requests]));
    expect(byName['anna-kemaro']).toEqual({
      ready: true,
      counts: { pending: 1, approved: 1, available: 2, movieUsed: 2, tvUsed: 2 },
    });
    expect(byName['wohnzimmer-kemaro']).toMatchObject({ ready: true, counts: { pending: 0 } });
    const annaAccount = media.accounts.find((a) => a.username === 'anna-kemaro')!;
    expect(json<MediaAccountDto>(await anna.get(`/media/accounts/${annaAccount.id}`)).requests).toEqual(
      byName['anna-kemaro'],
    );
    // Seerr's own ids stay inside the console.
    expect(keysOf(media).has('seerrUserId')).toBe(false);
  });

  it('shows nothing while Seerr is switched off for the instance', async () => {
    await setSeerrEnabled(false);
    try {
      const keys = keysOf(await orgMedia(anna, musterId));
      expect(keys.has('requests')).toBe(false);
      const admins = json<MediaAccountDto[]>(await admin.get(`/admin/media/accounts?orgId=${musterId}`));
      expect(admins.every((a) => a.requests === undefined)).toBe(true);
      // Staff still see the add-on of the allowance (Seerr is configured), not the totals.
      const allowance = json<MediaAllowanceDto>(await admin.get(`/admin/orgs/${musterId}/media-allowance`));
      expect(allowance.requests).toEqual(MUSTER_REQUESTS);
      expect(allowance.requestTotals).toBeUndefined();
      // Resellers see the add-on only while Seerr is on.
      expect(
        keysOf(json(await reto.get(`/reseller/customers/${huberId}/media-allowance`))).has('requests'),
      ).toBe(false);
    } finally {
      await setSeerrEnabled(true);
    }
  });

  it('gives staff the add-on and totals, and requests of every account on the instance', async () => {
    const muster = json<MediaAllowanceDto>(await admin.get(`/admin/orgs/${musterId}/media-allowance`));
    expect(muster.requests).toEqual(MUSTER_REQUESTS);
    expect(muster.requestTotals).toEqual({ accounts: 2, pending: 1, approved: 1, available: 2 });
    const huber = json<MediaAllowanceDto>(await admin.get(`/admin/orgs/${huberId}/media-allowance`));
    expect(huber.requests).toBeNull();
    expect(huber.requestTotals).toEqual({ accounts: 0, pending: 0, approved: 0, available: 0 });
    const accounts = json<MediaAccountDto[]>(await admin.get(`/admin/media/accounts?providerId=${demo.id}`));
    expect(accounts.find((a) => a.username === 'huber-bivane')!.requests).toEqual({
      ready: false,
      counts: null,
    });
    // The reseller with the add-on sees its customer's (off) and the totals.
    const customer = json<MediaAllowanceDto>(
      await reto.get(`/reseller/customers/${huberId}/media-allowance`),
    );
    expect(customer.requests).toBeNull();
    expect(customer.requestTotals).toEqual({ accounts: 0, pending: 0, approved: 0, available: 0 });
  });

  it('lists the stored Seerr state per instance, without a live call', async () => {
    const check = vi.spyOn(DemoAdapter.prototype, 'seerrCheck');
    try {
      const instances = json<MediaInstanceDto[]>(await admin.get('/admin/media/instances'));
      expect(instances.find((i) => i.provider.id === demo.id)!.seerr).toEqual({
        url: DEMO_SEERR_URL,
        enabled: true,
        status: 'ok',
        organizationsWithRequests: 2,
      });
      expect(check).not.toHaveBeenCalled();
    } finally {
      check.mockRestore();
    }
    const none = await withoutSeerr([demo.id], async () =>
      json<MediaInstanceDto[]>(await admin.get('/admin/media/instances')),
    );
    expect(none.find((i) => i.provider.id === demo.id)!.seerr).toBeNull();
  });
});

describe('account lifecycle', () => {
  let lisa: string;

  it('sets up a new account in Seerr with the rights and quotas of the add-on', async () => {
    const account = await createAccount(anna, musterId, 'lisa');
    lisa = account.id;
    expect(account.requests).toEqual({ ready: true, counts: null });
    const user = seerrUserOf('lisa-kemaro')!;
    expect(rightsOf(user)).toEqual(MUSTER_SEERR);
    // Seerr's settings of the user are its own, never linked to the owner.
    expect(user.settings!.linkedTo).toBe(user.id);
    expect((await stored('lisa-kemaro'))!).toMatchObject({ seerrUserId: user.id, issues: [] });
    expect((await lastAudit('media.account_create', lisa))!.details).toMatchObject({
      username: 'lisa-kemaro',
      seerr: 'ok',
    });
  });

  it('creates the account although Seerr fails, and the sync imports it', async () => {
    seerr().fail.add('importSeerrUser');
    let mia: MediaAccountDto;
    try {
      mia = await createAccount(anna, musterId, 'mia');
    } finally {
      seerr().fail.delete('importSeerrUser');
    }
    expect(mia.issues).toEqual(['seerr_missing']);
    expect(mia.requests).toEqual({ ready: false, counts: null });
    expect(seerrUserOf('mia-kemaro')).toBeUndefined();
    expect((await lastAudit('media.account_create', mia.id))!.details).toMatchObject({
      seerr: { error: 'Seerr: importSeerrUser failed: simulated (HTTP 503)' },
    });
    // The sync's Seerr part imports it.
    expect(await sync()).toMatchObject({ imported: 1, failed: 0 });
    expect(rightsOf(seerrUserOf('mia-kemaro'))).toEqual(MUSTER_SEERR);
    expect((await stored('mia-kemaro'))!.issues).toEqual([]);
    expect((await lastAudit('media.seerr_repair', mia.id))!).toMatchObject({
      actorName: 'Sync',
      orgId: musterId,
      details: { username: 'mia-kemaro', imported: true },
    });
    expect((await remove(anna, mia.id, 'mia-kemaro')).statusCode).toBe(200);
  });

  it('keeps the Seerr issues when the Jellyfin side rewrites the issues', async () => {
    await t.db
      .update(mediaAccounts)
      .set({ issues: ['seerr_drift'] })
      .where(eq(mediaAccounts.id, lisa));
    seerr().fail.add('listSeerrUsers');
    try {
      await tick();
      expect((await admin.post(`/admin/providers/${demo.id}/sync`)).statusCode).toBe(200);
      // The streaming part ran, the Seerr part stopped: the issue is still there.
      expect((await stored('lisa-kemaro'))!.issues).toEqual(['seerr_drift']);
      expect(
        await t.db.query.mediaSeerr.findFirst({ where: eq(mediaSeerr.providerConnectionId, demo.id) }),
      ).toMatchObject({
        status: 'error',
        lastError: 'Seerr: listSeerrUsers failed: simulated (HTTP 503)',
      });
      // A live refresh rewrites the Jellyfin issues and keeps the Seerr one.
      const live = json<MediaAccountDto>(await anna.get(`/media/accounts/${lisa}`));
      expect(live.issues).toEqual(['seerr_drift']);
    } finally {
      seerr().fail.delete('listSeerrUsers');
    }
    await sync();
    expect((await stored('lisa-kemaro'))!.issues).toEqual([]);
  });

  it('takes the request rights with a disable and restores them with an enable', async () => {
    const off = await anna.patch(`/media/accounts/${lisa}`, { enabled: false });
    expect(off.statusCode, off.body).toBe(200);
    expect(seerrUserOf('lisa-kemaro')!.permissions).toBe(0);
    expect((await lastAudit('media.account_update', lisa))!.details).toMatchObject({ seerr: 'ok' });
    const on = await anna.patch(`/media/accounts/${lisa}`, { enabled: true });
    expect(on.statusCode, on.body).toBe(200);
    expect(rightsOf(seerrUserOf('lisa-kemaro'))).toEqual(MUSTER_SEERR);
  });

  it('disables although Seerr fails, with the drift as an issue', async () => {
    seerr().fail.add('setSeerrUserAccess');
    try {
      const off = await anna.patch(`/media/accounts/${lisa}`, { enabled: false });
      expect(off.statusCode, off.body).toBe(200);
      expect(json<MediaAccountDto>(off)).toMatchObject({ enabled: false, issues: ['seerr_drift'] });
      expect(seerrUserOf('lisa-kemaro')!.permissions).toBe(BOTH);
    } finally {
      seerr().fail.delete('setSeerrUserAccess');
    }
    // The sync takes them.
    expect(await sync()).toMatchObject({ repaired: 1, failed: 0 });
    expect(seerrUserOf('lisa-kemaro')!.permissions).toBe(0);
    expect((await lastAudit('media.seerr_repair', lisa))!.details).toEqual({
      username: 'lisa-kemaro',
      fields: ['permissions'],
    });
    expect((await anna.patch(`/media/accounts/${lisa}`, { enabled: true })).statusCode).toBe(200);
  });

  it('stores the result only while the account is still as it was, and takes a grant back otherwise', async () => {
    expect((await anna.patch(`/media/accounts/${lisa}`, { enabled: false })).statusCode).toBe(200);
    // While Seerr receives the grant of the enable, the account is disabled again (another request).
    const original = DemoAdapter.prototype.setSeerrUserAccess;
    let raced = false;
    const spy = vi.spyOn(DemoAdapter.prototype, 'setSeerrUserAccess').mockImplementation(async function (
      this: DemoAdapter,
      id: number,
      access: SeerrUserAccess,
      current: RemoteSeerrUser,
    ) {
      const written = await original.call(this, id, access, current);
      if (!raced && access.permissions > 0) {
        raced = true;
        await t.db.update(mediaAccounts).set({ enabled: false }).where(eq(mediaAccounts.id, lisa));
      }
      return written;
    });
    try {
      await t.db.update(mediaAccounts).set({ enabled: true }).where(eq(mediaAccounts.id, lisa));
      expect(await syncSeerrAccount(t.ctx, lisa)).toBe('ok');
      expect(raced).toBe(true);
      // The second round saw the disable and took the rights again.
      expect(seerrUserOf('lisa-kemaro')!.permissions).toBe(0);

      // Seerr is switched off for the instance during a grant: the grant is taken back.
      raced = false;
      spy.mockImplementation(async function (this: DemoAdapter, id, access, current) {
        const written = await original.call(this, id, access, current);
        if (!raced && access.permissions > 0) {
          raced = true;
          await setSeerrEnabled(false);
        }
        return written;
      });
      await t.db.update(mediaAccounts).set({ enabled: true }).where(eq(mediaAccounts.id, lisa));
      expect(await syncSeerrAccount(t.ctx, lisa)).toBe('skipped');
      expect(seerrUserOf('lisa-kemaro')!.permissions).toBe(0);
    } finally {
      spy.mockRestore();
      await setSeerrEnabled(true);
    }
    expect(await syncSeerrAccount(t.ctx, lisa)).toBe('ok');
    expect(rightsOf(seerrUserOf('lisa-kemaro'))).toEqual(MUSTER_SEERR);
  });

  it('takes a first grant back that a disable raced, and stores whom it went to', async () => {
    seerr().fail.add('importSeerrUser');
    let quinn: MediaAccountDto;
    try {
      quinn = await createAccount(anna, musterId, 'quinn');
    } finally {
      seerr().fail.delete('importSeerrUser');
    }
    expect((await stored('quinn-kemaro'))!.seerrUserId).toBeNull();
    // While Seerr receives the first grant, the account is disabled (another request), whose own
    // Seerr step finds no Seerr user to take rights from yet.
    const original = DemoAdapter.prototype.setSeerrUserAccess;
    let raced = false;
    let disableStep: unknown;
    const spy = vi.spyOn(DemoAdapter.prototype, 'setSeerrUserAccess').mockImplementation(async function (
      this: DemoAdapter,
      id: number,
      access: SeerrUserAccess,
      current: RemoteSeerrUser,
    ) {
      const written = await original.call(this, id, access, current);
      if (!raced && access.permissions > 0) {
        raced = true;
        await t.db.update(mediaAccounts).set({ enabled: false }).where(eq(mediaAccounts.id, quinn.id));
        disableStep = await syncSeerrAccount(t.ctx, quinn.id);
      }
      return written;
    });
    try {
      expect(await syncSeerrAccount(t.ctx, quinn.id)).toBe('ok');
    } finally {
      spy.mockRestore();
    }
    expect(raced).toBe(true);
    expect(disableStep).toBe('skipped');
    const user = seerrUserOf('quinn-kemaro')!;
    expect(user.permissions).toBe(0);
    expect((await stored('quinn-kemaro'))!).toMatchObject({ seerrUserId: user.id, issues: [] });
    // With the id stored, switching requests off or deleting the account reaches the Seerr user.
    expect((await remove(anna, quinn.id, 'quinn-kemaro')).statusCode).toBe(200);
    expect(seerr().users.has(user.id)).toBe(false);
  });

  it('takes a first grant back when the account was deleted meanwhile', async () => {
    seerr().fail.add('importSeerrUser');
    let rosa: MediaAccountDto;
    try {
      rosa = await createAccount(anna, musterId, 'rosa');
    } finally {
      seerr().fail.delete('importSeerrUser');
    }
    const row = (await stored('rosa-kemaro'))!;
    // The account is deleted while Seerr imports it: the delete found no Seerr user yet.
    const original = DemoAdapter.prototype.importSeerrUser;
    let deleteStep: unknown;
    const spy = vi.spyOn(DemoAdapter.prototype, 'importSeerrUser').mockImplementation(async function (
      this: DemoAdapter,
      jellyfinUserId: string,
    ) {
      if (deleteStep === undefined) {
        await t.db.delete(mediaAccounts).where(eq(mediaAccounts.id, rosa.id));
        deleteStep = await deleteSeerrAccount(t.ctx, row);
      }
      return original.call(this, jellyfinUserId);
    });
    try {
      await syncSeerrAccount(t.ctx, rosa.id);
    } finally {
      spy.mockRestore();
    }
    expect(deleteStep).toBe('skipped');
    const user = seerrUserOf('rosa-kemaro')!;
    expect(user.permissions).toBe(0);
    // What the delete route did besides: the Jellyfin user goes, and with it its Seerr user here.
    demoMediaState(demo.id).users.delete(row.externalId);
    seerr().users.delete(user.id);
  });

  it('deletes the Seerr user of an account whose Seerr id was not stored yet', async () => {
    const sven = await createAccount(anna, musterId, 'sven');
    const user = seerrUserOf('sven-kemaro')!;
    // As the delete read it: before a concurrent first import stored the id.
    await t.db.update(mediaAccounts).set({ seerrUserId: null }).where(eq(mediaAccounts.id, sven.id));
    expect((await remove(anna, sven.id, 'sven-kemaro')).statusCode).toBe(200);
    expect(seerr().users.has(user.id)).toBe(false);
    expect((await lastAudit('media.account_delete', sven.id))!.details).toMatchObject({ seerr: 'ok' });
  });

  it('deletes the Seerr user with its requests along with the account', async () => {
    const user = seerrUserOf('lisa-kemaro')!;
    addDemoSeerrRequest(seerr(), { requestedBy: user.id });
    expect((await remove(anna, lisa, 'lisa-kemaro')).statusCode).toBe(200);
    expect(seerr().users.has(user.id)).toBe(false);
    expect(seerr().requests.some((r) => r.requestedBy === user.id)).toBe(false);
    expect((await lastAudit('media.account_delete', lisa))!.details).toMatchObject({ seerr: 'ok' });
  });

  it('deletes the account although Seerr fails, and the sync takes the orphan its rights', async () => {
    const nora = await createAccount(anna, musterId, 'nora');
    const user = seerrUserOf('nora-kemaro')!;
    seerr().fail.add('deleteSeerrUser');
    try {
      expect((await remove(anna, nora.id, 'nora-kemaro')).statusCode).toBe(200);
    } finally {
      seerr().fail.delete('deleteSeerrUser');
    }
    expect(await stored('nora-kemaro')).toBeUndefined();
    expect((await lastAudit('media.account_delete', nora.id))!.details).toMatchObject({
      seerr: { error: 'Seerr: deleteSeerrUser failed: simulated (HTTP 503)' },
    });
    expect(seerr().users.get(user.id)!.permissions).toBe(BOTH);
    expect(await sync()).toMatchObject({ revoked: 1 });
    expect(seerr().users.get(user.id)!.permissions).toBe(0);
    expect((await lastAudit('media.seerr_revoke'))!.details).toEqual({
      seerrUserId: user.id,
      jellyfinUserId: user.jellyfinUserId,
    });
  });

  it('never deletes a Seerr user of another Jellyfin user', async () => {
    const olga = await createAccount(anna, musterId, 'olga');
    // The stored id points at anna-kemaro's Seerr user (stale or tampered).
    await t.db.update(mediaAccounts).set({ seerrUserId: 2 }).where(eq(mediaAccounts.id, olga.id));
    expect((await remove(anna, olga.id, 'olga-kemaro')).statusCode).toBe(200);
    expect(seerr().users.has(2)).toBe(true);
    expect((await lastAudit('media.account_delete', olga.id))!.details).toMatchObject({
      seerr: { error: 'The Seerr user belongs to another Jellyfin user and was left alone' },
    });
    await sync();
  });

  it('sets nothing up in Seerr for an organization without the add-on', async () => {
    const before = seerr().users.size;
    const hugo = await createAccount(hanna, huberId, 'hugo');
    expect(seerr().users.size).toBe(before);
    expect(keysOf(hugo).has('requests')).toBe(false);
    const entry = (await lastAudit('media.account_create', hugo.id))!;
    expect(keysOf(entry.details).has('seerr')).toBe(false);
    expect((await remove(hanna, hugo.id, 'hugo-bivane')).statusCode).toBe(200);
    expect(keysOf((await lastAudit('media.account_delete', hugo.id))!.details).has('seerr')).toBe(false);
  });

  it('follows assignments and repairs of staff', async () => {
    const pia = await createAccount(anna, musterId, 'pia');
    // Unassigned: no rights (staff decide what happens to it).
    const unassigned = await admin.post(`/admin/media/accounts/${pia.id}/assign`, { orgId: null });
    expect(unassigned.statusCode, unassigned.body).toBe(200);
    expect(seerrUserOf('pia-kemaro')!.permissions).toBe(0);
    const back = await admin.post(`/admin/media/accounts/${pia.id}/assign`, { orgId: musterId });
    expect(back.statusCode, back.body).toBe(200);
    expect(rightsOf(seerrUserOf('pia-kemaro'))).toEqual(MUSTER_SEERR);
    expect((await lastAudit('media.account_assign', pia.id))!.details).toMatchObject({ seerr: 'ok' });
    // Changed in Seerr: "Richtlinie anwenden" repairs Seerr too.
    seerrUserOf('pia-kemaro')!.permissions = P.REQUEST | P.AUTO_APPROVE | P.REQUEST_4K;
    const repair = await admin.post(`/admin/media/accounts/${pia.id}/repair`);
    expect(repair.statusCode, repair.body).toBe(200);
    expect(rightsOf(seerrUserOf('pia-kemaro'))).toEqual(MUSTER_SEERR);
    expect((await remove(anna, pia.id, 'pia-kemaro')).statusCode).toBe(200);
  });

  it('sets an imported user up for its organization', async () => {
    const jellyfin = demoMediaState(demo.id).users.get(jellyfinIdOf('ben-kemaro')!)!;
    const res = await admin.post('/admin/media/accounts/import', {
      providerId: demo.id,
      userId: jellyfin.externalId,
      orgId: musterId,
    });
    expect(res.statusCode, res.body).toBe(200);
    const id = json(res).account.id as string;
    // ben-kemaro had a Seerr user already (id 4): it gets the add-on's rights.
    expect(rightsOf(seerr().users.get(4))).toEqual(MUSTER_SEERR);
    expect((await stored('ben-kemaro'))!.seerrUserId).toBe(4);
    expect((await lastAudit('media.account_import', id))!.details).toMatchObject({ seerr: 'ok' });
    expect((await remove(anna, id, 'ben-kemaro')).statusCode).toBe(200);
    // Deleting the account deleted its Seerr user.
    expect(seerr().users.has(4)).toBe(false);
  });
});

describe('allowances', () => {
  it('takes all rights with the add-on off, restores them and writes changed quotas', async () => {
    const off = await put(admin, `/admin/orgs/${musterId}/media-allowance`, musterBody(null));
    expect(off.statusCode, off.body).toBe(200);
    const result = json<MediaAllowanceChangeResult>(off);
    expect(result.allowance.requests).toBeNull();
    expect(result.seerr).toEqual({ applied: 2, failed: [] });
    expect(seerr().users.get(2)!.permissions).toBe(0);
    expect(seerr().users.get(3)!.permissions).toBe(0);
    expect(keysOf(await orgMedia(anna, musterId)).has('requests')).toBe(false);
    const entry = (await lastAudit('media.allowance_set', musterId))!;
    expect(entry.details).toMatchObject({
      previous: { requests: MUSTER_REQUESTS },
      seerr: { applied: 2, failed: [] },
    });
    expect(keysOf((entry.details as { requests?: unknown }).requests ?? {}).size).toBe(0);

    const moviesOnly: MediaRequestsAccess = {
      movies: true,
      tv: false,
      movieQuota: { limit: 2, days: 7 },
      tvQuota: null,
    };
    const on = await put(admin, `/admin/orgs/${musterId}/media-allowance`, musterBody(moviesOnly));
    expect(on.statusCode, on.body).toBe(200);
    expect(rightsOf(seerr().users.get(2))).toMatchObject({
      permissions: P.REQUEST_MOVIE,
      movieQuotaLimit: 2,
      movieQuotaDays: 7,
    });
    // The disabled account stays without rights.
    expect(seerr().users.get(3)!.permissions).toBe(0);

    // No limit is written as 0 (Seerr's default quota would apply to an unset limit).
    const unlimited: MediaRequestsAccess = {
      movies: true,
      tv: true,
      movieQuota: null,
      tvQuota: { limit: 4, days: 14 },
    };
    const quotas = await put(admin, `/admin/orgs/${musterId}/media-allowance`, musterBody(unlimited));
    expect(json<MediaAllowanceChangeResult>(quotas).seerr).toEqual({ applied: 2, failed: [] });
    expect(rightsOf(seerr().users.get(2))).toEqual({
      permissions: BOTH,
      movieQuotaLimit: 0,
      movieQuotaDays: 0,
      tvQuotaLimit: 4,
      tvQuotaDays: 14,
    });
    // The same add-on again (absent keeps it): no Seerr writes.
    const same = await put(admin, `/admin/orgs/${musterId}/media-allowance`, musterBody());
    expect(json<MediaAllowanceChangeResult>(same).allowance.requests).toEqual(unlimited);
    expect(keysOf(json(same)).has('seerr')).toBe(false);

    const back = await put(admin, `/admin/orgs/${musterId}/media-allowance`, musterBody(MUSTER_REQUESTS));
    expect(back.statusCode).toBe(200);
    expect(rightsOf(seerr().users.get(2))).toEqual(MUSTER_SEERR);
  });

  it('keeps the add-on out of the organization audit log while Seerr is not active there', async () => {
    const org = await newOrg('Seerr Aus AG', 'seerr-aus');
    await setSeerrEnabled(false);
    try {
      // Staff keep Muster AG's add-on (absent keeps it) and prepare one for a new organization.
      expect((await put(admin, `/admin/orgs/${musterId}/media-allowance`, musterBody())).statusCode).toBe(
        200,
      );
      expect(keysOf((await lastAudit('media.allowance_set', musterId))!.details).has('requests')).toBe(false);
      const prepared = await put(admin, `/admin/orgs/${org.id}/media-allowance`, {
        providerId: demo.id,
        accountCode: 'seerra',
        maxAccounts: 1,
        ...HUBER_ACCESS,
        requests: MUSTER_REQUESTS,
      });
      expect(prepared.statusCode, prepared.body).toBe(200);
      // Staff see the add-on they prepared; the organization's log has nothing of it.
      expect(json<MediaAllowanceChangeResult>(prepared).allowance.requests).toEqual(MUSTER_REQUESTS);
      expect(keysOf((await lastAudit('media.allowance_set', org.id))!.details).has('requests')).toBe(false);
      expect((await admin.del(`/admin/orgs/${org.id}/media-allowance`)).statusCode).toBe(200);
      const removed = (await lastAudit('media.allowance_delete', org.id))!;
      expect(removed.details).toMatchObject({ accountCode: 'seerra' });
      expect(keysOf(removed.details).has('requests')).toBe(false);
      // What the organization reads there.
      const log = await anna.get(`/orgs/${musterId}/audit?action=media.allowance&perPage=1`);
      expect(log.statusCode, log.body).toBe(200);
      expect(json(log).items).toMatchObject([{ action: 'media.allowance_set' }]);
      expect(keysOf(json(log)).has('requests')).toBe(false);
    } finally {
      await setSeerrEnabled(true);
    }
    // While active, the organization sees its add-on in its log as on its streaming page.
    expect((await put(admin, `/admin/orgs/${musterId}/media-allowance`, musterBody())).statusCode).toBe(200);
    expect((await lastAudit('media.allowance_set', musterId))!.details).toMatchObject({
      requests: MUSTER_REQUESTS,
      previous: { requests: MUSTER_REQUESTS },
    });
  });

  it('checks the add-on', async () => {
    const bad = [
      { movies: false, tv: false, movieQuota: null, tvQuota: null },
      { movies: true, tv: false, movieQuota: { limit: 0, days: 30 }, tvQuota: null },
      { movies: true, tv: false, movieQuota: { limit: 101, days: 30 }, tvQuota: null },
      { movies: true, tv: false, movieQuota: { limit: 5, days: 0 }, tvQuota: null },
      { movies: true, tv: false, movieQuota: { limit: 5, days: 366 }, tvQuota: null },
      { movies: true, tv: false, movieQuota: { limit: 1.5, days: 30 }, tvQuota: null },
      { movies: true, tv: false },
    ];
    for (const requests of bad) {
      const res = await put(admin, `/admin/orgs/${musterId}/media-allowance`, { ...musterBody(), requests });
      expect(res.statusCode, JSON.stringify(requests)).toBe(400);
    }
    // A quota of a type that is off is not kept.
    const res = await put(
      admin,
      `/admin/orgs/${musterId}/media-allowance`,
      musterBody({ ...MUSTER_REQUESTS, tv: false }),
    );
    expect(json<MediaAllowanceChangeResult>(res).allowance.requests).toEqual({
      ...MUSTER_REQUESTS,
      tv: false,
      tvQuota: null,
    });
    expect(
      (await put(admin, `/admin/orgs/${musterId}/media-allowance`, musterBody(MUSTER_REQUESTS))).statusCode,
    ).toBe(200);
  });

  it('sets up the existing accounts when an organization gets the add-on', async () => {
    const org = await newOrg('Seerr Test AG', 'seerr-test');
    const first = await put(admin, `/admin/orgs/${org.id}/media-allowance`, {
      providerId: demo.id,
      accountCode: 'seerrt',
      maxAccounts: 2,
      ...HUBER_ACCESS,
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(keysOf(json(first)).has('seerr')).toBe(false);
    const account = await createAccount(admin, org.id, 'eins');
    expect(seerrUserOf('eins-seerrt')).toBeUndefined();
    const on = await put(admin, `/admin/orgs/${org.id}/media-allowance`, {
      providerId: demo.id,
      maxAccounts: 2,
      ...HUBER_ACCESS,
      requests: { movies: false, tv: true, movieQuota: null, tvQuota: { limit: 1, days: 365 } },
    });
    expect(json<MediaAllowanceChangeResult>(on).seerr).toEqual({ applied: 1, failed: [] });
    expect(rightsOf(seerrUserOf('eins-seerrt'))).toEqual({
      permissions: P.REQUEST_TV,
      movieQuotaLimit: 0,
      movieQuotaDays: 0,
      tvQuotaLimit: 1,
      tvQuotaDays: 365,
    });
    // A failure is listed and stays as an issue.
    seerr().fail.add('setSeerrUserAccess');
    try {
      const off = await put(admin, `/admin/orgs/${org.id}/media-allowance`, {
        providerId: demo.id,
        maxAccounts: 2,
        ...HUBER_ACCESS,
        requests: null,
      });
      expect(json<MediaAllowanceChangeResult>(off).seerr).toEqual({
        applied: 0,
        failed: [
          {
            accountId: account.id,
            username: 'eins-seerrt',
            error: 'Seerr: setSeerrUserAccess failed: simulated (HTTP 503)',
          },
        ],
      });
      expect((await stored('eins-seerrt'))!.issues).toEqual(['seerr_drift']);
      expect((await lastAudit('media.allowance_set', org.id))!.details).toMatchObject({
        seerr: { applied: 0, failed: ['eins-seerrt'] },
      });
    } finally {
      seerr().fail.delete('setSeerrUserAccess');
    }
    await sync();
    expect(seerrUserOf('eins-seerrt')!.permissions).toBe(0);
    expect((await remove(admin, account.id, 'eins-seerrt')).statusCode).toBe(200);
    expect((await admin.del(`/admin/orgs/${org.id}/media-allowance`)).statusCode).toBe(200);
  });

  it('refuses the add-on on an instance without Seerr, also when an allowance moves there', async () => {
    const second = await newDemoConnection('Demo ohne Seerr');
    const org = await newOrg('Ohne Seerr AG', 'ohne-seerr');
    await withoutSeerr([second.id], async () => {
      const refused = await put(admin, `/admin/orgs/${org.id}/media-allowance`, {
        providerId: second.id,
        accountCode: 'ohnes',
        maxAccounts: 1,
        ...HUBER_ACCESS,
        requests: MUSTER_REQUESTS,
      });
      expect(refused.statusCode).toBe(409);
      expect(json(refused).error.code).toBe('requests_unavailable');
      const plain = await put(admin, `/admin/orgs/${org.id}/media-allowance`, {
        providerId: second.id,
        accountCode: 'ohnes',
        maxAccounts: 1,
        ...HUBER_ACCESS,
      });
      expect(plain.statusCode, plain.body).toBe(200);
      // No Seerr there: no add-on key for staff either.
      expect(keysOf(json(plain)).has('requests')).toBe(false);
      // On the demo instance with the add-on, then moved without saying anything about it.
      expect(
        (
          await put(admin, `/admin/orgs/${org.id}/media-allowance`, {
            providerId: demo.id,
            maxAccounts: 1,
            ...HUBER_ACCESS,
            requests: MUSTER_REQUESTS,
          })
        ).statusCode,
      ).toBe(200);
      const moved = await put(admin, `/admin/orgs/${org.id}/media-allowance`, {
        providerId: second.id,
        maxAccounts: 1,
        ...HUBER_ACCESS,
      });
      expect(moved.statusCode).toBe(409);
      expect(json(moved).error.code).toBe('requests_unavailable');
      // Moved with the add-on off: fine.
      expect(
        (
          await put(admin, `/admin/orgs/${org.id}/media-allowance`, {
            providerId: second.id,
            maxAccounts: 1,
            ...HUBER_ACCESS,
            requests: null,
          })
        ).statusCode,
      ).toBe(200);
    });
    expect((await admin.del(`/admin/orgs/${org.id}/media-allowance`)).statusCode).toBe(200);
    await t.db.delete(providerConnections).where(eq(providerConnections.id, second.id));
  });
});

describe('resellers', () => {
  const huberUrl = () => `/reseller/customers/${huberId}/media-allowance`;
  const conflictsOf = (res: { body: string }) =>
    (JSON.parse(res.body) as { error: { code: string; details: { customers: { conflicts: string[] }[] } } })
      .error;

  it('hands on the add-on within its own', async () => {
    const res = await put(
      reto,
      huberUrl(),
      huberBody({ movies: true, tv: false, movieQuota: { limit: 10, days: 30 }, tvQuota: null }),
    );
    expect(res.statusCode, res.body).toBe(200);
    const result = json<MediaAllowanceChangeResult>(res);
    expect(result.allowance.requests).toMatchObject({ movies: true, tv: false });
    expect(result.seerr).toEqual({ applied: 1, failed: [] });
    expect(rightsOf(seerrUserOf('huber-bivane'))).toEqual({
      permissions: P.REQUEST_MOVIE,
      movieQuotaLimit: 10,
      movieQuotaDays: 30,
      tvQuotaLimit: 0,
      tvQuotaDays: 0,
    });
    // Bäckerei Huber sees requests now.
    expect((await orgMedia(hanna, huberId)).requests).toMatchObject({ url: DEMO_SEERR_URL });
    expect((await lastAudit('media.allowance_set', huberId))!).toMatchObject({
      orgId: alpenId,
      details: { requests: { movies: true, tv: false }, seerr: { applied: 1, failed: [] } },
    });
  });

  it('refuses more than its own add-on', async () => {
    const cases: [MediaRequestsAccess, string[]][] = [
      [{ movies: true, tv: false, movieQuota: { limit: 11, days: 30 }, tvQuota: null }, ['movieQuota']],
      [{ movies: true, tv: false, movieQuota: { limit: 10, days: 7 }, tvQuota: null }, ['movieQuota']],
      [{ movies: true, tv: false, movieQuota: null, tvQuota: null }, ['movieQuota']],
      [
        { movies: true, tv: true, movieQuota: { limit: 10, days: 30 }, tvQuota: { limit: 7, days: 30 } },
        ['tvQuota'],
      ],
    ];
    for (const [requests, conflicts] of cases) {
      const res = await put(reto, huberUrl(), huberBody(requests));
      expect(res.statusCode, JSON.stringify(requests)).toBe(409);
      expect(conflictsOf(res).code).toBe('allowance_conflict');
      expect(conflictsOf(res).details.customers[0]!.conflicts).toEqual(conflicts);
    }
  });

  it('cannot be narrowed below what its customers got', async () => {
    const both: MediaRequestsAccess = {
      movies: true,
      tv: true,
      movieQuota: { limit: 10, days: 30 },
      tvQuota: { limit: 6, days: 30 },
    };
    expect((await put(reto, huberUrl(), huberBody(both))).statusCode).toBe(200);
    const noTv = await put(
      admin,
      `/admin/orgs/${alpenId}/media-allowance`,
      alpenBody({ ...ALPEN_REQUESTS, tv: false }),
    );
    expect(noTv.statusCode).toBe(409);
    expect(json(noTv).error.details.customers).toEqual([
      { id: huberId, name: 'Bäckerei Huber', conflicts: ['requestsTv'] },
    ]);
    const fewer = await put(
      admin,
      `/admin/orgs/${alpenId}/media-allowance`,
      alpenBody({ ...ALPEN_REQUESTS, movieQuota: { limit: 5, days: 30 } }),
    );
    expect(json(fewer).error.details.customers[0].conflicts).toEqual(['movieQuota']);
    const none = await put(admin, `/admin/orgs/${alpenId}/media-allowance`, alpenBody(null));
    expect(json(none).error.details.customers[0].conflicts).toEqual(['requestsMovies', 'requestsTv']);
  });

  it('hides the add-on from a reseller without it and refuses it from one', async () => {
    expect((await put(reto, huberUrl(), huberBody(null))).statusCode).toBe(200);
    expect(seerrUserOf('huber-bivane')!.permissions).toBe(0);
    const off = await put(admin, `/admin/orgs/${alpenId}/media-allowance`, alpenBody(null));
    expect(off.statusCode, off.body).toBe(200);
    const view = await reto.get(huberUrl());
    expect(keysOf(json(view)).has('requests')).toBe(false);
    expect(keysOf(json(view)).has('requestTotals')).toBe(false);
    const refused = await put(
      reto,
      huberUrl(),
      huberBody({ movies: true, tv: false, movieQuota: { limit: 1, days: 30 }, tvQuota: null }),
    );
    expect(refused.statusCode).toBe(409);
    expect(conflictsOf(refused).details.customers[0]!.conflicts).toEqual(['requestsMovies']);
    // Leaving it out keeps "none".
    expect((await put(reto, huberUrl(), huberBody())).statusCode).toBe(200);
    expect(
      (await put(admin, `/admin/orgs/${alpenId}/media-allowance`, alpenBody(ALPEN_REQUESTS))).statusCode,
    ).toBe(200);
  });

  it('refuses to keep a customer add-on beyond its own while Seerr is on', async () => {
    // Staff gave Bäckerei Huber more than Alpen Hosting has.
    await t.db
      .update(mediaAllowances)
      .set({ requestsMovies: true, movieQuotaLimit: 50, movieQuotaDays: 30 })
      .where(eq(mediaAllowances.orgId, huberId));
    const kept = await put(reto, huberUrl(), huberBody());
    expect(kept.statusCode).toBe(409);
    expect(conflictsOf(kept).details.customers[0]!.conflicts).toEqual(['movieQuota']);
    // While Seerr is off the add-on has no effect: other changes go through.
    await setSeerrEnabled(false);
    try {
      expect((await put(reto, huberUrl(), huberBody())).statusCode).toBe(200);
    } finally {
      await setSeerrEnabled(true);
    }
    expect((await put(reto, huberUrl(), huberBody(null))).statusCode).toBe(200);
  });

  it('keeps an add-on staff gave a customer of a reseller without one, and shows the reseller nothing of it', async () => {
    expect((await put(admin, `/admin/orgs/${alpenId}/media-allowance`, alpenBody(null))).statusCode).toBe(
      200,
    );
    try {
      // Staff give Bäckerei Huber the add-on directly.
      const given = await put(admin, `/admin/orgs/${huberId}/media-allowance`, {
        providerId: demo.id,
        ...huberBody(MUSTER_REQUESTS),
      });
      expect(given.statusCode, given.body).toBe(200);
      // The reseller sees nothing of it and can still change everything else; the add-on stays.
      const view = await reto.get(huberUrl());
      expect(keysOf(json(view)).has('requests')).toBe(false);
      const saved = await put(reto, huberUrl(), { ...huberBody(), maxStreams: 1 });
      expect(saved.statusCode, saved.body).toBe(200);
      expect(keysOf(json(saved)).has('requests')).toBe(false);
      const row = await t.db.query.mediaAllowances.findFirst({ where: eq(mediaAllowances.orgId, huberId) });
      expect(row).toMatchObject({
        maxStreams: 1,
        requestsMovies: true,
        requestsTv: true,
        movieQuotaLimit: 5,
      });
      // Nor in the reseller's audit log.
      const entry = (await lastAudit('media.allowance_set', huberId))!;
      expect(entry.orgId).toBe(alpenId);
      expect(keysOf(entry.details).has('requests')).toBe(false);
      // Handing it on is still refused.
      const refused = await put(reto, huberUrl(), huberBody(MUSTER_REQUESTS));
      expect(refused.statusCode).toBe(409);
      expect(conflictsOf(refused).details.customers[0]!.conflicts).toEqual(['requestsMovies', 'requestsTv']);
    } finally {
      expect(
        (
          await put(admin, `/admin/orgs/${huberId}/media-allowance`, {
            providerId: demo.id,
            ...huberBody(null),
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (await put(admin, `/admin/orgs/${alpenId}/media-allowance`, alpenBody(ALPEN_REQUESTS))).statusCode,
      ).toBe(200);
    }
  });

  it('shows a reseller without the add-on nothing of a customer add-on when the allowance goes', async () => {
    const [customer] = await t.db
      .insert(organizations)
      .values({
        name: 'Kunde ohne Zugänge',
        slug: 'kunde-ohne-zugaenge',
        kind: 'customer',
        boundary: DEFAULT_CUSTOMER_BOUNDARY,
        modules: ['media'],
        parentOrgId: alpenId,
      })
      .returning();
    const customerUrl = `/reseller/customers/${customer!.id}/media-allowance`;
    const body = { ...huberBody(null), maxAccounts: 1 };
    expect((await put(reto, customerUrl, body)).statusCode).toBe(200);
    expect((await put(admin, `/admin/orgs/${alpenId}/media-allowance`, alpenBody(null))).statusCode).toBe(
      200,
    );
    try {
      // Staff give the customer the add-on directly; the reseller sees nothing of it.
      const given = await put(admin, `/admin/orgs/${customer!.id}/media-allowance`, {
        providerId: demo.id,
        ...body,
        requests: MUSTER_REQUESTS,
      });
      expect(given.statusCode, given.body).toBe(200);
      expect((await reto.del(customerUrl)).statusCode).toBe(200);
      const entry = (await lastAudit('media.allowance_delete', customer!.id))!;
      expect(entry.orgId).toBe(alpenId);
      expect(entry.details).toMatchObject({ customer: 'Kunde ohne Zugänge', maxAccounts: 1 });
      expect(keysOf(entry.details).has('requests')).toBe(false);
    } finally {
      expect(
        (await put(admin, `/admin/orgs/${alpenId}/media-allowance`, alpenBody(ALPEN_REQUESTS))).statusCode,
      ).toBe(200);
    }
    // A reseller with the add-on sees it there, as in the dialog.
    expect((await put(reto, customerUrl, { ...body, requests: ALPEN_REQUESTS })).statusCode).toBe(200);
    expect((await reto.del(customerUrl)).statusCode).toBe(200);
    expect((await lastAudit('media.allowance_delete', customer!.id))!.details).toMatchObject({
      requests: ALPEN_REQUESTS,
    });
  });
});

describe('switching per instance', () => {
  const url = () => `/admin/providers/${demo.id}/media/seerr`;

  it('checks live for staff, with the counts', async () => {
    const res = await admin.get(url());
    expect(res.statusCode, res.body).toBe(200);
    const dto = json<MediaSeerrDto>(res);
    expect(dto).toMatchObject({
      url: DEMO_SEERR_URL,
      enabled: true,
      status: 'ok',
      lastError: null,
      organizations: 3,
      organizationsWithRequests: 2,
      // anna-kemaro, wohnzimmer-kemaro and huber-bivane (set up while Bäckerei Huber had requests).
      accountsInSeerr: 3,
    });
    expect(dto.check).toMatchObject({ problems: [], unmanagedRequesters: 0, version: '3.5.1' });
    // Seerr users of deleted accounts whose deletion in Seerr failed or was refused above.
    expect(dto.check!.orphans).toBe(2);
    expect(dto.checkedAt).toEqual(expect.any(String));
    // Support reads, but never switches.
    expect((await support.get(url())).statusCode).toBe(200);
    expect((await put(support, url(), { enabled: false })).statusCode).toBe(403);
    expect((await put(bot, url(), { enabled: false })).statusCode).toBe(403);
    expect((await bot.post(`${url()}/settings`)).statusCode).toBe(403);
    expect((await support.post(`${url()}/settings`)).statusCode).toBe(403);
    expect((await anna.get(url())).statusCode).toBe(403);
  });

  it('stores why Seerr could not be checked, never as part of the check', async () => {
    seerr().keyRejected = true;
    try {
      const dto = json<MediaSeerrDto>(await admin.get(url()));
      expect(dto).toMatchObject({ status: 'error', check: { problems: ['key'] } });
      expect(dto.lastError).toContain('The API key was rejected');
      expect(keysOf(dto.check).has('error')).toBe(false);
      await sync();
      const row = (await t.db.query.mediaSeerr.findFirst({
        where: eq(mediaSeerr.providerConnectionId, demo.id),
      }))!;
      expect(row).toMatchObject({ status: 'error', lastCheck: { problems: ['key'] } });
      expect(row.lastError).toContain('The API key was rejected');
      expect(keysOf(row.lastCheck).has('error')).toBe(false);
    } finally {
      seerr().keyRejected = false;
    }
    expect(json<MediaSeerrDto>(await admin.get(url()))).toMatchObject({ status: 'ok', lastError: null });
  });

  it('counts orphans and unmanaged requesters for staff', async () => {
    const orphan = addDemoSeerrUser(seerr(), { jellyfinUserId: '0123456789abcdef0123456789abcdef' });
    const local = addDemoSeerrUser(seerr(), { permissions: P.REQUEST });
    try {
      const dto = json<MediaSeerrDto>(await admin.get(url()));
      expect(dto.check).toMatchObject({ unmanagedRequesters: 1, orphans: 3 });
    } finally {
      seerr().users.delete(orphan.id);
      seerr().users.delete(local.id);
    }
  });

  it('switching off also takes the rights of a Seerr user whose id was never stored', async () => {
    const tara = await createAccount(anna, musterId, 'tara');
    const user = seerrUserOf('tara-kemaro')!;
    expect(user.permissions).toBe(BOTH);
    // As a grant raced by a revocation can leave it: rights in Seerr, no id on the row.
    await t.db.update(mediaAccounts).set({ seerrUserId: null }).where(eq(mediaAccounts.id, tara.id));
    try {
      const off = await put(admin, url(), { enabled: false });
      expect(off.statusCode, off.body).toBe(200);
      expect(seerrUserOf('tara-kemaro')!.permissions).toBe(0);
      expect(json<MediaSeerrChangeResult>(off).applied.failed).toEqual([]);
    } finally {
      await setSeerrEnabled(true);
    }
    expect((await remove(anna, tara.id, 'tara-kemaro')).statusCode).toBe(200);
    expect(seerrUserOf('tara-kemaro')).toBeUndefined();
    // The other accounts get their rights and numbers back.
    await sync();
    expect(rightsOf(seerr().users.get(2))).toEqual(MUSTER_SEERR);
  });

  it('switches off: every account loses its request rights, numbers and issues go', async () => {
    await t.db
      .update(mediaAccounts)
      .set({ issues: ['seerr_drift'] })
      .where(eq(mediaAccounts.username, 'anna-kemaro'));
    const res = await put(admin, url(), { enabled: false });
    expect(res.statusCode, res.body).toBe(200);
    const result = json<MediaSeerrChangeResult>(res);
    expect(result.seerr.enabled).toBe(false);
    expect(result.applied).toEqual({ applied: 3, failed: [] });
    expect(seerr().users.get(2)!.permissions).toBe(0);
    expect(seerr().users.get(2)!.movieQuotaLimit).toBe(5);
    const annaRow = (await stored('anna-kemaro'))!;
    expect(annaRow).toMatchObject({ issues: [], seerrRequests: null, seerrSyncedAt: null, seerrUserId: 2 });
    expect((await lastAudit('media.seerr_disable', demo.id))!).toMatchObject({
      resourceType: 'provider',
      details: { organizations: 3, shared: true, applied: 3, failed: [] },
    });
    // Nothing changes on a second request, and the sync leaves Seerr alone.
    expect(json<MediaSeerrChangeResult>(await put(admin, url(), { enabled: false })).applied).toEqual({
      applied: 0,
      failed: [],
    });
    expect(await sync()).toEqual({ imported: 0, repaired: 0, revoked: 0, failed: 0, counted: 0 });
    expect(keysOf(await orgMedia(anna, musterId)).has('requests')).toBe(false);
  });

  it('switches on only when safe and, on a shared instance, only with the confirmation', async () => {
    seerr().settings.newPlexLogin = true;
    const unsafe = await put(admin, url(), { enabled: true });
    expect(unsafe.statusCode).toBe(409);
    expect(json(unsafe).error).toMatchObject({
      code: 'seerr_unsafe',
      details: { problems: ['new_signins'] },
    });
    expect(
      (await t.db.query.mediaSeerr.findFirst({ where: eq(mediaSeerr.providerConnectionId, demo.id) }))!,
    ).toMatchObject({
      enabled: false,
      status: 'unsafe',
    });

    const applied = await admin.post(`${url()}/settings`);
    expect(applied.statusCode, applied.body).toBe(200);
    expect(json<MediaSeerrDto>(applied)).toMatchObject({
      status: 'ok',
      check: { problems: [], newSignIns: false },
    });
    expect(seerr().settings.newPlexLogin).toBe(false);
    expect((await lastAudit('media.seerr_settings', demo.id))!).toMatchObject({
      details: {
        before: { newSignIns: true, defaultPermissions: 0, mediaServerLogin: true },
        after: { newSignIns: false, defaultPermissions: 0, mediaServerLogin: true },
      },
    });

    const shared = await put(admin, url(), { enabled: true });
    expect(shared.statusCode).toBe(409);
    expect(json(shared).error).toMatchObject({ code: 'seerr_shared', details: { organizations: 3 } });
    const on = await put(admin, url(), { enabled: true, confirmShared: true });
    expect(on.statusCode, on.body).toBe(200);
    expect(json<MediaSeerrChangeResult>(on)).toMatchObject({
      seerr: { enabled: true, status: 'ok' },
      // Muster AG: anna-kemaro gets the add-on's rights, the disabled wohnzimmer-kemaro none.
      applied: { applied: 2, failed: [] },
    });
    expect(rightsOf(seerr().users.get(2))).toEqual(MUSTER_SEERR);
    expect((await lastAudit('media.seerr_enable', demo.id))!.details).toEqual({
      organizations: 3,
      shared: true,
      applied: 2,
      failed: [],
    });
    expect(await sync()).toMatchObject({ failed: 0, counted: 3 });
    expect((await orgMedia(anna, musterId)).requests).toMatchObject({ url: DEMO_SEERR_URL });
  });

  it('applies the recommended settings only to a Seerr of this server and never past CSRF protection', async () => {
    seerr().settings.newPlexLogin = true;
    seerr().settings.csrfProtection = true;
    try {
      const csrf = await admin.post(`${url()}/settings`);
      expect(csrf.statusCode).toBe(409);
      expect(json(csrf).error.details).toEqual({ problems: ['csrf'] });
      seerr().settings.csrfProtection = false;
      seerr().serverId = '0123456789abcdef0123456789abcdef';
      const other = await admin.post(`${url()}/settings`);
      expect(json(other).error.details).toEqual({ problems: ['other_server'] });
      expect(seerr().settings.newPlexLogin).toBe(true);
    } finally {
      seerr().serverId = demoMediaServerId();
      seerr().settings.newPlexLogin = false;
      seerr().settings.csrfProtection = false;
    }
  });

  it('refuses to switch on when the Seerr address changed meanwhile', async () => {
    await setSeerrEnabled(false);
    // The address follows the stored config, which a provider edit changes while Seerr is checked.
    const url0 = DemoAdapter.prototype.seerrUrl;
    const urlSpy = vi.spyOn(DemoAdapter.prototype, 'seerrUrl').mockImplementation(function (
      this: DemoAdapter,
    ) {
      const config = (this as unknown as { config: { seerrUrl?: string } }).config;
      return config.seerrUrl ?? url0.call(this);
    });
    const check0 = DemoAdapter.prototype.seerrCheck;
    const checkSpy = vi.spyOn(DemoAdapter.prototype, 'seerrCheck').mockImplementationOnce(async function (
      this: DemoAdapter,
    ) {
      await t.db
        .update(providerConnections)
        .set({ configEnc: t.ctx.box.encryptJson({ seerrUrl: 'https://other.example.test' }) })
        .where(eq(providerConnections.id, demo.id));
      return check0.call(this);
    });
    try {
      const res = await put(admin, url(), { enabled: true, confirmShared: true });
      expect(res.statusCode, res.body).toBe(409);
      expect(json(res).error.message).toContain('changed meanwhile');
      expect(
        (await t.db.query.mediaSeerr.findFirst({ where: eq(mediaSeerr.providerConnectionId, demo.id) }))!
          .enabled,
      ).toBe(false);
    } finally {
      checkSpy.mockRestore();
      urlSpy.mockRestore();
      await t.db
        .update(providerConnections)
        .set({ configEnc: demo.configEnc })
        .where(eq(providerConnections.id, demo.id));
      t.ctx.providers.invalidate(demo.id);
      await setSeerrEnabled(true);
    }
  });

  it('answers the stored state when the live check takes too long', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    const spy = vi
      .spyOn(DemoAdapter.prototype, 'seerrCheck')
      .mockImplementation(() => new Promise(() => undefined));
    try {
      let answered = false;
      const pending = admin.get(url()).finally(() => (answered = true));
      for (let i = 0; i < 30 && !answered; i++) await vi.advanceTimersByTimeAsync(1_000);
      const res = await pending;
      expect(res.statusCode).toBe(200);
      expect(json<MediaSeerrDto>(res)).toMatchObject({
        enabled: true,
        status: 'ok',
        lastError: 'Seerr did not answer in time',
      });
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('is only for instances with streaming', async () => {
    const [joker] = await t.db
      .insert(providerConnections)
      .values({
        type: 'joker',
        name: 'Joker ohne Streaming',
        location: { country: 'CH', label: 'Joker' },
        configEnc: t.ctx.box.encryptJson({
          apiKey: 'joker-test-key',
          baseUrl: 'https://dmapi.invalid/request',
        }),
      })
      .returning();
    try {
      for (const res of [
        await admin.get(`/admin/providers/${joker!.id}/media/seerr`),
        await put(admin, `/admin/providers/${joker!.id}/media/seerr`, { enabled: true }),
        await admin.post(`/admin/providers/${joker!.id}/media/seerr/settings`),
      ]) {
        expect(res.statusCode, res.body).toBe(422);
      }
    } finally {
      await t.db.delete(providerConnections).where(eq(providerConnections.id, joker!.id));
    }
  });

  it('answers null without Seerr and refuses to switch it', async () => {
    await withoutSeerr([demo.id], async () => {
      const res = await admin.get(url());
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('null');
      const on = await put(admin, url(), { enabled: true });
      expect(on.statusCode).toBe(409);
      expect(json(on).error.code).toBe('seerr_not_configured');
    });
  });

  it('switches requests off also after their Seerr went away', async () => {
    await t.db
      .update(mediaAccounts)
      .set({ issues: ['seerr_drift'] })
      .where(eq(mediaAccounts.username, 'anna-kemaro'));
    try {
      await withoutSeerr([demo.id], async () => {
        const off = await put(admin, url(), { enabled: false });
        expect(off.statusCode, off.body).toBe(200);
        expect(json<MediaSeerrChangeResult>(off)).toMatchObject({
          seerr: { enabled: false },
          applied: { applied: 0, failed: [] },
        });
        expect(
          (await t.db.query.mediaSeerr.findFirst({ where: eq(mediaSeerr.providerConnectionId, demo.id) }))!
            .enabled,
        ).toBe(false);
        expect((await stored('anna-kemaro'))!).toMatchObject({ issues: [], seerrRequests: null });
        expect((await lastAudit('media.seerr_disable', demo.id))!.details).toMatchObject({ applied: 0 });
        // Nothing left to switch off, and nothing to switch on.
        const again = await put(admin, url(), { enabled: false });
        expect(again.statusCode).toBe(409);
        expect(json(again).error.code).toBe('seerr_not_configured');
      });
    } finally {
      await setSeerrEnabled(true);
    }
    await sync();
    expect((await stored('anna-kemaro'))!.seerrRequests).not.toBeNull();
  });
});

describe('sync', () => {
  it('repairs drift as "Sync" and keeps the owner and Seerr staff as they are', async () => {
    seerr().users.get(2)!.permissions = BOTH | P.AUTO_APPROVE;
    seerr().users.get(2)!.tvQuotaLimit = 99;
    const staff = addDemoSeerrUser(seerr(), { permissions: P.MANAGE_REQUESTS | P.REQUEST });
    const voter = addDemoSeerrUser(seerr(), { permissions: P.VOTE | P.REQUEST | P.AUTO_APPROVE_4K });
    expect(await sync()).toMatchObject({ repaired: 1, revoked: 1, failed: 0 });
    expect(rightsOf(seerr().users.get(2))).toEqual(MUSTER_SEERR);
    expect((await lastAudit('media.seerr_repair', (await stored('anna-kemaro'))!.id))!).toMatchObject({
      actorName: 'Sync',
      orgId: musterId,
      details: { username: 'anna-kemaro', fields: ['permissions', 'tvQuota'] },
    });
    expect(seerr().users.get(staff.id)!.permissions).toBe(P.MANAGE_REQUESTS | P.REQUEST);
    expect(seerr().users.get(voter.id)!.permissions).toBe(P.VOTE);
    expect(seerr().users.get(1)!.permissions).toBe(P.ADMIN);
    seerr().users.delete(staff.id);
    seerr().users.delete(voter.id);
  });

  it('writes at most 25 times per run', async () => {
    const added = Array.from({ length: 30 }, () =>
      addDemoSeerrUser(seerr(), { permissions: P.REQUEST_MOVIE }),
    );
    seerr().users.get(2)!.permissions = P.REQUEST;
    expect(await sync()).toMatchObject({ repaired: 1, revoked: 24 });
    expect(await sync()).toMatchObject({ repaired: 0, revoked: 6 });
    expect(added.every((u) => seerr().users.get(u.id)!.permissions === 0)).toBe(true);
    for (const u of added) seerr().users.delete(u.id);
  });

  it('re-applies drifted safe settings as "Sync" and stops at anything it cannot fix', async () => {
    seerr().settings.defaultPermissions = P.REQUEST;
    await sync();
    expect(seerr().settings.defaultPermissions).toBe(0);
    expect((await lastAudit('media.seerr_settings', demo.id))!).toMatchObject({
      actorName: 'Sync',
      details: { before: { defaultPermissions: P.REQUEST }, after: { defaultPermissions: 0 } },
    });

    // Another Jellyfin server: no writes at all, status error.
    seerr().serverId = '0123456789abcdef0123456789abcdef';
    seerr().users.get(2)!.permissions = P.REQUEST;
    const unmanaged = addDemoSeerrUser(seerr(), { permissions: P.REQUEST });
    try {
      expect(await sync()).toEqual({ imported: 0, repaired: 0, revoked: 0, failed: 0, counted: 0 });
      expect(seerr().users.get(2)!.permissions).toBe(P.REQUEST);
      expect(seerr().users.get(unmanaged.id)!.permissions).toBe(P.REQUEST);
      const row = (await t.db.query.mediaSeerr.findFirst({
        where: eq(mediaSeerr.providerConnectionId, demo.id),
      }))!;
      expect(row).toMatchObject({ status: 'error' });
      expect(row.lastCheck).toMatchObject({ sameServer: false, problems: ['other_server'] });
      // CSRF on is unsafe, and stops the writes as well.
      seerr().serverId = demoMediaServerId();
      seerr().settings.csrfProtection = true;
      expect(await sync()).toMatchObject({ repaired: 0, revoked: 0 });
      expect(
        (await t.db.query.mediaSeerr.findFirst({ where: eq(mediaSeerr.providerConnectionId, demo.id) }))!
          .status,
      ).toBe('unsafe');
    } finally {
      seerr().serverId = demoMediaServerId();
      seerr().settings.csrfProtection = false;
    }
    expect(await sync()).toMatchObject({ repaired: 1, revoked: 1 });
    seerr().users.delete(unmanaged.id);
  });

  it('keeps the numbers when Seerr has more requests than it reads', async () => {
    const before = (await stored('anna-kemaro'))!.seerrRequests;
    const added = 5001;
    for (let i = 0; i < added; i++) addDemoSeerrRequest(seerr(), { requestedBy: 3 });
    try {
      await sync();
      expect((await stored('anna-kemaro'))!.seerrRequests).toEqual(before);
      expect(
        (await t.db.query.mediaSeerr.findFirst({ where: eq(mediaSeerr.providerConnectionId, demo.id) }))!,
      ).toMatchObject({
        status: 'ok',
        lastError: 'more than 5000 requests: numbers not refreshed',
      });
    } finally {
      seerr().requests = seerr().requests.filter((r) => r.requestedBy !== 3);
    }
    // New numbers are read once they fit.
    addDemoSeerrRequest(seerr(), { requestedBy: 2, status: 5 });
    await sync();
    expect((await stored('anna-kemaro'))!.seerrRequests).toEqual({
      pending: 1,
      approved: 1,
      available: 3,
      movieUsed: 3,
      tvUsed: 2,
    });
    expect(
      (await t.db.query.mediaSeerr.findFirst({ where: eq(mediaSeerr.providerConnectionId, demo.id) }))!
        .lastError,
    ).toBeNull();
  });

  it('never marks the Jellyfin connection because of Seerr', async () => {
    seerr().fail.add('seerrCheck');
    try {
      expect(await sync()).toEqual({ imported: 0, repaired: 0, revoked: 0, failed: 0, counted: 0 });
      const connection = (await t.db.query.providerConnections.findFirst({
        where: eq(providerConnections.id, demo.id),
      }))!;
      expect(connection.status).toBe('ok');
      expect(
        (await t.db.query.mediaSeerr.findFirst({ where: eq(mediaSeerr.providerConnectionId, demo.id) }))!,
      ).toMatchObject({
        status: 'error',
      });
    } finally {
      seerr().fail.delete('seerrCheck');
    }
    seerr().fail.add('seerrRequestCounts');
    try {
      expect(await sync()).toMatchObject({ counted: 0 });
      expect(
        (await t.db.query.mediaSeerr.findFirst({ where: eq(mediaSeerr.providerConnectionId, demo.id) }))!,
      ).toMatchObject({
        status: 'ok',
        lastError: 'Seerr: seerrRequestCounts failed: simulated (HTTP 503)',
      });
    } finally {
      seerr().fail.delete('seerrRequestCounts');
    }
    await sync();
  });
});

describe('billing', () => {
  it('sets and clears the add-on like the admin route', async () => {
    const off = await setMediaRequests(t.ctx, musterId, null, null);
    expect(off.allowance.requests).toBeNull();
    expect(off.seerr).toEqual({ applied: 2, failed: [] });
    expect(seerr().users.get(2)!.permissions).toBe(0);
    expect((await lastAudit('media.allowance_set', musterId))!).toMatchObject({
      actorName: 'Billing',
      details: { requests: null, previous: { requests: MUSTER_REQUESTS } },
    });
    const on = await setMediaRequests(t.ctx, musterId, MUSTER_REQUESTS, null);
    expect(on.allowance.requests).toEqual(MUSTER_REQUESTS);
    expect(rightsOf(seerr().users.get(2))).toEqual(MUSTER_SEERR);
    // A reseller is never narrowed below its customers.
    expect(
      (await put(reto, `/reseller/customers/${huberId}/media-allowance`, huberBody({ ...ALPEN_REQUESTS })))
        .statusCode,
    ).toBe(200);
    await expect(setMediaRequests(t.ctx, alpenId, null, null)).rejects.toMatchObject({
      code: 'allowance_conflict',
    });
    expect(
      (await put(reto, `/reseller/customers/${huberId}/media-allowance`, huberBody(null))).statusCode,
    ).toBe(200);
    await expect(
      withoutSeerr([demo.id], () => setMediaRequests(t.ctx, musterId, MUSTER_REQUESTS, null)),
    ).rejects.toMatchObject({ code: 'requests_unavailable' });
    // An organization that sees no requests finds nothing of them in its log either.
    await setMediaRequests(t.ctx, huberId, null, null);
    const huber = (await lastAudit('media.allowance_set', huberId))!;
    expect(huber).toMatchObject({ actorName: 'Billing', orgId: huberId });
    expect(keysOf(huber.details).has('requests')).toBe(false);
  });
});

describe('privacy', () => {
  it('never hands out titles, TMDB ids or Seerr emails, in no answer and no audit row', async () => {
    const answers = [
      await anna.get(`/orgs/${musterId}/media`),
      await hanna.get(`/orgs/${huberId}/media`),
      await reto.get(`/reseller/customers/${huberId}/media-allowance`),
      await admin.get(`/admin/orgs/${musterId}/media-allowance`),
      await admin.get(`/admin/media/accounts`),
      await admin.get(`/admin/media/instances`),
      await admin.get(`/admin/providers/${demo.id}/media/seerr`),
      await admin.post(`/admin/providers/${demo.id}/sync`),
    ].map((res) => res.body);
    const audits = JSON.stringify(await t.db.select().from(auditLogs));
    const rows = JSON.stringify([
      await t.db.select().from(mediaAccounts),
      await t.db.select().from(mediaSeerr),
    ]);
    for (const text of [...answers, audits, rows]) {
      for (const title of TITLES) expect(text).not.toContain(title);
      for (const id of TMDB_IDS) expect(text).not.toContain(id);
      expect(text).not.toContain('@seerr.demo');
    }
    // The customer's answer has numbers, never Seerr's ids.
    expect(keysOf(JSON.parse(answers[0]!)).has('seerrUserId')).toBe(false);
  });
});

function demoMediaServerId(): string {
  return DEMO_MEDIA_SERVER.id;
}
