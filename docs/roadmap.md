# Roadmap und Ideen

Das Fundament ist so gebaut, dass neue Dienste als weitere Provider-Adapter mit eigenen
Berechtigungen dazukommen. Vorschläge, grob nach Nutzen sortiert:

## Als Nächstes

- **Live-Test gegen 24fire und Proxmox** mit den echten Zugangsdaten (die Build-Umgebung hatte
  keinen Zugriff), offene Detailfragen stehen in docs/providers.md
- **Stripe Connect für Reseller**, damit auch Reseller-Kunden online zahlen können
- **Mahnwesen**: Zahlungserinnerungen und Mahnstufen für überfällige Rechnungen (die
  Mail-Vorlage `invoice_reminder` ist schon da)
- **Self-Service-Bestellung**: Kunden bestellen Produkte aus dem Katalog selbst, inkl.
  automatischer Bereitstellung bei Proxmox
- **Alarme**: E-Mail, Slack, Telegram bei Server down, hoher Last, fehlgeschlagenem Backup
- **Geplante Aufgaben**: Backup- und Snapshot-Zeitpläne, Wartungsfenster für Reboots
- **SSH-Keys und Cloud-Init** beim Erstellen und Neuinstallieren von Servern
- **OpenAPI-Doku** der REST-API, danach Terraform-Provider und eine kleine CLI
- **SSO und Passkeys**: Login mit Microsoft/Google (OIDC), WebAuthn statt nur TOTP

## Neue Dienste

- **Webhosting-Bereitstellung**: Die 24fire-API kann Webspaces nur lesen. Neue Webspaces
  aus der Console anlegen ginge mit einem eigenen Plesk/KeyHelp-Server und dessen API
- **DNS bei Cloudflare** als zweiter DNS-Provider, z.B. für Domains ausserhalb von 24fire
- **Grafana pro Kunde**: automatisch angelegte Grafana-Organisationen mit Dashboards für die
  eigenen Server, eingebettet im Panel
- **Uptime- und Statusseiten**: externe Checks (z.B. Uptime Kuma) und eine Statusseite pro Kunde
- **Backups 2.0**: Proxmox Backup Server mit Einzeldatei-Wiederherstellung, Offsite-Kopien
  (S3, Storage Box)
- **1-Click-Apps**: WordPress, Nextcloud, Docker-Host als Templates mit Cloud-Init
- **Netzwerk**: private Netze, WireGuard-VPN, Floating IPs, Load Balancer
- **Object Storage**: S3-kompatibel (MinIO oder Ceph RGW) in der Schweiz

## Geschäft

- **Nutzungsbasierte Abrechnung**: Traffic, Backup-Speicher oder Server-Laufzeit als
  Rechnungszeilen statt nur fester Preise
- **Proxmox für Admins**: Live-Migration, HA, Backup-Zeitpläne, Cloud-Init, Task-Logs,
  Hardware bearbeiten (Liste in docs/providers.md)
- **Support im Panel**: Tickets (z.B. Zammad), Wartungsankündigungen, Changelog
- **Datenstandort sichtbar machen**: CH- und DE-Kennzeichnung für Datenschutz (DSG/DSGVO),
  Audit-Export für Compliance
