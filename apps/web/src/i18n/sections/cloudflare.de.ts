/**
 * Cloudflare (DNS-Zonen und CDN): Provider-Formular, Domain-Seiten (Zone, Proxy, CDN,
 * DNS-Umzug) und API Explorer.
 */
export const cloudflareDe = {
  // Provider form
  'providers.cloudflare.help':
    'Erstellen Sie im Cloudflare-Dashboard unter Mein Profil > API-Tokens ein eigenes Token (nicht den Global API Key) für alle Zonen des Kontos. Cloudflare erlaubt 1200 API-Anfragen pro 5 Minuten und Benutzer: Ein eigener Cloudflare-Benutzer für die Console ist am besten.',
  'providers.cloudflare.token': 'API-Token',
  'providers.cloudflare.tokenHint':
    'API-Tokens > Token erstellen > Benutzerdefiniertes Token, Zonenressourcen "Alle Zonen eines Kontos".',
  'providers.cloudflare.permissions': 'Benötigte Berechtigungen: {permissions}',
  'providers.cloudflare.accountId': 'Konto-ID',
  'providers.cloudflare.accountIdHint':
    'Optional, auf der Startseite des Kontos im Dashboard. Nötig, um Zonen anzulegen (DNS-Umzug zu Cloudflare), und beschränkt die Zonenliste auf dieses Konto.',
  'providers.cloudflare.accountIdInvalid': 'Die Konto-ID besteht aus 32 Zeichen (0-9, a-f).',
  'providers.cloudflare.baseUrl': 'API Base URL',
  'providers.cloudflare.baseUrlHint': 'Standard: {url}',
  'providers.cloudflare.zones': 'DNS-Zonen',
  'providers.cloudflare.zonesText':
    'DNS-Zonen dieses Kontos und ihre Zuweisung an Kunden. Neue Zonen erscheinen nach dem nächsten Abgleich.',
  'providers.cloudflare.toZones': 'Zu den Zonen',

  // Kind and zone status
  'hosting.kind.zone': 'DNS-Zone',
  'hosting.kind.registration': 'Registrierung',
  'hosting.zone.status.active': 'Aktiv',
  'hosting.zone.status.pending': 'Wartet auf Nameserver',
  'hosting.zone.status.initializing': 'Wird eingerichtet',
  'hosting.zone.status.moved': 'Nameserver umgezogen',
  'hosting.zone.hostedAt': 'DNS-Zone bei {provider}',
  'hosting.zone.noExpiry':
    'Eine DNS-Zone läuft nicht ab. Das Ablaufdatum steht bei der Registrierung der Domain.',

  // Zone overview
  'hosting.zone.title': 'Zone und Nameserver',
  'hosting.zone.text': 'Diese Nameserver hat {provider} der Zone zugeteilt.',
  'hosting.zone.pendingTitle': 'Die Zone wartet auf die Nameserver',
  'hosting.zone.pendingText':
    '{provider} aktiviert die Zone, sobald die Domain auf die zugeteilten Nameserver zeigt. Bis dahin gelten die Einträge bei den bisherigen Nameservern.',
  'hosting.zone.nameserversToSet': 'Setzen Sie beim Registrar diese Nameserver:',
  'hosting.zone.copyAll': 'Alle kopieren',
  'hosting.zone.copied': 'Kopiert',
  'hosting.zone.originalNameservers': 'Bisherige Nameserver',
  'hosting.zone.originalRegistrar': 'Bisheriger Registrar',
  'hosting.zone.createdAt': 'Angelegt am',
  'hosting.zone.activatedAt': 'Aktiviert am',
  'hosting.zone.type': 'Zonentyp',
  'hosting.zone.type.full': 'Vollständig',
  'hosting.zone.type.partial': 'Teilweise (CNAME-Setup)',
  'hosting.zone.type.secondary': 'Sekundär (nur lesen)',
  'hosting.zone.plan': 'Tarif',
  'hosting.zone.paused': 'Zone pausiert',
  'hosting.zone.pausedText':
    '{provider} beantwortet nur noch DNS-Anfragen. Proxy und CDN sind für diese Zone ausgeschaltet.',
  'hosting.zone.movedText':
    'Die Domain zeigt nicht mehr auf die Nameserver von {provider}. Die Einträge dieser Zone gelten nicht mehr, und {provider} löscht die Zone nach einiger Zeit.',
  'hosting.zone.checkActivation': 'Aktivierung jetzt prüfen',
  'hosting.zone.checkActivationHint':
    '{provider} prüft die Nameserver ohnehin regelmässig. Im kostenlosen Tarif ist eine Prüfung von Hand höchstens einmal pro Stunde möglich.',
  'hosting.zone.checkActivationDone':
    'Prüfung angefordert. Die Zone wird aktiv, sobald {provider} die neuen Nameserver sieht.',
  'hosting.zone.nsMatch':
    'Die Registrierung zeigt bereits auf diese Nameserver. Die Zone wird aktiv, sobald {provider} die Änderung sieht.',
  'hosting.zone.registrationTitle': 'Registrierung',
  'hosting.zone.registrationText':
    'Die Domain ist bei {registrar} registriert. Dort legen Sie die Nameserver fest.',
  'hosting.zone.registrar': 'Registrar',
  'hosting.zone.delegation': 'Nameserver beim Registrar',
  'hosting.zone.delegationOk': 'Zeigt auf diese Zone',
  'hosting.zone.delegationOther': 'Zeigt nicht auf diese Zone',
  'hosting.zone.openRegistration': 'Zur Domain bei {registrar}',
  'hosting.zone.dnsPendingTitle': 'Die Zone ist noch nicht aktiv',
  'hosting.zone.dnsPendingText':
    'Sie können die Einträge schon vorbereiten. Sie gelten, sobald die Domain auf die Nameserver von {provider} zeigt.',

  // Registration with a zone of the same name
  'hosting.dnsZone.title': 'DNS bei {provider}',
  'hosting.dnsZone.text':
    'Die DNS-Einträge von {name} verwaltet die Zone bei {provider}. Die Einträge beim Registrar unten sind nicht aktiv.',
  'hosting.dnsZone.notActive':
    'Für {name} gibt es eine Zone bei {provider} ({status}). Die Domain zeigt aber noch nicht auf deren Nameserver.',
  'hosting.dnsZone.open': 'Zur DNS-Zone',
  'hosting.dnsZone.otherOrg':
    'Die Zone gehört zu einer anderen Organisation. Wenden Sie sich an deren Owner oder an den Support.',
  'hosting.dnsZone.prepared':
    'Eine Zone bei {provider} ist vorbereitet ({status}). Bis die Domain auf die Nameserver von {provider} zeigt, gelten die Einträge hier.',
  'hosting.dnsZone.nsLine': 'DNS-Zone bei {provider}: {status}',
  'hosting.dnsZone.preset': 'Nameserver der Zone bei {provider}',
  'hosting.dnsZone.presetHint': '{list}. Nötig, damit die DNS-Einträge der Zone bei {provider} gelten.',

  // DNS records: proxy, automatic TTL, comments
  'hosting.dns.proxy.column': 'Proxy',
  'hosting.dns.proxy.on': 'Über Proxy',
  'hosting.dns.proxy.off': 'Nur DNS',
  'hosting.dns.proxy.onHint':
    'Der Verkehr läuft über {provider} (CDN und Schutz). Die Adresse Ihres Servers bleibt verborgen.',
  'hosting.dns.proxy.offHint': 'Nur DNS: Die Adresse wird direkt herausgegeben, ohne Proxy und CDN.',
  'hosting.dns.proxy.turnOn': 'Proxy einschalten',
  'hosting.dns.proxy.turnOff': 'Proxy ausschalten',
  'hosting.dns.proxy.label': 'Über Cloudflare leiten (Proxy)',
  'hosting.dns.proxy.hint':
    'Besucher erreichen den Server über Cloudflare mit CDN, Schutz und HTTPS. Die TTL ist dann automatisch.',
  'hosting.dns.proxy.notProxiable':
    'Cloudflare kann diesen Eintrag nicht über den Proxy leiten, z. B. weil er auf eine private Adresse zeigt.',
  'hosting.dns.proxy.toggledOn': 'Proxy für {name} eingeschaltet',
  'hosting.dns.proxy.toggledOff': 'Proxy für {name} ausgeschaltet',
  'hosting.dns.ttlAuto': 'Automatisch',
  'hosting.dns.cnameFlattening':
    'Erlaubt: {provider} gibt für die Domain selbst die Adressen des Ziels heraus (CNAME-Flattening).',
  'hosting.dns.comment': 'Notiz',

  // CDN
  'hosting.cdn.tab': 'CDN',
  'hosting.cdn.notActive':
    'Die Zone ist noch nicht aktiv. Die Einstellungen wirken erst, wenn die Domain auf die Nameserver von {provider} zeigt.',
  'hosting.cdn.noProxied':
    'CDN-Einstellungen wirken nur für Einträge mit Proxy. Zurzeit leitet kein Eintrag über {provider}. Den Proxy schalten Sie im Tab "DNS" ein.',
  'hosting.cdn.readOnly':
    'Sie können die Einstellungen ansehen. Zum Ändern fehlt Ihnen die Berechtigung "Nameserver, Transfersperre und CDN-Einstellungen ändern".',
  'hosting.cdn.notEditable': 'Der Tarif der Zone erlaubt diese Änderung nicht.',
  'hosting.cdn.saved': 'CDN-Einstellung gespeichert',
  'hosting.cdn.ssl.title': 'SSL/TLS',
  'hosting.cdn.ssl.text': 'Wie {provider} die Verbindungen zu Besuchern und zu Ihrem Server verschlüsselt.',
  'hosting.cdn.ssl.label': 'Verschlüsselungsmodus',
  'hosting.cdn.ssl.effective': 'Zurzeit verwendet {provider}: {mode}',
  'hosting.cdn.ssl.propagation': 'Eine Änderung kann bis zu 5 Minuten dauern, bis sie überall gilt.',
  'hosting.cdn.ssl.mode.auto': 'Automatisch (empfohlen)',
  'hosting.cdn.ssl.mode.off': 'Aus',
  'hosting.cdn.ssl.mode.flexible': 'Flexibel',
  'hosting.cdn.ssl.mode.full': 'Vollständig',
  'hosting.cdn.ssl.mode.strict': 'Vollständig (streng)',
  'hosting.cdn.ssl.desc.auto':
    '{provider} prüft Ihren Server und wählt den sichersten Modus, der funktioniert. Den Modus kann {provider} später selbst erhöhen.',
  'hosting.cdn.ssl.desc.off':
    'Keine Verschlüsselung. Besucher erreichen die Website nur über HTTP, Browser warnen davor.',
  'hosting.cdn.ssl.desc.flexible':
    'Verschlüsselt zwischen Besuchern und {provider}, aber unverschlüsselt bis zu Ihrem Server. Leitet der Server selbst auf HTTPS um, entsteht eine Weiterleitungsschleife.',
  'hosting.cdn.ssl.desc.full':
    'Verschlüsselt bis zu Ihrem Server. Das Zertifikat des Servers wird nicht geprüft, ein selbst signiertes genügt.',
  'hosting.cdn.ssl.desc.strict':
    "Verschlüsselt bis zu Ihrem Server, der ein gültiges Zertifikat braucht (z. B. von Let's Encrypt). Am sichersten.",
  'hosting.cdn.ssl.confirmTitle': 'SSL/TLS auf "{mode}" stellen?',
  'hosting.cdn.ssl.confirmText':
    'Mit diesem Modus ist die Verbindung zu Ihrem Server nicht verschlüsselt. Daten wie Passwörter lassen sich unterwegs mitlesen. Wählen Sie ihn nur, wenn Ihr Server kein HTTPS kann.',
  'hosting.cdn.https.title': 'HTTPS',
  'hosting.cdn.https.label': 'Immer HTTPS verwenden',
  'hosting.cdn.https.hint': 'Leitet alle Anfragen über HTTP auf HTTPS um.',
  'hosting.cdn.dev.title': 'Entwicklungsmodus',
  'hosting.cdn.dev.label': 'Cache vorübergehend umgehen',
  'hosting.cdn.dev.hint':
    'Änderungen an der Website sind sofort sichtbar, weil {provider} nichts zwischenspeichert. Der Modus schaltet sich nach 3 Stunden selbst ab.',
  'hosting.cdn.dev.remaining': 'Aktiv, schaltet sich in {time} ab.',
  'hosting.cdn.purge.title': 'Cache',
  'hosting.cdn.purge.text':
    '{provider} speichert Dateien Ihrer Website zwischen. Nach einem Update leeren Sie den Cache, damit Besucher die neue Version sehen.',
  'hosting.cdn.purge.button': 'Gesamten Cache leeren',
  'hosting.cdn.purge.confirmTitle': 'Gesamten Cache von {name} leeren?',
  'hosting.cdn.purge.confirmText':
    'Danach holt {provider} jede Datei neu von Ihrem Server. Das kann den Server kurzzeitig stärker belasten.',
  'hosting.cdn.purge.done': 'Cache wird geleert. Das dauert in der Regel nur wenige Sekunden.',
  'hosting.cdn.purge.wait': 'Der Cache wurde eben geleert. Sie können ihn in 30 Sekunden wieder leeren.',

  // DNS move (platform staff)
  'hosting.dnsMove.action': 'DNS zu Cloudflare umziehen',
  'hosting.dnsMove.cardTitle': 'DNS zu Cloudflare umziehen',
  'hosting.dnsMove.cardText':
    'Legt eine Zone bei Cloudflare an, kopiert die DNS-Einträge vom Registrar und stellt auf Wunsch die Nameserver um.',
  'hosting.dnsMove.title': 'DNS von {name} zu Cloudflare umziehen',
  'hosting.dnsMove.intro':
    'Die Console legt die Zone an oder verwendet eine bestehende, kopiert die Einträge und stellt die Nameserver erst um, wenn alle Einträge übernommen sind. Jeder Schritt wird im Audit-Log festgehalten.',
  'hosting.dnsMove.target': 'Cloudflare-Konto',
  'hosting.dnsMove.noTargets':
    'Keine Cloudflare-Verbindung mit Konto-ID. Tragen Sie bei einer Cloudflare-Verbindung unter "Provider" die Konto-ID ein, damit die Console Zonen anlegen kann.',
  'hosting.dnsMove.existingZone':
    'Für {name} gibt es bereits eine Zone bei {provider} ({status}). Liegt sie im gewählten Konto, wird sie verwendet statt neu angelegt.',
  'hosting.dnsMove.import.label': 'Einträge vom Registrar übernehmen ({n})',
  'hosting.dnsMove.import.hint':
    'Kopiert die Einträge in die neue Zone. Kopierte Einträge laufen nicht über den Proxy, am Verkehr ändert sich also nichts.',
  'hosting.dnsMove.import.unavailable':
    'Nicht möglich: Die Domain nutzt nicht die Nameserver des Registrars, seine Einträge sind deshalb nicht die gültigen.',
  'hosting.dnsMove.import.error': 'Die Einträge beim Registrar konnten nicht gelesen werden:',
  'hosting.dnsMove.import.tooMany':
    'Nicht möglich: Mehr als {max} Einträge. Importieren Sie die Zone im Cloudflare-Dashboard.',
  'hosting.dnsMove.import.zoneNotEmpty': 'In eine Zone, die schon Einträge hat, kopiert die Console nichts.',
  'hosting.dnsMove.planned': 'Werden kopiert ({n})',
  'hosting.dnsMove.converted': 'Angepasst ({n})',
  'hosting.dnsMove.convertedType': '{from} wird zu {to}',
  'hosting.dnsMove.ttlChanged': 'TTL {from} wird zu {to}',
  'hosting.dnsMove.skipped.title': 'Nicht übernommen ({n})',
  'hosting.dnsMove.skipped.reason.type': 'Typ gibt es bei Cloudflare nicht',
  'hosting.dnsMove.skipped.reason.readOnly': 'Nur lesen',
  'hosting.dnsMove.skipped.reason.apexNs': 'Nameserver der Domain, setzt Cloudflare selbst',
  'hosting.dnsMove.ns.label': 'Nameserver beim Registrar umstellen',
  'hosting.dnsMove.ns.hint':
    'Stellt die Domain auf die Nameserver der Zone um, sobald alle Einträge kopiert sind. Ab dann gelten die Einträge bei Cloudflare.',
  'hosting.dnsMove.ns.unsupported':
    'Nicht möglich: Der Registrar unterstützt das Umstellen über die Console nicht. Sie setzen die Nameserver danach von Hand.',
  'hosting.dnsMove.ns.requiresImport': 'Nur nach vollständiger Übernahme der Einträge möglich.',
  'hosting.dnsMove.warning':
    'Nach der Umstellung beantworten die Nameserver von Cloudflare alle DNS-Anfragen der Domain. Prüfen Sie die Listen: Was nicht übernommen wird, fehlt danach.',
  'hosting.dnsMove.submit': 'Umzug starten',
  'hosting.dnsMove.result.title': 'Ergebnis des Umzugs',
  'hosting.dnsMove.result.zoneCreated': 'Zone angelegt',
  'hosting.dnsMove.result.zoneReused': 'Bestehende Zone verwendet',
  'hosting.dnsMove.result.import.done': '{n} Einträge kopiert',
  'hosting.dnsMove.result.import.partial': '{n} Einträge kopiert, {failed} fehlgeschlagen',
  'hosting.dnsMove.result.import.skipped': 'Keine Einträge kopiert',
  'hosting.dnsMove.result.import.failed': 'Einträge konnten nicht kopiert werden',
  'hosting.dnsMove.result.import.reason.notRequested': 'Nicht ausgewählt.',
  'hosting.dnsMove.result.import.reason.registrarNotServing':
    'Die Domain nutzt nicht die Nameserver des Registrars.',
  'hosting.dnsMove.result.import.reason.zoneNotEmpty':
    'Die Zone hat bereits Einträge. Die Console kopiert nichts dazu.',
  'hosting.dnsMove.result.import.reason.tooManyRecords': 'Zu viele Einträge für den Umzug über die Console.',
  'hosting.dnsMove.result.import.reason.recordsUnreadable':
    'Die Einträge beim Registrar konnten nicht gelesen werden.',
  'hosting.dnsMove.result.ns.done': 'Nameserver beim Registrar umgestellt',
  'hosting.dnsMove.result.ns.skipped': 'Nameserver nicht umgestellt',
  'hosting.dnsMove.result.ns.failed': 'Nameserver konnten nicht umgestellt werden',
  'hosting.dnsMove.result.ns.manual': 'Nameserver von Hand setzen',
  'hosting.dnsMove.result.ns.reason.notRequested':
    'Nicht ausgewählt. Setzen Sie diese Nameserver beim Registrar, sobald die Zone vollständig ist:',
  'hosting.dnsMove.result.ns.reason.importIncomplete':
    'Nicht alle Einträge wurden kopiert. Ergänzen Sie die Zone und stellen Sie danach in der Übersicht der Domain diese Nameserver ein:',
  'hosting.dnsMove.result.ns.reason.unsupported':
    'Der Registrar unterstützt das über die Console nicht. Setzen Sie diese Nameserver bei ihm von Hand:',
  'hosting.dnsMove.result.openZone': 'Zur Zone',

  // API explorer
  'explorer.cloudflarePath':
    'Pfade relativ zu /client/v4, z.B. /zones/<zone_id>/dns_records. Geheimnisse in Antworten werden ausgeblendet, API-Tokens lassen sich hier nicht verwalten.',
} as const;
