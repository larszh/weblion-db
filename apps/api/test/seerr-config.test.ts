import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { DEFAULT_CUSTOMER_BOUNDARY } from '@weblion/shared';
import { syncEnvProviders } from '../src/bootstrap';
import type { Env } from '../src/config/env';
import {
  auditLogs,
  mediaAccounts,
  mediaAllowances,
  mediaSeerr,
  organizations,
  providerConnections,
  type MediaAllowance,
} from '../src/db/schema';
import { configSummary } from '../src/modules/admin/routes';
import {
  expectedSeerrAccess,
  mediaRequestsColumns,
  mediaRequestsOf,
  requestsVisibleToCustomer,
  seerrAccessDrift,
  seerrState,
} from '../src/modules/media/seerr';
import { DemoAdapter } from '../src/providers/demo/adapter';
import { DEMO_SEERR_URL } from '../src/providers/demo/seerr';
import { SEERR_PERMISSION, SEERR_REQUEST_BITS, SEERR_STAFF_BITS } from '../src/providers/seerr/rules';
import type { JellyfinConfig, RemoteSeerrUser } from '../src/providers/types';
import { ADMIN, Client, createTestApp, json, type TestApp } from './helpers';

/**
 * Part 2 foundation (Seerr requests add-on): the provider form fields, the address rule while
 * requests are on, the env pair, the pure access helpers and the demo stub.
 */

let t: TestApp;
let admin: Client;
let demoId: string;

const JELLYFIN_KEY = 'a3f1c2d4e5b6a7980f1e2d3c4b5a6978';
/** Shaped like a generated Seerr key: base64 of a timestamp and a UUID. */
const SEERR_KEY = 'MTc2MjE4NjQwMDAwMGJmMWQ5ZjZlLTk1ZGEtNGQ4Yy04NjFhLTJlMjFkYzE2NjQ0Yg==';
const SEERR_KEY_2 = 'MTc2MjE4NjQwMDAwMDAwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAwMQ==';

beforeAll(async () => {
  t = await createTestApp();
  admin = new Client(t.app);
  await admin.login(ADMIN.email, ADMIN.password);
  demoId = (await t.db.query.providerConnections.findFirst({
    where: eq(providerConnections.envKey, 'demo'),
  }))!.id;
});

afterAll(async () => {
  await t?.close();
});

/** Seerr fields of two accounts of a connection, as an old Seerr left them. */
const NUMBERS = { pending: 1, approved: 2, available: 3, movieUsed: 1, tvUsed: null };
async function seedSeerrAccounts(connectionId: string): Promise<void> {
  const fields = (seerrUserId: number) => ({
    seerrUserId,
    seerrRequests: NUMBERS,
    seerrSyncedAt: new Date(),
    issues: ['policy' as const, 'seerr_drift' as const],
  });
  await t.db
    .insert(mediaAccounts)
    .values([
      {
        providerConnectionId: connectionId,
        externalId: 'aa000000000000000000000000000001',
        username: 'eins-test',
        ...fields(7),
      },
      {
        providerConnectionId: connectionId,
        externalId: 'aa000000000000000000000000000002',
        username: 'zwei-test',
        ...fields(8),
      },
    ])
    .onConflictDoUpdate({
      target: [mediaAccounts.providerConnectionId, mediaAccounts.externalId],
      set: fields(7),
    });
}

async function seerrFieldsOf(connectionId: string) {
  return t.db
    .select({
      seerrUserId: mediaAccounts.seerrUserId,
      seerrRequests: mediaAccounts.seerrRequests,
      seerrSyncedAt: mediaAccounts.seerrSyncedAt,
      issues: mediaAccounts.issues,
    })
    .from(mediaAccounts)
    .where(eq(mediaAccounts.providerConnectionId, connectionId))
    .orderBy(mediaAccounts.username);
}

/** Every account of the connection forgot its Seerr id, numbers and Seerr issues; Jellyfin's stay. */
async function expectForgotten(connectionId: string) {
  const rows = await seerrFieldsOf(connectionId);
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    expect(row).toEqual({ seerrUserId: null, seerrRequests: null, seerrSyncedAt: null, issues: ['policy'] });
  }
}

async function expectKept(connectionId: string) {
  const rows = await seerrFieldsOf(connectionId);
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    expect(row).toMatchObject({ seerrRequests: NUMBERS, issues: ['policy', 'seerr_drift'] });
    expect(row.seerrUserId).not.toBeNull();
  }
}

async function storedConfig(id: string): Promise<JellyfinConfig> {
  const row = await t.db.query.providerConnections.findFirst({ where: eq(providerConnections.id, id) });
  return t.ctx.providers.decryptConfig<JellyfinConfig>(row!);
}

/** A Jellyfin connection created in the admin UI, without the initial sync (no real host). */
async function createJellyfin(config: Record<string, unknown>) {
  const sync = vi.spyOn(t.ctx.sync, 'syncConnection').mockResolvedValue({ seen: 0, missing: 0 });
  try {
    return await admin.post('/admin/providers', {
      type: 'jellyfin',
      name: 'Jellyfin Seerr',
      location: { country: 'CH', label: 'Test' },
      config: { baseUrl: 'https://media.example.test', apiKey: JELLYFIN_KEY, ...config },
    });
  } finally {
    sync.mockRestore();
  }
}

describe('provider form', () => {
  it('takes Seerr address and key together and never shows the key', async () => {
    expect((await createJellyfin({ seerrUrl: 'https://requests.example.test' })).statusCode).toBe(400);
    expect((await createJellyfin({ seerrApiKey: SEERR_KEY })).statusCode).toBe(400);
    for (const seerrUrl of [
      'not a url',
      'ftp://requests.example.test',
      'https://admin:pw@requests.example.test',
      'https://requests.example.test/?x=1',
      'https://requests.example.test/#top',
    ]) {
      expect((await createJellyfin({ seerrUrl, seerrApiKey: SEERR_KEY })).statusCode, seerrUrl).toBe(400);
    }
    for (const seerrApiKey of ['short', 'with space in the middle of it', 'x'.repeat(257)]) {
      const res = await createJellyfin({ seerrUrl: 'https://requests.example.test', seerrApiKey });
      expect(res.statusCode, seerrApiKey).toBe(400);
    }

    const res = await createJellyfin({
      seerrUrl: 'https://requests.example.test/',
      seerrApiKey: ` ${SEERR_KEY} `,
    });
    expect(res.statusCode, res.body).toBe(200);
    const created = json<{ id: string; summary: Record<string, string> }>(res);
    expect(created.summary).toMatchObject({
      seerrUrl: 'https://requests.example.test',
      seerrApiKey: '••••••',
    });
    expect(await storedConfig(created.id)).toMatchObject({
      seerrUrl: 'https://requests.example.test',
      seerrApiKey: SEERR_KEY,
    });
    const list = (await admin.get('/admin/providers')).body;
    for (const part of [SEERR_KEY, SEERR_KEY.slice(0, 8), SEERR_KEY.slice(-8)])
      expect(list).not.toContain(part);
    const [entry] = await t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.resourceId, created.id), eq(auditLogs.action, 'provider.create')));
    expect(JSON.stringify(entry)).not.toContain(SEERR_KEY.slice(0, 16));
    expect((await admin.del(`/admin/providers/${created.id}`)).statusCode).toBe(200);
  });

  it('summarizes Seerr only when it is set', () => {
    expect(configSummary('jellyfin', { baseUrl: 'https://m.example.test', apiKey: JELLYFIN_KEY })).toEqual({
      baseUrl: 'https://m.example.test',
      apiKey: '••••••',
    });
    expect(
      configSummary('jellyfin', {
        baseUrl: 'https://m.example.test',
        apiKey: JELLYFIN_KEY,
        seerrUrl: 'https://r.example.test',
        seerrApiKey: SEERR_KEY,
      }),
    ).toEqual({
      baseUrl: 'https://m.example.test',
      apiKey: '••••••',
      seerrUrl: 'https://r.example.test',
      seerrApiKey: '••••••',
    });
  });

  it('refuses to change or remove the Seerr address while requests are on', async () => {
    const res = await createJellyfin({});
    expect(res.statusCode, res.body).toBe(200);
    const id = json<{ id: string }>(res).id;
    const patch = (config: Record<string, unknown>) => admin.patch(`/admin/providers/${id}`, { config });
    try {
      // Half a pair on edit is refused like on create; an empty field keeps the stored value.
      expect((await patch({ seerrUrl: 'https://requests.example.test' })).statusCode).toBe(400);
      expect(
        (await patch({ seerrUrl: 'https://requests.example.test', seerrApiKey: SEERR_KEY })).statusCode,
      ).toBe(200);
      expect((await patch({ seerrUrl: '', seerrApiKey: '' })).statusCode).toBe(200);
      expect(await storedConfig(id)).toMatchObject({ seerrApiKey: SEERR_KEY });
      const [added] = await t.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.resourceId, id), eq(auditLogs.action, 'provider.update')))
        .orderBy(desc(auditLogs.id))
        .limit(2)
        .then((rows) => rows.slice(1));
      expect(added?.details).toMatchObject({ seerr: 'added', credentialsChanged: true });

      await t.db.insert(mediaSeerr).values({
        providerConnectionId: id,
        enabled: true,
        status: 'ok',
        checkedAt: new Date(),
        lastCheck: {
          version: '3.5.1',
          sameServer: true,
          newSignIns: false,
          defaultPermissions: 0,
          mediaServerLogin: true,
          localLogin: true,
          csrfProtection: false,
          unmanagedRequesters: 0,
          orphans: 0,
          problems: [],
        },
      });
      const moved = await patch({ seerrUrl: 'https://other.example.test' });
      expect(moved.statusCode).toBe(409);
      expect(json(moved).error).toMatchObject({
        code: 'conflict',
        message: expect.stringMatching(/Switch requests off/),
      });
      expect((await patch({ seerrUrl: null, seerrApiKey: null })).statusCode).toBe(409);
      // Rotating the key alone is fine: the next check uses it.
      expect((await patch({ seerrApiKey: SEERR_KEY_2 })).statusCode).toBe(200);
      expect(await storedConfig(id)).toMatchObject({
        seerrUrl: 'https://requests.example.test',
        seerrApiKey: SEERR_KEY_2,
      });
      expect(
        (await t.db.query.mediaSeerr.findFirst({ where: eq(mediaSeerr.providerConnectionId, id) }))!.status,
      ).toBe('ok');

      // Switched off: the address may change, and the check of the old Seerr is forgotten.
      await t.db.update(mediaSeerr).set({ enabled: false }).where(eq(mediaSeerr.providerConnectionId, id));
      expect((await patch({ seerrUrl: 'https://other.example.test' })).statusCode).toBe(200);
      expect(
        await t.db.query.mediaSeerr.findFirst({ where: eq(mediaSeerr.providerConnectionId, id) }),
      ).toMatchObject({
        enabled: false,
        status: 'unknown',
        lastCheck: null,
        checkedAt: null,
      });
      expect((await patch({ seerrUrl: null, seerrApiKey: null })).statusCode).toBe(200);
      const config = await storedConfig(id);
      expect(config.seerrUrl).toBeUndefined();
      expect(config.seerrApiKey).toBeUndefined();
    } finally {
      expect((await admin.del(`/admin/providers/${id}`)).statusCode).toBe(200);
    }
    // The row goes with the connection.
    expect(
      await t.db.query.mediaSeerr.findFirst({ where: eq(mediaSeerr.providerConnectionId, id) }),
    ).toBeUndefined();
  });

  it('forgets the Seerr ids, numbers and Seerr issues of the accounts when the address changes', async () => {
    const res = await createJellyfin({ seerrUrl: 'https://requests.example.test', seerrApiKey: SEERR_KEY });
    expect(res.statusCode, res.body).toBe(200);
    const id = json<{ id: string }>(res).id;
    const patch = (config: Record<string, unknown>) => admin.patch(`/admin/providers/${id}`, { config });
    const demoBefore = await seerrFieldsOf(demoId);
    try {
      await seedSeerrAccounts(id);
      // The same Seerr with a new key: its ids still name the same users.
      expect((await patch({ seerrApiKey: SEERR_KEY_2 })).statusCode).toBe(200);
      await expectKept(id);
      // Refused while requests are on: nothing changes.
      await t.db.insert(mediaSeerr).values({ providerConnectionId: id, enabled: true, status: 'ok' });
      expect((await patch({ seerrUrl: 'https://other.example.test' })).statusCode).toBe(409);
      await expectKept(id);
      await t.db.update(mediaSeerr).set({ enabled: false }).where(eq(mediaSeerr.providerConnectionId, id));

      // Ids of the old Seerr would name other users in the new one.
      expect((await patch({ seerrUrl: 'https://other.example.test' })).statusCode).toBe(200);
      await expectForgotten(id);
      await seedSeerrAccounts(id);
      expect((await patch({ seerrUrl: null, seerrApiKey: null })).statusCode).toBe(200);
      await expectForgotten(id);
      await seedSeerrAccounts(id);
      expect(
        (await patch({ seerrUrl: 'https://requests.example.test', seerrApiKey: SEERR_KEY })).statusCode,
      ).toBe(200);
      await expectForgotten(id);
      // Accounts of other instances keep theirs.
      expect(await seerrFieldsOf(demoId)).toEqual(demoBefore);
    } finally {
      expect((await admin.del(`/admin/providers/${id}`)).statusCode).toBe(200);
    }
  });

  it('switches the add-on of every allowance on the instance off when its Seerr is removed', async () => {
    const res = await createJellyfin({ seerrUrl: 'https://requests.example.test', seerrApiKey: SEERR_KEY });
    expect(res.statusCode, res.body).toBe(200);
    const id = json<{ id: string }>(res).id;
    const patch = (config: Record<string, unknown>) => admin.patch(`/admin/providers/${id}`, { config });
    const [reseller, customer] = await addOrgsWithRequests(id, 'entfernt');
    const demoBefore = await requestsOn(demoId);
    try {
      // Another Seerr: the add-ons stay (they still mean something there).
      expect((await patch({ seerrUrl: 'https://other.example.test' })).statusCode).toBe(200);
      expect(await requestsOn(id)).toEqual([reseller, customer].sort());
      // A switch-off that could not take an account's rights: named in the audit entry.
      await seedSeerrAccounts(id);
      expect((await patch({ seerrUrl: null, seerrApiKey: null })).statusCode).toBe(200);
      expect(await requestsOn(id)).toEqual([]);
      const allowance = await t.db.query.mediaAllowances.findFirst({
        where: eq(mediaAllowances.orgId, customer),
      });
      expect(allowance).toMatchObject({
        requestsMovies: false,
        requestsTv: false,
        movieQuotaLimit: null,
        movieQuotaDays: null,
        maxAccounts: 1,
      });
      const [entry] = await t.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.resourceId, id), eq(auditLogs.action, 'provider.update')))
        .orderBy(desc(auditLogs.id))
        .limit(1);
      expect(entry!.details).toMatchObject({
        seerr: 'removed',
        requestsOff: [reseller, customer].sort(),
        seerrRevocationsLeft: 2,
      });
      // Other instances keep theirs.
      expect(await requestsOn(demoId)).toEqual(demoBefore);
    } finally {
      await t.db.delete(organizations).where(inArray(organizations.id, [customer, reseller]));
      expect((await admin.del(`/admin/providers/${id}`)).statusCode).toBe(200);
    }
  });
});

/** Organizations with the add-on on an instance. */
async function requestsOn(connectionId: string): Promise<string[]> {
  const rows = await t.db
    .select({ orgId: mediaAllowances.orgId })
    .from(mediaAllowances)
    .where(
      and(eq(mediaAllowances.providerConnectionId, connectionId), eq(mediaAllowances.requestsMovies, true)),
    )
    .orderBy(mediaAllowances.orgId);
  return rows.map((r) => r.orgId);
}

/** A reseller and its customer, both with the add-on on the instance (as stored). */
async function addOrgsWithRequests(connectionId: string, code: string): Promise<[string, string]> {
  const [reseller] = await t.db
    .insert(organizations)
    .values({
      name: `Reseller ${code}`,
      slug: `reseller-${code}`,
      kind: 'reseller',
      boundary: DEFAULT_CUSTOMER_BOUNDARY,
      modules: ['media'],
    })
    .returning();
  const [customer] = await t.db
    .insert(organizations)
    .values({
      name: `Kunde ${code}`,
      slug: `kunde-${code}`,
      kind: 'customer',
      boundary: DEFAULT_CUSTOMER_BOUNDARY,
      modules: ['media'],
      parentOrgId: reseller!.id,
    })
    .returning();
  const allowance = (orgId: string, accountCode: string, maxAccounts: number) => ({
    orgId,
    providerConnectionId: connectionId,
    accountCode,
    maxAccounts,
    maxStreams: 2,
    ...mediaRequestsColumns({
      movies: true,
      tv: false,
      movieQuota: { limit: 3, days: 30 },
      tvQuota: null,
    }),
  });
  await t.db
    .insert(mediaAllowances)
    .values([allowance(reseller!.id, `r${code}`, 5), allowance(customer!.id, `k${code}`, 1)]);
  return [reseller!.id, customer!.id];
}

describe('environment', () => {
  it('adds the Seerr pair to the env connection and warns about half pairs and moves', async () => {
    const warnings: string[] = [];
    const log = {
      warn: (...args: unknown[]) => warnings.push(args.map((a) => JSON.stringify(a)).join(' ')),
      info: () => undefined,
      error: () => undefined,
    } as unknown as FastifyBaseLogger;
    const base = {
      ...t.ctx.env,
      JELLYFIN_URL: 'https://media.example.test/',
      JELLYFIN_API_KEY: JELLYFIN_KEY.toUpperCase(),
    } as Env;
    const envConnection = () =>
      t.db.query.providerConnections.findFirst({ where: eq(providerConnections.envKey, 'jellyfin') });

    try {
      await syncEnvProviders(
        t.db,
        t.ctx.box,
        { ...base, JELLYFIN_SEERR_URL: 'https://requests.example.test' },
        log,
      );
      const half = await storedConfig((await envConnection())!.id);
      expect(half.seerrUrl).toBeUndefined();
      expect(warnings.join('\n')).toMatch(/JELLYFIN_SEERR_URL and JELLYFIN_SEERR_API_KEY/);

      await syncEnvProviders(
        t.db,
        t.ctx.box,
        {
          ...base,
          JELLYFIN_SEERR_URL: 'https://requests.example.test/',
          JELLYFIN_SEERR_API_KEY: ` ${SEERR_KEY} `,
        },
        log,
      );
      const id = (await envConnection())!.id;
      expect(await storedConfig(id)).toEqual({
        baseUrl: 'https://media.example.test',
        apiKey: JELLYFIN_KEY,
        seerrUrl: 'https://requests.example.test',
        seerrApiKey: SEERR_KEY,
      });

      // The environment cannot be refused: a move while requests are on is logged.
      await t.db.insert(mediaSeerr).values({ providerConnectionId: id, enabled: true, status: 'ok' });
      warnings.length = 0;
      await syncEnvProviders(
        t.db,
        t.ctx.box,
        { ...base, JELLYFIN_SEERR_URL: 'https://other.example.test', JELLYFIN_SEERR_API_KEY: SEERR_KEY },
        log,
      );
      expect(warnings.join('\n')).toMatch(/Seerr address of this Jellyfin connection changed/);
      expect(warnings.join('\n')).not.toContain(SEERR_KEY.slice(0, 16));
      // The check of the old Seerr is forgotten and requests are off: staff switch them on again
      // through the check of the new Seerr (same server, safe settings, the shared confirmation).
      const row = () => t.db.query.mediaSeerr.findFirst({ where: eq(mediaSeerr.providerConnectionId, id) });
      expect(await row()).toMatchObject({ enabled: false, status: 'unknown', lastCheck: null });

      // Removed while on: off as well, so a Seerr added later is never on without a check.
      await t.db
        .update(mediaSeerr)
        .set({ enabled: true, status: 'ok' })
        .where(eq(mediaSeerr.providerConnectionId, id));
      warnings.length = 0;
      await syncEnvProviders(t.db, t.ctx.box, base, log);
      expect(warnings.join('\n')).toMatch(/Seerr of this Jellyfin connection was removed/);
      expect(await row()).toMatchObject({ enabled: false, status: 'unknown' });

      // Added to a connection whose switch was left on (before this rule): off until checked.
      await t.db.update(mediaSeerr).set({ enabled: true }).where(eq(mediaSeerr.providerConnectionId, id));
      await syncEnvProviders(
        t.db,
        t.ctx.box,
        { ...base, JELLYFIN_SEERR_URL: 'https://requests.example.test', JELLYFIN_SEERR_API_KEY: SEERR_KEY },
        log,
      );
      expect(await row()).toMatchObject({ enabled: false });
      // The same address again (the key may rotate): the switch stays as staff set it.
      await t.db.update(mediaSeerr).set({ enabled: true }).where(eq(mediaSeerr.providerConnectionId, id));
      await syncEnvProviders(
        t.db,
        t.ctx.box,
        { ...base, JELLYFIN_SEERR_URL: 'https://requests.example.test', JELLYFIN_SEERR_API_KEY: SEERR_KEY_2 },
        log,
      );
      expect(await row()).toMatchObject({ enabled: true });
      expect((await storedConfig(id)).seerrApiKey).toBe(SEERR_KEY_2);
    } finally {
      await t.db.delete(providerConnections).where(eq(providerConnections.envKey, 'jellyfin'));
    }
  });
});

describe('environment, Seerr ids', () => {
  it('forgets the Seerr ids of the accounts when the address in the .env changes', async () => {
    const warnings: string[] = [];
    const log = {
      warn: (...args: unknown[]) => warnings.push(args.map((a) => JSON.stringify(a)).join(' ')),
      info: () => undefined,
      error: () => undefined,
    } as unknown as FastifyBaseLogger;
    const base = {
      ...t.ctx.env,
      JELLYFIN_URL: 'https://media.example.test/',
      JELLYFIN_API_KEY: JELLYFIN_KEY,
      JELLYFIN_SEERR_URL: 'https://requests.example.test',
      JELLYFIN_SEERR_API_KEY: SEERR_KEY,
    } as Env;
    const sync = (env: Partial<Env> = {}) => syncEnvProviders(t.db, t.ctx.box, { ...base, ...env }, log);
    try {
      await sync();
      const id = (await t.db.query.providerConnections.findFirst({
        where: eq(providerConnections.envKey, 'jellyfin'),
      }))!.id;
      await seedSeerrAccounts(id);
      // A new key alone keeps them, as does a boot without changes.
      await sync({ JELLYFIN_SEERR_API_KEY: SEERR_KEY_2 });
      await sync({ JELLYFIN_SEERR_API_KEY: SEERR_KEY_2 });
      await expectKept(id);

      await sync({ JELLYFIN_SEERR_URL: 'https://other.example.test' });
      await expectForgotten(id);
      // Also without a media_seerr row, and when the address goes or comes.
      await seedSeerrAccounts(id);
      await sync({ JELLYFIN_SEERR_URL: undefined, JELLYFIN_SEERR_API_KEY: undefined });
      await expectForgotten(id);
      await seedSeerrAccounts(id);
      await sync();
      await expectForgotten(id);

      // A removed Seerr also takes the add-on of the allowances there, and says so in the log.
      const [reseller, customer] = await addOrgsWithRequests(id, 'env');
      await sync({ JELLYFIN_SEERR_URL: 'https://other.example.test' });
      expect(await requestsOn(id)).toEqual([reseller, customer].sort());
      warnings.length = 0;
      await sync({ JELLYFIN_SEERR_URL: undefined, JELLYFIN_SEERR_API_KEY: undefined });
      expect(await requestsOn(id)).toEqual([]);
      expect(warnings.join('\n')).toMatch(/requests add-on of 2 organizations is switched off/);
      await t.db.delete(organizations).where(inArray(organizations.id, [customer, reseller]));
    } finally {
      await t.db.delete(providerConnections).where(eq(providerConnections.envKey, 'jellyfin'));
    }
  });
});

describe('access helpers', () => {
  const movies5 = { limit: 5, days: 30 };
  const seasons3 = { limit: 3, days: 30 };
  const user = (patch: Partial<RemoteSeerrUser> = {}): RemoteSeerrUser => ({
    id: 2,
    jellyfinUserId: '3bc712a422452aa61a2816cf217e3788',
    permissions: SEERR_PERMISSION.REQUEST_MOVIE | SEERR_PERMISSION.REQUEST_TV,
    movieQuotaLimit: 5,
    movieQuotaDays: 30,
    tvQuotaLimit: 3,
    tvQuotaDays: 30,
    ...patch,
  });

  it('keeps the bits apart', () => {
    expect(SEERR_REQUEST_BITS).toBe(
      32 +
        128 +
        256 +
        512 +
        1024 +
        2048 +
        4096 +
        32768 +
        65536 +
        131072 +
        262144 +
        524288 +
        8388608 +
        16777216 +
        33554432,
    );
    expect(SEERR_STAFF_BITS).toBe(2 + 4 + 8 + 16);
    expect(SEERR_REQUEST_BITS & SEERR_STAFF_BITS).toBe(0);
  });

  it('maps the allowance columns both ways', () => {
    const requests = { movies: true, tv: false, movieQuota: movies5, tvQuota: seasons3 };
    const columns = mediaRequestsColumns(requests);
    expect(columns).toEqual({
      requestsMovies: true,
      requestsTv: false,
      movieQuotaLimit: 5,
      movieQuotaDays: 30,
      tvQuotaLimit: null,
      tvQuotaDays: null,
    });
    expect(mediaRequestsOf(columns)).toEqual({ movies: true, tv: false, movieQuota: movies5, tvQuota: null });
    expect(mediaRequestsColumns(null)).toEqual({
      requestsMovies: false,
      requestsTv: false,
      movieQuotaLimit: null,
      movieQuotaDays: null,
      tvQuotaLimit: null,
      tvQuotaDays: null,
    });
    expect(mediaRequestsOf(mediaRequestsColumns(null))).toBeNull();
    expect(
      mediaRequestsOf(mediaRequestsColumns({ movies: true, tv: true, movieQuota: null, tvQuota: null })),
    ).toEqual({
      movies: true,
      tv: true,
      movieQuota: null,
      tvQuota: null,
    });
  });

  it('grants request rights only to enabled, present accounts with the add-on', () => {
    const requests = { movies: true, tv: true, movieQuota: movies5, tvQuota: null };
    expect(expectedSeerrAccess({ enabled: true, missing: false, requests })).toEqual({
      permissions: SEERR_PERMISSION.REQUEST_MOVIE | SEERR_PERMISSION.REQUEST_TV,
      movieQuotaLimit: 5,
      movieQuotaDays: 30,
      tvQuotaLimit: 0,
      tvQuotaDays: 0,
    });
    expect(
      expectedSeerrAccess({ enabled: true, missing: false, requests: { ...requests, movies: false } })
        .permissions,
    ).toBe(SEERR_PERMISSION.REQUEST_TV);
    for (const input of [
      { enabled: false, missing: false, requests },
      { enabled: true, missing: true, requests },
      { enabled: true, missing: false, requests: null },
    ]) {
      expect(expectedSeerrAccess(input).permissions).toBe(0);
    }
  });

  it('finds drift in rights and in the quotas of granted types only', () => {
    const expected = expectedSeerrAccess({
      enabled: true,
      missing: false,
      requests: { movies: true, tv: true, movieQuota: movies5, tvQuota: seasons3 },
    });
    expect(seerrAccessDrift(user(), expected)).toEqual([]);
    expect(
      seerrAccessDrift(user({ permissions: expected.permissions | SEERR_PERMISSION.AUTO_APPROVE }), expected),
    ).toEqual(['permissions']);
    expect(seerrAccessDrift(user({ movieQuotaDays: 7 }), expected)).toEqual(['movieQuota']);
    expect(seerrAccessDrift(user({ tvQuotaLimit: null }), expected)).toEqual(['tvQuota']);

    // No limit is written as 0: an unset limit would fall back to Seerr's default quota.
    const unlimited = expectedSeerrAccess({
      enabled: true,
      missing: false,
      requests: { movies: true, tv: false, movieQuota: null, tvQuota: null },
    });
    expect(
      seerrAccessDrift(
        user({ permissions: unlimited.permissions, movieQuotaLimit: 0, movieQuotaDays: 7 }),
        unlimited,
      ),
    ).toEqual([]);
    expect(
      seerrAccessDrift(user({ permissions: unlimited.permissions, movieQuotaLimit: null }), unlimited),
    ).toEqual(['movieQuota']);

    // Revoked: only the rights count.
    const none = expectedSeerrAccess({ enabled: false, missing: false, requests: null });
    expect(seerrAccessDrift(user({ permissions: 0 }), none)).toEqual([]);
    expect(seerrAccessDrift(user(), none)).toEqual(['permissions']);
  });
});

describe('demo', () => {
  it('has a configured, safe Seerr with the seeded users, and the first sync revokes the unmanaged one', async () => {
    const adapter = new DemoAdapter(demoId, {});
    expect(adapter.seerrConfigured()).toBe(true);
    expect(adapter.seerrUrl()).toBe(DEMO_SEERR_URL);
    expect(await adapter.seerrCheck()).toMatchObject({ sameServer: true, problems: [] });
    // The owner, two seeded accounts of Muster AG and ben-kemaro, whom the console does not manage.
    expect((await adapter.listSeerrUsers()).map((u) => u.id)).toEqual([1, 2, 3, 4]);

    const res = await admin.post(`/admin/providers/${demoId}/sync`);
    expect(res.statusCode, res.body).toBe(200);
    // ben-kemaro loses REQUEST; the numbers of the two accounts with a Seerr user are read.
    expect(json(res).seerr).toEqual({ imported: 0, repaired: 0, revoked: 1, failed: 0, counted: 2 });
    const ben = (await adapter.listSeerrUsers()).find((u) => u.id === 4);
    expect(ben!.permissions & SEERR_REQUEST_BITS).toBe(0);
  });

  it('is active only with the switch on, and requests are visible only with the add-on there', async () => {
    const connection = (await t.db.query.providerConnections.findFirst({
      where: eq(providerConnections.id, demoId),
    }))!;
    // The seed switched requests on for the demo instance: off first, restored at the end.
    const [seeded] = await t.db.select().from(mediaSeerr).where(eq(mediaSeerr.providerConnectionId, demoId));
    expect(seeded).toMatchObject({ enabled: true });
    await t.db.update(mediaSeerr).set({ enabled: false }).where(eq(mediaSeerr.providerConnectionId, demoId));
    try {
      let state = await seerrState(t.ctx, connection);
      expect(state).toMatchObject({ configured: true, enabled: false, active: false });

      const allowance = {
        providerConnectionId: demoId,
        ...mediaRequestsColumns({ movies: true, tv: false, movieQuota: null, tvQuota: null }),
      } as MediaAllowance;
      expect(requestsVisibleToCustomer(state, allowance)).toBe(false);

      await t.db.update(mediaSeerr).set({ enabled: true }).where(eq(mediaSeerr.providerConnectionId, demoId));
      state = await seerrState(t.ctx, connection);
      expect(state).toMatchObject({ configured: true, enabled: true, active: true });
      expect(requestsVisibleToCustomer(state, allowance)).toBe(true);
      expect(requestsVisibleToCustomer(state, { ...allowance, ...mediaRequestsColumns(null) })).toBe(false);
      expect(
        requestsVisibleToCustomer(state, { ...allowance, providerConnectionId: crypto.randomUUID() }),
      ).toBe(false);
      expect(requestsVisibleToCustomer(state, null)).toBe(false);
    } finally {
      await t.db
        .update(mediaSeerr)
        .set({ enabled: seeded!.enabled })
        .where(eq(mediaSeerr.providerConnectionId, demoId));
    }
  });
});
