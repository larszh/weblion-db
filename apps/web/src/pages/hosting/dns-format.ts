import {
  DNS_PROXIABLE_TYPES,
  DNS_TTL_AUTO,
  type DnsRecord,
  type DnsRecordInput,
  type DnsRecordType,
} from '@weblion/shared';
import type { TranslationKey } from '@/i18n/de';

/**
 * Client side checks for DNS records and name servers. They mirror the API rules (generic
 * value formats, see DnsRecord in @weblion/shared) so typos show up before the request.
 * The API stays the authority.
 */

const LABEL = '[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?';
/** Fully qualified host name, optional trailing dot. */
export const HOSTNAME = new RegExp(
  `^(?=.{1,253}\\.?$)(${LABEL}\\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?\\.?$`,
  'i',
);
/** Record name relative to the zone: "@", "", "*", "www", "_dmarc", "*.dev", "_sip._tls". */
export const RECORD_NAME = new RegExp(`^(|@|\\*|(\\*\\.)?${LABEL}(\\.${LABEL})*)$`, 'i');
const IPV4 = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6 = /^[0-9a-f:.]+$/i;
/** A double quoted string, backslash escapes allowed inside. */
const QUOTED = '"(?:[^"\\\\]|\\\\.)*"';
const MX = /^(\d{1,5})\s+(\S+)$/;
const SRV = /^(\d{1,5})\s+(\d{1,5})\s+(\d{1,5})\s+(\S+)$/;
const CAA = new RegExp(`^(\\d{1,3})\\s+([a-z0-9]+)\\s+(${QUOTED}|[^\\s"]+)$`, 'i');
const NAPTR = new RegExp(`^(\\d{1,5})\\s+(\\d{1,5})\\s+${QUOTED}\\s+${QUOTED}\\s+${QUOTED}\\s+(\\S+)$`);
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(.+)$/i;

export const NAMESERVERS_MIN = 2;
export const NAMESERVERS_MAX = 13;

const isUint16 = (value: string) => Number(value) <= 65535;
/** Host name or "." (SRV/NAPTR: "no target"). */
const isTarget = (value: string) => value === '.' || HOSTNAME.test(value);

function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\/\S+$/i.test(value)) return false;
  try {
    return new URL(value).hostname.length > 0;
  } catch {
    return false;
  }
}

function isEmail(value: string): boolean {
  const domain = EMAIL.exec(value)?.[1];
  return !!domain && !domain.endsWith('.') && HOSTNAME.test(domain);
}

/** Problem with a record value in the generic format of its type, null when it looks fine. */
export function dataIssue(type: string, data: string): TranslationKey | null {
  if (!data) return null;
  switch (type) {
    case 'A':
      return IPV4.test(data) ? null : 'hosting.dns.invalid.ipv4';
    case 'AAAA':
      return data.includes(':') && IPV6.test(data) ? null : 'hosting.dns.invalid.ipv6';
    case 'CNAME':
    case 'ALIAS':
    case 'NS':
      return HOSTNAME.test(data) ? null : 'hosting.dns.invalid.host';
    case 'MX': {
      const match = MX.exec(data);
      return match && isUint16(match[1]!) && HOSTNAME.test(match[2]!) ? null : 'hosting.dns.invalid.mx';
    }
    case 'SRV': {
      const match = SRV.exec(data);
      return match && [match[1]!, match[2]!, match[3]!].every(isUint16) && isTarget(match[4]!)
        ? null
        : 'hosting.dns.invalid.srv';
    }
    case 'CAA': {
      const match = CAA.exec(data);
      return match && Number(match[1]) <= 255 ? null : 'hosting.dns.invalid.caa';
    }
    case 'NAPTR': {
      const match = NAPTR.exec(data);
      return match && isUint16(match[1]!) && isUint16(match[2]!) && isTarget(match[3]!)
        ? null
        : 'hosting.dns.invalid.naptr';
    }
    case 'TXT':
      // The plain text: providers add the zone file quoting themselves.
      return data.length > 1 && data.startsWith('"') && data.endsWith('"')
        ? 'hosting.dns.invalid.txtQuotes'
        : null;
    case 'HTTP_REDIRECT':
    case 'HTTP_FRAME':
      return isHttpUrl(data) ? null : 'hosting.dns.invalid.url';
    case 'MAILFW':
      return isEmail(data) ? null : 'hosting.dns.invalid.email';
    default:
      return null;
  }
}

/** Accepts "www", "@", "" and also full names like "www.example.ch", returns the relative name. */
export function relativeName(input: string, zone: string): string {
  let name = input.trim().toLowerCase().replace(/\.$/, '');
  if (name === zone) return '@';
  if (name.endsWith(`.${zone}`)) name = name.slice(0, -(zone.length + 1));
  return name === '' ? '@' : name;
}

/** Name server as the API stores it: trimmed, lower-cased, without the trailing dot. */
export function normalizeNameserver(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

/** Problem with one entry of a name server list (empty entries are skipped). */
export function nameserverIssue(list: string[], index: number): TranslationKey | null {
  const ns = list[index];
  if (!ns) return null;
  if (!HOSTNAME.test(ns)) return 'hosting.ns.invalid.host';
  if (list.indexOf(ns) !== index) return 'hosting.ns.invalid.duplicate';
  return null;
}

/** TTL choices in the record dialog, seconds. Joker needs at least 300. */
export const TTL_OPTIONS = [300, 900, 3600, 14400, 86400] as const;
export const DEFAULT_TTL = 3600;

/** TTL choices at providers with "dnsTtlAuto" (Cloudflare): 1 is "automatic", others 60 s and up. */
export const TTL_OPTIONS_AUTO = [DNS_TTL_AUTO, 60, 300, 900, 3600, 14400, 86400] as const;

const PROXIABLE: readonly string[] = DNS_PROXIABLE_TYPES;

/** Types a proxy can carry (A, AAAA, CNAME). Whether a single record can is the provider's call. */
export const isProxiable = (type: string) => PROXIABLE.includes(type.toUpperCase());

/** What the provider offers in the record dialog (domain capabilities). */
export interface RecordFormOptions {
  /** "dnsTtl": records take a TTL. */
  withTtl: boolean;
  /** "dnsTtlAuto": TTL 1 means automatic and is the default. */
  ttlAuto: boolean;
  /** "dnsProxy": A, AAAA and CNAME records can go through the provider's proxy. */
  withProxy: boolean;
}

/** The record dialog's values, name already relative to the zone ("@" for the apex). */
export interface RecordForm {
  type: string;
  name: string;
  data: string;
  ttl: number;
  proxied: boolean;
}

export const defaultTtl = (options: RecordFormOptions) => (options.ttlAuto ? DNS_TTL_AUTO : DEFAULT_TTL);

/** The proxy flag the form ends up with: only proxiable types at providers with a proxy. */
export const formProxied = (form: RecordForm, options: RecordFormOptions) =>
  options.withProxy && isProxiable(form.type) && form.proxied;

/** Proxied records always have the automatic TTL (the provider forces it). */
export const formTtl = (form: RecordForm, options: RecordFormOptions) =>
  formProxied(form, options) ? DNS_TTL_AUTO : form.ttl;

/** Body of POST /domains/:id/dns. */
export function newRecordInput(form: RecordForm, options: RecordFormOptions): DnsRecordInput {
  return {
    type: form.type as DnsRecordType,
    name: form.name,
    data: form.data,
    ...(options.withTtl ? { ttl: formTtl(form, options) } : {}),
    ...(options.withProxy && isProxiable(form.type) ? { proxied: formProxied(form, options) } : {}),
  };
}

/**
 * Body of PATCH /domains/:id/dns/:recordId: only what changed, empty when nothing did. Left
 * out, the provider keeps the record's TTL and proxy flag.
 */
export function recordPatch(
  record: DnsRecord,
  form: RecordForm,
  options: RecordFormOptions,
): Partial<DnsRecordInput> {
  const patch: Partial<DnsRecordInput> = {};
  if (form.type !== record.type) patch.type = form.type as DnsRecordType;
  if (form.name !== (record.name === '' ? '@' : record.name)) patch.name = form.name;
  if (form.data !== record.data) patch.data = form.data;
  const ttl = formTtl(form, options);
  if (options.withTtl && ttl !== (record.ttl ?? defaultTtl(options))) patch.ttl = ttl;
  const proxied = formProxied(form, options);
  if (options.withProxy && proxied !== (record.proxied === true)) patch.proxied = proxied;
  return patch;
}

/** Same name servers in any order and spelling (case, trailing dot). */
export function sameNameservers(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a.map(normalizeNameserver).filter(Boolean));
  const right = new Set(b.map(normalizeNameserver).filter(Boolean));
  return left.size > 0 && left.size === right.size && [...left].every((ns) => right.has(ns));
}

/**
 * Remaining time of the CDN development mode, rounded up to whole minutes so "0 min" never
 * shows while it is still on. Null when nothing remains.
 */
export function formatRemaining(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const minutes = Math.ceil(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${minutes} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
