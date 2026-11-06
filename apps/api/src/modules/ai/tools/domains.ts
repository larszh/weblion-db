import { z } from 'zod';
import { consolePath, listOf, readFailure, slim, titleOf, tool } from './types';

/** Domain and DNS tools (ai 8.2, 5 to 7). */

export const listDomains = tool({
  name: 'list_domains',
  description: 'Domains and DNS zones of the organization with status, expiry and provider.',
  input: z.object({}),
  live: false,
  personal: false,
  routes: ['/orgs/:orgId/domains'],
  async run(_input, { reader, org }) {
    const res = await reader.orgGet('domains');
    if (!res.ok) return readFailure(res);
    return { result: listOf(res.body), sources: [{ path: consolePath(org, 'domains'), title: null }] };
  },
});

const domainId = z.object({ domain_id: z.uuid() });

export const getDomain = tool({
  name: 'get_domain',
  description: 'One domain with registrar status, expiry, name servers and linked zone.',
  input: domainId,
  live: true,
  personal: false,
  routes: ['/domains/:id'],
  async run(input, { reader, org }) {
    const res = await reader.owned('domain', input.domain_id);
    if (!res.ok) return readFailure(res);
    return {
      result: slim(res.body),
      sources: [{ path: consolePath(org, 'domains', input.domain_id), title: titleOf(res.body) }],
    };
  },
});

export const getDnsRecords = tool({
  name: 'get_dns_records',
  description: 'All DNS records of one zone as the provider serves them.',
  input: domainId,
  live: true,
  personal: false,
  routes: ['/domains/:id', '/domains/:id/dns'],
  async run(input, { reader, org }) {
    const domain = await reader.owned('domain', input.domain_id);
    if (!domain.ok) return readFailure(domain);
    const records = await reader.sub('domain', input.domain_id, 'dns');
    if (!records.ok) return readFailure(records);
    return {
      result: { zone: titleOf(domain.body), records: listOf(records.body, 200) },
      sources: [
        { path: `${consolePath(org, 'domains', input.domain_id)}?tab=dns`, title: titleOf(domain.body) },
      ],
    };
  },
});
