import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { aiUsage, auditLogs, organizations, users } from '../src/db/schema';
import { ADMIN, Client, createTestApp, json, type TestApp } from './helpers';

/** The per-organization switches (ai 5.5, plan O34): staff, reseller, the customer's own decline, the cascade. */

let t: TestApp;
let admin: Client;
let anna: Client;
let reto: Client;
let hanna: Client;
let dev: Client;
const ids: Record<string, string> = {};

const CHAT = { messages: [{ role: 'user', text: 'Wie viele Server habe ich?', page: null }], locale: 'de' };

async function org(slug: string) {
  return (await t.db.query.organizations.findFirst({ where: eq(organizations.slug, slug) }))!;
}

async function setOrg(slug: string, values: Partial<typeof organizations.$inferInsert>) {
  await t.db.update(organizations).set(values).where(eq(organizations.id, ids[slug]!));
}

async function audits(action: string) {
  return t.db.select().from(auditLogs).where(eq(auditLogs.action, action)).orderBy(auditLogs.id);
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
  dev = new Client(t.app);
  await dev.login('dev@beispiel.example');
  for (const slug of ['muster-ag', 'beispiel-gmbh', 'alpen-hosting', 'baeckerei-huber'])
    ids[slug] = (await org(slug)).id;
});
afterAll(() => t?.close());

beforeEach(async () => {
  // The demo seed: Muster AG and Alpen Hosting on, the other two never switched on (plan O34).
  await setOrg('muster-ag', {
    aiEnabled: true,
    aiDisabledBy: null,
    aiOptOutAt: null,
    aiOptOutBy: null,
    status: 'active',
  });
  await setOrg('alpen-hosting', { aiEnabled: true, aiDisabledBy: null, aiOptOutAt: null, aiOptOutBy: null });
  await setOrg('baeckerei-huber', {
    aiEnabled: false,
    aiDisabledBy: null,
    aiOptOutAt: null,
    aiOptOutBy: null,
  });
  await setOrg('beispiel-gmbh', { aiEnabled: false, aiDisabledBy: null, aiOptOutAt: null, aiOptOutBy: null });
  await t.db.delete(aiUsage);
  await t.db.delete(auditLogs);
});

describe('organizations start switched off (plan O34)', () => {
  it('a customer that was never switched on reports so, without a platform or reseller lock', async () => {
    const res = await dev.get(`/orgs/${ids['beispiel-gmbh']}/ai`);
    expect(res.statusCode).toBe(200);
    const dto = json(res);
    expect(dto.enabled).toBe(false);
    expect(dto.switch).toEqual({ enabled: false, by: null });
    expect(dto.offReasons).toEqual(['platform']);
    expect(dto.declined).toBeNull();
    expect(dto.reseller).toBeNull();
    expect(dto.platform).toMatchObject({ available: true, demo: true });
    expect(dto.usage).toMatchObject({ requests: 0, staffRequests: 0 });
    expect(dto).not.toHaveProperty('usageCostMicros');
    // The boundary denies ai:use and the gate answers with the specific code.
    const chat = await dev.post(`/orgs/${ids['beispiel-gmbh']}/ai/chat`, CHAT);
    expect(chat.statusCode).toBe(403);
    expect(json(chat).error).toMatchObject({ code: 'ai_org_disabled', details: { reasons: ['platform'] } });
  });

  it('a new organization created by staff starts off', async () => {
    const res = await admin.post('/admin/orgs', { name: 'Neu AG' });
    expect(res.statusCode).toBe(200);
    const created = json(res);
    const ai = json(await admin.get(`/admin/orgs/${created.id}/ai`));
    expect(ai.enabled).toBe(false);
    expect(ai.switch).toEqual({ enabled: false, by: null });
  });
});

describe('staff switch (PUT /admin/orgs/:orgId/ai)', () => {
  it('switching on needs consentConfirmed: true', async () => {
    for (const body of [{ enabled: true }, { enabled: true, consentConfirmed: false }]) {
      const res = await admin.request('PUT', `/admin/orgs/${ids['beispiel-gmbh']}/ai`, body);
      expect(res.statusCode).toBe(400);
      expect(json(res).error).toMatchObject({ code: 'bad_request', details: { field: 'consentConfirmed' } });
    }
    expect((await org('beispiel-gmbh')).aiEnabled).toBe(false);
    expect(await audits('ai.org_switch')).toHaveLength(0);
  });

  it('switches on with the consent and off again, each audited with { enabled, by, consentConfirmed }', async () => {
    const on = await admin.request('PUT', `/admin/orgs/${ids['beispiel-gmbh']}/ai`, {
      enabled: true,
      consentConfirmed: true,
    });
    expect(on.statusCode).toBe(200);
    expect(json(on)).toMatchObject({
      enabled: true,
      switch: { enabled: true, by: null },
      usageCostMicros: 0,
    });
    const off = await admin.request('PUT', `/admin/orgs/${ids['beispiel-gmbh']}/ai`, { enabled: false });
    expect(off.statusCode).toBe(200);
    expect(json(off)).toMatchObject({
      enabled: false,
      offReasons: ['platform'],
      switch: { enabled: false, by: 'platform' },
    });
    const entries = await audits('ai.org_switch');
    expect(entries.map((e) => [e.orgId, e.resourceType, e.resourceId, e.details])).toEqual([
      [
        ids['beispiel-gmbh'],
        'org',
        ids['beispiel-gmbh'],
        { enabled: true, by: 'platform', consentConfirmed: true },
      ],
      [
        ids['beispiel-gmbh'],
        'org',
        ids['beispiel-gmbh'],
        { enabled: false, by: 'platform', consentConfirmed: false },
      ],
    ]);
  });

  it('needs platform:org:write to switch and platform:org:read to read; customers get 403', async () => {
    expect(
      (await anna.request('PUT', `/admin/orgs/${ids['muster-ag']}/ai`, { enabled: false })).statusCode,
    ).toBe(403);
    expect((await anna.get(`/admin/orgs/${ids['muster-ag']}/ai`)).statusCode).toBe(403);
    expect((await admin.get(`/admin/orgs/00000000-0000-4000-8000-000000000000/ai`)).statusCode).toBe(404);
  });

  it('switching a customer on is allowed while its reseller is off; the card says it is capped', async () => {
    await setOrg('alpen-hosting', { aiEnabled: false, aiDisabledBy: 'platform' });
    const res = await admin.request('PUT', `/admin/orgs/${ids['baeckerei-huber']}/ai`, {
      enabled: true,
      consentConfirmed: true,
    });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({
      enabled: false,
      offReasons: ['parent'],
      switch: { enabled: true, by: null },
      reseller: { id: ids['alpen-hosting'], enabled: false },
    });
  });
});

describe('reseller switch (PUT /orgs/:orgId/customers/:customerId/ai)', () => {
  const path = () => `/orgs/${ids['alpen-hosting']}/customers/${ids['baeckerei-huber']}/ai`;

  it('switches its customer on with the consent and off again; two audit entries each', async () => {
    expect(json(await reto.get(path()))).toMatchObject({
      enabled: false,
      switch: { enabled: false, by: null },
    });
    const missing = await reto.request('PUT', path(), { enabled: true });
    expect(missing.statusCode).toBe(400);
    expect(json(missing).error.details).toEqual({ field: 'consentConfirmed' });

    const on = await reto.request('PUT', path(), { enabled: true, consentConfirmed: true });
    expect(on.statusCode).toBe(200);
    expect(json(on)).toMatchObject({ enabled: true, reseller: { id: ids['alpen-hosting'], enabled: true } });
    expect(json(on)).not.toHaveProperty('usageCostMicros');
    const off = await reto.request('PUT', path(), { enabled: false });
    expect(json(off)).toMatchObject({ enabled: false, offReasons: ['reseller'], switch: { by: 'reseller' } });

    const entries = await audits('ai.org_switch');
    expect(entries.map((e) => [e.orgId, e.resourceId, e.details])).toEqual([
      [
        ids['alpen-hosting'],
        ids['baeckerei-huber'],
        { enabled: true, by: 'reseller', consentConfirmed: true },
      ],
      [
        ids['baeckerei-huber'],
        ids['baeckerei-huber'],
        { enabled: true, by: 'reseller', consentConfirmed: true },
      ],
      [
        ids['alpen-hosting'],
        ids['baeckerei-huber'],
        { enabled: false, by: 'reseller', consentConfirmed: false },
      ],
      [
        ids['baeckerei-huber'],
        ids['baeckerei-huber'],
        { enabled: false, by: 'reseller', consentConfirmed: false },
      ],
    ]);
  });

  it('409 ai_platform_locked when weblion switched the customer off; switching off keeps the platform lock', async () => {
    await setOrg('baeckerei-huber', { aiEnabled: false, aiDisabledBy: 'platform' });
    const res = await reto.request('PUT', path(), { enabled: true, consentConfirmed: true });
    expect(res.statusCode).toBe(409);
    expect(json(res).error.code).toBe('ai_platform_locked');
    const off = await reto.request('PUT', path(), { enabled: false });
    expect(off.statusCode).toBe(200);
    expect((await org('baeckerei-huber')).aiDisabledBy).toBe('platform');
  });

  it("409 ai_reseller_blocked while the reseller's own AI is off or declined", async () => {
    await setOrg('alpen-hosting', { aiOptOutAt: new Date() });
    const declined = await reto.request('PUT', path(), { enabled: true, consentConfirmed: true });
    expect(declined.statusCode).toBe(409);
    expect(json(declined).error.code).toBe('ai_reseller_blocked');
    await setOrg('alpen-hosting', { aiOptOutAt: null, aiEnabled: false, aiDisabledBy: 'platform' });
    const off = await reto.request('PUT', path(), { enabled: true, consentConfirmed: true });
    expect(json(off).error.code).toBe('ai_reseller_blocked');
  });

  it('another reseller, a non-reseller and a foreign customer are 404; without reseller:customer:write 403', async () => {
    expect(
      (await reto.get(`/orgs/${ids['alpen-hosting']}/customers/${ids['muster-ag']}/ai`)).statusCode,
    ).toBe(404);
    expect(
      (await anna.get(`/orgs/${ids['muster-ag']}/customers/${ids['beispiel-gmbh']}/ai`)).statusCode,
    ).toBe(404);
    expect((await hanna.get(path())).statusCode).toBe(404);
  });

  it("a reseller that is off caps its customers' members and its own staff in the customer (chat 403)", async () => {
    await setOrg('baeckerei-huber', { aiEnabled: true });
    await setOrg('alpen-hosting', { aiEnabled: false, aiDisabledBy: 'platform' });
    for (const client of [hanna, reto]) {
      const res = await client.post(`/orgs/${ids['baeckerei-huber']}/ai/chat`, CHAT);
      expect(res.statusCode).toBe(403);
      expect(json(res).error).toMatchObject({ code: 'ai_org_disabled', details: { reasons: ['parent'] } });
    }
    await setOrg('alpen-hosting', { aiEnabled: true, aiDisabledBy: null });
    const ok = await hanna.post(`/orgs/${ids['baeckerei-huber']}/ai/chat`, CHAT);
    expect(ok.statusCode).toBe(200);
  });
});

describe("the customer's decline (PUT /orgs/:orgId/ai/decline)", () => {
  it('declines and allows again, audited, keeping the first decline', async () => {
    const res = await anna.request('PUT', `/orgs/${ids['muster-ag']}/ai/decline`, { declined: true });
    expect(res.statusCode).toBe(200);
    const annaId = (await t.db.query.users.findFirst({ where: eq(users.email, 'anna@muster.example') }))!.id;
    expect(json(res)).toMatchObject({
      enabled: false,
      offReasons: ['declined'],
      declined: { by: { id: annaId, name: 'Anna Muster' } },
    });
    const first = (await org('muster-ag')).aiOptOutAt;
    await anna.request('PUT', `/orgs/${ids['muster-ag']}/ai/decline`, { declined: true });
    expect((await org('muster-ag')).aiOptOutAt).toEqual(first);
    const allow = await anna.request('PUT', `/orgs/${ids['muster-ag']}/ai/decline`, { declined: false });
    expect(json(allow)).toMatchObject({ enabled: true, declined: null });
    expect((await audits('ai.org_decline')).map((e) => e.details)).toEqual([
      { declined: true },
      { declined: true },
    ]);
    expect(
      (await audits('ai.org_allow')).map((e) => [e.orgId, e.resourceType, e.resourceId, e.details]),
    ).toEqual([[ids['muster-ag'], 'org', ids['muster-ag'], { declined: false }]]);
  });

  it('members of a declined organization get 403 ai_org_disabled, staff too', async () => {
    await setOrg('muster-ag', { aiOptOutAt: new Date() });
    const member = await anna.post(`/orgs/${ids['muster-ag']}/ai/chat`, CHAT);
    expect(member.statusCode).toBe(403);
    expect(json(member).error).toMatchObject({ code: 'ai_org_disabled', details: { reasons: ['declined'] } });
    const staff = await admin.post(`/orgs/${ids['muster-ag']}/ai/chat`, CHAT);
    expect(staff.statusCode).toBe(403);
    expect(json(staff).error.code).toBe('ai_org_disabled');
    const [row] = await t.db.select().from(auditLogs).where(eq(auditLogs.orgId, ids['muster-ag']!)).limit(1);
    await t.db
      .insert(auditLogs)
      .values({ action: 'server.reboot', orgId: ids['muster-ag'], status: 'failure' });
    const entry =
      row ?? (await t.db.select().from(auditLogs).where(eq(auditLogs.orgId, ids['muster-ag']!)))[0]!;
    const explain = await admin.post('/admin/ai/explain', {
      source: { kind: 'audit', auditId: String(entry.id) },
      locale: 'de',
    });
    expect(explain.statusCode).toBe(403);
    expect(json(explain).error.code).toBe('ai_org_disabled');
    // The feature routes too.
    const feature = await anna.post(`/orgs/${ids['muster-ag']}/ai/explain`, {
      source: {
        kind: 'error',
        error: { status: 500, code: 'x', message: 'y' },
        page: { path: '/o/muster-ag', title: null },
      },
      locale: 'de',
    });
    expect(json(feature).error.code).toBe('ai_org_disabled');
  });

  it('works while the organization is suspended and while the platform AI is off', async () => {
    await setOrg('muster-ag', { status: 'suspended' });
    await t.ctx.ai.resetClient();
    const off = await admin.request('PUT', '/admin/ai/settings', {
      enabled: false,
      model: 'claude-opus-5-5',
      features: {
        assistant: true,
        explain: true,
        dns_check: true,
        audit_summary: true,
        server_health: true,
        product_texts: true,
        translations: true,
      },
      budgetUsd: 100,
      warnPercent: 80,
      dailyOrgLimit: 200,
      dailyUserLimit: 50,
    });
    expect(off.statusCode).toBe(200);
    try {
      const card = await anna.get(`/orgs/${ids['muster-ag']}/ai`);
      expect(card.statusCode).toBe(200);
      expect(json(card).platform).toMatchObject({ available: false, reason: 'disabled' });
      const decline = await anna.request('PUT', `/orgs/${ids['muster-ag']}/ai/decline`, { declined: true });
      expect(decline.statusCode).toBe(200);
      // None of the switch routes is 404 while AI is off (plan O27).
      expect((await admin.get(`/admin/orgs/${ids['muster-ag']}/ai`)).statusCode).toBe(200);
      expect(
        (
          await admin.request('PUT', `/admin/orgs/${ids['beispiel-gmbh']}/ai`, {
            enabled: true,
            consentConfirmed: true,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (await reto.get(`/orgs/${ids['alpen-hosting']}/customers/${ids['baeckerei-huber']}/ai`)).statusCode,
      ).toBe(200);
      // The features are 404 while the platform is off.
      expect((await anna.post(`/orgs/${ids['muster-ag']}/ai/chat`, CHAT)).statusCode).toBe(404);
    } finally {
      await admin.request('PUT', '/admin/ai/settings', {
        enabled: true,
        model: 'claude-opus-5-5',
        features: {
          assistant: true,
          explain: true,
          dns_check: true,
          audit_summary: true,
          server_health: true,
          product_texts: true,
          translations: true,
        },
        budgetUsd: 100,
        warnPercent: 80,
        dailyOrgLimit: 200,
        dailyUserLimit: 50,
      });
    }
  });

  it('needs ai:settings: a viewer gets 403, an outsider 404', async () => {
    const carla = new Client(t.app);
    await carla.login('carla@muster.example');
    expect((await carla.get(`/orgs/${ids['muster-ag']}/ai`)).statusCode).toBe(403);
    expect(
      (await carla.request('PUT', `/orgs/${ids['muster-ag']}/ai/decline`, { declined: true })).statusCode,
    ).toBe(403);
    expect((await dev.get(`/orgs/${ids['muster-ag']}/ai`)).statusCode).toBe(404);
  });
});

describe('usage counts', () => {
  it('count staff requests too; cost only for staff', async () => {
    const muster = ids['muster-ag']!;
    await t.db.insert(aiUsage).values([
      {
        feature: 'assistant',
        scope: 'org',
        orgId: muster,
        model: 'claude-opus-5-5',
        status: 'ok',
        costMicros: 1000,
      },
      {
        feature: 'explain',
        scope: 'staff',
        orgId: muster,
        model: 'claude-opus-5-5',
        status: 'ok',
        costMicros: 500,
      },
      {
        feature: 'explain',
        scope: 'org',
        orgId: ids['beispiel-gmbh'],
        model: 'claude-opus-5-5',
        status: 'ok',
      },
    ]);
    const card = json(await anna.get(`/orgs/${muster}/ai`));
    expect(card.usage).toMatchObject({ requests: 2, staffRequests: 1 });
    expect(card).not.toHaveProperty('usageCostMicros');
    const adminCard = json(await admin.get(`/admin/orgs/${muster}/ai`));
    expect(adminCard.usage).toMatchObject({ requests: 2, staffRequests: 1 });
    expect(adminCard.usageCostMicros).toBe(1500);
    const rows = await t.db
      .select()
      .from(aiUsage)
      .where(and(eq(aiUsage.orgId, muster), eq(aiUsage.scope, 'staff')));
    expect(rows).toHaveLength(1);
  });
});
