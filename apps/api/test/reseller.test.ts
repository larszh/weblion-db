import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import {
  DEFAULT_RESELLER_BOUNDARY,
  normalizeModules,
  type AdminOrgDto,
  type DomainDto,
  type OrgDto,
  type ResellerCustomerDto,
  type ServerDto,
  type WebspaceDto,
} from '@weblion/shared';
import {
  auditLogs,
  creditTransactions,
  invitations,
  invoices,
  mediaAccounts,
  mediaAllowances,
  memberships,
  monitors,
  organizations,
  payments,
  phoneSystems,
  providerConnections,
  services,
} from '../src/db/schema';
import { seedDemo } from '../src/db/seed';
import { ADMIN, Client, DEMO_PASSWORD, createTestApp, json, type TestApp } from './helpers';

let t: TestApp;
let admin: Client;
let reto: Client;
let hanna: Client;
let anna: Client;
/** Owner of the second reseller "Berg IT", created in the tests. */
let bea: Client;
let alpenId: string;
let huberId: string;
let musterOrgId: string;

interface Resources {
  servers: { id: string; name: string; projectId: string }[];
  domains: { id: string; name: string }[];
  webspaces: { id: string; name: string }[];
  pool: { servers: { id: string }[]; domains: { id: string }[]; webspaces: { id: string }[] };
}

const orgBySlug = async (slug: string) =>
  (await t.db.query.organizations.findFirst({ where: eq(organizations.slug, slug) }))!;

/** Creates a user with an initial password through the admin API and logs in. */
async function staffClient(email: string, orgId: string, orgRole = 'owner') {
  const created = json<{ initialPassword: string }>(
    await admin.post('/admin/users', { email, name: email.split('@')[0], orgId, orgRole }),
  );
  const client = new Client(t.app);
  await client.login(email, created.initialPassword);
  return client;
}

beforeAll(async () => {
  t = await createTestApp();
  admin = new Client(t.app);
  await admin.login(ADMIN.email, ADMIN.password);
  reto = new Client(t.app);
  await reto.login('reseller@alpen.example');
  hanna = new Client(t.app);
  await hanna.login('huber@baeckerei.example');
  anna = new Client(t.app);
  await anna.login('anna@muster.example');
  alpenId = (await orgBySlug('alpen-hosting')).id;
  huberId = (await orgBySlug('baeckerei-huber')).id;
  musterOrgId = (await orgBySlug('muster-ag')).id;
});

afterAll(async () => {
  await t?.close();
});

describe('seed', () => {
  it('creates the reseller Alpen Hosting with the customer Bäckerei Huber', async () => {
    const resellers = json<AdminOrgDto[]>(await admin.get('/admin/orgs?kind=reseller'));
    const alpen = resellers.find((o) => o.id === alpenId)!;
    expect(alpen).toMatchObject({
      name: 'Alpen Hosting',
      kind: 'reseller',
      modules: ['servers', 'dns', 'webhosting', 'mail'],
      parent: null,
      counts: { customers: 1 },
      boundary: DEFAULT_RESELLER_BOUNDARY,
    });
    const children = json<AdminOrgDto[]>(await admin.get(`/admin/orgs?parentOrgId=${alpenId}`));
    expect(children.map((o) => o.slug)).toEqual(['baeckerei-huber']);
    expect(children[0]).toMatchObject({
      kind: 'customer',
      modules: ['servers', 'dns', 'mail'],
      parent: { id: alpenId, slug: 'alpen-hosting' },
      counts: { servers: 1, projects: 1 },
    });
    // Still one unassigned demo server left for the admin inventory.
    expect(json<unknown[]>(await admin.get('/admin/servers?assigned=no')).length).toBeGreaterThan(0);
    const stats = json<{ organizations: Record<string, number> }>(await admin.get('/admin/stats'));
    expect(stats.organizations).toMatchObject({ resellers: 1, internal: 1 });
  });

  it('leaves spare servers alone when it runs again', async () => {
    const spare = async () =>
      json<{ id: string }[]>(await admin.get('/admin/servers?assigned=no')).map((s) => s.id);
    const before = await spare();
    await seedDemo(t.db, DEMO_PASSWORD);
    expect(await spare()).toEqual(before);
  });
});

describe('customers', () => {
  it('lists the reseller’s customers with counts and money', async () => {
    const list = json<ResellerCustomerDto[]>(await reto.get(`/orgs/${alpenId}/customers`));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: huberId,
      name: 'Bäckerei Huber',
      slug: 'baeckerei-huber',
      status: 'active',
      suspendedBy: null,
      modules: ['servers', 'dns', 'mail'],
      counts: { servers: 1, domains: 1, members: 1 },
      currency: 'CHF',
    });
    expect(typeof list[0]!.balance).toBe('number');
    expect(list[0]!.openTotal).toBeGreaterThanOrEqual(0);
    expect(json(await reto.get(`/orgs/${alpenId}/customers/${huberId}`))).toMatchObject({ id: huberId });
  });

  it('creates a customer with an owner invitation, never attaching existing accounts', async () => {
    const res = await reto.post(`/orgs/${alpenId}/customers`, {
      name: 'Metzgerei Gut',
      ownerEmail: 'anna@muster.example',
      modules: ['servers', 'dns'],
      notes: 'Neukunde',
    });
    expect(res.statusCode).toBe(200);
    const body = json<{ customer: ResellerCustomerDto; inviteLink: string; mail: { status: string } }>(res);
    expect(body.customer).toMatchObject({
      name: 'Metzgerei Gut',
      slug: 'metzgerei-gut',
      modules: ['servers', 'dns'],
      notes: 'Neukunde',
      counts: { projects: 1, members: 0 },
    });
    expect(body.inviteLink).toContain('/invite/');
    expect(body.mail).toEqual({ status: 'skipped', error: 'SMTP is not configured' });
    // Anna has an account, but is only invited, not added.
    const members = await t.db.select().from(memberships).where(eq(memberships.orgId, body.customer.id));
    expect(members).toHaveLength(0);
    const invites = await t.db.select().from(invitations).where(eq(invitations.orgId, body.customer.id));
    expect(invites).toMatchObject([{ email: 'anna@muster.example', role: 'owner' }]);

    const org = await orgBySlug('metzgerei-gut');
    expect(org).toMatchObject({ kind: 'customer', parentOrgId: alpenId });
    const audit = await t.db.query.auditLogs.findFirst({
      where: eq(auditLogs.action, 'reseller.customer_create'),
    });
    expect(audit).toMatchObject({ orgId: alpenId, resourceId: org.id });

    // Without modules the customer gets the defaults.
    const plain = json<{ customer: ResellerCustomerDto; inviteLink: null; mail: null }>(
      await reto.post(`/orgs/${alpenId}/customers`, { name: 'Ohne Owner GmbH' }),
    );
    expect(plain).toMatchObject({ customer: { modules: ['servers'] }, inviteLink: null, mail: null });
  });

  it('updates a customer', async () => {
    const res = await reto.patch(`/orgs/${alpenId}/customers/${huberId}`, {
      notes: 'Stammkunde seit 2020',
      modules: ['servers', 'dns', 'webhosting'],
    });
    expect(json<ResellerCustomerDto>(res)).toMatchObject({
      notes: 'Stammkunde seit 2020',
      modules: ['servers', 'dns', 'webhosting'],
    });
    await reto.patch(`/orgs/${alpenId}/customers/${huberId}`, { modules: ['servers', 'dns', 'mail'] });
    // Not a module at all, and a module the reseller does not have itself.
    expect(
      (await reto.patch(`/orgs/${alpenId}/customers/${huberId}`, { modules: ['jukebox'] })).statusCode,
    ).toBe(400);
    expect(
      (await reto.patch(`/orgs/${alpenId}/customers/${huberId}`, { modules: ['storage'] })).statusCode,
    ).toBe(409);
  });

  it('opens a customer through the reseller and operates its servers', async () => {
    const org = json<OrgDto>(await reto.get('/orgs/by-slug/baeckerei-huber'));
    expect(org).toMatchObject({ id: huberId, access: 'reseller', role: null, parent: { id: alpenId } });
    expect(org.permissions).toEqual(expect.arrayContaining(['server:read', 'server:power', 'member:invite']));
    const servers = json<ServerDto[]>(await reto.get(`/orgs/${huberId}/servers`));
    expect(servers).toHaveLength(1);
    expect(servers[0]!.permissions).toContain('server:power');
    expect(servers[0]!.permissions).not.toContain('server:delete');
    expect((await reto.post(`/servers/${servers[0]!.id}/power`, { action: 'reboot' })).statusCode).toBe(200);
  });

  it('hides other customers and resellers', async () => {
    expect((await reto.get(`/orgs/${musterOrgId}`)).statusCode).toBe(404);
    expect((await reto.get('/orgs/by-slug/muster-ag')).statusCode).toBe(404);
    expect((await reto.get(`/orgs/${alpenId}/customers/${musterOrgId}`)).statusCode).toBe(404);
    expect((await reto.get(`/orgs/${musterOrgId}/customers`)).statusCode).toBe(404);
    const musterServers = json<ServerDto[]>(await admin.get(`/orgs/${musterOrgId}/servers`));
    expect((await reto.get(`/servers/${musterServers[0]!.id}`)).statusCode).toBe(404);

    // A second reseller sees neither Alpen's customers nor Alpen itself.
    const berg = json<AdminOrgDto>(
      await admin.post('/admin/orgs', { name: 'Berg IT', kind: 'reseller', modules: ['servers'] }),
    );
    expect(berg).toMatchObject({
      kind: 'reseller',
      modules: ['servers'],
      boundary: DEFAULT_RESELLER_BOUNDARY,
    });
    bea = await staffClient('bea@berg.example', berg.id);
    expect(json(await bea.get(`/orgs/${berg.id}/customers`))).toEqual([]);
    expect((await bea.get(`/orgs/${huberId}`)).statusCode).toBe(404);
    expect((await bea.get(`/orgs/${alpenId}/customers`)).statusCode).toBe(404);
    expect((await bea.get(`/orgs/${berg.id}/customers/${huberId}`)).statusCode).toBe(404);
    expect((await bea.patch(`/orgs/${berg.id}/customers/${huberId}`, { name: 'Gekapert' })).statusCode).toBe(
      404,
    );
  });

  it('only hands out modules the reseller has', async () => {
    const berg = await orgBySlug('berg-it');
    const refused = await bea.post(`/orgs/${berg.id}/customers`, {
      name: 'Zu Viel AG',
      modules: ['servers', 'dns'],
    });
    expect(refused.statusCode).toBe(409);
    expect(json(refused).error.message).toContain('dns');
    const ok = json<{ customer: ResellerCustomerDto }>(
      await bea.post(`/orgs/${berg.id}/customers`, { name: 'Tal AG' }),
    );
    expect(ok.customer.modules).toEqual(['servers']);
    expect(
      (
        await bea.patch(`/orgs/${berg.id}/customers/${ok.customer.id}`, {
          modules: ['servers', 'webhosting'],
        })
      ).statusCode,
    ).toBe(409);
  });

  it('keeps customer owners out of the reseller', async () => {
    const org = json<OrgDto>(await hanna.get(`/orgs/${huberId}`));
    expect(org).toMatchObject({
      access: 'member',
      role: 'owner',
      parent: { id: alpenId, name: 'Alpen Hosting' },
    });
    expect(org.permissions).not.toContain('reseller:customer:read');
    expect((await hanna.get(`/orgs/${alpenId}`)).statusCode).toBe(404);
    expect((await hanna.get(`/orgs/${alpenId}/customers`)).statusCode).toBe(404);
    expect((await hanna.get(`/orgs/${huberId}/customers`)).statusCode).toBe(404);
    expect((await hanna.post(`/orgs/${huberId}/customers`, { name: 'Sub AG' })).statusCode).toBe(404);
    expect((await anna.get(`/orgs/${alpenId}/customers`)).statusCode).toBe(404);
  });

  it('makes the customers of a suspended reseller read only', async () => {
    const [server] = json<ServerDto[]>(await reto.get(`/orgs/${huberId}/servers`));
    const power = (c: Client) => c.post(`/servers/${server!.id}/power`, { action: 'reboot' });
    expect((await admin.patch(`/admin/orgs/${alpenId}`, { status: 'suspended' })).statusCode).toBe(200);
    try {
      // The customer's own members can still look, but not change anything.
      expect((await hanna.get(`/orgs/${huberId}/servers`)).statusCode).toBe(200);
      expect((await power(hanna)).statusCode).toBe(403);
      // The reseller keeps its customer list and still looks into its customers, but can't
      // operate or create anything.
      expect((await reto.get(`/orgs/${alpenId}/customers`)).statusCode).toBe(200);
      expect(json<OrgDto>(await reto.get(`/orgs/${huberId}`))).toMatchObject({ access: 'reseller' });
      expect(json<ServerDto[]>(await reto.get(`/orgs/${huberId}/servers`))).toHaveLength(1);
      expect((await power(reto)).statusCode).toBe(403);
      expect((await reto.post(`/orgs/${alpenId}/customers`, { name: 'Gesperrt AG' })).statusCode).toBe(403);
      expect(
        (await reto.patch(`/orgs/${alpenId}/customers/${huberId}`, { notes: 'gesperrt' })).statusCode,
      ).toBe(403);
      // Its billing:* is for paying its own bills: in the customer it only reads.
      const profile = await reto.get(`/orgs/${huberId}/billing/profile`);
      expect(profile.statusCode).toBe(200);
      expect(
        (await reto.request('PUT', `/orgs/${huberId}/billing/profile`, { companyName: 'Gesperrt AG' }))
          .statusCode,
      ).toBe(403);
    } finally {
      await admin.patch(`/admin/orgs/${alpenId}`, { status: 'active' });
    }
    expect((await power(hanna)).statusCode).toBe(200);
    expect((await power(reto)).statusCode).toBe(200);

    // The reseller can suspend a customer itself.
    expect(
      json(await reto.patch(`/orgs/${alpenId}/customers/${huberId}`, { status: 'suspended' })),
    ).toMatchObject({ status: 'suspended', suspendedBy: 'reseller' });
    expect((await power(hanna)).statusCode).toBe(403);
    expect((await power(reto)).statusCode).toBe(403);
    expect(
      json(await reto.patch(`/orgs/${alpenId}/customers/${huberId}`, { status: 'active' })),
    ).toMatchObject({
      status: 'active',
    });
    expect((await power(hanna)).statusCode).toBe(200);
  });

  it('keeps a platform suspension out of the reseller’s hands', async () => {
    const customer = () => reto.get(`/orgs/${alpenId}/customers/${huberId}`);
    const setStatus = (status: string) => reto.patch(`/orgs/${alpenId}/customers/${huberId}`, { status });
    expect(
      json<AdminOrgDto>(await admin.patch(`/admin/orgs/${huberId}`, { status: 'suspended' })),
    ).toMatchObject({ status: 'suspended', suspendedBy: 'platform' });
    try {
      expect(json<ResellerCustomerDto>(await customer())).toMatchObject({
        status: 'suspended',
        suspendedBy: 'platform',
      });
      expect(json<OrgDto>(await hanna.get(`/orgs/${huberId}`))).toMatchObject({ suspendedBy: 'platform' });
      for (const status of ['active', 'suspended']) {
        const res = await setStatus(status);
        expect(res.statusCode).toBe(409);
        expect(json(res).error.message).toContain('Only weblion.one');
      }
      expect(await orgBySlug('baeckerei-huber')).toMatchObject({
        status: 'suspended',
        suspendedBy: 'platform',
      });
      // Everything else stays the reseller's to change.
      expect(
        (await reto.patch(`/orgs/${alpenId}/customers/${huberId}`, { notes: 'Stammkunde seit 2020' }))
          .statusCode,
      ).toBe(200);
    } finally {
      // Staff lift it, whoever set it.
      expect(
        json<AdminOrgDto>(await admin.patch(`/admin/orgs/${huberId}`, { status: 'active' })),
      ).toMatchObject({ status: 'active', suspendedBy: null });
    }

    // Staff see a reseller suspension as such, and can take it over.
    expect(json(await setStatus('suspended'))).toMatchObject({ suspendedBy: 'reseller' });
    expect(json<AdminOrgDto>(await admin.get(`/admin/orgs/${huberId}`))).toMatchObject({
      suspendedBy: 'reseller',
    });
    await admin.patch(`/admin/orgs/${huberId}`, { status: 'suspended' });
    expect((await setStatus('active')).statusCode).toBe(409);
    await admin.patch(`/admin/orgs/${huberId}`, { status: 'active' });
    expect(json(await customer())).toMatchObject({ status: 'active', suspendedBy: null });
  });

  it('lets reseller staff manage the members of their customers', async () => {
    // Created without an owner: the reseller invites one.
    const empty = await orgBySlug('ohne-owner-gmbh');
    const invite = (c: Client, role: string) =>
      c.post(`/orgs/${empty.id}/invitations`, { email: `${role}@ohne-owner.example`, role });
    const owner = await invite(reto, 'owner');
    expect(owner.statusCode, owner.body).toBe(200);
    // A reseller admin hands out roles below its own, like an admin member does.
    const alpenAdmin = await staffClient('admin@alpen.example', alpenId, 'admin');
    expect((await invite(alpenAdmin, 'owner')).statusCode).toBe(403);
    expect((await invite(alpenAdmin, 'member')).statusCode).toBe(200);

    // Changing and removing a member of a customer.
    await admin.post('/admin/users', {
      email: 'verkauf@baeckerei.example',
      name: 'Verkauf',
      orgId: huberId,
      orgRole: 'member',
    });
    const members = json<{ membershipId: string; email: string }[]>(
      await reto.get(`/orgs/${huberId}/members`),
    );
    const member = members.find((m) => m.email === 'verkauf@baeckerei.example')!;
    const changed = await reto.patch(`/orgs/${huberId}/members/${member.membershipId}`, { role: 'viewer' });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(json(changed)).toMatchObject({ role: 'viewer' });
    expect((await reto.del(`/orgs/${huberId}/members/${member.membershipId}`)).statusCode).toBe(200);
  });

  it('lets a reseller API token reach its customers but no platform routes', async () => {
    const created = json<{ token: string }>(
      await reto.post(`/orgs/${alpenId}/tokens`, { name: 'Automation', scope: 'read_write' }),
    );
    const bot = new Client(t.app);
    bot.bearer = created.token;
    expect(json<ResellerCustomerDto[]>(await bot.get(`/orgs/${alpenId}/customers`)).length).toBeGreaterThan(
      0,
    );
    const servers = json<ServerDto[]>(await bot.get(`/orgs/${huberId}/servers`));
    expect(servers).toHaveLength(1);
    expect((await bot.post(`/servers/${servers[0]!.id}/power`, { action: 'reboot' })).statusCode).toBe(200);
    expect((await bot.get(`/orgs/${musterOrgId}`)).statusCode).toBe(404);
    expect((await bot.get('/admin/orgs')).statusCode).toBe(403);
    expect((await bot.get('/admin/settings/mail')).statusCode).toBe(403);
    // Creating customers needs an interactive login.
    expect((await bot.post(`/orgs/${alpenId}/customers`, { name: 'Bot AG' })).statusCode).toBe(403);
  });
});

describe('admin organizations', () => {
  it('creates a reseller and moves a customer under it', async () => {
    const berg = await orgBySlug('berg-it');
    const kunde = json<AdminOrgDto>(await admin.post('/admin/orgs', { name: 'Seilbahn AG' }));
    expect(kunde).toMatchObject({ kind: 'customer', parent: null, modules: ['servers'] });
    const moved = json<AdminOrgDto>(await admin.patch(`/admin/orgs/${kunde.id}`, { parentOrgId: berg.id }));
    expect(moved.parent).toEqual({ id: berg.id, name: 'Berg IT', slug: 'berg-it' });
    expect(
      json<AdminOrgDto[]>(await admin.get(`/admin/orgs?parentOrgId=${berg.id}`)).map((o) => o.slug),
    ).toContain('seilbahn-ag');
    const bergDto = json<AdminOrgDto>(await admin.get(`/admin/orgs/${berg.id}`));
    expect(bergDto.counts.customers).toBe(2);

    // Created directly below a reseller.
    const child = json<AdminOrgDto>(
      await admin.post('/admin/orgs', { name: 'Gondel GmbH', parentOrgId: berg.id, modules: ['servers'] }),
    );
    expect(child.parent?.id).toBe(berg.id);
    // And moved back out again.
    expect(
      json<AdminOrgDto>(await admin.patch(`/admin/orgs/${child.id}`, { parentOrgId: null })).parent,
    ).toBeNull();
  });

  it('enforces the reseller rules', async () => {
    const berg = await orgBySlug('berg-it');
    const seilbahn = await orgBySlug('seilbahn-ag');
    // The parent must be a reseller, and only customers can have one.
    expect((await admin.patch(`/admin/orgs/${seilbahn.id}`, { parentOrgId: musterOrgId })).statusCode).toBe(
      409,
    );
    expect((await admin.patch(`/admin/orgs/${berg.id}`, { parentOrgId: alpenId })).statusCode).toBe(409);
    expect(
      (await admin.post('/admin/orgs', { name: 'Intern', kind: 'internal', parentOrgId: alpenId }))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await admin.post('/admin/orgs', {
          name: 'Unbekannt',
          parentOrgId: '00000000-0000-4000-8000-000000000000',
        })
      ).statusCode,
    ).toBe(400);
    expect((await admin.patch(`/admin/orgs/${seilbahn.id}`, { parentOrgId: seilbahn.id })).statusCode).toBe(
      409,
    );
    // A reseller with customers keeps its kind.
    expect((await admin.patch(`/admin/orgs/${berg.id}`, { kind: 'customer' })).statusCode).toBe(409);
    // Customers stay within the reseller's modules.
    expect(
      (await admin.patch(`/admin/orgs/${seilbahn.id}`, { modules: ['servers', 'dns'] })).statusCode,
    ).toBe(409);
  });

  it('resets the boundary when the kind changes', async () => {
    const org = json<AdminOrgDto>(await admin.post('/admin/orgs', { name: 'Wechsel AG' }));
    expect(org.boundary.some((s) => s.effect === 'deny' && s.actions.includes('reseller:*'))).toBe(true);
    const reseller = json<AdminOrgDto>(await admin.patch(`/admin/orgs/${org.id}`, { kind: 'reseller' }));
    expect(reseller).toMatchObject({ kind: 'reseller', boundary: DEFAULT_RESELLER_BOUNDARY });
    const custom = [{ effect: 'allow', actions: ['*'] }];
    const internal = json<AdminOrgDto>(
      await admin.patch(`/admin/orgs/${org.id}`, { kind: 'internal', boundary: custom }),
    );
    expect(internal).toMatchObject({ kind: 'internal', boundary: custom });
  });

  it('takes a module away from the customers when the reseller loses it', async () => {
    const berg = await orgBySlug('berg-it');
    const seilbahn = await orgBySlug('seilbahn-ag');
    await admin.patch(`/admin/orgs/${berg.id}`, { modules: ['servers', 'dns'] });
    await admin.patch(`/admin/orgs/${seilbahn.id}`, { modules: ['servers', 'dns'] });
    await admin.patch(`/admin/orgs/${berg.id}`, { modules: ['servers'] });
    expect((await orgBySlug('seilbahn-ag')).modules).toEqual(['servers']);
  });

  it('refuses a reseller change while billing is open with the current seller', async () => {
    const berg = await orgBySlug('berg-it');
    const org = json<AdminOrgDto>(await admin.post('/admin/orgs', { name: 'Kredit AG' }));
    const move = (parentOrgId: string | null) => admin.patch(`/admin/orgs/${org.id}`, { parentOrgId });
    const refused = async (parentOrgId: string | null, details: object) => {
      const res = await move(parentOrgId);
      expect(res.statusCode, res.body).toBe(409);
      expect(json(res).error.details).toEqual({
        balance: 0,
        currency: 'CHF',
        invoices: 0,
        payments: 0,
        services: 0,
        ...details,
      });
      return json(res).error.message as string;
    };

    // Credit from a top-up the platform received.
    const credit = (amount: number) =>
      t.db.insert(creditTransactions).values({
        orgId: org.id,
        amount,
        currency: 'CHF',
        type: amount > 0 ? 'topup' : 'adjustment',
        description: 'Test',
      });
    await credit(5000);
    expect(await refused(berg.id, { balance: 5000 })).toContain('credit balance of CHF');
    await credit(-5000);

    const [draft] = await t.db.insert(invoices).values({ orgId: org.id }).returning();
    await refused(berg.id, { invoices: 1 });
    await t.db.update(invoices).set({ status: 'void' }).where(eq(invoices.id, draft!.id));

    const [payment] = await t.db
      .insert(payments)
      .values({ orgId: org.id, provider: 'stripe', method: 'twint', amount: 10000, currency: 'CHF' })
      .returning();
    await refused(berg.id, { payments: 1 });
    await t.db.update(payments).set({ status: 'failed' }).where(eq(payments.id, payment!.id));

    const [service] = await t.db
      .insert(services)
      .values({
        orgId: org.id,
        name: 'Cloud Server S',
        unitPrice: 1900,
        interval: 'monthly',
        startsAt: '2026-01-01',
        status: 'suspended',
      })
      .returning();
    await refused(berg.id, { services: 1 });
    await t.db.update(services).set({ status: 'cancelled' }).where(eq(services.id, service!.id));

    // Settled: the move goes through, history stays.
    expect(json<AdminOrgDto>(await move(berg.id)).parent?.id).toBe(berg.id);
    // And the same in the other direction.
    await credit(1000);
    await refused(null, { balance: 1000 });
    expect((await orgBySlug('kredit-ag')).parentOrgId).toBe(berg.id);
  });
});

describe('delete protection', () => {
  it('refuses to delete organizations with anything attached', async () => {
    const reseller = await admin.del(`/admin/orgs/${alpenId}`);
    expect(reseller.statusCode).toBe(409);
    expect(json(reseller).error.message).toMatch(/\d+ customers/);
    const huber = await admin.del(`/admin/orgs/${huberId}`);
    expect(huber.statusCode).toBe(409);
    expect(json(huber).error.message).toMatch(/server/);
    expect(json(huber).error.details).toMatchObject({ servers: 1, domains: 1 });
    expect((await reto.del(`/orgs/${alpenId}/customers/${huberId}`)).statusCode).toBe(409);

    const empty = await orgBySlug('ohne-owner-gmbh');
    expect((await reto.del(`/orgs/${alpenId}/customers/${empty.id}`)).statusCode).toBe(200);
    expect(
      await t.db.query.organizations.findFirst({ where: eq(organizations.id, empty.id) }),
    ).toBeUndefined();
    const wechsel = await orgBySlug('wechsel-ag');
    expect((await admin.del(`/admin/orgs/${wechsel.id}`)).statusCode).toBe(200);
  });

  it('refuses to delete a provider whose domains are assigned', async () => {
    const provider = json<{ id: string }>(
      await admin.post('/admin/providers', {
        type: 'demo',
        name: 'Second demo',
        location: { country: 'CH', label: 'Test' },
        config: { servers: 1 },
      }),
    );
    await admin.post(`/admin/providers/${provider.id}/sync`);
    const domains = json<DomainDto[]>(await admin.get(`/admin/domains?providerId=${provider.id}`));
    expect(domains.length).toBeGreaterThan(0);
    await admin.post(`/admin/domains/${domains[0]!.id}/assign`, { orgId: musterOrgId, enableModule: false });
    const refused = await admin.del(`/admin/providers/${provider.id}`);
    expect(refused.statusCode).toBe(409);
    expect(json(refused).error.message).toContain('domains and web spaces');
    await admin.post(`/admin/domains/${domains[0]!.id}/assign`, { orgId: null });
    expect((await admin.del(`/admin/providers/${provider.id}`)).statusCode).toBe(200);
  });
});

describe('resource moves', () => {
  let metzgereiId: string;
  let alpenPool: Resources['pool'];

  beforeAll(async () => {
    metzgereiId = (await orgBySlug('metzgerei-gut')).id;
    // Give the reseller a server, a domain and a web space of its own.
    const [freeServer] = json<{ id: string }[]>(await admin.get('/admin/servers?assigned=no'));
    const alpenDetail = json<{ projects: { id: string }[] }>(await admin.get(`/admin/orgs/${alpenId}`));
    await admin.post(`/admin/servers/${freeServer!.id}/assign`, { projectId: alpenDetail.projects[0]!.id });
    const [freeDomain] = json<DomainDto[]>(await admin.get('/admin/domains?assigned=false&q=alpenblick'));
    await admin.post(`/admin/domains/${freeDomain!.id}/assign`, { orgId: alpenId });
    const [freeWebspace] = json<WebspaceDto[]>(await admin.get('/admin/webspaces?assigned=false'));
    await admin.post(`/admin/webspaces/${freeWebspace!.id}/assign`, { orgId: alpenId });
    alpenPool = json<Resources>(await reto.get(`/orgs/${alpenId}/customers/${metzgereiId}/resources`)).pool;
  });

  it('lists what the customer and the reseller hold', async () => {
    const huber = json<Resources>(await reto.get(`/orgs/${alpenId}/customers/${huberId}/resources`));
    expect(huber.servers).toHaveLength(1);
    expect(huber.domains.map((d) => d.name)).toEqual(['baeckerei-huber.ch']);
    expect(huber.webspaces).toEqual([]);
    expect(alpenPool.servers).toHaveLength(1);
    expect(alpenPool.domains).toHaveLength(1);
    expect(alpenPool.webspaces).toHaveLength(1);
    expect((await hanna.get(`/orgs/${alpenId}/customers/${huberId}/resources`)).statusCode).toBe(404);
  });

  it('moves resources from the pool to a customer and switches modules on', async () => {
    const move = (customerId: string, body: object) =>
      reto.post(`/orgs/${alpenId}/customers/${customerId}/resources`, body);
    expect((await move(metzgereiId, { type: 'server', id: alpenPool.servers[0]!.id })).statusCode).toBe(200);
    expect((await move(huberId, { type: 'webspace', id: alpenPool.webspaces[0]!.id })).statusCode).toBe(200);
    expect((await move(metzgereiId, { type: 'domain', id: alpenPool.domains[0]!.id })).statusCode).toBe(200);

    const metzgerei = json<Resources>(await reto.get(`/orgs/${alpenId}/customers/${metzgereiId}/resources`));
    expect(metzgerei.servers).toHaveLength(1);
    expect(metzgerei.domains).toHaveLength(1);
    expect(metzgerei.pool).toEqual({
      servers: [],
      domains: [],
      webspaces: [],
      mailDomains: [{ id: expect.any(String), name: 'alpen-hosting.ch' }],
      phoneSystems: [],
      monitors: [],
    });
    // Huber had no web hosting yet: moving a web space switched it on.
    expect((await orgBySlug('baeckerei-huber')).modules).toEqual(['servers', 'dns', 'webhosting', 'mail']);
    expect(json<WebspaceDto[]>(await hanna.get(`/orgs/${huberId}/webspaces`))).toHaveLength(1);

    // From one customer to a sibling, into a given project.
    const huberServer = json<Resources>(await reto.get(`/orgs/${alpenId}/customers/${huberId}/resources`))
      .servers[0]!;
    const metzgereiProject = metzgerei.servers[0]!.projectId;
    expect(
      (await move(metzgereiId, { type: 'server', id: huberServer.id, projectId: metzgereiProject }))
        .statusCode,
    ).toBe(200);
    expect(json<ServerDto[]>(await hanna.get(`/orgs/${huberId}/servers`))).toHaveLength(0);
    // Projects of other organizations are not a target.
    const huberProject = huberServer.projectId;
    expect(
      (await move(metzgereiId, { type: 'server', id: huberServer.id, projectId: huberProject })).statusCode,
    ).toBe(404);

    // Back to Huber for the rest of the suite (into its first project).
    expect((await move(huberId, { type: 'server', id: huberServer.id })).statusCode).toBe(200);
    const audit = await t.db.query.auditLogs.findFirst({
      where: eq(auditLogs.action, 'reseller.resource_assign'),
    });
    expect(audit).toMatchObject({ orgId: alpenId });
  });

  it('refuses resources outside the reseller', async () => {
    const move = (body: object) => reto.post(`/orgs/${alpenId}/customers/${huberId}/resources`, body);
    const musterServers = json<ServerDto[]>(await admin.get(`/orgs/${musterOrgId}/servers`));
    expect((await move({ type: 'server', id: musterServers[0]!.id })).statusCode).toBe(404);
    const musterDomains = json<DomainDto[]>(await admin.get(`/orgs/${musterOrgId}/domains`));
    expect((await move({ type: 'domain', id: musterDomains[0]!.id })).statusCode).toBe(404);
    expect((await move({ type: 'printer', id: musterDomains[0]!.id })).statusCode).toBe(400);
    // Hanna is no reseller staff.
    expect(
      (
        await hanna.post(`/orgs/${alpenId}/customers/${huberId}/resources`, {
          type: 'server',
          id: musterServers[0]!.id,
        })
      ).statusCode,
    ).toBe(404);
  });

  it('refuses modules the reseller does not have', async () => {
    const berg = await orgBySlug('berg-it');
    const tal = await orgBySlug('tal-ag');
    // Berg IT only has servers: a web space it holds can't go to a customer.
    const [freeWebspace] = json<WebspaceDto[]>(await admin.get('/admin/webspaces?assigned=false'));
    await admin.post(`/admin/webspaces/${freeWebspace!.id}/assign`, { orgId: berg.id, enableModule: false });
    const res = await bea.post(`/orgs/${berg.id}/customers/${tal.id}/resources`, {
      type: 'webspace',
      id: freeWebspace!.id,
    });
    expect(res.statusCode).toBe(409);
    expect(json(res).error.message).toContain('webhosting');
  });

  it('releases resources back to the reseller', async () => {
    const metzgerei = json<Resources>(await reto.get(`/orgs/${alpenId}/customers/${metzgereiId}/resources`));
    const release = (body: object) =>
      reto.post(`/orgs/${alpenId}/customers/${metzgereiId}/resources/release`, body);
    expect((await release({ type: 'server', id: metzgerei.servers[0]!.id })).statusCode).toBe(200);
    expect((await release({ type: 'domain', id: metzgerei.domains[0]!.id })).statusCode).toBe(200);
    // Not (or no longer) the customer's.
    expect((await release({ type: 'domain', id: metzgerei.domains[0]!.id })).statusCode).toBe(404);
    const after = json<Resources>(await reto.get(`/orgs/${alpenId}/customers/${metzgereiId}/resources`));
    expect(after.servers).toEqual([]);
    expect(after.pool.servers).toHaveLength(1);
    expect(after.pool.domains).toHaveLength(1);
    // Now the empty customer can be deleted again.
    expect((await reto.del(`/orgs/${alpenId}/customers/${metzgereiId}`)).statusCode).toBe(200);
  });

  it('keeps resources a service bills for where they are', async () => {
    const huber = json<Resources>(await reto.get(`/orgs/${alpenId}/customers/${huberId}/resources`));
    const server = huber.servers[0]!;
    const domain = huber.domains[0]!;
    const linked = await t.db
      .insert(services)
      .values([
        {
          orgId: huberId,
          name: 'Cloud Server S',
          resourceType: 'server' as const,
          resourceId: server.id,
          unitPrice: 1900,
          interval: 'monthly' as const,
          startsAt: '2026-01-01',
        },
        {
          orgId: huberId,
          name: 'Domain baeckerei-huber.ch',
          resourceType: 'domain' as const,
          resourceId: domain.id,
          unitPrice: 1500,
          interval: 'yearly' as const,
          startsAt: '2026-01-01',
        },
      ])
      .returning();
    const release = (body: object) =>
      reto.post(`/orgs/${alpenId}/customers/${huberId}/resources/release`, body);
    const sibling = json<{ customer: ResellerCustomerDto }>(
      await reto.post(`/orgs/${alpenId}/customers`, { name: 'Konditorei Süss' }),
    ).customer;

    const refused = await release({ type: 'server', id: server.id });
    expect(refused.statusCode).toBe(409);
    expect(json(refused).error.message).toContain('"Cloud Server S"');
    expect((await release({ type: 'domain', id: domain.id })).statusCode).toBe(409);
    expect(
      (
        await reto.post(`/orgs/${alpenId}/customers/${sibling.id}/resources`, {
          type: 'server',
          id: server.id,
        })
      ).statusCode,
    ).toBe(409);
    // Staff assignments to another organization are held back as well.
    const alpenProject = json<{ projects: { id: string }[] }>(await admin.get(`/admin/orgs/${alpenId}`))
      .projects[0]!.id;
    expect(
      (await admin.post(`/admin/servers/${server.id}/assign`, { projectId: alpenProject })).statusCode,
    ).toBe(409);
    expect((await admin.post(`/admin/servers/${server.id}/assign`, { projectId: null })).statusCode).toBe(
      409,
    );
    // Within the organization it can still move between projects.
    expect(
      (await admin.post(`/admin/servers/${server.id}/assign`, { projectId: server.projectId })).statusCode,
    ).toBe(200);

    // Once the services are cancelled, the resources move again.
    await t.db
      .update(services)
      .set({ status: 'cancelled' })
      .where(
        inArray(
          services.id,
          linked.map((s) => s.id),
        ),
      );
    expect((await release({ type: 'server', id: server.id })).statusCode).toBe(200);
    expect(
      (await reto.post(`/orgs/${alpenId}/customers/${huberId}/resources`, { type: 'server', id: server.id }))
        .statusCode,
    ).toBe(200);
    expect((await reto.del(`/orgs/${alpenId}/customers/${sibling.id}`)).statusCode).toBe(200);
  });

  it('hands on a resource the platform bills the reseller for', async () => {
    const resources = () => reto.get(`/orgs/${alpenId}/customers/${huberId}/resources`);
    const poolServer = json<Resources>(await resources()).pool.servers[0]!;
    const created = await admin.post(`/billing/customers/${alpenId}/services`, {
      name: 'Wholesale Server',
      unitPrice: 1200,
      interval: 'monthly',
      resourceType: 'server',
      resourceId: poolServer.id,
    });
    expect(created.statusCode, created.body).toBe(200);
    const wholesale = json<{ id: string }>(created);

    // The reseller keeps paying for it: to a customer and back is fine.
    const assign = await reto.post(`/orgs/${alpenId}/customers/${huberId}/resources`, {
      type: 'server',
      id: poolServer.id,
    });
    expect(assign.statusCode, assign.body).toBe(200);
    const atHuber = json<Resources>(await resources()).servers.find((s) => s.id === poolServer.id)!;
    expect(
      json<{ id: string; resource: { name: string | null } }[]>(
        await admin.get(`/billing/customers/${alpenId}/services`),
      ).find((s) => s.id === wholesale.id)!.resource,
    ).toMatchObject({ name: atHuber.name });
    const release = await reto.post(`/orgs/${alpenId}/customers/${huberId}/resources/release`, {
      type: 'server',
      id: poolServer.id,
    });
    expect(release.statusCode, release.body).toBe(200);

    // Staff may hand it to a customer of the reseller too, but not to anyone else.
    const huberProject = json<{ projects: { id: string }[] }>(await admin.get(`/admin/orgs/${huberId}`))
      .projects[0]!.id;
    const musterProject = json<{ projects: { id: string }[] }>(await admin.get(`/admin/orgs/${musterOrgId}`))
      .projects[0]!.id;
    expect(
      (await admin.post(`/admin/servers/${poolServer.id}/assign`, { projectId: huberProject })).statusCode,
    ).toBe(200);
    const elsewhere = await admin.post(`/admin/servers/${poolServer.id}/assign`, {
      projectId: musterProject,
    });
    expect(elsewhere.statusCode).toBe(409);
    expect(json(elsewhere).error.message).toContain('"Wholesale Server"');

    await admin.post(`/services/${wholesale.id}/cancel`, {});
    expect(
      (
        await reto.post(`/orgs/${alpenId}/customers/${huberId}/resources/release`, {
          type: 'server',
          id: poolServer.id,
        })
      ).statusCode,
    ).toBe(200);
  });
});

describe('phone systems', () => {
  it('hands a phone system from the pool to a customer and back', async () => {
    const demo = (await t.db.query.providerConnections.findFirst({
      where: eq(providerConnections.envKey, 'demo'),
    }))!;
    const [system] = await t.db
      .insert(phoneSystems)
      .values({ providerConnectionId: demo.id, externalId: 'test-pbx', name: 'Alpen PBX', orgId: alpenId })
      .returning();
    const id = system!.id;
    type PhoneResources = { phoneSystems: { id: string; name: string }[]; pool: { phoneSystems: unknown[] } };
    const resources = async () =>
      json<PhoneResources>(await reto.get(`/orgs/${alpenId}/customers/${huberId}/resources`));
    const move = () =>
      reto.post(`/orgs/${alpenId}/customers/${huberId}/resources`, { type: 'phone_system', id });
    expect((await resources()).pool.phoneSystems).toEqual([{ id, name: 'Alpen PBX' }]);

    // The reseller needs the module itself.
    const refused = await move();
    expect(refused.statusCode).toBe(409);
    expect(json(refused).error.message).toContain('phone');
    const alpen = await orgBySlug('alpen-hosting');
    await t.db
      .update(organizations)
      .set({ modules: normalizeModules([...alpen.modules, 'phone']) })
      .where(eq(organizations.id, alpenId));

    const handed = await move();
    expect(handed.statusCode, handed.body).toBe(200);
    expect((await orgBySlug('baeckerei-huber')).modules).toContain('phone');
    expect(await resources()).toMatchObject({
      phoneSystems: [{ id, name: 'Alpen PBX' }],
      pool: { phoneSystems: [] },
    });
    const customer = json<ResellerCustomerDto>(await reto.get(`/orgs/${alpenId}/customers/${huberId}`));
    expect(customer.counts.phoneSystems).toBe(1);
    const blocked = await admin.del(`/admin/orgs/${huberId}`);
    expect(blocked.statusCode).toBe(409);
    expect(json(blocked).error.details).toMatchObject({ phoneSystems: 1 });
    const audit = await t.db.query.auditLogs.findFirst({
      where: eq(auditLogs.resourceId, id),
    });
    expect(audit).toMatchObject({ action: 'reseller.resource_assign', resourceType: 'phone_system' });

    const released = await reto.post(`/orgs/${alpenId}/customers/${huberId}/resources/release`, {
      type: 'phone_system',
      id,
    });
    expect(released.statusCode, released.body).toBe(200);
    expect((await resources()).pool.phoneSystems).toEqual([{ id, name: 'Alpen PBX' }]);
    // Phone systems outside the reseller's reach do not exist for it.
    await t.db.update(phoneSystems).set({ orgId: musterOrgId }).where(eq(phoneSystems.id, id));
    expect((await move()).statusCode).toBe(404);
    await t.db.delete(phoneSystems).where(eq(phoneSystems.id, id));
  });
});

describe('monitors', () => {
  it('hands a monitor from the pool to a customer and back', async () => {
    const demo = (await t.db.query.providerConnections.findFirst({
      where: eq(providerConnections.envKey, 'demo'),
    }))!;
    const [monitor] = await t.db
      .insert(monitors)
      .values({
        providerConnectionId: demo.id,
        externalId: '9001',
        name: 'Alpen Website',
        providerName: 'Alpen Website',
        type: 'http',
        orgId: alpenId,
      })
      .returning();
    const id = monitor!.id;
    const item = { id, name: 'Alpen Website' };
    type MonitorResources = { monitors: { id: string; name: string }[]; pool: { monitors: unknown[] } };
    const resources = async () =>
      json<MonitorResources>(await reto.get(`/orgs/${alpenId}/customers/${huberId}/resources`));
    const move = () => reto.post(`/orgs/${alpenId}/customers/${huberId}/resources`, { type: 'monitor', id });
    const before = await resources();
    // Monitors the demo seed gave the customer count along.
    const held = before.monitors.length;
    expect(before.pool.monitors).toContainEqual(item);

    // The reseller needs the module itself (whether the demo seed gave it or not).
    const alpen = await orgBySlug('alpen-hosting');
    const withoutMonitoring = alpen.modules.filter((m) => m !== 'monitoring');
    await t.db.update(organizations).set({ modules: withoutMonitoring }).where(eq(organizations.id, alpenId));
    const refused = await move();
    expect(refused.statusCode).toBe(409);
    expect(json(refused).error.message).toContain('monitoring');
    await t.db
      .update(organizations)
      .set({ modules: normalizeModules([...withoutMonitoring, 'monitoring']) })
      .where(eq(organizations.id, alpenId));

    const handed = await move();
    expect(handed.statusCode, handed.body).toBe(200);
    expect((await orgBySlug('baeckerei-huber')).modules).toContain('monitoring');
    const after = await resources();
    expect(after.monitors).toContainEqual(item);
    expect(after.pool.monitors).not.toContainEqual(item);
    const customer = json<ResellerCustomerDto>(await reto.get(`/orgs/${alpenId}/customers/${huberId}`));
    expect(customer.counts.monitors).toBe(held + 1);
    const blocked = await admin.del(`/admin/orgs/${huberId}`);
    expect(blocked.statusCode).toBe(409);
    expect(json(blocked).error.details).toMatchObject({ monitors: held + 1 });
    const audit = await t.db.query.auditLogs.findFirst({ where: eq(auditLogs.resourceId, id) });
    expect(audit).toMatchObject({ action: 'reseller.resource_assign', resourceType: 'monitor' });

    const released = await reto.post(`/orgs/${alpenId}/customers/${huberId}/resources/release`, {
      type: 'monitor',
      id,
    });
    expect(released.statusCode, released.body).toBe(200);
    expect((await resources()).pool.monitors).toContainEqual(item);
    // Monitors outside the reseller's reach do not exist for it.
    await t.db.update(monitors).set({ orgId: musterOrgId }).where(eq(monitors.id, id));
    const outside = await move();
    expect(outside.statusCode).toBe(404);
    expect(json(outside).error.message).toMatch(/Monitor/);
    await t.db.delete(monitors).where(eq(monitors.id, id));
  });
});

describe('streaming', () => {
  it('counts streaming accounts and the streaming allowance as delete blockers', async () => {
    const org = json<AdminOrgDto>(await admin.post('/admin/orgs', { name: 'Stream AG' }));
    const demo = (await t.db.query.providerConnections.findFirst({
      where: eq(providerConnections.envKey, 'demo'),
    }))!;
    await t.db.insert(mediaAllowances).values({
      orgId: org.id,
      providerConnectionId: demo.id,
      accountCode: 'streamag',
      maxAccounts: 2,
      maxStreams: 1,
    });
    await t.db.insert(mediaAccounts).values({
      providerConnectionId: demo.id,
      externalId: 'f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0',
      username: 'kino-streamag',
      orgId: org.id,
    });
    const detail = json<AdminOrgDto>(await admin.get(`/admin/orgs/${org.id}`));
    expect(detail.counts?.mediaAccounts).toBe(1);

    const blocked = await admin.del(`/admin/orgs/${org.id}`);
    expect(blocked.statusCode).toBe(409);
    expect(json(blocked).error.details).toMatchObject({ mediaAccounts: 1, mediaAllowances: 1 });
    expect(json(blocked).error.message).toContain('1 streaming accounts');
    expect(json(blocked).error.message).toContain('1 streaming allowance');

    await t.db.delete(mediaAccounts).where(eq(mediaAccounts.orgId, org.id));
    await t.db.delete(mediaAllowances).where(eq(mediaAllowances.orgId, org.id));
    expect((await admin.del(`/admin/orgs/${org.id}`)).statusCode).toBe(200);
  });
});
