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

/** Label and description are the dictionary keys module.<m>.label and module.<m>.description (section core). */
export interface ModuleDef {
  /** Action patterns that only work while the module is active. */
  actions: string[];
}

export const MODULE_DEFS: Record<ModuleKey, ModuleDef> = {
  servers: { actions: ['server:*', 'project:*'] },
  dns: { actions: ['domain:*'] },
  webhosting: { actions: ['webspace:*'] },
  storage: { actions: ['cloud:*'] },
  mail: { actions: ['mail:*'] },
  phone: { actions: ['phone:*'] },
  media: { actions: ['media:*'] },
  monitoring: { actions: ['monitor:*'] },
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
