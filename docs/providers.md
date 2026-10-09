# Provider einrichten

## 24fire (Rechenzentrum DE)

- API: REST API v2, Doku unter <https://apidocs.24fire.de/v2>
- Base URL: `https://manage.24fire.de`, Header `X-Fire-Apikey: <key>`, Bodys als
  `application/x-www-form-urlencoded`, Antworten als `{ status, message, data }`
- Konfiguration: `FIRE24_API_KEY` in der `.env` (in einfache Anführungszeichen setzen, der Key
  enthält Sonderzeichen wie `}` oder `)`).

### Endpunkte

Alle 26 Endpunkte der v2-Doku stehen mit Methode und Pfad in
[`apps/api/src/providers/fire24/endpoints.ts`](../apps/api/src/providers/fire24/endpoints.ts) und
sind gegen die Doku geprüft (`verified: true`). Die Spalte 24fire+ zeigt, wofür der Account ein
aktives **24fire+** Abo braucht.

| Funktion in der Console                                                   | Endpunkt                                                        | 24fire+ |
| ------------------------------------------------------------------------- | --------------------------------------------------------------- | ------- |
| Verbindungstest, Guthaben, 24fire+ Status                                 | `GET /api/account`                                              | nein    |
| Server, Domains und Webspaces finden                                      | `GET /api/account/services`                                     | nein    |
| (nur API Explorer) Spendenseite, Affiliate                                | `GET /api/account/donations`, `/affiliate`                      | nein    |
| Konfiguration (CPU, RAM, Disk, IPs, OS, ISO, Abuse-Status, Maximalausbau) | `GET /api/kvm/{id}/config`                                      | nein    |
| Status inkl. laufendem Task (Boot, Reinstall, Backup, Restore)            | `GET /api/kvm/{id}/status`                                      | nein    |
| Energie (start, stop, restart)                                            | `POST /api/kvm/{id}/power` mit `mode=`                          | nein    |
| Traffic des Monats (GB) und Limits                                        | `GET /api/kvm/{id}/traffic/current`                             | nein    |
| Traffic-Verlauf (MB pro 10 Min., in der Console pro Stunde summiert)      | `GET /api/kvm/{id}/traffic/log`                                 | nein    |
| (nicht genutzt) Traffic-Diagramm                                          | `POST /api/kvm/{id}/traffic/chart`                              | ja      |
| Graphen (CPU, RAM, Ping alle 10 Min.)                                     | `GET /api/kvm/{id}/monitoring/timings`                          | ja      |
| Verfügbarkeit und Ausfälle                                                | `GET /api/kvm/{id}/monitoring/incidences`                       | ja      |
| Backups auflisten                                                         | `GET /api/kvm/{id}/backup/list`                                 | nein    |
| Backup erstellen, Fortschritt                                             | `POST /api/kvm/{id}/backup/create`, `.../create/status`         | ja      |
| Backup wiederherstellen, Fortschritt                                      | `POST /api/kvm/{id}/backup/restore`, `.../restore/status`       | ja      |
| Backup löschen                                                            | `DELETE /api/kvm/{id}/backup/delete`                            | ja      |
| DDoS-Schutz pro IPv4 ansehen                                              | `GET /api/kvm/{id}/ddos`                                        | nein    |
| DDoS-Schutz ändern (Layer 4 dynamic/permanent, Layer 7 on/off)            | `POST /api/kvm/{id}/ddos/change`                                | ja      |
| Domain-Infos (Status, Nameserver, Ablauf, Auth-Code)                      | `GET /api/domain/{id}`                                          | nein    |
| DNS-Einträge ansehen                                                      | `GET /api/domain/{id}/dns`                                      | nein    |
| DNS-Eintrag hinzufügen / bearbeiten / löschen                             | `PUT .../dns/add`, `POST .../dns/edit`, `DELETE .../dns/remove` | ja      |
| Webspace (Ressourcen, Plesk-Zugang)                                       | `GET /api/webspace/{id}`                                        | nein    |

Ohne 24fire+ antwortet die Console mit einer klaren Meldung (Code `plus_required`), statt den
Endpunkt aufzurufen. Den Abo-Status liest sie alle paar Minuten aus `GET /api/account`; Graphen,
Monitoring, Restore und Löschen von Backups blendet sie dann aus, DNS ist nur lesbar.
Das Format der Fehlerantworten von 24fire ist nicht dokumentiert. Zum Ausprobieren eignet sich
der API Explorer im Admin-Bereich (Passwörter und Auth-Codes werden dort ausgeblendet).

Servernamen kommen aus `GET /api/account/services`, also so, wie sie im 24fire Control Panel
heissen. Der Hostname aus der KVM-Konfiguration taugt nicht dafür, er ist bei Installationen
aus 24fire-Images immer `24fire`. Wer einen Server in der Console umbenennt, behält diesen
Namen, ein Umbenennen bei 24fire wird dann nicht mehr übernommen.

### Backups

`backup/create` und `backup/restore` starten nur einen Task. Die Console merkt sich die
`backup_id` an der Aktion und fragt alle paar Sekunden die passenden `/status`-Endpunkte ab, bis
24fire `finished` meldet. Beschreibungen erlaubt 24fire nur mit höchstens 24 Zeichen aus
Buchstaben, Umlauten, Leerzeichen und `- _ + # ( ) . :` (keine Ziffern).

### Domains und DNS

Domains kommen beim Sync aus `GET /api/account/services` (Typ `DOMAIN`) in die Console und
werden im Admin-Bereich unter Domains einer Organisation zugewiesen. Dabei wird das Modul
"Domains & DNS" für die Organisation freigeschaltet (abschaltbar). Kunden sehen danach Status,
Nameserver und Ablaufdatum und können DNS-Einträge verwalten, sofern der 24fire-Account 24fire+
hat. Der Auth-Code für einen Transfer wird nie gespeichert, sondern nur über einen eigenen,
protokollierten Aufruf live geholt (Berechtigung `domain:authcode`, nur mit Login, nicht per
API-Token).

### Webspaces

Webspaces (Plesk) werden im 24fire Control Panel bestellt. Die API kann sie nicht anlegen, sie
liefert nur Ressourcen und Zugangsdaten. Ein neuer Webspace erscheint nach dem nächsten Sync
(automatisch oder von Hand beim Provider im Admin-Bereich) unter Webspaces und wird dort einer
Organisation zugewiesen, dabei wird das Modul "Webhosting" freigeschaltet. Das Plesk-Passwort
wird nie gespeichert; die Console holt es nur über einen eigenen, protokollierten Aufruf
(Berechtigung `webspace:credentials`, nur mit Login). Liefert 24fire das Passwort maskiert,
zeigt die Console keines an.

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
GUI), hat das Token eigene, zunächst leere Rechte. Die Verbindung klappt dann zwar, aber die
Console sieht nur den Namen des Nodes, keine Auslastung und keine einzige VM. Der
Verbindungstest meldet das. Entweder `--privsep 0` oder dem Token selbst ACLs geben:

```bash
pveum acl modify / --tokens 'weblion@pve!console' --roles Administrator
```

In der GUI geht das unter Datacenter > Permissions > Add > API Token Permission: Path `/`,
das Token wählen, Rolle `Administrator`, "Propagate" an.

### Was die Console nutzt

- Inventar über `/cluster/resources`, IPs über den QEMU Guest Agent (Paket
  `qemu-guest-agent` im Gast, Option "QEMU Guest Agent" in der VM aktivieren) oder
  Cloud-Init/LXC-Netzwerkkonfiguration bzw. `/lxc/<vmid>/interfaces`
- Energie, RRD-Graphen, Snapshots, vzdump-Backups (Ziel `PROXMOX_BACKUP_STORAGE` oder der
  erste aktive Backup-Storage), Restore, Firewall, ISO, Rescale, Löschen, Tasks
- Konsole über `vncproxy` und `vncwebsocket`, gebrückt durch die API
- Server erstellen per Full Clone aus VM- und Container-Templates (Gäste mit Template-Flag)

Die Aufrufe sind gegen die offizielle API-Referenz (api-viewer, Stand Oktober 2026) geprüft.

### Verhalten im Detail

- **Konsole:** Proxmox erzeugt für API-Tokens ein eigenes VNC-Passwort. Die Console gibt
  nur dieses Passwort an den Browser weiter; das VNC-Ticket bleibt im Server und öffnet nur
  den Websocket. Ältere Versionen ohne eigenes Passwort nutzen das Ticket.
- **Backups:** Angezeigt, wiederhergestellt und gelöscht werden nur Backups des eigenen
  Gasts. Die Console prüft VMID und Typ (VM oder Container) anhand des Volume-Namens, weil
  nicht jeder Storage den VMID-Filter beachtet und eine VMID nach dem Löschen neu vergeben
  werden kann. Restore geht nur bei gestopptem Server. Container werden auf den Storage
  ihrer aktuellen Root-Disk zurückgespielt (ohne Angabe nähme Proxmox `local`).
- **Snapshots:** Ein Rollback stoppt den Gast. War er vorher gestartet, startet die Console
  ihn danach wieder.
- **Tasks:** Endet ein Task mit `WARNINGS: <n>`, gilt er als erfolgreich; die Warnung bleibt
  als Meldung sichtbar.
- **Rescale:** Proxmox zählt bei VMs Kerne pro Socket. Die Console rechnet die gewünschte
  Gesamtzahl auf die vorhandenen Sockets um (geht das nicht auf, wird es ein Socket) und
  passt Hotplug-vCPUs und einen zu hohen Balloon-Wert mit an. Disks wachsen nur.
- **ISO:** Das Image kommt ins vorhandene CD-ROM-Laufwerk. Ein Cloud-Init-Laufwerk bleibt
  unangetastet; fehlt ein CD-ROM-Laufwerk, nimmt die Console einen freien IDE-Slot (bei
  laufender VM erst nach einem Neustart aktiv).
- **Firewall:** Regeln greifen nur, wenn die Firewall im Datacenter aktiv ist und die
  Netzwerkkarte des Gasts die Option "Firewall" (`firewall=1`) hat. Fehlt sie bei allen
  Karten, weist die Console beim Einschalten darauf hin. Regeln aus Security Groups zeigt
  die Console nicht an, die Positionen der übrigen Regeln bleiben aber korrekt.
- **Container:** Kein Reset und kein Suspend (in Proxmox als experimentell markiert).
- **Server erstellen:** Ein anderer Ziel-Node als der des Templates geht nur, wenn das
  Template auf Shared Storage liegt. Die Console wartet auf Klon und Disk-Vergrösserung,
  bevor sie den Server startet.
- **Rechte:** Für Guest-Agent-Daten braucht das Token `VM.GuestAgent.Audit` (in der Rolle
  `Administrator` enthalten).

### Hinweise zum Port 2096

Port 2096 ist ein Cloudflare-Proxy-Port. Websockets (für die Konsole) laufen über
Cloudflare, sind aber an den Cloudflare-Timeout gebunden. Wenn die Konsole nach einiger
Zeit abbricht, ist ein direkter Zugriff (z.B. über WireGuard oder eine IP-Freigabe nur für
den Console-Server) die robustere Lösung. Bei selbstsignierten Zertifikaten lieber das
CA-Zertifikat im Provider hinterlegen als `PROXMOX_VERIFY_TLS=false` zu setzen.

## Hetzner Cloud

- API: `https://api.hetzner.cloud/v1`, Doku unter <https://docs.hetzner.cloud>, Header
  `Authorization: Bearer <token>`, Bodys und Antworten als JSON
- Konfiguration: `HETZNER_API_TOKEN` in der `.env` (optional `HETZNER_BASE_URL` und
  `HETZNER_NAME`) oder im Admin-Bereich unter Provider > Provider hinzufügen > Hetzner Cloud
- Weitere Projekte kommen im Admin-Bereich dazu, über die `.env` gibt es genau eine Verbindung.

### API-Token

In der Hetzner Console (<https://console.hetzner.com>) das Projekt öffnen, dann
**Sicherheit > API-Tokens > API-Token generieren**, Berechtigung **Lesen & Schreiben**. Hetzner
zeigt das Token nur einmal an. Mit einem reinen Lese-Token klappen Inventar und Graphen, aber
keine Aktion (Energie, Backups, Rescale, ...).

Ein Token gilt für genau ein Projekt und sieht nur dessen Server. Eine Verbindung in der
Console ist deshalb ein Hetzner-Projekt. Wer Server in mehreren Projekten hat, legt pro Projekt
eine Verbindung mit eigenem Token an. Das Rate-Limit gilt ebenfalls pro Projekt.

Hetzner meldet den Standort pro Server (Falkenstein, Nürnberg, Helsinki, Ashburn, Hillsboro,
Singapur). Die Console zeigt Land und Stadt des einzelnen Servers. Land und Stadt der
Verbindung sind nur der Standard für Server, die (noch) keinen Standort melden.

### Was die Console nutzt

| Funktion in der Console                                     | Endpunkt                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Verbindungstest                                             | `GET /servers?per_page=1`, `GET /locations`                                                |
| Inventar (Sync)                                             | `GET /servers`, paginiert mit 50 pro Seite                                                 |
| Server-Details, Traffic, Rohkonfiguration                   | `GET /servers/{id}`                                                                        |
| Umbenennen                                                  | `PUT /servers/{id}`                                                                        |
| Energie (starten, herunterfahren, ausschalten, neu starten) | `POST /servers/{id}/actions/poweron`, `shutdown`, `poweroff`, `reboot`, `reset`            |
| Graphen (CPU, Netzwerk, Disk I/O)                           | `GET /servers/{id}/metrics?type=cpu,disk,network`                                          |
| Browser-Konsole                                             | `POST /servers/{id}/actions/request_console`                                               |
| Backups ansehen, erstellen, löschen                         | `GET /images?type=backup&bound_to={id}`, `.../actions/create_image`, `DELETE /images/{id}` |
| Snapshots ansehen, erstellen, löschen                       | `GET /images?type=snapshot`, `.../actions/create_image`, `DELETE /images/{id}`             |
| Backup oder Snapshot zurückspielen, Rebuild                 | `POST /servers/{id}/actions/rebuild`                                                       |
| Rescale (Server-Typ ändern)                                 | `GET /server_types`, `POST /servers/{id}/actions/change_type`                              |
| ISO einlegen und auswerfen                                  | `GET /isos`, `.../actions/attach_iso`, `.../actions/detach_iso`                            |
| Reverse DNS                                                 | `POST /servers/{id}/actions/change_dns_ptr`                                                |
| Root-Passwort zurücksetzen                                  | `POST /servers/{id}/actions/reset_password`                                                |
| Aktivität und Status laufender Aktionen                     | `GET /servers/{id}/actions`, `GET /actions/{id}`                                           |
| Server erstellen (Admin)                                    | `GET /server_types`, `/locations`, `/images`, `POST /servers`                              |
| Server löschen                                              | `DELETE /servers/{id}`                                                                     |
| Währung der Preise                                          | `GET /pricing`                                                                             |

Die JSON-Formen folgen dem offiziellen Go-Client
([hcloud-go](https://github.com/hetznercloud/hcloud-go)). Alles ohne eigenen Button geht
über den API Explorer im Admin-Bereich. Pfade dort sind relativ zu `/v1`, z.B. `/servers`
oder `/server_types`. Root-Passwörter, Konsolen-URLs und VNC-Passwörter blendet der Explorer
aus.

### Verhalten im Detail

- **Konsole:** `request_console` liefert eine einmalige Websocket-URL und ein VNC-Passwort.
  Die API öffnet den Websocket selbst und brückt ihn wie bei Proxmox zum Browser (noVNC). Der
  Browser bekommt nur das VNC-Passwort zu sehen, die URL mit dem Zugangstoken bleibt im Server.
- **Graphen:** CPU, Netzwerk und Disk I/O. Den Arbeitsspeicher meldet Hetzner nicht, dafür
  bräuchte es einen Agenten im Gast. Der Traffic zeigt ein- und ausgehend im laufenden
  Abrechnungszeitraum mit dem inklusiven Kontingent. Gegen das Kontingent zählt nur der
  ausgehende Traffic.
- **Backups:** Hetzner macht täglich ein Backup und behält 7. Backups müssen pro Server bei
  Hetzner aktiviert sein (Hetzner Console oder API Explorer:
  `POST /servers/{id}/actions/enable_backup`). Ohne aktivierte Backups lehnt die Console
  "Backup erstellen" mit der Meldung "Backups are not enabled for this server at Hetzner" ab
  (HTTP 409). Ein manuelles Backup belegt einen der 7 Plätze. Wiederherstellen ist bei Hetzner
  ein Rebuild aus dem Backup: Der Server bleibt derselbe (IPs, Typ), die Disk wird
  überschrieben.
- **Snapshots:** Snapshots enthalten nur die Disk, keinen Arbeitsspeicher. Zurückspielen ist
  ebenfalls ein Rebuild, alles seit dem Snapshot ist danach weg. Snapshots sind bei Hetzner
  Images des Projekts und bleiben auch nach dem Löschen des Servers bestehen (und kosten
  weiter). Solche Snapshots sieht man nur noch im API Explorer oder in der Hetzner Console.
- **Sichtbarkeit:** Kunden sehen nur Snapshots, die von ihrem Server erstellt wurden
  (`created_from`), und Backups, die an ihren Server gebunden sind (`bound_to`). Andere Images
  behandelt die Console wie nicht vorhanden (404), auch wenn jemand eine ID errät. Für den
  Rebuild stehen System- und App-Images mit der Architektur des Servers (x86 oder Arm64) und die
  eigenen Snapshots und Backups zur Wahl.
- **Rescale:** Hetzner verkauft feste Server-Typen (z.B. CX23, CPX32, CAX21). Die Console
  zeigt im Tab Rescale die Typen, auf die der Server wechseln kann: gleiche Architektur, am
  Standort des Servers verfügbar und mit mindestens so grosser Disk. Hetzner wechselt den Typ
  nur bei ausgeschaltetem Server, sonst kommt eine klare Meldung (409). Die Option "Disk
  vergrössern" ist bewusst aus: Ohne sie bleibt die Disk gleich gross und der Wechsel zurück
  auf einen kleineren Typ bleibt möglich. Mit ihr wächst die Disk dauerhaft, kleinere Typen
  gehen danach nicht mehr. Wie bei Proxmox ist Rescale in der Standard-Grenze für Kunden nur
  für weblion.one freigegeben.
- **Rebuild:** Aus einem System-Image setzt Hetzner ein neues Root-Passwort (die Console
  hinterlegt keine SSH-Keys). Die Console zeigt es einmal an und speichert es nicht. Wie beim
  Zurücksetzen bekommt es nur ein interaktiver Login, über API-Tokens gibt die API es nicht
  heraus.
- **Root-Passwort:** `reset_password` braucht einen laufenden Server, Hetzner setzt das
  Passwort über den QEMU Guest Agent. Auch dieses Passwort wird nur einmal angezeigt.
- **ISO:** Zur Wahl stehen die öffentlichen ISOs von Hetzner mit passender Architektur.
  Private ISOs, die jemand ins Projekt hochgeladen hat, blendet die Console aus. Der Server
  bootet nach dem nächsten Neustart von der ISO.
- **Reverse DNS:** Für die IPv4-Adresse des Servers und jede Adresse aus seinem IPv6-Netz
  (/64). Ein leerer Name setzt den Eintrag auf den Standard von Hetzner zurück.
- **Löschen:** Hetzner löscht auch laufende Server sofort und mit allen Daten. Lösch- und
  Rebuild-Schutz bei Hetzner beachtet die Console zusätzlich zum Schutz in der Console.
  Löschen ist wie bei Proxmox in der Standard-Grenze für Kunden nur für weblion.one
  freigegeben.
- **Umbenennen:** Ist der neue Name ein gültiger Hostname, benennt die Console den Server auch
  bei Hetzner um, sonst nur in der Console.
- **Server erstellen:** Admin-Bereich > Server-Inventar > Server erstellen, mit Server-Typ, Standort
  und Image. Der Name muss ein gültiger Hostname sein. Das Root-Passwort, das Hetzner beim
  Erstellen zurückgibt, reicht die Console nicht weiter. Ein Passwort setzt man danach in den
  Einstellungen des Servers (Root-Passwort zurücksetzen), dann sieht es nur, wer den Server
  bekommt.
- **Rate-Limit:** Hetzner erlaubt 3600 Anfragen pro Stunde und Projekt. Der Sync holt alle
  Server mit einer paginierten Liste (eine Anfrage pro 50 Server) und fragt nichts pro Server
  nach. Server-Typen, Standorte und die Währung hält die Console 10 Minuten im Speicher.
  Laufende Aktionen fragt sie umso seltener ab, je länger sie dauern. Antwortet Hetzner mit
  429, versucht die Console es einmal neu, wenn das Limit innerhalb von 5 Sekunden wieder
  frei ist, sonst kommt eine klare Fehlermeldung. `SYNC_INTERVAL_SECONDS` nicht zu tief
  setzen, 120 Sekunden sind pro Projekt rund 30 Anfragen pro Stunde (bis 50 Server).

### Kosten

Hetzner rechnet pro Stunde ab, bis zum Monatspreis des Server-Typs. Was die Console auslösen
kann und was es kostet:

- **Server-Typ:** Ein Rescale ändert den Preis ab sofort. Auch ausgeschaltete Server kosten
  weiter, erst Löschen beendet die Kosten.
- **Backups:** 20 % des Serverpreises, solange sie für den Server aktiviert sind.
- **Snapshots:** pro GB und Monat, auch nach dem Löschen des Servers, bis der Snapshot
  gelöscht ist.
- **Traffic:** Über dem inklusiven Kontingent kostet ausgehender Traffic extra.
- **Neue Server:** ab dem Erstellen, dazu die primäre IPv4-Adresse.

Im Rescale-Tab und beim Erstellen sehen Mitarbeitende von weblion.one die Einkaufspreise
(brutto pro Monat). Kunden sehen keine Preise, auch wenn ihre Grenze Rescale erlaubt.

### Noch nicht unterstützt

- Firewalls: Sie sind bei Hetzner Ressourcen des ganzen Projekts und werden zwischen Servern
  geteilt. Ein Kunde könnte damit Regeln für Server anderer Kunden ändern. Der Tab Firewall
  fehlt deshalb bei Hetzner-Servern.
- Volumes, Load Balancer, Floating IPs und Primary IPs, private Netzwerke, Placement Groups
- Backups ein- und ausschalten, Rescue-System, SSH-Keys und Cloud-Init beim Erstellen
- Storage Boxes, DNS-Zonen (Hetzner DNS) und dedizierte Server über die Robot-API

Bis dahin hilft der API Explorer oder die Hetzner Console. Ideen dazu in
[roadmap.md](roadmap.md).

## Weitere Provider anbinden

Ein Provider ist eine Klasse, die `ProviderAdapter` aus
[`apps/api/src/providers/types.ts`](../apps/api/src/providers/types.ts) implementiert.
Pflicht sind Inventar (`listServers`, `getServer`) und `capabilities()`. Alles andere ist
optional: Die Console blendet Tabs und Buttons automatisch aus, wenn ein Provider eine
Funktion nicht anbietet. Registrieren in `providers/registry.ts`, Typ in
`packages/shared/src/providers.ts` ergänzen, fertig.

Verkauft ein Provider feste Grössen (wie Hetzner), liefert der Adapter `listPlans()` und
`listLocations()`. Rescale und Server erstellen zeigen dann Typ und Standort statt freier
Werte für CPU, RAM und Disk.
