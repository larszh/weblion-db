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


## 2. Shared contracts

Exact signatures every unit builds against. F creates every file named here with these exports (bodies of later
units' parts as stubs, named per item). No unit changes a signature of this section; where section 11 allows a
unit additive changes (`ai.ts` U3, `translations.ts` U1), it only adds exports and lists them in its report. The
designs repeat parts of this section for convenience (ai 3.1, 4.2, 6.6, 6.9; i18n 2, 3.1, 8.1, 12.8, 14); on a
difference this section wins. Paths are relative to the repository root, checked against `c6c51ad`.

### 2.1 Locales (`packages/shared/src/i18n/locales.ts`)

Re-exported from `packages/shared/src/index.ts` (F4). `ai.ts` and `translations.ts` import it as `./i18n/locales`
(O1). Details and the formatting rules per locale: i18n 2.

```ts
export const LOCALES = ['de', 'en', 'fr', 'it', 'nl'] as const;
export type Locale = (typeof LOCALES)[number];

/** Every locale except the source: translations, stamps, product translations, Mass Translate. */
export const TARGET_LOCALES = ['en', 'fr', 'it', 'nl'] as const;
export type TargetLocale = (typeof TARGET_LOCALES)[number];

export const SOURCE_LOCALE = 'de' satisfies Locale;

export interface LocaleMeta {
  /** Name of the language in itself, shown next to the flag in every UI language. */
  native: string;
  /** English name, for logs, scripts and prompts. */
  english: string;
  /** ISO 3166-1 alpha-2 code of the flag (i18n 6.4). */
  flag: 'DE' | 'GB' | 'FR' | 'IT' | 'NL';
  /** BCP 47 tag for every Intl call (i18n 2.3). */
  intl: 'de-CH' | 'en-GB' | 'fr-CH' | 'it-CH' | 'nl-NL';
}

export const LOCALE_META: Record<Locale, LocaleMeta> = {
  de: { native: 'Deutsch', english: 'German', flag: 'DE', intl: 'de-CH' },
  en: { native: 'English', english: 'English', flag: 'GB', intl: 'en-GB' },
  fr: { native: 'Français', english: 'French', flag: 'FR', intl: 'fr-CH' },
  it: { native: 'Italiano', english: 'Italian', flag: 'IT', intl: 'it-CH' },
  nl: { native: 'Nederlands', english: 'Dutch', flag: 'NL', intl: 'nl-NL' },
};

export function isLocale(value: unknown): value is Locale;
export function isTargetLocale(value: unknown): value is TargetLocale;
/** 'fr', 'FR', 'fr-CH', 'fr_CH' -> 'fr'; 'gsw' -> 'de'; anything else -> null. */
export function normalizeLocale(value: unknown): Locale | null;
/** First supported entry of a list such as navigator.languages; no match -> fallback (default 'en'). */
export function matchLocale(candidates: readonly string[], fallback?: Locale): Locale;
/** fr, it, nl -> [l, 'en', 'de']; en -> ['en', 'de']; de -> ['de'] (plan decision 1). */
export function fallbackChain(locale: Locale): readonly Locale[];
/** LOCALE_META[locale].intl */
export function intlLocale(locale: Locale): LocaleMeta['intl'];
```

Users of the type today that F widens (F18, F21): `apps/web/src/lib/format.ts` (`export type { Locale } from
'@weblion/shared'`), `MailLocale` in `apps/api/src/mail/types.ts:9` (becomes `Locale`, U2), `formatMoney` in
`packages/shared/src/billing.ts:298` (2.7), the `PATCH /auth/me` body (`z.enum(LOCALES)`), `UserDto.locale` (2.7).

### 2.2 Dictionaries (`packages/shared/src/i18n/`)

**File layout** (i18n 3.1, O13):

```
packages/shared/src/i18n/
  locales.ts        2.1
  interpolate.ts    interpolate(), I18nParams
  placeholders.ts   PLACEHOLDER_RE, placeholdersOf(), comparePlaceholders(), lineBreakCount()
  types.ts          TranslationKey, ServerTranslationKey, Dictionary types, SectionName
  sections/index.ts SECTIONS, WEB_SECTIONS, SERVER_ONLY_SECTIONS, SECTION_GROUPS
  sections/<s>.<l>.ts            16 sections x 5 locales = 80 files
  de.ts en.ts fr.ts it.ts nl.ts   web aggregators (14 sections, no email, no pdf)
  server.ts         server aggregators (all 16 sections), SECTION_SOURCES
  catalog.ts        I18nCatalog, buildCatalog(), loadCatalog(), Stamp, StampFiles
  glossary.ts       GlossaryTerm, DEFAULT_GLOSSARY (i18n 19.3 plus plan 7.3)
  checks.ts         Allowlist, allowlistFor(), the predicates of checks 1 to 11, checkValue()
  stamps/<l>/<s>.json            l = en, fr, it, nl: 64 files, fr/it/nl start as {}
  allowlists/<l>/<g>.ts          l = fr, it, nl; g = a, b, c: 9 files
  i18n.test.ts      checks 1 to 11 against the repository bundles (i18n 19.4)
```

`packages/shared/package.json` (F4): `"exports": { ".": "./src/index.ts", "./i18n/*": "./src/i18n/*.ts" }`. The
package index re-exports `locales`, `interpolate`, `placeholders`, the types of `types.ts` (`export type *`),
`translations` and `ai`, and never a dictionary, the catalog, the glossary or the checks. Who imports what:

| Subpath | Imported by |
|---|---|
| `@weblion/shared/i18n/{de,en,fr,it,nl}` | web: only `apps/web/src/lib/i18n-loader.ts` (U2; until then F22's `lib/i18n.tsx`) and tests |
| `@weblion/shared/i18n/server`, `/catalog`, `/glossary`, `/checks` | API (`apps/api/src/i18n/*`, `mail/*`, `modules/billing/pdf.ts`, `scripts/i18n-*.ts`) and the shared test; `server` and `catalog` never in the web (`lib/i18n-imports.test.ts`, review grep 8.3) |

**Sections** (`sections/index.ts`, i18n 3.2):

```ts
export const SECTIONS = ['core', 'admin', 'ai', 'translations', 'email', 'pdf', 'hosting', 'cloudflare',
  'websites', 'mail', 'billing', 'cloud', 'storage', 'phone', 'media', 'uptime'] as const;
export const SERVER_ONLY_SECTIONS = ['email', 'pdf'] as const;
export const WEB_SECTIONS: readonly Exclude<(typeof SECTIONS)[number], 'email' | 'pdf'>[]; // the other 14, in SECTIONS order
/** Translation groups of plan 7.1 (units T-<locale>-<group>, allowlist files). */
export const SECTION_GROUPS: Record<'a' | 'b' | 'c', readonly (typeof SECTIONS)[number][]> = {
  a: ['core', 'admin', 'ai', 'translations', 'email', 'pdf'],
  b: ['hosting', 'cloudflare', 'websites', 'mail'],
  c: ['billing', 'cloud', 'storage', 'phone', 'media', 'uptime'],
};
```

**Section files** (one export each, name `<section><Locale>` in camel case: `coreDe`, `translationsFr`,
`uptimeNl`):

```ts
// sections/core.de.ts: the source, comments kept
export const coreDe = { 'common.actions': 'Aktionen' /* ... */ } as const;
// sections/core.en.ts: complete, a missing key fails the typecheck
import type { coreDe } from './core.de';
export const coreEn: Record<keyof typeof coreDe, string> = { /* ... */ };
// sections/core.fr.ts (it, nl alike): partial, a new German key never breaks the build
export const coreFr: Partial<Record<keyof typeof coreDe, string>> = {};
```

**Aggregators** (i18n 3.1, O33). Web, spreading `WEB_SECTIONS` in order, each with a chunk marker for the build
check of i18n 5.4:

```ts
// de.ts
export const I18N_CHUNK = 'wl-i18n-chunk:de';
export const de = { ...coreDe, ...adminDe, ...aiDe, ...translationsDe, ...hostingDe, /* 14 sections */ } as const;
// en.ts
export const I18N_CHUNK = 'wl-i18n-chunk:en';
export const en: Record<TranslationKey, string> = { ...coreEn /* ... */ };
// fr.ts, it.ts, nl.ts
export const I18N_CHUNK = 'wl-i18n-chunk:fr';
export const fr: Partial<Record<TranslationKey, string>> = { ...coreFr /* ... */ };
```

Server (`server.ts`):

```ts
export const serverDe = { ...de, ...emailDe, ...pdfDe } as const;
export const serverEn: Record<ServerTranslationKey, string> = { ...en, ...emailEn, ...pdfEn };
export const serverFr: Partial<Record<ServerTranslationKey, string>>; // serverIt, serverNl alike
/** Every section in every locale, for the catalog, the stamp script and the report. */
export const SECTION_SOURCES: Record<SectionName, Record<Locale, Readonly<Record<string, string>>>>;
```

**Types** (`types.ts`, type-only imports, so no dictionary reaches a bundle through them):

```ts
import type { de } from './de';
import type { serverDe } from './server';
import type { SECTIONS } from './sections';
export type TranslationKey = keyof typeof de;             // web keys (14 sections)
export type ServerTranslationKey = keyof typeof serverDe; // all 16 sections, for the API
export type Dictionary = Record<TranslationKey, string>;
export type PartialDictionary = Partial<Dictionary>;
export type ServerDictionary = Record<ServerTranslationKey, string>;
export type SectionName = (typeof SECTIONS)[number];
```

The web uses `TranslationKey` (`t()`), the API `ServerTranslationKey` (`ctx.i18n.t`, the mail translator `Tr`, the
PDF). An `email.*` key in the web is a type error.

**Catalog** (`catalog.ts`, F2; used by `I18nService`, the filters, the stamp script, the report and `i18n:apply`):

```ts
/** [hash of the German text the translation was written against, hash of the translation when stamped] (i18n 4.2). */
export type Stamp = readonly [sourceHash: string, valueHash: string];
export type StampFiles = Record<TargetLocale, Partial<Record<SectionName, Readonly<Record<string, Stamp>>>>>;

export interface I18nCatalog {
  /** Every key in German order: section by section in SECTIONS order, inside a section in file order. */
  keys: readonly ServerTranslationKey[];
  sections: readonly SectionName[];
  sectionOf(key: string): SectionName | undefined;
  has(key: string): key is ServerTranslationKey;
  /** Compiled values per locale (de and en complete, the others partial). */
  bundles: Record<Locale, Readonly<Partial<Record<ServerTranslationKey, string>>>>;
  stamps: Record<TargetLocale, Readonly<Partial<Record<ServerTranslationKey, Stamp>>>>;
  /** Keys of the sections email and pdf; never sent to the web (i18n 13). */
  serverOnly: ReadonlySet<string>;
}
/** Defaults: SECTION_SOURCES and the 64 stamp files, imported statically as JSON. */
export function buildCatalog(sources?: typeof SECTION_SOURCES, stamps?: StampFiles): I18nCatalog;
/** buildCatalog() once, memoized. */
export function loadCatalog(): I18nCatalog;
```

Tests build small catalogs with `buildCatalog()` (`apps/api/test/i18n-fixtures.ts`, `testCatalog()`, U1) and pass
them as `BuildOptions.i18nCatalog` (F17, F19).

**`interpolate.ts`, `placeholders.ts`** (i18n 2.2):

```ts
export type I18nParams = Record<string, string | number | null | undefined>;
/** Replaces {name} with String(params.name ?? ''). Unknown placeholders stay as they are. */
export function interpolate(text: string, params?: I18nParams): string;

/** {name}: a letter, then letters, digits or underscores; JSON such as { "a": 1 } is no placeholder. */
export const PLACEHOLDER_RE: RegExp; // /\{([A-Za-z][A-Za-z0-9_]*)\}/g
/** Names in order of appearance, duplicates kept. */
export function placeholdersOf(text: string): string[];
/** Multiset difference against the German text. */
export function comparePlaceholders(source: string, value: string): { missing: string[]; extra: string[] };
export function lineBreakCount(text: string): number;
```

**`glossary.ts`** (i18n 19.3; the API seeds `translation_glossary` from it, 2.5):

```ts
export interface GlossaryTerm {
  term: string; // German term, or the name kept in every language
  keep: boolean;
  translations: Partial<Record<TargetLocale, string>>;
  note?: string | null;
}
export const DEFAULT_GLOSSARY: readonly GlossaryTerm[]; // i18n 19.3 table, the keep names of rule 10, plan 7.3
```

**`checks.ts`** (i18n 19.4, D18). The same exported predicates run in the shared test, the admin save (A4), the
import (A15), `i18n:apply` and the Mass Translate validator (i18n 12.5):

```ts
import type { TranslationCheckName } from '../translations';

export interface Allowlist {
  germanOk?: readonly string[];     // check 3
  informalOk?: readonly string[];   // check 4
  lengthOk?: readonly string[];     // check 5
  glossaryOk?: readonly string[];   // check 6
  typographyOk?: readonly string[]; // check 11
}
/** The three group files of a locale merged; en: all empty. */
export function allowlistFor(locale: TargetLocale): Required<Allowlist>;

export function missingKeys(source: Readonly<Record<string, string>>, bundle: Readonly<Record<string, string | undefined>>): string[]; // 1
export function unknownKeys(source: Readonly<Record<string, string>>, bundle: Readonly<Record<string, string | undefined>>): string[]; // 1
export function placeholdersMatch(source: string, value: string): { ok: boolean; missing: string[]; extra: string[]; lineBreaks: boolean }; // 2
export function looksGerman(value: string, source: string, locale: TargetLocale): boolean; // 3
export function informalWord(value: string, locale: TargetLocale): string | null; // 4
export function lengthLimit(source: string): number; // 5
export function lengthOk(source: string, value: string): boolean; // 5
export function glossaryProblems(source: string, value: string, locale: TargetLocale, glossary: readonly GlossaryTerm[]): string[]; // 6
export function hasSharpS(value: string): boolean; // 7
export function hasEmDash(value: string): boolean; // 8
export function incompleteLocales(bundles: Partial<Record<TargetLocale, Readonly<Record<string, string | undefined>>>>, source: Readonly<Record<string, string>>, locales: readonly TargetLocale[]): Partial<Record<TargetLocale, string[]>>; // 9
export function legalProblems(bundles: Partial<Record<Locale, Readonly<Record<string, string | undefined>>>>, locales: readonly Locale[]): string[]; // 10
export function typographyProblems(value: string): string[]; // 11
export function fixFrenchTypography(value: string): string; // 11, applied before saving fr values
/** Checks 2 to 8 and 11 for one value. hard: placeholders, sharpS, emDash; soft: the rest. */
export function checkValue(input: {
  key: string; source: string; value: string; locale: Locale;
  glossary: readonly GlossaryTerm[]; skipLanguage?: boolean;
}): { hard: TranslationCheckName[]; soft: TranslationCheckName[] };
```

**Allowlist files** (`allowlists/<l>/<g>.ts`, one owner each, plan 7.1 and 11):

```ts
import type { Allowlist } from '../../checks';
export const allowlist: Allowlist = { germanOk: [], informalOk: [], lengthOk: [], glossaryOk: [], typographyOk: [] };
// every entry: the key, with a comment in English that says why the check is a false positive
```

An entry naming a key that no longer exists fails `i18n.test.ts` (check 1). English has no allowlist files.

### 2.3 AI vocabulary (`packages/shared/src/ai.ts`)

F writes the file exactly as ai 3.1 shows it, plus the error vocabulary of ai 4.2 and the additions marked "new"
below; U3 may only add to it. Imports: `import type { PolicyStatement } from './policy'` and `import type {
Locale } from './i18n/locales'`. The parts other units depend on:

```ts
// Models and features
export const AI_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const;
export type AiModel = (typeof AI_MODELS)[number];
export const AI_DEFAULT_MODEL: AiModel = 'claude-opus-5-5';
export function isAiModel(value: string): value is AiModel;
export function hasRefusalFallback(model: AiModel): boolean; // Opus, Sonnet: true; Haiku: false
export const AI_FEATURES = ['assistant', 'explain', 'dns_check', 'audit_summary', 'server_health',
  'product_texts', 'translations'] as const;
export type AiFeature = (typeof AI_FEATURES)[number];
export function isAiFeature(value: string): value is AiFeature;
export type AiEffort = 'low' | 'medium';
/** medium: assistant, dns_check, server_health, translations; low: the other three (plan decision 30). */
export const AI_FEATURE_EFFORT: Record<AiFeature, AiEffort>;

// Prices and cost (ai 2.2, 6.7; O7)
export interface AiPrice { input: number; output: number; cacheWrite: number; cacheRead: number } // USD per million tokens
export const AI_PRICES: Record<AiModel, AiPrice & { longContext?: AiPrice & { above: number } }>;
export const AI_UNLISTED_PRICE_FACTOR = 1.25;
export interface AiUsageTokens {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  iterations?: Array<{ type: string; model?: string | null; input_tokens: number; output_tokens: number;
    cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }> | null;
}
/** Micro-USD, rounded up once per call. Ids outside AI_MODELS: fallbackModel x AI_UNLISTED_PRICE_FACTOR. */
export function aiCostMicros(model: string, usage: AiUsageTokens, fallbackModel: AiModel): number;

// Availability (O5)
export type AiUnavailableReason = 'disabled' | 'not_configured' | 'feature_off';
export interface AiAvailabilityDto {
  available: boolean;
  /** null when available; order disabled > not_configured > feature_off. */
  reason: AiUnavailableReason | null;
  /** No key and ENABLE_DEMO_PROVIDER=true: the emulator answers (ai 14). */
  demo: boolean;
  model: AiModel;
}
export interface AiStatusDto extends AiAvailabilityDto {
  features: AiFeature[]; // switched on; empty while the master switch is off
}
/** new: IntegrationsDto.ai (2.7, ai 5.3). configured is true for ui, env and demo. */
export interface AiIntegrationDto {
  configured: boolean;
  source: 'ui' | 'env' | 'demo' | 'none';
  enabled: boolean;
  model: AiModel;
}

// Access (ai 3.4, 5.5)
export function aiDenyStatements(org: { aiEnabled: boolean; aiOptOutAt: Date | string | null }): PolicyStatement[];
export type AiSwitchedOffBy = 'platform' | 'reseller';
export type AiOrgOffReason = 'declined' | 'platform' | 'reseller' | 'parent';

// Usage (ai 7.1)
export const AI_USAGE_STATUSES = ['running', 'ok', 'refusal', 'incomplete', 'error', 'cancelled', 'stale'] as const;
export type AiUsageStatus = (typeof AI_USAGE_STATUSES)[number];
export type AiUsageScope = 'org' | 'staff' | 'platform';

// Errors (ai 4.2; new as arrays so the web test can iterate them, 2.10)
export const AI_ERROR_CODES = ['ai_limit', 'ai_refusal', 'ai_upstream', 'ai_incomplete', 'ai_busy', 'ai_timeout',
  'ai_org_disabled', 'ai_platform_locked', 'ai_reseller_blocked', 'ai_admin_key', 'ai_not_configured'] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];
export const AI_LIMIT_KINDS = ['budget', 'org_daily', 'user_daily', 'user_rate', 'user_concurrent',
  'org_concurrent', 'concurrent'] as const;
export type AiLimitKind = (typeof AI_LIMIT_KINDS)[number];
export const AI_UPSTREAM_REASONS = ['auth', 'permission', 'billing', 'not_found', 'request', 'server', 'network',
  'output'] as const;
export type AiUpstreamReason = (typeof AI_UPSTREAM_REASONS)[number];
export type AiBusyReason = 'overloaded' | 'rate_limit';

// Results (every feature result carries it)
export interface AiResultMeta { model: AiModel; servedModel: string; demo: boolean }
```

Exactly as ai 3.1 and used only by U3 and U4: `AiGoLiveDto`, `AiSettingsDto`, `AiSettingsInput`, `AiKeyStatusDto`,
`AiTestResultDto`, `AiBudgetDto` (also read by U1 through `ctx.ai.budgetState()`: `remainingMicros`),
`AiUsageReportDto`, `AiUsageTotalsDto`, `AiErrorDto`, `AiOrgStateDto`, `OrgAiDto`, `AdminOrgAiDto`,
`ResellerCustomerAiDto`, `AiPageRef`, `AiChatMessageInput`, `AiChatRequest`, `AI_TOOL_NAMES` (22) and
`AiToolName`, `AiNoticeKind`, `AiSseEvent`, `AiExplainSource`, `AiExplainRequest`, `AiSeverity`,
`AiExplainResult`, `AI_DNS_TOPICS`, `AiDnsTopic`, `AiCheckStatus`, `AiDnsCheckRequest`, `AiDnsProposalDto`,
`AiDnsCheckResult`, `AiAuditPeriod`, `AiAuditSummaryRequest`, `AiAuditSummaryResult`, `AiHealthStatus`,
`AI_HEALTH_METRICS`, `AiHealthMetric`, `AiServerHealthRequest`, `AiServerHealthResult`, `AiProductTextsRequest`,
`AiProductTextsResult`. Not in `ai.ts` (O14, O31): `ProductTranslations` (in `billing.ts`, 2.7), anything of
`translate()`, `customer_summary` or `propose_monitor`. Tests: `ai.test.ts` cases 1 to 10 of ai 3.1 (F6).

### 2.4 Claude call path (`apps/api/src/modules/ai/service.ts`, `ctx.ai: AiService`)

Every Claude call of the console goes through `AiService` (O4): JSON features and translations through
`structured()`, the chat through U3's loop on the same reservation and accounting methods. The request shape, the
streaming and the error classification are ai 6.1 to 6.8.

```ts
import type Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import type { AiAvailabilityDto, AiBudgetDto, AiFeature, AiIntegrationDto, AiModel, AiResultMeta, AiStatusDto,
  AiUsageScope, AiUsageStatus } from '@weblion/shared';
import type { AppContext } from '../../context';
import type { AiUsageRow } from '../../db/schema';
import type { AppError } from '../../lib/errors';
import type { AiSettings } from './settings';
import type { ReserveInput, UsageTotals } from './usage';

export interface StructuredInput<T> {
  feature: AiFeature;
  /** 'org': a member or reseller staff on an organization's data; 'staff': weblion staff on a customer's
   *  data; 'platform': no customer data (KI page, product texts of the platform, translations). */
  scope: AiUsageScope;
  /** The organization the data belongs to (staff requests: the customer); null for 'platform'. */
  orgId: string | null;
  /** false only for Mass Translate batches (O9): no person or organization limit, the budget applies. */
  countsForUser: boolean;
  /** Default true: one more call with max_tokens doubled (at most 64,000). Translation batches pass false (O4). */
  retryOnMaxTokens?: boolean;
  /** userId is required when countsForUser is true; null only for system work. */
  actor: { userId: string | null };
  /** SYSTEM_TEXT[feature], or the translator's prompt whose first line is "# Feature: translations". Sent as
   *  one system block with cache_control (ai 6.2); never contains a date, a name or another per-request value. */
  system: string;
  /** The one user turn; third-party data inside escaped blocks (ai 11.1). */
  user: string;
  /** Validates the answer; also sent as output_config.format through toStrictJsonSchema (ai 6.5). */
  schema: z.ZodType<T>;
  /** Combined with the turn timeout (AI_TURN_TIMEOUT_SECONDS). */
  signal?: AbortSignal;
}

export interface StructuredResult<T> {
  data: T;
  meta: AiResultMeta;
  /** The ai_usage row of this request. */
  usageId: string;
  /** Summed over the calls of this request (the max_tokens retry included). */
  tokens: UsageTotals;
  costMicros: number;
}

/** Usage of a request that failed after its reservation; attached to every error structured() throws then. */
export interface StructuredUsage { usageId: string; tokens: UsageTotals; costMicros: number }

export interface AiClient { client: Anthropic; demo: boolean; model: AiModel }
export type AiFinishStatus = Exclude<AiUsageStatus, 'running' | 'stale'>;

export class AiService {
  /** Stores ctx and reads nothing from it before the first call, so app.ts creates it after the context object. */
  constructor(ctx: AppContext);
  /** buildApp after the plugins (F17): keeps the app for ConsoleReader (app.inject, ai 8.1). */
  attach(app: FastifyInstance): void;

  // Settings and availability (F)
  /** The `ai` settings row with the defaults of 3.2; cached 10 s per process. */
  settings(): Promise<AiSettings>;
  /** ai 5.3. Without feature: master switch and key only. */
  availability(feature?: AiFeature): Promise<AiAvailabilityDto>;
  /** 404 not_found ("AI feature not found") unless availability(feature).available; returns the settings. */
  assertFeature(feature: AiFeature): Promise<AiSettings>;
  /** GET /ai/status. */
  status(): Promise<AiStatusDto>;
  /** IntegrationsDto.ai for modules/settings/routes.ts (F18). */
  integrationStatus(): Promise<AiIntegrationDto>;
  /** null when not configured; one cached SDK client per key source and fingerprint (ai 5.2, 6.1). */
  client(): Promise<AiClient | null>;
  /** Drops the cached client and the settings and availability cache; after every settings or key write. */
  resetClient(): void;

  // Calls (F)
  /** ai 6.6. Throws the AppErrors of 2.10 (not_found, ai_limit, ai_refusal, ai_incomplete, ai_upstream,
   *  ai_busy, ai_timeout) or AiCancelled when input.signal aborted; errors after the reservation carry
   *  StructuredUsage (usageOfError). */
  structured<T>(input: StructuredInput<T>): Promise<StructuredResult<T>>;

  // Limits and usage (F; thin wrappers over modules/ai/usage.ts)
  /** Up-front check for a request that makes several structured() calls (i18n B1): the person's rate,
   *  concurrency and daily limit (ai 7.1 checks 5 to 7), no row written. 429 ai_limit. */
  countRate(actor: { userId: string }): Promise<void>;
  /** Writes the running ai_usage row after checks 1 to 7 of ai 7.1 under the transaction lock of 3.3. 429 ai_limit. */
  reserve(input: ReserveInput): Promise<AiUsageRow>;
  /** Before every further call of the same request: reserved_micros = the next call's estimate. */
  refreshReservation(row: AiUsageRow, estimateMicros: number): Promise<void>;
  /** After every call: tokens, cost (aiCostMicros per iteration), api_calls + 1, served model, request id;
   *  updates the row in the database and the passed object. */
  addCall(row: AiUsageRow, message: BetaMessage, call: { requestId: string | null }): Promise<void>;
  /** status, finished_at, duration_ms, reserved_micros = 0; on failure error_code, error_reason and the
   *  redacted original message (redactText, at most 1,000 characters). Never throws. */
  finish(row: AiUsageRow, status: AiFinishStatus, failure?: { error: AppError; original?: unknown }): Promise<void>;
  /** The current month (Europe/Zurich): budget, spent, reserved by live rows, remaining (ai 7.1). */
  budgetState(): Promise<AiBudgetDto>;
  /** spent >= budget this month; checked after every chat API call (O29). */
  budgetExceeded(): Promise<boolean>;

  // U3 (F declares them with these signatures; the bodies throw new Error('not implemented'))
  /** 403 ai_org_disabled with details.reasons unless aiOrgState(org, parent).enabled (ai 5.5). */
  assertOrgData(orgId: string): Promise<void>;
  /** Sliding one-minute window per organization in this process, 30 live reads (O29). */
  liveReadAllowed(orgId: string): boolean;
}
```

U3 adds the chat entry point (`chat(...)`, ai 6.4 and 9) and its helpers to the class; nothing outside
`modules/ai` calls them, so their signatures are U3's.

Wiring (F17): `apps/api/src/context.ts` gains `ai: AiService; i18n: I18nService; i18nJobs: TranslationJobRunner`.
`buildApp` builds the context object first (`i18n` created and loaded before `MailService`, which receives it), then
assigns `ctx.ai = new AiService(ctx)` and `ctx.i18nJobs = new TranslationJobRunner(ctx, pool)`, and calls
`ctx.ai.attach(app)` after the plugins. `index.ts` starts `ctx.i18n`, `ctx.i18nJobs` (when `I18N_JOB_ENABLED`) and
`new AiMaintenance(ctx, pool)` and stops them in `shutdown` before `app.close()`.

Neighbouring modules of `apps/api/src/modules/ai/` with exports other units use:

```ts
// usage.ts (F; checkBudgetWarning: empty in F, U3 implements ai 7.2)
export interface UsageTotals { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }
export interface ReserveInput {
  feature: AiFeature; scope: AiUsageScope; orgId: string | null; userId: string | null;
  countsForUser: boolean; model: AiModel; demo: boolean; estimateMicros: number;
}
export const AI_LIMITS = { userPerMinute: 12, userConcurrent: 2, orgConcurrent: 3, platformConcurrent: 6,
  orgLiveReadsPerMinute: 30 } as const;
export function approxTokens(text: string): number; // Math.ceil(text.length / 3)
export function estimateCallMicros(model: AiModel, feature: AiFeature, inputTokens: number): number;
export function checkBudgetWarning(ctx: AppContext): Promise<void>; // logs, never throws

// errors.ts (F; ai 4.2, 6.8). Every helper returns an AppError with the code, status, details and fixed
// English message of 2.10.
export function aiLimit(limit: AiLimitKind, extra?: { retryAfterSeconds?: number | null; resetsAt?: string | null }): AppError;
export function aiRefusal(category: string | null): AppError;
export function aiUpstream(reason: AiUpstreamReason): AppError;
export function aiIncomplete(): AppError;
export function aiBusy(reason: AiBusyReason, retryAfterSeconds?: number | null): AppError;
export function aiTimeout(): AppError;
export function aiOrgDisabled(reasons: AiOrgOffReason[]): AppError;
export function aiPlatformLocked(): AppError;
export function aiResellerBlocked(): AppError;
export function aiAdminKey(): AppError;
/** Used by the i18n AI routes (O5, O10): 409 with details.reason. */
export function aiNotConfigured(reason: AiUnavailableReason): AppError;
export const AI_ERROR_MESSAGES: Record<Exclude<AiErrorCode, 'ai_limit'>, string>;
export const AI_LIMIT_MESSAGES: Record<AiLimitKind, string>;
/** The caller's signal aborted (client gone, job cancelled or stopped); never sent to a client. */
export class AiCancelled extends Error {}
export function classifyAiError(err: unknown, run: { timedOut: boolean }): AppError | AiCancelled;
/** The StructuredUsage attached to an error thrown by structured(), else null. */
export function usageOfError(err: unknown): StructuredUsage | null;

// settings.ts (F): 3.2. demo.ts (F, U3): demoFetch, emulateMessages (ai 14; translations: i18n 12.4, 12.10).
// prompts.ts (F): BASE_RULES, SYSTEM_TEXT: Record<Exclude<AiFeature, 'translations'>, string> (ai 10.8).
// redact.ts (F13): redactForAi(value, { personal }), redactText(s), toolJson(value) (ai 11.2, 8.1).
```

### 2.5 i18n runtime on the API (`apps/api/src/i18n/`)

F creates the five files with these exports. `hash.ts` and `glossary.ts` stay F only; `service.ts`, `entries.ts`
and `jobs.ts` belong to U1 afterwards, which keeps these signatures (section 11).

```ts
// hash.ts (F)
/** First 16 hex characters of SHA-256 over text.normalize('NFC'). Hashes German sources and values (i18n 4.1). */
export function sourceHash(text: string): string;

// service.ts (F; behaviour i18n 8.1 and 13)
export type Tr = (key: ServerTranslationKey, params?: I18nParams) => string;
export class I18nService {
  constructor(db: Database, env: Env, log: FastifyBaseLogger, catalog?: I18nCatalog /* default loadCatalog() */);
  readonly catalog: I18nCatalog;
  /** Reads every override into memory; buildApp awaits it before the routes (F17). */
  load(): Promise<void>;
  /** Every 15 s: select count(*), max(updated_at) from translation_overrides; full reload when it changed. */
  start(): void;
  stop(): void;
  /** After a local write (admin save, import, job batch, cleanup, key save): reload now. */
  reload(): Promise<void>;
  /** Overrides (servable rows only), fallbackChain, the legal rule; then interpolate(). Never throws. */
  t(locale: Locale, key: ServerTranslationKey, params?: I18nParams): string;
  translator(locale: Locale): Tr;
  /** Effective German text (German override, else compiled) and its sourceHash. */
  source(key: ServerTranslationKey): { text: string; hash: string };
  /** Body and ETag of A1, cached until the next reload. */
  payload(locale: Locale): { etag: string; body: I18nOverridesDto };
  /** One admin cell (TranslationCellDto of i18n 14.1). */
  cell(locale: Locale, key: ServerTranslationKey): TranslationCellDto;
}
```

A row is servable when its key exists in the catalog, it is not `demo` or `ENABLE_DEMO_PROVIDER` is true (O11), and,
for a key of `LEGAL_KEYS`, its `source_hash` equals `source(key).hash` (O28). A legal key takes only current values
along its chain (override or a compiled value whose stamp is current), else the next locale: fr -> en -> de.

```ts
// entries.ts (F implements deleteDemoOverrides, saveOverride, revertOverride, setReviewed; U1 confirmCurrent, cleanup)
export async function saveOverride(tx: DbOrTx, input: { key: string; locale: Locale; value: string;
  origin: 'manual' | 'ai'; reviewed: boolean; sourceHash: string; demo?: boolean; userId: string | null }): Promise<void>;
/** Deletes the override; false when there was none. */
export async function revertOverride(tx: DbOrTx, key: string, locale: Locale): Promise<boolean>;
/** false when there is no override. */
export async function setReviewed(tx: DbOrTx, key: string, locale: Locale, reviewed: boolean, userId: string): Promise<boolean>;
/** A7 (i18n 14.2): 409 not_stale when the cell is current. */
export async function confirmCurrent(tx: DbOrTx, i18n: I18nService, key: string, locale: Locale, userId: string): Promise<void>;
export async function cleanup(tx: DbOrTx, i18n: I18nService, input: TranslationCleanupInput): Promise<TranslationCleanupResultDto>;
/** In the transaction of PUT /admin/ai/key (ai 5.4, O11). Returns the number of rows deleted. */
export async function deleteDemoOverrides(tx: DbOrTx): Promise<number>;

// glossary.ts (F)
/** Inserts the DEFAULT_GLOSSARY terms that are missing (by lower(term)) with built_in = true; never updates rows. */
export async function seedGlossary(db: DbOrTx): Promise<void>;
/** The table as GlossaryTerm[] for the translator and the checks: built-in first, then by term. */
export async function loadGlossary(db: DbOrTx): Promise<GlossaryTerm[]>;

// jobs.ts (F: the class with no-op start, stop and tick and requestCancel throwing; U1 implements i18n 12.8)
export interface JobRunnerOptions {
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; // default: setTimeout honouring the signal
  now?: () => Date;
  tickMs?: number;       // 5,000
  heartbeatMs?: number;  // 30,000
  staleAfterMs?: number; // 120,000: a running job without heartbeat for this long is taken over
  concurrency?: number;  // env I18N_AI_CONCURRENCY (1 to 4, default 2)
}
export class TranslationJobRunner {
  constructor(ctx: AppContext, pool: pg.Pool, options?: JobRunnerOptions);
  /** Tick every tickMs, timers unref()ed, like BillingJob.start (modules/billing/recurring.ts:226-233). */
  start(): void;
  /** Aborts in-flight calls, re-queues the job this runner owns (runner = null), clears the timers. */
  stop(): Promise<void>;
  /** One tick: claim under the advisory lock of 3.3 and run or resume a job. Exported for tests. */
  tick(): Promise<void>;
  /** B6: queued -> 'cancelled' at once; running -> cancel_requested, 'requested'; finished -> 'finished' (409 job_finished). */
  requestCancel(jobId: string): Promise<'cancelled' | 'requested' | 'finished'>;
}
```

Imports: `Database`, `DbOrTx` from `apps/api/src/db/client.ts`; `Env` from `config/env.ts`; `I18nCatalog`,
`ServerTranslationKey`, `I18nParams`, `GlossaryTerm` from `@weblion/shared` and its i18n subpaths (2.2);
`I18nOverridesDto`, `TranslationCellDto`, `TranslationCleanupInput`, `TranslationCleanupResultDto` from
`packages/shared/src/translations.ts` (i18n 14.1, with the F7 additions). The translator
(`apps/api/src/i18n/translator.ts`: `systemPrompt`, `userMessage`, `batches`, `estimate`, `validateItem`,
`translateBatch`, i18n 12.2 to 12.7) is U1's alone; its user message fields `locale`, `items[].id`, `items[].de` and
its output `{ items: [{ id, text }] }` are the contract with the demo emulator (i18n 12.4, ai 14).

### 2.6 Mapping of AI errors in the Mass Translate job (U1)

`translateBatch` (i18n 12.4) calls `ctx.ai.structured({ feature: 'translations', scope: 'platform', orgId: null,
countsForUser: false, retryOnMaxTokens: false, actor: { userId: <starter> }, system, user, schema, signal })` and
handles what it throws by this table (O6: only the codes of 2.10). A job-ending case throws `JobStop`; the runner
ends the job `failed` with `translation_jobs.error = { code, message }`, keeps every committed batch and audits
`i18n.job_finish`.

```ts
// apps/api/src/i18n/translator.ts (U1)
export class JobStop extends Error {
  constructor(readonly code: TranslationJobErrorCode, message: string);
}
// packages/shared/src/translations.ts (F7)
export const TRANSLATION_JOB_ERROR_CODES = ['ai_budget_job', 'cost_cap', 'ai_not_configured', 'ai_upstream', 'ai_failed'] as const;
export type TranslationJobErrorCode = (typeof TRANSLATION_JOB_ERROR_CODES)[number];
```

| Thrown by `structured()` | Job does | Job error code | Web text |
|---|---|---|---|
| `ai_limit` `{ limit: 'budget' }` | stop at once; the batch in flight is not saved | `ai_budget_job` | `admin.i18n.job.budgetJob` |
| `ai_limit` `{ limit: 'concurrent' }` (6 on the platform) | wait 5 s and retry; not counted as an attempt | | |
| `ai_limit` any other kind | cannot occur (`countsForUser: false` skips checks 3 to 7, ai 7.1); treated like `ai_upstream` `server` | | |
| `ai_busy` (`overloaded`, `rate_limit`) | wait 5 s, 15 s, 45 s, 2 min, 5 min (injected `sleep`), then the batch's items fail with reason `error`; the job goes on | | |
| `ai_timeout`; `ai_upstream` `server` or `network` | retry twice after 5 s and 30 s, then split the batch in two halves once; still failing: items fail with `error` | | |
| `ai_upstream` `output` | split once, then items fail with `error` | | |
| `ai_incomplete` (`max_tokens`, no retry inside `structured()`) | split in halves recursively down to one item; a single item fails with `error` | | |
| `ai_refusal` | split in halves to isolate; a single refused item fails with `refusal`, the others are saved | | |
| `ai_upstream` `auth`, `permission`, `billing`, `not_found` | stop | `ai_upstream` | `admin.i18n.job.error.ai_upstream` |
| `ai_upstream` `request` | the batch's items fail with `error`; logged with the request id (a bug) | | |
| `not_found` (from `assertFeature`: master switch, feature or key gone during the job) | `ctx.ai.availability('translations')`; not available: stop | `ai_not_configured` | `admin.i18n.job.error.ai_not_configured` |
| `AiCancelled` (job cancelled or runner stopping) | discard the batch in flight, no failure entries | | |
| three batches in a row failing completely | stop | `ai_failed` | `admin.i18n.job.error.ai_failed` |
| runner: `cost_micros > 1.5 x estimate_micros` before a batch or after a commit (i18n 12.6) | stop | `cost_cap` | `admin.i18n.job.error.cost_cap` |

Fixed English `message` per code: `ai_budget_job` "The monthly AI budget was used up during the job. Finished
batches stay saved."; `cost_cap` "Stopped: the job would have cost more than 1.5 times its estimate.";
`ai_not_configured` "Stopped: AI was switched off during the job."; `ai_upstream` "Stopped: the AI service rejected
the key or the account (<reason>)."; `ai_failed` "Stopped: three batches in a row failed.".

Tokens and cost: the job adds `StructuredResult.tokens` and `costMicros` of every successful call and
`usageOfError(err)` of every failed one to `translation_jobs` (O22), so the cost cap sees refused and cut-off
calls too. Outside the job the i18n AI routes keep the codes: B1 answers the AppError of the call as it is, B2
calls no model, B3 and B7 answer 429 `ai_limit` `{ limit: 'budget' }` when `budgetState().exhausted` (O22) and 409
`ai_not_configured` when not available (O10).

### 2.7 Billing and products (`packages/shared/src/billing.ts`, `dto.ts`)

```ts
// billing.ts
import type { Locale, TargetLocale } from './i18n/locales';

/** Name and description per target language; German stays in ProductDto.name and description (O14). */
export type ProductTranslations = Partial<Record<TargetLocale, { name: string; description: string | null }>>;

export interface ProductDto { /* today's fields */ translations: ProductTranslations }
export interface BillingProfileDto { /* today's fields */
  /** "Sprache für Rechnungen"; null = the owner's language (i18n 9). */
  locale: Locale | null;
  /** locale ?? users.locale of the oldest active owner ?? 'de'. */
  effectiveLocale: Locale;
}
export interface InvoiceDetailDto { /* today's fields */
  /** invoices.locale (fixed at finalize) ?? the current billing language for drafts and old invoices. */
  locale: Locale;
}

/** The product text in a language: per field the translation when set, else the German text. de: name, description. */
export function productText(
  product: Pick<ProductDto, 'name' | 'description' | 'translations'>,
  locale: Locale,
): { name: string; description: string | null };

/** today's signature widened; Intl tag intlLocale(locale) (en becomes en-GB). Billing mails and the PDF pass 'de'. */
export function formatMoney(amount: number, currency: Currency | string, locale?: Locale /* default 'de' */): string;
```

```ts
// dto.ts
export interface UserDto { /* today's fields */ locale: Locale } // was string; toUserDto: normalizeLocale(row.locale) ?? 'de'
export interface IntegrationsDto { /* mail, stripe, zoho as today */ ai: AiIntegrationDto } // 2.3
```

API fields (F18): `POST` and `PATCH /billing/products` accept
`translations: z.partialRecord(z.enum(TARGET_LOCALES), z.object({ name: z.string().trim().min(1).max(200),
description: z.string().max(1000).nullable() })).optional()` (`z.partialRecord`, because `z.record` with an enum key
is exhaustive in zod 4); `toProductDto` returns `translations`. `PUT /orgs/:orgId/billing/profile` and
`PUT /billing/customers/:orgId/profile` accept `locale: z.enum(LOCALES).nullable().optional()` (U2). The web reads
product texts only through `productText` (U4: products list and the product picker; U2: the invoice editor with
`InvoiceDetailDto.locale`). Stored invoice lines stay text.

### 2.8 Mail template `ai_budget` (`apps/api/src/mail/types.ts`)

F adds the template to `MailTemplates` and a builder in today's de/en style with the texts of 5.3 (F18); U2 moves
every template to the `email.*` keys (O15, i18n 8.2) without changing the data shape:

```ts
export interface MailTemplates {
  /* invitation, invoice, invoice_reminder, payment_received, credit_booked, test as today */
  /** The monthly AI budget passed the warning mark or is used up (ai 7.2). */
  ai_budget: {
    kind: 'warning' | 'exhausted';
    /** Formatted in the mail language, e.g. "November 2026". */
    month: string;
    spent: string; // "USD 81.20"
    budget: string; // "USD 100.00"
    percent: number; // rounded down; shown only for 'warning'
    link: string; // `${APP_URL}/admin/ai`
  };
}
```

Keys (`email` section, 5.3): `email.aiBudget.warning.subject|heading|text`, `email.aiBudget.exhausted.subject|
heading|text`, `email.aiBudget.button`. Sent by `checkBudgetWarning` (U3) to every active user with
`platform_role = 'superadmin'`, one `ctx.mail.send` per locale with the recipients of that locale. After U2:
`MailLocale` is `Locale`, `MailOptions.locale?: Locale` (default `'de'`), `MailService` takes the `I18nService` as
its fifth constructor argument (`new MailService(db, box, env, log, i18n)`), and the builders take `(data, tr: Tr)`.

### 2.9 Web contracts

**`apps/web/src/lib/i18n.tsx`** (F with static dictionaries, F22; U2 makes it lazy, i18n 5). Exported names and
types are fixed; only `main.tsx` and `src/test/i18n.tsx` render the provider:

```ts
export type TFunction = (key: TranslationKey, params?: I18nParams) => string;

export interface I18nContextValue {
  locale: Locale;
  /** Loads the chunk and overrides of `next`, then switches and stores it in localStorage['wl-locale']. */
  setLocale(next: Locale): Promise<void>;
  t: TFunction;
  /** After a save in the translation admin: one override changed (value) or was reverted (null). F: no-op. */
  applyOverride(locale: Locale, key: string, value: string | null): void;
  /** Replaces all overrides of a locale (background revalidation). F: no-op. */
  applyOverrides(locale: Locale, values: Record<string, string>): void;
}
export interface I18nBoot {
  locale: Locale;
  dictionary: Dictionary;
  overrides: Partial<Record<Locale, Record<string, string>>>;
}
export function bootI18n(): Promise<I18nBoot>; // U2 (F: resolves with the static dictionary)
export function I18nProvider(props: { boot?: I18nBoot; children: ReactNode }): JSX.Element;
export function useI18n(): I18nContextValue;
export function useT(): TFunction;
/** Switches the UI language with a toast (language.loadFailed) on failure; resolves false then. Saves nothing. */
export function useChangeLocale(): (next: Locale) => Promise<boolean>;
/** The key exists in the dictionary on screen (localizeError builds keys at runtime, i18n 7). */
export function hasKey(key: string): boolean;
```

`apps/web/src/test/i18n.tsx` (F, U2 keeps the signature): `export function withI18n(node: ReactNode, locale?: Locale
/* 'en' */, overrides?: Record<string, string>): ReactElement`.

**`apps/web/src/lib/api-errors.ts`** (F: stub returning `errorMessage(err)`; U2 implements i18n 7 with every code of
2.10): `export function localizeError(err: unknown, t: TFunction): string`.

**`apps/web/src/lib/api.ts`** (F only). Additions, nothing else changes:

```ts
export type ApiQuery = Record<string, string | number | boolean | undefined | null>; // today's Query, exported
/** today's buildUrl, exported: links to GET routes (A16 export) and streamAiChat. */
export function apiUrl(path: string, query?: ApiQuery): string;
/** The CSRF header of every cookie-authenticated write: { 'X-Requested-With': 'weblion-console' }. */
export const WRITE_HEADERS: Readonly<Record<string, string>>;
/** A non-2xx Response as ApiError, exactly like request() (proxy pages included); a 401 outside /auth/ calls
 *  the unauthorized handler. request() uses it too. */
export function apiErrorFromResponse(res: Response, path: string): Promise<ApiError>;
```

**`apps/web/src/lib/queries.ts`** (F only): `useApiMutation` shows `localizeError(err, t)` instead of
`errorMessage(err)` and, when `explainAvailable(err)`, the sonner action `{ label: t('ai.explain.button'), onClick:
() => explainError(err) }`; its options gain `errorToast?: boolean` (default true; the AI feature hooks pass false
and show `aiErrorText(t, err)` in their dialog).

**`apps/web/src/components/ui/primitives.tsx`** (F only): `Spinner` gets `aria-label={t('aria.loading')}`;
`ErrorState` shows `localizeError(error, t)` and, while `useExplainAvailable(error)`, a small button
`ai.explain.short` that calls `explainError(error)`.

**`apps/web/src/components/ai/*`** (F stubs with these exports, U4 implements, ai 12):

```ts
// ai-provider.tsx: rendered by App.tsx around <Routes> (F24)
export function AiProvider(props: { children: ReactNode }): JSX.Element; // F: renders children
// U4-internal: useAiProposal(domainId), the DNS proposal hand-over to DomainDns (ai 12.3)

// assistant.tsx: rendered once by AppShell (U2, F25)
export function AiAssistant(): JSX.Element | null; // F: null
/** Route inside /o/:slug/*, status available with 'assistant', ai:use (staff: also platform:ai:use). F: false.
 *  While true AppShell adds pb-20 sm:pb-0 to the main area. */
export function useAiLauncherVisible(): boolean;

// explain-action.ts: used by lib/queries.ts and primitives.tsx (F only files)
export type ExplainHandler = (err: unknown) => void;
/** AiProvider registers its handler while the explain feature is available, null otherwise. */
export function registerExplainHandler(handler: ExplainHandler | null): void;
/** A handler is registered and err is an ApiError whose code does not start with "ai_". */
export function explainAvailable(err: unknown): boolean;
/** The same, re-rendering when a handler is registered or removed (useSyncExternalStore). */
export function useExplainAvailable(err: unknown): boolean;
export function explainError(err: unknown): void; // F: no-op

// storage.ts
export const AI_CHAT_STORAGE_PREFIX = 'wl-ai-chat:';
/** Removes every sessionStorage key with the prefix; AppShell's logout calls it (F25). F implements it. */
export function clearAiChats(): void;
// U4-internal: loadAiChat(orgId), saveAiChat(orgId, messages) (ai 12.3)
```

**`apps/web/src/components/server-bits.tsx`** (F adds, U2 owns afterwards, i18n 6.4):

```tsx
/** country: ISO 3166-1 alpha-2; new: FR, IT, GB. decorative: aria-hidden, no role, no label (the name is next to it). */
export function Flag(props: { country: string; className?: string; decorative?: boolean }): JSX.Element;
```

**Pages** (lazy routes of F24): `export function AdminAiPage()` in `apps/web/src/pages/admin/ai.tsx` (U4) and
`export function TranslationsPage()` in `apps/web/src/pages/admin/translations.tsx` (U1). Nav items (F25, O16): KI
`/admin/ai` (`Sparkles`, `platform:settings`), Übersetzungen `/admin/translations` (`Languages`,
`platform:i18n:read`).

**Query contract of `/admin/translations`** (O18, i18n 17.1). Every parameter is optional; unknown values fall back
to the default; U1 parses it in `translations-query.ts` (`parseTranslationsQuery`, `translationsQueryString`).
Other units link with plain URLs and import nothing of U1:

| Parameter | Values | Default |
|---|---|---|
| `tab` | `overview`, `entries`, `glossary`, `jobs`, `transfer` | `overview` |
| `q` | search in keys and texts | empty |
| `locale` | `de`, `en`, `fr`, `it`, `nl`, `any` | `any` |
| `filter` | `all`, `untranslated`, `stale`, `changed`, `ai`, `unreviewed`, `attention` | `all` |
| `area` | first key segment (O24), e.g. `admin`, `ai` | all |
| `section` | a `SectionName` | all |
| `keys` | comma list of exact keys (at most 500) | none |
| `job` | job id (jobs tab detail) | none |
| `page` | 1, 2, ... | 1 |

Fixed links: the KI page notice card `/admin/translations?tab=entries&q=ai.notice.text`; job failures
`/admin/translations?tab=entries&keys=<k1>,<k2>&locale=<l>`.

### 2.10 Error codes and their texts (frozen by F)

Every new error has its own code, a fixed English message (API errors stay English, plan decision 7; never
Anthropic's text, O32) and a web text that `localizeError` shows (i18n 7, O25). F creates the codes as the arrays
`AI_ERROR_CODES` (`ai.ts`), `I18N_ERROR_CODES` and `TRANSLATION_JOB_ERROR_CODES` (`translations.ts`) and adds every
key below (O21); `lib/api-errors.test.ts` (U2) iterates the arrays and fails on a code without a de and en key. No
unit adds a code: one that seems necessary is reported (0).

```ts
// packages/shared/src/translations.ts (F7)
export const I18N_ERROR_CODES = ['placeholder_mismatch', 'forbidden_character', 'unknown_key', 'legal_key',
  'nothing_to_translate', 'estimate_changed', 'job_running', 'job_finished', 'not_stale', 'glossary_duplicate',
  'glossary_builtin', 'import_invalid'] as const;
export type I18nErrorCode = (typeof I18N_ERROR_CODES)[number];
```

**AI codes** (ai 4.2; helpers in `modules/ai/errors.ts`, 2.4; keys in section `ai`, ai 13.8). Key rule of
`localizeError`: `ai.error.<camelCode>` with the code without `ai_` in camel case; `ai_limit` uses
`ai.error.limit.<details.limit>`.

| Code | Status | `details` | Message (fixed English) | Web key | de | en |
|---|---|---|---|---|---|---|
| `ai_limit` | 429 | `{ limit: AiLimitKind, retryAfterSeconds: number \| null, resetsAt: string \| null }` | per kind, `AI_LIMIT_MESSAGES` (ai 4.2) | `ai.error.limit.budget` | Das KI-Budget dieses Monats ist aufgebraucht. Die KI-Funktionen stehen ab dem nächsten Monat wieder zur Verfügung. | This month's AI budget is used up. The AI features are available again next month. |
| | | | | `ai.error.limit.org_daily` | Ihre Organisation hat das Tageslimit für KI-Anfragen erreicht. | Your organization reached its daily limit of AI requests. |
| | | | | `ai.error.limit.user_daily` | Sie haben Ihr Tageslimit für KI-Anfragen erreicht. | You reached your daily limit of AI requests. |
| | | | | `ai.error.limit.user_rate` | Zu viele KI-Anfragen in kurzer Zeit. Bitte warten Sie eine Minute. | Too many AI requests in a short time. Please wait a minute. |
| | | | | `ai.error.limit.user_concurrent` | Es laufen bereits zwei KI-Anfragen von Ihnen. Bitte warten Sie, bis eine fertig ist. | Two of your AI requests are already running. Please wait until one is finished. |
| | | | | `ai.error.limit.org_concurrent` | In Ihrer Organisation laufen bereits drei KI-Anfragen. Bitte versuchen Sie es gleich nochmals. | Three AI requests are already running in your organization. Please try again shortly. |
| | | | | `ai.error.limit.concurrent` | Gerade laufen zu viele KI-Anfragen. Bitte versuchen Sie es gleich nochmals. | Too many AI requests are running right now. Please try again shortly. |
| `ai_refusal` | 422 | `{ category: string \| null }` | Claude declined to answer this request. | `ai.error.refusal` | Claude hat diese Anfrage abgelehnt. Formulieren Sie sie bei Bedarf anders. | Claude declined this request. Rephrase it if needed. |
| `ai_upstream` | 502 | `{ reason: AiUpstreamReason }` | The AI service could not process the request. | `ai.error.upstream` | Der KI-Dienst konnte die Anfrage nicht bearbeiten. Bitte versuchen Sie es später nochmals. | The AI service could not process the request. Please try again later. |
| `ai_incomplete` | 502 | none | The AI answer was cut off. Please try again with a shorter request. | `ai.error.incomplete` | Die Antwort der KI wurde abgeschnitten. Versuchen Sie es mit einer kürzeren Anfrage. | The AI answer was cut off. Try a shorter request. |
| `ai_busy` | 503 | `{ reason: AiBusyReason, retryAfterSeconds: number \| null }` | The AI service is busy. Please try again in a moment. | `ai.error.busy` | Der KI-Dienst ist gerade ausgelastet. Bitte versuchen Sie es in einem Moment nochmals. | The AI service is busy right now. Please try again in a moment. |
| `ai_timeout` | 504 | none | The AI answer took too long. | `ai.error.timeout` | Die KI hat zu lange gebraucht. Bitte versuchen Sie es nochmals. | The AI took too long. Please try again. |
| `ai_org_disabled` | 403 | `{ reasons: AiOrgOffReason[] }` | AI features are switched off for this organization. | `ai.error.orgDisabled` | Die KI-Funktionen sind für diese Organisation ausgeschaltet. | The AI features are switched off for this organization. |
| `ai_platform_locked` | 409 | none | weblion switched AI off for this customer. Only weblion staff can switch it on again. | `ai.error.platformLocked` | weblion hat die KI für diesen Kunden ausgeschaltet. Nur weblion kann sie wieder einschalten. | weblion switched AI off for this customer. Only weblion can switch it on again. |
| `ai_reseller_blocked` | 409 | none | AI is switched off for your own organization, so it cannot be switched on for a customer. | `ai.error.resellerBlocked` | Die KI ist für Ihre eigene Organisation ausgeschaltet. Deshalb können Sie sie für Kunden nicht einschalten. | AI is switched off for your own organization, so you cannot switch it on for customers. |
| `ai_admin_key` | 400 | none | This is an Admin API key. Save a normal API key from the Claude Console. | `ai.error.adminKey` | Das ist ein Admin-API-Schlüssel. Speichern Sie einen normalen API-Schlüssel aus der Claude Console. | This is an Admin API key. Save a normal API key from the Claude Console. |
| `ai_not_configured` | 409 | `{ reason: AiUnavailableReason }` | AI is not available. Set it up under Administration > AI. | `ai.error.notConfigured` | Die KI ist nicht verfügbar. Richten Sie sie unter Verwaltung > KI ein. | AI is not available. Set it up under Administration > AI. |

AI routes answer "not available" with the existing 404 `not_found` (ai 4.1); only the i18n AI routes use
`ai_not_configured` (O5).

**i18n codes** (i18n 11.4; keys in section `translations`, i18n 18.2; key rule `admin.i18n.error.<code>` with
parameters from `details`):

| Code | Status | Routes | `details` | Message (fixed English) | de | en |
|---|---|---|---|---|---|---|
| `placeholder_mismatch` | 400 | A4; A15 per row | `{ missing: string[], extra: string[] }` | The placeholders must be exactly those of the German text. | Die Platzhalter müssen genau die des deutschen Textes sein. Fehlt: {missing}. Zu viel: {extra}. | The placeholders must be exactly those of the German text. Missing: {missing}. Extra: {extra}. |
| `forbidden_character` | 400 | A4 | `{ characters: string[] }` (`U+00DF`, `U+2014`) | The text contains a character that is not allowed (sharp s or em dash). | Der Text enthält ein nicht erlaubtes Zeichen (scharfes S oder langer Gedankenstrich). | The text contains a character that is not allowed (sharp s or em dash). |
| `unknown_key` | 404 | A4 to A7, B1 | `{ key }` | This text key does not exist. | Diesen Text gibt es nicht mehr. Laden Sie die Seite neu. | This text no longer exists. Please reload the page. |
| `legal_key` | 409 | B1; B2, B3 with only legal keys | `{ keys: string[] }` | Legal texts are never machine translated. | Rechtstexte werden nie maschinell übersetzt. | Legal texts are never machine translated. |
| `nothing_to_translate` | 409 | B3, B7 | none | There is nothing to translate for this selection. | Für diese Auswahl gibt es nichts zu übersetzen. | There is nothing to translate for this selection. |
| `estimate_changed` | 409 | B3, B7 | `{ costMicros, confirmedMicros }` | The estimated cost rose by more than 25 percent. Please check the new estimate. | Die geschätzten Kosten sind um mehr als 25 % gestiegen. Bitte prüfen Sie die neue Schätzung. | The estimated cost rose by more than 25 %. Please check the new estimate. |
| `job_running` | 409 | B3, B7 | `{ jobId }` | A translation job is already queued or running. | Es läuft bereits eine Übersetzung. Warten Sie, bis sie fertig ist, oder brechen Sie sie ab. | A translation is already running. Wait until it has finished or cancel it. |
| `job_finished` | 409 | B6 | `{ status }` | This job has already finished. | Dieser Auftrag ist bereits abgeschlossen. | This job has already finished. |
| `not_stale` | 409 | A7 | none | This translation is not outdated. | Diese Übersetzung ist bereits aktuell. | This translation is already up to date. |
| `glossary_duplicate` | 409 | A10, A11 | `{ term }` | This term is already in the glossary. | Diesen Begriff gibt es im Glossar schon. | This term is already in the glossary. |
| `glossary_builtin` | 409 | A12 | `{ term }` | Default terms can be changed but not deleted. | Standardbegriffe können geändert, aber nicht gelöscht werden. | Default terms can be changed but not deleted. |
| `import_invalid` | 400 | A15 | `{ problems: string[] }` (at most 20) | The file is not a translation export of weblion.one. | Die Datei ist kein Übersetzungs-Export von weblion.one. | The file is not a translation export of weblion.one. |

**Job error codes** (stored in `translation_jobs.error.code`, no HTTP status; messages in 2.6; keys in section
`translations`):

| Code | Web key | de | en |
|---|---|---|---|
| `ai_budget_job` | `admin.i18n.job.budgetJob` | Das KI-Budget dieses Monats ist aufgebraucht. Fertige Pakete bleiben gespeichert. | The AI budget of this month is used up. Finished batches stay saved. |
| `cost_cap` | `admin.i18n.job.error.cost_cap` | Gestoppt: Der Auftrag hätte mehr als das Anderthalbfache der Schätzung gekostet. | Stopped: the job would have cost more than one and a half times the estimate. |
| `ai_not_configured` | `admin.i18n.job.error.ai_not_configured` | Gestoppt: Die KI wurde während des Auftrags ausgeschaltet. | Stopped: AI was switched off during the job. |
| `ai_upstream` | `admin.i18n.job.error.ai_upstream` | Gestoppt: Der KI-Dienst hat den Schlüssel oder das Konto abgelehnt. Prüfen Sie Verwaltung > KI. | Stopped: the AI service rejected the key or the account. Check Administration > AI. |
| `ai_failed` | `admin.i18n.job.error.ai_failed` | Gestoppt: Mehrere Pakete hintereinander sind fehlgeschlagen. | Stopped: several batches in a row failed. |

**Generic codes** (unchanged API, now translated by `localizeError` rule 4 with the `core` keys of i18n 18.1):
`unauthorized` -> `error.unauthorized`, `forbidden` -> `error.forbidden`, `not_found` -> `error.not_found`,
`rate_limited` -> `error.rate_limited`, `internal_error` -> `error.internal_error`; no response -> `error.network`;
502, 503 or 504 without a JSON body -> `error.unavailable`. Every other code (`bad_request`, `conflict`,
`provider_error`, module codes) keeps its English message (plan decision 7).

---

## 3. Data model, settings keys, locks

### 3.1 Migrations (F, generated with drizzle-kit, data statements by hand)

F changes `apps/api/src/db/schema.ts` in two steps and generates one migration after each (O12):

1. The AI part below, then `pnpm --filter @weblion/api db:generate --name ai` -> `apps/api/drizzle/0010_ai.sql`,
   `meta/0010_snapshot.json`, journal entry `idx: 10`, `tag: '0010_ai'`.
2. The i18n part below, then `pnpm --filter @weblion/api db:generate --name i18n` -> `0011_i18n.sql`,
   `meta/0011_snapshot.json`, `idx: 11`, `tag: '0011_i18n'`.

Then F adds the hand-written statements marked below (they change data, not the schema, so a later
`db:generate` produces no diff; precedent: the `UPDATE` in `0002_org_suspended_by.sql`). The journal
(`apps/api/drizzle/meta/_journal.json`, today 10 entries, last `0009_media_requests` with `when: 1793721844339`)
must keep `idx` without gaps and `when` strictly increasing (drizzle applies by `when`; a smaller value is skipped
on existing databases), which `test/migrations.test.ts` checks (i18n 10.3). No other unit adds a migration (0).

**0010_ai: schema** (ai 5.6):

```ts
import type { AiFeature, AiModel, AiSwitchedOffBy, AiUsageScope, AiUsageStatus, Locale, ProductTranslations,
  TargetLocale, TranslationBatchPlan, TranslationFailure, TranslationJobScope, TranslationJobStatus } from '@weblion/shared';

// organizations: four columns after `modules`
/** AI may be used on this organization's data. On by default (plan decision 16). */
aiEnabled: boolean('ai_enabled').notNull().default(true),
/** Who switched it off while aiEnabled is false. A reseller cannot switch on what the platform switched off. */
aiDisabledBy: text('ai_disabled_by').$type<AiSwitchedOffBy>(),
/** The customer declined the AI features (ai:settings). Wins over every switch, staff features included. */
aiOptOutAt: timestamp('ai_opt_out_at', { withTimezone: true }),
aiOptOutBy: uuid('ai_opt_out_by').references(() => users.id, { onDelete: 'set null' }),

// products: one column after `description`
/** Name and description per target language (O14); German stays in name and description. */
translations: jsonb('translations').$type<ProductTranslations>().notNull().default({}),

/** One row per AI request: a chat turn, a feature call, a translation batch (O22). Metadata only, never a prompt,
 *  an answer, a tool input or a tool result. Kept 400 days, error texts 30 days (plan decision 22). */
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    feature: text('feature').$type<AiFeature>().notNull(),
    scope: text('scope').$type<AiUsageScope>().notNull(),
    /** The organization the data belongs to; staff requests carry the customer (O28). */
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** false only for Mass Translate batches (O9). */
    countsForUser: boolean('counts_for_user').notNull().default(true),
    model: text('model').$type<AiModel>().notNull(),
    /** Set when another model answered (server-side refusal fallback, ai 2.3). */
    servedModel: text('served_model'),
    status: text('status').$type<AiUsageStatus>().notNull().default('running'),
    demo: boolean('demo').notNull().default(false),
    apiCalls: integer('api_calls').notNull().default(0),
    toolCalls: integer('tool_calls').notNull().default(0),
    liveCalls: integer('live_calls').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    /** Estimate of the next call while running; 0 once finished (ai 7.1). */
    reservedMicros: bigint('reserved_micros', { mode: 'number' }).notNull().default(0),
    costMicros: bigint('cost_micros', { mode: 'number' }).notNull().default(0),
    durationMs: integer('duration_ms'),
    errorCode: text('error_code'),
    errorReason: text('error_reason'),
    /** Redacted original message for the staff errors tab; cleared after 30 days (ai 7.3). */
    errorMessage: text('error_message'),
    /** request-id of the last Claude API call. */
    requestId: text('request_id'),
  },
  (t) => [
    index('ai_usage_created_idx').on(t.createdAt),
    index('ai_usage_org_created_idx').on(t.orgId, t.createdAt),
    index('ai_usage_user_created_idx').on(t.userId, t.createdAt),
    index('ai_usage_running_idx').on(t.createdAt).where(sql`${t.status} = 'running'`),
  ],
);
export type AiUsageRow = typeof aiUsage.$inferSelect;
```

**0010_ai.sql** (what `db:generate` emits, plus the hand edit at the end):

```sql
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"feature" text NOT NULL,
	"scope" text NOT NULL,
	"org_id" uuid,
	"user_id" uuid,
	"counts_for_user" boolean DEFAULT true NOT NULL,
	"model" text NOT NULL,
	"served_model" text,
	"status" text DEFAULT 'running' NOT NULL,
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
	"error_message" text,
	"request_id" text
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "ai_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "ai_disabled_by" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "ai_opt_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "ai_opt_out_by" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "translations" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_ai_opt_out_by_users_id_fk" FOREIGN KEY ("ai_opt_out_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_created_idx" ON "ai_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_org_created_idx" ON "ai_usage" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_user_created_idx" ON "ai_usage" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_running_idx" ON "ai_usage" USING btree ("created_at") WHERE "ai_usage"."status" = 'running';--> statement-breakpoint
-- Hand edit (plan decision 16): AI is on for every existing organization. The column default already fills the
-- existing rows with true; the statement keeps the decision visible and is a no-op on a fresh database.
UPDATE "organizations" SET "ai_enabled" = true WHERE "ai_enabled" IS DISTINCT FROM true;
```

`ai_disabled_by`, `ai_opt_out_at` and `ai_opt_out_by` stay null for existing rows (nobody switched off or declined
yet); `products.translations` is `{}` for existing products (German only).

**0011_i18n: schema** (i18n 10.1; `check` from `drizzle-orm/pg-core`, new in this schema file):

```ts
// users: the column type and a check in the existing table callback
locale: text('locale').$type<Locale>().notNull().default('de'),
(t) => [
  uniqueIndex('users_email_idx').on(sql`lower(${t.email})`),
  check('users_locale_check', sql`${t.locale} in ('de', 'en', 'fr', 'it', 'nl')`),
],

// billingProfiles: one column after `paymentTermsDays`, and a table callback (it has none today)
/** "Sprache für Rechnungen"; null = the language of the oldest active owner (i18n 9). */
locale: text('locale').$type<Locale>(),
(t) => [check('billing_profiles_locale_check', sql`${t.locale} is null or ${t.locale} in ('de', 'en', 'fr', 'it', 'nl')`)],

// invoices: one column after `currency`, and a check in the existing table callback
/** Set at finalize to the billing language and never changed afterwards; null for drafts and old invoices. */
locale: text('locale').$type<Locale>(),
check('invoices_locale_check', sql`${t.locale} is null or ${t.locale} in ('de', 'en', 'fr', 'it', 'nl')`),

/** Text overrides per key and locale (i18n 8.1). */
export const translationOverrides = pgTable(
  'translation_overrides',
  {
    key: text('key').notNull(),
    locale: text('locale').$type<Locale>().notNull(),
    value: text('value').notNull(),
    origin: text('origin').$type<'manual' | 'ai'>().notNull(),
    /** sourceHash() of the effective German text the value was written against (i18n 4.1). */
    sourceHash: text('source_hash').notNull(),
    reviewed: boolean('reviewed').notNull().default(false),
    /** Pseudo translation of a demo job, served only with ENABLE_DEMO_PROVIDER (O11). */
    demo: boolean('demo').notNull().default(false),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.locale] }),
    index('translation_overrides_locale_idx').on(t.locale),
    check('translation_overrides_locale_check', sql`${t.locale} in ('de', 'en', 'fr', 'it', 'nl')`),
    check('translation_overrides_origin_check', sql`${t.origin} in ('manual', 'ai')`),
  ],
);

export const translationGlossary = pgTable(
  'translation_glossary',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    term: text('term').notNull(),
    keep: boolean('keep').notNull().default(false),
    translations: jsonb('translations').$type<Partial<Record<TargetLocale, string>>>().notNull().default({}),
    note: text('note'),
    /** From DEFAULT_GLOSSARY (seedGlossary at startup); editable, not deletable (A12). */
    builtIn: boolean('built_in').notNull().default(false),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [uniqueIndex('translation_glossary_term_idx').on(sql`lower(${t.term})`)],
);

export const translationJobs = pgTable(
  'translation_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    status: text('status').$type<TranslationJobStatus>().notNull().default('queued'),
    locales: jsonb('locales').$type<TargetLocale[]>().notNull(),
    scope: jsonb('scope').$type<TranslationJobScope>().notNull(),
    replaceManual: boolean('replace_manual').notNull().default(false),
    model: text('model').$type<AiModel>().notNull(),
    demo: boolean('demo').notNull().default(false),
    /** Fixed at start (i18n 12.2), never changed. */
    batches: jsonb('batches').$type<TranslationBatchPlan[]>().notNull(),
    /** Plan indexes already committed; a resumed job skips them (i18n 12.8). */
    doneBatches: integer('done_batches').array().notNull().default(sql`'{}'::integer[]`),
    total: integer('total').notNull(),
    done: integer('done').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    skipped: integer('skipped').notNull().default(0),
    inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
    outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
    cacheReadTokens: bigint('cache_read_tokens', { mode: 'number' }).notNull().default(0),
    cacheWriteTokens: bigint('cache_write_tokens', { mode: 'number' }).notNull().default(0),
    costMicros: bigint('cost_micros', { mode: 'number' }).notNull().default(0),
    estimateMicros: bigint('estimate_micros', { mode: 'number' }).notNull(),
    /** At most 1,000 entries; the failed counter keeps counting. */
    failures: jsonb('failures').$type<TranslationFailure[]>().notNull().default([]),
    /** { code: TranslationJobErrorCode, message } of 2.6. */
    error: jsonb('error').$type<{ code: string; message: string } | null>(),
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    /** Instance id of the runner that owns the job while it runs. */
    runner: text('runner'),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    retryOf: uuid('retry_of').references((): AnyPgColumn => translationJobs.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index('translation_jobs_created_idx').on(t.createdAt),
    /** One job at a time (plan decision 10): a second queued or running row fails, B3 answers 409 job_running. */
    uniqueIndex('translation_jobs_active_idx').on(sql`(true)`).where(sql`${t.status} in ('queued', 'running')`),
    check('translation_jobs_status_check', sql`${t.status} in ('queued', 'running', 'completed', 'failed', 'cancelled')`),
  ],
);
```

**0011_i18n.sql** (generated, with the hand edit placed before the `users` constraint):

```sql
CREATE TABLE "translation_glossary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term" text NOT NULL,
	"keep" boolean DEFAULT false NOT NULL,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"note" text,
	"built_in" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "translation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"locales" jsonb NOT NULL,
	"scope" jsonb NOT NULL,
	"replace_manual" boolean DEFAULT false NOT NULL,
	"model" text NOT NULL,
	"demo" boolean DEFAULT false NOT NULL,
	"batches" jsonb NOT NULL,
	"done_batches" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"total" integer NOT NULL,
	"done" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_read_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_write_tokens" bigint DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"estimate_micros" bigint NOT NULL,
	"failures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" jsonb,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"runner" text,
	"heartbeat_at" timestamp with time zone,
	"retry_of" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "translation_jobs_status_check" CHECK ("translation_jobs"."status" in ('queued', 'running', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "translation_overrides" (
	"key" text NOT NULL,
	"locale" text NOT NULL,
	"value" text NOT NULL,
	"origin" text NOT NULL,
	"source_hash" text NOT NULL,
	"reviewed" boolean DEFAULT false NOT NULL,
	"demo" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "translation_overrides_key_locale_pk" PRIMARY KEY("key","locale"),
	CONSTRAINT "translation_overrides_locale_check" CHECK ("translation_overrides"."locale" in ('de', 'en', 'fr', 'it', 'nl')),
	CONSTRAINT "translation_overrides_origin_check" CHECK ("translation_overrides"."origin" in ('manual', 'ai'))
);
--> statement-breakpoint
ALTER TABLE "billing_profiles" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "translation_glossary" ADD CONSTRAINT "translation_glossary_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_jobs" ADD CONSTRAINT "translation_jobs_retry_of_translation_jobs_id_fk" FOREIGN KEY ("retry_of") REFERENCES "public"."translation_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_jobs" ADD CONSTRAINT "translation_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_overrides" ADD CONSTRAINT "translation_overrides_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "translation_glossary_term_idx" ON "translation_glossary" USING btree (lower("term"));--> statement-breakpoint
CREATE INDEX "translation_jobs_created_idx" ON "translation_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "translation_jobs_active_idx" ON "translation_jobs" USING btree ((true)) WHERE "translation_jobs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "translation_overrides_locale_idx" ON "translation_overrides" USING btree ("locale");--> statement-breakpoint
-- Hand edit: normalize stored languages before the constraint below can reject them. PATCH /auth/me accepts
-- only de and en today, but rows written by scripts or by hand may carry de-CH, EN or anything else.
UPDATE "users" SET "locale" = CASE
  WHEN lower("locale") LIKE 'en%' THEN 'en'
  WHEN lower("locale") LIKE 'fr%' THEN 'fr'
  WHEN lower("locale") LIKE 'it%' THEN 'it'
  WHEN lower("locale") LIKE 'nl%' THEN 'nl'
  ELSE 'de' END
WHERE "locale" NOT IN ('de', 'en', 'fr', 'it', 'nl');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_locale_check" CHECK ("users"."locale" in ('de', 'en', 'fr', 'it', 'nl'));--> statement-breakpoint
ALTER TABLE "billing_profiles" ADD CONSTRAINT "billing_profiles_locale_check" CHECK ("billing_profiles"."locale" is null or "billing_profiles"."locale" in ('de', 'en', 'fr', 'it', 'nl'));--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_locale_check" CHECK ("invoices"."locale" is null or "invoices"."locale" in ('de', 'en', 'fr', 'it', 'nl'));
```

The exact order and quoting of the generated statements is whatever drizzle-kit 0.31 emits; what F guarantees by
hand is only that the `UPDATE "users"` comes before `users_locale_check`. No data statement for
`billing_profiles.locale` and `invoices.locale`: null is right for every existing row (i18n 9). The glossary is not
seeded by the migration but by `seedGlossary(db)` at every start (F17), so built-in terms added later reach
existing installations too.

**Test** (`apps/api/test/migrations.test.ts`, F, i18n 10.3): migrate to `0009` only, insert today's rows (users
with `de`, `en`, `EN-gb`, `fr-CH`, `xx`; an organization with owner, billing profile, open invoice with lines, a
product), run all migrations, then assert: locales `de`, `en`, `en`, `fr`, `de`; `organizations.ai_enabled` true,
the other three AI columns null; `products.translations = {}`; `billing_profiles.locale` and `invoices.locale` null;
the four new tables exist and are empty; `update users set locale = 'es'` fails; two inserts of `queued` jobs fail
on `translation_jobs_active_idx`; the journal order of 3.1.

### 3.2 Settings rows (table `settings`)

Key/value rows of `settings` (`apps/api/src/db/schema.ts:949`: `key text primary key`, `value jsonb`, `updated_at`).
Existing keys stay untouched: `smtp` (`mail/settings.ts:34`), `billing` (`modules/billing/settings.ts:26`),
`billing_job` (`modules/billing/recurring.ts:25`), `zoho.state` (`integrations/zoho.ts:30`). New keys:

| Key | Value type | Missing row means | Written by | Secret |
|---|---|---|---|---|
| `ai` | `StoredAiSettings` (below) | the defaults below | `PUT /admin/ai/settings` (`ai.settings_update`) | no |
| `ai_key` | `{ enc: string }` = `box.encryptJson({ key, savedAt, savedBy })` | no saved key: `ANTHROPIC_API_KEY`, else none (demo with the demo provider) | `PUT` and `DELETE /admin/ai/key` | yes, `SecretBox` like `smtp` (`mail/settings.ts:74-80`); never returned, logged or audited |
| `ai_budget_notice` | `{ month: 'YYYY-MM', warnedAt: string \| null, exhaustedAt: string \| null }` | nothing sent this month; a row of an earlier month counts as missing | `checkBudgetWarning` (U3, ai 7.2) | no |
| `i18n_style` | `Partial<Record<TargetLocale, string>>`, each at most 2,000 characters | no admin style notes | A14 (`i18n.style_update`) | no |

`modules/ai/settings.ts` (F; ai 5.1, 5.2):

```ts
export interface StoredAiSettings {
  enabled: boolean; // master switch
  model: AiModel;
  features: Partial<Record<AiFeature, boolean>>; // a missing feature is on
  budgetUsd: number;
  warnPercent: number;
  dailyOrgLimit: number;
  dailyUserLimit: number;
  notice: { checkedAt: string; checkedBy: string } | null; // data notice acknowledgement (user id)
  goLive: (Omit<AiGoLiveDto, 'confirmedBy'> & { confirmedBy: string | null }) | null;
}
/** StoredAiSettings with every default applied. */
export interface AiSettings extends Omit<StoredAiSettings, 'features'> { features: Record<AiFeature, boolean> }

export function readAiSettings(db: DbOrTx, env: Env): Promise<AiSettings>;
export function saveAiSettings(db: DbOrTx, value: StoredAiSettings): Promise<void>;

export type ResolvedAiKey =
  | { source: 'ui' | 'env'; key: string; demo: false }
  | { source: 'none'; key: null; demo: boolean }; // demo = env.ENABLE_DEMO_PROVIDER
/** null when the row is missing or cannot be decrypted after an ENCRYPTION_KEY change (like storedSmtpConfig). */
export function storedAiKey(db: DbOrTx, box: SecretBox): Promise<{ key: string; savedAt: string; savedBy: string | null } | null>;
export function saveAiKey(tx: DbOrTx, box: SecretBox, key: string, userId: string): Promise<void>;
export function deleteAiKey(tx: DbOrTx): Promise<boolean>;
/** The saved key wins over ANTHROPIC_API_KEY (plan decision 17, the reverse of SMTP on purpose). */
export function resolveAiKey(db: DbOrTx, box: SecretBox, env: Env): Promise<ResolvedAiKey>;
```

Defaults and ranges of `ai` (validated by `PUT /admin/ai/settings`, ai 5.1):

| Field | Default | Range | Plan |
|---|---|---|---|
| `enabled` | `env.ENABLE_DEMO_PROVIDER`: off in production, on with the demo provider | off -> on outside demo mode needs `goLive` (ai 5.1) | decisions 15, 31 |
| `model` | `'claude-opus-5-5'` (`AI_DEFAULT_MODEL`) | `AI_MODELS` | 18 |
| `features.<f>` | `true` for all seven | | 32 |
| `budgetUsd` | 100 | 0 to 100,000 (0 refuses every request) | 19 |
| `warnPercent` | 80 | 10 to 99 | 19 |
| `dailyOrgLimit` | 200 | 1 to 10,000 | 19 |
| `dailyUserLimit` | 50 | 1 to 10,000 | 19 |
| `notice` | `null` | | 25 |
| `goLive` | `null` | `announcedOn` at least 30 days before today (Europe/Zurich), not in the future | 31 |

The default of `enabled` is computed when the row is missing; once the row is written its stored value counts.
`ENABLE_DEMO_PROVIDER` is never set in production (`docs/providers.md`), so a production installation starts off
whatever is seeded. Fixed limits are code, not settings (`AI_LIMITS`, 2.4; per-turn caps `CHAT_LIMITS`, ai 6.4).
Environment variables of both modules: F11 (`ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_MAX_RETRIES`,
`AI_TURN_TIMEOUT_SECONDS`, `I18N_JOB_ENABLED`, `I18N_AI_CONCURRENCY`).

### 3.3 Advisory locks

In use at `c6c51ad`: session locks with a numeric id taken by a job with `pg_try_advisory_lock($1)` on a dedicated
pool client and released with `pg_advisory_unlock($1)` on the same client (`jobs/sync.ts:812-828`,
`modules/billing/recurring.ts:200-223`), and transaction locks on hashed names with
`pg_advisory_xact_lock(hashtextextended('<name>', 0))` for per-resource serialization (`billing:<orgId>`
`modules/billing/ledger.ts:26`, `cloud:`, `mail:`, `media:`, `media-seerr:`, `media-user:`, `monitor:`, `website:`,
`website-domain:`). New locks:

| Id or name | Kind | Held by | Purpose |
|---|---|---|---|
| `742_001` | session, numeric | `SyncService` sync job (`jobs/sync.ts:71`) | existing |
| `742_002` | session, numeric | `SyncService` actions job (`jobs/sync.ts:71`) | existing |
| `742_003` | session, numeric | `BillingJob` (`modules/billing/recurring.ts:24`) | existing |
| **`742_004`** | session, numeric, `I18N_JOB_LOCK` in `apps/api/src/i18n/jobs.ts` | `TranslationJobRunner.tick()` | serializes claiming a translation job across API processes; released at the end of the tick, the job runs outside it (i18n 12.8) |
| **`742_005`** | session, numeric, `AI_MAINTENANCE_LOCK` in `apps/api/src/modules/ai/maintenance.ts` | `AiMaintenance` run | one process marks stale usage rows and applies the retention (ai 7.3); skipped when another holds it |
| **`hashtextextended('ai:reserve', 0)`** | transaction | `reserve()` (2.4, `modules/ai/usage.ts`) | the limit checks and the insert of a reservation run as one unit, so two requests cannot pass the budget or a concurrency cap together (ai 7.1) |
| **`hashtextextended('ai:budget-notice', 0)`** | transaction | `checkBudgetWarning` (U3) | the warning and exhaustion mails go out at most once per month (ai 7.2) |

`742_006` and up are free for later jobs. A hashed name could in theory hit a numeric id (one 64-bit key space);
the chance is negligible, as for the existing hashed locks.

---

## 4. Permissions, roles, audit actions, rate limits

### 4.1 Permissions (`packages/shared/src/permissions.ts`, group `ai` after `monitoring`)

F5 removes the labels (O3, i18n 3.3): `PermissionDef` loses `label`, `def(group, extra)` takes no texts, and every
label becomes the `core` key `perm.<action>`. Today 93 actions; F adds 5, so 98 (and 98 `perm.*` keys).

```ts
export type PermissionGroup = /* ... */ | 'media' | 'monitoring' | 'ai' | 'billing' | 'reseller' | 'platform';

export interface PermissionDef {
  group: PermissionGroup;
  /** Destructive or cost relevant. The UI asks for confirmation and highlights these. */
  dangerous?: boolean;
  /** Only meaningful for weblion staff, never granted through organization roles. */
  platform?: boolean;
}
const def = (group: PermissionGroup, extra: Partial<Pick<PermissionDef, 'dangerous' | 'platform'>> = {}): PermissionDef =>
  ({ group, ...extra });

export const PERMISSIONS = {
  // ... Monitoring (module "monitoring", Uptime Kuma) as today, then:

  // AI (Claude): use the AI features on the organization's data, and decline or allow them
  'ai:use': def('ai'),
  'ai:settings': def('ai'),

  // ... Billing, Reseller as today; Platform as today, then at its end:
  'platform:ai:use': def('platform', { platform: true }),
  'platform:i18n:read': def('platform', { platform: true }),
  'platform:i18n:write': def('platform', { platform: true, dangerous: true }),
} as const satisfies Record<string, PermissionDef>;

export const PERMISSION_GROUPS: PermissionGroup[] = [
  'organization', 'members', 'security', 'projects', 'servers', 'backups', 'snapshots', 'networking', 'domains',
  'webhosting', 'storage', 'mail', 'phone', 'media', 'monitoring', 'ai', 'billing', 'reseller', 'platform',
];
```

| Action | Group | Flags | `perm.<action>` de | en |
|---|---|---|---|---|
| `ai:use` | `ai` | | KI-Funktionen verwenden | Use AI features |
| `ai:settings` | `ai` | | KI-Funktionen für die Organisation ablehnen oder erlauben | Decline or allow AI features for the organization |
| `platform:ai:use` | `platform` | `platform` | KI-Funktionen in der Verwaltung verwenden | Use AI features in the admin area |
| `platform:i18n:read` | `platform` | `platform` | Übersetzungen ansehen | View translations |
| `platform:i18n:write` | `platform` | `platform`, `dangerous` (AI costs money; every edit is live for everyone at once) | Übersetzungen bearbeiten und mit KI übersetzen | Edit translations and translate them with AI |

`perm.group.ai` (core): KI / AI. No new module: AI is not a service module (`MODULES` and `MODULE_DEFS` stay as they
are, apart from losing their labels), it is switched per organization by the columns of 3.1.

**Grants** (`packages/shared/src/roles.ts`, checked against the file at `c6c51ad`). `READ_ACTIONS` (`roles.ts:19`) is
shared by member, viewer, support and the read token scope, so `ai:use` is added to the named statements, never to
`READ_ACTIONS`:

| Role | `ai:use` | `ai:settings` | `platform:ai:use` | `platform:i18n:read` | `platform:i18n:write` | Change |
|---|---|---|---|---|---|---|
| owner | yes | yes | | | | none: `OwnerFullAccess` `*` |
| admin | yes | yes | | | | none: `AdminFullAccess` `*` minus `AdminNoOrgDelete` (`org:delete`, `billing:write`) |
| member | yes | no | | | | `'ai:use'` appended to `MemberOperate` (`roles.ts:48`) |
| viewer | yes | no | | | | `'ai:use'` appended to `ReadOnly` (`roles.ts:76`; plan decision 20) |
| restricted ("Eingeschränkt") | no | no | | | | none; grantable by a custom policy |
| billing ("Buchhaltung") | no | no | | | | none (`org:read`, `billing:*`); grantable by a custom policy |
| superadmin | yes | yes | yes | yes | yes | none: `SuperAdmin` `*` |
| support | yes | no | yes | yes | no | `'ai:use'`, `'platform:ai:use'`, `'platform:i18n:read'` appended to `SupportRead` (`roles.ts:84`) |

Platform roles may not be granted to organization members (`platform: true`), and `can()` refuses every
`platform:*` action outside `PLATFORM_ROLE_POLICIES` (`packages/shared/src/access.ts:59`).

**Boundaries.** `DEFAULT_CUSTOMER_BOUNDARY`, `DEFAULT_RESELLER_BOUNDARY` and `DEFAULT_INTERNAL_BOUNDARY` allow
`ai:use` and `ai:settings` through `Everything` `*`; `platform:*` stays denied in all three. An organization whose
boundary an admin narrowed to an explicit list without `ai:*` has no AI, as for any other action. The switches of
3.1 reach the engine through `effectiveBoundary` (`apps/api/src/auth/access.ts:164-170`, F14, ai 3.4):

```ts
const SUSPENDED_ALLOWED = [...READ_ONLY, 'billing:*', 'reseller:customer:access', 'ai:settings']; // access.ts:35

export function effectiveBoundary(
  org: Pick<Organization, 'boundary' | 'status' | 'modules' | 'aiEnabled' | 'aiOptOutAt'>,
  suspendedAllowed: string[] = SUSPENDED_ALLOWED,
): PolicyStatement[] {
  const base = org.status === 'suspended' ? suspendedBoundary(org.boundary, suspendedAllowed) : org.boundary;
  return [...base, ...moduleDenyStatements(org.modules), ...aiDenyStatements(org)];
}
```

`aiDenyStatements` (2.3) denies only `ai:use` (`sid: 'AiNotAllowed'`) while `ai_enabled` is false or `ai_opt_out_at`
is set; `ai:settings` is never denied, so a customer can always withdraw a decline. Through the parent boundary
(`apps/api/src/auth/access.ts:84`) a reseller that is off or declined denies `ai:use` in every customer. The
suspended reseller variant (`effectiveBoundary(parent, READ_ONLY)`, `apps/api/src/auth/access.ts:100`) gets no
`ai:settings`. Platform staff pass `can()` before any boundary (`packages/shared/src/access.ts:55`), so the
switches stop staff only through `ctx.ai.assertOrgData(orgId)` (4.2).

**API tokens.** `TOKEN_SCOPE_POLICIES.read` gets nothing new; `read_write` covers `ai:*` through `*`, but every AI
route and every i18n route except A1 calls `requireSession` (`apps/api/src/auth/access.ts:44`), so tokens get 403 there (the tool layer replays
the session cookie, ai 8.1). The policy validator accepts `ai:*` patterns once the actions exist.

**Shared test** (`packages/shared/src/access.test.ts`, F9): as listed there, plus member and viewer have `ai:use`,
restricted and billing do not; support has `ai:use`, `platform:ai:use`, `platform:i18n:read` and not
`platform:i18n:write`; `platform:ai:use` is never allowed through an organization role.

### 4.2 Gates per area

Every route checks a permission; an invisible organization or resource is 404 (`loadOrg`, `ConsoleReader.owned`,
O26). Order of checks inside a route: session, body, organization, availability, permission, organization state,
reservation, so a refusal is always the first one that applies.

**AI routes** (ai 4.1, 5.4, 5.5, 9.1, 10):

| Area | Routes | Gate in order | Refusals |
|---|---|---|---|
| Status | `GET /ai/status` | `requireAuth` | 401 |
| KI page | `GET`, `PUT /admin/ai/settings`; `PUT`, `DELETE /admin/ai/key`; `POST /admin/ai/test`; `GET /admin/ai/usage`; `GET /admin/ai/errors` | `requireSession`; `platform:settings` on `platformScope` | 403 `forbidden`; 400 `bad_request`, `ai_admin_key`; never `assertFeature` (works while AI is off) |
| Organization card | `GET /orgs/:orgId/ai`, `PUT /orgs/:orgId/ai/decline` | `requireSession`; `loadOrg`; `ai:settings` on `orgScope(orgId)` | 404; 403; works while suspended (4.1) and while the platform is off (O27) |
| Admin customer card | `GET /admin/orgs/:orgId/ai`; `PUT /admin/orgs/:orgId/ai` | `requireSession`; `platform:org:read`; `PUT`: `platform:org:write` | 403, 404 |
| Reseller customer card | `GET`, `PUT /orgs/:orgId/customers/:customerId/ai` | `requireSession`; `loadOrg` and `kind = 'reseller'` (else 404); `reseller:customer:read`, `PUT`: `reseller:customer:write`; the customer's `parent_org_id = orgId` (else 404), the pattern of `loadReseller`/`loadCustomer` (`modules/reseller/routes.ts:103-117`) | 404, 403, 409 `ai_platform_locked`, 409 `ai_reseller_blocked` |
| Organization features and chat | `POST /orgs/:orgId/ai/chat`, `/explain`, `/dns-check`, `/audit-summary`, `/server-health`, `/product-texts` | `requireSession`; body; `loadOrg`; `ctx.ai.assertFeature(feature)`; `aiRequestGate` (`modules/ai/gates.ts`, ai 9.1): member or reseller staff: `aiOrgState(org, parent).enabled`, then `ai:use` on `orgScope`; platform staff: `ai:use` and `platform:ai:use`, then `assertOrgData(orgId)`; then the feature's own permission (`audit:read` for the audit summary; `product-texts`: reseller organization and `reseller:billing`; the others through the routes `ConsoleReader` calls: `server:metrics`, `domain:read`, `mail:read`, ...); `ctx.ai.reserve()` | 404 (AI or feature off, resource invisible); 403 `ai_org_disabled`; 403 `forbidden`; 429 `ai_limit` |
| Admin features | `POST /admin/ai/explain`, `/admin/ai/audit-summary`, `/admin/ai/product-texts` | `requireSession`; body; `assertFeature`; `platform:ai:use`; the source's permission (`explain`: `audit` `platform:audit:read`, `provider` `platform:provider:read`, `mail_log` `platform:settings`; audit summary `platform:audit:read`; product texts `platform:billing:write`); `assertOrgData` for every organization whose data is read (also `resourceId` of `resourceType = 'org'`, ai 10.1); `reserve()` | 404, 403 `forbidden`, 403 `ai_org_disabled`, 429 |

**i18n routes** (i18n 11.1, 13, 14; O10). `platformScope` throughout:

| Area | Routes | Gate | Refusals |
|---|---|---|---|
| Public overrides | A1 `GET /i18n/overrides/:locale` | none (the login page needs it) | 404 for an unknown locale |
| Read | A2, A3, A9, A13, A16 (export); B4, B5 (jobs) | `requireSession`; `platform:i18n:read` | 403 |
| Write without AI | A4 to A8, A10 to A12, A14, A15; B6 (cancel) | `requireSession`; `platform:i18n:write` | 403; the i18n codes of 2.10 |
| AI | B1 (suggest), B2 (estimate), B3 (start), B7 (retry) | `requireSession`; `platform:i18n:write` and `platform:ai:use`; `ctx.ai.availability('translations')`, not available -> 409 `ai_not_configured` `{ reason }` (`aiNotConfigured`, 2.4) | 403; 409; B1: `countRate` and the codes of the call; B3, B7: 429 `ai_limit` budget, 409 `estimate_changed`, `job_running`, `nothing_to_translate` |

Manual editing, import and export work while AI is off (O10). The runner (i18n 12.8) acts for the starter and
checks no permission at run time; a starter who loses the permission meanwhile does not stop a running job.

**Other API changes**: `PATCH /auth/me` (`requireSession`, own profile, `locale`), the invite accept (`locale` of the
new account), `POST /admin/users` (`platform:user:write`, `locale`), the billing profile routes (`billing:write`,
`platform:billing:write` as today, `locale`), the product routes (`assertCatalog`, `modules/billing/routes.ts`, as
today, `translations`) keep their gates; only their bodies grow (F18, 2.7).

**Web** (hides what the API would refuse; the API gate is the authority):

| What | Shown when |
|---|---|
| Nav "KI" (`/admin/ai`) | `me.platformPermissions` includes `platform:settings` (O16) |
| Nav "Übersetzungen" (`/admin/translations`) | `platform:i18n:read` |
| Translation admin write controls (cell editor, glossary editing, style notes, import, cleanup, cancel) | `platform:i18n:write` |
| "Mit KI übersetzen", "KI-Vorschlag" | `platform:i18n:write`, `platform:ai:use` and `summary.ai.available` (demo included); otherwise the dialog explains why (`admin.i18n.ai.featureOff`, `notConfigured`) |
| Assistant launcher | `useAiLauncherVisible()` (2.9) |
| Organization feature buttons | `useAiStatus()` available with the feature, `can('ai:use')`, and the feature's permission |
| Admin feature buttons | the same with `platform:ai:use` and the source's platform permission |
| "Mit KI erklären" on toasts and error boxes | `explainAvailable(err)` (2.9) |
| `OrgAiCard` | `can('ai:settings')`, whatever the platform state (O27) |
| `AdminAiCard` | `platform:org:read`; the switch with `platform:org:write` |
| `ResellerAiCard` | `reseller:customer:read`; the switch with `reseller:customer:write` |
| Language pickers, flags, billing language | everyone who sees the page today (no new permission) |

### 4.3 Audit actions (all through `ctx.audit.record`, secrets never in details)

`ctx.audit.record(req, entry)` (`apps/api/src/audit.ts:23-48`) writes with its own database handle and never throws,
so routes record after their transaction committed. `req = null` for system entries (actor from
`actorUserId`/`actorName`, no IP). Never in details: the API key or any part or hash of it, `ENCRYPTION_KEY`,
provider credentials, prompts, answers, tool inputs or results, Anthropic's error text (it stays redacted in
`ai_usage.error_message`). AI feature and chat requests change nothing and are not audit entries; `ai_usage` records
them (ai 5.6). Text values in i18n details are cut to 300 characters.

**AI** (U3 except where F is named):

| Action | Route or trigger | `orgId`, resource | Details |
|---|---|---|---|
| `ai.settings_update` | `PUT /admin/ai/settings` (F) | null, `settings` / `ai` | changed fields `{ field: { from, to } }`; on the off -> on switch also `goLive: { announcedOn, contracts, transferBasis, noticeChecked, workspaceChecked }`; `noticeChecked: true` when the notice was marked checked |
| `ai.key_update` | `PUT /admin/ai/key` (F) | null, `settings` / `ai_key` | `{ source: 'ui', replaced: boolean, demoOverridesDeleted: number }` |
| `ai.key_delete` | `DELETE /admin/ai/key` (F) | null, `settings` / `ai_key` | `{ envFallback: boolean }` |
| `ai.test` | `POST /admin/ai/test` (F) | null, `settings` / `ai` | `{ model, reason }`; status `success` or `failure` |
| `ai.org_switch` | `PUT /admin/orgs/:orgId/ai` | the customer, `org` / customer id | `{ enabled, by: 'platform' }` |
| `ai.org_switch` | `PUT /orgs/:orgId/customers/:customerId/ai` | two entries: the reseller (`org` / customer id, like `reseller.customer_update`) and the customer (`org` / customer id) | `{ enabled, by: 'reseller' }` |
| `ai.org_decline`, `ai.org_allow` | `PUT /orgs/:orgId/ai/decline` | the organization, `org` / its id | `{ declined }` |
| `ai.budget_warning` | `checkBudgetWarning` (`req = null`, `actorName: 'AI budget'`) | null, `settings` / `ai_budget_notice` | `{ month, percent, spentMicros, budgetMicros }` |
| `ai.budget_exhausted` | the same | null, `settings` / `ai_budget_notice` | `{ month, spentMicros, budgetMicros }` |

**i18n** (U1; i18n 11.2): `orgId` null, `resourceType: 'translation'` with `resourceId: '<locale>:<key>'` for cells,
`'glossary'` (id), `'translation_job'` (id) or `'settings'` (`i18n_style`) otherwise.

| Action | Route | Details |
|---|---|---|
| `i18n.override_update` | A4 | `{ key, locale, origin: 'manual', reviewed, before, after, typographyFixed }` |
| `i18n.override_revert` | A5 | `{ key, locale, origin, before }` |
| `i18n.override_review` | A6 | `{ key, locale, reviewed }` |
| `i18n.override_confirm` | A7 | `{ key, locale }` |
| `i18n.cleanup` | A8 (not for `dryRun`) | `{ orphans, sameAsCompiled, demo, deleted }` |
| `i18n.glossary_create`, `i18n.glossary_update`, `i18n.glossary_delete` | A10, A11, A12 | `{ id, term, keep, changed }` |
| `i18n.style_update` | A14 | `{ locale, length }` |
| `i18n.import` | A15 (not for dry runs) | `{ locales, created, updated, unchanged, skipped, replaceManual, markReviewed }` |
| `i18n.job_start` | B3 | `{ jobId, locales, keys, estimateMicros, replaceManual, demo, model }` |
| `i18n.job_cancel` | B6 | `{ jobId, status }` |
| `i18n.job_retry` | B7 | `{ jobId, retryOf, keys }` |
| `i18n.job_finish` | runner (`req = null`, `actorUserId` = starter, `actorName: 'Translation job'`) | `{ jobId, status, done, failed, skipped, costMicros, error }` |

Not audited: reads, exports, B1 suggestions and B2 estimates (their AI calls leave `ai_usage` rows).

**Existing actions that change** (U2 unless noted): new `auth.profile_update` for `PATCH /auth/me` (`resourceType:
'user'`, `{ changed: ('name' | 'locale')[], locale }`); `billing.profile_update` details carry `locale` (they record
the body today, `modules/billing/routes.ts:382, 582`); `user.create` (`modules/admin/routes.ts:1523`) and the
invitation accept record the new account's `locale`; `product.create` adds `translations: TargetLocale[]` (the
locales filled) and `product.update` records the body as today, `translations` included (U4 sends it; the route is
F18's).

### 4.4 Rate limits

**HTTP limits** (`@fastify/rate-limit`, global 600 per minute per address, `apps/api/src/app.ts:106`):

| Route | Limit | How |
|---|---|---|
| A1 `GET /i18n/overrides/:locale` | 120 per minute per address | route config `config: { rateLimit: { max: 120, timeWindow: '1 minute' } }` (the pattern of `loginRateLimit`, `modules/auth/routes.ts:24`) |
| `POST /admin/ai/test` | 10 per minute per address | route config |
| A15 import, A16 export | 10 per minute per person, each | `app.createRateLimit({ max: 10, timeWindow: '1 minute', keyGenerator: (req) => \`i18n-import:${req.auth!.user.id}\` })` (and `i18n-export:`), counted in the handler after the permission check, 429 `rate_limited` with `retry-after` (the pattern of `modules/media/routes.ts:814-831`) |
| everything else, the chat and B1 to B7 included | global | |

**AI limits** (checked against `ai_usage` in the database by `reserve()`, so they hold across processes; 429
`ai_limit` with `details.limit` and `Retry-After` when known; ai 7.1):

| Kind | Limit | Applies to | Setting or constant |
|---|---|---|---|
| `budget` | spent + reserved + estimate above the monthly budget (Europe/Zurich month); 0 refuses all | every request, Mass Translate batches included (O9, O22) | `ai.budgetUsd` (100) |
| `concurrent` | 6 live requests on the platform | every request | `AI_LIMITS.platformConcurrent` |
| `org_concurrent` | 3 live requests of an organization | scope `org` | `AI_LIMITS.orgConcurrent` |
| `org_daily` | requests of an organization today (Europe/Zurich) | scope `org` | `ai.dailyOrgLimit` (200) |
| `user_concurrent` | 2 live requests of a person | `countsForUser` | `AI_LIMITS.userConcurrent` |
| `user_rate` | 12 requests of a person in 60 seconds | `countsForUser` | `AI_LIMITS.userPerMinute` |
| `user_daily` | requests of a person today | `countsForUser` | `ai.dailyUserLimit` (50) |

A row is live while `status = 'running'` and younger than `AI_TURN_TIMEOUT_SECONDS + 60` seconds (O29). Staff
requests on a customer's data (scope `staff`) count for the staff member and in the customer's usage, not against
the customer's organization limits. Mass Translate batches (`countsForUser: false`) meet only `budget` and
`concurrent` and run at most `I18N_AI_CONCURRENCY` (default 2) at a time. B1 calls `countRate({ userId })` once
before its calls. Beyond the reservation (ai 6.4, 7.1, O29): per chat turn at most 8 API calls, 24 tool calls, 8 live
tool calls, 120,000 tool-result characters and 5 x the turn's estimate; `budgetExceeded()` after every chat API call;
30 live reads per organization and minute (`liveReadAllowed`, per process); a translation job stops at 1.5 x its
estimate and is refused at start when the estimate rose more than 25 percent (i18n 12.6).

---

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

The review checked the three designs against the code at `c6c51ad` and the Claude API reference and raised 24
findings (H = change the plan before building, M = fix in the named unit, L = small). 23 are applied, 1 is
rejected. Rebuilt from the "review" and "revised" reports in `summaries.md` after the per-finding verdicts were lost
in the container restart of 06.11.2026; the resolutions below are the ones the overrides and the regenerated
designs now carry.

| # | Sev. | Finding | Resolution (where it is now) |
|---|---|---|---|
| 1 | H | Tools reading sub-resources by id (`/domains/{id}/dns`, `/servers/{id}/metrics`, `/mail/domains/{id}/mailboxes`) get answers without an `org` field, so they passed `assertSameOrg`; `org: null` passed too. A member of two organizations or reseller staff could pull another organization's data into the model, also of a declined one. | Applied: `ConsoleReader.owned(kind, id)` loads the parent first and fails closed unless `org.id` is the request's organization (`org: null` too); sub-paths only below a parent verified in the same run; tool results escape `<` and `>` (O26, ai 8.1, `toolJson` F13; `ai-isolation.test.ts`). |
| 2 | H | Customers could not decline in advance (card hidden while platform AI is off) and a suspended organization could not decline at all; under the nDSG a new US sub-processor needs prior information and a transfer basis. | Applied: the decline, staff and reseller cards show in every platform state and never call `assertFeature`; `ai:settings` in `SUSPENDED_ALLOWED` (4.1, ai 3.3); go-live checklist with the announcement 30 days ahead, asked by the master switch (O27, ai 1.3, 5.1, 16; decisions 31); staff requests count in the customer's usage (O28, ai 5.5). |
| 3 | H | The data notice was wrong or incomplete: it said passwords are never sent and left out Anthropic's retention, staff use, e-mail and IP addresses. | Applied: `redactForAi(value, { personal: true })` for audit data, the `<context>` block carries the role only (O28, ai 9.2, 11.2); new `ai.notice.text` (ai 13.10) with the training and retention sentence on the owner's checklist (ai 16); `LEGAL_KEYS` never machine-translated and never served stale (i18n 8.1, 12.2); `I18N_REQUIRE_LEGAL` in CI (8.3). |
| 4 | M | Declined customers still reached the model through the reseller audit log and the admin audit summary, which filtered only by `org.id`. | Applied: also filtered by `resourceType = 'org'` plus `resourceId` and by organizations named in details; `hidden` reports the count (ai 10.3, 8.3; admin explain of such a row is 403, 8.4 scenario 2a). |
| 5 | M | Injected third-party text (TXT records, monitor messages, SMTP errors) could produce attacker DNS proposals. | Applied: a proposal is `verified` only when it equals a record the console computed; otherwise the badge "Nicht von weblion.one geprüft" and a second confirmation; NS changes, deletes and unverified MX or apex A/AAAA changes are never offered as a form (ai 8.4, 12.3; decision 23). |
| 6 | M | Live provider reads per chat were unbounded. | Applied: at most 8 live tool calls per turn and 30 live reads per organization and minute (O29, ai 6.4, 7.1; 4.4). |
| 7 | H | The budget was no hard stop: checked once per request against an estimate, no per-turn or global cap, jobs could overrun. | Applied: `budgetExceeded()` after every chat API call, a turn costs at most 5 x its estimate, 3 concurrent per organization and 6 on the platform, Mass Translate stops at 1.5 x its estimate and is refused when the budget is already used up (O22, O29, ai 6.4, 7.1, i18n 12.6; decision 34). |
| 8 | L | Stale `running` usage rows could lock a person out for up to 25 minutes after a deploy. | Applied: a row counts as live only for `AI_TURN_TIMEOUT_SECONDS + 60` s, and maintenance runs once at start (O29, ai 7.3, lock 742_005 of 3.3). |
| 9 | M | Errors arriving in the middle of a stream came out as a generic API error. | Applied: `classifyAiError` reads `err.type` for status-less `APIError`s (`overloaded_error` -> `ai_busy`) (ai 6.8; F20 cases). |
| 10 | M | Switching to `tool_choice: none` on the last call invalidates the messages cache; the design also claimed the conversation cache survives across turns. | Applied: `tool_choice: auto` on every call, a `FINAL_STEP_NOTE` text block after the tool results before the last call, remaining tool calls answered with an error; the cache claim corrected (O30, ai 6.3, 6.4). |
| 11 | M | Customers must never see Anthropic's own error text (it can reveal weblion's account state); `sk-ant-admin` keys must be refused. | Applied: fixed English messages per code, the original only redacted in `ai_usage.error_message` for staff; 400 `ai_admin_key` (O32, ai 4.2, 5.2, 6.8; 2.10). |
| 12 | M | The SDK pin 1.3.0 was unverified. | Applied: checked against the published tarball (release date, `fallbacks: 'default'`, beta string, error classes); F still runs the typecheck spike of F10 step 0 and falls back to the newest release at least 14 days old that passes (O19; decision 26). |
| 13 | H | After a restart within 5 minutes a translation job stayed `running` with no runner, and the "job running" 409 blocked every new job. | Applied: the 5 s tick takes over a job without heartbeat for 2 minutes under lock 742_004, the heartbeat runs on its own 30 s timer, `stop()` re-queues the owned job (i18n 12.8; 3.3; `i18n-jobs.test.ts`). |
| 14 | M | Migrations were tested on an empty database only. | Applied: `migrations.test.ts` migrates to `0009`, inserts today's rows, migrates fully and checks the journal order (i18n 10.3, 3.1, F20). |
| 15 | H | AI translations skipped the repository's own checks (French spacing, formal address, German leftovers, length) yet went live for everyone at once, and demo `[FR]` texts stayed live after a real key was added. | Applied: `validateItem` runs the shared `checks.ts` predicates with the allowlists, fixes French spacing, rejects new URLs, e-mail addresses and numbers; demo overrides are served only with the demo provider and deleted in the transaction of `PUT /admin/ai/key` (O11, i18n 12.5, 12.10, 2.2, 2.5; decision 35). |
| 16 | M | One translation unit per language for the whole app (about 4,450 keys, 190,000 characters) risked running out of context. | Applied: three group units per language plus one review unit per language (0, 7; groups A, B, C, with billing moved to C to balance the size). |
| 17 | M | New error responses (such as the AI 409s) used generic codes, so their English messages showed in every language. | Applied: every new AI and i18n error has its own code and texts in all five languages, frozen in 2.10 (A7 now `not_stale` instead of `conflict`); `i18n:report` runs in CI (O32, 8.3). |
| 18 | M | Dutch money input would read `1.250` as 1.25. | **Rejected**: `parseMoney` (`apps/web/src/pages/billing/money.ts:13-27`) accepts at most two decimals, so `1.250` and `12.500` already give null and cannot be misread; test cases added instead (`pages/billing/money.test.ts`, U2; i18n 2.3). |
| 19 | L | A language chunk is about 70 KB gzipped, not the 40 KB estimated, and the e-mail and PDF texts went to every browser. | Applied: web aggregators without `email` and `pdf`, `server.ts` for the API, a static spinner while the chunk loads, 90 KB per locale in `check:chunks` (O33, i18n 3.1, 5.2, 5.4). |
| 20 | M | Chat history broke after ten exchanges or one error (40 messages in the browser, 20 on the server, consecutive user turns, 8,000-character cap on answers). | Applied: a tested `buildHistory()` that trims and keeps roles alternating, 40 messages on both sides, assistant messages up to 16,000 characters (ai 9.2, 12.1). |
| 21 | M | At 390 px the translations table, its filter bar, the assistant header and the launcher (under the toasts) did not fit. | Applied: one card per key below `md`, wrapping filters, icon buttons in the assistant header, launcher at `bottom-20` below `sm`, `pb-20` on the main area while it shows; screenshots at 390 px (i18n 17.3, ai 12.3, F25, 8.5). |
| 22 | L | Ownership gaps: the product translation labels belong in `billing` (U2), showing product names in the viewer's language was assigned to nobody, the error keys were split across units. | Applied: F adds every design key and 5.3, including `billing.product.translations.*` and every error key (O21, 2.10); `productText` in the product list and picker is U4's, in the invoice editor U2's (2.7, 6). |
| 23 | L | Not worth the code now: the TypeScript file-set export, `propose_monitor`, the AI part of the customer summary (its facts are already computed without AI). | Applied: all three removed (O31, i18n 16.3, ai 8.4, 10.5; decision 32; roadmap in 9). |
| 24 | M | Named tests were missing for most findings. | Applied: one set per finding in its owner unit (F20, U1 to U4 test lists in 6, i18n 20, ai 15.2). |

Finding 18 is the only rejection: the risk it describes does not exist in the code, so changing the parser would
add behaviour without fixing anything; the tests pin the existing behaviour for the Dutch and French forms.
