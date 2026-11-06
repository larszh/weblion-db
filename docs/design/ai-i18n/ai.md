# AI module design (Claude): KI-Modul for weblion.one

Regenerated on 06.11.2026 after the container restart, from `plan.md` (sections 0, 1, 5 to 11) and
`summaries.md` (reports "ai", "review" and "revised"), checked against the code at `c6c51ad`. Cited by the plan as
"ai x.y". Where this document and `plan.md` disagree, `plan.md` wins; the shared contracts of plan section 2
(`contracts.md`) win over the copies given here for convenience (3.1, 4.2, 6.9).

Conventions: identifiers and comments in English, UI copy in German (formal "Sie", Swiss spelling with "ss") and
English, no em dash anywhere. Model ids appear only as `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`.
SDK: `@anthropic-ai/sdk` exactly `1.3.0` (plan O19); every type name below was checked against the published
tarball (`src/resources/beta/messages/messages.ts`, `src/core/error.ts`, `src/client.ts`).

Contents

1. Overview
2. Models and costs
3. Shared vocabulary and access
4. Errors
5. Settings and switches
6. Calling Claude
7. Budget and limits
8. Read-only tools
9. Chat API and SSE
10. Features
11. Safety
12. Web
13. Texts
14. Demo mode
15. Tests
16. Go-live checklist
17. Contract with the i18n design

---

## 1. Overview

### 1.1 The seven features

| # | Feature (`AiFeature`) | Who | What it does | Section |
|---|---|---|---|---|
| 1 | `assistant` | members with `ai:use`, staff inside a customer | Chat panel with 21 read-only tools and DNS proposals | 8, 9, 12.3 |
| 2 | `explain` | members, staff | Explains an error toast, error box, audit row, failed server action, monitor, website, provider error, mail log entry | 10.1 |
| 3 | `dns_check` | members, staff | DNS and e-mail check of one domain with checked or unchecked record proposals | 10.2 |
| 4 | `audit_summary` | members with `audit:read`, staff | Summary of a period of the audit log, personal data removed | 10.3 |
| 5 | `server_health` | members with `server:metrics`, staff | Assessment of one server from metrics, monitoring, traffic and recent actions | 10.4 |
| 6 | `product_texts` | staff (`platform:billing:write`), resellers (`reseller:billing`) | Product name and description written or translated in five languages | 10.6 |
| 7 | `translations` | superadmins (`platform:i18n:write` + `platform:ai:use`) | Mass Translate jobs and single-row suggestions of the translation admin (i18n 12) | 6.6, 17 |

Removed in the review (plan O31): the staff customer briefing `customer_summary` (10.5) and monitor proposals from
the assistant `propose_monitor` (8.4).

### 1.2 What the AI never does

- It never writes. The tool layer (8) can only call an allowlist of existing `GET` routes in-process with the
  user's own session; there is no tool that creates, changes, deletes, restarts or orders anything.
- Proposals (a DNS record, product texts) only pre-fill the existing form (`DnsRecordDialog` in
  `apps/web/src/pages/hosting/domain-dns.tsx:524`, `ProductDialog` in `apps/web/src/pages/billing/products.tsx:65`).
  The person saves through the normal route with the normal permission check and audit entry.
- It never offers deleting MX, NS or apex A/AAAA records (8.4).
- It never sees another organization's data: every resource read by id is checked against the organization of
  the request first, and fails closed (8.1).
- It never stores prompts or answers. `ai_usage` holds metadata only (7.1); the chat lives in the browser tab.
- It never switches to another model by itself. Anthropic's server-side refusal fallback (2.3) is the only
  case in which another model answers, and it is marked.

### 1.3 Go-live summary

- Production: the master switch is off until the owner turns it on on the KI page. Turning it on asks for the
  go-live checklist (16): sub-processor list in AGB/AVV, legal basis for the US transfer, the notice sentence on
  training and retention checked against Anthropic's terms, the workspace location, and the announcement mail to
  every organization owner at least 30 days earlier (with its date).
- With `ENABLE_DEMO_PROVIDER=true` and no key the module runs in demo mode (14) and the master switch starts on.
- Every organization is on by default (migration default `true`, plan decision 16). Staff and the customer's
  reseller can switch a customer off; a reseller switched off caps all its customers; the customer can decline
  in its own settings at any time, before go-live and while suspended, and that also blocks staff features.

### 1.4 Data notice summary

The notice is the translation key `ai.notice.text` (title `ai.notice.title`, texts in 13.10). It says that
Anthropic PBC (USA) is a sub-processor, which data is sent, that weblion staff can use AI on the organization's
data, that known secrets plus IP and e-mail addresses are removed before sending (and that this detection is
automatic and not perfect), that names in audit entries can be included, that Anthropic's use and retention
follow its commercial terms (the sentence the owner checks before go-live, 16), that the console stores no
prompts or answers, that the AI only reads, and where to decline. It does not claim that passwords are never
sent. It is editable per language in Verwaltung > Übersetzungen, never machine-translated, and never shown
outdated (`LEGAL_KEYS`, i18n 8.1, plan O28).

---

## 2. Models and costs

### 2.1 Models

```ts
export const AI_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const;
export const AI_DEFAULT_MODEL: AiModel = 'claude-opus-5-5';
```

- One model for all seven features, chosen on the KI page by the owner only (`PUT /admin/ai/settings`, permission
  `platform:settings`, which only superadmins have). Default `claude-opus-5-5`.
- The ids are sent exactly as listed, never with a date suffix (review grep in plan 8.3).
- All three models: adaptive thinking (`thinking: { type: 'adaptive' }`, the only accepted on-mode on these
  models; `disabled` and `budget_tokens` are rejected), `output_config.effort` set per feature (6.2), structured
  outputs, strict tools, 1M context, 128K output. Forced `tool_choice` (`any`, `tool`) is rejected on Opus 5.5 and
  Sonnet 5.5, so the module uses `auto` everywhere (6.3).
- Effort is fixed per feature (plan decision 30) so the prompt cache stays warm: a change of effort invalidates
  the messages cache.

### 2.2 Prices

USD per million tokens, first-party Claude API, from the claude-api skill's model table (cached 2026-10-06). The
owner rechecks them on Anthropic's pricing page before go-live (16, item 7); a change is a code change in
`packages/shared/src/ai.ts`.

| Model | Input | Output | Cache write (5 min) | Cache read | Note |
|---|---|---|---|---|---|
| `claude-opus-5-5` | 4.00 | 20.00 | 5.00 | 0.20 | default |
| `claude-sonnet-5-5` | 2.00 | 10.00 | 2.50 | 0.20 | |
| `claude-haiku-5-5` | 0.10 | 0.50 | 0.125 | 0.01 | prompts above 100,000 tokens: 0.50 / 2.50 / 0.625 / 0.05 |

Cache writes are 1.25 x input (5-minute TTL, the only TTL the module uses); cache reads are 0.05 x input on Opus 5.5
and 0.1 x elsewhere. The KI page shows input and output prices next to each model (12.2). Worked examples: 6.7.

### 2.3 Refusal fallback

- Opus 5.5 and Sonnet 5.5 run safety classifiers that can decline a request (HTTP 200, `stop_reason: 'refusal'`,
  `stop_details.category`). On these two models every request sends `betas: ['server-side-fallback-2026-07-01']`
  and `fallbacks: 'default'`, so Anthropic re-runs a declined request on its recommended fallback model inside the
  same call (plan decision 18).
- Haiku 5.5 has no server-side fallback: the module sends neither the beta nor `fallbacks` there; a refusal is
  answered with 422 `ai_refusal`.
- A fallback is visible as a `fallback` content block (`BetaFallbackBlock`, switch point) and as a
  `fallback_message` entry in `usage.iterations` (`BetaFallbackMessageIterationUsage`, served-by signal). The
  module records the served model (`ai_usage.served_model`), prices every iteration on its own (6.7) and the chat
  shows `ai.assistant.fallbackNote`.
- The fallback models are not part of `AI_MODELS` and are never chosen by the console. They are priced
  conservatively at the requested model's price times `AI_UNLISTED_PRICE_FACTOR = 1.25` (today's fallback targets
  of the Opus line cost USD 5 / 25, which this covers; Sonnet's target costs the same as Sonnet 5.5).

---

## 3. Shared vocabulary and access

### 3.1 `packages/shared/src/ai.ts`

Exported from the package index (plan F4). Imports locales from `./i18n/locales` (plan O1) and `PolicyStatement`
from `./policy`. U3 may only add to it (plan 11).

```ts
import type { PolicyStatement } from './policy';
import type { Locale, TargetLocale } from './i18n/locales';

// --- Models ------------------------------------------------------------------------------------

export const AI_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const;
export type AiModel = (typeof AI_MODELS)[number];
export const AI_DEFAULT_MODEL: AiModel = 'claude-opus-5-5';
export function isAiModel(value: string): value is AiModel;
/** Opus and Sonnet get `fallbacks: 'default'`; Haiku has no server-side fallback. */
export function hasRefusalFallback(model: AiModel): boolean;

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
export function isAiFeature(value: string): value is AiFeature;
export type AiEffort = 'low' | 'medium';
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
/** A model outside AI_MODELS can only be a server-side fallback target (2.3). */
export const AI_UNLISTED_PRICE_FACTOR = 1.25;

/** Token counts as the Claude API reports them; iterations optional (fallbacks, 6.7). */
export interface AiUsageTokens {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  iterations?: Array<{
    type: string; // 'message' | 'fallback_message' | others are ignored
    model?: string | null;
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  }> | null;
}

/**
 * Cost in micro-USD (1 USD = 1,000,000), rounded up once per call. `model` is the requested model or a
 * served model id; an id outside AI_MODELS is priced at `fallbackModel` x AI_UNLISTED_PRICE_FACTOR. With
 * `iterations`, every entry of type 'message' or 'fallback_message' is priced on its own (an entry without
 * `model` is the requested model) and the top-level counts are ignored.
 */
export function aiCostMicros(model: string, usage: AiUsageTokens, fallbackModel: AiModel): number;

// --- Availability and status -------------------------------------------------------------------

export type AiUnavailableReason = 'disabled' | 'not_configured' | 'feature_off';
/** ctx.ai.availability(feature) and GET /ai/status (plan O5). */
export interface AiAvailabilityDto {
  available: boolean;
  /** Why not; null when available. Order: disabled > not_configured > feature_off. */
  reason: AiUnavailableReason | null;
  /** No key, ENABLE_DEMO_PROVIDER=true: answers come from the emulator (14). */
  demo: boolean;
  model: AiModel;
}
export interface AiStatusDto extends AiAvailabilityDto {
  /** Features switched on (empty while the master switch is off). */
  features: AiFeature[];
}

// --- Access ------------------------------------------------------------------------------------

/** Appended to every organization's effective boundary (3.4). `ai:settings` is never denied here. */
export function aiDenyStatements(org: { aiEnabled: boolean; aiOptOutAt: Date | string | null }): PolicyStatement[];

/** Who switched AI off for an organization. */
export type AiSwitchedOffBy = 'platform' | 'reseller';
/** Why AI is off for one organization, most binding first. */
export type AiOrgOffReason = 'declined' | 'platform' | 'reseller' | 'parent';

// --- Settings (KI page) ------------------------------------------------------------------------

export interface AiGoLiveDto {
  contracts: boolean; // sub-processor list in AGB/AVV
  transferBasis: boolean; // legal basis for the US transfer
  noticeChecked: boolean; // notice sentence checked against Anthropic's terms
  workspaceChecked: boolean; // workspace location checked
  announcedOn: string; // YYYY-MM-DD, at least 30 days before switching on
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
/** PUT /admin/ai/settings. `goLive` is required when `enabled` changes from false to true (5.1). */
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

export const AI_USAGE_STATUSES = ['running', 'ok', 'refusal', 'incomplete', 'error', 'cancelled', 'stale'] as const;
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

// --- Organization switches (5.5) ---------------------------------------------------------------

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

// --- Chat (9) ----------------------------------------------------------------------------------

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
  | { event: 'tool'; data: { id: string; name: AiToolName; status: 'running' | 'done' | 'error'; live: boolean } }
  | { event: 'source'; data: { label: string; path: string } }
  | { event: 'proposal'; data: AiDnsProposalDto }
  | { event: 'notice'; data: { kind: AiNoticeKind } }
  | { event: 'error'; data: { status: number; code: string; message: string; details?: unknown } }
  | { event: 'done'; data: { servedModel: string; fallback: boolean } };

// --- Features (10) -----------------------------------------------------------------------------

export type AiExplainSource =
  | { kind: 'error'; error: { status: number; code: string; message: string; details?: unknown }; page: AiPageRef }
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
export const AI_HEALTH_METRICS = ['cpu', 'memory', 'disk', 'network', 'traffic', 'backups', 'uptime'] as const;
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
```

`ProductTranslations` lives in `packages/shared/src/billing.ts` keyed by `TargetLocale` (plan O14), not here.

Test cases of `packages/shared/src/ai.test.ts` (plan F6):

1. `AI_MODELS` is exactly the three ids in this order; `AI_DEFAULT_MODEL === 'claude-opus-5-5'`; `isAiModel` rejects
   `''`, `'claude-opus'`, an id with a date suffix and `'gpt-4o'`.
2. `hasRefusalFallback`: true for Opus and Sonnet, false for Haiku.
3. `AI_FEATURES` has seven entries; `AI_FEATURE_EFFORT` is `medium` for assistant, dns_check, server_health,
   translations and `low` for the other three (plan decision 30).
4. `aiCostMicros` per model for one million tokens of each kind: Opus 4,000,000 / 20,000,000 / 5,000,000 (cache
   write) / 200,000 (cache read); Sonnet 2,000,000 / 10,000,000 / 2,500,000 / 200,000; Haiku 100,000 / 500,000 /
   125,000 / 10,000.
5. Haiku long context: 150,000 input tokens cost 75,000 (0.50 per million, the whole call priced at the long-context
   rate because input plus cache tokens exceed 100,000); 100,000 input tokens cost 10,000.
6. Rounding: one Haiku output token costs 1 (0.5 rounded up); zero tokens cost 0.
7. Unlisted model: `aiCostMicros('x-unlisted', { input_tokens: 1_000_000, output_tokens: 0 }, 'claude-opus-5-5')`
   is 5,000,000.
8. Iterations: `[{ type: 'message', model: null, input_tokens: 1000, output_tokens: 0 }, { type: 'fallback_message',
   model: 'x-unlisted', input_tokens: 1000, output_tokens: 500 }]` with requested Opus costs 4,000 + 5,000 + 12,500
   = 21,500; the top-level counts of the same object are ignored; an entry of another type (`compaction`) is ignored.
9. `aiDenyStatements({ aiEnabled: true, aiOptOutAt: null })` is `[]`; off or opted out gives exactly one deny
   statement with `actions: ['ai:use']`; `ai:settings` never appears.
10. `AI_TOOL_NAMES` has 22 unique entries, `propose_dns_record` last.

### 3.2 Permissions

New entries in `packages/shared/src/permissions.ts` (plan F5; labels become keys `perm.<action>` in section `core`,
plan O3). New group `'ai'` in `PermissionGroup` and in `PERMISSION_GROUPS` after `'monitoring'`; its label key is
`perm.group.ai`.

| Action | Group | Flags | de | en |
|---|---|---|---|---|
| `ai:use` | `ai` | | KI-Funktionen verwenden | Use AI features |
| `ai:settings` | `ai` | | KI-Funktionen für die Organisation ablehnen oder erlauben | Decline or allow AI features for the organization |
| `platform:ai:use` | `platform` | `platform: true` | KI-Funktionen in der Verwaltung verwenden | Use AI features in the admin area |

Role grants (`packages/shared/src/roles.ts`):

| Role | `ai:use` | `ai:settings` | `platform:ai:use` | How |
|---|---|---|---|---|
| owner | yes | yes | | `*` (`ORG_ROLE_POLICIES.owner`) |
| admin | yes | yes | | `*` minus `AdminNoOrgDelete` (unchanged) |
| member | yes | no | | add `'ai:use'` to `MemberOperate` |
| viewer | yes | no | | add `'ai:use'` to `ReadOnly` (plan decision 20) |
| restricted ("Eingeschränkt") | no | no | | unchanged; grantable by a custom policy |
| billing ("Buchhaltung") | no | no | | unchanged; grantable by a custom policy |
| superadmin | yes | yes | yes | `*` |
| support | yes | no | yes | add `'ai:use'`, `'platform:ai:use'` to `SupportRead` (with `'platform:i18n:read'`, i18n 11) |

API tokens: `TOKEN_SCOPE_POLICIES.read` gets nothing new; `read_write` covers the actions through `*`, but every AI
route calls `requireSession` (`apps/api/src/auth/access.ts:44`), because the tool layer needs the session cookie
(8.1). `DEFAULT_CUSTOMER_BOUNDARY` and `DEFAULT_RESELLER_BOUNDARY` allow both org actions through `*`;
`platform:ai:use` is denied there by `platform:*` like every platform action.

### 3.3 `'ai:settings'` in `SUSPENDED_ALLOWED`

`apps/api/src/auth/access.ts:35` becomes:

```ts
/**
 * What stays available while an organization is suspended: reading, paying its own bills, and
 * declining AI. Staff features ignore suspension (staff may still run AI on the organization's data),
 * so a suspended customer must still be able to decline it (ai:settings).
 */
const SUSPENDED_ALLOWED = [...READ_ONLY, 'billing:*', 'reseller:customer:access', 'ai:settings'];
```

`ai:use` is not in it: members of a suspended organization cannot use AI (test in plan F9). The reseller variant
at `access.ts:100` (`effectiveBoundary(parent, READ_ONLY)`) stays without `ai:settings`: reseller staff of a
suspended reseller only read.

### 3.4 `aiDenyStatements(org)` in `effectiveBoundary`

```ts
export function aiDenyStatements(org: { aiEnabled: boolean; aiOptOutAt: Date | string | null }): PolicyStatement[] {
  if (org.aiEnabled && !org.aiOptOutAt) return [];
  return [{ sid: 'AiNotAllowed', effect: 'deny', actions: ['ai:use'] }];
}
```

`apps/api/src/auth/access.ts:164-170`:

```ts
export function effectiveBoundary(
  org: Pick<Organization, 'boundary' | 'status' | 'modules' | 'aiEnabled' | 'aiOptOutAt'>,
  suspendedAllowed: string[] = SUSPENDED_ALLOWED,
): PolicyStatement[] {
  const base = org.status === 'suspended' ? suspendedBoundary(org.boundary, suspendedAllowed) : org.boundary;
  return [...base, ...moduleDenyStatements(org.modules), ...aiDenyStatements(org)];
}
```

What this covers, through the existing engine (`packages/shared/src/access.ts:37-83`):

- **Organization switched off** (`ai_enabled = false`, by staff or by its reseller): the organization's boundary
  denies `ai:use` for its members and for reseller staff working inside it (`withinBoundaries`).
- **The customer's own decline** (`ai_opt_out_at` set): same deny, independent of the switch.
- **Reseller cascade**: `AccessService.subject` puts the reseller's `effectiveBoundary(parent)` into
  `parentBoundary` (`access.ts:84`), so a reseller that is switched off or declined denies `ai:use` in every
  customer below it, for the customers' members and for its own staff.
- **`ai:settings` stays allowed** in all three cases, so the customer can always see the card and withdraw its
  decline.
- **Platform staff** pass `can()` through `PLATFORM_ROLE_POLICIES` before any boundary (`access.ts:55`). The
  boundary therefore never stops staff features; `ctx.ai.assertOrgData(orgId)` does (5.5, 6.9), with the same
  three conditions.

---
## 4. Errors

All errors are `AppError` (`apps/api/src/lib/errors.ts:1`) and reach the client as `ApiErrorBody`
(`{ error: { code, message, details } }`) through the existing error handler (`apps/api/src/app.ts:116-133`). In the
chat, errors after the stream opened are SSE `error` events with the same fields plus `status` (9.3).

### 4.1 Status mapping

| Status | When | Code |
|---|---|---|
| 404 | Master switch off, no key (and no demo), or the feature switched off: `ctx.ai.assertFeature(feature)` on every AI feature and chat route. Indistinguishable from a missing route on purpose ("nothing is shown when off"). | `not_found` (existing `notFound('AI feature')`) |
| 404 | A resource id that the caller cannot see, or that belongs to another organization (8.1) | `not_found` |
| 403 | AI is off for the organization the data belongs to: switched off by staff or reseller, declined by the customer, or capped by the reseller | `ai_org_disabled` |
| 403 | Missing permission (`ai:use`, `audit:read`, `platform:ai:use`, ...) | `forbidden` (existing) |
| 400 | Validation; an Admin API key on `PUT /admin/ai/key` | `bad_request`, `ai_admin_key` |
| 409 | Reseller cases on the customer switch: the reseller tries to switch on a customer that weblion switched off; the reseller's own AI is off | `ai_platform_locked`, `ai_reseller_blocked` |
| 409 | i18n AI routes only (plan O5, O10): AI not available | `ai_not_configured` |
| 422 | Claude declined (`stop_reason: 'refusal'`, after the server-side fallback where there is one) | `ai_refusal` |
| 429 | A limit of 7.1: monthly budget, daily limits, rate, concurrency | `ai_limit` |
| 502 | The Claude API failed or answered unusably; the answer was cut off at `max_tokens` after the retry | `ai_upstream`, `ai_incomplete` |
| 503 | Claude is overloaded or rate limits weblion's account | `ai_busy` |
| 504 | The request timed out (`AI_TURN_TIMEOUT_SECONDS` or the SDK timeout) | `ai_timeout` |

The 404 for "not available" applies to AI routes only. The switch cards (5.5) and the KI page routes never call
`assertFeature` and work in every platform state (plan O27). The i18n AI routes turn "not available" into 409
`ai_not_configured` with `details: { reason }` (plan O5).

### 4.2 Codes, helpers and messages

`apps/api/src/modules/ai/errors.ts` exports one helper per code and `AI_ERROR_MESSAGES`, the fixed English
messages. Messages never contain Anthropic's own error text: that text can reveal the state of weblion's Anthropic
account (credit, limits, workspace) and is kept, redacted, only in `ai_usage.error_message` for the staff errors
tab (7.3). The web translates every code (plan O25, O32); the key column names the key `localizeError` uses
(`apps/web/src/lib/api-errors.ts`, U2).

| Code | Status | Helper | `details` | Message (fixed English) | Web key |
|---|---|---|---|---|---|
| `ai_limit` | 429 | `aiLimit(limit, extra?)` | `{ limit: AiLimitKind, retryAfterSeconds: number \| null, resetsAt: string \| null }` | per kind, below | `ai.error.limit.<kind>` |
| `ai_refusal` | 422 | `aiRefusal(category)` | `{ category: string \| null }` | Claude declined to answer this request. | `ai.error.refusal` |
| `ai_upstream` | 502 | `aiUpstream(reason)` | `{ reason: AiUpstreamReason }` | The AI service could not process the request. | `ai.error.upstream` |
| `ai_incomplete` | 502 | `aiIncomplete()` | none | The AI answer was cut off. Please try again with a shorter request. | `ai.error.incomplete` |
| `ai_busy` | 503 | `aiBusy(reason)` | `{ reason: AiBusyReason, retryAfterSeconds: number \| null }` | The AI service is busy. Please try again in a moment. | `ai.error.busy` |
| `ai_timeout` | 504 | `aiTimeout()` | none | The AI answer took too long. | `ai.error.timeout` |
| `ai_org_disabled` | 403 | `aiOrgDisabled(reasons)` | `{ reasons: AiOrgOffReason[] }` | AI features are switched off for this organization. | `ai.error.orgDisabled` |
| `ai_platform_locked` | 409 | `aiPlatformLocked()` | none | weblion switched AI off for this customer. Only weblion staff can switch it on again. | `ai.error.platformLocked` |
| `ai_reseller_blocked` | 409 | `aiResellerBlocked()` | none | AI is switched off for your own organization, so it cannot be switched on for a customer. | `ai.error.resellerBlocked` |
| `ai_admin_key` | 400 | `aiAdminKey()` | none | This is an Admin API key. Save a normal API key from the Claude Console. | `ai.error.adminKey` |
| `ai_not_configured` | 409 | `aiNotConfigured(reason)` (used by i18n routes) | `{ reason: AiUnavailableReason }` | AI is not available. Set it up under Administration > AI. | `ai.error.notConfigured` |

```ts
export type AiLimitKind =
  | 'budget' // monthly budget used up
  | 'org_daily' // requests per organization and day
  | 'user_daily' // requests per person and day
  | 'user_rate' // 12 per person and minute
  | 'user_concurrent' // 2 at a time per person
  | 'org_concurrent' // 3 at a time per organization
  | 'concurrent'; // 6 at a time on the platform
export type AiUpstreamReason =
  | 'auth' // 401: key invalid or revoked
  | 'permission' // 403: key lacks access
  | 'billing' // 402 or billing_error: Anthropic account
  | 'not_found' // 404: model not available to the account
  | 'request' // 400, 413, 422: request rejected
  | 'server' // 500, api_error
  | 'network' // connection failed
  | 'output'; // answer not valid JSON or not matching the schema
export type AiBusyReason = 'overloaded' | 'rate_limit';
```

`ai_limit` messages (`AI_LIMIT_MESSAGES`):

| Kind | Message |
|---|---|
| `budget` | The monthly AI budget is used up. AI features are available again next month. |
| `org_daily` | This organization reached its daily limit of AI requests. |
| `user_daily` | You reached your daily limit of AI requests. |
| `user_rate` | Too many AI requests in a short time. Please wait a minute. |
| `user_concurrent` | You already have two AI requests running. Please wait until one is finished. |
| `org_concurrent` | This organization already has three AI requests running. Please try again shortly. |
| `concurrent` | Too many AI requests are running at the moment. Please try again shortly. |

`retryAfterSeconds` and `resetsAt`: `user_rate` until the oldest of the last 12 requests leaves the minute;
`org_daily` and `user_daily` until midnight Europe/Zurich; `budget` until the first day of the next month
(`resetsAt` only); the concurrency kinds 5 seconds. 429 answers also carry `Retry-After` when the value is known.

---

## 5. Settings and switches

### 5.1 Settings rows

Stored in the `settings` table (`apps/api/src/db/schema.ts:949`) like the SMTP settings, read through
`apps/api/src/modules/ai/settings.ts`. Plan section 3 (`contracts.md`) is binding for the key names.

| Key | Value | Notes |
|---|---|---|
| `ai` | `StoredAiSettings` (plain JSON, no secret) | Missing row = defaults |
| `ai_key` | `{ enc: string }`, `box.encryptJson({ key, savedAt, savedBy })` | 5.2 |
| `ai_budget_notice` | `{ month: 'YYYY-MM', warnedAt: string \| null, exhaustedAt: string \| null }` | 7.2 |

```ts
interface StoredAiSettings {
  enabled: boolean; // master switch
  model: AiModel;
  features: Partial<Record<AiFeature, boolean>>; // missing = true
  budgetUsd: number;
  warnPercent: number;
  dailyOrgLimit: number;
  dailyUserLimit: number;
  notice: { checkedAt: string; checkedBy: string } | null; // data notice acknowledgement
  goLive: (Omit<AiGoLiveDto, 'confirmedBy'> & { confirmedBy: string | null }) | null;
}
```

| Setting | Default | Range | Plan |
|---|---|---|---|
| `enabled` | `env.ENABLE_DEMO_PROVIDER` (off in production, on with the demo provider) | | decision 15 |
| `model` | `claude-opus-5-5` | `AI_MODELS` | decision 18 |
| `features.<f>` | `true` for all seven | | |
| `budgetUsd` | 100 | 0 to 100,000 (0 blocks every request) | decision 19 |
| `warnPercent` | 80 | 10 to 99 | decision 19 |
| `dailyOrgLimit` | 200 | 1 to 10,000 | decision 19 |
| `dailyUserLimit` | 50 | 1 to 10,000 | decision 19 |

Fixed constants (`AI_LIMITS` in `modules/ai/usage.ts`, shown read-only on the KI page): 12 requests per person
and minute, 2 at a time per person, 3 per organization, 6 on the platform, 30 live reads per organization and
minute, per-turn caps of 6.4.

**Data notice acknowledgement.** `PUT /admin/ai/settings` with `noticeChecked: true` stores `notice = { checkedAt:
now, checkedBy: userId }`. The KI page shows "Geprüft am ... von ...". A change of the German `ai.notice.text`
later does not reset it; the go-live checklist asks again (`goLive.noticeChecked`).

**Go-live checklist.** When `enabled` changes from `false` to `true` and demo mode is off, the body must carry
`goLive` with `contracts`, `transferBasis`, `noticeChecked` and `workspaceChecked` all `true` and `announcedOn` a
date at least 30 days before today (Europe/Zurich) and not in the future. Otherwise 400 `bad_request` with the
failing field in `details` (zod issues). The stored `goLive` gets `confirmedAt` and `confirmedBy`; the audit entry
`ai.settings_update` carries `{ enabled: { from: false, to: true }, goLive: { announcedOn, ...flags } }`. The dialog
asks every time the switch goes from off to on, pre-filled with the stored values. In demo mode `goLive` is
optional.

### 5.2 The key

- **Storage.** `settings` row `ai_key`, the whole value encrypted with `SecretBox` (`apps/api/src/lib/crypto.ts:20`)
  exactly like `saveSmtpConfig` (`apps/api/src/mail/settings.ts:74-80`). Functions in `modules/ai/settings.ts`:
  `storedAiKey(db, box): Promise<{ key: string; savedAt: string; savedBy: string | null } | null>` (null when the
  row is missing or cannot be decrypted after an `ENCRYPTION_KEY` change, like `storedSmtpConfig`), `saveAiKey(tx,
  box, key, userId)`, `deleteAiKey(tx)`, `resolveAiKey(db, box, env): Promise<ResolvedAiKey>`.
- **Precedence.** The saved key wins over `ANTHROPIC_API_KEY` (plan decision 17). This is the reverse of SMTP on
  purpose: a leaked key can be rotated on the page without a redeploy, and the env key stays a fallback for fresh
  installations.

  ```ts
  type ResolvedAiKey =
    | { source: 'ui' | 'env'; key: string; demo: false }
    | { source: 'none'; key: null; demo: boolean }; // demo = env.ENABLE_DEMO_PROVIDER
  ```

- **Write-only.** No route returns the key or a part of it. `AiKeyStatusDto` has `source`, `savedAt`, `savedBy`,
  `envSet`. Audit details: `{ source: 'ui', replaced: boolean, demoOverridesDeleted: number }`, never the key.
  The request body is not logged (Fastify logs no bodies; the logger redacts `authorization` and `cookie`,
  `app.ts:67`). Both the saved and the env key are added to the exact values `redactText` removes (11.2), so a key
  pasted into a chat or echoed in an error never leaves the console.
- **Validation** of `PUT /admin/ai/key` `{ key }`: trimmed, `^sk-ant-[A-Za-z0-9_-]{16,300}$`. A key starting with
  `sk-ant-admin` is refused with 400 `ai_admin_key` (Admin API keys manage the organization and are not accepted by
  the Messages API; storing one would put a far more powerful credential at rest). The mock's default key
  `sk-ant-test-0000000000000000000000` passes.
- **Test button.** `POST /admin/ai/test` (5.4) calls `client.models.retrieve(model)` with the effective key: no
  tokens, no budget, no `ai_usage` row. It answers `AiTestResultDto` with `ok: false` and the reason from
  `classifyAiError` instead of throwing, so the page can show it. Route rate limit `config.rateLimit: { max: 10,
  timeWindow: '1 minute' }`.
- **Delete.** `DELETE /admin/ai/key` removes the row; `ANTHROPIC_API_KEY` applies again if set. Audit
  `ai.key_delete`.
- **Client cache.** `AiService` caches one SDK client per (source, key fingerprint) (`sha256` of the key, like
  `configFingerprint`, `mail/settings.ts:101`); save and delete call `ctx.ai.resetClient()`.

### 5.3 Status and integration status

- `ctx.ai.availability(feature?)` returns `AiAvailabilityDto`: `disabled` when the master switch is off;
  `not_configured` when it is on but `resolveAiKey` gives `source: 'none'` and `demo: false`; `feature_off` when a
  feature is given and switched off; else available. `demo` is true while `source: 'none'` and
  `ENABLE_DEMO_PROVIDER` is true. Cached for 10 seconds per process; every settings or key write clears the cache.
- `ctx.ai.assertFeature(feature)` throws 404 unless `availability(feature).available`, and returns the settings.
- `ctx.ai.integrationStatus()` fills `IntegrationsDto.ai` (plan F8, F18; `modules/settings/routes.ts`):

  ```ts
  ai: { configured: boolean; source: 'ui' | 'env' | 'demo' | 'none'; enabled: boolean; model: AiModel };
  ```

  `configured` is true for `ui`, `env` and `demo`. The admin settings page shows it as an `IntegrationCard` with a
  link to `/admin/ai` (12.5).

### 5.4 Routes of `modules/ai/routes.ts` (F, complete)

| Route | Gate | Body / answer | Audit |
|---|---|---|---|
| `GET /ai/status` | `requireAuth` | `AiStatusDto` | none |
| `GET /admin/ai/settings` | `requireSession`, `platform:settings` | `AiSettingsDto` | none |
| `PUT /admin/ai/settings` | `requireSession`, `platform:settings` | `AiSettingsInput` -> `AiSettingsDto` | `ai.settings_update` with the changed fields `{ field: { from, to } }` |
| `PUT /admin/ai/key` | `requireSession`, `platform:settings` | `{ key }` -> `AiKeyStatusDto & { demoOverridesDeleted: number }` | `ai.key_update` |
| `DELETE /admin/ai/key` | `requireSession`, `platform:settings` | -> `AiKeyStatusDto` | `ai.key_delete` |
| `POST /admin/ai/test` | `requireSession`, `platform:settings`, 10 per minute | `{}` -> `AiTestResultDto` | `ai.test` (status success or failure, `{ model, reason }`) |

`PUT /admin/ai/key` runs in one transaction: `saveAiKey(tx, ...)`, then `deleteDemoOverrides(tx)` from
`apps/api/src/i18n/entries.ts` (plan F16, O11; demo pseudo translations must not survive a real key), then the
audit entry. After the commit: `ctx.ai.resetClient()`, `ctx.i18n` reloads its overrides (i18n 8.1). A key is
saved even while the master switch is off.

### 5.5 Per-organization routes and cards

Columns on `organizations` (5.6): `ai_enabled` (default `true`), `ai_disabled_by` (`'platform' | 'reseller' |
null`), `ai_opt_out_at`, `ai_opt_out_by`. The effective state:

```ts
/** modules/ai/org-state.ts. Reasons in this order; enabled when none applies. */
export function aiOrgState(org: Organization, parent: Organization | null): AiOrgStateDto;
// declined: org.aiOptOutAt; platform / reseller: !org.aiEnabled by org.aiDisabledBy;
// parent: the reseller is switched off or declined (cascade, 3.4)
```

`ctx.ai.assertOrgData(orgId)` loads the organization and its parent and throws 403 `ai_org_disabled` with the
reasons unless `aiOrgState(...).enabled`. Every staff feature, every staff request inside a customer, and every
admin feature that reads data of an organization calls it (6.9, 10).

Routes (`modules/ai/org-routes.ts`, U3). None of them calls `assertFeature`: they work before go-live, while the
platform is off and while the organization is suspended (plan O27).

| Route | Gate | Body / answer | Audit |
|---|---|---|---|
| `GET /orgs/:orgId/ai` | `requireSession`, `loadOrg`, `ai:settings` | `OrgAiDto` | none |
| `PUT /orgs/:orgId/ai/decline` | `requireSession`, `loadOrg`, `ai:settings` | `{ declined: boolean }` -> `OrgAiDto` | `ai.org_decline` or `ai.org_allow` (`orgId`, resource `org`) |
| `GET /admin/orgs/:orgId/ai` | `requireSession`, `platform:org:read` | `AdminOrgAiDto` | none |
| `PUT /admin/orgs/:orgId/ai` | `requireSession`, `platform:org:write` | `{ enabled: boolean }` -> `AdminOrgAiDto` | `ai.org_switch` `{ enabled, by: 'platform' }` |
| `GET /orgs/:orgId/customers/:customerId/ai` | `requireSession`, reseller org, `reseller:customer:read`, customer belongs to it | `ResellerCustomerAiDto` | none |
| `PUT /orgs/:orgId/customers/:customerId/ai` | `requireSession`, `reseller:customer:write`, same checks | `{ enabled: boolean }` -> `ResellerCustomerAiDto` | `ai.org_switch` `{ enabled, by: 'reseller' }` on the reseller's and the customer's org |

Rules:

- **Staff switch.** Off sets `ai_enabled = false, ai_disabled_by = 'platform'`; on sets `true, null`. Switching a
  customer on whose reseller is off is allowed (the card then says "capped by the reseller").
- **Reseller switch.** Off sets `false, 'reseller'` unless the customer is already off by `'platform'` (that stays).
  On is refused with 409 `ai_platform_locked` when `ai_disabled_by = 'platform'`, and with 409
  `ai_reseller_blocked` when the reseller's own AI is off (switched off or declined). A reseller switched off caps
  every customer through the parent boundary (3.4); its customers' switches stay as they are.
- **The customer's decline.** `declined: true` sets `ai_opt_out_at = now(), ai_opt_out_by = userId` (kept when
  already set); `false` clears both. The decline wins over everything: members, reseller staff and weblion staff.
  `ai:settings` is in `SUSPENDED_ALLOWED` (3.3), so a suspended customer can decide too.
- **Usage counts.** `usage.requests` counts this month's `ai_usage` rows with `org_id = orgId` of every scope,
  including the requests weblion staff ran on the organization's data (`scope 'staff'`, plan O28), and
  `usage.staffRequests` counts those separately. Customers and resellers see counts only; `AdminOrgAiDto` adds
  `usageCostMicros` for staff (plan decision 21).
- **Cards** (12.4): `OrgAiCard` whenever `can('ai:settings')`, with `ai.org.platformOff` while the platform is off;
  `AdminAiCard` on the admin customer page whatever the platform state; `ResellerAiCard` on the reseller customer
  page.

### 5.6 Data model (migration `apps/api/drizzle/0010_ai.sql`, plan O12)

Plan section 3 (`contracts.md`) is binding; this is the AI part as designed.

```sql
ALTER TABLE "organizations" ADD COLUMN "ai_enabled" boolean DEFAULT true NOT NULL;
ALTER TABLE "organizations" ADD COLUMN "ai_disabled_by" text;
ALTER TABLE "organizations" ADD COLUMN "ai_opt_out_at" timestamp with time zone;
ALTER TABLE "organizations" ADD COLUMN "ai_opt_out_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "products" ADD COLUMN "translations" jsonb DEFAULT '{}'::jsonb NOT NULL;

CREATE TABLE "ai_usage" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  "feature" text NOT NULL,
  "scope" text NOT NULL,                       -- 'org' | 'staff' | 'platform'
  "org_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "counts_for_user" boolean DEFAULT true NOT NULL,
  "model" text NOT NULL,                       -- requested AiModel
  "served_model" text,                         -- set when another model answered (fallback)
  "status" text DEFAULT 'running' NOT NULL,    -- AiUsageStatus
  "demo" boolean DEFAULT false NOT NULL,
  "api_calls" integer DEFAULT 0 NOT NULL,
  "tool_calls" integer DEFAULT 0 NOT NULL,
  "live_calls" integer DEFAULT 0 NOT NULL,
  "input_tokens" integer DEFAULT 0 NOT NULL,
  "output_tokens" integer DEFAULT 0 NOT NULL,
  "cache_read_tokens" integer DEFAULT 0 NOT NULL,
  "cache_write_tokens" integer DEFAULT 0 NOT NULL,
  "reserved_micros" bigint DEFAULT 0 NOT NULL,
  "cost_micros" bigint DEFAULT 0 NOT NULL,
  "duration_ms" integer,
  "error_code" text,
  "error_reason" text,
  "error_message" text,                        -- redacted, cleared after 30 days
  "request_id" text                            -- Anthropic request-id header of the last call
);
CREATE INDEX "ai_usage_created_idx" ON "ai_usage" ("created_at");
CREATE INDEX "ai_usage_org_created_idx" ON "ai_usage" ("org_id", "created_at");
CREATE INDEX "ai_usage_user_created_idx" ON "ai_usage" ("user_id", "created_at");
CREATE INDEX "ai_usage_running_idx" ON "ai_usage" ("created_at") WHERE "status" = 'running';
```

The default `true` switches every existing organization on (plan decision 16). Drizzle: `organizations` gains
`aiEnabled`, `aiDisabledBy: text().$type<AiSwitchedOffBy>()`, `aiOptOutAt`, `aiOptOutBy`; `products` gains
`translations: jsonb().$type<ProductTranslations>().notNull().default({})`; new table `aiUsage` with type
`AiUsageRow`. No prompt, answer, tool input or tool result is ever stored.

Audit actions of the module: `ai.settings_update`, `ai.key_update`, `ai.key_delete`, `ai.test`, `ai.org_switch`,
`ai.org_decline`, `ai.org_allow`, `ai.budget_warning`, `ai.budget_exhausted`. AI feature and chat requests change
nothing and are not audit entries; `ai_usage` records them.

---

## 6. Calling Claude

Every call of the module goes through `client.beta.messages.stream(...)` and `finalMessage()` (plan O8): the beta
namespace because `betas` and `fallbacks` live there (`MessageCreateParamsBase`, `messages.ts:9379` of the SDK),
streaming because answers with adaptive thinking can be long and because the chat forwards text deltas. There is
no raw `fetch` to the Messages API anywhere (review grep in plan 8.3); only `demoFetch` plumbing (14).

### 6.1 `createAnthropic`

`apps/api/src/modules/ai/client.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk';

const DEMO_BASE_URL = 'http://claude-demo.invalid';
const DEMO_KEY = 'sk-ant-demo-0000000000000000';

export function createAnthropic(env: Env, key: ResolvedAiKey, log: FastifyBaseLogger): Anthropic {
  return new Anthropic({
    // Always explicit: the SDK must never pick up ANTHROPIC_AUTH_TOKEN, a CLI profile or federation
    // variables from the server's environment, and the saved key must win over ANTHROPIC_API_KEY (5.2).
    apiKey: key.demo ? DEMO_KEY : key.key,
    authToken: null,
    baseURL: key.demo ? DEMO_BASE_URL : env.ANTHROPIC_BASE_URL,
    maxRetries: env.ANTHROPIC_MAX_RETRIES,
    timeout: env.AI_TURN_TIMEOUT_SECONDS * 1000,
    fetch: key.demo ? demoFetch : undefined,
    // 'warn' at most: debug logging of the SDK would print request bodies with customer data.
    logger: log.child({ module: 'anthropic' }),
    logLevel: 'warn',
  });
}
```

- Env (plan F11): `ANTHROPIC_API_KEY` (optionalString), `ANTHROPIC_BASE_URL` (url, default
  `https://api.anthropic.com`), `ANTHROPIC_MAX_RETRIES` (0 to 5, default 2; the SDK retries 408, 409, 429, 5xx
  and connection errors), `AI_TURN_TIMEOUT_SECONDS` (30 to 600, default 180). Tests set `ANTHROPIC_BASE_URL` to
  `http://127.0.0.1:9` unless a mock is started, and `ANTHROPIC_MAX_RETRIES=0` (plan F19), so no test can reach the
  real API.
- The SDK option names (`apiKey`, `authToken`, `baseURL`, `maxRetries`, `timeout`, `fetch`, `logger`,
  `logLevel`) are those of `ClientOptions` in `src/client.ts` of 1.3.0. The SDK sends `anthropic-version:
  2026-10-21` (plan O19).
- `AiService.client()` returns `{ client, demo, model }` or `null` when not configured; one cached client per key
  fingerprint (5.2).

### 6.2 `baseParams(model, feature, userId)`

```ts
import type {
  BetaMessageStreamParams,
  BetaTextBlockParam,
} from '@anthropic-ai/sdk/resources/beta/messages';

export const AI_FEATURE_MAX_TOKENS: Record<AiFeature, number> = {
  assistant: 32_000, // per API call of a turn
  explain: 8_000,
  dns_check: 16_000,
  audit_summary: 16_000,
  server_health: 16_000,
  product_texts: 8_000,
  translations: 32_000, // plan O8
};
/** Typical output tokens incl. adaptive thinking, only for estimates (7.1). */
export const AI_FEATURE_EXPECTED_OUTPUT: Record<AiFeature, number> = {
  assistant: 2_000,
  explain: 1_200,
  dns_check: 3_000,
  audit_summary: 2_500,
  server_health: 2_500,
  product_texts: 1_500,
  translations: 3_500,
};
export const AI_MAX_TOKENS_CEILING = 64_000; // retry room of 6.6

type BaseParams = Pick<
  BetaMessageStreamParams,
  'model' | 'max_tokens' | 'thinking' | 'output_config' | 'metadata' | 'betas' | 'fallbacks'
>;

export function baseParams(model: AiModel, feature: AiFeature, userId: string | null): BaseParams {
  return {
    model, // exact id from AI_MODELS, never an alias or a dated id
    max_tokens: AI_FEATURE_MAX_TOKENS[feature],
    thinking: { type: 'adaptive' },
    output_config: { effort: AI_FEATURE_EFFORT[feature] },
    // Opaque and stable, no personal data: lets Anthropic tell end users apart for abuse detection.
    metadata: { user_id: userId ? sha256(`weblion-ai-user:${userId}`).slice(0, 32) : null },
    ...(hasRefusalFallback(model)
      ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
      : {}),
  };
}

/** The fixed system prompt of a feature with the cache breakpoint (caches tools + system). */
export function systemBlocks(text: string): BetaTextBlockParam[] {
  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];
}
```

Rules every call follows (checked by `ai-structured.test.ts` and the review greps):

- exact model id; `thinking: { type: 'adaptive' }`; `output_config.effort` from `AI_FEATURE_EFFORT` (medium for
  assistant, dns_check, server_health, translations; low for explain, audit_summary, product_texts);
- `betas: ['server-side-fallback-2026-07-01']` and `fallbacks: 'default'` only on Opus and Sonnet;
- `cache_control: { type: 'ephemeral' }` on the fixed system prompt (`systemBlocks`); the system text never
  contains a date, a name or another per-request value, which go into the user turn (9.2);
- `metadata.user_id` as above;
- no `temperature`, `top_p`, `top_k`, no `budget_tokens`, no `thinking: { type: 'disabled' }`, no `tool_choice`
  other than `{ type: 'auto' }`, no assistant prefill (the last message is always a user turn);
- `stream()` with `finalMessage()`.

`WithFallbacks<T>`: only if the F10 spike (plan 5.2) fails on the scalar form, which the review found typed in
1.3.0 (`BetaFallbacksParam = Array<BetaFallbackParam> | 'default'`, `messages.ts:5517`):

```ts
/** Workaround type, used only when the pinned SDK lacks `fallbacks: 'default'` in its params. */
type WithFallbacks<T> = Omit<T, 'fallbacks'> & { fallbacks?: 'default' | null };
// call site: client.beta.messages.stream(params as unknown as BetaMessageStreamParams, { signal })
```

### 6.3 `FINAL_STEP_NOTE`

```ts
export const FINAL_STEP_NOTE =
  'Note from weblion.one: this is the last step of this answer. Do not call any more tools; tool calls now ' +
  'are not run. Answer with the information you already have and say briefly what you could not check.';
```

- `tool_choice` stays `{ type: 'auto' }` on every call (plan O30). Switching it to `none` for the last call would
  invalidate the messages cache built during the turn (`tool_choice` is part of the messages cache tier), and
  forcing (`any`, `tool`) is rejected on Opus 5.5 and Sonnet 5.5.
- Before the last allowed call (6.4), the note is appended as a `{ type: 'text', text: FINAL_STEP_NOTE }` block
  after the `tool_result` blocks of that user message. Earlier messages are never edited (append-only history,
  so the cache and the thinking blocks of the turn stay valid).
- If the model still answers the last call with `tool_use`, those calls are not run; the text streamed so far is
  the answer and the turn ends with the notice `tool_limit`.

### 6.4 The chat loop

Manual streaming loop in `apps/api/src/modules/ai/chat.ts` (not the beta tool runner): the runner would re-send
or run tool calls that came before a mid-answer fallback, and it cannot account the budget after every call or
enforce the per-turn caps.

```ts
export const CHAT_LIMITS = {
  apiCalls: 8, // per turn
  toolCalls: 24, // per turn
  liveCalls: 8, // per turn, tools with live: true
  toolResultChars: 120_000, // per turn, sum of tool_result texts
  toolResultMaxChars: 20_000, // per tool result
  costFactor: 5, // a turn may cost at most 5 x its estimate
  jsonRetries: 1, // re-issues after an unparseable tool input
} as const;
```

Turn, step by step:

1. **Gates** (9.1), then `reserve()` (7.1) with the estimate of the first call; 429s are plain JSON answers
   because the stream is not open yet. Then `sse.open()` and `meta` event.
2. **One `AbortSignal`** for the whole turn: `AbortSignal.any([sse.signal, AbortSignal.timeout(env.AI_TURN_TIMEOUT_SECONDS * 1000)])`.
   `sse.signal` aborts when the browser closes the connection. The signal goes to every `stream()` call (request
   option `signal`) and to the tool runner, which starts no tool after an abort.
3. **Messages**: `buildMessages(request, context)` (9.2). Tools: the 22 definitions of 8.2 to 8.4, sorted by name,
   each with `strict: true`, `eager_input_streaming: true` and `input_schema: toStrictJsonSchema(tool.input)`.
4. **Per call**: `usage.refreshReservation(row, estimate of this call)`; then

   ```ts
   const stream = client.beta.messages.stream(
     {
       ...baseParams(model, 'assistant', userId),
       system: systemBlocks(SYSTEM_TEXT.assistant),
       tools,
       tool_choice: { type: 'auto' },
       cache_control: { type: 'ephemeral' }, // moving breakpoint on the last block of the turn
       messages,
     },
     { signal },
   );
   stream.on('text', (delta) => sse.send('text', { text: delta }));
   const message = await stream.finalMessage();
   ```

   `finalMessage()` rejects with a plain `Error` (not `Anthropic.APIError`) when a tool input streamed with
   `eager_input_streaming` could not be parsed at all. Only that case is re-issued, at most once per turn, and it
   counts as an API call (its cost is charged as the call's estimate, the real usage is unknown). Typed API errors
   are rethrown to `classifyAiError` (6.8).
5. **Accounting after every call**: `usage.addCall(row, message)` (tokens, cost of 6.7, `api_calls + 1`, served
   model, request id). Then `if (await ctx.ai.budgetExceeded())` stop with notice `budget_stop` (the monthly
   budget is a hard stop also in the middle of an answer, plan decision 34), and `if (row.costMicros >
   CHAT_LIMITS.costFactor * turnEstimate)` stop with notice `tool_limit`. `turnEstimate` is the estimate of the
   first call.
6. **`stop_reason` first**, before reading any content:
   - `refusal`: throw `aiRefusal(message.stop_details?.category ?? null)`; the browser drops the partial text of the
     turn when it gets the `error` event (a mid-stream decline must not stand as an answer). With a fallback
     model the request was already retried server-side; a final `refusal` means the whole chain declined.
   - `max_tokens`: notice `incomplete`, end the turn. A `tool_use` in such a message is never run, its input may
     be truncated yet still parse.
   - `end_turn`, `stop_sequence`: end the turn (status `ok`).
   - `tool_use`: continue below. (`pause_turn` cannot occur, the module defines no server tools.)
7. **Mid-answer fallback**: if `message.content` contains `fallback` blocks, only blocks after the last one count.
   `toolUses = afterLastFallback(message.content).filter(isToolUse)`. Tool calls before the last fallback block
   are never run, never shown as chips and never re-sent: `echoContent(message.content)` drops `thinking`,
   `redacted_thinking`, `tool_use` and any block type the module does not know that appear before the last
   `fallback` block, and keeps text blocks and everything after it unchanged. The `done` event reports
   `fallback: true` and the served model; the panel shows `ai.assistant.fallbackNote`.
8. **Last call reached** (this was call 8, or the final step note was sent): if `toolUses` is not empty, they
   are not run; notice `tool_limit`; end.
9. **Run tools** (8): `messages.push({ role: 'assistant', content: echoContent(message.content) })`, then for
   each `tool_use` in order (up to 4 at a time):
   - validate `block.input` with the tool's zod schema; on failure the result is `{ type: 'tool_result',
     tool_use_id, is_error: true, content: JSON.stringify({ INVALID_JSON: JSON.stringify(block.input) }) }` and the
     tool is not run (eager streaming means the API no longer validates the input);
   - over 24 tool calls in the turn: `is_error` result `{"error":"tool_limit"}`;
   - a live tool over 8 live calls in the turn, or `ctx.ai.liveReadAllowed(orgId)` false (30 per organization and
     minute): `is_error` result `{"error":"live_limit"}`;
   - else `tool.run(input, toolCtx)` (8.1); `tool` events `running` before and `done` or `error` after;
     `source` events for the console paths the tool read (deduplicated per turn); `proposal` events from
     `propose_dns_record`;
   - each result text is `toolJson(redactForAi(result, { personal: tool.personal }))` cut to 20,000 characters at
     an item boundary (`{ ..., truncated: true, total }`); when the turn's sum would pass 120,000 characters the
     result becomes `{"error":"result_limit"}`.
10. **Next message**: all results in one user message (parallel tool calls must be answered together). If the
    next call will be call 8, or the turn reached 24 tool calls or 120,000 result characters, append
    `FINAL_STEP_NOTE` (6.3) after the results. Then go to step 4.
11. **End**: `finish(row, status)` with `ok`, `incomplete` (notices `tool_limit`, `budget_stop`, `incomplete`),
    `refusal`, `error` or `cancelled` (client gone, no further SSE writes); then `done` event and `sse.close()`;
    `checkBudgetWarning()` (7.2) after the response.

Within a turn the history is append-only (assistant content echoed unchanged except for the fallback rule,
results appended), so the moving cache breakpoint is read by the next call and the thinking blocks of the turn
stay valid. Across turns only the tools and system prefix is cached: the browser keeps plain text (9.2), so the
second turn's messages differ from the first turn's request after the first user message.

### 6.5 `toStrictJsonSchema`

`apps/api/src/modules/ai/schema.ts`. Tool inputs (`strict: true`) and JSON features (`output_config.format`)
share it.

```ts
/** zod 4 schema -> JSON Schema accepted by strict tools and structured outputs. Throws on what they reject. */
export function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return strictify(z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'throw' }));
}
```

`strictify` walks the schema:

- every object gets `additionalProperties: false` and lists every property in `required`; a property zod marks
  optional throws (AI schemas use `.nullable()` for absent values, so the model always sends the key);
- removes keywords structured outputs do not support: `minLength`, `maxLength`, `pattern`, `minimum`, `maximum`,
  `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `maxItems`, `uniqueItems`, `minItems` above 1,
  `minProperties`, `maxProperties`, plus `$schema`, `default`, `examples`;
- keeps `type`, `enum`, `const`, `anyOf`, `allOf`, `$ref`/`$defs`, `items`, `properties`, `required`,
  `description` and the formats `date-time`, `time`, `date`, `duration`, `email`, `hostname`, `uri`, `ipv4`,
  `ipv6`, `uuid`;
- throws on records (an object whose `additionalProperties` is a schema), recursion and tuples.

The dropped constraints stay in the zod schema, which validates every tool input before the tool runs (6.4 step
9) and every JSON answer before it is returned (6.6). `schema.test.ts`: nested objects strict; optional throws;
nullable gives `anyOf` with `null`; `z.uuid()` keeps `format: 'uuid'` and loses `pattern`; length and number
limits removed; `z.record` throws; every tool input schema and every feature output schema converts.

### 6.6 `structured()`

The one path for JSON features, translations included (plan O4). Signature (copy of plan 2.4):

```ts
export interface StructuredRequest<T> {
  feature: AiFeature;
  scope: AiUsageScope; // 'org' | 'staff' | 'platform'
  orgId: string | null; // the organization the data belongs to (staff requests: the customer)
  countsForUser: boolean; // false only for Mass Translate batches (plan O9)
  actor: { userId: string | null };
  system: string; // SYSTEM_TEXT[feature], or the translator's prompt (first line "# Feature: translations")
  user: string; // the user turn; third-party data inside escaped blocks (11.1)
  schema: z.ZodType<T>;
  retryOnMaxTokens?: boolean; // default true; translation batches pass false
  signal?: AbortSignal;
}
export interface StructuredResult<T> {
  data: T;
  meta: AiResultMeta; // model, servedModel, demo
  usageId: string;
  tokens: UsageTotals;
  costMicros: number;
}
structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
```

Flow:

1. `assertFeature(req.feature)` (404 when not available; i18n routes check `availability()` before and answer
   409 themselves); `client()`.
2. `reserve()` (7.1) with `estimateCallMicros(model, feature, approxTokens(system + user + schema))`.
3. One streamed call: `{ ...baseParams(model, feature, userId), system: systemBlocks(req.system), messages: [{
   role: 'user', content: req.user }], output_config: { effort: AI_FEATURE_EFFORT[feature], format: { type:
   'json_schema', schema: toStrictJsonSchema(req.schema) } } }`, signal `AbortSignal.any([req.signal,
   AbortSignal.timeout(turn timeout)])`.
4. `addCall(row, message)`, then `stop_reason`:
   - `refusal`: 422 `ai_refusal`, usage status `refusal`;
   - `max_tokens`: with `retryOnMaxTokens` one more call with `max_tokens` doubled (at most
     `AI_MAX_TOKENS_CEILING`), after `refreshReservation`; a second `max_tokens`, or the first with
     `retryOnMaxTokens: false`, gives 502 `ai_incomplete`, status `incomplete` (the job then splits the batch,
     i18n 12);
   - otherwise the text blocks in order are joined (after a mid-stream fallback the fallback model continues the
     same text), `JSON.parse`d and validated with `req.schema`; a failure is 502 `ai_upstream` reason `output`.
5. `finish(row, 'ok')`, `checkBudgetWarning()`, return. Every thrown error passes `classifyAiError` and
   `finish(row, status, error)` first.

The request always ends with a user turn and carries no prefill.

### 6.7 Usage and cost accounting

```ts
export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}
```

- `usage.addCall(row, message)` sums the call into the row: with `message.usage.iterations` the counts of every
  entry of type `message` or `fallback_message` (`usage.iterations` is the per-attempt truth; the top-level counts
  cover only the attempt that produced the message), else the top-level counts. Cost: `aiCostMicros(row.model,
  message.usage, row.model)` (3.1). `served_model` = `message.model` when it differs from the requested id.
  Attempts declined before any output are reported in `iterations` and are counted (conservative: whether
  Anthropic bills them depends on the refusal category).
- Demo rows record the emulator's token numbers with cost 0.
- `estimateCallMicros(model, feature, inputTokens)` = `aiCostMicros(model, { input_tokens: inputTokens,
  output_tokens: AI_FEATURE_EXPECTED_OUTPUT[feature] }, model)`, input uncached. `approxTokens(text)` =
  `Math.ceil(text.length / 3)` (deliberately high for German text and JSON; no `count_tokens` call, which would
  add latency).

Worked examples (micro-USD, rounded):

| Case | Calculation | Cost |
|---|---|---|
| Explain on Opus 5.5, cold cache: system 1,600 tokens written, 1,400 input, 900 output | 1,600 x 5 + 1,400 x 4 + 900 x 20 = 8,000 + 5,600 + 18,000 | 31,600 = USD 0.032 |
| Same, within 5 minutes (system read from cache) | 1,600 x 0.2 + 5,600 + 18,000 | 23,920 = USD 0.024 |
| Same on Sonnet 5.5 / Haiku 5.5, warm | 320 + 2,800 + 9,000 / 16 + 140 + 450 | 12,120 / 606 |
| Assistant turn on Opus 5.5, 3 calls, 2 tool calls, cold: call 1 writes tools + system 7,000 and messages 900, output 350 | 7,900 x 5 + 350 x 20 | 46,500 |
| call 2 reads 7,900, writes 3,550 (tool use + results), output 300 | 7,900 x 0.2 + 3,550 x 5 + 300 x 20 | 25,330 |
| call 3 reads 11,450, writes 2,700, output 650 | 11,450 x 0.2 + 2,700 x 5 + 650 x 20 | 28,790 |
| Turn total (the next turn within 5 minutes saves the tools + system write, about USD 0.034) | | 100,620 = USD 0.10 |
| Turn cap for that turn: first call estimate 7,900 x 4 + 2,000 x 20 = 71,600, times 5 | | 358,000 = USD 0.36 |
| Mass Translate batch, Opus 5.5, 50 keys: system with glossary 2,400 read from cache, 1,800 input, 3,200 output | 2,400 x 0.2 + 1,800 x 4 + 3,200 x 20 | 71,680 = USD 0.072 |
| Full fr, it, nl run: about 89 batches per language, 267 batches | 267 x 71,680 | about USD 19 (plan 9: USD 10 to 20) |
| Opus call answered by the fallback: `message` 5,000 input, `fallback_message` (unlisted id) 5,000 input, 800 output | 5,000 x 4 + 5,000 x 5 + 800 x 25 | 65,000 |

With the default budget of USD 100 a month that is about 1,000 assistant turns or 4,000 explanations on Opus 5.5.

### 6.8 `classifyAiError`

`apps/api/src/modules/ai/errors.ts`. Typed SDK errors, most specific first (subclasses before their parents, as
`src/core/error.ts` of 1.3.0 defines them); never string matching on messages.

```ts
export function classifyAiError(err: unknown, run: { timedOut: boolean }): AppError | AiCancelled {
  if (err instanceof AppError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return run.timedOut ? aiTimeout() : new AiCancelled();
  if (err instanceof Anthropic.APIConnectionTimeoutError) return aiTimeout();
  if (err instanceof Anthropic.APIConnectionError) return aiUpstream('network');
  if (err instanceof Anthropic.AuthenticationError) return aiUpstream('auth'); // 401
  if (err instanceof Anthropic.PermissionDeniedError) return aiUpstream('permission'); // 403
  if (err instanceof Anthropic.NotFoundError) return aiUpstream('not_found'); // 404
  if (err instanceof Anthropic.RateLimitError) return aiBusy('rate_limit', retryAfter(err.headers)); // 429
  if (err instanceof Anthropic.BadRequestError) return aiUpstream('request'); // 400
  if (err instanceof Anthropic.InternalServerError) {
    // 5xx; 529 is Anthropic's "overloaded"
    return err.status === 529 || err.type === 'overloaded_error' ? aiBusy('overloaded') : aiUpstream('server');
  }
  if (err instanceof Anthropic.APIError) {
    // status undefined: an `event: error` frame in the middle of a stream. The SDK throws
    // new APIError(undefined, body, undefined, headers, type) there (src/core/streaming.ts), so only
    // err.type tells what happened.
    switch (err.type) {
      case 'overloaded_error':
        return aiBusy('overloaded');
      case 'rate_limit_error':
        return aiBusy('rate_limit');
      case 'timeout_error':
        return aiTimeout();
      case 'billing_error':
        return aiUpstream('billing');
      case 'authentication_error':
        return aiUpstream('auth');
      case 'permission_error':
        return aiUpstream('permission');
      case 'not_found_error':
        return aiUpstream('not_found');
      case 'invalid_request_error':
        return aiUpstream('request');
    }
    if (err.status === 402) return aiUpstream('billing'); // no own class in the SDK
    if (err.status === 413 || err.status === 409 || err.status === 422) return aiUpstream('request');
    return aiUpstream('server'); // api_error and anything else
  }
  if (err instanceof SyntaxError || err instanceof z.ZodError) return aiUpstream('output');
  throw err; // a bug of ours: 500 internal_error through the normal handler
}
```

- Overloaded (529 or a mid-stream `overloaded_error`) is `ai_busy` reason `overloaded`, not an upstream failure
  (plan F20).
- The 402 "Your credit balance is too low" case: the client gets 502 `ai_upstream` with the fixed message (no
  "credit", no "balance"); `ai_usage.error_message` keeps `redactText(err.message)` (at most 1,000 characters) for
  staff, `error_reason = 'billing'`, `request_id = err.requestID`.
- Logs: `log.warn({ feature, code, reason, status: err.status, type: err.type, requestId }, 'claude request
  failed')`, never the message.
- `AiCancelled` is internal: the usage row gets status `cancelled`, nothing is sent (the client is gone).

### 6.9 `AiService` (copy of plan 2.4)

`apps/api/src/modules/ai/service.ts`, `ctx.ai` (plan F17). F builds the core; U3 adds the marked members.

```ts
export class AiService {
  constructor(ctx: AppContext);
  attach(app: FastifyInstance): void; // keeps the app for ConsoleReader (app.inject)
  settings(): Promise<AiSettings>;
  availability(feature?: AiFeature): Promise<AiAvailabilityDto>;
  assertFeature(feature: AiFeature): Promise<AiSettings>; // 404
  integrationStatus(): Promise<IntegrationsDto['ai']>;
  client(): Promise<{ client: Anthropic; demo: boolean; model: AiModel } | null>;
  resetClient(): void;
  structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
  countRate(actor: { userId: string }): Promise<void>; // 429 user_rate / user_concurrent / user_daily, no row
  budgetState(): Promise<AiBudgetDto>;
  // U3:
  budgetExceeded(): Promise<boolean>;
  assertOrgData(orgId: string): Promise<void>; // 403 ai_org_disabled
  liveReadAllowed(orgId: string): boolean;
  chat(req: FastifyRequest, reply: FastifyReply, input: ChatInput): Promise<void>;
}
```

`countRate` is the up-front check for requests that make several `structured()` calls (i18n suggest B1: one call
per locale): it checks the person's rate, concurrency and daily limit without writing a row; each call then writes
its own row (plan O9).

---

## 7. Budget and limits

`apps/api/src/modules/ai/usage.ts`. All limits are checked against `ai_usage` in the database, so they hold across
API processes; only the live-read window (7.1, last row) is per process.

### 7.1 Reservations and limits

One `ai_usage` row per **request**: a chat turn, a feature call, a translation batch (plan O22). The row is
written as `running` with `reserved_micros` before the first API call; before every further call of the same
request (chat calls, the `max_tokens` retry) `refreshReservation(row, estimate)` sets `reserved_micros` to the
next call's estimate; after every call `addCall` adds tokens and cost. `finish(row, status, error?)` sets
`status`, `finished_at`, `duration_ms`, `reserved_micros = 0` and the error fields.

```ts
export interface ReserveInput {
  feature: AiFeature;
  scope: AiUsageScope;
  orgId: string | null;
  userId: string | null;
  countsForUser: boolean;
  model: AiModel;
  demo: boolean;
  estimateMicros: number;
}
export const AI_LIMITS = {
  userPerMinute: 12,
  userConcurrent: 2,
  orgConcurrent: 3,
  platformConcurrent: 6,
  orgLiveReadsPerMinute: 30,
} as const;
reserve(input: ReserveInput): Promise<AiUsageRow>;
```

`reserve()` runs in one transaction under `pg_advisory_xact_lock(hashtextextended('ai:reserve', 0))` (the
pattern of `lockOrgBilling`, `modules/billing/ledger.ts:26`), so two requests cannot pass the checks together.
"Live" rows are `status = 'running'` and `created_at > now() - (AI_TURN_TIMEOUT_SECONDS + 60) seconds`; older
running rows are stale, ignored by every check and marked `stale` by maintenance (7.3). That bound replaces the
fixed 25 minutes of the first design, so a deploy in the middle of a request locks nobody out for longer than a
turn can last (review #8). Checks in this order, each a 429 `ai_limit`:

| # | Check | Applies to | Kind |
|---|---|---|---|
| 1 | `spent + reserved(live rows) + estimate > budget` for the month (Europe/Zurich); `budgetUsd = 0` refuses everything | every request, translation batches included | `budget` |
| 2 | live rows on the platform `>= 6` | every request | `concurrent` |
| 3 | live rows with `org_id = orgId` and `scope = 'org'` `>= 3` | `scope 'org'` | `org_concurrent` |
| 4 | rows today (Europe/Zurich) with `org_id = orgId` and `scope = 'org'` `>= dailyOrgLimit` (200) | `scope 'org'` | `org_daily` |
| 5 | live rows of the user with `counts_for_user` `>= 2` | `countsForUser` | `user_concurrent` |
| 6 | rows of the user with `counts_for_user` in the last 60 seconds `>= 12` | `countsForUser` | `user_rate` |
| 7 | rows of the user today with `counts_for_user` `>= dailyUserLimit` (50) | `countsForUser` | `user_daily` |

- `countsForUser: false` (Mass Translate batches) skips 3 to 7: no per-person rate, daily or concurrency limit and
  no organization limit; the budget (1) and the platform cap (2) apply (plan O9). The i18n job runs at most
  `I18N_AI_CONCURRENCY` batches at a time, so it leaves room on the platform.
- Staff requests on a customer's data (`scope 'staff'`, `org_id` = the customer) count for the staff member (5 to
  7) and in the customer's usage line (5.5), but not against the customer's organization limits (3, 4): staff work
  must not use up the customer's quota.
- Per turn (chat) on top: at most 8 API calls, 24 tool calls, 8 live tool calls, 120,000 tool-result characters,
  and a cost of at most 5 x the turn's estimate (6.4). After every chat API call `budgetExceeded()` (`spent >=
  budget`) stops the turn even when it passed the reservation check (plan O29). The overshoot of a month is bounded
  by one call per running request, at most six calls platform-wide.
- Mass Translate stops a job at 1.5 x its estimate and refuses to start when the budget is already exhausted
  (i18n 12.6, plan O22).
- Live reads: `liveReadAllowed(orgId)` keeps a sliding one-minute window of timestamps per organization in memory
  (per API process) and allows 30; a refused live tool answers `{"error":"live_limit"}` to the model (6.4).

### 7.2 Budget warning and exhaustion

`checkBudgetWarning()` runs after every `finish()` that added cost (outside the request's transaction, errors
logged, never thrown):

1. `budgetState()`; nothing to do below `warnPercent`.
2. In a transaction under `pg_advisory_xact_lock(hashtextextended('ai:budget-notice', 0))` read the settings row
   `ai_budget_notice`; a row of an earlier month counts as empty. If `percent >= warnPercent` and `warnedAt` is
   null, set it; if `percent >= 100` and `exhaustedAt` is null, set it. Commit.
3. For each newly set mark: mail template `ai_budget` (plan O15) to every active user with `platform_role =
   'superadmin'`, in each recipient's language (i18n 8.2), and the audit entry (`req` null, actor system):
   - `ai.budget_warning` `{ month, percent, spentMicros, budgetMicros }`
   - `ai.budget_exhausted` `{ month, spentMicros, budgetMicros }`

Each happens at most once per month (raising the budget in the same month sends no second warning). When the
budget is reached first (a jump from below the warning straight to 100 percent) both marks are set and both mails
go out.

`ai_budget` template (`apps/api/src/mail/types.ts`, plan F18; texts `email.aiBudget.*` of plan 5.3):

```ts
ai_budget: {
  kind: 'warning' | 'exhausted';
  /** Formatted in the mail language, e.g. "November 2026". */
  month: string;
  spent: string; // "USD 81.20"
  budget: string; // "USD 100.00"
  percent: number;
  link: string; // `${APP_URL}/admin/ai`
};
```

The admin dashboard (12.5) shows the same state as a notice: from the warning `admin.ai.dashboard.warning`, after
exhaustion `admin.ai.dashboard.exhausted`.

### 7.3 Maintenance

`class AiMaintenance` (`apps/api/src/modules/ai/maintenance.ts`, plan F15, U3), `constructor(ctx: AppContext,
pool: pg.Pool)`, started in `index.ts` and stopped in `shutdown` (plan F17). `start()` runs once 5 seconds after
start, then every 10 minutes (timers `unref()`ed like `BillingJob.start`, `modules/billing/recurring.ts:224-231`).
Each run takes `pg_try_advisory_xact_lock(hashtextextended('ai:maintenance', 0))` in one transaction on a pool
client and skips when another process holds it:

1. **Stale rows**: `status = 'running'` and `created_at < now() - (AI_TURN_TIMEOUT_SECONDS + 60) s` become `stale`,
   `reserved_micros = 0`, `finished_at = now()` (their tokens so far stay counted).
2. **Retention of usage**: delete rows with `created_at < now() - 400 days` (plan decision 22).
3. **Retention of error texts**: `error_message = null` where `created_at < now() - 30 days`.

Running it at start clears rows a crash or deploy left behind before the first request arrives (review #8).

---

## 8. Read-only tools

### 8.1 `ConsoleReader`

`apps/api/src/modules/ai/reader.ts`. Tools never query customer tables. They call an allowlist of existing `GET`
routes in-process with `app.inject`, as the person who asked, so the existing permission, module and suspension
checks apply unchanged (the loaders `loadServer`, `loadDomain`, `loadWebspace`, `loadMailDomain`, `loadMonitor`,
`loadOrg` all need the live request, map 7).

```ts
export class ConsoleReader {
  constructor(app: FastifyInstance, req: FastifyRequest, orgId: string, signal: AbortSignal);
  /** A list or overview route of the current organization: /orgs/${orgId}/... only. */
  orgGet<T>(subPath: OrgSubPath, query?: Record<string, string>): Promise<ReadResult<T>>;
  /** Loads a resource by id and fails closed unless it belongs to the current organization. */
  owned<K extends OwnedKind>(kind: K, id: string): Promise<ReadResult<OwnedBody[K]>>;
  /** A sub-path of a resource verified by owned() earlier in the same run. */
  sub<T>(kind: OwnedKind, id: string, sub: SubPath[OwnedKind], query?: Record<string, string>): Promise<ReadResult<T>>;
  readonly liveCalls: number;
}
export type ReadResult<T> = { ok: true; body: T; path: string } | { ok: false; error: ReadError };
export type ReadError = 'not_found' | 'forbidden' | 'unsupported' | 'provider_error' | 'rate_limited' | 'live_limit';
```

- **Injection.** `app.inject({ method: 'GET', url: '/api/v1' + path, query, remoteAddress: req.ip, headers: {
  cookie: `${SESSION_COOKIE}=${req.cookies[SESSION_COOKIE]}`, 'user-agent': req.headers['user-agent'],
  accept: 'application/json' } })` (`SESSION_COOKIE` from `apps/api/src/auth/sessions.ts`). Only `GET`, so the
  CSRF rule for writes (`auth/plugin.ts`) never comes into play and nothing can be written. Paths are built from
  fixed templates with the run's `orgId` and zod-validated UUIDs; the model never supplies a path.
- **`owned(kind, id)`** (plan O26): loads the parent route and accepts the body only if `body.org?.id === orgId`.
  A body with `org: null` (an unassigned server, a domain without customer) or without `org` fails the same way.
  Any failure is `not_found`, the same answer as for an id that does not exist, so the model learns nothing about
  other organizations. A member of two organizations, or reseller staff, cannot pull another organization's data
  into this organization's chat.

  | Kind | Parent route | `org` field | Sub-paths allowed after verification |
  |---|---|---|---|
  | `server` | `GET /servers/:id` | `ServerDto.org` (`dto.ts:204`) | `metrics`, `activity`, `tasks`, `monitoring`, `traffic` |
  | `domain` | `GET /domains/:id` | `DomainDto.org` (`hosting.ts:216`) | `dns` |
  | `website` | `GET /webspaces/:id` | `WebspaceDto.org` (`hosting.ts:375`) | `dns-check` |
  | `mail_domain` | `GET /mail/domains/:id` | `MailDomainDto.org` (`mail.ts:159`) | `dns` |
  | `monitor` | `GET /monitors/:id` | `MonitorDto.org` (`monitoring.ts:180`) | `history` |

- **Sub-paths** (`/domains/:id/dns`, `/servers/:id/metrics`, `/mail/domains/:id/dns`, ...) answer without an `org`
  field, so `sub()` refuses them unless `owned()` verified that parent in the same run (a `Set` of
  `kind:id` in the reader); this closes review finding #1.
- **Results.** Status 200: the body. 404: `not_found`. 403: `forbidden`. 422 `unsupported`: `unsupported`.
  429: `rate_limited`. 502 or another 5xx (`ProviderError`): `provider_error` with `message: redactText(message)`
  cut to 300 characters (the provider's text is third-party data). Anything else: `provider_error` without text.
- **Escaping.** `toolJson(value)` (`modules/ai/redact.ts`, plan F13) is `JSON.stringify` with every `<` and `>`
  replaced by `<` and `>`, so a value can never open or close a tag of the prompt (`</third_party>`,
  `<context>`); the model still reads the characters.
- **Organization switch.** The chat and the features run only while the organization's AI is on (9.1); the reader
  does not check it again per call.

### 8.2 Resource tools

Every tool: `name`, `description` (English, one or two sentences, below), `input` (zod; all fields required,
absent values as `null`), `live` (calls a provider, counts against 8 per turn and 30 per organization and minute),
`personal` (the result passes `redactForAi(..., { personal: true })`), the route(s) it reads, and `project(body)`
that keeps the fields the model needs (drops `permissions`, `capabilities` and other UI-only arrays) to save
tokens. Lists are cut to 50 items (`truncated`, `total`). Every tool returns `sources`: the console paths of what
it read (`/o/<slug>/servers/<id>`, ...).

| # | Tool | Input | Reads | Live |
|---|---|---|---|---|
| 1 | `list_servers` | `{ q: string \| null, status: string \| null, label: string \| null }` | `GET /orgs/:orgId/servers` | no |
| 2 | `get_server` | `{ server_id: uuid }` | `owned('server')` | no |
| 3 | `get_server_metrics` | `{ server_id: uuid, range: 'hour' \| 'day' \| 'week' \| 'month' }` | `owned('server')`, then `sub('metrics', { range })` and `sub('monitoring')` | yes |
| 4 | `get_server_activity` | `{ server_id: uuid }` | `owned('server')`, then `sub('tasks')` and `sub('activity', { page: '1', perPage: '50' })`; personal | no |
| 5 | `list_domains` | `{}` | `GET /orgs/:orgId/domains` | no |
| 6 | `get_domain` | `{ domain_id: uuid }` | `owned('domain')` (live info of the registrar) | yes |
| 7 | `get_dns_records` | `{ domain_id: uuid }` | `owned('domain')`, then `sub('dns')` | yes |
| 8 | `list_websites` | `{}` | `GET /orgs/:orgId/webspaces` | no |
| 9 | `get_website` | `{ website_id: uuid }` | `owned('website')` (live from CloudPanel or the hoster) | yes |
| 10 | `check_website_dns` | `{ website_id: uuid }` | `owned('website')`, then `sub('dns-check')` | yes |
| 11 | `list_mail_domains` | `{}` | `GET /orgs/:orgId/mail/domains` | no |
| 12 | `get_mail_domain` | `{ mail_domain_id: uuid }` | `owned('mail_domain')` (live from Mailcow); mailbox addresses replaced, personal | yes |
| 13 | `get_mail_dns_setup` | `{ mail_domain_id: uuid }` | `owned('mail_domain')`, then `sub('dns')` | yes |
| 14 | `get_monitoring` | `{}` | `GET /orgs/:orgId/monitoring` | no |
| 15 | `get_monitor` | `{ monitor_id: uuid, range: 'recent' \| '24h' \| '7d' \| '30d' }` | `owned('monitor')`, then `sub('history', { range })` | yes |
| 16 | `get_cloud_storage` | `{}` | `GET /orgs/:orgId/cloud`; personal | no |
| 17 | `get_phone_systems` | `{}` | `GET /orgs/:orgId/phone-systems` | no |
| 18 | `get_streaming` | `{}` | `GET /orgs/:orgId/media` (Seerr request info is live); personal | yes |

Descriptions (sent to the model; English):

- `list_servers`: "List the organization's servers with status, plan, location and labels. Filter by name, status
  or label."
- `get_server`: "Stored details of one server: status, plan, IP addresses, image, protection, project."
- `get_server_metrics`: "Live CPU, memory, disk and network metrics of one server for a range, plus its
  monitoring summary."
- `get_server_activity`: "Recent actions on one server (start, stop, backups, rebuilds) with their results, and its
  audit entries."
- `list_domains`, `get_domain`: "Domains and DNS zones of the organization" / "One domain with registrar status,
  expiry, name servers and linked zone."
- `get_dns_records`: "All DNS records of one zone as the provider serves them."
- `list_websites`, `get_website`: "Websites and web spaces" / "One website with runtime, certificate, databases and
  status notices."
- `check_website_dns`: "Whether the website's domain and www point to its server (A and AAAA), as the console
  checks it."
- `list_mail_domains`, `get_mail_domain`: "E-mail domains" / "One e-mail domain with limits, usage and status."
- `get_mail_dns_setup`: "The DNS records the console computed for one e-mail domain (MX, SPF, DKIM, DMARC,
  autoconfig) with the status of each in the zone."
- `get_monitoring`, `get_monitor`: "Monitors and status pages" / "One monitor with its live state and history."
- `get_cloud_storage`, `get_phone_systems`, `get_streaming`: "Cloud storage accounts and allowance" / "Phone
  systems with users and trunks" / "Streaming accounts and allowance."

### 8.3 Organization, billing and audit tools

| # | Tool | Input | Reads | Live |
|---|---|---|---|---|
| 19 | `get_org_overview` | `{}` | `GET /orgs/:orgId` (counts, modules, kind, status, reseller) | no |
| 20 | `get_billing_summary` | `{}` | `GET /orgs/:orgId/billing/summary` and `GET /orgs/:orgId/invoices?status=open&perPage=20`; `forbidden` without `billing:read` (viewers) | no |
| 21 | `get_audit_log` | `{ action: string \| null, resource_type: string \| null, status: 'success' \| 'failure' \| 'denied' \| null }` | `GET /orgs/:orgId/audit?perPage=50` (needs `audit:read`); personal; blocked-customer filter | no |
| 22 | `propose_dns_record` | 8.4 | `loadDnsContext` (10.2) | yes |

- `get_org_overview`: "Name, kind, status, active modules and resource counts of the organization."
- `get_billing_summary`: "Credit balance, open invoices and active services of the organization."
- `get_audit_log`: "Newest audit log entries of the organization, filterable by action prefix, resource type and
  status. IP and e-mail addresses are removed."

**Personal filter.** `personal: true` tools pass every entry through `redactForAi(entry, { personal: true })`
(11.2): `ip`, `userAgent`, `user_agent` and `email` keys are dropped and e-mail-shaped values replaced by
`[email]` (plan O28). Actor names stay (an audit summary must say who did what); the notice says so (13.10).

**Blocked-customer filter** (review #4). In a reseller's audit log, entries about a customer whose AI is off
(declined, switched off, `aiOrgState(...).enabled` false) are dropped before the model sees them: entries with
`resourceType = 'org'` and `resourceId` of such a customer, and entries whose `details` name such a customer
(`customerOrgId`, `customerId`, `orgId`, as `reseller.customer_*`, `reseller.resource_*` and the billing job
write them). The tool result says how many were left out (`hidden`).

### 8.4 Proposals

**`propose_dns_record`** is the only tool that is not a plain read. It reads, validates and returns a proposal; the
console shows it as a card and, on request, opens the normal DNS form pre-filled (12.3). Nothing is saved.

```ts
const proposeDnsInput = z.object({
  domain_id: z.uuid(),
  action: z.enum(['add', 'change']),
  record_id: z.string().max(200).nullable(), // required for 'change'
  type: z.enum(['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'CAA']),
  name: z.string().max(253), // relative to the zone, "@" for the apex
  data: z.string().max(2048),
  ttl: z.number().int().min(60).max(86_400).nullable(),
  reason: z.string().max(500),
});
```

Validation (`validateDnsProposal(ctx, reader, input)` in `modules/ai/proposals.ts`, shared with the DNS check
10.2):

1. `loadDnsContext(reader, { domainId })` (10.2): the zone must be the organization's (`owned('domain')`).
2. The record must pass the console's own record rules: `dnsRecordBody` and `dnsDataIssue` exported from
   `apps/api/src/modules/hosting/dns.ts:52,115`; the type must be in `DomainDetailDto.dnsRecordTypes`.
3. `change` needs a `record_id` of an existing record of the zone with the same type; NS records and the deletion of
   records are not proposable at all (the enum has no NS and no `delete`), and a `change` of an MX record or of an
   apex A/AAAA record is accepted only when the new value is a `verified` one. Removing or replacing mail
   delivery or the website's address on the model's word is never offered as a form (plan decision 23).
4. **`verified`**: true only when `(type, name, data)` equals, after normalizing case, trailing dots and TXT
   quoting, a record the console computed itself for this zone: a `MailDnsRecordDto` with non-empty `data` from
   `GET /mail/domains/:id/dns`, or an expected A/AAAA of a website on that name from `GET /webspaces/:id/dns-check`
   (`WebsiteDnsCheckDto.expected`). Everything else is unverified (review #5: text in TXT records, monitor
   messages or SMTP errors can inject values).
5. **`textOnly`**: true when the zone is not in the console, `DomainDetailDto.dnsWritable` is false, the person lacks
   `domain:dns:write` on the domain (from `DomainDto.permissions`), or the type is not supported by the provider. The
   card then shows the record as text with a copy button.

The tool answers the model `{ proposal_id, verified, text_only }` (or `{ "error": "invalid", "issue": "..." }`), and
the chat sends `proposal` (`AiDnsProposalDto`) to the browser. An unverified proposal carries the badge "Nicht von
weblion.one geprüft" and needs an extra confirmation before the form opens (12.3).

**`propose_monitor` is dropped** (plan O31, review #23): monitors are created in a few clicks, the proposal would
need its own validation of target hosts and ports, and the allowance check would have to run twice.

---

