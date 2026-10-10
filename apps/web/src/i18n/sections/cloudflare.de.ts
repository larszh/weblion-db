/**
 * Cloudflare (DNS-Zonen und CDN): Provider-Formular und API Explorer. Die Domain-Seiten
 * (Zone, Proxy, CDN, DNS-Umzug) ergänzen ihre Keys hier.
 */
export const cloudflareDe = {
  // Provider form
  'providers.cloudflare.help':
    'Erstellen Sie im Cloudflare-Dashboard unter Mein Profil > API-Tokens ein eigenes Token (nicht den Global API Key) für alle Zonen des Kontos. Cloudflare erlaubt 1200 API-Anfragen pro 5 Minuten und Benutzer: Ein eigener Cloudflare-Benutzer für die Console ist am besten.',
  'providers.cloudflare.token': 'API-Token',
  'providers.cloudflare.tokenHint':
    'API-Tokens > Token erstellen > Benutzerdefiniertes Token, Zonenressourcen "Alle Zonen eines Kontos".',
  'providers.cloudflare.permissions': 'Benötigte Berechtigungen: {permissions}',
  'providers.cloudflare.accountId': 'Konto-ID',
  'providers.cloudflare.accountIdHint':
    'Optional, auf der Startseite des Kontos im Dashboard. Nötig, um Zonen anzulegen (DNS-Umzug zu Cloudflare), und beschränkt die Zonenliste auf dieses Konto.',
  'providers.cloudflare.accountIdInvalid': 'Die Konto-ID besteht aus 32 Zeichen (0-9, a-f).',
  'providers.cloudflare.baseUrl': 'API Base URL',
  'providers.cloudflare.baseUrlHint': 'Standard: {url}',
  'providers.cloudflare.zones': 'DNS-Zonen',
  'providers.cloudflare.zonesText':
    'DNS-Zonen dieses Kontos und ihre Zuweisung an Kunden. Neue Zonen erscheinen nach dem nächsten Abgleich.',
  'providers.cloudflare.toZones': 'Zu den Zonen',

  // API explorer
  'explorer.cloudflarePath':
    'Pfade relativ zu /client/v4, z.B. /zones/<zone_id>/dns_records. Geheimnisse in Antworten werden ausgeblendet, API-Tokens lassen sich hier nicht verwalten.',
} as const;
