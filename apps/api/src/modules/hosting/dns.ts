import { isIPv4, isIPv6 } from 'node:net';
import { z } from 'zod';
import { DNS_RECORD_TYPES } from '@weblion/shared';

/**
 * Input rules for DNS records. Values are checked per type so obvious mistakes never
 * reach the provider: A = IPv4, AAAA = IPv6, CNAME/ALIAS/NS = host name, MX = "priority
 * host", everything else (TXT, SRV, CAA, ...) non-empty and at most 4096 characters.
 */

const LABEL = '[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?';
const TLD = '[a-z]([a-z0-9-]{0,61}[a-z0-9])?';
/** Fully qualified host name, optional trailing dot. */
const HOSTNAME = new RegExp(`^(?=.{1,253}\\.?$)(${LABEL}\\.)+${TLD}\\.?$`, 'i');
/** Record name relative to the zone: "@", "", "*", "www", "_dmarc", "*.dev", "_sip._tls". */
const RECORD_NAME = new RegExp(`^(|@|\\*|(\\*\\.)?${LABEL}(\\.${LABEL})*)$`, 'i');
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export const DNS_DATA_MAX = 4096;

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
      return match && Number(match[1]) <= 65535 && HOSTNAME.test(match[2]!)
        ? null
        : 'MX records need "priority host", e.g. "10 mail.example.ch"';
    }
    default:
      return null;
  }
}

const recordName = z.string().trim().max(253).regex(RECORD_NAME, 'invalid record name');
const recordData = z.string().trim().max(DNS_DATA_MAX);

export const dnsRecordBody = z
  .object({ type: z.enum(DNS_RECORD_TYPES), name: recordName, data: recordData })
  .superRefine((record, ctx) => {
    const issue = dnsDataIssue(record.type, record.data);
    if (issue) ctx.addIssue({ code: 'custom', path: ['data'], message: issue });
  });

export const dnsRecordPatchBody = z
  .object({
    type: z.enum(DNS_RECORD_TYPES).optional(),
    name: recordName.optional(),
    data: recordData.optional(),
  })
  .refine((p) => p.type !== undefined || p.name !== undefined || p.data !== undefined, 'Nothing to change');
