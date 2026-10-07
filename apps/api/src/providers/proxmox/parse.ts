import type { IpAddress, ServerStatus } from '@weblion/shared';
import { isRecord, str } from '../http';

export type GuestType = 'qemu' | 'lxc';

export interface ClusterVmResource {
  id: string;
  type: GuestType;
  vmid: number;
  node: string;
  name?: string;
  status?: string;
  maxcpu?: number;
  cpu?: number;
  maxmem?: number;
  mem?: number;
  maxdisk?: number;
  disk?: number;
  uptime?: number;
  template?: number;
  tags?: string;
  pool?: string;
  lock?: string;
  hastate?: string;
}

export function parseExternalId(externalId: string): { type: GuestType; vmid: number } {
  const [type, vmid] = externalId.split('/');
  if ((type !== 'qemu' && type !== 'lxc') || !vmid || !/^\d+$/.test(vmid)) {
    throw new Error(`Invalid Proxmox server id "${externalId}"`);
  }
  return { type, vmid: Number(vmid) };
}

export function mapStatus(status: string | undefined, lock?: string, qmpstatus?: string): ServerStatus {
  if (lock) {
    if (lock === 'backup') return 'backup';
    if (lock === 'migrate') return 'migrating';
    if (lock === 'create' || lock === 'clone') return 'installing';
    if (lock === 'rollback') return 'restoring';
    return 'locked';
  }
  if (qmpstatus === 'paused' || qmpstatus === 'suspended') return 'paused';
  if (qmpstatus === 'prelaunch') return 'starting';
  if (status === 'running') return 'running';
  if (status === 'stopped') return 'stopped';
  return 'unknown';
}

/** Parses `key=value,key=value` Proxmox property strings. The first bare token is returned as `_`. */
export function parsePropertyString(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const s = str(value);
  if (!s) return out;
  for (const part of s.split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) out._ = part;
    else out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return out;
}

function stripPrefix(cidr: string | undefined): string | null {
  if (!cidr || cidr === 'dhcp' || cidr === 'auto' || cidr === 'manual') return null;
  return cidr.split('/')[0] ?? null;
}

/** Static addresses from cloud-init (qemu ipconfigN) or container network config (lxc netN). */
export function ipsFromConfig(type: GuestType, config: Record<string, unknown>): IpAddress[] {
  const ips: IpAddress[] = [];
  const prefix = type === 'qemu' ? 'ipconfig' : 'net';
  for (const [key, raw] of Object.entries(config)) {
    if (!new RegExp(`^${prefix}\\d+$`).test(key)) continue;
    const props = parsePropertyString(raw);
    const v4 = stripPrefix(props.ip);
    const v6 = stripPrefix(props.ip6);
    const iface = type === 'lxc' ? props.name : key.replace('ipconfig', 'net');
    if (v4) ips.push({ address: v4, version: 4, gateway: props.gw, interface: iface, mac: props.hwaddr });
    if (v6) ips.push({ address: v6, version: 6, gateway: props.gw6, interface: iface, mac: props.hwaddr });
  }
  return ips;
}

function isUsableAddress(address: string): boolean {
  return !(
    address.startsWith('127.') ||
    address === '::1' ||
    address.toLowerCase().startsWith('fe80:') ||
    address.startsWith('169.254.')
  );
}

/** QEMU guest agent `network-get-interfaces` result. */
export function ipsFromAgent(data: unknown): IpAddress[] {
  const result = isRecord(data) && Array.isArray(data.result) ? data.result : Array.isArray(data) ? data : [];
  const ips: IpAddress[] = [];
  for (const iface of result) {
    if (!isRecord(iface) || iface.name === 'lo') continue;
    const name = str(iface.name) ?? undefined;
    if (name && /^(docker|br-|veth|virbr|cni|flannel|cali|tailscale)/.test(name)) continue;
    const addresses = Array.isArray(iface['ip-addresses']) ? iface['ip-addresses'] : [];
    for (const addr of addresses) {
      if (!isRecord(addr)) continue;
      const address = str(addr['ip-address']);
      if (!address || !isUsableAddress(address)) continue;
      ips.push({
        address,
        version: addr['ip-address-type'] === 'ipv6' ? 6 : 4,
        interface: name,
        mac: str(iface['hardware-address']) ?? undefined,
      });
    }
  }
  return ips;
}

/** LXC `/interfaces` result. */
export function ipsFromLxcInterfaces(data: unknown): IpAddress[] {
  if (!Array.isArray(data)) return [];
  const ips: IpAddress[] = [];
  for (const iface of data) {
    if (!isRecord(iface) || iface.name === 'lo') continue;
    const name = str(iface.name) ?? undefined;
    const v4 = stripPrefix(str(iface.inet) ?? undefined);
    const v6 = stripPrefix(str(iface.inet6) ?? undefined);
    if (v4 && isUsableAddress(v4))
      ips.push({ address: v4, version: 4, interface: name, mac: str(iface.hwaddr) ?? undefined });
    if (v6 && isUsableAddress(v6))
      ips.push({ address: v6, version: 6, interface: name, mac: str(iface.hwaddr) ?? undefined });
  }
  return ips;
}

export function mergeIps(...lists: IpAddress[][]): IpAddress[] {
  const seen = new Map<string, IpAddress>();
  for (const list of lists) {
    for (const ip of list) {
      const existing = seen.get(ip.address);
      seen.set(ip.address, existing ? { ...ip, ...existing } : ip);
    }
  }
  // Public IPv4 first, private ranges after, then IPv6.
  const rank = (ip: IpAddress) =>
    ip.version === 6
      ? 2
      : /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(
            ip.address,
          )
        ? 1
        : 0;
  return [...seen.values()].sort((a, b) => rank(a) - rank(b));
}

const OS_TYPES: Record<string, string> = {
  l26: 'Linux',
  l24: 'Linux 2.4',
  win11: 'Windows 11 / Server 2022+',
  win10: 'Windows 10 / Server 2016-2019',
  win8: 'Windows 8 / Server 2012',
  win7: 'Windows 7 / Server 2008 R2',
  w2k8: 'Windows Server 2008',
  w2k3: 'Windows Server 2003',
  wxp: 'Windows XP',
  solaris: 'Solaris',
  other: 'Other',
};

export function osLabel(type: GuestType, config: Record<string, unknown>): string | null {
  const ostype = str(config.ostype);
  if (!ostype) return null;
  if (type === 'lxc') return ostype.charAt(0).toUpperCase() + ostype.slice(1);
  return OS_TYPES[ostype] ?? ostype;
}

export interface DiskInfo {
  key: string;
  sizeGb: number | null;
  storage: string | null;
}

function sizeToGb(size: string | undefined): number | null {
  if (!size) return null;
  const m = /^(\d+(?:\.\d+)?)([KMGT]?)$/i.exec(size);
  if (!m) return null;
  const value = Number(m[1]);
  switch ((m[2] ?? '').toUpperCase()) {
    case 'T':
      return value * 1024;
    case 'G':
      return value;
    case 'M':
      return value / 1024;
    case 'K':
      return value / 1024 / 1024;
    default:
      return value / 1024 ** 3;
  }
}

/** Finds the boot disk: the first disk in the boot order, else the first non CD-ROM disk. */
export function primaryDisk(type: GuestType, config: Record<string, unknown>): DiskInfo | null {
  if (type === 'lxc') {
    const props = parsePropertyString(config.rootfs);
    return { key: 'rootfs', sizeGb: sizeToGb(props.size), storage: props._?.split(':')[0] ?? null };
  }
  const disks = Object.keys(config).filter(
    (k) => /^(scsi|virtio|sata|ide)\d+$/.test(k) && !String(config[k]).includes('media=cdrom'),
  );
  const bootOrder = parsePropertyString(config.boot).order?.split(';') ?? [];
  const legacyBoot = str(config.bootdisk);
  const key =
    bootOrder.find((d) => disks.includes(d)) ??
    (legacyBoot && disks.includes(legacyBoot) ? legacyBoot : disks.sort()[0]);
  if (!key) return null;
  const props = parsePropertyString(config[key]);
  return { key, sizeGb: sizeToGb(props.size), storage: props._?.split(':')[0] ?? null };
}

export function parseTags(tags: string | undefined): string[] {
  return tags ? tags.split(/[;, ]+/).filter(Boolean) : [];
}
