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
**Domains & DNS**, **Webhosting**. Was nicht freigeschaltet ist, taucht weder in der
Navigation auf noch ist es über die API erreichbar, auch nicht für den Owner des Kunden.
Plattform-Admins sehen immer alles.

Freischalten geht an drei Stellen:

- Admin > Kunden > Kunde > Module
- Reseller > Meine Kunden > Kunde (nur Module, die der Reseller selbst hat)
- automatisch, wenn ein Dienst mit Modul angelegt oder eine Domain/ein Webspace zugewiesen wird

## Reseller

Ein Reseller ist eine Organisation vom Typ "Reseller". Seine Mitarbeitenden:

- legen eigene Kunden an (mit Einladung für den Owner), sperren sie und schalten Module frei
- öffnen das Panel eines Kunden und arbeiten dort mit ihrer eigenen Rolle (ein Reseller-Owner
  darf beim Kunden alles, ein Reseller-Viewer nur lesen)
- verschieben Server, Domains und Webspaces aus dem eigenen Bestand zu ihren Kunden (nicht,
  solange der bisherige Kunde dafür einen laufenden Dienst hat; was die Plattform dem
  Reseller selbst verrechnet, darf er weitergeben)
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
