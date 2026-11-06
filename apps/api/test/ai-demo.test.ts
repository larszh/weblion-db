import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { aiUsage, mailDomains, organizations, projects, servers, users } from '../src/db/schema';
import { AiService } from '../src/modules/ai/service';
import { MOCK_API_KEY, parseSse } from './claude-mock';
import { ADMIN, Client, createTestApp, json, type TestApp } from './helpers';

/**
 * Demo mode (ai 14): with ENABLE_DEMO_PROVIDER=true and no key the normal SDK client runs against the in-process
 * emulator, so every feature can be shown without an Anthropic account. Every path of the module runs unchanged.
 */

let t: TestApp;
let admin: Client;
let anna: Client;
let musterId: string;

const chat = (text: string) =>
  anna.post(`/orgs/${musterId}/ai/chat`, { messages: [{ role: 'user', text, page: null }], locale: 'de' });

beforeAll(async () => {
  t = await createTestApp();
  admin = new Client(t.app);
  await admin.login(ADMIN.email, ADMIN.password);
  anna = new Client(t.app);
  await anna.login('anna@muster.example');
  musterId = (await t.db.query.organizations.findFirst({ where: eq(organizations.slug, 'muster-ag') }))!.id;
});
afterAll(() => t?.close());
beforeEach(async () => {
  await t.db.delete(aiUsage);
});

describe('when demo mode applies', () => {
  it('only with the demo provider and without any key; the master switch starts on', async () => {
    expect(json(await anna.get('/ai/status'))).toMatchObject({ available: true, demo: true, reason: null });
    const withoutDemo = new AiService({ ...t.ctx, env: { ...t.ctx.env, ENABLE_DEMO_PROVIDER: false } });
    // Without the demo provider the master switch defaults to off as well.
    expect(await withoutDemo.availability()).toMatchObject({ available: false, demo: false });
    expect(await withoutDemo.client()).toBeNull();
    const withEnvKey = new AiService({ ...t.ctx, env: { ...t.ctx.env, ANTHROPIC_API_KEY: MOCK_API_KEY } });
    expect(await withEnvKey.availability()).toMatchObject({ available: true, demo: false });
    expect((await withEnvKey.client())!.demo).toBe(false);
  });
});

describe('the assistant', () => {
  it('reads the overview with a tool and answers with its counts', async () => {
    const res = await chat('Wie viele Server habe ich?');
    expect(res.statusCode).toBe(200);
    const events = parseSse(res.body);
    expect(events[0]).toEqual({ event: 'meta', data: { model: 'claude-opus-5-5', demo: true } });
    expect(events.filter((e) => e.event === 'tool').map((e) => [e.data.name, e.data.status])).toEqual([
      ['get_org_overview', 'running'],
      ['get_org_overview', 'done'],
    ]);
    const text = events
      .filter((e) => e.event === 'text')
      .map((e) => e.data.text)
      .join('');
    expect(text).toMatch(
      /^\[Demo\] Ich sehe mir das an\. \[Demo\] Ihre Organisation hat \d+ Server, \d+ Domains/,
    );
    expect(events.at(-1)).toMatchObject({ event: 'done', data: { fallback: false } });
    const [row] = await t.db.select().from(aiUsage);
    expect(row).toMatchObject({
      feature: 'assistant',
      demo: true,
      costMicros: 0,
      apiCalls: 2,
      toolCalls: 1,
      status: 'ok',
    });
  });

  it('a question about e-mail DNS ends with a verified DNS proposal', async () => {
    const res = await chat('Ist DMARC für meine E-Mail eingerichtet?');
    const events = parseSse(res.body);
    expect(
      events.filter((e) => e.event === 'tool' && e.data.status === 'done').map((e) => e.data.name),
    ).toEqual(['list_mail_domains', 'get_mail_dns_setup', 'propose_dns_record']);
    const proposal = events.find((e) => e.event === 'proposal')!.data;
    expect(proposal).toMatchObject({ action: 'add', verified: true, textOnly: false });
    // The console's own record, copied exactly: DMARC when it is missing, else the first missing one.
    const list = json(await anna.get(`/orgs/${musterId}/mail/domains`));
    const setup = json(await anna.get(`/mail/domains/${list[0].id}/dns`));
    const missing = setup.records.filter((r: any) => r.status === 'missing' && r.data);
    const expected = missing.find((r: any) => r.key === 'dmarc') ?? missing[0];
    expect(proposal).toMatchObject({ type: expected.type, name: expected.name, data: expected.data });
    expect(events.at(-1)!.event).toBe('done');
  });

  it('answers in English for another language', async () => {
    const res = await anna.post(`/orgs/${musterId}/ai/chat`, {
      messages: [{ role: 'user', text: 'How many servers?', page: null }],
      locale: 'fr',
    });
    const text = parseSse(res.body)
      .filter((e) => e.event === 'text')
      .map((e) => e.data.text)
      .join('');
    expect(text).toContain('[Demo] Your organization has');
  });
});

describe('the JSON features', () => {
  const locale = 'de';

  it('each returns a valid result marked demo', async () => {
    const explain = await anna.post(`/orgs/${musterId}/ai/explain`, {
      source: {
        kind: 'error',
        error: { status: 502, code: 'provider_error', message: 'x' },
        page: { path: '/o/muster-ag', title: null },
      },
      locale,
    });
    expect(explain.statusCode).toBe(200);
    expect(json(explain)).toMatchObject({ severity: 'error', meta: { demo: true } });
    expect(json(explain).summary).toContain('provider_error');

    const [md] = await t.db.select().from(mailDomains).where(eq(mailDomains.orgId, musterId)).limit(1);
    const dns = await anna.post(`/orgs/${musterId}/ai/dns-check`, {
      domainId: null,
      mailDomainId: md!.id,
      locale,
    });
    expect(dns.statusCode).toBe(200);
    const check = json(dns);
    expect(check.meta.demo).toBe(true);
    expect(check.topics.length).toBeGreaterThan(0);
    expect(check.droppedProposals).toBe(0);
    for (const p of check.proposals) expect(p.verified).toBe(true);

    const audit = await anna.post(`/orgs/${musterId}/ai/audit-summary`, {
      period: 'month',
      action: null,
      resourceType: null,
      status: null,
      locale,
    });
    expect(audit.statusCode).toBe(200);
    expect(json(audit)).toMatchObject({ meta: { demo: true }, cut: false });
    expect(json(audit).summary).toMatch(/^\[Demo\] \d+ Einträge/);

    const [server] = await t.db
      .select({ id: servers.id })
      .from(servers)
      .innerJoin(projects, eq(projects.id, servers.projectId))
      .where(eq(projects.orgId, musterId))
      .limit(1);
    const health = await anna.post(`/orgs/${musterId}/ai/server-health`, {
      serverId: server!.id,
      range: 'day',
      locale,
    });
    expect(health.statusCode).toBe(200);
    expect(['ok', 'watch', 'problem']).toContain(json(health).overall);
    expect(json(health).meta.demo).toBe(true);

    const texts = await admin.post('/admin/ai/product-texts', {
      mode: 'translate',
      name: 'Webhosting S',
      description: 'Ein kleines Paket.',
      module: null,
      interval: 'monthly',
      notes: null,
      locales: ['en', 'fr'],
      locale,
    });
    expect(texts.statusCode).toBe(200);
    expect(json(texts).texts).toEqual({
      en: { name: '[EN] Webhosting S', description: '[EN] Ein kleines Paket.' },
      fr: { name: '[FR] Webhosting S', description: '[FR] Ein kleines Paket.' },
    });
    const rows = await t.db.select().from(aiUsage);
    expect(rows).toHaveLength(5);
    for (const row of rows) expect(row).toMatchObject({ demo: true, costMicros: 0, status: 'ok' });
  });

  it('translations: "[FR] <German text>" at cost 0', async () => {
    const adminId = (await t.db.query.users.findFirst({ where: eq(users.email, ADMIN.email) }))!.id;
    const result = await t.ctx.ai.structured({
      feature: 'translations',
      scope: 'platform',
      orgId: null,
      countsForUser: false,
      retryOnMaxTokens: false,
      actor: { userId: adminId },
      system: '# Feature: translations\n\nTranslate the items.',
      user: JSON.stringify({ locale: 'fr', items: [{ id: 'k1', de: 'Speichern {name}' }] }),
      schema: z.object({ items: z.array(z.object({ id: z.string(), text: z.string() })) }),
    });
    expect(result.data.items).toEqual([{ id: 'k1', text: '[FR] Speichern {name}' }]);
    expect(result.costMicros).toBe(0);
    expect(result.meta.demo).toBe(true);
  });
});

describe('a saved key', () => {
  it('ends demo mode', async () => {
    const saved = await admin.request('PUT', '/admin/ai/key', { key: MOCK_API_KEY });
    expect(saved.statusCode).toBe(200);
    try {
      expect(json(await anna.get('/ai/status'))).toMatchObject({ demo: false });
    } finally {
      await admin.del('/admin/ai/key');
    }
    expect(json(await anna.get('/ai/status'))).toMatchObject({ demo: true });
    expect(await t.db.select({ n: sql<number>`count(*)::int` }).from(aiUsage)).toEqual([{ n: 0 }]);
  });
});
