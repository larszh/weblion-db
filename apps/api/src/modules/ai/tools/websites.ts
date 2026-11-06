import { z } from 'zod';
import { consolePath, listOf, readFailure, slim, titleOf, tool } from './types';

/** Website tools (ai 8.2, 8 to 10). */

export const listWebsites = tool({
  name: 'list_websites',
  description: 'Websites and web spaces of the organization with status, runtime and server.',
  input: z.object({}),
  live: false,
  personal: false,
  routes: ['/orgs/:orgId/webspaces'],
  async run(_input, { reader, org }) {
    const res = await reader.orgGet('webspaces');
    if (!res.ok) return readFailure(res);
    return { result: listOf(res.body), sources: [{ path: consolePath(org, 'webhosting'), title: null }] };
  },
});

const websiteId = z.object({ website_id: z.uuid() });

export const getWebsite = tool({
  name: 'get_website',
  description: 'One website with runtime, certificate, databases and status notices.',
  input: websiteId,
  live: true,
  personal: false,
  routes: ['/webspaces/:id'],
  async run(input, { reader, org }) {
    const res = await reader.owned('website', input.website_id);
    if (!res.ok) return readFailure(res);
    return {
      result: slim(res.body),
      sources: [{ path: consolePath(org, 'webhosting', input.website_id), title: titleOf(res.body) }],
    };
  },
});

export const checkWebsiteDns = tool({
  name: 'check_website_dns',
  description:
    "Whether the website's domain and www point to its server (A and AAAA), as the console checks it.",
  input: websiteId,
  live: true,
  personal: false,
  routes: ['/webspaces/:id', '/webspaces/:id/dns-check'],
  async run(input, { reader, org }) {
    const site = await reader.owned('website', input.website_id);
    if (!site.ok) return readFailure(site);
    const check = await reader.sub('website', input.website_id, 'dns-check');
    if (!check.ok) return readFailure(check);
    return {
      result: { website: titleOf(site.body), check: slim(check.body) },
      sources: [{ path: consolePath(org, 'webhosting', input.website_id), title: titleOf(site.body) }],
    };
  },
});
