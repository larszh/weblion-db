import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Fire24Adapter } from '../src/providers/fire24/adapter';
import { FIRE24_ENDPOINTS } from '../src/providers/fire24/endpoints';
import {
  aggregateTraffic,
  parseBackupTask,
  parseConfig,
  parseMonth,
  parseServices,
  parseStatus,
  parseTrafficCurrent,
  parseTrafficLog,
  parseWebspace,
} from '../src/providers/fire24/parse';
import { AppError, ProviderError } from '../src/lib/errors';
import { startMockServer, type RecordedRequest } from './mock-server';

const KVM_ID = '5ba90171-438b-49da-9774-367b66402183';
const DOMAIN_ID = 'e5d987ce-595-4dc8-c248-nfr42456';
const WEBSPACE_ID = '95063484-953c-43db-8f44-3ace485198e4';
const AUTHCODE = 'X24+FkIeRnE5AhPrI';
const PLESK_PASSWORD = 'pl3sk-Secret!';
const ref = { externalId: KVM_ID, kind: 'vm' as const, node: null, meta: {} };

const ok = (data: unknown) => ({ body: { status: 'success', message: 'ok', data } });

/** Mutable state of the simulated 24fire account. */
const account = {
  plus: true,
  dns: [] as { record_id: number; type: string; name: string; data: string; ttl: number }[],
  backupPolls: 0,
};

function resetAccount() {
  account.plus = true;
  account.backupPolls = 0;
  account.dns = [
    { record_id: 7498384, type: 'A', name: '*', data: '192.168.100.30', ttl: 300 },
    { record_id: 7498387, type: 'TXT', name: 'fire', data: 'https://google.com', ttl: 300 },
  ];
}

const PLUS_PATHS = [
  /\/dns\/(add|edit|remove)$/,
  /\/backup\/(create|restore|delete)/,
  /\/monitoring\//,
  /\/ddos\/change$/,
  /\/traffic\/chart$/,
];

function route(req: RecordedRequest) {
  const p = req.path;
  const m = req.method;
  if (!account.plus && PLUS_PATHS.some((re) => re.test(p))) {
    return { status: 403, body: { status: 'error', message: 'not available', data: null } };
  }
  if (p === '/api/account') {
    return ok({
      id: 1,
      firstname: 'Lars',
      lastname: 'Kiefer',
      email: 'l.kiefer@24fire-gmbh.de',
      balance: 240.42,
      is_plus_user: account.plus,
      registry_date: '2022-02-26T17:33:52.000Z',
    });
  }
  if (p === '/api/account/services') {
    return ok({
      services: {
        WEBSPACE: [
          {
            internal_id: WEBSPACE_ID,
            name: 'Plesk-Medium',
            accounting: {
              buy_date: '2023-03-05T17:40:03.000Z',
              buy_price: 3.5,
              renew_date: '2025-01-30T00:00:00.000Z',
              renew_price: 3.5,
              renew_interval: 30,
              auto_renew: false,
            },
            username: 'katherine5732',
            email: 'l.kiefer@24fire-gmbh.de',
          },
        ],
        KVM: [{ internal_id: KVM_ID, name: 'EPYC 01', accounting: { renew_interval: 30 } }],
        DOMAIN: [
          {
            internal_id: DOMAIN_ID,
            name: '24fire.de',
            accounting: { renew_date: '2025-03-14T00:30:49.000Z', renew_interval: 365, auto_renew: true },
            target: '24fire.de',
          },
        ],
      },
    });
  }
  if (p === `/api/kvm/${KVM_ID}/config`) {
    return ok({
      identifier: 30075,
      hostsystem: {
        datacenter: { name: 'DC', city: 'Frankfurt', country: 'Deutschland' },
        name: 'de_xeon',
        node: 'XEON 04',
      },
      config: {
        cores: 4,
        mem: 8192,
        disk: 80,
        os: { name: 'debian_12', displayname: 'Debian 12' },
        iso: { name: 'proxmox_8', displayname: 'Proxmox 8', attached: false },
        username: 'root',
        password: 'topsecret',
        hostname: 'shop-01',
        network_speed: 2000,
        backup_slots: 2,
        ipv4: [
          {
            ip_address: '88.151.1.2',
            ip_gateway: '88.151.1.1',
            ddos_protection: 'combahton',
            rdns: 'shop.example.ch',
          },
        ],
        ipv6: [{ ip_address: '2a12:8641::2', ip_gateway: '2a12:8641::1' }],
        monitoring: { enabled: true, port: 22 },
      },
      max_config: { cores: 12, mem: 65536, disk: 300, network_speed: 3000, backup_slots: 10, ipv4: 6 },
      abuse_status: 'CLEAN',
    });
  }
  if (p === `/api/kvm/${KVM_ID}/status`) {
    return ok({
      status: 'running',
      uptime: 545,
      task: null,
      usage: {
        cpu: { data: '12.5', unit: '%' },
        mem: { data: '2.5', unit: 'GB' },
        nvme_storage: { data: 1.7, unit: 'GB' },
      },
    });
  }
  if (p === `/api/kvm/${KVM_ID}/power` && m === 'POST') return ok(null);
  if (p === `/api/kvm/${KVM_ID}/monitoring/timings`) {
    const now = Date.now();
    return ok({
      timings: [
        { date: new Date(now - 600_000).toISOString(), cpu: '0.481', mem: '1.5', ping: 19 },
        { date: new Date(now - 90 * 86_400_000).toISOString(), cpu: '1', mem: '1', ping: 20 },
      ],
    });
  }
  if (p === `/api/kvm/${KVM_ID}/monitoring/incidences`) {
    return ok({
      statistic: {
        LAST_7_DAYS: { downtime: 0, availability: 100, incidences: 0 },
        LAST_24_HOURS: { downtime: 2, availability: 99.8, incidences: 1, longest_incidence: 2 },
      },
      incidences: [{ start: '2024-01-16T13:46:02.000Z', end: null, downtime: 11, type: 'PING_TIMEOUT' }],
    });
  }
  if (p === `/api/kvm/${KVM_ID}/backup/list` && m === 'GET') {
    return ok([
      {
        backup_id: 'b1',
        backup_os: 'debian_12',
        backup_description: 'nightly',
        size: 2200,
        created: '2024-01-25T14:02:14.000Z',
        status: 'finished',
      },
      {
        backup_id: 'b3',
        backup_os: 'debian_12',
        backup_description: '',
        size: 0,
        created: '2024-01-26T14:02:14.000Z',
        status: 'pending',
      },
    ]);
  }
  if (p === `/api/kvm/${KVM_ID}/backup/create` && m === 'POST') return ok({ backup_id: 'b2' });
  if (p === `/api/kvm/${KVM_ID}/backup/create/status` && m === 'POST') {
    if (req.form.get('backup_id') !== 'b2')
      return { status: 404, body: { status: 'error', message: 'nope' } };
    account.backupPolls += 1;
    return account.backupPolls < 2
      ? ok({ status: 'pending', progress: { percentage: 14, data_stored: 1.4, total_data: 10 } })
      : ok({ status: 'finished', progress: null });
  }
  if (p === `/api/kvm/${KVM_ID}/backup/restore` && m === 'POST') {
    return ok({ backup_id: req.form.get('backup_id') });
  }
  if (p === `/api/kvm/${KVM_ID}/backup/restore/status` && m === 'POST') {
    return ok({ status: 'finished', progress: { percentage: 100 } });
  }
  if (p === `/api/kvm/${KVM_ID}/backup/delete` && m === 'DELETE') return ok(null);
  if (p === `/api/kvm/${KVM_ID}/traffic/current`) {
    return ok({
      month: 'JULE',
      usage: { total: 7.12, in: 6.53, out: 0.59 },
      limit: { monthly: 1000, additional: 500, remaining: 1492.88, vm_status: 'throttled' },
    });
  }
  if (p === `/api/kvm/${KVM_ID}/traffic/log`) {
    return ok({
      month: 'JULE',
      log: [
        { date: '2024-05-31T22:01:11.285Z', in: 1.5, out: 0.5 },
        { date: '2024-05-31T22:11:05.564Z', in: 2, out: 0.25 },
        { date: '2024-05-31T23:01:01.216Z', in: 4, out: 1 },
      ],
    });
  }
  if (p === `/api/kvm/${KVM_ID}/ddos` && m === 'GET') {
    return ok({
      '88.151.1.2': { layer4: 'dynamic', layer7: 'off' },
      '88.151.1.3': { layer4: 'permanent', layer7: 'off' },
    });
  }
  if (p === `/api/kvm/${KVM_ID}/ddos/change` && m === 'POST') {
    return ok({ [req.form.get('ip_address') ?? '']: { layer4: 'permanent', layer7: 'on' } });
  }
  if (p === `/api/domain/${DOMAIN_ID}` && m === 'GET') {
    return ok({
      domain: {
        name: '24fire.de',
        sld: '24fire',
        tld: 'de',
        authcode: AUTHCODE,
        status: 'LOCK',
        terminated: false,
      },
      handle: { ownerC: 'FIRE24XX', adminC: 'FIRE24XX', techC: 'FIRE24XX', zoneC: 'FIRE24XX' },
      nameserver: { ns1: 'ns1.fireapi.de', ns2: 'ns2.fireapi.de', ns3: null, ns4: null, ns5: null },
      timings: { create: '2023-03-14 15:53:44', expire: '2024-03-14 15:53:44' },
    });
  }
  if (p === `/api/domain/${DOMAIN_ID}/dns` && m === 'GET') return ok(account.dns);
  if (p === `/api/domain/${DOMAIN_ID}/dns/add` && m === 'PUT') {
    const id = Math.max(...account.dns.map((r) => r.record_id)) + 1;
    account.dns.push({
      record_id: id,
      type: req.form.get('type')!,
      name: req.form.get('name')!,
      data: req.form.get('data')!,
      ttl: 300,
    });
    return ok(null);
  }
  if (p === `/api/domain/${DOMAIN_ID}/dns/edit` && m === 'POST') {
    const record = account.dns.find((r) => String(r.record_id) === req.form.get('record_id'));
    if (!record) return { status: 400, body: { status: 'error', message: 'record not found' } };
    for (const key of ['type', 'name', 'data'] as const) {
      const value = req.form.get(key);
      if (value !== null) record[key] = value;
    }
    return ok(null);
  }
  if (p === `/api/domain/${DOMAIN_ID}/dns/remove` && m === 'DELETE') {
    account.dns = account.dns.filter((r) => String(r.record_id) !== req.form.get('record_id'));
    return ok(null);
  }
  if (p === `/api/webspace/${WEBSPACE_ID}`) {
    return ok({
      accounting: {
        buy_date: '2023-04-04T00:17:33.000Z',
        buy_price: 1.35,
        renew_date: '2025-01-30T00:00:00.000Z',
        renew_price: 1.5,
        renew_interval: 30,
        auto_renew: false,
      },
      resources: {
        domains: 1,
        subdomains: 5,
        emails: 3,
        databases: 3,
        ssd_storage: 5,
        traffic: 500,
        memory_limit: 128,
        ip_address: '45.84.196.164',
      },
      access: {
        host: 'plesk.24fire.de:8443',
        email: 'l.kiefer@24fire-gmbh.de',
        username: 'katherine5732',
        password: PLESK_PASSWORD,
      },
    });
  }
  return undefined;
}

let mock: Awaited<ReturnType<typeof startMockServer>>;
let adapter: Fire24Adapter;

beforeAll(async () => {
  mock = await startMockServer((req) => {
    if (req.headers['x-fire-apikey'] !== 'test-key')
      return { status: 401, body: { status: 'error', message: 'bad key' } };
    return route(req);
  });
});

beforeEach(() => {
  resetAccount();
  // A fresh adapter per test: account facts are cached per instance.
  adapter = new Fire24Adapter({ apiKey: 'test-key', baseUrl: mock.url });
});

afterAll(async () => {
  await mock.close();
});

const lastRequest = (suffix: string) => mock.requests.findLast((r) => r.path.endsWith(suffix))!;

describe('24fire endpoints', () => {
  it('lists every documented endpoint as verified', () => {
    const endpoints = Object.values(FIRE24_ENDPOINTS);
    expect(endpoints).toHaveLength(26);
    expect(endpoints.every((e) => e.verified)).toBe(true);
  });

  it('marks exactly the documented 24fire+ endpoints', () => {
    const plus = Object.entries(FIRE24_ENDPOINTS)
      .filter(([, e]) => 'plus' in e && e.plus)
      .map(([, e]) => `${e.method} ${e.path}`)
      .sort();
    expect(plus).toEqual(
      [
        'PUT /api/domain/{id}/dns/add',
        'POST /api/domain/{id}/dns/edit',
        'DELETE /api/domain/{id}/dns/remove',
        'POST /api/kvm/{id}/backup/create',
        'POST /api/kvm/{id}/backup/create/status',
        'POST /api/kvm/{id}/backup/restore',
        'POST /api/kvm/{id}/backup/restore/status',
        'DELETE /api/kvm/{id}/backup/delete',
        'POST /api/kvm/{id}/traffic/chart',
        'GET /api/kvm/{id}/monitoring/timings',
        'GET /api/kvm/{id}/monitoring/incidences',
        'POST /api/kvm/{id}/ddos/change',
      ].sort(),
    );
    expect(FIRE24_ENDPOINTS.kvmBackupList).not.toHaveProperty('plus');
  });
});

describe('24fire adapter: servers', () => {
  it('lists KVM servers from the account services', async () => {
    const servers = await adapter.listServers();
    expect(servers).toHaveLength(1);
    const s = servers[0]!;
    expect(s).toMatchObject({
      externalId: KVM_ID,
      name: 'shop-01',
      status: 'running',
      os: 'Debian 12',
      specs: { cores: 4, memoryMb: 8192, diskGb: 80, networkMbit: 2000, backupSlots: 2 },
      node: 'XEON 04',
    });
    expect(s.ips.map((i) => i.address)).toEqual(['88.151.1.2', '2a12:8641::2']);
    expect(s.ips[0]!.rdns).toBe('shop.example.ch');
    expect(s.usage?.memoryUsedMb).toBe(2560);
    expect(s.meta).toMatchObject({
      abuseStatus: 'CLEAN',
      iso: null,
      maxConfig: { cores: 12, memoryMb: 65536, ipv4: 6 },
      monitoring: { enabled: true, port: 22 },
    });
    // Domains and web spaces must not be asked for a KVM config.
    expect(mock.requests.some((r) => r.path.includes(`/kvm/${DOMAIN_ID}`))).toBe(false);
    expect(mock.requests.some((r) => r.path.includes(`/kvm/${WEBSPACE_ID}`))).toBe(false);
  });

  it('sends power commands as form data', async () => {
    await adapter.power(ref, 'reboot');
    const req = lastRequest('/power');
    expect(req.method).toBe('POST');
    expect(req.form.get('mode')).toBe('restart');
    expect(req.headers['content-type']).toContain('application/x-www-form-urlencoded');
  });

  it('rejects power actions 24fire does not offer', async () => {
    await expect(adapter.power(ref, 'suspend')).rejects.toThrow(/does not support/);
  });

  it('filters monitoring timings by range and converts units', async () => {
    const metrics = await adapter.getMetrics(ref, 'day');
    expect(metrics.points).toHaveLength(1);
    expect(metrics.points[0]).toMatchObject({ cpu: 0.481, ping: 19, memUsed: 1.5 * 1024 ** 3 });
  });

  it('orders monitoring periods and keeps ongoing incidents', async () => {
    const info = await adapter.getMonitoring(ref);
    expect(info.periods.map((p) => p.key)).toEqual(['LAST_24_HOURS', 'LAST_7_DAYS']);
    expect(info.periods[0]!.longestIncidenceMinutes).toBe(2);
    expect(info.incidents[0]).toMatchObject({ type: 'PING_TIMEOUT', downtimeMinutes: 11, end: null });
  });

  it('reads traffic in GB, the limits and the 10 minute log', async () => {
    const traffic = await adapter.getTraffic(ref);
    expect(traffic.inBytes).toBe(Math.round(6.53 * 1024 ** 3));
    expect(traffic.outBytes).toBe(Math.round(0.59 * 1024 ** 3));
    expect(traffic.totalBytes).toBe(Math.round(7.12 * 1024 ** 3));
    expect(traffic.limitBytes).toBe(1500 * 1024 ** 3);
    expect(traffic.remainingBytes).toBe(Math.round(1492.88 * 1024 ** 3));
    expect(traffic.throttled).toBe(true);
    // Two samples in the 22:00 hour are summed, values are MB and not cumulative.
    expect(traffic.log).toEqual([
      { t: Date.parse('2024-05-31T22:00:00Z') / 1000, inBytes: 3.5 * 1024 ** 2, outBytes: 0.75 * 1024 ** 2 },
      { t: Date.parse('2024-05-31T23:00:00Z') / 1000, inBytes: 4 * 1024 ** 2, outBytes: 1 * 1024 ** 2 },
    ]);
  });

  it('reads and changes the DDoS protection per IPv4 address', async () => {
    expect(await adapter.getDdos(ref)).toEqual([
      { ip: '88.151.1.2', layer4: 'dynamic', layer7: 'off' },
      { ip: '88.151.1.3', layer4: 'permanent', layer7: 'off' },
    ]);
    await adapter.setDdos(ref, { ip: '88.151.1.2', layer4: 'permanent', layer7: 'on' });
    const req = lastRequest('/ddos/change');
    expect(req.method).toBe('POST');
    expect(Object.fromEntries(req.form)).toEqual({
      layer4: 'permanent',
      layer7: 'on',
      ip_address: '88.151.1.2',
    });
    await expect(adapter.setDdos(ref, { ip: '88.151.1.2', layer4: 'always' })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('redacts passwords from the raw config and auth codes from the explorer', async () => {
    const config = await adapter.getConfig(ref);
    expect(JSON.stringify(config)).not.toContain('topsecret');
    const raw = await adapter.rawRequest('GET', `/api/domain/${DOMAIN_ID}`);
    expect(JSON.stringify(raw)).not.toContain(AUTHCODE);
  });
});

describe('24fire adapter: backups', () => {
  it('lists backups and reports pending ones as running', async () => {
    const backups = await adapter.listBackups(ref);
    expect(backups[0]).toMatchObject({ id: 'b1', description: 'nightly', sizeBytes: 2200 * 1024 * 1024 });
    expect(backups[1]!.status).toBe('running');
  });

  it('creates backups with POST and tracks the progress', async () => {
    const created = await adapter.createBackup(ref, { description: 'vor Update' });
    const req = lastRequest('/backup/create');
    expect(req.method).toBe('POST');
    expect(req.form.get('description')).toBe('vor Update');
    expect(created.providerRef).toBe('backup-create:b2');

    const running = await adapter.getTaskStatus(ref, created.providerRef!);
    expect(running).toMatchObject({
      status: 'running',
      type: 'backup.create',
      message: '14 % (1.4 of 10 GB)',
    });
    expect(lastRequest('/backup/create/status').form.get('backup_id')).toBe('b2');
    const done = await adapter.getTaskStatus(ref, created.providerRef!);
    expect(done).toMatchObject({ status: 'ok' });
    expect(done!.endedAt).toBeTruthy();
  });

  it('validates backup descriptions before calling 24fire', async () => {
    const before = mock.requests.length;
    await expect(adapter.createBackup(ref, { description: 'Backup 2024' })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mock.requests.slice(before).some((r) => r.path.endsWith('/backup/create'))).toBe(false);
  });

  it('restores and deletes backups', async () => {
    const restored = await adapter.restoreBackup(ref, 'b1');
    expect(restored.providerRef).toBe('backup-restore:b1');
    expect(await adapter.getTaskStatus(ref, restored.providerRef!)).toMatchObject({
      status: 'ok',
      type: 'backup.restore',
    });
    expect(lastRequest('/backup/restore/status').form.get('backup_id')).toBe('b1');

    await adapter.deleteBackup(ref, 'b1');
    const del = lastRequest('/backup/delete');
    expect(del.method).toBe('DELETE');
    expect(del.form.get('backup_id')).toBe('b1');
    expect(await adapter.getTaskStatus(ref, 'UPID:something')).toBeNull();
  });
});

describe('24fire adapter: account and 24fire+', () => {
  it('tests the connection with the account endpoint', async () => {
    const info = await adapter.testConnection();
    expect(info).toMatchObject({
      account: 'Lars Kiefer',
      plus: true,
      balance: 240.42,
      kvm: 1,
      domains: 1,
      webspaces: 1,
    });
    expect(mock.requests.some((r) => r.path === '/api/account')).toBe(true);
  });

  it('shows balance and 24fire+ in the overview', async () => {
    const overview = await adapter.overview();
    const facts = Object.fromEntries(overview.facts.map((f) => [f.label, f.value]));
    expect(facts).toMatchObject({
      Account: 'Lars Kiefer',
      Balance: '240.42 EUR',
      '24fire+': 'active',
      KVM: '1',
      Domains: '1',
      'Web spaces': '1',
    });
  });

  it('explains missing 24fire+ instead of calling the endpoint', async () => {
    account.plus = false;
    const before = mock.requests.length;
    const err = await adapter.createBackup(ref, {}).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ statusCode: 422, code: 'plus_required' });
    expect(err.message).toMatch(/24fire\+/);
    expect(mock.requests.slice(before).some((r) => r.path.endsWith('/backup/create'))).toBe(false);

    expect(await adapter.dnsWritable()).toBe(false);
    expect(adapter.capabilities()).not.toContain('metrics');
    expect(adapter.capabilities()).toContain('backups');
    // Endpoints without 24fire+ keep working.
    expect(await adapter.listBackups(ref)).toHaveLength(2);
  });

  it('turns HTTP errors into provider errors with hints', async () => {
    const bad = new Fire24Adapter({ apiKey: 'wrong', baseUrl: mock.url });
    await expect(bad.testConnection()).rejects.toThrow(/API key rejected/);
    const err = await adapter.getDomain('unknown-domain').catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.statusCode).toBe(404);
  });
});

describe('24fire adapter: domains and DNS', () => {
  it('lists domains without the auth code', async () => {
    const domains = await adapter.listDomains();
    expect(domains).toHaveLength(1);
    expect(domains[0]).toMatchObject({
      externalId: DOMAIN_ID,
      name: '24fire.de',
      status: 'LOCK',
      info: {
        name: '24fire.de',
        status: 'LOCK',
        terminated: false,
        nameservers: ['ns1.fireapi.de', 'ns2.fireapi.de'],
        handle: 'FIRE24XX',
        createdAt: '2023-03-14T15:53:44',
        expiresAt: '2024-03-14T15:53:44',
        autoRenew: true,
      },
      meta: { target: '24fire.de' },
    });
    expect(JSON.stringify(domains)).not.toContain(AUTHCODE);
    expect(JSON.stringify(await adapter.getDomain(DOMAIN_ID))).not.toContain(AUTHCODE);
    expect(await adapter.getDomainAuthcode(DOMAIN_ID)).toBe(AUTHCODE);
  });

  it('reads, adds, edits and removes DNS records', async () => {
    const records = await adapter.listDnsRecords(DOMAIN_ID);
    expect(records[0]).toEqual({ id: '7498384', type: 'A', name: '*', data: '192.168.100.30', ttl: 300 });

    const added = await adapter.addDnsRecord(DOMAIN_ID, { type: 'A', name: 'hello', data: '192.168.100.39' });
    const add = lastRequest('/dns/add');
    expect(add.method).toBe('PUT');
    expect(Object.fromEntries(add.form)).toEqual({ type: 'A', name: 'hello', data: '192.168.100.39' });
    expect(added).toEqual({ id: '7498388', type: 'A', name: 'hello', data: '192.168.100.39', ttl: 300 });

    const edited = await adapter.updateDnsRecord(DOMAIN_ID, '7498388', { data: '192.168.100.40' });
    const edit = lastRequest('/dns/edit');
    expect(edit.method).toBe('POST');
    expect(Object.fromEntries(edit.form)).toEqual({ record_id: '7498388', data: '192.168.100.40' });
    expect(edited?.data).toBe('192.168.100.40');

    await adapter.deleteDnsRecord(DOMAIN_ID, '7498388');
    const remove = lastRequest('/dns/remove');
    expect(remove.method).toBe('DELETE');
    expect(remove.form.get('record_id')).toBe('7498388');
    expect((await adapter.listDnsRecords(DOMAIN_ID)).map((r) => r.id)).toEqual(['7498384', '7498387']);
  });

  it('allows DNS changes only with 24fire+', async () => {
    expect(await adapter.dnsWritable()).toBe(true);
    account.plus = false;
    const fresh = new Fire24Adapter({ apiKey: 'test-key', baseUrl: mock.url });
    await expect(
      fresh.addDnsRecord(DOMAIN_ID, { type: 'TXT', name: '@', data: 'hello' }),
    ).rejects.toMatchObject({ code: 'plus_required' });
  });
});

describe('24fire adapter: web spaces', () => {
  it('lists web spaces without the password', async () => {
    const webspaces = await adapter.listWebspaces();
    expect(webspaces).toHaveLength(1);
    expect(webspaces[0]).toMatchObject({
      externalId: WEBSPACE_ID,
      name: 'Plesk-Medium (katherine5732)',
      info: {
        resources: {
          domains: 1,
          subdomains: 5,
          emails: 3,
          databases: 3,
          storageMb: 5 * 1024,
          trafficGb: 500,
          memoryLimitMb: 128,
          ipAddress: '45.84.196.164',
        },
        panelUrl: 'https://plesk.24fire.de:8443',
        username: 'katherine5732',
        expiresAt: '2025-01-30T00:00:00.000Z',
      },
    });
    expect(JSON.stringify(webspaces)).not.toContain(PLESK_PASSWORD);
    expect((await adapter.getWebspace(WEBSPACE_ID)).name).toBe('Plesk-Medium (katherine5732)');
  });

  it('returns the credentials only from the dedicated call', async () => {
    expect(await adapter.getWebspaceCredentials(WEBSPACE_ID)).toEqual({
      panelUrl: 'https://plesk.24fire.de:8443',
      username: 'katherine5732',
      password: PLESK_PASSWORD,
      email: 'l.kiefer@24fire-gmbh.de',
    });
  });
});

describe('24fire parsers', () => {
  it('handles flat service lists with a type field', () => {
    const services = parseServices([
      { internal_id: 'a', type: 'KVM', name: 'one' },
      { internal_id: 'b', type: 'DOMAIN', name: 'two.ch' },
    ]);
    expect(services.map((s) => [s.internalId, s.type])).toEqual([
      ['a', 'kvm'],
      ['b', 'domain'],
    ]);
  });

  it('parses month names tolerantly', () => {
    expect(parseMonth('MAI')).toBe(5);
    expect(parseMonth('MAY')).toBe(5);
    expect(parseMonth('JULE')).toBe(7);
    expect(parseMonth('july')).toBe(7);
    expect(parseMonth('Juni')).toBe(6);
    expect(parseMonth('DECEMBER')).toBe(12);
    expect(parseMonth('SOMETHING')).toBeNull();
  });

  it('derives the traffic period from the month', () => {
    const traffic = parseTrafficCurrent({ month: 'DECEMBER', usage: {}, limit: {} }, new Date('2026-01-05'));
    expect(traffic.periodStart).toBe('2025-12-01T00:00:00.000Z');
    expect(traffic.periodEnd).toBe('2026-01-01T00:00:00.000Z');
    expect(traffic.limitBytes).toBeNull();
    expect(traffic.throttled).toBeNull();
  });

  it('keeps traffic log samples separate until aggregated', () => {
    const log = parseTrafficLog({ log: [{ date: '2024-06-01T00:00:00Z', in: 1, out: 2 }] });
    expect(log).toEqual([
      { t: Date.parse('2024-06-01T00:00:00Z') / 1000, inBytes: 1024 ** 2, outBytes: 2 * 1024 ** 2 },
    ]);
    expect(aggregateTraffic(log, 86_400)).toEqual(log);
  });

  it('maps running tasks onto the server status', () => {
    expect(parseStatus({ status: 'running', task: 'BACKUP_CREATE' }).status).toBe('backup');
    expect(parseStatus({ status: 'running', task: 'BACKUP_RESTORE' }).status).toBe('restoring');
    expect(parseStatus({ status: 'running', task: 'BOOTING' }).status).toBe('starting');
    expect(parseStatus({ status: 'running', task: 'HDD_MOUNT' }).status).toBe('running');
    expect(parseStatus({ status: 'stopped', task: null }).status).toBe('stopped');
  });

  it('reads the attached ISO only when it is attached', () => {
    expect(parseConfig({ config: { iso: { name: 'x', displayname: 'X', attached: true } } }).iso).toBe('X');
    expect(parseConfig({ config: { iso: { name: 'x', attached: false } } }).iso).toBeNull();
  });

  it('reads backup task progress', () => {
    expect(
      parseBackupTask({ status: 'pending', progress: { percentage: 40 } }, 'r', 'backup.restore'),
    ).toMatchObject({
      status: 'running',
      message: '40 %',
    });
    expect(parseBackupTask({ status: 'finished', progress: null }, 'r', 'backup.create').status).toBe('ok');
  });

  it('treats masked web space passwords as unknown', () => {
    const { credentials } = parseWebspace({ access: { username: 'u', password: '***********' } });
    expect(credentials.password).toBeNull();
  });
});
