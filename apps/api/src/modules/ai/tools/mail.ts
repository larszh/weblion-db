import { z } from 'zod';
import { consolePath, listOf, readFailure, slim, titleOf, tool } from './types';

/** E-mail tools (ai 8.2, 11 to 13). */

export const listMailDomains = tool({
  name: 'list_mail_domains',
  description: 'E-mail domains of the organization with status, limits and usage.',
  input: z.object({}),
  live: false,
  personal: false,
  routes: ['/orgs/:orgId/mail/domains'],
  async run(_input, { reader, org }) {
    const res = await reader.orgGet('mail/domains');
    if (!res.ok) return readFailure(res);
    return { result: listOf(res.body), sources: [{ path: consolePath(org, 'mail'), title: null }] };
  },
});

const mailDomainId = z.object({ mail_domain_id: z.uuid() });

export const getMailDomain = tool({
  name: 'get_mail_domain',
  description: 'One e-mail domain with limits, usage and status.',
  input: mailDomainId,
  live: true,
  // Mailbox and contact addresses are replaced by [email] (plan O28).
  personal: true,
  routes: ['/mail/domains/:id'],
  async run(input, { reader, org }) {
    const res = await reader.owned('mail_domain', input.mail_domain_id);
    if (!res.ok) return readFailure(res);
    return {
      result: slim(res.body),
      sources: [{ path: consolePath(org, 'mail', input.mail_domain_id), title: titleOf(res.body) }],
    };
  },
});

export const getMailDnsSetup = tool({
  name: 'get_mail_dns_setup',
  description:
    'The DNS records the console computed for one e-mail domain (MX, SPF, DKIM, DMARC, autoconfig) with the status of each in the zone.',
  input: mailDomainId,
  live: true,
  personal: false,
  routes: ['/mail/domains/:id', '/mail/domains/:id/dns'],
  async run(input, { reader, org }) {
    const domain = await reader.owned('mail_domain', input.mail_domain_id);
    if (!domain.ok) return readFailure(domain);
    const setup = await reader.sub('mail_domain', input.mail_domain_id, 'dns');
    if (!setup.ok) return readFailure(setup);
    return {
      result: slim(setup.body),
      sources: [
        { path: `${consolePath(org, 'mail', input.mail_domain_id)}?tab=dns`, title: titleOf(domain.body) },
      ],
    };
  },
});
