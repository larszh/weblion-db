import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  AI_DNS_TOPICS,
  type AiCheckStatus,
  type AiDnsCheckResult,
  type AiDnsProposalDto,
  type DnsRecord,
  type DnsRecordType,
  type DomainDetailDto,
  type MailDnsSetupDto,
  type MailDomainDto,
  type WebspaceDto,
  type WebsiteDnsCheckDto,
} from '@weblion/shared';
import { notFound } from '../../../lib/errors';
import { dnsRecordBody } from '../../hosting/dns';
import { thirdParty } from '../prompts';
import type { ConsoleReader } from '../reader';
import { callFeature, userTurn, type FeatureRun } from './common';

/**
 * DNS and mail check of one zone (ai 10.2) and the validation of DNS proposals, shared with the assistant's
 * propose_dns_record tool (ai 8.4). A proposal is `verified` only when it equals a record the console computed
 * itself (mail DNS setup, website A/AAAA); third-party text in TXT records, monitor messages or SMTP errors can
 * inject values (review #5), so everything else is marked unverified and needs a second confirmation in the web.
 * NS records and deletions cannot be proposed at all; a change of an MX or apex A/AAAA record only to a verified
 * value (plan decision 23).
 */

export const PROPOSAL_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'CAA'] as const;

export interface ExpectedDnsRecord {
  source: 'mail' | 'website';
  /** MailDnsRecordKey, or 'a' / 'aaaa' / 'www_a' / 'www_aaaa'. */
  key: string;
  type: 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'SRV';
  name: string;
  data: string;
  status: 'ok' | 'missing' | 'conflict' | 'unknown';
  required: boolean;
}

export interface DnsContext {
  /** ASCII, lower case. */
  zone: string;
  /** The zone in the console, null when it is served elsewhere (proposals are textOnly then). */
  domain: { id: string; writable: boolean; canEdit: boolean; recordTypes: DnsRecordType[] } | null;
  /** GET /domains/:id/dns; null when not readable. */
  records: DnsRecord[] | null;
  expected: ExpectedDnsRecord[];
  mail: { mailDomainId: string; setup: MailDnsSetupDto } | null;
  websites: Array<{ websiteId: string; check: WebsiteDnsCheckDto }>;
}

const lower = (s: string) => s.trim().toLowerCase();
const stripDot = (s: string) => s.replace(/\.$/, '');

/** A record name relative to the zone, "@" for the apex. */
export function relativeName(name: string, zone: string): string {
  const n = stripDot(lower(name));
  const z = stripDot(lower(zone));
  if (n === '' || n === '@' || n === z) return '@';
  if (n.endsWith(`.${z}`)) return n.slice(0, -(z.length + 1));
  return n;
}

/** Record data compared without case, trailing dots and TXT quoting (ai 8.4). */
export function normalizeData(type: string, data: string): string {
  let d = data.trim();
  if (type.toUpperCase() === 'TXT') {
    // "v=spf1 " "include:x" -> v=spf1 include:x; a single quoted string loses its quotes.
    const parts = [...d.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!);
    if (parts.length > 0 && d.replace(/"((?:[^"\\]|\\.)*)"/g, '').trim() === '') d = parts.join('');
  }
  return d
    .split(/\s+/)
    .map((part) => stripDot(part))
    .join(' ')
    .toLowerCase();
}

function websiteStatus(status: WebsiteDnsCheckDto['names'][number]['status']): ExpectedDnsRecord['status'] {
  return status === 'ok'
    ? 'ok'
    : status === 'missing'
      ? 'missing'
      : status === 'elsewhere'
        ? 'conflict'
        : 'unknown';
}

function expectedOf(zone: string, ctx: Pick<DnsContext, 'mail' | 'websites'>): ExpectedDnsRecord[] {
  const out: ExpectedDnsRecord[] = [];
  for (const r of ctx.mail?.setup.records ?? []) {
    if (!r.data) continue;
    out.push({
      source: 'mail',
      key: r.key,
      type: r.type,
      name: relativeName(r.name, zone),
      data: r.data,
      status: r.status,
      required: r.required,
    });
  }
  for (const { check } of ctx.websites) {
    for (const entry of check.names) {
      const name = relativeName(entry.name, zone);
      if (name !== '@' && name !== 'www') continue;
      const prefix = name === 'www' ? 'www_' : '';
      for (const ip of check.expected.ipv4) {
        out.push({
          source: 'website',
          key: `${prefix}a`,
          type: 'A',
          name,
          data: ip,
          status: websiteStatus(entry.status),
          required: true,
        });
      }
      for (const ip of check.expected.ipv6) {
        out.push({
          source: 'website',
          key: `${prefix}aaaa`,
          type: 'AAAA',
          name,
          data: ip,
          status: websiteStatus(entry.status),
          required: false,
        });
      }
    }
  }
  return out;
}

async function domainPart(reader: ConsoleReader, domainId: string) {
  const domain = await reader.owned<DomainDetailDto>('domain', domainId);
  if (!domain.ok) return null;
  const records = await reader.sub<DnsRecord[]>('domain', domainId, 'dns');
  const body = domain.body;
  return {
    name: body.name,
    domain: {
      id: domainId,
      writable: body.dnsWritable !== false,
      canEdit: (body.permissions ?? []).includes('domain:dns:write'),
      recordTypes: body.dnsRecordTypes ?? [],
    },
    records: records.ok && Array.isArray(records.body) ? records.body : null,
  };
}

/**
 * The zone with its records, the records the console computed and the website checks (ai 10.2). Every read goes
 * through the person's own routes and the ownership check of the reader; 404 when the start resource is not the
 * organization's.
 */
export async function loadDnsContext(
  reader: ConsoleReader,
  start: { domainId: string } | { mailDomainId: string },
): Promise<DnsContext> {
  if ('mailDomainId' in start) {
    const mail = await reader.owned<MailDomainDto>('mail_domain', start.mailDomainId);
    if (!mail.ok) throw notFound('Mail domain');
    const setup = await reader.sub<MailDnsSetupDto>('mail_domain', start.mailDomainId, 'dns');
    if (!setup.ok) throw notFound('Mail domain');
    const zone = lower(setup.body.domain || mail.body.asciiName);
    const part = setup.body.zone ? await domainPart(reader, setup.body.zone.domainId) : null;
    const partial = { mail: { mailDomainId: start.mailDomainId, setup: setup.body }, websites: [] };
    return {
      zone,
      domain: part?.domain ?? null,
      records: part?.records ?? null,
      expected: expectedOf(zone, partial),
      ...partial,
    };
  }
  const part = await domainPart(reader, start.domainId);
  if (!part) throw notFound('Domain');
  const zone = lower(part.name);
  let mail: DnsContext['mail'] = null;
  const mailList = await reader.orgGet<MailDomainDto[]>('mail/domains');
  const mailDomain = mailList.ok ? mailList.body.find((m) => lower(m.asciiName) === zone) : undefined;
  if (mailDomain) {
    const owned = await reader.owned('mail_domain', mailDomain.id);
    const setup = owned.ok ? await reader.sub<MailDnsSetupDto>('mail_domain', mailDomain.id, 'dns') : null;
    if (setup?.ok) mail = { mailDomainId: mailDomain.id, setup: setup.body };
  }
  const websites: DnsContext['websites'] = [];
  const sites = await reader.orgGet<WebspaceDto[]>('webspaces');
  for (const site of sites.ok && Array.isArray(sites.body) ? sites.body : []) {
    const name = lower(site.name);
    if (name !== zone && name !== `www.${zone}`) continue;
    const owned = await reader.owned('website', site.id);
    const check = owned.ok ? await reader.sub<WebsiteDnsCheckDto>('website', site.id, 'dns-check') : null;
    if (check?.ok) websites.push({ websiteId: site.id, check: check.body });
    if (websites.length >= 2) break;
  }
  return {
    zone,
    domain: part.domain,
    records: part.records,
    expected: expectedOf(zone, { mail, websites }),
    mail,
    websites,
  };
}

export const proposalInput = z.object({
  action: z.enum(['add', 'change']),
  record_id: z.string().max(200).nullable(),
  type: z.enum(PROPOSAL_TYPES),
  name: z.string().max(253),
  data: z.string().max(2048),
  ttl: z.number().int().min(60).max(86_400).nullable(),
  reason: z.string().max(500),
});
export type ProposalInput = z.infer<typeof proposalInput>;

export type ProposalCheck = { ok: true; proposal: AiDnsProposalDto } | { ok: false; issue: string };

/** ai 8.4 steps 2 to 5 on a loaded context (step 1, loading the organization's zone, is loadDnsContext). */
export function validateDnsProposal(dns: DnsContext, input: ProposalInput): ProposalCheck {
  const parsed = proposalInput.safeParse(input);
  if (!parsed.success) return { ok: false, issue: parsed.error.issues[0]?.message ?? 'invalid' };
  const p = parsed.data;
  const name = relativeName(p.name, dns.zone);
  // The console's own record rules (modules/hosting/dns.ts).
  const record = dnsRecordBody.safeParse({
    type: p.type,
    name: name === '@' ? '@' : name,
    data: p.data.trim(),
    ttl: p.ttl,
  });
  if (!record.success) return { ok: false, issue: record.error.issues[0]?.message ?? 'invalid record' };
  const data = record.data.data;
  const verified = dns.expected.some(
    (e) =>
      e.type === p.type && e.name === name && normalizeData(e.type, e.data) === normalizeData(p.type, data),
  );
  let recordId: string | null = null;
  if (p.action === 'change') {
    const existing = dns.records?.find((r) => r.id === p.record_id);
    if (!p.record_id || !existing)
      return { ok: false, issue: 'record_id must name an existing record of the zone' };
    if (String(existing.type).toUpperCase() !== p.type)
      return { ok: false, issue: 'a change keeps the record type' };
    if (relativeName(existing.name, dns.zone) !== name)
      return { ok: false, issue: 'a change keeps the record name' };
    // Mail delivery and the website's address are never replaced on the model's word (plan decision 23).
    const sensitive = p.type === 'MX' || ((p.type === 'A' || p.type === 'AAAA') && name === '@');
    if (sensitive && !verified)
      return {
        ok: false,
        issue: 'MX and apex A/AAAA records can only change to a value the console computed',
      };
    recordId = existing.id;
  }
  const domain = dns.domain;
  const textOnly = !domain || !domain.writable || !domain.canEdit || !domain.recordTypes.includes(p.type);
  return {
    ok: true,
    proposal: {
      id: randomUUID(),
      domainId: domain?.id ?? null,
      zone: dns.zone,
      action: p.action,
      recordId,
      type: p.type,
      name,
      data,
      ttl: p.ttl,
      reason: p.reason.trim().slice(0, 500),
      verified,
      textOnly,
    },
  };
}

export const dnsCheckOutput = z.object({
  overall: z.enum(['ok', 'warning', 'problem']),
  topics: z.array(
    z.object({
      topic: z.enum(AI_DNS_TOPICS),
      status: z.enum(['ok', 'warning', 'problem']),
      finding: z.string(),
      proposal_indexes: z.array(z.number().int()),
    }),
  ),
  proposals: z.array(
    z.object({
      action: z.enum(['add', 'change']),
      record_id: z.string().nullable(),
      type: z.enum(PROPOSAL_TYPES),
      name: z.string(),
      data: z.string(),
      ttl: z.number().int().nullable(),
      reason: z.string(),
    }),
  ),
});

/** What the model gets about the zone: records, the console's expectations with its own status, website checks. */
export function dnsPayload(dns: DnsContext): unknown {
  return {
    zone: dns.zone,
    managedInConsole: !!dns.domain,
    records:
      dns.records
        ?.slice(0, 300)
        .map((r) => ({ id: r.id, type: r.type, name: r.name, data: r.data, ttl: r.ttl })) ?? null,
    expected: dns.expected.map((e) => ({
      source: e.source,
      key: e.key,
      type: e.type,
      name: e.name,
      data: e.data,
      status: e.status,
      required: e.required,
      hint: dns.mail?.setup.records.find((r) => r.key === e.key)?.hint ?? null,
    })),
    websites: dns.websites.map((w) => ({
      names: w.check.names,
      expected: w.check.expected,
      ready: w.check.ready,
    })),
  };
}

/** POST /orgs/:orgId/ai/dns-check (ai 10.2). */
export async function runDnsCheck(
  run: FeatureRun,
  reader: ConsoleReader,
  start: { domainId: string } | { mailDomainId: string },
): Promise<AiDnsCheckResult> {
  const dns = await loadDnsContext(reader, start);
  const user = userTurn(run, null, 'Check this zone.', thirdParty('dns', dnsPayload(dns)));
  const { data, meta } = await callFeature(run, 'dns_check', user, dnsCheckOutput);
  const ids: Array<string | null> = [];
  const proposals: AiDnsProposalDto[] = [];
  let dropped = 0;
  for (const p of data.proposals.slice(0, 20)) {
    const ttl = p.ttl === null ? null : Math.min(86_400, Math.max(60, p.ttl));
    const check = validateDnsProposal(dns, { ...p, ttl });
    if (check.ok) {
      proposals.push(check.proposal);
      ids.push(check.proposal.id);
    } else {
      dropped++;
      ids.push(null);
    }
  }
  return {
    zone: dns.zone,
    overall: data.overall,
    topics: data.topics.slice(0, AI_DNS_TOPICS.length).map((t) => ({
      topic: t.topic,
      status: t.status as AiCheckStatus,
      finding: t.finding,
      proposalIds: t.proposal_indexes.map((i) => ids[i]).filter((id): id is string => !!id),
    })),
    proposals,
    droppedProposals: dropped + Math.max(0, data.proposals.length - 20),
    meta,
  };
}
