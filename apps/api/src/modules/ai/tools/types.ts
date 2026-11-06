import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { AiDnsProposalDto, AiPageRef, AiToolName, MetricsResult } from '@weblion/shared';
import type { AppContext } from '../../../context';
import type { Organization } from '../../../db/schema';
import type { ConsoleReader, ReadError, ReadResult } from '../reader';

/**
 * The shape of the assistant's read-only tools (ai 8.2 to 8.4) and the helpers they share: projection to the
 * fields the model needs, list cuts, console paths for the "sources" of an answer.
 */

export interface ToolContext {
  ctx: AppContext;
  req: FastifyRequest;
  /** The organization of the chat; the reader only reads this organization's data. */
  org: Pick<Organization, 'id' | 'slug' | 'name' | 'kind'>;
  reader: ConsoleReader;
}

export interface ToolOutput {
  result: unknown;
  /** Console paths of what the tool read, shown as "Quellen" under the answer. */
  sources: AiPageRef[];
  /** propose_dns_record only: the proposal sent to the browser. */
  proposal?: AiDnsProposalDto;
  /** The tool could not read what was asked (not_found, forbidden, ...); the model gets an is_error result. */
  isError?: boolean;
}

export interface AiTool<I = any> {
  name: AiToolName;
  description: string;
  input: z.ZodType<I>;
  /** Calls a provider: counts against 8 live calls per turn and 30 per organization and minute. */
  live: boolean;
  /** The result passes redactForAi(..., { personal: true }) (plan O28). */
  personal: boolean;
  /** The GET route templates it reads (checked against the app by tools.test.ts). */
  routes: string[];
  run(input: I, ctx: ToolContext): Promise<ToolOutput>;
}

/** Defines a tool with its input type inferred from the schema. */
export function tool<S extends z.ZodType>(def: AiTool<z.infer<S>> & { input: S }): AiTool<z.infer<S>> {
  return def;
}

export const LIST_MAX = 50;

/** UI-only fields that cost tokens and tell the model nothing about the question. */
const DROP_KEYS = new Set(['permissions', 'capabilities', 'powerActions', 'panelUrl', 'externalId']);

/** The body without UI-only arrays, at every depth. */
export function slim(value: unknown, depth = 0): unknown {
  if (depth > 12 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => slim(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!DROP_KEYS.has(key)) out[key] = slim(item, depth + 1);
  }
  return out;
}

/** A list cut to 50 items (ai 8.2), slimmed. */
export function listOf(
  items: unknown,
  max = LIST_MAX,
): { items: unknown[]; truncated: boolean; total: number } {
  const list = Array.isArray(items)
    ? items
    : Array.isArray((items as { items?: unknown })?.items)
      ? ((items as { items: unknown[] }).items as unknown[])
      : [];
  return { items: list.slice(0, max).map((i) => slim(i)), truncated: list.length > max, total: list.length };
}

/** The model's answer for a read that failed: the reason only (never another organization's data). */
export function readFailure(result: { ok: false; error: ReadError; message?: string }): ToolOutput {
  return {
    result: { error: result.error, ...(result.message ? { message: result.message } : {}) },
    sources: [],
    isError: true,
  };
}

/** A console path inside the organization, e.g. consolePath(org, 'servers', id). */
export function consolePath(org: Pick<Organization, 'slug'>, ...parts: string[]): string {
  return `/o/${org.slug}${parts.length ? `/${parts.join('/')}` : ''}`;
}

/** The display name of a body (name, else null). */
export function titleOf(body: unknown): string | null {
  const name = (body as { name?: unknown } | null)?.name;
  return typeof name === 'string' ? name : null;
}

/** Unwraps a successful read, or returns the failure for the model. */
export function okOr<T>(result: ReadResult<T>): result is { ok: true; body: T; path: string } {
  return result.ok;
}

/** Min, average, max, last value and 24 evenly spaced points per metric series (ai 10.4). */
export function compressMetrics(metrics: MetricsResult | null | undefined): unknown {
  if (!metrics || !Array.isArray(metrics.points)) return null;
  const points = metrics.points;
  const series: Record<string, unknown> = {};
  for (const s of metrics.series ?? []) {
    const values = points
      .map((p) => ({ t: p.t, v: (p as unknown as Record<string, number | null | undefined>)[s.key] }))
      .filter((p): p is { t: number; v: number } => typeof p.v === 'number' && Number.isFinite(p.v));
    if (values.length === 0) continue;
    const nums = values.map((p) => p.v);
    const round = (n: number) => Math.round(n * 100) / 100;
    const step = Math.max(1, Math.ceil(values.length / 24));
    series[s.key] = {
      unit: s.unit,
      min: round(Math.min(...nums)),
      avg: round(nums.reduce((a, b) => a + b, 0) / nums.length),
      max: round(Math.max(...nums)),
      last: round(nums.at(-1)!),
      points: values.filter((_, i) => i % step === 0).map((p) => [p.t, round(p.v)]),
    };
  }
  return { range: metrics.range, resolutionSeconds: metrics.resolutionSeconds ?? null, series };
}
