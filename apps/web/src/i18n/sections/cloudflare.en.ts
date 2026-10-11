import type { cloudflareDe } from './cloudflare.de';

export const cloudflareEn: Record<keyof typeof cloudflareDe, string> = {
  // Provider form
  'providers.cloudflare.help':
    'Create a token of its own for all zones of the account in the Cloudflare dashboard under My Profile > API Tokens (not the Global API Key). Cloudflare allows 1200 API requests per 5 minutes and user: a Cloudflare user of its own for the console works best.',
  'providers.cloudflare.token': 'API token',
  'providers.cloudflare.tokenHint':
    'API Tokens > Create Token > Custom token, zone resources "All zones from an account".',
  'providers.cloudflare.permissions': 'Permissions needed: {permissions}',
  'providers.cloudflare.accountId': 'Account ID',
  'providers.cloudflare.accountIdHint':
    "Optional, on the account's home page in the dashboard. Needed to create zones (moving DNS to Cloudflare), and limits the zone list to this account.",
  'providers.cloudflare.accountIdInvalid': 'The account ID has 32 characters (0-9, a-f).',
  'providers.cloudflare.baseUrl': 'API base URL',
  'providers.cloudflare.baseUrlHint': 'Default: {url}',
  'providers.cloudflare.zones': 'DNS zones',
  'providers.cloudflare.zonesText':
    'DNS zones of this account and their assignment to customers. New zones show up after the next sync.',
  'providers.cloudflare.toZones': 'Go to zones',

  // Kind and zone status
  'hosting.kind.zone': 'DNS zone',
  'hosting.kind.registration': 'Registration',
  'hosting.zone.status.active': 'Active',
  'hosting.zone.status.pending': 'Waiting for name servers',
  'hosting.zone.status.initializing': 'Being set up',
  'hosting.zone.status.moved': 'Name servers moved',
  'hosting.zone.hostedAt': 'DNS zone at {provider}',
  'hosting.zone.noExpiry':
    'A DNS zone does not expire. The expiry date belongs to the registration of the domain.',

  // Zone overview
  'hosting.zone.title': 'Zone and name servers',
  'hosting.zone.text': '{provider} assigned these name servers to the zone.',
  'hosting.zone.pendingTitle': 'The zone is waiting for the name servers',
  'hosting.zone.pendingText':
    '{provider} activates the zone as soon as the domain points to the assigned name servers. Until then the records at the previous name servers apply.',
  'hosting.zone.nameserversToSet': 'Set these name servers at the registrar:',
  'hosting.zone.copyAll': 'Copy all',
  'hosting.zone.copied': 'Copied',
  'hosting.zone.originalNameservers': 'Previous name servers',
  'hosting.zone.originalRegistrar': 'Previous registrar',
  'hosting.zone.createdAt': 'Created on',
  'hosting.zone.activatedAt': 'Activated on',
  'hosting.zone.type': 'Zone type',
  'hosting.zone.type.full': 'Full',
  'hosting.zone.type.partial': 'Partial (CNAME setup)',
  'hosting.zone.type.secondary': 'Secondary (read only)',
  'hosting.zone.plan': 'Plan',
  'hosting.zone.paused': 'Zone paused',
  'hosting.zone.pausedText': '{provider} only answers DNS queries. Proxy and CDN are off for this zone.',
  'hosting.zone.movedText':
    'The domain no longer points to the name servers of {provider}. The records of this zone no longer apply, and {provider} deletes the zone after a while.',
  'hosting.zone.checkActivation': 'Check activation now',
  'hosting.zone.checkActivationHint':
    '{provider} checks the name servers regularly anyway. On the free plan a manual check is possible at most once per hour.',
  'hosting.zone.checkActivationDone':
    'Check requested. The zone becomes active as soon as {provider} sees the new name servers.',
  'hosting.zone.nsMatch':
    'The registration already points to these name servers. The zone becomes active as soon as {provider} sees the change.',
  'hosting.zone.registrationTitle': 'Registration',
  'hosting.zone.registrationText':
    'The domain is registered at {registrar}. That is where you set the name servers.',
  'hosting.zone.registrar': 'Registrar',
  'hosting.zone.delegation': 'Name servers at the registrar',
  'hosting.zone.delegationOk': 'Points to this zone',
  'hosting.zone.delegationOther': 'Does not point to this zone',
  'hosting.zone.openRegistration': 'Go to the domain at {registrar}',
  'hosting.zone.dnsPendingTitle': 'The zone is not active yet',
  'hosting.zone.dnsPendingText':
    'You can prepare the records already. They apply as soon as the domain points to the name servers of {provider}.',

  // Registration with a zone of the same name
  'hosting.dnsZone.title': 'DNS at {provider}',
  'hosting.dnsZone.text':
    'The DNS records of {name} are managed by the zone at {provider}. The records at the registrar below are not active.',
  'hosting.dnsZone.notActive':
    'There is a zone for {name} at {provider} ({status}). The domain does not point to its name servers yet.',
  'hosting.dnsZone.open': 'Go to DNS zone',
  'hosting.dnsZone.otherOrg':
    'The zone belongs to another organization. Please contact its owner or support.',
  'hosting.dnsZone.prepared':
    'A zone at {provider} is prepared ({status}). Until the domain points to the name servers of {provider}, the records here apply.',
  'hosting.dnsZone.nsLine': 'DNS zone at {provider}: {status}',
  'hosting.dnsZone.preset': 'Name servers of the zone at {provider}',
  'hosting.dnsZone.presetHint': '{list}. Needed for the DNS records of the zone at {provider} to apply.',

  // DNS records: proxy, automatic TTL, comments
  'hosting.dns.proxy.column': 'Proxy',
  'hosting.dns.proxy.on': 'Proxied',
  'hosting.dns.proxy.off': 'DNS only',
  'hosting.dns.proxy.onHint':
    'Traffic goes through {provider} (CDN and protection). The address of your server stays hidden.',
  'hosting.dns.proxy.offHint': 'DNS only: the address is handed out directly, without proxy and CDN.',
  'hosting.dns.proxy.turnOn': 'Turn proxy on',
  'hosting.dns.proxy.turnOff': 'Turn proxy off',
  'hosting.dns.proxy.label': 'Route through Cloudflare (proxy)',
  'hosting.dns.proxy.hint':
    'Visitors reach the server through Cloudflare with CDN, protection and HTTPS. The TTL is automatic then.',
  'hosting.dns.proxy.notProxiable':
    'Cloudflare cannot route this record through the proxy, for example because it points to a private address.',
  'hosting.dns.proxy.toggledOn': 'Proxy turned on for {name}',
  'hosting.dns.proxy.toggledOff': 'Proxy turned off for {name}',
  'hosting.dns.ttlAuto': 'Automatic',
  'hosting.dns.cnameFlattening':
    'Allowed: {provider} hands out the addresses of the target for the domain itself (CNAME flattening).',
  'hosting.dns.comment': 'Note',

  // CDN
  'hosting.cdn.tab': 'CDN',
  'hosting.cdn.notActive':
    'The zone is not active yet. The settings take effect once the domain points to the name servers of {provider}.',
  'hosting.cdn.noProxied':
    'CDN settings only apply to proxied records. No record goes through {provider} at the moment. Turn the proxy on in the "DNS" tab.',
  'hosting.cdn.readOnly':
    'You can view the settings. To change them you need the permission "Change name servers, transfer lock and CDN settings".',
  'hosting.cdn.notEditable': 'The plan of the zone does not allow this change.',
  'hosting.cdn.saved': 'CDN setting saved',
  'hosting.cdn.ssl.title': 'SSL/TLS',
  'hosting.cdn.ssl.text': 'How {provider} encrypts the connections to visitors and to your server.',
  'hosting.cdn.ssl.label': 'Encryption mode',
  'hosting.cdn.ssl.effective': '{provider} currently uses: {mode}',
  'hosting.cdn.ssl.propagation': 'A change can take up to 5 minutes to apply everywhere.',
  'hosting.cdn.ssl.mode.auto': 'Automatic (recommended)',
  'hosting.cdn.ssl.mode.off': 'Off',
  'hosting.cdn.ssl.mode.flexible': 'Flexible',
  'hosting.cdn.ssl.mode.full': 'Full',
  'hosting.cdn.ssl.mode.strict': 'Full (strict)',
  'hosting.cdn.ssl.desc.auto':
    '{provider} checks your server and picks the most secure mode that works. {provider} may raise the mode later by itself.',
  'hosting.cdn.ssl.desc.off':
    'No encryption. Visitors reach the website over HTTP only, browsers warn about it.',
  'hosting.cdn.ssl.desc.flexible':
    'Encrypted between visitors and {provider}, but unencrypted to your server. If the server redirects to HTTPS itself, this causes a redirect loop.',
  'hosting.cdn.ssl.desc.full':
    'Encrypted up to your server. The certificate of the server is not checked, a self-signed one is enough.',
  'hosting.cdn.ssl.desc.strict':
    "Encrypted up to your server, which needs a valid certificate (e.g. from Let's Encrypt). The most secure mode.",
  'hosting.cdn.ssl.confirmTitle': 'Set SSL/TLS to "{mode}"?',
  'hosting.cdn.ssl.confirmText':
    'With this mode the connection to your server is not encrypted. Data such as passwords can be read on the way. Only choose it if your server cannot do HTTPS.',
  'hosting.cdn.https.title': 'HTTPS',
  'hosting.cdn.https.label': 'Always use HTTPS',
  'hosting.cdn.https.hint': 'Redirects every request over HTTP to HTTPS.',
  'hosting.cdn.dev.title': 'Development mode',
  'hosting.cdn.dev.label': 'Bypass the cache for now',
  'hosting.cdn.dev.hint':
    'Changes to the website are visible right away because {provider} caches nothing. The mode switches itself off after 3 hours.',
  'hosting.cdn.dev.remaining': 'On, switches itself off in {time}.',
  'hosting.cdn.purge.title': 'Cache',
  'hosting.cdn.purge.text':
    '{provider} caches files of your website. After an update, purge the cache so visitors get the new version.',
  'hosting.cdn.purge.button': 'Purge everything',
  'hosting.cdn.purge.confirmTitle': 'Purge the whole cache of {name}?',
  'hosting.cdn.purge.confirmText':
    '{provider} then fetches every file from your server again. That can put more load on the server for a short time.',
  'hosting.cdn.purge.done': 'Purging the cache. This usually takes only a few seconds.',
  'hosting.cdn.purge.wait': 'The cache was just purged. You can purge it again in 30 seconds.',

  // DNS move (platform staff)
  'hosting.dnsMove.action': 'Move DNS to Cloudflare',
  'hosting.dnsMove.cardTitle': 'Move DNS to Cloudflare',
  'hosting.dnsMove.cardText':
    'Creates a zone at Cloudflare, copies the DNS records from the registrar and switches the name servers if you want.',
  'hosting.dnsMove.title': 'Move DNS of {name} to Cloudflare',
  'hosting.dnsMove.intro':
    'The console creates the zone or uses an existing one, copies the records and switches the name servers only once every record was copied. Every step is recorded in the audit log.',
  'hosting.dnsMove.target': 'Cloudflare account',
  'hosting.dnsMove.noTargets':
    'No Cloudflare connection with an account ID. Enter the account ID of a Cloudflare connection under "Providers" so the console can create zones.',
  'hosting.dnsMove.existingZone':
    'There already is a zone for {name} at {provider} ({status}). If it is in the selected account, it is used instead of a new one.',
  'hosting.dnsMove.import.label': 'Copy records from the registrar ({n})',
  'hosting.dnsMove.import.hint':
    'Copies the records into the new zone. Copied records are not proxied, so traffic does not change.',
  'hosting.dnsMove.import.unavailable':
    "Not possible: the domain does not use the registrar's name servers, so its records there are not the ones in use.",
  'hosting.dnsMove.import.error': 'The records at the registrar could not be read:',
  'hosting.dnsMove.import.tooMany':
    'Not possible: more than {max} records. Import the zone in the Cloudflare dashboard.',
  'hosting.dnsMove.import.zoneNotEmpty': 'The console copies nothing into a zone that already has records.',
  'hosting.dnsMove.planned': 'To be copied ({n})',
  'hosting.dnsMove.converted': 'Adjusted ({n})',
  'hosting.dnsMove.convertedType': '{from} becomes {to}',
  'hosting.dnsMove.ttlChanged': 'TTL {from} becomes {to}',
  'hosting.dnsMove.skipped.title': 'Not copied ({n})',
  'hosting.dnsMove.skipped.reason.type': 'Type does not exist at Cloudflare',
  'hosting.dnsMove.skipped.reason.readOnly': 'Read only',
  'hosting.dnsMove.skipped.reason.apexNs': 'Name servers of the domain, set by Cloudflare itself',
  'hosting.dnsMove.ns.label': 'Switch name servers at the registrar',
  'hosting.dnsMove.ns.hint':
    'Points the domain to the name servers of the zone once every record was copied. From then on the records at Cloudflare apply.',
  'hosting.dnsMove.ns.unsupported':
    'Not possible: the registrar does not support switching through the console. You set the name servers by hand afterwards.',
  'hosting.dnsMove.ns.requiresImport': 'Only possible once every record is copied.',
  'hosting.dnsMove.warning':
    "After the switch Cloudflare's name servers answer every DNS query of the domain. Check the lists: what is not copied will be missing.",
  'hosting.dnsMove.submit': 'Start move',
  'hosting.dnsMove.result.title': 'Result of the move',
  'hosting.dnsMove.result.zoneCreated': 'Zone created',
  'hosting.dnsMove.result.zoneReused': 'Existing zone used',
  'hosting.dnsMove.result.import.done': '{n} records copied',
  'hosting.dnsMove.result.import.partial': '{n} records copied, {failed} failed',
  'hosting.dnsMove.result.import.skipped': 'No records copied',
  'hosting.dnsMove.result.import.failed': 'Records could not be copied',
  'hosting.dnsMove.result.import.reason.notRequested': 'Not selected.',
  'hosting.dnsMove.result.import.reason.registrarNotServing':
    "The domain does not use the registrar's name servers.",
  'hosting.dnsMove.result.import.reason.zoneNotEmpty':
    'The zone already has records. The console does not copy anything into it.',
  'hosting.dnsMove.result.import.reason.tooManyRecords': 'Too many records for a move through the console.',
  'hosting.dnsMove.result.import.reason.recordsUnreadable': 'The records at the registrar could not be read.',
  'hosting.dnsMove.result.ns.done': 'Name servers switched at the registrar',
  'hosting.dnsMove.result.ns.skipped': 'Name servers not switched',
  'hosting.dnsMove.result.ns.failed': 'Name servers could not be switched',
  'hosting.dnsMove.result.ns.manual': 'Set the name servers by hand',
  'hosting.dnsMove.result.ns.reason.notRequested':
    'Not selected. Set these name servers at the registrar once the zone is complete:',
  'hosting.dnsMove.result.ns.reason.importIncomplete':
    'Not every record was copied. Complete the zone, then set these name servers in the overview of the domain:',
  'hosting.dnsMove.result.ns.reason.unsupported':
    'The registrar does not support this through the console. Set these name servers there by hand:',
  'hosting.dnsMove.result.openZone': 'Go to zone',

  // API explorer
  'explorer.cloudflarePath':
    'Paths relative to /client/v4, e.g. /zones/<zone_id>/dns_records. Secrets in answers are hidden, API tokens cannot be managed here.',
} as const;
