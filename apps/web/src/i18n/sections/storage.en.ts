import type { storageDe } from './storage.de';

export const storageEn: Record<keyof typeof storageDe, string> = {
  'nav.cloud': 'Cloud storage',

  // Customer page
  'storage.subtitle':
    "Nextcloud accounts for your team's files, calendars and contacts, with storage from your allowance.",
  'storage.open': 'Open Nextcloud',
  'storage.create': 'Create account',
  'storage.noAccess': "You don't have access to this organization's cloud storage.",
  'storage.none.title': 'No cloud storage booked yet',
  'storage.none.text':
    'Cloud storage (Nextcloud) is booked through weblion.one. As soon as a storage allowance is set up for your organization, you create accounts for your team here.',
  'storage.none.textReseller':
    'Cloud storage (Nextcloud) is booked through {reseller}. As soon as a storage allowance is set up for your organization, you create accounts for your team here.',
  'storage.noAllowanceAccounts':
    'This organization has no storage allowance any more. Existing accounts keep working, new ones cannot be created.',
  'storage.limit.accounts':
    'All accounts of your allowance are in use. Delete an account or extend your allowance to create more.',
  'storage.limit.storage':
    'Your storage allowance is fully handed out to accounts. Reduce an account or extend your allowance to create more.',
  'storage.allowance': 'Storage allowance',
  'storage.allowanceText':
    'Storage you distribute among your accounts. Used is what the accounts actually take up.',
  'storage.toCustomers': 'Of that, handed to your customers: {size} and {n} accounts',
  'storage.figure.booked': 'Booked',
  'storage.figure.allocated': 'Allocated',
  'storage.figure.used': 'Used',
  'storage.figure.accounts': 'Accounts',
  'storage.accounts.of': '{n} of {max}',
  'storage.accounts.ofUnlimited': '{n} (no limit)',
  'storage.meter.label': '{allocated} allocated, {used} used, of {quota}',
  'storage.meter.used': 'Used',
  'storage.meter.allocated': 'Allocated',
  'storage.meter.free': 'Free',
  'storage.instance': 'Instance',
  'storage.loginAt': 'Log in at',
  'storage.dashboardSub': '{allocated} of {quota} allocated',

  // Accounts
  'storage.accounts': 'Accounts',
  'storage.accountsText': 'Every account has its own quota and logs in with its login name.',
  'storage.lastSync': 'Usage last updated {when}',
  'storage.search': 'Search account, name or e-mail…',
  'storage.empty': 'No accounts yet',
  'storage.emptyText': 'Create an account for everyone who should use Nextcloud.',
  'storage.col.login': 'Login name',
  'storage.col.name': 'Name',
  'storage.col.email': 'E-mail',
  'storage.col.storage': 'Storage',
  'storage.col.status': 'Status',
  'storage.col.lastLogin': 'Last login',
  'storage.copyLogin': 'Copy login name',
  'storage.usage.of': '{used} of {quota}',
  'storage.usage.unlimited': '{used} used, no limit',
  'storage.usage.over': 'Quota exceeded, uploads blocked',
  'storage.status.active': 'Active',
  'storage.status.disabled': 'Disabled',
  'storage.status.missing': 'Not found in Nextcloud',
  'storage.lastLogin.never': 'Never',

  // Create
  'storage.createTitle': 'Create cloud account',
  'storage.createText': 'A Nextcloud account for one person of your team, with its own quota.',
  'storage.name': 'User name',
  'storage.name.placeholder': 'anna',
  'storage.name.preview': 'Login name:',
  'storage.name.hint': 'Lower-case letters, digits, dot, dash and underscore. Cannot be changed later.',
  'storage.name.invalid':
    'Only lower-case letters, digits, dot, dash and underscore, starting and ending with a letter or digit (at most 32 characters).',
  'storage.name.tooLong': 'The login name can have at most {max} characters.',
  'storage.name.taken': 'This account exists already.',
  'storage.displayName': 'Display name',
  'storage.displayName.placeholder': 'Anna Muster',
  'storage.email': 'E-mail address',
  'storage.email.required': 'Required for the invitation.',
  'storage.email.invalid': 'Not a valid e-mail address.',
  'storage.email.changeHint': 'Nextcloud sends notifications and invitations to the new address from now on.',
  'storage.quota': 'Quota',
  'storage.quota.freeHint': 'Still free in your allowance: {free}',
  'storage.quota.maxHint': 'At most {max} ({free} still free in your allowance)',
  'storage.quota.invalid': 'Enter a whole number of at least 1 GB.',
  'storage.quota.tooLarge': 'At most {max} fit into the allowance.',
  'storage.quota.current': 'Currently {quota}. Leave empty to keep it.',
  'storage.quota.currentUnlimited': 'Currently unlimited. Leave empty to keep it that way.',
  'storage.quota.used': 'Used: {used}',
  'storage.quota.belowUsageTitle': 'Smaller than the storage in use',
  'storage.quota.belowUsage':
    'The account uses {used} already. All files stay, but no new ones can be uploaded until files are deleted.',
  'storage.delivery': 'Access',
  'storage.delivery.password': 'Generate password now',
  'storage.delivery.passwordText':
    'The password is shown once. You pass it on yourself. With an e-mail address Nextcloud also sends a welcome mail.',
  'storage.delivery.invite': 'Invitation by e-mail',
  'storage.delivery.inviteText': 'Nextcloud sends a link the person uses to set their own password.',
  'storage.delivery.needsEmail': 'An invitation needs an e-mail address.',
  'storage.created': 'Account {username} created',
  'storage.createdInvite': 'Account created, invitation sent to {email}',
  'storage.createdTitle': 'Account created',

  // Edit, enable/disable, password, invitation, delete
  'storage.editTitle': 'Edit {username}',
  'storage.updated': '{username} saved',
  'storage.disable': 'Disable',
  'storage.enable': 'Enable',
  'storage.disableTitle': 'Disable {username}?',
  'storage.disableText':
    'The person can no longer log in and their devices stop syncing. Files and quota stay.',
  'storage.enableTitle': 'Enable {username}?',
  'storage.enableText': 'The person can log in again.',
  'storage.enabledToast': '{username} enabled',
  'storage.disabledToast': '{username} disabled',
  'storage.resetPassword': 'Set new password',
  'storage.passwordTitle': 'New password for {username}?',
  'storage.passwordText': 'The previous password stops working. The new password is shown once.',
  'storage.passwordNewTitle': 'New password',
  'storage.resendInvite': 'Resend invitation',
  'storage.invitedToast': 'Invitation sent to {email}',
  'storage.deleteTitle': 'Delete {username}?',
  'storage.deleteConfirm': 'Delete permanently',
  'storage.deleteWarningTitle': 'All files are deleted',
  'storage.deleteWarning':
    'The account is deleted in Nextcloud with all its files ({used}), calendars, contacts and shares. This cannot be undone.',
  'storage.deletedToast': '{username} deleted',

  // Allowances (admin and reseller)
  'storage.allowance.setUp': 'Set up',
  'storage.allowance.setUpTitle': 'Set up cloud storage for {name}',
  'storage.allowance.editTitle': 'Cloud storage of {name}',
  'storage.allowance.dialogText': 'Total storage and number of accounts the organization distributes itself.',
  'storage.allowance.instanceHint': "All of the organization's accounts live on this Nextcloud instance.",
  'storage.allowance.instanceLocked': 'The instance can only change while no accounts exist on it.',
  'storage.allowance.quota': 'Total storage',
  'storage.allowance.allocatedHint': 'Allocated already: {size}',
  'storage.allowance.belowAllocated': 'At least {size}, that much is allocated already.',
  'storage.allowance.maxAccounts': 'Maximum accounts',
  'storage.allowance.maxAccountsHint': 'Leave empty for any number of accounts.',
  'storage.allowance.maxInvalid': 'Enter a whole number of at least 1 or leave the field empty.',
  'storage.allowance.maxBelowAccounts': 'At least {n}, that many accounts exist already.',
  'storage.allowance.unlimited': 'unlimited',
  'storage.allowance.enableModuleHint':
    '{org} only sees cloud storage in the console while the module is active.',
  'storage.allowance.moduleOff': 'Without the module "{module}" the organization does not see the allowance.',
  'storage.allowance.resellerHint':
    'A reseller distributes this allowance among its own accounts and its customers.',
  'storage.allowance.saved': 'Storage allowance saved',
  'storage.allowance.remove': 'Remove allowance',
  'storage.allowance.removeTitle': 'Remove cloud storage of {name}?',
  'storage.allowance.removeText':
    'The organization can no longer create Nextcloud accounts. The module stays active until you switch it off.',
  'storage.allowance.removeBlocked':
    'Only possible without accounts. Delete the accounts or assign them to another organization.',
  'storage.allowance.removed': 'Storage allowance removed',

  // Admin
  'storage.admin.tab': 'Cloud accounts',
  'storage.admin.tabHint':
    'Set up storage allowances at the customer, customers create their accounts themselves. Users created in Nextcloud directly are taken over below.',
  'storage.admin.search': 'Search login name, name or e-mail…',
  'storage.admin.filterCustomer': 'Filter by customer',
  'storage.admin.allCustomers': 'All customers',
  'storage.admin.filterInstance': 'Filter by instance',
  'storage.admin.allInstances': 'All instances',
  'storage.admin.empty': 'No cloud accounts',
  'storage.admin.emptyText':
    'Accounts show up here once customers create them or you take over users of an instance.',
  'storage.admin.synced': '{seen} cloud accounts synced, {missing} missing',
  'storage.admin.cardText': 'Storage the organization can distribute among Nextcloud accounts.',
  'storage.admin.none': 'No cloud storage',
  'storage.admin.noneText': 'Set up an allowance so the organization can create Nextcloud accounts.',
  'storage.admin.showAccounts': 'Show accounts',
  'storage.admin.noInstance': 'No Nextcloud instance is connected as a provider yet.',
  'storage.admin.noModule': 'without cloud storage',
  'storage.admin.needsAllowance': 'The customer needs a storage allowance on the same instance.',
  'storage.admin.assignText':
    'The account lives on {instance}. The customer manages it in its console afterwards.',
  'storage.admin.assignQuotaHint':
    "The account's quota counts against the customer's allowance afterwards, even if it exceeds it.",
  'storage.admin.unassignText':
    '{org} no longer sees the account. The account and its files stay in Nextcloud.',

  // Admin: unmanaged users
  'storage.unmanaged.title': 'Unmanaged users',
  'storage.unmanaged.text':
    'Users created in Nextcloud directly. Taken over users keep their name and quota.',
  'storage.unmanaged.load': 'Fetch users',
  'storage.unmanaged.reload': 'Reload',
  'storage.unmanaged.hint':
    'Fetches the users of {instance} and lists those the console does not manage yet. Administrators of the instance are never listed.',
  'storage.unmanaged.empty': 'All users of {instance} are managed',
  'storage.unmanaged.import': 'Take over',
  'storage.unmanaged.importTitle': 'Take over {username}',
  'storage.unmanaged.importText':
    'The console manages the user afterwards. Name, quota and files stay as they are.',
  'storage.unmanaged.noCustomer': '– assign to no customer –',
  'storage.unmanaged.unlimitedHint':
    'The user has no quota (unlimited). At the customer it counts with the storage it uses until a quota is set.',
  'storage.unmanaged.imported': '{username} taken over',

  // Reseller
  'storage.reseller.cardText':
    'Storage from your allowance that the customer distributes among its own Nextcloud accounts.',
  'storage.reseller.none': 'No cloud storage handed out',
  'storage.reseller.noneText':
    'Give the customer a share of your allowance so it can create Nextcloud accounts.',
  'storage.reseller.pool': 'Your allowance: {free} of {quota} free',
  'storage.reseller.noPool':
    'Your organization has no cloud storage allowance yet. Contact weblion.one to book storage.',
  'storage.reseller.dialogText':
    'From your allowance on {instance}. The customer distributes the storage among its accounts itself.',
  'storage.reseller.quotaHint': 'At most {max} from your allowance',
  'storage.reseller.accountsLeft': 'At most {n} from your allowance',
  'storage.reseller.maxRequired': 'Your allowance has a maximum number of accounts. Enter at most {n}.',
  'storage.reseller.maxTooHigh': 'Only {n} accounts of your allowance are left.',
  'storage.reseller.enablesModule': 'This also activates the cloud storage module for the customer.',
  'storage.reseller.removeText':
    'The customer can no longer create Nextcloud accounts. The storage goes back to your allowance.',
  'storage.reseller.removeBlocked':
    'Only possible without accounts. The customer has to delete its accounts first.',

  // Provider form
  'providers.nextcloud.help':
    'Create a dedicated admin account for the console in Nextcloud (member of the "admin" group) and an app password for it under Personal settings > Security. For invitations the instance must be able to send e-mail (Administration settings > Basic settings > Email server).',
  'providers.nextcloud.url': 'Instance URL',
  'providers.nextcloud.urlHint': 'The address users log in at, e.g. https://cloud.weblion.one',
  'providers.nextcloud.username': 'Admin user',
  'providers.nextcloud.usernameHint':
    'Login name of the admin account for the console, not your personal one.',
  'providers.nextcloud.appPassword': 'App password',
  'providers.nextcloud.appPasswordHint':
    'Personal settings > Security > Devices & sessions > Create new app password.',
  'providers.nextcloud.groupPrefix': 'Group prefix',
  'providers.nextcloud.groupPrefixHint':
    'Optional. Every organization gets the group <prefix><slug> so colleagues can share with each other. Default: {prefix}',
  'providers.nextcloud.groupPrefixChange':
    'Default: {prefix}. A new prefix only applies to new accounts, existing ones stay in their groups.',
  'providers.nextcloud.groupPrefixInvalid':
    'Lower-case letters, digits, dot, dash and underscore, at most 31 characters.',
  'providers.nextcloud.accountsText':
    'Accounts of this instance, assignment to customers and taking over users created in Nextcloud directly.',
  'providers.nextcloud.toAccounts': 'Go to cloud accounts',

  // API explorer
  'explorer.nextcloudPath':
    'OCS paths, e.g. /ocs/v2.php/cloud/users?search=anna. Passwords in answers are blanked out, app passwords cannot be managed here.',
  'explorer.nextcloudBodyHint':
    'GET and DELETE send the parameters as query, POST and PUT as form, e.g. { "key": "quota", "value": "10 GB" }.',
};
