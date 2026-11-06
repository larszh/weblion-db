# T-fr-B report: French (fr-CH), group B

Unit T-fr-B translated section group B (hosting, cloudflare, websites, mail) from German into French for Switzerland,
on branch `ai-i18n/t-fr-b` from the foundation commit f0decba. Formal address ("vous") throughout, Swiss French
typography (no-break space before ":" and "%", no space before "?", "!" and ";"), straight quotes and apostrophes,
no em dash, keys in German order, no comments in the section files.

## Keys per section

| Section | German keys | French keys | Missing | Unknown | German order |
|---|---|---|---|---|---|
| hosting | 320 | 320 | 0 | 0 | yes |
| cloudflare | 165 | 165 | 0 | 0 | yes |
| websites | 379 | 379 | 0 | 0 | yes |
| mail | 389 | 389 | 0 | 0 | yes |
| **Total** | **1253** | **1253** | **0** | **0** | |

Stamp files `stamps/fr/{hosting,cloudflare,websites,mail}.json` are written and current (`i18n:stamp --check` exits 0
for all four).

Commits: e73adcf (hosting), 05d2326 (cloudflare), 6326016 (websites), f79598f (mail), ee29ba4 (editorial pass),
plus the commit of this report. Each one was saved with `push-unit.sh T-fr-B`, with no conflict.

Files touched (only owned files):

- `packages/shared/src/i18n/sections/{hosting,cloudflare,websites,mail}.fr.ts`
- `packages/shared/src/i18n/stamps/fr/{hosting,cloudflare,websites,mail}.json`
- `packages/shared/src/i18n/allowlists/fr/b.ts`
- `docs/design/ai-i18n/reports/T-fr-B.md`

## Allowlist entries (`allowlists/fr/b.ts`)

`glossaryOk` (21 entries):

- `providers.cloudflare.help`, `providers.cloudflare.tokenHint`, `explorer.cloudflarePath`: "API-Tokens" here are
  Cloudflare API tokens ("jetons API"). The check reads "Tokens" after the hyphen as the glossary term for AI usage
  tokens and expects "tokens".
- `websites.list.noAllowance`, `websites.list.noAllowanceText`, `websites.list.noAllowanceReseller`,
  `websites.allowance.title`, `websites.allowance.setUpTitle`, `websites.allowance.editTitle`,
  `websites.allowance.instanceLocked`, `websites.allowance.resellerNone`, `websites.allowance.saved`,
  `websites.allowance.removeTitle`, `websites.allowance.removeBlockedCustomers`, `websites.allowance.removed`,
  `websites.allowance.none`, `websites.reseller.none`, `websites.reseller.noPool`, `websites.errors.no_allowance`:
  "Website-Kontingent" is an allowance covering several websites, so French uses the plural "contingent de sites
  web". The check looks for the substring "site web", and "sites web" does not contain it.
- `mail.dns.toZone`, `mail.dns.explain.conflicts`: "DNS-Verwaltung" means DNS management, not the staff
  administration area the glossary entry "Verwaltung -> administration" is for. French says "gestion DNS".

`typographyOk` (1 entry):

- `websites.password.rule.characters`: this is a list of allowed password characters. The spaces before "!" and
  ":" separate literal characters and are not punctuation spacing. Without this entry, the automatic fix would turn
  "et !#%..." into "et!#%...".

`germanOk`, `informalOk` and `lengthOk` are empty.

## Terms I chose that are not in the glossary (German -> fr)

| German | French |
|---|---|
| Nameserver | serveur de noms |
| (DNS-)Eintrag | enregistrement (DNS); "A-Eintrag" -> "enregistrement A" |
| DNS-Zone / Zone | zone DNS / zone |
| Auth-Code | code d'autorisation |
| Transfersperre; Sperre aktivieren / aufheben | verrou de transfert; activer / lever le verrou |
| Registrar / Registry | registraire / registre |
| Provider, Anbieter | fournisseur (nav label "Provider" -> "Fournisseurs") |
| Inhaber (domain) | titulaire |
| Ablaufdatum; läuft ab | date d'expiration; expire / Expiration |
| verlängern; (automatische) Verlängerung | renouveler; renouvellement (automatique) |
| gekündigt | résilié |
| Auftrag (job at the provider) | demande |
| synchronisieren, abgleichen; Synchronisation, Abgleich | synchroniser; synchronisation |
| zuweisen; Zuweisung | attribuer; attribution |
| freischalten (module) / freigeben (Node.js) | activer / autoriser |
| Bereich (area of the console) | section |
| weblion-Mitarbeiter, Plattform-Mitarbeitende | personnel weblion, personnel de la plateforme |
| Owner (role) | propriétaire |
| Berechtigung | autorisation ("droit" where "code d'autorisation" is in the same sentence, and for "Sie dürfen nicht") |
| Zugangsdaten | identifiants |
| Abruf (of a secret); im Audit-Log festgehalten | consultation; consigné dans le journal d'audit |
| Control Panel; 24fire-Panel | panneau de contrôle; panneau 24fire |
| Paket (web space) / Tarif (Cloudflare plan) | forfait / formule |
| Speicher | stockage |
| Traffic | trafic |
| Website-Kontingent | contingent de sites web |
| anlegen / einrichten | créer / configurer |
| E-Mail-Domain, Mail-Domain | domaine de messagerie |
| Ziel (alias target) | destination |
| Mailserver / E-Mail-Programm, Mailprogramm | serveur de messagerie / client de messagerie |
| Verbrauch | consommation |
| DNS-Umzug; umziehen (DNS); Nameserver umstellen | migration du DNS; migrer; basculer les serveurs de noms |
| Einträge übernehmen; nicht verwaltete Site übernehmen | reprendre les enregistrements; reprendre le site |
| Über Proxy / Nur DNS | Via le proxy / DNS uniquement |
| Dashboard (Cloudflare) | tableau de bord |
| www-Gegenstück | pendant www |
| Fingerabdruck; Host-Schlüssel | empreinte; clé d'hôte |
| Vorlage | modèle |
| Betreiber | exploitant |
| Sicherung | sauvegarde (same as the glossary term Backup) |
| Papierkorb | corbeille |
| Live-Daten | données en direct |
| DNS-Verwaltung | gestion DNS |
| Laufzeit (section title) | Environnement |
| Gefahrenzone | Zone de danger |
| Bestand (reseller's pool) | parc |
| Instanz | instance |
| Relay(-Domain) | (domaine) relais |
| In Ordnung (DNS status) | En ordre (the usual Swiss French phrase) |
| API-Key (Mailcow) / API-Token (Cloudflare) | clé API / jeton API |
| Netfilter-Whitelist | liste blanche Netfilter |
| z. B. | p. ex. |

## Doubts and open questions for the owner and R-fr

1. **Labels from group A that I quote.** These texts repeat module and permission labels that group A translates,
   and R-fr must check that both match:
   - Module labels: "Domaines & DNS" (`hosting.admin.assignTextDomain`), "Hébergement web"
     (`hosting.admin.assignTextWebspace`, `websites.allowance.enableModuleHint`, `websites.reseller.enablesModule`)
     and "E-mail" (`mail.admin.assignText`, `mail.admin.deleteNotEmptyHint`, `websites.mail.*`).
   - Permission labels: "Modifier les enregistrements DNS" (`hosting.dns.noPermission`) and "Modifier les
     serveurs de noms, le verrou de transfert et les paramètres CDN" (`hosting.cdn.readOnly`).
   - The nav label "Fournisseurs" for "Provider" (`hosting.dnsMove.noTargets`, `mail.admin.tabHint`).
2. **Labels of third-party tools.** I wrote these as I believe the French interfaces of those tools show them, and
   I could not check them: Cloudflare ("Mon profil > Jetons API > Créer un jeton > Jeton personnalisé", "Toutes les
   zones d'un compte", "clé API globale"), Mailcow ("Système > Configuration > Accès > API", "Ignorer la
   vérification IP") and the Plesk menu "Messagerie" (the German text says "E-Mail"). If staff run these tools in
   English or German, the original labels may be better.
3. **Size units.** `mail.units.invalid` keeps "MB", "GB" and "2.5". French would write Mo/Go and 2,5, but the
   field probably accepts only these exact units and the decimal point. Please confirm how the input is parsed.
4. **Example values made French.** `ziel.example.ch` -> `cible.example.ch`, `empfang@example.ch` ->
   `reception@example.ch` (the address the English text uses), `shop.beispiel.ch` -> `shop.exemple.ch`,
   `kunde.ch` -> `client.ch`, `Muster AG` -> `Exemple SA`, `vorname.nachname` -> `prenom.nom`. "Anna Muster" stays.
   None of these adds a URL, an e-mail address or a number that is missing from both German and English.
5. **"Umlaute".** `mail.password.rule.characters` says "sans caractères accentués" and `mail.admin.domainHint` says
   "domaines avec des caractères accentués". For French readers, accented letters are the case that matters.
6. **Wording forced by placeholders.** `hosting.dnsMove.noOrg` ("aucune organisation") goes into "le domaine à
   {domainOrg}", which gives the slightly awkward "le domaine à aucune organisation". Only a code change can fix
   it (`apps/web/src/pages/hosting/dns-move.tsx`, line 190).
7. **Small additions for grammar.** `hosting.moduleOff.title` reads "Le module {module} n'est pas activé", so the
   sentence works whatever the gender of the module name.
8. **Code labels.** In `explorer.mailcowBodyHint`, "add:", "edit:" and "delete:" have no space before the colon,
   because they are API method names, not French prose.

## Checks run

| Check | Result |
|---|---|
| `pnpm --filter @weblion/shared test` (after each section and at the end) | 587 passed, 2 skipped |
| `pnpm --filter @weblion/api i18n:stamp --locale fr --section <s>` (each section, again after the editorial pass) | written; `--check` exits 0 for all four |
| `pnpm --filter @weblion/api exec vitest run test/i18n-stamps.test.ts` | 10 passed, 1 skipped (no database needed) |
| `pnpm typecheck` | shared, api and web all pass |
| `pnpm exec prettier --check "packages/*/src/**/*.ts"` | all files pass |
| Group B completeness (script using `missingKeys` / `unknownKeys`) | 0 missing, 0 unknown, German key order in all four sections |
| `I18N_REQUIRE_COMPLETE=fr pnpm --filter @weblion/shared test` | fails only for sections outside group B (the first is `core` of group A, 857 keys missing); no group B section is listed |
| Editorial re-read of all 1253 values | done: terms consistent across the four sections, formal address everywhere, no German left over, no em dash, buttons within check 5 |
