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
                                       │                       └─> Mailcow API (E-Mail-Domains)
                                       │    ├─ Abrechnung ──> Stripe (Karte, TWINT), Zoho Books
                                       │    └─ E-Mail der Console (SMTP)
                                       ├─ Websocket-Bridge für die Konsole (noVNC)
                                       └─ Jobs: Sync (Server, Domains und Zonen, Webspaces,
                                          Cloud-Konten, Mail-Domains, Tasks), wiederkehrende
                                          Abrechnung
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
  Joker.com, Cloudflare (ein Konto oder Token pro Verbindung), Nextcloud, Mailcow (eine Instanz
  pro Verbindung), ... mit verschlüsselten Zugangsdaten
- `servers`: Cache der Provider-Server, `project_id` leer heisst "noch nicht zugewiesen"
- `domains`, `webspaces`: Cache der Domains und Webspaces aus Provider-Konten, wie Server
  einem Kunden zugewiesen oder nicht. `domains.info` hält Status, Ablauf, Nameserver,
  Transfersperre, Inhaber usw. und wird Feld für Feld aktualisiert. Auch die DNS-Zonen bei
  Cloudflare sind Zeilen in `domains` (`info.zone` mit Zonenstatus, bisherigen Nameservern, Tarif).
  Ob eine Zeile eine Registrierung oder eine Zone ist, sagt der Adapter (`domainKind()`), es wird
  nicht gespeichert. Ein Index auf `lower(name)` findet Registrierung und Zone desselben Namens
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
- `server_actions`: über die Console ausgelöste Aktionen mit Provider-Task-Referenz
- `products`, `services`, `invoices`, `invoice_lines`, `payments`, `credit_transactions`,
  `billing_profiles`, `number_sequences`: Abrechnung, siehe [billing.md](billing.md)
- `mail_log`: jede versendete (oder übersprungene) E-Mail
- `audit_logs`: unveränderliches Protokoll (wer, was, wann, Ergebnis, IP)
- `api_tokens`, `sessions`, `invitations`

## Rechte-Modell

Jede Aktion hat einen Namen wie `server:power` oder `server:backup:restore`. Ressourcen sind
Pfade relativ zur Organisation: `project/<id>`, `project/<id>/server/<id>`, `domain/<id>` (auch
DNS-Zonen), `webspace/<id>`, `maildomain/<id>`, `member/<id>`. Cloud-Konten haben keinen eigenen
Pfad, für sie gilt die Organisation als Ganzes (`org`). Postfächer und Weiterleitungen gehören zum
Pfad ihrer Mail-Domain.
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
   `domain:*`, `webspace:*`, `cloud:*`, `mail:*`) werden verweigert, als zusätzliche Regel in der
   Grenze.
6. **Reseller**: Gehört die Organisation zu einem Reseller, gilt dessen Grenze (inkl. Module
   und Sperre) zusätzlich. Mitarbeitende des Resellers, die beim Kunden kein Mitglied sind,
   handeln dort mit ihrer Reseller-Rolle und -Policies, wenn diese
   `reseller:customer:access` erlauben, und bleiben an beide Grenzen gebunden. Ist der
   Reseller gesperrt, dürfen sie beim Kunden nur noch lesen (auch nicht bezahlen).

Server, die man nicht sehen darf, liefern 404 statt 403, damit ihre Existenz nicht verraten
wird.

Einige Aktionen gehen nur mit Login, nie per API-Token: Auth-Codes und Plesk-Passwörter
ansehen, Passwörter von Cloud-Konten und Postfächern neu setzen, Domains verlängern und die
automatische Verlängerung schalten (kostet beim Registrar Geld, Berechtigung
`platform:domain:write`), DNS zu Cloudflare umziehen (`platform:domain:move`) und der API
Explorer. Cloud-Konten legt ein API-Token nur mit Einladung per E-Mail an, Postfächer nur mit
einem Passwort, das es selbst mitschickt. Ein erzeugtes Passwort bekommt es nie.

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

| Provider      | Adapter                | Server            | Besonderheiten                                                                                                        |
| ------------- | ---------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| 24fire        | `providers/fire24`     | KVM               | Domains, DNS und Webspaces, manche Funktionen nur mit 24fire+                                                         |
| Proxmox VE    | `providers/proxmox`    | VMs und Container | Firewall, Erstellen aus Templates, Konsole über `vncwebsocket`                                                        |
| Hetzner Cloud | `providers/hetzner`    | Cloud-Server      | Feste Server-Typen (`listPlans`) und Standorte (`listLocations`), Konsole über `request_console`, Standort pro Server |
| Joker.com     | `providers/joker`      | keine             | Reiner Domain-Provider: DNS-Zone, Nameserver, Transfersperre, Verlängerung, Auth-Code                                 |
| Cloudflare    | `providers/cloudflare` | keine             | DNS-Zonen (Art "zone"): Einträge mit Proxy, CDN-Einstellungen, Aktivierung, Zonen anlegen für den DNS-Umzug           |
| Nextcloud     | `providers/nextcloud`  | keine             | Cloud-Speicher: Benutzer einer eigenen Instanz mit Kontingent, Einladung, Passwort, Sync der Belegung                 |
| Mailcow       | `providers/mailcow`    | keine             | E-Mail: Mail-Domains mit Limits, Postfächer, Weiterleitungen, DKIM, Passwortrichtlinie einer eigenen Instanz          |
| Demo          | `providers/demo`       | simuliert         | Für Entwicklung und Tests, inkl. Server-Typen, Standorten, Domain-Funktionen, Nextcloud, Mailcow und Cloudflare       |

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

## Sync

Der Sync-Job holt alle `SYNC_INTERVAL_SECONDS` das Inventar jedes Providers, legt neue
Server, Domains, DNS-Zonen, Webspaces und Mail-Domains als "nicht zugewiesen" an und markiert
verschwundene als `missing`. Liefert ein Provider in der Liste nicht alle Felder (Joker.com z.B.
keine Nameserver, die kommen erst live beim Öffnen der Domain), bleibt der gespeicherte Wert.
Neue Cloudflare-Zonen weist er dem Kunden der gleichnamigen Registrierung zu (siehe oben).
Bei Nextcloud aktualisiert er Belegung, Kontingent und Status der Konten, die die Console
verwaltet. Für unbekannte Benutzer legt er nichts an, die übernimmt weblion.one von Hand. Bei
Mailcow liest er pro Instanz einmal alle Mail-Domains mit Limits und Verbrauch. Eine Zeile, die die
Console während des Laufs geändert hat, überschreibt er nicht.
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
- Neue Passwörter (Root-Passwörter, Cloud-Konten, Postfächer) zeigt die Console einmal an und
  speichert sie nicht, auch nicht im Audit-Log
- Vom Cloudflare-Token zeigt der Admin-Bereich nur Anfang und Ende, vom Mailcow-API-Key gar nichts.
  Clients folgen keinen Weiterleitungen, damit Zugangsdaten nie an einen anderen Host gehen
- Der API Explorer protokolliert ändernde Requests, Werte von Passwort-, Token- und
  Secret-Feldern aber ausgeblendet
- Strenge Content-Security-Policy, keine Inline-Skripte
- Konsole über einmalige, 60 Sekunden gültige Tickets
- Jede schreibende Aktion landet im Audit-Log, auch fehlgeschlagene Logins
