# Roadmap und Ideen

Das Fundament ist so gebaut, dass neue Dienste als weitere Provider-Adapter mit eigenen
Berechtigungen dazukommen. Vorschläge, grob nach Nutzen sortiert:

## Als Nächstes

- **Live-Test gegen 24fire, Proxmox, Hetzner Cloud, Joker.com, Cloudflare, Nextcloud, Mailcow,
  CloudPanel, 3CX, Jellyfin und Uptime Kuma** mit den echten Zugangsdaten (die Build-Umgebung hatte
  keinen Zugriff), bei Joker.com zuerst im Testsystem (OT&E), bei Cloudflare mit einem Test-Konto
  und einer Test-Zone, bei Nextcloud und Mailcow mit eigenen Test-Instanzen, bei CloudPanel mit
  einem Test-Server und dem Agent `weblion-clp`, bei 3CX mit einer V20 mit Enterprise-Testlizenz,
  bei Jellyfin mit 10.10 und 10.11 im Container, bei Uptime Kuma mit einer Test-Instanz 2.x (echte
  Antworten als Fixtures ablegen). Offene Detailfragen stehen in docs/providers.md unter "Offene
  Punkte"
- **Cloud-Speicher, E-Mail, Websites, Telefonie, Streaming und Monitoring an Sperre und Abrechnung
  koppeln**: Heute laufen die Nextcloud-Konten, Mail-Domains, Websites, Telefonanlagen,
  Streaming-Zugänge und Monitore eines gesperrten Kunden oder nach gekündigtem Dienst weiter (siehe
  unten)
- **Hetzner Cloud ausbauen**: Backups pro Server ein- und ausschalten (mit Preis-Hinweis),
  Rescue-System, SSH-Keys und Cloud-Init beim Erstellen, Volumes (Speicher dazubuchen),
  Floating und Primary IPs. Firewalls nur als eigene Firewall pro Kunde oder Server, weil
  Hetzner-Firewalls im ganzen Projekt geteilt werden
- **Stripe Connect für Reseller**, damit auch Reseller-Kunden online zahlen können
- **Mahnwesen**: Zahlungserinnerungen und Mahnstufen für überfällige Rechnungen (die
  Mail-Vorlage `invoice_reminder` ist schon da)
- **Self-Service-Bestellung**: Kunden bestellen Produkte aus dem Katalog selbst, inkl.
  automatischer Bereitstellung bei Proxmox und Hetzner Cloud (Produkt = Server-Typ plus
  Aufschlag)
- **Alarme**: E-Mail, Slack, Telegram bei Server down, hoher Last, fehlgeschlagenem Backup. Für
  "down" sind die Monitore aus Uptime Kuma eine Grundlage (siehe Monitoring)
- **Geplante Aufgaben**: Backup- und Snapshot-Zeitpläne, Wartungsfenster für Reboots
- **SSH-Keys und Cloud-Init** beim Erstellen und Neuinstallieren von Servern
- **OpenAPI-Doku** der REST-API, danach Terraform-Provider und eine kleine CLI
- **SSO und Passkeys**: Login mit Microsoft/Google (OIDC), WebAuthn statt nur TOTP

## Domains (Joker.com)

Die Anbindung deckt heute DNS, Nameserver, Transfersperre, Auth-Code und Verlängerung ab.
Als Nächstes:

- **Registrieren und Transfer zu Joker** aus der Console: Verfügbarkeit prüfen, Kontakte
  (Handles) pro Kunde anlegen und wiederverwenden, Preise pro Endung im Produktkatalog
- **Verlängerungen weiterverrechnen**: Verlängert Joker eine Domain (automatisch oder von
  Hand), entsteht automatisch eine Rechnungszeile für den Kunden. Heute bezahlt weblion.one
  die Verlängerung, und die Abrechnung läuft getrennt über einen Dienst an der Domain
- **DNSSEC**: Signieren bei Joker einschalten bzw. DS-Einträge für fremde Nameserver
  hinterlegen, statt den Status nur anzuzeigen
- **Whois-Datenschutz** bestellen und verlängern
- **Inhaberwechsel** und Kontaktdaten pflegen, mit den Fristen und Bestätigungen, die
  einzelne Registries verlangen

## Cloud-Speicher (Nextcloud)

Die Anbindung deckt heute Kontingente pro Kunde und Reseller, Konten mit eigenem Kontingent,
Einladungen, Passwörter, den Sync der Belegung und die Übernahme bestehender Benutzer ab. Als
Nächstes:

- **Sperre koppeln**: Sperrt weblion.one oder ein Reseller einen Kunden, deaktiviert die Console
  seine Konten in Nextcloud und aktiviert sie beim Entsperren wieder. Heute geht das nur von Hand
- **Abrechnung koppeln**: Ein Dienst trägt Speicher und Zahl der Konten, das Kontingent folgt dem
  Dienst. Kündigen deaktiviert die Konten und löscht sie nach einer Frist. Optional nach belegtem
  Speicher abrechnen (GB pro Monat als Rechnungszeile)
- **Mehr Speicher selbst buchen**, als Teil der Self-Service-Bestellung
- **Gruppen nachziehen**: Beim Übernehmen und Zuweisen ein Konto in die Gruppe des neuen Kunden
  legen und aus der alten nehmen (braucht eine Adapter-Methode für Gruppen)
- **Team-Ordner** pro Organisation (Nextcloud-App für Gruppenordner) mit eigenem Kontingent, das
  zum Kontingent des Kunden zählt
- **Warnungen**: E-Mail an den Owner, wenn ein Konto oder das Kontingent zu 90 % belegt ist.
  Verlauf der Belegung als Graph
- **2FA erzwingen** pro Organisation (Nextcloud kann Zwei-Faktor-Anmeldung für Gruppen erzwingen)
- **Instanz im Blick**: freier Platz der Instanz und Summe aller verkauften Kontingente im
  Admin-Bereich, damit Überbuchung sichtbar wird
- **Kleinere Lücken**: Reseller-Wechsel eines Kunden gegen das Kontingent des neuen Resellers
  prüfen, Cloud-Konten in den Zählern der Kundenlisten, Gruppen-Präfix aus der `.env`, Konten im
  Admin-Bereich direkt deaktivieren und löschen (heute im Panel des Kunden)

## DNS und CDN (Cloudflare)

Die Anbindung deckt heute Zonen als Domains, DNS-Einträge mit Proxy und automatischer TTL, die
CDN-Einstellungen (SSL/TLS, Always Use HTTPS, Entwicklungsmodus, Cache leeren), wartende Zonen,
die Verknüpfung von Registrierung und Zone und den DNS-Umzug für weblion.one ab. Als Nächstes:

- **Zone anlegen** für Domains, die nicht im Panel registriert sind (heute nur über den Umzug oder
  im Dashboard), und Zonen löschen
- **Einträge scannen** (Nachfolger von `jump_start`) für Domains, deren DNS bei einem Drittanbieter
  liegt, statt sie von Hand einzutragen
- **Cache gezielt leeren**: einzelne URLs, Hosts oder Tags statt des ganzen Caches
- **Eigene Berechtigung für das CDN** (`domain:cdn`), damit z.B. Member nach einem Deployment den
  Cache leeren dürfen, ohne Nameserver ändern zu können. Heute hängt alles an `domain:manage`
- **Kommentare der Einträge bearbeiten** und Typen wie HTTPS und SVCB anlegen (heute nur lesen)
- **Umzug durch den Kunden** selbst starten lassen, mit Bestätigung, heute nur weblion.one
- **Registrierung und Zone in einer Zeile** zeigen, falls zwei Einträge pro Domain Kunden verwirren
- **Reseller-Weitergabe koppeln**: Gibt ein Reseller eine Registrierung weiter, die Zone desselben
  Namens mitnehmen (heute zwei Schritte)
- **Erste Zuweisung melden**: weblion.one per E-Mail informieren, wenn der Sync eine Zone einem
  Kunden zuweist oder wegen mehrerer Kunden frei lässt
- **Page Rules, Weiterleitungen und Cache-Regeln**, DNSSEC bei Cloudflare, E-Mail Routing
- **Abrechnung** von Zonen und bezahlten Cloudflare-Tarifen (Pro), heute laufen Zonen ohne eigenen
  Dienst

## E-Mail (Mailcow)

Die Anbindung deckt heute Mail-Domains mit Limits auf beliebig vielen Instanzen, Postfächer,
Weiterleitungen inklusive Catch-all, Passwörter, DKIM-Schlüssel, die DNS-Einträge mit "Fehlende
Einträge hinzufügen", den Sync und die Weitergabe durch Reseller ab. Als Nächstes:

- **Abrechnung koppeln**: Mail-Domains als Ressource von Diensten (`maildomain` in den
  Ressourcentypen der Abrechnung), damit ein Dienst an der Domain hängt, die Weitergabe einen
  laufenden Dienst berücksichtigt und Kündigen die Domain abstellt. Optional Postfächer oder
  Speicher nach Verbrauch abrechnen
- **Sperre koppeln**: Sperrt weblion.one oder ein Reseller einen Kunden, stellt die Console seine
  Mail-Domains bei Mailcow ab (oder sperrt nur die Anmeldung) und beim Entsperren wieder an. Heute
  geht das nur von Hand über "Limits ändern"
- **Mail-Domain anfragen**: Kunden fragen für eine ihrer Domains E-Mail an, weblion.one gibt frei.
  Später als Teil der Self-Service-Bestellung
- **Umzug zwischen Instanzen**: Postfächer samt E-Mails von einer Instanz auf eine andere kopieren
  (z.B. mit imapsync), heute muss die Domain auf der alten Instanz zuerst weg sein
- **Instanz für einen Kunden**: neue Mail-Domains einer Instanz automatisch einem Kunden zuweisen
- **Limits für Reseller**: Reseller teilen eine Domain oder ein eigenes Kontingent selbst auf
  (Mailcow kennt keine verschachtelten Kontingente, die Console müsste das prüfen)
- **SPF und DMARC verschärfen**: pro Kunde `-all` und `p=quarantine` mit Berichtsadresse, sobald
  alle Absender bekannt sind
- **DKIM-Schlüssel tauschen** mit Übergangszeit (zwei Selektoren)
- **Mehr pro Postfach**: Protokolle (IMAP, POP3, SMTP, ActiveSync) einzeln schalten,
  Abwesenheitsnotiz und Weiterleitung des Postfachs, App-Passwörter
- **Warnungen**: E-Mail an den Owner, wenn ein Postfach oder der Speicher der Domain fast voll ist,
  und an weblion.one, wenn der Mail-Speicher einer Instanz knapp wird

## Websites (CloudPanel)

Die Anbindung deckt heute Websites auf beliebig vielen eigenen CloudPanel-Servern ab: Kontingente
pro Kunde und Reseller, PHP-Websites mit Vhost-Vorlage, statische und Node.js-Websites,
Zugangsdaten für SFTP/SSH und Datenbanken (einmal angezeigt), Datenbanken, Let's Encrypt mit
DNS-Prüfung, Löschen, die Belegung, den Sync und das Übernehmen bestehender Sites. Damit ist auch
das Bereitstellen von Webhosting aus der Console erledigt, das mit der 24fire-API nicht ging. Als
Nächstes (Stufe 2):

- **WordPress mit einem Klick**: Ein Haken "WordPress installieren" beim Anlegen (Titel,
  Admin-Benutzer, E-Mail, Sprache). Der Agent bekommt eine Operation `wp-install`, die als Site-User
  mit WP-CLI die Dateien lädt, `wp-config.php` schreibt und WordPress installiert, die Passwörter
  nur über stdin. Die Zugangsdaten zeigen dann auch das WordPress-Login. Zu prüfen: wo CloudPanel
  WP-CLI ablegt und ob `--prompt` die Passwörter von stdin liest. Bis dahin startet eine
  WordPress-Website leer, und niemand Fremdes kann die Installationsseite zuerst aufrufen
- **Fehlende DNS-Einträge hinzufügen**: A und AAAA für die Domain und ihr www-Gegenstück mit einem
  Klick eintragen, wenn die Zone im Modul "Domains & DNS" liegt, mit dem Ablauf, den die E-Mail
  schon hat (`src/modules/mail/dns.ts`): nur fehlende Einträge, jeder auditiert als `domain.dns_add`
- **Abrechnung koppeln**: Ein Produkt mit Website-Kontingent ("Hosting S: 3 Websites, 5
  Datenbanken") als Dienst, das Kontingent folgt dem Dienst, Kündigen legt die Websites still oder
  löscht sie nach einer Frist. Alternativ legt eine neue Website in einer Organisation mit
  Website-Produkt selbst einen Dienst an (Ressource `webspace`)
- **SSH-Schlüssel für Site-User**: Karte "SSH-Schlüssel" auf der Website, der Agent schreibt
  `~/.ssh/authorized_keys` aus einer geprüften Liste
- **Warnungen bei der Belegung**: eine weiche Grenze pro Kontingent und eine E-Mail an die Owner,
  wenn eine Website sie überschreitet. Die Belegung misst der Server schon alle sechs Stunden
- **Sperre koppeln**: Websites gesperrter Kunden stilllegen und beim Entsperren wieder anschalten
  (CloudPanel hat dafür keinen Befehl, der Agent müsste es selbst tun)
- **Übernehmen aus der Console** standardmässig einschalten, wenn das gewünscht ist (heute auf
  jedem Server einzeln mit `--allow-remote-adopt`)
- **Kleinere Lücken**: PHP-Version wechseln, weitere Domains pro Website (Aliase), Umzug zwischen
  Servern, ein Adminer hinter dem Login der Console statt eines SSH-Tunnels, Auswahl für Kunden
  (PHP, Anwendungen, Node.js) auch für die Verbindung aus der `.env`

## Telefonie (3CX)

Die Anbindung deckt heute beliebig viele 3CX-Telefonanlagen ab (eine pro Verbindung, mehrere pro
Kunde), mit Zuweisung und Weitergabe durch Reseller, den Fakten der Anlage (Lizenz, Gespräche,
Leitungen) und ihrem Zustand, Benutzern und Nebenstellen (anlegen, ändern, löschen,
Willkommens-E-Mail), den Mitgliedern von Ringgruppen und den Leitungen zum Ansehen. Als Nächstes:

- **Abrechnung koppeln**: Telefonanlagen als Ressource von Diensten (`phone_system` in den
  Ressourcentypen der Abrechnung), damit ein Dienst an der Anlage hängt und die Weitergabe durch
  Reseller einen laufenden Dienst berücksichtigt. Heute läuft die Anlage über einen Dienst ohne
  Ressource
- **Benachrichtigungen**: E-Mail an weblion.one (und auf Wunsch an den Owner), wenn eine Anlage
  nicht erreichbar ist, eine Leitung nicht registriert oder die Lizenz bald abläuft. Heute zeigt es
  nur die Liste im Admin-Bereich
- **Mehr pro Benutzer**: zuerst aktivieren und deaktivieren, dann Abteilungen (Gruppen),
  Weiterleitungen und Profile
- **Mehr pro Anlage**: neue Ringgruppen, Warteschlangen, digitale Rezeption, eingehende Regeln und
  Durchwahlen, Anrufliste und Aufnahmen (mit Blick auf den Datenschutz), Telefone provisionieren
- **Mehrere API-Prozesse**: Ein gemeinsamer Speicher für das Token jeder Anlage (verschlüsselt in
  Postgres, Erneuerung unter einem Advisory Lock), weil 3CX pro API-Client nur ein gültiges Token
  zulässt. Heute braucht 3CX einen API-Prozess
- **Kleinere Lücken**: Anlagen mit privatem Zertifikat (ein CA-Feld wie bei Proxmox), eine 3CX im
  Multi-Company-Modus für mehrere Kunden, Rechte für Member per Voreinstellung statt per Policy

## Streaming (Jellyfin)

Die Anbindung deckt heute Streaming-Kontingente pro Kunde und Reseller auf beliebig vielen
Jellyfin-Instanzen ab (gemeinsam oder dediziert), Zugänge mit Login-Namen aus Name und Code,
Passwörter (einmal angezeigt), Deaktivieren und Löschen, die verwaltete Richtlinie mit Reparatur
durch den Sync, das Übernehmen bestehender Benutzer und eine Anmeldehilfe mit Quick Connect. Als
Nächstes:

- **Abrechnung koppeln**: Ein Produkt mit Streaming-Kontingent ("Familie: 5 Zugänge, 2 Streams") als
  Dienst, das Kontingent folgt dem Dienst. Kündigen deaktiviert die Zugänge und löscht sie nach einer
  Frist. Optional pro Zugang abrechnen (Zugänge als Rechnungszeilen)
- **Sperre koppeln**: Zugänge gesperrter Kunden deaktivieren und beim Entsperren wieder aktivieren.
  Ebenso auf Wunsch beim Lösen eines Zugangs von seiner Organisation
- **Grosse Änderungen im Hintergrund**: Die Richtlinie aller Zugänge nach einer Änderung am
  Kontingent als Job schreiben statt in der Anfrage, sobald Organisationen Hunderte von Zugängen
  haben
- **Umzug ohne Lücke**: Ein zweites Kontingent auf einer anderen Instanz, solange ein Kunde von einer
  gemeinsamen auf eine dedizierte Instanz zieht
- **Schalter für dedizierte Instanzen**: SyncPlay ("gemeinsam schauen") und Live TV pro Kontingent,
  nur für weblion.one und nur auf Instanzen mit einem einzigen Kunden
- **Mehr pro Zugang**: "Alle Geräte abmelden" als eigene Aktion, einzelne Zugänge mit mehr Streams
  oder Downloads, die Zahl aktiver Geräte (ohne Details, Datenschutz abwägen)
- **Kleinere Lücken**: eine eigene öffentliche Adresse, wenn die Console Jellyfin intern erreicht

## Monitoring (Uptime Kuma)

Die Anbindung deckt heute beliebig viele Instanzen von Uptime Kuma 2.x ab, Status, Uptime,
Antwortzeit und Zertifikate aus `/metrics`, die Zuweisung (auch alle Monitore einer dedizierten
Instanz auf einmal) und Weitergabe durch Reseller, verknüpfte Statusseiten, Monitore auf Server- und
Domain-Seiten und, für Instanzen, die für die Verwaltung angemeldet sind, eigene Monitore der Kunden
im Kontingent mit Diagrammen und Statuswechseln. Damit ist der frühere Punkt "Uptime- und
Statusseiten" unter Neue Dienste erledigt. Als Nächstes:

- **Benachrichtigungen für Kunden**: E-Mail an den Owner (oder eine Adresse pro Organisation), wenn
  ein Monitor ausfällt und wieder erreichbar ist. Entweder über eigene Benachrichtigungen pro
  Organisation in Uptime Kuma, die die Console anlegt und an die Monitore hängt, oder über die Console
  selbst. Heute gehen nur die Benachrichtigungen an weblion.one, die in Uptime Kuma standardmässig
  aktiviert sind
- **Statusseiten aus der Console**: anlegen und pflegen (welche Monitore darauf stehen) statt in
  Uptime Kuma
- **Abrechnung koppeln**: Ein Produkt mit Monitoring-Kontingent als Dienst, das Kontingent folgt dem
  Dienst, Monitore als Ressource von Diensten
- **Uptime Kuma 3.x**: die neue Anmeldung in `socket.ts` nachziehen, sobald 3.0 stabil ist. Heute
  geht mit 3.x nur das Lesen
- **Monitore vorschlagen**: Für eine neue Website oder Mail-Domain gleich einen HTTP(S)- bzw.
  Port-Monitor anbieten
- **Mehr Arten**: Push-Monitore (z.B. für Cron-Jobs), DNS, Wartungsfenster aus der Console
- **Berichte**: monatliche Verfügbarkeit pro Kunde als PDF (SLA)
- **Kleinere Lücken**: Kontingente auf mehreren Instanzen pro Organisation, Monitore aus Uptime Kuma
  für Kunden änderbar machen (heute nur lesbar)

## Neue Dienste

- **Grafana pro Kunde**: automatisch angelegte Grafana-Organisationen mit Dashboards für die
  eigenen Server, eingebettet im Panel
- **Backups 2.0**: Proxmox Backup Server mit Einzeldatei-Wiederherstellung, Offsite-Kopien
  (S3, Storage Box)
- **1-Click-Apps**: WordPress, eine eigene Nextcloud pro Kunde, Docker-Host als Templates mit
  Cloud-Init
- **Netzwerk**: private Netze, WireGuard-VPN, Floating IPs, Load Balancer (bei Hetzner Cloud
  über deren API, sonst selbst betrieben)
- **Hetzner jenseits der Cloud**: Storage Boxes (Backup-Speicher für Kunden), DNS-Zonen bei
  Hetzner DNS als weiterer DNS-Provider, dedizierte Server über die Robot-API
- **Object Storage**: S3-kompatibel (MinIO oder Ceph RGW) in der Schweiz

## Geschäft

- **Nutzungsbasierte Abrechnung**: Traffic, Backup-Speicher, Server-Laufzeit oder belegter
  Cloud-Speicher als Rechnungszeilen statt nur fester Preise. Für Hetzner Cloud: Server-Typ,
  Backups (+20 %) und Snapshot-Speicher pro GB automatisch in die Abrechnung übernehmen
- **Proxmox für Admins**: Live-Migration, HA, Backup-Zeitpläne, Cloud-Init, Task-Logs,
  Hardware bearbeiten (Liste in docs/providers.md)
- **Support im Panel**: Tickets (z.B. Zammad), Wartungsankündigungen, Changelog
- **Datenstandort sichtbar machen**: CH- und DE-Kennzeichnung für Datenschutz (DSG/DSGVO),
  Audit-Export für Compliance
