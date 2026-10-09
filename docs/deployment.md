# Deployment

## Was die Console braucht

| | |
|---|---|
| Laufzeit | Node.js 22, ein dauerhaft laufender Prozess (kein Serverless) |
| Datenbank | **PostgreSQL** 14 oder neuer (getestet mit 16). MySQL/MariaDB geht nicht, siehe unten |
| Ressourcen | rund 250 MB RAM für die App, 100 bis 200 MB für Postgres, unter 1 GB Disk |
| Netz eingehend | HTTPS über einen Reverse Proxy, inkl. Websockets (Browser-Konsole) |
| Netz ausgehend | 24fire, Proxmox, Hetzner Cloud (HTTPS zur API, Websockets für die Konsole), Joker.com (`dmapi.joker.com`), Stripe, Zoho, SMTP |

Ein eigener (dedizierter) Server nur für die Console ist **nicht nötig**. Ein kleiner VPS mit
2 GB RAM reicht, und die Console kann problemlos auf einem Server mitlaufen, der schon andere
Dinge erledigt, zum Beispiel ein CloudPanel-Server.

Nicht geeignet sind klassisches Shared Hosting ohne eigene Node-Prozesse und
Serverless-Plattformen (Vercel, Netlify, Lambda): Die Console braucht einen Prozess, der
dauernd läuft, weil Hintergrund-Jobs (Inventar-Sync, Task-Verfolgung, wiederkehrende
Abrechnung) und die Websocket-Konsole darauf angewiesen sind.

### Warum PostgreSQL und nicht MySQL

Die Console nutzt Dinge, die so nur Postgres kann oder die das ORM nur für Postgres
anbietet: Sperren pro Kunde für Geldbewegungen (Advisory Locks), damit Guthaben nicht doppelt
ausgegeben wird, `RETURNING` bei fast jedem Schreibzugriff, JSONB-Spalten und einen
Ausdrucks-Index für den Rechnungsnummernkreis. Ein Umbau auf MySQL wäre gross und gerade in
der Abrechnung riskant. Das lohnt sich nicht: Postgres ist frei, klein und läuft problemlos
neben MySQL auf demselben Server (anderer Port, 5432 statt 3306).

## Wo betreiben? Empfehlung

1. **Ihr habt schon einen CloudPanel-Server:** dort mitlaufen lassen, siehe
   [CloudPanel](#auf-cloudpanel). Kein zusätzlicher Server.
2. **Sonst: kleiner VPS mit Docker Compose**, z.B. ein kleiner 24fire-KVM oder eine VM.
   Anleitung direkt hier unten.
3. **Eine VM auf dem eigenen Proxmox** geht auch, Docker Compose wie unten. Ehrlicher
   Nachteil: Fällt der Proxmox-Cluster aus, ist auch die Console weg, also genau dann, wenn ihr
   und eure Kunden sie für die 24fire-Server oder zur Fehlersuche brauchen. Deshalb lieber
   ausserhalb der Infrastruktur, die sie verwaltet.
4. **Ganz ohne eigenen Server** (Plattformen wie Fly.io oder Render plus verwaltetes Postgres
   wie Neon): technisch möglich, das Docker-Image läuft dort. Dann liegen aber
   Provider-Zugangsdaten und Rechnungsdaten bei einem weiteren, meist US-amerikanischen
   Anbieter (DSG/DSGVO), und die App muss immer laufen (kein Schlafmodus). Für einen
   Schweizer Hoster würde ich das nicht als erste Wahl nehmen.

## Mit Docker Compose

```bash
git clone git@github.com:larszh/weblion-db.git && cd weblion-db
cp .env.example .env
```

In der `.env` mindestens setzen:

```env
NODE_ENV=production
APP_URL=https://cp.weblion.cloud
ENCRYPTION_KEY=<openssl rand -base64 32>
POSTGRES_PASSWORD=<langes Zufallspasswort>
BOOTSTRAP_ADMIN_EMAIL=admin@weblion.one
BOOTSTRAP_ADMIN_PASSWORD=<nur für den ersten Start>
FIRE24_API_KEY='...'
PROXMOX_URL=https://pve01-zrh.weblion.cloud:2096
PROXMOX_TOKEN_ID=weblion@pve!console
PROXMOX_TOKEN_SECRET=...
# Hetzner Cloud, ein Projekt. Weitere Projekte im Admin-Bereich unter Provider.
HETZNER_API_TOKEN=...
```

Optional, je nachdem was genutzt wird (Details in [billing.md](billing.md) und
[providers.md](providers.md)):

```env
# Domains bei Joker.com: API-Key des Reseller-Kontos (oder JOKER_USERNAME und JOKER_PASSWORD)
JOKER_API_KEY='...'

# E-Mail. Alternativ im Admin-Bereich unter Einstellungen > E-Mail eintragen.
SMTP_HOST=smtp.example.ch
SMTP_PORT=587
SMTP_USER=noreply@weblion.one
SMTP_PASSWORD=...
SMTP_FROM="weblion.one <noreply@weblion.one>"

# Stripe (Karte, TWINT)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Zoho Books
ZOHO_CLIENT_ID=...
ZOHO_CLIENT_SECRET=...
ZOHO_REFRESH_TOKEN=...
ZOHO_ORGANIZATION_ID=...
ZOHO_TAX_IDS=810:...,0:...
```

Der Stripe-Webhook zeigt auf `https://cp.weblion.cloud/api/v1/payments/stripe/webhook`.
Der Reverse Proxy muss den Request-Body unverändert durchreichen (Caddy und nginx tun das
standardmässig), sonst schlägt die Signaturprüfung fehl.

```bash
docker compose up -d --build
docker compose logs -f console
```

Migrationen laufen beim Start automatisch. Nach dem ersten Login das
`BOOTSTRAP_ADMIN_PASSWORD` aus der `.env` entfernen und 2FA aktivieren.

## Reverse Proxy (TLS)

Der Container lauscht nur auf `127.0.0.1:3000`. Beispiel mit Caddy:

```caddyfile
cp.weblion.cloud {
    encode gzip
    reverse_proxy 127.0.0.1:3000
}
```

Websockets (Konsole) leitet Caddy automatisch weiter. Bei nginx `proxy_http_version 1.1`
und die `Upgrade`/`Connection`-Header setzen.

## Auf CloudPanel

[CloudPanel](https://www.cloudpanel.io) läuft auf Debian 11/12 oder Ubuntu 22.04/24.04 und
verwaltet selbst nur MySQL/MariaDB. Postgres kommt deshalb zusätzlich auf den Server, das
stört CloudPanel nicht. Zwei Wege, beide mit TLS über CloudPanel:

- **A: Docker Compose + Reverse-Proxy-Site.** Gleiche Installation wie oben, Updates per
  `docker compose pull`. Gut, wenn Docker auf dem Server in Ordnung ist.
- **B: Node.js-Site + Postgres aus den Paketquellen + PM2.** Ohne Docker, ganz im
  CloudPanel-Stil mit eigenem Site-User.

Die Menüs unten entsprechen CloudPanel v2. Bei abweichenden Bezeichnungen in eurer Version
sinngemäss vorgehen.

### Variante A: Docker Compose

1. Als root Docker installieren (`curl -fsSL https://get.docker.com | sh`).
2. Repo z.B. nach `/opt/weblion-console` klonen, `.env` wie oben ausfüllen und
   `APP_URL=https://cp.weblion.cloud` setzen. `docker compose up -d --build`.
   Die Console lauscht nur auf `127.0.0.1:3000` (so steht es in `docker-compose.yml`), ist
   also von aussen nicht direkt erreichbar. Ist Port 3000 auf dem Server schon belegt (z.B.
   durch eine andere Node.js-Site), in `docker-compose.yml` links einen freien Port nehmen,
   etwa `127.0.0.1:3100:3000`, und unten dieselbe Zahl verwenden.
3. In CloudPanel: *Sites > Add Site > Reverse Proxy*, Domain `cp.weblion.cloud`,
   Reverse-Proxy-URL `http://127.0.0.1:3000`.
4. *SSL/TLS > Let's Encrypt* für die Domain.
5. Websockets prüfen, siehe [unten](#websockets-im-vhost).

### Variante B: Node.js-Site ohne Docker

**1. Postgres installieren** (als root):

```bash
apt install -y postgresql
sudo -u postgres createuser --pwprompt weblion      # starkes Passwort vergeben
sudo -u postgres createdb --owner weblion weblion
```

Postgres lauscht danach nur lokal. Debian 12 bringt Version 15, Ubuntu 24.04 Version 16,
beides passt.

**2. Site anlegen:** *Sites > Add Site > Node.js*, Domain `cp.weblion.cloud`,
Node.js-Version **22**, App-Port z.B. `3000` (darf auf dem Server nicht schon belegt sein).
CloudPanel legt einen Site-User an und leitet die Domain per nginx auf den Port weiter.
Danach *SSL/TLS > Let's Encrypt*.

**3. Code holen und bauen** (per SSH als Site-User):

```bash
cd ~/htdocs/cp.weblion.cloud
git clone https://github.com/larszh/weblion-db.git .
npm install -g pnpm@10 pm2
pnpm install --frozen-lockfile
pnpm build
cp .env.example .env && chmod 600 .env
```

Falls Node 22 bei der Site-Erstellung nicht angeboten wurde: als Site-User
`nvm install 22 && nvm alias default 22`.

**4. `.env` ausfüllen**, wie oben beschrieben, zusätzlich:

```env
NODE_ENV=production
PORT=3000                     # gleich wie der App-Port der Site
APP_URL=https://cp.weblion.cloud
DATABASE_URL=postgres://weblion:<passwort>@127.0.0.1:5432/weblion
```

`POSTGRES_PASSWORD` braucht es hier nicht, das ist nur für Docker.

**5. Starten** mit der mitgelieferten PM2-Konfiguration
([deploy/cloudpanel/ecosystem.config.cjs](../deploy/cloudpanel/ecosystem.config.cjs)):

```bash
pm2 start deploy/cloudpanel/ecosystem.config.cjs
pm2 save
pm2 startup     # gibt einen Befehl aus, den einmal als root ausführen (Autostart nach Reboot)
```

Migrationen laufen beim Start automatisch. Logs: `pm2 logs weblion-console`.

**6. Websockets prüfen**, siehe nächster Abschnitt.

**Updates:**

```bash
cd ~/htdocs/cp.weblion.cloud
git pull && pnpm install --frozen-lockfile && pnpm build
pm2 reload weblion-console
```

**Backup:** Die CloudPanel-Backups sichern nur MySQL-Datenbanken. Für Postgres einen Cronjob
beim Site-User anlegen (*Cron Jobs* der Site oder `crontab -e`), der täglich einen Dump in
dessen Home-Verzeichnis schreibt:

```bash
15 3 * * * pg_dump "postgres://weblion:<passwort>@127.0.0.1:5432/weblion" | gzip > ~/backups/weblion-$(date +\%F).sql.gz && find ~/backups -name 'weblion-*.sql.gz' -mtime +30 -delete
```

(`mkdir ~/backups` vorher.) Liegt dieses Verzeichnis in euren Remote-Backups, ist der Dump
dabei. Den `ENCRYPTION_KEY` zusätzlich getrennt aufbewahren.

### Websockets im Vhost

Die Browser-Konsole (noVNC) braucht Websockets. In CloudPanel unter *Vhost* der Site im
`location /`-Block, der auf die App weiterleitet, prüfen, dass diese Zeilen drin sind, und
sie sonst ergänzen:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_read_timeout 3600s;
```

Test: Server im Panel öffnen, Konsole starten. Bleibt sie schwarz oder meldet sie
"Verbindung getrennt", fehlen diese Zeilen.

### Hinter Cloudflare

Läuft die Domain über Cloudflare (orange Wolke), muss der SSL-Modus für sie **Full (strict)**
sein. Mit **Flexible** spricht Cloudflare per HTTP mit dem Server, nginx leitet auf HTTPS um,
Cloudflare kommt wieder per HTTP: Der Browser meldet `ERR_TOO_MANY_REDIRECTS`.

1. In Cloudflare unter *Rules > Configuration Rules* eine Regel nur für den Hostnamen
   `cp.weblion.cloud` anlegen, SSL auf **Full** stellen. So bleibt der Modus anderer
   Subdomains unverändert. Wer die ganze Zone umstellen will: *SSL/TLS > Overview*.
2. In CloudPanel unter *SSL/TLS* ein Let's-Encrypt-Zertifikat holen (oder ein Cloudflare
   Origin Certificate erzeugen und dort importieren).
3. Danach die Regel auf **Full (strict)** stellen.

Websockets (Browser-Konsole) leitet Cloudflare standardmässig durch. Cloudflare trennt aber
Verbindungen, über die länger als rund 100 Sekunden nichts läuft. Die Konsole verbindet sich
dann neu.

Prüfen, wo eine Weiterleitungsschleife entsteht:

```bash
curl -sIL --max-redirs 5 https://cp.weblion.cloud | grep -iE "^HTTP|^location|^server"
```

Steht dort mehrfach `server: cloudflare` mit `location: https://cp.weblion.cloud/`, ist es der
SSL-Modus. Auf dem Server selbst zeigt `curl -sI http://127.0.0.1:3000/healthz`, ob die
Console läuft (`200`).

## Image aus GitHub

Der Workflow `.github/workflows/docker.yml` baut bei jedem Push auf `main` ein Image nach
`ghcr.io/larszh/weblion-console`. Auf dem Server dann statt `--build`:

```bash
docker compose pull && docker compose up -d
```

## Datenbank-Backup

```bash
docker compose exec db pg_dump -U weblion weblion | gzip > weblion-$(date +%F).sql.gz
```

Den `ENCRYPTION_KEY` separat und sicher aufbewahren (Passwort-Manager). Ohne ihn lassen sich
gespeicherte Provider-Zugangsdaten, SMTP-Passwort und 2FA-Secrets aus einem Backup nicht mehr
lesen.

Rechnungen sind buchhaltungsrelevant (in der Schweiz 10 Jahre Aufbewahrung). Die Datenbank
ist ihre Quelle, deshalb das Backup regelmässig und ausser Haus ablegen. Kunden mit
Rechnungen, Zahlungen oder Guthaben lassen sich in der Console nicht löschen, nur sperren.

## Secrets in CI/CD

Für automatische Deployments die Werte als GitHub Actions Secrets (Repository Settings,
Secrets and variables, Actions) oder im Secret-Store des Hosts ablegen und beim Deploy in die
`.env` bzw. die Container-Umgebung schreiben. Niemals ins Repo committen.
