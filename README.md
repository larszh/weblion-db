# weblion.one Console

Kunden- und Admin-Panel von weblion.one. Ein Panel für Cloud-Server im Rechenzentrum in
Deutschland (24fire) und auf eigener Proxmox-Infrastruktur in der Schweiz, dazu Domains mit
DNS (24fire und Joker.com), Webhosting, Abrechnung mit QR-Rechnung, Stripe/TWINT und Zoho
Books, ein Reseller-Modell sowie Rollen, Access Policies und Audit-Log. Inspiriert von der
Hetzner Cloud Console.

![Server-Übersicht](docs/screenshots/server-overview.png)

## Was drin ist

**Für Kunden**
- Projekte und Server in einer Übersicht, Standort (DE/CH) und Provider auf einen Blick
- Server-Detail mit Tabs: Übersicht, Graphen (CPU, RAM, Netzwerk, Disk I/O, Ping), Backups,
  Snapshots, Netzwerk (rDNS, DDoS), Firewall, Energie, ISO-Images, Rescale, Rebuild,
  Aktivität, Einstellungen (Name, Labels, Schutz, Projekt), Löschen
- Browser-Konsole (noVNC) über eine Websocket-Bridge, ohne dass der Browser Provider-Zugangsdaten sieht
- Domains & DNS (24fire, Joker.com): DNS-Einträge bearbeiten (bei Joker.com mit TTL,
  Weiterleitungen und E-Mail-Weiterleitung), Nameserver ändern, Transfersperre, Auth-Code für
  Transfers
- Webhosting (24fire/Plesk): Ressourcen, Plesk-Zugang, Hinweise für Mail-Programme
- Abrechnung: Rechnungen als PDF mit QR-Rechnung, Guthaben, Dienste, online bezahlen mit
  Karte oder TWINT, Rechnungsadresse
- Nur freigeschaltete Module sind sichtbar (z.B. DNS erst, wenn es aktiviert ist)
- Mitglieder einladen (mit E-Mail), Rollen (Owner, Admin, Member, Eingeschränkt, Nur lesen,
  Buchhaltung)
- Access Policies im IAM-Stil: Aktionen erlauben/verweigern pro Projekt, Server oder Label
- API-Tokens (Lesen / Lesen & Schreiben) für Automatisierung
- Audit-Log, 2FA (TOTP), aktive Sitzungen
- Deutsch und Englisch, helles und dunkles Theme, mobil nutzbar

**Für weblion.one (Admin-Bereich)**
- Plattform-Übersicht mit Provider-Status und fehlgeschlagenen Aktionen
- Kunden und Reseller anlegen (mit Einladung für den Owner), sperren, Module freischalten,
  Berechtigungsgrenze pro Kunde
- Abrechnung: Rechnungen erstellen und abschliessen, Guthaben buchen, Dienste freischalten,
  Produkte und Preise, wiederkehrende Abrechnung, Übersicht über offene und überfällige Beträge
- Domains (24fire, Joker.com) und Webspaces (24fire) Kunden zuweisen
- Domains verlängern und die automatische Verlängerung schalten (Joker.com, nur mit Login)
- Einstellungen: SMTP, Rechnungssteller (Adresse, IBAN, MWST, Nummernkreis), Status von
  Stripe und Zoho Books, Mail-Log
- Benutzerverwaltung inkl. Plattform-Rollen (Superadmin, Support)
- Server-Inventar: neue Server werden automatisch synchronisiert und Kunden zugewiesen
- Provider verwalten, Verbindung testen, Infrastruktur (Nodes, Storages) ansehen
- Server bei Proxmox aus Templates erstellen
- API Explorer: Rohzugriff auf die 24fire-, Proxmox- und Joker.com-API (DMAPI) für alles ohne
  eigenen Button

**Für Reseller**
- Eigene Kunden anlegen und sperren, Module freischalten (bis zum eigenen Umfang)
- Im Panel der Kunden arbeiten, Server, Domains und Webspaces zuteilen
- Eigene Produkte und Preise, Rechnungen mit eigenem Briefkopf und Nummernkreis, Guthaben

| Graphen | Access Policies | Kunde im Admin-Bereich |
|---|---|---|
| ![Graphen](docs/screenshots/server-graphs.png) | ![Policy-Editor](docs/screenshots/policy-editor.png) | ![Kunde](docs/screenshots/admin-customer.png) |
| **Dashboard** | **Dunkel, eingeschränkter Benutzer** | **Mobil** |
| ![Dashboard](docs/screenshots/dashboard.png) | ![Dunkel](docs/screenshots/server-dark-restricted.png) | ![Mobil](docs/screenshots/mobile.png) |
| **Abrechnung** | **Reseller: eigene Kunden** | **Domains & DNS (dunkel)** |
| ![Abrechnung](docs/screenshots/billing.png) | ![Reseller](docs/screenshots/reseller.png) | ![Domains](docs/screenshots/domains-dark.png) |

## Stand

- Gegen echte 24fire-, Proxmox-, Joker.com-, Stripe- und Zoho-Systeme ist die Console noch
  **nicht live getestet**: Die Build-Umgebung hatte keinen Netzzugriff darauf. Alle
  Anbindungen sind gegen Mock-Server getestet, die die dokumentierten Antworten nachbilden. Die
  24fire-Endpunkte folgen der offiziellen v2-Doku, die Proxmox-Aufrufe der API-Referenz, die
  Joker-Requests der DMAPI-Spezifikation.
- Webspaces kann die 24fire-API nur lesen: Neue Webspaces werden im 24fire-Panel bestellt und
  erscheinen nach dem nächsten Sync in der Console, wo sie einem Kunden zugewiesen werden.
- Domains registrieren und zu Joker.com transferieren geht noch im Joker-Panel. Die Domains
  erscheinen danach ebenso beim nächsten Sync.

## Schnellstart (Entwicklung)

Voraussetzungen: Node 22, pnpm 10, Postgres 16.

```bash
pnpm install
cp .env.example .env          # ENCRYPTION_KEY, BOOTSTRAP_ADMIN_* und Provider-Zugangsdaten setzen
pnpm db:migrate
pnpm dev                      # API auf :3000, Web auf :5173
```

Mit Demo-Daten (simulierter Provider, zwei Beispielkunden, ohne echte Server):

```bash
ENABLE_DEMO_PROVIDER=true pnpm db:seed
```

Login danach mit `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` aus der `.env`.
Demo-Benutzer, Passwort `demo-password-123`:

| | |
|---|---|
| `anna@muster.example` | Owner Muster AG (Server, Domains, Webhosting, Rechnungen) |
| `ben@muster.example` | eingeschränkt, nur Webshop-Projekt |
| `carla@muster.example` | nur lesen |
| `reseller@alpen.example` | Owner des Resellers Alpen Hosting |
| `huber@baeckerei.example` | Owner von Bäckerei Huber (Kunde von Alpen Hosting) |

## Zugangsdaten (24fire, Proxmox, Joker.com)

Zugangsdaten gehören **nicht** ins Git-Repo, auch nicht in ein privates. Sie kommen aus
Umgebungsvariablen (`.env` lokal, Secrets im Deployment) und werden beim Start verschlüsselt
(AES-256-GCM mit `ENCRYPTION_KEY`) in der Datenbank abgelegt:

| Variable | Bedeutung |
|---|---|
| `FIRE24_API_KEY` | Account-API-Key aus dem 24fire Control Panel (in Anführungszeichen, Sonderzeichen) |
| `PROXMOX_URL` | z.B. `https://pve01-zrh.weblion.cloud:2096` |
| `PROXMOX_TOKEN_ID` | `user@realm!tokenid` |
| `PROXMOX_TOKEN_SECRET` | Token-Secret (UUID) |
| `JOKER_API_KEY` | API-Key des Reseller-Kontos bei Joker.com (alternativ `JOKER_USERNAME` und `JOKER_PASSWORD`) |
| `JOKER_BASE_URL` | Standard `https://dmapi.joker.com/request`, Testsystem `https://dmapi.ote.joker.com/request` |
| `ENCRYPTION_KEY` | `openssl rand -base64 32`, gut aufbewahren |

Weitere Provider lassen sich im Admin-Bereich hinzufügen. Details, Hinweise zum
Proxmox-Token und zum Joker-Reseller-Konto in [docs/providers.md](docs/providers.md).

Für E-Mail (SMTP), Stripe/TWINT und Zoho Books kommen weitere Variablen dazu, alle in
`.env.example` beschrieben. SMTP lässt sich statt in der `.env` auch im Admin-Bereich
eintragen (verschlüsselt gespeichert). Einrichtung Schritt für Schritt in
[docs/billing.md](docs/billing.md).

## Produktion

```bash
cp .env.example .env    # NODE_ENV=production, APP_URL=https://cp.weblion.cloud, Secrets setzen
docker compose up -d --build
```

Ein Container liefert API und Web aus, davor ein Reverse Proxy mit TLS. Datenbank ist
PostgreSQL (nicht MySQL). Ein eigener Server ist nicht nötig: Die Console läuft auch auf
einem bestehenden CloudPanel-Server mit, mit oder ohne Docker.
Siehe [docs/deployment.md](docs/deployment.md).

## Projektstruktur

```
apps/api         Fastify API, Postgres (Drizzle), Provider-Adapter, Sync-Job
apps/web         React Console (Vite, Tailwind, TanStack Query)
packages/shared  Berechtigungen, Rollen, Policy-Engine und API-Typen (von beiden genutzt)
docs/            Architektur, Provider, Deployment, Roadmap
```

| Befehl | |
|---|---|
| `pnpm dev` | API und Web im Watch-Modus |
| `pnpm test` | Unit- und Integrationstests (braucht Postgres, `TEST_DATABASE_URL`) |
| `pnpm typecheck` | TypeScript in allen Paketen |
| `pnpm build` | Produktions-Build |
| `pnpm db:generate` | Migration aus Schema-Änderungen erzeugen |

## REST-API

Alles, was die Console kann, geht auch per API unter `/api/v1`, authentifiziert mit einem
API-Token aus der Console:

```bash
curl -H "Authorization: Bearer wlc_…" https://cp.weblion.cloud/api/v1/orgs/<org-id>/servers
curl -X POST -H "Authorization: Bearer wlc_…" -H "Content-Type: application/json" \
  -d '{"action":"reboot"}' https://cp.weblion.cloud/api/v1/servers/<server-id>/power
```

## Weiterlesen

- [docs/architecture.md](docs/architecture.md): Aufbau, Rechte-Modell, neue Provider anbinden
- [docs/billing.md](docs/billing.md): Abrechnung, Reseller, Module, Stripe/TWINT, Zoho Books, E-Mail
- [docs/providers.md](docs/providers.md): 24fire, Proxmox und Joker.com einrichten, offene Punkte
- [docs/deployment.md](docs/deployment.md): Betrieb, Backups, Updates
- [docs/roadmap.md](docs/roadmap.md): Ideen für die nächsten Ausbaustufen
