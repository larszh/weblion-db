import type { cloudflareDe } from './cloudflare.de';

export const cloudflareFr: Partial<Record<keyof typeof cloudflareDe, string>> = {
  'providers.cloudflare.help':
    "Dans le tableau de bord Cloudflare, sous Mon profil > Jetons API, créez un jeton dédié (et non la clé API globale) pour toutes les zones du compte. Cloudflare autorise 1200 requêtes API par 5 minutes et par utilisateur : l'idéal est un utilisateur Cloudflare dédié à la console.",
  'providers.cloudflare.token': 'Jeton API',
  'providers.cloudflare.tokenHint':
    'Jetons API > Créer un jeton > Jeton personnalisé, ressources de zone "Toutes les zones d\'un compte".',
  'providers.cloudflare.permissions': 'Autorisations nécessaires : {permissions}',
  'providers.cloudflare.accountId': 'ID du compte',
  'providers.cloudflare.accountIdHint':
    "Facultatif, sur la page d'accueil du compte dans le tableau de bord. Nécessaire pour créer des zones (migration du DNS vers Cloudflare), et limite la liste des zones à ce compte.",
  'providers.cloudflare.accountIdInvalid': "L'ID du compte comporte 32 caractères (0-9, a-f).",
  'providers.cloudflare.baseUrl': "URL de base de l'API",
  'providers.cloudflare.baseUrlHint': 'Par défaut : {url}',
  'providers.cloudflare.zones': 'Zones DNS',
  'providers.cloudflare.zonesText':
    'Zones DNS de ce compte et leur attribution aux clients. Les nouvelles zones apparaissent après la prochaine synchronisation.',
  'providers.cloudflare.toZones': 'Vers les zones',
  'hosting.kind.zone': 'Zone DNS',
  'hosting.kind.registration': 'Enregistrement de domaine',
  'hosting.zone.status.active': 'Active',
  'hosting.zone.status.pending': 'En attente des serveurs de noms',
  'hosting.zone.status.initializing': 'Configuration en cours',
  'hosting.zone.status.moved': 'Serveurs de noms modifiés',
  'hosting.zone.hostedAt': 'Zone DNS chez {provider}',
  'hosting.zone.noExpiry':
    "Une zone DNS n'expire pas. La date d'expiration figure dans l'enregistrement du domaine.",
  'hosting.zone.title': 'Zone et serveurs de noms',
  'hosting.zone.text': '{provider} a attribué ces serveurs de noms à la zone.',
  'hosting.zone.pendingTitle': 'La zone attend les serveurs de noms',
  'hosting.zone.pendingText':
    "{provider} active la zone dès que le domaine pointe vers les serveurs de noms attribués. D'ici là, les enregistrements des anciens serveurs de noms s'appliquent.",
  'hosting.zone.nameserversToSet': 'Définissez ces serveurs de noms chez le registraire :',
  'hosting.zone.copyAll': 'Tout copier',
  'hosting.zone.copied': 'Copié',
  'hosting.zone.originalNameservers': 'Anciens serveurs de noms',
  'hosting.zone.originalRegistrar': 'Ancien registraire',
  'hosting.zone.createdAt': 'Créée le',
  'hosting.zone.activatedAt': 'Activée le',
  'hosting.zone.type': 'Type de zone',
  'hosting.zone.type.full': 'Complète',
  'hosting.zone.type.partial': 'Partielle (configuration CNAME)',
  'hosting.zone.type.secondary': 'Secondaire (lecture seule)',
  'hosting.zone.plan': 'Formule',
  'hosting.zone.paused': 'Zone en pause',
  'hosting.zone.pausedText':
    "{provider} ne répond plus qu'aux requêtes DNS. Le proxy et le CDN sont désactivés pour cette zone.",
  'hosting.zone.movedText':
    "Le domaine ne pointe plus vers les serveurs de noms de {provider}. Les enregistrements de cette zone ne s'appliquent plus, et {provider} supprimera la zone après un certain temps.",
  'hosting.zone.checkActivation': "Vérifier l'activation maintenant",
  'hosting.zone.checkActivationHint':
    '{provider} vérifie de toute façon régulièrement les serveurs de noms. Avec la formule gratuite, une vérification manuelle est possible au maximum une fois par heure.',
  'hosting.zone.checkActivationDone':
    'Vérification demandée. La zone deviendra active dès que {provider} verra les nouveaux serveurs de noms.',
  'hosting.zone.nsMatch':
    "L'enregistrement du domaine pointe déjà vers ces serveurs de noms. La zone deviendra active dès que {provider} verra la modification.",
  'hosting.zone.registrationTitle': 'Enregistrement du domaine',
  'hosting.zone.registrationText':
    "Le domaine est enregistré chez {registrar}. C'est là que vous définissez les serveurs de noms.",
  'hosting.zone.registrar': 'Registraire',
  'hosting.zone.delegation': 'Serveurs de noms chez le registraire',
  'hosting.zone.delegationOk': 'Pointe vers cette zone',
  'hosting.zone.delegationOther': 'Ne pointe pas vers cette zone',
  'hosting.zone.openRegistration': 'Vers le domaine chez {registrar}',
  'hosting.zone.dnsPendingTitle': "La zone n'est pas encore active",
  'hosting.zone.dnsPendingText':
    "Vous pouvez déjà préparer les enregistrements. Ils s'appliqueront dès que le domaine pointera vers les serveurs de noms de {provider}.",
  'hosting.dnsZone.title': 'DNS chez {provider}',
  'hosting.dnsZone.text':
    'Les enregistrements DNS de {name} sont gérés par la zone chez {provider}. Les enregistrements chez le registraire ci-dessous ne sont pas actifs.',
  'hosting.dnsZone.notActive':
    'Il existe une zone pour {name} chez {provider} ({status}). Mais le domaine ne pointe pas encore vers ses serveurs de noms.',
  'hosting.dnsZone.open': 'Vers la zone DNS',
  'hosting.dnsZone.otherOrg':
    'La zone appartient à une autre organisation. Adressez-vous à son propriétaire ou au support.',
  'hosting.dnsZone.prepared':
    "Une zone chez {provider} est préparée ({status}). Tant que le domaine ne pointe pas vers les serveurs de noms de {provider}, ce sont les enregistrements affichés ici qui s'appliquent.",
  'hosting.dnsZone.nsLine': 'Zone DNS chez {provider} : {status}',
  'hosting.dnsZone.preset': 'Serveurs de noms de la zone chez {provider}',
  'hosting.dnsZone.presetHint':
    "{list}. Nécessaires pour que les enregistrements DNS de la zone chez {provider} s'appliquent.",
  'hosting.dns.proxy.column': 'Proxy',
  'hosting.dns.proxy.on': 'Via le proxy',
  'hosting.dns.proxy.off': 'DNS uniquement',
  'hosting.dns.proxy.onHint':
    "Le trafic passe par {provider} (CDN et protection). L'adresse de votre serveur reste masquée.",
  'hosting.dns.proxy.offHint': "DNS uniquement : l'adresse est communiquée directement, sans proxy ni CDN.",
  'hosting.dns.proxy.turnOn': 'Activer le proxy',
  'hosting.dns.proxy.turnOff': 'Désactiver le proxy',
  'hosting.dns.proxy.label': 'Faire passer par Cloudflare (proxy)',
  'hosting.dns.proxy.hint':
    'Les visiteurs atteignent le serveur via Cloudflare, avec CDN, protection et HTTPS. Le TTL est alors automatique.',
  'hosting.dns.proxy.notProxiable':
    "Cloudflare ne peut pas faire passer cet enregistrement par le proxy, p. ex. parce qu'il pointe vers une adresse privée.",
  'hosting.dns.proxy.toggledOn': 'Proxy activé pour {name}',
  'hosting.dns.proxy.toggledOff': 'Proxy désactivé pour {name}',
  'hosting.dns.ttlAuto': 'Automatique',
  'hosting.dns.cnameFlattening':
    'Autorisé : pour le domaine lui-même, {provider} communique les adresses de la cible (CNAME flattening).',
  'hosting.dns.comment': 'Note',
  'hosting.cdn.tab': 'CDN',
  'hosting.cdn.notActive':
    "La zone n'est pas encore active. Les paramètres ne prendront effet que lorsque le domaine pointera vers les serveurs de noms de {provider}.",
  'hosting.cdn.noProxied':
    "Les paramètres CDN ne s'appliquent qu'aux enregistrements avec proxy. Actuellement, aucun enregistrement ne passe par {provider}. Vous activez le proxy dans l'onglet \"DNS\".",
  'hosting.cdn.readOnly':
    'Vous pouvez consulter les paramètres. Pour les modifier, il vous faut l\'autorisation "Modifier les serveurs de noms, le verrou de transfert et les paramètres CDN".',
  'hosting.cdn.notEditable': "La formule de la zone n'autorise pas cette modification.",
  'hosting.cdn.saved': 'Paramètre CDN enregistré',
  'hosting.cdn.ssl.title': 'SSL/TLS',
  'hosting.cdn.ssl.text':
    'Comment {provider} chiffre les connexions avec les visiteurs et avec votre serveur.',
  'hosting.cdn.ssl.label': 'Mode de chiffrement',
  'hosting.cdn.ssl.effective': 'Mode utilisé actuellement par {provider} : {mode}',
  'hosting.cdn.ssl.propagation':
    "Une modification peut prendre jusqu'à 5 minutes avant de s'appliquer partout.",
  'hosting.cdn.ssl.mode.auto': 'Automatique (recommandé)',
  'hosting.cdn.ssl.mode.off': 'Désactivé',
  'hosting.cdn.ssl.mode.flexible': 'Flexible',
  'hosting.cdn.ssl.mode.full': 'Complet',
  'hosting.cdn.ssl.mode.strict': 'Complet (strict)',
  'hosting.cdn.ssl.desc.auto':
    '{provider} vérifie votre serveur et choisit le mode le plus sûr qui fonctionne. {provider} peut ensuite relever le mode de lui-même.',
  'hosting.cdn.ssl.desc.off':
    "Aucun chiffrement. Les visiteurs n'accèdent au site web que par HTTP, et les navigateurs les en avertissent.",
  'hosting.cdn.ssl.desc.flexible':
    "Chiffré entre les visiteurs et {provider}, mais non chiffré jusqu'à votre serveur. Si le serveur redirige lui-même vers HTTPS, il se produit une boucle de redirection.",
  'hosting.cdn.ssl.desc.full':
    "Chiffré jusqu'à votre serveur. Le certificat du serveur n'est pas vérifié, un certificat autosigné suffit.",
  'hosting.cdn.ssl.desc.strict':
    "Chiffré jusqu'à votre serveur, qui a besoin d'un certificat valide (p. ex. de Let's Encrypt). Le plus sûr.",
  'hosting.cdn.ssl.confirmTitle': 'Régler SSL/TLS sur "{mode}"?',
  'hosting.cdn.ssl.confirmText':
    "Avec ce mode, la connexion à votre serveur n'est pas chiffrée. Des données comme les mots de passe peuvent être lues en chemin. Ne le choisissez que si votre serveur ne prend pas en charge HTTPS.",
  'hosting.cdn.https.title': 'HTTPS',
  'hosting.cdn.https.label': 'Toujours utiliser HTTPS',
  'hosting.cdn.https.hint': 'Redirige toutes les requêtes HTTP vers HTTPS.',
  'hosting.cdn.dev.title': 'Mode développement',
  'hosting.cdn.dev.label': 'Contourner temporairement le cache',
  'hosting.cdn.dev.hint':
    'Les modifications du site web sont visibles immédiatement, car {provider} ne met rien en cache. Le mode se désactive de lui-même après 3 heures.',
  'hosting.cdn.dev.remaining': 'Actif, se désactive dans {time}.',
  'hosting.cdn.purge.title': 'Cache',
  'hosting.cdn.purge.text':
    '{provider} met en cache des fichiers de votre site web. Après une mise à jour, videz le cache pour que les visiteurs voient la nouvelle version.',
  'hosting.cdn.purge.button': 'Vider tout le cache',
  'hosting.cdn.purge.confirmTitle': 'Vider tout le cache de {name}?',
  'hosting.cdn.purge.confirmText':
    '{provider} récupère ensuite chaque fichier à nouveau depuis votre serveur. Cela peut solliciter davantage le serveur pendant un court moment.',
  'hosting.cdn.purge.done': 'Vidage du cache en cours. Cela ne prend généralement que quelques secondes.',
  'hosting.cdn.purge.wait': "Le cache vient d'être vidé. Vous pourrez le vider à nouveau dans 30 secondes.",
  'hosting.dnsMove.action': 'Migrer le DNS vers Cloudflare',
  'hosting.dnsMove.cardTitle': 'Migrer le DNS vers Cloudflare',
  'hosting.dnsMove.cardText':
    'Crée une zone chez Cloudflare, copie les enregistrements DNS du registraire et, si vous le souhaitez, bascule les serveurs de noms.',
  'hosting.dnsMove.title': 'Migrer le DNS de {name} vers Cloudflare',
  'hosting.dnsMove.intro':
    "La console crée la zone ou utilise une zone existante, copie les enregistrements et ne bascule les serveurs de noms qu'une fois tous les enregistrements repris. Chaque étape est consignée dans le journal d'audit.",
  'hosting.dnsMove.target': 'Compte Cloudflare',
  'hosting.dnsMove.noTargets':
    'Aucune connexion Cloudflare avec ID de compte. Saisissez l\'ID du compte d\'une connexion Cloudflare sous "Fournisseurs" pour que la console puisse créer des zones.',
  'hosting.dnsMove.existingZone':
    "Il existe déjà une zone pour {name} chez {provider} ({status}). Si elle se trouve dans le compte choisi, elle est utilisée au lieu d'en créer une nouvelle.",
  'hosting.dnsMove.existingZoneOtherOrg':
    'Elle appartient à {zoneOrg}, le domaine à {domainOrg}. Attribuez les deux à la même organisation avant de lancer la migration.',
  'hosting.dnsMove.existingZoneClaim':
    "Elle n'est attribuée à aucune organisation, la migration l'attribue à {domainOrg}.",
  'hosting.dnsMove.noOrg': 'aucune organisation',
  'hosting.dnsMove.import.label': 'Reprendre les enregistrements du registraire ({n})',
  'hosting.dnsMove.import.hint':
    'Copie les enregistrements dans la nouvelle zone. Les enregistrements copiés ne passent pas par le proxy, le trafic ne change donc pas.',
  'hosting.dnsMove.import.unavailable':
    "Impossible : le domaine n'utilise pas les serveurs de noms du registraire, ses enregistrements ne sont donc pas ceux qui s'appliquent.",
  'hosting.dnsMove.import.error': "Les enregistrements chez le registraire n'ont pas pu être lus :",
  'hosting.dnsMove.import.tooMany':
    'Impossible : plus de {max} enregistrements. Importez la zone dans le tableau de bord Cloudflare.',
  'hosting.dnsMove.import.zoneNotEmpty':
    'La console ne copie rien dans une zone qui contient déjà des enregistrements.',
  'hosting.dnsMove.planned': 'Seront copiés ({n})',
  'hosting.dnsMove.converted': 'Adaptés ({n})',
  'hosting.dnsMove.convertedType': '{from} devient {to}',
  'hosting.dnsMove.ttlChanged': 'TTL {from} devient {to}',
  'hosting.dnsMove.skipped.title': 'Non repris ({n})',
  'hosting.dnsMove.skipped.reason.type': "Ce type n'existe pas chez Cloudflare",
  'hosting.dnsMove.skipped.reason.readOnly': 'Lecture seule',
  'hosting.dnsMove.skipped.reason.apexNs': 'Serveurs de noms du domaine, définis par Cloudflare lui-même',
  'hosting.dnsMove.ns.label': 'Basculer les serveurs de noms chez le registraire',
  'hosting.dnsMove.ns.hint':
    "Fait pointer le domaine vers les serveurs de noms de la zone dès que tous les enregistrements sont copiés. À partir de là, les enregistrements chez Cloudflare s'appliquent.",
  'hosting.dnsMove.ns.unsupported':
    'Impossible : le registraire ne permet pas la bascule via la console. Vous définirez ensuite les serveurs de noms manuellement.',
  'hosting.dnsMove.ns.requiresImport': 'Possible uniquement après la reprise complète des enregistrements.',
  'hosting.dnsMove.warning':
    "Après la bascule, les serveurs de noms de Cloudflare répondent à toutes les requêtes DNS du domaine. Vérifiez les listes : ce qui n'est pas repris manquera ensuite.",
  'hosting.dnsMove.submit': 'Lancer la migration',
  'hosting.dnsMove.result.title': 'Résultat de la migration',
  'hosting.dnsMove.result.zoneCreated': 'Zone créée',
  'hosting.dnsMove.result.zoneReused': 'Zone existante utilisée',
  'hosting.dnsMove.result.import.done': '{n} enregistrements copiés',
  'hosting.dnsMove.result.import.partial': '{n} enregistrements copiés, {failed} en échec',
  'hosting.dnsMove.result.import.skipped': 'Aucun enregistrement copié',
  'hosting.dnsMove.result.import.failed': "Les enregistrements n'ont pas pu être copiés",
  'hosting.dnsMove.result.import.reason.notRequested': 'Non sélectionné.',
  'hosting.dnsMove.result.import.reason.registrarNotServing':
    "Le domaine n'utilise pas les serveurs de noms du registraire.",
  'hosting.dnsMove.result.import.reason.zoneNotEmpty':
    "La zone contient déjà des enregistrements. La console n'y ajoute rien.",
  'hosting.dnsMove.result.import.reason.tooManyRecords':
    "Trop d'enregistrements pour une migration via la console.",
  'hosting.dnsMove.result.import.reason.recordsUnreadable':
    "Les enregistrements chez le registraire n'ont pas pu être lus.",
  'hosting.dnsMove.result.ns.done': 'Serveurs de noms basculés chez le registraire',
  'hosting.dnsMove.result.ns.skipped': 'Serveurs de noms non basculés',
  'hosting.dnsMove.result.ns.failed': "Les serveurs de noms n'ont pas pu être basculés",
  'hosting.dnsMove.result.ns.manual': 'Définir les serveurs de noms manuellement',
  'hosting.dnsMove.result.ns.reason.notRequested':
    'Non sélectionné. Définissez ces serveurs de noms chez le registraire dès que la zone est complète :',
  'hosting.dnsMove.result.ns.reason.importIncomplete':
    "Tous les enregistrements n'ont pas été copiés. Complétez la zone, puis définissez ces serveurs de noms dans la vue d'ensemble du domaine :",
  'hosting.dnsMove.result.ns.reason.unsupported':
    'Le registraire ne le permet pas via la console. Définissez ces serveurs de noms manuellement chez lui :',
  'hosting.dnsMove.result.openZone': 'Vers la zone',
  'explorer.cloudflarePath':
    'Chemins relatifs à /client/v4, p. ex. /zones/<zone_id>/dns_records. Les secrets dans les réponses sont masqués, les jetons API ne peuvent pas être gérés ici.',
};
