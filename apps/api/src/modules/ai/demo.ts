import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages';
import { AI_MODELS, isAiFeature, type AiFeature } from '@weblion/shared';

/**
 * Demo mode (ai 14): with ENABLE_DEMO_PROVIDER=true and no key, the normal SDK client runs against this
 * in-process emulator (createAnthropic passes demoFetch). Every code path of the module runs unchanged: params,
 * streaming, finalMessage(), stop_reason handling, the tool loop, validation, accounting. Only the HTTP exchange
 * is local.
 *
 * Routing is by the first line of the system prompt, "# Feature: <feature>" (ai 10.8, plan O4). The answers are
 * built from the data in the request (the <third_party> block, the tool results), German for language de, else
 * English, and start with "[Demo]".
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

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** The JSON of the first <third_party> block of the user turn (escaped with toolJson, still valid JSON). */
export function thirdPartyOf(userText: string): { kind: string; value: unknown } | null {
  const match = /<third_party kind="([a-z_]+)">\n([\s\S]*?)\n<\/third_party>/.exec(userText);
  if (!match) return null;
  try {
    return { kind: match[1]!, value: JSON.parse(match[2]!) };
  } catch {
    return null;
  }
}

function demoExplain(l: DemoLanguage, data: unknown): unknown {
  const item = isObject(data) ? data : {};
  // The browser's error, an audit entry, a server action, a monitor, a website, a provider or a mail log row.
  const code =
    str(item.code) ??
    str(item.action) ??
    str(isObject(item.action) ? item.action.type : null) ??
    str(item.type) ??
    str(item.template) ??
    'unknown';
  const status = String(item.status ?? (isObject(item.action) ? item.action.status : '') ?? '');
  const failed =
    ['failure', 'failed', 'error', 'down', 'denied'].includes(status) || Number(item.status) >= 400;
  return {
    summary:
      l === 'de'
        ? `[Demo] Der Vorgang «${code}» ist mit dem Status «${status || 'unbekannt'}» geendet.`
        : `[Demo] The step "${code}" ended with the status "${status || 'unknown'}".`,
    cause:
      l === 'de'
        ? '[Demo] Im Demo-Modus wird die Ursache nicht untersucht. Die Angaben stammen aus den Daten der Konsole.'
        : '[Demo] Demo mode does not look into the cause. The details come from the data of the console.',
    steps:
      l === 'de'
        ? ['[Demo] Prüfen Sie die Angaben auf der Seite.', '[Demo] Versuchen Sie es später nochmals.']
        : ['[Demo] Check the details on the page.', '[Demo] Try again later.'],
    links: [],
    severity: failed ? 'error' : 'info',
  };
}

const TOPIC_OF: Record<string, string> = {
  mx: 'mx',
  spf: 'spf',
  dkim: 'dkim',
  dmarc: 'dmarc',
  autodiscover: 'autoconfig',
  autoconfig: 'autoconfig',
  autodiscover_srv: 'autoconfig',
  a: 'website',
  aaaa: 'website',
  www_a: 'website',
  www_aaaa: 'website',
};

function demoDnsCheck(l: DemoLanguage, data: unknown): unknown {
  const expected = asArray(isObject(data) ? data.expected : null).filter(isObject);
  const proposals: unknown[] = [];
  const topics = new Map<string, { status: string; findings: string[]; proposal_indexes: number[] }>();
  const rank: Record<string, number> = { ok: 0, warning: 1, problem: 2 };
  for (const e of expected) {
    const topic = TOPIC_OF[String(e.key)] ?? 'other';
    const status = e.status === 'ok' ? 'ok' : e.status === 'missing' && e.required ? 'problem' : 'warning';
    const entry = topics.get(topic) ?? { status: 'ok', findings: [], proposal_indexes: [] };
    if (rank[status]! > rank[entry.status]!) entry.status = status;
    if (e.status === 'missing') {
      // Copied exactly from the console's own record, so the proposal is verified.
      entry.proposal_indexes.push(proposals.length);
      proposals.push({
        action: 'add',
        record_id: null,
        type: e.type,
        name: e.name,
        data: e.data,
        ttl: null,
        reason:
          l === 'de'
            ? `[Demo] Der Eintrag ${String(e.key)} fehlt.`
            : `[Demo] The ${String(e.key)} record is missing.`,
      });
    }
    entry.findings.push(String(e.key));
    topics.set(topic, entry);
  }
  const list = [...topics.entries()].map(([topic, t]) => ({
    topic,
    status: t.status,
    finding:
      l === 'de'
        ? `[Demo] ${t.status === 'ok' ? 'In Ordnung' : 'Zu prüfen'}: ${t.findings.join(', ')}.`
        : `[Demo] ${t.status === 'ok' ? 'Fine' : 'To check'}: ${t.findings.join(', ')}.`,
    proposal_indexes: t.proposal_indexes,
  }));
  const worst = list.reduce((w, t) => (rank[t.status]! > rank[w]! ? t.status : w), 'ok');
  return { overall: worst, topics: list, proposals };
}

function demoAuditSummary(l: DemoLanguage, data: unknown): unknown {
  const entries = asArray(isObject(data) ? data.entries : null).filter(isObject);
  const byPrefix = new Map<string, string[]>();
  for (const e of entries) {
    const prefix = String(e.action ?? 'other').split('.')[0]!;
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), String(e.id)]);
  }
  const failed = entries
    .filter((e) => e.status === 'failure' || e.status === 'denied')
    .map((e) => String(e.id));
  return {
    summary:
      l === 'de'
        ? `[Demo] ${entries.length} Einträge, davon ${failed.length} fehlgeschlagen oder abgelehnt.`
        : `[Demo] ${entries.length} entries, ${failed.length} of them failed or denied.`,
    highlights: [...byPrefix.entries()].slice(0, 10).map(([prefix, ids]) => ({
      text: l === 'de' ? `[Demo] ${ids.length} x ${prefix}` : `[Demo] ${ids.length} x ${prefix}`,
      audit_ids: ids.slice(0, 20),
    })),
    unusual: failed.length
      ? [
          {
            text:
              l === 'de'
                ? '[Demo] Fehlgeschlagene oder abgelehnte Aktionen'
                : '[Demo] Failed or denied actions',
            audit_ids: failed.slice(0, 20),
          },
        ]
      : [],
  };
}

/** Status of a percentage: above 85 problem, above 70 watch (ai 14). */
const percentStatus = (value: number | null) =>
  value === null ? null : value > 85 ? 'problem' : value > 70 ? 'watch' : 'ok';

function demoServerHealth(l: DemoLanguage, data: unknown): unknown {
  const series =
    isObject(data) && isObject(data.metrics) && isObject(data.metrics.series) ? data.metrics.series : {};
  const max = (key: string) =>
    isObject(series[key]) && typeof series[key].max === 'number' ? series[key].max : null;
  const cpu = percentStatus(max('cpu'));
  const memUsed = max('memUsed');
  const memTotal = max('memTotal');
  const mem = percentStatus(memUsed !== null && memTotal ? (memUsed / memTotal) * 100 : null);
  const metrics: Array<{ metric: string; status: string; finding: string }> = [];
  if (cpu) {
    metrics.push({
      metric: 'cpu',
      status: cpu,
      finding: l === 'de' ? `[Demo] CPU höchstens ${max('cpu')} %.` : `[Demo] CPU at most ${max('cpu')} %.`,
    });
  }
  if (mem) {
    metrics.push({
      metric: 'memory',
      status: mem,
      finding: l === 'de' ? '[Demo] Arbeitsspeicher nach den Messwerten.' : '[Demo] Memory from the metrics.',
    });
  }
  const rank: Record<string, number> = { ok: 0, watch: 1, problem: 2 };
  const overall = metrics.reduce((w, m) => (rank[m.status]! > rank[w]! ? m.status : w), 'ok');
  return {
    overall,
    summary:
      l === 'de'
        ? '[Demo] Auswertung aus den Messwerten der Konsole.'
        : '[Demo] Assessment from the console metrics.',
    metrics,
    recommendations:
      overall === 'ok'
        ? []
        : [l === 'de' ? '[Demo] Prüfen Sie einen grösseren Plan.' : '[Demo] Consider a larger plan.'],
  };
}

function demoProductTexts(data: unknown): unknown {
  const draft = isObject(data) ? data : {};
  const name = str(draft.name) ?? 'Produkt';
  const description = str(draft.description);
  const languages = asArray(draft.languages).map(String);
  return {
    texts: languages.map((locale) =>
      draft.mode === 'write' && locale === 'de'
        ? { locale, name, description: '[Demo] Beschreibung des Produkts.' }
        : {
            locale,
            name: `[${locale.toUpperCase()}] ${name}`,
            description: description ? `[${locale.toUpperCase()}] ${description}` : null,
          },
    ),
  };
}

/** The answer per JSON feature, built from the <third_party> block of the user turn (ai 14). */
export const DEMO_JSON: Record<JsonFeature, (language: DemoLanguage, userText: string) => unknown> = {
  explain: (l, text) => demoExplain(l, thirdPartyOf(text)?.value),
  dns_check: (l, text) => demoDnsCheck(l, thirdPartyOf(text)?.value),
  audit_summary: (l, text) => demoAuditSummary(l, thirdPartyOf(text)?.value),
  server_health: (l, text) => demoServerHealth(l, thirdPartyOf(text)?.value),
  product_texts: (_l, text) => demoProductTexts(thirdPartyOf(text)?.value),
};

/** The feature named by the first line of the system prompt, null when there is none. */
export function featureOf(body: Pick<BetaMessageStreamParams, 'system'>): AiFeature | null {
  const system = body.system;
  const text = typeof system === 'string' ? system : Array.isArray(system) ? (system[0]?.text ?? '') : '';
  const match = /^# Feature: ([a-z_]+)/.exec(text);
  return match && isAiFeature(match[1]!) ? match[1] : null;
}

type MessageParam = BetaMessageStreamParams['messages'][number];

/** The text of a message (string content or its text blocks). */
function textOf(message: MessageParam | undefined): string {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  return (message.content ?? [])
    .map((block) => (block.type === 'text' ? block.text : ''))
    .filter(Boolean)
    .join('\n');
}

/** The text of the newest user message that the person wrote (not a message of tool results). */
function questionOf(body: Pick<BetaMessageStreamParams, 'messages'>): string {
  const messages = body.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string' || !m.content.some((b) => b.type === 'tool_result')) return textOf(m);
  }
  return '';
}

/** The text of the last user message. */
function lastUserText(body: Pick<BetaMessageStreamParams, 'messages'>): string {
  return textOf([...(body.messages ?? [])].reverse().find((m) => m.role === 'user'));
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

/** The tool calls of the last assistant message and their results in the user message after it. */
function lastToolStep(
  body: Pick<BetaMessageStreamParams, 'messages'>,
): Array<{ name: string; result: unknown }> {
  const messages = body.messages ?? [];
  const last = messages.at(-1);
  const assistant = messages.at(-2);
  if (!last || last.role !== 'user' || typeof last.content === 'string') return [];
  if (!assistant || assistant.role !== 'assistant' || typeof assistant.content === 'string') return [];
  const names = new Map<string, string>();
  for (const block of assistant.content) if (block.type === 'tool_use') names.set(block.id, block.name);
  const out: Array<{ name: string; result: unknown }> = [];
  for (const block of last.content) {
    if (block.type !== 'tool_result') continue;
    let result: unknown = null;
    try {
      result = typeof block.content === 'string' ? JSON.parse(block.content) : null;
    } catch {
      result = null;
    }
    out.push({ name: names.get(block.tool_use_id) ?? '', result });
  }
  return out;
}

let toolCounter = 0;
const toolUse = (name: string, input: unknown) => ({
  type: 'tool_use' as const,
  id: `toolu_demo_${++toolCounter}`,
  name,
  input,
});

const MAIL_QUESTION = /\b(dns|e-?mail|mail|spf|dkim|dmarc|mx)\b/i;

/**
 * The assistant (ai 14): first a short text and get_org_overview, then a text with the counts it returned. When
 * the newest question is about DNS or e-mail: list_mail_domains, get_mail_dns_setup for the first one, then
 * propose_dns_record with the first expected record that is missing (copied exactly, so it is verified), then the
 * text. Tools the person may not read answer with an error, and the emulator then just answers.
 */
function demoAssistant(body: BetaMessageStreamParams, language: DemoLanguage): EmulatedTurn['content'] {
  const de = language === 'de';
  const step = lastToolStep(body);
  const final = (text: string) => [{ type: 'text' as const, text }];
  if (step.length === 0) {
    const mail = MAIL_QUESTION.test(questionOf(body).replace(/<context>[\s\S]*?<\/context>/g, ''));
    return [
      { type: 'text', text: de ? '[Demo] Ich sehe mir das an.' : '[Demo] Let me look at that.' },
      mail ? toolUse('list_mail_domains', {}) : toolUse('get_org_overview', {}),
    ];
  }
  const { name, result } = step[0]!;
  const data = isObject(result) ? result : {};
  if (name === 'get_org_overview') {
    const counts = isObject(data.counts) ? data.counts : {};
    const n = (k: string) => Number(counts[k] ?? 0);
    return final(
      de
        ? `[Demo] Ihre Organisation hat ${n('servers')} Server, ${n('domains')} Domains, ${n('mailDomains')} E-Mail-Domains und ${n('monitors')} Monitore.`
        : `[Demo] Your organization has ${n('servers')} servers, ${n('domains')} domains, ${n('mailDomains')} e-mail domains and ${n('monitors')} monitors.`,
    );
  }
  if (name === 'list_mail_domains') {
    const first = asArray(data.items).filter(isObject)[0];
    if (!first || typeof first.id !== 'string') {
      return final(de ? '[Demo] Ich finde keine E-Mail-Domain.' : '[Demo] I find no e-mail domain.');
    }
    return [toolUse('get_mail_dns_setup', { mail_domain_id: first.id })];
  }
  if (name === 'get_mail_dns_setup') {
    const zone = isObject(data.zone) ? data.zone : null;
    const records = asArray(data.records).filter(isObject);
    const usable = (r: Json) => r.status === 'missing' && typeof r.data === 'string' && !!r.data;
    // DMARC first: the short record the demo shows best (plan 8.4 scenario 1), else the first missing one.
    const missing = records.find((r) => r.key === 'dmarc' && usable(r)) ?? records.find(usable);
    if (zone && typeof zone.domainId === 'string' && missing) {
      return [
        toolUse('propose_dns_record', {
          domain_id: zone.domainId,
          action: 'add',
          record_id: null,
          type: missing.type,
          name: missing.name,
          data: missing.data,
          ttl: null,
          reason: de
            ? `[Demo] Der Eintrag ${String(missing.key)} fehlt.`
            : `[Demo] The ${String(missing.key)} record is missing.`,
        }),
      ];
    }
    return final(
      de
        ? '[Demo] Die DNS-Einträge für E-Mail sind vollständig.'
        : '[Demo] The e-mail DNS records are complete.',
    );
  }
  if (name === 'propose_dns_record' && !data.error) {
    return final(
      de
        ? '[Demo] Ein Eintrag fehlt. Ich habe ihn als Vorschlag vorbereitet; Sie können ihn im DNS-Formular übernehmen.'
        : '[Demo] One record is missing. I prepared it as a proposal; you can apply it in the DNS form.',
    );
  }
  return final(
    de ? '[Demo] Das konnte ich im Demo-Modus nicht lesen.' : '[Demo] I could not read that in demo mode.',
  );
}

const approx = (length: number) => Math.max(1, Math.ceil(length / 4));

/** The emulator behind demoFetch; also the fallback of the test mock (ai 15.1). */
export function emulateMessages(body: BetaMessageStreamParams): EmulatedTurn {
  const feature = featureOf(body);
  const userText = lastUserText(body);
  const language = languageOf(feature === 'assistant' ? questionOf(body) : userText);
  let content: EmulatedTurn['content'];
  if (feature === 'translations')
    content = [{ type: 'text', text: JSON.stringify(demoTranslations(userText)) }];
  else if (feature && feature !== 'assistant') {
    content = [{ type: 'text', text: JSON.stringify(DEMO_JSON[feature](language, userText)) }];
  } else content = demoAssistant(body, language);
  const output = content.map((b) => (b.type === 'text' ? b.text : JSON.stringify(b.input))).join('');
  return {
    content,
    stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
    usage: { input_tokens: approx(JSON.stringify(body).length), output_tokens: approx(output.length) },
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
