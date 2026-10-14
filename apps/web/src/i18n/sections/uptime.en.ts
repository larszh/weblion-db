import type { uptimeDe } from './uptime.de';

export const uptimeEn: Record<keyof typeof uptimeDe, string> = {
  'nav.uptime': 'Monitoring',
  'nav.admin.uptime': 'Monitoring',
  'perm.group.monitoring': 'Monitoring',

  // Admin
  'uptime.admin.synced': '{seen} monitors synced, {missing} no longer reported',

  // Provider form
  'providers.uptimekuma.help':
    'Uptime Kuma 2.x. In Uptime Kuma under Settings > API Keys, create a key without expiry just for weblion.one. Note: with the first API key, /metrics no longer accepts a user name and password.',
  'providers.uptimekuma.url': 'Address of the Uptime Kuma instance',
  'providers.uptimekuma.urlHint': 'https://… without a path, e.g. https://status.weblion.one.',
  'providers.uptimekuma.urlInvalid':
    'An http or https address without a path, e.g. https://status.weblion.one.',
  'providers.uptimekuma.httpWarning':
    'Without https the API key travels over the network unencrypted. Only use this on a private network.',
  'providers.uptimekuma.apiKey': 'API key',
  'providers.uptimekuma.apiKeyHint': 'Starts with uk, e.g. uk3_… Stored encrypted and never shown again.',
  'providers.uptimekuma.apiKeyInvalid':
    'An Uptime Kuma API key starts with uk, its number and an underscore, e.g. uk3_…',
  'providers.uptimekuma.management': 'Management',
  'providers.uptimekuma.managementHint':
    'For customers to create their own monitors, sign the instance in for management under Admin > Monitoring.',
  'providers.uptimekuma.managementOn': 'Signed in',
  'providers.uptimekuma.managementOff': 'Read only',
  'providers.uptimekuma.monitorsText':
    'This connection provides monitors. Assign them to customers in the admin area under Monitoring.',
  'providers.uptimekuma.toMonitors': 'Go to monitors',

  // Reseller resources, delete blockers and dashboard
  'admin.resources.title.monitor': 'Monitors',
  'admin.resources.empty.monitor': 'No monitors are assigned to this customer.',
  'admin.resources.assign.monitor': 'Assign monitor',
  'admin.resources.monitors': 'Monitors',
  'admin.blocker.monitors': 'Monitors: {n}',
  'admin.blocker.monitorAllowances': 'Monitoring allowance',

  // API explorer
  'explorer.uptimekumaPath':
    'HTTP paths relative to the address of the instance (/metrics, /api/status-page/<slug>, /api/status-page/heartbeat/<slug>, /api/badge/<id>/<kind>, /api/entry-page) or socket/<event> for management, e.g. socket/getMonitor?args=[1]. Monitor secrets are hidden in answers.',
  'explorer.uptimekumaBodyHint':
    'Socket events that write go with POST and the arguments as a list, e.g. { "args": [12] } for socket/pauseMonitor. The instance must be signed in for management.',
};
