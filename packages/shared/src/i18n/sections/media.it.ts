import type { mediaDe } from './media.de';

export const mediaIt: Partial<Record<keyof typeof mediaDe, string>> = {
  'nav.media': 'Streaming',
  'nav.admin.media': 'Streaming',
  'perm.group.media': 'Streaming',
  'media.subtitle':
    'Accessi al media server Jellyfin per film, serie e musica, nei limiti del suo contingente.',
  'media.open': 'Apri Jellyfin',
  'media.create': 'Crea accesso',
  'media.noAccess': "Non dispone dell'autorizzazione per gli accessi streaming di questa organizzazione.",
  'media.none.title': 'Streaming non ancora acquistato',
  'media.none.text':
    'Lo streaming (Jellyfin) si acquista tramite weblion.one. Non appena sarà configurato un contingente per la sua organizzazione, potrà creare qui gli accessi.',
  'media.none.textReseller':
    'Lo streaming (Jellyfin) si acquista tramite {reseller}. Non appena sarà configurato un contingente per la sua organizzazione, potrà creare qui gli accessi.',
  'media.noAllowanceAccounts':
    'Per questa organizzazione non è più configurato alcun contingente streaming. Gli accessi esistenti continuano a funzionare, non è possibile crearne di nuovi.',
  'media.limit.accounts':
    'Tutti gli accessi del suo contingente sono assegnati. Per crearne altri, occorre eliminare un accesso o ampliare il contingente.',
  'media.allowance': 'Contingente streaming',
  'media.allowanceText':
    'Ciò che è consentito a ogni accesso della sua organizzazione. La console lo applica a tutti gli accessi.',
  'media.figure.accounts': 'Accessi',
  'media.figure.accountsOf': '{n} di {max}',
  'media.figure.streams': 'Stream (dispositivi)',
  'media.figure.streamsValue': '{n} per accesso',
  'media.figure.downloads': 'Download',
  'media.figure.downloadsOn': 'Consentiti',
  'media.figure.downloadsOff': 'Non consentiti',
  'media.figure.bitrate': 'Qualità in mobilità',
  'media.figure.bitrateUpTo': 'fino a {rate}',
  'media.figure.libraries': 'Librerie',
  'media.instance': 'Istanza',
  'media.library.missing': "Questa libreria non esiste più sull'istanza.",
  'media.library.missingShort': 'Rimossa',
  'media.login.title': 'Come accedere',
  'media.login.text': 'Con questi dati tutti gli accessi effettuano il login nelle app Jellyfin.',
  'media.login.address': 'Indirizzo del server',
  'media.login.copyAddress': 'Copia indirizzo del server',
  'media.login.serverName': 'Le app mostrano il server come "{name}".',
  'media.login.step1':
    "Installi l'app Jellyfin sul suo dispositivo o apra l'indirizzo del server nel browser.",
  'media.login.step2': "Inserisca nell'app l'indirizzo del server.",
  'media.login.step3': 'Effettui il login con nome di login e password.',
  'media.login.codeHint': 'I nomi di login della sua organizzazione terminano con',
  'media.login.tv': 'Sul televisore',
  'media.login.quickConnect':
    'Selezioni Quick Connect nell\'app. Inserisca il codice del televisore qui nella console, presso l\'accesso, in "Collega televisore". Oppure in Jellyfin, in Impostazioni > Quick Connect, su un dispositivo che ha già effettuato il login.',
  'media.login.apps':
    'Le app sono disponibili per browser, Windows, macOS, Linux (Jellyfin Media Player), Android, Android TV, Fire TV, iPhone e iPad, Apple TV (Swiftfin), LG webOS, Roku e Kodi.',
  'media.login.allApps': 'Tutte le app',
  'media.login.privacy':
    'Altri accessi sullo stesso server possono vedere i nomi di login. Usi nomi di persona o di stanze, non nome e cognome.',
  'media.accounts': 'Accessi',
  'media.accountsText':
    'Ogni accesso effettua il login con il proprio nome di login e riceve i diritti del suo contingente.',
  'media.lastSync': 'Ultima sincronizzazione {when}',
  'media.search': 'Cerca nome di login…',
  'media.empty': 'Ancora nessun accesso',
  'media.emptyText': 'Crei un accesso per ogni persona o dispositivo che deve utilizzare Jellyfin.',
  'media.col.login': 'Nome di login',
  'media.col.status': 'Stato',
  'media.col.lastActive': 'Ultima attività',
  'media.col.created': 'Creato',
  'media.col.issues': 'Avvisi',
  'media.copyLogin': 'Copia nome di login',
  'media.activity.never': 'Mai',
  'media.activity.today': 'Oggi',
  'media.activity.yesterday': 'Ieri',
  'media.status.active': 'Attivo',
  'media.status.disabled': 'Disattivato',
  'media.status.locked': 'Bloccato',
  'media.status.lockedHint':
    "Jellyfin ha bloccato l'accesso dopo troppi tentativi di login non riusciti. Attivandolo si rimuove il blocco.",
  'media.status.noPassword': 'Senza password',
  'media.status.noPasswordHint':
    'Chi conosce il nome di login può effettuare il login senza password. Imposti una password.',
  'media.status.missing': 'Non trovato in Jellyfin',
  'media.status.missingHint': "L'accesso è stato eliminato in Jellyfin. Lo rimuova anche qui.",
  'media.privacyNote':
    "La console non vede che cosa viene guardato. Mostra solo in quale giorno un accesso è stato attivo l'ultima volta.",
  'media.createTitle': 'Crea accesso streaming',
  'media.createText': 'Un accesso per una persona o un dispositivo, con i diritti del suo contingente.',
  'media.name': 'Nome',
  'media.name.placeholder': 'anna',
  'media.name.preview': 'Nome di login:',
  'media.name.hint':
    'Usi nomi di persona o di stanze come anna o soggiorno. Altri accessi sullo stesso server possono vedere i nomi di login.',
  'media.name.invalid':
    "Solo lettere minuscole, cifre e singoli trattini, con una lettera o una cifra all'inizio e alla fine (al massimo 20 caratteri).",
  'media.name.taken': 'Questo accesso esiste già.',
  'media.created': 'Accesso {username} creato',
  'media.createdTitle': 'Accesso creato',
  'media.password.label': 'Password',
  'media.password.generate': 'Genera una password (consigliato)',
  'media.password.generateText':
    '{n} lettere minuscole e cifre, facili da inserire con un telecomando. Viene mostrata una sola volta.',
  'media.password.choose': 'Password propria',
  'media.password.chooseText': 'Almeno {min} caratteri. La console non la salva e non la mostra.',
  'media.password.input': 'Nuova password',
  'media.password.show': 'Mostra password',
  'media.password.hide': 'Nascondi password',
  'media.password.issue.length': 'Almeno {min} caratteri.',
  'media.password.issue.tooLong': 'Al massimo {max} caratteri.',
  'media.password.issue.characters': "Nessun carattere di controllo e nessuno spazio all'inizio o alla fine.",
  'media.password.copy': 'Copia password (senza spazi)',
  'media.password.groups':
    'In gruppi di quattro, per leggerla ad alta voce. Gli spazi non fanno parte della password.',
  'media.password.once':
    "La password viene mostrata solo ora. La console non la salva. La comunichi alla persona che utilizza l'accesso.",
  'media.password.newTitle': 'Nuova password',
  'media.password.action': 'Imposta nuova password',
  'media.password.title': 'Nuova password per {username}',
  'media.password.text':
    'Tutti i dispositivi collegati con questo accesso vengono disconnessi immediatamente. La password precedente non funzionerà più. In seguito, il modo più semplice per collegare i televisori è "Collega televisore".',
  'media.password.set': 'Imposta password',
  'media.password.setToast': 'Nuova password impostata per {username}',
  'media.password.setToastSignedOut':
    'Nuova password impostata per {username}, tutti i dispositivi disconnessi',
  'media.password.devicesDone': 'Tutti i dispositivi sono stati disconnessi.',
  'media.password.devicesLeft': 'Dispositivi ancora collegati: {n}',
  'media.connect.action': 'Collega televisore',
  'media.connect.title': 'Collega un televisore a {username}',
  'media.connect.text':
    'Un televisore o un altro dispositivo effettua il login con questo accesso senza che nessuno debba digitare la password.',
  'media.connect.step1':
    "Apra l'app Jellyfin sul televisore, inserisca l'indirizzo del server e selezioni Quick Connect.",
  'media.connect.step2': "L'app mostra un codice di 6 cifre. Lo inserisca qui.",
  'media.connect.code': 'Codice del televisore',
  'media.connect.codeHint': 'Il codice è valido per 10 minuti. La console non lo salva.',
  'media.connect.codeInvalid': 'Il codice ha 6 cifre.',
  'media.connect.submit': 'Collega',
  'media.connect.done': 'Televisore collegato a {username}',
  'media.connect.error.code':
    'Il server non conosce questo codice, oppure è scaduto. Riavvii Quick Connect sul televisore e inserisca il nuovo codice.',
  'media.connect.error.off':
    'Quick Connect è disattivato su questo server. Effettui il login sul televisore con nome di login e password.',
  'media.connect.error.limit':
    'Con questo accesso sono già collegati tanti dispositivi quanti ne consente il contingente ({n}). Disconnetta prima alcuni dispositivi.',
  'media.connect.error.disabled': "L'accesso è disattivato. Lo attivi prima di collegare un televisore.",
  'media.connect.error.failed':
    'Il server non ha accettato il codice. Se il televisore indica di aver effettuato il login, è collegato. Altrimenti riavvii Quick Connect.',
  'media.connect.error.tooMany': 'Troppi tentativi. Attenda un minuto.',
  'media.devices.action': 'Disconnetti tutti i dispositivi',
  'media.devices.title': 'Disconnettere tutti i dispositivi di {username}?',
  'media.devices.count': 'Dispositivi collegati: {n}',
  'media.devices.none': 'Nessun dispositivo è collegato con questo accesso.',
  'media.devices.text':
    'Le riproduzioni in corso vengono interrotte e tutti i dispositivi vengono disconnessi immediatamente. Password, cronologia e preferiti restano. I dispositivi effettuano di nuovo il login con la password o con Quick Connect.',
  'media.devices.privacy': 'La console mostra solo il numero, nessun nome di dispositivo.',
  'media.devices.confirm': 'Disconnetti tutti',
  'media.devices.done': 'Dispositivi disconnessi: {n}',
  'media.devices.skipped':
    'Non disconnessi: {n}. Su questi dispositivi è collegato anche un altro accesso. Una nuova password disconnette anche questi.',
  'media.devices.failed': 'Per {n} dispositivi la disconnessione non è riuscita. Riprovi.',
  'media.disable': 'Disattiva',
  'media.enable': 'Attiva',
  'media.disableTitle': 'Disattivare {username}?',
  'media.disableText':
    "Le riproduzioni in corso vengono interrotte, tutti i dispositivi vengono disconnessi immediatamente e l'accesso non può più effettuare il login. Cronologia e preferiti vengono mantenuti.",
  'media.enableTitle': 'Attivare {username}?',
  'media.enableText':
    "L'accesso può di nuovo effettuare il login. Viene inoltre rimosso un eventuale blocco dovuto a tentativi di login non riusciti.",
  'media.enableLockedHint': 'Rimuove il blocco',
  'media.enabledToast': '{username} attivato',
  'media.disabledToast': '{username} disattivato',
  'media.deleteTitle': 'Eliminare {username}?',
  'media.deleteConfirm': 'Elimina definitivamente',
  'media.deleteWarningTitle': 'Cronologia e preferiti vengono eliminati',
  'media.deleteWarning':
    "L'accesso viene eliminato in Jellyfin, con la cronologia di riproduzione, i preferiti e le playlist. Le riproduzioni in corso vengono interrotte e tutti i dispositivi vengono disconnessi. L'operazione non può essere annullata.",
  'media.deleteMissing': "L'accesso non esiste più in Jellyfin. Viene solo rimosso dalla console.",
  'media.deletedToast': '{username} eliminato',
  'media.issue.policy': 'Criteri divergenti',
  'media.issue.policy.text':
    'I diritti in Jellyfin non corrispondono al contingente. La sincronizzazione li corregge, oppure può applicare subito i criteri.',
  'media.issue.administrator': 'Amministratore',
  'media.issue.administrator.text':
    "In Jellyfin l'accesso è un amministratore. La sincronizzazione lo declassa, a meno che non sia l'ultimo amministratore.",
  'media.issue.blocked_folders': 'Librerie bloccate',
  'media.issue.blocked_folders.text':
    "L'utente ha vecchie librerie bloccate. In tal caso Jellyfin ignora le librerie del contingente e la console non può modificarlo.",
  'media.issue.no_password': 'Senza password',
  'media.issue.no_password.text': 'Chi conosce il nome di login effettua il login senza password.',
  'media.issue.locked_out': 'Bloccato',
  'media.issue.locked_out.text':
    'Bloccato da Jellyfin dopo tentativi di login non riusciti. Attivandolo si rimuove il blocco.',
  'media.issue.no_allowance': 'Nessun contingente',
  'media.issue.no_allowance.text':
    "L'organizzazione non ha alcun contingente su questa istanza. I diritti dell'accesso non vengono gestiti.",
  'media.issue.seerr_missing': 'Non nelle richieste',
  'media.issue.seerr_missing.text':
    "L'accesso non è ancora stato creato in Seerr. La sincronizzazione riprova.",
  'media.issue.seerr_drift': 'Richieste divergenti',
  'media.issue.seerr_drift.text':
    'Diritti o limiti in Seerr non corrispondono al contingente. La sincronizzazione li corregge.',
  'media.allowance.setUp': 'Configura',
  'media.allowance.setUpTitle': 'Configura lo streaming per {name}',
  'media.allowance.editTitle': 'Streaming di {name}',
  'media.allowance.dialogText':
    "Numero di accessi e ciò che è consentito a ogni accesso. La console applica i diritti a tutti gli accessi dell'organizzazione.",
  'media.allowance.instanceHint':
    "Tutti gli accessi dell'organizzazione si trovano su questa istanza Jellyfin.",
  'media.allowance.instanceLocked':
    "L'istanza può essere modificata solo finché l'organizzazione non vi ha accessi né contingenti di clienti.",
  'media.allowance.code': 'Codice del contingente',
  'media.allowance.codeGenerated': 'viene generato',
  'media.allowance.codeHint':
    'Da 3 a 12 lettere minuscole, i nomi di login terminano poi con -codice. Su un server condiviso gli altri accessi vedono i nomi di login: non vi utilizzi il nome di un cliente.',
  'media.allowance.codeLocked':
    "Il codice può essere modificato solo finché l'organizzazione non ha accessi.",
  'media.allowance.codeInvalid': 'Da 3 a 12 lettere minuscole dalla a alla z.',
  'media.allowance.maxAccounts': 'Numero massimo di accessi',
  'media.allowance.maxAccountsHint': "Quanti accessi può creare l'organizzazione.",
  'media.allowance.accountsUsed': 'Già assegnati: {n}',
  'media.allowance.maxInvalid': 'Inserisca un numero intero a partire da 1.',
  'media.allowance.maxBelowAccounts': 'Almeno {n}, tanti sono gli accessi già assegnati.',
  'media.allowance.maxTooHigh': 'Al massimo {n}.',
  'media.allowance.streams': 'Stream simultanei (dispositivi)',
  'media.allowance.streamsHint':
    'Vengono contati i dispositivi collegati e attivi. Jellyfin verifica il numero quando un dispositivo effettua il login.',
  'media.allowance.streamsInvalid': 'Un numero intero da 1 a {max}.',
  'media.allowance.libraries': 'Librerie',
  'media.allowance.librariesEmpty':
    "L'istanza non ha librerie che possano essere condivise. Le nuove librerie compaiono dopo la loro prima scansione.",
  'media.allowance.librariesNone': 'Selezioni almeno una libreria.',
  'media.allowance.librariesGone': "Non più presenti sull'istanza, verranno rimosse al salvataggio: {names}",
  'media.allowance.outsideParent': 'Non presso il rivenditore',
  'media.allowance.downloads': 'Consenti download',
  'media.allowance.downloadsHint':
    'Copie offline nelle app. Non è una protezione dalla copia: i contenuti in streaming possono comunque essere salvati.',
  'media.allowance.bitrate': 'Qualità in mobilità',
  'media.allowance.bitrateHint':
    "Bitrate massimo per i dispositivi al di fuori della rete del server. Senza un valore proprio vale l'impostazione del server.",
  'media.allowance.bitrateCustom': 'Valore proprio',
  'media.allowance.bitrateInvalid': 'Un numero intero da 1 a {max} Mbit/s.',
  'media.allowance.serverBitrate': 'Impostazione del server',
  'media.allowance.toCustomers': 'Di cui assegnati ai clienti: {n}',
  'media.allowance.enableModuleHint': '{org} vede lo streaming nella console solo con il modulo attivo.',
  'media.allowance.moduleOff': 'Senza il modulo "{module}" l\'organizzazione non vede il contingente.',
  'media.allowance.resellerHint':
    'Un rivenditore distribuisce questo contingente tra i propri accessi e i suoi clienti. I suoi clienti ricevono al massimo questi diritti.',
  'media.allowance.parentNone':
    '{reseller} non dispone di un proprio contingente streaming. Può comunque configurarne uno.',
  'media.allowance.beyondParent': 'Supera il contingente di {reseller} ({list}). Può comunque salvare.',
  'media.allowance.policyHint':
    "Dopo il salvataggio, la console applica i diritti a tutti gli accessi dell'organizzazione.",
  'media.allowance.saved': 'Contingente streaming salvato',
  'media.allowance.applied': 'Diritti applicati a tutti gli accessi ({n})',
  'media.allowance.policyFailed':
    'Per questi accessi non è stato possibile applicare i criteri. La sincronizzazione riprova.',
  'media.allowance.remove': 'Rimuovi contingente',
  'media.allowance.removeTitle': 'Rimuovere lo streaming di {name}?',
  'media.allowance.removeText':
    "In seguito l'organizzazione non potrà più creare accessi streaming. Il modulo resta attivo finché non lo disattiva.",
  'media.allowance.removeBlocked':
    "Possibile solo senza accessi. Occorre eliminare gli accessi o assegnarli a un'altra organizzazione.",
  'media.allowance.removeBlockedCustomers':
    'Possibile solo senza contingenti dei clienti. Rimuova prima i contingenti dei {n} clienti.',
  'media.allowance.removed': 'Contingente streaming rimosso',
  'media.conflict.libraries': 'librerie',
  'media.conflict.streams': 'stream',
  'media.conflict.downloads': 'download',
  'media.conflict.bitrate': 'qualità in mobilità',
  'media.conflict.accounts': 'accessi',
  'media.admin.subtitle':
    'Istanze Jellyfin, tutti gli accessi streaming e la presa in carico degli utenti creati direttamente in Jellyfin.',
  'media.admin.addProvider': 'Connetti istanza',
  'media.admin.hint':
    'I contingenti streaming si configurano presso il cliente, gli accessi li creano i clienti stessi.',
  'media.admin.instances': 'Istanze',
  'media.admin.instancesText':
    'Condivisa: più organizzazioni vi hanno un contingente; dedicata: esattamente una. Attività solo come numero.',
  'media.admin.noInstances': 'Nessuna istanza Jellyfin connessa',
  'media.admin.noInstancesText': "Connetta un'istanza in Provider per offrire accessi streaming.",
  'media.admin.col.usage': 'Utilizzo',
  'media.admin.col.accounts': 'Accessi',
  'media.admin.col.active': 'Attivi ora',
  'media.admin.col.quickConnect': 'Quick Connect',
  'media.admin.usage.dedicated': 'Dedicata',
  'media.admin.usage.shared': 'Condivisa',
  'media.admin.usage.unused': 'Inutilizzata',
  'media.admin.orgCount': 'Organizzazioni con contingente: {n}',
  'media.admin.withIssues': '{n} con avvisi',
  'media.admin.users': 'Utenti: {n}, librerie: {libraries}',
  'media.admin.activeNow': '{sessions} attivi, {playing} in riproduzione',
  'media.admin.quickConnect.on': 'Attivo',
  'media.admin.quickConnect.off': 'Non attivo',
  'media.admin.quickConnect.unknown': 'Sconosciuto',
  'media.admin.sync': 'Sincronizza',
  'media.admin.syncRepairFailed': 'Criteri non applicati: {n}',
  'media.admin.toProvider': 'Vai alla connessione del provider',
  'media.admin.accounts': 'Accessi',
  'media.admin.accountsText':
    "Tutti gli accessi streaming gestiti dalla console, con gli avvisi dell'ultima sincronizzazione.",
  'media.admin.search': 'Cerca nome di login…',
  'media.admin.filterCustomer': 'Filtra per cliente',
  'media.admin.allCustomers': 'Tutti i clienti',
  'media.admin.filterInstance': 'Filtra per istanza',
  'media.admin.allInstances': 'Tutte le istanze',
  'media.admin.onlyIssues': 'Solo con avvisi',
  'media.admin.empty': 'Nessun accesso streaming',
  'media.admin.emptyText':
    "Gli accessi compaiono qui non appena i clienti li creano o Lei prende in carico gli utenti di un'istanza.",
  'media.admin.limited':
    "Vengono mostrati al massimo 1000 accessi. Restringa l'elenco con la ricerca o con i filtri.",
  'media.admin.assign': 'Assegna…',
  'media.admin.reassign': 'Riassegna…',
  'media.admin.repair': 'Applica criteri',
  'media.admin.repairHint': 'Scrive ora in Jellyfin i diritti del contingente',
  'media.admin.repairHintSeerr':
    'Scrive ora in Jellyfin i diritti del contingente e in Seerr i diritti per le richieste',
  'media.admin.repaired': 'Criteri di {username} applicati',
  'media.admin.assignText':
    "L'accesso si trova su {instance}. In seguito il cliente lo gestisce nella sua console.",
  'media.admin.assignHint':
    "Il cliente necessita di un contingente streaming su questa istanza. I suoi diritti vengono applicati all'accesso. Lei può superare il numero di accessi del contingente.",
  'media.admin.unassignText':
    "In seguito {org} non vedrà più l'accesso. L'accesso continua a funzionare in Jellyfin finché non lo disattiva o lo elimina.",
  'media.admin.targetNone':
    'Questa organizzazione non ha alcun contingente streaming. Ne configuri prima uno su questa istanza.',
  'media.admin.targetOtherInstance':
    'Il contingente streaming di questa organizzazione si trova su {instance}, non su questa istanza.',
  'media.admin.targetAllowance': 'Contingente: {n} di {max} accessi assegnati, codice {code}.',
  'media.admin.targetFull':
    "Il contingente è esaurito. Può comunque assegnare l'accesso, che verrà conteggiato oltre il massimo.",
  'media.admin.noModule': 'senza streaming',
  'media.admin.cardText': "Accessi Jellyfin dell'organizzazione e ciò che è consentito a ogni accesso.",
  'media.admin.none': 'Nessuno streaming',
  'media.admin.noneText':
    "Configuri un contingente affinché l'organizzazione possa creare accessi streaming.",
  'media.admin.showAccounts': 'Mostra accessi',
  'media.admin.noInstance': 'Nessuna istanza Jellyfin è ancora connessa come provider.',
  'media.unmanaged.title': 'Utenti non gestiti',
  'media.unmanaged.text':
    'Utenti creati direttamente in Jellyfin. Gli utenti presi in carico mantengono nome e cronologia.',
  'media.unmanaged.load': 'Recupera utenti',
  'media.unmanaged.reload': 'Ricarica',
  'media.unmanaged.hint':
    'Recupera gli utenti di {instance} e mostra quelli che la console non gestisce ancora. Gli amministratori e gli utenti con vecchie librerie bloccate non possono essere presi in carico.',
  'media.unmanaged.empty': 'Tutti gli utenti di {instance} sono gestiti',
  'media.unmanaged.col.password': 'Password',
  'media.unmanaged.yes': 'Sì',
  'media.unmanaged.no': 'No',
  'media.unmanaged.administrator': 'Amministratore',
  'media.unmanaged.blocked.administrator': 'Amministratore, non può essere preso in carico',
  'media.unmanaged.blocked.blocked_folders': 'Vecchie librerie bloccate, non può essere preso in carico',
  'media.unmanaged.import': 'Prendi in carico',
  'media.unmanaged.importTitle': 'Prendi in carico {username}',
  'media.unmanaged.importText':
    "In seguito l'utente viene gestito dalla console. Nome e cronologia vengono mantenuti.",
  'media.unmanaged.noCustomer': '– non assegnare a nessun cliente –',
  'media.unmanaged.noCustomerHint':
    "Senza cliente, i diritti dell'utente restano quelli impostati in Jellyfin. Può assegnarlo in seguito.",
  'media.unmanaged.policyHint':
    "I diritti del contingente vengono applicati all'utente. Lei può superare il numero di accessi del contingente.",
  'media.unmanaged.setPassword': 'Imposta una nuova password',
  'media.unmanaged.setPasswordHint':
    "Genera una nuova password, che viene mostrata una sola volta. Tutti i dispositivi dell'utente vengono disconnessi.",
  'media.unmanaged.setPasswordForced':
    "L'utente non ha password: chi conosce il nome effettua il login. Viene preso in carico solo con una nuova password.",
  'media.unmanaged.imported': '{username} preso in carico',
  'media.unmanaged.passwordTitle': 'Utente preso in carico',
  'media.reseller.cardText': 'Accessi dal suo contingente e ciò che è consentito a ogni accesso del cliente.',
  'media.reseller.none': 'Nessuno streaming assegnato',
  'media.reseller.noneText':
    'Assegni al cliente una parte del suo contingente, affinché possa creare accessi streaming.',
  'media.reseller.pool': 'Il suo contingente: {free} accessi liberi su {max}',
  'media.reseller.noPool':
    'La sua organizzazione non dispone ancora di un contingente streaming. Si rivolga a weblion.one per acquistare lo streaming.',
  'media.reseller.dialogText': 'Dal suo contingente su {instance}, al massimo con i suoi stessi diritti.',
  'media.reseller.accountsLeft': 'Al massimo {n} dal suo contingente',
  'media.reseller.maxTooHigh': 'Accessi liberi nel suo contingente: {n}.',
  'media.reseller.noDownloads': 'Il suo contingente non consente download.',
  'media.reseller.downloadsOff': 'Il suo contingente non consente download, quindi nemmeno per i clienti.',
  'media.reseller.bitrateHint': 'Al massimo {max}, il limite del suo contingente.',
  'media.reseller.bitrateTooHigh': 'Al massimo {max} Mbit/s, il limite del suo contingente.',
  'media.reseller.bitrateRequired':
    'Il suo contingente ha un limite di {max} Mbit/s. Scelga un valore fino a questo limite.',
  'media.reseller.enablesModule': 'In questo modo si attiva anche il modulo Streaming per il cliente.',
  'media.reseller.removeText':
    'In seguito il cliente non potrà più creare accessi streaming. Gli accessi ritornano nel suo contingente.',
  'media.reseller.removeBlocked':
    'Possibile solo senza accessi. Il cliente deve prima eliminare i propri accessi.',
  'media.requests.title': 'Richieste',
  'media.requests.text':
    'Con le richieste i suoi accessi possono chiedere film e serie non ancora presenti sul server. weblion.one verifica ogni richiesta e mette a disposizione i titoli approvati.',
  'media.requests.open': 'Apri richieste',
  'media.requests.address': 'Indirizzo delle richieste',
  'media.requests.copyAddress': 'Copia indirizzo',
  'media.requests.signIn': "Per accedervi usi il nome di login e la password dell'accesso.",
  'media.requests.included': 'Inclusi',
  'media.requests.movies': 'Film',
  'media.requests.tv': 'Serie',
  'media.requests.movieQuota': 'fino a {limit} film in {days} giorni per accesso',
  'media.requests.tvQuota': 'fino a {limit} stagioni in {days} giorni per accesso',
  'media.requests.unlimited': 'senza limite',
  'media.requests.notIncluded': 'non inclusi',
  'media.requests.devicesHint': 'In Jellyfin il login alle richieste conta come un dispositivo collegato.',
  'media.requests.sessionHint':
    "Un login alle richieste resta valido fino a 30 giorni, anche dopo una nuova password o la disconnessione di tutti i dispositivi: fino ad allora è ancora possibile fare richieste. La disattivazione toglie il diritto di fare richieste, solo l'eliminazione termina il login.",
  'media.requests.col.pending': 'Aperte',
  'media.requests.col.approved': 'Approvate',
  'media.requests.col.available': 'Disponibili',
  'media.requests.col.quota': 'Contingente utilizzato',
  'media.requests.quotaMovies': 'Film: {used} di {limit}',
  'media.requests.quotaSeasons': 'Stagioni: {used} di {limit}',
  'media.requests.notReady': 'Configurazione in corso',
  'media.requests.notReadyHint':
    "L'accesso viene configurato nelle richieste. Ci vogliono al massimo pochi minuti.",
  'media.requests.disabled': 'Gli accessi disattivati non possono fare richieste.',
  'media.requests.syncedAt': 'Aggiornato {when}',
  'media.requests.privacy':
    'La console mostra solo numeri, mai i titoli richiesti. Nelle richieste stesse, tutti gli accessi su questo server vedono i nomi di login degli altri e chi ha richiesto un titolo.',
  'media.requests.figure': 'Richieste',
  'media.requests.figureBoth': 'Film e serie',
  'media.requests.totals': 'Aperte {pending}, approvate {approved}, disponibili {available}',
  'media.requests.field': 'Richieste (Seerr)',
  'media.requests.fieldHint':
    "Gli accessi possono richiedere film o serie. L'approvazione avviene in Seerr da parte di weblion.one.",
  'media.requests.fieldMovies': 'Richiedere film',
  'media.requests.fieldTv': 'Richiedere serie',
  'media.requests.limitNone': 'Senza limite',
  'media.requests.quotaLimit': 'Numero',
  'media.requests.quotaDays': 'in giorni',
  'media.requests.seasonsHint':
    'Per le serie Seerr conta le stagioni, non le serie. "Nessuna richiesta" significa: disattivare le richieste.',
  'media.requests.typeRequired': 'Selezioni film, serie o entrambi.',
  'media.requests.quotaInvalid': 'Un numero intero da 1 a {max}.',
  'media.requests.daysInvalid': 'Un numero intero da 1 a {max} giorni.',
  'media.requests.sharedWarning':
    'Su questa istanza più organizzazioni hanno un contingente. Nelle richieste tutti gli accessi vedono i nomi di login degli altri e chi ha richiesto un titolo.',
  'media.requests.inactive':
    'Seerr è disattivato su questa istanza. I clienti vedono le richieste solo quando Lei lo attiva.',
  'media.requests.streamsWarning':
    'Con 1 stream un accesso non può effettuare il login alle richieste finché è collegato un altro dispositivo.',
  'media.requests.unavailable': 'Per questa istanza non è registrato alcun Seerr.',
  'media.requests.offOnSave': 'Le richieste vengono disattivate al salvataggio.',
  'media.requests.applyFailed':
    'Per questi accessi non è stato possibile impostare i diritti nelle richieste. La sincronizzazione riprova.',
  'media.reseller.requestsCap': 'Al massimo ciò che consente il suo contingente.',
  'media.reseller.requestsYours': 'Il suo contingente: {value}',
  'media.conflict.requestsMovies': 'richieste di film',
  'media.conflict.requestsTv': 'richieste di serie',
  'media.conflict.movieQuota': 'limite film',
  'media.conflict.tvQuota': 'limite stagioni',
  'media.seerr.column': 'Richieste',
  'media.seerr.none': 'Nessun Seerr',
  'media.seerr.status.off': 'Disattivato',
  'media.seerr.status.ok': 'Attivo',
  'media.seerr.status.unsafe': 'Non sicuro',
  'media.seerr.status.error': 'Errore',
  'media.seerr.status.unknown': 'Non verificato',
  'media.seerr.shared':
    'Condivisa: {n} organizzazioni con richieste vedono in Seerr i nomi di login e i desideri delle altre.',
  'media.seerr.manage': 'Richieste…',
  'media.seerr.title': 'Richieste su {instance}',
  'media.seerr.text':
    'Seerr è la pagina delle richieste di questa istanza Jellyfin. La console vi crea gli accessi dei clienti con richieste e ne imposta diritti e limiti. Le richieste si approvano in Seerr.',
  'media.seerr.version': 'Versione {version}',
  'media.seerr.checkedAt': 'Verificato {when}',
  'media.seerr.recheck': 'Verifica di nuovo',
  'media.seerr.check.reachable': 'Raggiungibile',
  'media.seerr.check.key': 'Chiave API accettata',
  'media.seerr.check.sameServer': 'Connesso a questa istanza Jellyfin',
  'media.seerr.check.newSignIns': 'Nuovi login tramite Jellyfin disattivati',
  'media.seerr.check.defaultPermissions': 'Nuovi utenti senza diritti',
  'media.seerr.check.mediaServerLogin': 'Login con Jellyfin attivo',
  'media.seerr.check.csrf': 'Protezione CSRF disattivata',
  'media.seerr.problem.unreachable': 'Seerr non è raggiungibile.',
  'media.seerr.problem.key': 'Seerr ha rifiutato la chiave API.',
  'media.seerr.problem.not_jellyfin': 'Seerr non è configurato per Jellyfin.',
  'media.seerr.problem.other_server': 'Seerr è connesso a un altro server Jellyfin.',
  'media.seerr.problem.csrf':
    'La protezione CSRF di Seerr è attiva, quindi la console non può modificare nulla. La disattivi in Seerr in Impostazioni > Rete.',
  'media.seerr.problem.new_signins':
    'I nuovi login tramite Jellyfin sono attivi: ogni utente del server potrebbe fare richieste.',
  'media.seerr.problem.default_permissions': 'I nuovi utenti ricevono dei diritti. Consigliato: nessuno.',
  'media.seerr.problem.media_server_login':
    'Il login con Jellyfin è disattivato: i clienti non potrebbero effettuare il login.',
  'media.seerr.unmanaged':
    'Utenti in Seerr non gestiti dalla console e autorizzati a fare richieste: {n}. La sincronizzazione revoca loro questo diritto.',
  'media.seerr.orphans': 'Utenti in Seerr senza utente Jellyfin: {n}. Vanno eliminati in Seerr.',
  'media.seerr.localLogin':
    'In Seerr il login locale è attivo. Gli utenti che Seerr ha creato durante un login con Jellyfin prima che valessero le impostazioni consigliate continuano così ad accedere con la password di allora, anche dopo una nuova password. Lo disattivi in Seerr in Impostazioni > Utenti, se nessuno ne ha bisogno.',
  'media.seerr.apply': 'Applica le impostazioni consigliate',
  'media.seerr.applyText':
    'Imposta in Seerr: nuovi login tramite Jellyfin disattivati, nuovi utenti senza diritti, login con Jellyfin attivo. Le altre impostazioni restano invariate.',
  'media.seerr.applied': 'Impostazioni consigliate applicate in Seerr',
  'media.seerr.enable': 'Offri le richieste ai clienti',
  'media.seerr.enableHint': 'Possibile solo quando tutte le verifiche sono superate.',
  'media.seerr.enabled': 'Richieste attivate su {instance}',
  'media.seerr.disabled': 'Richieste disattivate su {instance}',
  'media.seerr.disableTitle': 'Disattivare le richieste su {instance}?',
  'media.seerr.disableText':
    'I clienti non vedono più le richieste. La console revoca in Seerr a tutti gli accessi il diritto di fare richieste. Gli utenti e le richieste restano in Seerr.',
  'media.seerr.disableConfirm': 'Disattiva',
  'media.seerr.sharedTitle': 'Più organizzazioni su questa istanza',
  'media.seerr.sharedText':
    "{n} organizzazioni hanno un contingente su {instance}. In Seerr ogni accesso collegato vede l'elenco degli utenti e, per ogni titolo, chi lo ha richiesto. I clienti con richieste vedono così i nomi di login e i desideri di altri clienti.",
  'media.seerr.sharedConfirm': 'Ho verificato e attivo comunque le richieste.',
  'media.seerr.enableConfirm': 'Attiva',
  'media.seerr.notConfigured':
    'Per questa istanza non è registrato alcun Seerr. Inserisca indirizzo e chiave API presso il provider.',
  'media.seerr.toProvider': 'Vai al provider',
  'media.seerr.applyResult': 'Diritti impostati nelle richieste: {n}',
  'media.admin.synced':
    '{seen} accessi streaming sincronizzati, {missing} non più trovati, {repaired} criteri corretti',
  'media.dashboardSub': '{n} di {max} accessi',
  'providers.jellyfin.help':
    'Jellyfin 10.10 o successivo (consigliato 10.11) con la configurazione iniziale completata. Crei nella dashboard di Jellyfin, in Chiavi API, una chiave dedicata solo a weblion.one. La chiave ha pieni diritti di amministratore.',
  'providers.jellyfin.url': "Indirizzo dell'istanza",
  'providers.jellyfin.urlHint':
    "L'indirizzo che i suoi clienti inseriscono nelle app Jellyfin, con il percorso se Jellyfin funziona sotto un percorso di base, ad es. https://media.weblion.one.",
  'providers.jellyfin.urlInvalid':
    'Un indirizzo http o https senza query e senza credenziali di accesso, un percorso solo per il percorso di base di Jellyfin, ad es. https://media.weblion.one.',
  'providers.jellyfin.httpWarning':
    'Senza https, chiave API e password viaggiano in rete non cifrate. Da usare solo in una rete privata.',
  'providers.jellyfin.apiKey': 'Chiave API',
  'providers.jellyfin.apiKeyHint':
    'Dashboard > Chiavi API > Aggiungi, nome app ad es. weblion.one. 32 caratteri tra 0-9 e a-f. Viene salvata in forma cifrata e non viene più mostrata.',
  'providers.jellyfin.apiKeyInvalid': 'Una chiave API di Jellyfin ha esattamente 32 caratteri tra 0-9 e a-f.',
  'providers.jellyfin.accountsText':
    'Accessi streaming di questa istanza, contingenti dei clienti e presa in carico degli utenti creati direttamente in Jellyfin.',
  'providers.jellyfin.toAccounts': 'Vai agli accessi streaming',
  'providers.jellyfin.seerr': 'Richieste (Seerr, facoltativo)',
  'providers.jellyfin.seerrHelp':
    "Un'istanza Seerr connessa esattamente a questa istanza Jellyfin. Da attivare per i clienti in Admin > Streaming.",
  'providers.jellyfin.seerrUrl': 'Indirizzo di Seerr',
  'providers.jellyfin.seerrUrlHint':
    "L'indirizzo con cui i suoi clienti aprono Seerr, ad es. https://anfragen.weblion.one.",
  'providers.jellyfin.seerrUrlInvalid':
    'Un indirizzo http o https senza query e senza credenziali di accesso.',
  'providers.jellyfin.seerrApiKey': 'Chiave API di Seerr',
  'providers.jellyfin.seerrApiKeyHint':
    'Seerr > Impostazioni > Generale > Chiave API. La chiave ha pieni diritti in Seerr. Viene salvata in forma cifrata e non viene più mostrata.',
  'providers.jellyfin.seerrApiKeyInvalid': 'Incolli la chiave così come la mostra Seerr.',
  'providers.jellyfin.seerrBoth': 'Indirizzo e chiave vanno inseriti insieme.',
  'providers.jellyfin.seerrRemove': 'Rimuovi Seerr',
  'admin.resources.mediaAccounts': 'Accessi streaming',
  'admin.blocker.mediaAccounts': 'Accessi streaming: {n}',
  'admin.blocker.mediaAllowances': 'Contingente streaming',
  'explorer.jellyfinPath':
    "Percorsi relativi all'indirizzo dell'istanza, ad es. /Users o /Library/VirtualFolders. Chiavi, token di accesso e password nelle risposte vengono nascosti. /Auth/Keys e gli endpoint di login sono bloccati.",
  'explorer.jellyfinBodyHint':
    'GET e DELETE inviano i parametri come query, POST come JSON. Invii sempre i criteri (POST /Users/<id>/Policy) per intero: Jellyfin reimposta i campi mancanti.',
};
