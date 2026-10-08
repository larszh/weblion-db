/**
 * Catalog of every action the panel knows about.
 *
 * Actions are colon separated (`server:backup:create`). Policies reference them
 * directly or with globs (`server:*`, `*:read`). Anything not listed here can
 * never be granted, which keeps typos in custom policies from silently doing
 * nothing: the policy validator rejects patterns that match no action.
 */

export type PermissionGroup =
  | 'organization'
  | 'members'
  | 'projects'
  | 'servers'
  | 'backups'
  | 'snapshots'
  | 'networking'
  | 'security'
  | 'domains'
  | 'webhosting'
  | 'billing'
  | 'reseller'
  | 'platform';

export interface PermissionDef {
  group: PermissionGroup;
  label: { de: string; en: string };
  /** Destructive or cost relevant. The UI asks for confirmation and highlights these. */
  dangerous?: boolean;
  /** Only meaningful for weblion staff, never granted through organization roles. */
  platform?: boolean;
}

const def = (
  group: PermissionGroup,
  de: string,
  en: string,
  extra: Partial<Pick<PermissionDef, 'dangerous' | 'platform'>> = {},
): PermissionDef => ({ group, label: { de, en }, ...extra });

export const PERMISSIONS = {
  // Organization
  'org:read': def('organization', 'Organisation ansehen', 'View organization'),
  'org:update': def('organization', 'Organisation bearbeiten', 'Edit organization'),
  'org:delete': def('organization', 'Organisation löschen', 'Delete organization', { dangerous: true }),
  'audit:read': def('organization', 'Audit-Log ansehen', 'View audit log'),

  // Members & access
  'member:read': def('members', 'Mitglieder ansehen', 'View members'),
  'member:invite': def('members', 'Mitglieder einladen', 'Invite members'),
  'member:update': def('members', 'Rollen und Policies zuweisen', 'Change roles and policies'),
  'member:remove': def('members', 'Mitglieder entfernen', 'Remove members', { dangerous: true }),
  'policy:read': def('members', 'Access Policies ansehen', 'View access policies'),
  'policy:write': def('members', 'Access Policies verwalten', 'Manage access policies'),
  'apitoken:read': def('security', 'API-Tokens ansehen', 'View API tokens'),
  'apitoken:write': def('security', 'API-Tokens erstellen/widerrufen', 'Create/revoke API tokens'),

  // Projects
  'project:read': def('projects', 'Projekte ansehen', 'View projects'),
  'project:create': def('projects', 'Projekte erstellen', 'Create projects'),
  'project:update': def('projects', 'Projekte bearbeiten', 'Edit projects'),
  'project:delete': def('projects', 'Projekte löschen', 'Delete projects', { dangerous: true }),

  // Servers
  'server:read': def('servers', 'Server ansehen', 'View servers'),
  'server:metrics': def('servers', 'Monitoring und Graphen', 'Monitoring and graphs'),
  'server:task:read': def('servers', 'Aktivität und Tasks ansehen', 'View activity and tasks'),
  'server:power': def('servers', 'Energie (Start, Stop, Neustart)', 'Power (start, stop, reboot)'),
  'server:console': def('servers', 'Konsole öffnen', 'Open console'),
  'server:rename': def('servers', 'Server umbenennen', 'Rename server'),
  'server:labels': def('servers', 'Labels bearbeiten', 'Edit labels'),
  'server:protection': def('servers', 'Schutz ein/aus', 'Toggle protection'),
  'server:config:read': def('servers', 'Technische Konfiguration ansehen', 'View technical config'),
  'server:iso': def('servers', 'ISO einlegen/auswerfen', 'Mount/unmount ISO'),
  'server:password-reset': def('servers', 'Root-Passwort zurücksetzen', 'Reset root password', {
    dangerous: true,
  }),
  'server:rebuild': def('servers', 'Neu installieren (Rebuild)', 'Rebuild (reinstall)', { dangerous: true }),
  'server:rescale': def('servers', 'Ressourcen ändern (Rescale)', 'Rescale resources', { dangerous: true }),
  'server:move': def('servers', 'In anderes Projekt verschieben', 'Move to another project'),
  'server:delete': def('servers', 'Server löschen', 'Delete server', { dangerous: true }),

  // Backups & snapshots
  'server:backup:read': def('backups', 'Backups ansehen', 'View backups'),
  'server:backup:create': def('backups', 'Backups erstellen', 'Create backups'),
  'server:backup:restore': def('backups', 'Backups wiederherstellen', 'Restore backups', { dangerous: true }),
  'server:backup:delete': def('backups', 'Backups löschen', 'Delete backups', { dangerous: true }),
  'server:snapshot:read': def('snapshots', 'Snapshots ansehen', 'View snapshots'),
  'server:snapshot:create': def('snapshots', 'Snapshots erstellen', 'Create snapshots'),
  'server:snapshot:rollback': def('snapshots', 'Snapshot zurückspielen', 'Roll back snapshot', {
    dangerous: true,
  }),
  'server:snapshot:delete': def('snapshots', 'Snapshots löschen', 'Delete snapshots', { dangerous: true }),

  // Networking
  'server:network:read': def('networking', 'Netzwerk ansehen', 'View networking'),
  'server:network:update': def(
    'networking',
    'rDNS und DDoS-Schutz ändern',
    'Change rDNS and DDoS protection',
  ),
  'server:firewall:read': def('networking', 'Firewall ansehen', 'View firewall'),
  'server:firewall:write': def('networking', 'Firewall bearbeiten', 'Edit firewall'),

  // Domains & DNS (module "dns")
  'domain:read': def('domains', 'Domains und DNS-Einträge ansehen', 'View domains and DNS records'),
  'domain:dns:write': def('domains', 'DNS-Einträge bearbeiten', 'Edit DNS records'),
  'domain:authcode': def('domains', 'Auth-Code (Transfer) anzeigen', 'Show auth code (transfer)', {
    dangerous: true,
  }),

  // Web hosting (module "webhosting")
  'webspace:read': def('webhosting', 'Webspaces ansehen', 'View web spaces'),
  'webspace:credentials': def(
    'webhosting',
    'Zugangsdaten (Plesk) anzeigen',
    'Show login credentials (Plesk)',
    {
      dangerous: true,
    },
  ),

  // Billing
  'billing:read': def(
    'billing',
    'Rechnungen, Guthaben und Dienste ansehen',
    'View invoices, credit and services',
  ),
  'billing:pay': def('billing', 'Rechnungen bezahlen, Guthaben aufladen', 'Pay invoices, top up credit'),
  'billing:write': def('billing', 'Rechnungsadresse verwalten', 'Manage billing address'),

  // Reseller (only for reseller organizations, see DEFAULT_RESELLER_BOUNDARY)
  'reseller:customer:read': def('reseller', 'Eigene Kunden ansehen', 'View own customers'),
  'reseller:customer:write': def(
    'reseller',
    'Kunden anlegen, bearbeiten, sperren, Module freischalten',
    'Create, edit and suspend customers, activate modules',
  ),
  'reseller:customer:access': def(
    'reseller',
    'In Kunden-Organisationen arbeiten (mit den eigenen Rechten)',
    'Work inside customer organizations (with own permissions)',
  ),
  'reseller:billing': def(
    'reseller',
    'Rechnungen, Guthaben, Dienste und Preise für Kunden verwalten',
    'Manage invoices, credit, services and prices for customers',
    { dangerous: true },
  ),

  // Platform (weblion staff only)
  'platform:access': def('platform', 'Admin-Bereich öffnen', 'Open admin area', { platform: true }),
  'platform:org:read': def('platform', 'Alle Kunden ansehen', 'View all customers', { platform: true }),
  'platform:org:write': def('platform', 'Kunden anlegen/bearbeiten', 'Create/edit customers', {
    platform: true,
  }),
  'platform:user:read': def('platform', 'Alle Benutzer ansehen', 'View all users', { platform: true }),
  'platform:user:write': def('platform', 'Benutzer verwalten', 'Manage users', { platform: true }),
  'platform:provider:read': def('platform', 'Provider ansehen', 'View providers', { platform: true }),
  'platform:provider:write': def(
    'platform',
    'Provider verwalten (Zugangsdaten)',
    'Manage providers (credentials)',
    {
      platform: true,
      dangerous: true,
    },
  ),
  'platform:server:assign': def(
    'platform',
    'Server, Domains und Webspaces Kunden zuweisen',
    'Assign servers, domains and web spaces to customers',
    { platform: true },
  ),
  'platform:server:create': def('platform', 'Server bei Providern erstellen', 'Create servers at providers', {
    platform: true,
    dangerous: true,
  }),
  'platform:infra:read': def('platform', 'Infrastruktur (Nodes, Storage) ansehen', 'View infrastructure', {
    platform: true,
  }),
  'platform:explorer': def(
    'platform',
    'API Explorer (Rohzugriff auf Provider-APIs)',
    'API explorer (raw provider API)',
    {
      platform: true,
      dangerous: true,
    },
  ),
  'platform:audit:read': def('platform', 'Globales Audit-Log', 'Global audit log', { platform: true }),
  'platform:billing:read': def(
    'platform',
    'Abrechnung aller Kunden ansehen',
    'View billing of all customers',
    {
      platform: true,
    },
  ),
  'platform:billing:write': def(
    'platform',
    'Rechnungen erstellen, Guthaben buchen, Dienste und Preise verwalten',
    'Create invoices, book credit, manage services and prices',
    { platform: true, dangerous: true },
  ),
  'platform:settings': def(
    'platform',
    'Plattform-Einstellungen (E-Mail, Rechnungssteller, Integrationen)',
    'Platform settings (email, invoice issuer, integrations)',
    { platform: true, dangerous: true },
  ),
} as const satisfies Record<string, PermissionDef>;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const ORG_PERMISSIONS = ALL_PERMISSIONS.filter((p) => !(PERMISSIONS[p] as PermissionDef).platform);

export const PLATFORM_PERMISSIONS = ALL_PERMISSIONS.filter((p) => (PERMISSIONS[p] as PermissionDef).platform);

export function isPermission(value: string): value is Permission {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  'organization',
  'members',
  'security',
  'projects',
  'servers',
  'backups',
  'snapshots',
  'networking',
  'domains',
  'webhosting',
  'billing',
  'reseller',
  'platform',
];
