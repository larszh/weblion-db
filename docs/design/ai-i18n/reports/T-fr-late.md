# Report T-fr-late: late French texts (fr-CH)

Unit T-fr-late brought French for Switzerland up to date after the build units. It added 25 missing keys, checked 9
stale ones, switched the draft invoice term to "brouillon de facture" and changed the byte units to KB, MB, GB and TB.
Branch `ai-i18n/late-fr` from `6eaee9d`, worktree `/home/user/wt/late-fr`. I ran `push-unit.sh T-fr-late` after every
commit; none reported CONFLICT.

| Commit | Content |
|---|---|
| `b2c29c7` | 25 missing keys, 8 stale keys confirmed, one sentence of the data notice, stamps |
| `eab07fa` | Glossary "brouillon de facture", 23 draft texts, allowlist comment, stamps |
| `ec4355f` | Byte units in 10 values, stamps |
| (this report) | `docs/design/ai-i18n/reports/T-fr-late.md` |

## Missing keys (25)

Each key is inserted at its German position. I read `billing/tables.tsx`, `seller-dialogs.tsx` and `seller-panel.tsx`
to see how each text of the scheduled cancellation is used.

| Key | fr |
|---|---|
| `aria.openMenu` | Ouvrir le menu |
| `aria.closeMenu` | Fermer le menu |
| `aria.labelKey` | Clé de l'étiquette |
| `aria.labelValue` | Valeur de l'étiquette |
| `aria.statusFilter` | Filtrer par statut |
| `admin.mail.template.ai_budget` | Budget IA |
| `admin.ai.usage.date` | Date |
| `admin.ai.errors.allFeatures` | Toutes les fonctions |
| `admin.ai.errors.allStatuses` | Tous les statuts |
| `admin.ai.errors.allSources` | Toutes les sources |
| `billing.service.cancelledPer` | Résilié pour le {date} |
| `billing.service.endWaitsForBilling` | Résilié pour le {date}, se termine dès que tout est facturé jusqu'à cette date |
| `billing.service.moduleOffAtEnd` | Le module "{module}" sera alors désactivé |
| `billing.service.moduleKept` | Le module reste actif tant que le client a encore un autre service avec ce module : {names}. |
| `billing.service.cancelledLater` | Service "{name}" résilié pour le {date} |
| `billing.service.endsAtLaterHint` | Avec une date ultérieure, le service continue jusqu'à ce jour-là, et un module choisi n'est désactivé qu'à ce moment-là. Chaque période qui commence au plus tard ce jour-là est facturée en entier, et non au prorata. |
| `billing.service.fullPeriod` | La période à partir du {date} est encore facturée en entier ({price}). |
| `billing.service.endBeforePeriod` | Résilier plutôt pour le {date} |
| `billing.service.changeCancel` | Modifier la résiliation |
| `billing.service.withdrawCancel` | Retirer la résiliation |
| `billing.service.withdrawCancelTitle` | Retirer la résiliation de "{name}"? |
| `billing.service.withdrawCancelText` | Le service continue ensuite sans date de fin et est facturé comme jusqu'à présent. |
| `billing.service.cancelWithdrawn` | Résiliation de "{name}" retirée |
| `billing.profile.localeOwnerPlain` | Langue du propriétaire |
| `billing.product.translations.nameRequired` | Saisissez un nom ou videz la description. |

New terms, in line with the existing French: Kündigung is "résiliation" (the verb was already "résilier"),
"gekündigt per {date}" is "résilié pour le {date}" (the usual Swiss wording for the date a cancellation takes effect),
"zurücknehmen" is "retirer" (as in "Invitation retirée"), "voll verrechnet, nicht anteilig" is "facturée en entier, et
non au prorata". "sperren" for a module stays "désactiver", as in `billing.service.deactivateModule`.

## Stale keys (9)

The German of eight keys changed only from "du" to "Sie". The French was already in the vous form and says the same
as the new German, so I confirmed each with `i18n:stamp --locale fr --confirm --key <key>` and changed no text:
`login.hero.text`, `invite.invalid.text`, `projects.delete.notEmpty`, `members.inviteLinkText`,
`admin.delete.moveHint`, `admin.delete.billingHint`, `admin.orgs.resellerNoModules`, `admin.orgs.moveMissing`.

`ai.notice.text`: one German sentence became two. I translated only that part again, by hand. Every other sentence of
the notice is unchanged, and the paragraphs and `\n\n` are as before.

- Before: "Avant l'envoi, weblion.one supprime automatiquement les secrets identifiables tels que les mots de passe,
  les clés API et les jetons, ainsi que les adresses IP et e-mail des entrées de journal."
- Now: "Avant l'envoi, weblion.one supprime les secrets qu'il détecte, par exemple les mots de passe, les clés API et
  les jetons. Dans les entrées de journal, il supprime en outre les adresses IP et e-mail."

"automatiquement" is gone because the new German dropped "automatisch" from this sentence; the next sentence ("Cette
détection est automatique") still says it. "qu'il détecte" matches that "détection". "jetons" stays for tokens as
secrets, as before. This also settles question 1 of R-fr: the German now says the reading the French already followed.

## Rechnungsentwurf: "brouillon de facture"

In `glossary.ts` only the French term changed, from "projet de facture" to "brouillon de facture". Every French value
about a draft invoice now uses "brouillon" (masculine like "projet", so no agreement changed):

`pdf.invoice.draftTitle`, `pdf.invoice.draftMark` (BROUILLON), `pdf.invoice.draftFilename`
(Brouillon-de-facture-{id}.pdf), `pdf.invoice.meta.draft`, `billing.status.draft`, `billing.filter.drafts`,
`billing.invoice.draftTitle`, `billing.invoice.draftHint`, `billing.doc.draft`, `billing.profile.currencyHint`,
`billing.editor.editTitle`, `billing.editor.saveDraft`, `billing.editor.created`, `billing.editor.saved`,
`billing.delete.title`, `billing.delete.text`, `billing.delete.done`, `billing.generate.finalizeHint`,
`billing.generate.done`, `billing.settings.autoFinalizeRecurringHint`, `billing.admin.drafts`,
`admin.orgs.moveBillingHint`, `admin.orgs.moveBlocker.invoices`.

`billing.filter.drafts` and `billing.admin.drafts` are now just "Brouillons", like the German "Entwürfe". R-fr added
"de facture" only to avoid confusion with server projects, and "Brouillons de facture" (21 characters) would break
check 5 for the 8-character German (limit 20). It also answers R-fr question 6 about these long labels. The other
values keep "de facture" where it stood. No French value says "projet" for a draft any more; every remaining "projet"
is a server project or the Hetzner project in `cloud`.

## Byte units

The console prints KB, MB, GB, TB in every language (`apps/web/src/lib/format.ts`, the size selects). I replaced "Go"
by "GB" in 10 values, with a no-break space (U+00A0) between a number or number placeholder and the unit:
`billing.product.descriptionHint`, `plans.diskTooSmallHint`, `plans.upgradeDisk`, `plans.upgradeDiskHint`,
`plans.confirmDisk`, `snapshots.hetznerHint` ("par GB", no number), `rescale.memory` and `rescale.disk` ("(GB)", no
number), `storage.quota.invalid`, `storage.quota.step`. There were no Ko, Mo or To. Left alone: `mail.units.invalid`
(already MB and GB, an example of what the user types, so it keeps ordinary spaces) and the JSON example "10 GB" in
`explorer.nextcloudBodyHint`. Note: before this unit no French value had a no-break space before a unit (only before
":" and "%"), so these 9 spaces are the first; on screen they look the same as the formatter's ordinary space.

## Allowlists

`allowlists/fr/a.ts`: the entry `pdf.invoice.draftFilename` (glossaryOk) is still needed, because the hyphenated file
name cannot contain "brouillon de facture" with spaces. I updated its comment. A script ran checks 3 to 6 and 11 on
every French value without allowlists: all 36 entries are still needed, and no new value needs one.

## Checks

| Check | Result |
|---|---|
| `I18N_REQUIRE_COMPLETE=fr pnpm --filter @weblion/shared test` | 9 files, 589 tests passed |
| `I18N_REQUIRE_LEGAL=fr pnpm --filter @weblion/api exec vitest run test/i18n-stamps.test.ts` | 11 passed (no database needed) |
| `pnpm --filter @weblion/api i18n:report --locale fr` | 4,627 keys, 0 missing, 0 stale |
| `pnpm --filter @weblion/api i18n:stamp --check` | exit 0, 64 files up to date (fr: 16 files, 0 stale; the 18 stale are other locales) |
| `pnpm typecheck` | shared, api and web pass |
| `pnpm exec prettier --check "packages/*/src/**/*.ts"` | all files pass |
| Windows-1252 script over `pdf.fr.ts` | 44 values, all encodable |

## For the integrator (files I do not own)

1. `docs/design/ai-i18n/i18n.md`, 19.3, the row Rechnungsentwurf still says "projet de facture"; it should say
   "brouillon de facture" like `glossary.ts`.
2. The term list in `reports/R-fr.md` ("Entwurf (invoice): projet", "GB, MB: Go, Mo in prose") is superseded by this
   report; R-fr questions 1, 4 and 5 are settled.
3. `billing.profile.localeOwnerPlain` is not used in `apps/web` at `6eaee9d` (only `localeOwner`); the French is
   ready when it is.
