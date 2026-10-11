import { and, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import {
  MAIL_DKIM_SELECTOR,
  type DnsRecord,
  type DnsRecordType,
  type MailDnsHint,
  type MailDnsRecordDto,
  type MailDnsRecordKey,
  type MailDnsSetupDto,
  type MailDnsStatus,
  type MailDnsZoneDto,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import { domains, type MailDomain } from '../../db/schema';
import type { DkimKey } from '../../providers/types';
import {
  dnsRecordTypes,
  dnsWritable,
  domainRowsQuery,
  domainScope,
  type LoadedDomain,
} from '../hosting/service';
import type { LoadedMailDomain } from './service';

/**
 * DNS setup of a mail domain: the records Mailcow needs, compared with the zone of the panel
 * domain of the same name (module "dns"), if the caller may read one. Records are only ever
 * added through the hosting code (and audited there); conflicting ones are never touched.
 */

/** Allows the mail server and soft-fails the rest, safe while customers send elsewhere too. */
export const MAIL_SPF_VALUE = 'v=spf1 mx ~all';
/** Monitoring only: no report address, nothing is rejected. */
export const MAIL_DMARC_VALUE = 'v=DMARC1; p=none';

type MailRecordType = MailDnsRecordDto['type'];

export interface ExpectedRecord {
  key: MailDnsRecordKey;
  type: MailRecordType;
  /** Relative to the zone, "@" for the apex. */
  name: string;
  /** Generic format of the panel (see DnsRecord); "" for DKIM while Mailcow has no key. */
  data: string;
  required: boolean;
}

/** What the comparison needs to know about the zone; null = no zone in the console. */
export interface MailZoneCheck {
  writable: boolean;
  canEdit: boolean;
  types: DnsRecordType[];
}

/**
 * The records a mail domain needs, relative names, values in the panel's generic format.
 * Names are relative, so they fit the zone of `domain` whatever provider serves it.
 */
export function expectedMailRecords(
  _domain: string,
  mailHost: string,
  dkim: DkimKey | null,
): ExpectedRecord[] {
  const selector = dkim?.selector ?? MAIL_DKIM_SELECTOR;
  return [
    { key: 'mx', type: 'MX', name: '@', data: `10 ${mailHost}`, required: true },
    { key: 'spf', type: 'TXT', name: '@', data: MAIL_SPF_VALUE, required: true },
    { key: 'dkim', type: 'TXT', name: `${selector}._domainkey`, data: dkim?.txt ?? '', required: true },
    { key: 'dmarc', type: 'TXT', name: '_dmarc', data: MAIL_DMARC_VALUE, required: false },
    { key: 'autodiscover', type: 'CNAME', name: 'autodiscover', data: mailHost, required: false },
    { key: 'autoconfig', type: 'CNAME', name: 'autoconfig', data: mailHost, required: false },
    {
      key: 'autodiscover_srv',
      type: 'SRV',
      name: '_autodiscover._tcp',
      data: `0 1 443 ${mailHost}`,
      required: false,
    },
  ];
}

// --- Comparison ---------------------------------------------------------------------

/** Host name as compared: lower-case, without the trailing dot. */
const hostName = (value: string) => value.trim().toLowerCase().replace(/\.$/, '');

/** Record name relative to the zone, lower-case, "@" for the apex (FQDNs stripped defensively). */
function relativeName(name: string, domain: string): string {
  const fqdn = hostName(name);
  if (fqdn === '' || fqdn === '@' || fqdn === domain) return '@';
  return fqdn.endsWith(`.${domain}`) ? fqdn.slice(0, -(domain.length + 1)) : fqdn;
}

const QUOTED_STRINGS = /^(?:"(?:[^"\\]|\\.)*"\s*)+$/;

/** A TXT value as one string: '"v=DKIM1; p=ab" "cd"' becomes 'v=DKIM1; p=abcd', spaces collapsed. */
function txtValue(data: string): string {
  const trimmed = data.trim();
  const joined = QUOTED_STRINGS.test(trimmed)
    ? [...trimmed.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!.replace(/\\(.)/g, '$1')).join('')
    : trimmed;
  return joined.replace(/\s+/g, ' ').trim();
}

/** Value of a tag ("p", "v") of a DKIM or DMARC style TXT value, without whitespace. */
function tagValue(value: string, tag: string): string | null {
  for (const part of value.split(';')) {
    const [key, ...rest] = part.split('=');
    if (key?.trim().toLowerCase() === tag) return rest.join('=').replace(/\s+/g, '');
  }
  return null;
}

const isSpf = (value: string) => /^v=spf1(\s|$)/i.test(value);
const isDmarc = (value: string) => tagValue(value, 'v')?.toLowerCase() === 'dmarc1';
const isDkim = (value: string) =>
  tagValue(value, 'v')?.toLowerCase() === 'dkim1' || tagValue(value, 'p') !== null;

/** Host of an MX value "priority host" (a bare host is taken as well). */
function mxHost(data: string): string {
  const parts = data.trim().split(/\s+/);
  return hostName(parts[parts.length - 1] ?? '');
}

/** Port and target of an SRV value "priority weight port target", or null. */
function srvTarget(data: string): { port: number; target: string } | null {
  const match = /^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)$/.exec(data.trim());
  return match ? { port: Number(match[3]), target: hostName(match[4]!) } : null;
}

interface Verdict {
  status: MailDnsStatus;
  hint: MailDnsHint | null;
  found: string[];
}

const missing = (hint: MailDnsHint | null = null, found: string[] = []): Verdict => ({
  status: 'missing',
  hint,
  found,
});
const ok = (records: DnsRecord[]): Verdict => ({
  status: 'ok',
  hint: null,
  found: records.map((r) => r.data),
});
const conflict = (hint: MailDnsHint, records: DnsRecord[]): Verdict => ({
  status: 'conflict',
  hint,
  found: records.map((r) => r.data),
});

/**
 * Status of each expected record against the zone. records null = zone unknown (status
 * "unknown"). zone null = no zone the caller may manage, so nothing is addable.
 */
export function evaluateMailRecords(
  domain: string,
  mailHost: string,
  expected: ExpectedRecord[],
  records: DnsRecord[] | null,
  zone: MailZoneCheck | null,
): MailDnsRecordDto[] {
  const apex = domain.toLowerCase();
  const target = hostName(mailHost);
  const at = (name: string, type?: string) =>
    (records ?? []).filter(
      (r) => relativeName(r.name, apex) === name && (!type || r.type.toUpperCase() === type),
    );
  const mxOk = at('@', 'MX').some((r) => mxHost(r.data) === target);

  function verdict(record: ExpectedRecord): Verdict {
    switch (record.key) {
      case 'mx': {
        const mx = at('@', 'MX');
        if (mx.length === 0) return missing();
        const fitting = mx.filter((r) => mxHost(r.data) === target);
        return fitting.length > 0 ? ok(fitting) : conflict('other_mx', mx);
      }
      case 'spf': {
        const spf = at('@', 'TXT').filter((r) => isSpf(txtValue(r.data)));
        if (spf.length === 0) return missing();
        if (spf.length > 1) return conflict('several_spf', spf);
        const terms = txtValue(spf[0]!.data).toLowerCase().split(' ');
        const named = [`a:${target}`, `+a:${target}`, `include:${target}`, `+include:${target}`];
        const fits =
          terms.some((term) => named.includes(term)) ||
          (mxOk && (terms.includes('mx') || terms.includes('+mx')));
        return fits ? ok(spf) : conflict('other_spf', spf);
      }
      case 'dkim': {
        const keys = at(record.name, 'TXT').filter((r) => isDkim(txtValue(r.data)));
        // Without a key at Mailcow there is nothing to compare with: generate one first.
        if (record.data === '')
          return missing(
            'no_dkim_key',
            keys.map((r) => r.data),
          );
        const wanted = tagValue(record.data, 'p');
        const fitting = keys.filter((r) => tagValue(txtValue(r.data), 'p') === wanted);
        if (fitting.length > 0) return ok(fitting);
        return keys.length > 0 ? conflict('other_dkim_key', keys) : missing();
      }
      case 'dmarc': {
        const dmarc = at(record.name, 'TXT').filter((r) => isDmarc(txtValue(r.data)));
        if (dmarc.length === 0) return missing();
        return dmarc.length === 1 ? ok(dmarc) : conflict('several_dmarc', dmarc);
      }
      case 'autodiscover':
      case 'autoconfig': {
        const all = at(record.name);
        const cnames = all.filter((r) => r.type.toUpperCase() === 'CNAME');
        const fitting = cnames.filter((r) => hostName(r.data) === target);
        if (fitting.length > 0) return ok(fitting);
        if (cnames.length > 0) return conflict('other_target', cnames);
        return all.length > 0 ? conflict('name_in_use', all) : missing();
      }
      case 'autodiscover_srv': {
        const srv = at(record.name, 'SRV');
        const fitting = srv.filter((r) => {
          const parsed = srvTarget(r.data);
          return parsed?.port === 443 && parsed.target === target;
        });
        if (fitting.length > 0) return ok(fitting);
        return srv.length > 0 ? conflict('other_target', srv) : missing();
      }
    }
  }

  return expected.map((record) => {
    const noKey = record.key === 'dkim' && record.data === '';
    let result: Verdict =
      records !== null
        ? verdict(record)
        : { status: 'unknown', hint: noKey ? 'no_dkim_key' : null, found: [] };
    const typeTaken = zone !== null && zone.types.includes(record.type);
    if (result.status === 'missing' && zone !== null && !typeTaken && result.hint === null) {
      result = { ...result, hint: 'type_not_supported' };
    }
    return {
      key: record.key,
      type: record.type,
      name: record.name,
      fqdn: record.name === '@' ? apex : `${record.name}.${apex}`,
      data: record.data,
      required: record.required,
      status: result.status,
      hint: result.hint,
      found: result.found,
      addable:
        zone !== null &&
        zone.writable &&
        zone.canEdit &&
        result.status === 'missing' &&
        record.data !== '' &&
        typeTaken,
    };
  });
}

// --- Zone lookup and setup ----------------------------------------------------------

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * The panel domain of the same name the caller may read (the "dns" module gate of its
 * organization included), built like loadDomain without the 404. Preferred, in order: an
 * adapter that lists records, a zone the provider's name servers serve, writable DNS; then the
 * oldest row. Registrations and Cloudflare zones qualify alike.
 */
export async function findMailZone(
  ctx: AppContext,
  req: FastifyRequest,
  mailDomain: Pick<MailDomain, 'externalId' | 'name'>,
): Promise<LoadedDomain | null> {
  const names = [...new Set([mailDomain.externalId.toLowerCase(), mailDomain.name.toLowerCase()])];
  const rows = await domainRowsQuery(ctx).where(
    and(inArray(sql`lower(${domains.name})`, names), isNull(domains.missingSince)),
  );
  const candidates: { zone: LoadedDomain; rank: number[] }[] = [];
  for (const row of rows) {
    const scope = domainScope(row.domain);
    if (!(await ctx.access.can(req, 'domain:read', scope))) continue;
    const adapter = ctx.providers.forConnection(row.connection);
    candidates.push({
      zone: { ...row, scope, adapter },
      rank: [
        typeof adapter.listDnsRecords === 'function' ? 0 : 1,
        row.domain.info?.providerDns === false ? 1 : 0,
        (await dnsWritable(adapter)) ? 0 : 1,
        row.domain.createdAt.getTime(),
      ],
    });
  }
  candidates.sort((a, b) => {
    for (let i = 0; i < a.rank.length; i++) {
      const diff = a.rank[i]! - b.rank[i]!;
      if (diff !== 0) return diff;
    }
    return 0;
  });
  return candidates[0]?.zone ?? null;
}

/**
 * The DNS setup of a mail domain for this caller. A DKIM key that cannot be read leaves
 * the DKIM record "unknown"; records that cannot be listed leave every record "unknown".
 * Pass `zone` when the caller looked it up already (undefined: looked up here).
 */
export async function buildMailDnsSetup(
  ctx: AppContext,
  req: FastifyRequest,
  loaded: LoadedMailDomain,
  zone?: LoadedDomain | null,
): Promise<MailDnsSetupDto> {
  const ascii = loaded.mailDomain.externalId;
  const { mailHost } = loaded.adapter.mailClientSettings!();
  let dkim: DkimKey | null = null;
  let dkimUnknown = false;
  try {
    dkim = await loaded.adapter.getDkim!(ascii);
  } catch (err) {
    req.log.warn({ err, mailDomainId: loaded.mailDomain.id }, 'DKIM key could not be read');
    dkimUnknown = true;
  }

  const found = zone === undefined ? await findMailZone(ctx, req, loaded.mailDomain) : zone;
  let zoneDto: MailDnsZoneDto | null = null;
  let check: MailZoneCheck | null = null;
  let records: DnsRecord[] | null = null;
  if (found) {
    let error: string | null = null;
    if (typeof found.adapter.listDnsRecords === 'function') {
      try {
        records = await found.adapter.listDnsRecords(found.domain.externalId);
      } catch (err) {
        error = errorMessage(err);
      }
    } else {
      error = 'This provider does not list DNS records';
    }
    const writable = await dnsWritable(found.adapter);
    const canEdit = await ctx.access.can(req, 'domain:dns:write', found.scope);
    zoneDto = {
      domainId: found.domain.id,
      name: found.domain.name,
      provider: { id: found.connection.id, type: found.connection.type, name: found.connection.name },
      writable,
      canEdit,
      live: found.domain.info?.providerDns ?? null,
      error,
    };
    check = { writable, canEdit, types: dnsRecordTypes(found.adapter) };
  }

  const evaluated = evaluateMailRecords(
    ascii,
    mailHost,
    expectedMailRecords(ascii, mailHost, dkim),
    records,
    check,
  ).map((record) =>
    dkimUnknown && record.key === 'dkim'
      ? { ...record, status: 'unknown' as const, hint: null, found: [], addable: false }
      : record,
  );
  return {
    domain: ascii,
    mailHost,
    dkim: {
      selector: dkim?.selector ?? MAIL_DKIM_SELECTOR,
      present: dkim !== null,
      keyLength: dkim?.keyLength ?? null,
    },
    zone: zoneDto,
    records: evaluated,
  };
}
