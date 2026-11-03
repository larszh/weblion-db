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
    'Wählen Sie in der App Quick Connect. Geben Sie den Code vom Fernseher hier in der Console beim Zugang unter "Fernseher verbinden" ein. Oder in Jellyfin unter Einstellungen > Quick Connect auf einem Gerät, das schon angemeldet ist.',
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
    'Alle Geräte, die mit diesem Zugang angemeldet sind, werden sofort abgemeldet. Das bisherige Passwort funktioniert danach nicht mehr. Fernseher verbinden Sie danach am einfachsten mit "Fernseher verbinden".',
  'media.password.set': 'Passwort setzen',
  'media.password.setToast': 'Neues Passwort für {username} gesetzt',
  'media.password.setToastSignedOut': 'Neues Passwort für {username} gesetzt, alle Geräte abgemeldet',
  'media.password.devicesDone': 'Alle Geräte wurden abgemeldet.',
  'media.password.devicesLeft': 'Noch angemeldete Geräte: {n}',

  // Connect a TV (Quick Connect)
  'media.connect.action': 'Fernseher verbinden',
  'media.connect.title': 'Fernseher mit {username} verbinden',
  'media.connect.text':
    'Ein Fernseher oder ein anderes Gerät meldet sich mit diesem Zugang an, ohne dass jemand das Passwort eintippt.',
  'media.connect.step1':
    'Öffnen Sie die Jellyfin-App auf dem Fernseher, geben Sie die Server-Adresse ein und wählen Sie Quick Connect.',
  'media.connect.step2': 'Die App zeigt einen Code mit 6 Ziffern. Geben Sie ihn hier ein.',
  'media.connect.code': 'Code vom Fernseher',
  'media.connect.codeHint': 'Der Code gilt 10 Minuten. Die Console speichert ihn nicht.',
  'media.connect.codeInvalid': 'Der Code hat 6 Ziffern.',
  'media.connect.submit': 'Verbinden',
  'media.connect.done': 'Fernseher mit {username} verbunden',
  'media.connect.error.code':
    'Diesen Code kennt der Server nicht, oder er ist abgelaufen. Starten Sie Quick Connect auf dem Fernseher neu und geben Sie den neuen Code ein.',
  'media.connect.error.off':
    'Quick Connect ist auf diesem Server ausgeschaltet. Melden Sie den Fernseher mit Login-Name und Passwort an.',
  'media.connect.error.limit':
    'Mit diesem Zugang sind schon so viele Geräte angemeldet, wie das Kontingent erlaubt ({n}). Melden Sie zuerst Geräte ab.',
  'media.connect.error.disabled':
    'Der Zugang ist deaktiviert. Aktivieren Sie ihn, bevor Sie einen Fernseher verbinden.',
  'media.connect.error.failed':
    'Der Server hat den Code nicht angenommen. Zeigt der Fernseher an, dass er angemeldet ist, ist er verbunden. Sonst starten Sie Quick Connect neu.',
  'media.connect.error.tooMany': 'Zu viele Versuche. Warten Sie eine Minute.',

  // Sign out all devices
  'media.devices.action': 'Alle Geräte abmelden',
  'media.devices.title': 'Alle Geräte von {username} abmelden?',
  'media.devices.count': 'Angemeldete Geräte: {n}',
  'media.devices.none': 'Mit diesem Zugang ist kein Gerät angemeldet.',
  'media.devices.text':
    'Laufende Wiedergaben werden gestoppt und alle Geräte sofort abgemeldet. Passwort, Verlauf und Favoriten bleiben. Die Geräte melden sich mit dem Passwort oder mit Quick Connect neu an.',
  'media.devices.privacy': 'Die Console zeigt nur die Zahl, keine Gerätenamen.',
  'media.devices.confirm': 'Alle abmelden',
  'media.devices.done': 'Abgemeldete Geräte: {n}',
  'media.devices.skipped':
    'Nicht abgemeldet: {n}. Auf diesen Geräten ist auch ein anderer Zugang angemeldet. Ein neues Passwort meldet auch sie ab.',
  'media.devices.failed': 'Bei {n} Geräten ist das Abmelden gescheitert. Versuchen Sie es erneut.',

  // Enable, disable, delete
  'media.disable': 'Deaktivieren',
  'media.enable': 'Aktivieren',
  'media.disableTitle': '{username} deaktivieren?',
  'media.disableText':
    'Laufende Wiedergaben werden gestoppt, alle Geräte sofort abgemeldet, und der Zugang kann sich nicht mehr anmelden. Verlauf und Favoriten bleiben erhalten.',
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
    'Der Zugang wird in Jellyfin gelöscht, mit Wiedergabeverlauf, Favoriten und Playlists. Laufende Wiedergaben werden gestoppt und alle Geräte abgemeldet. Das lässt sich nicht rückgängig machen.',
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
  'media.issue.seerr_missing': 'Nicht in Anfragen',
  'media.issue.seerr_missing.text':
    'Der Zugang ist in Seerr noch nicht angelegt. Die Synchronisierung versucht es erneut.',
  'media.issue.seerr_drift': 'Anfragen weichen ab',
  'media.issue.seerr_drift.text':
    'Rechte oder Grenzen in Seerr weichen vom Kontingent ab. Die Synchronisierung passt sie an.',

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
  'media.admin.repairHintSeerr':
    'Schreibt den Zugriff des Kontingents jetzt nach Jellyfin und die Rechte für Anfragen nach Seerr',
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

  // Requests (Seerr add-on): customer card, allowance fields, admin instances
  'media.requests.title': 'Anfragen',
  'media.requests.text':
    'Mit Anfragen wünschen sich Ihre Zugänge Filme und Serien, die es auf dem Server noch nicht gibt. weblion.one prüft jede Anfrage und stellt genehmigte Titel bereit.',
  'media.requests.open': 'Anfragen öffnen',
  'media.requests.address': 'Adresse von Anfragen',
  'media.requests.copyAddress': 'Adresse kopieren',
  'media.requests.signIn': 'Melden Sie sich dort mit dem Login-Namen und dem Passwort des Zugangs an.',
  'media.requests.included': 'Enthalten',
  'media.requests.movies': 'Filme',
  'media.requests.tv': 'Serien',
  'media.requests.movieQuota': 'bis {limit} Filme in {days} Tagen pro Zugang',
  'media.requests.tvQuota': 'bis {limit} Staffeln in {days} Tagen pro Zugang',
  'media.requests.unlimited': 'ohne Grenze',
  'media.requests.notIncluded': 'nicht enthalten',
  'media.requests.devicesHint': 'Die Anmeldung bei Anfragen zählt in Jellyfin als ein angemeldetes Gerät.',
  'media.requests.sessionHint':
    'Eine Anmeldung bei Anfragen gilt bis zu 30 Tage, auch nach einem neuen Passwort oder dem Abmelden aller Geräte: Bis dahin kann dort weiter angefragt werden. Deaktivieren nimmt das Recht anzufragen, erst Löschen beendet die Anmeldung.',
  'media.requests.col.pending': 'Offen',
  'media.requests.col.approved': 'Genehmigt',
  'media.requests.col.available': 'Verfügbar',
  'media.requests.col.quota': 'Kontingent genutzt',
  'media.requests.quotaMovies': 'Filme: {used} von {limit}',
  'media.requests.quotaSeasons': 'Staffeln: {used} von {limit}',
  'media.requests.notReady': 'Wird eingerichtet',
  'media.requests.notReadyHint':
    'Der Zugang wird in Anfragen eingerichtet. Das dauert höchstens ein paar Minuten.',
  'media.requests.disabled': 'Deaktivierte Zugänge können nicht anfragen.',
  'media.requests.syncedAt': 'Stand {when}',
  'media.requests.privacy':
    'Die Console zeigt nur Zahlen, nie die angefragten Titel. In Anfragen selbst sehen alle Zugänge auf diesem Server die Login-Namen der anderen und wer einen Titel angefragt hat.',
  'media.requests.figure': 'Anfragen',
  'media.requests.figureBoth': 'Filme und Serien',
  'media.requests.totals': 'Offen {pending}, genehmigt {approved}, verfügbar {available}',
  'media.requests.field': 'Anfragen (Seerr)',
  'media.requests.fieldHint':
    'Die Zugänge dürfen Filme oder Serien anfragen. Genehmigt wird in Seerr durch weblion.one.',
  'media.requests.fieldMovies': 'Filme anfragen',
  'media.requests.fieldTv': 'Serien anfragen',
  'media.requests.limitNone': 'Ohne Grenze',
  'media.requests.quotaLimit': 'Anzahl',
  'media.requests.quotaDays': 'in Tagen',
  'media.requests.seasonsHint':
    'Bei Serien zählt Seerr Staffeln, nicht Serien. "Keine Anfragen" heisst: Anfragen ausschalten.',
  'media.requests.typeRequired': 'Wählen Sie Filme, Serien oder beides.',
  'media.requests.quotaInvalid': 'Eine ganze Zahl von 1 bis {max}.',
  'media.requests.daysInvalid': 'Eine ganze Zahl von 1 bis {max} Tagen.',
  'media.requests.sharedWarning':
    'Auf dieser Instanz haben mehrere Organisationen ein Kontingent. In Anfragen sehen alle Zugänge die Login-Namen der anderen und wer einen Titel angefragt hat.',
  'media.requests.inactive':
    'Seerr ist auf dieser Instanz ausgeschaltet. Kunden sehen Anfragen erst, wenn Sie es einschalten.',
  'media.requests.streamsWarning':
    'Mit 1 Stream kann sich ein Zugang nicht bei Anfragen anmelden, solange ein anderes Gerät angemeldet ist.',
  'media.requests.unavailable': 'Auf dieser Instanz ist kein Seerr eingetragen.',
  'media.requests.offOnSave': 'Anfragen werden beim Speichern ausgeschaltet.',
  'media.requests.applyFailed':
    'Bei diesen Zugängen liessen sich die Rechte in Anfragen nicht setzen. Die Synchronisierung versucht es erneut.',
  'media.reseller.requestsCap': 'Höchstens, was Ihr Kontingent erlaubt.',
  'media.reseller.requestsYours': 'Ihr Kontingent: {value}',
  'media.conflict.requestsMovies': 'Filme anfragen',
  'media.conflict.requestsTv': 'Serien anfragen',
  'media.conflict.movieQuota': 'Grenze Filme',
  'media.conflict.tvQuota': 'Grenze Staffeln',
  'media.seerr.column': 'Anfragen',
  'media.seerr.none': 'Kein Seerr',
  'media.seerr.status.off': 'Aus',
  'media.seerr.status.ok': 'An',
  'media.seerr.status.unsafe': 'Unsicher',
  'media.seerr.status.error': 'Fehler',
  'media.seerr.status.unknown': 'Ungeprüft',
  'media.seerr.shared':
    'Gemeinsam: {n} Organisationen mit Anfragen sehen in Seerr die Login-Namen und Wünsche der anderen.',
  'media.seerr.manage': 'Anfragen…',
  'media.seerr.title': 'Anfragen auf {instance}',
  'media.seerr.text':
    'Seerr ist die Anfrage-Seite dieser Jellyfin-Instanz. Die Console legt dort die Zugänge von Kunden mit Anfragen an und setzt ihre Rechte und Grenzen. Anfragen genehmigen Sie in Seerr.',
  'media.seerr.version': 'Version {version}',
  'media.seerr.checkedAt': 'Geprüft {when}',
  'media.seerr.recheck': 'Erneut prüfen',
  'media.seerr.check.reachable': 'Erreichbar',
  'media.seerr.check.key': 'API-Schlüssel angenommen',
  'media.seerr.check.sameServer': 'Mit dieser Jellyfin-Instanz verbunden',
  'media.seerr.check.newSignIns': 'Neue Anmeldungen über Jellyfin aus',
  'media.seerr.check.defaultPermissions': 'Neue Benutzer ohne Rechte',
  'media.seerr.check.mediaServerLogin': 'Anmeldung mit Jellyfin an',
  'media.seerr.check.csrf': 'CSRF-Schutz aus',
  'media.seerr.problem.unreachable': 'Seerr ist nicht erreichbar.',
  'media.seerr.problem.key': 'Seerr hat den API-Schlüssel abgelehnt.',
  'media.seerr.problem.not_jellyfin': 'Seerr ist nicht für Jellyfin eingerichtet.',
  'media.seerr.problem.other_server': 'Seerr ist mit einem anderen Jellyfin-Server verbunden.',
  'media.seerr.problem.csrf':
    'Der CSRF-Schutz von Seerr ist an, die Console kann so nichts ändern. Schalten Sie ihn in Seerr unter Einstellungen > Netzwerk aus.',
  'media.seerr.problem.new_signins':
    'Neue Anmeldungen über Jellyfin sind an: Jeder Benutzer des Servers könnte anfragen.',
  'media.seerr.problem.default_permissions': 'Neue Benutzer bekommen Rechte. Empfohlen: keine.',
  'media.seerr.problem.media_server_login':
    'Die Anmeldung mit Jellyfin ist aus: Kunden könnten sich nicht anmelden.',
  'media.seerr.unmanaged':
    'Benutzer in Seerr, die die Console nicht verwaltet und anfragen dürfen: {n}. Die Synchronisierung entzieht ihnen dieses Recht.',
  'media.seerr.orphans': 'Benutzer in Seerr ohne Jellyfin-Benutzer: {n}. Löschen Sie sie in Seerr.',
  'media.seerr.localLogin':
    'Die lokale Anmeldung ist in Seerr an. Benutzer, die Seerr bei einer Jellyfin-Anmeldung angelegt hat, bevor die empfohlenen Einstellungen galten, melden sich damit weiter mit ihrem damaligen Passwort an, auch nach einem neuen Passwort. Schalten Sie sie in Seerr unter Einstellungen > Benutzer aus, wenn niemand sie braucht.',
  'media.seerr.apply': 'Empfohlene Einstellungen anwenden',
  'media.seerr.applyText':
    'Setzt in Seerr: neue Anmeldungen über Jellyfin aus, neue Benutzer ohne Rechte, Anmeldung mit Jellyfin an. Andere Einstellungen bleiben.',
  'media.seerr.applied': 'Empfohlene Einstellungen in Seerr gesetzt',
  'media.seerr.enable': 'Anfragen für Kunden anbieten',
  'media.seerr.enableHint': 'Erst möglich, wenn alle Prüfungen bestanden sind.',
  'media.seerr.enabled': 'Anfragen auf {instance} eingeschaltet',
  'media.seerr.disabled': 'Anfragen auf {instance} ausgeschaltet',
  'media.seerr.disableTitle': 'Anfragen auf {instance} ausschalten?',
  'media.seerr.disableText':
    'Kunden sehen Anfragen nicht mehr. Die Console entzieht allen Zugängen in Seerr das Recht anzufragen. Benutzer und Anfragen bleiben in Seerr erhalten.',
  'media.seerr.disableConfirm': 'Ausschalten',
  'media.seerr.sharedTitle': 'Mehrere Organisationen auf dieser Instanz',
  'media.seerr.sharedText':
    '{n} Organisationen haben ein Kontingent auf {instance}. In Seerr sieht jeder angemeldete Zugang die Benutzerliste und bei jedem Titel, wer ihn angefragt hat. Kunden mit Anfragen sehen so Login-Namen und Wünsche anderer Kunden.',
  'media.seerr.sharedConfirm': 'Ich habe das geprüft und schalte Anfragen trotzdem ein.',
  'media.seerr.enableConfirm': 'Einschalten',
  'media.seerr.notConfigured':
    'Für diese Instanz ist kein Seerr eingetragen. Tragen Sie Adresse und API-Schlüssel beim Provider ein.',
  'media.seerr.toProvider': 'Zum Provider',
  'media.seerr.applyResult': 'Rechte in Anfragen gesetzt: {n}',

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
  'providers.jellyfin.seerr': 'Anfragen (Seerr, optional)',
  'providers.jellyfin.seerrHelp':
    'Eine Seerr-Instanz, die mit genau dieser Jellyfin-Instanz verbunden ist. Für Kunden einschalten unter Admin > Streaming.',
  'providers.jellyfin.seerrUrl': 'Seerr-Adresse',
  'providers.jellyfin.seerrUrlHint':
    'Die Adresse, unter der Ihre Kunden Seerr öffnen, z. B. https://anfragen.weblion.one.',
  'providers.jellyfin.seerrUrlInvalid': 'Eine http- oder https-Adresse ohne Abfrage und ohne Zugangsdaten.',
  'providers.jellyfin.seerrApiKey': 'Seerr-API-Schlüssel',
  'providers.jellyfin.seerrApiKeyHint':
    'Seerr > Einstellungen > Allgemein > API-Schlüssel. Der Schlüssel hat volle Rechte in Seerr. Wird verschlüsselt gespeichert und nie mehr angezeigt.',
  'providers.jellyfin.seerrApiKeyInvalid': 'Den Schlüssel bitte so einfügen, wie Seerr ihn anzeigt.',
  'providers.jellyfin.seerrBoth': 'Adresse und Schlüssel gehören zusammen.',
  'providers.jellyfin.seerrRemove': 'Seerr entfernen',

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
