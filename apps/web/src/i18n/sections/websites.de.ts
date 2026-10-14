/**
 * Websites (Modul "webhosting", CloudPanel): Provider-Formular, Admin-Inventar, Seiten der
 * Organisation, Kontingente. Keys beginnen mit "websites." (plus "providers.cloudpanel." und
 * "hosting.kind.").
 */
export const websitesDe = {
  // Provider form
  'providers.cloudpanel.help':
    'Ein eigener CloudPanel-Server (CE 2.5.0 oder neuer) für Websites von Kunden, nicht der Server der Console. Die Console meldet sich per SSH mit einem ed25519-Schlüssel als Agent-Benutzer an und darf dort nur den Root-Wrapper weblion-clp ausführen. Installieren Sie ihn mit deploy/cloudpanel-agent/install.sh aus dem Repository; das Skript zeigt den Fingerabdruck des Host-Schlüssels an.',
  'providers.cloudpanel.host': 'SSH-Host',
  'providers.cloudpanel.hostHint':
    'Hostname oder IP-Adresse, unter der die Console den Server per SSH erreicht.',
  'providers.cloudpanel.hostInvalid': 'Ein Hostname oder eine IP-Adresse.',
  'providers.cloudpanel.port': 'SSH-Port',
  'providers.cloudpanel.username': 'SSH-Benutzer',
  'providers.cloudpanel.usernameHint': 'Der Agent-Benutzer, den install.sh anlegt. Standard: weblion-agent.',
  'providers.cloudpanel.privateKey': 'Privater Schlüssel (ed25519)',
  'providers.cloudpanel.privateKeyHint':
    'Unverschlüsselter OpenSSH-Schlüssel (-----BEGIN OPENSSH PRIVATE KEY-----). Er wird verschlüsselt gespeichert und nie wieder angezeigt. Empfohlen: ein eigener Schlüssel pro Server.',
  'providers.cloudpanel.generate': 'Schlüsselpaar erzeugen',
  'providers.cloudpanel.generated':
    'Neues Schlüsselpaar erzeugt. Es gilt erst, wenn Sie speichern; installieren Sie den öffentlichen Schlüssel auf dem Server.',
  'providers.cloudpanel.publicKey': 'Öffentlicher Schlüssel',
  'providers.cloudpanel.publicKeyHint':
    'Diesen Schlüssel übergeben Sie install.sh auf dem Server (--public-key). Er ist nicht geheim.',
  'providers.cloudpanel.hostKey': 'Fingerabdruck des Host-Schlüssels',
  'providers.cloudpanel.hostKeyHint':
    'SHA256:..., wie ihn install.sh oder "ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub" auf dem Server ausgibt. Ein anderer Host-Schlüssel stoppt die Verbindung, bis Sie ihn hier ändern.',
  'providers.cloudpanel.hostKeyInvalid': 'SHA256: gefolgt von 43 Zeichen, z.B. SHA256:Ab3...',
  'providers.cloudpanel.accessHost': 'Host für Kunden (SFTP/SSH, optional)',
  'providers.cloudpanel.accessHostHint':
    'Diesen Namen zeigen wir Kunden für SFTP und SSH, z.B. web1.weblion.cloud (mit A/AAAA-Einträgen). Standard: der SSH-Host.',
  'providers.cloudpanel.accessHostInvalid': 'Ein Hostname wie web1.weblion.cloud.',
  'providers.cloudpanel.ipv4': 'Öffentliche IPv4-Adressen (optional)',
  'providers.cloudpanel.ipv6': 'Öffentliche IPv6-Adressen (optional)',
  'providers.cloudpanel.ipsHint':
    'Durch Komma getrennt, für die DNS-Prüfung vor SSL-Zertifikaten. Standard: was der Server meldet.',
  'providers.cloudpanel.phpVersions': 'PHP-Versionen für Kunden (optional)',
  'providers.cloudpanel.phpVersionsHint':
    'Durch Komma getrennt, z.B. 8.3, 8.4 (Standard). Angeboten wird nur, was auf dem Server installiert ist.',
  'providers.cloudpanel.templates': 'Anwendungen für Kunden (optional)',
  'providers.cloudpanel.templatesHint':
    'Vhost-Vorlagen wie in CloudPanel, durch Komma getrennt; ein * am Ende passt auf alle Namen mit diesem Anfang (Laravel*). Standard: Generic, WordPress, WooCommerce.',
  'providers.cloudpanel.nodejs': 'Node.js-Websites für Kunden',
  'providers.cloudpanel.nodejsHint':
    'Nur wenn der Agent mit --nodejs installiert wurde. Kunden brauchen Node.js zusätzlich in ihrem Kontingent.',
  'providers.cloudpanel.websites': 'Websites',
  'providers.cloudpanel.websitesText':
    'Websites dieses Servers, ihre Datenbanken und die Zuweisung an Kunden.',
  'providers.cloudpanel.toWebsites': 'Zu den Websites',
  'providers.cloudpanel.consoleKey': 'SSH-Schlüssel der Console',
  'providers.cloudpanel.installCommand': 'Installation auf dem Server (als root)',
  'providers.cloudpanel.installCommandHint':
    'Ersetzen Sie die Platzhalter: --from mit den ausgehenden IP-Adressen der Console, --protect-domain und --protect-user mit jeder Site des Betreibers auf diesem Server.',

  // Admin inventory
  'websites.admin.synced': '{seen} Websites abgeglichen, {missing} fehlen auf dem Server',
  'hosting.kind.website': 'Website',
  'hosting.kind.webspace': 'Webspace',

  // Status of websites and their databases
  'websites.status.creating': 'Wird angelegt',
  'websites.status.deleting': 'Wird gelöscht',
  'websites.status.error': 'Unklar',
  'websites.status.active': 'Aktiv',
  'websites.status.missing': 'Fehlt auf dem Server',

  // Explorer
  'providers.cloudpanel.explorerHint':
    'Der Agent weblion-clp beantwortet hier nur Lesezugriffe: GET /info (Versionen, Vorlagen), /list (verwaltete Sites) und /unmanaged (nicht verwaltete Sites).',

  // Types
  'websites.type.php': 'PHP',
  'websites.type.static': 'Statisch',
  'websites.type.nodejs': 'Node.js',
  'websites.type.python': 'Python',
  'websites.type.reverse-proxy': 'Reverse Proxy',

  // Customer list
  'websites.list.subtitle':
    'Websites auf unseren Servern mit SFTP/SSH, Datenbanken und SSL-Zertifikaten, dazu Webspaces mit Plesk.',
  'websites.list.create': 'Website anlegen',
  'websites.list.full': 'Ihr Kontingent ist ausgeschöpft. Für weitere Websites wenden Sie sich an uns.',
  'websites.list.serverDown': 'Server nicht erreichbar',
  'websites.list.optionsError': 'Kontingent nicht verfügbar',
  'websites.list.empty': 'Noch keine Website',
  'websites.list.emptyText':
    'Legen Sie die erste an. Sie erhalten SFTP/SSH-Zugang und auf Wunsch eine Datenbank.',
  'websites.list.noAllowance': 'Kein Website-Kontingent',
  'websites.list.noAllowanceText':
    'Für Ihre Organisation ist kein Website-Kontingent eingerichtet. Wenden Sie sich an weblion.',
  'websites.list.noAllowanceReseller':
    'Für Ihre Organisation ist kein Website-Kontingent eingerichtet. Wenden Sie sich an Ihren Anbieter {reseller}.',
  'websites.list.credentialsPending': 'Zugangsdaten fehlen: Setzen Sie ein neues Passwort.',

  // Allowance
  'websites.allowance.title': 'Website-Kontingent',
  'websites.allowance.sites': 'Websites',
  'websites.allowance.databases': 'Datenbanken',
  'websites.allowance.of': '{n} von {max}',
  'websites.allowance.types': 'Erlaubte Arten',
  'websites.allowance.instance': 'Server',
  'websites.allowance.customersIncluded':
    'Enthält die Kontingente der Kunden auf diesem Server ({n} Kunden).',
  'websites.allowance.adminText':
    'Server für neue Websites, höchstens erlaubte Websites und Datenbanken, erlaubte Arten.',
  'websites.allowance.setUp': 'Einrichten',
  'websites.allowance.setUpTitle': 'Website-Kontingent für {name} einrichten',
  'websites.allowance.editTitle': 'Website-Kontingent von {name}',
  'websites.allowance.dialogText':
    'Kunden legen ihre Websites selbst an, bis das Kontingent ausgeschöpft ist. Es gibt kein Speicherlimit, der Verbrauch wird angezeigt.',
  'websites.allowance.instanceHint': 'Neue Websites der Organisation entstehen auf diesem CloudPanel-Server.',
  'websites.allowance.instanceLocked':
    'Der Reseller hat Kunden mit Website-Kontingent auf diesem Server. Der Server lässt sich erst ohne sie ändern.',
  'websites.allowance.instanceReseller':
    'Kunden von {reseller} erhalten ihre Websites auf dem Server des Resellers.',
  'websites.allowance.instanceChange':
    'Bestehende Websites bleiben auf {instance}; nur neue Websites entstehen auf dem gewählten Server.',
  'websites.allowance.noInstance':
    'Es gibt noch keinen CloudPanel-Server. Richten Sie zuerst einen Provider ein.',
  'websites.allowance.maxSites': 'Websites höchstens',
  'websites.allowance.maxDatabases': 'Datenbanken höchstens',
  'websites.allowance.countInvalid': 'Geben Sie eine ganze Zahl ab 0 ein.',
  'websites.allowance.belowSites': 'Mindestens {n}, so viele Websites bestehen oder sind vergeben.',
  'websites.allowance.belowDatabases': 'Mindestens {n}, so viele Datenbanken bestehen oder sind vergeben.',
  'websites.allowance.committed': 'Bereits belegt: {n}',
  'websites.allowance.poolLeft': 'Höchstens {n} aus dem Kontingent des Resellers',
  'websites.allowance.poolSites': 'Im Kontingent des Resellers sind nur noch {n} Websites frei.',
  'websites.allowance.poolDatabases': 'Im Kontingent des Resellers sind nur noch {n} Datenbanken frei.',
  'websites.allowance.resellerNone':
    'Der Reseller {reseller} hat kein Website-Kontingent. Richten Sie zuerst seines ein; die Kontingente seiner Kunden kommen daraus.',
  'websites.allowance.notInPool': 'Nicht im Kontingent von {reseller}',
  'websites.allowance.nodejsOff':
    'Auf diesem Server sind Node.js-Websites für Kunden nicht freigegeben (Provider-Einstellung).',
  'websites.allowance.nodejsOn': 'Node.js freigegeben',
  'websites.allowance.nodejsOffShort': 'Node.js nicht freigegeben',
  'websites.allowance.typesRequired': 'Wählen Sie mindestens eine Art.',
  'websites.allowance.enableModuleHint': '{org} sieht danach die Seite Webhosting und kann Websites anlegen.',
  'websites.allowance.moduleOff': 'Ohne das Modul "{module}" sieht die Organisation ihre Websites nicht.',
  'websites.allowance.resellerHint':
    'Das Kontingent eines Resellers deckt seine eigenen Websites und die Kontingente, die er seinen Kunden gibt.',
  'websites.allowance.saved': 'Website-Kontingent gespeichert',
  'websites.allowance.remove': 'Kontingent entfernen',
  'websites.allowance.removeTitle': 'Website-Kontingent von {name} entfernen?',
  'websites.allowance.removeText':
    'Die Organisation kann danach keine Websites mehr anlegen. Das Modul bleibt freigeschaltet.',
  'websites.allowance.removeBlocked':
    'Nur ohne Websites möglich. Die Organisation hat noch {n}; löschen Sie sie oder weisen Sie sie anders zu.',
  'websites.allowance.removeBlockedCustomers':
    'Nur ohne Kundenkontingente möglich. {n} Kunden haben ein Website-Kontingent aus diesem.',
  'websites.allowance.removed': 'Website-Kontingent entfernt',
  'websites.allowance.none': 'Kein Website-Kontingent',
  'websites.allowance.noneText': 'Ohne Kontingent kann die Organisation keine Websites anlegen.',
  'websites.allowance.showWebsites': 'Websites des Servers',

  // Create
  'websites.create.title': 'Website anlegen',
  'websites.create.text':
    'Eine Domain mit ihrem www-Gegenstück, ein Benutzer für SFTP/SSH und auf Wunsch eine Datenbank.',
  'websites.create.domain': 'Domain',
  'websites.create.domainHint': 'Mit oder ohne www, beides wird ausgeliefert.',
  'websites.create.domainAscii': 'Wird als {ascii} angelegt. Mit oder ohne www, beides wird ausgeliefert.',
  'websites.create.domainInvalid': 'Keine gültige Domain, z.B. shop.beispiel.ch.',
  'websites.create.type': 'Art',
  'websites.create.type.php': 'PHP-Anwendung',
  'websites.create.type.phpText': 'WordPress, WooCommerce oder eigene PHP-Dateien',
  'websites.create.type.static': 'Statische Website',
  'websites.create.type.staticText': 'Nur HTML, CSS und Bilder',
  'websites.create.type.nodejs': 'Node.js',
  'websites.create.type.nodejsText': 'Eigene App, die Sie per SSH starten',
  'websites.create.onlyType': 'Art: {type}',
  'websites.create.application': 'Anwendung',
  'websites.create.applicationHint': 'Bestimmt die Webserver-Konfiguration. Die Website startet leer.',
  'websites.create.wordpressHint':
    'WordPress-Dateien laden Sie per SFTP hoch. Die Datenbank legen wir gleich mit an.',
  'websites.create.templateInvalid': 'Der Name einer Vorlage des Servers, z.B. Generic.',
  'websites.create.phpVersion': 'PHP-Version',
  'websites.create.phpStaffHint': 'Laut Provider-Einstellung; der Server prüft, ob sie installiert ist.',
  'websites.create.phpInvalid': 'Eine Version wie 8.4.',
  'websites.create.recommended': 'empfohlen',
  'websites.create.nodejsVersion': 'Node.js-Version',
  'websites.create.nodejsHint':
    'Port wird automatisch vergeben, die App starten Sie per SSH (z.B. PM2). Das Anlegen dauert länger.',
  'websites.create.siteUser': 'Benutzername (SFTP/SSH)',
  'websites.create.siteUserHint':
    'Linux-Benutzer der Website (Site-User): 3 bis 32 Zeichen, Kleinbuchstaben, Ziffern und "-".',
  'websites.create.siteUserInvalid':
    '3 bis 32 Zeichen: Kleinbuchstaben, Ziffern und "-", beginnt mit einem Buchstaben, endet nicht mit "-".',
  'websites.create.siteUserReserved': 'Dieser Name ist für das System reserviert. Wählen Sie einen anderen.',
  'websites.create.database': 'Datenbank anlegen',
  'websites.create.databaseHint':
    'MySQL-Datenbank mit eigenem Benutzer, das Passwort sehen Sie danach einmal.',
  'websites.create.databaseNoRoom': 'Ihr Kontingent hat keinen Platz für weitere Datenbanken.',
  'websites.create.password': 'Passwort für SFTP/SSH',
  'websites.create.after':
    'Danach belegt: {sites} von {maxSites} Websites, {databases} von {maxDatabases} Datenbanken.',
  'websites.create.submit': 'Website anlegen',
  'websites.create.pending':
    'Website wird eingerichtet. Das dauert meist unter einer Minute (Node.js länger).',
  'websites.create.done': 'Website {domain} angelegt',
  'websites.create.unknownHint':
    'Erscheint die Website danach in der Liste, setzen Sie dort ein neues Passwort, um Zugang zu erhalten.',

  // Passwords
  'websites.password.label': 'Passwort',
  'websites.password.generate': 'Generieren',
  'websites.password.generateText': '24 zufällige Zeichen, sicher und leicht abzutippen',
  'websites.password.choose': 'Eigenes Passwort',
  'websites.password.chooseText': 'Wenn Sie ein bestimmtes Passwort brauchen',
  'websites.password.own': 'Ihr Passwort',
  'websites.password.rules': 'Regeln für das Passwort',
  'websites.password.rule.length': '12 bis 128 Zeichen',
  'websites.password.rule.characters':
    'Buchstaben, Ziffern und !#%*+,-./;<=>?@^_{|}~ (keine Leerzeichen, Anführungszeichen, $ : ( ) & \\ `)',
  'websites.password.submit': 'Neues Passwort setzen',

  // Credentials
  'websites.creds.title': 'Zugangsdaten (nur jetzt sichtbar)',
  'websites.creds.text':
    'Speichern Sie die Zugangsdaten jetzt, z.B. in einem Passwort-Manager. weblion speichert keine Passwörter und kann sie nicht erneut anzeigen.',
  'websites.creds.newPassword': 'Neues Passwort (nur jetzt sichtbar)',
  'websites.creds.sftp': 'SFTP und SSH',
  'websites.creds.database': 'Datenbank',
  'websites.creds.password': 'Passwort',
  'websites.creds.passwordChosen': 'Das von Ihnen gewählte Passwort',
  'websites.creds.sftpLink': 'Im Dateimanager öffnen:',
  'websites.creds.sshLine': 'Im Terminal:',
  'websites.creds.onceText':
    'Nach dem Schliessen ist das Passwort nicht mehr sichtbar. Vergessene Passwörter setzen Sie neu.',
  'websites.creds.saved': 'Ich habe die Zugangsdaten gespeichert',

  // Detail
  'websites.detail.open': 'Website öffnen',
  'websites.detail.refreshError': 'Aktualisieren fehlgeschlagen',
  'websites.detail.missingTitle': 'Auf dem Server nicht mehr gefunden',
  'websites.detail.missingText':
    'Der Server meldet diese Website seit {date} nicht mehr (in CloudPanel gelöscht oder nicht mehr verwaltet). Änderungen sind nicht möglich. Wenden Sie sich an weblion, falls das nicht beabsichtigt war.',
  'websites.detail.creatingText':
    'Der Server richtet die Website ein. Diese Seite aktualisiert sich von selbst.',
  'websites.detail.deletingText': 'Der Server löscht die Website. Diese Seite aktualisiert sich von selbst.',
  'websites.detail.errorTitle': 'Letzte Änderung nicht abgeschlossen',
  'websites.detail.errorText':
    'Die Antwort des Servers ist ausgeblieben. Die nächste Synchronisierung klärt den Zustand, danach ist die Website wieder bedienbar.',
  'websites.detail.credentialsPendingTitle': 'Zugangsdaten nicht angezeigt',
  'websites.detail.credentialsPending':
    'Die Zugangsdaten wurden nicht angezeigt. Setzen Sie ein neues Passwort.',
  'websites.detail.offBusy': 'Erst möglich, wenn die laufende Änderung abgeschlossen ist.',
  'websites.detail.offError': 'Erst möglich, wenn die Synchronisierung den Zustand geklärt hat.',
  'websites.detail.offMissing': 'Nicht möglich: Der Server meldet diese Website nicht mehr.',
  'websites.detail.noFacts': 'Noch keine Angaben vom Server.',
  'websites.detail.synced': 'Zuletzt abgeglichen {when} · angelegt am {created}',

  // Access
  'websites.access.title': 'Zugang (SFTP/SSH)',
  'websites.access.text': 'Ein Benutzer für Dateien (SFTP) und Terminal (SSH) auf Port 22.',
  'websites.access.host': 'Host',
  'websites.access.port': 'Port',
  'websites.access.username': 'Benutzername',
  'websites.access.home': 'Home-Verzeichnis',
  'websites.access.webRoot': 'Web-Verzeichnis',
  'websites.access.newPassword': 'Neues Passwort',
  'websites.access.newPasswordHint': 'Setzt ein neues Passwort für SFTP und SSH.',
  'websites.access.passwordTitle': 'Neues Passwort für {user}',
  'websites.access.passwordText':
    'Das bisherige Passwort funktioniert danach nicht mehr. Laufende Prozesse und offene SSH-Sitzungen bleiben bestehen.',
  'websites.access.passwordDone': 'Neues Passwort gesetzt',
  'websites.access.helpUpload': 'Laden Sie die Dateien der Website in das Web-Verzeichnis.',
  'websites.access.helpCron': 'Geplante Aufgaben richten Sie per SSH ein:',
  'websites.access.helpLogs': 'Zugriffs- und Fehlerprotokolle liegen in',
  'websites.access.helpPassword': 'Passwörter speichert weblion nicht. Vergessene setzen Sie neu.',

  // Runtime
  'websites.runtime.title': 'Laufzeit',
  'websites.runtime.type': 'Art',
  'websites.runtime.php': 'PHP-Version',
  'websites.runtime.application': 'Anwendung',
  'websites.runtime.nodejs': 'Node.js-Version',
  'websites.runtime.appPort': 'App-Port',
  'websites.runtime.phpHint': 'PHP-Version und -Einstellungen ändert weblion auf Anfrage.',
  'websites.runtime.staticHint': 'Der Webserver liefert die Dateien im Web-Verzeichnis direkt aus.',
  'websites.runtime.nodejsHint':
    'Starten Sie Ihre App per SSH (z.B. mit PM2) und lassen Sie sie auf Port {port} lauschen. Der Webserver leitet die Domain dorthin weiter.',

  // Certificate
  'websites.ssl.title': 'SSL-Zertifikat',
  'websites.ssl.state': 'Zertifikat',
  'websites.ssl.expires': 'Gültig bis',
  'websites.ssl.covers': 'Gilt für',
  'websites.ssl.letsEncrypt': "Let's Encrypt bis {date}",
  'websites.ssl.letsEncryptOnly': "Let's Encrypt",
  'websites.ssl.until': 'Gültig bis {date}',
  'websites.ssl.unknownExpiry': 'Ablaufdatum unbekannt',
  'websites.ssl.expired': 'Abgelaufen am {date}',
  'websites.ssl.none': 'Kein Zertifikat',
  'websites.ssl.noneHint':
    "Stellen Sie ein Let's-Encrypt-Zertifikat aus, sobald die Domain auf den Server zeigt.",
  'websites.ssl.invalid': 'Kein gültiges Zertifikat',
  'websites.ssl.invalidHint':
    "Neue Websites haben ein selbst signiertes Zertifikat, dem Browser nicht vertrauen. Stellen Sie ein Let's-Encrypt-Zertifikat aus.",
  'websites.ssl.daysLeft': 'Noch {days} Tage gültig',
  'websites.ssl.issue': "Let's-Encrypt-Zertifikat ausstellen",
  'websites.ssl.issueShort': 'Zertifikat ausstellen',
  'websites.ssl.reissue': 'Erneut ausstellen',
  'websites.ssl.issueHint': 'Prüft zuerst das DNS der Domain und ihres www-Gegenstücks.',
  'websites.ssl.renewal': 'CloudPanel verlängert das Zertifikat automatisch.',
  'websites.ssl.dialogTitle': 'SSL-Zertifikat für {domain}',
  'websites.ssl.dialogText':
    "Let's Encrypt prüft, ob die Domain und ihr www-Gegenstück auf diesen Server zeigen. Wir prüfen das vorher.",
  'websites.ssl.ready': 'Beide Namen zeigen auf den Server. Das Zertifikat kann ausgestellt werden.',
  'websites.ssl.notReady': 'Das DNS zeigt noch nicht auf den Server',
  'websites.ssl.force': 'Trotzdem versuchen',
  'websites.ssl.pending': "Let's Encrypt prüft die Domain. Das kann bis zu drei Minuten dauern.",
  'websites.ssl.issued': 'Zertifikat für {domain} ausgestellt',

  // DNS
  'websites.dns.title': 'DNS',
  'websites.dns.text': 'A- und AAAA-Einträge, die die Domain und ihr www-Gegenstück brauchen.',
  'websites.dns.hint':
    'Prüfen Sie, ob die Domain auf den Server zeigt. Die Einträge setzen Sie dort, wo Ihre Domain verwaltet wird.',
  'websites.dns.check': 'DNS prüfen',
  'websites.dns.recheck': 'Erneut prüfen',
  'websites.dns.checkFailed': 'DNS-Prüfung fehlgeschlagen',
  'websites.dns.name': 'Name',
  'websites.dns.type': 'Typ',
  'websites.dns.value': 'Wert',
  'websites.dns.statusCol': 'Status',
  'websites.dns.present': 'vorhanden',
  'websites.dns.absent': 'fehlt',
  'websites.dns.answers': 'Was das öffentliche DNS antwortet',
  'websites.dns.needed': 'Diese Einträge fehlen noch:',
  'websites.dns.status.ok': 'Zeigt auf den Server',
  'websites.dns.status.elsewhere': 'Zeigt anderswohin',
  'websites.dns.status.missing': 'Kein Eintrag',
  'websites.dns.status.error': 'Abfrage fehlgeschlagen',
  'websites.dns.blocker.missing':
    'Mindestens ein Name hat keinen A- oder AAAA-Eintrag. Legen Sie die fehlenden Einträge an und prüfen Sie erneut (Änderungen brauchen oft einige Minuten).',
  'websites.dns.blocker.elsewhere':
    'Mindestens ein Name zeigt auf eine andere Adresse (alter Server oder CDN). Hinter einem CDN wie Cloudflare kann das Ausstellen trotzdem klappen.',
  'websites.dns.blocker.error': 'Das DNS konnte nicht abgefragt werden. Prüfen Sie es später erneut.',
  'websites.dns.foreign': 'Fremde Adressen, die entfernt werden müssen: {ips}',
  'websites.dns.readyText': 'Beide Namen zeigen auf den Server.',
  'websites.dns.notReadyText': 'Noch nicht alle Einträge zeigen auf den Server.',
  'websites.dns.checkedAt': 'Geprüft {when}.',
  'websites.dns.toDomain': 'Einträge von {domain} im DNS-Modul bearbeiten',

  // Databases
  'websites.db.title': 'Datenbanken',
  'websites.db.text': 'MySQL-Datenbanken der Website, je mit einem eigenen Benutzer.',
  'websites.db.empty': 'Keine Datenbanken',
  'websites.db.name': 'Datenbank',
  'websites.db.user': 'Benutzer',
  'websites.db.size': 'Grösse',
  'websites.db.statusCol': 'Status',
  'websites.db.create': 'Datenbank anlegen',
  'websites.db.createHint': 'Neue Datenbank mit eigenem Benutzer, das Passwort sehen Sie einmal.',
  'websites.db.createTitle': 'Datenbank anlegen',
  'websites.db.createText': 'Name und Benutzer beginnen mit dem festen Präfix der Website.',
  'websites.db.createdTitle': 'Datenbank angelegt (nur jetzt sichtbar)',
  'websites.db.created': 'Datenbank {name} angelegt',
  'websites.db.unknownHint':
    'Erscheint die Datenbank danach in der Liste, setzen Sie ein neues Passwort für sie.',
  'websites.db.full': 'Ihr Kontingent hat keinen Platz für weitere Datenbanken.',
  'websites.db.suffix': 'Name der Datenbank',
  'websites.db.suffixHint': 'Kleinbuchstaben, Ziffern und "_", höchstens 15 Zeichen, z.B. wp.',
  'websites.db.suffixEmpty': 'Geben Sie einen Namen nach dem Präfix ein.',
  'websites.db.suffixInvalid':
    'Kleinbuchstaben, Ziffern und "_", höchstens 15 Zeichen, beginnt mit einem Buchstaben oder einer Ziffer.',
  'websites.db.nameTooLong': 'Der ganze Name wäre länger als 32 Zeichen. Wählen Sie einen kürzeren.',
  'websites.db.needsSiteUser': 'Erst mit einem gültigen Benutzernamen.',
  'websites.db.taken': 'Diese Datenbank gibt es schon.',
  'websites.db.preview': 'Datenbank und Benutzer:',
  'websites.db.userHint': 'Der Datenbank-Benutzer heisst wie die Datenbank.',
  'websites.db.newPassword': 'Neues Passwort',
  'websites.db.passwordTitle': 'Neues Passwort für {name}',
  'websites.db.passwordText':
    'Das bisherige Passwort funktioniert danach nicht mehr. Tragen Sie das neue in Ihrer Anwendung ein (WordPress: wp-config.php).',
  'websites.db.passwordDone': 'Neues Passwort für {name} gesetzt',
  'websites.db.delete': 'Löschen',
  'websites.db.deleteTitle': 'Datenbank {name} löschen?',
  'websites.db.deleteText':
    'Die Datenbank und ihr Benutzer werden mit allen Daten gelöscht. Das lässt sich nicht rückgängig machen.',
  'websites.db.deleted': 'Datenbank {name} gelöscht',
  'websites.db.connect': 'Anwendungen auf dem Server verbinden sich mit Host 127.0.0.1, Port 3306.',
  'websites.db.noPhpMyAdmin':
    'phpMyAdmin bieten wir nicht an. Mit einem SSH-Tunnel erreichen Sie die Datenbank von Ihrem Computer aus (danach 127.0.0.1:3306 in Ihrem Datenbank-Programm):',

  // Usage, backups, mail
  'websites.usage.title': 'Speicher',
  'websites.usage.files': 'Dateien',
  'websites.usage.databases': 'Datenbanken',
  'websites.usage.measured': '{size} · gemessen {when}',
  'websites.usage.notMeasured': 'Noch nicht gemessen',
  'websites.usage.measuredAt': 'gemessen {when}',
  'websites.usage.fairUse': 'Kein festes Limit; es gilt fair use. Der Server misst alle sechs Stunden.',
  'websites.backup.title': 'Sicherung',
  'websites.backup.text':
    'Datenbanken werden jede Nacht gesichert (7 Tage, im Ordner ~/backups). Beim Löschen der Website verschwinden auch diese Sicherungen.',
  'websites.mail.title': 'E-Mail',
  'websites.mail.text':
    'Websites versenden und empfangen keine E-Mails. Postfächer für {domain} gibt es im Modul E-Mail.',
  'websites.mail.smtp': 'WordPress und andere Anwendungen versenden über ein Postfach per SMTP (Plugin).',
  'websites.mail.link': 'Zum Modul E-Mail',

  // Delete
  'websites.delete.zone': 'Gefahrenzone',
  'websites.delete.zoneText': 'Löscht die Website auf dem Server mit allen Dateien und Datenbanken.',
  'websites.delete.action': 'Website löschen',
  'websites.delete.title': 'Website {domain} löschen?',
  'websites.delete.text': 'Das lässt sich nicht rückgängig machen. Verloren gehen:',
  'websites.delete.lostFiles': 'alle Dateien in {home}',
  'websites.delete.lostFilesPlain': 'alle Dateien der Website',
  'websites.delete.lostDatabases': 'alle Datenbanken: {names}',
  'websites.delete.lostNoDatabases': 'alle Datenbanken der Website',
  'websites.delete.lostBackups': 'die nächtlichen Sicherungen der Datenbanken in ~/backups',
  'websites.delete.lostCron': 'geplante Aufgaben (Cron) und laufende Prozesse',
  'websites.delete.lostUser': 'der Benutzer {user} für SFTP und SSH',
  'websites.delete.confirm': 'Domain zur Bestätigung eingeben',
  'websites.delete.submit': 'Endgültig löschen',
  'websites.delete.pending': 'Der Server löscht die Website. Das kann bis zu drei Minuten dauern.',
  'websites.delete.done': 'Website {domain} gelöscht',
  'websites.delete.warnings': 'Website gelöscht, mit Hinweisen des Servers',

  // Admin
  'websites.admin.title': 'Websites auf CloudPanel-Servern',
  'websites.admin.text':
    'Websites für Kunden anlegen, nicht verwaltete Sites der Server übernehmen und Websites ohne Kunden aus der Konsole entfernen.',
  'websites.admin.counts':
    '{n} Websites, davon {unassigned} nicht zugewiesen und {missing} fehlen auf dem Server.',
  'websites.admin.inventoryLine': '{type} · {databases} Datenbanken',
  'websites.admin.website': 'Website',
  'websites.admin.instance': 'Server',
  'websites.admin.state': 'Zustand',
  'websites.admin.createTitle': 'Website für einen Kunden anlegen',
  'websites.admin.createText':
    'Auf einem beliebigen CloudPanel-Server, für eine Organisation oder vorerst ohne Zuweisung.',
  'websites.admin.orgHint': 'Ohne Zuweisung weisen Sie die Website später in der Liste unten zu.',
  'websites.admin.enablesModule': 'Das Modul "{module}" wird für {org} freigeschaltet.',
  'websites.admin.optionsError':
    'Server nicht erreichbar. Die Auswahl folgt den Provider-Einstellungen; der Server prüft jede Angabe.',
  'websites.admin.noAllowanceCheck':
    'Für Plattform-Mitarbeitende gilt kein Kontingent. Im Kontingent des Kunden zählt die Website trotzdem.',
  'websites.admin.forget': 'Aus der Konsole entfernen',
  'websites.admin.forgetTitle': '{domain} aus der Konsole entfernen?',
  'websites.admin.forgetText':
    'Die Website und ihre Datenbanken verschwinden aus der Konsole; auf dem Server ({instance}) bleibt alles bestehen und wird nicht mehr verwaltet.',
  'websites.admin.forgetAdopt': 'Wieder übernehmen lässt sie sich als root auf dem Server mit:',
  'websites.admin.forgotten': '{domain} aus der Konsole entfernt',
  'websites.admin.unknownHint':
    'Erscheint die Website danach im Inventar, weisen Sie sie zu; der Kunde setzt ein neues Passwort, um Zugang zu erhalten.',
  'websites.admin.unmanagedTitle': 'Nicht verwaltete Sites auf {instance}',
  'websites.admin.unmanagedText':
    'Sites auf dem Server, die die Konsole nicht verwaltet: angelegt im CloudPanel oder geschützt (z.B. die Console selbst).',
  'websites.admin.unmanagedLoad': 'Anzeigen',
  'websites.admin.unmanagedReload': 'Neu laden',
  'websites.admin.unmanagedEmpty': 'Auf {instance} gibt es keine nicht verwalteten Sites.',
  'websites.admin.adoptCol': 'Übernehmen',
  'websites.admin.protected': 'Geschützt',
  'websites.admin.protectedHint': 'Nie übernehmbar',
  'websites.admin.adopt': 'Übernehmen',
  'websites.admin.adoptTitle': '{domain} übernehmen?',
  'websites.admin.adoptText':
    'Die Konsole verwaltet die Site danach. Wer sie zugewiesen bekommt, kann Passwörter setzen, Datenbanken anlegen und die Site löschen.',
  'websites.admin.adopted': '{domain} übernommen; weisen Sie die Website jetzt einem Kunden zu.',
  'websites.admin.adoptServerHint':
    'Übernehmen geht auf diesem Server nur als root: Führen Sie den Befehl auf dem Server aus. Die Website erscheint mit der nächsten Synchronisierung als nicht zugewiesen.',
  'websites.admin.adoptRemoteHint':
    'Übernommene Sites erscheinen sofort als nicht zugewiesene Websites. Geschützte Sites lassen sich nie übernehmen.',

  // Reseller
  'websites.reseller.cardText':
    'Websites und Datenbanken, die der Kunde selbst anlegen darf, aus Ihrem Kontingent und auf Ihrem Server.',
  'websites.reseller.none': 'Kein Website-Kontingent vergeben',
  'websites.reseller.noneText': 'Ohne Kontingent kann der Kunde keine Websites anlegen.',
  'websites.reseller.pool':
    'Sie haben {sites} Websites, davon {usedSites} vergeben, und {databases} Datenbanken, davon {usedDatabases} vergeben.',
  'websites.reseller.noPool':
    'Sie haben selbst kein Website-Kontingent. Wenden Sie sich an weblion, um Websites an Kunden zu vergeben.',
  'websites.reseller.dialogText': 'Aus Ihrem Kontingent auf {instance}.',
  'websites.reseller.left': 'Höchstens {n} aus Ihrem Kontingent',
  'websites.reseller.sitesTooHigh': 'In Ihrem Kontingent sind nur noch {n} Websites frei.',
  'websites.reseller.databasesTooHigh': 'In Ihrem Kontingent sind nur noch {n} Datenbanken frei.',
  'websites.reseller.inUse': 'Der Kunde hat bereits {sites} Websites und {databases} Datenbanken.',
  'websites.reseller.enablesModule': 'Das aktiviert auch das Modul Webhosting für den Kunden.',
  'websites.reseller.removeText':
    'Der Kunde kann danach keine Websites mehr anlegen; das Kontingent geht an Sie zurück.',
  'websites.reseller.removeBlocked':
    'Nur ohne Websites möglich. Der Kunde hat noch {n}; löschen Sie sie oder holen Sie sie in Ihren Bestand zurück.',

  // Errors (codes of the API)
  'websites.errors.no_allowance': 'Für diese Organisation ist kein Website-Kontingent eingerichtet.',
  'websites.errors.allowance_exceeded': 'Das Kontingent ist ausgeschöpft.',
  'websites.errors.type_not_allowed': 'Diese Art von Website ist im Kontingent nicht enthalten.',
  'websites.errors.exists.domain': 'Diese Domain ist bereits eine Website oder gehört einem anderen Kunden.',
  'websites.errors.exists.siteUser':
    'Diesen Benutzernamen gibt es auf dem Server schon. Wählen Sie einen anderen.',
  'websites.errors.exists.database':
    'Diese Datenbank gibt es auf dem Server schon. Wählen Sie einen anderen Namen.',
  'websites.errors.dns_not_ready':
    'Das DNS zeigt noch nicht auf den Server. Prüfen Sie die Einträge oder versuchen Sie es trotzdem.',
  'websites.errors.website_busy':
    'Die Website wird gerade angelegt oder gelöscht. Versuchen Sie es danach erneut.',
  'websites.errors.website_error':
    'Die letzte Änderung der Website wurde nicht abgeschlossen. Die nächste Synchronisierung klärt den Zustand.',
  'websites.errors.website_missing': 'Der Server meldet diese Website nicht mehr.',
  'websites.errors.busy': 'Der Server ist gerade beschäftigt. Versuchen Sie es in einer Minute erneut.',
  'websites.errors.timeout':
    'Der Server hat nicht rechtzeitig geantwortet. Er arbeitet vielleicht noch; die nächste Synchronisierung zeigt das Ergebnis.',
  'websites.errors.unknownOutcome': 'Ergebnis unklar',
  'websites.errors.unknownOutcomeText':
    'Der Server hat die Änderung vielleicht trotzdem ausgeführt. Die nächste Synchronisierung zeigt das Ergebnis.',
};
