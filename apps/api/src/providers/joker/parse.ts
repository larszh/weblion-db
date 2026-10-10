import { createHash } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';
import type { DnsRecord, DnsRecordType, DomainInfo, DomainRegistrant } from '@weblion/shared';
import { badRequest } from '../../lib/errors';
import { num } from '../http';

/**
 * Pure parsers for Joker.com DMAPI replies (see the DMAPI-ext.txt spec): MIME-like header
 * lines, an empty line, then a plain text body whose format depends on the request.
 */

// --- Replies ----------------------------------------------------------------------

export interface DmapiHeader {
  name: string;
  value: string;
}

export interface DmapiReply {
  /** Header lines in the order sent. Names keep their spelling, repeated headers are kept. */
  headers: DmapiHeader[];
  body: string;
}

const HEADER_LINE = /^([A-Za-z0-9][A-Za-z0-9_.-]*)[ \t]*:(.*)$/;

export function parseReply(text: string): DmapiReply {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const headers: DmapiHeader[] = [];
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i++;
      break;
    }
    const match = HEADER_LINE.exec(line);
    if (match) {
      headers.push({ name: match[1]!, value: match[2]!.trim() });
    } else if (headers.length === 0) {
      // Not a DMAPI reply (e.g. an error page from a proxy): everything is body.
      break;
    } else if (/^[ \t]/.test(line)) {
      const last = headers[headers.length - 1]!;
      last.value = `${last.value} ${line.trim()}`.trim();
    }
  }
  return { headers, body: lines.slice(i).join('\n') };
}

/** All values of a header, case-insensitive. */
export function headerValues(reply: Pick<DmapiReply, 'headers'>, name: string): string[] {
  const key = name.toLowerCase();
  return reply.headers.filter((h) => h.name.toLowerCase() === key).map((h) => h.value);
}

/** First non-empty value of a header, case-insensitive. */
export function headerValue(reply: Pick<DmapiReply, 'headers'>, name: string): string | null {
  return headerValues(reply, name).find((v) => v !== '') ?? null;
}

export function statusCode(reply: Pick<DmapiReply, 'headers'>): number | null {
  return num(headerValue(reply, 'Status-Code'));
}

/**
 * Why a reply counts as failed, or null for success. DMAPI reports errors with a non-zero
 * Status-Code, Error header lines (processing did not take place), Result: NACK or an HTTP
 * status other than 200.
 */
export function replyFailure(httpStatus: number, reply: DmapiReply): string | null {
  const code = statusCode(reply);
  const errors = headerValues(reply, 'Error').filter((e) => e !== '');
  const nack = headerValue(reply, 'Result')?.toUpperCase() === 'NACK';
  if (httpStatus === 200 && !code && errors.length === 0 && !nack) return null;

  const text =
    headerValue(reply, 'Status-Text') ??
    (httpStatus !== 200 ? `HTTP ${httpStatus}` : nack ? 'request refused (NACK)' : 'request failed');
  const facts: string[] = [];
  if (code) facts.push(`status ${code}`);
  if (httpStatus !== 200 && !text.startsWith('HTTP ')) facts.push(`HTTP ${httpStatus}`);
  const tracking = headerValue(reply, 'Tracking-Id');
  if (tracking) facts.push(`Tracking-Id ${tracking}`);
  return `${text}${errors.length > 0 ? `: ${errors.join('; ')}` : ''}${facts.length > 0 ? ` (${facts.join(', ')})` : ''}`;
}

/** "key: value" lines of a body (query-whois, query-profile), keys lower-cased. */
export function keyValues(body: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const line of body.split('\n')) {
    const index = line.indexOf(':');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    if (!key || /\s/.test(key)) continue;
    const value = line.slice(index + 1).trim();
    const values = out.get(key);
    if (values) values.push(value);
    else out.set(key, [value]);
  }
  return out;
}

function first(values: Map<string, string[]>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = values.get(key)?.find((v) => v !== '');
    if (value) return value;
  }
  return null;
}

// --- Dates, flags -----------------------------------------------------------------

/** Joker dates: YYYYMMDDhhmmss (whois), YYYY-MM-DD (domain list) or ISO 8601. Taken as UTC. */
export function jokerDate(value: string | null | undefined): string | null {
  const s = value?.trim();
  if (!s) return null;
  let iso: string | null = null;
  let m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (m) iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
  else if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) iso = `${m[1]}-${m[2]}-${m[3]}T00:00:00Z`;
  else if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) iso = `${s}T00:00:00Z`;
  else if ((m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(:\d{2})?)$/.exec(s))) iso = `${m[1]}T${m[2]}Z`;
  else if (/^\d{4}-\d{2}-\d{2}T/.test(s)) iso = s;
  if (!iso) return null;
  const time = Date.parse(iso);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/** "lock,autorenew" → ["lock", "autorenew"]. "-" or "" → []. */
export function statusFlags(value: string | null | undefined): string[] {
  const s = value?.trim();
  if (!s || s === '-') return [];
  return s
    .split(/[,\s]+/)
    .map((f) => f.trim().toLowerCase())
    .filter((f) => f !== '' && f !== '-');
}

/** Flags that have their own field (locked, autoRenew) or mean "registered and fine". */
const PLAIN_FLAGS = new Set(['lock', 'locked', 'autorenew', 'production', 'active', 'ok']);

/**
 * The domain status shown in the panel: "active" for a normal registration, otherwise the
 * remaining Joker flags (e.g. "transfer", "deleted"). Lock and auto-renew are separate fields.
 */
export function statusFromFlags(flags: string[]): string {
  const rest = flags.filter((f) => !PLAIN_FLAGS.has(f));
  return rest.length > 0 ? rest.join(',') : 'active';
}

export function terminatedFromFlags(flags: string[]): boolean {
  return flags.some((f) => /delet|terminat|redemption/.test(f));
}

function bool(value: string | null | undefined): boolean | null {
  const s = value?.trim().toLowerCase();
  if (!s) return null;
  if (['1', 'true', 'yes', 'on', 'y'].includes(s)) return true;
  if (['0', 'false', 'no', 'off', 'n'].includes(s)) return false;
  return null;
}

/** Lower-case host name without the trailing dot. */
export function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.+$/, '');
}

function amount(value: string | null | undefined): number | null {
  const s = value?.trim().replace(/\s/g, '');
  if (!s) return null;
  const normalized = s.includes('.') ? s.replace(/,/g, '') : s.replace(',', '.');
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

// --- query-domain-list ------------------------------------------------------------

export interface JokerListedDomain {
  /** Lower-case ASCII name, also the panel's externalId. */
  name: string;
  expiresAt: string | null;
  /** Status flags ("lock", "autorenew", ...), null if the list had no status column. */
  flags: string[] | null;
  /** Uses Joker's name servers (showjokerns), null if unknown. */
  jokerNs: boolean | null;
}

function separator(reply: DmapiReply): string | RegExp {
  const sep = headerValue(reply, 'Separator');
  if (!sep) return /\s+/;
  const upper = sep.toUpperCase();
  if (upper === 'TAB' || sep === '\\t') return '\t';
  if (upper === 'SPACE') return /\s+/;
  return sep;
}

const isListedName = (name: string) => /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/.test(name);

/**
 * query-domain-list with showstatus=1 and showjokerns=1. Columns are taken from the Columns
 * header when Joker sends one, otherwise by position: name, expiry, status flags, (grants),
 * jokerns ("example.com 2027-01-01 lock,autorenew 1").
 */
export function parseDomainList(reply: DmapiReply): JokerListedDomain[] {
  const columns = (headerValue(reply, 'Columns') ?? '')
    .split(/[,\s]+/)
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  const sep = separator(reply);
  const column = (re: RegExp) => columns.findIndex((c) => re.test(c));
  const nameAt = Math.max(0, column(/^(domain|domain[-_ ]?name|name|fqdn)$/));
  const expiryAt = column(/exp/);
  const statusAt = column(/status|flags/);
  const nsAt = column(/joker.?ns/);

  const out: JokerListedDomain[] = [];
  const seen = new Set<string>();
  for (const line of reply.body.split('\n')) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const fields = line
      .trim()
      .split(sep)
      .map((f) => f.trim());
    let domain: JokerListedDomain | null;
    if (columns.length > 0) {
      const at = (index: number) => (index >= 0 ? (fields[index] ?? null) : null);
      domain = {
        name: normalizeHost(at(nameAt) ?? ''),
        expiresAt: jokerDate(at(expiryAt >= 0 ? expiryAt : 1)),
        flags: statusAt >= 0 ? statusFlags(at(statusAt)) : null,
        jokerNs: bool(at(nsAt)),
      };
    } else {
      domain = positionalDomain(fields.filter((f) => f !== ''));
    }
    if (!domain || !isListedName(domain.name) || seen.has(domain.name)) continue;
    seen.add(domain.name);
    out.push(domain);
  }
  return out;
}

function positionalDomain(fields: string[]): JokerListedDomain | null {
  const [name, expiry, ...rest] = fields;
  if (!name) return null;
  const last = rest[rest.length - 1];
  const jokerNs = rest.length > 0 ? bool(last) : null;
  if (jokerNs !== null) rest.pop();
  // Two columns only: Joker ignored showstatus, so lock and auto-renew are unknown. With the
  // jokerns column present an empty status collapses away, which means "no flags".
  let flags: string[] | null = null;
  if (rest.length > 0 && !rest[0]!.startsWith('@')) flags = statusFlags(rest[0]);
  else if (jokerNs !== null) flags = [];
  return { name: normalizeHost(name), expiresAt: jokerDate(expiry), flags, jokerNs };
}

/** dns-zone-list: one zone per line (possibly followed by more columns). */
export function parseZoneList(body: string): string[] {
  const zones = new Set<string>();
  for (const line of body.split('\n')) {
    const zone = line.trim().split(/\s+/)[0];
    if (zone && !zone.startsWith('#')) zones.add(normalizeHost(zone));
  }
  return [...zones];
}

// --- query-whois, query-profile ---------------------------------------------------

/** query-whois for a domain ("domain.status: lock", "domain.expires: 20260813080304", ...). */
export function parseWhois(body: string, fallbackName = ''): DomainInfo {
  const kv = keyValues(body);
  const statusText = first(kv, 'domain.status');
  const flags = statusText !== null ? statusFlags(statusText) : null;
  const nameservers = [
    ...new Set(
      [...(kv.get('domain.nservers.nserver.handle') ?? []), ...(kv.get('domain.nservers.nserver') ?? [])]
        .map(normalizeHost)
        .filter((ns) => ns !== '' && !/^\d+$/.test(ns)),
    ),
  ].sort();
  const autoRenew = bool(first(kv, 'domain.autorenew')) ?? (flags ? flags.includes('autorenew') : null);
  const dnssecStatus = first(kv, 'domain.dnssec.status', 'domain.dnssec');
  const registrant: DomainRegistrant = {
    name: first(kv, 'domain.name'),
    organization: first(kv, 'domain.organization'),
    email: first(kv, 'domain.email', 'domain.owner-c-email'),
  };
  return {
    name: normalizeHost(first(kv, 'domain.fqdn', 'domain.domain') ?? fallbackName),
    status: flags ? statusFromFlags(flags) : null,
    terminated: flags ? terminatedFromFlags(flags) : false,
    nameservers,
    handle: first(kv, 'domain.owner-c', 'domain.owner-c.handle', 'domain.owner-c-handle'),
    createdAt: jokerDate(first(kv, 'domain.created.date', 'domain.created')),
    expiresAt: jokerDate(first(kv, 'domain.expires', 'domain.expires.date')),
    autoRenew,
    locked: flags ? flags.includes('lock') || flags.includes('locked') : null,
    privacy: first(kv, 'domain.privacy')?.toLowerCase() ?? null,
    // No DNSSEC data in the whois means no DNSSEC; "signedDelegation" means active.
    dnssec: dnssecStatus ? /^(signed|active|enabled|on|yes|true|1)/i.test(dnssecStatus) : false,
    registrant: registrant.name || registrant.organization || registrant.email ? registrant : null,
  };
}

export interface JokerProfile {
  account: string | null;
  balance: number | null;
  currency: string | null;
}

/** query-profile ("key: value" body). Balance and currency fall back to the reply headers. */
export function parseProfile(reply: DmapiReply): JokerProfile {
  const kv = keyValues(reply.body);
  const fullName = [first(kv, 'fname'), first(kv, 'lname')].filter(Boolean).join(' ');
  return {
    account:
      first(kv, 'user-login', 'username', 'login', 'email', 'customer-id', 'uid') ??
      headerValue(reply, 'User-Login') ??
      (first(kv, 'organization', 'name') || fullName || null),
    balance:
      amount(first(kv, 'balance', 'account-balance', 'account.balance')) ??
      amount(headerValue(reply, 'Account-Balance')),
    currency:
      first(kv, 'currency', 'account-currency', 'account.currency') ?? headerValue(reply, 'Account-Currency'),
  };
}

// --- Auth codes (result-retrieve) -------------------------------------------------

export interface AsyncResult {
  status: 'ack' | 'nack' | 'pending';
  authcode: string | null;
  /** Error or reason lines for a nack. */
  message: string | null;
}

const normalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');

const AUTHCODE_KEYS = new Set([
  'authid',
  'authinfo',
  'authcode',
  'transferauthid',
  'transferauthinfo',
  'transferauthcode',
  'domainauthid',
  'domainauthinfo',
  'authorizationid',
  'authorisationid',
  'eppcode',
]);
const STATUS_KEYS = new Set([
  'completionstatus',
  'status',
  'processingstatus',
  'requeststatus',
  'resultstatus',
]);
const MESSAGE_KEYS = new Set(['error', 'reason', 'message']);

/** "key: value" pairs of the headers and the body, body first. */
function replyPairs(reply: DmapiReply): { key: string; value: string; header: boolean }[] {
  const pairs: { key: string; value: string; header: boolean }[] = [];
  for (const line of reply.body.split('\n')) {
    const index = line.indexOf(':');
    if (index <= 0) continue;
    pairs.push({
      key: normalizeKey(line.slice(0, index)),
      value: line.slice(index + 1).trim(),
      header: false,
    });
  }
  for (const h of reply.headers) pairs.push({ key: normalizeKey(h.name), value: h.value, header: true });
  return pairs;
}

const unquote = (value: string) => value.replace(/^["']|["']$/g, '').trim();

/**
 * result-retrieve for a domain-transfer-get-auth-id request. The reply format is not
 * documented, so the code is taken from any "Auth-ID: X" style line (header or body).
 */
export function parseAuthcodeResult(reply: DmapiReply): AsyncResult {
  const pairs = replyPairs(reply);
  const authcode = pairs.map((p) => (AUTHCODE_KEYS.has(p.key) ? unquote(p.value) : '')).find(Boolean) ?? null;
  let status: AsyncResult['status'] = authcode ? 'ack' : 'pending';
  for (const p of pairs) {
    // The Result header belongs to the result-retrieve call itself, not to the job.
    const isStatus = STATUS_KEYS.has(p.key) || (p.key === 'result' && !p.header);
    if (!isStatus) continue;
    // The first ack or nack wins; "?" or "pending" means the job still runs.
    if (/^nack\b/i.test(p.value)) status = 'nack';
    else if (/^ack\b/i.test(p.value)) status = 'ack';
    else continue;
    break;
  }
  const messages = pairs.filter((p) => MESSAGE_KEYS.has(p.key) && p.value !== '').map((p) => p.value);
  return { status, authcode, message: messages.length > 0 ? [...new Set(messages)].join('; ') : null };
}

/** Keys whose values are secret in raw replies (auth codes, session ids). */
const SECRET_KEY = /auth|epp/;

/**
 * Replaces auth codes (and session ids) in a reply with "[redacted]", for the admin API
 * explorer. Besides "Auth-ID: X" lines, any literal occurrence of a found code is replaced.
 */
export function redactAuthcodes(reply: DmapiReply): DmapiReply {
  const code = parseAuthcodeResult(reply).authcode;
  const scrub = (text: string) => (code && code.length >= 4 ? text.split(code).join('[redacted]') : text);
  const headers = reply.headers.map((h) => ({
    name: h.name,
    value: SECRET_KEY.test(normalizeKey(h.name)) ? '[redacted]' : scrub(h.value),
  }));
  const body = reply.body
    .split('\n')
    .map((line) => {
      const index = line.indexOf(':');
      if (index > 0 && SECRET_KEY.test(normalizeKey(line.slice(0, index)))) {
        return `${line.slice(0, index + 1)} [redacted]`;
      }
      return scrub(line);
    })
    .join('\n');
  return { headers, body };
}

/** The DynDNS password in a zone ("$dyndns=yes:user:password"), for the admin API explorer. */
export function redactDyndns(body: string): string {
  return body.replace(/^(\s*\$dyndns\s*=\s*[^:\n]*:[^:\n]*:).*$/gim, '$1[redacted]');
}

// --- Zones ------------------------------------------------------------------------

/**
 * Record types the panel offers for Joker. URL and FRAME are Joker's web redirects, MAILFW
 * its mail forwarding. DYNA/DYNAAAA (DynDNS) and unknown lines are listed read-only.
 */
export const JOKER_RECORD_TYPES: DnsRecordType[] = [
  'A',
  'AAAA',
  'CNAME',
  'MX',
  'TXT',
  'SRV',
  'CAA',
  'NAPTR',
  'HTTP_REDIRECT',
  'HTTP_FRAME',
  'MAILFW',
];

const TO_GENERIC: Record<string, string> = { URL: 'HTTP_REDIRECT', FRAME: 'HTTP_FRAME' };
const TO_JOKER: Record<string, string> = { HTTP_REDIRECT: 'URL', HTTP_FRAME: 'FRAME' };

export const DEFAULT_TTL = 3600;
const MAX_TTL = 2_147_483_647;

export interface ZoneToken {
  value: string;
  quoted: boolean;
  start: number;
  end: number;
}

/**
 * Splits a zone line at blanks. Double quotes group (and are removed), a backslash escapes
 * a quote, a backslash or (outside quotes) a blank; other backslashes stay as they are.
 * `complete` is false when a quote is not closed.
 */
export function tokenizeZoneLine(line: string): { tokens: ZoneToken[]; complete: boolean } {
  const tokens: ZoneToken[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === ' ' || line[i] === '\t') {
      i++;
      continue;
    }
    const start = i;
    let value = '';
    let quoted = false;
    let inQuote = false;
    while (i < line.length) {
      const ch = line[i]!;
      if (!inQuote && (ch === ' ' || ch === '\t')) break;
      if (ch === '\\' && i + 1 < line.length) {
        const next = line[i + 1]!;
        if (next === '"' || next === '\\' || (!inQuote && (next === ' ' || next === '\t'))) {
          value += next;
          i += 2;
          continue;
        }
      }
      if (ch === '"') {
        inQuote = !inQuote;
        quoted = true;
      } else {
        value += ch;
      }
      i++;
    }
    tokens.push({ value, quoted, start, end: i });
    if (inQuote) return { tokens, complete: false };
  }
  return { tokens, complete: true };
}

/** Double-quoted zone string, backslashes and quotes escaped. */
export function quoteZone(value: string): string {
  return `"${value.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

/** Longest string a TXT record can carry in one piece (a DNS character-string), in bytes. */
const TXT_STRING_MAX = 255;

/**
 * A TXT value as zone strings. Values longer than one DNS string (2048 bit DKIM keys have
 * about 420 characters) become several quoted strings of at most 255 bytes, never split
 * inside a character: "abc..." "def...". DNS joins them, and so does the zone reader.
 */
export function quoteZoneTxt(value: string): string {
  const parts: string[] = [];
  let part = '';
  let bytes = 0;
  for (const char of value) {
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
  return parts.map(quoteZone).join(' ');
}

/** A record line of a zone, with what the panel needs to rewrite it. */
export interface ZoneEntry extends DnsRecord {
  /** Type as Joker names it (URL, FRAME, DYNA, ...). */
  jokerType: string;
  /** Raw text after the TTL (valid-from, valid-to, FRAME/MAILFW/URL parameters). */
  tail: string;
}

export interface ZoneLine {
  /** The line as Joker sent it (without line terminator), written back unchanged. */
  raw: string;
  /** Null for blank lines, comments and directives such as $dyndns=... */
  entry: ZoneEntry | null;
}

export interface ParsedZone {
  lines: ZoneLine[];
}

const integer = (value: string | undefined): number | null =>
  value !== undefined && /^\d+$/.test(value) ? Number(value) : null;

type Mapped = Omit<ZoneEntry, 'id' | 'name' | 'jokerType' | 'readOnly'> & { readOnly?: boolean };

/** Generic record from the tokens of a well-formed line, null if the line does not fit. */
function mapTokens(raw: string, jokerType: string, t: ZoneToken[]): Mapped | null {
  const pri = t[2]!.value;
  const tailAfter = (index: number) => (t[index] ? raw.slice(t[index]!.end).trim() : '');
  const standard = (data: string, ttlAt = 4): Mapped | null => {
    const ttl = integer(t[ttlAt]?.value);
    return ttl === null
      ? null
      : { type: TO_GENERIC[jokerType] ?? jokerType, data, ttl, tail: tailAfter(ttlAt) };
  };
  switch (jokerType) {
    case 'A':
    case 'AAAA':
    case 'CNAME':
    case 'URL':
    case 'FRAME':
    case 'MAILFW':
      return standard(t[3]!.value);
    case 'DYNA':
    case 'DYNAAAA': {
      const mapped = standard(t[3]!.value);
      return mapped && { ...mapped, readOnly: true };
    }
    case 'MX': {
      const priority = integer(pri);
      return priority === null ? null : standard(`${priority} ${t[3]!.value}`);
    }
    case 'TXT': {
      // Long values may come as several quoted strings, which DNS concatenates.
      let end = 4;
      if (t[3]!.quoted) while (t[end]?.quoted) end++;
      return standard(
        t
          .slice(3, end)
          .map((x) => x.value)
          .join(''),
        end,
      );
    }
    case 'SRV': {
      // "_sip._tcp SRV 10/100 sip.example.com:5060 3600": priority/weight, target:port.
      const [priority, weight = '0', extra] = pri.split('/');
      const target = t[3]!.value;
      const colon = target.lastIndexOf(':');
      const port = integer(target.slice(colon + 1));
      if (extra !== undefined || integer(priority) === null || integer(weight) === null) return null;
      if (colon <= 0 || port === null) return null;
      return standard(`${integer(priority)} ${integer(weight)} ${port} ${target.slice(0, colon)}`);
    }
    case 'CAA': {
      // "caa CAA 0 issue "letsencrypt.org" 86400"; tolerated: the whole value in one string.
      if (/\s/.test(t[3]!.value)) {
        const inner = tokenizeZoneLine(t[3]!.value).tokens;
        const [flags, tag, value] = inner.length === 2 ? [{ value: pri }, ...inner] : inner;
        if (inner.length < 2 || inner.length > 3 || integer(flags?.value) === null) return null;
        return standard(`${integer(flags!.value)} ${tag!.value} ${quoteZone(value!.value)}`);
      }
      if (t.length < 6 || integer(pri) === null) return null;
      return standard(`${integer(pri)} ${t[3]!.value} ${quoteZone(t[4]!.value)}`, 5);
    }
    case 'NAPTR': {
      // "naptr NAPTR 10/100 replacement 86400 0 0 "flags" "service" "regex"".
      const [order, preference = '0', extra] = pri.split('/');
      if (extra !== undefined || integer(order) === null || integer(preference) === null) return null;
      const [flags = '', service = '', regexp = ''] = t.slice(7, 10).map((x) => x.value);
      const mapped = standard(
        `${integer(order)} ${integer(preference)} ${quoteZone(flags)} ${quoteZone(service)} ${quoteZone(regexp)} ${t[3]!.value}`,
      );
      return mapped && { ...mapped, tail: '' };
    }
    default:
      return null;
  }
}

function parseEntry(raw: string): Omit<ZoneEntry, 'id'> | null {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('$')) return null;
  const { tokens, complete } = tokenizeZoneLine(raw);
  const name = tokens[0]?.value ?? '';
  const jokerType = (tokens[1]?.value ?? '').toUpperCase();
  const mapped = complete && tokens.length >= 5 ? mapTokens(raw, jokerType, tokens) : null;
  if (mapped) return { name, jokerType, ...mapped, readOnly: mapped.readOnly ?? false };
  // Shown as Joker has it, can only be deleted. A line in the usual layout (label type pri
  // target ttl) shows its target, anything else the rest of the line.
  const ttl = complete ? integer(tokens[4]?.value) : null;
  const pri = tokens[2]?.value;
  const target = tokens[3] ? raw.slice(tokens[3].start, tokens[3].end) : '';
  return {
    name,
    jokerType: jokerType || '?',
    type: jokerType || 'UNKNOWN',
    data:
      ttl !== null
        ? `${pri !== '0' ? `${pri} ` : ''}${target}`
        : tokens[2]
          ? raw.slice(tokens[2].start).trim()
          : '',
    ttl,
    tail: '',
    readOnly: true,
  };
}

/** Whitespace-insensitive form of a line, the basis of its record id. */
function canonicalLine(raw: string): string {
  const { tokens, complete } = tokenizeZoneLine(raw);
  if (!complete) return raw.trim().replace(/\s+/g, ' ');
  return tokens
    .map((t, i) => {
      const value = i === 0 ? t.value.toLowerCase() : i === 1 ? t.value.toUpperCase() : t.value;
      return t.quoted ? quoteZone(value) : value;
    })
    .join(' ');
}

/**
 * Parses a dns-zone-get body. Record ids derive from the line content (hash plus a counter
 * for identical lines), so an id from an outdated list never matches a different record.
 */
export function parseZone(text: string): ParsedZone {
  const seen = new Map<string, number>();
  const lines = text.split('\n').map((raw): ZoneLine => {
    const parsed = parseEntry(raw);
    if (!parsed) return { raw, entry: null };
    const hash = createHash('sha256').update(canonicalLine(raw)).digest('hex').slice(0, 16);
    const count = (seen.get(hash) ?? 0) + 1;
    seen.set(hash, count);
    return { raw, entry: { id: count === 1 ? hash : `${hash}-${count}`, ...parsed } };
  });
  return { lines };
}

export function serializeZone(zone: ParsedZone): string {
  return zone.lines.map((l) => l.raw).join('\n');
}

export function toDnsRecord(entry: ZoneEntry): DnsRecord {
  const record: DnsRecord = {
    id: entry.id,
    type: entry.type,
    name: entry.name,
    data: entry.data,
    ttl: entry.ttl,
  };
  if (entry.readOnly) record.readOnly = true;
  return record;
}

export function zoneRecords(zone: ParsedZone): DnsRecord[] {
  return zone.lines.flatMap((l) => (l.entry ? [toDnsRecord(l.entry)] : []));
}

/** Index where a new line goes: after the last non-blank line. */
export function appendIndex(zone: ParsedZone): number {
  let index = zone.lines.length;
  while (index > 0 && zone.lines[index - 1]!.raw.trim() === '') index--;
  return index;
}

// --- Building zone lines ----------------------------------------------------------

const DNS_LABEL = '[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?';
const RECORD_LABEL = new RegExp(`^(@|\\*|(\\*\\.)?${DNS_LABEL}(\\.${DNS_LABEL})*)$`, 'i');
const HOST = new RegExp(`^(?=.{1,254}$)${DNS_LABEL}(\\.${DNS_LABEL})*\\.?$`, 'i');
const EMAIL = /^[^\s@"\\]+@[^\s@"\\]+\.[^\s@"\\]+$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export interface ZoneLineInput {
  type: string;
  name: string;
  data: string;
  ttl: number;
}

/**
 * Joker wants at least 300 s, SRV and NAPTR may use 0 (no caching). Checked for TTLs the
 * user gives; a TTL kept from the zone is Joker's own and written back as it is.
 */
export function checkTtl(type: string, ttl: number): void {
  const min = type === 'SRV' || type === 'NAPTR' ? 0 : 300;
  if (!Number.isInteger(ttl) || ttl < min || ttl > MAX_TTL) {
    throw badRequest(
      min === 0
        ? `TTL must be a whole number of seconds between 0 and ${MAX_TTL}`
        : `Joker needs a TTL of at least 300 seconds (got ${ttl})`,
    );
  }
}

function port(value: string, what: string): number {
  const n = integer(value);
  if (n === null || n > 65535) throw badRequest(`${what} must be a number between 0 and 65535`);
  return n;
}

function host(value: string, what: string): string {
  if (!HOST.test(value)) throw badRequest(`${what} must be a host name, e.g. host.example.ch`);
  return value;
}

/**
 * Joker zone line for a record in the panel's generic format (see DnsRecord). Validates
 * what Joker would reject and what could break the zone (line breaks, stray quotes).
 * `tail` (valid-from, valid-to, parameters) is kept when a record keeps its type.
 */
export function buildZoneLine(input: ZoneLineInput, tail = ''): string {
  const type = input.type.toUpperCase();
  const data = input.data.trim();
  const name = input.name.trim() === '' ? '@' : input.name.trim();
  if (!(JOKER_RECORD_TYPES as string[]).includes(type)) {
    throw badRequest(`Joker does not support ${input.type} records`);
  }
  if (CONTROL_CHARS.test(name) || CONTROL_CHARS.test(data) || CONTROL_CHARS.test(tail)) {
    throw badRequest('Records must not contain line breaks or control characters');
  }
  if (!RECORD_LABEL.test(name)) throw badRequest(`Invalid record name "${name}"`);
  if (data === '') throw badRequest('Value is required');
  if (!Number.isInteger(input.ttl) || input.ttl < 0 || input.ttl > MAX_TTL) {
    throw badRequest(`TTL must be a whole number of seconds between 0 and ${MAX_TTL}`);
  }
  const jokerType = TO_JOKER[type] ?? type;
  const line = (pri: string | number, target: string, keepTail = true) =>
    `${name} ${jokerType} ${pri} ${target} ${input.ttl}${keepTail && tail ? ` ${tail}` : ''}`;

  switch (type) {
    case 'A':
      if (!isIPv4(data)) throw badRequest('A records need an IPv4 address');
      return line(0, data);
    case 'AAAA':
      if (!isIPv6(data) || data.includes('%')) throw badRequest('AAAA records need an IPv6 address');
      return line(0, data);
    case 'CNAME':
      return line(0, host(data, 'The target'));
    case 'MX': {
      const m = /^(\S+)\s+(\S+)$/.exec(data);
      if (!m) throw badRequest('MX records need "priority host", e.g. "10 mail.example.ch"');
      return line(port(m[1]!, 'The priority'), host(m[2]!, 'The mail server'));
    }
    case 'TXT':
      return line(0, quoteZoneTxt(data));
    case 'SRV': {
      const m = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/.exec(data);
      if (!m)
        throw badRequest('SRV records need "priority weight port target", e.g. "10 5 5060 sip.example.ch"');
      const target = host(m[4]!, 'The target').replace(/\.$/, '');
      return line(
        `${port(m[1]!, 'The priority')}/${port(m[2]!, 'The weight')}`,
        `${target}:${port(m[3]!, 'The port')}`,
      );
    }
    case 'CAA': {
      const { tokens, complete } = tokenizeZoneLine(data);
      const [flags, tag, value] = tokens;
      if (!complete || tokens.length !== 3 || !value) {
        throw badRequest('CAA records need \'flags tag "value"\', e.g. \'0 issue "letsencrypt.org"\'');
      }
      if (flags!.value !== '0') throw badRequest('Joker only supports CAA records with flags 0');
      if (!/^[a-z0-9]{1,15}$/i.test(tag!.value)) throw badRequest(`Invalid CAA tag "${tag!.value}"`);
      if (value.value === '') throw badRequest('The CAA value is required');
      return line(0, `${tag!.value.toLowerCase()} ${quoteZone(value.value)}`);
    }
    case 'NAPTR': {
      const { tokens, complete } = tokenizeZoneLine(data);
      if (!complete || tokens.length !== 6) {
        throw badRequest(
          'NAPTR records need \'order preference "flags" "service" "regexp" replacement\', e.g. \'100 10 "u" "E2U+sip" "!^.*$!sip:info@example.ch!" .\'',
        );
      }
      const [order, preference, flags, service, regexp, replacement] = tokens.map((t) => t.value) as [
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      if (!/^[a-z0-9]*$/i.test(flags)) throw badRequest('NAPTR flags may only contain letters and digits');
      if (replacement !== '.') host(replacement, 'The replacement');
      if (regexp !== '' && replacement !== '.') {
        throw badRequest('A NAPTR record takes either a regexp (with replacement ".") or a replacement');
      }
      const params = [flags, service, regexp].map(quoteZone).join(' ');
      return `${line(`${port(order, 'The order')}/${port(preference, 'The preference')}`, replacement, false)} 0 0 ${params}`;
    }
    case 'HTTP_REDIRECT':
    case 'HTTP_FRAME': {
      let url: URL | null = null;
      try {
        url = new URL(data);
      } catch {
        // handled below
      }
      if (!url || !['http:', 'https:'].includes(url.protocol) || /[\s"\\]/.test(data)) {
        throw badRequest('Redirects need an http(s) URL, e.g. https://www.example.ch/');
      }
      return line(0, data);
    }
    case 'MAILFW':
      if (!EMAIL.test(data)) throw badRequest('Mail forwarding needs an e-mail address');
      return line(0, data);
    default:
      throw badRequest(`Joker does not support ${input.type} records`);
  }
}
