import { z } from 'zod';
import { loadDnsContext, proposalInput, validateDnsProposal, type DnsContext } from '../features/dns-check';
import { consolePath, tool } from './types';

/**
 * propose_dns_record (ai 8.4): the only tool that is not a plain read. It reads the zone, validates the record
 * with the console's own rules and returns a proposal; nothing is saved. The browser shows it as a card and opens
 * the normal DNS form pre-filled on request, where the person saves it with the normal permission check.
 */

export const proposeDnsRecord = tool({
  name: 'propose_dns_record',
  description:
    'Propose one DNS record to add or change in a zone of the organization. The console validates it and shows it to the person, who decides in the normal DNS form; nothing is saved by this tool. Deleting records and NS records cannot be proposed.',
  input: proposalInput.extend({ domain_id: z.uuid() }),
  live: true,
  personal: false,
  routes: [
    '/domains/:id',
    '/domains/:id/dns',
    '/orgs/:orgId/mail/domains',
    '/mail/domains/:id',
    '/mail/domains/:id/dns',
    '/orgs/:orgId/webspaces',
    '/webspaces/:id',
    '/webspaces/:id/dns-check',
  ],
  async run(input, { reader, org }) {
    let dns: DnsContext;
    try {
      dns = await loadDnsContext(reader, { domainId: input.domain_id });
    } catch {
      return { result: { error: 'not_found' }, sources: [], isError: true };
    }
    const { domain_id: _domainId, ...proposal } = input;
    const check = validateDnsProposal(dns, proposal);
    if (!check.ok) return { result: { error: 'invalid', issue: check.issue }, sources: [], isError: true };
    return {
      result: {
        proposal_id: check.proposal.id,
        verified: check.proposal.verified,
        text_only: check.proposal.textOnly,
      },
      sources: [{ path: `${consolePath(org, 'domains', input.domain_id)}?tab=dns`, title: dns.zone }],
      proposal: check.proposal,
    };
  },
});
