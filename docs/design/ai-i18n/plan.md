# Build plan: KI-Modul (Claude) and five languages (de, en, fr, it, nl)

Repository `/home/user/weblion-db`, base `main` = `c6c51ad` (branch `claude/nice-mendel-eiwx53`). This plan merges
the two designs into one build:

- `scratchpad/design/i18n.md` (five languages, translation admin, Mass Translate), cited as "i18n x.y"
- `scratchpad/design/ai.md` (AI module), cited as "ai x.y"
- `scratchpad/design/ai-i18n-map.md` (code map), cited as "map x.y"

Both designs stay the detailed specification. **Where this plan says something different, this plan wins**
(section 1 lists every override). Engineers read this plan first, then the design sections their unit names.

Conventions for every unit: identifiers and code comments in English, docs and commit messages in German, German
UI copy in formal "Sie" with Swiss spelling (ss, never the sharp s), no em dash (U+2014) anywhere (code, comments,
prompts, UI copy, docs, translations). Prettier as configured (`singleQuote`, `printWidth: 110`). Every write
route is audited with secrets redacted; every route checks a permission; invisible resources are 404.

Contents

0. Order of work and branches
1. Decisions that resolve the conflicts between the two designs (overrides)
2. Shared contracts (exact signatures every unit relies on)
3. Data model, settings keys, locks
4. Permissions, roles, audit actions, rate limits
5. Foundation (F)
6. Build units U1 to U4
7. Translation units T-<locale>-<group> and reviews R-<locale>
8. Integration (I)
9. Docs (D)
10. Product decisions
11. File ownership matrix
12. Review (findings of `ai-i18n-review.md`, applied or rejected)

---

## 0. Order of work and branches

```
F (one engineer)
 ├─ U1 i18n admin API, Mass Translate job, translation admin page
 ├─ U2 i18n runtime (web), language pickers with flags, formatting, e-mails, PDF, billing language
 ├─ U3 AI API (switches, limits, budget, tools, chat SSE, features)
 ├─ U4 AI web (KI page, per-customer switches, assistant, feature buttons)
 ├─ T-fr-A  T-fr-B  T-fr-C  ─> R-fr  ┐
 ├─ T-it-A  T-it-B  T-it-C  ─> R-it  ├ complete fr / it / nl bundles of the key set at the F commit
 └─ T-nl-A  T-nl-B  T-nl-C  ─> R-nl  ┘ (A, B, C = section groups of 7.1; R = review of the whole language)
I (integrator): merge, translate late keys, all checks, end to end, screenshots, review
D (docs)
```

- Every build unit and translation unit branches from the F commit (`ai-i18n/f`) as `ai-i18n/u1` ... `ai-i18n/u4`
  and `ai-i18n/t-<locale>-<group>` (for example `ai-i18n/t-fr-a`). The 13 run in parallel. When the three group
  units of a language are done, its review unit R-<locale> creates `ai-i18n/t-<locale>` from the F commit, merges
  the three group branches (their files are disjoint, 11), reviews and fixes the whole language (7.4) and hands
  `ai-i18n/t-<locale>` to the integrator.
- A unit edits only the files section 11 assigns to it. Reading any file is allowed. If a unit needs a change in a
  file it does not own, it does not make it: it describes the change (file, exact edit, reason) in its final report
  and works around it locally (for example with a local helper). The integrator applies it.
- No unit adds a migration, a dependency, an env variable or a permission. If one seems necessary, the unit stops
  that part and reports it.
- i18n keys: a unit may add keys (de and en together) only to the sections it owns (section 11), then runs
  `pnpm --filter @weblion/api i18n:stamp --locale en --section <section>`. It never renames or deletes a key, never
  touches `*.fr|it|nl.ts`, and changes an existing de/en value only to fix an error in its own section (listed in the
  report; the integrator re-translates it, it shows as "Veraltet").
- Each unit ends green on its own branch: `pnpm typecheck`, `pnpm test`, `pnpm build`, prettier check of the CI
  globs. Its final report lists: files touched, late i18n keys added (key, de, en), changes requested in files of
  others, known gaps.

---

## 1. Decisions that resolve the conflicts (overrides)

| # | Topic | i18n.md says | ai.md says | **Decision (binding)** |
|---|---|---|---|---|
| O1 | Locale constants | `packages/shared/src/i18n/locales.ts` | imports `./locales` | `packages/shared/src/i18n/locales.ts` (i18n 2), re-exported from the package index. `ai.ts` imports `./i18n/locales`. |
| O2 | Dictionary location | move all to `packages/shared/src/i18n/` | new section in `apps/web/src/i18n/sections/ai.*` | Move (i18n 3). The AI texts become section `ai` at `packages/shared/src/i18n/sections/ai.{de,en,fr,it,nl}.ts`. `nav.admin.ai` and `perm.group.ai` go to section `core`. `apps/web/src/i18n/` is deleted. |
| O3 | Permission labels | `perm.<action>` keys | `def(group, de, en)` labels | Keys (i18n 3.3). New keys `perm.ai:use`, `perm.ai:settings`, `perm.platform:ai:use`, `perm.platform:i18n:read`, `perm.platform:i18n:write` in `core` with the texts of ai 3.2 and i18n 11. |
| O4 | Claude call for translations | `ctx.ai.structured()` with its own shape | `ctx.ai.translate()` with own prompt, batching and checks | **One path**: `ctx.ai.structured()` (section 2.4) used by every JSON feature including translations (batches pass `retryOnMaxTokens: false`). The i18n translator (`apps/api/src/i18n/translator.ts`) owns batching, system prompt, validation, repair batches and retries (i18n 12). ai 10.7 (`translate()`, `AiTranslateItem/Input/Result`) and the `# Feature: translations` prompt of ai 10.8 are **dropped**. The translator's system prompt starts with the line `# Feature: translations` so the demo emulator can route it. |
| O5 | AI availability for i18n | `ctx.ai.status()` with `reason: disabled \| not_configured` | `assertFeature()` (404) and `GET /ai/status` | `ctx.ai.availability(feature)` returns `AiAvailabilityDto` (2.3) with `reason: 'disabled' \| 'not_configured' \| 'feature_off' \| null`. i18n AI routes turn "not available" into 409 `ai_not_configured` with `details: { reason }`; AI routes keep 404. |
| O6 | AI error codes seen by i18n | own `AiError` codes (`ai_rate_limited`, ...) | AppError codes of ai 4.2 | ai 4.2 codes only. The job maps them with the table in 2.6. |
| O7 | Cost of an estimate | `ctx.ai.estimateCostMicros()` | `aiCostMicros()` in shared | `aiCostMicros(model, usage, AI_DEFAULT_MODEL)` from `@weblion/shared`. |
| O8 | Effort, tokens, streaming for translations | effort `medium`, 16,000 tokens, non-streaming | effort `low`, 32,000, streamed | Effort **`medium`**, `max_tokens` **32,000**, **streamed** with `finalMessage()` (every call of the module is streamed). Rationale: a background job where quality matters more than latency; 32,000 leaves room for adaptive thinking. |
| O9 | Limits for translations | own limiter 30 per minute for suggest and estimate | `reserve({ countsForUser: false })` | Job batches: `countsForUser: false` = no per-person rate, daily or concurrency check, no organization limit; the **monthly budget applies**. Suggest (B1): `countsForUser: true` and `ctx.ai.countRate()` (12 per minute per person, 2 concurrent, person daily limit); the i18n limiter for suggest is dropped. Estimate (B2) calls no model: global limit only. Import keeps its 10 per minute. |
| O10 | Gate of the i18n AI routes | `platform:i18n:write` + AI available | also `platform:ai:use` | B1, B2, B3, B7: `requireSession`, `platform:i18n:write` **and** `platform:ai:use`, then `availability('translations')` else 409 `ai_not_configured`. Manual editing, import and export need no AI. |
| O11 | Demo mode for translations | `[FR] <English>` without calling Claude, saved | `[fr] <source>`, never saved | Demo goes through the emulator like every AI call (ai 14). The emulator answers `[FR] <German text>` (code in capitals; German keeps placeholders, line breaks and glossary terms valid). **Demo results are saved** (origin `ai`, unreviewed, `translation_overrides.demo = true`) so the whole flow can be shown; the job row gets `demo = true` and the UI shows the "Demo" badge (`ai.demoBadge`) on the job and the note `admin.i18n.ai.demoNote` in the dialog. Demo mode only exists with `ENABLE_DEMO_PROVIDER=true` and no key. Demo overrides are served only while `ENABLE_DEMO_PROVIDER` is true, `PUT /admin/ai/key` deletes them, cleanup A8 has `demo: true` (i18n 8.1, 12.10). |
| O12 | Migrations | `0010_i18n` or `0011_i18n` | `00NN_ai` | Both in F, in this order: `apps/api/drizzle/0010_ai.sql`, then `apps/api/drizzle/0011_i18n.sql` (section 3). No unit adds a migration. |
| O13 | Stamp and allowlist files | one file per locale `stamps/<locale>.json` | | One stamp file per locale **and section**: `packages/shared/src/i18n/stamps/<locale>/<section>.json`; one allowlist file per locale **and translation group**: `packages/shared/src/i18n/allowlists/<locale>/<a\|b\|c>.ts` (so units and translators never edit the same file). `i18n:stamp` takes `--locale <l>` and `--section <s>`. |
| O14 | Product translations | not designed | `products.translations`, `ProductTranslations` in `ai.ts` | Column and route field as ai 10.6, type `ProductTranslations` in `packages/shared/src/billing.ts` keyed by `TargetLocale` (German stays in `name`/`description`), helper `productText(product, locale)`. The invoice editor fills lines from a product in the invoice's language (`InvoiceDetailDto.locale`). Stored invoice lines stay text. |
| O15 | Mail template `ai_budget` | template keys `email.*` | literal texts in templates | Keys `email.aiBudget.*` in section `email` (texts in 5.3). F adds the type and a builder in today's style; U2 converts it to keys together with the other templates. |
| O16 | Nav order | after settings | after audit, before settings | `... Audit-Log`, **KI** (`/admin/ai`, `Sparkles`, `platform:settings`), **Übersetzungen** (`/admin/translations`, `Languages`, `platform:i18n:read`), `Einstellungen` stays last. Done in F. |
| O17 | Claude mock | U3 of i18n writes one if needed | A2 owns `test/claude-mock.ts` | F writes `apps/api/test/claude-mock.ts` (skeleton in 5.2, F19); U3 owns it afterwards and only adds features. |
| O18 | Notice edit link | | "route from i18n.md" | `/admin/translations?tab=entries&q=ai.notice.text` (query contract in 2.9). |
| O19 | SDK version | | caret range, at least 0.136.0 | Exact **`"@anthropic-ai/sdk": "1.3.0"`** in `apps/api` `dependencies`. Checked in the review against the published tarball: released 2026-10-23T23:31Z (14 days before this plan), `client.beta.messages.stream()`, `finalMessage()`, `fallbacks?: BetaFallbacksParam \| null` with `BetaFallbacksParam = Array<BetaFallbackParam> \| 'default'`, beta string `'server-side-fallback-2026-07-01'`, `output_config.effort` (`low` ... `max`) and `format`, `strict` tools, `stop_details`, typed `usage.iterations`, `APIError.type` (`ErrorType` incl. `overloaded_error`, `billing_error`), error classes `BadRequestError`, `AuthenticationError`, `PermissionDeniedError`, `NotFoundError`, `RateLimitError`, `InternalServerError`, `APIConnectionTimeoutError`, `APIUserAbortError`, `APIConnectionError`, `APIError`; sends `anthropic-version: 2026-10-21`; no install scripts; optional peer `zod ^3.25 \|\| ^4`. F still runs the typecheck spike of F10 step 0 before writing the module; the `WithFallbacks<T>` workaround of ai 6.2 is only the fallback if the spike fails. |
| O20 | Who builds which part | 9 units | 6 units | Four build units (section 6). F builds every shared piece incl. AI settings routes and `structured()` because U1's tests need a working AI path. |
| O21 | Late i18n keys | translators start after U1 to U4 | | F adds **every** de/en key both designs list plus section 5.3. Translators translate the key set of the F commit. Units may add keys only to their own sections (de/en); the integrator translates those late keys (8.2). |
| O22 | Budget for Mass Translate | job counters only | `ai_usage` per request | Both: every batch call writes one `ai_usage` row (`scope 'platform'`, `feature 'translations'`, `org_id null`, `user_id` = starter); the job sums tokens and cost into `translation_jobs`. The estimate shows the remaining monthly budget (`budgetRemainingMicros`) and warns when it is not enough. B3 refuses with 429 `ai_limit` `{ limit: 'budget' }` only when the budget is already exhausted. |
| O23 | `ai.md` web shell edits (`AppShell`, `useApiMutation`, `ErrorState`, `ApiError`) | i18n web owns the same files | | F makes every shared edit in those files with stubs (5.4, F24 to F26); afterwards `app-shell.tsx` belongs to U2, the `components/ai/*` stubs to U4. |
| O24 | Translation filter for staff | | | The i18n `prefix` filter uses the first key segment: AI admin texts (`admin.ai.*`) appear under "admin", customer AI texts under "ai". |
| O25 | Error texts in the web | `localizeError(err, t)` for generic codes | `aiErrorText(t, err)` in `lib/api/ai.ts` | One mapping: `localizeError` (`lib/api-errors.ts`, U2) also maps the AI codes (table in 6, U2); U4's `aiErrorText(t, err)` only calls `localizeError(err, t)`. |
| O26 | Reading resources by id | | `assertSameOrg` on bodies with `org` | `ConsoleReader.owned(kind, id)` loads the parent and fails closed unless `body.org?.id === orgId` (`org: null` too); sub-paths are refused unless their parent was verified in the same run; tool results escape `<` and `>` (ai 8.1). |
| O27 | Declining AI | | card only when platform AI is on; suspended orgs cannot decide | The decline card, the staff card and the reseller card show whatever the platform state; their routes never call `assertFeature`; `'ai:settings'` is added to `SUSPENDED_ALLOWED`; the KI page's master switch asks for the go-live checklist (ai 1, 5.5, 12.4, 16). |
| O28 | Personal data and the data notice | | full name in `<context>`, IPs and e-mails in audit data, notice says passwords are "never sent" | `<context>` carries the role only; `redactForAi(value, { personal: true })` for every audit entry; staff requests carry the customer's `org_id` and appear in its usage; new `ai.notice.text`; `LEGAL_KEYS` (`ai.notice.title`, `ai.notice.text`) are never machine-translated and never served stale (i18n 8.1). |
| O29 | Budget and concurrency | pre-check per request | pre-check per request, 2 concurrent per person | Hard stop: `budgetExceeded()` after every chat API call, per-turn caps (5 x estimate, 120,000 tool-result characters, 8 live tool calls), 3 concurrent per organization, 6 on the platform, 30 live reads per organization and minute, Mass Translate stops at 1.5 x its estimate, stale bound `AI_TURN_TIMEOUT_SECONDS + 60 s` (ai 6.4, 7.1, 7.3, i18n 12.6). |
| O30 | Last chat call | | `tool_choice: none` on call 8 | `tool_choice: auto` on every call; before the last call a `FINAL_STEP_NOTE` text block after the tool results (ai 6.3, 6.4). |
| O31 | Scope | `format=ts` export | `customer_summary`, `propose_monitor` | All three dropped (i18n 16.3, ai 10.5, 8.4). Seven AI features remain (section 10, decision 32). |
| O32 | Error codes | specific API messages stay English | 409 `conflict` for reseller cases | Every new AI and i18n error has its own code and a translated text (2.10, frozen by F); `ai_upstream`, `ai_busy`, `ai_incomplete`, `ai_timeout` carry fixed English messages, never Anthropic's (ai 4.2). |
| O33 | Web and server texts | one aggregator per locale | | Web aggregators without `email` and `pdf`; `server.ts` aggregators for the API; types `TranslationKey` (web) and `ServerTranslationKey` (API) (i18n 3.1). |

---


## 2. Shared contracts / 3. Data model, settings keys, locks / 4. Permissions, roles, audit actions, rate limits

> LOST in the container restart of 06.11.2026 (plan lines 111 to 485). Regenerated in `contracts.md` of this folder.

## 5. Foundation (F)

One engineer, branch `ai-i18n/f` from `c6c51ad`. Ordered checklist. Commit message (German):
"Fundament für KI-Modul und fünf Sprachen".

### 5.1 Shared package

- **F1 Dictionary move.** `git mv apps/web/src/i18n/sections/*.ts packages/shared/src/i18n/sections/`. Move the
  724 inline keys of `apps/web/src/i18n/de.ts` and `en.ts` unchanged (with their comments) into
  `sections/core.de.ts` (`export const coreDe = { ... } as const;`) and `core.en.ts`
  (`export const coreEn: Record<keyof typeof coreDe, string>`). Delete `apps/web/src/i18n/`. Create empty
  `sections/<s>.fr.ts`, `.it.ts`, `.nl.ts` for all 16 sections
  (`export const adminFr: Partial<Record<keyof typeof adminDe, string>> = {};`).
- **F2 Library files.** `locales.ts`, `interpolate.ts`, `placeholders.ts`, `types.ts` (web and server key types,
  2.2), web aggregators `de.ts` ... `nl.ts` without `email` and `pdf`, `server.ts` with all 16 sections (i18n 3.1),
  `glossary.ts` (`DEFAULT_GLOSSARY` = i18n 19.3 plus 7.3 of this plan), `checks.ts` with the **exported check
  predicates** of i18n 19.4 and the nine `allowlists/<locale>/<group>.ts` (2.2), `catalog.ts` (2.2, server
  bundles), `i18n.test.ts` with checks 1 to 11 of i18n 19.4 calling those predicates (check 11 is French
  typography: fr values fail on an ASCII space before `:` or `%`, and on any space before `?`, `!`, `;`;
  allowlist `typographyOk`).
- **F3 New de/en keys.** Every key of i18n 18.1 (core, billing), 18.2 (translations), 18.3 (email; English from
  today's `mail/templates.ts`), 18.4 (pdf), ai 13 (section `ai`; `nav.admin.ai`, `perm.group.ai` into `core`),
  the `perm.<action>` keys for all 93 + 5 actions and `module.<m>.label|description` for the 8 modules (today's
  texts of `permissions.ts` and `modules.ts`), and the keys of 5.3 below. Afterwards run
  `pnpm --filter @weblion/api i18n:stamp --locale en` (writes `stamps/en/*.json`).
- **F4 Package exports.** `packages/shared/package.json` `"exports": { ".": "./src/index.ts", "./i18n/*": "./src/i18n/*.ts" }`.
  `index.ts` adds `export * from './i18n/locales'`, `'./i18n/interpolate'`, `'./i18n/placeholders'`,
  `export type * from './i18n/types'`, `'./translations'`, `'./ai'`. Never a dictionary.
- **F5 Permissions, roles, modules.** 4.1; `def(group, extra)` without labels; `PermissionDef` without `label`;
  `ModuleDef` keeps only `actions` (i18n 3.3).
- **F6 `ai.ts`** per 2.3 and `ai.test.ts` (ai 3.1 cases).
- **F7 `translations.ts`** per i18n 14.1, with `TranslationSummaryDto.ai: AiAvailabilityDto`,
  `TranslationSummaryDto.demoOverrides: number`, `TranslationJobDto.demo: boolean`,
  `TranslationEstimateDto.budgetRemainingMicros: number | null`, `TranslationEstimateDto.legal: number`,
  `TranslationFailure.reason` with `german`, `formality`, `content`, and `LEGAL_KEYS`.
- **F8 `billing.ts`, `dto.ts`** per 2.7 and 2.3 (`IntegrationsDto.ai`).
- **F9 Shared tests.** `access.test.ts`: `aiDenyStatements` with the policy engine (org off, opt-out, reseller
  cascade via a parent boundary, `ai:settings` still allowed, suspended boundary has no `ai:use`, support role has
  `ai:use` and `platform:ai:use` and `platform:i18n:read`, not `platform:i18n:write`).

### 5.2 API

- **F10 Dependency.** Step 0, before any module code: `pnpm view @anthropic-ai/sdk@1.3.0 version time`, then a
  throwaway typecheck spike (about 20 lines in a scratch file, not committed) that type-checks
  `client.beta.messages.stream({ model: 'claude-opus-5-5', max_tokens: 1, thinking: { type: 'adaptive' },
  output_config: { effort: 'medium', format: { type: 'json_schema', schema: {} } }, betas:
  ['server-side-fallback-2026-07-01'], fallbacks: 'default', tools: [{ name: 'x', description: 'x', input_schema:
  { type: 'object', properties: {} }, strict: true }], messages: [{ role: 'user', content: 'x' }] })`, reads
  `message.stop_details`, `message.usage.iterations` and `err.type`, and names the ten error classes of O19. If the
  spike fails, take the newest release that is at least 14 days old and passes, record it in the PR description,
  and type the params through ai 6.2's `WithFallbacks<T>` if only the `fallbacks` scalar is missing. Then
  `pnpm --filter @weblion/api add @anthropic-ai/sdk@1.3.0 --save-exact` (in `dependencies`,
  the server installs with `--prod`); commit `pnpm-lock.yaml`. Add `"scripts"` to `apps/api/tsconfig.json`
  `include`. Scripts in `apps/api/package.json`: `"i18n:stamp": "tsx scripts/i18n-stamp.ts"`,
  `"i18n:apply": "tsx scripts/i18n-apply.ts"`, `"i18n:report": "tsx scripts/i18n-report.ts"`.
- **F11 Env** (`config/env.ts`, `.env.example` section `# --- Claude (KI) ---` and `# --- Übersetzungen ---`, English
  comments): `ANTHROPIC_API_KEY` (optionalString), `ANTHROPIC_BASE_URL` (url, default `https://api.anthropic.com`),
  `ANTHROPIC_MAX_RETRIES` (0..5, default 2), `AI_TURN_TIMEOUT_SECONDS` (30..600, default 180),
  `I18N_JOB_ENABLED` (`bool(true)`), `I18N_AI_CONCURRENCY` (1..4, default 2).
- **F12 Schema and migrations** (3.1).
- **F13 Redaction.** `apps/api/src/lib/redact.ts` exports `SECRET_KEY_PATTERN` (moved from
  `modules/admin/routes.ts:465`, plus `credential|cookie|^session`; admin routes import it);
  `apps/api/src/modules/ai/redact.ts` `redactForAi(value: unknown, opts?: { personal?: boolean }): unknown` and
  `redactText(s: string): string` per ai 11.2 (patterns, exact env secret values collected at startup, current
  Anthropic key, 4,000 character cap; `personal: true` drops `ip`, `userAgent`, `user_agent`, `email` keys and
  replaces e-mail-shaped values by `[email]`), `toolJson(value)` (JSON with `<`, `>` escaped, ai 8.1) with
  `redact.test.ts`.
- **F14 Boundary.** `auth/access.ts` `effectiveBoundary` appends `aiDenyStatements(org)` (ai 3.4), and
  `SUSPENDED_ALLOWED` gains `'ai:settings'` (ai 3.3; comment: a suspended organization must still be able to
  decline, because staff features ignore suspension).
- **F15 AI module core** (`apps/api/src/modules/ai/`): `errors.ts` (ai 4.2 helpers: `aiLimit`, `aiRefusal`,
  `aiUpstream`, `aiIncomplete`, `aiBusy`, `aiTimeout`, `aiOrgDisabled`, `aiPlatformLocked`, `aiResellerBlocked`,
  `aiAdminKey`; `AI_ERROR_MESSAGES` fixed English texts; `classifyAiError` ai 6.8 with the `err.type` branch),
  `settings.ts` (ai 5.1, 5.2), `client.ts` (`createAnthropic` ai 6.1, `baseParams(model, feature, userId)` ai 6.2
  with `AI_FEATURE_EFFORT`/`AI_FEATURE_MAX_TOKENS`), `schema.ts` (`toStrictJsonSchema` ai 6.5 + test),
  `prompts.ts` (`BASE_RULES` and the six feature prompts of ai 10.8: assistant, explain, dns_check,
  audit_summary, server_health, product_texts; **without** `translations`; `SYSTEM_TEXT:
  Record<Exclude<AiFeature, 'translations'>, string>`; + `prompts.test.ts`), `usage.ts` (`UsageTotals`,
  `reserve` with the three concurrency caps and the stale bound `AI_TURN_TIMEOUT_SECONDS + 60 s`, `finish` ai 6.7
  and 7.1, `budgetState`, `budgetExceeded`; `checkBudgetWarning` as an empty async function for U3),
  `service.ts` (2.4), `demo.ts` (`demoFetch`, `emulateMessages` for `GET /v1/models/:id` and feature
  `translations` (O11); every other feature returns a valid minimal object built from a per-feature constant
  `DEMO_JSON` that U3 completes, and `assistant` returns the marker text without tool use until U3 adds it),
  `routes.ts` (complete: `GET /ai/status`, `GET/PUT /admin/ai/settings`, `PUT/DELETE /admin/ai/key` (with the
  `ai_admin_key` refusal and `deleteDemoOverrides` in the key transaction), `POST /admin/ai/test`, ai 5.4), stubs
  registered in `app.ts`: `org-routes.ts` (`aiOrgRoutes`),
  `admin-routes.ts` (`aiAdminRoutes`), `feature-routes.ts` (`aiFeatureRoutes`), `chat-routes.ts`
  (`aiChatRoutes`), each `export async function x(app: FastifyInstance, ctx: AppContext): Promise<void> {}`;
  `sse.ts` (class `SseWriter` with the ai 9.3 methods, bodies throw "not implemented"), `maintenance.ts`
  (`class AiMaintenance { constructor(ctx: AppContext, pool: pg.Pool); start(): void; stop(): void }`, empty).
- **F16 i18n API core**: `apps/api/src/i18n/{hash,service,glossary,entries,jobs}.ts` per 2.5 (`service.ts` with
  the demo-row and `LEGAL_KEYS` rules, `entries.ts` with `deleteDemoOverrides`);
  `modules/i18n/routes.ts` (`i18nRoutes`) with **A1 implemented** (i18n 13) and nothing else;
  `modules/i18n/ai-routes.ts` (`i18nAiRoutes`) empty; `apps/api/scripts/i18n-stamp.ts` implemented (i18n 4.3 with
  `--locale`, `--section`, `--confirm`); `scripts/i18n-apply.ts` and `scripts/i18n-report.ts` printing
  "not implemented" and exiting 1.
- **F17 Wiring.** `context.ts`: `ai: AiService`, `i18n: I18nService`, `i18nJobs: TranslationJobRunner`.
  `app.ts`: `BuildOptions.i18nCatalog?: I18nCatalog`; create `I18nService` first, `await i18n.load()`,
  `await seedGlossary(db)`, then `MailService` (constructor gains `i18n`), `AiService`; after the plugins
  `ctx.ai.attach(app)`; register `i18nRoutes`, `i18nAiRoutes`, `aiRoutes`, `aiOrgRoutes`, `aiAdminRoutes`,
  `aiFeatureRoutes`, `aiChatRoutes` in the `/api/v1` list. `index.ts`: `ctx.i18n.start()`, `ctx.i18nJobs.start()`
  when `I18N_JOB_ENABLED`, `new AiMaintenance(ctx, pool).start()`; all stopped in `shutdown`.
- **F18 Small API edits forced by the types.** `modules/meta/routes.ts` labels from the dictionaries (i18n 3.3);
  `lib/dto.ts` `toUserDto` `locale: normalizeLocale(row.locale) ?? 'de'`; `modules/auth/routes.ts` PATCH body
  `locale: z.enum(LOCALES).optional()` (nothing else there); `modules/billing/dto.ts` `translations`, `locale`,
  invoice detail `locale`; `modules/billing/routes.ts` product POST/PATCH accept
  `translations: z.record(z.enum(TARGET_LOCALES), z.object({ name: z.string().trim().min(1).max(200), description: z.string().max(1000).nullable() })).optional()`;
  `modules/settings/routes.ts` integrations `ai: await ctx.ai.integrationStatus()`; `mail/types.ts` template
  `ai_budget` (2.8) and `mail/templates.ts` builder `ai_budget` in today's de/en style with the texts of 5.3;
  `db/seed.ts` calls `await seedI18nDemo(db)` from a new `db/seed-i18n.ts` stub (`export async function seedI18nDemo(db: Database): Promise<void> {}`).
  Fix every other compile error from the wider `Locale` with the smallest change (English fallback), comment
  `// i18n: U2 replaces this`.
- **F19 Test helpers and mock.** `test/helpers.ts`: option `i18nCatalog`, env defaults `ANTHROPIC_BASE_URL:
  'http://127.0.0.1:9'` (unless given) and `ANTHROPIC_MAX_RETRIES: '0'`. `test/claude-mock.ts`:
  ```ts
  export interface MockTurn {
    text?: string; json?: unknown;
    stopReason?: 'end_turn' | 'max_tokens' | 'refusal';
    refusalCategory?: string | null;
    model?: string;
    usage?: Partial<{ input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }>;
    error?: { status: 400 | 401 | 402 | 403 | 404 | 429 | 500 | 529; type: string; message: string; headers?: Record<string, string> };
    delayMs?: number;
    gate?: Promise<void>;           // awaited before the answer (cancel tests)
    /** After afterFrames SSE frames: `event: error` with { type: 'error', error: { type, message } }, then end. */
    midStreamError?: { type: 'overloaded_error' | 'api_error' | 'rate_limit_error'; message?: string; afterFrames: number };
  }
  export interface RecordedClaudeRequest { method: string; path: string; headers: IncomingHttpHeaders; body: any }
  export async function startClaudeMock(opts?: { apiKey?: string; port?: number;
    script?: (body: any, index: number) => MockTurn | undefined }): Promise<{ url: string;
    requests: RecordedClaudeRequest[]; setScript(fn: (body: any, index: number) => MockTurn | undefined): void; close(): Promise<void> }>;
  ```
  Node `http`; `x-api-key` check (default `sk-ant-test-0000000000000000000000`, else 401
  `authentication_error`); `GET /v1/models/:id` (404 outside `AI_MODELS` and the fallback ids); `POST /v1/messages`
  with `stream: true` as SSE frames (`message_start`, `content_block_start/delta/stop` with `text_delta`,
  `message_delta` with `stop_reason`, `stop_details` and usage, `message_stop`), else JSON; errors as
  `{ type: 'error', error: { type, message }, request_id }`; header `request-id: req_mock_<n>`; no script answer ->
  `emulateMessages(body)`.
- **F20 F tests** (they stay green in every unit): `test/ai-settings.test.ts` (ai 15.2 row "ai-settings"),
  `test/ai-structured.test.ts` (request shape for Opus, Sonnet, Haiku: exact model, `thinking.type 'adaptive'`,
  `output_config.effort` per feature, `output_config.format`, system `cache_control`, `stream: true`, betas header
  and `fallbacks: 'default'` only on Opus and Sonnet, no sampling fields, ends with a user turn; refusal 422 and
  usage status `refusal`; `max_tokens` retried once with double room then 502; 401 -> `ai_upstream auth`;
  529 -> `ai_busy overloaded`; 500 -> `ai_upstream server`; mid-stream `overloaded_error` -> `ai_busy
  overloaded` and `api_error` -> `ai_upstream server`; a 402 `billing_error` "Your credit balance is too low"
  -> 502 whose message is the fixed text (no "credit", no "balance") while `ai_usage.error_message` keeps the
  redacted original; `retryOnMaxTokens: false` sends no second request; budget reservation 429; platform
  concurrency cap 429 `concurrent`; tokens and cost on the row; demo translations `[FR] ...` with cost 0;
  availability reasons), `test/i18n-service.test.ts` (A1: 200 without cookie, ETag, 304, 404 for `es`, orphan
  rows not served; `t` fallback chain fr -> en -> de; `demo` rows served only with `ENABLE_DEMO_PROVIDER`; a stale
  fr override of `ai.notice.text` is not served and `payload('fr')` carries the English text for that key),
  `test/i18n-stamps.test.ts` (i18n 4.3 and the `I18N_REQUIRE_LEGAL` case), `test/migrations.test.ts` (i18n 10:
  migration on data from `0009`, journal order). Fix existing tests broken by the label move.

### 5.3 Keys added by this plan (de / en; in the named section)

| Key (section) | de | en |
|---|---|---|
| `nav.admin.translations` (core) | Übersetzungen | Translations |
| `admin.i18n.ai.featureOff` (translations) | Die KI-Funktion Übersetzungen ist unter Verwaltung > KI ausgeschaltet. | The AI translations feature is switched off under Administration > AI. |
| `admin.i18n.ai.budgetWarning` (translations) | Das verbleibende KI-Budget dieses Monats (ca. USD {remaining}) reicht voraussichtlich nicht. Die Übersetzung stoppt, wenn das Budget aufgebraucht ist; danach sind auch die übrigen KI-Funktionen bis Monatsende gesperrt. | The AI budget left this month (about USD {remaining}) is probably not enough. The translation stops when the budget is used up; after that, the other AI features are blocked until the end of the month as well. |
| `admin.i18n.ai.demoNote` (translations) | Demo-Modus: Statt einer echten Übersetzung wird der deutsche Text mit dem Sprachcode in Klammern gespeichert, zum Beispiel [FR]. | Demo mode: instead of a real translation, the German text is saved with the language code in brackets, for example [FR]. |
| `email.aiBudget.warning.subject` (email) | KI-Budget zu {percent} % verbraucht | AI budget {percent} % used |
| `email.aiBudget.warning.heading` | KI-Budget fast aufgebraucht | AI budget almost used up |
| `email.aiBudget.warning.text` | Im {month} sind {spent} von {budget} verbraucht ({percent} %). Bei 100 % startet weblion.one keine neuen KI-Anfragen mehr bis Monatsende. | In {month}, {spent} of {budget} have been used ({percent} %). At 100 %, weblion.one starts no new AI requests until the end of the month. |
| `email.aiBudget.exhausted.subject` | KI-Budget aufgebraucht | AI budget used up |
| `email.aiBudget.exhausted.heading` | KI-Budget aufgebraucht | AI budget used up |
| `email.aiBudget.exhausted.text` | Im {month} sind {spent} von {budget} verbraucht. Neue KI-Anfragen sind bis Monatsende gesperrt. Sie können das Budget in den KI-Einstellungen erhöhen. | In {month}, {spent} of {budget} have been used. New AI requests are blocked until the end of the month. You can raise the budget in the AI settings. |
| `email.aiBudget.button` | KI-Einstellungen öffnen | Open AI settings |
| `billing.product.translations.title` (billing) | Übersetzungen | Translations |
| `billing.product.translations.hint` | Name und Beschreibung in weiteren Sprachen. Leer gelassen gilt der deutsche Text. | Name and description in other languages. If left empty, the German text is used. |
| `billing.product.translations.name` | Name ({language}) | Name ({language}) |
| `billing.product.translations.description` | Beschreibung ({language}) | Description ({language}) |

`{language}` is the native name from `LOCALE_META`. Every key of the review additions in ai 13 (`ai.error.platformLocked`,
`ai.error.resellerBlocked`, `ai.error.adminKey`, `ai.assistant.toolLimit`, `ai.assistant.budgetStop`,
`ai.proposal.unverified*`, `ai.proposal.textOnly`, `ai.org.usageStaff`, `ai.org.platformOff`,
`admin.ai.status.enable*`, `admin.ai.card.usageStaff`) and i18n 18.2 (`admin.i18n.export.applyHint`,
`admin.i18n.job.reason.german|formality|content`, `admin.i18n.job.budgetJob`, `admin.i18n.badge.legal`,
`admin.i18n.cell.legalHint`, `admin.i18n.ai.estimateLegal`, `admin.i18n.cleanup.demoNotice`,
`admin.i18n.error.job_finished`) is added by F like every other design key (O21). The keys of the removed
features (`ai.customer.*`, `ai.feature.customer_summary.*`, `ai.tool.propose_monitor`, `ai.proposal.monitor`,
`admin.i18n.export.ts`, `admin.i18n.export.tsHint`) are not added.

The ai 13 rows that list several keys in one row (`ai.dns.topic.mx / .spf / ...`, `admin.ai.tab.*`,
`admin.ai.status.*`, `admin.ai.usage.*`, `admin.ai.errors.col.*`, `admin.ai.usageStatus.*`,
`ai.health.metric.*`, `admin.ai.reason.api / .internal`) are expanded into one key each. `billing.unit.*` of
i18n 18.1 likewise.

### 5.4 Web

- **F21 Type imports.** Codemod every import from `@/i18n/` (about 32 files): `TranslationKey` from
  `'@weblion/shared'`, dictionary values (tests only) from `'@weblion/shared/i18n/<locale>'`. `lib/format.ts`: `export type { Locale } from '@weblion/shared'`.
- **F22 `lib/i18n.tsx`** keeps static imports for now: `de` and `en` from `@weblion/shared/i18n/de|en`, and
  `fr/it/nl` as `{ ...en, ...fr }` etc.; `initialLocale()` accepts all five (`matchLocale(navigator.languages)`);
  context per 2.9. Static `@weblion/shared/i18n/*` imports are allowed only here until U2.
- **F23 Label call sites** (i18n 3.3 list): `MODULE_DEFS[m].label[locale]` -> `t(\`module.${m}.label\`)`, permission
  labels -> `t(\`perm.${p}\`)`.
- **F24 `App.tsx`**: lazy `AdminAiPage` (`@/pages/admin/ai`) at `ai`, lazy `TranslationsPage`
  (`@/pages/admin/translations`) at `translations` under `/admin`; `<AiProvider>` around `<Routes>`.
  Stub pages render `PageHeader` with `nav.admin.ai` / `nav.admin.translations`.
- **F25 `app-shell.tsx`**: nav items (O16); `<AiAssistant />` rendered once inside the shell; logout calls
  `clearAiChats()`; the main content area adds `pb-20 sm:pb-0` while `useAiLauncherVisible()` is true (2.9).
- **F26 Shared edits** of 2.9: `lib/api.ts`, `lib/queries.ts`, `components/ui/primitives.tsx` (also
  `aria-label={t('aria.loading')}`), `components/server-bits.tsx` (FR, IT, GB, `decorative`),
  `lib/api-errors.ts`, `components/ai/{ai-provider.tsx,assistant.tsx (with the useAiLauncherVisible stub),explain-action.ts,storage.ts}`,
  `src/test/i18n.tsx`; `pages/media/requests.test.tsx` imports `en` from `@weblion/shared/i18n/en`.

### 5.5 Done criteria for F

`pnpm install --frozen-lockfile`; `pnpm exec prettier --check "apps/*/src/**/*.{ts,tsx,css}" "apps/api/test/**/*.ts" "packages/*/src/**/*.ts" "apps/api/scripts/**/*.ts"`;
`pnpm typecheck`; `pnpm test` (incl. shared test 1, key parity de/en); `pnpm build`; `git grep -n "@/i18n/" apps/web/src`
empty; no em dash in added lines (`git diff c6c51ad -- . ':!apps/api/test/fixtures' | grep '^+' | grep "$(printf '\xe2\x80\x94')"`
empty). F writes a short hand-off note in the PR description (German): commit SHA, key count per section, stub list.

---

## 6. Build units

Each unit: read section 1, 2 and its design sections; build; tests; final report (0).

### U1: i18n admin API, Mass Translate job, translation admin page

**Spec**: i18n 11 (rate limits and audit), 12 (with O4, O6, O8, O9, O10, O11, O22), 13 (already done), 14 (A2 to
A16, B1 to B7), 15, 16, 17, 20.2 (all cases except mail, PDF, users.locale and billing locale, which are U2), 20.3
(`translations-query.test.ts`, `translations-table.test.tsx`), 21 (`seed-i18n.ts`).

**Builds**

- `apps/api/src/i18n/filters.ts` (predicates and stats of i18n 15, accent folding index built once per catalog),
  `entries.ts` (A4 to A8 logic on top of F's functions, A8 with `demo`), `export.ts` (JSON only; the TS file set
  is dropped, i18n 16.3), `import.ts` (both JSON formats, dry run), `translator.ts` (`systemPrompt(locale,
  glossary, style)` with first line `# Feature: translations`, `userMessage(batch)`, `batches(pairs)` (skips
  `LEGAL_KEYS`, i18n 12.2), `estimate(pairs, locales)` returning `TranslationEstimateDto` incl. `legal` and
  `budgetRemainingMicros` from `ctx.ai.budgetState()`, `validateItem` (i18n 12.5 steps 1 to 9: typography fix,
  the shared `checks.ts` predicates with the allowlists, the no-new-content rule; language checks skipped for
  demo jobs), `translateBatch` calling `ctx.ai.structured({ feature: 'translations', scope: 'platform', orgId:
  null, countsForUser: false, retryOnMaxTokens: false, actor, system, user, schema, signal })`, the 2.6 mapping),
  `jobs.ts` (runner i18n 12.8 as revised: takeover in the tick, 30 s heartbeat timer, `stop()` aborts and
  re-queues, cost cap 1.5 x estimate; sets `demo` from `availability().demo` and writes `demo` on the overrides;
  injected `sleep` and `now`).
- `apps/api/src/modules/i18n/routes.ts` (A2 to A16), `ai-routes.ts` (B1 to B7; B1 calls `ctx.ai.countRate` and
  `structured` with `countsForUser: true`, one call per requested locale, sequential).
- `apps/api/scripts/i18n-apply.ts` (JSON only; runs the `checks.ts` predicates on applied values and prints
  failures, i18n 16.2), `i18n-report.ts` (`--locale`, `--missing`, `--stale`, prints counts per locale and
  section; exit 0).
- `apps/api/src/db/seed-i18n.ts` (i18n 21: three demo overrides).
- Web: `apps/web/src/lib/api/i18n.ts`, `pages/admin/translations.tsx` (replaces F's stub; export
  `TranslationsPage`), `translations-table.tsx`, `translations-dialogs.tsx`, `translations-glossary.tsx`,
  `translations-jobs.tsx`, `translations-query.ts`. AI availability comes from `TranslationSummaryDto.ai`
  (no import from U4 files). The AI dialog shows `admin.i18n.ai.budgetWarning` when
  `costMicros > budgetRemainingMicros`, `admin.i18n.ai.demoNote` when `ai.demo`, `admin.i18n.ai.featureOff` for
  reason `feature_off`, `admin.i18n.ai.estimateLegal` when `legal > 0`, and the "KI einrichten" link to
  `/admin/ai`. Saved cells call `applyOverride` from `useI18n()` (no-op until U2 merges). Flags with
  `<Flag country="FR" decorative />` etc. Layout at 390 px (i18n 17.3): below `md` one `EntryCard` per key with
  one row per language instead of the table, filter bar `grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex`. Legal
  keys show the `admin.i18n.badge.legal` badge; the cleanup notice includes demo overrides; job errors map
  `ai_budget_job` to `admin.i18n.job.budgetJob` (2.6).
- Tests: `apps/api/test/i18n.test.ts`, `apps/api/test/i18n-jobs.test.ts` (cases a to o of i18n 20.2 against
  `startClaudeMock`, using only the F mock features; key saved through `PUT /admin/ai/key`, AI enabled through
  `PUT /admin/ai/settings`), `apps/api/test/i18n-fixtures.ts` (`testCatalog()`), web tests above.

**Late keys**: only in `sections/translations.{de,en}.ts` and `stamps/en/translations.json`.

### U2: i18n runtime, pickers, formatting, e-mails, PDF, billing language

**Spec**: i18n 2.2, 2.3 (Intl region names), 5, 6, 7, 8 (with O14, O15), 9, 20.2 (mail, PDF, users.locale, billing
locale cases), 20.3 (all except the admin page tests).

**Builds**

- Web runtime: `lib/i18n-loader.ts`, `lib/i18n.tsx` (lazy, `applyOverride`, `useChangeLocale`), `main.tsx` (boot
  with top-level await), `apps/web/index.html` (static spinner inside `#root`, i18n 5.2), `lib/format.ts`,
  `lib/api-errors.ts` (`localizeError`, i18n 7, plus every code of the frozen table 2.10, O25),
  `src/test/i18n.tsx` (same signature). The web loader imports only the web aggregators (never `server.ts`).
- Pickers: `components/language-picker.tsx` (`LanguageRadioGroup`, `LanguageMenu`, `LanguageMenuItems`), profile
  `pages/account/account.tsx`, login and invite `pages/auth/login.tsx`, `invite.tsx` (sends `locale` on accept),
  user menu and `ProfileLocaleSync` in `components/layout/app-shell.tsx` (keep F's nav items, `<AiAssistant />`
  and `clearAiChats()`), `pages/admin/users.tsx` (language select on create).
- Formatting and literals: `components/server-bits.tsx` (Intl region names), `components/metric-chart.tsx`,
  `pages/monitoring/bits.tsx`, `pages/media/bits.tsx`, `pages/billing/money.ts` (Dutch decimal input,
  `unitForInterval(interval, t)`), `pages/billing/invoice-editor.tsx` (`unitForInterval` callers and
  `productText(product, invoice.locale)` when a product is added), `pages/billing/profile-form.tsx` (invoice
  language), `pages/mail/units.ts` and the `formatMailSize` callers `pages/admin/mail.tsx`, `pages/mail/bits.tsx`,
  `pages/mail/mailboxes.tsx`, `pages/mail/overview.tsx`, aria literals in `pages/org/policies.tsx`,
  `pages/servers/tabs/settings.tsx`, `pages/servers/list.tsx`.
- Build check: `apps/web/scripts/check-i18n-chunks.mjs` (i18n 20.3: entry markers, 90 KB gzip per locale chunk,
  no email marker in any web chunk), script `"check:chunks"` in `apps/web/package.json`.
- API: `mail/types.ts`, `mail/templates.ts` (all templates incl. `ai_budget` from keys, translator `Tr` typed with
  `ServerTranslationKey`),
  `mail/service.ts`, `mail/invitation.ts`; locale per mail (i18n 8.2) in `modules/orgs/routes.ts`,
  `modules/reseller/routes.ts`, `modules/admin/routes.ts` (invitation callers; `POST /admin/users` locale),
  `modules/settings/routes.ts` (test mail), `modules/billing/invoices.ts` (invoice locale at finalize, mails),
  `modules/billing/routes.ts` (profile `locale` in PUT and the admin variant, credit mail), `modules/billing/dto.ts`,
  `modules/billing/pdf.ts` (i18n 8.3, seam `qrBillLanguage(locale)`), `modules/payments/checkout.ts` (i18n 8.4),
  `modules/auth/routes.ts` (`auth.profile_update` audit, invite `locale`).
- Tests: `apps/api/test/i18n-mail.test.ts`, `apps/api/test/i18n-locale.test.ts` (users.locale, invite locale,
  billing profile and invoice locale, PDF in five locales, Stripe locale), web `lib/i18n.test.ts`,
  `lib/i18n-imports.test.ts` (also fails on an import of `@weblion/shared/i18n/server`), `components/language-picker.test.tsx`,
  `pages/billing/money.test.ts` (incl. `'1.250'` and `'12.500'` -> null),
  `pages/mail/units.test.ts` (update), `pages/media/requests.test.tsx` (`withI18n`).

**Late keys**: only in `core`, `billing`, `email`, `pdf` (de/en) and their `stamps/en/*.json`.

### U3: AI API

**Spec**: ai 4 to 11, 14, 15 (with O4 to O9, O17, O22). Everything in `apps/api/src/modules/ai/` except
`routes.ts`.

**Builds**

- `org-routes.ts` (ai 5.5: own 409 codes, no `assertFeature`, usage any scope with `staffRequests`),
  `admin-routes.ts` (`GET /admin/ai/usage`, `GET /admin/ai/errors`, admin explain, admin audit summary, admin
  product texts; staff reservations carry the customer's `orgId`), `feature-routes.ts` (org explain, dns-check,
  audit-summary, server-health, reseller product texts), `chat-routes.ts` + `chat.ts` (ai 6.4 as revised:
  `tool_choice` always `auto`, `FINAL_STEP_NOTE`, `budgetExceeded()` after every call, per-turn caps; ai 9 with
  per-message `page`, role-only `<context>`, assistant messages up to 16,000 characters), `sse.ts`, `reader.ts`
  (ai 8.1: `owned()`, verified sub-paths, strict `assertSameOrg`, `toolJson`), `tools/registry.ts` and one file
  per tool group under `tools/` (ai 8.2 to 8.4: 22 tools, `live` flag, personal filter and blocked-customer filter
  in `get_audit_log`, `propose_dns_record` with `verified`/`textOnly`),
  `features/{explain,dns-check,audit-summary,server-health,product-texts}.ts` (ai 10.1 to 10.4 and 10.6, all
  through `ctx.ai.structured()` with `system: SYSTEM_TEXT[feature]`; `loadDnsContext` shared with the propose
  tool), `usage.ts` additions (usage report, errors page, `checkBudgetWarning` with mail and audit ai 7.2),
  `maintenance.ts` (ai 7.3: runs at start, stale bound), `service.ts` (`assertOrgData`, `budgetExceeded`,
  `liveReadAllowed`, chat helpers), `demo.ts` (assistant tool flow, JSON features ai 14),
  `test/claude-mock.ts` additions (`toolUses`, `thinking`, `fallbackTo`, `streamDelayMs`, `closedEarly`).
- No `customer_summary` and no `propose_monitor` (O31).
- Keeps green: F's `ai-settings.test.ts`, `ai-structured.test.ts`; keeps every 2.4 signature.
- Tests (ai 15.2): `modules/ai/{tools,schema}.test.ts` (schema test exists from F), `test/ai-org.test.ts`,
  `ai-limits.test.ts`, `ai-chat.test.ts`, `ai-features.test.ts`, `ai-isolation.test.ts`, `ai-secrets.test.ts`,
  `ai-demo.test.ts`.

**Late keys**: none (API messages are English; UI texts belong to U4). `packages/shared/src/ai.ts`: additive
changes only, each listed in the final report.

### U4: AI web

**Spec**: ai 12 (with O16, O18, O23) and the texts of ai 13.

**Builds**

- `apps/web/src/lib/api/ai.ts` (hooks, `streamAiChat`, `parseSseFrame`, `buildHistory` (ai 12.3), `aiErrorText(t, err)`
  = `localizeError(err, t)` (O25); SSE `error` events are turned into an `ApiError` first; the switch hooks are not
  gated by AI status) + `lib/api/ai.test.ts`.
- `components/ai/ai-provider.tsx` (DNS proposals only), `assistant.tsx` (ai 12.3 as revised: launcher
  `bottom-20` below `sm`, `useAiLauncherVisible`, icon buttons in the header, model badge in the footer, page per
  user message, tool-limit and budget notes), `ai-text.tsx`, `explain-dialog.tsx`, `explain-action.ts`,
  `storage.ts`, `bits.tsx` (incl. the unverified badge and its confirm dialog), tests `ai-text.test.tsx`,
  `assistant.test.tsx` (render with `withI18n`).
- `pages/admin/ai.tsx` (`AdminAiPage`, three tabs, seven feature switches, the go-live confirm when the master
  switch is turned on; notice card links to `/admin/translations?tab=entries&q=ai.notice.text`).
- Placements of ai 12.5 in: `pages/admin/customers.tsx` (only `AdminAiCard`, shown whatever the platform state),
  `pages/admin/dashboard.tsx`, `pages/admin/providers.tsx`, `pages/admin/settings.tsx` (integrations card, mail log
  explain), `pages/admin/audit.tsx`, `pages/org/settings.tsx` (`OrgAiCard` whenever `can('ai:settings')`, with
  `ai.org.platformOff` while the platform is off), `pages/org/dashboard.tsx`, `pages/org/audit.tsx`,
  `pages/reseller/customers.tsx` (and `pages/reseller/bits.tsx` if needed), `pages/hosting/domain-dns.tsx`,
  `pages/hosting/website.tsx`, `pages/mail/dns-setup.tsx`, `pages/servers/tabs/graphs.tsx`,
  `pages/servers/tabs/activity.tsx`, `pages/monitoring/detail.tsx`, `pages/billing/products.tsx` ("Texte mit KI",
  four translation fields per language with flags and the `billing.product.translations.*` labels, saved with the
  product; the product list through `productText(product, locale)`), `pages/billing/seller-dialogs.tsx` (product
  picker through `productText`). `pages/monitoring/dialogs.tsx` and `pages/monitoring/monitoring.tsx` are not
  touched (no monitor proposals).
- The assistant sends `locale` from `useI18n().locale`; every result shows `AiFootnote`.

**Late keys**: only in `sections/ai.{de,en}.ts` and `stamps/en/ai.json`.

---

## 7. Translation units T-<locale>-<group> and reviews R-<locale>

### 7.1 Input, output, ownership

- Input: the F commit. Source = `sections/<s>.de.ts`, reference = `sections/<s>.en.ts`, for all 16 sections
  (about 4,450 keys and 190,000 German characters including `email` and `pdf`, so the e-mails and the invoice PDF
  are translated too).
- Nine group units, three per locale L, each owning one section group (about 100,000 to 125,000 bytes of German
  section source each, measured on today's files plus the new sections):

  | Group | Sections |
  |---|---|
  | A | `core`, `admin`, `ai`, `translations`, `email`, `pdf` |
  | B | `hosting`, `cloudflare`, `websites`, `mail` |
  | C | `billing`, `cloud`, `storage`, `phone`, `media`, `uptime` |

- Output of T-L-G: every key of every section of group G in `sections/<s>.<L>.ts` (keys in German order, no
  comments, single quotes, `\n` kept), `stamps/<L>/<s>.json` written by
  `pnpm --filter @weblion/api i18n:stamp --locale <L> --section <s>`, and allowlist entries in
  `allowlists/<L>/<g>.ts` where a check is a false positive (each with a reason comment in English).
- Owned files of T-L-G: `packages/shared/src/i18n/sections/<s>.<L>.ts` and `stamps/<L>/<s>.json` for the sections
  of G, and `allowlists/<L>/<g>.ts`. Nothing else, so the three units of a language never touch the same file.
- R-L (review of locale L) owns all files of the three units of L after merging them (0) and fixes in place.
- Keys added by U1 to U4 after F are **not** translated here (the integrator does them, 8.2).

### 7.2 Rules

i18n 19.2 (all 13 rules), i18n 19.3 (term table), plus:

- The texts of section `ai` and `email.aiBudget.*`: KI is AI (en), IA (fr), IA (it), AI (nl); "KI-Assistent" is
  "assistant IA", "assistente IA", "AI-assistent"; never translate Anthropic, Claude, Claude Opus 5.5, Claude Sonnet
  5.5, Claude Haiku 5.5, Claude Console, ANTHROPIC_API_KEY, ENCRYPTION_KEY, USD, CHF.
- `ai.notice.title` and `ai.notice.text` (`LEGAL_KEYS`) are the data notice: translate completely and literally
  (no shortening, no new content); they are never machine-translated later and are reviewed by the owner before
  go-live. R-L checks them sentence by sentence against the German.
- `perm.*` and `module.*` labels: short noun phrases or infinitives, as the German.
- `email.*` and `pdf.*`: formal letter style of the language (fr "Bonjour" / "Meilleures salutations"; it "Buongiorno"
  / "Cordiali saluti"; nl "Goedendag" / "Met vriendelijke groet"); `pdf.invoice.draftMark` in capitals.

### 7.3 Glossary additions (F puts them into `DEFAULT_GLOSSARY`)

KEEP: Anthropic, Claude, Claude Opus 5.5, Claude Sonnet 5.5, Claude Haiku 5.5, Claude Console, USD, CHF.
Fixed translations:

| de | en | fr | it | nl |
|---|---|---|---|---|
| KI | AI | IA | IA | AI |
| KI-Assistent | AI assistant | assistant IA | assistente IA | AI-assistent |
| Tokens (KI) | tokens | tokens | token | tokens |
| Datenschutzhinweis | privacy notice | avis de confidentialité | informativa sulla privacy | privacyverklaring |
| Übersetzung | translation | traduction | traduzione | vertaling |
| Glossar | glossary | glossaire | glossario | woordenlijst |
| Vorschlag | proposal | proposition | proposta | voorstel |
| Demo-Modus | demo mode | mode démo | modalità demo | demomodus |
| Ablehnen (KI-Funktionen) | decline | refuser | rifiutare | weigeren |

### 7.4 Process

Group units T-L-G:

1. Order of sections inside the group (commit after each): A `core`, `email`, `pdf`, `ai`, `translations`,
   `admin`; B `hosting`, `cloudflare`, `websites`, `mail`; C `billing`, `cloud`, `storage`, `phone`, `media`,
   `uptime`.
2. After each section: `pnpm --filter @weblion/shared test`, `pnpm --filter @weblion/api i18n:stamp --locale <L> --section <s>`,
   `pnpm exec prettier --write packages/shared/src/i18n/sections/<s>.<L>.ts`.
3. At the end: `pnpm --filter @weblion/api exec vitest run test/i18n-stamps.test.ts`, `pnpm typecheck`; the report
   (`pnpm --filter @weblion/api i18n:report --locale <L> --missing`) shows 0 missing for the group's sections.
4. Final report: counts per section, allowlist entries with reasons, terms chosen that are not in the glossary,
   open questions.

Review units R-L (after T-L-A, T-L-B, T-L-C):

1. Create `ai-i18n/t-<L>` from the F commit and merge the three group branches.
2. Read the whole language: consistent terms across sections and groups (glossary and the "terms chosen" lists
   of the three reports), formal address, button lengths, no German leftovers, no em dash, `LEGAL_KEYS` sentence
   by sentence; fix in place, then `i18n:stamp --locale <L>`.
3. `I18N_REQUIRE_COMPLETE=<L> pnpm --filter @weblion/shared test`, `I18N_REQUIRE_LEGAL=<L> pnpm --filter
   @weblion/api exec vitest run test/i18n-stamps.test.ts`, `pnpm typecheck`.
4. Final report: what was changed in the review, allowlist entries with reasons, open questions.

---

## 8. Integration (I)

### 8.1 Merge

Merge into `ai-i18n/f` in this order: U3, U1, U2, U4, `ai-i18n/t-fr`, `ai-i18n/t-it`, `ai-i18n/t-nl` (the
language branches of the review units R-fr, R-it, R-nl; no conflicts are expected; if a file
conflicts, the owner of section 11 wins and the integrator re-applies the other side). Apply the change requests from
the unit reports. Then run `pnpm install --frozen-lockfile`.

### 8.2 Late keys

1. `pnpm --filter @weblion/api i18n:report --locale fr --missing` (same for `it`, `nl`) lists the keys U1 to U4
   added after F, and `--stale` the German texts changed after F.
2. The integrator translates them with the rules of 7.2 into the right `sections/<s>.<L>.ts`, runs
   `pnpm --filter @weblion/api i18n:stamp`, and repeats until both reports show 0 for every locale.

### 8.3 Checks (all must pass)

```
python3 -I -m unittest discover -s deploy/cloudpanel-agent/tests
pnpm install --frozen-lockfile
pnpm exec prettier --check "apps/*/src/**/*.{ts,tsx,css}" "apps/api/test/**/*.ts" "packages/*/src/**/*.ts" "apps/api/scripts/**/*.ts"
pnpm typecheck
dropdb --if-exists weblion_test && createdb -O weblion weblion_test   # fresh test database (or DROP DATABASE / CREATE DATABASE in psql)
pnpm test
I18N_REQUIRE_COMPLETE=1 pnpm --filter @weblion/shared test
I18N_REQUIRE_LEGAL=1 pnpm --filter @weblion/api exec vitest run test/i18n-stamps.test.ts
pnpm --filter @weblion/api i18n:report                              # 0 missing, 0 stale, every locale
pnpm build
pnpm --filter @weblion/web check:chunks
```

CI (`.github/workflows/ci.yml`, integrator): add `"apps/api/scripts/**/*.ts"` to the prettier step, a step
`pnpm --filter @weblion/web check:chunks` after `pnpm build`, `I18N_REQUIRE_LEGAL: '1'` in the env of the test step
(the data notice must stay complete and current in five languages), and a non-failing step
`pnpm --filter @weblion/api i18n:report || true` (prints missing and stale counts per locale so later gaps are
visible in every run). CI does not set `I18N_REQUIRE_COMPLETE`.

Review greps (each must be empty or justified):

- em dashes in added lines: `git diff c6c51ad -- . ':!apps/api/test/fixtures' | grep '^+' | grep "$(printf '\xe2\x80\x94')"`;
  sharp s: `git grep -n "ß" -- 'packages/shared/src/i18n/sections/*.de.ts' apps/api/src/mail apps/api/src/modules/ai`
- `git grep -nE "temperature|top_p|top_k|budget_tokens|type: 'disabled'|type: 'any'|type: 'tool'|type: 'none'" apps/api/src/modules/ai`
- `git grep -nE "customer_summary|propose_monitor|format=ts|renderSectionFile" apps packages` (removed scope)
- `git grep -nE "claude-(opus|sonnet|haiku)-[0-9-]+-20[0-9]{6}"` (no dated model ids)
- `git grep -n "api.anthropic.com" apps/api/test` (none) and `git grep -n "fetch(" apps/api/src/modules/ai` (only
  `demoFetch` plumbing, never a raw call to the Messages API)
- `git grep -n "dangerouslySetInnerHTML" apps/web/src/components/ai`
- `git grep -nE "@weblion/shared/i18n/(de|en|fr|it|nl|catalog)" apps/web/src` (only `lib/i18n-loader.ts` and tests);
  `git grep -n "@weblion/shared/i18n/server" apps/web` (none)
- every route of `modules/ai` that takes a resource id reads it through `reader.owned()` (read `features/*`,
  `tools/*`)
- every new route has a permission check and every write an audit entry (read the route files); no secret in audit
  details, `ai_usage.error_message`, logs or responses (`ai-secrets.test.ts` plus reading).

### 8.4 End to end

Start a fresh database, `pnpm --filter @weblion/api db:migrate`, `pnpm db:seed` with `ENABLE_DEMO_PROVIDER=true`,
build the web, run the API with `WEB_DIST_DIR=apps/web/dist`. Drive it with curl and Playwright
(`/opt/node-tools/node_modules/playwright`). Scenarios:

1. **Demo AI** (no key): KI page shows "Demo-Modus"; as `anna@muster.example` the assistant answers with the demo
   marker and a `get_org_overview` tool chip; DNS check on a demo domain shows the DMARC proposal (verified, no
   warning badge), "Vorschlag übernehmen" opens `DnsRecordDialog` pre-filled; "Mit KI erklären" on a failed action;
   product texts in the product dialog.
2. **Claude mock**: a small script in the scratchpad starts `startClaudeMock({ port: 4010 })` from
   `apps/api/test/claude-mock.ts`; API with `ANTHROPIC_BASE_URL=http://127.0.0.1:4010`; save key
   `sk-ant-test-0000000000000000000000` in the KI page, "Verbindung testen" succeeds; scripted chat with two tool
   calls and a text answer; switch the customer off on the admin customer page -> the assistant disappears for anna
   and `POST /orgs/:id/ai/chat` is 403; customer decline in org settings; reseller cascade; budget 1 USD with a mock
   usage above it -> 429 budget, dashboard notice, audit `ai.budget_warning` and `ai.budget_exhausted`, `mail_log`
   entries; a scripted chat whose second tool call asks for a server id of another organization gets `not_found`;
   a scripted DNS proposal with an MX value the console did not compute shows "Nicht von weblion.one geprüft" and
   the extra confirmation.
2a. **Before go-live**: with the platform switch off, anna's org settings show the KI card with
   `ai.org.platformOff`; she declines; turning the master switch on asks for the checklist; after it, anna's
   organization has no assistant, and an admin explain of one of its audit rows is 403 `ai_org_disabled`; a
   suspended organization's owner can still open and change the card.
3. **Mass Translate**: demo job fr for prefix `admin` (overrides `[FR] ...`, Demo badge, job completed); then save
   the mock key -> the `[FR]` overrides are gone; mock job it for 10 keys with one dropped placeholder (repair
   batch, then a failure entry), cancel of a running job, retry failed; restart the API while a gated job runs ->
   the job is `queued` and resumes after the restart; `ai.notice.text` is not offered (counted as legal).
4. **Languages**: profile it -> reload -> Italian UI, flag tiles; login page nl; invite accept with fr creates a user
   with `fr`; billing profile `fr` -> finalize an invoice -> PDF in French (`pdftotext` contains "Facture"), invoice
   mail subject French in the mail log; override of fr `common.save` in the admin -> a second browser sees it after
   reload, the overrides endpoint answers 304 on the next load.

### 8.5 Screenshots

Directory `scratchpad/shots-ai-i18n/`, each at 390 px and 1280 px wide (`<name>-390.png`, `<name>-1280.png`),
light theme, plus `assistant-dark-1280.png`. For each: no horizontal scroll at 390 px
(`document.scrollingElement.scrollWidth <= 390`), no console errors.

`login-language` (menu open), `profile-language` (Italian tiles), `dashboard-nl`, `translations-missing` (filter
Unübersetzt in fr; at 390 px the card layout), `translations-edit` (cell editor open with a red placeholder chip;
`translations-edit-390` shows the editor at full card width), `translations-ai-dialog` (estimate, budget warning,
legal line), `translations-jobs` (completed demo job with failures), `translations-glossary`, `ai-settings`,
`ai-settings-enable` (go-live confirm), `ai-usage`, `ai-errors`, `admin-customer-ai` (switch card with staff
usage), `reseller-customer-ai`, `org-ai` (decline confirm), `org-ai-platform-off`, `assistant` (tool chips,
sources, DNS proposal with the unverified badge; at 390 px header icon buttons, launcher above the toasts),
`dns-check`, `server-health`,
`audit-summary`, `explain-dialog`, `product-texts`, `billing-locale`, `invoice-pdf-fr` (first page rendered with
`pdftoppm`), `mail-it` (invitation HTML rendered by `renderMail`, opened in the browser).

### 8.6 Translation quality

Besides the automated checks: the integrator reads per language 40 random keys, all of `email`, `pdf`, all buttons of
`ai` and `translations`, and the screenshots `dashboard-nl`, `profile-language` and `invoice-pdf-fr`, and fixes what
reads wrong. Then the final run of 8.3.

---

## 9. Docs (D)

After I, in German, no em dashes:

- `docs/ai.md` (new): purpose and features, where the key goes (Verwaltung > KI), model choice and costs (Opus 5.5
  USD 4 / 20 per million tokens, examples of ai 6.7, Mass Translate fr/it/nl about USD 10 to 20), switches (platform,
  feature, customer, reseller, the customer's own decline), budget and limits, read-only tool layer and isolation,
  retention, demo mode, error reasons on the KI page, the data notice, and the section "Vor dem Einschalten" with
  the go-live checklist of ai 16 (AGB/AVV sub-processor list, transfer basis, notice sentence on training and
  retention checked against the Commercial Terms and DPA, workspace location, announcement mail to every
  organization owner at least 30 days before the master switch with the link to the decline setting).
- `docs/i18n.md` (new): i18n 21 content: languages and fallback, adding texts (de/en, `i18n:stamp`), translation
  rules and term table, Verwaltung > Übersetzungen (filters, editing, glossary, style notes, Mass Translate, cost),
  export and `i18n:apply`, checks (the same predicates for bundles and AI results), `I18N_REQUIRE_COMPLETE` and
  `I18N_REQUIRE_LEGAL`, legal texts (`LEGAL_KEYS`: never machine-translated, never shown stale), what stays English.
- `docs/architecture.md`: sections "KI (Claude)" and "Sprachen und Übersetzungen"; data model entries (`ai_usage`, AI
  columns on organizations, `products.translations`, `translation_overrides`, `translation_glossary`,
  `translation_jobs`, `billing_profiles.locale`, `invoices.locale`); permission model step 5 (AI deny); security
  bullets (key encrypted and never shown, no prompts stored, redaction, GET-only tools, no clickable external links).
- `docs/deployment.md`: outbound HTTPS to `api.anthropic.com`; nginx must not buffer SSE (`X-Accel-Buffering: no`
  is sent; `proxy_read_timeout` at least 60 s; pings every 15 s); `pnpm install --prod` now includes
  `@anthropic-ai/sdk`; set the key in Verwaltung > KI after deploy; `I18N_JOB_ENABLED=false` on secondary processes.
- `docs/roadmap.md`: done items; later: billing AI usage to customers, per-feature model, EU or Swiss inference
  region if offered, Message Batches for very large translation runs, a message catalog for API error codes, an AI
  customer briefing for staff and monitor proposals from the assistant (both removed in the review).
- `README.md`: languages sentence and admin bullets (i18n 21), section "KI (Claude)", env table rows for the six
  new variables.
- `.env.example`: verify F's sections against `config/env.ts`.
- `docs/providers.md`: one line that Claude is not a provider connection but configured under Verwaltung > KI (link
  to `docs/ai.md`).

---

## 10. Product decisions

Choices made where the designs or the owner's request left room (defaults the owner can change later):

1. Five languages de, en, fr, it, nl; German is the source; fallback fr/it/nl -> en -> de.
2. Formats: de-CH, en-GB, fr-CH, it-CH, nl-NL; invoice PDFs keep Swiss number and date formats in every language.
3. Flags DE, GB, FR, IT, NL as inline SVG next to the native language name (never emoji, never CH for German).
4. The profile language is saved on the user and applies after login on every device; the login page choice applies
   only before login and becomes the language of a new account on the invite page.
5. Invoices, reminders and payment confirmations follow a new "Sprache für Rechnungen" on the billing profile; an
   issued invoice keeps its language.
6. QR bill payment part: Dutch invoices use the English payment part; the QR message stays "Rechnung <Nummer>".
7. API error messages stay English (public API contract); the web translates the generic and all AI error codes.
8. Text overrides live in the database, apply at once without a deploy, and are meant to flow back into the
   repository via export and `i18n:apply`.
9. The initial fr, it and nl translations are written by engineers during the build (three translation units), not by
   Claude at runtime, so the app is complete before an API key exists.
10. Mass Translate runs as a background job, one at a time, with an estimate and a confirmation; the start is refused
    when the cost rose more than 25 percent since the estimate.
11. Mass Translate uses the model chosen on the KI page at effort medium; manual and reviewed translations are kept
    unless "Auch manuell geänderte ... ersetzen" is ticked; AI results are stored as "KI, ungeprüft".
12. Translation jobs share the monthly AI budget with all other AI features; the dialog warns when the remaining budget
    is probably not enough; the job stops when the budget is used up.
13. Only superadmins can run Mass Translate by default (`platform:i18n:write` plus `platform:ai:use`); support can read
    translations and use admin AI features.
14. Demo mode saves pseudo translations `[FR] <German text>` so the flow can be demonstrated; it exists only with the
    demo provider and without a key; the pseudo translations are served only with the demo provider and are deleted
    when a real key is saved.
15. The AI master switch is off in production until the owner turns it on; with the demo provider it starts on.
16. Per customer the AI is on by default (the migration switches every existing organization on); staff and the
    customer's reseller can switch it off; a reseller's switch caps its customers; the customer can decline in its
    own settings, and that wins over staff features.
17. The API key saved under Verwaltung > KI wins over `ANTHROPIC_API_KEY` in the environment.
18. One model for all features, chosen by the owner (default Claude Opus 5.5); the console never switches to a cheaper
    model by itself; Anthropic's refusal fallback is on for Opus and Sonnet (Haiku has none).
19. Budget defaults: USD 100 per month, warning at 80 percent (mail to superadmins), 200 requests per organization and
    day, 50 per person and day, 2 concurrent, 12 per minute.
20. Viewers may use the assistant; the roles "Eingeschränkt" and "Buchhaltung" may not (grantable by policy).
21. Customers see request counts (including the requests weblion staff ran on their data), staff see costs.
22. No prompts or answers are stored; usage metadata is kept 400 days, error texts 30 days; the chat lives only in the
    browser tab.
23. The AI only reads; proposals (DNS record, product texts) open the normal form pre-filled; a DNS value the
    console did not compute itself is marked "Nicht von weblion.one geprüft" and needs an extra confirmation, and
    deleting MX, NS or apex A/AAAA records is never offered as a form.
24. Product names and descriptions can be kept in four more languages; the invoice editor uses them for the invoice's
    language; invoice lines stay as entered afterwards.
25. The AI data notice is the translation key `ai.notice.text`, editable per language in Verwaltung > Übersetzungen; the
    owner checks it against Anthropic's terms before go-live. It is never machine-translated, and a translation that is
    outdated after a German change is replaced by the English (else German) text until someone translates it.
26. `@anthropic-ai/sdk` is pinned to exactly 1.3.0 (released 2026-10-23, types checked in the review, typed
    `fallbacks: 'default'`); upgrades come as a separate change.
27. Navigation in Verwaltung: ... Audit-Log, KI, Übersetzungen, Einstellungen.
28. All dictionaries live in `packages/shared`, so the API renders e-mails and PDFs with the same texts and overrides
    as the console.
29. French follows Swiss typography (no-break space before ":" and "%", none before "?", "!", ";"), straight double
    quotes in all languages; Italian uses "Lei", Dutch "u", French "vous".
30. AI effort is fixed per feature (assistant, DNS check, server analysis, translations: medium; the rest: low) so the
    prompt cache stays warm.
31. Customers can decline the AI at any time: before the platform switch is on, while suspended, and afterwards. The
    owner announces the AI to every organization owner at least 30 days before switching it on (checklist in
    `docs/ai.md`); the KI page asks for it when the master switch is turned on.
32. Seven AI features: assistant, error explanations, DNS and e-mail check, audit summary, server analysis, product
    texts, translations. The staff customer briefing and monitor proposals from the assistant are left for later.
33. The AI sees only the organization the request belongs to; every resource it reads by id is checked against that
    organization first. It gets the person's role, not the name; IP and e-mail addresses are removed from audit
    entries before they are sent.
34. The monthly budget is a hard stop, also in the middle of a chat answer; a single answer may cost at most five
    times its estimate, a translation job at most 1.5 times its estimate.
35. AI translations pass the same automatic checks as the translations in the repository before they are saved.

---

## 11. File ownership matrix

"F only" = changed in F, then frozen (only the integrator edits it). Paths relative to the repository root.

| Path | F | Owner after F |
|---|---|---|
| `packages/shared/src/i18n/{locales,interpolate,placeholders,types,glossary,checks,catalog,server}.ts`, `i18n.test.ts`, web aggregators | creates | F only |
| `packages/shared/src/i18n/sections/{core,billing,email,pdf}.{de,en}.ts`, `stamps/en/{core,billing,email,pdf}.json` | creates | U2 (late keys) |
| `packages/shared/src/i18n/sections/translations.{de,en}.ts`, `stamps/en/translations.json` | creates | U1 (late keys) |
| `packages/shared/src/i18n/sections/ai.{de,en}.ts`, `stamps/en/ai.json` | creates | U4 (late keys) |
| other `sections/*.{de,en}.ts`, their `stamps/en/*.json` | moves | F only |
| `packages/shared/src/i18n/sections/<s>.<L>.ts` and `stamps/<L>/<s>.json` for the sections of group G (7.1), `allowlists/<L>/<g>.ts` (L = fr, it, nl; G = A, B, C) | creates empty | T-L-G, then R-L for the whole language |
| `packages/shared/src/ai.ts` | creates | U3 (additive only) |
| `packages/shared/src/translations.ts` | creates | U1 (additive only) |
| `packages/shared/src/{index,permissions,roles,modules,billing,dto,access.test}.ts`, `packages/shared/package.json` | edits | F only |
| `apps/api/package.json`, `pnpm-lock.yaml`, `apps/api/tsconfig.json`, `.env.example`, `apps/api/src/config/env.ts` | edits | F only |
| `apps/api/src/db/schema.ts`, `apps/api/drizzle/**`, `apps/api/src/db/seed.ts` | edits | F only |
| `apps/api/src/{app,context,index}.ts`, `auth/access.ts`, `lib/redact.ts`, `lib/dto.ts`, `modules/meta/routes.ts` | edits | F only |
| `apps/api/src/modules/ai/routes.ts`, `test/ai-settings.test.ts`, `test/ai-structured.test.ts` | creates | F only (U3 keeps them green) |
| `apps/api/src/modules/ai/**` (all other files), `apps/api/test/claude-mock.ts`, `test/ai-*.test.ts` (new) | creates core and stubs | U3 |
| `apps/api/src/i18n/{hash,glossary}.ts`, `scripts/i18n-stamp.ts`, `test/i18n-service.test.ts`, `test/i18n-stamps.test.ts`, `test/migrations.test.ts`, `test/helpers.ts` | creates | F only |
| `apps/api/src/i18n/{service,entries,jobs}.ts` | creates | U1 (keep 2.5 signatures) |
| `apps/api/src/i18n/{filters,export,import,translator}.ts`, `modules/i18n/**`, `scripts/i18n-{apply,report}.ts`, `db/seed-i18n.ts`, `test/i18n.test.ts`, `test/i18n-jobs.test.ts`, `test/i18n-fixtures.ts` | stubs where named | U1 |
| `apps/api/src/mail/**`, `modules/billing/{pdf,invoices,routes,dto}.ts`, `modules/payments/checkout.ts`, `modules/auth/routes.ts`, `modules/admin/routes.ts`, `modules/orgs/routes.ts`, `modules/reseller/routes.ts`, `modules/settings/routes.ts`, `test/i18n-mail.test.ts`, `test/i18n-locale.test.ts` | small F edits | U2 |
| `apps/web/src/App.tsx`, `lib/api.ts`, `lib/queries.ts`, `components/ui/primitives.tsx` | edits | F only |
| `apps/web/src/lib/{i18n.tsx,i18n-loader.ts,format.ts,api-errors.ts,i18n.test.ts,i18n-imports.test.ts}`, `main.tsx`, `apps/web/index.html`, `src/test/i18n.tsx`, `components/language-picker*.tsx`, `components/server-bits.tsx`, `components/layout/app-shell.tsx`, `components/metric-chart.tsx`, `scripts/check-i18n-chunks.mjs`, `apps/web/package.json` | edits or stubs | U2 |
| `apps/web/src/pages/{auth/login,auth/invite,account/account,admin/users,admin/mail,billing/profile-form,billing/invoice-editor,mail/bits,mail/mailboxes,mail/overview,monitoring/bits,media/bits,org/policies,servers/list,servers/tabs/settings}.tsx`, `pages/billing/money.ts`, `pages/mail/units.ts`, their tests, `pages/media/requests.test.tsx` | label codemod only | U2 |
| `apps/web/src/lib/api/i18n.ts`, `pages/admin/translations*.tsx`, `pages/admin/translations-query.ts` | stub page | U1 |
| `apps/web/src/lib/api/ai.ts`, `components/ai/**`, `pages/admin/ai.tsx` | stubs | U4 |
| `apps/web/src/pages/{admin/customers,admin/dashboard,admin/providers,admin/settings,admin/audit,org/settings,org/dashboard,org/audit,reseller/customers,reseller/bits,hosting/domain-dns,hosting/website,mail/dns-setup,servers/tabs/graphs,servers/tabs/activity,monitoring/detail,billing/products,billing/seller-dialogs}.tsx` | label codemod only | U4 |
| other web files touched by the F codemods (type imports, labels) | edits | F only |
| `.github/workflows/ci.yml` | | I |
| `docs/**`, `README.md` | | D |

---

## 12. Review

> LOST in the container restart (the per-finding verdicts). The 24 findings and the summary of their
> resolution are kept in `summaries.md`; the overrides O26 to O33 above encode them.
