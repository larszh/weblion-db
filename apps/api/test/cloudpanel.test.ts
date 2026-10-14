import { describe, expect, it, vi } from 'vitest';
import { AppError, ProviderError } from '../src/lib/errors';
import { CloudPanelAdapter, cloudPanelVersionAtLeast } from '../src/providers/cloudpanel/adapter';
import { CloudPanelClient, type CloudPanelLog } from '../src/providers/cloudpanel/client';
import { generateCloudPanelKeyPair, publicKeyLine } from '../src/providers/cloudpanel/keys';
import {
  OP_TIMEOUT_MS,
  buildRequest,
  parseAnswer,
  redactSecrets,
  toRemoteWebsite,
  wireSiteSchema,
} from '../src/providers/cloudpanel/protocol';
import type { ExecResult, SshTransport } from '../src/providers/cloudpanel/ssh';
import type { CloudPanelConfig, WebsiteInput, WireInfo, WireSite } from '../src/providers/types';

// ---------------------------------------------------------------------------
// A fake SSH transport: records every request line and answers like weblion-clp does (one JSON
// line on stdout, exit code 0 with ok: true or 1 with ok: false), from a queue or a function.

interface SentRequest {
  v: number;
  op: string;
  requestId: string;
  args: Record<string, unknown>;
  secrets?: Record<string, string>;
}

type Answer = ExecResult | Error | ((request: SentRequest) => ExecResult | Promise<ExecResult>);

class FakeTransport implements SshTransport {
  readonly lines: string[] = [];
  readonly requests: SentRequest[] = [];
  readonly timeouts: number[] = [];
  readonly queue: Answer[] = [];
  fallback: Answer | null = null;
  running = 0;
  maxRunning = 0;
  closed = 0;

  async exec(input: string, timeoutMs: number): Promise<ExecResult> {
    this.lines.push(input);
    const request = JSON.parse(input) as SentRequest;
    this.requests.push(request);
    this.timeouts.push(timeoutMs);
    this.running++;
    this.maxRunning = Math.max(this.maxRunning, this.running);
    try {
      const next = this.queue.shift() ?? this.fallback;
      if (!next) throw new Error(`no answer queued for ${request.op}`);
      if (next instanceof Error) throw next;
      if (typeof next === 'function') return await next(request);
      return next;
    } finally {
      this.running--;
    }
  }

  close(): void {
    this.closed++;
  }

  answer(...answers: Answer[]) {
    this.queue.push(...answers);
    return this;
  }
}

const ok = (data: unknown): ExecResult => ({
  stdout: `${JSON.stringify({ v: 1, ok: true, data })}\n`,
  stderr: '',
  code: 0,
  signal: null,
});
const fail = (error: Record<string, unknown>): ExecResult => ({
  stdout: `${JSON.stringify({ v: 1, ok: false, error })}\n`,
  stderr: '',
  code: 1,
  signal: null,
});

const SITE: WireSite = {
  domain: 'shop.mueller.ch',
  type: 'php',
  siteUser: 'shop-mueller-ch',
  homeDirectory: '/home/shop-mueller-ch',
  webRoot: '/home/shop-mueller-ch/htdocs/shop.mueller.ch',
  application: 'WordPress',
  phpVersion: '8.4',
  nodejsVersion: null,
  appPort: null,
  createdAt: '2026-10-11T12:00:00Z',
  certificate: { type: '2', letsEncrypt: true, expiresAt: '2027-01-09T12:00:00Z' },
  databases: [{ name: 'shop_mueller_ch_wp', users: ['shop_mueller_ch_wp'], sizeBytes: 3145728 }],
  usage: { diskBytes: 52428800, databaseBytes: 3145728, measuredAt: '2026-10-11T06:00:00Z' },
};

const INFO: WireInfo = {
  agentVersion: '1.0.0',
  protocol: 1,
  cloudpanelVersion: '2.5.4-3+clp-noble',
  hostname: 'web1.weblion.cloud',
  os: 'Ubuntu 24.04.3 LTS',
  ipv4: ['203.0.113.10'],
  ipv6: ['2001:db8::10'],
  phpVersions: ['8.5', '8.4', '8.3', '8.2', '7.4'],
  templates: [
    { name: 'Generic', rootDirectory: '' },
    { name: 'WordPress', rootDirectory: '' },
    { name: 'WooCommerce', rootDirectory: '' },
    { name: 'Laravel 13', rootDirectory: 'public' },
    { name: 'Laravel 12', rootDirectory: 'public' },
    { name: 'Drupal 11', rootDirectory: 'web' },
    { name: 'Static', rootDirectory: '' },
    { name: 'Nodejs', rootDirectory: null },
    { name: 'Python', rootDirectory: null },
    { name: 'ReverseProxy', rootDirectory: null },
  ],
  nodejsVersions: ['18', '20', '22', '24'],
  nodejsEnabled: true,
  allowRemoteAdopt: false,
  protectedDomains: ['cp.weblion.cloud'],
  counts: { sites: 7, managed: 5, unmanaged: 2 },
  cliVersion: 'CloudPanel CLI 6.0.8',
};

const KEYS = generateCloudPanelKeyPair();
const CONFIG: CloudPanelConfig = {
  host: 'web1.weblion.cloud',
  port: 22,
  username: 'weblion-agent',
  privateKey: KEYS.privateKey,
  hostKeySha256: `SHA256:${'A'.repeat(43)}`,
};

const PASSWORD = 'Xq7vT2mKc9RwLp4s';
const DB_PASSWORD = 'Hb3nW8zQe5YtJr6u';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function setup(config: Partial<CloudPanelConfig> = {}, options: { now?: () => number } = {}) {
  const transport = new FakeTransport();
  const warn = vi.fn<CloudPanelLog['warn']>();
  const adapter = new CloudPanelAdapter({ ...CONFIG, ...config }, { transport, log: { warn }, ...options });
  return { adapter, transport, warn };
}

const PHP_INPUT: WebsiteInput = {
  domain: 'shop.mueller.ch',
  type: 'php',
  phpVersion: '8.4',
  template: 'WordPress',
  nodejsVersion: null,
  siteUser: 'shop-mueller-ch',
  password: PASSWORD,
  database: { name: 'shop_mueller_ch_wp', userName: 'shop_mueller_ch_wp', password: DB_PASSWORD },
};

/** The error a promise rejects with (fails the test when it resolves). */
async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return err as AppError;
  }
  throw new Error('expected a rejection');
}

describe('CloudPanel requests', () => {
  it('sends one line per operation with exactly the arguments of the wire protocol', async () => {
    const { adapter, transport } = setup();
    const siteAnswer = ok({ site: SITE });
    transport.answer(
      ok(INFO),
      ok({ sites: [SITE] }),
      siteAnswer,
      ok({ sites: [], allowRemoteAdopt: false }),
      ok({ site: SITE, warnings: [] }),
      ok({ site: { ...SITE, type: 'static', application: null, phpVersion: null }, warnings: [] }),
      ok({ site: { ...SITE, type: 'nodejs', nodejsVersion: '22', appPort: 3001 }, warnings: [] }),
      ok({ warnings: [] }),
      ok({}),
      siteAnswer,
      ok({}),
      siteAnswer,
      siteAnswer,
      siteAnswer,
      ok({}),
    );

    await adapter.testConnection();
    await adapter.listWebsites();
    await adapter.getWebsite('shop.mueller.ch');
    await adapter.listUnmanagedWebsites();
    await adapter.createWebsite(PHP_INPUT);
    await adapter.createWebsite({
      ...PHP_INPUT,
      domain: 'static.mueller.ch',
      type: 'static',
      phpVersion: null,
      template: null,
      siteUser: 'static-mueller-ch',
      database: null,
    });
    await adapter.createWebsite({
      ...PHP_INPUT,
      domain: 'api.mueller.ch',
      type: 'nodejs',
      // Left over from the form: only the fields of the type are sent.
      phpVersion: '8.4',
      template: 'WordPress',
      nodejsVersion: '22',
      siteUser: 'api-mueller-ch',
      database: null,
    });
    await adapter.deleteWebsite('shop.mueller.ch');
    await adapter.setWebsitePassword('shop.mueller.ch', PASSWORD);
    await adapter.createWebsiteDatabase('shop.mueller.ch', {
      name: 'shop_mueller_ch_shop',
      userName: 'shop_mueller_ch_shop',
      password: DB_PASSWORD,
    });
    await adapter.setWebsiteDatabasePassword(
      'shop.mueller.ch',
      'shop_mueller_ch_wp',
      'shop_mueller_ch_wp',
      DB_PASSWORD,
    );
    await adapter.deleteWebsiteDatabase('shop.mueller.ch', 'shop_mueller_ch_shop');
    await adapter.issueWebsiteCertificate('shop.mueller.ch');
    await adapter.adoptWebsite('legacy.kunde.ch');
    await adapter.forgetWebsite('legacy.kunde.ch');

    const domain = 'shop.mueller.ch';
    const expected: [string, Record<string, unknown>, Record<string, string> | undefined][] = [
      ['info', {}, undefined],
      ['list', {}, undefined],
      ['get', { domain }, undefined],
      ['unmanaged', {}, undefined],
      [
        'create',
        {
          domain,
          type: 'php',
          phpVersion: '8.4',
          template: 'WordPress',
          siteUser: 'shop-mueller-ch',
          database: { name: 'shop_mueller_ch_wp', userName: 'shop_mueller_ch_wp' },
        },
        { password: PASSWORD, databasePassword: DB_PASSWORD },
      ],
      [
        'create',
        { domain: 'static.mueller.ch', type: 'static', siteUser: 'static-mueller-ch' },
        { password: PASSWORD },
      ],
      [
        'create',
        { domain: 'api.mueller.ch', type: 'nodejs', nodejsVersion: '22', siteUser: 'api-mueller-ch' },
        { password: PASSWORD },
      ],
      ['delete', { domain }, undefined],
      ['password', { domain }, { password: PASSWORD }],
      [
        'db-add',
        { domain, name: 'shop_mueller_ch_shop', userName: 'shop_mueller_ch_shop' },
        { password: DB_PASSWORD },
      ],
      [
        'db-password',
        { domain, name: 'shop_mueller_ch_wp', userName: 'shop_mueller_ch_wp' },
        { password: DB_PASSWORD },
      ],
      ['db-delete', { domain, name: 'shop_mueller_ch_shop' }, undefined],
      ['cert', { domain }, undefined],
      ['adopt', { domain: 'legacy.kunde.ch' }, undefined],
      ['forget', { domain: 'legacy.kunde.ch' }, undefined],
    ];
    expect(transport.requests).toHaveLength(expected.length);
    const ids = new Set<string>();
    transport.requests.forEach((request, i) => {
      const [op, args, secrets] = expected[i]!;
      expect(Object.keys(request).sort()).toEqual(
        secrets ? ['args', 'op', 'requestId', 'secrets', 'v'] : ['args', 'op', 'requestId', 'v'],
      );
      expect(request).toMatchObject({ v: 1, op });
      expect(request.requestId).toMatch(UUID);
      ids.add(request.requestId);
      expect(request.args).toEqual(args);
      expect(request.secrets).toEqual(secrets);
      // Passwords only ever travel in secrets.
      const argText = JSON.stringify(request.args);
      expect(argText).not.toContain(PASSWORD);
      expect(argText).not.toContain(DB_PASSWORD);
      expect(transport.timeouts[i]).toBe(OP_TIMEOUT_MS[op as keyof typeof OP_TIMEOUT_MS]);
      // Exactly one line: the agent reads one JSON object.
      expect(transport.lines[i]).not.toContain('\n');
    });
    expect(ids.size).toBe(expected.length);
  });

  it('builds requests without empty fields and without a secrets key when there is none', () => {
    const line = buildRequest('get', { domain: 'a.ch' }, undefined, 'id-1');
    expect(JSON.parse(line)).toEqual({ v: 1, op: 'get', requestId: 'id-1', args: { domain: 'a.ch' } });
    const create = JSON.parse(
      buildRequest(
        'create',
        { domain: 'a.ch', type: 'static', siteUser: 'a-ch', phpVersion: undefined },
        { password: PASSWORD, databasePassword: undefined },
      ),
    );
    expect(create.args).toEqual({ domain: 'a.ch', type: 'static', siteUser: 'a-ch' });
    expect(create.secrets).toEqual({ password: PASSWORD });
    expect(create.requestId).toMatch(UUID);
    expect(Object.keys(JSON.parse(buildRequest('info', {}, {})))).not.toContain('secrets');
  });

  it('refuses invalid input before anything is sent', async () => {
    const { adapter, transport } = setup();
    const cases: [Partial<WebsiteInput>, string][] = [
      [{ domain: 'Shop.Mueller.CH' }, 'domain'],
      [{ domain: 'müller.ch' }, 'domain'],
      [{ domain: 'shop' }, 'domain'],
      [{ domain: '1.2.3.4' }, 'domain'],
      [{ domain: 'shop.ch; rm -rf /' }, 'domain'],
      [{ type: 'python' as WebsiteInput['type'] }, 'type'],
      [{ siteUser: 'Shop' }, 'siteUser'],
      [{ siteUser: 'root' }, 'siteUser'],
      [{ siteUser: 'weblion-cp' }, 'siteUser'],
      [{ siteUser: 'ab' }, 'siteUser'],
      [{ siteUser: 'shop;id' }, 'siteUser'],
      [{ template: 'Generic; rm -rf /' }, 'template'],
      [{ template: null }, 'template'],
      [{ phpVersion: '8.4; id' }, 'phpVersion'],
      [{ phpVersion: '84' }, 'phpVersion'],
      [{ phpVersion: null }, 'phpVersion'],
      [{ password: 'Abcdefgh1234$' }, 'password'],
      [{ password: "Abcdefgh1234'" }, 'password'],
      [{ password: 'Abcdefgh123' }, 'password'],
      [{ type: 'nodejs', nodejsVersion: '19' }, 'nodejsVersion'],
      [{ type: 'nodejs', nodejsVersion: null }, 'nodejsVersion'],
      [{ database: { name: 'other_wp', userName: 'other_wp', password: DB_PASSWORD } }, 'database'],
      [{ database: { name: 'shop_mueller_ch_wp', userName: 'root', password: DB_PASSWORD } }, 'database'],
      [
        { database: { name: 'shop_mueller_ch_wp', userName: 'shop_mueller_ch_wp', password: 'x$y' } },
        'database',
      ],
    ];
    for (const [patch, field] of cases) {
      const err = await rejection(adapter.createWebsite({ ...PHP_INPUT, ...patch }));
      expect(err.statusCode, JSON.stringify(patch)).toBe(400);
      expect(err.details).toEqual([{ path: field, message: err.message }]);
    }
    for (const call of [
      () => adapter.getWebsite('../etc/passwd'),
      () => adapter.deleteWebsite('shop.ch --force'),
      () => adapter.setWebsitePassword('shop.mueller.ch', "pa'ss word 123"),
      () =>
        adapter.createWebsiteDatabase('shop.mueller.ch', {
          name: 'a-b',
          userName: 'a_b',
          password: PASSWORD,
        }),
      () => adapter.setWebsiteDatabasePassword('shop.mueller.ch', 'mysql', 'mysql', PASSWORD),
      () => adapter.deleteWebsiteDatabase('shop.mueller.ch', "x'; DROP DATABASE y; --"),
      () => adapter.issueWebsiteCertificate(''),
      () => adapter.adoptWebsite('$(id).ch'),
      () => adapter.forgetWebsite('a b.ch'),
    ]) {
      expect((await rejection(call())).statusCode).toBe(400);
    }
    expect(transport.requests).toHaveLength(0);
  });
});

describe('CloudPanel answers', () => {
  it('ignores unknown fields and refuses other protocol versions', async () => {
    const { adapter, transport } = setup();
    transport.answer(
      ok({
        site: { ...SITE, flavour: 'new', certificate: { ...SITE.certificate, issuer: 'R11' } },
        extra: 1,
      }),
      {
        stdout: `${JSON.stringify({ v: 1, ok: true, data: { site: SITE }, serverTime: 'now' })}\n`,
        stderr: '',
        code: 0,
        signal: null,
      },
      {
        stdout: `${JSON.stringify({ v: 2, ok: true, data: { site: SITE } })}\n`,
        stderr: '',
        code: 0,
        signal: null,
      },
    );
    const website = await adapter.getWebsite('shop.mueller.ch');
    expect(website).toEqual(toRemoteWebsite(SITE));
    expect(JSON.stringify(website)).not.toContain('flavour');
    expect(JSON.stringify(website)).not.toContain('R11');
    expect(await adapter.getWebsite('shop.mueller.ch')).toEqual(toRemoteWebsite(SITE));
    const err = await rejection(adapter.getWebsite('shop.mueller.ch'));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.statusCode).toBe(502);
    expect(err.message).toContain('Invalid answer from the agent');
  });

  it('refuses data that does not fit the operation', async () => {
    const { adapter, transport } = setup();
    transport.answer(ok({ site: { ...SITE, type: 'perl' } }), ok({ sites: 'none' }));
    expect((await rejection(adapter.getWebsite('shop.mueller.ch'))).message).toMatch(
      /Invalid answer from the agent on web1.weblion.cloud to "get" at site.type/,
    );
    expect((await rejection(adapter.listWebsites())).message).toContain('Invalid answer');
  });

  it('maps every error code of the agent', async () => {
    const message = 'Something went wrong on the server.';
    const cases: [Record<string, unknown>, number, string, unknown][] = [
      [{ code: 'invalid', field: 'siteUser', message }, 400, 'bad_request', [{ path: 'siteUser', message }]],
      [{ code: 'invalid', message }, 400, 'bad_request', []],
      [{ code: 'exists', field: 'domain', message }, 409, 'exists', { field: 'domain' }],
      [{ code: 'not_found', message }, 404, 'provider_error', undefined],
      [{ code: 'not_managed', message }, 409, 'not_managed', undefined],
      [{ code: 'protected', message }, 409, 'protected', undefined],
      [{ code: 'adopt_disabled', message }, 409, 'adopt_disabled', undefined],
      [{ code: 'busy', message }, 503, 'busy', undefined],
      [{ code: 'version', message }, 422, 'unsupported', undefined],
      [
        { code: 'clpctl_failed', message, rolledBack: true, output: 'siteUser: This value already exists.' },
        502,
        'provider_error',
        { rolledBack: true, output: 'siteUser: This value already exists.' },
      ],
      [{ code: 'timeout', message, rolledBack: false }, 502, 'provider_error', { rolledBack: false }],
      [{ code: 'internal', message }, 502, 'provider_error', undefined],
      // A code this console does not know yet is still an error.
      [{ code: 'quota', message }, 502, 'provider_error', undefined],
    ];
    for (const [error, status, code, details] of cases) {
      const { adapter, transport } = setup();
      transport.answer(fail(error));
      const err = await rejection(adapter.createWebsite(PHP_INPUT));
      expect([err.statusCode, err.code], JSON.stringify(error)).toEqual([status, code]);
      expect(err.details).toEqual(details);
      expect(err.message).toContain(message);
      if (err instanceof ProviderError) expect(err.message).toMatch(/^CloudPanel: /);
    }
  });

  it('explains transport failures', async () => {
    const cases: [ExecResult, RegExp][] = [
      [
        { stdout: '', stderr: 'sudo: a password is required\n', code: 1, signal: null },
        /The agent did not answer \(sudo: a password is required\)\. Is weblion-clp installed and the sudoers file in place\?/,
      ],
      [
        { stdout: '', stderr: 'sh: 1: /usr/local/sbin/weblion-clp: not found\n', code: 127, signal: null },
        /weblion-clp is not installed on web1\.weblion\.cloud/,
      ],
      [{ ...fail({ code: 'internal', message: 'x' }), code: 0 }, /Invalid answer from the agent/],
      [{ ...ok({ site: SITE }), code: 1 }, /Invalid answer from the agent/],
      [
        { stdout: 'Traceback (most recent call last):\n', stderr: '', code: 0, signal: null },
        /Invalid answer/,
      ],
      [
        { stdout: '', stderr: 'Segmentation fault\n', code: 139, signal: null },
        /exit code 139: Segmentation fault/,
      ],
      [
        { stdout: '', stderr: '', code: null, signal: 'SIGKILL' },
        /ended before the agent answered \(SIGKILL\)/,
      ],
    ];
    for (const [result, pattern] of cases) {
      const { adapter, transport } = setup();
      transport.answer(result);
      const err = await rejection(adapter.getWebsite('shop.mueller.ch'));
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.statusCode).toBe(502);
      expect(err.message).toMatch(pattern);
    }
    // Only a missing agent is certain to have done nothing.
    const missing = setup();
    missing.transport.answer({ stdout: '', stderr: '', code: 127, signal: null });
    expect((await rejection(missing.adapter.createWebsite(PHP_INPUT))).details).toEqual({ rolledBack: true });
    const crashed = setup();
    crashed.transport.answer({ stdout: '', stderr: 'Traceback', code: 1, signal: null });
    expect((await rejection(crashed.adapter.createWebsite(PHP_INPUT))).details).toBeUndefined();

    // A note on stdout before the answer line does no harm: the last line counts.
    const { adapter, transport } = setup();
    transport.answer({
      ...ok({ site: SITE }),
      stdout: `notice: slow disk\n${ok({ site: SITE }).stdout}\n\n`,
    });
    expect((await adapter.getWebsite('shop.mueller.ch')).domain).toBe('shop.mueller.ch');
  });

  it('never lets a password out in errors, details, warnings or the log', async () => {
    const THROW_AWAY = 'Tq8wErTy5uIoP3aSdFgHjKl9ZxCvBnM1';
    const leaky =
      `Command " : /usr/bin/sudo /usr/sbin/useradd -p $(/usr/bin/openssl passwd -6 '${THROW_AWAY}') -m ` +
      `'shop-mueller-ch'" failed; mysql: ALTER USER 'u'@'localhost' IDENTIFIED BY 'Other-Secret-1'; ` +
      `clpctl site:add:php --siteUserPassword=${THROW_AWAY} --databaseUserPassword=Another1; ` +
      `chpasswd got ${PASSWORD}, database ${DB_PASSWORD}`;
    const { adapter, transport, warn } = setup();
    transport.answer(
      fail({ code: 'clpctl_failed', message: leaky, output: leaky, rolledBack: true }),
      { stdout: '', stderr: `sudo: weblion-clp ${PASSWORD}\n`, code: 1, signal: null },
      new Error(`socket hang up while sending ${PASSWORD}`),
      ok({ site: SITE, warnings: [`The database could not be created: ${DB_PASSWORD} refused`] }),
    );
    const secrets = [PASSWORD, DB_PASSWORD, THROW_AWAY, 'Other-Secret-1', 'Another1'];

    const first = await rejection(adapter.createWebsite(PHP_INPUT));
    const second = await rejection(adapter.setWebsitePassword('shop.mueller.ch', PASSWORD));
    const third = await rejection(adapter.setWebsitePassword('shop.mueller.ch', PASSWORD));
    const created = await adapter.createWebsite(PHP_INPUT);

    expect(first.message).toContain("passwd -6 '•••'");
    expect(first.message).toContain("IDENTIFIED BY '•••'");
    expect(first.message).toContain('--siteUserPassword=•••');
    expect((first.details as { output: string }).output).toContain('•••');
    expect(second.message).toContain('sudo: weblion-clp •••');
    expect(third).toBeInstanceOf(ProviderError);
    expect(third.message).toContain('socket hang up while sending •••');
    expect(created.warnings).toEqual(['The database could not be created: ••• refused']);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls[0]![0]).toMatchObject({ op: 'create', status: 502, code: 'provider_error' });
    const everything = JSON.stringify([first, first.message, first.details, second.message, third.message]);
    const logged = JSON.stringify(warn.mock.calls);
    for (const secret of secrets) {
      expect(everything).not.toContain(secret);
      expect(logged).not.toContain(secret);
    }
  });

  it('redacts secrets, known password patterns and long texts', () => {
    expect(redactSecrets('pw abcd and abc', ['abcd', 'abc'])).toBe('pw ••• and abc');
    // The longer secret first, so no part of it is left.
    expect(redactSecrets('x=Secret123Extra', ['Secret123', 'Secret123Extra'])).toBe('x=•••');
    expect(redactSecrets("openssl passwd -6 'a b'")).toBe("openssl passwd -6 '•••'");
    expect(redactSecrets("identified by 'pw'")).toBe("IDENTIFIED BY '•••'");
    expect(redactSecrets('--databaseUserPassword=abc --siteUser=x')).toBe(
      '--databaseUserPassword=••• --siteUser=x',
    );
    expect(redactSecrets('y'.repeat(5000))).toHaveLength(2000);
  });
});

describe('CloudPanel client', () => {
  it('passes a timeout on and carries on with the next call', async () => {
    const { adapter, transport, warn } = setup();
    transport.answer(
      new AppError(504, 'timeout', 'No answer from web1.weblion.cloud within 30 s.'),
      ok({ site: SITE }),
    );
    const err = await rejection(adapter.getWebsite('shop.mueller.ch'));
    expect([err.statusCode, err.code]).toEqual([504, 'timeout']);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'get', status: 504, code: 'timeout' }),
      'CloudPanel operation failed',
    );
    expect((await adapter.getWebsite('shop.mueller.ch')).domain).toBe('shop.mueller.ch');
  });

  it('runs one call at a time and answers busy beyond the queue', async () => {
    const transport = new FakeTransport();
    const order: string[] = [];
    transport.fallback = async (request) => {
      order.push(String(request.args.domain));
      await new Promise((resolve) => setTimeout(resolve, 2));
      return ok({ site: { ...SITE, domain: request.args.domain } });
    };
    const client = new CloudPanelClient(transport, { log: { warn: vi.fn() } });
    const domains = Array.from({ length: 25 }, (_, i) => `site${i}.mueller.ch`);
    const results = await Promise.allSettled(domains.map((domain) => client.call('get', { domain })));
    const done = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(done).toHaveLength(21);
    expect(refused).toHaveLength(4);
    for (const r of refused) {
      expect(r.reason).toBeInstanceOf(AppError);
      expect([r.reason.statusCode, r.reason.code]).toEqual([503, 'busy']);
    }
    expect(transport.maxRunning).toBe(1);
    // In the order of the calls; the last four never reached the server.
    expect(order).toEqual(domains.slice(0, 21));
    // The queue is free again.
    expect((await client.call('get', { domain: 'again.mueller.ch' })).site.domain).toBe('again.mueller.ch');
    client.close();
    expect(transport.closed).toBe(1);
  });
});

describe('CloudPanel adapter', () => {
  it('keeps the server facts 10 minutes and the site list 15 seconds', async () => {
    let now = 1_000_000;
    const { adapter, transport } = setup({}, { now: () => now });
    transport.fallback = (request) => (request.op === 'info' ? ok(INFO) : ok({ sites: [SITE] }));
    const ops = () => transport.requests.map((r) => r.op);

    const info = await adapter.websiteServerInfo();
    expect(info).not.toHaveProperty('cliVersion');
    expect(info.hostname).toBe('web1.weblion.cloud');
    info.phpVersions.push('changed');
    now += 9 * 60_000;
    expect((await adapter.websiteServerInfo()).phpVersions).toEqual(INFO.phpVersions);
    expect(ops()).toEqual(['info']);
    await adapter.websiteServerInfo(true);
    expect(ops()).toEqual(['info', 'info']);
    now += 9 * 60_000;
    await adapter.websiteServerInfo();
    expect(ops()).toEqual(['info', 'info']);
    now += 60_000;
    await adapter.websiteServerInfo();
    expect(ops()).toEqual(['info', 'info', 'info']);

    transport.requests.length = 0;
    await adapter.listWebsites();
    now += 14_000;
    await adapter.listWebsites();
    expect(ops()).toEqual(['list']);
    now += 1_000;
    await adapter.listWebsites();
    expect(ops()).toEqual(['list', 'list']);
    transport.answer(ok({ site: SITE, warnings: [] }));
    await adapter.createWebsite(PHP_INPUT);
    await adapter.listWebsites();
    expect(ops()).toEqual(['list', 'list', 'create', 'list']);
    // A failed change may have changed something too.
    transport.answer(fail({ code: 'not_found', message: 'gone' }));
    await rejection(adapter.deleteWebsite('shop.mueller.ch'));
    await adapter.listWebsites();
    expect(ops()).toEqual(['list', 'list', 'create', 'list', 'delete', 'list']);
  });

  it('does not keep a failed read', async () => {
    const { adapter, transport } = setup();
    transport.answer(fail({ code: 'busy', message: 'locked' }), ok(INFO));
    expect((await rejection(adapter.websiteServerInfo())).statusCode).toBe(503);
    expect((await adapter.websiteServerInfo()).agentVersion).toBe('1.0.0');
    expect(transport.requests).toHaveLength(2);
  });

  it('offers what the server has and the connection allows', async () => {
    const options = async (config: Partial<CloudPanelConfig>, info: Partial<WireInfo> = {}) => {
      const { adapter, transport } = setup(config);
      transport.answer(ok({ ...INFO, ...info }));
      return adapter.websiteServerOptions();
    };

    const defaults = await options({}, { phpVersions: ['7.4', '8.3', '8.5', '8.4', '8.3', 'bad'] });
    expect(defaults).toEqual({
      types: ['php', 'static'],
      phpVersions: ['8.4', '8.3'],
      defaultPhpVersion: '8.4',
      templates: [
        { name: 'Generic', rootDirectory: '' },
        { name: 'WordPress', rootDirectory: '' },
        { name: 'WooCommerce', rootDirectory: '' },
      ],
      nodejsVersions: ['20', '22', '24'],
      accessHost: 'web1.weblion.cloud',
      ipv4: ['203.0.113.10'],
      ipv6: ['2001:db8::10'],
    });

    const custom = await options({
      phpVersions: ['8.2', '8.5', '8.1'],
      templates: ['Laravel*', 'Static', 'Nodejs', 'Generic'],
      accessHost: 'sftp.weblion.cloud',
      ipv4: ['198.51.100.4'],
      nodejs: true,
    });
    expect(custom.phpVersions).toEqual(['8.5', '8.2']);
    expect(custom.defaultPhpVersion).toBe('8.5');
    expect(custom.templates.map((t) => t.name)).toEqual(['Generic', 'Laravel 13', 'Laravel 12']);
    expect(custom.types).toEqual(['php', 'static', 'nodejs']);
    expect(custom.accessHost).toBe('sftp.weblion.cloud');
    expect(custom.ipv4).toEqual(['198.51.100.4']);
    expect(custom.ipv6).toEqual(['2001:db8::10']);

    // Node.js needs both the connection and the server's own switch.
    expect((await options({ nodejs: true }, { nodejsEnabled: false })).types).toEqual(['php', 'static']);
    expect((await options({ nodejs: false }, { nodejsEnabled: true })).types).toEqual(['php', 'static']);
    // Nothing installed that the connection allows: no default.
    const none = await options({ phpVersions: ['5.6'] });
    expect([none.phpVersions, none.defaultPhpVersion]).toEqual([[], null]);
    // Template names the patterns refuse are never offered, whatever the server lists.
    const odd = await options(
      { templates: ['Generic*'] },
      {
        templates: [
          { name: 'Generic; rm -rf /', rootDirectory: '' },
          { name: 'Generic 2', rootDirectory: '' },
        ],
      },
    );
    expect(odd.templates).toEqual([{ name: 'Generic 2', rootDirectory: '' }]);
  });

  it('drops addresses of the wrong family from the server facts', async () => {
    const { adapter, transport } = setup();
    transport.answer(
      ok({ ...INFO, ipv4: ['203.0.113.10', '2001:db8::1', 'eth0'], ipv6: ['2001:db8::10', '1.2.3.4'] }),
    );
    const info = await adapter.websiteServerInfo();
    expect([info.ipv4, info.ipv6]).toEqual([['203.0.113.10'], ['2001:db8::10']]);
  });

  it('tests the connection with fresh facts and checks protocol and CloudPanel version', async () => {
    const { adapter, transport } = setup();
    transport.answer(
      ok(INFO),
      ok(INFO),
      ok({ ...INFO, protocol: 2 }),
      ok({ ...INFO, cloudpanelVersion: '2.4.2-1' }),
      ok({ ...INFO, cloudpanelVersion: null }),
    );
    await adapter.websiteServerInfo();
    expect(await adapter.testConnection()).toEqual({
      hostname: 'web1.weblion.cloud',
      cloudpanelVersion: '2.5.4-3+clp-noble',
      agentVersion: '1.0.0',
      sites: 7,
      managed: 5,
      unmanaged: 2,
      phpVersions: '8.5, 8.4, 8.3, 8.2, 7.4',
      allowRemoteAdopt: false,
      publicKey: publicKeyLine(KEYS.privateKey),
    });
    expect(KEYS.publicKey).toBe(publicKeyLine(KEYS.privateKey));
    expect(transport.requests.map((r) => r.op)).toEqual(['info', 'info']);
    expect((await rejection(adapter.testConnection())).message).toBe(
      'CloudPanel: The agent on web1.weblion.cloud speaks protocol 2, the console 1: update weblion-clp',
    );
    expect((await rejection(adapter.testConnection())).message).toBe(
      'CloudPanel: CloudPanel 2.4.2-1 on web1.weblion.cloud is not supported: the console needs 2.5.0 or newer',
    );
    expect((await rejection(adapter.testConnection())).message).toContain('(version unknown)');
  });

  it('compares CloudPanel package versions', () => {
    for (const v of ['2.5.0', '2.5.4-3+clp-noble', '2.10.0', '1:2.5.1', '3.0', '2.5.0~rc1']) {
      expect(cloudPanelVersionAtLeast(v, '2.5.0'), v).toBe(true);
    }
    for (const v of ['2.4.9', '2.4.2-1', '1.9.9', 'unknown', '', null]) {
      expect(cloudPanelVersionAtLeast(v, '2.5.0'), String(v)).toBe(false);
    }
  });

  it('maps a full site and a minimal one of an old panel', () => {
    expect(toRemoteWebsite(SITE)).toEqual({
      domain: 'shop.mueller.ch',
      facts: {
        type: 'php',
        siteUser: 'shop-mueller-ch',
        homeDirectory: '/home/shop-mueller-ch',
        webRoot: '/home/shop-mueller-ch/htdocs/shop.mueller.ch',
        application: 'WordPress',
        phpVersion: '8.4',
        nodejsVersion: null,
        appPort: null,
        certificate: { type: '2', letsEncrypt: true, expiresAt: '2027-01-09T12:00:00Z' },
        databases: 1,
        diskBytes: 52428800,
        databaseBytes: 3145728,
        usageMeasuredAt: '2026-10-11T06:00:00Z',
        createdAt: '2026-10-11T12:00:00Z',
      },
      databases: [{ name: 'shop_mueller_ch_wp', users: ['shop_mueller_ch_wp'], sizeBytes: 3145728 }],
    });
    // An old panel: no created_at column, no certificate, not measured yet; fields left out.
    const minimal = wireSiteSchema.parse({
      domain: 'alt.kunde.ch',
      type: 'static',
      siteUser: 'alt',
      homeDirectory: '/home/alt',
      usage: null,
    });
    expect(toRemoteWebsite(minimal)).toEqual({
      domain: 'alt.kunde.ch',
      facts: {
        type: 'static',
        siteUser: 'alt',
        homeDirectory: '/home/alt',
        webRoot: null,
        application: null,
        phpVersion: null,
        nodejsVersion: null,
        appPort: null,
        certificate: null,
        databases: 0,
        diskBytes: null,
        databaseBytes: null,
        usageMeasuredAt: null,
        createdAt: null,
      },
      databases: [],
    });
  });

  it('parses answers without the console checking anything else', () => {
    const result = ok({ any: 'thing' });
    expect(parseAnswer(result)).toEqual({ any: 'thing' });
    expect(() => parseAnswer({ ...result, stdout: '[]' })).toThrow(/Invalid answer/);
  });

  it('offers the explorer only the read operations', async () => {
    const { adapter, transport } = setup();
    transport.answer(ok({ sites: [SITE], extra: true }), ok(INFO), ok({ sites: [], allowRemoteAdopt: true }));
    expect(await adapter.rawRequest('GET', '/list')).toEqual({ status: 200, data: { sites: [SITE] } });
    expect((await adapter.rawRequest('get', ' /info ')).data).toMatchObject({
      cliVersion: 'CloudPanel CLI 6.0.8',
    });
    expect(await adapter.rawRequest('GET', '/unmanaged')).toEqual({
      status: 200,
      data: { sites: [], allowRemoteAdopt: true },
    });
    for (const [method, path] of [
      ['POST', '/create'],
      ['GET', '/../etc'],
      ['GET', '/get'],
      ['GET', '/constructor'],
      ['GET', 'list'],
      ['DELETE', '/list'],
    ] as const) {
      const err = await rejection(adapter.rawRequest(method, path));
      expect(err.statusCode).toBe(400);
      expect(err.message).toBe('The CloudPanel explorer only offers GET /info, /list and /unmanaged');
    }
    expect(transport.requests.map((r) => r.op)).toEqual(['list', 'info', 'unmanaged']);
  });

  it('has no servers', async () => {
    const { adapter } = setup();
    expect(adapter.type).toBe('cloudpanel');
    expect(adapter.capabilities()).toEqual([]);
    expect(adapter.powerActions()).toEqual([]);
    expect(await adapter.listServers()).toEqual([]);
    const err = await rejection(adapter.getServer({ externalId: 'x', kind: 'vm', node: null, meta: {} }));
    expect(err.statusCode).toBe(404);
    expect(adapter.websiteAccessHost()).toBe('web1.weblion.cloud');
  });
});
