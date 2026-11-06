# R-it report: Italian (it-CH), review of the whole language

Italian for Switzerland is complete: 4,602 keys in 16 sections, none missing, in German key order. I merged the three group branches, read every section against the German and fixed the problems in place. All required checks pass. Every commit is saved on `claude/nice-mendel-eiwx53` with `push-unit.sh R-it`, and none reported a CONFLICT.

Branch `ai-i18n/t-it` (from f0decba), worktree `/home/user/wt/t-it`. Commits:

1. Three `--no-ff` merges of `ai-i18n/t-it-a`, `-b` and `-c`. All three branches were present and there were no conflicts.
2. `R-it: Begriffe der drei Gruppen vereinheitlicht`: one term per German term, lowercase pronouns, the legal notice and the session sign-out.
3. `R-it: Formulierungen geschliffen`: small wording fixes.
4. `R-it: Stempel der italienischen Übersetzung nachgeführt`: `i18n:stamp --locale it`.
5. This report.

## Keys per section

| Section | German | Italian | Missing | Extra | German order |
|---|---|---|---|---|---|
| core | 857 | 857 | 0 | 0 | yes |
| email | 54 | 54 | 0 | 0 | yes |
| pdf | 44 | 44 | 0 | 0 | yes |
| ai | 307 | 307 | 0 | 0 | yes |
| translations | 191 | 191 | 0 | 0 | yes |
| admin | 231 | 231 | 0 | 0 | yes |
| hosting | 320 | 320 | 0 | 0 | yes |
| cloudflare | 165 | 165 | 0 | 0 | yes |
| websites | 379 | 379 | 0 | 0 | yes |
| mail | 389 | 389 | 0 | 0 | yes |
| billing | 456 | 456 | 0 | 0 | yes |
| cloud | 45 | 45 | 0 | 0 | yes |
| storage | 189 | 189 | 0 | 0 | yes |
| phone | 238 | 238 | 0 | 0 | yes |
| media | 429 | 429 | 0 | 0 | yes |
| uptime | 308 | 308 | 0 | 0 | yes |
| **total** | **4,602** | **4,602** | **0** | **0** | |

## What I changed in the review

56 values changed. They fall into these groups.

**One term across the groups.** The group reports chose different words for the same German term. Each conflict is now decided once and applied everywhere:

| German | Before | Now | Examples |
|---|---|---|---|
| Owner (role) | "Owner" in B | proprietario | `hosting.notFound.text`, `mail.dns.noPermission`, `hosting.dnsZone.otherOrg`: "si rivolga all'Owner" -> "al proprietario" |
| Zugangsdaten | "dati di accesso" in B | credenziali di accesso | `hosting.creds.*`, `websites.creds.*`, `websites.detail.credentialsPending*`, `websites.list.credentialsPending` |
| weblion-Mitarbeiter, Plattform-Mitarbeitende | "personale" in B | collaboratori | `hosting.moduleOff.staff`: "fa parte dei collaboratori di weblion"; also `hosting.renewal.text`, `websites.admin.noAllowanceCheck` |
| Hostname | "hostname" in A, "nome host" in B and C | nome host | `network.hostname`, `network.rdnsText`, `settings.nameText`, `inventory.nameHint` |
| Speicher (webspace, website) | "spazio disco" in B | spazio su disco (as `overview.disk`) | `hosting.res.storage`, `websites.usage.title` |
| Webhosting (module name) | "Web hosting" quoted in B | Hosting web (as `nav.webhosting`) | `hosting.admin.assignTextWebspace`, `websites.allowance.enableModuleHint`, `websites.reseller.enablesModule` |
| übernehmen (sites, users) | "acquisire" in A | prendere in carico | `perm.platform:website:write`, `perm.platform:media:write` |
| Auth-Code | "codice auth" in A | codice Auth | `perm.domain:authcode` |
| Streaming-Kontingent | "contingenti di streaming" in A | contingente streaming | `perm.platform:media:write` |
| Bestand | "inventario" in one B text | dotazione | `websites.reseller.removeBlocked` |
| "Zur ..." links | "Alla ..." in A | "Vai a ..." | `nav.backToConsole`: "Vai alla console"; `admin.dash.backToReseller` |
| "Das lässt sich nicht rückgängig machen." | "L'operazione è irreversibile." in 5 C texts | "L'operazione non può essere annullata." | `billing.void.text`, `plans.confirmDisk`, `storage.deleteWarning`, `media.deleteWarning`, `uptime.delete.text` |
| dashboard (gender) | "il dashboard" in B, "la dashboard" in C | la dashboard | 3 texts in `cloudflare` |
| Zuletzt aktualisiert (usage) | two wordings | "Ultimo aggiornamento dell'utilizzo {when}" | `storage.lastSync` now matches `mail.lastSync` |

**Quoted labels must match the real label.** `hosting.dns.noPermission` quoted "Modificare i record DNS", but the permission label is "Modificare record DNS"; the quote now matches it. The quotes of "Domini e DNS", "E-mail" and the CDN permission already matched; "Hosting web" is fixed above.

**Formal address (rule 1).** Three courtesy pronouns were capitalized in mid-sentence; they are now lowercase. Examples:
- `billing.services.customerText`: "Ciò che Le viene fatturato" -> "le viene"
- `billing.return.slowText`: "non Le verrà addebitato" -> "le"
- `phone.none.textReseller`: "{reseller} Le assegnerà" -> "le"

A scan finds no other mid-sentence capital pronoun or possessive, no lowercase standalone "lei" and no informal imperative in running text.

**Clearer wording:**
- `account.sessions.revoke` ("Abmelden" on a session row) was "Esci". It is now "Disconnetti", because the button signs a device out, not the reader. Media and uptime use the same word for devices and the Uptime Kuma management. This needed a glossary allowlist entry.
- `mail.alias.external` was "{n} destinazione/i al di fuori...". It is now "Destinazioni al di fuori di questo dominio: {n}. Le e-mail vengono inoltrate lì.", the same count-label form C used for "Rechnung(en)".
- `admin.reseller.notReseller` was "Solo per account rivenditore". It is now "Solo per i rivenditori", like `billing.products.notReseller`; this also needed an allowlist entry.
- `admin.i18n.check.formality` was "Sembra una forma di indirizzo informale", a calque. It is now "Sembra scritto in forma confidenziale."; `admin.i18n.style.hint` changed the same way ("sulla forma di cortesia").
- `media.login.privacy` and `media.name.hint` translated "Räume" as "locali" (premises). It is now "stanze" (rooms).
- `hosting.zone.pausedText` used "ormai" for "nur noch"; it now uses "ora".
- `mail.admin.chooseInstance` is now "Seleziona un'istanza…", like the other pickers.
- `admin.ai.limits.warn` is now "Avviso da (%)"; it was "Avviso a partire da (%)".
- `billing.doc.dueDate` is now "Pagabile entro il", the same as `email.invoice.dueDate`.

**Legal notice (`ai.notice.title`, `ai.notice.text`).** I checked it sentence by sentence against the German: all 6 paragraphs and 14 sentences are there, nothing is shortened or added, and the menu path "Impostazioni > Funzioni IA" matches the real labels.

One sentence changed. "Ihren eigenen Namen erhält die KI nicht, nur Ihre Rolle" was "l'IA non riceve il suo nome, ma solo il suo ruolo". With "l'IA" as the subject, "il suo nome" can be read as the AI's own name, and the contrast of "eigenen" was lost. It now reads "il suo nome, invece, non viene trasmesso all'IA, ma solo il suo ruolo." See question 1 below.

The title "Informativa sulla privacy relativa alle funzioni IA" was already correct.

**Checked and left unchanged:**
- Placeholders and `\n` (check 2).
- Ellipses, straight quotes, parentheses, en dashes and closing punctuation: all match the German key by key (a script, with only abbreviations such as "Min." differing).
- No em dash, no sharp s, no typographic or angle quotes.
- No German words left in the values.
- The letter style of `email` ("Buongiorno" / "Cordiali saluti").
- `pdf.invoice.draftMark` is in capitals ("BOZZA").
- `pdf.*` uses only Windows-1252 characters.
- Sentence case. Capitalized words in mid-text are names or menu paths.

## Final term decisions not in the glossary (German -> it)

These are binding for later work, for example by the integrator for late keys. The decided conflicts are in the table above.

| Area | German -> Italian |
|---|---|
| Roles | Owner -> Proprietario; Admin -> Admin; Member -> Membro; Eingeschränkt -> Limitato; Nur lesen -> Sola lettura; Buchhaltung -> Contabilità |
| People, accounts | Benutzer -> utente; Konto -> account; Mitarbeitende (weblion) -> collaboratori; Anbieter (reseller or DNS host) -> fornitore; Provider -> provider; Inhaber (registrant) -> titolare; Login-Name -> nome di login; Benutzername -> nome utente; Anzeigename -> nome visualizzato |
| Access | Zugangsdaten -> credenziali di accesso; Zugang (streaming) -> accesso; Abruf (of a secret) -> consultazione; App-Passwort -> password per app; Sitzungstoken -> token di sessione; Zwei-Faktor-Code -> codice a due fattori |
| Sign-in | Anmelden (console) -> accedi / accesso; anmelden (Jellyfin, Seerr) -> effettuare il login; Abmelden (console button) -> Esci; abmelden (device, session row, Uptime Kuma management) -> disconnettere / Disconnetti |
| Switching | freischalten (module) -> attivare; sperren (module) -> disattivare; sperren / entsperren (customer) -> sospendere / riattivare ("Sospeso"); sperren / entsperren (streaming account, login) -> bloccare / sbloccare; freigeben (resource back to the pool) -> rilasciare; freigeben (Node.js for customers) -> abilitare; übernehmen (sites, users) -> prendere in carico; Bestand -> dotazione |
| Infrastructure | Standort (data center) -> ubicazione; Standort (office, phone system name) -> sede; Arbeitsspeicher -> memoria RAM; Disk / Festplatte -> disco; Speicher (server, webspace, website) -> spazio su disco; Speicher (mail quota, Nextcloud) -> spazio; Labels -> etichette; Energie -> Alimentazione; Instanz -> istanza; Hostname -> nome host; Sicherung -> backup; Gefahrenzone -> zona di pericolo |
| Policies | Access Policies (plural) -> policy di accesso; Richtlinie (Jellyfin) -> criteri; Richtlinie (DMARC) -> Policy |
| DNS, domains | Zone -> zona; Eintrag (DNS) -> record; Registrar / Registry -> registrar / registro; Transfersperre -> blocco del trasferimento; Auth-Code -> codice Auth; Verlängerung -> rinnovo; Ablaufdatum -> data di scadenza; Weiterleitung (web address, HTTP) -> reindirizzamento; DNS-Verwaltung -> gestione DNS; DNS-Umzug -> migrazione del DNS; Einträge übernehmen -> importare i record; Tarif (Cloudflare) -> piano; Ziel -> destinazione |
| Websites, mail | Website-Kontingent -> contingente di siti web; Vorlage -> modello; Anwendung -> applicazione; Art -> tipo; Laufzeit -> Runtime; Home-/Web-Verzeichnis -> directory home / directory web; E-Mail-Domain -> dominio e-mail; Mailserver -> server di posta; Mailprogramm -> programma e-mail; Versandlimit -> limite di invio; Papierkorb -> cestino; Spamfilter -> filtro antispam; Selektor -> selettore |
| Billing | Rechnungssteller -> emittente (delle fatture); abschliessen (invoice) -> finalizzare / "Finalizza"; stornieren -> stornare / "Storna"; Offener Betrag -> importo dovuto; fällig / überfällig -> in scadenza / scaduta; Position -> posizione; Buchung, buchen (credit) -> registrazione, registrare; buchen (service) -> acquistare; kündigen -> disdire / "Disdici"; Korrektur -> rettifica; Rückerstattung -> rimborso; einmalig -> una tantum; Vermerk -> causale; Zahlungsfrist / Zahlungsart -> termine / metodo di pagamento; Preisliste -> listino prezzi; Nummernkreis -> prefisso numerazione; QR-Einzahlungsschein -> polizza di versamento QR; MWST-Satz / MWST-Nummer -> aliquota IVA / numero IVA; PLZ / Ort -> NPA / località; AGB -> CG; Auftragsverarbeitungsvertrag -> contratto per il trattamento dei dati; Unterauftragsverarbeiter -> sub-responsabile del trattamento |
| Phone | Ringgruppe -> gruppo di squillo; Leitung -> linea; Durchwahl -> numero diretto; Ausgehende Rufnummer -> numero in uscita; Telefonanbieter -> operatore telefonico; Webclient -> web client |
| Streaming | Streaming-Kontingent -> contingente streaming; Fernseher (verbinden) -> televisore ("Collega televisore"); Bibliothek -> libreria; Anfragen (Seerr) -> richieste; Verlauf -> cronologia; Qualität unterwegs -> qualità in mobilità |
| Monitoring | Monitoring -> monitoraggio; Statusseite -> pagina di stato; Prüfung / Prüfintervall -> controllo / intervallo di controllo; erreichbar / ausgefallen / Ausfall -> raggiungibile / non raggiungibile / interruzione; Wartung -> manutenzione; Verwaltung (Uptime Kuma) -> gestione |
| AI, translations | KI-Auftrag -> incarico IA; Paket (batch) -> pacchetto; Rechtstext -> testo legale; Platzhalter -> segnaposto; Stilhinweise -> note di stile; Veraltet -> obsoleto; ungeprüft / geprüft -> non verificato / verificato; Aufräumen -> Pulizia (title) / Ripulisci (button) |
| UI patterns | Synchronisation / Abgleich -> sincronizzazione; Schalter -> interruttore; "Zur/Zum ..." -> "Vai a ..."; "Zurück zu ..." -> "Torna a ..."; "Bitte ... eingeben" -> "Inserisca ..."; "Leer lassen ..." -> "Lasci vuoto ..."; "z. B." -> "ad es."; buttons in the short form ("Salva", "Crea"); confirm titles as an infinitive question ("Eliminare la bozza?"); "Das lässt sich nicht rückgängig machen." -> "L'operazione non può essere annullata." |

Grammatical gender: weblion.one is masculine ("weblion.one stesso"), Anthropic and IA are feminine, la dashboard, la CDN, il registrar.

## Allowlist entries that remain

All entries are `glossaryOk`; no other check needs one. A script confirmed that every entry is still needed, so none could be removed. I added two.

| File | Keys | Reason |
|---|---|---|
| `a.ts` | `admin.stat.orgsSub`, `admin.orgs.subtitle`, `admin.reseller.notReseller` (new) | "Reseller" is plural here. The Italian plural "rivenditori" does not contain the singular "rivenditore". |
| `a.ts` | `pdf.invoice.draftFilename` | A file name, "Bozza-fattura-{id}.pdf": its words are joined by hyphens, so "bozza di fattura" with spaces cannot appear. |
| `a.ts` | `ai.assistant.sessionHint` | "beim Abmelden" is rendered with the verb "quando esce dall'account". The glossary's "esci" is the button label. |
| `a.ts` | `ai.org.declineConfirm.action` | A button: Italian uses the short form "Rifiuta" (rule 3), not the glossary infinitive "rifiutare". |
| `a.ts` | `account.sessions.revoke` (new) | It signs a device out of the session list, so "Disconnetti", not the console's "Esci". |
| `b.ts` | `hosting.dns.typeLabel.HTTP_REDIRECT`, `hosting.dns.typeLabel.HTTP_FRAME` | A web-address "Weiterleitung" is a redirect, "reindirizzamento". The glossary's "inoltro" is e-mail forwarding. |
| `b.ts` | `hosting.admin.groupDirect`, and from `c.ts` `billing.products.notReseller` | Plural "Reseller", as above. |
| `b.ts` | 16 keys `websites.list.noAllowance*`, `websites.allowance.*`, `websites.reseller.none`, `.noPool`, `websites.errors.no_allowance` | "Website-Kontingent" is an allowance of websites (plural). "contingente di siti web" does not contain the singular "sito web". |
| `b.ts` | `mail.dns.toZone`, `mail.dns.explain.conflicts` | "DNS-Verwaltung" is "gestione DNS". The glossary's "amministrazione" means the weblion admin area. |
| `c.ts` | `billing.summary.openCount`, `billing.admin.count`, `billing.admin.zohoErrors` | "Rechnung(en)" is rendered as a plural count label ("Fatture aperte: {n}"), so the singular "fattura" cannot appear. |
| `c.ts` | `providers.hetzner.tokenHint` | A menu path of the Hetzner Console, which has no Italian interface. The English labels stay, so "token API" cannot appear. |
| `c.ts` | `media.devices.failed`, `media.requests.sessionHint` | "Abmelden" of Jellyfin devices is "disconnessione", not "esci". |
| `c.ts` | 20 `uptime.*`, `providers.uptimekuma.*` and `explorer.uptimekuma*` keys | "Verwaltung" is the management sign-in of an Uptime Kuma instance, "gestione", not the weblion admin area. |
| `c.ts` | `uptime.admin.signOut` | Signs the Uptime Kuma instance out of management, "Disconnetti". |

That makes 56 entries: 7 in `a.ts`, 21 in `b.ts` and 28 in `c.ts`.

## Open questions for the owner

1. **Legal notice: please confirm before go-live.**
   - **(a) Scope of "aus Protokolleinträgen".** It is unclear whether it applies to all the secrets or only to the IP and e-mail addresses. The Italian "... nonché indirizzi IP ed e-mail dalle voci di registro" keeps the same ambiguity, as T-it-A noted.
   - **(b) "automatisch erkennbare Geheimnisse".** The German can be read two ways: "automatically removes recognisable secrets" or "removes automatically recognisable secrets". The Italian follows the English reading, "rimuove automaticamente segreti riconoscibili". If the second reading is meant, it becomes "segreti riconoscibili automaticamente".
   - **(c) "Ihren eigenen Namen".** It is now in the passive with "invece", to keep the contrast of "eigenen" and avoid reading "il suo nome" as the AI's name.
   - **(d) Terms.** "Unterauftragsverarbeiter" is "sub-responsabile del trattamento", the usual GDPR Italian term; please confirm with legal counsel for the Swiss DPA. "Auftragsverarbeitungsvertrag" is "contratto per il trattamento dei dati".
2. **Percent sign.** "{percent} %" and "100 %" keep the space, as in the German, as Swiss usage allows. Italian texts often write "100%"; this is easy to change.
3. **Greeting.** "Bentornato" on the login page is the generic masculine, as most Italian login pages use.
4. **Menu paths in other tools are not checked against the live tools:** Cloudflare, Mailcow, Nextcloud, 3CX, Seerr, Uptime Kuma, Jellyfin. The Hetzner path stays in English.
5. **Example values.**
   - Translated where they are words the reader reads: "destinazione.example.ch", "ricezione@example.ch", "nome.cognome", "shop.esempio.ch", "cliente.ch", "Esempio SA", "La sua azienda Sagl", "soggiorno", "-codice", "<tipo>/<evento>".
   - Kept as names and URLs: Anna Muster, muster-ag, https://muster.3cx.ch, https://anfragen.weblion.one, Cloud Server M.
   - "ricezione@example.ch" is an e-mail address the German does not have. The English does the same with reception@, but the content rule of Mass Translate would flag it. If you prefer the German examples unchanged, that is a small edit.
6. **Glossary changes I suggest** (not my file).
   - `billing.creditType.topup` ("Gutschrift") must be "Nota di credito" by the glossary; "Accredito" would read better for a credit booking.
   - Notes on "Weiterleitung" (e-mail only), "Verwaltung" (weblion admin only) and "Abmelden" (the console's own sign-out) would remove most allowlist entries.
   - Check 6 cannot recognise German plurals ("Reseller", "Rechnung(en)", "Website-Kontingent").
7. **Uptime statuses.** "Raggiungibile" / "Non raggiungibile" follow the German; Uptime Kuma's own Italian interface uses other words.
8. **Short forms chosen for the length limit.** "Runtime" for "Laufzeit" (`websites.runtime.title`) and "registro" for Registry are kept as the groups chose them.

No file owned by another unit needs a change. No key was added, renamed or deleted.

## Checks run

| Check | Result |
|---|---|
| `I18N_REQUIRE_COMPLETE=it pnpm --filter @weblion/shared test` | 589 passed, including check 9 (completeness) and check 10 (legal keys) for it |
| `I18N_REQUIRE_LEGAL=it pnpm --filter @weblion/api exec vitest run test/i18n-stamps.test.ts` | 11 passed; no database needed, so no wl_rit_1 was created |
| `pnpm --filter @weblion/api i18n:stamp --locale it` | 14 files written (56 updated stamps), 0 stale |
| `pnpm --filter @weblion/api i18n:stamp --locale it --check` | 16 files up to date, 0 stale |
| `pnpm typecheck` | clean (shared, api, web) |
| `pnpm exec prettier --check "packages/*/src/**/*.ts"` | all files formatted |
| Key set and order against German (script) | 4,602 keys, 0 missing, 0 extra, German order in all 16 sections |
| Punctuation per key against German (script: ellipses, quotes, parentheses, en dashes, closing mark) | equal, apart from German abbreviations |
| `pdf.*` encodable in Windows-1252 (script) | 0 characters outside Windows-1252 |
| Allowlist entries still needed (script with the check predicates) | all 56 needed |
| `push-unit.sh R-it` after every commit | saved, no CONFLICT |
| `i18n:report` | not used; it is still a stub at this commit |

Files are in `/home/user/wt/t-it/packages/shared/src/i18n/`:
- `sections/*.it.ts` (16 files)
- `stamps/it/*.json` (16 files)
- `allowlists/it/{a,b,c}.ts`
- this report, `/home/user/wt/t-it/docs/design/ai-i18n/reports/R-it.md`
