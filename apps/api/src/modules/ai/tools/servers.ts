import { z } from 'zod';
import type { MetricsResult } from '@weblion/shared';
import { compressMetrics, consolePath, listOf, readFailure, slim, titleOf, tool } from './types';

/** Server tools (ai 8.2, 1 to 4). */

export const listServers = tool({
  name: 'list_servers',
  description:
    "List the organization's servers with status, plan, location and labels. Filter by name, status or label.",
  input: z.object({
    q: z.string().max(100).nullable(),
    status: z.string().max(20).nullable(),
    label: z.string().max(130).nullable(),
  }),
  live: false,
  personal: false,
  routes: ['/orgs/:orgId/servers'],
  async run(input, { reader, org }) {
    const query: Record<string, string> = {};
    if (input.q) query.q = input.q;
    if (input.status) query.status = input.status;
    if (input.label) query.label = input.label;
    const res = await reader.orgGet('servers', query);
    if (!res.ok) return readFailure(res);
    return { result: listOf(res.body), sources: [{ path: consolePath(org, 'servers'), title: null }] };
  },
});

const serverId = z.object({ server_id: z.uuid() });

export const getServer = tool({
  name: 'get_server',
  description: 'Stored details of one server: status, plan, IP addresses, image, protection, project.',
  input: serverId,
  live: false,
  personal: false,
  routes: ['/servers/:id'],
  async run(input, { reader, org }) {
    const res = await reader.owned('server', input.server_id);
    if (!res.ok) return readFailure(res);
    return {
      result: slim(res.body),
      sources: [{ path: consolePath(org, 'servers', input.server_id), title: titleOf(res.body) }],
    };
  },
});

export const getServerMetrics = tool({
  name: 'get_server_metrics',
  description:
    'Live CPU, memory, disk and network metrics of one server for a range, plus its monitoring summary.',
  input: z.object({ server_id: z.uuid(), range: z.enum(['hour', 'day', 'week', 'month']) }),
  live: true,
  personal: false,
  routes: ['/servers/:id', '/servers/:id/metrics', '/servers/:id/monitoring'],
  async run(input, { reader, org }) {
    const server = await reader.owned('server', input.server_id);
    if (!server.ok) return readFailure(server);
    const [metrics, monitoring] = await Promise.all([
      reader.sub<MetricsResult>('server', input.server_id, 'metrics', { range: input.range }),
      reader.sub('server', input.server_id, 'monitoring'),
    ]);
    return {
      result: {
        server: { name: titleOf(server.body), status: (server.body as { status?: unknown }).status ?? null },
        metrics: metrics.ok ? compressMetrics(metrics.body) : { error: metrics.error },
        monitoring: monitoring.ok ? slim(monitoring.body) : { error: monitoring.error },
      },
      sources: [
        { path: consolePath(org, 'servers', input.server_id, 'graphs'), title: titleOf(server.body) },
      ],
    };
  },
});

export const getServerActivity = tool({
  name: 'get_server_activity',
  description:
    'Recent actions on one server (start, stop, backups, rebuilds) with their results, and its audit entries.',
  input: serverId,
  live: false,
  personal: true,
  routes: ['/servers/:id', '/servers/:id/tasks', '/servers/:id/activity'],
  async run(input, { reader, org }) {
    const server = await reader.owned('server', input.server_id);
    if (!server.ok) return readFailure(server);
    const [tasks, activity] = await Promise.all([
      reader.sub<{ actions?: unknown[] }>('server', input.server_id, 'tasks'),
      reader.sub('server', input.server_id, 'activity', { page: '1', perPage: '50' }),
    ]);
    return {
      result: {
        server: titleOf(server.body),
        actions: tasks.ok ? listOf(tasks.body.actions ?? []) : { error: tasks.error },
        audit: activity.ok ? listOf(activity.body) : { error: activity.error },
      },
      sources: [
        { path: consolePath(org, 'servers', input.server_id, 'activity'), title: titleOf(server.body) },
      ],
    };
  },
});
