import { Resolver } from 'node:dns/promises';
import { domainToUnicode } from 'node:url';
import { and, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { wwwCounterpart, type WebsiteDnsName, type WebsiteDnsStatus } from '@weblion/shared';
import type { Env } from '../../config/env';
import type { AppContext } from '../../context';
import { domains } from '../../db/schema';
import { unsupported } from '../../lib/errors';
import type { ProviderAdapter } from '../../providers/types';
import { domainScope } from './service';

/**
 * DNS check of a website (module "webhosting", CloudPanel): do the domain and its www
 * counterpart point to the server? Let's Encrypt only issues a certificate when they do, and
 * repeated failures run into its rate limits, so the console asks public resolvers first.
 */

/** What public DNS answers for one name. `error`: the lookup failed (not: the name has no records). */
export interface DnsAnswer {
  a: string[];
  aaaa: string[];
  error: string | null;
}

export type DnsLookup = (name: string) => Promise<DnsAnswer>;

export interface WebsiteDnsResult {
  expected: { ipv4: string[]; ipv6: string[] };
  /** The domain and its www counterpart. */
  names: WebsiteDnsName[];
  ready: boolean;
  checkedAt: string;
}

/** Results are kept this long per website, so reloading the page does not query DNS again. */
export const DNS_CHECK_CACHE_MS = 60_000;
const DNS_CHECK_CACHE_MAX = 500;
const LOOKUP_TIMEOUT_MS = 3000;
const LOOKUP_TRIES = 2;
/** The name has no record of this type, or does not exist at all: an empty answer, no failure. */
const EMPTY_ANSWER_CODES = new Set(['ENODATA', 'ENOTFOUND']);

const cache = new Map<string, { expires: number; result: WebsiteDnsResult }>();

/** One address in the form resolvers answer with (lower case, IPv6 compressed). */
export function normalizeIp(ip: string): string {
  const value = ip.trim().toLowerCase();
  if (!value.includes(':')) return value;
  try {
    return new URL(`http://[${value}]/`).hostname.slice(1, -1);
  } catch {
    return value;
  }
}

/** DNS_CHECK_RESOLVERS ("1.1.1.1,9.9.9.9") as a list. */
export function dnsCheckServers(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function family(lookup: Promise<string[]>): Promise<{ addresses: string[]; error: string | null }> {
  try {
    return { addresses: await lookup, error: null };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'ERROR';
    return { addresses: [], error: EMPTY_ANSWER_CODES.has(code) ? null : code };
  }
}

/** Asks `servers` (never the system resolver, which may know internal names) for A and AAAA. */
export function publicDnsLookup(
  servers: readonly string[],
  options: { timeout?: number; tries?: number } = {},
): DnsLookup {
  return async (name) => {
    const resolver = new Resolver({
      timeout: options.timeout ?? LOOKUP_TIMEOUT_MS,
      tries: options.tries ?? LOOKUP_TRIES,
    });
    try {
      resolver.setServers([...servers]);
    } catch {
      return { a: [], aaaa: [], error: 'EBADRESOLVERS' };
    }
    const [a, aaaa] = await Promise.all([family(resolver.resolve4(name)), family(resolver.resolve6(name))]);
    return { a: a.addresses, aaaa: aaaa.addresses, error: a.error ?? aaaa.error };
  };
}

/** The demo simulates public DNS (websiteDnsOverride); everything else asks the configured resolvers. */
export function websiteDnsLookup(env: Pick<Env, 'DNS_CHECK_RESOLVERS'>, adapter: ProviderAdapter): DnsLookup {
  const lookup = publicDnsLookup(dnsCheckServers(env.DNS_CHECK_RESOLVERS));
  if (typeof adapter.websiteDnsOverride !== 'function') return lookup;
  return async (name) => {
    const answer = adapter.websiteDnsOverride!(name);
    return answer ? { a: answer.a, aaaa: answer.aaaa, error: null } : lookup(name);
  };
}

/**
 * ok: at least one address and all of them the server's; elsewhere: an address that is not
 * the server's (a CDN, the old host); error: the lookup failed; missing: no address at all.
 */
export function dnsNameStatus(answer: DnsAnswer, expected: ReadonlySet<string>): WebsiteDnsStatus {
  const addresses = [...answer.a, ...answer.aaaa].map(normalizeIp);
  if (addresses.some((ip) => !expected.has(ip))) return 'elsewhere';
  if (answer.error) return 'error';
  return addresses.length > 0 ? 'ok' : 'missing';
}

/** Looks up the domain and its www counterpart; ready when both point to the server only. */
export async function checkWebsiteDns(
  domain: string,
  expected: { ipv4: string[]; ipv6: string[] },
  lookup: DnsLookup,
  now: Date = new Date(),
): Promise<WebsiteDnsResult> {
  const allowed = new Set([...expected.ipv4, ...expected.ipv6].map(normalizeIp));
  const names = await Promise.all(
    [domain, wwwCounterpart(domain)].map(async (name): Promise<WebsiteDnsName> => {
      const answer = await lookup(name);
      return { name, a: answer.a, aaaa: answer.aaaa, status: dnsNameStatus(answer, allowed) };
    }),
  );
  return {
    expected: { ipv4: [...expected.ipv4], ipv6: [...expected.ipv6] },
    names,
    ready: names.every((n) => n.status === 'ok'),
    checkedAt: now.toISOString(),
  };
}

/**
 * The DNS check of a website: expected addresses from the server options (cached by the
 * adapter), answers from public DNS. Cached DNS_CHECK_CACHE_MS per website unless `fresh`.
 */
export async function websiteDnsCheck(
  env: Pick<Env, 'DNS_CHECK_RESOLVERS'>,
  website: { id: string; domain: string; adapter: ProviderAdapter },
  options: { fresh?: boolean; lookup?: DnsLookup; now?: number } = {},
): Promise<WebsiteDnsResult> {
  const now = options.now ?? Date.now();
  const key = `${website.id}:${website.domain}`;
  const cached = cache.get(key);
  if (!options.fresh && cached && cached.expires > now) return cached.result;
  const { adapter } = website;
  if (typeof adapter.websiteServerOptions !== 'function') {
    throw unsupported('This provider does not support websites');
  }
  const server = await adapter.websiteServerOptions();
  const result = await checkWebsiteDns(
    website.domain,
    { ipv4: server.ipv4, ipv6: server.ipv6 },
    options.lookup ?? websiteDnsLookup(env, adapter),
    new Date(now),
  );
  for (const [k, entry] of cache) {
    if (entry.expires <= now || cache.size >= DNS_CHECK_CACHE_MAX) cache.delete(k);
    else break;
  }
  cache.delete(key);
  cache.set(key, { expires: now + DNS_CHECK_CACHE_MS, result });
  return result;
}

/** Forgets cached checks (tests, and a website that was deleted). */
export function forgetWebsiteDnsCheck(websiteId?: string): void {
  if (!websiteId) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) if (key.startsWith(`${websiteId}:`)) cache.delete(key);
}

/**
 * The domain (or its www counterpart) in the DNS module, if the caller may read it: the website
 * page links to its records. The exact name wins over the counterpart.
 */
export async function panelDomainFor(
  ctx: AppContext,
  req: FastifyRequest,
  domain: string,
): Promise<{ id: string; name: string } | null> {
  const counterpart = wwwCounterpart(domain);
  const candidates = [domain, counterpart];
  const names = [...new Set(candidates.flatMap((n) => [n, (domainToUnicode(n) || n).toLowerCase()]))];
  const rows = await ctx.db
    .select({ id: domains.id, name: domains.name, orgId: domains.orgId })
    .from(domains)
    .where(and(inArray(sql`lower(${domains.name})`, names), isNull(domains.missingSince)));
  const rank = (name: string) => {
    const lower = name.toLowerCase();
    return lower === domain || lower === domainToUnicode(domain) ? 0 : 1;
  };
  for (const row of rows.sort((a, b) => rank(a.name) - rank(b.name))) {
    if (await ctx.access.can(req, 'domain:read', domainScope(row))) return { id: row.id, name: row.name };
  }
  return null;
}
