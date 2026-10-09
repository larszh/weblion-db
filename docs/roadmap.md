# Roadmap und Ideen

Das Fundament ist so gebaut, dass neue Dienste als weitere Provider-Adapter mit eigenen
Berechtigungen dazukommen. Vorschläge, grob nach Nutzen sortiert:

## Als Nächstes

- **Live-Test gegen 24fire, Proxmox, Hetzner Cloud, Joker.com und Nextcloud** mit den echten
  Zugangsdaten (die Build-Umgebung hatte keinen Zugriff), bei Joker.com zuerst im Testsystem
  (OT&E), bei Nextcloud mit einer eigenen Test-Instanz. Offene Detailfragen stehen in
  docs/providers.md
- **Cloud-Speicher an Sperre und Abrechnung koppeln**: Heute laufen die Nextcloud-Konten eines
  gesperrten Kunden oder nach gekündigtem Dienst weiter (siehe unten)
- **Hetzner Cloud ausbauen**: Backups pro Server ein- und ausschalten (mit Preis-Hinweis),
  Rescue-System, SSH-Keys und Cloud-Init beim Erstellen, Volumes (Speicher dazubuchen),
  Floating und Primary IPs. Firewalls nur als eigene Firewall pro Kunde oder Server, weil
  Hetzner-Firewalls im ganzen Projekt geteilt werden
- **Stripe Connect für Reseller**, damit auch Reseller-Kunden online zahlen können
- **Mahnwesen**: Zahlungserinnerungen und Mahnstufen für überfällige Rechnungen (die
  Mail-Vorlage `invoice_reminder` ist schon da)
- **Self-Service-Bestellung**: Kunden bestellen Produkte aus dem Katalog selbst, inkl.
  automatischer Bereitstellung bei Proxmox und Hetzner Cloud (Produkt = Server-Typ plus
  Aufschlag)
- **Alarme**: E-Mail, Slack, Telegram bei Server down, hoher Last, fehlgeschlagenem Backup
- **Geplante Aufgaben**: Backup- und Snapshot-Zeitpläne, Wartungsfenster für Reboots
- **SSH-Keys und Cloud-Init** beim Erstellen und Neuinstallieren von Servern
- **OpenAPI-Doku** der REST-API, danach Terraform-Provider und eine kleine CLI
- **SSO und Passkeys**: Login mit Microsoft/Google (OIDC), WebAuthn statt nur TOTP

## Domains (Joker.com)

Die Anbindung deckt heute DNS, Nameserver, Transfersperre, Auth-Code und Verlängerung ab.
Als Nächstes:

- **Registrieren und Transfer zu Joker** aus der Console: Verfügbarkeit prüfen, Kontakte
  (Handles) pro Kunde anlegen und wiederverwenden, Preise pro Endung im Produktkatalog
- **Verlängerungen weiterverrechnen**: Verlängert Joker eine Domain (automatisch oder von
  Hand), entsteht automatisch eine Rechnungszeile für den Kunden. Heute bezahlt weblion.one
  die Verlängerung, und die Abrechnung läuft getrennt über einen Dienst an der Domain
- **DNSSEC**: Signieren bei Joker einschalten bzw. DS-Einträge für fremde Nameserver
  hinterlegen, statt den Status nur anzuzeigen
- **Whois-Datenschutz** bestellen und verlängern
- **Inhaberwechsel** und Kontaktdaten pflegen, mit den Fristen und Bestätigungen, die
  einzelne Registries verlangen

## Cloud-Speicher (Nextcloud)

Die Anbindung deckt heute Kontingente pro Kunde und Reseller, Konten mit eigenem Kontingent,
Einladungen, Passwörter, den Sync der Belegung und die Übernahme bestehender Benutzer ab. Als
Nächstes:

- **Sperre koppeln**: Sperrt weblion.one oder ein Reseller einen Kunden, deaktiviert die Console
  seine Konten in Nextcloud und aktiviert sie beim Entsperren wieder. Heute geht das nur von Hand
- **Abrechnung koppeln**: Ein Dienst trägt Speicher und Zahl der Konten, das Kontingent folgt dem
  Dienst. Kündigen deaktiviert die Konten und löscht sie nach einer Frist. Optional nach belegtem
  Speicher abrechnen (GB pro Monat als Rechnungszeile)
- **Mehr Speicher selbst buchen**, als Teil der Self-Service-Bestellung
- **Gruppen nachziehen**: Beim Übernehmen und Zuweisen ein Konto in die Gruppe des neuen Kunden
  legen und aus der alten nehmen (braucht eine Adapter-Methode für Gruppen)
- **Team-Ordner** pro Organisation (Nextcloud-App für Gruppenordner) mit eigenem Kontingent, das
  zum Kontingent des Kunden zählt
- **Warnungen**: E-Mail an den Owner, wenn ein Konto oder das Kontingent zu 90 % belegt ist.
  Verlauf der Belegung als Graph
- **2FA erzwingen** pro Organisation (Nextcloud kann Zwei-Faktor-Anmeldung für Gruppen erzwingen)
- **Instanz im Blick**: freier Platz der Instanz und Summe aller verkauften Kontingente im
  Admin-Bereich, damit Überbuchung sichtbar wird
- **Kleinere Lücken**: Reseller-Wechsel eines Kunden gegen das Kontingent des neuen Resellers
  prüfen, Cloud-Konten in den Zählern der Kundenlisten, Gruppen-Präfix aus der `.env`, Konten im
  Admin-Bereich direkt deaktivieren und löschen (heute im Panel des Kunden)

## Neue Dienste

- **Webhosting-Bereitstellung**: Die 24fire-API kann Webspaces nur lesen. Neue Webspaces
  aus der Console anlegen ginge mit einem eigenen Plesk/KeyHelp-Server und dessen API
- **DNS bei Cloudflare** als weiterer DNS-Provider, z.B. für Domains mit
  Cloudflare-Nameservern
- **Grafana pro Kunde**: automatisch angelegte Grafana-Organisationen mit Dashboards für die
  eigenen Server, eingebettet im Panel
- **Uptime- und Statusseiten**: externe Checks (z.B. Uptime Kuma) und eine Statusseite pro Kunde
- **Backups 2.0**: Proxmox Backup Server mit Einzeldatei-Wiederherstellung, Offsite-Kopien
  (S3, Storage Box)
- **1-Click-Apps**: WordPress, eine eigene Nextcloud pro Kunde, Docker-Host als Templates mit
  Cloud-Init
- **Netzwerk**: private Netze, WireGuard-VPN, Floating IPs, Load Balancer (bei Hetzner Cloud
  über deren API, sonst selbst betrieben)
- **Hetzner jenseits der Cloud**: Storage Boxes (Backup-Speicher für Kunden), DNS-Zonen bei
  Hetzner DNS als weiterer DNS-Provider, dedizierte Server über die Robot-API
- **Object Storage**: S3-kompatibel (MinIO oder Ceph RGW) in der Schweiz

## Geschäft

- **Nutzungsbasierte Abrechnung**: Traffic, Backup-Speicher, Server-Laufzeit oder belegter
  Cloud-Speicher als Rechnungszeilen statt nur fester Preise. Für Hetzner Cloud: Server-Typ,
  Backups (+20 %) und Snapshot-Speicher pro GB automatisch in die Abrechnung übernehmen
- **Proxmox für Admins**: Live-Migration, HA, Backup-Zeitpläne, Cloud-Init, Task-Logs,
  Hardware bearbeiten (Liste in docs/providers.md)
- **Support im Panel**: Tickets (z.B. Zammad), Wartungsankündigungen, Changelog
- **Datenstandort sichtbar machen**: CH- und DE-Kennzeichnung für Datenschutz (DSG/DSGVO),
  Audit-Export für Compliance
