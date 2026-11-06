# T-it-C report: Italian (it-CH), section group C

Unit T-it-C, branch `ai-i18n/t-it-c`, based on the foundation commit f0decba. Sections in the order of plan 7.4:
`billing`, `cloud`, `storage`, `phone`, `media`, `uptime`. Every section was translated from the German source
(formal address "Lei", Swiss Italian conventions of i18n 19.2), checked with `pnpm --filter @weblion/shared test`,
stamped with `i18n:stamp --locale it --section <s>`, formatted with prettier and committed on its own; a final
editorial pass over all six sections followed as its own commit. Every commit was saved with
`push-unit.sh T-it-C` (no conflicts).

## Keys per section

| Section | German keys | Italian keys | Missing | Order as German |
|---|---|---|---|---|
| billing | 456 | 456 | 0 | yes |
| cloud | 45 | 45 | 0 | yes |
| storage | 189 | 189 | 0 | yes |
| phone | 238 | 238 | 0 | yes |
| media | 429 | 429 | 0 | yes |
| uptime | 308 | 308 | 0 | yes |
| **total** | **1,665** | **1,665** | **0** | |

Files: `packages/shared/src/i18n/sections/{billing,cloud,storage,phone,media,uptime}.it.ts`,
`packages/shared/src/i18n/stamps/it/{billing,cloud,storage,phone,media,uptime}.json`,
`packages/shared/src/i18n/allowlists/it/c.ts`, this report. No other file was changed, no key was added, renamed
or deleted, and no change in a file of another unit is needed. Placeholders, `\n`, ellipses and en dashes match the
German per key (checked by script); no em dash, no sharp s, no typographic or angle quotes (German «» became
straight "..."). Prettier switches values with an apostrophe to double quotes, as in the other units' files.

## Allowlist entries (`allowlists/it/c.ts`, all `glossaryOk`, 28 keys)

Nothing needed `germanOk`, `informalOk`, `lengthOk` or `typographyOk`. Three near misses of check 6 were fixed in
the text instead ("occorre eliminare" for "Löschen Sie", so that "elimina" appears: `storage.limit.accounts`,
`storage.allowance.removeBlocked`, `media.limit.accounts`, and similar wording in `media.allowance.removeBlocked`,
`media.seerr.orphans`, `uptime.allowance.full`, `uptime.allowance.removeBlocked`; "Ogni utente è già membro" for
`phone.ringGroup.allMembers`).

| Keys | Reason |
|---|---|
| `billing.summary.openCount`, `billing.admin.count`, `billing.admin.zohoErrors` | "{n} Rechnung(en)" writes singular and plural at once; Italian uses the plural with the count as a label ("Fatture aperte: {n}"), and "fatture" does not contain the singular "fattura". |
| `billing.products.notReseller` | "nur für Reseller" is plural; "rivenditori" does not contain the singular "rivenditore" (same case as in groups A and B). |
| `providers.hetzner.tokenHint` | Menu path of the Hetzner Console, which has no Italian interface; the labels stay in English as the reader sees them ("API tokens", "Generate API token"), so "token API" cannot appear. |
| `media.devices.failed`, `media.requests.sessionHint` | "das Abmelden" is signing devices out of Jellyfin ("disconnessione", the action "Disconnetti tutti i dispositivi"); the glossary's "esci" is the console's own sign-out button. |
| `uptime.managementOff`, `uptime.managementError`, `uptime.noHistory`, `uptime.admin.subtitle`, `uptime.admin.syncManagementError`, `uptime.admin.instancesText`, `uptime.admin.management.ok`, `uptime.admin.management.error`, `uptime.admin.demoManagement`, `uptime.admin.signIn`, `uptime.admin.signInTitle`, `uptime.admin.signedIn`, `uptime.admin.signedInVersion`, `uptime.allowance.instanceHint`, `uptime.allowance.noManagedInstance`, `uptime.allowance.notManaged`, `providers.uptimekuma.management`, `providers.uptimekuma.managementHint`, `explorer.uptimekumaPath`, `explorer.uptimekumaBodyHint` (20) | "Verwaltung" here is the management sign-in of an Uptime Kuma instance (the console may create and change monitors there), "gestione" in Italian; the glossary's "amministrazione" is the weblion admin area (its note says so). Same reasoning as T-it-B's "gestione DNS". |
| `uptime.admin.signOut` | The button signs the Uptime Kuma instance out of management ("Disconnetti"); "Esci" would read as the user logging out of the console. |

## Terms chosen that are not in the glossary (German -> it)

Used the same way in all six sections. Where group A or B had already chosen a term, I took theirs (marked A or B).

| German | Italian | Note |
|---|---|---|
| Rechnungssteller | emittente (delle fatture) | A |
| abschliessen (invoice), Abschliessen | finalizzare, finalizzazione; button "Finalizza" | |
| stornieren, storniert | stornare, stornata; dialog title "Storno della fattura {number}" | A |
| Offener Betrag | importo dovuto | A |
| Fällig, überfällig | in scadenza, scaduta; column "Scadenza" | |
| Position (invoice line) | posizione | |
| Zahlungsfrist | termine di pagamento | |
| Zahlungsart | metodo di pagamento | |
| Zahlungsanbieter | fornitore del servizio di pagamento | |
| Buchung, buchen (credit) | registrazione, registrare | |
| gutschreiben, abziehen | accreditare, detrarre | |
| verrechnen (credit with invoices) | compensare | |
| buchen (a service), gebucht | acquistare, acquistato | |
| Korrektur, Rückerstattung | rettifica, rimborso | |
| einmalig | una tantum | |
| kündigen, gekündigt | disdire, disdetto; title "Disdetta di ..." | B |
| pausieren, fortsetzen | mettere in pausa, riprendere | |
| Preisliste | listino prezzi | |
| Nummernkreis | prefisso numerazione | |
| QR-Einzahlungsschein | polizza di versamento QR | the glossary has only QR-Rechnung |
| MWST-Satz, MWST-Nummer | aliquota IVA, numero IVA | |
| PLZ, Ort, Firma | NPA, località, azienda | Swiss Italian |
| Ablauf (billing settings group) | procedura | |
| Eingang (payments received) | incassi | |
| Owner | proprietario | A (B kept "Owner", see questions) |
| Anbieter | fornitore | A, B |
| freischalten / sperren (module) | attivare / disattivare | A |
| Admin-Bereich | area admin | |
| Server-Typ, Disk, Arbeitsspeicher, Standort, Image | tipo di server, disco, memoria RAM, ubicazione, immagine | disk, RAM, location from A |
| Energie (server power menu) | Alimentazione | A |
| Konto (Nextcloud) | account | A |
| Zugang (streaming) | accesso | glossary has Streaming-Zugang = accesso streaming |
| Login-Name | nome di login | storage and media alike; "nome di accesso" would clash with "accesso" (streaming account) |
| Benutzername, Anzeigename | nome utente, nome visualizzato | |
| Speicherkontingent | contingente di spazio | for the organization's allowance and for an account's quota, as the German |
| Streaming-Kontingent, Monitoring-Kontingent | contingente streaming, contingente di monitoraggio | |
| Speicher, Speicherplatz | spazio, spazio di archiviazione | |
| belegt, zugeteilt, frei | occupato, assegnato, libero | |
| Instanz | istanza | |
| übernehmen (users of an instance) | prendere in carico, presa in carico | B |
| Zugangsdaten | credenziali di accesso | A (B used "dati di accesso") |
| App-Passwort | password per app | |
| Ringgruppe | gruppo di squillo | A |
| Leitung (trunk) | linea | A |
| Durchwahl (DID) | numero diretto | |
| Telefonanbieter | operatore telefonico | |
| Ausgehende Rufnummer | numero in uscita | |
| Webclient | web client | |
| Fernseher, Fernseher verbinden | televisore, "Collega televisore" | televisore from A |
| anmelden (Jellyfin, Seerr), Anmeldung | effettuare il login, login | |
| Gerät angemeldet / abmelden | dispositivo collegato / disconnettere | |
| Bibliothek | libreria | A |
| Richtlinie (Jellyfin policy) | criteri | A |
| Anfragen (Seerr) | richieste | |
| Verlauf, Favoriten, Wiedergabe | cronologia, preferiti, riproduzione | |
| Qualität unterwegs | qualità in mobilità | |
| Sperre, gesperrt | blocco, bloccato | A |
| Statusseite | pagina di stato | |
| Prüfung, Prüfintervall | controllo, intervallo di controllo | |
| erreichbar, ausgefallen, Ausfall | raggiungibile, non raggiungibile, interruzione | |
| Wartung | manutenzione (status: "In manutenzione") | |
| Ziel (monitor) | destinazione | B |
| Herkunft | origine | |
| Keyword | parola chiave | |
| Wiederholungen (retries) | tentativi | |
| Verwaltung (Uptime Kuma management) | gestione; "für die Verwaltung anmelden" = collegare per la gestione, "abmelden" = disconnettere | |
| Sitzungstoken, Zwei-Faktor-Code | token di sessione, codice a due fattori | |
| Synchronisierung, abgleichen | sincronizzazione, sincronizzare | B |
| "Bitte ... eingeben" | "Inserisca ..." | A, B |
| "Leer lassen ..." | "Lasci vuoto ..." | A, B |
| z. B. | ad es. | B |

Buttons use the usual Italian short form ("Salva", "Crea", "Aggiungi", "Storna", "Disdici", "Metti in pausa",
"Riprendi"); confirm titles are infinitive questions where the German has a question mark ("Eliminare la bozza?");
running text addresses the reader with "Lei" (capitalized when it stands alone, clitics and possessives lowercase).

## Doubts and open questions for the owner and R-it

1. **Menu paths of third-party tools.** Hetzner Console has no Italian interface, so its path stays in English
   (`providers.hetzner.tokenHint`, allowlisted). The others are translated to what I believe the Italian interfaces
   show, not verified against the live tools: Nextcloud ("Impostazioni personali > Sicurezza > Dispositivi e sessioni >
   Crea nuova password per app", "Impostazioni di amministrazione > Impostazioni di base > Server di posta"), 3CX
   ("Integrazioni > API"), Seerr ("Impostazioni > Rete", "Impostazioni > Utenti", "Impostazioni > Generale > Chiave
   API"), Uptime Kuma ("Impostazioni > Chiavi API"), Jellyfin ("Dashboard > Chiavi API > Aggiungi"). "XAPI Access
   Enabled", "System Admin" and "Quick Connect" stay as in German. If staff use these tools in English or German, the
   original labels may be the better choice.
2. **Owner.** I followed T-it-A (`role.owner` = "Proprietario"): `uptime.noAccessText`, `billing.profile.localeOwner`,
   `billing.profile.emailHint`. T-it-B kept "Owner"; R-it should align the two groups.
3. **Zugangsdaten.** I used T-it-A's "credenziali di accesso" (phone); T-it-B used "dati di accesso".
4. **Example values** are kept unchanged (muster.3cx.ch, muster-ag, Anna Muster, https://anfragen.weblion.one,
   Cloud Server M), except where they are German words a reader would type or read as Italian: "La sua azienda Sagl"
   for "Ihre Firma GmbH", "soggiorno" for the room name "wohnzimmer", "-codice" for "-code", and `<tipo>`,
   `<evento>` for `<art>`, `<Ereignis>` in the Uptime Kuma explorer path (English translates them too). T-it-B
   localized more examples; R-it may unify. `https://anfragen.weblion.one` might be a real host, so it stays.
5. **Credit booking type.** `billing.creditType.topup` ("Gutschrift") is "Nota di credito" per the glossary,
   although for a top-up booking "Accredito" would be more natural in Italian.
6. **Status words of Uptime Kuma.** "Raggiungibile" / "Non raggiungibile" follow the German "Erreichbar" /
   "Ausgefallen"; Uptime Kuma's own Italian interface says "Attivo" / "Inattivo".
7. **Percent sign.** "20 %" keeps the space of the German, as in group A.
8. **Glossary suggestions (not my file).** The entries "Verwaltung" and "Abmelden" catch other senses (management
   of a tool, signing devices out); a note on each would keep Mass Translate from forcing "amministrazione" and
   "esci" there. Check 6 also cannot see "Rechnung(en)" and plural "Reseller", which is why most entries above exist.

## Checks run

| Check | Result |
|---|---|
| `pnpm --filter @weblion/shared test` after every section and at the end | 587 passed, 2 skipped, 0 failed |
| `I18N_REQUIRE_COMPLETE=it pnpm --filter @weblion/shared test` | fails only on `core` (check 9) and the legal keys (check 10), both group A and empty in this worktree; script check: 0 missing, 0 extra, German order in all six group C sections |
| `pnpm --filter @weblion/api exec vitest run test/i18n-stamps.test.ts` | 10 passed, 1 skipped (no database needed) |
| `pnpm --filter @weblion/api i18n:stamp --locale it --check` (final) | 16 files up to date, 0 stale |
| `pnpm typecheck` | clean (shared, api, web) |
| `pnpm exec prettier --check "packages/*/src/**/*.ts"` | all files formatted |
| Placeholders, `\n`, en dashes, ellipses per key against German (script) | equal in all six sections |
| `pnpm --filter @weblion/api i18n:report` | not used: a stub at this commit (prints "not implemented") |
