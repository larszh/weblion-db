import type { PolicyStatement } from './policy';

/**
 * Service modules a customer can have activated ("freigeschaltet").
 *
 * A module that is not active for an organization is hidden in the console and every
 * action that belongs to it is denied, for the organization's own members as well as for
 * its reseller. Platform staff still see everything. Core areas (members, policies, API
 * tokens, audit log, settings, billing) are always available and not modules.
 */
export const MODULES = [
  'servers',
  'dns',
  'webhosting',
  'storage',
  'mail',
  'phone',
  'media',
  'monitoring',
] as const;
export type ModuleKey = (typeof MODULES)[number];

export interface ModuleDef {
  label: { de: string; en: string };
  description: { de: string; en: string };
  /** Action patterns that only work while the module is active. */
  actions: string[];
}

export const MODULE_DEFS: Record<ModuleKey, ModuleDef> = {
  servers: {
    label: { de: 'Cloud Server', en: 'Cloud servers' },
    description: {
      de: 'Virtuelle Server bei 24fire (DE) und auf Proxmox (CH), mit Projekten.',
      en: 'Virtual servers at 24fire (DE) and on Proxmox (CH), with projects.',
    },
    actions: ['server:*', 'project:*'],
  },
  dns: {
    label: { de: 'Domains & DNS', en: 'Domains & DNS' },
    description: {
      de: 'Domains ansehen, DNS-Einträge verwalten und CDN-Einstellungen (Cloudflare) ändern.',
      en: 'View domains, manage DNS records and change CDN settings (Cloudflare).',
    },
    actions: ['domain:*'],
  },
  webhosting: {
    label: { de: 'Webhosting', en: 'Web hosting' },
    description: {
      de: 'Websites auf eigenen Servern (CloudPanel) mit SFTP/SSH, Datenbanken und SSL-Zertifikaten, sowie Webspaces mit Plesk-Zugang (24fire).',
      en: 'Websites on our own servers (CloudPanel) with SFTP/SSH, databases and SSL certificates, and web spaces with Plesk access (24fire).',
    },
    actions: ['webspace:*'],
  },
  storage: {
    label: { de: 'Cloud-Speicher', en: 'Cloud storage' },
    description: {
      de: 'Nextcloud-Konten für Dateien, Kalender und Kontakte, mit Speicherkontingent.',
      en: 'Nextcloud accounts for files, calendars and contacts, with a storage allowance.',
    },
    actions: ['cloud:*'],
  },
  mail: {
    label: { de: 'E-Mail', en: 'E-mail' },
    description: {
      de: 'E-Mail-Domains mit Postfächern und Weiterleitungen (Mailcow), mit Webmail, IMAP und SMTP.',
      en: 'E-mail domains with mailboxes and forwarding (Mailcow), with webmail, IMAP and SMTP.',
    },
    actions: ['mail:*'],
  },
  phone: {
    label: { de: 'Telefonie', en: 'Telephony' },
    description: {
      de: '3CX-Telefonanlagen: Benutzer und Nebenstellen, Ringgruppen und Leitungen verwalten.',
      en: '3CX phone systems: manage users and extensions, ring groups and trunks.',
    },
    actions: ['phone:*'],
  },
  media: {
    label: { de: 'Streaming', en: 'Streaming' },
    description: {
      de: 'Zugänge zum Jellyfin-Mediaserver für Filme, Serien und Musik, mit Kontingent für Zugänge, Bibliotheken und gleichzeitige Streams.',
      en: 'Accounts on the Jellyfin media server for movies, series and music, with an allowance of accounts, libraries and simultaneous streams.',
    },
    actions: ['media:*'],
  },
  monitoring: {
    label: { de: 'Monitoring', en: 'Monitoring' },
    description: {
      de: 'Verfügbarkeit von Websites und Diensten (Uptime Kuma): Status, Uptime, Antwortzeit und Ablauf der Zertifikate, eigene Monitore im Kontingent.',
      en: 'Availability of websites and services (Uptime Kuma): status, uptime, response time and certificate expiry, own monitors within an allowance.',
    },
    actions: ['monitor:*'],
  },
};

/** Modules new customer organizations start with. */
export const DEFAULT_MODULES: ModuleKey[] = ['servers'];

export function isModuleKey(value: string): value is ModuleKey {
  return (MODULES as readonly string[]).includes(value);
}

/** Keeps known modules only, without duplicates, in catalog order. */
export function normalizeModules(values: readonly string[]): ModuleKey[] {
  return MODULES.filter((m) => values.includes(m));
}

/** Deny statements for every module that is not in `enabled`. Appended to the boundary. */
export function moduleDenyStatements(enabled: readonly ModuleKey[]): PolicyStatement[] {
  const disabled = MODULES.filter((m) => !enabled.includes(m));
  if (disabled.length === 0) return [];
  return [
    {
      sid: 'ModulesNotActive',
      effect: 'deny',
      actions: disabled.flatMap((m) => MODULE_DEFS[m].actions),
    },
  ];
}
