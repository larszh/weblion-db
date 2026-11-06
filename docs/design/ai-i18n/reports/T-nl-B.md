# Report T-nl-B: Dutch (nl-NL), section group B

Unit T-nl-B, branch `ai-i18n/t-nl-b`, based on the foundation commit `f0decba`. Translated from the German
source, with the English file used only to check meaning.

## Keys per section

| Section | German keys | nl keys | Missing | Extra | Order |
|---|---|---|---|---|---|
| hosting | 320 | 320 | 0 | 0 | German order |
| cloudflare | 165 | 165 | 0 | 0 | German order |
| websites | 379 | 379 | 0 | 0 | German order |
| mail | 389 | 389 | 0 | 0 | German order |
| **Total** | **1253** | **1253** | **0** | **0** | |

`hosting.dns.ph.other` is an empty string in German and stays empty in Dutch, so the key is present.

Files: `packages/shared/src/i18n/sections/{hosting,cloudflare,websites,mail}.nl.ts`,
`packages/shared/src/i18n/stamps/nl/{hosting,cloudflare,websites,mail}.json`,
`packages/shared/src/i18n/allowlists/nl/b.ts`, this report.

Commits: `087dd99` hosting, `f7016f3` cloudflare, `b1df64c` websites, `2113871` mail, `647e385` review pass
(16 values reworded after a full read), plus the commit of this report. Each one was saved with
`push-unit.sh T-nl-B`, with no conflicts.

## Allowlist entries (`allowlists/nl/b.ts`)

| Check | Key | Reason |
|---|---|---|
| glossaryOk | `websites.creds.text` | "Speichern Sie die Zugangsdaten jetzt" is an imperative inside a sentence, not the Save button. The Dutch "Bewaar de inloggegevens nu" (keep them safe) matches the checkbox "Ik heb de inloggegevens bewaard". The verb "opslaan" is separable ("sla ... op"), so the value can never contain "opslaan" in this sentence form. |

No other check needed an entry.

## Terms chosen that are not in the glossary (de -> nl)

Domains, DNS, registrar

- Anbieter -> aanbieder; Provider -> provider; DNS-Anbieter -> DNS-aanbieder
- Registrar -> registrar; Registry -> registry
- Ablaufdatum -> verloopdatum (kept apart from Fälligkeit -> vervaldatum in billing)
- Auth-Code -> authcode
- Transfersperre -> transferslot; Sperre aktivieren / aufheben -> Slot activeren / Slot opheffen
- Domain-Transfer -> domeintransfer; übertragen (domain) -> overdragen; umziehen, Umzug -> verhuizen,
  verhuizing (DNS-Umzug -> DNS-verhuizing)
- Inhaber (registrant) -> houder; Inhaber-Handle -> houder-handle
- Nameserver -> nameserver, plural nameservers
- Eintrag (DNS) -> record, plural records (follows the glossary entry DNS-Eintrag -> DNS-record)
- Zone -> zone; Zonentyp -> zonetype
- DNS-Verwaltung -> DNS-beheer
- Tarif (Cloudflare plan) -> abonnement
- Proxy -> proxy; "Über Proxy" -> "Via proxy"; "Nur DNS" -> "Alleen DNS"
- Cache leeren -> cache legen; Entwicklungsmodus -> ontwikkelmodus
- Weiterleitungsschleife -> doorstuurlus

Hosting, websites

- Webspaces -> webruimtes (plural of the glossary term webruimte)
- Kontingente -> quota (plural of the glossary term quotum); Website-Kontingent -> websitequotum
- Zugangsdaten -> inloggegevens; Zugang -> toegang; Anmeldelink -> inloglink
- Berechtigung -> recht, plural rechten ("U heeft geen rechten om ...", "het recht "..." nodig")
- freischalten (module) -> activeren; freigeben (Node.js) -> vrijgeven; einschalten / ausschalten ->
  inschakelen / uitschakelen
- anlegen, erstellen -> aanmaken; einrichten -> inrichten
- Synchronisation, Synchronisierung, Abgleich -> synchronisatie; abgleichen -> synchroniseren
- zuweisen, Zuweisung -> toewijzen, toewijzing; Zuweisung aufheben -> toewijzing opheffen
- vergeben (website allowance) -> toegekend; vergeben (mail storage) -> toegewezen; belegt -> in gebruik
- Art (website or alias type) -> soort
- Anwendung -> applicatie; Vorlage -> sjabloon
- www-Gegenstück -> de bijbehorende www-variant
- Sicherung -> back-up (follows the glossary entry Backup)
- Home-Verzeichnis / Web-Verzeichnis -> homedirectory / webdirectory
- Laufzeit (website runtime) -> runtime; Laufzeit (renewal term) -> looptijd
- übernehmen (adopt an unmanaged site) -> overnemen; geschützt -> beschermd
- Gefahrenzone -> gevarenzone
- Speicher -> opslag; PHP-Speicherlimit -> PHP-geheugenlimiet; Traffic -> dataverkeer
- Schlüssel -> sleutel; privater / öffentlicher Schlüssel -> privésleutel / publieke sleutel;
  Schlüsselpaar -> sleutelpaar; Fingerabdruck -> vingerafdruk
- Zertifikat ausstellen -> certificaat aanvragen (buttons, from the user's side) and uitgeven (where the
  CA issues it: "kan worden uitgegeven", "Certificaat ... uitgegeven")
- Bestand, Inventar -> inventaris
- Betreiber -> exploitant
- Platzhalter -> placeholders
- Tab -> tabblad
- Bereich (of a page or module) -> onderdeel; "Bereiche der Domain" -> "Onderdelen van het domein"
- gesperrt (organization suspended) -> geblokkeerd

Mail

- Postfächer -> mailboxen (plural of the glossary term mailbox)
- Weiterleitungen (Mailcow aliases) -> doorsturingen (plural of the glossary term doorsturing)
- E-Mail-Domain -> e-maildomein; Mail-Domain -> maildomein (the German uses both, so the Dutch does too)
- Instanz -> instantie
- Limits -> limieten; Versandlimit -> verzendlimiet
- Ziele (alias targets) -> bestemmingen
- Anmeldung (mailbox login) -> inloggen ("Inloggen blokkeren", "Inloggen geblokkeerd", "Laatst ingelogd")
- Papierkorb -> prullenbak
- Selektor -> selector; Schlüssellänge -> sleutellengte

People and roles

- Owner (organization role) -> eigenaar
- Support -> de support
- weblion-Mitarbeiter -> weblion-medewerker; Plattform-Mitarbeitende -> platformmedewerkers
- Console, Konsole -> console

Style decisions

- Formal address: "u" and "uw" throughout, with "u heeft", "u kunt" and "u wilt" (not "u hebt", "u kan",
  "u wil"). No "je", "jij" or "jouw".
- "z. B." -> "bijv."; buttons are infinitives at the end ("Record toevoegen", "Nu verlengen").
- Confirm titles keep their question mark; search fields keep the ellipsis.

## Doubts and open questions for the owner (and R-nl)

1. **Owner role.** I used "eigenaar" in `hosting.notFound.text`, `hosting.dnsZone.otherOrg` (section
   cloudflare) and `mail.dns.noPermission`. If T-nl-A keeps `role.owner` as "Owner", R-nl should change these
   three values to match.
2. **Labels from group A cited in quotes.** These values quote labels that T-nl-A translates, and they must
   match: "Domeinen & DNS" (`module.dns.label`, in `hosting.admin.assignTextDomain`), "Webhosting"
   (`hosting.admin.assignTextWebspace`, `websites.allowance.enableModuleHint`,
   `websites.reseller.enablesModule`), "E-mail" (`mail.admin.assignText`, `mail.admin.deleteNotEmptyHint`,
   `websites.mail.text`), "Providers" (admin page, in `hosting.dnsMove.noTargets` and `mail.admin.tabHint`),
   and the permission labels "DNS-records bewerken" (`hosting.dns.noPermission`) and "Nameservers,
   transferslot en CDN-instellingen wijzigen" (`hosting.cdn.readOnly`).
3. **Third-party UI paths.** The Cloudflare and Mailcow menu paths ("My Profile > API Tokens", "Create Token
   > Custom token", "All zones from an account", "System > Configuration > Access > API", "Skip IP check
   for API") are in English, as in the English file, because I assume Dutch users run these dashboards in
   English. The commit message of `f7016f3` says Cloudflare has no Dutch dashboard. I did not check that, so
   it is an assumption, not a fact. If the dashboards are used in Dutch, these values need the Dutch labels.
4. **Example values.** Like the English file, I translated some examples: "doel.example.ch",
   "receptie@example.ch", "shop.voorbeeld.ch" and "voornaam.achternaam". Like the English file, I kept
   "Anna Muster", "Muster AG" and "kunde.ch". The Mass Translate content rule (12.5 step 6) would flag
   translated addresses as new content. The repository checks do not run that rule, so they pass.
5. **"Doorsturingen" for Mailcow aliases** follows the glossary (Weiterleitung -> doorsturing). Dutch admins
   also say "aliassen" or "doorstuuradressen". If the owner prefers one of those, change the glossary first.
6. **Webruimte** (glossary) reads well, but Dutch hosting companies often say "webhostingpakket" or keep
   "webspace". I followed the glossary.

## Checks run

| Check | Result |
|---|---|
| `pnpm --filter @weblion/shared test` (after each section and at the end) | 587 passed, 2 skipped; checks 1 to 8 and 11 green for nl in hosting, cloudflare, websites and mail |
| `pnpm --filter @weblion/api i18n:stamp --locale nl --section <s>` (after each section and after the review pass) | all written; final `i18n:stamp --locale nl --check`: 16 files up to date, 0 stale |
| `pnpm exec prettier --write` on each section file, then `pnpm exec prettier --check "packages/*/src/**/*.ts"` | all files formatted |
| `pnpm --filter @weblion/api exec vitest run test/i18n-stamps.test.ts` (no database needed) | 10 passed, 1 skipped |
| same with `I18N_REQUIRE_LEGAL=nl` | fails only on `ai.notice.*` (section ai, group A, not this unit) |
| `pnpm typecheck` | clean (shared, api, web) |
| Completeness, `I18N_REQUIRE_COMPLETE=nl pnpm --filter @weblion/shared test` | fails first on section core (group A, still empty at this commit), so it cannot confirm group B; a key comparison script outside the repository confirms 0 missing, 0 extra and German key order for all four sections of group B |
| `pnpm --filter @weblion/api i18n:report` | not used (a stub at this commit) |
| Grep for gender and address mistakes ("de domein", "het webruimte", "u hebt", "je", ...) | none found |
