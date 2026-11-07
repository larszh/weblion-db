# Abrechnung, Reseller und Module

## Wer stellt wem Rechnung

- Kunden direkt bei weblion.one bekommen ihre Rechnungen von der **Plattform**
  (Rechnungssteller in Admin > Einstellungen > Abrechnung).
- Kunden unter einem **Reseller** bekommen ihre Rechnungen vom Reseller. Er hat einen eigenen
  Nummernkreis, eigene Produkte und Preise und eigene Rechnungsstellerdaten (Adresse, IBAN).
- Der Reseller selbst ist ein normaler Kunde der Plattform und wird von weblion.one
  abgerechnet.

Online-Zahlung (Stripe, Karte und TWINT) und Zoho Books gibt es nur für Rechnungen der
Plattform. Reseller-Kunden zahlen per Überweisung (QR-Rechnung), der Reseller bucht die
Zahlung von Hand. Wer das später auch online will, braucht Stripe Connect (siehe Roadmap).

## Bausteine

| | |
|---|---|
| **Produkte** | Preisliste (Name, Preis, Intervall einmalig/monatlich/quartalsweise/jährlich, MWST, Modul). Plattform-Katalog und je ein Katalog pro Reseller. |
| **Dienste** | Was ein Kunde hat und bezahlt, z.B. "Cloud Server S" verknüpft mit einem bestimmten Server. Ein Dienst kann ein Modul freischalten. |
| **Rechnungen** | Entwurf, dann "abschliessen": Nummer (lückenlos pro Rechnungssteller und Jahr, z.B. `WL-2026-00001`), PDF mit Schweizer QR-Rechnung, optional per E-Mail. Danach unveränderlich, nur noch stornieren (solange nichts bezahlt ist). |
| **Guthaben** | Konto pro Kunde. Gutschrift, Korrektur, Rückerstattung durch den Verkäufer, Aufladen per Stripe durch den Kunden. Offene Rechnungen lassen sich aus dem Guthaben bezahlen, optional automatisch beim Abschliessen. |
| **Zahlungen** | Stripe (Karte, TWINT), manuell gebucht (Überweisung, bar) oder aus Guthaben. |

Ohne eigenes Abrechnungsprofil wird ein Kunde in der Standardwährung seines Verkäufers
abgerechnet (Rechnungsstellerdaten der Plattform bzw. des Resellers). Wie die Plattform den
Reseller selbst abrechnet, spielt dafür keine Rolle. Ändert ein Verkäufer seine
Standardwährung, behalten Kunden mit Diensten, Rechnungen, Zahlungen oder Guthaben ihre
bisherige Währung.

Beträge werden intern als ganze Rappen gespeichert, MWST als Basispunkte (8.1 % = 810).
Alle Geldbewegungen laufen in einer Transaktion mit Sperre pro Kunde, damit Guthaben nicht
doppelt ausgegeben und keine Rechnung doppelt bezahlt werden kann.

### Wiederkehrende Abrechnung

Ein Job prüft einmal täglich alle aktiven Dienste mit fälligem Abrechnungsdatum und erstellt
pro Kunde eine Rechnung (eine Zeile pro Dienst und Periode). Standard ist ein Entwurf zur
Kontrolle, mit "Wiederkehrende Rechnungen automatisch abschliessen" gehen sie direkt raus.
Abschalten mit `BILLING_JOB_ENABLED=false`. Manuell geht es pro Kunde mit "Fällige Dienste
abrechnen".

### Kündigen

Ohne Datum, mit heute oder einem früheren Datum endet ein Dienst sofort: Er wird nicht mehr
abgerechnet, und "Modul sperren" schaltet das Modul gleich aus. "Heute" ist dabei das Datum in Zürich
(Europe/Zurich), in der API wie im Dialog, auch wenn der Browser in einer anderen Zeitzone läuft. Mit
einem späteren Datum ist die
Kündigung vorgemerkt ("Gekündigt per ..."): Der Dienst läuft bis zu diesem Tag weiter, behält seinen
Status (aktiv oder pausiert) und wird für jede Periode abgerechnet, die bis zu diesem Tag beginnt, die
letzte bis zum Enddatum, aber zum vollen Periodenpreis (nicht anteilig). Bezahlt der Kunde so für Tage,
die er nicht mehr nutzt, warnt der Dialog bei einem aktiven Dienst: Er nennt die Periode, die das
Enddatum noch voll verrechnet, also die letzte, die am oder vor dem Enddatum beginnt, und bietet den Tag
vor ihrem Beginn an ("Stattdessen per ... kündigen"), solange dieser Tag nicht vorbei ist. Endet der
Dienst vor der nächsten Rechnung oder am letzten Tag einer Periode, gibt es keinen Hinweis. Wichtig bei
Diensten, die gegen Ende eines Monats begonnen haben: Fällt der Rechnungstag auf das Monatsende (ein
Start am 31. rechnet im November am 30. ab), kostet "per Ende Monat" eine ganze Periode mehr. Am Tag
nach dem Enddatum beendet der tägliche Job den Dienst (Audit-Eintrag `service.end`, Akteur
"Abrechnungsjob") und sperrt erst dann das Modul, falls gewählt. Der Job rechnet zuerst ab und
beendet danach. Hat ein aktiver Dienst noch eine Periode bis zum Enddatum offen (etwa weil sie in einer
anderen Währung steht oder der Betrag nicht passt), bleibt er aktiv, bis sie abgerechnet ist. Das
Beenden läuft auch mit `BILLING_JOB_ENABLED=false`, dann bleibt ein solcher Dienst aktiv, bis "Fällige
Dienste abrechnen" die Perioden abgerechnet hat.

"Modul sperren" gilt nur, solange der Kunde keinen anderen laufenden Dienst mit demselben Modul hat
(aktiv oder pausiert, ohne Enddatum oder mit einem Enddatum ab heute). Das prüft die Console beim
Sperren selbst, bei einer vorgemerkten Kündigung also erst am Ende: Hat der Kunde bis dahin etwa
einen neuen Dienst mit dem Modul bekommen (Wechsel des Pakets), bleibt das Modul aktiv, und
`service.end` bzw. `service.cancel` vermerkt `moduleKept` statt `moduleDeactivated`. Von zwei
Diensten mit demselben Modul kann es also erst der sperren, der zuletzt endet.

Eine vorgemerkte Kündigung lässt sich bis zum Enddatum ändern (nochmals kündigen, mit heute endet der
Dienst sofort) oder mit "Kündigung zurücknehmen" aufheben (`POST /services/:id/cancel/withdraw`,
Audit-Eintrag `service.cancel_withdraw`). Die Abrechnung geht dann mit der Periode nach dem alten
Enddatum weiter. Nach dem Enddatum lehnen beide Routen ab (409), auch wenn der Dienst noch auf die
Abrechnung seiner letzten Periode wartet: Eine neue Kündigung würde diese Periode verwerfen oder den
Dienst wieder öffnen. Die Tabelle zeigt einen solchen Dienst als "Gekündigt per ..., endet, sobald bis
dahin abgerechnet ist". Lässt sich die Periode nicht automatisch abrechnen (andere Währung), stellt der
Verkäufer sie von Hand in Rechnung und leert unter "Bearbeiten" die nächste Rechnung; danach beendet
der Job den Dienst. Ein beendeter Dienst lässt sich nicht mehr ändern. Gutschriften für Perioden, die
schon über das Enddatum hinaus verrechnet sind (etwa ein Jahresdienst), entstehen nicht von selbst.

### Früher sofort beendete Kündigungen wiederherstellen

Bis zur Korrektur im November 2026 beendete eine Kündigung auf ein späteres Datum den Dienst sofort: Status
"Gekündigt", kein nächstes Abrechnungsdatum, und "Modul sperren" schaltete das Modul gleich aus. Die Perioden
bis zum Enddatum wurden nie abgerechnet. Einen gekündigten Dienst mit einem Enddatum nach heute hinterlässt
nur dieser alte Weg: Eine sofortige Kündigung endet heute oder früher, und der tägliche Job beendet nur
Dienste, deren Enddatum vorbei ist.

Die Diensttabelle des Verkäufers zeigt einen solchen Dienst als "Sofort beendet, gekündigt per ...". Die
Karte "Früher gekündigte Dienste prüfen" listet alle, solange es welche gibt: unter Admin > Abrechnung die
Kunden der Plattform (`GET /admin/billing/services/ended-early`), in der Kundenliste eines Resellers seine
Kunden (`GET /orgs/:orgId/reseller/services/ended-early`), jeweils mit einem Link zu den Diensten des Kunden.
Dort stellt "Kündigung per ... wiederherstellen" die Kündigung her, wie sie heute vorgemerkt würde: Der Dienst
läuft wieder, behält Enddatum und Kündigungszeitpunkt, wird bis zum Enddatum abgerechnet und danach vom
täglichen Job beendet (`POST /services/:id/resume`, Audit-Eintrag `service.resume`).

Die alte Kündigung hat Status und Abrechnungsdatum überschrieben. Beides kommt aus dem, was vor ihr
geschrieben wurde:

- **Status:** War der Dienst pausiert (die letzte Änderung `service.update` mit einem Status vor der
  Kündigung), kommt er pausiert zurück, wie eine vorgemerkte Kündigung die Pause behält. Verrechnet wird erst,
  wenn der Verkäufer ihn fortsetzt, dann ab der Periode, die an diesem Tag beginnt. Sonst ist er aktiv.
- **Abrechnungsdatum:** von zwei Daten das, das später geschrieben wurde. Das eine setzte eine Änderung von Hand (ein verschobenes
  Datum, eine fortgesetzte Pause, `service.update` mit `nextBillingAt`). Das andere ist die Periode nach der
  letzten, für die eine Rechnung eine Zeile des Dienstes hat. Entwürfe zählen, stornierte Rechnungen auch,
  ausser sie wurden von Hand angelegt: Der Lauf hat das Datum beim Erstellen weitergeschoben und verrechnet
  eine stornierte Periode nie noch einmal. Ohne beides beginnt die Abrechnung am Startdatum.

Der Dialog (`GET /services/:id/resume`) listet die unverrechneten Perioden, die vor heute begonnen haben, mit
den Beträgen des Abrechnungslaufs (ohne MWST) und dem "Total nicht verrechnet". Der Verkäufer wählt:

- **Nachverrechnen:** Die Abrechnung geht mit der ersten unverrechneten Periode weiter, der nächste Lauf
  stellt die verpassten Perioden in Rechnung.
- **Erst ab der nächsten Periode:** Die Abrechnung geht mit der ersten Periode weiter, die heute oder
  später beginnt. Die verpassten Perioden bleiben unverrechnet.
- **Modul wieder einschalten**, wenn der Kunde es nicht mehr hat (wie beim Anlegen eines Dienstes). Ein
  Reseller kann das nur mit Modulen, die er selbst hat, sonst ist der Schalter gesperrt. Dazu **Modul am
  Enddatum sperren** (wie bei einer vorgemerkten Kündigung, also nur, wenn bis dahin kein anderer laufender
  Dienst das Modul hat).

Unter der Wahl steht, was der Lauf damit bis zum Enddatum noch in Rechnung stellt, von wann bis wann und für
wie viel. Kürzt das Enddatum die letzte Periode, sagt der Dialog wie beim Kündigen, dass sie voll verrechnet
wird. Hat der Verkäufer dem Kunden seit der Kündigung Rechnungen mit Zeilen ohne Dienst gestellt, nennt der
Dialog sie: Darin können Perioden stehen, die er schon von Hand verrechnet hat.

Vorgewählt ist "Nachverrechnen", ausser die alte Kündigung hat das Modul gesperrt (ihr Audit-Eintrag
`service.cancel` nennt es unter `moduleDeactivated`) und es ist noch aus: Dann konnte der Kunde den Dienst
nicht nutzen, und "erst ab der nächsten Periode" und "wieder einschalten" sind vorgewählt. Ist das Modul
inzwischen wieder an, weist der Dialog darauf hin. "Am Enddatum sperren" ist vorgewählt, wenn die alte
Kündigung das Modul gesperrt hat. Ein einmaliger Dienst hat keine Perioden: Ist er verrechnet, bleibt es dabei,
sonst stellt ihn der nächste Lauf in Rechnung, sofern sein Datum nicht nach dem Enddatum liegt.

Die Routen antworten mit 409 und dem Grund in `details.reason`:

- `notEndedEarly`: Der Dienst ist nicht (mehr) gekündigt mit einem Enddatum nach heute. Ist das Enddatum
  schon vorbei, gilt er als beendet. Fehlende Perioden bis dahin stellt der Verkäufer bei Bedarf von Hand in
  Rechnung. Solche Dienste findet er im Audit-Log unter der Aktion `service.cancel`: Einträge ohne
  `scheduled`, deren `endsAt` nach dem Tag des Eintrags liegt.
- `sellerChanged`: Der Kunde hat seit dem Verkauf des Dienstes den Verkäufer gewechselt (ein Wechsel im
  Audit-Log nach dem Anlegen des Dienstes, ein Produkt aus einem anderen Katalog oder eine Zeile auf einer
  Rechnung eines anderen Rechnungsstellers). Der Dienst gehört dem bisherigen Verkäufer, der neue darf ihn nicht
  abrechnen. Die Listen zeigen solche Dienste nicht. Seit der Korrektur sperrt ein solcher Dienst den Wechsel
  des Verkäufers, bis sein Enddatum vorbei ist (siehe [Reseller](#reseller)).

### Domain-Verlängerungen

Verlängert Joker.com eine Domain (automatisch oder über "Jetzt verlängern" im Admin-Bereich),
belastet Joker sofort das Reseller-Konto von weblion.one. Eine Rechnung an den Kunden entsteht
dabei nicht. Wer die Domain weiterverrechnen will, legt beim Kunden einen Dienst mit einem
jährlichen Produkt an und verknüpft ihn mit der Domain, die wiederkehrende Abrechnung stellt
ihn dann jedes Jahr in Rechnung. Die direkte Kopplung von Verlängerung und Rechnung steht auf
der [Roadmap](roadmap.md).

## Module (Dienste freischalten)

Module sind die Bereiche, die ein Kunde in der Console sieht: **Cloud Server**,
**Domains & DNS** (mit den DNS-Zonen bei Cloudflare), **Webhosting**, **Cloud-Speicher**,
**E-Mail**. Was nicht freigeschaltet ist, taucht
weder in der Navigation auf noch ist es über die API erreichbar, auch nicht für den Owner des
Kunden. Plattform-Admins sehen immer alles.

Freischalten geht an diesen Stellen:

- Admin > Kunden > Kunde > Module
- Reseller > Meine Kunden > Kunde (nur Module, die der Reseller selbst hat)
- automatisch, wenn ein Dienst mit Modul angelegt oder eine Domain, ein Webspace oder eine
  Mail-Domain zugewiesen wird (abschaltbar)
- automatisch, wenn ein Kontingent für Cloud-Speicher eingerichtet wird (bei weblion.one
  abschaltbar)

## Reseller

Ein Reseller ist eine Organisation vom Typ "Reseller". Seine Mitarbeitenden:

- legen eigene Kunden an (mit Einladung für den Owner), sperren sie und schalten Module frei
- öffnen das Panel eines Kunden und arbeiten dort mit ihrer eigenen Rolle (ein Reseller-Owner
  darf beim Kunden alles, ein Reseller-Viewer nur lesen)
- verschieben Server, Domains, Webspaces und Mail-Domains aus dem eigenen Bestand zu ihren
  Kunden (nicht, solange der bisherige Kunde dafür einen laufenden Dienst hat; was die Plattform
  dem Reseller selbst verrechnet, darf er weitergeben)
- teilen ihren Kunden einen Teil ihres Cloud-Speicher-Kontingents zu (siehe unten)
- erstellen Rechnungen, buchen Guthaben und verwalten Dienste und Preise ihrer Kunden

Grenzen: Ein Reseller kann seinen Kunden nie mehr geben, als er selbst hat. Seine
Berechtigungsgrenze und seine Module gelten auch für alle Kunden darunter. Sperrt weblion.one
den Reseller, sind auch seine Kunden nur noch lesend, auch für die Mitarbeitenden des
Resellers. Eine Sperre durch weblion.one kann ein Reseller nicht aufheben. API-Tokens eines
Resellers erreichen auch seine Kunden, aber nie den Admin-Bereich.

Plattform-Admins legen Reseller unter Admin > Kunden an (Typ "Reseller") und können bestehende
Kunden einem Reseller zuordnen. Der Wechsel des Verkäufers ist gesperrt, solange beim Kunden
noch Guthaben, offene Rechnungen, Entwürfe, ausstehende Zahlungen oder laufende Dienste
existieren: Das Geld gehört jeweils dem bisherigen Verkäufer. Als laufend zählt auch ein Dienst,
den eine Kündigung auf ein späteres Datum bis November 2026 sofort beendet hat, solange sein
Enddatum nach heute liegt: Wiederhergestellt würde er sonst über den neuen Verkäufer abgerechnet.

## Cloud-Speicher (Nextcloud) verkaufen

weblion.one verkauft Konten auf der eigenen Nextcloud. Was ein Kunde dabei bekommt, legen zwei
getrennte Dinge fest:

- Das **Kontingent** (Speicher gesamt, Konten höchstens) bestimmt, was technisch geht. Es hängt
  am Kunden, nicht an einem Dienst. Darin legt der Kunde seine Konten mit je eigenem Kontingent
  selbst an.
- Der **Dienst** bestimmt, was der Kunde bezahlt.

Die Console verknüpft beides nicht. Ein grösseres Kontingent ändert keinen Preis, ein gekündigter
Dienst entfernt kein Kontingent und sperrt keine Konten. Wer das eine ändert, ändert das andere
mit. Einrichtung der Instanz und alle Regeln in [providers.md](providers.md#nextcloud-cloud-speicher).

### Einrichten

Beispiel: Muster AG bekommt 100 GB für bis zu 10 Personen.

1. **Produkt** unter Admin > Produkte & Preise, z.B. "Cloud-Speicher 100 GB", monatlich, Modul
   "Cloud-Speicher". Zwei übliche Varianten:
   - Pakete mit festem Speicher und fester Zahl an Konten (50 GB für 5 Konten, 200 GB für 20
     Konten)
   - ein Preis pro Einheit, z.B. "Cloud-Speicher pro 10 GB", und die Menge im Dienst (Menge 10 =
     100 GB)
2. **Dienst** beim Kunden aus dem Produkt anlegen (Admin > Kunden > Kunde > Abrechnung > Dienste >
   Dienst hinzufügen), mit "Modul «Cloud-Speicher» freischalten".
3. **Kontingent** beim Kunden einrichten: Admin > Kunden > Kunde, Karte "Cloud-Speicher": Instanz,
   100 GB, 10 Konten.
4. Der Kunde legt unter "Cloud-Speicher" seine Konten an und verteilt die 100 GB selbst.

### Ändern und kündigen

- **Mehr Speicher:** Kontingent erhöhen und den Dienst anpassen (Menge oder Preis ändern oder einen
  zweiten Dienst anlegen).
- **Weniger Speicher:** Das Kontingent lässt sich nicht unter das senken, was der Kunde schon an
  Konten vergeben hat. Er verkleinert oder löscht zuerst Konten.
- **Kündigen:** Zuerst die Konten löschen, der Kunde selbst oder weblion.one im Panel des Kunden
  unter "Cloud-Speicher". Das löscht alle Dateien, also vorher mit dem Kunden klären, bis wann er
  seine Daten sichert. Bis dahin lassen sich die Konten deaktivieren. Dann das Kontingent
  entfernen (geht erst ohne Konten) und den Dienst kündigen, mit "Modul sperren". Das Modul allein
  zu sperren reicht nicht: Es blendet den Cloud-Speicher nur in der Console aus, die Konten in
  Nextcloud laufen weiter.
- **Sperren** (z.B. wegen offener Rechnungen) macht die Console für den Kunden nur lesend. Die
  Nextcloud-Konten bleiben nutzbar. Wer den Zugang wirklich sperren will, deaktiviert die Konten
  von Hand und aktiviert sie nach dem Entsperren wieder.

Eine Abrechnung nach tatsächlich belegtem Speicher oder pro Konto gibt es nicht. Die Belegung
zeigt die Karte "Cloud-Speicher" beim Kunden. Ideen dazu in der [Roadmap](roadmap.md).

### Über Reseller

- weblion.one gibt dem Reseller ein Kontingent und das Modul "Cloud-Speicher" und rechnet es mit
  einem Dienst bei ihm ab, wie oben.
- Der Reseller legt in seinem Katalog (Reseller > Produkte & Preise) eigene Produkte mit Modul
  "Cloud-Speicher" an und bei seinen Kunden Dienste.
- Unter Reseller > Meine Kunden > Kunde > Ressourcen teilt er dem Kunden einen Teil seines
  Kontingents zu. Speichern schaltet beim Kunden auch das Modul frei.
- Eigene Konten und alle Kundenkontingente zusammen passen immer in das Kontingent des
  Resellers. Mehr verteilen lehnt die Console ab.
- Kündigt ein Kunde, löscht er (oder der Reseller im Panel des Kunden) zuerst die Konten. Danach
  entfernt der Reseller das Kontingent auf derselben Karte, der Speicher geht in sein Kontingent
  zurück. Erst dann lässt sich der Kunde löschen.

## E-Mail (Mailcow) verkaufen

weblion.one verkauft E-Mail-Domains auf eigenen Mailcow-Servern. Wie beim Cloud-Speicher sind es
zwei getrennte Dinge:

- Die **Limits** der Mail-Domain (Postfächer, Weiterleitungen, Speicher gesamt, Grösse pro Postfach,
  Versandlimit) bestimmen, was technisch geht. Sie hängen an der Mail-Domain und gelten bei Mailcow.
  Mailcow begrenzt den vergebenen Speicher (die Summe der Postfachgrössen), nicht den belegten.
  Verkauft wird deshalb am besten der vergebene.
- Der **Dienst** bestimmt, was der Kunde bezahlt.

Die Console verknüpft beides nicht. Ein Dienst lässt sich noch nicht mit einer Mail-Domain
verknüpfen, nur mit Servern, Domains und Webspaces.

### Einrichten

1. **Produkt** unter Admin > Produkte & Preise, z.B. "E-Mail Business, 10 Postfächer, 25 GB",
   monatlich, Modul "E-Mail".
2. **Dienst** beim Kunden aus dem Produkt anlegen, mit "Modul «E-Mail» freischalten".
3. **Mail-Domain** anlegen: Admin > Domains & Webspaces > E-Mail-Domains > "Mail-Domain anlegen",
   mit den Limits aus dem Produkt und dem Kunden. Eine Domain, die bei Mailcow schon existiert,
   erscheint nach dem Sync und wird dort zugewiesen.
4. Der Kunde legt unter "E-Mail" seine Postfächer und Weiterleitungen an und trägt die DNS-Einträge
   ein (oder lässt sie die Console eintragen, wenn die Domain in der Console liegt).

### Ändern und kündigen

- **Mehr oder weniger:** "Limits ändern" bei der Mail-Domain und den Dienst anpassen. Mailcow lehnt
  Limits unter dem Verbrauch ab.
- **Kündigen:** Die Postfächer löschen (der Kunde unter "E-Mail" oder weblion.one in seinem Panel),
  vorher mit dem Kunden klären, bis wann er seine E-Mails sichert. Dann die Mail-Domain löschen
  (geht erst ohne Postfächer) und den Dienst kündigen. Die Zuweisung zu lösen oder das Modul zu
  sperren reicht nicht: Bei Mailcow fliessen die E-Mails weiter.
- **Sperren** macht die Console für den Kunden nur lesend, die E-Mails fliessen weiter. Wer das
  stoppen will, schaltet die Domain unter "Limits ändern" auf inaktiv.

Einrichtung der Instanz und alle Regeln in [providers.md](providers.md#mailcow-e-mail). Über
Reseller: weblion.one gibt dem Reseller Mail-Domains und das Modul "E-Mail", der Reseller gibt sie
unter Reseller > Meine Kunden > Kunde > Ressourcen an seine Kunden weiter. Die Limits ändert nur
weblion.one.

## Streaming: Anfragen als Option

Streaming-Kontingente sind wie der Cloud-Speicher vom Dienst getrennt, und das gilt auch für ihr
Add-on "Anfragen" (Seerr, siehe [providers.md](providers.md#anfragen-seerr)): Es folgt heute keinem
Dienst und kostet nichts extra. Wer es verrechnet, legt ein eigenes Produkt an (z.B. "Anfragen für
Filme und Serien", monatlich, Modul "Streaming"), legt den Dienst beim Kunden an und schaltet das
Add-on von Hand unter Admin > Kunden > Kunde, Karte "Streaming". Später wird es eine Option des
Streaming-Produkts, mit Typen und Grenzen pro Zugang und optional einem Preis pro Zugang mit
Anfragen. Das Kontingent bleibt dabei die einzige Quelle: Aktiviert die Abrechnung den Dienst, setzt
sie das Add-on über `setMediaRequests()` in `apps/api/src/modules/media/seerr.ts`, mit denselben
Prüfungen wie die Route im Admin-Bereich (ein Seerr auf der Instanz, ein Reseller nie enger als seine
Kunden) und demselben Audit-Eintrag `media.allowance_set` (ohne Benutzer mit dem Auslöser
"Billing"). Kündigen schaltet es aus: Die Zugänge verlieren das Recht anzufragen, ihre
Seerr-Benutzer und Anfragen bleiben in Seerr.
Siehe [Roadmap](roadmap.md#streaming-jellyfin).

## Stripe (Karte und TWINT)

1. Im Stripe-Dashboard unter Settings > Payment methods **TWINT aktivieren** (nur CHF).
2. Secret Key nach `STRIPE_SECRET_KEY` (zuerst `sk_test_...`).
3. Webhook anlegen: Endpoint `https://cp.weblion.cloud/api/v1/payments/stripe/webhook`,
   Events `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`. Das Signing Secret
   (`whsec_...`) nach `STRIPE_WEBHOOK_SECRET`.
4. Neu starten. Unter Admin > Einstellungen > Integrationen steht dann "Stripe: Testmodus"
   bzw. "Live".

Bezahlt wird über Stripe Checkout: Der Kunde wird zu Stripe weitergeleitet und kommt danach
zurück. Gebucht wird erst, wenn der signierte Webhook ankommt. Doppelte Webhooks buchen
nichts doppelt. Zahlt jemand eine Rechnung, die inzwischen schon bezahlt ist, landet der Betrag
als Guthaben.

## Zoho Books

1. In der Zoho API Console (`api-console.zoho.eu` für EU-Konten) einen **Self Client** anlegen,
   Scope `ZohoBooks.fullaccess.all`, Grant Code erzeugen und einmal gegen einen Refresh Token
   tauschen.
2. `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORGANIZATION_ID`
   setzen. Für US-Konten `ZOHO_ACCOUNTS_URL`/`ZOHO_API_URL` auf `.com` ändern.
3. In Zoho Books die Steuersätze anlegen (z.B. 8.1 %, 0 %) und ihre IDs als `ZOHO_TAX_IDS`
   eintragen: `810:<id>,0:<id>`.
4. Admin > Einstellungen > Integrationen > "Verbindung testen".

Was synchronisiert wird: Beim Abschliessen einer Plattform-Rechnung legt die Console den
Kontakt an (beim ersten Mal) und überträgt die Rechnung mit derselben Nummer, danach jede
Zahlung. Fehler stehen an der Rechnung und lassen sich mit "Erneut synchronisieren" oder
"Ausstehende synchronisieren" nachholen. Die Console bleibt die Quelle: Änderungen in Zoho
fliessen nicht zurück.

## QR-Rechnung

Ist beim Rechnungssteller eine IBAN hinterlegt, bekommt jede Rechnung in CHF oder EUR eine
Seite mit Schweizer QR-Zahlteil. Mit einer QR-IBAN wird eine QR-Referenz aus der
Rechnungsnummer erzeugt, mit einer normalen IBAN steht die Rechnungsnummer als Mitteilung drin.
Entwürfe bekommen das Wasserzeichen "ENTWURF" und keinen Zahlteil.

## E-Mail

SMTP entweder in der `.env` (`SMTP_HOST` usw., hat Vorrang und ist im Admin-Bereich dann nur
lesbar) oder unter Admin > Einstellungen > E-Mail (verschlüsselt in der Datenbank). Versendet
werden Einladungen, Rechnungen mit PDF, Zahlungsbestätigungen und Guthaben-Buchungen. Einladungen
gehen in der Sprache der eingeladenen Person, wenn sie schon ein Konto hat, sonst in der Sprache der
Person, die einlädt. Rechnungen, Zahlungsbestätigungen und Guthaben-Buchungen folgen der "Sprache für
Rechnungen" im Abrechnungsprofil des Kunden (leer: die Sprache des Owners), eine abgeschlossene
Rechnung behält ihre Sprache. Jede Mail steht im Mail-Log, auch fehlgeschlagene. Ohne SMTP läuft
alles weiter, die Mails werden dann als "übersprungen" protokolliert und Einladungslinks lassen sich
weiterhin kopieren.
