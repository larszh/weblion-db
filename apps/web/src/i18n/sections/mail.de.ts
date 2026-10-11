/**
 * E-Mail (Modul "mail", Mailcow): Navigation, Seiten der Organisation (Mail-Domains,
 * Postfächer, Weiterleitungen, DNS), Admin-Tab, Provider-Formular, Reseller-Ressourcen,
 * Dashboard-Karte und API Explorer. Keys beginnen mit "mail." (plus wenige nav/provider/
 * explorer/dashboard-Keys).
 */
export const mailDe = {
  'nav.mail': 'E-Mail',
  'perm.group.mail': 'E-Mail',

  // Admin
  'mail.admin.tab': 'E-Mail-Domains',
  'mail.admin.synced': '{seen} Mail-Domains abgeglichen, {missing} fehlen bei Mailcow',

  // Provider form
  'providers.mailcow.help':
    'Erstellen Sie in Mailcow als Admin einen API-Key mit Lese- und Schreibzugriff und tragen Sie die ausgehenden IPv4- und IPv6-Adressen der Console in seine Allow-List ein. Fehlgeschlagene Anmeldungen sperren die IP der Console: Setzen Sie sie vor dem ersten Test auf die Netfilter-Whitelist von Mailcow.',
  'providers.mailcow.url': 'URL der Mailcow-Instanz',
  'providers.mailcow.urlHint':
    'So, wie die Console Mailcow erreicht, mit gültigem Zertifikat und ohne Pfad, z.B. https://mail.weblion.one',
  'providers.mailcow.apiKey': 'API-Key (Lesen & Schreiben)',
  'providers.mailcow.apiKeyHint':
    'Mailcow > System > Konfiguration > Zugang > API. "IP-Prüfung überspringen" bleibt aus, ein Key nur zum Lesen reicht nicht.',
  'providers.mailcow.apiKeyInvalid': 'Nur Buchstaben, Ziffern und "-", mindestens 16 Zeichen.',
  'providers.mailcow.mailHost': 'Mailserver-Hostname (optional)',
  'providers.mailcow.mailHostHint':
    'Für MX, IMAP, SMTP und Webmail, wenn er vom Host der URL abweicht. Standard: der Host der URL.',
  'providers.mailcow.mailHostInvalid': 'Ein Hostname wie mail.weblion.one.',
  'providers.mailcow.domainsText': 'Mail-Domains dieser Instanz, ihre Limits und die Zuweisung an Kunden.',
  'providers.mailcow.toDomains': 'Zu den Mail-Domains',

  // Reseller resources
  'admin.resources.title.maildomain': 'E-Mail-Domains',
  'admin.resources.empty.maildomain': 'Diesem Kunden sind keine E-Mail-Domains zugewiesen.',
  'admin.resources.assign.maildomain': 'E-Mail-Domain zuweisen',
  'admin.resources.mailDomains': 'E-Mail-Domains',
  'admin.blocker.mailDomains': 'E-Mail-Domains: {n}',

  // API explorer
  'explorer.mailcowPath':
    'Pfade beginnen mit /api/v1/get, /add, /edit oder /delete. Die Methode ergibt sich aus dem Pfad: get liest (GET), alles andere ändert (POST). Passwörter und Schlüssel in Antworten werden ausgeblendet.',
  'explorer.mailcowBodyHint':
    'add: die Attribute. edit: { "items": [...], "attr": {...} }. delete: { "items": [...] }, die Console sendet die Liste selbst. Werte als Text ("1"/"0"), Grössen in MiB.',

  // Mail domain list
  'mail.subtitle':
    'E-Mail-Domains Ihrer Organisation mit Postfächern und Weiterleitungen, Webmail, IMAP und SMTP.',
  'mail.noAccess': 'Sie haben keinen Zugriff auf die E-Mail-Domains dieser Organisation.',
  'mail.none.title': 'Noch keine E-Mail-Domain',
  'mail.none.text':
    'E-Mail-Domains richtet weblion.one für Sie ein. Sobald eine Domain Ihrer Organisation zugewiesen ist, erstellen Sie hier Postfächer und Weiterleitungen.',
  'mail.none.textReseller':
    'E-Mail-Domains richtet {reseller} für Sie ein. Sobald eine Domain Ihrer Organisation zugewiesen ist, erstellen Sie hier Postfächer und Weiterleitungen.',
  'mail.search': 'Domain suchen',
  'mail.lastSync': 'Verbrauch zuletzt aktualisiert {when}',
  'mail.notFound': 'E-Mail-Domain nicht gefunden',
  'mail.count.of': '{n} von {max}',
  'mail.storage.allocated': '{allocated} von {quota} vergeben',
  'mail.storage.used': '{used} belegt',
  'mail.col.domain': 'Domain',
  'mail.col.mailboxes': 'Postfächer',
  'mail.col.aliases': 'Weiterleitungen',
  'mail.col.storage': 'Speicher',
  'mail.col.status': 'Status',
  'mail.col.server': 'Server',
  'mail.col.instance': 'Instanz',
  'mail.col.address': 'Adresse',
  'mail.col.name': 'Name',
  'mail.col.lastLogin': 'Letzte Anmeldung',
  'mail.col.targets': 'Ziele',
  'mail.status.active': 'Aktiv',
  'mail.status.inactive': 'Inaktiv',
  'mail.status.relay': 'Relay',
  'mail.status.missing': 'Fehlt bei Mailcow',

  // Mail domain detail
  'mail.tab.label': 'Bereiche der E-Mail-Domain',
  'mail.tab.overview': 'Übersicht',
  'mail.tab.mailboxes': 'Postfächer',
  'mail.tab.aliases': 'Weiterleitungen',
  'mail.tab.dns': 'DNS-Einträge',
  'mail.liveError.title': 'Live-Daten nicht verfügbar',
  'mail.liveError.text':
    '{provider} ist gerade nicht erreichbar. Angezeigt werden die Limits und der Verbrauch der letzten Synchronisation.',
  'mail.missing.title': 'Bei Mailcow nicht mehr gefunden',
  'mail.missing.text':
    'Die Domain fehlt seit {date} in der Liste von Mailcow. Postfächer und Weiterleitungen lassen sich nicht mehr ändern. Wenden Sie sich an uns, wenn das nicht so sein soll.',
  'mail.relay.title': 'Relay-Domain',
  'mail.relay.text':
    'Mailcow nimmt E-Mails für diese Domain an und leitet sie an einen anderen Server weiter. Postfächer und Weiterleitungen gibt es hier deshalb nicht.',

  // Limits
  'mail.limits.title': 'Limits und Verbrauch',
  'mail.limits.text':
    'Die Limits legt weblion.one (oder Ihr Anbieter) fest, der Mailserver setzt sie durch. Für andere Limits kontaktieren Sie uns.',
  'mail.limits.none': 'Für diese Domain liegen noch keine Daten von Mailcow vor.',
  'mail.limits.mailboxes': 'Postfächer',
  'mail.limits.aliases': 'Weiterleitungen',
  'mail.limits.used': 'Davon belegt',
  'mail.limits.storage': 'Speicher vergeben',
  'mail.limits.storageValue': '{allocated} von {quota}',
  'mail.limits.storageHint':
    'Vergeben ist die Summe der Postfachgrössen. Neue Postfächer erhalten Speicher aus dem Rest.',
  'mail.limits.defaultSize': 'Standardgrösse neuer Postfächer',
  'mail.limits.maxSize': 'Höchstgrösse pro Postfach',
  'mail.limits.rateLimit': 'Versandlimit',
  'mail.limits.active': 'Domain aktiv',
  'mail.limits.activeYes': 'Ja',
  'mail.limits.activeNo': 'Nein, nimmt keine E-Mails an',
  'mail.rate.none': 'Keines',
  'mail.rate.value': '{n} Nachrichten {frame}',
  'mail.rate.frame.s': 'pro Sekunde',
  'mail.rate.frame.m': 'pro Minute',
  'mail.rate.frame.h': 'pro Stunde',
  'mail.rate.frame.d': 'pro Tag',

  // Client settings
  'mail.client.title': 'Einstellungen für Mailprogramme',
  'mail.client.text': 'So verbinden Sie Outlook, Apple Mail, Thunderbird oder Ihr Smartphone.',
  'mail.client.none': 'Die Servereinstellungen sind gerade nicht verfügbar.',
  'mail.client.webmail': 'Webmail öffnen',
  'mail.client.protocol': 'Dienst',
  'mail.client.server': 'Server',
  'mail.client.port': 'Port',
  'mail.client.security': 'Verschlüsselung',
  'mail.client.imap': 'IMAP (Empfang)',
  'mail.client.smtp': 'SMTP (Versand)',
  'mail.client.pop3': 'POP3 (Empfang)',
  'mail.client.ssl': 'SSL/TLS',
  'mail.client.starttls': 'STARTTLS',
  'mail.client.preferred': 'Empfohlen',
  'mail.client.username': 'Der Benutzername ist immer die vollständige E-Mail-Adresse.',
  'mail.client.smtpAuth':
    'Der Postausgangsserver (SMTP) erfordert eine Anmeldung mit demselben Benutzernamen und Passwort.',
  'mail.client.mailHost': 'Mailserver',
  'mail.client.imapHost': 'IMAP-Server',
  'mail.client.smtpHost': 'SMTP-Server',

  // Mailboxes
  'mail.mailbox.title': 'Postfächer',
  'mail.mailbox.text': 'Postfächer dieser Domain bei Mailcow.',
  'mail.mailbox.countText': '{n} von {max} Postfächern, noch {free} Speicher frei',
  'mail.mailbox.search': 'Postfach suchen',
  'mail.mailbox.create': 'Postfach erstellen',
  'mail.mailbox.empty': 'Noch keine Postfächer',
  'mail.mailbox.emptyText':
    'Erstellen Sie ein Postfach für jede Person oder Funktion, die E-Mails empfangen soll.',
  'mail.mailbox.never': 'Nie',
  'mail.mailbox.usage': '{used} von {quota}',
  'mail.mailbox.usageUnlimited': '{used} belegt, unbegrenzt',
  'mail.mailbox.limitReached':
    'Alle {max} Postfächer dieser Domain sind vergeben. Löschen Sie ein Postfach oder kontaktieren Sie uns für ein höheres Limit.',
  'mail.mailbox.noStorage':
    'Der Speicher dieser Domain ist vollständig an Postfächer vergeben. Verkleinern Sie ein Postfach oder kontaktieren Sie uns für mehr Speicher.',
  'mail.mailbox.createTitle': 'Postfach erstellen',
  'mail.mailbox.createText': 'Ein neues Postfach unter {domain}, mit IMAP, SMTP und Webmail.',
  'mail.mailbox.addressPreview': 'Adresse:',
  'mail.mailbox.localHint':
    'Kleinbuchstaben a-z, Ziffern, Punkt, Bindestrich und Unterstrich, am Anfang und Ende ein Buchstabe oder eine Ziffer.',
  'mail.mailbox.localPlaceholder': 'vorname.nachname',
  'mail.mailbox.localInvalid':
    'Nur a-z, 0-9, Punkt, Bindestrich und Unterstrich, am Anfang und Ende ein Buchstabe oder eine Ziffer.',
  'mail.mailbox.taken': 'Diese Adresse gibt es schon.',
  'mail.mailbox.namePlaceholder': 'Anna Muster',
  'mail.mailbox.nameInvalid': 'Ohne < und >.',
  'mail.mailbox.nameTooLong': 'Höchstens {max} Zeichen.',
  'mail.mailbox.nameRequired': 'Mailcow kann einen Namen nicht entfernen, nur ersetzen.',
  'mail.mailbox.nameHint': 'Mailcow kann einen Namen nicht entfernen, nur ersetzen.',
  'mail.mailbox.size': 'Grösse',
  'mail.mailbox.sizeHint': 'Höchstens {max} pro Postfach, noch {free} frei',
  'mail.mailbox.sizeTooLarge': 'Ein Postfach dieser Domain darf höchstens {max} gross sein.',
  'mail.mailbox.sizeNoSpace': 'Dafür reicht der Speicher der Domain nicht: höchstens {free}.',
  'mail.mailbox.sizeUnlimited':
    'Zurzeit unbegrenzt (ausserhalb der Console angelegt). Leer lassen, um das beizubehalten.',
  'mail.mailbox.sizeUsed': 'Belegt: {used}',
  'mail.mailbox.belowUsageTitle': 'Kleiner als belegt',
  'mail.mailbox.belowUsage':
    'Das Postfach belegt {used}. Ist es kleiner, nimmt der Mailserver keine neuen E-Mails mehr an, bis Platz frei wird.',
  'mail.mailbox.created': 'Postfach {address} erstellt',
  'mail.mailbox.createdTitle': 'Postfach erstellt',
  'mail.mailbox.editTitle': '{address} bearbeiten',
  'mail.mailbox.updated': 'Postfach {address} gespeichert',
  'mail.mailbox.lockLogin': 'Anmeldung sperren',
  'mail.mailbox.allowLogin': 'Anmeldung erlauben',
  'mail.mailbox.deactivate': 'Deaktivieren',
  'mail.mailbox.activate': 'Aktivieren',
  'mail.mailbox.stateTitle.active': '{address} aktivieren?',
  'mail.mailbox.stateTitle.login_disabled': 'Anmeldung für {address} sperren?',
  'mail.mailbox.stateTitle.inactive': '{address} deaktivieren?',
  'mail.mailbox.stateConfirm.active': 'Aktivieren',
  'mail.mailbox.stateConfirm.login_disabled': 'Anmeldung sperren',
  'mail.mailbox.stateConfirm.inactive': 'Deaktivieren',
  'mail.mailbox.stateDone.active': '{address} ist aktiv',
  'mail.mailbox.stateDone.login_disabled': 'Anmeldung für {address} gesperrt',
  'mail.mailbox.stateDone.inactive': '{address} deaktiviert',
  'mail.mailbox.deleteTitle': '{address} löschen?',
  'mail.mailbox.deleteConfirm': 'Postfach löschen',
  'mail.mailbox.deleteWarningTitle': 'Alle E-Mails werden gelöscht',
  'mail.mailbox.deleteText':
    'Das Postfach und seine E-Mails ({used}) werden gelöscht. Mailcow bewahrt sie noch einige Tage in seinem Papierkorb auf, die Console kann sie aber nicht wiederherstellen. Weiterleitungen, die nur hierher führen, werden ebenfalls gelöscht, aus anderen wird die Adresse entfernt.',
  'mail.mailbox.deleted': 'Postfach {address} gelöscht',

  // Mailbox states
  'mail.state.active': 'Aktiv',
  'mail.state.login_disabled': 'Anmeldung gesperrt',
  'mail.state.inactive': 'Inaktiv',
  'mail.state.active.hint': 'Empfängt E-Mails, Anmeldung mit IMAP, SMTP, POP3 und Webmail möglich.',
  'mail.state.login_disabled.hint': 'Empfängt weiter E-Mails, die Anmeldung ist gesperrt.',
  'mail.state.inactive.hint': 'Nimmt keine E-Mails mehr an, die Anmeldung ist gesperrt.',

  // Passwords
  'mail.password.label': 'Passwort',
  'mail.password.generate': 'Sicheres Passwort erzeugen',
  'mail.password.generateText': 'Die Console erzeugt ein Passwort und zeigt es Ihnen einmal an.',
  'mail.password.choose': 'Passwort selbst festlegen',
  'mail.password.chooseText': 'Sie geben das Passwort ein, die Console zeigt es danach nicht mehr an.',
  'mail.password.new': 'Neues Passwort',
  'mail.password.repeat': 'Passwort wiederholen',
  'mail.password.mismatch': 'Die Passwörter stimmen nicht überein.',
  'mail.password.rules': 'Anforderungen an das Passwort',
  'mail.password.rule.length': 'Mindestens {n} Zeichen',
  'mail.password.rule.tooLong': 'Höchstens {n} Zeichen',
  'mail.password.rule.characters': 'Nur Buchstaben, Ziffern und Sonderzeichen ohne Umlaute und Leerzeichen',
  'mail.password.rule.letters': 'Mindestens ein Buchstabe',
  'mail.password.rule.mixedCase': 'Gross- und Kleinbuchstaben',
  'mail.password.rule.digits': 'Mindestens eine Ziffer',
  'mail.password.rule.specialChars': 'Mindestens ein Sonderzeichen',
  'mail.password.noPolicy':
    'Die Passwortrichtlinie von Mailcow ist gerade nicht lesbar. Es gelten die Regeln der Console, Mailcow prüft beim Speichern zusätzlich.',
  'mail.password.action': 'Neues Passwort',
  'mail.password.title': 'Neues Passwort für {address}',
  'mail.password.text':
    'Das bisherige Passwort gilt danach nicht mehr. Mailprogramme und Smartphones brauchen das neue Passwort.',
  'mail.password.set': 'Passwort setzen',
  'mail.password.newTitle': 'Neues Passwort',
  'mail.password.changed': 'Passwort für {address} geändert',

  // Aliases
  'mail.alias.title': 'Weiterleitungen',
  'mail.alias.text': 'Adressen, die E-Mails an Postfächer oder externe Adressen weiterleiten.',
  'mail.alias.countText': '{n} von {max} Weiterleitungen',
  'mail.alias.search': 'Weiterleitung suchen',
  'mail.alias.create': 'Weiterleitung erstellen',
  'mail.alias.empty': 'Noch keine Weiterleitungen',
  'mail.alias.emptyText':
    'Mit einer Weiterleitung kommen E-Mails an info@ oder team@ bei einem oder mehreren Postfächern an.',
  'mail.alias.limitReached':
    'Alle {max} Weiterleitungen dieser Domain sind vergeben. Löschen Sie eine oder kontaktieren Sie uns für ein höheres Limit.',
  'mail.alias.catchAll': 'Alle anderen Adressen (Catch-all)',
  'mail.alias.active': 'Aktiv',
  'mail.alias.inactive': 'Inaktiv',
  'mail.alias.special.discard': 'Verwerfen',
  'mail.alias.special.spam': 'Als Spam lernen',
  'mail.alias.special.ham': 'Als Ham lernen',
  'mail.alias.special.discard.hint': 'E-Mails an diese Adresse werden ohne Rückmeldung gelöscht.',
  'mail.alias.special.spam.hint': 'E-Mails an diese Adresse trainieren den Spamfilter als Spam.',
  'mail.alias.special.ham.hint': 'E-Mails an diese Adresse trainieren den Spamfilter als erwünschte E-Mails.',
  'mail.alias.specialReadOnly':
    'Diese Weiterleitung verwirft E-Mails oder trainiert den Spamfilter. Ihre Ziele lassen sich nur in Mailcow ändern, ein- und ausschalten können Sie sie hier.',
  'mail.alias.createTitle': 'Weiterleitung erstellen',
  'mail.alias.createText': 'E-Mails an eine Adresse unter {domain} gehen an die Ziele.',
  'mail.alias.editTitle': '{address} bearbeiten',
  'mail.alias.kind': 'Art',
  'mail.alias.kind.address': 'Adresse',
  'mail.alias.kind.addressText': 'Eine bestimmte Adresse, z.B. info@ oder team@.',
  'mail.alias.kind.catchAll': 'Catch-all',
  'mail.alias.kind.catchAllText':
    'Alle Adressen der Domain, für die es kein Postfach und keine Weiterleitung gibt.',
  'mail.alias.catchAllExists': 'Diese Domain hat schon eine Catch-all-Weiterleitung.',
  'mail.alias.catchAllTitle': 'Catch-all zieht Spam an',
  'mail.alias.catchAllHint':
    'Jede Adresse unter @{domain}, auch vertippte und erfundene, kommt bei den Zielen an. Spammer probieren solche Adressen oft durch.',
  'mail.alias.localPlaceholder': 'info',
  'mail.alias.taken': 'Diese Adresse gibt es schon als Postfach oder Weiterleitung.',
  'mail.alias.targetsHint':
    'Eine Adresse pro Zeile oder durch Kommas getrennt, höchstens {max}. Externe Adressen sind erlaubt.',
  'mail.alias.targetsRequired': 'Geben Sie mindestens ein Ziel an.',
  'mail.alias.targetsTooMany': 'Höchstens {max} Ziele.',
  'mail.alias.targetsInvalid': 'Keine gültige E-Mail-Adresse: {list}',
  'mail.alias.targetsSelf': 'Eine Weiterleitung kann nicht an sich selbst weiterleiten.',
  'mail.alias.pick': 'Postfach als Ziel hinzufügen',
  'mail.alias.pickPlaceholder': 'Postfach oder Adresse hinzufügen',
  'mail.alias.external': '{n} Ziel(e) ausserhalb dieser Domain: E-Mails werden dorthin weitergeleitet.',
  'mail.alias.activeLabel': 'Aktiv',
  'mail.alias.activeHint': 'Inaktive Weiterleitungen nehmen keine E-Mails an.',
  'mail.alias.created': 'Weiterleitung {address} erstellt',
  'mail.alias.updated': 'Weiterleitung {address} gespeichert',
  'mail.alias.activate': 'Aktivieren',
  'mail.alias.deactivate': 'Deaktivieren',
  'mail.alias.activateTitle': '{address} aktivieren?',
  'mail.alias.deactivateTitle': '{address} deaktivieren?',
  'mail.alias.activateText': 'Die Weiterleitung nimmt danach wieder E-Mails an.',
  'mail.alias.deactivateText':
    'Die Weiterleitung nimmt danach keine E-Mails mehr an. Die Ziele bleiben gespeichert.',
  'mail.alias.activated': 'Weiterleitung {address} aktiviert',
  'mail.alias.deactivated': 'Weiterleitung {address} deaktiviert',
  'mail.alias.deleteTitle': '{address} löschen?',
  'mail.alias.deleteText':
    'E-Mails an diese Adresse werden danach abgewiesen. Die Postfächer der Ziele bleiben unverändert.',
  'mail.alias.deleted': 'Weiterleitung {address} gelöscht',

  // DNS setup
  'mail.dns.noZone':
    'Die Domain wird nicht in dieser Console verwaltet. Tragen Sie die Einträge bei Ihrem DNS-Anbieter ein.',
  'mail.dns.zoneError': 'Die DNS-Einträge der Domain konnten nicht gelesen werden',
  'mail.dns.notLiveTitle': 'Die Domain nutzt andere Nameserver',
  'mail.dns.notLive':
    '{domain} wird zurzeit nicht über die Nameserver von {provider} aufgelöst. Änderungen hier wirken erst, wenn die Domain diese Nameserver nutzt.',
  'mail.dns.notWritable':
    'Bei {provider} lassen sich die DNS-Einträge dieser Domain zurzeit nicht ändern. Tragen Sie die fehlenden Einträge von Hand ein.',
  'mail.dns.noPermission':
    'Sie dürfen die DNS-Einträge dieser Domain nicht ändern. Wenden Sie sich an den Owner Ihrer Organisation.',
  'mail.dns.dkimTitle': 'DKIM-Schlüssel',
  'mail.dns.dkimText':
    'Mailcow signiert ausgehende E-Mails mit diesem Schlüssel. Der DNS-Eintrag macht die Signatur prüfbar.',
  'mail.dns.dkimSelector': 'Selektor',
  'mail.dns.dkimLength': 'Schlüssellänge',
  'mail.dns.dkimBits': '{n} Bit',
  'mail.dns.dkimMissing':
    'Für diese Domain gibt es noch keinen DKIM-Schlüssel. Ohne ihn landen E-Mails eher im Spam.',
  'mail.dns.dkimSizeHint': '2048 Bit ist am verträglichsten mit allen DNS-Anbietern und Mailservern.',
  'mail.dns.dkimCreate': 'DKIM-Schlüssel erzeugen',
  'mail.dns.dkimCreated': 'DKIM-Schlüssel erzeugt',
  'mail.dns.recordsTitle': 'Benötigte DNS-Einträge',
  'mail.dns.recordsZone': 'Verglichen mit der DNS-Zone {domain}',
  'mail.dns.recordsText': 'Diese Einträge braucht der Mailserver {host}.',
  'mail.dns.toZone': 'Zur DNS-Verwaltung',
  'mail.dns.apply': 'Fehlende Einträge hinzufügen ({n})',
  'mail.dns.applyTitle': 'Fehlende Einträge hinzufügen?',
  'mail.dns.applyText':
    'Die Console trägt diese Einträge in der Zone {domain} bei {provider} ein. Bestehende Einträge bleiben unverändert.',
  'mail.dns.applyConfirm': '{n} Einträge hinzufügen',
  'mail.dns.applied.title': 'DNS-Einträge hinzugefügt',
  'mail.dns.applied.toast': '{n} DNS-Einträge hinzugefügt',
  'mail.dns.applied.added': 'Hinzugefügt: {list}',
  'mail.dns.applied.nothing': 'Es war nichts hinzuzufügen.',
  'mail.dns.applied.failed': '{key} fehlgeschlagen:',
  'mail.dns.col.status': 'Status',
  'mail.dns.col.type': 'Eintrag',
  'mail.dns.col.name': 'Name',
  'mail.dns.col.value': 'Wert',
  'mail.dns.required': 'Pflicht',
  'mail.dns.recommended': 'Empfohlen',
  'mail.dns.noKeyYet': 'Erst nach dem Erzeugen des DKIM-Schlüssels',
  'mail.dns.found': 'Gefunden ({n})',
  'mail.dns.status.ok': 'In Ordnung',
  'mail.dns.status.missing': 'Fehlt',
  'mail.dns.status.conflict': 'Weicht ab',
  'mail.dns.status.unknown': 'Unbekannt',
  'mail.dns.key.mx': 'MX',
  'mail.dns.key.spf': 'SPF',
  'mail.dns.key.dkim': 'DKIM',
  'mail.dns.key.dmarc': 'DMARC',
  'mail.dns.key.autodiscover': 'Autodiscover',
  'mail.dns.key.autoconfig': 'Autoconfig',
  'mail.dns.key.autodiscover_srv': 'Autodiscover (SRV)',
  'mail.dns.hint.other_mx':
    'Die MX-Einträge zeigen auf einen anderen Mailserver. E-Mails kommen dort an, nicht bei Mailcow.',
  'mail.dns.hint.other_spf':
    'Der SPF-Eintrag erlaubt diesen Mailserver nicht. Ergänzen Sie ihn um "mx" oder um den Mailserver.',
  'mail.dns.hint.several_spf':
    'Es gibt mehrere SPF-Einträge. Erlaubt ist nur einer: Fassen Sie sie zusammen.',
  'mail.dns.hint.other_target': 'Der Eintrag zeigt auf einen anderen Server.',
  'mail.dns.hint.name_in_use': 'Unter diesem Namen gibt es schon andere Einträge.',
  'mail.dns.hint.other_dkim_key': 'Der DKIM-Eintrag enthält einen anderen Schlüssel als Mailcow.',
  'mail.dns.hint.no_dkim_key': 'Erzeugen Sie zuerst den DKIM-Schlüssel.',
  'mail.dns.hint.several_dmarc': 'Es gibt mehrere DMARC-Einträge. Erlaubt ist nur einer.',
  'mail.dns.hint.type_not_supported': 'Dieser Eintragstyp lässt sich beim DNS-Anbieter nicht anlegen.',
  'mail.dns.skip.not_missing': 'nicht fehlend',
  'mail.dns.skip.not_supported': 'Typ beim DNS-Anbieter nicht möglich',
  'mail.dns.skip.no_dkim_key': 'noch kein DKIM-Schlüssel',
  'mail.dns.explain.title': 'Wozu die Einträge dienen',
  'mail.dns.explain.mx.label': 'MX',
  'mail.dns.explain.mx': 'Sagt anderen Mailservern, wohin E-Mails für die Domain gehen.',
  'mail.dns.explain.spf.label': 'SPF',
  'mail.dns.explain.spf': 'Legt fest, welche Server E-Mails im Namen der Domain senden dürfen.',
  'mail.dns.explain.dkim.label': 'DKIM',
  'mail.dns.explain.dkim': 'Veröffentlicht den Schlüssel, mit dem Empfänger die Signatur der E-Mails prüfen.',
  'mail.dns.explain.dmarc.label': 'DMARC',
  'mail.dns.explain.dmarc':
    'Sagt Empfängern, was mit E-Mails geschehen soll, die SPF und DKIM nicht bestehen (die Console schlägt "nur beobachten" vor).',
  'mail.dns.explain.autodiscover.label': 'Autodiscover',
  'mail.dns.explain.autodiscover':
    'Damit Outlook, Thunderbird und Smartphones die Servereinstellungen selbst finden.',
  'mail.dns.explain.conflicts':
    'Abweichende Einträge ändert oder löscht die Console nie von sich aus. Passen Sie sie in der DNS-Verwaltung an.',

  // Limit answers of the API (409 mail_limit)
  'mail.limit.mailboxes': 'Diese Domain hat schon alle {max} Postfächer, die sie haben darf.',
  'mail.limit.aliases': 'Diese Domain hat schon alle {max} Weiterleitungen, die sie haben darf.',
  'mail.limit.storage':
    'Der Speicher der Domain reicht nicht: {used} von {max} sind schon an Postfächer vergeben.',
  'mail.limit.mailboxSize': 'Ein Postfach dieser Domain darf höchstens {max} gross sein.',

  // Sizes
  'mail.units.unit': 'Einheit',
  'mail.units.unlimited': 'unbegrenzt',
  'mail.units.invalid': 'Eine ganze Zahl MB (z.B. 500 MB oder 2.5 GB).',
  'mail.units.required': 'Geben Sie eine Grösse an.',

  // Admin tab
  'mail.admin.tabHint':
    'Mail-Domains werden bei einer Mailcow-Instanz angelegt und einem Kunden zugewiesen. Bestehende Domains erscheinen nach der Synchronisation. Instanzen verwalten Sie unter Provider.',
  'mail.admin.search': 'Mail-Domain suchen',
  'mail.admin.filterInstance': 'Nach Instanz filtern',
  'mail.admin.allInstances': 'Alle Instanzen',
  'mail.admin.filterCustomer': 'Nach Kunde filtern',
  'mail.admin.allCustomers': 'Alle Kunden',
  'mail.admin.create': 'Mail-Domain anlegen',
  'mail.admin.noInstance': 'Noch keine Mailcow-Instanz verbunden.',
  'mail.admin.empty': 'Keine Mail-Domains',
  'mail.admin.emptyText': 'Legen Sie eine Mail-Domain an oder synchronisieren Sie eine Mailcow-Instanz.',
  'mail.admin.missingSince': 'Fehlt seit {date}',
  'mail.admin.open': 'Öffnen',
  'mail.admin.reassign': 'Zuweisung ändern',
  'mail.admin.limits': 'Limits ändern',
  'mail.admin.unassignText':
    '{org} verliert den Zugriff auf Postfächer und Weiterleitungen in der Console. Bei Mailcow ändert sich nichts, die E-Mails fliessen weiter.',
  'mail.admin.assignText':
    'Der Kunde sieht die Domain danach unter "E-Mail" und verwaltet dort Postfächer und Weiterleitungen.',
  'mail.admin.moduleOff':
    'Ohne das Modul "{module}" sieht der Kunde die Mail-Domain nicht, auch wenn sie ihm zugewiesen ist.',
  'mail.admin.createTitle': 'Mail-Domain anlegen',
  'mail.admin.createText':
    'Die Domain wird bei Mailcow angelegt, mit Limits und DKIM-Schlüssel. Die DNS-Einträge richtet der Kunde danach unter "DNS-Einträge" ein.',
  'mail.admin.creating':
    'Mailcow legt die Domain an. Mit dem Neustart von Webmail kann das bis zu zwei Minuten dauern. Schliessen Sie das Fenster nicht.',
  'mail.admin.instanceHint': 'Die MX-Einträge der Domain zeigen später auf diese Instanz.',
  'mail.admin.chooseInstance': 'Instanz wählen…',
  'mail.admin.domainHint': 'Ohne www, z.B. kunde.ch. Umlaut-Domains sind möglich.',
  'mail.admin.domainInvalid': 'Geben Sie einen Domainnamen wie kunde.ch ein.',
  'mail.admin.asciiPreview': 'Bei Mailcow:',
  'mail.admin.description': 'Beschreibung',
  'mail.admin.descriptionPlaceholder': 'Muster AG',
  'mail.admin.descriptionTooLong': 'Höchstens 255 Zeichen.',
  'mail.admin.limitsSection': 'Limits',
  'mail.admin.dkimKeySize': 'DKIM-Schlüssellänge',
  'mail.admin.quota': 'Speicher gesamt',
  'mail.admin.quotaHint': 'Was alle Postfächer zusammen erhalten können.',
  'mail.admin.inUse': 'In Gebrauch: {value}',
  'mail.admin.numberRange': 'Eine ganze Zahl von {min} bis {max}.',
  'mail.admin.belowUsage': 'Mindestens {n}, so viele sind in Gebrauch.',
  'mail.admin.belowAllocated': 'Mindestens {size}, so viel ist an Postfächer vergeben.',
  'mail.admin.defaultAboveMax': 'Die Standardgrösse darf die Höchstgrösse nicht überschreiten.',
  'mail.admin.maxAboveQuota': 'Die Höchstgrösse darf den Speicher der Domain nicht überschreiten.',
  'mail.admin.rateHint': 'Wie viele E-Mails die ganze Domain senden darf.',
  'mail.admin.rateValue': 'Anzahl Nachrichten',
  'mail.admin.rateMessages': 'Nachrichten',
  'mail.admin.rateFrame': 'Zeitraum',
  'mail.admin.restartSogo': 'Webmail (SOGo) neu starten',
  'mail.admin.restartSogoHint':
    'Damit Webmail die neue Domain kennt. Unterbricht Webmail, Kalender und Kontakte für alle Benutzer dieser Instanz kurz.',
  'mail.admin.noCustomer': 'Noch keinem Kunden zuweisen',
  'mail.admin.created': 'Mail-Domain {name} angelegt',
  'mail.admin.warnings': 'Mailcow meldet Hinweise',
  'mail.admin.limitsTitle': 'Limits von {name}',
  'mail.admin.limitsText': 'Mailcow prüft die Limits gegen den Verbrauch und lehnt zu kleine Werte ab.',
  'mail.admin.limitsCustomer': 'Die Änderung gilt sofort für {org}.',
  'mail.admin.limitsSaved': 'Limits von {name} gespeichert',
  'mail.admin.active': 'Domain aktiv',
  'mail.admin.activeHint': 'Inaktive Domains nehmen keine E-Mails an.',
  'mail.admin.deleteTitle': '{name} löschen?',
  'mail.admin.deleteNotEmpty': 'Mailcow löscht nur leere Domains. Noch {n} Postfächer.',
  'mail.admin.deleteNotEmptyHint':
    'Löschen Sie zuerst die Postfächer. {org} kann das unter "E-Mail" selbst tun.',
  'mail.admin.deleteConfirm': 'Mail-Domain löschen',
  'mail.admin.deleteWarningTitle': 'Die Domain wird bei Mailcow gelöscht',
  'mail.admin.deleteText':
    'Ihre Weiterleitungen werden mitgelöscht. E-Mails bleiben einige Tage im Papierkorb von Mailcow, die Console kann sie nicht wiederherstellen.',
  'mail.admin.deleteGone':
    'Die Domain gibt es bei Mailcow nicht mehr. Die Console entfernt nur noch ihren Eintrag.',
  'mail.admin.deleteAssigned': '{org} verliert die Domain.',
  'mail.admin.deleteDkim': 'DKIM-Schlüssel ebenfalls löschen',
  'mail.admin.deleteDkimHint':
    'Mailcow behält ihn sonst und verwendet ihn wieder, wenn die Domain neu angelegt wird.',
  'mail.admin.deleted': 'Mail-Domain {name} gelöscht',

  // Dashboard
  'dashboard.mail.summary': '{domains} Domains, {mailboxes} Postfächern genutzt',
  'dashboard.mail.summaryOne': '1 Domain, {mailboxes} Postfächern genutzt',
  'dashboard.mail.mailboxes': '{count} Postfächer',
  'dashboard.mail.none': 'Noch keine E-Mail-Domains.',
} as const;
