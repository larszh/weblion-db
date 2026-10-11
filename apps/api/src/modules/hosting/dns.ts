import { isIPv4, isIPv6 } from 'node:net';
import { z } from 'zod';
import { DNS_RECORD_TYPES } from '@weblion/shared';

/**
 * Input rules for DNS records and name servers. Values are checked per type in the generic
 * formats (see DnsRecord in @weblion/shared) so obvious mistakes never reach the provider:
 * A = IPv4, AAAA = IPv6, CNAME/ALIAS/NS = host name, MX = "priority host", SRV = "priority
 * weight port target", CAA = 'flags tag "value"', NAPTR = 'order preference "flags"
 * "service" "regexp" replacement', HTTP_REDIRECT/HTTP_FRAME = http(s) URL, MAILFW = e-mail
 * address, everything else (TXT, TLSA, ...) non-empty and at most 4096 characters.
 */

const LABEL = '[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?';
const TLD = '[a-z]([a-z0-9-]{0,61}[a-z0-9])?';
/** Fully qualified host name, optional trailing dot. */
const HOSTNAME = new RegExp(`^(?=.{1,253}\\.?$)(${LABEL}\\.)+${TLD}\\.?$`, 'i');
/** Record name relative to the zone: "@", "", "*", "www", "_dmarc", "*.dev", "_sip._tls". */
const RECORD_NAME = new RegExp(`^(|@|\\*|(\\*\\.)?${LABEL}(\\.${LABEL})*)$`, 'i');
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
/** A double quoted string, backslash escapes allowed inside. */
const QUOTED = '"(?:[^"\\\\]|\\\\.)*"';
const SRV = /^(\d{1,5})\s+(\d{1,5})\s+(\d{1,5})\s+(\S+)$/;
const CAA = new RegExp(`^(\\d{1,3})\\s+([a-z0-9]+)\\s+(${QUOTED}|[^\\s"]+)$`, 'i');
const NAPTR = new RegExp(`^(\\d{1,5})\\s+(\\d{1,5})\\s+${QUOTED}\\s+${QUOTED}\\s+${QUOTED}\\s+(\\S+)$`);
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(.+)$/i;

export const DNS_DATA_MAX = 4096;
/** One week. Providers may ask for more (Joker: at least 300 s for most types). */
export const DNS_TTL_MAX = 604_800;
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

export function dnsDataIssue(type: string, data: string): string | null {
  if (data.length === 0) return 'Value is required';
  if (data.length > DNS_DATA_MAX) return `Value is too long (max. ${DNS_DATA_MAX} characters)`;
  if (CONTROL_CHARS.test(data)) return 'Value must not contain line breaks or control characters';
  switch (type.toUpperCase()) {
    case 'A':
      return isIPv4(data) ? null : 'A records need an IPv4 address';
    case 'AAAA':
      return isIPv6(data) && !data.includes('%') ? null : 'AAAA records need an IPv6 address';
    case 'CNAME':
    case 'ALIAS':
    case 'NS':
      return HOSTNAME.test(data) ? null : `${type} records need a host name, e.g. host.example.ch`;
    case 'MX': {
      const match = /^(\d{1,5})\s+(\S+)$/.exec(data);
      return match && isUint16(match[1]!) && HOSTNAME.test(match[2]!)
        ? null
        : 'MX records need "priority host", e.g. "10 mail.example.ch"';
    }
    case 'SRV': {
      const match = SRV.exec(data);
      return match && [match[1]!, match[2]!, match[3]!].every(isUint16) && isTarget(match[4]!)
        ? null
        : 'SRV records need "priority weight port target" (numbers up to 65535, target a host name or "."), e.g. "10 5 5060 sip.example.ch"';
    }
    case 'CAA': {
      const match = CAA.exec(data);
      return match && Number(match[1]) <= 255
        ? null
        : 'CAA records need "flags tag value" (flags 0 to 255, tag letters and digits), e.g. 0 issue "letsencrypt.org"';
    }
    case 'NAPTR': {
      const match = NAPTR.exec(data);
      return match && isUint16(match[1]!) && isUint16(match[2]!) && isTarget(match[3]!)
        ? null
        : 'NAPTR records need order preference "flags" "service" "regexp" replacement, e.g. 100 10 "u" "E2U+sip" "!^.*$!sip:info@example.ch!" .';
    }
    case 'HTTP_REDIRECT':
    case 'HTTP_FRAME':
      return isHttpUrl(data)
        ? null
        : `${type} records need an http or https URL, e.g. https://www.example.ch`;
    case 'MAILFW':
      return isEmail(data) ? null : 'MAILFW records need an e-mail address, e.g. info@example.ch';
    default:
      return null;
  }
}

const recordName = z.string().trim().max(253).regex(RECORD_NAME, 'invalid record name');
const recordData = z.string().trim().max(DNS_DATA_MAX);
/** Seconds. Null or left out: the provider default (new records) or unchanged (updates). */
const recordTtl = z
  .number()
  .int('TTL must be whole seconds')
  .min(0, 'TTL must not be negative')
  .max(DNS_TTL_MAX, `TTL must be at most ${DNS_TTL_MAX} seconds`)
  .nullable()
  .optional();

/** Route through the provider's proxy (Cloudflare). Dropped for providers without "dnsProxy". */
const recordProxied = z.boolean().optional();

export const dnsRecordBody = z
  .object({
    type: z.enum(DNS_RECORD_TYPES),
    name: recordName,
    data: recordData,
    ttl: recordTtl,
    proxied: recordProxied,
  })
  .superRefine((record, ctx) => {
    const issue = dnsDataIssue(record.type, record.data);
    if (issue) ctx.addIssue({ code: 'custom', path: ['data'], message: issue });
  });

export const dnsRecordPatchBody = z
  .object({
    type: z.enum(DNS_RECORD_TYPES).optional(),
    name: recordName.optional(),
    data: recordData.optional(),
    ttl: recordTtl,
    proxied: recordProxied,
  })
  .refine(
    (p) =>
      p.type !== undefined ||
      p.name !== undefined ||
      p.data !== undefined ||
      p.ttl != null ||
      p.proxied !== undefined,
    'Nothing to change',
  );

/** A name server: trimmed, lower-cased, stored without the trailing dot. */
const nameserver = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(HOSTNAME, 'Name servers must be host names, e.g. ns1.example.ch')
  .transform((ns) => ns.replace(/\.$/, ''));

export const nameserversBody = z
  .object({
    nameservers: z
      .array(nameserver)
      .min(NAMESERVERS_MIN, `At least ${NAMESERVERS_MIN} name servers are required`)
      .max(NAMESERVERS_MAX, `At most ${NAMESERVERS_MAX} name servers are allowed`),
  })
  .superRefine((body, ctx) => {
    body.nameservers.forEach((ns, i) => {
      if (body.nameservers.indexOf(ns) !== i) {
        ctx.addIssue({ code: 'custom', path: ['nameservers', i], message: `${ns} is listed twice` });
      }
    });
  });
