# Architektur

```
Browser ──HTTPS──> Reverse Proxy ──> Console-Container (Node 22)
                                       ├─ Web (React, statisch ausgeliefert)
                                       ├─ REST API /api/v1 (Fastify)
                                       │    ├─ Auth: Session-Cookie oder API-Token
                                       │    ├─ IAM: Rollen + Policies + Kundengrenze
                                       │    └─ Provider-Adapter ──> 24fire API (DE)
                                       │                       ├─> Proxmox API (CH)
                                       │                       └─> Hetzner Cloud API (DE, FI, US, SG)
                                       │    ├─ Abrechnung ──> Stripe (Karte, TWINT), Zoho Books
                                       │    └─ E-Mail (SMTP)
                                       ├─ Websocket-Bridge für die Konsole (noVNC)
                                       └─ Jobs: Sync (Server, Domains, Webspaces, Tasks),
                                          wiederkehrende Abrechnung
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
- `provider_connections`: 24fire, Proxmox, Hetzner Cloud (ein Projekt pro Verbindung), ... mit
  verschlüsselten Zugangsdaten
- `servers`: Cache der Provider-Server, `project_id` leer heisst "noch nicht zugewiesen"
- `domains`, `webspaces`: Cache der Domains und Webspaces aus Provider-Konten, wie Server
  einem Kunden zugewiesen oder nicht
- `server_actions`: über die Console ausgelöste Aktionen mit Provider-Task-Referenz
- `products`, `services`, `invoices`, `invoice_lines`, `payments`, `credit_transactions`,
  `billing_profiles`, `number_sequences`: Abrechnung, siehe [billing.md](billing.md)
- `mail_log`: jede versendete (oder übersprungene) E-Mail
- `audit_logs`: unveränderliches Protokoll (wer, was, wann, Ergebnis, IP)
- `api_tokens`, `sessions`, `invitations`

## Rechte-Modell

Jede Aktion hat einen Namen wie `server:power` oder `server:backup:restore`. Ressourcen sind
Pfade relativ zur Organisation: `project/<id>`, `project/<id>/server/<id>`, `domain/<id>`,
`webspace/<id>`, `member/<id>`.
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
   `domain:*`, `webspace:*`) werden verweigert, als zusätzliche Regel in der Grenze.
6. **Reseller**: Gehört die Organisation zu einem Reseller, gilt dessen Grenze (inkl. Module
   und Sperre) zusätzlich. Mitarbeitende des Resellers, die beim Kunden kein Mitglied sind,
   handeln dort mit ihrer Reseller-Rolle und -Policies, wenn diese
   `reseller:customer:access` erlauben, und bleiben an beide Grenzen gebunden. Ist der
   Reseller gesperrt, dürfen sie beim Kunden nur noch lesen (auch nicht bezahlen).

Server, die man nicht sehen darf, liefern 404 statt 403, damit ihre Existenz nicht verraten
wird.

## Provider-Schicht

`ProviderAdapter` beschreibt alles, was ein Provider können kann. Jeder Adapter meldet
seine Fähigkeiten (`capabilities()`), die Console zeigt nur Passendes an. Neue Plattformen
(Webhosting-Panels, Grafana, ...) kommen als weiterer Adapter dazu, ohne dass sich Rechte,
UI-Grundgerüst oder API ändern.

Angebundene Server-Provider:

| Provider      | Adapter             | Server            | Besonderheiten                                                                                                        |
| ------------- | ------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| 24fire        | `providers/fire24`  | KVM               | Domains, DNS und Webspaces, manche Funktionen nur mit 24fire+                                                         |
| Proxmox VE    | `providers/proxmox` | VMs und Container | Firewall, Erstellen aus Templates, Konsole über `vncwebsocket`                                                        |
| Hetzner Cloud | `providers/hetzner` | Cloud-Server      | Feste Server-Typen (`listPlans`) und Standorte (`listLocations`), Konsole über `request_console`, Standort pro Server |
| Demo          | `providers/demo`    | simuliert         | Für Entwicklung und Tests, inkl. Server-Typen und Standorten                                                          |

Provider mit festen Grössen (Hetzner) liefern `listPlans()` und `listLocations()`. Rescale und
Server erstellen zeigen dann Server-Typen und Standorte statt freier Werte. Meldet ein Provider
den Standort pro Server (`meta.datacenter` mit Stadt und ISO-Ländercode), zeigt die Console
diesen statt des Standorts der Verbindung.

Der Sync-Job holt alle `SYNC_INTERVAL_SECONDS` das Inventar jedes Providers, legt neue
Server als "nicht zugewiesen" an und markiert verschwundene als `missing`. Ein zweiter Job
verfolgt laufende Provider-Tasks (z.B. Proxmox-UPIDs) und schliesst Aktionen ab. Beide
laufen hinter Postgres-Advisory-Locks, also auch mit mehreren API-Instanzen nur einmal.

## Sicherheit

- Passwörter mit scrypt, Login-Sperre nach 10 Fehlversuchen, Rate-Limits
- Sessions als zufällige Tokens, in der DB nur als SHA-256, Cookie `HttpOnly`, `SameSite=Lax`,
  `Secure` bei https
- CSRF-Schutz: Cookie-authentifizierte Schreibzugriffe brauchen `X-Requested-With` und eine
  passende `Origin`
- TOTP-2FA, Secrets verschlüsselt in der DB
- Provider-Zugangsdaten AES-256-GCM-verschlüsselt, nie in API-Antworten (nur maskiert)
- Root-Passwörter aus Provider-Konfigurationen werden ausgeblendet
- Strenge Content-Security-Policy, keine Inline-Skripte
- Konsole über einmalige, 60 Sekunden gültige Tickets
- Jede schreibende Aktion landet im Audit-Log, auch fehlgeschlagene Logins
