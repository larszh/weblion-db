import { z } from 'zod';
import { MONITOR_HISTORY_RANGES } from '@weblion/shared';
import { consolePath, listOf, readFailure, slim, titleOf, tool } from './types';

/** Monitoring tools (ai 8.2, 14 and 15). */

export const getMonitoring = tool({
  name: 'get_monitoring',
  description: 'Monitors and status pages of the organization with their current state.',
  input: z.object({}),
  live: false,
  personal: false,
  routes: ['/orgs/:orgId/monitoring'],
  async run(_input, { reader, org }) {
    const res = await reader.orgGet('monitoring');
    if (!res.ok) return readFailure(res);
    const body = res.body as Record<string, unknown> | unknown[];
    // The overview is an object with lists (monitors, status pages); cut every list.
    const result = Array.isArray(body)
      ? listOf(body)
      : Object.fromEntries(
          Object.entries(body ?? {}).map(([key, value]) => [
            key,
            Array.isArray(value) ? listOf(value) : slim(value),
          ]),
        );
    return { result, sources: [{ path: consolePath(org, 'monitoring'), title: null }] };
  },
});

export const getMonitor = tool({
  name: 'get_monitor',
  description: 'One monitor with its live state and history.',
  input: z.object({ monitor_id: z.uuid(), range: z.enum(MONITOR_HISTORY_RANGES) }),
  live: true,
  personal: false,
  routes: ['/monitors/:id', '/monitors/:id/history'],
  async run(input, { reader, org }) {
    const monitor = await reader.owned('monitor', input.monitor_id);
    if (!monitor.ok) return readFailure(monitor);
    const history = await reader.sub('monitor', input.monitor_id, 'history', { range: input.range });
    return {
      result: {
        monitor: slim(monitor.body),
        history: history.ok ? slim(history.body) : { error: history.error },
      },
      sources: [{ path: consolePath(org, 'monitoring', input.monitor_id), title: titleOf(monitor.body) }],
    };
  },
});
