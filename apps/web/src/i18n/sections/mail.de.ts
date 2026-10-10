/**
 * E-Mail (Modul "mail", Mailcow): Navigation, Admin-Tab, Provider-Formular, Reseller-
 * Ressourcen und API Explorer. Die E-Mail-Seiten ergänzen ihre Keys ("mail.*") hier.
 */
export const mailDe = {
  'nav.mail': 'E-Mail',
  'perm.group.mail': 'E-Mail',

  // Admin
  'mail.admin.tab': 'E-Mail-Domains',
  'mail.admin.synced': '{seen} Mail-Domains abgeglichen, {missing} fehlen bei Mailcow',

  // Provider form
  'providers.mailcow.help':
    'Erstellen Sie in Mailcow als Admin einen API-Key mit Lese- und Schreibzugriff und tragen Sie die ausgehenden IPv4- und IPv6-Adressen der Console in seine Allow-List ein. Fehlgeschlagene Anmeldungen sperren die IP der Console: Setzen Sie sie vor dem ersten Test auf die Netfilter-Whitelist von Mailcow.',
  'providers.mailcow.url': 'URL der Mailcow-Instanz',
  'providers.mailcow.urlHint':
    'So, wie die Console Mailcow erreicht, mit gültigem Zertifikat und ohne Pfad, z.B. https://mail.weblion.one',
  'providers.mailcow.apiKey': 'API-Key (Lesen & Schreiben)',
  'providers.mailcow.apiKeyHint':
    'Mailcow > System > Konfiguration > Zugang > API. "IP-Prüfung überspringen" bleibt aus, ein Key nur zum Lesen reicht nicht.',
  'providers.mailcow.apiKeyInvalid': 'Nur Buchstaben, Ziffern und "-", mindestens 16 Zeichen.',
  'providers.mailcow.mailHost': 'Mailserver-Hostname (optional)',
  'providers.mailcow.mailHostHint':
    'Für MX, IMAP, SMTP und Webmail, wenn er vom Host der URL abweicht. Standard: der Host der URL.',
  'providers.mailcow.mailHostInvalid': 'Ein Hostname wie mail.weblion.one.',
  'providers.mailcow.domainsText': 'Mail-Domains dieser Instanz, ihre Limits und die Zuweisung an Kunden.',
  'providers.mailcow.toDomains': 'Zu den Mail-Domains',

  // Reseller resources
  'admin.resources.title.maildomain': 'E-Mail-Domains',
  'admin.resources.empty.maildomain': 'Diesem Kunden sind keine E-Mail-Domains zugewiesen.',
  'admin.resources.assign.maildomain': 'E-Mail-Domain zuweisen',
  'admin.resources.mailDomains': 'E-Mail-Domains',
  'admin.blocker.mailDomains': 'E-Mail-Domains: {n}',

  // API explorer
  'explorer.mailcowPath':
    'Pfade beginnen mit /api/v1/get, /add, /edit oder /delete. Die Methode ergibt sich aus dem Pfad: get liest (GET), alles andere ändert (POST). Passwörter und Schlüssel in Antworten werden ausgeblendet.',
  'explorer.mailcowBodyHint':
    'add: die Attribute. edit: { "items": [...], "attr": {...} }. delete: { "items": [...] }, die Console sendet die Liste selbst. Werte als Text ("1"/"0"), Grössen in MiB.',
} as const;
