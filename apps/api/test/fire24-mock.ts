import { readFileSync } from 'node:fs';
import { FIRE24_SCOPES_READ_ONLY } from '@weblion/shared';
import { FIRE24_ENDPOINTS, type Fire24EndpointName } from '../src/providers/fire24/endpoints';
import { startMockServer, type MockAnswer, type RecordedRequest } from './mock-server';

// ---------------------------------------------------------------------------
// A 24fire Customer REST API v1, generated from the spec copy in fixtures/fire24/openapi-v1.json:
// every operation with its method, path and x-required-scope, Bearer tokens with scopes, the
// documented error bodies (401, 403 insufficient_scope, 404, 422 validation_failed, 429, 502,
// 400 dns_error), pagination with 25 per page and meta, and the request body rules of the spec.
//
// Payloads the spec only shows as "example" are the v2 payloads of the old tests ("v2"), and can
// be switched per operation to other shapes (`state.shapes`) or replaced (`state.payloads`), so
// the tolerant parsers are tested against what 24fire might really send.

const SPEC_URL = new URL('./fixtures/fire24/openapi-v1.json', import.meta.url);

interface SpecOperation {
  operationId: string;
  'x-required-scope': string;
  parameters?: { name: string; in: string; required?: boolean }[];
  requestBody?: {
    required?: boolean;
    content: Record<string, { schema: SpecSchema }>;
  };
  responses: Record<string, { content?: Record<string, { example?: unknown }> }>;
}

interface SpecSchema {
  type?: string;
  properties?: Record<string, { type?: string; $ref?: string }>;
  required?: string[];
  enum?: string[];
}

export interface Fire24Spec {
  paths: Record<string, Record<string, SpecOperation>>;
  components: { schemas: Record<string, SpecSchema> };
}

export function fire24Spec(): Fire24Spec {
  return JSON.parse(readFileSync(SPEC_URL, 'utf8')) as Fire24Spec;
}

export interface SpecRoute {
  method: string;
  path: string;
  operationId: string;
  scope: string;
  pattern: RegExp;
  params: string[];
  op: SpecOperation;
}

/** Every operation of the spec as a route. */
export function specRoutes(spec = fire24Spec()): SpecRoute[] {
  const routes: SpecRoute[] = [];
  for (const [path, ops] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(ops)) {
      const params: string[] = [];
      const source = path.replace(/\{(\w+)\}/g, (_, name: string) => {
        params.push(name);
        return '([^/]+)';
      });
      routes.push({
        method: method.toUpperCase(),
        path,
        operationId: op.operationId,
        scope: op['x-required-scope'],
        pattern: new RegExp(`^${source}$`),
        params,
        op,
      });
    }
  }
  return routes;
}

const ROUTES = specRoutes();

/** The spec operationId of an endpoint table row (`op('serverConfig')`). */
export function op(name: Fire24EndpointName): string {
  const { method, path } = FIRE24_ENDPOINTS[name];
  const route = ROUTES.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no spec operation for ${name}`);
  return route.operationId;
}

export const FIRE24_FULL_TOKEN = '1|cra_full';
export const FIRE24_READ_TOKEN = '2|cra_read';
export const ROOT_PASSWORD = 'MOCK-ROOT-PASSWORD';
export const NEW_ROOT_PASSWORD = 'MOCK-NEW-ROOT-PASSWORD';
export const CONSOLE_TOKEN = 'MOCK-CONSOLE-TOKEN';
export const LOGIN_TOKEN = 'MOCK-PLESK-LOGIN';
export const AUTHCODE = 'MOCK-AUTHCODE';
export const PLESK_PASSWORD = 'MOCK-PLESK-PASSWORD';

/** Payload shapes for operations whose answer the spec does not document. */
export type Fire24Shape = 'v2' | 'wrapped' | 'array' | 'keyed' | 'empty' | 'string' | 'null';

export interface MockBackup {
  backup_id: string;
  backup_os: string;
  backup_description: string;
  size: number;
  created: string;
  status: 'pending' | 'finished';
  /** create-status polls until finished. */
  polls: number;
}

export interface MockServer {
  id: string;
  name: string;
  hostname: string;
  os: string;
  iso: string | null;
  ipv4: string[];
  ipv6: string[];
  status: 'running' | 'stopped';
  task: string | null;
  /** PTR names served by GET rdns (the config keeps the names it was created with). */
  rdns: Record<string, string>;
  ddos: Record<string, { layer4: string; layer7: string }>;
  backups: MockBackup[];
  /** reinstall/status polls since the last reinstall, null when none ran. */
  reinstallPolls: number | null;
  renewal: Record<string, unknown>;
}

export interface MockDnsRecord {
  record_id: number;
  type: string;
  name: string;
  data: string;
  ttl: number;
}

export interface MockDomain {
  id: string;
  domain: string;
  status: string;
  nameservers: string[];
  records: MockDnsRecord[];
  renewal: Record<string, unknown>;
}

export interface MockWebspace {
  id: string;
  name: string;
  primary_domain: string;
  package: string;
  /** Null as in the spec example; set the v2 object to test the resource mapping. */
  resources: Record<string, unknown> | null;
  /** Resources of GET usage. */
  usage: Record<string, unknown> | null;
  /** A v2 style access object in the detail (not documented for v1). */
  access: Record<string, unknown> | null;
  logins: number;
}

export interface Fire24MockState {
  account: Record<string, unknown>;
  attention: { operational: boolean; items: { severity: string; title: string; description: string }[] };
  servers: MockServer[];
  domains: MockDomain[];
  webspaces: MockWebspace[];
  /** Further entries of /v1/services (dedicated servers). */
  dedicated: { id: string; name: string }[];
  /** Visible product ids; null = all (the token has no allowlist). Hidden products answer 404. */
  allowlist: Set<string> | null;
  /** Answers 429 `times` times, with `Retry-After: retryAfter` when given. */
  throttle: Record<string, { times: number; retryAfter?: string }>;
  /** Answers 502 upstream_error `times` times (Infinity: always). */
  upstreamFail: Record<string, number>;
  /** Any answer for an operation, after auth and scope checks; a function may pass (undefined). */
  errors: Record<string, MockAnswer | ((req: RecordedRequest) => MockAnswer | undefined)>;
  /** Lists without meta. */
  metaMissing: boolean;
  /** Replaces the paginated answer of a list operation. */
  pages: Record<string, (page: number) => { data: unknown; meta?: unknown }>;
  shapes: Record<string, Fire24Shape>;
  /** Replaces `data` of an operation (after its side effects). */
  payloads: Record<string, unknown>;
  /** Answers the console call with this shape: a noVNC page, a websocket with a password, or nothing. */
  console: 'url' | 'vnc' | 'none';
}

export interface Fire24MockOptions {
  /** Number of KVM servers (default 30, so the list has two pages). */
  servers?: number;
}

const OS_LABELS: Record<string, string> = {
  debian_12: 'Debian 12',
  ubuntu_24: 'Ubuntu 24.04',
  almalinux_9: 'AlmaLinux 9',
};
const ISO_LABELS: Record<string, string> = { proxmox_8: 'Proxmox 8', windows_2022: 'Windows Server 2022' };

const pad = (n: number, width: number) => String(n).padStart(width, '0');

export function mockServer(i: number): MockServer {
  const ipv4 = `88.151.${Math.floor(i / 200) + 1}.${(i % 200) + 2}`;
  return {
    id: `5ba90171-438b-49da-9774-${pad(i, 12)}`,
    name: `EPYC ${pad(i + 1, 2)}`,
    hostname: `shop-${pad(i + 1, 2)}`,
    os: 'debian_12',
    iso: null,
    ipv4: [ipv4],
    ipv6: [`2a12:8641::${(i + 2).toString(16)}`],
    status: 'running',
    task: null,
    rdns: { [ipv4]: `srv${i + 1}.example.ch` },
    ddos: { [ipv4]: { layer4: 'dynamic', layer7: 'off' } },
    backups: [
      {
        backup_id: `b${i}-1`,
        backup_os: 'debian_12',
        backup_description: 'nightly',
        size: 2200,
        created: '2026-10-25T14:02:14.000Z',
        status: 'finished',
        polls: 0,
      },
    ],
    reinstallPolls: null,
    renewal: {
      type: 'KVM',
      renew_price: 9.5,
      renew_interval_days: 30,
      renew_date: '2026-12-01T00:00:00Z',
      auto_renew: true,
      renew_state: 'renewing',
      cancellation_pending: false,
      remaining_days: 30,
      disabled: false,
    },
  };
}

function initialState(options: Fire24MockOptions): Fire24MockState {
  return {
    account: {
      customer_number: 'K-100200',
      firstname: 'Lars',
      lastname: 'Kiefer',
      email: 'l.kiefer@example.com',
      phone: '+49 30 1234567',
      birthdate: '1990-01-01',
      language: 'de',
      balance: 240.42,
      plus_user: true,
      registered_at: '2022-02-26T17:33:52Z',
      billing_address: { street: 'Musterweg', number: '1', zip: '10115', city: 'Berlin', country: 'DE' },
    },
    attention: {
      operational: false,
      items: [
        { severity: 'danger', title: 'Invoice overdue', description: 'Invoice 4711 is due since 3 days' },
      ],
    },
    servers: Array.from({ length: options.servers ?? 30 }, (_, i) => mockServer(i)),
    domains: [
      {
        id: 'e5d987ce-0595-4dc8-c248-000000000001',
        domain: 'fire-test.de',
        status: 'LOCK',
        nameservers: ['ns1.fireapi.de', 'ns2.fireapi.de'],
        records: [
          { record_id: 7498384, type: 'A', name: '*', data: '192.168.100.30', ttl: 300 },
          { record_id: 7498387, type: 'TXT', name: 'fire', data: 'hello', ttl: 300 },
          { record_id: 7498390, type: 'HTTP_FRAME', name: 'frame', data: 'https://example.com', ttl: 300 },
        ],
        renewal: {
          renew_price: 12,
          renew_interval_days: 365,
          renew_date: '2027-03-14T00:30:49Z',
          auto_renew: true,
          renew_state: 'renewing',
          cancellation_pending: false,
          disabled: false,
        },
      },
    ],
    webspaces: [
      {
        id: '95063484-953c-43db-8f44-000000000001',
        name: 'Plesk-Medium',
        primary_domain: 'kunde.de',
        package: 'Plesk Medium',
        resources: null,
        usage: null,
        access: null,
        logins: 0,
      },
    ],
    dedicated: [{ id: 'ded-1', name: 'Dedicated Ryzen' }],
    allowlist: null,
    throttle: {},
    upstreamFail: {},
    errors: {},
    metaMissing: false,
    pages: {},
    shapes: {},
    payloads: {},
    console: 'url',
  };
}

const NOT_FOUND = { status: 'error', type: 'not_found', message: 'The requested resource was not found.' };

function documentedExample(route: SpecRoute, code: string): unknown {
  return route.op.responses[code]?.content?.['application/json']?.example;
}

const fail = (status: number, body: unknown, headers?: Record<string, string>): MockAnswer => ({
  status,
  body,
  headers,
});

/** Laravel's message for a field ("password_login" -> "password login"). */
const field = (name: string) => name.replace(/_/g, ' ');

/** The spec's request body and query rules: required fields, enums, booleans and integers. */
function validate(route: SpecRoute, req: RecordedRequest, spec: Fire24Spec): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const param of route.op.parameters ?? []) {
    if (param.in === 'query' && param.required && !req.query.get(param.name)) {
      errors[param.name] = [`The ${field(param.name)} field is required.`];
    }
  }
  const schema = route.op.requestBody?.content['application/x-www-form-urlencoded']?.schema;
  if (!schema) return errors;
  for (const name of schema.required ?? []) {
    if (!req.form.get(name)) errors[name] = [`The ${field(name)} field is required.`];
  }
  for (const [name, prop] of Object.entries(schema.properties ?? {})) {
    const value = req.form.get(name);
    if (value === null || value === '' || errors[name]) continue;
    const ref = prop.$ref ? spec.components.schemas[prop.$ref.split('/').pop()!] : undefined;
    if (ref?.enum && !ref.enum.includes(value)) errors[name] = [`The selected ${field(name)} is invalid.`];
    if (prop.type === 'boolean' && !['1', '0', 'true', 'false'].includes(value)) {
      errors[name] = [`The ${field(name)} field must be true or false.`];
    }
    if (prop.type === 'integer' && !/^-?\d+$/.test(value)) {
      errors[name] = [`The ${field(name)} field must be an integer.`];
    }
  }
  return errors;
}

function shaped(shape: Fire24Shape, v2: unknown, wrap: string, idKey = 'id'): unknown {
  switch (shape) {
    case 'v2':
      return v2;
    case 'wrapped':
      return { [wrap]: v2 };
    case 'array':
      if (Array.isArray(v2)) return v2;
      if (v2 && typeof v2 === 'object' && Object.values(v2).every((v) => v && typeof v === 'object')) {
        return Object.entries(v2 as Record<string, object>).map(([key, value]) => ({
          [idKey]: key,
          ...value,
        }));
      }
      return [v2];
    case 'keyed':
      if (!Array.isArray(v2)) return v2;
      return Object.fromEntries(
        v2.map((entry: Record<string, unknown>) => {
          const { [idKey]: key, ...rest } = entry;
          return [String(key), rest];
        }),
      );
    case 'empty':
      return {};
    case 'string':
      return 'example';
    case 'null':
      return null;
  }
}

export type Fire24Mock = Awaited<ReturnType<typeof startFire24Mock>>;

export async function startFire24Mock(options: Fire24MockOptions = {}) {
  const spec = fire24Spec();
  const state = initialState(options);
  const tokens: Record<string, readonly string[]> = {
    [FIRE24_FULL_TOKEN]: [...new Set(ROUTES.map((r) => r.scope))],
    [FIRE24_READ_TOKEN]: FIRE24_SCOPES_READ_ONLY,
  };
  /** Operation of every request, in the order of `requests`. */
  const operations: (string | null)[] = [];
  let nextBackup = 100;

  const visible = (id: string) => state.allowlist === null || state.allowlist.has(id);
  const server = (id: string) => state.servers.find((s) => s.id === id && visible(s.id));

  const config = (s: MockServer) => ({
    identifier: 30_000 + state.servers.indexOf(s),
    hostsystem: {
      datacenter: { name: 'DC', city: 'Frankfurt', country: 'Deutschland' },
      name: 'de_xeon',
      node: 'XEON 04',
    },
    config: {
      cores: 4,
      mem: 8192,
      disk: 80,
      os: { name: s.os, displayname: OS_LABELS[s.os] ?? s.os },
      iso: s.iso
        ? { name: s.iso, displayname: ISO_LABELS[s.iso] ?? s.iso, attached: true }
        : { name: 'none', displayname: 'none', attached: false },
      username: 'root',
      password: ROOT_PASSWORD,
      hostname: s.hostname,
      network_speed: 2000,
      backup_slots: 2,
      ipv4: s.ipv4.map((ip) => ({
        ip_address: ip,
        ip_gateway: ip.replace(/\.\d+$/, '.1'),
        ddos_protection: 'combahton',
        rdns: `initial-${ip}.example.ch`,
      })),
      ipv6: s.ipv6.map((ip) => ({ ip_address: ip, ip_gateway: '2a12:8641::1' })),
      monitoring: { enabled: true, port: 22 },
    },
    max_config: { cores: 12, mem: 65536, disk: 300, network_speed: 3000, backup_slots: 10, ipv4: 6 },
    abuse_status: 'CLEAN',
  });

  const serverItem = (s: MockServer) => ({ id: s.id, name: s.name, ...s.renewal });
  const domainItem = (d: MockDomain) => ({ id: d.id, domain: d.domain, name: d.domain, ...d.renewal });
  const webspaceItem = (w: MockWebspace) => ({
    id: w.id,
    name: w.name,
    primary_domain: w.primary_domain,
    provisioning_status: 'active',
    renew_price: 3.5,
    renew_interval_days: 30,
    renew_date: '2026-12-30T00:00:00Z',
    auto_renew: false,
    renew_state: 'renewing',
    disabled: false,
  });
  const services = () => [
    ...state.servers.map((s) => ({ ...serverItem(s), category: 'kvm', manageable: true })),
    ...state.domains.map((d) => ({
      id: d.id,
      name: d.domain,
      type: 'DOMAIN',
      category: 'domain',
      manageable: true,
      ...d.renewal,
    })),
    ...state.webspaces.map((w) => ({
      ...webspaceItem(w),
      type: 'WEBSPACE',
      category: 'plesk',
      manageable: true,
    })),
    ...state.dedicated.map((d) => ({ id: d.id, name: d.name, type: 'DEDICATED', category: 'dedicated' })),
  ];

  /** A list page as the spec documents it. */
  const page = (operationId: string, req: RecordedRequest, all: { id: string }[]): MockAnswer => {
    const number = Math.max(1, Number(req.query.get('page') ?? 1) || 1);
    const hook = state.pages[operationId];
    if (hook) {
      const { data, meta } = hook(number);
      return { body: { status: 'success', data, ...(meta === undefined ? {} : { meta }) } };
    }
    const items = all.filter((item) => visible(item.id));
    const lastPage = Math.max(1, Math.ceil(items.length / 25));
    const data = items.slice((number - 1) * 25, number * 25);
    const meta = { current_page: number, per_page: 25, total: items.length, last_page: lastPage };
    return { body: { status: 'success', data, ...(state.metaMissing ? {} : { meta }) } };
  };

  /** The v2 style payload of an opaque operation, in the shape the test asked for. */
  const opaque = (operationId: string, v2: unknown, wrap: string, idKey?: string) =>
    shaped(state.shapes[operationId] ?? 'v2', v2, wrap, idKey);

  const handlers: Record<string, (req: RecordedRequest, p: Record<string, string>) => MockAnswer | unknown> =
    {
      getV1Account: () => state.account,
      getV1Status: () => ({
        operational: state.attention.operational,
        attention_items: state.attention.items,
      }),
      getV1Services: (req) => {
        const category = req.query.get('category');
        if (category && !['kvm', 'domain', 'plesk', 'dedicated'].includes(category)) {
          return fail(422, {
            status: 'error',
            type: 'validation_failed',
            message: 'The selected category is invalid.',
            errors: { category: ['The selected category is invalid.'] },
          });
        }
        return page(
          'getV1Services',
          req,
          services().filter((s) => !category || s.category === category),
        );
      },
      getV1Servers: (req) => page('getV1Servers', req, state.servers.map(serverItem)),
      getV1ServersServer: (_, p) => serverItem(server(p.server!)!),
      getV1ServersServerStatus: (_, p) => {
        const s = server(p.server!)!;
        return opaque(
          'getV1ServersServerStatus',
          {
            status: s.status,
            uptime: 545,
            task: s.reinstallPolls !== null && s.reinstallPolls < 2 ? 'REINSTALL' : s.task,
            usage: {
              cpu: { data: '12.5', unit: '%' },
              mem: { data: '2.5', unit: 'GB' },
              nvme_storage: { data: 1.7, unit: 'GB' },
            },
          },
          'status',
        );
      },
      getV1ServersServerConfig: (_, p) =>
        opaque('getV1ServersServerConfig', config(server(p.server!)!), 'config'),
      getV1ServersServerNetwork: (_, p) => {
        const s = server(p.server!)!;
        return opaque(
          'getV1ServersServerNetwork',
          {
            ipv4: s.ipv4.map((ip) => ({ ip_address: ip, ip_gateway: ip.replace(/\.\d+$/, '.1') })),
            ipv6: s.ipv6.map((ip) => ({ ip_address: ip })),
          },
          'network',
        );
      },
      getV1ServersServerTraffic: () =>
        opaque(
          'getV1ServersServerTraffic',
          {
            month: 'JULE',
            usage: { total: 7.12, in: 6.53, out: 0.59 },
            limit: { monthly: 1000, additional: 500, remaining: 1492.88, vm_status: 'throttled' },
          },
          'traffic',
        ),
      getV1ServersServerAbuses: () => opaque('getV1ServersServerAbuses', [], 'abuses'),
      getV1ServersServerOsList: () =>
        opaque(
          'getV1ServersServerOsList',
          Object.entries(OS_LABELS).map(([name, displayname]) => ({ name, displayname })),
          'os',
          'name',
        ),
      getV1ServersServerIsoList: () =>
        opaque(
          'getV1ServersServerIsoList',
          Object.entries(ISO_LABELS).map(([name, displayname]) => ({ name, displayname })),
          'isos',
          'name',
        ),
      getV1ServersServerReinstallStatus: (_, p) => {
        const s = server(p.server!)!;
        if (s.reinstallPolls === null)
          return opaque('getV1ServersServerReinstallStatus', { status: 'finished' }, 'status');
        s.reinstallPolls++;
        return opaque(
          'getV1ServersServerReinstallStatus',
          s.reinstallPolls < 2
            ? { status: 'installing', progress: 40 }
            : { status: 'finished', progress: 100 },
          'status',
        );
      },
      postV1ServersServerPower: (req, p) => {
        const s = server(p.server!)!;
        s.status = req.form.get('mode') === 'stop' ? 'stopped' : 'running';
        return null;
      },
      postV1ServersServerConsole: (_, p) => {
        if (state.console === 'none') return { message: 'ok' };
        if (state.console === 'vnc') {
          return {
            wss_url: `wss://console.24fire.de/vnc/${p.server}?token=${CONSOLE_TOKEN}`,
            password: CONSOLE_TOKEN,
          };
        }
        return { url: `https://console.24fire.de/novnc/?token=${CONSOLE_TOKEN}` };
      },
      postV1ServersServerReinstall: (req, p) => {
        const s = server(p.server!)!;
        s.os = req.form.get('os')!;
        s.reinstallPolls = 0;
        return { status: 'installing' };
      },
      postV1ServersServerPasswordReset: () =>
        opaque('postV1ServersServerPasswordReset', { password: NEW_ROOT_PASSWORD }, 'data'),
      getV1ServersServerBackups: (_, p) =>
        opaque(
          'getV1ServersServerBackups',
          server(p.server!)!.backups.map(({ polls: _polls, ...b }) => b),
          'backups',
          'backup_id',
        ),
      postV1ServersServerBackups: (_, p) => {
        const backup: MockBackup = {
          backup_id: `b${nextBackup++}`,
          backup_os: 'debian_12',
          backup_description: '',
          size: 0,
          created: new Date().toISOString(),
          status: 'pending',
          polls: 0,
        };
        server(p.server!)!.backups.push(backup);
        return opaque('postV1ServersServerBackups', { backup_id: backup.backup_id }, 'backup');
      },
      getV1ServersServerBackupsBackupCreateStatus: (_, p) => {
        const backup = server(p.server!)!.backups.find((b) => b.backup_id === p.backup)!;
        backup.polls++;
        if (backup.polls >= 2) backup.status = 'finished';
        return opaque(
          'getV1ServersServerBackupsBackupCreateStatus',
          backup.status === 'pending'
            ? { status: 'pending', progress: { percentage: 14, data_stored: 1.4, total_data: 10 } }
            : { status: 'finished', progress: null },
          'status',
        );
      },
      postV1ServersServerBackupsBackupRestore: (_, p) => ({ backup_id: p.backup }),
      getV1ServersServerBackupsBackupRestoreStatus: () =>
        opaque(
          'getV1ServersServerBackupsBackupRestoreStatus',
          { status: 'finished', progress: { percentage: 100 } },
          'status',
        ),
      deleteV1ServersServerBackupsBackup: (_, p) => {
        const s = server(p.server!)!;
        s.backups = s.backups.filter((b) => b.backup_id !== p.backup);
        return null;
      },
      getV1ServersServerRdns: (_, p) =>
        opaque(
          'getV1ServersServerRdns',
          Object.entries(server(p.server!)!.rdns).map(([ip, ptr]) => ({ ip_address: ip, ptr })),
          'rdns',
          'ip_address',
        ),
      putV1ServersServerRdns: (req, p) => {
        server(p.server!)!.rdns[req.form.get('ip_address')!] = req.form.get('ptr')!;
        return null;
      },
      deleteV1ServersServerRdns: (req, p) => {
        delete server(p.server!)!.rdns[req.query.get('ip_address')!];
        return null;
      },
      getV1ServersServerDdos: (_, p) =>
        opaque('getV1ServersServerDdos', server(p.server!)!.ddos, 'ddos', 'ip_address'),
      postV1ServersServerDdos: (req, p) => {
        const s = server(p.server!)!;
        const ip = req.form.get('ip_address') ?? s.ipv4[0]!;
        const current = s.ddos[ip] ?? { layer4: 'dynamic', layer7: 'off' };
        s.ddos[ip] = {
          layer4: req.form.get('layer4') ?? current.layer4,
          layer7: req.form.get('layer7') ?? current.layer7,
        };
        return null;
      },
      getV1ServersServerSshKeys: () => [],
      putV1ServersServerIso: (req, p) => {
        server(p.server!)!.iso = req.form.get('iso');
        return null;
      },
      deleteV1ServersServerIso: (_, p) => {
        server(p.server!)!.iso = null;
        return null;
      },
      getV1ServersServerMonitoring: () => {
        const now = Date.now();
        return opaque(
          'getV1ServersServerMonitoring',
          {
            timings: [
              { date: new Date(now - 600_000).toISOString(), cpu: '0.481', mem: '1.5', ping: 19 },
              { date: new Date(now - 90 * 86_400_000).toISOString(), cpu: '1', mem: '1', ping: 20 },
            ],
            statistic: {
              LAST_7_DAYS: { downtime: 0, availability: 100, incidences: 0 },
              LAST_24_HOURS: { downtime: 2, availability: 99.8, incidences: 1, longest_incidence: 2 },
            },
            incidences: [
              { start: '2026-10-16T13:46:02.000Z', end: null, downtime: 11, type: 'PING_TIMEOUT' },
            ],
          },
          'monitoring',
        );
      },
      getV1Domains: (req) => page('getV1Domains', req, state.domains.map(domainItem)),
      getV1DomainsDomain: (_, p) => {
        const d = state.domains.find((x) => x.id === p.domain)!;
        const [sld, tld] = d.domain.split('.');
        return opaque(
          'getV1DomainsDomain',
          {
            domain: { name: d.domain, sld, tld, authcode: AUTHCODE, status: d.status, terminated: false },
            handle: { ownerC: 'FIRE24XX', adminC: 'FIRE24XX', techC: 'FIRE24XX', zoneC: 'FIRE24XX' },
            nameserver: Object.fromEntries(
              [1, 2, 3, 4, 5].map((n) => [`ns${n}`, d.nameservers[n - 1] ?? null]),
            ),
            timings: { create: '2023-03-14 15:53:44', expire: '2027-03-14 15:53:44' },
          },
          'domain',
        );
      },
      getV1DomainsDomainDns: (_, p) =>
        opaque(
          'getV1DomainsDomainDns',
          state.domains.find((x) => x.id === p.domain)!.records,
          'records',
          'record_id',
        ),
      postV1DomainsDomainDns: (req, p) => {
        const d = state.domains.find((x) => x.id === p.domain)!;
        const type = req.form.get('type')!;
        const data = req.form.get('data')!;
        if (type === 'A' && !/^(\d{1,3}\.){3}\d{1,3}$/.test(data)) {
          return fail(400, { status: 'error', type: 'dns_error', message: 'The DNS record was rejected.' });
        }
        const id = Math.max(0, ...d.records.map((r) => r.record_id)) + 1;
        d.records.push({ record_id: id, type, name: req.form.get('name')!, data, ttl: 300 });
        return { status: 201, body: { status: 'success', data: { created: true } } };
      },
      patchV1DomainsDomainDnsRecord: (req, p) => {
        const record = state.domains
          .find((x) => x.id === p.domain)!
          .records.find((r) => String(r.record_id) === p.record)!;
        record.type = req.form.get('type')!;
        record.name = req.form.get('name')!;
        record.data = req.form.get('data')!;
        return { updated: true };
      },
      deleteV1DomainsDomainDnsRecord: (_, p) => {
        const d = state.domains.find((x) => x.id === p.domain)!;
        d.records = d.records.filter((r) => String(r.record_id) !== p.record);
        return { deleted: true };
      },
      getV1DomainsDomainNameservers: (_, p) => {
        const d = state.domains.find((x) => x.id === p.domain)!;
        return opaque(
          'getV1DomainsDomainNameservers',
          Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`ns${n}`, d.nameservers[n - 1] ?? null])),
          'nameservers',
        );
      },
      putV1DomainsDomainNameservers: (req, p) => {
        const list = [1, 2, 3, 4, 5].map((n) => req.form.get(`ns${n}`));
        // "ns3-ns5 are optional and must be added in order."
        const gap = list.findIndex((v, i) => !v && list.slice(i + 1).some(Boolean));
        if (gap !== -1) {
          const key = `ns${gap + 1}`;
          return fail(422, {
            status: 'error',
            type: 'validation_failed',
            message: `The ${key} field is required.`,
            errors: { [key]: [`The ${key} field is required.`] },
          });
        }
        state.domains.find((x) => x.id === p.domain)!.nameservers = list.filter((v): v is string => !!v);
        return null;
      },
      getV1Webspaces: (req) => page('getV1Webspaces', req, state.webspaces.map(webspaceItem)),
      getV1WebspacesWebspace: (_, p) => {
        const w = state.webspaces.find((x) => x.id === p.webspace)!;
        return {
          ...webspaceItem(w),
          package: w.package,
          resources: w.resources,
          ...(w.access ? { access: w.access } : {}),
        };
      },
      getV1WebspacesWebspaceUsage: (_, p) => {
        const w = state.webspaces.find((x) => x.id === p.webspace)!;
        return { package: w.package, resources: w.usage };
      },
      postV1WebspacesWebspaceLogin: (_, p) => {
        const w = state.webspaces.find((x) => x.id === p.webspace)!;
        w.logins++;
        return { login_url: `https://plesk.24fire.de:8443/login?token=${LOGIN_TOKEN}-${w.logins}` };
      },
    };

  /** Path ids that must name a visible product (and backups, records, keys of it). */
  const exists = (params: Record<string, string>): boolean => {
    if (params.server !== undefined && !server(params.server)) return false;
    if (params.backup !== undefined) {
      if (!server(params.server!)?.backups.some((b) => b.backup_id === params.backup)) return false;
    }
    if (params.domain !== undefined) {
      const d = state.domains.find((x) => x.id === params.domain && visible(x.id));
      if (!d) return false;
      if (params.record !== undefined && !d.records.some((r) => String(r.record_id) === params.record)) {
        return false;
      }
    }
    if (
      params.webspace !== undefined &&
      !state.webspaces.some((x) => x.id === params.webspace && visible(x.id))
    ) {
      return false;
    }
    return true;
  };

  const answer = (req: RecordedRequest): MockAnswer => {
    const route = ROUTES.find((r) => r.method === req.method && r.pattern.test(req.path));
    operations.push(route?.operationId ?? null);
    if (!route) return fail(404, NOT_FOUND);
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const scopes = token === null ? undefined : tokens[token];
    if (!scopes) return fail(401, documentedExample(route, '401'));
    if (!scopes.includes(route.scope)) return fail(403, documentedExample(route, '403'));

    const id = route.operationId;
    const throttle = state.throttle[id];
    if (throttle && throttle.times > 0) {
      throttle.times--;
      return fail(
        429,
        { status: 'error', type: 'too_many_requests', message: 'Too many requests.' },
        throttle.retryAfter === undefined ? undefined : { 'Retry-After': throttle.retryAfter },
      );
    }
    if ((state.upstreamFail[id] ?? 0) > 0) {
      state.upstreamFail[id]!--;
      return fail(502, {
        status: 'error',
        type: 'upstream_error',
        message: 'The upstream service returned an error.',
      });
    }
    const override = state.errors[id];
    const forced = typeof override === 'function' ? override(req) : override;
    if (forced) return forced;

    const values = route.pattern.exec(req.path)!.slice(1).map(decodeURIComponent);
    const params = Object.fromEntries(route.params.map((name, i) => [name, values[i]!]));
    if (!exists(params)) return fail(404, NOT_FOUND);
    const errors = validate(route, req, spec);
    const first = Object.values(errors)[0];
    if (first) return fail(422, { status: 'error', type: 'validation_failed', message: first[0], errors });

    const handler = handlers[id];
    const success = Object.keys(route.op.responses).find((code) => code.startsWith('2')) ?? '200';
    if (!handler) return { status: Number(success), body: documentedExample(route, success) };
    const result = handler(req, params);
    const isAnswer = (value: unknown): value is MockAnswer =>
      !!value && typeof value === 'object' && 'body' in value && !Array.isArray(value);
    if (isAnswer(result)) {
      if (id in state.payloads && (result.status ?? 200) < 300) {
        return { ...result, body: { status: 'success', data: state.payloads[id] } };
      }
      return result;
    }
    const data = id in state.payloads ? state.payloads[id] : result;
    return { status: Number(success), body: { status: 'success', data } };
  };

  const mock = await startMockServer(answer);

  const defaultTokens = { ...tokens };
  return {
    url: mock.url,
    requests: mock.requests,
    state,
    tokens,
    close: mock.close,
    /** Back to the initial account: products, tokens, switches; recorded requests cleared. */
    reset() {
      Object.assign(state, initialState(options));
      for (const key of Object.keys(tokens)) delete tokens[key];
      Object.assign(tokens, defaultTokens);
      mock.requests.length = 0;
      operations.length = 0;
      nextBackup = 100;
    },
    /** Requests of one operation (spec operationId or endpoint table name). */
    calls(name: string): RecordedRequest[] {
      const id = name in FIRE24_ENDPOINTS ? op(name as Fire24EndpointName) : name;
      return mock.requests.filter((_, i) => operations[i] === id);
    },
  };
}
