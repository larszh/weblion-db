import type { cloudDe } from './cloud.de';

export const cloudFr: Partial<Record<keyof typeof cloudDe, string>> = {
  'plans.title': 'Changer de type de serveur',
  'plans.subtitle': 'Le CPU, la mémoire vive et le disque dépendent du type de serveur.',
  'plans.type': 'Type',
  'plans.price': 'Prix/mois',
  'plans.priceFrom': 'dès {price}',
  'plans.priceStaff':
    "Les prix sont des prix d'achat chez le fournisseur (bruts par mois) et ne sont visibles que pour weblion.one.",
  'plans.current': 'Actuel',
  'plans.deprecated': 'En fin de vie',
  'plans.dedicated': 'Dédié',
  'plans.diskTooSmall': 'Disque trop petit',
  'plans.diskTooSmallHint':
    'Le disque du serveur fait {disk} Go. Les types avec un disque plus petit ne sont pas possibles, car un disque ne peut pas être réduit.',
  'plans.empty': 'Aucun type de serveur correspondant',
  'plans.select': 'Choisissez un type de serveur.',
  'plans.upgradeDisk': 'Agrandir le disque à {disk} Go',
  'plans.upgradeDiskHint':
    "Un disque agrandi ne peut plus être réduit. Il n'est ensuite plus possible de passer à un type avec un disque plus petit. Sans cette option, le disque reste à {current} Go et le changement peut être annulé.",
  'plans.hetznerOff':
    "Hetzner ne change le type de serveur que lorsque le serveur est éteint. Arrêtez-le d'abord sous Alimentation et redémarrez-le ensuite.",
  'plans.hint': 'Un autre type de serveur modifie les coûts et peut nécessiter un redémarrage.',
  'plans.confirmText': 'Le serveur passe à {plan} ({cores} vCPU, {memory} RAM).',
  'plans.confirmDisk': 'Le disque est agrandi à {disk} Go. Cette action est irréversible.',
  'inventory.plan': 'Type de serveur',
  'inventory.location': 'Emplacement',
  'inventory.image': 'Image',
  'inventory.createTextPlans': "Crée un serveur avec un type de serveur fixe à l'emplacement choisi.",
  'inventory.createHintPlans':
    "Le serveur est opérationnel après peu de temps et il est facturé par le fournisseur à partir de ce moment. Il apparaît dans l'inventaire, le résultat figure dans le journal d'audit. Vous définissez ensuite un mot de passe root dans les paramètres du serveur.",
  'inventory.notInLocation': 'pas à cet emplacement',
  'inventory.archImage': 'Type avec {arch} : choisissez une image adaptée.',
  'inventory.importHint.hetzner': "L'ID numérique du serveur dans la Hetzner Console, p. ex. 42817193.",
  'providers.hetzner.token': 'Jeton API',
  'providers.hetzner.tokenHint':
    'Hetzner Console > Project > Security > API tokens > Generate API token, autorisation "Read & Write".',
  'providers.hetzner.help':
    "Une connexion par projet Hetzner : un jeton ne voit que les serveurs du projet dans lequel il a été créé. Hetzner indique l'emplacement par serveur, le pays et la ville indiqués ici ne sont que la valeur par défaut.",
  'providers.baseUrlDefault': 'Par défaut : {url}',
  'explorer.hetznerPath':
    'Chemins relatifs à /v1, p. ex. /servers/<id>/actions. Les mots de passe root et les accès console sont masqués.',
  'explorer.bodyHintJson': 'Envoyés au fournisseur au format JSON.',
  'backups.hetznerHint':
    'Les sauvegardes doivent être activées chez Hetzner pour ce serveur (coûte 20 % du prix du serveur). Hetzner conserve les 7 dernières. La restauration écrase le disque avec la sauvegarde.',
  'snapshots.hetznerHint':
    'Les snapshots sauvegardent le disque sans la mémoire vive et sont facturés par Go et par mois chez Hetzner. La restauration écrase le disque avec le snapshot.',
  'delete.hetznerHint':
    'Hetzner supprime le serveur même en cours de fonctionnement, immédiatement et avec toutes les données.',
  'password.title': 'Mot de passe root',
  'password.subtitle': 'Définit un nouveau mot de passe aléatoire pour root.',
  'password.hint':
    'Le serveur doit être en marche. Selon le fournisseur, le QEMU Guest Agent est nécessaire dans le système invité (Linux).',
  'password.reset': 'Réinitialiser le mot de passe',
  'password.confirmTitle': 'Réinitialiser le mot de passe root de {name}?',
  'password.confirmText': "L'ancien mot de passe ne fonctionnera plus ensuite.",
  'password.newTitle': 'Nouveau mot de passe root',
  'password.newText':
    "Le mot de passe n'est affiché que maintenant et n'est enregistré nulle part. Copiez-le en lieu sûr.",
  'password.none': "Le fournisseur n'a renvoyé aucun mot de passe.",
};
