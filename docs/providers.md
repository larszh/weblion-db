# Provider einrichten

## 24fire (Rechenzentrum DE)

- API: REST API v2, Doku unter <https://apidocs.24fire.de/v2>
- Base URL: `https://manage.24fire.de`, Header `X-Fire-Apikey: <key>`
- Konfiguration: `FIRE24_API_KEY` in der `.env` (in einfache Anführungszeichen setzen, der Key
  enthält Sonderzeichen wie `}` oder `)`).

### Was die Console nutzt

Die Endpunkte stehen gesammelt in
[`apps/api/src/providers/fire24/endpoints.ts`](../apps/api/src/providers/fire24/endpoints.ts).

| Funktion | Endpoint | Status |
|---|---|---|
| Dienste/Server finden | `GET /api/account/services` | aus der Doku bestätigt |
| Konfiguration (CPU, RAM, Disk, IPs, OS) | `GET /api/kvm/{id}/config` | bestätigt |
| Traffic aktuell / Verlauf | `GET /api/kvm/{id}/traffic/current`, `/traffic/log` | bestätigt |
| Monitoring (Ping, CPU, RAM alle 10 Min.) | `GET /api/kvm/{id}/monitoring/timings` | bestätigt, 24fire+ |
| Verfügbarkeit / Vorfälle | `GET /api/kvm/{id}/monitoring/incidences` | bestätigt, 24fire+ |
| Status | `GET /api/kvm/{id}/status` | **zu prüfen** |
| Energie (start/stop/restart) | `POST /api/kvm/{id}/power` mit `mode=` | **zu prüfen** |
| Backups auflisten / erstellen / wiederherstellen / löschen | `/api/kvm/{id}/backup/...` | **zu prüfen**, 24fire+ |

Die mit "zu prüfen" markierten Pfade folgen dem Schema der Doku und der alten v1-API, konnten
beim Bau aber nicht gegen die v2-Doku geprüft werden (die Doku-Seite war aus der
Build-Umgebung nicht erreichbar). Antwortet 24fire mit 404/405, steht in der Fehlermeldung
direkt der Hinweis auf diese Datei. Korrigieren heisst: Methode/Pfad in `endpoints.ts`
anpassen und `verified: true` setzen. Zum Ausprobieren eignet sich der API Explorer im
Admin-Bereich.

Monitoring- und Backup-Endpunkte brauchen ein aktives **24fire+** Abo auf dem Account.

## Proxmox VE (Self-Host CH)

- API: `https://<host>:<port>/api2/json`, Auth per API-Token
- Konfiguration: `PROXMOX_URL`, `PROXMOX_TOKEN_ID`, `PROXMOX_TOKEN_SECRET`

### Empfohlenes Token

Ein Token auf `root@pam` funktioniert, ist aber mächtiger als nötig (root@pam darf u.a. auf
die Host-Shell). Besser ein eigener Benutzer:

```bash
pveum user add weblion@pve --comment "weblion.one Console"
pveum acl modify / --users weblion@pve --roles Administrator
pveum user token add weblion@pve console --privsep 0
```

Wichtig: Ist bei einem Token **Privilege Separation** aktiv (Standard beim Anlegen in der
GUI), hat das Token eigene, zunächst leere Rechte. Die Console sieht dann keine Nodes und
meldet das beim Verbindungstest. Entweder `--privsep 0` oder dem Token selbst ACLs geben:

```bash
pveum acl modify / --tokens 'weblion@pve!console' --roles Administrator
```

### Was die Console nutzt

- Inventar über `/cluster/resources`, IPs über den QEMU Guest Agent (Paket
  `qemu-guest-agent` im Gast, Option "QEMU Guest Agent" in der VM aktivieren) oder
  Cloud-Init/LXC-Netzwerkkonfiguration
- Energie, RRD-Graphen, Snapshots, vzdump-Backups (Ziel `PROXMOX_BACKUP_STORAGE` oder der
  erste Backup-Storage), Restore, Firewall, ISO, Rescale, Löschen, Tasks
- Konsole über `vncproxy` und `vncwebsocket`, gebrückt durch die API
- Server erstellen per Klon aus Templates (VMs mit Template-Flag)

### Hinweise zum Port 2096

Port 2096 ist ein Cloudflare-Proxy-Port. Websockets (für die Konsole) laufen über
Cloudflare, sind aber an den Cloudflare-Timeout gebunden. Wenn die Konsole nach einiger
Zeit abbricht, ist ein direkter Zugriff (z.B. über WireGuard oder eine IP-Freigabe nur für
den Console-Server) die robustere Lösung. Bei selbstsignierten Zertifikaten lieber das
CA-Zertifikat im Provider hinterlegen als `PROXMOX_VERIFY_TLS=false` zu setzen.

## Weitere Provider anbinden

Ein Provider ist eine Klasse, die `ProviderAdapter` aus
[`apps/api/src/providers/types.ts`](../apps/api/src/providers/types.ts) implementiert.
Pflicht sind Inventar (`listServers`, `getServer`) und `capabilities()`. Alles andere ist
optional: Die Console blendet Tabs und Buttons automatisch aus, wenn ein Provider eine
Funktion nicht anbietet. Registrieren in `providers/registry.ts`, Typ in
`packages/shared/src/providers.ts` ergänzen, fertig.
