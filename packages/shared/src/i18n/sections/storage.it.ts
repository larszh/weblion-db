import type { storageDe } from './storage.de';

export const storageIt: Partial<Record<keyof typeof storageDe, string>> = {
  'nav.cloud': 'Archiviazione cloud',
  'storage.subtitle':
    'Account Nextcloud per file, calendari e contatti del suo team, con spazio di archiviazione dal suo contingente.',
  'storage.open': 'Apri Nextcloud',
  'storage.create': 'Crea account',
  'storage.noAccess': "Non ha accesso all'archiviazione cloud di questa organizzazione.",
  'storage.none.title': 'Archiviazione cloud non ancora acquistata',
  'storage.none.text':
    "L'archiviazione cloud (Nextcloud) si acquista tramite weblion.one. Non appena sarà configurato un contingente di spazio per la sua organizzazione, potrà creare qui gli account per il suo team.",
  'storage.none.textReseller':
    "L'archiviazione cloud (Nextcloud) si acquista tramite {reseller}. Non appena sarà configurato un contingente di spazio per la sua organizzazione, potrà creare qui gli account per il suo team.",
  'storage.noAllowanceAccounts':
    'Per questa organizzazione non è più configurato alcun contingente di spazio. Gli account esistenti continuano a funzionare, non è possibile crearne di nuovi.',
  'storage.limit.accounts':
    'Tutti gli account del suo contingente sono assegnati. Per crearne altri, occorre eliminare un account o ampliare il contingente.',
  'storage.limit.storage':
    'Il suo contingente di spazio è interamente assegnato agli account. Per crearne altri, occorre ridurre un account o ampliare il contingente.',
  'storage.allowance': 'Contingente di spazio',
  'storage.allowanceText':
    'Spazio che distribuisce tra i suoi account. Occupato è lo spazio che gli account utilizzano effettivamente.',
  'storage.toCustomers': 'Di cui assegnati ai suoi clienti: {size} e {n} account',
  'storage.figure.booked': 'Acquistato',
  'storage.figure.allocated': 'Assegnato',
  'storage.figure.used': 'Occupato',
  'storage.figure.accounts': 'Account',
  'storage.accounts.of': '{n} di {max}',
  'storage.accounts.ofUnlimited': '{n} (illimitati)',
  'storage.meter.label': '{allocated} assegnati, {used} occupati, su {quota}',
  'storage.meter.used': 'Occupato',
  'storage.meter.allocated': 'Assegnato',
  'storage.meter.free': 'Libero',
  'storage.instance': 'Istanza',
  'storage.loginAt': 'Accedi su',
  'storage.dashboardSub': '{allocated} di {quota} assegnati',
  'storage.accounts': 'Account',
  'storage.accountsText':
    'Ogni account ha il proprio contingente di spazio e accede con il proprio nome di login.',
  'storage.lastSync': "Utilizzo aggiornato l'ultima volta {when}",
  'storage.search': 'Cerca account, nome o e-mail…',
  'storage.empty': 'Ancora nessun account',
  'storage.emptyText': 'Crei un account per ogni persona che deve utilizzare Nextcloud.',
  'storage.col.login': 'Nome di login',
  'storage.col.name': 'Nome',
  'storage.col.email': 'E-mail',
  'storage.col.storage': 'Spazio',
  'storage.col.status': 'Stato',
  'storage.col.lastLogin': 'Ultimo accesso',
  'storage.copyLogin': 'Copia nome di login',
  'storage.usage.of': '{used} di {quota}',
  'storage.usage.unlimited': '{used} occupati, illimitato',
  'storage.usage.over': 'Contingente superato, caricamenti bloccati',
  'storage.status.active': 'Attivo',
  'storage.status.disabled': 'Disattivato',
  'storage.status.missing': 'Non trovato in Nextcloud',
  'storage.lastLogin.never': 'Mai',
  'storage.createTitle': 'Crea account cloud',
  'storage.createText':
    'Un account Nextcloud per una persona del suo team, con un proprio contingente di spazio.',
  'storage.name': 'Nome utente',
  'storage.name.placeholder': 'anna',
  'storage.name.preview': 'Nome di login:',
  'storage.name.hint':
    'Lettere minuscole, cifre, punto, trattino e trattino basso. Non può essere modificato in seguito.',
  'storage.name.invalid':
    "Solo lettere minuscole, cifre, punto, trattino e trattino basso, con una lettera o una cifra all'inizio e alla fine (al massimo 32 caratteri).",
  'storage.name.tooLong': 'Il nome di login può contenere al massimo {max} caratteri.',
  'storage.name.taken': 'Questo account esiste già.',
  'storage.displayName': 'Nome visualizzato',
  'storage.displayName.placeholder': 'Anna Muster',
  'storage.email': 'Indirizzo e-mail',
  'storage.email.required': "Obbligatorio per l'invito.",
  'storage.email.invalid': 'Indirizzo e-mail non valido.',
  'storage.email.needsPassword':
    'Modificabile solo con il diritto di reimpostare le password: a questo indirizzo vengono inviati gli inviti e i link per reimpostare la password.',
  'storage.email.changeHint': "D'ora in poi Nextcloud invierà notifiche e inviti al nuovo indirizzo.",
  'storage.quota': 'Contingente di spazio',
  'storage.quota.freeHint': 'Ancora libero nel contingente: {free}',
  'storage.quota.maxHint': 'Al massimo {max} (ancora libero nel contingente: {free})',
  'storage.quota.invalid': 'Inserisca un numero intero a partire da 1 GB.',
  'storage.quota.step':
    'A partire da 1024 GB solo in passi di 512 GB (1024, 1536, 2048 …), Nextcloud arrotonda gli altri valori.',
  'storage.quota.tooLarge': 'Nel contingente rientrano al massimo {max}.',
  'storage.quota.current': 'Attualmente {quota}. Lasci vuoto per mantenerlo.',
  'storage.quota.currentUnlimited': 'Attualmente illimitato. Lasci vuoto per lasciarlo così.',
  'storage.quota.used': 'Occupato: {used}',
  'storage.quota.belowUsageTitle': 'Inferiore allo spazio occupato',
  'storage.quota.belowUsage':
    "L'account occupa già {used}. Tutti i file vengono mantenuti, ma non è possibile caricarne di nuovi finché non vengono eliminati dei file.",
  'storage.delivery': 'Accesso',
  'storage.delivery.password': 'Genera password ora',
  'storage.delivery.passwordText':
    "La password viene mostrata una sola volta. La comunica Lei stesso. Se è indicato un indirizzo e-mail, Nextcloud invia anche un'e-mail di benvenuto.",
  'storage.delivery.invite': 'Invito via e-mail',
  'storage.delivery.inviteText':
    'Nextcloud invia un link con cui la persona imposta da sé la propria password.',
  'storage.delivery.needsEmail': 'Per un invito occorre un indirizzo e-mail.',
  'storage.created': 'Account {username} creato',
  'storage.createdInvite': 'Account creato, invito inviato a {email}',
  'storage.createdTitle': 'Account creato',
  'storage.editTitle': 'Modifica {username}',
  'storage.updated': '{username} salvato',
  'storage.disable': 'Disattiva',
  'storage.enable': 'Attiva',
  'storage.disableTitle': 'Disattivare {username}?',
  'storage.disableText':
    'La persona non può più accedere e i suoi dispositivi non si sincronizzano più. I file e il contingente di spazio vengono mantenuti.',
  'storage.enableTitle': 'Attivare {username}?',
  'storage.enableText': 'La persona può di nuovo accedere.',
  'storage.enabledToast': '{username} attivato',
  'storage.disabledToast': '{username} disattivato',
  'storage.resetPassword': 'Imposta nuova password',
  'storage.passwordTitle': 'Nuova password per {username}?',
  'storage.passwordText':
    'La password precedente non funzionerà più. La nuova password viene mostrata una sola volta.',
  'storage.passwordNewTitle': 'Nuova password',
  'storage.resendInvite': "Invia di nuovo l'invito",
  'storage.invitedToast': 'Invito inviato a {email}',
  'storage.deleteTitle': 'Eliminare {username}?',
  'storage.deleteConfirm': 'Elimina definitivamente',
  'storage.deleteWarningTitle': 'Tutti i file vengono eliminati',
  'storage.deleteWarning':
    "L'account viene eliminato in Nextcloud con tutti i file ({used}), i calendari, i contatti e le condivisioni. L'operazione è irreversibile.",
  'storage.deletedToast': '{username} eliminato',
  'storage.allowance.setUp': 'Configura',
  'storage.allowance.setUpTitle': "Configura l'archiviazione cloud per {name}",
  'storage.allowance.editTitle': 'Archiviazione cloud di {name}',
  'storage.allowance.dialogText':
    "Spazio totale e numero di account che l'organizzazione distribuisce autonomamente.",
  'storage.allowance.instanceHint':
    "Tutti gli account dell'organizzazione si trovano su questa istanza Nextcloud.",
  'storage.allowance.instanceLocked': "L'istanza può essere modificata solo finché non vi esistono account.",
  'storage.allowance.instanceLockedCustomers':
    "L'istanza può essere modificata solo finché nessun cliente del rivenditore vi ha un contingente.",
  'storage.allowance.quota': 'Spazio totale',
  'storage.allowance.allocatedHint': 'Già assegnato: {size}',
  'storage.allowance.belowAllocated': 'Almeno {size}, tanto è già assegnato.',
  'storage.allowance.maxAccounts': 'Numero massimo di account',
  'storage.allowance.maxAccountsHint': 'Lasci vuoto per un numero illimitato di account.',
  'storage.allowance.maxInvalid': 'Inserisca un numero intero a partire da 1 oppure lasci vuoto il campo.',
  'storage.allowance.maxBelowAccounts': 'Almeno {n}, tanti sono gli account già esistenti.',
  'storage.allowance.unlimited': 'illimitato',
  'storage.allowance.enableModuleHint':
    "{org} vede l'archiviazione cloud nella console solo con il modulo attivo.",
  'storage.allowance.moduleOff': 'Senza il modulo "{module}" l\'organizzazione non vede il contingente.',
  'storage.allowance.resellerHint':
    'Un rivenditore distribuisce questo contingente tra i propri account e i suoi clienti.',
  'storage.allowance.saved': 'Contingente di spazio salvato',
  'storage.allowance.remove': 'Rimuovi contingente',
  'storage.allowance.removeTitle': "Rimuovere l'archiviazione cloud di {name}?",
  'storage.allowance.removeText':
    "In seguito l'organizzazione non potrà più creare account Nextcloud. Il modulo resta attivo finché non lo disattiva.",
  'storage.allowance.removeBlocked':
    "Possibile solo senza account. Occorre eliminare gli account o assegnarli a un'altra organizzazione.",
  'storage.allowance.removeBlockedCustomers':
    'Possibile solo senza contingenti dei clienti. Rimuova prima i contingenti dei {n} clienti.',
  'storage.allowance.removed': 'Contingente di spazio rimosso',
  'storage.admin.tab': 'Account cloud',
  'storage.admin.tabHint':
    'I contingenti di spazio si configurano presso il cliente, gli account li creano i clienti stessi. Gli utenti creati direttamente in Nextcloud si prendono in carico qui sotto.',
  'storage.admin.search': 'Cerca nome di login, nome o e-mail…',
  'storage.admin.filterCustomer': 'Filtra per cliente',
  'storage.admin.allCustomers': 'Tutti i clienti',
  'storage.admin.filterInstance': 'Filtra per istanza',
  'storage.admin.allInstances': 'Tutte le istanze',
  'storage.admin.empty': 'Nessun account cloud',
  'storage.admin.emptyText':
    "Gli account compaiono qui non appena i clienti li creano o Lei prende in carico gli utenti di un'istanza.",
  'storage.admin.synced': '{seen} account cloud sincronizzati, {missing} mancanti',
  'storage.admin.cardText': "Spazio che l'organizzazione può distribuire tra gli account Nextcloud.",
  'storage.admin.none': 'Nessuna archiviazione cloud',
  'storage.admin.noneText':
    "Configuri un contingente affinché l'organizzazione possa creare account Nextcloud.",
  'storage.admin.showAccounts': 'Mostra account',
  'storage.admin.noInstance': 'Nessuna istanza Nextcloud è ancora connessa come provider.',
  'storage.admin.noModule': 'senza archiviazione cloud',
  'storage.admin.needsAllowance': 'Il cliente necessita di un contingente di spazio sulla stessa istanza.',
  'storage.admin.assignText':
    "L'account si trova su {instance}. In seguito il cliente lo gestisce nella sua console.",
  'storage.admin.assignQuotaHint':
    "In seguito il contingente dell'account viene conteggiato nel contingente di spazio del cliente, anche se lo supera.",
  'storage.admin.unassignText':
    "In seguito {org} non vedrà più l'account. L'account e i suoi file restano in Nextcloud.",
  'storage.unmanaged.title': 'Utenti non gestiti',
  'storage.unmanaged.text':
    'Utenti creati direttamente in Nextcloud. Gli utenti presi in carico mantengono nome e contingente.',
  'storage.unmanaged.load': 'Recupera utenti',
  'storage.unmanaged.reload': 'Ricarica',
  'storage.unmanaged.hint':
    "Recupera gli utenti di {instance} e mostra quelli che la console non gestisce ancora. Gli amministratori dell'istanza non compaiono mai.",
  'storage.unmanaged.empty': 'Tutti gli utenti di {instance} sono gestiti',
  'storage.unmanaged.import': 'Prendi in carico',
  'storage.unmanaged.importTitle': 'Prendi in carico {username}',
  'storage.unmanaged.importText':
    "In seguito l'utente viene gestito dalla console. Nome, contingente e file restano invariati.",
  'storage.unmanaged.noCustomer': '– non assegnare a nessun cliente –',
  'storage.unmanaged.unlimitedHint':
    "L'utente non ha un contingente (illimitato). Presso il cliente viene conteggiato con lo spazio occupato, finché non viene impostato un contingente.",
  'storage.unmanaged.imported': '{username} preso in carico',
  'storage.reseller.cardText':
    'Spazio dal suo contingente che il cliente distribuisce tra i propri account Nextcloud.',
  'storage.reseller.none': 'Nessuna archiviazione cloud assegnata',
  'storage.reseller.noneText':
    'Assegni al cliente una parte del suo contingente, affinché possa creare account Nextcloud.',
  'storage.reseller.pool': 'Il suo contingente: {free} liberi su {quota}',
  'storage.reseller.noPool':
    'La sua organizzazione non dispone ancora di un contingente di archiviazione cloud. Si rivolga a weblion.one per acquistare spazio.',
  'storage.reseller.dialogText':
    'Dal suo contingente su {instance}. Il cliente distribuisce autonomamente lo spazio tra i propri account.',
  'storage.reseller.quotaHint': 'Al massimo {max} dal suo contingente',
  'storage.reseller.accountsLeft': 'Al massimo {n} dal suo contingente',
  'storage.reseller.maxRequired':
    'Il suo contingente prevede un numero massimo di account. Inserisca al massimo {n}.',
  'storage.reseller.maxTooHigh': 'Nel suo contingente restano liberi solo {n} account.',
  'storage.reseller.enablesModule':
    'In questo modo si attiva anche il modulo Archiviazione cloud per il cliente.',
  'storage.reseller.removeText':
    'In seguito il cliente non potrà più creare account Nextcloud. Lo spazio ritorna nel suo contingente.',
  'storage.reseller.removeBlocked':
    'Possibile solo senza account. Il cliente deve prima eliminare i propri account.',
  'providers.nextcloud.help':
    'Crei in Nextcloud un account admin dedicato alla console (membro del gruppo "admin") e generi per esso una password per le applicazioni in Impostazioni personali > Sicurezza. Per gli inviti l\'istanza deve poter inviare e-mail (Impostazioni di amministrazione > Impostazioni di base > Server di posta).',
  'providers.nextcloud.url': "URL dell'istanza",
  'providers.nextcloud.urlHint': "L'indirizzo con cui gli utenti accedono, ad es. https://cloud.weblion.one",
  'providers.nextcloud.username': 'Utente admin',
  'providers.nextcloud.usernameHint':
    "Nome di login dell'account admin per la console, non quello personale.",
  'providers.nextcloud.appPassword': 'Password per le applicazioni',
  'providers.nextcloud.appPasswordHint':
    'Impostazioni personali > Sicurezza > Dispositivi e sessioni > Crea nuova password per le applicazioni.',
  'providers.nextcloud.groupPrefix': 'Prefisso dei gruppi',
  'providers.nextcloud.groupPrefixHint':
    'Facoltativo. Ogni organizzazione riceve il gruppo <prefisso><sigla>, affinché colleghe e colleghi possano condividere tra loro. Predefinito: {prefix}',
  'providers.nextcloud.groupPrefixChange':
    'Predefinito: {prefix}. Un nuovo prefisso vale solo per i nuovi account, quelli esistenti restano nei loro gruppi.',
  'providers.nextcloud.groupPrefixInvalid':
    'Lettere minuscole, cifre, punto, trattino e trattino basso, al massimo 31 caratteri.',
  'providers.nextcloud.accountsText':
    'Account di questa istanza, assegnazione ai clienti e presa in carico degli utenti creati direttamente in Nextcloud.',
  'providers.nextcloud.toAccounts': 'Vai agli account cloud',
  'explorer.nextcloudPath':
    'Percorsi OCS, ad es. /ocs/v2.php/cloud/users?search=anna. Le password nelle risposte vengono nascoste, le password per le applicazioni non possono essere gestite qui.',
  'explorer.nextcloudBodyHint':
    'GET e DELETE inviano i parametri come query, POST e PUT come modulo, ad es. { "key": "quota", "value": "10 GB" }.',
};
