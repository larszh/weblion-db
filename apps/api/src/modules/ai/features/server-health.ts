import { z } from 'zod';
import { AI_HEALTH_METRICS, type AiServerHealthResult, type MetricsResult } from '@weblion/shared';
import { notFound } from '../../../lib/errors';
import { thirdParty } from '../prompts';
import type { ConsoleReader } from '../reader';
import { compressMetrics, slim } from '../tools/types';
import { callFeature, userTurn, type FeatureRun } from './common';

/**
 * Assessment of one server (ai 10.4) from its metrics, monitoring, traffic and newest actions, read through the
 * person's own routes (server:metrics, server:task:read). The live reads count against the organization's 30 per
 * minute; metric series are compressed to keep the input small.
 */

export const serverHealthOutput = z.object({
  overall: z.enum(['ok', 'watch', 'problem']),
  summary: z.string(),
  metrics: z.array(
    z.object({
      metric: z.enum(AI_HEALTH_METRICS),
      status: z.enum(['ok', 'watch', 'problem']),
      finding: z.string(),
    }),
  ),
  recommendations: z.array(z.string()),
});

export async function runServerHealth(
  run: FeatureRun,
  reader: ConsoleReader,
  input: { serverId: string; range: 'day' | 'week' },
): Promise<AiServerHealthResult> {
  const server = await reader.owned('server', input.serverId);
  if (!server.ok) throw notFound('Server');
  const [metrics, monitoring, traffic, tasks] = await Promise.all([
    reader.sub<MetricsResult>('server', input.serverId, 'metrics', { range: input.range }),
    reader.sub('server', input.serverId, 'monitoring'),
    reader.sub('server', input.serverId, 'traffic'),
    reader.sub<{ actions?: unknown[] }>('server', input.serverId, 'tasks'),
  ]);
  // A person without server:metrics reads none of it: the same refusal as the graphs tab.
  if (!metrics.ok && metrics.error === 'forbidden') throw notFound('Server metrics');
  const body = server.body as { name?: string; status?: string; specs?: unknown; usage?: unknown };
  const payload = {
    server: {
      name: body.name ?? null,
      status: body.status ?? null,
      specs: body.specs ?? null,
      usage: body.usage ?? null,
    },
    range: input.range,
    metrics: metrics.ok ? compressMetrics(metrics.body) : { error: metrics.error },
    monitoring: monitoring.ok ? slim(monitoring.body) : { error: monitoring.error },
    traffic: traffic.ok ? slim(traffic.body) : { error: traffic.error },
    recentActions: tasks.ok ? (tasks.body.actions ?? []).slice(0, 20) : { error: tasks.error },
  };
  const user = userTurn(
    run,
    null,
    'Assess the health of this server.',
    thirdParty('server_data', payload, { personal: true }),
  );
  const { data, meta } = await callFeature(run, 'server_health', user, serverHealthOutput);
  return {
    overall: data.overall,
    summary: data.summary,
    metrics: data.metrics.slice(0, AI_HEALTH_METRICS.length),
    recommendations: data.recommendations.slice(0, 5),
    meta,
  };
}
