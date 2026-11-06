import type { cloudDe } from './cloud.de';

export const cloudIt: Partial<Record<keyof typeof cloudDe, string>> = {
  'plans.title': 'Cambia tipo di server',
  'plans.subtitle': 'CPU, memoria RAM e disco dipendono dal tipo di server.',
  'plans.type': 'Tipo',
  'plans.price': 'Prezzo/mese',
  'plans.priceFrom': 'da {price}',
  'plans.priceStaff':
    "I prezzi sono prezzi d'acquisto presso il provider (lordi al mese) e sono visibili solo a weblion.one.",
  'plans.current': 'Attuale',
  'plans.deprecated': 'In dismissione',
  'plans.dedicated': 'Dedicato',
  'plans.diskTooSmall': 'Disco troppo piccolo',
  'plans.diskTooSmallHint':
    'Il disco del server ha {disk} GB. I tipi con un disco più piccolo non sono possibili, perché un disco non può essere ridotto.',
  'plans.empty': 'Nessun tipo di server adatto trovato',
  'plans.select': 'Selezioni un tipo di server.',
  'plans.upgradeDisk': 'Ingrandisci il disco a {disk} GB',
  'plans.upgradeDiskHint':
    'Un disco più grande non può più essere ridotto. In seguito non sarà più possibile passare a un tipo con un disco più piccolo. Senza questa opzione il disco resta a {current} GB e il cambio può essere annullato.',
  'plans.hetznerOff':
    'Hetzner cambia il tipo di server solo a server spento. Lo arresti prima in Alimentazione e in seguito lo avvii di nuovo.',
  'plans.hint': 'Un altro tipo di server modifica i costi e può richiedere un riavvio.',
  'plans.confirmText': 'Il server passa a {plan} ({cores} vCPU, {memory} di RAM).',
  'plans.confirmDisk': "Il disco viene ingrandito a {disk} GB. L'operazione non può essere annullata.",
  'inventory.plan': 'Tipo di server',
  'inventory.location': 'Ubicazione',
  'inventory.image': 'Immagine',
  'inventory.createTextPlans': "Crea un server con un tipo di server fisso nell'ubicazione selezionata.",
  'inventory.createHintPlans':
    "Il server è operativo dopo poco tempo e da quel momento viene fatturato dal provider. Appare nell'inventario, il risultato si trova nel registro di audit. In seguito imposti una password di root nelle impostazioni del server.",
  'inventory.notInLocation': 'non in questa ubicazione',
  'inventory.archImage': "Tipo con {arch}: selezioni un'immagine adatta.",
  'inventory.importHint.hetzner': "L'ID numerico del server dalla Hetzner Console, ad es. 42817193.",
  'providers.hetzner.token': 'Token API',
  'providers.hetzner.tokenHint':
    'Hetzner Console > progetto > Security > API tokens > Generate API token, autorizzazione "Read & Write".',
  'providers.hetzner.help':
    "Una connessione per ogni progetto Hetzner: un token vede solo i server del progetto in cui è stato creato. Hetzner indica l'ubicazione per ogni server, paese e città qui sono solo il valore predefinito.",
  'providers.baseUrlDefault': 'Predefinito: {url}',
  'explorer.hetznerPath':
    'Percorsi relativi a /v1, ad es. /servers/<id>/actions. Le password di root e gli accessi alla console vengono nascosti.',
  'explorer.bodyHintJson': 'Viene inviato al provider in formato JSON.',
  'backups.hetznerHint':
    'I backup devono essere attivati presso Hetzner per questo server (costano il 20 % del prezzo del server). Hetzner conserva gli ultimi 7. Il ripristino sovrascrive il disco con il backup.',
  'snapshots.hetznerHint':
    'Gli snapshot salvano il disco senza la memoria RAM e presso Hetzner vengono fatturati per GB e mese. Il ripristino sovrascrive il disco con lo snapshot.',
  'delete.hetznerHint':
    'Hetzner elimina il server anche mentre è in funzione, immediatamente e con tutti i dati.',
  'password.title': 'Password di root',
  'password.subtitle': 'Imposta una nuova password casuale per root.',
  'password.hint':
    'Il server deve essere in funzione. A seconda del provider, nel sistema guest serve il QEMU Guest Agent (Linux).',
  'password.reset': 'Reimposta password',
  'password.confirmTitle': 'Reimpostare la password di root di {name}?',
  'password.confirmText': 'La password precedente non funzionerà più.',
  'password.newTitle': 'Nuova password di root',
  'password.newText':
    'La password viene mostrata solo ora e non viene salvata da nessuna parte. La copi in un luogo sicuro.',
  'password.none': 'Il provider non ha restituito alcuna password.',
};
