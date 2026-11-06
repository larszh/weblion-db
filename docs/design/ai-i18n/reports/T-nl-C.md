# Report T-nl-C: Dutch (nl-NL), section group C

Unit T-nl-C, branch `ai-i18n/t-nl-c`, based on the foundation commit `f0decba`. Translated from the German
source. I used the English file only to check meaning. Formal address ("u", "uw") throughout.

## Keys per section

| Section | German keys | nl keys | Missing | Extra | Order |
|---|---|---|---|---|---|
| billing | 456 | 456 | 0 | 0 | German order |
| cloud | 45 | 45 | 0 | 0 | German order |
| storage | 189 | 189 | 0 | 0 | German order |
| phone | 238 | 238 | 0 | 0 | German order |
| media | 429 | 429 | 0 | 0 | German order |
| uptime | 308 | 308 | 0 | 0 | German order |
| **Total** | **1665** | **1665** | **0** | **0** | |

Files: `packages/shared/src/i18n/sections/{billing,cloud,storage,phone,media,uptime}.nl.ts`,
`packages/shared/src/i18n/stamps/nl/{billing,cloud,storage,phone,media,uptime}.json`,
`packages/shared/src/i18n/allowlists/nl/c.ts`, this report.

Commits: `4e038ae` billing, `05cee64` cloud, `ad85c25` storage, `ada6c36` phone, `3e52bc7` media, `8f281e2`
uptime, `f221e2d` review pass (7 values reworded after a full read), plus the commit of this report. Each
commit was saved with `push-unit.sh T-nl-C`. No conflicts.

## Allowlist entries (`allowlists/nl/c.ts`)

All 11 entries are `glossaryOk`. No other check needed an entry.

| Key | Reason |
|---|---|
| `billing.summary.openCount`, `billing.admin.count`, `billing.admin.zohoErrors` | German "Rechnung(en)" can be singular or plural. The Dutch puts the count after a colon ("Openstaande facturen: {n}") and uses the plural "facturen". That is the glossary term in the plural, but the string does not contain the singular "factuur". |
| `providers.hetzner.tokenHint` | The value quotes the Hetzner Console menu path. The console has no Dutch interface, so the value keeps the English labels "API tokens > Generate API token", not the glossary spelling "API-token". |
| `storage.limit.accounts`, `storage.allowance.removeBlocked`, `media.limit.accounts`, `media.allowance.removeBlocked`, `media.seerr.orphans`, `uptime.allowance.full`, `uptime.allowance.removeBlocked` | "Löschen Sie ..." is an imperative at the start of a sentence, not the Delete button. The Dutch imperative of "verwijderen" is "Verwijder", so the value cannot contain the infinitive. |

## Terms chosen that are not in the glossary (de -> nl)

Billing

- Rechnungssteller -> factuurafzender (as T-nl-A in `admin`); Absender -> afzender
- Entwurf -> concept; Entwürfe -> concepten (Rechnungsentwurf -> conceptfactuur from the glossary)
- abschliessen (invoice) -> definitief maken; abgeschlossen -> definitief gemaakt
- stornieren / storniert -> annuleren / geannuleerd (as T-nl-A in `pdf`). The void button is "Factuur annuleren",
  because a bare "Annuleren" would clash with the Cancel button in the same dialog.
- überfällig -> achterstallig; offen (invoice) -> openstaand; Offener Betrag -> openstaand bedrag
- fällig (service to be billed) -> te factureren; "Fällige Dienste abrechnen" -> "Openstaande diensten factureren"
- abrechnen -> factureren; abgerechnet -> gefactureerd; verrechnen (credit) -> verrekenen
- ausstellen (invoice) -> uitgeven
- Guthaben aufladen -> tegoed opwaarderen; Guthaben buchen -> tegoed boeken (as T-nl-A in `core`)
- Zahlung erfassen -> betaling registreren; Teilzahlung -> deelbetaling
- kündigen / gekündigt -> opzeggen / opgezegd; pausieren -> pauzeren; fortsetzen -> hervatten
- Position (invoice line) -> regel; Einzelpreis -> stukprijs; Stk. -> st.; Menge -> aantal
- Beschreibung -> omschrijving (as T-nl-A in `pdf`); Bemerkungen -> opmerkingen
- Zahlungsfrist -> betalingstermijn; Zahlungsart -> betaalmethode; Zahlungsanbieter -> betaalprovider
- MWST-Satz -> btw-tarief; MWST-Nummer -> btw-nummer; Nummernkreis -> nummerreeks; Fusszeile -> voettekst
- QR-Einzahlungsschein -> betaalgedeelte met QR-code (as T-nl-A in `pdf.invoice.terms.qrHint`)
- übertragen (to Zoho) -> overdragen; Übertragung -> overdracht; Abgleich -> synchronisatie
- Ressource -> resource; Interne Notiz -> interne notitie; Ablauf (settings group) -> werkwijze
- Owner -> eigenaar (as T-nl-A `role.owner`)
- Kunde gesperrt (suspended) -> opgeschort (as T-nl-A in `admin`)

Servers (cloud)

- Server-Typ -> servertype; Disk -> schijf; Arbeitsspeicher -> werkgeheugen; Standort -> locatie; Image -> image;
  Inventar -> inventaris; Energie (tab) -> Energiebeheer (the label of T-nl-A `power.title`)
- Root-Passwort -> rootwachtwoord; zurücksetzen (password) -> opnieuw instellen
- Auslaufend -> wordt uitgefaseerd; Dediziert -> Dedicated (also for Jellyfin instances)

Storage, streaming, monitoring (shared)

- Kontingent -> quotum, plural quota (glossary); Speicherkontingent -> opslagquotum; Streaming-Kontingent ->
  streamingquotum; Monitoring-Kontingent -> monitoringquotum; Kontingent-Code -> quotumcode
- Konto (Nextcloud) and Zugang (Jellyfin) -> account (het account); Cloud-Konto -> cloudaccount (as T-nl-A
  `perm.cloud:*`); Streaming-Zugang -> streamingaccount (glossary)
- Login-Name -> inlognaam; Benutzername -> gebruikersnaam; Anzeigename -> weergavenaam
- anmelden / abmelden (sessions, devices) -> inloggen / uitloggen (glossary direction); Letzte Anmeldung -> laatst
  ingelogd
- Instanz -> instantie; Benutzer -> gebruiker; nicht verwaltet -> niet-beheerd; übernehmen -> overnemen
- zugeteilt -> toegewezen; vergeben (to customers) -> toegekend; vergeben (in use) / belegt -> in gebruik;
  gebucht -> afgenomen; buchen -> afnemen
- abgleichen / abgeglichen -> synchroniseren / gesynchroniseerd; Synchronisierung -> synchronisatie
- Admin > X (nav path) -> Beheer > X; Admin-Bereich -> beheeromgeving (as T-nl-A `perm.platform:access`)
- Provider (nav label) -> Providers (as T-nl-A `nav.admin.providers`)
- API-Schlüssel -> API-sleutel; App-Passwort -> app-wachtwoord; Unterstrich -> underscore (as T-nl-B); Bindestrich
  -> koppelteken; Steuerzeichen -> stuurtekens
- Zuweisung entfernen -> toewijzing opheffen (as T-nl-B for "aufheben")
- Hinweise (issues column) -> aandachtspunten

Phone

- Ringgruppe -> belgroep; Leitung -> trunk; Benutzer -> gebruiker (as T-nl-A `perm.phone:*`)
- Anlage (short for Telefonanlage) -> centrale
- angemeldet (SIP extension) -> geregistreerd; Durchwahlen -> doorkiesnummers; Durchsage (paging) -> omroep
- Klingeldauer -> beltijd; Gespräche -> gesprekken; Ausgehende Rufnummer -> uitgaand nummer
- Lizenz -> licentie; Edition -> editie; Willkommens-E-Mail -> welkomstmail (as T-nl-A); Zugangsdaten ->
  inloggegevens (as T-nl-B); Telefonanbieter -> telefonieaanbieder; PINs -> pincodes

Media

- Anfragen (Seerr requests) -> aanvragen; anfragen -> aanvragen; Richtlinie -> beleid (as T-nl-A
  `perm.platform:media:write`)
- Fernseher -> tv; Fernseher verbinden -> tv koppelen (as T-nl-A `perm.media:password`); Gerät -> apparaat
- Bibliothek -> bibliotheek; Staffeln -> seizoenen; Verlauf -> geschiedenis; Wiedergaben -> weergaven
- gesperrt / Sperre (account lock, blocked folders) -> geblokkeerd / blokkering
- Qualität unterwegs -> kwaliteit onderweg; Gemeinsam (shared instance) -> gedeeld

Monitoring

- Antwortzeit -> reactietijd (as T-nl-A `module.monitoring.description`); Ablauf der Zertifikate -> verloop van de
  certificaten
- Statusseite -> statuspagina; Prüfung -> controle; Prüfintervall -> controle-interval
- Erreichbar / Ausgefallen / Ausfall -> bereikbaar / uitgevallen / storing; Wartung -> onderhoud
- Keyword -> trefwoord; Umgekehrter Modus -> omgekeerde modus; Zeitlimit -> time-out
- Verwaltung (Uptime Kuma management sign-in) -> beheer (glossary); "für die Verwaltung angemeldet" -> "ingelogd voor
  beheer"; Sitzungstoken -> sessietoken; Zwei-Faktor-Code -> verificatiecode (as T-nl-A `login.mfa.title`)
- verknüpfen / Verknüpfung lösen -> koppelen / koppeling verbreken; Herkunft -> herkomst
- 24 h -> 24 uur; Ablaufdatum (API key) -> verloopdatum (as T-nl-B)

Style decisions

- "u heeft", "u kunt", "u wilt" (as T-nl-B). T-nl-A has "U hebt" once (`account.mfa.staffHint`); R-nl may want to
  align it.
- "z. B." -> "bijv."; buttons are infinitives at the end ("Dienst toevoegen", "Tegoed opwaarderen").
- German « » quotes became straight double quotes (rule 6). Apostrophe plurals ("creditnota's", "statuspagina's")
  use the straight apostrophe, so Prettier writes those strings in double quotes.
- Counts that would need a singular-or-plural form ("Rechnung(en)") are written as "Label: {n}". Where the German
  is invariant ("{n} Benutzer"), the Dutch uses the plural like the English ("{n} gebruikers").

## Doubts and open questions for the owner (and R-nl)

1. **Third-party menu paths.** I kept the Hetzner Console path in English ("Project > Security > API tokens >
   Generate API token", "Read & Write"). I believe the Hetzner Console has only English and German, but I did not
   check. For Nextcloud, Jellyfin, Seerr and Uptime Kuma I wrote Dutch labels ("Persoonlijke instellingen >
   Beveiliging > Apparaten & sessies > Nieuw app-wachtwoord aanmaken", "Beheer > Basisinstellingen > E-mailserver",
   "Dashboard > API-sleutels > Toevoegen", "Instellingen > Algemeen > API-sleutel", "Instellingen > API-sleutels").
   These apps have Dutch interfaces, but my labels follow the German path and may not match their Dutch wording
   exactly. For 3CX, "Integraties > API" is translated and the checkbox "XAPI Access Enabled" and the role "System
   Admin" stay in English, as in German. Someone with access to these UIs in Dutch should check the labels.
2. **"Quick Connect"** stays as the Jellyfin feature name, as in German. If the Dutch Jellyfin apps show another
   label, the four media texts that name it should follow.
3. **Void = "annuleren".** This follows T-nl-A (`pdf.invoice.status.void` "Geannuleerd"). Dutch bookkeeping tools
   also say "crediteren" for an invoice voided with a credit note. Since a void here keeps the number and creates
   no credit note, "annuleren" fits, but the owner may prefer another word.
4. **"fällig" for services** is "te factureren", and the button "Fällige Dienste abrechnen" is "Openstaande
   diensten factureren". `billing.service.startsAtHint` ("Die erste Rechnung ist an diesem Tag fällig") became "Op
   deze dag wordt de eerste factuur opgemaakt", which is the behaviour, so a reader does not take the start date
   for the payment due date.
5. **Example values** stay as in German: "anna", "Anna Muster", "muster-ag", "https://muster.3cx.ch",
   "https://anfragen.weblion.one" (English uses "requests.weblion.one"; I kept the German host, because the Mass
   Translate content rule would flag a changed URL). The room example "wohnzimmer" became "woonkamer" because it
   is a word, not a host. `billing.issuer.nameHint` "Ihre Firma GmbH" became "Uw Bedrijf B.V." (English: "Your
   Company Ltd").
6. **"Dedicated"** is kept in English for dedicated server types and Jellyfin instances, as Dutch hosting
   companies usually do. "Toegewijd" would be the literal word.
7. **Group A labels quoted in group C.** These values quote or reuse labels of T-nl-A and must match after the
   merge: "Energiebeheer" (`power.title`, in `plans.hetznerOff`), "Telefonie" (`module.phone.label`, in
   `phone.admin.assignText`), "Cloudopslag" and "Streaming" (`module.*.label`, in `storage.reseller.enablesModule`
   and `media.reseller.enablesModule`), "Monitoring" (`module.monitoring.label`, in `uptime.admin.assignText` and
   `uptime.reseller.enablesModule`), "Providers" (`nav.admin.providers`, in `phone.admin.emptyText`,
   `media.admin.noInstancesText`, `uptime.admin.noInstancesText`), "Beheer > ..." for the admin section
   (`nav.section.admin` is "weblion-beheer" in group A), and "eigenaar" (`role.owner` "Eigenaar").

## Checks run

| Check | Result |
|---|---|
| `pnpm --filter @weblion/shared test` (after each section and at the end) | 587 passed, 2 skipped; checks 1 to 8 green for nl in all six sections of group C |
| `pnpm --filter @weblion/api i18n:stamp --locale nl --section <s>` (after each section and after the review pass) | all written; final `i18n:stamp --locale nl --check`: 16 files up to date, 0 stale |
| `pnpm exec prettier --write` on each section file, then `pnpm exec prettier --check "packages/*/src/**/*.ts"` | all files use Prettier code style |
| `pnpm --filter @weblion/api exec vitest run test/i18n-stamps.test.ts` (no database needed) | 10 passed, 1 skipped |
| `pnpm typecheck` | clean (shared, api, web) |
| Completeness, `I18N_REQUIRE_COMPLETE=nl pnpm --filter @weblion/shared test` | fails only on section core (group A, empty in this worktree), so it cannot confirm group C on its own. A key comparison script outside the repository confirms 0 missing, 0 extra and German key order for all six sections of group C. |
| `pnpm --filter @weblion/api i18n:report` | not used (a stub at this commit) |
| Grep for article and address mistakes ("de account", "de quotum", "het server", "het factuur", "je", "jij", "u hebt", em dash, sharp s, typographic quotes) | none found |
