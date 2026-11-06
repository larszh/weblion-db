import type { mediaDe } from './media.de';

export const mediaFr: Partial<Record<keyof typeof mediaDe, string>> = {
  'nav.media': 'Streaming',
  'nav.admin.media': 'Streaming',
  'perm.group.media': 'Streaming',
  'media.subtitle':
    'Accès au serveur multimédia Jellyfin pour les films, les séries et la musique, dans le cadre de votre contingent.',
  'media.open': 'Ouvrir Jellyfin',
  'media.create': 'Créer un accès',
  'media.noAccess': "Vous n'êtes pas autorisé à consulter les accès streaming de cette organisation.",
  'media.none.title': "Aucun streaming souscrit pour l'instant",
  'media.none.text':
    "Vous souscrivez le streaming (Jellyfin) auprès de weblion.one. Dès qu'un contingent est configuré pour votre organisation, vous créez ici des accès.",
  'media.none.textReseller':
    "Vous souscrivez le streaming (Jellyfin) auprès de {reseller}. Dès qu'un contingent est configuré pour votre organisation, vous créez ici des accès.",
  'media.noAllowanceAccounts':
    "Aucun contingent streaming n'est plus configuré pour cette organisation. Les accès existants continuent de fonctionner, mais il n'est pas possible d'en créer de nouveaux.",
  'media.limit.accounts':
    "Tous les accès de votre contingent sont attribués. Pour en créer d'autres, veuillez supprimer un accès ou étendre votre contingent.",
  'media.allowance': 'Contingent streaming',
  'media.allowanceText':
    "Ce que chaque accès de votre organisation peut faire. La console l'applique à tous les accès.",
  'media.figure.accounts': 'Accès',
  'media.figure.accountsOf': '{n} sur {max}',
  'media.figure.streams': 'Flux (appareils)',
  'media.figure.streamsValue': '{n} par accès',
  'media.figure.downloads': 'Téléchargements',
  'media.figure.downloadsOn': 'Autorisés',
  'media.figure.downloadsOff': 'Non autorisés',
  'media.figure.bitrate': 'Qualité en déplacement',
  'media.figure.bitrateUpTo': "jusqu'à {rate}",
  'media.figure.libraries': 'Bibliothèques',
  'media.instance': 'Instance',
  'media.library.missing': "Cette bibliothèque n'existe plus sur l'instance.",
  'media.library.missingShort': 'Supprimée',
  'media.login.title': 'Comment vous connecter',
  'media.login.text': 'Avec ces informations, tous les accès se connectent dans les apps Jellyfin.',
  'media.login.address': 'Adresse du serveur',
  'media.login.copyAddress': "Copier l'adresse du serveur",
  'media.login.serverName': 'Les apps affichent le serveur sous le nom "{name}".',
  'media.login.step1':
    "Installez l'app Jellyfin sur votre appareil ou ouvrez l'adresse du serveur dans le navigateur.",
  'media.login.step2': "Saisissez l'adresse du serveur dans l'app.",
  'media.login.step3': 'Connectez-vous avec le nom de connexion et le mot de passe.',
  'media.login.codeHint': 'Les noms de connexion de votre organisation se terminent par',
  'media.login.tv': 'Sur le téléviseur',
  'media.login.quickConnect':
    'Choisissez Quick Connect dans l\'app. Saisissez le code affiché sur le téléviseur ici, dans la console, au niveau de l\'accès, sous "Connecter un téléviseur". Ou dans Jellyfin, sous Paramètres > Quick Connect, sur un appareil déjà connecté.',
  'media.login.apps':
    'Des apps existent pour le navigateur, Windows, macOS, Linux (Jellyfin Media Player), Android, Android TV, Fire TV, iPhone et iPad, Apple TV (Swiftfin), LG webOS, Roku et Kodi.',
  'media.login.allApps': 'Toutes les apps',
  'media.login.privacy':
    'Les autres accès sur le même serveur peuvent voir les noms de connexion. Utilisez des prénoms ou des pièces, pas des noms complets.',
  'media.accounts': 'Accès',
  'media.accountsText':
    'Chaque accès se connecte avec son nom de connexion et reçoit les droits de votre contingent.',
  'media.lastSync': 'Dernière synchronisation {when}',
  'media.search': 'Rechercher un nom de connexion…',
  'media.empty': "Aucun accès pour l'instant",
  'media.emptyText': 'Créez un accès pour chaque personne ou chaque appareil qui doit utiliser Jellyfin.',
  'media.col.login': 'Nom de connexion',
  'media.col.status': 'Statut',
  'media.col.lastActive': 'Dernière activité',
  'media.col.created': 'Créé',
  'media.col.issues': 'Remarques',
  'media.copyLogin': 'Copier le nom de connexion',
  'media.activity.never': 'Jamais',
  'media.activity.today': "Aujourd'hui",
  'media.activity.yesterday': 'Hier',
  'media.status.active': 'Actif',
  'media.status.disabled': 'Désactivé',
  'media.status.locked': 'Verrouillé',
  'media.status.lockedHint':
    "Jellyfin a verrouillé l'accès après un trop grand nombre de tentatives de connexion échouées. L'activation lève le verrouillage.",
  'media.status.noPassword': 'Sans mot de passe',
  'media.status.noPasswordHint':
    'Toute personne qui connaît le nom de connexion peut se connecter sans mot de passe. Définissez un mot de passe.',
  'media.status.missing': 'Introuvable dans Jellyfin',
  'media.status.missingHint': "L'accès a été supprimé dans Jellyfin. Retirez-le aussi ici.",
  'media.privacyNote':
    'La console ne voit pas ce qui est regardé. Elle indique seulement le dernier jour où un accès a été actif.',
  'media.createTitle': 'Créer un accès streaming',
  'media.createText': 'Un accès pour une personne ou un appareil, avec les droits de votre contingent.',
  'media.name': 'Nom',
  'media.name.placeholder': 'anna',
  'media.name.preview': 'Nom de connexion :',
  'media.name.hint':
    'Utilisez des prénoms ou des pièces comme anna ou salon. Les autres accès sur le même serveur peuvent voir les noms de connexion.',
  'media.name.invalid':
    "Uniquement des lettres minuscules, des chiffres et des traits d'union isolés, avec une lettre ou un chiffre au début et à la fin (20 caractères au maximum).",
  'media.name.taken': 'Cet accès existe déjà.',
  'media.created': 'Accès {username} créé',
  'media.createdTitle': 'Accès créé',
  'media.password.label': 'Mot de passe',
  'media.password.generate': 'Générer un mot de passe (recommandé)',
  'media.password.generateText':
    '{n} lettres minuscules et chiffres, faciles à saisir avec une télécommande. Affiché une seule fois.',
  'media.password.choose': 'Mot de passe personnalisé',
  'media.password.chooseText':
    "Au moins {min} caractères. La console ne l'enregistre pas et ne l'affiche pas.",
  'media.password.input': 'Nouveau mot de passe',
  'media.password.show': 'Afficher le mot de passe',
  'media.password.hide': 'Masquer le mot de passe',
  'media.password.issue.length': 'Au moins {min} caractères.',
  'media.password.issue.tooLong': '{max} caractères au maximum.',
  'media.password.issue.characters': "Pas de caractères de contrôle ni d'espaces au début ou à la fin.",
  'media.password.copy': 'Copier le mot de passe (sans espaces)',
  'media.password.groups':
    'En groupes de quatre pour la lecture à voix haute. Les espaces ne font pas partie du mot de passe.',
  'media.password.once':
    "Le mot de passe n'est affiché que maintenant. La console ne l'enregistre pas. Transmettez-le à la personne qui utilise l'accès.",
  'media.password.newTitle': 'Nouveau mot de passe',
  'media.password.action': 'Redéfinir le mot de passe',
  'media.password.title': 'Nouveau mot de passe pour {username}',
  'media.password.text':
    'Tous les appareils connectés avec cet accès sont immédiatement déconnectés. L\'ancien mot de passe ne fonctionnera plus ensuite. Le plus simple pour connecter ensuite un téléviseur est d\'utiliser "Connecter un téléviseur".',
  'media.password.set': 'Définir le mot de passe',
  'media.password.setToast': 'Nouveau mot de passe défini pour {username}',
  'media.password.setToastSignedOut':
    'Nouveau mot de passe défini pour {username}, tous les appareils déconnectés',
  'media.password.devicesDone': 'Tous les appareils ont été déconnectés.',
  'media.password.devicesLeft': 'Appareils encore connectés : {n}',
  'media.connect.action': 'Connecter un téléviseur',
  'media.connect.title': 'Connecter un téléviseur à {username}',
  'media.connect.text':
    'Un téléviseur ou un autre appareil se connecte avec cet accès, sans que personne ne doive saisir le mot de passe.',
  'media.connect.step1':
    "Ouvrez l'app Jellyfin sur le téléviseur, saisissez l'adresse du serveur et choisissez Quick Connect.",
  'media.connect.step2': "L'app affiche un code à 6 chiffres. Saisissez-le ici.",
  'media.connect.code': 'Code du téléviseur',
  'media.connect.codeHint': "Le code est valable 10 minutes. La console ne l'enregistre pas.",
  'media.connect.codeInvalid': 'Le code comporte 6 chiffres.',
  'media.connect.submit': 'Connecter',
  'media.connect.done': 'Téléviseur connecté à {username}',
  'media.connect.error.code':
    'Le serveur ne connaît pas ce code, ou il a expiré. Relancez Quick Connect sur le téléviseur et saisissez le nouveau code.',
  'media.connect.error.off':
    'Quick Connect est désactivé sur ce serveur. Connectez le téléviseur avec le nom de connexion et le mot de passe.',
  'media.connect.error.limit':
    "Autant d'appareils que le contingent le permet ({n}) sont déjà connectés avec cet accès. Déconnectez d'abord des appareils.",
  'media.connect.error.disabled': "L'accès est désactivé. Activez-le avant de connecter un téléviseur.",
  'media.connect.error.failed':
    "Le serveur n'a pas accepté le code. Si le téléviseur indique qu'il est connecté, la connexion est établie. Sinon, relancez Quick Connect.",
  'media.connect.error.tooMany': 'Trop de tentatives. Attendez une minute.',
  'media.devices.action': 'Déconnecter tous les appareils',
  'media.devices.title': 'Déconnecter tous les appareils de {username}?',
  'media.devices.count': 'Appareils connectés : {n}',
  'media.devices.none': "Aucun appareil n'est connecté avec cet accès.",
  'media.devices.text':
    "Les lectures en cours sont arrêtées et tous les appareils sont immédiatement déconnectés. Le mot de passe, l'historique et les favoris sont conservés. Les appareils se reconnectent avec le mot de passe ou avec Quick Connect.",
  'media.devices.privacy': 'La console affiche uniquement le nombre, pas les noms des appareils.',
  'media.devices.confirm': 'Tout déconnecter',
  'media.devices.done': 'Appareils déconnectés : {n}',
  'media.devices.skipped':
    'Non déconnectés : {n}. Un autre accès est aussi connecté sur ces appareils. Un nouveau mot de passe les déconnecte également.',
  'media.devices.failed': 'La déconnexion a échoué pour {n} appareils. Veuillez réessayer.',
  'media.disable': 'Désactiver',
  'media.enable': 'Activer',
  'media.disableTitle': 'Désactiver {username}?',
  'media.disableText':
    "Les lectures en cours sont arrêtées, tous les appareils sont immédiatement déconnectés et l'accès ne peut plus se connecter. L'historique et les favoris sont conservés.",
  'media.enableTitle': 'Activer {username}?',
  'media.enableText':
    "L'accès peut de nouveau se connecter. Un verrouillage après des tentatives de connexion échouées est alors levé.",
  'media.enableLockedHint': 'Lève le verrouillage',
  'media.enabledToast': '{username} activé',
  'media.disabledToast': '{username} désactivé',
  'media.deleteTitle': 'Supprimer {username}?',
  'media.deleteConfirm': 'Supprimer définitivement',
  'media.deleteWarningTitle': "L'historique et les favoris seront supprimés",
  'media.deleteWarning':
    "L'accès est supprimé dans Jellyfin, avec l'historique de lecture, les favoris et les listes de lecture. Les lectures en cours sont arrêtées et tous les appareils déconnectés. Cette action est irréversible.",
  'media.deleteMissing': "L'accès n'existe plus dans Jellyfin. Il est seulement retiré de la console.",
  'media.deletedToast': '{username} supprimé',
  'media.issue.policy': 'Politique divergente',
  'media.issue.policy.text':
    'Les droits dans Jellyfin diffèrent du contingent. La synchronisation les adapte, ou vous appliquez la politique maintenant.',
  'media.issue.administrator': 'Administrateur',
  'media.issue.administrator.text':
    "L'accès est administrateur dans Jellyfin. La synchronisation le rétrograde, sauf s'il s'agit du dernier administrateur.",
  'media.issue.blocked_folders': 'Bibliothèques bloquées',
  'media.issue.blocked_folders.text':
    "L'utilisateur a d'anciennes bibliothèques bloquées. Jellyfin ignore alors les bibliothèques du contingent, et la console ne peut pas changer cela.",
  'media.issue.no_password': 'Sans mot de passe',
  'media.issue.no_password.text':
    'Toute personne qui connaît le nom de connexion se connecte sans mot de passe.',
  'media.issue.locked_out': 'Verrouillé',
  'media.issue.locked_out.text':
    "Verrouillé par Jellyfin après des tentatives de connexion échouées. L'activation lève le verrouillage.",
  'media.issue.no_allowance': 'Aucun contingent',
  'media.issue.no_allowance.text':
    "L'organisation n'a pas de contingent sur cette instance. Les droits de l'accès ne sont pas gérés.",
  'media.issue.seerr_missing': 'Absent des demandes',
  'media.issue.seerr_missing.text':
    "L'accès n'a pas encore été créé dans Seerr. La synchronisation réessaiera.",
  'media.issue.seerr_drift': 'Demandes divergentes',
  'media.issue.seerr_drift.text':
    'Les droits ou les limites dans Seerr diffèrent du contingent. La synchronisation les adapte.',
  'media.allowance.setUp': 'Configurer',
  'media.allowance.setUpTitle': 'Configurer le streaming de {name}',
  'media.allowance.editTitle': 'Streaming de {name}',
  'media.allowance.dialogText':
    "Nombre d'accès et ce que chaque accès peut faire. La console applique les droits à tous les accès de l'organisation.",
  'media.allowance.instanceHint': "Tous les accès de l'organisation se trouvent sur cette instance Jellyfin.",
  'media.allowance.instanceLocked':
    "L'instance ne peut être modifiée que tant que l'organisation n'y a ni accès ni contingents de clients.",
  'media.allowance.code': 'Code du contingent',
  'media.allowance.codeGenerated': 'sera généré',
  'media.allowance.codeHint':
    "3 à 12 lettres minuscules, les noms de connexion se terminent alors par -code. Sur un serveur partagé, les autres accès voient les noms de connexion : n'y utilisez pas de nom de client.",
  'media.allowance.codeLocked': "Le code ne peut être modifié que tant que l'organisation n'a aucun accès.",
  'media.allowance.codeInvalid': '3 à 12 lettres minuscules de a à z.',
  'media.allowance.maxAccounts': 'Accès au maximum',
  'media.allowance.maxAccountsHint': "Le nombre d'accès que l'organisation peut créer.",
  'media.allowance.accountsUsed': 'Déjà attribués : {n}',
  'media.allowance.maxInvalid': 'Saisissez un nombre entier à partir de 1.',
  'media.allowance.maxBelowAccounts': "Au moins {n}, c'est le nombre d'accès déjà attribués.",
  'media.allowance.maxTooHigh': '{n} au maximum.',
  'media.allowance.streams': 'Flux simultanés (appareils)',
  'media.allowance.streamsHint':
    "Les appareils connectés et actifs sont comptés. Jellyfin vérifie ce nombre lorsqu'un appareil se connecte.",
  'media.allowance.streamsInvalid': 'Un nombre entier de 1 à {max}.',
  'media.allowance.libraries': 'Bibliothèques',
  'media.allowance.librariesEmpty':
    "L'instance n'a aucune bibliothèque pouvant être partagée. Les nouvelles bibliothèques apparaissent après leur premier scan.",
  'media.allowance.librariesNone': 'Choisissez au moins une bibliothèque.',
  'media.allowance.librariesGone':
    "Plus présentes sur l'instance, elles seront retirées quand vous enregistrerez : {names}",
  'media.allowance.outsideParent': 'Non inclus chez le revendeur',
  'media.allowance.downloads': 'Autoriser les téléchargements',
  'media.allowance.downloadsHint':
    "Copies hors ligne dans les apps. Ce n'est pas une protection contre la copie : les contenus diffusés en streaming peuvent malgré tout être enregistrés.",
  'media.allowance.bitrate': 'Qualité en déplacement',
  'media.allowance.bitrateHint':
    "Débit maximal pour les appareils situés hors du réseau du serveur. Sans valeur personnalisée, le paramètre du serveur s'applique.",
  'media.allowance.bitrateCustom': 'Valeur personnalisée',
  'media.allowance.bitrateInvalid': 'Un nombre entier de 1 à {max} Mbit/s.',
  'media.allowance.serverBitrate': 'Paramètre du serveur',
  'media.allowance.toCustomers': 'Dont attribués à des clients : {n}',
  'media.allowance.enableModuleHint':
    '{org} ne voit le streaming dans la console que si le module est actif.',
  'media.allowance.moduleOff': 'Sans le module "{module}", l\'organisation ne voit pas le contingent.',
  'media.allowance.resellerHint':
    'Un revendeur répartit ce contingent entre ses propres accès et ses clients. Ses clients reçoivent au maximum ces droits.',
  'media.allowance.parentNone':
    "{reseller} n'a pas lui-même de contingent streaming. Vous pouvez quand même en configurer un.",
  'media.allowance.beyondParent':
    'Dépasse le contingent de {reseller} ({list}). Vous pouvez quand même enregistrer.',
  'media.allowance.policyHint':
    "Dès que vous cliquez sur Enregistrer, la console applique les droits à tous les accès de l'organisation.",
  'media.allowance.saved': 'Contingent streaming enregistré',
  'media.allowance.applied': 'Droits appliqués à tous les accès ({n})',
  'media.allowance.policyFailed':
    "La politique n'a pas pu être appliquée à ces accès. La synchronisation réessaiera.",
  'media.allowance.remove': 'Retirer le contingent',
  'media.allowance.removeTitle': 'Retirer le streaming de {name}?',
  'media.allowance.removeText':
    "L'organisation ne pourra ensuite plus créer d'accès streaming. Le module reste actif jusqu'à ce que vous le désactiviez.",
  'media.allowance.removeBlocked':
    'Possible uniquement sans accès. Veuillez supprimer les accès ou les attribuer à une autre organisation.',
  'media.allowance.removeBlockedCustomers':
    "Possible uniquement sans contingents de clients. Retirez d'abord les contingents des {n} clients.",
  'media.allowance.removed': 'Contingent streaming retiré',
  'media.conflict.libraries': 'Bibliothèques',
  'media.conflict.streams': 'Flux',
  'media.conflict.downloads': 'Téléchargements',
  'media.conflict.bitrate': 'Qualité en déplacement',
  'media.conflict.accounts': 'Accès',
  'media.admin.subtitle':
    'Instances Jellyfin, tous les accès streaming et la reprise des utilisateurs créés directement dans Jellyfin.',
  'media.admin.addProvider': 'Connecter une instance',
  'media.admin.hint':
    'Vous configurez les contingents streaming chez le client, les clients créent eux-mêmes les accès.',
  'media.admin.instances': 'Instances',
  'media.admin.instancesText':
    'Partagée : plusieurs organisations y ont un contingent, dédiée : une seule. Activité uniquement sous forme de nombre.',
  'media.admin.noInstances': 'Aucune instance Jellyfin connectée',
  'media.admin.noInstancesText':
    'Connectez une instance sous Fournisseurs pour proposer des accès streaming.',
  'media.admin.col.usage': 'Utilisation',
  'media.admin.col.accounts': 'Accès',
  'media.admin.col.active': 'Actifs maintenant',
  'media.admin.col.quickConnect': 'Quick Connect',
  'media.admin.usage.dedicated': 'Dédiée',
  'media.admin.usage.shared': 'Partagée',
  'media.admin.usage.unused': 'Inutilisée',
  'media.admin.orgCount': 'Organisations avec contingent : {n}',
  'media.admin.withIssues': '{n} avec remarques',
  'media.admin.users': 'Utilisateurs : {n}, bibliothèques : {libraries}',
  'media.admin.activeNow': '{sessions} actifs, {playing} en lecture',
  'media.admin.quickConnect.on': 'Activé',
  'media.admin.quickConnect.off': 'Désactivé',
  'media.admin.quickConnect.unknown': 'Inconnu',
  'media.admin.sync': 'Synchroniser',
  'media.admin.syncRepairFailed': 'Politiques non appliquées : {n}',
  'media.admin.toProvider': 'Vers la connexion du fournisseur',
  'media.admin.accounts': 'Accès',
  'media.admin.accountsText':
    'Tous les accès streaming gérés par la console, avec les remarques de la dernière synchronisation.',
  'media.admin.search': 'Rechercher un nom de connexion…',
  'media.admin.filterCustomer': 'Filtrer par client',
  'media.admin.allCustomers': 'Tous les clients',
  'media.admin.filterInstance': 'Filtrer par instance',
  'media.admin.allInstances': 'Toutes les instances',
  'media.admin.onlyIssues': 'Uniquement avec remarques',
  'media.admin.empty': 'Aucun accès streaming',
  'media.admin.emptyText':
    "Les accès apparaissent ici dès que des clients les créent ou que vous reprenez les utilisateurs d'une instance.",
  'media.admin.limited':
    '1000 accès au maximum sont affichés. Affinez la liste avec la recherche ou les filtres.',
  'media.admin.assign': 'Attribuer…',
  'media.admin.reassign': 'Attribuer autrement…',
  'media.admin.repair': 'Appliquer la politique',
  'media.admin.repairHint': 'Écrit maintenant les droits du contingent dans Jellyfin',
  'media.admin.repairHintSeerr':
    'Écrit maintenant les droits du contingent dans Jellyfin et les droits des demandes dans Seerr',
  'media.admin.repaired': 'Politique de {username} appliquée',
  'media.admin.assignText': "L'accès se trouve sur {instance}. Le client le gère ensuite dans sa console.",
  'media.admin.assignHint':
    "Le client a besoin d'un contingent streaming sur cette instance. Ses droits sont appliqués à l'accès. Vous pouvez dépasser le nombre d'accès du contingent.",
  'media.admin.unassignText':
    "{org} ne voit ensuite plus l'accès. L'accès continue de fonctionner dans Jellyfin jusqu'à ce que vous le désactiviez ou le supprimiez.",
  'media.admin.targetNone':
    "Cette organisation n'a pas de contingent streaming. Configurez-en d'abord un sur cette instance.",
  'media.admin.targetOtherInstance':
    'Le contingent streaming de cette organisation se trouve sur {instance}, pas sur cette instance.',
  'media.admin.targetAllowance': 'Contingent : {n} accès attribués sur {max}, code {code}.',
  'media.admin.targetFull':
    "Le contingent est épuisé. Vous pouvez quand même attribuer l'accès, il compte alors au-delà du maximum.",
  'media.admin.noModule': 'sans streaming',
  'media.admin.cardText': "Accès Jellyfin de l'organisation et ce que chaque accès peut faire.",
  'media.admin.none': 'Aucun streaming',
  'media.admin.noneText':
    "Configurez un contingent pour que l'organisation puisse créer des accès streaming.",
  'media.admin.showAccounts': 'Afficher les accès',
  'media.admin.noInstance': "Aucune instance Jellyfin n'est encore connectée comme fournisseur.",
  'media.unmanaged.title': 'Utilisateurs non gérés',
  'media.unmanaged.text':
    'Utilisateurs créés directement dans Jellyfin. Les utilisateurs repris conservent leur nom et leur historique.',
  'media.unmanaged.load': 'Récupérer les utilisateurs',
  'media.unmanaged.reload': 'Recharger',
  'media.unmanaged.hint':
    "Récupère les utilisateurs de {instance} et affiche ceux que la console ne gère pas encore. Les administrateurs et les utilisateurs avec d'anciennes bibliothèques bloquées ne peuvent pas être repris.",
  'media.unmanaged.empty': 'Tous les utilisateurs de {instance} sont gérés',
  'media.unmanaged.col.password': 'Mot de passe',
  'media.unmanaged.yes': 'Oui',
  'media.unmanaged.no': 'Non',
  'media.unmanaged.administrator': 'Administrateur',
  'media.unmanaged.blocked.administrator': 'Administrateur, ne peut pas être repris',
  'media.unmanaged.blocked.blocked_folders': 'Anciennes bibliothèques bloquées, ne peut pas être repris',
  'media.unmanaged.import': 'Reprendre',
  'media.unmanaged.importTitle': 'Reprendre {username}',
  'media.unmanaged.importText':
    "La console gère ensuite l'utilisateur. Le nom et l'historique sont conservés.",
  'media.unmanaged.noCustomer': "– n'attribuer à aucun client –",
  'media.unmanaged.noCustomerHint':
    "Sans client, les droits de l'utilisateur restent tels qu'ils sont dans Jellyfin. Vous pouvez l'attribuer plus tard.",
  'media.unmanaged.policyHint':
    "Les droits du contingent sont appliqués à l'utilisateur. Vous pouvez dépasser le nombre d'accès du contingent.",
  'media.unmanaged.setPassword': 'Définir un nouveau mot de passe',
  'media.unmanaged.setPasswordHint':
    "Génère un nouveau mot de passe, affiché une seule fois. Tous les appareils de l'utilisateur sont déconnectés.",
  'media.unmanaged.setPasswordForced':
    "L'utilisateur n'a pas de mot de passe : toute personne qui connaît le nom peut se connecter. Il ne peut être repris qu'avec un nouveau mot de passe.",
  'media.unmanaged.imported': '{username} repris',
  'media.unmanaged.passwordTitle': 'Utilisateur repris',
  'media.reseller.cardText': 'Accès issus de votre contingent et ce que chaque accès du client peut faire.',
  'media.reseller.none': 'Aucun streaming attribué',
  'media.reseller.noneText':
    "Attribuez au client une partie de votre contingent pour qu'il puisse créer des accès streaming.",
  'media.reseller.pool': 'Votre contingent : {free} accès libres sur {max}',
  'media.reseller.noPool':
    "Votre organisation n'a pas encore de contingent streaming. Adressez-vous à weblion.one pour souscrire le streaming.",
  'media.reseller.dialogText': 'Issu de votre contingent sur {instance}, au maximum avec vos propres droits.',
  'media.reseller.accountsLeft': 'Au maximum {n} de votre contingent',
  'media.reseller.maxTooHigh': 'Accès libres dans votre contingent : {n}.',
  'media.reseller.noDownloads': "Votre contingent n'autorise pas les téléchargements.",
  'media.reseller.downloadsOff':
    "Votre contingent n'autorise pas les téléchargements, donc pas non plus pour les clients.",
  'media.reseller.bitrateHint': '{max} au maximum, la limite de votre contingent.',
  'media.reseller.bitrateTooHigh': '{max} Mbit/s au maximum, la limite de votre contingent.',
  'media.reseller.bitrateRequired':
    "Votre contingent a une limite de {max} Mbit/s. Choisissez une valeur jusqu'à cette limite.",
  'media.reseller.enablesModule': 'Cela active aussi le module Streaming pour le client.',
  'media.reseller.removeText':
    "Le client ne pourra ensuite plus créer d'accès streaming. Les accès retournent dans votre contingent.",
  'media.reseller.removeBlocked':
    "Possible uniquement sans accès. Le client doit d'abord supprimer ses accès.",
  'media.requests.title': 'Demandes',
  'media.requests.text':
    'Grâce aux demandes, vos accès peuvent demander des films et des séries qui ne sont pas encore disponibles sur le serveur. weblion.one examine chaque demande et met à disposition les titres approuvés.',
  'media.requests.open': 'Ouvrir les demandes',
  'media.requests.address': 'Adresse des demandes',
  'media.requests.copyAddress': "Copier l'adresse",
  'media.requests.signIn': "Connectez-vous-y avec le nom de connexion et le mot de passe de l'accès.",
  'media.requests.included': 'Inclus',
  'media.requests.movies': 'Films',
  'media.requests.tv': 'Séries',
  'media.requests.movieQuota': "jusqu'à {limit} films en {days} jours par accès",
  'media.requests.tvQuota': "jusqu'à {limit} saisons en {days} jours par accès",
  'media.requests.unlimited': 'sans limite',
  'media.requests.notIncluded': 'non inclus',
  'media.requests.devicesHint': 'La connexion aux demandes compte dans Jellyfin comme un appareil connecté.',
  'media.requests.sessionHint':
    "Une connexion aux demandes reste valable jusqu'à 30 jours, même après un nouveau mot de passe ou la déconnexion de tous les appareils : jusque-là, il reste possible d'y faire des demandes. La désactivation retire le droit de faire des demandes, seul le fait de supprimer l'accès met fin à la connexion.",
  'media.requests.col.pending': 'En attente',
  'media.requests.col.approved': 'Approuvées',
  'media.requests.col.available': 'Disponibles',
  'media.requests.col.quota': 'Contingent utilisé',
  'media.requests.quotaMovies': 'Films : {used} sur {limit}',
  'media.requests.quotaSeasons': 'Saisons : {used} sur {limit}',
  'media.requests.notReady': 'En cours de configuration',
  'media.requests.notReadyHint':
    "L'accès est en cours de configuration dans les demandes. Cela prend au maximum quelques minutes.",
  'media.requests.disabled': 'Les accès désactivés ne peuvent pas faire de demandes.',
  'media.requests.syncedAt': 'Mis à jour {when}',
  'media.requests.privacy':
    "La console n'affiche que des nombres, jamais les titres demandés. Dans les demandes elles-mêmes, tous les accès de ce serveur voient les noms de connexion des autres et qui a demandé un titre.",
  'media.requests.figure': 'Demandes',
  'media.requests.figureBoth': 'Films et séries',
  'media.requests.totals': 'En attente {pending}, approuvées {approved}, disponibles {available}',
  'media.requests.field': 'Demandes (Seerr)',
  'media.requests.fieldHint':
    "Les accès peuvent demander des films ou des séries. L'approbation se fait dans Seerr par weblion.one.",
  'media.requests.fieldMovies': 'Demander des films',
  'media.requests.fieldTv': 'Demander des séries',
  'media.requests.limitNone': 'Sans limite',
  'media.requests.quotaLimit': 'Nombre',
  'media.requests.quotaDays': 'en jours',
  'media.requests.seasonsHint':
    'Pour les séries, Seerr compte les saisons, pas les séries. "Aucune demande" signifie : désactiver les demandes.',
  'media.requests.typeRequired': 'Choisissez les films, les séries ou les deux.',
  'media.requests.quotaInvalid': 'Un nombre entier de 1 à {max}.',
  'media.requests.daysInvalid': 'Un nombre entier de 1 à {max} jours.',
  'media.requests.sharedWarning':
    'Plusieurs organisations ont un contingent sur cette instance. Dans les demandes, tous les accès voient les noms de connexion des autres et qui a demandé un titre.',
  'media.requests.inactive':
    "Seerr est désactivé sur cette instance. Les clients ne voient les demandes que lorsque vous l'activez.",
  'media.requests.streamsWarning':
    "Avec 1 flux, un accès ne peut pas se connecter aux demandes tant qu'un autre appareil est connecté.",
  'media.requests.unavailable': "Aucun Seerr n'est enregistré pour cette instance.",
  'media.requests.offOnSave': 'Les demandes seront désactivées quand vous enregistrerez.',
  'media.requests.applyFailed':
    "Les droits dans les demandes n'ont pas pu être définis pour ces accès. La synchronisation réessaiera.",
  'media.reseller.requestsCap': 'Au maximum ce que votre contingent autorise.',
  'media.reseller.requestsYours': 'Votre contingent : {value}',
  'media.conflict.requestsMovies': 'Demander des films',
  'media.conflict.requestsTv': 'Demander des séries',
  'media.conflict.movieQuota': 'Limite de films',
  'media.conflict.tvQuota': 'Limite de saisons',
  'media.seerr.column': 'Demandes',
  'media.seerr.none': 'Aucun Seerr',
  'media.seerr.status.off': 'Désactivé',
  'media.seerr.status.ok': 'Activé',
  'media.seerr.status.unsafe': 'Non sûr',
  'media.seerr.status.error': 'Erreur',
  'media.seerr.status.unknown': 'Non vérifié',
  'media.seerr.shared':
    'Partagée : {n} organisations avec demandes voient dans Seerr les noms de connexion et les souhaits des autres.',
  'media.seerr.manage': 'Demandes…',
  'media.seerr.title': 'Demandes sur {instance}',
  'media.seerr.text':
    'Seerr est la page de demandes de cette instance Jellyfin. La console y crée les accès des clients qui ont les demandes et définit leurs droits et leurs limites. Vous approuvez les demandes dans Seerr.',
  'media.seerr.version': 'Version {version}',
  'media.seerr.checkedAt': 'Vérifié {when}',
  'media.seerr.recheck': 'Vérifier à nouveau',
  'media.seerr.check.reachable': 'Joignable',
  'media.seerr.check.key': 'Clé API acceptée',
  'media.seerr.check.sameServer': 'Connecté à cette instance Jellyfin',
  'media.seerr.check.newSignIns': 'Nouvelles connexions via Jellyfin désactivées',
  'media.seerr.check.defaultPermissions': 'Nouveaux utilisateurs sans droits',
  'media.seerr.check.mediaServerLogin': 'Connexion avec Jellyfin activée',
  'media.seerr.check.csrf': 'Protection CSRF désactivée',
  'media.seerr.problem.unreachable': "Seerr n'est pas joignable.",
  'media.seerr.problem.key': 'Seerr a refusé la clé API.',
  'media.seerr.problem.not_jellyfin': "Seerr n'est pas configuré pour Jellyfin.",
  'media.seerr.problem.other_server': 'Seerr est connecté à un autre serveur Jellyfin.',
  'media.seerr.problem.csrf':
    'La protection CSRF de Seerr est activée, la console ne peut donc rien modifier. Désactivez-la dans Seerr sous Paramètres > Réseau.',
  'media.seerr.problem.new_signins':
    'Les nouvelles connexions via Jellyfin sont activées : chaque utilisateur du serveur pourrait faire des demandes.',
  'media.seerr.problem.default_permissions':
    'Les nouveaux utilisateurs reçoivent des droits. Recommandé : aucun.',
  'media.seerr.problem.media_server_login':
    'La connexion avec Jellyfin est désactivée : les clients ne pourraient pas se connecter.',
  'media.seerr.unmanaged':
    'Utilisateurs dans Seerr que la console ne gère pas et qui peuvent faire des demandes : {n}. La synchronisation leur retire ce droit.',
  'media.seerr.orphans':
    'Utilisateurs dans Seerr sans utilisateur Jellyfin : {n}. Veuillez les supprimer dans Seerr.',
  'media.seerr.localLogin':
    "La connexion locale est activée dans Seerr. Les utilisateurs que Seerr a créés lors d'une connexion Jellyfin avant l'application des paramètres recommandés continuent ainsi de se connecter avec leur ancien mot de passe, même après un nouveau mot de passe. Désactivez-la dans Seerr sous Paramètres > Utilisateurs si personne n'en a besoin.",
  'media.seerr.apply': 'Appliquer les paramètres recommandés',
  'media.seerr.applyText':
    'Définit dans Seerr : nouvelles connexions via Jellyfin désactivées, nouveaux utilisateurs sans droits, connexion avec Jellyfin activée. Les autres paramètres restent inchangés.',
  'media.seerr.applied': 'Paramètres recommandés définis dans Seerr',
  'media.seerr.enable': 'Proposer les demandes aux clients',
  'media.seerr.enableHint': 'Possible seulement une fois toutes les vérifications réussies.',
  'media.seerr.enabled': 'Demandes activées sur {instance}',
  'media.seerr.disabled': 'Demandes désactivées sur {instance}',
  'media.seerr.disableTitle': 'Désactiver les demandes sur {instance}?',
  'media.seerr.disableText':
    'Les clients ne voient plus les demandes. La console retire à tous les accès dans Seerr le droit de faire des demandes. Les utilisateurs et les demandes sont conservés dans Seerr.',
  'media.seerr.disableConfirm': 'Désactiver',
  'media.seerr.sharedTitle': 'Plusieurs organisations sur cette instance',
  'media.seerr.sharedText':
    "{n} organisations ont un contingent sur {instance}. Dans Seerr, chaque accès connecté voit la liste des utilisateurs et, pour chaque titre, qui l'a demandé. Les clients avec demandes voient ainsi les noms de connexion et les souhaits d'autres clients.",
  'media.seerr.sharedConfirm': "J'ai vérifié cela et j'active quand même les demandes.",
  'media.seerr.enableConfirm': 'Activer',
  'media.seerr.notConfigured':
    "Aucun Seerr n'est enregistré pour cette instance. Saisissez l'adresse et la clé API chez le fournisseur.",
  'media.seerr.toProvider': 'Vers le fournisseur',
  'media.seerr.applyResult': 'Droits définis dans les demandes : {n}',
  'media.admin.synced':
    '{seen} accès streaming synchronisés, {missing} introuvables, {repaired} politiques adaptées',
  'media.dashboardSub': '{n} accès sur {max}',
  'providers.jellyfin.help':
    "Jellyfin 10.10 ou plus récent (10.11 recommandé), avec la configuration initiale terminée. Dans le tableau de bord Jellyfin, sous Clés API, créez une clé dédiée uniquement à weblion.one. La clé dispose de tous les droits d'administrateur.",
  'providers.jellyfin.url': "Adresse de l'instance",
  'providers.jellyfin.urlHint':
    "L'adresse que vos clients saisissent dans les apps Jellyfin, avec le chemin si Jellyfin fonctionne sous un chemin de base, p. ex. https://media.weblion.one.",
  'providers.jellyfin.urlInvalid':
    'Une adresse http ou https sans chaîne de requête ni identifiants, un chemin uniquement pour le chemin de base de Jellyfin, p. ex. https://media.weblion.one.',
  'providers.jellyfin.httpWarning':
    'Sans https, les clés API et les mots de passe transitent en clair sur le réseau. À utiliser uniquement dans un réseau privé.',
  'providers.jellyfin.apiKey': 'Clé API',
  'providers.jellyfin.apiKeyHint':
    "Tableau de bord > Clés API > Ajouter, nom de l'app p. ex. weblion.one. 32 caractères parmi 0-9 et a-f. Est enregistrée de manière chiffrée et n'est plus jamais affichée.",
  'providers.jellyfin.apiKeyInvalid':
    'Une clé API Jellyfin comporte exactement 32 caractères parmi 0-9 et a-f.',
  'providers.jellyfin.accountsText':
    'Accès streaming de cette instance, contingents des clients et reprise des utilisateurs créés directement dans Jellyfin.',
  'providers.jellyfin.toAccounts': 'Vers les accès streaming',
  'providers.jellyfin.seerr': 'Demandes (Seerr, facultatif)',
  'providers.jellyfin.seerrHelp':
    'Une instance Seerr connectée exactement à cette instance Jellyfin. Activation pour les clients sous Admin > Streaming.',
  'providers.jellyfin.seerrUrl': 'Adresse Seerr',
  'providers.jellyfin.seerrUrlHint':
    "L'adresse à laquelle vos clients ouvrent Seerr, p. ex. https://anfragen.weblion.one.",
  'providers.jellyfin.seerrUrlInvalid': 'Une adresse http ou https sans chaîne de requête ni identifiants.',
  'providers.jellyfin.seerrApiKey': 'Clé API Seerr',
  'providers.jellyfin.seerrApiKeyHint':
    "Seerr > Paramètres > Général > Clé API. La clé dispose de tous les droits dans Seerr. Est enregistrée de manière chiffrée et n'est plus jamais affichée.",
  'providers.jellyfin.seerrApiKeyInvalid': "Veuillez coller la clé telle que Seerr l'affiche.",
  'providers.jellyfin.seerrBoth': "L'adresse et la clé vont ensemble.",
  'providers.jellyfin.seerrRemove': 'Retirer Seerr',
  'admin.resources.mediaAccounts': 'Accès streaming',
  'admin.blocker.mediaAccounts': 'Accès streaming : {n}',
  'admin.blocker.mediaAllowances': 'Contingent streaming',
  'explorer.jellyfinPath':
    "Chemins relatifs à l'adresse de l'instance, p. ex. /Users ou /Library/VirtualFolders. Les clés, les jetons d'accès et les mots de passe sont masqués dans les réponses. /Auth/Keys et les endpoints de connexion sont bloqués.",
  'explorer.jellyfinBodyHint':
    'GET et DELETE envoient les paramètres en tant que query, POST en JSON. Toujours envoyer une politique (POST /Users/<id>/Policy) complète : Jellyfin réinitialise les champs manquants.',
};
