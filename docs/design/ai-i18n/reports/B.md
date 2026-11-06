# Bericht Einheit B: drei Fehler behoben

Branch `ai-i18n/bugs`, Basis `f0decba`. Die Commits bis `f8717e2` sind mit `push-unit.sh B` auf dem
Arbeitsbranch gesichert. Ab `8bf92ef` meldet das Skript CONFLICT in
`apps/web/src/pages/billing/seller-dialogs.tsx` (siehe "Review", Abschnitt CONFLICT); diese Commits
liegen nur lokal.

## Commits

| SHA | Titel |
|---|---|
| `209e92b` | B: Suche maskiert % und _ statt sie zu entfernen |
| `a044f34` | B: TRUST_PROXY vertraut standardmässig nur loopback |
| `8c7d8fa` | B: Kündigung auf Termin läuft bis zum Enddatum |
| `e200009` | B: Vorgemerkte Kündigung anzeigen, ändern und zurücknehmen |
| `3d43c41` | B: Telefonie-Test sucht % wörtlich |
| `ee13dd9` | B: Bericht der Fehlerbehebung |
| `a74f36c` | B: Modul bleibt, solange ein anderer Dienst es nutzt |
| `f8717e2` | B: Kündigung nach dem Enddatum nicht mehr änderbar |
| `8bf92ef` | B: Kündigungsdialog warnt vor einer voll verrechneten Periode |
| `3600f2f` | B: TRUST_PROXY lehnt Bereiche ab, die Fastify nicht baut |
| `7a084da` | B: Docker Compose vertraut nur dem eigenen Netz |
| (dieser) | B: Befunde der Durchsicht im Bericht |

## Fehler 2: Suche entfernte `%` und `_`

- Neu `apps/api/src/lib/like.ts`: `escapeLike()` maskiert Backslash, `%` und `_` in einem Durchgang mit
  dem Backslash (Standard-Escape von Postgres bei LIKE/ILIKE, der Wert ist ein gebundener Parameter, kein
  `ESCAPE` nötig), dazu `containsPattern(q)` (`%q%`) und `prefixPattern(q)` (`q%`).
- `audit/routes.ts`: Aktionsfilter mit `prefixPattern`, Suche `q` über actorName, action und ip mit
  `containsPattern`.
- Dieselbe Lücke an allen anderen Stellen, alle auf den Helfer umgestellt:
  - `admin/routes.ts`: Serversuche (name, externalId, `ips::text`), Kundensuche (name, slug),
    Benutzersuche (email, name)
  - `servers/routes.ts`: Serversuche (name, `ips::text`)
  - `billing/routes.ts`: Rechnungssuche (number, Name des Kunden)
  - lokale `like()`-Helfer entfernt in `monitoring/routes.ts`, `mail/routes.ts` (2 Listen),
    `media/routes.ts` (strich auch den Backslash), `hosting/routes.ts` (4 Listen), `cloud/routes.ts`,
    `phone/routes.ts`
  - geprüft und unverändert: `reseller/service.ts` `uniqueSlug` (`%@<slug>`, Slug nur `[a-z0-9-]`) und
    `media/service.ts` `mediaAccountCodeFree` (`%-<code>`, Code nur `[a-z]{3,12}`), beide ohne
    Benutzereingabe mit Platzhaltern.
- `phone.test.ts` erwartete, dass `?q=%` alle Anlagen findet (Folge des Entfernens). Jetzt `[]`, weil kein
  Name und kein Host ein `%` enthält (eigener Commit `3d43c41`, im ersten vollen Lauf aufgefallen).
- Tests (`api.test.ts`, "searches the audit log for % and _ literally"): `q=like_test.org_switch` und
  `action=like_test.org_` finden nur `org_switch`, nicht `orgXswitch`; `q=%` und `q=_` treffen nur Einträge
  mit dem Zeichen und weniger als alle; `100%` findet genau den Eintrag; ein Backslash (auch am Ende)
  bricht die Abfrage nicht und wird wörtlich gesucht.

## Fehler 3: TRUST_PROXY

- `config/env.ts`: `parseTrustProxy()` liest `true`/`yes`/`on` und `false`/`no`/`off` wie bisher, eine
  ganze Zahl als Anzahl Hops (`0` = false) oder eine Komma-Liste aus IP-Adressen, CIDR-Bereichen (auch
  IPv4-Netzmaske) und `loopback`, `linklocal`, `uniquelocal`. Leer oder nicht gesetzt: `['loopback']`.
  Ungültige Einträge brechen den Start mit einer Meldung zu `TRUST_PROXY` ab.
- Fastify 5.12.5 (`lib/request.js`, `getTrustProxyFn`): ein String wird an Kommas geteilt und mit
  proxy-addr kompiliert, ein Array ebenso, **eine Zahl vertraut seit dieser Version keinem Proxy mehr**
  (fail closed, laut Doku weil eine reine Hop-Zahl die direkte Gegenstelle nicht prüft). Deshalb übergibt
  `fastifyTrustProxy()` eine Zahl als Vertrauensfunktion `(addr, hop) => hop < n` (die Semantik von
  proxy-addr), Listen als Array, Booleans unverändert. `app.ts` nutzt `fastifyTrustProxy(env.TRUST_PROXY)`
  und warnt beim Start im Log bei `true` oder einer Zahl.
- `docker-compose.yml`: setzt `TRUST_PROXY: '${TRUST_PROXY:-loopback,uniquelocal}'`. Kein Proxy-Container
  in der Datei, aber der Reverse Proxy auf dem Host erreicht den Container über das Docker-Gateway
  (private Adresse), nicht über loopback; ohne die Zeile sähe die Console nur `172.x.0.1` und alle
  Nutzer teilten sich die Login-Sperre. Ein Wert in der `.env` gewinnt (mit `docker compose config`
  geprüft). Das Dockerfile bleibt unverändert. PM2 (Variante B) läuft mit `HOST=127.0.0.1` hinter nginx
  auf demselben Host, dort passt der Standard.
- Dokumentiert in `.env.example` (neuer Block nach `LOG_LEVEL`) und `docs/deployment.md` (neuer
  Abschnitt "Client-IP hinter dem Proxy (`TRUST_PROXY`)").
- Tests: `apps/api/src/config/env.test.ts` (neu, es gab keinen Test der Env-Parser): leer/nicht gesetzt,
  true/false, `2`, `1`, `0`, `10.0.0.0/8,127.0.0.1`, Namen, ungültige Werte; `inject()` mit dem Standard:
  Gegenstelle `203.0.113.9` plus `X-Forwarded-For` ergibt die Gegenstelle, `127.0.0.1` und `::1` ergeben
  die weitergeleitete Adresse, ein vorgetäuschter Eintrag davor zählt nicht; Liste, true, false und
  Hop-Zahlen. Dazu in `api.test.ts` gegen die ganze App: ein fehlgeschlagener Login schreibt die richtige
  IP ins Audit-Protokoll.

## Fehler 1: Kündigung auf Termin

### API

- Migration `apps/api/drizzle/0012_scheduled_cancellation.sql` (mit `drizzle-kit generate --name`, nur
  additiv): `ALTER TABLE "services" ADD COLUMN "deactivate_module_at_end" boolean DEFAULT false NOT NULL;`
  Schema `services.deactivateModuleAtEnd`.
- `POST /services/:id/cancel` (gleiche Berechtigung wie bisher, `loadServiceAsSeller`, jetzt unter
  `lockOrgBilling` wie der PATCH):
  - ohne `endsAt` oder `endsAt <= todayZurich()`: wie bisher (Status `cancelled`, `nextBillingAt` null,
    `endsAt` = Datum oder heute, Modul sofort aus, falls gewählt).
  - `endsAt > heute`: `cancelledAt` = jetzt, `endsAt` = Datum, `deactivateModuleAtEnd` = Wahl; Status und
    `nextBillingAt` bleiben.
  - nochmals aufgerufen auf einer vorgemerkten Kündigung: neues Datum und neue Modulwahl (`cancelledAt`
    wieder jetzt); mit heute oder früher endet der Dienst sofort. Auf einem beendeten Dienst 409.
  - Audit `service.cancel` mit `details: { endsAt, scheduled, moduleDeactivated, moduleDeactivatedAtEnd?,
    previousEndsAt? }`.
- Neu `POST /services/:id/cancel/withdraw` (gleiche Berechtigung): löscht `cancelledAt`, `endsAt`,
  `deactivateModuleAtEnd`. 409 bei beendetem Dienst, ohne vorgemerkte Kündigung oder wenn das Enddatum
  schon vorbei ist (der Dienst wartet dann nur noch auf den Job). Audit `service.cancel_withdraw` mit
  `details: { endsAt }` (das zurückgenommene Datum).
- `recurring.ts`: fällig ist nur noch, wessen `nextBillingAt <= endsAt` ist (`dueUntil`, auch für die
  Kundenauswahl des Jobs). Nach der letzten Periode bis zum Enddatum bleibt `nextBillingAt` auf der
  Periode danach stehen statt auf null. Grund: Nach dem Zurücknehmen geht die Abrechnung dort weiter, und
  das Löschen eines Entwurfs setzt das Datum weiterhin korrekt zurück (`deleteDraftInTx` vergleicht mit
  `nextBillingDate(last)`). Die letzte Periode endet im Text am Enddatum (wie bisher, voller Preis).
- Neu `billing/service-end.ts`: `deactivateModule` (aus der Route verschoben), `endDueServices(ctx, today)`
  als Tagesschritt: Dienste mit Status `active` oder `suspended` und `endsAt < today` werden `cancelled`,
  `nextBillingAt` null, Modul aus, falls gewählt; je Dienst in einer Transaktion unter `lockOrgBilling`.
  Ein aktiver Dienst mit `nextBillingAt <= endsAt` (noch offene Periode) bleibt aktiv. Audit
  `service.end` mit `req = null`, `actorName: 'Abrechnungsjob'` (wie `invoice.generate` des Jobs),
  `details: { endsAt, moduleDeactivated }`.
- `BillingJob`: `tick()` rechnet zuerst ab (`runDue`), dann `endDue`, beides unter dem Job-Lock, je
  einmal pro Tag. Der Endschritt merkt sich seinen Tag unter dem eigenen Schlüssel `billing_end_job`.
- Automatische Abrechnung abschalten: in `getBillingSettings` gibt es keinen Schalter
  (`autoFinalizeRecurring` wählt nur Entwurf oder abgeschlossen). Abschalten geht nur mit
  `BILLING_JOB_ENABLED=false`, das bisher den ganzen Job nicht startete. Jetzt startet `index.ts` den Job
  immer mit `{ invoicing: env.BILLING_JOB_ENABLED }`; ohne Abrechnung läuft nur der Endschritt, und ein
  aktiver Dienst mit offenen Perioden bleibt aktiv, bis "Fällige Dienste abrechnen" sie abgerechnet hat
  (Kommentar in `recurring.ts` und `service-end.ts`, Doku in `docs/billing.md`, `.env.example`).
- DTO `ServiceDto` (shared und `billing/dto.ts`): neu `deactivateModuleAtEnd: boolean`. Eine vorgemerkte
  Kündigung erkennt das Web an `status !== 'cancelled' && endsAt !== null` (kein abgeleitetes Feld nötig).
- Audit-Aktionen sind in `packages/shared` keine typisierte Liste und haben keine Labels (das Protokoll
  zeigt den Code), also nichts nachzutragen.

### Web

- `bits.tsx`: `scheduledEndOf(service)`.
- `tables.tsx` (`ServiceTable`, für Kunde und Verkäufer): unter dem Statusbadge "Gekündigt per {date}"
  (Warnfarbe) und, falls gewählt, "Modul «…» wird dann gesperrt"; in der Spalte "Nächste Rechnung" nach
  der letzten Periode "Endet am {date}" statt eines Datums, das nicht mehr verrechnet wird. Der Text
  bricht um, die Tabelle scrollt wie bisher in sich, die Seite nicht.
- `seller-dialogs.tsx` (`CancelServiceDialog`): Hinweis unter dem Datum "Standard ist heute. Mit einem
  späteren Datum …"; auf einer vorgemerkten Kündigung mit Datum und Modulwahl vorbelegt, Knopf
  "Kündigung ändern"; Meldung "Dienst «…» gekündigt per {date}" bei Termin.
- `seller-panel.tsx`: Menüpunkt "Kündigung ändern" statt "Kündigen" bei vorgemerkter Kündigung, dazu
  "Kündigung zurücknehmen" (bis zum Enddatum) mit `ConfirmDialog`, ruft die Withdraw-Route und lädt
  `billingKeys.all` neu. Gleiche Primitive und Menügrössen wie die übrigen Einträge.
- Nicht im Browser angesehen (kein laufender Stack in dieser Einheit); die Änderungen sind eine
  Textzeile in einer bestehenden Zelle, zwei Menüpunkte und ein Standard-Bestätigungsdialog.

### Tests

- `apps/api/test/billing-cancel.test.ts` (neu, 11 Tests): sofortige Kündigung unverändert (ohne Datum,
  heute, Vergangenheit, Modul, Audit); 409 auf beendetem Dienst (auch für Withdraw); Termin behält Status
  und `nextBillingAt`, rechnet genau die Perioden bis zum Enddatum ab, die letzte bis zum Enddatum, keine
  danach (Route und `runDue`); Modul bleibt bis zum Endschritt, der es ausschaltet und `service.end`
  schreibt (einmal); Endschritt beendet keinen aktiven Dienst mit offener Periode, erst nach dem
  Abrechnen; pausierter Dienst endet zum Datum ohne Abrechnung; erneute Kündigung ändert das Datum,
  mit heute endet sie sofort; Zurücknehmen samt Audit und Weiterabrechnung ab der Periode nach dem alten
  Enddatum; kein Zurücknehmen nach dem Enddatum; Berechtigung (Kunde und fremder Reseller bekommen bei
  Cancel und Withdraw dieselbe Antwort 403/404, der eigene Reseller 200); Job: erst Abrechnung, dann
  Endschritt, einmal pro Tag, mit `invoicing: false` nur der Endschritt und ohne den Tag der Abrechnung
  zu verbrauchen.
- `migrations.test.ts`: ein Dienst aus dem Stand 0009 hat nach 0012 `deactivate_module_at_end = false`.
- `apps/web/src/pages/billing/tables.test.tsx` (neu, 3 Tests): Label bei Termin (aktiv und pausiert),
  Modulhinweis, Enddatum nach der letzten Periode, kein Label ohne Kündigung und nach dem Ende.

## Neue i18n-Schlüssel (nur de und en, fr/it/nl übersetzt der Integrator)

Abschnitt `billing`, gestempelt mit `i18n:stamp --locale en --section billing` (9 neu, nach der
Durchsicht 4 weitere und `endsAtLaterHint` mit neuem Text; die vollständige Liste steht unter
"Review").

| Schlüssel | de | en |
|---|---|---|
| `billing.service.cancelledPer` | Gekündigt per {date} | Cancelled effective {date} |
| `billing.service.moduleOffAtEnd` | Modul «{module}» wird dann gesperrt | The module "{module}" is deactivated then |
| `billing.service.cancelledLater` | Dienst «{name}» gekündigt per {date} | Service "{name}" cancelled effective {date} |
| `billing.service.endsAtLaterHint` | Mit einem späteren Datum läuft der Dienst bis zu diesem Tag weiter und wird bis dahin abgerechnet, ein gewähltes Modul wird erst dann gesperrt. | With a later date the service keeps running and is billed until that day, a chosen module is only deactivated then. |
| `billing.service.changeCancel` | Kündigung ändern | Change cancellation |
| `billing.service.withdrawCancel` | Kündigung zurücknehmen | Withdraw cancellation |
| `billing.service.withdrawCancelTitle` | Kündigung von «{name}» zurücknehmen? | Withdraw the cancellation of "{name}"? |
| `billing.service.withdrawCancelText` | Der Dienst läuft danach ohne Enddatum weiter und wird wie bisher abgerechnet. | The service then keeps running without an end date and is billed as before. |
| `billing.service.cancelWithdrawn` | Kündigung von «{name}» zurückgenommen | Cancellation of "{name}" withdrawn |

Die ersten zwei stehen nach `billing.service.endsAt`, die übrigen nach `billing.service.cancelled`.
Kein Schlüssel umbenannt oder gelöscht.

## Neue Audit-Aktionen, Routen, Felder

- Audit: `service.end` (System, `actorName: 'Abrechnungsjob'`), `service.cancel_withdraw`; `service.cancel`
  hat neu `scheduled`, `moduleDeactivatedAtEnd`, `previousEndsAt` in `details`.
- Route: `POST /api/v1/services/:id/cancel/withdraw`.
- DTO: `ServiceDto.deactivateModuleAtEnd: boolean`.
- Settings-Zeile: `billing_end_job` (`{ lastRun, ended, failed }`).
- Migration: `0012_scheduled_cancellation`.

## Prüfungen

Erster Stand, im Worktree auf `3d43c41` (der Bericht ändert keinen Code). Die Prüfungen nach der
Durchsicht stehen unter "Review".

| Prüfung | Ergebnis |
|---|---|
| `pnpm typecheck` | sauber (shared, api, web) |
| `prettier --check` (die fünf Muster) | sauber |
| `pnpm --filter @weblion/api i18n:stamp --check` | 64 Dateien aktuell, 0 veraltet |
| `pnpm build` | erfolgreich (api tsup, web vite) |
| `pnpm test`, Lauf 3 (`wl_bugs_7`) | grün: shared 587 bestanden / 2 übersprungen, web 184 bestanden (13 Dateien), api 1496 bestanden / 1 übersprungen (52 Dateien) |

Vorher: Lauf 1 (`wl_bugs_3`) hatte einen echten Fehler aus dieser Einheit, `phone.test.ts` mit `?q=%`
(siehe oben, behoben in `3d43c41`). Lauf 2 (`wl_bugs_5`) hatte genau einen Fehler,
`hosting.test.ts` "refuses to delete a provider a website allowance points to": das letzte
`DELETE /admin/providers/:id` antwortete 500 statt 200. Die Datei allein zweimal grün (50/50), in
Lauf 1 und Lauf 3 ebenfalls grün. Die Einheit ändert an Anlegen, Löschen und Sync von Providern nichts.
Vermutete Ursache: `POST /admin/providers` startet den ersten Sync im Hintergrund
(`ctx.sync.syncConnection(...)`, nicht abgewartet), und das Löschen läuft unter Last in diesen Sync
hinein. Nicht auf der Liste der bekannten Flakes, deshalb hier gemeldet; nicht weiter untersucht.
`monitoring.test.ts` war in allen drei Läufen grün.

## Für den Inhaber

- **Hop-Zahl in TRUST_PROXY:** Fastify 5.12 hat Hop-Zahlen bewusst abgeschaltet (eine Zahl heisst dort
  "keinem Proxy trauen"). Auftragsgemäss nimmt die Console eine Zahl trotzdem an und setzt sie als
  Vertrauensfunktion um. Wie `true` glaubt sie dann jedem, der den Port direkt erreicht; die Console
  warnt beim Start. Empfehlung: Adressen statt Zahl.
- **`TRUST_PROXY=1` ändert die Bedeutung:** bisher wie `true` (allen trauen, der erste, vom Client
  wählbare Eintrag zählte), jetzt ein Hop (der vom Proxy angehängte Eintrag zählt). Hinter einem Proxy
  ist das richtiger; wer `1` gesetzt hat, merkt nichts ausser einer korrekten IP.
- **Mit `true` war auch hinter nginx gefälscht möglich**, weil nginx mit `$proxy_add_x_forwarded_for`
  anhängt und Fastify den ersten Eintrag nahm. Der neue Standard behebt das.
- **Cloudflare vor cp.weblion.cloud:** Steht die Console hinter der orangenen Wolke, sieht sie mit dem
  Standard nur Cloudflare-Adressen (gemeinsame Login-Sperre). Dann die Cloudflare-Bereiche in
  `TRUST_PROXY` eintragen oder in nginx `real_ip` einrichten (in `docs/deployment.md` beschrieben).
  Nach dem Deploy einmal mit einem fehlgeschlagenen Login im Audit-Protokoll prüfen.
- **`BILLING_JOB_ENABLED=false`** startet den Job jetzt trotzdem, damit Kündigungen auf Termin enden; er
  rechnet dann nichts ab. Wer den Job auf einem zweiten Prozess abgeschaltet hatte: unkritisch, Lock und
  getrennte Tagesmarken verhindern doppelte Läufe und verbrauchen den Abrechnungstag nicht.
- **Keine Gutschrift für schon verrechnete Zeit:** Wer einen Jahresdienst auf ein Datum mitten in der
  bezahlten Periode kündigt, bekommt nichts zurück (wie bisher bei der sofortigen Kündigung). Die letzte
  Periode bis zum Enddatum kostet den vollen Periodenpreis, nur der Rechnungstext endet am Enddatum.
  Seit der Durchsicht sagt der Dialog das und bietet den Tag vor der Periode an.
- **Entwurf nach dem Ende gelöscht:** Löscht ein Verkäufer den Entwurf mit der letzten Periode, nachdem
  der Job den Dienst schon beendet hat, wird die Periode nicht mehr fällig (gleich wie bei jedem
  beendeten Dienst). Mit dem Standard "Entwurf" liegt die letzte Periode oft noch im Entwurf, wenn der
  Dienst endet.
- **Erneute Kündigung** setzt `cancelledAt` auf den Zeitpunkt der letzten Erklärung; das ursprüngliche
  Datum steht im Audit-Protokoll.
- Die Fehlermeldungen der neuen 409 sind wie die übrigen der API englisch.

## Review

Zwei Durchsichten (Abrechnung und Sicherheit) mit neun Befunden, zwei davon doppelt (1 = 5, 3 ≈ 6).
Jeder Befund ist entweder behoben, mit Test, oder begründet offen.

### 1 und 5: Endschritt sperrt das Modul trotz eines anderen laufenden Dienstes (behoben, `a74f36c`)

Stimmt: "Modul sperren" wurde bei der Kündigung gewählt, wirkte aber erst Wochen später, ohne neue
Prüfung. Neu `endModule(tx, service, today)` in `billing/service-end.ts`: sperrt das Modul nur, wenn die
Organisation keinen anderen Dienst mit demselben Modul hat, der noch läuft (Status `active` oder
`suspended`, `endsAt` null oder ab heute). Ein Dienst, dessen Enddatum vorbei ist, zählt nicht, er
wartet nur noch auf sein Ende; so sperrt von zwei Diensten, die am selben Tag enden, der mit der Wahl
das Modul. Die Zeile der Organisation wird zuerst gesperrt, wie es `activateModule` beim Anlegen tut:
Ein gleichzeitig mit dem Modul angelegter Dienst wird gesehen oder schaltet es danach wieder ein.

- Gilt für den Endschritt und für die sofortige Kündigung (gleiche Regel, sonst hinge das Ergebnis vom
  Zeitpunkt ab).
- Audit: `service.end` und `service.cancel` haben bei behaltenem Modul `moduleDeactivated: null,
  moduleKept: '<modul>'`; beim Sperren unverändert `moduleDeactivated: '<modul>'` ohne `moduleKept`.
- Web: Der Kündigungsdialog bekommt die Dienste des Kunden und zeigt bei eingeschaltetem "Modul sperren"
  die Dienste, die das Modul halten (`servicesKeepingModule` in `pages/billing/service-end.ts`, dieselbe
  Regel). `scheduledEndOf` ist dorthin umgezogen (reine Funktionen der Kündigung, ohne React).
- Offen gelassen: Hält ein Dienst ohne Wahl das Modul und endet später, bleibt das Modul danach aktiv,
  obwohl der erste Dienst "sperren" gewählt hatte. Die Wahl gehört zum Dienst, nicht zum Modul; der
  Verkäufer sieht `moduleKept` im Audit und sperrt beim zweiten Dienst.
- Tests (`billing-cancel.test.ts`, "module at the end", 4): Paketwechsel (alter Dienst endet, neuer mit
  demselben Modul beginnt am Tag danach: Modul bleibt, Audit `moduleKept`), zwei vorgemerkte Enden (erst
  das zweite sperrt), zwei Enden am selben Tag (Modul geht), sofortige Kündigung mit einem anderen
  aktiven bzw. pausierten Dienst. Web `service-end.test.ts`: welche Dienste das Modul halten.

### 2: Ende auf oder kurz nach einem Rechnungstag kostet eine ganze Periode (behoben, `8bf92ef`)

Stimmt, und die Regel selbst bleibt (jede Periode, die bis zum Enddatum beginnt, voll, nicht anteilig;
anteilige Rechnungen gibt es in der Console nirgends). Behoben ist, dass der Verkäufer es nicht sah:

- `FullPeriodNotice` im `CancelServiceDialog`: Liegt das gewählte Datum nach heute und auf oder nach
  `nextBillingAt` eines aktiven, wiederkehrenden Dienstes, steht dort "Die Periode ab {date} wird noch
  voll verrechnet ({price})" (Betrag netto, Menge mal Preis) und ein Knopf "Stattdessen per {Tag davor}
  kündigen", der das Datum setzt. Den Knopf gibt es nicht, wenn der Tag davor schon vorbei ist (die
  Periode hat begonnen und ist fällig). Logik in `fullPeriodAhead()`.
- `billing.service.endsAtLaterHint` neu formuliert (eigener, noch nicht übersetzter Schlüssel): sagt,
  dass jede Periode, die bis zu diesem Tag beginnt, voll verrechnet wird, nicht anteilig.
- `docs/billing.md`: voller Periodenpreis, der Hinweis im Dialog, der Fall Rechnungstag am Monatsende.
- Tests: `service-end.test.ts` (`fullPeriodAhead`: Start am 31.08 und "per Ende November", Jahresdienst
  aus dem Befund, keine Warnung vor der Periode, heute, pausiert, einmalig, ohne Datum; Knopf nur, wenn
  der Tag davor nicht vorbei ist), `tables.test.tsx` (`FullPeriodNotice` mit Text, Betrag und Knopf,
  leer vor der Periode).

### 3 und 6: "Kündigung ändern" nach dem Enddatum verwirft die letzte Periode (behoben, `f8717e2`)

Stimmt. `POST /services/:id/cancel` antwortet jetzt 409 ("The end date of the cancellation has passed"),
wenn eine vorgemerkte Kündigung ihr Enddatum hinter sich hat, gleich wie Withdraw. Das gilt für jedes
neue Datum: heute oder früher hätte `nextBillingAt` geleert und die Periode verworfen, ein späteres
hätte den Dienst wieder geöffnet. Eine Abfrage nur bei offener Periode (Variante aus Befund 3) hätte
das Wiederöffnen offen gelassen; ohne offene Periode endet der Dienst ohnehin beim nächsten Lauf.

- Web: Das Menü zeigt "Kündigen"/"Kündigung ändern" und "Kündigung zurücknehmen" nur bis zum Enddatum
  (`endPassed`, dieselbe Prüfung wie bisher `withdrawable`). Der Dialog sagt bei einer vorgemerkten
  Kündigung nicht mehr "Standard ist heute.", nur den Hinweis zum späteren Datum.
- `docs/billing.md`: nach dem Enddatum 409 auf beiden Routen und warum.
- Test "cannot be changed once the end date has passed, so the periods up to it stay due": ohne Datum,
  mit heute, mit 2099-12-31 und mit Modulwahl je 409; Dienst, Rechnungsdatum und Modul unverändert;
  danach rechnet "Fällige Dienste abrechnen" die Periode bis zum Enddatum ab, und der Endschritt beendet
  den Dienst.

### 4: Ein Dienst, den der Lauf immer überspringt, endet nie (teilweise behoben, `f8717e2`)

Stimmt. Das gilt schon vor dieser Einheit für jeden übersprungenen Dienst (er bleibt fällig, der Lauf
warnt im Log, "Fällige Dienste abrechnen" zeigt die Meldung zur Währung). Automatisch beenden nach einer
Frist, wie im Befund vorgeschlagen, verwirft Perioden ohne Zutun und widerspricht genau dem, was der
Endschritt verspricht. Deshalb nur sichtbar gemacht und den Ausweg festgehalten:

- Die Dienste-Tabelle (Kunde und Verkäufer) zeigt bei einem Dienst, dessen Enddatum vorbei ist und der
  noch eine Periode bis dahin offen hat, "Gekündigt per {date}, endet, sobald bis dahin abgerechnet ist"
  statt "Gekündigt per {date}" (`waitsForBilling`). `ServiceTable` hat dafür ein optionales `today` für
  Tests.
- Ausweg (`docs/billing.md`): Periode von Hand verrechnen, dann unter "Bearbeiten" die nächste Rechnung
  leeren; der Endschritt beendet den Dienst danach und sperrt das Modul, falls gewählt.
- Kein Hinweis für Admins ausserhalb der Tabelle (Log-Warnung wie bisher).
- Tests: API "keeps a service the run skips until the seller clears its billing date" (Dienst in EUR bei
  einem CHF-Kunden bleibt 30 Tage nach dem Ende aktiv, Modul bleibt; nach `PATCH nextBillingAt: null`
  endet er, Modul aus), Web `tables.test.tsx` (Text nach dem Enddatum, nicht davor und nicht nach der
  Abrechnung) und `service-end.test.ts` (`endPassed`, `waitsForBilling`).

### 7: TRUST_PROXY nimmt Bereiche an, an denen Fastify scheitert (behoben, `3600f2f`)

Stimmt (`@fastify/proxy-addr` 5.1.1, `parseipNotation`: Bereich `<= 0` oder Netzmaske mit Lücken wirft
`TypeError: invalid range`). `validProxyAddress` verlangt jetzt ein Präfix von 1 bis 32 bzw. 128 und eine
zusammenhängende Netzmaske ausser `0.0.0.0`. Allen trauen heisst weiterhin `true`. Test "refuses the
ranges proxy-addr refuses and accepts the ones it builds": `0.0.0.0/0`, `::/0`, `10.0.0.0/0.0.0.0`,
`10.0.0.0/255.0.255.0`, `10.0.0.0/0.0.0.1` scheitern an `loadEnv` mit der TRUST_PROXY-Meldung und, zum
Beweis, an `Fastify()`; `/1`, `/32`, `::/1`, `::1/128`, `128.0.0.0`, `255.255.255.0`, `255.255.255.255`
werden angenommen und von Fastify gebaut. `docs/deployment.md`: Präfix ab 1, Netzmaske ohne Lücken.

### 8: `loopback,uniquelocal` in Docker Compose lässt private Clients ihre IP wählen (behoben, `7a084da`)

Stimmt: Der Proxy auf dem Host hängt die Adresse seines Clients an; ist sie privat (LAN, VPN,
Tailscale), war sie selbst vertrauenswürdig, und der gefälschte Eintrag davor zählte.

- `docker-compose.yml`: Das Standardnetz hat einen festen Bereich, `'${CONSOLE_SUBNET:-172.30.0.0/24}'`,
  und `TRUST_PROXY` ist standardmässig `'${TRUST_PROXY:-loopback,${CONSOLE_SUBNET:-172.30.0.0/24}}'`.
  Verschachtelte Variablen mit `docker compose config` (v5.6.1) geprüft: leer, mit `CONSOLE_SUBNET`,
  mit eigenem `TRUST_PROXY`, mit leerem `TRUST_PROXY`. Hier läuft kein Docker-Daemon, `up` ist also nicht
  ausprobiert.
- Warum der ganze /24 und nicht nur das Gateway: Im Netz sind nur die eigenen Container (Datenbank,
  Console, allenfalls ein Proxy-Container), und das Gateway lässt sich in Compose nicht aus dem Bereich
  ableiten.
- `.env.example` (`CONSOLE_SUBNET=`, leer heisst 172.30.0.0/24) und `docs/deployment.md` (warum nicht
  `uniquelocal`, "Pool overlaps", einmal `down`/`up -d` bei bestehenden Installationen).
- Test "trusts only its own network in docker-compose.yml, not every private range" liest die Datei:
  Standard und Netz nennen denselben Bereich; vom Gateway mit `X-Forwarded-For: 6.6.6.6, 10.8.0.5` ergibt
  `10.8.0.5`, ebenso für eine ULA-Adresse; der alte Standard ergab `6.6.6.6`.

### 9: Vor dem Fix auf ein späteres Datum gekündigte Dienste bleiben beendet (nicht im Code, für den Inhaber)

Stimmt. Die alte Route setzte bei einem späteren Datum `status = 'cancelled'`, `nextBillingAt = null` und
sperrte ein gewähltes Modul sofort. Diese Zeilen bleiben so. Kein Datenschritt, weil die Folgen eine
Entscheidung brauchen: Wieder aktiv hiesse, Perioden seit der Kündigung nachträglich zu verrechnen und
ein Modul wieder einzuschalten, das der Kunde seither nicht hatte; ein Teil der Verkäufer hat das
spätere Datum vielleicht nur als Vermerk gesetzt. Zum Auflisten vor dem Deploy (danach entstehen
Zeilen dieser Form auch regulär durch den Endschritt):

```sql
select s.id, o.name as kunde, s.name, s.module, s.ends_at, s.cancelled_at
from services s join organizations o on o.id = s.org_id
where s.status = 'cancelled'
  and s.ends_at > (s.cancelled_at at time zone 'Europe/Zurich')::date
order by s.ends_at;
```

Nach dem Deploy dieselbe Abfrage mit `and not exists (select 1 from audit_logs a where a.resource_id =
s.id::text and a.action = 'service.end')`. Der Audit-Eintrag `service.cancel` der alten Route nennt
`endsAt` und `moduleDeactivated`. Soll ein Dienst als vorgemerkte Kündigung weiterlaufen, geht das nur
in der Datenbank: `status = 'active'`, `next_billing_at` = Beginn der Periode nach der zuletzt
verrechneten (`max(period_start)` seiner Rechnungszeilen plus ein Intervall, sonst `starts_at`),
`deactivate_module_at_end` nach dem Audit-Eintrag, das Modul wieder einschalten. Mit Zeilen, deren
`ends_at` schon vorbei ist, nichts tun.

### Neue und geänderte i18n-Schlüssel (vollständige Liste dieser Einheit)

Alle im Abschnitt `billing`, nur de und en, gestempelt mit `i18n:stamp --locale en --section billing`.
fr, it und nl fehlen für alle 13 (erwartet, der Integrator übersetzt).

| Schlüssel | de | en |
|---|---|---|
| `billing.service.cancelledPer` | Gekündigt per {date} | Cancelled effective {date} |
| `billing.service.endWaitsForBilling` (neu) | Gekündigt per {date}, endet, sobald bis dahin abgerechnet ist | Cancelled effective {date}, ends once it is billed up to then |
| `billing.service.moduleOffAtEnd` | Modul «{module}» wird dann gesperrt | The module "{module}" is deactivated then |
| `billing.service.moduleKept` (neu) | Das Modul bleibt aktiv, solange der Kunde noch einen anderen Dienst damit hat: {names}. | The module stays active while the customer still has another service with it: {names}. |
| `billing.service.cancelledLater` | Dienst «{name}» gekündigt per {date} | Service "{name}" cancelled effective {date} |
| `billing.service.endsAtLaterHint` (neuer Text) | Mit einem späteren Datum läuft der Dienst bis zu diesem Tag weiter, ein gewähltes Modul wird erst dann gesperrt. Jede Periode, die bis zu diesem Tag beginnt, wird voll verrechnet, nicht anteilig. | With a later date the service keeps running until that day, a chosen module is only deactivated then. Every period that starts up to that day is billed in full, not pro rata. |
| `billing.service.fullPeriod` (neu) | Die Periode ab {date} wird noch voll verrechnet ({price}). | The period from {date} is still billed in full ({price}). |
| `billing.service.endBeforePeriod` (neu) | Stattdessen per {date} kündigen | Cancel effective {date} instead |
| `billing.service.changeCancel` | Kündigung ändern | Change cancellation |
| `billing.service.withdrawCancel` | Kündigung zurücknehmen | Withdraw cancellation |
| `billing.service.withdrawCancelTitle` | Kündigung von «{name}» zurücknehmen? | Withdraw the cancellation of "{name}"? |
| `billing.service.withdrawCancelText` | Der Dienst läuft danach ohne Enddatum weiter und wird wie bisher abgerechnet. | The service then keeps running without an end date and is billed as before. |
| `billing.service.cancelWithdrawn` | Kündigung von «{name}» zurückgenommen | Cancellation of "{name}" withdrawn |

`endWaitsForBilling` steht nach `cancelledPer`, `moduleKept` nach `deactivateModuleHint`, `fullPeriod`
und `endBeforePeriod` nach `endsAtLaterHint`. Kein Schlüssel umbenannt oder gelöscht, kein bestehender
(übersetzter) Text geändert.

### Neue Felder und Antworten

- Audit-Details: `moduleKept` in `service.end` und `service.cancel`.
- `POST /services/:id/cancel`: 409 nach dem Enddatum einer vorgemerkten Kündigung.
- Compose: Variable `CONSOLE_SUBNET`, Netz `default` mit festem Bereich.

### Prüfungen nach der Durchsicht

Im Worktree auf `7a084da`, frische Datenbank `wl_bugs_9`.

| Prüfung | Ergebnis |
|---|---|
| `pnpm typecheck` | sauber (shared, api, web) |
| `prettier --check` (die fünf Muster) | sauber |
| `pnpm --filter @weblion/api i18n:stamp --check` | 64 Dateien aktuell, 0 veraltet |
| `pnpm build` | erfolgreich (api tsup, web vite) |
| `pnpm test` (`wl_bugs_9`) | grün im ersten Lauf: shared 587 bestanden / 2 übersprungen, web 190 bestanden (14 Dateien), api 1504 bestanden / 1 übersprungen (52 Dateien) |

`monitoring.test.ts` und `hosting.test.ts` waren grün.

### CONFLICT

Ab `8bf92ef` meldet `push-unit.sh B` CONFLICT in `apps/web/src/pages/billing/seller-dialogs.tsx`, gegen
`6578eea` ("U4: WIP Produkttexte mit KI und Produktübersetzungen") auf dem Arbeitsbranch. Nicht
aufgelöst, nichts gemergt. Der Konflikt ist nur die Importliste aus `@weblion/shared`: B fügt nach
`formatMoney,` die Zeile `lineTotal,` ein, U4 an derselben Stelle `productText,`. Auflösung: beide
Zeilen behalten. Die übrigen Änderungen beider Seiten in der Datei überschneiden sich nicht
(`AddServiceDialog` bei U4, `CancelServiceDialog` und `FullPeriodNotice` bei B).
