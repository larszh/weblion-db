import type { websitesDe } from './websites.de';

export const websitesEn: Record<keyof typeof websitesDe, string> = {
  // Provider form
  'providers.cloudpanel.help':
    "Your own CloudPanel server (CE 2.5.0 or newer) for customer websites, not the console's server. The console logs in over SSH with an ed25519 key as the agent user and may only run the root wrapper weblion-clp there. Install it with deploy/cloudpanel-agent/install.sh from the repository; the script prints the host key fingerprint.",
  'providers.cloudpanel.host': 'SSH host',
  'providers.cloudpanel.hostHint': 'Host name or IP address the console reaches the server at over SSH.',
  'providers.cloudpanel.hostInvalid': 'A host name or an IP address.',
  'providers.cloudpanel.port': 'SSH port',
  'providers.cloudpanel.username': 'SSH user',
  'providers.cloudpanel.usernameHint': 'The agent user install.sh creates. Default: weblion-agent.',
  'providers.cloudpanel.privateKey': 'Private key (ed25519)',
  'providers.cloudpanel.privateKeyHint':
    'Unencrypted OpenSSH key (-----BEGIN OPENSSH PRIVATE KEY-----). It is stored encrypted and never shown again. Recommended: one key per server.',
  'providers.cloudpanel.generate': 'Generate key pair',
  'providers.cloudpanel.generated':
    'New key pair generated. It only applies once you save; install the public key on the server.',
  'providers.cloudpanel.publicKey': 'Public key',
  'providers.cloudpanel.publicKeyHint':
    'Pass this key to install.sh on the server (--public-key). It is not secret.',
  'providers.cloudpanel.hostKey': 'Host key fingerprint',
  'providers.cloudpanel.hostKeyHint':
    'SHA256:... as install.sh or "ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub" prints it on the server. A different host key stops the connection until you change it here.',
  'providers.cloudpanel.hostKeyInvalid': 'SHA256: followed by 43 characters, e.g. SHA256:Ab3...',
  'providers.cloudpanel.accessHost': 'Host for customers (SFTP/SSH, optional)',
  'providers.cloudpanel.accessHostHint':
    'The name customers see for SFTP and SSH, e.g. web1.weblion.cloud (with A/AAAA records). Default: the SSH host.',
  'providers.cloudpanel.accessHostInvalid': 'A host name like web1.weblion.cloud.',
  'providers.cloudpanel.ipv4': 'Public IPv4 addresses (optional)',
  'providers.cloudpanel.ipv6': 'Public IPv6 addresses (optional)',
  'providers.cloudpanel.ipsHint':
    'Comma separated, for the DNS check before SSL certificates. Default: what the server reports.',
  'providers.cloudpanel.phpVersions': 'PHP versions for customers (optional)',
  'providers.cloudpanel.phpVersionsHint':
    'Comma separated, e.g. 8.3, 8.4 (default). Only versions installed on the server are offered.',
  'providers.cloudpanel.templates': 'Applications for customers (optional)',
  'providers.cloudpanel.templatesHint':
    'Vhost templates as named in CloudPanel, comma separated; a trailing * matches every name starting with it (Laravel*). Default: Generic, WordPress, WooCommerce.',
  'providers.cloudpanel.nodejs': 'Node.js websites for customers',
  'providers.cloudpanel.nodejsHint':
    'Only when the agent was installed with --nodejs. Customers also need Node.js in their allowance.',
  'providers.cloudpanel.websites': 'Websites',
  'providers.cloudpanel.websitesText':
    'Websites of this server, their databases and who they are assigned to.',
  'providers.cloudpanel.toWebsites': 'To the websites',
  'providers.cloudpanel.consoleKey': "The console's SSH key",
  'providers.cloudpanel.installCommand': 'Installation on the server (as root)',
  'providers.cloudpanel.installCommandHint':
    "Replace the placeholders: --from with the console's outgoing IP addresses, --protect-domain and --protect-user with every operator site on this server.",

  // Admin inventory
  'websites.admin.synced': '{seen} websites synced, {missing} missing on the server',
  'hosting.kind.website': 'Website',
  'hosting.kind.webspace': 'Web space',

  // Status of websites and their databases
  'websites.status.creating': 'Being created',
  'websites.status.deleting': 'Being deleted',
  'websites.status.error': 'Unknown state',
  'websites.status.active': 'Active',
  'websites.status.missing': 'Missing on the server',

  // Explorer
  'providers.cloudpanel.explorerHint':
    'The agent weblion-clp only answers reads here: GET /info (versions, templates), /list (managed sites) and /unmanaged (unmanaged sites).',

  // Types
  'websites.type.php': 'PHP',
  'websites.type.static': 'Static',
  'websites.type.nodejs': 'Node.js',
  'websites.type.python': 'Python',
  'websites.type.reverse-proxy': 'Reverse proxy',

  // Customer list
  'websites.list.subtitle':
    'Websites on our servers with SFTP/SSH, databases and SSL certificates, plus web spaces with Plesk.',
  'websites.list.create': 'Create website',
  'websites.list.full': 'Your allowance is used up. Contact us for more websites.',
  'websites.list.serverDown': 'Server not reachable',
  'websites.list.optionsError': 'Allowance not available',
  'websites.list.empty': 'No website yet',
  'websites.list.emptyText': 'Create the first one. You get SFTP/SSH access and, if you like, a database.',
  'websites.list.noAllowance': 'No website allowance',
  'websites.list.noAllowanceText': 'Your organization has no website allowance. Please contact weblion.',
  'websites.list.noAllowanceReseller':
    'Your organization has no website allowance. Please contact your provider {reseller}.',
  'websites.list.credentialsPending': 'Credentials missing: set a new password.',

  // Allowance
  'websites.allowance.title': 'Website allowance',
  'websites.allowance.sites': 'Websites',
  'websites.allowance.databases': 'Databases',
  'websites.allowance.of': '{n} of {max}',
  'websites.allowance.types': 'Allowed types',
  'websites.allowance.instance': 'Server',
  'websites.allowance.customersIncluded':
    'Includes the allowances of customers on this server ({n} customers).',
  'websites.allowance.adminText': 'Server for new websites, maximum websites and databases, allowed types.',
  'websites.allowance.setUp': 'Set up',
  'websites.allowance.setUpTitle': 'Set up a website allowance for {name}',
  'websites.allowance.editTitle': 'Website allowance of {name}',
  'websites.allowance.dialogText':
    'Customers create their websites themselves until the allowance is used up. There is no disk limit; usage is shown.',
  'websites.allowance.instanceHint': "The organization's new websites are created on this CloudPanel server.",
  'websites.allowance.instanceLocked':
    'The reseller has customers with a website allowance on this server. The server can only change without them.',
  'websites.allowance.instanceReseller':
    "Customers of {reseller} get their websites on the reseller's server.",
  'websites.allowance.instanceChange':
    'Existing websites stay on {instance}; only new websites are created on the chosen server.',
  'websites.allowance.noInstance': 'There is no CloudPanel server yet. Set up a provider first.',
  'websites.allowance.maxSites': 'Websites at most',
  'websites.allowance.maxDatabases': 'Databases at most',
  'websites.allowance.countInvalid': 'Enter a whole number from 0.',
  'websites.allowance.belowSites': 'At least {n}, that many websites exist or are handed out.',
  'websites.allowance.belowDatabases': 'At least {n}, that many databases exist or are handed out.',
  'websites.allowance.committed': 'In use already: {n}',
  'websites.allowance.poolLeft': "At most {n} from the reseller's allowance",
  'websites.allowance.poolSites': "Only {n} websites are left in the reseller's allowance.",
  'websites.allowance.poolDatabases': "Only {n} databases are left in the reseller's allowance.",
  'websites.allowance.resellerNone':
    "The reseller {reseller} has no website allowance. Set up the reseller's first; its customers' allowances come out of it.",
  'websites.allowance.notInPool': 'Not in the allowance of {reseller}',
  'websites.allowance.nodejsOff':
    'Node.js websites for customers are not enabled on this server (provider setting).',
  'websites.allowance.nodejsOn': 'Node.js enabled',
  'websites.allowance.nodejsOffShort': 'Node.js not enabled',
  'websites.allowance.typesRequired': 'Choose at least one type.',
  'websites.allowance.enableModuleHint': '{org} then sees the Web hosting page and can create websites.',
  'websites.allowance.moduleOff': 'Without the module "{module}" the organization does not see its websites.',
  'websites.allowance.resellerHint':
    "A reseller's allowance covers its own websites and the allowances it hands to its customers.",
  'websites.allowance.saved': 'Website allowance saved',
  'websites.allowance.remove': 'Remove allowance',
  'websites.allowance.removeTitle': 'Remove the website allowance of {name}?',
  'websites.allowance.removeText':
    'The organization can no longer create websites. The module stays activated.',
  'websites.allowance.removeBlocked':
    'Only without websites. The organization still has {n}; delete them or assign them elsewhere.',
  'websites.allowance.removeBlockedCustomers':
    'Only without customer allowances. {n} customers have a website allowance out of this one.',
  'websites.allowance.removed': 'Website allowance removed',
  'websites.allowance.none': 'No website allowance',
  'websites.allowance.noneText': 'Without an allowance the organization cannot create websites.',
  'websites.allowance.showWebsites': 'Websites of the server',

  // Create
  'websites.create.title': 'Create website',
  'websites.create.text':
    'A domain with its www counterpart, a user for SFTP/SSH and, if you like, a database.',
  'websites.create.domain': 'Domain',
  'websites.create.domainHint': 'With or without www, both are served.',
  'websites.create.domainAscii': 'Created as {ascii}. With or without www, both are served.',
  'websites.create.domainInvalid': 'Not a valid domain, e.g. shop.example.com.',
  'websites.create.type': 'Type',
  'websites.create.type.php': 'PHP application',
  'websites.create.type.phpText': 'WordPress, WooCommerce or your own PHP files',
  'websites.create.type.static': 'Static website',
  'websites.create.type.staticText': 'HTML, CSS and images only',
  'websites.create.type.nodejs': 'Node.js',
  'websites.create.type.nodejsText': 'Your own app, started over SSH',
  'websites.create.onlyType': 'Type: {type}',
  'websites.create.application': 'Application',
  'websites.create.applicationHint': 'Decides the web server configuration. The website starts empty.',
  'websites.create.wordpressHint':
    'You upload the WordPress files over SFTP. We create the database right away.',
  'websites.create.templateInvalid': 'The name of a template of the server, e.g. Generic.',
  'websites.create.phpVersion': 'PHP version',
  'websites.create.phpStaffHint': 'As in the provider settings; the server checks that it is installed.',
  'websites.create.phpInvalid': 'A version such as 8.4.',
  'websites.create.recommended': 'recommended',
  'websites.create.nodejsVersion': 'Node.js version',
  'websites.create.nodejsHint':
    'The port is assigned automatically, you start the app over SSH (e.g. PM2). Creating takes longer.',
  'websites.create.siteUser': 'User name (SFTP/SSH)',
  'websites.create.siteUserHint':
    'Linux user of the website (site user): 3 to 32 characters, lower-case letters, digits and "-".',
  'websites.create.siteUserInvalid':
    '3 to 32 characters: lower-case letters, digits and "-", starting with a letter, not ending with "-".',
  'websites.create.siteUserReserved': 'This name is reserved for the system. Choose another one.',
  'websites.create.database': 'Create a database',
  'websites.create.databaseHint': 'MySQL database with its own user; you see the password once afterwards.',
  'websites.create.databaseNoRoom': 'Your allowance has no room for more databases.',
  'websites.create.password': 'Password for SFTP/SSH',
  'websites.create.after':
    'Afterwards in use: {sites} of {maxSites} websites, {databases} of {maxDatabases} databases.',
  'websites.create.submit': 'Create website',
  'websites.create.pending':
    'Setting up the website. This usually takes less than a minute (Node.js longer).',
  'websites.create.done': 'Website {domain} created',
  'websites.create.unknownHint':
    'If the website then shows up in the list, set a new password there to get access.',

  // Passwords
  'websites.password.label': 'Password',
  'websites.password.generate': 'Generate',
  'websites.password.generateText': '24 random characters, safe and easy to type',
  'websites.password.choose': 'Own password',
  'websites.password.chooseText': 'If you need a particular password',
  'websites.password.own': 'Your password',
  'websites.password.rules': 'Password rules',
  'websites.password.rule.length': '12 to 128 characters',
  'websites.password.rule.characters':
    'Letters, digits and !#%*+,-./;<=>?@^_{|}~ (no spaces, quotes, $ : ( ) & \\ `)',
  'websites.password.submit': 'Set new password',

  // Credentials
  'websites.creds.title': 'Credentials (visible only now)',
  'websites.creds.text':
    'Save the credentials now, e.g. in a password manager. weblion stores no passwords and cannot show them again.',
  'websites.creds.newPassword': 'New password (visible only now)',
  'websites.creds.sftp': 'SFTP and SSH',
  'websites.creds.database': 'Database',
  'websites.creds.password': 'Password',
  'websites.creds.passwordChosen': 'The password you chose',
  'websites.creds.sftpLink': 'Open in a file manager:',
  'websites.creds.sshLine': 'In a terminal:',
  'websites.creds.onceText':
    'Once closed, the password is no longer visible. Set a new one if you forget it.',
  'websites.creds.saved': 'I have saved the credentials',

  // Detail
  'websites.detail.open': 'Open website',
  'websites.detail.refreshError': 'Refresh failed',
  'websites.detail.missingTitle': 'No longer found on the server',
  'websites.detail.missingText':
    'The server has not reported this website since {date} (deleted in CloudPanel or no longer managed). Changes are not possible. Contact weblion if this was not intended.',
  'websites.detail.creatingText': 'The server is setting up the website. This page refreshes by itself.',
  'websites.detail.deletingText': 'The server is deleting the website. This page refreshes by itself.',
  'websites.detail.errorTitle': 'Last change did not finish',
  'websites.detail.errorText':
    'The server did not answer. The next sync settles the state; after that the website can be used again.',
  'websites.detail.credentialsPendingTitle': 'Credentials not shown',
  'websites.detail.credentialsPending': 'The credentials were not shown. Set a new password.',
  'websites.detail.offBusy': 'Possible once the running change has finished.',
  'websites.detail.offError': 'Possible once the sync has settled the state.',
  'websites.detail.offMissing': 'Not possible: the server no longer reports this website.',
  'websites.detail.noFacts': 'No details from the server yet.',
  'websites.detail.synced': 'Last synced {when} · created on {created}',

  // Access
  'websites.access.title': 'Access (SFTP/SSH)',
  'websites.access.text': 'One user for files (SFTP) and terminal (SSH) on port 22.',
  'websites.access.host': 'Host',
  'websites.access.port': 'Port',
  'websites.access.username': 'User name',
  'websites.access.home': 'Home directory',
  'websites.access.webRoot': 'Web directory',
  'websites.access.newPassword': 'New password',
  'websites.access.newPasswordHint': 'Sets a new password for SFTP and SSH.',
  'websites.access.passwordTitle': 'New password for {user}',
  'websites.access.passwordText':
    'The previous password stops working. Running processes and open SSH sessions keep running.',
  'websites.access.passwordDone': 'New password set',
  'websites.access.helpUpload': "Upload the website's files to the web directory.",
  'websites.access.helpCron': 'Set up scheduled tasks over SSH:',
  'websites.access.helpLogs': 'Access and error logs are in',
  'websites.access.helpPassword': 'weblion stores no passwords. Set a new one if you forget it.',

  // Runtime
  'websites.runtime.title': 'Runtime',
  'websites.runtime.type': 'Type',
  'websites.runtime.php': 'PHP version',
  'websites.runtime.application': 'Application',
  'websites.runtime.nodejs': 'Node.js version',
  'websites.runtime.appPort': 'App port',
  'websites.runtime.phpHint': 'weblion changes the PHP version and settings on request.',
  'websites.runtime.staticHint': 'The web server serves the files in the web directory directly.',
  'websites.runtime.nodejsHint':
    'Start your app over SSH (e.g. with PM2) and let it listen on port {port}. The web server forwards the domain there.',

  // Certificate
  'websites.ssl.title': 'SSL certificate',
  'websites.ssl.state': 'Certificate',
  'websites.ssl.expires': 'Valid until',
  'websites.ssl.covers': 'Covers',
  'websites.ssl.letsEncrypt': "Let's Encrypt until {date}",
  'websites.ssl.letsEncryptOnly': "Let's Encrypt",
  'websites.ssl.until': 'Valid until {date}',
  'websites.ssl.unknownExpiry': 'Expiry unknown',
  'websites.ssl.expired': 'Expired on {date}',
  'websites.ssl.none': 'No certificate',
  'websites.ssl.noneHint': "Issue a Let's Encrypt certificate once the domain points to the server.",
  'websites.ssl.invalid': 'No valid certificate',
  'websites.ssl.invalidHint':
    "New websites have a self-signed certificate browsers do not trust. Issue a Let's Encrypt certificate.",
  'websites.ssl.daysLeft': 'Valid for {days} more days',
  'websites.ssl.issue': "Issue Let's Encrypt certificate",
  'websites.ssl.issueShort': 'Issue certificate',
  'websites.ssl.reissue': 'Issue again',
  'websites.ssl.issueHint': 'Checks the DNS of the domain and its www counterpart first.',
  'websites.ssl.renewal': 'CloudPanel renews the certificate automatically.',
  'websites.ssl.dialogTitle': 'SSL certificate for {domain}',
  'websites.ssl.dialogText':
    "Let's Encrypt checks that the domain and its www counterpart point to this server. We check that first.",
  'websites.ssl.ready': 'Both names point to the server. The certificate can be issued.',
  'websites.ssl.notReady': 'DNS does not point to the server yet',
  'websites.ssl.force': 'Try anyway',
  'websites.ssl.pending': "Let's Encrypt is checking the domain. This can take up to three minutes.",
  'websites.ssl.issued': 'Certificate for {domain} issued',

  // DNS
  'websites.dns.title': 'DNS',
  'websites.dns.text': 'A and AAAA records the domain and its www counterpart need.',
  'websites.dns.hint':
    'Check whether the domain points to the server. You set the records where your domain is managed.',
  'websites.dns.check': 'Check DNS',
  'websites.dns.recheck': 'Check again',
  'websites.dns.checkFailed': 'DNS check failed',
  'websites.dns.name': 'Name',
  'websites.dns.type': 'Type',
  'websites.dns.value': 'Value',
  'websites.dns.statusCol': 'Status',
  'websites.dns.present': 'present',
  'websites.dns.absent': 'missing',
  'websites.dns.answers': 'What public DNS answers',
  'websites.dns.needed': 'These records are still missing:',
  'websites.dns.status.ok': 'Points to the server',
  'websites.dns.status.elsewhere': 'Points elsewhere',
  'websites.dns.status.missing': 'No record',
  'websites.dns.status.error': 'Lookup failed',
  'websites.dns.blocker.missing':
    'At least one name has no A or AAAA record. Create the missing records and check again (changes often take a few minutes).',
  'websites.dns.blocker.elsewhere':
    'At least one name points to another address (old server or CDN). Behind a CDN such as Cloudflare issuing may work anyway.',
  'websites.dns.blocker.error': 'DNS could not be queried. Check again later.',
  'websites.dns.foreign': 'Foreign addresses that must be removed: {ips}',
  'websites.dns.readyText': 'Both names point to the server.',
  'websites.dns.notReadyText': 'Not all records point to the server yet.',
  'websites.dns.checkedAt': 'Checked {when}.',
  'websites.dns.toDomain': 'Edit the records of {domain} in the DNS module',

  // Databases
  'websites.db.title': 'Databases',
  'websites.db.text': 'MySQL databases of the website, each with its own user.',
  'websites.db.empty': 'No databases',
  'websites.db.name': 'Database',
  'websites.db.user': 'User',
  'websites.db.size': 'Size',
  'websites.db.statusCol': 'Status',
  'websites.db.create': 'Create database',
  'websites.db.createHint': 'New database with its own user; you see the password once.',
  'websites.db.createTitle': 'Create database',
  'websites.db.createText': "Name and user start with the website's fixed prefix.",
  'websites.db.createdTitle': 'Database created (visible only now)',
  'websites.db.created': 'Database {name} created',
  'websites.db.unknownHint': 'If the database then shows up in the list, set a new password for it.',
  'websites.db.full': 'Your allowance has no room for more databases.',
  'websites.db.suffix': 'Database name',
  'websites.db.suffixHint': 'Lower-case letters, digits and "_", at most 15 characters, e.g. wp.',
  'websites.db.suffixEmpty': 'Enter a name after the prefix.',
  'websites.db.suffixInvalid':
    'Lower-case letters, digits and "_", at most 15 characters, starting with a letter or digit.',
  'websites.db.nameTooLong': 'The full name would be longer than 32 characters. Choose a shorter one.',
  'websites.db.needsSiteUser': 'Only with a valid user name.',
  'websites.db.taken': 'This database exists already.',
  'websites.db.preview': 'Database and user:',
  'websites.db.userHint': 'The database user has the same name as the database.',
  'websites.db.newPassword': 'New password',
  'websites.db.passwordTitle': 'New password for {name}',
  'websites.db.passwordText':
    'The previous password stops working. Enter the new one in your application (WordPress: wp-config.php).',
  'websites.db.passwordDone': 'New password for {name} set',
  'websites.db.delete': 'Delete',
  'websites.db.deleteTitle': 'Delete database {name}?',
  'websites.db.deleteText': 'The database and its user are deleted with all data. This cannot be undone.',
  'websites.db.deleted': 'Database {name} deleted',
  'websites.db.connect': 'Applications on the server connect to host 127.0.0.1, port 3306.',
  'websites.db.noPhpMyAdmin':
    'We do not offer phpMyAdmin. An SSH tunnel lets you reach the database from your computer (then 127.0.0.1:3306 in your database tool):',

  // Usage, backups, mail
  'websites.usage.title': 'Storage',
  'websites.usage.files': 'Files',
  'websites.usage.databases': 'Databases',
  'websites.usage.measured': '{size} · measured {when}',
  'websites.usage.notMeasured': 'Not measured yet',
  'websites.usage.measuredAt': 'measured {when}',
  'websites.usage.fairUse': 'No fixed limit; fair use applies. The server measures every six hours.',
  'websites.backup.title': 'Backups',
  'websites.backup.text':
    'Databases are backed up every night (7 days, in the folder ~/backups). Deleting the website removes these backups too.',
  'websites.mail.title': 'E-mail',
  'websites.mail.text':
    'Websites do not send or receive e-mail. Mailboxes for {domain} are in the E-mail module.',
  'websites.mail.smtp': 'WordPress and other applications send through a mailbox over SMTP (plugin).',
  'websites.mail.link': 'To the E-mail module',

  // Delete
  'websites.delete.zone': 'Danger zone',
  'websites.delete.zoneText': 'Deletes the website on the server with all files and databases.',
  'websites.delete.action': 'Delete website',
  'websites.delete.title': 'Delete website {domain}?',
  'websites.delete.text': 'This cannot be undone. You lose:',
  'websites.delete.lostFiles': 'all files in {home}',
  'websites.delete.lostFilesPlain': 'all files of the website',
  'websites.delete.lostDatabases': 'all databases: {names}',
  'websites.delete.lostNoDatabases': 'all databases of the website',
  'websites.delete.lostBackups': 'the nightly database backups in ~/backups',
  'websites.delete.lostCron': 'scheduled tasks (cron) and running processes',
  'websites.delete.lostUser': 'the user {user} for SFTP and SSH',
  'websites.delete.confirm': 'Type the domain to confirm',
  'websites.delete.submit': 'Delete for good',
  'websites.delete.pending': 'The server is deleting the website. This can take up to three minutes.',
  'websites.delete.done': 'Website {domain} deleted',
  'websites.delete.warnings': 'Website deleted, with notes from the server',

  // Admin
  'websites.admin.title': 'Websites on CloudPanel servers',
  'websites.admin.text':
    'Create websites for customers, adopt unmanaged sites of the servers and remove websites without a customer from the console.',
  'websites.admin.counts':
    '{n} websites, {unassigned} of them unassigned and {missing} missing on the server.',
  'websites.admin.inventoryLine': '{type} · {databases} databases',
  'websites.admin.website': 'Website',
  'websites.admin.instance': 'Server',
  'websites.admin.state': 'State',
  'websites.admin.createTitle': 'Create a website for a customer',
  'websites.admin.createText': 'On any CloudPanel server, for an organization or unassigned for now.',
  'websites.admin.orgHint': 'Unassigned websites are assigned later in the list below.',
  'websites.admin.enablesModule': 'The module "{module}" is activated for {org}.',
  'websites.admin.optionsError':
    'Server not reachable. The choices follow the provider settings; the server checks every value.',
  'websites.admin.noAllowanceCheck':
    "Platform staff are not limited by allowances. The website still counts in the customer's allowance.",
  'websites.admin.forget': 'Remove from the console',
  'websites.admin.forgetTitle': 'Remove {domain} from the console?',
  'websites.admin.forgetText':
    'The website and its databases disappear from the console; on the server ({instance}) everything stays and is no longer managed.',
  'websites.admin.forgetAdopt': 'To adopt it again, run as root on the server:',
  'websites.admin.forgotten': '{domain} removed from the console',
  'websites.admin.unknownHint':
    'If the website then shows up in the inventory, assign it; the customer sets a new password to get access.',
  'websites.admin.unmanagedTitle': 'Unmanaged sites on {instance}',
  'websites.admin.unmanagedText':
    'Sites on the server the console does not manage: created in CloudPanel, or protected (e.g. the console itself).',
  'websites.admin.unmanagedLoad': 'Show',
  'websites.admin.unmanagedReload': 'Reload',
  'websites.admin.unmanagedEmpty': 'There are no unmanaged sites on {instance}.',
  'websites.admin.adoptCol': 'Adopt',
  'websites.admin.protected': 'Protected',
  'websites.admin.protectedHint': 'Never adoptable',
  'websites.admin.adopt': 'Adopt',
  'websites.admin.adoptTitle': 'Adopt {domain}?',
  'websites.admin.adoptText':
    'The console then manages the site. Whoever it is assigned to can set passwords, create databases and delete the site.',
  'websites.admin.adopted': '{domain} adopted; now assign the website to a customer.',
  'websites.admin.adoptServerHint':
    'On this server only root can adopt: run the command on the server. The website appears unassigned after the next sync.',
  'websites.admin.adoptRemoteHint':
    'Adopted sites appear right away as unassigned websites. Protected sites can never be adopted.',

  // Reseller
  'websites.reseller.cardText':
    'Websites and databases the customer may create, out of your allowance and on your server.',
  'websites.reseller.none': 'No website allowance handed out',
  'websites.reseller.noneText': 'Without an allowance the customer cannot create websites.',
  'websites.reseller.pool':
    'You have {sites} websites, {usedSites} of them handed out, and {databases} databases, {usedDatabases} of them handed out.',
  'websites.reseller.noPool':
    'You have no website allowance yourself. Contact weblion to hand out websites to customers.',
  'websites.reseller.dialogText': 'Out of your allowance on {instance}.',
  'websites.reseller.left': 'At most {n} from your allowance',
  'websites.reseller.sitesTooHigh': 'Only {n} websites are left in your allowance.',
  'websites.reseller.databasesTooHigh': 'Only {n} databases are left in your allowance.',
  'websites.reseller.inUse': 'The customer already has {sites} websites and {databases} databases.',
  'websites.reseller.enablesModule': 'This also activates the Web hosting module for the customer.',
  'websites.reseller.removeText':
    'The customer can no longer create websites; the allowance goes back to you.',
  'websites.reseller.removeBlocked':
    'Only without websites. The customer still has {n}; delete them or take them back into your pool.',
  'websites.reseller.releaseText':
    "If it is a website and your website allowance has no room for it, it takes its place in the customer's allowance along: that allowance shrinks by the website and its databases.",

  // Errors (codes of the API)
  'websites.errors.no_allowance': 'This organization has no website allowance.',
  'websites.errors.allowance_exceeded': 'The allowance is used up.',
  'websites.errors.type_not_allowed': 'This type of website is not part of the allowance.',
  'websites.errors.exists.domain': 'This domain is a website already or belongs to another customer.',
  'websites.errors.exists.siteUser': 'This user name exists on the server already. Choose another one.',
  'websites.errors.exists.database': 'This database exists on the server already. Choose another name.',
  'websites.errors.dns_not_ready': 'DNS does not point to the server yet. Check the records or try anyway.',
  'websites.errors.website_busy': 'The website is being created or deleted. Try again afterwards.',
  'websites.errors.website_error':
    'The last change of the website did not finish. The next sync settles the state.',
  'websites.errors.website_missing': 'The server no longer reports this website.',
  'websites.errors.busy': 'The server is busy. Try again in a minute.',
  'websites.errors.timeout':
    'The server did not answer in time. It may still be working; the next sync shows the result.',
  'websites.errors.unknownOutcome': 'Outcome unknown',
  'websites.errors.unknownOutcomeText':
    'The server may have made the change anyway. The next sync shows the result.',
};
