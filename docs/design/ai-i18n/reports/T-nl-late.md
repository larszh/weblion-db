# T-nl-late report: late keys in Dutch (nl-NL)

Branch `ai-i18n/late-nl`, based on the integration commit `6eaee9d`. Before the unit, `i18n:report --locale nl`
showed 25 missing and 9 stale keys. Now it shows 0 missing and 0 stale (4,627 keys).

The translation is commit `1191663`. It was saved with `push-unit.sh T-nl-late`, without a CONFLICT.

## Missing keys (25)

All keys are translated from German, with the formal address and the terms of R-nl. Each key sits at its German
position.

| Key | nl |
|---|---|
| `aria.openMenu` | Menu openen |
| `aria.closeMenu` | Menu sluiten |
| `aria.labelKey` | Labelsleutel |
| `aria.labelValue` | Labelwaarde |
| `aria.statusFilter` | Filteren op status |
| `admin.mail.template.ai_budget` | AI-budget |
| `admin.ai.usage.date` | Datum |
| `admin.ai.errors.allFeatures` | Alle functies |
| `admin.ai.errors.allStatuses` | Alle statussen |
| `admin.ai.errors.allSources` | Alle bronnen |
| `billing.service.cancelledPer` | Opgezegd per {date} |
| `billing.service.endWaitsForBilling` | Opgezegd per {date}, eindigt zodra er tot dan is gefactureerd |
| `billing.service.moduleOffAtEnd` | Module "{module}" wordt dan gedeactiveerd |
| `billing.service.moduleKept` | De module blijft actief zolang de klant er nog een andere dienst mee heeft: {names}. |
| `billing.service.cancelledLater` | Dienst "{name}" opgezegd per {date} |
| `billing.service.endsAtLaterHint` | Met een latere datum loopt de dienst door tot en met die dag en wordt een gekozen module pas dan gedeactiveerd. Elke periode die uiterlijk op die dag begint, wordt volledig gefactureerd, niet naar rato. |
| `billing.service.fullPeriod` | De periode vanaf {date} wordt nog volledig gefactureerd ({price}). |
| `billing.service.endBeforePeriod` | In plaats daarvan per {date} opzeggen |
| `billing.service.changeCancel` | Opzegging wijzigen |
| `billing.service.withdrawCancel` | Opzegging intrekken |
| `billing.service.withdrawCancelTitle` | Opzegging van "{name}" intrekken? |
| `billing.service.withdrawCancelText` | De dienst loopt daarna zonder einddatum door en wordt zoals voorheen gefactureerd. |
| `billing.service.cancelWithdrawn` | Opzegging van "{name}" ingetrokken |
| `billing.profile.localeOwnerPlain` | Taal van de eigenaar |
| `billing.product.translations.nameRequired` | Voer een naam in of maak de omschrijving leeg. |

Choices:

- **"bis zu diesem Tag" is "tot en met die dag" and "uiterlijk op die dag".** `apps/web/src/pages/billing/service-end.ts`
  bills every period that starts on or before the end date. A plain "tot die dag" reads as "before that day" in Dutch.
- **"nicht anteilig" is "niet naar rato".**
- **Terms of R-nl:**
  - kündigen / Kündigung: opzeggen / opzegging
  - verrechnen, abrechnen: factureren
  - Modul sperren: module deactiveren
  - Owner: eigenaar
- **"zurücknehmen" is "intrekken"**, as in `members.inviteRevoked` "Uitnodiging ingetrokken".
- **The German «» quotes are straight quotes** (rule 6), as in every other `billing.service.*` value.

## Stale keys (9)

### Eight confirmed without a change

Eight German texts changed only from "du" to "Sie". The Dutch says the same as the new German and is formal: Dutch
imperatives have no du/Sie form. I stamped each one with `i18n:stamp --locale nl --confirm --key <key>`.

| Key | nl |
|---|---|
| `login.hero.text` | Beheer cloudservers … |
| `invite.invalid.text` | … Vraag om een nieuwe uitnodiging. |
| `projects.delete.notEmpty` | … Verplaats ze eerst naar een ander project. |
| `members.inviteLinkText` | Stuur deze link naar {email}. … |
| `admin.delete.moveHint` | Verplaats of verwijder deze eerst. |
| `admin.delete.billingHint` | … Schort de organisatie in plaats daarvan op. |
| `admin.orgs.resellerNoModules` | … Activeer ze eerst bij de reseller. |
| `admin.orgs.moveMissing` | … Activeer ze bij de reseller of deactiveer ze hier eerst. |

`admin.delete.moveHint` says "deze" (these), like the English, without a word for "Einträge". The list of blockers
is shown right above it, so the meaning is the same. I left it as it was.

### ai.notice.text: one sentence translated again

I translated only the changed sentence, by hand. The rest of the notice is unchanged: 6 paragraphs, 10 `\n`.

- German: "Vor dem Senden entfernt weblion.one Geheimnisse, die es erkennt, zum Beispiel Passwörter, API-Schlüssel und
  Tokens. Aus Protokolleinträgen entfernt es zusätzlich IP- und E-Mail-Adressen."
- nl, before: "Vóór het verzenden verwijdert weblion.one automatisch herkenbare geheimen zoals wachtwoorden,
  API-sleutels en tokens, evenals IP- en e-mailadressen uit logvermeldingen."
- nl, now: "Vóór het verzenden verwijdert weblion.one geheimen die het herkent, bijvoorbeeld wachtwoorden,
  API-sleutels en tokens. Uit logvermeldingen verwijdert het daarnaast IP- en e-mailadressen."

The terms are the same as in the rest of the notice:

- zum Beispiel: bijvoorbeeld
- Protokolleinträge: logvermeldingen
- zusätzlich: daarnaast

"die het herkent" goes with the next sentence, "Deze herkenning is automatisch".

## Allowlists

No changes. No check gave a false positive.

## Checks

| Check | Result |
|---|---|
| `I18N_REQUIRE_COMPLETE=nl pnpm --filter @weblion/shared test` | 589 passed |
| `I18N_REQUIRE_LEGAL=nl pnpm --filter @weblion/api exec vitest run test/i18n-stamps.test.ts` | 11 passed |
| `pnpm --filter @weblion/api i18n:report --locale nl` | 4,627 keys, 0 missing, 0 stale |
| `pnpm --filter @weblion/api i18n:stamp --check` | exit 0. nl: 16 files up to date, 0 stale. The stale keys it lists are fr and it, which belong to other units. |
| `pnpm typecheck` | passes |
| `pnpm exec prettier --check "packages/*/src/**/*.ts"` | all files formatted |
| pdf in Windows-1252 (script) | 44 of 44 values encodable (pdf.nl.ts unchanged) |
| Key order against German (script) | all 16 sections in German order |

## Terms not in the glossary

- Kündigung: opzegging
- zurücknehmen (cancellation): intrekken
- anteilig: naar rato
- Label-Schlüssel / Label-Wert: labelsleutel / labelwaarde
