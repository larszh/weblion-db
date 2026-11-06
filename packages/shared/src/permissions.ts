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
  | 'storage'
  | 'mail'
  | 'phone'
  | 'media'
  | 'monitoring'
  | 'ai'
  | 'billing'
  | 'reseller'
  | 'platform';

/**
 * One action of the catalog. Its label is the dictionary key `perm.<action>` (section core, plan O3), so it can
 * be translated like every other text; `GET /meta` still answers `label: { de, en }` from the dictionaries.
 */
export interface PermissionDef {
  group: PermissionGroup;
  /** Destructive or cost relevant. The UI asks for confirmation and highlights these. */
  dangerous?: boolean;
  /** Only meaningful for weblion staff, never granted through organization roles. */
  platform?: boolean;
}

const def = (
  group: PermissionGroup,
  extra: Partial<Pick<PermissionDef, 'dangerous' | 'platform'>> = {},
): PermissionDef => ({ group, ...extra });

export const PERMISSIONS = {
  // Organization
  'org:read': def('organization'),
  'org:update': def('organization'),
  'org:delete': def('organization', { dangerous: true }),
  'audit:read': def('organization'),

  // Members & access
  'member:read': def('members'),
  'member:invite': def('members'),
  'member:update': def('members'),
  'member:remove': def('members', { dangerous: true }),
  'policy:read': def('members'),
  'policy:write': def('members'),
  'apitoken:read': def('security'),
  'apitoken:write': def('security'),

  // Projects
  'project:read': def('projects'),
  'project:create': def('projects'),
  'project:update': def('projects'),
  'project:delete': def('projects', { dangerous: true }),

  // Servers
  'server:read': def('servers'),
  'server:metrics': def('servers'),
  'server:task:read': def('servers'),
  'server:power': def('servers'),
  'server:console': def('servers'),
  'server:rename': def('servers'),
  'server:labels': def('servers'),
  'server:protection': def('servers'),
  'server:config:read': def('servers'),
  'server:iso': def('servers'),
  'server:password-reset': def('servers', { dangerous: true }),
  'server:rebuild': def('servers', { dangerous: true }),
  'server:rescale': def('servers', { dangerous: true }),
  'server:move': def('servers'),
  'server:delete': def('servers', { dangerous: true }),

  // Backups & snapshots
  'server:backup:read': def('backups'),
  'server:backup:create': def('backups'),
  'server:backup:restore': def('backups', { dangerous: true }),
  'server:backup:delete': def('backups', { dangerous: true }),
  'server:snapshot:read': def('snapshots'),
  'server:snapshot:create': def('snapshots'),
  'server:snapshot:rollback': def('snapshots', { dangerous: true }),
  'server:snapshot:delete': def('snapshots', { dangerous: true }),

  // Networking
  'server:network:read': def('networking'),
  'server:network:update': def('networking'),
  'server:firewall:read': def('networking'),
  'server:firewall:write': def('networking'),

  // Domains & DNS (module "dns")
  'domain:read': def('domains'),
  'domain:dns:write': def('domains'),
  'domain:authcode': def('domains', { dangerous: true }),
  'domain:manage': def('domains', { dangerous: true }),

  // Web hosting (module "webhosting"): 24fire web spaces and CloudPanel websites
  'webspace:read': def('webhosting'),
  'webspace:credentials': def('webhosting', { dangerous: true }),
  'webspace:write': def('webhosting', { dangerous: true }),
  'webspace:delete': def('webhosting', { dangerous: true }),

  // Cloud storage (module "storage", Nextcloud)
  'cloud:read': def('storage'),
  'cloud:write': def('storage', { dangerous: true }),
  'cloud:password': def('storage', { dangerous: true }),

  // E-mail (module "mail", Mailcow)
  'mail:read': def('mail'),
  'mail:write': def('mail', { dangerous: true }),
  'mail:password': def('mail', { dangerous: true }),

  // Telephony (module "phone", 3CX)
  'phone:read': def('phone'),
  'phone:write': def('phone', { dangerous: true }),
  'phone:credentials': def('phone', { dangerous: true }),

  // Streaming (module "media", Jellyfin)
  'media:read': def('media'),
  'media:write': def('media', { dangerous: true }),
  'media:password': def('media', { dangerous: true }),

  // Monitoring (module "monitoring", Uptime Kuma)
  'monitor:read': def('monitoring'),
  'monitor:write': def('monitoring'),
  'monitor:delete': def('monitoring', { dangerous: true }),

  // AI (Claude): use the AI features on the organization's data, and decline or allow them for it.
  // Switched per organization (organizations.ai_enabled, opt-in, plan O34), not a service module.
  'ai:use': def('ai'),
  'ai:settings': def('ai'),

  // Billing
  'billing:read': def('billing'),
  'billing:pay': def('billing'),
  'billing:write': def('billing'),

  // Reseller (only for reseller organizations, see DEFAULT_RESELLER_BOUNDARY)
  'reseller:customer:read': def('reseller'),
  'reseller:customer:write': def('reseller'),
  'reseller:customer:access': def('reseller'),
  'reseller:billing': def('reseller', { dangerous: true }),

  // Platform (weblion staff only)
  'platform:access': def('platform', { platform: true }),
  'platform:org:read': def('platform', { platform: true }),
  'platform:org:write': def('platform', { platform: true }),
  'platform:user:read': def('platform', { platform: true }),
  'platform:user:write': def('platform', { platform: true }),
  'platform:provider:read': def('platform', { platform: true }),
  'platform:provider:write': def('platform', { platform: true, dangerous: true }),
  'platform:server:assign': def('platform', { platform: true }),
  'platform:server:create': def('platform', { platform: true, dangerous: true }),
  'platform:infra:read': def('platform', { platform: true }),
  'platform:explorer': def('platform', { platform: true, dangerous: true }),
  'platform:audit:read': def('platform', { platform: true }),
  'platform:billing:read': def('platform', { platform: true }),
  'platform:billing:write': def('platform', { platform: true, dangerous: true }),
  'platform:settings': def('platform', { platform: true, dangerous: true }),
  'platform:domain:write': def('platform', { platform: true, dangerous: true }),
  'platform:domain:move': def('platform', { platform: true, dangerous: true }),
  'platform:mail:write': def('platform', { platform: true, dangerous: true }),
  'platform:website:write': def('platform', { platform: true, dangerous: true }),
  'platform:media:write': def('platform', { platform: true, dangerous: true }),
  'platform:ai:use': def('platform', { platform: true }),
  'platform:i18n:read': def('platform', { platform: true }),
  // Dangerous: an AI translation costs money, and every edit is live for everyone at once.
  'platform:i18n:write': def('platform', { platform: true, dangerous: true }),
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
  'storage',
  'mail',
  'phone',
  'media',
  'monitoring',
  'ai',
  'billing',
  'reseller',
  'platform',
];
