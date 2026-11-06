# Report T-fr-C: French (fr-CH), group C

Unit T-fr-C translated section group C (`billing`, `cloud`, `storage`, `phone`, `media`, `uptime`) from German into
French for Switzerland. Branch `ai-i18n/t-fr-c` from F commit `f0decba`. One commit per section, one commit that
aligns `billing` with the terms of units A and B, one editorial commit, and the commits of this report. Every commit
was saved with `push-unit.sh T-fr-C`, and none reported CONFLICT.

Formal address ("vous") throughout, Swiss French typography (U+00A0 before ":" and "%", no space before "?", "!" and
";"), straight quotes and apostrophes, no em dash, keys in German order, no comments in the section files.
Prettier picks the quote style, so values with an apostrophe are in double quotes. Placeholders and `\n` are as in
German.

## Keys per section

| Section | German keys | French keys | Missing | Unknown | German order |
|---|---|---|---|---|---|
| billing | 456 | 456 | 0 | 0 | yes |
| cloud | 45 | 45 | 0 | 0 | yes |
| storage | 189 | 189 | 0 | 0 | yes |
| phone | 238 | 238 | 0 | 0 | yes |
| media | 429 | 429 | 0 | 0 | yes |
| uptime | 308 | 308 | 0 | 0 | yes |
| **Total** | **1,665** | **1,665** | **0** | **0** | |

Files touched (all owned by this unit, plan 7.1):

- `packages/shared/src/i18n/sections/{billing,cloud,storage,phone,media,uptime}.fr.ts`
- `packages/shared/src/i18n/stamps/fr/{billing,cloud,storage,phone,media,uptime}.json`
- `packages/shared/src/i18n/allowlists/fr/c.ts`
- `docs/design/ai-i18n/reports/T-fr-C.md` (this report)

## Allowlist entries (`allowlists/fr/c.ts`)

All five are `glossaryOk`. `germanOk`, `informalOk`, `lengthOk` and `typographyOk` are empty.

| Key | Reason |
|---|---|
| `billing.services.customerText` | "in Rechnung stellen" is the German idiom for "to bill". French says "facturer", so "facture" does not appear. |
| `billing.service.addText` | Same idiom ("in Rechnung gestellt" -> "est facturé"). |
| `providers.hetzner.tokenHint` | The menu path names labels of the Hetzner Console, which has no French interface. They stay in English ("Security > API tokens > Generate API token", "Read & Write") so the reader finds them, so "jeton API" cannot appear. |
| `media.devices.failed` | "das Abmelden" (of devices) is a noun, and the console signs the devices out. French uses the noun "déconnexion", not the reflexive "se déconnecter" (signing yourself out). Unit A has the same case. |
| `media.requests.sessionHint` | Same noun ("dem Abmelden aller Geräte" -> "la déconnexion de tous les appareils"). |

Where a glossary hit was a real requirement, I changed the text instead. For example, "Löschen Sie ..." is
"Veuillez supprimer ...", "beim Speichern" / "nach dem Speichern" is "quand vous enregistrerez" / "Dès que vous
cliquez sur Enregistrer", and the button "Abmelden" (Uptime Kuma) is "Se déconnecter".

## Terms chosen that are not in the glossary (de -> fr)

Where units A and B had already chosen a term (their reports), I used theirs.

| de | fr |
|---|---|
| Entwurf (invoice), Entwürfe | projet, projets de facture (as "PROJET" and "Projet" in the PDF of unit A; filter and KPI labels say "Projets de facture" so they are not read as "projects") |
| Rechnungssteller | émetteur (des factures) |
| abschliessen (invoice) / Abschliessen | finaliser / finalisation |
| stornieren / storniert | annuler la facture / annulée (the buttons say "Annuler la facture" so they differ from Cancel "Annuler") |
| buchen, Buchung (credit) | comptabiliser, écriture (unit A: "écriture de crédit") |
| Guthaben aufladen / verrechnen (credit) | recharger le crédit / imputer |
| fällig (services) / Fällig bis | échu / échus jusqu'au |
| überfällig | en retard |
| offen (invoice status) / offener Betrag | ouverte / montant dû |
| Zahlung erfassen | saisir un paiement |
| kündigen / pausieren / fortsetzen | résilier / mettre en pause / reprendre |
| Zahlungsfrist / zahlbar innert | délai de paiement / payable dans les ... jours |
| Nummernkreis | préfixe de numérotation |
| PLZ / Ort / Firma | NPA / localité / entreprise |
| QR-Einzahlungsschein | QR-facture |
| Fusszeile / Kopf der Rechnung | pied de page / en-tête de la facture |
| Intervall (billing) | périodicité |
| Rechnung an (invoice document) | facture adressée à |
| Bereich (console) | section (as unit B) |
| gesperrt (customer) / gesperrt (Jellyfin account) / gesperrte Bibliotheken | suspendu / verrouillé / bibliothèques bloquées |
| freischalten / sperren (module) | activer / désactiver |
| Anbieter (the customer's reseller) | prestataire (as unit A) |
| Provider / Verbindung (provider connection) | fournisseur / connexion |
| Server-Typ / Standort / Disk / Arbeitsspeicher / Image | type de serveur / emplacement / disque / mémoire vive / image |
| Energie (tab) | Alimentation (unit A's tab label) |
| auslaufend (server type) / dediziert | en fin de vie / dédié |
| Konto / Cloud-Konto | compte / compte cloud |
| Speicherkontingent / Streaming-Kontingent / Monitoring-Kontingent | contingent de stockage / contingent streaming / contingent de surveillance |
| gebucht / zugeteilt, vergeben / belegt / frei | souscrit / attribué / utilisé / libre |
| Login-Name / Benutzername / Anzeigename | nom de connexion / nom d'utilisateur / nom d'affichage |
| übernehmen (users) / nicht verwaltete Benutzer | reprendre / utilisateurs non gérés (as unit B) |
| Instanz / einrichten / zuweisen | instance / configurer / attribuer |
| Einladung / Willkommens-Mail / Freigaben | invitation / e-mail de bienvenue / partages |
| App-Passwort | mot de passe d'application |
| Telefonanlagen (plural) / Ringgruppe / Leitung | centraux téléphoniques / groupe de sonnerie / ligne (as unit A) |
| Webclient / Durchwahlen / ausgehende Rufnummer | client web / numéros directs / numéro sortant |
| angemeldet (extension) / registriert (trunk) | connecté / enregistrée |
| Gespräche / Klingeldauer / Telefonanbieter | appels / durée de sonnerie / opérateurs téléphoniques |
| Strategien: der Reihe nach / alle gleichzeitig / Durchsage | à tour de rôle / tous en même temps / annonce |
| Zugangsdaten | identifiants (what the welcome e-mail contains); "accès" where the text names the permission of unit A ("gérer les accès de la téléphonie") |
| API-Schlüssel / Client-ID | clé API / ID client |
| Zugang, Zugänge (streaming) | accès |
| Fernseher / Gerät / anmelden, abmelden (devices) | téléviseur / appareil / connecter, déconnecter |
| Wiedergabe / Verlauf / Favoriten / Playlists | lecture / historique / favoris / listes de lecture |
| Bibliothek / Streams / Downloads | bibliothèque / flux / téléchargements |
| Qualität unterwegs / Bitrate | qualité en déplacement / débit |
| Richtlinie (Jellyfin policy) / Rechte | politique (unit A: Policy -> politique) / droits |
| Hinweise (account issues) | remarques |
| Anfragen (Seerr) / anfragen / genehmigt | demandes / demander, faire des demandes / approuvées |
| Staffeln / Serien / Filme | saisons / séries / films |
| gemeinsam / dediziert (instance) | partagée / dédiée |
| Monitoring | surveillance (unit A's module label) |
| Uptime (Uptime Kuma values) / Verfügbarkeit | disponibilité, taux de disponibilité (see question 5) |
| Ziel / Herkunft / Antwortzeit | cible / origine / temps de réponse |
| Prüfung / Prüfintervall | vérification / intervalle de vérification |
| erreichbar / ausgefallen, Ausfall / Wartung | joignable / en panne, panne / maintenance |
| Statusseite / Statuswechsel / Meldung | page de statut / changement de statut / message |
| Keyword / umgekehrter Modus / Wiederholungen / Zeitlimit | mot-clé / mode inversé / nouvelles tentatives / délai d'expiration |
| verknüpfen / Verknüpfung lösen | associer / dissocier |
| Verwaltung (management sign-in of Uptime Kuma) | administration (see question 6) |
| Sitzungstoken / Zwei-Faktor-Code | jeton de session / code à deux facteurs |
| Live-Daten | données en direct (as unit B) |
| als Query / als Formular (API explorer) | sous forme de chaîne de requête / sous forme de formulaire (as unit A) |
| In Ordnung (status) | En ordre (as unit B) |
| z. B. | p. ex. |
| GB, MB (in prose) | Go, Mo |

## Doubts and open questions for the owner and R-fr

1. **Invoice drafts are "projet".** Unit A chose "PROJET" for `pdf.invoice.draftMark` and "Projet" for the PDF meta
   line, so the console uses "projet" too (status badge "Projet", "Enregistrer comme projet", "Projets de facture").
   "Brouillon" is the more common UI word for a draft and could not be confused with "projet" (project). If the owner
   prefers "brouillon", change it in both groups (pdf, admin and billing) together.
2. **Third-party menu labels.** Hetzner Console: kept in English (no French interface, allowlisted). Nextcloud
   ("Paramètres personnels > Sécurité > Appareils & sessions", "Administration > Paramètres de base > Serveur e-mail"),
   Jellyfin ("Tableau de bord > Clés API > Ajouter", "Paramètres > Quick Connect"), Seerr ("Paramètres > Réseau",
   "Paramètres > Utilisateurs", "Paramètres > Général > Clé API"), 3CX ("Intégrations > API", role "System Admin",
   "XAPI Access Enabled" kept) and Uptime Kuma ("Paramètres > Clés API") are written as I believe their French
   interfaces show them. I could not check them. If staff run these tools in English or German, the original labels
   may be better.
3. **Example values made French.** `muster.3cx.ch` -> `exemple.3cx.ch`, `muster-ag` -> `exemple-sa`, `wohnzimmer` ->
   `salon`, "Ihre Firma GmbH" -> "Votre Entreprise Sàrl", "Cloud Server M" -> "Serveur cloud M", "8 GB RAM" -> "8 Go
   de RAM". Kept as written: "anna", "Anna Muster", `https://anfragen.weblion.one` (it may be a real host name), the
   JSON examples and "10 GB" in the Nextcloud body example (a value sent to Nextcloud). No URL, address or number was
   added that the German does not have.
4. **Size units.** French prose says "Go" (as unit A in `rescale.*`). Sizes that the code formats arrive through
   placeholders and may still show "GB", so a screen can mix both. Please check at 390 px (plan 8.5).
5. **"Uptime".** Unit A kept "Uptime" for the server overview (`overview.uptime`). In the monitoring pages the German
   "Uptime" and "Verfügbarkeit" are both "disponibilité" (columns "Disponibilité 24 h") or "taux de disponibilité"
   (running text), as unit A's `module.monitoring.description`. R-fr should decide whether the server overview
   follows.
6. **"Verwaltung" in the Uptime Kuma pages.** "Für die Verwaltung angemeldet" means the console holds a session that
   may change monitors. I wrote "connectée pour l'administration", which satisfies the glossary term "Verwaltung ->
   administration" (about 20 keys). "Gestion" would be a little more precise; switching would need about 20
   `glossaryOk` entries or a narrower glossary rule.
7. **Agreement with placeholders.** Monitor toasts use the feminine ("{name} enregistrée", "mise en pause") because a
   monitor is "une sonde", and Uptime Kuma instances use "connectée". Phone systems, cloud and streaming accounts use
   the masculine.
8. **"Zugangsdaten".** Unit A writes "accès", unit B "identifiants". I used "identifiants" for what the 3CX welcome
   e-mail contains and "accès" where the sentence refers to unit A's permission label (`phone.user.emailLocked`).
   R-fr should pick one for all groups.
9. **Labels of other groups that my texts quote.** Please check they match: "Alimentation" (`tab.power`, in
   `plans.hetznerOff`), "Fournisseurs" (nav label for Provider, in `phone.admin.emptyText`,
   `media.admin.noInstancesText`, `uptime.admin.noInstancesText`), "Téléphonie" (`phone.admin.assignText`), the
   module names "Stockage cloud", "Streaming" and "Surveillance" (`*.enablesModule`), and the paths "Admin >
   Streaming" and "Admin > Surveillance".
10. **Plurals.** As in German and English, count texts such as "{n} facture(s)" or "{n} sondes" read slightly wrong
    for n = 1. There is no ICU plural support at this commit.

## Checks run, with results

| Check | Result |
|---|---|
| `pnpm --filter @weblion/shared test` (after each section and at the end) | 587 passed, 2 skipped |
| `pnpm --filter @weblion/api i18n:stamp --locale fr --section <s>` (each section, again after the editorial pass) | all keys stamped, 0 stale; `--check` exits 0 for all six sections |
| `pnpm --filter @weblion/api exec vitest run test/i18n-stamps.test.ts` | 10 passed, 1 skipped (no database needed, so none was created) |
| `pnpm typecheck` | shared, api and web pass |
| `pnpm exec prettier --check "packages/*/src/**/*.ts"` | all files pass |
| Completeness of group C (script with the same key comparison, plus German key order) | 0 missing, 0 unknown in all six sections |
| `I18N_REQUIRE_COMPLETE=fr pnpm --filter @weblion/shared test` | fails only for sections outside group C: check 9 stops at `core` (group A, 857 keys missing in this worktree) and check 10 at the legal keys of `ai` (group A) |
| Checks 2 to 8 and 11 per key with `checkValue` and the allowlists (own script) | 0 problems in all six sections |
| Pushed state | the six section files and `allowlists/fr/c.ts` on `claude/nice-mendel-eiwx53` equal this branch |
| Editorial pass | all 1,665 values read again: terms the same across the six sections and aligned with units A and B, formal address everywhere, no German left over, no em dash, buttons within check 5 |
