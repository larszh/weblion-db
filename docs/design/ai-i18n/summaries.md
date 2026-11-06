# AI und i18n: Zusammenfassungen der verlorenen Designs

Recovered from the session transcript after the container restart of 06.11.2026. These are the final reports of the design agents (map, ideas, i18n design, AI design, plan, review, revision). The design files themselves (`ai-i18n-map.md`, `i18n.md`, `ai.md`, `ai-i18n-review.md`, `ideen-2026-11.md`) were lost; `i18n.md` and `ai.md` are regenerated in this folder from these summaries and `plan.md`.

## map

The code map is written to `/tmp/claude-0/-home-user/e1b53ffa-f166-56c7-af42-717d9a10bafc/scratchpad/design/ai-i18n-map.md` (554 lines). I changed no repository files.

1. **i18n:** `apps/web/src/lib/i18n.tsx` loads `de` and `en` up front and falls back `DICTIONARIES[locale][key] ?? de[key] ?? key`.
   - Placeholders are `{name}`. There is no plural support: call sites pick a key by count (`*One`, `year1`/`yearsN`).
   - `TranslationKey = keyof typeof de`. Every `*.en.ts` file is typed `Record&lt;keyof typeof xDe, string&gt;`, so a missing key fails the typecheck. The same works for fr, it and nl.
   - There are 3,860 keys with 150,794 German characters: 724 in `de.ts` plus 11 sections. The map has a per-file table.
   - 137 calls build keys at runtime, and 221 values are the same in German and English. Neither "same as German" nor a text search can find untranslated or unused keys.
2. **Locale handling:**
   - `Locale` is `'de' | 'en'` in the web (`lib/format.ts`), in `MailLocale`, in `formatMoney`, and in the `PATCH /auth/me` validation. The labels in `MODULE_DEFS` and `PERMISSIONS` are `{ de, en }` objects, read in about 30 places.
   - `users.locale` is saved but the web never applies it. On a new device the language comes from the browser.
   - New users always get `'de'`. Invitation mails use the inviter's language.
   - Invoice PDFs and billing mails are hard-coded to German.
   - API error messages are English and shown as-is in toasts.
   - Today the language can be switched on the profile page (de/en select), in the user menu and on the login page. `Flag` has no FR, IT or GB icon yet.
3. **Secrets:** stored like the SMTP settings in `mail/settings.ts`, encrypted with `SecretBox`. An env value wins and the UI is then read-only. The UI shows only "set" or `••••••`. Audit entries record only `passwordChanged`.
4. **Admin pages:** a new page needs a lazy route in `App.tsx`, a `NavItem` in `app-shell.tsx` and a new `platform:*` permission in `permissions.ts`. The settings page has tabs (`useTabParam`/`TabBar`).
5. **Per-customer switches:** these are `organizations.modules`, enforced as deny rules in `effectiveBoundary`, with `assertModulesWithin` for resellers. "AI on by default" doesn't fit the current default (only `servers`). It needs a data migration or a separate boolean column defaulting to true.
6. **Jobs and live channels:**
   - Background jobs take advisory locks 742_001 to 742_003, so 742_004 is free.
   - There is no job table, progress API or SSE. Long tasks either return a summary in the request or set a row status that the web polls.
   - The only live channel is the console websocket with one-time tickets.
   - Rate limits: 600 per minute globally, per route via `config.rateLimit`, and per key via `app.createRateLimit`.
7. **AI data access:** every resource type has a loader that already checks access (`loadServer`, `loadDomain`, `loadMailDomain`, `loadMonitor`, `queryAudit` and so on). They all need the live request (`req`), so AI tools must run inside the user's request or use `app.inject`.
8. **Tests and dependencies:**
   - Tests use a shared Postgres (`createTestApp`), the demo provider and `startMockServer`. A Claude mock fits behind a base-URL env var, like `STRIPE_API_BASE` today.
   - The repo has no vendor SDKs; all clients are written against `fetch`, so a Claude client would be too.
   - CI runs prettier on `.ts`/`.tsx`/`.css` only, then typecheck, test and build.
   - Next migration is `0010_*.sql`.

The map ends with six open decisions for the designers.

## ideas

Ich habe die Liste in die Datei geschrieben. Am Repository habe ich nichts geändert. Vier der fünf Top-Punkte vom 24.10. sind im Code nachweislich noch offen. Der fünfte, deine eigenen Apps als erste Websites, betrifft den Betrieb und lässt sich im Code nicht prüfen. Seitdem kamen nur der Umstieg auf die 24fire API v1, Korrekturen am Sync, an 3CX und an rDNS sowie neue Streaming-Funktionen (Quick Connect, Abmelden, Stoppen, Seerr-Anfragen) dazu. Keine davon schliesst eine der alten Lücken.

**Meine Top 5**

1. **Offene Fehler und Betriebssicherheit zuerst** (meist S, das Backup M):
   - Eine Kündigung auf Termin beendet den Dienst sofort (`apps/api/src/modules/billing/routes.ts:870-889`), die Restlaufzeit wird nie verrechnet.
   - Der Audit-Filter entfernt `_`, statt es zu maskieren (`modules/audit/routes.ts:26`). Darum findet die Suche fast keine Aktionscodes.
   - `TRUST_PROXY` steht standardmässig auf `true` (`config/env.ts:22`).
   - Dazu 2FA als Pflicht für das Personal, Alarme mit Heartbeat und ein Backup der Datenbank der Console.
   - Grund: Es geht um Geld, um Nachweise im Audit-Log und um Rechnungen, die 10 Jahre aufzubewahren sind. Mit dem Claude-Schlüssel in der Verwaltung wird der Zugriffsschutz noch wichtiger.
2. **Ein Lebenszyklus für Sperre, Kündigung und Kontingent** (M): Sechs Module (Nextcloud, Mailcow, CloudPanel, 3CX, Uptime Kuma, Jellyfin) haben dieselbe Lücke. Bei Sperre oder Kündigung läuft der Dienst beim Provider einfach weiter. Ohne diesen Baustein gibt es kein Mahnwesen mit Sperre, keinen Self-Service und keine Kündigung ohne Handarbeit. Das KI-Modul und jede neue Integration hängen sich dort an.
3. **Fristen und Benachrichtigungen** (M): Die Ablaufdaten von Domains, Zertifikaten und 3CX-Lizenzen sowie die Fälligkeiten von Diensten und Rechnungen liegen schon in der Datenbank. Daraus werden eine Seite "Fristen", ein Kalender-Feed und Mails. Let's Encrypt verschickt seit Juni 2025 keine Ablauf-Mails mehr und verkürzt die Laufzeit auf 64 Tage ab Februar 2027 und auf 45 Tage ab Februar 2028.
4. **Backups zum Wiederherstellen und Verkaufen** (M, dann L): Proxmox bietet die Wiederherstellung einzelner Dateien aus Proxmox-Backup-Server-Backups schon über seine API. Danach folgt Backup-Speicher pro GB mit einem Namespace pro Kunde. "Keine Wiederherstellung" ist die grösste Lücke für ein Hosting-Geschäft.
5. **Geld schneller rein** (M): Mahnwesen (die Vorlage `invoice_reminder` gibt es, sie wird nie verschickt), Abgleich der Bankdatei camt.054 über die QR-Referenz und automatische Belastung von Karte und TWINT über das bestehende Stripe.
   - Dass TWINT jetzt wiederkehrend geht, habe ich nur aus Suchtreffern zum Stripe-Changelog vom 27.05.2026. docs.stripe.com ist hier gesperrt, also vor dem Bau prüfen.

Knapp dahinter liegen Zammad für den Support und Microsoft 365 über CSP, sobald du Lizenzen verkaufst. Die drei einfachsten Vereinfachungen würde ich vor oder zusammen mit dem KI-Modul machen, weil dort neue Einträge und ein neuer Schlüssel dazukommen: ein Name "Verwaltung" mit Navigation nach Modulen, Provider-Fähigkeiten aus der API statt acht Listen im Web und Zugangsdaten nur noch in der Verwaltung.

Die Datei enthält dazu:
- **Teil A:** 7 Ideen zum Vereinfachen, 12 zum Verbessern und 12 zum Erweitern, jeweils mit Aufwand und den betroffenen Dateien.
- **Teil B:** 18 Integrationen mit Empfehlung "Jetzt" oder "Später" und eine Liste "Weglassen" mit Begründung.
- **Quellen:** API-Fakten sind mit einer Quellenangabe als "belegt" markiert, alles andere als "Vermutung".

Nicht prüfen konnte ich die offiziellen Dokus von Stripe, NinjaOne, Headscale, Netbird, Hornetsecurity und peoplefone. Ob Anthropic im Swiss-U.S. Data Privacy Framework zertifiziert ist, musst du auf der offiziellen Liste nachschauen. Das ist wichtig, weil die KI pro Kunde standardmässig eingeschaltet ist.

Datei: /tmp/claude-0/-home-user/e1b53ffa-f166-56c7-af42-717d9a10bafc/scratchpad/ideas/ideen-2026-11.md

## i18n

I wrote the i18n design to `/tmp/claude-0/-home-user/e1b53ffa-f166-56c7-af42-717d9a10bafc/scratchpad/design/i18n.md` (23 sections). No repository files were changed, and nothing in it was built or run.

1. **Where dictionaries live:** they move to `packages/shared/src/i18n/sections/*.{de,en,fr,it,nl}.ts`, so the API can list keys and source texts and render emails and PDFs. de and en are complete `Record<TranslationKey, string>`; fr, it and nl are `Partial`, so a new key never breaks the build.
2. **Fallback:** fr, it and nl fall back to en, then de. English is complete by type, and French, Italian or Dutch readers understand it better than German.
3. **Number and date formats:** de-CH, en-GB, fr-CH, it-CH, nl-NL. Using en-GB everywhere fixes today's mix where English numbers use en-GB but English money uses en-CH. Invoice PDFs keep Swiss amounts and dates.
4. **Flags:** DE, GB, FR, IT, NL as inline SVGs, because a flag stands for a language here. A CH flag for German only would make German look like "the Swiss language".
5. **Loading:** each language is its own lazy chunk; French also loads English. `main.tsx` waits for the chunk before the first render, so keys never flash, and a CI script checks the dictionaries stay out of the entry chunk.
6. **Overrides:** a `translation_overrides` table (key, locale, value, origin manual|ai, German source hash, reviewed, who, when). A public `GET /api/v1/i18n/overrides/:locale` with an ETag returns them; the browser merges them over the bundles and caches them, so edits show without a deploy. Every save, import and AI result must have exactly the German placeholders, otherwise `placeholder_mismatch` lists what is missing and extra.
7. **Stale detection:** a stamp file per locale records which German text each compiled translation was written against, so "German changed since the translation" works for compiled translations too, not just overrides.
8. **Emails, PDF, Stripe:** all mail texts become `email.*` keys and PDF texts `pdf.*` keys, so they can be translated, edited and mass translated. Billing mails and PDFs use a new `billing_profiles.locale`; issued invoices keep their language in `invoices.locale`. The QR bill's payment part follows the language, falling back to English for Dutch. The QR payment message stays `Rechnung <Nr>` so bank reconciliation doesn't depend on the customer's language.
9. **Labels and permissions:** module and permission labels become dictionary keys; `GET /meta` still returns `{ de, en }` so API clients see no change. New permissions are `platform:i18n:read` (support gets it) and `platform:i18n:write` (marked dangerous because AI costs money).
10. **Pickers:** five flag tiles in the profile, saved to `users.locale` and used for personal emails. A compact menu on the login and invite pages stores the choice locally; the invite page uses it as the new account's language. The user menu lists all five and saves to the profile.
11. **Admin page `/admin/translations`:** coverage per language, filters (untranslated, stale, changed, AI, unreviewed, needs attention, search, area), inline editing per cell with live placeholder chips, revert, mark reviewed, confirm as current. It also has JSON import and export, TypeScript file export with an `i18n:apply` script for committing, a glossary with style notes per language, and cleanup of leftover overrides.
12. **Mass Translate:** a background job in batches of 50 keys or 8,000 characters with structured JSON output, retries and cancel. The cost estimate must be confirmed before it starts. A full fr, it, nl run with Claude Opus 5.5 is estimated at roughly USD 10 to 20.
13. **Initial translations:** nine engineer units plus a review per language, following a guide with formal address, Swiss specifics, a term table and button length rules. Automated checks cover key and placeholder parity, leftover German, informal address, length, glossary terms, no sharp s or em dash, and completeness at the end of the build.
14. **Stays English on purpose:** API error and validation messages, logs, audit and the API Explorer, because they are the developer-facing contract. The web translates only the generic error codes, so specific API errors stay English in every UI language.

Open points:
- **AI contract:** Mass Translate relies on a small contract with the separate AI module design (`ai.md`). Its names (status shape, error codes, demo mode, mock base URL, price table) still need to be matched to that design.
- **Migration number:** it is `0010` or `0011`, depending on which migration lands first.
- **Italian style:** capital "Lei" with lowercase clitics is my choice and can be changed in the Italian style notes.

The design also covers routes, DTOs, the migration, audit, rate limits, the full text list, tests, docs and the split into build units.

## ai

I wrote the AI module design to `/tmp/claude-0/-home-user/e1b53ffa-f166-56c7-af42-717d9a10bafc/scratchpad/design/ai.md` (about 2,100 lines, 19 sections). No repository files were changed. Nothing was built or run.

- **SDK:** the official `@anthropic-ai/sdk` with `baseURL` from env, key passed explicitly and `authToken: null`. Default model `claude-opus-5-5`; Sonnet 5.5 and Haiku 5.5 selectable, never switched by us. Adaptive thinking, effort set per feature (medium or low), streaming with `finalMessage()`, `stop_reason` checked first. Refusal fallback on Opus and Sonnet only (Haiku has none). Prompt cache breakpoint on the fixed system prompt.
- **Chat:** manual streaming loop instead of the beta tool runner. The main reason is the rule that tool calls before a mid-answer fallback must not be re-sent or run. Also needed: per-call budget accounting, a cap of 8 calls and 24 tool calls, a forced text answer on the last call, and one abort signal. Answers stream to the browser as SSE over a POST.
- **How tools read data:** tools never query customer tables. They call an allowlist of existing GET routes in-process, with the user's own session cookie and IP, and any answer belonging to another organization becomes "not found". So the AI cannot write, and the existing permission and module checks apply unchanged. I had to break this rule in one place: the explain feature reads one audit row directly, filtered by organization, because the audit API has no lookup by id.
- **Switches:** platform master switch, 8 feature switches, and `organizations.ai_enabled` (default on, set by staff or the reseller). A separate org decline (`ai_opt_out_at`, permission `ai:settings`) covers the nDSG case. When AI is off for an org, `ai:use` is denied through the same boundary rule modules use, and a reseller's choice also applies to its customers. A customer's decline also blocks staff features. Nothing is shown when off; routes answer 404 (platform or feature off) or 403 (organization off).
- **Key and storage:** key encrypted with `SecretBox` in the settings table, never returned or logged, with a test-connection button. A saved key wins over `ANTHROPIC_API_KEY`, which is only a fallback. This is the reverse of SMTP (where env wins), so a leaked key can be rotated from the page without a redeploy.
- **What is stored:** no prompts or answers. `ai_usage` holds metadata only (tokens, model, feature, org, user, duration, status). The short Anthropic error message is kept 30 days for the errors list, then cleared.
- **Limits:** a reservation row is written before each call and checked against the monthly USD budget (hard stop, warning mail and audit entry), daily limits per organization and per person, 2 concurrent requests and 12 per minute.
- **Features:** assistant chat (23 read-only tools, DNS and monitor proposals that open the existing dialog pre-filled), error explanations (toasts, error boxes, audit, server actions, monitors, websites, providers, mail log), DNS and mail check with validated record proposals, audit summary, server analysis, staff customer overview, product texts in five languages (new `products.translations` column), and `ctx.ai.translate()` for the i18n mass translate.
- **Safety:** third-party text goes in escaped blocks, secrets are redacted (patterns plus exact env values), answers render without HTML and only console links are clickable. Isolation and secret tests are specified.
- **Rest of the design:** the admin page at `/admin/ai` (settings, usage dashboard with the five model prices, errors), where each button goes on existing pages, every route and DTO, the migration, German and English texts, the demo mode (real SDK against an in-process emulator, answers marked "Demo"), the local Claude API mock and test list, docs, and the work split.

Decisions for you (the design uses these defaults; change on the KI page or in the role definitions):
- Budget 100 USD a month with a warning at 80%, 200 requests per organization and day, 50 per person and day.
- Viewers may use the assistant; remove `ai:use` from the viewer role if you don't want that.
- Support staff may use the admin AI features; remove `platform:ai:use` from the support role if only superadmins should.
- Customers see their request counts, never costs; staff see costs.

Before going live, check the data notice against Anthropic's current terms and data processing agreement, and the processing location of your Anthropic workspace.

For the i18n design: `i18n.md` did not exist yet, so the shared points are in section 17. The ones it must honour: the shared `Locale` type, the `translate()` contract, the notice text as key `ai.notice.text` editable in the translation admin, demo translations never saved, and the `products.translations` column.

## plan

I wrote the build plan to `/tmp/claude-0/-home-user/e1b53ffa-f166-56c7-af42-717d9a10bafc/scratchpad/design/ai-i18n-plan.md` (968 lines). No repository file was changed. Nothing in it has been built or run yet. I checked the repository layout and the SDK package, but the steps themselves are untested.

- **Conflicts resolved (O1 to O25, binding over both designs):**
  - Locales live in `packages/shared/src/i18n/locales.ts`. All dictionaries move to `packages/shared/src/i18n/`, and the AI texts become a new section `ai`. Permission labels become `perm.<action>` keys.
  - **One Claude path:** `ctx.ai.structured()`. ai.md's `translate()` and its translations prompt are dropped. The i18n translator owns the prompt (first line `# Feature: translations`), batching, checks and retries. A table in section 2.6 maps the AI error codes to what the job does.
  - **Mass Translate gate:** an availability check returns 409 `ai_not_configured` when AI is off. It also needs `platform:i18n:write` and `platform:ai:use`.
  - **Budget:** each translation batch writes a normal `ai_usage` row and counts against the monthly budget. Per-person limits don't apply to the job. The estimate shows the remaining budget and warns if it won't be enough.
  - **Translation settings:** effort medium, 32,000 max tokens, always streamed.
  - **Demo mode:** goes through the emulator, which answers `[FR] <German text>`. Unlike ai.md said, these results are saved, so the flow can be shown; the job is marked "Demo".
  - **Migrations:** `0010_ai.sql`, then `0011_i18n.sql`, both in the foundation. In `0011` the `users.locale` cleanup has to be placed by hand before the new check constraint.
  - **Stamps** are one file per language and section, and the per-language allowlists are separate files, so no two units edit the same file.
  - **SDK:** pinned to exactly `@anthropic-ai/sdk` 1.3.0. I downloaded it and checked: it has `fallbacks: 'default'`, the `server-side-fallback-2026-07-01` beta, `output_config`, the typed errors and the client options. It is two weeks old and has no install scripts; 1.6.0 (latest) is one day old.
- **Foundation (F, one engineer):** 26 steps. It includes:
  - the dictionary move;
  - every new de/en key from both designs, plus 11 keys the plan adds (5.3);
  - shared types, permissions and roles, env, both migrations;
  - redaction, the boundary deny for AI;
  - the complete AI settings and key routes and `structured()` with budget reservation;
  - the i18n service and the public overrides endpoint;
  - the Claude mock skeleton and foundation tests;
  - web stubs, nav entries and routes.
- **Four build units, with exclusive file ownership (section 11):**
  - U1: i18n admin API, Mass Translate job, translation admin page.
  - U2: web language runtime, pickers with flags, formatting, e-mails, PDF, billing language.
  - U3: AI API.
  - U4: AI web.
- **Translations:** T-fr, T-it and T-nl translate every key of the foundation commit, including e-mails and PDF, with fixed rules, glossary additions and checks. Keys that units add later are translated by the integrator, who finds them with `i18n:report --missing`.
- **Integration and docs:** sections 8 and 9 list the merge order, all checks (fresh test DB, completeness, chunk check, review greps), the end-to-end scenarios with demo and mock, and 23 screenshots at 390 and 1280 px. Docs are new `docs/ai.md` and `docs/i18n.md`, plus updates to architecture, deployment, roadmap, providers, README and `.env.example`.
- **30 product decisions** are listed in section 10. Ones to confirm:
  - Demo results are saved.
  - Mass Translate shares the one monthly AI budget with all other AI features.
  - Only superadmins can run Mass Translate.
  - Navigation order: Audit-Log, KI, Übersetzungen, Einstellungen.
  - The SDK pin to 1.3.0.

## review

I reviewed the three designs against the code at `c6c51ad` and the claude-api skill files, and wrote 24 findings with fixes to `/tmp/claude-0/-home-user/e1b53ffa-f166-56c7-af42-717d9a10bafc/scratchpad/design/ai-i18n-review.md`. Most of the Claude API usage is correct: exact model ids, adaptive thinking with explicit effort, auto/none tool choice with strict tools, streaming with `finalMessage()`, and refusal fallback on Opus/Sonnet only. The serious gaps are tenant isolation, the default-on privacy flow, the budget and the job runner. H = change the plan before building, M = fix in the named unit, L = small.

1. H. Tools that read sub-resources by id (`/domains/{id}/dns`, `/servers/{id}/metrics`, `/mail/domains/{id}/mailboxes`) get answers with no `org` field, so they pass `assertSameOrg`. Resources with `org: null` pass too. A member of two orgs, or reseller staff, can pull another org's data into the model even if that org declined. Fix: read and check the parent resource first, and treat a missing or null org as not found.
2. H. Customers cannot decline in advance (the decline card is hidden while platform AI is off), and a suspended org cannot decline at all (`ai:settings` is not in `SUSPENDED_ALLOWED`). Under the nDSG a new US sub-processor needs the customer's prior approval and a basis for the US transfer. Fix: always show the decline card, allow `ai:settings` while suspended, and add a go-live checklist (contract update, owner mail 30 days ahead).
3. H. The data notice is wrong or incomplete. It says passwords are never sent, and it leaves out Anthropic's retention, staff use of AI on customer data, e-mail addresses and IP addresses. Fix: strip IPs, e-mails and the person's name before sending, then reword the notice. Keep it out of Mass Translate and show German or English while a translation is stale.
4. M. Declined customers still reach the model through the reseller audit log and the admin audit summary (the summary filters only by `org.id`). Fix: also filter by `resourceType = 'org'` plus `resourceId`.
5. M. Injected text (TXT records, monitor messages, SMTP errors) can produce attacker DNS proposals. Fix: mark a proposal verified only when it equals a record the console computed; warn and ask for a second confirm otherwise.
6. M. Live provider reads per chat are unbounded. Fix: at most 8 live tool calls per turn and 30 per org per minute.
7. H. The budget is not a hard stop: it is checked once per request against an estimate, there is no per-turn or global cap, and jobs can overrun. Fix: re-check after every call and every batch, add per-turn, global and per-org caps, and stop a job at 1.5 times its estimate.
8. L. Stale "running" usage rows can lock a person out for up to 25 minutes after a deploy. Fix: tie staleness to the turn timeout and run maintenance once at startup.
9. M. Errors that arrive mid-stream come out as a generic API error. Fix: classify them by the error type in the body (overloaded becomes "busy").
10. M. Switching to `tool_choice: none` on the last call invalidates the messages cache. Fix: keep `auto`, answer remaining tool calls with an error and add an appended text block. Also correct the claim that the conversation cache survives across turns.
11. M. Customers must never see Anthropic's own error text, which can reveal weblion's account state. Also reject `sk-ant-admin` keys.
12. M. The SDK pin 1.3.0 is unverified. Fix: check the release and run a short typecheck of the exact params first; otherwise take the newest release at least 14 days old that passes.
13. H. After a restart within 5 minutes a translation job stays "running" with no runner, and the "job running" 409 blocks every new job. Fix: the 5-second poll takes over stale jobs under the lock, and the heartbeat runs on a timer.
14. M. Migrations are only tested on an empty database. Fix: a test that migrates up to 0009, seeds rows, then migrates fully, and checks that journal timestamps increase.
15. H. AI translations skip the repository's own checks (French spacing, formal address, German leftovers, length) yet go live for everyone at once, and demo `[FR]` texts stay live after a real key is added. Fix: run the shared checks in the job's validator, fix French spaces automatically, reject new URLs, e-mails or numbers, and never serve demo results once a key exists.
16. M. One translation unit per language for the whole app (about 4,450 keys, 190,000 characters) risks running out of context. Fix: three units per language plus one review.
17. M. New error responses (such as the AI 409s) use generic codes, so their English messages show in every language's toasts. Fix: give each its own code with keys in all five languages, and print the translation report in CI.
18. M. Dutch money input reads "1.250" as 1.25. Fix: locale-aware parsing that rejects the ambiguous form and shows a preview of the amount.
19. L. Each language chunk is about 70 KB gzipped, not the 40 KB the design estimates, and the e-mail and PDF texts go to the browser for nothing. Fix: a server-only aggregator, a loading spinner, and a size limit in the chunk check.
20. M. Chat history breaks after ten exchanges or one error (browser keeps 40 messages, server accepts 20; consecutive user turns; 8,000-character cap on answers). Fix: a tested `buildHistory()` that trims, and a higher limit for assistant messages.
21. M. At 390 px the translations table, the filter bar, the assistant header and the launcher (it sits under the toasts) do not fit. Fix: cards below `md` with one row per language, wrapping filters, icon buttons, and a shifted launcher.
22. L. Ownership gaps: the product translation field labels belong in `billing` (owned by U2), showing product names in the viewer's language is assigned to nobody, and the error keys are split across units. Fix: F adds the keys and the product name display goes to U4.
23. L. Not worth the code now: the TS file-set export, `propose_monitor`, and the AI part of the customer summary (its facts are already computed without AI).
24. M. A list of named missing tests, one set per finding above, each in its owner unit.

## revised

I updated `ai.md`, `i18n.md` and `ai-i18n-plan.md` for all 24 findings: 23 are fixed, 1 is rejected. A "Review" section at the end of the plan gives the verdict and the change for each one. No repository files were changed.

**Summary of changes (each finding listed in plan section 12):**
1. **Tenant isolation (#1):** a new `ConsoleReader.owned()` loads the parent resource first and refuses it unless it belongs to the current organization (`org: null` included). Sub-paths like `/dns` or `/metrics` are refused unless their parent was checked in the same run. Tool results escape `<` and `>`.
2. **Declining before go-live (#2):** customers can decline at any time, also before the master switch is on and while suspended (`ai:settings` added to `SUSPENDED_ALLOWED`). The org, staff and reseller cards no longer depend on the platform switch.
3. **Go-live checklist (#2):** sub-processor list in the AGB/AVV, legal basis for the US transfer, announcement mail 30 days ahead. The KI page asks for it when the master switch is turned on.
4. **Staff usage visible (#2):** requests that weblion staff run on a customer's data now count in that customer's usage line.
5. **Personal data and notice (#3, #4):** IPs, user agents and e-mail addresses are removed from audit data before sending. The request context carries the person's role, not the name. Declined customers are filtered out of reseller and admin audit data.
6. **Data notice text (#3):** rewritten in de/en. Its sentence on Anthropic's training and retention still needs your check against Anthropic's terms and data processing agreement (checklist item). The notice is never machine-translated and never shown out of date: an outdated translation falls back to English, else German.
7. **Budget is a hard stop (#7, #8):** checked again after every chat API call. One answer may cost at most 5x its estimate, a translation job at most 1.5x. Concurrency caps: 3 per organization, 6 for the whole platform. Rows left behind by a restart stop counting after the turn timeout plus one minute.
8. **Provider calls capped (#6):** at most 8 live provider reads per chat answer and 30 per organization per minute.
9. **Claude API (#9, #10, #11):** `tool_choice` stays `auto` on every call; the last call gets a "final step" note instead, which keeps the prompt cache. Mid-stream errors are classified by `err.type`. Customers see fixed English error texts, never Anthropic's own message. Admin keys (`sk-ant-admin`) are rejected.
10. **SDK pin (#12):** `@anthropic-ai/sdk@1.3.0` exists (released 2026-10-23), and I checked its published types against everything the plan relies on. The pin stays; F still runs a short typecheck first.
11. **Mass Translate (#13, #15):** a crashed or restarted job is taken over after 2 minutes instead of blocking all new jobs. AI translations must pass the same checks as the repository texts (German leftovers, informal address, length, French spacing, no new links, addresses or numbers). Demo pseudo-translations are deleted when a real key is saved.
12. **Error codes (#17):** every new AI and i18n error has its own code and a text in all five languages; the full list is frozen in plan 2.10.
13. **Smaller fixes (#14, #19–#22):** migrations tested on real data and journal order; email and PDF texts kept out of the web bundles; a loading spinner while the language loads; chat history rebuilt cleanly after errors; layouts fixed at 390 px.
14. **Rejected (#18):** the Dutch money input cannot misread `1.250`, because the existing parser already rejects more than two decimals. I added test cases instead.
15. **Scope cuts (#23):** removed the staff customer summary (`customer_summary`), monitor proposals in the assistant (`propose_monitor`) and the TypeScript file export.

**Final AI features (7):**
1. KI-Assistent: chat with 22 read-only tools and DNS proposals marked as checked or unchecked.
2. Fehler erklären: for organizations and in the admin area.
3. DNS- und E-Mail-Prüfung.
4. Audit-Zusammenfassung: for organizations and in the admin area.
5. Server-Auswertung.
6. Produkttexte: in 5 languages, for admin and resellers.
7. Übersetzungen: Mass Translate jobs and single-row suggestions.

**Final unit split:**
- **F (foundation):** shared types and dictionaries, migrations 0010/0011 plus the migration test, the AI core with settings, key and test routes, the i18n service, the mock and its tests.
- **4 build units, in parallel:**
  - U1: i18n admin API, Mass Translate job, translation page.
  - U2: web language runtime, language pickers, formatting, e-mails, PDF, error texts.
  - U3: AI API (limits, budget, tools, chat, features).
  - U4: AI web (KI page, switch cards, assistant, feature buttons).
- **9 translation units, in parallel:** T-fr, T-it and T-nl, each split into three section groups:
  - A: core, admin, ai, translations, email, pdf.
  - B: hosting, cloudflare, websites, mail.
  - C: billing, cloud, storage, phone, media, uptime.

  I moved billing from the review's group A to C to balance the size.
- **Then:** one review unit per language (R-fr, R-it, R-nl) merges its three groups and checks the whole language. After that, I integrates and D writes the docs.

Files are in /tmp/claude-0/-home-user/e1b53ffa-f166-56c7-af42-717d9a10bafc/scratchpad/design/:
- ai-i18n-plan.md
- ai.md
- i18n.md
