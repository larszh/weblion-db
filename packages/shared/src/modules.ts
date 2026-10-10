import type { PolicyStatement } from './policy';

/**
 * Service modules a customer can have activated ("freigeschaltet").
 *
 * A module that is not active for an organization is hidden in the console and every
 * action that belongs to it is denied, for the organization's own members as well as for
 * its reseller. Platform staff still see everything. Core areas (members, policies, API
 * tokens, audit log, settings, billing) are always available and not modules.
 */
export const MODULES = ['servers', 'dns', 'webhosting', 'storage', 'mail'] as const;
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
      de: 'Webspaces mit Plesk-Zugang, E-Mail-Postfächern und Datenbanken.',
      en: 'Web spaces with Plesk access, mailboxes and databases.',
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
