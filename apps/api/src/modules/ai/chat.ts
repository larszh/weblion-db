import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaMessageStreamParams,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from '@anthropic-ai/sdk/resources/beta/messages';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AiChatMessageInput, AiNoticeKind, Locale } from '@weblion/shared';
import type { AppContext } from '../../context';
import type { Organization } from '../../db/schema';
import { AppError, notFound } from '../../lib/errors';
import { baseParams, systemBlocks } from './client';
import { contextBlock, todayZurich } from './context-block';
import { AiCancelled, aiRefusal, classifyAiError } from './errors';
import type { AiGate } from './gates';
import { SYSTEM_TEXT } from './prompts';
import { ConsoleReader } from './reader';
import { redactForAi, redactSecrets, toolJson, type RedactOptions } from './redact';
import type { AiFinishStatus } from './service';
import { SseWriter } from './sse';
import { toolByName, toolDefinitions } from './tools/registry';
import type { ToolContext, ToolOutput } from './tools/types';
import * as usage from './usage';

/**
 * The chat turn (ai 6.4, 9): a manual streaming loop, not the SDK's tool runner, because the module must account
 * the budget after every call, enforce the per-turn caps, and never run or re-send tool calls that came before a
 * mid-answer refusal fallback. Within a turn the history is append-only (assistant content echoed unchanged
 * apart from the fallback rule, tool results appended), so the moving cache breakpoint is read by the next call
 * and the thinking blocks of the turn stay valid.
 */

export const CHAT_LIMITS = {
  apiCalls: 8, // per turn
  toolCalls: 24, // per turn
  liveCalls: 8, // per turn, tools with live: true
  toolResultChars: 120_000, // per turn, sum of tool_result texts
  toolResultMaxChars: 20_000, // per tool result
  costFactor: 5, // a turn may cost at most 5 x its estimate
  jsonRetries: 1, // re-issues after an unparseable tool input
  parallelTools: 4, // tool calls of one message run at most 4 at a time
} as const;

/**
 * Appended as a text block after the tool results before the last allowed call (ai 6.3, plan O30). tool_choice
 * stays auto on every call: switching it to none would invalidate the messages cache of the turn, and forcing a
 * tool is rejected on these models.
 */
export const FINAL_STEP_NOTE =
  'Note from weblion.one: this is the last step of this answer. Do not call any more tools; tool calls now ' +
  'are not run. Answer with the information you already have and say briefly what you could not check.';

export interface ChatRequestBody {
  messages: AiChatMessageInput[];
  locale: Locale;
}

export interface ChatInput {
  org: Organization;
  gate: AiGate;
  body: ChatRequestBody;
  /** The SSE ping interval (tests); default 15 s. */
  pingMs?: number;
}

/**
 * The request messages (ai 9.2): assistant messages as the plain text the browser showed (no tool or thinking
 * blocks are ever accepted from the browser); every user message with the <context> block of the page it was
 * sent from, so earlier messages stay the same while the person moves around. Only the newest carries today's
 * date.
 */
export function buildMessages(body: ChatRequestBody, gate: Pick<AiGate, 'context'>): BetaMessageParam[] {
  const last = body.messages.length - 1;
  return body.messages.map((m, i): BetaMessageParam => {
    // The person's own words are requests, not third-party data, but known secrets never leave the console.
    if (m.role === 'assistant') return { role: 'assistant', content: redactSecrets(m.text) };
    const block = contextBlock(
      { ...gate.context, language: body.locale },
      m.page ?? null,
      i === last ? todayZurich() : undefined,
    );
    return { role: 'user', content: `${block}\n\n${redactSecrets(m.text)}` };
  });
}

/** Blocks of a message that count: after a server-side fallback only those after the last fallback block. */
function afterLastFallback(content: BetaContentBlock[]): BetaContentBlock[] {
  const last = content.map((b) => b.type).lastIndexOf('fallback');
  return last < 0 ? content : content.slice(last + 1);
}

const KNOWN_BLOCKS = new Set(['text', 'thinking', 'redacted_thinking', 'tool_use', 'fallback']);

/**
 * The assistant content to send back (ai 6.4 step 7, refusal fallback rules): before the last fallback block,
 * thinking, redacted thinking, tool calls and unknown block types are dropped, text blocks are kept; the fallback
 * block and everything after it echo unchanged.
 */
export function echoContent(content: BetaContentBlock[]): BetaContentBlockParam[] {
  const last = content.map((b) => b.type).lastIndexOf('fallback');
  const out = content.filter((block, i) => {
    if (i >= last) return KNOWN_BLOCKS.has(block.type) || i > last;
    return block.type === 'text';
  });
  return out as unknown as BetaContentBlockParam[];
}

/** The JSON text of a tool result, cut to 20,000 characters at an item boundary (ai 6.4 step 9). */
export function resultText(
  value: unknown,
  redaction: RedactOptions,
  max: number = CHAT_LIMITS.toolResultMaxChars,
): string {
  const redacted = redactForAi(value, redaction);
  let text = toolJson(redacted);
  if (text.length <= max) return text;
  // Lists are cut item by item: { items, truncated: true, total } stays valid JSON the model can read.
  const shrink = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.slice(0, Math.max(0, Math.floor(node.length / 2)));
    if (node && typeof node === 'object') {
      const entries = Object.entries(node as Record<string, unknown>);
      const [key, longest] = entries.reduce<[string | null, number]>(
        (best, [k, v]) => {
          const len = toolJson(v).length;
          return len > best[1] ? [k, len] : best;
        },
        [null, 0],
      );
      if (key === null) return node;
      const child = (node as Record<string, unknown>)[key];
      const total = Array.isArray(child) ? child.length : undefined;
      return {
        ...(node as Record<string, unknown>),
        [key]: shrink(child),
        truncated: true,
        ...(total !== undefined && !('total' in (node as object)) ? { total } : {}),
      };
    }
    return typeof node === 'string' ? node.slice(0, Math.floor(node.length / 2)) : node;
  };
  let current: unknown = redacted;
  for (let i = 0; i < 20 && text.length > max; i++) {
    current = shrink(current);
    text = toolJson(current);
  }
  return text.length <= max ? text : toolJson({ truncated: true, text: text.slice(0, max - 100) });
}

const errorResult = (id: string, error: string): BetaToolResultBlockParam => ({
  type: 'tool_result',
  tool_use_id: id,
  is_error: true,
  content: JSON.stringify({ error }),
});

interface TurnState {
  calls: number;
  toolCalls: number;
  liveCalls: number;
  resultChars: number;
  jsonRetries: number;
  finalNoteSent: boolean;
  fallback: boolean;
  status: AiFinishStatus;
  notices: Set<AiNoticeKind>;
}

/** One chat turn as SSE. Every gate ran in the route; reserve() is the first thing here (429 as plain JSON). */
export async function runChatTurn(
  ctx: AppContext,
  req: FastifyRequest,
  reply: FastifyReply,
  input: ChatInput,
): Promise<void> {
  const { org, gate, body } = input;
  const ai = await ctx.ai.client();
  if (!ai) throw notFound('AI feature');
  const { model, demo } = ai;
  const tools = toolDefinitions();
  let messages = buildMessages(body, gate);
  const prefixTokens = usage.approxTokens(SYSTEM_TEXT.assistant + JSON.stringify(tools));
  const estimateOf = (msgs: BetaMessageParam[]) =>
    demo
      ? 0
      : usage.estimateCallMicros(model, 'assistant', prefixTokens + usage.approxTokens(JSON.stringify(msgs)));
  const turnEstimate = estimateOf(messages);
  const row = await ctx.ai.reserve({
    feature: 'assistant',
    scope: gate.scope,
    orgId: org.id,
    userId: gate.userId,
    countsForUser: true,
    model,
    demo,
    estimateMicros: turnEstimate,
  });

  const sse = new SseWriter(req, reply, { pingMs: input.pingMs });
  sse.open();
  sse.send('meta', { model, demo });
  const timeout = AbortSignal.timeout(ctx.env.AI_TURN_TIMEOUT_SECONDS * 1000);
  const signal = AbortSignal.any([sse.signal, timeout]);
  const reader = new ConsoleReader(ctx.ai.attachedApp(), req, org.id, signal);
  const toolCtx: ToolContext = { ctx, req, org, reader };
  const seenSources = new Set<string>();
  const state: TurnState = {
    calls: 0,
    toolCalls: 0,
    liveCalls: 0,
    resultChars: 0,
    jsonRetries: 0,
    finalNoteSent: false,
    fallback: false,
    status: 'ok',
    notices: new Set(),
  };
  const notice = (kind: AiNoticeKind) => {
    if (state.notices.has(kind)) return;
    state.notices.add(kind);
    sse.send('notice', { kind });
  };

  // The text deltas of every API call of the turn go into one answer, and the stream has no boundary between
  // calls. Text written after a tool round starts a new paragraph, or "...Übersicht." and "Sie haben ..."
  // of the next call would run together.
  let textSent = false;
  let paragraphPending = false;

  let failure: { error: AppError; original?: unknown } | null = null;
  try {
    for (;;) {
      if (signal.aborted) throw new Anthropic.APIUserAbortError();
      state.calls++;
      const estimate = estimateOf(messages);
      if (state.calls > 1) await ctx.ai.refreshReservation(row, estimate);
      const params: BetaMessageStreamParams = {
        ...baseParams(model, 'assistant', gate.userId),
        system: systemBlocks(SYSTEM_TEXT.assistant),
        tools,
        tool_choice: { type: 'auto' },
        // A moving breakpoint on the last block of the turn, read by the next call of the same turn.
        cache_control: { type: 'ephemeral' },
        messages,
      };
      const stream = ai.client.beta.messages.stream(params, { signal });
      // A tool_use block whose input has not finished parsing: an error now is an unparseable tool input.
      let openToolBlock = false;
      stream.on('streamEvent', (event) => {
        if (event.type === 'content_block_start') openToolBlock = event.content_block.type === 'tool_use';
        else if (event.type === 'content_block_stop') openToolBlock = false;
      });
      stream.on('text', (delta) => {
        const text = paragraphPending && textSent ? `\n\n${delta}` : delta;
        paragraphPending = false;
        textSent = true;
        sse.send('text', { text });
      });
      let message: BetaMessage;
      try {
        message = await stream.finalMessage();
      } catch (err) {
        // With eager input streaming the SDK rejects when a tool input could not be parsed at all (a plain
        // AnthropicError at the end of that tool block). Only that case is re-issued, once per turn; API errors,
        // aborts and broken streams go to classifyAiError.
        const parseError =
          openToolBlock && err instanceof Anthropic.AnthropicError && !(err instanceof Anthropic.APIError);
        if (parseError && state.jsonRetries < CHAT_LIMITS.jsonRetries && state.calls < CHAT_LIMITS.apiCalls) {
          state.jsonRetries++;
          // The real usage of the failed call is unknown: it is charged as its estimate.
          await usage.chargeEstimate(ctx.db, row, estimate);
          continue;
        }
        throw err;
      }
      await ctx.ai.addCall(row, message, { requestId: stream.request_id ?? null });
      if (message.content.some((b) => b.type === 'fallback') || message.model !== model)
        state.fallback = true;

      // stop_reason first, before reading any content.
      if (message.stop_reason === 'refusal') throw aiRefusal(message.stop_details?.category ?? null);
      if (message.stop_reason === 'max_tokens') {
        // A tool_use in a cut-off message is never run: its input may be truncated and still parse.
        notice('incomplete');
        state.status = 'incomplete';
        break;
      }
      const toolUses = afterLastFallback(message.content).filter(
        (b): b is BetaToolUseBlock => b.type === 'tool_use',
      );
      if (message.stop_reason !== 'tool_use' || toolUses.length === 0) break;

      // The monthly budget is a hard stop, also in the middle of an answer (plan O29, decision 34).
      if (await ctx.ai.budgetExceeded()) {
        notice('budget_stop');
        state.status = 'incomplete';
        break;
      }
      const lastCall = state.calls >= CHAT_LIMITS.apiCalls || state.finalNoteSent;
      if (lastCall || row.costMicros > CHAT_LIMITS.costFactor * turnEstimate) {
        notice('tool_limit');
        state.status = 'incomplete';
        break;
      }

      const results = await runTools(toolUses, toolCtx, state, sse, seenSources);
      paragraphPending = true;
      const content: BetaContentBlockParam[] = [...results];
      const nextIsLast =
        state.calls + 1 >= CHAT_LIMITS.apiCalls ||
        state.toolCalls >= CHAT_LIMITS.toolCalls ||
        state.resultChars >= CHAT_LIMITS.toolResultChars;
      if (nextIsLast) {
        content.push({ type: 'text', text: FINAL_STEP_NOTE });
        state.finalNoteSent = true;
      }
      messages = [
        ...messages,
        { role: 'assistant', content: echoContent(message.content) },
        { role: 'user', content },
      ];
    }
  } catch (err) {
    let classified: AppError | AiCancelled;
    try {
      classified = classifyAiError(err, { timedOut: timeout.aborted });
    } catch {
      req.log.error({ err, usageId: row.id }, 'chat turn failed');
      classified = new AppError(500, 'internal_error', 'Internal server error');
    }
    if (classified instanceof AiCancelled || (sse.closed && !timeout.aborted)) {
      state.status = 'cancelled';
    } else {
      state.status =
        classified.code === 'ai_refusal'
          ? 'refusal'
          : classified.code === 'ai_incomplete'
            ? 'incomplete'
            : 'error';
      failure = { error: classified, original: err };
      const api = err as { status?: unknown; type?: unknown; requestID?: unknown };
      // Never the message: it can carry Anthropic's account state.
      req.log.warn(
        {
          feature: 'assistant',
          usageId: row.id,
          code: classified.code,
          reason: (classified.details as { reason?: unknown } | undefined)?.reason ?? null,
          status: api?.status ?? null,
          type: api?.type ?? null,
          requestId: api?.requestID ?? row.requestId,
        },
        'claude request failed',
      );
    }
  }

  await usage.setToolCounts(ctx.db, row, state.toolCalls, state.liveCalls);
  await ctx.ai.finish(row, state.status, failure ?? undefined);
  if (failure) sse.error(failure.error);
  else if (state.status !== 'cancelled') {
    sse.send('done', { servedModel: row.servedModel ?? model, fallback: state.fallback });
    sse.close();
  } else sse.close();
  // Fastify's "request completed" line does not follow a hijacked reply (ai 9.3).
  req.log.info(
    {
      usageId: row.id,
      status: state.status,
      apiCalls: row.apiCalls,
      toolCalls: state.toolCalls,
      durationMs: row.durationMs,
    },
    'ai chat turn',
  );
  if (row.costMicros > 0) await usage.checkBudgetWarning(ctx);
}

interface PlannedCall {
  block: BetaToolUseBlock;
  /** Set when the call is answered without running the tool. */
  refused?: BetaToolResultBlockParam;
  tool?: NonNullable<ReturnType<typeof toolByName>>;
  input?: unknown;
}

/**
 * Runs the tool calls of one message (ai 6.4 step 9): validated against the tool's zod schema (eager input
 * streaming means the API no longer validates them), counted against the turn's caps and the organization's live
 * reads, up to four at a time; all results go back in one user message in the order of the calls.
 */
async function runTools(
  toolUses: BetaToolUseBlock[],
  toolCtx: ToolContext,
  state: TurnState,
  sse: SseWriter,
  seenSources: Set<string>,
): Promise<BetaToolResultBlockParam[]> {
  const planned: PlannedCall[] = toolUses.map((block) => {
    const tool = toolByName(block.name);
    if (!tool) return { block, refused: errorResult(block.id, 'unknown_tool') };
    const parsed = tool.input.safeParse(block.input);
    if (!parsed.success) {
      return {
        block,
        refused: {
          type: 'tool_result',
          tool_use_id: block.id,
          is_error: true,
          content: JSON.stringify({ INVALID_JSON: JSON.stringify(block.input) }),
        },
      };
    }
    if (state.toolCalls >= CHAT_LIMITS.toolCalls)
      return { block, refused: errorResult(block.id, 'tool_limit') };
    state.toolCalls++;
    if (tool.live) {
      if (state.liveCalls >= CHAT_LIMITS.liveCalls || !toolCtx.ctx.ai.liveReadAllowed(toolCtx.org.id)) {
        return { block, refused: errorResult(block.id, 'live_limit') };
      }
      state.liveCalls++;
    }
    return { block, tool, input: parsed.data };
  });

  const outputs = new Map<string, ToolOutput | 'failed'>();
  const runnable = planned.filter((p) => p.tool);
  for (let i = 0; i < runnable.length; i += CHAT_LIMITS.parallelTools) {
    await Promise.all(
      runnable.slice(i, i + CHAT_LIMITS.parallelTools).map(async (p) => {
        const live = p.tool!.live;
        sse.send('tool', { id: p.block.id, name: p.tool!.name, status: 'running', live });
        try {
          const out = await p.tool!.run(p.input, toolCtx);
          outputs.set(p.block.id, out);
          sse.send('tool', {
            id: p.block.id,
            name: p.tool!.name,
            status: out.isError ? 'error' : 'done',
            live,
          });
          for (const source of out.sources) {
            if (seenSources.has(source.path)) continue;
            seenSources.add(source.path);
            sse.send('source', { label: source.title ?? source.path, path: source.path });
          }
          if (out.proposal) sse.send('proposal', out.proposal);
        } catch (err) {
          toolCtx.req.log.warn({ err, tool: p.tool!.name }, 'ai tool failed');
          outputs.set(p.block.id, 'failed');
          sse.send('tool', { id: p.block.id, name: p.tool!.name, status: 'error', live });
        }
      }),
    );
  }

  return planned.map((p): BetaToolResultBlockParam => {
    if (p.refused) return p.refused;
    const out = outputs.get(p.block.id);
    if (!out || out === 'failed') return errorResult(p.block.id, 'tool_failed');
    const text = resultText(out.result, { personal: p.tool!.personal, logEntries: p.tool!.logEntries });
    if (state.resultChars + text.length > CHAT_LIMITS.toolResultChars)
      return errorResult(p.block.id, 'result_limit');
    state.resultChars += text.length;
    return {
      type: 'tool_result',
      tool_use_id: p.block.id,
      content: text,
      ...(out.isError ? { is_error: true } : {}),
    };
  });
}
