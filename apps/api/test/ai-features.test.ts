import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { productText } from '@weblion/shared';
import {
  aiUsage,
  auditLogs,
  domains,
  mailDomains,
  mailLog,
  monitors,
  organizations,
  products,
  projects,
  providerConnections,
  serverActions,
  servers,
  users,
  webspaces,
} from '../src/db/schema';
import { thirdPartyOf } from '../src/modules/ai/demo';
import { startClaudeMock, type MockTurn } from './claude-mock';
import { ADMIN, Client, configureAi, createTestApp, json, type TestApp } from './helpers';

/** The JSON features (ai 10, 15.2) against the Claude mock: sources, permissions, filters, proposals. */

let t: TestApp;
let mock: Awaited<ReturnType<typeof startClaudeMock>>;
let admin: Client;
let anna: Client;
let carla: Client;
let ben: Client;
let reto: Client;
const ids: Record<string, string> = {};

const EXPLAIN = { summary: 'Kurz.', cause: 'Ursache.', steps: ['a', 'b'], links: [], severity: 'warning' };
const script = (...turns: MockTurn[]) => mock.setScript((_b, i) => turns[Math.min(i, turns.length - 1)]);
/** The user turn of the newest recorded request and its <third_party> data. */
function sent() {
  const content = mock.requests.at(-1)!.body.messages.at(-1).content as string;
  return { content, data: thirdPartyOf(content)?.value as any, kind: thirdPartyOf(content)?.kind };
}
const lastRow = async () =>
  (
    await t.db
      .select()
      .from(aiUsage)
      .orderBy(sql`${aiUsage.createdAt} desc`)
      .limit(1)
  )[0]!;

async function orgId(slug: string) {
  return (await t.db.query.organizations.findFirst({ where: eq(organizations.slug, slug) }))!.id;
}

beforeAll(async () => {
  mock = await startClaudeMock();
  t = await createTestApp({ env: { ANTHROPIC_BASE_URL: mock.url } });
  admin = new Client(t.app);
  await admin.login(ADMIN.email, ADMIN.password);
  await configureAi(admin);
  for (const [name, email] of [
    ['anna', 'anna@muster.example'],
    ['carla', 'carla@muster.example'],
    ['ben', 'ben@muster.example'],
    ['reto', 'reseller@alpen.example'],
  ] as const) {
    const client = new Client(t.app);
    await client.login(email);
    if (name === 'anna') anna = client;
    if (name === 'carla') carla = client;
    if (name === 'ben') ben = client;
    if (name === 'reto') reto = client;
  }
  for (const slug of ['muster-ag', 'beispiel-gmbh', 'alpen-hosting', 'baeckerei-huber'])
    ids[slug] = await orgId(slug);
});
afterAll(async () => {
  await t?.close();
  await mock?.close();
});
beforeEach(async () => {
  await t.db.delete(aiUsage);
  mock.requests.length = 0;
  script({ json: EXPLAIN });
  await t.db
    .update(organizations)
    .set({ aiEnabled: false, aiDisabledBy: null, aiOptOutAt: null })
    .where(inArray(organizations.id, [ids['beispiel-gmbh']!, ids['baeckerei-huber']!]));
  await t.db
    .update(organizations)
    .set({ aiEnabled: true, aiDisabledBy: null, aiOptOutAt: null })
    .where(inArray(organizations.id, [ids['muster-ag']!, ids['alpen-hosting']!]));
});

const page = { path: '/o/muster-ag/servers', title: 'Server' };
const orgExplain = (client: Client, source: unknown, org = ids['muster-ag']) =>
  client.post(`/orgs/${org}/ai/explain`, { source, locale: 'de' });

describe('explain (ai 10.1)', () => {
  it('error: the browser error as third-party data, personal data removed; links only console paths', async () => {
    script({
      json: {
        ...EXPLAIN,
        links: [
          { label: 'Server', path: '/o/muster-ag/servers' },
          { label: 'Phish', path: 'https://evil.example/login' },
          { label: 'Rel', path: '//evil.example' },
        ],
      },
    });
    const res = await orgExplain(anna, {
      kind: 'error',
      error: {
        status: 502,
        code: 'provider_error',
        message: 'Mailcow: mailbox max@muster-ag.ch failed',
        details: { email: 'x@y.ch' },
      },
      page,
    });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({
      summary: 'Kurz.',
      severity: 'warning',
      meta: { model: 'claude-opus-5-5', demo: false },
    });
    expect(json(res).links).toEqual([{ label: 'Server', path: '/o/muster-ag/servers' }]);
    const { content, data, kind } = sent();
    expect(kind).toBe('error');
    expect(data).toMatchObject({
      status: 502,
      code: 'provider_error',
      message: 'Mailcow: mailbox [email] failed',
    });
    expect(data.details).toEqual({});
    expect(content).toContain('page: /o/muster-ag/servers');
    expect(mock.requests.at(-1)!.body.system[0].text.startsWith('# Feature: explain')).toBe(true);
    expect(await lastRow()).toMatchObject({
      feature: 'explain',
      scope: 'org',
      orgId: ids['muster-ag'],
      status: 'ok',
    });
  });

  it('audit: needs audit:read in the organization; the row of another organization is 404; personal fields go', async () => {
    const [own] = await t.db
      .insert(auditLogs)
      .values({
        action: 'server.reboot',
        orgId: ids['muster-ag'],
        status: 'failure',
        ip: '203.0.113.7',
        userAgent: 'curl/8',
        actorName: 'Anna Muster',
        details: { inviterEmail: 'anna@muster.example', note: 'mail to max@muster-ag.ch' },
      })
      .returning();
    const [foreign] = await t.db
      .insert(auditLogs)
      .values({ action: 'server.reboot', orgId: ids['beispiel-gmbh'], status: 'failure' })
      .returning();
    const res = await orgExplain(anna, { kind: 'audit', auditId: String(own!.id) });
    expect(res.statusCode).toBe(200);
    const { data, kind } = sent();
    expect(kind).toBe('audit_entry');
    expect(data).toMatchObject({
      action: 'server.reboot',
      status: 'failure',
      actor: { name: 'Anna Muster' },
    });
    expect(JSON.stringify(data)).not.toContain('203.0.113.7');
    expect(JSON.stringify(data)).not.toContain('curl/8');
    expect(JSON.stringify(data)).not.toContain('@');
    expect((await orgExplain(anna, { kind: 'audit', auditId: String(foreign!.id) })).statusCode).toBe(404);
    expect((await orgExplain(ben, { kind: 'audit', auditId: String(own!.id) })).statusCode).toBe(403);
  });

  it("org explain of a reseller's audit row about a customer whose AI is off is 403 ai_org_disabled", async () => {
    const [row] = await t.db
      .insert(auditLogs)
      .values({
        action: 'reseller.customer_update',
        orgId: ids['alpen-hosting'],
        resourceType: 'org',
        resourceId: ids['baeckerei-huber'],
        status: 'success',
        details: { name: 'Bäckerei Huber' },
      })
      .returning();
    const res = await orgExplain(reto, { kind: 'audit', auditId: String(row!.id) }, ids['alpen-hosting']);
    expect(res.statusCode).toBe(403);
    expect(json(res).error.code).toBe('ai_org_disabled');
    expect(mock.requests).toHaveLength(0);
    // Switched on, the same row can be explained.
    await t.db
      .update(organizations)
      .set({ aiEnabled: true })
      .where(eq(organizations.id, ids['baeckerei-huber']!));
    expect(
      (await orgExplain(reto, { kind: 'audit', auditId: String(row!.id) }, ids['alpen-hosting'])).statusCode,
    ).toBe(200);
  });

  it('server_action, monitor, website: read through the owned routes; another organization is 404', async () => {
    const [server] = await t.db
      .select({ id: servers.id })
      .from(servers)
      .innerJoin(projects, eq(projects.id, servers.projectId))
      .where(eq(projects.orgId, ids['muster-ag']!))
      .limit(1);
    const [action] = await t.db
      .insert(serverActions)
      .values({ serverId: server!.id, type: 'backup.create', status: 'error', error: 'disk full' })
      .returning();
    let res = await orgExplain(anna, { kind: 'server_action', serverId: server!.id, actionId: action!.id });
    expect(res.statusCode).toBe(200);
    expect(sent().data).toMatchObject({
      action: { type: 'backup.create', status: 'error', error: 'disk full' },
    });
    res = await orgExplain(anna, {
      kind: 'server_action',
      serverId: server!.id,
      actionId: '00000000-0000-4000-8000-000000000000',
    });
    expect(res.statusCode).toBe(404);

    const [monitor] = await t.db
      .select()
      .from(monitors)
      .where(eq(monitors.orgId, ids['muster-ag']!))
      .limit(1);
    res = await orgExplain(anna, { kind: 'monitor', monitorId: monitor!.id });
    expect(res.statusCode).toBe(200);
    expect(sent().kind).toBe('monitor');

    const [site] = await t.db.select().from(webspaces).where(eq(webspaces.orgId, ids['muster-ag']!)).limit(1);
    if (site) {
      res = await orgExplain(anna, { kind: 'website', websiteId: site.id });
      expect(res.statusCode).toBe(200);
      expect(sent().kind).toBe('website');
    }
    const [foreignMonitor] = await t.db
      .select()
      .from(monitors)
      .where(eq(monitors.orgId, ids['beispiel-gmbh']!))
      .limit(1);
    if (foreignMonitor) {
      expect((await orgExplain(anna, { kind: 'monitor', monitorId: foreignMonitor.id })).statusCode).toBe(
        404,
      );
    }
  });

  it('admin explain: error, audit, provider, mail_log with their permissions; scope staff on customer data', async () => {
    const support = new Client(t.app);
    await t.db
      .insert(users)
      .values({
        email: 'support@test.local',
        name: 'Support',
        platformRole: 'support',
        passwordHash: (await t.db.query.users.findFirst({ where: eq(users.email, ADMIN.email) }))!
          .passwordHash,
      })
      .onConflictDoNothing();
    await support.login('support@test.local', ADMIN.password);

    let res = await admin.post('/admin/ai/explain', {
      source: {
        kind: 'error',
        error: { status: 500, code: 'internal_error', message: 'x' },
        page: { path: '/admin/providers', title: null },
      },
      locale: 'en',
    });
    expect(res.statusCode).toBe(200);
    expect(await lastRow()).toMatchObject({ scope: 'platform', orgId: null });
    expect(sent().content).toContain('role: weblion staff (superadmin)\naccess: staff');

    const [row] = await t.db
      .insert(auditLogs)
      .values({ action: 'server.delete', orgId: ids['muster-ag'], status: 'failure', ip: '198.51.100.4' })
      .returning();
    res = await admin.post('/admin/ai/explain', {
      source: { kind: 'audit', auditId: String(row!.id) },
      locale: 'de',
    });
    expect(res.statusCode).toBe(200);
    expect(await lastRow()).toMatchObject({ scope: 'staff', orgId: ids['muster-ag'] });
    expect(JSON.stringify(sent().data)).not.toContain('198.51.100.4');

    const [provider] = await t.db.select().from(providerConnections).limit(1);
    await t.db
      .update(providerConnections)
      .set({ lastError: 'HTTP 401 token=abcdefghijk12345' })
      .where(eq(providerConnections.id, provider!.id));
    res = await admin.post('/admin/ai/explain', {
      source: { kind: 'provider', providerId: provider!.id },
      locale: 'de',
    });
    expect(res.statusCode).toBe(200);
    expect(sent().data).toMatchObject({ name: provider!.name, lastError: 'HTTP 401 token=[hidden]' });
    expect(JSON.stringify(sent().data)).not.toContain('configEnc');

    const [mail] = await t.db
      .insert(mailLog)
      .values({
        to: 'kunde@muster-ag.ch',
        subject: 'Rechnung',
        template: 'invoice',
        status: 'failed',
        error: 'SMTP 550 for kunde@muster-ag.ch',
        orgId: ids['muster-ag'],
      })
      .returning();
    res = await admin.post('/admin/ai/explain', {
      source: { kind: 'mail_log', mailLogId: mail!.id },
      locale: 'de',
    });
    expect(res.statusCode).toBe(200);
    expect(sent().data).toMatchObject({
      template: 'invoice',
      status: 'failed',
      to: '[email]',
      error: 'SMTP 550 for [email]',
    });

    // Support may use the admin features on audit and providers, not on the mail log (platform:settings).
    expect(
      (
        await support.post('/admin/ai/explain', {
          source: { kind: 'mail_log', mailLogId: mail!.id },
          locale: 'de',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await support.post('/admin/ai/explain', {
          source: { kind: 'audit', auditId: String(row!.id) },
          locale: 'de',
        })
      ).statusCode,
    ).toBe(200);
    // Customers have no platform:ai:use.
    expect(
      (
        await anna.post('/admin/ai/explain', {
          source: { kind: 'audit', auditId: String(row!.id) },
          locale: 'de',
        })
      ).statusCode,
    ).toBe(403);
  });

  it("admin explain of a declined organization's audit row, or one about a declined customer, is 403", async () => {
    await t.db
      .update(organizations)
      .set({ aiOptOutAt: new Date() })
      .where(eq(organizations.id, ids['muster-ag']!));
    const [row] = await t.db
      .insert(auditLogs)
      .values({ action: 'server.reboot', orgId: ids['muster-ag'], status: 'failure' })
      .returning();
    let res = await admin.post('/admin/ai/explain', {
      source: { kind: 'audit', auditId: String(row!.id) },
      locale: 'de',
    });
    expect(res.statusCode).toBe(403);
    expect(json(res).error).toMatchObject({ code: 'ai_org_disabled', details: { reasons: ['declined'] } });
    const [about] = await t.db
      .insert(auditLogs)
      .values({
        action: 'reseller.customer_update',
        orgId: ids['alpen-hosting'],
        resourceType: 'org',
        resourceId: ids['baeckerei-huber'],
        status: 'success',
      })
      .returning();
    res = await admin.post('/admin/ai/explain', {
      source: { kind: 'audit', auditId: String(about!.id) },
      locale: 'de',
    });
    expect(res.statusCode).toBe(403);
    expect(mock.requests).toHaveLength(0);
  });
});

describe('DNS and mail check (ai 10.2)', () => {
  async function mailDomain() {
    return (await t.db.select().from(mailDomains).where(eq(mailDomains.orgId, ids['muster-ag']!)))[0]!;
  }

  it('verified, unverified and dropped proposals; topics point at the kept ones', async () => {
    const md = await mailDomain();
    // What the console computed for this domain: the model is told so, and a copy of one is verified.
    const setup = json(await anna.get(`/mail/domains/${md.id}/dns`));
    const dmarc = setup.records.find((r: any) => r.key === 'dmarc');
    script({
      json: {
        overall: 'problem',
        topics: [
          { topic: 'dmarc', status: 'problem', finding: 'Kein DMARC.', proposal_indexes: [0] },
          { topic: 'spf', status: 'warning', finding: 'SPF prüfen.', proposal_indexes: [1, 2, 9] },
        ],
        proposals: [
          {
            action: 'add',
            record_id: null,
            type: dmarc.type,
            name: dmarc.name,
            data: dmarc.data,
            ttl: 3600,
            reason: 'Fehlt.',
          },
          {
            action: 'add',
            record_id: null,
            type: 'TXT',
            name: '@',
            data: 'v=spf1 include:evil.example ~all',
            ttl: null,
            reason: 'Besser.',
          },
          {
            action: 'add',
            record_id: null,
            type: 'MX',
            name: '@',
            data: 'not a host',
            ttl: null,
            reason: 'Ungültig.',
          },
          {
            action: 'change',
            record_id: 'nope',
            type: 'MX',
            name: '@',
            data: '10 mx.evil.example',
            ttl: null,
            reason: 'Ersetzen.',
          },
        ],
      },
    });
    const res = await anna.post(`/orgs/${ids['muster-ag']}/ai/dns-check`, {
      domainId: null,
      mailDomainId: md.id,
      locale: 'de',
    });
    expect(res.statusCode).toBe(200);
    const result = json(res);
    expect(result.zone).toBe(setup.domain);
    expect(result.proposals).toHaveLength(2);
    expect(result.proposals[0]).toMatchObject({
      type: dmarc.type,
      name: '_dmarc',
      data: dmarc.data,
      verified: true,
      ttl: 3600,
    });
    expect(result.proposals[1]).toMatchObject({ type: 'TXT', name: '@', verified: false });
    expect(result.droppedProposals).toBe(2);
    expect(result.topics).toEqual([
      { topic: 'dmarc', status: 'problem', finding: 'Kein DMARC.', proposalIds: [result.proposals[0].id] },
      { topic: 'spf', status: 'warning', finding: 'SPF prüfen.', proposalIds: [result.proposals[1].id] },
    ]);
    const { data, kind } = sent();
    expect(kind).toBe('dns');
    expect(data.expected.find((e: any) => e.key === 'dmarc')).toMatchObject({
      status: dmarc.status,
      data: dmarc.data,
    });
    expect(mock.requests.at(-1)!.body.output_config.effort).toBe('medium');
  });

  it('a person without domain:dns:write gets text-only proposals', async () => {
    const md = await mailDomain();
    const setup = json(await carla.get(`/mail/domains/${md.id}/dns`));
    const dmarc = setup.records.find((r: any) => r.key === 'dmarc');
    script({
      json: {
        overall: 'problem',
        topics: [],
        proposals: [
          {
            action: 'add',
            record_id: null,
            type: dmarc.type,
            name: dmarc.name,
            data: dmarc.data,
            ttl: null,
            reason: 'Fehlt.',
          },
        ],
      },
    });
    const res = await carla.post(`/orgs/${ids['muster-ag']}/ai/dns-check`, {
      domainId: null,
      mailDomainId: md.id,
      locale: 'de',
    });
    expect(res.statusCode).toBe(200);
    expect(json(res).proposals[0]).toMatchObject({ verified: true, textOnly: true });
  });

  it('exactly one of domainId and mailDomainId; another organization is 404', async () => {
    expect(
      (
        await anna.post(`/orgs/${ids['muster-ag']}/ai/dns-check`, {
          domainId: null,
          mailDomainId: null,
          locale: 'de',
        })
      ).statusCode,
    ).toBe(400);
    const [foreign] = await t.db
      .select()
      .from(domains)
      .where(eq(domains.orgId, ids['beispiel-gmbh']!))
      .limit(1);
    if (foreign) {
      const res = await anna.post(`/orgs/${ids['muster-ag']}/ai/dns-check`, {
        domainId: foreign.id,
        mailDomainId: null,
        locale: 'de',
      });
      expect(res.statusCode).toBe(404);
    }
    expect(mock.requests).toHaveLength(0);
  });
});

describe('audit summary (ai 10.3)', () => {
  beforeEach(async () => {
    await t.db.delete(auditLogs);
  });
  const SUMMARY = (ids: string[]) => ({
    summary: 'Viel los.',
    highlights: [{ text: 'Neustarts', audit_ids: [...ids, '999999'] }],
    unusual: [],
  });

  it('organization: personal fields gone, entries of the period only, ids checked', async () => {
    const rows = await t.db
      .insert(auditLogs)
      .values([
        {
          action: 'server.reboot',
          orgId: ids['muster-ag'],
          status: 'success',
          ip: '192.0.2.1',
          userAgent: 'ua',
          actorName: 'Anna Muster',
          details: { email: 'anna@muster.example' },
        },
        { action: 'auth.login', orgId: ids['muster-ag'], status: 'failure', ip: '192.0.2.2' },
        {
          action: 'old.entry',
          orgId: ids['muster-ag'],
          status: 'success',
          createdAt: sql`now() - interval '3 days'`,
        },
      ])
      .returning();
    script({ json: SUMMARY([String(rows[0]!.id)]) });
    const res = await anna.post(`/orgs/${ids['muster-ag']}/ai/audit-summary`, {
      period: 'day',
      action: null,
      resourceType: null,
      status: null,
      locale: 'de',
    });
    expect(res.statusCode).toBe(200);
    const result = json(res);
    expect(result).toMatchObject({ summary: 'Viel los.', entries: 2, cut: false, hidden: 0 });
    expect(result.highlights).toEqual([{ text: 'Neustarts', auditIds: [String(rows[0]!.id)] }]);
    const { data } = sent();
    expect(data.entries.map((e: any) => e.action)).toEqual(['auth.login', 'server.reboot']);
    const text = JSON.stringify(data);
    for (const secret of ['192.0.2.1', '192.0.2.2', 'anna@muster.example', '"ua"'])
      expect(text).not.toContain(secret);
    expect(text).toContain('Anna Muster');
    // Without audit:read: 403.
    expect(
      (
        await ben.post(`/orgs/${ids['muster-ag']}/ai/audit-summary`, {
          period: 'day',
          action: null,
          resourceType: null,
          status: null,
          locale: 'de',
        })
      ).statusCode,
    ).toBe(403);
  });

  it('reseller log: entries about a customer whose AI is off are left out and counted as hidden', async () => {
    await t.db.insert(auditLogs).values([
      {
        action: 'reseller.customer_update',
        orgId: ids['alpen-hosting'],
        resourceType: 'org',
        resourceId: ids['baeckerei-huber'],
        status: 'success',
        details: { name: 'Huber' },
      },
      {
        action: 'billing.job',
        orgId: ids['alpen-hosting'],
        status: 'success',
        details: { customerOrgId: ids['baeckerei-huber'] },
      },
      {
        action: 'org.update',
        orgId: ids['alpen-hosting'],
        resourceType: 'org',
        resourceId: ids['alpen-hosting'],
        status: 'success',
      },
    ]);
    script({ json: SUMMARY([]) });
    const res = await reto.post(`/orgs/${ids['alpen-hosting']}/ai/audit-summary`, {
      period: 'week',
      action: null,
      resourceType: null,
      status: null,
      locale: 'de',
    });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({ entries: 1, hidden: 2 });
    expect(JSON.stringify(sent().data)).not.toContain(ids['baeckerei-huber']!);
  });

  it('admin: declined organizations are filtered from the platform log; one organization needs its AI on', async () => {
    await t.db
      .update(organizations)
      .set({ aiOptOutAt: new Date() })
      .where(eq(organizations.id, ids['muster-ag']!));
    await t.db.insert(auditLogs).values([
      { action: 'server.reboot', orgId: ids['muster-ag'], status: 'success' },
      { action: 'server.reboot', orgId: ids['alpen-hosting'], status: 'success' },
      {
        action: 'reseller.customer_update',
        orgId: ids['alpen-hosting'],
        resourceType: 'org',
        resourceId: ids['baeckerei-huber'],
        status: 'success',
      },
      { action: 'settings.update', orgId: null, status: 'success' },
    ]);
    script({ json: SUMMARY([]) });
    let res = await admin.post('/admin/ai/audit-summary', {
      period: 'day',
      action: null,
      resourceType: null,
      status: null,
      orgId: null,
      locale: 'de',
    });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({ entries: 2, hidden: 2 });
    expect(await lastRow()).toMatchObject({ scope: 'platform', orgId: null });
    res = await admin.post('/admin/ai/audit-summary', {
      period: 'day',
      action: null,
      resourceType: null,
      status: null,
      orgId: ids['muster-ag'],
      locale: 'de',
    });
    expect(res.statusCode).toBe(403);
    expect(json(res).error.code).toBe('ai_org_disabled');
    res = await admin.post('/admin/ai/audit-summary', {
      period: 'day',
      action: null,
      resourceType: null,
      status: null,
      orgId: ids['alpen-hosting'],
      locale: 'de',
    });
    expect(json(res)).toMatchObject({ entries: 1, hidden: 1 });
    expect(await lastRow()).toMatchObject({ scope: 'staff', orgId: ids['alpen-hosting'] });
  });

  it('more entries than 500 in the period: cut, the newest are sent', async () => {
    await t.db.insert(auditLogs).values(
      Array.from({ length: 620 }, (_, i) => ({
        action: `x.${i}`,
        orgId: ids['muster-ag'],
        status: 'success' as const,
      })),
    );
    script({ json: SUMMARY([]) });
    const res = await anna.post(`/orgs/${ids['muster-ag']}/ai/audit-summary`, {
      period: 'day',
      action: null,
      resourceType: null,
      status: null,
      locale: 'de',
    });
    expect(json(res)).toMatchObject({ entries: 500, cut: true });
    expect(sent().data).toMatchObject({ cut: true });
  });
});

describe('server analysis (ai 10.4)', () => {
  it('reads metrics, monitoring, traffic and actions through the server routes; another server is 404', async () => {
    const [server] = await t.db
      .select({ id: servers.id })
      .from(servers)
      .innerJoin(projects, eq(projects.id, servers.projectId))
      .where(eq(projects.orgId, ids['muster-ag']!))
      .limit(1);
    script({
      json: {
        overall: 'watch',
        summary: 'CPU hoch.',
        metrics: [{ metric: 'cpu', status: 'watch', finding: 'Oft über 80 %.' }],
        recommendations: ['Grösseren Plan prüfen.', 'b', 'c', 'd', 'e', 'f'],
      },
    });
    const res = await anna.post(`/orgs/${ids['muster-ag']}/ai/server-health`, {
      serverId: server!.id,
      range: 'day',
      locale: 'de',
    });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({ overall: 'watch', metrics: [{ metric: 'cpu', status: 'watch' }] });
    expect(json(res).recommendations).toHaveLength(5);
    const { data, kind } = sent();
    expect(kind).toBe('server_data');
    expect(data).toHaveProperty('metrics');
    expect(data.range).toBe('day');
    const [foreign] = await t.db
      .select({ id: servers.id })
      .from(servers)
      .innerJoin(projects, eq(projects.id, servers.projectId))
      .where(eq(projects.orgId, ids['beispiel-gmbh']!))
      .limit(1);
    expect(
      (
        await anna.post(`/orgs/${ids['muster-ag']}/ai/server-health`, {
          serverId: foreign!.id,
          range: 'day',
          locale: 'de',
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe('product texts (ai 10.6)', () => {
  it('admin: writes texts, the result is saved with the product and read back with productText', async () => {
    script({
      json: {
        texts: [
          { locale: 'de', name: 'Managed Server S', description: 'Ein Server, den weblion betreut.' },
          { locale: 'en', name: 'Managed server S', description: 'A server managed by weblion.' },
          { locale: 'fr', name: 'Serveur géré S', description: null },
          { locale: 'it', name: 'x'.repeat(300), description: null },
          { locale: 'nl', name: 'Beheerde server S', description: 'Niet gevraagd.' },
        ],
      },
    });
    const res = await admin.post('/admin/ai/product-texts', {
      mode: 'write',
      name: 'Managed Server S',
      description: null,
      module: 'servers',
      interval: 'monthly',
      notes: '2 vCPU, 4 GB',
      locales: ['de', 'en', 'fr', 'it'],
      locale: 'de',
    });
    expect(res.statusCode).toBe(200);
    const texts = json(res).texts;
    expect(Object.keys(texts).sort()).toEqual(['de', 'en', 'fr', 'it']);
    expect(texts.it.name).toHaveLength(200);
    expect(await lastRow()).toMatchObject({ feature: 'product_texts', scope: 'platform', orgId: null });
    expect(sent().data).toMatchObject({ mode: 'write', languages: ['de', 'en', 'fr', 'it'] });

    const [product] = await t.db
      .select()
      .from(products)
      .where(sql`${products.ownerOrgId} is null`)
      .limit(1);
    const saved = await admin.patch(`/billing/products/${product!.id}`, {
      translations: { en: texts.en, fr: texts.fr },
    });
    expect(saved.statusCode).toBe(200);
    const dto = json(saved);
    expect(productText(dto, 'en')).toEqual(texts.en);
    expect(productText(dto, 'fr')).toEqual({ name: texts.fr.name, description: dto.description });
    expect(productText(dto, 'de')).toEqual({ name: dto.name, description: dto.description });
  });

  it('reseller: own products only (reseller:billing); translate needs a target language', async () => {
    script({ json: { texts: [{ locale: 'fr', name: '[FR] Webhosting', description: null }] } });
    const body = {
      mode: 'translate',
      name: 'Webhosting',
      description: null,
      module: null,
      interval: null,
      notes: null,
      locales: ['fr'],
      locale: 'de',
    };
    const res = await reto.post(`/orgs/${ids['alpen-hosting']}/ai/product-texts`, body);
    expect(res.statusCode).toBe(200);
    expect(json(res).texts).toEqual({ fr: { name: '[FR] Webhosting', description: null } });
    expect(await lastRow()).toMatchObject({ scope: 'org', orgId: ids['alpen-hosting'] });
    expect(
      (await reto.post(`/orgs/${ids['alpen-hosting']}/ai/product-texts`, { ...body, locales: ['de'] }))
        .statusCode,
    ).toBe(400);
    // Not a reseller: 404.
    expect((await anna.post(`/orgs/${ids['muster-ag']}/ai/product-texts`, body)).statusCode).toBe(404);
  });
});

describe('availability', () => {
  it('a feature switched off is 404 on its route', async () => {
    await configureAi(admin, { features: { explain: false } });
    try {
      const res = await orgExplain(anna, {
        kind: 'error',
        error: { status: 500, code: 'x', message: 'y' },
        page,
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await configureAi(admin);
    }
  });
});
