import type { storageDe } from './storage.de';

export const storageFr: Partial<Record<keyof typeof storageDe, string>> = {
  'nav.cloud': 'Stockage cloud',
  'storage.subtitle':
    "Comptes Nextcloud pour les fichiers, les calendriers et les contacts de votre équipe, avec de l'espace de stockage issu de votre contingent.",
  'storage.open': 'Ouvrir Nextcloud',
  'storage.create': 'Créer un compte',
  'storage.noAccess': "Vous n'avez pas accès au stockage cloud de cette organisation.",
  'storage.none.title': "Aucun stockage cloud souscrit pour l'instant",
  'storage.none.text':
    "Vous souscrivez le stockage cloud (Nextcloud) auprès de weblion.one. Dès qu'un contingent de stockage est configuré pour votre organisation, vous créez ici les comptes de votre équipe.",
  'storage.none.textReseller':
    "Vous souscrivez le stockage cloud (Nextcloud) auprès de {reseller}. Dès qu'un contingent de stockage est configuré pour votre organisation, vous créez ici les comptes de votre équipe.",
  'storage.noAllowanceAccounts':
    "Aucun contingent de stockage n'est plus configuré pour cette organisation. Les comptes existants continuent de fonctionner, mais il n'est pas possible d'en créer de nouveaux.",
  'storage.limit.accounts':
    "Tous les comptes de votre contingent sont attribués. Pour en créer d'autres, veuillez supprimer un compte ou étendre votre contingent.",
  'storage.limit.storage':
    "Votre contingent de stockage est entièrement attribué à des comptes. Réduisez un compte ou étendez votre contingent pour en créer d'autres.",
  'storage.allowance': 'Contingent de stockage',
  'storage.allowanceText':
    "Stockage que vous répartissez entre vos comptes. L'espace utilisé correspond à ce que les comptes occupent réellement.",
  'storage.toCustomers': 'Dont attribué à vos clients : {size} et {n} comptes',
  'storage.figure.booked': 'Souscrit',
  'storage.figure.allocated': 'Attribué',
  'storage.figure.used': 'Utilisé',
  'storage.figure.accounts': 'Comptes',
  'storage.accounts.of': '{n} sur {max}',
  'storage.accounts.ofUnlimited': '{n} (illimité)',
  'storage.meter.label': '{allocated} attribués, {used} utilisés, sur {quota}',
  'storage.meter.used': 'Utilisé',
  'storage.meter.allocated': 'Attribué',
  'storage.meter.free': 'Libre',
  'storage.instance': 'Instance',
  'storage.loginAt': 'Se connecter sur',
  'storage.dashboardSub': '{allocated} sur {quota} attribués',
  'storage.accounts': 'Comptes',
  'storage.accountsText':
    'Chaque compte dispose de son propre contingent de stockage et se connecte avec son nom de connexion.',
  'storage.lastSync': 'Utilisation mise à jour {when}',
  'storage.search': 'Rechercher un compte, un nom ou un e-mail…',
  'storage.empty': "Aucun compte pour l'instant",
  'storage.emptyText': 'Créez un compte pour chaque personne qui doit utiliser Nextcloud.',
  'storage.col.login': 'Nom de connexion',
  'storage.col.name': 'Nom',
  'storage.col.email': 'E-mail',
  'storage.col.storage': 'Stockage',
  'storage.col.status': 'Statut',
  'storage.col.lastLogin': 'Dernière connexion',
  'storage.copyLogin': 'Copier le nom de connexion',
  'storage.usage.of': '{used} sur {quota}',
  'storage.usage.unlimited': '{used} utilisés, illimité',
  'storage.usage.over': 'Contingent dépassé, envoi de fichiers bloqué',
  'storage.status.active': 'Actif',
  'storage.status.disabled': 'Désactivé',
  'storage.status.missing': 'Introuvable dans Nextcloud',
  'storage.lastLogin.never': 'Jamais',
  'storage.createTitle': 'Créer un compte cloud',
  'storage.createText':
    'Un compte Nextcloud pour une personne de votre équipe, avec son propre contingent de stockage.',
  'storage.name': "Nom d'utilisateur",
  'storage.name.placeholder': 'anna',
  'storage.name.preview': 'Nom de connexion :',
  'storage.name.hint':
    "Lettres minuscules, chiffres, point, trait d'union et tiret bas. Ne peut plus être modifié par la suite.",
  'storage.name.invalid':
    "Uniquement des lettres minuscules, des chiffres, le point, le trait d'union et le tiret bas, avec une lettre ou un chiffre au début et à la fin (32 caractères au maximum).",
  'storage.name.tooLong': 'Le nom de connexion ne doit pas dépasser {max} caractères.',
  'storage.name.taken': 'Ce compte existe déjà.',
  'storage.displayName': "Nom d'affichage",
  'storage.displayName.placeholder': 'Anna Muster',
  'storage.email': 'Adresse e-mail',
  'storage.email.required': "Obligatoire pour l'invitation.",
  'storage.email.invalid': 'Adresse e-mail non valide.',
  'storage.email.needsPassword':
    'Modifiable uniquement avec le droit de redéfinir les mots de passe : les invitations et les liens de réinitialisation du mot de passe sont envoyés à cette adresse.',
  'storage.email.changeHint':
    'Nextcloud enverra désormais les notifications et les invitations à la nouvelle adresse.',
  'storage.quota': 'Contingent de stockage',
  'storage.quota.freeHint': 'Encore libre dans le contingent : {free}',
  'storage.quota.maxHint': 'Au maximum {max} (encore libre dans le contingent : {free})',
  'storage.quota.invalid': 'Saisissez un nombre entier à partir de 1 Go.',
  'storage.quota.step':
    'À partir de 1024 Go, uniquement par paliers de 512 Go (1024, 1536, 2048 …), Nextcloud arrondit les autres valeurs.',
  'storage.quota.tooLarge': 'Le contingent ne permet pas plus de {max}.',
  'storage.quota.current': 'Actuellement {quota}. Laissez vide pour le conserver.',
  'storage.quota.currentUnlimited': 'Actuellement illimité. Laissez vide pour le conserver.',
  'storage.quota.used': 'Utilisé : {used}',
  'storage.quota.belowUsageTitle': "Inférieur à l'espace utilisé",
  'storage.quota.belowUsage':
    "Le compte occupe déjà {used}. Tous les fichiers sont conservés, mais il n'est plus possible d'en envoyer de nouveaux tant que des fichiers n'ont pas été supprimés.",
  'storage.delivery': 'Accès',
  'storage.delivery.password': 'Générer le mot de passe maintenant',
  'storage.delivery.passwordText':
    'Le mot de passe est affiché une seule fois. Vous le transmettez vous-même. Si une adresse e-mail est indiquée, Nextcloud envoie en plus un e-mail de bienvenue.',
  'storage.delivery.invite': 'Invitation par e-mail',
  'storage.delivery.inviteText':
    'Nextcloud envoie un lien avec lequel la personne définit elle-même son mot de passe.',
  'storage.delivery.needsEmail': 'Une invitation nécessite une adresse e-mail.',
  'storage.created': 'Compte {username} créé',
  'storage.createdInvite': 'Compte créé, invitation envoyée à {email}',
  'storage.createdTitle': 'Compte créé',
  'storage.editTitle': 'Modifier {username}',
  'storage.updated': '{username} enregistré',
  'storage.disable': 'Désactiver',
  'storage.enable': 'Activer',
  'storage.disableTitle': 'Désactiver {username}?',
  'storage.disableText':
    'La personne ne peut plus se connecter et ses appareils ne se synchronisent plus. Les fichiers et le contingent sont conservés.',
  'storage.enableTitle': 'Activer {username}?',
  'storage.enableText': 'La personne peut de nouveau se connecter.',
  'storage.enabledToast': '{username} activé',
  'storage.disabledToast': '{username} désactivé',
  'storage.resetPassword': 'Redéfinir le mot de passe',
  'storage.passwordTitle': 'Nouveau mot de passe pour {username}?',
  'storage.passwordText':
    "L'ancien mot de passe ne fonctionnera plus ensuite. Le nouveau mot de passe est affiché une seule fois.",
  'storage.passwordNewTitle': 'Nouveau mot de passe',
  'storage.resendInvite': "Renvoyer l'invitation",
  'storage.invitedToast': 'Invitation envoyée à {email}',
  'storage.deleteTitle': 'Supprimer {username}?',
  'storage.deleteConfirm': 'Supprimer définitivement',
  'storage.deleteWarningTitle': 'Tous les fichiers seront supprimés',
  'storage.deleteWarning':
    'Le compte est supprimé dans Nextcloud, avec tous ses fichiers ({used}), calendriers, contacts et partages. Cette action est irréversible.',
  'storage.deletedToast': '{username} supprimé',
  'storage.allowance.setUp': 'Configurer',
  'storage.allowance.setUpTitle': 'Configurer le stockage cloud de {name}',
  'storage.allowance.editTitle': 'Stockage cloud de {name}',
  'storage.allowance.dialogText':
    "Stockage total et nombre de comptes que l'organisation répartit elle-même.",
  'storage.allowance.instanceHint':
    "Tous les comptes de l'organisation se trouvent sur cette instance Nextcloud.",
  'storage.allowance.instanceLocked': "L'instance ne peut être modifiée que tant qu'aucun compte n'y existe.",
  'storage.allowance.instanceLockedCustomers':
    "L'instance ne peut être modifiée que tant qu'aucun client du revendeur n'y a de contingent.",
  'storage.allowance.quota': 'Stockage total',
  'storage.allowance.allocatedHint': 'Déjà attribué : {size}',
  'storage.allowance.belowAllocated': "Au moins {size}, c'est ce qui est déjà attribué.",
  'storage.allowance.maxAccounts': 'Comptes au maximum',
  'storage.allowance.maxAccountsHint': 'Laissez vide pour un nombre illimité de comptes.',
  'storage.allowance.maxInvalid': 'Saisissez un nombre entier à partir de 1 ou laissez le champ vide.',
  'storage.allowance.maxBelowAccounts': "Au moins {n}, c'est le nombre de comptes existants.",
  'storage.allowance.unlimited': 'illimité',
  'storage.allowance.enableModuleHint':
    '{org} ne voit le stockage cloud dans la console que si le module est actif.',
  'storage.allowance.moduleOff': 'Sans le module "{module}", l\'organisation ne voit pas le contingent.',
  'storage.allowance.resellerHint':
    'Un revendeur répartit ce contingent entre ses propres comptes et ses clients.',
  'storage.allowance.saved': 'Contingent de stockage enregistré',
  'storage.allowance.remove': 'Retirer le contingent',
  'storage.allowance.removeTitle': 'Retirer le stockage cloud de {name}?',
  'storage.allowance.removeText':
    "L'organisation ne pourra ensuite plus créer de comptes Nextcloud. Le module reste actif jusqu'à ce que vous le désactiviez.",
  'storage.allowance.removeBlocked':
    'Possible uniquement sans comptes. Veuillez supprimer les comptes ou les attribuer à une autre organisation.',
  'storage.allowance.removeBlockedCustomers':
    "Possible uniquement sans contingents de clients. Retirez d'abord les contingents des {n} clients.",
  'storage.allowance.removed': 'Contingent de stockage retiré',
  'storage.admin.tab': 'Comptes cloud',
  'storage.admin.tabHint':
    'Vous configurez les contingents de stockage chez le client, les clients créent eux-mêmes les comptes. Vous reprenez ci-dessous les utilisateurs créés directement dans Nextcloud.',
  'storage.admin.search': 'Rechercher un nom de connexion, un nom ou un e-mail…',
  'storage.admin.filterCustomer': 'Filtrer par client',
  'storage.admin.allCustomers': 'Tous les clients',
  'storage.admin.filterInstance': 'Filtrer par instance',
  'storage.admin.allInstances': 'Toutes les instances',
  'storage.admin.empty': 'Aucun compte cloud',
  'storage.admin.emptyText':
    "Les comptes apparaissent ici dès que des clients les créent ou que vous reprenez les utilisateurs d'une instance.",
  'storage.admin.synced': '{seen} comptes cloud synchronisés, {missing} manquants',
  'storage.admin.cardText': "Stockage que l'organisation peut répartir entre des comptes Nextcloud.",
  'storage.admin.none': 'Aucun stockage cloud',
  'storage.admin.noneText':
    "Configurez un contingent pour que l'organisation puisse créer des comptes Nextcloud.",
  'storage.admin.showAccounts': 'Afficher les comptes',
  'storage.admin.noInstance': "Aucune instance Nextcloud n'est encore connectée comme fournisseur.",
  'storage.admin.noModule': 'sans stockage cloud',
  'storage.admin.needsAllowance': "Le client a besoin d'un contingent de stockage sur la même instance.",
  'storage.admin.assignText':
    'Le compte se trouve sur {instance}. Le client le gère ensuite dans sa console.',
  'storage.admin.assignQuotaHint':
    "Le contingent du compte compte ensuite dans le contingent de stockage du client, même s'il le dépasse.",
  'storage.admin.unassignText':
    '{org} ne voit ensuite plus le compte. Le compte et ses fichiers sont conservés dans Nextcloud.',
  'storage.unmanaged.title': 'Utilisateurs non gérés',
  'storage.unmanaged.text':
    'Utilisateurs créés directement dans Nextcloud. Les utilisateurs repris conservent leur nom et leur contingent.',
  'storage.unmanaged.load': 'Récupérer les utilisateurs',
  'storage.unmanaged.reload': 'Recharger',
  'storage.unmanaged.hint':
    "Récupère les utilisateurs de {instance} et affiche ceux que la console ne gère pas encore. Les administrateurs de l'instance n'apparaissent jamais.",
  'storage.unmanaged.empty': 'Tous les utilisateurs de {instance} sont gérés',
  'storage.unmanaged.import': 'Reprendre',
  'storage.unmanaged.importTitle': 'Reprendre {username}',
  'storage.unmanaged.importText':
    "La console gère ensuite l'utilisateur. Le nom, le contingent et les fichiers restent inchangés.",
  'storage.unmanaged.noCustomer': "– n'attribuer à aucun client –",
  'storage.unmanaged.unlimitedHint':
    "L'utilisateur n'a pas de contingent (illimité). Chez le client, il compte avec l'espace utilisé jusqu'à ce qu'un contingent soit défini.",
  'storage.unmanaged.imported': '{username} repris',
  'storage.reseller.cardText':
    'Stockage issu de votre contingent, que le client répartit entre ses propres comptes Nextcloud.',
  'storage.reseller.none': 'Aucun stockage cloud attribué',
  'storage.reseller.noneText':
    "Attribuez au client une partie de votre contingent pour qu'il puisse créer des comptes Nextcloud.",
  'storage.reseller.pool': 'Votre contingent : {free} libres sur {quota}',
  'storage.reseller.noPool':
    "Votre organisation n'a pas encore de contingent de stockage cloud. Adressez-vous à weblion.one pour souscrire du stockage.",
  'storage.reseller.dialogText':
    'Issu de votre contingent sur {instance}. Le client répartit lui-même le stockage entre ses comptes.',
  'storage.reseller.quotaHint': 'Au maximum {max} de votre contingent',
  'storage.reseller.accountsLeft': 'Au maximum {n} de votre contingent',
  'storage.reseller.maxRequired':
    'Votre contingent a un nombre maximal de comptes. Saisissez au maximum {n}.',
  'storage.reseller.maxTooHigh': 'Il ne reste que {n} comptes libres dans votre contingent.',
  'storage.reseller.enablesModule': 'Cela active aussi le module Stockage cloud pour le client.',
  'storage.reseller.removeText':
    'Le client ne pourra ensuite plus créer de comptes Nextcloud. Le stockage retourne dans votre contingent.',
  'storage.reseller.removeBlocked':
    "Possible uniquement sans comptes. Le client doit d'abord supprimer ses comptes.",
  'providers.nextcloud.help':
    'Créez dans Nextcloud un compte admin dédié à la console (membre du groupe "admin") et créez pour celui-ci un mot de passe d\'application sous Paramètres personnels > Sécurité. Pour les invitations, l\'instance doit pouvoir envoyer des e-mails (Administration > Paramètres de base > Serveur e-mail).',
  'providers.nextcloud.url': "URL de l'instance",
  'providers.nextcloud.urlHint':
    "L'adresse à laquelle les utilisateurs se connectent, p. ex. https://cloud.weblion.one",
  'providers.nextcloud.username': 'Utilisateur admin',
  'providers.nextcloud.usernameHint':
    'Nom de connexion du compte admin de la console, pas votre compte personnel.',
  'providers.nextcloud.appPassword': "Mot de passe d'application",
  'providers.nextcloud.appPasswordHint':
    "Paramètres personnels > Sécurité > Appareils & sessions > Créer un nouveau mot de passe d'application.",
  'providers.nextcloud.groupPrefix': 'Préfixe de groupe',
  'providers.nextcloud.groupPrefixHint':
    'Facultatif. Chaque organisation reçoit le groupe <préfixe><code> afin que les collègues puissent partager entre eux. Par défaut : {prefix}',
  'providers.nextcloud.groupPrefixChange':
    "Par défaut : {prefix}. Un nouveau préfixe ne s'applique qu'aux nouveaux comptes, les comptes existants restent dans leurs groupes.",
  'providers.nextcloud.groupPrefixInvalid':
    "Lettres minuscules, chiffres, point, trait d'union et tiret bas, 31 caractères au maximum.",
  'providers.nextcloud.accountsText':
    'Comptes de cette instance, attribution aux clients et reprise des utilisateurs créés directement dans Nextcloud.',
  'providers.nextcloud.toAccounts': 'Vers les comptes cloud',
  'explorer.nextcloudPath':
    "Chemins OCS, p. ex. /ocs/v2.php/cloud/users?search=anna. Les mots de passe dans les réponses sont masqués, les mots de passe d'application ne peuvent pas être gérés ici.",
  'explorer.nextcloudBodyHint':
    'GET et DELETE envoient les paramètres en tant que query, POST et PUT en tant que formulaire, p. ex. { "key": "quota", "value": "10 GB" }.',
};
