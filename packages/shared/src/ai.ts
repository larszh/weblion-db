import type { PolicyStatement } from './policy';
import type { Locale } from './i18n/locales';

/**
 * Vocabulary of the AI module (Claude): models, features, prices, availability, switches, usage, errors and
 * the request and result shapes of the features (ai 3.1, plan 2.3). U3 may only add to this file.
 */

// --- Models ------------------------------------------------------------------------------------

export const AI_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const;
export type AiModel = (typeof AI_MODELS)[number];
export const AI_DEFAULT_MODEL: AiModel = 'claude-opus-5-5';

export function isAiModel(value: string): value is AiModel {
  return (AI_MODELS as readonly string[]).includes(value);
}

/** Opus and Sonnet get `fallbacks: 'default'`; Haiku has no server-side fallback. */
export function hasRefusalFallback(model: AiModel): boolean {
  return model !== 'claude-haiku-5-5';
}

// --- Features ----------------------------------------------------------------------------------

export const AI_FEATURES = [
  'assistant',
  'explain',
  'dns_check',
  'audit_summary',
  'server_health',
  'product_texts',
  'translations',
] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export function isAiFeature(value: string): value is AiFeature {
  return (AI_FEATURES as readonly string[]).includes(value);
}

export type AiEffort = 'low' | 'medium';
/** Fixed per feature so the prompt cache stays warm (plan decision 30). */
export const AI_FEATURE_EFFORT: Record<AiFeature, AiEffort> = {
  assistant: 'medium',
  explain: 'low',
  dns_check: 'medium',
  audit_summary: 'low',
  server_health: 'medium',
  product_texts: 'low',
  translations: 'medium',
};

// --- Prices ------------------------------------------------------------------------------------

/** USD per million tokens. */
export interface AiPrice {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}
export const AI_PRICES: Record<AiModel, AiPrice & { longContext?: AiPrice & { above: number } }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  'claude-haiku-5-5': {
    input: 0.1,
    output: 0.5,
    cacheWrite: 0.125,
    cacheRead: 0.01,
    longContext: { above: 100_000, input: 0.5, output: 2.5, cacheWrite: 0.625, cacheRead: 0.05 },
  },
};
/** A model outside AI_MODELS can only be a server-side fallback target (ai 2.3). */
export const AI_UNLISTED_PRICE_FACTOR = 1.25;

/** Token counts as the Claude API reports them; iterations optional (fallbacks, ai 6.7). */
export interface AiUsageTokens {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  iterations?: Array<{
    type: string; // 'message' | 'fallback_message'; others are ignored
    model?: string | null;
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  }> | null;
}

// Prices are kept as thousandths of a micro-USD per token (every listed price times 1,000 is an integer), so
// the sum is exact and the one rounding at the end never sees a floating point remainder.
const PRICE_SCALE = 1000;
// Listed models count 4 quarters, unlisted ones 5 quarters (AI_UNLISTED_PRICE_FACTOR = 5 / 4).
const LISTED_QUARTERS = 4;
const UNLISTED_QUARTERS = Math.round(AI_UNLISTED_PRICE_FACTOR * LISTED_QUARTERS);

type Counts = Pick<
  AiUsageTokens,
  'input_tokens' | 'output_tokens' | 'cache_read_input_tokens' | 'cache_creation_input_tokens'
>;

/** Cost of one priced unit in thousandths of a micro-USD times quarters (integer). */
function scaledCost(model: string, counts: Counts, fallbackModel: AiModel): number {
  const listed = isAiModel(model);
  const prices = AI_PRICES[listed ? model : fallbackModel];
  const cacheRead = counts.cache_read_input_tokens ?? 0;
  const cacheWrite = counts.cache_creation_input_tokens ?? 0;
  const long = prices.longContext;
  const price: AiPrice = long && counts.input_tokens + cacheRead + cacheWrite > long.above ? long : prices;
  const scaled = (p: number) => Math.round(p * PRICE_SCALE);
  const sum =
    counts.input_tokens * scaled(price.input) +
    counts.output_tokens * scaled(price.output) +
    cacheRead * scaled(price.cacheRead) +
    cacheWrite * scaled(price.cacheWrite);
  return sum * (listed ? LISTED_QUARTERS : UNLISTED_QUARTERS);
}

/**
 * Cost in micro-USD (1 USD = 1,000,000), rounded up once per call. `model` is the requested model or a
 * served model id; an id outside AI_MODELS is priced at `fallbackModel` x AI_UNLISTED_PRICE_FACTOR. With
 * `iterations`, every entry of type 'message' or 'fallback_message' is priced on its own (an entry without
 * `model` is the requested model) and the top-level counts are ignored.
 */
export function aiCostMicros(model: string, usage: AiUsageTokens, fallbackModel: AiModel): number {
  let total = 0;
  if (usage.iterations && usage.iterations.length > 0) {
    for (const it of usage.iterations) {
      if (it.type !== 'message' && it.type !== 'fallback_message') continue;
      total += scaledCost(it.model ?? model, it, fallbackModel);
    }
  } else {
    total = scaledCost(model, usage, fallbackModel);
  }
  const divisor = PRICE_SCALE * LISTED_QUARTERS;
  const rest = total % divisor;
  return (total - rest) / divisor + (rest > 0 ? 1 : 0);
}

// --- Availability and status -------------------------------------------------------------------

export type AiUnavailableReason = 'disabled' | 'not_configured' | 'feature_off';
/** ctx.ai.availability(feature) and GET /ai/status (plan O5). */
export interface AiAvailabilityDto {
  available: boolean;
  /** Why not; null when available. Order: disabled > not_configured > feature_off. */
  reason: AiUnavailableReason | null;
  /** No key, ENABLE_DEMO_PROVIDER=true: answers come from the emulator (ai 14). */
  demo: boolean;
  model: AiModel;
}
export interface AiStatusDto extends AiAvailabilityDto {
  /** Features switched on (empty while the master switch is off). */
  features: AiFeature[];
}
/** IntegrationsDto.ai (ai 5.3). configured is true for ui, env and demo. */
export interface AiIntegrationDto {
  configured: boolean;
  source: 'ui' | 'env' | 'demo' | 'none';
  enabled: boolean;
  model: AiModel;
}

// --- Access ------------------------------------------------------------------------------------

/**
 * Appended to every organization's effective boundary (ai 3.4): denies `ai:use` while the organization is
 * switched off (AI is opt-in per customer, plan O34) or has declined. `ai:settings` is never denied here, so a
 * customer can always see the card and withdraw a decline.
 */
export function aiDenyStatements(org: {
  aiEnabled: boolean;
  aiOptOutAt: Date | string | null;
}): PolicyStatement[] {
  if (org.aiEnabled && !org.aiOptOutAt) return [];
  return [{ sid: 'AiNotAllowed', effect: 'deny', actions: ['ai:use'] }];
}

/** Who switched AI off for an organization. */
export type AiSwitchedOffBy = 'platform' | 'reseller';
/** Why AI is off for one organization, most binding first. */
export type AiOrgOffReason = 'declined' | 'platform' | 'reseller' | 'parent';

// --- Settings (KI page) ------------------------------------------------------------------------

/** The go-live checklist of the master switch (ai 5.1, 16). No announcement date: AI is opt-in (plan O34). */
export interface AiGoLiveDto {
  contracts: boolean; // sub-processor list in AGB/AVV
  transferBasis: boolean; // legal basis for the US transfer
  noticeChecked: boolean; // notice sentence checked against Anthropic's terms
  workspaceChecked: boolean; // workspace location checked
  confirmedAt: string | null;
  confirmedBy: { id: string; name: string } | null;
}
export interface AiSettingsDto {
  enabled: boolean;
  model: AiModel;
  features: Record<AiFeature, boolean>;
  budgetUsd: number;
  warnPercent: number;
  dailyOrgLimit: number;
  dailyUserLimit: number;
  key: AiKeyStatusDto;
  demo: boolean;
  status: AiAvailabilityDto;
  budget: AiBudgetDto;
  notice: { checkedAt: string | null; checkedBy: { id: string; name: string } | null };
  goLive: AiGoLiveDto | null;
}
/** PUT /admin/ai/settings. `goLive` is required when `enabled` changes from false to true (ai 5.1). */
export interface AiSettingsInput {
  enabled: boolean;
  model: AiModel;
  features: Record<AiFeature, boolean>;
  budgetUsd: number; // 0 ... 100,000
  warnPercent: number; // 10 ... 99
  dailyOrgLimit: number; // 1 ... 10,000
  dailyUserLimit: number; // 1 ... 10,000
  noticeChecked?: boolean; // true marks the notice as checked now
  goLive?: Omit<AiGoLiveDto, 'confirmedAt' | 'confirmedBy'>;
}
export interface AiKeyStatusDto {
  /** ui: saved on the KI page (wins); env: ANTHROPIC_API_KEY; none. Never the key itself. */
  source: 'ui' | 'env' | 'none';
  savedAt: string | null;
  savedBy: { id: string; name: string } | null;
  /** ANTHROPIC_API_KEY is set as well (shown as the fallback after a delete). */
  envSet: boolean;
}
export interface AiTestResultDto {
  ok: boolean;
  model: AiModel;
  demo: boolean;
  latencyMs: number;
  reason: AiUpstreamReason | AiBusyReason | 'timeout' | null;
}
export interface AiBudgetDto {
  month: string; // YYYY-MM, Europe/Zurich
  budgetMicros: number;
  spentMicros: number;
  reservedMicros: number;
  remainingMicros: number;
  percent: number; // spent / budget, rounded down
  warned: boolean;
  exhausted: boolean;
}

// --- Usage and errors (staff) ------------------------------------------------------------------

export const AI_USAGE_STATUSES = [
  'running',
  'ok',
  'refusal',
  'incomplete',
  'error',
  'cancelled',
  'stale',
] as const;
export type AiUsageStatus = (typeof AI_USAGE_STATUSES)[number];
export type AiUsageScope = 'org' | 'staff' | 'platform';
export interface AiUsageReportDto {
  month: string;
  budget: AiBudgetDto;
  totals: AiUsageTotalsDto;
  byFeature: Array<{ feature: AiFeature } & AiUsageTotalsDto>;
  byModel: Array<{ model: string } & AiUsageTotalsDto>;
  /** Top 50 by cost; org null = platform requests without customer data. */
  byOrg: Array<{ org: { id: string; name: string } | null; staffRequests: number } & AiUsageTotalsDto>;
  byDay: Array<{ date: string } & AiUsageTotalsDto>;
}
export interface AiUsageTotalsDto {
  requests: number;
  apiCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costMicros: number;
}
export interface AiErrorDto {
  id: string;
  createdAt: string;
  feature: AiFeature;
  scope: AiUsageScope;
  org: { id: string; name: string } | null;
  user: { id: string; name: string } | null;
  model: AiModel;
  servedModel: string | null;
  status: AiUsageStatus;
  errorCode: string | null;
  errorReason: string | null;
  /** Redacted original message, staff only, null after 30 days. */
  errorMessage: string | null;
  requestId: string | null;
  durationMs: number | null;
}

// --- Errors (ai 4.2, plan 2.10; arrays so the web test can iterate them) -----------------------

export const AI_ERROR_CODES = [
  'ai_limit',
  'ai_refusal',
  'ai_upstream',
  'ai_incomplete',
  'ai_busy',
  'ai_timeout',
  'ai_org_disabled',
  'ai_platform_locked',
  'ai_reseller_blocked',
  'ai_decline_org_only',
  'ai_admin_key',
  'ai_not_configured',
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export const AI_LIMIT_KINDS = [
  'budget', // monthly budget used up
  'org_daily', // requests per organization and day
  'user_daily', // requests per person and day
  'user_rate', // 12 per person and minute
  'user_concurrent', // 2 at a time per person
  'org_concurrent', // 3 at a time per organization
  'concurrent', // 6 at a time on the platform
] as const;
export type AiLimitKind = (typeof AI_LIMIT_KINDS)[number];

export const AI_UPSTREAM_REASONS = [
  'auth', // 401: key invalid or revoked
  'permission', // 403: key lacks access
  'billing', // 402 or billing_error: Anthropic account
  'not_found', // 404: model not available to the account
  'request', // 400, 413, 422: request rejected
  'server', // 500, api_error
  'network', // connection failed
  'output', // answer not valid JSON or not matching the schema
] as const;
export type AiUpstreamReason = (typeof AI_UPSTREAM_REASONS)[number];

export type AiBusyReason = 'overloaded' | 'rate_limit';

// --- Organization switches (ai 5.5) ------------------------------------------------------------

export interface AiOrgStateDto {
  /** AI may be used on this organization's data right now (platform state aside). */
  enabled: boolean;
  offReasons: AiOrgOffReason[];
  switch: { enabled: boolean; by: AiSwitchedOffBy | null };
  /** The reseller's own state, null without a reseller. */
  reseller: { id: string; name: string; enabled: boolean } | null;
  declined: { at: string; by: { id: string; name: string } | null } | null;
}
/** GET /orgs/:orgId/ai (ai:settings). Counts, never costs. */
export interface OrgAiDto extends AiOrgStateDto {
  platform: AiAvailabilityDto;
  usage: { month: string; requests: number; staffRequests: number };
}
/** GET /admin/orgs/:orgId/ai (platform:org:read). */
export interface AdminOrgAiDto extends OrgAiDto {
  usageCostMicros: number;
}
/** GET /orgs/:resellerId/customers/:customerId/ai (reseller:customer:read). Counts, never costs. */
export type ResellerCustomerAiDto = OrgAiDto;

// --- Chat (ai 9) -------------------------------------------------------------------------------

export interface AiPageRef {
  path: string; // console path, starts with "/"
  title: string | null;
}
export interface AiChatMessageInput {
  role: 'user' | 'assistant';
  text: string;
  /** Only on user messages: the page the person was on when sending it. */
  page?: AiPageRef | null;
}
export interface AiChatRequest {
  messages: AiChatMessageInput[];
  locale: Locale;
}
export const AI_TOOL_NAMES = [
  'get_org_overview',
  'list_servers',
  'get_server',
  'get_server_metrics',
  'get_server_activity',
  'list_domains',
  'get_domain',
  'get_dns_records',
  'list_websites',
  'get_website',
  'check_website_dns',
  'list_mail_domains',
  'get_mail_domain',
  'get_mail_dns_setup',
  'get_monitoring',
  'get_monitor',
  'get_cloud_storage',
  'get_phone_systems',
  'get_streaming',
  'get_billing_summary',
  'get_audit_log',
  'propose_dns_record',
] as const;
export type AiToolName = (typeof AI_TOOL_NAMES)[number];
export type AiNoticeKind = 'tool_limit' | 'budget_stop' | 'incomplete' | 'fallback';
export type AiSseEvent =
  | { event: 'meta'; data: { model: AiModel; demo: boolean } }
  | { event: 'text'; data: { text: string } }
  | {
      event: 'tool';
      data: { id: string; name: AiToolName; status: 'running' | 'done' | 'error'; live: boolean };
    }
  | { event: 'source'; data: { label: string; path: string } }
  | { event: 'proposal'; data: AiDnsProposalDto }
  | { event: 'notice'; data: { kind: AiNoticeKind } }
  | { event: 'error'; data: { status: number; code: string; message: string; details?: unknown } }
  | { event: 'done'; data: { servedModel: string; fallback: boolean } };

// --- Features (ai 10) --------------------------------------------------------------------------

export type AiExplainSource =
  | {
      kind: 'error';
      error: { status: number; code: string; message: string; details?: unknown };
      page: AiPageRef;
    }
  | { kind: 'audit'; auditId: string }
  | { kind: 'server_action'; serverId: string; actionId: string }
  | { kind: 'monitor'; monitorId: string }
  | { kind: 'website'; websiteId: string }
  | { kind: 'provider'; providerId: string } // admin only
  | { kind: 'mail_log'; mailLogId: string }; // admin only
export interface AiExplainRequest {
  source: AiExplainSource;
  locale: Locale;
}
export type AiSeverity = 'info' | 'warning' | 'error';
export interface AiExplainResult {
  summary: string;
  cause: string;
  steps: string[];
  links: Array<{ label: string; path: string }>;
  severity: AiSeverity;
  meta: AiResultMeta;
}
/** Every feature result carries this (footnote, demo badge, model badge). */
export interface AiResultMeta {
  model: AiModel;
  servedModel: string;
  demo: boolean;
}

export const AI_DNS_TOPICS = ['mx', 'spf', 'dkim', 'dmarc', 'autoconfig', 'website', 'caa', 'other'] as const;
export type AiDnsTopic = (typeof AI_DNS_TOPICS)[number];
export type AiCheckStatus = 'ok' | 'warning' | 'problem';
export interface AiDnsCheckRequest {
  /** Exactly one of the two. */
  domainId: string | null;
  mailDomainId: string | null;
  locale: Locale;
}
export interface AiDnsProposalDto {
  id: string; // random, per answer
  domainId: string | null; // null: zone not in the console (textOnly)
  zone: string;
  action: 'add' | 'change';
  recordId: string | null; // for 'change'
  type: 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'SRV' | 'CAA';
  name: string; // relative to the zone, "@" for the apex
  data: string; // console format (DnsRecord)
  ttl: number | null;
  reason: string;
  /** Equal to a record the console computed itself (mail DNS setup or website A/AAAA). */
  verified: boolean;
  /** Cannot be opened as a form here (zone elsewhere, no domain:dns:write, type not supported). */
  textOnly: boolean;
}
export interface AiDnsCheckResult {
  zone: string;
  overall: AiCheckStatus;
  topics: Array<{ topic: AiDnsTopic; status: AiCheckStatus; finding: string; proposalIds: string[] }>;
  proposals: AiDnsProposalDto[];
  /** Proposals the model made that failed validation and were dropped. */
  droppedProposals: number;
  meta: AiResultMeta;
}

export type AiAuditPeriod = 'day' | 'week' | 'month';
export interface AiAuditSummaryRequest {
  period: AiAuditPeriod;
  action: string | null;
  resourceType: string | null;
  status: 'success' | 'failure' | 'denied' | null;
  /** Admin only: one organization, null = all. */
  orgId?: string | null;
  locale: Locale;
}
export interface AiAuditSummaryResult {
  summary: string;
  highlights: Array<{ text: string; auditIds: string[] }>;
  unusual: Array<{ text: string; auditIds: string[] }>;
  entries: number;
  /** More entries than the 500 sent. */
  cut: boolean;
  /** Entries left out because the organization they concern has AI off. */
  hidden: number;
  meta: AiResultMeta;
}

export type AiHealthStatus = 'ok' | 'watch' | 'problem';
export const AI_HEALTH_METRICS = [
  'cpu',
  'memory',
  'disk',
  'network',
  'traffic',
  'backups',
  'uptime',
] as const;
export type AiHealthMetric = (typeof AI_HEALTH_METRICS)[number];
export interface AiServerHealthRequest {
  serverId: string;
  range: 'day' | 'week';
  locale: Locale;
}
export interface AiServerHealthResult {
  overall: AiHealthStatus;
  summary: string;
  metrics: Array<{ metric: AiHealthMetric; status: AiHealthStatus; finding: string }>;
  recommendations: string[];
  meta: AiResultMeta;
}

export interface AiProductTextsRequest {
  mode: 'write' | 'translate';
  name: string;
  description: string | null;
  module: string | null;
  interval: string | null;
  notes: string | null;
  /** write: the languages to write (incl. de); translate: target languages only. */
  locales: Locale[];
  locale: Locale;
}
export interface AiProductTextsResult {
  texts: Partial<Record<Locale, { name: string; description: string | null }>>;
  meta: AiResultMeta;
}
