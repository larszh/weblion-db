import type { phoneDe } from './phone.de';

export const phoneEn: Record<keyof typeof phoneDe, string> = {
  'nav.phone': 'Telephony',
  'nav.admin.phone': 'Phone systems',
  'perm.group.phone': 'Telephony',

  // Admin
  'phone.admin.synced': '{seen} phone systems synced, {missing} no longer found',

  // Provider form
  'providers.threecx.help':
    '3CX V20 with an Enterprise license. In the 3CX admin console under Integrations > API, add an API client used only by weblion.one: choose a client ID, enable "XAPI Access Enabled", select the default group and the System Admin role. 3CX shows the API key only once.',
  'providers.threecx.url': 'Address of the phone system',
  'providers.threecx.urlHint':
    'https://… with the port if it is not 443, e.g. https://muster.3cx.ch. Your customers open the 3CX web client at this address too.',
  'providers.threecx.urlInvalid': 'An https address without a path, e.g. https://muster.3cx.ch:5001.',
  'providers.threecx.clientId': 'Client ID',
  'providers.threecx.clientIdHint':
    'The client ID of the API client, e.g. weblion. Do not use it in other programs: 3CX allows only one valid token per client.',
  'providers.threecx.clientIdInvalid':
    'Letters, digits, dot, dash and underscore only, at most 64 characters.',
  'providers.threecx.clientSecret': 'API key',
  'providers.threecx.clientSecretHint': 'Stored encrypted and never shown again.',
  'providers.threecx.phoneText':
    'This connection provides a phone system. Assign it to a customer in the admin area.',
  'providers.threecx.toPhone': 'Go to phone systems',

  // Reseller resources
  'admin.resources.title.phone_system': 'Phone systems',
  'admin.resources.empty.phone_system': 'No phone systems are assigned to this customer.',
  'admin.resources.assign.phone_system': 'Assign phone system',
  'admin.resources.phoneSystems': 'Phone systems',
  'admin.blocker.phoneSystems': 'Phone systems: {n}',

  // API explorer
  'explorer.threecxPath':
    'XAPI paths relative to /xapi/v1, e.g. /Users?$top=10. Passwords, PINs, license keys and provisioning links in answers are hidden.',
  'explorer.threecxBodyHint':
    'GET and DELETE send the parameters as query, POST and PATCH as JSON, e.g. { "FirstName": "Anna" }.',
};
