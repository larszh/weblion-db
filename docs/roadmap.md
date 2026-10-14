# Roadmap und Ideen

Das Fundament ist so gebaut, dass neue Dienste als weitere Provider-Adapter mit eigenen
Berechtigungen dazukommen. Vorschläge, grob nach Nutzen sortiert:

## Als Nächstes

- **Live-Test gegen 24fire, Proxmox, Hetzner Cloud, Joker.com, Cloudflare, Nextcloud, Mailcow
  und CloudPanel** mit den echten Zugangsdaten (die Build-Umgebung hatte keinen Zugriff), bei
  Joker.com zuerst im Testsystem (OT&E), bei Cloudflare mit einem Test-Konto und einer Test-Zone,
  bei Nextcloud und Mailcow mit eigenen Test-Instanzen, bei CloudPanel mit einem Test-Server und
  dem Agent `weblion-clp`. Offene Detailfragen stehen in docs/providers.md unter "Offene Punkte"
- **Cloud-Speicher, E-Mail und Websites an Sperre und Abrechnung koppeln**: Heute laufen die
  Nextcloud-Konten, Mail-Domains und Websites eines gesperrten Kunden oder nach gekündigtem Dienst
  weiter (siehe unten)
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
- **Alarme**: E-Mail, Slack, Telegram bei Server down, hoher Last, fehlgeschlagenem Backup
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

## Neue Dienste

- **Grafana pro Kunde**: automatisch angelegte Grafana-Organisationen mit Dashboards für die
  eigenen Server, eingebettet im Panel
- **Uptime- und Statusseiten**: externe Checks (z.B. Uptime Kuma) und eine Statusseite pro Kunde
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
