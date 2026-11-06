import { useQuery } from '@tanstack/react-query';
import type {
  AdminOrgAiDto,
  AiAuditSummaryRequest,
  AiAuditSummaryResult,
  AiChatMessageInput,
  AiChatRequest,
  AiDnsCheckRequest,
  AiDnsCheckResult,
  AiDnsProposalDto,
  AiErrorDto,
  AiExplainRequest,
  AiExplainResult,
  AiFeature,
  AiKeyStatusDto,
  AiModel,
  AiNoticeKind,
  AiPageRef,
  AiProductTextsRequest,
  AiProductTextsResult,
  AiServerHealthRequest,
  AiServerHealthResult,
  AiSettingsDto,
  AiSettingsInput,
  AiSseEvent,
  AiStatusDto,
  AiTestResultDto,
  AiToolName,
  AiUsageReportDto,
  AiUsageStatus,
  OrgAiDto,
  Paginated,
  ResellerCustomerAiDto,
} from '@weblion/shared';
import { api, ApiError, apiErrorFromResponse, apiUrl, WRITE_HEADERS } from '@/lib/api';
import { localizeError } from '@/lib/api-errors';
import type { TFunction } from '@/lib/i18n';
import { useT } from '@/lib/i18n';
import { useApiMutation } from '@/lib/queries';
import { adminKeys } from '@/lib/api/admin';

/**
 * Query hooks and the chat stream of the AI module (ai 12.1). The switch hooks (organization card, admin
 * customer card, reseller customer card) are never gated by the AI status: a customer can decline before
 * the platform switch is on (plan O27). The feature hooks show no toast; their dialogs show the error with
 * aiErrorText (errorToast: false).
 */

export const aiKeys = {
  status: ['ai', 'status'] as const,
  settings: ['admin', 'ai', 'settings'] as const,
  usage: (month: string) => ['admin', 'ai', 'usage', month] as const,
  errors: (params: object) => ['admin', 'ai', 'errors', params] as const,
  org: (orgId: string) => ['ai', 'org', orgId] as const,
  adminOrg: (orgId: string) => ['admin', 'ai', 'org', orgId] as const,
  resellerCustomer: (resellerId: string, customerId: string) =>
    ['ai', 'reseller', resellerId, customerId] as const,
};

/** The text of an error of an AI request in the UI language: the one mapping of localizeError (plan O25). */
export function aiErrorText(t: TFunction, err: unknown): string {
  return localizeError(err, t);
}

// --- Status and settings ------------------------------------------------------------

/** GET /ai/status. `enabled` lets the assistant hook skip the request outside an organization. */
export const useAiStatus = (enabled = true) =>
  useQuery({
    queryKey: aiKeys.status,
    queryFn: () => api.get<AiStatusDto>('/ai/status'),
    staleTime: 60_000,
    enabled,
  });

/** The feature is switched on and AI is available (demo included). */
export function aiFeatureOn(status: AiStatusDto | undefined, feature: AiFeature): boolean {
  return !!status?.available && status.features.includes(feature);
}

export const useAdminAiSettings = () =>
  useQuery({
    queryKey: aiKeys.settings,
    queryFn: () => api.get<AiSettingsDto>('/admin/ai/settings'),
  });

/** Every write on the KI page also refreshes the status (feature buttons) and the integrations card. */
const settingsInvalidations = [aiKeys.settings, aiKeys.status, adminKeys.integrations];

export const useSaveAiSettings = (onSuccess?: (result: AiSettingsDto) => void) => {
  const t = useT();
  return useApiMutation((body: AiSettingsInput) => api.put<AiSettingsDto>('/admin/ai/settings', body), {
    success: t('common.saved'),
    invalidate: settingsInvalidations,
    onSuccess,
  });
};

export type AiKeySaved = AiKeyStatusDto & { demoOverridesDeleted: number };

/** gcTime 0: the variables hold the key, so the mutation is dropped as soon as nobody shows it. */
export const useSaveAiKey = (onSuccess?: (result: AiKeySaved) => void) => {
  const t = useT();
  return useApiMutation((body: { key: string }) => api.put<AiKeySaved>('/admin/ai/key', body), {
    success: (result) =>
      result.demoOverridesDeleted > 0
        ? `${t('admin.ai.key.saved')}. ${t('admin.ai.key.demoDeleted', { count: result.demoOverridesDeleted })}`
        : t('admin.ai.key.saved'),
    invalidate: settingsInvalidations,
    onSuccess,
    gcTime: 0,
    // The page shows the error at the field (ai_admin_key, wrong format).
    errorToast: false,
  });
};

export const useDeleteAiKey = (onSuccess?: () => void) => {
  const t = useT();
  return useApiMutation(() => api.del<AiKeyStatusDto>('/admin/ai/key'), {
    success: t('common.saved'),
    invalidate: settingsInvalidations,
    onSuccess,
  });
};

export const useTestAi = (onSuccess?: (result: AiTestResultDto) => void) =>
  useApiMutation(() => api.post<AiTestResultDto>('/admin/ai/test', {}), { onSuccess });

export const useAiUsage = (month: string) =>
  useQuery({
    queryKey: aiKeys.usage(month),
    queryFn: () => api.get<AiUsageReportDto>('/admin/ai/usage', { month }),
    placeholderData: (prev) => prev,
  });

export interface AiErrorsParams {
  page: number;
  perPage?: number;
  feature?: AiFeature;
  status?: AiUsageStatus;
  source?: 'api' | 'internal';
}

export const useAiErrors = (params: AiErrorsParams) =>
  useQuery({
    queryKey: aiKeys.errors(params),
    queryFn: () => api.get<Paginated<AiErrorDto>>('/admin/ai/errors', { perPage: 25, ...params }),
    placeholderData: (prev) => prev,
  });

// --- Switches (never gated by the AI status) ----------------------------------------

export const useOrgAi = (orgId: string, enabled = true) =>
  useQuery({
    queryKey: aiKeys.org(orgId),
    queryFn: () => api.get<OrgAiDto>(`/orgs/${orgId}/ai`),
    enabled: enabled && !!orgId,
  });

/** PUT /orgs/:orgId/ai/decline. Afterwards the organization (permissions) and the status change. */
export const useOrgAiDecline = (orgId: string) => {
  const t = useT();
  return useApiMutation((declined: boolean) => api.put<OrgAiDto>(`/orgs/${orgId}/ai/decline`, { declined }), {
    success: t('common.saved'),
    invalidate: [aiKeys.org(orgId), ['org'], aiKeys.status],
  });
};

export const useAdminOrgAi = (orgId: string, enabled = true) =>
  useQuery({
    queryKey: aiKeys.adminOrg(orgId),
    queryFn: () => api.get<AdminOrgAiDto>(`/admin/orgs/${orgId}/ai`),
    enabled: enabled && !!orgId,
  });

/** The body of both switch routes: switching on needs the confirmed consent of the customer (plan O34). */
export interface AiSwitchInput {
  enabled: boolean;
  consentConfirmed?: boolean;
}

export const useSetAdminOrgAi = (orgId: string, onSuccess?: () => void) => {
  const t = useT();
  return useApiMutation((body: AiSwitchInput) => api.put<AdminOrgAiDto>(`/admin/orgs/${orgId}/ai`, body), {
    success: t('common.saved'),
    invalidate: [aiKeys.adminOrg(orgId), ['org']],
    onSuccess,
    // The card and its consent dialog show the error (the 400 without consent, for example).
    errorToast: false,
  });
};

export const useResellerCustomerAi = (resellerId: string, customerId: string, enabled = true) =>
  useQuery({
    queryKey: aiKeys.resellerCustomer(resellerId, customerId),
    queryFn: () => api.get<ResellerCustomerAiDto>(`/orgs/${resellerId}/customers/${customerId}/ai`),
    enabled: enabled && !!resellerId && !!customerId,
  });

/** The card shows 409 ai_platform_locked and ai_reseller_blocked itself, so no toast. */
export const useSetResellerCustomerAi = (resellerId: string, customerId: string, onSuccess?: () => void) => {
  const t = useT();
  return useApiMutation(
    (body: AiSwitchInput) =>
      api.put<ResellerCustomerAiDto>(`/orgs/${resellerId}/customers/${customerId}/ai`, body),
    {
      success: t('common.saved'),
      invalidate: [aiKeys.resellerCustomer(resellerId, customerId), ['org']],
      onSuccess,
      errorToast: false,
    },
  );
};

// --- Features (no success toast; the dialogs show errors with aiErrorText) ----------

/** An organization's feature routes, or the admin area's (explain, audit summary, product texts). */
export type AiScope = { orgId: string } | 'admin';

const featurePath = (scope: AiScope, feature: string) =>
  scope === 'admin' ? `/admin/ai/${feature}` : `/orgs/${scope.orgId}/ai/${feature}`;

export const useAiExplain = (scope: AiScope) =>
  useApiMutation((body: AiExplainRequest) => api.post<AiExplainResult>(featurePath(scope, 'explain'), body), {
    errorToast: false,
  });

export const useAiDnsCheck = (orgId: string) =>
  useApiMutation(
    (body: AiDnsCheckRequest) => api.post<AiDnsCheckResult>(featurePath({ orgId }, 'dns-check'), body),
    { errorToast: false },
  );

export const useAiAuditSummary = (scope: AiScope) =>
  useApiMutation(
    (body: AiAuditSummaryRequest) =>
      api.post<AiAuditSummaryResult>(featurePath(scope, 'audit-summary'), body),
    { errorToast: false },
  );

export const useAiServerHealth = (orgId: string) =>
  useApiMutation(
    (body: AiServerHealthRequest) =>
      api.post<AiServerHealthResult>(featurePath({ orgId }, 'server-health'), body),
    { errorToast: false },
  );

export const useAiProductTexts = (scope: AiScope) =>
  useApiMutation(
    (body: AiProductTextsRequest) =>
      api.post<AiProductTextsResult>(featurePath(scope, 'product-texts'), body),
    { errorToast: false },
  );

// --- Chat --------------------------------------------------------------------------

export type ChatStatus = 'streaming' | 'done' | 'error' | 'cancelled';

export interface ChatToolChip {
  id: string;
  name: AiToolName;
  status: 'running' | 'done' | 'error';
  live: boolean;
}

/** The serializable part of an ApiError, kept on a failed answer (sessionStorage holds the chat). */
export interface ChatError {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

/** One message of the assistant panel (ai 12.3). The browser keeps it in sessionStorage per organization. */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status: ChatStatus;
  /** User messages: the page the person was on when sending it (sent with every turn, plan U4). */
  page?: AiPageRef | null;
  tools?: ChatToolChip[];
  sources?: Array<{ label: string; path: string }>;
  proposals?: AiDnsProposalDto[];
  notices?: AiNoticeKind[];
  /** A part of the answer came from Anthropic's fallback model (done.fallback). */
  fallback?: boolean;
  /** model and demo of the meta event. */
  meta?: { model: AiModel; demo: boolean } | null;
  error?: ChatError | null;
}

/** The API's limits (ai 9.2). */
export const CHAT_MAX_MESSAGES = 40;
export const CHAT_USER_MAX = 4000;
export const CHAT_ASSISTANT_MAX = 16_000;

/**
 * The history the server accepts (ai 9.2, review #20): no placeholders or failed answers, roles
 * alternating from a user message to the new question at the end, texts cut to the limits, at most 40
 * messages and never an assistant message first.
 */
export function buildHistory(messages: ChatMessage[]): AiChatMessageInput[] {
  // 1. Only finished answers with text count.
  const kept = messages.filter((m) =>
    m.role === 'assistant' ? m.status === 'done' && m.text.trim() !== '' : m.text.trim() !== '',
  );
  // 2. A question without an answer after it is dropped, unless it is the new question at the end.
  const alternating: ChatMessage[] = [];
  kept.forEach((m, i) => {
    if (m.role === 'user' && i < kept.length - 1 && kept[i + 1]!.role !== 'assistant') return;
    const prev = alternating[alternating.length - 1];
    // Two answers in a row cannot follow from step 2; if they ever do, the later one wins.
    if (prev && prev.role === m.role) alternating.pop();
    alternating.push(m);
  });
  // 3. Texts within the limits.
  const cut: AiChatMessageInput[] = alternating.map((m) =>
    m.role === 'user'
      ? { role: 'user', text: m.text.slice(0, CHAT_USER_MAX), page: m.page ?? null }
      : { role: 'assistant', text: m.text.slice(0, CHAT_ASSISTANT_MAX) },
  );
  // 4. The newest 40, starting with a question.
  const last = cut.slice(-CHAT_MAX_MESSAGES);
  if (last[0]?.role === 'assistant') last.shift();
  return last;
}

const SSE_EVENTS = new Set<AiSseEvent['event']>([
  'meta',
  'text',
  'tool',
  'source',
  'proposal',
  'notice',
  'error',
  'done',
]);

/**
 * One frame of the chat stream (the text between two blank lines). Comment lines (": ping") are ignored;
 * a frame of comments only, an unknown event or data that is not JSON gives null.
 */
export function parseSseFrame(frame: string): AiSseEvent | null {
  let event = 'message';
  const data: string[] = [];
  for (const raw of frame.split(/\r?\n/)) {
    if (raw === '' || raw.startsWith(':')) continue;
    const colon = raw.indexOf(':');
    const field = colon === -1 ? raw : raw.slice(0, colon);
    let value = colon === -1 ? '' : raw.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value.trim();
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0 || !SSE_EVENTS.has(event as AiSseEvent['event'])) return null;
  try {
    const parsed = JSON.parse(data.join('\n')) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    return { event, data: parsed } as AiSseEvent;
  } catch {
    return null;
  }
}

/** Thrown when the stream ends without done or error (connection lost, proxy cut it). */
const STREAM_CUT = 'The connection to the AI service ended before the answer was complete.';

/**
 * POST /orgs/:orgId/ai/chat and read the event stream (ai 12.1). Every event goes to onEvent; an error
 * event is thrown as ApiError afterwards, like a failed request() (localizeError handles both). Abort the
 * signal to stop: fetch and the reader then reject with an AbortError.
 */
export async function streamAiChat(
  orgId: string,
  body: AiChatRequest,
  opts: { signal: AbortSignal; onEvent: (event: AiSseEvent) => void },
): Promise<void> {
  const path = `/orgs/${orgId}/ai/chat`;
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { ...WRITE_HEADERS, Accept: 'text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok) throw await apiErrorFromResponse(res, path);
  if (!res.body) throw new ApiError(502, 'ai_upstream', STREAM_CUT, { reason: 'network' });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  const handle = (frame: string) => {
    const event = parseSseFrame(frame);
    if (!event) return;
    opts.onEvent(event);
    if (event.event === 'error') {
      const { status, code, message, details } = event.data;
      throw new ApiError(status, code, message, details);
    }
    if (event.event === 'done') finished = true;
  };
  try {
    while (!finished) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let end = buffer.indexOf('\n\n');
      while (end !== -1 && !finished) {
        handle(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        end = buffer.indexOf('\n\n');
      }
    }
    if (!finished) {
      buffer += decoder.decode();
      if (buffer.trim()) handle(buffer);
    }
  } finally {
    // Nothing more is read after done or an error; free the connection.
    reader.cancel().catch(() => {});
  }
  if (!finished) throw new ApiError(502, 'ai_upstream', STREAM_CUT, { reason: 'network' });
}
