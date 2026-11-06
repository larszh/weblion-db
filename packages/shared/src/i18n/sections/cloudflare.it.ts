import type { cloudflareDe } from './cloudflare.de';

export const cloudflareIt: Partial<Record<keyof typeof cloudflareDe, string>> = {
  'providers.cloudflare.help':
    "Nel dashboard di Cloudflare, alla voce Il mio profilo > Token API, crei un token dedicato (non la Global API Key) per tutte le zone dell'account. Cloudflare consente 1200 richieste API ogni 5 minuti per utente: l'ideale è un utente Cloudflare riservato alla console.",
  'providers.cloudflare.token': 'Token API',
  'providers.cloudflare.tokenHint':
    'Token API > Crea token > Token personalizzato, risorse della zona "Tutte le zone di un account".',
  'providers.cloudflare.permissions': 'Autorizzazioni necessarie: {permissions}',
  'providers.cloudflare.accountId': 'ID account',
  'providers.cloudflare.accountIdHint':
    "Facoltativo, si trova nella pagina iniziale dell'account nel dashboard. Necessario per creare zone (migrazione del DNS su Cloudflare); limita inoltre l'elenco delle zone a questo account.",
  'providers.cloudflare.accountIdInvalid': "L'ID account è composto da 32 caratteri (0-9, a-f).",
  'providers.cloudflare.baseUrl': "URL di base dell'API",
  'providers.cloudflare.baseUrlHint': 'Predefinito: {url}',
  'providers.cloudflare.zones': 'Zone DNS',
  'providers.cloudflare.zonesText':
    'Zone DNS di questo account e la loro assegnazione ai clienti. Le nuove zone appaiono dopo la prossima sincronizzazione.',
  'providers.cloudflare.toZones': 'Vai alle zone',
  'hosting.kind.zone': 'Zona DNS',
  'hosting.kind.registration': 'Registrazione',
  'hosting.zone.status.active': 'Attiva',
  'hosting.zone.status.pending': 'In attesa dei nameserver',
  'hosting.zone.status.initializing': 'Configurazione in corso',
  'hosting.zone.status.moved': 'Nameserver cambiati',
  'hosting.zone.hostedAt': 'Zona DNS presso {provider}',
  'hosting.zone.noExpiry':
    'Una zona DNS non scade. La data di scadenza figura nella registrazione del dominio.',
  'hosting.zone.title': 'Zona e nameserver',
  'hosting.zone.text': 'Questi nameserver sono stati assegnati alla zona da {provider}.',
  'hosting.zone.pendingTitle': 'La zona è in attesa dei nameserver',
  'hosting.zone.pendingText':
    '{provider} attiva la zona non appena il dominio punta ai nameserver assegnati. Fino ad allora valgono i record presso i nameserver precedenti.',
  'hosting.zone.nameserversToSet': 'Imposti presso il registrar questi nameserver:',
  'hosting.zone.copyAll': 'Copia tutti',
  'hosting.zone.copied': 'Copiato',
  'hosting.zone.originalNameservers': 'Nameserver precedenti',
  'hosting.zone.originalRegistrar': 'Registrar precedente',
  'hosting.zone.createdAt': 'Creata il',
  'hosting.zone.activatedAt': 'Attivata il',
  'hosting.zone.type': 'Tipo di zona',
  'hosting.zone.type.full': 'Completa',
  'hosting.zone.type.partial': 'Parziale (configurazione CNAME)',
  'hosting.zone.type.secondary': 'Secondaria (sola lettura)',
  'hosting.zone.plan': 'Piano',
  'hosting.zone.paused': 'Zona in pausa',
  'hosting.zone.pausedText':
    '{provider} risponde ormai solo alle richieste DNS. Proxy e CDN sono disattivati per questa zona.',
  'hosting.zone.movedText':
    'Il dominio non punta più ai nameserver di {provider}. I record di questa zona non sono più validi e {provider} eliminerà la zona dopo qualche tempo.',
  'hosting.zone.checkActivation': 'Verifica attivazione ora',
  'hosting.zone.checkActivationHint':
    "{provider} verifica comunque i nameserver a intervalli regolari. Nel piano gratuito è possibile una verifica manuale al massimo una volta all'ora.",
  'hosting.zone.checkActivationDone':
    'Verifica richiesta. La zona diventa attiva non appena {provider} vede i nuovi nameserver.',
  'hosting.zone.nsMatch':
    'La registrazione punta già a questi nameserver. La zona diventa attiva non appena {provider} rileva la modifica.',
  'hosting.zone.registrationTitle': 'Registrazione',
  'hosting.zone.registrationText':
    'Il dominio è registrato presso {registrar}. È lì che si impostano i nameserver.',
  'hosting.zone.registrar': 'Registrar',
  'hosting.zone.delegation': 'Nameserver presso il registrar',
  'hosting.zone.delegationOk': 'Punta a questa zona',
  'hosting.zone.delegationOther': 'Non punta a questa zona',
  'hosting.zone.openRegistration': 'Vai al dominio presso {registrar}',
  'hosting.zone.dnsPendingTitle': 'La zona non è ancora attiva',
  'hosting.zone.dnsPendingText':
    'Può già preparare i record. Saranno validi non appena il dominio punterà ai nameserver di {provider}.',
  'hosting.dnsZone.title': 'DNS presso {provider}',
  'hosting.dnsZone.text':
    'I record DNS di {name} sono gestiti dalla zona presso {provider}. I record presso il registrar qui sotto non sono attivi.',
  'hosting.dnsZone.notActive':
    'Per {name} esiste una zona presso {provider} ({status}). Il dominio però non punta ancora ai relativi nameserver.',
  'hosting.dnsZone.open': 'Vai alla zona DNS',
  'hosting.dnsZone.otherOrg':
    "La zona appartiene a un'altra organizzazione. Si rivolga al proprietario di quell'organizzazione o al supporto.",
  'hosting.dnsZone.prepared':
    'Una zona presso {provider} è stata preparata ({status}). Finché il dominio non punterà ai nameserver di {provider}, valgono i record riportati qui.',
  'hosting.dnsZone.nsLine': 'Zona DNS presso {provider}: {status}',
  'hosting.dnsZone.preset': 'Nameserver della zona presso {provider}',
  'hosting.dnsZone.presetHint':
    '{list}. Necessari affinché i record DNS della zona presso {provider} siano validi.',
  'hosting.dns.proxy.column': 'Proxy',
  'hosting.dns.proxy.on': 'Tramite proxy',
  'hosting.dns.proxy.off': 'Solo DNS',
  'hosting.dns.proxy.onHint':
    "Il traffico passa da {provider} (CDN e protezione). L'indirizzo del suo server resta nascosto.",
  'hosting.dns.proxy.offHint': "Solo DNS: l'indirizzo viene comunicato direttamente, senza proxy e CDN.",
  'hosting.dns.proxy.turnOn': 'Attiva proxy',
  'hosting.dns.proxy.turnOff': 'Disattiva proxy',
  'hosting.dns.proxy.label': 'Instrada tramite Cloudflare (proxy)',
  'hosting.dns.proxy.hint':
    'I visitatori raggiungono il server tramite Cloudflare con CDN, protezione e HTTPS. Il TTL diventa quindi automatico.',
  'hosting.dns.proxy.notProxiable':
    'Cloudflare non può instradare questo record tramite il proxy, ad es. perché punta a un indirizzo privato.',
  'hosting.dns.proxy.toggledOn': 'Proxy attivato per {name}',
  'hosting.dns.proxy.toggledOff': 'Proxy disattivato per {name}',
  'hosting.dns.ttlAuto': 'Automatico',
  'hosting.dns.cnameFlattening':
    'Consentito: per il dominio stesso {provider} restituisce gli indirizzi della destinazione (CNAME flattening).',
  'hosting.dns.comment': 'Nota',
  'hosting.cdn.tab': 'CDN',
  'hosting.cdn.notActive':
    'La zona non è ancora attiva. Le impostazioni hanno effetto solo quando il dominio punta ai nameserver di {provider}.',
  'hosting.cdn.noProxied':
    'Le impostazioni CDN hanno effetto solo sui record con proxy. Al momento nessun record passa da {provider}. Il proxy si attiva nella scheda "DNS".',
  'hosting.cdn.readOnly':
    'Può visualizzare le impostazioni. Per modificarle le manca l\'autorizzazione "Modificare nameserver, blocco del trasferimento e impostazioni CDN".',
  'hosting.cdn.notEditable': 'Il piano della zona non consente questa modifica.',
  'hosting.cdn.saved': 'Impostazione CDN salvata',
  'hosting.cdn.ssl.title': 'SSL/TLS',
  'hosting.cdn.ssl.text': 'Come {provider} cifra le connessioni con i visitatori e con il suo server.',
  'hosting.cdn.ssl.label': 'Modalità di crittografia',
  'hosting.cdn.ssl.effective': 'Attualmente {provider} usa: {mode}',
  'hosting.cdn.ssl.propagation':
    'Possono trascorrere fino a 5 minuti prima che una modifica sia valida ovunque.',
  'hosting.cdn.ssl.mode.auto': 'Automatica (consigliata)',
  'hosting.cdn.ssl.mode.off': 'Disattivata',
  'hosting.cdn.ssl.mode.flexible': 'Flessibile',
  'hosting.cdn.ssl.mode.full': 'Completa',
  'hosting.cdn.ssl.mode.strict': 'Completa (rigorosa)',
  'hosting.cdn.ssl.desc.auto':
    '{provider} verifica il suo server e sceglie la modalità più sicura che funziona. In seguito {provider} può innalzare autonomamente la modalità.',
  'hosting.cdn.ssl.desc.off':
    'Nessuna crittografia. I visitatori raggiungono il sito web solo tramite HTTP e i browser lo segnalano come non sicuro.',
  'hosting.cdn.ssl.desc.flexible':
    'Cifrata tra i visitatori e {provider}, ma non cifrata fino al suo server. Se il server stesso reindirizza a HTTPS, si crea un ciclo di reindirizzamento.',
  'hosting.cdn.ssl.desc.full':
    'Cifrata fino al suo server. Il certificato del server non viene verificato: basta uno autofirmato.',
  'hosting.cdn.ssl.desc.strict':
    "Cifrata fino al suo server, che necessita di un certificato valido (ad es. di Let's Encrypt). La più sicura.",
  'hosting.cdn.ssl.confirmTitle': 'Impostare SSL/TLS su "{mode}"?',
  'hosting.cdn.ssl.confirmText':
    'Con questa modalità la connessione al suo server non è cifrata. Dati come le password possono essere intercettati lungo il percorso. La scelga solo se il suo server non supporta HTTPS.',
  'hosting.cdn.https.title': 'HTTPS',
  'hosting.cdn.https.label': 'Usa sempre HTTPS',
  'hosting.cdn.https.hint': 'Reindirizza a HTTPS tutte le richieste HTTP.',
  'hosting.cdn.dev.title': 'Modalità sviluppo',
  'hosting.cdn.dev.label': 'Ignora temporaneamente la cache',
  'hosting.cdn.dev.hint':
    'Le modifiche al sito web sono subito visibili, perché {provider} non memorizza nulla nella cache. La modalità si disattiva da sola dopo 3 ore.',
  'hosting.cdn.dev.remaining': 'Attiva, si disattiva tra {time}.',
  'hosting.cdn.purge.title': 'Cache',
  'hosting.cdn.purge.text':
    '{provider} memorizza nella cache i file del suo sito web. Dopo un aggiornamento svuoti la cache, affinché i visitatori vedano la nuova versione.',
  'hosting.cdn.purge.button': 'Svuota tutta la cache',
  'hosting.cdn.purge.confirmTitle': 'Svuotare tutta la cache di {name}?',
  'hosting.cdn.purge.confirmText':
    'In seguito {provider} recupera di nuovo ogni file dal suo server. Ciò può aumentare brevemente il carico del server.',
  'hosting.cdn.purge.done': 'Svuotamento della cache in corso. Di norma richiede solo pochi secondi.',
  'hosting.cdn.purge.wait': 'La cache è appena stata svuotata. Potrà svuotarla di nuovo tra 30 secondi.',
  'hosting.dnsMove.action': 'Migra il DNS su Cloudflare',
  'hosting.dnsMove.cardTitle': 'Migrare il DNS su Cloudflare',
  'hosting.dnsMove.cardText':
    'Crea una zona presso Cloudflare, copia i record DNS dal registrar e, se richiesto, cambia i nameserver.',
  'hosting.dnsMove.title': 'Migrare il DNS di {name} su Cloudflare',
  'hosting.dnsMove.intro':
    'La console crea la zona o ne usa una esistente, copia i record e cambia i nameserver solo quando tutti i record sono stati importati. Ogni passaggio viene annotato nel registro di audit.',
  'hosting.dnsMove.target': 'Account Cloudflare',
  'hosting.dnsMove.noTargets':
    'Nessuna connessione Cloudflare con ID account. Inserisca l\'ID account in una connessione Cloudflare alla voce "Provider", affinché la console possa creare zone.',
  'hosting.dnsMove.existingZone':
    "Per {name} esiste già una zona presso {provider} ({status}). Se si trova nell'account scelto, viene usata invece di crearne una nuova.",
  'hosting.dnsMove.existingZoneOtherOrg':
    'Appartiene a {zoneOrg}, il dominio a {domainOrg}. Assegni entrambi alla stessa organizzazione prima di avviare la migrazione.',
  'hosting.dnsMove.existingZoneClaim':
    'Non è assegnata ad alcuna organizzazione: la migrazione la assegna a {domainOrg}.',
  'hosting.dnsMove.noOrg': 'nessuna organizzazione',
  'hosting.dnsMove.import.label': 'Importa i record dal registrar ({n})',
  'hosting.dnsMove.import.hint':
    'Copia i record nella nuova zona. I record copiati non passano dal proxy, quindi il traffico non cambia.',
  'hosting.dnsMove.import.unavailable':
    'Non è possibile: il dominio non usa i nameserver del registrar, quindi i record del registrar non sono quelli validi.',
  'hosting.dnsMove.import.error': 'Non è stato possibile leggere i record presso il registrar:',
  'hosting.dnsMove.import.tooMany':
    'Non è possibile: più di {max} record. Importi la zona nel dashboard di Cloudflare.',
  'hosting.dnsMove.import.zoneNotEmpty':
    'In una zona che contiene già dei record, la console non copia nulla.',
  'hosting.dnsMove.planned': 'Da copiare ({n})',
  'hosting.dnsMove.converted': 'Adattati ({n})',
  'hosting.dnsMove.convertedType': '{from} diventa {to}',
  'hosting.dnsMove.ttlChanged': 'TTL {from} diventa {to}',
  'hosting.dnsMove.skipped.title': 'Non importati ({n})',
  'hosting.dnsMove.skipped.reason.type': 'Tipo non disponibile presso Cloudflare',
  'hosting.dnsMove.skipped.reason.readOnly': 'Sola lettura',
  'hosting.dnsMove.skipped.reason.apexNs': 'Nameserver del dominio, li imposta Cloudflare stesso',
  'hosting.dnsMove.ns.label': 'Cambia i nameserver presso il registrar',
  'hosting.dnsMove.ns.hint':
    'Imposta il dominio sui nameserver della zona non appena tutti i record sono stati copiati. Da quel momento valgono i record presso Cloudflare.',
  'hosting.dnsMove.ns.unsupported':
    'Non è possibile: il registrar non supporta il cambio tramite la console. In seguito dovrà impostare i nameserver manualmente.',
  'hosting.dnsMove.ns.requiresImport': 'Possibile solo dopo aver importato tutti i record.',
  'hosting.dnsMove.warning':
    'Dopo il cambio, i nameserver di Cloudflare rispondono a tutte le richieste DNS del dominio. Verifichi gli elenchi: ciò che non viene importato, in seguito mancherà.',
  'hosting.dnsMove.submit': 'Avvia migrazione',
  'hosting.dnsMove.result.title': 'Risultato della migrazione',
  'hosting.dnsMove.result.zoneCreated': 'Zona creata',
  'hosting.dnsMove.result.zoneReused': 'Zona esistente utilizzata',
  'hosting.dnsMove.result.import.done': '{n} record copiati',
  'hosting.dnsMove.result.import.partial': '{n} record copiati, {failed} non riusciti',
  'hosting.dnsMove.result.import.skipped': 'Nessun record copiato',
  'hosting.dnsMove.result.import.failed': 'Impossibile copiare i record',
  'hosting.dnsMove.result.import.reason.notRequested': 'Non selezionato.',
  'hosting.dnsMove.result.import.reason.registrarNotServing':
    'Il dominio non usa i nameserver del registrar.',
  'hosting.dnsMove.result.import.reason.zoneNotEmpty':
    'La zona contiene già dei record. La console non vi aggiunge nulla.',
  'hosting.dnsMove.result.import.reason.tooManyRecords':
    'Troppi record per la migrazione tramite la console.',
  'hosting.dnsMove.result.import.reason.recordsUnreadable':
    'Non è stato possibile leggere i record presso il registrar.',
  'hosting.dnsMove.result.ns.done': 'Nameserver cambiati presso il registrar',
  'hosting.dnsMove.result.ns.skipped': 'Nameserver non cambiati',
  'hosting.dnsMove.result.ns.failed': 'Impossibile cambiare i nameserver',
  'hosting.dnsMove.result.ns.manual': 'Imposti i nameserver manualmente',
  'hosting.dnsMove.result.ns.reason.notRequested':
    'Non selezionato. Imposti questi nameserver presso il registrar non appena la zona è completa:',
  'hosting.dnsMove.result.ns.reason.importIncomplete':
    'Non tutti i record sono stati copiati. Completi la zona e poi imposti questi nameserver nella panoramica del dominio:',
  'hosting.dnsMove.result.ns.reason.unsupported':
    'Il registrar non lo supporta tramite la console. Imposti manualmente questi nameserver presso il registrar:',
  'hosting.dnsMove.result.openZone': 'Vai alla zona',
  'explorer.cloudflarePath':
    'Percorsi relativi a /client/v4, ad es. /zones/<zone_id>/dns_records. I segreti nelle risposte vengono nascosti; i token API non si possono gestire qui.',
};
