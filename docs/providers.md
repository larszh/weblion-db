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
API-Token). Nameserver, Transfersperre und Verlängerung kann die 24fire-API nicht ändern, das
geht nur im 24fire Control Panel (siehe [Domain-Funktionen im
Vergleich](#domain-funktionen-im-vergleich)).

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
- **Reverse DNS:** Für die Adressen, die der Tab Netzwerk zeigt: die IPv4-Adresse und die
  erste Adresse des IPv6-Netzes (`::1`), jeweils mit einem Hostnamen. Weitere Adressen aus dem
  /64 und das Zurücksetzen auf den Standard von Hetzner (`dns_ptr: null`) gehen nur über den
  API Explorer im Admin-Bereich (`POST /servers/{id}/actions/change_dns_ptr`).
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
- **Rate-Limit:** Hetzner erlaubt 3600 Anfragen pro Stunde und Projekt, für alle Kunden auf
  derselben Verbindung zusammen. Der Sync holt alle Server mit einer paginierten Liste (eine
  Anfrage pro 50 Server) und fragt nichts pro Server nach. Server-Typen, Standorte und die
  Währung hält die Console 10 Minuten im Speicher. Was die Server-Ansicht abfragt (Details,
  Traffic, Rohkonfiguration, Aktivität), hält sie pro Server 15 Sekunden, Graphen 60 Sekunden.
  Weitere Betrachter oder ein Skript, das die API in einer Schleife abfragt, kosten so keine
  zusätzlichen Anfragen. Nach einer Aktion und sobald eine Aktion fertig ist, liest die Console
  den Server neu. Laufende Aktionen fragt sie umso seltener ab, je länger sie dauern. Antwortet
  Hetzner mit 429, versucht die Console es einmal neu, wenn das Limit innerhalb von 5 Sekunden
  wieder frei ist, sonst kommt eine klare Fehlermeldung. `SYNC_INTERVAL_SECONDS` nicht zu tief
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

## Joker.com (Domains)

- API: DMAPI, Spezifikation unter <https://dmapi.joker.com/docs/DMAPI-ext.txt>
- Base URL: `https://dmapi.joker.com/request`. Jeder Request ist ein `POST` auf
  `<Base URL>/<request>` mit Parametern als `application/x-www-form-urlencoded`. Joker
  antwortet mit Text: Header-Zeilen (`Status-Code`, `Proc-ID`, `Tracking-Id`, ...), eine
  Leerzeile, dann der Body.
- Konfiguration: `JOKER_API_KEY` (oder `JOKER_USERNAME` und `JOKER_PASSWORD`) in der `.env`
  oder im Admin-Bereich unter Provider
- Joker.com liefert nur Domains, keine Server. Im Server-Inventar und in den Server-Filtern
  taucht der Provider deshalb nicht auf.

### Voraussetzungen

- Die DMAPI gibt es nur mit einem **Reseller-Konto** bei Joker.com. Ein normales Kundenkonto
  hat keinen API-Zugang.
- **API-Key** (empfohlen): auf joker.com in den Einstellungen des Reseller-Kontos anlegen. Ein
  Key mit nur Leserechten reicht für Sync und Anzeige, kann aber nichts ändern: DNS,
  Nameserver, Transfersperre, Verlängerung und auch der Auth-Code (Joker erzeugt dafür einen
  neuen Code) scheitern dann mit einer Fehlermeldung von Joker. Für die Console also einen Key
  mit vollen Rechten anlegen. Ein Key lässt sich jederzeit widerrufen, ohne dass sich das
  Passwort des Kontos ändert.
- Alternativ **Benutzername und Passwort** des Reseller-Kontos. Sind Key und Passwort
  gesetzt, gewinnt der Key.
- **Testsystem (OT&E):** Joker betreibt unter `https://dmapi.ote.joker.com/request` ein
  Testsystem mit eigenem Konto, dort kostet nichts Geld. Für den ersten Test (Auth-Code,
  Nameserver, Verlängerung) lohnt es sich, damit anzufangen.
- Verlängerungen bucht Joker vom Guthaben des Reseller-Kontos ab. Den Kontostand zeigen der
  Verbindungstest und die Seite des Providers im Admin-Bereich.

### Konfiguration

Über die `.env` (Werte mit Sonderzeichen in einfache Anführungszeichen setzen):

```env
JOKER_API_KEY='...'
# oder statt des Keys:
# JOKER_USERNAME=...
# JOKER_PASSWORD='...'
# Testsystem: https://dmapi.ote.joker.com/request
JOKER_BASE_URL=https://dmapi.joker.com/request
JOKER_NAME=Joker.com
```

Sobald ein Key oder Benutzername und Passwort gesetzt sind, legt die Console den Provider beim
Start an, speichert die Zugangsdaten verschlüsselt und übernimmt Änderungen beim nächsten
Neustart. Die Zugangsdaten eines solchen Providers ändern Sie nur über die `.env`.

Oder im Admin-Bereich unter Provider > Provider hinzufügen, Typ Joker.com: Anmeldung wählen
(API-Key oder Benutzername und Passwort), Base URL eintragen (ein Schalter setzt das
Testsystem). Beim Bearbeiten bleiben leere Felder für Key und Passwort beim gespeicherten
Wert. "Verbindung testen" meldet sich neu an und zeigt Konto, Guthaben und die Zahl der
Domains.

Nach dem ersten Sync stehen die Domains unter Admin > Domains & Webspaces als nicht
zugewiesen. Wie bei 24fire wird beim Zuweisen an einen Kunden das Modul "Domains & DNS"
freigeschaltet (abschaltbar).

### Sync und Details

- Pro Sync-Lauf (alle `SYNC_INTERVAL_SECONDS`) genau ein Aufruf: `query-domain-list` mit
  `showstatus=1` und `showjokerns=1`. Daraus kommen Name, Ablaufdatum, Status,
  Transfersperre, automatische Verlängerung und ob die Domain die Joker-Nameserver nutzt.
- Ein Whois pro Domain läuft im Sync nicht, das wären bei vielen Domains ebenso viele
  Anfragen pro Lauf. Nameserver, Inhaber (Name, Organisation, E-Mail), Registrierungsdatum,
  Whois-Datenschutz und DNSSEC holt die Console live per `query-whois`, wenn jemand die Domain
  öffnet, und speichert sie dann.
- Was die Liste nicht liefert, behält den gespeicherten Wert. Domains, die bei Joker
  verschwinden, werden als fehlend markiert.
- Intern ist eine Domain über ihren kleingeschriebenen Namen adressiert, Umlaut-Domains in der
  ASCII-Form (`xn--...`), so wie Joker sie listet.
- Status: Eine normale Registrierung zeigt die Console als "Aktiv". Transfersperre und
  automatische Verlängerung haben eigene Felder. Andere Joker-Flags (z.B. `transfer` oder
  `deleted`) erscheinen unverändert als Status.

Die Console meldet sich einmal an und nutzt die Session weiter (`auth-sid`, immer im Body, nie
in der URL). Läuft sie ab, meldet sie sich einmal neu an und wiederholt den Request. Höchstens
drei Requests laufen gleichzeitig. Fehler zeigt die Console mit dem Text von Joker, dem
Status-Code und der Tracking-Id (für Rückfragen beim Joker-Support). API-Key, Passwort und
Session-ID stehen nie in einer Meldung.

### Was die Console nutzt

| Funktion in der Console                                                   | DMAPI-Request                                           | Berechtigung                           |
| ------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------- |
| Verbindungstest, Konto, Guthaben                                          | `login`, `query-profile`, `query-domain-list`           | Admin-Bereich                          |
| Domains finden (Sync)                                                     | `query-domain-list` mit `showstatus=1`, `showjokerns=1` | Sync-Job                               |
| Domain-Details (Nameserver, Inhaber, Ablauf, Sperre, Datenschutz, DNSSEC) | `query-whois`                                           | `domain:read`                          |
| Prüfen, ob Joker die DNS-Zone führt (5 Minuten zwischengespeichert)       | `dns-zone-list`                                         | `domain:read`                          |
| DNS-Einträge ansehen                                                      | `dns-zone-get`                                          | `domain:read`                          |
| DNS-Eintrag hinzufügen / bearbeiten / löschen                             | `dns-zone-get`, dann `dns-zone-put`                     | `domain:dns:write`                     |
| Nameserver ändern                                                         | `domain-modify` mit `ns-list`                           | `domain:manage`                        |
| Transfersperre setzen / aufheben                                          | `domain-lock`, `domain-unlock`                          | `domain:manage`                        |
| Auth-Code anzeigen                                                        | `domain-transfer-get-auth-id`, dann `result-retrieve`   | `domain:authcode`, nur mit Login       |
| Automatische Verlängerung ein / aus                                       | `domain-set-property` mit `pname=autorenew`             | `platform:domain:write`, nur mit Login |
| Jetzt verlängern                                                          | `query-whois`, dann `domain-renew` mit `expyear`        | `platform:domain:write`, nur mit Login |
| API Explorer                                                              | jeder Request ausser `login` und `logout`               | `platform:explorer`, nur mit Login     |

Nameserver, Transfersperre und Verlängerung erledigt Joker asynchron. Joker bestätigt den
Auftrag mit einer Proc-ID, die Console zeigt sie als Referenz an. Ob ein Auftrag durchging,
zeigt im API Explorer `/result-list` oder `/result-retrieve?proc-id=<Proc-ID>`.

### DNS

Joker führt eine DNS-Zone für Domains, die die Joker-Nameserver nutzen (`a.ns.joker.com`,
`b.ns.joker.com`, `c.ns.joker.com`). Nur dann sind die Einträge live. Die Console prüft das mit
`dns-zone-list`:

- Steht die Domain dort, zeigt der Tab "DNS" die Zone, und Änderungen gehen direkt zu Joker.
- Steht sie nicht dort (andere Nameserver, z.B. Cloudflare), ist die Liste leer, und die API
  lehnt Änderungen mit 422 ab ("does not use the Joker.com name servers"). Die Übersicht der
  Domain weist darauf hin. Wer die Einträge bei Joker pflegen will, stellt zuerst die
  Nameserver um (Vorlage "Joker-Nameserver" im Dialog "Nameserver ändern"). Die Zonenliste
  ist 5 Minuten zwischengespeichert, eine neue Zone erscheint also mit etwas Verzögerung.

**Ganze Zone:** Die DMAPI kennt keine einzelnen Einträge. Jede Änderung liest die Zone
(`dns-zone-get`), ändert eine Zeile und schreibt die ganze Zone zurück (`dns-zone-put`).
Zeilen, die die Console nicht bearbeitet (Kommentare, `$dyndns=...`, unbekannte Einträge),
gehen unverändert zurück. Änderungen an derselben Domain laufen in der Console nacheinander.
Wer gleichzeitig im Joker-Panel an derselben Zone arbeitet, kann eine Änderung überschreiben:
Es gilt, was zuletzt gespeichert wurde.

**IDs:** Joker vergibt keine IDs für Einträge. Die Console bildet sie aus dem Inhalt der Zeile
(Hash, bei identischen Zeilen mit Zähler). Hat sich ein Eintrag inzwischen geändert, z.B. im
Joker-Panel, passt die alte ID zu keiner Zeile mehr. Die API antwortet dann mit 404, statt
einen anderen Eintrag zu treffen. Nach dem Neuladen der Liste geht es weiter. Ein
bearbeiteter Eintrag bekommt eine neue ID.

**Typen:** Die Werte haben in der Console für alle Provider dasselbe Format, der Adapter
rechnet in die Joker-Schreibweise um.

| In der Console       | In der Joker-Zone                | Wert in der Console                                                                                              |
| -------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A, AAAA              | A, AAAA                          | IPv4- bzw. IPv6-Adresse                                                                                          |
| CNAME                | CNAME                            | Hostname                                                                                                         |
| MX                   | MX                               | `10 mail.example.ch`                                                                                             |
| TXT                  | TXT                              | Text ohne Anführungszeichen. Steht ein langer Wert in mehreren Teilen in der Zone, fügt die Console sie zusammen |
| SRV                  | SRV (`10/5 sip.example.ch:5060`) | `10 5 5060 sip.example.ch` (Priorität, Gewicht, Port, Ziel)                                                      |
| CAA                  | CAA                              | `0 issue "letsencrypt.org"`, Joker erlaubt nur Flags 0                                                           |
| NAPTR                | NAPTR                            | `100 10 "u" "E2U+sip" "!^.*$!sip:info@example.ch!" .`                                                            |
| Weiterleitung (URL)  | URL                              | Adresse mit `http://` oder `https://`                                                                            |
| Frame-Weiterleitung  | FRAME                            | Adresse mit `http://` oder `https://`, die Domain bleibt in der Adresszeile stehen                               |
| E-Mail-Weiterleitung | MAILFW                           | Zieladresse. Der Name des Eintrags ist der Teil vor dem @                                                        |
| DynDNS (nur lesen)   | DYNA, DYNAAAA                    | IP-Adresse, die der DynDNS-Client setzt                                                                          |

NAPTR nimmt entweder eine Regexp (mit Ersatz `.`) oder einen Ersatz-Hostnamen, nicht beides.
NS, ALIAS, PTR, TLSA, DS und DNSKEY bietet die Console für Joker nicht an. DynDNS-Einträge und
Zeilen, die die Console nicht zuordnen kann, stehen mit "Nur lesen" in der Liste und lassen
sich nur löschen. Zusätzliche Joker-Parameter einer Zeile (z.B. Gültigkeitsdaten oder der
Titel einer Frame-Weiterleitung) setzt die Console nicht. Beim Bearbeiten ohne Typwechsel
bleiben vorhandene erhalten.

**TTL:** Joker verlangt mindestens 300 Sekunden, SRV und NAPTR dürfen bis 0 hinunter.
Kleinere Werte lehnt die Console mit einer Meldung ab. Neue Einträge ohne Angabe bekommen
3600 Sekunden, zur Auswahl stehen 5 Minuten bis 1 Tag. Beim Bearbeiten bleibt die bisherige
TTL, wenn keine neue angegeben ist, auch eine kürzere, die schon in der Zone steht (z.B.
120 Sekunden von einem Let's-Encrypt-Client).

### Nameserver und Transfersperre

Beides dürfen Kunden selbst, mit der Berechtigung "Nameserver und Transfersperre ändern"
(`domain:manage`). Owner und Admin haben sie, Member nicht. Per Policy lässt sie sich einzelnen
Mitgliedern geben, über die Berechtigungsgrenze einem ganzen Kunden entziehen. Beides geht auch
per API-Token mit Schreibrecht. In der Console: Domains & DNS > Domain > Übersicht.

- **Nameserver:** 2 bis 13 Hostnamen, kleingeschrieben, ohne Punkt am Ende, keiner doppelt. Die
  Vorlage "Joker-Nameserver" trägt `a.ns.joker.com`, `b.ns.joker.com` und `c.ns.joker.com` ein.
  Die Registry übernimmt die Änderung später, je nach Endung nach Minuten bis Stunden. Bis
  dahin zeigt die Console die bisherigen Nameserver, die neuen speichert sie nicht vorab.
- **Transfersperre:** Die Console speichert den neuen Zustand sofort und zeigt ihn, bis Joker
  ihn meldet. Solange `query-whois` und die Domainliste noch den alten Zustand zeigen, setzen
  Detailansicht und Sync ihn nicht zurück, höchstens 30 Minuten lang. Danach gilt wieder, was
  Joker meldet (z.B. wenn der Auftrag nicht durchging). Kennt eine Endung keine
  Transfersperre, lehnt Joker den Auftrag ab, und die Console zeigt die Meldung.

Im Audit-Log stehen `domain.nameservers_update` und `domain.lock` bzw. `domain.unlock` mit
altem und neuem Wert, auch fehlgeschlagene Versuche. Per API:

```bash
curl -X PUT -H "Authorization: Bearer wlc_…" -H "Content-Type: application/json" \
  -d '{"nameservers":["a.ns.joker.com","b.ns.joker.com","c.ns.joker.com"]}' \
  https://cp.weblion.cloud/api/v1/domains/<domain-id>/nameservers
curl -X PUT -H "Authorization: Bearer wlc_…" -H "Content-Type: application/json" \
  -d '{"locked":true}' https://cp.weblion.cloud/api/v1/domains/<domain-id>/lock
```

Die Antwort ist `{ "ok": true, "message": "...", "providerRef": "<Proc-ID>" }`. Kann der
Provider das nicht (z.B. 24fire), antwortet die API mit 422 (`unsupported`).

### Automatische Verlängerung und Verlängern

Verlängerungen kosten Geld: Joker belastet das Reseller-Konto von weblion.one sofort. Deshalb
ist beides Mitarbeitenden von weblion.one mit der Berechtigung `platform:domain:write`
vorbehalten (Plattform-Rolle Superadmin, nicht Support) und geht nur mit Login, nie per
API-Token. In der Console: Admin > Domains & Webspaces (Menü der Zeile) oder in der Übersicht
der Domain, Karte "Verlängerung" (Kunden sehen sie nicht).

- **Automatische Verlängerung:** `domain-set-property` mit `pname=autorenew` und `pvalue=1`
  bzw. `0`. Joker verlängert die Domain dann vor dem Ablauf selbst. Die Console speichert die
  Einstellung sofort und hält sie wie die Transfersperre, bis Joker sie meldet (höchstens 30
  Minuten).
- **Jetzt verlängern:** 1 bis 10 Jahre. Die Console liest zuerst das aktuelle Ablaufdatum per
  `query-whois` und sendet `domain-renew` mit `expyear` = Ablaufjahr plus Jahre, also ein
  Zieljahr statt einer Laufzeit. Joker verlängert nur bis zu diesem Jahr. Dazu schickt der
  Dialog das Ablaufdatum mit, das er angezeigt hat. Zeigt `query-whois` inzwischen ein anderes
  Ablaufjahr (der erste Auftrag ist durch, nur seine Antwort ging verloren), sendet die
  Console nichts und antwortet mit 409. Ein doppelter Klick oder ein wiederholter Request
  verlängert deshalb nicht doppelt. Danach liest die Console die Domain neu, damit das neue
  Ablaufdatum sichtbar ist.

Im Audit-Log stehen `domain.auto_renew` und `domain.renew`. Per API (nur mit Session):
`POST /api/v1/admin/domains/<id>/auto-renew` mit `{"enabled": true}` und
`POST /api/v1/admin/domains/<id>/renew` mit `{"years": 1, "expiresAt": "<Ablaufdatum>"}`.
`expiresAt` ist das Ablaufdatum, ab dem verlängert werden soll, ohne gilt das gespeicherte.
Dem Kunden stellt die Console Verlängerungen nicht automatisch in Rechnung, siehe
[billing.md](billing.md#domain-verlängerungen).

### Auth-Code

Joker erzeugt den Auth-Code asynchron: `domain-transfer-get-auth-id` startet einen Auftrag mit
Proc-ID, den Code liefert später `result-retrieve`. Die Console fragt bis zu rund 12 Sekunden
nach. Hat Joker dann noch kein Ergebnis (Status 2303 "Object does not exist" oder
Completion-Status `?`), meldet sie "Auth-Code wird erstellt" (409, `authcode_pending`). Jede
andere Fehlermeldung von Joker, auch ein abgelehnter Login, kommt als Fehler an. Der nächste
Klick fragt denselben Auftrag erneut ab, statt einen neuen zu starten. Die Proc-ID merkt sich
die Console 30 Minuten pro Domain, nur im Speicher des API-Prozesses. Nach einem Neustart
startet der nächste Klick einen neuen Auftrag.

Wichtig: Jeder neue Auftrag erzeugt bei Joker einen neuen Code, ein früher abgerufener wird
damit ungültig. Den Code also erst abrufen, wenn der neue Anbieter ihn braucht, und immer den
neuesten verwenden. Für den Transfer muss die Transfersperre aufgehoben sein.

Berechtigung `domain:authcode`, nur mit Login. Jeder erfolgreiche Abruf steht im Audit-Log
(`domain.authcode_view`), der Code selbst wird nie gespeichert oder protokolliert.

### API Explorer

Für alles ohne eigenen Button: Admin > API Explorer, Provider Joker.com wählen.

- Der **Pfad** ist der Name des DMAPI-Requests mit optionalem Query-String, z.B.
  `/query-whois?domain=example.com`. Weitere Parameter kommen als JSON ins Feld darunter, z.B.
  `{ "domain": "example.com" }`.
- Joker bekommt immer einen `POST` mit der Session der Console, ein Methodenfeld gibt es
  deshalb nicht. `login` und `logout` sind gesperrt, ein mitgegebenes `auth-sid` wird
  verworfen.
- Vorlagen: Domain-Liste, Whois, Reseller-Profil, DNS-Zonen, eine DNS-Zone und
  Auftragsergebnisse (`/result-list`).
- Die Antwort zeigt die Header als Objekt und den Body als Text. Auth-Codes, die Session-ID
  und das DynDNS-Passwort aus `dns-zone-get` sind ausgeblendet. Eine Zone deshalb nicht aus
  dem Explorer kopieren und per `dns-zone-put` zurückschreiben, sonst steht `[redacted]` als
  DynDNS-Passwort in der Zone.
- Lesende Requests (`query-*`, `dns-zone-list`, `dns-zone-get`, `result-list`,
  `result-retrieve`, `domain-check`) gehen als GET und landen nicht im Audit-Log, alle anderen
  als POST und schon (`provider.explorer`). Ein ändernder Request als GET wird mit 400
  abgelehnt, er kann das Audit-Log also nicht umgehen.

### Grenzen

Noch nicht in der Console, das geht weiterhin im Joker-Panel:

- Domains registrieren und zu Joker transferieren, inkl. Kontakte (Handles) anlegen. Neue
  Domains erscheinen nach dem nächsten Sync in der Console.
- Inhaber- und Kontaktwechsel
- DNSSEC einrichten (die Console zeigt nur, ob es aktiv ist)
- Whois-Datenschutz bestellen (die Console zeigt nur den Stand)
- Domains kündigen oder löschen

Ideen dafür stehen in der [Roadmap](roadmap.md).

### Offene Punkte

Gegen das echte Joker-System ist die Anbindung noch nicht getestet, nur gegen einen
Mock-Server nach der Spezifikation. Vor dem ersten echten Einsatz im Testsystem (OT&E) prüfen:

- Die Antwort von `result-retrieve` auf den Auth-Code-Auftrag ist nicht dokumentiert. Die
  Console erkennt Zeilen wie `Auth-ID`, `AuthID`, `Auth-Info` oder `Transfer-Auth-Id` und den
  Status `ack` bzw. `nack`.
- Die Spaltennamen von `query-domain-list` (Header `Columns`). Ohne den Header liest die
  Console die Spalten nach Position.
- Der Aufbau von CAA-Zeilen in der Zone. Die Console schreibt sie wie in der Spezifikation
  (`caa CAA 0 issue "letsencrypt.org" 86400`).
- `domain-renew`: Die Spezifikation führt `privacy` als Pflichtparameter. Die Console sendet
  nur `domain` und `expyear`, schaltet also keinen Datenschutz ein und bezahlt keinen. Vor der
  ersten echten Verlängerung prüfen, ob Joker das so annimmt.
- Ein im Admin-Bereich angelegter Provider lässt sich zwischen API-Key und Benutzername/Passwort
  umstellen: Beim Speichern im jeweils anderen Modus entfernt die Console die bisherigen
  Zugangsdaten. Leere Felder behalten wie bei allen Providern den gespeicherten Wert.

## Cloudflare (DNS und CDN)

- API: Cloudflare API v4, Doku unter <https://developers.cloudflare.com/api/>
- Base URL: `https://api.cloudflare.com/client/v4`, Header `Authorization: Bearer <API-Token>`,
  Bodys als JSON. Antworten kommen im Umschlag `{ success, errors, messages, result, result_info }`.
- Konfiguration: `CLOUDFLARE_API_TOKEN` (optional `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_BASE_URL`,
  `CLOUDFLARE_NAME`) in der `.env` oder im Admin-Bereich unter Provider > Provider hinzufügen >
  Cloudflare
- Cloudflare liefert keine Server. Im Server-Inventar und in den Server-Filtern taucht der Provider
  deshalb nicht auf.

### Was die Console damit macht

Cloudflare ist kein Registrar. Die Console führt die Zonen eines Cloudflare-Kontos als Domains der
Art **DNS-Zone**, neben den registrierten Domains (Joker.com, 24fire) der Art **Registrierung**.
Beides sind Einträge derselben Domain-Liste im Modul "Domains & DNS" (`dns`). Zuweisen, Reseller,
Module und Sperre funktionieren also wie bei jeder Domain.

- **DNS-Einträge** mit Proxy-Schalter (die "orange Wolke" von Cloudflare) und automatischer TTL
- **CDN** (Tab "CDN" der Zone): SSL/TLS-Modus inklusive Automatic SSL/TLS, Always Use HTTPS,
  Entwicklungsmodus und den ganzen Cache leeren
- **Wartende Zonen:** Die Übersicht zeigt die Nameserver, die beim Registrar einzutragen sind, und
  prüft die Aktivierung auf Knopfdruck.
- **Registrierung und Zone verknüpft:** Gibt es dieselbe Domain bei einem Registrar und als Zone bei
  Cloudflare, verlinken sich beide Seiten. Eine neue Zone geht beim ersten Sync an den Kunden der
  Registrierung, wenn dieser eindeutig ist.
- **DNS zu Cloudflare umziehen** (nur weblion.one): Zone anlegen, Einträge vom Registrar kopieren,
  danach die Nameserver beim Registrar umstellen

Wer darf was:

| Aktion                                                        | Berechtigung                          | Per API-Token | Standard                    |
| ------------------------------------------------------------- | ------------------------------------- | ------------- | --------------------------- |
| Zone, Einträge und CDN-Einstellungen ansehen                  | `domain:read`                         | ja            | alle Rollen mit Lesezugriff |
| Einträge anlegen, ändern, löschen, Proxy ein- und ausschalten | `domain:dns:write`                    | ja            | Owner, Admin, Member        |
| SSL/TLS, Always Use HTTPS, Entwicklungsmodus, Cache leeren    | `domain:manage`                       | ja            | Owner, Admin                |
| Aktivierung einer wartenden Zone prüfen                       | `domain:manage`                       | ja            | Owner, Admin                |
| Zone einem Kunden zuweisen                                    | `platform:server:assign`              | nein          | weblion.one Superadmin      |
| DNS zu Cloudflare umziehen                                    | `platform:domain:move`, nur mit Login | nein          | weblion.one Superadmin      |
| API Explorer                                                  | `platform:explorer`, nur mit Login    | nein          | weblion.one Superadmin      |

Die CDN-Einstellungen dürfen Kunden selbst ändern: Sie wirken nur auf die eigene Zone, kosten bei
Cloudflare nichts und lassen sich jederzeit zurückstellen. Den SSL/TLS-Modus wählt am besten, wer
den Server hinter der Zone kennt, und den Cache nach einem Deployment zu leeren soll auch per
API-Token gehen. Wer das einem Kunden nicht erlauben will, nimmt ihm `domain:manage` über die
Berechtigungsgrenze. Damit fallen auch Nameserver und Transfersperre weg.

### API-Token

Im Cloudflare-Dashboard unter **My Profile > API Tokens > Create Token > Custom token** ein eigenes
Token erstellen. Den Global API Key (`X-Auth-Email` und `X-Auth-Key`) unterstützt die Console nicht.
Cloudflare zeigt das Token nur einmal an.

| Berechtigung im Dashboard                    | Wofür die Console sie braucht                                         |
| -------------------------------------------- | --------------------------------------------------------------------- |
| Zone : Zone : Edit                           | Zonen lesen, Aktivierung prüfen, Zonen anlegen (DNS-Umzug)            |
| Zone : DNS : Edit                            | DNS-Einträge lesen und ändern, Typwechsel                             |
| Zone : Zone Settings : Edit                  | SSL/TLS-Modus, Automatic SSL/TLS, Always Use HTTPS, Entwicklungsmodus |
| Zone : Cache Purge : Purge                   | Cache leeren                                                          |
| Account : Account Settings : Read (optional) | Kontoname im Verbindungstest, nur mit Konto-ID                        |

- **Zone Resources:** "Include > All zones from an account > (Konto)". Dann gilt das Token auch für
  Zonen, die später dazukommen, z.B. durch den DNS-Umzug. Ein Token nur für einzelne Zonen sieht
  neue Zonen nicht.
- Statt "Zone : Zone : Edit" geht auch "Read". Dann scheitern Aktivierungsprüfung und DNS-Umzug mit
  einer Meldung (HTTP 403), alles andere funktioniert.
- **Konto-ID** (`CLOUDFLARE_ACCOUNT_ID`): 32 Zeichen aus 0-9 und a-f, im Dashboard auf der
  Startseite des Kontos unter "Account ID". Optional, nötig nur, um Zonen anzulegen (DNS-Umzug). Mit
  ihr zeigt die Console nur die Zonen dieses Kontos, ohne sie alle Zonen, die das Token in
  irgendeinem Konto sieht.
- **Konto-Token** (unter Manage Account > API Tokens statt im Profil) gehen auch, brauchen aber die
  Konto-ID: Die Console prüft ein Token zuerst unter `/accounts/<Konto-ID>/tokens/verify`, dann unter
  `/user/tokens/verify`.
- **Eigener Benutzer:** Cloudflare erlaubt 1200 API-Anfragen pro 5 Minuten und Benutzer, für alle
  Tokens, Skripte und Dashboard-Sitzungen dieses Benutzers zusammen. Am besten bekommt die Console
  einen eigenen Cloudflare-Benutzer als Mitglied des Kontos, dessen Token nur sie nutzt.

### Konfiguration

Über die `.env`:

```env
CLOUDFLARE_API_TOKEN=...
# Optional, nötig für den DNS-Umzug (Zonen anlegen)
CLOUDFLARE_ACCOUNT_ID=0123456789abcdef0123456789abcdef
CLOUDFLARE_BASE_URL=https://api.cloudflare.com/client/v4
CLOUDFLARE_NAME=Cloudflare
```

Ist ein Token gesetzt, legt die Console den Provider beim Start an, speichert die Zugangsdaten
verschlüsselt und übernimmt Änderungen beim nächsten Neustart. Token und Konto-ID eines solchen
Providers ändern sich nur über die `.env`, der Name gilt beim ersten Start. Eine Konto-ID, die nicht
aus 32 Hex-Zeichen besteht, verhindert den Start mit einer Meldung. Als Standort zeigt die Console
"Cloudflare (weltweit)", die Zonen laufen über das Anycast-Netz von Cloudflare.

Oder im Admin-Bereich unter Provider > Provider hinzufügen, Typ Cloudflare: API-Token, Konto-ID
(optional) und API Base URL. Beim Bearbeiten behält ein leeres Token-Feld das gespeicherte Token,
ein leeres Feld für die Konto-ID entfernt sie. Vom Token zeigt die Console nur die ersten 4 und die
letzten 3 Zeichen.

"Verbindung testen" prüft, ob das Token aktiv ist, liest die Zonen und mit Konto-ID den Namen des
Kontos. Es meldet Status und Ablauf des Tokens, Konto, Zahl der Zonen und ob die Verbindung Zonen
anlegen kann. Die Seite des Providers zeigt Konto, Zahl der Zonen nach Status (aktiv, wartend,
umgezogen) und ob Zonen angelegt werden können.

**Mehrere Konten:** Jedes Konto (oder Token) ist eine eigene Verbindung, weitere kommen im
Admin-Bereich dazu. Haben mehrere eine Konto-ID, fragt der DNS-Umzug, in welchem Konto die Zone
entsteht. Zwei Verbindungen mit Tokens desselben Cloudflare-Benutzers teilen sich dessen Rate-Limit.

### Sync und Zuweisung

- Pro Sync-Lauf (alle `SYNC_INTERVAL_SECONDS`) liest die Console alle Zonen mit `GET /zones`, 50 pro
  Anfrage (das Maximum von Cloudflare), mit Konto-ID gefiltert auf dieses Konto. Bei 200 Zonen sind
  das 4 Anfragen pro Lauf.
- Gespeichert werden Name (kleingeschrieben, Umlaut-Domains in der `xn--`-Form), Status
  (`initializing`, `pending`, `active`, `moved`), die zugeteilten Nameserver, die bisherigen
  Nameserver und der bisherige Registrar, Anlage- und Aktivierungsdatum, Zonentyp (`full`,
  `partial`, `secondary`), Tarif und ob die Zone pausiert ist. Als "DNS live" gilt eine Zone nur im
  Status `active`. DNS-Einträge und CDN-Einstellungen speichert die Console nie, sie liest sie live.
- Die Detailansicht liest die Zone live nach (30 Sekunden zwischengespeichert) und speichert, was
  sie bekommt.
- Neue Zonen sind nicht zugewiesen, mit einer Ausnahme beim ersten Sync einer Zone: Gibt es
  bei anderen Providern eine Registrierung desselben Namens (Gross- und Kleinschreibung egal), nicht
  als fehlend markiert und genau einem Kunden zugewiesen, geht die Zone an diesen Kunden. Im
  Audit-Log steht `domain.assign` mit "Sync" als Auslöser und `reason: "matching_registration"`.
  Gehören solche Registrierungen mehreren Kunden, bleibt die Zone frei, und das Log der API meldet
  es. Module schaltet der Sync dabei nicht frei. Spätere Läufe weisen nie neu zu: Eine Zone, die
  weblion.one einem Kunden wegnimmt, bleibt frei.
- Zonen, die bei Cloudflare verschwinden, werden als fehlend markiert.
- Admin > Domains & Webspaces zeigt Zonen mit dem Hinweis "DNS-Zone", zugewiesen wird wie bei jeder
  Domain. Reseller geben Zonen wie Domains an ihre Kunden weiter. Registrierung und Zone sind zwei
  Einträge, die beide einzeln verschoben werden.

### Registrierung und Zone

Gibt es eine Domain bei Joker.com (oder 24fire) und eine Zone desselben Namens bei Cloudflare,
stehen beim Kunden zwei Einträge in der Liste, die Zone mit dem Hinweis "DNS-Zone".

- Die Zone verlinkt auf die Registrierung ("Zur Domain bei Joker.com"), dort werden die Nameserver
  gesetzt. Die Registrierung zeigt in der Karte "Nameserver" die Zone mit Status und verlinkt
  darauf.
- Verknüpft ist nur, was die Person sehen darf: Die Zone eines anderen Kunden bleibt für einen Kunden
  unsichtbar. Wer beide sehen darf (z.B. weblion.one), bekommt bei einer Zone in einer anderen
  Organisation einen Hinweis statt eines Links.
- Der Dialog "Nameserver ändern" der Registrierung bietet die Vorlage "Nameserver der Zone bei
  Cloudflare" an, sobald die Zone mindestens zwei Nameserver hat.
- Nutzt die Registrierung nicht die Nameserver des Registrars, verweist ihr Tab "DNS" auf die Zone.
  Bedient der Registrar die Domain noch, bleibt der Tab wie bisher, mit dem Hinweis, dass eine Zone
  bei Cloudflare vorbereitet ist.

Per API stehen die Verknüpfungen in `GET /api/v1/domains/<id>` als `dnsZone` (bei einer
Registrierung) und `registration` (bei einer Zone), jeweils `null`, wenn es keine gibt oder die
Person sie nicht sehen darf. `kind` sagt, ob ein Eintrag eine Registrierung oder eine Zone ist.

### Was die Console nutzt

Alle Pfade relativ zu `/client/v4`.

| Funktion in der Console        | Endpunkt                                                                                                                                        | Berechtigung                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Verbindungstest                | `GET /accounts/{account_id}/tokens/verify` (mit Konto-ID) bzw. `GET /user/tokens/verify`, `GET /zones?per_page=5`, `GET /accounts/{account_id}` | Admin-Bereich                         |
| Übersicht des Providers        | `GET /zones` (alle Seiten)                                                                                                                      | Admin-Bereich                         |
| Zonen finden (Sync)            | `GET /zones?per_page=50&page=…`, mit Konto-ID `account.id=…`                                                                                    | Sync-Job                              |
| Zone ansehen                   | `GET /zones/{zone_id}`                                                                                                                          | `domain:read`                         |
| DNS-Einträge ansehen           | `GET /zones/{zone_id}/dns_records?per_page=1000&page=…`                                                                                         | `domain:read`                         |
| Eintrag hinzufügen             | `POST /zones/{zone_id}/dns_records`                                                                                                             | `domain:dns:write`                    |
| Eintrag ändern, Proxy schalten | `GET`, dann `PATCH /zones/{zone_id}/dns_records/{id}`                                                                                           | `domain:dns:write`                    |
| Typ eines Eintrags ändern      | `POST /zones/{zone_id}/dns_records/batch` (löschen und neu anlegen in einem Schritt)                                                            | `domain:dns:write`                    |
| Eintrag löschen                | `DELETE /zones/{zone_id}/dns_records/{id}`                                                                                                      | `domain:dns:write`                    |
| CDN-Einstellungen ansehen      | `GET /zones/{zone_id}/settings/ssl`, `/ssl_automatic_mode`, `/always_use_https`, `/development_mode`                                            | `domain:read`                         |
| CDN-Einstellung ändern         | `PATCH /zones/{zone_id}/settings/{setting}` mit `{"value": …}`                                                                                  | `domain:manage`                       |
| Cache leeren                   | `POST /zones/{zone_id}/purge_cache` mit `{"purge_everything": true}`                                                                            | `domain:manage`                       |
| Aktivierung prüfen             | `PUT /zones/{zone_id}/activation_check`                                                                                                         | `domain:manage`                       |
| Zone anlegen (DNS-Umzug)       | `POST /zones` mit `{"account": {"id": …}, "name": …, "type": "full"}`, bei "existiert schon" `GET /zones?name=…`                                | `platform:domain:move`, nur mit Login |
| API Explorer                   | jeder Pfad unter `/client/v4`, ausser Änderungen an API-Tokens                                                                                  | `platform:explorer`, nur mit Login    |

Fehler zeigt die Console als `<Aktion> failed: <Meldung> (<Code>) (HTTP <Status>)`, bei mehreren
Fehlern alle, verschachtelte (`error_chain`) angehängt. Dazu kommt ein Hinweis: bei 401 (oder
einem Code für ein ungültiges Token) "Token prüfen", bei 403 die nötigen Berechtigungen, bei 429
das Rate-Limit, bei 5xx "Cloudflare gerade nicht erreichbar". HTML-Fehlerseiten von Cloudflare
zeigt die Console nie, nur den HTTP-Status. Eine Antwort mit HTTP 200 und `success: false` (beim
Cache leeren möglich) gilt als Fehler. Das Token steht in keiner Meldung. Weiterleitungen folgt der
Client nicht, damit das Token nie an einen anderen Host geht.

### DNS

Cloudflare speichert vollständige Namen (`www.muster-shop.ch`), die Console zeigt sie wie bei allen
Providern relativ zur Zone (`www`, `@` für die Domain selbst) und rechnet um. Die Werte haben in der
Console dasselbe Format wie bei Joker.com und 24fire.

| In der Console                                                             | Bei Cloudflare                                   | Wert in der Console                                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| A, AAAA                                                                    | `content`                                        | IPv4- bzw. IPv6-Adresse                                                                        |
| CNAME, NS, PTR                                                             | `content`                                        | Hostname. CNAME geht auch für `@` (Cloudflare gibt dort die Adressen des Ziels heraus)         |
| MX                                                                         | `content` und `priority`                         | `10 mail.example.ch`                                                                           |
| TXT                                                                        | `content` als Zeichenketten in Anführungszeichen | Text ohne Anführungszeichen. Über 255 Bytes teilt die Console den Wert selbst in mehrere Teile |
| SRV                                                                        | `data`                                           | `10 5 5060 sip.example.ch` (Priorität, Gewicht, Port, Ziel)                                    |
| CAA                                                                        | `data`                                           | `0 issue "letsencrypt.org"`                                                                    |
| NAPTR                                                                      | `data`                                           | `100 10 "u" "E2U+sip" "!^.*$!sip:info@example.ch!" .`                                          |
| TLSA                                                                       | `data`                                           | `3 1 1 <Zertifikat in Hex>`                                                                    |
| DS                                                                         | `data`                                           | `12345 13 2 <Digest in Hex>`                                                                   |
| DNSKEY, HTTPS, SVCB, CERT, LOC, URI, SSHFP, SMIMEA, OPENPGPKEY (nur lesen) | `content` bzw. `data`                            | wie Cloudflare sie formatiert                                                                  |

- **Nur lesen:** die Typen der letzten Zeile, NS-Einträge für `@` (die setzt Cloudflare selbst) und
  alle Einträge einer sekundären Zone. Die Console ändert solche Einträge nicht (400), löschen
  geht, soweit Cloudflare es zulässt. In einer sekundären Zone legt die Console keine Einträge an
  (422).
- **Nicht angeboten:** ALIAS (dafür CNAME für `@`), Weiterleitungen und E-Mail-Weiterleitungen, wie
  Joker sie kennt.
- **TTL:** `1` heisst "Automatisch", sonst 60 bis 86400 Sekunden (30 Sekunden nur im
  Enterprise-Tarif, die Console bietet sie nicht an). Neue Einträge ohne Angabe bekommen
  "Automatisch".
- **Proxy:** Nur A, AAAA und CNAME können über den Proxy laufen, andere Typen lehnt die API mit 400
  ab. Ob Cloudflare einen Eintrag tatsächlich über den Proxy leiten kann (z.B. nicht bei privaten
  Adressen), meldet Cloudflare pro Eintrag, die Console zeigt dann einen Strich statt des Schalters.
  Ein Eintrag mit Proxy hat immer die TTL "Automatisch", die Console setzt sie selbst. Den Proxy
  schalten alle mit `domain:dns:write` (auch Member), in der Spalte "Proxy" des Tabs "DNS" oder im
  Dialog des Eintrags. Per API: `PATCH /api/v1/domains/<id>/dns/<record-id>` mit
  `{"proxied": true}`. Bei Providern ohne Proxy ignoriert die API das Feld.
- **Notizen:** Die Kommentare, die Cloudflare zu einem Eintrag speichert, zeigt die Console unter
  dem Wert an, ändern lassen sie sich nur im Dashboard. Die Console ändert Einträge mit `PATCH` und
  schickt nur geänderte Felder, Kommentare, Tags und Einstellungen eines Eintrags bleiben so
  erhalten.
- **IDs:** Anders als bei Joker behält ein Eintrag seine ID, wenn er geändert wird. Nur ein
  Typwechsel legt ihn neu an (ein Batch-Request: löschen, dann anlegen), mit neuer ID. Kommentar
  und Tags nimmt die Console dabei mit.
- **Konflikte:** A, AAAA und CNAME desselben Namens schliessen sich bei Cloudflare aus, NS verträgt
  sich mit keinem anderen Eintrag desselben Namens. Die Meldung von Cloudflare kommt mit Code
  zurück.
- Im Audit-Log stehen `domain.dns_add`, `domain.dns_update` und `domain.dns_delete` wie bei jedem
  Provider, zusätzlich mit `proxied`.

### CDN

Tab "CDN" einer Zone. Ansehen mit `domain:read`, ändern mit `domain:manage` (Owner und Admin, auch
per API-Token). Eine Änderung betrifft genau eine Einstellung:

- **SSL/TLS-Modus:** "Automatisch" (Automatic SSL/TLS: Cloudflare wählt den Modus und kann ihn
  später selbst erhöhen), "Aus", "Flexibel", "Vollständig", "Vollständig (streng)". Ist Automatic
  SSL/TLS an und jemand wählt einen festen Modus, schaltet die Console zuerst Automatic SSL/TLS aus
  (`ssl_automatic_mode` auf `custom`) und setzt dann den Modus. Scheitert der zweite Schritt, ist
  Automatic SSL/TLS aus und der Modus unverändert, die Meldung sagt das. Eine Änderung braucht bis
  zu 5 Minuten. "Aus" und "Flexibel" muss man in der Console bestätigen. Kann die Console den
  Automatic-Modus nicht lesen (403 oder 404), bietet sie "Automatisch" nicht an.
- **Always Use HTTPS:** leitet HTTP auf HTTPS um.
- **Entwicklungsmodus:** umgeht den Cache, schaltet sich nach 3 Stunden selbst ab. Die Console zeigt
  die restliche Zeit.
- **Cache leeren:** immer der ganze Cache (`purge_everything`). Cloudflare bestätigt den Auftrag
  und leert in wenigen Sekunden. Cloudflare begrenzt das Leeren je nach Tarif (HTTP 429, Code
  1134). Die Console sperrt den Knopf nach einem Klick für 30 Sekunden.

Erlaubt der Tarif eine Einstellung nicht (`editable: false`), lehnt die Console die Änderung mit 422
ab, ohne Cloudflare zu fragen. CDN-Einstellungen wirken nur für Einträge mit Proxy und erst, wenn
die Zone aktiv ist. Beides sagt der Tab. Registrierte Domains haben keinen Tab "CDN", die API
antwortet dort mit 422. Im Audit-Log stehen `domain.cdn_update` (Einstellung, alter und neuer Wert)
und `domain.cache_purge`. Per API:

```bash
curl -H "Authorization: Bearer wlc_…" https://cp.weblion.cloud/api/v1/domains/<domain-id>/cdn
curl -X PATCH -H "Authorization: Bearer wlc_…" -H "Content-Type: application/json" \
  -d '{"sslMode":"strict"}' https://cp.weblion.cloud/api/v1/domains/<domain-id>/cdn
curl -X POST -H "Authorization: Bearer wlc_…" -H "Content-Type: application/json" \
  -d '{"everything":true}' https://cp.weblion.cloud/api/v1/domains/<domain-id>/cdn/purge
```

`sslMode` ist `auto`, `off`, `flexible`, `full` oder `strict`, die anderen Felder sind
`{"alwaysUseHttps": true}` und `{"developmentMode": true}`, jeweils allein im Body (sonst 400).

### Wartende Zonen und Aktivierung

Eine neue Zone wartet (`pending`), bis die Domain auf die Nameserver zeigt, die Cloudflare der Zone
zugeteilt hat. Bis dahin gelten die Einträge bei den bisherigen Nameservern.

- Die Übersicht der Zone zeigt die zu setzenden Nameserver zum Kopieren, die bisherigen Nameserver
  und, falls im Panel vorhanden, einen Link zur Registrierung. Bei Joker setzt man sie dort mit der
  Vorlage "Nameserver der Zone bei Cloudflare".
- Einträge lassen sich schon vorbereiten, solange die Zone wartet.
- "Aktivierung jetzt prüfen" (`domain:manage`) bittet Cloudflare um eine Prüfung
  (`PUT /zones/{zone_id}/activation_check`), nur bei wartenden Zonen (sonst 409). Cloudflare prüft
  ohnehin regelmässig. Laut API-Spezifikation geht eine Prüfung von Hand im kostenlosen Tarif
  höchstens einmal pro Stunde, in bezahlten Tarifen alle 5 Minuten. Danach liest die Console die
  Zone neu. Im Audit-Log steht `domain.zone_activation_check`. Per API:
  `POST /api/v1/domains/<id>/zone/activation-check`.
- **Umgezogen** (`moved`): Die Domain zeigt nicht mehr auf Cloudflare, die Einträge der Zone gelten
  nicht mehr. Cloudflare löscht solche Zonen nach einiger Zeit, dann markiert der Sync sie als
  fehlend.
- **Pausiert:** Cloudflare beantwortet nur noch DNS-Anfragen, ohne Proxy und CDN.

### DNS zu Cloudflare umziehen

Nur für weblion.one: Berechtigung `platform:domain:move` (Plattform-Rolle Superadmin, nicht
Support), nur mit Login, nie per API-Token. In der Console: Übersicht einer registrierten Domain,
Karte "DNS zu Cloudflare umziehen" (nur, solange keine aktive Zone desselben Namens im Panel ist),
oder Admin > Domains & Webspaces, Menü der Zeile. Beides gibt es nur für Registrierungen, die nicht
als fehlend markiert sind.

Ziel ist eine aktive Cloudflare-Verbindung mit Konto-ID. Ohne eine solche sagt der Dialog das. Er
zeigt vorher, was passiert: Zielkonto (bei mehreren wählbar), eine schon vorhandene Zone, die
Einträge, die kopiert werden, die angepassten (Typ oder TTL) und die nicht übernommenen mit Grund.

1. **Zone:** Gibt es auf der Zielverbindung schon eine Zone dieses Namens (nicht fehlend), nimmt die
   Console sie. Sonst legt sie eine an (`POST /zones`, Typ `full`, ohne `jump_start`). Meldet
   Cloudflare, dass die Zone im Konto schon existiert, übernimmt die Console diese. Liegt sie in
   einem anderen Konto, kommt die Meldung von Cloudflare. Eine neue Zone gehört im Panel dem Kunden
   der Registrierung. Scheitert dieser Schritt, endet der Umzug mit der Fehlermeldung.
2. **Einträge** (Standard an): nur, wenn der Registrar die Domain bedient (seine Nameserver sind
   eingetragen). Sonst sind seine Einträge nicht die gültigen, und die Console kopiert nichts. Sie
   kopiert nie in eine Zone, die schon Einträge hat, und höchstens 500 Einträge (sonst im Dashboard
   importieren), vier gleichzeitig. Kopierte Einträge laufen nie über den Proxy, am Verkehr ändert
   sich beim Umstellen also nichts. Nicht übernommen werden Einträge, die nur gelesen werden
   können, NS-Einträge für `@` und Typen, die Cloudflare nicht nimmt (Weiterleitungen und
   E-Mail-Weiterleitungen von Joker, DNSKEY). ALIAS wird zu CNAME für `@`. Eine TTL unter 60
   Sekunden (auch 0) wird "Automatisch", eine über 86400 wird 86400.
3. **Nameserver** (Standard aus): Die Console stellt sie beim Registrar nur um, wenn Schritt 2 im
   selben Lauf alles kopiert hat und der Registrar das über die Console kann (Joker.com). Sonst
   listet das Ergebnis die Nameserver, die man von Hand setzt. Joker übernimmt die Änderung
   asynchron, danach wird die Zone aktiv, sobald Cloudflare die neue Delegation sieht (Minuten bis
   Stunden).

Das Ergebnis zeigt jeden Schritt mit Status. Im Audit-Log stehen `domain.zone_create` (auf der Zone,
bei einem Fehler auf der Registrierung), `domain.dns_import` (auf der Zone, mit kopierten,
fehlgeschlagenen und übersprungenen Einträgen), `domain.nameservers_update` (auf der Registrierung,
mit `reason: "dns_move"`) und zum Schluss `domain.dns_move`. Erfolgreich ist der Umzug nur, wenn
jeder gewählte Schritt durchging.

Wiederholen ist sicher: Die Zone wird wiederverwendet, und in eine Zone mit Einträgen kopiert die
Console nichts mehr. Deshalb stellt ein zweiter Lauf auch keine Nameserver um. Nach einem
unvollständigen Umzug ergänzt man die Zone in deren Tab "DNS" und stellt danach die Nameserver im
Dialog "Nameserver ändern" der Registrierung um (Vorlage "Nameserver der Zone bei Cloudflare").
Läuft für eine Domain schon ein Umzug, antwortet die API mit 409. Ein Umzug kostet etwa eine
Cloudflare-Anfrage pro Eintrag, 500 Einträge also rund 505 der 1200 Anfragen in 5 Minuten.

Per API (nur mit Session): `GET /api/v1/admin/domains/<id>/dns-move?targetProviderId=<provider-id>`
zeigt den Plan, `POST /api/v1/admin/domains/<id>/dns-move` mit
`{"targetProviderId": "<provider-id>", "importRecords": true, "setNameservers": true}` führt ihn aus.

### API Explorer

Für alles ohne eigenen Button: Admin > API Explorer, Provider Cloudflare wählen.

- Pfade relativ zu `/client/v4`, z.B. `/zones/<zone_id>/dns_records`. Die Base URL oder
  `/client/v4` davor sind erlaubt. Methoden GET, POST, PUT, PATCH und DELETE.
- GET und DELETE senden die Felder aus dem JSON-Feld als Query, die anderen Methoden als JSON-Body.
- Gesperrt sind `//`, `..`, `\`, `@` und kodierte Punkte oder Schrägstriche im Pfad sowie jede
  Änderung an API-Tokens (`/user/tokens…`, `/accounts/<id>/tokens…`): Rollt jemand das Token der
  Console, ist die Verbindung weg.
- Vorlagen: Token-Status, Zonen, eine Zone, DNS-Einträge, SSL/TLS-Modus, Always Use HTTPS,
  Entwicklungsmodus, Konten.
- In Antworten sind Werte von Feldern wie `secret`, `password`, `private_key` oder `token`
  ausgeblendet, unter `/tokens` auch `value` (neue Tokens), bei Pfaden auf `/token` das Ergebnis
  (Tunnel-Tokens). Das Token der Console steht nie in einer Antwort.
- Ändernde Requests stehen mit Pfad und Body im Audit-Log (`provider.explorer`), lesende nicht.

### Rate-Limit und Zwischenspeicher

- Cloudflare erlaubt 1200 Anfragen pro 5 Minuten und Benutzer. Die Console bleibt pro Verbindung
  unter 1000 in 5 Minuten (gleitendes Fenster, Wiederholungen zählen mit). Ist das Fenster voll,
  wartet eine Anfrage bis zu 5 Sekunden, sonst scheitert sie mit einer Meldung, ohne Cloudflare zu
  erreichen.
- Antwortet Cloudflare mit 429 und einem `Retry-After` von höchstens 5 Sekunden, versucht die Console
  es einmal neu, sonst kommt eine Meldung.
- Höchstens vier Anfragen pro Verbindung laufen gleichzeitig.
- Was die Ansichten lesen, hält die Console pro API-Prozess: Zone 30 Sekunden, Einträge 15 Sekunden,
  CDN-Einstellungen 30 Sekunden. Änderungen über die Console leeren das sofort. Eine zweite
  API-Instanz kann also bis zu 30 Sekunden alte Werte zeigen, ebenso nach einer Änderung im
  Dashboard.

### Grenzen

Noch nicht in der Console, das geht weiterhin im Cloudflare-Dashboard:

- Zonen von Hand anlegen (ausser über den DNS-Umzug) und löschen. Neue Zonen erscheinen nach dem
  nächsten Sync und werden dann zugewiesen.
- Tarife, Page Rules, Redirect- und Cache-Regeln, Firewall und WAF, DNSSEC bei Cloudflare, E-Mail
  Routing
- Einzelne URLs aus dem Cache leeren (nur der ganze Cache)
- Kommentare und Tags von Einträgen ändern
- Typen wie HTTPS, SVCB, CERT oder LOC anlegen (nur lesen)
- Teilweise (`partial`, CNAME-Setup) und sekundäre Zonen zeigt die Console nur an. Ihre Aktivierung
  über einen Verifizierungseintrag läuft im Dashboard.
- Einen Scan der bestehenden Einträge (Nachfolger von `jump_start`) für Domains, deren DNS bei
  einem Drittanbieter liegt
- Abrechnung: Zonen sind normale Domains, ein Dienst lässt sich mit ihnen verknüpfen. Eine eigene
  Abrechnung für Zonen oder CDN gibt es nicht.

Ideen dazu in der [Roadmap](roadmap.md).

### Offene Punkte

Gegen das echte Cloudflare ist die Anbindung noch nicht getestet, nur gegen einen Mock-Server nach
der OpenAPI-Spezifikation von Cloudflare. Vor dem ersten echten Einsatz mit einem Test-Konto und
einer Test-Zone prüfen:

- Das Rate-Limit von 1200 Anfragen pro 5 Minuten: Gilt es für alle Tokens und das Dashboard eines
  Benutzers zusammen, schickt die Client-API bei 429 ein `Retry-After`, und mit welchem Code?
- `jump_start` fehlt in der Spezifikation. Startet eine Zone, die über die API ohne dieses Feld
  angelegt wird, ohne Einträge? Hat sie doch welche, kopiert der Umzug nichts und meldet "Zone hat
  schon Einträge", es entstehen keine doppelten.
- Fehlercodes, die die Console auswertet: 1061 "existiert schon" beim Anlegen einer Zone (die
  Meldung wird zusätzlich geprüft), 81044 "Eintrag existiert nicht", 9109, 10000, 6003 und 6111
  für ungültige Tokens. Ausserdem der Code für "Aktivierung zu früh geprüft".
- In welcher Form TXT-Werte zurückkommen (mit oder ohne Anführungszeichen, die Console liest
  beides) und wie lang sie sein dürfen.
- Die echte Höchstzahl an Einträgen pro Seite (die Console fragt 1000 an).
- Ob `result_info.total_count` bei Zonen die Gesamtzahl ist (der Verbindungstest nimmt sonst
  `count`).
- Proxy: nur A, AAAA und CNAME, private Adressen nicht, und wie Cloudflare eine andere TTL als 1
  bei Einträgen mit Proxy behandelt (die Console sendet immer 1).
- Einträge, die Cloudflare sperrt: Die Console liest dafür `locked` und `meta.read_only` aus älteren
  API-Versionen, beides steht nicht in der Spezifikation.
- Ob `PATCH` die Felder in `data` ersetzt oder zusammenführt (die Console schickt alle) und ob
  `PATCH` den Typ ändern darf (die Console nutzt dafür den Batch-Request).
- Die Einstellungen pro Zone: Die Spezifikation markiert sie als nicht verfügbar im Free- und
  Pro-Tarif, vermutlich ein Fehler der Spezifikation. Ausserdem das Verhalten von `ssl`, während
  Automatic SSL/TLS an ist, und wie stabil der Endpunkt `ssl_automatic_mode` ist (in der
  Spezifikation versteckt).
- Ob Konto-Tokens an `/user/tokens/verify` scheitern (die Console fragt mit Konto-ID zuerst beim
  Konto).
- Ob das Anlegen einer Zone zusätzlich das Konto unter "Account Resources" des Tokens braucht.
- Grenzen für wartende Zonen pro Konto, Subdomain-Zonen ausserhalb von Enterprise
- Nach welcher Zeit Cloudflare umgezogene Zonen löscht
- Ob CNAME für `@` in jedem Tarif ohne eigene Einstellung funktioniert
- Wie viele Operationen der Batch-Request erlaubt (die Console schickt ein Löschen und ein Anlegen).

### Demo

Mit `ENABLE_DEMO_PROVIDER=true` und `ENABLE_DEMO_CLOUDFLARE=true` legt die Console eine zweite
Demo-Verbindung "Demo Cloudflare" an, die ein Cloudflare-Konto im Speicher simuliert, mit denselben
Regeln wie die echte Anbindung (Proxy, TTL, Konflikte, CDN, Aktivierung, Zonen anlegen).
`pnpm db:seed` gleicht sie nach dem Demo-Provider ab:

- `muster-shop.ch` ist aktiv und gehört Muster AG. Die Registrierung beim Demo-Provider zeigt schon
  auf die Nameserver der Zone, beide Seiten verlinken sich. Die Zone hat Einträge mit Proxy, eine
  Notiz und einen HTTPS-Eintrag (nur lesen).
- `beispiel-gmbh.de` wartet auf die Nameserver und gehört Beispiel GmbH
  (`dev@beispiel.example`), die dafür das Modul "Domains & DNS" bekommt. `intern` zeigt auf eine
  private Adresse und kann nicht über den Proxy.
- `alt-muster.ch` ist umgezogen und keinem Kunden zugewiesen.

Zum Ausprobieren des Umzugs: als Admin `baeckerei-huber.ch` (Registrierung beim Demo-Provider) zu
"Demo Cloudflare" umziehen, mit Nameservern. Eine wartende Zone wird aktiv, sobald die
Registrierung desselben Namens beim Demo-Provider auf ihre Nameserver zeigt.

## Domain-Funktionen im Vergleich

Jeder Adapter meldet, was er bei Domains kann, die Console zeigt nur das an. Ruft jemand per
API etwas auf, das der Provider nicht kann, antwortet sie mit 422 (`unsupported`).

|                                       | 24fire        | Joker.com                 | Cloudflare                                   | Demo                |
| ------------------------------------- | ------------- | ------------------------- | -------------------------------------------- | ------------------- |
| Art                                   | Registrierung | Registrierung             | DNS-Zone                                     | Registrierung       |
| DNS-Einträge ansehen                  | ja            | ja, mit Joker-Nameservern | ja, auch bei wartenden Zonen                 | ja                  |
| DNS-Einträge ändern                   | mit 24fire+   | ja, mit Joker-Nameservern | ja, ausser in sekundären Zonen               | ja                  |
| TTL pro Eintrag                       | nein          | ja, ab 300 Sekunden       | ja, "Automatisch" oder 60 bis 86400 Sekunden | ja                  |
| Proxy pro Eintrag                     | nein          | nein                      | A, AAAA, CNAME                               | nein                |
| CNAME für `@`                         | nein          | nein                      | ja                                           | nein                |
| NAPTR                                 | nein          | ja                        | ja                                           | ja                  |
| E-Mail-Weiterleitung, Weiterleitungen | nein          | ja                        | nein                                         | ja                  |
| ALIAS                                 | ja            | nein                      | nein (CNAME für `@`)                         | ja                  |
| NS, PTR, TLSA, DS                     | ja            | nein                      | ja (NS nicht für `@`)                        | ja                  |
| DNSKEY                                | ja            | nein                      | nur lesen                                    | ja                  |
| CDN-Einstellungen, Cache leeren       | nein          | nein                      | ja                                           | nein                |
| Nameserver ändern                     | nein          | ja                        | nein (setzt Cloudflare)                      | ja                  |
| Transfersperre                        | nein          | ja                        | nein                                         | ja                  |
| Auth-Code                             | ja            | ja, asynchron             | nein                                         | ja                  |
| Automatische Verlängerung, Verlängern | nein          | ja, nur weblion.one       | nein                                         | ja, nur weblion.one |

Der Demo-Provider (`ENABLE_DEMO_PROVIDER=true`) simuliert alle Funktionen eines Registrars im
Speicher, mit den Regeln von Joker (TTL ab 300 Sekunden, eine Auftragsnummer wie die Proc-ID). Zum
Ausprobieren: `muster-shop.ch` nutzt Cloudflare-Nameserver (Hinweis "andere Nameserver", DNS nur
lesend, mit `ENABLE_DEMO_CLOUDFLARE=true` stattdessen der Link zur Zone), `muster-ag.ch` hat einen
DynDNS-Eintrag (nur lesen), `alpenblick-hotel.ch` Einträge für NAPTR, Weiterleitung und
E-Mail-Weiterleitung. Eine simulierte Cloudflare-Verbindung kommt mit `ENABLE_DEMO_CLOUDFLARE=true`
dazu, siehe Abschnitt "Demo" unter [Cloudflare](#cloudflare-dns-und-cdn).

## Nextcloud (Cloud-Speicher)

- API: OCS-API von Nextcloud (Provisioning API), Doku unter
  <https://docs.nextcloud.com/server/latest/admin_manual/configuration_user/instruction_set_for_users.html>
- Base URL: die Adresse der Instanz, z.B. `https://cloud.weblion.one`. Jeder Aufruf geht an
  `<Base URL>/ocs/v2.php/...?format=json`, mit HTTP Basic Auth (Admin-Benutzer und App-Passwort)
  und dem Header `OCS-APIRequest: true`. Bodys als `application/x-www-form-urlencoded`,
  Antworten als `{ ocs: { meta, data } }`.
- Konfiguration: `NEXTCLOUD_URL`, `NEXTCLOUD_USER` und `NEXTCLOUD_APP_PASSWORD` in der `.env` oder
  im Admin-Bereich unter Provider > Provider hinzufügen > Nextcloud
- Nextcloud liefert keine Server. Im Server-Inventar und in den Server-Filtern taucht der
  Provider deshalb nicht auf.

### Was das Modul macht

weblion.one betreibt eine eigene Nextcloud und verkauft darauf Konten. Das Modul
**Cloud-Speicher** (`storage`) bringt das in die Console:

- **Kontingent pro Kunde:** weblion.one (oder ein Reseller für seine Kunden) gibt einer
  Organisation ein Speicherkontingent auf einer Instanz: Speicher gesamt in GB und optional eine
  Höchstzahl an Konten.
- **Konten mit eigenem Kontingent:** Darin legt der Kunde selbst Nextcloud-Konten an, jedes mit
  eigenem Kontingent in ganzen GB (mindestens 1 GB). Die Summe der Kontingente aller Konten darf
  das gebuchte Kontingent nicht übersteigen.
- **Selbstverwaltung:** Kunden ändern Anzeigename, E-Mail und Kontingent, deaktivieren und
  aktivieren Konten, setzen Passwörter neu, senden Einladungen erneut und löschen Konten. In der
  Console unter dem Menüpunkt "Cloud-Speicher", sobald das Modul aktiv ist.
- **Verbrauch:** Der Sync holt belegten Speicher und letzte Anmeldung aus Nextcloud.

Das Kontingent ist eine Obergrenze für die Verteilung, keine Reservierung auf der Platte. Die
Konten belegen nur, was sie tatsächlich speichern. Wer mehr verkauft, als die Instanz Platz hat,
muss den Platz der Instanz selbst überwachen: Die Console zeigt den belegten Speicher pro Konto
und pro Kunde, den freien Platz der Instanz aber nicht.

Wer darf was:

| Wer                           | Darf                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Owner, Admin                  | Konten anlegen, ändern, löschen (`cloud:write`) und Passwörter neu setzen (`cloud:password`)                          |
| Member, Nur lesen             | Konten und Verbrauch ansehen (`cloud:read`)                                                                           |
| Eingeschränkt, Buchhaltung    | nichts, per Policy erweiterbar                                                                                        |
| API-Token "Lesen & Schreiben" | was die Person darf, der das Token gehört, aber ohne Passwörter: Konten nur mit Einladung, kein "Passwort neu setzen" |
| Mitarbeitende eines Resellers | im Panel seiner Kunden, was ihre Reseller-Rolle erlaubt, dazu Kontingente der Kunden (`reseller:customer:write`)      |
| weblion.one Superadmin        | alles, dazu Kontingente, Übernehmen und Zuweisen                                                                      |
| weblion.one Support           | alles ansehen, nichts ändern                                                                                          |

Cloud-Konten haben keinen eigenen Ressourcenpfad. Eine Policy gilt immer für alle Konten der
Organisation (Ressource `org` oder `*`).

### Voraussetzungen

1. **Eigene Nextcloud-Instanz.** Die Console legt keine Instanz an, sie verwaltet die Benutzer
   einer bestehenden. Am einfachsten ist **Nextcloud All-in-One (AIO)** mit Docker auf einer
   eigenen VM:
   - in der Hetzner Cloud (Daten in Deutschland oder Finnland) oder auf dem eigenen Proxmox
     (Daten in der Schweiz)
   - mit eigener Domain und TLS, z.B. `cloud.weblion.one`. AIO holt das Zertifikat selbst.
   - mit genug Platz für den verkauften Speicher. Für viel Speicher das Datenverzeichnis schon
     bei der Installation auf eine eigene Disk oder ein Volume legen (AIO-Option
     `NEXTCLOUD_DATADIR`). Später umziehen ist aufwendig.
   - mit Backups ausser Haus, z.B. mit dem eingebauten BorgBackup von AIO. Es sichert die ganze
     Instanz, ein einzelnes gelöschtes Konto lässt sich daraus nur von Hand zurückholen.

   Eine Instanz trägt viele Kunden. Mehrere Instanzen (z.B. CH und DE) sind mehrere Provider.

2. **E-Mail in Nextcloud.** Einladungen und Willkommensmails verschickt Nextcloud selbst, nicht
   die Console. In Nextcloud unter Verwaltung > Grundeinstellungen > E-Mail-Server einen
   SMTP-Server eintragen und die Test-Mail senden. Ohne funktionierenden Versand legt Nextcloud
   ein Konto mit Einladung trotzdem an, die Mail geht aber verloren (Nextcloud schreibt den Fehler
   nur ins eigene Log). Die Person kommt dann erst hinein, wenn jemand die Einladung erneut sendet
   oder ein Passwort neu setzt. Die Einstellung `newUser.sendEmail` muss an bleiben (Standard),
   sonst verschickt Nextcloud beim Anlegen keine Einladung.
3. **Eigenes Admin-Konto für die Console**, nicht das persönliche. Es muss Mitglied der Gruppe
   `admin` sein, sonst lehnt "Verbindung testen" ab. Delegierte Admins und Gruppen-Admins reichen
   nicht. Für dieses Konto ein **App-Passwort** erstellen: als dieses Konto anmelden, dann
   Persönliche Einstellungen > Sicherheit > Geräte & Sitzungen > Neues App-Passwort erstellen. Ein
   App-Passwort funktioniert auch mit Zwei-Faktor-Anmeldung und lässt sich widerrufen, ohne das
   Passwort des Kontos zu ändern. 2FA für dieses Konto deshalb einschalten.
4. **Kunden auf einer Instanz trennen.** Standardmässig darf in Nextcloud jeder mit jedem teilen,
   und der Teilen-Dialog schlägt alle Benutzer der Instanz vor. Kunden sähen so die Namen anderer
   Kunden. Unter Verwaltung > Teilen das Teilen auf Mitglieder der eigenen Gruppen beschränken
   und die Vervollständigung von Benutzernamen ebenso. Das Systemadressbuch zeigt sonst alle
   Benutzer als Kontakte, auch das abschalten. Per `occ`:

   ```bash
   occ config:app:set core shareapi_only_share_with_group_members --value=yes
   occ config:app:set core shareapi_restrict_user_enumeration_to_group --value=yes
   occ config:app:set dav system_addressbook_exposed --value=no
   ```

   Bei AIO läuft `occ` im Container:
   `docker exec --user www-data -it nextcloud-aio-nextcloud php occ ...`. Weil die Console alle
   Konten einer Organisation in eine gemeinsame Gruppe legt, finden sich Kolleginnen und Kollegen
   weiterhin. Links zum Teilen nach aussen bleiben möglich.

5. **Erreichbarkeit.** Die Console ruft die Instanz unter der Base URL auf. Diese Adresse muss zu
   den `trusted_domains` der Instanz gehören (bei AIO ist es die Domain), sonst antwortet
   Nextcloud mit einer HTML-Fehlerseite. Die Console folgt keinen Weiterleitungen, damit die
   Zugangsdaten nie an einen anderen Host gehen. Also `https://` angeben, und liegt Nextcloud in
   einem Unterverzeichnis, dieses mit (`https://example.ch/nextcloud`).

Nextcloud bremst Clients nach fehlgeschlagenen Anmeldungen (Brute-Force-Schutz, HTTP 429). Lief
die Console eine Weile mit einem falschen App-Passwort, trifft das auch die Anfragen danach. Die
IP der Console lässt sich in der App "Brute-force settings" ausnehmen.

### Konfiguration

Über die `.env` (Werte mit Sonderzeichen in einfache Anführungszeichen setzen):

```env
NEXTCLOUD_URL=https://cloud.weblion.one
NEXTCLOUD_USER=weblion-console
NEXTCLOUD_APP_PASSWORD='...'
NEXTCLOUD_NAME=Nextcloud
NEXTCLOUD_COUNTRY=CH
NEXTCLOUD_CITY=Zürich
```

Sind URL, Benutzer und App-Passwort gesetzt, legt die Console den Provider beim Start an,
speichert die Zugangsdaten verschlüsselt und übernimmt Änderungen beim nächsten Neustart. Die
Zugangsdaten eines solchen Providers ändern Sie nur über die `.env`. Name, Land und Stadt (der
Standort der Instanz) gelten beim ersten Start, danach ändern Sie sie im Admin-Bereich.

Oder im Admin-Bereich unter Provider > Provider hinzufügen, Typ Nextcloud: URL der Instanz,
Admin-Benutzer, App-Passwort und optional das Gruppen-Präfix. Beim Bearbeiten behält ein leeres
Feld das gespeicherte App-Passwort. "Verbindung testen" prüft Adresse und App-Passwort, ob das
Konto Admin ist, und meldet Version, Benutzer und Zahl der Benutzer. Die Seite des Providers zeigt
Version, Zahl der Benutzer und der Gruppen mit dem Präfix sowie die Adresse zum Anmelden.

**Gruppen-Präfix:** Standard `weblion-`. Erlaubt sind Kleinbuchstaben, Ziffern, Punkt, Binde-
und Unterstrich, am Anfang ein Buchstabe oder eine Ziffer, höchstens 31 Zeichen. Es lässt sich
nur im Admin-Bereich setzen. Für den Provider aus der `.env` gibt es keine Variable, er nutzt
immer `weblion-`. Ein neues Präfix gilt nur für neue Konten, bestehende bleiben in ihren Gruppen.

### Login-Namen und Gruppen

- **Login-Name** ist `<Name>@<Kürzel der Organisation>`, z.B. `anna@muster-ag`. Das Kürzel ist
  eindeutig, Namen verschiedener Kunden auf derselben Instanz kollidieren also nie. Der Kunde
  wählt nur den Teil vor dem `@`: Kleinbuchstaben, Ziffern, Punkt, Binde- und Unterstrich, am
  Anfang und Ende ein Buchstabe oder eine Ziffer, höchstens 32 Zeichen. Der ganze Login-Name darf
  höchstens 64 Zeichen lang sein (Grenze von Nextcloud).
- Nextcloud kann Login-Namen nicht ändern, das Kürzel einer Organisation ist ebenfalls fest. Wer
  einen anderen Namen will, legt ein neues Konto an und verschiebt die Dateien. Anzeigename und
  E-Mail lassen sich jederzeit ändern.
- **Gruppe:** Jedes Konto kommt in die Gruppe `<Präfix><Kürzel>`, z.B. `weblion-muster-ag`.
  Fehlt sie, legt die Console sie beim ersten Konto an. Über die Gruppe finden sich die Konten
  einer Organisation im Teilen-Dialog.
- **Sprache:** Ein neues Konto bekommt die Sprache der Person, die es in der Console anlegt
  (Deutsch oder Englisch). Ändern lässt sie sich in Nextcloud.
- **Anmelden** unter der Adresse der Instanz (Button "Nextcloud öffnen") oder in den Desktop- und
  Mobil-Apps von Nextcloud, jeweils mit Login-Name und Passwort.

### Konten anlegen

Cloud-Speicher > Konto erstellen: Benutzername (die Console zeigt den ganzen Login-Name dazu),
Anzeigename, E-Mail, Kontingent in GB und der Zugang:

- **Passwort jetzt erzeugen:** Die Console erzeugt ein Passwort und zeigt es einmal an, mit
  Login-Name und Adresse zum Weitergeben.
- **Einladung per E-Mail:** Braucht eine E-Mail-Adresse. Nextcloud sendet einen Link, mit dem die
  Person ihr Passwort selbst setzt. Die Console sieht kein Passwort.

Vorher prüft die Console: Es gibt ein Kontingent (sonst 409 `no_allowance`), das neue Konto passt
hinein (409 `allowance_exceeded`), die Höchstzahl an Konten ist nicht erreicht (409
`account_limit`), und der Name ist gültig und frei (409, auch wenn es den Benutzer in Nextcloud
schon gibt, ohne dass die Console ihn verwaltet). Das Anlegen läuft unter einer Sperre pro
Kunde, parallele Anfragen können das Kontingent also nicht überziehen.

In Nextcloud prüft die Console, dass es den Benutzer noch nicht gibt, legt bei Bedarf die Gruppe
an und erstellt den Benutzer mit Gruppe, Kontingent und Sprache. Nextcloud setzt Kontingent und
Sprache erst, nachdem der Benutzer angelegt ist. Schlägt einer dieser Schritte fehl, löscht die
Console den halb angelegten Benutzer wieder, damit ein zweiter Versuch klappt.

Hat das Konto eine E-Mail-Adresse, schickt Nextcloud auch beim erzeugten Passwort eine
Willkommensmail (ohne Passwort, mit Link zur Anmeldung).

Per API geht es nur mit Einladung, ein Token bekommt nie ein Passwort (sonst 400):

```bash
curl -X POST -H "Authorization: Bearer wlc_…" -H "Content-Type: application/json" \
  -d '{"name":"anna","displayName":"Anna Muster","email":"anna@muster.ch","quotaGb":50,"invite":true}' \
  https://cp.weblion.cloud/api/v1/orgs/<org-id>/cloud/accounts
```

Die Antwort ist `{ "account": { ... }, "password": null }`. Im Audit-Log steht
`cloud.account_create`.

### Ändern, deaktivieren, Einladung

- **Kontingent:** Grösser geht, solange es ins Kontingent des Kunden passt (sonst 409
  `allowance_exceeded`). Kleiner geht immer, auch unter den belegten Speicher: Nextcloud behält
  alle Dateien, nimmt aber keine neuen an, bis wieder Platz frei ist. Die Console warnt vorher und
  zeigt die Belegung rot.
- **Deaktivieren:** Die Person kann sich nicht mehr anmelden, ihre Geräte synchronisieren nicht
  mehr. Dateien und Kontingent bleiben und zählen weiter zum Kontingent.
- **E-Mail:** Benachrichtigungen und Einladungen gehen danach an die neue Adresse. Ein leeres
  Feld entfernt sie.
- **Einladung erneut senden:** Sendet die Willkommensmail von Nextcloud noch einmal, bei einer
  offenen Einladung mit neuem Link. Geht nur mit E-Mail-Adresse (sonst 400).

Nextcloud ändert pro Anfrage ein Feld, die Console schickt die Felder nacheinander. Im Audit-Log
stehen `cloud.account_update` mit altem und neuem Wert sowie `cloud.invite`. Per API:
`PATCH /api/v1/cloud/accounts/<id>` mit z.B. `{"quotaGb": 100}` oder `{"enabled": false}`,
`POST /api/v1/cloud/accounts/<id>/invite`.

### Passwörter

- **Erzeugte Passwörter** haben 20 Zeichen ohne verwechselbare Zeichen (I, l, O, 0, 1), mit
  Gross- und Kleinbuchstaben, Ziffern und Sonderzeichen, damit jede Passwort-Richtlinie von
  Nextcloud passt. Die Console zeigt sie einmal an und speichert sie nirgends, weder in der
  Datenbank noch im Audit-Log. Antworten mit Passwort tragen `Cache-Control: no-store`.
- **Passwort neu setzen** (`cloud:password`, Owner und Admin) geht nur mit Login, nie per
  API-Token, auch nicht mit "Lesen & Schreiben". Das bisherige Passwort gilt danach nicht mehr. Im
  Audit-Log steht `cloud.password_reset` (wer und wann), das Passwort nicht. Per API nur mit
  Session: `POST /api/v1/cloud/accounts/<id>/password`.
- **Einladung:** Die Console sieht kein Passwort. Für API-Tokens ist das der einzige Weg.
- Eigene Passwörter und Zwei-Faktor-Anmeldung richten die Nutzer in Nextcloud ein. Die Console
  erfährt davon nichts.
- **App-Passwort der Console:** verschlüsselt gespeichert (AES-256-GCM). Es ist ein volles
  Passwort des Admin-Kontos, deshalb zeigt die Console davon auch im Admin-Bereich kein Zeichen,
  und in Fehlermeldungen steht es nie.

### Löschen

- Löschen verlangt den Login-Namen als Bestätigung. Nextcloud löscht das Konto **sofort mit allen
  Dateien**, Kalendern, Kontakten und Freigaben. Einen Papierkorb dafür gibt es nicht, nur ein
  Backup der Instanz hilft.
- Fehlt das Konto in Nextcloud schon (Status "In Nextcloud nicht gefunden"), entfernt Löschen nur
  noch den Eintrag in der Console.
- Ein Kunde mit Cloud-Konten oder Kontingent lässt sich nicht löschen. Ein Provider lässt sich
  nicht löschen, solange darauf Kontingente oder zugewiesene Konten bestehen.
- Im Audit-Log steht `cloud.account_delete` mit Kontingent und belegtem Speicher. Per API:
  `DELETE /api/v1/cloud/accounts/<id>` mit `{"confirm": "<Login-Name>"}`.

### Sync

- Pro Sync-Lauf (alle `SYNC_INTERVAL_SECONDS`) liest die Console alle Benutzer der Instanz mit
  `GET /cloud/users/details`, 100 pro Anfrage. Für die Konten, die sie verwaltet, übernimmt sie
  Anzeigename, E-Mail, Kontingent, belegten Speicher, aktiv oder deaktiviert und die letzte
  Anmeldung.
- Fehlt ein Konto in Nextcloud, zeigt die Console "In Nextcloud nicht gefunden". Taucht es wieder
  auf, verschwindet der Hinweis. Konten, die während des Laufs angelegt wurden, gelten nicht als
  fehlend.
- Kann Nextcloud den Speicher eines Benutzers nicht lesen, fehlen Kontingent und Belegung in der
  Antwort. Die Console behält dann die gespeicherten Werte, statt das Konto als unbegrenzt zu
  zählen. Ein Konto ohne Kontingent (unbegrenzt) mit gemeldeter Belegung übernimmt sie normal.
- Benutzer, die die Console nicht kennt, legt der Sync nicht an. Sie erscheinen im Admin-Bereich
  als nicht verwaltete Benutzer (siehe unten).
- Was jemand direkt in Nextcloud ändert (z.B. ein Kontingent in der Benutzerverwaltung),
  übernimmt der Sync, auch wenn es nicht mehr ins Kontingent des Kunden passt. Geprüft wird nur,
  was über die Console läuft. Die Karte des Kunden zeigt dann mehr zugeteilt als gebucht.
- Für jede Seite liest Nextcloud den Speicher jedes Benutzers. Bei vielen Benutzern dauert ein
  Lauf entsprechend. Höchstens vier Anfragen laufen gleichzeitig, jede mit 30 Sekunden Timeout.
- Von Hand: Admin > Provider > Nextcloud > "Jetzt synchronisieren", oder der Sync-Button im Tab
  "Cloud-Konten".

### Kontingente einrichten

Admin > Kunden > Kunde, Karte "Cloud-Speicher" > Einrichten (Berechtigung `platform:org:write`):

- **Instanz:** alle Nextcloud-Provider (und der Demo-Provider)
- **Speicher gesamt** in GB
- **Konten höchstens**, leer für unbegrenzt
- **Modul "Cloud-Speicher" aktivieren** (Standard an). Bei einem Kunden eines Resellers nur, wenn
  der Reseller das Modul selbst hat (sonst 409).

Die Instanz lässt sich nur wechseln, solange darauf keine Konten bestehen (und bei einem Reseller
keine Kontingente seiner Kunden). Senken geht nicht unter das, was schon vergeben ist (409
`allowance_exceeded` bzw. `account_limit`). Entfernen geht nur ohne Konten und schaltet das Modul
nicht ab. Im Audit-Log stehen `cloud.allowance_set` und `cloud.allowance_delete`.

Per API nur mit Login (Session-Cookie), denn API-Tokens tragen keine Plattform-Rechte:
`PUT /api/v1/admin/orgs/<org-id>/cloud-allowance` mit z.B.
`{"providerId": "<provider-id>", "quotaGb": 500, "maxAccounts": 10, "enableModule": true}`,
`DELETE` auf denselben Pfad entfernt das Kontingent.

### Reseller

- Ein Reseller bekommt von weblion.one ein Kontingent wie jeder Kunde, dazu das Modul
  "Cloud-Speicher". Daraus legt er eigene Konten an und teilt seinen Kunden einen Teil zu:
  Reseller > Meine Kunden > Kunde > Ressourcen, Karte "Cloud-Speicher". Die Instanz ist immer die
  des Resellers. Speichern aktiviert beim Kunden auch das Modul.
- Eigene Konten und alle Kundenkontingente zusammen müssen ins Kontingent des Resellers passen
  (sonst 409 `allowance_exceeded`). Hat das Kontingent des Resellers eine Höchstzahl an Konten,
  braucht auch jeder Kunde eine. Dann zählen die Höchstzahlen der Kunden gegen die des Resellers.
- Auf seiner eigenen Seite "Cloud-Speicher" sieht der Reseller unter "Zugeteilt" auch, was an
  Kunden ging.
- "Kontingent entfernen" auf derselben Karte gibt den Speicher an den Reseller zurück, z.B. bevor
  er den Kunden löscht. Das geht nur, solange der Kunde keine Konten hat. Per API:
  `PUT` und `DELETE /api/v1/reseller/customers/<id>/cloud-allowance`, PUT mit
  `{"quotaGb": 50, "maxAccounts": 5}`.
- weblion.one kann einem Kunden eines Resellers auch direkt ein Kontingent geben. Dabei prüft die
  Console das Kontingent des Resellers nicht.

### Konten im Admin-Bereich

Admin > Domains & Webspaces > Cloud-Konten:

- Alle Konten aller Instanzen, mit Suche und Filter nach Kunde und Instanz. Die Karte beim Kunden
  verlinkt direkt auf seine Konten.
- **Zuweisen und lösen:** Ein Konto einem Kunden zuweisen oder von ihm lösen. Der Kunde braucht
  ein Kontingent auf derselben Instanz. Summe und Höchstzahl prüft die Console dabei bewusst nicht,
  das Konto zählt danach auch dann beim Kunden, wenn es nicht mehr hineinpasst. Ein gelöstes Konto
  bleibt mit allen Dateien in Nextcloud.
- **Nicht verwaltete Benutzer:** "Benutzer abrufen" liest live alle Benutzer der Instanz, die die
  Console nicht verwaltet, z.B. aus der Zeit vor der Console. "Übernehmen" verwaltet sie danach,
  auf Wunsch gleich bei einem Kunden. Name, Kontingent und Dateien bleiben. Benutzer ohne
  Kontingent (unbegrenzt) zählen beim Kunden mit dem belegten Speicher, bis jemand ein Kontingent
  setzt.
- Mitglieder der Gruppe `admin` und das Konto der Console erscheinen nie und lassen sich nicht
  übernehmen: Wer ein Konto verwaltet, kann sein Passwort setzen.
- Übernehmen und Zuweisen ändern die Gruppen in Nextcloud nicht. Ein übernommenes Konto ist also
  nicht automatisch in `weblion-<Kürzel>`. Das bei Bedarf in Nextcloud von Hand nachziehen.
- Ändern, deaktivieren und löschen geht hier nicht, sondern im Panel des Kunden unter
  "Cloud-Speicher". Ein Konto ohne Kunde dafür zuerst zuweisen, oder es in Nextcloud bearbeiten.

Im Audit-Log stehen `cloud.account_import` und `cloud.account_assign`.

### Was die Console nutzt

Alle Pfade relativ zu `/ocs/v2.php`.

| Funktion in der Console                       | Endpunkt                                                                                            | Berechtigung                        |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Verbindungstest                               | `GET /cloud/capabilities`, `GET /cloud/user`, `GET /cloud/users`                                    | Admin-Bereich                       |
| Übersicht des Providers                       | `GET /cloud/capabilities`, `GET /cloud/users`, `GET /cloud/groups?search=<Präfix>`                  | Admin-Bereich                       |
| Sync, nicht verwaltete Benutzer               | `GET /cloud/users/details?limit=100&offset=…`                                                       | Sync-Job, `platform:provider:read`  |
| Benutzer lesen (nach dem Anlegen, Übernehmen) | `GET /cloud/users/{userid}`                                                                         | `cloud:write`, `platform:org:write` |
| Konto erstellen                               | `GET /cloud/users/{userid}`, `GET /cloud/groups?search=`, `POST /cloud/groups`, `POST /cloud/users` | `cloud:write`                       |
| Anzeigename, E-Mail, Kontingent ändern        | `PUT /cloud/users/{userid}` mit `key` und `value`                                                   | `cloud:write`                       |
| Aktivieren, deaktivieren                      | `PUT /cloud/users/{userid}/enable`, `/disable`                                                      | `cloud:write`                       |
| Passwort neu setzen                           | `PUT /cloud/users/{userid}` mit `key=password`                                                      | `cloud:password`, nur mit Login     |
| Einladung erneut senden                       | `POST /cloud/users/{userid}/welcome`                                                                | `cloud:write`                       |
| Löschen                                       | `DELETE /cloud/users/{userid}`                                                                      | `cloud:write`                       |
| API Explorer                                  | jeder OCS-Pfad ausser den App-Passwort-Endpunkten                                                   | `platform:explorer`, nur mit Login  |

Die User-ID (der Login-Name) steht kodiert im Pfad, `anna@muster-ag` als `anna%40muster-ag`. Die
Console prüft sie vorher auf die Zeichen, die Nextcloud erlaubt. Fehler zeigt sie mit dem Text
von Nextcloud, dem OCS-Statuscode und dem HTTP-Status. Bei 401 (App-Passwort falsch), 403 (Konto
kein Admin), 429 (gebremst), 503 (Wartungsmodus) und Weiterleitungen (Base URL prüfen) kommt ein
Hinweis dazu.

### Fehler der API

Fehler kommen wie überall in der API als `{ "error": { "code", "message", "details" } }`. Für
Cloud-Speicher:

| HTTP | `code`               | Wann                                                                                                                                                                                                                               |
| ---- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | `bad_request`        | Ungültige Eingabe (`details` nennt das Feld), Einladung ohne E-Mail, API-Token ohne `"invite": true`, "Einladung erneut senden" ohne E-Mail, falsche Bestätigung beim Löschen, Login-Name, den Nextcloud nicht annimmt             |
| 403  | `forbidden`          | Recht fehlt, Modul nicht aktiv, Kunde gesperrt (nur lesen), "Passwort neu setzen" mit API-Token                                                                                                                                    |
| 404  | `not_found`          | Konto, Kunde oder Kontingent gibt es nicht, oder der Aufrufer sieht sie nicht                                                                                                                                                      |
| 404  | `provider_error`     | Nextcloud kennt den Benutzer nicht (mehr)                                                                                                                                                                                          |
| 409  | `no_allowance`       | Der Kunde (oder beim Zuteilen der Reseller) hat kein Kontingent                                                                                                                                                                    |
| 409  | `allowance_exceeded` | Speicher reicht nicht, `details` mit `quotaBytes` und `allocatedBytes`                                                                                                                                                             |
| 409  | `account_limit`      | Höchstzahl an Konten erreicht oder zu tief, `details` mit `maxAccounts` und `accounts`                                                                                                                                             |
| 409  | `conflict`           | Login-Name vergeben (in der Console oder in Nextcloud), Konto schon verwaltet, Kontingent des Kunden auf einer anderen Instanz, Instanz wechseln oder Kontingent entfernen mit Konten, Reseller ohne Modul, Admin-Konto übernehmen |
| 422  | `unsupported`        | Der Provider kann keine Cloud-Konten (z.B. Hetzner als Instanz gewählt)                                                                                                                                                            |
| 502  | `provider_error`     | Nextcloud hat abgelehnt oder war nicht erreichbar. `message` mit dem Text von Nextcloud, OCS- und HTTP-Status, `details.statuscode` mit dem OCS-Status                                                                             |

Schlägt Anlegen, Ändern, Passwort, Einladung oder Löschen bei Nextcloud fehl, steht das mit
`status: failure` und der Fehlermeldung im Audit-Log.

### API Explorer

Für alles ohne eigenen Button: Admin > API Explorer, Provider Nextcloud wählen.

- Der **Pfad** beginnt mit `/ocs/v2.php/` oder `/ocs/v1.php/`, z.B.
  `/ocs/v2.php/cloud/users?search=anna`. Die Base URL davor ist erlaubt. Vorlagen: Benutzer mit
  Details, Benutzerliste, ein Benutzer, Gruppen, Mitglieder einer Gruppe, Capabilities.
- GET und DELETE senden die Parameter aus dem JSON-Feld als Query, POST und PUT als Formular, z.B.
  `{ "key": "quota", "value": "10 GB" }`.
- Gesperrt sind Pfade ausserhalb der OCS-API, `..` und kodierte Punkte oder Schrägstriche und die
  App-Passwort-Endpunkte (`core/apppassword`, `core/getapppassword`). Passwörter, Tokens und
  Secrets in Antworten sind ausgeblendet.
- Ändernde Requests (POST, PUT, DELETE) stehen mit Pfad und Body im Audit-Log
  (`provider.explorer`), lesende nicht. Werte von Feldern wie `password`, `token` oder `secret`
  sind dort ausgeblendet, ebenso `value`, wenn `key` ein solches Feld ist
  (`{"key": "password", "value": "..."}`), und gleichnamige Query-Parameter im Pfad.
- Passwörter trotzdem mit "Passwort neu setzen" setzen: Das erzeugt ein starkes Passwort und
  steht beim Konto im Audit-Log (`cloud.password_reset`).
- Was über den Explorer geändert wird, prüft die Console nicht gegen Kontingente.

### Grenzen

- **Sperren:** Ein gesperrter Kunde sieht seine Konten in der Console nur noch lesend. In Nextcloud
  bleiben sie aber aktiv: Die Leute melden sich weiter an und laden Dateien hoch. Wer den Zugang
  sperren will, deaktiviert die Konten von Hand. Mitarbeitende von weblion.one (Superadmin) können
  das auch beim gesperrten Kunden auf dessen Seite "Cloud-Speicher". Ebenso lassen ein
  abgeschaltetes Modul und ein gekündigter Dienst die Konten in Nextcloud unberührt, der Kunde
  sieht sie dann nur nicht mehr in der Console.
- **Abrechnung:** Kontingent und Dienst sind getrennt, eine Abrechnung pro Konto oder pro
  belegtem GB gibt es nicht. Siehe [billing.md](billing.md#cloud-speicher-nextcloud-verkaufen).
- **Eine Instanz pro Kunde:** Alle Konten einer Organisation liegen auf der Instanz ihres
  Kontingents.
- **Gruppen:** Übernehmen und Zuweisen ändern Gruppen in Nextcloud nicht (siehe oben).
- **Gruppen-Präfix** gibt es nicht als Variable in der `.env`.
- **Reseller-Wechsel:** Wechselt ein Kunde den Reseller (Admin > Kunden), prüft die Console sein
  Cloud-Kontingent nicht gegen das Kontingent des neuen Resellers.
- Team-Ordner, Freigaben, Office im Browser und die Einstellungen der Instanz verwaltet die
  Console nicht, das geht in Nextcloud.

Ideen dazu in der [Roadmap](roadmap.md).

### Offene Punkte

Gegen eine echte Nextcloud ist die Anbindung noch nicht getestet, nur gegen einen Mock-Server nach
der Provisioning-API-Doku und dem Quellcode von Nextcloud. Vor dem ersten echten Einsatz mit einer
Test-Instanz prüfen:

- Anlegen mit Passwort und mit Einladung: Kommt die Einladung an, funktioniert der Link?
- "Einladung erneut senden" bei einer offenen Einladung: Enthält die Mail wieder einen Link zum
  Passwort setzen, oder nur den Link zur Anmeldung?
- Kontingent, Sprache und Gruppe nach dem Anlegen
- Kontingent und Belegung aus `/cloud/users/details`, auch für Benutzer, die sich noch nie
  angemeldet haben. Wann liefert Nextcloud dort ein leeres Kontingent (siehe Sync)?
- Dauer eines Sync-Laufs bei vielen Benutzern

### Demo

Der Demo-Provider (`ENABLE_DEMO_PROVIDER=true`) simuliert eine Nextcloud im Speicher, mit
denselben Prüfungen wie die echte Anbindung. Die Adresse `https://cloud.demo.weblion.one` gibt es
nicht, "Nextcloud öffnen" führt ins Leere. Mit `pnpm db:seed` hat Muster AG 500 GB für höchstens
10 Konten mit `anna@muster-ag` und `buchhaltung@muster-ag` (deaktiviert). `ben@muster-ag` und
`dev@beispiel-gmbh` sind nicht verwaltet und lassen sich im Admin-Bereich übernehmen. Alpen
Hosting (1000 GB) und Bäckerei Huber (100 GB mit `hanna@baeckerei-huber`) haben ein Kontingent,
aber noch nicht das Modul. Zum Ausprobieren das Modul zuerst bei Alpen Hosting, dann bei Bäckerei
Huber aktivieren.

## Mailcow (E-Mail)

- API: die JSON-API von mailcow-dockerized (`json_api.php`), Doku unter <https://docs.mailcow.email>
  und in der Swagger-Ansicht der Instanz unter `/api`. Die Console folgt dem Quellcode von Mailcow,
  weil die OpenAPI-Beschreibung bei mehreren Endpunkten unvollständig ist.
- Base URL: die Adresse der Instanz, z.B. `https://mail.weblion.one`. Lesen mit
  `GET /api/v1/get/...`, Ändern mit `POST /api/v1/add|edit|delete/...` und einem JSON-Body, immer
  mit dem Header `X-API-Key: <Key>`.
- Konfiguration: `MAILCOW_URL` und `MAILCOW_API_KEY` (optional `MAILCOW_MAIL_HOST`) in der `.env`
  oder im Admin-Bereich unter Provider > Provider hinzufügen > Mailcow
- Mailcow liefert keine Server. Im Server-Inventar und in den Server-Filtern taucht der Provider
  deshalb nicht auf.

### Was das Modul macht

weblion.one betreibt eigene Mailcow-Server und verkauft darauf E-Mail-Domains. Das Modul
**E-Mail** (`mail`) bringt das in die Console:

- **Mail-Domains mit Limits:** weblion.one legt eine Mail-Domain bei einer Mailcow-Instanz an und
  weist sie einem Kunden zu. Die Limits (Postfächer, Weiterleitungen, Speicher gesamt,
  Standard- und Höchstgrösse pro Postfach, Versandlimit) setzt nur weblion.one, Mailcow setzt sie
  durch. Bestehende Domains einer Instanz kommen mit dem Sync dazu.
- **Selbstverwaltung:** Der Kunde legt im gebuchten Rahmen Postfächer (mit erzeugtem oder eigenem
  Passwort) und Weiterleitungen an, auch eine Catch-all-Adresse, ändert Grösse, Name und Status,
  setzt Passwörter neu und löscht. In der Console unter dem Menüpunkt "E-Mail", sobald das Modul
  aktiv ist.
- **DNS-Einträge:** Die Console zeigt, welche Einträge die Domain braucht (MX, SPF, DKIM, DMARC,
  Autodiscover), vergleicht sie mit der Zone, erzeugt den DKIM-Schlüssel und trägt fehlende
  Einträge auf Wunsch selbst ein, wenn die DNS-Zone der Domain in der Console liegt (Joker.com,
  Cloudflare, 24fire).
- **Einstellungen für Mailprogramme:** Server, Ports und Verschlüsselung für IMAP, SMTP und POP3 und
  ein Link zu Webmail (SOGo).

Gespeichert werden nur die Mail-Domains mit Limits und Verbrauch (Tabelle `mail_domains`).
Postfächer, Weiterleitungen, DKIM-Schlüssel und Passwörter speichert die Console nie, sie liest sie
live bei Mailcow.

Wer darf was:

| Wer                           | Darf                                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner, Admin                  | Postfächer und Weiterleitungen anlegen, ändern, löschen, DKIM-Schlüssel erzeugen (`mail:write`), Passwörter neu setzen (`mail:password`)       |
| Member, Nur lesen             | Domains, Postfächer, Weiterleitungen, Verbrauch, DNS-Einträge und Einstellungen für Mailprogramme ansehen (`mail:read`)                        |
| Eingeschränkt, Buchhaltung    | nichts, per Policy erweiterbar (Ressource `maildomain/<id>`, `org` oder `*`)                                                                   |
| API-Token "Lesen & Schreiben" | was die Person darf, der das Token gehört, aber ohne Passwörter: Postfächer nur mit mitgeschicktem Passwort, kein "Neues Passwort"             |
| Mitarbeitende eines Resellers | im Panel seiner Kunden, was ihre Reseller-Rolle erlaubt, dazu Mail-Domains aus dem eigenen Bestand an Kunden geben (`reseller:customer:write`) |
| weblion.one Superadmin        | alles, dazu Mail-Domains anlegen, Limits ändern, löschen (`platform:mail:write`) und zuweisen (`platform:server:assign`)                       |
| weblion.one Support           | alles ansehen, nichts ändern                                                                                                                   |

"Fehlende Einträge hinzufügen" braucht zusätzlich `domain:dns:write` auf der Domain desselben
Namens im Modul "Domains & DNS". Postfächer und Weiterleitungen haben keinen eigenen
Ressourcenpfad, eine Policy gilt für die ganze Mail-Domain.

### Voraussetzungen

1. **Eigener Mailserver.** Die Console legt keinen Mailserver an, sie verwaltet die Domains einer
   bestehenden Instanz von mailcow-dockerized, am besten auf einer eigenen VM (Hetzner Cloud oder
   der eigene Proxmox), nicht auf dem Server der Console:
   - `MAILCOW_HOSTNAME` ist der öffentliche Name des Mailservers, z.B. `mail.weblion.one`, mit A-
     und AAAA-Eintrag
   - ein PTR-Eintrag (Reverse DNS) für IPv4 und IPv6, beim Hoster der VM gesetzt
   - offene Ports 25, 465, 587, 143, 993, 110, 995, 4190, 80 und 443. In der Hetzner Cloud ist
     ausgehender Verkehr auf Port 25 und 465 für neue Konten gesperrt, die Freigabe beantragt man
     bei Hetzner.
   - ein gültiges Zertifikat (Let's Encrypt von Mailcow) auch für die Adresse, unter der die
     Console die API erreicht. Einen Schalter "TLS nicht prüfen" gibt es für Mailcow nicht.
   - Backups mit dem Backup-Skript von Mailcow (`helper-scripts/backup_and_restore.sh`). Die
     Console kann kein Postfach wiederherstellen.

   Eine Instanz trägt viele Kunden. Mehrere Instanzen (z.B. eine pro Land oder eine für einen
   grossen Kunden) sind mehrere Provider, siehe unten.

2. **API-Key mit Lese- und Schreibzugriff.** In Mailcow als Admin unter System > Konfiguration >
   Zugang > API (der Menüpfad kann je nach Version abweichen): beim Zugriff "Lesen & Schreiben" die
   ausgehenden IPv4- und IPv6-Adressen der Console eintragen (einzelne Adressen oder CIDR, getrennt
   durch Komma, Leerzeichen, Semikolon oder Zeilenumbruch), aktivieren, speichern und den Key
   kopieren. "IP-Prüfung für API überspringen" bleibt aus. Alternativ in `mailcow.conf`
   `API_KEY=<Key>` und `API_ALLOW_FROM=<IPs>` setzen und `docker compose up -d` ausführen. Mailcow
   nimmt nur Keys aus a-z, A-Z, 0-9 und `-`, die Console verlangt mindestens 16 Zeichen. Der Key
   nur zum Lesen reicht nicht, "Verbindung testen" sagt das.
3. **Nicht sperren lassen.** Mailcow zählt fehlgeschlagene API-Anmeldungen (unbekannter Key, IP
   nicht in der Allow-List) wie fehlgeschlagene Logins, und sein Netfilter sperrt die IP der
   Console nach einigen Versuchen. Deshalb die IPs der Console vor dem ersten Test auf die
   Whitelist in den Netfilter-Einstellungen von Mailcow setzen. Die Console wiederholt eine
   abgelehnte Anmeldung nie. Welche IP bei Mailcow ankommt, steht in der Fehlermeldung des
   Verbindungstests ("api access denied for ip ..."). Läuft die Console in Docker ohne eigene
   IPv6-Konfiguration, kommt sie über IPv4.
4. **Zeitlimit im Reverse Proxy.** Eine Mail-Domain anlegen startet standardmässig Webmail (SOGo)
   neu und kann bis zu zwei Minuten dauern. Der Reverse Proxy vor der Console muss für
   `/api/v1/admin/mail/` mindestens 150 Sekunden auf die Antwort warten, siehe
   [deployment.md](deployment.md#mailcow-für-e-mail).
5. **Sinnvolle Einstellungen in Mailcow:**
   - `MAILDIR_GC_TIME`: wie lange gelöschte Postfächer und Domains im Papierkorb von Mailcow bleiben,
     in Minuten, Standard 7200 (5 Tage). Die Löschdialoge der Console weisen darauf hin.
   - `AUTODISCOVER_SAN=y` (Standard): Mailcow holt Zertifikate für `autodiscover.` und
     `autoconfig.` jeder Domain, passend zu den DNS-Einträgen, die die Console vorschlägt.
   - `SHOW_DKIM_PRIV_KEYS` bleibt aus.
   - Soll niemand an Adressen ausserhalb der Instanz weiterleiten können:
     `ALIAS_DISABLE_EXTERNAL_DOMAINS` in `data/web/inc/vars.local.inc.php`. Die Console erlaubt
     externe Ziele sonst.

### Konfiguration

Über die `.env` (Werte mit Sonderzeichen in einfache Anführungszeichen setzen):

```env
MAILCOW_URL=https://mail.weblion.one
MAILCOW_API_KEY='...'
# Optional: öffentlicher Name für MX, IMAP, SMTP und Webmail, wenn die Console Mailcow unter
# einer anderen Adresse erreicht (z.B. intern). Standard: der Host aus MAILCOW_URL.
MAILCOW_MAIL_HOST=
MAILCOW_NAME=Mailcow
MAILCOW_COUNTRY=CH
MAILCOW_CITY=Zürich
```

Sind URL und Key gesetzt, legt die Console den Provider beim Start an, speichert die Zugangsdaten
verschlüsselt und übernimmt Änderungen beim nächsten Neustart. URL, Key und Mail-Host eines solchen
Providers ändern sich nur über die `.env`. Name, Land und Stadt gelten beim ersten Start, danach
werden sie im Admin-Bereich geändert. Die URL ist die Adresse, unter der die Console die API
erreicht: `https://` mit gültigem Zertifikat, ohne Pfad. Weiterleitungen folgt die Console nicht,
damit der Key nie an einen anderen Host geht.

Oder im Admin-Bereich unter Provider > Provider hinzufügen, Typ Mailcow: URL der Instanz, API-Key
und optional der Mailserver-Hostname. Beim Bearbeiten behält ein leeres Key-Feld den gespeicherten
Key, ein leerer Hostname fällt auf den Host der URL zurück. Vom Key zeigt die Console kein Zeichen,
er ist Admin-Zugriff auf den ganzen Mailserver.

"Verbindung testen" liest Version und Domains und prüft mit einer Änderung ohne Wirkung (eine
Ratenlimit-Änderung für keine Domain), ob der Key schreiben darf. Es meldet Version, Zahl der
Domains und den Mailserver. Die Seite des Providers zeigt Version, Zahl der Mail-Domains und
Postfächer, den belegten Platz des Mail-Speichers, Mailserver und Webmail-Adresse.

**Mailserver-Hostname:** Aus ihm entstehen der MX-Eintrag, die Autodiscover-Einträge, die
Einstellungen für Mailprogramme und die Webmail-Adresse (`https://<Host>/SOGo/`). Er muss also der
öffentliche Name sein, auf den die Zertifikate von Mailcow lauten.

### Mehrere Instanzen

Jede Mailcow-Instanz ist ein eigener Provider: die aus der `.env` und beliebig viele aus dem
Admin-Bereich, jede mit eigener URL, eigenem Key, eigenem Mailserver-Hostnamen und Standort. Jede
Mail-Domain gehört zu genau einer Instanz, Postfächer und Weiterleitungen erreicht die Console nur
über ihre Domain, also immer bei der richtigen Instanz. Die DNS-Einträge und Einstellungen für
Mailprogramme zeigen auf die Instanz der Domain.

- Beim Anlegen einer Mail-Domain wählt man die Instanz (vorausgewählt, wenn es nur eine gibt). Die
  Liste im Admin-Bereich filtert nach Instanz.
- Dieselbe Domain auf zwei Instanzen lehnt die Console beim Anlegen ab (409): MX-Einträge können nur
  auf einen Server zeigen. Wer eine Domain umziehen will, legt sie auf der neuen Instanz an, wenn sie
  auf der alten weg ist (als fehlend markiert).
- Eine Instanz nur für einen Kunden ist eine Instanz, deren Domains alle diesem Kunden gehören.
  Die Console behandelt sie nicht anders.
- Ein Provider lässt sich nicht löschen, solange eine seiner Mail-Domains einem Kunden zugewiesen
  ist. Nicht zugewiesene verschwinden mit ihm aus der Console (bei Mailcow bleiben sie).
- Reseller sehen nie Instanzen, nur Mail-Domains.

### Mail-Domains anlegen und ändern

Admin > Domains & Webspaces > E-Mail-Domains (Berechtigung `platform:mail:write`):

- **Instanz** und **Domain**, ohne www. Umlaut-Domains gehen, Mailcow speichert sie in der
  `xn--`-Form, die Console zeigt beide.
- **Beschreibung**, ohne Angabe der Domainname
- **Limits:** Postfächer höchstens (0 bis 100000), Weiterleitungen höchstens (1 bis 100000),
  Speicher gesamt, Standardgrösse neuer Postfächer und Höchstgrösse pro Postfach (je 1 MB bis
  10000000 MB, Standardgrösse höchstens Höchstgrösse, Höchstgrösse höchstens Speicher gesamt),
  optional ein Versandlimit (Nachrichten pro Sekunde, Minute, Stunde oder Tag für die ganze
  Domain). Der Dialog schlägt die Werte der Vorlage von Mailcow vor: 10 Postfächer, 400
  Weiterleitungen, 10 GB, 3 GB, 10 GB.
- **DKIM-Schlüssellänge:** 2048 (Standard), 3072 oder 4096 Bit, Selektor `dkim`. Mailcow erzeugt den
  Schlüssel gleich mit. Gibt es noch einen Schlüssel von einer früheren Domain desselben Namens,
  behält Mailcow diesen.
- **Webmail (SOGo) neu starten** (Standard an): damit Webmail die neue Domain kennt. Das unterbricht
  Webmail, Kalender, Kontakte und ActiveSync für alle Benutzer der Instanz kurz, und die Anfrage
  dauert bis zu zwei Minuten. Scheitert der Neustart, gibt es die Domain trotzdem, der Dialog zeigt
  den Hinweis von Mailcow.
- **Kunde** (optional) und ob das Modul "E-Mail" bei ihm freigeschaltet wird (Standard an). Bei
  einem Kunden eines Resellers nur, wenn der Reseller das Modul hat (sonst 409).

Die Console schickt jedes Limit, die Relay-Schalter (aus), das Versandlimit (`0` für keines) und die
DKIM-Felder immer mit. So entscheidet nie die "Default"-Vorlage von Mailcow, die man in Mailcow
ändern kann. Abgelehnt wird mit 409, wenn die Domain schon in der Console ist, auf einer anderen
Instanz liegt oder bei Mailcow schon existiert, mit 400 bei einem ungültigen Namen. Eine Domain, die
als fehlend markiert ist, legt die Console bei Mailcow neu an und nimmt den bisherigen Eintrag
wieder auf. Klappt das Speichern in der Console nach dem Anlegen bei Mailcow nicht, steht das im
Audit-Log (`createdAtMailcow: true`), und der nächste Sync zeigt die Domain als nicht zugewiesen.

Per API nur mit Login (Session-Cookie), denn API-Tokens tragen keine Plattform-Rechte:

```
POST /api/v1/admin/mail/domains
{"providerId":"<provider-id>","domain":"kunde.ch","orgId":"<org-id>",
 "limits":{"maxMailboxes":10,"maxAliases":400,"quotaMb":10240,"defaultMailboxQuotaMb":3072,
           "maxMailboxQuotaMb":10240,"rateLimit":{"value":500,"frame":"h"}},
 "dkimKeySize":2048,"restartSogo":true}
```

Die Antwort ist `{ "domain": { ... }, "warnings": [...] }`. Im Audit-Log steht `mail.domain_create`.

**Limits ändern** (Menü der Zeile): Die Console liest die aktuellen Werte live bei Mailcow, legt die
Änderung darüber und schickt nur, was sich ändert. Mailcow lehnt Werte unter dem Verbrauch ab (409
mit dem Text von Mailcow, z.B. "Max. mailboxes must be greater or equal to 3"). `rateLimit: null`
entfernt das Versandlimit. Der Schalter "Domain aktiv" stellt eine Domain ab: Sie nimmt dann keine
E-Mails mehr an. Im Audit-Log steht `mail.domain_update` mit altem und neuem Wert (Grössen in MiB).
Per API: `PATCH /api/v1/admin/mail/domains/<id>` mit z.B. `{"limits": {"maxMailboxes": 20}}` oder
`{"active": false}`.

**Löschen** verlangt den Domainnamen als Bestätigung. Mailcow löscht nur leere Domains: Hat sie noch
Postfächer, antwortet die Console mit 409 (`domain_not_empty`, `details.mailboxes`), ohne Mailcow
zu fragen. Die Postfächer löscht vorher der Kunde unter "E-Mail" oder weblion.one in seinem Panel.
Weiterleitungen löscht Mailcow mit der Domain, die E-Mails kommen in den Papierkorb von Mailcow
(`MAILDIR_GC_TIME`). Den DKIM-Schlüssel, den Mailcow sonst behält und bei einer neuen Domain
desselben Namens wieder nimmt, löscht die Console standardmässig mit (`deleteDkim`). Scheitert das,
gilt die Domain trotzdem als gelöscht, mit einem Hinweis. Fehlt die Domain bei Mailcow schon und ist
als fehlend markiert, entfernt Löschen nur den Eintrag in der Console. Auch eine zugewiesene Domain
lässt sich löschen, der Kunde verliert sie dann. Im Audit-Log steht `mail.domain_delete`. Per API:
`DELETE /api/v1/admin/mail/domains/<id>` mit `{"confirm": "kunde.ch", "deleteDkim": true}`.

**Zuweisen** ("Zuweisung ändern", Berechtigung `platform:server:assign`): wie bei Domains, mit
Modul "E-Mail" (abschaltbar). Lösen nimmt dem Kunden den Zugriff in der Console, bei Mailcow ändert
sich nichts, die E-Mails fliessen weiter. Im Audit-Log stehen `mail.domain_assign` und
`mail.domain_unassign`. Per API: `POST /api/v1/admin/mail/domains/<id>/assign` mit
`{"orgId": "<org-id>", "enableModule": true}` (`orgId: null` löst). Ein Kunde mit Mail-Domains
lässt sich nicht löschen.

### Postfächer

E-Mail > Domain > Postfächer. Das Postfach ist zugleich der Login, für IMAP, SMTP, POP3 und Webmail
immer mit der vollständigen Adresse.

- **Anlegen** (`mail:write`): Name vor dem `@` (a-z, 0-9, Punkt, Binde- und Unterstrich, am Anfang
  und Ende ein Buchstabe oder eine Ziffer, kein `..`, höchstens 64 Zeichen), Anzeigename
  (optional, höchstens 255 Zeichen ohne `<` und `>`), Grösse (ohne Angabe die Standardgrösse der
  Domain) und Passwort: erzeugt (einmal angezeigt) oder selbst gewählt. IMAP, POP3, SMTP, Sieve,
  ActiveSync und Webmail sind an, wie es Mailcow standardmässig vorsieht.
- Vorher prüft die Console gegen die aktuellen Werte von Mailcow: Die Domain hat
  noch ein Postfach frei (409 `mail_limit`, `limit: "mailboxes"`), das Postfach ist nicht grösser
  als die Höchstgrösse (`mailboxSize`), und der Speicher der Domain reicht (`storage`).
  `details` nennt Limit (`max`) und Verbrauch (`used`). Mailcow prüft dasselbe noch einmal.
- Postfächer einer Domain entstehen nacheinander (Advisory Lock pro Mail-Domain), weil Mailcow
  zwischen Zählen und Anlegen nicht sperrt und zwei parallele Anfragen das Limit sonst um eins
  überschreiten könnten.
- **Ändern:** Anzeigename (ersetzen, nicht entfernen: Mailcow behält einen alten Namen, wenn man ein
  leeres Feld schickt, die Console lehnt das deshalb ab), Grösse und Status. Eine grössere Grösse
  prüft die Console wie beim Anlegen. Kleiner geht immer, auch unter den belegten Speicher: Mailcow
  nimmt dann keine neuen E-Mails an, bis Platz frei ist. Die Console warnt vorher.
- **Status:** "Aktiv", "Anmeldung gesperrt" (empfängt weiter E-Mails, niemand kann sich anmelden)
  und "Inaktiv" (nimmt keine E-Mails an, keine Anmeldung).
- **Löschen** verlangt die Adresse als Bestätigung. Mailcow löscht das Postfach mit allen E-Mails
  (sie bleiben einige Tage im Papierkorb von Mailcow, die Console stellt sie nicht wieder her),
  löscht Weiterleitungen, deren einziges Ziel es war, und nimmt die Adresse aus anderen
  Weiterleitungen heraus.
- Postfächer, die jemand direkt in Mailcow angelegt hat, zeigt die Console genauso, auch mit einer
  Grösse "unbegrenzt" oder mit Zeichen im Namen, die die Console selbst nicht vergibt.
- Relay-Domains (Mailcow leitet E-Mails nur weiter) haben in der Console keine Postfächer und
  Weiterleitungen, Anlegen lehnt die API mit 409 ab.

Im Audit-Log stehen `mail.mailbox_create`, `mail.mailbox_update` (mit altem und neuem Wert) und
`mail.mailbox_delete`. Per API:

```bash
curl -X POST -H "Authorization: Bearer wlc_…" -H "Content-Type: application/json" \
  -d '{"localPart":"anna","name":"Anna Muster","quotaMb":2048,"password":"…"}' \
  https://cp.weblion.cloud/api/v1/mail/domains/<mail-domain-id>/mailboxes
curl -X PATCH -H "Authorization: Bearer wlc_…" -H "Content-Type: application/json" \
  -d '{"state":"login_disabled"}' \
  https://cp.weblion.cloud/api/v1/mail/domains/<mail-domain-id>/mailboxes/anna@kunde.ch
```

Ein API-Token muss beim Anlegen ein Passwort mitschicken (sonst 400), ein erzeugtes bekommt es nie.
Die Antwort ist `{ "mailbox": { ... }, "password": null }`. Grössen gehen als ganze MiB in die API
(`quotaMb`) und kommen als Bytes zurück. `state` ist `active`, `login_disabled` oder `inactive`.
Löschen: `DELETE .../mailboxes/<Adresse>` mit `{"confirm": "<Adresse>"}`.

### Passwörter

- **Erzeugte Passwörter** haben mindestens 20 Zeichen (mehr, wenn die Richtlinie von Mailcow das
  verlangt) ohne verwechselbare Zeichen, mit Gross- und Kleinbuchstaben, Ziffern und
  Sonderzeichen. Die Console zeigt sie einmal an und speichert sie nirgends, weder in der Datenbank
  noch im Audit-Log. Antworten mit Passwort tragen `Cache-Control: no-store`.
- **Selbst gewählte Passwörter:** mindestens 10 Zeichen (oder mehr, wenn Mailcow das verlangt),
  höchstens 128, nur druckbare ASCII-Zeichen ohne Leerzeichen, dazu die Passwortrichtlinie von
  Mailcow (Buchstaben, Gross- und Kleinschreibung, Ziffern, Sonderzeichen, je nach Einstellung). Kann
  die Console die Richtlinie nicht lesen, verlangt sie Buchstaben in Gross- und Kleinschreibung und
  eine Ziffer, Mailcow prüft beim Speichern zusätzlich. Fehlt etwas, antwortet die API mit 400 und
  listet die Punkte in `details[0].issues`.
- **Neues Passwort** (`mail:password`, Owner und Admin) geht nur mit Login, nie per API-Token. Die
  Console schickt das Passwort allein, ohne andere Änderungen: Lehnt Mailcow es ab, verwirft es
  sonst auch alles andere im selben Request. Im Audit-Log steht `mail.password_reset` mit
  `password: "generated"` oder `"chosen"`, das Passwort selbst nie. Per API nur mit Session:
  `POST /api/v1/mail/domains/<id>/mailboxes/<Adresse>/password`, ohne Body erzeugt, mit
  `{"password": "…"}` gewählt.
- **API-Key der Console:** verschlüsselt gespeichert (AES-256-GCM), in keiner Antwort und keiner
  Meldung, auch nicht teilweise.

### Weiterleitungen

E-Mail > Domain > Weiterleitungen (`mail:write` zum Ändern):

- **Adresse** unter der Domain (gleiche Regeln wie Postfächer) oder **Catch-all** für alle Adressen
  der Domain, für die es kein Postfach und keine Weiterleitung gibt. Catch-all zieht Spam an, der
  Dialog warnt davor.
- **Ziele:** 1 bis 50 Adressen, Postfächer der Domain oder externe Adressen. Eine Weiterleitung an
  sich selbst lehnt die Console ab (Mailcow würde sie stillschweigend nicht anlegen). Alle Ziele
  prüft die Console vorher, denn Mailcow würde ein ungültiges Ziel verwerfen und die Weiterleitung
  mit dem Rest speichern.
- **Aktiv** (Standard an): Inaktive Weiterleitungen nehmen keine E-Mails an, die Ziele bleiben
  gespeichert.
- Die Console setzt `sender_allowed` (nach dem Quellcode von Mailcow dürfen die Ziele dann unter
  der Adresse der Weiterleitung senden, siehe Offene Punkte) und `sogo_visible` (die Weiterleitung
  erscheint im Adressbuch von Webmail).
- Das Limit an Weiterleitungen prüft die Console wie bei Postfächern, unter derselben Sperre (409
  `mail_limit`, `limit: "aliases"`). Eine Adresse, die es schon als Postfach oder Weiterleitung
  gibt, lehnt Mailcow ab (409).
- Weiterleitungen, die Mailcow für Spezialziele nutzt (verwerfen, als Spam oder Ham lernen), zeigt
  die Console an. Ihre Ziele lassen sich nur in Mailcow ändern (409), ein- und ausschalten geht.
- Mailcow nummeriert Weiterleitungen pro Instanz. Eine ID, die zu einer anderen Domain gehört,
  behandelt die Console wie nicht vorhanden (404), auch wenn jemand sie errät.

Im Audit-Log stehen `mail.alias_create`, `mail.alias_update` und `mail.alias_delete`. Per API:
`POST /api/v1/mail/domains/<id>/aliases` mit `{"localPart": "info", "targets": ["anna@kunde.ch"]}`
(`"localPart": null` für Catch-all), `PATCH` und `DELETE .../aliases/<alias-id>`.

### DNS-Einträge

E-Mail > Domain > DNS-Einträge zeigt, was die Domain für Mailcow braucht. Namen relativ zur Domain,
die Spalte "Wert" im Format der Console:

| Eintrag          | Typ   | Name                 | Wert                                      |           |
| ---------------- | ----- | -------------------- | ----------------------------------------- | --------- |
| MX               | MX    | `@`                  | `10 <Mailserver>`                         | Pflicht   |
| SPF              | TXT   | `@`                  | `v=spf1 mx ~all`                          | Pflicht   |
| DKIM             | TXT   | `dkim._domainkey`    | `v=DKIM1;k=rsa;t=s;s=email;p=<Schlüssel>` | Pflicht   |
| DMARC            | TXT   | `_dmarc`             | `v=DMARC1; p=none`                        | empfohlen |
| Autodiscover     | CNAME | `autodiscover`       | `<Mailserver>`                            | empfohlen |
| Autoconfig       | CNAME | `autoconfig`         | `<Mailserver>`                            | empfohlen |
| Autodiscover-SRV | SRV   | `_autodiscover._tcp` | `0 1 443 <Mailserver>`                    | empfohlen |

SPF mit `~all` und DMARC mit `p=none` (ohne Berichtsadresse) sind bewusst vorsichtig: Sie lehnen
nichts ab, solange ein Kunde noch über andere Dienste sendet. Verschärfen geht in der DNS-Verwaltung
von Hand.

**Vergleich:** Liegt eine Domain desselben Namens (ASCII- oder Umlaut-Form) im Modul "Domains & DNS"
und darf die Person sie sehen, vergleicht die Console mit deren Zone. Gibt es mehrere, nimmt sie die,
deren Einträge sich lesen lassen, deren Nameserver die Domain bedienen und deren DNS sich ändern
lässt, also z.B. die aktive Cloudflare-Zone statt der Registrierung bei Joker. Jeder Eintrag hat
einen Status:

- **In Ordnung:** MX zeigt auf den Mailserver, genau ein SPF-Eintrag erlaubt den Mailserver (mit
  `a:` oder `include:` des Mailservers, oder `mx`, wenn MX stimmt), der DKIM-Eintrag hat den
  Schlüssel von Mailcow, genau ein DMARC-Eintrag (jede Richtlinie), CNAME und SRV zeigen auf den
  Mailserver.
- **Fehlt:** unter dem Namen gibt es nichts Passendes.
- **Weicht ab:** MX auf einen anderen Server, mehrere SPF-Einträge oder einer ohne den Mailserver,
  ein anderer DKIM-Schlüssel, mehrere DMARC-Einträge, CNAME oder SRV auf ein anderes Ziel, andere
  Einträge unter dem Namen.
- **Unbekannt:** keine Zone in der Console, oder die Einträge liessen sich nicht lesen. Dann zeigt
  die Seite die Einträge mit vollem Namen zum Eintragen beim DNS-Anbieter.

**DKIM-Schlüssel erzeugen** (`mail:write`): wenn die Domain noch keinen hat (2048, 3072 oder 4096
Bit, Selektor `dkim`, sonst 409). Ohne Schlüssel steht DKIM auf "Fehlt" mit dem Hinweis, zuerst den
Schlüssel zu erzeugen. Den TXT-Wert baut die Console aus dem öffentlichen Schlüssel selbst, denn
Mailcow liefert ihn je nach Einstellung schon in Teile zerlegt. Ein Schlüssel mit 2048 Bit ergibt
rund 420 Zeichen, mehr als ein DNS-String fasst (255 Bytes). Joker.com und Cloudflare bekommen den
Wert deshalb in mehreren Teilen, DNS fügt sie wieder zusammen. Im Audit-Log steht `mail.dkim_create`.

**Fehlende Einträge hinzufügen:** braucht `domain:dns:write` auf der Domain der Zone, einen Provider,
dessen DNS sich gerade ändern lässt (bei 24fire nur mit 24fire+), und lesbare Einträge (sonst fügt
die Console nichts hinzu, 502). Die Console fügt nur Einträge mit Status "Fehlt" hinzu, einen nach
dem anderen (Joker schreibt bei jeder Änderung die ganze Zone), mit TTL 3600 Sekunden, wo der
Provider eine TTL nimmt, bei Cloudflare nie über den Proxy. Einträge, die abweichen, ändert oder
löscht sie nie. DKIM ohne Schlüssel und Typen, die der Provider nicht nimmt, überspringt sie. Jeder
hinzugefügte Eintrag steht wie ein von Hand angelegter als `domain.dns_add` im Audit-Log (mit
`source: "mail"`), dazu `mail.dns_apply` mit hinzugefügten, übersprungenen und fehlgeschlagenen
Einträgen. Liegt die Domain nicht in der Console, antwortet die API mit 409. Per API:
`GET /api/v1/mail/domains/<id>/dns`, `POST /api/v1/mail/domains/<id>/dkim` mit `{"keySize": 2048}`,
`POST /api/v1/mail/domains/<id>/dns/apply` (optional `{"keys": ["spf", "dkim"]}`).

### Einstellungen für Mailprogramme

Die Übersicht einer Mail-Domain zeigt sie, abgeleitet aus dem Mailserver-Hostnamen der Instanz:

| Dienst  | Server                       | Port und Verschlüsselung              |
| ------- | ---------------------------- | ------------------------------------- |
| IMAP    | Mailserver                   | 993 SSL/TLS (empfohlen), 143 STARTTLS |
| SMTP    | Mailserver                   | 465 SSL/TLS (empfohlen), 587 STARTTLS |
| POP3    | Mailserver                   | 995 SSL/TLS (empfohlen), 110 STARTTLS |
| Webmail | `https://<Mailserver>/SOGo/` |                                       |

Benutzername ist immer die vollständige Adresse, SMTP verlangt eine Anmeldung.

### Sync

- Pro Sync-Lauf (alle `SYNC_INTERVAL_SECONDS`) genau eine Anfrage pro Instanz:
  `GET /api/v1/get/domain/all`. Daraus kommen Name, Status, Limits und Verbrauch (Postfächer,
  Weiterleitungen, vergebener und belegter Speicher, Zahl der Nachrichten).
- Neue Domains sind nicht zugewiesen. Domains, die bei Mailcow verschwinden, werden als fehlend
  markiert und behalten ihren Kunden. Tauchen sie wieder auf, verschwindet der Hinweis.
- Hat die Console eine Domain geändert, während der Sync die Liste las (Limits, Anlegen), behält sie
  ihre neueren Werte bis zum nächsten Lauf.
- Postfächer, Weiterleitungen und DKIM-Schlüssel liest die Console nur, wenn jemand sie ansieht.
  Die Detailansicht einer Domain liest Limits und Verbrauch live nach, ebenso jede Änderung, die den
  Verbrauch ändert (Postfach anlegen, vergrössern, löschen, Weiterleitung anlegen, löschen).
- Von Hand: Admin > Provider > Mailcow > "Jetzt synchronisieren", oder der Sync-Button im Tab
  "E-Mail-Domains".

### Reseller

- Ein Reseller bekommt von weblion.one Mail-Domains wie jeder Kunde, dazu das Modul "E-Mail". Er gibt
  sie unter Reseller > Meine Kunden > Kunde > Ressourcen ("E-Mail-Domain zuweisen") an seine Kunden
  weiter und nimmt sie zurück. Der Kunde bekommt dabei das Modul.
- Die Limits ändert nur weblion.one, Mailcow kennt keine verschachtelten Kontingente. Ein Reseller
  gibt eine Domain so weiter, wie sie ist.
- Mitarbeitende des Resellers verwalten Postfächer und Weiterleitungen im Panel des Kunden mit ihrer
  Reseller-Rolle.
- Dienste lassen sich noch nicht mit Mail-Domains verknüpfen, das Weitergeben blockiert also nie ein
  Dienst. Per API: `POST /api/v1/orgs/<reseller-id>/customers/<customer-id>/resources` mit
  `{"type": "maildomain", "id": "<mail-domain-id>"}`, zurück mit `.../resources/release`.

### Was die Console nutzt

| Funktion in der Console                | Endpunkt                                                                                                  | Berechtigung                       |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Verbindungstest                        | `GET /api/v1/get/status/version`, `GET /api/v1/get/domain/all`, `POST /api/v1/edit/rl-domain` ohne Domain | Admin-Bereich                      |
| Übersicht des Providers                | dazu `GET /api/v1/get/status/vmail`                                                                       | Admin-Bereich                      |
| Mail-Domains finden (Sync)             | `GET /api/v1/get/domain/all`                                                                              | Sync-Job                           |
| Mail-Domain ansehen                    | `GET /api/v1/get/domain/<Domain>`                                                                         | `mail:read`                        |
| Mail-Domain anlegen                    | `GET /api/v1/get/domain/<Domain>`, `POST /api/v1/add/domain`                                              | `platform:mail:write`              |
| Limits ändern, Domain abstellen        | `POST /api/v1/edit/domain`, Versandlimit `POST /api/v1/edit/rl-domain`                                    | `platform:mail:write`              |
| Mail-Domain löschen                    | `POST /api/v1/delete/domain`, `POST /api/v1/delete/dkim`                                                  | `platform:mail:write`              |
| Postfächer ansehen                     | `GET /api/v1/get/mailbox/all/<Domain>`, `GET /api/v1/get/mailbox/<Adresse>`                               | `mail:read`                        |
| Postfach anlegen                       | `POST /api/v1/add/mailbox`                                                                                | `mail:write`                       |
| Name, Grösse, Status ändern            | `POST /api/v1/edit/mailbox`                                                                               | `mail:write`                       |
| Neues Passwort                         | `POST /api/v1/edit/mailbox` nur mit `password` und `password2`                                            | `mail:password`, nur mit Login     |
| Postfach löschen                       | `POST /api/v1/delete/mailbox`                                                                             | `mail:write`                       |
| Weiterleitungen ansehen                | `GET /api/v1/get/alias/all/<Domain>`, `GET /api/v1/get/alias/<ID>`                                        | `mail:read`                        |
| Weiterleitung anlegen, ändern, löschen | `POST /api/v1/add/alias`, `/edit/alias`, `/delete/alias`                                                  | `mail:write`                       |
| DKIM-Schlüssel ansehen, erzeugen       | `GET /api/v1/get/dkim/<Domain>`, `POST /api/v1/add/dkim`                                                  | `mail:read`, `mail:write`          |
| Passwortrichtlinie                     | `GET /api/v1/get/passwordpolicy`                                                                          | `mail:read`                        |
| API Explorer                           | jeder Pfad unter `/api/v1/get`, `/add`, `/edit`, `/delete`                                                | `platform:explorer`, nur mit Login |

`add` bekommt die Attribute als Body, `edit` `{"items": [...], "attr": {...}}`, `delete` die Liste
der Objekte selbst (`["anna@kunde.ch"]`, anders als die OpenAPI-Beschreibung sagt). Domains stehen
in der `xn--`-Form im Pfad. Zeichen, die im Pfad nicht gehen (`/`, `?`, `#`, `&`, `%`, `+`), vergibt
die Console nie. Postfächer mit solchen Zeichen, die in Mailcow angelegt wurden, sucht sie in der
Liste der Domain.

### Verhalten im Detail

Mailcow hat einige Eigenheiten, die die Console abfängt:

- **Fehler mit HTTP 200:** Mailcow meldet fachliche Fehler als Liste von Einträgen
  (`{"type": "danger", "msg": [...]}`) mit Status 200. Die Console wertet jeden `danger`- oder
  `error`-Eintrag als Fehler und zeigt den englischen Text von Mailcow. Je nach Schlüssel antwortet
  sie mit 409 (existiert schon, Limit erreicht, Verbrauch zu hoch), 400 (ungültiger Wert,
  Passwortrichtlinie), 404 (Domain nicht gefunden) oder 502. Warnungen (z.B. SOGo-Neustart
  gescheitert) sind keine Fehler.
- **Nicht gefunden ist `{}`:** Lesen antwortet mit `{}` statt 404, eine leere Liste ist ebenfalls
  `{}`, und Ändern oder Löschen eines fehlenden Postfachs meldet "access denied". Die Console liest
  deshalb vor jeder Änderung und antwortet selbst mit 404.
- **MiB und Bytes:** Mailcow nimmt Grössen in ganzen MiB und antwortet in Bytes. Die Console rechnet
  ohne Runden: In den Formularen gelten MB und GB binär (1 GB = 1024 MB), ein Wert, der kein
  ganzes MB ergibt, wird abgelehnt.
- **Zahlen und Schalter** kommen je nach Version und Feld als Zahl oder Text (`"1"`, `"0"`), die
  Console liest beides.
- **Keine Wiederholung bei 401:** Mailcow zählt jede abgelehnte Anmeldung für seinen Netfilter. Die
  Meldung nennt die IP, die in die Allow-List gehört, oder sagt, dass Mailcow den Key nicht kennt.
  Ein Key nur zum Lesen ergibt 403 mit dem Hinweis auf den Key mit Schreibzugriff.
- **Teure Änderungen:** Jede Änderung an Domains, Postfächern und Weiterleitungen baut die
  Adressbuch-Ansicht von SOGo neu. Die Console schickt deshalb nur, was sich ändert, und prüft den
  Schreibzugriff mit dem Versandlimit statt mit einer Domain-Änderung.
- **Keine Seiten:** Listen kommen ganz und werden pro Domain berechnet, grosse Domains antworten
  langsam. Die Console fragt immer pro Domain und hält Antworten kurz im Speicher: Domain 15
  Sekunden, Postfach- und Weiterleitungslisten 10 Sekunden, DKIM 5 Minuten, Version und
  Passwortrichtlinie 10 Minuten. Jede Änderung über die Console leert das für ihre Domain.
- Höchstens vier Anfragen pro Instanz laufen gleichzeitig, jede mit 30 Sekunden Timeout, eine
  Domain anlegen mit SOGo-Neustart 120 Sekunden.
- Der API-Key und mitgeschickte Passwörter stehen in keiner Meldung. Mailcow gibt in seinen
  Antworten die Anfrage zurück (`log`): In Meldungen zeigt die Console das nie, im API Explorer
  sind Passwörter darin ausgeblendet.

### Fehler der API

Fehler kommen wie überall in der API als `{ "error": { "code", "message", "details" } }`. Für
E-Mail:

| HTTP | `code`             | Wann                                                                                                                                                                                                                                                                                                   |
| ---- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 400  | `bad_request`      | Ungültige Eingabe (`details` nennt das Feld), Passwort erfüllt die Regeln nicht (`details[0].issues`), API-Token ohne Passwort, falsche Bestätigung beim Löschen, Weiterleitung an sich selbst, Werte, die Mailcow ablehnt                                                                             |
| 403  | `forbidden`        | Recht fehlt, Kunde gesperrt (nur lesen), "Neues Passwort" mit API-Token, Plattform-Routen ohne Plattform-Rolle                                                                                                                                                                                         |
| 404  | `not_found`        | Mail-Domain gibt es nicht oder die Person sieht sie nicht (auch bei abgeschaltetem Modul), Adresse oder Weiterleitung einer anderen Domain                                                                                                                                                             |
| 404  | `provider_error`   | Mailcow kennt das Postfach, die Weiterleitung oder die Domain nicht (mehr)                                                                                                                                                                                                                             |
| 409  | `mail_limit`       | Limit der Domain erreicht, `details` mit `limit` (`mailboxes`, `aliases`, `storage`, `mailboxSize`), `max` und `used`                                                                                                                                                                                  |
| 409  | `domain_not_empty` | Löschen einer Domain mit Postfächern, `details.mailboxes`                                                                                                                                                                                                                                              |
| 409  | `conflict`         | Adresse oder Domain existiert schon (in der Console, auf einer anderen Instanz oder bei Mailcow), Limits unter dem Verbrauch, Relay-Domain, Ziele einer Spezial-Weiterleitung, DKIM-Schlüssel existiert, keine Zone für "Fehlende Einträge hinzufügen", DNS gerade nicht änderbar, Reseller ohne Modul |
| 422  | `unsupported`      | Der Provider kann keine E-Mail (z.B. Nextcloud als Instanz gewählt)                                                                                                                                                                                                                                    |
| 502  | `provider_error`   | Mailcow hat abgelehnt oder war nicht erreichbar, `message` mit dem Text von Mailcow und dem HTTP-Status. Ebenso, wenn die Einträge der Zone beim Hinzufügen nicht lesbar waren                                                                                                                         |

Jede Änderung steht im Audit-Log, gescheiterte mit `status: failure` und der Meldung, auch die
Limit-Prüfungen der Console.

### API Explorer

Für alles ohne eigenen Button: Admin > API Explorer, Provider Mailcow wählen.

- Pfade beginnen mit `/api/v1/get/`, `/add/`, `/edit/` oder `/delete/`, die Base URL davor ist
  erlaubt. Die Methode ergibt sich aus dem Pfad: `get` liest mit GET, alles andere ändert mit
  POST. Andere Pfade, `..`, `//`, `\`, `#` und kodierte Punkte oder Schrägstriche sind gesperrt.
- Body: bei `add` die Attribute, bei `edit` `{"items": [...], "attr": {...}}`, bei `delete`
  `{"items": [...]}` (die Console schickt Mailcow die Liste allein). Werte als Text (`"1"`/`"0"`),
  Grössen in MiB.
- Vorlagen: Domains, Postfächer, Weiterleitungen, DKIM, Version, Passwortrichtlinie.
- In Antworten sind Werte von Feldern wie `password`, `secret`, `token`, `privkey` oder `api_key`
  ausgeblendet, ebenso der Key der Console und Passwörter oder Schlüssel, die im Request standen.
- Ändernde Requests stehen mit Pfad und Body im Audit-Log (`provider.explorer`), Passwörter und
  private Schlüssel ausgeblendet. Lesende nicht.
- Was über den Explorer geändert wird, prüft die Console nicht gegen ihre Limits. Mailcow setzt die
  Limits der Domain trotzdem durch.

### Grenzen

- **Sperren:** Ein gesperrter Kunde sieht seine Mail-Domains in der Console nur noch lesend. Bei
  Mailcow laufen sie weiter, E-Mails kommen an und gehen raus. Wer das stoppen will, schaltet die
  Domain unter "Limits ändern" auf inaktiv. Ebenso lassen ein abgeschaltetes Modul und eine gelöste
  Zuweisung Mailcow unberührt.
- **Abrechnung:** Limits und Dienst sind getrennt. Ein Produkt mit Modul "E-Mail" geht, aber ein
  Dienst lässt sich nicht mit einer Mail-Domain verknüpfen, und Speicher oder Postfächer werden
  nicht nach Verbrauch abgerechnet. Siehe [billing.md](billing.md#e-mail-mailcow-verkaufen).
- **Mail-Domains anlegen** kann nur weblion.one, nicht Kunden oder Reseller.
- Nicht in der Console, das geht in Mailcow: Protokolle pro Postfach (IMAP, POP3, SMTP, Sieve,
  ActiveSync, Webmail) schalten, Spam-Einstellungen, Filter, Abwesenheitsnotizen (die Nutzer selbst
  in SOGo), Alias-Domains, Domain-Admins, Absender-Rechte, BCC, Quarantäne, TLS-Richtlinien,
  DKIM-Schlüssel tauschen oder entfernen, Relay-Domains verwalten (die Console zeigt sie nur).
- SPF und DMARC schlägt die Console mit festen Werten vor.
- Eine Domain zwischen zwei Instanzen umziehen (Postfächer und E-Mails kopieren)
- Wie viel Platz die Instanz noch hat, zeigt nur die Seite des Providers (belegter Mail-Speicher).
  Wer mehr verkauft, als die Disk hat, überwacht das selbst.

Ideen dazu in der [Roadmap](roadmap.md).

### Offene Punkte

Gegen ein echtes Mailcow ist die Anbindung noch nicht getestet, nur gegen einen Mock-Server, der
antwortet wie der Quellcode von Mailcow (Stand `master` vom 9. Oktober 2026). Vor dem ersten
echten Einsatz mit einer Test-Instanz prüfen:

- Der Menüpfad für API-Keys und die Whitelist des Netfilters in der aktuellen Mailcow-Oberfläche
- Nach wie vielen abgelehnten API-Anmeldungen und wie lange der Netfilter eine IP sperrt
- Die Antwort auf den Schreibtest des Verbindungstests (`edit/rl-domain` ohne Domain sollte "Task
  completed" ergeben)
- Ob eine neue Domain den Neustart von SOGo für Webmail noch braucht. Wenn nicht, den Schalter im
  Dialog standardmässig ausschalten.
- Ob rspamd mit einem neuen DKIM-Schlüssel sofort signiert, ohne Neustart
- Was ein inaktives Postfach beim Empfang macht (ablehnen oder zurücksenden)
- Ob das Versandlimit Nachrichten oder Empfänger zählt
- Was `sender_allowed` bei Weiterleitungen genau erlaubt
- Die Standardwerte der Passwortrichtlinie einer neuen Instanz (die Demo nimmt 8 Zeichen,
  Buchstaben, Gross- und Kleinschreibung)
- Die Zeitzone von Anlage- und Änderungsdatum (die Console liest UTC und zeigt nur das Datum)
- Wie schnell Belegung und Zahl der Nachrichten der echten Nutzung folgen
- Ob Joker.com einen TXT-Wert über 255 Zeichen in einem Stück annimmt (die Console teilt ihn
  ohnehin) und wie 24fire lange TXT-Werte speichert. Ein Provider, der ablehnt, erscheint bei
  "Fehlende Einträge hinzufügen" als fehlgeschlagen.
- Die Antwort von Mailcow bei PHP-Fehlern (HTTP 500 mit leerem Body oder HTML)
- Die älteste Mailcow-Version, mit der die Anbindung funktioniert. Fehlt
  `GET /api/v1/get/passwordpolicy` in einer Version, gelten die Regeln der Console.

### Demo

Der Demo-Provider (`ENABLE_DEMO_PROVIDER=true`) simuliert auch eine Mailcow-Instanz im Speicher,
mit denselben Prüfungen und Antworten wie die echte Anbindung. Der Mailserver
`mail.demo.weblion.one` existiert nicht, "Webmail öffnen" führt ins Leere. Mit `pnpm db:seed`:

- Muster AG hat `muster-ag.ch` (vier Postfächer in allen drei Status,
  Weiterleitungen jeder Art inklusive Catch-all und einer, die verwirft, mit DKIM-Schlüssel) und
  `muster-shop.ch` (ein Postfach von höchstens 5, kein DKIM-Schlüssel, und die DNS-Zone passt noch
  nicht zu Mailcow: gut für "DKIM-Schlüssel erzeugen" und "Fehlende Einträge hinzufügen").
- Bäckerei Huber hat `baeckerei-huber.ch`, ihr Reseller Alpen Hosting `alpen-hosting.ch` im eigenen
  Bestand zum Weitergeben.
- `müller.ch` (Umlaut-Domain) und die Relay-Domain `alpenblick-hotel.ch` sind keinem Kunden
  zugewiesen.

## CloudPanel (Websites)

- Zugang: CloudPanel hat keine API. Die Console meldet sich per SSH als Benutzer `weblion-agent`
  mit einem ed25519-Schlüssel an und darf dort nur einen Befehl ausführen: den Root-Wrapper
  `weblion-clp`. Wrapper, Installer und Tests liegen in
  [`deploy/cloudpanel-agent/`](../deploy/cloudpanel-agent/), die Anleitung für den Server in
  [deploy/cloudpanel-agent/README.md](../deploy/cloudpanel-agent/README.md).
- Voraussetzung: CloudPanel CE 2.5.0 oder neuer auf Debian oder Ubuntu
- Konfiguration: `CLOUDPANEL_*` in der `.env` (ein Server) oder im Admin-Bereich unter Provider >
  Provider hinzufügen > CloudPanel (beliebig viele Server)
- CloudPanel liefert keine Server. Im Server-Inventar und in den Server-Filtern taucht der
  Provider deshalb nicht auf.

### Was das Modul macht

weblion.one betreibt eigene CloudPanel-Server und verkauft darauf Websites. Das Modul
**Webhosting** (`webhosting`), in dem bisher nur die Webspaces von 24fire lagen, bringt das in die
Console. Eine Website ist eine Domain mit ihrem www-Gegenstück (CloudPanel liefert beide aus),
ein Linux-Benutzer für SFTP und SSH (in CloudPanel "Site-User") und beliebig viele
MySQL-Datenbanken.

- **Kontingent pro Kunde:** weblion.one (oder ein Reseller für seine Kunden) legt fest, auf
  welchem Server die Websites eines Kunden entstehen, wie viele Websites und Datenbanken er
  höchstens hat und welche Arten erlaubt sind (PHP, statisch, Node.js).
- **Selbstverwaltung:** Im Kontingent legt der Kunde Websites selbst an: PHP mit einer Anwendung
  (Vhost-Vorlage, Standard Generic, WordPress, WooCommerce), statische Websites und, wo freigegeben,
  Node.js. Er setzt Passwörter neu, legt Datenbanken an und löscht sie, stellt Zertifikate von
  Let's Encrypt aus und löscht Websites. In der Console unter "Webhosting", sobald das Modul aktiv
  ist.
- **Zugangsdaten einmal:** Passwörter für SFTP/SSH und Datenbanken erzeugt die Console (oder nimmt
  ein gewähltes), zeigt sie einmal an und speichert sie nirgends.
- **DNS-Prüfung:** Vor einem Zertifikat prüft die Console, ob Domain und www-Gegenstück auf den
  Server zeigen.
- **Verbrauch:** Der Server misst alle sechs Stunden den Platz der Dateien und Datenbanken jeder
  Website. Ein Limit gibt es nicht.

Websites sind Zeilen der Tabelle `webspaces` mit `kind = 'website'`, ihre Datenbanken stehen in
`webspace_databases`, die Kontingente in `website_allowances`. Die Webspaces von 24fire bleiben,
wie sie sind (`kind = 'webspace'`), und erscheinen auf derselben Seite.

Wer darf was:

| Wer                           | Darf                                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Owner, Admin                  | Websites im Kontingent anlegen, Datenbanken anlegen und löschen, Zertifikate ausstellen (`webspace:write`), Websites löschen (`webspace:delete`), Passwörter neu setzen (`webspace:credentials`) |
| Member, Nur lesen             | Websites, Zugang ohne Passwort, Datenbanken, DNS-Prüfung und Verbrauch ansehen (`webspace:read`)                                                                                                 |
| Eingeschränkt, Buchhaltung    | nichts, per Policy erweiterbar (Ressource `webspace/<id>` für eine Website, Anlegen braucht `org` oder `*`)                                                                                      |
| API-Token "Lesen & Schreiben" | Websites und Datenbanken anlegen, aber nur mit Passwörtern, die es selbst mitschickt, Zertifikate ausstellen, löschen. Nie `webspace:credentials`                                                |
| Mitarbeitende eines Resellers | im Panel seiner Kunden, was ihre Reseller-Rolle erlaubt, dazu Kontingente der Kunden und Websites aus dem eigenen Bestand weitergeben (`reseller:customer:write`)                                |
| weblion.one Superadmin        | alles, dazu Websites für jeden Kunden auf jedem Server anlegen, übernehmen und aus der Console entfernen (`platform:website:write`), Kontingente (`platform:org:write`)                          |
| weblion.one Support           | alles ansehen, nichts ändern                                                                                                                                                                     |

Gesperrte Kunden sehen ihre Websites nur noch lesend, die Websites laufen weiter.

### Warum SSH und ein Wrapper

CloudPanel ist ein Panel für einen Admin, ohne API und ohne Mandanten. Was die Console braucht,
geht nur über das Kommandozeilenwerkzeug `clpctl` als root, und auch das nur zum Teil. Root-Zugang
per SSH für die Console wäre zu viel: Wer die Console übernimmt, hätte dann alle Server. Deshalb
läuft auf jedem Server ein kleines Python-Skript als Grenze:

- **Geschlossene Liste:** Der Wrapper kennt genau 13 Operationen (lesen, anlegen, löschen,
  Passwort, Datenbanken, Zertifikat, übernehmen, vergessen) und prüft jedes Argument gegen ein
  festes Muster. Befehle laufen ohne Shell und mit fester Umgebung.
- **Nur verwaltete Sites:** Der Wrapper ändert nur Sites auf seiner Liste verwalteter Sites
  (angelegt von der Console oder von root übernommen). Sites auf der Schutzliste, etwa die Console
  selbst, fasst er nie an, auch wenn die Console es verlangt.
- **Passwörter nie an CloudPanel:** `clpctl` will Passwörter auf der Kommandozeile, CloudPanel
  setzt sie selbst in Shell-Befehle, `ps` und Fehlermeldungen, und `$` oder `)` im Passwort
  verderben es (CloudPanel-Issues #284, #351, #798). Der Wrapper gibt `clpctl` deshalb ein
  zufälliges Wegwerf-Passwort aus Buchstaben und Ziffern und setzt gleich danach das echte über
  stdin (`chpasswd`, `ALTER USER` über den MySQL-Client). Beim Anlegen beendet er danach alle
  Prozesse des neuen Benutzers, leert `~/.ssh/authorized_keys` und löscht seine Crontab (bei einer
  neuen Datenbank die MySQL-Sitzungen ihres Benutzers), falls jemand das Wegwerf-Passwort in den
  paar Sekunden gelesen hat.
- **Nachprüfen statt Exit-Codes:** Ob `clpctl` etwas getan hat, sieht der Wrapper in der
  SQLite-Datenbank von CloudPanel, die er nur liest. Die Exit-Codes von `clpctl` sind nicht
  dokumentiert.
- **Was `clpctl` nicht kann,** übernimmt der Wrapper mit Linux-Werkzeugen: Sites auflisten (aus der
  Datenbank von CloudPanel), Passwörter ändern, Belegung messen (`du`).

Eine übernommene Console (Schlüssel und Datenbank) kann so höchstens verwaltete Kundenwebsites auf
den Servern beschädigen, auf denen ihr Schlüssel liegt (mit `--allow-remote-adopt` auch Sites, die
sie vorher übernimmt). Geschützte Sites wie die Console selbst, das Panel und alles ausserhalb der
13 Operationen bleiben ausser Reichweite.

### Eigener Server für Kundenwebsites

Empfehlung: Kundenwebsites auf einem oder mehreren eigenen CloudPanel-Servern, **nicht** auf dem
Server, auf dem die Console läuft. Site-User haben eine echte Shell, CloudPanel hatte in den
letzten Jahren mehrere lokale Rechteausweitungen (Changelog 2023 bis 2.5.0), und eine übernommene
Kundenwebsite auf derselben Maschine könnte die `.env` der Console lesen, mit dem
`ENCRYPTION_KEY` und damit allen Zugangsdaten.

Die Console erzwingt das nicht, es ist eine Voreinstellung. Wer Websites trotzdem auf dem Server
der Console verkauft, setzt die Site der Console beim Installieren auf die Schutzliste
(`--protect-domain cp.weblion.cloud --protect-user <Site-User der Console>`, siehe
[deployment.md](deployment.md#auf-cloudpanel)) und richtet `hidepid` ein (siehe README des
Agents).

### Voraussetzungen

1. **CloudPanel-Server.** Eine VM mit CloudPanel CE 2.5.0 oder neuer (Debian oder Ubuntu), in der
   Hetzner Cloud, bei 24fire oder auf dem eigenen Proxmox. Ältere Versionen lehnt der Agent für
   Änderungen ab: Vor 2.5.0 war die erste Zeile von `clpctl` kaputt, und 2.5.0 schliesst eine
   Rechteausweitung über `clpctlWrapper`. CloudPanel mit seinem eigenen Updater aktuell halten.
2. **Firewall** (in der Admin Area von CloudPanel): 80 und 443 offen, 22 für Kunden (SFTP/SSH)
   und die Console, 8443 (das Panel) nur für die IPs von weblion.one.
3. **Ein Name für Kunden**, z.B. `web1.weblion.cloud` mit A- und AAAA-Eintrag. Diesen Namen zeigt
   die Console für SFTP und SSH.
4. **Feste ausgehende IP der Console.** Der Schlüssel der Console gilt auf dem Server nur von ihren
   Adressen aus (`from=` in `authorized_keys`). Läuft die Console in Docker ohne eigene
   IPv6-Konfiguration, geht sie über IPv4 hinaus.
5. **Zeitlimit im Reverse Proxy** vor der Console: Website anlegen wartet bis 330 Sekunden,
   Zertifikate und Löschen bis 200 Sekunden. nginx braucht `proxy_read_timeout` von mindestens 360
   Sekunden, siehe [deployment.md](deployment.md#reverse-proxy-tls).
6. **Backups:** CloudPanel sichert jede Nacht die Datenbanken jeder Site nach `~/backups` (7 Tage).
   Für Dateien und diese Sicherungen das Remote-Backup von CloudPanel einrichten (im Panel unter
   Admin Area > Backups, z.B. auf eine Hetzner Storage Box). Die Console stellt nichts wieder her.
7. **`hidepid`** für `/proc`, damit Site-User fremde Prozesse nicht sehen. Ohne `hidepid` legt der
   Agent keine Websites und Datenbanken an (abschaltbar mit `"requireHidepid": false` in
   `/etc/weblion-clp/config.json`, wenn kein Kunde SSH hat). Erst auf einem Test-Server
   ausprobieren, Details im README des Agents.

### Server anbinden

1. **Schlüsselpaar.** Admin > Provider > Provider hinzufügen, Typ CloudPanel, "Schlüsselpaar
   erzeugen". Der Dialog setzt den privaten Schlüssel ins Formular und zeigt den öffentlichen mit
   der fertigen Zeile für den Installer. Das Paar gilt erst beim Speichern, und Speichern braucht
   den Fingerabdruck aus Schritt 2: Den Dialog also offen lassen, bis der Installer gelaufen ist.
   Alternativ das Paar selbst erzeugen
   (`ssh-keygen -t ed25519 -N "" -C weblion-console -f cloudpanel_web1`) und den privaten
   Schlüssel später einfügen. Empfohlen ist ein eigener Schlüssel pro Server.
2. **Agent installieren**, als root auf dem Server. Den Ordner `deploy/cloudpanel-agent` aus dem
   Repository kopieren (z.B. `scp -r deploy/cloudpanel-agent root@web1.weblion.cloud:`) und dort:

   ```bash
   cd cloudpanel-agent
   sudo ./install.sh --public-key "ssh-ed25519 AAAA... weblion-console" \
     --from "203.0.113.5,2001:db8::5" \
     --protect-domain kunde-des-betreibers.ch --protect-user betreiber-site
   ```

   `--from` sind die ausgehenden IPv4- und IPv6-Adressen der Console (oder Netze), getrennt durch
   Komma. `--protect-domain` und `--protect-user` nennen jede Site und jeden Site-User, den die
   Console nie anfassen darf, beide wiederholbar. Die Zeile aus dem Dialog hat dafür Platzhalter:
   ersetzen oder, ohne Sites des Betreibers auf dem Server, weglassen. `--nodejs` gibt
   Node.js-Websites auf dem Server frei, `--allow-remote-adopt` das Übernehmen aus der Console
   (sonst nur als root, siehe unten).
   Am Ende läuft `weblion-clp selftest`, und das Skript zeigt Host, Port, Benutzer, den
   Fingerabdruck des Host-Schlüssels und die Adressen des Servers. Was es auf dem Server ändert,
   steht im [README des Agents](../deploy/cloudpanel-agent/README.md).

3. **Verbindung in der Console** fertig ausfüllen und speichern:

   | Feld                               | Inhalt                                                                                                                                                        |
   | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | SSH-Host, SSH-Port                 | Name oder IP, unter der die Console den Server erreicht, Port meist 22                                                                                        |
   | SSH-Benutzer                       | `weblion-agent` (Standard)                                                                                                                                    |
   | Privater Schlüssel (ed25519)       | unverschlüsselter OpenSSH-Schlüssel. Beim Bearbeiten behält ein leeres Feld den gespeicherten                                                                 |
   | Fingerabdruck des Host-Schlüssels  | `SHA256:...` aus der Ausgabe von `install.sh` oder von `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` auf dem Server                                      |
   | Host für Kunden (optional)         | der Name für SFTP/SSH, z.B. `web1.weblion.cloud`. Standard: der SSH-Host                                                                                      |
   | IPv4- und IPv6-Adressen (optional) | Adressen für die DNS-Prüfung, je höchstens 8. Standard: was der Server als öffentliche Adressen meldet. Bei NAT (nur private Adressen auf dem Server) Pflicht |
   | PHP-Versionen (optional)           | was Kunden wählen dürfen, Standard `8.3, 8.4`. Angeboten wird nur, was auf dem Server installiert ist                                                         |
   | Anwendungen (optional)             | Vhost-Vorlagen für Kunden, ein `*` am Ende passt auf alle Namen mit diesem Anfang (`Laravel*`). Standard `Generic, WordPress, WooCommerce`                    |
   | Node.js-Websites für Kunden        | nur zusammen mit `--nodejs` auf dem Server. Kunden brauchen Node.js zusätzlich in ihrem Kontingent                                                            |

4. **"Verbindung testen"** fragt den Agent frisch und meldet Version von CloudPanel und Agent,
   Zahl der Sites (verwaltet, nicht verwaltet), die installierten PHP-Versionen und ob Übernehmen
   aus der Console erlaubt ist. Er scheitert, wenn CloudPanel älter als 2.5.0 ist oder Console und
   Agent verschiedene Protokolle sprechen. Danach "Jetzt synchronisieren".
5. **Kontingente** für Kunden einrichten (siehe unten).

Die Seite des Providers zeigt die Einstellungen (vom privaten Schlüssel nichts) und die Karte
"SSH-Schlüssel der Console" mit dem öffentlichen Schlüssel und der Zeile für den Installer, z.B.
für einen neuen Server mit demselben Schlüssel. Der Host-Schlüssel ist gepinnt: Meldet der Server
einen anderen (neu installiert, oder jemand dazwischen), bricht die Console vor der Anmeldung ab
und nennt den neuen Fingerabdruck. Ihn erst prüfen, dann in der Verbindung
ändern. Ein "Neuen Schlüssel übernehmen" gibt es bewusst nicht.

**Über die `.env`** für den ersten Server (Werte mit Sonderzeichen in einfache Anführungszeichen
setzen):

```env
CLOUDPANEL_HOST=web1.weblion.cloud
CLOUDPANEL_PORT=22
CLOUDPANEL_USER=weblion-agent
# Datei nur für den Benutzer der Console lesbar (0600), oder der Schlüssel inline mit \n
CLOUDPANEL_PRIVATE_KEY_FILE=/home/weblion-cp/.ssh/cloudpanel_web1
CLOUDPANEL_PRIVATE_KEY=
CLOUDPANEL_HOST_KEY=SHA256:...
CLOUDPANEL_ACCESS_HOST=web1.weblion.cloud
CLOUDPANEL_NAME=CloudPanel
CLOUDPANEL_COUNTRY=CH
CLOUDPANEL_CITY=Zürich
```

Sind Host, Fingerabdruck und ein Schlüssel gesetzt, legt die Console den Provider beim Start an,
speichert alles verschlüsselt und übernimmt Änderungen bei jedem Start (Schlüssel tauschen heisst:
`.env` ändern und neu starten). `CLOUDPANEL_PRIVATE_KEY` gewinnt über die Datei. Lässt sich die
Datei nicht lesen, fehlt der Provider, und im Log steht ein Fehler. In Docker muss die Datei im
Container liegen (als Volume einbinden) oder der Schlüssel inline stehen. Name, Land und Stadt
gelten beim ersten Start, danach ändert man sie im Admin-Bereich.

Die Einstellungen einer Verbindung aus der `.env` lassen sich im Admin-Bereich nicht ändern, und
für PHP-Versionen, Anwendungen, Node.js und Adressen gibt es keine Variablen. Diese Verbindung
bietet also immer PHP 8.3 und 8.4, Generic, WordPress und WooCommerce, kein Node.js für Kunden und
die Adressen, die der Server meldet. Wer anderes braucht, legt den Server im Admin-Bereich an.

### Mehrere Server

Jeder CloudPanel-Server ist ein eigener Provider: der aus der `.env` und beliebig viele aus dem
Admin-Bereich, jeder mit eigenem Schlüssel (oder demselben öffentlichen Schlüssel auf mehreren
Servern, empfohlen ist einer pro Server), Host-Schlüssel, Standort und eigener Auswahl für Kunden.

- Jede Website gehört zu genau einem Server, jede Route adressiert sie über ihre ID und spricht mit
  dem Server ihrer Verbindung. MySQL-Namen sind pro Server eindeutig.
- Das Kontingent eines Kunden nennt den Server, auf dem seine neuen Websites entstehen. Kunden
  wählen keinen Server. weblion.one wählt beim Anlegen im Admin-Bereich frei.
- Dieselbe Domain (oder ihr www-Gegenstück) auf zwei Servern lehnt die Console beim Anlegen ab
  (409), auch über verschiedene Kunden hinweg.
- Ein Server nur für einen Kunden ist ein Server, auf den nur das Kontingent dieses Kunden zeigt.
  Die Console behandelt ihn nicht anders.
- Ein Provider lässt sich nicht löschen, solange eine seiner Websites einem Kunden zugewiesen ist
  oder ein Kontingent auf ihn zeigt. Nicht zugewiesene Websites verschwinden mit ihm aus der
  Console, auf dem Server bleiben sie (auch auf seiner Liste verwalteter Sites).
- Website zwischen Servern umziehen ist Handarbeit: Dateien und Dumps kopieren, auf dem neuen Server
  anlegen oder dort als root übernehmen, auf dem alten löschen.
- Reseller sehen nur Name und Standort des Servers ihres Kontingents, nie die Verbindung.

### Websites anlegen

Webhosting > "Website anlegen" (`webspace:write`, im Kontingent):

- **Domain**, mit oder ohne www, Umlaut-Domains gehen (gespeichert in der `xn--`-Form, angezeigt in
  Unicode). CloudPanel liefert beide Namen aus und leitet einen auf den anderen um.
- **Art**, soweit Kontingent und Server sie erlauben: PHP-Anwendung, statische Website, Node.js.
  Python-Sites und Reverse Proxies legt die Console nie an (ein Reverse Proxy könnte auf das Panel
  oder interne Dienste zeigen).
- **PHP:** Anwendung (Vhost-Vorlage des Servers, Standard Generic) und PHP-Version (Standard die
  neueste erlaubte). Die Website startet leer, auch mit WordPress: Die Dateien lädt der Kunde per
  SFTP hoch.
- **Node.js:** Version 20, 22 oder 24. Den App-Port vergibt der Server (der erste freie zwischen
  3001 und 3999), die App startet der Kunde per SSH, z.B. mit PM2. Das Anlegen dauert länger, weil
  CloudPanel Node.js für den Benutzer installiert.
- **Benutzername** (der Site-User): vorgeschlagen aus der Domain (`www.mueller-shop.ch` wird
  `mueller-shop-ch`), änderbar. 3 bis 32 Zeichen, Kleinbuchstaben, Ziffern und `-`, am Anfang ein
  Buchstabe. Reserviert sind `root`, `clp`, `mysql`, `nginx`, `www-data`, `proftpd`, `varnish`,
  `redis`, `admin`, `ubuntu`, `debian` und alles, was mit `weblion` beginnt. Der Server lehnt
  zusätzlich jeden Linux-Benutzer ab, den es schon gibt.
- **Datenbank anlegen** (bei WordPress und WooCommerce vorausgewählt), siehe Datenbanken.
- **Passwort:** erzeugt (Standard) oder selbst gewählt.

Vorher prüft die Console: Kontingent vorhanden (409 `no_allowance`), Art im Kontingent und auf dem
Server (409 `type_not_allowed`), noch Platz für eine Website und gegebenenfalls eine Datenbank (409
`allowance_exceeded`), Version und Anwendung angeboten (400), und die Domain ist frei: keine andere
Website mit der Domain oder ihrem www-Gegenstück auf irgendeinem Server, und im Modul "Domains &
DNS" gehört keiner der beiden Namen einem anderen Kunden (409 `exists`, `details.field` =
`domain`, der eigene Reseller darf ihn halten). Wartet die Domain auf demselben Server noch als
fehlende Website, entfernt weblion.one diese zuerst. Die Console reserviert die Website unter einer
Sperre pro Kunde und pro Domain und ruft erst danach den Server. Parallele Anfragen können das
Kontingent also nicht überziehen.

Der Server prüft alles noch einmal, legt die Site an, setzt das echte Passwort und nimmt sie auf
seine Liste verwalteter Sites. Scheitert ein Schritt, löscht er die halbe Site wieder. Eine
Datenbank, die nicht klappt, lässt die Website stehen: Die Antwort kommt mit einem Hinweis, die
Datenbank legt der Kunde später an. Dauert es zu lange, reisst die Verbindung ab oder lässt sich
die halbe Site nicht wieder löschen, steht die Website auf "Unklar" (Status `error`, Antwort 502
`website_error`), und der nächste Sync klärt sie: Hat der Server sie, wird sie aktiv, aber niemand
hat das Passwort gesehen, der Kunde setzt ein neues. Hat er sie nicht, verschwindet sie nach 10
Minuten.

Die Antwort zeigt die Zugangsdaten einmal: Host, Port 22, Benutzername, Passwort, eine
`sftp://`-Adresse und die Zeile für `ssh`, dazu gegebenenfalls Datenbank, Benutzer und Passwort.
Im Audit-Log steht `website.create` mit Art, Versionen, Anwendung, Benutzer, Datenbank, Server und
ob die Passwörter erzeugt oder gewählt waren, die Passwörter nie.

Per API mit Token nur mit mitgeschickten Passwörtern (sonst 400):

```bash
curl -X POST -H "Authorization: Bearer wlc_…" -H "Content-Type: application/json" \
  -d '{"domain":"shop.kunde.ch","type":"php","template":"WordPress","phpVersion":"8.4",
       "password":"…","database":{"suffix":"wp","password":"…"}}' \
  https://cp.weblion.cloud/api/v1/orgs/<org-id>/websites
```

Die Antwort (201, `Cache-Control: no-store`) ist
`{ "website": {...}, "access": {..., "password": null}, "database": {..., "password": null}, "warnings": [] }`.
Was sich anlegen lässt, liefert `GET /api/v1/orgs/<org-id>/websites/options`.

### Zugang und Passwörter

Die Detailseite (Webhosting > Website) zeigt Host, Port, Benutzername, Home- und Web-Verzeichnis.
SFTP und SSH nutzen denselben Benutzer, der eine normale Shell hat: Dateien hochladen, `crontab -e`
für geplante Aufgaben, Logs in `~/logs`, Composer, WP-CLI, PM2.

- **Erzeugte Passwörter** haben 24 Zeichen ohne verwechselbare Zeichen (I, l, O, 0, 1) und ohne
  Sonderzeichen, damit sie sich leicht in SFTP-Programme und Konfigurationsdateien abtippen lassen
  (rund 140 Bit).
- **Selbst gewählte Passwörter:** 12 bis 128 Zeichen aus Buchstaben, Ziffern und
  `!#%*+,-./;<=>?@^_{|}~`. Leerzeichen, Anführungszeichen, `$`, `:`, `\`, `` ` ``, `(`, `)` und `&`
  lehnt die Console ab.
- **Neues Passwort** (`webspace:credentials`, Owner und Admin) geht nur mit Login, nie per
  API-Token. Laufende Prozesse und offene SSH-Sitzungen bleiben, damit eine Node.js-App nicht
  stehen bleibt. Im Audit-Log steht `website.password_reset` (wer, wann, erzeugt oder gewählt).
  Per API nur mit Session: `POST /api/v1/webspaces/<id>/password`, ohne Body erzeugt, mit
  `{"password": "…"}` gewählt.
- Die Passwörter laufen nur über stdin von `chpasswd` und dem MySQL-Client auf dem Server. Sie
  stehen in keiner Kommandozeile, keinem Log, keiner Datenbank und keinem Audit-Eintrag.
- **Schlüssel der Console:** verschlüsselt gespeichert (AES-256-GCM). Der Admin-Bereich zeigt nur
  den öffentlichen Schlüssel, vom privaten nichts.
- Ein Login für das Panel von CloudPanel (Port 8443) bekommen Kunden nicht. SSH-Schlüssel für
  Site-User verwaltet die Console noch nicht, Kunden tragen sie per SSH selbst in
  `~/.ssh/authorized_keys` ein.

### Datenbanken

- **Anlegen** (`webspace:write`, im Kontingent): Name und Benutzer sind gleich und beginnen mit
  dem festen Präfix der Website, dem Site-User mit `_` statt `-`, höchstens 16 Zeichen. Der Kunde
  wählt nur den Rest: Kleinbuchstaben, Ziffern und `_`, höchstens 15 Zeichen, zusammen höchstens
  32 (`shop-mueller` und `wp` ergeben `shop_mueller_wp`). Das Passwort erscheint einmal.
- **Neues Passwort** (`webspace:credentials`, nur mit Login) und **Löschen** (`webspace:write`,
  mit dem Namen als Bestätigung, `clpctl db:delete`, alle Daten sind weg). Fehlt die Datenbank auf
  dem Server schon, entfernt Löschen nur den Eintrag.
- Anwendungen auf dem Server verbinden sich mit Host `127.0.0.1`, Port 3306. phpMyAdmin bietet die
  Console nicht an. Von aussen geht es über einen SSH-Tunnel
  (`ssh -L 3306:127.0.0.1:3306 <Benutzer>@<Host>`).
- Datenbanken, die jemand im Panel von CloudPanel angelegt hat, zeigt die Console mit dem Sync,
  auch mit anderen Namen, und zählt sie zum Kontingent. Neue legt sie nur mit dem Präfix an.

Im Audit-Log stehen `website.db_create`, `website.db_password_reset` und `website.db_delete`. Per
API: `POST /api/v1/webspaces/<id>/databases` mit `{"suffix": "wp", "password": "…"}` (Token nur mit
Passwort), `POST .../databases/<db-id>/password` (nur Session), `DELETE .../databases/<db-id>` mit
`{"confirm": "<Name>"}`.

### SSL-Zertifikate und DNS-Prüfung

Eine neue Website hat das selbst signierte Zertifikat von CloudPanel, dem Browser nicht trauen.
"Let's-Encrypt-Zertifikat ausstellen" (`webspace:write`) gilt für die Domain und ihr
www-Gegenstück:

1. **DNS-Prüfung:** Die Console fragt öffentliche Resolver (`DNS_CHECK_RESOLVERS`, Standard
   `1.1.1.1,9.9.9.9`, nie den Resolver des Systems) nach A und AAAA beider Namen. Erwartet werden
   die Adressen der Verbindung oder, ohne Angabe, die öffentlichen Adressen, die der Server meldet.
   Status pro Name: "Zeigt auf den Server" (mindestens eine Adresse, alle vom Server), "Zeigt
   anderswohin" (eine fremde Adresse, z.B. CDN oder alter Server), "Kein Eintrag" oder "Abfrage
   fehlgeschlagen". Das Ergebnis gilt 60 Sekunden.
2. Zeigen nicht beide Namen auf den Server, antwortet die Console mit 409 `dns_not_ready` und den
   Namen. "Trotzdem versuchen" (`force`) überspringt die Prüfung, z.B. hinter Cloudflare. Let's
   Encrypt sperrt nach wiederholten Fehlern eine Weile, deshalb die Prüfung.
3. Der Server ruft `clpctl lets-encrypt:install:certificate` auf und prüft danach, dass ein neues
   Zertifikat da ist, das noch mindestens 7 Tage gilt. Sonst kommt die Meldung von Let's Encrypt
   zurück (z.B. "DNS problem: NXDOMAIN ..."). Das dauert bis zu drei Minuten.

Die Karte "DNS" zeigt die nötigen A- und AAAA-Einträge zum Kopieren und verlinkt die Domain im
Modul "Domains & DNS", wenn sie dort liegt und die Person sie lesen darf. Eintragen muss der Kunde
sie selbst (siehe Grenzen). Die Console färbt das Zertifikat unter 30 Tagen gelb, unter 14 Tagen,
abgelaufen, fehlend oder selbst signiert rot. Verlängern soll CloudPanel selbst (siehe Offene
Punkte). Im Audit-Log steht `website.certificate` mit `force`, DNS-Ergebnis und Ablaufdatum. Per
API: `GET /api/v1/webspaces/<id>/dns-check`, `POST /api/v1/webspaces/<id>/certificate` mit
`{"force": false}`.

### Löschen

- Website löschen (`webspace:delete`) verlangt die Domain als Bestätigung. Der Server löscht die
  Site mit `clpctl site:delete --force`: alle Dateien in `/home/<Benutzer>`, alle Datenbanken, die
  nächtlichen Sicherungen in `~/backups`, Cron-Jobs und den Benutzer. Rückgängig machen geht nicht.
- Was CloudPanel liegen lässt, räumt der Server auf und meldet es als Hinweis: Datenbanken und
  Datenbank-Benutzer der Site (nur die Namen, die er vorher gelesen hat) und eine verwaiste
  Crontab. Bleibt der Linux-Benutzer bestehen, meldet er das nur.
- Hängt ein laufender Dienst der Abrechnung an der Website, lehnt die Console mit 409 ab: zuerst
  den Dienst kündigen.
- Meldet der Server die Site beim Löschen nicht mehr (gelöscht oder nicht mehr verwaltet),
  entfernt Löschen nur noch den Eintrag in der Console. Hat der Sync sie schon als fehlend
  markiert, geht Löschen nicht mehr (409 `website_missing`): weblion.one entfernt sie dann mit "Aus
  der Console entfernen". Eine Website mit Status "Unklar" kann nur weblion.one löschen.
- Ein Kunde mit Websites lässt sich (wie mit Webspaces) nicht löschen. Sein Website-Kontingent
  verschwindet mit ihm.

Im Audit-Log steht `website.delete` mit Benutzer, Server und Hinweisen. Per API:
`DELETE /api/v1/webspaces/<id>` mit `{"confirm": "shop.kunde.ch"}`.

### Kontingente einrichten

Admin > Kunden > Kunde, Karte "Website-Kontingent" > Einrichten (Berechtigung
`platform:org:write`):

- **Server:** alle CloudPanel-Provider (und der Demo-Server). Neue Websites des Kunden entstehen
  dort. Ein anderer Server gilt nur für neue Websites, bestehende bleiben, wo sie sind.
- **Websites höchstens** (0 bis 1000) und **Datenbanken höchstens** (0 bis 5000). 0 ist erlaubt:
  Das Kontingent besteht, angelegt werden kann nichts.
- **Erlaubte Arten:** PHP, statisch, Node.js, mindestens eine. Standard PHP und statisch. Node.js
  bekommen Kunden nur, wenn auch die Verbindung es anbietet.
- **Modul "Webhosting" aktivieren** (Standard an). Bei einem Kunden eines Resellers nur, wenn der
  Reseller das Modul hat (sonst 409).

Gezählt werden alle Websites der Organisation auf allen Servern und in jedem Zustand (auch "Wird
angelegt", "Unklar" und fehlende) und ihre Datenbanken. Senken geht nicht unter das, was schon
besteht (409 `allowance_exceeded`). Entfernen geht nur ohne Websites (beim Reseller auch ohne
Kontingente seiner Kunden) und schaltet das Modul nicht ab. Im Audit-Log stehen
`website.allowance_set` (mit den bisherigen Werten) und `website.allowance_delete`. Per API nur mit
Login:
`PUT /api/v1/admin/orgs/<org-id>/website-allowance` mit z.B.
`{"providerId": "<provider-id>", "maxSites": 5, "maxDatabases": 10, "siteTypes": ["php", "static"], "enableModule": true}`,
`DELETE` auf denselben Pfad entfernt es.

Ohne Kontingent sieht der Kunde unter "Webhosting" den Hinweis, sich an weblion.one (oder seinen
Reseller) zu wenden. Bei Websites, die weblion.one ihm zuweist, gehen Passwörter, Zertifikate und
Löschen trotzdem, neue Datenbanken nur mit Kontingent.

### Reseller

- Ein Reseller bekommt von weblion.one ein Kontingent wie jeder Kunde, dazu das Modul. Es deckt
  seine eigenen Websites und alles, was er seinen Kunden gibt: Seine Websites plus die Höchstwerte
  aller Kundenkontingente auf seinem Server müssen hineinpassen.
- Kontingente der Kunden: Reseller > Meine Kunden > Kunde > Ressourcen, Karte
  "Website-Kontingent". Der Server ist immer der des Resellers, die Arten höchstens seine.
  Speichern aktiviert beim Kunden das Modul. "Kontingent entfernen" gibt es an den Reseller zurück,
  solange der Kunde keine Websites hat. Per API: `PUT` und
  `DELETE /api/v1/reseller/customers/<id>/website-allowance`, PUT mit
  `{"maxSites": 3, "maxDatabases": 5, "siteTypes": ["php"]}`.
- Auch weblion.one gibt einem Kunden eines Resellers ein Kontingent nur aus dem des Resellers:
  derselbe Server, höchstens seine Arten, und es muss Platz sein (anders als beim
  Cloud-Speicher).
- Den Server seines Kontingents kann weblion.one nur wechseln, solange keine Kunden des Resellers
  dort ein Kontingent haben. Eine Art, die Kunden haben, lässt sich dem Reseller erst nehmen, wenn
  sie sie nicht mehr haben.
- Websites aus seinem Bestand gibt der Reseller wie Webspaces weiter (Ressourcen > "Webspace
  zuweisen"). Dabei muss die Website ins Kontingent des Kunden passen, auf demselben Server, mit
  Platz für die Website und alle ihre Datenbanken (409 sonst). Zurückholen in den eigenen Bestand
  prüft kein Kontingent.
- Im Audit-Log des Resellers stehen `reseller.website_allowance_set` und
  `reseller.website_allowance_delete`.

### Admin-Bereich: anlegen, übernehmen, entfernen

Admin > Domains & Webspaces > Webspaces zeigt Webspaces und Websites gemeinsam (Filter nach
Provider, zugewiesen oder nicht). Websites tragen das Abzeichen "Website", ihren Zustand und das
Zertifikat statt eines Ablaufdatums. Zuweisen und Zuweisung aufheben wie bei Webspaces
(`platform:server:assign`, ohne Prüfung des Kontingents). Darüber die Karte "Websites auf
CloudPanel-Servern", ihre Aktionen brauchen `platform:website:write` und einen Login:

- **Website anlegen** für einen Kunden oder vorerst ohne Zuweisung, auf einem beliebigen Server.
  Ohne Prüfung des Kontingents (die Website zählt danach trotzdem beim Kunden), mit allen
  Anwendungen des Servers und Node.js, wenn der Server es erlaubt (`--nodejs`), die PHP-Versionen
  wie für Kunden. Der Kunde bekommt das Modul. Die Zugangsdaten erscheinen einmal.
- **Nicht verwaltete Sites** eines Servers: alle Sites, die die Console nicht verwaltet, geschützte
  mit Abzeichen. Pro Site entweder "Übernehmen" (nur wenn der Server mit `--allow-remote-adopt`
  installiert ist) oder der Befehl zum Kopieren, mit dem root sie auf dem Server übernimmt:
  `sudo weblion-clp adopt <Domain>`. Die Website erscheint dann beim nächsten Sync als nicht
  zugewiesen. Geschützte Sites lassen sich nie übernehmen. Übernehmen ändert auf dem Server nichts
  ausser der Liste verwalteter Sites, auch kein Passwort.
- **Aus der Console entfernen** für Websites ohne Kunden oder solche, die auf dem Server fehlen:
  Der Server nimmt die Site von seiner Liste, sie bleibt mit allen Dateien bestehen. Die Zeile und
  ihre Datenbanken verschwinden aus der Console.

Wer eine übernommene Website zugewiesen bekommt, kann ihr Passwort setzen, Datenbanken anlegen und
löschen und sie löschen. Übernehmen also nur, was wirklich dem Kunden gehört. Im Audit-Log stehen
`website.adopt` und `website.forget`. Per API nur mit Login: `POST /api/v1/admin/websites` (wie
beim Kunden, dazu `providerId` und `orgId`, `null` für keine Zuweisung),
`GET /api/v1/admin/providers/<id>/websites/unmanaged`,
`POST /api/v1/admin/providers/<id>/websites/adopt` mit `{"domain": "..."}`,
`POST /api/v1/admin/webspaces/<id>/forget`.

### Sync

- Pro Sync-Lauf (alle `SYNC_INTERVAL_SECONDS`) eine Anfrage pro Server (`list`): alle verwalteten
  Sites mit Art, Versionen, Anwendung, Zertifikat, Datenbanken und Belegung.
- Neue Sites (von root übernommen, oder angelegt und die Zeile ging verloren) kommen als nicht
  zugewiesen dazu. Sites, die fehlen (im Panel gelöscht, mit `weblion-clp forget` entfernt),
  werden als fehlend markiert und behalten ihren Kunden. Ändern geht dann nicht mehr (409
  `website_missing`).
- Eine Website mit Status "Unklar", die der Server hat, wird aktiv. Steht eine länger als 10
  Minuten auf "Wird angelegt", gilt die Anfrage als verloren: Hat der Server die Site, wird sie
  aktiv (der Kunde setzt ein neues Passwort). Unklare und verlorene Websites, die der Server nicht
  hat, verschwinden nach 10 Minuten. Löschvorgänge lässt der Sync in Ruhe.
- Datenbanken gleicht er pro Website ab: neue kommen dazu, fehlende werden markiert.
- Was jemand im Panel von CloudPanel ändert (PHP-Version, Datenbanken), übernimmt der Sync. Eine
  Zeile, die die Console während des Laufs geändert hat, überschreibt er nicht.
- Die Detailseite liest eine Website live nach, wenn ihr Stand älter als eine Minute ist.
- Von Hand: Admin > Provider > CloudPanel > "Jetzt synchronisieren", oder der Sync-Button im Tab
  "Webspaces".

### Was die Console nutzt

Jede Operation ist ein SSH-Aufruf, die Anfrage eine Zeile JSON auf stdin, die Antwort eine Zeile
JSON auf stdout (Protokoll v1, Aufbau in [architecture.md](architecture.md#websites-cloudpanel)).

| Funktion in der Console             | Operation des Agents | Auf dem Server                                                                                                                 | Wartet (Agent / Console) |
| ----------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| Verbindungstest, Auswahl für Kunden | `info`               | `dpkg-query`, `clpctl --version`, `clpctl vhost-templates:list`, `ip -j addr`, PHP-Versionen, Datenbank von CloudPanel lesen   | 20 s / 30 s              |
| Sync                                | `list`               | Datenbank von CloudPanel lesen                                                                                                 | 45 s / 60 s              |
| Detailseite                         | `get`                | Datenbank von CloudPanel lesen                                                                                                 | 20 s / 30 s              |
| Nicht verwaltete Sites              | `unmanaged`          | Datenbank von CloudPanel lesen                                                                                                 | 20 s / 30 s              |
| Website anlegen                     | `create`             | `clpctl site:add:php`, `site:add:static` oder `site:add:nodejs`, `chpasswd`, `pkill`, `crontab -r`, mit Datenbank wie `db-add` | 300 s / 330 s            |
| Website löschen                     | `delete`             | `clpctl site:delete --force`, Reste mit dem MySQL-Client                                                                       | 180 s / 200 s            |
| Neues Passwort                      | `password`           | `chpasswd`                                                                                                                     | 20 s / 30 s              |
| Datenbank anlegen                   | `db-add`             | `clpctl db:add`, `ALTER USER`, Sitzungen des Benutzers beenden                                                                 | 75 s / 90 s              |
| Datenbank löschen                   | `db-delete`          | `clpctl db:delete --force`                                                                                                     | 75 s / 90 s              |
| Neues Datenbank-Passwort            | `db-password`        | `ALTER USER` für jeden Host des Benutzers                                                                                      | 20 s / 30 s              |
| Let's-Encrypt-Zertifikat            | `cert`               | `clpctl lets-encrypt:install:certificate`                                                                                      | 180 s / 200 s            |
| Übernehmen (Admin)                  | `adopt`              | Liste verwalteter Sites                                                                                                        | 20 s / 30 s              |
| Aus der Console entfernen (Admin)   | `forget`             | Liste verwalteter Sites                                                                                                        | 20 s / 30 s              |

Für den MySQL-Client liest der Agent die Master-Zugangsdaten mit
`clpctl db:show:master-credentials` und legt sie nur für den Aufruf in eine Datei (0600) unter
`/run/weblion-clp`. Die Console hält pro Server eine SSH-Verbindung (nach 60 Sekunden ohne Anfrage
geschlossen), schickt eine Operation nach der anderen und lässt höchstens 20 warten (dann 503
`busy`). `info` behält sie 10 Minuten, `list` 15 Sekunden, jede Änderung leert den Speicher der
Liste.

### Fehler der API

Fehler kommen wie überall in der API als `{ "error": { "code", "message", "details" } }`. Für
Websites:

| HTTP | `code`               | Wann                                                                                                                                                                     |
| ---- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 400  | `bad_request`        | Ungültige Eingabe (`details` nennt das Feld), API-Token ohne Passwort, falsche Bestätigung beim Löschen, Version oder Anwendung nicht angeboten, Benutzername reserviert |
| 403  | `forbidden`          | Recht fehlt, Modul nicht aktiv, Kunde gesperrt (nur lesen), Passwort mit API-Token                                                                                       |
| 404  | `not_found`          | Website, Datenbank, Kunde oder Kontingent gibt es nicht, oder die Person sieht sie nicht                                                                                 |
| 404  | `provider_error`     | Die Site oder Datenbank gibt es in CloudPanel nicht (mehr)                                                                                                               |
| 409  | `no_allowance`       | Kein Kontingent (beim Anlegen, beim Weitergeben durch einen Reseller)                                                                                                    |
| 409  | `allowance_exceeded` | Kontingent voll oder zu klein, `details` mit Höchstwert und Belegung                                                                                                     |
| 409  | `type_not_allowed`   | Art nicht im Kontingent oder auf dem Server nicht angeboten                                                                                                              |
| 409  | `exists`             | Domain, Benutzername oder Datenbank vergeben, `details.field` nennt das Feld (`domain`, `siteUser`, `database`, ...)                                                     |
| 409  | `dns_not_ready`      | Zertifikat ohne `force`, aber das DNS zeigt nicht auf den Server, `details` mit der Prüfung                                                                              |
| 409  | `website_busy`       | Die Website oder Datenbank wird gerade angelegt oder gelöscht                                                                                                            |
| 409  | `website_error`      | Die letzte Änderung ist unklar, der nächste Sync klärt sie                                                                                                               |
| 409  | `website_missing`    | Der Server meldet die Website nicht mehr                                                                                                                                 |
| 409  | `not_managed`        | Die Site ist auf dem Server nicht (mehr) verwaltet, oder ihr Site-User hat sich in CloudPanel geändert                                                                   |
| 409  | `protected`          | Site oder Benutzer stehen auf der Schutzliste des Servers                                                                                                                |
| 409  | `adopt_disabled`     | Übernehmen aus der Console ist auf dem Server aus                                                                                                                        |
| 409  | `conflict`           | Laufender Dienst an der Website, Kontingent mit Websites entfernen, Server des Kontingents wechseln, Reseller ohne Modul                                                 |
| 422  | `unsupported`        | Der Provider kann keine Websites, CloudPanel ist älter als 2.5.0 bzw. seine Datenbank unbekannt, oder `/proc` hat kein `hidepid`                                         |
| 502  | `provider_error`     | Der Server hat abgelehnt oder war nicht erreichbar, `message` mit dem Grund, `details.rolledBack` und `details.output` (die Ausgabe von `clpctl`, ohne Passwörter)       |
| 502  | `website_error`      | Ergebnis unklar (Zeit abgelaufen, Verbindung abgerissen): Die Website oder Datenbank entsteht vielleicht trotzdem, der Sync zeigt es                                     |
| 503  | `busy`               | Der Server ist mit einer anderen Änderung beschäftigt (Sperre, höchstens 120 Sekunden Warten) oder seine CloudPanel-Datenbank gesperrt, oder zu viele Anfragen warten    |
| 504  | `timeout`            | Keine Antwort in der Wartezeit (alles ausser Anlegen). Der Server arbeitet vielleicht weiter, ein Löschen steht danach auf "Unklar"                                      |

Jede Änderung steht im Audit-Log, gescheiterte mit `status: failure` und der Meldung. Meldungen
und Ausgaben des Servers laufen zweimal durch die Bereinigung (Agent und Console): Passwörter der
Anfrage und Muster wie `passwd -6 '...'`, `IDENTIFIED BY '...'` oder `--...Password=...` werden
`•••`.

### API Explorer

Admin > API Explorer, Provider CloudPanel: nur lesend, `GET /info` (Versionen, Vorlagen, Adressen,
Schutzliste), `/list` (verwaltete Sites) und `/unmanaged` (nicht verwaltete Sites), so wie der
Agent antwortet. Ändern geht nur über die Buttons der Console.

### Grenzen

- **Kein Speicherlimit:** CloudPanel kennt keine Kontingente auf der Platte. Das Kontingent zählt
  Websites und Datenbanken, der belegte Platz (Home-Verzeichnis und Datenbanken, alle sechs
  Stunden gemessen) ist nur zur Information. Wer mehr verkauft, als die Disk hat, überwacht den
  Server selbst.
- **Keine E-Mail:** CloudPanel-Server haben keinen Mailserver. Postfächer für die Domain gibt es im
  Modul "E-Mail" (Mailcow), WordPress und andere Anwendungen versenden per SMTP über ein Postfach
  (Plugin).
- **Keine Wiederherstellung:** Die Console stellt nichts wieder her. Datenbanken sichert CloudPanel
  jede Nacht nach `~/backups` (7 Tage), Dateien nur das Remote-Backup des Betreibers. Löschen der
  Website löscht auch `~/backups`.
- **Eine Domain pro Website** (mit www). Weitere Domains oder Aliase brauchen eine Änderung am
  Vhost im Panel.
- **Nicht in der Console**, das geht im Panel von CloudPanel durch weblion.one: PHP-Version
  wechseln (der Sync zeigt danach die neue), PHP-Einstellungen, Vhost, Wurzelverzeichnis, weitere
  SSH- oder FTP-Benutzer, Basic Auth, IP- und Bot-Sperren, Varnish, Cron-Jobs im Panel (Kunden
  nutzen `crontab -e`).
- **Sperren:** Ein gesperrter Kunde sieht seine Websites nur noch lesend, auf dem Server laufen sie
  weiter, SFTP und SSH auch. Ebenso lassen ein abgeschaltetes Modul und eine aufgehobene Zuweisung
  den Server unberührt. Websites stilllegen gibt es nicht.
- **Abrechnung:** Kontingent und Dienst sind getrennt. Ein Dienst lässt sich wie ein Webspace mit
  einer Website verknüpfen (dann lässt sie sich nicht löschen, solange er läuft), mehr nicht. Siehe
  [Roadmap](roadmap.md).
- **Fehlende DNS-Einträge** trägt die Console noch nicht selbst ein, auch wenn die Domain im Modul
  "Domains & DNS" liegt.
- **WordPress** installiert die Console nicht. Die Vorlage richtet nur den Webserver ein.
- **Verbindung aus der `.env`:** feste Auswahl für Kunden (siehe oben).
- **phpMyAdmin, Panel-Login für Kunden, SSH-Schlüssel verwalten, Umzug zwischen Servern** gibt es
  nicht.

Ideen dazu in der [Roadmap](roadmap.md).

### Offene Punkte

Gegen einen echten CloudPanel-Server ist die Anbindung noch nicht getestet. Die Console ist gegen
einen Fake-Transport und einen SSH-Server im Test geprüft, der Agent mit Python-Tests gegen
nachgebaute Werkzeuge (`clpctl`, `chpasswd`, `mysql`, `dpkg-query`, ...) und eine SQLite-Datenbank
mit dem Schema, das die Community-Werkzeuge lesen. Grundlage sind die Doku von CloudPanel, sein
Issue-Tracker und Community-Code, der `clpctl` aufruft. Vor dem ersten echten Einsatz auf einem
Test-Server prüfen:

- `install.sh` auf Debian 12 und Ubuntu 24.04 mit CloudPanel 2.5.x, danach `weblion-clp selftest`
- Website anlegen (PHP, statisch, Node.js), Passwort setzen, Datenbank anlegen und löschen,
  Zertifikat ausstellen, Website löschen, je mit einem Blick in `weblion-clp status` und das Log
- Übernehmen einer im Panel angelegten Site als root, danach Sync

Ungeprüfte Annahmen über CloudPanel (Grundlage: Doku, Issues, Community-Code). Der Agent ist so
gebaut, dass er bei den meisten auch dann richtig handelt, wenn sie falsch sind:

1. **Exit-Codes von `clpctl`** bei Validierungsfehlern und internen Fehlern. Der Agent prüft das
   Ergebnis in der Datenbank von CloudPanel, nicht den Exit-Code.
2. Ob die Kommandozeile dieselben Fehlertexte mit dem Passwort im Klartext ausgibt wie das Panel
   ("Command ... passwd -6 '...' failed"). Die Bereinigung entfernt sie so oder so.
3. Ob `clpctl db:delete --force` so funktioniert (nicht in der Doku, nur in zwei
   Community-Werkzeugen) und ob `db:delete` ohne `--force` fragt. Der Agent schliesst stdin, eine
   Rückfrage scheitert also sofort statt zu hängen.
4. Ob `clpctl site:delete` auch die Datenbanken und ihre Benutzer löscht, wie es das Panel sagt.
   Der Agent räumt Reste auf, die er kennt.
5. **Das Schema der SQLite-Datenbank** (nicht dokumentiert): die Werte von `certificate.type`, die
   Zeitzone von `created_at` und `expires_at` (gelesen als UTC) und ob `site.user_password` das
   Passwort im Klartext hält (der Agent liest die Spalte nie, ebenso nie die Tabelle `user`).
6. Das Schreibfenster von `clp-agent`: Er schreibt jede Minute in die Datenbank und stirbt, wenn
   gerade jemand liest (Issue #815, Sekunden 5 bis 6 laut vier Log-Zeilen). Der Agent liest nie
   zwischen Sekunde 2 und 9 (`dbQuietSeconds` in `config.json`), kurz und nur lesend.
7. **Wie Zertifikate verlängert werden**, seit die Befehle zum Verlängern aus `clpctl`
   verschwunden sind (Issue #720), vermutlich durch `clp-agent`. Die Console zeigt das
   Ablaufdatum und färbt es unter 30 Tagen gelb. Der Text "CloudPanel verlängert das Zertifikat
   automatisch" auf der Detailseite gilt erst nach dieser Prüfung.
8. Die installierten PHP-Versionen erkennt der Agent an `/usr/bin/phpX.Y` (sonst
   `/etc/php/X.Y/fpm`), den MySQL-Client erwartet er unter `/usr/bin/mysql` (in `config.json`
   änderbar).
9. Welche Zeichen CloudPanel selbst in Datenbank-Namen, Datenbank-Benutzern und Site-Usern annimmt.
   Die Muster der Console sind strenger, `_` in Datenbank-Namen ist angenommen (die Doku zeigt nur
   `-`).
10. Die Tabellen von `clpctl vhost-templates:list` (Spalten Name, Root Directory, Type) und
    `clpctl db:show:master-credentials` (Zeilen Host, User Name, Password, Port), gelesen wie die
    Community-Parser.
11. Ob CloudPanel (Panel und `clp-agent`) mit `hidepid` auf `/proc` weiter läuft.
12. Wie lange das Anlegen dauert, vor allem bei Node.js (CloudPanel lädt Node.js mit nvm herunter).
13. Ob CloudPanel beim Anlegen etwas nach `~/.ssh/authorized_keys` kopiert. Der Agent leert die
    Datei ohnehin.
14. Was ssh2 bei einem abgelehnten Host-Schlüssel genau meldet: geprüft nur gegen den SSH-Server im
    Test.

### Demo

Der Demo-Provider simuliert mit `ENABLE_DEMO_PROVIDER=true` und `ENABLE_DEMO_CLOUDPANEL=true` einen
CloudPanel-Server ("Demo CloudPanel", `web1.demo.weblion.example`, 203.0.113.10 und 2001:db8::10)
im Speicher, mit denselben Prüfungen und Fehlern wie der Agent. Den Server gibt es nicht, SFTP und
"Website öffnen" führen ins Leere. Mit `pnpm db:seed`:

- Muster AG hat ein Kontingent für 5 Websites und 10 Datenbanken (PHP, statisch, Node.js) und die
  Websites `www.muster-ag.example` (WordPress, PHP 8.3, mit Datenbank), `shop.muster-ag.example`
  (WooCommerce, Zertifikat läuft in 10 Tagen ab) und `api.muster-ag.example` (Node.js 22, kein
  Zertifikat).
- Alpen Hosting (Reseller) hat ein Kontingent für 20 Websites und 40 Datenbanken (PHP, statisch),
  daraus Bäckerei Huber 3 und 5, mit der statischen Website `baeckerei-huber.example` (selbst
  signiertes Zertifikat).
- Nicht verwaltet: `cp.weblion.demo` (geschützt, wie die Console selbst) und
  `legacy.kunde.example` (PHP 7.4), das sich im Admin-Bereich übernehmen lässt, weil Übernehmen aus
  der Console im Demo an ist.
- Der simulierte Server erlaubt Node.js, die Demo-Verbindung bietet es Kunden aber nicht an (ihre
  Einstellungen kommen aus der Umgebung, wie bei einer Verbindung aus der `.env`). Node.js-Websites
  legt weblion.one im Admin-Bereich an. Installiert sind PHP 8.5 bis 7.4, angeboten werden wie beim
  echten Server 8.3 und 8.4.
- Simuliertes DNS: verwaltete Websites zeigen auf den Server, Namen mit `nodns` haben keinen
  Eintrag, Namen mit `elsewhere` zeigen auf 198.51.100.7. Eine Datenbank mit `fail` im Namen
  scheitert, um den Hinweis beim Anlegen zu sehen.

## 3CX (Telefonie)

- API: die Configuration API von 3CX V20 ("XAPI"), ein OData-v4-Dienst unter `<Base URL>/xapi/v1`.
  Die Console folgt der offiziellen OpenAPI-Beschreibung (`swagger.yaml`, 3CX 20.0.10.1479) und dem
  offiziellen Tutorial-Repository von 3CX zur XAPI.
- Anmeldung: OAuth2 Client Credentials. Die Console holt mit Client-ID und API-Schlüssel an
  `POST <Base URL>/connect/token` ein Access-Token (Formular als `multipart/form-data`, wie im
  Tutorial) und schickt es als `Authorization: Bearer <Token>`.
- Lizenz: Die XAPI gibt es nur mit einer **3CX-Enterprise-Lizenz**. Lizenzen kaufen, verlängern oder
  wechseln geht nicht über die Console. Sie zeigt Edition, Ablauf und gleichzeitige Gespräche nur
  an.
- Konfiguration: nur im Admin-Bereich unter Provider > Provider hinzufügen > 3CX, eine Verbindung
  pro Telefonanlage. Variablen in der `.env` gibt es für 3CX nicht.
- 3CX liefert keine Server. Im Server-Inventar und in den Server-Filtern taucht der Provider deshalb
  nicht auf.

### Was das Modul macht

weblion.one betreibt 3CX-Telefonanlagen für Kunden. Das Modul **Telefonie** (`phone`) bringt sie in
die Console:

- **Telefonanlagen:** Jede 3CX-Verbindung liefert genau eine Telefonanlage. weblion.one weist sie
  einem Kunden zu, ein Reseller gibt sie an seine Kunden weiter. Eine Organisation kann mehrere
  Anlagen haben, z.B. eine pro Standort.
- **Übersicht:** Status, Version, Edition, Lizenz und Updates bis wann, laufende und erlaubte
  gleichzeitige Gespräche, Benutzer (mit Höchstzahl, wenn die Lizenz eine durchsetzt), angemeldete
  Nebenstellen, registrierte Leitungen, Länge der Nebenstellennummern und der Link "3CX öffnen" zum
  Webclient.
- **Benutzer und Nebenstellen:** Kunden legen Benutzer an (mit der nächsten freien Nummer oder einer
  eigenen), ändern Vorname, Nachname, E-Mail, Mobilnummer, ausgehende Rufnummer und Sprache, senden
  die Willkommens-E-Mail der Anlage erneut und löschen Benutzer.
- **Ringgruppen:** ansehen und Benutzer als Mitglieder hinzufügen oder entfernen.
- **Leitungen:** die SIP-Leitungen zu Telefonanbietern mit Status und Problemen, nur lesend.

In der Console unter dem Menüpunkt "Telefonie", sobald das Modul aktiv ist: eine Karte pro Anlage,
jede mit den Tabs Übersicht, Benutzer, Ringgruppen und Leitungen. Das Dashboard der Organisation
zeigt die Zahl der Anlagen.

Gespeichert werden nur die Telefonanlagen mit ihren Fakten (Tabelle `phone_systems`). Benutzer,
Ringgruppen und Leitungen liest die Console live bei der Anlage. Passwörter, PINs, SIP-Zugangsdaten,
Provisioning-Links und den Lizenzschlüssel liest, setzt und zeigt sie nie.

Wer darf was:

| Wer                           | Darf                                                                                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner, Admin                  | Anlagen umbenennen, Benutzer anlegen, ändern, löschen, Ringgruppen ändern (`phone:write`), Willkommens-E-Mail senden und E-Mail-Adresse ändern (`phone:credentials`) |
| Member, Nur lesen             | Anlagen, Benutzer, Ringgruppen und Leitungen ansehen (`phone:read`)                                                                                                  |
| Eingeschränkt, Buchhaltung    | nichts, per Policy erweiterbar (Ressource `phone/<id>`, `org` oder `*`)                                                                                              |
| API-Token "Lesen & Schreiben" | was die Person darf, der das Token gehört, aber ohne `phone:credentials`: Benutzer anlegen geht (auch mit Willkommens-E-Mail), erneut senden und E-Mail ändern nicht |
| Mitarbeitende eines Resellers | im Panel seiner Kunden, was ihre Reseller-Rolle erlaubt, dazu Telefonanlagen aus dem eigenen Bestand an Kunden geben (`reseller:customer:write`)                     |
| weblion.one Superadmin        | alles, dazu Anlagen zuweisen (`platform:server:assign`) und geschützte Benutzer löschen oder ihre E-Mail ändern (`platform:provider:write`)                          |
| weblion.one Support           | alles ansehen, nichts ändern                                                                                                                                         |

`phone:credentials` ist ein eigenes Recht, weil die Willkommens-E-Mail den Zugang zur Nebenstelle
enthält (Webclient, App). Wer sie erneut sendet oder die Adresse ändert, an die sie geht, gibt die
Nebenstelle weiter, ähnlich wie "Passwort neu setzen" bei Nextcloud. Mit dem Pfad `phone/<id>` lässt
sich eine Person auf die Anlage eines Standorts beschränken. Benutzer, Ringgruppen und Leitungen
haben keinen eigenen Pfad.

**Geschützte Benutzer:** Administratoren der Anlage (Rollen `system_owners` und `system_admins`),
Systembenutzer (Fax-Server, Weckdienst, Service Principal, KI-Agent) und Benutzer, deren Rolle die
Anlage nicht meldet: Nur weblion.one löscht sie oder ändert ihre E-Mail-Adresse. Kunden sehen sie
mit einem Hinweis.

Den Produktcode von 3CX sieht nur weblion.one, Kunden sehen Edition, Lizenz und gleichzeitige
Gespräche.

### Voraussetzungen

1. **3CX V20 mit Enterprise-Lizenz**, erreichbar unter `https://` mit einem gültigen, öffentlichen
   Zertifikat, z.B. `https://muster.3cx.ch` oder `https://pbx.kunde.ch:5001`. Einen Schalter "TLS
   nicht prüfen" gibt es nicht, Anlagen mit privatem Zertifikat gehen also nicht. Weiterleitungen
   folgt die Console nicht, damit Schlüssel und Token nie an einen anderen Host gehen.
2. **Ein eigener API-Client nur für weblion.one.** In der Admin-Konsole der 3CX unter
   Integrationen > API > Hinzufügen:
   - eine Client-ID wählen, z.B. `weblion` (Buchstaben, Ziffern, Punkt, Binde- und Unterstrich,
     höchstens 64 Zeichen). Die Client-ID belegt einen Eintrag im Nummernraum der Anlage.
   - "XAPI Access Enabled" einschalten
   - die Standardgruppe und die Rolle **System Admin** wählen (System Owner geht auch). Mit einer
     Rolle, die nur eine Gruppe sieht, fehlen vermutlich Benutzer (nicht geprüft). Darf die Rolle
     einen Bereich gar nicht lesen, sagt "Verbindung testen", welchen.
   - den API-Schlüssel kopieren. 3CX zeigt ihn nur einmal.

   Den API-Client in keinem anderen Programm verwenden: 3CX lässt pro Client nur ein gültiges Token
   zu, ein neues Token macht das vorherige ungültig. Zwei Programme mit demselben Client nehmen sich
   das Token bei jeder Anfrage gegenseitig weg.

3. **Ein API-Prozess der Console.** Aus demselben Grund hält die Console pro Anlage ein Token im
   Speicher des Prozesses. Laufen mehrere API-Prozesse, holen sie sich das Token reihum weg. Die
   Installation mit Docker Compose hat einen Prozess, siehe
   [deployment.md](deployment.md#3cx-für-telefonie).
4. **E-Mail-Versand in der 3CX.** Die Willkommens-E-Mail verschickt die Anlage selbst, nicht die
   Console. Ohne funktionierenden Mailserver in der 3CX kommt sie nicht an.
5. **Sperren nach Fehlversuchen:** 3CX sperrt IPs nach fehlgeschlagenen Anmeldungen. Ob das auch für
   `/connect/token` gilt, ist nicht geprüft. Nach einer abgelehnten Anmeldung versucht es die
   Console deshalb 60 Sekunden lang nicht wieder, auch der Sync nicht. Ein falscher Schlüssel ergibt
   so höchstens eine abgelehnte Anmeldung pro Minute.

### Konfiguration

Admin > Provider > Provider hinzufügen, Typ 3CX:

- **Adresse der Telefonanlage:** `https://` mit Port, falls nicht 443, ohne Pfad. `/xapi/v1` hängt
  die Console selbst an. Unter dieser Adresse öffnen auch die Kunden den Webclient.
- **Client-ID** des API-Clients
- **API-Schlüssel** (mindestens 8 Zeichen). Beim Bearbeiten behält ein leeres Feld den
  gespeicherten. Vom Schlüssel zeigt die Console kein Zeichen, er verwaltet die ganze Anlage.

"Verbindung testen" meldet sich an und liest nacheinander Systemparameter, Systemstatus, Benutzer,
Ringgruppen und Leitungen. Fehlt der Rolle ein Bereich (HTTP 403), nennt die Meldung ihn. Das
Ergebnis zeigt Version, FQDN, Edition, Zahl der Benutzer, Nummernlänge und ob die Lizenz aktiv ist.
Antwortet die Anlage ohne JSON (z.B. mit ihrer Weboberfläche), ist die XAPI nicht verfügbar:
Adresse, Enterprise-Lizenz und "XAPI Access Enabled" prüfen.

Die Seite des Providers zeigt Version, FQDN, Edition mit Produktcode, Lizenz und Updates bis,
gleichzeitige Gespräche, Benutzer, angemeldete Nebenstellen, registrierte Leitungen, Nummernlänge
und den Webclient, dazu einen Link auf die Seite "Telefonanlagen".

### Mehrere Anlagen

- Jede Telefonanlage ist ein eigener Provider vom Typ 3CX. Die zehnte legt man an wie die erste.
  Token, Zwischenspeicher und Anfrage-Slots gehören zur Verbindung, zwei Anlagen teilen nie etwas.
- Eine Anlage gehört genau einer Organisation, jede 3CX ist also "dediziert". Eine 3CX im
  Multi-Company-Modus für mehrere Kunden unterstützt die Console nicht.
- Eine Organisation kann beliebig viele Anlagen haben, z.B. Zürich und Bern. Nichts in der Console
  geht von "der" Anlage eines Kunden aus.
- Die Anlage heisst zuerst wie ihr FQDN. Kunden (`phone:write`) und weblion.one benennen sie in der
  Console um, z.B. in "Zürich". Das ändert an der 3CX nichts, danach folgt der Name dem FQDN nicht
  mehr.
- Eine neue Adresse im Formular behält Zeile und Zuweisung (die Anlage hat immer die ID `pbx`).
  Zieht ein Kunde auf eine neue 3CX um, legt weblion.one dafür eine neue Verbindung an, weist deren
  Anlage dem Kunden zu und löst die alte.
- Ein Provider lässt sich nicht löschen, solange seine Anlage einem Kunden zugewiesen ist.

### Zuweisen

Admin > Telefonanlagen: alle Anlagen aller 3CX-Verbindungen mit Status, Version, Edition, Lizenz,
Benutzern und Leitungen, Filter nach Verbindung, Zuweisung und Kunde, Suche nach Name, Adresse oder
ID. "Zuweisen" (`platform:server:assign`) gibt eine Anlage einem Kunden und schaltet bei ihm das
Modul "Telefonie" ein. Bei einem Kunden eines Resellers geht das nur, wenn der Reseller das Modul
hat (sonst 409). "Zuweisung entfernen" ändert an der Anlage und ihren Benutzern nichts. Im Audit-Log
stehen `phone.system_assign` und `phone.system_unassign`. Per API nur mit Login:
`POST /api/v1/admin/phone-systems/<id>/assign` mit `{"orgId": "<org-id>", "enableModule": true}`,
`{"orgId": null}` löst die Zuweisung.

Reseller geben eine Anlage aus ihrem Bestand unter Reseller > Meine Kunden > Kunde > Ressourcen an
einen Kunden weiter und nehmen sie zurück. Der Reseller braucht dafür das Modul, der Kunde bekommt
es. Per API: `POST /api/v1/orgs/<reseller-id>/customers/<customer-id>/resources` mit
`{"type": "phone_system", "id": "<id>"}`, zurück mit `.../resources/release`. Ein Kunde mit
Telefonanlagen lässt sich nicht löschen.

### Benutzer und Nebenstellen

Telefonie > Anlage > Benutzer zeigt Nebenstelle, Name, E-Mail, Mobilnummer, ausgehende Rufnummer,
Rolle und ob ein Gerät angemeldet ist. "Benutzer anlegen":

- **Nebenstelle:** Die Länge kommt aus der Einstellung `ENL` der Anlage, z.B. 3 Ziffern. Meldet die
  Anlage keine, gelten 2 bis 10 Ziffern. Der Dialog schlägt die nächste freie Nummer der Anlage vor.
  Bleibt das Feld leer, wählt die Anlage selbst. Die Nummer lässt sich später nicht ändern, wer eine
  andere will, löscht den Benutzer und legt ihn neu an.
- **Vorname** (Pflicht) und **Nachname**, je höchstens 50 Zeichen
- **E-Mail** (Pflicht): An diese Adresse schickt die Anlage die Zugangsdaten.
- **Mobilnummer** und **ausgehende Rufnummer** (die Nummer, die Angerufene sehen, leer: die
  Einstellung der Leitung): Ziffern, optional mit führendem `+`, 3 bis 20 Stellen. Leerzeichen,
  Punkte, Binde- und Schrägstriche und Klammern entfernt die Console.
- **Sprache:** Deutsch, Englisch, Französisch, Italienisch oder der Standard der Anlage
- **Willkommens-E-Mail senden** (Standard an)

Vorher prüft die Console die Länge und ob ein Benutzer die Nummer schon hat. Nummern teilen sich
aber einen Nummernraum mit Ringgruppen, Warteschlangen, Zentralen, Leitungen und dem API-Client: Die
Antwort der Anlage gilt (409, wenn die Nummer vergeben ist). Erzwingt die Lizenz eine Höchstzahl an
Benutzern und ist sie erreicht, antwortet die Console mit 409 `phone_user_limit`. 3CX lizenziert
sonst nach gleichzeitigen Gesprächen, nicht nach Benutzern.

Scheitert nur die Willkommens-E-Mail, ist der Benutzer trotzdem angelegt. Die Antwort sagt das
(`welcomeSent: false`, `welcomeError`), und im Audit-Log steht `phone.user_welcome` mit
`status: failure`. Per API:

```bash
curl -X POST -H "Authorization: Bearer wlc_…" -H "Content-Type: application/json" \
  -d '{"firstName":"Anna","lastName":"Muster","email":"anna@muster.ch","sendWelcome":true}' \
  https://cp.weblion.cloud/api/v1/phone-systems/<id>/users
```

Die Antwort ist `{ "user": { ... }, "welcomeSent": true, "welcomeError": null }`. Ein Token darf die
Willkommens-E-Mail beim Anlegen auslösen, wie eine Einladung bei Nextcloud: Sie geht an die Adresse,
die es selbst angibt.

**Ändern:** Die Console schickt nur Felder, die sich wirklich ändern, ein leeres Feld löscht den
Wert. Eine neue E-Mail-Adresse braucht `phone:credentials` und einen Login. Im Audit-Log steht
`phone.user_update` mit altem und neuem Wert. Per API:
`PATCH /api/v1/phone-systems/<id>/users/<userId>` mit z.B. `{"mobile": "+41791234567"}`.

**Willkommens-E-Mail erneut senden** (`phone:credentials`, nur mit Login, nie per API-Token): Die
Anlage schickt die Zugangsdaten noch einmal an die Adresse des Benutzers. Ohne Adresse 400. Im
Audit-Log steht `phone.user_welcome`. Per API mit Session:
`POST /api/v1/phone-systems/<id>/users/<userId>/welcome`.

**Löschen** verlangt die Nebenstellennummer als Bestätigung. Die Nebenstelle verschwindet mit ihren
Einstellungen, auch aus den Ringgruppen. Ob Voicemails, Aufnahmen und Ansagen bleiben, hängt von der
3CX ab. Benutzer, die die 3CX nicht löschen lässt (z.B. den Fax-Server), lehnt sie mit 409 ab. Im
Audit-Log steht `phone.user_delete`. Per API: `DELETE /api/v1/phone-systems/<id>/users/<userId>` mit
`{"confirm": "<Nebenstelle>"}`.

Rollen, Gruppen (Abteilungen), Weiterleitungen und Passwörter der Benutzer ändert die Console nie.
Neue Benutzer landen vermutlich in der Standardgruppe der Anlage mit deren Standardrolle (siehe
Offene Punkte).

### Ringgruppen und Leitungen

**Ringgruppen** zeigen Nummer, Name, Strategie (der Reihe nach, alle gleichzeitig, Durchsage),
Klingeldauer und die Mitglieder in ihrer Reihenfolge. "Mitglied hinzufügen" nimmt nur Benutzer der
Anlage (sonst 400) und hängt sie ans Ende, ein bestehendes Mitglied bleibt, wie es ist. Die XAPI
ersetzt die Mitgliederliste immer als Ganzes: Die Console liest die Gruppe direkt vor dem Schreiben
und ändert pro Gruppe eins nach dem anderen. Was jemand zwischen Lesen und Schreiben im
3CX-Webclient an derselben Gruppe ändert, geht verloren. Neue Ringgruppen, Strategien und Zeiten
richtet man im Webclient ein. Im Audit-Log stehen `phone.ring_group_member_add` und
`phone.ring_group_member_remove`. Per API:
`POST /api/v1/phone-systems/<id>/ring-groups/<groupId>/members` mit `{"number": "101"}`,
`DELETE .../members/101`.

**Leitungen** sind nur lesbar: Nummer, Name des Anbieters, Host, online oder offline, Richtung,
externe Nummer, gleichzeitige Gespräche, Zahl der Durchwahlen und das Problem, das die Anlage
meldet. SIP-Zugangsdaten liest die Console nicht. Leitungen ändert weblion.one in der 3CX.

### Sync

- Pro Sync-Lauf (alle `SYNC_INTERVAL_SECONDS`) und Anlage: der Systemstatus und alle 10 Minuten die
  Systemparameter, dazu ein Token, wenn das alte abgelaufen ist. Benutzer, Ringgruppen und Leitungen
  synchronisiert die Console nicht.
- Daraus entsteht der Status: **Fehler**, wenn die Anlage nicht erreichbar, nicht aktiviert oder die
  Lizenz inaktiv oder abgelaufen ist. **Warnung**, wenn die Lizenz in weniger als 30 Tagen abläuft,
  Updates und Support abgelaufen sind, Dienste der Anlage nicht laufen, eine Leitung nicht
  registriert ist oder die Benutzergrenze erreicht ist.
- Eine neue Anlage ist nicht zugewiesen. Ist die Anlage nicht erreichbar, behält sie ihre Fakten,
  ihr Status wird "Fehler" (nicht erreichbar), und der Provider bekommt den Fehler. Eine Anlage, die
  die Verbindung nicht mehr meldet, gilt als "nicht mehr gefunden" und behält ihren Kunden.
- Die Seite einer Anlage liest die Fakten live (höchstens 30 Sekunden alt) und speichert sie. Klappt
  das nicht, zeigt sie die gespeicherten mit einem Hinweis.
- Von Hand: Admin > Telefonanlagen > Synchronisieren, oder Admin > Provider > 3CX > "Jetzt
  synchronisieren".

Live-Daten hält die Console kurz im Speicher, damit viele Leute auf der Seite die Anlage nicht
überlasten: Benutzer 20 Sekunden, Ringgruppen und Systemstatus 30 Sekunden, Leitungen 60 Sekunden,
Systemparameter 10 Minuten. Änderungen über die Console leeren den betroffenen Speicher, Änderungen
direkt in der 3CX erscheinen nach dieser Zeit. Pro Anlage laufen höchstens vier Anfragen
gleichzeitig, jede mit 20 Sekunden Timeout (Token 15 Sekunden). Ein 401 holt einmal ein neues Token,
ein 429 mit `Retry-After` bis 5 Sekunden wird einmal wiederholt.

### Was die Console nutzt

Pfade relativ zu `/xapi/v1`, ausser dem Token.

| Funktion in der Console | Endpunkt                                                                                                              | Berechtigung                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Anmeldung               | `POST <Base URL>/connect/token` mit `client_id`, `client_secret`, `grant_type=client_credentials`                     | intern                                                               |
| Verbindungstest         | `GET /Defs/Pbx.GetSystemParameters()`, `GET /SystemStatus`, je ein Eintrag von `GET /Users`, `/RingGroups`, `/Trunks` | Admin-Bereich                                                        |
| Fakten, Sync, Übersicht | `GET /SystemStatus?$select=...`, `GET /Defs/Pbx.GetSystemParameters()`                                                | Sync-Job, `phone:read`                                               |
| Benutzer ansehen        | `GET /Users?$select=...&$expand=Groups(...)&$orderby=Number&$top=100&$skip=…&$count=true`, `GET /Users(<id>)`         | `phone:read`                                                         |
| Nächste freie Nummer    | `GET /Users/Pbx.GetFirstAvailableExtensionNumber()`                                                                   | `phone:write`                                                        |
| Benutzer anlegen        | `GET /Users(Number='<Nummer>')` (vergeben?), `POST /Users`                                                            | `phone:write`                                                        |
| Benutzer ändern         | `PATCH /Users(<id>)` nur mit den geänderten Feldern                                                                   | `phone:write`, E-Mail mit `phone:credentials`                        |
| Benutzer löschen        | `DELETE /Users(<id>)`                                                                                                 | `phone:write`                                                        |
| Willkommens-E-Mail      | `POST /Users(<id>)/Pbx.SendWelcomeEmail`                                                                              | beim Anlegen `phone:write`, sonst `phone:credentials`, nur mit Login |
| Ringgruppen             | `GET /RingGroups?$select=...&$expand=Members`, `GET /RingGroups(<id>)`                                                | `phone:read`                                                         |
| Mitglieder ändern       | `PATCH /RingGroups(<id>)` mit der ganzen Liste `{"Members": [{"Number": "100"}, ...]}`                                | `phone:write`                                                        |
| Leitungen               | `GET /Trunks?$select=...`                                                                                             | `phone:read`                                                         |
| API Explorer            | Pfade unter `/xapi/v1` ausser Token und API-Client der Console                                                        | `platform:explorer`, nur mit Login                                   |

`$select` ist hier eine Sicherheitsgrenze: Ohne ihn liefert die XAPI SIP-Passwörter, das Passwort
für den Webclient, die Voicemail-PIN und den Lizenzschlüssel mit. Jede Anfrage der Console nennt
ihre Felder deshalb einzeln, und aus der Antwort auf `POST /Users`, die den ganzen neuen Benutzer
enthält, liest sie nur `Id` und `Number`. Listen liest sie in Seiten zu 100 mit `$count=true`,
sortiert nach Nummer (die XAPI hat keine Folgelinks), und bricht ab, wenn die Anlage `$skip`
ignoriert. Die Rolle eines Benutzers kommt über ein verschachteltes `$expand`. Lehnt die Anlage das
ab (400), liest die Console ohne Rollen weiter, alle Benutzer gelten dann als geschützt.

Die Felder stammen aus der Beschreibung von 3CX 20.0.10. Ältere Builds von V20 kennen manche davon
nicht (z.B. `HasNotRunningServices`, `Tags`) und antworten mit 400. Dann die Anlage aktualisieren.

### Fehler der API

Fehler kommen wie überall in der API als `{ "error": { "code", "message", "details" } }`. Für
Telefonie:

| HTTP | `code`             | Wann                                                                                                                                                                                                                                                                                           |
| ---- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | `bad_request`      | Ungültige Eingabe (`details` nennt das Feld), Nebenstelle mit falscher Länge, Löschen ohne die Nebenstelle als Bestätigung, Willkommens-E-Mail ohne Adresse, Mitglied einer Ringgruppe, das kein Benutzer ist, Werte, die die Anlage ablehnt (`3CX: ...`, `details` mit Feld und Code von 3CX) |
| 403  | `forbidden`        | Recht fehlt, Kunde gesperrt (nur lesen), Willkommens-E-Mail oder neue E-Mail-Adresse mit API-Token, geschützter Benutzer für Kunden                                                                                                                                                            |
| 404  | `not_found`        | Anlage oder Organisation gibt es nicht oder die Person sieht sie nicht (auch bei abgeschaltetem Modul), Nebenstelle ist kein Mitglied der Ringgruppe                                                                                                                                           |
| 404  | `provider_error`   | Die Anlage kennt den Benutzer oder die Ringgruppe nicht (mehr)                                                                                                                                                                                                                                 |
| 409  | `conflict`         | Nebenstelle vergeben, die Anlage lässt einen Benutzer nicht löschen (z.B. den Fax-Server), Reseller ohne Modul, Kunde oder Provider löschen, solange Anlagen zugewiesen sind                                                                                                                   |
| 409  | `phone_user_limit` | Die Lizenz erlaubt keine weiteren Benutzer                                                                                                                                                                                                                                                     |
| 422  | `unsupported`      | Der Provider kann die Funktion nicht                                                                                                                                                                                                                                                           |
| 502  | `provider_error`   | Die Anlage hat abgelehnt oder war nicht erreichbar, `message` mit dem Text von 3CX, HTTP-Status und Hinweisen zu Anmeldung und Rolle                                                                                                                                                           |

Jede Änderung steht im Audit-Log, gescheiterte mit `status: failure` und der Meldung. Passwörter und
PINs stehen nie darin.

### API Explorer

Für alles ohne eigenen Button: Admin > API Explorer, Provider 3CX wählen.

- Pfade relativ zu `/xapi/v1`, z.B. `/Users?$select=Id,Number,FirstName&$top=10` oder
  `/SystemStatus`. Base URL und `/xapi/v1` davor sind erlaubt. Vorlagen: Systemstatus,
  Systemparameter, Benutzer, nächste freie Nebenstelle, Ringgruppen, Leitungen, laufende Gespräche.
- GET und DELETE senden das JSON-Feld als Query (Listen mit Komma), POST und PATCH als JSON. PUT
  lehnt die Console ab, 3CX ändert mit PATCH.
- Gesperrt sind `..`, `//`, `\`, `@`, `#` und kodierte Punkte oder Schrägstriche, der
  Token-Endpunkt, `Pbx.GenerateAppToken`, `Pbx.APIToken` und Änderungen an `ServicePrincipals` (der
  API-Client der Console selbst).
- In Antworten sind Passwörter, Secrets, Tokens, Tickets, der Lizenzschlüssel, PINs, `AuthID` und
  Provisioning-Links ausgeblendet. Token und API-Schlüssel der Console stehen nie darin.
- Ändernde Requests stehen mit Pfad und Body im Audit-Log (`provider.explorer`), Werte von `AuthID`,
  `AuthPassword`, `VMPIN`, Lizenzschlüssel, Tickets und Provisioning-Links ausgeblendet.
- Was über den Explorer geändert wird, prüft die Console nicht (z.B. geschützte Benutzer). Die
  Anlage setzt ihre eigenen Regeln trotzdem durch.

### Grenzen

- **Sperren:** Ein gesperrter Kunde sieht seine Anlagen in der Console nur noch lesend. Die Anlage
  läuft weiter, die Leute telefonieren weiter. Ebenso lassen ein abgeschaltetes Modul und eine
  gelöste Zuweisung die Anlage unberührt.
- **Abrechnung:** Eine Telefonanlage lässt sich noch nicht mit einem Dienst verknüpfen. Die Anlage
  wird mit einem Dienst ohne Ressource abgerechnet, siehe [Roadmap](roadmap.md#telefonie-3cx).
- **Lizenzen** kauft und verlängert weblion.one ausserhalb der Console.
- **Nicht in der Console**, das geht im 3CX-Webclient: Benutzer aktivieren und deaktivieren, Rollen
  und Abteilungen, Weiterleitungen und Profile, Warteschlangen, digitale Rezeption, eingehende
  Regeln und Durchwahlen, Leitungen einrichten, neue Ringgruppen, Anrufliste, Aufnahmen, Telefone
  provisionieren.
- **Ein API-Prozess** wegen des einen Tokens pro API-Client (siehe Voraussetzungen).
- **Kein privates Zertifikat** und kein Multi-Company-Modus (eine Anlage für mehrere Kunden)
- **Nebenstellennummern** lassen sich nicht ändern, nur löschen und neu anlegen.
- **Keine Benachrichtigung**, wenn eine Anlage ausfällt oder die Lizenz bald abläuft. Die Liste im
  Admin-Bereich zeigt es.

Ideen dazu in der [Roadmap](roadmap.md).

### Offene Punkte

Gegen eine echte 3CX ist die Anbindung noch nicht getestet, nur gegen einen Mock-Server nach der
offiziellen OpenAPI-Beschreibung der XAPI (3CX 20.0.10.1479) und dem offiziellen Tutorial-Repository
von 3CX. Vor dem ersten Kunden mit einer 3CX V20 (Enterprise-Testlizenz) prüfen, jeweils mit der
Annahme, nach der die Console heute arbeitet:

1. Ob `/connect/token` auch `application/x-www-form-urlencoded` annimmt. Die Console schickt
   `multipart/form-data` wie das Tutorial.
2. Wie lange ein Token gilt (`expires_in`). Die Console nutzt es bis 60 Sekunden vor Ablauf.
3. Mit welchem HTTP-Status 3CX eine abgelehnte Anmeldung (400 oder 401) und ein abgelaufenes Token
   (401) meldet. Die Console wertet jeden 4xx beim Token als Ablehnung und holt bei 401 einmal ein
   neues Token.
4. Ob die Anlage Seiten begrenzt oder `@odata.nextLink` schickt. Die Console blättert mit `$count`.
5. Wo die Codes `WARNINGS.*` in Fehlern stehen (`code`, `message` oder `details`) und welcher
   HTTP-Status zu welchem Fehler gehört. Die Console sucht überall.
6. Die Namen der Rollen (`system_owners`, `system_admins`, ...) und welche Rolle für welche Anfrage
   mindestens nötig ist. Die Console verlangt System Admin für alles.
7. Ob das verschachtelte `$expand=Groups($select=GroupId;$expand=Rights($select=RoleName))` geht.
   Ohne liest die Console keine Rollen (alle Benutzer geschützt).
8. Ob `PATCH /RingGroups(<id>)` mit `Members` die Liste ersetzt und `{ "Number": ... }` pro Mitglied
   reicht
9. Ob `ENL` die Zahl der Ziffern von Benutzer-Nebenstellen ist, und was `ENLRange` bedeutet (die
   Console ignoriert es)
10. Ob `POST /Users` ohne `Number` die nächste freie Nummer vergibt
11. Ob `GET /Users(Number='<n>')` für eine freie Nummer mit 404 antwortet
12. Ob `POST /Users` die Willkommens-E-Mail schon selbst verschickt. Dann bekämen neue Benutzer
    zwei.
13. Was die Willkommens-E-Mail enthält (Passwort oder Link zum Setzen)
14. Ob `null` in einem PATCH ein Feld leert (3CX kennt `WARNINGS.XAPI.CAN_NOT_BE_EMPTY_STRING`)
15. Das Format der Sprache eines Benutzers. Die Console schickt `de`, `en`, `fr` oder `it`.
16. Die Zuordnung der Edition: weder `IsEnterprise` noch `IsProfessional` gilt als Standard.
17. Ob `MaxUserExtensions` nur mit `IsExtensionLimitEnforcementEnabled` eine Grenze ist
18. Der Code, mit dem 3CX einen weiteren Benutzer über der Grenze ablehnt (angenommen
    `WARNINGS.LIMIT_REACHED`)
19. Was mit Voicemails, Aufnahmen und Ansagen eines gelöschten Benutzers passiert
20. Die Adresse des Webclients, `https://<Adresse>/webclient/` (Link "3CX öffnen")
21. Ob die XAPI Anfragen bremst und mit 429 antwortet
22. Ob die Sperre nach Fehlversuchen auch `/connect/token` betrifft
23. Was eine Anlage ohne Enterprise-Lizenz auf `/connect/token` und `/xapi/v1` antwortet
24. Ob neue Benutzer ohne `Groups` in der Standardgruppe mit der Rolle `users` landen
25. Ob `/Users` Service Principals (den API-Client der Console) enthält

### Demo

Der Demo-Provider (`ENABLE_DEMO_PROVIDER=true`) simuliert drei Telefonanlagen im Speicher, mit
denselben Prüfungen wie die echte Anbindung (Nummernlänge, vergebene Nummern, Benutzergrenze,
Fax-Server). Die Adressen `pbx-zuerich.demo.weblion.one` usw. gibt es nicht, "3CX öffnen" führt ins
Leere. Mit `pnpm db:seed`:

- Muster AG hat das Modul und zwei Anlagen: **Zürich** (Enterprise, 16 Gespräche, dreistellige
  Nummern, Benutzer 100 bis 105 mit Anna als System Owner und einem Fax-Benutzer, Ringgruppen 800
  Zentrale und 801 Support, zwei Leitungen) und **Bern** (Professional, 8 Gespräche, die Leitung
  "Peoplefone Bern" ist offline mit "Registration failed: 403 Forbidden", also Status Warnung).
- **Lab** (`pbx-lab.demo.weblion.one`) ist keinem Kunden zugewiesen, zum Ausprobieren im
  Admin-Bereich: Standard, vierstellige Nummern, die Lizenz läuft in 10 Tagen ab, und sie erlaubt 10
  Benutzer, von denen 9 bestehen.

## Uptime Kuma (Monitoring)

- Lesen: der Prometheus-Endpunkt `GET <Base URL>/metrics` von Uptime Kuma mit einem API-Schlüssel
  (HTTP Basic, der Schlüssel ist das Passwort) und die öffentlichen Statusseiten
  (`/api/status-page/<slug>` und `/api/status-page/heartbeat/<slug>`) ohne Anmeldung. Das ist die
  dokumentierte Oberfläche von Uptime Kuma, sie ändert sich mit Updates kaum.
- Verwalten: Eine REST-API für Monitore hat Uptime Kuma nicht. Anlegen, ändern, pausieren,
  fortsetzen, löschen, die langen Verläufe und die Konfiguration laufen deshalb über die
  Socket.IO-Events der Weboberfläche von Uptime Kuma, und nur, wenn weblion.one die Instanz für die
  Verwaltung angemeldet hat. Diese Events sind nicht als API dokumentiert und können sich mit jedem
  Update ändern (siehe unten).
- Version: **Uptime Kuma 2.x**, ab 2.1 mit Uptime und durchschnittlicher Antwortzeit in `/metrics`.
  Die Console folgt dem Quellcode von 2.5.6 (für Unterschiede 2.0.0 und 1.23).
- Konfiguration: `UPTIMEKUMA_URL` und `UPTIMEKUMA_API_KEY` (optional `UPTIMEKUMA_SESSION_TOKEN`) in
  der `.env` oder im Admin-Bereich unter Provider > Provider hinzufügen > Uptime Kuma
- Uptime Kuma liefert keine Server. Im Server-Inventar und in den Server-Filtern taucht der Provider
  deshalb nicht auf.

### Was das Modul macht

weblion.one betreibt Uptime Kuma und überwacht damit Websites und Dienste von Kunden. Das Modul
**Monitoring** (`monitoring`) bringt das in die Console:

- **Monitore pro Kunde:** Der Sync holt alle Monitore einer Instanz. weblion.one weist sie Kunden
  zu, ein Reseller gibt sie an seine Kunden weiter.
- **Status und Zahlen:** Kunden sehen Status (erreichbar, ausgefallen, ausstehend, Wartung,
  pausiert), Uptime über 24 Stunden und 30 Tage, aktuelle und durchschnittliche Antwortzeit und wie
  lange das Zertifikat noch gilt.
- **Verlauf:** Die Detailseite zeigt ein Diagramm der Antwortzeit über 24 Stunden, 7 und 30 Tage
  (mit Verwaltung) oder die letzten 100 Prüfungen (für Monitore auf der Statusseite des Kunden),
  dazu mit Verwaltung die letzten Statuswechsel mit der Meldung von Uptime Kuma und die
  Konfiguration.
- **Eigene Monitore:** Mit einem Kontingent auf einer angemeldeten Instanz legen Kunden selbst
  Monitore an (HTTP(S), Keyword, Ping, Port), ändern, pausieren, setzen sie fort und löschen sie.
- **Statusseite:** Ist eine Statusseite von Uptime Kuma mit der Organisation verknüpft, verlinkt die
  Console sie.
- **Auf Server- und Domain-Seiten:** Monitore derselben Organisation, die eine Adresse oder den
  rDNS-Namen eines Servers bzw. die Domain oder eine Subdomain prüfen, erscheinen dort mit ihrem
  Status (nur exakte Namen, keine DNS-Abfrage, ausgefallene zuerst, höchstens 20).

In der Console unter dem Menüpunkt "Monitoring", sobald das Modul aktiv ist. Gespeichert werden die
Monitore mit Typ, Ziel, Intervall und den letzten Zahlen (Tabelle `monitors`), die Kontingente
(`monitor_allowances`) und die Verknüpfungen der Statusseiten (`monitor_status_pages`). Verläufe,
Statuswechsel und die Konfiguration liest die Console live. Geheimnisse der Monitore (Passwörter für
Basic Auth, Header, Bodys, Tokens) liest sie zwar mit der Konfiguration, behält sie aber nie und
zeigt sie nirgends.

Wer darf was:

| Wer                           | Darf                                                                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner, Admin                  | eigene Monitore anlegen, ändern, pausieren, fortsetzen (`monitor:write`) und löschen (`monitor:delete`)                                                                            |
| Member                        | ansehen, eigene Monitore anlegen, ändern, pausieren und fortsetzen, nicht löschen                                                                                                  |
| Nur lesen                     | Monitore, Status, Uptime und Verlauf ansehen (`monitor:read`)                                                                                                                      |
| Eingeschränkt, Buchhaltung    | nichts, per Policy erweiterbar (Ressource `monitor/<id>`, Anlegen braucht `org` oder `*`)                                                                                          |
| API-Token "Lesen & Schreiben" | was die Person darf, der das Token gehört. In diesem Modul gibt es keine Geheimnisse, also keine Ausnahme                                                                          |
| Mitarbeitende eines Resellers | im Panel seiner Kunden, was ihre Reseller-Rolle erlaubt, dazu Monitore aus dem eigenen Bestand weitergeben und Kunden einen Teil des Kontingents geben (`reseller:customer:write`) |
| weblion.one Superadmin        | alles, dazu Monitore zuweisen (`platform:server:assign`), Kontingente und Statusseiten (`platform:org:write`), die Anmeldung für die Verwaltung (`platform:provider:write`)        |
| weblion.one Support           | alles ansehen, nichts ändern                                                                                                                                                       |

Ändern lassen sich nur Monitore, die in der Console angelegt wurden (Herkunft "Console"). Monitore,
die weblion.one in Uptime Kuma angelegt hat (Herkunft "Uptime Kuma"), sind für alle nur lesbar (409
`read_only_monitor`). Löschen lassen sie sich in der Console erst, wenn Uptime Kuma sie nicht mehr
meldet, und dann nur aus der Console.

### Voraussetzungen

1. **Eigene Instanz von Uptime Kuma 2.x**, am besten auf einer eigenen kleinen VM, nicht auf dem
   Server der Console: Die Monitore der Kunden laufen von dort aus. Für Uptime und
   Durchschnittswerte in `/metrics` 2.1 oder neuer. Uptime Kuma 1.23 lehnt die Console ab
   (`/metrics` hat dort keine Monitor-IDs). Mit Uptime Kuma 3.x (Beta) funktioniert das Lesen, die
   Verwaltung nicht (die Anmeldung über den Socket gibt es dort nicht mehr).
2. **Erreichbarkeit:** Die Console braucht `/metrics` und die Statusseiten über HTTP(S), für die
   Verwaltung zusätzlich einen Websocket auf `/socket.io/`. Ein Reverse Proxy vor Uptime Kuma darf
   `/metrics` nicht sperren und muss Websockets durchlassen (das braucht die Weboberfläche von
   Uptime Kuma ohnehin). Uptime Kuma läuft ohne Pfad, die Base URL ist also nur die Adresse, z.B.
   `https://status.weblion.one`. Weiterleitungen folgt die Console nicht. `http://` geht, dann aber
   nur in einem privaten Netz: Schlüssel und Token gingen sonst unverschlüsselt über das Netz.
3. **API-Schlüssel:** In Uptime Kuma unter Einstellungen > API-Schlüssel einen Schlüssel **ohne
   Ablaufdatum** nur für weblion.one anlegen und kopieren (Uptime Kuma zeigt ihn einmal, er sieht
   aus wie `uk3_…`). Achtung: Mit dem **ersten** API-Schlüssel nimmt `/metrics` keine Anmeldung mit
   Benutzername und Passwort mehr an. Ein bestehender Prometheus, der so abfragt, bekommt danach 401
   und braucht einen eigenen Schlüssel.
4. **Grenze von 60 Anfragen pro Minute:** Uptime Kuma erlaubt mit API-Schlüsseln 60 Anfragen pro
   Minute für die **ganze Instanz**, alle Clients zusammen, Fehlversuche mitgezählt. Ist die Grenze
   erreicht, antwortet `/metrics` mit 401 wie bei einem falschen Schlüssel. Die Console hält
   `/metrics` 30 Sekunden im Speicher und braucht höchstens 2 Anfragen pro Minute und API-Prozess.
   Ein eigener Prometheus sollte höchstens alle 30 Sekunden abfragen.
5. **Ausgehenden Verkehr der Kuma-VM filtern:** Monitore der Kunden laufen von der Instanz aus und
   könnten deren Netz abtasten. Die Console lehnt private und reservierte Ziele ab (siehe unten),
   aber DNS kann sich nach der Prüfung ändern. Der eigentliche Schutz ist eine Firewall auf der
   Kuma-VM, die den Weg in interne Netze (Proxmox, Verwaltung, die Console) sperrt.
6. **Benachrichtigungen** richtet weblion.one in Uptime Kuma ein. Monitore aus der Console bekommen
   alle Benachrichtigungen, die in Uptime Kuma als "Standardmässig aktiviert" markiert sind (für das
   eigene Team). Die Console selbst schickt Kunden keine E-Mail bei einem Ausfall.
7. **Keine neuen Tag-Namen ohne Neustart:** Uptime Kuma 2.1 und neuer meldet Tags als Labels in
   `/metrics` und legt die Label-Namen beim Start fest. Nach einem neuen Tag-Namen Uptime Kuma neu
   starten, sonst fehlen Monitore mit diesem Tag womöglich in `/metrics` (nicht geprüft). Die
   Console selbst nutzt keine Tags.

### Konfiguration

Über die `.env` (Werte mit Sonderzeichen in einfache Anführungszeichen setzen):

```env
UPTIMEKUMA_URL=https://status.weblion.one
UPTIMEKUMA_API_KEY='uk3_...'
# Optional, für eigene Monitore der Kunden: das Sitzungstoken der Verwaltung (siehe unten)
UPTIMEKUMA_SESSION_TOKEN=''
UPTIMEKUMA_NAME=Uptime Kuma
UPTIMEKUMA_COUNTRY=CH
UPTIMEKUMA_CITY=Zürich
```

Sind URL und Schlüssel gesetzt, legt die Console den Provider beim Start an, speichert die
Zugangsdaten verschlüsselt und übernimmt Änderungen beim nächsten Neustart. URL, Schlüssel und Token
eines solchen Providers ändern sich nur über die `.env`. Name, Land und Stadt gelten beim ersten
Start, danach werden sie im Admin-Bereich geändert.

Oder im Admin-Bereich unter Provider > Provider hinzufügen, Typ Uptime Kuma: Adresse der Instanz
(ohne Pfad) und API-Schlüssel. Beim Bearbeiten behält ein leeres Feld den gespeicherten Schlüssel.
Vom Schlüssel zeigt die Console nur die Nummer vor dem Unterstrich (`uk3_••••••`), damit man ihn in
der Liste von Uptime Kuma wiederfindet, vom Sitzungstoken nur, ob es gesetzt ist.

"Verbindung testen" liest `/metrics` und meldet Version, Zahl der Monitore, ob Uptime-Werte
vorhanden sind und den Zustand der Verwaltung. Die Seite des Providers zeigt Version, Monitore,
erreichbare und ausgefallene, ob Uptime-Werte verfügbar sind ("needs Uptime Kuma 2.1" sonst), die
Verwaltung und die Adresse.

### Anmeldung für die Verwaltung

Uptime Kuma 1.x und 2.x kennt genau ein Benutzerkonto, ein eigenes Konto für die Console gibt es
also nicht. Stattdessen meldet sich weblion.one einmal an, und die Console behält nur das
Sitzungstoken, das Uptime Kuma dafür ausgibt (ein JWT):

- **Im Admin-Bereich:** Admin > Monitoring, Karte "Instanzen", "Für die Verwaltung anmelden" mit
  Benutzername, Passwort und, wenn eingeschaltet, dem Zwei-Faktor-Code (nur mit Login, Recht
  `platform:provider:write`). Passwort und Code speichert, protokolliert und auditiert die Console
  nie, nur das Token, verschlüsselt mit den anderen Zugangsdaten. Im Audit-Log steht
  `provider.update` mit `monitoringSession` und dem Benutzernamen.
- **Für eine Verbindung aus der `.env`** geht das nicht (409). Dort das Token in
  `UPTIMEKUMA_SESSION_TOKEN` setzen und die Console neu starten. Das Token erzeugt ein kleines
  Programm in einem Checkout des Repositorys (`pnpm install`), nicht im Container:

  ```bash
  pnpm --filter @weblion/api kuma:token -- --url https://status.weblion.one --user admin
  ```

  Es fragt das Passwort und bei Bedarf den Zwei-Faktor-Code ohne Echo ab und gibt nur das Token aus
  (auf stdout, alles andere auf stderr). Das Passwort schreibt es nirgends hin.

- **Gültigkeit:** Das Token gilt, bis das Passwort in Uptime Kuma geändert wird. Den Zugriff der
  Console entzieht man also, indem man das Passwort ändert. "Abmelden" in der Console löscht nur das
  gespeicherte Token, in Uptime Kuma bleibt es gültig. Ändert jemand die Adresse einer Verbindung,
  verwirft die Console das Token, es gehört zur alten Instanz.
- **Ohne Anmeldung** zeigt die Console alles, was `/metrics` liefert: Status, Antwortzeit,
  Zertifikat, ab 2.1 Uptime und Durchschnitt, und für Monitore auf der Statusseite die letzten 100
  Prüfungen. Pausierte Monitore sind dann nicht von gelöschten zu unterscheiden.
- **Mit Anmeldung** kommen dazu: eigene Monitore der Kunden, Diagramme über 24 Stunden, 7 und 30
  Tage, Statuswechsel mit Meldung, die Konfiguration auf der Detailseite und pausierte Monitore als
  pausiert. Unter Uptime Kuma 2.0.x kommen auch Uptime und Durchschnitt über den Socket.

Das Token ist ein Generalschlüssel der Instanz: Wer den Prozess der Console übernimmt, könnte damit
alles in Uptime Kuma ändern. Die Console schickt deshalb nur eine feste Liste von Events
(`getMonitorList`, `getMonitor`, `add`, `editMonitor`, `pauseMonitor`, `resumeMonitor`,
`deleteMonitor`, `getMonitorChartData`, `monitorImportantHeartbeatListPaged`), nie Einstellungen,
Benachrichtigungen, API-Schlüssel, Backups, Passwort oder 2FA. Wer die gemeinsame Instanz nur lesen
lassen will, meldet sie nicht an und nutzt die Verwaltung nur auf dedizierten Instanzen.

**Was ein Update von Uptime Kuma brechen kann:**

| Änderung in Uptime Kuma                                                                                       | Folge in der Console                                                                                                        |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| neue Felder für Monitore (fast jede Version)                                                                  | keine: Anlegen schickt den festen Feldsatz von 2.0.0, Ändern schickt das ganze Objekt zurück, das Uptime Kuma geliefert hat |
| Felder entfernt oder umbenannt, die die Console nutzt (`url`, `hostname`, `port`, `keyword`, `interval`, ...) | Anlegen oder Ändern scheitert mit der Meldung von Uptime Kuma                                                               |
| Anmeldung über den Socket ersetzt (3.x)                                                                       | Verwaltung und lange Diagramme aus, mit Meldung, Lesen geht weiter                                                          |
| Event umbenannt oder Antwort geändert                                                                         | diese Aktion scheitert, Lesen geht weiter                                                                                   |
| Namen oder Labels in `/metrics` geändert                                                                      | der Sync dieser Instanz scheitert (Provider-Status Fehler), gespeicherte Monitore bleiben                                   |
| strengere Prüfung (z.B. Intervalle)                                                                           | Uptime Kuma lehnt ab, die Console zeigt die Meldung (400)                                                                   |

Scheitert die Verwaltung, zeigt die Console weiter alles aus `/metrics` und meldet "Verwaltung
gestört" mit dem Grund im Admin-Bereich. Änderungen an Monitoren scheitern dann mit dieser Meldung,
sonst bricht nichts. Detailseiten versuchen den Socket erst nach einer Minute wieder und bieten bis
dahin die Diagramme über 24 Stunden, 7 und 30 Tage nicht an.

### Mehrere Instanzen

- Jede Instanz ist ein eigener Provider: die aus der `.env` und beliebig viele aus dem
  Admin-Bereich, jede mit eigenem Schlüssel, eigenem Token, eigenem Zwischenspeicher und eigener
  Socket-Verbindung. Monitore sind pro Instanz eindeutig (die IDs von Uptime Kuma gelten nur pro
  Instanz).
- **Gemeinsame Instanz:** Monitore vieler Kunden auf einer Instanz, weblion.one weist jeden einzeln
  zu. Monitore aus der Console heissen in Uptime Kuma `[<Kürzel der Organisation>] <Name>`, damit
  man sieht, wem sie gehören.
- **Dedizierte Instanz:** eine Instanz, deren Monitore alle einem Kunden gehören. "Alle nicht
  zugewiesenen zuweisen" unter Admin > Monitoring gibt alle freien Monitore einer Instanz auf einmal
  einem Kunden. Die Console behandelt sie sonst nicht anders.
- Ein Kunde sieht Monitore aus beliebig vielen Instanzen, die Liste zeigt dann eine Spalte
  "Instanz". Eigene Monitore legt er nur auf der Instanz seines Kontingents an (eins pro
  Organisation), und pro Instanz kann er eine verknüpfte Statusseite haben.
- Ein Provider lässt sich nicht löschen, solange Monitore von ihm zugewiesen sind, ein Kontingent
  oder eine Statusseite auf ihn zeigt. Nicht zugewiesene Monitore verschwinden mit ihm aus der
  Console (in Uptime Kuma bleiben sie).

### Monitore zuweisen

Admin > Monitoring:

- **Instanzen:** Version, Zahl der Monitore und der zugewiesenen, ob Uptime-Werte verfügbar sind,
  Zustand der Verwaltung mit An- und Abmelden, "Alle nicht zugewiesenen zuweisen" und
  Synchronisieren pro Instanz.
- **Monitore:** alle Monitore aller Instanzen mit Status, Ziel, Herkunft und Kunde, Filter nach
  Instanz, Kunde, Zuweisung, Herkunft und Status, Suche nach Name und Ziel. "Zuweisen"
  (`platform:server:assign`) gibt einen Monitor einem Kunden und schaltet bei ihm das Modul ein (bei
  einem Kunden eines Resellers nur, wenn der Reseller es hat, sonst 409). Ein Kontingent prüft die
  Console dabei nicht, auch nicht für Monitore aus der Console.

Im Audit-Log stehen `monitor.assign`, `monitor.unassign` und `monitor.assign_bulk`. Per API nur mit
Login: `POST /api/v1/admin/monitors/<id>/assign` mit `{"orgId": "<org-id>"}`,
`POST /api/v1/admin/monitors/assign-bulk` mit
`{"providerId": "<provider-id>", "orgId": "<org-id>"}`.

Reseller geben Monitore aus ihrem Bestand unter Reseller > Meine Kunden > Kunde > Ressourcen weiter
und nehmen sie zurück (der Reseller braucht das Modul, der Kunde bekommt es). Monitore aus Uptime
Kuma wandern frei. Ein Monitor aus der Console braucht beim Ziel ein Kontingent auf seiner Instanz
mit einem freien Platz und einem Mindestintervall, das er einhält (sonst 409), auch beim Zurückholen
zum Reseller. Per API: `POST /api/v1/orgs/<reseller-id>/customers/<customer-id>/resources` mit
`{"type": "monitor", "id": "<id>"}`, zurück mit `.../resources/release`.

### Kontingente einrichten

Admin > Kunden > Kunde, Karte "Monitoring" > Kontingent einrichten (Berechtigung
`platform:org:write`):

- **Instanz:** nur Instanzen, die für die Verwaltung angemeldet sind (sonst 422)
- **Höchstens Monitore** (1 bis 10000, Vorschlag 10, für Reseller 50) und das **kürzeste
  Prüfintervall** (20 Sekunden bis 24 Stunden, Vorschlag 60 Sekunden)
- **Modul "Monitoring" aktivieren** (Standard an). Bei einem Kunden eines Resellers nur, wenn der
  Reseller das Modul hat (sonst 409).

Gezählt werden die Monitore aus der Console, die der Organisation auf der Instanz gehören, bei einem
Reseller dazu die Höchstwerte aller Kundenkontingente auf derselben Instanz. Senken geht nicht
darunter (409 `monitor_limit`). Die Instanz wechselt nur, solange dort keine Monitore aus der
Console und keine Kundenkontingente bestehen. Ein Reseller kann sein kürzestes Intervall nicht über
das seiner Kunden heben. Entfernen geht nur ohne Monitore aus der Console und ohne Kundenkontingente
und schaltet das Modul nicht ab. Im Audit-Log stehen `monitor.allowance_set` (mit den bisherigen
Werten) und `monitor.allowance_delete`. Per API nur mit Login:
`PUT /api/v1/admin/orgs/<org-id>/monitor-allowance` mit z.B.
`{"providerId": "<provider-id>", "maxMonitors": 10, "minIntervalSeconds": 60, "enableModule": true}`,
`DELETE` auf denselben Pfad entfernt es.

**Reseller:** Ein Reseller bekommt ein Kontingent wie jeder Kunde und gibt Kunden einen Teil davon:
Reseller > Meine Kunden > Kunde > Ressourcen, Karte "Monitoring". Die Instanz ist die des Resellers,
das kürzeste Intervall mindestens seins, und es muss Platz sein (409 `monitor_limit` "Only N
monitors of your allowance are left for this customer"). Speichern schaltet beim Kunden das Modul
ein. "Kontingent entfernen" gibt es zurück, solange der Kunde keine Monitore aus der Console hat.
Per API: `PUT` und `DELETE /api/v1/reseller/customers/<id>/monitor-allowance`, PUT mit
`{"maxMonitors": 5, "minIntervalSeconds": 60}`.

### Eigene Monitore

Monitoring > "Monitor erstellen" (`monitor:write`, im Kontingent, nur auf einer angemeldeten
Instanz):

- **Art:** HTTP(S) (ruft eine Adresse auf und erwartet einen erfolgreichen Statuscode), Keyword
  (sucht einen Text in der Antwort, optional "darf nicht vorkommen"), Ping (Host) oder Port (Host
  und TCP-Port). DNS, Push, Docker, Datenbanken und Gruppen legen Kunden nicht an.
- **Name** (höchstens 80 Zeichen, ohne Steuerzeichen). In Uptime Kuma heisst der Monitor
  `[<Kürzel der Organisation>] <Name>`.
- **Adresse** mit `http://` oder `https://`, ohne Benutzername und Passwort, oder **Host** ohne
  Schema und Port
- **Prüfintervall:** 20 Sekunden bis 1 Stunde zur Auswahl, mindestens das kürzeste Intervall des
  Kontingents (sonst 400)
- **Erweitert** (HTTP(S) und Keyword): Methode GET oder HEAD, akzeptierte Statuscodes (Standard
  `200-299`, höchstens 10 Codes oder Bereiche), TLS-Fehler ignorieren

**Nur öffentliche Ziele:** Die Console löst den Namen vorher auf (über den Resolver ihres Servers,
höchstens 3 Sekunden) und lehnt mit 400 ab: Namen ohne Punkt, `localhost` und Namen auf `.local`,
`.localdomain`, `.internal`, `.lan` und `.home.arpa`, die Instanz selbst, Namen, die nicht auflösen,
und IP-Adressen oder aufgelöste Adressen in privaten und reservierten Bereichen (`0.0.0.0/8`,
`10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.0.0.0/24`,
`192.0.2.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, Multicast
und `240.0.0.0/4`, bei IPv6 `::`, `::1`, Unique Local `fc00::/7`, Link-Local `fe80::/10`,
`fec0::/10`, Multicast `ff00::/8`, `2001:db8::/32` und IPv4 in IPv6 nach den Regeln von IPv4). Wer
interne Ziele überwachen muss, lässt weblion.one den Monitor in Uptime Kuma anlegen und zuweisen,
dann ist er für den Kunden nur lesbar. Weiterleitungen folgen Monitore aus der Console nicht (auch
ältere nicht mehr, sobald sie geändert werden), sonst käme eine Weiterleitung auf ein internes Ziel
an der Prüfung vorbei: Wer weiterleitet, trägt die Zieladresse ein oder akzeptiert 3xx-Statuscodes.
Den Ausschnitt der Antwort, den Uptime Kuma an die Meldung einer gescheiterten Keyword-Prüfung
hängt, zeigt die Console nicht.

Die Console legt den Monitor mit einer Wiederholung vor "ausgefallen" an (im gleichen Abstand wie
das Intervall), Zeitlimit 80 % des Intervalls bis höchstens 48 Sekunden (Ping 10 Sekunden), und mit
den Benachrichtigungen, die in Uptime Kuma standardmässig aktiviert sind. Der Monitor zählt sofort
zum Kontingent und steht auf "ausstehend", bis die erste Prüfung durch ist. Das Anlegen läuft unter
einer Sperre pro Kunde, parallele Anfragen können das Kontingent also nicht überziehen. Scheitert
das Speichern, nachdem Uptime Kuma den Monitor schon angelegt hat, löscht die Console ihn dort
wieder. Im Audit-Log steht `monitor.create`. Per API:

```bash
curl -X POST -H "Authorization: Bearer wlc_…" -H "Content-Type: application/json" \
  -d '{"kind":"http","name":"Website","url":"https://www.muster.ch","intervalSeconds":60}' \
  https://cp.weblion.cloud/api/v1/orgs/<org-id>/monitors
```

- **Ändern:** Name, Ziel, Intervall, Keyword, Methode, Statuscodes und TLS. Uptime Kumas
  `editMonitor` setzt jedes Feld aus dem Objekt und leert, was fehlt. Die Console liest den Monitor
  deshalb direkt vorher bei Uptime Kuma und schickt das ganze Objekt mit den geänderten Feldern
  zurück. Ändert jemand denselben Monitor gleichzeitig in Uptime Kuma, gewinnt die letzte Änderung.
  Ein neues Ziel prüft die Console wieder auf öffentliche Adressen. Geheim wirkende Werte in der
  Adresse zeigt die Console als `***`; bleibt `***` beim Ändern stehen, behält der Monitor den
  bisherigen Wert. Im Audit-Log steht
  `monitor.update` mit altem und neuem Wert (geheim wirkende Werte in Adressen als `***`). Per API:
  `PATCH /api/v1/monitors/<id>` mit z.B. `{"intervalSeconds": 120}`.
- **Pausieren und fortsetzen:** Ein pausierter Monitor prüft nicht und meldet keine Ausfälle. Ein
  fortgesetzter steht bis zur nächsten Prüfung auf "ausstehend". Im Audit-Log stehen `monitor.pause`
  und `monitor.resume`. Per API: `POST /api/v1/monitors/<id>/pause`, `.../resume`.
- **Löschen** (`monitor:delete`) verlangt den Namen als Bestätigung und löscht den Monitor in Uptime
  Kuma mit seinem ganzen Verlauf. Meldet Uptime Kuma ihn nicht mehr, entfernt Löschen nur die Zeile.
  Im Audit-Log steht `monitor.delete`. Per API: `DELETE /api/v1/monitors/<id>` mit
  `{"confirm": "<Name>"}`.

Ohne Kontingent sieht der Kunde nur die zugewiesenen Monitore und den Hinweis, sich an weblion.one
(oder seinen Reseller) zu wenden. Ist die Instanz nicht (mehr) angemeldet, sagt die Seite, dass
eigene Monitore gerade nicht angelegt oder geändert werden können.

### Statusseiten

Statusseiten legt weblion.one in Uptime Kuma an und verknüpft sie in der Console: Admin > Kunden >
Kunde, Karte "Monitoring" > "Statusseite verknüpfen" (`platform:org:write`) mit der Instanz, dem
Slug (z.B. `muster-ag` aus `…/status/muster-ag`) und optional der öffentlichen Adresse, wenn die
Seite in Uptime Kuma eine eigene Domain hat (die Console kann sie nicht lesen). Den Slug prüft die
Console bei Uptime Kuma (unbekannt: 422). Pro Instanz hat eine Organisation eine Statusseite, eine
neue ersetzt die alte. Im Audit-Log stehen `monitor.status_page_set` und
`monitor.status_page_delete`.

Kunden sehen "Statusseite öffnen". Für ihre Monitore auf dieser Seite zeigt die Detailseite auch
ohne Verwaltung die letzten 100 Prüfungen (aus der öffentlichen JSON der Seite, die Uptime Kuma eine
Minute zwischenspeichert). Einen Zugang zu Uptime Kuma selbst bekommen Kunden nicht.

### Sync

- Pro Sync-Lauf (alle `SYNC_INTERVAL_SECONDS`) liest die Console `/metrics` (höchstens 30 Sekunden
  alt). Ist die Instanz angemeldet, kommt die Liste aller Monitore über den Socket dazu, mit den
  pausierten: aus einer offenen Sitzung, sonst höchstens alle 10 Minuten aus einer neuen. Die
  Sitzung schliesst die Console nach 3 Minuten ohne Anfrage, weil Uptime Kuma einer offenen Sitzung
  jede Prüfung jedes Monitors schickt.
- Neue Monitore sind nicht zugewiesen, mit Herkunft "Uptime Kuma". Name, Ziel, Status und Zahlen
  folgen Uptime Kuma, der Name nur, solange niemand ihn in der Console geändert hat. Was die Console
  während des Laufs ändert, überschreibt der Sync nicht.
- **Fehlende Monitore:** Mit der Liste aus dem Socket ist klar, was gelöscht ist: Ein Monitor, den
  Uptime Kuma nicht mehr kennt, gilt als "nicht mehr gemeldet" und behält seinen Kunden. Nur mit
  `/metrics` geht das nicht: Ein pausierter Monitor verschwindet dort, und nach einem Neustart von
  Uptime Kuma fehlt jeder Monitor bis zu seiner ersten Prüfung. Ein zuletzt pausierter Monitor
  bleibt dann "pausiert", die anderen gelten als "nicht mehr gemeldet", gelöscht wird nichts.
- Ein Fehler der Verwaltung lässt den Sync nicht scheitern. Er steht im Log und im Admin-Bereich.
  Scheitert `/metrics`, bekommt der Provider den Fehler, die gespeicherten Monitore bleiben.
- Die Detailseite eines Monitors liest ihn live nach und speichert das Ergebnis.
- Von Hand: Admin > Monitoring > Synchronisieren, oder Admin > Provider > Uptime Kuma > "Jetzt
  synchronisieren".

### Was die Console nutzt

| Funktion in der Console                  | Endpunkt oder Event                                                 | Berechtigung                             |
| ---------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------- |
| Verbindungstest, Sync, Status und Zahlen | `GET /metrics` (HTTP Basic, Passwort = API-Schlüssel)               | Admin-Bereich, Sync-Job, `monitor:read`  |
| Statusseite prüfen                       | `GET /api/status-page/<slug>` (ohne Anmeldung)                      | `platform:org:write`                     |
| Letzte 100 Prüfungen                     | `GET /api/status-page/heartbeat/<slug>` (ohne Anmeldung)            | `monitor:read`                           |
| Anmeldung für die Verwaltung             | Socket-Event `login` (nur bei der Anmeldung), danach `loginByToken` | `platform:provider:write`, nur mit Login |
| Liste mit pausierten Monitoren           | `getMonitorList`                                                    | Sync-Job, `monitor:read`                 |
| Detail, Konfiguration, Statuswechsel     | `getMonitor`, `monitorImportantHeartbeatListPaged` (die letzten 20) | `monitor:read`                           |
| Diagramm 24 h, 7 und 30 Tage             | `getMonitorChartData` mit 24, 168 oder 720 Stunden                  | `monitor:read`                           |
| Monitor anlegen                          | `add`                                                               | `monitor:write`                          |
| Ändern                                   | `getMonitor`, dann `editMonitor` mit dem ganzen Objekt              | `monitor:write`                          |
| Pausieren, fortsetzen                    | `pauseMonitor`, `resumeMonitor`                                     | `monitor:write`                          |
| Löschen                                  | `deleteMonitor`                                                     | `monitor:delete`                         |
| API Explorer                             | die HTTP-Pfade oben, Badges, `/api/entry-page` und die Events oben  | `platform:explorer`, nur mit Login       |

Der Socket verbindet sich als Websocket auf `<Base URL>/socket.io/`. Zwischenspeicher: `/metrics` 30
Sekunden, Liste über den Socket 60 Sekunden, Diagramme 60 Sekunden, letzte Prüfungen der Statusseite
60 Sekunden, Statusseite 5 Minuten, Zustand der Verwaltung 60 Sekunden. Änderungen über die Console
leeren den Speicher des Monitors. Prozentwerte rundet die Console ab (99,995 % sind keine 100 %).

### Fehler der API

Fehler kommen wie überall in der API als `{ "error": { "code", "message", "details" } }`. Für
Monitoring:

| HTTP | `code`                          | Wann                                                                                                                                                                                                  |
| ---- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | `bad_request`                   | Ungültige Eingabe (`details` nennt das Feld), Intervall unter dem Minimum des Kontingents, privates oder nicht auflösbares Ziel, falsche Bestätigung beim Löschen, Prüfungen, die Uptime Kuma ablehnt |
| 400  | `totp_required`, `totp_invalid` | Anmeldung für die Verwaltung: Zwei-Faktor-Code fehlt oder falsch                                                                                                                                      |
| 403  | `forbidden`                     | Recht fehlt, Kunde gesperrt (nur lesen), Modul nicht aktiv (Liste), Anmeldung mit API-Token                                                                                                           |
| 404  | `not_found`                     | Monitor gibt es nicht oder die Person sieht ihn nicht, kein Verlauf für diesen Zeitraum                                                                                                               |
| 404  | `provider_error`                | Uptime Kuma kennt den Monitor nicht (mehr)                                                                                                                                                            |
| 409  | `no_allowance`                  | Kein Kontingent (beim Anlegen, Ändern des Intervalls, Weitergeben eines Monitors aus der Console)                                                                                                     |
| 409  | `monitor_limit`                 | Kontingent voll, Höchstwert unter dem Vergebenen, Anteil des Resellers aufgebraucht, `details` mit `maxMonitors` und `committed`                                                                      |
| 409  | `read_only_monitor`             | Änderung an einem Monitor aus Uptime Kuma                                                                                                                                                             |
| 409  | `conflict`                      | Instanz wechseln oder Kontingent entfernen mit Monitoren, Reseller ohne Modul, Anmeldung einer Verbindung aus der `.env`, Provider löschen mit Zuweisungen                                            |
| 422  | `unsupported`                   | Instanz nicht für die Verwaltung angemeldet, Provider ohne Monitore, unbekannte Statusseite                                                                                                           |
| 502  | `provider_error`                | Uptime Kuma hat abgelehnt oder war nicht erreichbar, `message` mit dem Grund, auch für 401 (Schlüssel falsch oder Grenze von 60 pro Minute erreicht) und "zu viele Anfragen"                          |

Jede Änderung steht im Audit-Log, gescheiterte mit `status: failure` und der Meldung.

### API Explorer

Admin > API Explorer, Provider Uptime Kuma:

- **HTTP**, nur GET: `/metrics` (mit dem Schlüssel), `/api/status-page/<slug>`,
  `/api/status-page/heartbeat/<slug>`,
  `/api/badge/<id>/<status|uptime|ping|avg-response|cert-exp|response>[/<Dauer>]` und
  `/api/entry-page`. Andere Pfade, `..`, `//`, `\`, `#` und kodierte Punkte oder Schrägstriche sind
  gesperrt.
- **Socket**, nur mit Anmeldung: `socket/<Event>`. Lesen mit GET und `?args=[12,24]` (höchstens drei
  Zahlen): `getMonitorList`, `getMonitor`, `getMonitorChartData`,
  `monitorImportantHeartbeatListPaged`. Schreiben mit POST und `{"args": [...]}`: `add` und
  `editMonitor` mit einem Monitor-Objekt, `pauseMonitor`, `resumeMonitor` und `deleteMonitor` mit
  einer ID. Alle anderen Events (Einstellungen, API-Schlüssel, Benachrichtigungen, Backups, Login)
  lehnt die Console ab.
- In Antworten sind Geheimnisse der Monitore (Basic Auth, Bearer-Token, OAuth, Header, Body,
  Verbindungs-Strings, SSH-, MQTT-, RADIUS-, RabbitMQ- und Kafka-Zugangsdaten, TLS-Schlüssel,
  Push-Token) ausgeblendet, Schlüssel und Token der Console stehen nie darin.
- Schreibende Events stehen im Audit-Log (`provider.explorer`), die Monitor-Objekte darin ohne
  Geheimnisse.
- Was über den Explorer geändert wird, prüft die Console nicht gegen Kontingente.

### Grenzen

- **Keine Benachrichtigung an Kunden:** Bei einem Ausfall schickt die Console niemandem etwas.
  Benachrichtigungen laufen in Uptime Kuma. Wer einem Kunden Mails schicken will, legt in Uptime
  Kuma eine Benachrichtigung an und hängt sie von Hand an seine Monitore.
- **Statusseiten** legt weblion.one in Uptime Kuma an, die Console verknüpft sie nur.
- **Abrechnung:** Kontingent und Dienst sind getrennt, ein Monitor lässt sich nicht mit einem Dienst
  verknüpfen. Ein Produkt "Monitoring" geht als Dienst ohne Ressource. Siehe
  [Roadmap](roadmap.md#monitoring-uptime-kuma).
- **Sperren:** Ein gesperrter Kunde sieht seine Monitore nur noch lesend, Uptime Kuma prüft weiter.
  Ebenso lassen ein abgeschaltetes Modul und eine gelöste Zuweisung Uptime Kuma unberührt.
- **Eine Instanz pro Kontingent:** Eigene Monitore entstehen nur auf der Instanz des Kontingents.
- **Monitore aus Uptime Kuma** bleiben für Kunden nur lesbar, auch wenn sie ihnen zugewiesen sind.
- **Kein Verlauf ohne Verwaltung und ohne Statusseite:** Die Console speichert keine Prüfungen.
- **Uptime Kuma 1.23** wird nicht unterstützt, **3.x** nur lesend.
- Nicht in der Console, das geht in Uptime Kuma: Benachrichtigungen, Wartungsfenster, Gruppen, Tags,
  andere Arten von Monitoren, Statusseiten bearbeiten, Einstellungen.

Ideen dazu in der [Roadmap](roadmap.md).

### Offene Punkte

Gegen ein echtes Uptime Kuma ist die Anbindung noch nicht getestet, nur gegen einen Mock-Server, der
`/metrics`, die Statusseiten und die Socket-Events nach dem Quellcode von Uptime Kuma 2.5.6
nachbildet. Die Fixtures sind aus dem Quellcode geschrieben, nicht mitgeschnitten. Vor dem ersten
echten Einsatz mit einer Test-Instanz prüfen und echte Antworten als Fixtures ablegen:

1. Wie `/metrics` leere Labels druckt (`monitor_hostname`, `monitor_port`): `"null"`, `"undefined"`
   oder leer. Die Console nimmt alle drei als leer.
2. Ob Uptime Kuma Monitore mit einem Tag-Namen, der nach dem Start dazukam, in `/metrics` weglässt
3. Ob `app_version` in `/metrics` die Version von Uptime Kuma ist
4. Ob `socket.io-client` in Node beim Websocket keinen `Origin`-Header schickt (Uptime Kuma erlaubt
   das, mit `Origin` muss er zum Host passen)
5. Body und Content-Type der Antwort 401 auf `/metrics` und von `/metrics` selbst
6. Was `/api/status-page/heartbeat/<slug>` für einen unbekannten Slug antwortet
7. Ob `active` in der Monitorliste auf allen 2.x ein Boolean oder 0/1 ist (die Console nimmt beides)
8. Wie lange Uptime Kuma Prüfungen und Stundenwerte aufbewahrt (für das Diagramm über 30 Tage)
9. Wie sich Uptime Kuma 3.0 von einem Programm anmelden lässt (Pfad, Cookie, Lebensdauer), und ob
   API-Schlüssel dort für den Socket gelten
10. Wie sich ein Ping-Monitor auf 2.5.x ohne `ping_count` verhält. Die Console schickt die Felder
    nur, wenn die Monitore der Instanz sie schon haben.
11. Wie lang der Name eines Monitors in Uptime Kuma sein darf (angenommen 150 Zeichen). Die Console
    begrenzt auf 80 plus das Kürzel.
12. Ob die Basic-Anmeldung von `/metrics` jeden Benutzernamen annimmt (die Console schickt
    `weblion`)
13. Echte Antworten von `/metrics`, `getMonitor` und `getMonitorChartData`

### Demo

Der Demo-Provider (`ENABLE_DEMO_PROVIDER=true`) simuliert eine Instanz von Uptime Kuma 2.5.6 im
Speicher, mit denselben Prüfungen wie die echte Anbindung. Die Verwaltung ist dort immer angemeldet.
Die Adresse `https://status.demo.weblion.one` gibt es nicht, "Statusseite öffnen" führt ins Leere.
Mit `pnpm db:seed`:

- Muster AG hat das Modul, ein Kontingent für 10 Monitore mit 60 Sekunden Mindestintervall, die
  Statusseite `muster-ag` (mit Website, Shop und Mailserver) und vier Monitore:
  `muster-ag.ch Website` (HTTPS, mit Zertifikat), `Shop` (Keyword, aus der Console, in Uptime Kuma
  `[muster-ag] Shop`), `Mailserver SMTP` (Port 25, ausgefallen) und `Webserver Ping` (auf die erste
  IPv4 des Demo-Servers `demo-42-1`, erscheint deshalb auf dessen Seite).
- Bäckerei Huber hat `baeckerei-huber.ch` zugewiesen, aber das Modul noch nicht. Alpen Hosting
  (Reseller) hat ein Kontingent für 50 Monitore, aber das Modul noch nicht: zum Ausprobieren das
  Modul zuerst bei Alpen Hosting, dann bei Bäckerei Huber aktivieren.
- Nicht zugewiesen sind `alpenblick-hotel.ch` (pausiert), `Status API` und die Gruppe
  `Kunden-Websites`.

## Jellyfin (Streaming)

- API: die REST-API des Jellyfin-Servers. Die Console folgt dem Quellcode von Jellyfin 10.11.11 (für
  Unterschiede 10.10.7).
- Base URL: die Adresse der Instanz, wie sie die Kunden in den Apps eingeben, mit dem Basis-Pfad von
  Jellyfin, falls einer gesetzt ist, z.B. `https://media.weblion.one` oder
  `https://weblion.one/jellyfin`. Jeder Aufruf schickt den Header
  `Authorization: MediaBrowser Token="<API-Schlüssel>"`, nie `X-Emby-Token` oder `api_key` in der
  Adresse (die sind in Jellyfin veraltet und landen in Logs). Antworten in PascalCase-JSON.
- Version: **Jellyfin 10.10 oder neuer**, 10.11 empfohlen. Ältere lehnt "Verbindung testen" ab.
- Konfiguration: `JELLYFIN_URL` und `JELLYFIN_API_KEY` in der `.env` oder im Admin-Bereich unter
  Provider > Provider hinzufügen > Jellyfin
- Jellyfin liefert keine Server. Im Server-Inventar und in den Server-Filtern taucht der Provider
  deshalb nicht auf.

### Was das Modul macht

weblion.one betreibt Jellyfin-Mediaserver und verkauft darauf Zugänge für Filme, Serien und Musik.
Das Modul **Streaming** (`media`) bringt das in die Console:

- **Kontingent pro Kunde:** weblion.one (oder ein Reseller für seine Kunden) gibt einer Organisation
  ein Kontingent auf einer Instanz: wie viele Zugänge, welche Bibliotheken, wie viele Geräte
  gleichzeitig, ob Downloads erlaubt sind und eine Grenze für die Bitrate unterwegs.
- **Selbstverwaltung:** Darin legt der Kunde Zugänge selbst an (für Personen oder Geräte, mit
  erzeugtem oder eigenem Passwort), deaktiviert und aktiviert sie, setzt Passwörter neu und löscht
  sie. In der Console unter dem Menüpunkt "Streaming", sobald das Modul aktiv ist.
- **Verwaltete Richtlinie:** Jeder Zugang bekommt in Jellyfin genau die Rechte des Kontingents
  (siehe unten). Die Console schreibt sie beim Anlegen, bei jeder Änderung des Kontingents, und der
  Sync stellt sie wieder her, wenn jemand sie in Jellyfin ändert.
- **Anmeldehilfe:** Eine Karte zeigt die Server-Adresse, den Namen des Servers in den Apps, die
  Schritte zur Anmeldung, die Apps und wie Quick Connect auf dem Fernseher funktioniert.

Gespeichert werden die Kontingente (Tabelle `media_allowances`) und die Zugänge, die die Console
verwaltet (`media_accounts`), nie Passwörter, Richtlinien, Sitzungen oder der Verlauf.

**Datenschutz:** Was jemand anschaut, wann und auf welchem Gerät, zeigt die Console niemandem. Pro
Zugang sehen Kunden und weblion.one Login-Name, Status, den **Tag** der letzten Aktivität (Zeitzone
Zürich, nie die Uhrzeit) und das Erstelldatum. weblion.one sieht pro Instanz zusätzlich nur zwei
Zahlen: Sitzungen der letzten 10 Minuten und wie viele davon etwas abspielen.

Für die Lizenzen der Inhalte, die auf einer Instanz angeboten werden, ist der Betreiber der Instanz
verantwortlich. Die Console verteilt nur Zugänge.

Wer darf was:

| Wer                           | Darf                                                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Owner, Admin                  | Zugänge anlegen, deaktivieren, aktivieren, löschen (`media:write`) und Passwörter neu setzen (`media:password`)                           |
| Member, Nur lesen             | Zugänge, Kontingent und Anmeldehilfe ansehen (`media:read`)                                                                               |
| Eingeschränkt, Buchhaltung    | nichts, per Policy erweiterbar (Ressource `org` oder `*`)                                                                                 |
| API-Token "Lesen & Schreiben" | was die Person darf, der das Token gehört, aber ohne Passwörter: Zugänge nur mit mitgeschicktem Passwort, kein "Passwort neu setzen"      |
| Mitarbeitende eines Resellers | im Panel seiner Kunden, was ihre Reseller-Rolle erlaubt, dazu Kunden einen Teil des eigenen Kontingents geben (`reseller:customer:write`) |
| weblion.one Superadmin        | alles, dazu Kontingente, Übernehmen, Zuweisen und Richtlinie anwenden (`platform:media:write`)                                            |
| weblion.one Support           | alles ansehen, nichts ändern                                                                                                              |

Zugänge haben keinen eigenen Ressourcenpfad, eine Policy gilt immer für alle Zugänge der
Organisation, wie bei Cloud-Konten.

### Voraussetzungen

1. **Eigene Jellyfin-Instanz**, 10.10 oder neuer, mit abgeschlossener Ersteinrichtung (sonst lehnt
   "Verbindung testen" ab). Am besten auf einer eigenen VM mit genug Platz für die Bibliotheken und
   genug CPU oder einer GPU für das Transkodieren, nicht auf dem Server der Console.
2. **https über einen Reverse Proxy**, mit der Adresse des Proxys in den Netzwerk-Einstellungen von
   Jellyfin als bekanntem Proxy (`KnownProxies`). Sonst sieht Jellyfin bei allen Clients die Adresse
   des Proxys, hält alle für lokal, und die Bitrate-Grenze unterwegs greift nie. `http://` lässt die
   Console zu, dann aber nur in einem privaten Netz: Schlüssel und Passwörter gingen sonst
   unverschlüsselt über das Netz. Liegt Jellyfin unter einem Basis-Pfad, gehört er in die Base URL.
   Weiterleitungen folgt die Console nicht, damit der Schlüssel nie an einen anderen Host geht.
3. **Fernzugriff:** "Remote-Verbindungen erlauben" bleibt an, die Kunden streamen von zu Hause. Ist
   es aus, nimmt Jellyfin auch die Anfragen der Console nur aus seinem lokalen Netz an.
4. **Quick Connect** eingeschaltet lassen (Standard): Damit melden sich Fernseher an, ohne dass
   jemand ein Passwort mit der Fernbedienung tippt.
5. **Ein eigener API-Schlüssel nur für weblion.one:** Dashboard > API-Schlüssel > Hinzufügen,
   App-Name z.B. `weblion.one`. Der Schlüssel hat 32 Zeichen aus 0-9 und a-f. Jeder API-Schlüssel
   ist in Jellyfin ein voller Administrator, eingrenzen lässt er sich nicht. Zum Tauschen einen
   neuen anlegen, in der Console speichern, dann den alten in Jellyfin löschen.
6. **Bibliotheken:** Was ein Kontingent freigeben soll, muss eine eigene Bibliothek sein (z.B.
   Filme, Serien, Kinder). Eine neue Bibliothek lässt sich erst nach ihrem ersten Scan freigeben.
7. **Sperre nach Fehlversuchen:** Ob Jellyfin Benutzer nach fehlgeschlagenen Anmeldungen sperrt
   (`LoginAttemptsBeforeLockout`), entscheidet der Betreiber, die Console ändert das nicht. Auf
   einem gemeinsamen Server kann damit jeder, der einen Login-Namen kennt, diesen Zugang sperren.
   "Aktivieren" in der Console hebt die Sperre auf.

### Konfiguration

Über die `.env` (Werte mit Sonderzeichen in einfache Anführungszeichen setzen):

```env
JELLYFIN_URL=https://media.weblion.one
JELLYFIN_API_KEY='...'
JELLYFIN_NAME=Jellyfin
JELLYFIN_COUNTRY=CH
JELLYFIN_CITY=Zürich
```

Sind URL und Schlüssel gesetzt, legt die Console den Provider beim Start an, speichert die
Zugangsdaten verschlüsselt und übernimmt Änderungen beim nächsten Neustart. URL und Schlüssel eines
solchen Providers ändern sich nur über die `.env`. Name, Land und Stadt gelten beim ersten Start,
danach werden sie im Admin-Bereich geändert.

Oder im Admin-Bereich unter Provider > Provider hinzufügen, Typ Jellyfin: Adresse der Instanz und
API-Schlüssel. Beim Bearbeiten behält ein leeres Feld den gespeicherten Schlüssel. Vom Schlüssel
zeigt die Console kein Zeichen.

"Verbindung testen" liest die Server-Info (Version, Ersteinrichtung), alle Benutzer und die
Bibliotheken und meldet Version, Servername, Zahl der Benutzer, der Administratoren und der
Bibliotheken. Die Seite des Providers zeigt Version, Servername, Benutzer, Bibliotheken, aktive
Sitzungen und wie viele davon abspielen, Quick Connect und die Adresse zum Anmelden, dazu einen Link
auf die Streaming-Zugänge der Instanz.

### Login-Namen und Kontingent-Code

- **Login-Name** ist `<Name>-<Kontingent-Code>`, z.B. `anna-kemaro` oder `wohnzimmer-kemaro`. Der
  Kunde wählt nur den Namen: Kleinbuchstaben, Ziffern und einzelne Bindestriche, am Anfang und Ende
  ein Buchstabe oder eine Ziffer, höchstens 20 Zeichen. Grossbuchstaben nimmt die API nicht an (der
  Dialog wandelt sie um). Jellyfin vergleicht Namen ohne Gross- und Kleinschreibung, ein Fernseher,
  der "Anna-kemaro" schreibt, meldet sich also trotzdem an.
- **Kontingent-Code:** gehört zum Kontingent und ist auf der Plattform eindeutig. Die Console
  erzeugt ihn beim ersten Kontingent: sechs Buchstaben, abwechselnd Konsonant und Vokal (z.B.
  `kemaro`, `bivane`), gut vorzulesen und zu tippen. weblion.one kann einen eigenen setzen (3 bis 12
  Kleinbuchstaben), z.B. `muster` auf einer dedizierten Instanz, aber nur, solange die Organisation
  keine Zugänge hat. Reseller wählen keinen Code, ihre Kunden bekommen einen erzeugten.
- **Warum nicht das Kürzel der Organisation** wie bei Nextcloud: Jeder Zugang kann über die API von
  Jellyfin alle Benutzer des Servers auflisten (`GET /Users` braucht nur eine Anmeldung). Mit dem
  Kürzel sähe jeder Kunde, wer sonst noch auf dem Server ist. Der Code verrät das nicht. Der Dialog
  rät trotzdem zu Vornamen oder Räumen statt vollständigen Namen.
- Login-Namen anderer Kunden kollidieren nie, weil die Codes eindeutig sind. Benutzer, die in
  Jellyfin angelegt und übernommen wurden, behalten ihren Namen. Benennt jemand einen Benutzer in
  Jellyfin um, übernimmt der Sync den neuen Namen (die Console kennt Benutzer an ihrer ID).

### Zugänge anlegen, sperren, Passwörter, löschen

Streaming > "Zugang erstellen" (`media:write`, im Kontingent): Name und Passwort.

- **Passwort erzeugen** (empfohlen): 16 Kleinbuchstaben und Ziffern ohne verwechselbare Zeichen, gut
  auf einer Fernbedienung einzugeben. Die Console zeigt es einmal an (in Vierergruppen zum Vorlesen)
  und speichert es nirgends, weder in der Datenbank noch im Audit-Log. Antworten mit Passwort tragen
  `Cache-Control: no-store`.
- **Eigenes Passwort:** 10 bis 128 Zeichen, ohne Steuerzeichen und ohne Leerzeichen am Anfang oder
  Ende.

Vorher prüft die Console: Es gibt ein Kontingent (sonst 409 `no_allowance`), es ist noch ein Zugang
frei (409 `account_limit`), und der Name ist frei (409, auch wenn es den Benutzer in Jellyfin schon
gibt, ohne dass die Console ihn verwaltet). Das Anlegen läuft unter einer Sperre pro Kunde,
parallele Anfragen können das Kontingent also nicht überziehen. In Jellyfin legt die Console den
Benutzer immer mit Passwort an und schreibt gleich danach die Richtlinie. Bis dahin hätte er die
Standardrechte von Jellyfin (alle Bibliotheken, Live TV, öffentliches Teilen): Scheitert das
Schreiben, löscht die Console den Benutzer wieder. Bekommt das Anlegen keine klare Antwort (keine
Antwort in der Zeit, Verbindung abgebrochen, 5xx eines Proxys), sucht die Console den Namen und
löscht einen so angelegten Benutzer ebenfalls. Lässt er sich nicht löschen, deaktiviert sie ihn mit
der Richtlinie des Kontingents, und die Meldung (auch im Audit-Log) nennt seine Jellyfin-ID, damit
weblion.one ihn löscht. Im Audit-Log steht `media.account_create` mit `password: generated` oder
`chosen`.

Per API nur mit eigenem Passwort, ein Token bekommt nie ein erzeugtes (sonst 400):

```bash
curl -X POST -H "Authorization: Bearer wlc_…" -H "Content-Type: application/json" \
  -d '{"name":"anna","password":"lang-und-geheim-2026"}' \
  https://cp.weblion.cloud/api/v1/orgs/<org-id>/media/accounts
```

Die Antwort ist `{ "account": { ... }, "password": null }`.

- **Deaktivieren:** Jellyfin meldet alle Geräte des Zugangs sofort ab, er kann sich nicht mehr
  anmelden. Verlauf und Favoriten bleiben. **Aktivieren** hebt auch eine Sperre nach
  fehlgeschlagenen Anmeldungen auf (die Console setzt den Zähler zurück, sonst sperrte der nächste
  Fehlversuch wieder). Im Audit-Log steht `media.account_update`. Per API:
  `PATCH /api/v1/media/accounts/<id>` mit `{"enabled": false}`.
- **Passwort neu setzen** (`media:password`, nur mit Login, nie per API-Token): erzeugt oder eigen.
  Jellyfin braucht dafür das alte Passwort nicht und meldet alle Geräte des Zugangs ab. Im Audit-Log
  steht `media.password_reset`, das Passwort nicht. Per API nur mit Session:
  `POST /api/v1/media/accounts/<id>/password` mit `{}` (erzeugt) oder `{"password": "..."}`.
- **Löschen** verlangt den Login-Namen als Bestätigung. Jellyfin löscht den Benutzer mit
  Wiedergabeverlauf, Favoriten und Playlists und meldet alle Geräte ab. Das lässt sich nicht
  rückgängig machen. Gibt es den Benutzer in Jellyfin nicht mehr ("In Jellyfin nicht gefunden"),
  entfernt Löschen nur den Eintrag in der Console. Im Audit-Log steht `media.account_delete`. Per
  API: `DELETE /api/v1/media/accounts/<id>` mit `{"confirm": "<Login-Name>"}`.

Eine E-Mail oder Einladung kennt Jellyfin nicht: Der Kunde gibt das Passwort selbst weiter. Wer es
vergessen hat, bekommt ein neues. Administratoren von Jellyfin verwaltet die Console nie: Sie lassen
sich weder deaktivieren noch löschen, noch bekommen sie ein neues Passwort (409), und kein Zugang
wird je Administrator.

### Die verwaltete Richtlinie

Die Console besitzt 17 Felder der Benutzer-Richtlinie von Jellyfin und setzt sie aus dem Kontingent:

| Feld in Jellyfin                                                                  | Wert                                                                        |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `IsAdministrator`                                                                 | nein                                                                        |
| `IsHidden`                                                                        | ja, der Zugang erscheint nicht auf dem Anmeldebildschirm                    |
| `EnableRemoteAccess`                                                              | ja                                                                          |
| `EnableAllFolders`, `EnabledFolders`                                              | nein, nur die Bibliotheken des Kontingents                                  |
| `MaxActiveSessions`                                                               | die gleichzeitigen Streams (Geräte) des Kontingents                         |
| `EnableContentDownloading`                                                        | Downloads des Kontingents                                                   |
| `EnableSyncTranscoding`, `EnableMediaConversion`                                  | wie Downloads (Offline-Kopien sind Downloads)                               |
| `RemoteClientBitrateLimit`                                                        | Qualität unterwegs in Bit pro Sekunde, 0 heisst die Einstellung des Servers |
| `EnableContentDeletion`, `EnableContentDeletionFromFolders`                       | nein                                                                        |
| `EnableRemoteControlOfOtherUsers`, `EnableSharedDeviceControl`                    | nein                                                                        |
| `EnableLiveTvAccess`, `EnableLiveTvManagement`                                    | nein                                                                        |
| `EnableCollectionManagement`, `EnableSubtitleManagement`, `EnableLyricManagement` | nein (auf gemeinsamen Bibliotheken sähe jeder Kunde die Änderungen)         |
| `EnablePublicSharing`                                                             | nein                                                                        |
| `EnableAllChannels`, `EnabledChannels`                                            | nein (Plugin-Kanäle bringen Inhalte von ausserhalb der Bibliotheken)        |
| `SyncPlayAccess`                                                                  | `None` (SyncPlay zeigt die Gruppen anderer Benutzer mit ihren Namen)        |

Alles andere lässt die Console, wie es in Jellyfin steht: Kindersicherung, Zeitpläne, Transkodieren,
Geräte, `IsDisabled` (nur Deaktivieren und Aktivieren ändern das), die Sperre nach Fehlversuchen und
jedes Feld, das neuere Versionen von Jellyfin dazubringen. Jellyfin ersetzt die Richtlinie bei jedem
Schreiben als Ganzes, deshalb liest die Console sie vorher und schreibt sie mit den geänderten
Feldern zurück, pro Benutzer eins nach dem anderen.

**Wann sie geschrieben wird:** beim Anlegen, beim Übernehmen und Zuweisen eines Benutzers, nach
jeder Änderung des Zugriffs eines Kontingents (Bibliotheken, Streams, Downloads, Bitrate) für alle
Zugänge der Organisation auf der Instanz, vier gleichzeitig, beim Sync für Zugänge, deren Richtlinie
abweicht, und mit "Richtlinie anwenden" im Admin-Bereich. Ändert nur die Zahl der Zugänge oder der
Code, schreibt die Console nichts. Schlägt das Schreiben für einen Zugang fehl, steht er mit dem
Hinweis "Richtlinie weicht ab" in der Liste, und der nächste Sync versucht es wieder.

**Im Dashboard von Jellyfin nicht ändern:** Wer eins dieser Felder bei einem verwalteten Zugang im
Dashboard ändert, sieht es nach ein oder zwei Sync-Läufen zurückgesetzt (im Audit-Log
`media.policy_repair` von "Sync"). Ein verwalteter Zugang, den jemand zum Administrator macht, wird
zurückgestuft, ausser er ist der letzte Administrator. Dauerhaft ändert man den Zugriff am
Kontingent.

### Bibliotheken, Streams, Bitrate und Downloads

- **Bibliotheken:** Ein Kontingent gibt Bibliotheken frei, die IDs liest der Dialog live von der
  Instanz. Die Console merkt sich Namen und Typ und aktualisiert sie beim Sync. Löscht jemand eine
  Bibliothek in Jellyfin, steht sie mit "Entfernt" im Kontingent und verschwindet beim nächsten
  Speichern. Live TV ist keine Bibliothek und bleibt aus. Benutzer mit alten gesperrten Bibliotheken
  (`BlockedMediaFolders`, aus früheren Versionen) ignorieren `EnabledFolders`, und die API kann das
  nicht ändern: Sie bekommen den Hinweis "Gesperrte Bibliotheken" und lassen sich nicht übernehmen.
- **Streams (Geräte):** `MaxActiveSessions` zählt angemeldete, aktive Geräte eines Zugangs und prüft
  die Zahl nur, wenn sich ein Gerät anmeldet. Es ist kein Zähler laufender Streams: Geräte, die
  schon angemeldet sind, bleiben es, wenn die Zahl sinkt, und wie lange eine geschlossene App noch
  zählt, ist nicht geprüft. Meldet ein Kunde "maximum number of sessions": ein neues Passwort
  setzen, das meldet alle Geräte ab.
- **Qualität unterwegs:** Höchste Bitrate für Geräte ausserhalb des Netzes des Servers, 1 bis 1000
  Mbit/s (Vorschläge 4, 8, 15, 25, 40), oder leer für die Einstellung des Servers. Der Wert des
  Zugangs ersetzt den des Servers, er ist nicht das Minimum aus beiden. Ohne `KnownProxies` greift
  er nicht (siehe Voraussetzungen).
- **Downloads** erlauben Offline-Kopien in den Apps. Das ist kein Kopierschutz: Gestreamte Inhalte
  lassen sich trotzdem speichern.

### Kontingente einrichten

Admin > Kunden > Kunde, Karte "Streaming" > Einrichten (Berechtigung `platform:media:write`):

- **Instanz:** alle Jellyfin-Provider (und der Demo-Provider). Alle Zugänge der Organisation liegen
  dort.
- **Kontingent-Code:** leer lassen für einen erzeugten
- **Zugänge höchstens** (1 bis 10000)
- **Bibliotheken** (mindestens eine), **gleichzeitige Streams** pro Zugang (1 bis 20), **Downloads**
  und **Qualität unterwegs**
- **Modul "Streaming" aktivieren** (Standard an). Bei einem Kunden eines Resellers nur, wenn der
  Reseller das Modul hat (sonst 409).

Die Instanz lässt sich nur wechseln, solange die Organisation keine Zugänge und keine
Kundenkontingente darauf hat. Senken geht nicht unter die bestehenden Zugänge (409 `account_limit`).
Engt weblion.one das Kontingent eines Resellers so ein, dass Kundenkontingente nicht mehr
hineinpassen, lehnt die Console mit 409 `allowance_conflict` ab und nennt die Kunden und was nicht
passt (Bibliotheken, Streams, Downloads, Bitrate, Zugänge). Einem Kunden eines Resellers kann
weblion.one auch mehr geben, als der Reseller hat (wie beim Cloud-Speicher, der Dialog warnt).
Entfernen geht nur ohne Zugänge und ohne Kundenkontingente und schaltet das Modul nicht ab. Die
Antwort nennt, auf wie viele Zugänge die Richtlinie angewendet wurde und wo es scheiterte. Im
Audit-Log stehen `media.allowance_set` (mit den bisherigen Werten und dem Ergebnis der Richtlinie)
und `media.allowance_delete`. Per API nur mit Login:
`PUT /api/v1/admin/orgs/<org-id>/media-allowance` mit z.B.
`{"providerId": "<provider-id>", "maxAccounts": 5, "libraryIds": ["<id>"], "maxStreams": 2, "downloads": false, "remoteBitrateMbit": 8, "enableModule": true}`,
`DELETE` auf denselben Pfad entfernt es.

Ohne Kontingent sieht der Kunde unter "Streaming" den Hinweis, Streaming bei weblion.one (oder
seinem Reseller) zu buchen.

### Reseller

- Ein Reseller bekommt von weblion.one ein Kontingent wie jeder Kunde, dazu das Modul "Streaming".
  Daraus legt er eigene Zugänge an und gibt seinen Kunden einen Teil: Reseller > Meine Kunden >
  Kunde > Ressourcen, Karte "Streaming". Die Instanz ist immer die des Resellers, Speichern
  aktiviert beim Kunden das Modul und wendet die Richtlinie auf seine Zugänge an.
- Ein Kundenkontingent darf nicht mehr geben als das des Resellers: nur seine Bibliotheken,
  höchstens seine Streams, Downloads nur, wenn er sie hat, und eine Bitrate-Grenze, wenn er eine
  hat, höchstens seine (409 `allowance_conflict`). Eigene Zugänge plus die Höchstwerte aller
  Kundenkontingente müssen in sein Kontingent passen (409 `account_limit` "Only N accounts of your
  allowance are left for this customer").
- "Kontingent entfernen" gibt es an den Reseller zurück, solange der Kunde keine Zugänge hat. Per
  API: `PUT` und `DELETE /api/v1/reseller/customers/<id>/media-allowance`, PUT mit
  `{"maxAccounts": 3, "libraryIds": ["<id>"], "maxStreams": 2, "downloads": false, "remoteBitrateMbit": 15}`.
- Zugänge selbst wandern nicht zwischen Reseller und Kunde. Ein Kunde mit Zugängen oder Kontingent
  lässt sich nicht löschen.

### Mehrere Instanzen

- Jede Instanz ist ein eigener Provider: die aus der `.env` und beliebig viele aus dem
  Admin-Bereich. Zugänge, Zwischenspeicher und Sperren gehören zur Verbindung, Benutzer-IDs gelten
  nur pro Instanz.
- Ein Kontingent nennt genau eine Instanz, eine Organisation hat höchstens ein Kontingent.
- **Gemeinsame Instanz:** Viele Organisationen haben ein Kontingent auf derselben Instanz. Die Codes
  trennen die Namen, die Richtlinie die Bibliotheken.
- **Dedizierte Instanz:** eine Instanz, auf der genau eine Organisation ein Kontingent hat, z.B. die
  eigene Jellyfin eines Kunden als neue Verbindung. Einen Schalter dafür gibt es nicht. Admin >
  Streaming zeigt pro Instanz "Dediziert", "Gemeinsam" oder "Ungenutzt". Kunden, die Wert auf
  Vertraulichkeit legen, gehören auf eine dedizierte Instanz (siehe Datenschutz).
- **Umzug auf eine andere Instanz:** Den Verlauf zwischen Servern umzuziehen geht nicht. Neue
  Verbindung anlegen, die Zugänge auf der alten löschen (oder lösen), die Instanz des Kontingents
  ändern, dann legt der Kunde die Zugänge neu an (oder weblion.one übernimmt Benutzer, die auf der
  neuen Instanz schon bestehen). Der Code bleibt, die Namen also auch.
- Ein Provider lässt sich nicht löschen, solange ein Kontingent auf ihn zeigt oder einer seiner
  Zugänge zugewiesen ist. Nicht zugewiesene Zugänge verschwinden mit ihm aus der Console (in
  Jellyfin bleiben sie).

### Admin-Bereich: Instanzen, übernehmen, zuweisen

Admin > Streaming:

- **Instanzen:** Nutzung (dediziert, gemeinsam, ungenutzt), Version, Benutzer und Bibliotheken,
  aktive Sitzungen und wie viele abspielen, Quick Connect, Zugänge und solche mit Hinweisen, live
  gelesen mit höchstens 10 Sekunden pro Instanz, dazu Synchronisieren.
- **Zugänge:** alle verwalteten Zugänge aller Instanzen, mit Filter nach Kunde, Instanz und "Nur mit
  Hinweisen", Suche nach Login-Name. Hier gehen auch Deaktivieren, Passwort und Löschen, auch für
  Zugänge ohne Kunde. **Zuweisen** gibt einen Zugang einer Organisation mit Kontingent auf derselben
  Instanz (sonst 409) und schreibt ihre Richtlinie. Ohne Organisation (lösen) läuft der Zugang mit
  seiner Richtlinie weiter, zum Abstellen deaktivieren oder löschen. **Richtlinie anwenden**
  schreibt sie sofort. Die Höchstzahl des Kontingents prüft die Console beim Zuweisen und Übernehmen
  bewusst nicht (der Dialog warnt).
- **Nicht verwaltete Benutzer:** "Benutzer abrufen" liest live alle Benutzer einer Instanz, die die
  Console nicht verwaltet, z.B. direkt in Jellyfin angelegte. "Übernehmen" verwaltet sie danach, auf
  Wunsch gleich bei einem Kunden (dann mit seiner Richtlinie). Name, Verlauf und Favoriten bleiben.
  Administratoren und Benutzer mit gesperrten Bibliotheken lassen sich nicht übernehmen. Ein
  Benutzer ohne Passwort nur zusammen mit einem neuen Passwort (sonst 409 `no_password`), das die
  Console einmal anzeigt (nur mit Login).

Im Audit-Log stehen `media.account_import`, `media.account_assign` und `media.policy_repair`. Per
API nur mit Login: `GET /api/v1/admin/providers/<id>/media/unmanaged`,
`POST /api/v1/admin/media/accounts/import` mit
`{"providerId": "<provider-id>", "userId": "<Jellyfin-ID>", "orgId": "<org-id>", "setPassword": false}`,
`POST /api/v1/admin/media/accounts/<id>/assign` mit `{"orgId": "<org-id>"}` oder `null`,
`POST /api/v1/admin/media/accounts/<id>/repair`.

### Sync

- Pro Sync-Lauf (alle `SYNC_INTERVAL_SECONDS`) und Instanz genau ein `GET /Users`: alle Benutzer mit
  Richtlinie. Für die Zugänge, die die Console verwaltet, übernimmt sie Name, aktiv oder
  deaktiviert, ob ein Passwort gesetzt ist, den Tag der letzten Aktivität und die Hinweise
  (Richtlinie weicht ab, Administrator, gesperrte Bibliotheken, ohne Passwort, nach Fehlversuchen
  gesperrt, kein Kontingent auf dieser Instanz).
- **Reparatur:** Weicht die Richtlinie eines Zugangs vom Kontingent seiner Organisation ab, schreibt
  der Sync sie neu, höchstens 25 pro Lauf und Instanz, jede im Audit-Log als `media.policy_repair`
  von "Sync" mit den Feldern, die abwichen. Eine abgelehnte Reparatur bleibt als Hinweis stehen und
  steht mit `status: failure` im Audit-Log.
- Fehlt ein Zugang in Jellyfin, zeigt die Console "In Jellyfin nicht gefunden". Zugänge, die während
  des Laufs angelegt oder geändert wurden, fasst der Sync nicht an. Benutzer, die die Console nicht
  kennt, legt er nicht an, er weist nichts zu und löscht nichts.
- Danach aktualisiert er Namen und Typ der Bibliotheken in den Kontingenten der Instanz.
- Ein einzelner Zugang (`GET /api/v1/media/accounts/<id>`) wird live nachgelesen. Von Hand: Admin >
  Streaming > Synchronisieren, oder Admin > Provider > Jellyfin > "Jetzt synchronisieren".

Jellyfin hat keine Ratenbegrenzung. Die Console schickt trotzdem höchstens vier Anfragen
gleichzeitig pro Instanz, jede mit 30 Sekunden Timeout, und wiederholt keine Änderung. Bibliotheken
hält sie 5 Minuten im Speicher, die Server-Info 10 Minuten, die Zahlen der Sitzungen 30 Sekunden.

### Was die Console nutzt

| Funktion in der Console                    | Endpunkt                                                                    | Berechtigung                                    |
| ------------------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------- |
| Verbindungstest, Server-Info               | `GET /System/Info`, `GET /QuickConnect/Enabled`                             | Admin-Bereich, `media:read` (Anmeldehilfe)      |
| Sync, nicht verwaltete Benutzer, Instanzen | `GET /Users`                                                                | Sync-Job, `platform:provider:read`              |
| Zugang lesen                               | `GET /Users/{id}`                                                           | `media:read`                                    |
| Zugang anlegen                             | `POST /Users/New` mit `Name` und `Password`, dann `POST /Users/{id}/Policy` | `media:write`                                   |
| Richtlinie, deaktivieren, aktivieren       | `GET /Users/{id}`, dann `POST /Users/{id}/Policy` mit der ganzen Richtlinie | `media:write`, `platform:media:write`, Sync-Job |
| Passwort neu setzen                        | `POST /Users/Password?userId={id}` mit `NewPw` und `ResetPassword: false`   | `media:password`, nur mit Login                 |
| Löschen                                    | `DELETE /Users/{id}`                                                        | `media:write`                                   |
| Bibliotheken                               | `GET /Library/VirtualFolders`                                               | `platform:provider:read`, Sync-Job              |
| Sitzungen zählen                           | `GET /Sessions?activeWithinSeconds=600` (nur zwei Zahlen)                   | `platform:provider:read`                        |
| API Explorer                               | jeder Pfad ausser den gesperrten                                            | `platform:explorer`, nur mit Login              |

`ResetPassword: true` schickt die Console nie, und sie legt nie einen Benutzer ohne Passwort an:
Beides hiesse in Jellyfin, dass man sich mit dem Namen allein anmeldet. Fehler von Jellyfin sagen
oft nichts ("Error processing request."). Nach einem 400 beim Anlegen sucht die Console deshalb den
Namen, um "vergeben" von "ungültig" zu unterscheiden, und prüft Namen vorher selbst.

### Fehler der API

Fehler kommen wie überall in der API als `{ "error": { "code", "message", "details" } }`. Für
Streaming:

| HTTP | `code`               | Wann                                                                                                                                                                                               |
| ---- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | `bad_request`        | Ungültige Eingabe (`details` nennt das Feld), API-Token ohne Passwort, falsche Bestätigung beim Löschen, unbekannte Bibliothek, ungültige Jellyfin-ID                                              |
| 403  | `forbidden`          | Recht fehlt, Modul nicht aktiv, Kunde gesperrt (nur lesen), "Passwort neu setzen" oder Übernehmen mit Passwort per API-Token                                                                       |
| 404  | `not_found`          | Zugang, Kunde oder Kontingent gibt es nicht, oder die Person sieht sie nicht                                                                                                                       |
| 404  | `provider_error`     | Jellyfin kennt den Benutzer nicht (mehr)                                                                                                                                                           |
| 409  | `no_allowance`       | Kein Kontingent (beim Anlegen, beim Übernehmen, Zuweisen oder Reparieren auf dieser Instanz, beim Weitergeben durch einen Reseller)                                                                |
| 409  | `account_limit`      | Kontingent voll, Höchstzahl unter den bestehenden Zugängen, Anteil des Resellers aufgebraucht                                                                                                      |
| 409  | `allowance_conflict` | Kundenkontingent gibt mehr als das des Resellers, oder das Kontingent eines Resellers wird enger als das seiner Kunden, `details.customers` mit den Konflikten                                     |
| 409  | `no_password`        | Übernehmen eines Benutzers ohne Passwort, ohne ein neues zu setzen                                                                                                                                 |
| 409  | `conflict`           | Name vergeben, Zugang schon verwaltet, Administrator, gesperrte Bibliotheken, Code vergeben oder nicht mehr änderbar, Instanz wechseln oder Kontingent entfernen mit Zugängen, Reseller ohne Modul |
| 422  | `unsupported`        | Der Provider kann kein Streaming                                                                                                                                                                   |
| 502  | `provider_error`     | Jellyfin hat abgelehnt oder war nicht erreichbar, `message` mit dem Grund, HTTP-Status und einem Hinweis (Schlüssel abgelehnt, Fernzugriff aus, Weiterleitung)                                     |

Schlägt eine Änderung bei Jellyfin fehl, steht das mit `status: failure` und der Meldung im
Audit-Log.

### API Explorer

Für alles ohne eigenen Button: Admin > API Explorer, Provider Jellyfin wählen.

- Pfade relativ zur Base URL, z.B. `/Users` oder `/Library/VirtualFolders`. Vorlagen: Server-Info,
  öffentliche Info, Benutzer, Bibliotheken, Quick Connect, aktive Sitzungen.
- GET und DELETE senden das JSON-Feld als Query, POST als JSON. Andere Methoden lehnt die Console
  ab.
- Gesperrt sind Pfade, die Zugangsdaten herausgeben oder erzeugen: `/Auth/Keys` (listet alle
  API-Schlüssel im Klartext), `/Startup`, die Anmeldungen (`/Users/AuthenticateByName`,
  `/Users/AuthenticateWithQuickConnect`, `/Users/{id}/Authenticate`), `/QuickConnect/Authorize` und
  `/Users/ForgotPassword`, auch mit `/emby` oder `/mediabrowser` davor (Jellyfin lässt das weg),
  dazu `..`, `//`, `\`, `#` und kodierte Punkte oder Schrägstriche.
- In Antworten sind Tokens, Schlüssel, Passwörter und PINs ausgeblendet, der Schlüssel der Console
  steht nie darin.
- Ändernde Requests stehen mit Pfad und Body im Audit-Log (`provider.explorer`), `NewPw`,
  `CurrentPw`, `Pw`, `Pin` und Passwörter ausgeblendet.
- Was über den Explorer geändert wird, prüft die Console nicht gegen Kontingente. Weicht danach eine
  Richtlinie ab, setzt der Sync sie zurück.

### Grenzen

- **Datenschutz auf einer gemeinsamen Instanz:** Jeder Zugang kann über die API von Jellyfin alle
  Benutzer des Servers mit Namen und letzter Aktivität auflisten. Die Apps zeigen das nicht, die API
  schon. Die Codes verraten keine Kunden, Namen wie "anna" aber, dass es eine Anna gibt. Wer das
  nicht will, bekommt eine dedizierte Instanz.
- **Sperren:** Ein gesperrter Kunde sieht seine Zugänge in der Console nur noch lesend. In Jellyfin
  bleiben sie aktiv. Wer den Zugang sperren will, deaktiviert die Zugänge. Ebenso lassen ein
  abgeschaltetes Modul und eine gelöste Zuweisung Jellyfin unberührt.
- **Abrechnung:** Kontingent und Dienst sind getrennt, eine Abrechnung pro Zugang gibt es nicht.
  Siehe [Roadmap](roadmap.md#streaming-jellyfin).
- **Ein Kontingent pro Organisation**, alle Zugänge auf seiner Instanz. Umziehen siehe oben.
- **Für alle Zugänge gleich:** Das Kontingent gilt für jeden Zugang der Organisation, einzelne
  Zugänge mit mehr Streams oder Downloads gibt es nicht.
- **Grosse Änderungen:** Eine Änderung am Kontingent schreibt die Richtlinie aller Zugänge in der
  Anfrage (vier gleichzeitig). Für Hunderte von Zugängen einer Organisation geht das, für Tausende
  wäre ein Hintergrund-Job nötig.
- **Aus:** Live TV, Plugin-Kanäle und SyncPlay ("gemeinsam schauen") sind für alle Zugänge aus.
- **Nicht in der Console**, das geht in Jellyfin: Bibliotheken und Inhalte, Servereinstellungen,
  Plugins, Live TV, Kindersicherung, "alle Geräte abmelden" (ein neues Passwort tut das).
- Den Inhalt der Bibliotheken liefert der Betreiber, die Console sieht ihn nicht.

Ideen dazu in der [Roadmap](roadmap.md).

### Offene Punkte

Gegen ein echtes Jellyfin ist die Anbindung noch nicht getestet, nur gegen einen Mock-Server nach
dem Quellcode von Jellyfin 10.11.11 (mit den Unterschieden von 10.10). Vor dem ersten echten Einsatz
einmal gegen 10.11 und einmal gegen 10.10 in einem Container prüfen: Verbindung testen, anlegen, die
Richtlinie im Dashboard ansehen (Bibliotheken, kein Administrator, versteckt), Quick Connect mit 1
Stream und einem zweiten Gerät ("maximum number of sessions"), Passwort ändern und Deaktivieren
melden ein angemeldetes Gerät ab, Löschen, die Bitrate von ausserhalb durch den Reverse Proxy. Dazu
die ungeprüften Annahmen:

1. Dass 10.11.11 die aktuelle stabile Version ist
2. Der Body von Fehlern 404 (ProblemDetails) und ob Texte wie "User not found" als JSON-String oder
   als Text kommen. Die Console liest beides.
3. Ob Jellyfin die Felder in Request-Bodys ohne Gross- und Kleinschreibung liest. Die Console
   schickt die Namen so, wie sie sie gelesen hat.
4. Ob jedes Datum ein `Z` trägt. Die Console liest Daten ohne Zone als UTC.
5. Wie lange eine geschlossene App gegen `MaxActiveSessions` zählt
6. Was `EnableContentDownloading` genau schützt, und was `EnableSyncTranscoding` und
   `EnableMediaConversion` bewirken (hier an Downloads gekoppelt)
7. Ob ein laufender Stream sofort abbricht, wenn ein Zugang gelöscht oder deaktiviert wird (die
   Tokens widerruft Jellyfin sofort)
8. Wie Jellyfin Anfragen ausserhalb des Basis-Pfads weiterleitet
9. Welche Zeichen die Bildschirmtastaturen von Fernsehern auf der ersten Seite zeigen (nur eine
   Frage der Bequemlichkeit für `-`)
10. Die Liste der Apps und die Adresse `https://jellyfin.org/downloads` auf der Anmeldehilfe
11. Ob Quick Connect in jedem Fernseh-Client geht
12. Der Name des Container-Images `jellyfin/jellyfin:10.11.11` für den Test
13. Ob das Dashboard `RemoteClientBitrateLimit` als Mbit/s mal 1 000 000 schreibt (die Console
    schreibt Bit pro Sekunde, das liest der Server, geprüft)

### Demo

Der Demo-Provider (`ENABLE_DEMO_PROVIDER=true`) simuliert eine Jellyfin 10.11.11 ("Demo Jellyfin")
mit den Bibliotheken Filme, Serien, Kinder, Musik und Dokumentationen im Speicher, mit denselben
Prüfungen wie die echte Anbindung. Die Adresse `https://media.demo.weblion.one` gibt es nicht,
"Jellyfin öffnen" führt ins Leere. Mit `pnpm db:seed`:

- Muster AG hat das Modul und ein Kontingent mit dem Code `kemaro` für 5 Zugänge (Filme, Serien,
  Kinder, 2 Streams, keine Downloads, 8 Mbit/s unterwegs) mit `anna-kemaro` und `wohnzimmer-kemaro`
  (nach Fehlversuchen gesperrt).
- Alpen Hosting (Reseller, Code `alpen`, 20 Zugänge, auch Musik, 3 Streams, Downloads, 20 Mbit/s)
  und Bäckerei Huber (Code `bivane`, 3 Zugänge, Filme und Kinder, mit `huber-bivane`) haben ein
  Kontingent, aber noch nicht das Modul. Die Richtlinie von `huber-bivane` weicht ab, der erste Sync
  repariert sie.
- Nicht verwaltet und im Admin-Bereich zu übernehmen: `ben-kemaro`, `gast` (ohne Passwort, nur mit
  neuem Passwort) und `altkunde` (gesperrte Bibliotheken, nicht übernehmbar), dazu der Administrator
  `weblion-admin`.

## Weitere Provider anbinden

Ein Provider ist eine Klasse, die `ProviderAdapter` aus
[`apps/api/src/providers/types.ts`](../apps/api/src/providers/types.ts) implementiert.
Pflicht sind Inventar (`listServers`, `getServer`) und `capabilities()`. Alles andere ist
optional: Die Console blendet Tabs und Buttons automatisch aus, wenn ein Provider eine
Funktion nicht anbietet. Registrieren in `providers/registry.ts`, Typ in
`packages/shared/src/providers.ts` ergänzen, fertig.

Ein reiner Domain-Provider wie Joker.com liefert bei `listServers` eine leere Liste. Seine
Domain-Funktionen meldet er mit `domainCapabilities()`, die DNS-Typen, die er annimmt, mit
`dnsRecordTypes()`. Die Werte von DNS-Einträgen haben für alle Provider dasselbe Format
(beschrieben an `DnsRecord` in `packages/shared/src/hosting.ts`), der Adapter rechnet um. Im
Web halten `providerHasServers()` in `components/server-bits.tsx` und `HOSTING_PROVIDERS` in
`pages/admin/hosting.tsx` fest, welche Typen Server bzw. Domains haben.

Verkauft ein Provider feste Grössen (wie Hetzner), liefert der Adapter `listPlans()` und
`listLocations()`. Rescale und Server erstellen zeigen dann Typ und Standort statt freier
Werte für CPU, RAM und Disk.

Ein Provider für Cloud-Speicher wie Nextcloud liefert ebenfalls keine Server. Er implementiert
`listCloudAccounts`, `getCloudAccount`, `createCloudAccount`, `updateCloudAccount`,
`setCloudAccountPassword` und `deleteCloudAccount`. Erst mit allen sechs gilt er als
Cloud-Provider (`supportsCloud()` in `apps/api/src/modules/cloud/service.ts`), sonst lehnt die API
Kontingente auf ihm mit 422 (`unsupported`) ab. Optional sind `resendCloudInvite` (Einladung
erneut senden) und `cloudLoginUrl` (Adresse zum Anmelden). Kontingente, Login-Namen, Gruppen und
Passwörter erledigt das Modul `cloud`, der Adapter spricht nur mit der Instanz. Im Web hält
`isCloudProvider()` in `pages/admin/cloud.tsx` fest, welche Typen Cloud-Konten haben.

Ein DNS-Provider ohne Registrierung wie Cloudflare meldet mit `domainKind()` die Art `"zone"`
(ohne die Methode gilt `"registration"`). Seine Zonen kommen über `listDomains`. Optional sind
`checkZoneActivation` (wartende Zone prüfen), `getCdnSettings`, `updateCdnSetting` und
`purgeCache` (mit der Fähigkeit `cdn`) sowie `createZone` mit `canCreateZones()` für den DNS-Umzug.
Die Fähigkeiten `dnsProxy`, `dnsTtlAuto` und `cnameFlattening` schalten Proxy-Schalter,
automatische TTL und CNAME für `@` in der Console frei. Die Verknüpfung von Registrierung und Zone
sowie der Umzug brauchen im Adapter nichts weiter, das erledigen `modules/hosting/service.ts` und
`modules/hosting/zones.ts`.

Ein Provider für E-Mail wie Mailcow liefert ebenfalls keine Server. Er implementiert
`listMailDomains`, `getMailDomain`, `listMailboxes`, `getMailbox`, `createMailbox`, `updateMailbox`,
`setMailboxPassword`, `deleteMailbox`, `listMailAliases`, `getMailAlias`, `createMailAlias`,
`updateMailAlias`, `deleteMailAlias`, `getDkim` und `mailClientSettings`. Erst mit allen gilt er als
E-Mail-Provider (`supportsMail()` in `apps/api/src/modules/mail/service.ts`), sonst antwortet die API
mit 422 (`unsupported`). Für den Admin-Bereich kommen `createMailDomain`, `updateMailDomain` und
`deleteMailDomain` dazu, optional `createDkim`, `deleteDkim` und `mailPasswordPolicy`. Die Prüfung
der Limits, Passwörter und die DNS-Einträge erledigt das Modul `mail`, der Adapter spricht nur mit
der Instanz. Grössen nimmt er in ganzen MiB und meldet sie in Bytes. Im Web hält
`isMailProvider()` in `pages/admin/mail.tsx` fest, welche Typen Mail-Domains haben.

Ein Provider für Websites wie CloudPanel liefert ebenfalls keine Server. Er implementiert
`listWebsites`, `websiteServerOptions` und `createWebsite`, erst damit gilt er als Website-Provider
(`supportsWebsites()` in `apps/api/src/modules/hosting/website-service.ts`), sonst antwortet die API
mit 422 (`unsupported`). Für die einzelnen Funktionen kommen `deleteWebsite`, `setWebsitePassword`,
`createWebsiteDatabase`, `setWebsiteDatabasePassword`, `deleteWebsiteDatabase` und
`issueWebsiteCertificate` dazu, für den Admin-Bereich `listUnmanagedWebsites`, `adoptWebsite` und
`forgetWebsite`. Fehlt eine davon, lehnt die Route mit 422 ab. Optional sind `getWebsite` (Live-Daten
der Detailseite), `websiteAccessHost` (Host für SFTP/SSH) und `websiteServerInfo` (was der Server
hat, für den Admin-Bereich). Websites adressiert der Adapter über die ASCII-Domain, Passwörter
bekommt er nur zum Weitergeben. Kontingente, Prüfungen, Passwörter und die DNS-Prüfung erledigt das Hosting-Modul
(`website-service.ts`, `website-allowance.ts`, `website-dns.ts`, `websites.ts`). Im Web hält
`isWebsiteProvider()` in `pages/admin/websites.tsx` fest, welche Typen Websites haben.

Ein Provider für Telefonie wie 3CX liefert ebenfalls keine Server. Er implementiert
`listPhoneSystems` und `getPhoneSystem`, erst damit gilt er als Telefonie-Provider
(`supportsPhone()` in `apps/api/src/modules/phone/service.ts`). Was er darüber hinaus kann, ergibt
sich aus seinen Methoden (`phoneCapabilities()`): `listPhoneUsers`, `getPhoneUser`,
`createPhoneUser`, `updatePhoneUser` und `deletePhoneUser` zusammen ergeben `users`,
`nextPhoneNumber` ergibt `nextNumber`, `sendPhoneWelcome` `welcomeMail`, `listPhoneRingGroups`
`ringGroups`, `addPhoneRingGroupMember` und `removePhoneRingGroupMember` `ringGroupMembers`,
`listPhoneTrunks` `trunks`. Fehlt eine Fähigkeit, blendet die Console Tab oder Button aus, und die
Route antwortet mit 422. Eine Verbindung darf mehrere Anlagen melden (der Demo-Provider meldet
drei), jede Methode bekommt die ID der Anlage. Zuweisung, Prüfungen und Audit erledigt das Modul
`phone`, der Adapter spricht nur mit der Anlage und gibt nie Passwörter oder PINs heraus. Im Web
hält `isPhoneProvider()` in `lib/api/phone.ts` fest, welche Typen Telefonanlagen haben.

Ein Provider für Streaming wie Jellyfin liefert ebenfalls keine Server. Er implementiert
`listMediaUsers`, `getMediaUser`, `createMediaUser`, `setMediaUserPolicy`, `setMediaUserEnabled`,
`setMediaUserPassword`, `deleteMediaUser`, `listMediaLibraries` und `mediaLoginUrl`. Erst mit allen
gilt er als Streaming-Provider (`supportsMedia()` in `apps/api/src/modules/media/service.ts`), sonst
antwortet die API mit 422 (`unsupported`). Optional sind `mediaServerInfo` (Version, Servername,
Quick Connect) und `mediaActivity` (die zwei Zahlen der Sitzungen). Die Richtlinie kommt als
`MediaPolicyState` (17 Felder, `packages/shared/src/media.ts`), der Adapter übersetzt sie in die
Felder des Servers und lässt alle anderen, wie sie sind. Kontingente, Login-Namen, Codes, erzeugte
Passwörter und der Vergleich der Richtlinie liegen im Modul `media`. Im Web hält `isMediaProvider()`
in `pages/admin/media.tsx` fest, welche Typen Streaming haben.

Ein Provider für Monitoring wie Uptime Kuma liefert ebenfalls keine Server. Zum Lesen implementiert
er `listMonitors` und `getMonitor` (`supportsMonitoring()` in
`apps/api/src/modules/monitoring/service.ts`), zum Verwalten `createMonitor`, `updateMonitor`,
`pauseMonitor`, `resumeMonitor` und `deleteMonitor`, und `monitorManagement()` muss `true` melden
(`canManageMonitors()`). Optional sind `getMonitorHistory` mit `monitorHistoryRanges`,
`monitoringStatus`, `getStatusPage` mit `statusPageUrl`, `signInForManagement`,
`redactExplorerAudit` (Geheimnisse in Explorer-Requests vor dem Audit ausblenden) und `close`
(offene Sitzungen schliessen, wenn die Registry den Adapter ersetzt). `listMonitors` meldet mit
`complete`, ob die Liste auch pausierte Monitore enthält. Kontingente, die Prüfung öffentlicher
Ziele und die Namen mit Kürzel erledigt das Modul `monitoring`. Im Web hält `isMonitoringProvider()`
in `lib/api/monitoring.ts` fest, welche Typen Monitore haben.
