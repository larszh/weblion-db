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

### Domain-Verlängerungen

Verlängert Joker.com eine Domain (automatisch oder über "Jetzt verlängern" im Admin-Bereich),
belastet Joker sofort das Reseller-Konto von weblion.one. Eine Rechnung an den Kunden entsteht
dabei nicht. Wer die Domain weiterverrechnen will, legt beim Kunden einen Dienst mit einem
jährlichen Produkt an und verknüpft ihn mit der Domain, die wiederkehrende Abrechnung stellt
ihn dann jedes Jahr in Rechnung. Die direkte Kopplung von Verlängerung und Rechnung steht auf
der [Roadmap](roadmap.md).

## Module (Dienste freischalten)

Module sind die Bereiche, die ein Kunde in der Console sieht: **Cloud Server**,
**Domains & DNS**, **Webhosting**, **Cloud-Speicher**. Was nicht freigeschaltet ist, taucht
weder in der Navigation auf noch ist es über die API erreichbar, auch nicht für den Owner des
Kunden. Plattform-Admins sehen immer alles.

Freischalten geht an diesen Stellen:

- Admin > Kunden > Kunde > Module
- Reseller > Meine Kunden > Kunde (nur Module, die der Reseller selbst hat)
- automatisch, wenn ein Dienst mit Modul angelegt oder eine Domain/ein Webspace zugewiesen wird
- automatisch, wenn ein Kontingent für Cloud-Speicher eingerichtet wird (bei weblion.one
  abschaltbar)

## Reseller

Ein Reseller ist eine Organisation vom Typ "Reseller". Seine Mitarbeitenden:

- legen eigene Kunden an (mit Einladung für den Owner), sperren sie und schalten Module frei
- öffnen das Panel eines Kunden und arbeiten dort mit ihrer eigenen Rolle (ein Reseller-Owner
  darf beim Kunden alles, ein Reseller-Viewer nur lesen)
- verschieben Server, Domains und Webspaces aus dem eigenen Bestand zu ihren Kunden (nicht,
  solange der bisherige Kunde dafür einen laufenden Dienst hat; was die Plattform dem
  Reseller selbst verrechnet, darf er weitergeben)
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
existieren: Das Geld gehört jeweils dem bisherigen Verkäufer.

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
werden Einladungen, Rechnungen mit PDF, Zahlungsbestätigungen und Guthaben-Buchungen, auf
Deutsch oder Englisch je nach Sprache des Empfängers. Jede Mail steht im Mail-Log, auch
fehlgeschlagene. Ohne SMTP läuft alles weiter, die Mails werden dann als "übersprungen"
protokolliert und Einladungslinks lassen sich weiterhin kopieren.
