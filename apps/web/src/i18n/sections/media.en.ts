import type { mediaDe } from './media.de';

export const mediaEn: Record<keyof typeof mediaDe, string> = {
  'nav.media': 'Streaming',
  'nav.admin.media': 'Streaming',
  'perm.group.media': 'Streaming',

  // Customer page
  'media.subtitle':
    'Accounts on the Jellyfin media server for movies, series and music, within your allowance.',
  'media.open': 'Open Jellyfin',
  'media.create': 'Create account',
  'media.noAccess': 'You have no access to the streaming accounts of this organization.',
  'media.none.title': 'No streaming booked yet',
  'media.none.text':
    'Streaming (Jellyfin) is booked through weblion.one. Once an allowance is set up for your organization, you create accounts here.',
  'media.none.textReseller':
    'Streaming (Jellyfin) is booked through {reseller}. Once an allowance is set up for your organization, you create accounts here.',
  'media.noAllowanceAccounts':
    'This organization no longer has a streaming allowance. Existing accounts keep working, new ones cannot be created.',
  'media.limit.accounts':
    'Every account of your allowance is taken. Delete an account or extend your allowance to create more.',
  'media.allowance': 'Streaming allowance',
  'media.allowanceText':
    'What every account of your organization may do. The console applies it to all accounts.',
  'media.figure.accounts': 'Accounts',
  'media.figure.accountsOf': '{n} of {max}',
  'media.figure.streams': 'Streams (devices)',
  'media.figure.streamsValue': '{n} per account',
  'media.figure.downloads': 'Downloads',
  'media.figure.downloadsOn': 'Allowed',
  'media.figure.downloadsOff': 'Not allowed',
  'media.figure.bitrate': 'Quality on the go',
  'media.figure.bitrateUpTo': 'up to {rate}',
  'media.figure.libraries': 'Libraries',
  'media.instance': 'Instance',
  'media.library.missing': 'This library no longer exists on the instance.',
  'media.library.missingShort': 'Removed',

  // Login card
  'media.login.title': 'How to sign in',
  'media.login.text': 'Every account signs in to the Jellyfin apps with these details.',
  'media.login.address': 'Server address',
  'media.login.copyAddress': 'Copy server address',
  'media.login.serverName': 'The apps show the server as "{name}".',
  'media.login.step1': 'Install the Jellyfin app on your device or open the server address in the browser.',
  'media.login.step2': 'Enter the server address in the app.',
  'media.login.step3': 'Sign in with login name and password.',
  'media.login.codeHint': 'The login names of your organization end with',
  'media.login.tv': 'On the TV',
  'media.login.quickConnect':
    'Choose Quick Connect in the app. Enter the code from the TV here in the console at the account under "Connect a TV". Or in Jellyfin under Settings > Quick Connect on a device that is already signed in.',
  'media.login.apps':
    'Apps exist for browsers, Windows, macOS, Linux (Jellyfin Media Player), Android, Android TV, Fire TV, iPhone and iPad, Apple TV (Swiftfin), LG webOS, Roku and Kodi.',
  'media.login.allApps': 'All apps',
  'media.login.privacy':
    'Other accounts on the same server can see login names. Use first names or rooms, not full names.',

  // Accounts
  'media.accounts': 'Accounts',
  'media.accountsText': 'Every account signs in with its login name and gets the access of your allowance.',
  'media.lastSync': 'Last synced {when}',
  'media.search': 'Search login name…',
  'media.empty': 'No accounts yet',
  'media.emptyText': 'Create an account for every person or device that should use Jellyfin.',
  'media.col.login': 'Login name',
  'media.col.status': 'Status',
  'media.col.lastActive': 'Last active',
  'media.col.created': 'Created',
  'media.col.issues': 'Issues',
  'media.copyLogin': 'Copy login name',
  'media.activity.never': 'Never',
  'media.activity.today': 'Today',
  'media.activity.yesterday': 'Yesterday',
  'media.status.active': 'Active',
  'media.status.disabled': 'Disabled',
  'media.status.locked': 'Locked',
  'media.status.lockedHint':
    'Jellyfin locked the account after too many failed sign-ins. Enabling lifts the lock.',
  'media.status.noPassword': 'No password',
  'media.status.noPasswordHint':
    'Anyone who knows the login name signs in without a password. Set a password.',
  'media.status.missing': 'Not found in Jellyfin',
  'media.status.missingHint': 'The account was deleted in Jellyfin. Remove it here as well.',
  'media.privacyNote':
    'The console does not see what is watched. It only shows on which day an account was last active.',

  // Create
  'media.createTitle': 'Create streaming account',
  'media.createText': 'An account for a person or a device, with the access of your allowance.',
  'media.name': 'Name',
  'media.name.placeholder': 'anna',
  'media.name.preview': 'Login name:',
  'media.name.hint':
    'Use first names or rooms like anna or livingroom. Other accounts on the same server can see login names.',
  'media.name.invalid':
    'Lower-case letters, digits and single dashes only, starting and ending with a letter or digit (20 characters at most).',
  'media.name.taken': 'This account exists already.',
  'media.created': 'Account {username} created',
  'media.createdTitle': 'Account created',

  // Passwords
  'media.password.label': 'Password',
  'media.password.generate': 'Generate a password (recommended)',
  'media.password.generateText': '{n} lower-case letters and digits, easy to enter on a remote. Shown once.',
  'media.password.choose': 'Own password',
  'media.password.chooseText': 'At least {min} characters. The console neither stores nor shows it.',
  'media.password.input': 'New password',
  'media.password.show': 'Show password',
  'media.password.hide': 'Hide password',
  'media.password.issue.length': 'At least {min} characters.',
  'media.password.issue.tooLong': 'At most {max} characters.',
  'media.password.issue.characters': 'No control characters and no spaces at either end.',
  'media.password.copy': 'Copy password (without spaces)',
  'media.password.groups': 'In groups of four for reading it out. The spaces are not part of the password.',
  'media.password.once':
    'The password is shown only now. The console does not store it. Hand it to the person who uses the account.',
  'media.password.newTitle': 'New password',
  'media.password.action': 'Set new password',
  'media.password.title': 'New password for {username}',
  'media.password.text':
    'Every device signed in with this account is signed out at once. The old password stops working. TVs are easiest to connect again with "Connect a TV".',
  'media.password.set': 'Set password',
  'media.password.setToast': 'New password set for {username}',
  'media.password.setToastSignedOut': 'New password set for {username}, every device signed out',
  'media.password.devicesDone': 'Every device was signed out.',
  'media.password.devicesLeft': 'Devices still signed in: {n}',

  // Connect a TV (Quick Connect)
  'media.connect.action': 'Connect a TV',
  'media.connect.title': 'Connect a TV to {username}',
  'media.connect.text':
    'A TV or another device signs in with this account without anyone typing the password.',
  'media.connect.step1':
    'Open the Jellyfin app on the TV, enter the server address and choose Quick Connect.',
  'media.connect.step2': 'The app shows a code with 6 digits. Enter it here.',
  'media.connect.code': 'Code from the TV',
  'media.connect.codeHint': 'The code is valid for 10 minutes. The console does not store it.',
  'media.connect.codeInvalid': 'The code has 6 digits.',
  'media.connect.submit': 'Connect',
  'media.connect.done': 'TV connected to {username}',
  'media.connect.error.code':
    'The server does not know this code, or it has expired. Start Quick Connect on the TV again and enter the new code.',
  'media.connect.error.off':
    'Quick Connect is off on this server. Sign in on the TV with the login name and password.',
  'media.connect.error.limit':
    'This account is already signed in on as many devices as the allowance permits ({n}). Sign out devices first.',
  'media.connect.error.disabled': 'The account is disabled. Enable it before you connect a TV.',
  'media.connect.error.failed':
    'The server did not accept the code. If the TV shows that it is signed in, it is connected. Otherwise start Quick Connect again.',
  'media.connect.error.tooMany': 'Too many attempts. Wait a minute.',

  // Sign out all devices
  'media.devices.action': 'Sign out all devices',
  'media.devices.title': 'Sign out all devices of {username}?',
  'media.devices.count': 'Signed-in devices: {n}',
  'media.devices.none': 'No device is signed in with this account.',
  'media.devices.text':
    'Playback is stopped and every device is signed out at once. Password, history and favorites stay. Devices sign in again with the password or with Quick Connect.',
  'media.devices.privacy': 'The console shows the number only, no device names.',
  'media.devices.confirm': 'Sign out all',
  'media.devices.done': 'Devices signed out: {n}',
  'media.devices.skipped':
    'Not signed out: {n}. Another account is signed in on these devices too. A new password signs them out as well.',
  'media.devices.failed': 'Signing out failed for {n} devices. Try again.',

  // Enable, disable, delete
  'media.disable': 'Disable',
  'media.enable': 'Enable',
  'media.disableTitle': 'Disable {username}?',
  'media.disableText':
    'Playback is stopped, every device is signed out at once and the account can no longer sign in. History and favorites stay.',
  'media.enableTitle': 'Enable {username}?',
  'media.enableText': 'The account can sign in again. A lock after failed sign-ins is lifted as well.',
  'media.enableLockedHint': 'Lifts the lock',
  'media.enabledToast': '{username} enabled',
  'media.disabledToast': '{username} disabled',
  'media.deleteTitle': 'Delete {username}?',
  'media.deleteConfirm': 'Delete permanently',
  'media.deleteWarningTitle': 'History and favorites are deleted',
  'media.deleteWarning':
    'The account is deleted in Jellyfin, with watch history, favorites and playlists. Playback is stopped and every device is signed out. This cannot be undone.',
  'media.deleteMissing': 'The account no longer exists in Jellyfin. It is only removed from the console.',
  'media.deletedToast': '{username} deleted',

  // Issues (admin)
  'media.issue.policy': 'Policy differs',
  'media.issue.policy.text':
    'The rights in Jellyfin differ from the allowance. The sync repairs them, or you apply the policy now.',
  'media.issue.administrator': 'Administrator',
  'media.issue.administrator.text':
    'The account is an administrator in Jellyfin. The sync demotes it unless it is the last administrator.',
  'media.issue.blocked_folders': 'Blocked libraries',
  'media.issue.blocked_folders.text':
    "The user has legacy blocked libraries. Jellyfin then ignores the allowance's libraries, and the console cannot change that.",
  'media.issue.no_password': 'No password',
  'media.issue.no_password.text': 'Anyone who knows the login name signs in without a password.',
  'media.issue.locked_out': 'Locked',
  'media.issue.locked_out.text': 'Locked by Jellyfin after failed sign-ins. Enabling lifts the lock.',
  'media.issue.no_allowance': 'No allowance',
  'media.issue.no_allowance.text':
    "The organization has no allowance on this instance. The account's rights are not managed.",
  'media.issue.seerr_missing': 'Not in requests',
  'media.issue.seerr_missing.text': 'The account is not set up in Seerr yet. The sync tries again.',
  'media.issue.seerr_drift': 'Requests differ',
  'media.issue.seerr_drift.text':
    'Rights or limits in Seerr differ from the allowance. The sync corrects them.',

  // Allowances (admin and reseller)
  'media.allowance.setUp': 'Set up',
  'media.allowance.setUpTitle': 'Set up streaming for {name}',
  'media.allowance.editTitle': 'Streaming of {name}',
  'media.allowance.dialogText':
    'Number of accounts and what every account may do. The console applies the access to every account of the organization.',
  'media.allowance.instanceHint': 'Every account of the organization lives on this Jellyfin instance.',
  'media.allowance.instanceLocked':
    'The instance can only change while the organization has no accounts and no customer allowances on it.',
  'media.allowance.code': 'Account code',
  'media.allowance.codeGenerated': 'generated',
  'media.allowance.codeHint':
    'Lower-case letters, 3 to 12, login names then end with -code. On a shared server other accounts see the login names: do not use a customer name there.',
  'media.allowance.codeLocked': 'The code can only change while the organization has no accounts.',
  'media.allowance.codeInvalid': '3 to 12 lower-case letters from a to z.',
  'media.allowance.maxAccounts': 'Accounts at most',
  'media.allowance.maxAccountsHint': 'How many accounts the organization can create.',
  'media.allowance.accountsUsed': 'Taken already: {n}',
  'media.allowance.maxInvalid': 'Enter a whole number from 1.',
  'media.allowance.maxBelowAccounts': 'At least {n}, as many accounts are taken already.',
  'media.allowance.maxTooHigh': 'At most {n}.',
  'media.allowance.streams': 'Simultaneous streams (devices)',
  'media.allowance.streamsHint':
    'Signed-in, active devices count. Jellyfin checks the number when a device signs in.',
  'media.allowance.streamsInvalid': 'A whole number from 1 to {max}.',
  'media.allowance.libraries': 'Libraries',
  'media.allowance.librariesEmpty':
    'The instance has no libraries that can be granted. New libraries appear after their first scan.',
  'media.allowance.librariesNone': 'Choose at least one library.',
  'media.allowance.librariesGone': 'No longer on the instance, removed on saving: {names}',
  'media.allowance.outsideParent': 'Not with the reseller',
  'media.allowance.downloads': 'Allow downloads',
  'media.allowance.downloadsHint':
    'Offline copies in the apps. This is no copy protection: streamed content can still be saved.',
  'media.allowance.bitrate': 'Quality on the go',
  'media.allowance.bitrateHint':
    "Highest bitrate for devices outside the server's network. Without a value of its own, the server's setting applies.",
  'media.allowance.bitrateCustom': 'Own value',
  'media.allowance.bitrateInvalid': 'A whole number from 1 to {max} Mbit/s.',
  'media.allowance.serverBitrate': "Server's setting",
  'media.allowance.toCustomers': 'Of these handed to customers: {n}',
  'media.allowance.enableModuleHint': '{org} only sees streaming in the console with the module on.',
  'media.allowance.moduleOff': 'Without the module "{module}" the organization does not see the allowance.',
  'media.allowance.resellerHint':
    'A reseller shares this allowance between its own accounts and its customers. Its customers get this access at most.',
  'media.allowance.parentNone': '{reseller} has no streaming allowance itself. You can set one up anyway.',
  'media.allowance.beyondParent': 'Goes beyond the allowance of {reseller} ({list}). You can save anyway.',
  'media.allowance.policyHint':
    'After saving, the console applies the access to every account of the organization.',
  'media.allowance.saved': 'Streaming allowance saved',
  'media.allowance.applied': 'Access applied to every account ({n})',
  'media.allowance.policyFailed': 'The policy could not be applied to these accounts. The sync tries again.',
  'media.allowance.remove': 'Remove allowance',
  'media.allowance.removeTitle': 'Remove the streaming of {name}?',
  'media.allowance.removeText':
    'The organization can no longer create streaming accounts. The module stays on until you switch it off.',
  'media.allowance.removeBlocked':
    'Only possible without accounts. Delete the accounts or assign them to another organization.',
  'media.allowance.removeBlockedCustomers':
    'Only possible without customer allowances. Remove the allowances of the {n} customers first.',
  'media.allowance.removed': 'Streaming allowance removed',
  'media.conflict.libraries': 'libraries',
  'media.conflict.streams': 'streams',
  'media.conflict.downloads': 'downloads',
  'media.conflict.bitrate': 'quality on the go',
  'media.conflict.accounts': 'accounts',

  // Admin page
  'media.admin.subtitle':
    'Jellyfin instances, every streaming account and the import of users created in Jellyfin directly.',
  'media.admin.addProvider': 'Connect instance',
  'media.admin.hint':
    'Streaming allowances are set up on the customer, the customers create the accounts themselves.',
  'media.admin.instances': 'Instances',
  'media.admin.instancesText':
    'Shared: several organizations have an allowance on it, dedicated: exactly one. Activity as numbers only.',
  'media.admin.noInstances': 'No Jellyfin instance connected',
  'media.admin.noInstancesText': 'Connect an instance under Providers to offer streaming accounts.',
  'media.admin.col.usage': 'Usage',
  'media.admin.col.accounts': 'Accounts',
  'media.admin.col.active': 'Active now',
  'media.admin.col.quickConnect': 'Quick Connect',
  'media.admin.usage.dedicated': 'Dedicated',
  'media.admin.usage.shared': 'Shared',
  'media.admin.usage.unused': 'Unused',
  'media.admin.orgCount': 'Organizations with an allowance: {n}',
  'media.admin.withIssues': '{n} with issues',
  'media.admin.users': 'Users: {n}, libraries: {libraries}',
  'media.admin.activeNow': '{sessions} active, {playing} playing',
  'media.admin.quickConnect.on': 'On',
  'media.admin.quickConnect.off': 'Off',
  'media.admin.quickConnect.unknown': 'Unknown',
  'media.admin.sync': 'Sync',
  'media.admin.syncRepairFailed': 'Policies not applied: {n}',
  'media.admin.toProvider': 'To the provider connection',
  'media.admin.accounts': 'Accounts',
  'media.admin.accountsText':
    'Every streaming account the console manages, with the issues of the last sync.',
  'media.admin.search': 'Search login name…',
  'media.admin.filterCustomer': 'Filter by customer',
  'media.admin.allCustomers': 'All customers',
  'media.admin.filterInstance': 'Filter by instance',
  'media.admin.allInstances': 'All instances',
  'media.admin.onlyIssues': 'Only with issues',
  'media.admin.empty': 'No streaming accounts',
  'media.admin.emptyText':
    'Accounts show up here once customers create them or you import users of an instance.',
  'media.admin.limited': 'At most 1000 accounts are shown. Narrow the list with the search or the filters.',
  'media.admin.assign': 'Assign…',
  'media.admin.reassign': 'Reassign…',
  'media.admin.repair': 'Apply policy',
  'media.admin.repairHint': "Writes the allowance's access to Jellyfin now",
  'media.admin.repairHintSeerr':
    "Writes the allowance's access to Jellyfin and the request rights to Seerr now",
  'media.admin.repaired': 'Policy of {username} applied',
  'media.admin.assignText': 'The account lives on {instance}. The customer then manages it in its console.',
  'media.admin.assignHint':
    "The customer needs a streaming allowance on this instance. Its access is applied to the account. More accounts than the allowance's are allowed for you.",
  'media.admin.unassignText':
    '{org} no longer sees the account. The account keeps working in Jellyfin until you disable or delete it.',
  'media.admin.targetNone':
    'This organization has no streaming allowance. Set one up on this instance first.',
  'media.admin.targetOtherInstance':
    'The streaming allowance of this organization is on {instance}, not on this instance.',
  'media.admin.targetAllowance': 'Allowance: {n} of {max} accounts taken, code {code}.',
  'media.admin.targetFull':
    'The allowance is used up. You can assign the account anyway, it then counts beyond the maximum.',
  'media.admin.noModule': 'without streaming',
  'media.admin.cardText': 'Jellyfin accounts of the organization and what every account may do.',
  'media.admin.none': 'No streaming',
  'media.admin.noneText': 'Set up an allowance so the organization can create streaming accounts.',
  'media.admin.showAccounts': 'Show accounts',
  'media.admin.noInstance': 'No Jellyfin instance is connected as a provider yet.',

  // Admin: unmanaged users
  'media.unmanaged.title': 'Unmanaged users',
  'media.unmanaged.text': 'Users created in Jellyfin directly. Imported users keep their name and history.',
  'media.unmanaged.load': 'Fetch users',
  'media.unmanaged.reload': 'Reload',
  'media.unmanaged.hint':
    'Fetches the users of {instance} and shows the ones the console does not manage yet. Administrators and users with legacy blocked libraries cannot be imported.',
  'media.unmanaged.empty': 'Every user of {instance} is managed',
  'media.unmanaged.col.password': 'Password',
  'media.unmanaged.yes': 'Yes',
  'media.unmanaged.no': 'No',
  'media.unmanaged.administrator': 'Administrator',
  'media.unmanaged.blocked.administrator': 'Administrator, cannot be imported',
  'media.unmanaged.blocked.blocked_folders': 'Legacy blocked libraries, cannot be imported',
  'media.unmanaged.import': 'Import',
  'media.unmanaged.importTitle': 'Import {username}',
  'media.unmanaged.importText': 'The console manages the user afterwards. Name and history stay.',
  'media.unmanaged.noCustomer': '– assign to no customer –',
  'media.unmanaged.noCustomerHint':
    "Without a customer the user's rights stay as they are in Jellyfin. You can assign it later.",
  'media.unmanaged.policyHint':
    "The allowance's access is applied to the user. More accounts than the allowance's are allowed for you.",
  'media.unmanaged.setPassword': 'Set a new password',
  'media.unmanaged.setPasswordHint':
    'Generates a new password, shown once. Every device of the user is signed out.',
  'media.unmanaged.setPasswordForced':
    'The user has no password: anyone who knows the name signs in. It is only imported with a new password.',
  'media.unmanaged.imported': '{username} imported',
  'media.unmanaged.passwordTitle': 'User imported',

  // Reseller
  'media.reseller.cardText': 'Accounts out of your allowance and what every account of the customer may do.',
  'media.reseller.none': 'No streaming handed out',
  'media.reseller.noneText':
    'Hand the customer a share of your allowance so it can create streaming accounts.',
  'media.reseller.pool': 'Your allowance: {free} of {max} accounts free',
  'media.reseller.noPool':
    'Your organization has no streaming allowance yet. Contact weblion.one to book streaming.',
  'media.reseller.dialogText': 'Out of your allowance on {instance}, with your own access at most.',
  'media.reseller.accountsLeft': 'At most {n} out of your allowance',
  'media.reseller.maxTooHigh': 'Free accounts in your allowance: {n}.',
  'media.reseller.noDownloads': 'Your allowance allows no downloads.',
  'media.reseller.downloadsOff': 'Your allowance allows no downloads, so neither for customers.',
  'media.reseller.bitrateHint': 'At most {max}, the limit of your allowance.',
  'media.reseller.bitrateTooHigh': 'At most {max} Mbit/s, the limit of your allowance.',
  'media.reseller.bitrateRequired': 'Your allowance has a limit of {max} Mbit/s. Choose a value up to that.',
  'media.reseller.enablesModule': 'This also activates the module Streaming for the customer.',
  'media.reseller.removeText':
    'The customer can no longer create streaming accounts. The accounts go back to your allowance.',
  'media.reseller.removeBlocked':
    'Only possible without accounts. The customer has to delete its accounts first.',

  // Requests (Seerr add-on): customer card, allowance fields, admin instances
  'media.requests.title': 'Requests',
  'media.requests.text':
    'With requests your accounts ask for movies and series the server does not have yet. weblion.one reviews every request and adds approved titles.',
  'media.requests.open': 'Open requests',
  'media.requests.address': 'Requests address',
  'media.requests.copyAddress': 'Copy address',
  'media.requests.signIn': 'Sign in there with the login name and password of the account.',
  'media.requests.included': 'Included',
  'media.requests.movies': 'Movies',
  'media.requests.tv': 'Series',
  'media.requests.movieQuota': 'up to {limit} movies in {days} days per account',
  'media.requests.tvQuota': 'up to {limit} seasons in {days} days per account',
  'media.requests.unlimited': 'no limit',
  'media.requests.notIncluded': 'not included',
  'media.requests.devicesHint': 'Signing in to requests counts as one signed-in device in Jellyfin.',
  'media.requests.sessionHint':
    'A sign-in to requests stays valid for up to 30 days, also after a new password or signing out every device: until then, requests can still be made there. Disabling takes the right to request, only deleting ends the sign-in.',
  'media.requests.col.pending': 'Open',
  'media.requests.col.approved': 'Approved',
  'media.requests.col.available': 'Available',
  'media.requests.col.quota': 'Quota used',
  'media.requests.quotaMovies': 'Movies: {used} of {limit}',
  'media.requests.quotaSeasons': 'Seasons: {used} of {limit}',
  'media.requests.notReady': 'Being set up',
  'media.requests.notReadyHint': 'The account is being set up in requests. This takes a few minutes at most.',
  'media.requests.disabled': 'Disabled accounts cannot request.',
  'media.requests.syncedAt': 'As of {when}',
  'media.requests.privacy':
    "The console shows numbers only, never the requested titles. In requests itself, every account on this server sees the others' login names and who asked for a title.",
  'media.requests.figure': 'Requests',
  'media.requests.figureBoth': 'Movies and series',
  'media.requests.totals': 'Open {pending}, approved {approved}, available {available}',
  'media.requests.field': 'Requests (Seerr)',
  'media.requests.fieldHint':
    'The accounts may request movies or series. weblion.one approves them in Seerr.',
  'media.requests.fieldMovies': 'Request movies',
  'media.requests.fieldTv': 'Request series',
  'media.requests.limitNone': 'No limit',
  'media.requests.quotaLimit': 'Number',
  'media.requests.quotaDays': 'in days',
  'media.requests.seasonsHint':
    'For series Seerr counts seasons, not series. "No requests" means switching requests off.',
  'media.requests.typeRequired': 'Choose movies, series or both.',
  'media.requests.quotaInvalid': 'A whole number from 1 to {max}.',
  'media.requests.daysInvalid': 'A whole number from 1 to {max} days.',
  'media.requests.sharedWarning':
    "Several organizations have an allowance on this instance. In requests every account sees the others' login names and who asked for a title.",
  'media.requests.inactive':
    'Seerr is off on this instance. Customers see requests only once you switch it on.',
  'media.requests.streamsWarning':
    'With 1 stream an account cannot sign in to requests while another device is signed in.',
  'media.requests.unavailable': 'No Seerr is set up for this instance.',
  'media.requests.offOnSave': 'Requests are switched off on saving.',
  'media.requests.applyFailed':
    'The request rights of these accounts could not be set. The sync tries again.',
  'media.reseller.requestsCap': 'At most what your allowance permits.',
  'media.reseller.requestsYours': 'Your allowance: {value}',
  'media.conflict.requestsMovies': 'Request movies',
  'media.conflict.requestsTv': 'Request series',
  'media.conflict.movieQuota': 'Movie limit',
  'media.conflict.tvQuota': 'Season limit',
  'media.seerr.column': 'Requests',
  'media.seerr.none': 'No Seerr',
  'media.seerr.status.off': 'Off',
  'media.seerr.status.ok': 'On',
  'media.seerr.status.unsafe': 'Unsafe',
  'media.seerr.status.error': 'Error',
  'media.seerr.status.unknown': 'Not checked',
  'media.seerr.shared':
    "Shared: {n} organizations with requests see each other's login names and wishes in Seerr.",
  'media.seerr.manage': 'Requests…',
  'media.seerr.title': 'Requests on {instance}',
  'media.seerr.text':
    'Seerr is the request site of this Jellyfin instance. The console sets up the accounts of customers with requests there and sets their rights and limits. You approve requests in Seerr.',
  'media.seerr.version': 'Version {version}',
  'media.seerr.checkedAt': 'Checked {when}',
  'media.seerr.recheck': 'Check again',
  'media.seerr.check.reachable': 'Reachable',
  'media.seerr.check.key': 'API key accepted',
  'media.seerr.check.sameServer': 'Connected to this Jellyfin instance',
  'media.seerr.check.newSignIns': 'New sign-ins through Jellyfin off',
  'media.seerr.check.defaultPermissions': 'New users without rights',
  'media.seerr.check.mediaServerLogin': 'Sign-in with Jellyfin on',
  'media.seerr.check.csrf': 'CSRF protection off',
  'media.seerr.problem.unreachable': 'Seerr cannot be reached.',
  'media.seerr.problem.key': 'Seerr rejected the API key.',
  'media.seerr.problem.not_jellyfin': 'Seerr is not set up for Jellyfin.',
  'media.seerr.problem.other_server': 'Seerr is connected to another Jellyfin server.',
  'media.seerr.problem.csrf':
    "Seerr's CSRF protection is on, so the console cannot change anything. Switch it off in Seerr under Settings > Network.",
  'media.seerr.problem.new_signins':
    'New sign-ins through Jellyfin are on: every user of the server could request.',
  'media.seerr.problem.default_permissions': 'New users get rights. Recommended: none.',
  'media.seerr.problem.media_server_login': 'Sign-in with Jellyfin is off: customers could not sign in.',
  'media.seerr.unmanaged':
    'Seerr users the console does not manage that may request: {n}. The sync takes this right away.',
  'media.seerr.orphans': 'Seerr users without a Jellyfin user: {n}. Delete them in Seerr.',
  'media.seerr.localLogin':
    'Local sign-in is on in Seerr. Users Seerr created at a Jellyfin sign-in before the recommended settings applied still sign in there with their password of that time, also after a new password. Switch it off in Seerr under Settings > Users if nobody needs it.',
  'media.seerr.apply': 'Apply the recommended settings',
  'media.seerr.applyText':
    'Sets in Seerr: new sign-ins through Jellyfin off, new users without rights, sign-in with Jellyfin on. Other settings stay.',
  'media.seerr.applied': 'Recommended settings set in Seerr',
  'media.seerr.enable': 'Offer requests to customers',
  'media.seerr.enableHint': 'Possible once every check passes.',
  'media.seerr.enabled': 'Requests switched on for {instance}',
  'media.seerr.disabled': 'Requests switched off for {instance}',
  'media.seerr.disableTitle': 'Switch requests off for {instance}?',
  'media.seerr.disableText':
    'Customers no longer see requests. The console takes the right to request away from every account in Seerr. Users and requests stay in Seerr.',
  'media.seerr.disableConfirm': 'Switch off',
  'media.seerr.sharedTitle': 'Several organizations on this instance',
  'media.seerr.sharedText':
    '{n} organizations have an allowance on {instance}. In Seerr every signed-in account sees the user list and, for every title, who asked for it. Customers with requests thus see login names and wishes of other customers.',
  'media.seerr.sharedConfirm': 'I have checked this and switch requests on anyway.',
  'media.seerr.enableConfirm': 'Switch on',
  'media.seerr.notConfigured':
    'No Seerr is set up for this instance. Enter its address and API key at the provider.',
  'media.seerr.toProvider': 'To the provider',
  'media.seerr.applyResult': 'Request rights set: {n}',

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
  'providers.jellyfin.seerr': 'Requests (Seerr, optional)',
  'providers.jellyfin.seerrHelp':
    'A Seerr instance connected to exactly this Jellyfin instance. Switch it on for customers under Admin > Streaming.',
  'providers.jellyfin.seerrUrl': 'Seerr address',
  'providers.jellyfin.seerrUrlHint':
    'The address where your customers open Seerr, e.g. https://requests.weblion.one.',
  'providers.jellyfin.seerrUrlInvalid': 'An http or https address without query and without credentials.',
  'providers.jellyfin.seerrApiKey': 'Seerr API key',
  'providers.jellyfin.seerrApiKeyHint':
    'Seerr > Settings > General > API key. The key has full rights in Seerr. Stored encrypted and never shown again.',
  'providers.jellyfin.seerrApiKeyInvalid': 'Paste the key as Seerr shows it.',
  'providers.jellyfin.seerrBoth': 'Address and key go together.',
  'providers.jellyfin.seerrRemove': 'Remove Seerr',

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
