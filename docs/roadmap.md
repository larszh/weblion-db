# Roadmap und Ideen

Das Fundament ist so gebaut, dass neue Dienste als weitere Provider-Adapter mit eigenen
Berechtigungen dazukommen. Vorschläge, grob nach Nutzen sortiert:

## Als Nächstes

- **24fire-Endpunkte verifizieren** (Status, Power, Backups), siehe docs/providers.md
- **Alarme**: E-Mail, Slack, Telegram bei Server down, hoher Last, fehlgeschlagenem Backup
- **Geplante Aufgaben**: Backup- und Snapshot-Zeitpläne, Wartungsfenster für Reboots
- **SSH-Keys und Cloud-Init** beim Erstellen und Neuinstallieren von Servern
- **OpenAPI-Doku** der REST-API, danach Terraform-Provider und eine kleine CLI
- **SSO und Passkeys**: Login mit Microsoft/Google (OIDC), WebAuthn statt nur TOTP

## Neue Dienste

- **Webhosting**: Adapter für KeyHelp, Plesk oder ISPConfig, Webspaces und Mailboxen im Panel
- **Domains und DNS**: 24fire-Domain-API (DNS-Einträge sind schon dokumentiert) oder Cloudflare
- **Grafana pro Kunde**: automatisch angelegte Grafana-Organisationen mit Dashboards für die
  eigenen Server, eingebettet im Panel
- **Uptime- und Statusseiten**: externe Checks (z.B. Uptime Kuma) und eine Statusseite pro Kunde
- **Backups 2.0**: Proxmox Backup Server mit Einzeldatei-Wiederherstellung, Offsite-Kopien
  (S3, Storage Box)
- **1-Click-Apps**: WordPress, Nextcloud, Docker-Host als Templates mit Cloud-Init
- **Netzwerk**: private Netze, WireGuard-VPN, Floating IPs, Load Balancer
- **Object Storage**: S3-kompatibel (MinIO oder Ceph RGW) in der Schweiz

## Geschäft

- **Abrechnung**: Nutzung pro Kunde (Server-Laufzeit, Traffic, Backups), Rechnungen über
  Bexio oder Zoho Books, Zahlung per Stripe/TWINT
- **Self-Service-Bestellung**: Kunden bestellen Pakete selbst, mit Quoten und Freigabe
- **Reseller**: Kunden verwalten eigene Unterkunden. Das Rechte-Modell mit Grenzen pro
  Organisation ist dafür schon vorbereitet
- **Support im Panel**: Tickets (z.B. Zammad), Wartungsankündigungen, Changelog
- **Datenstandort sichtbar machen**: CH- und DE-Kennzeichnung für Datenschutz (DSG/DSGVO),
  Audit-Export für Compliance
