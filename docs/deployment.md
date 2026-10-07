# Deployment

## Mit Docker Compose

```bash
git clone git@github.com:larszh/weblion-db.git && cd weblion-db
cp .env.example .env
```

In der `.env` mindestens setzen:

```env
NODE_ENV=production
APP_URL=https://console.weblion.one
ENCRYPTION_KEY=<openssl rand -base64 32>
POSTGRES_PASSWORD=<langes Zufallspasswort>
BOOTSTRAP_ADMIN_EMAIL=admin@weblion.one
BOOTSTRAP_ADMIN_PASSWORD=<nur für den ersten Start>
FIRE24_API_KEY='...'
PROXMOX_URL=https://pve01-zrh.weblion.cloud:2096
PROXMOX_TOKEN_ID=weblion@pve!console
PROXMOX_TOKEN_SECRET=...
```

```bash
docker compose up -d --build
docker compose logs -f console
```

Migrationen laufen beim Start automatisch. Nach dem ersten Login das
`BOOTSTRAP_ADMIN_PASSWORD` aus der `.env` entfernen und 2FA aktivieren.

## Reverse Proxy (TLS)

Der Container lauscht nur auf `127.0.0.1:3000`. Beispiel mit Caddy:

```caddyfile
console.weblion.one {
    encode gzip
    reverse_proxy 127.0.0.1:3000
}
```

Websockets (Konsole) leitet Caddy automatisch weiter. Bei nginx `proxy_http_version 1.1`
und die `Upgrade`/`Connection`-Header setzen.

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
gespeicherte Provider-Zugangsdaten und 2FA-Secrets aus einem Backup nicht mehr lesen.

## Secrets in CI/CD

Für automatische Deployments die Werte als GitHub Actions Secrets (Repository Settings,
Secrets and variables, Actions) oder im Secret-Store des Hosts ablegen und beim Deploy in die
`.env` bzw. die Container-Umgebung schreiben. Niemals ins Repo committen.
