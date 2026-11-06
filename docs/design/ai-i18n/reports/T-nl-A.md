# T-nl-A report: Dutch (nl-NL), group A

Unit T-nl-A, branch `ai-i18n/t-nl-a`, based on the foundation commit `f0decba`. All six sections of group A are
translated from German into standard Dutch with the formal address ("u", "uw") everywhere. Every value went
through the checks of `checks.ts` (tests green), was stamped, and was re-read once more in an editorial pass.

## Keys per section

| Section | Keys (de = nl) | Missing | Commit |
|---|---|---|---|
| core | 857 | 0 | `e492087` (edited in the review, `3460471`) |
| email | 54 | 0 | `6dd609a` |
| pdf | 44 | 0 | `998fbec` |
| ai | 307 | 0 | `7fde981` (edited in the review, `3460471`) |
| translations | 191 | 0 | `4985b32` |
| admin | 231 | 0 | `731e82e` (edited in the review, `3460471`) |
| **Total** | **1,684** | **0** | |

Keys are in German order, single quotes (prettier switches to double quotes only where a value has an apostrophe,
for example `programma's`, `tv's`, `API's`, `ID's`), no comments, every `{placeholder}` and `\n` as in German.

## Files touched

- `packages/shared/src/i18n/sections/{core,email,pdf,ai,translations,admin}.nl.ts`
- `packages/shared/src/i18n/stamps/nl/{core,email,pdf,ai,translations,admin}.json`
- `docs/design/ai-i18n/reports/T-nl-A.md` (this file)

`packages/shared/src/i18n/allowlists/nl/a.ts` is unchanged.

## Allowlist entries

None. No heuristic check (3 to 6) gave a false positive, so `allowlists/nl/a.ts` stays empty. Two texts were
written so that they pass the checks without an allowlist entry:

- `admin.i18n.check.formality`: the text says "Klinkt informeel" rather than "je-vorm", because the word "je"
  would trip check 4.
- `ai.error.adminKey`: says "... API-sleutel ... opslaan", because the German has the glossary term "Speichern".

## Special care

- **LEGAL_KEYS** (`ai.notice.title`, `ai.notice.text`): translated in full and literally, sentence by sentence, with
  the same six paragraphs (10 `\n`), nothing shortened and nothing added. Choices the owner should know about:
  "mit Sitz in den USA" is "gevestigd in de VS". "Unterauftragsverarbeiter" is "subverwerker".
  "übermittelt ... an Anthropic" is "verstrekt ... aan Anthropic" ("verstrekking" is the Dutch GDPR term).
  "Protokolleinträge" is "logvermeldingen". "weder Fragen noch Antworten" is "noch vragen noch antwoorden".
  "Einstellungen > KI-Funktionen" is "Instellingen > AI-functies", matching the Dutch labels `nav.settings` and
  `ai.org.title`.
- **email**: formal letter style, "Goedendag" / "Met vriendelijke groet", "Wij verzoeken u ...", "Hartelijk dank
  voor uw betaling".
- **pdf**: every character is in Windows-1252 (checked by script; the only non-ASCII characters are `·` and Dutch
  letters such as `é`). `pdf.invoice.draftMark` is `CONCEPT`, in capitals. `pdf.invoice.qr.due` keeps the two spaces
  around `·`.
- **perm.\* / module.\***: short noun phrases or infinitives ("Back-ups bekijken", "Servers bij providers
  aanmaken").
- **Buttons**: infinitives in sentence case, no period ("Opslaan", "Annuleren", "Verwijderen", "Toestaan",
  "Weigeren", "Opschorten", "Heractiveren").

## Terms chosen that are not in the glossary (de -> nl)

Glossary terms (DEFAULT_GLOSSARY) are used as given everywhere. Plural forms I used for glossary terms:
Webspaces = webruimtes, Weiterleitungen = doorsturingen, Postfächer = mailboxen, Backups = back-ups,
Kontingente = quota.

| German | Dutch | Note |
|---|---|---|
| Konto | account (het account) | "Ander account", "een apart account" |
| Benutzer | gebruiker | |
| Berechtigung / Rechte, Zugriffsrechte | rechten, toegangsrechten | "Keine Berechtigung" = "Geen rechten" |
| Berechtigungsgrenze | rechtengrens | |
| Zugriff / Zugang | toegang | |
| Zugangsdaten | toegangsgegevens | |
| Owner (role) | Eigenaar / eigenaar | German keeps the English role names; Dutch translates them |
| Admin (role) | Beheerder | |
| Member (role) | Lid | |
| Eingeschränkt / Nur lesen / Buchhaltung (roles) | Beperkt / Alleen lezen / Boekhouding | |
| Admin-Bereich | beheeromgeving | "Verwaltung" stays "beheer" (glossary) |
| weblion Admin (nav section) | weblion-beheer | |
| Policy, Policies | beleid (uncountable: "een beleid", "Nieuw beleid", "Nog geen beleid") | |
| Access Policies (plural) | toegangsbeleid | singular is the glossary term |
| Erlauben / Verweigern (policy effect) | Toestaan / Weigeren | |
| Mitarbeitende, Staff | medewerkers; weblion-medewerkers | Staff-Zugriff = Medewerkerstoegang |
| sperren / entsperren (organization) | opschorten / heractiveren | Sperre = opschorting; Gesperrt (org) = Opgeschort |
| gesperrt (Proxmox lock, status.locked) | vergrendeld | |
| sperren / entsperren (streaming account) | blokkeren / deblokkeren | |
| gesperrt (AI requests, explorer calls) | geblokkeerd | |
| freischalten (modules) | activeren | |
| freigeben (resources) | vrijgeven | Produktfreigabe = productvrijgave |
| Ressourcen | resources | |
| Bestand (reseller stock) | voorraad | |
| Rechnungssteller | factuurafzender | |
| verrechnen | factureren | |
| Guthabenbuchung | tegoedboeking | |
| kündigen (service) | opzeggen | |
| stornieren / storniert | annuleren / geannuleerd | |
| Entwurf (invoice), ENTWURF | concept, CONCEPT | |
| Zahlbar bis / Fällig am (labels) | Vervaldatum | in sentences: "Te betalen uiterlijk op {date}." |
| Fällig seit | Vervallen sinds | |
| MWST-Nr. | btw-nr. | |
| Energie (server power) | energiebeheer | tab, title, perm |
| Arbeitsspeicher / Disk, Festplatte / Speicher | werkgeheugen / schijf / opslag | |
| Rebuild, Neuinstallation | herinstallatie, opnieuw installeren | tab "Herinstalleren" |
| Rescale | herschalen | |
| Schutz (delete/rebuild protection) | beveiliging | verwijderbeveiliging, herinstallatiebeveiliging |
| ISO einlegen / auswerfen | koppelen / uitwerpen | |
| Messwerte, Metriken | meetwaarden | |
| Einträge (audit, log) / Protokolleinträge | vermeldingen / logvermeldingen | |
| DNS-Einträge | DNS-records | the singular is the glossary term "DNS-record" |
| Vorlage | sjabloon | VM "Template" stays "template" |
| Schlüssel, Key, API-Key | sleutel, API-sleutel | also DKIM-sleutels, SSH-sleutels |
| Anfrage (AI) | verzoek | Anfragelimit = verzoeklimiet |
| Auftrag (AI job) | taak | KI-Aufträge = AI-taken |
| Paket (batch) | pakket | |
| geprüft / ungeprüft | gecontroleerd / niet gecontroleerd | |
| veraltet | verouderd | |
| Rechtstext | juridische tekst | |
| Platzhalter | plaatshouder | |
| Begriff (glossary) | term | |
| Stilhinweise / Hinweis (label) | stijlaanwijzingen / opmerking | |
| Ausgangssprache | brontaal | |
| Höflichkeitsform | beleefde aanspreekvorm | |
| Anbieter (a customer's reseller) | aanbieder | |
| Unterauftragsverarbeiter / Auftragsverarbeitungsvertrag / AGB | subverwerker / verwerkersovereenkomst / algemene voorwaarden | |
| USA | de VS | |
| Transfer (domain) / Auth-Code / Transfersperre | verhuizing / autorisatiecode / verhuisblokkering | perm labels in core |
| Ringgruppen / Leitungen (3CX) | belgroepen / trunks | perm and module labels in core |
| Sitzung | sessie | |
| Zwei-Faktor-Code | verificatiecode | the glossary term "Zwei-Faktor-Authentifizierung" stays "tweestapsverificatie" |
| Rechenzentrum / Standort | datacenter / locatie | |
| Traffic, Datenverkehr | dataverkeer | |
| Rohdaten | ruwe gegevens | |

## Doubts and open questions for the owner and R-nl

1. **German source in the du form.** These German texts use "du" imperatives, which breaks rule 1 (Sie). I
   translated them with the formal address, but the German should be fixed (not my files):
   core `login.hero.text` ("Verwalte"), `projects.delete.notEmpty` ("Verschiebe sie"),
   `members.inviteLinkText` ("Schicke"), `invite.invalid.text` ("Bitte um"); admin `admin.delete.moveHint`
   ("Verschiebe oder entferne"), `admin.delete.billingHint` ("Sperre die Organisation"),
   `admin.orgs.resellerNoModules` and `admin.orgs.moveMissing` ("Schalte sie ... frei", "deaktiviere").
   A fix makes the nl stamps stale, so the nl texts then need `i18n:stamp --confirm`, or a re-translation where
   the German meaning changed.
2. **Role names.** German keeps "Owner", "Admin" and "Member". In Dutch I translated them (Eigenaar, Beheerder,
   Lid), because Dutch business users expect Dutch role names. Groups B and C have "Owner" in hosting, mail, uptime,
   cloudflare and billing (`billing.profile.localeOwner`). R-nl should make sure those say "eigenaar".
3. **"Policy" as "beleid".** It works for every current string. A future count string ("{n} policies") would need
   a countable form such as "beleidsregels". `perm.platform:media:write` also translates the Jellyfin "Richtlinien"
   as "beleid". Group C (media) should match.
4. **Cross-group terms set in core perm/module labels.** Domain transfer: "verhuizing", "verhuisblokkering",
   "autorisatiecode". 3CX: "belgroepen", "trunks", "toestellen". Streaming quota: "streamingquota". Groups B
   (hosting) and C (phone, media) should use the same words; R-nl to align.
5. **`error.unauthorized`.** "Bitte melden Sie sich an." became the short "Log in." The alternative is
   "Meld u aan.", which is formal but avoids the glossary verb "inloggen".
6. **Percent sign.** I kept the German space ("{percent} %", "25 %"). Dutch usage more often writes "25%". Both
   are acceptable; the owner can decide.
7. **Legal notice.** Like every locale, the Dutch `ai.notice.text` needs the owner's (and ideally a lawyer's) review
   before go-live. It uses the Dutch GDPR (AVG) terms "subverwerker" and "verwerkersovereenkomst".

## Checks run

| Check | Result |
|---|---|
| `pnpm --filter @weblion/shared test` (after every section and after the review) | 587 passed, 2 skipped |
| `pnpm --filter @weblion/api i18n:stamp --locale nl --section <s>` (each section, again after the review) | all new or updated, 0 stale; final `--check`: 16 files up to date, 0 stale |
| `pnpm --filter @weblion/api exec vitest run test/i18n-stamps.test.ts` | 10 passed, 1 skipped (no database needed) |
| same with `I18N_REQUIRE_LEGAL=nl` | 11 passed |
| `I18N_REQUIRE_COMPLETE=nl pnpm --filter @weblion/shared test` | fails only at `hosting` (group B, out of scope). The six group A sections come before it in SECTIONS order and pass. |
| Completeness by script (key set and order against German) | all six sections: 0 missing, 0 unknown, order equals German |
| `pnpm typecheck` | done (shared, api, web) |
| `pnpm exec prettier --check "packages/*/src/**/*.ts"` | all files formatted |
| pdf: Windows-1252 only | yes (script check) |
| `/home/user/bin/push-unit.sh T-nl-A` after every commit | saved every time, no CONFLICT |

`pnpm --filter @weblion/api i18n:report` is only a stub at this commit ("not implemented"), so I did not run it.
