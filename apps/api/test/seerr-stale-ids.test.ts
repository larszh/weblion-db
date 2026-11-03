import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { MediaAccountDto, MediaSeerrChangeResult } from '@weblion/shared';
import type { SeerrSyncCounts } from '../src/jobs/sync-seerr';
import { auditLogs, mediaAccounts, organizations, providerConnections } from '../src/db/schema';
import { demoMediaState } from '../src/providers/demo/media';
import { addDemoSeerrUser, demoSeerrState, type DemoSeerrUser } from '../src/providers/demo/seerr';
import { SEERR_PERMISSION as P } from '../src/providers/seerr/rules';
import { ADMIN, Client, createTestApp, json, type TestApp } from './helpers';

/**
 * Stored Seerr ids that no longer name the account's Seerr user (another Seerr behind a new
 * address, a deleted user, a tampered row) are never written to: switching requests on and off,
 * account actions and the sync confirm the id by the Jellyfin id first and find the account's
 * user by its Jellyfin id instead. With the demo provider; Muster AG has the add-on, its accounts
 * are anna-kemaro (Seerr user 2) and the disabled wohnzimmer-kemaro (Seerr user 3).
 */

let t: TestApp;
let admin: Client;
let anna: Client;
let demoId: string;
let musterId: string;
/** Seerr staff and an administrator of Seerr, for other Jellyfin users than the console's. */
let staff: DemoSeerrUser;
let seerrAdmin: DemoSeerrUser;

const BOTH = P.REQUEST_MOVIE | P.REQUEST_TV;
const STAFF_RIGHTS = P.MANAGE_REQUESTS | P.REQUEST_MOVIE | P.REQUEST_TV;
const MUSTER_SEERR = {
  permissions: BOTH,
  movieQuotaLimit: 5,
  movieQuotaDays: 30,
  tvQuotaLimit: 3,
  tvQuotaDays: 30,
};

const seerr = () => demoSeerrState(demoId);
const url = () => `/admin/providers/${demoId}/media/seerr`;
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function jellyfinIdOf(username: string): string {
  return [...demoMediaState(demoId).users.values()].find((u) => u.username === username)!.externalId;
}

function seerrUserOf(username: string): DemoSeerrUser | undefined {
  const id = jellyfinIdOf(username);
  return [...seerr().users.values()].find((u) => u.jellyfinUserId === id);
}

const rightsOf = (user: DemoSeerrUser | undefined) =>
  user && {
    permissions: user.permissions,
    movieQuotaLimit: user.movieQuotaLimit,
    movieQuotaDays: user.movieQuotaDays,
    tvQuotaLimit: user.tvQuotaLimit,
    tvQuotaDays: user.tvQuotaDays,
  };

async function stored(username: string) {
  return (await t.db.query.mediaAccounts.findFirst({
    where: and(eq(mediaAccounts.username, username), eq(mediaAccounts.providerConnectionId, demoId)),
  }))!;
}

async function storeSeerrId(username: string, seerrUserId: number | null) {
  await t.db
    .update(mediaAccounts)
    .set({ seerrUserId })
    .where(and(eq(mediaAccounts.username, username), eq(mediaAccounts.providerConnectionId, demoId)));
}

async function lastAudit(action: string, resourceId: string) {
  const rows = await t.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, action), eq(auditLogs.resourceId, resourceId)))
    .orderBy(auditLogs.id);
  return rows.at(-1);
}

async function switchRequests(enabled: boolean): Promise<MediaSeerrChangeResult> {
  const res = await admin.request('PUT', url(), { enabled, confirmShared: true });
  expect(res.statusCode, res.body).toBe(200);
  return json<MediaSeerrChangeResult>(res);
}

async function sync(): Promise<SeerrSyncCounts> {
  await tick();
  const res = await admin.post(`/admin/providers/${demoId}/sync`);
  expect(res.statusCode, res.body).toBe(200);
  return json(res).seerr;
}

/** The two users the console must never touch keep their rights. */
function expectUntouched() {
  expect(seerr().users.get(staff.id)!.permissions).toBe(STAFF_RIGHTS);
  expect(seerr().users.get(seerrAdmin.id)!.permissions).toBe(P.ADMIN);
  expect(seerr().users.get(1)!.permissions).toBe(P.ADMIN);
}

beforeAll(async () => {
  t = await createTestApp();
  admin = new Client(t.app);
  await admin.login(ADMIN.email, ADMIN.password);
  anna = new Client(t.app);
  await anna.login('anna@muster.example');
  demoId = (await t.db.query.providerConnections.findFirst({
    where: eq(providerConnections.envKey, 'demo'),
  }))!.id;
  musterId = (await t.db.query.organizations.findFirst({ where: eq(organizations.slug, 'muster-ag') }))!.id;
  // As another Seerr behind a new address would have them under the ids the accounts stored.
  staff = addDemoSeerrUser(seerr(), {
    jellyfinUserId: 'ee000000000000000000000000000001',
    permissions: STAFF_RIGHTS,
  });
  seerrAdmin = addDemoSeerrUser(seerr(), {
    jellyfinUserId: 'ee000000000000000000000000000002',
    permissions: P.ADMIN,
  });
  // The first sync: ben-kemaro (unmanaged) loses REQUEST; staff and the administrator stay.
  await sync();
  expectUntouched();
});

afterAll(async () => {
  await t?.close();
});

describe('switching requests on', () => {
  it('never writes to a stale id of a disabled account, and takes the rights of its own user', async () => {
    await switchRequests(false);
    // wohnzimmer-kemaro (disabled) stored the id of Seerr staff; its own user can request.
    await storeSeerrId('wohnzimmer-kemaro', staff.id);
    seerrUserOf('wohnzimmer-kemaro')!.permissions = P.REQUEST_MOVIE;
    // anna-kemaro (entitled) stored the administrator's.
    await storeSeerrId('anna-kemaro', seerrAdmin.id);

    const on = await switchRequests(true);
    expect(on.applied.failed).toEqual([]);
    expectUntouched();
    expect(seerrUserOf('wohnzimmer-kemaro')!.permissions).toBe(0);
    expect((await stored('wohnzimmer-kemaro')).seerrUserId).toBe(seerrUserOf('wohnzimmer-kemaro')!.id);
    // The grant found anna-kemaro's own user by its Jellyfin id.
    expect(rightsOf(seerrUserOf('anna-kemaro'))).toEqual(MUSTER_SEERR);
    expect((await stored('anna-kemaro')).seerrUserId).toBe(2);
  });
});

describe('switching requests off', () => {
  it('never writes to a stale id, and finds the account user by its Jellyfin id instead', async () => {
    await storeSeerrId('anna-kemaro', seerrAdmin.id);
    // A Seerr user the new Seerr does not have at all.
    await storeSeerrId('wohnzimmer-kemaro', 999);
    seerrUserOf('wohnzimmer-kemaro')!.permissions = P.REQUEST_TV;

    const off = await switchRequests(false);
    expect(off.applied.failed).toEqual([]);
    expectUntouched();
    expect(seerrUserOf('anna-kemaro')!.permissions).toBe(0);
    expect(seerrUserOf('wohnzimmer-kemaro')!.permissions).toBe(0);
    // The stale ids are replaced by the users found by their Jellyfin ids.
    expect((await stored('anna-kemaro')).seerrUserId).toBe(2);
    expect((await stored('wohnzimmer-kemaro')).seerrUserId).toBe(3);

    await switchRequests(true);
    expect(rightsOf(seerrUserOf('anna-kemaro'))).toEqual(MUSTER_SEERR);
  });
});

describe('account actions', () => {
  it('a disable never writes to a stale id of another Jellyfin user', async () => {
    const account = await stored('anna-kemaro');
    await storeSeerrId('anna-kemaro', staff.id);
    const off = await anna.patch(`/media/accounts/${account.id}`, { enabled: false });
    expect(off.statusCode, off.body).toBe(200);
    expect(json<MediaAccountDto>(off).issues).toEqual([]);
    expectUntouched();
    expect(seerrUserOf('anna-kemaro')!.permissions).toBe(0);
    expect((await stored('anna-kemaro')).seerrUserId).toBe(2);
    expect((await lastAudit('media.account_update', account.id))!.details).toMatchObject({ seerr: 'ok' });

    const on = await anna.patch(`/media/accounts/${account.id}`, { enabled: true });
    expect(on.statusCode, on.body).toBe(200);
    expect(rightsOf(seerrUserOf('anna-kemaro'))).toEqual(MUSTER_SEERR);
  });

  it('a disable with an id Seerr does not have reaches the account user by its Jellyfin id', async () => {
    const account = await stored('anna-kemaro');
    await storeSeerrId('anna-kemaro', 999);
    const off = await anna.patch(`/media/accounts/${account.id}`, { enabled: false });
    expect(off.statusCode, off.body).toBe(200);
    expect(seerrUserOf('anna-kemaro')!.permissions).toBe(0);
    expect((await stored('anna-kemaro')).seerrUserId).toBe(2);
    expectUntouched();

    // Without a Seerr user of its own: nothing to take, and the stale id goes.
    const user = seerrUserOf('anna-kemaro')!;
    seerr().users.delete(user.id);
    try {
      await storeSeerrId('anna-kemaro', seerrAdmin.id);
      const repair = await admin.post(`/admin/media/accounts/${account.id}/repair`);
      expect(repair.statusCode, repair.body).toBe(200);
      expectUntouched();
      expect((await stored('anna-kemaro')).seerrUserId).toBeNull();
    } finally {
      seerr().users.set(user.id, user);
    }
    expect((await anna.patch(`/media/accounts/${account.id}`, { enabled: true })).statusCode).toBe(200);
    expect(rightsOf(seerrUserOf('anna-kemaro'))).toEqual(MUSTER_SEERR);
    expect((await stored('anna-kemaro')).seerrUserId).toBe(2);
  });
});

describe('sync', () => {
  it('keeps seerr_missing without the numbers of a stale id, then imports the account', async () => {
    seerr().fail.add('importSeerrUser');
    let nina: MediaAccountDto;
    try {
      const res = await anna.post(`/orgs/${musterId}/media/accounts`, { name: 'nina' });
      expect(res.statusCode, res.body).toBe(200);
      nina = json<{ account: MediaAccountDto }>(res).account;
      expect(nina.issues).toEqual(['seerr_missing']);
      // A stale id: the Seerr user of anna-kemaro, who has requests.
      await storeSeerrId('nina-kemaro', 2);
      expect(await sync()).toMatchObject({ imported: 0, failed: 1 });
    } finally {
      seerr().fail.delete('importSeerrUser');
    }
    expect(await stored('nina-kemaro')).toMatchObject({
      seerrUserId: null,
      seerrRequests: null,
      issues: ['seerr_missing'],
    });
    expect(rightsOf(seerr().users.get(2))).toEqual(MUSTER_SEERR);
    expectUntouched();

    expect(await sync()).toMatchObject({ imported: 1, failed: 0 });
    const own = seerrUserOf('nina-kemaro')!;
    expect(rightsOf(own)).toEqual(MUSTER_SEERR);
    expect(await stored('nina-kemaro')).toMatchObject({ seerrUserId: own.id, issues: [] });
    expect((await stored('nina-kemaro')).seerrRequests).toMatchObject({ pending: 0, approved: 0 });
  });

  it('replaces a stale id of an account it left alone before reading numbers', async () => {
    // An account a route changed during the run (step 3 leaves it), with anna-kemaro's Seerr id.
    const later = new Date(Date.now() + 3_600_000);
    await t.db
      .update(mediaAccounts)
      .set({ seerrUserId: 2, updatedAt: later })
      .where(
        and(eq(mediaAccounts.username, 'wohnzimmer-kemaro'), eq(mediaAccounts.providerConnectionId, demoId)),
      );
    try {
      await sync();
      const row = await stored('wohnzimmer-kemaro');
      expect(row.seerrUserId).toBe(3);
      // Never the numbers of anna-kemaro (1 open, 1 approved, 2 available).
      expect(row.seerrRequests).toEqual({
        pending: 0,
        approved: 0,
        available: 0,
        movieUsed: null,
        tvUsed: null,
      });
      expect(rightsOf(seerr().users.get(2))).toEqual(MUSTER_SEERR);
      expectUntouched();
    } finally {
      await t.db
        .update(mediaAccounts)
        .set({ updatedAt: new Date() })
        .where(eq(mediaAccounts.username, 'wohnzimmer-kemaro'));
    }
  });
});
