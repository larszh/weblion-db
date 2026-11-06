import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { aiUsage, auditLogs, domains, organizations } from '../src/db/schema';
import { MOCK_API_KEY, parseSse, startClaudeMock, type MockTurn } from './claude-mock';
import { ADMIN, Client, configureAi, createTestApp, json, type TestApp } from './helpers';

/**
 * No secret leaves the console (ai 11.2, 15.2): env secrets, the saved and the env Anthropic key and provider
 * passwords never appear in a request the Claude API receives, in a response, an audit entry, an ai_usage row or a
 * log line. Anthropic's own error text stays, redacted, in ai_usage.error_message for staff only.
 */

const SMTP_PASSWORD = 'Zorro-Garten-4711-Kiesel';
const WEBHOOK_SECRET = 'Fenster-Wolke-0815-Ahorn';
const ENV_KEY = 'sk-ant-api03-ENVKEY0000000000000000000001';
const FAKE_KEY = 'sk-ant-api03-PLANTEDKEY99999999999999';

let t: TestApp;
let mock: Awaited<ReturnType<typeof startClaudeMock>>;
let admin: Client;
let anna: Client;
let musterId: string;
const responses: string[] = [];
const logLines: string[] = [];
let restoreLog: () => void;

const script = (...turns: MockTurn[]) => mock.setScript((_b, i) => turns[Math.min(i, turns.length - 1)]);
const secrets = () => [
  SMTP_PASSWORD,
  WEBHOOK_SECRET,
  ENV_KEY,
  MOCK_API_KEY,
  FAKE_KEY,
  t.ctx.env.ENCRYPTION_KEY,
];

/** Every response body of the AI routes is kept, to be searched at the end. */
async function call(client: Client, method: string, url: string, body?: unknown) {
  const res = await client.request(method, url, body);
  // The AI module's answers; the console's own routes (the DNS record just added) are not searched.
  if (url.includes('/ai')) responses.push(res.body);
  return res;
}

function expectClean(haystack: string, what: string) {
  for (const secret of secrets()) expect(haystack.includes(secret), `${what} contains a secret`).toBe(false);
}

beforeAll(async () => {
  mock = await startClaudeMock();
  t = await createTestApp({
    env: {
      ANTHROPIC_BASE_URL: mock.url,
      ANTHROPIC_API_KEY: ENV_KEY,
      SMTP_PASSWORD,
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    },
  });
  // The test app logs into Fastify's null logger, whose child() is itself: capture every call made through it
  // (route logs, the module's warnings, the SDK's logger).
  const log = t.app.log as unknown as Record<string, (...args: unknown[]) => void>;
  const saved: Record<string, (...args: unknown[]) => void> = {};
  for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
    saved[level] = log[level]!;
    log[level] = (...args: unknown[]) => {
      logLines.push(
        JSON.stringify(args, (k, v) => {
          // Fastify's own request lines pass the request and reply objects; pino's serializers keep only these
          // fields of them in production (method, url, status), never headers or bodies.
          if (k === 'req' && v && typeof v === 'object') return { method: v.method, url: v.url };
          if (k === 'res' && v && typeof v === 'object') return { statusCode: v.statusCode };
          return v instanceof Error ? { ...v, message: v.message, stack: v.stack } : v;
        }),
      );
    };
  }
  restoreLog = () => Object.assign(log, saved);
  admin = new Client(t.app);
  await admin.login(ADMIN.email, ADMIN.password);
  await configureAi(admin);
  anna = new Client(t.app);
  await anna.login('anna@muster.example');
  musterId = (await t.db.query.organizations.findFirst({ where: eq(organizations.slug, 'muster-ag') }))!.id;
});
afterAll(async () => {
  restoreLog?.();
  await t?.close();
  await mock?.close();
});

describe('secrets', () => {
  it('a pasted secret, a planted TXT record and the provider data reach the model redacted', async () => {
    const [domain] = await t.db.select().from(domains).where(eq(domains.orgId, musterId)).limit(1);
    const added = await call(anna, 'POST', `/domains/${domain!.id}/dns`, {
      type: 'TXT',
      name: 'leak',
      data: `token=${SMTP_PASSWORD} ${FAKE_KEY}`,
    });
    expect(added.statusCode).toBe(200);
    script(
      { toolUses: [{ name: 'get_dns_records', input: { domain_id: domain!.id } }] },
      { text: 'Die Einträge sind gelesen.' },
    );
    const res = await call(anna, 'POST', `/orgs/${musterId}/ai/chat`, {
      messages: [
        {
          role: 'user',
          text: `Mein Schlüssel ist ${MOCK_API_KEY}, der alte ${ENV_KEY}, SMTP ${SMTP_PASSWORD}, ENCRYPTION_KEY ${t.ctx.env.ENCRYPTION_KEY}`,
          page: null,
        },
      ],
      locale: 'de',
    });
    expect(res.statusCode).toBe(200);
    expect(parseSse(res.body).at(-1)!.event).toBe('done');
    expect(mock.requests).toHaveLength(2);
    const bodies = JSON.stringify(mock.requests.map((r) => r.body));
    expectClean(bodies, 'a request body');
    expect(bodies).toContain('[hidden]');
    // The planted record is still there, its secret parts are not.
    expect(bodies).toContain('leak');
  });

  it("Anthropic's error text: a fixed message for the client, the redacted original only for staff", async () => {
    script({
      error: {
        status: 402,
        type: 'billing_error',
        message: `Your credit balance is too low. Workspace key ${MOCK_API_KEY}`,
      },
    });
    const res = await call(anna, 'POST', `/orgs/${musterId}/ai/chat`, {
      messages: [{ role: 'user', text: 'Hallo', page: null }],
      locale: 'de',
    });
    const event = parseSse(res.body).at(-1)!;
    expect(event).toMatchObject({
      event: 'error',
      data: { status: 502, code: 'ai_upstream', details: { reason: 'billing' } },
    });
    expect(event.data.message).toBe('The AI service could not process the request.');
    expect(res.body).not.toContain('credit');
    expect(res.body).not.toContain('balance');
    const [row] = await t.db.select().from(aiUsage).where(eq(aiUsage.errorReason, 'billing'));
    expect(row!.errorMessage).toContain('Your credit balance is too low');
    expect(row!.errorMessage).toContain('[hidden]');
    const errors = await call(admin, 'GET', '/admin/ai/errors');
    expect(json(errors).items[0]).toMatchObject({ errorCode: 'ai_upstream', errorReason: 'billing' });
    expect(json(errors).items[0].errorMessage).toContain('credit balance');
    // Customers never see the errors tab.
    expect((await call(anna, 'GET', '/admin/ai/errors')).statusCode).toBe(403);
  });

  it('the KI page never returns the key', async () => {
    const settings = await call(admin, 'GET', '/admin/ai/settings');
    expect(json(settings).key).toMatchObject({ source: 'ui', envSet: true });
    await call(admin, 'GET', '/admin/ai/usage');
    await call(admin, 'GET', `/admin/orgs/${musterId}/ai`);
    await call(anna, 'GET', `/orgs/${musterId}/ai`);
    await call(anna, 'GET', '/ai/status');
  });

  it('no secret in any response, audit entry, ai_usage row or log line', async () => {
    for (const body of responses) expectClean(body, 'a response');
    // The entries of the AI module; the console's own entry of the DNS record the person typed is not searched.
    const audit = (await t.db.select().from(auditLogs)).filter((a) => a.action.startsWith('ai.'));
    expect(audit.some((a) => a.action === 'ai.key_update')).toBe(true);
    expectClean(JSON.stringify(audit), 'the audit log');
    expectClean(JSON.stringify(await t.db.select().from(aiUsage)), 'ai_usage');
    expect(logLines.some((l) => l.includes('claude request failed'))).toBe(true);
    expectClean(logLines.join('\n'), 'the log');
  });
});
