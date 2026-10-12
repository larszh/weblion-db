import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { DnsRecord, DnsRecordInput } from '@weblion/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, ProviderError } from '../src/lib/errors';
import { CloudflareAdapter } from '../src/providers/cloudflare/adapter';
import {
  CloudflareClient,
  cloudflareCodes,
  type CloudflareClientOptions,
} from '../src/providers/cloudflare/client';
import {
  CLOUDFLARE_DOMAIN_CAPABILITIES,
  CLOUDFLARE_RECORD_TYPES,
} from '../src/providers/cloudflare/constants';
import {
  parseCdn,
  quoteTxt,
  recordBody,
  recordPatch,
  redactSecrets,
  toDnsRecord,
  toFqdn,
  toRelative,
  unquoteTxt,
  zoneToInfo,
  zoneToRemote,
  type CfDnsRecord,
  type CfZone,
} from '../src/providers/cloudflare/parse';

// ---------------------------------------------------------------------------
// A JSON mock of the Cloudflare API v4. Records method, path, query, headers and JSON
// bodies, and can answer with headers (Retry-After) and non-JSON bodies (edge HTML pages).

interface Recorded {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  body: unknown;
}

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };
type Answer = Reply | undefined;

interface CfError {
  code: number;
  message: string;
  error_chain?: CfError[];
}

const ok = (result: unknown, resultInfo?: Record<string, number>): Reply => ({
  status: 200,
  body: {
    success: true,
    errors: [],
    messages: [],
    result,
    ...(resultInfo ? { result_info: resultInfo } : {}),
  },
});
const fail = (status: number, errors: CfError[]): Reply => ({
  status,
  body: { success: false, errors, messages: [], result: null },
});

async function startMock(handler: (req: Recorded) => Answer) {
  const requests: Recorded[] = [];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const recorded: Recorded = {
        method: req.method ?? 'GET',
        path: url.pathname,
        query: url.searchParams,
        headers: req.headers,
        body: raw ? JSON.parse(raw) : undefined,
      };
      requests.push(recorded);
      const answer = handler(recorded) ?? fail(404, [{ code: 7003, message: 'No route for the URI' }]);
      res.statusCode = answer.status ?? 200;
      for (const [key, value] of Object.entries(answer.headers ?? {})) res.setHeader(key, value);
      if (answer.body === undefined) {
        res.end();
      } else if (typeof answer.body === 'string') {
        res.setHeader('content-type', 'text/html');
        res.end(answer.body);
      } else {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(answer.body));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function caught(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error('expected the promise to reject');
}

// ---------------------------------------------------------------------------
// Fixtures shaped like the OpenAPI spec's examples.

const TOKEN = 'cfTok3n_0123456789abcdefghijklmnopqrstuv';
const ACCOUNT = '01a7362d577a6c3019a474fd6f485823';
const OTHER_ACCOUNT = '99a7362d577a6c3019a474fd6f485899';
const ZONE_ID = '023e105f4ecef8ad9ca31a8372d0c353';
const WWW_ID = '372e67954025e0ba6aaa6d586b9e0b59';
const APEX_ID = 'a00000000000000000000000000000a1';
const MX_ID = 'a00000000000000000000000000000a2';
const TXT_ID = 'a00000000000000000000000000000a3';
const HTTPS_ID = 'a00000000000000000000000000000a4';
const MAIL_ID = 'a00000000000000000000000000000a5';
const BASE_PATH = '/client/v4';
const NOW = '2026-10-10T08:00:00.12345Z';

const ZONE = {
  id: ZONE_ID,
  name: 'muster-shop.ch',
  status: 'active',
  paused: false,
  type: 'full',
  development_mode: 0,
  name_servers: ['ana.ns.cloudflare.com', 'bob.ns.cloudflare.com'],
  original_name_servers: ['ns1.fireapi.de', 'ns2.fireapi.de'],
  original_registrar: 'Joker.com',
  original_dnshost: null,
  created_on: '2023-01-10T08:00:00.12345Z',
  modified_on: '2026-10-01T08:00:00.12345Z',
  activated_on: '2023-01-10T14:30:00.12345Z',
  owner: { id: null, type: 'user' },
  account: { id: ACCOUNT, name: 'weblion.one' },
  meta: { step: 2 },
  plan: { id: '0feeeeeeeeeeeeeeeeeeeeeeeeeeeeee', name: 'Free Website', legacy_id: 'free' },
};
type MockZone = typeof ZONE & Record<string, unknown>;

function zone(overrides: Record<string, unknown> = {}): MockZone {
  return { ...structuredClone(ZONE), ...overrides } as MockZone;
}

/** 32 hex characters from a number. */
const hex = (n: number, prefix = 'b') => `${prefix}${n.toString(16).padStart(31, '0')}`;

interface MockRecord {
  id: string;
  name: string;
  type: string;
  content: string;
  data?: Record<string, unknown>;
  priority?: number;
  proxiable: boolean;
  proxied: boolean;
  ttl: number;
  settings: Record<string, unknown>;
  meta: Record<string, unknown>;
  comment: string | null;
  tags: string[];
  locked?: boolean;
  created_on: string;
  modified_on: string;
}

function record(
  fields: Partial<MockRecord> & Pick<MockRecord, 'id' | 'name' | 'type' | 'content'>,
): MockRecord {
  return {
    proxiable: ['A', 'AAAA', 'CNAME'].includes(fields.type),
    proxied: false,
    ttl: 1,
    settings: {},
    meta: {},
    comment: null,
    tags: [],
    created_on: '2023-01-10T08:00:00.12345Z',
    modified_on: '2023-01-10T08:00:00.12345Z',
    ...fields,
  };
}

function defaultRecords(): MockRecord[] {
  return [
    record({ id: APEX_ID, name: 'muster-shop.ch', type: 'A', content: '185.101.20.11', proxied: true }),
    record({
      id: WWW_ID,
      name: 'www.muster-shop.ch',
      type: 'CNAME',
      content: 'muster-shop.ch',
      proxied: true,
      comment: 'Shop',
      tags: ['team:web'],
    }),
    record({
      id: MX_ID,
      name: 'muster-shop.ch',
      type: 'MX',
      content: 'mail.muster-ag.ch',
      priority: 10,
      ttl: 3600,
    }),
    record({
      id: TXT_ID,
      name: 'muster-shop.ch',
      type: 'TXT',
      content: '"google-site-verification=abc123"',
      ttl: 3600,
      comment: 'Google Search Console',
    }),
    record({
      id: HTTPS_ID,
      name: 'muster-shop.ch',
      type: 'HTTPS',
      content: '1 . alpn="h3,h2"',
      data: { priority: 1, target: '.', value: 'alpn="h3,h2"' },
    }),
    record({ id: MAIL_ID, name: 'mail.muster-shop.ch', type: 'A', content: '185.101.20.20', ttl: 3600 }),
  ];
}

interface MockSetting {
  value: string;
  editable: boolean;
  time_remaining?: number;
}

function defaultSettings(): Record<string, MockSetting> {
  return {
    ssl: { value: 'full', editable: true },
    ssl_automatic_mode: { value: 'custom', editable: true },
    always_use_https: { value: 'on', editable: true },
    development_mode: { value: 'off', editable: true, time_remaining: 0 },
  };
}

/** Content as Cloudflare formats it for typed records. */
function typedContent(type: string, data: Record<string, unknown>): string {
  if (type === 'SRV') return `${data.weight} ${data.port} ${data.target}`;
  if (type === 'CAA') return `${data.flags} ${data.tag} "${data.value}"`;
  return Object.values(data).join(' ');
}

function paged<T>(items: T[], query: URLSearchParams, defaultPerPage: number): Answer {
  const perPage = Number(query.get('per_page') ?? defaultPerPage);
  const page = Number(query.get('page') ?? 1);
  const slice = items.slice((page - 1) * perPage, page * perPage);
  return ok(slice, {
    page,
    per_page: perPage,
    count: slice.length,
    total_count: items.length,
    total_pages: Math.max(1, Math.ceil(items.length / perPage)),
  });
}

class MockCloudflare {
  zones: MockZone[] = [zone()];
  records = new Map<string, MockRecord[]>([[ZONE_ID, defaultRecords()]]);
  settings = new Map<string, Record<string, MockSetting>>();
  token = { status: 'active', kind: 'user' as 'user' | 'account' };
  accountReadable = true;
  override: ((req: Recorded) => Answer) | null = null;
  private next = 1;

  settingsOf(zoneId: string): Record<string, MockSetting> {
    let settings = this.settings.get(zoneId);
    if (!settings) {
      settings = defaultSettings();
      this.settings.set(zoneId, settings);
    }
    return settings;
  }

  private create(zoneId: string, body: Record<string, unknown>): MockRecord | CfError {
    const list = this.records.get(zoneId) ?? [];
    const type = String(body.type);
    const name = String(body.name);
    const address = ['A', 'AAAA', 'CNAME'];
    if (
      address.includes(type) &&
      list.some(
        (r) => r.name === name && address.includes(r.type) && (r.type === 'CNAME' || type === 'CNAME'),
      )
    ) {
      return { code: 81053, message: 'An A, AAAA, or CNAME record with that host already exists.' };
    }
    const data = body.data as Record<string, unknown> | undefined;
    const created = record({
      id: hex(this.next++),
      name,
      type,
      content: typeof body.content === 'string' ? body.content : data ? typedContent(type, data) : '',
      ...(data ? { data } : {}),
      ...(typeof body.priority === 'number' ? { priority: body.priority } : {}),
      proxied: body.proxied === true,
      ttl: typeof body.ttl === 'number' ? body.ttl : 1,
      comment: typeof body.comment === 'string' ? body.comment : null,
      tags: Array.isArray(body.tags) ? (body.tags as string[]) : [],
      created_on: NOW,
      modified_on: NOW,
    });
    list.push(created);
    this.records.set(zoneId, list);
    return created;
  }

  handle = (req: Recorded): Answer => {
    const answer = this.override?.(req);
    if (answer) return answer;
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      return fail(400, [
        {
          code: 6003,
          message: 'Invalid request headers',
          error_chain: [{ code: 6111, message: 'Invalid format for Authorization header' }],
        },
      ]);
    }
    if (!req.path.startsWith(`${BASE_PATH}/`)) return undefined;
    const path = req.path.slice(BASE_PATH.length);
    const body = (req.body ?? {}) as Record<string, unknown>;
    let m: RegExpExecArray | null;

    const verified = () =>
      ok({
        id: 'f267e341f3dd4697bd3b9f71dd96247f',
        status: this.token.status,
        expires_on: '2027-01-01T00:00:00Z',
      });
    const invalidToken = () => fail(401, [{ code: 1000, message: 'Invalid API Token' }]);
    if (req.method === 'GET' && path === '/user/tokens/verify') {
      return this.token.kind === 'user' ? verified() : invalidToken();
    }
    if (req.method === 'GET' && (m = /^\/accounts\/([0-9a-f]{32})\/tokens\/verify$/.exec(path))) {
      return this.token.kind === 'account' && m[1] === ACCOUNT ? verified() : invalidToken();
    }
    if (req.method === 'GET' && (m = /^\/accounts\/([0-9a-f]{32})$/.exec(path))) {
      if (!this.accountReadable)
        return fail(403, [{ code: 9109, message: 'Unauthorized to access requested resource' }]);
      return ok({ id: m[1], name: 'weblion.one', type: 'standard' });
    }

    if (path === '/zones' && req.method === 'GET') {
      const account = req.query.get('account.id');
      const name = req.query.get('name');
      const zones = this.zones.filter(
        (z) => (!account || z.account.id === account) && (!name || z.name === name),
      );
      return paged(zones, req.query, 20);
    }
    if (path === '/zones' && req.method === 'POST') {
      const name = String(body.name);
      if (this.zones.some((z) => z.name === name)) {
        return fail(400, [{ code: 1061, message: `${name} already exists` }]);
      }
      const created = zone({
        id: hex(this.next++, 'c'),
        name,
        status: 'pending',
        name_servers: ['lea.ns.cloudflare.com', 'tom.ns.cloudflare.com'],
        original_name_servers: null,
        original_registrar: null,
        activated_on: null,
        created_on: NOW,
        account: { id: (body.account as { id: string }).id, name: 'weblion.one' },
      });
      this.zones.push(created);
      this.records.set(created.id, []);
      return ok(created);
    }

    if (!(m = /^\/zones\/([0-9a-f]{32})(\/.*)?$/.exec(path))) return undefined;
    const zoneId = m[1]!;
    const rest = m[2] ?? '';
    const found = this.zones.find((z) => z.id === zoneId);
    if (!found) return fail(404, [{ code: 1001, message: 'Invalid zone identifier' }]);
    const records = this.records.get(zoneId) ?? [];

    if (rest === '' && req.method === 'GET') return ok(found);
    if (rest === '/activation_check' && req.method === 'PUT') return ok({ id: zoneId });
    if (rest === '/purge_cache' && req.method === 'POST') {
      if (body.purge_everything !== true)
        return fail(400, [{ code: 1092, message: 'Invalid purge request' }]);
      return ok({ id: '9a7806061c88ada191ed06f989cc3dac' });
    }
    if (rest === '/dns_records' && req.method === 'GET') return paged(records, req.query, 100);
    if (rest === '/dns_records' && req.method === 'POST') {
      const created = this.create(zoneId, body);
      return 'id' in created ? ok(created) : fail(400, [created]);
    }
    if (rest === '/dns_records/batch' && req.method === 'POST') {
      const deletes = (body.deletes ?? []) as { id: string }[];
      for (const d of deletes) {
        const index = records.findIndex((r) => r.id === d.id);
        if (index < 0) return fail(404, [{ code: 81044, message: 'Record does not exist.' }]);
        records.splice(index, 1);
      }
      const posts: MockRecord[] = [];
      for (const p of (body.posts ?? []) as Record<string, unknown>[]) {
        const created = this.create(zoneId, p);
        if (!('id' in created)) return fail(400, [created]);
        posts.push(created);
      }
      return ok({ deletes, patches: [], puts: [], posts });
    }
    if ((m = /^\/dns_records\/([0-9a-f]{32})$/.exec(rest))) {
      const index = records.findIndex((r) => r.id === m![1]);
      if (index < 0) return fail(404, [{ code: 81044, message: 'Record does not exist.' }]);
      const current = records[index]!;
      if (req.method === 'GET') return ok(current);
      if (req.method === 'DELETE') {
        records.splice(index, 1);
        return ok({ id: current.id });
      }
      if (req.method === 'PATCH') {
        Object.assign(current, body, { modified_on: NOW });
        return ok(current);
      }
    }
    if ((m = /^\/settings\/([a-z_]+)$/.exec(rest))) {
      const settings = this.settingsOf(zoneId);
      const name = m[1]!;
      const setting = settings[name];
      if (!setting) return fail(404, [{ code: 1003, message: 'Invalid or missing zone setting' }]);
      if (req.method === 'GET') return ok({ id: name, modified_on: NOW, ...setting });
      if (req.method === 'PATCH') {
        if (!setting.editable) return fail(400, [{ code: 1007, message: 'Setting is not editable' }]);
        if (name === 'ssl_automatic_mode' && !['auto', 'custom'].includes(String(body.value))) {
          return fail(400, [
            {
              code: 1008,
              message: 'Invalid SSL/TLS encryption configuration value, only auto or custom accepted',
            },
          ]);
        }
        setting.value = String(body.value);
        if (name === 'development_mode') setting.time_remaining = setting.value === 'on' ? 10_800 : 0;
        return ok({ id: name, modified_on: NOW, ...setting });
      }
    }
    return undefined;
  };
}

let mock: MockCloudflare;
let server: Awaited<ReturnType<typeof startMock>>;

beforeAll(async () => {
  server = await startMock((req) => mock.handle(req));
});
afterAll(async () => {
  await server.close();
});
beforeEach(() => {
  mock = new MockCloudflare();
  server.requests.length = 0;
});

const baseUrl = () => `${server.url}${BASE_PATH}`;
const client = (options: CloudflareClientOptions = {}) =>
  new CloudflareClient({ apiToken: TOKEN, baseUrl: baseUrl() }, options);
const adapter = (accountId?: string, options: CloudflareClientOptions = {}) =>
  new CloudflareAdapter(
    { apiToken: TOKEN, baseUrl: `${baseUrl()}/`, ...(accountId ? { accountId } : {}) },
    options,
  );
const sent = (method: string, path: string) =>
  server.requests.filter((r) => r.method === method && r.path === `${BASE_PATH}${path}`);

// ---------------------------------------------------------------------------

describe('Cloudflare client', () => {
  it('sends the token and JSON headers and unwraps the result', async () => {
    const zoneRead = await client().request<{ name: string }>('GET', `/zones/${ZONE_ID}`, {
      action: 'read zone',
    });
    expect(zoneRead.name).toBe('muster-shop.ch');
    const get = server.requests[0]!;
    expect(get.path).toBe(`${BASE_PATH}/zones/${ZONE_ID}`);
    expect(get.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(get.headers.accept).toBe('application/json');
    expect(get.headers['content-type']).toBeUndefined();

    await client().request('POST', `/zones/${ZONE_ID}/purge_cache`, { body: { purge_everything: true } });
    const post = server.requests[1]!;
    expect(post.headers['content-type']).toBe('application/json');
    expect(post.body).toEqual({ purge_everything: true });
  });

  it('never follows a redirect', async () => {
    mock.override = (req) =>
      req.path.endsWith('/moved')
        ? { status: 302, headers: { location: `${server.url}/elsewhere` } }
        : undefined;
    const err = await caught(client().request('GET', '/moved', { action: 'read' }));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toBe('Cloudflare: read failed: HTTP 302. The API redirects, check the base URL');
    expect(server.requests.map((r) => r.path)).toEqual([`${BASE_PATH}/moved`]);
  });

  it('reads every page of zones and records', async () => {
    for (let i = 1; i < 120; i++) mock.zones.push(zone({ id: hex(i, 'd'), name: `zone-${i}.ch` }));
    const zones = await client().list<CfZone>('/zones', { perPage: 50, maxPages: 200 });
    expect(zones).toHaveLength(120);
    expect(zones[119]!.name).toBe('zone-119.ch');
    const zoneCalls = sent('GET', '/zones');
    expect(zoneCalls.map((r) => [r.query.get('page'), r.query.get('per_page')])).toEqual([
      ['1', '50'],
      ['2', '50'],
      ['3', '50'],
    ]);

    mock.records.set(
      ZONE_ID,
      Array.from({ length: 1500 }, (_, i) =>
        record({ id: hex(i, 'e'), name: `h${i}.muster-shop.ch`, type: 'A', content: '203.0.113.1' }),
      ),
    );
    const records = await client().list<CfDnsRecord>(`/zones/${ZONE_ID}/dns_records`, {
      perPage: 1000,
      maxPages: 50,
    });
    expect(records).toHaveLength(1500);
    expect(sent('GET', `/zones/${ZONE_ID}/dns_records`).map((r) => r.query.get('page'))).toEqual(['1', '2']);
  });

  it('stops on an empty page and at maxPages', async () => {
    mock.override = (req) =>
      req.path === `${BASE_PATH}/zones`
        ? ok(req.query.get('page') === '1' ? [zone()] : [], {
            page: Number(req.query.get('page')),
            total_pages: 10,
          })
        : undefined;
    expect(await client().list('/zones', { perPage: 50, maxPages: 200 })).toHaveLength(1);
    expect(sent('GET', '/zones')).toHaveLength(2);

    server.requests.length = 0;
    mock.override = (req) =>
      req.path === `${BASE_PATH}/zones`
        ? ok([zone()], { page: Number(req.query.get('page')), total_pages: 1000 })
        : undefined;
    expect(await client().list('/zones', { perPage: 50, maxPages: 3 })).toHaveLength(3);
    expect(sent('GET', '/zones')).toHaveLength(3);

    // An endpoint that ignores the page parameter does not loop.
    server.requests.length = 0;
    mock.override = (req) =>
      req.path === `${BASE_PATH}/zones` ? ok([zone()], { page: 1, total_pages: 5 }) : undefined;
    expect(await client().list('/zones', { perPage: 50, maxPages: 200 })).toHaveLength(2);
  });

  it('turns failures into ProviderErrors with Cloudflare codes', async () => {
    const err = await caught(client().request('GET', '/nowhere', { action: 'read nowhere' }));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toBe('Cloudflare: read nowhere failed: No route for the URI (7003) (HTTP 404)');
    expect((err as ProviderError).upstreamStatus).toBe(404);
    expect(err.details).toEqual({ codes: [7003], errors: [{ code: 7003, message: 'No route for the URI' }] });
    expect(cloudflareCodes(err)).toEqual([7003]);
    expect(cloudflareCodes(new Error('x'))).toEqual([]);

    mock.override = () =>
      fail(400, [
        {
          code: 1004,
          message: 'DNS Validation Error',
          error_chain: [
            { code: 9021, message: 'Invalid TTL. Must be between 60 and 86400 seconds, or 1 for Automatic.' },
          ],
        },
        { code: 9005, message: 'Content for A record is invalid.' },
      ]);
    const chained = await caught(
      client().request('POST', `/zones/${ZONE_ID}/dns_records`, { action: 'add' }),
    );
    expect(chained.message).toBe(
      'Cloudflare: add failed: DNS Validation Error (1004) > Invalid TTL. Must be between 60 and 86400 seconds, or 1 for Automatic. (9021); Content for A record is invalid. (9005) (HTTP 400)',
    );
    expect(cloudflareCodes(chained)).toEqual([1004, 9021, 9005]);
    expect(chained.statusCode).toBe(502);
  });

  it('treats HTTP 200 with success false as a failure', async () => {
    mock.override = () => ({
      status: 200,
      body: {
        success: false,
        errors: [
          { code: 1092, message: 'Unable to purge https://muster-shop.ch/a' },
          { code: 1016, message: 'Some items could not be purged' },
        ],
        messages: [],
        result: { id: ZONE_ID },
      },
    });
    const err = await caught(client().request('POST', `/zones/${ZONE_ID}/purge_cache`, { action: 'purge' }));
    expect(err.message).toBe(
      'Cloudflare: purge failed: Unable to purge https://muster-shop.ch/a (1092); Some items could not be purged (1016) (HTTP 200)',
    );
    expect(cloudflareCodes(err)).toEqual([1092, 1016]);

    mock.override = () => ({ status: 200, body: { hello: 'world' } });
    const plain = await caught(client().request('GET', '/zones', { action: 'list zones' }));
    expect(plain.message).toBe(
      'Cloudflare: list zones failed: no Cloudflare API answer, check the base URL (HTTP 200)',
    );
  });

  it('never shows HTML error pages', async () => {
    mock.override = () => ({
      status: 502,
      body: '<!DOCTYPE html><html><head><title>502 Bad gateway</title></head><body>cloudflare</body></html>',
    });
    const html = await caught(client().request('GET', '/zones', { action: 'list zones' }));
    expect(html.message).toBe(
      'Cloudflare: list zones failed: HTTP 502. Cloudflare API not available right now',
    );

    mock.override = () => ({ status: 500, body: 'upstream connect error' });
    const text = await caught(client().request('GET', '/zones', { action: 'list zones' }));
    expect(text.message).toBe(
      'Cloudflare: list zones failed: upstream connect error (HTTP 500). Cloudflare API not available right now',
    );
  });

  it('explains token problems and never repeats the token', async () => {
    mock.override = () => fail(401, [{ code: 1000, message: `Invalid API Token ${TOKEN}` }]);
    const invalid = await caught(client().request('GET', '/user/tokens/verify', { action: 'verify' }));
    expect(invalid.message).toBe(
      'Cloudflare: verify failed: Invalid API Token [redacted] (1000) (HTTP 401). Check the API token (CLOUDFLARE_API_TOKEN): revoked, expired or mistyped',
    );

    // A valid token without a permission (Zone:Read instead of Zone:Edit) gets the same 403
    // as a revoked one: the permission is named, not only the token.
    mock.override = () => fail(403, [{ code: 10000, message: 'Authentication error' }]);
    const auth = await caught(client().request('POST', '/zones', { action: 'create zone' }));
    expect(auth.message).toBe(
      'Cloudflare: create zone failed: Authentication error (10000) (HTTP 403). The API token lacks a permission for this, or it was revoked or expired (CLOUDFLARE_API_TOKEN). The panel needs Zone:Edit, DNS:Edit, Zone Settings:Edit and Cache Purge:Purge on all zones of the account',
    );
    mock.override = () => fail(403, [{ code: 9109, message: 'Unauthorized to access requested resource' }]);
    const resource = await caught(client().request('GET', `/zones/${ZONE_ID}`, { action: 'read zone' }));
    expect(resource.message).toContain('The API token lacks a permission for this');
    expect(resource.message).not.toContain('mistyped');

    mock.override = () => fail(403, [{ code: 1013, message: 'Permission denied' }]);
    const permission = await caught(
      client().request('PATCH', `/zones/${ZONE_ID}/settings/ssl`, { action: 'ssl' }),
    );
    expect(permission.message).toBe(
      'Cloudflare: ssl failed: Permission denied (1013) (HTTP 403). The API token lacks a permission for this. The panel needs Zone:Edit, DNS:Edit, Zone Settings:Edit and Cache Purge:Purge on all zones of the account',
    );

    // A malformed token, as the mock answers without the right Authorization header.
    const wrong = new CloudflareClient({ apiToken: 'wrong token/with+chars=', baseUrl: baseUrl() });
    mock.override = (req) =>
      fail(400, [
        {
          code: 6003,
          message: `bad header ${String(req.headers.authorization)} ${encodeURIComponent('wrong token/with+chars=')}`,
        },
      ]);
    const malformed = await caught(wrong.request('GET', '/zones', { action: 'list zones' }));
    expect(malformed.message).toBe(
      'Cloudflare: list zones failed: bad header Bearer [redacted] [redacted] (6003) (HTTP 400). Check the API token (CLOUDFLARE_API_TOKEN): revoked, expired or mistyped',
    );
  });

  it('reports network failures without the token', async () => {
    const closed = new CloudflareClient({ apiToken: TOKEN, baseUrl: 'http://127.0.0.1:1/client/v4' });
    const err = await caught(closed.request('GET', '/zones', { action: 'list zones' }));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toMatch(/^Cloudflare: list zones failed: /);
    expect(err.message).not.toContain(TOKEN);
  });

  it('retries a 429 once after a short Retry-After and fails at once on a long one', async () => {
    let calls = 0;
    mock.override = (req) => {
      if (!req.path.endsWith('/zones')) return undefined;
      calls++;
      return calls === 1
        ? {
            ...fail(429, [{ code: 971, message: 'Please wait and consider throttling your request speed' }]),
            headers: { 'retry-after': '1' },
          }
        : undefined;
    };
    const started = Date.now();
    await client().request('GET', '/zones');
    expect(calls).toBe(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);

    server.requests.length = 0;
    mock.override = () => ({
      ...fail(429, [{ code: 971, message: 'Please wait and consider throttling your request speed' }]),
      headers: { 'retry-after': '60' },
    });
    const err = await caught(client().request('GET', '/zones', { action: 'list zones' }));
    expect(server.requests).toHaveLength(1);
    expect(err.message).toBe(
      'Cloudflare: list zones failed: Please wait and consider throttling your request speed (971) (HTTP 429). Cloudflare allows 1200 API requests per 5 minutes per user; retry after 60 s',
    );

    // Without Retry-After there is no retry either.
    server.requests.length = 0;
    mock.override = () => fail(429, [{ code: 971, message: 'Slow down' }]);
    const bare = await caught(client().request('GET', '/zones', { action: 'list zones' }));
    expect(server.requests).toHaveLength(1);
    expect(bare.message).toContain('try again in a few minutes');
  });

  it('keeps a request budget per connection, retries included', async () => {
    const short = client({ budget: { max: 3, windowMs: 1000 } });
    const started = Date.now();
    for (let i = 0; i < 3; i++) await short.request('GET', `/zones/${ZONE_ID}`);
    expect(Date.now() - started).toBeLessThan(900);
    await short.request('GET', `/zones/${ZONE_ID}`);
    expect(Date.now() - started).toBeGreaterThanOrEqual(950);
    expect(server.requests).toHaveLength(4);

    server.requests.length = 0;
    const long = client({ budget: { max: 3, windowMs: 60_000 } });
    for (let i = 0; i < 3; i++) await long.request('GET', `/zones/${ZONE_ID}`);
    const err = await caught(long.request('GET', `/zones/${ZONE_ID}`));
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).upstreamStatus).toBe(429);
    expect(err.message).toBe(
      "Cloudflare: the panel paused requests to stay below Cloudflare's limit of 1200 requests per 5 minutes, try again in 60 s",
    );
    expect(server.requests).toHaveLength(3);

    // A retried 429 uses two slots.
    server.requests.length = 0;
    let calls = 0;
    mock.override = () =>
      ++calls === 1
        ? { ...fail(429, [{ code: 971, message: 'wait' }]), headers: { 'retry-after': '0' } }
        : undefined;
    const two = client({ budget: { max: 2, windowMs: 60_000 } });
    await two.request('GET', `/zones/${ZONE_ID}`);
    expect(server.requests).toHaveLength(2);
    await expect(two.request('GET', `/zones/${ZONE_ID}`)).rejects.toThrow(/paused requests/);
  });

  it('keeps at most 4 requests in flight', async () => {
    let active = 0;
    let peak = 0;
    const slow: Server = createServer((_req, res) => {
      active++;
      peak = Math.max(peak, active);
      setTimeout(() => {
        active--;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ success: true, errors: [], messages: [], result: [] }));
      }, 40);
    });
    await new Promise<void>((resolve) => slow.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = slow.address() as AddressInfo;
      const c = new CloudflareClient({ apiToken: TOKEN, baseUrl: `http://127.0.0.1:${port}/client/v4` });
      await Promise.all(Array.from({ length: 10 }, () => c.request('GET', '/zones')));
      expect(peak).toBe(4);
    } finally {
      await new Promise<void>((resolve) => slow.close(() => resolve()));
    }
  });
});

// ---------------------------------------------------------------------------

describe('Cloudflare parsing', () => {
  it('maps zones to domain info', () => {
    expect(zoneToInfo(zone())).toEqual({
      name: 'muster-shop.ch',
      status: 'active',
      terminated: false,
      nameservers: ['ana.ns.cloudflare.com', 'bob.ns.cloudflare.com'],
      handle: null,
      createdAt: '2023-01-10T08:00:00.12345Z',
      expiresAt: null,
      autoRenew: null,
      providerDns: true,
      zone: {
        status: 'active',
        type: 'full',
        paused: false,
        originalNameservers: ['ns1.fireapi.de', 'ns2.fireapi.de'],
        originalRegistrar: 'Joker.com',
        activatedAt: '2023-01-10T14:30:00.12345Z',
        plan: 'Free Website',
      },
    });

    const pending = zoneToInfo(
      zone({
        status: 'pending',
        activated_on: null,
        name_servers: ['IVY.NS.CLOUDFLARE.COM.', 'rob.ns.cloudflare.com'],
        original_name_servers: null,
        original_registrar: null,
      }),
    );
    expect(pending.providerDns).toBe(false);
    expect(pending.nameservers).toEqual(['ivy.ns.cloudflare.com', 'rob.ns.cloudflare.com']);
    expect(pending.zone).toMatchObject({
      status: 'pending',
      activatedAt: null,
      originalNameservers: [],
      originalRegistrar: null,
    });

    expect(zoneToInfo(zone({ status: 'moved' }))).toMatchObject({ status: 'moved', providerDns: false });
    expect(zoneToInfo(zone({ paused: true })).zone).toMatchObject({ paused: true });
    expect(zoneToInfo(zone({ paused: undefined, plan: undefined })).zone).toMatchObject({
      paused: false,
      plan: null,
    });
    expect(zoneToInfo(zone({ type: 'partial', verification_key: '1234-5678' })).zone?.type).toBe('partial');

    expect(zoneToRemote(zone({ name: 'Muster-Shop.CH' }))).toMatchObject({
      externalId: ZONE_ID,
      name: 'muster-shop.ch',
      status: 'active',
      meta: { zoneType: 'full', plan: 'free', accountId: ACCOUNT },
    });
  });

  it('converts record names', () => {
    expect(toFqdn('@', 'muster-shop.ch')).toBe('muster-shop.ch');
    expect(toFqdn('', 'muster-shop.ch')).toBe('muster-shop.ch');
    expect(toFqdn('WWW', 'muster-shop.ch')).toBe('www.muster-shop.ch');
    expect(toFqdn('*', 'muster-shop.ch')).toBe('*.muster-shop.ch');
    expect(toFqdn('*.dev', 'muster-shop.ch')).toBe('*.dev.muster-shop.ch');
    expect(toRelative('muster-shop.ch', 'muster-shop.ch')).toBe('@');
    expect(toRelative('Muster-Shop.ch.', 'muster-shop.ch')).toBe('@');
    expect(toRelative('www.muster-shop.ch', 'muster-shop.ch')).toBe('www');
    expect(toRelative('*.muster-shop.ch', 'muster-shop.ch')).toBe('*');
    expect(toRelative('_sip._tcp.muster-shop.ch', 'muster-shop.ch')).toBe('_sip._tcp');
    expect(toRelative('xmuster-shop.ch', 'muster-shop.ch')).toBe('xmuster-shop.ch');
  });

  /** [panel input, request fields without name/type/ttl, record as Cloudflare returns it, panel data read back] */
  const TYPES: [DnsRecordInput, Record<string, unknown>, Partial<CfDnsRecord>, string][] = [
    [
      { type: 'A', name: '@', data: '203.0.113.10' },
      { content: '203.0.113.10', proxied: false },
      { content: '203.0.113.10' },
      '203.0.113.10',
    ],
    [
      { type: 'AAAA', name: 'v6', data: '2001:db8::10' },
      { content: '2001:db8::10', proxied: false },
      { content: '2001:db8::10' },
      '2001:db8::10',
    ],
    [
      { type: 'CNAME', name: 'shop', data: 'shops.example.net.' },
      { content: 'shops.example.net', proxied: false },
      { content: 'shops.example.net.' },
      'shops.example.net',
    ],
    [
      { type: 'NS', name: 'dev', data: 'ns1.example.net' },
      { content: 'ns1.example.net' },
      { content: 'ns1.example.net' },
      'ns1.example.net',
    ],
    [
      { type: 'PTR', name: '11', data: 'host.example.net' },
      { content: 'host.example.net' },
      { content: 'host.example.net' },
      'host.example.net',
    ],
    [
      { type: 'MX', name: '@', data: '10 mail.example.ch' },
      { content: 'mail.example.ch', priority: 10 },
      { content: 'mail.example.ch', priority: 10 },
      '10 mail.example.ch',
    ],
    [
      { type: 'TXT', name: '_dmarc', data: 'v=DMARC1; p=none' },
      { content: '"v=DMARC1; p=none"' },
      { content: '"v=DMARC1; p=none"' },
      'v=DMARC1; p=none',
    ],
    [
      { type: 'SRV', name: '_sip._tcp', data: '10 5 5060 sip.example.ch' },
      { data: { priority: 10, weight: 5, port: 5060, target: 'sip.example.ch' } },
      {
        content: '5 5060 sip.example.ch',
        priority: 10,
        data: { priority: 10, weight: 5, port: 5060, target: 'sip.example.ch' },
      },
      '10 5 5060 sip.example.ch',
    ],
    [
      { type: 'CAA', name: '@', data: '0 issue "letsencrypt.org"' },
      { data: { flags: 0, tag: 'issue', value: 'letsencrypt.org' } },
      { content: '0 issue "letsencrypt.org"', data: { flags: 0, tag: 'issue', value: 'letsencrypt.org' } },
      '0 issue "letsencrypt.org"',
    ],
    [
      { type: 'NAPTR', name: '@', data: '100 10 "u" "E2U+sip" "!^.*$!sip:info@example.ch!" .' },
      {
        data: {
          order: 100,
          preference: 10,
          flags: 'u',
          service: 'E2U+sip',
          regex: '!^.*$!sip:info@example.ch!',
          replacement: '.',
        },
      },
      {
        content: '100 10 "u" "E2U+sip" "!^.*$!sip:info@example.ch!" .',
        data: {
          order: 100,
          preference: 10,
          flags: 'u',
          service: 'E2U+sip',
          regex: '!^.*$!sip:info@example.ch!',
          replacement: '',
        },
      },
      '100 10 "u" "E2U+sip" "!^.*$!sip:info@example.ch!" .',
    ],
    [
      { type: 'TLSA', name: '_443._tcp.www', data: '3 1 1 0C72AC70B745AC19998811B131D662C9' },
      { data: { usage: 3, selector: 1, matching_type: 1, certificate: '0c72ac70b745ac19998811b131d662c9' } },
      {
        content: '3 1 1 0c72ac70b745ac19998811b131d662c9',
        data: { usage: 3, selector: 1, matching_type: 1, certificate: '0c72ac70b745ac19998811b131d662c9' },
      },
      '3 1 1 0c72ac70b745ac19998811b131d662c9',
    ],
    [
      { type: 'DS', name: 'dev', data: '12345 13 2 3C8F45C2E4B4A9E8D7A2E0E5B1C9D8F0' },
      { data: { key_tag: 12345, algorithm: 13, digest_type: 2, digest: '3c8f45c2e4b4a9e8d7a2e0e5b1c9d8f0' } },
      {
        content: '12345 13 2 3c8f45c2e4b4a9e8d7a2e0e5b1c9d8f0',
        data: { key_tag: 12345, algorithm: 13, digest_type: 2, digest: '3c8f45c2e4b4a9e8d7a2e0e5b1c9d8f0' },
      },
      '12345 13 2 3c8f45c2e4b4a9e8d7a2e0e5b1c9d8f0',
    ],
  ];

  it.each(TYPES)('converts %o both ways', (input, fields, raw, read) => {
    const name = toFqdn(input.name, 'muster-shop.ch');
    expect(recordBody(input, 'muster-shop.ch')).toEqual({ type: input.type, name, ttl: 1, ...fields });
    const back = toDnsRecord({ id: hex(1), name, type: input.type, ttl: 1, ...raw }, 'muster-shop.ch');
    expect(back).toMatchObject({ type: input.type, name: input.name, data: read, ttl: 1 });
    expect(back.readOnly).toBeUndefined();
  });

  it('reads DNSKEY and Cloudflare-only types read only', () => {
    const dnskey = toDnsRecord(
      {
        id: hex(1),
        name: 'muster-shop.ch',
        type: 'DNSKEY',
        content: '257 3 13 mdsswUyr3DPW132mOi8V9xESWE8jTo0d',
        data: { flags: 257, protocol: 3, algorithm: 13, public_key: 'mdsswUyr3DPW132mOi8V9xESWE8jTo0d' },
      },
      'muster-shop.ch',
    );
    expect(dnskey).toMatchObject({ data: '257 3 13 mdsswUyr3DPW132mOi8V9xESWE8jTo0d', readOnly: true });
    const https = toDnsRecord(
      {
        id: hex(2),
        name: 'muster-shop.ch',
        type: 'HTTPS',
        content: '1 . alpn="h3,h2"',
        data: { priority: 1 },
      },
      'muster-shop.ch',
    );
    expect(https).toMatchObject({ type: 'HTTPS', data: '1 . alpn="h3,h2"', readOnly: true });
    const loc = toDnsRecord(
      { id: hex(3), name: 'office.muster-shop.ch', type: 'LOC', content: '', data: { lat_degrees: 47 } },
      'muster-shop.ch',
    );
    expect(loc).toMatchObject({ data: '{"lat_degrees":47}', readOnly: true });
    const locked = toDnsRecord(
      { id: hex(4), name: 'muster-shop.ch', type: 'A', content: '203.0.113.1', locked: true },
      'muster-shop.ch',
    );
    expect(locked.readOnly).toBe(true);
    const metaReadOnly = toDnsRecord(
      { id: hex(5), name: 'muster-shop.ch', type: 'A', content: '203.0.113.1', meta: { read_only: true } },
      'muster-shop.ch',
    );
    expect(metaReadOnly.readOnly).toBe(true);
    const apexNs = toDnsRecord(
      { id: hex(6), name: 'muster-shop.ch', type: 'NS', content: 'ana.ns.cloudflare.com' },
      'muster-shop.ch',
    );
    expect(apexNs.readOnly).toBe(true);
    const delegated = toDnsRecord(
      { id: hex(7), name: 'dev.muster-shop.ch', type: 'NS', content: 'ns1.example.net' },
      'muster-shop.ch',
    );
    expect(delegated.readOnly).toBeUndefined();
    const secondary = toDnsRecord(
      { id: hex(8), name: 'www.muster-shop.ch', type: 'A', content: '203.0.113.1' },
      'muster-shop.ch',
      'secondary',
    );
    expect(secondary.readOnly).toBe(true);
  });

  it('reads a null MX (RFC 7505) with its "." target', () => {
    const nullMx = toDnsRecord(
      { id: hex(1), name: 'muster-shop.ch', type: 'MX', content: '.', priority: 0 },
      'muster-shop.ch',
    );
    expect(nullMx).toMatchObject({ type: 'MX', name: '@', data: '0 .' });
  });

  it('carries proxy flags, comments and TTL', () => {
    const www = toDnsRecord(
      {
        id: WWW_ID,
        name: 'www.muster-shop.ch',
        type: 'CNAME',
        content: 'muster-shop.ch',
        proxiable: true,
        proxied: true,
        ttl: 1,
        comment: null,
        tags: [],
      },
      'muster-shop.ch',
    );
    expect(www).toEqual({
      id: WWW_ID,
      type: 'CNAME',
      name: 'www',
      data: 'muster-shop.ch',
      ttl: 1,
      proxied: true,
      proxiable: true,
      comment: null,
    });
    const txt = toDnsRecord(
      {
        id: hex(1),
        name: 'muster-shop.ch',
        type: 'txt',
        content: 'plain',
        ttl: 3600,
        comment: 'Search Console',
      },
      'muster-shop.ch',
    );
    expect(txt).toMatchObject({
      type: 'TXT',
      proxied: false,
      proxiable: false,
      comment: 'Search Console',
      ttl: 3600,
    });
  });

  it('quotes and unquotes TXT values', () => {
    expect(quoteTxt('v=spf1 -all')).toBe('"v=spf1 -all"');
    expect(quoteTxt('')).toBe('""');
    expect(quoteTxt('say "hi" \\ there')).toBe('"say \\"hi\\" \\\\ there"');
    expect(unquoteTxt('"say \\"hi\\" \\\\ there"')).toBe('say "hi" \\ there');

    const long = 'k'.repeat(300);
    expect(quoteTxt(long)).toBe(`"${'k'.repeat(255)}" "${'k'.repeat(45)}"`);
    expect(unquoteTxt(quoteTxt(long))).toBe(long);

    // 254 bytes plus a two byte character: the character goes to the next string whole.
    const umlaut = `${'a'.repeat(254)}äb`;
    expect(quoteTxt(umlaut)).toBe(`"${'a'.repeat(254)}" "äb"`);
    expect(unquoteTxt(quoteTxt(umlaut))).toBe(umlaut);
    const emoji = `${'a'.repeat(253)}😀`;
    expect(quoteTxt(emoji)).toBe(`"${'a'.repeat(253)}" "😀"`);

    // Legacy unquoted content stays as it is, also with quotes inside.
    expect(unquoteTxt('v=spf1 include:_spf.example.ch -all')).toBe('v=spf1 include:_spf.example.ch -all');
    expect(unquoteTxt('say "hi" there')).toBe('say "hi" there');
    expect(unquoteTxt('"one" "two"')).toBe('onetwo');
    expect(unquoteTxt('"caf\\195\\169"')).toBe('café');

    const dkim = `v=DKIM1; k=rsa; p=${'A'.repeat(392)}`;
    expect(unquoteTxt(quoteTxt(dkim))).toBe(dkim);
  });

  it('validates records before sending', () => {
    const issue = (input: Partial<DnsRecordInput>) => {
      try {
        recordBody(
          { type: 'A', name: '@', data: '203.0.113.1', ...input } as DnsRecordInput,
          'muster-shop.ch',
        );
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(400);
        return (err as AppError).message;
      }
      return null;
    };
    expect(issue({ type: 'MX', data: 'mail.example.ch' })).toBe(
      'MX records need "priority host", e.g. "10 mail.example.ch"',
    );
    expect(issue({ type: 'MX', data: '70000 mail.example.ch' })).toMatch(/^MX records need/);
    expect(issue({ type: 'SRV', data: '10 5 70000 sip.example.ch' })).toMatch(
      /^SRV records need .* up to 65535/,
    );
    expect(issue({ type: 'CAA', data: '256 issue "letsencrypt.org"' })).toMatch(
      /^CAA records need .*flags 0 to 255/,
    );
    expect(issue({ type: 'TLSA', data: '3 1 1 not-hex' })).toMatch(/^TLSA records need .* in hex/);
    expect(issue({ type: 'DS', data: '12345 13 2 xyz' })).toMatch(/^DS records need/);
    expect(issue({ type: 'NAPTR', data: '100 10 u E2U+sip x .' })).toMatch(/^NAPTR records need/);
    expect(issue({ type: 'A', data: '2001:db8::1' })).toBe('A records need an IPv4 address');
    expect(issue({ type: 'AAAA', data: '203.0.113.1' })).toBe('AAAA records need an IPv6 address');
    expect(issue({ type: 'CNAME', data: 'not a host' })).toMatch(/^CNAME records need a host name/);
    expect(issue({ type: 'TXT', data: 'line\nbreak' })).toMatch(/line breaks/);
    expect(issue({ type: 'MX', data: '10 mail.example.ch', proxied: true })).toBe(
      'Only A, AAAA and CNAME records can be proxied',
    );
    expect(issue({ type: 'NS', name: '@', data: 'ns1.example.net' })).toBe(
      'Cloudflare manages the name servers of the zone itself',
    );
    expect(issue({ type: 'NS', name: '', data: 'ns1.example.net' })).toBe(
      'Cloudflare manages the name servers of the zone itself',
    );
    expect(issue({ ttl: 30 })).toMatch(/TTL of 1 \(automatic\) or between 60 and 86400 seconds \(got 30\)/);
    expect(issue({ ttl: 90_000 })).toMatch(/got 90000/);
    expect(issue({ ttl: 0 })).toMatch(/got 0/);
    expect(issue({ type: 'ALIAS' as DnsRecordInput['type'] })).toBe(
      'ALIAS records cannot be added or changed at Cloudflare',
    );
    expect(issue({ type: 'DNSKEY' as DnsRecordInput['type'] })).toMatch(/cannot be added/);
    expect(issue({ name: 'bad name' })).toBe('Invalid record name "bad name"');
    for (const ttl of [1, 60, 86_400]) expect(issue({ ttl })).toBeNull();
    expect(issue({ type: 'SRV', data: '0 0 0 .' })).toBeNull();
    expect(issue({ type: 'CAA', data: '128 iodef mailto:security@example.ch' })).toBeNull();
  });

  it('defaults to automatic TTL and keeps proxied records automatic', () => {
    expect(recordBody({ type: 'A', name: 'www', data: '203.0.113.1' }, 'muster-shop.ch')).toEqual({
      type: 'A',
      name: 'www.muster-shop.ch',
      content: '203.0.113.1',
      proxied: false,
      ttl: 1,
    });
    expect(
      recordBody({ type: 'A', name: 'www', data: '203.0.113.1', ttl: 300, proxied: true }, 'muster-shop.ch'),
    ).toMatchObject({
      proxied: true,
      ttl: 1,
    });
    expect(recordBody({ type: 'A', name: 'www', data: '203.0.113.1', ttl: 300 }, 'muster-shop.ch').ttl).toBe(
      300,
    );
    expect(
      recordBody({ type: 'MX', name: '@', data: '10 mx.example.ch', ttl: null }, 'muster-shop.ch'),
    ).not.toHaveProperty('proxied');
  });

  it('builds PATCH bodies with the changed fields only', () => {
    const a: DnsRecord = {
      id: APEX_ID,
      type: 'A',
      name: '@',
      data: '203.0.113.1',
      ttl: 3600,
      proxied: false,
      proxiable: true,
    };
    const zoneName = 'muster-shop.ch';
    expect(recordPatch(a, { data: '203.0.113.9' }, zoneName)).toEqual({ content: '203.0.113.9' });
    expect(recordPatch(a, { data: '203.0.113.1', name: '@', ttl: 3600 }, zoneName)).toEqual({});
    expect(recordPatch(a, { name: 'shop' }, zoneName)).toEqual({ name: 'shop.muster-shop.ch' });
    expect(recordPatch(a, { ttl: 300 }, zoneName)).toEqual({ ttl: 300 });
    expect(recordPatch(a, { ttl: null }, zoneName)).toEqual({});
    expect(recordPatch(a, { proxied: true }, zoneName)).toEqual({ proxied: true, ttl: 1 });
    expect(recordPatch(a, { proxied: true, ttl: 600 }, zoneName)).toEqual({ proxied: true, ttl: 1 });

    const proxied: DnsRecord = { ...a, proxied: true, ttl: 1 };
    expect(recordPatch(proxied, { ttl: 600 }, zoneName)).toEqual({});
    expect(recordPatch(proxied, { proxied: false }, zoneName)).toEqual({ proxied: false });
    expect(recordPatch(proxied, { proxied: false, ttl: 600 }, zoneName)).toEqual({
      proxied: false,
      ttl: 600,
    });

    const mx: DnsRecord = {
      id: MX_ID,
      type: 'MX',
      name: '@',
      data: '10 mail.example.ch',
      ttl: 3600,
      proxied: false,
    };
    expect(recordPatch(mx, { data: '20 mail.example.ch' }, zoneName)).toEqual({
      content: 'mail.example.ch',
      priority: 20,
    });
    expect(() => recordPatch(mx, { proxied: true }, zoneName)).toThrow(
      'Only A, AAAA and CNAME records can be proxied',
    );
    expect(() => recordPatch(mx, { ttl: 30 }, zoneName)).toThrow(/got 30/);
    const ns: DnsRecord = { id: hex(9), type: 'NS', name: 'dev', data: 'ns1.example.net', ttl: 3600 };
    expect(() => recordPatch(ns, { name: '@' }, zoneName)).toThrow('Cloudflare manages the name servers');
  });

  it('reads CDN settings', () => {
    const setting = (id: string, value: unknown, extra: Record<string, unknown> = {}) => ({
      id,
      value,
      editable: true,
      modified_on: NOW,
      ...extra,
    });
    expect(
      parseCdn(
        setting('ssl', 'strict'),
        setting('ssl_automatic_mode', 'auto'),
        setting('always_use_https', 'off', { editable: false }),
        setting('development_mode', 'on', { time_remaining: 3600 }),
      ),
    ).toEqual({
      sslMode: 'strict',
      sslAutomatic: true,
      alwaysUseHttps: false,
      developmentMode: true,
      developmentModeRemaining: 3600,
      editable: { sslMode: true, alwaysUseHttps: false, developmentMode: true },
    });
    const off = parseCdn(
      setting('ssl', 'origin_pull'),
      null,
      setting('always_use_https', 'on'),
      setting('development_mode', 'off', { time_remaining: -120 }),
    );
    expect(off).toMatchObject({
      sslMode: 'origin_pull',
      sslAutomatic: null,
      alwaysUseHttps: true,
      developmentMode: false,
      developmentModeRemaining: null,
    });
    const never = parseCdn(
      setting('ssl', 'full'),
      setting('ssl_automatic_mode', 'custom'),
      setting('always_use_https', 'on'),
      setting('development_mode', 'off', { time_remaining: false }),
    );
    expect(never).toMatchObject({ sslAutomatic: false, developmentModeRemaining: null });
  });

  it('redacts secrets in explorer answers', () => {
    const tokenCreate = {
      success: true,
      result: {
        id: 'ed17574386854bf78a67040be0a770b0',
        name: 'deploy',
        status: 'active',
        value: '8M7wS6hCpXVc-DoRnPPY_UCWPgy8aea4Wy6kCe5T',
      },
    };
    expect(redactSecrets(tokenCreate, '/user/tokens')).toEqual({
      success: true,
      result: {
        id: 'ed17574386854bf78a67040be0a770b0',
        name: 'deploy',
        status: 'active',
        value: '[redacted]',
      },
    });
    expect(redactSecrets(tokenCreate, `/accounts/${ACCOUNT}/tokens?page=1`).result.value).toBe('[redacted]');

    const tunnel = { success: true, errors: [], result: 'eyJhIjoiNWFiNGU5Z...' };
    expect(
      redactSecrets(tunnel, `/accounts/${ACCOUNT}/cfd_tunnel/f70ff985-a4ef-4643-bbbc-4a0ed4fc8415/token`)
        .result,
    ).toBe('[redacted]');

    const certificate = {
      result: [
        {
          id: '2458ce5a-0c35-4c7f-82c7-8e9487d3ff60',
          certificate: '-----BEGIN CERTIFICATE-----\nMIIDtTCCAp2g...',
          private_key: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...',
          keyless_server: { tunnel: { private_ip: '10.0.0.1' } },
        },
      ],
    };
    const redacted = redactSecrets(certificate, `/zones/${ZONE_ID}/custom_certificates`);
    expect(redacted.result[0]).toMatchObject({
      certificate: '-----BEGIN CERTIFICATE-----\nMIIDtTCCAp2g...',
      private_key: '[redacted]',
      keyless_server: { tunnel: { private_ip: '10.0.0.1' } },
    });
    expect(
      redactSecrets(
        { result: { token: 'abc', secret: 'x', password: 'y', psk: 'z', client_secret: null } },
        '/x',
      ),
    ).toEqual({
      result: {
        token: '[redacted]',
        secret: '[redacted]',
        password: '[redacted]',
        psk: '[redacted]',
        client_secret: null,
      },
    });

    // Elsewhere "value" and "result" are ordinary data.
    expect(redactSecrets({ result: { id: 'ssl', value: 'full' } }, `/zones/${ZONE_ID}/settings/ssl`)).toEqual(
      {
        result: { id: 'ssl', value: 'full' },
      },
    );
    expect(redactSecrets({ result: 'text' }, '/zones')).toEqual({ result: 'text' });
  });
});

// ---------------------------------------------------------------------------

describe('Cloudflare adapter', () => {
  it('has no servers', async () => {
    const cf = adapter();
    expect(cf.type).toBe('cloudflare');
    expect(cf.capabilities()).toEqual([]);
    expect(cf.powerActions()).toEqual([]);
    expect(await cf.listServers()).toEqual([]);
    const err = await caught(cf.getServer({ externalId: '1', kind: 'vm', node: null, meta: {} }));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.statusCode).toBe(404);
  });

  it('reports zone capabilities, kind and record types', async () => {
    const cf = adapter();
    expect(cf.domainKind()).toBe('zone');
    expect(cf.domainCapabilities()).toEqual(CLOUDFLARE_DOMAIN_CAPABILITIES);
    expect(cf.dnsRecordTypes()).toEqual([...CLOUDFLARE_RECORD_TYPES]);
    expect(await cf.dnsWritable()).toBe(true);
    expect(cf.canCreateZones()).toBe(false);
    expect(adapter(ACCOUNT).canCreateZones()).toBe(true);
    expect(adapter('not-an-account-id').canCreateZones()).toBe(false);
  });

  it('tests the connection with a user token', async () => {
    const info = await adapter().testConnection();
    expect(info).toEqual({
      token: 'active',
      tokenExpires: '2027-01-01T00:00:00Z',
      account: null,
      accountId: null,
      zones: 1,
      zoneCreation: false,
    });
    expect(server.requests.map((r) => r.path)).toEqual([
      `${BASE_PATH}/user/tokens/verify`,
      `${BASE_PATH}/zones`,
    ]);
    const list = sent('GET', '/zones')[0]!;
    expect(list.query.get('per_page')).toBe('5');
    expect(list.query.get('page')).toBe('1');
    expect(list.query.has('account.id')).toBe(false);
    expect(JSON.stringify(info)).not.toContain(TOKEN);
  });

  it('verifies account tokens at the account first and falls back to the user endpoint', async () => {
    mock.token.kind = 'account';
    const info = await adapter(ACCOUNT).testConnection();
    expect(info).toMatchObject({
      token: 'active',
      account: 'weblion.one',
      accountId: ACCOUNT,
      zoneCreation: true,
    });
    expect(sent('GET', `/accounts/${ACCOUNT}/tokens/verify`)).toHaveLength(1);
    expect(sent('GET', '/user/tokens/verify')).toHaveLength(0);
    expect(sent('GET', '/zones')[0]!.query.get('account.id')).toBe(ACCOUNT);

    server.requests.length = 0;
    mock.token.kind = 'user';
    mock.accountReadable = false;
    const user = await adapter(ACCOUNT).testConnection();
    expect(user).toMatchObject({ token: 'active', account: null, accountId: ACCOUNT });
    expect(server.requests.map((r) => r.path).slice(0, 2)).toEqual([
      `${BASE_PATH}/accounts/${ACCOUNT}/tokens/verify`,
      `${BASE_PATH}/user/tokens/verify`,
    ]);
  });

  it('refuses inactive tokens and invalid account ids', async () => {
    mock.token.status = 'disabled';
    const err = await caught(adapter().testConnection());
    expect(err.message).toBe(
      'Cloudflare: the API token is disabled. Check the API token (CLOUDFLARE_API_TOKEN): revoked, expired or mistyped',
    );
    expect(sent('GET', '/zones')).toHaveLength(0);

    server.requests.length = 0;
    const invalid = await caught(adapter('../user').testConnection());
    expect(invalid.message).toContain('32 character hex id');
    // The zone list is not widened to every account of the token either.
    const list = await caught(adapter('../user').listDomains());
    expect(list.message).toContain('32 character hex id');
    expect(server.requests).toHaveLength(0);
  });

  it('lists zones of the account as domains', async () => {
    mock.zones.push(
      zone({ id: hex(1, 'd'), name: 'beispiel-gmbh.de', status: 'pending', activated_on: null }),
      zone({ id: hex(2, 'd'), name: 'fremd.ch', account: { id: OTHER_ACCOUNT, name: 'other' } }),
    );
    const all = await adapter().listDomains();
    expect(all.map((d) => d.name)).toEqual(['muster-shop.ch', 'beispiel-gmbh.de', 'fremd.ch']);

    server.requests.length = 0;
    const domains = await adapter(ACCOUNT).listDomains();
    expect(domains.map((d) => d.name)).toEqual(['muster-shop.ch', 'beispiel-gmbh.de']);
    const list = sent('GET', '/zones')[0]!;
    expect(list.query.get('account.id')).toBe(ACCOUNT);
    expect(list.query.get('per_page')).toBe('50');
    expect(domains[0]).toEqual({
      externalId: ZONE_ID,
      name: 'muster-shop.ch',
      status: 'active',
      info: zoneToInfo(zone()),
      meta: { zoneType: 'full', plan: 'free', accountId: ACCOUNT },
    });
    expect(domains[1]!.info).toMatchObject({ status: 'pending', providerDns: false });
  });

  it('summarizes the account', async () => {
    mock.zones.push(
      zone({ id: hex(1, 'd'), name: 'beispiel-gmbh.de', status: 'pending' }),
      zone({ id: hex(2, 'd'), name: 'alt-muster.ch', status: 'moved' }),
    );
    const overview = await adapter(ACCOUNT).overview();
    expect(overview.facts).toEqual([
      { label: 'Account', value: 'weblion.one' },
      { label: 'Zones', value: '3' },
      { label: 'Active', value: '1' },
      { label: 'Pending', value: '1' },
      { label: 'Moved', value: '1' },
      { label: 'Zone creation', value: 'yes' },
    ]);
    expect((await adapter().overview()).facts.at(-1)).toEqual({
      label: 'Zone creation',
      value: 'no (no account id)',
    });
  });

  it('caches zone details for 30 s and forgets them after an activation check', async () => {
    const cf = adapter();
    const reads = () => sent('GET', `/zones/${ZONE_ID}`).length;
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const t0 = Date.parse('2026-10-10T10:00:00Z');
      vi.setSystemTime(t0);
      expect((await cf.getDomain(ZONE_ID)).status).toBe('active');
      await cf.getDomain(ZONE_ID);
      vi.setSystemTime(t0 + 29_000);
      await cf.getDomain(ZONE_ID);
      expect(reads()).toBe(1);
      mock.zones[0]!.status = 'pending';
      vi.setSystemTime(t0 + 31_000);
      expect((await cf.getDomain(ZONE_ID)).status).toBe('pending');
      expect(reads()).toBe(2);

      expect(await cf.checkZoneActivation(ZONE_ID)).toEqual({
        providerRef: null,
        message: 'Activation check requested',
      });
      expect(reads()).toBe(2);
      expect(sent('PUT', `/zones/${ZONE_ID}/activation_check`)).toHaveLength(1);
      mock.zones[0]!.status = 'active';
      expect((await cf.getDomain(ZONE_ID)).status).toBe('active');
      expect(reads()).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('checks the activation of pending zones only', async () => {
    const err = await caught(adapter().checkZoneActivation(ZONE_ID));
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe('muster-shop.ch is active: only pending zones can be checked for activation');
    expect(sent('PUT', `/zones/${ZONE_ID}/activation_check`)).toHaveLength(0);
  });

  it('lists DNS records, cached for 15 s and forgotten after changes', async () => {
    const cf = adapter();
    const lists = () => sent('GET', `/zones/${ZONE_ID}/dns_records`).length;
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const t0 = Date.parse('2026-10-10T10:00:00Z');
      vi.setSystemTime(t0);
      const records = await cf.listDnsRecords(ZONE_ID);
      expect(records.map((r) => [r.type, r.name, r.data, r.ttl, r.proxied, r.readOnly ?? false])).toEqual([
        ['A', '@', '185.101.20.11', 1, true, false],
        ['CNAME', 'www', 'muster-shop.ch', 1, true, false],
        ['MX', '@', '10 mail.muster-ag.ch', 3600, false, false],
        ['TXT', '@', 'google-site-verification=abc123', 3600, false, false],
        ['HTTPS', '@', '1 . alpn="h3,h2"', 1, false, true],
        ['A', 'mail', '185.101.20.20', 3600, false, false],
      ]);
      expect(records[3]!.comment).toBe('Google Search Console');
      expect(sent('GET', `/zones/${ZONE_ID}/dns_records`)[0]!.query.get('per_page')).toBe('1000');
      await cf.listDnsRecords(ZONE_ID);
      vi.setSystemTime(t0 + 14_000);
      await cf.listDnsRecords(ZONE_ID);
      expect(lists()).toBe(1);
      vi.setSystemTime(t0 + 16_000);
      await cf.listDnsRecords(ZONE_ID);
      expect(lists()).toBe(2);

      await cf.addDnsRecord(ZONE_ID, { type: 'A', name: 'shop', data: '203.0.113.5' });
      expect(await cf.listDnsRecords(ZONE_ID)).toHaveLength(7);
      expect(lists()).toBe(3);
      await cf.updateDnsRecord(ZONE_ID, MAIL_ID, { data: '185.101.20.21' });
      expect((await cf.listDnsRecords(ZONE_ID)).find((r) => r.id === MAIL_ID)!.data).toBe('185.101.20.21');
      expect(lists()).toBe(4);
      await cf.deleteDnsRecord(ZONE_ID, MAIL_ID);
      expect(await cf.listDnsRecords(ZONE_ID)).toHaveLength(6);
      expect(lists()).toBe(5);
      // The zone name was read once, then kept.
      expect(sent('GET', `/zones/${ZONE_ID}`)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('adds records with the body each type needs', async () => {
    const cf = adapter();
    const cases: [DnsRecordInput, Record<string, unknown>, string][] = [
      [
        { type: 'A', name: 'shop', data: '203.0.113.10' },
        { type: 'A', name: 'shop.muster-shop.ch', content: '203.0.113.10', proxied: false, ttl: 1 },
        '203.0.113.10',
      ],
      [
        { type: 'A', name: 'cdn', data: '203.0.113.11', ttl: 300, proxied: true },
        { type: 'A', name: 'cdn.muster-shop.ch', content: '203.0.113.11', proxied: true, ttl: 1 },
        '203.0.113.11',
      ],
      [
        { type: 'AAAA', name: '@', data: '2001:db8::1', ttl: 3600 },
        { type: 'AAAA', name: 'muster-shop.ch', content: '2001:db8::1', proxied: false, ttl: 3600 },
        '2001:db8::1',
      ],
      [
        { type: 'CNAME', name: 'blog', data: 'shops.example.net.' },
        { type: 'CNAME', name: 'blog.muster-shop.ch', content: 'shops.example.net', proxied: false, ttl: 1 },
        'shops.example.net',
      ],
      [
        { type: 'MX', name: '@', data: '20 mx2.muster-ag.ch', ttl: 3600 },
        { type: 'MX', name: 'muster-shop.ch', content: 'mx2.muster-ag.ch', priority: 20, ttl: 3600 },
        '20 mx2.muster-ag.ch',
      ],
      [
        { type: 'TXT', name: '_dmarc', data: 'v=DMARC1; p=none' },
        { type: 'TXT', name: '_dmarc.muster-shop.ch', content: '"v=DMARC1; p=none"', ttl: 1 },
        'v=DMARC1; p=none',
      ],
      [
        { type: 'SRV', name: '_sip._tcp', data: '10 5 5060 sip.muster-shop.ch' },
        {
          type: 'SRV',
          name: '_sip._tcp.muster-shop.ch',
          data: { priority: 10, weight: 5, port: 5060, target: 'sip.muster-shop.ch' },
          ttl: 1,
        },
        '10 5 5060 sip.muster-shop.ch',
      ],
      [
        { type: 'CAA', name: '@', data: '0 issue "letsencrypt.org"' },
        {
          type: 'CAA',
          name: 'muster-shop.ch',
          data: { flags: 0, tag: 'issue', value: 'letsencrypt.org' },
          ttl: 1,
        },
        '0 issue "letsencrypt.org"',
      ],
      [
        { type: 'NS', name: 'dev', data: 'ns1.example.net' },
        { type: 'NS', name: 'dev.muster-shop.ch', content: 'ns1.example.net', ttl: 1 },
        'ns1.example.net',
      ],
      [
        { type: 'TLSA', name: '_443._tcp.www', data: '3 1 1 ABCDEF0123' },
        {
          type: 'TLSA',
          name: '_443._tcp.www.muster-shop.ch',
          data: { usage: 3, selector: 1, matching_type: 1, certificate: 'abcdef0123' },
          ttl: 1,
        },
        '3 1 1 abcdef0123',
      ],
    ];
    for (const [input, body, data] of cases) {
      const created = await cf.addDnsRecord(ZONE_ID, input);
      const posts = sent('POST', `/zones/${ZONE_ID}/dns_records`);
      expect(posts.at(-1)!.body).toEqual(body);
      expect(created).toMatchObject({ type: input.type, name: input.name, data });
      expect(created!.id).toMatch(/^[0-9a-f]{32}$/);
    }
    expect(JSON.stringify(sent('POST', `/zones/${ZONE_ID}/dns_records`).map((r) => r.body))).not.toMatch(
      /comment|tags|settings/,
    );

    // Cloudflare's refusal comes through with its code.
    const conflictErr = await caught(
      cf.addDnsRecord(ZONE_ID, { type: 'A', name: 'www', data: '203.0.113.12' }),
    );
    expect(conflictErr.message).toContain(
      'An A, AAAA, or CNAME record with that host already exists. (81053)',
    );
  });

  it('refuses invalid records before sending', async () => {
    const cf = adapter();
    await cf.listDnsRecords(ZONE_ID);
    server.requests.length = 0;
    const err = await caught(
      cf.addDnsRecord(ZONE_ID, { type: 'MX', name: '@', data: '10 mx.example.ch', proxied: true }),
    );
    expect(err.statusCode).toBe(400);
    expect(server.requests).toHaveLength(0);
  });

  it('refuses changes in secondary zones', async () => {
    mock.zones[0]!.type = 'secondary';
    const cf = adapter();
    const err = await caught(cf.addDnsRecord(ZONE_ID, { type: 'A', name: 'x', data: '203.0.113.1' }));
    expect(err.statusCode).toBe(422);
    expect(sent('POST', `/zones/${ZONE_ID}/dns_records`)).toHaveLength(0);
    expect((await cf.listDnsRecords(ZONE_ID)).every((r) => r.readOnly)).toBe(true);
    const update = await caught(cf.updateDnsRecord(ZONE_ID, MAIL_ID, { data: '203.0.113.2' }));
    expect(update.statusCode).toBe(400);
  });

  it('updates records with the changed fields only', async () => {
    const cf = adapter();
    const patches = () => server.requests.filter((r) => r.method === 'PATCH').map((r) => [r.path, r.body]);

    const changed = await cf.updateDnsRecord(ZONE_ID, APEX_ID, { data: '185.101.20.99' });
    expect(changed).toMatchObject({ id: APEX_ID, data: '185.101.20.99', proxied: true, ttl: 1 });
    expect(sent('GET', `/zones/${ZONE_ID}/dns_records/${APEX_ID}`)).toHaveLength(1);

    const proxied = await cf.updateDnsRecord(ZONE_ID, MAIL_ID, { proxied: true });
    expect(proxied).toMatchObject({ id: MAIL_ID, proxied: true, ttl: 1 });

    await cf.updateDnsRecord(ZONE_ID, MX_ID, { ttl: 600 });
    await cf.updateDnsRecord(ZONE_ID, WWW_ID, { name: 'shop' });
    expect(patches()).toEqual([
      [`${BASE_PATH}/zones/${ZONE_ID}/dns_records/${APEX_ID}`, { content: '185.101.20.99' }],
      [`${BASE_PATH}/zones/${ZONE_ID}/dns_records/${MAIL_ID}`, { proxied: true, ttl: 1 }],
      [`${BASE_PATH}/zones/${ZONE_ID}/dns_records/${MX_ID}`, { ttl: 600 }],
      [`${BASE_PATH}/zones/${ZONE_ID}/dns_records/${WWW_ID}`, { name: 'shop.muster-shop.ch' }],
    ]);

    // The comment survives a PATCH (Cloudflare keeps what is not sent).
    const txt = await cf.updateDnsRecord(ZONE_ID, TXT_ID, { data: 'google-site-verification=xyz' });
    expect(txt).toMatchObject({ data: 'google-site-verification=xyz', comment: 'Google Search Console' });
    expect(patches().at(-1)![1]).toEqual({ content: '"google-site-verification=xyz"' });

    // Nothing to change: no PATCH.
    const before = patches().length;
    const same = await cf.updateDnsRecord(ZONE_ID, MX_ID, { data: '10 mail.muster-ag.ch', type: 'MX' });
    expect(same).toMatchObject({ id: MX_ID, data: '10 mail.muster-ag.ch' });
    expect(patches()).toHaveLength(before);

    const mx = await caught(cf.updateDnsRecord(ZONE_ID, MX_ID, { proxied: true }));
    expect(mx.message).toBe('Only A, AAAA and CNAME records can be proxied');
    expect(patches()).toHaveLength(before);
  });

  it('changes the type through a batch and returns the new id', async () => {
    const cf = adapter();
    const changed = await cf.updateDnsRecord(ZONE_ID, WWW_ID, { type: 'A', data: '185.101.20.11' });
    const batch = sent('POST', `/zones/${ZONE_ID}/dns_records/batch`);
    expect(batch).toHaveLength(1);
    expect(batch[0]!.body).toEqual({
      deletes: [{ id: WWW_ID }],
      posts: [
        {
          type: 'A',
          name: 'www.muster-shop.ch',
          content: '185.101.20.11',
          proxied: true,
          ttl: 1,
          comment: 'Shop',
          tags: ['team:web'],
        },
      ],
    });
    expect(changed).toMatchObject({
      type: 'A',
      name: 'www',
      data: '185.101.20.11',
      proxied: true,
      comment: 'Shop',
    });
    expect(changed!.id).not.toBe(WWW_ID);
    expect(changed!.id).toMatch(/^[0-9a-f]{32}$/);
    expect(mock.records.get(ZONE_ID)!.some((r) => r.id === WWW_ID)).toBe(false);
    expect(server.requests.filter((r) => r.method === 'PATCH')).toHaveLength(0);
  });

  it('refuses to change read-only records', async () => {
    const err = await caught(adapter().updateDnsRecord(ZONE_ID, HTTPS_ID, { ttl: 300 }));
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('HTTPS records cannot be changed in the panel, only deleted');
    expect(server.requests.filter((r) => r.method !== 'GET')).toHaveLength(0);
    await adapter().deleteDnsRecord(ZONE_ID, HTTPS_ID);
    expect(sent('DELETE', `/zones/${ZONE_ID}/dns_records/${HTTPS_ID}`)).toHaveLength(1);
  });

  it('refuses invalid ids without a request', async () => {
    const cf = adapter(ACCOUNT);
    for (const call of [
      () => cf.getDomain('../user/tokens'),
      () => cf.listDnsRecords('023E105F'),
      () => cf.getCdnSettings(`${ZONE_ID}/x`),
      () => cf.purgeCache(''),
      () => cf.checkZoneActivation('zone'),
      () => cf.addDnsRecord('nope', { type: 'A', name: '@', data: '203.0.113.1' }),
    ]) {
      const err = await caught(call());
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.statusCode).toBe(404);
    }
    for (const call of [
      () => cf.updateDnsRecord(ZONE_ID, '../../zones', { ttl: 300 }),
      () => cf.deleteDnsRecord(ZONE_ID, 'record-1'),
    ]) {
      const err = await caught(call());
      expect(err).not.toBeInstanceOf(ProviderError);
      expect(err.message).toBe('DNS record not found');
    }
    expect(server.requests).toHaveLength(0);
  });

  it('maps missing records to 404', async () => {
    const missing = hex(4711);
    const deleted = await caught(adapter().deleteDnsRecord(ZONE_ID, missing));
    expect(deleted).not.toBeInstanceOf(ProviderError);
    expect(deleted.statusCode).toBe(404);
    expect(deleted.message).toBe('DNS record not found');
    const updated = await caught(adapter().updateDnsRecord(ZONE_ID, missing, { ttl: 300 }));
    expect(updated.message).toBe('DNS record not found');
  });

  it('reads the CDN settings', async () => {
    mock.settingsOf(ZONE_ID).development_mode = { value: 'on', editable: true, time_remaining: 7200 };
    const cf = adapter();
    expect(await cf.getCdnSettings(ZONE_ID)).toEqual({
      sslMode: 'full',
      sslAutomatic: false,
      alwaysUseHttps: true,
      developmentMode: true,
      developmentModeRemaining: 7200,
      editable: { sslMode: true, alwaysUseHttps: true, developmentMode: true },
    });
    expect(server.requests.map((r) => r.path.split('/').pop()).sort()).toEqual([
      'always_use_https',
      'development_mode',
      'ssl',
      'ssl_automatic_mode',
    ]);
    await cf.getCdnSettings(ZONE_ID);
    expect(server.requests).toHaveLength(4);

    mock.override = (req) =>
      req.path.endsWith('/ssl_automatic_mode')
        ? fail(403, [{ code: 9109, message: 'Unauthorized' }])
        : undefined;
    expect((await adapter().getCdnSettings(ZONE_ID)).sslAutomatic).toBeNull();

    mock.override = (req) =>
      req.path.endsWith('/ssl_automatic_mode')
        ? fail(500, [{ code: 1000, message: 'Internal error' }])
        : undefined;
    await expect(adapter().getCdnSettings(ZONE_ID)).rejects.toThrow(/Internal error/);
  });

  it('changes CDN settings one at a time', async () => {
    const cf = adapter();
    const patches = () =>
      server.requests.filter((r) => r.method === 'PATCH').map((r) => [r.path.split('/').pop(), r.body]);

    expect(await cf.updateCdnSetting(ZONE_ID, { sslMode: 'strict' })).toMatchObject({ sslMode: 'strict' });
    expect(await cf.updateCdnSetting(ZONE_ID, { alwaysUseHttps: false })).toMatchObject({
      alwaysUseHttps: false,
    });
    expect(await cf.updateCdnSetting(ZONE_ID, { developmentMode: true })).toMatchObject({
      developmentMode: true,
      developmentModeRemaining: 10_800,
    });
    expect(await cf.updateCdnSetting(ZONE_ID, { sslMode: 'auto' })).toMatchObject({ sslAutomatic: true });
    // A concrete mode while Automatic SSL/TLS is on: custom first.
    expect(await cf.updateCdnSetting(ZONE_ID, { sslMode: 'flexible' })).toMatchObject({
      sslMode: 'flexible',
      sslAutomatic: false,
    });
    expect(patches()).toEqual([
      ['ssl', { value: 'strict' }],
      ['always_use_https', { value: 'off' }],
      ['development_mode', { value: 'on' }],
      ['ssl_automatic_mode', { value: 'auto' }],
      ['ssl_automatic_mode', { value: 'custom' }],
      ['ssl', { value: 'flexible' }],
    ]);

    const two = await caught(
      cf.updateCdnSetting(ZONE_ID, { sslMode: 'full', alwaysUseHttps: true } as never),
    );
    expect(two.statusCode).toBe(400);
    const unknown = await caught(cf.updateCdnSetting(ZONE_ID, { sslMode: 'origin_pull' } as never));
    expect(unknown.statusCode).toBe(400);
    expect(patches()).toHaveLength(6);
  });

  it('says what happened when the second SSL write fails', async () => {
    mock.settingsOf(ZONE_ID).ssl_automatic_mode!.value = 'auto';
    mock.override = (req) =>
      req.method === 'PATCH' && req.path.endsWith('/settings/ssl')
        ? fail(400, [{ code: 1007, message: 'Invalid value for zone setting ssl' }])
        : undefined;
    const err = await caught(adapter().updateCdnSetting(ZONE_ID, { sslMode: 'strict' }));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toMatch(
      /^Cloudflare: change the setting ssl of zone .* failed: Invalid value for zone setting ssl \(1007\) \(HTTP 400\)\. Automatic SSL\/TLS is off now, the SSL\/TLS mode stayed full$/,
    );
    expect(mock.settingsOf(ZONE_ID).ssl_automatic_mode!.value).toBe('custom');
  });

  it('refuses settings the zone does not let change, before sending', async () => {
    mock.settingsOf(ZONE_ID).always_use_https!.editable = false;
    const cf = adapter();
    const err = await caught(cf.updateCdnSetting(ZONE_ID, { alwaysUseHttps: false }));
    expect(err.statusCode).toBe(422);
    expect(err.message).toBe(
      'Always Use HTTPS cannot be changed for this zone (Cloudflare plan or zone settings)',
    );
    expect(server.requests.filter((r) => r.method === 'PATCH')).toHaveLength(0);
  });

  it('purges the whole cache', async () => {
    expect(await adapter().purgeCache(ZONE_ID)).toEqual({
      providerRef: '9a7806061c88ada191ed06f989cc3dac',
      message: 'Purge accepted',
    });
    expect(sent('POST', `/zones/${ZONE_ID}/purge_cache`)[0]!.body).toEqual({ purge_everything: true });

    mock.override = (req) =>
      req.path.endsWith('/purge_cache')
        ? {
            status: 200,
            body: {
              success: false,
              errors: [{ code: 1016, message: 'Some items could not be purged' }],
              messages: [],
              result: null,
            },
          }
        : undefined;
    const err = await caught(adapter().purgeCache(ZONE_ID));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toContain('Some items could not be purged (1016) (HTTP 200)');
  });

  it('creates zones without jump_start, or reuses the existing one', async () => {
    const cf = adapter(ACCOUNT);
    const created = await cf.createZone('Baeckerei-Huber.CH.');
    expect(created.created).toBe(true);
    expect(created.zone).toMatchObject({
      name: 'baeckerei-huber.ch',
      status: 'pending',
      info: { nameservers: ['lea.ns.cloudflare.com', 'tom.ns.cloudflare.com'], providerDns: false },
    });
    const post = sent('POST', '/zones')[0]!;
    expect(post.body).toEqual({ account: { id: ACCOUNT }, name: 'baeckerei-huber.ch', type: 'full' });
    expect(post.body).not.toHaveProperty('jump_start');

    server.requests.length = 0;
    const again = await cf.createZone('muster-shop.ch');
    expect(again.created).toBe(false);
    expect(again.zone.externalId).toBe(ZONE_ID);
    const lookup = sent('GET', '/zones')[0]!;
    expect(lookup.query.get('name')).toBe('muster-shop.ch');
    expect(lookup.query.get('account.id')).toBe(ACCOUNT);

    // Exists in another account: Cloudflare's refusal is the answer.
    mock.zones.push(
      zone({ id: hex(3, 'd'), name: 'fremd.ch', account: { id: OTHER_ACCOUNT, name: 'other' } }),
    );
    const elsewhere = await caught(cf.createZone('fremd.ch'));
    expect(elsewhere.message).toContain('fremd.ch already exists (1061)');
  });

  it('refuses zone creation without account id and invalid names', async () => {
    const none = await caught(adapter().createZone('beispiel.ch'));
    expect(none.statusCode).toBe(422);
    const cf = adapter(ACCOUNT);
    const idn = await caught(cf.createZone('bäckerei.ch'));
    expect(idn.statusCode).toBe(400);
    expect(idn.message).toContain('xn--');
    for (const name of ['localhost', 'a..b.ch', '-x.ch', 'x.ch/zones']) {
      expect((await caught(cf.createZone(name))).statusCode).toBe(400);
    }
    expect(server.requests).toHaveLength(0);
  });

  it('forwards explorer requests below the API base', async () => {
    const cf = adapter();
    const res = await cf.rawRequest('GET', `${baseUrl()}/zones?per_page=5`);
    expect(res.status).toBe(200);
    expect(server.requests.at(-1)!.path).toBe(`${BASE_PATH}/zones`);
    expect(server.requests.at(-1)!.query.get('per_page')).toBe('5');

    await cf.rawRequest('GET', `/client/v4/zones/${ZONE_ID}`);
    expect(server.requests.at(-1)!.path).toBe(`${BASE_PATH}/zones/${ZONE_ID}`);
    await cf.rawRequest('get', 'zones', {
      name: 'muster-shop.ch',
      status: ['active', 'pending'],
      match: { a: 1 },
    });
    const query = server.requests.at(-1)!.query;
    expect(query.get('name')).toBe('muster-shop.ch');
    expect(query.getAll('status')).toEqual(['active', 'pending']);
    expect(query.get('match')).toBe('{"a":1}');

    const patched = await cf.rawRequest('PATCH', `/zones/${ZONE_ID}/settings/ssl`, { value: 'strict' });
    expect(patched.status).toBe(200);
    expect(server.requests.at(-1)).toMatchObject({ method: 'PATCH', body: { value: 'strict' } });
    expect(mock.settingsOf(ZONE_ID).ssl!.value).toBe('strict');

    await cf.rawRequest('DELETE', `/zones/${ZONE_ID}/dns_records/${MAIL_ID}`, { reason: 'test' });
    expect(server.requests.at(-1)).toMatchObject({ method: 'DELETE', body: undefined });
    expect(server.requests.at(-1)!.query.get('reason')).toBe('test');

    // Failures come back as they are.
    const missing = await cf.rawRequest('GET', '/nowhere');
    expect(missing).toEqual({
      status: 404,
      data: {
        success: false,
        errors: [{ code: 7003, message: 'No route for the URI' }],
        messages: [],
        result: null,
      },
    });
  });

  it('refuses explorer paths outside the API and token changes', async () => {
    const cf = adapter(ACCOUNT);
    const refused = async (method: string, path: string, message: string) => {
      const err = await caught(cf.rawRequest(method, path));
      expect(err.statusCode).toBe(400);
      expect(err.message).toBe(message);
    };
    await refused('HEAD', '/zones', 'Unsupported method');
    for (const path of [
      '/../user',
      '/zones/%2e%2e/x',
      '//evil.example/x',
      'https://evil.example/client/v4/zones',
      '/zones\\x',
      '/x@evil.example',
      '/zones//x',
      '/user%2ftokens',
    ]) {
      await refused('GET', path, 'Invalid path');
    }
    await refused('POST', '/user/tokens', 'Manage API tokens in the Cloudflare dashboard');
    await refused(
      'PUT',
      '/user/tokens/ed17574386854bf78a67040be0a770b0/value',
      'Manage API tokens in the Cloudflare dashboard',
    );
    await refused(
      'DELETE',
      `/accounts/${ACCOUNT}/tokens/ed17574386854bf78a67040be0a770b0`,
      'Manage API tokens in the Cloudflare dashboard',
    );
    await refused('PATCH', '/client/v4/User/Tokens/x', 'Manage API tokens in the Cloudflare dashboard');
    expect(server.requests).toHaveLength(0);

    await cf.rawRequest('GET', '/user/tokens/verify');
    expect(server.requests).toHaveLength(1);
  });

  it('redacts secrets and the token in explorer answers', async () => {
    mock.override = (req) => {
      if (req.path.endsWith('/custom_certificates')) {
        return ok([
          {
            id: 'c1',
            certificate: '-----BEGIN CERTIFICATE-----',
            private_key: '-----BEGIN PRIVATE KEY-----',
          },
        ]);
      }
      if (req.path.endsWith('/user/tokens')) {
        return ok([{ id: 't1', name: 'panel', value: 'leaked-value', note: `echo ${TOKEN}` }]);
      }
      return undefined;
    };
    const certs = await adapter().rawRequest('GET', `/zones/${ZONE_ID}/custom_certificates`);
    expect(certs.data).toMatchObject({
      result: [{ certificate: '-----BEGIN CERTIFICATE-----', private_key: '[redacted]' }],
    });
    const tokens = await adapter().rawRequest('GET', '/user/tokens');
    expect(tokens.data).toMatchObject({ result: [{ value: '[redacted]', note: 'echo [redacted]' }] });
    expect(JSON.stringify(tokens.data)).not.toContain(TOKEN);
  });
});
