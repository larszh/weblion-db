import { describe, expect, it } from 'vitest';
import {
  AI_DEFAULT_MODEL,
  AI_ERROR_CODES,
  AI_FEATURE_EFFORT,
  AI_FEATURES,
  AI_LIMIT_KINDS,
  AI_MODELS,
  AI_TOOL_NAMES,
  AI_UPSTREAM_REASONS,
  aiCostMicros,
  aiDenyStatements,
  hasRefusalFallback,
  isAiFeature,
  isAiModel,
} from './ai';

const MILLION = 1_000_000;

describe('ai vocabulary (ai 3.1)', () => {
  it('1: knows exactly the three models, Opus by default', () => {
    expect(AI_MODELS).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
    expect(AI_DEFAULT_MODEL).toBe('claude-opus-5-5');
    for (const model of AI_MODELS) {
      expect(isAiModel(model)).toBe(true);
      expect(isAiModel(`${model}-20261001`)).toBe(false);
    }
    expect(isAiModel('')).toBe(false);
    expect(isAiModel('opus')).toBe(false);
    expect(isAiModel('unknown-model')).toBe(false);
  });

  it('2: has a refusal fallback on Opus and Sonnet only', () => {
    expect(hasRefusalFallback('claude-opus-5-5')).toBe(true);
    expect(hasRefusalFallback('claude-sonnet-5-5')).toBe(true);
    expect(hasRefusalFallback('claude-haiku-5-5')).toBe(false);
  });

  it('3: has seven features with a fixed effort each', () => {
    expect(AI_FEATURES).toHaveLength(7);
    expect(isAiFeature('translations')).toBe(true);
    expect(isAiFeature('customer_summary')).toBe(false);
    const medium = AI_FEATURES.filter((f) => AI_FEATURE_EFFORT[f] === 'medium');
    expect(medium).toEqual(['assistant', 'dns_check', 'server_health', 'translations']);
    expect(AI_FEATURES.filter((f) => AI_FEATURE_EFFORT[f] === 'low')).toEqual([
      'explain',
      'audit_summary',
      'product_texts',
    ]);
  });

  it('4: prices one million tokens of each kind per model', () => {
    const cost = (model: (typeof AI_MODELS)[number], kind: string) =>
      aiCostMicros(
        model,
        {
          input_tokens: kind === 'input' ? MILLION : 0,
          output_tokens: kind === 'output' ? MILLION : 0,
          cache_creation_input_tokens: kind === 'cacheWrite' ? MILLION : 0,
          cache_read_input_tokens: kind === 'cacheRead' ? MILLION : 0,
        },
        AI_DEFAULT_MODEL,
      );
    const kinds = ['input', 'output', 'cacheWrite', 'cacheRead'];
    expect(kinds.map((k) => cost('claude-opus-5-5', k))).toEqual([4_000_000, 20_000_000, 5_000_000, 200_000]);
    expect(kinds.map((k) => cost('claude-sonnet-5-5', k))).toEqual([
      2_000_000, 10_000_000, 2_500_000, 200_000,
    ]);
    // Haiku's long-context rate starts above 100,000 tokens, so price the four kinds below it and scale up.
    const haiku = (counts: Partial<Record<string, number>>) =>
      aiCostMicros(
        'claude-haiku-5-5',
        {
          input_tokens: counts.input ?? 0,
          output_tokens: counts.output ?? 0,
          cache_creation_input_tokens: counts.cacheWrite ?? 0,
          cache_read_input_tokens: counts.cacheRead ?? 0,
        },
        AI_DEFAULT_MODEL,
      );
    expect(haiku({ output: MILLION })).toBe(500_000);
    expect(haiku({ input: 100_000 }) * 10).toBe(100_000);
    expect(haiku({ cacheWrite: 80_000 }) * 12.5).toBe(125_000);
    expect(haiku({ cacheRead: 100_000 }) * 10).toBe(10_000);
  });

  it('5: prices a long Haiku call entirely at the long-context rate', () => {
    expect(
      aiCostMicros('claude-haiku-5-5', { input_tokens: 150_000, output_tokens: 0 }, AI_DEFAULT_MODEL),
    ).toBe(75_000);
    expect(
      aiCostMicros('claude-haiku-5-5', { input_tokens: 100_000, output_tokens: 0 }, AI_DEFAULT_MODEL),
    ).toBe(10_000);
    // Input plus cache tokens decide.
    expect(
      aiCostMicros(
        'claude-haiku-5-5',
        { input_tokens: 60_000, output_tokens: 0, cache_read_input_tokens: 60_000 },
        AI_DEFAULT_MODEL,
      ),
    ).toBe(30_000 + 3_000);
  });

  it('6: rounds up once per call', () => {
    expect(aiCostMicros('claude-haiku-5-5', { input_tokens: 0, output_tokens: 1 }, AI_DEFAULT_MODEL)).toBe(1);
    expect(aiCostMicros('claude-haiku-5-5', { input_tokens: 0, output_tokens: 0 }, AI_DEFAULT_MODEL)).toBe(0);
    // Two halves make one, not two.
    expect(
      aiCostMicros(
        'claude-haiku-5-5',
        {
          input_tokens: 0,
          output_tokens: 0,
          iterations: [
            { type: 'message', input_tokens: 0, output_tokens: 1 },
            { type: 'message', input_tokens: 0, output_tokens: 1 },
          ],
        },
        AI_DEFAULT_MODEL,
      ),
    ).toBe(1);
  });

  it('7: prices an unlisted model at the fallback model times 1.25', () => {
    expect(aiCostMicros('x-unlisted', { input_tokens: MILLION, output_tokens: 0 }, 'claude-opus-5-5')).toBe(
      5_000_000,
    );
  });

  it('8: prices each iteration on its own and ignores the top-level counts', () => {
    const usage = {
      input_tokens: 999_999,
      output_tokens: 999_999,
      iterations: [
        { type: 'message', model: null, input_tokens: 1000, output_tokens: 0 },
        { type: 'fallback_message', model: 'x-unlisted', input_tokens: 1000, output_tokens: 500 },
        { type: 'compaction', model: null, input_tokens: 50_000, output_tokens: 50_000 },
      ],
    };
    expect(aiCostMicros('claude-opus-5-5', usage, 'claude-opus-5-5')).toBe(4_000 + 5_000 + 12_500);
  });

  it('9: denies only ai:use while switched off or declined', () => {
    expect(aiDenyStatements({ aiEnabled: true, aiOptOutAt: null })).toEqual([]);
    for (const org of [
      { aiEnabled: false, aiOptOutAt: null },
      { aiEnabled: true, aiOptOutAt: new Date() },
      { aiEnabled: false, aiOptOutAt: '2026-11-01T00:00:00.000Z' },
    ]) {
      const statements = aiDenyStatements(org);
      expect(statements).toEqual([{ sid: 'AiNotAllowed', effect: 'deny', actions: ['ai:use'] }]);
      expect(JSON.stringify(statements)).not.toContain('ai:settings');
    }
  });

  it('10: has 22 unique tools, the DNS proposal last', () => {
    expect(AI_TOOL_NAMES).toHaveLength(22);
    expect(new Set(AI_TOOL_NAMES).size).toBe(22);
    expect(AI_TOOL_NAMES[AI_TOOL_NAMES.length - 1]).toBe('propose_dns_record');
    expect(AI_TOOL_NAMES as readonly string[]).not.toContain('propose_monitor');
  });

  it('lists the frozen error vocabulary (plan 2.10)', () => {
    expect(AI_ERROR_CODES).toHaveLength(12);
    expect(new Set(AI_ERROR_CODES).size).toBe(12);
    expect(AI_ERROR_CODES.every((c) => c.startsWith('ai_'))).toBe(true);
    expect(AI_LIMIT_KINDS).toEqual([
      'budget',
      'org_daily',
      'user_daily',
      'user_rate',
      'user_concurrent',
      'org_concurrent',
      'concurrent',
    ]);
    expect(AI_UPSTREAM_REASONS).toHaveLength(8);
  });
});
