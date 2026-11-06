import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages';
import { AI_MODELS, isAiFeature, type AiFeature } from '@weblion/shared';

/**
 * Demo mode (ai 14): with ENABLE_DEMO_PROVIDER=true and no key, the normal SDK client runs against this
 * in-process emulator (createAnthropic passes demoFetch). Every code path of the module runs unchanged: params,
 * streaming, finalMessage(), stop_reason handling, validation, accounting. Only the HTTP exchange is local.
 *
 * Routing is by the first line of the system prompt, "# Feature: <feature>" (ai 10.8, plan O4). The foundation
 * answers the models route, `translations` (plan O11) and a valid minimal object per JSON feature; `assistant`
 * answers a marker text without tool use. U3 completes the behaviour of ai 14 per feature.
 */

export interface EmulatedTurn {
  content: Array<
    { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown }
  >;
  stop_reason: 'end_turn' | 'tool_use';
  usage: { input_tokens: number; output_tokens: number };
}

type DemoLanguage = 'de' | 'en';
type JsonFeature = Exclude<AiFeature, 'assistant' | 'translations'>;

/** A valid minimal answer per JSON feature, German for language de, else English (U3 completes these). */
export const DEMO_JSON: Record<JsonFeature, (language: DemoLanguage) => unknown> = {
  explain: (l) => ({
    summary: l === 'de' ? '[Demo] Eine Aktion ist fehlgeschlagen.' : '[Demo] An action failed.',
    cause:
      l === 'de'
        ? '[Demo] Die Ursache ist im Demo-Modus nicht bekannt.'
        : '[Demo] The cause is not known in demo mode.',
    steps: [],
    links: [],
    severity: 'info',
  }),
  dns_check: (l) => ({
    overall: 'ok',
    topics: [],
    proposals: [],
    summary: l === 'de' ? '[Demo] Keine Auffälligkeiten.' : '[Demo] Nothing unusual.',
  }),
  audit_summary: (l) => ({
    summary: l === 'de' ? '[Demo] Zusammenfassung des Audit-Logs.' : '[Demo] Summary of the audit log.',
    highlights: [],
    unusual: [],
  }),
  server_health: (l) => ({
    overall: 'ok',
    summary: l === 'de' ? '[Demo] Der Server sieht gesund aus.' : '[Demo] The server looks healthy.',
    metrics: [],
    recommendations: [],
  }),
  product_texts: () => ({ texts: { de: null, en: null, fr: null, it: null, nl: null } }),
};

/** The feature named by the first line of the system prompt, null when there is none. */
export function featureOf(body: Pick<BetaMessageStreamParams, 'system'>): AiFeature | null {
  const system = body.system;
  const text = typeof system === 'string' ? system : Array.isArray(system) ? (system[0]?.text ?? '') : '';
  const match = /^# Feature: ([a-z_]+)/.exec(text);
  return match && isAiFeature(match[1]!) ? match[1] : null;
}

/** The text of the last user message (string content or its text blocks). */
function lastUserText(body: Pick<BetaMessageStreamParams, 'messages'>): string {
  const last = [...(body.messages ?? [])].reverse().find((m) => m.role === 'user');
  if (!last) return '';
  if (typeof last.content === 'string') return last.content;
  return last.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .filter(Boolean)
    .join('\n');
}

/** German when the newest context block says language: de, else English (ai 14). */
function languageOf(userText: string): DemoLanguage {
  const matches = [...userText.matchAll(/^language:\s*([a-z]{2})\s*$/gm)];
  return matches.at(-1)?.[1] === 'de' ? 'de' : 'en';
}

/**
 * The translator's batch (i18n 12.4: locale, items[].id, items[].de) answered as "[FR] <German text>" with the
 * target code in capitals. The German text keeps placeholders, line breaks and glossary terms, so the
 * structural checks of the translator pass (plan O11).
 */
function demoTranslations(userText: string): unknown {
  try {
    const batch = JSON.parse(userText) as { locale?: unknown; items?: Array<{ id?: unknown; de?: unknown }> };
    const code = typeof batch.locale === 'string' ? batch.locale.toUpperCase() : 'XX';
    const items = Array.isArray(batch.items) ? batch.items : [];
    return {
      items: items
        .filter((item) => typeof item?.id === 'string')
        .map((item) => ({
          id: item.id as string,
          text: `[${code}] ${typeof item.de === 'string' ? item.de : ''}`,
        })),
    };
  } catch {
    return { items: [] };
  }
}

const approx = (length: number) => Math.max(1, Math.ceil(length / 4));

/** The emulator behind demoFetch; also the fallback of the test mock (ai 15.1). */
export function emulateMessages(body: BetaMessageStreamParams): EmulatedTurn {
  const feature = featureOf(body);
  const userText = lastUserText(body);
  const language = languageOf(userText);
  let text: string;
  if (feature === 'translations') text = JSON.stringify(demoTranslations(userText));
  else if (feature && feature !== 'assistant') text = JSON.stringify(DEMO_JSON[feature](language));
  else {
    text =
      language === 'de'
        ? '[Demo] Das ist eine Demo-Antwort. Im Demo-Modus liest der Assistent keine Daten.'
        : '[Demo] This is a demo answer. In demo mode the assistant reads no data.';
  }
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: approx(JSON.stringify(body).length), output_tokens: approx(text.length) },
  };
}

let requestCounter = 0;

const encoder = new TextEncoder();
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function chunks(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length > 0 ? out : [''];
}

/** The SSE frames of a turn in the shapes of the Claude API. */
function turnFrames(turn: EmulatedTurn, model: string, id: string, textChunk: number): string[] {
  const frames = [
    frame('message_start', {
      type: 'message_start',
      message: {
        id,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        stop_details: null,
        usage: {
          input_tokens: turn.usage.input_tokens,
          output_tokens: 1,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    }),
  ];
  turn.content.forEach((block, index) => {
    if (block.type === 'text') {
      frames.push(
        frame('content_block_start', {
          type: 'content_block_start',
          index,
          content_block: { type: 'text', text: '' },
        }),
      );
      for (const part of chunks(block.text, textChunk)) {
        frames.push(
          frame('content_block_delta', {
            type: 'content_block_delta',
            index,
            delta: { type: 'text_delta', text: part },
          }),
        );
      }
    } else {
      frames.push(
        frame('content_block_start', {
          type: 'content_block_start',
          index,
          content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
        }),
      );
      frames.push(
        frame('content_block_delta', {
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input ?? {}) },
        }),
      );
    }
    frames.push(frame('content_block_stop', { type: 'content_block_stop', index }));
  });
  frames.push(
    frame('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: turn.stop_reason, stop_sequence: null, stop_details: null },
      usage: {
        input_tokens: turn.usage.input_tokens,
        output_tokens: turn.usage.output_tokens,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    }),
    frame('message_stop', { type: 'message_stop' }),
  );
  return frames;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function abortError(): Error {
  const err = new Error('The operation was aborted.');
  err.name = 'AbortError';
  return err;
}

/** Frames one by one, `delayMs` apart, stopping when the SDK aborts the request. */
function frameStream(frames: string[], delayMs: number, signal: AbortSignal | null | undefined) {
  let next = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (next > 0 && delayMs > 0) await sleep(delayMs);
      if (signal?.aborted) return controller.error(abortError());
      if (next >= frames.length) return controller.close();
      controller.enqueue(encoder.encode(frames[next++]!));
    },
  });
}

function json(status: number, body: unknown, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'request-id': requestId },
  });
}

function requestUrl(input: string | URL | Request): URL {
  return new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
}

/**
 * A fetch for the SDK that answers the Claude API routes the module uses, in process: GET /v1/models/:id for
 * the ids of AI_MODELS (the test button) and POST /v1/messages, streamed or not. The assistant's text streams in
 * chunks of about 20 characters 30 ms apart so the panel visibly streams; JSON answers stream at once.
 */
export const demoFetch: typeof fetch = async (input, init) => {
  const url = requestUrl(input as string | URL | Request);
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const requestId = `req_demo_${++requestCounter}`;
  const notFound = (message: string) =>
    json(
      404,
      { type: 'error', error: { type: 'not_found_error', message }, request_id: requestId },
      requestId,
    );

  const model = /^\/v1\/models\/([^/]+)$/.exec(url.pathname);
  if (method === 'GET' && model) {
    const id = decodeURIComponent(model[1]!);
    if (!(AI_MODELS as readonly string[]).includes(id)) return notFound(`model: ${id}`);
    return json(200, { type: 'model', id, display_name: id, created_at: '2026-01-01T00:00:00Z' }, requestId);
  }
  if (method !== 'POST' || url.pathname !== '/v1/messages') return notFound('Not found');

  const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as BetaMessageStreamParams & {
    stream?: boolean;
  };
  const turn = emulateMessages(body);
  const id = `msg_demo_${requestCounter}`;
  if (!body.stream) {
    return json(
      200,
      {
        id,
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: turn.content,
        stop_reason: turn.stop_reason,
        stop_sequence: null,
        stop_details: null,
        usage: { ...turn.usage, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      requestId,
    );
  }
  const assistant = featureOf(body) === 'assistant' || featureOf(body) === null;
  const frames = turnFrames(turn, body.model, id, assistant ? 20 : 400);
  return new Response(frameStream(frames, assistant ? 30 : 0, init?.signal), {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'request-id': requestId },
  });
};
