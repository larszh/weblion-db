import { isIPv4, isIPv6 } from 'node:net';
import {
  DNS_PROXIABLE_TYPES,
  DNS_TTL_AUTO,
  type CdnSettings,
  type DnsRecord,
  type DnsRecordInput,
  type DomainInfo,
} from '@weblion/shared';
import { badRequest } from '../../lib/errors';
import { isRecord } from '../http';
import type { DnsRecordPatch, RemoteDomain } from '../types';
import { CLOUDFLARE_RECORD_TYPES, CLOUDFLARE_TTL_MAX, CLOUDFLARE_TTL_MIN } from './constants';

/**
 * Pure helpers for Cloudflare API v4 objects: zones as domains, DNS records in the panel's
 * generic formats (see DnsRecord in @weblion/shared) and back, zone settings, redaction.
 */

// --- API objects (only the fields the panel reads) --------------------------------

export interface CfZone {
  id: string;
  /** Punycode. */
  name: string;
  /** "initializing" | "pending" | "active" | "moved" */
  status?: string | null;
  /** DNS only, no proxy. */
  paused?: boolean | null;
  /** "full" | "partial" | "secondary" | "internal" */
  type?: string | null;
  /** Seconds: positive = remaining, negative = since expiry, 0 = never enabled. */
  development_mode?: number | null;
  name_servers?: string[] | null;
  original_name_servers?: string[] | null;
  original_registrar?: string | null;
  original_dnshost?: string | null;
  created_on?: string | null;
  modified_on?: string | null;
  activated_on?: string | null;
  account?: { id?: string | null; name?: string | null } | null;
  /** Deprecated in the spec, read for display only. */
  plan?: { id?: string | null; name?: string | null; legacy_id?: string | null } | null;
  verification_key?: string | null;
}

export interface CfDnsRecord {
  id: string;
  /** Complete name including the zone, punycode. */
  name: string;
  type: string;
  content?: string | null;
  /** Typed records (SRV, CAA, NAPTR, TLSA, DS, DNSKEY, HTTPS, ...). */
  data?: Record<string, unknown> | null;
  /** MX and URI. */
  priority?: number | null;
  proxied?: boolean | null;
  proxiable?: boolean | null;
  /** Seconds, 1 = automatic. */
  ttl?: number | null;
  comment?: string | null;
  tags?: string[] | null;
  /** Older API versions (UNVERIFIED): records the panel must not change. */
  locked?: boolean | null;
  meta?: Record<string, unknown> | null;
  created_on?: string | null;
  modified_on?: string | null;
}

export interface CfSetting<T = unknown> {
  id: string;
  value: T;
  editable?: boolean | null;
  modified_on?: string | null;
  /** development_mode only: seconds remaining (positive) or since expiry (negative), false if never on. */
  time_remaining?: number | boolean | null;
}

// --- Zones ------------------------------------------------------------------------

/** Lower-case host names without the trailing dot. */
function hosts(values: string[] | null | undefined): string[] {
  return (values ?? []).map((v) => String(v).trim().toLowerCase().replace(/\.+$/, '')).filter(Boolean);
}

export function zoneToInfo(zone: CfZone): DomainInfo {
  const status = zone.status ?? 'unknown';
  return {
    name: zone.name.toLowerCase(),
    status,
    terminated: false,
    nameservers: hosts(zone.name_servers),
    handle: null,
    createdAt: zone.created_on ?? null,
    expiresAt: null,
    autoRenew: null,
    providerDns: status === 'active',
    zone: {
      status,
      type: zone.type ?? null,
      paused: !!zone.paused,
      originalNameservers: hosts(zone.original_name_servers),
      originalRegistrar: zone.original_registrar ?? null,
      activatedAt: zone.activated_on ?? null,
      plan: zone.plan?.name ?? null,
    },
  };
}

export function zoneToRemote(zone: CfZone): RemoteDomain {
  const info = zoneToInfo(zone);
  return {
    externalId: zone.id,
    name: info.name,
    status: info.status,
    info,
    meta: {
      zoneType: zone.type ?? null,
      plan: zone.plan?.legacy_id ?? null,
      accountId: zone.account?.id ?? null,
    },
  };
}

// --- Names ------------------------------------------------------------------------

/** Panel name ("@", "", "www", "*.dev") to Cloudflare's complete name. */
export function toFqdn(name: string, zone: string): string {
  const relative = name.trim().toLowerCase();
  const apex = zone.toLowerCase();
  return relative === '@' || relative === '' ? apex : `${relative}.${apex}`;
}

/** Cloudflare's complete name to the panel's: the zone itself is "@". */
export function toRelative(fqdn: string, zone: string): string {
  const name = fqdn.trim().toLowerCase().replace(/\.+$/, '');
  const apex = zone.toLowerCase();
  if (name === apex) return '@';
  return name.endsWith(`.${apex}`) ? name.slice(0, -(apex.length + 1)) : name;
}

// --- TXT --------------------------------------------------------------------------

/** Longest DNS character-string, in bytes. */
const TXT_STRING_MAX = 255;

const quote = (value: string) => `"${value.replace(/[\\"]/g, (c) => `\\${c}`)}"`;

/**
 * TXT content as Cloudflare wants it: quoted strings of at most 255 bytes, never split
 * inside a character, backslashes and quotes escaped, joined by a space.
 */
export function quoteTxt(text: string): string {
  const parts: string[] = [];
  let part = '';
  let bytes = 0;
  for (const char of text) {
    const size = Buffer.byteLength(char);
    if (bytes + size > TXT_STRING_MAX) {
      parts.push(part);
      part = '';
      bytes = 0;
    }
    part += char;
    bytes += size;
  }
  parts.push(part);
  return parts.map(quote).join(' ');
}

const QUOTED_STRINGS = /^\s*"(?:[^"\\]|\\.)*"(?:\s+"(?:[^"\\]|\\.)*")*\s*$/s;

/**
 * The text of TXT content: one or more quoted strings are unescaped (also \DDD byte escapes)
 * and joined without separator, like DNS joins them. Anything else is returned unchanged.
 */
export function unquoteTxt(content: string): string {
  if (!QUOTED_STRINGS.test(content)) return content;
  const bytes: number[] = [];
  let inside = false;
  for (let i = 0; i < content.length; i++) {
    const char = content[i]!;
    if (!inside) {
      if (char === '"') inside = true;
      continue;
    }
    if (char === '"') {
      inside = false;
    } else if (char === '\\') {
      const digits = /^\d{3}/.exec(content.slice(i + 1, i + 4));
      if (digits && Number(digits[0]) <= 255) {
        bytes.push(Number(digits[0]));
        i += 3;
      } else {
        const next = content.codePointAt(i + 1)!;
        const escaped = String.fromCodePoint(next);
        bytes.push(...Buffer.from(escaped));
        i += escaped.length;
      }
    } else {
      const point = content.codePointAt(i)!;
      const whole = String.fromCodePoint(point);
      bytes.push(...Buffer.from(whole));
      i += whole.length - 1;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

// --- Records: Cloudflare to panel -------------------------------------------------

const ACCEPTED_TYPES: readonly string[] = CLOUDFLARE_RECORD_TYPES;
const PROXIABLE_TYPES: readonly string[] = DNS_PROXIABLE_TYPES;

export function isProxiableType(type: string): boolean {
  return PROXIABLE_TYPES.includes(type.toUpperCase());
}

const stripDot = (value: string) => value.trim().replace(/\.+$/, '');
const field = (data: Record<string, unknown>, key: string) => {
  const value = data[key];
  return value === undefined || value === null ? '' : String(value);
};

/** Record data in the panel format, see the table in the design (section 6.2). */
function recordData(raw: CfDnsRecord): string {
  const type = raw.type.toUpperCase();
  const content = raw.content ?? '';
  const data = isRecord(raw.data) ? raw.data : null;
  switch (type) {
    case 'A':
    case 'AAAA':
      return content;
    case 'CNAME':
    case 'NS':
    case 'PTR':
      return stripDot(content);
    case 'MX':
      return `${raw.priority ?? 0} ${stripDot(content)}`;
    case 'TXT':
      return unquoteTxt(content);
    case 'SRV':
      // Without data: Cloudflare's formatted content ("weight port target") after the priority.
      if (!data) {
        return raw.priority !== null && raw.priority !== undefined ? `${raw.priority} ${content}` : content;
      }
      return `${field(data, 'priority')} ${field(data, 'weight')} ${field(data, 'port')} ${stripDot(field(data, 'target')) || '.'}`;
    case 'CAA':
      if (!data) return content;
      return `${field(data, 'flags')} ${field(data, 'tag')} ${quote(field(data, 'value'))}`;
    case 'NAPTR': {
      if (!data) return content;
      const replacement = stripDot(field(data, 'replacement'));
      return [
        field(data, 'order'),
        field(data, 'preference'),
        quote(field(data, 'flags')),
        quote(field(data, 'service')),
        quote(field(data, 'regex')),
        replacement === '' ? '.' : replacement,
      ].join(' ');
    }
    case 'TLSA':
      if (!data) return content;
      return ['usage', 'selector', 'matching_type', 'certificate'].map((k) => field(data, k)).join(' ');
    case 'DS':
      if (!data) return content;
      return ['key_tag', 'algorithm', 'digest_type', 'digest'].map((k) => field(data, k)).join(' ');
    case 'DNSKEY':
      if (!data) return content;
      return ['flags', 'protocol', 'algorithm', 'public_key'].map((k) => field(data, k)).join(' ');
    default:
      return content !== '' || !data ? content : JSON.stringify(data);
  }
}

/**
 * A Cloudflare record in the panel's format. Read only: types the panel does not edit at
 * Cloudflare, locked records, the apex NS (Cloudflare's own) and records of secondary zones.
 */
export function toDnsRecord(raw: CfDnsRecord, zone: string, zoneType?: string | null): DnsRecord {
  const type = raw.type.toUpperCase();
  const name = toRelative(raw.name, zone);
  const readOnly =
    !ACCEPTED_TYPES.includes(type) ||
    raw.locked === true ||
    (isRecord(raw.meta) && raw.meta.read_only === true) ||
    (type === 'NS' && name === '@') ||
    zoneType === 'secondary';
  return {
    id: raw.id,
    type,
    name,
    data: recordData(raw),
    ttl: raw.ttl ?? null,
    ...(readOnly ? { readOnly: true } : {}),
    proxied: !!raw.proxied,
    proxiable: !!raw.proxiable,
    comment: raw.comment ?? null,
  };
}

// --- Records: panel to Cloudflare -------------------------------------------------

const LABEL = '[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?';
/** Relative record name: "@", "", "*", "www", "_dmarc", "*.dev", "_sip._tls". */
const RECORD_NAME = new RegExp(`^(|@|\\*|(\\*\\.)?${LABEL}(\\.${LABEL})*)$`, 'i');
/** Host name with at least two labels, optional trailing dot. */
const HOST = new RegExp(`^(?=.{1,253}\\.?$)${LABEL}(\\.${LABEL})+\\.?$`, 'i');
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const QUOTED = '"(?:[^"\\\\]|\\\\.)*"';
const CAA = new RegExp(`^(\\d{1,3})\\s+([a-z0-9]+)\\s+(${QUOTED}|[^\\s"]+)$`, 'i');
const NAPTR = new RegExp(`^(\\d{1,5})\\s+(\\d{1,5})\\s+(${QUOTED})\\s+(${QUOTED})\\s+(${QUOTED})\\s+(\\S+)$`);
const HEX = /^[0-9a-f]+$/i;

const MESSAGES: Record<string, string> = {
  A: 'A records need an IPv4 address',
  AAAA: 'AAAA records need an IPv6 address',
  CNAME: 'CNAME records need a host name, e.g. host.example.ch',
  NS: 'NS records need a host name, e.g. ns1.example.ch',
  PTR: 'PTR records need a host name, e.g. host.example.ch',
  MX: 'MX records need "priority host", e.g. "10 mail.example.ch"',
  SRV: 'SRV records need "priority weight port target" (numbers up to 65535, target a host name or "."), e.g. "10 5 5060 sip.example.ch"',
  CAA: 'CAA records need "flags tag value" (flags 0 to 255, tag letters and digits), e.g. 0 issue "letsencrypt.org"',
  NAPTR:
    'NAPTR records need order preference "flags" "service" "regexp" replacement (numbers up to 65535), e.g. 100 10 "u" "E2U+sip" "!^.*$!sip:info@example.ch!" .',
  TLSA: 'TLSA records need "usage selector matching-type certificate" (numbers 0 to 255, certificate in hex), e.g. "3 1 1 0123abcd..."',
  DS: 'DS records need "key-tag algorithm digest-type digest" (key tag up to 65535, digest in hex), e.g. "12345 13 2 0123abcd..."',
};

const invalid = (type: string): never => {
  throw badRequest(MESSAGES[type] ?? `Invalid ${type} record`);
};

function uint(value: string, max: number, type: string): number {
  if (!/^\d{1,5}$/.test(value) || Number(value) > max) invalid(type);
  return Number(value);
}

function host(value: string, type: string): string {
  if (!HOST.test(value)) invalid(type);
  return stripDot(value);
}

/** A quoted zone string without its quotes and escapes. */
function unquote(value: string): string {
  return value.slice(1, -1).replace(/\\(.)/g, '$1');
}

/** Type-specific request fields (content, data, priority) for the panel's data format. */
function contentFields(type: string, value: string): Record<string, unknown> {
  const data = value.trim();
  if (data === '') throw badRequest('Value is required');
  if (CONTROL_CHARS.test(data)) throw badRequest('Value must not contain line breaks or control characters');
  switch (type) {
    case 'A':
      if (!isIPv4(data)) invalid(type);
      return { content: data };
    case 'AAAA':
      if (!isIPv6(data) || data.includes('%')) invalid(type);
      return { content: data };
    case 'CNAME':
    case 'NS':
    case 'PTR':
      return { content: host(data, type) };
    case 'MX': {
      const m = /^(\S+)\s+(\S+)$/.exec(data) ?? invalid(type);
      return { content: host(m[2]!, type), priority: uint(m[1]!, 65535, type) };
    }
    case 'TXT':
      return { content: quoteTxt(data) };
    case 'SRV': {
      const m = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/.exec(data) ?? invalid(type);
      const target = m[4] === '.' ? '.' : host(m[4]!, type);
      return {
        data: {
          priority: uint(m[1]!, 65535, type),
          weight: uint(m[2]!, 65535, type),
          port: uint(m[3]!, 65535, type),
          target,
        },
      };
    }
    case 'CAA': {
      const m = CAA.exec(data) ?? invalid(type);
      const raw = m[3]!;
      return {
        data: {
          flags: uint(m[1]!, 255, type),
          tag: m[2]!.toLowerCase(),
          value: raw.startsWith('"') ? unquote(raw) : raw,
        },
      };
    }
    case 'NAPTR': {
      const m = NAPTR.exec(data) ?? invalid(type);
      const replacement = m[6] === '.' ? '.' : host(m[6]!, type);
      return {
        data: {
          order: uint(m[1]!, 65535, type),
          preference: uint(m[2]!, 65535, type),
          flags: unquote(m[3]!),
          service: unquote(m[4]!),
          regex: unquote(m[5]!),
          replacement,
        },
      };
    }
    case 'TLSA': {
      const m = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/.exec(data) ?? invalid(type);
      if (!HEX.test(m[4]!)) invalid(type);
      return {
        data: {
          usage: uint(m[1]!, 255, type),
          selector: uint(m[2]!, 255, type),
          matching_type: uint(m[3]!, 255, type),
          certificate: m[4]!.toLowerCase(),
        },
      };
    }
    case 'DS': {
      const m = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/.exec(data) ?? invalid(type);
      if (!HEX.test(m[4]!)) invalid(type);
      return {
        data: {
          key_tag: uint(m[1]!, 65535, type),
          algorithm: uint(m[2]!, 255, type),
          digest_type: uint(m[3]!, 255, type),
          digest: m[4]!.toLowerCase(),
        },
      };
    }
    default:
      throw badRequest(`${type} records cannot be added or changed at Cloudflare`);
  }
}

function checkType(type: string): string {
  const upper = type.toUpperCase();
  if (!ACCEPTED_TYPES.includes(upper)) {
    throw badRequest(`${type} records cannot be added or changed at Cloudflare`);
  }
  return upper;
}

/** 1 (automatic) or 60 to 86400 seconds. */
function checkTtl(ttl: number): number {
  if (
    !Number.isInteger(ttl) ||
    (ttl !== DNS_TTL_AUTO && (ttl < CLOUDFLARE_TTL_MIN || ttl > CLOUDFLARE_TTL_MAX))
  ) {
    throw badRequest(
      `Cloudflare takes a TTL of 1 (automatic) or between ${CLOUDFLARE_TTL_MIN} and ${CLOUDFLARE_TTL_MAX} seconds (got ${ttl})`,
    );
  }
  return ttl;
}

/** The complete record name, checked. NS at the apex belongs to Cloudflare. */
function checkName(type: string, name: string, zone: string): string {
  const relative = name.trim();
  if (CONTROL_CHARS.test(relative) || !RECORD_NAME.test(relative)) {
    throw badRequest(`Invalid record name "${relative}"`);
  }
  const fqdn = toFqdn(relative, zone);
  if (fqdn.length > 253) throw badRequest('The record name is too long (max. 253 characters with the zone)');
  if (type === 'NS' && fqdn === zone.toLowerCase()) {
    throw badRequest('Cloudflare manages the name servers of the zone itself');
  }
  return fqdn;
}

function checkProxied(type: string, proxied: boolean | undefined): void {
  if (proxied && !isProxiableType(type)) throw badRequest('Only A, AAAA and CNAME records can be proxied');
}

/**
 * Body of a new record (POST, batch posts). TTL defaults to automatic and is always
 * automatic for proxied records. comment, tags and settings are never sent.
 */
export function recordBody(input: DnsRecordInput, zone: string): Record<string, unknown> {
  const type = checkType(input.type);
  checkProxied(type, input.proxied);
  const name = checkName(type, input.name, zone);
  const ttl = input.ttl === undefined || input.ttl === null ? DNS_TTL_AUTO : checkTtl(input.ttl);
  const body: Record<string, unknown> = { type, name, ...contentFields(type, input.data) };
  if (isProxiableType(type)) {
    body.proxied = input.proxied ?? false;
    body.ttl = body.proxied ? DNS_TTL_AUTO : ttl;
  } else {
    body.ttl = ttl;
  }
  return body;
}

/**
 * Body of a PATCH that keeps the type: only what changes. When the value changes, all of
 * the type's content fields are sent (whether PATCH merges `data` is UNVERIFIED). Turning
 * the proxy on (or keeping it on) makes the TTL automatic.
 */
export function recordPatch(
  current: DnsRecord,
  patch: DnsRecordPatch,
  zone: string,
): Record<string, unknown> {
  const type = checkType(current.type);
  if (patch.type !== undefined && patch.type.toUpperCase() !== type) {
    throw badRequest('A type change needs a new record');
  }
  const body: Record<string, unknown> = {};

  if (patch.name !== undefined) {
    const fqdn = checkName(type, patch.name, zone);
    if (fqdn !== toFqdn(current.name, zone)) body.name = fqdn;
  }

  if (patch.data !== undefined && patch.data !== current.data)
    Object.assign(body, contentFields(type, patch.data));

  checkProxied(type, patch.proxied);
  const proxied = isProxiableType(type) && (patch.proxied ?? current.proxied ?? false);
  if (isProxiableType(type) && proxied !== (current.proxied ?? false)) body.proxied = proxied;

  // null or left out: unchanged. A proxied record is always automatic.
  let ttl = current.ttl;
  if (patch.ttl !== undefined && patch.ttl !== null) ttl = checkTtl(patch.ttl);
  if (proxied) ttl = DNS_TTL_AUTO;
  if (ttl !== null && ttl !== current.ttl) body.ttl = ttl;
  return body;
}

// --- CDN --------------------------------------------------------------------------

/**
 * Zone settings as CdnSettings. `auto` is the ssl_automatic_mode setting, null when it could
 * not be read. development_mode's time_remaining counts only while it is on.
 */
export function parseCdn(
  ssl: CfSetting,
  auto: CfSetting | null,
  https: CfSetting,
  dev: CfSetting,
): CdnSettings {
  const developmentMode = dev.value === 'on';
  const remaining = typeof dev.time_remaining === 'number' ? dev.time_remaining : null;
  return {
    sslMode: String(ssl.value ?? 'off'),
    sslAutomatic: auto ? auto.value === 'auto' : null,
    alwaysUseHttps: https.value === 'on',
    developmentMode,
    developmentModeRemaining: developmentMode && remaining !== null && remaining > 0 ? remaining : null,
    editable: {
      sslMode: ssl.editable !== false,
      alwaysUseHttps: https.editable !== false,
      developmentMode: dev.editable !== false,
    },
  };
}

// --- Explorer ---------------------------------------------------------------------

const SECRET_KEY = /secret|passw(or)?d|private_?key|^token$|psk|preshared/i;
const REDACTED = '[redacted]';

/**
 * Explorer answers without secrets Cloudflare may return: values of password-like keys,
 * token values below /tokens (token create and roll) and the string result of paths ending
 * in /token (tunnel tokens).
 */
export function redactSecrets<T>(value: T, path: string): T {
  const pathname = path.split('?')[0]!.replace(/\/+$/, '').toLowerCase();
  const tokens = pathname.includes('/tokens');
  const tunnelToken = pathname.endsWith('/token');
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!isRecord(v)) return v;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(v)) {
      const secret =
        SECRET_KEY.test(key) ||
        (tokens && key === 'value') ||
        (tunnelToken && key === 'result' && typeof item === 'string');
      out[key] = secret && item !== null && item !== undefined ? REDACTED : walk(item);
    }
    return out;
  };
  return walk(value) as T;
}
