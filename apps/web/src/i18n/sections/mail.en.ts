import type { mailDe } from './mail.de';

export const mailEn: Record<keyof typeof mailDe, string> = {
  'nav.mail': 'E-mail',
  'perm.group.mail': 'E-mail',

  // Admin
  'mail.admin.tab': 'Mail domains',
  'mail.admin.synced': '{seen} mail domains synced, {missing} missing at Mailcow',

  // Provider form
  'providers.mailcow.help':
    "Create an API key with read and write access in Mailcow as admin and enter the console's outgoing IPv4 and IPv6 addresses in its allow list. Failed logins block the console's IP: put it on Mailcow's netfilter whitelist before the first test.",
  'providers.mailcow.url': 'URL of the Mailcow instance',
  'providers.mailcow.urlHint':
    'As the console reaches Mailcow, with a valid certificate and without a path, e.g. https://mail.weblion.one',
  'providers.mailcow.apiKey': 'API key (read & write)',
  'providers.mailcow.apiKeyHint':
    'Mailcow > System > Configuration > Access > API. Leave "Skip IP check for API" off, a read-only key is not enough.',
  'providers.mailcow.apiKeyInvalid': 'Letters, digits and "-" only, at least 16 characters.',
  'providers.mailcow.mailHost': 'Mail server host name (optional)',
  'providers.mailcow.mailHostHint':
    'For MX, IMAP, SMTP and webmail, when it differs from the host of the URL. Default: the host of the URL.',
  'providers.mailcow.mailHostInvalid': 'A host name such as mail.weblion.one.',
  'providers.mailcow.domainsText':
    'Mail domains of this instance, their limits and their assignment to customers.',
  'providers.mailcow.toDomains': 'Go to mail domains',

  // Reseller resources
  'admin.resources.title.maildomain': 'Mail domains',
  'admin.resources.empty.maildomain': 'No mail domains are assigned to this customer.',
  'admin.resources.assign.maildomain': 'Assign mail domain',
  'admin.resources.mailDomains': 'Mail domains',
  'admin.blocker.mailDomains': 'Mail domains: {n}',

  // API explorer
  'explorer.mailcowPath':
    'Paths start with /api/v1/get, /add, /edit or /delete. The method follows from the path: get reads (GET), everything else changes (POST). Passwords and keys in answers are hidden.',
  'explorer.mailcowBodyHint':
    'add: the attributes. edit: { "items": [...], "attr": {...} }. delete: { "items": [...] }, the console sends the list itself. Values as text ("1"/"0"), sizes in MiB.',
} as const;
