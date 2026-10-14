import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  DEFAULT_CUSTOMER_BOUNDARY,
  DEFAULT_RESELLER_BOUNDARY,
  type ModuleKey,
  type OrgKind,
  type WebsiteAllowanceDto,
} from '@weblion/shared';
import { seedWebsitesDemo } from '../src/db/seed-websites';
import {
  organizations,
  providerConnections,
  webspaceDatabases,
  webspaces,
  websiteAllowances,
  type Organization,
  type ProviderConnection,
} from '../src/db/schema';
import {
  committedDatabases,
  committedSites,
  lockWebsiteOrg,
  normalizeSiteTypes,
  websiteCommitments,
} from '../src/modules/hosting/website-allowance';
import { assertWebsiteMoveAllowed } from '../src/modules/hosting/website-service';
import { ADMIN, Client, createTestApp, json, type TestApp } from './helpers';

let t: TestApp;
let admin: Client;
let anna: Client;
let cp: ProviderConnection;
let other: ProviderConnection;
let muster: Organization;
let alpen: Organization;
let huber: Organization;

const put = (client: Client, url: string, body: unknown) => client.request('PUT', url, body);

async function orgBySlug(slug: string) {
  return (await t.db.query.organizations.findFirst({ where: eq(organizations.slug, slug) }))!;
}

async function newOrg(name: string, slug: string, options: { kind?: OrgKind; parentOrgId?: string } = {}) {
  const kind = options.kind ?? 'customer';
  const [org] = await t.db
    .insert(organizations)
    .values({
      name,
      slug,
      kind,
      boundary: kind === 'reseller' ? DEFAULT_RESELLER_BOUNDARY : DEFAULT_CUSTOMER_BOUNDARY,
      parentOrgId: options.parentOrgId ?? null,
      modules: ['servers', 'webhosting'] as ModuleKey[],
    })
    .returning();
  return org!;
}

async function setAllowance(orgId: string, body: Record<string, unknown>) {
  return put(admin, `/admin/orgs/${orgId}/website-allowance`, { providerId: cp.id, ...body });
}

beforeAll(async () => {
  t = await createTestApp({ env: { ENABLE_DEMO_CLOUDPANEL: 'true' } });
  admin = new Client(t.app);
  await admin.login(ADMIN.email, ADMIN.password);
  anna = new Client(t.app);
  await anna.login('anna@muster.example');
  cp = (await t.db.query.providerConnections.findFirst({
    where: eq(providerConnections.envKey, 'demo-cloudpanel'),
  }))!;
  await t.ctx.sync.syncConnection(cp);
  await seedWebsitesDemo(t.db, []);
  const [second] = await t.db
    .insert(providerConnections)
    .values({
      type: 'demo',
      name: 'CloudPanel Zwei',
      location: { country: 'CH', label: 'Zwei' },
      configEnc: t.ctx.box.encryptJson({ flavor: 'cloudpanel' }),
    })
    .returning();
  other = second!;
  muster = await orgBySlug('muster-ag');
  alpen = await orgBySlug('alpen-hosting');
  huber = await orgBySlug('baeckerei-huber');
});

afterAll(async () => {
  await t?.close();
});

describe('commitments', () => {
  it('counts own websites and databases of a customer on every instance and in every state', async () => {
    const usage = await websiteCommitments(t.db, muster, cp.id);
    expect(usage).toEqual({ sites: 3, databases: 2, customers: 0, customerSites: 0, customerDatabases: 0 });
    // A website being created, on another instance, holds its slot.
    const [row] = await t.db
      .insert(webspaces)
      .values({
        providerConnectionId: other.id,
        externalId: 'pending.muster-ag.ch',
        name: 'pending.muster-ag.ch',
        kind: 'website',
        status: 'creating',
        orgId: muster.id,
      })
      .returning();
    await t.db.insert(webspaceDatabases).values({
      webspaceId: row!.id,
      providerConnectionId: other.id,
      name: 'pending_db',
      status: 'creating',
    });
    // Web spaces of other providers never count.
    const counted = await websiteCommitments(t.db, muster, cp.id);
    expect(counted).toMatchObject({ sites: 4, databases: 3 });
    expect(committedSites(counted)).toBe(4);
    expect(committedDatabases(counted)).toBe(3);
    await t.db.delete(webspaces).where(eq(webspaces.id, row!.id));
  });

  it("counts a reseller's customers' maxima on its instance", async () => {
    const usage = await websiteCommitments(t.db, alpen, cp.id);
    expect(usage).toEqual({ sites: 0, databases: 0, customers: 1, customerSites: 3, customerDatabases: 5 });
    expect(committedSites(usage)).toBe(3);
    expect(await websiteCommitments(t.db, alpen, other.id)).toMatchObject({ customers: 0, customerSites: 0 });
    expect(await websiteCommitments(t.db, alpen, cp.id, huber.id)).toMatchObject({ customers: 0 });
    // Only resellers have customers' allowances counted.
    expect(await websiteCommitments(t.db, huber, cp.id)).toEqual({
      sites: 1,
      databases: 0,
      customers: 0,
      customerSites: 0,
      customerDatabases: 0,
    });
    const dto = json<WebsiteAllowanceDto>(await admin.get(`/admin/orgs/${alpen.id}/website-allowance`));
    expect(dto).toMatchObject({ maxSites: 20, maxDatabases: 40, sites: 3, databases: 5, customers: 1 });
  });

  it('keeps site types in their order without duplicates', () => {
    expect(normalizeSiteTypes(['nodejs', 'php', 'nodejs', 'python'])).toEqual(['php', 'nodejs']);
  });
});

describe('covering what is committed', () => {
  it('never goes below the websites and databases in use', async () => {
    const sites = await setAllowance(muster.id, { maxSites: 2, maxDatabases: 10, siteTypes: ['php'] });
    expect(sites.statusCode).toBe(409);
    expect(json(sites).error).toMatchObject({ code: 'allowance_exceeded', details: { sites: 3 } });
    const databases = await setAllowance(muster.id, { maxSites: 3, maxDatabases: 1, siteTypes: ['php'] });
    expect(json(databases).error).toMatchObject({ code: 'allowance_exceeded', details: { databases: 2 } });
    const exact = await setAllowance(muster.id, {
      maxSites: 3,
      maxDatabases: 2,
      siteTypes: ['static', 'php'],
    });
    expect(exact.statusCode, exact.body).toBe(200);
    expect(json(exact)).toMatchObject({ maxSites: 3, maxDatabases: 2, siteTypes: ['php', 'static'] });
    const audit = await t.db.query.auditLogs.findMany({
      where: (a, { eq: is }) => is(a.action, 'website.allowance_set'),
    });
    expect(audit.at(-1)?.details).toMatchObject({
      maxSites: 3,
      previous: { maxSites: 5, maxDatabases: 10, siteTypes: ['php', 'static', 'nodejs'] },
    });
    expect(
      (await setAllowance(muster.id, { maxSites: 5, maxDatabases: 10, siteTypes: ['php'] })).statusCode,
    ).toBe(200);
  });

  it("keeps a reseller's allowance above its customers' and their types within its own", async () => {
    const below = await setAllowance(alpen.id, {
      maxSites: 2,
      maxDatabases: 40,
      siteTypes: ['php', 'static'],
    });
    expect(json(below).error.code).toBe('allowance_exceeded');
    const types = await setAllowance(alpen.id, { maxSites: 20, maxDatabases: 40, siteTypes: ['php'] });
    expect(types.statusCode).toBe(409);
    expect(json(types).error).toMatchObject({ code: 'type_not_allowed', details: { types: ['static'] } });
    const moved = await put(admin, `/admin/orgs/${alpen.id}/website-allowance`, {
      providerId: other.id,
      maxSites: 20,
      maxDatabases: 40,
      siteTypes: ['php', 'static'],
    });
    expect(moved.statusCode).toBe(409);
    expect(json(moved).error.message).toContain('1 customers');
  });

  it("gives customers of a reseller their allowance out of the reseller's", async () => {
    const elsewhere = await put(admin, `/admin/orgs/${huber.id}/website-allowance`, {
      providerId: other.id,
      maxSites: 3,
      maxDatabases: 5,
      siteTypes: ['php'],
    });
    expect(elsewhere.statusCode).toBe(409);
    expect(json(elsewhere).error.message).toContain("reseller's instance Demo CloudPanel");
    const nodejs = await setAllowance(huber.id, {
      maxSites: 3,
      maxDatabases: 5,
      siteTypes: ['php', 'nodejs'],
    });
    expect(json(nodejs).error).toMatchObject({ code: 'type_not_allowed', details: { types: ['nodejs'] } });
    const tooMany = await setAllowance(huber.id, { maxSites: 21, maxDatabases: 5, siteTypes: ['php'] });
    expect(json(tooMany).error.message).toBe(
      'Only 20 websites of the allowance of Alpen Hosting are left for this customer',
    );
    const raised = await setAllowance(huber.id, { maxSites: 20, maxDatabases: 40, siteTypes: ['php'] });
    expect(raised.statusCode, raised.body).toBe(200);

    const reseller = await newOrg('Ohne Kontingent Reseller', 'ohne-reseller', { kind: 'reseller' });
    const customer = await newOrg('Kunde ohne', 'kunde-ohne', { parentOrgId: reseller.id });
    const none = await setAllowance(customer.id, { maxSites: 1, maxDatabases: 1, siteTypes: ['php'] });
    expect(json(none).error).toMatchObject({ code: 'no_allowance' });
    expect(json(none).error.message).toContain('Ohne Kontingent Reseller');
    expect(
      (await setAllowance(huber.id, { maxSites: 3, maxDatabases: 5, siteTypes: ['php', 'static'] }))
        .statusCode,
    ).toBe(200);
  });

  it('only lets staff set allowances on website instances', async () => {
    const demoMain = (await t.db.query.providerConnections.findFirst({
      where: eq(providerConnections.envKey, 'demo'),
    }))!;
    const plain = await put(admin, `/admin/orgs/${muster.id}/website-allowance`, {
      providerId: demoMain.id,
      maxSites: 5,
      maxDatabases: 10,
      siteTypes: ['php'],
    });
    expect(plain.statusCode).toBe(422);
    expect(
      (await setAllowance(muster.id, { maxSites: 5, maxDatabases: 10, siteTypes: ['php'] })).statusCode,
    ).toBe(200);
    expect(
      (
        await put(anna, `/admin/orgs/${muster.id}/website-allowance`, {
          providerId: cp.id,
          maxSites: 9,
          maxDatabases: 9,
          siteTypes: ['php'],
        })
      ).statusCode,
    ).toBe(403);
    expect((await anna.get(`/admin/orgs/${muster.id}/website-allowance`)).statusCode).toBe(403);
    const empty = await setAllowance(muster.id, { maxSites: 5, maxDatabases: 10, siteTypes: [] });
    expect(empty.statusCode).toBe(400);
  });
});

describe('removing', () => {
  it('is refused while websites or customer allowances draw from it', async () => {
    const withSites = await admin.del(`/admin/orgs/${muster.id}/website-allowance`);
    expect(withSites.statusCode).toBe(409);
    expect(json(withSites).error.message).toContain('3 websites');
    const withCustomers = await admin.del(`/admin/orgs/${alpen.id}/website-allowance`);
    expect(json(withCustomers).error.message).toContain('1 customers');

    const fresh = await newOrg('Frisch AG', 'frisch-ag');
    expect(
      (await setAllowance(fresh.id, { maxSites: 0, maxDatabases: 0, siteTypes: ['static'] })).statusCode,
    ).toBe(200);
    expect((await admin.del(`/admin/orgs/${fresh.id}/website-allowance`)).statusCode).toBe(200);
    expect(json(await admin.get(`/admin/orgs/${fresh.id}/website-allowance`))).toBeNull();
    expect((await admin.del(`/admin/orgs/${fresh.id}/website-allowance`)).statusCode).toBe(404);
  });
});

describe('locks', () => {
  it('lets exactly one of parallel creations take the last slot', async () => {
    // Muster AG has 3 websites; room for one more.
    expect(
      (await setAllowance(muster.id, { maxSites: 4, maxDatabases: 10, siteTypes: ['static'] })).statusCode,
    ).toBe(200);
    // All four requests reach the allowance check together: the server options answer once all asked.
    const adapter = t.ctx.providers.forConnection(cp);
    const original = adapter.websiteServerOptions!.bind(adapter);
    let waiting: (() => void)[] = [];
    adapter.websiteServerOptions = async () => {
      const options = await original();
      await new Promise<void>((resolve) => {
        waiting.push(resolve);
        if (waiting.length === 4) for (const release of waiting) release();
      });
      return options;
    };
    let results;
    try {
      results = await Promise.all(
        ['p1', 'p2', 'p3', 'p4'].map((name) =>
          anna.post(`/orgs/${muster.id}/websites`, { domain: `${name}.muster-ag.ch`, type: 'static' }),
        ),
      );
    } finally {
      adapter.websiteServerOptions = original;
      waiting = [];
    }
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 409, 409, 409]);
    expect(
      results.filter((r) => r.statusCode === 409).every((r) => json(r).error.code === 'allowance_exceeded'),
    ).toBe(true);
    expect((await websiteCommitments(t.db, muster, cp.id)).sites).toBe(4);
  });

  it('takes the reseller lock before the customer lock', async () => {
    const order: string[] = [];
    const tx = {
      execute: async (query: { queryChunks: unknown[] }) => {
        order.push(JSON.stringify(query.queryChunks));
      },
    };
    await lockWebsiteOrg(tx as never, huber);
    expect(order).toHaveLength(2);
    expect(order[0]).toContain(`website:${alpen.id}`);
    expect(order[1]).toContain(`website:${huber.id}`);
  });
});

describe('moving a website', () => {
  it('passes web spaces and checks websites against the target allowance', async () => {
    const plain = (await t.db.query.webspaces.findFirst({ where: eq(webspaces.kind, 'webspace') }))!;
    const fresh = await newOrg('Ziel AG', 'ziel-ag');
    await t.db.transaction((tx) => assertWebsiteMoveAllowed(tx, plain.id, fresh));

    const www = (await t.db.query.webspaces.findFirst({
      where: eq(webspaces.externalId, 'www.muster-ag.example'),
    }))!;
    await expect(t.db.transaction((tx) => assertWebsiteMoveAllowed(tx, www.id, fresh))).rejects.toMatchObject(
      {
        statusCode: 409,
        code: 'no_allowance',
      },
    );
    await t.db.insert(websiteAllowances).values({
      orgId: fresh.id,
      providerConnectionId: other.id,
      maxSites: 5,
      maxDatabases: 5,
      siteTypes: ['php'],
    });
    await expect(t.db.transaction((tx) => assertWebsiteMoveAllowed(tx, www.id, fresh))).rejects.toMatchObject(
      {
        statusCode: 409,
        message: expect.stringContaining('another instance'),
      },
    );
    await t.db
      .update(websiteAllowances)
      .set({ providerConnectionId: cp.id, maxDatabases: 0 })
      .where(eq(websiteAllowances.orgId, fresh.id));
    // The website brings one database along.
    await expect(t.db.transaction((tx) => assertWebsiteMoveAllowed(tx, www.id, fresh))).rejects.toMatchObject(
      {
        code: 'allowance_exceeded',
        details: { maxDatabases: 0, databases: 0 },
      },
    );
    await t.db
      .update(websiteAllowances)
      .set({ maxDatabases: 1 })
      .where(eq(websiteAllowances.orgId, fresh.id));
    await t.db.transaction((tx) => assertWebsiteMoveAllowed(tx, www.id, fresh));
  });
});
