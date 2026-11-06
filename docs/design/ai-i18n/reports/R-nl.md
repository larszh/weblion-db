# R-nl report: review of Dutch (nl-NL)

I merged the three group branches into `ai-i18n/t-nl`, which starts from the foundation commit `f0decba`. The merges are `382219f` (A), `6f8e5ae` (B) and `17c1cfe` (C). There were no conflicts. I then read the whole language against the German as its final editor: all 16 sections and 4,602 keys.

The review changed 64 values in 14 sections. No key is missing, and every section follows the German key order. The changes come in two commits:

- `3d5bada`: one term per German word, formal address, the legal notice, the content rule, and fewer allowlist entries.
- `ec415bd`: two shorter labels.

Both commits rewrote the stamps. Every required check passes, and every commit was saved with `push-unit.sh R-nl` without a CONFLICT.

## What the review changed

Changes per section: core 31, media 6, billing 5, ai 3, hosting 3, uptime 3, admin 2, cloud 2, phone 2, storage 2, websites 2, email 1, mail 1, translations 1.

### 1. Terms the groups had translated differently

I settled each conflict once and applied it everywhere.

- **Zugangsdaten** is now "inloggegevens" in every section. Group A had used "toegangsgegevens" in six places.
  - Example: `perm.webspace:credentials` "Toegangsgegevens tonen en opnieuw instellen (…)" became "Inloggegevens tonen en opnieuw instellen (…)".
  - The same change was made in `perm.platform:provider:write`, `providers.subtitle`, `providers.envManaged`, `providers.joker.passwordHint` and `admin.int.intro`.
- **Auth-Code, Transfersperre, Transfer** now follow group B (hosting, about 25 strings).
  - `perm.domain:authcode` "Autorisatiecode (verhuizing) tonen" became "Authcode (transfer) tonen".
  - `perm.domain:manage` "… verhuisblokkering …" became "Nameservers, transferslot en CDN-instellingen wijzigen". This is also the label quoted in `hosting.cdn.readOnly`.
- **Schutz** (delete, rebuild and CSRF protection) is now "bescherming", so that "beveiliging" stays the word for Sicherheit. Before, "Schutz ein/aus" and the group "Sicherheit" were both "Beveiliging".
  - Example: `settings.protect.delete` "Verwijderbeveiliging" became "Verwijderbescherming".
  - The other keys changed the same way: `server.protected`, `rebuild.protected*`, `delete.protected*`, `settings.protection`, `settings.protect.rebuild`, `perm.server:protection`, `media.seerr.check.csrf` and `media.seerr.problem.csrf`.
  - DDoS-Schutz was already "DDoS-bescherming".
- **Passwort zurücksetzen** is now "opnieuw instellen", as in cloud, instead of "resetten".
  - This applies to `perm.server:password-reset` "Rootwachtwoord opnieuw instellen" and `users.resetPassword`.
  - "2FA resetten" stays: it removes the factor rather than setting a new one.
- **gesperrt (organization)** is "opgeschort" everywhere. `hosting.admin.suspended` "geblokkeerd" became "opgeschort".
- **Zuweisung entfernen / aufheben** is "toewijzing opheffen" everywhere. `inventory.unassign` and `inventory.unassigned` had "verwijderen".
- **ausstellen (invoice)** is now "opmaken", which is idiomatic for invoices.
  - `billing.invoice.meta` "Uitgegeven op {date}" became "Opgemaakt op {date}".
  - The same change was made in `billing.service.cancelText`, `billing.profile.localeHint` and `billing.invoice.localeHint`.
  - Certificates are still "uitgegeven" (issued by the CA) or "aangevraagd" (buttons).
- **Bestand (reseller pool)** is "voorraad" everywhere. `websites.reseller.removeBlocked` had "uw eigen inventaris"; Inventar stays "inventaris".
- **Platzhalter ({name}, command placeholders)** is "plaatshouders" everywhere. `providers.cloudpanel.installCommandHint` had "placeholders". The wildcard `*` in `policies.customPatternHint` stays "jokerteken".
- **Rescale** in parentheses keeps the technical term, like German and the rebuild label next to it. `perm.server:rescale` "Resources wijzigen (herschalen)" became "Resources wijzigen (rescale)".
- **Server-Typ, plural** is "typen", to match "Alle typen" in hosting. This changed `plans.diskTooSmallHint` and `plans.empty` ("servertypen").
- **Weiterleitung for HTTP redirects** is "doorsturing", as the glossary requires and as hosting uses. `uptime.form.urlHint` "Doorverwijzingen" became "Doorsturingen".
- **Sicherung** is "back-up" everywhere. `backups.subtitle` "Volledige kopieën" became "Volledige back-ups van de server.".
- **Anmeldung** is "inloggen" (glossary Anmelden).
  - `console.authFailed` "Authenticatie bij de console mislukt." became "Inloggen bij de console mislukt.".
  - `providers.fire24.help` no longer uses "aanmelding".
  - In Seerr, "Anmeldungen über Jellyfin" (sign-ups of new users) stays "aanmeldingen".
- **Hinweise des Servers** is "meldingen", the same in websites and mail. `mail.admin.warnings` "Mailcow meldt opmerkingen" became "Meldingen van Mailcow".

### 2. Style

- **"u heeft" instead of "u hebt".** Both are correct, but groups B and C use "heeft", so I made it the same everywhere. This changed six values: `tokens.emptyText`, `account.mfa.staffHint`, `error.forbidden`, `error.not_found`, `ai.error.limit.user_daily` and `email.reminder.note`.
- **"bijv." for every "z. B." / "z.B.".** Three core values had "bijvoorbeeld": `projects.new.text`, `iso.hint` and `policies.emptyText`. "bijvoorbeeld" stays for "zum Beispiel".
- **Compound spelling.** `billing.issuer.taxRate` "Standaard btw-tarief (%)" became "Standaard-btw-tarief (%)". `media.allowance.downloadsHint` "Offline kopieën" became "Offlinekopieën".
- **Rule 13 (translate, do not write).** `admin.i18n.check.sharpS` had added "Duitse" ("Bevat een Duitse ringel-s"). It now says "Bevat een ringel-s (eszett). Gebruik ss.".
- **Clearer wording.** `admin.orgs.moveBlockedHint` "Sluit of annuleer de facturen" did not fit invoices (English "settle"). It is now "Rond de facturen af of annuleer ze, …".
- **Shorter labels.**
  - `ai.assistant.ask` "Vraag stellen aan AI-assistent" (30 characters, against 19 in German) became "AI-assistent raadplegen".
  - `phone.rename` and `phone.renameTitle` became "Hernoemen" and "Telefooncentrale hernoemen", as in `perm.server:rename` "Server hernoemen".

### 3. Content rule (rule 13, i18n 12.5 step 6)

A script checked every URL, e-mail address and number in nl against the German and the English. Only "receptie@example.ch" failed: it appears in neither. `hosting.dns.invalid.email` and `hosting.dns.ph.MAILFW` now use "reception@example.ch" from the English reference. The script now finds nothing.

### 4. Legal notice (`ai.notice.title`, `ai.notice.text`)

I checked both sentence by sentence against the German.

- The title "Privacyverklaring over de AI-functies" uses the glossary term.
- The text has the same six paragraphs and 10 `\n`. Every sentence is present, none is shortened and nothing is added.
- I changed one word: "Anthropic ist **dafür** Unterauftragsverarbeiter" is now literally "Anthropic is **daarvoor** subverwerker van weblion.". It was "daarbij" ("in that"), which is weaker.
- The settings path "Instellingen > AI-functies" matches the Dutch labels `nav.settings` and `ai.org.title`.

The rest is unchanged:

| German | Dutch |
|---|---|
| übermitteln | verstrekken (usual in Dutch privacy texts) |
| Protokolleinträge | logvermeldingen |
| mit Sitz in den USA | gevestigd in de VS |
| nach den kommerziellen Bedingungen | volgens de commerciële voorwaarden |
| vorsehen | bepalen |
| erfassen | detecteren |
| senden (in the last paragraph) | sturen |

## Final term decisions not in the glossary (German -> nl)

The glossary terms are used as given. Plurals of glossary terms: webruimtes, mailboxen, doorsturingen, back-ups, quota, creditnota's.

| German | nl |
|---|---|
| Konto, Zugang (Jellyfin) | account (het account); Cloud-Konto: cloudaccount |
| Benutzer / Benutzername / Login-Name / Anzeigename | gebruiker / gebruikersnaam / inlognaam / weergavenaam |
| Berechtigung, Rechte / Berechtigungsgrenze | rechten (recht) / rechtengrens |
| Zugriff / Zugang (access) | toegang |
| Zugangsdaten | inloggegevens |
| Owner / Admin / Member (roles) | Eigenaar / Beheerder / Lid; Administrator: beheerder |
| Eingeschränkt / Nur lesen / Buchhaltung (roles) | Beperkt / Alleen lezen / Boekhouding |
| Admin-Bereich / weblion Admin / Admin > X | beheeromgeving / weblion-beheer / Beheer > X |
| Policy, Richtlinie (Jellyfin, Mailcow) | beleid (uncountable) |
| Erlauben / Verweigern | toestaan / weigeren |
| Mitarbeitende, Staff | medewerkers (Staff-Zugriff: medewerkerstoegang) |
| sperren (organization) / entsperren | opschorten / heractiveren |
| gesperrt (Proxmox, transfer lock) | vergrendeld |
| sperren (streaming account, login, folders, AI requests) | blokkeren, geblokkeerd, blokkering |
| Modul sperren (billing) | module deactiveren |
| freischalten (modules) / freigeben (resources, Node.js) | activeren / vrijgeven |
| Ressource / Bestand / Inventar | resource / voorraad / inventaris |
| Rechnungssteller / Absender | factuurafzender / afzender |
| abrechnen, verrechnen (billing) / verrechnen (credit) | factureren / verrekenen |
| ausstellen (invoice) / abschliessen (invoice) | opmaken / definitief maken |
| stornieren | annuleren (void button: "Factuur annuleren") |
| Entwurf | concept |
| offen / überfällig / fällig (service) | openstaand / achterstallig / te factureren |
| Zahlbar bis, Fällig am / Ablaufdatum | vervaldatum / verloopdatum |
| kündigen / pausieren / fortsetzen | opzeggen / pauzeren / hervatten |
| Guthaben aufladen / buchen | tegoed opwaarderen / boeken |
| Position / Einzelpreis / Menge / Stk. | regel / stukprijs / aantal / st. |
| MWST-Nr., MWST-Satz | btw-nr., btw-tarief |
| QR-Einzahlungsschein | betaalgedeelte met QR-code |
| Nummernkreis / Fusszeile / Zahlungsfrist / Zahlungsart | nummerreeks / voettekst / betalingstermijn / betaalmethode |
| übertragen (Zoho) / Übertragung | overdragen / overdracht |
| Abgleich, Synchronisierung, Synchronisation | synchronisatie |
| Energie (power) | energiebeheer |
| Arbeitsspeicher / Disk, Festplatte / Speicher | werkgeheugen / schijf / opslag |
| Rebuild / Rescale (tabs) | herinstalleren / herschalen |
| Schutz (delete, rebuild, CSRF) / Sicherheit / Kopierschutz | bescherming / beveiliging / kopieerbeveiliging (fixed term) |
| ISO einlegen / auswerfen | koppelen / uitwerpen |
| Messwerte / Einträge (log) / Protokolleinträge | meetwaarden / vermeldingen / logvermeldingen |
| Eintrag (DNS) | record (het record) |
| Vorlage / Template (VM) | sjabloon / template |
| Schlüssel / Schlüsselpaar / Fingerabdruck | sleutel / sleutelpaar / vingerafdruk |
| Platzhalter / Platzhalter * | plaatshouder / jokerteken |
| Anfrage (AI, API, DNS) / Anfragen (Seerr) / Auftrag (AI) / Paket | verzoek / aanvragen / taak / pakket |
| Auftrag (registrar order) | opdracht |
| geprüft / ungeprüft / veraltet | gecontroleerd / niet gecontroleerd / verouderd |
| Rechtstext / Ausgangssprache / Höflichkeitsform | juridische tekst / brontaal / beleefde aanspreekvorm |
| Begriff / Stilhinweise | term / stijlaanwijzingen |
| Hinweis | opmerking (label, glossary note); aanwijzingen (for the AI); meldingen (from a server); aandachtspunten (issues column) |
| Anbieter / Provider / Betreiber | aanbieder / provider / exploitant |
| Unterauftragsverarbeiter / Auftragsverarbeitungsvertrag / AGB | subverwerker / verwerkersovereenkomst / algemene voorwaarden |
| USA | de VS |
| Auth-Code / Transfersperre / Domain-Transfer / übertragen (domain) / umziehen | authcode / transferslot / domeintransfer / overdragen / verhuizen |
| Inhaber (registrant) | houder |
| Tarif (Cloudflare) | abonnement |
| Entwicklungsmodus / Cache leeren / Weiterleitungsschleife | ontwikkelmodus / cache legen / doorstuurlus |
| Gefahrenzone / www-Gegenstück | gevarenzone / bijbehorende www-variant |
| Laufzeit (website) / Laufzeit (renewal) | runtime / looptijd |
| Home- / Web-Verzeichnis | homedirectory / webdirectory |
| übernehmen (adopt) / nicht verwaltet | overnemen / niet-beheerd |
| Instanz / Kontingent-Code | instantie / quotumcode |
| zugeteilt, vergeben (mail, storage) / vergeben (to customers) / belegt / gebucht | toegewezen / toegekend / in gebruik / afgenomen |
| Ringgruppe / Leitung / Anlage / Durchwahlen / Durchsage | belgroep / trunk / centrale / doorkiesnummers / omroep |
| angemeldet (SIP) | geregistreerd |
| Willkommens-E-Mail / Test-Mail / Test-E-Mail | welkomstmail / testmail / test-e-mail |
| Fernseher verbinden / Gerät | tv koppelen / apparaat |
| Bibliothek / Staffeln / Verlauf / Wiedergaben | bibliotheek / seizoenen / geschiedenis / weergaven |
| Dediziert / Gemeinsam | dedicated / gedeeld |
| Antwortzeit / Statusseite / Prüfung / Prüfintervall | reactietijd / statuspagina / controle / controle-interval |
| Erreichbar / Ausgefallen / Ausfall / Wartung | bereikbaar / uitgevallen / storing / onderhoud |
| Keyword / Zeitlimit / Umgekehrter Modus | trefwoord / time-out / omgekeerde modus |
| Zwei-Faktor-Code / Sitzung, Sitzungstoken | verificatiecode / sessie, sessietoken |
| Rechenzentrum / Standort / Traffic, Datenverkehr | datacenter / locatie / dataverkeer |
| Unterstrich / Bindestrich / Steuerzeichen | underscore / koppelteken / stuurtekens |
| umbenennen | hernoemen |
| Passwort zurücksetzen, neu setzen | (nieuw) wachtwoord opnieuw instellen; 2FA zurücksetzen: 2FA resetten |

## Allowlist entries that remain

There are 5 entries, all `glossaryOk`. I removed 7 of the original 12.

| File | Key | Reason |
|---|---|---|
| `allowlists/nl/b.ts` | `websites.creds.text` | "Speichern Sie die Zugangsdaten jetzt" is an instruction, not the Save button. The natural Dutch is "Bewaar de inloggegevens nu" (keep them safe), which matches the checkbox "Ik heb de inloggegevens bewaard". "Sla … op" would not contain "opslaan" either. |
| `allowlists/nl/c.ts` | `billing.summary.openCount`, `billing.admin.count`, `billing.admin.zohoErrors` | German "Rechnung(en)" is singular or plural. The Dutch puts the count after a colon ("Openstaande facturen: {n}"). The plural "facturen" does not contain the singular "factuur". |
| `allowlists/nl/c.ts` | `providers.hetzner.tokenHint` | The value quotes the English menu path of the Hetzner Console ("API tokens > Generate API token"), not the glossary spelling "API-token". |

I removed seven `glossaryOk` entries of group C: `storage.limit.accounts`, `storage.allowance.removeBlocked`, `media.limit.accounts`, `media.allowance.removeBlocked`, `media.seerr.orphans`, `uptime.allowance.full` and `uptime.allowance.removeBlocked`. They had a sentence-initial "Verwijder …", which can never contain the infinitive. Their texts now follow group B (`mail.mailbox.limitReached`) with "U kunt … verwijderen" or "U moet … verwijderen". Example: "Uw quotum is opgebruikt. U kunt een monitor verwijderen of contact opnemen met uw aanbieder.".

## Open questions for the owner

1. **Legal notice: the owner (ideally a lawyer) must still review it before go-live.** Points to look at:
   - "übermittelt" is "verstrekt" (disclosure). Dutch privacy texts also use "doorgeven" or, for transfers to a third country, "doorgifte". The admin checkbox `admin.ai.status.enableCheck.transfer` already uses "doorgifte naar de VS".
   - "kann nicht jeden Fall erfassen" is "kan niet elk geval detecteren".
   - "Unterauftragsverarbeiter" is "subverwerker", the usual term in Dutch processing agreements.
2. **The German source uses "du" in some texts**, which breaks rule 1. The Dutch is formal in all of them.
   - core: `login.hero.text`, `projects.delete.notEmpty`, `members.inviteLinkText`, `invite.invalid.text`
   - admin: `admin.delete.moveHint`, `admin.delete.billingHint`, `admin.orgs.resellerNoModules`, `admin.orgs.moveMissing`

   Fixing the German makes these nl stamps stale. Then run `i18n:stamp --locale nl --confirm --key <key>` (the meaning does not change).
3. **Menu paths of third-party interfaces.**
   - Cloudflare (`providers.cloudflare.help`, `providers.cloudflare.tokenHint`), Mailcow (`providers.mailcow.apiKeyHint`) and Hetzner keep the English labels, on the assumption that these dashboards have no Dutch interface. Nobody has checked this.
   - The Nextcloud, Jellyfin, Seerr and Uptime Kuma labels are written in Dutch from the German path. Examples: "Persoonlijke instellingen > Beveiliging > Apparaten & sessies", "Beheer > Basisinstellingen > E-mailserver". Someone with the Dutch interfaces should compare them.
4. **"Doorsturing" for Mailcow aliases and HTTP redirects** follows the glossary entry for Weiterleitung. Dutch hosting companies more often say "alias" for mail and "doorverwijzing" for web redirects. Changing it means changing the glossary first.
5. **"Webruimte"** follows the glossary. The Dutch market often says "webhostingpakket" or keeps "webspace".
6. **Percent sign:** the German spacing is kept ("25 %", "{percent} %"). Writing it without a space ("25%") is just as common in Dutch. If the owner prefers that, six values need changing.
7. **Role names are translated** (Eigenaar, Beheerder, Lid), while German keeps Owner, Admin and Member. The Jellyfin and 3CX "Administrator" is also "beheerder".
8. **`error.unauthorized` is the short "Log in."** (German "Bitte melden Sie sich an."). This is correct, but a longer form would need a sentence the German does not have.
9. **Example values.**
   - The German "beispiel" and "ziel" became "voorbeeld" and "doel" (`shop.voorbeeld.ch`, `doel.example.ch`).
   - Hosts and e-mail addresses that the content rule checks come from German or English: "reception@example.ch", "https://anfragen.weblion.one", "Anna Muster", "Muster AG", "kunde.ch".
   - `billing.issuer.nameHint` says "Uw Bedrijf B.V." for "Ihre Firma GmbH". The owner may prefer a neutral form for Swiss readers.

## Checks run

| Check | Result |
|---|---|
| `I18N_REQUIRE_COMPLETE=nl pnpm --filter @weblion/shared test` | 589 passed (9 files) |
| `I18N_REQUIRE_LEGAL=nl pnpm --filter @weblion/api exec vitest run test/i18n-stamps.test.ts` | 11 passed. No database needed, so no `wl_rnl_1` was created. |
| `pnpm --filter @weblion/api i18n:stamp --locale nl` (after each commit), then `--check` | 16 files up to date, 0 stale |
| `pnpm typecheck` | passes (shared, api, web) |
| `pnpm exec prettier --check "packages/*/src/**/*.ts"` | all files formatted |
| Key set and order against German (script) | 4,602 keys, 0 missing, 0 unknown, German order in all 16 sections |
| Content rule (URLs, e-mail addresses, numbers only from de or en; script) | 0 findings |
| pdf limited to Windows-1252 | yes |
| Grep: typographic or angle quotes, em dash, sharp s, informal address, "u hebt", wrong articles ("de account", "het factuur", "de domein" …), relative pronoun agreement | none left |
| `push-unit.sh R-nl` after every commit | saved every time, no CONFLICT |

`i18n:report` was not used, because it is a stub at this commit.

## Files

- `/home/user/wt/t-nl/packages/shared/src/i18n/sections/*.nl.ts` (16 sections)
- `/home/user/wt/t-nl/packages/shared/src/i18n/stamps/nl/*.json`
- `/home/user/wt/t-nl/packages/shared/src/i18n/allowlists/nl/{a,b,c}.ts` (only `c.ts` changed)
- `/home/user/wt/t-nl/docs/design/ai-i18n/reports/R-nl.md` (this report)
