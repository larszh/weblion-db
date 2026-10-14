import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import { badRequest } from '../../lib/errors';

/**
 * Targets of customer monitors (SSRF guard). A monitor runs from the Uptime Kuma host and could
 * probe its network, so customers only monitor public addresses: names that resolve to private,
 * loopback, link-local or reserved addresses are refused, and so is the Kuma instance itself.
 * DNS can change after the check (rebinding): the real protection is egress filtering on the
 * Kuma host, this keeps the obvious cases out.
 */

/** Every address a host name resolves to. */
export type LookupAll = (hostname: string) => Promise<{ address: string; family: number }[]>;

/**
 * The resolver assertPublicTarget uses unless a call passes its own. Tests replace `lookup` to
 * run without network.
 */
export const targetDns: { lookup: LookupAll } = {
  lookup: (hostname) => dns.lookup(hostname, { all: true, verbatim: true }),
};

const LOOKUP_TIMEOUT_MS = 3000;

const PRIVATE_MESSAGE =
  'Only public addresses can be monitored (private, loopback, link-local and reserved addresses are refused)';

/** Names that never leave the local network. */
const LOCAL_NAMES = ['localhost', 'local', 'localdomain', 'internal', 'lan', 'home.arpa'];

/** DNS answers that mean "this name does not exist", not "the resolver failed". */
const NOT_FOUND = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN', 'ENONAME']);

/** Private, shared, loopback, link-local, documentation, benchmark, multicast and reserved IPv4. */
const IPV4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function ipv4Bytes(address: string): number[] | null {
  if (isIP(address) !== 4) return null;
  return address.split('.').map(Number);
}

const ipv4Number = (b: number[]) => ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;

const IPV4_RANGES = IPV4_BLOCKED.map(([base, bits]) => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { network: (ipv4Number(ipv4Bytes(base)!) & mask) >>> 0, mask };
});

function publicIpv4(bytes: number[]): boolean {
  const n = ipv4Number(bytes);
  return !IPV4_RANGES.some((r) => (n & r.mask) >>> 0 === r.network);
}

/** The 16 bytes of an IPv6 address (zone index ignored), or null. */
function ipv6Bytes(address: string): number[] | null {
  let a = address.toLowerCase();
  const zone = a.indexOf('%');
  if (zone >= 0) a = a.slice(0, zone);
  if (isIP(a) !== 6) return null;
  // An embedded IPv4 address ("::ffff:10.0.0.1") becomes two hex groups.
  const lastColon = a.lastIndexOf(':');
  const tail = a.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = ipv4Bytes(tail);
    if (!v4) return null;
    a = `${a.slice(0, lastColon + 1)}${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`;
  }
  const [head, rest] = a.includes('::') ? a.split('::') : [a, null];
  const groups = (part: string | null | undefined) => (part ? part.split(':') : []);
  const left = groups(head);
  const right = groups(rest);
  const fill = rest === null ? [] : new Array<string>(8 - left.length - right.length).fill('0');
  const all = [...left, ...fill, ...right];
  if (all.length !== 8) return null;
  const bytes: number[] = [];
  for (const group of all) {
    const value = parseInt(group, 16);
    if (Number.isNaN(value) || value < 0 || value > 0xffff) return null;
    bytes.push(value >> 8, value & 0xff);
  }
  return bytes;
}

const startsWith = (bytes: number[], prefix: number[]) => prefix.every((b, i) => bytes[i] === b);

function publicIpv6(b: number[]): boolean {
  const zeros = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  const embedded = b.slice(12, 16);
  // :: and ::1, and the old IPv4-compatible ::a.b.c.d: judged by the IPv4 address in them.
  if (zeros(0, 12)) return publicIpv4(embedded);
  // IPv4-mapped ::ffff:a.b.c.d and the NAT64 prefix 64:ff9b::/96 reach the IPv4 address.
  if (zeros(0, 10) && b[10] === 0xff && b[11] === 0xff) return publicIpv4(embedded);
  if (startsWith(b, [0x00, 0x64, 0xff, 0x9b]) && zeros(4, 12)) return publicIpv4(embedded);
  if ((b[0]! & 0xfe) === 0xfc) return false; // fc00::/7 unique local
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0x80) return false; // fe80::/10 link-local
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0xc0) return false; // fec0::/10 site-local (deprecated)
  if (b[0] === 0xff) return false; // ff00::/8 multicast
  if (startsWith(b, [0x20, 0x01, 0x0d, 0xb8])) return false; // 2001:db8::/32 documentation
  return true;
}

/** True for a public unicast IPv4 or IPv6 address; false for reserved ranges and non-addresses. */
export function isPublicAddress(address: string): boolean {
  const clean = address.trim().replace(/^\[|\]$/g, '');
  const v4 = ipv4Bytes(clean);
  if (v4) return publicIpv4(v4);
  const v6 = ipv6Bytes(clean);
  return v6 ? publicIpv6(v6) : false;
}

const errorCode = (err: unknown) =>
  err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';

export interface PublicTargetOptions {
  lookup?: LookupAll;
  timeoutMs?: number;
  /** Host names of the Uptime Kuma instance: a monitor must not check its own instance. */
  instanceHosts?: (string | null | undefined)[];
}

/**
 * Refuses targets that are not public: single-label and local names, the Kuma instance itself,
 * IP literals in reserved ranges and names any of whose addresses lies in one (lookup with a
 * timeout of 3 s). 400 "Validation failed" with the issue on `path`, like the other checks.
 */
export async function assertPublicTarget(
  host: string,
  path: 'url' | 'hostname',
  options: PublicTargetOptions = {},
): Promise<void> {
  const refuse = (message: string): never => {
    throw badRequest('Validation failed', [{ path, message }]);
  };
  const name = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (!name) refuse('A host name or IP address is required');
  const instance = (options.instanceHosts ?? [])
    .filter((h): h is string => typeof h === 'string' && h.length > 0)
    .map((h) =>
      h
        .toLowerCase()
        .replace(/^\[|\]$/g, '')
        .replace(/\.$/, ''),
    );
  if (instance.includes(name)) refuse('The monitoring instance cannot check its own address');

  if (isIP(name.replace(/%.*$/, '')) !== 0) {
    if (!isPublicAddress(name)) refuse(PRIVATE_MESSAGE);
    return;
  }
  if (!name.includes('.') || LOCAL_NAMES.some((suffix) => name === suffix || name.endsWith(`.${suffix}`))) {
    refuse('Only public host names can be monitored, not local network names');
  }

  const lookup = options.lookup ?? targetDns.lookup;
  let timer: NodeJS.Timeout | undefined;
  let addresses: { address: string }[];
  try {
    addresses = await Promise.race([
      lookup(name),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(Object.assign(new Error('lookup timed out'), { code: 'ETIMEOUT' })),
          options.timeoutMs ?? LOOKUP_TIMEOUT_MS,
        );
        timer.unref();
      }),
    ]);
  } catch (err) {
    if (NOT_FOUND.has(errorCode(err))) refuse('This host name does not resolve');
    return refuse('This host name could not be resolved right now. Try again later.');
  } finally {
    clearTimeout(timer);
  }
  if (addresses.length === 0) refuse('This host name does not resolve');
  if (addresses.some((a) => !isPublicAddress(a.address))) refuse(PRIVATE_MESSAGE);
}

/** Query keys whose values are masked in displayed URLs (tokens in health check addresses). */
const SECRET_PARAM = /token|key|secret|pass|auth|sig|session/i;

/**
 * A URL for display and audit: values of secret-looking query keys replaced by "***". The text
 * stays as entered when nothing is masked.
 */
export function maskUrlSecrets(url: string): string {
  const q = url.indexOf('?');
  if (q < 0) return url;
  const hash = url.indexOf('#', q);
  const query = url.slice(q + 1, hash < 0 ? undefined : hash);
  const masked = query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq < 0) return pair;
      let key = pair.slice(0, eq);
      try {
        key = decodeURIComponent(key.replace(/\+/g, ' '));
      } catch {
        // A broken escape is matched as text.
      }
      return SECRET_PARAM.test(key) ? `${pair.slice(0, eq)}=***` : pair;
    })
    .join('&');
  return `${url.slice(0, q + 1)}${masked}${hash < 0 ? '' : url.slice(hash)}`;
}
