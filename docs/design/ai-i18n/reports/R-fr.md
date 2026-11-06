# Report R-fr: review of French (fr-CH)

All 16 sections are translated into French for Switzerland: 4,602 keys, none missing. I merged the three group branches and read every value against the German. I fixed 71 values in 14 sections and removed one allowlist entry. All four required checks pass.

The legal notice (`ai.notice.title`, `ai.notice.text`) is complete and literal, sentence by sentence, and I did not change it. The owner should still confirm two points in it (questions 1 and 2).

## Branch and commits

The branch is `ai-i18n/t-fr`, created from `f0decba` in `/home/user/wt/t-fr`. I ran `push-unit.sh R-fr` after every commit; none reported CONFLICT.

| Commit | Content |
|---|---|
| `00a7a7c`, `e408ae1`, `ca49e4e` | Merges of `ai-i18n/t-fr-a`, `-b` and `-c` (`--no-ff`, no conflicts) |
| `f798e2b` | Terms of groups A and B aligned, small wording fixes, one allowlist entry removed |
| `c936a58` | Terms of group C aligned with the other groups |
| `7dd1b91` | Stamps (`i18n:stamp --locale fr`), allowlist comment updated |
| (this report) | `docs/design/ai-i18n/reports/R-fr.md` |

## What I changed

### Conflicts between the groups, each decided once and applied everywhere

| German | Before | Now | Keys changed |
|---|---|---|---|
| Zugangsdaten | "accès" (A), "identifiants" (B, C) | identifiants | 7. Includes `perm.webspace:credentials`, `perm.platform:provider:write`, `providers.subtitle`, `providers.envManaged`, `providers.joker.passwordHint`, `admin.int.intro` and `phone.user.emailLocked`. |
| Ihr Anbieter (the customer's own provider: weblion.one or its reseller) | "prestataire" (A, C), "fournisseur" (B) | prestataire | 3: `hosting.moduleOff.text`, `websites.list.noAllowanceReseller`, `mail.limits.text` |
| E-Mail-Domain / Mail-Domain | "domaine e-mail" (A), "domaine de messagerie" (B) | domaine de messagerie | 6: `perm.mail:read`, `perm.platform:server:assign`, `perm.platform:mail:write`, `module.mail.description`, `ai.tool.list_mail_domains`, `ai.tool.get_mail_domain` |
| Bestand (a reseller's resources) | "stock" (A), "parc" (B) | parc | 6 `admin.resources.*` keys |
| Streaming-Kontingent | "contingent streaming" (C), against "contingent de stockage" and "contingent de surveillance" | contingent de streaming | 11 `media.*` keys |
| an Zoho übertragen | "transférer" (A), "transmettre" (C) | transmettre, transmission | `admin.int.zohoText`, `admin.int.lastSync`, `admin.int.zohoSynced` |
| Offen / offener Betrag | "Impayé" (A), "Montant dû" (C) | Montant dû | `admin.openTotal` |
| Rechnung an | "Facture pour" (pdf), "Facture adressée à" (billing) | Facture adressée à | `pdf.invoice.subject` |
| Rechnungssteller (tab) | "Émetteur" and "Émetteur des factures" for the same tab | Émetteur des factures | `billing.issuer.tab` (the table column stays "Émetteur") |
| weblion-Mitarbeitende | "personnel weblion" (B), "personnel de weblion" (A) | personnel de weblion | `hosting.moduleOff.staff`, `hosting.renewal.text` |
| Noch keine … (empty-state titles) | "pour le moment" (B), "pour l'instant" (A, C) | pour l'instant | 7. "Pour le moment" stays where the text describes a temporary state ("injoignable pour le moment"). |
| eigene Monitore | "sondes propres" (reads as "clean probes") | "vos / ses propres sondes", or "sondes personnalisées" where no possessive fits (as in `module.monitoring.description`) | 7 `uptime.*` keys |
| Mailserver (example) | "serveur e-mail" | serveur de messagerie | `billing.line.descriptionPlaceholder` |
| 24fire Control Panel | English name in A | panneau de contrôle 24fire (as in B) | `inventory.importHint.fire24` |
| Richtlinie (Jellyfin) | "directives" in one core key | politique (as in `media`) | `perm.platform:media:write` |

### Wording and grammar

- **`login.hero.title`:** "Vos serveurs. Un seul tableau de bord." became "Vos serveurs. Une seule console." The product calls itself a console everywhere else.
- **`invite.subtitle`:** "{email} a été invité en tant que {role}." became "{email} a reçu une invitation en tant que {role}." This avoids a masculine participle after an e-mail address.
- **`customers.created`:** "{name} a été créé" became "Client {name} créé" (the name is an organization, so a participle after it reads wrong).
- **`power.sent`:** "{action} déclenché" became "Action déclenchée : {action}". The placeholder is a button label such as "Redémarrer", which cannot take a participle.
- **`network.rdnsText`:** "doit" became "devrait", matching the German "sollte".
- **`firewall.sourceHint`:** "Vide signifie n'importe laquelle." became "Vide signifie toutes les adresses."
- **`admin.dash.overdue`:** "{amount} sont en retard de paiement." became "En retard de paiement : {amount}".
- **`admin.orgs.moveBlocker.invoices`:** "projets" became "projets de facture", so it cannot be mistaken for server projects.
- **`email.reminder.text`:** "n'est pas encore réglée. Veuillez payer le montant dû." became "est encore ouverte. Veuillez régler le montant dû." This matches the "Ouverte" status and uses the usual verb for paying an invoice.
- **`providers.threecx.help`:** the instructions were infinitives ("créer…, choisir…"). They are now in the formal imperative ("créez…, choisissez…"), as rule 1 asks.
- **`providers.hetzner.tokenHint`:** the menu path mixed French and English ("projet > Security > …"). It is now English throughout ("Project > Security > API tokens > Generate API token"), as the Hetzner Console shows it.
- **`mail.units.invalid`:** "2.5 GB" became "2,5 GB". The French decimal comma is accepted by the parser (`apps/web/src/pages/mail/units.ts`). MB and GB stay, because they are the options of the unit select next to the field.

### Allowlists

- **Removed:** `typographyOk` `admin.i18n.check.typography`. The hint now quotes the marks (`avant ":" et "%", aucune espace avant "?", "!" et ";"`), so check 11 passes without the entry.
- **Kept:** every other entry. A script confirmed that each one is still needed: without the entry, its check fails.

### Checked and left unchanged

- **Formal address:** "vous" everywhere. No informal forms, no German left, no em dash, no typographic quotes, and no U+202F.
- **Typography:** a no-break space before ":" and "%" everywhere. The only colons without one are code (`add:`, `i18n:apply`, `kuma:token`, JSON examples).
- **Punctuation and line breaks:** final periods, colons, question marks and ellipses match the German. The only differences are abbreviations such as "Stk." -> "pce" and "Nr." -> "n°". Placeholders and `\n` match (check 2).
- **Sentence case:** capitals in the middle of a value are only names or quoted UI labels ("sous Paramètres > Sécurité", "le module Surveillance").
- **Letter style:**
  - The e-mails open with "Bonjour" and close with "Meilleures salutations".
  - `pdf.invoice.draftMark` is "PROJET".
  - The `pdf` section uses only Windows-1252 characters (checked by script).
- **Labels quoted between sections match their source:**
  - module names: "Domaines & DNS", "Hébergement web", "E-mail", "Stockage cloud", "Téléphonie", "Streaming", "Surveillance"
  - navigation: "Fournisseurs", "Alimentation", "Paramètres > Fonctions IA"
  - permission names quoted in hints, such as "Modifier les enregistrements DNS"
- **Button lengths:** all within check 5. The longest short labels relative to the German are listed in question 6.

### The data notice, sentence by sentence

`ai.notice.title` is "Avis de confidentialité concernant les fonctions IA": the glossary term plus a literal rest.

`ai.notice.text` has six paragraphs and five `\n\n`, the same as the German. Every German sentence has exactly one French sentence with the same content. Nothing is shortened and nothing is added.

The terms in the notice match the UI:

- "Paramètres > Fonctions IA" is the real path.
- "jetons" is used for API tokens (secrets) and "tokens" for AI usage, which satisfies the glossary.
- "assistant IA", "IA" and "Anthropic PBC" follow the glossary and the names rule.

I changed nothing in the two legal keys.

## Final term decisions not in the glossary (de -> fr)

These replace the "terms chosen" lists of the three group reports where they differed. A term that only one group used keeps that group's translation (see the group reports).

| German | French |
|---|---|
| Zugangsdaten | identifiants |
| Zugang (SFTP/SSH, Plesk) / Streaming-Zugang | accès / accès streaming (glossary) |
| Anbieter (the customer's own provider) | prestataire |
| Anbieter (any registrar or DNS provider), Provider | fournisseur (nav "Fournisseurs") |
| Zahlungsanbieter | prestataire de paiement |
| E-Mail-Domain, Mail-Domain | domaine de messagerie |
| Mailserver, Mailprogramm | serveur de messagerie, client de messagerie |
| Bestand (reseller) | parc |
| Streaming-, Speicher-, Monitoring-, Website-Kontingent | contingent de streaming, de stockage, de surveillance, de sites web |
| eigene Monitore | propres sondes (with a possessive), sondes personnalisées |
| Monitoring | surveillance |
| Uptime (server, time since start) | Uptime |
| Uptime, Verfügbarkeit (monitoring) | disponibilité, taux de disponibilité |
| erreichbar (system) / (web address) | joignable / accessible |
| Owner / Admin / Member | propriétaire / administrateur / membre |
| weblion-Mitarbeitende, Staff | personnel (de weblion) |
| Entwurf (invoice) | projet (de facture) |
| Rechnungssteller | émetteur des factures (column: émetteur) |
| Rechnung an | facture adressée à |
| offen (invoice) / offener Betrag | ouverte / montant dû |
| stornieren | annuler (la facture) |
| Guthaben buchen / verrechnen | comptabiliser du crédit / imputer |
| übertragen (Zoho) | transmettre, transmission |
| abgleichen, synchronisieren | synchroniser, synchronisation |
| freischalten (module) / freigeben (resource) | activer / libérer |
| sperren: customer / server / Jellyfin account / AI requests | suspendre / verrouiller / verrouiller / bloquer |
| Richtlinie (Jellyfin, Mailcow), Policy | politique |
| Bereich (part of the console) / Admin-Bereich | section / espace admin |
| Auftrag: translation job / provider job | tâche / demande |
| Anfrage: AI / Seerr | requête / demande |
| Control Panel | panneau de contrôle |
| Noch keine … | Aucun … pour l'instant |
| GB, MB | Go, Mo in prose; GB, MB where a unit select or code value is meant |

## Allowlist entries that remain

All 36 are confirmed by script as still needed.

### `allowlists/fr/a.ts`, 9 entries, all `glossaryOk`

- **6 API-token keys:** `nav.tokens`, `perm.apitoken:read`, `perm.apitoken:write`, `tokens.subtitle`, `tokens.empty`, `tokens.emptyText`. "API-Tokens" are "jetons API". The AI glossary term "Tokens" matches after the hyphen.
- **`account.sessions.revoke`:** "Déconnecter" signs out another session. The glossary verb "se déconnecter" means signing out yourself.
- **`ai.assistant.sessionHint`:** "beim Abmelden" is a noun, which French writes as "déconnexion".
- **`pdf.invoice.draftFilename`:** a file name with hyphens ("Projet-de-facture-{id}.pdf").

### `allowlists/fr/b.ts`, 22 entries

- **3 Cloudflare API-token keys** (`glossaryOk`): `providers.cloudflare.help`, `providers.cloudflare.tokenHint`, `explorer.cloudflarePath`. Same reason as the token keys of group A.
- **16 "Website-Kontingent" keys** (`glossaryOk`): French says "contingent de sites web" (plural), which the substring check for "site web" does not match.
- **`mail.dns.toZone`, `mail.dns.explain.conflicts`** (`glossaryOk`): "DNS-Verwaltung" is "gestion DNS", not the staff administration of the glossary.
- **`websites.password.rule.characters`** (`typographyOk`): the spaces separate literal password characters; they are not punctuation spacing.

### `allowlists/fr/c.ts`, 5 entries, all `glossaryOk`

- **`billing.services.customerText`, `billing.service.addText`:** "in Rechnung stellen" means "facturer".
- **`providers.hetzner.tokenHint`:** the menu labels of the Hetzner Console stay in English, so "projet" and "jeton API" cannot appear. I updated the comment to name "Project" too.
- **`media.devices.failed`, `media.requests.sessionHint`:** "Abmelden" is a noun here ("déconnexion").

## Open questions for the owner

1. **Data notice, scope of "aus Protokolleinträgen".** The German sentence can be read two ways: either everything listed is removed from log entries, or only the IP and e-mail addresses are. The French follows the English and ai.md: secrets are removed everywhere, addresses only from log entries ("ainsi que les adresses IP et e-mail des entrées de journal"). Please confirm. If the other reading is meant, the German should be clarified first.
2. **Data notice, legal terms.** Please have the legal adviser check both:
   - "Unterauftragsverarbeiter" is "sous-traitant ultérieur", the GDPR term. The Swiss nLPD only says "sous-traitant".
   - "Mitarbeitende von weblion" is "des membres du personnel de weblion".
3. **Role names.** The German shows the English names Owner, Admin and Member; the French translates them (Propriétaire, Administrateur, Membre). If the English names are product terms, `role.*` and the texts that name the owner must change together.
4. **"Projet de facture".** The glossary fixes "Rechnungsentwurf" as "projet de facture", so drafts are "projets" everywhere. "Brouillon" is the more common UI word and cannot be confused with server projects. Changing it means changing the glossary, `pdf`, `billing` and `admin` together.
5. **Size units.** French prose says Go and Mo, but `apps/web/src/lib/format.ts` always prints "GB" and "MB", so one screen can show both. Either the formatter should use the locale (Go/Mo in fr), or the French texts should use GB/MB. Please decide. Both are acceptable in Switzerland.
6. **Long short labels, to check at 390 px.** All are within check 5, but much longer than the German:
   - `tab.rescale` "Redimensionnement"
   - `billing.filter.drafts` "Projets de facture"
   - `billing.void.action` "Annuler la facture"
   - `settings.protect.*` "Verrou de suppression" / "Verrou de réinstallation"
   - `nav.platform` "Administration de la plateforme"
   - `mail.alias.special.discard` "Supprimer en silence"
7. **Menu labels of other tools** (Cloudflare, Mailcow, Plesk, Nextcloud, Jellyfin, Seerr, 3CX, Uptime Kuma) are written as their French interfaces are believed to show them, except Hetzner, which stays in English. If staff use these tools in German or English, the original labels may be better.

## Changes needed in files I do not own (for the integrator)

1. **`apps/web/src/pages/hosting/dns-move.tsx`, line 190.** `hosting.dnsMove.noOrg` ("aucune organisation") is inserted into "…, le domaine à {domainOrg}", which reads "le domaine à aucune organisation". This needs either its own text for the case without an organization, or a sentence that works with the empty value.
2. **`packages/shared/src/i18n/checks.ts` (check 6), suggestion.** Two changes would let 25 allowlist entries go:
   - Skip the glossary term "Tokens" when it follows "API-" (this matches all three languages): 9 entries.
   - Accept the plural of a fixed translation ("sites web" for "site web"): 16 entries.
3. **`apps/web/src/lib/format.ts`.** Localize the byte units, if the owner chooses Go/Mo (question 5).

## Checks

| Check | Result |
|---|---|
| `I18N_REQUIRE_COMPLETE=fr pnpm --filter @weblion/shared test` | 9 files, 589 tests passed, none skipped |
| `I18N_REQUIRE_LEGAL=fr pnpm --filter @weblion/api exec vitest run test/i18n-stamps.test.ts` | 11 passed (the test needs no database, so I created and dropped none) |
| `pnpm typecheck` | shared, api and web pass |
| `pnpm exec prettier --check "packages/*/src/**/*.ts"` | all files pass |
| `pnpm --filter @weblion/api i18n:stamp --locale fr` | 71 stamps updated in 14 files, 0 stale. `--check` then exits 0. |
| Allowlist script | all 36 remaining entries still needed |
| Scripted checks: final punctuation, ellipses, double spaces, capitals mid-value, quote characters, e-mail gender, Windows-1252 in `pdf` | no open findings |

## Files

- /home/user/wt/t-fr/packages/shared/src/i18n/sections/*.fr.ts (16 files)
- /home/user/wt/t-fr/packages/shared/src/i18n/stamps/fr/*.json (16 files)
- /home/user/wt/t-fr/packages/shared/src/i18n/allowlists/fr/{a,b,c}.ts
- /home/user/wt/t-fr/docs/design/ai-i18n/reports/R-fr.md
