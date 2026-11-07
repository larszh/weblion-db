import { z } from 'zod';
import type { OrgSubPath } from '../reader';
import { consolePath, listOf, readFailure, slim, tool, type AiTool } from './types';

/** Cloud storage, phone and streaming (ai 8.2, 16 to 18): overview routes of the organization. */

function overview(sub: OrgSubPath, page: string) {
  return async (_input: unknown, { reader, org }: Parameters<AiTool['run']>[1]) => {
    const res = await reader.orgGet(sub);
    if (!res.ok) return readFailure(res);
    const body = res.body;
    const result = Array.isArray(body)
      ? listOf(body)
      : Object.fromEntries(
          Object.entries((body as Record<string, unknown>) ?? {}).map(([k, v]) => [
            k,
            Array.isArray(v) ? listOf(v) : slim(v),
          ]),
        );
    return { result, sources: [{ path: consolePath(org, page), title: null }] };
  };
}

export const getCloudStorage = tool({
  name: 'get_cloud_storage',
  description: 'Cloud storage accounts of the organization and its allowance.',
  input: z.object({}),
  live: false,
  personal: true,
  routes: ['/orgs/:orgId/cloud'],
  run: overview('cloud', 'cloud'),
});

export const getPhoneSystems = tool({
  name: 'get_phone_systems',
  description: 'Phone systems of the organization with users and trunks.',
  input: z.object({}),
  live: false,
  personal: false,
  routes: ['/orgs/:orgId/phone-systems'],
  run: overview('phone-systems', 'phone'),
});

export const getStreaming = tool({
  name: 'get_streaming',
  description: 'Streaming accounts of the organization and its allowance.',
  input: z.object({}),
  live: true,
  personal: true,
  routes: ['/orgs/:orgId/media'],
  run: overview('media', 'media'),
});
