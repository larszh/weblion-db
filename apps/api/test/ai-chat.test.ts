import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { aiUsage, auditLogs, domains, organizations, users } from '../src/db/schema';
import { CHAT_LIMITS, FINAL_STEP_NOTE } from '../src/modules/ai/chat';
import { SYSTEM_TEXT } from '../src/modules/ai/prompts';
import { toolDefinitions } from '../src/modules/ai/tools/registry';
import { parseSse, startClaudeMock, type MockTurn, type SseFrame } from './claude-mock';
import { ADMIN, Client, configureAi, createTestApp, json, type TestApp } from './helpers';

/** The chat turn as server-sent events (ai 6.4, 9, 15.2) against the Claude mock. */

let t: TestApp;
let mock: Awaited<ReturnType<typeof startClaudeMock>>;
let admin: Client;
let anna: Client;
let musterId: string;
let annaId: string;
let domainId: string;

const page = { path: '/o/muster-ag/servers', title: 'Server' };
const ask = (text = 'Wie viele Server habe ich?') => ({
  messages: [{ role: 'user', text, page }],
  locale: 'de',
});

async function chat(body: unknown = ask(), client: Client = anna) {
  const res = await client.post(`/orgs/${musterId}/ai/chat`, body);
  return { res, events: res.statusCode === 200 ? parseSse(res.body) : [] };
}

const names = (events: SseFrame[]) => events.map((e) => e.event);
const toolEvents = (events: SseFrame[]) => events.filter((e) => e.event === 'tool').map((e) => e.data);
const lastRow = async () =>
  (
    await t.db
      .select()
      .from(aiUsage)
      .orderBy(sql`${aiUsage.createdAt} desc`)
      .limit(1)
  )[0]!;
const script = (...turns: MockTurn[]) => mock.setScript((_b, i) => turns[Math.min(i, turns.length - 1)]);
const liveReads = () => (t.ctx.ai as unknown as { liveReads: Map<string, number[]> }).liveReads;
/** The tool results of the newest user message of a recorded request. */
const toolResults = (index: number) =>
  (mock.requests[index]!.body.messages.at(-1).content as any[]).filter((b) => b.type === 'tool_result');

beforeAll(async () => {
  mock = await startClaudeMock();
  t = await createTestApp({ env: { ANTHROPIC_BASE_URL: mock.url } });
  admin = new Client(t.app);
  await admin.login(ADMIN.email, ADMIN.password);
  await configureAi(admin);
  anna = new Client(t.app);
  await anna.login('anna@muster.example');
  musterId = (await t.db.query.organizations.findFirst({ where: eq(organizations.slug, 'muster-ag') }))!.id;
  annaId = (await t.db.query.users.findFirst({ where: eq(users.email, 'anna@muster.example') }))!.id;
  domainId = (await t.db.select().from(domains).where(eq(domains.orgId, musterId)))[0]!.id;
});
afterAll(async () => {
  await t?.close();
  await mock?.close();
});
beforeEach(async () => {
  await t.db.delete(aiUsage);
  liveReads().clear();
  mock.requests.length = 0;
  t.ctx.ai.chatPingMs = undefined;
  script({ text: 'Sie haben drei Server.' });
});

describe('stream', () => {
  it('answers text/event-stream with X-Accel-Buffering: no, meta first and exactly one done last', async () => {
    const { res, events } = await chat();
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(res.headers['x-accel-buffering']).toBe('no');
    expect(res.headers['cache-control']).toBe('no-cache, no-transform');
    expect(res.body.startsWith(': open\n\n')).toBe(true);
    expect(events[0]).toEqual({ event: 'meta', data: { model: 'claude-opus-5-5', demo: false } });
    expect(events.at(-1)).toEqual({
      event: 'done',
      data: { servedModel: 'claude-opus-5-5', fallback: false },
    });
    expect(events.filter((e) => e.event === 'done')).toHaveLength(1);
    expect(
      events
        .filter((e) => e.event === 'text')
        .map((e) => e.data.text)
        .join(''),
    ).toBe('Sie haben drei Server.');
    expect(await lastRow()).toMatchObject({
      feature: 'assistant',
      scope: 'org',
      orgId: musterId,
      status: 'ok',
      apiCalls: 1,
    });
  });

  it('pings while the answer streams', async () => {
    t.ctx.ai.chatPingMs = 20;
    script({ text: 'x'.repeat(400), streamDelayMs: 15 });
    const { res } = await chat();
    expect(res.body.match(/: ping\n\n/g)?.length ?? 0).toBeGreaterThan(0);
  });

  it('the request: exact model, adaptive thinking, effort medium, strict eager tools, auto tool choice, caching', async () => {
    await chat();
    const { body, headers } = mock.requests[0]!;
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.stream).toBe(true);
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body.output_config).toEqual({ effort: 'medium' });
    expect(body.tool_choice).toEqual({ type: 'auto' });
    expect(body.cache_control).toEqual({ type: 'ephemeral' });
    expect(body.system).toEqual([
      { type: 'text', text: SYSTEM_TEXT.assistant, cache_control: { type: 'ephemeral' } },
    ]);
    expect(body.fallbacks).toBe('default');
    expect(headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    expect(body.metadata).toEqual({
      user_id: createHash('sha256').update(`weblion-ai-user:${annaId}`).digest('hex').slice(0, 32),
    });
    expect(body.tools).toHaveLength(22);
    expect(body.tools.map((x: any) => x.name)).toEqual([...body.tools.map((x: any) => x.name)].sort());
    for (const tool of body.tools) {
      expect(tool.strict).toBe(true);
      expect(tool.eager_input_streaming).toBe(true);
      expect(tool.input_schema.additionalProperties).toBe(false);
    }
    expect(body.tools).toEqual(JSON.parse(JSON.stringify(toolDefinitions())));
    for (const field of ['temperature', 'top_p', 'top_k']) expect(body).not.toHaveProperty(field);
    expect(JSON.stringify(body)).not.toContain('budget_tokens');
    expect(body.messages.at(-1).role).toBe('user');
  });

  it('the <context> block carries the role and the page, never the name or the e-mail address', async () => {
    await chat({
      messages: [
        { role: 'user', text: 'Erste Frage', page: { path: '/o/muster-ag/domains', title: 'Domains <b>' } },
        { role: 'assistant', text: 'Erste Antwort' },
        { role: 'user', text: 'Zweite Frage', page },
      ],
      locale: 'de',
    });
    const messages = mock.requests[0]!.body.messages;
    expect(messages.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[1]).toEqual({ role: 'assistant', content: 'Erste Antwort' });
    expect(messages[0].content).toContain('role: owner\naccess: member\norganization_kind: customer');
    expect(messages[0].content).toContain('page: /o/muster-ag/domains\npage_title: Domains \\u003cb\\u003e');
    expect(messages[0].content).not.toContain('today:');
    expect(messages[2].content).toContain('page: /o/muster-ag/servers\npage_title: Server');
    expect(messages[2].content).toMatch(/today: \d{4}-\d{2}-\d{2} \(Europe\/Zurich\)/);
    expect(messages[2].content).toContain('language: de');
    expect(messages[2].content.endsWith('Zweite Frage')).toBe(true);
    const all = JSON.stringify(mock.requests[0]!.body);
    expect(all).not.toContain('Anna');
    expect(all).not.toContain('anna@muster.example');
  });
});

describe('tools', () => {
  it('runs two tool calls, answers them in one user message, then streams the answer', async () => {
    script(
      {
        text: 'Ich sehe nach.',
        thinking: true,
        toolUses: [
          { name: 'get_org_overview', input: {}, id: 'toolu_a' },
          { name: 'list_servers', input: { q: null, status: null, label: null }, id: 'toolu_b' },
        ],
      },
      { text: 'Sie haben fünf Server.' },
    );
    const { events } = await chat();
    const tools = toolEvents(events);
    expect(tools.slice(0, 2)).toEqual([
      { id: 'toolu_a', name: 'get_org_overview', status: 'running', live: false },
      { id: 'toolu_b', name: 'list_servers', status: 'running', live: false },
    ]);
    expect(tools.slice(2)).toEqual(
      expect.arrayContaining([
        { id: 'toolu_a', name: 'get_org_overview', status: 'done', live: false },
        { id: 'toolu_b', name: 'list_servers', status: 'done', live: false },
      ]),
    );
    expect(events.filter((e) => e.event === 'source').map((e) => e.data.path)).toEqual(
      expect.arrayContaining(['/o/muster-ag', '/o/muster-ag/servers']),
    );
    expect(names(events).at(-1)).toBe('done');
    expect(mock.requests).toHaveLength(2);
    const second = mock.requests[1]!.body.messages;
    expect(second).toHaveLength(3);
    // The assistant content goes back unchanged: the thinking block with its signature, the text, both tool calls.
    expect(second[1].role).toBe('assistant');
    expect(second[1].content.map((b: any) => b.type)).toEqual(['thinking', 'text', 'tool_use', 'tool_use']);
    expect(second[1].content[0].signature).toMatch(/^sig_mock_/);
    expect(second[2].role).toBe('user');
    expect(second[2].content.map((b: any) => [b.type, b.tool_use_id])).toEqual([
      ['tool_result', 'toolu_a'],
      ['tool_result', 'toolu_b'],
    ]);
    expect(JSON.parse(second[2].content[0].content)).toMatchObject({ name: 'Muster AG', kind: 'customer' });
    expect(JSON.parse(second[2].content[1].content)).toMatchObject({ truncated: false });
    // Without the UI-only arrays.
    expect(second[2].content[0].content).not.toContain('"permissions"');
    for (const request of mock.requests) expect(request.body.tool_choice).toEqual({ type: 'auto' });
    expect(JSON.stringify(mock.requests.map((r) => r.body))).not.toContain(FINAL_STEP_NOTE);
    const row = await lastRow();
    expect(row).toMatchObject({ status: 'ok', apiCalls: 2, toolCalls: 2, liveCalls: 0 });
  });

  it('an invalid or truncated tool input is answered with INVALID_JSON and the tool does not run', async () => {
    script(
      { toolUses: [{ name: 'get_server', input: {}, rawJson: '{"server_id": "abc', id: 'toolu_bad' }] },
      { text: 'Dazu fehlt mir die Server-ID.' },
    );
    const { events } = await chat();
    expect(toolEvents(events)).toEqual([]);
    const [result] = toolResults(1);
    expect(result).toMatchObject({ tool_use_id: 'toolu_bad', is_error: true });
    expect(JSON.parse(result.content)).toHaveProperty('INVALID_JSON');
    expect(names(events).at(-1)).toBe('done');
  });

  it('an unparseable tool input is re-issued once; a second time ends with ai_upstream', async () => {
    script(
      { toolUses: [{ name: 'get_org_overview', input: {}, rawJson: 'not json' }] },
      { text: 'Antwort.' },
    );
    let { events } = await chat();
    expect(mock.requests).toHaveLength(2);
    expect(mock.requests[1]!.body.messages).toEqual(mock.requests[0]!.body.messages);
    expect(names(events).at(-1)).toBe('done');
    expect(await lastRow()).toMatchObject({ status: 'ok', apiCalls: 2 });

    mock.requests.length = 0;
    script({ toolUses: [{ name: 'get_org_overview', input: {}, rawJson: 'not json' }] });
    ({ events } = await chat());
    expect(mock.requests).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ event: 'error', data: { status: 502, code: 'ai_upstream' } });
  });

  it('a tool call of another organization or an unknown id answers not_found', async () => {
    const beispiel = (await t.db.query.organizations.findFirst({
      where: eq(organizations.slug, 'beispiel-gmbh'),
    }))!;
    const foreign = (await t.db.select().from(domains).where(eq(domains.orgId, beispiel.id)))[0];
    script(
      {
        toolUses: [
          {
            name: 'get_domain',
            input: { domain_id: foreign?.id ?? '00000000-0000-4000-8000-000000000001' },
            id: 'x1',
          },
          { name: 'get_server', input: { server_id: '00000000-0000-4000-8000-000000000002' }, id: 'x2' },
        ],
      },
      { text: 'Nicht gefunden.' },
    );
    const { events } = await chat();
    expect(
      toolEvents(events)
        .filter((e) => e.status !== 'running')
        .map((e) => e.status),
    ).toEqual(['error', 'error']);
    for (const result of toolResults(1)) {
      expect(result.is_error).toBe(true);
      expect(JSON.parse(result.content)).toEqual({ error: 'not_found' });
    }
  });
});

describe('caps per turn (ai 6.4)', () => {
  it('at most 8 API calls: the note before the last one, its tool calls are not run, notice tool_limit', async () => {
    script({ toolUses: [{ name: 'get_org_overview', input: {} }] });
    const { events } = await chat();
    expect(mock.requests).toHaveLength(CHAT_LIMITS.apiCalls);
    const withNote = mock.requests.map(
      (r) =>
        (r.body.messages.at(-1).content as any[]).some?.(
          (b) => b.type === 'text' && b.text === FINAL_STEP_NOTE,
        ) ?? false,
    );
    expect(withNote).toEqual([false, false, false, false, false, false, false, true]);
    // The note is the last block, after the tool results.
    const last = mock.requests.at(-1)!.body.messages.at(-1).content as any[];
    expect(last.at(-1)).toEqual({ type: 'text', text: FINAL_STEP_NOTE });
    expect(last.slice(0, -1).every((b) => b.type === 'tool_result')).toBe(true);
    expect(toolEvents(events).filter((e) => e.status === 'done')).toHaveLength(7);
    expect(events.filter((e) => e.event === 'notice').map((e) => e.data)).toEqual([{ kind: 'tool_limit' }]);
    expect(names(events).at(-1)).toBe('done');
    expect(await lastRow()).toMatchObject({ status: 'incomplete', apiCalls: 8, toolCalls: 7 });
    for (const request of mock.requests) expect(request.body.tool_choice).toEqual({ type: 'auto' });
  });

  it('at most 24 tool calls: the 25th answers tool_limit, then the note', async () => {
    script({ toolUses: Array.from({ length: 5 }, () => ({ name: 'get_org_overview', input: {} })) });
    const { events } = await chat();
    expect(mock.requests).toHaveLength(6);
    const fifth = toolResults(5);
    expect(fifth.filter((r) => r.is_error).map((r) => JSON.parse(r.content))).toEqual([
      { error: 'tool_limit' },
    ]);
    expect((mock.requests[5]!.body.messages.at(-1).content as any[]).at(-1)).toEqual({
      type: 'text',
      text: FINAL_STEP_NOTE,
    });
    expect(events.filter((e) => e.event === 'notice').map((e) => e.data.kind)).toEqual(['tool_limit']);
    expect(await lastRow()).toMatchObject({ toolCalls: 24, status: 'incomplete' });
  });

  it('at most 8 live tool calls per turn and 30 live reads per organization and minute', async () => {
    script(
      { toolUses: Array.from({ length: 3 }, () => ({ name: 'get_domain', input: { domain_id: domainId } })) },
      { toolUses: Array.from({ length: 3 }, () => ({ name: 'get_domain', input: { domain_id: domainId } })) },
      { toolUses: Array.from({ length: 3 }, () => ({ name: 'get_domain', input: { domain_id: domainId } })) },
      { text: 'Fertig.' },
    );
    await chat();
    const third = toolResults(3).map((r) => (r.is_error ? JSON.parse(r.content) : 'ok'));
    expect(third).toEqual(['ok', 'ok', { error: 'live_limit' }]);
    expect(await lastRow()).toMatchObject({ toolCalls: 9, liveCalls: 8 });

    // The organization's sliding window: 30 live reads in the last minute.
    liveReads().set(
      musterId,
      Array.from({ length: 30 }, () => Date.now()),
    );
    mock.requests.length = 0;
    script({ toolUses: [{ name: 'get_domain', input: { domain_id: domainId } }] }, { text: 'Fertig.' });
    await chat();
    expect(JSON.parse(toolResults(1)[0].content)).toEqual({ error: 'live_limit' });
  });

  it('at most 120,000 characters of tool results; each result is cut at an item boundary', async () => {
    await t.db.insert(auditLogs).values(
      Array.from({ length: 60 }, (_, i) => ({
        action: 'server.update',
        orgId: musterId,
        status: 'success' as const,
        details: { note: `${i} ${'Eintrag '.repeat(110)}` },
      })),
    );
    try {
      script(
        {
          toolUses: Array.from({ length: 10 }, () => ({
            name: 'get_audit_log',
            input: { action: null, resource_type: null, status: null },
          })),
        },
        { text: 'Zusammengefasst.' },
      );
      await chat();
      const results = toolResults(1);
      const sizes = results.filter((r) => !r.is_error).map((r) => r.content.length);
      for (const size of sizes) expect(size).toBeLessThanOrEqual(CHAT_LIMITS.toolResultMaxChars);
      expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(CHAT_LIMITS.toolResultChars);
      const parsed = JSON.parse(results[0].content);
      expect(parsed.truncated).toBe(true);
      expect(parsed.items.length).toBeLessThan(50);
      expect(results.filter((r) => r.is_error).map((r) => JSON.parse(r.content))).toContainEqual({
        error: 'result_limit',
      });
    } finally {
      await t.db.delete(auditLogs).where(eq(auditLogs.action, 'server.update'));
    }
  });

  it('a turn costs at most 5 times its estimate', async () => {
    script({ toolUses: [{ name: 'get_org_overview', input: {} }], usage: { output_tokens: 100_000 } });
    const { events } = await chat();
    expect(mock.requests).toHaveLength(1);
    expect(toolEvents(events)).toEqual([]);
    expect(events.filter((e) => e.event === 'notice').map((e) => e.data.kind)).toEqual(['tool_limit']);
    expect(await lastRow()).toMatchObject({ status: 'incomplete' });
  });

  it('the monthly budget used up after call 2 stops the turn with budget_stop', async () => {
    await configureAi(admin, { budgetUsd: 1 });
    try {
      script(
        { toolUses: [{ name: 'get_org_overview', input: {} }] },
        { toolUses: [{ name: 'get_org_overview', input: {} }], usage: { output_tokens: 60_000 } },
        { text: 'nie' },
      );
      const { events } = await chat();
      expect(mock.requests).toHaveLength(2);
      expect(events.filter((e) => e.event === 'notice').map((e) => e.data.kind)).toEqual(['budget_stop']);
      expect(names(events).at(-1)).toBe('done');
      expect(await lastRow()).toMatchObject({ status: 'incomplete', apiCalls: 2 });
    } finally {
      await configureAi(admin);
    }
  });
});

describe('stop reasons and errors', () => {
  it('a refusal ends with an error event 422 and no done', async () => {
    script({ text: 'Ich beginne', stopReason: 'refusal', refusalCategory: 'cyber' });
    const { events } = await chat();
    expect(events.at(-1)).toEqual({
      event: 'error',
      data: {
        status: 422,
        code: 'ai_refusal',
        message: 'Claude declined to answer this request.',
        details: { category: 'cyber' },
      },
    });
    expect(names(events)).not.toContain('done');
    expect(await lastRow()).toMatchObject({ status: 'refusal', errorCode: 'ai_refusal' });
  });

  it('max_tokens with a tool_use runs nothing and ends with the notice incomplete', async () => {
    script({ toolUses: [{ name: 'get_org_overview', input: {} }], stopReason: 'max_tokens' });
    const { events } = await chat();
    expect(mock.requests).toHaveLength(1);
    expect(toolEvents(events)).toEqual([]);
    expect(events.filter((e) => e.event === 'notice').map((e) => e.data.kind)).toEqual(['incomplete']);
    expect(names(events).at(-1)).toBe('done');
    expect(await lastRow()).toMatchObject({ status: 'incomplete' });
  });

  it('a mid-answer fallback: the tool call before the fallback block is neither run nor re-sent', async () => {
    script(
      {
        text: 'Ich prüfe das jetzt gerne für Sie und schaue mir die Daten an.',
        fallbackTo: {
          model: 'claude-opus-5',
          afterFrames: 1,
          toolUsesBefore: [{ name: 'get_org_overview', input: {}, id: 'toolu_before' }],
        },
        toolUses: [{ name: 'list_domains', input: {}, id: 'toolu_after' }],
      },
      { text: 'Sie haben zwei Domains.' },
    );
    const { events } = await chat();
    expect(toolEvents(events).map((e) => e.id)).toEqual(['toolu_after', 'toolu_after']);
    const echoed = mock.requests[1]!.body.messages[1].content as any[];
    expect(echoed.map((b) => b.type)).toEqual(['text', 'fallback', 'text', 'tool_use']);
    expect(JSON.stringify(echoed)).not.toContain('toolu_before');
    expect(toolResults(1).map((r) => r.tool_use_id)).toEqual(['toolu_after']);
    expect(events.at(-1)).toEqual({ event: 'done', data: { servedModel: 'claude-opus-5', fallback: true } });
    expect(await lastRow()).toMatchObject({ servedModel: 'claude-opus-5', status: 'ok' });
  });

  it('a mid-stream overloaded_error ends with ai_busy, a lost connection with ai_upstream network', async () => {
    script({ text: 'x'.repeat(200), midStreamError: { type: 'overloaded_error', afterFrames: 3 } });
    let { events } = await chat();
    expect(events.at(-1)).toMatchObject({
      event: 'error',
      data: { status: 503, code: 'ai_busy', details: { reason: 'overloaded' } },
    });
    script({ text: 'abgebrochen', closedEarly: true });
    ({ events } = await chat());
    expect(events.at(-1)).toMatchObject({
      event: 'error',
      data: { status: 502, code: 'ai_upstream', details: { reason: 'network' } },
    });
    expect(await lastRow()).toMatchObject({
      status: 'error',
      errorCode: 'ai_upstream',
      errorReason: 'network',
    });
  });

  it('a turn over AI_TURN_TIMEOUT_SECONDS ends with ai_timeout', async () => {
    const env = t.ctx.env as { AI_TURN_TIMEOUT_SECONDS: number };
    const before = env.AI_TURN_TIMEOUT_SECONDS;
    env.AI_TURN_TIMEOUT_SECONDS = 1;
    try {
      script({ text: 'spät', delayMs: 2_500 });
      const { events } = await chat();
      expect(events.at(-1)).toMatchObject({ event: 'error', data: { status: 504, code: 'ai_timeout' } });
      expect(await lastRow()).toMatchObject({ status: 'error', errorCode: 'ai_timeout' });
    } finally {
      env.AI_TURN_TIMEOUT_SECONDS = before;
    }
  });

  it('a client that goes away cancels the turn (status cancelled)', async () => {
    const address = await t.app.listen({ port: 0, host: '127.0.0.1' });
    const login = await fetch(`${address}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'test' },
      body: JSON.stringify({ email: 'anna@muster.example', password: 'demo-password-123' }),
    });
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    script({ text: 'y'.repeat(2_000), streamDelayMs: 20 });
    const controller = new AbortController();
    const res = await fetch(`${address}/api/v1/orgs/${musterId}/ai/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-requested-with': 'test',
        cookie,
        accept: 'text/event-stream',
      },
      body: JSON.stringify(ask()),
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain(': open');
    controller.abort();
    for (let i = 0; i < 100; i++) {
      const row = await lastRow();
      if (row && row.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(await lastRow()).toMatchObject({ status: 'cancelled', reservedMicros: 0 });
  });
});

describe('history and gates', () => {
  it('validates the history: 40 messages, alternation, user first and last, lengths, page only on user messages', async () => {
    const turns = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        i % 2 === 0 ? { role: 'user', text: `F ${i}` } : { role: 'assistant', text: `A ${i}` },
      );
    const bad = [
      { messages: turns(41), locale: 'de' },
      {
        messages: [
          { role: 'user', text: 'a' },
          { role: 'user', text: 'b' },
        ],
        locale: 'de',
      },
      {
        messages: [
          { role: 'assistant', text: 'a' },
          { role: 'user', text: 'b' },
        ],
        locale: 'de',
      },
      { messages: turns(2), locale: 'de' },
      { messages: [{ role: 'user', text: 'x'.repeat(4_001) }], locale: 'de' },
      {
        messages: [
          { role: 'user', text: 'a' },
          { role: 'assistant', text: 'x'.repeat(16_001) },
          { role: 'user', text: 'b' },
        ],
        locale: 'de',
      },
      {
        messages: [
          { role: 'user', text: 'a' },
          { role: 'assistant', text: 'b', page },
          { role: 'user', text: 'c' },
        ],
        locale: 'de',
      },
      {
        messages: [{ role: 'user', text: 'a', page: { path: 'https://evil.example/', title: null } }],
        locale: 'de',
      },
      { messages: [{ role: 'user', text: 'a' }], locale: 'es' },
    ];
    for (const body of bad) expect((await anna.post(`/orgs/${musterId}/ai/chat`, body)).statusCode).toBe(400);
    expect(mock.requests).toHaveLength(0);
    const ok = await anna.post(`/orgs/${musterId}/ai/chat`, { messages: turns(39), locale: 'en' });
    expect(ok.statusCode).toBe(200);
  });

  it('API tokens get 403 (the tool layer replays the session cookie)', async () => {
    const created = json(await anna.post(`/orgs/${musterId}/tokens`, { name: 'ai', scope: 'read_write' }));
    const tokenClient = new Client(t.app);
    tokenClient.bearer = created.token;
    const res = await tokenClient.post(`/orgs/${musterId}/ai/chat`, ask());
    expect(res.statusCode).toBe(403);
    expect(mock.requests).toHaveLength(0);
  });

  it('roles without ai:use get 403 forbidden; viewers may chat', async () => {
    const ben = new Client(t.app);
    await ben.login('ben@muster.example');
    const refused = await ben.post(`/orgs/${musterId}/ai/chat`, ask());
    expect(refused.statusCode).toBe(403);
    expect(json(refused).error.code).toBe('forbidden');
    const carla = new Client(t.app);
    await carla.login('carla@muster.example');
    expect((await carla.post(`/orgs/${musterId}/ai/chat`, ask())).statusCode).toBe(200);
    expect(mock.requests.at(-1)!.body.messages[0].content).toContain('role: viewer');
  });

  it('staff chat inside a customer is a staff request on the customer, with the staff role in <context>', async () => {
    const { res } = await chat(ask(), admin);
    expect(res.statusCode).toBe(200);
    expect(await lastRow()).toMatchObject({ scope: 'staff', orgId: musterId });
    expect(mock.requests.at(-1)!.body.messages[0].content).toContain(
      'role: weblion staff (superadmin)\naccess: staff',
    );
  });

  it('a limit refuses as plain JSON before the stream opens', async () => {
    await t.db.insert(aiUsage).values(
      Array.from({ length: 2 }, () => ({
        feature: 'assistant' as const,
        scope: 'org' as const,
        orgId: musterId,
        userId: annaId,
        model: 'claude-opus-5-5' as const,
        status: 'running' as const,
      })),
    );
    const res = await anna.post(`/orgs/${musterId}/ai/chat`, ask());
    expect(res.statusCode).toBe(429);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['retry-after']).toBe('5');
    expect(json(res).error.details.limit).toBe('user_concurrent');
  });
});
