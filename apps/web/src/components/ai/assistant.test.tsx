import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  interpolate,
  type AiDnsProposalDto,
  type AiSseEvent,
  type AiStatusDto,
  type MeDto,
  type OrgDto,
  type Permission,
} from '@weblion/shared';
import { en } from '@weblion/shared/i18n/en';
import type { TFunction } from '@/lib/i18n';
import { localizeError } from '@/lib/api-errors';
import { OrgProvider } from '@/lib/org-context';
import { qk } from '@/lib/queries';
import { aiKeys, buildHistory } from '@/lib/api/ai';
import { withI18n } from '@/test/i18n';
import {
  AiAssistant,
  applySseEvent,
  AssistantPanel,
  cancelTurn,
  EMPTY_ASSISTANT,
  failTurn,
  fromChatError,
  retryTurn,
  startTurn,
  type AssistantState,
} from './assistant';
import { AI_CHAT_STORAGE_PREFIX, clearAiChats, loadAiChat, saveAiChat } from './storage';

/** React's escaping of text in markup, for comparing translated texts. */
const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
const tEn: TFunction = (key, params) => interpolate(en[key], params);

const status: AiStatusDto = {
  available: true,
  reason: null,
  demo: false,
  model: 'claude-opus-5-5',
  features: ['assistant', 'explain', 'dns_check'],
};

function me(platformPermissions: Permission[] = []): MeDto {
  return {
    user: {
      id: 'u1',
      email: 'anna@muster.example',
      name: 'Anna Muster',
      platformRole: null,
      mfaEnabled: false,
      locale: 'en',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastLoginAt: null,
    },
    memberships: [],
    platformPermissions,
  };
}

function org(permissions: Permission[], access: OrgDto['access'] = 'member'): OrgDto {
  return {
    id: 'org-1',
    name: 'Muster AG',
    slug: 'muster',
    kind: 'customer',
    status: 'active',
    suspendedBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    permissions,
    role: 'viewer',
    modules: [],
    parent: null,
    access,
  };
}

/** AiAssistant as AppShell renders it: with the session, the status and (inside /o/) the organization. */
function renderAssistant(opts: { org?: OrgDto | null; status?: AiStatusDto; me?: MeDto }) {
  const qc = new QueryClient();
  qc.setQueryData(qk.me, opts.me ?? me());
  qc.setQueryData(aiKeys.status, opts.status ?? status);
  const inner = <AiAssistant />;
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[opts.org ? '/o/muster' : '/admin']}>
        {withI18n(opts.org ? <OrgProvider org={opts.org}>{inner}</OrgProvider> : inner)}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('assistant visibility (ai 12.3)', () => {
  it('shows the launcher inside an organization with ai:use, above the toasts on phones', () => {
    const html = renderAssistant({ org: org(['ai:use']) });
    expect(html).toContain(`aria-label="${esc(en['ai.assistant.open'])}"`);
    expect(html).toContain('bottom-20');
    expect(html).toContain('sm:bottom-6');
    expect(html).toContain('right-4');
    expect(html).toContain('sm:right-6');
  });

  it('is hidden without ai:use, outside an organization and without the assistant feature', () => {
    expect(renderAssistant({ org: org(['server:read'] as Permission[]) })).toBe('');
    expect(renderAssistant({ org: null })).toBe('');
    expect(renderAssistant({ org: org(['ai:use']), status: { ...status, features: ['explain'] } })).toBe('');
    expect(
      renderAssistant({ org: org(['ai:use']), status: { ...status, available: false, reason: 'disabled' } }),
    ).toBe('');
  });

  it('needs platform:ai:use for staff inside a customer', () => {
    expect(renderAssistant({ org: org(['ai:use'], 'staff') })).toBe('');
    expect(
      renderAssistant({ org: org(['ai:use'], 'staff'), me: me(['platform:access', 'platform:ai:use']) }),
    ).not.toBe('');
  });
});

const proposal: AiDnsProposalDto = {
  id: 'p1',
  domainId: 'd1',
  zone: 'muster.example',
  action: 'add',
  recordId: null,
  type: 'MX',
  name: '@',
  data: '10 mx.attacker.example',
  ttl: 3600,
  reason: 'Der MX-Eintrag fehlt.',
  verified: false,
  textOnly: false,
};

/** A scripted turn as the API streams it (ai 9.3). */
const script: AiSseEvent[] = [
  { event: 'meta', data: { model: 'claude-opus-5-5', demo: true } },
  { event: 'tool', data: { id: 't1', name: 'get_org_overview', status: 'running', live: false } },
  { event: 'tool', data: { id: 't1', name: 'get_org_overview', status: 'done', live: false } },
  { event: 'tool', data: { id: 't2', name: 'list_servers', status: 'error', live: true } },
  { event: 'text', data: { text: 'Ihre Organisation hat **3 Server**. ' } },
  { event: 'text', data: { text: 'Der MX fehlt.' } },
  { event: 'source', data: { label: 'Server', path: '/o/muster/servers' } },
  { event: 'source', data: { label: 'Fremd', path: 'https://evil.example' } },
  { event: 'proposal', data: proposal },
  { event: 'notice', data: { kind: 'tool_limit' } },
  { event: 'done', data: { servedModel: 'claude-opus-5-5', fallback: true } },
];

const page = { path: '/o/muster', title: 'Muster AG' };

function panel(state: AssistantState, demo = false) {
  return renderToStaticMarkup(
    <MemoryRouter>
      {withI18n(
        <AssistantPanel
          state={state}
          model="claude-opus-5-5"
          demo={demo}
          input=""
          onInput={() => {}}
          onSend={() => {}}
          onStop={() => {}}
          onNewChat={() => {}}
          onClose={() => {}}
          onRetry={() => {}}
          onApply={() => {}}
          onConfirming={() => {}}
        />,
      )}
    </MemoryRouter>,
  );
}

describe('applySseEvent and the panel (ai 12.3, plan 2.9)', () => {
  const run = (events: AiSseEvent[], from = startTurn(EMPTY_ASSISTANT, 'Wie geht es?', page)) =>
    events.reduce(applySseEvent, from);

  it('builds the answer: text, tool chips by id, console sources only, the proposal, notices', () => {
    const state = run(script);
    const answer = state.messages[1]!;
    expect(answer.status).toBe('done');
    expect(answer.text).toBe('Ihre Organisation hat **3 Server**. Der MX fehlt.');
    expect(answer.tools).toEqual([
      { id: 't1', name: 'get_org_overview', status: 'done', live: false },
      { id: 't2', name: 'list_servers', status: 'error', live: true },
    ]);
    expect(answer.sources).toEqual([{ label: 'Server', path: '/o/muster/servers' }]);
    expect(answer.proposals).toEqual([proposal]);
    expect(answer.notices).toEqual(['tool_limit']);
    expect(answer.fallback).toBe(true);
    expect(answer.meta).toEqual({ model: 'claude-opus-5-5', demo: true });
  });

  it('renders tool chips, the source, the proposal with the unverified badge and the notes', () => {
    const html = panel(run(script), true);
    expect(html).toContain(esc(en['ai.tool.get_org_overview']));
    expect(html).toContain(esc(en['ai.tool.list_servers']));
    expect(html).toContain(
      `title="${esc(tEn('ai.assistant.toolError', { tool: en['ai.tool.list_servers'] }))}"`,
    );
    expect(html).toContain('<strong class="font-semibold">3 Server</strong>');
    expect(html).toContain(esc(en['ai.assistant.sources']));
    expect(html).toContain('href="/o/muster/servers"');
    expect(html).not.toContain('evil.example');
    expect(html).toContain(esc(en['ai.proposal.unverified']));
    expect(html).toContain('10 mx.attacker.example');
    expect(html).toContain(esc(en['ai.proposal.apply']));
    expect(html).toContain(esc(en['ai.assistant.toolLimit']));
    expect(html).toContain(esc(en['ai.assistant.fallbackNote']));
    expect(html).toContain(esc(en['ai.demoBadge']));
    expect(html).toContain(esc(en['ai.assistant.sessionHint']));
    expect(html).toContain(esc(tEn('ai.assistant.model', { model: 'Claude Opus 5.5' })));
    expect(html).toContain(esc(en['ai.footnote']));
    // The extra confirmation is closed until the person asks to apply.
    expect(html).not.toContain(esc(en['ai.proposal.unverifiedConfirm.title']));
  });

  it('renders the confirmation of an unverified proposal open from state', () => {
    const html = panel({ ...run(script), confirming: 'p1' });
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain(esc(en['ai.proposal.unverifiedConfirm.title']));
    expect(html).toContain(esc(en['ai.proposal.unverifiedConfirm.text']));
    expect(html).toContain(esc(en['ai.proposal.unverifiedConfirm.action']));
    // While it asks, the apply button is replaced by the confirmation.
    expect(html).not.toContain(`>${esc(en['ai.proposal.apply'])}<`);
  });

  it('a verified proposal applies without asking; a textOnly one can only be copied', () => {
    const verified = run([
      { event: 'meta', data: { model: 'claude-opus-5-5', demo: false } },
      { event: 'proposal', data: { ...proposal, id: 'p2', verified: true, data: '10 mail.weblion.example' } },
      { event: 'proposal', data: { ...proposal, id: 'p3', textOnly: true, domainId: null } },
      { event: 'done', data: { servedModel: 'claude-opus-5-5', fallback: false } },
    ]);
    const html = panel(verified);
    expect(html).toContain(esc(en['ai.proposal.verified']));
    expect(html).toContain(esc(en['ai.proposal.textOnly']));
    expect(html).toContain(`aria-label="${esc(en['ai.proposal.copy'])}"`);
  });

  it('an error event drops the partial answer and shows the error text with a retry', () => {
    const errorEvent: AiSseEvent = {
      event: 'error',
      data: {
        status: 429,
        code: 'ai_limit',
        message: 'Monthly AI budget used up.',
        details: { limit: 'budget' },
      },
    };
    const state = run([...script.slice(0, 6), errorEvent]);
    const answer = state.messages[1]!;
    expect(answer.status).toBe('error');
    expect(answer.text).toBe('');
    const html = panel(state);
    expect(html).not.toContain('Ihre Organisation hat');
    expect(html).toContain(esc(localizeError(fromChatError(answer.error!), tEn)));
    expect(html).toContain(esc(en['ai.assistant.retry']));
    // The failed answer and its question are not sent again; a new question follows the last good turn.
    expect(buildHistory(startTurn(state, 'Nochmals', page).messages).map((m) => m.text)).toEqual([
      'Nochmals',
    ]);
  });

  it('a failed request and a stop keep the history valid; retry starts a new placeholder', () => {
    const failed = failTurn(startTurn(EMPTY_ASSISTANT, 'Frage', page), new TypeError('Failed to fetch'));
    expect(failed.messages[1]).toMatchObject({ status: 'error', error: { status: 0, code: 'network' } });
    const retried = retryTurn(failed);
    expect(retried.messages.map((m) => [m.role, m.status])).toEqual([
      ['user', 'done'],
      ['assistant', 'streaming'],
    ]);
    expect(buildHistory(retried.messages).map((m) => m.text)).toEqual(['Frage']);

    const stopped = cancelTurn(applySseEvent(startTurn(EMPTY_ASSISTANT, 'Frage', page), script[4]!));
    expect(stopped.messages[1]).toMatchObject({
      status: 'cancelled',
      text: 'Ihre Organisation hat **3 Server**. ',
    });
    expect(panel(stopped)).toContain(esc(en['ai.assistant.cancelled']));
  });

  it('events after the end of a turn change nothing', () => {
    const done = run(script);
    expect(applySseEvent(done, { event: 'text', data: { text: 'spät' } })).toBe(done);
  });

  it('the empty chat shows the hint and three suggestions', () => {
    const html = panel(EMPTY_ASSISTANT);
    expect(html).toContain(esc(en['ai.assistant.empty']));
    expect(html).toContain(esc(en['ai.assistant.suggestion.servers']));
    expect(html).toContain(esc(en['ai.assistant.suggestion.mail']));
    expect(html).toContain(esc(en['ai.assistant.suggestion.audit']));
    // Header icon buttons with labels and a 40 px hit area (fits at 390 px).
    expect(html).toContain(`aria-label="${esc(en['ai.assistant.newChat'])}"`);
    expect(html).toContain(`aria-label="${esc(en['ai.assistant.close'])}"`);
    expect(html.match(/size-10/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

describe('chat storage (ai 12.3)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubSession(store = new Map<string, string>()) {
    vi.stubGlobal('sessionStorage', {
      get length() {
        return store.size;
      },
      key: (i: number) => [...store.keys()][i] ?? null,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    return store;
  }

  it('keeps each organization in its own key, marks a streaming answer as stopped, keeps 40', () => {
    const store = stubSession();
    const state = startTurn(EMPTY_ASSISTANT, 'Frage', page);
    saveAiChat('org-1', state.messages);
    expect([...store.keys()]).toEqual([`${AI_CHAT_STORAGE_PREFIX}org-1`]);
    expect(loadAiChat('org-1').map((m) => m.status)).toEqual(['done', 'cancelled']);
    expect(loadAiChat('org-2')).toEqual([]);

    const many = Array.from({ length: 30 }, () => startTurn(EMPTY_ASSISTANT, 'x', page).messages).flat();
    saveAiChat('org-1', many);
    expect(loadAiChat('org-1')).toHaveLength(40);
    saveAiChat('org-1', []);
    expect(store.size).toBe(0);
  });

  it('clearAiChats empties every chat; broken or missing storage gives an empty chat', () => {
    const store = stubSession(
      new Map([
        [`${AI_CHAT_STORAGE_PREFIX}org-1`, '[]'],
        [`${AI_CHAT_STORAGE_PREFIX}org-2`, 'not json'],
        ['wl-locale', 'de'],
      ]),
    );
    expect(loadAiChat('org-2')).toEqual([]);
    clearAiChats();
    expect([...store.keys()]).toEqual(['wl-locale']);
    vi.stubGlobal('sessionStorage', undefined);
    expect(loadAiChat('org-1')).toEqual([]);
    expect(() => saveAiChat('org-1', [])).not.toThrow();
  });
});
