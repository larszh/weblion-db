# Ideen (Auszug, nach dem Neustart gerettet)

Die vollständige Datei `ideen-2026-11.md` ging beim Neustart verloren. Erhalten sind diese Auszüge und die Zusammenfassung in `summaries.md`.

## A. Erweitern, verbessern, vereinfachen

### A1. Vereinfachen

Sortiert nach Nutzen pro Aufwand.

**1. Ein Name und eine Ordnung für die Verwaltung** (S)
- Was: Heute heisst derselbe Bereich "weblion Admin" (`nav.section.admin`,
  `apps/web/src/i18n/de.ts:85`), "Plattform-Verwaltung" (`nav.platform`, `de.ts:75`) und in der Doku
  "Admin-Bereich". Du sagst "Verwaltung". Überall "Verwaltung" nehmen. Dazu die Navigation der
  Verwaltung nach Modulen ordnen wie bei den Kunden: Heute stecken Cloud-Speicher und E-Mail als Tabs
  unter "Domains & Webspaces", und die CloudPanel-Websites hängen im Tab "Webspaces"
  (`pages/admin/hosting.tsx:74`, `:181-218`), während Telefonie, Streaming und Monitoring eigene
  Seiten haben. Vorschlag: Übersicht, Kunden, Benutzer, dann Server, Domains & DNS, Websites &
  Webspaces, Cloud-Speicher, E-Mail, Telefonie, Streaming, Monitoring, dann Abrechnung, Produkte,
  Provider, API Explorer, Audit-Log, KI, Sprachen, Einstellungen.
- Warum: KI und Sprachen kommen jetzt als neue Einträge dazu. Vorher aufräumen kostet weniger als
  nachher, und du und der Support finden Dinge dort, wo die Kunden sie auch sehen.
- Wo: `apps/web/src/components/layout/app-shell.tsx:390-470`, `apps/web/src/App.tsx:266-289`,
  `pages/admin/hosting.tsx`, `pages/admin/cloud.tsx`, `pages/admin/mail.tsx`,
  `pages/admin/websites.tsx`, die i18n-Abschnitte, `README.md`, `docs/*.md` ("Admin-Bereich" ersetzen).

**2. Provider-Fähigkeiten aus der API statt acht Listen im Web** (S bis M)
- Was: Welche Provider-Typen Server, Domains, Cloud-Konten usw. haben, steht im Web an acht Stellen:
  `providerHasServers()` (`components/server-bits.tsx:161`), `HOSTING_PROVIDERS`
  (`pages/admin/hosting.tsx:83`), `isCloudProvider`, `isMailProvider`, `isWebsiteProvider`,
  `isPhoneProvider`, `isMediaProvider`, `isMonitoringProvider`. Die API weiss es schon
  (`supportsCloud()`, `supportsMail()`, ...). `ProviderConnectionDto` bekommt ein Feld `features:
  ProviderFeature[]` (`servers`, `domains`, `zones`, `webspaces`, `websites`, `cloud`, `mail`,
  `phone`, `media`, `monitoring`), berechnet in `toProviderDto()` (`modules/admin/routes.ts:598`).
  Das Web liest nur noch dieses Feld.
- Warum: Jede Integration aus Teil B heisst heute Änderungen an bis zu acht Web-Dateien, so steht es
  in `docs/providers.md` unter "Weitere Provider anbinden". Danach reichen Adapter und Registry.
- Wo: `modules/admin/routes.ts`, `packages/shared/src/dto.ts`, die acht Helfer, `docs/providers.md`.

**3. Zugangsdaten nur noch in der Verwaltung** (M)
- Was: `config/env.ts` hat rund 98 Variablen, pro Provider bis zu sechs. Provider aus der `.env`
  (`managedBy: 'env'`, `bootstrap.ts:335-360`) lassen sich in der Verwaltung nicht ändern
  (`modules/admin/routes.ts:691`, `:785`), SMTP aus der `.env` macht die Seite in der Verwaltung nur
  lesbar. Ziel: Die `.env` hält nur noch `DATABASE_URL`, `ENCRYPTION_KEY`, `APP_URL`,
  `BOOTSTRAP_ADMIN_*` und Betriebsschalter. Provider, SMTP, Stripe, Zoho und der Claude-Schlüssel
  liegen verschlüsselt in der Datenbank. Übergang ohne Bruch: Auf jedem Provider aus der `.env` ein
  Knopf "In die Verwaltung übernehmen" (setzt `managedBy` auf `ui`, leert `envKey`, Audit
  `provider.adopt_env`), danach meldet der Start eine Warnung, wenn die Variablen noch gesetzt sind.
- Warum: Ein Ort zum Rotieren von Schlüsseln, keine Geheimnisse in Dateien auf dem Server, und der
  Claude-Schlüssel kommt ohnehin in die Verwaltung. Spätere Verbindungen pro Reseller (z.B. Bexio)
  gehen ohnehin nur in der Datenbank.
- Wo: `config/env.ts`, `bootstrap.ts`, `modules/admin/routes.ts`, `modules/settings/routes.ts`,
  `.env.example`, `README.md`, `docs/deployment.md`.

**4. Kontingente: ein Baustein statt vier Kopien** (M)
- Was: Vier Kontingent-Tabellen (`cloud_allowances`, `website_allowances`, `media_allowances`,
  `monitor_allowances`) mit vier gleichen Sperr-Funktionen (`cloud/service.ts:144`,
  `hosting/website-allowance.ts:44`, `media/service.ts:227`, `monitoring/service.ts:240`) und vier
  Reseller-Seiten (`pages/reseller/*-allowance.tsx`, zusammen etwa 1160 Zeilen). Eine Funktion
  `lockAllowanceOrg(tx, scope, org)` in `apps/api/src/lib/allowance-lock.ts` und ein Web-Baustein
  `AllowanceForm` mit einer Feldliste. Die Tabellen bleiben, Migrationen nur additiv.
- Warum: Grundlage für die Kontingent-Vorlage am Produkt (A2.8) und für jedes weitere Kontingent
  (Object Storage, Backup-Speicher, VPN aus Teil B).
- Wo: die genannten Dateien.

**5. Registrierung und Zone als eine Domain** (M)
- Was: Eine Domain bei Joker und ihre Zone bei Cloudflare sind zwei Zeilen in der Liste. Eine Zeile
  mit zwei Kennzeichen ("Registrierung: Joker.com", "DNS: Cloudflare"), die Detailseite mit den Tabs
  beider. Die Verknüpfung über `lower(name)` gibt es schon.
- Warum: Kunden fragen sonst, welche Zeile die richtige ist. Steht schon in der Roadmap.
- Wo: `pages/hosting/domains.tsx`, `pages/hosting/domain-overview.tsx`, `modules/hosting/service.ts`.

**6. Roadmap ausmisten** (S)
- Was: Streichen oder parken: Monitoring bei 24fire schalten (die Roadmap sagt selbst "wenig Nutzen
  neben Uptime Kuma"), dedizierte 24fire-Server als Zeilen, Grafana pro Kunde (Graphen und Uptime
  Kuma reichen, eigene Grafana-Organisationen sind Betrieb ohne Umsatz), 3CX im
  Multi-Company-Modus, Hetzner-Firewalls in geteilten Projekten (ersetzt durch A3.4),
  Uptime-Kuma-Monitore für Kunden änderbar machen.
- Warum: Jeder Punkt kostet Design, Review und Test. Weniger Punkte heisst schneller fertig mit dem,
  was Geld bringt.
- Wo: `docs/roadmap.md`.

**7. Entscheid: 24fire-Webspaces weiterführen?** (S, eine Entscheidung)
- Was: Webspaces lassen sich über die API nicht anlegen, die Belegung ist unbekannt, Anmeldung nur
  per Plesk-Link. Wenn du neues Webhosting nur noch auf CloudPanel verkaufst: Webspaces als Bestand
  führen, keine neuen Funktionen, Kunden bei der Verlängerung auf CloudPanel umziehen.
- Warum: Spart die Punkte "Belegung", "Adresse von Plesk" und weitere Ausnahmen in
  `modules/hosting`.
- Wo: `docs/roadmap.md` (Abschnitt 24fire), `modules/hosting/routes.ts`.

### A2. Verbessern

**1. Die zwei Fehler beheben** (S)
- Was: Kündigung mit späterem `endsAt` lässt den Dienst `active` mit `cancelledAt`, ein täglicher
  Schritt im Abrechnungs-Job beendet ihn am Enddatum (dann auch Modul aus, wenn gewählt). Im
  Audit-Filter `%`, `_` und `\` maskieren statt entfernen.
- Warum: Heute verrechnest du die Restlaufzeit nie, und das Audit-Log ist für Codes mit `_` (fast
  alle) nicht durchsuchbar.
- Wo: `modules/billing/routes.ts:870`, `modules/billing/recurring.ts`, `modules/audit/routes.ts:26`,
  Tests in `apps/api/test/billing.test.ts` und `apps/api/test/api.test.ts`.

---

**2. Alarme an dich, mit Heartbeat** (S)
- Was: Sync und Abrechnung schreiben Fehler nur ins Log (`jobs/sync.ts`, `log.warn` an neun
**3. Backup der Datenbank der Console** (M)
- Was: Heute steht in `docs/deployment.md` nur ein `pg_dump` von Hand. Nächtlicher Dump, mit `age`
**4. Sicherheits-Grundlagen** (S)
- Was: `TRUST_PROXY` auf eine Anzahl Hops oder `127.0.0.1` setzen statt `true`. 2FA als Pflicht für
**5. Passwort vergessen** (S)
- Was: `POST /auth/password/forgot` (immer dieselbe Antwort, Rate-Limit) und `POST
**6. Aufgaben statt Zahlen auf der Übersicht der Verwaltung** (S)
- Was: Pro Art eine Zeile mit Link auf die gefilterte Liste: nicht zugewiesene Domains, Zonen,
**7. Fristen und Benachrichtigungen** (M)
- Was: Die Daten liegen schon in der Datenbank: Ablauf von Domains (`expiresAt`,
**8. Ein Lebenszyklus für Sperre, Kündigung und Kontingent** (M)
- Was: Jeder Abschnitt "Grenzen" in `docs/providers.md` (Nextcloud, Mailcow, CloudPanel, 3CX,
**9. Rechnungen, Mails und QR-Zahlteil in der Sprache des Empfängers** (S, zusammen mit der Übersetzung)
- Was: Neue Spalte `billing_profiles.locale` (leer heisst Sprache des Owners). Rechnung, PDF und Mail
**10. Hilfe, Kontakt und Einstieg** (S)
- Was: Eintrag "Hilfe" in der Navigation mit dem Support-Kontakt des Verkäufers (bei Kunden eines
**11. Tests im Browser und Deploy mit Rückweg** (M)
- Was: Playwright in CI gegen den Demo-Provider (jeder Demo-Benutzer, jede Modulseite, ein Postfach
**12. Datenschutz-Paket nach nDSG** (M)
- Was: Eine Liste der Unterauftragsverarbeiter mit Land (24fire DE, Hetzner DE/FI/US/SG, Cloudflare,

---

### A3. Erweitern (auf bestehenden Integrationen)
**1. Geld schneller rein: Mahnwesen, Bankabgleich, automatisch belasten** (M)
**2. Backups, die man wiederherstellen kann** (M)
**3. Websites für echte Apps** (S bis M)
**4. Verbindung für einen Kunden** (M)
**5. Hetzner ausbauen** (M)
**6. Monitoring für Kunden fertig machen** (M)
**7. Domains: Registrieren, Transfer, Verlängerung verrechnen** (M, Registrieren L)
**8. E-Mail: mehr Selbstbedienung und ein Gesundheitscheck** (M)
**9. Cloudflare-Kleinigkeiten** (S bis M)
**10. ACME-Token für eigene Server** (M)
**11. Kleinere Ausbauten** (je S)
**12. OpenAPI und ausgehende Webhooks** (M)
### A4. Was später auf dem KI-Modul aufbauen kann
### Übersicht
| # | Integration | Empfehlung | Aufwand | Kurz |
| 1 | Proxmox Backup Server | Jetzt | M, dann L | Backups mit Einzeldateien, Backup-Speicher als Produkt |
| 2 | Stripe: Karte und TWINT wiederkehrend | Jetzt | S bis M | schon angebunden, nur erweitern |
| 3 | Bankdatei camt.054 | Jetzt | M | Zahlungseingänge zur QR-Referenz |
| 4 | Alarm-Kanäle (Telegram, ntfy, Slack, Teams) | Jetzt | S | Webhooks, kein Adapter |
| 5 | Zammad (Tickets) | Jetzt, nach "Hilfe" | M | Support mit Kontext aus der Console |
| 6 | Bexio | Bald | M | zweite Buchhaltung neben Zoho, auch für Reseller |
| 7 | Microsoft 365 (CSP) | Später | L | Lizenzen lesen und abrechnen |
| 8 | Object Storage (S3) | Später | M | Garage auf eigener Hardware oder Exoscale |
| 9 | Hetzner Storage Box | Später | M | günstiger Backup-Speicher pro Kunde |
| 10 | E-Mail-Archiv (piler) | Später | M | Add-on zur Mail-Domain |
| 11 | VPN (Headscale oder Netbird) | Später | M | Zugang für Managed-IT-Kunden |
| 12 | RMM (Tactical RMM, NinjaOne) | Später | M | Geräte lesen und pro Gerät abrechnen |
| 13 | eBill | Später | M bis L | nur über einen Netzwerkpartner |
| 14 | Vaultwarden als App | Später | S bis M | als Instanz pro Kunde, kaum API |
| 15 | Coolify | Später | L | App-Hosting mit Containern |
| 16 | SMS (ASPSMS) | Später | S | ein weiterer Alarm-Kanal |
| 17 | Domain- und Reputations-Monitoring | Später | S | RDAP, Blocklisten |
| 18 | Zweiter Registrar (INWX, Openprovider) | Später | M | nur bei Lücken bei Joker |
| | Google Workspace, Veeam, Kubernetes, MinIO, Portainer, FreeScout, LSV+/BDD, Hostpoint, Infomaniak, Odoo, Mail-Gateway, SIP-Trunk-API, Healthchecks.io, Grafana, kommerzielle Zertifikate, weitere Zahlungsanbieter | Weglassen | | Begründung unten |

---

### A4. Was später auf dem KI-Modul aufbauen kann

Nur als Merkliste, falls es nicht schon im Design steht. Alles nur lesend, ohne Passwörter und
Schlüssel, und nur bei Kunden mit eingeschaltetem Schalter.
- **Fehler erklären:** Die Ergebnisse von `modules/mail/dns.ts` und `modules/hosting/website-dns.ts`
  in Worten und mit dem nächsten Schritt ("Der MX-Eintrag zeigt noch auf Ihren alten Anbieter.").
- **Anfrage an den Support vorbereiten:** Mit Zammad (B5) eine Anfrage samt Kontext (Ressource,
  letzte Audit-Einträge, Status der Monitore) vorausfüllen.
- **Audit-Log in Worten:** "Was hat sich gestern bei Muster AG geändert?"
- **Mahn- und Rechnungstexte** in der Sprache des Empfängers (A2.9).

---

## B. Weitere Integrationen
### Weglassen

- **Google Workspace:** Die Reseller-API setzt einen unterschriebenen Reseller-Vertrag voraus (belegt
  [12]), und in der Schweiz verkaufst du eher M365.
- **Veeam:** Die Service Provider Console hat eine brauchbare REST-API (Firmen, Jobs, belegter
  Speicher) (belegt [31]), aber nur sinnvoll, wenn Kunden Veeam schon haben. Nur auf Nachfrage, dann
  nur lesen und abrechnen.
- **restic und Borg:** Keine API zum Anbinden. Als Ziel über Storage Box oder S3 anbieten.
- **Kubernetes:** Viel Betrieb, wenige Kunden in deinem Segment.
- **MinIO:** Die Community-Ausgabe hat 2025 die Verwaltung in der Oberfläche verloren und bekommt
  keine fertigen Pakete mehr (belegt [19], Blog und Forum). Keine gute Grundlage für ein Produkt.
- **Portainer für Kunden:** Gute API (Zugangs-Token im Header `X-API-Key`, laut Drittquelle [27]),
  aber Container-Rechte für Kunden sind schwer sauber zu trennen. Höchstens für dich.
- **FreeScout:** REST-API und Webhooks nur mit einem kostenpflichtigen Modul (belegt [8]). Zammad ist
  für mehrere Kunden die bessere Wahl.
- **LSV+ und BDD:** SIX stellt sie in CHF per 30.09.2028 ein, neue Rechnungssteller gibt es seit dem
  01.01.2026 nicht mehr (belegt [18]).
- **Hostpoint:** Keine öffentliche API gefunden. Konkurrent, kein Lieferant.
- **Infomaniak:** Hat eine API mit Bearer-Token, schreibende Zugriffe fürs Webhosting laufen laut
  Drittquellen aber nur über eine interne Schnittstelle (belegt [23], nur Drittquellen). Konkurrent.
- **Odoo als Buchhaltung:** Die alten RPC-Schnittstellen sind ab Odoo 19 veraltet, die neue JSON-2-API
  ist der Ersatz, und auf Odoo Online gibt es die API nur in teureren Tarifen (belegt [36]). Du hast
  Zoho, Bexio ist schweizerischer.
- **Mail-Security-Gateway** (Hornetsecurity, Mail Assure, SEPPmail): Mailcow filtert mit rspamd
  schon. APIs habe ich nicht geprüft. SEPPmail höchstens für Kunden, die Verschlüsselung brauchen.
- **API für SIP-Trunks** (z.B. peoplefone): Keine öffentliche API gefunden. Die Leitungen siehst du
  schon über 3CX (Liste der getesteten Anbieter in der Schweiz [30]).
- **Healthchecks.io:** Gute API (Schlüssel pro Projekt, `POST /api/v3/checks/`, laut Drittquellen
  [37]), aber Push-Monitore in Uptime Kuma reichen.
- **Grafana pro Kunde:** siehe A1.6.
- **Kommerzielle Zertifikate (OV, EV):** Kaum Nachfrage, Let's Encrypt reicht. Wenn doch, über
  Openprovider (B18).
- **Weitere Zahlungsanbieter** (PostFinance Checkout, Payrexx, Datatrans): PostFinance Checkout kann
  TWINT mit gespeicherten Zahlungsdaten (belegt [16]), aber solange Stripe Karte und TWINT
  wiederkehrend kann, bringt ein zweiter Anbieter nur Arbeit. Erst bei einem Gebührenvergleich.

---

## C. Meine Top 5
