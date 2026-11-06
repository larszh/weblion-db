# T-it-late report: Italian (it-CH), late keys of the build

Unit T-it-late, branch `ai-i18n/late-it` from the integration commit 6eaee9d, worktree `/home/user/wt/late-it`.
Italian was complete and reviewed (R-it); the build units then added 25 keys and changed 9 German texts. Italian
is complete again: 4,627 keys, 0 missing, 0 stale. The terms of R-it and T-it-{A,B,C} are kept.

Commits, each saved with `push-unit.sh T-it-late` (no CONFLICT):

1. `T-it-late: Italienisch auf den Stand der späten Schlüssel gebracht`: the 25 keys, the notice sentence, stamps.
2. This report.

## Missing keys translated (25)

Each key is at its German position.

| Key | Italian |
|---|---|
| `aria.openMenu` | Apri menu |
| `aria.closeMenu` | Chiudi menu |
| `aria.labelKey` | Chiave dell'etichetta |
| `aria.labelValue` | Valore dell'etichetta |
| `aria.statusFilter` | Filtra per stato |
| `admin.mail.template.ai_budget` | Budget IA |
| `admin.ai.usage.date` | Data |
| `admin.ai.errors.allFeatures` | Tutte le funzioni |
| `admin.ai.errors.allStatuses` | Tutti gli stati |
| `admin.ai.errors.allSources` | Tutte le origini |
| `billing.service.cancelledPer` | Disdetto con effetto al {date} |
| `billing.service.endWaitsForBilling` | Disdetto con effetto al {date}, termina non appena è fatturato fino a quella data |
| `billing.service.moduleOffAtEnd` | Il modulo "{module}" verrà disattivato in quella data |
| `billing.service.moduleKept` | Il modulo resta attivo finché il cliente ha ancora un altro servizio con questo modulo: {names}. |
| `billing.service.cancelledLater` | Servizio "{name}" disdetto con effetto al {date} |
| `billing.service.endsAtLaterHint` | Con una data successiva il servizio continua fino a quel giorno e un modulo selezionato viene disattivato solo allora. Ogni periodo che inizia entro quel giorno viene fatturato per intero, non pro rata. |
| `billing.service.fullPeriod` | Il periodo a partire dal {date} viene ancora fatturato per intero ({price}). |
| `billing.service.endBeforePeriod` | Disdici invece con effetto al {date} |
| `billing.service.changeCancel` | Modifica disdetta |
| `billing.service.withdrawCancel` | Revoca disdetta |
| `billing.service.withdrawCancelTitle` | Revocare la disdetta di "{name}"? |
| `billing.service.withdrawCancelText` | In seguito il servizio continua senza data di fine e viene fatturato come finora. |
| `billing.service.cancelWithdrawn` | Disdetta di "{name}" revocata |
| `billing.profile.localeOwnerPlain` | Lingua del proprietario |
| `billing.product.translations.nameRequired` | Inserisca un nome o svuoti la descrizione. |

How the billing texts are used (`apps/web/src/pages/billing/{tables,seller-dialogs,seller-panel}.tsx`):

- **Status lines in the service table.** `cancelledPer`, `endWaitsForBilling` and `moduleOffAtEnd` stand under the status badge of a service. They are past participles in the masculine, for "servizio".
- **Cancel dialog.** `endsAtLaterHint` is the hint of the date field. `fullPeriod` is the warning that a whole period is still billed. It says "per intero", like the German "voll", and the hint says "non pro rata" for "nicht anteilig". `endBeforePeriod` is the button that sets the date before that period.
- **Menu and confirmation.** `changeCancel` and `withdrawCancel` are menu items and buttons, so they use the short form. `withdrawCancelTitle` is an infinitive question, the R-it rule for confirm titles.

## Terms used for the first time (not in the glossary)

| German | Italian | Note |
|---|---|---|
| gekündigt per {date} | disdetto con effetto al {date} | Swiss usage for a cancellation with an end date; "kündigen" stays "disdire" (R-it) |
| Kündigung zurücknehmen | revocare la disdetta | |
| verrechnet (a period) | fatturato | as `billing.service.resumeHint` |
| Periode | periodo | as `billing.service.resumeHint` |
| voll / nicht anteilig | per intero / non pro rata | |
| Quelle (of an AI error: Claude API or weblion.one) | origine | not "fonti", which `ai.assistant.sources` uses for the sources of an answer |
| Label-Schlüssel / Label-Wert | chiave / valore dell'etichetta | as `settings.labelsText` ("coppie chiave/valore") |

Module "gesperrt" is "disattivato" (R-it: sperren for a module means disattivare). The German «» quotes are straight
double quotes (rule 6).

## Stale keys

**Confirmed unchanged (8).** The German changed only from "du" to "Sie". The Italian was already in the formal form
and says the same as the new German. Each was stamped with `i18n:stamp --locale it --key <key> --confirm`.

| Key | Italian (unchanged) |
|---|---|
| `login.hero.text` | Gestisca i server cloud nel data center in Germania e su un'infrastruttura propria in Svizzera. Con monitoraggio, backup, snapshot e diritti di accesso granulari. |
| `invite.invalid.text` | Il link è scaduto o è già stato utilizzato. Richieda un nuovo invito. |
| `projects.delete.notEmpty` | Il progetto contiene ancora dei server. Li sposti prima in un altro progetto. |
| `members.inviteLinkText` | Invii questo link a {email}. È valido 7 giorni. |
| `admin.delete.moveHint` | Sposti o rimuova prima queste voci. |
| `admin.delete.billingHint` | Fatture, pagamenti e registrazioni di credito devono essere conservati. Sospenda invece l'organizzazione. |
| `admin.orgs.resellerNoModules` | {name} non ha ancora moduli. Li attivi prima presso il rivenditore. |
| `admin.orgs.moveMissing` | {name} non dispone di tutti i moduli di questo cliente. Li attivi presso il rivenditore o li disattivi prima qui. |

**Legal notice `ai.notice.text`.** Only the changed German sentence was translated again, by hand.

- **German (new):** "Vor dem Senden entfernt weblion.one Geheimnisse, die es erkennt, zum Beispiel Passwörter, API-Schlüssel und Tokens. Aus Protokolleinträgen entfernt es zusätzlich IP- und E-Mail-Adressen."
- **Italian (before):** "Prima dell'invio, weblion.one rimuove automaticamente segreti riconoscibili come password, chiavi API e token, nonché indirizzi IP ed e-mail dalle voci di registro."
- **Italian (now):** "Prima dell'invio, weblion.one rimuove i segreti che riconosce, ad esempio password, chiavi API e token. Dalle voci di registro rimuove inoltre gli indirizzi IP ed e-mail."

"automaticamente" is gone because the German sentence no longer has "automatisch" (the next sentence still says the
detection is automatic). "zum Beispiel" is "ad esempio" and "Protokolleinträge" is "voci di registro", as elsewhere in
the notice. Every other sentence is unchanged. The new value was stamped as updated.

This settles R-it open questions 1(a) and 1(b): the German now says that secrets are removed everywhere and the
addresses only from log entries, and it no longer has the two readings of "automatisch erkennbare". The owner still
reviews the whole notice before go-live (plan 7.2).

## Allowlists

No change. All 25 new values pass checks 3 to 6 without an entry, and none of the existing 56 entries names a
changed key.

## Checks run

| Check | Result |
|---|---|
| `pnpm --filter @weblion/api i18n:report --locale it` (before) | 25 missing, 9 stale |
| `pnpm --filter @weblion/api i18n:report --locale it` (after) | 4,627 keys, 0 missing, 0 stale |
| `I18N_REQUIRE_COMPLETE=it pnpm --filter @weblion/shared test` | 589 passed |
| `I18N_REQUIRE_LEGAL=it pnpm --filter @weblion/api exec vitest run test/i18n-stamps.test.ts` | 11 passed |
| `pnpm --filter @weblion/api i18n:stamp --check --locale it` | 16 files up to date, 0 stale |
| `pnpm --filter @weblion/api i18n:stamp --check` (all locales) | exit 0, nothing to write; it lists 18 stale keys of fr and nl (the same du/Sie keys and the notice), which belong to their late units |
| `pnpm typecheck` | clean (shared, api, web) |
| `pnpm exec prettier --check "packages/*/src/**/*.ts"` | all files formatted |
| `pdf.*` encodable in Windows-1252 (script) | 44 keys, 0 characters outside Windows-1252 |
| Key set and order of core, admin, ai, billing against German (script) | equal, German order; no em dash, typographic quotes, angle quotes or sharp s |
