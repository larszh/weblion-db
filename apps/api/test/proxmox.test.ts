import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProxmoxAdapter } from '../src/providers/proxmox/adapter';
import { ipsFromConfig, mapStatus, parsePropertyString, primaryDisk } from '../src/providers/proxmox/parse';
import { startMockServer } from './mock-server';

const UPID = 'UPID:pve01:000ABC:0001:66AA:qmstart:100:root@pam!weblion-db:';
const data = (d: unknown) => ({ body: { data: d } });

let mock: Awaited<ReturnType<typeof startMockServer>>;
let adapter: ProxmoxAdapter;
const ref = { externalId: 'qemu/100', kind: 'vm' as const, node: 'pve01', meta: {} };

beforeAll(async () => {
  mock = await startMockServer((req) => {
    if (req.headers.authorization !== 'PVEAPIToken=root@pam!weblion-db=secret-uuid') {
      return { status: 401, statusText: 'authentication failure', body: { data: null } };
    }
    const p = req.path.replace('/api2/json', '');
    if (p === '/version') return data({ version: '8.2.4' });
    if (p === '/nodes')
      return data([{ node: 'pve01', status: 'online', cpu: 0.1, maxcpu: 32, mem: 1, maxmem: 2, uptime: 9 }]);
    if (p === '/cluster/resources' && req.query.get('type') === 'vm') {
      return data([
        {
          id: 'qemu/100',
          type: 'qemu',
          vmid: 100,
          node: 'pve01',
          name: 'web',
          status: 'running',
          maxcpu: 4,
          cpu: 0.25,
          maxmem: 8 * 1024 ** 3,
          mem: 2 * 1024 ** 3,
          maxdisk: 1,
          uptime: 100,
          tags: 'prod;web',
        },
        {
          id: 'lxc/101',
          type: 'lxc',
          vmid: 101,
          node: 'pve01',
          name: 'dns',
          status: 'stopped',
          maxcpu: 1,
          maxmem: 512 * 1024 ** 2,
        },
        {
          id: 'qemu/9000',
          type: 'qemu',
          vmid: 9000,
          node: 'pve01',
          name: 'debian-tpl',
          status: 'stopped',
          template: 1,
        },
      ]);
    }
    if (p === '/nodes/pve01/qemu/100/config') {
      return data({
        name: 'web',
        agent: '1',
        ostype: 'l26',
        scsi0: 'local-zfs:vm-100-disk-0,size=32G',
        ide2: 'none,media=cdrom',
        boot: 'order=scsi0;ide2',
        ipconfig0: 'ip=10.0.0.5/24,gw=10.0.0.1',
      });
    }
    if (p === '/nodes/pve01/lxc/101/config')
      return data({
        hostname: 'dns',
        ostype: 'debian',
        rootfs: 'local:101/vm-101-disk-0.raw,size=8G',
        net0: 'name=eth0,bridge=vmbr0,ip=192.168.1.53/24,gw=192.168.1.1',
      });
    if (p === '/nodes/pve01/qemu/100/agent/network-get-interfaces') {
      return data({
        result: [
          { name: 'lo', 'ip-addresses': [{ 'ip-address': '127.0.0.1', 'ip-address-type': 'ipv4' }] },
          {
            name: 'eth0',
            'hardware-address': 'aa:bb',
            'ip-addresses': [
              { 'ip-address': '185.1.2.3', 'ip-address-type': 'ipv4' },
              { 'ip-address': 'fe80::1', 'ip-address-type': 'ipv6' },
            ],
          },
          { name: 'docker0', 'ip-addresses': [{ 'ip-address': '172.17.0.1', 'ip-address-type': 'ipv4' }] },
        ],
      });
    }
    if (p === '/nodes/pve01/qemu/100/agent/get-osinfo')
      return data({ result: { 'pretty-name': 'Debian GNU/Linux 12 (bookworm)' } });
    if (p === '/nodes/pve01/qemu/100/status/current')
      return data({ status: 'running', qmpstatus: 'running' });
    if (p === '/nodes/pve01/qemu/100/status/reboot' && req.method === 'POST') return data(UPID);
    if (p === '/nodes/pve01/qemu/100/rrddata') {
      return data([
        { time: 1000, cpu: 0.5, mem: 1, maxmem: 2, netin: 10, netout: 20, diskread: 1, diskwrite: 2 },
        { time: 1060, cpu: 0.25, mem: 1, maxmem: 2, netin: 10, netout: 20, diskread: 1, diskwrite: 2 },
      ]);
    }
    if (p === '/nodes/pve01/storage' && req.query.get('content') === 'backup')
      return data([{ storage: 'pbs' }, { storage: 'local' }]);
    if (p.startsWith('/nodes/pve01/storage/') && p.endsWith('/content')) {
      // The same shared backup shows up on both storages listings.
      return data([
        { volid: 'pbs:backup/vm/100/2024-01-01T00:00:00Z', ctime: 1704067200, size: 1024, notes: 'nightly' },
      ]);
    }
    if (p === '/nodes/pve01/vzdump' && req.method === 'POST')
      return data('UPID:pve01:1:2:3:vzdump:100:root@pam:');
    if (p === '/nodes/pve01/qemu/100/snapshot' && req.method === 'GET') {
      return data([
        { name: 'current' },
        { name: 'pre-update', snaptime: 1704067200, description: 'x', vmstate: 1 },
      ]);
    }
    if (p === '/nodes/pve01/qemu/100/resize' && req.method === 'PUT') return data(null);
    if (p === '/nodes/pve01/qemu/100/config' && req.method === 'PUT') return data(null);
    return undefined;
  });
  adapter = new ProxmoxAdapter({
    baseUrl: mock.url,
    tokenId: 'root@pam!weblion-db',
    tokenSecret: 'secret-uuid',
    verifyTls: true,
  });
});

afterAll(async () => {
  await mock.close();
});

describe('Proxmox adapter', () => {
  it('tests the connection', async () => {
    expect(await adapter.testConnection()).toEqual({ version: '8.2.4', nodes: 'pve01 (online)' });
  });

  it('reports a rejected token clearly', async () => {
    const bad = new ProxmoxAdapter({
      baseUrl: mock.url,
      tokenId: 'root@pam!x',
      tokenSecret: 'nope',
      verifyTls: true,
    });
    await expect(bad.testConnection()).rejects.toThrow(/token rejected/);
  });

  it('lists VMs and containers but not templates', async () => {
    const servers = await adapter.listServers();
    expect(servers.map((s) => s.externalId)).toEqual(['qemu/100', 'lxc/101']);
    const web = servers[0]!;
    expect(web).toMatchObject({
      name: 'web',
      kind: 'vm',
      status: 'running',
      os: 'Debian GNU/Linux 12 (bookworm)',
      specs: { cores: 4, memoryMb: 8192, diskGb: 32 },
      usage: { cpuPercent: 25, memoryUsedMb: 2048 },
    });
    // Public guest agent address first, cloud-init address kept, loopback/link-local/docker dropped.
    expect(web.ips.map((i) => i.address)).toEqual(['185.1.2.3', '10.0.0.5']);
    expect(web.meta?.tags).toEqual(['prod', 'web']);
    const dns = servers[1]!;
    expect(dns).toMatchObject({ kind: 'container', status: 'stopped', os: 'Debian', specs: { diskGb: 8 } });
    expect(dns.ips[0]?.address).toBe('192.168.1.53');
  });

  it('sends power actions to the right node', async () => {
    const result = await adapter.power(ref, 'reboot');
    expect(result.providerRef).toBe(UPID);
    expect(mock.requests.findLast((r) => r.path.endsWith('/status/reboot'))?.method).toBe('POST');
  });

  it('converts rrd data to percent', async () => {
    const metrics = await adapter.getMetrics(ref, 'hour');
    expect(metrics.points[0]).toMatchObject({ t: 1000, cpu: 50, netIn: 10, netOut: 20 });
    expect(metrics.resolutionSeconds).toBe(60);
    expect(mock.requests.findLast((r) => r.path.endsWith('/rrddata'))?.query.get('timeframe')).toBe('hour');
  });

  it('deduplicates backups across storages', async () => {
    const backups = await adapter.listBackups(ref);
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatchObject({ description: 'nightly', storage: 'pbs' });
  });

  it('creates backups with vzdump on the first backup storage', async () => {
    await adapter.createBackup(ref, { description: 'manual' });
    const req = mock.requests.findLast((r) => r.path.endsWith('/vzdump'))!;
    expect(req.form.get('vmid')).toBe('100');
    expect(req.form.get('storage')).toBe('pbs');
    expect(req.form.get('mode')).toBe('snapshot');
  });

  it('hides the "current" pseudo snapshot', async () => {
    const snaps = await adapter.listSnapshots(ref);
    expect(snaps.map((s) => s.id)).toEqual(['pre-update']);
    expect(snaps[0]!.includesRam).toBe(true);
  });

  it('only grows disks', async () => {
    await expect(adapter.rescale(ref, { diskGb: 16 })).rejects.toThrow(/only grow/);
    await adapter.rescale(ref, { cores: 8, diskGb: 64 });
    const resize = mock.requests.findLast((r) => r.path.endsWith('/resize'))!;
    expect(resize.form.get('disk')).toBe('scsi0');
    expect(resize.form.get('size')).toBe('64G');
    expect(
      mock.requests.findLast((r) => r.path.endsWith('/config') && r.method === 'PUT')!.form.get('cores'),
    ).toBe('8');
  });
});

describe('Proxmox parsing', () => {
  it('parses property strings', () => {
    expect(parsePropertyString('virtio=AA:BB,bridge=vmbr0,firewall=1')).toEqual({
      virtio: 'AA:BB',
      bridge: 'vmbr0',
      firewall: '1',
    });
    expect(parsePropertyString('local:iso/x.iso,media=cdrom')).toEqual({
      _: 'local:iso/x.iso',
      media: 'cdrom',
    });
  });

  it('finds the boot disk', () => {
    expect(
      primaryDisk('qemu', { virtio0: 'a:b,size=10G', scsi0: 'a:c,size=20G', boot: 'order=virtio0' })?.key,
    ).toBe('virtio0');
    expect(primaryDisk('qemu', { sata0: 'a:b,size=1T', ide2: 'none,media=cdrom' })).toMatchObject({
      key: 'sata0',
      sizeGb: 1024,
    });
  });

  it('reads static addresses', () => {
    expect(ipsFromConfig('qemu', { ipconfig0: 'ip=dhcp,ip6=2001:db8::5/64' }).map((i) => i.address)).toEqual([
      '2001:db8::5',
    ]);
  });

  it('maps locks to statuses', () => {
    expect(mapStatus('running', 'backup')).toBe('backup');
    expect(mapStatus('running', undefined, 'paused')).toBe('paused');
    expect(mapStatus('stopped')).toBe('stopped');
  });
});
