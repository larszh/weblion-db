/** Reseller-Bereich, Module, Kundenverwaltung im Admin-Bereich, Plattform-Einstellungen (E-Mail, Rechnungssteller, Integrationen). Keys are prefixed with "admin." to stay unique. */
export const adminDe = {
  // Shared
  'admin.kind.customer': 'Kunde',
  'admin.kind.reseller': 'Reseller',
  'admin.kind.internal': 'Intern',
  'admin.modules': 'Module',
  'admin.modules.none': 'Keine Module',
  'admin.modules.disable': 'Deaktivieren',
  'admin.modules.disableTitle': 'Modul deaktivieren?',
  'admin.modules.disableText':
    '{module} wird für {name} ausgeblendet. Zugewiesene Ressourcen bleiben bestehen, sind aber nicht mehr erreichbar, bis das Modul wieder aktiv ist.',
  'admin.modules.disableReseller':
    '{module} wird für {name} und alle Kunden dieses Resellers ausgeblendet. Zugewiesene Ressourcen bleiben bestehen.',
  'admin.notes': 'Notizen',
  'admin.noMatch': 'Keine Treffer',
  'admin.balance': 'Guthaben',
  'admin.openTotal': 'Offen',
  'admin.resources': 'Ressourcen',
  'admin.resources.domains': 'Domains',
  'admin.resources.webspaces': 'Webspaces',
  'admin.tab.overview': 'Übersicht',
  'admin.tab.resources': 'Ressourcen',
  'admin.tab.billing': 'Abrechnung',
  'admin.status.suspendTitle': 'Kunde sperren?',
  'admin.status.suspendText':
    'Mitglieder von {name} können danach nur noch lesen. Server und Webspaces laufen weiter.',
  'admin.status.suspendReseller':
    'Mitglieder von {name} können danach nur noch lesen, auch bei den Kunden dieses Resellers. Server und Webspaces laufen weiter.',
  'admin.status.activateTitle': 'Kunde entsperren?',
  'admin.status.activateText': '{name} kann danach wieder alles tun, was Rollen und Policies erlauben.',
  'admin.status.byPlatform': 'Von weblion.one gesperrt',
  'admin.status.byReseller': 'Vom Reseller gesperrt',

  // Invitations
  'admin.invite.link': 'Einladungslink für den Owner (14 Tage gültig):',
  'admin.invite.mailSent': 'Die Einladung wurde per E-Mail an {email} gesendet.',
  'admin.invite.mailFailed':
    'Die Einladungs-E-Mail konnte nicht gesendet werden. Geben Sie den Link selbst weiter.',
  'admin.invite.mailSkipped':
    'Es wurde keine E-Mail gesendet, weil SMTP nicht eingerichtet ist. Geben Sie den Link selbst weiter.',

  // Delete protection
  'admin.delete.blocked': 'Löschen nicht möglich, es hängt noch etwas daran:',
  'admin.delete.moveHint': 'Verschiebe oder entferne diese Einträge zuerst.',
  'admin.delete.billingHint':
    'Rechnungen, Zahlungen und Guthabenbuchungen müssen aufbewahrt werden. Sperre die Organisation stattdessen.',
  'admin.blocker.customers': 'Kunden: {n}',
  'admin.blocker.servers': 'Server: {n}',
  'admin.blocker.domains': 'Domains: {n}',
  'admin.blocker.webspaces': 'Webspaces: {n}',
  'admin.blocker.cloudAccounts': 'Cloud-Konten: {n}',
  'admin.blocker.cloudAllowances': 'Cloud-Speicher-Kontingent',
  'admin.blocker.invoices': 'Rechnungen: {n}',
  'admin.blocker.payments': 'Zahlungen: {n}',
  'admin.blocker.creditTransactions': 'Guthabenbuchungen: {n}',
  'admin.blocker.services': 'Dienste: {n}',

  // Reseller area
  'admin.reseller.subtitle': 'Ihre Kunden, deren Module und die Ressourcen, die Sie ihnen zuweisen.',
  'admin.reseller.tab.customers': 'Kunden',
  'admin.reseller.tab.issuer': 'Rechnungssteller',
  'admin.reseller.new': 'Kunde anlegen',
  'admin.reseller.newText':
    'Legt eine Organisation für Ihren Kunden an. Der Owner bekommt eine Einladung und sieht nur die Module, die Sie freischalten.',
  'admin.reseller.ownerHint': 'Erhält einen Einladungslink, auch wenn bereits ein Konto besteht.',
  'admin.reseller.modulesHint': 'Nur Module, die für Ihre Organisation freigeschaltet sind.',
  'admin.reseller.notesHint': 'Nur für Ihr Team sichtbar, nicht für den Kunden.',
  'admin.reseller.noModules':
    'Für Ihre Organisation ist noch kein Modul freigeschaltet. Wenden Sie sich an weblion.one.',
  'admin.reseller.noOwnerYet':
    'Ohne Owner-E-Mail hat noch niemand Zugriff. Sie können später Mitglieder einladen.',
  'admin.reseller.empty': 'Noch keine Kunden',
  'admin.reseller.emptyText':
    'Legen Sie Ihren ersten Kunden an und weisen Sie ihm Server, Domains oder Webspaces zu.',
  'admin.reseller.notReseller': 'Nur für Reseller',
  'admin.reseller.notResellerText':
    'Diese Organisation ist kein Reseller und hat daher keine eigenen Kunden.',
  'admin.reseller.noAccess': 'Keine Berechtigung für die Kundenverwaltung.',
  'admin.reseller.notFound': 'Kunde nicht gefunden',
  'admin.reseller.notFoundText': 'Den Kunden gibt es nicht oder er gehört nicht zu Ihrer Organisation.',
  'admin.reseller.modulesText': 'Der Kunde sieht nur freigeschaltete Module in seiner Console.',
  'admin.reseller.moduleMissing': 'Für Ihre Organisation nicht freigeschaltet.',
  'admin.reseller.openPanel': 'Kunden-Panel öffnen',
  'admin.reseller.platformSuspended':
    'weblion.one hat diesen Kunden gesperrt. Nur weblion.one kann die Sperre aufheben. Wenden Sie sich bei Fragen an den Support.',
  'admin.reseller.deleteText':
    'Nur möglich, wenn keine Ressourcen, Rechnungen oder Dienste mehr daran hängen. Mitglieder verlieren den Zugriff.',

  // Resources
  'admin.resources.intro':
    'Ressourcen kommen aus dem Bestand Ihrer Organisation. Freigegebene Ressourcen gehen dorthin zurück.',
  'admin.resources.title.server': 'Server',
  'admin.resources.title.domain': 'Domains',
  'admin.resources.title.webspace': 'Webspaces',
  'admin.resources.empty.server': 'Diesem Kunden sind keine Server zugewiesen.',
  'admin.resources.empty.domain': 'Diesem Kunden sind keine Domains zugewiesen.',
  'admin.resources.empty.webspace': 'Diesem Kunden sind keine Webspaces zugewiesen.',
  'admin.resources.poolCount': '{n} frei in Ihrem Bestand',
  'admin.resources.poolEmpty': 'In Ihrem Bestand ist nichts mehr frei.',
  'admin.resources.assign': 'Zuweisen',
  'admin.resources.assign.server': 'Server zuweisen',
  'admin.resources.assign.domain': 'Domain zuweisen',
  'admin.resources.assign.webspace': 'Webspace zuweisen',
  'admin.resources.assignText': 'Wählen Sie aus Ihrem Bestand, was {name} bekommen soll.',
  'admin.resources.fromPool': 'Aus Ihrem Bestand',
  'admin.resources.serverProject': 'Der Server kommt ins erste Projekt des Kunden.',
  'admin.resources.enablesModule': 'Das Modul {module} wird für den Kunden dabei freigeschaltet.',
  'admin.resources.assigned': 'Zugewiesen',
  'admin.resources.release': 'Freigeben',
  'admin.resources.releaseTitle': 'Ressource freigeben?',
  'admin.resources.releaseText':
    '{name} geht zurück in Ihren Bestand. {customer} hat danach keinen Zugriff mehr darauf. Wird die Ressource über einen Dienst verrechnet, kündigen Sie ihn zuerst.',
  'admin.resources.released': 'Freigegeben',

  // Admin: organizations
  'admin.orgs.subtitle': 'Kunden, Reseller und interne Organisationen der Plattform.',
  'admin.orgs.allKinds': 'Alle Arten',
  'admin.orgs.reseller': 'Reseller',
  'admin.orgs.noReseller': 'Kein Reseller (direkt bei weblion.one)',
  'admin.orgs.customerCount': 'Kunden: {n}',
  'admin.orgs.customerOf': 'Kunde von',
  'admin.orgs.newText':
    'Legt eine Organisation mit einem Standard-Projekt an. Optional wird der Owner eingeladen.',
  'admin.orgs.kindHint.customer':
    'Ein Kunde von weblion.one oder, mit Reseller, ein Kunde dieses Resellers. Der Reseller verwaltet und verrechnet ihn.',
  'admin.orgs.kindHint.reseller': 'Ein Reseller verwaltet eigene Kunden und stellt ihnen Rechnungen.',
  'admin.orgs.kindHint.internal': 'Für weblion.one selbst, ohne Abrechnung.',
  'admin.orgs.modulesHint': 'Der Kunde sieht nur diese Module in seiner Console.',
  'admin.orgs.modulesOfReseller': 'Nur Module, die {name} selbst hat.',
  'admin.orgs.resellerNoModules': '{name} hat noch keine Module. Schalte sie zuerst beim Reseller frei.',
  'admin.orgs.ownerAdded': '{email} hat bereits ein Konto und wurde direkt als Owner hinzugefügt.',
  'admin.orgs.modulesText': 'Was die Organisation in ihrer Console sieht und nutzen kann.',
  'admin.orgs.modulesReseller':
    'Was der Reseller selbst nutzen und an seine Kunden weitergeben kann. Ein deaktiviertes Modul verschwindet auch bei seinen Kunden.',
  'admin.orgs.moduleMissing': '{name} hat dieses Modul nicht.',
  'admin.orgs.resellerText': 'Kunden eines Resellers werden von ihm verwaltet und verrechnet.',
  'admin.orgs.resellerSaved': 'Reseller geändert',
  'admin.orgs.moveBillingHint':
    'Ein Wechsel geht nur, wenn beim bisherigen Rechnungssteller kein Guthaben, keine offenen Rechnungen oder Entwürfe, keine ausstehenden Zahlungen und keine aktiven Dienste mehr bestehen.',
  'admin.orgs.moveBlocked': 'Wechsel nicht möglich, beim bisherigen Rechnungssteller ist noch offen:',
  'admin.orgs.moveBlocker.balance': 'Guthaben: {amount}',
  'admin.orgs.moveBlocker.invoices': 'Offene Rechnungen und Entwürfe: {n}',
  'admin.orgs.moveBlocker.payments': 'Ausstehende Zahlungen: {n}',
  'admin.orgs.moveBlocker.services': 'Aktive oder pausierte Dienste: {n}',
  'admin.orgs.moveBlockedHint':
    'Schliessen oder stornieren Sie die Rechnungen, erstatten oder verbrauchen Sie das Guthaben und kündigen Sie die Dienste. Danach kann der neue Rechnungssteller neue Dienste anlegen.',
  'admin.orgs.suspendedByPlatform':
    'Von weblion.one gesperrt. Der Reseller kann diese Sperre nicht aufheben.',
  'admin.orgs.suspendedByReseller':
    'Vom Reseller {name} gesperrt. Entsperren Sie hier, ist auch seine Sperre aufgehoben.',
  'admin.orgs.moveMissing':
    '{name} hat nicht alle Module dieses Kunden. Schalte sie beim Reseller frei oder deaktiviere sie hier zuerst.',
  'admin.orgs.customersOf': 'Kunden dieses Resellers',
  'admin.orgs.customersOfText': 'Organisationen, die der Reseller verwaltet und verrechnet.',
  'admin.orgs.noCustomers': 'Dieser Reseller hat noch keine Kunden.',
  'admin.orgs.boundaryReseller':
    'Was Mitglieder dieses Resellers maximal dürfen. Die Grenze gilt auch für alles, was sie bei ihren Kunden tun.',
  'admin.orgs.kindLocked': 'Ein Reseller mit Kunden kann seine Art nicht ändern.',
  'admin.orgs.kindLockedParent': 'Kunden eines Resellers bleiben Kunden. Entfernen Sie zuerst den Reseller.',
  'admin.orgs.kindTitle': 'Art ändern?',
  'admin.orgs.kindText':
    '{name} wird zu "{kind}". Die Berechtigungsgrenze wird dabei auf den Standard dieser Art zurückgesetzt.',
  'admin.orgs.kindConfirm': 'Art ändern',
  'admin.orgs.deleteText':
    'Nur möglich, wenn keine Kunden, Ressourcen, Rechnungen oder Dienste mehr daran hängen. Mitglieder verlieren den Zugriff.',
  'admin.orgs.billedByReseller': 'Diese Organisation wird von {name} verrechnet.',
  'admin.orgs.openReseller': 'Reseller öffnen',

  // Admin: settings
  'admin.settings.subtitle': 'E-Mail-Versand, Rechnungssteller und angebundene Dienste.',
  'admin.settings.tab.mail': 'E-Mail',
  'admin.settings.tab.billing': 'Abrechnung',
  'admin.settings.tab.integrations': 'Integrationen',
  'admin.mail.title': 'SMTP-Server',
  'admin.mail.text': 'Für Einladungen, Rechnungen, Zahlungsbestätigungen und Guthabenbuchungen.',
  'admin.mail.source.env': 'Aus Umgebungsvariablen',
  'admin.mail.source.ui': 'Hier gespeichert',
  'admin.mail.source.none': 'Nicht eingerichtet',
  'admin.mail.envTitle': 'Eingerichtet über Umgebungsvariablen',
  'admin.mail.envText':
    'Diese Werte kommen aus der .env-Datei und können hier nur angesehen werden. Ändern Sie sie dort und starten Sie die API neu.',
  'admin.mail.noneText':
    'Ohne SMTP-Server werden keine E-Mails versendet. Einladungslinks werden trotzdem angezeigt.',
  'admin.mail.host': 'Server',
  'admin.mail.port': 'Port',
  'admin.mail.portInvalid': 'Zwischen 1 und 65535',
  'admin.mail.secure': 'TLS ab Verbindungsbeginn',
  'admin.mail.secureHint':
    'Für Port 465. Aus für Port 587, dann wird STARTTLS genutzt, wenn der Server es anbietet.',
  'admin.mail.user': 'Benutzername',
  'admin.mail.password': 'Passwort',
  'admin.mail.passwordKeep': 'Unverändert lassen',
  'admin.mail.passwordKeepHint': 'Leer lassen, um das gespeicherte Passwort zu behalten.',
  'admin.mail.passwordClear': 'Gespeichertes Passwort entfernen',
  'admin.mail.passwordSet': 'Gesetzt',
  'admin.mail.passwordNotSet': 'Nicht gesetzt',
  'admin.mail.from': 'Absender',
  'admin.mail.fromHint': 'Zum Beispiel: weblion.one <noreply@weblion.one>',
  'admin.mail.replyTo': 'Antwort an',
  'admin.mail.saved': 'E-Mail-Einstellungen gespeichert',
  'admin.mail.remove': 'Einstellungen entfernen',
  'admin.mail.removeTitle': 'SMTP-Einstellungen entfernen?',
  'admin.mail.removeText':
    'Danach werden keine E-Mails mehr versendet, bis wieder ein Server eingerichtet ist.',
  'admin.mail.removed': 'SMTP-Einstellungen entfernt',
  'admin.mail.test': 'Test-Mail',
  'admin.mail.testText': 'Prüft, ob der Versand mit den gespeicherten Einstellungen klappt.',
  'admin.mail.testTo': 'Empfänger',
  'admin.mail.testSend': 'Test-Mail senden',
  'admin.mail.testSent': 'Test-Mail an {to} gesendet. Schauen Sie im Postfach nach.',
  'admin.mail.testFailed': 'Versand fehlgeschlagen',
  'admin.mail.testSkipped': 'Nicht gesendet, weil kein SMTP-Server eingerichtet ist.',
  'admin.mail.testNotConfigured': 'Richten Sie zuerst einen SMTP-Server ein.',
  'admin.mail.log': 'Versandprotokoll',
  'admin.mail.logText': 'Jede E-Mail der Plattform, auch die nicht gesendeten.',
  'admin.mail.logEmpty': 'Noch keine E-Mails',
  'admin.mail.allStatuses': 'Alle Status',
  'admin.mail.status.sent': 'Gesendet',
  'admin.mail.status.failed': 'Fehlgeschlagen',
  'admin.mail.status.skipped': 'Nicht gesendet',
  'admin.mail.col.time': 'Zeit',
  'admin.mail.col.to': 'Empfänger',
  'admin.mail.col.subject': 'Betreff',
  'admin.mail.count': 'E-Mails: {n}',
  'admin.mail.template.invitation': 'Einladung',
  'admin.mail.template.invoice': 'Rechnung',
  'admin.mail.template.invoice_reminder': 'Zahlungserinnerung',
  'admin.mail.template.payment_received': 'Zahlungseingang',
  'admin.mail.template.credit_booked': 'Guthabenbuchung',
  'admin.mail.template.test': 'Test',

  // Admin: integrations
  'admin.int.intro':
    'Zugangsdaten für Stripe und Zoho Books werden nur über Umgebungsvariablen gesetzt, nicht hier. Nach einer Änderung in der .env-Datei die API neu starten.',
  'admin.int.configured': 'Eingerichtet',
  'admin.int.notConfigured': 'Nicht eingerichtet',
  'admin.int.env': 'Umgebungsvariablen',
  'admin.int.source': 'Quelle',
  'admin.int.active': 'Aktiv',
  'admin.int.inactive': 'Nicht aktiv',
  'admin.int.never': 'Noch nie',
  'admin.int.smtp': 'E-Mail (SMTP)',
  'admin.int.smtpText': 'Versand von Einladungen, Rechnungen und Bestätigungen.',
  'admin.int.smtpOpen': 'E-Mail-Einstellungen öffnen',
  'admin.int.smtpEnvHint':
    'Ist SMTP_HOST gesetzt, gelten diese Werte statt der Einstellungen im Admin-Bereich.',
  'admin.int.stripeText': 'Online-Zahlungen mit Karte und TWINT für Rechnungen und Guthaben.',
  'admin.int.mode': 'Modus',
  'admin.int.mode.live': 'Live',
  'admin.int.mode.test': 'Test',
  'admin.int.webhook': 'Webhook',
  'admin.int.webhookSet': 'Eingerichtet',
  'admin.int.webhookMissing': 'Fehlt',
  'admin.int.webhookWarning':
    'Ohne Webhook-Secret werden Zahlungen nicht bestätigt. Tragen Sie den Endpoint in Stripe ein und setzen Sie STRIPE_WEBHOOK_SECRET.',
  'admin.int.webhookUrl': 'Webhook-URL',
  'admin.int.webhookHint':
    'In Stripe unter Entwickler > Webhooks als Endpoint eintragen, mit diesen Ereignissen:',
  'admin.int.stripeEnvHint':
    'STRIPE_PAYMENT_METHODS listet die Zahlarten, Standard ist card,twint. TWINT muss in Stripe aktiviert sein.',
  'admin.int.zohoText': 'Buchhaltung: Kontakte, Rechnungen und Zahlungen der Plattform werden übertragen.',
  'admin.int.zohoOrg': 'Organisation',
  'admin.int.lastSync': 'Letzte Übertragung',
  'admin.int.lastError': 'Letzter Fehler',
  'admin.int.zohoTest': 'Verbindung testen',
  'admin.int.zohoSync': 'Ausstehende synchronisieren',
  'admin.int.zohoSynced': '{synced} übertragen, {failed} fehlgeschlagen',
  'admin.int.zohoOk': 'Verbindung klappt: {name}',
  'admin.int.zohoOkPlain': 'Verbindung klappt.',
  'admin.int.zohoFailed': 'Verbindung fehlgeschlagen',
  'admin.int.zohoEnvHint':
    'ZOHO_TAX_IDS ordnet Steuersätze den Steuer-IDs in Zoho zu, zum Beispiel 810:123456,0:654321 (Satz in Basispunkten).',

  // Dashboard
  'admin.dash.subtitle': 'Ihre Dienste, die Abrechnung und die letzten Aktivitäten.',
  'admin.dash.serversSub': '{running} laufend, {stopped} gestoppt',
  'admin.dash.noDomains': 'Noch keine Domains',
  'admin.dash.noWebspaces': 'Noch keine Webspaces',
  'admin.dash.openInvoices': 'Offene Rechnungen: {n}',
  'admin.dash.overdue': '{amount} sind überfällig.',
  'admin.dash.recurring': 'Aktive Dienste: {n}, zusammen {amount} pro Monat',
  'admin.dash.seller': 'Rechnungen von {name}',
  'admin.dash.viaReseller': 'Sie verwalten diese Organisation als Reseller über {name}.',
  'admin.dash.backToReseller': 'Zur Kundenverwaltung',
  'admin.dash.noModules': 'Noch keine Dienste freigeschaltet',
  'admin.dash.noModulesText': 'Sobald ein Modul freigeschaltet ist, erscheint es hier und in der Navigation.',
} as const;
