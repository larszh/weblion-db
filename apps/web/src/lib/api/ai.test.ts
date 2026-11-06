import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiSseEvent } from '@weblion/shared';
import { ApiError } from '@/lib/api';
import { buildHistory, parseSseFrame, streamAiChat, type ChatMessage } from './ai';

let n = 0;
const user = (text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `u${n++}`,
  role: 'user',
  text,
  status: 'done',
  page: { path: '/o/muster', title: 'Dashboard' },
  ...extra,
});
const answer = (text: string, status: ChatMessage['status'] = 'done'): ChatMessage => ({
  id: `a${n++}`,
  role: 'assistant',
  text,
  status,
});

describe('parseSseFrame', () => {
  it('reads event and data, ignoring comment lines', () => {
    expect(parseSseFrame(': ping\nevent: text\ndata: {"text":"Hallo"}')).toEqual({
      event: 'text',
      data: { text: 'Hallo' },
    });
  });

  it('joins several data lines with a line break', () => {
    const frame = 'event: done\ndata: {"servedModel":\ndata: "claude-opus-5-5","fallback":false}';
    expect(parseSseFrame(frame)).toEqual({
      event: 'done',
      data: { servedModel: 'claude-opus-5-5', fallback: false },
    });
  });

  it('accepts CRLF line ends and a value without the space after the colon', () => {
    expect(parseSseFrame('event:notice\r\ndata:{"kind":"tool_limit"}')).toEqual({
      event: 'notice',
      data: { kind: 'tool_limit' },
    });
  });

  it('gives null for comments only, unknown events, missing data and data that is not JSON', () => {
    expect(parseSseFrame(': open')).toBeNull();
    expect(parseSseFrame(': ping\n: ping')).toBeNull();
    expect(parseSseFrame('event: secret\ndata: {"a":1}')).toBeNull();
    expect(parseSseFrame('data: {"text":"no event name"}')).toBeNull();
    expect(parseSseFrame('event: text')).toBeNull();
    expect(parseSseFrame('event: text\ndata: not json')).toBeNull();
    expect(parseSseFrame('event: text\ndata: 42')).toBeNull();
  });
});

describe('buildHistory', () => {
  it('sends the alternating history with the page on user messages only', () => {
    const history = buildHistory([user('Wie geht es?'), answer('Gut.'), user('Und die Domains?')]);
    expect(history).toEqual([
      { role: 'user', text: 'Wie geht es?', page: { path: '/o/muster', title: 'Dashboard' } },
      { role: 'assistant', text: 'Gut.' },
      { role: 'user', text: 'Und die Domains?', page: { path: '/o/muster', title: 'Dashboard' } },
    ]);
  });

  it('drops a failed answer and its question, so the roles alternate after an error', () => {
    const history = buildHistory([
      user('Erste Frage'),
      answer('Antwort'),
      user('Zweite Frage'),
      answer('', 'error'),
      user('Dritte Frage'),
    ]);
    expect(history.map((m) => [m.role, m.text])).toEqual([
      ['user', 'Erste Frage'],
      ['assistant', 'Antwort'],
      ['user', 'Dritte Frage'],
    ]);
  });

  it('drops a cancelled answer and the streaming placeholder', () => {
    const history = buildHistory([
      user('Frage'),
      answer('halb', 'cancelled'),
      user('Neue Frage'),
      answer('', 'streaming'),
    ]);
    expect(history.map((m) => m.text)).toEqual(['Neue Frage']);
  });

  it('drops empty answers', () => {
    const history = buildHistory([user('A'), answer('   '), user('B')]);
    expect(history.map((m) => m.text)).toEqual(['B']);
  });

  it('keeps the newest 40 messages and never starts with an answer', () => {
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 20; i++) messages.push(user(`q${i}`), answer(`a${i}`));
    messages.push(user('neu')); // 41 messages
    const history = buildHistory(messages);
    expect(history).toHaveLength(39);
    expect(history[0]).toMatchObject({ role: 'user', text: 'q1' });
    expect(history[history.length - 1]).toMatchObject({ role: 'user', text: 'neu' });
  });

  it('with 60 messages keeps at most 40, alternating from a question', () => {
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 30; i++) messages.push(user(`q${i}`), answer(`a${i}`));
    const history = buildHistory([...messages, user('neu')]);
    expect(history.length).toBeLessThanOrEqual(40);
    expect(history[0]!.role).toBe('user');
    history.forEach((m, i) => expect(m.role).toBe(i % 2 === 0 ? 'user' : 'assistant'));
  });

  it('cuts answers to 16,000 and questions to 4,000 characters', () => {
    const history = buildHistory([user('x'.repeat(5000)), answer('y'.repeat(20_000)), user('z')]);
    expect(history[0]!.text).toHaveLength(4000);
    expect(history[1]!.text).toHaveLength(16_000);
  });
});

/** A fetch answering with the given SSE text, delivered in small chunks like a real stream. */
function sseResponse(body: string, chunk = 7): Response {
  const bytes = new TextEncoder().encode(body);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunk) controller.enqueue(bytes.slice(i, i + chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const request = { messages: [{ role: 'user' as const, text: 'Hallo', page: null }], locale: 'de' as const };

describe('streamAiChat', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts with the CSRF header and hands every event to onEvent', async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse(
        ': open\n\n' +
          frame('meta', { model: 'claude-opus-5-5', demo: false }) +
          ': ping\n\n' +
          frame('text', { text: 'Grüezi ' }) +
          frame('text', { text: 'mitenand' }) +
          frame('done', { servedModel: 'claude-opus-5-5', fallback: false }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const events: AiSseEvent[] = [];
    await streamAiChat('org-1', request, {
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
    });
    expect(events.map((e) => e.event)).toEqual(['meta', 'text', 'text', 'done']);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/orgs/org-1/ai/chat');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'X-Requested-With': 'weblion-console',
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual(request);
  });

  it('turns an error event into an ApiError after handing it on', async () => {
    vi.stubGlobal('fetch', async () =>
      sseResponse(
        frame('meta', { model: 'claude-opus-5-5', demo: false }) +
          frame('text', { text: 'Teil' }) +
          frame('error', {
            status: 429,
            code: 'ai_limit',
            message: 'Monthly AI budget used up.',
            details: { limit: 'budget', retryAfterSeconds: null, resetsAt: null },
          }),
      ),
    );
    const events: string[] = [];
    const err = await streamAiChat('org-1', request, {
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e.event),
    }).catch((e: unknown) => e);
    expect(events).toEqual(['meta', 'text', 'error']);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 429, code: 'ai_limit', details: { limit: 'budget' } });
  });

  it('throws a 429 JSON answer as ApiError with details.limit', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            error: { code: 'ai_limit', message: 'Too many AI requests.', details: { limit: 'user_rate' } },
          }),
          { status: 429, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    const onEvent = vi.fn();
    const err = await streamAiChat('org-1', request, { signal: new AbortController().signal, onEvent }).catch(
      (e: unknown) => e,
    );
    expect(onEvent).not.toHaveBeenCalled();
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 429, code: 'ai_limit', details: { limit: 'user_rate' } });
  });

  it('a stream that ends without done or error is ai_upstream network', async () => {
    vi.stubGlobal('fetch', async () => sseResponse(frame('text', { text: 'abgeschnitten' })));
    const err = await streamAiChat('org-1', request, {
      signal: new AbortController().signal,
      onEvent: () => {},
    }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502, code: 'ai_upstream', details: { reason: 'network' } });
  });

  it('reads a last frame without the closing blank line', async () => {
    vi.stubGlobal('fetch', async () =>
      sseResponse(
        `event: done\ndata: ${JSON.stringify({ servedModel: 'claude-haiku-5-5', fallback: false })}`,
      ),
    );
    const events: string[] = [];
    await streamAiChat('org-1', request, {
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e.event),
    });
    expect(events).toEqual(['done']);
  });
});
