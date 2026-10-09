/**
 * Cloud-Speicher (Modul "storage", Nextcloud): Seite der Organisation, Kontingente im
 * Admin- und Reseller-Bereich, Konten-Inventar, Provider-Formular und API Explorer.
 * Keys are prefixed with "storage." to stay unique (plus a few nav/provider/explorer keys).
 */
export const storageDe = {
  'nav.cloud': 'Cloud-Speicher',

  // Customer page
  'storage.subtitle':
    'Nextcloud-Konten für Dateien, Kalender und Kontakte Ihres Teams, mit Speicherplatz aus Ihrem Kontingent.',
  'storage.open': 'Nextcloud öffnen',
  'storage.create': 'Konto erstellen',
  'storage.noAccess': 'Sie haben keinen Zugriff auf den Cloud-Speicher dieser Organisation.',
  'storage.none.title': 'Noch kein Cloud-Speicher gebucht',
  'storage.none.text':
    'Cloud-Speicher (Nextcloud) buchen Sie über weblion.one. Sobald ein Speicherkontingent für Ihre Organisation eingerichtet ist, erstellen Sie hier Konten für Ihr Team.',
  'storage.none.textReseller':
    'Cloud-Speicher (Nextcloud) buchen Sie über {reseller}. Sobald ein Speicherkontingent für Ihre Organisation eingerichtet ist, erstellen Sie hier Konten für Ihr Team.',
  'storage.noAllowanceAccounts':
    'Für diese Organisation ist kein Speicherkontingent mehr eingerichtet. Bestehende Konten funktionieren weiter, neue lassen sich nicht erstellen.',
  'storage.limit.accounts':
    'Alle Konten Ihres Kontingents sind vergeben. Löschen Sie ein Konto oder erweitern Sie Ihr Kontingent, um weitere zu erstellen.',
  'storage.limit.storage':
    'Ihr Speicherkontingent ist vollständig an Konten vergeben. Verkleinern Sie ein Konto oder erweitern Sie Ihr Kontingent, um weitere zu erstellen.',
  'storage.allowance': 'Speicherkontingent',
  'storage.allowanceText':
    'Speicher, den Sie auf Ihre Konten verteilen. Belegt ist, was die Konten tatsächlich nutzen.',
  'storage.toCustomers': 'Davon an Ihre Kunden vergeben: {size} und {n} Konten',
  'storage.figure.booked': 'Gebucht',
  'storage.figure.allocated': 'Zugeteilt',
  'storage.figure.used': 'Belegt',
  'storage.figure.accounts': 'Konten',
  'storage.accounts.of': '{n} von {max}',
  'storage.accounts.ofUnlimited': '{n} (unbegrenzt)',
  'storage.meter.label': '{allocated} zugeteilt, {used} belegt, von {quota}',
  'storage.meter.used': 'Belegt',
  'storage.meter.allocated': 'Zugeteilt',
  'storage.meter.free': 'Frei',
  'storage.instance': 'Instanz',
  'storage.loginAt': 'Anmelden unter',
  'storage.dashboardSub': '{allocated} von {quota} zugeteilt',

  // Accounts
  'storage.accounts': 'Konten',
  'storage.accountsText':
    'Jedes Konto hat sein eigenes Speicherkontingent und meldet sich mit seinem Login-Namen an.',
  'storage.lastSync': 'Verbrauch zuletzt aktualisiert {when}',
  'storage.search': 'Konto, Name oder E-Mail suchen…',
  'storage.empty': 'Noch keine Konten',
  'storage.emptyText': 'Erstellen Sie ein Konto für jede Person, die Nextcloud nutzen soll.',
  'storage.col.login': 'Login-Name',
  'storage.col.name': 'Name',
  'storage.col.email': 'E-Mail',
  'storage.col.storage': 'Speicher',
  'storage.col.status': 'Status',
  'storage.col.lastLogin': 'Letzte Anmeldung',
  'storage.copyLogin': 'Login-Name kopieren',
  'storage.usage.of': '{used} von {quota}',
  'storage.usage.unlimited': '{used} belegt, unbegrenzt',
  'storage.usage.over': 'Kontingent überschritten, Uploads gesperrt',
  'storage.status.active': 'Aktiv',
  'storage.status.disabled': 'Deaktiviert',
  'storage.status.missing': 'In Nextcloud nicht gefunden',
  'storage.lastLogin.never': 'Noch nie',

  // Create
  'storage.createTitle': 'Cloud-Konto erstellen',
  'storage.createText': 'Ein Nextcloud-Konto für eine Person Ihres Teams, mit eigenem Speicherkontingent.',
  'storage.name': 'Benutzername',
  'storage.name.placeholder': 'anna',
  'storage.name.preview': 'Login-Name:',
  'storage.name.hint':
    'Kleinbuchstaben, Ziffern, Punkt, Binde- und Unterstrich. Lässt sich später nicht mehr ändern.',
  'storage.name.invalid':
    'Nur Kleinbuchstaben, Ziffern, Punkt, Binde- und Unterstrich, am Anfang und Ende ein Buchstabe oder eine Ziffer (höchstens 32 Zeichen).',
  'storage.name.tooLong': 'Der Login-Name darf höchstens {max} Zeichen lang sein.',
  'storage.name.taken': 'Dieses Konto gibt es bereits.',
  'storage.displayName': 'Anzeigename',
  'storage.displayName.placeholder': 'Anna Muster',
  'storage.email': 'E-Mail-Adresse',
  'storage.email.required': 'Erforderlich für die Einladung.',
  'storage.email.invalid': 'Keine gültige E-Mail-Adresse.',
  'storage.email.changeHint':
    'Nextcloud sendet Benachrichtigungen und Einladungen künftig an die neue Adresse.',
  'storage.quota': 'Speicherkontingent',
  'storage.quota.freeHint': 'Im Kontingent noch frei: {free}',
  'storage.quota.maxHint': 'Höchstens {max} (im Kontingent noch frei: {free})',
  'storage.quota.invalid': 'Geben Sie eine ganze Zahl ab 1 GB ein.',
  'storage.quota.tooLarge': 'Höchstens {max} passen ins Kontingent.',
  'storage.quota.current': 'Aktuell {quota}. Leer lassen, um es zu behalten.',
  'storage.quota.currentUnlimited': 'Aktuell unbegrenzt. Leer lassen, um es so zu belassen.',
  'storage.quota.used': 'Belegt: {used}',
  'storage.quota.belowUsageTitle': 'Kleiner als der belegte Speicher',
  'storage.quota.belowUsage':
    'Das Konto belegt bereits {used}. Alle Dateien bleiben erhalten, aber es lassen sich keine neuen hochladen, bis Dateien gelöscht werden.',
  'storage.delivery': 'Zugang',
  'storage.delivery.password': 'Passwort jetzt erzeugen',
  'storage.delivery.passwordText':
    'Das Passwort wird einmal angezeigt. Sie geben es selbst weiter. Mit E-Mail-Adresse schickt Nextcloud zusätzlich eine Willkommens-Mail.',
  'storage.delivery.invite': 'Einladung per E-Mail',
  'storage.delivery.inviteText': 'Nextcloud sendet einen Link, mit dem die Person ihr Passwort selbst setzt.',
  'storage.delivery.needsEmail': 'Für eine Einladung braucht es eine E-Mail-Adresse.',
  'storage.created': 'Konto {username} erstellt',
  'storage.createdInvite': 'Konto erstellt, Einladung an {email} gesendet',
  'storage.createdTitle': 'Konto erstellt',

  // Edit, enable/disable, password, invitation, delete
  'storage.editTitle': '{username} bearbeiten',
  'storage.updated': '{username} gespeichert',
  'storage.disable': 'Deaktivieren',
  'storage.enable': 'Aktivieren',
  'storage.disableTitle': '{username} deaktivieren?',
  'storage.disableText':
    'Die Person kann sich nicht mehr anmelden und ihre Geräte synchronisieren nicht mehr. Dateien und Kontingent bleiben erhalten.',
  'storage.enableTitle': '{username} aktivieren?',
  'storage.enableText': 'Die Person kann sich wieder anmelden.',
  'storage.enabledToast': '{username} aktiviert',
  'storage.disabledToast': '{username} deaktiviert',
  'storage.resetPassword': 'Passwort neu setzen',
  'storage.passwordTitle': 'Neues Passwort für {username}?',
  'storage.passwordText':
    'Das bisherige Passwort funktioniert danach nicht mehr. Das neue Passwort wird einmal angezeigt.',
  'storage.passwordNewTitle': 'Neues Passwort',
  'storage.resendInvite': 'Einladung erneut senden',
  'storage.invitedToast': 'Einladung an {email} gesendet',
  'storage.deleteTitle': '{username} löschen?',
  'storage.deleteConfirm': 'Endgültig löschen',
  'storage.deleteWarningTitle': 'Alle Dateien werden gelöscht',
  'storage.deleteWarning':
    'Das Konto wird in Nextcloud gelöscht, mit allen Dateien ({used}), Kalendern, Kontakten und Freigaben. Das lässt sich nicht rückgängig machen.',
  'storage.deletedToast': '{username} gelöscht',

  // Allowances (admin and reseller)
  'storage.allowance.setUp': 'Einrichten',
  'storage.allowance.setUpTitle': 'Cloud-Speicher für {name} einrichten',
  'storage.allowance.editTitle': 'Cloud-Speicher von {name}',
  'storage.allowance.dialogText': 'Gesamtspeicher und Anzahl Konten, die die Organisation selbst verteilt.',
  'storage.allowance.instanceHint': 'Alle Konten der Organisation liegen auf dieser Nextcloud-Instanz.',
  'storage.allowance.instanceLocked':
    'Die Instanz lässt sich nur ändern, solange keine Konten darauf bestehen.',
  'storage.allowance.quota': 'Speicher gesamt',
  'storage.allowance.allocatedHint': 'Bereits vergeben: {size}',
  'storage.allowance.belowAllocated': 'Mindestens {size}, so viel ist bereits vergeben.',
  'storage.allowance.maxAccounts': 'Konten höchstens',
  'storage.allowance.maxAccountsHint': 'Leer lassen für unbegrenzt viele Konten.',
  'storage.allowance.maxInvalid': 'Geben Sie eine ganze Zahl ab 1 ein oder lassen Sie das Feld leer.',
  'storage.allowance.maxBelowAccounts': 'Mindestens {n}, so viele Konten bestehen bereits.',
  'storage.allowance.unlimited': 'unbegrenzt',
  'storage.allowance.enableModuleHint':
    '{org} sieht den Cloud-Speicher nur mit aktivem Modul in der Console.',
  'storage.allowance.moduleOff': 'Ohne das Modul "{module}" sieht die Organisation das Kontingent nicht.',
  'storage.allowance.resellerHint':
    'Ein Reseller verteilt dieses Kontingent auf eigene Konten und auf seine Kunden.',
  'storage.allowance.saved': 'Speicherkontingent gespeichert',
  'storage.allowance.remove': 'Kontingent entfernen',
  'storage.allowance.removeTitle': 'Cloud-Speicher von {name} entfernen?',
  'storage.allowance.removeText':
    'Die Organisation kann danach keine Nextcloud-Konten mehr erstellen. Das Modul bleibt aktiv, bis Sie es abschalten.',
  'storage.allowance.removeBlocked':
    'Nur ohne Konten möglich. Löschen Sie die Konten oder weisen Sie sie einer anderen Organisation zu.',
  'storage.allowance.removed': 'Speicherkontingent entfernt',

  // Admin
  'storage.admin.tab': 'Cloud-Konten',
  'storage.admin.tabHint':
    'Speicherkontingente richten Sie beim Kunden ein, die Konten erstellen die Kunden selbst. Benutzer, die direkt in Nextcloud angelegt wurden, übernehmen Sie unten.',
  'storage.admin.search': 'Login-Name, Name oder E-Mail suchen…',
  'storage.admin.filterCustomer': 'Nach Kunde filtern',
  'storage.admin.allCustomers': 'Alle Kunden',
  'storage.admin.filterInstance': 'Nach Instanz filtern',
  'storage.admin.allInstances': 'Alle Instanzen',
  'storage.admin.empty': 'Keine Cloud-Konten',
  'storage.admin.emptyText':
    'Konten erscheinen hier, sobald Kunden sie erstellen oder Sie Benutzer einer Instanz übernehmen.',
  'storage.admin.synced': '{seen} Cloud-Konten synchronisiert, {missing} fehlen',
  'storage.admin.cardText': 'Speicher, den die Organisation auf Nextcloud-Konten verteilen kann.',
  'storage.admin.none': 'Kein Cloud-Speicher',
  'storage.admin.noneText':
    'Richten Sie ein Kontingent ein, damit die Organisation Nextcloud-Konten erstellen kann.',
  'storage.admin.showAccounts': 'Konten anzeigen',
  'storage.admin.noInstance': 'Es ist noch keine Nextcloud-Instanz als Provider verbunden.',
  'storage.admin.noModule': 'ohne Cloud-Speicher',
  'storage.admin.needsAllowance': 'Der Kunde braucht ein Speicherkontingent auf derselben Instanz.',
  'storage.admin.assignText':
    'Das Konto liegt auf {instance}. Der Kunde verwaltet es danach in seiner Console.',
  'storage.admin.assignQuotaHint':
    'Das Kontingent des Kontos zählt danach zum Speicherkontingent des Kunden, auch wenn es dieses übersteigt.',
  'storage.admin.unassignText':
    '{org} sieht das Konto danach nicht mehr. Das Konto und seine Dateien bleiben in Nextcloud bestehen.',

  // Admin: unmanaged users
  'storage.unmanaged.title': 'Nicht verwaltete Benutzer',
  'storage.unmanaged.text':
    'Benutzer, die direkt in Nextcloud angelegt wurden. Übernommene Benutzer behalten Namen und Kontingent.',
  'storage.unmanaged.load': 'Benutzer abrufen',
  'storage.unmanaged.reload': 'Neu laden',
  'storage.unmanaged.hint':
    'Ruft die Benutzer von {instance} ab und zeigt die, die die Console noch nicht verwaltet. Administratoren der Instanz erscheinen nie.',
  'storage.unmanaged.empty': 'Alle Benutzer von {instance} werden verwaltet',
  'storage.unmanaged.import': 'Übernehmen',
  'storage.unmanaged.importTitle': '{username} übernehmen',
  'storage.unmanaged.importText':
    'Die Console verwaltet den Benutzer danach. Name, Kontingent und Dateien bleiben unverändert.',
  'storage.unmanaged.noCustomer': '– keinem Kunden zuweisen –',
  'storage.unmanaged.unlimitedHint':
    'Der Benutzer hat kein Kontingent (unbegrenzt). Beim Kunden zählt er mit dem belegten Speicher, bis ein Kontingent gesetzt ist.',
  'storage.unmanaged.imported': '{username} übernommen',

  // Reseller
  'storage.reseller.cardText':
    'Speicher aus Ihrem Kontingent, den der Kunde auf eigene Nextcloud-Konten verteilt.',
  'storage.reseller.none': 'Kein Cloud-Speicher vergeben',
  'storage.reseller.noneText':
    'Teilen Sie dem Kunden einen Teil Ihres Kontingents zu, damit er Nextcloud-Konten erstellen kann.',
  'storage.reseller.pool': 'Ihr Kontingent: {free} von {quota} frei',
  'storage.reseller.noPool':
    'Ihre Organisation hat noch kein Cloud-Speicher-Kontingent. Wenden Sie sich an weblion.one, um Speicher zu buchen.',
  'storage.reseller.dialogText':
    'Aus Ihrem Kontingent auf {instance}. Der Kunde verteilt den Speicher selbst auf seine Konten.',
  'storage.reseller.quotaHint': 'Höchstens {max} aus Ihrem Kontingent',
  'storage.reseller.accountsLeft': 'Höchstens {n} aus Ihrem Kontingent',
  'storage.reseller.maxRequired':
    'Ihr Kontingent hat eine Höchstzahl an Konten. Geben Sie höchstens {n} ein.',
  'storage.reseller.maxTooHigh': 'In Ihrem Kontingent sind nur noch {n} Konten frei.',
  'storage.reseller.enablesModule': 'Das aktiviert auch das Modul Cloud-Speicher für den Kunden.',
  'storage.reseller.removeText':
    'Der Kunde kann danach keine Nextcloud-Konten mehr erstellen. Der Speicher geht in Ihr Kontingent zurück.',
  'storage.reseller.removeBlocked': 'Nur ohne Konten möglich. Der Kunde muss seine Konten zuerst löschen.',

  // Provider form
  'providers.nextcloud.help':
    'Legen Sie in Nextcloud ein eigenes Admin-Konto für die Console an (Mitglied der Gruppe "admin") und erstellen Sie dafür unter Persönliche Einstellungen > Sicherheit ein App-Passwort. Für Einladungen muss die Instanz E-Mails versenden können (Verwaltung > Grundeinstellungen > E-Mail-Server).',
  'providers.nextcloud.url': 'URL der Instanz',
  'providers.nextcloud.urlHint':
    'Die Adresse, unter der sich Benutzer anmelden, z. B. https://cloud.weblion.one',
  'providers.nextcloud.username': 'Admin-Benutzer',
  'providers.nextcloud.usernameHint': 'Login-Name des Admin-Kontos für die Console, nicht Ihr persönlicher.',
  'providers.nextcloud.appPassword': 'App-Passwort',
  'providers.nextcloud.appPasswordHint':
    'Persönliche Einstellungen > Sicherheit > Geräte & Sitzungen > Neues App-Passwort erstellen.',
  'providers.nextcloud.groupPrefix': 'Gruppen-Präfix',
  'providers.nextcloud.groupPrefixHint':
    'Optional. Jede Organisation bekommt die Gruppe <Präfix><Kürzel>, damit Kolleginnen und Kollegen untereinander teilen können. Standard: {prefix}',
  'providers.nextcloud.groupPrefixChange':
    'Standard: {prefix}. Ein neues Präfix gilt nur für neue Konten, bestehende bleiben in ihren Gruppen.',
  'providers.nextcloud.groupPrefixInvalid':
    'Kleinbuchstaben, Ziffern, Punkt, Binde- und Unterstrich, höchstens 31 Zeichen.',
  'providers.nextcloud.accountsText':
    'Konten dieser Instanz, Zuweisung an Kunden und Übernahme von Benutzern, die direkt in Nextcloud angelegt wurden.',
  'providers.nextcloud.toAccounts': 'Zu den Cloud-Konten',

  // API explorer
  'explorer.nextcloudPath':
    'OCS-Pfade, z. B. /ocs/v2.php/cloud/users?search=anna. Passwörter in Antworten werden ausgeblendet, App-Passwörter lassen sich hier nicht verwalten.',
  'explorer.nextcloudBodyHint':
    'GET und DELETE senden die Parameter als Query, POST und PUT als Formular, z. B. { "key": "quota", "value": "10 GB" }.',
} as const;
