import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import {
  expectedMediaPolicy,
  mediaPolicyDrift,
  type MediaAccess,
  type MediaPolicyState,
} from '@weblion/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mediaAccounts, mediaAllowances, organizations, providerConnections } from '../src/db/schema';
import { seedMediaDemo } from '../src/db/seed-media';
import { AppError, ProviderError } from '../src/lib/errors';
import { DemoAdapter } from '../src/providers/demo/adapter';
import {
  DEMO_MEDIA_IDS,
  DEMO_MEDIA_LIBRARIES,
  DEMO_MEDIA_SERVER,
  DEMO_MEDIA_URL,
  DEMO_MEDIA_USERS,
  DemoMedia,
  demoMediaState,
  jellyfinDefaultPolicy,
  resetDemoMedia,
} from '../src/providers/demo/media';
import { JELLYFIN_ADMIN_REFUSED } from '../src/providers/jellyfin/rules';
import { createTestApp, type TestApp } from './helpers';

const T0 = Date.parse('2026-10-14T08:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(T0 - ms).toISOString();

const ID = DEMO_MEDIA_IDS;
const LIB = {
  filme: '847f61bc736e6f8ef0f5542f43496822',
  serien: 'd91225786a8ac15d78c0c1ea46a12d75',
  kinder: '9f0ef2e22ac1ffae415e6ddd9696b76d',
  musik: 'a13e46539faa3b698f68cd49c93e4e18',
  doku: '12c2fdf0c2d0829458a6d7772ac65b83',
};
/**
 * The allowances of design 11.3 / 11.4 (Huber with 15 Mbit/s instead of none, within Alpen's 20),
 * written out instead of taken from the code under test.
 */
const MUSTER: MediaAccess = {
  libraryIds: [LIB.filme, LIB.serien, LIB.kinder],
  maxStreams: 2,
  downloads: false,
  remoteBitrateMbit: 8,
};
const HUBER: MediaAccess = {
  libraryIds: [LIB.filme, LIB.kinder],
  maxStreams: 2,
  downloads: false,
  remoteBitrateMbit: 15,
};
const PASSWORD = 'Geheimes-Passwort-42';
const UNKNOWN = '0123456789abcdef0123456789abcdef';

async function caught(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return err as AppError;
  }
  throw new Error('expected the promise to reject');
}

async function refused(
  promise: Promise<unknown>,
  status: number,
  code: string,
  message?: string | RegExp,
): Promise<AppError> {
  const err = await caught(promise);
  expect({ status: err.statusCode, code: err.code }).toEqual({ status, code });
  if (typeof message === 'string') expect(err.message).toBe(message);
  else if (message) expect(err.message).toMatch(message);
  return err;
}

/** Every key at any depth. */
function keys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keys);
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => [k, ...keys(v)]);
  }
  return [];
}

const dashed = (id: string) =>
  `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`.toUpperCase();

describe('Demo Jellyfin', () => {
  let id: string;
  const media = () => new DemoAdapter(id, {});
  const state = () => demoMediaState(id);
  const stored = (userId: string) => state().users.get(userId)!;
  const signOuts = (userId: string) => new DemoMedia(state()).signOuts(userId);
  const create = (username: string, password = PASSWORD, policy = expectedMediaPolicy(MUSTER)) =>
    media().createMediaUser({ username, password, policy });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    resetDemoMedia();
    id = randomUUID();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with the users, libraries and server of the dataset', async () => {
    const users = await media().listMediaUsers();
    expect(users.map((u) => u.username)).toEqual([
      'altkunde',
      'anna-kemaro',
      'ben-kemaro',
      'gast',
      'huber-bivane',
      'weblion-admin',
      'wohnzimmer-kemaro',
    ]);
    expect(Object.fromEntries(users.map((u) => [u.username, u.externalId]))).toEqual(ID);
    expect(DEMO_MEDIA_USERS.map((u) => u.name).sort()).toEqual(users.map((u) => u.username));
    expect(
      users.map((u) => [
        u.username,
        { admin: u.administrator, enabled: u.enabled, password: u.hasPassword, locked: u.lockedOut },
        u.blockedFolders,
        u.lastActivityAt,
      ]),
    ).toEqual([
      ['altkunde', { admin: false, enabled: true, password: true, locked: false }, true, ago(40 * DAY)],
      ['anna-kemaro', { admin: false, enabled: true, password: true, locked: false }, false, ago(2 * HOUR)],
      ['ben-kemaro', { admin: false, enabled: true, password: true, locked: false }, false, ago(3 * DAY)],
      ['gast', { admin: false, enabled: true, password: false, locked: false }, false, null],
      ['huber-bivane', { admin: false, enabled: true, password: true, locked: false }, false, ago(1 * DAY)],
      ['weblion-admin', { admin: true, enabled: true, password: true, locked: false }, false, ago(1 * HOUR)],
      [
        'wohnzimmer-kemaro',
        { admin: false, enabled: false, password: true, locked: true },
        false,
        ago(6 * DAY),
      ],
    ]);
    const byName = Object.fromEntries(users.map((u) => [u.username, u]));
    expect(byName['gast']!.lastLoginAt).toBeNull();
    expect(byName['anna-kemaro']!.lastLoginAt).toBe(ago(2 * HOUR));
    expect(stored(ID['wohnzimmer-kemaro']).invalidLogins).toBe(3);

    // Seeded accounts start with their allowance's policy, huber-bivane with one drifted field.
    expect(byName['anna-kemaro']!.policy).toEqual({
      ...jellyfinDefaultPolicy(),
      allLibraries: false,
      libraryIds: [LIB.filme, LIB.kinder, LIB.serien].sort(),
      maxSessions: 2,
      downloads: false,
      conversion: false,
      remoteBitrateBps: 8_000_000,
      sharedDeviceControl: false,
      liveTv: false,
      publicSharing: false,
      channels: false,
      syncPlay: 'None',
    });
    expect(byName['wohnzimmer-kemaro']!.policy).toEqual(expectedMediaPolicy(MUSTER));
    expect(byName['huber-bivane']!.policy.maxSessions).toBe(4);
    expect(mediaPolicyDrift(byName['huber-bivane']!.policy, expectedMediaPolicy(HUBER))).toEqual([
      'maxSessions',
    ]);
    expect(byName['huber-bivane']!.policy.remoteBitrateBps).toBe(15_000_000);
    // Unmanaged users have what Jellyfin gives a new user: all libraries, Live TV, sharing.
    for (const name of ['ben-kemaro', 'gast', 'altkunde'] as const) {
      expect(byName[name]!.policy).toEqual(jellyfinDefaultPolicy());
    }
    expect(byName['weblion-admin']!.policy).toEqual({ ...jellyfinDefaultPolicy(), administrator: true });

    const libraries = await media().listMediaLibraries();
    expect(libraries.map((l) => l.name)).toEqual(['Dokumentationen', 'Filme', 'Kinder', 'Musik', 'Serien']);
    expect(libraries).toEqual(expect.arrayContaining(DEMO_MEDIA_LIBRARIES));
    expect(libraries.find((l) => l.id === LIB.serien)).toEqual({
      id: LIB.serien,
      name: 'Serien',
      type: 'tvshows',
    });

    expect(await media().mediaServerInfo()).toEqual({
      serverName: 'Demo Jellyfin',
      version: '10.11.11',
      serverId: DEMO_MEDIA_SERVER.id,
      quickConnect: true,
      startupWizardCompleted: true,
    });
    expect(media().mediaLoginUrl()).toBe(DEMO_MEDIA_URL);
    expect(DEMO_MEDIA_URL).toBe('https://media.demo.weblion.one');
    expect(await media().mediaActivity()).toEqual({ activeSessions: 0, playing: 0 });
    const overview = await media().overview();
    expect(overview.facts).toContainEqual({ label: 'Streaming users', value: '7' });

    // Jellyfin reads ids with dashes and in upper case too.
    expect(await media().getMediaUser(dashed(ID['anna-kemaro']))).toEqual(byName['anna-kemaro']);
  });

  it('creates, reads, changes and deletes users; the state belongs to the connection', async () => {
    const created = await create('lea-kemaro');
    expect(created.externalId).toMatch(/^[0-9a-f]{32}$/);
    expect(created).toEqual({
      externalId: created.externalId,
      username: 'lea-kemaro',
      enabled: true,
      administrator: false,
      hasPassword: true,
      lockedOut: false,
      blockedFolders: false,
      lastLoginAt: null,
      lastActivityAt: null,
      policy: expectedMediaPolicy(MUSTER),
    });
    // Kept only to mimic Jellyfin.
    expect(stored(created.externalId).password).toBe(PASSWORD);
    // A new adapter for the same connection sees it.
    expect(await new DemoAdapter(id, {}).getMediaUser(created.externalId)).toEqual(created);
    expect((await media().listMediaUsers()).map((u) => u.username)).toContain('lea-kemaro');

    // Policy: only the managed fields change; ids as Jellyfin answers them (lower case, sorted, unique).
    const policy: MediaPolicyState = {
      ...expectedMediaPolicy(HUBER),
      libraryIds: [dashed(LIB.kinder), LIB.filme.toUpperCase(), LIB.kinder, 'no-library'],
    };
    const changed = await media().setMediaUserPolicy(ID['wohnzimmer-kemaro'], policy);
    expect(changed.policy).toEqual({
      ...expectedMediaPolicy(HUBER),
      libraryIds: [LIB.filme, LIB.kinder].sort(),
    });
    expect(changed).toMatchObject({ enabled: false, lockedOut: true, hasPassword: true });
    expect(await media().getMediaUser(ID['wohnzimmer-kemaro'])).toEqual(changed);
    expect(signOuts(ID['wohnzimmer-kemaro'])).toBe(0);

    expect(await media().setMediaUserEnabled(created.externalId, false)).toMatchObject({ enabled: false });
    expect((await media().getMediaUser(created.externalId)).enabled).toBe(false);
    expect(await media().setMediaUserEnabled(created.externalId, true)).toMatchObject({ enabled: true });

    await media().setMediaUserPassword(ID['ben-kemaro'], 'Neues-Passwort-7');
    expect(stored(ID['ben-kemaro']).password).toBe('Neues-Passwort-7');
    expect((await media().getMediaUser(ID['ben-kemaro'])).hasPassword).toBe(true);
    // A password makes a passwordless user safe again.
    await media().setMediaUserPassword(ID.gast, 'Gast-Passwort-1');
    expect((await media().getMediaUser(ID.gast)).hasPassword).toBe(true);

    await media().deleteMediaUser(created.externalId);
    const gone = await refused(media().getMediaUser(created.externalId), 404, 'provider_error');
    expect(gone).toBeInstanceOf(ProviderError);
    expect((await media().listMediaUsers()).map((u) => u.username)).not.toContain('lea-kemaro');
    await refused(media().deleteMediaUser(created.externalId), 404, 'provider_error');

    // Another demo connection is another instance with its own users.
    const other = new DemoAdapter(randomUUID(), {});
    const users = await other.listMediaUsers();
    expect(users).toHaveLength(7);
    expect(users.find((u) => u.username === 'wohnzimmer-kemaro')!.policy).toEqual(
      expectedMediaPolicy(MUSTER),
    );
    expect(users.find((u) => u.username === 'ben-kemaro')!.hasPassword).toBe(true);
    const own = await other.createMediaUser({
      username: 'lea-kemaro',
      password: PASSWORD,
      policy: jellyfinDefaultPolicy(),
    });
    await refused(media().getMediaUser(own.externalId), 404, 'provider_error');
  });

  it('refuses what Jellyfin and the adapter refuse', async () => {
    for (const name of ['anna ', ' anna', 'anna?', 'an/na', '', 'x'.repeat(256)]) {
      await refused(create(name), 400, 'bad_request', /^Invalid Jellyfin user name/);
    }
    // The name is checked before the password, like the adapter.
    await refused(create('anna?', ''), 400, 'bad_request', /^Invalid Jellyfin user name/);
    // Jellyfin compares names case-insensitively.
    await refused(create('Anna-Kemaro'), 409, 'conflict', 'The Jellyfin user "Anna-Kemaro" already exists');
    await refused(create('GAST'), 409, 'conflict', 'The Jellyfin user "GAST" already exists');
    await refused(create('lea-kemaro', ''), 400, 'bad_request', 'The password must not be empty');
    expect(await media().listMediaUsers()).toHaveLength(7);
    // Jellyfin's own rule is wider than the console's (letters of any script, dots, spaces inside).
    expect((await create('Zoë Müller.2')).username).toBe('Zoë Müller.2');

    const policy = expectedMediaPolicy(MUSTER);
    for (const bad of [
      'xyz',
      '',
      `{${ID['anna-kemaro']}}`,
      ID['anna-kemaro'].slice(1),
      `${ID['anna-kemaro']}0`,
    ]) {
      const calls: Promise<unknown>[] = [
        media().getMediaUser(bad),
        media().setMediaUserPolicy(bad, policy),
        media().setMediaUserEnabled(bad, false),
        media().setMediaUserPassword(bad, PASSWORD),
        media().deleteMediaUser(bad),
        Promise.resolve().then(() => signOuts(bad)),
      ];
      for (const call of calls) await refused(call, 400, 'bad_request', 'Invalid Jellyfin user id');
    }

    const calls: Promise<unknown>[] = [
      media().getMediaUser(UNKNOWN),
      media().setMediaUserPolicy(UNKNOWN, policy),
      media().setMediaUserEnabled(UNKNOWN, true),
      media().setMediaUserPassword(UNKNOWN, PASSWORD),
      media().deleteMediaUser(UNKNOWN),
      Promise.resolve().then(() => signOuts(UNKNOWN)),
    ];
    for (const call of calls) {
      const err = await refused(call, 404, 'provider_error', `Jellyfin: user ${UNKNOWN} not found`);
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).upstreamStatus).toBe(404);
    }
    // The password is checked before the user is looked up, like the adapter.
    await refused(
      media().setMediaUserPassword(UNKNOWN, ''),
      400,
      'bad_request',
      'The password must not be empty',
    );
    await refused(
      media().setMediaUserPassword(ID['anna-kemaro'], ''),
      400,
      'bad_request',
      'The password must not be empty',
    );
  });

  it('never manages administrators, and keeps Jellyfin guards for the last administrator and enabled user', async () => {
    const admin = ID['weblion-admin'];
    await refused(media().setMediaUserEnabled(admin, false), 409, 'conflict', JELLYFIN_ADMIN_REFUSED);
    await refused(media().setMediaUserEnabled(admin, true), 409, 'conflict', JELLYFIN_ADMIN_REFUSED);
    await refused(media().setMediaUserPassword(admin, PASSWORD), 409, 'conflict', JELLYFIN_ADMIN_REFUSED);
    await refused(media().deleteMediaUser(admin), 409, 'conflict', JELLYFIN_ADMIN_REFUSED);
    expect(await media().getMediaUser(admin)).toMatchObject({ enabled: true, administrator: true });
    expect(stored(admin).password).toBeNull();
    expect(signOuts(admin)).toBe(0);

    // A managed account made administrator in the Jellyfin dashboard.
    stored(ID['anna-kemaro']).policy.administrator = true;
    const anna = await media().getMediaUser(ID['anna-kemaro']);
    expect(anna.administrator).toBe(true);
    expect(anna.policy.administrator).toBe(true);
    await refused(media().deleteMediaUser(ID['anna-kemaro']), 409, 'conflict', JELLYFIN_ADMIN_REFUSED);
    // The sync demotes it through the policy while another administrator exists.
    const demoted = await media().setMediaUserPolicy(ID['anna-kemaro'], expectedMediaPolicy(MUSTER));
    expect(demoted).toMatchObject({ administrator: false, policy: { administrator: false } });
    expect(stored(ID['anna-kemaro']).administrator).toBe(false);

    // Jellyfin refuses to demote its last administrator (403 with a message).
    stored(ID['ben-kemaro']).administrator = true;
    state().users.delete(admin);
    const err = await refused(
      media().setMediaUserPolicy(ID['ben-kemaro'], expectedMediaPolicy(MUSTER)),
      502,
      'provider_error',
      'Jellyfin: set the access of ben-kemaro failed: There must be at least one user in the system with administrative access. (HTTP 403)',
    );
    expect((err as ProviderError).upstreamStatus).toBe(403);
    expect((await media().getMediaUser(ID['ben-kemaro'])).policy).toEqual({
      ...jellyfinDefaultPolicy(),
      administrator: true,
    });
    // Keeping it administrator is fine.
    await media().setMediaUserPolicy(ID['ben-kemaro'], { ...jellyfinDefaultPolicy(), administrator: true });
    // A disabled administrator cannot even be demoted: the policy keeps IsDisabled.
    stored(ID['wohnzimmer-kemaro']).policy.administrator = true;
    const disabledAdmin = await refused(
      media().setMediaUserPolicy(ID['wohnzimmer-kemaro'], expectedMediaPolicy(MUSTER)),
      502,
      'provider_error',
      'Jellyfin: set the access of wohnzimmer-kemaro failed: Administrators cannot be disabled. (HTTP 403)',
    );
    expect((disabledAdmin as ProviderError).upstreamStatus).toBe(403);
    expect((await media().getMediaUser(ID['wohnzimmer-kemaro'])).administrator).toBe(true);

    // ... and to disable the last enabled user.
    for (const user of state().users.values()) user.enabled = user.externalId === ID['huber-bivane'];
    await refused(
      media().setMediaUserEnabled(ID['huber-bivane'], false),
      502,
      'provider_error',
      'Jellyfin: disable huber-bivane failed: There must be at least one enabled user in the system. (HTTP 403)',
    );
    expect(await media().getMediaUser(ID['huber-bivane'])).toMatchObject({ enabled: true });
    expect(signOuts(ID['huber-bivane'])).toBe(0);
  });

  it('lifts a lockout on enabling and signs devices out on disable, password and delete', async () => {
    const wohnzimmer = ID['wohnzimmer-kemaro'];
    const enabled = await media().setMediaUserEnabled(wohnzimmer, true);
    expect(enabled).toMatchObject({ enabled: true, lockedOut: false });
    expect(stored(wohnzimmer).invalidLogins).toBe(0);
    expect(await media().getMediaUser(wohnzimmer)).toEqual(enabled);
    // Enabling and policy writes sign nobody out.
    await media().setMediaUserPolicy(wohnzimmer, expectedMediaPolicy(MUSTER));
    expect(signOuts(wohnzimmer)).toBe(0);
    // Disabling does not lock it again.
    expect(await media().setMediaUserEnabled(wohnzimmer, false)).toMatchObject({
      enabled: false,
      lockedOut: false,
    });
    expect(signOuts(wohnzimmer)).toBe(1);

    const anna = ID['anna-kemaro'];
    await media().setMediaUserEnabled(anna, false);
    expect(signOuts(anna)).toBe(1);
    // Jellyfin only revokes the tokens of a user that was enabled.
    await media().setMediaUserEnabled(anna, false);
    expect(signOuts(anna)).toBe(1);
    await media().setMediaUserPassword(anna, PASSWORD);
    expect(signOuts(anna)).toBe(2);
    await media().deleteMediaUser(anna);
    // Still readable after the user is gone.
    expect(signOuts(anna)).toBe(3);
    expect(signOuts(dashed(anna))).toBe(3);
    // Other users are untouched.
    expect(signOuts(ID['ben-kemaro'])).toBe(0);
  });

  it('never hands out passwords or anything but counts of the activity', async () => {
    const created = await create('lea-kemaro');
    await media().setMediaUserPassword(ID['ben-kemaro'], 'Noch-ein-Passwort-7');
    const answers = [
      created,
      await media().listMediaUsers(),
      await media().getMediaUser(created.externalId),
      await media().getMediaUser(ID['ben-kemaro']),
      await media().setMediaUserEnabled(created.externalId, false),
      await media().setMediaUserPolicy(created.externalId, expectedMediaPolicy(HUBER)),
      await media().overview(),
    ];
    for (const answer of answers) {
      const text = JSON.stringify(answer);
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain('Noch-ein-Passwort-7');
      expect(keys(answer).filter((k) => /^(password|invalidLogins|signOuts)$/i.test(k))).toEqual([]);
    }

    // Reads are copies: changing an answer changes nothing at the instance.
    const read = await media().getMediaUser(ID['anna-kemaro']);
    read.enabled = false;
    read.policy.libraryIds.push(LIB.musik);
    read.policy.maxSessions = 9;
    (await media().listMediaLibraries())[0]!.name = 'Umbenannt';
    expect(await media().getMediaUser(ID['anna-kemaro'])).toMatchObject({
      enabled: true,
      policy: expectedMediaPolicy(MUSTER),
    });
    expect((await media().listMediaLibraries())[0]!.name).toBe('Dokumentationen');

    // Activity: enabled users seen within 10 minutes; the first of them plays.
    stored(ID['anna-kemaro']).lastActivityAt = ago(5 * MINUTE);
    stored(ID['ben-kemaro']).lastActivityAt = ago(10 * MINUTE);
    stored(ID['huber-bivane']).lastActivityAt = ago(11 * MINUTE);
    stored(ID['wohnzimmer-kemaro']).lastActivityAt = ago(0);
    const activity = await media().mediaActivity();
    expect(activity).toEqual({ activeSessions: 2, playing: 1 });
    expect(Object.keys(activity).sort()).toEqual(['activeSessions', 'playing']);
    expect(Object.values(activity).every((v) => typeof v === 'number')).toBe(true);

    // Quick Connect follows the instance.
    state().quickConnect = false;
    expect((await media().mediaServerInfo()).quickConnect).toBe(false);
  });

  it('DemoAdapter.reset() restores the dataset', async () => {
    const created = await create('lea-kemaro');
    await media().setMediaUserEnabled(ID['wohnzimmer-kemaro'], true);
    await media().setMediaUserPolicy(ID['huber-bivane'], expectedMediaPolicy(HUBER));
    state().libraries.pop();
    state().quickConnect = false;

    DemoAdapter.reset();
    const users = await media().listMediaUsers();
    expect(users).toHaveLength(7);
    expect(users.map((u) => u.externalId)).not.toContain(created.externalId);
    expect(users.find((u) => u.username === 'wohnzimmer-kemaro')).toMatchObject({
      enabled: false,
      lockedOut: true,
    });
    expect(users.find((u) => u.username === 'huber-bivane')!.policy.maxSessions).toBe(4);
    expect(await media().listMediaLibraries()).toHaveLength(5);
    expect((await media().mediaServerInfo()).quickConnect).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------

describe('Demo streaming seed', () => {
  let t: TestApp;
  let demoId: string;

  beforeAll(async () => {
    t = await createTestApp();
    const demo = await t.db.query.providerConnections.findFirst({
      where: eq(providerConnections.envKey, 'demo'),
    });
    demoId = demo!.id;
  });
  afterAll(async () => {
    await t?.close();
  });

  const allowances = async () =>
    t.db
      .select({ slug: organizations.slug, allowance: mediaAllowances })
      .from(mediaAllowances)
      .innerJoin(organizations, eq(organizations.id, mediaAllowances.orgId))
      .orderBy(asc(mediaAllowances.accountCode));
  const accounts = async () =>
    t.db
      .select({ slug: organizations.slug, account: mediaAccounts })
      .from(mediaAccounts)
      .leftJoin(organizations, eq(organizations.id, mediaAccounts.orgId))
      .orderBy(asc(mediaAccounts.username));
  const modules = async (slug: string) =>
    (await t.db.query.organizations.findFirst({ where: eq(organizations.slug, slug) }))!.modules;
  const orgId = async (slug: string) =>
    (await t.db.query.organizations.findFirst({ where: eq(organizations.slug, slug) }))!.id;
  const library = (libId: string) => {
    const l = DEMO_MEDIA_LIBRARIES.find((x) => x.id === libId)!;
    return { id: l.id, name: l.name, type: l.type };
  };

  it('gives three allowances, three accounts and the module to Muster AG only', async () => {
    expect(
      (await allowances()).map(({ slug, allowance: a }) => ({
        slug,
        code: a.accountCode,
        provider: a.providerConnectionId === demoId,
        maxAccounts: a.maxAccounts,
        libraries: a.libraries,
        maxStreams: a.maxStreams,
        downloads: a.downloads,
        bitrate: a.remoteBitrateMbit,
      })),
    ).toEqual([
      {
        slug: 'alpen-hosting',
        code: 'alpen',
        provider: true,
        maxAccounts: 20,
        libraries: [LIB.filme, LIB.serien, LIB.kinder, LIB.musik].map(library),
        maxStreams: 3,
        downloads: true,
        bitrate: 20,
      },
      {
        slug: 'baeckerei-huber',
        code: 'bivane',
        provider: true,
        maxAccounts: 3,
        libraries: [LIB.filme, LIB.kinder].map(library),
        maxStreams: 2,
        downloads: false,
        bitrate: 15,
      },
      {
        slug: 'muster-ag',
        code: 'kemaro',
        provider: true,
        maxAccounts: 5,
        libraries: [LIB.filme, LIB.serien, LIB.kinder].map(library),
        maxStreams: 2,
        downloads: false,
        bitrate: 8,
      },
    ]);

    const adapter = new DemoAdapter(demoId, {});
    const rows = await accounts();
    expect(rows.map((r) => [r.account.username, r.slug, r.account.externalId, r.account.issues])).toEqual([
      ['anna-kemaro', 'muster-ag', ID['anna-kemaro'], []],
      ['huber-bivane', 'baeckerei-huber', ID['huber-bivane'], []],
      ['wohnzimmer-kemaro', 'muster-ag', ID['wohnzimmer-kemaro'], ['locked_out']],
    ]);
    for (const { account } of rows) {
      const remote = await adapter.getMediaUser(account.externalId);
      expect(account).toMatchObject({
        providerConnectionId: demoId,
        enabled: remote.enabled,
        hasPassword: remote.hasPassword,
        missingSince: null,
      });
      expect(account.lastActivityAt!.toISOString()).toBe(remote.lastActivityAt);
      expect(account.lastSyncedAt).toBeInstanceOf(Date);
    }
    expect(rows.find((r) => r.account.username === 'wohnzimmer-kemaro')!.account.enabled).toBe(false);
    // The seed writes nothing to the instance: huber-bivane keeps its drift for the sync.
    expect((await adapter.getMediaUser(ID['huber-bivane'])).policy.maxSessions).toBe(4);

    expect(await modules('muster-ag')).toContain('media');
    for (const slug of ['alpen-hosting', 'baeckerei-huber', 'beispiel-gmbh']) {
      expect(await modules(slug)).not.toContain('media');
    }
    // Codes the frozen tests use stay free.
    expect((await allowances()).map((r) => r.allowance.accountCode)).not.toContain('apitest');
    expect(
      await t.db.query.mediaAllowances.findFirst({
        where: eq(mediaAllowances.orgId, await orgId('beispiel-gmbh')),
      }),
    ).toBeUndefined();
  });

  it('changes nothing on a second run', async () => {
    const before = {
      allowances: await allowances(),
      accounts: await accounts(),
      muster: await modules('muster-ag'),
    };
    const log: string[] = [];
    await seedMediaDemo(t.db, log);
    expect(log).toEqual([]);
    expect({
      allowances: await allowances(),
      accounts: await accounts(),
      muster: await modules('muster-ag'),
    }).toEqual(before);
  });

  it('leaves what staff changed alone and only seeds organizations without an allowance', async () => {
    const muster = await orgId('muster-ag');
    // Staff deleted wohnzimmer-kemaro in the console and lowered the allowance.
    await t.db
      .delete(mediaAccounts)
      .where(
        and(
          eq(mediaAccounts.providerConnectionId, demoId),
          eq(mediaAccounts.externalId, ID['wohnzimmer-kemaro']),
        ),
      );
    await t.db.update(mediaAllowances).set({ maxAccounts: 4 }).where(eq(mediaAllowances.orgId, muster));
    const log: string[] = [];
    await seedMediaDemo(t.db, log);
    expect(log).toEqual([]);
    expect((await accounts()).map((r) => r.account.username)).toEqual(['anna-kemaro', 'huber-bivane']);
    expect(
      (await t.db.query.mediaAllowances.findFirst({ where: eq(mediaAllowances.orgId, muster) }))!.maxAccounts,
    ).toBe(4);
  });

  it('seeds an organization again once its allowance is gone, with the users the instance still has', async () => {
    const muster = await orgId('muster-ag');
    const alpen = await orgId('alpen-hosting');
    await t.db.delete(mediaAccounts).where(eq(mediaAccounts.orgId, muster));
    await t.db.delete(mediaAllowances).where(eq(mediaAllowances.orgId, muster));
    await t.db
      .update(organizations)
      .set({ modules: (await modules('muster-ag')).filter((m) => m !== 'media') })
      .where(eq(organizations.id, muster));
    // Staff gave the code "alpen" to Beispiel GmbH after removing Alpen Hosting's allowance.
    await t.db.delete(mediaAllowances).where(eq(mediaAllowances.orgId, alpen));
    await t.db.insert(mediaAllowances).values({
      orgId: await orgId('beispiel-gmbh'),
      providerConnectionId: demoId,
      accountCode: 'alpen',
      maxAccounts: 1,
      maxStreams: 1,
    });
    // wohnzimmer-kemaro was deleted at the instance meanwhile.
    demoMediaState(demoId).users.delete(ID['wohnzimmer-kemaro']);

    const log: string[] = [];
    await seedMediaDemo(t.db, log);
    expect(log).toEqual(['streaming allowance of Muster AG (code kemaro) with anna-kemaro']);
    expect((await accounts()).map((r) => [r.account.username, r.slug])).toEqual([
      ['anna-kemaro', 'muster-ag'],
      ['huber-bivane', 'baeckerei-huber'],
    ]);
    expect(await modules('muster-ag')).toContain('media');
    expect(
      await t.db.query.mediaAllowances.findFirst({ where: eq(mediaAllowances.orgId, alpen) }),
    ).toBeUndefined();

    // A user staff imported elsewhere stays where it is.
    await t.db.delete(mediaAccounts).where(eq(mediaAccounts.orgId, muster));
    await t.db.delete(mediaAllowances).where(eq(mediaAllowances.orgId, muster));
    await t.db.insert(mediaAccounts).values({
      providerConnectionId: demoId,
      externalId: ID['anna-kemaro'],
      username: 'anna-kemaro',
      orgId: null,
    });
    const again: string[] = [];
    await seedMediaDemo(t.db, again);
    expect(again).toEqual(['streaming allowance of Muster AG (code kemaro)']);
    expect((await accounts()).find((r) => r.account.username === 'anna-kemaro')!.slug).toBeNull();
  });
});
