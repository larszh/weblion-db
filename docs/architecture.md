# Architektur

```
Browser ──HTTPS──> Reverse Proxy ──> Console-Container (Node 22)
                                       ├─ Web (React, statisch ausgeliefert)
                                       ├─ REST API /api/v1 (Fastify)
                                       │    ├─ Auth: Session-Cookie oder API-Token
                                       │    ├─ IAM: Rollen + Policies + Kundengrenze
                                       │    └─ Provider-Adapter ──> 24fire API (DE)
                                       │                       ├─> Proxmox API (CH)
                                       │                       ├─> Hetzner Cloud API (DE, FI, US, SG)
                                       │                       ├─> Joker.com DMAPI (Domains)
                                       │                       ├─> Cloudflare API (DNS-Zonen, CDN)
                                       │                       ├─> Nextcloud OCS API (Cloud-Speicher)
                                       │                       ├─> Mailcow API (E-Mail-Domains)
                                       │                       ├─> CloudPanel-Server per SSH
                                       │                       │   (Root-Wrapper weblion-clp, Websites)
                                       │                       ├─> 3CX XAPI (Telefonie)
                                       │                       ├─> Jellyfin API (Streaming)
                                       │                       └─> Uptime Kuma: /metrics, Statusseiten,
                                       │                           Socket.IO zum Verwalten (Monitoring)
                                       │    ├─ Abrechnung ──> Stripe (Karte, TWINT), Zoho Books
                                       │    └─ E-Mail der Console (SMTP)
                                       ├─ Websocket-Bridge für die Konsole (noVNC)
                                       └─ Jobs: Sync (Server, Domains und Zonen, Webspaces,
                                          Cloud-Konten, Mail-Domains, Websites,
                                          Telefonanlagen, Streaming-Zugänge, Monitore,
                                          Tasks), wiederkehrende Abrechnung
                                     Postgres (Benutzer, Kunden, Inventar, Rechnungen, Audit-Log)
```

## Pakete

- `packages/shared`: Katalog aller Berechtigungen, Rollen, Policy-Auswertung, API-Typen.
  Die API entscheidet damit, die Console blendet damit Buttons aus. Gleiche Regeln an
  beiden Stellen, aber nur die API ist massgeblich.
- `apps/api`: Fastify, Drizzle ORM, Postgres. Module unter `src/modules/*`, Provider unter
  `src/providers/*`.
- `apps/web`: React 19, Vite, Tailwind 4, TanStack Query, Radix-Primitives, Recharts, noVNC.

## Datenmodell (Kurzfassung)

- `organizations`: Kunden, Reseller und interne Organisationen, mit `boundary`
  (Berechtigungsgrenze), `modules` (freigeschaltete Module) und `parent_org_id` (Reseller)
- `memberships`: Benutzer in Organisationen mit Rolle, `membership_policies` hängt Policies an
- `projects`: gruppieren Server innerhalb einer Organisation
- `provider_connections`: 24fire, Proxmox, Hetzner Cloud (ein Projekt pro Verbindung),
  Joker.com, Cloudflare (ein Konto oder Token pro Verbindung), Nextcloud, Mailcow, Jellyfin, Uptime
  Kuma (eine Instanz pro Verbindung, bei Uptime Kuma mit optionalem Sitzungstoken für die
  Verwaltung), CloudPanel (ein Server pro Verbindung, mit SSH-Schlüssel und gepinntem
  Host-Schlüssel), 3CX (eine Telefonanlage pro Verbindung), ... mit verschlüsselten Zugangsdaten
- `servers`: Cache der Provider-Server, `project_id` leer heisst "noch nicht zugewiesen"
- `domains`, `webspaces`: Cache der Domains und Webspaces aus Provider-Konten, wie Server
  einem Kunden zugewiesen oder nicht. `domains.info` hält Status, Ablauf, Nameserver,
  Transfersperre, Inhaber usw. und wird Feld für Feld aktualisiert. Auch die DNS-Zonen bei
  Cloudflare sind Zeilen in `domains` (`info.zone` mit Zonenstatus, bisherigen Nameservern, Tarif).
  Ob eine Zeile eine Registrierung oder eine Zone ist, sagt der Adapter (`domainKind()`), es wird
  nicht gespeichert. Ein Index auf `lower(name)` findet Registrierung und Zone desselben Namens.
  `webspaces.kind` trennt die Webspaces der Provider (`webspace`, 24fire) von den Websites auf
  CloudPanel (`website`, `external_id` = Domain in der `xn--`-Form, `name` in Unicode, Fakten der
  Site in `info.site`). Websites haben einen `status` (`active`, `creating`, `deleting`, `error`),
  Webspaces sind immer `active`
- `webspace_databases`: MySQL-Datenbanken der Websites mit Benutzer, Grösse und Status, eindeutig
  pro Verbindung und Name (MySQL-Namen gelten pro Server). Passwörter stehen nie in der Datenbank
- `website_allowances`: Website-Kontingent pro Organisation: der CloudPanel-Server für neue
  Websites (der Provider lässt sich nicht löschen, solange ein Kontingent auf ihn zeigt), Websites
  und Datenbanken höchstens, erlaubte Arten (`php`, `static`, `nodejs`)
- `cloud_allowances`: Cloud-Speicher-Kontingent pro Organisation, auf genau einer
  Nextcloud-Instanz, mit Speicher gesamt und optional einer Höchstzahl an Konten. Prüfungen und
  Änderungen laufen unter einem Advisory Lock pro Organisation (der Reseller zuerst), parallele
  Anfragen können ein Kontingent also nicht überziehen
- `cloud_accounts`: Nextcloud-Konten (`external_id` = Login-Name) mit Kontingent und Belegung
  aus dem Sync. `org_id` leer heisst wie bei Servern "nicht zugewiesen", `missing_since`
  "in Nextcloud nicht gefunden"
- `mail_domains`: Mail-Domains bei Mailcow (`external_id` = Domain in der `xn--`-Form, `name` in
  Unicode), eindeutig pro Verbindung, mit Limits und Verbrauch in `info`. `org_id` leer heisst
  "nicht zugewiesen", `missing_since` "bei Mailcow nicht gefunden". Postfächer, Weiterleitungen,
  DKIM-Schlüssel und Passwörter stehen nie in der Datenbank
- `phone_systems`: Telefonanlagen der 3CX-Verbindungen (`external_id` `pbx`, der Demo-Provider
  meldet drei pro Verbindung), eindeutig pro Verbindung, mit Status, Gründen (`status_reasons`) und
  den Fakten in `info` (Version, Edition, Lizenz, Gespräche, Benutzer, Leitungen, Nummernlänge, nie
  der Lizenzschlüssel). `org_id` leer heisst "nicht zugewiesen", `missing_since` "nicht mehr
  gefunden". Benutzer, Ringgruppen und Leitungen stehen nie in der Datenbank
- `media_allowances`: Streaming-Kontingent pro Organisation auf genau einer Jellyfin-Instanz (der
  Provider lässt sich nicht löschen, solange ein Kontingent auf ihn zeigt), mit Kontingent-Code
  (eindeutig), Zugängen höchstens, den Bibliotheken (ID, Name, Typ), Streams, Downloads und Bitrate
- `media_accounts`: Jellyfin-Benutzer, die die Console verwaltet (`external_id` = Jellyfin-ID, die
  beim Umbenennen bleibt), mit Login-Name, aktiv, Passwort gesetzt, letzter Aktivität und Hinweisen
  (`issues`). `org_id` leer heisst "nicht zugewiesen". Passwörter, Richtlinien, Sitzungen und
  Verlauf stehen nie in der Datenbank
- `monitors`: Monitore der Uptime-Kuma-Instanzen (`external_id` = ID in Uptime Kuma, eindeutig pro
  Verbindung) mit Herkunft (`kuma` oder `console`), Typ, Ziel, `target_host` (für die Server- und
  Domain-Seiten), Status, aktiv, Intervall und den letzten Zahlen in `facts`. `org_id` leer heisst
  "nicht zugewiesen", `missing_since` "nicht mehr gemeldet". Geheimnisse der Monitore stehen nie in
  der Datenbank
- `monitor_allowances`: Monitoring-Kontingent pro Organisation auf einer Instanz (die sich nicht
  löschen lässt, solange es besteht), Monitore höchstens und kürzestes Prüfintervall
- `monitor_status_pages`: die verknüpfte öffentliche Statusseite einer Organisation pro Instanz
  (Slug, optional eine eigene Adresse)
- `server_actions`: über die Console ausgelöste Aktionen mit Provider-Task-Referenz
- `products`, `services`, `invoices`, `invoice_lines`, `payments`, `credit_transactions`,
  `billing_profiles`, `number_sequences`: Abrechnung, siehe [billing.md](billing.md)
- `mail_log`: jede versendete (oder übersprungene) E-Mail
- `audit_logs`: unveränderliches Protokoll (wer, was, wann, Ergebnis, IP)
- `api_tokens`, `sessions`, `invitations`

## Rechte-Modell

Jede Aktion hat einen Namen wie `server:power` oder `server:backup:restore`. Ressourcen sind
Pfade relativ zur Organisation: `project/<id>`, `project/<id>/server/<id>`, `domain/<id>` (auch
DNS-Zonen), `webspace/<id>` (auch Websites), `maildomain/<id>`, `phone/<id>` (Telefonanlagen),
`monitor/<id>`, `member/<id>`. Cloud-Konten und Streaming-Zugänge haben keinen eigenen Pfad, für sie
gilt die Organisation als Ganzes (`org`), ebenso für das Anlegen einer Website oder eines Monitors.
Postfächer und Weiterleitungen gehören zum Pfad ihrer Mail-Domain, Datenbanken zum Pfad ihrer
Website, Benutzer, Ringgruppen und Leitungen zum Pfad ihrer Telefonanlage.
Eine Policy-Regel erlaubt oder verweigert Aktionen auf Ressourcen, optional nur für Server
mit bestimmten Labels (`env=prod`). Wildcards mit `*`.

Auswertung einer Anfrage:

1. **API-Token** (falls verwendet): Das Token kann nur einschränken, nie erweitern, und gilt
   nur für seine Organisation. Tokens tragen keine Plattform-Rechte.
2. **Plattform-Rolle** (weblion.one Staff): Superadmin darf alles, Support lesen und bedienen.
3. **Rolle + angehängte Policies** des Mitglieds. Ein explizites Verweigern gewinnt immer.
4. **Berechtigungsgrenze** der Organisation, gesetzt von weblion.one. Standard für Kunden:
   alles ausser Server löschen, Rescale und Rohkonfiguration. Pro Kunde im Admin-Bereich
   freischaltbar. Gesperrte Kunden dürfen nur noch lesen (und bezahlen).
5. **Module**: Aktionen eines nicht freigeschalteten Moduls (`server:*`/`project:*`,
   `domain:*`, `webspace:*`, `cloud:*`, `mail:*`, `phone:*`, `media:*`, `monitor:*`) werden
   verweigert, als zusätzliche Regel in der Grenze.
6. **Reseller**: Gehört die Organisation zu einem Reseller, gilt dessen Grenze (inkl. Module
   und Sperre) zusätzlich. Mitarbeitende des Resellers, die beim Kunden kein Mitglied sind,
   handeln dort mit ihrer Reseller-Rolle und -Policies, wenn diese
   `reseller:customer:access` erlauben, und bleiben an beide Grenzen gebunden. Ist der
   Reseller gesperrt, dürfen sie beim Kunden nur noch lesen (auch nicht bezahlen).

Server, die man nicht sehen darf, liefern 404 statt 403, damit ihre Existenz nicht verraten
wird.

Einige Aktionen gehen nur mit Login, nie per API-Token: Auth-Codes und Plesk-Passwörter
ansehen, Passwörter von Cloud-Konten, Postfächern, Websites und ihren Datenbanken und
Streaming-Zugängen neu setzen, die Willkommens-E-Mail eines Telefonie-Benutzers erneut senden und
seine E-Mail-Adresse ändern (`phone:credentials`), Domains verlängern und die automatische
Verlängerung schalten (kostet beim Registrar Geld, Berechtigung `platform:domain:write`), DNS zu
Cloudflare umziehen (`platform:domain:move`), Websites im Admin-Bereich anlegen, übernehmen und
entfernen (`platform:website:write`), Uptime Kuma für die Verwaltung an- und abmelden und der API
Explorer. Cloud-Konten legt ein API-Token nur mit Einladung per E-Mail an, Telefonie-Benutzer mit
der Willkommens-E-Mail an die Adresse, die es selbst angibt, Postfächer, Websites, Datenbanken und
Streaming-Zugänge nur mit einem Passwort, das es selbst mitschickt. Ein erzeugtes Passwort bekommt
es nie.

## Provider-Schicht

`ProviderAdapter` beschreibt alles, was ein Provider können kann. Jeder Adapter meldet
seine Fähigkeiten (`capabilities()`), die Console zeigt nur Passendes an. Für Domains
meldet er zusätzlich `domainCapabilities()` (DNS, TTL, Nameserver, Transfersperre,
Verlängerung, Auth-Code, bei Cloudflare automatische TTL, Proxy, CNAME für `@` und CDN), die
DNS-Typen, die er annimmt (`dnsRecordTypes()`), und mit `domainKind()`, ob seine Domains
Registrierungen oder DNS-Zonen sind. Neue
Plattformen (Webhosting-Panels, Grafana, ...) kommen als weiterer Adapter dazu, ohne dass sich
Rechte, UI-Grundgerüst oder API ändern.

Angebundene Provider:

| Provider      | Adapter                | Server            | Besonderheiten                                                                                                                                       |
| ------------- | ---------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 24fire        | `providers/fire24`     | KVM               | Domains, DNS und Webspaces, manche Funktionen nur mit 24fire+                                                                                        |
| Proxmox VE    | `providers/proxmox`    | VMs und Container | Firewall, Erstellen aus Templates, Konsole über `vncwebsocket`                                                                                       |
| Hetzner Cloud | `providers/hetzner`    | Cloud-Server      | Feste Server-Typen (`listPlans`) und Standorte (`listLocations`), Konsole über `request_console`, Standort pro Server                                |
| Joker.com     | `providers/joker`      | keine             | Reiner Domain-Provider: DNS-Zone, Nameserver, Transfersperre, Verlängerung, Auth-Code                                                                |
| Cloudflare    | `providers/cloudflare` | keine             | DNS-Zonen (Art "zone"): Einträge mit Proxy, CDN-Einstellungen, Aktivierung, Zonen anlegen für den DNS-Umzug                                          |
| Nextcloud     | `providers/nextcloud`  | keine             | Cloud-Speicher: Benutzer einer eigenen Instanz mit Kontingent, Einladung, Passwort, Sync der Belegung                                                |
| Mailcow       | `providers/mailcow`    | keine             | E-Mail: Mail-Domains mit Limits, Postfächer, Weiterleitungen, DKIM, Passwortrichtlinie einer eigenen Instanz                                         |
| CloudPanel    | `providers/cloudpanel` | keine             | Websites über SSH und den Root-Wrapper `weblion-clp`: anlegen, Passwörter, Datenbanken, Let's Encrypt, löschen                                       |
| 3CX           | `providers/threecx`    | keine             | Telefonie: eine Telefonanlage pro Verbindung über die XAPI (OAuth2), Benutzer, Willkommens-E-Mail, Ringgruppen, Leitungen (lesend)                   |
| Jellyfin      | `providers/jellyfin`   | keine             | Streaming: Benutzer einer eigenen Instanz mit verwalteter Richtlinie (Bibliotheken, Streams, Downloads, Bitrate), Passwörter, Bibliotheken           |
| Uptime Kuma   | `providers/uptimekuma` | keine             | Monitoring: `/metrics` und Statusseiten zum Lesen, Socket.IO der Weboberfläche zum Verwalten (nur wenn angemeldet)                                   |
| Demo          | `providers/demo`       | simuliert         | Für Entwicklung und Tests, inkl. Server-Typen, Standorten, Domain-Funktionen, Nextcloud, Mailcow, Cloudflare, CloudPanel, 3CX, Jellyfin, Uptime Kuma |

Provider mit festen Grössen (Hetzner) liefern `listPlans()` und `listLocations()`. Rescale und
Server erstellen zeigen dann Server-Typen und Standorte statt freier Werte. Meldet ein Provider
den Standort pro Server (`meta.datacenter` mit Stadt und ISO-Ländercode), zeigt die Console
diesen statt des Standorts der Verbindung.

Für Cloud-Speicher verwaltet ein Adapter die Benutzer einer Instanz (`listCloudAccounts`,
`createCloudAccount`, `updateCloudAccount`, `setCloudAccountPassword`, `deleteCloudAccount`
usw.). Kontingente, Login-Namen (`<Name>@<Kürzel der Organisation>`), Gruppen und erzeugte
Passwörter regelt das Modul `src/modules/cloud`, der Adapter spricht nur mit der Instanz. Details
in [providers.md](providers.md#nextcloud-cloud-speicher).

### DNS-Zonen (Cloudflare)

Cloudflare-Zonen sind Domains der Art "zone" in derselben Tabelle und denselben Routen wie
Registrierungen (`src/modules/hosting`). Was nur Zonen haben, liegt in
`src/modules/hosting/zones.ts`: CDN-Einstellungen (`/domains/:id/cdn`, Cache leeren), die
Aktivierungsprüfung wartender Zonen und der DNS-Umzug. Der Proxy-Schalter ist ein Feld des
DNS-Eintrags (`proxied`), Provider ohne die Fähigkeit `dnsProxy` bekommen es nie zu sehen.

- **Verknüpfung:** `GET /domains/:id` sucht Zeilen desselben Namens (`lower(name)`, nicht fehlend)
  der anderen Art und liefert die beste, die die Person lesen darf, als `dnsZone` (bei einer
  Registrierung) bzw. `registration` (bei einer Zone). Zonen gehen nach Status: aktiv, wartend,
  der Rest. Gespeichert wird die Verknüpfung nicht.
- **Erste Zuweisung:** Sieht der Sync eine Zone zum ersten Mal und gehören die Registrierungen
  desselben Namens bei anderen Providern genau einem Kunden, weist er die Zone diesem Kunden zu
  (Audit `domain.assign` mit Auslöser "Sync"). Später weist er nie neu zu.
- **DNS-Umzug** (`/admin/domains/:id/dns-move`, nur Plattform, nur mit Login): Die reinen Teile
  (welche Einträge, wie umgewandelt) stehen in `dns-move.ts`, der Ablauf in `zones.ts`:

  ```
  Registrierung (Joker) ──1──> Zone anlegen oder wiederverwenden (Cloudflare, POST /zones)
                       ──2──> Einträge lesen ──> planen ──> in die leere Zone kopieren (4 parallel)
                       ──3──> nur wenn 2 vollständig: Nameserver beim Registrar auf die Zone
  ```

  Jeder Schritt wird einzeln auditiert (`domain.zone_create`, `domain.dns_import`,
  `domain.nameservers_update`) und im Ergebnis gemeldet, zum Schluss `domain.dns_move`. Nur ein
  Fehler in Schritt 1 lässt den Request scheitern. Ein Set im Prozess verhindert zwei gleichzeitige
  Umzüge derselben Domain. Wiederholen ist sicher: Die Zone wird wiederverwendet, in eine Zone mit
  Einträgen wird nie kopiert.

Der Cloudflare-Client hält pro Verbindung ein eigenes Anfrage-Budget (1000 in 5 Minuten), höchstens
vier Anfragen gleichzeitig und kurze Zwischenspeicher für Zone, Einträge und CDN. Details in
[providers.md](providers.md#cloudflare-dns-und-cdn).

### E-Mail (Mailcow)

Das Modul `src/modules/mail` verkauft Mail-Domains auf Mailcow-Instanzen. Gespeichert sind nur die
Mail-Domains (`mail_domains`), Postfächer und Weiterleitungen liest es live über den Adapter der
Verbindung, zu der die Domain gehört. Mehrere Instanzen sind mehrere Verbindungen, jede Route
adressiert Mail-Domains über ihre ID, nie über den Namen.

- **Limits** setzt nur weblion.one (`platform:mail:write`), Mailcow setzt sie durch. Das Modul
  prüft sie vorher selbst (409 `mail_limit`) und legt Postfächer und Weiterleitungen einer Domain
  nacheinander an: Ein Postgres-Advisory-Lock pro Mail-Domain (`pg_advisory_xact_lock`) gilt,
  solange Mailcow arbeitet, weil dessen Zählen und Anlegen nicht atomar ist. Scheitert Mailcow in
  der Transaktion, wird erst nach dem Rollback auditiert, damit die Transaktion keine zweite
  Pool-Verbindung braucht.
- **Passwörter** erzeugt das Modul (oder nimmt das gewählte), zeigt sie einmal an und speichert sie
  nie, auch nicht im Audit-Log.
- **Reseller** geben Mail-Domains als Ressourcentyp `maildomain` weiter, wie Domains.
- **DNS-Einträge** (`src/modules/mail/dns.ts`): Die erwarteten Einträge (MX, SPF, DKIM, DMARC,
  Autodiscover) entstehen aus dem Mailserver-Hostnamen der Instanz und dem DKIM-Schlüssel. Das
  Modul sucht die Domain desselben Namens in `domains`, die die Person lesen darf, und vergleicht
  mit deren Einträgen:

  ```
  Mail-Domain ──> erwartete Einträge (Mailcow: Host, DKIM)
              ──> Domain desselben Namens im Modul "dns" (Joker, Cloudflare, 24fire)
                  ──> Einträge live lesen ──> Status je Eintrag: ok, fehlt, weicht ab, unbekannt
  "Fehlende Einträge hinzufügen" ──> nur Status "fehlt", nacheinander, über den Adapter der Zone
  ```

  Hinzugefügt wird mit dem Code des Hosting-Moduls (`domainChange`, `providerTtl`,
  `assertRecordType`), also mit denselben Prüfungen und Audit-Einträgen (`domain.dns_add`) wie von
  Hand, dazu `mail.dns_apply`. Was abweicht, ändert das Modul nie.

Details in [providers.md](providers.md#mailcow-e-mail).

### Websites (CloudPanel)

Websites sind Webspaces der Art `website` im Modul "Webhosting" (`webspace:*`): dieselbe Tabelle,
dieselben Routen für Liste und Detail (`/orgs/:orgId/webspaces`, `/webspaces/:id`), dieselbe
Zuweisung und Weitergabe durch Reseller. Was nur Websites haben, liegt in `src/modules/hosting`:
`websites.ts` (Routen), `website-service.ts` (Laden, Zustände, Fakten in die Zeile schreiben,
Prüfungen), `website-allowance.ts` (Kontingente) und `website-dns.ts` (DNS-Prüfung). Die
Muster und Hilfen, die Console und API teilen (Domain, Site-User, Datenbank-Namen, Passwörter),
stehen in `packages/shared/src/websites.ts`.

- **Kontingent:** Anlegen läuft wie beim Cloud-Speicher unter einem Advisory Lock pro Organisation
  (`website:<id>`, der Reseller zuerst) und einem pro Domain. Die Website (und ihre Datenbank) wird
  erst als Zeile mit Status `creating` reserviert, dann erst ruft die Console den Server, ohne
  Sperre. So zählen laufende Anlagen schon zum Kontingent.
- **Ausgang einer Änderung:** Lehnt der Server ab oder hat er zurückgerollt, verschwindet die
  Reservierung. Ist der Ausgang unklar (Zeitüberschreitung, abgerissene Verbindung), wird die Zeile
  `error` (beim Anlegen mit `meta.credentialsDelivered = false`, weil niemand das Passwort gesehen
  hat), und der Sync klärt sie.
- **Passwörter** erzeugt die API (24 Zeichen ohne Sonderzeichen) oder nimmt das gewählte, schickt
  sie nur in den `secrets` der Anfrage an den Server und gibt sie einmal zurück
  (`Cache-Control: no-store`). Gespeichert und auditiert wird nur, ob es erzeugt oder gewählt war.
- **DNS-Prüfung** vor Let's Encrypt: A und AAAA der Domain und ihres www-Gegenstücks bei den
  Resolvern aus `DNS_CHECK_RESOLVERS` (nie beim System-Resolver), verglichen mit den Adressen des
  Servers, 60 Sekunden zwischengespeichert.

**Transport.** CloudPanel hat keine API. Der Adapter (`src/providers/cloudpanel`) spricht per SSH
mit dem Paket `ssh2` (`ssh.ts`):

```
CloudPanelAdapter ──> CloudPanelClient ──> Ssh2Transport ──SSH──> sshd (Match User weblion-agent,
 (Auswahl, Caches)    (eine Operation       (ein Client pro        ForceCommand)
                       nach der anderen,     Verbindung, nach       ──> sudo -n /usr/local/sbin/weblion-clp
                       höchstens 20          60 s ohne Anfrage          (ohne Argumente)
                       wartend)              geschlossen)               ──> clpctl, chpasswd, mysql,
                                                                            SQLite von CloudPanel (lesend)
```

- Anmeldung nur mit dem ed25519-Schlüssel der Verbindung, nie mit Passwort oder Agent. Der
  Host-Schlüssel muss ed25519 sein und zum gespeicherten Fingerabdruck passen (`SHA256:...`,
  Vergleich in konstanter Zeit während des Schlüsseltauschs, vor jeder Anmeldung). Kein "beim
  ersten Mal vertrauen".
- Pro Operation ein Exec-Kanal ohne Terminal: eine Zeile JSON auf stdin, dann EOF. stdout wird auf
  4 MiB, stderr auf 64 KiB begrenzt. Jede Operation hat eine Wartezeit, etwas länger als die des
  Wrappers (z.B. Anlegen 330 s, Zertifikat und Löschen 200 s, Lesen 30 bis 60 s). Läuft sie ab,
  schliesst die Console den Kanal (504), der Wrapper arbeitet weiter.
- Scheitert etwas, bevor die Anfrage den Server erreicht (Verbindung, Host-Schlüssel, Anmeldung,
  Kanal), gilt das als zurückgerollt: Es ist nichts passiert.
- Der Adapter hält `info` 10 Minuten und die Liste 15 Sekunden, jede Änderung leert die Liste.

**Protokoll v1** (`protocol.ts`, Gegenstück im Wrapper):

```
{"v":1,"op":"create","requestId":"6f0c1c6e-...","args":{"domain":"shop.kunde.ch","type":"php",
 "phpVersion":"8.4","template":"WordPress","siteUser":"shop-kunde-ch",
 "database":{"name":"shop_kunde_ch_wp","userName":"shop_kunde_ch_wp"}},
 "secrets":{"password":"…","databasePassword":"…"}}

{"v":1,"ok":true,"data":{"site":{"domain":"shop.kunde.ch","type":"php","siteUser":"shop-kunde-ch",...},"warnings":[]}}
{"v":1,"ok":false,"error":{"code":"exists","field":"siteUser","message":"The Linux user shop-kunde-ch already exists on this server"}}
```

Operationen: `info`, `list`, `get`, `unmanaged` (lesend), `create`, `delete`, `password`, `db-add`,
`db-delete`, `db-password`, `cert`, `adopt`, `forget`. Exit-Code 0 mit `ok: true`, 1 mit
`ok: false`, alles andere (auch 127, kein JSON, falsches `v`) ist ein Transportfehler. Die
Fehlercodes des Wrappers bildet `wireError()` auf die API ab: `invalid` 400, `exists`,
`not_managed`, `protected`, `adopt_disabled` 409, `not_found` 404, `busy` 503, `version` 422,
`clpctl_failed`, `timeout`, `internal` 502 mit `rolledBack` und der Ausgabe von `clpctl`.
Unbekannte Felder in Antworten ignoriert die Console, unbekannte Felder in Anfragen lehnt der
Wrapper ab. Jede Antwort prüft die Console mit einem Schema pro Operation, und jeder Text, der aus
einer Antwort in eine Meldung, ein Log oder das Audit-Log gelangt, läuft durch `redactSecrets()`.

**Server-Seite.** Der Wrapper (`deploy/cloudpanel-agent/weblion-clp`, Python, nur
Standardbibliothek) ist die eigentliche Grenze: geschlossene Liste von Operationen, Muster für
jedes Argument, Befehle ohne Shell, eine Liste verwalteter Sites und eine Schutzliste auf dem
Server, Wegwerf-Passwörter für `clpctl` (die echten nur über stdin), Prüfung jeder Änderung in der
SQLite-Datenbank von CloudPanel statt über Exit-Codes, eine Sperre pro Server (`flock`). Details in
[deploy/cloudpanel-agent/README.md](../deploy/cloudpanel-agent/README.md).

Mehrere Server sind mehrere Verbindungen: Jede Zeile, jeder Aufruf, jeder Zwischenspeicher und
jeder Sync-Lauf gehört zu einer Verbindung, Routen adressieren Websites über ihre ID. Details in
[providers.md](providers.md#cloudpanel-websites).

### Telefonie (3CX)

Das Modul `src/modules/phone` (`service.ts`, `routes.ts`) zeigt Telefonanlagen und verwaltet ihre
Benutzer und Ringgruppen. Gemeinsame Typen, Prüfungen (Nummern, Rufnummern) und die Bewertung des
Zustands (`phoneSystemHealth()`) stehen in `packages/shared/src/phone.ts`.

- **Gespeichert** wird nur die Anlage (`phone_systems`). Benutzer, Ringgruppen und Leitungen liest
  die Route live über den Adapter der Verbindung, zu der die Anlage gehört. Jede Adapter-Methode
  bekommt die ID der Anlage, eine Verbindung darf mehrere melden (3CX genau eine, `pbx`).
- **Änderungen** laufen über `phoneChange()`: Aufruf bei der Anlage ohne offene Transaktion, dann
  Audit `phone.*`, auch bei einem Fehler. Geschützte Benutzer (Administratoren, Systembenutzer,
  unbekannte Rolle) löschen nur Plattform-Rollen, und nur sie ändern deren E-Mail-Adresse.
- **Zuweisung** wie bei Domains: `org_id` der Zeile, dazu das Modul. Reseller geben Anlagen als
  Ressourcentyp `phone_system` weiter.

Der Adapter (`src/providers/threecx`) spricht OData v4 mit der XAPI:

```
ThreeCxAdapter ──> ThreeCxClient ──HTTPS──> POST /connect/token (Client Credentials)
 (Caches 20 s       (ein Token pro           ──> GET/POST/PATCH/DELETE /xapi/v1/...
  bis 10 min,        Verbindung und              (jede Anfrage mit $select)
  eine Änderung      Prozess, höchstens
  pro Ringgruppe)    4 Anfragen gleichzeitig)
```

3CX lässt pro API-Client nur ein gültiges Token zu. Der Client teilt deshalb ein Token für alle
Anfragen (eine Anmeldung gleichzeitig), holt bei 401 einmal ein neues und versucht nach einer
abgelehnten Anmeldung 60 Sekunden lang keine neue. Jede Leseanfrage nennt ihre Felder mit
`$select`, weil die XAPI sonst SIP-Passwörter, PINs und den Lizenzschlüssel mitliefert. Details in
[providers.md](providers.md#3cx-telefonie).

### Streaming (Jellyfin)

Das Modul `src/modules/media` (`service.ts`, `routes.ts`) verkauft Zugänge auf Jellyfin-Instanzen,
nach dem Muster des Cloud-Speichers: ein Kontingent pro Organisation auf genau einer Instanz,
Prüfungen unter einem Advisory Lock pro Organisation (`media:<id>`, der Reseller zuerst), Anlegen
in der Transaktion mit dem Aufruf bei Jellyfin (`inTransaction`), Audit erst nach dem Rollback,
wenn Jellyfin scheitert. Legt Jellyfin den Benutzer an und das Speichern scheitert danach, löscht
das Modul ihn dort wieder. Typen, Namen, Passwortregeln und das Modell der Richtlinie stehen in
`packages/shared/src/media.ts`.

- **Login-Namen** entstehen aus Name und Kontingent-Code (`mediaUsername()`). Der Code ist eindeutig
  (Index auf `account_code`) und wird beim Erzeugen auch gegen die Namen geprüft, die es auf der
  Instanz schon gibt.
- **Passwörter** erzeugt das Modul (`node:crypto`, 16 Zeichen) oder nimmt das gewählte, gibt sie
  einmal zurück (`Cache-Control: no-store`) und speichert sie nie.
- **Datenschutz:** Von der letzten Aktivität gibt die API nur den Tag heraus (`mediaActivityDay()`,
  Europe/Zurich), von den Sitzungen einer Instanz nur zwei Zahlen.

**Die Richtlinie** ist das Herz des Moduls. Die Console besitzt 17 Felder der Benutzer-Richtlinie
von Jellyfin, alle anderen gehören dem Betreiber:

```
media_allowances ──mediaAccessOf()──> MediaAccess (Bibliotheken, Streams, Downloads, Bitrate)
                 ──expectedMediaPolicy()──> MediaPolicyState (17 Felder, Soll)

Schreiben (Adapter, pro Benutzer eins nach dem anderen):
  GET /Users/{id} ──> ganze Richtlinie ──applyPolicyState()──> 17 Felder ersetzt, Rest wie gelesen
                  ──> POST /Users/{id}/Policy (Jellyfin übernimmt immer die ganze Richtlinie)

Vergleichen (Sync):
  GET /Users ──parseJellyfinUser()──> MediaPolicyState (Ist)
             ──mediaPolicyDrift(Ist, Soll)──> abweichende Felder
             ──> höchstens 25 Reparaturen pro Lauf, Audit media.policy_repair von "Sync",
                 sonst Hinweis "policy" am Zugang
```

Geschrieben wird beim Anlegen (gleich nach `POST /Users/New`, scheitert es, wird der Benutzer
gelöscht), beim Übernehmen und Zuweisen, nach jeder Änderung am Zugriff eines Kontingents für alle
Zugänge der Organisation (nach dem Commit, vier gleichzeitig) und beim Sync. Aus Ist und Soll
entstehen die Hinweise eines Zugangs (`mediaAccountIssues()`: `policy`, `administrator`,
`blocked_folders`, `no_password`, `locked_out`, `no_allowance`). Details in
[providers.md](providers.md#jellyfin-streaming).

### Monitoring (Uptime Kuma)

Das Modul `src/modules/monitoring` (`service.ts`, `routes.ts`, `targets.ts`) zeigt Monitore,
verwaltet Kontingente und Statusseiten und legt eigene Monitore der Kunden an. Typen und die
Prüfung der Ziele ohne DNS stehen in `packages/shared/src/monitoring.ts`.

Uptime Kuma hat zwei Wege hinein, und der Adapter (`src/providers/uptimekuma`) hält sie getrennt:

```
UptimeKumaAdapter ──> KumaHttpClient (client.ts) ──HTTP(S)──> GET /metrics (Basic, API-Schlüssel)
 (Caches,         │                                       ──> GET /api/status-page/... (öffentlich)
  Wahl der Quelle)│
                  └─> KumaSocket (socket.ts) ──Websocket /socket.io/──> loginByToken (Sitzungstoken)
                       nur mit Sitzungstoken,                          ──> 9 erlaubte Events
                       höchstens 4 Aufrufe gleichzeitig,
                       nach 3 Minuten ohne Aufruf geschlossen
```

- **Lesen** geht immer über `/metrics` (30 Sekunden im Speicher geteilt, Uptime Kuma erlaubt 60
  Anfragen pro Minute für die ganze Instanz) und die öffentlichen Statusseiten. Das ist die
  dokumentierte, stabile Oberfläche.
- **Verwalten** geht über die Socket.IO-Events der Weboberfläche von Uptime Kuma. Nur `socket.ts`
  kennt Socket.IO (`socket.io-client`), und nur die Events in `KUMA_EVENTS` gehen hinaus
  (`getMonitorList`, `getMonitor`, `add`, `editMonitor`, `pauseMonitor`, `resumeMonitor`,
  `deleteMonitor`, `getMonitorChartData`, `monitorImportantHeartbeatListPaged`), auch aus dem API
  Explorer. Der Rest der Console sieht nur die Methoden des Adapters.
- **Wenn der Socket scheitert** (Update von Uptime Kuma, Token widerrufen, Uptime Kuma 3.x), liefert
  `listMonitors()` die Monitore aus `/metrics` mit `complete: false` und `managementError`. Der
  Sync läuft weiter, `monitoringStatus()` meldet den Fehler, Änderungen scheitern mit dieser
  Meldung. Ein Update von Uptime Kuma kann also höchstens die Verwaltung brechen, nie die Liste.
- **Sitzungstoken:** Die Anmeldung (`kumaSignIn()`, eigener kurzer Socket) tauscht Benutzername,
  Passwort und Zwei-Faktor-Code gegen das Token von Uptime Kuma. Gespeichert wird nur das Token,
  verschlüsselt mit der Konfiguration der Verbindung. Ändert sich die Adresse, verwirft die Console
  es, und die Registry schliesst den Socket des alten Adapters (`close()`).
- **Geheimnisse der Monitore:** `getMonitor` liefert sie mit. Für `editMonitor` hält der Adapter
  das ganze Objekt nur im Speicher (lesen, ändern, schreiben, weil Uptime Kuma fehlende Felder
  leert), nach aussen geht nur `toMonitorConfig()`. Antworten und Audits des Explorers laufen durch
  `redactMonitorSecrets()`.

Im Modul: Kontingente wie beim Cloud-Speicher unter einem Advisory Lock pro Organisation
(`monitor:<id>`, der Reseller zuerst). Gezählt werden Monitore aus der Console und bei Resellern die
Höchstwerte der Kundenkontingente. Ziele prüft `assertPublicTarget()` vor der Transaktion (DNS kann
dauern), private und reservierte Adressen lehnt es ab. Monitore aus der Console heissen in Uptime
Kuma `[<Kürzel>] <Name>`. Die Monitore auf Server- und Domain-Seiten findet die API über
`target_host` (exakte Namen, keine DNS-Abfrage). Details in
[providers.md](providers.md#uptime-kuma-monitoring).

## Sync

Der Sync-Job holt alle `SYNC_INTERVAL_SECONDS` das Inventar jedes Providers, legt neue
Server, Domains, DNS-Zonen, Webspaces, Mail-Domains und Websites als "nicht zugewiesen" an
und markiert verschwundene als `missing`. Liefert ein Provider in der Liste nicht alle Felder
(Joker.com z.B. keine Nameserver, die kommen erst live beim Öffnen der Domain), bleibt der
gespeicherte Wert.
Neue Cloudflare-Zonen weist er dem Kunden der gleichnamigen Registrierung zu (siehe oben).
Bei Nextcloud aktualisiert er Belegung, Kontingent und Status der Konten, die die Console
verwaltet. Für unbekannte Benutzer legt er nichts an, die übernimmt weblion.one von Hand. Bei
Mailcow liest er pro Instanz einmal alle Mail-Domains mit Limits und Verbrauch. Bei CloudPanel
liest er pro Server einmal alle verwalteten Sites (`list`) mit Datenbanken und Belegung: Neue
kommen als nicht zugewiesen dazu, fehlende werden markiert, eine Website mit Status `error`, die der
Server hat, wird aktiv, und Anlagen, die der Server nach 10 Minuten nicht hat, verschwinden.
Websites, die gerade gelöscht werden, lässt er in Ruhe. Eine Zeile, die die Console während des
Laufs geändert hat, überschreibt er nicht.
Bei 3CX liest er pro Verbindung den Systemstatus (die Parameter alle 10 Minuten) und speichert
Fakten und Zustand der Anlage. Benutzer, Ringgruppen und Leitungen synchronisiert er nicht. Bei
Jellyfin liest er pro Instanz einmal alle Benutzer, aktualisiert nur die verwalteten Zugänge,
markiert fehlende, repariert abweichende Richtlinien (höchstens 25 pro Lauf) und aktualisiert die
Namen der Bibliotheken in den Kontingenten. Unbekannte Benutzer legt er nicht an. Bei Uptime Kuma
liest er `/metrics` und, wenn die Instanz angemeldet ist, höchstens alle 10 Minuten die
vollständige Liste über den Socket. Neue Monitore kommen als nicht zugewiesen dazu, fehlende werden
markiert. Ohne vollständige Liste bleibt ein zuletzt pausierter Monitor pausiert, weil Uptime Kuma
pausierte Monitore in `/metrics` nicht meldet. Ein Fehler der Verwaltung lässt den Sync nicht
scheitern.
Läuft für eine Verbindung schon ein Sync (der Timer, der erste nach dem Anlegen), wartet ein
weiterer Aufruf darauf und startet danach einen eigenen, so deckt das Ergebnis immer den Stand beim
Aufruf ab.
Ein zweiter Job verfolgt laufende Provider-Tasks (z.B. Proxmox-UPIDs) und schliesst
Aktionen ab. Beide laufen hinter Postgres-Advisory-Locks, also auch mit mehreren
API-Instanzen nur einmal.

## Sicherheit

- Passwörter mit scrypt, Login-Sperre nach 10 Fehlversuchen, Rate-Limits
- Sessions als zufällige Tokens, in der DB nur als SHA-256, Cookie `HttpOnly`, `SameSite=Lax`,
  `Secure` bei https
- CSRF-Schutz: Cookie-authentifizierte Schreibzugriffe brauchen `X-Requested-With` und eine
  passende `Origin`
- TOTP-2FA, Secrets verschlüsselt in der DB
- Provider-Zugangsdaten AES-256-GCM-verschlüsselt, nie in API-Antworten (nur maskiert)
- Root-Passwörter aus Provider-Konfigurationen werden ausgeblendet
- Neue Passwörter (Root-Passwörter, Cloud-Konten, Postfächer, Websites und ihre Datenbanken,
  Streaming-Zugänge) zeigt die Console einmal an und speichert sie nicht, auch nicht im Audit-Log
- Vom Cloudflare-Token zeigt der Admin-Bereich nur Anfang und Ende, vom Mailcow-API-Key und den
  Schlüsseln für 3CX und Jellyfin gar nichts, vom API-Schlüssel für Uptime Kuma nur die Nummer und
  vom Sitzungstoken nur, ob es gesetzt ist. Clients folgen keinen Weiterleitungen, damit
  Zugangsdaten nie an einen anderen Host gehen
- 3CX: Jede Leseanfrage nennt ihre Felder (`$select`), SIP-Passwörter, PINs und der
  Lizenzschlüssel kommen so gar nicht erst an. Passwörter oder PINs der Anlage setzt die Console nie
- Jellyfin: Jeder API-Schlüssel ist ein voller Administrator. Der Explorer sperrt `/Auth/Keys` und
  die Anmelde-Endpunkte, die Console legt nie einen Benutzer ohne Passwort an und verwaltet keine
  Administratoren
- Uptime Kuma: Das Sitzungstoken ist ein Generalschlüssel der Instanz und verlässt die
  verschlüsselte Konfiguration nur zum Socket. Nur eine feste Liste von Events geht hinaus,
  Geheimnisse der Monitore werden nie gespeichert oder gezeigt, und Kunden können keine privaten
  oder internen Ziele überwachen lassen
- CloudPanel: Vom SSH-Schlüssel zeigt der Admin-Bereich nur den öffentlichen. Der Host-Schlüssel
  jedes Servers ist gepinnt, und auf dem Server darf der Schlüssel nur den Root-Wrapper ausführen,
  nur von den Adressen der Console. Der Wrapper ändert nur Sites, die die Console verwaltet, und nie
  geschützte (z.B. die Console selbst)
- Der API Explorer protokolliert ändernde Requests, Werte von Passwort-, Token- und
  Secret-Feldern aber ausgeblendet
- Strenge Content-Security-Policy, keine Inline-Skripte
- Konsole über einmalige, 60 Sekunden gültige Tickets
- Jede schreibende Aktion landet im Audit-Log, auch fehlgeschlagene Logins
