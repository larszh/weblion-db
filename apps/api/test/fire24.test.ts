import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FIRE24_SCOPES_FULL, FIRE24_SCOPES_READ_ONLY } from '@weblion/shared';
import { AppError, ProviderError } from '../src/lib/errors';
import { Fire24Adapter, redactSecrets } from '../src/providers/fire24/adapter';
import { Fire24Client, retryAfterMs } from '../src/providers/fire24/client';
import {
  FIRE24_DEFAULT_BASE_URL,
  fire24BaseUrl,
  fire24TokenKind,
  fire24TokenSummary,
  isLegacyFire24Host,
} from '../src/providers/fire24/config';
import {
  FIRE24_DDOS_LAYER4,
  FIRE24_DDOS_LAYER7,
  FIRE24_DNS_TYPES,
  FIRE24_ENDPOINTS,
  FIRE24_POWER_MODES,
  FIRE24_SERVICE_CATEGORIES,
  FIRE24_UNUSED_OPERATIONS,
} from '../src/providers/fire24/endpoints';
import {
  listOf,
  mapStatus,
  parseAccount,
  parseBackupTask,
  parseConfig,
  parseConsole,
  parseMonth,
  parseNameservers,
  parseRdns,
  parseReinstallStatus,
  parseServiceItem,
  parseStatus,
  parseTrafficCurrent,
  unwrap,
} from '../src/providers/fire24/parse';
import type { ServerRef } from '../src/providers/types';
import {
  AUTHCODE,
  CONSOLE_TOKEN,
  FIRE24_FULL_TOKEN,
  FIRE24_READ_TOKEN,
  fire24Spec,
  LOGIN_TOKEN,
  NEW_ROOT_PASSWORD,
  op,
  PLESK_PASSWORD,
  ROOT_PASSWORD,
  specRoutes,
  startFire24Mock,
  type Fire24Mock,
  type Fire24Shape,
} from './fire24-mock';

const LEGACY_KEY = 'abcdef0123456789abcdef0123456789';

let mock: Fire24Mock;

beforeAll(async () => {
  mock = await startFire24Mock();
});

beforeEach(() => {
  mock.reset();
});

afterAll(async () => {
  await mock?.close();
});

/** A fresh adapter per test: caches, learned scopes and shape notes live per instance. */
function adapter(token = FIRE24_FULL_TOKEN, options: ConstructorParameters<typeof Fire24Adapter>[1] = {}) {
  return new Fire24Adapter({ apiKey: token, baseUrl: mock.url }, { rateLimitDefaultWaitMs: 10, ...options });
}

function ref(i = 0, meta: Record<string, unknown> = {}): ServerRef {
  return { externalId: mock.state.servers[i]!.id, kind: 'vm', node: null, meta };
}

const domainId = () => mock.state.domains[0]!.id;
const webspaceId = () => mock.state.webspaces[0]!.id;
const last = (name: string) => mock.calls(name).at(-1)!;

async function error(promise: Promise<unknown>): Promise<AppError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

// 1
describe('24fire endpoint table', () => {
  const routes = specRoutes();
  const spec = fire24Spec();

  it('matches the spec copy row by row, and every spec operation is decided', () => {
    for (const [name, endpoint] of Object.entries(FIRE24_ENDPOINTS)) {
      const route = routes.find((r) => r.method === endpoint.method && r.path === endpoint.path);
      expect(route, name).toBeDefined();
      expect(route!.scope, name).toBe(endpoint.scope);
      const paginated = (route!.op.parameters ?? []).some((p) => p.name === 'page');
      expect('paginated' in endpoint && endpoint.paginated === true, name).toBe(paginated);
      // "example" as data is never marked as documented.
      const success = Object.entries(route!.op.responses).find(([code]) => code.startsWith('2'))![1];
      const example = success.content?.['application/json']?.example as { data?: unknown } | undefined;
      if (example?.data === 'example') expect(endpoint.documented, name).toBe(false);
    }
    const table = new Set(Object.values(FIRE24_ENDPOINTS).map((e) => `${e.method} ${e.path}`));
    const unused = new Set<string>(FIRE24_UNUSED_OPERATIONS);
    for (const route of routes) {
      const key = `${route.method} ${route.path}`;
      expect(table.has(key) || unused.has(key), key).toBe(true);
      expect(table.has(key) && unused.has(key), key).toBe(false);
    }
    expect(routes).toHaveLength(54);
    expect(Object.keys(FIRE24_ENDPOINTS)).toHaveLength(48);
  });

  it('uses the enums of the spec and asks for every scope it calls', () => {
    const schemas = spec.components.schemas;
    expect([...FIRE24_DNS_TYPES]).toEqual(schemas.dns_type!.enum);
    expect(FIRE24_DNS_TYPES).not.toContain('HTTP_FRAME');
    expect([...FIRE24_DDOS_LAYER4]).toEqual(schemas.ddos_layer4!.enum);
    expect([...FIRE24_DDOS_LAYER7]).toEqual(schemas.ddos_layer7!.enum);
    expect([...FIRE24_SERVICE_CATEGORIES]).toEqual(schemas.services_category!.enum);
    expect(Object.values(FIRE24_POWER_MODES).sort()).toEqual([...schemas.power_mode!.enum!].sort());

    const specScopes = new Set(routes.map((r) => r.scope));
    expect([...specScopes].sort()).toEqual(
      [...FIRE24_SCOPES_FULL, 'server:ssh', 'donations:read', 'affiliate:read'].sort(),
    );
    const tableScopes = new Set(Object.values(FIRE24_ENDPOINTS).map((e) => e.scope));
    for (const scope of FIRE24_SCOPES_FULL) expect(tableScopes.has(scope), scope).toBe(true);
    for (const scope of FIRE24_SCOPES_READ_ONLY) expect(scope).toMatch(/:read$/);
  });
});

// 2, 3, 4
describe('24fire wire format, base URL and token', () => {
  it('sends the Bearer token, JSON accept and form bodies', async () => {
    const a = adapter();
    await a.power(ref(), 'start');
    const power = last('power');
    expect(power.headers.authorization).toBe(`Bearer ${FIRE24_FULL_TOKEN}`);
    expect(power.headers.accept).toBe('application/json');
    expect(power.headers['x-fire-apikey']).toBeUndefined();
    expect(power.headers['content-type']).toContain('application/x-www-form-urlencoded');
    expect(Object.fromEntries(power.form)).toEqual({ mode: 'start' });

    await a.rebuild(ref(0, { hostname: 'shop-01' }), 'debian_12');
    expect(last('reinstall').form.get('password_login')).toBe('1');

    const ip = mock.state.servers[0]!.ipv4[0]!;
    await a.setRdns(ref(), ip, '');
    const del = last('rdnsDelete');
    expect(del.method).toBe('DELETE');
    expect(del.query.get('ip_address')).toBe(ip);
    expect(del.form.toString()).toBe('');
  });

  it('normalises the base URL', () => {
    expect(fire24BaseUrl('https://api.24fire.de/')).toBe(FIRE24_DEFAULT_BASE_URL);
    expect(fire24BaseUrl('https://api.24fire.de/v1/')).toBe(FIRE24_DEFAULT_BASE_URL);
    expect(fire24BaseUrl('https://api.24fire.de/V1')).toBe(FIRE24_DEFAULT_BASE_URL);
    expect(fire24BaseUrl('https://manage.24fire.de')).toBe(FIRE24_DEFAULT_BASE_URL);
    expect(fire24BaseUrl('https://MANAGE.24fire.de/api/')).toBe(FIRE24_DEFAULT_BASE_URL);
    expect(fire24BaseUrl('http://127.0.0.1:4567/')).toBe('http://127.0.0.1:4567');
    expect(fire24BaseUrl(mock.url)).toBe(mock.url);
    expect(isLegacyFire24Host('https://manage.24fire.de./')).toBe(true);
    expect(isLegacyFire24Host('https://api.24fire.de')).toBe(false);
    expect(isLegacyFire24Host('not a url')).toBe(false);
  });

  it('tells PATs from v2 keys and never shows more than the id', () => {
    expect(fire24TokenKind('42|cra_abcdefgh1234')).toBe('pat');
    expect(fire24TokenKind(' 42|cra_abcdefgh1234\n')).toBe('pat');
    expect(fire24TokenKind('7|abcdefghij')).toBe('pat-unusual');
    expect(fire24TokenKind(LEGACY_KEY)).toBe('legacy');
    expect(fire24TokenKind('')).toBe('legacy');
    expect(fire24TokenKind('1|short')).toBe('legacy');
    expect(fire24TokenSummary('42|cra_abcdefgh1234')).toBe('42|cra_••••••');
    expect(fire24TokenSummary('7|abcdefghij')).toBe('7|••••••');
    expect(fire24TokenSummary(LEGACY_KEY)).toBe('legacy v2 key, replace it');
    for (const token of ['42|cra_abcdefgh1234', '7|abcdefghij', LEGACY_KEY]) {
      expect(fire24TokenSummary(token)).not.toContain(token.split('|').pop()!.slice(4, 10));
    }
  });
});

// 5, 6, 7, 8, 9
describe('24fire errors', () => {
  it('refuses a legacy v2 key before any request', async () => {
    const a = adapter(LEGACY_KEY);
    const calls = [
      a.testConnection(),
      a.listServers(),
      a.getServer(ref()),
      a.power(ref(), 'start'),
      a.listDomains(),
      a.listWebspaces(),
      a.getWebspaceCredentials(webspaceId()),
      a.overview(),
      a.rawRequest('GET', '/v1/account'),
    ];
    for (const call of calls) {
      const err = await error(call);
      expect(err.code).toBe('provider_auth');
      expect(err.message).toMatch(/old API v2/);
      expect(err.message).not.toContain(LEGACY_KEY);
    }
    expect(mock.requests).toHaveLength(0);
  });

  it('maps a 401 to provider_auth without the token in the message', async () => {
    const token = '9|cra_unknownsecret';
    const err = await error(adapter(token).testConnection());
    expect(err.code).toBe('provider_auth');
    expect(err.message).toMatch(/access token \(401\)/);
    expect(err.message).toContain('FIRE24_API_KEY');
    expect(err.message).not.toContain('unknownsecret');

    // An upstream that echoes the token in a message never gets it through.
    mock.state.errors[op('server')] = {
      status: 500,
      body: { status: 'error', type: 'server_error', message: `token ${FIRE24_FULL_TOKEN} broke` },
    };
    const echoed = await error(adapter().getServer(ref()));
    expect(echoed.message).toContain('***');
    expect(echoed.message).not.toContain(FIRE24_FULL_TOKEN);
  });

  it('learns missing scopes, hides their capabilities and forgets them on success', async () => {
    const a = adapter(FIRE24_READ_TOKEN);
    expect(a.capabilities()).toContain('power');
    const err = await error(a.power(ref(), 'start'));
    expect(err).toMatchObject({
      statusCode: 502,
      code: 'provider_scope_missing',
      details: { scope: 'server:power' },
    });
    expect(err.message).toContain('"server:power"');
    expect(a.capabilities()).not.toContain('power');
    expect(a.capabilities()).toContain('traffic');

    mock.tokens[FIRE24_READ_TOKEN] = [...FIRE24_SCOPES_READ_ONLY, 'server:power'];
    await a.power(ref(), 'start');
    expect(a.capabilities()).toContain('power');

    expect(await a.dnsWritable()).toBe(true);
    const dns = await error(a.addDnsRecord(domainId(), { type: 'TXT', name: 'x', data: 'y' }));
    expect(dns.code).toBe('provider_scope_missing');
    expect(await a.dnsWritable()).toBe(false);
    for (const capability of ['backups', 'backupRestore', 'backupDelete']) {
      await a.listBackups(ref()).catch(() => null);
      expect(a.capabilities()).not.toContain(capability);
    }
  });

  it('closes DNS editing for a while after a write refused for 24fire+', async () => {
    const a = adapter();
    mock.state.errors[op('dnsCreate')] = {
      status: 403,
      body: { status: 'error', type: 'forbidden', message: 'DNS changes need 24fire+.' },
    };
    const err = await error(a.addDnsRecord(domainId(), { type: 'TXT', name: 'x', data: 'y' }));
    expect(err).toMatchObject({ statusCode: 422, code: 'plus_required' });
    expect(await a.dnsWritable()).toBe(false);
    expect(await adapter().dnsWritable()).toBe(true);
  });

  it('maps 404, 422, 400 dns_error, 502 and HTML answers', async () => {
    const a = adapter();
    const missing = await error(a.getServer({ ...ref(), externalId: 'no-such-server' }));
    expect(missing).toBeInstanceOf(ProviderError);
    expect(missing.statusCode).toBe(404);

    const invalid = await error(a.addDnsRecord(domainId(), { type: 'NAPTR' as never, name: '@', data: 'x' }));
    expect(invalid).toMatchObject({ statusCode: 422, code: 'provider_validation' });
    expect(invalid.details).toMatchObject({ errors: { type: ['The selected type is invalid.'] } });

    const rejected = await error(a.addDnsRecord(domainId(), { type: 'A', name: 'www', data: 'not-an-ip' }));
    expect(rejected).toMatchObject({ statusCode: 422, code: 'dns_rejected' });
    expect(rejected.message).toMatch(/^24fire rejected the DNS record/);

    mock.state.upstreamFail[op('backups')] = 1;
    const upstream = await error(a.listBackups(ref()));
    expect(upstream).toBeInstanceOf(ProviderError);
    expect(upstream.statusCode).toBe(502);
    expect(upstream.message).toMatch(/backend failed/);

    mock.state.errors[op('server')] = {
      status: 404,
      text: '<html><body>Not Found</body></html>',
      headers: { 'content-type': 'text/html', 'x-request-id': 'req-123' },
    };
    const html = await error(a.getServer(ref()));
    expect(html.statusCode).toBe(404);
    expect(html.message).toMatch(/unexpected answer \(HTTP 404\), check the base URL/);
    expect(html.details).toEqual({ requestId: 'req-123' });
    mock.state.errors[op('server')] = { status: 200, text: '<html>maintenance</html>' };
    expect((await error(a.getServer(ref()))).message).toMatch(/unexpected answer \(HTTP 200\)/);

    mock.state.errors[op('power')] = {
      status: 403,
      body: { status: 'error', type: 'forbidden', message: 'Not in the allowlist.' },
    };
    expect((await error(a.power(ref(), 'start'))).message).toMatch(/product allowlist/);
    mock.state.errors[op('backupCreate')] = {
      status: 403,
      body: { status: 'error', type: 'forbidden', message: 'Only available with 24fire+.' },
    };
    expect(await error(a.createBackup(ref(), {}))).toMatchObject({ statusCode: 422, code: 'plus_required' });
  });

  it('retries a 429 once when the wait is short', async () => {
    const a = adapter();
    mock.state.throttle[op('backups')] = { times: 1, retryAfter: '1' };
    expect(await a.listBackups(ref())).toHaveLength(1);
    expect(mock.calls('backups')).toHaveLength(2);

    mock.state.throttle[op('backups')] = { times: 2, retryAfter: '1' };
    const twice = await error(a.listBackups(ref()));
    expect(twice).toMatchObject({
      statusCode: 429,
      code: 'provider_rate_limited',
      details: { retryAfterSeconds: 1 },
    });

    // Without a header the client waits its default (10 ms here) and retries.
    mock.state.throttle[op('backups')] = { times: 1 };
    expect(await a.listBackups(ref())).toHaveLength(1);

    const before = mock.calls('backups').length;
    mock.state.throttle[op('backups')] = { times: 1, retryAfter: '60' };
    const long = await error(a.listBackups(ref()));
    expect(long).toMatchObject({ code: 'provider_rate_limited', details: { retryAfterSeconds: 60 } });
    expect(long.message).toMatch(/try again in 60 s/);
    expect(mock.calls('backups')).toHaveLength(before + 1);
  });

  it('reads Retry-After as seconds or HTTP date and X-RateLimit-Reset', () => {
    const now = Date.parse('2026-11-01T12:00:00Z');
    expect(retryAfterMs({ 'retry-after': '3' }, now)).toBe(3000);
    expect(retryAfterMs({ 'retry-after': 'Sun, 01 Nov 2026 12:00:05 GMT' }, now)).toBe(5000);
    expect(retryAfterMs({ 'retry-after': 'Sun, 01 Nov 2026 11:00:00 GMT' }, now)).toBe(0);
    expect(retryAfterMs({ 'x-ratelimit-reset': String(now / 1000 + 7) }, now)).toBe(7000);
    expect(retryAfterMs({ 'x-ratelimit-reset': '4' }, now)).toBe(4000);
    expect(retryAfterMs({}, now)).toBeNull();
  });
});

// 10, 11
describe('24fire pagination and ids', () => {
  const client = (options = {}) =>
    new Fire24Client({ apiKey: FIRE24_FULL_TOKEN, baseUrl: mock.url }, options);

  it('reads every page up to last_page', async () => {
    const servers = await client().listAll('servers');
    expect(servers).toHaveLength(30);
    expect(mock.calls('servers').map((r) => r.query.get('page'))).toEqual(['1', '2']);
    expect(new Set(servers.map((s) => s.id)).size).toBe(30);
  });

  it('takes a list without meta as one page', async () => {
    mock.state.metaMissing = true;
    expect(await client().listAll('servers')).toHaveLength(25);
    expect(mock.calls('servers')).toHaveLength(1);
  });

  it('stops on an empty page and deduplicates by id, the later page winning', async () => {
    mock.state.pages[op('servers')] = (page) =>
      page === 1
        ? {
            data: [
              { id: 'a', name: 'A' },
              { id: 'b', name: 'B old' },
            ],
            meta: { current_page: 1, last_page: 4 },
          }
        : page === 2
          ? {
              data: [
                { id: 'b', name: 'B new' },
                { id: 'c', name: 'C' },
              ],
              meta: { current_page: 2, last_page: 4 },
            }
          : { data: [], meta: { current_page: page, last_page: 4 } };
    const items = await client().listAll('servers');
    expect(items.map((i) => [i.id, i.name])).toEqual([
      ['a', 'A'],
      ['b', 'B new'],
      ['c', 'C'],
    ]);
    expect(mock.calls('servers')).toHaveLength(3);
  });

  it('stops a pagination that never ends', async () => {
    mock.state.pages[op('servers')] = (page) => ({
      data: [{ id: `s${page}` }],
      meta: { current_page: page, last_page: 9999 },
    });
    const err = await error(client({ maxPages: 5 }).listAll('servers'));
    expect(err.message).toMatch(/pagination did not end/);
    expect(mock.calls('servers')).toHaveLength(5);
  });

  it('refuses unsafe ids without a request', async () => {
    const a = adapter();
    for (const id of ['../account', 'a/b', '%2e%2e', '..', 'a?b', 'a#b', 'a\\b', '', 'x'.repeat(129)]) {
      const err = await error(a.getServer({ ...ref(), externalId: id }));
      expect(err.statusCode, id).toBe(404);
    }
    for (const id of ['abc', '1/2', '1.5', '1234567890123']) {
      expect((await error(a.updateDnsRecord(domainId(), id, { data: 'x' }))).statusCode, id).toBe(404);
      expect((await error(a.deleteDnsRecord(domainId(), id))).statusCode, id).toBe(404);
    }
    expect(mock.requests).toHaveLength(0);
  });
});

// 12 to 16
describe('24fire servers', () => {
  it('lists servers from the list, config, status and rDNS', async () => {
    const servers = await adapter().listServers();
    expect(servers).toHaveLength(30);
    const s = servers[0]!;
    const ip = mock.state.servers[0]!.ipv4[0]!;
    expect(s).toMatchObject({
      externalId: mock.state.servers[0]!.id,
      name: 'EPYC 01',
      kind: 'vm',
      status: 'running',
      os: 'Debian 12',
      specs: { cores: 4, memoryMb: 8192, diskGb: 80, networkMbit: 2000, backupSlots: 2 },
      node: 'XEON 04',
      usage: {
        cpuPercent: 12.5,
        memoryUsedMb: 2560,
        memoryTotalMb: 8192,
        diskUsedGb: 1.7,
        uptimeSeconds: 545,
      },
      meta: {
        hostname: 'shop-01',
        datacenter: { name: 'DC', city: 'Frankfurt', country: 'Deutschland' },
        iso: null,
        task: null,
        abuseStatus: 'CLEAN',
        maxConfig: { cores: 12, memoryMb: 65536, ipv4: 6 },
        monitoring: { enabled: true, port: 22 },
        renewal: {
          date: '2026-12-01T00:00:00Z',
          price: 9.5,
          intervalDays: 30,
          autoRenew: true,
          state: 'renewing',
          cancellationPending: false,
          remainingDays: 30,
          disabled: false,
          type: 'KVM',
        },
      },
    });
    expect(s.partial).toBeUndefined();
    expect(s.meta).not.toHaveProperty('service');
    expect(s.ips.map((i) => i.address)).toEqual([ip, mock.state.servers[0]!.ipv6[0]]);
    // GET rdns wins over the name in the config.
    expect(s.ips[0]!.rdns).toBe('srv1.example.ch');
    expect(JSON.stringify(servers)).not.toContain(ROOT_PASSWORD);
  });

  it.each<Fire24Shape>(['wrapped', 'array', 'empty', 'string', 'null'])(
    'never throws on a %s config or status',
    async (shape) => {
      mock.state.shapes[op('serverConfig')] = shape;
      mock.state.shapes[op('serverStatus')] = shape;
      const a = adapter();
      const [s] = await a.listServers();
      if (shape === 'wrapped') {
        expect(s).toMatchObject({ status: 'running', specs: { cores: 4 }, os: 'Debian 12' });
        expect(s!.partial).toBeUndefined();
        return;
      }
      expect(s).toMatchObject({ name: 'EPYC 01', status: 'unknown', specs: {}, ips: [], partial: true });
      expect(s!.meta).toMatchObject({ renewal: { price: 9.5 } });
      const info = await a.testConnection();
      const notes = info.unrecognised as { endpoint: string; call: string; keys: string[] }[];
      const config = notes.find((n) => n.endpoint === 'serverConfig')!;
      expect(config.call).toBe('GET /v1/servers/{server}/config');
      const keys: Partial<Record<Fire24Shape, string[]>> = {
        array: ['(array of 1)'],
        empty: ['(empty object)'],
        string: ['(string)'],
        null: ['(null)'],
      };
      expect(config.keys).toEqual(keys[shape]);
      expect(notes.some((n) => n.endpoint === 'serverStatus')).toBe(true);
      expect(JSON.stringify(info)).not.toContain(ROOT_PASSWORD);
    },
  );

  it('notes the key names of an unknown config, never values', async () => {
    mock.state.payloads[op('serverConfig')] = { vm: { cpu: 4 }, secret_hint: ROOT_PASSWORD, ip: '1.2.3.4' };
    const a = adapter(FIRE24_FULL_TOKEN);
    await a.listServers();
    const info = await a.testConnection();
    expect(info.unrecognised).toContainEqual({
      endpoint: 'serverConfig',
      call: 'GET /v1/servers/{server}/config',
      keys: ['vm', 'secret_hint', 'ip'],
    });
    expect(JSON.stringify(info)).not.toContain(ROOT_PASSWORD);
  });

  it('reuses the last good result when the config breaks later', async () => {
    const a = adapter();
    const [first] = await a.listServers();
    mock.state.shapes[op('serverConfig')] = 'empty';
    mock.state.servers[0]!.renewal.renew_price = 11;
    const [again] = await a.listServers();
    expect(again!.partial).toBeUndefined();
    expect(again).toMatchObject({ specs: first!.specs, ips: first!.ips, os: 'Debian 12' });
    expect(again!.meta).toMatchObject({ hostname: 'shop-01', renewal: { price: 11 } });
  });

  it('keeps the last known status when the status call fails, and fails only when the list fails', async () => {
    const a = adapter();
    mock.state.upstreamFail[op('serverStatus')] = Infinity;
    expect((await a.listServers())[0]!.status).toBe('unknown');

    mock.state.upstreamFail[op('serverStatus')] = 0;
    await a.listServers();
    mock.state.throttle[op('serverStatus')] = { times: 1000, retryAfter: '60' };
    const [s] = await a.listServers();
    expect(s!.status).toBe('running');
    expect(s!.partial).toBeUndefined();

    mock.state.throttle[op('serverStatus')] = { times: 0 };
    const fresh = adapter();
    mock.state.upstreamFail[op('serverConfig')] = Infinity;
    expect((await fresh.listServers())[0]).toMatchObject({ partial: true, status: 'running' });

    mock.state.upstreamFail[op('servers')] = 1;
    await expect(fresh.listServers()).rejects.toMatchObject({ statusCode: 502 });
  });

  it('uses the network endpoint when the config has no addresses', async () => {
    const a = adapter();
    mock.state.payloads[op('serverConfig')] = { config: { cores: 2, mem: 2048, disk: 40, hostname: 'x' } };
    const [s] = await a.listServers();
    expect(s!.ips.map((i) => i.address)).toEqual([
      mock.state.servers[0]!.ipv4[0],
      mock.state.servers[0]!.ipv6[0],
    ]);
    expect(s!.specs).toMatchObject({ cores: 2 });
  });

  it('refreshes one server through the detail endpoint', async () => {
    const a = adapter();
    const server = await a.getServer(ref(3));
    expect(server.name).toBe('EPYC 04');
    expect(mock.calls('server')).toHaveLength(1);
    expect(mock.calls('servers')).toHaveLength(0);
    mock.state.allowlist = new Set([mock.state.servers[0]!.id]);
    await expect(a.getServer(ref(3))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('sends the power modes and refuses the others', async () => {
    const a = adapter();
    expect(a.powerActions()).toEqual(['start', 'stop', 'reboot']);
    for (const [action, mode] of [
      ['start', 'start'],
      ['stop', 'stop'],
      ['reboot', 'restart'],
    ] as const) {
      await a.power(ref(), action);
      expect(last('power').form.get('mode')).toBe(mode);
    }
    const before = mock.requests.length;
    expect(await error(a.power(ref(), 'suspend'))).toMatchObject({ statusCode: 422, code: 'unsupported' });
    expect(mock.requests).toHaveLength(before);
  });
});

// 17 to 25
describe('24fire server features', () => {
  it('opens the console as a page or a websocket and keeps its secrets out of errors', async () => {
    const a = adapter();
    expect(await a.openConsole(ref())).toEqual({
      type: 'url',
      url: `https://console.24fire.de/novnc/?token=${CONSOLE_TOKEN}`,
    });

    mock.state.console = 'vnc';
    const vnc = await a.openConsole(ref());
    expect(vnc).toMatchObject({ type: 'vnc', password: CONSOLE_TOKEN });

    mock.state.console = 'none';
    const none = await error(a.openConsole(ref()));
    expect(none.message).toBe('24fire: returned no console access');

    mock.state.payloads[op('console')] = { url: `http://console.example/novnc?token=${CONSOLE_TOKEN}` };
    expect((await error(a.openConsole(ref()))).message).not.toContain(CONSOLE_TOKEN);

    mock.state.payloads[op('console')] = {
      wss_url: `ws://127.0.0.1:1/vnc?token=${CONSOLE_TOKEN}`,
      ticket: 'pw',
    };
    const session = await a.openConsole(ref());
    expect(session.type).toBe('vnc');
    if (session.type !== 'vnc') return;
    const failed = await error(session.connect());
    expect(failed.message).toMatch(/console websocket failed/);
    expect(failed.message).not.toContain(CONSOLE_TOKEN);
  });

  it.each([
    ['objects', undefined],
    ['strings', ['debian_12', 'ubuntu_24']],
    [
      'an object keyed by name',
      { debian_12: { displayname: 'Debian 12' }, ubuntu_24: { displayname: 'Ubuntu 24.04' } },
    ],
    ['an object of labels', { debian_12: 'Debian 12', ubuntu_24: 'Ubuntu 24.04' }],
    ['a wrapped list', { os: [{ name: 'debian_12', displayname: 'Debian 12' }] }],
  ])('reads the OS list as %s', async (_, payload) => {
    if (payload !== undefined) mock.state.payloads[op('serverOsList')] = payload;
    const images = await adapter().listImages(ref());
    expect(images[0]).toMatchObject({ id: 'debian_12', family: 'debian' });
    expect(images[0]!.label).toMatch(/^(Debian 12|debian_12)$/);
  });

  it('reinstalls with the OS, host name and password login, and tracks the task', async () => {
    const a = adapter();
    const before = mock.requests.length;
    expect(await error(a.rebuild(ref(), 'windows_95'))).toMatchObject({ statusCode: 400 });
    expect(mock.calls('reinstall')).toHaveLength(0);
    expect(mock.requests.length - before).toBe(1); // the OS list only

    const result = await a.rebuild(ref(0, { hostname: 'shop-01' }), 'ubuntu_24');
    expect(result).toEqual({
      providerRef: 'reinstall',
      message: 'Reinstall started. Reset the root password once it is done.',
    });
    expect(Object.fromEntries(last('reinstall').form)).toEqual({
      os: 'ubuntu_24',
      hostname: 'shop-01',
      password_login: '1',
    });

    expect(await a.getTaskStatus(ref(), 'reinstall')).toMatchObject({
      status: 'running',
      type: 'reinstall',
      message: '40 %',
    });
    const done = await a.getTaskStatus(ref(), 'reinstall');
    expect(done).toMatchObject({ status: 'ok' });
    expect(done!.endedAt).toBeTruthy();

    // Without a stored host name the config gives it.
    await a.rebuild(ref(1), 'debian_12');
    expect(last('reinstall').form.get('hostname')).toBe('shop-02');

    mock.state.payloads[op('reinstallStatus')] = { status: 'failed', message: 'image broken' };
    expect(await a.getTaskStatus(ref(), 'reinstall')).toMatchObject({
      status: 'error',
      message: 'image broken',
    });
  });

  it('falls back to the server status when the reinstall status is unknown', async () => {
    const a = adapter();
    await a.rebuild(ref(0, { hostname: 'shop-01' }), 'debian_12');
    mock.state.payloads[op('reinstallStatus')] = {};
    expect((await a.getTaskStatus(ref(), 'reinstall'))!.status).toBe('running');
    expect((await a.getTaskStatus(ref(), 'reinstall'))!.status).toBe('ok');
    expect(mock.calls('serverStatus')).toHaveLength(2);
  });

  it.each([
    ['an object', undefined, NEW_ROOT_PASSWORD],
    ['a string', 'S3cret!pw', 'S3cret!pw'],
    ['root_password', { root_password: 'R00t!' }, 'R00t!'],
    ['a wrapper', { data: { new_password: 'N3w!' } }, 'N3w!'],
  ])('reads the reset password from %s', async (_, payload, expected) => {
    if (payload !== undefined) mock.state.payloads[op('passwordReset')] = payload;
    expect(await adapter().resetPassword(ref())).toEqual({
      message: 'Root password reset',
      password: expected,
    });
  });

  it('fails a password reset without a password, and keeps values out of notes', async () => {
    const a = adapter();
    for (const payload of [{}, '*******', { result: 'ok', secret_value: 'leak-me' }]) {
      mock.state.payloads[op('passwordReset')] = payload;
      const err = await error(a.resetPassword(ref()));
      expect(err.message).toBe('24fire: reported success but returned no password');
    }
    expect(JSON.stringify(a.unrecognised())).not.toContain('leak-me');
  });

  it('lists, creates, restores and deletes backups', async () => {
    const a = adapter();
    const [backup] = await a.listBackups(ref());
    expect(backup).toMatchObject({
      id: 'b0-1',
      description: 'nightly',
      sizeBytes: 2200 * 1024 * 1024,
      os: 'debian_12',
    });
    for (const shape of ['wrapped', 'keyed'] as const) {
      mock.state.shapes[op('backups')] = shape;
      expect((await a.listBackups(ref())).map((b) => b.id)).toEqual(['b0-1']);
    }
    mock.state.shapes[op('backups')] = 'string';
    expect(await a.listBackups(ref())).toEqual([]);
    delete mock.state.shapes[op('backups')];

    const created = await a.createBackup(ref(), { description: 'ignored' });
    expect(created.providerRef).toBe('backup-create:b100');
    const post = last('backupCreate');
    expect(post.method).toBe('POST');
    expect(post.form.toString()).toBe('');
    expect(post.headers['content-type']).toBeUndefined();

    expect(await a.getTaskStatus(ref(), created.providerRef!)).toMatchObject({
      status: 'running',
      type: 'backup.create',
      message: '14 % (1.4 of 10 GB)',
    });
    const status = last('backupCreateStatus');
    expect(status.method).toBe('GET');
    expect(status.path).toBe(`/v1/servers/${ref().externalId}/backups/b100/create-status`);
    expect(await a.getTaskStatus(ref(), created.providerRef!)).toMatchObject({ status: 'ok' });

    // No id in the answer: the new entry of the list.
    mock.state.payloads[op('backupCreate')] = null;
    expect((await a.createBackup(ref(), {})).providerRef).toBe('backup-create:b101');

    const restored = await a.restoreBackup(ref(), 'b0-1');
    expect(restored.providerRef).toBe('backup-restore:b0-1');
    expect(last('backupRestore').path).toBe(`/v1/servers/${ref().externalId}/backups/b0-1/restore`);
    expect(await a.getTaskStatus(ref(), restored.providerRef!)).toMatchObject({
      status: 'ok',
      type: 'backup.restore',
    });
    expect(last('backupRestoreStatus').method).toBe('GET');

    await a.deleteBackup(ref(), 'b0-1');
    expect(last('backupDelete')).toMatchObject({
      method: 'DELETE',
      path: `/v1/servers/${ref().externalId}/backups/b0-1`,
    });
    expect(await a.getTaskStatus(ref(), 'UPID:something')).toBeNull();
  });

  it('reads and changes the DDoS settings', async () => {
    const a = adapter();
    const ip = mock.state.servers[0]!.ipv4[0]!;
    expect(await a.getDdos(ref())).toEqual([{ ip, layer4: 'dynamic', layer7: 'off' }]);
    mock.state.shapes[op('ddos')] = 'array';
    expect(await a.getDdos(ref())).toEqual([{ ip, layer4: 'dynamic', layer7: 'off' }]);

    await a.setDdos(ref(), { ip, layer4: 'permanent', layer7: 'on' });
    expect(Object.fromEntries(last('ddosSet').form)).toEqual({
      layer4: 'permanent',
      layer7: 'on',
      ip_address: ip,
    });
    expect(await a.getDdos(ref())).toEqual([{ ip, layer4: 'permanent', layer7: 'on' }]);

    const before = mock.requests.length;
    expect((await error(a.setDdos(ref(), { ip, layer4: 'always' }))).statusCode).toBe(400);
    expect((await error(a.setDdos(ref(), { ip }))).statusCode).toBe(400);
    expect(mock.requests).toHaveLength(before);
  });

  it('sets and removes reverse DNS and drops the rDNS cache', async () => {
    const a = adapter();
    const ip = mock.state.servers[0]!.ipv4[0]!;
    expect((await a.getServer(ref())).ips[0]!.rdns).toBe('srv1.example.ch');

    await a.setRdns(ref(), ip, 'new.example.ch.');
    const put = last('rdnsSet');
    expect(put.method).toBe('PUT');
    expect(Object.fromEntries(put.form)).toEqual({ ip_address: ip, ptr: 'new.example.ch' });
    expect((await a.getServer(ref())).ips[0]!.rdns).toBe('new.example.ch');

    await a.setRdns(ref(), ip, '');
    expect(last('rdnsDelete').query.get('ip_address')).toBe(ip);
    expect((await a.getServer(ref())).ips[0]!.rdns).toBe(`initial-${ip}.example.ch`);
  });

  it('lists, mounts and ejects ISO images', async () => {
    const a = adapter();
    expect(await a.listIsos(ref())).toEqual([
      { id: 'proxmox_8', label: 'Proxmox 8' },
      { id: 'windows_2022', label: 'Windows Server 2022' },
    ]);
    const before = mock.requests.length;
    expect((await error(a.mountIso(ref(), 'nope'))).statusCode).toBe(400);
    expect(mock.requests).toHaveLength(before);

    expect((await a.mountIso(ref(), 'proxmox_8')).message).toMatch(/after a restart/);
    expect(Object.fromEntries(last('isoMount').form)).toEqual({ iso: 'proxmox_8' });
    const config = await a.getConfig(ref());
    expect(config.iso).toBe('Proxmox 8');
    expect(JSON.stringify(config)).not.toContain(ROOT_PASSWORD);
    expect((config.config as Record<string, unknown>).password).toBe('••••••');

    await a.unmountIso(ref());
    expect(last('isoEject').method).toBe('DELETE');
    expect((await a.getConfig(ref())).iso).toBeNull();
  });

  it('serves graphs and availability from one monitoring call', async () => {
    const a = adapter();
    const metrics = await a.getMetrics(ref(), 'day');
    expect(metrics.points).toHaveLength(1);
    expect(metrics.points[0]).toMatchObject({ cpu: 0.481, ping: 19, memUsed: 1.5 * 1024 ** 3 });
    const info = await a.getMonitoring(ref());
    expect(info.periods.map((p) => p.key)).toEqual(['LAST_24_HOURS', 'LAST_7_DAYS']);
    expect(info.periods[0]!.longestIncidenceMinutes).toBe(2);
    expect(info.incidents[0]).toMatchObject({ type: 'PING_TIMEOUT', downtimeMinutes: 11, end: null });
    expect(mock.calls('monitoring')).toHaveLength(1);

    const now = Date.now();
    mock.state.payloads[op('monitoring')] = {
      timings: { timings: [{ date: new Date(now - 60_000).toISOString(), cpu: 5, mem: 1, ping: 3 }] },
      incidences: {
        statistic: { LAST_30_DAYS: { downtime: 1, availability: 99.9, incidences: 1 } },
        incidences: [{ start: '2026-10-01T00:00:00Z', end: '2026-10-01T00:01:00Z', downtime: 1, type: 'X' }],
      },
    };
    const nested = adapter();
    expect((await nested.getMetrics(ref(), 'hour')).points).toHaveLength(1);
    expect(await nested.getMonitoring(ref())).toMatchObject({
      periods: [{ key: 'LAST_30_DAYS', availability: 99.9 }],
      incidents: [{ type: 'X' }],
    });
  });

  it('reads the current traffic without a log', async () => {
    const traffic = await adapter().getTraffic(ref());
    expect(traffic.inBytes).toBe(Math.round(6.53 * 1024 ** 3));
    expect(traffic.outBytes).toBe(Math.round(0.59 * 1024 ** 3));
    expect(traffic.totalBytes).toBe(Math.round(7.12 * 1024 ** 3));
    expect(traffic.limitBytes).toBe(1500 * 1024 ** 3);
    expect(traffic.remainingBytes).toBe(Math.round(1492.88 * 1024 ** 3));
    expect(traffic.throttled).toBe(true);
    expect(traffic.log).toEqual([]);
    expect(mock.requests.map((r) => r.path)).toEqual([`/v1/servers/${ref().externalId}/traffic`]);
  });

  it('hides nothing while the token has every scope', () => {
    expect(adapter().capabilities()).toEqual([
      'power',
      'console',
      'rebuild',
      'passwordReset',
      'backups',
      'backupRestore',
      'backupDelete',
      'metrics',
      'monitoring',
      'traffic',
      'ddos',
      'rdns',
      'iso',
      'config',
      'networkInfo',
    ]);
  });
});

// 26 to 29
describe('24fire domains and DNS', () => {
  it('lists domains with list facts and the cached detail', async () => {
    const a = adapter();
    const domains = await a.listDomains();
    expect(domains).toEqual([
      {
        externalId: domainId(),
        name: 'fire-test.de',
        status: 'LOCK',
        info: {
          name: 'fire-test.de',
          status: 'LOCK',
          terminated: false,
          nameservers: ['ns1.fireapi.de', 'ns2.fireapi.de'],
          handle: 'FIRE24XX',
          createdAt: '2023-03-14T15:53:44',
          // The detail wins over the list's renew_date.
          expiresAt: '2027-03-14T15:53:44',
          autoRenew: true,
          providerDns: true,
        },
        meta: { renewal: expect.objectContaining({ date: '2027-03-14T00:30:49Z', intervalDays: 365 }) },
      },
    ]);
    expect(JSON.stringify(domains)).not.toContain(AUTHCODE);
    await a.listDomains();
    expect(mock.calls('domain')).toHaveLength(1);
  });

  it('keeps the list facts when the detail fails', async () => {
    mock.state.upstreamFail[op('domain')] = Infinity;
    const [domain] = await adapter().listDomains();
    expect(domain).toEqual({
      externalId: domainId(),
      name: 'fire-test.de',
      status: null,
      info: { name: 'fire-test.de', expiresAt: '2027-03-14T00:30:49Z', autoRenew: true },
      meta: expect.any(Object),
    });
  });

  it.each([
    ['strings', ['ns1.fireapi.de', 'ns2.fireapi.de']],
    ['objects', [{ name: 'ns1.fireapi.de' }, { host: 'NS2.fireapi.de.' }]],
    ['a wrapper', { nameservers: ['NS1.FIREAPI.DE.', 'ns2.fireapi.de'] }],
    ['ns1 to ns5', { ns1: 'ns1.fireapi.de', ns2: 'ns2.fireapi.de', ns3: null, ns4: null, ns5: null }],
  ])('reads name servers as %s', async (_, payload) => {
    mock.state.payloads[op('nameservers')] = payload;
    const info = await adapter().getDomain(domainId());
    expect(info).toMatchObject({
      name: 'fire-test.de',
      nameservers: ['ns1.fireapi.de', 'ns2.fireapi.de'],
      providerDns: true,
      autoRenew: true,
    });
  });

  it('knows when the name servers are not 24fire’s', async () => {
    mock.state.payloads[op('nameservers')] = ['anna.ns.cloudflare.com', 'bob.ns.cloudflare.com'];
    const a = adapter();
    const info = await a.getDomain(domainId());
    expect(info).toMatchObject({
      nameservers: ['anna.ns.cloudflare.com', 'bob.ns.cloudflare.com'],
      providerDns: false,
    });
    // getDomain reads the detail fresh every time.
    await a.getDomain(domainId());
    expect(mock.calls('domain')).toHaveLength(2);
    expect(JSON.stringify(info)).not.toContain(AUTHCODE);
  });

  it.each<Fire24Shape>(['v2', 'wrapped', 'keyed'])('reads DNS records (%s)', async (shape) => {
    mock.state.shapes[op('dns')] = shape;
    const records = await adapter().listDnsRecords(domainId());
    expect(records.map((r) => r.id)).toEqual(['7498384', '7498387', '7498390']);
    expect(records[0]).toEqual({ id: '7498384', type: 'A', name: '*', data: '192.168.100.30', ttl: 300 });
    expect(records[2]).toMatchObject({ type: 'HTTP_FRAME', readOnly: true });
  });

  it('adds, updates and deletes records with the v1 calls', async () => {
    const a = adapter();
    expect(a.dnsRecordTypes()).toEqual([...FIRE24_DNS_TYPES]);
    expect(a.dnsRecordTypes()).toHaveLength(14);

    const added = await a.addDnsRecord(domainId(), {
      type: 'A',
      name: 'hello',
      data: '192.168.100.39',
      ttl: 600,
    });
    expect(Object.fromEntries(last('dnsCreate').form)).toEqual({
      type: 'A',
      name: 'hello',
      data: '192.168.100.39',
    });
    expect(added).toEqual({ id: '7498391', type: 'A', name: 'hello', data: '192.168.100.39', ttl: 300 });

    const updated = await a.updateDnsRecord(domainId(), '7498391', { data: '192.168.100.40', ttl: 60 });
    const patch = last('dnsUpdate');
    expect(patch).toMatchObject({ method: 'PATCH', path: `/v1/domains/${domainId()}/dns/7498391` });
    expect(Object.fromEntries(patch.form)).toEqual({ type: 'A', name: 'hello', data: '192.168.100.40' });
    expect(updated?.data).toBe('192.168.100.40');

    const before = mock.calls('dnsUpdate').length;
    expect((await error(a.updateDnsRecord(domainId(), '999', { data: 'x' }))).statusCode).toBe(404);
    expect(mock.calls('dnsUpdate')).toHaveLength(before);

    await a.deleteDnsRecord(domainId(), '7498391');
    expect(last('dnsDelete')).toMatchObject({
      method: 'DELETE',
      path: `/v1/domains/${domainId()}/dns/7498391`,
    });
    expect((await a.listDnsRecords(domainId())).map((r) => r.id)).toEqual(['7498384', '7498387', '7498390']);
  });

  it('sets 2 to 5 name servers in order and drops the domain cache', async () => {
    const a = adapter();
    await a.listDomains();
    const before = mock.requests.length;
    for (const list of [
      ['ns1.example.net'],
      Array.from({ length: 6 }, (_, i) => `ns${i}.example.net`),
      ['a.example.net', 'A.example.net.'],
    ]) {
      expect((await error(a.setNameservers(domainId(), list))).statusCode).toBe(400);
    }
    expect(mock.requests).toHaveLength(before);

    const result = await a.setNameservers(domainId(), [
      'NS1.Example.net.',
      'ns2.example.net',
      'ns3.example.net',
    ]);
    expect(result.message).toBe('Name server change submitted');
    const put = last('nameserversSet');
    expect(put.method).toBe('PUT');
    expect([...put.form]).toEqual([
      ['ns1', 'ns1.example.net'],
      ['ns2', 'ns2.example.net'],
      ['ns3', 'ns3.example.net'],
    ]);
    const [domain] = await a.listDomains();
    expect(mock.calls('domain')).toHaveLength(2);
    expect(domain!.info).toMatchObject({
      nameservers: ['ns1.example.net', 'ns2.example.net', 'ns3.example.net'],
      providerDns: false,
    });
  });

  it('offers no auth code, lock or renewal', () => {
    const a = adapter();
    expect(a.domainCapabilities()).toEqual(['dns', 'nameservers']);
    expect('getDomainAuthcode' in a).toBe(false);
    expect('setDomainLock' in a).toBe(false);
    expect('renewDomain' in a).toBe(false);
  });
});

// 30
describe('24fire web spaces', () => {
  it('lists web spaces by product and primary domain', async () => {
    const webspaces = await adapter().listWebspaces();
    expect(webspaces).toEqual([
      {
        externalId: webspaceId(),
        name: 'Plesk-Medium (kunde.de)',
        info: {
          name: 'Plesk-Medium (kunde.de)',
          resources: {
            domains: null,
            subdomains: null,
            emails: null,
            databases: null,
            storageMb: null,
            trafficGb: null,
            memoryLimitMb: null,
            ipAddress: null,
          },
          panelUrl: null,
          username: null,
          email: null,
          expiresAt: '2026-12-30T00:00:00Z',
        },
        meta: {
          package: 'Plesk Medium',
          provisioningStatus: 'active',
          renewal: expect.objectContaining({ price: 3.5 }),
        },
      },
    ]);
  });

  it('fills resources from the detail and the usage, never reading a password', async () => {
    const w = mock.state.webspaces[0]!;
    w.resources = { domains: 1, subdomains: 5, ssd_storage: 5, ip_address: '45.84.196.164' };
    w.usage = { domains: 99, emails: 3, databases: 2 };
    w.access = {
      host: 'plesk.24fire.de:8443',
      username: 'katherine',
      email: 'k@example.com',
      password: PLESK_PASSWORD,
    };
    const info = await adapter().getWebspace(w.id);
    expect(info).toMatchObject({
      name: 'Plesk-Medium (kunde.de)',
      resources: {
        domains: 1,
        subdomains: 5,
        emails: 3,
        databases: 2,
        storageMb: 5120,
        ipAddress: '45.84.196.164',
      },
      panelUrl: 'https://plesk.24fire.de:8443',
      username: 'katherine',
    });
    expect(JSON.stringify(info)).not.toContain(PLESK_PASSWORD);
    expect(mock.calls('webspaceUsage')).toHaveLength(1);
  });

  it('returns a one-time login link, fresh every time', async () => {
    const a = adapter();
    expect(await a.getWebspaceCredentials(webspaceId())).toEqual({
      panelUrl: 'https://plesk.24fire.de:8443',
      username: null,
      password: null,
      email: null,
      loginUrl: `https://plesk.24fire.de:8443/login?token=${LOGIN_TOKEN}-1`,
    });
    expect((await a.getWebspaceCredentials(webspaceId())).loginUrl).toMatch(/-2$/);
    expect(mock.calls('webspaceLogin')).toHaveLength(2);

    mock.state.payloads[op('webspaceLogin')] = {
      login_url: `http://plesk.example/login?token=${LOGIN_TOKEN}`,
    };
    const err = await error(a.getWebspaceCredentials(webspaceId()));
    expect(err.message).toBe('24fire: returned no valid login link');
  });
});

// 31, 32
describe('24fire account', () => {
  it('tests the connection with counts and scopes', async () => {
    const info = await adapter().testConnection();
    expect(info).toMatchObject({
      api: 'v1',
      account: 'Lars Kiefer',
      customerNumber: 'K-100200',
      plus: true,
      balance: 240.42,
      servers: 30,
      domains: 1,
      webspaces: 1,
      services: 33,
      scopesMissing: [],
      unrecognised: [],
    });
    expect([...(info.scopesOk as string[])].sort()).toEqual([...FIRE24_SCOPES_READ_ONLY].sort());
    expect(JSON.stringify(info)).not.toContain('Musterweg');
    expect(JSON.stringify(info)).not.toContain('+49');
  });

  it('lists missing read scopes without failing', async () => {
    mock.tokens['3|cra_nodomains'] = FIRE24_SCOPES_READ_ONLY.filter((s) => s !== 'domains:read');
    const info = await adapter('3|cra_nodomains').testConnection();
    expect(info).toMatchObject({ domains: null, servers: 30, scopesMissing: ['domains:read'] });
    expect(info.scopesOk).not.toContain('domain:read');
  });

  it('fails when the token has none of the read scopes', async () => {
    mock.tokens['4|cra_poweronly'] = ['server:power'];
    const err = await error(adapter('4|cra_poweronly').testConnection());
    expect(err.code).toBe('provider_scope_missing');
    expect(err.message).toMatch(/none of the read scopes/);
  });

  it('shows balance, 24fire+, counts and attention items in the overview', async () => {
    const a = adapter();
    mock.state.shapes[op('serverConfig')] = 'empty';
    await a.getServer(ref());
    const { facts } = await a.overview();
    expect(Object.fromEntries(facts.map((f) => [f.label, f.value]))).toMatchObject({
      Account: 'Lars Kiefer',
      'Customer number': 'K-100200',
      Balance: '240.42 EUR',
      '24fire+': 'active',
      KVM: '30',
      Domains: '1',
      'Web spaces': '1',
      Dedicated: '1',
      Status: 'attention needed',
      'Attention (danger)': 'Invoice overdue: Invoice 4711 is due since 3 days',
      'Unrecognised 24fire data': 'GET /v1/servers/{server}/config (keys: (empty object))',
    });
    expect(mock.calls('services').map((r) => r.query.get('page'))).toEqual(['1', '2']);
  });

  it('reports a missing scope in the overview instead of failing', async () => {
    mock.tokens['5|cra_nostatus'] = FIRE24_SCOPES_READ_ONLY.filter((s) => s !== 'status:read');
    const { facts } = await adapter('5|cra_nostatus').overview();
    expect(facts).toContainEqual({ label: 'Status', value: 'missing scope status:read' });
    expect(facts).toContainEqual({ label: 'Account', value: 'Lars Kiefer' });
  });
});

// 33
describe('24fire explorer', () => {
  it('prefixes /v1 and sends GET bodies as the query', async () => {
    const a = adapter();
    expect((await a.rawRequest('GET', 'servers?page=2')).status).toBe(200);
    expect(last('servers')).toMatchObject({ path: '/v1/servers' });
    expect(last('servers').query.get('page')).toBe('2');
    expect((await a.rawRequest('GET', '/account')).status).toBe(200);
    expect((await a.rawRequest('GET', `${mock.url}/v1/account`)).status).toBe(200);
    expect(mock.calls('account')).toHaveLength(2);

    await a.rawRequest('GET', '/v1/services', { category: 'kvm' });
    expect(last('services').query.get('category')).toBe('kvm');

    const patch = await a.rawRequest('PATCH', `/v1/domains/${domainId()}/dns/7498384`, {
      type: 'A',
      name: '*',
      data: '192.168.100.31',
    });
    expect(patch.status).toBe(200);
    expect(last('dnsUpdate').form.get('data')).toBe('192.168.100.31');
    // Errors come back as answers, not exceptions.
    expect((await a.rawRequest('GET', '/v1/servers/unknown')).status).toBe(404);
  });

  it('refuses v2 paths, traversal and calls that create one-time secrets', async () => {
    const a = adapter();
    const v2 = await error(a.rawRequest('GET', '/api/account/services'));
    expect(v2).toMatchObject({ statusCode: 422, code: 'unsupported' });
    expect(v2.message).toMatch(/no longer exist, use \/v1/);
    for (const path of [
      '../account',
      '/v1/servers/%2e%2e/account',
      '/v1//account',
      'https://evil.example/v1',
      '/v1/a@b',
      '/v1\\x',
    ]) {
      expect((await error(a.rawRequest('GET', path))).message, path).toBe('Invalid path');
    }
    const id = ref().externalId;
    for (const path of [
      `/v1/servers/${id}/password-reset`,
      `/v1/servers/${id}/ssh-keys/generate`,
      `/v1/webspaces/${webspaceId()}/login/`,
    ]) {
      expect(await error(a.rawRequest('POST', path)), path).toMatchObject({
        statusCode: 422,
        code: 'unsupported',
      });
    }
    expect((await error(a.rawRequest('POST', `/v1/servers/${id}/password%2Dreset`))).message).toBe(
      'Invalid path',
    );
    // fetch drops dot segments, tabs, line breaks and fragments before sending: none of them may
    // hide a blocked call.
    for (const path of [
      `/v1/servers/${id}/./password-reset`,
      `/v1/servers/${id}/password-reset/.`,
      `/v1/servers/${id}/password-re\tset`,
      `/v1/servers/${id}/pass\nword-reset`,
      `/v1/servers/${id}/password-reset#x`,
      `/v1/servers/${id}/ssh-keys/./generate`,
      `/v1/webspaces/${webspaceId()}/login#`,
      `./v1/servers/${id}/password-reset`,
    ]) {
      expect((await error(a.rawRequest('POST', path))).message, JSON.stringify(path)).toBe('Invalid path');
    }
    expect((await error(a.rawRequest('TRACE', '/v1/account'))).statusCode).toBe(400);
    expect(mock.requests).toHaveLength(0);
  });

  it('redacts secrets in every answer', async () => {
    const a = adapter();
    const config = await a.rawRequest('GET', `/v1/servers/${ref().externalId}/config`);
    expect(JSON.stringify(config)).not.toContain(ROOT_PASSWORD);
    const consoleAnswer = await a.rawRequest('POST', `/v1/servers/${ref().externalId}/console`);
    expect(JSON.stringify(consoleAnswer)).not.toContain(CONSOLE_TOKEN);
    expect(consoleAnswer.data).toEqual({ status: 'success', data: { url: '••••••' } });
    // Every console shape parseConsole accepts: only the key names are shown.
    for (const payload of [
      `https://vnc.24fire.de/novnc?token=${CONSOLE_TOKEN}`,
      { websocket_url: `wss://vnc.24fire.de/ws?ticket=${CONSOLE_TOKEN}`, password: 'x' },
      { session: { websocket: `wss://vnc.24fire.de/ws?ticket=${CONSOLE_TOKEN}`, vnc_password: 'x' } },
      { host: 'vnc.24fire.de', port: 5900, path: `/ws/${CONSOLE_TOKEN}` },
    ]) {
      mock.state.payloads[op('console')] = payload;
      const answer = await a.rawRequest('POST', `/v1/servers/${ref().externalId}/console`);
      expect(JSON.stringify(answer), JSON.stringify(payload)).not.toContain(CONSOLE_TOKEN);
      expect(answer).toMatchObject({ status: 200, data: { status: 'success' } });
    }
    expect((await a.rawRequest('POST', `/v1/servers/${ref().externalId}/console`)).data).toEqual({
      status: 'success',
      data: { host: '••••••', port: '••••••', path: '••••••' },
    });
    const refused = await adapter(FIRE24_READ_TOKEN).rawRequest(
      'POST',
      `/v1/servers/${ref().externalId}/console`,
    );
    expect(refused).toMatchObject({ status: 403, data: { status: 'error', type: 'insufficient_scope' } });

    mock.state.payloads[op('account')] = {
      login_url: 'https://plesk.example/x',
      token: 'tok',
      private_key: 'pk',
      note: '-----BEGIN OPENSSH PRIVATE KEY-----\nabc',
      other: 'see 12|cra_leakedtoken',
      list: [{ password: 'p' }],
      plain: 'kept',
    };
    const raw = await a.rawRequest('GET', '/v1/account');
    expect(raw.data).toEqual({
      status: 'success',
      data: {
        login_url: '••••••',
        token: '••••••',
        private_key: '••••••',
        note: '••••••',
        other: '••••••',
        list: [{ password: '••••••' }],
        plain: 'kept',
      },
    });
    expect(
      redactSecrets({ wss_url: 'wss://x', ticket: 't', authcode: 'a', link: 'l', password_login: true }),
    ).toEqual({
      wss_url: '••••••',
      ticket: '••••••',
      authcode: '••••••',
      link: '••••••',
      password_login: '••••••',
    });
    // Websocket addresses and links that carry a query, fragment or user part, under any key.
    expect(
      redactSecrets({
        websocket_url: 'a',
        websocket: 'b',
        ws: 'c',
        socket: 'd',
        address: 'wss://vnc.example/ws',
        page: 'https://vnc.example/novnc?token=t',
        hash: 'https://vnc.example/novnc#password=p',
        basic: 'https://user:pw@vnc.example/',
        docs: 'https://docs.24fire.de/api',
        list: ['ws://vnc.example/x', 'kept'],
      }),
    ).toEqual({
      websocket_url: '••••••',
      websocket: '••••••',
      ws: '••••••',
      socket: '••••••',
      address: '••••••',
      page: '••••••',
      hash: '••••••',
      basic: '••••••',
      docs: 'https://docs.24fire.de/api',
      list: ['••••••', 'kept'],
    });
  });
});

// 34
describe('24fire parsers', () => {
  it('unwraps one level and finds lists', () => {
    const v2 = { hostsystem: {}, config: { cores: 2 } };
    expect(unwrap(v2, ['config'])).toBe(v2);
    expect(unwrap({ config: v2 }, ['config'])).toBe(v2);
    expect(unwrap({ data: [1] })).toEqual([1]);
    expect(unwrap({ result: 'x' })).toEqual({ result: 'x' });
    expect(unwrap({ other: v2 }, ['config'])).toEqual({ other: v2 });

    expect(listOf([{ id: 1 }, 'x', null])).toEqual([{ id: 1 }]);
    expect(listOf(['a'], [], true)).toEqual([{ value: 'a' }]);
    expect(listOf({ backups: [{ id: 'b' }], total: 1 }, ['backups'])).toEqual([{ id: 'b' }]);
    expect(listOf({ b1: { size: 1 }, b2: { id: 'x' } })).toEqual([{ size: 1, id: 'b1' }, { id: 'x' }]);
    expect(listOf({ items: { b1: { size: 1 } } })).toEqual([{ size: 1, id: 'b1' }]);
    expect(listOf({ debian_12: 'Debian 12' }, [], true)).toEqual([{ id: 'debian_12', value: 'Debian 12' }]);
    expect(listOf({ name: 'debian_12', displayname: 'Debian 12' }, [], true)).toEqual([
      { name: 'debian_12', displayname: 'Debian 12' },
    ]);
    expect(listOf({ message: 'none' }, [], true)).toBeNull();
    expect(listOf({ status: 'ok', count: 1 })).toBeNull();
    expect(listOf({})).toEqual([]);
    expect(listOf('example')).toBeNull();
    expect(listOf(null)).toBeNull();
  });

  it('takes numbers as strings, booleans as 1/0 and unknown enum values', () => {
    expect(parseStatus({ status: 'running', usage: { cpu: { data: '12.5' } } }).usage.cpuPercent).toBe(12.5);
    expect(parseAccount({ plus_user: '1' }).plus).toBe(true);
    expect(parseAccount({ is_plus_user: 0 }).plus).toBe(false);
    expect(parseServiceItem({ id: 7, category: 'GameServer' })).toMatchObject({
      id: '7',
      category: 'gameserver',
    });
    expect(mapStatus('weird')).toBe('unknown');
    expect(parseStatus('running').status).toBe('running');
    expect(parseStatus('example')).toMatchObject({ status: 'unknown', recognised: false });
  });

  it('parses month names tolerantly', () => {
    expect(parseMonth('MAI')).toBe(5);
    expect(parseMonth('MAY')).toBe(5);
    expect(parseMonth('JULE')).toBe(7);
    expect(parseMonth('july')).toBe(7);
    expect(parseMonth('Juni')).toBe(6);
    expect(parseMonth('DECEMBER')).toBe(12);
    expect(parseMonth('11')).toBe(11);
    expect(parseMonth('SOMETHING')).toBeNull();
  });

  it('derives the traffic period from the month', () => {
    const traffic = parseTrafficCurrent({ month: 'DECEMBER', usage: {}, limit: {} }, new Date('2026-01-05'));
    expect(traffic.periodStart).toBe('2025-12-01T00:00:00.000Z');
    expect(traffic.periodEnd).toBe('2026-01-01T00:00:00.000Z');
    expect(traffic.limitBytes).toBeNull();
    expect(traffic.throttled).toBeNull();
    expect(parseTrafficCurrent({ traffic: { usage: { in: 1 } } }).inBytes).toBe(1024 ** 3);
  });

  it('maps running tasks onto the server status', () => {
    expect(parseStatus({ status: 'running', task: 'BACKUP_CREATE' }).status).toBe('backup');
    expect(parseStatus({ status: 'running', task: 'BACKUP_RESTORE' }).status).toBe('restoring');
    expect(parseStatus({ status: 'running', task: 'BOOTING' }).status).toBe('starting');
    expect(parseStatus({ status: 'running', task: 'REINSTALL' }).status).toBe('installing');
    expect(parseStatus({ status: 'running', task: 'HDD_MOUNT' }).status).toBe('running');
    expect(parseStatus({ status: 'stopped', task: null }).status).toBe('stopped');
  });

  it('reads the attached ISO only when it is attached', () => {
    expect(parseConfig({ config: { iso: { name: 'x', displayname: 'X', attached: true } } }).iso).toBe('X');
    expect(parseConfig({ config: { iso: { name: 'x', attached: false } } }).iso).toBeNull();
    expect(parseConfig({ config: { iso: 'proxmox_8' } }).iso).toBe('proxmox_8');
  });

  it('reads backup task progress', () => {
    expect(
      parseBackupTask({ status: 'pending', progress: { percentage: 40 } }, 'r', 'backup.restore'),
    ).toMatchObject({
      status: 'running',
      message: '40 %',
    });
    expect(parseBackupTask({ status: 'finished', progress: null }, 'r', 'backup.create')!.status).toBe('ok');
    expect(parseBackupTask({ status: { status: 'failed' } }, 'r', 'backup.create')!.status).toBe('error');
    expect(parseBackupTask('done', 'r', 'backup.create')!.status).toBe('ok');
    expect(parseBackupTask({}, 'r', 'backup.create')).toBeNull();
  });

  it('reads reinstall states', () => {
    expect(parseReinstallStatus({ status: 'completed' })).toEqual({ status: 'ok', message: null });
    expect(parseReinstallStatus({ state: 'installing', percentage: '70' })).toEqual({
      status: 'running',
      message: '70 %',
    });
    expect(parseReinstallStatus({ finished: '1' })).toEqual({ status: 'ok', message: null });
    expect(parseReinstallStatus({ installing: true })).toMatchObject({ status: 'running' });
    expect(parseReinstallStatus({ status: 'aborted' })).toMatchObject({ status: 'error' });
    expect(parseReinstallStatus({ reinstall: { done: false } })).toMatchObject({ status: 'running' });
    expect(parseReinstallStatus(null)).toBeNull();
    expect(parseReinstallStatus({ foo: 1 })).toBeNull();
  });

  it('reads rDNS lists, also split by IP version', () => {
    expect(parseRdns([{ ip_address: '192.0.2.10', ptr: 'a.example.' }])).toEqual([
      { ip: '192.0.2.10', ptr: 'a.example' },
    ]);
    // The shape a live v1 server answered with.
    expect(
      parseRdns({
        ipv4: [{ ip_address: '192.0.2.10', rdns: 'a.example' }],
        ipv6: [{ ip: '2001:db8::10', ptr: 'b.example.' }],
      }),
    ).toEqual([
      { ip: '192.0.2.10', ptr: 'a.example' },
      { ip: '2001:db8::10', ptr: 'b.example' },
    ]);
    expect(parseRdns({ ipv4: { '192.0.2.10': 'a.example' }, ipv6: null })).toEqual([
      { ip: '192.0.2.10', ptr: 'a.example' },
    ]);
    expect(parseRdns({ data: { ipv4: [], ipv6: [] } })).toEqual([]);
    // Entries nobody can read stay unrecognised, so the connection test keeps naming them.
    expect(parseRdns({ ipv4: [{ foo: 1 }], ipv6: [] })).toBeNull();
    expect(parseRdns({ ipv4: 'unknown' })).toBeNull();
  });

  it('reads console sessions and name servers', () => {
    expect(parseConsole('https://c.example/novnc')).toEqual({ type: 'url', url: 'https://c.example/novnc' });
    expect(parseConsole({ data: { novnc_url: 'https://c.example/x' } })).toEqual({
      type: 'url',
      url: 'https://c.example/x',
    });
    expect(parseConsole({ websocket: 'wss://c.example/ws', token: 't' })).toEqual({
      type: 'vnc',
      wssUrl: 'wss://c.example/ws',
      password: 't',
    });
    expect(parseConsole({ wss_url: 'wss://c.example/ws' })).toBeNull();
    expect(parseConsole({ url: 'javascript:alert(1)' })).toBeNull();
    expect(parseNameservers({ ns2: 'b.example', ns1: 'A.example.', ns10: 'c.example' })).toEqual([
      'a.example',
      'b.example',
      'c.example',
    ]);
    expect(parseNameservers({ foo: 'bar' })).toBeNull();
    expect(parseNameservers('example')).toBeNull();
  });
});
