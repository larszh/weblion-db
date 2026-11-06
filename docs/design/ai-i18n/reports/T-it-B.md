# T-it-B report: Italian (it-CH), group B

Unit T-it-B translated section group B (hosting, cloudflare, websites, mail) from German into Italian for
Switzerland, formal address (Lei), on branch `ai-i18n/t-it-b` from the foundation commit f0decba.

## Files touched

- `packages/shared/src/i18n/sections/hosting.it.ts`
- `packages/shared/src/i18n/sections/cloudflare.it.ts`
- `packages/shared/src/i18n/sections/websites.it.ts`
- `packages/shared/src/i18n/sections/mail.it.ts`
- `packages/shared/src/i18n/stamps/it/{hosting,cloudflare,websites,mail}.json`
- `packages/shared/src/i18n/allowlists/it/b.ts`
- `docs/design/ai-i18n/reports/T-it-B.md` (this file)

No other file was changed. No late i18n keys were added, no change in a file of another unit is required.

## Keys per section

| Section | German keys | Italian keys | Missing |
|---|---|---|---|
| hosting | 320 | 320 | 0 |
| cloudflare | 165 | 165 | 0 |
| websites | 379 | 379 | 0 |
| mail | 389 | 389 | 0 |
| **Total** | **1,253** | **1,253** | **0** |

Keys are in German order (checked by script), single quotes where Prettier keeps them (Prettier switches a value
with an apostrophe to double quotes, as in `glossary.ts`), no comments, every placeholder kept. The four sections
contain no `\n`. All stamps are current (`i18n:stamp --check`: 0 stale).

## Allowlist entries (`allowlists/it/b.ts`)

All entries are `glossaryOk` (check 6). Nothing needed `germanOk`, `informalOk`, `lengthOk` or `typographyOk`.

| Keys | Reason |
|---|---|
| `hosting.dns.typeLabel.HTTP_REDIRECT`, `hosting.dns.typeLabel.HTTP_FRAME` | "Weiterleitung" of a web address is an HTTP redirect, "reindirizzamento" in Italian. The glossary's "inoltro" is the e-mail forwarding term and would be wrong for a URL redirect. |
| `hosting.admin.groupDirect` | German "Reseller" is plural here ("Direkte Kunden und Reseller"). The Italian plural "rivenditori" does not contain the singular form "rivenditore". |
| `websites.list.noAllowance`, `websites.list.noAllowanceText`, `websites.list.noAllowanceReseller`, `websites.allowance.title`, `websites.allowance.setUpTitle`, `websites.allowance.editTitle`, `websites.allowance.instanceLocked`, `websites.allowance.resellerNone`, `websites.allowance.saved`, `websites.allowance.removeTitle`, `websites.allowance.removeBlockedCustomers`, `websites.allowance.removed`, `websites.allowance.none`, `websites.reseller.none`, `websites.reseller.noPool`, `websites.errors.no_allowance` (16) | "Website-Kontingent" is an allowance of websites (plural). Italian says "contingente di siti web"; the plural "siti web" does not contain the singular glossary form "sito web". |
| `mail.dns.toZone`, `mail.dns.explain.conflicts` | "DNS-Verwaltung" is the DNS management page of a domain, "gestione DNS". The glossary's "amministrazione" is reserved for the weblion admin area. |

## Terms chosen that are not in the glossary (de -> it)

Used the same way in all four sections.

| de | it |
|---|---|
| Anbieter | fornitore (DNS-Anbieter: fornitore DNS) |
| Provider | provider |
| Registrar / Registry | registrar / registro |
| Transfersperre | blocco del trasferimento |
| Auth-Code | codice Auth |
| Nameserver | nameserver |
| Inhaber (Registrant) | titolare |
| Verlängerung, automatisch verlängern | rinnovo, rinnovo automatico |
| Ablaufdatum, läuft ab | data di scadenza, scade (column: Scadenza) |
| gekündigt | disdetto |
| Zugangsdaten | dati di accesso |
| Abruf (of a secret) | consultazione |
| Synchronisation, Synchronisierung, Abgleich | sincronizzazione |
| zuweisen, Zuweisung | assegnare, assegnazione |
| freischalten (module) | attivare; freigeben (Node.js): abilitare |
| weblion-Mitarbeiter, Plattform-Mitarbeitende | personale di weblion, personale della piattaforma |
| Owner (role) | Owner |
| Zone, DNS-Zone | zona, zona DNS |
| Eintrag (short for DNS record) | record |
| Weiterleitung (HTTP) | reindirizzamento (e-mail alias: inoltro, glossary) |
| Ziel (alias target) | destinazione |
| Tarif (Cloudflare plan) | piano |
| Entwicklungsmodus | modalità sviluppo |
| Cache leeren | svuotare la cache |
| DNS-Umzug, DNS umziehen | migrazione del DNS, migrare il DNS su Cloudflare |
| Einträge übernehmen (DNS import) | importare i record |
| Site übernehmen (CloudPanel adopt) | prendere in carico, presa in carico |
| Site (CloudPanel) / Website | sito / sito web |
| Website-Kontingent | contingente di siti web |
| anlegen | creare |
| Vorlage (vhost) | modello |
| Anwendung | applicazione |
| Art (of website or alias) | tipo |
| Laufzeit | Runtime |
| Home-Verzeichnis, Web-Verzeichnis | directory home, directory web |
| Fingerabdruck des Host-Schlüssels | impronta della chiave host |
| Schlüsselpaar | coppia di chiavi |
| Sicherung | backup |
| Speicher (webspace, website) / Speicher (mail quota) | spazio disco / spazio |
| Gefahrenzone | zona di pericolo |
| Console (product), Konsole | console |
| Instanz | istanza |
| E-Mail-Domain, Mail-Domain | dominio e-mail |
| Mailserver, Mailprogramm | server di posta, programma e-mail |
| Versandlimit | limite di invio |
| Papierkorb | cestino |
| Spamfilter | filtro antispam |
| Verwerfen, Als Spam/Ham lernen | Scarta, Apprendi come spam/ham |
| Selektor (DKIM) | selettore |
| DNS-Verwaltung | gestione DNS |
| Pflicht, Empfohlen | Obbligatorio, Consigliato |
| Control Panel | pannello di controllo |
| Whois-Datenschutz | protezione privacy Whois |
| Auftrag, Auftragsnummer | ordine, numero d'ordine |
| Links "Zu ...", "Zur ...", "Zum ..." | "Vai a ...", "Vai al ...", "Vai alla ..." |
| "Bitte ... eingeben" | "Inserisca ..." |
| z. B. | ad es. |

Style: formal Lei form in full sentences ("Si rivolga", "Verifichi", "Inserisca"); "Lei" capitalized when it stands
alone, "suo/sua" lowercase. Where the possessor is not the reader (a registrar, a zone, a mailbox), "relativo" or
"proprio" is used instead of "suo" to avoid ambiguity. Buttons in the usual short Italian form ("Salva", "Elimina",
"Attiva", "Crea casella e-mail"); confirm titles as infinitive questions ("Eliminare il record DNS?").

## Doubts and open questions for the owner and R-it

1. **Labels of other groups quoted in my texts.** These must match what T-it-A chooses in `core`; R-it should align
   them after the merge:
   - "Domini e DNS" (`nav.domains`, `module.dns.label`) in `hosting.admin.assignTextDomain`.
   - "Web hosting" (`nav.webhosting`, `module.webhosting.label`) in `hosting.admin.assignTextWebspace`,
     `websites.allowance.enableModuleHint`, `websites.reseller.enablesModule`.
   - "E-mail" (`module.mail.label`) in `websites.mail.text`, `websites.mail.link`, `mail.admin.assignText`,
     `mail.admin.deleteNotEmptyHint`.
   - Permission names: "Modificare i record DNS" (`perm.domain:dns:write`) in `hosting.dns.noPermission`;
     "Modificare nameserver, blocco del trasferimento e impostazioni CDN" (`perm.domain:manage`) in
     `hosting.cdn.readOnly`.
   - "Owner" kept as the role name (assumes `role.owner` stays "Owner").
2. **Menu paths of third-party tools** were translated to what I believe the Italian UIs show, not verified against
   the live dashboards: Cloudflare "Il mio profilo > Token API", "Crea token > Token personalizzato", "Tutte le zone
   di un account" (`providers.cloudflare.help`, `providers.cloudflare.tokenHint`); Mailcow "Sistema >
   Configurazione > Accesso > API", "Salta il controllo IP" (`providers.mailcow.apiKeyHint`). If staff use these
   tools in English or German, the original labels may be the better choice.
3. **Example values** were localized where they are German words, as the English file does for some of them:
   `ziel.example.ch` -> `destinazione.example.ch`, `empfang@example.ch` -> `ricezione@example.ch` (the Swiss Italian
   word for a front desk), `shop.beispiel.ch` -> `shop.esempio.ch`, `kunde.ch` -> `cliente.ch`, `Muster AG` ->
   `Esempio SA`, `vorname.nachname` -> `nome.cognome`. "Anna Muster" was kept (English keeps it too). The owner may
   prefer to keep all examples unchanged.
4. **"Auth-Code" -> "codice Auth".** Alternatives are "codice AuthInfo" or "codice EPP"; the short form stays close
   to the German and to Swiss practice.
5. **"Registry" -> "registro"** (usual in the Italian domain business) sits next to "registro di audit" (glossary);
   the contexts never meet in one text.
6. **`websites.runtime.title`**: "Laufzeit" is "Runtime"; "Ambiente di esecuzione" was too long for the length
   check (22 > 20 characters) and the section title is short.
7. **`mail.units.invalid`** keeps "2.5 GB" with a decimal point, as the German, because it describes the input
   format of the size field.
8. **Glossary suggestion (not my file):** the glossary entry "Weiterleitung" could carry a note "e-mail forwarding",
   so that Mass Translate does not force "inoltro" on HTTP redirects. Check 6 cannot see German compounds and
   plurals ("Website-Kontingent", "Reseller" as plural), which is why most allowlist entries above exist.

## Checks run

| Check | Result |
|---|---|
| `pnpm --filter @weblion/shared test` (after each section and at the end) | 587 passed, 2 skipped |
| `pnpm --filter @weblion/api i18n:stamp --locale it --section <s>` for the four sections | written; `--check`: up to date, 0 stale |
| `pnpm exec prettier --write packages/shared/src/i18n/sections/<s>.it.ts` | done for each section |
| `pnpm --filter @weblion/api exec vitest run test/i18n-stamps.test.ts` | 10 passed, 1 skipped (no database needed) |
| `pnpm typecheck` | clean (shared, api, web) |
| `pnpm exec prettier --check "packages/*/src/**/*.ts"` | all files use Prettier code style |
| `I18N_REQUIRE_COMPLETE=it pnpm --filter @weblion/shared test` | fails only outside group B: check 9 stops at `core` (group A, not merged here) and check 10 names `ai.notice.*` (group A) |
| Completeness script over `SECTION_SOURCES` (outside the repository) | hosting, cloudflare, websites, mail: 0 missing, 0 unknown, German key order |
| `pnpm --filter @weblion/api i18n:report` | not used: the stub is not implemented at this commit |

Every commit was saved with `/home/user/bin/push-unit.sh T-it-B`; no CONFLICT was reported.
