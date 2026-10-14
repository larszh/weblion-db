import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, like } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import type {
  ModuleKey,
  OrgRole,
  PhoneRingGroup,
  PhoneSystemDetailDto,
  PhoneSystemDto,
  PhoneTrunk,
  PhoneUser,
  PhoneUserCreatedDto,
  PhoneUserDto,
  PhoneUserListDto,
} from '@weblion/shared';
import {
  auditLogs,
  memberships,
  organizations,
  phoneSystems,
  providerConnections,
  users,
  type ProviderConnection,
} from '../src/db/schema';
import { syncPhoneSystems } from '../src/jobs/sync-phone';
import { hashPassword } from '../src/lib/crypto';
import { ProviderError } from '../src/lib/errors';
import { DemoAdapter } from '../src/providers/demo/adapter';
import { DEMO_PHONE_SYSTEMS, demoPhoneState } from '../src/providers/demo/phone';
import { parseUser } from '../src/providers/threecx/parse';
import type { ProviderAdapter } from '../src/providers/types';
import { ADMIN, Client, createTestApp, DEMO_PASSWORD, json, type TestApp } from './helpers';

const ZH = DEMO_PHONE_SYSTEMS.zurich;
const BE = DEMO_PHONE_SYSTEMS.bern;
const LAB = DEMO_PHONE_SYSTEMS.lab;

let t: TestApp;
let admin: Client;
let anna: Client;
let carla: Client;
let ben: Client;
let dev: Client;
let reto: Client;
let hanna: Client;
let member: Client;
let demo: ProviderConnection;
let musterId: string;
let beispielId: string;
let alpenId: string;
let huberId: string;
let zh: string;
let be: string;
let lab: string;

/** Every answer of a phone route, checked for secrets at the end. */
const answers: string[] = [];

/** Records the answers of the phone routes a client gets. */
function track(client: Client): Client {
  const request = client.request.bind(client);
  client.request = async (method, url, body, headers) => {
    const res = await request(method, url, body, headers);
    if (url.includes('phone')) answers.push(res.body);
    return res;
  };
  return client;
}

async function signIn(email: string, password = DEMO_PASSWORD): Promise<Client> {
  const client = track(new Client(t.app));
  await client.login(email, password);
  return client;
}

/** Signs in a new user, optionally as member of an organization. */
async function newUser(
  email: string,
  options: { platformRole?: 'support'; orgId?: string; role?: OrgRole } = {},
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
  return signIn(email);
}

async function orgBySlug(slug: string) {
  return (await t.db.query.organizations.findFirst({ where: eq(organizations.slug, slug) }))!;
}

async function modulesOf(orgId: string) {
  return (await t.db.query.organizations.findFirst({ where: eq(organizations.id, orgId) }))!.modules;
}

async function setModules(orgId: string, modules: ModuleKey[]) {
  await t.db.update(organizations).set({ modules }).where(eq(organizations.id, orgId));
}

async function row(externalId: string, connectionId = demo.id) {
  return (await t.db.query.phoneSystems.findFirst({
    where: and(eq(phoneSystems.providerConnectionId, connectionId), eq(phoneSystems.externalId, externalId)),
  }))!;
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

/** The simulated PBX behind a phone system of the main demo connection. */
const pbx = (externalId: string) => demoPhoneState(demo.id).systems.get(externalId)!;
const demoUser = (externalId: string, number: string) =>
  [...pbx(externalId).users.values()].find((u) => u.number === number);

async function sync() {
  const res = await admin.post(`/admin/providers/${demo.id}/sync`);
  expect(res.statusCode, res.body).toBe(200);
  return json(res);
}

const usersUrl = (id: string) => `/phone-systems/${id}/users`;

async function phoneUsers(client: Client, id: string) {
  const res = await client.get(usersUrl(id));
  expect(res.statusCode, res.body).toBe(200);
  return json<PhoneUserListDto>(res).users;
}

async function userId(id: string, number: string) {
  return (await phoneUsers(admin, id)).find((u) => u.number === number)!.id;
}

async function assign(id: string, orgId: string | null, enableModule = true) {
  return admin.post(`/admin/phone-systems/${id}/assign`, { orgId, enableModule });
}

beforeAll(async () => {
  t = await createTestApp();
  admin = await signIn(ADMIN.email, ADMIN.password);
  anna = await signIn('anna@muster.example');
  carla = await signIn('carla@muster.example');
  ben = await signIn('ben@muster.example');
  dev = await signIn('dev@beispiel.example');
  reto = await signIn('reseller@alpen.example');
  hanna = await signIn('huber@baeckerei.example');
  demo = (await t.db.query.providerConnections.findFirst({
    where: eq(providerConnections.envKey, 'demo'),
  }))!;
  musterId = (await orgBySlug('muster-ag')).id;
  beispielId = (await orgBySlug('beispiel-gmbh')).id;
  alpenId = (await orgBySlug('alpen-hosting')).id;
  huberId = (await orgBySlug('baeckerei-huber')).id;
  member = await newUser('mia@muster.example', { orgId: musterId, role: 'member' });
  zh = (await row(ZH)).id;
  be = (await row(BE)).id;
  lab = (await row(LAB)).id;
});

afterAll(async () => {
  await t?.close();
});

describe('sync and seed', () => {
  it('stores the phone systems of the demo connection with facts and health', async () => {
    const rows = await t.db.select().from(phoneSystems).where(eq(phoneSystems.providerConnectionId, demo.id));
    expect(rows.map((r) => r.externalId).sort()).toEqual([BE, LAB, ZH].sort());
    const zurich = await row(ZH);
    expect(zurich).toMatchObject({
      name: 'pbx-zuerich.demo.weblion.one',
      providerName: 'pbx-zuerich.demo.weblion.one',
      fqdn: 'pbx-zuerich.demo.weblion.one',
      status: 'ok',
      statusReasons: [],
      missingSince: null,
    });
    expect(zurich.lastSyncedAt).not.toBeNull();
    expect(zurich.info).toMatchObject({
      version: '20.0.10.1479',
      edition: 'enterprise',
      users: 6,
      maxUsers: null,
      numberLength: 3,
      maxSimCalls: 16,
      trunksTotal: 2,
      trunksRegistered: 2,
      webClientUrl: 'https://pbx-zuerich.demo.weblion.one/webclient/',
    });
    expect(await row(BE)).toMatchObject({ status: 'warning', statusReasons: ['trunks_down'] });
    expect(await row(LAB)).toMatchObject({ status: 'warning', statusReasons: ['license_expiring'] });
    // No license key, not even under another spelling.
    expect(JSON.stringify(rows)).not.toMatch(/licen[cs]e_?key/i);
  });

  it('gives Muster AG Zürich and Bern with the module, the lab stays unassigned', async () => {
    expect((await row(ZH)).orgId).toBe(musterId);
    expect((await row(BE)).orgId).toBe(musterId);
    expect((await row(LAB)).orgId).toBeNull();
    expect(await modulesOf(musterId)).toContain('phone');
    expect(json(await anna.get(`/orgs/${musterId}`)).counts.phoneSystems).toBe(2);
    expect(json(await dev.get(`/orgs/${beispielId}`)).counts.phoneSystems).toBe(0);
  });

  it('reports what it saw', async () => {
    expect((await sync()).phoneSystems).toEqual({ seen: 3, missing: 0 });
  });

  it('marks a vanished phone system missing and keeps its organization', async () => {
    const state = demoPhoneState(demo.id);
    const bern = state.systems.get(BE)!;
    state.systems.delete(BE);
    try {
      expect((await sync()).phoneSystems).toEqual({ seen: 2, missing: 1 });
      const missing = await row(BE);
      expect(missing.missingSince).not.toBeNull();
      expect(missing).toMatchObject({ orgId: musterId, status: 'warning' });
      const listed = json<PhoneSystemDto[]>(await anna.get(`/orgs/${musterId}/phone-systems`));
      expect(listed.find((s) => s.id === be)!.missingSince).not.toBeNull();
    } finally {
      state.systems.set(BE, bern);
    }
    await sync();
    expect((await row(BE)).missingSince).toBeNull();
  });

  it('marks an unreachable phone system as error and keeps its facts', async () => {
    const before = await row(ZH);
    pbx(ZH).unreachable = true;
    try {
      await sync();
      const after = await row(ZH);
      expect(after.status).toBe('error');
      expect(after.statusReasons).toContain('unreachable');
      expect(after.info).toEqual(before.info);
      expect(after.lastSyncedAt).toEqual(before.lastSyncedAt);
      // The detail page answers with the stored facts and says why.
      const detail = await anna.get(`/phone-systems/${zh}`);
      expect(detail.statusCode, detail.body).toBe(200);
      const dto = json<PhoneSystemDetailDto>(detail);
      expect(dto.liveError).toMatch(/does not answer/);
      expect(dto.info!.version).toBe(before.info!.version);
      expect(dto.status).toBe('error');
    } finally {
      pbx(ZH).unreachable = false;
    }
    await sync();
    expect(await row(ZH)).toMatchObject({ status: 'ok', statusReasons: [] });
  });

  it('marks every phone system unreachable when the provider cannot be read', async () => {
    const original = DemoAdapter.prototype.listPhoneSystems;
    DemoAdapter.prototype.listPhoneSystems = async () => {
      throw new ProviderError('Demo', 'the phone systems cannot be read');
    };
    const before = await row(BE);
    try {
      const res = await admin.post(`/admin/providers/${demo.id}/sync`);
      expect(res.statusCode).toBe(502);
      for (const externalId of [ZH, BE, LAB]) {
        expect(await row(externalId)).toMatchObject({ status: 'error', statusReasons: ['unreachable'] });
      }
      expect((await row(BE)).info).toEqual(before.info);
      const connection = await t.db.query.providerConnections.findFirst({
        where: eq(providerConnections.id, demo.id),
      });
      expect(connection).toMatchObject({ status: 'error' });
      expect(connection!.lastError).toMatch(/cannot be read/);

      // Also when called directly, the error comes back after the rows were marked.
      await t.db.update(phoneSystems).set({ status: 'ok', statusReasons: [] });
      const broken = {
        listPhoneSystems: DemoAdapter.prototype.listPhoneSystems,
      } as unknown as ProviderAdapter;
      await expect(syncPhoneSystems(t.db, demo, broken)).rejects.toThrow(/cannot be read/);
      expect(await row(LAB)).toMatchObject({ status: 'error', statusReasons: ['unreachable'] });
    } finally {
      DemoAdapter.prototype.listPhoneSystems = original;
    }
    await sync();
    expect(await row(BE)).toMatchObject({ status: 'warning', statusReasons: ['trunks_down'] });
  });

  it('keeps a name given in the panel and follows provider renames otherwise', async () => {
    const renamed = await anna.patch(`/phone-systems/${zh}`, { name: '  Zürich ' });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(json<PhoneSystemDto>(renamed).name).toBe('Zürich');
    expect((await lastAudit('phone.system_rename', zh))!.details).toMatchObject({
      before: 'pbx-zuerich.demo.weblion.one',
      after: 'Zürich',
    });
    pbx(ZH).name = 'pbx-zh2.demo.weblion.one';
    pbx(BE).name = 'pbx-be2.demo.weblion.one';
    try {
      await sync();
      expect(await row(ZH)).toMatchObject({
        name: 'Zürich',
        providerName: 'pbx-zh2.demo.weblion.one',
        fqdn: 'pbx-zh2.demo.weblion.one',
      });
      expect(await row(BE)).toMatchObject({
        name: 'pbx-be2.demo.weblion.one',
        providerName: 'pbx-be2.demo.weblion.one',
      });
    } finally {
      pbx(ZH).name = 'pbx-zuerich.demo.weblion.one';
      pbx(BE).name = 'pbx-bern.demo.weblion.one';
    }
    await sync();
    expect((await row(ZH)).name).toBe('Zürich');
    expect((await row(BE)).name).toBe('pbx-bern.demo.weblion.one');
    // Named like the provider again, it follows the provider again.
    await anna.patch(`/phone-systems/${zh}`, { name: 'pbx-zuerich.demo.weblion.one' });
    expect((await row(ZH)).name).toBe('pbx-zuerich.demo.weblion.one');
    expect((await anna.patch(`/phone-systems/${zh}`, { name: ' ' })).statusCode).toBe(400);
    expect((await carla.patch(`/phone-systems/${zh}`, { name: 'Viewer' })).statusCode).toBe(403);
  });
});

describe('visibility and gating', () => {
  it('lists the organization phone systems with the caller permissions', async () => {
    const list = async (client: Client) => {
      const res = await client.get(`/orgs/${musterId}/phone-systems`);
      expect(res.statusCode, res.body).toBe(200);
      return json<PhoneSystemDto[]>(res);
    };
    const owner = await list(anna);
    expect(owner.map((s) => s.id)).toEqual([be, zh]);
    expect(owner[1]).toMatchObject({
      name: 'pbx-zuerich.demo.weblion.one',
      provider: { id: demo.id, type: 'demo' },
      org: { id: musterId, slug: 'muster-ag' },
      status: 'ok',
      webClientUrl: 'https://pbx-zuerich.demo.weblion.one/webclient/',
      missingSince: null,
    });
    expect([...owner[1]!.capabilities].sort()).toEqual(
      ['nextNumber', 'ringGroupMembers', 'ringGroups', 'trunks', 'users', 'welcomeMail'].sort(),
    );
    expect([...owner[1]!.permissions].sort()).toEqual(['phone:credentials', 'phone:read', 'phone:write']);
    // The vendor's product code is for staff only.
    expect(owner[1]!.info!.productCode).toBeNull();
    const staff = json<PhoneSystemDetailDto>(await admin.get(`/phone-systems/${zh}`));
    expect(staff.info!.productCode).toBe('DEMO-ENT-16');

    for (const client of [carla, member]) {
      const systems = await list(client);
      expect(systems).toHaveLength(2);
      expect(systems.every((s) => s.permissions.join() === 'phone:read')).toBe(true);
    }
    expect(await list(ben)).toEqual([]);
    expect((await ben.get(`/phone-systems/${zh}`)).statusCode).toBe(404);
  });

  it('hides phone systems from other organizations', async () => {
    expect((await dev.get(`/phone-systems/${zh}`)).statusCode).toBe(404);
    expect((await dev.get(usersUrl(zh))).statusCode).toBe(404);
    expect((await dev.post(usersUrl(zh), { firstName: 'X', email: 'x@beispiel.example' })).statusCode).toBe(
      404,
    );
    expect((await dev.get(`/orgs/${musterId}/phone-systems`)).statusCode).toBe(404);
    expect(json(await dev.get(`/orgs/${beispielId}/phone-systems`))).toEqual([]);
    // Unassigned phone systems are for staff only.
    expect((await anna.get(`/phone-systems/${lab}`)).statusCode).toBe(404);
  });

  it('hides everything while the module is off, also from the owner', async () => {
    const modules = await modulesOf(musterId);
    await setModules(
      musterId,
      modules.filter((m) => m !== 'phone'),
    );
    try {
      expect(json(await anna.get(`/orgs/${musterId}/phone-systems`))).toEqual([]);
      for (const url of [
        `/phone-systems/${zh}`,
        usersUrl(zh),
        `${usersUrl(zh)}/next-number`,
        `/phone-systems/${zh}/ring-groups`,
        `/phone-systems/${zh}/trunks`,
      ]) {
        expect((await anna.get(url)).statusCode, url).toBe(404);
      }
      expect(
        (await anna.post(usersUrl(zh), { firstName: 'Off', email: 'off@muster.example' })).statusCode,
      ).toBe(404);
      expect((await anna.patch(`/phone-systems/${zh}`, { name: 'Off' })).statusCode).toBe(404);
    } finally {
      await setModules(musterId, modules);
    }
  });

  it('is read-only while the organization is suspended', async () => {
    const ben101 = await userId(zh, '101');
    await t.db
      .update(organizations)
      .set({ status: 'suspended', suspendedBy: 'platform' })
      .where(eq(organizations.id, musterId));
    try {
      for (const url of [`/phone-systems/${zh}`, usersUrl(zh), `/phone-systems/${zh}/ring-groups`]) {
        expect((await anna.get(url)).statusCode, url).toBe(200);
      }
      expect((await anna.get(`/phone-systems/${zh}/trunks`)).statusCode).toBe(200);
      const writes = [
        await anna.get(`${usersUrl(zh)}/next-number`),
        await anna.post(usersUrl(zh), { firstName: 'Sus', email: 'sus@muster.example' }),
        await anna.patch(`${usersUrl(zh)}/${ben101}`, { lastName: 'Gesperrt' }),
        await anna.del(`${usersUrl(zh)}/${ben101}`, { confirm: '101' }),
        await anna.post(`${usersUrl(zh)}/${ben101}/welcome`),
        await anna.patch(`/phone-systems/${zh}`, { name: 'Gesperrt' }),
        await anna.post(`/phone-systems/${zh}/ring-groups/x/members`, { number: '102' }),
      ];
      expect(writes.map((r) => r.statusCode)).toEqual(writes.map(() => 403));
      expect(demoUser(ZH, '101')!.lastName).toBe('Beispiel');
    } finally {
      await t.db
        .update(organizations)
        .set({ status: 'active', suspendedBy: null })
        .where(eq(organizations.id, musterId));
    }
  });

  it('lets support read but not write', async () => {
    const support = await newUser('support@weblion.example', { platformRole: 'support' });
    expect((await support.get(`/phone-systems/${zh}`)).statusCode).toBe(200);
    expect((await support.get(usersUrl(zh))).statusCode).toBe(200);
    expect((await support.get(`/phone-systems/${lab}`)).statusCode).toBe(200);
    expect((await support.get('/admin/phone-systems')).statusCode).toBe(200);
    const ben101 = await userId(zh, '101');
    const writes = [
      await support.post(usersUrl(zh), { firstName: 'Support', email: 'support@muster.example' }),
      await support.patch(`/phone-systems/${zh}`, { name: 'Support' }),
      await support.post(`${usersUrl(zh)}/${ben101}/welcome`),
      await support.post(`/admin/phone-systems/${lab}/assign`, { orgId: musterId }),
    ];
    expect(writes.map((r) => r.statusCode)).toEqual([403, 403, 403, 403]);
    expect(demoUser(ZH, '101')!.welcomeMails).toBe(0);
  });

  it('limits a policy on phone/<id> to that phone system', async () => {
    const pia = await newUser('pia@muster.example', { orgId: musterId, role: 'restricted' });
    const policy = json(
      await anna.post(`/orgs/${musterId}/policies`, {
        name: 'Nur Zürich',
        statements: [{ effect: 'allow', actions: ['phone:read'], resources: [`phone/${zh}`] }],
      }),
    );
    const members = json<{ membershipId: string; email: string }[]>(
      await anna.get(`/orgs/${musterId}/members`),
    );
    const membership = members.find((m) => m.email === 'pia@muster.example')!;
    const res = await anna.patch(`/orgs/${musterId}/members/${membership.membershipId}`, {
      policyIds: [policy.id],
    });
    expect(res.statusCode, res.body).toBe(200);
    const listed = json<PhoneSystemDto[]>(await pia.get(`/orgs/${musterId}/phone-systems`));
    expect(listed.map((s) => s.id)).toEqual([zh]);
    expect(listed[0]!.permissions).toEqual(['phone:read']);
    expect((await pia.get(`/phone-systems/${zh}`)).statusCode).toBe(200);
    expect((await pia.get(usersUrl(zh))).statusCode).toBe(200);
    expect((await pia.get(`/phone-systems/${be}`)).statusCode).toBe(404);
    expect((await pia.post(usersUrl(zh), { firstName: 'Pia', email: 'pia@muster.example' })).statusCode).toBe(
      403,
    );
  });
});

describe('live details', () => {
  it('refreshes the facts and stores them', async () => {
    pbx(ZH).version = '20.0.11.100';
    try {
      const res = await anna.get(`/phone-systems/${zh}`);
      expect(res.statusCode, res.body).toBe(200);
      const dto = json<PhoneSystemDetailDto>(res);
      expect(dto).toMatchObject({ liveError: null, status: 'ok', info: { version: '20.0.11.100' } });
      expect((await row(ZH)).info!.version).toBe('20.0.11.100');
    } finally {
      pbx(ZH).version = '20.0.10.1479';
    }
    await anna.get(`/phone-systems/${zh}`);
    expect((await row(ZH)).info!.version).toBe('20.0.10.1479');
  });

  it('shows the stored facts when the phone system does not answer', async () => {
    pbx(BE).unreachable = true;
    try {
      const dto = json<PhoneSystemDetailDto>(await anna.get(`/phone-systems/${be}`));
      expect(dto.liveError).toMatch(/does not answer/);
      expect(dto.info!.fqdn).toBe('pbx-bern.demo.weblion.one');
      // Only the sync marks it unreachable.
      expect((await row(BE)).status).toBe('warning');
    } finally {
      pbx(BE).unreachable = false;
    }
  });
});

describe('users', () => {
  let lea: string;

  it('lists users with the protected ones', async () => {
    const res = await anna.get(usersUrl(zh));
    expect(res.statusCode, res.body).toBe(200);
    const list = json<PhoneUserListDto>(res);
    expect(list).toMatchObject({ numberLength: 3, usersCount: 6, maxUsers: null });
    expect(list.users.map((u) => u.number)).toEqual(['100', '101', '102', '103', '104', '105']);
    const byNumber = new Map(list.users.map((u) => [u.number, u]));
    expect(byNumber.get('100')).toMatchObject({
      firstName: 'Anna',
      lastName: 'Muster',
      email: 'anna@muster.example',
      admin: true,
      system: false,
      protected: true,
    });
    expect(byNumber.get('105')).toMatchObject({ admin: false, system: true, protected: true, email: null });
    expect(list.users.filter((u) => u.protected).map((u) => u.number)).toEqual(['100', '105']);
    expect((await carla.get(usersUrl(zh))).statusCode).toBe(200);
  });

  it('proposes the next free extension number', async () => {
    const res = await anna.get(`${usersUrl(zh)}/next-number`);
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res)).toEqual({ number: '106' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect((await carla.get(`${usersUrl(zh)}/next-number`)).statusCode).toBe(403);
  });

  it('creates a user with a number and sends the welcome e-mail', async () => {
    const res = await anna.post(usersUrl(zh), {
      number: '110',
      firstName: ' Lea ',
      lastName: 'Lustig',
      email: 'Lea@Muster.Example',
      mobile: '+41 79 555 66 77',
      outboundCallerId: '',
      language: 'fr',
    });
    expect(res.statusCode, res.body).toBe(201);
    const created = json<PhoneUserCreatedDto>(res);
    expect(created).toMatchObject({
      welcomeSent: true,
      welcomeError: null,
      user: {
        number: '110',
        firstName: 'Lea',
        lastName: 'Lustig',
        email: 'lea@muster.example',
        mobile: '+41795556677',
        outboundCallerId: null,
        language: 'fr',
        protected: false,
      },
    });
    lea = created.user.id;
    expect(demoUser(ZH, '110')!.welcomeMails).toBe(1);
    const entry = await lastAudit('phone.user_create', zh);
    expect(entry).toMatchObject({ status: 'success', orgId: musterId, resourceType: 'phone_system' });
    expect(entry!.details).toMatchObject({
      phoneSystem: 'pbx-zuerich.demo.weblion.one',
      requestedNumber: '110',
      number: '110',
      userId: lea,
      firstName: 'Lea',
      email: 'lea@muster.example',
      mobile: '+41795556677',
      language: 'fr',
      sendWelcome: true,
    });
    expect((await lastAudit('phone.user_welcome', zh))!.details).toMatchObject({
      userId: lea,
      number: '110',
      email: 'lea@muster.example',
    });
    // The user count is refreshed right away.
    expect((await row(ZH)).info!.users).toBe(7);
  });

  it('creates a user without a number: the phone system picks the next free one', async () => {
    const res = await anna.post(usersUrl(zh), {
      number: '',
      firstName: 'Max',
      email: 'max@muster.example',
      sendWelcome: false,
    });
    expect(res.statusCode, res.body).toBe(201);
    const created = json<PhoneUserCreatedDto>(res);
    expect(created).toMatchObject({
      welcomeSent: false,
      welcomeError: null,
      user: { number: '106', lastName: null, language: null },
    });
    expect(demoUser(ZH, '106')!.welcomeMails).toBe(0);
    expect((await lastAudit('phone.user_create', zh))!.details).toMatchObject({
      requestedNumber: null,
      number: '106',
      sendWelcome: false,
    });
  });

  it('refuses invalid users', async () => {
    const create = (body: object) =>
      anna.post(usersUrl(zh), { firstName: 'Neu', email: 'neu@muster.example', ...body });
    const fieldOf = (res: LightMyRequestResponse) =>
      (json(res).error.details as { path: string }[]).map((d) => d.path);

    const tooLong = await create({ number: '1001' });
    expect(tooLong.statusCode).toBe(400);
    expect(fieldOf(tooLong)).toEqual(['number']);
    expect(json(tooLong).error.details[0].message).toMatch(/3 digits/);
    const taken = await create({ number: '101' });
    expect(taken.statusCode).toBe(409);
    expect(json(taken).error.code).toBe('conflict');
    // A ring group's number is taken as well (one namespace).
    expect((await create({ number: '800' })).statusCode).toBe(409);
    const noEmail = await anna.post(usersUrl(zh), { firstName: 'Neu' });
    expect(noEmail.statusCode).toBe(400);
    expect(fieldOf(noEmail)).toContain('email');
    const mobile = await create({ mobile: '12' });
    expect(mobile.statusCode).toBe(400);
    expect(fieldOf(mobile)).toEqual(['mobile']);
    expect(fieldOf(await create({ outboundCallerId: 'abc' }))).toEqual(['outboundCallerId']);
    expect(fieldOf(await create({ language: 'xx' }))).toEqual(['language']);
    expect(fieldOf(await create({ firstName: '' }))).toEqual(['firstName']);
    expect(fieldOf(await create({ number: '1a' }))).toEqual(['number']);
    expect([...pbx(ZH).users.values()].some((u) => u.firstName === 'Neu')).toBe(false);
  });

  it('stops at the user limit of the license', async () => {
    const assigned = await assign(lab, musterId);
    expect(assigned.statusCode, assigned.body).toBe(200);
    const tenth = await anna.post(usersUrl(lab), {
      firstName: 'Test',
      lastName: '10',
      email: 'test10@lab.example',
    });
    expect(tenth.statusCode, tenth.body).toBe(201);
    expect(json<PhoneUserCreatedDto>(tenth).user.number).toBe('1009');
    expect((await row(LAB)).info).toMatchObject({ users: 10, maxUsers: 10 });
    expect((await row(LAB)).statusReasons).toContain('user_limit_reached');
    const eleventh = await anna.post(usersUrl(lab), {
      firstName: 'Test',
      lastName: '11',
      email: 'test11@lab.example',
    });
    expect(eleventh.statusCode).toBe(409);
    expect(json(eleventh).error.code).toBe('phone_user_limit');
    const failed = await lastAudit('phone.user_create', lab);
    expect(failed).toMatchObject({ status: 'failure' });
    expect(failed!.details).toMatchObject({ lastName: '11', error: expect.stringMatching(/no more users/) });
    expect(json<PhoneUserListDto>(await anna.get(usersUrl(lab)))).toMatchObject({
      usersCount: 10,
      maxUsers: 10,
    });
  });

  it('lets API tokens create users with the welcome e-mail, but nothing more', async () => {
    const { token } = json(
      await anna.post(`/orgs/${musterId}/tokens`, { name: 'phone-bot', scope: 'read_write' }),
    );
    const bot = track(new Client(t.app));
    bot.bearer = token;
    const res = await bot.post(usersUrl(zh), { firstName: 'Bot', email: 'bot@muster.example' });
    expect(res.statusCode, res.body).toBe(201);
    const created = json<PhoneUserCreatedDto>(res);
    expect(created.welcomeSent).toBe(true);
    expect(demoUser(ZH, created.user.number)!.welcomeMails).toBe(1);
    const system = json<PhoneSystemDetailDto>(await bot.get(`/phone-systems/${zh}`));
    expect([...system.permissions].sort()).toEqual(['phone:read', 'phone:write']);
    // Sending it again, or to another address, hands out access: interactive sessions only.
    expect((await bot.post(`${usersUrl(zh)}/${created.user.id}/welcome`)).statusCode).toBe(403);
    const takeover = await bot.patch(`${usersUrl(zh)}/${created.user.id}`, {
      email: 'evil@attacker.example',
    });
    expect(takeover.statusCode).toBe(403);
    expect(demoUser(ZH, created.user.number)).toMatchObject({ email: 'bot@muster.example', welcomeMails: 1 });
    const renamed = await bot.patch(`${usersUrl(zh)}/${created.user.id}`, { lastName: 'Roboter' });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(json<PhoneUserDto>(renamed).lastName).toBe('Roboter');

    const read = json(await anna.post(`/orgs/${musterId}/tokens`, { name: 'phone-read', scope: 'read' }));
    const reader = track(new Client(t.app));
    reader.bearer = read.token;
    expect((await reader.get(usersUrl(zh))).statusCode).toBe(200);
    expect((await reader.post(usersUrl(zh), { firstName: 'R', email: 'r@muster.example' })).statusCode).toBe(
      403,
    );
    expect((await member.post(usersUrl(zh), { firstName: 'M', email: 'm@muster.example' })).statusCode).toBe(
      403,
    );
    expect((await carla.post(usersUrl(zh), { firstName: 'C', email: 'c@muster.example' })).statusCode).toBe(
      403,
    );
  });

  it('changes only what was sent and audits the differences', async () => {
    const url = `${usersUrl(zh)}/${lea}`;
    const res = await anna.patch(url, { firstName: 'Lea', lastName: 'Lauter', mobile: '', language: 'de' });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<PhoneUserDto>(res)).toMatchObject({
      firstName: 'Lea',
      lastName: 'Lauter',
      mobile: null,
      language: 'de',
      email: 'lea@muster.example',
    });
    const entry = await lastAudit('phone.user_update', zh);
    expect(entry!.details).toEqual({
      phoneSystem: 'pbx-zuerich.demo.weblion.one',
      userId: lea,
      number: '110',
      before: { lastName: 'Lustig', mobile: '+41795556677', language: 'fr' },
      after: { lastName: 'Lauter', mobile: null, language: 'de' },
    });
    // Keys left out keep their value; unchanged values are no change at all.
    const count = (await auditEntries('phone.user_update', zh)).length;
    expect((await anna.patch(url, { firstName: 'Lea', mobile: ' ' })).statusCode).toBe(200);
    expect((await anna.patch(url, {})).statusCode).toBe(200);
    expect(await auditEntries('phone.user_update', zh)).toHaveLength(count);
    expect(demoUser(ZH, '110')).toMatchObject({ lastName: 'Lauter', language: 'de', mobile: null });
    expect((await anna.patch(url, { firstName: null })).statusCode).toBe(400);
    expect((await anna.patch(url, { mobile: '12' })).statusCode).toBe(400);
    expect((await carla.patch(url, { lastName: 'Viewer' })).statusCode).toBe(403);
    expect((await member.patch(url, { lastName: 'Member' })).statusCode).toBe(403);
  });

  it('changes e-mail addresses with phone:credentials, protected users only by staff', async () => {
    const res = await anna.patch(`${usersUrl(zh)}/${lea}`, { email: 'Lea.Neu@muster.example' });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<PhoneUserDto>(res).email).toBe('lea.neu@muster.example');
    expect((await lastAudit('phone.user_update', zh))!.details).toMatchObject({
      before: { email: 'lea@muster.example' },
      after: { email: 'lea.neu@muster.example' },
    });
    const annaId = await userId(zh, '100');
    const refused = await anna.patch(`${usersUrl(zh)}/${annaId}`, { email: 'anna.neu@muster.example' });
    expect(refused.statusCode).toBe(403);
    expect(json(refused).error.message).toMatch(/Only weblion staff/);
    // Other fields of a protected user are fine.
    expect((await anna.patch(`${usersUrl(zh)}/${annaId}`, { mobile: '+41 79 123 45 00' })).statusCode).toBe(
      200,
    );
    const staff = await admin.patch(`${usersUrl(zh)}/${annaId}`, { email: 'anna.neu@muster.example' });
    expect(staff.statusCode, staff.body).toBe(200);
    expect(demoUser(ZH, '100')!.email).toBe('anna.neu@muster.example');
    await admin.patch(`${usersUrl(zh)}/${annaId}`, { email: 'anna@muster.example' });
  });

  it('sends the welcome e-mail again in an interactive session', async () => {
    const ben101 = await userId(zh, '101');
    const res = await anna.post(`${usersUrl(zh)}/${ben101}/welcome`);
    expect(res.statusCode, res.body).toBe(200);
    expect(demoUser(ZH, '101')!.welcomeMails).toBe(1);
    expect((await lastAudit('phone.user_welcome', zh))!.details).toMatchObject({
      userId: ben101,
      number: '101',
      email: 'ben@muster.example',
    });
    const fax = await anna.post(`${usersUrl(zh)}/${await userId(zh, '105')}/welcome`);
    expect(fax.statusCode).toBe(400);
    expect(json(fax).error.message).toMatch(/no e-mail address/);
    expect((await carla.post(`${usersUrl(zh)}/${ben101}/welcome`)).statusCode).toBe(403);
    expect((await anna.post(`${usersUrl(zh)}/999/welcome`)).statusCode).toBe(404);
    expect(demoUser(ZH, '101')!.welcomeMails).toBe(1);
  });

  it('deletes only with the number as confirmation, protected users only by staff', async () => {
    const url = `${usersUrl(zh)}/${lea}`;
    const wrong = await anna.del(url, { confirm: '111' });
    expect(wrong.statusCode).toBe(400);
    expect(json(wrong).error.details[0].path).toBe('confirm');
    expect((await anna.del(url)).statusCode).toBe(400);
    expect((await carla.del(url, { confirm: '110' })).statusCode).toBe(403);
    expect(demoUser(ZH, '110')).toBeDefined();
    const res = await anna.del(url, { confirm: '110' });
    expect(res.statusCode, res.body).toBe(200);
    expect(demoUser(ZH, '110')).toBeUndefined();
    expect((await lastAudit('phone.user_delete', zh))!.details).toMatchObject({
      userId: lea,
      number: '110',
      name: 'Lea Lauter',
    });
    expect((await anna.del(url, { confirm: '110' })).statusCode).toBe(404);

    // A user that administers the phone system.
    const created = json<PhoneUserCreatedDto>(
      await anna.post(usersUrl(zh), { number: '120', firstName: 'Ivo', email: 'ivo@muster.example' }),
    );
    demoUser(ZH, '120')!.role = 'system_admins';
    const protectedUrl = `${usersUrl(zh)}/${created.user.id}`;
    const refused = await anna.del(protectedUrl, { confirm: '120' });
    expect(refused.statusCode).toBe(403);
    expect(json(refused).error.message).toMatch(/Only weblion staff can delete it/);
    expect(demoUser(ZH, '120')).toBeDefined();
    const staff = await admin.del(protectedUrl, { confirm: '120' });
    expect(staff.statusCode, staff.body).toBe(200);
    expect(demoUser(ZH, '120')).toBeUndefined();
  });

  it('protects users whose role the phone system did not report', async () => {
    // 3CX without the nested role $expand: the role is unknown, the user may be an administrator.
    const ben101 = await userId(zh, '101');
    const originalGet = DemoAdapter.prototype.getPhoneUser;
    const originalList = DemoAdapter.prototype.listPhoneUsers;
    const unknownRole = <T extends { number: string; role: string | null }>(user: T): T =>
      user.number === '101' ? { ...user, role: null } : user;
    DemoAdapter.prototype.getPhoneUser = async function (this: DemoAdapter, systemId, id) {
      return unknownRole(await originalGet.call(this, systemId, id));
    };
    DemoAdapter.prototype.listPhoneUsers = async function (this: DemoAdapter, systemId) {
      return (await originalList.call(this, systemId)).map(unknownRole);
    };
    try {
      const list = json<PhoneUserListDto>(await anna.get(usersUrl(zh)));
      expect(list.users.find((u) => u.number === '101')).toMatchObject({
        role: null,
        admin: false,
        system: false,
        protected: true,
      });
      const del = await anna.del(`${usersUrl(zh)}/${ben101}`, { confirm: '101' });
      expect(del.statusCode).toBe(403);
      const email = await anna.patch(`${usersUrl(zh)}/${ben101}`, { email: 'ben.neu@muster.example' });
      expect(email.statusCode).toBe(403);
      expect(demoUser(ZH, '101')!.email).toBe('ben@muster.example');
    } finally {
      DemoAdapter.prototype.getPhoneUser = originalGet;
      DemoAdapter.prototype.listPhoneUsers = originalList;
    }
  });

  it('protects users who administer the phone system through a group other than their primary one', async () => {
    // 3CX keeps one role per group: Ben's primary department grants users, the default group
    // System Owner. Parsed like a real 3CX answer.
    const ben101 = await userId(zh, '101');
    const owner = parseUser({
      Id: 7,
      Number: '101',
      PrimaryGroupId: 3,
      Groups: [
        { GroupId: 3, Rights: { RoleName: 'users' } },
        { GroupId: 1, Rights: { RoleName: 'system_owners' } },
      ],
    })!;
    const originalGet = DemoAdapter.prototype.getPhoneUser;
    const originalList = DemoAdapter.prototype.listPhoneUsers;
    const secondaryOwner = <T extends PhoneUser>(user: T): T =>
      user.number === '101' ? { ...user, role: owner.role, admin: owner.admin } : user;
    DemoAdapter.prototype.getPhoneUser = async function (this: DemoAdapter, systemId, id) {
      return secondaryOwner(await originalGet.call(this, systemId, id));
    };
    DemoAdapter.prototype.listPhoneUsers = async function (this: DemoAdapter, systemId) {
      return (await originalList.call(this, systemId)).map(secondaryOwner);
    };
    try {
      const list = json<PhoneUserListDto>(await anna.get(usersUrl(zh)));
      expect(list.users.find((u) => u.number === '101')).toMatchObject({
        role: 'users',
        admin: true,
        protected: true,
      });
      const del = await anna.del(`${usersUrl(zh)}/${ben101}`, { confirm: '101' });
      expect(del.statusCode).toBe(403);
      const email = await anna.patch(`${usersUrl(zh)}/${ben101}`, { email: 'anna@muster.example' });
      expect(email.statusCode).toBe(403);
      expect(demoUser(ZH, '101')).toMatchObject({ email: 'ben@muster.example' });
    } finally {
      DemoAdapter.prototype.getPhoneUser = originalGet;
      DemoAdapter.prototype.listPhoneUsers = originalList;
    }
  });

  it('audits refusals and failures at the phone system', async () => {
    // The fax server cannot be deleted, not even by staff.
    const fax = await userId(zh, '105');
    const refused = await admin.del(`${usersUrl(zh)}/${fax}`, { confirm: '105' });
    expect(refused.statusCode).toBe(409);
    expect(await lastAudit('phone.user_delete', zh)).toMatchObject({
      status: 'failure',
      details: expect.objectContaining({ number: '105', error: expect.stringMatching(/fax server/) }),
    });

    // Removed at the PBX between the read and the change.
    const max = await userId(zh, '106');
    const original = DemoAdapter.prototype.getPhoneUser;
    DemoAdapter.prototype.getPhoneUser = async function (this: DemoAdapter, systemId, id) {
      const user = await original.call(this, systemId, id);
      pbx(ZH).users.delete(id);
      return user;
    };
    try {
      const res = await anna.patch(`${usersUrl(zh)}/${max}`, { lastName: 'Weg' });
      expect(res.statusCode).toBe(404);
      expect(json(res).error.code).toBe('provider_error');
    } finally {
      DemoAdapter.prototype.getPhoneUser = original;
    }
    const failed = await lastAudit('phone.user_update', zh);
    expect(failed).toMatchObject({ status: 'failure', resourceId: zh });
    expect(failed!.details).toMatchObject({
      userId: max,
      number: '106',
      after: { lastName: 'Weg' },
      error: expect.stringMatching(/not found/),
    });
  });
});

describe('ring groups and trunks', () => {
  const members = (group: PhoneRingGroup) => group.members.map((m) => m.number);

  it('lists ring groups with their members in ring order', async () => {
    const res = await carla.get(`/phone-systems/${zh}/ring-groups`);
    expect(res.statusCode, res.body).toBe(200);
    const groups = json<PhoneRingGroup[]>(res);
    expect(groups).toEqual([
      {
        id: expect.any(String),
        number: '800',
        name: 'Zentrale',
        strategy: 'ring_all',
        ringTimeSeconds: 20,
        members: [
          { number: '100', name: 'Anna Muster' },
          { number: '101', name: 'Ben Beispiel' },
          { number: '104', name: 'Empfang' },
        ],
      },
      {
        id: expect.any(String),
        number: '801',
        name: 'Support',
        strategy: 'hunt',
        ringTimeSeconds: 15,
        members: [
          { number: '102', name: 'Carla Rossi' },
          { number: '103', name: 'Daniel Keller' },
        ],
      },
    ]);
  });

  it('adds and removes members and audits both', async () => {
    const groups = json<PhoneRingGroup[]>(await anna.get(`/phone-systems/${zh}/ring-groups`));
    const zentrale = groups.find((g) => g.number === '800')!;
    const url = `/phone-systems/${zh}/ring-groups/${zentrale.id}/members`;

    const added = await anna.post(url, { number: '102' });
    expect(added.statusCode, added.body).toBe(200);
    expect(members(json(added))).toEqual(['100', '101', '104', '102']);
    // Already a member: no change.
    const again = await anna.post(url, { number: '102' });
    expect(again.statusCode, again.body).toBe(200);
    expect(members(json(again))).toEqual(['100', '101', '104', '102']);
    expect((await lastAudit('phone.ring_group_member_add', zh))!.details).toMatchObject({
      groupId: zentrale.id,
      group: '800 Zentrale',
      member: '102',
    });

    const noUser = await anna.post(url, { number: '801' });
    expect(noUser.statusCode).toBe(400);
    expect(json(noUser).error.message).toBe('Extension 801 is not a user of this phone system');
    expect((await anna.post(url, { number: '1' })).statusCode).toBe(400);
    expect((await carla.post(url, { number: '103' })).statusCode).toBe(403);
    expect(
      (await anna.post(`/phone-systems/${zh}/ring-groups/999/members`, { number: '103' })).statusCode,
    ).toBe(404);

    const removed = await anna.del(`${url}/102`);
    expect(removed.statusCode, removed.body).toBe(200);
    expect(members(json(removed))).toEqual(['100', '101', '104']);
    expect((await lastAudit('phone.ring_group_member_remove', zh))!.details).toMatchObject({
      groupId: zentrale.id,
      group: '800 Zentrale',
      member: '102',
    });
    const notMember = await anna.del(`${url}/102`);
    expect(notMember.statusCode).toBe(404);
    expect(await lastAudit('phone.ring_group_member_remove', zh)).toMatchObject({ status: 'failure' });
    expect((await carla.del(`${url}/101`)).statusCode).toBe(403);
    expect(pbx(ZH).ringGroups.get(zentrale.id)!.members).toEqual(['100', '101', '104']);
  });

  it('lists trunks read-only', async () => {
    const zurich = json<PhoneTrunk[]>(await carla.get(`/phone-systems/${zh}/trunks`));
    expect(zurich.map((tr) => [tr.number, tr.name, tr.online])).toEqual([
      ['10000', 'Swisscom SIP', true],
      ['10001', 'Peoplefone', true],
    ]);
    const bern = json<PhoneTrunk[]>(await carla.get(`/phone-systems/${be}/trunks`));
    expect(bern).toEqual([
      {
        id: expect.any(String),
        number: '10000',
        name: 'Peoplefone Bern',
        host: 'sip.peoplefone.example',
        online: false,
        direction: 'both',
        externalNumber: '+41315005000',
        simultaneousCalls: 4,
        didCount: 3,
        configurationIssue: 'Registration failed: 403 Forbidden',
      },
    ]);
  });
});

describe('admin', () => {
  const adminList = async (query = '') => {
    const res = await admin.get(`/admin/phone-systems${query}`);
    expect(res.statusCode, res.body).toBe(200);
    return json<PhoneSystemDto[]>(res).map((s) => s.id);
  };

  it('lists and filters every phone system for platform staff only', async () => {
    // From the users tests, the lab belongs to Muster AG.
    expect(await adminList()).toHaveLength(3);
    expect(await adminList(`?providerId=${demo.id}`)).toHaveLength(3);
    expect(await adminList(`?orgId=${musterId}`)).toHaveLength(3);
    expect(await adminList(`?orgId=${beispielId}`)).toEqual([]);
    expect(await adminList('?assigned=false')).toEqual([]);
    expect(await adminList('?assigned=true')).toHaveLength(3);
    expect(await adminList('?q=bern')).toEqual([be]);
    expect(await adminList('?q=demo-pbx-lab')).toEqual([lab]);
    // The host name counts too, not only the panel name.
    await anna.patch(`/phone-systems/${zh}`, { name: 'Zentrale' });
    try {
      expect(await adminList('?q=zuerich')).toEqual([zh]);
      expect(await adminList('?q=%25')).toHaveLength(3);
    } finally {
      await anna.patch(`/phone-systems/${zh}`, { name: 'pbx-zuerich.demo.weblion.one' });
    }
    const dto = json<PhoneSystemDto[]>(await admin.get(`/admin/phone-systems?q=lab`))[0]!;
    expect(dto).toMatchObject({
      org: { id: musterId },
      info: { productCode: 'DEMO-STD-4', edition: 'standard' },
    });
    expect((await admin.get('/admin/phone-systems?assigned=maybe')).statusCode).toBe(400);
    expect((await anna.get('/admin/phone-systems')).statusCode).toBe(403);
    expect((await reto.get('/admin/phone-systems')).statusCode).toBe(403);
  });

  it('assigns and unassigns and switches the module on', async () => {
    const unassigned = await assign(lab, null);
    expect(unassigned.statusCode, unassigned.body).toBe(200);
    expect(json<PhoneSystemDto>(unassigned).org).toBeNull();
    expect(await lastAudit('phone.system_unassign', lab)).toMatchObject({
      orgId: musterId,
      details: expect.objectContaining({ orgId: null, previousOrgId: musterId }),
    });
    expect(await adminList('?assigned=false')).toEqual([lab]);
    expect((await anna.get(`/phone-systems/${lab}`)).statusCode).toBe(404);

    const modules = await modulesOf(beispielId);
    expect(modules).not.toContain('phone');
    try {
      const res = await assign(lab, beispielId);
      expect(res.statusCode, res.body).toBe(200);
      expect(json<PhoneSystemDto>(res).org).toMatchObject({ id: beispielId });
      expect(await modulesOf(beispielId)).toContain('phone');
      expect(await lastAudit('phone.system_assign', lab)).toMatchObject({
        orgId: beispielId,
        details: expect.objectContaining({
          name: 'pbx-lab.demo.weblion.one',
          orgId: beispielId,
          previousOrgId: null,
          moduleEnabled: 'phone',
        }),
      });
      const listed = json<PhoneSystemDto[]>(await dev.get(`/orgs/${beispielId}/phone-systems`));
      expect(listed.map((s) => s.id)).toEqual([lab]);
      expect(json(await dev.get(`/orgs/${beispielId}`)).counts.phoneSystems).toBe(1);

      // A customer whose reseller lacks the module cannot get it.
      const refused = await assign(lab, huberId);
      expect(refused.statusCode).toBe(409);
      expect(json(refused).error.message).toMatch(/phone/);
      expect((await row(LAB)).orgId).toBe(beispielId);
      expect((await assign(lab, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
      expect((await anna.post(`/admin/phone-systems/${lab}/assign`, { orgId: musterId })).statusCode).toBe(
        403,
      );
      expect((await admin.post(`/admin/phone-systems/${lab}/assign`, { orgId: 'x' })).statusCode).toBe(400);
    } finally {
      await assign(lab, null);
      await setModules(beispielId, modules);
    }
  });

  it('refuses to delete a provider while one of its phone systems is assigned', async () => {
    const [connection] = await t.db
      .insert(providerConnections)
      .values({
        type: 'demo',
        name: 'Demo Telefonie 2',
        location: { country: 'CH', label: 'Demo Telefonie 2' },
        configEnc: t.ctx.box.encryptJson({}),
      })
      .returning();
    const counts = await syncPhoneSystems(t.db, connection!, t.ctx.providers.forConnection(connection!));
    expect(counts).toEqual({ seen: 3, missing: 0 });
    const second = await row(ZH, connection!.id);
    // An independent PBX: the same external ids, its own rows.
    expect(second.id).not.toBe(zh);
    expect(await adminList(`?providerId=${connection!.id}`)).toHaveLength(3);
    expect((await assign(second.id, beispielId, false)).statusCode).toBe(200);
    const refused = await admin.del(`/admin/providers/${connection!.id}`);
    expect(refused.statusCode).toBe(409);
    expect(json(refused).error.message).toMatch(/phone systems/);
    expect((await assign(second.id, null)).statusCode).toBe(200);
    const deleted = await admin.del(`/admin/providers/${connection!.id}`);
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(
      await t.db.select().from(phoneSystems).where(eq(phoneSystems.providerConnectionId, connection!.id)),
    ).toEqual([]);
    expect(await modulesOf(beispielId)).not.toContain('phone');
  });
});

describe('reseller', () => {
  it('hands a phone system to a customer and takes it back', async () => {
    const alpenModules = await modulesOf(alpenId);
    const huberModules = await modulesOf(huberId);
    try {
      // The reseller gets the lab with the module.
      expect((await assign(lab, alpenId)).statusCode).toBe(200);
      expect(await modulesOf(alpenId)).toContain('phone');
      const resources = async () =>
        json<{ phoneSystems: { id: string }[]; pool: { phoneSystems: { id: string }[] } }>(
          await reto.get(`/orgs/${alpenId}/customers/${huberId}/resources`),
        );
      expect((await resources()).pool.phoneSystems.map((s) => s.id)).toEqual([lab]);

      const handed = await reto.post(`/orgs/${alpenId}/customers/${huberId}/resources`, {
        type: 'phone_system',
        id: lab,
      });
      expect(handed.statusCode, handed.body).toBe(200);
      expect(await modulesOf(huberId)).toContain('phone');
      expect((await row(LAB)).orgId).toBe(huberId);
      const listed = json<PhoneSystemDto[]>(await hanna.get(`/orgs/${huberId}/phone-systems`));
      expect(listed.map((s) => s.id)).toEqual([lab]);
      expect([...listed[0]!.permissions].sort()).toEqual(['phone:credentials', 'phone:read', 'phone:write']);
      expect((await hanna.get(usersUrl(lab))).statusCode).toBe(200);
      expect(await lastAudit('reseller.resource_assign', lab)).toMatchObject({
        resourceType: 'phone_system',
      });

      // A customer holding a phone system cannot be deleted.
      const blocked = await admin.del(`/admin/orgs/${huberId}`);
      expect(blocked.statusCode).toBe(409);
      expect(json(blocked).error.details).toMatchObject({ phoneSystems: 1 });

      const released = await reto.post(`/orgs/${alpenId}/customers/${huberId}/resources/release`, {
        type: 'phone_system',
        id: lab,
      });
      expect(released.statusCode, released.body).toBe(200);
      expect((await row(LAB)).orgId).toBe(alpenId);
      expect(json(await hanna.get(`/orgs/${huberId}/phone-systems`))).toEqual([]);
      expect((await hanna.get(`/phone-systems/${lab}`)).statusCode).toBe(404);

      // Phone systems outside the reseller's holdings do not exist for it.
      const foreign = await reto.post(`/orgs/${alpenId}/customers/${huberId}/resources`, {
        type: 'phone_system',
        id: zh,
      });
      expect(foreign.statusCode).toBe(404);
      expect((await row(ZH)).orgId).toBe(musterId);
    } finally {
      await assign(lab, null);
      await setModules(alpenId, alpenModules);
      await setModules(huberId, huberModules);
    }
  });
});

describe('explorer audit', () => {
  it('blanks phone system secrets in audited explorer writes', async () => {
    const res = await admin.post('/admin/explorer', {
      providerId: demo.id,
      method: 'PATCH',
      path: '/Users(1)',
      body: { VMPIN: '1234', AuthPassword: { Value: 'x' }, FirstName: 'A' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const entry = await lastAudit('provider.explorer', demo.id);
    expect(entry!.details).toMatchObject({
      method: 'PATCH',
      body: { VMPIN: '[redacted]', AuthPassword: '[redacted]', FirstName: 'A' },
    });
    expect(JSON.stringify(entry!.details)).not.toContain('1234');
  });
});

describe('secrets', () => {
  /** Keys of every object in a JSON value. */
  function keys(value: unknown, out: string[] = []): string[] {
    if (Array.isArray(value)) value.forEach((v) => keys(v, out));
    else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        out.push(k);
        keys(v, out);
      }
    }
    return out;
  }

  it('never answers or audits a password or PIN', async () => {
    expect(answers.length).toBeGreaterThan(50);
    const secret = /pass(word)?|pin$|secret|authid|licen[cs]e_?key|token/i;
    for (const body of answers) {
      expect(body).not.toMatch(/AuthPassword|AccessPassword|VMPIN|password/i);
      if (body.startsWith('{') || body.startsWith('[')) {
        expect(keys(JSON.parse(body)).filter((k) => secret.test(k))).toEqual([]);
      }
    }
    const entries = await t.db.select().from(auditLogs).where(like(auditLogs.action, 'phone.%'));
    expect(entries.length).toBeGreaterThan(10);
    for (const entry of entries) {
      expect(keys(entry.details).filter((k) => secret.test(k))).toEqual([]);
      expect(JSON.stringify(entry.details)).not.toMatch(/password|vmpin/i);
    }
  });
});
