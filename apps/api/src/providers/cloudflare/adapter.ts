import {
  CDN_SSL_MODES,
  type Capability,
  type CdnSettingPatch,
  type CdnSettings,
  type DnsRecord,
  type DnsRecordInput,
  type DnsRecordType,
  type DomainCapability,
  type DomainInfo,
  type DomainKind,
  type PowerAction,
} from '@weblion/shared';
import { ProviderError, badRequest, conflict, notFound, unsupported } from '../../lib/errors';
import { isRecord, num } from '../http';
import type {
  ActionResult,
  CloudflareConfig,
  DnsRecordPatch,
  InfraOverview,
  ProviderAdapter,
  RawResponse,
  RemoteDomain,
  RemoteServer,
  ServerRef,
} from '../types';
import { CloudflareClient, cloudflareCodes, type CloudflareClientOptions, type Query } from './client';
import {
  CLOUDFLARE_DOMAIN_CAPABILITIES,
  CLOUDFLARE_ID,
  CLOUDFLARE_PROVIDER as PROVIDER,
  CLOUDFLARE_RECORD_TYPES,
} from './constants';
import {
  parseCdn,
  recordBody,
  recordPatch,
  redactSecrets,
  toDnsRecord,
  zoneToInfo,
  zoneToRemote,
  type CfDnsRecord,
  type CfSetting,
  type CfZone,
} from './parse';

/** Cloudflare's maximum page size for zones. */
const ZONES_PER_PAGE = 50;
/** 200 pages of 50 = 10,000 zones, far beyond the panel's accounts. Stops runaway loops. */
const ZONES_MAX_PAGES = 200;
/** The spec allows more per page (UNVERIFIED real limit); 1000 keeps answers small. */
const RECORDS_PER_PAGE = 1000;
/** 50 pages of 1000 = 50,000 records. */
const RECORDS_MAX_PAGES = 50;

/**
 * Views (domain detail, DNS tab, CDN tab) poll per viewer, and the rate limit is shared by
 * every customer on the connection. Their answers are shared for this long; changes made
 * through the panel clear them. Per process: another API instance may show older values.
 */
const ZONE_TTL_MS = 30_000;
const RECORDS_TTL_MS = 15_000;
const CDN_TTL_MS = 30_000;

/** Cloudflare's code for "zone already exists" (UNVERIFIED); the message is matched too. */
const ZONE_EXISTS = 1061;
/** "Record does not exist" (UNVERIFIED), besides HTTP 404. */
const RECORD_MISSING = 81044;

/** Lower-case ASCII host name with at least two labels. */
const HOST_NAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

const SECONDARY_ZONE =
  'Records of a secondary zone come from its primary name server and cannot be changed at Cloudflare';

/** Values per key, each shared until its TTL is over. Failed loads are not kept. */
class ReadCache {
  private readonly entries = new Map<string, { at: number; value: Promise<unknown> }>();

  get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.entries.get(key);
    if (hit && now - hit.at < ttlMs) return hit.value as Promise<T>;
    if (this.entries.size >= 500) this.prune(now);
    const value = load();
    const entry = { at: now, value };
    this.entries.set(key, entry);
    value.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return value;
  }

  /** Forgets everything read for one zone (keys start with "<zone id>:"). */
  forget(zoneKey: string) {
    for (const key of this.entries.keys()) if (key.startsWith(`${zoneKey}:`)) this.entries.delete(key);
  }

  /** Drops what no TTL would serve anymore (the longest is 30 s). */
  private prune(now: number) {
    for (const [key, entry] of this.entries) {
      if (now - entry.at >= Math.max(ZONE_TTL_MS, RECORDS_TTL_MS, CDN_TTL_MS)) this.entries.delete(key);
    }
  }
}

interface ZoneFacts {
  name: string;
  type: string | null;
}

function zoneId(externalId: string): string {
  if (!CLOUDFLARE_ID.test(externalId)) {
    throw new ProviderError(PROVIDER, `invalid zone id "${externalId.slice(0, 64)}"`, 404);
  }
  return externalId;
}

function dnsRecordId(recordId: string): string {
  if (!CLOUDFLARE_ID.test(recordId)) throw notFound('DNS record');
  return recordId;
}

function isUpstream(err: unknown, ...statuses: number[]): err is ProviderError {
  return err instanceof ProviderError && statuses.includes(err.upstreamStatus ?? 0);
}

function isZone(value: unknown): value is CfZone {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string';
}

function isDnsRecord(value: unknown): value is CfDnsRecord {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.type === 'string'
  );
}

/** A zone name for POST /zones: lower-case ASCII (punycode), at least two labels. */
function zoneNameParam(name: string): string {
  const value = name.trim().toLowerCase().replace(/\.$/, '');
  if (/[^\x00-\x7f]/.test(value))
    throw badRequest(`Use the xn-- form of "${name.trim()}" to create the zone`);
  if (!HOST_NAME.test(value)) throw badRequest(`Invalid domain name "${name.trim()}"`);
  return value;
}

/** Explorer body values as query parameters: arrays repeated, objects as JSON. */
function toQuery(values: Record<string, unknown>): Query {
  const query: Query = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    query[key] = Array.isArray(value)
      ? value.map((v) => (isRecord(v) || Array.isArray(v) ? JSON.stringify(v) : String(v)))
      : isRecord(value)
        ? JSON.stringify(value)
        : (value as string | number | boolean);
  }
  return query;
}

/** "zone already exists" from POST /zones. */
function alreadyExists(err: unknown): boolean {
  if (!(err instanceof ProviderError)) return false;
  return cloudflareCodes(err).includes(ZONE_EXISTS) || /already exists/i.test(err.message);
}

/**
 * Cloudflare (DNS zones and CDN settings), no servers. Zones are addressed by their 32 hex
 * id and appear as domains of kind "zone"; records by their id, which stays the same across
 * edits (a type change creates a new record). One API token per connection; the account id
 * is optional and only needed to create zones.
 */
export class CloudflareAdapter implements ProviderAdapter {
  readonly type = 'cloudflare' as const;
  readonly client: CloudflareClient;
  /** Lower-case 32 hex id, null without one (or with an invalid one, see testConnection). */
  private readonly accountId: string | null;
  private readonly invalidAccountId: boolean;
  /** Name and type per zone id, filled by every zone read. Names never change for an id. */
  private readonly zones = new Map<string, ZoneFacts>();
  private readonly reads = new ReadCache();

  constructor(config: CloudflareConfig, options: CloudflareClientOptions = {}) {
    this.client = new CloudflareClient(config, options);
    const accountId = config.accountId?.trim().toLowerCase() || null;
    // The id goes into request paths: anything but 32 hex characters is never used.
    this.invalidAccountId = accountId !== null && !CLOUDFLARE_ID.test(accountId);
    this.accountId = accountId !== null && !this.invalidAccountId ? accountId : null;
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
    throw new ProviderError(PROVIDER, `Cloudflare has no servers (${ref.externalId})`, 404);
  }

  // --- Account --------------------------------------------------------------------

  /**
   * Account-owned tokens are verified below the account, user tokens at /user (an account
   * token fails there, UNVERIFIED). With an account id the account endpoint goes first.
   */
  private async verifyToken(): Promise<{ status?: unknown; expires_on?: unknown }> {
    const action = 'verify the API token';
    let result: unknown;
    if (this.accountId) {
      try {
        result = await this.client.request('GET', `/accounts/${this.accountId}/tokens/verify`, { action });
      } catch (err) {
        if (!isUpstream(err, 401, 403, 404)) throw err;
      }
    }
    result ??= await this.client.request('GET', '/user/tokens/verify', { action });
    return isRecord(result) ? result : {};
  }

  /** An account id that is not 32 hex characters is never used, and never silently ignored. */
  private assertAccountId(): void {
    if (this.invalidAccountId) {
      throw new ProviderError(
        PROVIDER,
        'the account id must be the 32 character hex id of the Cloudflare account',
      );
    }
  }

  /** Token active, zones readable, account (if set) reachable. Never returns the token. */
  async testConnection(): Promise<Record<string, unknown>> {
    this.assertAccountId();
    const token = await this.verifyToken();
    if (token.status !== 'active') {
      throw new ProviderError(
        PROVIDER,
        `the API token is ${typeof token.status === 'string' ? token.status : 'not active'}. Check the API token (CLOUDFLARE_API_TOKEN): revoked, expired or mistyped`,
      );
    }
    const [zones, account] = await Promise.all([
      this.client.requestEnvelope<CfZone[]>('GET', '/zones', {
        query: { page: 1, per_page: 5, 'account.id': this.accountId },
        action: 'list zones',
      }),
      this.accountId
        ? this.client
            .request<{ name?: string | null }>('GET', `/accounts/${this.accountId}`, {
              action: 'read the account',
            })
            // The token may lack Account Settings:Read; the name is only shown.
            .catch((err: unknown) => {
              if (isUpstream(err, 403)) return null;
              throw err;
            })
        : null,
    ]);
    const listed = Array.isArray(zones.result) ? zones.result.filter(isZone) : [];
    for (const zone of listed) this.remember(zone);
    return {
      token: token.status,
      tokenExpires: typeof token.expires_on === 'string' ? token.expires_on : null,
      account: account?.name ?? null,
      accountId: this.accountId,
      zones: num(zones.result_info?.total_count) ?? num(zones.result_info?.count) ?? listed.length,
      zoneCreation: this.accountId !== null,
    };
  }

  async overview(): Promise<InfraOverview> {
    const zones = await this.zoneList();
    const count = (status: string) => String(zones.filter((z) => z.status === status).length);
    const accounts = [...new Set(zones.map((z) => z.account?.name).filter((n): n is string => !!n))];
    return {
      nodes: [],
      storages: [],
      facts: [
        { label: 'Account', value: accounts.join(', ') || this.accountId || '–' },
        { label: 'Zones', value: String(zones.length) },
        { label: 'Active', value: count('active') },
        { label: 'Pending', value: count('pending') },
        { label: 'Moved', value: count('moved') },
        { label: 'Zone creation', value: this.accountId ? 'yes' : 'no (no account id)' },
      ],
    };
  }

  // --- Zones ----------------------------------------------------------------------

  private remember(zone: CfZone) {
    this.zones.set(zone.id, { name: zone.name.toLowerCase(), type: zone.type ?? null });
  }

  /** Zone name for messages, the id while it is unknown. */
  private label(id: string): string {
    return this.zones.get(id)?.name ?? `zone ${id}`;
  }

  /** Every zone the token sees, limited to the account when one is configured. */
  private async zoneList(): Promise<CfZone[]> {
    // Without this check an invalid id would widen the list to every account of the token.
    this.assertAccountId();
    const zones = await this.client.list<CfZone>('/zones', {
      query: { 'account.id': this.accountId },
      perPage: ZONES_PER_PAGE,
      maxPages: ZONES_MAX_PAGES,
      action: 'list zones',
    });
    const valid = zones.filter(isZone);
    for (const zone of valid) this.remember(zone);
    return valid;
  }

  /** The zone for views, shared for ZONE_TTL_MS. */
  private zone(id: string): Promise<CfZone> {
    return this.reads.get(`${id}:zone`, ZONE_TTL_MS, async () => {
      const zone = await this.client.request<CfZone>('GET', `/zones/${id}`, {
        action: `read ${this.label(id)}`,
      });
      if (!isZone(zone)) throw new ProviderError(PROVIDER, `${this.label(id)} came back without id or name`);
      this.remember(zone);
      return zone;
    });
  }

  private async zoneFacts(id: string): Promise<ZoneFacts> {
    const known = this.zones.get(id);
    if (known) return known;
    await this.zone(id);
    return this.zones.get(id)!;
  }

  async listDomains(): Promise<RemoteDomain[]> {
    return (await this.zoneList()).map(zoneToRemote);
  }

  async getDomain(externalId: string): Promise<DomainInfo> {
    return zoneToInfo(await this.zone(zoneId(externalId)));
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

  async checkZoneActivation(externalId: string): Promise<ActionResult> {
    const id = zoneId(externalId);
    const zone = await this.zone(id);
    if (zone.status !== 'pending') {
      throw conflict(
        `${zone.name} is ${zone.status ?? 'not pending'}: only pending zones can be checked for activation`,
      );
    }
    try {
      await this.client.request('PUT', `/zones/${id}/activation_check`, {
        action: `check the activation of ${zone.name}`,
      });
    } finally {
      this.reads.forget(id);
    }
    return { providerRef: null, message: 'Activation check requested' };
  }

  canCreateZones(): boolean {
    return this.accountId !== null;
  }

  /**
   * Creates a full zone in the account (pending until the delegation points to Cloudflare).
   * No jump_start: records are copied by the DNS move, a scan would collide with them. A
   * zone of this name in the account is returned instead (created: false).
   */
  async createZone(name: string): Promise<{ zone: RemoteDomain; created: boolean }> {
    const accountId = this.accountId;
    if (!accountId) {
      throw unsupported(
        'Creating zones needs the Cloudflare account id of the connection (CLOUDFLARE_ACCOUNT_ID)',
      );
    }
    const zoneName = zoneNameParam(name);
    try {
      const zone = await this.client.request<CfZone>('POST', '/zones', {
        body: { account: { id: accountId }, name: zoneName, type: 'full' },
        action: `create the zone ${zoneName}`,
      });
      if (!isZone(zone)) {
        throw new ProviderError(PROVIDER, `the new zone ${zoneName} came back without id or name`);
      }
      this.remember(zone);
      return { zone: zoneToRemote(zone), created: true };
    } catch (err) {
      if (!alreadyExists(err)) throw err;
      const found = await this.client.request<CfZone[]>('GET', '/zones', {
        query: { name: zoneName, 'account.id': accountId, per_page: 5 },
        action: `look up the zone ${zoneName}`,
      });
      const zone = (Array.isArray(found) ? found : [])
        .filter(isZone)
        .find((z) => z.name.toLowerCase() === zoneName);
      // Exists in another account: Cloudflare's own message says so.
      if (!zone) throw err;
      this.remember(zone);
      return { zone: zoneToRemote(zone), created: false };
    }
  }

  // --- DNS ------------------------------------------------------------------------

  async listDnsRecords(externalId: string): Promise<DnsRecord[]> {
    const id = zoneId(externalId);
    return this.reads.get(`${id}:records`, RECORDS_TTL_MS, async () => {
      const [facts, records] = await Promise.all([
        this.zoneFacts(id),
        this.client.list<CfDnsRecord>(`/zones/${id}/dns_records`, {
          perPage: RECORDS_PER_PAGE,
          maxPages: RECORDS_MAX_PAGES,
          action: `list the DNS records of ${this.label(id)}`,
        }),
      ]);
      return records.filter(isDnsRecord).map((r) => toDnsRecord(r, facts.name, facts.type));
    });
  }

  /** The record as Cloudflare has it right now. */
  private async record(id: string, recordId: string): Promise<CfDnsRecord> {
    try {
      const record = await this.client.request<CfDnsRecord>('GET', `/zones/${id}/dns_records/${recordId}`, {
        action: `read DNS record ${recordId}`,
      });
      if (!isDnsRecord(record)) throw notFound('DNS record');
      return record;
    } catch (err) {
      if (isUpstream(err, 404) || cloudflareCodes(err).includes(RECORD_MISSING)) throw notFound('DNS record');
      throw err;
    }
  }

  async addDnsRecord(externalId: string, input: DnsRecordInput): Promise<DnsRecord | null> {
    const id = zoneId(externalId);
    const facts = await this.zoneFacts(id);
    if (facts.type === 'secondary') throw unsupported(SECONDARY_ZONE);
    const body = recordBody(input, facts.name);
    try {
      const created = await this.client.request<CfDnsRecord>('POST', `/zones/${id}/dns_records`, {
        body,
        action: `add the ${body.type} record ${body.name}`,
      });
      return isDnsRecord(created) ? toDnsRecord(created, facts.name, facts.type) : null;
    } finally {
      this.reads.forget(id);
    }
  }

  /**
   * Same type: PATCH with the changed fields only, so comment, tags and settings stay. A type
   * change replaces the record in one batch transaction (delete, then create); the new
   * record has a new id and keeps comment and tags.
   */
  async updateDnsRecord(
    externalId: string,
    recordId: string,
    patch: DnsRecordPatch,
  ): Promise<DnsRecord | null> {
    const id = zoneId(externalId);
    const rid = dnsRecordId(recordId);
    const facts = await this.zoneFacts(id);
    const raw = await this.record(id, rid);
    const current = toDnsRecord(raw, facts.name, facts.type);
    if (current.readOnly) {
      throw badRequest(`${current.type} records cannot be changed in the panel, only deleted`);
    }
    const type = (patch.type ?? current.type).toUpperCase();

    if (type === current.type) {
      const body = recordPatch(current, patch, facts.name);
      if (Object.keys(body).length === 0) return current;
      try {
        const updated = await this.client.request<CfDnsRecord>('PATCH', `/zones/${id}/dns_records/${rid}`, {
          body,
          action: `change the ${type} record ${raw.name}`,
        });
        return isDnsRecord(updated) ? toDnsRecord(updated, facts.name, facts.type) : null;
      } finally {
        this.reads.forget(id);
      }
    }

    const post = recordBody(
      {
        type: type as DnsRecordType,
        name: patch.name ?? current.name,
        data: patch.data ?? current.data,
        ttl: patch.ttl ?? current.ttl,
        proxied: patch.proxied ?? current.proxied,
      },
      facts.name,
    );
    if (raw.comment) post.comment = raw.comment;
    if (Array.isArray(raw.tags) && raw.tags.length > 0) post.tags = raw.tags;
    try {
      const result = await this.client.request<{ posts?: CfDnsRecord[] } | null>(
        'POST',
        `/zones/${id}/dns_records/batch`,
        {
          body: { deletes: [{ id: rid }], posts: [post] },
          action: `change the ${current.type} record ${raw.name} to ${type}`,
        },
      );
      const created = isRecord(result) && Array.isArray(result.posts) ? result.posts[0] : undefined;
      return isDnsRecord(created) ? toDnsRecord(created, facts.name, facts.type) : null;
    } finally {
      this.reads.forget(id);
    }
  }

  async deleteDnsRecord(externalId: string, recordId: string): Promise<void> {
    const id = zoneId(externalId);
    const rid = dnsRecordId(recordId);
    try {
      await this.client.request('DELETE', `/zones/${id}/dns_records/${rid}`, {
        action: `delete DNS record ${rid}`,
      });
    } catch (err) {
      if (isUpstream(err, 404) || cloudflareCodes(err).includes(RECORD_MISSING)) throw notFound('DNS record');
      throw err;
    } finally {
      this.reads.forget(id);
    }
  }

  // --- CDN ------------------------------------------------------------------------

  private setting(id: string, name: string): Promise<CfSetting> {
    return this.client.request<CfSetting>('GET', `/zones/${id}/settings/${name}`, {
      action: `read the setting ${name} of ${this.label(id)}`,
    });
  }

  private async patchSetting(id: string, name: string, value: string): Promise<void> {
    await this.client.request('PATCH', `/zones/${id}/settings/${name}`, {
      body: { value },
      action: `change the setting ${name} of ${this.label(id)} to ${value}`,
    });
  }

  async getCdnSettings(externalId: string): Promise<CdnSettings> {
    const id = zoneId(externalId);
    return this.reads.get(`${id}:cdn`, CDN_TTL_MS, async () => {
      const [ssl, automatic, https, dev] = await Promise.all([
        this.setting(id, 'ssl'),
        // Not every plan or token can read Automatic SSL/TLS: shown as unknown then.
        this.setting(id, 'ssl_automatic_mode').catch((err: unknown) => {
          if (isUpstream(err, 403, 404)) return null;
          throw err;
        }),
        this.setting(id, 'always_use_https'),
        this.setting(id, 'development_mode'),
      ]);
      return parseCdn(ssl, automatic, https, dev);
    });
  }

  /**
   * One setting per call, refused (422) before anything is sent when the zone does not let
   * the panel change it. A concrete SSL/TLS mode while Automatic SSL/TLS is on first
   * switches the automatic mode to "custom", then sets the mode.
   */
  async updateCdnSetting(externalId: string, patch: CdnSettingPatch): Promise<CdnSettings> {
    const id = zoneId(externalId);
    const keys = Object.keys(patch);
    if (keys.length !== 1) throw badRequest('Change exactly one CDN setting at a time');
    const current = await this.getCdnSettings(id);
    const notEditable = (what: string) =>
      unsupported(`${what} cannot be changed for this zone (Cloudflare plan or zone settings)`);

    const steps: [setting: string, value: string][] = [];
    if ('sslMode' in patch) {
      if (!(CDN_SSL_MODES as readonly string[]).includes(patch.sslMode)) {
        throw badRequest(`Unknown SSL/TLS mode "${String(patch.sslMode)}"`);
      }
      if (!current.editable.sslMode) throw notEditable('The SSL/TLS mode');
      if (patch.sslMode === 'auto') {
        steps.push(['ssl_automatic_mode', 'auto']);
      } else {
        if (current.sslAutomatic === true) steps.push(['ssl_automatic_mode', 'custom']);
        steps.push(['ssl', patch.sslMode]);
      }
    } else if ('alwaysUseHttps' in patch) {
      if (typeof patch.alwaysUseHttps !== 'boolean') throw badRequest('alwaysUseHttps must be true or false');
      if (!current.editable.alwaysUseHttps) throw notEditable('Always Use HTTPS');
      steps.push(['always_use_https', patch.alwaysUseHttps ? 'on' : 'off']);
    } else if ('developmentMode' in patch) {
      if (typeof patch.developmentMode !== 'boolean') {
        throw badRequest('developmentMode must be true or false');
      }
      if (!current.editable.developmentMode) throw notEditable('Development mode');
      steps.push(['development_mode', patch.developmentMode ? 'on' : 'off']);
    } else {
      throw badRequest(`Unknown CDN setting "${keys[0]}"`);
    }

    try {
      for (const [index, [setting, value]] of steps.entries()) {
        try {
          await this.patchSetting(id, setting, value);
        } catch (err) {
          // The first of two writes went through: say what the zone looks like now.
          if (index === 0 || !(err instanceof ProviderError)) throw err;
          throw new ProviderError(
            PROVIDER,
            `${err.message.replace(/^Cloudflare: /, '')}. Automatic SSL/TLS is off now, the SSL/TLS mode stayed ${current.sslMode}`,
            err.upstreamStatus,
            err.details,
          );
        }
      }
    } finally {
      this.reads.forget(id);
    }
    return this.getCdnSettings(id);
  }

  /** "Accepted" is not "done": Cloudflare purges asynchronously. */
  async purgeCache(externalId: string): Promise<ActionResult> {
    const id = zoneId(externalId);
    const result = await this.client.request<{ id?: string } | null>('POST', `/zones/${id}/purge_cache`, {
      body: { purge_everything: true },
      action: `purge the cache of ${this.label(id)}`,
    });
    return {
      providerRef: isRecord(result) && typeof result.id === 'string' ? result.id : null,
      message: 'Purge accepted',
    };
  }

  // --- Admin ----------------------------------------------------------------------

  /**
   * Paths are relative to /client/v4, e.g. "/zones?per_page=50". GET and DELETE send the
   * body as query parameters, the other methods as JSON. API tokens cannot be changed here
   * (rolling the panel's own token would break the connection). Secrets in answers are
   * redacted.
   */
  async rawRequest(method: string, path: string, body?: Record<string, unknown>): Promise<RawResponse> {
    const upper = method.toUpperCase();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(upper)) throw badRequest('Unsupported method');
    let clean = path.trim();
    if (clean.startsWith(this.client.baseUrl)) clean = clean.slice(this.client.baseUrl.length);
    clean = clean.replace(/^\/?client\/v4(?=[/?]|$)/i, '');
    if (!clean.startsWith('/')) clean = `/${clean}`;
    const pathname = clean.split('?')[0]!;
    // Only paths below the API base: the token must not be sent anywhere else. URL parsing
    // also resolves encoded dot segments ("%2e%2e"), so those are refused as well.
    if (/^\/\/|\.\.|\\|@|%2e/i.test(clean) || /\/\/|%2f|%5c/i.test(pathname)) {
      throw badRequest('Invalid path');
    }
    if (upper !== 'GET' && /^\/(user|accounts\/[^/]+)\/tokens(\/|$)/i.test(pathname)) {
      throw badRequest('Manage API tokens in the Cloudflare dashboard');
    }
    const asQuery = upper === 'GET' || upper === 'DELETE';
    const res = await this.client.raw(upper, clean, {
      ...(body && asQuery ? { query: toQuery(body) } : {}),
      ...(body && !asQuery ? { body } : {}),
    });
    return { status: res.status, data: this.scrub(redactSecrets(res.body, pathname)) };
  }

  /** The connection's own token never shows up in explorer answers, even if echoed. */
  private scrub(value: unknown): unknown {
    if (typeof value === 'string') return this.client.redact(value);
    if (Array.isArray(value)) return value.map((v) => this.scrub(v));
    if (!isRecord(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.scrub(v)]));
  }
}
