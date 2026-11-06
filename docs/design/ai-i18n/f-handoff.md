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
