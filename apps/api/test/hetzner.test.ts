import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import { AppError, ProviderError } from '../src/lib/errors';
import { HetznerAdapter, taskPollInterval } from '../src/providers/hetzner/adapter';
import { HetznerClient, rateLimitWait } from '../src/providers/hetzner/client';
import {
  expandIpv6,
  inIpv6Network,
  mapStatus,
  metricPoints,
  metricStep,
  parseServer,
  priceMinor,
  redactSecrets,
  type HetznerServer,
} from '../src/providers/hetzner/parse';

// ---------------------------------------------------------------------------
// A JSON mock of the Hetzner Cloud API. Unlike mock-server.ts it records JSON bodies and
// can answer with headers (rate limit).

interface Recorded {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  body: unknown;
}

type Answer = { status?: number; body?: unknown; headers?: Record<string, string> } | undefined;

async function startHetznerMock(handler: (req: Recorded) => Answer) {
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
      const answer = handler(recorded) ?? {
        status: 404,
        body: { error: { code: 'not_found', message: `no route for ${recorded.method} ${recorded.path}` } },
      };
      res.statusCode = answer.status ?? 200;
      for (const [key, value] of Object.entries(answer.headers ?? {})) res.setHeader(key, value);
      if (answer.body === undefined) {
        res.end();
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(answer.body));
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

// ---------------------------------------------------------------------------
// Fixtures, shaped like real API answers (hcloud-go schema and docs samples).

const TOKEN = 'hc-test-token-0123456789abcdef';
const NOW = '2026-10-08T10:00:00+00:00';

const FSN1 = {
  id: 1,
  name: 'fsn1',
  description: 'Falkenstein DC Park 1',
  country: 'DE',
  city: 'Falkenstein',
  latitude: 50.47612,
  longitude: 12.370071,
  network_zone: 'eu-central',
};
const NBG1 = {
  id: 2,
  name: 'nbg1',
  description: 'Nuremberg DC Park 1',
  country: 'DE',
  city: 'Nuremberg',
  latitude: 49.452102,
  longitude: 11.076665,
  network_zone: 'eu-central',
};
const HEL1 = {
  id: 3,
  name: 'hel1',
  description: 'Helsinki DC Park 1',
  country: 'FI',
  city: 'Helsinki',
  latitude: 60.169855,
  longitude: 24.938379,
  network_zone: 'eu-central',
};
const ASH = {
  id: 4,
  name: 'ash',
  description: 'Ashburn, VA',
  country: 'US',
  city: 'Ashburn, VA',
  latitude: 39.045821,
  longitude: -77.487073,
  network_zone: 'us-east',
};

const price = (location: string, gross: string, net = gross) => ({
  location,
  price_hourly: { net: '0.0060000000', gross: '0.0071400000000000' },
  price_monthly: { net, gross },
  included_traffic: 21990232555520,
  price_per_tb_traffic: { net: '1.0000000000', gross: '1.1900000000000000' },
});
const at = (name: string, extra: Record<string, unknown> = {}) => ({
  id: { fsn1: 1, nbg1: 2, hel1: 3, ash: 4 }[name],
  name,
  available: true,
  recommended: false,
  deprecation: null,
  ...extra,
});

const SERVER_TYPES = [
  {
    id: 104,
    name: 'cx22',
    description: 'CX22',
    category: 'cost_optimized',
    cores: 2,
    memory: 4.0,
    disk: 40,
    storage_type: 'local',
    cpu_type: 'shared',
    architecture: 'x86',
    deprecated: false,
    deprecation: null,
    included_traffic: 0,
    prices: [
      price('fsn1', '4.5815000000000000', '3.8500000000'),
      price('nbg1', '4.5815000000000000'),
      price('hel1', '4.5815000000000000'),
      price('ash', '5.9381000000000000'),
    ],
    locations: [at('fsn1'), at('nbg1'), at('hel1'), at('ash')],
  },
  {
    id: 105,
    name: 'cx32',
    description: 'CX32',
    cores: 4,
    memory: 8.0,
    disk: 80,
    cpu_type: 'shared',
    architecture: 'x86',
    deprecation: null,
    prices: [price('fsn1', '8.0920000000000000'), price('nbg1', '8.0920000000000000')],
    locations: [at('fsn1'), at('nbg1')],
  },
  {
    id: 1,
    name: 'cx11',
    description: 'CX11',
    cores: 1,
    memory: 2.0,
    disk: 20,
    cpu_type: 'shared',
    architecture: 'x86',
    deprecated: true,
    deprecation: { announced: '2024-06-06T08:00:00+00:00', unavailable_after: '2024-09-06T08:00:00+00:00' },
    prices: [price('fsn1', '4.5100000000000000')],
    locations: [at('fsn1')],
  },
  {
    id: 45,
    name: 'cax11',
    description: 'CAX11',
    cores: 2,
    memory: 4.0,
    disk: 40,
    cpu_type: 'shared',
    architecture: 'arm',
    deprecation: null,
    prices: [price('fsn1', '4.5815000000000000'), price('hel1', '4.6100000000000000')],
    locations: [at('fsn1'), at('hel1')],
  },
  {
    id: 93,
    name: 'cax21',
    description: 'CAX21',
    cores: 4,
    memory: 8.0,
    disk: 80,
    cpu_type: 'shared',
    architecture: 'arm',
    deprecation: null,
    prices: [price('fsn1', '7.7350000000000000'), price('hel1', '7.8500000000000000')],
    locations: [at('fsn1'), at('hel1')],
  },
  {
    id: 96,
    name: 'ccx13',
    description: 'CCX13',
    cores: 2,
    memory: 8.0,
    disk: 80,
    cpu_type: 'dedicated',
    architecture: 'x86',
    deprecation: null,
    prices: [price('fsn1', '14.2681000000000000'), price('hel1', '14.2681000000000000')],
    // Sold out in Helsinki.
    locations: [at('fsn1'), at('hel1', { available: false })],
  },
  // Since 2025-09 deprecations come per location, the type wide flag stays empty.
  {
    id: 22,
    name: 'cpx11',
    description: 'CPX11',
    cores: 2,
    memory: 2.0,
    disk: 40,
    cpu_type: 'shared',
    architecture: 'x86',
    deprecated: false,
    deprecation: null,
    prices: [price('fsn1', '5.1800000000000000'), price('nbg1', '5.1800000000000000')],
    locations: [
      at('fsn1', {
        deprecation: {
          announced: '2025-10-01T00:00:00+00:00',
          unavailable_after: '2026-01-01T00:00:00+00:00',
        },
      }),
      at('nbg1', {
        deprecation: {
          announced: '2025-10-01T00:00:00+00:00',
          unavailable_after: '2026-01-01T00:00:00+00:00',
        },
      }),
    ],
  },
  {
    id: 23,
    name: 'cpx21',
    description: 'CPX21',
    cores: 3,
    memory: 4.0,
    disk: 80,
    cpu_type: 'shared',
    architecture: 'x86',
    deprecated: false,
    deprecation: null,
    // Cheaper in Falkenstein, where it is no longer sold: the "from" price ignores that.
    prices: [price('fsn1', '7.0000000000000000'), price('nbg1', '9.9960000000000000')],
    locations: [
      at('fsn1', {
        deprecation: {
          announced: '2025-10-01T00:00:00+00:00',
          unavailable_after: '2026-01-01T00:00:00+00:00',
        },
      }),
      at('nbg1'),
    ],
  },
];
const typeByName = (name: string) => SERVER_TYPES.find((t) => t.name === name)!;

function image(id: number, extra: Record<string, unknown>) {
  return {
    id,
    type: 'system',
    status: 'available',
    name: null,
    description: '',
    image_size: null,
    disk_size: 5,
    created: '2024-04-25T15:33:43+00:00',
    created_from: null,
    bound_to: null,
    os_flavor: 'ubuntu',
    os_version: '24.04',
    architecture: 'x86',
    rapid_deploy: true,
    protection: { delete: false },
    deprecated: null,
    deprecation: null,
    labels: {},
    ...extra,
  };
}

const IMAGES = [
  image(101, { name: 'ubuntu-24.04', description: 'Ubuntu 24.04' }),
  image(102, { name: 'ubuntu-24.04', description: 'Ubuntu 24.04', architecture: 'arm' }),
  image(103, { name: 'debian-12', description: 'Debian 12', os_flavor: 'debian', os_version: '12' }),
  image(104, { type: 'app', name: 'docker-ce', description: 'Docker CE', os_version: '24.04' }),
  image(105, {
    name: 'centos-7',
    description: 'CentOS 7',
    os_flavor: 'centos',
    deprecated: '2024-06-30T00:00:00+00:00',
    deprecation: { announced: '2024-01-01T00:00:00+00:00', unavailable_after: '2024-06-30T00:00:00+00:00' },
  }),
  // Snapshots: two of server 42, one of another customer's server.
  image(201, {
    type: 'snapshot',
    description: 'before-update',
    image_size: 2.25,
    created: '2026-09-01T08:00:00+00:00',
    created_from: { id: 42, name: 'web-1' },
    rapid_deploy: false,
  }),
  image(202, {
    type: 'snapshot',
    description: 'other customer',
    created: '2026-09-15T08:00:00+00:00',
    created_from: { id: 99, name: 'foreign' },
  }),
  image(203, {
    type: 'snapshot',
    description: 'golden',
    created: '2026-10-01T08:00:00+00:00',
    created_from: { id: 42, name: 'web-1' },
    protection: { delete: true },
  }),
  // Backups: one of server 42, one of server 99. The mock ignores bound_to on purpose.
  image(301, {
    type: 'backup',
    description: 'web-1 2026-10-07',
    image_size: 1.5,
    created: '2026-10-07T22:30:00+00:00',
    created_from: { id: 42, name: 'web-1' },
    bound_to: 42,
  }),
  image(302, {
    type: 'backup',
    description: 'foreign backup',
    created: '2026-10-07T23:00:00+00:00',
    created_from: { id: 99, name: 'foreign' },
    bound_to: 99,
  }),
];

const ISOS = [
  {
    id: 1,
    name: 'WindowsServer2022English.iso',
    description: 'Windows Server 2022 English',
    type: 'public',
    architecture: 'x86',
    deprecation: null,
  },
  {
    id: 2,
    name: 'ubuntu-24.04-arm.iso',
    description: 'Ubuntu 24.04 (arm64)',
    type: 'public',
    architecture: 'arm',
    deprecation: null,
  },
  {
    id: 3,
    name: 'customer-recovery.iso',
    description: 'customer recovery',
    type: 'private',
    architecture: null,
    deprecation: null,
  },
  {
    id: 4,
    name: 'CentOS-7.iso',
    description: 'CentOS 7',
    type: 'public',
    architecture: 'x86',
    deprecation: { announced: '2024-01-01T00:00:00+00:00', unavailable_after: '2024-07-01T00:00:00+00:00' },
  },
  {
    id: 5,
    name: 'virtio-win-0.1.248.iso',
    description: 'virtio-win-0.1.248',
    type: 'public',
    architecture: null,
  },
];

/** A current server: location instead of the deprecated datacenter. */
const SERVER_WEB = {
  id: 42,
  name: 'web-1',
  status: 'running',
  created: '2025-03-01T12:00:00+00:00',
  public_net: {
    ipv4: { id: 9001, ip: '116.203.10.42', blocked: false, dns_ptr: 'web.example.com' },
    ipv6: {
      id: 9002,
      ip: '2a01:4f8:c012:abcd::/64',
      blocked: false,
      dns_ptr: [{ ip: '2a01:4f8:c012:abcd::1', dns_ptr: 'web6.example.com' }],
    },
    floating_ips: [],
    firewalls: [{ id: 23, status: 'applied' }],
  },
  private_net: [{ network: 4711, ip: '10.0.0.2', alias_ips: ['10.0.0.3'], mac_address: '86:00:00:2a:7d:e1' }],
  server_type: typeByName('cx22'),
  location: FSN1,
  image: IMAGES[0],
  iso: null,
  rescue_enabled: false,
  locked: false,
  backup_window: '22-02',
  outgoing_traffic: 123_456_789,
  ingoing_traffic: 987_654_321,
  included_traffic: 21_990_232_555_520,
  protection: { delete: false, rebuild: false },
  labels: { customer: 'acme' },
  volumes: [],
  load_balancers: [],
  primary_disk_size: 40,
  placement_group: null,
};

/** An older answer: no location field, only the datacenter. Arm, off, protected, no IPv4. */
const SERVER_DB = {
  ...SERVER_WEB,
  id: 43,
  name: 'db-1',
  status: 'off',
  public_net: {
    ipv4: null,
    ipv6: { id: 9003, ip: '2a01:4f9:c010:1234::/64', blocked: false, dns_ptr: [] },
    floating_ips: [],
    firewalls: [],
  },
  private_net: [],
  server_type: typeByName('cax11'),
  location: undefined,
  datacenter: { id: 3, name: 'hel1-dc2', description: 'Helsinki 1 virtual DC 2', location: HEL1 },
  // The image it was created from is gone.
  image: null,
  iso: ISOS[0],
  backup_window: null,
  protection: { delete: true, rebuild: true },
  labels: {},
  primary_disk_size: 40,
};

const SERVER_MAIL = { ...SERVER_WEB, id: 44, name: 'mail-1', locked: true, labels: {} };

const SERVERS: Record<string, unknown> = { '42': SERVER_WEB, '43': SERVER_DB, '44': SERVER_MAIL };

function action(id: number, command: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    command,
    status: 'running',
    progress: 0,
    started: NOW,
    finished: null,
    error: null,
    resources: [{ id: 42, type: 'server' }],
    ...extra,
  };
}

const ACTIONS: Record<string, unknown> = {
  '1001': action(1001, 'create_image', { progress: 40 }),
  '1002': action(1002, 'poweroff', { status: 'success', progress: 100, finished: NOW }),
  '1003': action(1003, 'rebuild_server', {
    status: 'error',
    progress: 100,
    finished: NOW,
    error: { code: 'action_failed', message: 'Action failed' },
  }),
  '1004': action(1004, 'poweron', { resources: [{ id: 99, type: 'server' }] }),
};

const page = (items: Record<string, unknown>, p: number, next: number | null, total: number) => ({
  ...items,
  meta: {
    pagination: {
      page: p,
      per_page: 50,
      previous_page: p > 1 ? p - 1 : null,
      next_page: next,
      last_page: 2,
      total_entries: total,
    },
  },
});
const list = (key: string, items: unknown[]) => ({
  body: {
    [key]: items,
    meta: {
      pagination: {
        page: 1,
        per_page: 50,
        previous_page: null,
        next_page: null,
        last_page: 1,
        total_entries: items.length,
      },
    },
  },
});

/** Mutable state of the simulated project. */
const state = {
  nextAction: 5000,
  /** Answer that many requests with 429 before serving them. */
  rateLimited: 0,
  rateLimitHeaders: {} as Record<string, string>,
};

let mock: Awaited<ReturnType<typeof startHetznerMock>>;
let adapter: HetznerAdapter;
let wsServer: WebSocketServer;
let wsPort = 0;
const wsConnections: { url: string; protocol: string; authorization?: string }[] = [];

const ref = (id: number, meta: Record<string, unknown> = {}) => ({
  externalId: String(id),
  kind: 'vm' as const,
  node: null,
  meta,
});
const web = ref(42, { serverType: 'cx22' });
const db = ref(43);

function started(command: string, extra: Record<string, unknown> = {}) {
  return { body: { action: action(state.nextAction++, command), ...extra } };
}

function route(req: Recorded): Answer {
  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    return { status: 401, body: { error: { code: 'unauthorized', message: 'unable to authenticate' } } };
  }
  if (state.rateLimited > 0) {
    state.rateLimited--;
    return {
      status: 429,
      headers: state.rateLimitHeaders,
      body: { error: { code: 'rate_limit_exceeded', message: 'Rate limit exceeded', details: {} } },
    };
  }
  const p = req.path.replace(/^\/v1/, '');
  const m = req.method;
  const q = req.query;

  if (p === '/servers' && m === 'GET') {
    if (q.get('per_page') === '1') return { body: page({ servers: [SERVER_WEB] }, 1, 2, 3) };
    if (q.get('page') === '2') return { body: page({ servers: [SERVER_MAIL] }, 2, null, 3) };
    return { body: page({ servers: [SERVER_WEB, SERVER_DB] }, 1, 2, 3) };
  }
  if (p === '/servers' && m === 'POST') {
    const body = req.body as Record<string, unknown>;
    return {
      status: 201,
      body: {
        server: { ...SERVER_WEB, id: 50, name: body.name, status: 'initializing' },
        action: action(4000, 'create_server', { resources: [{ id: 50, type: 'server' }] }),
        next_actions: [action(4001, 'start_server')],
        root_password: 'YItygq1v3GYjjMomLaKc',
      },
    };
  }
  const server = /^\/servers\/(\d+)$/.exec(p);
  if (server) {
    const found = SERVERS[server[1]!];
    if (!found) return { status: 404, body: { error: { code: 'not_found', message: 'server not found' } } };
    if (m === 'GET') return { body: { server: found } };
    if (m === 'PUT') return { body: { server: { ...(found as object), ...(req.body as object) } } };
    if (m === 'DELETE') return started('delete_server');
  }
  if (p === '/servers/42/metrics') {
    const t = 1_791_000_000;
    return {
      body: {
        metrics: {
          start: '2026-10-07T10:00:00Z',
          end: '2026-10-08T10:00:00Z',
          step: 173,
          time_series: {
            cpu: {
              values: [
                [t, '50'],
                [t + 173, '100.5'],
                [t + 346, 'NaN'],
              ],
            },
            'disk.0.iops.read': { values: [[t, '12']] },
            'disk.0.bandwidth.read': { values: [[t, '4096']] },
            'disk.0.bandwidth.write': { values: [[t + 173, '8192']] },
            'network.0.bandwidth.in': { values: [[t, '1000.5']] },
            'network.0.bandwidth.out': { values: [[t, '2000']] },
            'network.0.pps.in': { values: [[t, '10']] },
          },
        },
      },
    };
  }
  if (p === '/servers/42/actions' && m === 'GET') {
    return list('actions', [ACTIONS['1003'], ACTIONS['1002'], ACTIONS['1001']]);
  }
  const serverAction = /^\/servers\/(\d+)\/actions\/([a-z_]+)$/.exec(p);
  if (serverAction && m === 'POST') {
    const name = serverAction[2]!;
    if (name === 'reset_password') return started(name, { root_password: 'Root-Pass-1' });
    if (name === 'rebuild') return started('rebuild_server', { root_password: 'New-Root-2' });
    if (name === 'request_console') {
      return started(name, {
        wss_url: `ws://127.0.0.1:${wsPort}/?server_id=${serverAction[1]}&token=one-time-console-token`,
        password: 'vnc-pass-9',
      });
    }
    if (name === 'create_image') {
      return started(name, { image: image(204, { type: (req.body as { type: string }).type }) });
    }
    return started(name);
  }

  const actionMatch = /^\/actions\/(\d+)$/.exec(p);
  if (actionMatch) {
    const found = ACTIONS[actionMatch[1]!];
    return found
      ? { body: { action: found } }
      : { status: 404, body: { error: { code: 'not_found', message: 'action not found' } } };
  }

  if (p === '/server_types') return list('server_types', SERVER_TYPES);
  if (p === '/locations') return list('locations', [FSN1, NBG1, HEL1, ASH]);
  if (p === '/pricing') return { body: { pricing: { currency: 'EUR', vat_rate: '19.00' } } };
  if (p === '/isos') {
    // Hetzner filters by architecture and leaves out ISOs without one unless asked.
    const arch = q.get('architecture');
    const wildcard = q.get('include_architecture_wildcard') === 'true';
    return list(
      'isos',
      ISOS.filter((i) => !arch || i.architecture === arch || (wildcard && i.architecture === null)),
    );
  }
  if (p === '/images' && m === 'GET') {
    const types = q.getAll('type');
    const arch = q.get('architecture');
    const name = q.get('name');
    // bound_to is ignored on purpose: the adapter must not rely on the filter alone.
    return list(
      'images',
      IMAGES.filter(
        (i) =>
          (types.length === 0 || types.includes(i.type as string)) &&
          (!arch || i.architecture === arch) &&
          (!name || i.name === name) &&
          // Hetzner leaves out deprecated images unless include_deprecated is set.
          !i.deprecation,
      ),
    );
  }
  const img = /^\/images\/(\d+)$/.exec(p);
  if (img) {
    const found = IMAGES.find((i) => String(i.id) === img[1]);
    if (!found) return { status: 404, body: { error: { code: 'not_found', message: 'image not found' } } };
    if (m === 'GET') return { body: { image: found } };
    if (m === 'DELETE') return { status: 204 };
  }
  if (p === '/echo') {
    return {
      status: 422,
      body: {
        error: {
          code: 'invalid_input',
          message: `invalid input, token ${TOKEN} looks odd`,
          details: { fields: [{ name: 'name', messages: ['is required', 'must be a hostname'] }] },
        },
      },
    };
  }
  if (p === '/html') return { status: 502, body: '<html>Bad Gateway</html>' };
  return undefined;
}

const last = (pred: (r: Recorded) => boolean) => mock.requests.findLast(pred);
const posted = (path: string) => last((r) => r.method === 'POST' && r.path === `/v1${path}`);
const countSince = (before: number, pred: (r: Recorded) => boolean) =>
  mock.requests.slice(before).filter(pred).length;

beforeAll(async () => {
  mock = await startHetznerMock(route);
  adapter = new HetznerAdapter({ apiToken: TOKEN, baseUrl: `${mock.url}/v1/` });
  wsServer = new WebSocketServer({ port: 0, host: '127.0.0.1', handleProtocols: (p) => [...p][0] ?? false });
  await new Promise<void>((resolve) => wsServer.once('listening', () => resolve()));
  wsPort = (wsServer.address() as AddressInfo).port;
  wsServer.on('connection', (socket, req) => {
    wsConnections.push({
      url: req.url ?? '',
      protocol: socket.protocol,
      authorization: req.headers.authorization,
    });
  });
});

afterAll(async () => {
  for (const client of wsServer.clients) client.terminate();
  await new Promise<void>((resolve) => wsServer.close(() => resolve()));
  await mock.close();
});

beforeEach(() => {
  state.rateLimited = 0;
  state.rateLimitHeaders = {};
});

// ---------------------------------------------------------------------------

describe('Hetzner client', () => {
  it('sends the bearer token and JSON', async () => {
    await adapter.power(web, 'reboot');
    const req = posted('/servers/42/actions/reboot')!;
    expect(req.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(req.headers.accept).toBe('application/json');
    await adapter.setRdns(web, '116.203.10.42', 'www.example.com');
    const rdns = posted('/servers/42/actions/change_dns_ptr')!;
    expect(rdns.headers['content-type']).toBe('application/json');
    expect(rdns.body).toEqual({ ip: '116.203.10.42', dns_ptr: 'www.example.com' });
  });

  it('collects every page of a list', async () => {
    const servers = await adapter.listServers();
    expect(servers.map((s) => s.externalId)).toEqual(['42', '43', '44']);
    const pages = mock.requests.filter((r) => r.path === '/v1/servers' && r.query.get('per_page') === '50');
    expect(pages.slice(-2).map((r) => r.query.get('page'))).toEqual(['1', '2']);
  });

  it('maps API errors with code and fields, never with the token', async () => {
    const client = new HetznerClient({ apiToken: TOKEN, baseUrl: `${mock.url}/v1` });
    const err = await client.get('/echo').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    const message = (err as ProviderError).message;
    expect(message).toMatch(/^Hetzner: invalid_input: invalid input/);
    expect(message).toContain('(name: is required, must be a hostname)');
    expect(message).not.toContain(TOKEN);
    expect((err as ProviderError).upstreamStatus).toBe(422);

    await expect(client.get('/html')).rejects.toThrow(/^Hetzner: http_502: HTTP 502$/);
    await expect(client.get('/servers/777')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('explains a rejected token without echoing it', async () => {
    const bad = new HetznerAdapter({ apiToken: 'wrong-token-abc', baseUrl: `${mock.url}/v1` });
    const err = (await bad.testConnection().catch((e: unknown) => e)) as Error;
    expect(err.message).toBe(
      'Hetzner: unauthorized: unable to authenticate. Check the API token (HETZNER_API_TOKEN)',
    );
  });

  it('reports network failures without the token', async () => {
    const closed = await startHetznerMock(() => undefined);
    await closed.close();
    const client = new HetznerClient({ apiToken: TOKEN, baseUrl: closed.url });
    const err = (await client.get('/servers').catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/^Hetzner: request failed: /);
    expect(err.message).not.toContain(TOKEN);
  });

  it('retries once on 429 when the next request is free within seconds', async () => {
    state.rateLimited = 1;
    // 36000/h refills one request every 100 ms, even though the bucket is full only in an hour.
    state.rateLimitHeaders = {
      'RateLimit-Limit': '36000',
      'RateLimit-Remaining': '0',
      'RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600),
    };
    const before = mock.requests.length;
    expect((await adapter.getServer(web)).externalId).toBe('42');
    expect(countSince(before, (r) => r.path === '/v1/servers/42')).toBe(2);
  });

  it('fails with a clear message when the rate limit is far away, without retrying', async () => {
    state.rateLimited = 5;
    const reset = Math.floor(Date.now() / 1000) + 3600;
    state.rateLimitHeaders = {
      'RateLimit-Limit': '60',
      'RateLimit-Remaining': '0',
      'RateLimit-Reset': String(reset),
    };
    const before = mock.requests.length;
    const err = (await adapter.getServer(web).catch((e: unknown) => e)) as ProviderError;
    expect(err.message).toContain('rate_limit_exceeded: Rate limit exceeded');
    expect(err.message).toContain('Hetzner allows 60 API requests per hour per project');
    expect(err.message).toContain(new Date(reset * 1000).toISOString());
    expect(err.upstreamStatus).toBe(429);
    expect(countSince(before, () => true)).toBe(1);
  });

  it('computes the wait for the next free request', () => {
    const now = 1_000_000_000_000;
    const res = (limit: number | null, reset: number | null) => ({
      status: 429,
      body: null,
      rateLimit: { limit, remaining: 0, reset },
    });
    expect(rateLimitWait(res(3600, now / 1000 + 3600), now)).toBe(1000);
    expect(rateLimitWait(res(null, now / 1000 + 2), now)).toBe(2000);
    expect(rateLimitWait(res(3600, now / 1000 - 5), now)).toBe(0);
    expect(rateLimitWait(res(null, null), now)).toBeNull();
  });
});

describe('Hetzner inventory', () => {
  it('tests the connection with cheap calls', async () => {
    const before = mock.requests.length;
    expect(await adapter.testConnection()).toEqual({ servers: 3, locations: 'fsn1, nbg1, hel1, ash' });
    const reqs = mock.requests.slice(before);
    expect(reqs.map((r) => r.path)).toEqual(['/v1/servers', '/v1/locations']);
    expect(reqs[0]!.query.get('per_page')).toBe('1');
  });

  it('parses servers with location, IPs, OS and safe meta', async () => {
    const [webServer, dbServer, mail] = await adapter.listServers();
    expect(webServer).toEqual({
      externalId: '42',
      name: 'web-1',
      kind: 'vm',
      status: 'running',
      specs: { cores: 2, memoryMb: 4096, diskGb: 40 },
      usage: null,
      ips: [
        { address: '116.203.10.42', version: 4, gateway: '172.31.1.1', rdns: 'web.example.com' },
        { address: '2a01:4f8:c012:abcd::1', version: 6, gateway: 'fe80::1', rdns: 'web6.example.com' },
        { address: '10.0.0.2', version: 4, mac: '86:00:00:2a:7d:e1' },
        { address: '10.0.0.3', version: 4, mac: '86:00:00:2a:7d:e1' },
      ],
      os: 'Ubuntu 24.04',
      node: 'fsn1',
      meta: {
        datacenter: { name: 'Falkenstein DC Park 1', city: 'Falkenstein', country: 'DE' },
        location: 'fsn1',
        serverType: 'cx22',
        architecture: 'x86',
        protection: { delete: false, rebuild: false },
        backupWindow: '22-02',
        rescueEnabled: false,
        locked: false,
        iso: null,
        labels: { customer: 'acme' },
        created: '2025-03-01T12:00:00+00:00',
      },
    });
    // Older answers only have the datacenter. No IPv4, image deleted.
    expect(dbServer).toMatchObject({
      status: 'stopped',
      os: null,
      node: 'hel1-dc2',
      specs: { cores: 2, memoryMb: 4096, diskGb: 40 },
      meta: {
        datacenter: { name: 'hel1-dc2', city: 'Helsinki', country: 'FI' },
        architecture: 'arm',
        backupWindow: null,
        protection: { delete: true, rebuild: true },
        iso: 'Windows Server 2022 English',
      },
    });
    expect(dbServer!.ips.map((i) => i.address)).toEqual(['2a01:4f9:c010:1234::1']);
    expect(mail!.status).toBe('locked');
    expect(JSON.stringify([webServer, dbServer, mail])).not.toMatch(/password/i);
  });

  it('reads a single server and maps 404', async () => {
    expect((await adapter.getServer(db)).name).toBe('db-1');
    await expect(adapter.getServer(ref(777))).rejects.toMatchObject({ statusCode: 404 });
    await expect(adapter.getServer({ ...web, externalId: 'qemu/100' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('renames at Hetzner only with a valid hostname', async () => {
    expect(await adapter.rename(web, 'web-2')).toEqual({ message: 'Renamed' });
    expect(last((r) => r.method === 'PUT')!.body).toEqual({ name: 'web-2' });
    expect((await adapter.rename(web, 'Mein Server')).message).toMatch(/kept locally/);
  });

  it('summarizes the project', async () => {
    const overview = await adapter.overview();
    expect(overview).toMatchObject({ nodes: [], storages: [] });
    expect(overview.facts).toEqual([
      { label: 'Servers', value: '3' },
      { label: 'Locations', value: 'fsn1, nbg1, hel1, ash' },
      { label: 'Server types', value: '6' },
    ]);
  });
});

describe('Hetzner power, metrics, tasks', () => {
  it('maps power actions to Hetzner server actions', async () => {
    expect(adapter.powerActions()).toEqual(['start', 'shutdown', 'stop', 'reboot', 'reset']);
    const expected = {
      start: 'poweron',
      shutdown: 'shutdown',
      stop: 'poweroff',
      reboot: 'reboot',
      reset: 'reset',
    };
    for (const [panel, hetzner] of Object.entries(expected)) {
      const result = await adapter.power(web, panel as 'start');
      expect(posted(`/servers/42/actions/${hetzner}`)).toBeDefined();
      expect(result.providerRef).toMatch(/^\d+$/);
    }
    const err = await adapter.power(web, 'suspend').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(422);
  });

  it('converts metrics to bytes per second and CPU share of all vCPUs', async () => {
    const metrics = await adapter.getMetrics(web, 'day');
    const req = last((r) => r.path === '/v1/servers/42/metrics')!;
    expect(req.query.getAll('type')).toEqual(['cpu', 'disk', 'network']);
    expect(req.query.get('step')).toBe('173');
    expect(req.query.get('start')).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    const t = 1_791_000_000;
    expect(metrics.resolutionSeconds).toBe(173);
    expect(metrics.points).toEqual([
      { t, cpu: 25, diskRead: 4096, netIn: 1000.5, netOut: 2000 },
      { t: t + 173, cpu: 50.25, diskWrite: 8192 },
      { t: t + 346, cpu: null },
    ]);
    expect(metrics.series.map((s) => s.key)).toEqual(['cpu', 'netIn', 'netOut', 'diskRead', 'diskWrite']);
    // Ranges stay at about 500 points.
    expect(metricStep('hour')).toBe(30);
    expect(Math.ceil((365 * 86_400) / metricStep('year'))).toBeLessThanOrEqual(500);
  });

  it('reports traffic of the billing period', async () => {
    expect(await adapter.getTraffic(web)).toEqual({
      inBytes: 987_654_321,
      outBytes: 123_456_789,
      limitBytes: 21_990_232_555_520,
      periodStart: null,
      periodEnd: null,
    });
  });

  it('lists server actions newest first and tracks single actions', async () => {
    const tasks = await adapter.listTasks(web);
    const req = last((r) => r.path === '/v1/servers/42/actions')!;
    expect(req.query.get('sort')).toBe('id:desc');
    expect(tasks.map((t) => [t.id, t.type, t.status, t.message])).toEqual([
      ['1003', 'rebuild_server', 'error', 'Action failed'],
      ['1002', 'poweroff', 'ok', null],
      ['1001', 'create_image', 'running', null],
    ]);
    expect(await adapter.getTaskStatus(web, '1001')).toMatchObject({ status: 'running', endedAt: null });
    expect(await adapter.getTaskStatus(web, '1002')).toMatchObject({ status: 'ok', endedAt: NOW });
    expect(await adapter.getTaskStatus(web, '1003')).toMatchObject({
      status: 'error',
      message: 'Action failed',
    });
    // An action of another server, or a reference that is no Hetzner action id.
    expect(await adapter.getTaskStatus(web, '1004')).toBeNull();
    expect(await adapter.getTaskStatus(web, 'UPID:pve:1')).toBeNull();
  });

  it('polls long running actions less often', async () => {
    const fresh = new HetznerAdapter({ apiToken: TOKEN, baseUrl: `${mock.url}/v1` });
    const polls = (before: number) => countSince(before, (r) => r.path === '/v1/actions/1001');
    // Only Date is faked, the mock API still answers over real sockets.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const t0 = Date.parse('2026-10-08T10:00:00Z');
      vi.setSystemTime(t0);
      let before = mock.requests.length;
      await fresh.getTaskStatus(web, '1001');
      vi.setSystemTime(t0 + 5_000);
      await fresh.getTaskStatus(web, '1001');
      // Fresh actions are asked for every time.
      expect(polls(before)).toBe(2);

      vi.setSystemTime(t0 + 70_000);
      before = mock.requests.length;
      expect(await fresh.getTaskStatus(web, '1001')).toMatchObject({ status: 'running' });
      vi.setSystemTime(t0 + 75_000);
      expect(await fresh.getTaskStatus(web, '1001')).toMatchObject({ status: 'running' });
      expect(polls(before)).toBe(1);
      vi.setSystemTime(t0 + 86_000);
      await fresh.getTaskStatus(web, '1001');
      expect(polls(before)).toBe(2);
      // The cache is per server: another server's view asks Hetzner again.
      await expect(fresh.getTaskStatus(ref(44), '1001')).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
    expect(taskPollInterval(30_000)).toBe(0);
    expect(taskPollInterval(5 * 60_000)).toBe(15_000);
    expect(taskPollInterval(30 * 60_000)).toBe(60_000);
  });

  it('opens the VNC console over the request_console websocket', async () => {
    const session = await adapter.openConsole(web);
    expect(posted('/servers/42/actions/request_console')).toBeDefined();
    if (session.type !== 'vnc') throw new Error('expected a VNC session');
    expect(session.password).toBe('vnc-pass-9');
    const ws = await session.connect();
    expect(ws.protocol).toBe('binary');
    ws.close();
    const seen = wsConnections.at(-1)!;
    expect(seen.url).toBe('/?server_id=42&token=one-time-console-token');
    expect(seen.protocol).toBe('binary');
    // The API token stays with the API.
    expect(seen.authorization).toBeUndefined();
  });

  it('reports a rejected console websocket without its one-time URL', async () => {
    const client = new HetznerClient({ apiToken: TOKEN, baseUrl: `${mock.url}/v1` });
    const url = `${mock.url.replace('http', 'ws')}/console?token=secret-console-token`;
    const err = (await client.openConsoleSocket(url).catch((e: unknown) => e)) as Error;
    // The mock API wants the bearer token, which the console socket never sends: 401.
    expect(err.message).toMatch(/console websocket rejected: HTTP 401/);
    expect(err.message).not.toContain('secret-console-token');
    await expect(client.openConsoleSocket('https://example.com/x')).rejects.toThrow(/no websocket URL/);
  });
});

describe('Hetzner snapshots and backups', () => {
  it('lists only snapshots created from this server', async () => {
    const snaps = await adapter.listSnapshots(web);
    expect(snaps.map((s) => s.id)).toEqual(['203', '201']);
    expect(snaps[1]).toEqual({
      id: '201',
      description: 'before-update',
      createdAt: '2026-09-01T08:00:00+00:00',
      includesRam: false,
      parent: null,
    });
    expect(last((r) => r.path === '/v1/images')!.query.get('type')).toBe('snapshot');
  });

  it('refuses foreign or unknown snapshots with 404 and touches nothing', async () => {
    const before = mock.requests.length;
    for (const id of ['202', '9999', '301', 'abc']) {
      const err = (await adapter.rollbackSnapshot(web, id).catch((e: unknown) => e)) as AppError;
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe('Hetzner: snapshot not found for this server');
      await expect(adapter.deleteSnapshot(web, id)).rejects.toMatchObject({ statusCode: 404 });
    }
    expect(countSince(before, (r) => r.method !== 'GET')).toBe(0);
  });

  it('creates, rolls back and deletes own snapshots', async () => {
    const created = await adapter.createSnapshot(web, { name: 'pre-update', description: 'before kernel' });
    expect(created.providerRef).toMatch(/^\d+$/);
    expect(posted('/servers/42/actions/create_image')!.body).toEqual({
      type: 'snapshot',
      description: 'pre-update: before kernel',
    });

    const rollback = await adapter.rollbackSnapshot(web, '201');
    expect(rollback.message).toMatch(/rebuild/);
    expect(posted('/servers/42/actions/rebuild')!.body).toEqual({ image: 201 });

    await expect(adapter.deleteSnapshot(web, '203')).rejects.toThrow(/protected/);
    expect(await adapter.deleteSnapshot(web, '201')).toEqual({ message: 'Snapshot deleted' });
    expect(last((r) => r.method === 'DELETE')!.path).toBe('/v1/images/201');
  });

  it('lists only backups bound to this server', async () => {
    const backups = await adapter.listBackups(web);
    const req = last((r) => r.path === '/v1/images')!;
    expect(req.query.get('type')).toBe('backup');
    expect(req.query.get('bound_to')).toBe('42');
    expect(backups).toEqual([
      {
        id: '301',
        createdAt: '2026-10-07T22:30:00+00:00',
        sizeBytes: Math.round(1.5 * 1024 ** 3),
        description: 'web-1 2026-10-07',
        status: 'finished',
        storage: null,
        os: 'Ubuntu 24.04',
        protected: false,
      },
    ]);
  });

  it('creates backups only when they are enabled at Hetzner', async () => {
    const err = (await adapter.createBackup(db, {}).catch((e: unknown) => e)) as AppError;
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe('Backups are not enabled for this server at Hetzner');
    expect(posted('/servers/43/actions/create_image')).toBeUndefined();

    await adapter.createBackup(web, { description: 'vor Update' });
    expect(posted('/servers/42/actions/create_image')!.body).toEqual({
      type: 'backup',
      description: 'vor Update',
    });
  });

  it('restores and deletes own backups only', async () => {
    const before = mock.requests.length;
    await expect(adapter.restoreBackup(web, '302')).rejects.toMatchObject({ statusCode: 404 });
    await expect(adapter.deleteBackup(web, '201')).rejects.toMatchObject({ statusCode: 404 });
    expect(countSince(before, (r) => r.method !== 'GET')).toBe(0);

    await adapter.restoreBackup(web, '301');
    expect(posted('/servers/42/actions/rebuild')!.body).toEqual({ image: 301 });
    await adapter.deleteBackup(web, '301');
    expect(last((r) => r.method === 'DELETE')!.path).toBe('/v1/images/301');
  });
});

describe('Hetzner plans and rescale', () => {
  it('lists plans with prices, without deprecated types', async () => {
    const plans = await adapter.listPlans();
    // cx11 is deprecated as a whole, cpx11 in every location.
    expect(plans.map((p) => p.id)).toEqual(['cx22', 'cax11', 'cax21', 'cx32', 'cpx21', 'ccx13']);
    expect(plans[0]).toEqual({
      id: 'cx22',
      label: 'CX22',
      cores: 2,
      memoryMb: 4096,
      diskGb: 40,
      architecture: 'x86',
      cpuType: 'shared',
      // The cheapest location as a "from" price.
      priceMonthly: { amount: 458, currency: 'EUR' },
      locations: ['fsn1', 'nbg1', 'hel1', 'ash'],
      deprecated: false,
    });
    expect(plans.find((p) => p.id === 'ccx13')).toMatchObject({ cpuType: 'dedicated', locations: ['fsn1'] });
    expect(plans.find((p) => p.id === 'cpx21')).toMatchObject({
      locations: ['nbg1'],
      priceMonthly: { amount: 1000, currency: 'EUR' },
      deprecated: false,
    });
  });

  it('lists what a server can change to, priced at its location', async () => {
    const forWeb = await adapter.listPlans(web);
    expect(forWeb.map((p) => [p.id, p.priceMonthly?.amount])).toEqual([
      ['cx22', 458],
      ['cx32', 809],
      ['ccx13', 1427],
    ]);
    // Arm in Helsinki: no x86, no CCX13 (sold out there).
    const forDb = await adapter.listPlans(db);
    expect(forDb.map((p) => [p.id, p.priceMonthly?.amount])).toEqual([
      ['cax11', 461],
      ['cax21', 785],
    ]);
  });

  it('lists locations', async () => {
    expect(await adapter.listLocations()).toContainEqual({
      id: 'hel1',
      label: 'Helsinki (hel1)',
      country: 'FI',
      city: 'Helsinki',
    });
  });

  it('refuses numbers only: Hetzner sells fixed server types', async () => {
    const before = mock.requests.length;
    const err = (await adapter
      .rescale(web, { cores: 4, memoryMb: 8192 })
      .catch((e: unknown) => e)) as AppError;
    expect(err.statusCode).toBe(400);
    expect(err.message).toMatch(/fixed server types/);
    expect(mock.requests.length).toBe(before);
  });

  it('needs the server powered off', async () => {
    const err = (await adapter.rescale(web, { plan: 'cx32' }).catch((e: unknown) => e)) as AppError;
    expect(err.statusCode).toBe(409);
    expect(err.message).toMatch(/powered off/);
    expect(posted('/servers/42/actions/change_type')).toBeUndefined();
  });

  it('validates the plan against architecture, location and disk', async () => {
    await expect(adapter.rescale(db, { plan: 'cx32' })).rejects.toThrow(/different CPU architecture/);
    await expect(adapter.rescale(db, { plan: 'cx11' })).rejects.toThrow(/discontinued/);
    await expect(adapter.rescale(web, { plan: 'cpx11' })).rejects.toThrow(/discontinued/);
    await expect(adapter.rescale(web, { plan: 'cpx21' })).rejects.toThrow(/not available in fsn1/);
    await expect(adapter.rescale(db, { plan: 'cax11' })).rejects.toThrow(/already has/);
    await expect(adapter.rescale(web, { plan: 'nope' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('changes the type with or without disk upgrade', async () => {
    const keep = await adapter.rescale(db, { plan: 'cax21' });
    expect(posted('/servers/43/actions/change_type')!.body).toEqual({
      server_type: 'cax21',
      upgrade_disk: false,
    });
    expect(keep.message).toMatch(/downgrade stays possible/);
    const grow = await adapter.rescale(db, { plan: 'cax21', upgradeDisk: true });
    expect(posted('/servers/43/actions/change_type')!.body).toEqual({
      server_type: 'cax21',
      upgrade_disk: true,
    });
    expect(grow.message).toMatch(/80 GB disk/);
    expect(grow.providerRef).toMatch(/^\d+$/);
  });
});

describe('Hetzner images, rebuild and create', () => {
  it('offers images of the server architecture plus its own snapshots and backups', async () => {
    const images = await adapter.listImages(web);
    expect(images.map((i) => [i.id, i.label, i.family])).toEqual([
      ['103', 'Debian 12', 'debian'],
      ['104', 'Docker CE', 'App'],
      ['101', 'Ubuntu 24.04', 'ubuntu'],
      ['203', 'golden (2026-10-01)', 'Snapshot'],
      ['201', 'before-update (2026-09-01)', 'Snapshot'],
      ['301', 'web-1 2026-10-07 (2026-10-07)', 'Backup'],
    ]);
    const system = last((r) => r.path === '/v1/images' && r.query.getAll('type').join(',') === 'system,app')!;
    expect(system.query.get('architecture')).toBe('x86');
  });

  it('offers system images of both architectures for new servers', async () => {
    const images = await adapter.listImages();
    expect(images.map((i) => i.label)).toEqual([
      'Debian 12 (x86)',
      'Docker CE (x86)',
      'Ubuntu 24.04 (Arm64)',
      'Ubuntu 24.04 (x86)',
    ]);
  });

  it('rebuilds from allowed images only and passes the new root password on', async () => {
    const before = mock.requests.length;
    for (const id of ['102', '202', '302', '105', '9999', 'x']) {
      await expect(adapter.rebuild(web, id)).rejects.toThrow(/Unknown image/);
    }
    expect(countSince(before, (r) => r.method === 'POST')).toBe(0);
    const result = await adapter.rebuild(web, '101');
    expect(posted('/servers/42/actions/rebuild')!.body).toEqual({ image: 101 });
    expect(result).toMatchObject({ password: 'New-Root-2' });
    await adapter.rebuild(web, '201');
    expect(posted('/servers/42/actions/rebuild')!.body).toEqual({ image: 201 });
  });

  it('honours rebuild protection', async () => {
    const err = (await adapter.rebuild(db, '102').catch((e: unknown) => e)) as AppError;
    expect(err.statusCode).toBe(409);
    expect(err.message).toMatch(/Rebuild protection/);
  });

  it('creates servers from plan, location and image', async () => {
    const result = await adapter.createServer({
      name: 'new-web',
      plan: 'cx22',
      location: 'nbg1',
      imageId: '101',
      cores: 0,
      memoryMb: 0,
      diskGb: 0,
    });
    expect(result).toEqual({ externalId: '50', providerRef: '4000', message: 'Server created' });
    expect(posted('/servers')!.body).toEqual({
      name: 'new-web',
      server_type: 'cx22',
      image: 101,
      location: 'nbg1',
      start_after_create: true,
    });
    expect(JSON.stringify(result)).not.toContain('YItygq1v3GYjjMomLaKc');

    // Image names resolve per architecture.
    await adapter.createServer({
      name: 'arm-1',
      plan: 'cax11',
      location: 'fsn1',
      imageId: 'ubuntu-24.04',
      start: false,
      cores: 0,
      memoryMb: 0,
      diskGb: 0,
    });
    expect(posted('/servers')!.body).toMatchObject({ image: 102, start_after_create: false });
  });

  it('validates create requests before anything is ordered', async () => {
    const base = {
      name: 'x1',
      plan: 'cx22',
      location: 'fsn1',
      imageId: '101',
      cores: 0,
      memoryMb: 0,
      diskGb: 0,
    };
    const before = mock.requests.length;
    await expect(adapter.createServer({ ...base, plan: undefined })).rejects.toThrow(/server type/);
    await expect(adapter.createServer({ ...base, location: undefined })).rejects.toThrow(
      /location is required/,
    );
    await expect(adapter.createServer({ ...base, imageId: undefined })).rejects.toThrow(/image is required/);
    await expect(adapter.createServer({ ...base, name: 'kein hostname' })).rejects.toThrow(/valid hostname/);
    await expect(adapter.createServer({ ...base, plan: 'cx11' })).rejects.toThrow(/discontinued/);
    await expect(adapter.createServer({ ...base, plan: 'cpx11', location: 'nbg1' })).rejects.toThrow(
      /discontinued/,
    );
    await expect(adapter.createServer({ ...base, plan: 'cpx21' })).rejects.toThrow(/not available in fsn1/);
    await expect(adapter.createServer({ ...base, location: 'xyz1' })).rejects.toThrow(/Unknown location/);
    await expect(adapter.createServer({ ...base, plan: 'ccx13', location: 'hel1' })).rejects.toThrow(
      /not available in hel1/,
    );
    await expect(adapter.createServer({ ...base, imageId: '102' })).rejects.toThrow(/built for arm/);
    await expect(adapter.createServer({ ...base, imageId: '301' })).rejects.toThrow(/Unknown image/);
    await expect(adapter.createServer({ ...base, imageId: '9999' })).rejects.toThrow(/Unknown image/);
    expect(countSince(before, (r) => r.method === 'POST')).toBe(0);
  });
});

describe('Hetzner network, ISO, password, delete', () => {
  it('sets reverse DNS for the server addresses only', async () => {
    await adapter.setRdns(web, '2a01:4f8:c012:abcd::10', 'mail.example.com.');
    expect(posted('/servers/42/actions/change_dns_ptr')!.body).toEqual({
      ip: '2a01:4f8:c012:abcd::10',
      dns_ptr: 'mail.example.com',
    });
    await adapter.setRdns(web, '116.203.10.42', '');
    expect(posted('/servers/42/actions/change_dns_ptr')!.body).toEqual({
      ip: '116.203.10.42',
      dns_ptr: null,
    });

    const before = mock.requests.length;
    await expect(adapter.setRdns(web, '1.1.1.1', 'x.example.com')).rejects.toThrow(/does not belong/);
    await expect(adapter.setRdns(web, '2a01:4f8:c012:abce::1', 'x.example.com')).rejects.toThrow(
      /does not belong/,
    );
    await expect(adapter.setRdns(db, '116.203.10.42', 'x.example.com')).rejects.toThrow(/does not belong/);
    await expect(adapter.setRdns(web, '116.203.10.42', 'not a host')).rejects.toThrow(/Invalid hostname/);
    expect(countSince(before, (r) => r.method === 'POST')).toBe(0);
  });

  it('lists public ISOs of the server architecture', async () => {
    const isos = await adapter.listIsos(web);
    const req = last((r) => r.path === '/v1/isos')!;
    expect(req.query.get('architecture')).toBe('x86');
    expect(req.query.get('include_architecture_wildcard')).toBe('true');
    expect(isos).toEqual([
      { id: '5', label: 'virtio-win-0.1.248' },
      { id: '1', label: 'Windows Server 2022 English' },
    ]);
  });

  it('mounts and removes ISOs', async () => {
    const mounted = await adapter.mountIso(web, '1');
    expect(posted('/servers/42/actions/attach_iso')!.body).toEqual({ iso: 1 });
    expect(mounted.providerRef).toMatch(/^\d+$/);
    // Private ISOs belong to the project, not to the customer.
    await expect(adapter.mountIso(web, '3')).rejects.toThrow(/Unknown ISO/);
    await expect(adapter.mountIso(web, '2')).rejects.toThrow(/Unknown ISO/);

    const before = mock.requests.length;
    expect(await adapter.unmountIso(web)).toEqual({ message: 'No ISO mounted' });
    expect(countSince(before, (r) => r.method === 'POST')).toBe(0);
    await adapter.unmountIso(db);
    expect(posted('/servers/43/actions/detach_iso')).toBeDefined();
  });

  it('resets the root password of running servers', async () => {
    const result = await adapter.resetPassword(web);
    expect(result).toMatchObject({ password: 'Root-Pass-1', message: 'Root password reset' });
    expect(result.providerRef).toMatch(/^\d+$/);
    await expect(adapter.resetPassword(db)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('honours delete protection', async () => {
    const before = mock.requests.length;
    const err = (await adapter.deleteServer(db).catch((e: unknown) => e)) as AppError;
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe('Delete protection is enabled for this server at Hetzner');
    expect(countSince(before, (r) => r.method === 'DELETE')).toBe(0);

    const result = await adapter.deleteServer(web);
    expect(last((r) => r.method === 'DELETE')!.path).toBe('/v1/servers/42');
    expect(result.message).toBe('Deletion started');
    expect(result.providerRef).toMatch(/^\d+$/);
  });
});

describe('Hetzner admin views', () => {
  it('returns the server config without secrets', async () => {
    const config = await adapter.getConfig(web);
    expect(config).toMatchObject({ id: 42, name: 'web-1', backup_window: '22-02' });
  });

  it('passes raw requests through with secrets redacted', async () => {
    const reset = await adapter.rawRequest('POST', '/servers/42/actions/reset_password');
    expect(reset.status).toBe(200);
    expect((reset.data as { root_password: string }).root_password).toBe('••••••');

    const vnc = await adapter.rawRequest('post', 'v1/servers/42/actions/request_console');
    expect(vnc.data).toMatchObject({ wss_url: '••••••', password: '••••••' });
    expect(JSON.stringify(vnc.data)).not.toContain('one-time-console-token');

    const types = await adapter.rawRequest('GET', `${mock.url}/v1/server_types`);
    expect((types.data as { server_types: unknown[] }).server_types).toHaveLength(8);

    // Errors come back as data, the explorer shows them.
    const missing = await adapter.rawRequest('GET', '/servers/777');
    expect(missing).toEqual({
      status: 404,
      data: { error: { code: 'not_found', message: 'server not found' } },
    });

    await adapter.rawRequest('GET', '/images', { type: 'snapshot', per_page: 5 });
    const req = last((r) => r.path === '/v1/images')!;
    expect([req.query.get('type'), req.query.get('per_page')]).toEqual(['snapshot', '5']);

    await adapter.rawRequest('PUT', '/servers/42', { labels: { a: 'b' } });
    expect(last((r) => r.method === 'PUT')!.body).toEqual({ labels: { a: 'b' } });

    for (const path of [
      '//evil.example/x',
      '/servers/../../x',
      '/servers/%2E%2e/%2e%2e/x',
      '/servers@evil.example',
    ]) {
      await expect(adapter.rawRequest('GET', path)).rejects.toThrow(/Invalid path/);
    }
    await expect(adapter.rawRequest('PATCH', '/servers')).rejects.toThrow(/Unsupported method/);
  });

  it('declares only what it implements, without firewall', () => {
    const caps = adapter.capabilities();
    expect(caps).not.toContain('firewall');
    expect(caps).not.toContain('ddos');
    expect(caps).not.toContain('monitoring');
    const methods: Record<string, keyof HetznerAdapter> = {
      power: 'power',
      metrics: 'getMetrics',
      traffic: 'getTraffic',
      backups: 'listBackups',
      backupRestore: 'restoreBackup',
      backupDelete: 'deleteBackup',
      snapshots: 'listSnapshots',
      console: 'openConsole',
      rescale: 'rescale',
      rebuild: 'rebuild',
      rdns: 'setRdns',
      iso: 'listIsos',
      passwordReset: 'resetPassword',
      delete: 'deleteServer',
      config: 'getConfig',
      tasks: 'listTasks',
    };
    for (const cap of caps) {
      if (methods[cap]) expect(typeof adapter[methods[cap]!]).toBe('function');
    }
  });
});

describe('Hetzner parsing', () => {
  it('parses the hcloud-go sample server', () => {
    // From hcloud-go schema_test.go (TestServerSchema), trimmed to what the adapter reads.
    const sample = {
      id: 1,
      name: 'server.example.com',
      status: 'running',
      created: '2017-08-16T17:29:14+00:00',
      public_net: {
        ipv4: null,
        ipv6: {
          ip: '2a01:4f8:1c11:3400::/64',
          blocked: false,
          dns_ptr: [{ ip: '2a01:4f8:1c11:3400::1/64', dns_ptr: 'server01.example.com' }],
        },
      },
      private_net: [{ network: 4711, ip: '10.0.1.1', aliases: ['10.0.1.2'] }],
      server_type: { id: 2 },
      outgoing_traffic: 123456,
      ingoing_traffic: 7891011,
      included_traffic: 654321,
      backup_window: '22-02',
      rescue_enabled: true,
      primary_disk_size: 20,
      image: {
        id: 4711,
        type: 'system',
        status: 'available',
        name: 'ubuntu16.04-standard-x64',
        description: 'Ubuntu 16.04 Standard 64 bit',
        os_flavor: 'ubuntu',
        os_version: '16.04',
      },
      iso: {
        id: 4711,
        name: 'FreeBSD-11.0-RELEASE-amd64-dvd1',
        description: 'FreeBSD 11.0 x64',
        type: 'public',
      },
      datacenter: {
        id: 1,
        name: 'fsn1-dc8',
        description: 'Falkenstein 1 DC 8',
        location: FSN1,
      },
      protection: { delete: true, rebuild: true },
      locked: true,
      labels: { key: 'value', key2: 'value2' },
    } as unknown as HetznerServer;
    const parsed = parseServer(sample);
    expect(parsed).toMatchObject({
      externalId: '1',
      status: 'locked',
      os: 'Ubuntu 16.04 Standard 64 bit',
      node: 'fsn1-dc8',
      specs: { diskGb: 20 },
      meta: {
        datacenter: { name: 'fsn1-dc8', city: 'Falkenstein', country: 'DE' },
        location: 'fsn1',
        rescueEnabled: true,
        iso: 'FreeBSD 11.0 x64',
        protection: { delete: true, rebuild: true },
      },
    });
    expect(parsed.ips).toEqual([
      { address: '2a01:4f8:1c11:3400::1', version: 6, gateway: 'fe80::1', rdns: 'server01.example.com' },
      { address: '10.0.1.1', version: 4, mac: undefined },
    ]);
  });

  it('maps server statuses', () => {
    expect(mapStatus('running')).toBe('running');
    expect(mapStatus('off')).toBe('stopped');
    expect(mapStatus('off', true)).toBe('locked');
    expect(mapStatus('initializing')).toBe('installing');
    expect(mapStatus('rebuilding')).toBe('installing');
    expect(mapStatus('starting')).toBe('starting');
    expect(mapStatus('stopping')).toBe('stopping');
    expect(mapStatus('migrating')).toBe('migrating');
    expect(mapStatus('deleting')).toBe('locked');
    expect(mapStatus('unknown')).toBe('unknown');
    expect(mapStatus(undefined)).toBe('unknown');
  });

  it('handles IPv6 networks', () => {
    expect(expandIpv6('2a01:4f8::1')).toEqual([0x2a01, 0x4f8, 0, 0, 0, 0, 0, 1]);
    expect(expandIpv6('::')).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(expandIpv6('1.2.3.4')).toBeNull();
    expect(expandIpv6('1::2::3')).toBeNull();
    expect(inIpv6Network('2a01:4f8:c012:abcd:ffff::1', '2a01:4f8:c012:abcd::/64')).toBe(true);
    expect(inIpv6Network('2a01:4f8:c012:abce::1', '2a01:4f8:c012:abcd::/64')).toBe(false);
    expect(inIpv6Network('2a01:4f8:c012:abcd::1', '2a01:4f8:c012:abcd::/garbage')).toBe(false);
  });

  it('converts prices and metrics', () => {
    expect(priceMinor('4.5815000000000000')).toBe(458);
    expect(priceMinor('14.2681000000000000')).toBe(1427);
    expect(priceMinor(null)).toBeNull();
    expect(metricPoints({ cpu: { values: [[10.4, '150']] } }, 4)).toEqual([{ t: 10, cpu: 37.5 }]);
    expect(metricPoints({ cpu: { values: [[10, '150']] } })).toEqual([{ t: 10, cpu: 150 }]);
    expect(metricPoints(null)).toEqual([]);
  });

  it('redacts secrets recursively', () => {
    expect(
      redactSecrets({ root_password: 'x', action: { id: 1 }, list: [{ password: 'y', wss_url: 'wss://z' }] }),
    ).toEqual({
      root_password: '••••••',
      action: { id: 1 },
      list: [{ password: '••••••', wss_url: '••••••' }],
    });
    // Null stays null so the explorer shows that nothing was generated.
    expect(redactSecrets({ root_password: null })).toEqual({ root_password: null });
  });
});
