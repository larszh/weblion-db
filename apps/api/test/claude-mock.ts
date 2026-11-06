import http, { type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AI_MODELS } from '@weblion/shared';
import { emulateMessages } from '../src/modules/ai/demo';

/**
 * A local Claude API for the tests (plan F19, ai 15.1): GET /v1/models/:id and POST /v1/messages, streamed as
 * the API's SSE frames or as JSON. The key is checked in x-api-key or, as SDK 1.3.0 sends it, in
 * Authorization: Bearer. A script decides each answer of POST /v1/messages; without one the demo
 * emulator answers. Every request is recorded, so tests assert on the exact body and headers.
 */

export interface MockTurn {
  text?: string;
  json?: unknown;
  stopReason?: 'end_turn' | 'max_tokens' | 'refusal';
  refusalCategory?: string | null;
  model?: string;
  usage?: Partial<{
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  }>;
  error?: {
    status: 400 | 401 | 402 | 403 | 404 | 429 | 500 | 529;
    type: string;
    message: string;
    headers?: Record<string, string>;
  };
  delayMs?: number;
  /** Awaited before the answer (cancel tests). */
  gate?: Promise<void>;
  /** After afterFrames SSE frames: `event: error` with { type: 'error', error: { type, message } }, then end. */
  midStreamError?: {
    type: 'overloaded_error' | 'api_error' | 'rate_limit_error';
    message?: string;
    afterFrames: number;
  };
  /**
   * Server-side fallback (ai 15.1): after `afterFrames` text deltas (0 = before any output) a `fallback` content
   * block from the requested model to `model`, then the rest of the turn; usage.iterations gets a 'message'
   * entry (with declinedUsage) and a 'fallback_message' entry; the message's `model` is `model`.
   */
  fallbackTo?: { model: string; afterFrames: number; declinedUsage?: MockTurn['usage'] };
}

export interface RecordedClaudeRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: any;
}

export const MOCK_API_KEY = 'sk-ant-test-0000000000000000000000';
/** Models outside AI_MODELS that GET /v1/models accepts: the server-side fallback targets of the tests. */
export const MOCK_FALLBACK_MODELS = ['claude-opus-5', 'claude-opus-4-8', 'claude-sonnet-5'];

const DEFAULT_USAGE = {
  input_tokens: 100,
  output_tokens: 20,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | {
      type: 'fallback';
      from: { model: string };
      to: { model: string };
      trigger: { category: string | null };
    };

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function chunks(text: string, size = 40): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

interface Answer {
  model: string;
  blocks: Block[];
  stopReason: string;
  stopDetails: unknown;
  usage: Record<string, unknown>;
}

/** The answer of a scripted turn, or of the demo emulator when the script gives none. */
function answerOf(body: any, turn: MockTurn | undefined): Answer {
  if (!turn) {
    const emulated = emulateMessages(body);
    return {
      model: body.model,
      blocks: emulated.content as Block[],
      stopReason: emulated.stop_reason,
      stopDetails: null,
      usage: { ...DEFAULT_USAGE, ...emulated.usage },
    };
  }
  const text = turn.text ?? (turn.json !== undefined ? JSON.stringify(turn.json) : '');
  const usage = { ...DEFAULT_USAGE, ...turn.usage };
  const stopReason = turn.stopReason ?? 'end_turn';
  const stopDetails =
    stopReason === 'refusal'
      ? {
          type: 'refusal',
          category: turn.refusalCategory ?? null,
          explanation: null,
          fallback_credit_token: null,
          fallback_has_prefill_claim: null,
          recommended_model: null,
        }
      : null;
  const fb = turn.fallbackTo;
  if (!fb) {
    return {
      model: turn.model ?? body.model,
      blocks: text ? [{ type: 'text', text }] : [],
      stopReason,
      stopDetails,
      usage,
    };
  }
  // A fallback: the declined part (afterFrames chunks) in its own text block, the switch point, the rest.
  const parts = chunks(text);
  const before = parts.slice(0, fb.afterFrames).join('');
  const after = parts.slice(fb.afterFrames).join('');
  const declined = { ...DEFAULT_USAGE, output_tokens: 0, ...fb.declinedUsage };
  return {
    model: fb.model,
    blocks: [
      ...(before ? [{ type: 'text' as const, text: before }] : []),
      {
        type: 'fallback',
        from: { model: body.model },
        to: { model: fb.model },
        trigger: { category: 'cyber' },
      },
      ...(after ? [{ type: 'text' as const, text: after }] : []),
    ],
    stopReason,
    stopDetails,
    usage: {
      ...usage,
      iterations: [
        { type: 'message', model: body.model, ...declined },
        { type: 'fallback_message', model: fb.model, ...usage },
      ],
    },
  };
}

/** The SSE frames of an answer in the shapes of the Claude API. */
function framesOf(body: any, answer: Answer, id: string): string[] {
  const frames = [
    frame('message_start', {
      type: 'message_start',
      message: {
        id,
        type: 'message',
        role: 'assistant',
        // A fallback block names the served model; before it the requested model streams.
        model: answer.blocks.some((b) => b.type === 'fallback') ? body.model : answer.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        stop_details: null,
        usage: {
          input_tokens: answer.usage.input_tokens,
          output_tokens: 1,
          cache_read_input_tokens: answer.usage.cache_read_input_tokens,
          cache_creation_input_tokens: answer.usage.cache_creation_input_tokens,
        },
      },
    }),
  ];
  answer.blocks.forEach((block, index) => {
    if (block.type === 'text') {
      frames.push(
        frame('content_block_start', {
          type: 'content_block_start',
          index,
          content_block: { type: 'text', text: '' },
        }),
      );
      for (const part of chunks(block.text)) {
        frames.push(
          frame('content_block_delta', {
            type: 'content_block_delta',
            index,
            delta: { type: 'text_delta', text: part },
          }),
        );
      }
    } else if (block.type === 'tool_use') {
      frames.push(
        frame('content_block_start', {
          type: 'content_block_start',
          index,
          content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
        }),
        frame('content_block_delta', {
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input ?? {}) },
        }),
      );
    } else {
      frames.push(frame('content_block_start', { type: 'content_block_start', index, content_block: block }));
    }
    frames.push(frame('content_block_stop', { type: 'content_block_stop', index }));
  });
  frames.push(
    frame('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: answer.stopReason, stop_sequence: null, stop_details: answer.stopDetails },
      usage: answer.usage,
    }),
    frame('message_stop', { type: 'message_stop' }),
  );
  return frames;
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string>) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

export async function startClaudeMock(
  opts: { apiKey?: string; port?: number; script?: (body: any, index: number) => MockTurn | undefined } = {},
): Promise<{
  url: string;
  requests: RecordedClaudeRequest[];
  setScript(fn: (body: any, index: number) => MockTurn | undefined): void;
  close(): Promise<void>;
}> {
  const apiKey = opts.apiKey ?? MOCK_API_KEY;
  let script = opts.script;
  const requests: RecordedClaudeRequest[] = [];
  let counter = 0;
  let messageIndex = 0;

  const server = http.createServer((req, res) => {
    const raw: Buffer[] = [];
    req.on('data', (chunk: Buffer) => raw.push(chunk));
    req.on('end', () => {
      void (async () => {
        const text = Buffer.concat(raw).toString('utf8');
        let body: any = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = text;
        }
        const path = (req.url ?? '/').split('?')[0]!;
        requests.push({ method: req.method ?? 'GET', path, headers: req.headers, body });
        const requestId = `req_mock_${++counter}`;
        const base = { 'request-id': requestId };
        const error = (status: number, type: string, message: string, headers: Record<string, string> = {}) =>
          sendJson(
            res,
            status,
            { type: 'error', error: { type, message }, request_id: requestId },
            { ...base, ...headers },
          );

        // SDK 1.3.0 sends the key as Authorization: Bearer; x-api-key is accepted as well.
        const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
        if ((req.headers['x-api-key'] ?? bearer) !== apiKey) {
          return error(401, 'authentication_error', 'invalid x-api-key');
        }

        const model = /^\/v1\/models\/([^/]+)$/.exec(path);
        if (req.method === 'GET' && model) {
          const id = decodeURIComponent(model[1]!);
          if (![...AI_MODELS, ...MOCK_FALLBACK_MODELS].includes(id)) {
            return error(404, 'not_found_error', `model: ${id}`);
          }
          return sendJson(
            res,
            200,
            { type: 'model', id, display_name: id, created_at: '2026-01-01T00:00:00Z' },
            base,
          );
        }
        if (req.method !== 'POST' || path !== '/v1/messages')
          return error(404, 'not_found_error', 'Not found');

        const index = messageIndex++;
        const turn = script?.(body, index);
        if (turn?.gate) await turn.gate;
        if (turn?.delayMs) await sleep(turn.delayMs);
        if (res.destroyed) return;
        if (turn?.error) {
          return error(turn.error.status, turn.error.type, turn.error.message, turn.error.headers ?? {});
        }

        const answer = answerOf(body, turn);
        const id = `msg_mock_${counter}`;
        if (!body?.stream) {
          return sendJson(
            res,
            200,
            {
              id,
              type: 'message',
              role: 'assistant',
              model: answer.model,
              content: answer.blocks,
              stop_reason: answer.stopReason,
              stop_sequence: null,
              stop_details: answer.stopDetails,
              usage: answer.usage,
            },
            base,
          );
        }
        let frames = framesOf(body, answer, id);
        const mid = turn?.midStreamError;
        if (mid) {
          frames = [
            ...frames.slice(0, mid.afterFrames),
            frame('error', {
              type: 'error',
              error: { type: mid.type, message: mid.message ?? 'Overloaded' },
            }),
          ];
        }
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          ...base,
        });
        for (const f of frames) {
          if (res.destroyed) return;
          res.write(f);
        }
        res.end();
      })().catch((err: unknown) => {
        if (!res.headersSent)
          sendJson(res, 500, { type: 'error', error: { type: 'api_error', message: String(err) } }, {});
        else res.destroy();
      });
    });
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    // A new script counts its requests from 0 again.
    setScript(fn) {
      script = fn;
      messageIndex = 0;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
