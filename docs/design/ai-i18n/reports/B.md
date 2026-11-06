# Bericht Einheit B: drei Fehler behoben

Branch `ai-i18n/bugs`, Basis `f0decba`. Jeder Commit ist mit `push-unit.sh B` auf dem Arbeitsbranch
gesichert, ohne CONFLICT.

## Commits

| SHA | Titel |
|---|---|
| `209e92b` | B: Suche maskiert % und _ statt sie zu entfernen |
| `a044f34` | B: TRUST_PROXY vertraut standardmässig nur loopback |
| `8c7d8fa` | B: Kündigung auf Termin läuft bis zum Enddatum |
| `e200009` | B: Vorgemerkte Kündigung anzeigen, ändern und zurücknehmen |
| `3d43c41` | B: Telefonie-Test sucht % wörtlich |
| (dieser) | B: Bericht der Fehlerbehebung |

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

Abschnitt `billing`, gestempelt mit `i18n:stamp --locale en --section billing` (9 neu).

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

Alle im Worktree, Stand `3d43c41` (der Bericht ändert keinen Code).

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
- **Entwurf nach dem Ende gelöscht:** Löscht ein Verkäufer den Entwurf mit der letzten Periode, nachdem
  der Job den Dienst schon beendet hat, wird die Periode nicht mehr fällig (gleich wie bei jedem
  beendeten Dienst). Mit dem Standard "Entwurf" liegt die letzte Periode oft noch im Entwurf, wenn der
  Dienst endet.
- **Erneute Kündigung** setzt `cancelledAt` auf den Zeitpunkt der letzten Erklärung; das ursprüngliche
  Datum steht im Audit-Protokoll.
- Die Fehlermeldungen der neuen 409 sind wie die übrigen der API englisch.
