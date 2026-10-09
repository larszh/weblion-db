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
- **Transfersperre:** Die Console speichert den neuen Zustand sofort. Kennt eine Endung keine
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
  Einstellung sofort.
- **Jetzt verlängern:** 1 bis 10 Jahre. Die Console liest zuerst das aktuelle Ablaufdatum per
  `query-whois` und sendet `domain-renew` mit `expyear` = Ablaufjahr plus Jahre, also ein
  Zieljahr statt einer Laufzeit. Joker verlängert nur bis zu diesem Jahr, ein doppelter Klick
  oder ein wiederholter Request verlängert deshalb nicht doppelt. Danach liest die Console die
  Domain neu, damit das neue Ablaufdatum sichtbar ist.

Im Audit-Log stehen `domain.auto_renew` und `domain.renew`. Per API (nur mit Session):
`POST /api/v1/admin/domains/<id>/auto-renew` mit `{"enabled": true}` und
`POST /api/v1/admin/domains/<id>/renew` mit `{"years": 1}`. Dem Kunden stellt die Console
Verlängerungen nicht automatisch in Rechnung, siehe
[billing.md](billing.md#domain-verlängerungen).

### Auth-Code

Joker erzeugt den Auth-Code asynchron: `domain-transfer-get-auth-id` startet einen Auftrag mit
Proc-ID, den Code liefert später `result-retrieve`. Die Console fragt bis zu rund 12 Sekunden
nach. Ist der Code dann noch nicht da, meldet sie "Auth-Code wird erstellt" (409,
`authcode_pending`). Der nächste Klick fragt denselben Auftrag erneut ab, statt einen neuen zu
starten. Die Proc-ID merkt sich die Console 30 Minuten pro Domain, nur im Speicher des
API-Prozesses. Nach einem Neustart startet der nächste Klick einen neuen Auftrag.

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

## Domain-Funktionen im Vergleich

Jeder Adapter meldet, was er bei Domains kann, die Console zeigt nur das an. Ruft jemand per
API etwas auf, das der Provider nicht kann, antwortet sie mit 422 (`unsupported`).

|                                       | 24fire      | Joker.com                 | Demo                |
| ------------------------------------- | ----------- | ------------------------- | ------------------- |
| DNS-Einträge ansehen                  | ja          | ja, mit Joker-Nameservern | ja                  |
| DNS-Einträge ändern                   | mit 24fire+ | ja, mit Joker-Nameservern | ja                  |
| TTL pro Eintrag                       | nein        | ja                        | ja                  |
| NAPTR, E-Mail-Weiterleitung           | nein        | ja                        | ja                  |
| ALIAS, NS, PTR, TLSA, DS, DNSKEY      | ja          | nein                      | ja                  |
| Nameserver ändern                     | nein        | ja                        | ja                  |
| Transfersperre                        | nein        | ja                        | ja                  |
| Auth-Code                             | ja          | ja, asynchron             | ja                  |
| Automatische Verlängerung, Verlängern | nein        | ja, nur weblion.one       | ja, nur weblion.one |

Der Demo-Provider (`ENABLE_DEMO_PROVIDER=true`) simuliert alle Funktionen im Speicher, mit
den Regeln von Joker (TTL ab 300 Sekunden, eine Auftragsnummer wie die Proc-ID). Zum
Ausprobieren: `muster-shop.ch` nutzt Cloudflare-Nameserver (Hinweis "andere Nameserver", DNS nur lesend),
`muster-ag.ch` hat einen DynDNS-Eintrag (nur lesen), `alpenblick-hotel.ch` Einträge für NAPTR,
Weiterleitung und E-Mail-Weiterleitung.

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
