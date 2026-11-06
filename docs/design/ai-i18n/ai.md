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
