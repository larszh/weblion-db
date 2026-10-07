import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Fire24Adapter } from '../src/providers/fire24/adapter';
import { parseServices } from '../src/providers/fire24/parse';
import { ProviderError } from '../src/lib/errors';
import { startMockServer } from './mock-server';

const KVM_ID = '5ba90171-438b-49da-9774-367b66402183';
const ref = { externalId: KVM_ID, kind: 'vm' as const, node: null, meta: {} };

const ok = (data: unknown) => ({ body: { status: 'success', requestID: 'r1', message: 'ok', data } });

let mock: Awaited<ReturnType<typeof startMockServer>>;
let adapter: Fire24Adapter;

beforeAll(async () => {
  mock = await startMockServer((req) => {
    if (req.headers['x-fire-apikey'] !== 'test-key')
      return { status: 401, body: { status: 'error', message: 'bad key' } };
    const p = req.path;
    if (p === '/api/account/services') {
      return ok({
        kvm: [{ internal_id: KVM_ID, hostname: 'shop-01' }],
        domain: [{ internal_id: 'd-1', name: 'example.ch' }],
      });
    }
    if (p === `/api/kvm/${KVM_ID}/config`) {
      return ok({
        hostsystem: {
          datacenter: { name: 'DC', city: 'Frankfurt', country: 'Deutschland' },
          node: 'XEON 04',
        },
        config: {
          cores: 4,
          mem: 8192,
          disk: 80,
          os: { name: 'debian_12', displayname: 'Debian 12' },
          hostname: 'shop-01',
          password: 'topsecret',
          network_speed: 2000,
          backup_slots: 2,
          ipv4: [
            {
              ip_address: '88.151.1.2',
              ip_gateway: '88.151.1.1',
              ddos_protection: 'arbor',
              rdns: 'shop.example.ch',
            },
          ],
          ipv6: [{ ip_address: '2a12:8641::2', ip_gateway: '2a12:8641::1' }],
        },
      });
    }
    if (p === `/api/kvm/${KVM_ID}/status`) {
      return ok({
        status: 'running',
        uptime: 545,
        usage: { cpu: { data: '12.5', unit: '%' }, mem: { data: '2.5', unit: 'GB' } },
      });
    }
    if (p === `/api/kvm/${KVM_ID}/power` && req.method === 'POST') return ok([]);
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
          LAST_24_HOURS: { downtime: 2, availability: 99.8, incidences: 1 },
        },
        incidences: [
          {
            start: '2024-01-16T13:46:02.000Z',
            end: '2024-01-17T13:08:01.000Z',
            downtime: 1402,
            type: 'PING_TIMEOUT',
          },
        ],
      });
    }
    if (p === `/api/kvm/${KVM_ID}/backup/list`) {
      return ok([
        {
          backup_id: 'b1',
          backup_os: 'debian_12',
          backup_description: 'nightly',
          size: 2200,
          created: '2024-01-25T14:02:14.000Z',
          status: 'finished',
        },
      ]);
    }
    if (p === `/api/kvm/${KVM_ID}/backup/create` && req.method === 'PUT') return ok({ backup_id: 'b2' });
    return undefined;
  });
  adapter = new Fire24Adapter({ apiKey: 'test-key', baseUrl: mock.url });
});

afterAll(async () => {
  await mock.close();
});

describe('24fire adapter', () => {
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
    // The domain must not show up as a server.
    expect(mock.requests.some((r) => r.path.includes('d-1'))).toBe(false);
  });

  it('sends power commands as form data', async () => {
    await adapter.power(ref, 'reboot');
    const req = mock.requests.findLast((r) => r.path.endsWith('/power'))!;
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

  it('orders monitoring periods', async () => {
    const info = await adapter.getMonitoring(ref);
    expect(info.periods.map((p) => p.key)).toEqual(['LAST_24_HOURS', 'LAST_7_DAYS']);
    expect(info.incidents[0]).toMatchObject({ type: 'PING_TIMEOUT', downtimeMinutes: 1402 });
  });

  it('lists and creates backups', async () => {
    const backups = await adapter.listBackups(ref);
    expect(backups[0]).toMatchObject({ id: 'b1', description: 'nightly', sizeBytes: 2200 * 1024 * 1024 });
    const created = await adapter.createBackup(ref, { description: 'manual' });
    expect(created.providerRef).toBe('b2');
  });

  it('redacts passwords from the raw config', async () => {
    const config = await adapter.getConfig(ref);
    expect(JSON.stringify(config)).not.toContain('topsecret');
  });

  it('turns HTTP errors into provider errors with hints', async () => {
    const bad = new Fire24Adapter({ apiKey: 'wrong', baseUrl: mock.url });
    await expect(bad.testConnection()).rejects.toThrow(/API key rejected/);
    const err = await adapter.restoreBackup(ref, 'b1').catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toMatch(/not verified against the 24fire docs/);
  });
});

describe('parseServices', () => {
  it('handles flat lists with a type field', () => {
    const services = parseServices([
      { internal_id: 'a', type: 'KVM', name: 'one' },
      { internal_id: 'b', type: 'DOMAIN', name: 'two.ch' },
    ]);
    expect(services.map((s) => [s.internalId, s.type])).toEqual([
      ['a', 'kvm'],
      ['b', 'domain'],
    ]);
  });
});
