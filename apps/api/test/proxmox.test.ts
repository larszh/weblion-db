import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ProxmoxAdapter } from '../src/providers/proxmox/adapter';
import {
  backupOwner,
  cdromDrives,
  ipsFromConfig,
  ipsFromLxcInterfaces,
  isoDriveKey,
  mapStatus,
  notesTemplate,
  parsePropertyString,
  primaryDisk,
  qemuCpuChanges,
  qemuMemoryChanges,
  taskSucceeded,
} from '../src/providers/proxmox/parse';
import { startMockServer, type RecordedRequest } from './mock-server';

const upid = (type: string, id: number | string) =>
  `UPID:pve01:000ABC:0001:66AA:${type}:${id}:root@pam!weblion-db:`;
const UPID = upid('qmstart', 100);
const UPID_CLONE = upid('qmclone', 9000);
const UPID_RESIZE = upid('resize', 103);
const UPID_RUNNING = upid('vzdump', 100);
const UPID_FAILED = upid('qmrestore', 100);
const PBS_BACKUP = 'pbs:backup/vm/100/2024-01-01T00:00:00Z';
const LOCAL_BACKUP = 'local:backup/vzdump-qemu-100-2024_02_01-00_00_00.vma.zst';
const FOREIGN_BACKUP = 'pbs:backup/vm/200/2024-01-01T00:00:00Z';
const OLD_CT_BACKUP = 'local:backup/vzdump-lxc-100-2023_06_01-00_00_00.tar.zst';
const CT_BACKUP = 'local:backup/vzdump-lxc-101-2024_01_02-00_00_00.tar.zst';

const data = (d: unknown) => ({ body: { data: d } });

let mock: Awaited<ReturnType<typeof startMockServer>>;
let adapter: ProxmoxAdapter;
const ref = { externalId: 'qemu/100', kind: 'vm' as const, node: 'pve01', meta: {} };
const ctRef = { externalId: 'lxc/101', kind: 'container' as const, node: 'pve01', meta: {} };
const winRef = { externalId: 'qemu/102', kind: 'vm' as const, node: 'pve01', meta: {} };

/** Mutable state of the simulated cluster. */
const state = { web: 'running', nextid: 103 };

beforeEach(() => {
  state.web = 'running';
});

const CONFIGS: Record<string, Record<string, unknown>> = {
  'qemu/100': {
    name: 'web',
    agent: '1',
    ostype: 'l26',
    scsi0: 'local-zfs:vm-100-disk-0,size=32G',
    ide2: 'none,media=cdrom',
    boot: 'order=scsi0;ide2',
    net0: 'virtio=BC:24:11:00:00:01,bridge=vmbr0',
    ipconfig0: 'ip=10.0.0.5/24,gw=10.0.0.1',
  },
  'lxc/101': {
    hostname: 'dns',
    ostype: 'debian',
    rootfs: 'local-zfs:subvol-101-disk-0,size=8G',
    net0: 'name=eth0,bridge=vmbr0,firewall=1,ip=192.168.1.53/24,gw=192.168.1.1',
  },
  'qemu/102': {
    name: 'win',
    ostype: 'win11',
    sockets: 2,
    cores: 2,
    vcpus: 4,
    memory: '4096',
    balloon: 2048,
    sata0: 'local-zfs:vm-102-disk-0,size=60G',
    ide2: 'local-zfs:vm-102-cloudinit,media=cdrom',
    net0: 'e1000=BC:24:11:00:00:02,bridge=vmbr0,firewall=1',
  },
  // Fresh clones of the templates.
  'qemu/103': { name: 'new', cores: 1, memory: '2048', scsi0: 'local-zfs:vm-103-disk-0,size=10G' },
  'lxc/104': { hostname: 'new-ct', cores: 1, memory: 512, rootfs: 'local-zfs:subvol-104-disk-0,size=4G' },
};

/** A token with privilege separation and no ACLs: node names only, no stats, no guests. */
function privsepRoute(req: RecordedRequest) {
  const p = req.path.replace('/api2/json', '');
  if (p === '/version') return data({ version: '9.2.2', release: '9.2', repoid: 'abcdef12' });
  if (p === '/nodes') return data([{ id: 'node/pve01', node: 'pve01', type: 'node', status: 'online' }]);
  return data([]);
}

function route(req: RecordedRequest) {
  if (req.headers.authorization === 'PVEAPIToken=root@pam!privsep=secret-uuid') return privsepRoute(req);
  if (req.headers.authorization !== 'PVEAPIToken=root@pam!weblion-db=secret-uuid') {
    return { status: 401, statusText: 'authentication failure', body: { data: null } };
  }
  const p = decodeURIComponent(req.path.replace('/api2/json', ''));
  const m = req.method;
  if (p === '/version') return data({ version: '8.2.4', release: '8.2', repoid: 'abcdef12' });
  if (p === '/nodes')
    return data([{ node: 'pve01', status: 'online', cpu: 0.1, maxcpu: 32, mem: 1, maxmem: 2, uptime: 9 }]);
  if (p === '/cluster/nextid') return data(state.nextid++);
  if (p === '/cluster/resources' && req.query.get('type') === 'storage') {
    return data([{ storage: 'pbs', node: 'pve01', plugintype: 'pbs', content: 'backup', shared: true }]);
  }
  if (p === '/cluster/resources' && req.query.get('type') === 'vm') {
    return data([
      {
        id: 'qemu/100',
        type: 'qemu',
        vmid: 100,
        node: 'pve01',
        name: 'web',
        status: state.web,
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
      { id: 'qemu/102', type: 'qemu', vmid: 102, node: 'pve01', name: 'win', status: 'stopped', maxcpu: 4 },
      { id: 'openvz/150', type: 'openvz', vmid: 150, node: 'pve01', name: 'legacy', status: 'stopped' },
      {
        id: 'qemu/9000',
        type: 'qemu',
        vmid: 9000,
        node: 'pve01',
        name: 'debian-tpl',
        status: 'stopped',
        template: 1,
      },
      {
        id: 'lxc/9001',
        type: 'lxc',
        vmid: 9001,
        node: 'pve01',
        name: 'ct-tpl',
        status: 'stopped',
        template: true,
      },
    ]);
  }

  const guest = /^\/nodes\/pve01\/(qemu|lxc)\/(\d+)(\/.*)?$/.exec(p);
  if (guest) {
    const key = `${guest[1]}/${guest[2]}`;
    const sub = guest[3] ?? '';
    if (sub === '/config' && m === 'GET' && CONFIGS[key]) return data(CONFIGS[key]);
    if (sub === '/config' && m === 'PUT') return data(null);
    if (sub === '/resize' && m === 'PUT') return data(key === 'qemu/100' ? null : UPID_RESIZE);
    if (sub.startsWith('/status/') && m === 'POST') return data(UPID);
    if (sub === '/status/current') {
      const status = key === 'qemu/100' ? state.web : 'stopped';
      return data({ status, qmpstatus: status, ha: { managed: 0 } });
    }
    if (sub === '/vncproxy' && m === 'POST') {
      // Recent versions answer with a separate VNC password (always for API tokens).
      return data({
        port: key === 'qemu/100' ? 5901 : '5902',
        ticket: `PVEVNC:${key}`,
        user: 'root@pam!weblion-db',
        upid: UPID,
        cert: '',
        ...(key === 'qemu/100' ? { password: 'Qx7-vnc!' } : {}),
      });
    }
    if (sub.endsWith('/rollback') && m === 'POST') return data(UPID);
    if (sub === '/clone' && m === 'POST') return data(UPID_CLONE);
    if (sub === '/firewall/options' && m === 'GET') return data({ enable: true, policy_in: 'DROP' });
    if (sub === '/firewall/options' && m === 'PUT') return data(null);
    if (sub === '/firewall/rules' && m === 'POST') return data(null);
    if (sub === '/firewall/rules' && m === 'GET') {
      return data([
        { pos: 0, type: 'in', action: 'ACCEPT', proto: 'tcp', dport: '22', enable: 1 },
        { pos: 1, type: 'group', action: 'webservers' },
        { pos: 2, type: 'in', action: 'ACCEPT', macro: 'HTTPS' },
      ]);
    }
  }
  if (p === '/nodes/pve01/qemu' && m === 'POST') return data(UPID_FAILED);
  if (p === '/nodes/pve01/lxc' && m === 'POST') return data(UPID);

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
  if (p === '/nodes/pve01/qemu/100/rrddata') {
    return data([
      { time: 1000, cpu: 0.5, mem: 1, maxmem: 2, netin: 10, netout: 20, diskread: 1, diskwrite: 2 },
      { time: 1060, cpu: 0.25, mem: 1, maxmem: 2, netin: 10, netout: 20, diskread: 1, diskwrite: 2 },
    ]);
  }

  if (p === '/nodes/pve01/tasks') {
    return data([
      { upid: UPID_RUNNING, type: 'vzdump', starttime: 1704067300, user: 'root@pam' },
      { upid: UPID, type: 'qmstart', starttime: 1704067200, endtime: 1704067201, status: 'OK' },
      { upid: 'w', type: 'vzdump', starttime: 1704060000, endtime: 1704060100, status: 'WARNINGS: 2' },
      {
        upid: 'e',
        type: 'qmreboot',
        starttime: 1704050000,
        endtime: 1704050100,
        status: 'VM quit/powerdown failed',
      },
    ]);
  }
  const task = /^\/nodes\/pve01\/tasks\/(.+)\/status$/.exec(p);
  if (task) {
    const id = task[1]!;
    const base = {
      upid: id,
      node: 'pve01',
      pid: 1,
      pstart: 1,
      starttime: 1704067200,
      type: 'x',
      user: 'root@pam',
    };
    if (id === UPID_RUNNING) return data({ ...base, status: 'running' });
    if (id === UPID_CLONE) return data({ ...base, status: 'stopped', exitstatus: 'WARNINGS: 1' });
    if (id === UPID_FAILED)
      return data({ ...base, status: 'stopped', exitstatus: "command 'qmrestore' failed: exit code 2" });
    return data({ ...base, status: 'stopped', exitstatus: 'OK' });
  }

  if (p === '/nodes/pve01/storage' && req.query.get('content') === 'backup') {
    return data([
      { storage: 'offline', type: 'nfs', content: 'backup', active: false, enabled: true },
      { storage: 'pbs', type: 'pbs', content: 'backup', active: 1, enabled: 1 },
      { storage: 'local', type: 'dir', content: 'iso,backup' },
    ]);
  }
  if (p === '/nodes/pve01/storage' && req.query.get('content') === 'iso')
    return data([{ storage: 'local', type: 'dir', content: 'iso,backup' }]);
  if (p === '/nodes/pve01/storage/local/content' && req.query.get('content') === 'iso')
    return data([{ volid: 'local:iso/debian-12.iso', format: 'iso', size: 1 }]);
  if (p.startsWith('/nodes/pve01/storage/') && p.endsWith('/content')) {
    if (req.query.get('vmid') === '101') {
      return data([{ volid: CT_BACKUP, vmid: 101, ctime: 1704153600, size: 512, format: 'tar.zst' }]);
    }
    // Both storages answer with everything they hold, including backups of other guests,
    // as some storages ignore the vmid filter.
    return data([
      {
        volid: PBS_BACKUP,
        vmid: 100,
        ctime: 1704067200,
        'approximate-size': 1024,
        notes: 'nightly',
        format: 'pbs-vm',
      },
      { volid: LOCAL_BACKUP, vmid: 100, ctime: 1706745600, size: 2048, format: 'vma.zst', protected: 1 },
      { volid: FOREIGN_BACKUP, vmid: 200, ctime: 1704067200, size: 4096, format: 'pbs-vm' },
      { volid: OLD_CT_BACKUP, vmid: 100, ctime: 1685577600, size: 128, format: 'tar.zst' },
    ]);
  }
  if (p === '/nodes/pve01/vzdump' && m === 'POST') return data('UPID:pve01:1:2:3:vzdump:100:root@pam:');
  if (p === '/nodes/pve01/qemu/100/snapshot' && m === 'GET') {
    return data([
      { name: 'current', description: 'You are here!' },
      { name: 'pre-update', snaptime: 1704067200, description: 'x', vmstate: 1 },
    ]);
  }
  return undefined;
}

const lastRequest = (pred: (r: RecordedRequest) => boolean) => mock.requests.findLast(pred);

beforeAll(async () => {
  mock = await startMockServer(route);
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

  it('reports a token without permissions instead of an empty but working connection', async () => {
    const privsep = new ProxmoxAdapter({
      baseUrl: mock.url,
      tokenId: 'root@pam!privsep',
      tokenSecret: 'secret-uuid',
      verifyTls: true,
    });
    await expect(privsep.testConnection()).rejects.toThrow(
      /no permissions.*pveum acl modify \/ --tokens 'root@pam!privsep' --roles Administrator/,
    );
  });

  it('lists VMs and containers but not templates or legacy openvz entries', async () => {
    const servers = await adapter.listServers();
    expect(servers.map((s) => s.externalId)).toEqual(['qemu/100', 'lxc/101', 'qemu/102']);
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
    expect(servers[2]).toMatchObject({ os: 'Windows 11 / Server 2022+', specs: { diskGb: 60 } });
  });

  it('lists templates of both guest types as images', async () => {
    expect((await adapter.listImages()).map((i) => i.id)).toEqual(['qemu/9000', 'lxc/9001']);
  });

  it('sends power actions to the right node', async () => {
    const result = await adapter.power(ref, 'reboot');
    expect(result.providerRef).toBe(UPID);
    expect(lastRequest((r) => r.path.endsWith('/status/reboot'))?.method).toBe('POST');
  });

  it('offers no reset and no experimental suspend for containers', async () => {
    expect(adapter.powerActions(ctRef)).toEqual(['start', 'shutdown', 'stop', 'reboot']);
    expect(adapter.powerActions(ref)).toContain('suspend');
    await expect(adapter.power(ctRef, 'suspend')).rejects.toThrow(/not available/);
  });

  it('uses the generated VNC password and keeps the ticket for the websocket', async () => {
    const vm = await adapter.openConsole(ref);
    expect(vm).toMatchObject({ type: 'vnc', password: 'Qx7-vnc!' });
    expect(lastRequest((r) => r.path.endsWith('/qemu/100/vncproxy'))?.form.get('websocket')).toBe('1');
    // Older versions return no password: then the ticket is the VNC password.
    const ct = await adapter.openConsole(ctRef);
    expect(ct).toMatchObject({ type: 'vnc', password: 'PVEVNC:lxc/101' });
    expect(lastRequest((r) => r.path.endsWith('/lxc/101/vncproxy'))?.form.get('websocket')).toBe('1');
  });

  it('converts rrd data to percent', async () => {
    const metrics = await adapter.getMetrics(ref, 'hour');
    expect(metrics.points[0]).toMatchObject({ t: 1000, cpu: 50, netIn: 10, netOut: 20 });
    expect(metrics.resolutionSeconds).toBe(60);
    const req = lastRequest((r) => r.path.endsWith('/rrddata'))!;
    expect(req.query.get('timeframe')).toBe('hour');
    expect(req.query.get('cf')).toBe('AVERAGE');
  });

  it('reads task lists, counting warnings as success', async () => {
    const tasks = await adapter.listTasks(ref);
    const req = lastRequest((r) => r.path.endsWith('/nodes/pve01/tasks'))!;
    expect(req.query.get('vmid')).toBe('100');
    expect(req.query.get('source')).toBe('all');
    expect(tasks.map((t) => [t.status, t.message])).toEqual([
      ['running', null],
      ['ok', null],
      ['ok', 'WARNINGS: 2'],
      ['error', 'VM quit/powerdown failed'],
    ]);
  });

  it('tracks single tasks by UPID', async () => {
    expect(await adapter.getTaskStatus(ref, UPID_RUNNING)).toMatchObject({
      status: 'running',
      message: null,
    });
    expect(await adapter.getTaskStatus(ref, UPID_CLONE)).toMatchObject({
      status: 'ok',
      message: 'WARNINGS: 1',
    });
    expect(await adapter.getTaskStatus(ref, UPID_FAILED)).toMatchObject({
      status: 'error',
      message: "command 'qmrestore' failed: exit code 2",
    });
    expect(await adapter.getTaskStatus(ref, 'not-a-upid')).toBeNull();
    await expect(adapter.client.waitForTask(UPID_FAILED)).rejects.toThrow(/task failed: command 'qmrestore'/);
    expect(await adapter.client.waitForTask(UPID_CLONE)).toBe('WARNINGS: 1');
  });

  it('lists only backups of this guest, deduplicated across storages', async () => {
    const backups = await adapter.listBackups(ref);
    const req = lastRequest((r) => r.path === '/api2/json/nodes/pve01/storage')!;
    expect(req.query.get('enabled')).toBe('1');
    // No foreign VMID, no backup of a former container with the same VMID, no inactive storage.
    expect(backups.map((b) => b.id)).toEqual([LOCAL_BACKUP, PBS_BACKUP]);
    expect(backups[0]).toMatchObject({ storage: 'local', sizeBytes: 2048, protected: true });
    expect(backups[1]).toMatchObject({
      storage: 'pbs',
      sizeBytes: 1024,
      description: 'nightly',
      protected: false,
    });
    expect(mock.requests.some((r) => r.path.includes('/storage/offline/'))).toBe(false);
  });

  it('creates backups with vzdump on the first usable backup storage', async () => {
    await adapter.createBackup(ref, { description: 'before update\nC:\\data' });
    const req = lastRequest((r) => r.path.endsWith('/vzdump'))!;
    expect(req.form.get('vmid')).toBe('100');
    expect(req.form.get('storage')).toBe('pbs');
    expect(req.form.get('mode')).toBe('snapshot');
    expect(req.form.get('compress')).toBe('zstd');
    expect(req.form.get('notes-template')).toBe('before update\\nC:\\\\data');
  });

  it('restores only backups of the same guest', async () => {
    state.web = 'stopped';
    const before = mock.requests.length;
    await expect(adapter.restoreBackup(ref, FOREIGN_BACKUP)).rejects.toThrow(/not found/);
    await expect(adapter.restoreBackup(ref, OLD_CT_BACKUP)).rejects.toThrow(/not found/);
    expect(mock.requests.slice(before).some((r) => r.path === '/api2/json/nodes/pve01/qemu')).toBe(false);

    const result = await adapter.restoreBackup(ref, PBS_BACKUP);
    expect(result.providerRef).toBe(UPID_FAILED);
    const req = lastRequest((r) => r.path === '/api2/json/nodes/pve01/qemu')!;
    expect(req.method).toBe('POST');
    expect(Object.fromEntries(req.form)).toEqual({ vmid: '100', archive: PBS_BACKUP, force: '1' });
  });

  it('refuses to restore over a running VM', async () => {
    await expect(adapter.restoreBackup(ref, PBS_BACKUP)).rejects.toThrow(/must be stopped/);
  });

  it('restores containers onto their current storage', async () => {
    await adapter.restoreBackup(ctRef, CT_BACKUP);
    const req = lastRequest((r) => r.path === '/api2/json/nodes/pve01/lxc')!;
    expect(Object.fromEntries(req.form)).toEqual({
      vmid: '101',
      ostemplate: CT_BACKUP,
      restore: '1',
      force: '1',
      storage: 'local-zfs',
    });
  });

  it('hides the "current" pseudo snapshot', async () => {
    const snaps = await adapter.listSnapshots(ref);
    expect(snaps.map((s) => s.id)).toEqual(['pre-update']);
    expect(snaps[0]!.includesRam).toBe(true);
  });

  it('starts a running guest again after a snapshot rollback', async () => {
    await adapter.rollbackSnapshot(ref, 'pre-update');
    expect(
      lastRequest((r) => r.path.endsWith('/qemu/100/snapshot/pre-update/rollback'))!.form.get('start'),
    ).toBe('1');
    await adapter.rollbackSnapshot(ctRef, 'pre-update');
    expect(
      lastRequest((r) => r.path.endsWith('/lxc/101/snapshot/pre-update/rollback'))!.form.has('start'),
    ).toBe(false);
  });

  it('only grows disks', async () => {
    await expect(adapter.rescale(ref, { diskGb: 16 })).rejects.toThrow(/only grow/);
    await adapter.rescale(ref, { cores: 8, diskGb: 64 });
    const resize = lastRequest((r) => r.path.endsWith('/resize'))!;
    expect(resize.form.get('disk')).toBe('scsi0');
    expect(resize.form.get('size')).toBe('64G');
    expect(lastRequest((r) => r.path.endsWith('/config') && r.method === 'PUT')!.form.get('cores')).toBe('8');
  });

  it('keeps the socket layout, hotplugged vCPUs and balloon in line when rescaling a VM', async () => {
    await adapter.rescale(winRef, { cores: 6, memoryMb: 1024 });
    const put = lastRequest((r) => r.path.endsWith('/qemu/102/config') && r.method === 'PUT')!;
    expect(Object.fromEntries(put.form)).toEqual({ cores: '3', vcpus: '6', memory: '1024', balloon: '1024' });
  });

  it('mounts ISOs without replacing the cloud-init drive', async () => {
    await adapter.mountIso(ref, 'local:iso/debian-12.iso');
    let put = lastRequest((r) => r.path.endsWith('/qemu/100/config') && r.method === 'PUT')!;
    expect(Object.fromEntries(put.form)).toEqual({ ide2: 'local:iso/debian-12.iso,media=cdrom' });

    await adapter.mountIso(winRef, 'local:iso/debian-12.iso');
    put = lastRequest((r) => r.path.endsWith('/qemu/102/config') && r.method === 'PUT')!;
    expect(Object.fromEntries(put.form)).toEqual({ ide0: 'local:iso/debian-12.iso,media=cdrom' });

    await expect(adapter.mountIso(ref, 'local:iso/other.iso')).rejects.toThrow(/Unknown ISO/);
    const before = mock.requests.length;
    expect(await adapter.unmountIso(winRef)).toEqual({ message: 'No ISO mounted' });
    expect(mock.requests.slice(before).some((r) => r.method === 'PUT')).toBe(false);
  });

  it('reads firewall booleans and skips security group rules', async () => {
    const fw = await adapter.getFirewall(ref);
    expect(fw).toMatchObject({ enabled: true, policyIn: 'DROP', policyOut: 'ACCEPT' });
    expect(fw.rules.map((r) => [r.pos, r.enabled, r.protocol])).toEqual([
      [0, true, 'tcp'],
      [2, false, 'HTTPS'],
    ]);
  });

  it('adds firewall rules with the Proxmox field names', async () => {
    await adapter.addFirewallRule(ref, {
      direction: 'in',
      action: 'ACCEPT',
      enabled: true,
      protocol: 'tcp',
      dport: '80,443',
      source: '10.0.0.0/8',
      comment: 'web',
    });
    const req = lastRequest((r) => r.path.endsWith('/qemu/100/firewall/rules') && r.method === 'POST')!;
    expect(Object.fromEntries(req.form)).toEqual({
      type: 'in',
      action: 'ACCEPT',
      enable: '1',
      proto: 'tcp',
      dport: '80,443',
      source: '10.0.0.0/8',
      comment: 'web',
    });
  });

  it('warns when enabling the firewall has no effect on any network device', async () => {
    const web = await adapter.setFirewallEnabled(ref, true);
    expect(web.message).toMatch(/no network device has the firewall option/);
    expect(lastRequest((r) => r.path.endsWith('/qemu/100/firewall/options'))!.form.get('enable')).toBe('1');
    expect(await adapter.setFirewallEnabled(winRef, true)).toEqual({ message: 'Firewall enabled' });
    expect(await adapter.setFirewallEnabled(ref, false)).toEqual({ message: 'Firewall disabled' });
  });

  it('creates VMs by cloning a template', async () => {
    state.nextid = 103;
    const result = await adapter.createServer({
      name: 'new',
      imageId: 'qemu/9000',
      cores: 2,
      memoryMb: 4096,
      diskGb: 20,
    });
    expect(result).toMatchObject({ externalId: 'qemu/103', providerRef: UPID_CLONE });
    const clone = lastRequest((r) => r.path.endsWith('/qemu/9000/clone'))!;
    // Same node: no target, which Proxmox only accepts for templates on shared storage.
    expect(Object.fromEntries(clone.form)).toEqual({ newid: '103', name: 'new', full: '1' });
    const put = lastRequest((r) => r.path.endsWith('/qemu/103/config') && r.method === 'PUT')!;
    expect(Object.fromEntries(put.form)).toEqual({ cores: '2', memory: '4096' });
    expect(lastRequest((r) => r.path.endsWith('/qemu/103/resize'))!.form.get('size')).toBe('20G');
    // The resize task must be done before the VM starts.
    const paths = mock.requests.map((r) => decodeURIComponent(r.path));
    const resizeDone = paths.lastIndexOf(`/api2/json/nodes/pve01/tasks/${UPID_RESIZE}/status`);
    const start = paths.lastIndexOf('/api2/json/nodes/pve01/qemu/103/status/start');
    expect(resizeDone).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(resizeDone);
  });

  it('creates containers by cloning a container template', async () => {
    state.nextid = 104;
    const result = await adapter.createServer({
      name: 'new-ct',
      imageId: 'lxc/9001',
      node: 'pve01',
      storage: 'local-zfs',
      cores: 2,
      memoryMb: 1024,
      diskGb: 10,
      start: false,
    });
    expect(result.externalId).toBe('lxc/104');
    const clone = lastRequest((r) => r.path.endsWith('/lxc/9001/clone'))!;
    expect(Object.fromEntries(clone.form)).toEqual({
      newid: '104',
      hostname: 'new-ct',
      full: '1',
      storage: 'local-zfs',
    });
    const put = lastRequest((r) => r.path.endsWith('/lxc/104/config') && r.method === 'PUT')!;
    expect(Object.fromEntries(put.form)).toEqual({ cores: '2', memory: '1024' });
    const resize = lastRequest((r) => r.path.endsWith('/lxc/104/resize'))!;
    expect(Object.fromEntries(resize.form)).toEqual({ disk: 'rootfs', size: '10G' });
    expect(mock.requests.some((r) => r.path.endsWith('/lxc/104/status/start'))).toBe(false);
  });

  it('summarizes the cluster', async () => {
    const overview = await adapter.overview();
    expect(overview.storages[0]).toMatchObject({ name: 'pbs', shared: true, content: ['backup'] });
    expect(overview.facts).toContainEqual({ label: 'Templates', value: '2' });
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

  it('reads all container addresses from the interfaces list', () => {
    const current = ipsFromLxcInterfaces([
      { name: 'lo', hwaddr: '00:00:00:00:00:00', inet: '127.0.0.1/8', 'ip-addresses': [] },
      {
        name: 'eth0',
        hwaddr: 'bc:24:11:00:00:03',
        'hardware-address': 'bc:24:11:00:00:03',
        inet: '192.168.1.53/24',
        inet6: 'fe80::1/64',
        'ip-addresses': [
          { 'ip-address': '192.168.1.53', 'ip-address-type': 'inet', prefix: 24 },
          { 'ip-address': '192.168.1.54', 'ip-address-type': 'inet', prefix: 24 },
          { 'ip-address': '2001:db8::53', 'ip-address-type': 'inet6', prefix: 64 },
          { 'ip-address': 'fe80::1', 'ip-address-type': 'inet6', prefix: 64 },
        ],
      },
    ]);
    expect(current.map((i) => [i.address, i.version, i.interface])).toEqual([
      ['192.168.1.53', 4, 'eth0'],
      ['192.168.1.54', 4, 'eth0'],
      ['2001:db8::53', 6, 'eth0'],
    ]);
    // Older versions only report inet/inet6.
    const legacy = ipsFromLxcInterfaces([
      { name: 'eth0', hwaddr: 'aa', inet: '10.1.1.1/24', inet6: '2001:db8::1/64' },
    ]);
    expect(legacy.map((i) => i.address)).toEqual(['10.1.1.1', '2001:db8::1']);
  });

  it('maps locks to statuses', () => {
    expect(mapStatus('running', 'backup')).toBe('backup');
    expect(mapStatus('running', undefined, 'paused')).toBe('paused');
    expect(mapStatus('stopped')).toBe('stopped');
    expect(mapStatus('stopped', 'suspended')).toBe('paused');
    expect(mapStatus('running', 'suspending')).toBe('stopping');
  });

  it('finds CD-ROM drives but leaves cloud-init drives alone', () => {
    const config = {
      ide0: 'local:iso/a.iso,media=cdrom',
      ide2: 'local-lvm:vm-100-cloudinit,media=cdrom',
      scsi0: 'local-lvm:vm-100-disk-0,size=10G',
    };
    expect(cdromDrives(config)).toEqual(['ide0']);
    expect(isoDriveKey(config)).toBe('ide0');
    expect(isoDriveKey({ ide2: 'local-lvm:vm-100-cloudinit,media=cdrom' })).toBe('ide0');
    expect(isoDriveKey({ ide2: 'none,media=cdrom', sata1: 'cdrom,media=cdrom' })).toBe('ide2');
    expect(isoDriveKey({ ide0: 'a:b', ide1: 'a:c', ide2: 'a:d', ide3: 'a:e' })).toBeNull();
  });

  it('turns a vCPU total into the QEMU topology', () => {
    expect(qemuCpuChanges({}, 4)).toEqual({ cores: 4 });
    expect(qemuCpuChanges({ sockets: 2, cores: 2 }, 8)).toEqual({ cores: 4 });
    expect(qemuCpuChanges({ sockets: '2', cores: 2 }, 5)).toEqual({ sockets: 1, cores: 5 });
    expect(qemuCpuChanges({ sockets: 1, vcpus: 2 }, 6)).toEqual({ cores: 6, vcpus: 6 });
    expect(qemuMemoryChanges({ balloon: 0 }, 1024)).toEqual({ memory: 1024 });
    expect(qemuMemoryChanges({ balloon: 2048 }, 4096)).toEqual({ memory: 4096 });
    expect(qemuMemoryChanges({ balloon: 2048 }, 1024)).toEqual({ memory: 1024, balloon: 1024 });
  });

  it('reads the owner of a backup volume', () => {
    expect(backupOwner('local:backup/vzdump-qemu-100-2024_01_01-00_00_00.vma.zst')).toEqual({
      type: 'qemu',
      vmid: 100,
    });
    expect(backupOwner('nfs:backup/vzdump-lxc-101-2024_01_01-00_00_00.tar.zst')).toEqual({
      type: 'lxc',
      vmid: 101,
    });
    expect(backupOwner('pbs:backup/ct/105/2024-01-01T00:00:00Z')).toEqual({ type: 'lxc', vmid: 105 });
    expect(backupOwner('pbs:backup/vm/1000/2024-01-01T00:00:00Z')).toEqual({ type: 'qemu', vmid: 1000 });
    expect(backupOwner('local:backup/something-else.tar')).toBeNull();
  });

  it('escapes vzdump notes templates', () => {
    expect(notesTemplate('a\\b\r\nc')).toBe('a\\\\b\\nc');
  });

  it('counts finished tasks with warnings as success', () => {
    expect(taskSucceeded('OK')).toBe(true);
    expect(taskSucceeded('WARNINGS: 3')).toBe(true);
    expect(taskSucceeded('unexpected status')).toBe(false);
    expect(taskSucceeded("command 'vzdump' failed: exit code 1")).toBe(false);
  });
});
