import type { mediaDe } from './media.de';

export const mediaEn: Record<keyof typeof mediaDe, string> = {
  'nav.media': 'Streaming',
  'nav.admin.media': 'Streaming',
  'perm.group.media': 'Streaming',

  // Admin, dashboard
  'media.admin.synced':
    '{seen} streaming accounts synced, {missing} no longer found, {repaired} policies repaired',
  'media.dashboardSub': '{n} of {max} accounts',

  // Provider form
  'providers.jellyfin.help':
    'Jellyfin 10.10 or newer (10.11 recommended) with the first-start wizard finished. Create a key of its own for weblion.one in the Jellyfin dashboard under API Keys. The key has full administrator rights.',
  'providers.jellyfin.url': 'Address of the instance',
  'providers.jellyfin.urlHint':
    'The address your customers enter in the Jellyfin apps, with the path if Jellyfin runs under a base path, e.g. https://media.weblion.one.',
  'providers.jellyfin.urlInvalid':
    "An http or https address without query and credentials, a path only for Jellyfin's base path, e.g. https://media.weblion.one.",
  'providers.jellyfin.httpWarning':
    'Without https, the API key and passwords travel unencrypted. Use it in a private network only.',
  'providers.jellyfin.apiKey': 'API key',
  'providers.jellyfin.apiKeyHint':
    'Dashboard > API Keys > Add, app name e.g. weblion.one. 32 characters of 0-9 and a-f. Stored encrypted and never shown again.',
  'providers.jellyfin.apiKeyInvalid': 'A Jellyfin API key has exactly 32 characters of 0-9 and a-f.',
  'providers.jellyfin.accountsText':
    'Streaming accounts of this instance, customer allowances and the import of users created in Jellyfin directly.',
  'providers.jellyfin.toAccounts': 'To the streaming accounts',

  // Reseller overview, delete blockers
  'admin.resources.mediaAccounts': 'Streaming accounts',
  'admin.blocker.mediaAccounts': 'Streaming accounts: {n}',
  'admin.blocker.mediaAllowances': 'Streaming allowance',

  // API explorer
  'explorer.jellyfinPath':
    'Paths relative to the address of the instance, e.g. /Users or /Library/VirtualFolders. Keys, access tokens and passwords in answers are blanked. /Auth/Keys and the sign-in endpoints are refused.',
  'explorer.jellyfinBodyHint':
    'GET and DELETE send the parameters as query, POST as JSON. Always send a policy (POST /Users/<id>/Policy) in full: Jellyfin resets missing fields.',
};
