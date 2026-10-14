# weblion-clp: Agent der Console auf CloudPanel-Servern

Diese Anleitung ist für den Betrieb eines CloudPanel-Servers, auf dem die weblion.one Console
Websites verkauft. Wie die Console den Server anbindet und was Kunden damit tun, steht in
[docs/providers.md](../../docs/providers.md#cloudpanel-websites).

In diesem Ordner:

| Datei                       | Inhalt                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `weblion-clp`               | der Root-Wrapper (Python 3.9 oder neuer, nur Standardbibliothek)                       |
| `install.sh`                | installiert, aktualisiert und entfernt den Agent                                       |
| `tests/test_weblion_clp.py` | Tests für Wrapper und Installer, ohne root und ohne Netz                               |
| `tests/fakes/fake_tool.py`  | nachgebaute Werkzeuge für die Tests (`clpctl`, `mysql`, `chpasswd`, `dpkg-query`, ...) |

## Was der Agent ist

CloudPanel hat keine API, nur das Kommandozeilenwerkzeug `clpctl`, das als root läuft. Damit die
Console keinen Root-Zugang braucht, läuft auf dem Server ein kleines Skript als Grenze:
`/usr/local/sbin/weblion-clp`.

- Die Console meldet sich per SSH als `weblion-agent` an. Was immer sie als Befehl schickt, sshd
  führt nur `sudo -n /usr/local/sbin/weblion-clp` aus, und sudo erlaubt genau das, ohne Argumente.
- Die Anfrage kommt als eine Zeile JSON auf stdin (höchstens 64 KiB, innerhalb von 10 Sekunden),
  die Antwort geht als eine Zeile JSON auf stdout (Protokoll v1). Exit-Code 0 heisst `ok: true`, 1
  heisst `ok: false`, jeder andere Code ein Fehler des Skripts selbst.
- Der Wrapper kennt 13 Operationen (siehe unten) und prüft jedes Argument gegen ein festes Muster.
  Befehle laufen als Argumentliste ohne Shell, mit fester Umgebung
  (`PATH=/usr/sbin:/usr/bin:/sbin:/bin`, `LANG=C.UTF-8`, `HOME=/root`) und in einer eigenen
  Prozessgruppe, die bei einer Zeitüberschreitung ganz beendet wird.
- Er ändert nur Sites auf seiner **Liste verwalteter Sites** und nie Sites oder Benutzer auf der
  **Schutzliste**.
- `clpctl` sieht nie ein echtes Passwort, nur ein zufälliges Wegwerf-Passwort aus 32 Buchstaben und
  Ziffern. Das echte setzt der Wrapper gleich danach über stdin (`chpasswd` bzw. `ALTER USER` über
  den MySQL-Client). Grund: CloudPanel setzt Passwörter in Shell-Befehle, `ps` und Fehlermeldungen,
  und `$` oder `)` verderben sie.
- Ob eine Änderung geklappt hat, prüft er in der SQLite-Datenbank von CloudPanel
  (`/home/clp/htdocs/app/data/db.sq3`), die er nur liest. Die Exit-Codes von `clpctl` sind nicht
  dokumentiert.
- Jeder Text, der das Skript verlässt (Antworten, Log), ist bereinigt: Passwörter der Anfrage,
  Wegwerf-Passwörter und das MySQL-Master-Passwort werden `•••`, dazu Muster wie
  `passwd -6 '...'`, `IDENTIFIED BY '...'` und `--...Password=...`. Ausgaben sind auf 2000 Zeichen
  gekürzt.
- Bricht die Console die Verbindung ab (Zeitüberschreitung), arbeitet der Wrapper weiter
  (SIGHUP und SIGPIPE ignoriert) und beendet, was er angefangen hat. Der nächste Sync der Console
  zeigt das Ergebnis.
- Alle Pfade und Programme stehen fest im Skript, keine Umgebungsvariable und kein Argument ändert
  sie. Nur `clpctl`, der MySQL-Client und die Datenbank von CloudPanel kommen aus `config.json`.

Empfehlung: Kundenwebsites auf einem eigenen CloudPanel-Server, nicht auf dem Server, auf dem die
Console läuft. Erzwungen wird das nicht. Läuft die Console auf demselben Server, gehört ihre Site
auf die Schutzliste (siehe unten).

## Was install.sh auf dem Server ändert

An CloudPanel selbst ändert das Skript nichts, bestehende Sites bleiben unberührt.

| Pfad                                                         | Besitzer, Rechte  | Inhalt                                                                                                    |
| ------------------------------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------- |
| Benutzer `weblion-agent`                                     |                   | Systembenutzer, Home `/var/lib/weblion-agent`, Shell `/bin/sh`, Passwort gesperrt, keine weiteren Gruppen |
| `/var/lib/weblion-agent`, `.../.ssh`                         | root, 0755        | gehören root: Der Benutzer kann seinen eigenen Zugang nicht ändern                                        |
| `/var/lib/weblion-agent/.ssh/authorized_keys`                | root, 0644        | genau eine Zeile mit dem Schlüssel der Console                                                            |
| `/etc/ssh/sshd_config.d/50-weblion-agent.conf`               | root, 0644        | `Match`-Block für `weblion-agent`                                                                         |
| `/etc/sudoers.d/weblion-agent`                               | root, 0440        | erlaubt nur den Wrapper ohne Argumente                                                                    |
| `/usr/local/sbin/weblion-clp`                                | root, 0755        | der Wrapper                                                                                               |
| `/etc/weblion-clp/config.json`                               | root, 0644        | Einstellungen, nur beim ersten Mal angelegt                                                               |
| `/etc/weblion-clp/protected.conf`                            | root, 0644        | Schutzliste                                                                                               |
| `/var/lib/weblion-clp/` mit `managed.json`, `usage.json`     | root, 0700 / 0600 | Liste verwalteter Sites, gemessene Belegung                                                               |
| `/var/log/weblion-clp.log`, `/etc/logrotate.d/weblion-clp`   | root, 0600 / 0644 | Log, wöchentlich rotiert, 8 Wochen, komprimiert                                                           |
| `/etc/systemd/system/weblion-clp-usage.service` und `.timer` | root, 0644        | misst die Belegung alle 6 Stunden                                                                         |
| `/run/weblion-clp/` (zur Laufzeit)                           | root, 0700        | Sperrdatei, kurzlebige Optionsdateien für den MySQL-Client                                                |

Die Zeile in `authorized_keys`:

```
restrict,from="<--from>",command="/usr/bin/sudo -n /usr/local/sbin/weblion-clp" ssh-ed25519 AAAA... weblion-console
```

Der `Match`-Block (`ForceCommand` gilt für jede Anmeldung des Benutzers, auch mit einem Schlüssel
ohne `command=`):

```
Match User weblion-agent
    AuthenticationMethods publickey
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    PermitTTY no
    AllowTcpForwarding no
    AllowStreamLocalForwarding no
    AllowAgentForwarding no
    X11Forwarding no
    PermitTunnel no
    PermitUserRC no
    ForceCommand /usr/bin/sudo -n /usr/local/sbin/weblion-clp
```

Die sudo-Regel (das `""` heisst: dieser Befehl und nur ohne Argumente):

```
Defaults:weblion-agent !requiretty, !lecture, env_reset, secure_path="/usr/sbin:/usr/bin:/sbin:/bin"
weblion-agent ALL=(root) NOPASSWD: /usr/local/sbin/weblion-clp ""
```

Prüfungen dabei: `sshd -t` für den neuen Block, und mit `sshd -T -C user=weblion-agent,...`, dass
`ForceCommand`, `PermitTTY no`, `AllowTcpForwarding no`, `AuthenticationMethods publickey` und
`PasswordAuthentication no` für den Benutzer gelten (und `ForceCommand` nicht für root). Sonst
nimmt das Skript den Block wieder heraus und bricht ab, z.B. wenn ein anderer `Match`-Block vorher
greift. Die sudo-Regel prüft es mit `visudo -cf`, bevor sie an ihren Platz kommt, und danach mit
`sudo -l -U weblion-agent`. Das Skript lädt sshd nur neu, wenn sshd läuft
(`try-reload-or-restart`, so stört es `ssh.socket` auf neueren Ubuntu nicht). Ohne PAM sperrt es das Passwort mit `*` statt
`!`, weil sshd sonst den Benutzer ablehnt.

`hidepid` für `/proc` richtet das Skript nicht ein. Ohne `hidepid` legt der Agent aber keine
Websites und Datenbanken an, und der Selftest am Ende des Skripts meldet FAIL, siehe
[unten](#hidepid-voraussetzung).

## Voraussetzungen

- root, Debian oder Ubuntu mit CloudPanel CE 2.5.0 oder neuer (`dpkg-query`). Vor 2.5.0 war die
  erste Zeile von `clpctl` kaputt, und 2.5.0 schliesst eine Rechteausweitung über `clpctlWrapper`.
- `/usr/bin/python3` mit den Modulen `sqlite3` und `json`, `/usr/bin/clpctl`, `/usr/bin/sudo`,
  `sshd`, `visudo`, `useradd`, `usermod`, `chpasswd`, `systemctl`, `ssh-keygen`. Fehlt der
  MySQL-Client, warnt das Skript nur, Datenbanken gehen dann aber nicht.
- `/etc/ssh/sshd_config` mit `Include /etc/ssh/sshd_config.d/*.conf` und `/etc/sudoers` mit
  `#includedir /etc/sudoers.d` (oder `@includedir`), beides Standard bei Debian und Ubuntu.
- `/usr/local/sbin` gehört root und ist für niemanden sonst beschreibbar.
- Firewall (Admin Area von CloudPanel): 80 und 443 offen, 22 für Kunden und die Console, 8443 (das
  Panel) nur für die IPs von weblion.one.

## Installieren

1. In der Console unter Admin > Provider > Provider hinzufügen, Typ CloudPanel, ein Schlüsselpaar
   erzeugen (oder `ssh-keygen -t ed25519 -N "" -C weblion-console -f cloudpanel_web1`). Der Dialog
   zeigt die fertige Zeile für den Installer. Empfohlen ist ein eigener Schlüssel pro Server.
2. Diesen Ordner auf den Server kopieren, z.B.
   `scp -r deploy/cloudpanel-agent root@web1.weblion.cloud:`, und dort als root:

   ```bash
   cd cloudpanel-agent
   sudo ./install.sh --public-key "ssh-ed25519 AAAA... weblion-console" \
     --from "203.0.113.5,2001:db8::5" \
     --protect-domain kunde-des-betreibers.ch --protect-user betreiber-site
   ```

   | Option                    | Bedeutung                                                                                                                           |
   | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
   | `--public-key KEY`        | der öffentliche Schlüssel der Console, eine Zeile `ssh-ed25519 ... Kommentar`, nur ed25519. Pflicht                                 |
   | `--from LISTE`            | Adressen oder Netze, von denen die Console kommt (ihre ausgehenden IPv4 und IPv6), durch Komma getrennt, nicht `0.0.0.0/0`. Pflicht |
   | `--protect-domain DOMAIN` | eine Site, die die Console nie anfassen darf, wiederholbar                                                                          |
   | `--protect-user BENUTZER` | ein Linux-Benutzer, dessen Sites die Console nie anfassen darf, wiederholbar                                                        |
   | `--nodejs`                | Node.js-Websites auf diesem Server erlauben (`config.json` `nodejs`)                                                                |
   | `--allow-remote-adopt`    | Übernehmen bestehender Sites aus der Console erlauben. Standard aus: Übernehmen geht dann nur als root auf dem Server               |
   | `--uninstall`             | entfernen, siehe unten                                                                                                              |

   Die Argumente prüft das Skript, bevor es etwas anfasst. Läuft auf dem Server eine Site des
   Betreibers (die Console selbst, eine Firmen-Website, ein Monitoring), gehört sie mit Domain und
   Site-User auf die Schutzliste.

3. Am Ende läuft `weblion-clp selftest`, und das Skript gibt aus, was in die Console gehört: Host,
   Port, Benutzer, den Fingerabdruck des Host-Schlüssels (wie
   `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`) und die Adressen des Servers. Findet der
   Selbsttest Fehler, endet das Skript mit Exit-Code 1, die Installation bleibt aber stehen.
4. In der Console die Verbindung fertig ausfüllen und speichern, dann "Verbindung testen" und
   "Jetzt synchronisieren". Bestehende Sites bleiben unberührt und erscheinen nicht als Websites,
   bis jemand sie übernimmt.

## Aktualisieren

Den neuen Ordner aus dem Repository kopieren und `install.sh` noch einmal mit `--public-key` und
`--from` aufrufen (beide sind auch beim Aktualisieren Pflicht). Das Skript ersetzt Wrapper,
`authorized_keys`, `Match`-Block, sudo-Regel, Log-Rotation und Timer und behält:

- `/var/lib/weblion-clp` (verwaltete Sites, Belegung)
- `config.json`: `--nodejs` und `--allow-remote-adopt` schalten nur ein. Ausschalten geht nur von
  Hand in der Datei.
- `protected.conf`: neue Einträge kommen dazu, keiner verschwindet.

Danach in der Console "Verbindung testen". Sprechen Console und Agent verschiedene Protokolle,
meldet der Test das: beide auf denselben Stand bringen.

- **Schlüssel tauschen:** in der Console in der Verbindung ein neues Paar erzeugen, `install.sh`
  mit dem neuen öffentlichen Schlüssel aufrufen (er ersetzt den alten, `authorized_keys` hat immer
  nur eine Zeile), dann in der Console speichern. Dazwischen kommt die Console nicht auf den
  Server.
- **Neue IP der Console:** `install.sh` mit dem neuen `--from` aufrufen, am besten bevor die
  Console umzieht.
- **CloudPanel aktualisieren** (mit dem Updater von CloudPanel) kann `clpctl` oder die Datenbank
  von CloudPanel ändern. Danach `sudo weblion-clp selftest` und in der Console "Verbindung testen".
  Ist CloudPanel älter als `minCloudPanel`, lehnt der Agent jede Änderung ab (Code `version`, in der
  Console 422). Erkennt er die Datenbank nicht mehr (Pflichtspalten von `site` oder `database`
  fehlen), lehnt er auch alles ab, was sie liest.
- **Neuer Host-Schlüssel** (Server neu installiert): Die Console verbindet sich nicht mehr und
  nennt den neuen Fingerabdruck. Mit `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` auf dem
  Server vergleichen, dann in der Verbindung ändern.

## Entfernen

```bash
sudo ./install.sh --uninstall
```

Entfernt sudo-Regel und `Match`-Block (und lädt sshd neu), beendet die Prozesse von
`weblion-agent`, löscht den Benutzer mit seinem Home, schaltet den Timer ab und entfernt Units,
Log-Rotation und Wrapper. Es bleiben `/var/lib/weblion-clp` (verwaltete Sites, für eine spätere
Neuinstallation), `/etc/weblion-clp` (Einstellungen, Schutzliste) und das Log. Die Sites selbst
bleiben, wie sie sind. In der Console schlagen danach Test und Sync fehl: dort die Websites
entfernen oder den Provider löschen.

## Verwaltete Sites und Schutzliste

### Liste verwalteter Sites

`/var/lib/weblion-clp/managed.json` (root, 0600) schreibt nur der Wrapper, immer atomar (eine
neue Datei ersetzt die alte):

```json
{
  "sites": {
    "shop.kunde.ch": {
      "createdAt": "2026-10-11T12:00:30Z",
      "incomplete": false,
      "letsEncrypt": false,
      "requestId": "6f0c1c6e-2a51-4a51-9c55-3cdd1f1e0f3a",
      "siteUser": "shop-kunde-ch",
      "source": "create"
    }
  },
  "version": 1
}
```

- Eine Site kommt dazu, wenn die Console sie angelegt hat und der Wrapper sie in CloudPanel
  gefunden hat (`source: "create"`), oder wenn root sie übernimmt (`source: "adopt"`).
- Sie verschwindet mit `delete` (die Site ist gelöscht) und mit `forget` (die Site bleibt).
- Jede Änderung (Löschen, Passwort, Datenbanken, Zertifikat) braucht die Site auf der Liste **und**
  denselben Site-User in CloudPanel wie in der Liste. Hat jemand den Site-User im Panel geändert,
  lehnt der Wrapper ab (`not_managed`), bis root die Site mit `forget` und `adopt` neu aufnimmt.
- `incomplete: true` hat eine Site, deren Anlegen scheiterte und die sich nicht wieder löschen
  liess. So sieht die Console sie und kann sie löschen. Ein neues Passwort nimmt die Markierung weg.
- `letsEncrypt: true` setzt der Wrapper, wenn er selbst ein Zertifikat ausgestellt hat.

### Schutzliste

`/etc/weblion-clp/protected.conf` (root, 0644), eine Zeile pro Eintrag, `#` für Kommentare:

```
# Sites und Benutzer, die weblion-clp nie übernimmt, anlegt, ändert oder löscht.
domain cp.weblion.cloud
user weblion-cp
domain firma.ch
```

- Ein `domain`-Eintrag schützt auch das www-Gegenstück, ein `user`-Eintrag alle Sites dieses
  Site-Users.
- Immer geschützt, was auch in der Datei steht: `root`, `clp`, der Agent-Benutzer und jeder
  Benutzer mit einer UID unter 1000.
- Geschützte Sites übernimmt, ändert und löscht der Wrapper nie, auch wenn sie irgendwie auf der
  Liste verwalteter Sites stehen. Die Console sieht sie nur als "geschützt" in der Liste der nicht
  verwalteten Sites. Neue Sites mit einer geschützten Domain oder einem geschützten Benutzer legt er
  nicht an.
- Eine Zeile, die weder `domain <Name>` noch `user <Name>` ist, lässt jede Anfrage ausser
  `forget` scheitern (Code `internal`, die Meldung nennt die Zeile). Ein Tippfehler soll keine Site
  ungeschützt lassen.
- Eintragen: `sudo weblion-clp protect domain <Name>` oder `protect user <Name>`, oder die Datei
  von Hand bearbeiten. Herausnehmen nur von Hand.
- `weblion-clp selftest` warnt, wenn die Liste leer ist, der Server aber Sites hat, die die
  Console nicht verwaltet.

### config.json

`/etc/weblion-clp/config.json` (root, 0644) liest der Wrapper bei jedem Aufruf, ein Neustart ist
nicht nötig. Ein ungültiger Wert lässt jede Anfrage scheitern.

| Schlüssel          | Standard                           | Bedeutung                                                                                          |
| ------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| `agentUser`        | `weblion-agent`                    | der Benutzer der Console (immer geschützt, lokale Befehle sind für ihn gesperrt)                   |
| `allowRemoteAdopt` | `false`                            | Übernehmen aus der Console                                                                         |
| `nodejs`           | `false`                            | Node.js-Websites auf diesem Server                                                                 |
| `nodejsPorts`      | `[3001, 3999]`                     | Bereich der App-Ports für Node.js-Sites, der erste freie wird vergeben                             |
| `phpVersions`      | `null`                             | PHP-Versionen, die der Server anbietet (`null`: alle installierten), z.B. `["8.3", "8.4"]`         |
| `dbQuietSeconds`   | `[2, 9]`                           | Sekunden jeder Minute, in denen der Wrapper die Datenbank von CloudPanel nicht liest (siehe unten) |
| `panelDb`          | `/home/clp/htdocs/app/data/db.sq3` | die Datenbank von CloudPanel                                                                       |
| `clpctl`           | `/usr/bin/clpctl`                  | läuft immer über `/bin/bash`                                                                       |
| `mysql`            | `/usr/bin/mysql`                   | der MySQL-Client                                                                                   |
| `minCloudPanel`    | `2.5.0`                            | älteste Version von CloudPanel für Änderungen                                                      |

Was Kunden in der Console wählen dürfen (PHP-Versionen, Anwendungen, Node.js), schränkt zusätzlich
die Verbindung in der Console ein.

## Bestehende Site übernehmen

Sites, die im Panel von CloudPanel angelegt wurden, fasst die Console nicht an. Soll sie eine
verwalten, nimmt root sie auf die Liste:

```bash
sudo weblion-clp adopt shop.kunde.ch
```

Der Wrapper prüft, dass CloudPanel mindestens 2.5.0 ist, die Site in CloudPanel existiert, weder
Domain noch Site-User geschützt sind, die Site noch nicht verwaltet ist und Art und Site-User
gültig sind. An der Site selbst ändert er nichts, auch kein Passwort. Danach in der Console
"Jetzt synchronisieren": Die Website erscheint unter Admin > Domains & Webspaces > Webspaces als
nicht zugewiesen und wird dort dem Kunden zugewiesen.

Wer eine übernommene Website zugewiesen bekommt, kann ihr Passwort setzen, Datenbanken anlegen und
löschen und die Site löschen. Also nur übernehmen, was dem Kunden gehört. Auch Python-Sites und
Reverse Proxies lassen sich übernehmen, anlegen kann die Console sie nie.

Mit `--allow-remote-adopt` (`allowRemoteAdopt: true`) geht dasselbe in der Console mit
"Übernehmen". Geschützte Sites bleiben auch dann ausgeschlossen.

Nicht mehr verwalten: `sudo weblion-clp forget shop.kunde.ch`. Die Site bleibt mit allen Dateien
bestehen, die Console markiert sie beim nächsten Sync als fehlend, und weblion.one entfernt sie
dort mit "Aus der Console entfernen".

## Lokale Befehle

Nur als root direkt auf dem Server. Über sudo als `weblion-agent` sind sie gesperrt.

| Befehl                              | Tut                                                                                                                                                                                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `weblion-clp status`                | alle Sites von CloudPanel mit Domain, Art, Site-User und Zustand: `managed` (dazu `incomplete`, `site user changed`), `unmanaged`, `protected`, `managed, missing in CloudPanel`                                                                                                            |
| `weblion-clp adopt <Domain>`        | eine bestehende Site übernehmen (siehe oben)                                                                                                                                                                                                                                                |
| `weblion-clp forget <Domain>`       | eine Site nicht mehr verwalten, sie bleibt auf dem Server                                                                                                                                                                                                                                   |
| `weblion-clp protect domain <Name>` | Domain auf die Schutzliste setzen                                                                                                                                                                                                                                                           |
| `weblion-clp protect user <Name>`   | Site-User auf die Schutzliste setzen                                                                                                                                                                                                                                                        |
| `weblion-clp refresh-usage`         | Belegung messen (macht der Timer alle 6 Stunden): `nice -n 19 ionice -c 3 du -s -B1 -x` auf das Home jeder verwalteten Site (höchstens 300 Sekunden pro Site) und die Grösse ihrer Datenbanken aus `information_schema.TABLES`, nach `usage.json`                                           |
| `weblion-clp selftest`              | prüft config.json, root, Version von CloudPanel, `clpctl --version`, die Datenbank von CloudPanel, die Vhost-Vorlagen, `chpasswd`, den MySQL-Client, die Master-Zugangsdaten (`SELECT 1`), sudo-Regel, `Match`-Block und Schutzliste. Exit-Code 1 bei einem `FAIL`, dazu Warnungen (`WARN`) |
| `weblion-clp --help`                | die Befehle (geht auch ohne root)                                                                                                                                                                                                                                                           |

## Was der Wrapper auf dem Server tut

Jede Operation hat eine eigene Zeitgrenze im Wrapper (die Console wartet jeweils etwas länger).
Lesende Operationen nehmen die Sperre geteilt, ändernde exklusiv.

- `info` (lesend, 20 s): Version (`dpkg-query`, `clpctl --version`), Betriebssystem, Hostname,
  öffentliche Adressen (`ip -j addr show scope global` ohne private und lokale), installierte
  PHP-Versionen (`/usr/bin/phpX.Y`, sonst `/etc/php/X.Y/fpm`), Vorlagen
  (`clpctl vhost-templates:list`), Node.js 18 bis 24, wenn erlaubt, Schutzliste, Zahl der Sites.
- `list` (lesend, 45 s): alle verwalteten, nicht geschützten Sites mit Fakten, Zertifikat,
  Datenbanken und Belegung. Verwaltete Sites, die in CloudPanel fehlen, stehen im Log.
- `get` (lesend, 20 s): eine verwaltete Site.
- `unmanaged` (lesend, 20 s): Sites, die nicht verwaltet sind, mit Domain, Art, Site-User und ob
  geschützt.
- `create` (300 s): prüft die Schutzliste, dass es den Linux-Benutzer nicht gibt, dass Domain und
  www-Gegenstück nicht in CloudPanel sind, die Vorlage (aus der aktuellen Liste, keine Vorlage
  einer anderen Art), die PHP-Version (installiert und in `phpVersions`), bei Node.js `nodejs` und
  einen freien Port, bei einer Datenbank, dass Name und Benutzer frei sind (in CloudPanel und
  MySQL). Dann
  `clpctl site:add:php --domainName= --phpVersion= --vhostTemplate= --siteUser= --siteUserPassword=<Wegwerf>`
  (statisch `site:add:static`, Node.js `site:add:nodejs --nodejsVersion= --appPort=`), höchstens
  240 s. Danach prüft er die neue Site in CloudPanel, setzt das echte Passwort (`chpasswd`),
  beendet alle Prozesse des Benutzers (`pkill -KILL -u`), leert `~/.ssh/authorized_keys` (ohne
  Links zu folgen), löscht die Crontab (`crontab -r -u`), beendet die Prozesse noch einmal und
  nimmt die Site auf die Liste. Scheitert ein Schritt: `clpctl site:delete --force`, und bleibt
  trotzdem etwas übrig, kommt die Site als `incomplete` auf die Liste. Zum Schluss die Datenbank
  wie bei `db-add`. Ein Fehler dort lässt die Site stehen und wird ein Hinweis.
- `delete` (180 s): merkt sich Datenbanken und ihre Benutzer,
  `clpctl site:delete --domainName= --force` (höchstens 170 s), prüft, dass die Site weg ist, und
  nimmt sie von der Liste. Danach die Reste: Gemerkte Datenbanken und Benutzer, die noch da sind,
  löscht er (`DROP DATABASE`, `DROP USER`, nie `root`, `mysql`, `clp`, `debian-sys-maint`, den
  Master-Benutzer oder Benutzer anderer Sites), ebenso eine verwaiste Crontab in
  `/var/spool/cron/crontabs`. Einen übrig gebliebenen Linux-Benutzer meldet er nur.
- `password` (20 s): `chpasswd`. Laufende Prozesse und Sitzungen bleiben.
- `db-add` (75 s): Name und Benutzer beginnen mit dem Präfix der Site (Site-User mit `_` statt
  `-`, höchstens 16 Zeichen, dann `_`) und sind frei.
  `clpctl db:add --domainName= --databaseName= --databaseUserName= --databaseUserPassword=<Wegwerf>`
  (höchstens 60 s), dann prüft er Datenbank und Benutzer in CloudPanel, setzt mit `ALTER USER` das
  echte Passwort für jeden Host des Benutzers und beendet seine MySQL-Sitzungen. Scheitert ein
  Schritt: `clpctl db:delete --force`.
- `db-delete` (75 s): Die Datenbank muss zur Site gehören. `clpctl db:delete --databaseName= --force`
  (höchstens 60 s), dann prüft er, dass sie weg ist.
- `db-password` (20 s): Der Benutzer muss zur Datenbank der Site gehören. `ALTER USER` für jeden
  Host.
- `cert` (180 s): `clpctl lets-encrypt:install:certificate --domainName=` (höchstens 170 s), dann
  prüft er, dass ein neues Zertifikat da ist, das noch mindestens 7 Tage gilt. Sonst geht die
  letzte Zeile der Ausgabe (die Meldung von Let's Encrypt) an die Console.
- `adopt` (20 s): nur mit `allowRemoteAdopt`, Prüfungen wie beim lokalen `adopt`.
- `forget` (20 s): nimmt die Site von der Liste (auch wenn sie nicht darauf steht).

Für alle gilt:

- **Sperre:** eine Datei in `/run/weblion-clp` (nicht `/run/lock`, das jeder beschreiben kann),
  geteilt zum Lesen, exklusiv für Änderungen. Der Wrapper wartet höchstens 120 Sekunden und nie
  über die Zeit der Operation hinaus, dann antwortet er `busy`.
- **Version:** Alle ändernden Operationen ausser `forget` prüfen vorher mit `dpkg-query`, dass
  CloudPanel mindestens `minCloudPanel` ist.
- **Datenbank von CloudPanel:** nur lesend geöffnet (`mode=ro`, `PRAGMA query_only`), Spalten
  vorher geprüft (fehlende optionale gelten als leer), alles in einer kurzen Transaktion. Die
  Tabelle `user` (Logins des Panels) und `site.user_password` liest der Wrapper nie. `clp-agent`
  schreibt jede Minute seine Messwerte in diese Datenbank und beendet sich, wenn gerade jemand
  liest (CloudPanel-Issue #815). Deshalb liest der Wrapper nie zwischen Sekunde 2 und 9 einer
  Minute und versucht es bei "database is locked" noch zweimal, dann `busy`.
- **MySQL:** Die Master-Zugangsdaten liest der Wrapper mit `clpctl db:show:master-credentials`
  und schreibt sie nur für einen Aufruf in eine Datei (0600) in einem frischen Verzeichnis (0700)
  unter `/run/weblion-clp`, die er danach löscht. SQL geht über stdin, Werte sind vorher gegen ihre
  Muster geprüft und trotzdem maskiert.
- **Muster:** Domain klein in ASCII (Umlaute als `xn--`), Site-User 3 bis 32 Zeichen
  (`a-z`, `0-9`, `-`, nicht `root`, `clp`, `mysql`, `nginx`, `www-data`, `proftpd`, `varnish`,
  `redis`, `admin`, `ubuntu`, `debian`, nicht `weblion...`), Datenbank-Namen
  `[a-z][a-z0-9_]{1,31}` ohne Systemschemas, Passwörter 12 bis 128 Zeichen aus Buchstaben, Ziffern
  und `!#%*+,-./;<=>?@^_{|}~`, Vorlagen `[A-Za-z0-9][A-Za-z0-9 ._-]{0,40}`, PHP `X.Y`, Node.js 12
  bis 24. Python-Sites und Reverse Proxies legt der Wrapper nie an.

## Logs

`/var/log/weblion-clp.log` (root, 0600), eine Zeile JSON pro Anfrage, nie ein Passwort:

```
{"code": "ok", "domain": "shop.kunde.ch", "ms": 8421, "op": "create", "requestId": "6f0c1c6e-2a51-4a51-9c55-3cdd1f1e0f3a", "time": "2026-10-11T12:00:39Z"}
```

`code` ist `ok` oder der Fehlercode der Antwort (`invalid`, `exists`, `not_found`, `not_managed`,
`protected`, `adopt_disabled`, `busy`, `version`, `clpctl_failed`, `timeout`, `internal`).
Unerwartete Fehler stehen mit Traceback darin (Geheimnisse als `***`), verwaltete Sites, die in
CloudPanel fehlen, als `managed_missing`, lokale Befehle als `local adopt`, `local forget` und
`local protect`.

```bash
sudo tail -f /var/log/weblion-clp.log
sudo grep '"code": "clpctl_failed"' /var/log/weblion-clp.log
```

Dieselbe `requestId` steht in der Console im Log ("CloudPanel operation failed", mit Server,
Operation, Status und Dauer), wenn eine Operation dort scheitert. Weitere Stellen:
`journalctl -u ssh` (Anmeldungen von `weblion-agent`),
`systemctl list-timers weblion-clp-usage.timer` und `journalctl -u weblion-clp-usage.service`
(Messung der Belegung).

## Von Hand testen

**Tests im Repository** (ohne root und Netz, mit nachgebauten Werkzeugen, laufen auch in der CI):

```bash
python3 -I -m unittest discover -s deploy/cloudpanel-agent/tests -v
```

**Auf dem Server:**

```bash
sudo weblion-clp selftest
sudo weblion-clp status

# Eine lesende Anfrage direkt als root (Exit-Code 0, eine Zeile JSON)
printf '{"v":1,"op":"info","requestId":"%s","args":{}}\n' "$(cat /proc/sys/kernel/random/uuid)" \
  | sudo /usr/local/sbin/weblion-clp; echo "exit $?"

# Derselbe Weg wie von der Console: als weblion-agent über die sudo-Regel
printf '{"v":1,"op":"list","requestId":"%s","args":{}}\n' "$(cat /proc/sys/kernel/random/uuid)" \
  | sudo -u weblion-agent /usr/bin/sudo -n /usr/local/sbin/weblion-clp

sudo -l -U weblion-agent                 # nur /usr/local/sbin/weblion-clp ""
sudo sshd -T -C user=weblion-agent,host=localhost,addr=127.0.0.1 | grep -E 'forcecommand|permittty'
```

**Über SSH**, von einer Adresse aus `--from` und mit dem privaten Schlüssel der Console (falls er
als Datei vorliegt):

```bash
printf '{"v":1,"op":"unmanaged","requestId":"%s","args":{}}\n' "$(cat /proc/sys/kernel/random/uuid)" \
  | ssh -T -i cloudpanel_web1 -o HostKeyAlgorithms=ssh-ed25519 weblion-agent@web1.weblion.cloud
```

Gegenproben: `ssh ... weblion-agent@web1.weblion.cloud id` führt trotzdem nur den Wrapper aus (er
wartet 10 Sekunden auf JSON und antwortet `invalid`), `ssh -t` bekommt kein Terminal, `ssh -L`
keine Weiterleitung, eine Anmeldung mit Passwort oder von einer anderen Adresse scheitert.
Unbekannte Operationen, Felder oder Argumente beantwortet der Wrapper mit `invalid`, ohne etwas
auszuführen.

**Ändernde Operationen** am besten über die Console auf einem Test-Server mit einer Test-Domain:
Website anlegen, Passwort setzen, Datenbank anlegen und löschen, Zertifikat ausstellen, Website
löschen, je mit `weblion-clp status` und einem Blick ins Log. Passwörter nicht von Hand in eine
JSON-Zeile auf der Kommandozeile tippen: Sie landen in der Shell-History.

## hidepid (Voraussetzung)

Beim Anlegen steht das Wegwerf-Passwort ein paar Sekunden lang in der Kommandozeile von `clpctl`
und der Befehle, die CloudPanel daraus macht (`openssl passwd`), sichtbar in `ps` für jeden
Benutzer des Servers. Der Wrapper schliesst das Fenster danach (echtes Passwort, Prozesse beenden,
Schlüssel und Crontab leeren).
`hidepid` auf `/proc` sorgt dafür, dass Site-User fremde Prozesse gar nicht sehen, und damit auch
kein Wegwerf-Passwort. Deshalb verlangt der Agent es: Ohne `hidepid` lehnt er `create` und `db-add`
ab (die Console zeigt "nicht unterstützt"), und `weblion-clp selftest` meldet FAIL. Wer das Risiko
bewusst trägt, z.B. weil kein Kunde SSH auf dem Server hat, setzt in
`/etc/weblion-clp/config.json` den Wert `"requireHidepid": false`.

Ob das Panel von CloudPanel und `clp-agent` damit weiter laufen, ist nicht geprüft. Deshalb zuerst
auf einem Test-Server:

```bash
groupadd --system procview
usermod -aG procview clp            # das Panel läuft als clp; Monitoring-Benutzer ebenso
getent group procview               # GID notieren
# /etc/fstab, eine Zeile (hidepid=2 auf Kerneln vor 5.8):
#   proc  /proc  proc  defaults,hidepid=invisible,gid=<GID>  0  0
mount -o remount,hidepid=invisible,gid=<GID> /proc
```

Danach das Panel öffnen, eine Site anlegen und löschen, prüfen, ob `clp-agent` weiter läuft
(`pgrep -a clp-agent`, auch nach ein paar Minuten), und `weblion-clp selftest`. Dienste, die alle
Prozesse sehen müssen, kommen in die Gruppe. root sieht immer alles, der Wrapper ist davon nicht
betroffen.
