import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { PHONE_USER_LIMIT_CODE, phoneSystemHealth } from '@weblion/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { organizations, phoneSystems, providerConnections } from '../src/db/schema';
import { seedPhoneDemo } from '../src/db/seed-phone';
import { AppError, ProviderError } from '../src/lib/errors';
import { DemoAdapter } from '../src/providers/demo/adapter';
import { DEMO_PHONE_SYSTEMS, DemoPhone, demoPhoneState, resetDemoPhone } from '../src/providers/demo/phone';
import type { PhoneUserInput } from '../src/providers/types';
import { createTestApp, type TestApp } from './helpers';

const { zurich: ZH, bern: BE, lab: LAB } = DEMO_PHONE_SYSTEMS;
const T0 = Date.parse('2026-10-14T08:00:00.000Z');
const DAY = 86_400_000;
const MINUTE = 60_000;
/** Names of keys that would carry PBX credentials or the license key. */
const SECRET_KEY = /pass|secret|token|pin$|auth|licen[cs]e_?key|provisioning|ticket/i;

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
  message?: string,
): Promise<AppError> {
  const err = await caught(promise);
  expect({ status: err.statusCode, code: err.code }).toEqual({ status, code });
  if (message !== undefined) expect(err.message).toBe(message);
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

const input = (extra: Partial<PhoneUserInput> = {}): PhoneUserInput => ({
  firstName: 'Nina',
  lastName: 'Neu',
  email: 'nina@muster.example',
  mobile: null,
  outboundCallerId: null,
  language: 'de',
  ...extra,
});

describe('Demo telephony', () => {
  let id: string;
  const phone = () => new DemoAdapter(id, {});
  const system = (externalId: string) => demoPhoneState(id).systems.get(externalId)!;
  const members = async (externalId: string, groupId: string) =>
    (await phone().listPhoneRingGroups(externalId))
      .find((g) => g.id === groupId)!
      .members.map((m) => m.number);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    resetDemoPhone();
    id = randomUUID();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports three phone systems with facts and the expected health', async () => {
    const systems = await phone().listPhoneSystems();
    expect(systems.map((s) => [s.externalId, s.name, s.reachable])).toEqual([
      [ZH, 'pbx-zuerich.demo.weblion.one', true],
      [BE, 'pbx-bern.demo.weblion.one', true],
      [LAB, 'pbx-lab.demo.weblion.one', true],
    ]);
    const [zh, be, lab] = systems.map((s) => s.info);
    expect(zh).toEqual({
      fqdn: 'pbx-zuerich.demo.weblion.one',
      version: '20.0.10.1479',
      edition: 'enterprise',
      productCode: 'DEMO-ENT-16',
      activated: true,
      licenseActive: true,
      licenseExpiresAt: new Date(T0 + 300 * DAY).toISOString(),
      maintenanceExpiresAt: new Date(T0 + 300 * DAY).toISOString(),
      maxSimCalls: 16,
      activeCalls: expect.any(Number),
      users: 6,
      maxUsers: null,
      extensionsTotal: 8,
      extensionsRegistered: 5,
      trunksTotal: 2,
      trunksRegistered: 2,
      servicesDown: false,
      numberLength: 3,
      webClientUrl: 'https://pbx-zuerich.demo.weblion.one/webclient/',
    });
    expect(be).toMatchObject({
      edition: 'professional',
      maxSimCalls: 8,
      licenseExpiresAt: new Date(T0 + 200 * DAY).toISOString(),
      users: 3,
      maxUsers: null,
      extensionsTotal: 4,
      extensionsRegistered: 2,
      trunksTotal: 1,
      trunksRegistered: 0,
      numberLength: 3,
    });
    expect(lab).toMatchObject({
      edition: 'standard',
      maxSimCalls: 4,
      licenseExpiresAt: new Date(T0 + 10 * DAY).toISOString(),
      users: 9,
      maxUsers: 10,
      extensionsTotal: 9,
      extensionsRegistered: 0,
      trunksTotal: 0,
      trunksRegistered: 0,
      numberLength: 4,
      webClientUrl: 'https://pbx-lab.demo.weblion.one/webclient/',
    });
    const now = new Date(T0);
    expect(systems.map((s) => phoneSystemHealth(s.info, s.reachable !== false, now))).toEqual([
      { status: 'ok', reasons: [] },
      { status: 'warning', reasons: ['trunks_down'] },
      { status: 'warning', reasons: ['license_expiring'] },
    ]);
    // getPhoneSystem answers the same, and nothing that looks like a credential.
    expect(await phone().getPhoneSystem(BE)).toEqual(systems[1]);
    expect(keys(systems).filter((k) => SECRET_KEY.test(k))).toEqual([]);
    expect((await phone().overview()).facts).toContainEqual({ label: 'Phone systems', value: '3' });
  });

  it('simulates calls in progress, the same within a minute, at most half the licensed calls', async () => {
    const calls = async () => (await phone().getPhoneSystem(ZH)).info.activeCalls!;
    const first = await calls();
    vi.setSystemTime(T0 + 30_000);
    expect(await calls()).toBe(first);
    const seen = new Set<number>();
    for (let minute = 0; minute < 120; minute++) {
      vi.setSystemTime(T0 + minute * MINUTE);
      for (const s of await phone().listPhoneSystems()) {
        expect(s.info.activeCalls).toBeGreaterThanOrEqual(0);
        expect(s.info.activeCalls).toBeLessThanOrEqual(s.info.maxSimCalls! / 2);
      }
      seen.add(await calls());
    }
    expect(seen.size).toBeGreaterThan(2);
  });

  it('lists users with admin and system flags, ring groups and trunks', async () => {
    const users = await phone().listPhoneUsers(ZH);
    expect(users.map((u) => [u.id, u.number, u.displayName, u.role, u.admin, u.system])).toEqual([
      ['1', '100', 'Anna Muster', 'system_owners', true, false],
      ['2', '101', 'Ben Beispiel', 'users', false, false],
      ['3', '102', 'Carla Rossi', 'users', false, false],
      ['4', '103', 'Daniel Keller', 'users', false, false],
      ['5', '104', 'Empfang', 'users', false, false],
      ['6', '105', 'Fax', 'users', false, true],
    ]);
    expect(users[0]).toEqual({
      id: '1',
      number: '100',
      firstName: 'Anna',
      lastName: 'Muster',
      displayName: 'Anna Muster',
      email: 'anna@muster.example',
      mobile: '+41791234500',
      outboundCallerId: null,
      language: 'de',
      enabled: true,
      registered: true,
      role: 'system_owners',
      admin: true,
      system: false,
    });
    expect(users[4]).toMatchObject({ lastName: null, outboundCallerId: '+41441234500' });
    expect(users[5]).toMatchObject({ email: null, registered: true });
    expect(await phone().getPhoneUser(ZH, '3')).toEqual(users[2]);
    expect(users.every((u) => u.email === null || u.email.endsWith('@muster.example'))).toBe(true);

    expect((await phone().listPhoneUsers(BE)).map((u) => [u.number, u.displayName, u.admin])).toEqual([
      ['200', 'Eva Brunner', true],
      ['201', 'Fritz Meier', false],
      ['202', 'Lager', false],
    ]);
    const lab = await phone().listPhoneUsers(LAB);
    expect(lab.map((u) => u.number)).toEqual([
      '1000',
      '1001',
      '1002',
      '1003',
      '1004',
      '1005',
      '1006',
      '1007',
      '1008',
    ]);
    expect(lab.map((u) => u.displayName)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `Test ${n}`));
    expect(lab.every((u) => u.email!.endsWith('@lab.example') && !u.admin && !u.system)).toBe(true);

    expect(await phone().listPhoneRingGroups(ZH)).toEqual([
      {
        id: '7',
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
        id: '8',
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
    expect(await phone().listPhoneRingGroups(BE)).toMatchObject([
      { number: '810', name: 'Bern', strategy: 'ring_all', members: [{ number: '200' }, { number: '201' }] },
    ]);
    expect(await phone().listPhoneRingGroups(LAB)).toEqual([]);

    expect(await phone().listPhoneTrunks(ZH)).toEqual([
      {
        id: '9',
        number: '10000',
        name: 'Swisscom SIP',
        host: 'sip.swisscom.example',
        online: true,
        direction: 'both',
        externalNumber: '+41441234500',
        simultaneousCalls: 8,
        didCount: 10,
        configurationIssue: null,
      },
      {
        id: '10',
        number: '10001',
        name: 'Peoplefone',
        host: 'sip.peoplefone.example',
        online: true,
        direction: 'outbound',
        externalNumber: '+41445005000',
        simultaneousCalls: 4,
        didCount: 0,
        configurationIssue: null,
      },
    ]);
    expect(await phone().listPhoneTrunks(BE)).toMatchObject([
      {
        number: '10000',
        name: 'Peoplefone Bern',
        online: false,
        configurationIssue: 'Registration failed: 403 Forbidden',
      },
    ]);
    expect(await phone().listPhoneTrunks(LAB)).toEqual([]);

    const everything = [
      users,
      await phone().listPhoneUsers(BE),
      lab,
      await phone().listPhoneRingGroups(ZH),
      await phone().listPhoneTrunks(ZH),
      await phone().listPhoneTrunks(BE),
    ];
    expect(keys(everything).filter((k) => SECRET_KEY.test(k))).toEqual([]);
  });

  it('returns copies', async () => {
    const [user] = await phone().listPhoneUsers(ZH);
    user!.firstName = 'Changed';
    const [group] = await phone().listPhoneRingGroups(ZH);
    group!.members.push({ number: '999', name: null });
    group!.members[0]!.number = '555';
    const [trunk] = await phone().listPhoneTrunks(ZH);
    trunk!.online = false;
    const [remote] = await phone().listPhoneSystems();
    remote!.info.users = 99;

    expect((await phone().getPhoneUser(ZH, '1')).firstName).toBe('Anna');
    expect(await members(ZH, '7')).toEqual(['100', '101', '104']);
    expect((await phone().listPhoneTrunks(ZH))[0]!.online).toBe(true);
    expect((await phone().getPhoneSystem(ZH)).info.users).toBe(6);
  });

  it('creates, changes and deletes users; state survives a new adapter for the same connection', async () => {
    const created = await phone().createPhoneUser(
      ZH,
      input({ number: '150', mobile: '+41790000000', outboundCallerId: '+41441234500' }),
    );
    expect(created).toEqual({
      id: '11',
      number: '150',
      firstName: 'Nina',
      lastName: 'Neu',
      displayName: 'Nina Neu',
      email: 'nina@muster.example',
      mobile: '+41790000000',
      outboundCallerId: '+41441234500',
      language: 'de',
      enabled: true,
      registered: false,
      role: 'users',
      admin: false,
      system: false,
    });
    // A new adapter of the same connection sees it, another connection does not.
    expect(await new DemoAdapter(id, {}).getPhoneUser(ZH, '11')).toEqual(created);
    expect((await phone().listPhoneUsers(ZH)).map((u) => u.number)).toEqual([
      '100',
      '101',
      '102',
      '103',
      '104',
      '105',
      '150',
    ]);
    expect((await new DemoAdapter(randomUUID(), {}).listPhoneUsers(ZH)).map((u) => u.number)).not.toContain(
      '150',
    );
    expect((await phone().getPhoneSystem(ZH)).info).toMatchObject({ users: 7, extensionsTotal: 9 });

    // Only the given keys change; null clears; e-mail addresses are kept in lower case.
    const updated = await phone().updatePhoneUser(ZH, '11', {
      lastName: null,
      email: 'Nina.Neu@Muster.Example',
      mobile: null,
      language: 'fr',
    });
    expect(updated).toEqual({
      ...created,
      lastName: null,
      displayName: 'Nina',
      email: 'nina.neu@muster.example',
      mobile: null,
      language: 'fr',
    });
    expect(await phone().updatePhoneUser(ZH, '11', {})).toEqual(updated);
    // A refused change changes nothing, not even the valid keys of it.
    await refused(phone().updatePhoneUser(ZH, '11', { firstName: 'Nora', mobile: '12' }), 400, 'bad_request');
    await refused(phone().updatePhoneUser(ZH, '11', { firstName: ' ' }), 400, 'bad_request');
    await refused(phone().updatePhoneUser(ZH, '11', { email: 'kein-at' }), 400, 'bad_request');
    expect(await phone().getPhoneUser(ZH, '11')).toEqual(updated);
    // The number cannot be changed (3CX: "Should not allow to change number").
    await phone().updatePhoneUser(ZH, '11', { number: '151' } as never);
    expect((await phone().getPhoneUser(ZH, '11')).number).toBe('150');

    // Deleting removes the extension from its ring groups too.
    await phone().addPhoneRingGroupMember(ZH, '7', '150');
    expect(await members(ZH, '7')).toEqual(['100', '101', '104', '150']);
    await phone().deletePhoneUser(ZH, '11');
    await refused(phone().getPhoneUser(ZH, '11'), 404, 'provider_error', 'Demo: phone user 11 not found');
    expect(await members(ZH, '7')).toEqual(['100', '101', '104']);
    await phone().deletePhoneUser(ZH, '2');
    expect(await members(ZH, '7')).toEqual(['100', '104']);
    expect((await phone().getPhoneSystem(ZH)).info).toMatchObject({ users: 5, extensionsTotal: 7 });
    // Ids are not reused.
    expect((await phone().createPhoneUser(ZH, input())).id).toBe('12');

    // Like 3CX (WARNINGS.FAX_SERVER_CANNOT_BE_DELETED): the fax server stays.
    await refused(phone().deletePhoneUser(ZH, '6'), 409, 'conflict', 'The fax server cannot be deleted');
    expect((await phone().getPhoneUser(ZH, '6')).number).toBe('105');
    // An administrator can be deleted at the PBX (the API protects it from customers).
    await phone().deletePhoneUser(ZH, '1');
    expect((await phone().listPhoneUsers(ZH)).map((u) => u.number)).not.toContain('100');
  });

  it('validates like the 3CX adapter', async () => {
    const create = (systemId: string, extra: Partial<PhoneUserInput>) =>
      phone().createPhoneUser(systemId, input(extra));
    // Number length per system, digits only.
    for (const number of ['15', '1500', '15a', ' 150', '+15']) {
      await refused(create(ZH, { number }), 400, 'bad_request', 'The extension number must have 3 digits');
    }
    await refused(
      create(LAB, { number: '150' }),
      400,
      'bad_request',
      'The extension number must have 4 digits',
    );
    await refused(
      create(LAB, { number: '10000' }),
      400,
      'bad_request',
      'The extension number must have 4 digits',
    );
    // One namespace: numbers of users, ring groups and trunks are taken.
    for (const number of ['101', '800']) {
      await refused(
        create(ZH, { number }),
        409,
        'conflict',
        `The extension number ${number} is in use at the phone system`,
      );
    }
    system(ZH).trunks[0]!.number = '900';
    await refused(create(ZH, { number: '900' }), 409, 'conflict');
    // Numbers are per system: 101 is free in Bern.
    expect((await create(BE, { number: '101' })).number).toBe('101');

    // The fields themselves.
    await refused(create(ZH, { firstName: '' }), 400, 'bad_request');
    await refused(create(ZH, { firstName: 'x'.repeat(51) }), 400, 'bad_request');
    await refused(create(ZH, { lastName: 'x'.repeat(51) }), 400, 'bad_request');
    await refused(create(ZH, { email: '' }), 400, 'bad_request');
    await refused(create(ZH, { email: `${'x'.repeat(250)}@a.ch` }), 400, 'bad_request');
    await refused(create(ZH, { mobile: '12' }), 400, 'bad_request', 'Invalid mobile number');
    await refused(create(ZH, { outboundCallerId: '+41 44' }), 400, 'bad_request');
    await refused(create(ZH, { language: 'xx' }), 400, 'bad_request', 'Unknown language');
    expect(await create(ZH, { lastName: '', mobile: '', language: null })).toMatchObject({
      number: '106',
      lastName: null,
      mobile: null,
      language: null,
    });
    expect((await phone().listPhoneUsers(ZH)).length).toBe(7);

    // The lab's license allows 10 users: the 10th works, the 11th does not.
    expect((await create(LAB, {})).number).toBe('1009');
    const lab = await phone().getPhoneSystem(LAB);
    expect(lab.info).toMatchObject({ users: 10, maxUsers: 10 });
    expect(phoneSystemHealth(lab.info, true, new Date(T0)).reasons).toEqual([
      'license_expiring',
      'user_limit_reached',
    ]);
    for (const extra of [{}, { number: '1500' }]) {
      await refused(
        create(LAB, extra),
        409,
        PHONE_USER_LIMIT_CODE,
        'The license of this phone system allows no more users',
      );
    }
    expect((await phone().listPhoneUsers(LAB)).length).toBe(10);
    // Deleting a user frees the slot right away.
    await phone().deletePhoneUser(LAB, '1');
    expect((await create(LAB, {})).number).toBe('1000');
  });

  it('proposes the next free number and assigns it when the input has none', async () => {
    expect(await phone().nextPhoneNumber(ZH)).toBe('106');
    expect(await phone().nextPhoneNumber(BE)).toBe('100');
    expect(await phone().nextPhoneNumber(LAB)).toBe('1009');

    const first = await phone().createPhoneUser(ZH, input());
    expect(first.number).toBe('106');
    expect(await phone().nextPhoneNumber(ZH)).toBe('107');
    // An explicit number leaves the lower free ones free.
    await phone().createPhoneUser(ZH, input({ number: '108' }));
    expect(await phone().nextPhoneNumber(ZH)).toBe('107');
    // Numbers of ring groups and trunks are skipped, gaps are filled.
    system(ZH).ringGroups.get('7')!.number = '107';
    system(ZH).trunks[0]!.number = '109';
    expect(await phone().nextPhoneNumber(ZH)).toBe('110');
    await phone().deletePhoneUser(ZH, '2');
    expect(await phone().nextPhoneNumber(ZH)).toBe('101');
    expect((await phone().createPhoneUser(ZH, input())).number).toBe('101');

    // No number left: null, and creating without a number is refused like the user limit.
    const lab = system(LAB);
    lab.numberLength = 1;
    lab.maxUsers = null;
    for (let n = 1; n <= 9; n++) {
      expect((await phone().createPhoneUser(LAB, input())).number).toBe(String(n));
    }
    expect(await phone().nextPhoneNumber(LAB)).toBeNull();
    await refused(
      phone().createPhoneUser(LAB, input()),
      409,
      PHONE_USER_LIMIT_CODE,
      'The phone system has no free extension number left',
    );
  });

  it('counts welcome e-mails, refuses them without e-mail', async () => {
    const created = await phone().createPhoneUser(ZH, input());
    expect(system(ZH).users.get(created.id)!.welcomeMails).toBe(0);
    await phone().sendPhoneWelcome(ZH, created.id);
    await phone().sendPhoneWelcome(ZH, created.id);
    await phone().sendPhoneWelcome(ZH, '1');
    expect(system(ZH).users.get(created.id)!.welcomeMails).toBe(2);
    expect(system(ZH).users.get('1')!.welcomeMails).toBe(1);
    await refused(phone().sendPhoneWelcome(ZH, '6'), 400, 'bad_request', 'This user has no e-mail address');
    expect(system(ZH).users.get('6')!.welcomeMails).toBe(0);
    expect([...system(ZH).users.values()].map((u) => u.welcomeMails)).toEqual([1, 0, 0, 0, 0, 0, 2]);
  });

  it('adds members idempotently, removes them, 404 for a non member', async () => {
    const added = await phone().addPhoneRingGroupMember(ZH, '8', '100');
    expect(added).toMatchObject({ id: '8', number: '801', name: 'Support' });
    expect(added.members).toEqual([
      { number: '102', name: 'Carla Rossi' },
      { number: '103', name: 'Daniel Keller' },
      { number: '100', name: 'Anna Muster' },
    ]);
    expect(await phone().addPhoneRingGroupMember(ZH, '8', '100')).toEqual(added);
    expect(await members(ZH, '8')).toEqual(['102', '103', '100']);

    const removed = await phone().removePhoneRingGroupMember(ZH, '8', '102');
    expect(removed.members.map((m) => m.number)).toEqual(['103', '100']);
    await refused(
      phone().removePhoneRingGroupMember(ZH, '8', '102'),
      404,
      'not_found',
      'Ring group member not found',
    );
    expect(await members(ZH, '8')).toEqual(['103', '100']);

    // Only users of this phone system can become members.
    for (const number of ['999', '800', '10000', '200']) {
      await refused(
        phone().addPhoneRingGroupMember(ZH, '8', number),
        400,
        'bad_request',
        `Extension ${number} is not a user of this phone system`,
      );
    }
    await refused(phone().addPhoneRingGroupMember(ZH, '8', '1a'), 400, 'bad_request');
    // A new user can join.
    const nina = await phone().createPhoneUser(ZH, input());
    expect((await phone().addPhoneRingGroupMember(ZH, '7', nina.number)).members.at(-1)).toEqual({
      number: '106',
      name: 'Nina Neu',
    });
    // Groups of other systems are untouched.
    expect(await members(BE, '4')).toEqual(['200', '201']);
  });

  it('answers 404 for unknown system, user and ring group ids', async () => {
    const unknown = 'demo-pbx-xx';
    const calls = [
      () => phone().getPhoneSystem(unknown),
      () => phone().listPhoneUsers(unknown),
      () => phone().getPhoneUser(unknown, '1'),
      () => phone().nextPhoneNumber(unknown),
      () => phone().createPhoneUser(unknown, input()),
      () => phone().updatePhoneUser(unknown, '1', { firstName: 'A' }),
      () => phone().deletePhoneUser(unknown, '1'),
      () => phone().sendPhoneWelcome(unknown, '1'),
      () => phone().listPhoneRingGroups(unknown),
      () => phone().addPhoneRingGroupMember(unknown, '7', '100'),
      () => phone().removePhoneRingGroupMember(unknown, '7', '100'),
      () => phone().listPhoneTrunks(unknown),
    ];
    for (const call of calls) {
      const err = await refused(call(), 404, 'provider_error', `Demo: unknown phone system "${unknown}"`);
      expect(err).toBeInstanceOf(ProviderError);
    }
    // Ids of other systems or other kinds are no users.
    for (const [systemId, userId] of [
      [ZH, '999'],
      [ZH, '7'],
      [BE, '6'],
      [ZH, 'abc'],
    ] as const) {
      const message = `Demo: phone user ${userId} not found`;
      await refused(phone().getPhoneUser(systemId, userId), 404, 'provider_error', message);
      await refused(
        phone().updatePhoneUser(systemId, userId, { firstName: 'A' }),
        404,
        'provider_error',
        message,
      );
      await refused(phone().deletePhoneUser(systemId, userId), 404, 'provider_error', message);
      await refused(phone().sendPhoneWelcome(systemId, userId), 404, 'provider_error', message);
    }
    for (const groupId of ['999', '1', '9']) {
      const message = `Demo: ring group ${groupId} not found`;
      await refused(phone().addPhoneRingGroupMember(ZH, groupId, '100'), 404, 'provider_error', message);
      await refused(phone().removePhoneRingGroupMember(ZH, groupId, '100'), 404, 'provider_error', message);
    }
    // Long ids are cut in the message.
    const long = await caught(phone().getPhoneUser(ZH, 'x'.repeat(500)));
    expect(long.message).toBe(`Demo: phone user ${'x'.repeat(64)} not found`);
  });

  it('lists an unreachable phone system with reachable false and answers 502 for everything else', async () => {
    system(BE).unreachable = true;
    const systems = await phone().listPhoneSystems();
    expect(systems.map((s) => [s.externalId, s.reachable])).toEqual([
      [ZH, true],
      [BE, false],
      [LAB, true],
    ]);
    expect(systems[1]!.info.fqdn).toBe('pbx-bern.demo.weblion.one');
    expect((await phone().overview()).facts).toContainEqual({ label: 'Phone systems', value: '3' });

    const calls = [
      () => phone().getPhoneSystem(BE),
      () => phone().listPhoneUsers(BE),
      () => phone().getPhoneUser(BE, '1'),
      () => phone().nextPhoneNumber(BE),
      () => phone().createPhoneUser(BE, input()),
      () => phone().updatePhoneUser(BE, '1', { firstName: 'A' }),
      () => phone().deletePhoneUser(BE, '1'),
      () => phone().sendPhoneWelcome(BE, '1'),
      () => phone().listPhoneRingGroups(BE),
      () => phone().addPhoneRingGroupMember(BE, '4', '202'),
      () => phone().removePhoneRingGroupMember(BE, '4', '200'),
      () => phone().listPhoneTrunks(BE),
    ];
    for (const call of calls) {
      const err = await refused(
        call(),
        502,
        'provider_error',
        'Demo: the phone system pbx-bern.demo.weblion.one does not answer',
      );
      expect(err).toBeInstanceOf(ProviderError);
    }
    // Nothing changed meanwhile, and the other systems keep working.
    expect((await phone().listPhoneUsers(ZH)).length).toBe(6);
    system(BE).unreachable = false;
    expect((await phone().listPhoneUsers(BE)).map((u) => u.number)).toEqual(['200', '201', '202']);
    expect(await members(BE, '4')).toEqual(['200', '201']);
  });

  it('forgets everything on resetDemoPhone()', async () => {
    const before = demoPhoneState(id);
    await phone().createPhoneUser(ZH, input());
    await phone().sendPhoneWelcome(ZH, '1');
    await phone().removePhoneRingGroupMember(ZH, '7', '100');
    system(BE).unreachable = true;

    resetDemoPhone();
    expect(demoPhoneState(id)).not.toBe(before);
    expect((await phone().listPhoneUsers(ZH)).map((u) => u.number)).toEqual([
      '100',
      '101',
      '102',
      '103',
      '104',
      '105',
    ]);
    await refused(phone().getPhoneUser(ZH, '11'), 404, 'provider_error');
    expect(system(ZH).users.get('1')!.welcomeMails).toBe(0);
    expect(await members(ZH, '7')).toEqual(['100', '101', '104']);
    expect((await phone().listPhoneSystems()).every((s) => s.reachable)).toBe(true);
    // DemoAdapter.reset() resets telephony as well.
    await phone().createPhoneUser(ZH, input());
    DemoAdapter.reset();
    expect((await phone().listPhoneUsers(ZH)).length).toBe(6);
  });

  it('works synchronously on a given state', () => {
    const state = demoPhoneState(id);
    const sync = new DemoPhone(state);
    expect(sync.listPhoneSystems()).toHaveLength(3);
    expect(sync.createPhoneUser(ZH, input()).number).toBe('106');
    expect(sync.nextPhoneNumber(ZH)).toBe('107');
    expect(() => sync.getPhoneUser(ZH, '999')).toThrow(ProviderError);
  });
});

describe('Demo telephony seed', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t?.close();
  });

  const demo = async () =>
    (await t.db.query.providerConnections.findFirst({ where: eq(providerConnections.envKey, 'demo') }))!;
  const org = async (slug: string) =>
    (await t.db.query.organizations.findFirst({ where: eq(organizations.slug, slug) }))!;
  const owners = async (connectionId: string) =>
    (
      await t.db
        .select({ externalId: phoneSystems.externalId, org: organizations.slug })
        .from(phoneSystems)
        .leftJoin(organizations, eq(organizations.id, phoneSystems.orgId))
        .where(eq(phoneSystems.providerConnectionId, connectionId))
        .orderBy(phoneSystems.externalId)
    ).map((r) => [r.externalId, r.org]);
  const setModules = async (slug: string, modules: (m: string[]) => string[]) => {
    const o = await org(slug);
    await t.db
      .update(organizations)
      .set({ modules: modules(o.modules) as typeof o.modules })
      .where(eq(organizations.id, o.id));
  };

  it('does nothing while the demo connection has no phone systems', async () => {
    const connection = await demo();
    // Whatever the test app's sync stored: start without rows and without the module.
    await t.db.delete(phoneSystems).where(eq(phoneSystems.providerConnectionId, connection.id));
    await setModules('muster-ag', (m) => m.filter((x) => x !== 'phone'));
    const log: string[] = [];
    await seedPhoneDemo(t.db, log);
    expect(log).toEqual([]);
    expect(await owners(connection.id)).toEqual([]);
    expect((await org('muster-ag')).modules).not.toContain('phone');
  });

  it('hands Zürich and Bern to Muster AG with the module, keeps the lab unassigned and later changes', async () => {
    const connection = await demo();
    // What the sync stores: every phone system of the demo connection, unassigned.
    const adapter = t.ctx.providers.forConnection(connection);
    for (const remote of await adapter.listPhoneSystems!()) {
      await t.db.insert(phoneSystems).values({
        providerConnectionId: connection.id,
        externalId: remote.externalId,
        name: remote.name,
        providerName: remote.name,
        fqdn: remote.info.fqdn,
        info: remote.info,
      });
    }
    const log: string[] = [];
    await seedPhoneDemo(t.db, log);
    expect(log).toEqual([
      'assigned phone systems pbx-bern.demo.weblion.one, pbx-zuerich.demo.weblion.one to Muster AG, module phone',
    ]);
    expect(await owners(connection.id)).toEqual([
      [BE, 'muster-ag'],
      [LAB, null],
      [ZH, 'muster-ag'],
    ]);
    expect((await org('muster-ag')).modules).toContain('phone');
    // Alpen Hosting and Bäckerei Huber keep their modules.
    expect((await org('alpen-hosting')).modules).not.toContain('phone');
    expect((await org('baeckerei-huber')).modules).not.toContain('phone');

    // Idempotent.
    const again: string[] = [];
    await seedPhoneDemo(t.db, again);
    expect(again).toEqual([]);

    // Staff moved Bern elsewhere and switched the module off: the seed leaves both alone.
    const beispiel = await org('beispiel-gmbh');
    await t.db
      .update(phoneSystems)
      .set({ orgId: beispiel.id })
      .where(and(eq(phoneSystems.providerConnectionId, connection.id), eq(phoneSystems.externalId, BE)));
    await setModules('muster-ag', (m) => m.filter((x) => x !== 'phone'));
    const later: string[] = [];
    await seedPhoneDemo(t.db, later);
    expect(later).toEqual([]);
    expect(await owners(connection.id)).toContainEqual([BE, 'beispiel-gmbh']);
    expect((await org('muster-ag')).modules).not.toContain('phone');

    // A phone system that is free again goes back to Muster AG, with the module.
    await t.db
      .update(phoneSystems)
      .set({ orgId: null })
      .where(and(eq(phoneSystems.providerConnectionId, connection.id), eq(phoneSystems.externalId, BE)));
    const restored: string[] = [];
    await seedPhoneDemo(t.db, restored);
    expect(restored).toEqual(['assigned phone systems pbx-bern.demo.weblion.one to Muster AG, module phone']);
    expect((await org('muster-ag')).modules).toContain('phone');
    // Already on: no module note.
    await t.db
      .update(phoneSystems)
      .set({ orgId: null })
      .where(and(eq(phoneSystems.providerConnectionId, connection.id), eq(phoneSystems.externalId, ZH)));
    const plain: string[] = [];
    await seedPhoneDemo(t.db, plain);
    expect(plain).toEqual(['assigned phone systems pbx-zuerich.demo.weblion.one to Muster AG']);
  });
});
