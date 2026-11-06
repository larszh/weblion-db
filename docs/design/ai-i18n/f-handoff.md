# Übergabe im Fundament (F1 bis F26)

Das Fundament (Plan, Abschnitt 5) wird von vier Teilen nacheinander auf `ai-i18n/f` gebaut. Jeder Teil hängt hier
seinen Abschnitt an: was gebaut ist, Abweichungen, was der nächste Teil wissen muss.

## Teil 1: Shared-Paket und Web-Codemod (F1 bis F9, F21 bis F23)

### Gebaut

- **F1** Alle Abschnitte liegen in `packages/shared/src/i18n/sections/` (16 Abschnitte x 5 Sprachen = 80 Dateien).
  Die 724 Inline-Schlüssel von `apps/web/src/i18n/de.ts` und `en.ts` stehen unverändert mit Kommentaren in
  `core.de.ts` und `core.en.ts`. `apps/web/src/i18n/` ist gelöscht. fr, it, nl sind leer
  (`Partial<Record<keyof typeof <s>De, string>> = {}`).
- **F2** `locales.ts`, `interpolate.ts`, `placeholders.ts`, `types.ts`, `sections/index.ts` (mit `SECTION_GROUPS`),
  Web-Aggregatoren `de.ts` bis `nl.ts` (14 Abschnitte, mit `I18N_CHUNK`), `server.ts` (alle 16, `SECTION_SOURCES`),
  `catalog.ts` (64 statische JSON-Importe), `glossary.ts` (`DEFAULT_GLOSSARY`: Tabelle i18n 19.3 mit den KI-Zeilen
  aus Plan 7.3, dazu die Namen aus Regel 10 als `keep`), `checks.ts` (alle Prädikate der Prüfungen 1 bis 11 und
  `checkValue`), neun Allowlist-Dateien `allowlists/<l>/<g>.ts` (leer), 64 Stempeldateien `stamps/<l>/<s>.json`
  (alle `{}`), `i18n.test.ts` (Prüfungen 1 bis 11, je Abschnitt und Sprache ein Test, dazu die Hilfsfunktionen und
  der Katalog).
- **F3** Alle neuen de/en-Schlüssel, aus den Designtabellen maschinell übernommen und gegen Plan 2.10 und 5.3
  abgeglichen (keine Abweichung): i18n 18.1 (core, billing), 18.2 (translations), 18.3 (email), 18.4 (pdf), ai 13
  (Abschnitt `ai`; `nav.admin.ai`, `perm.group.ai` und die drei KI-Berechtigungen in `core`), `perm.<action>` für
  alle 98 Aktionen, `module.<m>.label` und `.description` für die 8 Module, die Schlüssel aus Plan 5.3, die O34-
  Schlüssel (`admin.ai.card.consent*`, `ai.org.notEnabled`, `admin.ai.status.enableOptIn`). Mehrfachzeilen sind in
  einzelne Schlüssel aufgelöst. Nicht aufgenommen (entfallene Funktionen): `ai.customer.*`,
  `ai.feature.customer_summary.*`, `ai.tool.propose_monitor`, `ai.proposal.monitor`, `admin.i18n.export.ts*`,
  `admin.ai.status.enableAnnouncedOn`, `enableTooEarly`.
- **F4** `packages/shared/package.json` mit `"./i18n/*"`; der Index exportiert locales, interpolate, placeholders,
  `export type *` aus `types.ts`, `translations`, `ai`, nie ein Wörterbuch.
- **F5** `PermissionDef` ohne `label`, `def(group, extra)`, Gruppe `ai` nach `monitoring`, 98 Aktionen,
  `ModuleDef` nur noch mit `actions`; Rollen nach Plan 4.1 (`MemberOperate`, `ReadOnly`, `SupportRead`).
- **F6** `ai.ts` nach ai 3.1 und Plan 2.3, `ai.test.ts` mit den Fällen 1 bis 10 und den Fehlerlisten.
- **F7** `translations.ts` nach i18n 14.1 mit `LEGAL_KEYS`, `I18N_ERROR_CODES`, `TRANSLATION_JOB_ERROR_CODES`.
- **F8** `billing.ts` (`ProductTranslations`, `productText`, `ProductDto.translations`,
  `BillingProfileDto.locale` und `effectiveLocale`, `InvoiceDetailDto.locale`, `formatMoney(..., locale: Locale)`
  mit `intlLocale`), `dto.ts` (`UserDto.locale: Locale`, `IntegrationsDto.ai`).
- **F9** `access.test.ts`: Block `ai` (Rollen, ausgeschaltet als Standard, Ablehnung, Reseller-Kaskade für
  Mitglieder und Reseller-Personal, gesperrte Organisation behält `ai:settings`, Support, Plattform-Aktionen nie über
  Organisationsrollen, Tokens, Policy-Muster `ai:*`).
- **F21** Alle Importe aus `@/i18n/` umgestellt (29 Typimporte auf `@weblion/shared`, `requests.test.tsx` auf
  `@weblion/shared/i18n/en`); `lib/format.ts` exportiert `Locale` aus `@weblion/shared`.
- **F22** `lib/i18n.tsx` nach Plan 2.9 mit statischen Importen aller fünf Sprachen (fr, it, nl als `{ ...en, ...x }`),
  `bootI18n`, `I18nProvider` mit optionalem `boot`, `useChangeLocale`, `hasKey`; `applyOverride(s)` sind No-ops;
  `initialLocale()` nimmt alle fünf (`matchLocale(navigator.languages)`).
- **F23** Alle Aufrufstellen aus i18n 3.3 auf `t(\`module.${m}.label\`)`, `t(\`module.${m}.description\`)` und
  `t(\`perm.${p}\`)` umgestellt; ungenutzte Importe (`MODULE_DEFS`, `useMeta` in `customers.tsx`) entfernt.

Schlüssel je Abschnitt (de = en): core 857, admin 231, ai 307, translations 191, email 54, pdf 44, hosting 320,
cloudflare 165, websites 379, mail 389, billing 456, cloud 45, storage 189, phone 238, media 429, uptime 308;
zusammen 4602.

### Kleinste Anpassungen ausserhalb des Shared-Pakets (damit alles kompiliert)

- `apps/api/src/modules/meta/routes.ts`: `/meta` liefert `label: { de, en }` weiter, jetzt aus `serverDe`/`serverEn`
  (`@weblion/shared/i18n/server`). **F17** stellt auf `ctx.i18n.t('de' | 'en', ...)` um, damit Overrides gelten.
- `apps/api/src/lib/dto.ts`: `locale: normalizeLocale(user.locale) ?? 'de'` (F18, fertig).
- `apps/api/src/modules/billing/dto.ts`: Platzhalter `translations: {}`, `locale: null`, `effectiveLocale: 'de'`,
  Rechnungsdetail `locale: 'de'`, je mit Kommentar `// i18n: F12/F18 replace this ...`. Die Spalten kommen mit den
  Migrationen (F12); F18 liest sie dann.
- `apps/api/src/modules/settings/routes.ts`: `ai: { configured: false, source: 'none', enabled: false, model }` mit
  Kommentar; **F17/F18** ersetzt das durch `await ctx.ai.integrationStatus()`.
- `apps/web/src/pages/mail/units.ts`: `UNLIMITED` als Funktion mit den Texten von `mail.units.unlimited` (Englisch für
  fr, it, nl), Kommentar `// i18n: U2 replaces this`; Wörterbücher importiert nur `lib/i18n.tsx`.
- `apps/web/src/pages/billing/money.ts` (`unitForInterval`, Englisch für fr, it, nl) und
  `pages/hosting/bits.tsx` (`Locale` statt `'de' | 'en'`), Kommentar `// i18n: U2 replaces this` wo nötig.

### Abweichungen und Entscheide

1. `buildCatalog(sources?: CatalogSources, stamps?: Partial<StampFiles>)`: die Parameter sind breiter als in Plan
   2.2 (`typeof SECTION_SOURCES`, `StampFiles`), damit `testCatalog()` (U1) nur wenige Abschnitte und Sprachen
   übergeben muss. Rückwärtsverträglich; Plan 2.2 und i18n 3.1 sind angepasst. Zusätzlich exportiert:
   `repositoryStamps()` (die 64 Dateien, auf Paare von Hashes geprüft; ein kaputter Stempel wirft beim ersten
   `buildCatalog()`, nicht beim Import).
2. Zusätzliche Exporte (additiv): `ALLOWLIST_FILES` (checks.ts, für den Test der Allowlist-Schlüssel),
   `WebSection` und `SectionGroup` (sections/index.ts), `CatalogSources` (catalog.ts).
3. `placeholdersMatch(...).lineBreaks` ist `true`, wenn die Zahl der Zeilenumbrüche gleich ist (also "in Ordnung").
4. `hasSharpS` erkennt auch das grosse scharfe S (U+1E9E); der Fehlertext nennt weiterhin `U+00DF`.
5. `checkValue`: harte Prüfungen (Platzhalter, scharfes S, Gedankenstrich) für alle fünf Sprachen; de und en nur
   diese. Die weichen Prüfungen 3 bis 6 nur für fr, it, nl (mit `skipLanguage` ausgelassen), 11 nur für fr. Die
   Allowlists der Sprache werden über `key` angewendet.
6. Prüfung 3 (Deutsch-Reste): Markerwörter klein verglichen, `Sie`, `Ihr`, `Ihre` usw. nur gross; pro Sprache
   ausgenommen: en `hat`, `den`; nl `den`, `der`, `werden`, `noch` (gewöhnliche niederländische Wörter).
7. Prüfung 1 für Allowlists: ein Eintrag muss ein Schlüssel eines Abschnitts **seiner** Gruppe sein (strenger als
   "existiert irgendwo", passt zur Zuständigkeit aus Plan 7.1).
8. Glossar: die Klammerzusätze der Tabelle (Dienst, Monitor, Verwaltung, Tokens, Ablehnen) sind `note` auf Englisch
   (für den Prompt von Mass Translate und die Admin-Seite); `term` ist das Wort ohne Klammer.
9. ai 3.1 Fall 4 widersprach Fall 5: eine Million Haiku-Eingabetokens ist Long Context. Der Test prüft die
   Grundpreise von Haiku unter 100'000 Tokens und rechnet hoch; ai.md ist angepasst.
10. `aiCostMicros` rechnet ganzzahlig (Preise x 1'000, nicht gelistete Modelle x 5/4) und rundet einmal pro Aufruf
    auf, damit Gleitkommareste nie einen Mikro-Dollar zu viel ergeben.
11. Die Typimporte von `TranslationKey` stehen als eigene Zeile `import type { TranslationKey } from
    '@weblion/shared'` neben bestehenden Importen aus demselben Paket (rein mechanischer Codemod).

### Was der nächste Teil wissen muss

- **`i18n:stamp` nicht gelaufen** (Auftrag): alle 64 Stempeldateien sind `{}`. Teil 2 schreibt das Skript (F16) und
  führt `pnpm --filter @weblion/api i18n:stamp --locale en` aus; erst dann kann `i18n-stamps.test.ts` grün sein.
- Die API-Tests laufen mit diesem Stand (bis auf die bekannten drei Ausfälle in `monitoring.test.ts` unter Last).
  `/meta` liefert die Labels unverändert in der alten Form.
- `apps/web/src/test/i18n.tsx` (`withI18n`), `lib/api-errors.ts`, `components/ai/*`, `server-bits.tsx` (Flaggen),
  `App.tsx`, `app-shell.tsx`-Navigation sind **nicht** gebaut (F24 bis F26).
- Nur `lib/i18n.tsx` und Tests importieren `@weblion/shared/i18n/*` im Web; `server` und `catalog` nie.
- Die API darf `@weblion/shared/i18n/server`, `/catalog`, `/glossary`, `/checks` importieren; tsup bündelt die
  Unterpfade mit (`noExternal: ['@weblion/shared']` greift, geprüft mit `pnpm --filter @weblion/api build`).
- `LEGAL_KEYS` liegen in `translations.ts`; `legalProblems` prüft nur, ob ein Wert vorhanden ist. Aktualität
  (Stempel) prüft `i18n-stamps.test.ts` mit `I18N_REQUIRE_LEGAL` (Teil 2).
- `apps/api/scripts/i18n-apply.ts` und `i18n-report.ts` sind schon als Stubs von F16 angelegt ("not implemented",
  Exit 1), damit der Prettier-Glob `apps/api/scripts/**/*.ts` der Prüfung Dateien findet (sonst Exit 2). Noch offen
  aus F10/F16: `"scripts"` in `apps/api/tsconfig.json` `include`, die drei Skripte in `apps/api/package.json` und
  `scripts/i18n-stamp.ts`.
- `permissions.ts` hat keine Texte mehr. Wer einen Berechtigungsnamen braucht: Web `t(\`perm.${p}\`)`, API
  `ctx.i18n.t(locale, \`perm.${p}\`)`.

## Teil 2: API-Datenmodell, i18n auf dem Server, Grenze (F10 bis F12, F14, F16, i18n-Teile von F17 bis F20)

### Gebaut

- **F10** Schritt 0: `@anthropic-ai/sdk@1.3.0` ist am 23.10.2026 erschienen (14 Tage vor dem Bau). Die
  Typprüfung aus F10 (Spike mit `client.beta.messages.stream`, `thinking: adaptive`, `output_config.effort` und
  `format`, `betas: ['server-side-fallback-2026-07-01']`, `fallbacks: 'default'`, `strict`-Tool,
  `stop_details`, `usage.iterations`, `stream.request_id`, `err.type` und die zehn Fehlerklassen) lief ohne Fehler;
  `fallbacks: 'bogus'` scheitert wie erwartet, die Typen sind also streng. Der Umweg `WithFallbacks<T>` (ai 6.2)
  ist **nicht** nötig. Danach `pnpm --filter @weblion/api add @anthropic-ai/sdk@1.3.0 --save-exact`; das SDK zieht
  `@opentelemetry/api`, `json-schema-to-ts` und `standardwebhooks` nach (keine Install-Skripte). Im Lockfile
  bekommt `drizzle-orm` dadurch den optionalen Peer `@opentelemetry/api` (gleiche Version). `"scripts"` steht in
  `apps/api/tsconfig.json` `include`; `i18n:stamp`, `i18n:apply`, `i18n:report` in `apps/api/package.json`.
- **F11** `config/env.ts` und `.env.example` (Abschnitte `# --- Claude (KI) ---` und `# --- Übersetzungen ---`):
  `ANTHROPIC_API_KEY` (leer), `ANTHROPIC_BASE_URL`, `ANTHROPIC_MAX_RETRIES` (0 bis 5, 2), `AI_TURN_TIMEOUT_SECONDS`
  (30 bis 600, 180), `I18N_JOB_ENABLED` (true), `I18N_AI_CONCURRENCY` (1 bis 4, 2).
- **F12** `schema.ts` in zwei Schritten, `0010_ai.sql` und `0011_i18n.sql` mit drizzle-kit erzeugt (Journal
  `when` 1793986103243 und 1793986173869, also grösser als 0009). 0010 hat **keine** Datenanweisung (O34), nur den
  Kommentar am Ende. 0011 hat die Bereinigung von `users.locale` von Hand direkt vor `users_locale_check`. Ein
  weiteres `db:generate` meldet "No schema changes". Neue Typen: `AiUsageRow`, `TranslationOverride`,
  `TranslationGlossaryRow`, `TranslationJob`.
- **F14** `effectiveBoundary` hängt `aiDenyStatements(org)` an; `SUSPENDED_ALLOWED` enthält `ai:settings`.
- **F16** `apps/api/src/i18n/{hash,service,glossary,entries,jobs}.ts`, `modules/i18n/routes.ts` (nur A1, dazu
  `etagMatches`), `modules/i18n/ai-routes.ts` (leer), `scripts/i18n-stamp.ts` (vollständig), `i18n-apply.ts` und
  `i18n-report.ts` (Stubs, "not implemented", Exit 1). `entries.ts`: `saveOverride`, `revertOverride`,
  `setReviewed`, `deleteDemoOverrides` fertig; `confirmCurrent`, `cleanup` werfen "not implemented" (U1).
  `jobs.ts`: `TranslationJobRunner` als Hülle (start, stop, tick tun nichts, `requestCancel` wirft), dazu
  `I18N_JOB_LOCK = 742_004` und `instanceId`.
- **F17 (i18n-Teil)** `context.ts` mit `i18n` und `i18nJobs`; `app.ts`: `BuildOptions.i18nCatalog`, zuerst
  `I18nService`, `await i18n.load()`, `await seedGlossary(db)`, dann `MailService(db, box, env, log, i18n)`;
  Kontext als `const base: Omit<AppContext, 'i18nJobs'>`, danach `ctx.i18nJobs = new TranslationJobRunner(ctx,
  pool, { concurrency: env.I18N_AI_CONCURRENCY })`; `i18nRoutes` und `i18nAiRoutes` in der `/api/v1`-Liste.
  `index.ts`: `ctx.i18n.start()`, `ctx.i18nJobs.start()` nur mit `I18N_JOB_ENABLED`; beide werden in `shutdown`
  vor `app.close()` gestoppt.
- **F18 (ohne die zwei KI-Punkte)** `/meta` liest die Berechtigungstexte pro Anfrage über `ctx.i18n.t('de' | 'en',
  ...)`, Overrides gelten also. `PATCH /auth/me` nimmt `z.enum(LOCALES)`. `billing/dto.ts` liest
  `products.translations`, `billing_profiles.locale` und `invoices.locale`. Produkte: `POST` und `PATCH
  /billing/products` nehmen `translations` (`z.partialRecord`), `product.create` protokolliert die gefüllten
  Sprachen (Plan 4.3). `mail/types.ts`: `MailLocale = Locale`; `templates.ts` rendert fr, it, nl englisch
  (`templateLocale`, Kommentar `// i18n: U2 replaces this`), `mailLocale()` ist `normalizeLocale(value) ?? 'de'`.
  `db/seed-i18n.ts` (Stub) wird am Ende von `seedDemo` aufgerufen.
- **O34-Demo** `seedDemo` schaltet die KI für Muster AG (Annas Organisation) und Alpen Hosting ein, aber nur, wenn
  niemand sie aus- oder abgeschaltet hat (`ai_disabled_by` und `ai_opt_out_at` leer). Beispiel GmbH und
  Bäckerei Huber bleiben aus, damit der Schalter zu sehen ist.
- **F19 (erste Hälfte)** `test/helpers.ts`: `TestAppOptions.i18nCatalog`, Standard `ANTHROPIC_BASE_URL:
  'http://127.0.0.1:9'` und `ANTHROPIC_MAX_RETRIES: '0'` (Tests können beides überschreiben),
  `enableAiForOrg(db, orgId)`.
- **F20 (i18n-Teil)** `test/i18n-service.test.ts` (19 Fälle), `test/i18n-stamps.test.ts` (11 Fälle; der Fall
  `I18N_REQUIRE_LEGAL` wird ohne Schalter übersprungen und schlägt mit `I18N_REQUIRE_LEGAL=fr` wie erwartet fehl,
  solange fr leer ist), `test/migrations.test.ts` (8 Fälle).
- `pnpm --filter @weblion/api i18n:stamp --locale en` ist gelaufen: 16 Dateien `stamps/en/*.json` mit 4602
  Stempeln; `i18n:stamp --check` meldet "64 files up to date, 0 stale".

### Abweichungen und Entscheide

1. **`I18nService.refresh(): Promise<boolean>`** ist zusätzlich öffentlich (ein Schritt des 15-s-Timers), damit
   der Test das Nachladen ohne echten Timer auslöst (i18n 20.2). Plan 2.5 und i18n 8.1 sind ergänzt.
2. **Glossar im Speicher.** `load()` liest auch das Glossar (für die Warnungen von `cell()`); die
   Vergleichssignatur des Timers umfasst Anzahl und neuestes `updated_at` von Overrides **und** Glossar. Ist die
   Tabelle leer (erster Start vor `seedGlossary`), gilt `DEFAULT_GLOSSARY`; die Reihenfolge load, seedGlossary aus
   Plan F17 bleibt deshalb unverändert.
3. **Versteckte Overrides in `cell()`** (Demo-Zeile ohne Demo-Anbieter, veralteter Rechtstext): `value`,
   `origin`, `reviewed` und `state` beschreiben, was in dieser Sprache ohne Ersatzkette ausgeliefert wird (der
   kompilierte Text mit `origin: 'repo'` oder "fehlt"); `hidden: true`, `demo`, `updatedBy`, `updatedAt` kommen von
   der Zeile. In i18n 15.1 ergänzt.
4. **Rechtstexte in A1.** Wie in i18n 8.1 und 13 beschrieben: Für jeden Rechtsschlüssel steht der ausgelieferte
   Text in der Antwort, sobald er vom kompilierten Text der Sprache abweicht. Solange fr, it und nl die
   Datenschutz-Hinweise nicht kompiliert haben, enthält A1 für diese Sprachen also immer die beiden englischen
   Texte (`ai.notice.title`, `ai.notice.text`). Das Web muss nichts selbst prüfen.
5. **`i18n:stamp`**: `--key` wählt den Abschnitt des Schlüssels und beschränkt `--confirm` auf ihn; `--yes`
   überspringt die Rückfrage; Exit 2 bei falschen Argumenten, 1 bei `--check` mit Änderungen oder einem Nein auf die
   Rückfrage. Die Schritte sind exportiert (`stampSection`, `planStamps`, `readStampFile`, `serializeStamps`,
   `stampFilePath`, `STAMP_SECTIONS`, `STAMPS_DIR`); `main` läuft nur als Skript. In i18n 4.3 ergänzt.
6. **Abrechnungssprache bis U2.** `BillingProfileDto.effectiveLocale` ist `profile.locale ?? 'de'` und
   `InvoiceDetailDto.locale` ist `invoices.locale ?? 'de'`; `billingLocale()` (Sprache des ältesten Owners,
   i18n 9) baut U2, beide Stellen tragen den Kommentar `// i18n: U2 replaces ...`.
7. **0010_ai.sql**: drizzle-kit setzt den Fremdschlüssel `organizations_ai_opt_out_by_users_id_fk` ans Ende, und
   der O34-Kommentar steht ohne eigenen `--> statement-breakpoint` am letzten Statement (ein Abschnitt, der nur aus
   einem Kommentar besteht, wäre eine leere Anfrage). Inhaltlich wie Plan 3.1.
8. **i18n 10.3** sagte noch "`organizations.ai_enabled` is true for the existing organization"; korrigiert auf
   false (O34). Der Migrationstest prüft false für bestehende und neue Organisationen.

### Was die nächsten Teile wissen müssen

- **Teil 3 (KI-Modul)**: `AppContext` hat noch kein `ai`. In `app.ts` `ai` in das `Omit<AppContext, 'i18nJobs'>`
  aufnehmen, nach dem Literal `ctx.ai = new AiService(ctx)`, nach den Plugins `ctx.ai.attach(app)`, die KI-Routen
  in die Liste; in `index.ts` `AiMaintenance`. Noch offen aus F18: `settings/routes.ts` (`ai:
  await ctx.ai.integrationStatus()`, der Platzhalter steht dort) und die Mailvorlage `ai_budget` mit Builder.
  `deleteDemoOverrides(tx)` ist fertig für die Transaktion von `PUT /admin/ai/key`; danach `ctx.i18n.reload()`.
  `test/claude-mock.ts`, `ai-settings.test.ts`, `ai-structured.test.ts` fehlen noch (F19 zweite Hälfte, F20).
  `I18nService` liest `env.ANTHROPIC_API_KEY` für die Demo-Regel; ein in der Verwaltung gespeicherter Schlüssel
  wirkt über das Löschen der Demo-Zeilen.
- **Teil 4 (Web)**: A1 liefert `{ locale, values }` mit ETag und `Cache-Control: no-cache`, 304 auf
  `If-None-Match` (auch `W/"..."` und Listen). Siehe Punkt 4 zu den Rechtstexten.
- **U1** übernimmt `service.ts`, `entries.ts`, `jobs.ts` (Signaturen aus Plan 2.5 plus `refresh()`), schreibt
  `i18n:report` mit den Exporten von `scripts/i18n-stamp.ts`. Nach jedem Schreibzugriff `ctx.i18n.reload()`.
- Tests bauen kleine Kataloge mit `buildCatalog(sources, {})` und `new I18nService(t.db, env, log, catalog)` oder
  über `createTestApp({ i18nCatalog })`. Ein zweites `createTestApp` setzt die Datenbank zurück; für eine andere
  Umgebung lieber einen zweiten `I18nService` auf derselben Datenbank bauen (so macht es `i18n-service.test.ts`).

### Geprüft (Teil 2)

- `pnpm typecheck` (shared, api, web): sauber.
- Prettier mit den vier CI-Globs: sauber.
- `pnpm test` auf der frischen Datenbank `wl_fpart2_2`: shared 587 bestanden (2 übersprungen), web 165, api 1384
  bestanden (1 übersprungen, der Legal-Schalter); diesmal ohne die bekannten Ausfälle in `monitoring.test.ts`.
- `pnpm --filter @weblion/api build`: erfolgreich; `i18n:stamp --check`: 64 Dateien aktuell.

## Teil 3: KI-Modul der API (F13, F15, KI-Teile von F17 bis F20)

### Gebaut

- **F13** `apps/api/src/lib/redact.ts` mit `SECRET_KEY_PATTERN` (aus `modules/admin/routes.ts` verschoben, dazu
  `credential|cookie|^session`, ohne `g`-Flag); `admin/routes.ts` importiert es. `modules/ai/redact.ts`:
  `initAiSecrets(env)` (in `buildApp` aufgerufen; Werte der Env-Variablen nach `SECRET_KEY_PATTERN` oder mit Endung
  `_KEY`, `_TOKEN`, `_SECRET`, `_PASSWORD`, mindestens 8 Zeichen, bei mehrzeiligen Werten zusätzlich jede Zeile ab
  16 Zeichen), `setAnthropicKeys(keys)`, `redactText`, `redactForAi(value, { personal })`, `toolJson`. Test
  `redact.test.ts` (11 Fälle).
- **F15** `apps/api/src/modules/ai/`:
  - `errors.ts`: alle Helfer aus Plan 2.4, `AI_ERROR_MESSAGES`, `AI_LIMIT_MESSAGES`, `AiCancelled`,
    `classifyAiError` (ai 6.8 mit `err.type`-Zweig), `usageOfError`; zusätzlich `attachUsage(err, usage)` (WeakMap)
    und `retryAfterSeconds(headers)`.
  - `settings.ts`: Plan 3.2 vollständig; zusätzlich `defaultAiSettings(env)`, `AI_SETTING_RANGES`, `AI_KEY_PATTERN`,
    `AI_ADMIN_KEY_PREFIX`, `AI_SETTINGS_KEY`, `AI_KEY_SETTINGS_KEY`. Ein gespeicherter Wert ausserhalb des Bereichs
    fällt beim Lesen auf den Standard zurück.
  - `client.ts`: `createAnthropic`, `baseParams`, `systemBlocks`, `AI_FEATURE_MAX_TOKENS`,
    `AI_FEATURE_EXPECTED_OUTPUT`, `AI_MAX_TOKENS_CEILING`, `REFUSAL_FALLBACK_BETA`.
  - `schema.ts` (`toStrictJsonSchema`) mit `schema.test.ts` (7 Fälle), `prompts.ts` (`BASE_RULES`,
    `FEATURE_RULES`, `FEATURES_WITH_PROMPT`, `SYSTEM_TEXT`, `thirdParty`, `ThirdPartyKind`) mit `prompts.test.ts`.
  - `usage.ts`: `reserve` (sieben Prüfungen in der Reihenfolge von ai 7.1 unter `pg_advisory_xact_lock
    (hashtextextended('ai:reserve', 0))`, eine SQL-Abfrage für alle Zähler, Monat und Tag nach Europe/Zurich aus
    der Datenbankuhr, Grenze für veraltete Zeilen `AI_TURN_TIMEOUT_SECONDS + 60`), `countRate`,
    `refreshReservation`, `addCall`, `finish`, `budgetState`, `budgetExceeded`, `checkBudgetWarning` (leer, U3),
    `approxTokens`, `estimateCallMicros`, `AI_LIMITS`; Hilfen `usageTokens`, `callTotals`, `rowTotals`,
    `budgetMicros`, `staleAfterSeconds`, `AI_RESERVE_LOCK`.
  - `service.ts`: `AiService` nach Plan 2.4 mit `structured()`; `assertOrgData` und `liveReadAllowed` werfen
    "not implemented" (U3). Zusätzlich `attachedApp()` (die mit `attach` gemerkte App für den `ConsoleReader`).
  - `demo.ts`: `demoFetch` (`GET /v1/models/:id`, `POST /v1/messages` gestreamt oder JSON), `emulateMessages`,
    `featureOf`, `DEMO_JSON` (minimale gültige Objekte für die JSON-Funktionen, U3 vervollständigt), Übersetzungen
    als `[FR] <deutscher Text>` (O11), `assistant` mit Markertext ohne Werkzeug.
  - `routes.ts` vollständig nach ai 5.4; Hüllen `org-routes.ts`, `admin-routes.ts`, `feature-routes.ts`,
    `chat-routes.ts`, `sse.ts` (`SseWriter` mit den Mitgliedern von ai 9.3, werfen "not implemented"),
    `maintenance.ts` (`AiMaintenance` leer, `AI_MAINTENANCE_LOCK = 742_005`).
- **F17 (KI-Teil)** `context.ts` mit `ai: AiService`; `app.ts`: `initAiSecrets(env)`, `ctx.ai = new AiService(ctx)`
  direkt nach dem Kontext, `ctx.ai.attach(app)` nach dem Auth-Plugin, `aiRoutes`, `aiOrgRoutes`, `aiAdminRoutes`,
  `aiFeatureRoutes`, `aiChatRoutes` in der `/api/v1`-Liste. `index.ts` startet `AiMaintenance` und stoppt sie in
  `shutdown`.
- **F18 (KI-Teil)** `settings/routes.ts`: `ai: await ctx.ai.integrationStatus()`. `mail/types.ts`: Vorlage
  `ai_budget` nach Plan 2.8; `mail/templates.ts`: Builder im heutigen de/en-Stil mit genau den Texten von Plan 5.3
  (ohne Anrede, damit U2 sie 1:1 auf die Schlüssel umstellt). `test/mail.test.ts` hat ein Beispiel für die Vorlage.
- **F19 (zweite Hälfte)** `test/claude-mock.ts` nach Plan 5.2; zusätzlich `fallbackTo` (siehe Abweichungen),
  `MOCK_API_KEY`, `MOCK_FALLBACK_MODELS`. `test/helpers.ts`: `configureAi(admin, { key?, model?, features?,
  budgetUsd? })` speichert den Schlüssel und schaltet die Plattform mit der Go-live-Checkliste ein.
- **F20 (KI-Teil)** `test/ai-settings.test.ts` (33 Fälle) und `test/ai-structured.test.ts` (32 Fälle, dazu ein Durchlauf der Organisations- und
  Personengrenzen in der Reihenfolge von ai 7.1) mit allen
  Fällen aus Plan F20 und ai 15.2.

### Abweichungen und Entscheide

1. **SDK 1.3.0 schickt den API-Schlüssel als `Authorization: Bearer`**, nicht als `x-api-key`. Der Mock prüft
   beides. Plan F19 und ai 15.1 sind angepasst.
2. **`fallbackTo` im Mock schon in F** (ai 15.1 nannte es als Zusatz von U3), weil `ai-structured.test.ts` die
   Preise der Fallback-Iterationen prüft. `afterFrames` zählt Textstücke zu 40 Zeichen: der abgelehnte Teil steht in
   einem eigenen Textblock, dann der `fallback`-Block, dann der Rest. `setScript` zählt die Anfragen des neuen
   Skripts wieder ab 0. In ai 15.1 ergänzt.
3. **`classifyAiError`**: ein einfacher `AnthropicError` (kein `APIError`; Stream ohne `message_stop` oder
   abgebrochene Verbindung beim Lesen) wird `ai_upstream` `network`. Vorher wäre er als Fehler von uns (500)
   durchgefallen. In ai 6.8 ergänzt. Der Fall "Werkzeugeingabe nicht parsebar" im Chat muss U3 vorher abfangen.
4. **`openTelemetry: false`** im SDK-Client, damit eine OTel-Einrichtung des Hosts nie Prompts oder Antworten
   aufzeichnet. In ai 6.1 ergänzt.
5. **Demo**: Nur der Text des Assistenten streamt in Stücken zu 20 Zeichen alle 30 ms; JSON-Funktionen und
   Übersetzungen antworten sofort (ein Demo-Auftrag von Mass Translate dauerte sonst Minuten). Demo-Anfragen
   reservieren 0; die Budgetprüfung läuft trotzdem, ein Budget von 0 sperrt also auch die Demo. In ai 14 ergänzt.
6. **`AiBudgetDto`**: `percent` ist 100 bei einem Budget von 0; `warned` = `percent >= warnPercent` und
   `exhausted` = `spent >= budget` werden aus den Zahlen berechnet, nicht aus der Zeile `ai_budget_notice` (U1
   braucht `exhausted` für B3). In ai 3.1 ergänzt.
7. **`status().features`** ist leer, solange die KI nicht verfügbar ist (Hauptschalter aus **oder** nicht
   eingerichtet), nicht nur bei ausgeschaltetem Hauptschalter. Plan 2.3 und ai 3.1 angepasst.
8. **Audit `ai.settings_update`**: Funktionen als eigene Felder `features.<feature>: { from, to }`; die Details
   enthalten nur geänderte Felder, beim Einschalten zusätzlich `goLive` mit den vier Haken, bei `noticeChecked:
   true` zusätzlich `noticeChecked: true`. Jeder PUT wird protokolliert, auch ohne Änderung (Details `{}`).
9. **Go-live-Fehler**: 400 `bad_request` mit `details: [{ path: 'goLive', message }]`, wenn die Checkliste fehlt,
   sonst ein Eintrag `goLive.<check>` je fehlendem Haken. Im Demo-Modus ist `goLive` freiwillig; wird es mit allen
   vier Haken geschickt, wird es gespeichert.
10. **`POST /admin/ai/test` ohne jeden Schlüssel** (kein Demo-Anbieter) antwortet `ok: false, reason: 'auth'`.
    Die Anfrage nutzt ein eigenes Zeitlimit von 30 s.
11. **`ai_usage.error_message`** speichert die Meldung aus dem Fehlerkörper (`error.message`), nicht den
    SDK-Text `"402 {...}"`; immer durch `redactText` und auf 1000 Zeichen gekürzt. `request_id` kommt bei
    Fehlern von `err.requestID`. In ai 6.8 ergänzt.
12. `structured()` ruft `checkBudgetWarning` nach Erfolg und nach einem Fehler mit Kosten auf (ai 7.2: "nach jedem
    `finish()`, das Kosten hinzufügte").
13. `usageTokens` (usage.ts) bildet `BetaUsage` des SDK auf `AiUsageTokens` ab, Feld für Feld; so passen auch
    Iterationen ohne Modell (Kompaktierung) in die Preisfunktion von `@weblion/shared`.
14. **`Retry-After`**: der Fehler-Handler in `app.ts` setzt den Header für `ai_limit` und `ai_busy`, wenn
    `details.retryAfterSeconds` eine Zahl ist (ai 4.2: "429 answers also carry Retry-After when the value is
    known"); `app.ts` gehört nur F, deshalb schon hier. U3 prüft ihn in `ai-limits.test.ts` über eine echte Route.

### Was die nächsten Teile wissen müssen

- **Teil 4 (Web)**: `GET /admin/ai/settings` liefert `AiSettingsDto` (Schlüsselstatus ohne Schlüssel,
  `status`, `budget`, `notice.checkedBy` und `goLive.confirmedBy` als `{ id, name }`). `PUT /admin/ai/key` antwortet
  `AiKeyStatusDto & { demoOverridesDeleted }`, Admin-Schlüssel 400 `ai_admin_key`, falsches Format 400
  `bad_request` mit `path: 'key'`. `GET /ai/status` braucht nur eine Anmeldung (auch API-Tokens).
- **U3** übernimmt `modules/ai/**` ausser `routes.ts`: `checkBudgetWarning`, `assertOrgData`, `liveReadAllowed`,
  `SseWriter`, `AiMaintenance`, die Routendateien und `DEMO_JSON` passend zu den eigenen Ausgabeschemas (die
  Demo-Objekte müssen das Schema der Funktion bestehen, `product_texts` ist heute ein Objekt mit allen fünf
  Sprachen als `null`). Records sind in strikten Schemas verboten (`toStrictJsonSchema` wirft): Sprachen als feste,
  nullable Felder modellieren. Der Chat nutzt `reserve`, `refreshReservation`, `addCall`, `finish`,
  `budgetExceeded` direkt; `baseParams` und `systemBlocks` aus `client.ts`.
- **U1**: `structured()` wirft nach der Reservierung immer mit angehängter Nutzung (`usageOfError`), auch
  `AiCancelled`. Im Demo-Modus kostet ein Paket 0 und `meta.demo` ist true. `budgetState().remainingMicros` und
  `.exhausted` für B2/B3; `aiNotConfigured(reason)` aus `errors.ts`; `countRate({ userId })` für B1.
- Tests: `configureAi(admin)` aus `test/helpers.ts` und ein Mock pro Datei (`startClaudeMock`,
  `createTestApp({ env: { ANTHROPIC_BASE_URL: mock.url } })`). Für eine andere Umgebung (ohne Demo-Anbieter, mit
  `ANTHROPIC_API_KEY`) einen zweiten `AiService` mit `{ ...t.ctx, env: { ... } }` bauen; sein Cache gilt 10 s,
  also nach einer Änderung `resetClient()` aufrufen.

### Geprüft (Teil 3)

- `pnpm typecheck` (shared, api, web): sauber.
- Prettier mit den vier CI-Globs: sauber.
- `pnpm test` auf der frischen Datenbank `wl_fpart3_6`: shared 587 bestanden (2 übersprungen), web 165, api 1475
  bestanden (1 übersprungen, der Legal-Schalter); die bekannten Ausfälle in `monitoring.test.ts` traten nicht auf.
- `pnpm build`: erfolgreich.
- Review-Greps aus Plan 8.3 für `apps/api/src/modules/ai`: keine Sampling-Felder, kein `budget_tokens`, kein
  `tool_choice` ausser auto, keine datierten Modell-IDs, kein `fetch(` (nur `demoFetch`), kein `api.anthropic.com`
  in `apps/api/test`, kein scharfes S in `apps/api/src/mail` und `modules/ai`, kein Gedankenstrich in den
  hinzugefügten Zeilen.
