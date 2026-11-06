import type { websitesDe } from './websites.de';

export const websitesFr: Partial<Record<keyof typeof websitesDe, string>> = {
  'providers.cloudpanel.help':
    "Un serveur CloudPanel dédié (CE 2.5.0 ou plus récent) pour les sites web des clients, et non le serveur de la console. La console se connecte via SSH avec une clé ed25519 en tant qu'utilisateur agent et ne peut y exécuter que le wrapper root weblion-clp. Installez-le avec deploy/cloudpanel-agent/install.sh depuis le dépôt; le script affiche l'empreinte de la clé d'hôte.",
  'providers.cloudpanel.host': 'Hôte SSH',
  'providers.cloudpanel.hostHint':
    "Nom d'hôte ou adresse IP par lequel la console atteint le serveur via SSH.",
  'providers.cloudpanel.hostInvalid': "Un nom d'hôte ou une adresse IP.",
  'providers.cloudpanel.port': 'Port SSH',
  'providers.cloudpanel.username': 'Utilisateur SSH',
  'providers.cloudpanel.usernameHint': "L'utilisateur agent que crée install.sh. Par défaut : weblion-agent.",
  'providers.cloudpanel.privateKey': 'Clé privée (ed25519)',
  'providers.cloudpanel.privateKeyHint':
    "Clé OpenSSH non chiffrée (-----BEGIN OPENSSH PRIVATE KEY-----). Elle est enregistrée sous forme chiffrée et n'est plus jamais affichée. Recommandé : une clé dédiée par serveur.",
  'providers.cloudpanel.generate': 'Générer une paire de clés',
  'providers.cloudpanel.generated':
    "Nouvelle paire de clés générée. Elle ne s'applique qu'une fois que vous enregistrez; installez la clé publique sur le serveur.",
  'providers.cloudpanel.publicKey': 'Clé publique',
  'providers.cloudpanel.publicKeyHint':
    "Transmettez cette clé à install.sh sur le serveur (--public-key). Elle n'est pas secrète.",
  'providers.cloudpanel.hostKey': "Empreinte de la clé d'hôte",
  'providers.cloudpanel.hostKeyHint':
    "SHA256:..., tel qu'affiché par install.sh ou \"ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub\" sur le serveur. Une autre clé d'hôte bloque la connexion jusqu'à ce que vous la modifiiez ici.",
  'providers.cloudpanel.hostKeyInvalid': 'SHA256: suivi de 43 caractères, p. ex. SHA256:Ab3...',
  'providers.cloudpanel.accessHost': 'Hôte pour les clients (SFTP/SSH, facultatif)',
  'providers.cloudpanel.accessHostHint':
    "Ce nom est affiché aux clients pour SFTP et SSH, p. ex. web1.weblion.cloud (avec des enregistrements A/AAAA). Par défaut : l'hôte SSH.",
  'providers.cloudpanel.accessHostInvalid': "Un nom d'hôte comme web1.weblion.cloud.",
  'providers.cloudpanel.ipv4': 'Adresses IPv4 publiques (facultatif)',
  'providers.cloudpanel.ipv6': 'Adresses IPv6 publiques (facultatif)',
  'providers.cloudpanel.ipsHint':
    'Séparées par des virgules, pour la vérification DNS avant les certificats SSL. Par défaut : ce que le serveur indique.',
  'providers.cloudpanel.phpVersions': 'Versions PHP pour les clients (facultatif)',
  'providers.cloudpanel.phpVersionsHint':
    'Séparées par des virgules, p. ex. 8.3, 8.4 (par défaut). Seules les versions installées sur le serveur sont proposées.',
  'providers.cloudpanel.templates': 'Applications pour les clients (facultatif)',
  'providers.cloudpanel.templatesHint':
    'Modèles vhost comme dans CloudPanel, séparés par des virgules; un * à la fin correspond à tous les noms qui commencent ainsi (Laravel*). Par défaut : Generic, WordPress, WooCommerce.',
  'providers.cloudpanel.nodejs': 'Sites web Node.js pour les clients',
  'providers.cloudpanel.nodejsHint':
    "Uniquement si l'agent a été installé avec --nodejs. Les clients ont en plus besoin de Node.js dans leur contingent.",
  'providers.cloudpanel.websites': 'Sites web',
  'providers.cloudpanel.websitesText':
    'Sites web de ce serveur, leurs bases de données et leur attribution aux clients.',
  'providers.cloudpanel.toWebsites': 'Vers les sites web',
  'providers.cloudpanel.consoleKey': 'Clé SSH de la console',
  'providers.cloudpanel.installCommand': 'Installation sur le serveur (en tant que root)',
  'providers.cloudpanel.installCommandHint':
    "Remplacez les espaces réservés : --from par les adresses IP sortantes de la console, --protect-domain et --protect-user par chaque site de l'exploitant sur ce serveur.",
  'websites.admin.synced': '{seen} sites web synchronisés, {missing} absents du serveur',
  'hosting.kind.website': 'Site web',
  'hosting.kind.webspace': 'Espace web',
  'websites.status.creating': 'Création en cours',
  'websites.status.deleting': 'Suppression en cours',
  'websites.status.error': 'État incertain',
  'websites.status.active': 'Actif',
  'websites.status.missing': 'Absent du serveur',
  'providers.cloudpanel.explorerHint':
    "L'agent weblion-clp ne répond ici qu'aux accès en lecture : GET /info (versions, modèles), /list (sites gérés) et /unmanaged (sites non gérés).",
  'websites.type.php': 'PHP',
  'websites.type.static': 'Statique',
  'websites.type.nodejs': 'Node.js',
  'websites.type.python': 'Python',
  'websites.type.reverse-proxy': 'Proxy inverse',
  'websites.list.subtitle':
    'Sites web sur nos serveurs avec SFTP/SSH, bases de données et certificats SSL, ainsi que des espaces web avec Plesk.',
  'websites.list.create': 'Créer un site web',
  'websites.list.full': "Votre contingent est épuisé. Pour d'autres sites web, contactez-nous.",
  'websites.list.serverDown': 'Serveur injoignable',
  'websites.list.optionsError': 'Contingent indisponible',
  'websites.list.empty': 'Aucun site web pour le moment',
  'websites.list.emptyText':
    'Créez le premier. Vous recevez un accès SFTP/SSH et, si vous le souhaitez, une base de données.',
  'websites.list.noAllowance': 'Aucun contingent de sites web',
  'websites.list.noAllowanceText':
    "Aucun contingent de sites web n'est configuré pour votre organisation. Adressez-vous à weblion.",
  'websites.list.noAllowanceReseller':
    "Aucun contingent de sites web n'est configuré pour votre organisation. Adressez-vous à votre fournisseur {reseller}.",
  'websites.list.credentialsPending': 'Identifiants manquants : définissez un nouveau mot de passe.',
  'websites.allowance.title': 'Contingent de sites web',
  'websites.allowance.sites': 'Sites web',
  'websites.allowance.databases': 'Bases de données',
  'websites.allowance.of': '{n} sur {max}',
  'websites.allowance.types': 'Types autorisés',
  'websites.allowance.instance': 'Serveur',
  'websites.allowance.customersIncluded':
    'Comprend les contingents des clients sur ce serveur ({n} clients).',
  'websites.allowance.adminText':
    'Serveur pour les nouveaux sites web, nombre maximal de sites web et de bases de données, types autorisés.',
  'websites.allowance.setUp': 'Configurer',
  'websites.allowance.setUpTitle': 'Configurer le contingent de sites web de {name}',
  'websites.allowance.editTitle': 'Contingent de sites web de {name}',
  'websites.allowance.dialogText':
    "Les clients créent eux-mêmes leurs sites web jusqu'à épuisement du contingent. Il n'y a pas de limite de stockage, la consommation est affichée.",
  'websites.allowance.instanceHint':
    "Les nouveaux sites web de l'organisation sont créés sur ce serveur CloudPanel.",
  'websites.allowance.instanceLocked':
    "Le revendeur a des clients avec un contingent de sites web sur ce serveur. Le serveur ne peut être changé qu'une fois qu'il n'y en a plus.",
  'websites.allowance.instanceReseller':
    'Les clients de {reseller} reçoivent leurs sites web sur le serveur du revendeur.',
  'websites.allowance.instanceChange':
    'Les sites web existants restent sur {instance}; seuls les nouveaux sites web sont créés sur le serveur choisi.',
  'websites.allowance.noInstance':
    "Il n'existe pas encore de serveur CloudPanel. Configurez d'abord un fournisseur.",
  'websites.allowance.maxSites': 'Sites web au maximum',
  'websites.allowance.maxDatabases': 'Bases de données au maximum',
  'websites.allowance.countInvalid': 'Saisissez un nombre entier à partir de 0.',
  'websites.allowance.belowSites': "Au moins {n}, c'est le nombre de sites web existants ou attribués.",
  'websites.allowance.belowDatabases':
    "Au moins {n}, c'est le nombre de bases de données existantes ou attribuées.",
  'websites.allowance.committed': 'Déjà utilisé : {n}',
  'websites.allowance.poolLeft': 'Au maximum {n} du contingent du revendeur',
  'websites.allowance.poolSites': 'Il ne reste que {n} sites web libres dans le contingent du revendeur.',
  'websites.allowance.poolDatabases':
    'Il ne reste que {n} bases de données libres dans le contingent du revendeur.',
  'websites.allowance.resellerNone':
    "Le revendeur {reseller} n'a pas de contingent de sites web. Configurez d'abord le sien; les contingents de ses clients en sont issus.",
  'websites.allowance.notInPool': 'Hors du contingent de {reseller}',
  'websites.allowance.nodejsOff':
    'Les sites web Node.js pour les clients ne sont pas autorisés sur ce serveur (paramètre du fournisseur).',
  'websites.allowance.nodejsOn': 'Node.js autorisé',
  'websites.allowance.nodejsOffShort': 'Node.js non autorisé',
  'websites.allowance.typesRequired': 'Choisissez au moins un type.',
  'websites.allowance.enableModuleHint':
    '{org} verra ensuite la page Hébergement web et pourra créer des sites web.',
  'websites.allowance.moduleOff': 'Sans le module "{module}", l\'organisation ne voit pas ses sites web.',
  'websites.allowance.resellerHint':
    "Le contingent d'un revendeur couvre ses propres sites web et les contingents qu'il attribue à ses clients.",
  'websites.allowance.saved': 'Contingent de sites web enregistré',
  'websites.allowance.remove': 'Retirer le contingent',
  'websites.allowance.removeTitle': 'Retirer le contingent de sites web de {name}?',
  'websites.allowance.removeText':
    "L'organisation ne pourra plus créer de sites web. Le module reste activé.",
  'websites.allowance.removeBlocked':
    "Possible uniquement sans sites web. L'organisation en a encore {n}; supprimez-les ou attribuez-les autrement.",
  'websites.allowance.removeBlockedCustomers':
    'Possible uniquement sans contingents clients. {n} clients ont un contingent de sites web issu de celui-ci.',
  'websites.allowance.removed': 'Contingent de sites web retiré',
  'websites.allowance.none': 'Aucun contingent de sites web',
  'websites.allowance.noneText': "Sans contingent, l'organisation ne peut pas créer de sites web.",
  'websites.allowance.showWebsites': 'Sites web du serveur',
  'websites.create.title': 'Créer un site web',
  'websites.create.text':
    'Un domaine avec son pendant www, un utilisateur pour SFTP/SSH et, si vous le souhaitez, une base de données.',
  'websites.create.domain': 'Domaine',
  'websites.create.domainHint': 'Avec ou sans www, les deux sont servis.',
  'websites.create.domainAscii': 'Sera créé sous la forme {ascii}. Avec ou sans www, les deux sont servis.',
  'websites.create.domainInvalid': 'Domaine non valide, p. ex. shop.exemple.ch.',
  'websites.create.type': 'Type',
  'websites.create.type.php': 'Application PHP',
  'websites.create.type.phpText': 'WordPress, WooCommerce ou vos propres fichiers PHP',
  'websites.create.type.static': 'Site web statique',
  'websites.create.type.staticText': 'Uniquement HTML, CSS et images',
  'websites.create.type.nodejs': 'Node.js',
  'websites.create.type.nodejsText': 'Votre propre application, que vous démarrez via SSH',
  'websites.create.onlyType': 'Type : {type}',
  'websites.create.application': 'Application',
  'websites.create.applicationHint': 'Détermine la configuration du serveur web. Le site web démarre vide.',
  'websites.create.wordpressHint':
    'Vous transférez les fichiers WordPress via SFTP. Nous créons la base de données en même temps.',
  'websites.create.templateInvalid': "Le nom d'un modèle du serveur, p. ex. Generic.",
  'websites.create.phpVersion': 'Version PHP',
  'websites.create.phpStaffHint':
    "Selon le paramètre du fournisseur; le serveur vérifie qu'elle est installée.",
  'websites.create.phpInvalid': 'Une version comme 8.4.',
  'websites.create.recommended': 'recommandé',
  'websites.create.nodejsVersion': 'Version Node.js',
  'websites.create.nodejsHint':
    "Le port est attribué automatiquement, vous démarrez l'application via SSH (p. ex. PM2). La création prend plus de temps.",
  'websites.create.siteUser': "Nom d'utilisateur (SFTP/SSH)",
  'websites.create.siteUserHint':
    'Utilisateur Linux du site web (site user) : 3 à 32 caractères, lettres minuscules, chiffres et "-".',
  'websites.create.siteUserInvalid':
    '3 à 32 caractères : lettres minuscules, chiffres et "-", commence par une lettre, ne se termine pas par "-".',
  'websites.create.siteUserReserved': 'Ce nom est réservé au système. Choisissez-en un autre.',
  'websites.create.database': 'Créer une base de données',
  'websites.create.databaseHint':
    'Base de données MySQL avec son propre utilisateur, vous verrez le mot de passe une seule fois ensuite.',
  'websites.create.databaseNoRoom': "Votre contingent n'a plus de place pour d'autres bases de données.",
  'websites.create.password': 'Mot de passe pour SFTP/SSH',
  'websites.create.after':
    'Utilisation ensuite : {sites} sur {maxSites} sites web, {databases} sur {maxDatabases} bases de données.',
  'websites.create.submit': 'Créer un site web',
  'websites.create.pending':
    "Configuration du site web en cours. Cela prend généralement moins d'une minute (plus longtemps pour Node.js).",
  'websites.create.done': 'Site web {domain} créé',
  'websites.create.unknownHint':
    "Si le site web apparaît ensuite dans la liste, définissez-y un nouveau mot de passe pour obtenir l'accès.",
  'websites.password.label': 'Mot de passe',
  'websites.password.generate': 'Générer',
  'websites.password.generateText': '24 caractères aléatoires, sûrs et faciles à saisir',
  'websites.password.choose': 'Mot de passe personnalisé',
  'websites.password.chooseText': "Si vous avez besoin d'un mot de passe précis",
  'websites.password.own': 'Votre mot de passe',
  'websites.password.rules': 'Règles du mot de passe',
  'websites.password.rule.length': '12 à 128 caractères',
  'websites.password.rule.characters':
    "Lettres, chiffres et !#%*+,-./;<=>?@^_{|}~ (pas d'espaces, de guillemets, $ : ( ) & \\ `)",
  'websites.password.submit': 'Définir un nouveau mot de passe',
  'websites.creds.title': 'Identifiants (visibles uniquement maintenant)',
  'websites.creds.text':
    "Veuillez enregistrer les identifiants maintenant, p. ex. dans un gestionnaire de mots de passe. weblion n'enregistre aucun mot de passe et ne peut pas les afficher à nouveau.",
  'websites.creds.newPassword': 'Nouveau mot de passe (visible uniquement maintenant)',
  'websites.creds.sftp': 'SFTP et SSH',
  'websites.creds.database': 'Base de données',
  'websites.creds.password': 'Mot de passe',
  'websites.creds.passwordChosen': 'Le mot de passe que vous avez choisi',
  'websites.creds.sftpLink': 'Ouvrir dans un gestionnaire de fichiers :',
  'websites.creds.sshLine': 'Dans un terminal :',
  'websites.creds.onceText':
    "Après la fermeture, le mot de passe n'est plus visible. Si vous l'oubliez, définissez-en un nouveau.",
  'websites.creds.saved': "J'ai enregistré les identifiants",
  'websites.detail.open': 'Ouvrir le site web',
  'websites.detail.refreshError': "Échec de l'actualisation",
  'websites.detail.missingTitle': 'Ne figure plus sur le serveur',
  'websites.detail.missingText':
    "Le serveur ne signale plus ce site web depuis le {date} (supprimé dans CloudPanel ou plus géré). Aucune modification n'est possible. Adressez-vous à weblion si ce n'était pas voulu.",
  'websites.detail.creatingText': "Le serveur configure le site web. Cette page s'actualise automatiquement.",
  'websites.detail.deletingText': "Le serveur supprime le site web. Cette page s'actualise automatiquement.",
  'websites.detail.errorTitle': 'Dernière modification non terminée',
  'websites.detail.errorText':
    "Le serveur n'a pas répondu. La prochaine synchronisation clarifiera l'état, après quoi le site web sera de nouveau utilisable.",
  'websites.detail.credentialsPendingTitle': 'Identifiants non affichés',
  'websites.detail.credentialsPending':
    "Les identifiants n'ont pas été affichés. Définissez un nouveau mot de passe.",
  'websites.detail.offBusy': 'Possible uniquement une fois la modification en cours terminée.',
  'websites.detail.offError': "Possible uniquement une fois que la synchronisation aura clarifié l'état.",
  'websites.detail.offMissing': 'Impossible : le serveur ne signale plus ce site web.',
  'websites.detail.noFacts': 'Pas encore de données du serveur.',
  'websites.detail.synced': 'Dernière synchronisation {when} · créé le {created}',
  'websites.access.title': 'Accès (SFTP/SSH)',
  'websites.access.text': 'Un utilisateur pour les fichiers (SFTP) et le terminal (SSH) sur le port 22.',
  'websites.access.host': 'Hôte',
  'websites.access.port': 'Port',
  'websites.access.username': "Nom d'utilisateur",
  'websites.access.home': 'Répertoire personnel',
  'websites.access.webRoot': 'Répertoire web',
  'websites.access.newPassword': 'Nouveau mot de passe',
  'websites.access.newPasswordHint': 'Définit un nouveau mot de passe pour SFTP et SSH.',
  'websites.access.passwordTitle': 'Nouveau mot de passe pour {user}',
  'websites.access.passwordText':
    "L'ancien mot de passe ne fonctionnera plus ensuite. Les processus en cours et les sessions SSH ouvertes sont maintenus.",
  'websites.access.passwordDone': 'Nouveau mot de passe défini',
  'websites.access.helpUpload': 'Chargez les fichiers du site web dans le répertoire web.',
  'websites.access.helpCron': 'Vous configurez les tâches planifiées via SSH :',
  'websites.access.helpLogs': "Les journaux d'accès et d'erreurs se trouvent dans",
  'websites.access.helpPassword':
    "weblion n'enregistre pas les mots de passe. Si vous en oubliez un, définissez-en un nouveau.",
  'websites.runtime.title': 'Environnement',
  'websites.runtime.type': 'Type',
  'websites.runtime.php': 'Version PHP',
  'websites.runtime.application': 'Application',
  'websites.runtime.nodejs': 'Version Node.js',
  'websites.runtime.appPort': 'Port applicatif',
  'websites.runtime.phpHint': 'weblion modifie la version et les paramètres PHP sur demande.',
  'websites.runtime.staticHint': 'Le serveur web livre directement les fichiers du répertoire web.',
  'websites.runtime.nodejsHint':
    'Démarrez votre application via SSH (p. ex. avec PM2) et faites-la écouter sur le port {port}. Le serveur web y redirige le domaine.',
  'websites.ssl.title': 'Certificat SSL',
  'websites.ssl.state': 'Certificat',
  'websites.ssl.expires': "Valable jusqu'au",
  'websites.ssl.covers': 'Couvre',
  'websites.ssl.letsEncrypt': "Let's Encrypt jusqu'au {date}",
  'websites.ssl.letsEncryptOnly': "Let's Encrypt",
  'websites.ssl.until': "Valable jusqu'au {date}",
  'websites.ssl.unknownExpiry': "Date d'expiration inconnue",
  'websites.ssl.expired': 'Expiré le {date}',
  'websites.ssl.none': 'Aucun certificat',
  'websites.ssl.noneHint': "Émettez un certificat Let's Encrypt dès que le domaine pointe vers le serveur.",
  'websites.ssl.invalid': 'Aucun certificat valide',
  'websites.ssl.invalidHint':
    "Les nouveaux sites web ont un certificat autosigné auquel les navigateurs ne font pas confiance. Émettez un certificat Let's Encrypt.",
  'websites.ssl.daysLeft': 'Encore valable {days} jours',
  'websites.ssl.issue': "Émettre un certificat Let's Encrypt",
  'websites.ssl.issueShort': 'Émettre le certificat',
  'websites.ssl.reissue': 'Émettre à nouveau',
  'websites.ssl.issueHint': "Vérifie d'abord le DNS du domaine et de son pendant www.",
  'websites.ssl.renewal': 'CloudPanel renouvelle le certificat automatiquement.',
  'websites.ssl.dialogTitle': 'Certificat SSL pour {domain}',
  'websites.ssl.dialogText':
    "Let's Encrypt vérifie que le domaine et son pendant www pointent vers ce serveur. Nous le vérifions au préalable.",
  'websites.ssl.ready': 'Les deux noms pointent vers le serveur. Le certificat peut être émis.',
  'websites.ssl.notReady': 'Le DNS ne pointe pas encore vers le serveur',
  'websites.ssl.force': 'Essayer quand même',
  'websites.ssl.pending': "Let's Encrypt vérifie le domaine. Cela peut prendre jusqu'à trois minutes.",
  'websites.ssl.issued': 'Certificat émis pour {domain}',
  'websites.dns.title': 'DNS',
  'websites.dns.text': 'Enregistrements A et AAAA dont le domaine et son pendant www ont besoin.',
  'websites.dns.hint':
    'Vérifiez que le domaine pointe vers le serveur. Vous définissez les enregistrements là où votre domaine est géré.',
  'websites.dns.check': 'Vérifier le DNS',
  'websites.dns.recheck': 'Vérifier à nouveau',
  'websites.dns.checkFailed': 'Échec de la vérification DNS',
  'websites.dns.name': 'Nom',
  'websites.dns.type': 'Type',
  'websites.dns.value': 'Valeur',
  'websites.dns.statusCol': 'Statut',
  'websites.dns.present': 'présent',
  'websites.dns.absent': 'absent',
  'websites.dns.answers': 'Ce que répond le DNS public',
  'websites.dns.needed': 'Ces enregistrements manquent encore :',
  'websites.dns.status.ok': 'Pointe vers le serveur',
  'websites.dns.status.elsewhere': 'Pointe ailleurs',
  'websites.dns.status.missing': 'Aucun enregistrement',
  'websites.dns.status.error': 'Échec de la requête',
  'websites.dns.blocker.missing':
    "Au moins un nom n'a pas d'enregistrement A ou AAAA. Créez les enregistrements manquants et vérifiez à nouveau (les modifications prennent souvent quelques minutes).",
  'websites.dns.blocker.elsewhere':
    "Au moins un nom pointe vers une autre adresse (ancien serveur ou CDN). Derrière un CDN comme Cloudflare, l'émission peut tout de même réussir.",
  'websites.dns.blocker.error': "Le DNS n'a pas pu être interrogé. Vérifiez à nouveau plus tard.",
  'websites.dns.foreign': 'Adresses tierces à supprimer : {ips}',
  'websites.dns.readyText': 'Les deux noms pointent vers le serveur.',
  'websites.dns.notReadyText': 'Tous les enregistrements ne pointent pas encore vers le serveur.',
  'websites.dns.checkedAt': 'Vérifié {when}.',
  'websites.dns.toDomain': 'Modifier les enregistrements de {domain} dans le module DNS',
  'websites.db.title': 'Bases de données',
  'websites.db.text': 'Bases de données MySQL du site web, chacune avec son propre utilisateur.',
  'websites.db.empty': 'Aucune base de données',
  'websites.db.name': 'Base de données',
  'websites.db.user': 'Utilisateur',
  'websites.db.size': 'Taille',
  'websites.db.statusCol': 'Statut',
  'websites.db.create': 'Créer une base de données',
  'websites.db.createHint':
    'Nouvelle base de données avec son propre utilisateur, vous verrez le mot de passe une seule fois.',
  'websites.db.createTitle': 'Créer une base de données',
  'websites.db.createText': "Le nom et l'utilisateur commencent par le préfixe fixe du site web.",
  'websites.db.createdTitle': 'Base de données créée (visible uniquement maintenant)',
  'websites.db.created': 'Base de données {name} créée',
  'websites.db.unknownHint':
    'Si la base de données apparaît ensuite dans la liste, définissez-lui un nouveau mot de passe.',
  'websites.db.full': "Votre contingent n'a plus de place pour d'autres bases de données.",
  'websites.db.suffix': 'Nom de la base de données',
  'websites.db.suffixHint': 'Lettres minuscules, chiffres et "_", 15 caractères au maximum, p. ex. wp.',
  'websites.db.suffixEmpty': 'Saisissez un nom après le préfixe.',
  'websites.db.suffixInvalid':
    'Lettres minuscules, chiffres et "_", 15 caractères au maximum, commence par une lettre ou un chiffre.',
  'websites.db.nameTooLong': 'Le nom complet dépasserait 32 caractères. Choisissez-en un plus court.',
  'websites.db.needsSiteUser': "Uniquement avec un nom d'utilisateur valide.",
  'websites.db.taken': 'Cette base de données existe déjà.',
  'websites.db.preview': 'Base de données et utilisateur :',
  'websites.db.userHint': "L'utilisateur de la base de données porte le même nom que la base de données.",
  'websites.db.newPassword': 'Nouveau mot de passe',
  'websites.db.passwordTitle': 'Nouveau mot de passe pour {name}',
  'websites.db.passwordText':
    "L'ancien mot de passe ne fonctionnera plus ensuite. Saisissez le nouveau dans votre application (WordPress : wp-config.php).",
  'websites.db.passwordDone': 'Nouveau mot de passe défini pour {name}',
  'websites.db.delete': 'Supprimer',
  'websites.db.deleteTitle': 'Supprimer la base de données {name}?',
  'websites.db.deleteText':
    'La base de données et son utilisateur sont supprimés avec toutes les données. Cette action est irréversible.',
  'websites.db.deleted': 'Base de données {name} supprimée',
  'websites.db.connect': "Les applications sur le serveur se connectent à l'hôte 127.0.0.1, port 3306.",
  'websites.db.noPhpMyAdmin':
    "Nous ne proposons pas phpMyAdmin. Un tunnel SSH vous permet d'atteindre la base de données depuis votre ordinateur (ensuite 127.0.0.1:3306 dans votre programme de base de données) :",
  'websites.usage.title': 'Stockage',
  'websites.usage.files': 'Fichiers',
  'websites.usage.databases': 'Bases de données',
  'websites.usage.measured': '{size} · mesuré {when}',
  'websites.usage.notMeasured': 'Pas encore mesuré',
  'websites.usage.measuredAt': 'mesuré {when}',
  'websites.usage.fairUse':
    "Pas de limite fixe; l'usage raisonnable (fair use) s'applique. Le serveur mesure toutes les six heures.",
  'websites.backup.title': 'Sauvegardes',
  'websites.backup.text':
    'Les bases de données sont sauvegardées chaque nuit (7 jours, dans le dossier ~/backups). Supprimer le site web efface aussi ces sauvegardes.',
  'websites.mail.title': 'E-mail',
  'websites.mail.text':
    "Les sites web n'envoient ni ne reçoivent d'e-mails. Les boîtes e-mail pour {domain} se trouvent dans le module E-mail.",
  'websites.mail.smtp': "WordPress et d'autres applications envoient via une boîte e-mail par SMTP (plugin).",
  'websites.mail.link': 'Vers le module E-mail',
  'websites.delete.zone': 'Zone de danger',
  'websites.delete.zoneText':
    'Supprime le site web sur le serveur avec tous les fichiers et bases de données.',
  'websites.delete.action': 'Supprimer le site web',
  'websites.delete.title': 'Supprimer le site web {domain}?',
  'websites.delete.text': 'Cette action est irréversible. Seront perdus :',
  'websites.delete.lostFiles': 'tous les fichiers dans {home}',
  'websites.delete.lostFilesPlain': 'tous les fichiers du site web',
  'websites.delete.lostDatabases': 'toutes les bases de données : {names}',
  'websites.delete.lostNoDatabases': 'toutes les bases de données du site web',
  'websites.delete.lostBackups': 'les sauvegardes nocturnes des bases de données dans ~/backups',
  'websites.delete.lostCron': 'les tâches planifiées (cron) et les processus en cours',
  'websites.delete.lostUser': "l'utilisateur {user} pour SFTP et SSH",
  'websites.delete.confirm': 'Saisissez le domaine pour confirmer',
  'websites.delete.submit': 'Supprimer définitivement',
  'websites.delete.pending': "Le serveur supprime le site web. Cela peut prendre jusqu'à trois minutes.",
  'websites.delete.done': 'Site web {domain} supprimé',
  'websites.delete.warnings': 'Site web supprimé, avec des remarques du serveur',
  'websites.admin.title': 'Sites web sur les serveurs CloudPanel',
  'websites.admin.text':
    'Créer des sites web pour les clients, reprendre les sites non gérés des serveurs et retirer de la console les sites web sans client.',
  'websites.admin.counts': '{n} sites web, dont {unassigned} non attribués et {missing} absents du serveur.',
  'websites.admin.inventoryLine': '{type} · {databases} bases de données',
  'websites.admin.website': 'Site web',
  'websites.admin.instance': 'Serveur',
  'websites.admin.state': 'État',
  'websites.admin.createTitle': 'Créer un site web pour un client',
  'websites.admin.createText':
    "Sur n'importe quel serveur CloudPanel, pour une organisation ou sans attribution pour l'instant.",
  'websites.admin.orgHint':
    'Sans attribution, vous attribuez le site web plus tard dans la liste ci-dessous.',
  'websites.admin.enablesModule': 'Le module "{module}" sera activé pour {org}.',
  'websites.admin.optionsError':
    'Serveur injoignable. Le choix suit les paramètres du fournisseur; le serveur vérifie chaque valeur.',
  'websites.admin.noAllowanceCheck':
    "Aucun contingent ne s'applique au personnel de la plateforme. Le site web compte tout de même dans le contingent du client.",
  'websites.admin.forget': 'Retirer de la console',
  'websites.admin.forgetTitle': 'Retirer {domain} de la console?',
  'websites.admin.forgetText':
    "Le site web et ses bases de données disparaissent de la console; sur le serveur ({instance}), tout reste en place et n'est plus géré.",
  'websites.admin.forgetAdopt': 'Pour le reprendre, exécutez en tant que root sur le serveur :',
  'websites.admin.forgotten': '{domain} retiré de la console',
  'websites.admin.unknownHint':
    "Si le site web apparaît ensuite dans l'inventaire, attribuez-le; le client définit un nouveau mot de passe pour obtenir l'accès.",
  'websites.admin.unmanagedTitle': 'Sites non gérés sur {instance}',
  'websites.admin.unmanagedText':
    'Sites du serveur que la console ne gère pas : créés dans CloudPanel ou protégés (p. ex. la console elle-même).',
  'websites.admin.unmanagedLoad': 'Afficher',
  'websites.admin.unmanagedReload': 'Recharger',
  'websites.admin.unmanagedEmpty': "Il n'y a aucun site non géré sur {instance}.",
  'websites.admin.adoptCol': 'Reprendre',
  'websites.admin.protected': 'Protégé',
  'websites.admin.protectedHint': 'Ne peut jamais être repris',
  'websites.admin.adopt': 'Reprendre',
  'websites.admin.adoptTitle': 'Reprendre {domain}?',
  'websites.admin.adoptText':
    'La console gère ensuite le site. La personne à qui il est attribué peut définir des mots de passe, créer des bases de données et supprimer le site.',
  'websites.admin.adopted': '{domain} repris; attribuez maintenant le site web à un client.',
  'websites.admin.adoptServerHint':
    'Sur ce serveur, seul root peut reprendre un site : exécutez la commande sur le serveur. Le site web apparaîtra comme non attribué après la prochaine synchronisation.',
  'websites.admin.adoptRemoteHint':
    'Les sites repris apparaissent immédiatement comme sites web non attribués. Les sites protégés ne peuvent jamais être repris.',
  'websites.reseller.cardText':
    'Sites web et bases de données que le client peut créer lui-même, issus de votre contingent et sur votre serveur.',
  'websites.reseller.none': 'Aucun contingent de sites web attribué',
  'websites.reseller.noneText': 'Sans contingent, le client ne peut pas créer de sites web.',
  'websites.reseller.pool':
    'Vous avez {sites} sites web, dont {usedSites} attribués, et {databases} bases de données, dont {usedDatabases} attribuées.',
  'websites.reseller.noPool':
    "Vous n'avez vous-même aucun contingent de sites web. Adressez-vous à weblion pour attribuer des sites web à des clients.",
  'websites.reseller.dialogText': 'Issu de votre contingent sur {instance}.',
  'websites.reseller.left': 'Au maximum {n} de votre contingent',
  'websites.reseller.sitesTooHigh': 'Il ne reste que {n} sites web libres dans votre contingent.',
  'websites.reseller.databasesTooHigh': 'Il ne reste que {n} bases de données libres dans votre contingent.',
  'websites.reseller.inUse': 'Le client a déjà {sites} sites web et {databases} bases de données.',
  'websites.reseller.enablesModule': 'Cela active aussi le module Hébergement web pour le client.',
  'websites.reseller.removeText': 'Le client ne pourra plus créer de sites web; le contingent vous revient.',
  'websites.reseller.removeBlocked':
    'Possible uniquement sans sites web. Le client en a encore {n}; supprimez-les ou reprenez-les dans votre parc.',
  'websites.reseller.releaseText':
    "S'il s'agit d'un site web et que votre contingent de sites web n'a plus de place pour lui, il emporte sa place dans le contingent du client : celui-ci diminue du site web et de ses bases de données.",
  'websites.errors.no_allowance': "Aucun contingent de sites web n'est configuré pour cette organisation.",
  'websites.errors.allowance_exceeded': 'Le contingent est épuisé.',
  'websites.errors.type_not_allowed': "Ce type de site web n'est pas inclus dans le contingent.",
  'websites.errors.exists.domain': 'Ce domaine est déjà un site web ou appartient à un autre client.',
  'websites.errors.exists.siteUser':
    "Ce nom d'utilisateur existe déjà sur le serveur. Choisissez-en un autre.",
  'websites.errors.exists.database':
    'Cette base de données existe déjà sur le serveur. Choisissez un autre nom.',
  'websites.errors.dns_not_ready':
    'Le DNS ne pointe pas encore vers le serveur. Vérifiez les enregistrements ou essayez quand même.',
  'websites.errors.website_busy':
    'Le site web est en cours de création ou de suppression. Réessayez ensuite.',
  'websites.errors.website_error':
    "La dernière modification du site web n'a pas été terminée. La prochaine synchronisation clarifiera l'état.",
  'websites.errors.website_missing': 'Le serveur ne signale plus ce site web.',
  'websites.errors.busy': 'Le serveur est occupé pour le moment. Réessayez dans une minute.',
  'websites.errors.timeout':
    "Le serveur n'a pas répondu à temps. Il est peut-être encore en train de travailler; la prochaine synchronisation affichera le résultat.",
  'websites.errors.unknownOutcome': 'Résultat incertain',
  'websites.errors.unknownOutcomeText':
    'Le serveur a peut-être tout de même effectué la modification. La prochaine synchronisation affichera le résultat.',
};
