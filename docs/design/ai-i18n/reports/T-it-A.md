# T-it-A report: Italian (it-CH), section group A

Unit T-it-A, branch `ai-i18n/t-it-a`, based on the foundation commit f0decba. Sections in the order of plan 7.4:
`core`, `email`, `pdf`, `ai`, `translations`, `admin`. Every section is translated from the German source
(formal address "Lei", Swiss Italian conventions of i18n 19.2), stamped with `i18n:stamp --locale it`, formatted
with prettier and committed on its own; every commit was saved with `push-unit.sh T-it-A` (no conflicts).

## Keys per section

| Section | German keys | Italian keys | Missing | Order as German |
|---|---|---|---|---|
| core | 857 | 857 | 0 | yes |
| email | 54 | 54 | 0 | yes |
| pdf | 44 | 44 | 0 | yes |
| ai | 307 | 307 | 0 | yes |
| translations | 191 | 191 | 0 | yes |
| admin | 231 | 231 | 0 | yes |
| **total** | **1,684** | **1,684** | **0** | |

Files: `packages/shared/src/i18n/sections/{core,email,pdf,ai,translations,admin}.it.ts`,
`packages/shared/src/i18n/stamps/it/{core,email,pdf,ai,translations,admin}.json`,
`packages/shared/src/i18n/allowlists/it/a.ts`, this report.

## Allowlist entries (`allowlists/it/a.ts`, all `glossaryOk`)

| Key | Reason |
|---|---|
| `admin.stat.orgsSub` | "Reseller" is plural ("{resellers} Reseller"); the Italian plural "rivenditori" does not contain the singular "rivenditore" that check 6 looks for. |
| `admin.orgs.subtitle` | Same plural case ("Kunden, Reseller und interne Organisationen" -> "Clienti, rivenditori e ..."). |
| `pdf.invoice.draftFilename` | A file name: "Bozza-fattura-{id}.pdf" joins the words with hyphens, as the German joins "Rechnungsentwurf" to the id, so the spaced term "bozza di fattura" cannot appear. |
| `ai.assistant.sessionHint` | "beim Abmelden" is the noun "on signing out", rendered with the verb ("quando esce dall'account"); "esci" is the label of the sign-out button and does not fit the sentence. |
| `ai.org.declineConfirm.action` | A button ("Ablehnen"): Italian buttons use the short imperative "Rifiuta" (rule 3, like "Salva", "Annulla"); the glossary infinitive "rifiutare" is used in the running texts of the feature. |

No entries for checks 3, 4, 5 or 11. Two near misses were fixed in the text instead: `network.ddosNone` ("impostazioni"
in the plural, glossary "Einstellungen") and `ai.error.adminKey` ("occorre salvare", glossary "Speichern");
`perm.server:protection` was shortened to stay within the length limit.

## Terms chosen that are not in the glossary (German -> it)

Used the same way in all six sections; the review unit R-it may want to align groups B and C with them.

| German | Italian | Note |
|---|---|---|
| Owner (role) | Proprietario | role names are translated: Admin stays "Admin", Member "Membro" (glossary Mitglied) |
| Eingeschränkt / Nur lesen / Buchhaltung (roles) | Limitato / Sola lettura / Contabilità | |
| Benutzer | utente | |
| Konto | account | |
| Mitarbeitende (weblion staff) | collaboratori | |
| Anbieter (a reseller as seen by its customer) | fornitore | `ai.org.*` only |
| Standort | ubicazione | data centre location of a server or provider |
| Arbeitsspeicher | memoria RAM | |
| Disk / Festplatte | disco | |
| Labels (server labels) | etichette | |
| Access Policies (plural) | policy di accesso | glossary has the singular |
| Richtlinie (Jellyfin, DMARC) | criteri (Jellyfin) / Policy (DMARC) | |
| Ringgruppe (3CX) | gruppo di squillo | only in `perm.phone:*` and `module.phone.description`; group C translates the phone section |
| Monitoring | monitoraggio | "Monitor" (one check) stays "monitor" per glossary |
| Sperren / Entsperren (customer, organization) | sospendere / riattivare; status "Sospeso" | for streaming accounts and server lock: bloccare / sbloccare, "Bloccato" |
| Freischalten (modules) | attivare | |
| Freigeben (resources back to the pool) | rilasciare | |
| Bestand (reseller pool) | dotazione | |
| Rechnungssteller | emittente delle fatture | |
| Unterauftragsverarbeiter | sub-responsabile del trattamento | legal notice and KI page |
| Auftragsverarbeitungsvertrag | contratto per il trattamento dei dati | |
| AGB | CG | |
| Zugangsdaten | credenziali di accesso | |
| Veraltet (translation state) | obsoleto | |
| Ungeprüft / Geprüft | non verificato / verificato | |
| Platzhalter | segnaposto | |
| KI-Auftrag (Mass Translate job) | incarico IA | |
| Paket (batch) | pacchetto | |
| Rechtstext | testo legale | |
| Stilhinweise | note di stile | |
| Aufräumen | pulizia (title) / Ripulisci (button) | |
| Offener Betrag | importo dovuto | e-mail and PDF |
| Storniert | stornata | invoice status |
| Vermerk (bank transfer) | causale | PDF |
| Gutschrift oder Korrektur | nota di credito o rettifica | e-mail |
| Guthabenbuchung | registrazione di credito | |
| Schalter (on/off switch) | interruttore | |

Buttons use the usual Italian short form ("Salva", "Crea", "Aggiungi", "Rifiuta"); `perm.*` labels are infinitives
("Visualizzare ...", "Gestire ..."), `module.*` labels are noun phrases; running text addresses the reader with
"Lei" (capitalized when it stands alone, clitics and possessives lowercase).

## Doubts and open questions for the owner

1. **Legal notice** (`ai.notice.title`, `ai.notice.text`): translated completely, sentence by sentence. Terms:
   "sub-responsabile del trattamento" for Unterauftragsverarbeiter, "trattati" for verarbeitet. The German sentence
   "entfernt ... Geheimnisse wie Passwörter, API-Schlüssel und Tokens sowie IP- und E-Mail-Adressen aus
   Protokolleinträgen" is ambiguous (does "aus Protokolleinträgen" apply to all items or only to the addresses?);
   the Italian keeps the same structure and therefore the same ambiguity. Please review before go-live (plan 7.2).
2. **Percent sign**: the German "{percent} %" and "100 %" keep the space in Italian (as in the source and in SI
   style); many Italian texts write "100%" without a space. Easy to change in one place if the owner prefers.
3. **Gender of company names**: "weblion.one" is treated as masculine ("weblion.one stesso"), Anthropic as a company
   in the feminine ("Anthropic è indicata"). Both are usual in Italian; R-it may unify them.
4. **"Esci" for ending another session** (`account.sessions.revoke`): kept the glossary term "Esci" (as Google's
   Italian device list does), although "Disconnetti" would also be natural there.
5. **"Bentornato"** (`login.subtitle`) uses the generic masculine, as most Italian login pages do.
6. **Reseller as "rivenditore"**: the glossary makes "Reseller" Italian everywhere, including the nav section and
   the org kind; in plural contexts check 6 needs the two allowlist entries above.

No changes are needed in files owned by others. No keys were added, renamed or deleted.

## Checks run

| Check | Result |
|---|---|
| `pnpm --filter @weblion/shared test` after every section and at the end | 587 passed, 2 skipped, 0 failed |
| `I18N_REQUIRE_COMPLETE=it pnpm --filter @weblion/shared test` | only failure: `hosting` (group B, not this unit); script check: 0 missing in all six group A sections |
| `pnpm --filter @weblion/api exec vitest run test/i18n-stamps.test.ts` | 10 passed, 1 skipped (no database needed) |
| `I18N_REQUIRE_LEGAL=it pnpm --filter @weblion/api exec vitest run test/i18n-stamps.test.ts` | 11 passed |
| `pnpm --filter @weblion/api i18n:stamp --locale it` (final) | 0 stale |
| `pnpm typecheck` | clean (shared, api, web) |
| `pnpm exec prettier --check "packages/*/src/**/*.ts"` | all files formatted |
| `pdf.*` values encodable in Windows-1252 (script) | 0 characters outside Windows-1252 |
| Key set and order per section against German (script) | equal for all six sections |
| `pnpm --filter @weblion/api i18n:report` | not used: a stub at this commit (prints "not implemented") |
