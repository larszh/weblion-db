import { useEffect, useRef, useState, type JSX, type KeyboardEvent, type Ref } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  CircleAlert,
  CircleStop,
  Loader2,
  MessageSquarePlus,
  SendHorizontal,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import type { AiDnsProposalDto, AiModel, AiPageRef, AiSseEvent, AiToolName } from '@weblion/shared';
import { cn } from '@/lib/cn';
import { ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useOptionalOrg } from '@/lib/org-context';
import {
  aiErrorText,
  buildHistory,
  CHAT_USER_MAX,
  streamAiChat,
  useAiStatus,
  type ChatError,
  type ChatMessage,
} from '@/lib/api/ai';
import { Button } from '@/components/ui/button';
import { CopyButton, Textarea } from '@/components/ui/primitives';
import { AiText, isConsolePath } from './ai-text';
import { aiAllowed, AiFootnote, DemoBadge, modelLabel, ProposalCard, useCachedMe } from './bits';
import { setAssistantListener } from './assistant-bus';
import { useApplyProposal } from './ai-provider';
import { loadAiChat, saveAiChat } from './storage';
import { showLauncher } from './launcher-visible';

/**
 * The assistant (ai 12.3): a launcher at the bottom right and a side panel (full screen below sm) with the
 * organization's chat. The chat lives in sessionStorage per organization (storage.ts); a turn streams over
 * POST /orgs/:orgId/ai/chat (streamAiChat). The panel state changes only through the pure functions below
 * (startTurn, applySseEvent, failTurn, cancelTurn), which the tests drive with a scripted event list.
 */

// --- State -----------------------------------------------------------------------------

export interface AssistantState {
  messages: ChatMessage[];
  /** The unverified proposal whose extra confirmation is open (plan decision 23). */
  confirming: string | null;
}

export const EMPTY_ASSISTANT: AssistantState = { messages: [], confirming: null };

let counter = 0;
const newId = () => `m${Date.now().toString(36)}${(counter++).toString(36)}`;

/** The new question and the streaming placeholder of its answer. */
export function startTurn(state: AssistantState, text: string, page: AiPageRef | null): AssistantState {
  return {
    ...state,
    messages: [
      ...state.messages,
      { id: newId(), role: 'user', text, status: 'done', page },
      { id: newId(), role: 'assistant', text: '', status: 'streaming' },
    ],
  };
}

/** Starts the answer again after a failed one: the failed answer goes, a new placeholder follows the question. */
export function retryTurn(state: AssistantState): AssistantState {
  const messages = [...state.messages];
  while (messages.length > 0 && messages[messages.length - 1]!.role === 'assistant') messages.pop();
  if (messages.length === 0) return state;
  return {
    ...state,
    messages: [...messages, { id: newId(), role: 'assistant', text: '', status: 'streaming' }],
  };
}

/** The answer being streamed: the last assistant message while its status is streaming. */
function updateStreaming(state: AssistantState, update: (m: ChatMessage) => ChatMessage): AssistantState {
  const i = state.messages.length - 1;
  const last = state.messages[i];
  if (!last || last.role !== 'assistant' || last.status !== 'streaming') return state;
  const messages = [...state.messages];
  messages[i] = update(last);
  return { ...state, messages };
}

function toChatError(err: unknown): ChatError {
  if (err instanceof ApiError) {
    return { status: err.status, code: err.code, message: err.message, details: err.details };
  }
  // No answer at all (fetch failed): status 0, shown as a network error.
  return { status: 0, code: 'network', message: err instanceof Error ? err.message : String(err) };
}

/** The error as localizeError takes it again: an ApiError, or a plain error when no answer came. */
export function fromChatError(error: ChatError): unknown {
  return error.status === 0
    ? new TypeError(error.message)
    : new ApiError(error.status, error.code, error.message, error.details);
}

/**
 * One event of the stream applied to the panel state (ai 9.3): text is appended, tool chips are updated
 * by id, console sources and proposals collected, notices noted; error drops the partial answer and keeps
 * the error, done finishes the answer.
 */
export function applySseEvent(state: AssistantState, event: AiSseEvent): AssistantState {
  switch (event.event) {
    case 'meta':
      return updateStreaming(state, (m) => ({
        ...m,
        meta: { model: event.data.model, demo: event.data.demo },
      }));
    case 'text':
      return updateStreaming(state, (m) => ({ ...m, text: m.text + event.data.text }));
    case 'tool':
      return updateStreaming(state, (m) => {
        const tools = [...(m.tools ?? [])];
        const i = tools.findIndex((chip) => chip.id === event.data.id);
        const chip = {
          id: event.data.id,
          name: event.data.name,
          status: event.data.status,
          live: event.data.live,
        };
        if (i === -1) tools.push(chip);
        else tools[i] = chip;
        return { ...m, tools };
      });
    case 'source':
      // Only console paths are ever links (ai 11.3); anything else is not shown as a source.
      if (!isConsolePath(event.data.path)) return state;
      return updateStreaming(state, (m) =>
        (m.sources ?? []).some((s) => s.path === event.data.path)
          ? m
          : { ...m, sources: [...(m.sources ?? []), { label: event.data.label, path: event.data.path }] },
      );
    case 'proposal':
      return updateStreaming(state, (m) => ({ ...m, proposals: [...(m.proposals ?? []), event.data] }));
    case 'notice':
      return updateStreaming(state, (m) =>
        event.data.kind === 'fallback'
          ? { ...m, fallback: true }
          : (m.notices ?? []).includes(event.data.kind)
            ? m
            : { ...m, notices: [...(m.notices ?? []), event.data.kind] },
      );
    case 'error':
      return updateStreaming(state, (m) => ({
        ...m,
        text: '',
        status: 'error',
        error: {
          status: event.data.status,
          code: event.data.code,
          message: event.data.message,
          details: event.data.details,
        },
      }));
    case 'done':
      return updateStreaming(state, (m) => ({
        ...m,
        status: 'done',
        fallback: m.fallback || event.data.fallback,
      }));
    default:
      return state;
  }
}

/** The request failed before or outside the stream (HTTP error, connection lost). */
export function failTurn(state: AssistantState, err: unknown): AssistantState {
  return updateStreaming(state, (m) => ({ ...m, text: '', status: 'error', error: toChatError(err) }));
}

/** Stopped by the person (stop button, closing the panel): the partial answer stays, marked as stopped. */
export function cancelTurn(state: AssistantState): AssistantState {
  return updateStreaming(state, (m) => ({ ...m, status: 'cancelled' }));
}

const isAbort = (err: unknown) =>
  (err instanceof DOMException && err.name === 'AbortError') ||
  (err instanceof Error && err.name === 'AbortError');

// --- Visibility ------------------------------------------------------------------------

/**
 * True inside an organization (/o/:slug/*) while the status is available with the assistant feature and the
 * person may use it (ai:use; staff also platform:ai:use). AppShell calls it before its early return, so it
 * only uses hooks that work without an organization and without data: the status is fetched only inside an
 * organization.
 */
export function useAiLauncherVisible(): boolean {
  const org = useOptionalOrg();
  const me = useCachedMe();
  const status = useAiStatus(!!org && !!me);
  if (!org) return false;
  return aiAllowed({
    status: status.data,
    feature: 'assistant',
    area: 'org',
    org: org.org,
    platformPermissions: me?.platformPermissions ?? [],
  });
}

// --- View ------------------------------------------------------------------------------

function ToolChip({ name, status }: { name: AiToolName; status: 'running' | 'done' | 'error' }) {
  const { t } = useI18n();
  const label = t(`ai.tool.${name}`);
  const title =
    status === 'running'
      ? t('ai.assistant.toolRunning', { tool: label })
      : status === 'error'
        ? t('ai.assistant.toolError', { tool: label })
        : label;
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
        status === 'error' ? 'border-danger/30 text-danger' : 'border-border text-muted',
      )}
    >
      {status === 'running' ? (
        <Loader2 className="size-3 animate-spin" aria-hidden />
      ) : status === 'error' ? (
        <CircleAlert className="size-3" aria-hidden />
      ) : (
        <Wrench className="size-3" aria-hidden />
      )}
      {label}
    </span>
  );
}

const NOTICE_KEYS = {
  tool_limit: 'ai.assistant.toolLimit',
  budget_stop: 'ai.assistant.budgetStop',
  incomplete: 'ai.assistant.incomplete',
} as const;

function AnswerView({
  message,
  last,
  confirming,
  onRetry,
  onApply,
  onConfirming,
}: {
  message: ChatMessage;
  last: boolean;
  confirming: string | null;
  onRetry: () => void;
  onApply: (proposal: AiDnsProposalDto) => void;
  onConfirming: (id: string | null) => void;
}) {
  const { t } = useI18n();
  if (message.status === 'error' && message.error) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger"
      >
        <p className="break-words">{aiErrorText(t, fromChatError(message.error))}</p>
        {last && (
          <button type="button" className="mt-1.5 font-medium underline underline-offset-2" onClick={onRetry}>
            {t('ai.assistant.retry')}
          </button>
        )}
      </div>
    );
  }
  const streaming = message.status === 'streaming';
  return (
    <div className="space-y-2">
      {message.text ? (
        <AiText text={message.text} />
      ) : streaming ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {t('ai.assistant.thinking')}
        </p>
      ) : null}
      {message.tools && message.tools.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {message.tools.map((chip) => (
            <ToolChip key={chip.id} name={chip.name} status={chip.status} />
          ))}
        </div>
      )}
      {message.proposals?.map((p) => (
        <ProposalCard
          key={p.id}
          proposal={p}
          onApply={onApply}
          confirming={confirming === p.id}
          onConfirmingChange={(on) => onConfirming(on ? p.id : null)}
        />
      ))}
      {message.sources && message.sources.length > 0 && (
        <div className="text-xs">
          <p className="font-medium text-muted">{t('ai.assistant.sources')}</p>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {message.sources.map((s) => (
              <li key={s.path}>
                <Link to={s.path} className="text-primary-text underline underline-offset-2">
                  {s.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {message.notices?.map((kind) =>
        kind in NOTICE_KEYS ? (
          <p key={kind} className="text-xs text-warning">
            {t(NOTICE_KEYS[kind as keyof typeof NOTICE_KEYS])}
          </p>
        ) : null,
      )}
      {message.fallback && <p className="text-xs text-muted">{t('ai.assistant.fallbackNote')}</p>}
      {message.status === 'cancelled' && <p className="text-xs text-muted">{t('ai.assistant.cancelled')}</p>}
      {message.status === 'done' && message.text && (
        <div className="flex justify-end">
          <CopyButton value={message.text} label={t('ai.assistant.copy')} />
        </div>
      )}
    </div>
  );
}

export interface AssistantPanelProps {
  state: AssistantState;
  model: AiModel | null;
  demo: boolean;
  input: string;
  onInput: (value: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onNewChat: () => void;
  onClose: () => void;
  onRetry: () => void;
  onApply: (proposal: AiDnsProposalDto) => void;
  onConfirming: (id: string | null) => void;
  inputRef?: Ref<HTMLTextAreaElement>;
  listRef?: Ref<HTMLDivElement>;
}

/** The panel from its state; AiAssistant wires it, the tests render it statically. */
export function AssistantPanel(props: AssistantPanelProps): JSX.Element {
  const { t } = useI18n();
  const { state, model, demo, input } = props;
  const running = state.messages.some((m) => m.status === 'streaming');
  const lastId = state.messages[state.messages.length - 1]?.id;
  const suggestions = [
    t('ai.assistant.suggestion.servers'),
    t('ai.assistant.suggestion.mail'),
    t('ai.assistant.suggestion.audit'),
  ];
  const keyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!running && input.trim()) props.onSend(input);
    }
  };
  return (
    <section
      role="dialog"
      aria-label={t('ai.assistant.title')}
      className="fixed inset-0 z-40 flex flex-col bg-surface shadow-pop sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[420px] sm:border-l sm:border-border"
      onKeyDown={(e) => {
        if (e.key === 'Escape') props.onClose();
      }}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Sparkles className="ml-1 size-4 shrink-0 text-primary-text" aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-text">
          {t('ai.assistant.title')}
        </h2>
        {demo && <DemoBadge />}
        <button
          type="button"
          className="inline-flex size-10 items-center justify-center rounded-lg text-muted hover:bg-surface-3 hover:text-text"
          aria-label={t('ai.assistant.newChat')}
          title={t('ai.assistant.newChat')}
          onClick={props.onNewChat}
        >
          <MessageSquarePlus className="size-5" aria-hidden />
        </button>
        <button
          type="button"
          className="inline-flex size-10 items-center justify-center rounded-lg text-muted hover:bg-surface-3 hover:text-text"
          aria-label={t('ai.assistant.close')}
          title={t('ai.assistant.close')}
          onClick={props.onClose}
        >
          <X className="size-5" aria-hidden />
        </button>
      </header>

      <div
        ref={props.listRef}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4"
        aria-live="polite"
      >
        {state.messages.length === 0 ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">{t('ai.assistant.empty')}</p>
            <div className="flex flex-col items-start gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="rounded-full border border-border px-3 py-1.5 text-left text-sm text-text hover:bg-surface-3"
                  onClick={() => props.onSend(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <p className="text-xs text-subtle">{t('ai.assistant.sessionHint')}</p>
            {state.messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary-soft px-3 py-2 text-sm break-words whitespace-pre-wrap text-text">
                    {m.text}
                  </p>
                </div>
              ) : (
                <AnswerView
                  key={m.id}
                  message={m}
                  last={m.id === lastId}
                  confirming={state.confirming}
                  onRetry={props.onRetry}
                  onApply={props.onApply}
                  onConfirming={props.onConfirming}
                />
              ),
            )}
          </>
        )}
      </div>

      <footer className="shrink-0 space-y-2 border-t border-border px-3 py-3">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!running && input.trim()) props.onSend(input);
          }}
        >
          <Textarea
            ref={props.inputRef}
            value={input}
            rows={2}
            maxLength={CHAT_USER_MAX}
            placeholder={t('ai.assistant.placeholder')}
            aria-label={t('ai.assistant.placeholder')}
            className="max-h-40 min-h-[44px] flex-1 resize-none"
            onChange={(e) => props.onInput(e.target.value)}
            onKeyDown={keyDown}
          />
          {running ? (
            <Button
              variant="secondary"
              className="size-10 justify-center px-0"
              aria-label={t('ai.assistant.stop')}
              title={t('ai.assistant.stop')}
              onClick={props.onStop}
            >
              <CircleStop className="size-5" aria-hidden />
            </Button>
          ) : (
            <Button
              type="submit"
              variant="primary"
              className="size-10 justify-center px-0"
              aria-label={t('ai.assistant.send')}
              title={t('ai.assistant.send')}
              disabled={!input.trim()}
            >
              <SendHorizontal className="size-5" aria-hidden />
            </Button>
          )}
        </form>
        {model && (
          <p className="text-xs text-subtle">{t('ai.assistant.model', { model: modelLabel(model) })}</p>
        )}
        <AiFootnote />
      </footer>
    </section>
  );
}

/** The launcher: a round button above the toasts on phones (bottom-20), in the corner from sm (ai 12.3). */
export function AssistantLauncher({ onOpen }: { onOpen: () => void }): JSX.Element {
  const { t } = useI18n();
  useEffect(() => showLauncher(), []);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t('ai.assistant.open')}
      title={t('ai.assistant.open')}
      className="fixed right-4 bottom-20 z-30 inline-flex size-12 items-center justify-center rounded-full bg-primary text-white shadow-pop hover:bg-primary-hover sm:right-6 sm:bottom-6"
    >
      <Sparkles className="size-5" aria-hidden />
    </button>
  );
}

const wide = () => {
  try {
    return window.matchMedia('(min-width: 640px)').matches;
  } catch {
    return true;
  }
};

function AssistantRoot({ orgId }: { orgId: string }): JSX.Element {
  const { locale } = useI18n();
  const location = useLocation();
  const status = useAiStatus();
  const applyProposal = useApplyProposal();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<AssistantState>(() => ({
    messages: loadAiChat(orgId),
    confirming: null,
  }));
  const [input, setInput] = useState('');
  const abort = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const running = state.messages.some((m) => m.status === 'streaming');

  // A streaming answer is stored once it ends; storing every text chunk would rewrite the whole chat.
  useEffect(() => {
    if (!running) saveAiChat(orgId, state.messages);
  }, [orgId, running, state.messages]);
  // Leaving the organization or signing out stops a running answer.
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [state.messages, open]);

  const stream = (next: AssistantState) => {
    const controller = new AbortController();
    abort.current = controller;
    streamAiChat(
      orgId,
      { messages: buildHistory(next.messages), locale },
      { signal: controller.signal, onEvent: (event) => setState((s) => applySseEvent(s, event)) },
    )
      // A stream that ends without done throws; reaching here means done was applied.
      .catch((err: unknown) => setState((s) => (isAbort(err) ? cancelTurn(s) : failTurn(s, err))))
      .finally(() => {
        if (abort.current === controller) abort.current = null;
      });
  };

  const send = (text: string) => {
    const question = text.trim().slice(0, CHAT_USER_MAX);
    if (!question || running) return;
    const page: AiPageRef = {
      path: location.pathname.slice(0, 300),
      title: document.title ? document.title.slice(0, 200) : null,
    };
    const next = startTurn(state, question, page);
    setState(next);
    setInput('');
    stream(next);
  };

  // The dashboard's "KI-Assistent fragen" and its suggestions (ai 12.5).
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    setAssistantListener((request) => {
      setOpen(true);
      if (request.question) sendRef.current(request.question);
    });
    return () => setAssistantListener(null);
  }, []);

  const close = () => {
    abort.current?.abort();
    setOpen(false);
  };

  if (!open) return <AssistantLauncher onOpen={() => setOpen(true)} />;
  const lastMeta = [...state.messages].reverse().find((m) => m.meta)?.meta ?? null;
  return (
    <AssistantPanel
      state={state}
      model={lastMeta?.model ?? status.data?.model ?? null}
      demo={lastMeta?.demo ?? status.data?.demo ?? false}
      input={input}
      onInput={setInput}
      onSend={send}
      onStop={() => abort.current?.abort()}
      onNewChat={() => {
        abort.current?.abort();
        setState({ messages: [], confirming: null });
      }}
      onClose={close}
      onRetry={() => {
        if (running) return;
        const next = retryTurn(state);
        if (next === state) return;
        setState(next);
        stream(next);
      }}
      onApply={(proposal) => {
        setState((s) => ({ ...s, confirming: null }));
        // Below sm the panel covers the page, so it closes; the chat stays.
        if (!wide()) setOpen(false);
        applyProposal(proposal);
      }}
      onConfirming={(id) => setState((s) => ({ ...s, confirming: id }))}
      inputRef={inputRef}
      listRef={listRef}
    />
  );
}

/** The assistant launcher and panel, rendered once by AppShell (plan F25); null outside an organization. */
export function AiAssistant(): JSX.Element | null {
  const visible = useAiLauncherVisible();
  const org = useOptionalOrg();
  if (!visible || !org) return null;
  // One chat per organization: switching the organization starts from its own stored chat.
  return <AssistantRoot key={org.org.id} orgId={org.org.id} />;
}
