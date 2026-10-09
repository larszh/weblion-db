import type {
  Capability,
  DnsRecord,
  DnsRecordInput,
  DnsRecordType,
  DomainCapability,
  DomainInfo,
  PowerAction,
} from '@weblion/shared';
import { AppError, ProviderError, badRequest, notFound, unsupported } from '../../lib/errors';
import type {
  ActionResult,
  DnsRecordPatch,
  InfraOverview,
  JokerConfig,
  ProviderAdapter,
  RawResponse,
  RemoteDomain,
  RemoteServer,
  ServerRef,
} from '../types';
import { DmapiClient, type DmapiClientOptions, type DmapiParams, type DmapiResponse } from './client';
import {
  DEFAULT_TTL,
  JOKER_RECORD_TYPES,
  appendIndex,
  buildZoneLine,
  checkTtl,
  headerValue,
  normalizeHost,
  parseAuthcodeResult,
  parseDomainList,
  parseProfile,
  parseWhois,
  parseZone,
  parseZoneList,
  redactAuthcodes,
  redactDyndns,
  serializeZone,
  statusFromFlags,
  terminatedFromFlags,
  toDnsRecord,
  zoneRecords,
  type DmapiHeader,
  type DmapiReply,
  type JokerListedDomain,
  type JokerProfile,
  type ParsedZone,
} from './parse';

const PROVIDER = 'Joker';

/** Zones served by Joker's name servers, used for every DNS list and domain detail. */
const ZONES_TTL_MS = 5 * 60_000;
/** How long the Proc-ID of an auth code request is reused instead of asking for a new code. */
const AUTHCODE_PROC_TTL_MS = 30 * 60_000;
const AUTHCODE_WAIT_MS = 12_000;
const AUTHCODE_POLL_MS = 2_000;

const CAPABILITIES: DomainCapability[] = [
  'dns',
  'dnsTtl',
  'nameservers',
  'lock',
  'autoRenew',
  'renew',
  'authcode',
];

/** Replies of these requests may contain the transfer auth code. */
const AUTHCODE_REQUESTS = new Set(['result-retrieve', 'domain-transfer-get-auth-id']);
/**
 * DMAPI requests that only read. The explorer audits every method but GET, so only these
 * may be sent as GET; everything else must come as POST and lands in the audit log.
 */
const READ_REQUESTS = /^(query-[a-z-]+|dns-zone-(list|get)|result-(list|retrieve)|domain-check)$/;

/** Lower-case ASCII host name with at least two labels (domains and name servers). */
const HOST_NAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

export interface JokerAdapterOptions extends DmapiClientOptions {
  /** How long getDomainAuthcode waits for Joker to produce the code. */
  authcodeWaitMs?: number;
  authcodePollMs?: number;
}

/**
 * The domain as a DMAPI parameter. Joker accepts patterns in some requests
 * (domain-set-property), so anything but a plain name is refused.
 */
function domainParam(externalId: string): string {
  const domain = normalizeHost(externalId);
  if (!HOST_NAME.test(domain)) throw badRequest(`Invalid domain name "${externalId}"`);
  return domain;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function procRef(res: DmapiResponse): string | null {
  return headerValue(res, 'Proc-ID');
}

/** Header lines as an object for the API explorer; repeated headers become arrays. */
function headerObject(headers: DmapiHeader[]): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  const names = new Map<string, string>();
  for (const h of headers) {
    const name = names.get(h.name.toLowerCase()) ?? h.name;
    names.set(h.name.toLowerCase(), name);
    const current = out[name];
    if (current === undefined) out[name] = h.value;
    else out[name] = Array.isArray(current) ? [...current, h.value] : [current, h.value];
  }
  return out;
}

/**
 * Joker.com (DMAPI): domains and Joker's DNS zones, no servers. Domains are addressed by
 * their lower-case ASCII name. DNS changes rewrite the whole zone (dns-zone-get, change,
 * dns-zone-put), serialized per domain. Registry changes (name servers, lock, renewal) run
 * asynchronously at Joker; their Proc-ID is returned as providerRef.
 */
export class JokerAdapter implements ProviderAdapter {
  readonly type = 'joker' as const;
  private readonly client: DmapiClient;
  private readonly authcodeWaitMs: number;
  private readonly authcodePollMs: number;
  private zonesCache: { at: number; value: Promise<Set<string>> } | null = null;
  private readonly zoneLocks = new Map<string, Promise<unknown>>();
  /** Pending auth code requests per domain. Only the Proc-ID is kept, never the code. */
  private readonly authcodeRequests = new Map<string, { at: number; procId: Promise<string> }>();

  constructor(config: JokerConfig, options: JokerAdapterOptions = {}) {
    this.client = new DmapiClient(config, options);
    this.authcodeWaitMs = options.authcodeWaitMs ?? AUTHCODE_WAIT_MS;
    this.authcodePollMs = options.authcodePollMs ?? AUTHCODE_POLL_MS;
  }

  capabilities(): Capability[] {
    return [];
  }

  powerActions(): PowerAction[] {
    return [];
  }

  async listServers(): Promise<RemoteServer[]> {
    return [];
  }

  async getServer(ref: ServerRef): Promise<RemoteServer> {
    throw new ProviderError(PROVIDER, `Joker.com has no servers (${ref.externalId})`, 404);
  }

  // --- Account --------------------------------------------------------------------

  private async profile(): Promise<JokerProfile> {
    return parseProfile(await this.client.call('query-profile'));
  }

  private async domainList(): Promise<JokerListedDomain[]> {
    return parseDomainList(await this.client.call('query-domain-list', { showstatus: 1, showjokerns: 1 }));
  }

  private zones(refresh = false): Promise<Set<string>> {
    if (!refresh && this.zonesCache && Date.now() - this.zonesCache.at < ZONES_TTL_MS) {
      return this.zonesCache.value;
    }
    const value = this.client.call('dns-zone-list').then((res) => new Set(parseZoneList(res.body)));
    this.zonesCache = { at: Date.now(), value };
    value.catch(() => {
      if (this.zonesCache?.value === value) this.zonesCache = null;
    });
    return value;
  }

  async testConnection(): Promise<Record<string, unknown>> {
    const login = await this.client.login();
    const [profile, domains] = await Promise.all([this.profile(), this.domainList()]);
    return {
      account: profile.account ?? headerValue(login, 'UID'),
      balance: profile.balance,
      currency: profile.currency,
      domains: domains.length,
    };
  }

  async overview(): Promise<InfraOverview> {
    const [profile, domains, zones] = await Promise.all([
      this.profile().catch(() => null),
      this.domainList(),
      this.zones(true).catch(() => null),
    ]);
    const facts: InfraOverview['facts'] = [];
    if (profile?.account) facts.push({ label: 'Account', value: profile.account });
    if (profile?.balance !== null && profile?.balance !== undefined) {
      const balance = profile.balance.toFixed(2);
      facts.push({ label: 'Balance', value: profile.currency ? `${balance} ${profile.currency}` : balance });
    }
    facts.push({ label: 'Domains', value: String(domains.length) });
    if (zones) facts.push({ label: 'DNS zones at Joker', value: String(zones.size) });
    return { nodes: [], storages: [], facts };
  }

  // --- Domains --------------------------------------------------------------------

  /** One query-domain-list call: expiry and flags only, the whois runs per domain on demand. */
  async listDomains(): Promise<RemoteDomain[]> {
    return (await this.domainList()).map((d) => {
      const info: Partial<DomainInfo> = { name: d.name };
      if (d.expiresAt) info.expiresAt = d.expiresAt;
      if (d.flags) {
        info.status = statusFromFlags(d.flags);
        info.terminated = terminatedFromFlags(d.flags);
        info.autoRenew = d.flags.includes('autorenew');
        info.locked = d.flags.includes('lock') || d.flags.includes('locked');
      }
      if (d.jokerNs !== null) info.providerDns = d.jokerNs;
      return {
        externalId: d.name,
        name: d.name,
        status: info.status ?? null,
        info,
        meta: d.flags ? { flags: d.flags } : {},
      };
    });
  }

  async getDomain(externalId: string): Promise<DomainInfo> {
    const domain = domainParam(externalId);
    const [whois, zones] = await Promise.all([
      this.client.call('query-whois', { domain }),
      this.zones().catch(() => null),
    ]);
    return { ...parseWhois(whois.body, domain), providerDns: zones ? zones.has(domain) : null };
  }

  domainCapabilities(): DomainCapability[] {
    return [...CAPABILITIES];
  }

  dnsRecordTypes(): DnsRecordType[] {
    return [...JOKER_RECORD_TYPES];
  }

  async setNameservers(externalId: string, nameservers: string[]): Promise<ActionResult> {
    const domain = domainParam(externalId);
    const list = nameservers.map(normalizeHost);
    if (list.length < 2 || list.length > 13) throw badRequest('Between 2 and 13 name servers are needed');
    for (const ns of list) {
      if (!HOST_NAME.test(ns)) throw badRequest(`Invalid name server "${ns}"`);
    }
    const duplicate = list.find((ns, i) => list.indexOf(ns) !== i);
    if (duplicate) throw badRequest(`Name server "${duplicate}" is listed twice`);
    const res = await this.client.call('domain-modify', { domain, 'ns-list': list.join(':') });
    return { providerRef: procRef(res), message: 'Name server change submitted' };
  }

  async setDomainLock(externalId: string, locked: boolean): Promise<ActionResult> {
    const domain = domainParam(externalId);
    const res = await this.client.call(locked ? 'domain-lock' : 'domain-unlock', { domain });
    return {
      providerRef: procRef(res),
      message: locked ? 'Transfer lock requested' : 'Transfer unlock requested',
    };
  }

  async setDomainAutoRenew(externalId: string, enabled: boolean): Promise<ActionResult> {
    const domain = domainParam(externalId);
    const res = await this.client.call('domain-set-property', {
      domain,
      pname: 'autorenew',
      pvalue: enabled ? '1' : '0',
    });
    return { providerRef: procRef(res), message: enabled ? 'Auto-renew enabled' : 'Auto-renew disabled' };
  }

  /**
   * Renews up to a target year (expyear) instead of by a period: a repeated request cannot
   * renew twice, Joker skips it once the domain runs until that year.
   */
  async renewDomain(externalId: string, years: number): Promise<ActionResult> {
    const domain = domainParam(externalId);
    if (!Number.isInteger(years) || years < 1 || years > 10) {
      throw badRequest('A renewal covers 1 to 10 years');
    }
    const whois = parseWhois((await this.client.call('query-whois', { domain })).body, domain);
    if (!whois.expiresAt) {
      throw new ProviderError(PROVIDER, `the expiry date of ${domain} is unknown, renewal not sent`);
    }
    const expyear = new Date(whois.expiresAt).getUTCFullYear() + years;
    const res = await this.client.call('domain-renew', { domain, expyear });
    return { providerRef: procRef(res), message: `Renewal until ${expyear} submitted` };
  }

  /**
   * Joker creates the auth code asynchronously and every request invalidates the previous
   * code. The Proc-ID is remembered per domain, so a retry polls the same request instead of
   * starting a new one. The code itself is returned only, never kept or logged.
   */
  async getDomainAuthcode(externalId: string): Promise<string | null> {
    const domain = domainParam(externalId);
    const request = this.authcodeRequest(domain);
    const procId = await request.procId;
    const forget = () => {
      if (this.authcodeRequests.get(domain) === request) this.authcodeRequests.delete(domain);
    };
    const deadline = Date.now() + this.authcodeWaitMs;
    for (;;) {
      // Until the job is done result-retrieve may answer with a DMAPI error: keep waiting.
      // Network and HTTP errors (e.g. a failed new login) are real failures.
      const result = await this.client
        .call('result-retrieve', { 'proc-id': procId })
        .then(parseAuthcodeResult, (err: unknown) => {
          if (err instanceof ProviderError && err.upstreamStatus === 200) return null;
          throw err;
        });
      if (result?.authcode) {
        forget();
        return result.authcode;
      }
      if (result?.status === 'nack') {
        forget();
        throw new ProviderError(
          PROVIDER,
          `the auth code request was refused${result.message ? `: ${result.message}` : ''} (Proc-ID ${procId})`,
        );
      }
      if (result?.status === 'ack') {
        forget();
        throw new ProviderError(
          PROVIDER,
          `the auth code request completed without a code (Proc-ID ${procId})`,
        );
      }
      if (Date.now() + this.authcodePollMs > deadline) {
        throw new AppError(
          409,
          'authcode_pending',
          'Joker is still generating the auth code, try again in a minute',
        );
      }
      await sleep(this.authcodePollMs);
    }
  }

  private authcodeRequest(domain: string): { at: number; procId: Promise<string> } {
    const existing = this.authcodeRequests.get(domain);
    if (existing && Date.now() - existing.at < AUTHCODE_PROC_TTL_MS) return existing;
    const procId = this.client.call('domain-transfer-get-auth-id', { domain }).then((res) => {
      const id = procRef(res);
      if (!id) throw new ProviderError(PROVIDER, 'domain-transfer-get-auth-id returned no Proc-ID');
      return id;
    });
    const request = { at: Date.now(), procId };
    this.authcodeRequests.set(domain, request);
    procId.catch(() => {
      if (this.authcodeRequests.get(domain) === request) this.authcodeRequests.delete(domain);
    });
    return request;
  }

  // --- DNS ------------------------------------------------------------------------

  async listDnsRecords(externalId: string): Promise<DnsRecord[]> {
    const domain = domainParam(externalId);
    // Domains with other name servers have no zone at Joker.
    if (!(await this.zones()).has(domain)) return [];
    return zoneRecords(await this.loadZone(domain));
  }

  async dnsWritable(): Promise<boolean> {
    return true;
  }

  async addDnsRecord(externalId: string, input: DnsRecordInput): Promise<DnsRecord | null> {
    const domain = domainParam(externalId);
    if (input.ttl !== undefined && input.ttl !== null) checkTtl(input.type, input.ttl);
    const line = buildZoneLine({ ...input, ttl: input.ttl ?? DEFAULT_TTL });
    return this.changeZone(domain, (zone) => {
      const index = appendIndex(zone);
      zone.lines.splice(index, 0, { raw: line, entry: null });
      return index;
    });
  }

  async updateDnsRecord(
    externalId: string,
    recordId: string,
    patch: DnsRecordPatch,
  ): Promise<DnsRecord | null> {
    const domain = domainParam(externalId);
    return this.changeZone(domain, (zone) => {
      const index = this.findRecord(zone, recordId);
      const current = zone.lines[index]!.entry!;
      if (current.readOnly) {
        throw badRequest(`${current.type} records cannot be changed in the panel, only deleted`);
      }
      const nextType = patch.type ?? current.type;
      if (patch.ttl !== undefined && patch.ttl !== null) checkTtl(nextType, patch.ttl);
      const line = buildZoneLine(
        {
          type: nextType,
          name: patch.name ?? current.name,
          data: patch.data ?? current.data,
          // A changed record keeps its TTL unless a new one is given.
          ttl: patch.ttl ?? current.ttl ?? DEFAULT_TTL,
        },
        nextType === current.type ? current.tail : '',
      );
      zone.lines[index] = { raw: line, entry: null };
      return index;
    });
  }

  async deleteDnsRecord(externalId: string, recordId: string): Promise<void> {
    const domain = domainParam(externalId);
    await this.changeZone(domain, (zone) => {
      zone.lines.splice(this.findRecord(zone, recordId), 1);
      return null;
    });
  }

  private findRecord(zone: ParsedZone, recordId: string): number {
    const index = zone.lines.findIndex((l) => l.entry?.id === recordId);
    // Ids derive from the content: a record changed or removed meanwhile is not found.
    if (index < 0) throw notFound('DNS record');
    return index;
  }

  private async loadZone(domain: string): Promise<ParsedZone> {
    return parseZone((await this.client.call('dns-zone-get', { domain })).body);
  }

  /**
   * Read-modify-write of the whole zone under a per-domain lock. `change` edits the parsed
   * lines and returns the index of the new or changed line; untouched lines are written back
   * byte for byte. Returns that record as it reads from the written zone.
   */
  private async changeZone(
    domain: string,
    change: (zone: ParsedZone) => number | null,
  ): Promise<DnsRecord | null> {
    return this.withZoneLock(domain, async () => {
      if (!(await this.zones()).has(domain) && !(await this.zones(true)).has(domain)) {
        throw unsupported(
          `${domain} does not use the Joker.com name servers, its DNS records are managed elsewhere`,
        );
      }
      const zone = await this.loadZone(domain);
      const index = change(zone);
      const text = serializeZone(zone);
      await this.client.call('dns-zone-put', { domain, zone: text });
      if (index === null) return null;
      const entry = parseZone(text).lines[index]?.entry;
      return entry ? toDnsRecord(entry) : null;
    });
  }

  private async withZoneLock<T>(domain: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.zoneLocks.get(domain) ?? Promise.resolve();
    const run = previous.then(fn);
    const done = run.catch(() => undefined);
    this.zoneLocks.set(domain, done);
    try {
      return await run;
    } finally {
      if (this.zoneLocks.get(domain) === done) this.zoneLocks.delete(domain);
    }
  }

  // --- Admin ----------------------------------------------------------------------

  /**
   * DMAPI explorer: `path` is the request name with an optional query string, e.g.
   * "/query-whois?domain=example.com"; query and body become the request parameters. Always
   * sent as POST with the panel's session; `method` GET is only accepted for read requests
   * (see READ_REQUESTS). Auth codes and DynDNS passwords are redacted.
   */
  async rawRequest(method: string, path: string, body?: Record<string, unknown>): Promise<RawResponse> {
    const trimmed = path
      .trim()
      .replace(/^\/+/, '')
      .replace(/^request\//i, '');
    const q = trimmed.indexOf('?');
    const request = (q >= 0 ? trimmed.slice(0, q) : trimmed).toLowerCase();
    if (!/^[a-z][a-z0-9-]*$/.test(request)) {
      throw badRequest('Joker paths are DMAPI request names, e.g. /query-domain-list');
    }
    if (request === 'login' || request === 'logout') {
      throw unsupported('login and logout are handled by the panel');
    }
    if (method.toUpperCase() === 'GET' && !READ_REQUESTS.test(request)) {
      throw badRequest(`${request} can change data at Joker, send it as POST`);
    }
    const params: DmapiParams = {};
    for (const [key, value] of new URLSearchParams(q >= 0 ? trimmed.slice(q + 1) : '')) params[key] = value;
    for (const [key, value] of Object.entries(body ?? {})) {
      if (value === undefined || value === null) continue;
      params[key] = typeof value === 'object' ? JSON.stringify(value) : (value as string | number | boolean);
    }
    for (const key of Object.keys(params)) if (key.toLowerCase() === 'auth-sid') delete params[key];

    const res = await this.client.raw(request, params);
    let reply: DmapiReply = { headers: res.headers, body: res.body };
    if (AUTHCODE_REQUESTS.has(request)) reply = redactAuthcodes(reply);
    if (request === 'dns-zone-get') reply = { ...reply, body: redactDyndns(reply.body) };
    const headers = reply.headers.map((h) =>
      h.name.toLowerCase() === 'auth-sid' ? { ...h, value: '[redacted]' } : h,
    );
    return { status: res.httpStatus, data: { headers: headerObject(headers), body: reply.body } };
  }
}
