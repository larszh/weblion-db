/**
 * Streaming (Modul "media", Jellyfin): Navigation, Provider-Formular, Reseller-Übersicht,
 * Lösch-Blocker, Dashboard und API Explorer. Die Seiten der Organisation, des Admin-Bereichs und
 * des Resellers ergänzen ihre Keys mit dem Präfix "media.".
 */
export const mediaDe = {
  'nav.media': 'Streaming',
  'nav.admin.media': 'Streaming',
  'perm.group.media': 'Streaming',

  // Customer page
  'media.subtitle':
    'Zugänge zum Jellyfin-Mediaserver für Filme, Serien und Musik, im Rahmen Ihres Kontingents.',
  'media.open': 'Jellyfin öffnen',
  'media.create': 'Zugang erstellen',
  'media.noAccess': 'Sie haben keinen Zugriff auf die Streaming-Zugänge dieser Organisation.',
  'media.none.title': 'Noch kein Streaming gebucht',
  'media.none.text':
    'Streaming (Jellyfin) buchen Sie über weblion.one. Sobald ein Kontingent für Ihre Organisation eingerichtet ist, erstellen Sie hier Zugänge.',
  'media.none.textReseller':
    'Streaming (Jellyfin) buchen Sie über {reseller}. Sobald ein Kontingent für Ihre Organisation eingerichtet ist, erstellen Sie hier Zugänge.',
  'media.noAllowanceAccounts':
    'Für diese Organisation ist kein Streaming-Kontingent mehr eingerichtet. Bestehende Zugänge funktionieren weiter, neue lassen sich nicht erstellen.',
  'media.limit.accounts':
    'Alle Zugänge Ihres Kontingents sind vergeben. Löschen Sie einen Zugang oder erweitern Sie Ihr Kontingent, um weitere zu erstellen.',
  'media.allowance': 'Streaming-Kontingent',
  'media.allowanceText':
    'Was jeder Zugang Ihrer Organisation darf. Die Console wendet es auf alle Zugänge an.',
  'media.figure.accounts': 'Zugänge',
  'media.figure.accountsOf': '{n} von {max}',
  'media.figure.streams': 'Streams (Geräte)',
  'media.figure.streamsValue': '{n} pro Zugang',
  'media.figure.downloads': 'Downloads',
  'media.figure.downloadsOn': 'Erlaubt',
  'media.figure.downloadsOff': 'Nicht erlaubt',
  'media.figure.bitrate': 'Qualität unterwegs',
  'media.figure.bitrateUpTo': 'bis {rate}',
  'media.figure.libraries': 'Bibliotheken',
  'media.instance': 'Instanz',
  'media.library.missing': 'Diese Bibliothek gibt es auf der Instanz nicht mehr.',
  'media.library.missingShort': 'Entfernt',

  // Login card
  'media.login.title': 'So melden Sie sich an',
  'media.login.text': 'Mit diesen Angaben melden sich alle Zugänge in den Jellyfin-Apps an.',
  'media.login.address': 'Server-Adresse',
  'media.login.copyAddress': 'Server-Adresse kopieren',
  'media.login.serverName': 'Die Apps zeigen den Server als "{name}".',
  'media.login.step1':
    'Installieren Sie die Jellyfin-App auf Ihrem Gerät oder öffnen Sie die Server-Adresse im Browser.',
  'media.login.step2': 'Geben Sie in der App die Server-Adresse ein.',
  'media.login.step3': 'Melden Sie sich mit Login-Name und Passwort an.',
  'media.login.codeHint': 'Die Login-Namen Ihrer Organisation enden auf',
  'media.login.tv': 'Auf dem Fernseher',
  'media.login.quickConnect':
    'Wählen Sie in der App Quick Connect, öffnen Sie Jellyfin im Browser oder auf dem Handy, wo Sie angemeldet sind, und geben Sie unter Einstellungen > Quick Connect den Code vom Fernseher ein.',
  'media.login.apps':
    'Apps gibt es für Browser, Windows, macOS, Linux (Jellyfin Media Player), Android, Android TV, Fire TV, iPhone und iPad, Apple TV (Swiftfin), LG webOS, Roku und Kodi.',
  'media.login.allApps': 'Alle Apps',
  'media.login.privacy':
    'Andere Zugänge auf demselben Server können Login-Namen sehen. Verwenden Sie Vornamen oder Räume, keine vollständigen Namen.',

  // Accounts
  'media.accounts': 'Zugänge',
  'media.accountsText':
    'Jeder Zugang meldet sich mit seinem Login-Namen an und bekommt den Zugriff Ihres Kontingents.',
  'media.lastSync': 'Zuletzt abgeglichen {when}',
  'media.search': 'Login-Name suchen…',
  'media.empty': 'Noch keine Zugänge',
  'media.emptyText': 'Erstellen Sie einen Zugang für jede Person oder jedes Gerät, das Jellyfin nutzen soll.',
  'media.col.login': 'Login-Name',
  'media.col.status': 'Status',
  'media.col.lastActive': 'Zuletzt aktiv',
  'media.col.created': 'Erstellt',
  'media.col.issues': 'Hinweise',
  'media.copyLogin': 'Login-Name kopieren',
  'media.activity.never': 'Noch nie',
  'media.activity.today': 'Heute',
  'media.activity.yesterday': 'Gestern',
  'media.status.active': 'Aktiv',
  'media.status.disabled': 'Deaktiviert',
  'media.status.locked': 'Gesperrt',
  'media.status.lockedHint':
    'Jellyfin hat den Zugang nach zu vielen fehlgeschlagenen Anmeldungen gesperrt. Aktivieren hebt die Sperre auf.',
  'media.status.noPassword': 'Ohne Passwort',
  'media.status.noPasswordHint':
    'Wer den Login-Namen kennt, kann sich ohne Passwort anmelden. Setzen Sie ein Passwort.',
  'media.status.missing': 'In Jellyfin nicht gefunden',
  'media.status.missingHint': 'Der Zugang wurde in Jellyfin gelöscht. Entfernen Sie ihn auch hier.',
  'media.privacyNote':
    'Was angeschaut wird, sieht die Console nicht. Sie zeigt nur, an welchem Tag ein Zugang zuletzt aktiv war.',

  // Create
  'media.createTitle': 'Streaming-Zugang erstellen',
  'media.createText': 'Ein Zugang für eine Person oder ein Gerät, mit dem Zugriff Ihres Kontingents.',
  'media.name': 'Name',
  'media.name.placeholder': 'anna',
  'media.name.preview': 'Login-Name:',
  'media.name.hint':
    'Verwenden Sie Vornamen oder Räume wie anna oder wohnzimmer. Andere Zugänge auf demselben Server können Login-Namen sehen.',
  'media.name.invalid':
    'Nur Kleinbuchstaben, Ziffern und einzelne Bindestriche, am Anfang und Ende ein Buchstabe oder eine Ziffer (höchstens 20 Zeichen).',
  'media.name.taken': 'Diesen Zugang gibt es bereits.',
  'media.created': 'Zugang {username} erstellt',
  'media.createdTitle': 'Zugang erstellt',

  // Passwords
  'media.password.label': 'Passwort',
  'media.password.generate': 'Passwort erzeugen (empfohlen)',
  'media.password.generateText':
    '{n} Kleinbuchstaben und Ziffern, gut auf einer Fernbedienung einzugeben. Wird einmal angezeigt.',
  'media.password.choose': 'Eigenes Passwort',
  'media.password.chooseText':
    'Mindestens {min} Zeichen. Die Console speichert es nicht und zeigt es nicht an.',
  'media.password.input': 'Neues Passwort',
  'media.password.show': 'Passwort anzeigen',
  'media.password.hide': 'Passwort ausblenden',
  'media.password.issue.length': 'Mindestens {min} Zeichen.',
  'media.password.issue.tooLong': 'Höchstens {max} Zeichen.',
  'media.password.issue.characters': 'Keine Steuerzeichen und keine Leerzeichen am Anfang oder Ende.',
  'media.password.copy': 'Passwort kopieren (ohne Leerzeichen)',
  'media.password.groups': 'In Vierergruppen zum Vorlesen. Die Leerzeichen gehören nicht zum Passwort.',
  'media.password.once':
    'Das Passwort wird nur jetzt angezeigt. Die Console speichert es nicht. Geben Sie es der Person weiter, die den Zugang nutzt.',
  'media.password.newTitle': 'Neues Passwort',
  'media.password.action': 'Passwort neu setzen',
  'media.password.title': 'Neues Passwort für {username}',
  'media.password.text':
    'Alle Geräte, die mit diesem Zugang angemeldet sind, werden sofort abgemeldet. Das bisherige Passwort funktioniert danach nicht mehr.',
  'media.password.set': 'Passwort setzen',
  'media.password.setToast': 'Neues Passwort für {username} gesetzt',

  // Enable, disable, delete
  'media.disable': 'Deaktivieren',
  'media.enable': 'Aktivieren',
  'media.disableTitle': '{username} deaktivieren?',
  'media.disableText':
    'Alle Geräte werden sofort abgemeldet und der Zugang kann sich nicht mehr anmelden. Verlauf und Favoriten bleiben erhalten.',
  'media.enableTitle': '{username} aktivieren?',
  'media.enableText':
    'Der Zugang kann sich wieder anmelden. Eine Sperre nach fehlgeschlagenen Anmeldungen wird dabei aufgehoben.',
  'media.enableLockedHint': 'Hebt die Sperre auf',
  'media.enabledToast': '{username} aktiviert',
  'media.disabledToast': '{username} deaktiviert',
  'media.deleteTitle': '{username} löschen?',
  'media.deleteConfirm': 'Endgültig löschen',
  'media.deleteWarningTitle': 'Verlauf und Favoriten werden gelöscht',
  'media.deleteWarning':
    'Der Zugang wird in Jellyfin gelöscht, mit Wiedergabeverlauf, Favoriten und Playlists. Alle Geräte werden abgemeldet. Das lässt sich nicht rückgängig machen.',
  'media.deleteMissing': 'Den Zugang gibt es in Jellyfin nicht mehr. Er wird nur aus der Console entfernt.',
  'media.deletedToast': '{username} gelöscht',

  // Issues (admin)
  'media.issue.policy': 'Richtlinie weicht ab',
  'media.issue.policy.text':
    'Die Rechte in Jellyfin weichen vom Kontingent ab. Die Synchronisierung passt sie an, oder Sie wenden die Richtlinie jetzt an.',
  'media.issue.administrator': 'Administrator',
  'media.issue.administrator.text':
    'Der Zugang ist in Jellyfin Administrator. Die Synchronisierung stuft ihn zurück, ausser es ist der letzte Administrator.',
  'media.issue.blocked_folders': 'Gesperrte Bibliotheken',
  'media.issue.blocked_folders.text':
    'Der Benutzer hat alte gesperrte Bibliotheken. Jellyfin ignoriert dann die Bibliotheken des Kontingents, und die Console kann das nicht ändern.',
  'media.issue.no_password': 'Ohne Passwort',
  'media.issue.no_password.text': 'Wer den Login-Namen kennt, meldet sich ohne Passwort an.',
  'media.issue.locked_out': 'Gesperrt',
  'media.issue.locked_out.text':
    'Nach fehlgeschlagenen Anmeldungen von Jellyfin gesperrt. Aktivieren hebt die Sperre auf.',
  'media.issue.no_allowance': 'Kein Kontingent',
  'media.issue.no_allowance.text':
    'Die Organisation hat kein Kontingent auf dieser Instanz. Die Rechte des Zugangs werden nicht verwaltet.',

  // Allowances (admin and reseller)
  'media.allowance.setUp': 'Einrichten',
  'media.allowance.setUpTitle': 'Streaming für {name} einrichten',
  'media.allowance.editTitle': 'Streaming von {name}',
  'media.allowance.dialogText':
    'Anzahl Zugänge und was jeder Zugang darf. Die Console wendet den Zugriff auf alle Zugänge der Organisation an.',
  'media.allowance.instanceHint': 'Alle Zugänge der Organisation liegen auf dieser Jellyfin-Instanz.',
  'media.allowance.instanceLocked':
    'Die Instanz lässt sich nur ändern, solange die Organisation keine Zugänge und keine Kundenkontingente darauf hat.',
  'media.allowance.code': 'Kontingent-Code',
  'media.allowance.codeGenerated': 'wird erzeugt',
  'media.allowance.codeHint':
    '3 bis 12 Kleinbuchstaben, Login-Namen enden dann auf -code. Auf einem gemeinsamen Server sehen andere Zugänge die Login-Namen: Verwenden Sie dort keinen Kundennamen.',
  'media.allowance.codeLocked': 'Der Code lässt sich nur ändern, solange die Organisation keine Zugänge hat.',
  'media.allowance.codeInvalid': '3 bis 12 Kleinbuchstaben von a bis z.',
  'media.allowance.maxAccounts': 'Zugänge höchstens',
  'media.allowance.maxAccountsHint': 'Wie viele Zugänge die Organisation erstellen kann.',
  'media.allowance.accountsUsed': 'Bereits vergeben: {n}',
  'media.allowance.maxInvalid': 'Geben Sie eine ganze Zahl ab 1 ein.',
  'media.allowance.maxBelowAccounts': 'Mindestens {n}, so viele Zugänge sind bereits vergeben.',
  'media.allowance.maxTooHigh': 'Höchstens {n}.',
  'media.allowance.streams': 'Gleichzeitige Streams (Geräte)',
  'media.allowance.streamsHint':
    'Gezählt werden angemeldete, aktive Geräte. Jellyfin prüft die Zahl, wenn sich ein Gerät anmeldet.',
  'media.allowance.streamsInvalid': 'Eine ganze Zahl von 1 bis {max}.',
  'media.allowance.libraries': 'Bibliotheken',
  'media.allowance.librariesEmpty':
    'Die Instanz hat keine Bibliotheken, die sich freigeben lassen. Neue Bibliotheken erscheinen nach ihrem ersten Scan.',
  'media.allowance.librariesNone': 'Wählen Sie mindestens eine Bibliothek.',
  'media.allowance.librariesGone': 'Nicht mehr auf der Instanz, werden beim Speichern entfernt: {names}',
  'media.allowance.outsideParent': 'Nicht beim Reseller',
  'media.allowance.downloads': 'Downloads erlauben',
  'media.allowance.downloadsHint':
    'Offline-Kopien in den Apps. Das ist kein Kopierschutz: Gestreamte Inhalte lassen sich trotzdem speichern.',
  'media.allowance.bitrate': 'Qualität unterwegs',
  'media.allowance.bitrateHint':
    'Höchste Bitrate für Geräte ausserhalb des Netzes des Servers. Ohne eigenen Wert gilt die Einstellung des Servers.',
  'media.allowance.bitrateCustom': 'Eigener Wert',
  'media.allowance.bitrateInvalid': 'Eine ganze Zahl von 1 bis {max} Mbit/s.',
  'media.allowance.serverBitrate': 'Einstellung des Servers',
  'media.allowance.toCustomers': 'Davon an Kunden vergeben: {n}',
  'media.allowance.enableModuleHint': '{org} sieht Streaming nur mit aktivem Modul in der Console.',
  'media.allowance.moduleOff': 'Ohne das Modul "{module}" sieht die Organisation das Kontingent nicht.',
  'media.allowance.resellerHint':
    'Ein Reseller verteilt dieses Kontingent auf eigene Zugänge und auf seine Kunden. Seine Kunden bekommen höchstens diesen Zugriff.',
  'media.allowance.parentNone':
    '{reseller} hat selbst kein Streaming-Kontingent. Sie können trotzdem eines einrichten.',
  'media.allowance.beyondParent':
    'Geht über das Kontingent von {reseller} hinaus ({list}). Sie können trotzdem speichern.',
  'media.allowance.policyHint':
    'Nach dem Speichern wendet die Console den Zugriff auf alle Zugänge der Organisation an.',
  'media.allowance.saved': 'Streaming-Kontingent gespeichert',
  'media.allowance.applied': 'Zugriff auf alle Zugänge angewendet ({n})',
  'media.allowance.policyFailed':
    'Bei diesen Zugängen liess sich die Richtlinie nicht anwenden. Die Synchronisierung versucht es erneut.',
  'media.allowance.remove': 'Kontingent entfernen',
  'media.allowance.removeTitle': 'Streaming von {name} entfernen?',
  'media.allowance.removeText':
    'Die Organisation kann danach keine Streaming-Zugänge mehr erstellen. Das Modul bleibt aktiv, bis Sie es abschalten.',
  'media.allowance.removeBlocked':
    'Nur ohne Zugänge möglich. Löschen Sie die Zugänge oder weisen Sie sie einer anderen Organisation zu.',
  'media.allowance.removeBlockedCustomers':
    'Nur ohne Kundenkontingente möglich. Entfernen Sie zuerst die Kontingente der {n} Kunden.',
  'media.allowance.removed': 'Streaming-Kontingent entfernt',
  'media.conflict.libraries': 'Bibliotheken',
  'media.conflict.streams': 'Streams',
  'media.conflict.downloads': 'Downloads',
  'media.conflict.bitrate': 'Qualität unterwegs',
  'media.conflict.accounts': 'Zugänge',

  // Admin page
  'media.admin.subtitle':
    'Jellyfin-Instanzen, alle Streaming-Zugänge und die Übernahme von Benutzern, die direkt in Jellyfin angelegt wurden.',
  'media.admin.addProvider': 'Instanz verbinden',
  'media.admin.hint':
    'Streaming-Kontingente richten Sie beim Kunden ein, die Zugänge erstellen die Kunden selbst.',
  'media.admin.instances': 'Instanzen',
  'media.admin.instancesText':
    'Gemeinsam: mehrere Organisationen haben ein Kontingent darauf, dediziert: genau eine. Aktivität nur als Anzahl.',
  'media.admin.noInstances': 'Keine Jellyfin-Instanz verbunden',
  'media.admin.noInstancesText':
    'Verbinden Sie eine Instanz unter Provider, um Streaming-Zugänge anzubieten.',
  'media.admin.col.usage': 'Nutzung',
  'media.admin.col.accounts': 'Zugänge',
  'media.admin.col.active': 'Aktiv jetzt',
  'media.admin.col.quickConnect': 'Quick Connect',
  'media.admin.usage.dedicated': 'Dediziert',
  'media.admin.usage.shared': 'Gemeinsam',
  'media.admin.usage.unused': 'Ungenutzt',
  'media.admin.orgCount': 'Organisationen mit Kontingent: {n}',
  'media.admin.withIssues': '{n} mit Hinweisen',
  'media.admin.users': 'Benutzer: {n}, Bibliotheken: {libraries}',
  'media.admin.activeNow': '{sessions} aktiv, {playing} spielen',
  'media.admin.quickConnect.on': 'An',
  'media.admin.quickConnect.off': 'Aus',
  'media.admin.quickConnect.unknown': 'Unbekannt',
  'media.admin.sync': 'Synchronisieren',
  'media.admin.syncRepairFailed': 'Richtlinien nicht angewendet: {n}',
  'media.admin.toProvider': 'Zur Provider-Verbindung',
  'media.admin.accounts': 'Zugänge',
  'media.admin.accountsText':
    'Alle Streaming-Zugänge, die die Console verwaltet, mit den Hinweisen der letzten Synchronisierung.',
  'media.admin.search': 'Login-Name suchen…',
  'media.admin.filterCustomer': 'Nach Kunde filtern',
  'media.admin.allCustomers': 'Alle Kunden',
  'media.admin.filterInstance': 'Nach Instanz filtern',
  'media.admin.allInstances': 'Alle Instanzen',
  'media.admin.onlyIssues': 'Nur mit Hinweisen',
  'media.admin.empty': 'Keine Streaming-Zugänge',
  'media.admin.emptyText':
    'Zugänge erscheinen hier, sobald Kunden sie erstellen oder Sie Benutzer einer Instanz übernehmen.',
  'media.admin.limited':
    'Es werden höchstens 1000 Zugänge angezeigt. Grenzen Sie die Liste mit der Suche oder den Filtern ein.',
  'media.admin.assign': 'Zuweisen…',
  'media.admin.reassign': 'Anders zuweisen…',
  'media.admin.repair': 'Richtlinie anwenden',
  'media.admin.repairHint': 'Schreibt den Zugriff des Kontingents jetzt nach Jellyfin',
  'media.admin.repaired': 'Richtlinie von {username} angewendet',
  'media.admin.assignText':
    'Der Zugang liegt auf {instance}. Der Kunde verwaltet ihn danach in seiner Console.',
  'media.admin.assignHint':
    'Der Kunde braucht ein Streaming-Kontingent auf dieser Instanz. Dessen Zugriff wird auf den Zugang angewendet. Mehr Zugänge als im Kontingent sind für Sie erlaubt.',
  'media.admin.unassignText':
    '{org} sieht den Zugang danach nicht mehr. Der Zugang funktioniert in Jellyfin weiter, bis Sie ihn deaktivieren oder löschen.',
  'media.admin.targetNone':
    'Diese Organisation hat kein Streaming-Kontingent. Richten Sie zuerst eines auf dieser Instanz ein.',
  'media.admin.targetOtherInstance':
    'Das Streaming-Kontingent dieser Organisation liegt auf {instance}, nicht auf dieser Instanz.',
  'media.admin.targetAllowance': 'Kontingent: {n} von {max} Zugängen vergeben, Code {code}.',
  'media.admin.targetFull':
    'Das Kontingent ist ausgeschöpft. Sie können den Zugang trotzdem zuweisen, er zählt dann über das Maximum hinaus.',
  'media.admin.noModule': 'ohne Streaming',
  'media.admin.cardText': 'Jellyfin-Zugänge der Organisation und was jeder Zugang darf.',
  'media.admin.none': 'Kein Streaming',
  'media.admin.noneText':
    'Richten Sie ein Kontingent ein, damit die Organisation Streaming-Zugänge erstellen kann.',
  'media.admin.showAccounts': 'Zugänge anzeigen',
  'media.admin.noInstance': 'Es ist noch keine Jellyfin-Instanz als Provider verbunden.',

  // Admin: unmanaged users
  'media.unmanaged.title': 'Nicht verwaltete Benutzer',
  'media.unmanaged.text':
    'Benutzer, die direkt in Jellyfin angelegt wurden. Übernommene Benutzer behalten Namen und Verlauf.',
  'media.unmanaged.load': 'Benutzer abrufen',
  'media.unmanaged.reload': 'Neu laden',
  'media.unmanaged.hint':
    'Ruft die Benutzer von {instance} ab und zeigt die, die die Console noch nicht verwaltet. Administratoren und Benutzer mit alten gesperrten Bibliotheken lassen sich nicht übernehmen.',
  'media.unmanaged.empty': 'Alle Benutzer von {instance} werden verwaltet',
  'media.unmanaged.col.password': 'Passwort',
  'media.unmanaged.yes': 'Ja',
  'media.unmanaged.no': 'Nein',
  'media.unmanaged.administrator': 'Administrator',
  'media.unmanaged.blocked.administrator': 'Administrator, nicht übernehmbar',
  'media.unmanaged.blocked.blocked_folders': 'Alte gesperrte Bibliotheken, nicht übernehmbar',
  'media.unmanaged.import': 'Übernehmen',
  'media.unmanaged.importTitle': '{username} übernehmen',
  'media.unmanaged.importText':
    'Die Console verwaltet den Benutzer danach. Name und Verlauf bleiben erhalten.',
  'media.unmanaged.noCustomer': '– keinem Kunden zuweisen –',
  'media.unmanaged.noCustomerHint':
    'Ohne Kunde bleiben die Rechte des Benutzers, wie sie in Jellyfin sind. Sie können ihn später zuweisen.',
  'media.unmanaged.policyHint':
    'Der Zugriff des Kontingents wird auf den Benutzer angewendet. Mehr Zugänge als im Kontingent sind für Sie erlaubt.',
  'media.unmanaged.setPassword': 'Neues Passwort setzen',
  'media.unmanaged.setPasswordHint':
    'Erzeugt ein neues Passwort, das einmal angezeigt wird. Alle Geräte des Benutzers werden abgemeldet.',
  'media.unmanaged.setPasswordForced':
    'Der Benutzer hat kein Passwort: Wer den Namen kennt, meldet sich an. Er wird nur mit einem neuen Passwort übernommen.',
  'media.unmanaged.imported': '{username} übernommen',
  'media.unmanaged.passwordTitle': 'Benutzer übernommen',

  // Reseller
  'media.reseller.cardText': 'Zugänge aus Ihrem Kontingent und was jeder Zugang des Kunden darf.',
  'media.reseller.none': 'Kein Streaming vergeben',
  'media.reseller.noneText':
    'Teilen Sie dem Kunden einen Teil Ihres Kontingents zu, damit er Streaming-Zugänge erstellen kann.',
  'media.reseller.pool': 'Ihr Kontingent: {free} von {max} Zugängen frei',
  'media.reseller.noPool':
    'Ihre Organisation hat noch kein Streaming-Kontingent. Wenden Sie sich an weblion.one, um Streaming zu buchen.',
  'media.reseller.dialogText': 'Aus Ihrem Kontingent auf {instance}, höchstens mit Ihrem eigenen Zugriff.',
  'media.reseller.accountsLeft': 'Höchstens {n} aus Ihrem Kontingent',
  'media.reseller.maxTooHigh': 'Freie Zugänge in Ihrem Kontingent: {n}.',
  'media.reseller.noDownloads': 'Ihr Kontingent erlaubt keine Downloads.',
  'media.reseller.downloadsOff': 'Ihr Kontingent erlaubt keine Downloads, darum auch nicht für Kunden.',
  'media.reseller.bitrateHint': 'Höchstens {max}, die Grenze Ihres Kontingents.',
  'media.reseller.bitrateTooHigh': 'Höchstens {max} Mbit/s, die Grenze Ihres Kontingents.',
  'media.reseller.bitrateRequired':
    'Ihr Kontingent hat eine Grenze von {max} Mbit/s. Wählen Sie einen Wert bis dahin.',
  'media.reseller.enablesModule': 'Das aktiviert auch das Modul Streaming für den Kunden.',
  'media.reseller.removeText':
    'Der Kunde kann danach keine Streaming-Zugänge mehr erstellen. Die Zugänge gehen in Ihr Kontingent zurück.',
  'media.reseller.removeBlocked': 'Nur ohne Zugänge möglich. Der Kunde muss seine Zugänge zuerst löschen.',

  // Admin, dashboard
  'media.admin.synced':
    '{seen} Streaming-Zugänge abgeglichen, {missing} nicht mehr gefunden, {repaired} Richtlinien angepasst',
  'media.dashboardSub': '{n} von {max} Zugängen',

  // Provider form
  'providers.jellyfin.help':
    'Jellyfin 10.10 oder neuer (10.11 empfohlen) mit abgeschlossener Ersteinrichtung. Erstellen Sie im Jellyfin-Dashboard unter API-Schlüssel einen eigenen Schlüssel nur für weblion.one. Der Schlüssel hat volle Administratorrechte.',
  'providers.jellyfin.url': 'Adresse der Instanz',
  'providers.jellyfin.urlHint':
    'Die Adresse, die Ihre Kunden in den Jellyfin-Apps eingeben, mit Pfad, falls Jellyfin unter einem Basis-Pfad läuft, z. B. https://media.weblion.one.',
  'providers.jellyfin.urlInvalid':
    'Eine http- oder https-Adresse ohne Abfrage und ohne Zugangsdaten, ein Pfad nur für den Basis-Pfad von Jellyfin, z. B. https://media.weblion.one.',
  'providers.jellyfin.httpWarning':
    'Ohne https gehen API-Schlüssel und Passwörter unverschlüsselt über das Netz. Nur in einem privaten Netz verwenden.',
  'providers.jellyfin.apiKey': 'API-Schlüssel',
  'providers.jellyfin.apiKeyHint':
    'Dashboard > API-Schlüssel > Hinzufügen, App-Name z. B. weblion.one. 32 Zeichen aus 0-9 und a-f. Wird verschlüsselt gespeichert und nie mehr angezeigt.',
  'providers.jellyfin.apiKeyInvalid': 'Ein Jellyfin-API-Schlüssel hat genau 32 Zeichen aus 0-9 und a-f.',
  'providers.jellyfin.accountsText':
    'Streaming-Zugänge dieser Instanz, Kontingente der Kunden und Übernahme von Benutzern, die direkt in Jellyfin angelegt wurden.',
  'providers.jellyfin.toAccounts': 'Zu den Streaming-Zugängen',

  // Reseller overview, delete blockers
  'admin.resources.mediaAccounts': 'Streaming-Zugänge',
  'admin.blocker.mediaAccounts': 'Streaming-Zugänge: {n}',
  'admin.blocker.mediaAllowances': 'Streaming-Kontingent',

  // API explorer
  'explorer.jellyfinPath':
    'Pfade relativ zur Adresse der Instanz, z. B. /Users oder /Library/VirtualFolders. Schlüssel, Zugriffstoken und Passwörter in Antworten werden ausgeblendet. /Auth/Keys und Anmelde-Endpunkte sind gesperrt.',
  'explorer.jellyfinBodyHint':
    'GET und DELETE senden die Parameter als Query, POST als JSON. Eine Richtlinie (POST /Users/<id>/Policy) immer vollständig senden: Jellyfin setzt fehlende Felder zurück.',
} as const;
