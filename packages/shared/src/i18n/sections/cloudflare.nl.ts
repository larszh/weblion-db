import type { cloudflareDe } from './cloudflare.de';

export const cloudflareNl: Partial<Record<keyof typeof cloudflareDe, string>> = {
  'providers.cloudflare.help':
    'Maak in het Cloudflare-dashboard onder My Profile > API Tokens een eigen token aan (niet de Global API Key) voor alle zones van het account. Cloudflare staat 1200 API-verzoeken per 5 minuten per gebruiker toe: een aparte Cloudflare-gebruiker voor de console werkt het best.',
  'providers.cloudflare.token': 'API-token',
  'providers.cloudflare.tokenHint':
    'API Tokens > Create Token > Custom token, zoneresources "All zones from an account".',
  'providers.cloudflare.permissions': 'Benodigde rechten: {permissions}',
  'providers.cloudflare.accountId': 'Account-ID',
  'providers.cloudflare.accountIdHint':
    'Optioneel, te vinden op de startpagina van het account in het dashboard. Nodig om zones aan te maken (DNS-verhuizing naar Cloudflare), en beperkt de zonelijst tot dit account.',
  'providers.cloudflare.accountIdInvalid': 'De account-ID bestaat uit 32 tekens (0-9, a-f).',
  'providers.cloudflare.baseUrl': 'API-basis-URL',
  'providers.cloudflare.baseUrlHint': 'Standaard: {url}',
  'providers.cloudflare.zones': 'DNS-zones',
  'providers.cloudflare.zonesText':
    'DNS-zones van dit account en hun toewijzing aan klanten. Nieuwe zones verschijnen na de volgende synchronisatie.',
  'providers.cloudflare.toZones': 'Naar de zones',
  'hosting.kind.zone': 'DNS-zone',
  'hosting.kind.registration': 'Registratie',
  'hosting.zone.status.active': 'Actief',
  'hosting.zone.status.pending': 'Wacht op nameservers',
  'hosting.zone.status.initializing': 'Wordt ingericht',
  'hosting.zone.status.moved': 'Nameservers verhuisd',
  'hosting.zone.hostedAt': 'DNS-zone bij {provider}',
  'hosting.zone.noExpiry':
    'Een DNS-zone verloopt niet. De verloopdatum staat bij de registratie van het domein.',
  'hosting.zone.title': 'Zone en nameservers',
  'hosting.zone.text': 'Deze nameservers heeft {provider} aan de zone toegewezen.',
  'hosting.zone.pendingTitle': 'De zone wacht op de nameservers',
  'hosting.zone.pendingText':
    '{provider} activeert de zone zodra het domein naar de toegewezen nameservers verwijst. Tot die tijd gelden de records bij de huidige nameservers.',
  'hosting.zone.nameserversToSet': 'Stel bij de registrar deze nameservers in:',
  'hosting.zone.copyAll': 'Alles kopiëren',
  'hosting.zone.copied': 'Gekopieerd',
  'hosting.zone.originalNameservers': 'Oorspronkelijke nameservers',
  'hosting.zone.originalRegistrar': 'Oorspronkelijke registrar',
  'hosting.zone.createdAt': 'Aangemaakt op',
  'hosting.zone.activatedAt': 'Geactiveerd op',
  'hosting.zone.type': 'Zonetype',
  'hosting.zone.type.full': 'Volledig',
  'hosting.zone.type.partial': 'Gedeeltelijk (CNAME-setup)',
  'hosting.zone.type.secondary': 'Secundair (alleen lezen)',
  'hosting.zone.plan': 'Abonnement',
  'hosting.zone.paused': 'Zone gepauzeerd',
  'hosting.zone.pausedText':
    '{provider} beantwoordt alleen nog DNS-verzoeken. Proxy en CDN zijn voor deze zone uitgeschakeld.',
  'hosting.zone.movedText':
    'Het domein verwijst niet meer naar de nameservers van {provider}. De records van deze zone gelden niet meer, en {provider} verwijdert de zone na enige tijd.',
  'hosting.zone.checkActivation': 'Activering nu controleren',
  'hosting.zone.checkActivationHint':
    '{provider} controleert de nameservers sowieso regelmatig. Met het gratis abonnement is een handmatige controle hoogstens eenmaal per uur mogelijk.',
  'hosting.zone.checkActivationDone':
    'Controle aangevraagd. De zone wordt actief zodra {provider} de nieuwe nameservers ziet.',
  'hosting.zone.nsMatch':
    'De registratie verwijst al naar deze nameservers. De zone wordt actief zodra {provider} de wijziging ziet.',
  'hosting.zone.registrationTitle': 'Registratie',
  'hosting.zone.registrationText':
    'Het domein is geregistreerd bij {registrar}. Daar stelt u de nameservers in.',
  'hosting.zone.registrar': 'Registrar',
  'hosting.zone.delegation': 'Nameservers bij de registrar',
  'hosting.zone.delegationOk': 'Verwijst naar deze zone',
  'hosting.zone.delegationOther': 'Verwijst niet naar deze zone',
  'hosting.zone.openRegistration': 'Naar het domein bij {registrar}',
  'hosting.zone.dnsPendingTitle': 'De zone is nog niet actief',
  'hosting.zone.dnsPendingText':
    'U kunt de records al voorbereiden. Ze gelden zodra het domein naar de nameservers van {provider} verwijst.',
  'hosting.dnsZone.title': 'DNS bij {provider}',
  'hosting.dnsZone.text':
    'De DNS-records van {name} worden beheerd door de zone bij {provider}. De records bij de registrar hieronder zijn niet actief.',
  'hosting.dnsZone.notActive':
    'Voor {name} bestaat een zone bij {provider} ({status}). Het domein verwijst echter nog niet naar de nameservers daarvan.',
  'hosting.dnsZone.open': 'Naar de DNS-zone',
  'hosting.dnsZone.otherOrg':
    'De zone hoort bij een andere organisatie. Neem contact op met de eigenaar daarvan of met de support.',
  'hosting.dnsZone.prepared':
    'Er is een zone bij {provider} voorbereid ({status}). Totdat het domein naar de nameservers van {provider} verwijst, gelden de records hier.',
  'hosting.dnsZone.nsLine': 'DNS-zone bij {provider}: {status}',
  'hosting.dnsZone.preset': 'Nameservers van de zone bij {provider}',
  'hosting.dnsZone.presetHint': '{list}. Nodig zodat de DNS-records van de zone bij {provider} gelden.',
  'hosting.dns.proxy.column': 'Proxy',
  'hosting.dns.proxy.on': 'Via proxy',
  'hosting.dns.proxy.off': 'Alleen DNS',
  'hosting.dns.proxy.onHint':
    'Het verkeer loopt via {provider} (CDN en bescherming). Het adres van uw server blijft verborgen.',
  'hosting.dns.proxy.offHint': 'Alleen DNS: het adres wordt rechtstreeks teruggegeven, zonder proxy en CDN.',
  'hosting.dns.proxy.turnOn': 'Proxy inschakelen',
  'hosting.dns.proxy.turnOff': 'Proxy uitschakelen',
  'hosting.dns.proxy.label': 'Via Cloudflare leiden (proxy)',
  'hosting.dns.proxy.hint':
    'Bezoekers bereiken de server via Cloudflare met CDN, bescherming en HTTPS. De TTL is dan automatisch.',
  'hosting.dns.proxy.notProxiable':
    'Cloudflare kan dit record niet via de proxy leiden, bijv. omdat het naar een privéadres verwijst.',
  'hosting.dns.proxy.toggledOn': 'Proxy voor {name} ingeschakeld',
  'hosting.dns.proxy.toggledOff': 'Proxy voor {name} uitgeschakeld',
  'hosting.dns.ttlAuto': 'Automatisch',
  'hosting.dns.cnameFlattening':
    'Toegestaan: {provider} geeft voor het domein zelf de adressen van het doel terug (CNAME-flattening).',
  'hosting.dns.comment': 'Notitie',
  'hosting.cdn.tab': 'CDN',
  'hosting.cdn.notActive':
    'De zone is nog niet actief. De instellingen werken pas wanneer het domein naar de nameservers van {provider} verwijst.',
  'hosting.cdn.noProxied':
    'CDN-instellingen werken alleen voor records met proxy. Momenteel loopt geen enkel record via {provider}. De proxy schakelt u in op het tabblad "DNS".',
  'hosting.cdn.readOnly':
    'U kunt de instellingen bekijken. Om ze te wijzigen heeft u het recht "Nameservers, transferslot en CDN-instellingen wijzigen" nodig.',
  'hosting.cdn.notEditable': 'Het abonnement van de zone staat deze wijziging niet toe.',
  'hosting.cdn.saved': 'CDN-instelling opgeslagen',
  'hosting.cdn.ssl.title': 'SSL/TLS',
  'hosting.cdn.ssl.text': 'Hoe {provider} de verbindingen met bezoekers en met uw server versleutelt.',
  'hosting.cdn.ssl.label': 'Versleutelingsmodus',
  'hosting.cdn.ssl.effective': 'Momenteel gebruikt {provider}: {mode}',
  'hosting.cdn.ssl.propagation': 'Het kan tot 5 minuten duren voordat een wijziging overal geldt.',
  'hosting.cdn.ssl.mode.auto': 'Automatisch (aanbevolen)',
  'hosting.cdn.ssl.mode.off': 'Uit',
  'hosting.cdn.ssl.mode.flexible': 'Flexibel',
  'hosting.cdn.ssl.mode.full': 'Volledig',
  'hosting.cdn.ssl.mode.strict': 'Volledig (strikt)',
  'hosting.cdn.ssl.desc.auto':
    '{provider} controleert uw server en kiest de veiligste modus die werkt. {provider} kan de modus later zelf verhogen.',
  'hosting.cdn.ssl.desc.off':
    'Geen versleuteling. Bezoekers bereiken de website alleen via HTTP, browsers waarschuwen daarvoor.',
  'hosting.cdn.ssl.desc.flexible':
    'Versleuteld tussen bezoekers en {provider}, maar onversleuteld tot aan uw server. Als de server zelf naar HTTPS doorstuurt, ontstaat er een doorstuurlus.',
  'hosting.cdn.ssl.desc.full':
    'Versleuteld tot aan uw server. Het certificaat van de server wordt niet gecontroleerd, een zelfondertekend certificaat volstaat.',
  'hosting.cdn.ssl.desc.strict':
    "Versleuteld tot aan uw server, die een geldig certificaat nodig heeft (bijv. van Let's Encrypt). Het veiligst.",
  'hosting.cdn.ssl.confirmTitle': 'SSL/TLS op "{mode}" zetten?',
  'hosting.cdn.ssl.confirmText':
    'Met deze modus is de verbinding met uw server niet versleuteld. Gegevens zoals wachtwoorden kunnen onderweg worden meegelezen. Kies deze modus alleen als uw server geen HTTPS ondersteunt.',
  'hosting.cdn.https.title': 'HTTPS',
  'hosting.cdn.https.label': 'Altijd HTTPS gebruiken',
  'hosting.cdn.https.hint': 'Stuurt alle verzoeken via HTTP door naar HTTPS.',
  'hosting.cdn.dev.title': 'Ontwikkelmodus',
  'hosting.cdn.dev.label': 'Cache tijdelijk omzeilen',
  'hosting.cdn.dev.hint':
    'Wijzigingen aan de website zijn direct zichtbaar, omdat {provider} niets in de cache opslaat. De modus schakelt zichzelf na 3 uur uit.',
  'hosting.cdn.dev.remaining': 'Actief, schakelt uit over {time}.',
  'hosting.cdn.purge.title': 'Cache',
  'hosting.cdn.purge.text':
    '{provider} slaat bestanden van uw website tijdelijk op. Na een update leegt u de cache, zodat bezoekers de nieuwe versie zien.',
  'hosting.cdn.purge.button': 'Volledige cache legen',
  'hosting.cdn.purge.confirmTitle': 'Volledige cache van {name} legen?',
  'hosting.cdn.purge.confirmText':
    'Daarna haalt {provider} elk bestand opnieuw op van uw server. Dit kan de server kortstondig zwaarder belasten.',
  'hosting.cdn.purge.done': 'De cache wordt geleegd. Dit duurt doorgaans maar enkele seconden.',
  'hosting.cdn.purge.wait': 'De cache is zojuist geleegd. U kunt hem over 30 seconden opnieuw legen.',
  'hosting.dnsMove.action': 'DNS naar Cloudflare verhuizen',
  'hosting.dnsMove.cardTitle': 'DNS naar Cloudflare verhuizen',
  'hosting.dnsMove.cardText':
    'Maakt een zone aan bij Cloudflare, kopieert de DNS-records van de registrar en zet desgewenst de nameservers om.',
  'hosting.dnsMove.title': 'DNS van {name} naar Cloudflare verhuizen',
  'hosting.dnsMove.intro':
    'De console maakt de zone aan of gebruikt een bestaande, kopieert de records en zet de nameservers pas om wanneer alle records zijn overgenomen. Elke stap wordt vastgelegd in het auditlog.',
  'hosting.dnsMove.target': 'Cloudflare-account',
  'hosting.dnsMove.noTargets':
    'Geen Cloudflare-verbinding met account-ID. Vul bij een Cloudflare-verbinding onder "Providers" de account-ID in, zodat de console zones kan aanmaken.',
  'hosting.dnsMove.existingZone':
    'Voor {name} bestaat al een zone bij {provider} ({status}). Als deze in het gekozen account staat, wordt ze gebruikt in plaats van een nieuwe aan te maken.',
  'hosting.dnsMove.existingZoneOtherOrg':
    'Ze hoort bij {zoneOrg}, het domein bij {domainOrg}. Wijs beide toe aan dezelfde organisatie voordat u de verhuizing start.',
  'hosting.dnsMove.existingZoneClaim':
    'Ze is aan geen enkele organisatie toegewezen; de verhuizing wijst ze toe aan {domainOrg}.',
  'hosting.dnsMove.noOrg': 'geen organisatie',
  'hosting.dnsMove.import.label': 'Records van de registrar overnemen ({n})',
  'hosting.dnsMove.import.hint':
    'Kopieert de records naar de nieuwe zone. Gekopieerde records lopen niet via de proxy, aan het verkeer verandert dus niets.',
  'hosting.dnsMove.import.unavailable':
    'Niet mogelijk: het domein gebruikt niet de nameservers van de registrar, de records daar zijn dus niet van kracht.',
  'hosting.dnsMove.import.error': 'De records bij de registrar konden niet worden gelezen:',
  'hosting.dnsMove.import.tooMany':
    'Niet mogelijk: meer dan {max} records. Importeer de zone in het Cloudflare-dashboard.',
  'hosting.dnsMove.import.zoneNotEmpty': 'Naar een zone die al records bevat, kopieert de console niets.',
  'hosting.dnsMove.planned': 'Worden gekopieerd ({n})',
  'hosting.dnsMove.converted': 'Aangepast ({n})',
  'hosting.dnsMove.convertedType': '{from} wordt {to}',
  'hosting.dnsMove.ttlChanged': 'TTL {from} wordt {to}',
  'hosting.dnsMove.skipped.title': 'Niet overgenomen ({n})',
  'hosting.dnsMove.skipped.reason.type': 'Type bestaat niet bij Cloudflare',
  'hosting.dnsMove.skipped.reason.readOnly': 'Alleen lezen',
  'hosting.dnsMove.skipped.reason.apexNs': 'Nameserver van het domein, stelt Cloudflare zelf in',
  'hosting.dnsMove.ns.label': 'Nameservers bij de registrar omzetten',
  'hosting.dnsMove.ns.hint':
    'Zet het domein om naar de nameservers van de zone zodra alle records zijn gekopieerd. Vanaf dan gelden de records bij Cloudflare.',
  'hosting.dnsMove.ns.unsupported':
    'Niet mogelijk: de registrar ondersteunt het omzetten via de console niet. U stelt de nameservers daarna handmatig in.',
  'hosting.dnsMove.ns.requiresImport': 'Alleen mogelijk nadat alle records volledig zijn overgenomen.',
  'hosting.dnsMove.warning':
    'Na het omzetten beantwoorden de nameservers van Cloudflare alle DNS-verzoeken voor het domein. Controleer de lijsten: wat niet wordt overgenomen, ontbreekt daarna.',
  'hosting.dnsMove.submit': 'Verhuizing starten',
  'hosting.dnsMove.result.title': 'Resultaat van de verhuizing',
  'hosting.dnsMove.result.zoneCreated': 'Zone aangemaakt',
  'hosting.dnsMove.result.zoneReused': 'Bestaande zone gebruikt',
  'hosting.dnsMove.result.import.done': '{n} records gekopieerd',
  'hosting.dnsMove.result.import.partial': '{n} records gekopieerd, {failed} mislukt',
  'hosting.dnsMove.result.import.skipped': 'Geen records gekopieerd',
  'hosting.dnsMove.result.import.failed': 'Records konden niet worden gekopieerd',
  'hosting.dnsMove.result.import.reason.notRequested': 'Niet geselecteerd.',
  'hosting.dnsMove.result.import.reason.registrarNotServing':
    'Het domein gebruikt niet de nameservers van de registrar.',
  'hosting.dnsMove.result.import.reason.zoneNotEmpty':
    'De zone bevat al records. De console kopieert er niets bij.',
  'hosting.dnsMove.result.import.reason.tooManyRecords': 'Te veel records voor de verhuizing via de console.',
  'hosting.dnsMove.result.import.reason.recordsUnreadable':
    'De records bij de registrar konden niet worden gelezen.',
  'hosting.dnsMove.result.ns.done': 'Nameservers bij de registrar omgezet',
  'hosting.dnsMove.result.ns.skipped': 'Nameservers niet omgezet',
  'hosting.dnsMove.result.ns.failed': 'Nameservers konden niet worden omgezet',
  'hosting.dnsMove.result.ns.manual': 'Nameservers handmatig instellen',
  'hosting.dnsMove.result.ns.reason.notRequested':
    'Niet geselecteerd. Stel deze nameservers in bij de registrar zodra de zone volledig is:',
  'hosting.dnsMove.result.ns.reason.importIncomplete':
    'Niet alle records zijn gekopieerd. Vul de zone aan en stel daarna in het overzicht van het domein deze nameservers in:',
  'hosting.dnsMove.result.ns.reason.unsupported':
    'De registrar ondersteunt dit niet via de console. Stel deze nameservers daar handmatig in:',
  'hosting.dnsMove.result.openZone': 'Naar de zone',
  'explorer.cloudflarePath':
    'Paden relatief ten opzichte van /client/v4, bijv. /zones/<zone_id>/dns_records. Geheimen in antwoorden worden verborgen; API-tokens kunt u hier niet beheren.',
};
