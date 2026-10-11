import { isIPv4, isIPv6 } from 'node:net';
import type {
  Capability,
  CdnSettingPatch,
  CdnSettings,
  DnsRecord,
  DnsRecordInput,
  DnsRecordType,
  DomainCapability,
  DomainInfo,
  DomainKind,
  PowerAction,
} from '@weblion/shared';
import { CDN_SSL_MODES, DNS_PROXIABLE_TYPES, DNS_TTL_AUTO } from '@weblion/shared';
import { ProviderError, badRequest, conflict, notFound, unsupported } from '../../lib/errors';
import {
  CLOUDFLARE_DOMAIN_CAPABILITIES,
  CLOUDFLARE_PROVIDER,
  CLOUDFLARE_RECORD_TYPES,
  CLOUDFLARE_TTL_MAX,
  CLOUDFLARE_TTL_MIN,
} from '../cloudflare/constants';
import type {
  ActionResult,
  DnsRecordPatch,
  InfraOverview,
  ProviderAdapter,
  RawResponse,
  RemoteDomain,
  RemoteServer,
  ServerRef,
} from '../types';
import { demoDelegation } from './hosting';

/**
 * Simulated Cloudflare account for the second, opt-in demo connection (DemoConfig.flavor
 * "cloudflare", ENABLE_DEMO_CLOUDFLARE). Deterministic, kept in memory per connection like the
 * other demo data, so edits survive adapter re-creation. Follows the rules of the real adapter
 * (record types, TTL 1 or 60 to 86400 s, proxy only for public A, AAAA and CNAME records, no
 * CNAME next to other records, no NS at the apex), so the dev stack shows every Cloudflare
 * feature and its errors. A pending zone turns active once the demo registrar delegates to its
 * name servers (see demoDelegation).
 */

type ZoneStatus = 'initializing' | 'pending' | 'active' | 'moved';
type SslMode = Exclude<(typeof CDN_SSL_MODES)[number], 'auto'>;

interface DemoZoneRecord {
  id: string;
  type: string;
  /** Relative to the zone, "@" for the apex. */
  name: string;
  data: string;
  ttl: number;
  proxied: boolean;
  comment: string | null;
}

interface DemoCdn {
  /** Effective SSL/TLS mode, also while Automatic SSL/TLS is on. */
  sslMode: SslMode;
  /** Automatic SSL/TLS (ssl_automatic_mode "auto"). */
  sslAutomatic: boolean;
  alwaysUseHttps: boolean;
  /** When development mode was switched on (ms), null while off. */
  devEnabledAt: number | null;
  editable: CdnSettings['editable'];
}

export interface DemoZone {
  /** 32 hex digits like a Cloudflare zone id. */
  id: string;
  name: string;
  status: ZoneStatus;
  paused: boolean;
  type: 'full';
  /** Assigned by Cloudflare. */
  nameservers: string[];
  /** The delegation Cloudflare saw when the zone was added. */
  originalNameservers: string[];
  originalRegistrar: string | null;
  createdAt: string;
  activatedAt: string | null;
  records: DemoZoneRecord[];
  cdn: DemoCdn;
}

export interface DemoCloudflareState {
  zones: Map<string, DemoZone>;
  nextZone: number;
  nextRecord: number;
  nextPurge: number;
  /** Index into NAMESERVER_POOL for the next created zone. */
  nextNameservers: number;
}

const STATE = new Map<string, DemoCloudflareState>();

/** Zone ids "cf" + 30 digits, record ids "d" + 31 digits: 32 hex characters each. */
const zoneIdOf = (n: number) => `cf${String(n).padStart(30, '0')}`;
const recordIdOf = (n: number) => `d${String(n).padStart(31, '0')}`;

export const DEMO_CLOUDFLARE_ACCOUNT = { id: zoneIdOf(0), name: 'Demo Account' };
const PLAN = { name: 'Free Website', legacyId: 'free' };
/** Name server pairs Cloudflare assigns to new zones, in turn. */
const NAMESERVER_POOL = [
  ['lea', 'tom'],
  ['kim', 'max'],
  ['eva', 'leo'],
];
/** Development mode switches itself off after 3 hours. */
const DEV_MODE_SECONDS = 3 * 3600;
/** What a new zone gets: Automatic SSL/TLS, which picks Full for the simulated origin. */
const DEFAULT_CDN = { sslMode: 'full', sslAutomatic: true, alwaysUseHttps: false } as const;

const ACCEPTED_TYPES: readonly string[] = CLOUDFLARE_RECORD_TYPES;
const PROXIABLE_TYPES: readonly string[] = DNS_PROXIABLE_TYPES;
const SSL_MODES: readonly string[] = CDN_SSL_MODES;
/** Zone name as Cloudflare accepts it (lower-cased here). */
const ZONE_NAME = /^(?=.{1,253}$)([a-z0-9][-a-z0-9]*\.)+[-a-z0-9]{2,20}$/;

type RecordSeed = [
  type: string,
  name: string,
  data: string,
  extra?: { proxied?: boolean; ttl?: number; comment?: string },
];

interface ZoneSeed {
  name: string;
  status: ZoneStatus;
  createdAt: string;
  activatedAt: string | null;
  nameservers: string[];
  originalNameservers: string[];
  originalRegistrar: string | null;
  records: RecordSeed[];
  cdn: Partial<Pick<DemoCdn, 'sslMode' | 'sslAutomatic' | 'alwaysUseHttps'>>;
}

const cloudflareNs = (...names: string[]) => names.map((n) => `${n}.ns.cloudflare.com`);

/**
 * muster-shop.ch is the zone the demo registrar already delegates to (ana/bob), beispiel-gmbh.de
 * waits for its name servers, alt-muster.ch left Cloudflare.
 */
const ZONES: ZoneSeed[] = [
  {
    name: 'muster-shop.ch',
    status: 'active',
    createdAt: '2023-01-10T08:00:00.000Z',
    activatedAt: '2023-01-10T14:30:00.000Z',
    nameservers: cloudflareNs('ana', 'bob'),
    originalNameservers: ['ns1.fireapi.de', 'ns2.fireapi.de'],
    originalRegistrar: 'Demo Registrar',
    records: [
      ['A', '@', '185.101.20.11', { proxied: true }],
      ['CNAME', 'www', 'muster-shop.ch', { proxied: true }],
      ['MX', '@', '10 mail.muster-ag.ch'],
      [
        'TXT',
        '@',
        'google-site-verification=Xq3v9cWm2LkR8tYp0zNdA7sHbEu4FjGi1oQ6KeTr5yU',
        { ttl: 3600, comment: 'Google Search Console' },
      ],
      ['TXT', '_dmarc', 'v=DMARC1; p=none'],
      ['CAA', '@', '0 issue "letsencrypt.org"'],
      ['HTTPS', '@', '1 . alpn="h3,h2"'],
    ],
    cdn: { sslMode: 'full', sslAutomatic: false, alwaysUseHttps: true },
  },
  {
    name: 'beispiel-gmbh.de',
    status: 'pending',
    createdAt: '2026-10-01T09:15:00.000Z',
    activatedAt: null,
    nameservers: cloudflareNs('ivy', 'rob'),
    originalNameservers: ['ns1.example-registrar.de', 'ns2.example-registrar.de'],
    originalRegistrar: null,
    records: [
      ['A', '@', '203.0.113.20'],
      ['CNAME', 'www', 'beispiel-gmbh.de', { proxied: true }],
      ['MX', '@', '10 mx.beispiel-gmbh.de'],
      ['A', 'mx', '203.0.113.25'],
      ['A', 'intern', '10.0.0.5'],
    ],
    cdn: { sslMode: 'full', sslAutomatic: true, alwaysUseHttps: false },
  },
  {
    name: 'alt-muster.ch',
    status: 'moved',
    createdAt: '2021-03-15T10:00:00.000Z',
    activatedAt: '2021-03-15T16:20:00.000Z',
    nameservers: cloudflareNs('ana', 'bob'),
    originalNameservers: ['a.ns.joker.com', 'b.ns.joker.com'],
    originalRegistrar: 'Joker.com',
    records: [['A', '@', '185.101.20.12']],
    cdn: {},
  },
];

function newCdn(settings: ZoneSeed['cdn'] = {}): DemoCdn {
  return {
    ...DEFAULT_CDN,
    ...settings,
    devEnabledAt: null,
    editable: { sslMode: true, alwaysUseHttps: true, developmentMode: true },
  };
}

function generate(): DemoCloudflareState {
  const state: DemoCloudflareState = {
    zones: new Map(),
    nextZone: 1,
    nextRecord: 1,
    nextPurge: 1,
    nextNameservers: 0,
  };
  for (const seed of ZONES) {
    const id = zoneIdOf(state.nextZone++);
    state.zones.set(id, {
      id,
      name: seed.name,
      status: seed.status,
      paused: false,
      type: 'full',
      nameservers: [...seed.nameservers],
      originalNameservers: [...seed.originalNameservers],
      originalRegistrar: seed.originalRegistrar,
      createdAt: seed.createdAt,
      activatedAt: seed.activatedAt,
      records: seed.records.map(([type, name, data, extra]) => ({
        id: recordIdOf(state.nextRecord++),
        type,
        name,
        data,
        ttl: extra?.ttl ?? DNS_TTL_AUTO,
        proxied: extra?.proxied ?? false,
        comment: extra?.comment ?? null,
      })),
      cdn: newCdn(seed.cdn),
    });
  }
  return state;
}

export function demoCloudflareState(connectionId: string): DemoCloudflareState {
  let state = STATE.get(connectionId);
  if (!state) {
    state = generate();
    STATE.set(connectionId, state);
  }
  return state;
}

/** Test helper: forget all simulated Cloudflare state. */
export function resetDemoCloudflare(): void {
  STATE.clear();
}

// --- Rules ---------------------------------------------------------------------------

/** 10/8, 172.16/12, 192.168/16, 127/8 and fc00::/7: Cloudflare cannot proxy to them. */
function isPrivateAddress(type: string, address: string): boolean {
  if (type === 'A' && isIPv4(address)) {
    const [a, b] = address.split('.').map(Number) as [number, number];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (type === 'AAAA' && isIPv6(address)) {
    // An address starting with "::" has 0 in its first 16 bits.
    const first = address.startsWith('::') ? 0 : parseInt(address.split(':')[0]!, 16);
    return (first & 0xfe00) === 0xfc00;
  }
  return false;
}

function isProxiable(record: { type: string; data: string }): boolean {
  return PROXIABLE_TYPES.includes(record.type) && !isPrivateAddress(record.type, record.data);
}

const host = (value: string) => value.toLowerCase().replace(/\.$/, '') || '.';

/**
 * The value as the real adapter reads it back: host names lower-cased without the trailing
 * dot, numbers without leading zeros, CAA values quoted. Shapes the route did not check are
 * kept as they are.
 */
function normalizeData(type: string, data: string): string {
  const value = data.trim();
  const parts = value.split(/\s+/);
  switch (type) {
    case 'AAAA':
      return value.toLowerCase();
    case 'CNAME':
    case 'NS':
    case 'PTR':
      return host(value);
    case 'MX':
      return parts.length === 2 && /^\d+$/.test(parts[0]!) ? `${Number(parts[0])} ${host(parts[1]!)}` : value;
    case 'SRV':
      return parts.length === 4 && parts.slice(0, 3).every((p) => /^\d+$/.test(p))
        ? `${parts.slice(0, 3).map(Number).join(' ')} ${host(parts[3]!)}`
        : value;
    case 'CAA': {
      const match = /^(\d+)\s+(\S+)\s+(.+)$/.exec(value);
      if (!match) return value;
      const quoted = /^"(.*)"$/.exec(match[3]!);
      const text = quoted ? quoted[1]!.replace(/\\(.)/g, '$1') : match[3]!;
      return `${Number(match[1])} ${match[2]} "${text.replace(/["\\]/g, '\\$&')}"`;
    }
    case 'TLSA':
    case 'DS':
      return parts.join(' ');
    default:
      return value;
  }
}

const recordName = (name: string) => name.trim().toLowerCase() || '@';

const sameSet = (a: string[], b: string[]) => {
  const left = new Set(a.map(host));
  const right = new Set(b.map(host));
  return left.size === right.size && [...left].every((ns) => right.has(ns));
};

/**
 * Cloudflare's checks for a record as it would be stored, against the other records of the
 * zone (`ignoreId`: the record being changed). 400 like the API.
 */
function checkRecord(
  zone: DemoZone,
  record: Omit<DemoZoneRecord, 'id' | 'comment'>,
  ignoreId?: string,
): void {
  if (!ACCEPTED_TYPES.includes(record.type)) {
    throw badRequest(`${record.type} records cannot be added or changed at Cloudflare`);
  }
  if (record.type === 'A' && !isIPv4(record.data)) throw badRequest('A records need an IPv4 address');
  if (record.type === 'AAAA' && !isIPv6(record.data)) throw badRequest('AAAA records need an IPv6 address');
  if (record.type === 'NS' && record.name === '@') {
    throw badRequest('Cloudflare manages the name servers of the zone itself');
  }
  if (record.proxied && !PROXIABLE_TYPES.includes(record.type)) {
    throw badRequest('Only A, AAAA and CNAME records can be proxied');
  }
  if (record.proxied && !isProxiable(record)) {
    throw badRequest(`${record.data} is a private address, Cloudflare cannot proxy it`);
  }
  if (record.ttl !== DNS_TTL_AUTO && (record.ttl < CLOUDFLARE_TTL_MIN || record.ttl > CLOUDFLARE_TTL_MAX)) {
    throw badRequest(
      `TTL must be ${DNS_TTL_AUTO} (automatic) or between ${CLOUDFLARE_TTL_MIN} and ${CLOUDFLARE_TTL_MAX} seconds`,
    );
  }
  const sameName = zone.records.filter((r) => r.id !== ignoreId && r.name === record.name);
  if (record.type === 'CNAME' ? sameName.length > 0 : sameName.some((r) => r.type === 'CNAME')) {
    throw badRequest('An A, AAAA, or CNAME record with that host already exists.');
  }
  if (record.type === 'NS' ? sameName.some((r) => r.type !== 'NS') : sameName.some((r) => r.type === 'NS')) {
    throw badRequest('NS records cannot share their name with records of other types.');
  }
  if (sameName.some((r) => r.type === record.type && r.data === record.data)) {
    throw badRequest('An identical record already exists.');
  }
}

/** The record as stored, with Cloudflare's defaults: automatic TTL, not proxied; proxied means TTL 1. */
function storedRecord(
  input: { type: string; name: string; data: string; ttl?: number | null; proxied?: boolean },
  fallbackTtl: number = DNS_TTL_AUTO,
): Omit<DemoZoneRecord, 'id' | 'comment'> {
  const type = input.type.toUpperCase();
  const proxied = input.proxied ?? false;
  return {
    type,
    name: recordName(input.name),
    data: normalizeData(type, input.data),
    ttl: proxied ? DNS_TTL_AUTO : (input.ttl ?? fallbackTtl),
    proxied,
  };
}

function toDnsRecord(record: DemoZoneRecord): DnsRecord {
  return {
    id: record.id,
    type: record.type,
    name: record.name,
    data: record.data,
    ttl: record.ttl,
    ...(ACCEPTED_TYPES.includes(record.type) ? {} : { readOnly: true }),
    proxied: record.proxied,
    proxiable: isProxiable(record),
    comment: record.comment,
  };
}

/** Like Cloudflare: a pending zone turns active once the registry delegates to its name servers. */
function settleActivation(zone: DemoZone): void {
  if (zone.status !== 'pending') return;
  const delegation = demoDelegation(zone.name);
  if (!delegation || !sameSet(delegation, zone.nameservers)) return;
  zone.status = 'active';
  zone.activatedAt = new Date().toISOString();
}

function toInfo(zone: DemoZone): DomainInfo {
  return {
    name: zone.name,
    status: zone.status,
    terminated: false,
    nameservers: [...zone.nameservers],
    handle: null,
    createdAt: zone.createdAt,
    expiresAt: null,
    autoRenew: null,
    providerDns: zone.status === 'active',
    zone: {
      status: zone.status,
      type: zone.type,
      paused: zone.paused,
      originalNameservers: [...zone.originalNameservers],
      originalRegistrar: zone.originalRegistrar,
      activatedAt: zone.activatedAt,
      plan: PLAN.name,
    },
  };
}

function toRemote(zone: DemoZone): RemoteDomain {
  return {
    externalId: zone.id,
    name: zone.name,
    status: zone.status,
    info: toInfo(zone),
    meta: { zoneType: zone.type, plan: PLAN.legacyId, accountId: DEMO_CLOUDFLARE_ACCOUNT.id },
  };
}

/** Seconds left in development mode, null while off. Switches it off after 3 hours. */
function developmentRemaining(cdn: DemoCdn): number | null {
  if (cdn.devEnabledAt === null) return null;
  const remaining = DEV_MODE_SECONDS - Math.floor((Date.now() - cdn.devEnabledAt) / 1000);
  if (remaining > 0) return remaining;
  cdn.devEnabledAt = null;
  return null;
}

/** Lower-case ASCII host name with at least two labels, like the real adapter accepts. */
function zoneName(name: string): string {
  const value = name.trim().toLowerCase().replace(/\.$/, '');
  if ([...value].some((c) => c.charCodeAt(0) > 127)) {
    throw badRequest(`${name} is not an ASCII name, use the xn-- form`);
  }
  if (!ZONE_NAME.test(value)) throw badRequest(`${name} is not a valid zone name`);
  return value;
}

// --- Adapter -------------------------------------------------------------------------

export class DemoCloudflareAdapter implements ProviderAdapter {
  readonly type = 'demo' as const;

  constructor(private readonly connectionId: string) {}

  /** Looked up on every call, so a cached adapter sees the state after resetDemoCloudflare. */
  private get state(): DemoCloudflareState {
    return demoCloudflareState(this.connectionId);
  }

  private zone(externalId: string): DemoZone {
    const zone = this.state.zones.get(externalId);
    if (!zone) throw notFound('Zone');
    return zone;
  }

  private record(zone: DemoZone, recordId: string): DemoZoneRecord {
    const record = zone.records.find((r) => r.id === recordId);
    if (!record) throw notFound('DNS record');
    return record;
  }

  /** Every zone, pending ones activated when their delegation arrived. */
  private zones(): DemoZone[] {
    const zones = [...this.state.zones.values()];
    zones.forEach(settleActivation);
    return zones;
  }

  capabilities(): Capability[] {
    return [];
  }

  powerActions(): PowerAction[] {
    return [];
  }

  async testConnection(): Promise<Record<string, unknown>> {
    return {
      token: 'active',
      tokenExpires: null,
      account: DEMO_CLOUDFLARE_ACCOUNT.name,
      accountId: DEMO_CLOUDFLARE_ACCOUNT.id,
      zones: this.state.zones.size,
      zoneCreation: true,
    };
  }

  async listServers(): Promise<RemoteServer[]> {
    return [];
  }

  async getServer(_ref: ServerRef): Promise<RemoteServer> {
    throw new ProviderError(CLOUDFLARE_PROVIDER, 'Cloudflare has no servers', 404);
  }

  async overview(): Promise<InfraOverview> {
    const zones = this.zones();
    const count = (status: ZoneStatus) => String(zones.filter((z) => z.status === status).length);
    return {
      nodes: [],
      storages: [],
      facts: [
        { label: 'Account', value: DEMO_CLOUDFLARE_ACCOUNT.name },
        { label: 'Zones', value: String(zones.length) },
        { label: 'Active', value: count('active') },
        { label: 'Pending', value: count('pending') },
        { label: 'Moved', value: count('moved') },
        { label: 'Zone creation', value: 'yes' },
      ],
    };
  }

  // --- Zones ------------------------------------------------------------------------

  async listDomains(): Promise<RemoteDomain[]> {
    return this.zones().map(toRemote);
  }

  async getDomain(externalId: string): Promise<DomainInfo> {
    const zone = this.zone(externalId);
    settleActivation(zone);
    return toInfo(zone);
  }

  domainKind(): DomainKind {
    return 'zone';
  }

  domainCapabilities(): DomainCapability[] {
    return [...CLOUDFLARE_DOMAIN_CAPABILITIES];
  }

  dnsRecordTypes(): DnsRecordType[] {
    return [...CLOUDFLARE_RECORD_TYPES];
  }

  async dnsWritable(): Promise<boolean> {
    return true;
  }

  canCreateZones(): boolean {
    return true;
  }

  /** A pending zone with the next name servers of the pool; an existing name is reused. Never imports records. */
  async createZone(name: string): Promise<{ zone: RemoteDomain; created: boolean }> {
    const state = this.state;
    const wanted = zoneName(name);
    const existing = [...state.zones.values()].find((z) => z.name === wanted);
    if (existing) return { zone: toRemote(existing), created: false };
    const pair = NAMESERVER_POOL[state.nextNameservers++ % NAMESERVER_POOL.length]!;
    const zone: DemoZone = {
      id: zoneIdOf(state.nextZone++),
      name: wanted,
      status: 'pending',
      paused: false,
      type: 'full',
      nameservers: cloudflareNs(...pair),
      originalNameservers: demoDelegation(wanted) ?? [],
      originalRegistrar: null,
      createdAt: new Date().toISOString(),
      activatedAt: null,
      records: [],
      cdn: newCdn(),
    };
    state.zones.set(zone.id, zone);
    return { zone: toRemote(zone), created: true };
  }

  async checkZoneActivation(externalId: string): Promise<ActionResult> {
    const zone = this.zone(externalId);
    if (zone.status !== 'pending') {
      throw conflict(`${zone.name} is not waiting for activation (status ${zone.status})`);
    }
    settleActivation(zone);
    return { providerRef: null, message: 'Activation check requested' };
  }

  // --- DNS records --------------------------------------------------------------------

  async listDnsRecords(externalId: string): Promise<DnsRecord[]> {
    return this.zone(externalId).records.map(toDnsRecord);
  }

  async addDnsRecord(externalId: string, input: DnsRecordInput): Promise<DnsRecord> {
    const state = this.state;
    const zone = this.zone(externalId);
    const candidate = storedRecord(input);
    checkRecord(zone, candidate);
    const record: DemoZoneRecord = { ...candidate, id: recordIdOf(state.nextRecord++), comment: null };
    zone.records.push(record);
    return toDnsRecord(record);
  }

  /**
   * Fields left out keep their value, the TTL and the proxy included. A type change replaces
   * the record (new id, comment dropped) like the real adapter's batch call.
   */
  async updateDnsRecord(externalId: string, recordId: string, patch: DnsRecordPatch): Promise<DnsRecord> {
    const zone = this.zone(externalId);
    const current = this.record(zone, recordId);
    if (!ACCEPTED_TYPES.includes(current.type)) {
      throw badRequest(`${current.type} records cannot be changed, only deleted`);
    }
    const candidate = storedRecord(
      {
        type: patch.type ?? current.type,
        name: patch.name ?? current.name,
        data: patch.data ?? current.data,
        ttl: patch.ttl,
        proxied: patch.proxied ?? current.proxied,
      },
      current.ttl,
    );
    checkRecord(zone, candidate, current.id);
    if (candidate.type === current.type) {
      Object.assign(current, candidate);
      return toDnsRecord(current);
    }
    const replacement: DemoZoneRecord = {
      ...candidate,
      id: recordIdOf(this.state.nextRecord++),
      comment: null,
    };
    zone.records = [...zone.records.filter((r) => r.id !== current.id), replacement];
    return toDnsRecord(replacement);
  }

  /** Read-only types (HTTPS, ...) can be deleted too. */
  async deleteDnsRecord(externalId: string, recordId: string): Promise<void> {
    const zone = this.zone(externalId);
    const record = this.record(zone, recordId);
    zone.records = zone.records.filter((r) => r !== record);
  }

  // --- CDN ----------------------------------------------------------------------------

  async getCdnSettings(externalId: string): Promise<CdnSettings> {
    const cdn = this.zone(externalId).cdn;
    const remaining = developmentRemaining(cdn);
    return {
      sslMode: cdn.sslMode,
      sslAutomatic: cdn.sslAutomatic,
      alwaysUseHttps: cdn.alwaysUseHttps,
      developmentMode: remaining !== null,
      developmentModeRemaining: remaining,
      editable: { ...cdn.editable },
    };
  }

  async updateCdnSetting(externalId: string, patch: CdnSettingPatch): Promise<CdnSettings> {
    const cdn = this.zone(externalId).cdn;
    if (Object.keys(patch).length !== 1) throw badRequest('Change exactly one CDN setting at a time');
    if ('sslMode' in patch) {
      if (!SSL_MODES.includes(patch.sslMode)) throw badRequest(`Unknown SSL/TLS mode ${patch.sslMode}`);
      if (!cdn.editable.sslMode) throw unsupported('The SSL/TLS mode of this zone cannot be changed');
      if (patch.sslMode === 'auto') {
        // Cloudflare scans the origin and may raise the mode; the simulated origin supports Full.
        cdn.sslAutomatic = true;
        if (cdn.sslMode !== 'strict') cdn.sslMode = 'full';
      } else {
        // A manual mode first switches Automatic SSL/TLS to "custom".
        cdn.sslAutomatic = false;
        cdn.sslMode = patch.sslMode;
      }
    } else if ('alwaysUseHttps' in patch) {
      if (!cdn.editable.alwaysUseHttps) throw unsupported('Always Use HTTPS cannot be changed for this zone');
      cdn.alwaysUseHttps = patch.alwaysUseHttps;
    } else if ('developmentMode' in patch) {
      if (!cdn.editable.developmentMode)
        throw unsupported('Development mode cannot be changed for this zone');
      // Switching it on again starts the 3 hours anew, like at Cloudflare.
      cdn.devEnabledAt = patch.developmentMode ? Date.now() : null;
    } else {
      throw badRequest('Unknown CDN setting');
    }
    return this.getCdnSettings(externalId);
  }

  async purgeCache(externalId: string): Promise<ActionResult> {
    this.zone(externalId);
    return { providerRef: `demo-purge-${this.state.nextPurge++}`, message: 'Purge accepted' };
  }

  async rawRequest(method: string, path: string, body?: Record<string, unknown>): Promise<RawResponse> {
    return { status: 200, data: { method, path, body: body ?? null, note: 'Demo provider echo' } };
  }
}
