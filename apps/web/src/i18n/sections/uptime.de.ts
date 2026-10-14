/**
 * Monitoring (Modul "monitoring", Uptime Kuma): Navigation, Provider-Formular, Reseller-Ressourcen,
 * Dashboard und API Explorer. Die Seiten der Organisation und des Admin-Bereichs ergänzen ihre
 * Keys mit dem Präfix "uptime." (das Präfix "monitoring." gehört dem Verfügbarkeits-Tab der
 * Server), plus wenige nav/provider/explorer/admin-Keys.
 */
export const uptimeDe = {
  'nav.uptime': 'Monitoring',
  'nav.admin.uptime': 'Monitoring',
  'perm.group.monitoring': 'Monitoring',

  // Admin
  'uptime.admin.synced': '{seen} Monitore abgeglichen, {missing} nicht mehr gemeldet',

  // Customer pages
  'uptime.subtitle':
    'Verfügbarkeit Ihrer Websites und Dienste: Status, Uptime, Antwortzeit und Ablauf der Zertifikate.',
  'uptime.noAccess': 'Kein Zugriff auf Monitore',
  'uptime.noAccessText':
    'Ihnen fehlt die Berechtigung, die Monitore dieser Organisation anzusehen. Wenden Sie sich an den Owner Ihrer Organisation.',
  'uptime.none.title': 'Noch keine Monitore',
  'uptime.none.text':
    'Für Ihre Organisation sind noch keine Monitore eingerichtet. Wenden Sie sich an weblion, wenn Sie Ihre Websites und Dienste überwachen lassen möchten.',
  'uptime.none.textReseller':
    'Für Ihre Organisation sind noch keine Monitore eingerichtet. Wenden Sie sich an {reseller}, wenn Sie Ihre Websites und Dienste überwachen lassen möchten.',
  'uptime.create': 'Monitor erstellen',
  'uptime.openStatusPage': 'Statusseite öffnen',
  'uptime.statusPages': 'Statusseiten',
  'uptime.allowance.title': 'Kontingent',
  'uptime.allowance.text':
    'So viele eigene Monitore können Sie anlegen, und so oft dürfen sie höchstens prüfen.',
  'uptime.allowance.monitors': 'Monitore',
  'uptime.allowance.used': '{n} von {max} Monitoren',
  'uptime.allowance.toCustomers': 'davon {n} an {customers} Kunden vergeben',
  'uptime.allowance.minInterval': 'Kürzestes Prüfintervall',
  'uptime.allowance.full':
    'Ihr Kontingent ist ausgeschöpft. Löschen Sie einen Monitor oder wenden Sie sich an Ihren Anbieter.',
  'uptime.managementOff':
    'Eigene Monitore können zurzeit nicht angelegt oder geändert werden, weil die Uptime-Kuma-Instanz nicht für die Verwaltung angemeldet ist. Status und Uptime bleiben sichtbar.',
  'uptime.monitors': 'Monitore',
  'uptime.monitorsText': 'Status, Uptime und Antwortzeit Ihrer Monitore.',
  'uptime.lastSync': 'Zuletzt abgeglichen {when}',
  'uptime.search': 'Monitor oder Ziel suchen…',
  'uptime.filter.label': 'Nach Status filtern',
  'uptime.filter.all': 'Alle Status',
  'uptime.filter.down': 'Ausgefallen',
  'uptime.filter.up': 'Erreichbar',
  'uptime.filter.paused': 'Pausiert',
  'uptime.empty': 'Keine Monitore',
  'uptime.emptyText': 'Legen Sie einen Monitor für eine Website oder einen Dienst an.',
  'uptime.emptyTextAssigned': 'Ihrer Organisation sind noch keine Monitore zugewiesen.',
  'uptime.col.status': 'Status',
  'uptime.col.name': 'Monitor',
  'uptime.col.target': 'Ziel',
  'uptime.col.type': 'Art',
  'uptime.col.uptime24h': 'Uptime 24 h',
  'uptime.col.uptime30d': 'Uptime 30 Tage',
  'uptime.col.response': 'Antwortzeit',
  'uptime.col.cert': 'Zertifikat',
  'uptime.col.interval': 'Intervall',
  'uptime.col.instance': 'Instanz',
  'uptime.col.origin': 'Herkunft',
  'uptime.col.lastSync': 'Abgeglichen',
  'uptime.uptime24h': 'Uptime 24 h',
  'uptime.uptime30d': 'Uptime 30 Tage',
  'uptime.avg24h': 'Ø Antwortzeit 24 h',
  'uptime.avgShort': 'Ø {value}',
  'uptime.current': 'Aktuell {value}',
  'uptime.responseTime': 'Antwortzeit',
  'uptime.status.up': 'Erreichbar',
  'uptime.status.down': 'Ausgefallen',
  'uptime.status.pending': 'Ausstehend',
  'uptime.status.maintenance': 'Wartung',
  'uptime.status.paused': 'Pausiert',
  'uptime.status.unknown': 'Unbekannt',
  'uptime.kind.http': 'HTTP(S)',
  'uptime.kind.keyword': 'Keyword',
  'uptime.kind.ping': 'Ping',
  'uptime.kind.port': 'Port',
  'uptime.cert.day': '{n} Tag',
  'uptime.cert.days': '{n} Tage',
  'uptime.cert.expired': 'Abgelaufen',
  'uptime.cert.invalid': 'Ungültig',
  'uptime.interval.second': '{n} Sekunde',
  'uptime.interval.seconds': '{n} Sekunden',
  'uptime.interval.minute': '{n} Minute',
  'uptime.interval.minutes': '{n} Minuten',
  'uptime.interval.hour': '{n} Stunde',
  'uptime.interval.hours': '{n} Stunden',
  'uptime.missing.text':
    'Von Uptime Kuma nicht mehr gemeldet (zuerst {when}). Der Monitor wurde dort pausiert oder gelöscht, oder Uptime Kuma startet gerade neu.',
  'uptime.missing.paused':
    'Von Uptime Kuma nicht mehr gemeldet (zuerst {when}). Der Monitor war zuletzt pausiert.',

  // Detail page
  'uptime.notFound': 'Monitor nicht gefunden',
  'uptime.refreshError': 'Aktualisierung fehlgeschlagen',
  'uptime.since': 'seit {when}',
  'uptime.liveError': 'Live-Daten von Uptime Kuma nicht verfügbar, die gespeicherten Werte werden angezeigt',
  'uptime.managementError': 'Verwaltung zurzeit nicht verfügbar: Der Monitor kann nicht geändert werden',
  'uptime.range.recent': 'Letzte Prüfungen',
  'uptime.range.24h': '24 Stunden',
  'uptime.range.7d': '7 Tage',
  'uptime.range.30d': '30 Tage',
  'uptime.noHistory':
    'Für diesen Monitor gibt es keinen Verlauf. Ist die Uptime-Kuma-Instanz für die Verwaltung angemeldet, kommt das Diagramm von dort. Sonst zeigt es die letzten Prüfungen, aber nur für Monitore auf der Statusseite Ihrer Organisation.',
  'uptime.noHistoryRange': 'Für diesen Zeitraum ist kein Verlauf verfügbar.',
  'uptime.history.statusPage': 'Letzte {n} Prüfungen von der Statusseite',
  'uptime.history.kuma': 'Durchschnitt je {resolution}',
  'uptime.strip': 'Verfügbarkeit',
  'uptime.strip.up': 'Erreichbar',
  'uptime.strip.down': 'Ausfall',
  'uptime.strip.maintenance': 'Wartung',
  'uptime.strip.none': 'Keine Prüfung',
  'uptime.events.title': 'Statuswechsel',
  'uptime.events.text': 'Die letzten Wechsel mit der Meldung von Uptime Kuma.',
  'uptime.events.empty': 'Keine Statuswechsel',
  'uptime.events.time': 'Zeitpunkt',
  'uptime.events.message': 'Meldung',
  'uptime.config.title': 'Konfiguration',
  'uptime.config.text': 'So prüft Uptime Kuma diesen Monitor.',
  'uptime.config.type': 'Art',
  'uptime.config.target': 'Ziel',
  'uptime.config.interval': 'Intervall',
  'uptime.config.retries': 'Wiederholungen',
  'uptime.config.noRetries': 'Keine, ein Fehler gilt sofort als Ausfall',
  'uptime.config.retry': '{n} Wiederholung nach {interval}',
  'uptime.config.retriesValue': '{n} Wiederholungen im Abstand von {interval}',
  'uptime.config.timeout': 'Zeitlimit',
  'uptime.config.keyword': 'Keyword',
  'uptime.config.inverted': '(darf nicht vorkommen)',
  'uptime.config.method': 'Methode',
  'uptime.config.statusCodes': 'Akzeptierte Statuscodes',
  'uptime.config.ignoreTls': 'TLS-Fehler ignorieren',
  'uptime.config.upsideDown': 'Umgekehrter Modus',
  'uptime.config.yes': 'Ja',
  'uptime.config.no': 'Nein',

  // Dialogs
  'uptime.form.createTitle': 'Monitor erstellen',
  'uptime.form.createText':
    'Der Monitor zählt zu Ihrem Kontingent. Die erste Prüfung startet gleich nach dem Erstellen.',
  'uptime.form.editTitle': '{name} bearbeiten',
  'uptime.form.kind': 'Art der Prüfung',
  'uptime.form.kindHint.http': 'Ruft eine Adresse auf und erwartet einen erfolgreichen HTTP-Statuscode.',
  'uptime.form.kindHint.keyword': 'Ruft eine Adresse auf und sucht einen Text in der Antwort.',
  'uptime.form.kindHint.ping': 'Pingt einen Host an.',
  'uptime.form.kindHint.port': 'Prüft, ob ein TCP-Port eines Hosts Verbindungen annimmt.',
  'uptime.form.name': 'Name',
  'uptime.form.namePlaceholder': 'z. B. Website',
  'uptime.form.nameRequired': 'Geben Sie einen Namen ein.',
  'uptime.form.nameTooLong': 'Höchstens {n} Zeichen.',
  'uptime.form.nameInvalid': 'Der Name darf keine Steuerzeichen enthalten.',
  'uptime.form.url': 'Adresse',
  'uptime.form.urlInvalid': 'Geben Sie eine Adresse mit http:// oder https:// ein.',
  'uptime.form.urlCredentials': 'Die Adresse darf keinen Benutzernamen und kein Passwort enthalten.',
  'uptime.form.urlTooLong': 'Die Adresse ist zu lang.',
  'uptime.form.hostname': 'Host',
  'uptime.form.hostnameInvalid':
    'Geben Sie einen Hostnamen oder eine IP-Adresse ein, ohne http:// und ohne Port.',
  'uptime.form.port': 'Port',
  'uptime.form.portInvalid': 'Ein Port zwischen 1 und 65535.',
  'uptime.form.keyword': 'Keyword',
  'uptime.form.keywordHint': 'Der Text, der in der Antwort vorkommen muss.',
  'uptime.form.keywordRequired': 'Geben Sie den Text ein, nach dem gesucht wird.',
  'uptime.form.keywordTooLong': 'Das Keyword ist zu lang.',
  'uptime.form.invertKeyword': 'Darf nicht vorkommen (Ausfall, wenn der Text erscheint)',
  'uptime.form.interval': 'Prüfintervall',
  'uptime.form.intervalHint': 'Kürzestes Intervall in Ihrem Kontingent: {min}.',
  'uptime.form.advanced': 'Erweitert',
  'uptime.form.method': 'Methode',
  'uptime.form.statusCodes': 'Akzeptierte Statuscodes',
  'uptime.form.statusCodesHint': 'Mit Komma getrennt, z. B. 200-299, 301.',
  'uptime.form.statusCodesInvalid':
    'Statuscodes oder Bereiche wie 200 oder 200-299, mit Komma getrennt, höchstens 10.',
  'uptime.form.ignoreTls': 'TLS-Fehler ignorieren',
  'uptime.form.ignoreTlsHint': 'Ungültige oder abgelaufene Zertifikate gelten dann nicht als Ausfall.',
  'uptime.form.urlHint':
    'Nur öffentlich erreichbare Adressen. Weiterleitungen werden nicht verfolgt: Geben Sie die endgültige Adresse an (z. B. https://www.example.ch statt http://example.ch).',
  'uptime.form.publicOnly':
    'Nur öffentlich erreichbare Adressen. Interne Netze und private IP-Adressen werden abgelehnt.',
  'uptime.form.configUnavailable':
    'Die Konfiguration kann zurzeit nicht aus Uptime Kuma gelesen werden. Sie können nur Name und Intervall ändern.',
  'uptime.toast.created': 'Monitor {name} erstellt. Die Prüfung startet, der Status ist in Kürze sichtbar.',
  'uptime.toast.updated': '{name} gespeichert',
  'uptime.toast.paused': '{name} pausiert',
  'uptime.toast.resumed': '{name} fortgesetzt. Der Status ist nach der nächsten Prüfung sichtbar.',
  'uptime.toast.deleted': '{name} gelöscht',
  'uptime.pause.action': 'Pausieren',
  'uptime.pause.title': '{name} pausieren?',
  'uptime.pause.text':
    'Uptime Kuma prüft den Monitor nicht mehr und meldet keine Ausfälle, bis Sie ihn fortsetzen.',
  'uptime.pause.confirm': 'Pausieren',
  'uptime.resume.action': 'Fortsetzen',
  'uptime.delete.title': '{name} löschen?',
  'uptime.delete.text':
    'Der Monitor wird in Uptime Kuma gelöscht, mit seinem ganzen Verlauf. Das lässt sich nicht rückgängig machen.',
  'uptime.delete.textMissing':
    'Uptime Kuma meldet diesen Monitor nicht mehr. Er wird nur aus der Console entfernt.',
  'uptime.error.monitor_limit': 'Das Monitoring-Kontingent ist ausgeschöpft.',
  'uptime.error.no_allowance': 'Diese Organisation hat kein Monitoring-Kontingent auf dieser Instanz.',
  'uptime.error.read_only_monitor':
    'Dieser Monitor wird von weblion in Uptime Kuma verwaltet und kann hier nicht geändert werden.',
  'uptime.error.totp_required': 'Uptime Kuma verlangt den Zwei-Faktor-Code dieses Kontos.',
  'uptime.error.totp_invalid': 'Der Zwei-Faktor-Code wurde nicht akzeptiert.',

  // Related monitors (server and domain pages)
  'uptime.related.title': 'Monitoring',
  'uptime.related.server': 'Monitore Ihrer Organisation, die eine Adresse dieses Servers prüfen.',
  'uptime.related.domain': 'Monitore Ihrer Organisation, die diese Domain oder eine Subdomain prüfen.',
  'uptime.related.all': 'Alle Monitore',

  // Admin area
  'uptime.admin.subtitle':
    'Monitore aller Uptime-Kuma-Instanzen: für die Verwaltung anmelden und Monitore Kunden zuweisen.',
  'uptime.admin.sync': 'Jetzt synchronisieren',
  'uptime.admin.syncWhich': 'Instanz synchronisieren',
  'uptime.admin.syncManagementError': 'Verwaltung nicht verfügbar: {error}',
  'uptime.admin.instances': 'Instanzen',
  'uptime.admin.instancesText':
    'Version, Monitore und die Anmeldung für die Verwaltung, die Kunden für eigene Monitore brauchen.',
  'uptime.admin.noInstances': 'Keine Uptime-Kuma-Instanz verbunden',
  'uptime.admin.noInstancesText':
    'Verbinden Sie eine Instanz unter Provider mit ihrer Adresse und einem API-Schlüssel.',
  'uptime.admin.instanceCounts': '{monitors} Monitore, davon {assigned} zugewiesen',
  'uptime.admin.needs21': 'Uptime-Werte und Durchschnitte brauchen Uptime Kuma 2.1 oder neuer.',
  'uptime.admin.management.off': 'Nur lesen',
  'uptime.admin.management.ok': 'Für die Verwaltung angemeldet',
  'uptime.admin.management.error': 'Verwaltung gestört',
  'uptime.admin.envSession':
    'Diese Verbindung kommt aus den Umgebungsvariablen. Setzen Sie dort UPTIMEKUMA_SESSION_TOKEN; den Token erzeugt pnpm --filter @weblion/api kuma:token.',
  'uptime.admin.demoManagement': 'Demo-Instanz: Die Verwaltung ist immer angemeldet.',
  'uptime.admin.signIn': 'Für die Verwaltung anmelden',
  'uptime.admin.signInAgain': 'Neu anmelden',
  'uptime.admin.signOut': 'Abmelden',
  'uptime.admin.signInTitle': '{name} für die Verwaltung anmelden',
  'uptime.admin.signInText':
    'Melden Sie sich mit dem Konto von Uptime Kuma an. Danach können Kunden mit Kontingent eigene Monitore anlegen und ändern.',
  'uptime.admin.signInTokenOnly':
    'weblion.one speichert nur das Sitzungstoken, das Uptime Kuma ausgibt (verschlüsselt), nie Passwort oder Zwei-Faktor-Code. Das Token gilt, bis das Passwort in Uptime Kuma geändert wird: So entziehen Sie den Zugriff.',
  'uptime.admin.username': 'Benutzername',
  'uptime.admin.password': 'Passwort',
  'uptime.admin.totp': 'Zwei-Faktor-Code',
  'uptime.admin.totpHint': 'Der sechsstellige Code aus der Authenticator-App des Kontos.',
  'uptime.admin.totpInvalid': 'Sechs Ziffern.',
  'uptime.admin.signedIn': '{name} für die Verwaltung angemeldet',
  'uptime.admin.signedInVersion': '{name} für die Verwaltung angemeldet (Uptime Kuma {version})',
  'uptime.admin.signOutTitle': '{name} abmelden?',
  'uptime.admin.signOutText':
    'Das gespeicherte Sitzungstoken wird gelöscht. Kunden können danach keine Monitore mehr anlegen oder ändern, Status und Uptime bleiben sichtbar. Das Token selbst gilt in Uptime Kuma weiter, bis das Passwort geändert wird.',
  'uptime.admin.signedOut': '{name} abgemeldet',
  'uptime.admin.bulkAssign': 'Alle nicht zugewiesenen zuweisen',
  'uptime.admin.bulkTitle': 'Monitore von {name} zuweisen',
  'uptime.admin.bulkText':
    'Die {n} nicht zugewiesenen Monitore dieser Instanz gehen an den gewählten Kunden, etwa bei einer Instanz nur für einen Kunden.',
  'uptime.admin.bulkAssigned': '{n} Monitore {org} zugewiesen',
  'uptime.admin.inventory': 'Monitore',
  'uptime.admin.inventoryText': 'Alle Monitore der Instanzen mit ihrer Zuweisung.',
  'uptime.admin.search': 'Name oder Ziel suchen…',
  'uptime.admin.filterInstance': 'Nach Instanz filtern',
  'uptime.admin.allInstances': 'Alle Instanzen',
  'uptime.admin.filterCustomer': 'Nach Kunde filtern',
  'uptime.admin.allCustomers': 'Alle Kunden',
  'uptime.admin.filterOrigin': 'Nach Herkunft filtern',
  'uptime.admin.allOrigins': 'Alle Herkünfte',
  'uptime.origin.kuma': 'Uptime Kuma',
  'uptime.origin.console': 'Console',
  'uptime.admin.empty': 'Keine Monitore gefunden',
  'uptime.admin.emptyText': 'Passen Sie den Filter an oder synchronisieren Sie die Instanzen.',
  'uptime.admin.noModule': 'ohne Monitoring',
  'uptime.admin.moduleOffAssign':
    'Ohne das Modul "{module}" sieht der Kunde den Monitor nicht, auch wenn er ihm zugewiesen ist.',
  'uptime.admin.assignText': 'Der Kunde sieht den Monitor danach unter Monitoring. Instanz: {instance}.',
  'uptime.admin.consoleNoAllowance':
    'Dieser Monitor wurde in der Console angelegt und zählt zum Kontingent seiner Organisation. Der gewählte Kunde hat kein Monitoring-Kontingent auf dieser Instanz.',
  'uptime.admin.kumaReadOnly': 'In Uptime Kuma angelegte Monitore bleiben für Kunden schreibgeschützt.',
  'uptime.admin.unassignText':
    '{org} sieht den Monitor danach nicht mehr. In Uptime Kuma ändert sich nichts.',
  'uptime.admin.cardText': 'Kontingent für eigene Monitore und verknüpfte Statusseiten.',
  'uptime.admin.showMonitors': 'Monitore anzeigen',
  'uptime.admin.noAllowance': 'Kein Monitoring-Kontingent',
  'uptime.admin.noAllowanceText': 'Ohne Kontingent sieht der Kunde nur die Monitore, die Sie ihm zuweisen.',
  'uptime.allowance.setUp': 'Kontingent einrichten',
  'uptime.allowance.setUpTitle': 'Monitoring-Kontingent für {name} einrichten',
  'uptime.allowance.editTitle': 'Monitoring-Kontingent von {name} bearbeiten',
  'uptime.allowance.dialogText':
    'Wie viele eigene Monitore die Organisation auf welcher Instanz anlegen darf und wie oft diese höchstens prüfen.',
  'uptime.allowance.instance': 'Instanz',
  'uptime.allowance.instanceHint': 'Nur Instanzen, die für die Verwaltung angemeldet sind.',
  'uptime.allowance.instanceLocked':
    'Die Instanz lässt sich nicht ändern, solange es in der Console angelegte Monitore darauf gibt.',
  'uptime.allowance.instanceLockedCustomers':
    'Die Instanz lässt sich nicht ändern, solange Kunden des Resellers ein Kontingent darauf haben.',
  'uptime.allowance.maxMonitors': 'Höchstens Monitore',
  'uptime.allowance.maxInvalid': 'Eine ganze Zahl zwischen 1 und 10000.',
  'uptime.allowance.maxBelowCommitted': 'Mindestens {n}: So viele Monitore gibt es schon oder sind vergeben.',
  'uptime.allowance.maxResellerHint':
    'Umfasst die eigenen Monitore und alles, was der Reseller seinen Kunden gibt.',
  'uptime.allowance.minIntervalHint': 'Kürzere Intervalle kann die Organisation nicht wählen.',
  'uptime.allowance.noManagedInstance':
    'Keine Instanz ist für die Verwaltung angemeldet. Melden Sie zuerst eine Instanz unter Admin > Monitoring an.',
  'uptime.allowance.notManaged':
    'Diese Instanz ist zurzeit nicht für die Verwaltung angemeldet. Melden Sie sie unter Admin > Monitoring an.',
  'uptime.allowance.resellerHint':
    'Der Reseller gibt seinen Kunden Teile dieses Kontingents auf derselben Instanz.',
  'uptime.allowance.remove': 'Kontingent entfernen',
  'uptime.allowance.removeTitle': 'Monitoring-Kontingent von {name} entfernen?',
  'uptime.allowance.removeText':
    'Die Organisation kann danach keine eigenen Monitore mehr anlegen. Zugewiesene Monitore bleiben.',
  'uptime.allowance.removeBlocked':
    'Die Organisation hat {n} in der Console angelegte Monitore. Löschen Sie diese oder weisen Sie sie zuerst einer anderen Organisation zu.',
  'uptime.allowance.removeBlockedCustomers':
    'Der Reseller hat {n} Kunden ein Monitoring-Kontingent gegeben. Entfernen Sie diese zuerst.',
  'uptime.allowance.removed': 'Monitoring-Kontingent entfernt',
  'uptime.allowance.saved': 'Monitoring-Kontingent gespeichert',
  'uptime.allowance.committedHint': '{n} Monitore sind schon angelegt.',
  'uptime.statusPage.text':
    'Öffentliche Statusseiten aus Uptime Kuma, die der Kunde in der Console verlinkt sieht.',
  'uptime.statusPage.add': 'Statusseite verknüpfen',
  'uptime.statusPage.addTitle': 'Statusseite für {name} verknüpfen',
  'uptime.statusPage.dialogText':
    'Legen Sie die Statusseite zuerst in Uptime Kuma an. Hier verknüpfen Sie sie mit dem Kunden, eine pro Instanz.',
  'uptime.statusPage.slug': 'Slug der Statusseite',
  'uptime.statusPage.slugHint': 'Der letzte Teil der Adresse, z. B. muster-ag aus …/status/muster-ag.',
  'uptime.statusPage.slugInvalid': 'Kleinbuchstaben, Ziffern und Bindestriche, z. B. muster-ag.',
  'uptime.statusPage.notFound': 'Uptime Kuma hat keine Statusseite "{slug}".',
  'uptime.statusPage.url': 'Öffentliche Adresse',
  'uptime.statusPage.urlHint':
    'Optional, nur wenn die Statusseite eine eigene Domain hat. Sonst gilt die Adresse der Instanz.',
  'uptime.statusPage.urlInvalid': 'Eine Adresse mit http:// oder https://.',
  'uptime.statusPage.replaces': 'Die Verknüpfung mit "{slug}" auf dieser Instanz wird ersetzt.',
  'uptime.statusPage.none': 'Keine Statusseite verknüpft.',
  'uptime.statusPage.remove': 'Verknüpfung lösen',
  'uptime.statusPage.removeTitle': 'Statusseite "{slug}" lösen?',
  'uptime.statusPage.removeText':
    '{org} sieht den Link danach nicht mehr. In Uptime Kuma bleibt die Statusseite bestehen.',
  'uptime.statusPage.removed': 'Statusseite "{slug}" gelöst',
  'uptime.statusPage.saved': 'Statusseite "{slug}" verknüpft',

  // Reseller
  'uptime.reseller.cardText': 'Ein Teil Ihres Monitoring-Kontingents für eigene Monitore dieses Kunden.',
  'uptime.reseller.none': 'Kein Monitoring-Kontingent',
  'uptime.reseller.noneText':
    'Geben Sie dem Kunden einen Teil Ihres Kontingents, damit er eigene Monitore anlegen kann.',
  'uptime.reseller.pool': 'Ihr Kontingent: {free} von {max} Monitoren frei',
  'uptime.reseller.noPool': 'Ihre Organisation hat kein Monitoring-Kontingent. Wenden Sie sich an weblion.',
  'uptime.reseller.removeBlocked': 'Der Kunde hat eigene Monitore. Er muss sie zuerst löschen.',
  'uptime.reseller.removeText':
    'Der Kunde kann danach keine eigenen Monitore mehr anlegen. Die Monitore gehen an Ihr Kontingent zurück.',
  'uptime.reseller.dialogText':
    'Die Monitore laufen auf derselben Instanz wie Ihre ({instance}) und zählen zu Ihrem Kontingent.',
  'uptime.reseller.left': 'Für diesen Kunden verfügbar: {n}',
  'uptime.reseller.maxTooHigh': 'Höchstens {n}: Mehr ist in Ihrem Kontingent nicht frei.',
  'uptime.reseller.intervalHint': 'Nicht kürzer als Ihr eigenes Minimum ({min}).',
  'uptime.reseller.enablesModule':
    'Mit dem Speichern wird das Modul Monitoring für den Kunden freigeschaltet.',

  // Provider form
  'providers.uptimekuma.help':
    'Uptime Kuma 2.x. Erstellen Sie in Uptime Kuma unter Einstellungen > API-Schlüssel einen Schlüssel ohne Ablaufdatum nur für weblion.one. Achtung: Mit dem ersten API-Schlüssel akzeptiert /metrics keine Anmeldung mit Benutzername und Passwort mehr.',
  'providers.uptimekuma.url': 'Adresse der Uptime-Kuma-Instanz',
  'providers.uptimekuma.urlHint': 'https://… ohne Pfad, z. B. https://status.weblion.one.',
  'providers.uptimekuma.urlInvalid':
    'Eine http- oder https-Adresse ohne Pfad, z. B. https://status.weblion.one.',
  'providers.uptimekuma.httpWarning':
    'Ohne https geht der API-Schlüssel unverschlüsselt über das Netz. Nur in einem privaten Netz verwenden.',
  'providers.uptimekuma.apiKey': 'API-Schlüssel',
  'providers.uptimekuma.apiKeyHint':
    'Beginnt mit uk, z. B. uk3_… Wird verschlüsselt gespeichert und nie mehr angezeigt.',
  'providers.uptimekuma.apiKeyInvalid':
    'Ein API-Schlüssel von Uptime Kuma beginnt mit uk, seiner Nummer und einem Unterstrich, z. B. uk3_…',
  'providers.uptimekuma.management': 'Verwaltung',
  'providers.uptimekuma.managementHint':
    'Damit Kunden eigene Monitore anlegen können, melden Sie die Instanz unter Admin > Monitoring für die Verwaltung an.',
  'providers.uptimekuma.managementOn': 'Angemeldet',
  'providers.uptimekuma.managementOff': 'Nur lesen',
  'providers.uptimekuma.monitorsText':
    'Diese Verbindung liefert Monitore. Weisen Sie sie im Admin-Bereich unter Monitoring Kunden zu.',
  'providers.uptimekuma.toMonitors': 'Zu den Monitoren',

  // Reseller resources, delete blockers and dashboard
  'admin.resources.title.monitor': 'Monitore',
  'admin.resources.empty.monitor': 'Diesem Kunden sind keine Monitore zugewiesen.',
  'admin.resources.assign.monitor': 'Monitor zuweisen',
  'admin.resources.monitors': 'Monitore',
  'admin.blocker.monitors': 'Monitore: {n}',
  'admin.blocker.monitorAllowances': 'Monitoring-Kontingent',

  // API explorer
  'explorer.uptimekumaPath':
    'HTTP-Pfade relativ zur Adresse der Instanz (/metrics, /api/status-page/<slug>, /api/status-page/heartbeat/<slug>, /api/badge/<id>/<art>, /api/entry-page) oder socket/<Ereignis> der Verwaltung, z. B. socket/getMonitor?args=[1]. Geheimnisse der Monitore werden in Antworten ausgeblendet.',
  'explorer.uptimekumaBodyHint':
    'Schreibende Socket-Ereignisse mit POST und den Argumenten als Liste, z. B. { "args": [12] } für socket/pauseMonitor. Dafür muss die Instanz für die Verwaltung angemeldet sein.',
} as const;
