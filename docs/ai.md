# KI (Claude)

Die Console nutzt Claude von Anthropic für sieben KI-Funktionen: einen Assistenten im Kundenbereich,
Erklärungen zu Fehlern, eine DNS- und E-Mail-Prüfung, Zusammenfassungen des Audit-Logs, eine Auswertung von
Servern, Produkttexte und Übersetzungen. Die KI liest nur. Sie ändert nichts, und einen Vorschlag übernimmt
immer eine Person im normalen Formular.

Für jeden Kunden ist die KI ausgeschaltet, bis weblion.one oder sein Reseller sie einschaltet. Das geschieht
erst, wenn der Kunde zugestimmt hat. Ein Kunde kann die KI jederzeit selbst ablehnen.

Eingerichtet wird alles im Admin-Bereich unter KI (`/admin/ai`, im Folgenden "KI-Seite"). Die Meldungen der
Console nennen diesen Ort "Verwaltung > KI". Die Übersetzungen der Console beschreibt [i18n.md](i18n.md).

## Funktionen

- **KI-Assistent:** ein Chat im Kundenbereich ("KI-Assistent öffnen"). Er beantwortet Fragen zur
  Organisation, in der die Person gerade arbeitet, und liest dafür Server, Domains, DNS-Einträge, Websites,
  Mail-Domains, Monitoring, Cloud-Speicher, Telefonanlagen, Streaming, Abrechnung und Audit-Log. Er kann einen
  DNS-Eintrag vorschlagen.
- **Fehler erklären:** "Mit KI erklären" bei Fehlermeldungen, bei Einträgen im Audit-Log, bei fehlgeschlagenen
  Server-Aktionen, bei Monitoren und Websites. Im Admin-Bereich auch bei Fehlern eines Providers und im
  Versandprotokoll der E-Mails (Admin > Einstellungen).
- **DNS- und E-Mail-Prüfung:** "Mit KI prüfen" bei den DNS-Einträgen einer Domain und bei den DNS-Einträgen
  einer Mail-Domain. Das Ergebnis nennt pro Thema (MX, SPF, DKIM, DMARC, automatische Einrichtung, Website,
  CAA, weitere Einträge) den Stand und schlägt Einträge vor.
- **Audit-Zusammenfassung:** "Mit KI zusammenfassen" im Audit-Log des Kunden (mit `audit:read`), für
  Mitarbeitende auch auf der Admin-Übersicht (mit `platform:audit:read`). Ausgewertet werden höchstens die
  500 neuesten Einträge des Zeitraums.
- **Server-Auswertung:** "Mit KI auswerten" im Tab Graphen eines Servers. Die KI beurteilt CPU,
  Arbeitsspeicher, Festplatte, Netzwerk, Datenverkehr, Backups und Erreichbarkeit.
- **Produkttexte:** "Texte mit KI" im Formular eines Produkts. Die KI schreibt Name und Beschreibung in den
  fünf Sprachen oder übersetzt den deutschen Text. Für Mitarbeitende mit `platform:billing:write` und für
  Reseller mit `reseller:billing` (ihre eigenen Produkte).
- **Übersetzungen:** "Mit KI übersetzen" und "KI-Vorschlag" unter Admin > Übersetzungen, siehe
  [i18n.md](i18n.md). Braucht `platform:i18n:write` und `platform:ai:use`, standardmässig also nur
  Superadmins.

Im Kundenbereich braucht jede Funktion `ai:use` und dazu die Rechte der Seite, auf der sie steht. `ai:use`
haben die Rollen Owner, Admin, Member und "Nur lesen". "Eingeschränkt" und "Buchhaltung" haben es nicht, eine
Access Policy kann es ihnen geben. Bei weblion.one haben Superadmins und Support `ai:use` und
`platform:ai:use`, Support also auch die KI beim Kunden und im Admin-Bereich. API-Tokens können die KI nicht
nutzen: Jede KI-Funktion verlangt eine Anmeldung.

Das Gespräch mit dem Assistenten bleibt nur im Browser-Tab (höchstens 40 Nachrichten) und wird beim Abmelden
gelöscht. Eine Frage darf höchstens 4000 Zeichen lang sein. Unter jedem Ergebnis stehen der Hinweis
"KI-Antworten können Fehler enthalten. Prüfen Sie wichtige Angaben, bevor Sie handeln.", ein Link zum
Datenschutzhinweis und das Modell, das geantwortet hat.

## Schlüssel und Modell

### API-Schlüssel

Der Schlüssel kommt auf die KI-Seite, Karte "API-Schlüssel". Es muss ein normaler API-Schlüssel aus der
Claude Console von Anthropic sein (beginnt mit `sk-ant-`). Einen Admin-API-Schlüssel (`sk-ant-admin...`)
lehnt die Console ab. Der Schlüssel wird mit `ENCRYPTION_KEY` verschlüsselt gespeichert und nie mehr
angezeigt. Ändert sich `ENCRYPTION_KEY`, ist der gespeicherte Schlüssel nicht mehr lesbar und muss neu
eingetragen werden.

Ein hier gespeicherter Schlüssel hat Vorrang vor `ANTHROPIC_API_KEY` aus der Umgebung. So lässt sich ein
Schlüssel ohne Deploy ersetzen. Wird er gelöscht, gilt wieder `ANTHROPIC_API_KEY`, falls gesetzt.

"Verbindung testen" fragt Anthropic, ob das gewählte Modell mit dem Schlüssel erreichbar ist. Der Test
verbraucht keine Tokens und kein Budget.

Speichern, Ersetzen, Löschen und Testen stehen im Audit-Log (`ai.key_update`, `ai.key_delete`, `ai.test`),
der Schlüssel selbst nie.

### Modell und Preise

Ein Modell gilt für alle Funktionen. Es wird auf der KI-Seite gewählt, Standard ist Claude Opus 5.5. Die
Console wechselt nie von sich aus zu einem anderen Modell.

Preise in USD pro Million Tokens, wie sie in `packages/shared/src/ai.ts` stehen:

| Modell                                  | Eingabe | Ausgabe | In den Cache schreiben | Aus dem Cache lesen |
| --------------------------------------- | ------- | ------- | ---------------------- | ------------------- |
| Claude Opus 5.5 (`claude-opus-5-5`)     | 4.00    | 20.00   | 5.00                   | 0.20                |
| Claude Sonnet 5.5 (`claude-sonnet-5-5`) | 2.00    | 10.00   | 2.50                   | 0.20                |
| Claude Haiku 5.5 (`claude-haiku-5-5`)   | 0.10    | 0.50    | 0.125                  | 0.01                |

Bei Haiku kosten Anfragen mit mehr als 100 000 Tokens Eingabe 0.50, 2.50, 0.625 und 0.05. Die KI-Seite
beschreibt Opus mit "Beste Qualität, Standard", Sonnet mit "Schneller, etwa halber Preis" und Haiku mit "Sehr
günstig, für einfache Aufgaben; ohne Ersatzmodell bei Ablehnungen". Ändert Anthropic die Preise, ist das eine
Änderung im Code.

Lehnt Claude Opus oder Sonnet eine Anfrage aus Sicherheitsgründen ab, beantwortet Anthropic sie in derselben
Anfrage mit einem Ersatzmodell. Solche Antworten sind markiert ("Ein Teil dieser Antwort stammt von einem
Ersatzmodell von Anthropic."). Ein Ersatzmodell, das nicht in der Tabelle steht, bucht die Console vorsichtig
mit dem 1.25-fachen Preis des gewählten Modells. Haiku hat kein Ersatzmodell: Dort endet eine Ablehnung mit
einer Fehlermeldung.

Jede Funktion arbeitet mit einem festen Aufwand (Effort), damit der Cache warm bleibt: Assistent,
DNS-Prüfung, Server-Auswertung und Übersetzungen mit "medium", die übrigen mit "low".

### Was eine Anfrage kostet

Rechenbeispiele mit Claude Opus 5.5. Die Zahlen der Tokens sind angenommen, die Preise die aus der Tabelle.
Der feste Teil einer Anfrage (Anweisungen und Werkzeuge) bleibt 5 Minuten im Cache. Beim ersten Mal kostet er
etwas mehr als normale Eingabe, danach ein Zwanzigstel.

- **Fehler erklären, erste Anfrage:** 1600 Tokens Anweisungen in den Cache, 1400 Tokens Eingabe, 900 Tokens
  Ausgabe. 1600 x 5 + 1400 x 4 + 900 x 20 = 31 600 Millionstel, also **USD 0.032**.
- **Dieselbe Erklärung innerhalb von 5 Minuten:** Die Anweisungen kommen aus dem Cache.
  1600 x 0.20 + 1400 x 4 + 900 x 20 = 23 920 Millionstel, also **USD 0.024**. Mit Claude Sonnet 5.5 wären es
  USD 0.012, mit Claude Haiku 5.5 USD 0.0006.
- **Eine Antwort des Assistenten** mit drei Aufrufen von Claude und zwei Abfragen dazwischen, kalter Cache:
  Aufruf 1 schreibt 7000 Tokens Werkzeuge und Anweisungen und 900 Tokens Nachrichten in den Cache und gibt
  350 Tokens aus (USD 0.047), Aufruf 2 liest 7900 Tokens aus dem Cache, schreibt 3550 dazu und gibt 300 aus
  (USD 0.025), Aufruf 3 liest 11 450, schreibt 2700 und gibt 650 aus (USD 0.029). Zusammen **USD 0.10**.
  Die Grenze dieser Antwort liegt beim Fünffachen der Schätzung des ersten Aufrufs:
  5 x (7900 x 4 + 2000 x 20) = 358 000 Millionstel, also USD 0.36.
- **Ein Paket von "Mit KI übersetzen":** 50 Texte, 2400 Tokens Anweisungen mit Glossar aus dem Cache, 1800
  Tokens Eingabe, 3200 Tokens Ausgabe. 2400 x 0.20 + 1800 x 4 + 3200 x 20 = 71 680 Millionstel, also
  **USD 0.072**.

Mit dem Standardbudget von USD 100 im Monat reicht das für etwa 1000 Antworten des Assistenten oder 4000
Erklärungen.

Die ganze Console in Französisch, Italienisch und Niederländisch übersetzen: Für die rund 4600 Texte schätzt
die Console mit Claude Opus 5.5 etwa USD 13 (279 Pakete). Was ein Lauf wirklich kostet, hängt von der Länge
der Antworten ab. Rechnen Sie mit USD 10 bis 20. Mehr dazu in [i18n.md](i18n.md#mit-ki-übersetzen).

## Schalter

Die KI arbeitet für einen Kunden nur, wenn alle diese Schalter es erlauben.

**Plattform.** Der Hauptschalter "KI-Funktionen auf der Plattform einschalten" auf der KI-Seite, nur für
Superadmins (`platform:settings`). Standard: aus, mit `ENABLE_DEMO_PROVIDER=true` an. Solange er aus ist, gibt
es keine KI-Funktion, auch keine im Admin-Bereich. Ohne Schlüssel bleiben die Funktionen ebenfalls aus
(ausser im [Demo-Modus](#demo-modus)). Beim Einschalten fragt die Console jedes Mal die Punkte 1 bis 4 aus
[Vor dem Einschalten](#vor-dem-einschalten) ab.

**Funktionen.** Ein Schalter pro Funktion auf der KI-Seite, Karte "Funktionen". Standard: alle an. Eine
ausgeschaltete Funktion ist für alle unsichtbar, auch für Mitarbeitende.

**Kunde.** Admin > Kunden > Kunde, Karte "KI", Schalter "KI für diesen Kunden", für Mitarbeitende mit
`platform:org:write`. Standard: aus, für jeden Kunden, auch für alle bestehenden. Eingeschaltet wird ein Kunde
einzeln und erst, wenn er zugestimmt hat, im Vertrag oder in einem Nachtrag zum Auftragsverarbeitungsvertrag.
Der Dialog verlangt diese Bestätigung ("Der Kunde hat der Nutzung der KI-Funktionen zugestimmt ..."), das
Audit-Log hält sie fest (`ai.org_switch` mit `consentConfirmed`). Ausschalten geht jederzeit ohne
Bestätigung. Hat weblion.one einen Kunden ausgeschaltet, kann ihn nur weblion.one wieder einschalten.

**Reseller.** Reseller > Meine Kunden > Kunde, Karte "KI-Funktionen", Schalter "KI für diesen Kunden
erlauben", für Reseller mit `reseller:customer:write`. Der Reseller schaltet einen Kunden mit derselben
Bestätigung ein. Das geht nur, solange die KI für den Reseller selbst eingeschaltet ist (der Reseller ist
dafür ein normaler Kunde von weblion.one) und solange weblion.one den Kunden nicht ausgeschaltet hat. Ist die
KI beim Reseller aus oder hat er sie abgelehnt, ist sie für alle seine Kunden aus, auch wenn ein Kunde selbst
eingeschaltet ist. Der Eintrag `ai.org_switch` steht im Audit-Log des Resellers und im Audit-Log des Kunden.

**Ablehnung des Kunden.** Owner und Admins eines Kunden (`ai:settings`) lehnen die KI unter Einstellungen,
Karte "KI-Funktionen", ab ("KI-Funktionen ablehnen") und nehmen die Ablehnung dort zurück. Das geht
jederzeit: bevor die KI auf der Plattform eingeschaltet ist, während der Kunde gesperrt ist und danach. Eine
Ablehnung gewinnt immer, auch gegen die Funktionen der Mitarbeitenden von weblion.one: Dann gehen keine Daten
dieses Kunden mehr an Anthropic. Im Audit-Log steht `ai.org_decline` oder `ai.org_allow`.

Für Mitarbeitende gilt beim Kunden dasselbe wie für seine Mitglieder: Ist die KI für den Kunden aus, beim
Reseller aus oder abgelehnt, ist sie es auch für sie. Zusammenfassungen des Audit-Logs lassen Einträge zu
solchen Kunden aus und sagen, wie viele.

Die Karten zeigen die Zahl der KI-Anfragen dieses Monats, die Karte des Kunden und die im Admin-Bereich dazu
die Zahl der Anfragen von Mitarbeitenden. Kunden und Reseller sehen nur Anzahlen, Mitarbeitende im
Admin-Bereich auch die Kosten in USD.

## Budget und Limits

Einstellbar auf der KI-Seite, Karte "Budget und Limits":

| Einstellung                       | Standard | Bereich       |
| --------------------------------- | -------- | ------------- |
| Budget pro Monat (USD)            | 100      | 0 bis 100 000 |
| Warnung ab (%)                    | 80       | 10 bis 99     |
| Anfragen pro Organisation und Tag | 200      | 1 bis 10 000  |
| Anfragen pro Person und Tag       | 50       | 1 bis 10 000  |

Fest im Code:

- pro Person 12 Anfragen pro Minute und 2 gleichzeitig
- pro Organisation 3 Anfragen gleichzeitig und 30 Abfragen bei Providern pro Minute (die 30 zählt jeder
  Prozess der API für sich)
- auf der ganzen Plattform 6 Anfragen gleichzeitig
- pro Antwort des Assistenten höchstens 8 Aufrufe von Claude und 24 Abfragen, davon 8 bei Providern, und
  Kosten bis zum Fünffachen der Schätzung. Ist eine Grenze erreicht, liest der Assistent nichts mehr und sagt,
  dass die Antwort gekürzt ist
- ein Auftrag von "Mit KI übersetzen" stoppt beim 1.5-fachen seiner Schätzung
- eine Anfrage dauert höchstens `AI_TURN_TIMEOUT_SECONDS` (Standard 180 Sekunden)

Das Budget ist eine harte Grenze für die ganze Plattform. Ist es aufgebraucht, startet keine KI-Anfrage mehr,
auch keine Übersetzung, und eine laufende Antwort des Assistenten hält an. Ein Budget von 0 sperrt alles. Vor
jeder Anfrage reserviert die Console die geschätzten Kosten, so überziehen auch gleichzeitige Anfragen das
Budget kaum.

Monate und Tage zählen nach Schweizer Zeit (Europe/Zurich). Erreicht der Verbrauch die Warnschwelle oder das
Budget, bekommen alle aktiven Superadmins einmal im Monat eine E-Mail in ihrer Sprache, und das Audit-Log hält
es fest (`ai.budget_warning`, `ai.budget_exhausted`). Die Admin-Übersicht zeigt dann einen Hinweis.

Anfragen von Mitarbeitenden zählen nicht zum Tageslimit des Kunden, aber zu ihrem eigenen. Die Pakete von
"Mit KI übersetzen" zählen zu keinem Limit einer Person oder Organisation, nur zum Budget und zu den 6
gleichzeitigen Anfragen der Plattform.

## Nur lesen: Werkzeuge und Trennung der Kunden

Der Assistent hat 22 Werkzeuge: 21 lesen, eines macht einen DNS-Vorschlag. Kein Werkzeug legt etwas an,
ändert, löscht, startet neu oder bestellt etwas.

- **Nur bestehende GET-Routen.** Die Werkzeuge fragen keine Tabellen ab. Sie rufen eine feste Liste von
  GET-Routen der Console auf, intern und mit der Anmeldung der Person, die fragt. Jede Prüfung dieser Routen
  gilt damit unverändert: Rechte, Module, Sperren. Die Pfade baut die Console selbst, das Modell nennt nur
  IDs.
- **Nur die eigene Organisation.** Liest die KI etwas über eine ID, prüft die Console zuerst, ob es zur
  Organisation der Anfrage gehört. Wenn nicht, lautet die Antwort "nicht gefunden", genau wie bei einer ID,
  die es nicht gibt.
- **Vorschläge öffnen nur das Formular.** Ein DNS-Vorschlag (A, AAAA, CNAME, MX, TXT, SRV oder CAA, neu oder
  geändert) öffnet mit "Vorschlag übernehmen" das normale DNS-Formular vorausgefüllt. Gespeichert wird erst
  dort, mit der normalen Prüfung der Rechte und einem Eintrag im Audit-Log. Einen Wert, den die Console nicht
  selbst berechnet hat, markiert sie mit "Nicht von weblion.one geprüft" und öffnet ihn erst nach einer
  zweiten Bestätigung ("Trotzdem öffnen"). Einträge löschen und NS-Einträge vorschlagen kann die KI nicht.
  MX-Einträge und die A- und AAAA-Einträge der Domain selbst (`@`) ändert sie nur auf einen Wert, den die
  Console berechnet hat. Produkttexte übernimmt "In das Formular übernehmen", gespeichert wird mit "Speichern"
  im Produktformular.
- **Daten Dritter sind Daten.** DNS-Einträge, Fehlermeldungen, Einträge im Audit-Log und Antworten der
  Provider gehen als gekennzeichnete Daten an Claude, nicht als Anweisungen. In Antworten werden nur Pfade der
  Console zu Links. Andere Links und Adressen bleiben Text, Bilder gibt es keine.
- **Geheimnisse bleiben in der Console.** Vor dem Senden entfernt die Console die Werte der geheimen
  Variablen der Umgebung (Namen auf `_KEY`, `_TOKEN`, `_SECRET` oder `_PASSWORD` und ähnliche), die
  Schlüssel von Anthropic und typische Formen von Passwörtern, Schlüsseln und Tokens, auch aus den eigenen
  Fragen der Person. Aus Einträgen des Audit-Logs entfernt sie zusätzlich IP- und E-Mail-Adressen. Das
  geschieht automatisch und erfasst nicht jeden Fall. Namen von Personen in Einträgen des Audit-Logs können
  mitgehen. Von der fragenden Person erhält die KI nur die Rolle, nicht den Namen. Anthropic bekommt pro
  Person eine feste Kennung für die Erkennung von Missbrauch, aus der sich die Person nicht ablesen lässt.

## Was gespeichert wird

- **Keine Fragen und Antworten.** Die Console speichert weder Fragen noch Antworten, Anweisungen, Eingaben
  oder Ergebnisse von Werkzeugen. Das Gespräch mit dem Assistenten liegt nur im Browser-Tab.
- **Angaben zur Nutzung**, eine Zeile pro Anfrage in `ai_usage`: Funktion, Organisation, Person, Modell und
  Ersatzmodell, Status, Anzahl Aufrufe und Tokens, Kosten, Dauer, Fehlercode und Grund, Request-ID von
  Anthropic. Diese Zeilen bleiben 400 Tage.
- **Fehlertexte von Anthropic**, bereinigt wie oben, in derselben Zeile. Sie werden nach 30 Tagen geleert.
- **Einstellungen und Schlüssel** in der Tabelle `settings` (Zeilen `ai`, `ai_key` verschlüsselt und
  `ai_budget_notice` für die Budgetmails).
- **Audit-Log**: Einstellungen (`ai.settings_update`), Schlüssel, Schalter pro Kunde, Ablehnungen,
  Budgetwarnungen.

Aufgeräumt wird kurz nach dem Start und danach alle 10 Minuten. Dabei werden auch Anfragen als "Ohne
Abschluss" markiert, die länger als `AI_TURN_TIMEOUT_SECONDS` plus eine Minute laufen, zum Beispiel nach
einem Absturz oder Deploy.

## Demo-Modus

Mit `ENABLE_DEMO_PROVIDER=true` und ohne Schlüssel (weder auf der KI-Seite noch in `ANTHROPIC_API_KEY`) läuft
die KI im Demo-Modus:

- Die Antworten kommen von einem Nachbau in der Console, nicht von Claude. Sie beginnen mit "[Demo]" und
  tragen das Zeichen "Demo".
- Der Ablauf ist derselbe wie im Betrieb: Schalter, Limits, Werkzeuge, Prüfungen und die Zeilen in
  `ai_usage`. Nur kosten die Anfragen nichts.
- Der Hauptschalter ist von Anfang an eingeschaltet, und das Einschalten fragt die Punkte vor dem Einschalten
  nicht ab.
- Die Demo-Daten (`pnpm db:seed`) schalten die KI für Muster AG und Alpen Hosting ein. Beispiel GmbH und
  Bäckerei Huber bleiben aus, damit man die Schalter sieht.
- "Mit KI übersetzen" speichert statt einer Übersetzung den deutschen Text mit dem Sprachcode davor, zum
  Beispiel "[FR] Speichern". Diese Texte zeigt die Console nur im Demo-Modus. Sie werden gelöscht, sobald auf
  der KI-Seite ein echter Schlüssel gespeichert wird.

## Die KI-Seite

Die KI-Seite (`platform:settings`, also nur Superadmins) hat drei Tabs. Alles darauf geht auch, solange die
KI aus ist.

**Einstellungen:** Status und Hauptschalter mit "Verbindung testen", API-Schlüssel, Modell, Funktionen,
Budget und Limits, Datenschutzhinweis.

**Nutzung:** pro Monat Anfragen, Tokens, Kosten und Budget, aufgeteilt nach Funktion, Modell, Kunde und Tag.
Anfragen ohne Daten eines Kunden stehen als "Plattform (ohne Kundendaten)".

**Fehler:** fehlgeschlagene Anfragen mit Zeit, Funktion, Kunde, Person, Modell, Status, Grund, Meldung und
Request-ID. Filter nach Funktion, Status ("Abgelehnt", "Unvollständig", "Fehler", "Ohne Abschluss") und
Quelle ("Claude API" oder "weblion.one"). Die Spalte "Grund" und das Ergebnis von "Verbindung testen" zeigen:

- **Schlüssel ungültig oder widerrufen** (401): Anthropic kennt den Schlüssel nicht. Schlüssel ersetzen.
- **Schlüssel ohne Berechtigung** (403): Der Schlüssel darf das nicht. Schlüssel und Workspace in der Claude
  Console prüfen.
- **Abrechnung oder Guthaben bei Anthropic:** Das Konto bei Anthropic hat kein Guthaben oder ein Problem in der
  Abrechnung.
- **Modell nicht verfügbar** (404): Das gewählte Modell ist für das Konto nicht verfügbar. Ein anderes Modell
  wählen oder das Konto bei Anthropic prüfen.
- **Anfrage abgelehnt** (400, 409, 413, 422): Anthropic hat die Anfrage als ungültig abgelehnt. Die
  Request-ID notieren und den Fehler melden.
- **Fehler bei Anthropic** (5xx): Fehler auf der Seite von Anthropic. Später nochmals versuchen.
- **Keine Verbindung:** Die Console erreicht `api.anthropic.com` (oder `ANTHROPIC_BASE_URL`) nicht, oder die
  Verbindung brach ab. Netz und Firewall nach aussen prüfen.
- **Ungültige Antwort:** Die Antwort passte nicht zum verlangten Format.
- **Überlastet** (529) und **Anfragelimit von Anthropic** (429): Anthropic ist ausgelastet oder das Konto hat
  sein Limit bei Anthropic erreicht.
- **Zeitüberschreitung:** Die Anfrage dauerte zu lange (`AI_TURN_TIMEOUT_SECONDS`).
- **Cybersicherheit**, **Biologische Risiken**, **Entwicklung von KI-Modellen**, **Ausgabe der Denkschritte**,
  **Schädliche Inhalte:** Claude hat die Anfrage aus diesem Grund abgelehnt.

Ohne Grund zeigt die Spalte den Fehlercode. Die Meldungen von Anthropic stehen nur hier und nur 30 Tage. Wer
eine KI-Funktion nutzt, sieht eine feste Meldung in der eigenen Sprache, nie den Text von Anthropic, weil er
Angaben zum Konto von weblion.one enthalten kann.

## Datenschutzhinweis

Den Hinweis sehen Kunden im Assistenten, unter jedem Ergebnis ("Datenschutzhinweis") und in ihren
Einstellungen ("Datenschutzhinweis lesen"). Er ist der Übersetzungsschlüssel `ai.notice.text` (Titel
`ai.notice.title`) und sagt in einfachen Worten:

- dass Anthropic PBC mit Sitz in den USA Unterauftragsverarbeiter ist und die Daten in den USA verarbeitet
  werden können
- welche Daten mitgehen, und dass auch Mitarbeitende von weblion.one die KI für Daten des Kunden nutzen
- dass die Console erkannte Geheimnisse und in Einträgen des Audit-Logs IP- und E-Mail-Adressen entfernt,
  dass das nicht jeden Fall erfasst, dass Namen in Einträgen des Audit-Logs mitgehen können und dass die KI
  von der fragenden Person nur die Rolle erhält
- was nach den kommerziellen Bedingungen von Anthropic mit den Daten geschieht (Training, Aufbewahrung)
- dass die Console keine Fragen und Antworten speichert und die KI nur liest
- wo der Kunde die KI ablehnen kann (Einstellungen > KI-Funktionen)

Der Text lässt sich pro Sprache unter Admin > Übersetzungen bearbeiten, die Karte "Datenschutzhinweis" auf
der KI-Seite führt mit "Text bearbeiten" dorthin. Er wird nie maschinell übersetzt. Ist eine Übersetzung nach
einer Änderung am deutschen Text veraltet, zeigt die Console den englischen Text, wenn dieser aktuell ist,
sonst den deutschen, bis jemand die Übersetzung nachführt. "Als geprüft markieren" auf der KI-Seite hält fest,
wer den Text wann geprüft hat. Mehr dazu in [i18n.md](i18n.md#rechtstexte).

## Betrieb

| Variable                  | Standard                    | Wozu                                                                   |
| ------------------------- | --------------------------- | ---------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`       | leer                        | Schlüssel, falls keiner auf der KI-Seite gespeichert ist               |
| `ANTHROPIC_BASE_URL`      | `https://api.anthropic.com` | Adresse der Claude API (die Tests zeigen auf einen Nachbau)            |
| `ANTHROPIC_MAX_RETRIES`   | 2                           | Wiederholungen bei 408, 409, 429, 5xx und Verbindungsfehlern (0 bis 5) |
| `AI_TURN_TIMEOUT_SECONDS` | 180                         | längste Dauer einer Anfrage in Sekunden (30 bis 600)                   |

Die Console braucht HTTPS nach aussen zu `api.anthropic.com`. Der Assistent antwortet als Datenstrom
(Server-Sent Events) und sendet alle 15 Sekunden ein Lebenszeichen. Damit nginx den Strom nicht puffert,
schickt die Console `X-Accel-Buffering: no`. Der Reverse Proxy muss mindestens 60 Sekunden auf Daten warten
(bei nginx `proxy_read_timeout`). Einzelheiten in [deployment.md](deployment.md).

## Vor dem Einschalten

Diese Punkte erledigt der Inhaber, bevor er den Hauptschalter im Betrieb einschaltet. Die Punkte 1 bis 4 fragt
der Dialog beim Einschalten ab, jedes Mal, und das Audit-Log hält die Bestätigung fest
(`ai.settings_update`).

1. **AGB und Auftragsverarbeitungsvertrag.** Anthropic PBC (USA) in die Liste der Unterauftragsverarbeiter
   aufnehmen: Zweck (KI-Funktionen der Console), Kategorien von Daten (Namen und Messwerte von Ressourcen,
   DNS-Einträge, Fehlermeldungen, Einträge im Audit-Log ohne IP- und E-Mail-Adressen, Fragen an den
   Assistenten), Ort (USA), Link auf den Auftragsverarbeitungsvertrag (DPA) von Anthropic. Die Änderung so
   bekannt machen, wie es die Klausel zu Vertragsänderungen verlangt.
2. **Rechtliche Grundlage für die Übermittlung in die USA** (nDSG, für Kunden in der EU die DSGVO). Auf der
   offiziellen Liste prüfen, ob Anthropic unter dem Swiss-U.S. Data Privacy Framework zertifiziert ist. Sonst
   gelten die Standardvertragsklauseln im DPA von Anthropic mit dem Schweizer Zusatz und eine Abklärung der
   Übermittlung. Ergebnis und Datum festhalten.
3. **Datenschutzhinweis.** Den Satz "Nach den kommerziellen Bedingungen von Anthropic ..." mit den Commercial
   Terms und dem DPA von Anthropic vergleichen, die an diesem Tag gelten, auch mit der Dauer der Aufbewahrung
   und einer allfälligen Vereinbarung ohne Aufbewahrung (Zero Data Retention). Den Text bei Bedarf unter
   Admin > Übersetzungen anpassen. **Der Inhaber prüft den Hinweis in allen fünf Sprachen, also Deutsch,
   Englisch, Französisch, Italienisch und Niederländisch, am besten mit einer Anwältin oder einem Anwalt.**
   Nicht nur der deutsche Text muss rechtlich stimmen, jede Übersetzung muss es auch. Danach auf der KI-Seite
   "Als geprüft markieren".
4. **Workspace bei Anthropic.** In der Claude Console den Workspace prüfen, zu dem der Schlüssel gehört: den
   Ort der Speicherung und Verarbeitung, falls Anthropic dort eine Wahl anbietet, und ein Ausgabenlimit, das
   nicht höher ist als das Budget der Console (eine zweite Sicherung). Weicht der Ort vom Hinweis ab, den
   Hinweis anpassen.
5. **Schlüssel.** Auf der KI-Seite speichern, dann "Verbindung testen".
6. **Preise.** Die Preise oben mit der Preisseite von Anthropic vergleichen. Eine Abweichung ist eine Änderung
   im Code (`AI_PRICES` in `packages/shared/src/ai.ts`).
7. **Budget, Limits und Funktionen** einstellen, dann den Hauptschalter einschalten.
8. **Kunden einzeln einschalten.** Nach dem Hauptschalter bleibt die KI für jeden Kunden aus. Einen Kunden
   erst einschalten (Admin > Kunden > Kunde, Karte "KI", oder durch seinen Reseller), wenn er im Vertrag oder
   in einem Nachtrag zum Auftragsverarbeitungsvertrag zugestimmt hat. Der Dialog fragt die Zustimmung ab, das
   Audit-Log hält sie fest. Eine Mitteilung an alle Kunden braucht es nicht, weil kein Kunde ohne Zustimmung
   eingeschaltet wird. Ein Kunde kann die KI auch danach jederzeit ablehnen.

## Später

Nicht gebaut, vorgemerkt in der [Roadmap](roadmap.md):

- **Aktionen mit vorausgefülltem Formular (Stufe 2):** Der Assistent öffnet das normale Formular für ein
  Postfach, einen Alias, eine Weiterleitung, einen Monitor, eine Website, die PHP-Version oder das Leeren des
  Caches. Speichern würde weiterhin nur die Person.
- **KI-Nutzung weiterverrechnen:** die Kosten der KI an Kunden verrechnen.
- **Modell pro Funktion:** ein eigenes Modell für jede Funktion statt einem für alle.
- **Verarbeitung in der EU oder der Schweiz**, falls Anthropic sie anbietet.
- **Message Batches** von Anthropic für sehr grosse Übersetzungen.
- **Für Mitarbeitende** eine Zusammenfassung eines Kunden, und Vorschläge für Monitore aus dem Assistenten.
