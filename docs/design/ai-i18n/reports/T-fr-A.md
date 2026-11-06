# Report T-fr-A: French (fr-CH), group A

Unit T-fr-A translated section group A (`core`, `email`, `pdf`, `ai`, `translations`, `admin`) from German into
French for Switzerland. Branch `ai-i18n/t-fr-a` from F commit `f0decba`. One commit per section, then one review
commit. Every commit was saved with `push-unit.sh T-fr-A` and none reported CONFLICT.

## Keys per section

| Section | Keys translated | Missing |
|---|---|---|
| core | 857 / 857 | 0 |
| email | 54 / 54 | 0 |
| pdf | 44 / 44 | 0 |
| ai | 307 / 307 | 0 |
| translations | 191 / 191 | 0 |
| admin | 231 / 231 | 0 |
| **total** | **1,684** | **0** |

Files touched (all owned by this unit, plan 7.1):

- `packages/shared/src/i18n/sections/{core,email,pdf,ai,translations,admin}.fr.ts`
- `packages/shared/src/i18n/stamps/fr/{core,email,pdf,ai,translations,admin}.json`
- `packages/shared/src/i18n/allowlists/fr/a.ts`
- `docs/design/ai-i18n/reports/T-fr-A.md` (this report)

How the files are written: keys in German order, no comments. Prettier picks the quote style, so values that
contain an apostrophe are in double quotes. Placeholders and `\n` are as in German. Swiss French spacing is used:
a literal U+00A0 before ":" and "%", no space before "?", "!" and ";". `pdf.fr.ts` uses only Windows-1252
characters (checked by script; "°", "·", accented letters and U+00A0 only). E-mails use "Bonjour" and "Meilleures
salutations". `pdf.invoice.draftMark` is "PROJET".

## Allowlist entries (`allowlists/fr/a.ts`)

| Check | Key | Reason |
|---|---|---|
| glossaryOk | `nav.tokens`, `perm.apitoken:read`, `perm.apitoken:write`, `tokens.subtitle`, `tokens.empty`, `tokens.emptyText` | "Tokens" in these German texts means API tokens, which are "jetons API" in French. The glossary term "Tokens" (fr "tokens") is about AI model tokens only, but check 6 also matches "API-Tokens". |
| glossaryOk | `account.sessions.revoke` | The button signs out another session or device. The transitive "Déconnecter" is right there; the reflexive glossary form "se déconnecter" means signing yourself out. |
| glossaryOk | `ai.assistant.sessionHint` | "beim Abmelden" is a noun here. French uses the noun "déconnexion", not the verb "se déconnecter". |
| glossaryOk | `pdf.invoice.draftFilename` | This is a file name. "Projet-de-facture-{id}.pdf" uses hyphens like the German and English file names, so "projet de facture" with spaces cannot appear in it. |
| typographyOk | `admin.i18n.check.typography` | The hint names the marks "? ! ;" themselves, separated by spaces like the German, so the "no space before ? ! ;" rule does not apply. |

Where a glossary hit was a real requirement, I changed the text and added no allowlist entry. For example, the
German noun forms "beim Speichern" and "vor dem Löschen" now use the verbs "enregistrer" and "supprimer".

## Terms chosen that are not in the glossary (de -> fr)

R-fr and the units for groups B and C should align on these:

| de | fr |
|---|---|
| Owner / Admin / Member (role names) | Propriétaire / Administrateur / Membre |
| Eingeschränkt / Nur lesen / Buchhaltung (roles) | Restreint / Lecture seule / Comptabilité |
| Provider | fournisseur |
| Anbieter (the customer's reseller, seen by the customer) | prestataire |
| Policy, Access Policies | politique, politiques d'accès |
| Erlauben / Verweigern (policy effect) | Autoriser / Refuser |
| Label (server labels) | étiquette |
| Monitoring | surveillance (a Monitor is a "sonde", from the glossary) |
| Uptime (server, node) | Uptime (kept, see the questions below) |
| Übersicht | vue d'ensemble |
| Rechenzentrum / Standort | centre de données / emplacement |
| weblion-Mitarbeitende, Staff | personnel (de weblion) |
| API-Token, Token | jeton (API) |
| sperren (customer) / gesperrt (server status) / gesperrt (AI requests) | suspendre, suspendu / verrouillé / bloquées |
| freischalten (module) / freigeben (resource) | activer / libérer |
| Bestand (reseller pool) | stock |
| Rechnungssteller | émetteur des factures |
| Guthabenbuchung | écriture de crédit |
| verrechnen / kündigen (service) / storniert | facturer / résilier / annulée |
| Offen (open amount) | Impayé |
| Löschschutz / Rebuild-Schutz | verrou de suppression / verrou de réinstallation |
| Rescale / Rebuild | redimensionnement, modifier les ressources / réinstallation, réinstaller |
| Energie (power actions) / Reset (hart) | alimentation / Reset (forcé) |
| Arbeitsspeicher / Disk / Graphen / Messwerte | mémoire vive / disque / graphiques / mesures |
| Firewall / Reverse DNS / Gateway | pare-feu / DNS inverse / passerelle |
| ISO einlegen / auswerfen | insérer / éjecter |
| Ringgruppen / Telefonanlagen (plural) | groupes de sonnerie / centraux téléphoniques |
| Vorlage, Template / Muster | modèle / motif |
| Zugangsdaten | accès |
| beliebig (firewall) | indifférent |
| Anfrage (AI) | requête |
| KI-Funktionen | fonctions IA |
| Ersatzmodell | modèle de remplacement |
| Auftrag (translation job) / Paket (batch) | tâche / lot |
| veraltet / ungeprüft / geprüft | obsolète / non vérifié / vérifié |
| Rechtstext | texte juridique |
| Platzhalter | espaces réservés |
| Stilhinweise | consignes de style |
| Auftragsverarbeitungsvertrag / Unterauftragsverarbeiter / AGB | contrat de sous-traitance / sous-traitant ultérieur / CG |
| Live (Stripe mode), Live-System | Production, système de production |
| Kunden-Panel | console du client |
| Workspace (Anthropic) / Query-String | espace de travail / chaîne de requête |
| MWST-Nr. / Menge / ENTWURF (PDF) | N° TVA / Qté / PROJET |

These stay as written (names or terms from the provider's own UI): Personal Access Token and Customer REST API v1
(24fire), scopes (24fire token scopes), DMAPI and OT&E (Joker), QEMU Guest Agent, Cloud-Init, Mass Translate,
Claude API, webhook, and endpoint (the term Stripe's French dashboard uses).

## Doubts and open questions for the owner

1. **`ai.notice.text`, scope of "aus Protokolleinträgen".** The German sentence "entfernt weblion.one automatisch
   erkennbare Geheimnisse wie Passwörter, API-Schlüssel und Tokens sowie IP- und E-Mail-Adressen aus
   Protokolleinträgen" can be read two ways: "from log entries" applies either to everything, or only to the IP and
   e-mail addresses. The French follows the English and the design (ai.md: secrets are redacted from every tool
   result, personal data from log entries): "... les clés API et les jetons, ainsi que les adresses IP et e-mail
   des entrées de journal". Please confirm before go-live.
2. **`ai.notice.text`, legal terms.** "Unterauftragsverarbeiter" is translated as "sous-traitant ultérieur" (the
   GDPR term in French; the Swiss nLPD speaks of "sous-traitant"). "Mitarbeitende von weblion" is "des membres du
   personnel de weblion". "Bedingungen" is "conditions". Please have the legal adviser check these, sentence by
   sentence. Both legal keys are translated completely: nothing is shortened and nothing is added.
3. **Role names.** German shows the English role names (Owner, Admin, Member). French translates them
   (Propriétaire, Administrateur, Membre), and "Owner" in running text is "propriétaire" everywhere. If you want
   the English role names kept as product terms, change `role.*` and the owner texts in `customers.*`, `admin.*`
   and `role.owner.hint`.
4. **"Uptime".** `overview.uptime` stays "Uptime", which is common in French IT. "Temps de fonctionnement" breaks
   check 5, and the shorter options sound odd.
5. **Plurals.** `projects.serverCount` is "{n} serveur(s)". The other count texts use the plural only, as the
   German and English do, so they read slightly wrong for n = 1. There is no ICU plural support at this commit.
   The participles after `{email}` and `{name}` use the masculine.
6. **Button and label length.** A few short labels are more than a third longer than German but within check 5.
   `nav.platform` and `nav.logout` are fixed by the glossary. The others are `status.stopping` "Arrêt en cours",
   `tab.rescale` "Redimensionnement", `settings.protect.*` "Verrou de ...",
   `providers.joker.useLive` and the empty-state titles "Aucun ... pour l'instant". Please check them at 390 px
   (plan 8.5).
7. **Glossary check for "Tokens" (suggestion, not my file).** The AI term "Tokens" also matches "API-Tokens" (6
   allowlist entries here). `checks.ts` or `glossary.ts` could skip the term when "API-" comes before it. If that is
   changed, remove those entries.

## Checks run, with results

- `pnpm --filter @weblion/shared test` after every section and at the end: 587 passed, 2 skipped.
- `I18N_REQUIRE_COMPLETE=fr pnpm --filter @weblion/shared test`: the only failure is check 9 on `hosting`
  (group B, outside my scope). The group A sections come before it in `SECTIONS` order. A per-section script
  shows 0 missing keys in all six sections. Check 10 (legal keys in fr) passes.
- `pnpm --filter @weblion/api exec vitest run test/i18n-stamps.test.ts`: 10 passed, 1 skipped. With
  `I18N_REQUIRE_LEGAL=fr`: 11 passed. The test needs no database, so I created no database.
- `pnpm --filter @weblion/api i18n:stamp --locale fr --section <s>` for each section: all keys stamped, 0 stale.
- `pnpm typecheck`: clean.
- `pnpm exec prettier --check "packages/*/src/**/*.ts"`: clean.
- Check 3 to 6, 11 per section with my own script (same predicates as the test): 0 problems besides the
  allowlisted keys.
- `pdf.fr.ts`: all characters are Windows-1252.

## Note for the orchestrator

The scratchpad directory is shared between the parallel units: unit T-nl-B overwrote a helper script named
`dump.mts` that this unit had written there. After that I kept my helpers in the subfolder `tfra/`. No repository
file was affected.
