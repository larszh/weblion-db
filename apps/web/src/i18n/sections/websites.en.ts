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
};
