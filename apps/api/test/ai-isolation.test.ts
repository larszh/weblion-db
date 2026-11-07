import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, inArray, isNull, ne, notInArray } from 'drizzle-orm';
import { DEFAULT_CUSTOMER_BOUNDARY } from '@weblion/shared';
import type { FastifyRequest } from 'fastify';
import {
  aiUsage,
  auditLogs,
  domains,
  mailDomains,
  memberships,
  monitors,
  organizations,
  projects,
  servers,
  users,
  webspaces,
} from '../src/db/schema';
import { ConsoleReader, READER_ROUTES } from '../src/modules/ai/reader';
import { AI_TOOLS } from '../src/modules/ai/tools/registry';
import { parseSse, startClaudeMock, type MockTurn } from './claude-mock';
import { ADMIN, Client, configureAi, createTestApp, DEMO_PASSWORD, type TestApp } from './helpers';

/**
 * Isolation of the read layer (ai 8.1, plan O26, review #1): a resource read by id must belong to the chat's
 * organization, sub-paths need a verified parent, and nothing of another organization reaches the model.
 */

let t: TestApp;
let mock: Awaited<ReturnType<typeof startClaudeMock>>;
let admin: Client;
let anna: Client;
let reto: Client;
const ids: Record<string, string> = {};
const foreign: Record<string, { id: string; name: string }> = {};

const script = (...turns: MockTurn[]) => mock.setScript((_b, i) => turns[Math.min(i, turns.length - 1)]);
const allRequests = () => JSON.stringify(mock.requests.map((r) => r.body));

async function chatIn(client: Client, orgId: string, toolUses: MockTurn['toolUses']) {
  script({ toolUses }, { text: 'Fertig.' });
  const res = await client.post(`/orgs/${orgId}/ai/chat`, {
    messages: [{ role: 'user', text: 'Zeig mir das.', page: null }],
    locale: 'de',
  });
  expect(res.statusCode).toBe(200);
  const events = parseSse(res.body);
  const results = (mock.requests.at(-1)?.body.messages.at(-1).content ?? []) as any[];
  return { events, results: results.filter((b) => b.type === 'tool_result') };
}

async function sessionCookie(email: string, password = DEMO_PASSWORD): Promise<string> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
    headers: { 'x-requested-with': 'test' },
  });
  return res.cookies.find((c) => c.name === 'wl_session')!.value;
}

beforeAll(async () => {
  mock = await startClaudeMock();
  t = await createTestApp({ env: { ANTHROPIC_BASE_URL: mock.url } });
  admin = new Client(t.app);
  await admin.login(ADMIN.email, ADMIN.password);
  await configureAi(admin);
  anna = new Client(t.app);
  await anna.login('anna@muster.example');
  reto = new Client(t.app);
  await reto.login('reseller@alpen.example');
  for (const slug of ['muster-ag', 'beispiel-gmbh', 'alpen-hosting', 'baeckerei-huber']) {
    ids[slug] = (await t.db.query.organizations.findFirst({ where: eq(organizations.slug, slug) }))!.id;
  }
  // Anna is a member of two organizations: she may read Beispiel's resources through the console.
  const annaId = (await t.db.query.users.findFirst({ where: eq(users.email, 'anna@muster.example') }))!.id;
  await t.db
    .insert(memberships)
    .values({ orgId: ids['beispiel-gmbh']!, userId: annaId, role: 'owner' })
    .onConflictDoNothing();
  await t.db
    .update(organizations)
    .set({ aiEnabled: true })
    .where(eq(organizations.id, ids['beispiel-gmbh']!));

  const beispiel = ids['beispiel-gmbh']!;
  const [server] = await t.db
    .select({ id: servers.id, name: servers.name })
    .from(servers)
    .innerJoin(projects, eq(projects.id, servers.projectId))
    .where(eq(projects.orgId, beispiel))
    .limit(1);
  foreign.server = server!;
  // Beispiel gets one resource of each kind it lacks, taken from the spare demo resources or from Muster's.
  const pick = async (
    table: typeof domains | typeof webspaces | typeof mailDomains | typeof monitors,
    key: string,
  ) => {
    let [row] = await t.db
      .select({ id: table.id, name: table.name })
      .from(table)
      .where(eq(table.orgId, beispiel))
      .limit(1);
    if (!row) {
      [row] = await t.db
        .select({ id: table.id, name: table.name })
        .from(table)
        .where(and(ne(table.orgId, ids['baeckerei-huber']!)))
        .limit(1);
      if (row) await t.db.update(table).set({ orgId: beispiel }).where(eq(table.id, row.id));
    }
    if (row) foreign[key] = row;
  };
  await pick(domains, 'domain');
  await pick(webspaces, 'website');
  await pick(mailDomains, 'mail_domain');
  await pick(monitors, 'monitor');
});
afterAll(async () => {
  await t?.close();
  await mock?.close();
});
beforeEach(async () => {
  await t.db.delete(aiUsage);
  mock.requests.length = 0;
});

describe('another organization of the same person', () => {
  it('server, domain, website, mail domain and monitor of the other organization are not_found', async () => {
    // Through the console Anna sees them all.
    expect((await anna.get(`/servers/${foreign.server!.id}`)).statusCode).toBe(200);
    const calls: NonNullable<MockTurn['toolUses']> = [
      { name: 'get_server', input: { server_id: foreign.server!.id } },
      { name: 'get_server_metrics', input: { server_id: foreign.server!.id, range: 'day' } },
      { name: 'get_server_activity', input: { server_id: foreign.server!.id } },
    ];
    if (foreign.domain) {
      calls.push({ name: 'get_domain', input: { domain_id: foreign.domain.id } });
      calls.push({ name: 'get_dns_records', input: { domain_id: foreign.domain.id } });
    }
    if (foreign.website) calls.push({ name: 'get_website', input: { website_id: foreign.website.id } });
    if (foreign.mail_domain) {
      calls.push({ name: 'get_mail_domain', input: { mail_domain_id: foreign.mail_domain.id } });
      calls.push({ name: 'get_mail_dns_setup', input: { mail_domain_id: foreign.mail_domain.id } });
    }
    if (foreign.monitor)
      calls.push({ name: 'get_monitor', input: { monitor_id: foreign.monitor.id, range: 'recent' } });
    const { results } = await chatIn(anna, ids['muster-ag']!, calls);
    expect(results).toHaveLength(calls.length);
    for (const result of results) {
      expect(result.is_error).toBe(true);
      expect(JSON.parse(result.content)).toEqual({ error: 'not_found' });
    }
    const sent = allRequests();
    for (const resource of Object.values(foreign)) expect(sent).not.toContain(resource.name);
    // The DNS proposal tool too.
    if (foreign.domain) {
      const { results: proposal } = await chatIn(anna, ids['muster-ag']!, [
        {
          name: 'propose_dns_record',
          input: {
            domain_id: foreign.domain.id,
            action: 'add',
            record_id: null,
            type: 'TXT',
            name: '@',
            data: 'x',
            ttl: null,
            reason: 'r',
          },
        },
      ]);
      expect(JSON.parse(proposal[0].content)).toEqual({ error: 'not_found' });
    }
  });

  it('the features refuse the other organization the same way (404)', async () => {
    const muster = ids['muster-ag']!;
    script({ json: { overall: 'ok', summary: 's', metrics: [], recommendations: [] } });
    expect(
      (
        await anna.post(`/orgs/${muster}/ai/server-health`, {
          serverId: foreign.server!.id,
          range: 'day',
          locale: 'de',
        })
      ).statusCode,
    ).toBe(404);
    if (foreign.domain) {
      const res = await anna.post(`/orgs/${muster}/ai/dns-check`, {
        domainId: foreign.domain.id,
        mailDomainId: null,
        locale: 'de',
      });
      expect(res.statusCode).toBe(404);
    }
    if (foreign.monitor) {
      const res = await anna.post(`/orgs/${muster}/ai/explain`, {
        source: { kind: 'monitor', monitorId: foreign.monitor.id },
        locale: 'de',
      });
      expect(res.statusCode).toBe(404);
    }
    expect(mock.requests).toHaveLength(0);
  });

  it("a declined organization's data never reaches the model, also not through its member's other organization", async () => {
    await t.db
      .update(organizations)
      .set({ aiOptOutAt: new Date() })
      .where(eq(organizations.id, ids['beispiel-gmbh']!));
    try {
      const declined = await anna.post(`/orgs/${ids['beispiel-gmbh']}/ai/chat`, {
        messages: [{ role: 'user', text: 'Hallo', page: null }],
        locale: 'de',
      });
      expect(declined.statusCode).toBe(403);
      await chatIn(anna, ids['muster-ag']!, [
        { name: 'get_server', input: { server_id: foreign.server!.id } },
      ]);
      expect(allRequests()).not.toContain(foreign.server!.name);
    } finally {
      await t.db
        .update(organizations)
        .set({ aiOptOutAt: null })
        .where(eq(organizations.id, ids['beispiel-gmbh']!));
    }
  });
});

describe("a server's earlier owner", () => {
  it('audit entries of an earlier owner whose AI is off never reach the model; the own entries stay', async () => {
    const muster = ids['muster-ag']!;
    const beispiel = ids['beispiel-gmbh']!;
    const [server] = await t.db
      .select({ id: servers.id })
      .from(servers)
      .innerJoin(projects, eq(projects.id, servers.projectId))
      .where(eq(projects.orgId, muster))
      .limit(1);
    const entry = (orgId: string, actorName: string, name: string) => ({
      orgId,
      actorName,
      action: 'server.rename',
      resourceType: 'server',
      resourceId: server!.id,
      status: 'success' as const,
      details: { name },
    });
    const inserted = await t.db
      .insert(auditLogs)
      .values([
        entry(beispiel, 'Bruno Beispiel', 'SECRET-PROJECT-OF-BEISPIEL'),
        entry(muster, 'Anna Muster', 'MUSTER-OWN-ENTRY'),
      ])
      .returning({ id: auditLogs.id });
    await t.db.update(organizations).set({ aiOptOutAt: new Date() }).where(eq(organizations.id, beispiel));
    try {
      const { results } = await chatIn(anna, muster, [
        { name: 'get_server_activity', input: { server_id: server!.id } },
      ]);
      const audit = JSON.parse(results[0].content).audit;
      expect(audit.hidden).toBe(1);
      expect(JSON.stringify(audit.items)).toContain('MUSTER-OWN-ENTRY');
      const sent = allRequests();
      expect(sent).not.toContain('SECRET-PROJECT-OF-BEISPIEL');
      expect(sent).not.toContain('Bruno Beispiel');
    } finally {
      await t.db.update(organizations).set({ aiOptOutAt: null }).where(eq(organizations.id, beispiel));
      await t.db.delete(auditLogs).where(
        inArray(
          auditLogs.id,
          inserted.map((r) => r.id),
        ),
      );
    }
  });
});

describe('fail closed', () => {
  it('a server without organization (org: null) is not_found, also for staff who can read it', async () => {
    const [spare] = await t.db
      .select({ id: servers.id, name: servers.name })
      .from(servers)
      .where(isNull(servers.projectId))
      .limit(1);
    expect(spare).toBeDefined();
    expect((await admin.get(`/servers/${spare!.id}`)).statusCode).toBe(200);
    const { results } = await chatIn(admin, ids['muster-ag']!, [
      { name: 'get_server', input: { server_id: spare!.id } },
    ]);
    expect(JSON.parse(results[0].content)).toEqual({ error: 'not_found' });
    expect(allRequests()).not.toContain(spare!.name);
  });

  it('a sub-path is read only below a parent verified in the same run', async () => {
    const [own] = await t.db
      .select({ id: servers.id })
      .from(servers)
      .innerJoin(projects, eq(projects.id, servers.projectId))
      .where(eq(projects.orgId, ids['muster-ag']!))
      .limit(1);
    const req = {
      cookies: { wl_session: await sessionCookie('anna@muster.example') },
      ip: '127.0.0.1',
      headers: {},
    } as unknown as FastifyRequest;
    const reader = new ConsoleReader(t.app, req, ids['muster-ag']!, new AbortController().signal);
    expect(await reader.sub('server', own!.id, 'tasks')).toEqual({ ok: false, error: 'not_found' });
    expect((await reader.owned('server', own!.id)).ok).toBe(true);
    expect((await reader.sub('server', own!.id, 'tasks')).ok).toBe(true);
    // A path outside the allowlist cannot be built at all.
    expect(await reader.sub('server', own!.id, 'backups' as never)).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(await reader.owned('server', '../admin/users')).toEqual({ ok: false, error: 'not_found' });
    // Verification belongs to the reader: a new run starts unverified.
    const next = new ConsoleReader(t.app, req, ids['muster-ag']!, new AbortController().signal);
    expect(await next.sub('server', own!.id, 'tasks')).toEqual({ ok: false, error: 'not_found' });
    // Another organization's server, even one the person may read, never verifies.
    expect(await reader.owned('server', foreign.server!.id)).toEqual({ ok: false, error: 'not_found' });
  });

  it('reseller staff in one customer cannot read a sibling customer', async () => {
    const [sibling] = await t.db
      .insert(organizations)
      .values({
        name: 'Nachbar GmbH',
        slug: 'nachbar-gmbh',
        kind: 'customer',
        parentOrgId: ids['alpen-hosting'],
        boundary: DEFAULT_CUSTOMER_BOUNDARY,
        modules: ['servers', 'dns'],
        aiEnabled: true,
      })
      .returning();
    await t.db
      .update(organizations)
      .set({ aiEnabled: true })
      .where(eq(organizations.id, ids['baeckerei-huber']!));
    const [domain] = await t.db
      .select({ id: domains.id, name: domains.name })
      .from(domains)
      .where(notInArray(domains.orgId, [ids['muster-ag']!, ids['baeckerei-huber']!]))
      .limit(1);
    await t.db.update(domains).set({ orgId: sibling!.id }).where(eq(domains.id, domain!.id));
    try {
      expect((await reto.get(`/domains/${domain!.id}`)).statusCode).toBe(200);
      const { results } = await chatIn(reto, ids['baeckerei-huber']!, [
        { name: 'get_domain', input: { domain_id: domain!.id } },
      ]);
      expect(JSON.parse(results[0].content)).toEqual({ error: 'not_found' });
      expect(allRequests()).not.toContain(domain!.name);
      // Reseller staff are a reseller request in the customer: scope org, role "reseller owner".
      expect(mock.requests[0]!.body.messages[0].content).toContain('role: reseller owner\naccess: reseller');
    } finally {
      await t.db.update(domains).set({ orgId: ids['beispiel-gmbh'] }).where(eq(domains.id, domain!.id));
      await t.db
        .update(organizations)
        .set({ aiEnabled: false })
        .where(eq(organizations.id, ids['baeckerei-huber']!));
    }
  });
});

describe('route allowlist', () => {
  it('every route the tools and the reader call exists as a GET route', () => {
    const templates = new Set([...READER_ROUTES, ...AI_TOOLS.flatMap((tool) => tool.routes)]);
    for (const url of templates) {
      expect(t.app.hasRoute({ method: 'GET', url: `/api/v1${url}` }), url).toBe(true);
    }
    for (const tool of AI_TOOLS)
      for (const route of tool.routes) expect(READER_ROUTES, route).toContain(route);
  });
});
