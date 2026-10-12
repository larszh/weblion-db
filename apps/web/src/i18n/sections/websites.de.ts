/**
 * Websites (Modul "webhosting", CloudPanel): Provider-Formular, Admin-Inventar, Seiten der
 * Organisation, Kontingente. Keys beginnen mit "websites." (plus "providers.cloudpanel." und
 * "hosting.kind.").
 */
export const websitesDe = {
  // Provider form
  'providers.cloudpanel.help':
    'Ein eigener CloudPanel-Server (CE 2.5.0 oder neuer) für Websites von Kunden, nicht der Server der Console. Die Console meldet sich per SSH mit einem ed25519-Schlüssel als Agent-Benutzer an und darf dort nur den Root-Wrapper weblion-clp ausführen. Installieren Sie ihn mit deploy/cloudpanel-agent/install.sh aus dem Repository; das Skript zeigt den Fingerabdruck des Host-Schlüssels an.',
  'providers.cloudpanel.host': 'SSH-Host',
  'providers.cloudpanel.hostHint':
    'Hostname oder IP-Adresse, unter der die Console den Server per SSH erreicht.',
  'providers.cloudpanel.hostInvalid': 'Ein Hostname oder eine IP-Adresse.',
  'providers.cloudpanel.port': 'SSH-Port',
  'providers.cloudpanel.username': 'SSH-Benutzer',
  'providers.cloudpanel.usernameHint': 'Der Agent-Benutzer, den install.sh anlegt. Standard: weblion-agent.',
  'providers.cloudpanel.privateKey': 'Privater Schlüssel (ed25519)',
  'providers.cloudpanel.privateKeyHint':
    'Unverschlüsselter OpenSSH-Schlüssel (-----BEGIN OPENSSH PRIVATE KEY-----). Er wird verschlüsselt gespeichert und nie wieder angezeigt. Empfohlen: ein eigener Schlüssel pro Server.',
  'providers.cloudpanel.generate': 'Schlüsselpaar erzeugen',
  'providers.cloudpanel.generated':
    'Neues Schlüsselpaar erzeugt. Es gilt erst, wenn Sie speichern; installieren Sie den öffentlichen Schlüssel auf dem Server.',
  'providers.cloudpanel.publicKey': 'Öffentlicher Schlüssel',
  'providers.cloudpanel.publicKeyHint':
    'Diesen Schlüssel übergeben Sie install.sh auf dem Server (--public-key). Er ist nicht geheim.',
  'providers.cloudpanel.hostKey': 'Fingerabdruck des Host-Schlüssels',
  'providers.cloudpanel.hostKeyHint':
    'SHA256:..., wie ihn install.sh oder "ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub" auf dem Server ausgibt. Ein anderer Host-Schlüssel stoppt die Verbindung, bis Sie ihn hier ändern.',
  'providers.cloudpanel.hostKeyInvalid': 'SHA256: gefolgt von 43 Zeichen, z.B. SHA256:Ab3...',
  'providers.cloudpanel.accessHost': 'Host für Kunden (SFTP/SSH, optional)',
  'providers.cloudpanel.accessHostHint':
    'Diesen Namen zeigen wir Kunden für SFTP und SSH, z.B. web1.weblion.cloud (mit A/AAAA-Einträgen). Standard: der SSH-Host.',
  'providers.cloudpanel.accessHostInvalid': 'Ein Hostname wie web1.weblion.cloud.',
  'providers.cloudpanel.ipv4': 'Öffentliche IPv4-Adressen (optional)',
  'providers.cloudpanel.ipv6': 'Öffentliche IPv6-Adressen (optional)',
  'providers.cloudpanel.ipsHint':
    'Durch Komma getrennt, für die DNS-Prüfung vor SSL-Zertifikaten. Standard: was der Server meldet.',
  'providers.cloudpanel.phpVersions': 'PHP-Versionen für Kunden (optional)',
  'providers.cloudpanel.phpVersionsHint':
    'Durch Komma getrennt, z.B. 8.3, 8.4 (Standard). Angeboten wird nur, was auf dem Server installiert ist.',
  'providers.cloudpanel.templates': 'Anwendungen für Kunden (optional)',
  'providers.cloudpanel.templatesHint':
    'Vhost-Vorlagen wie in CloudPanel, durch Komma getrennt; ein * am Ende passt auf alle Namen mit diesem Anfang (Laravel*). Standard: Generic, WordPress, WooCommerce.',
  'providers.cloudpanel.nodejs': 'Node.js-Websites für Kunden',
  'providers.cloudpanel.nodejsHint':
    'Nur wenn der Agent mit --nodejs installiert wurde. Kunden brauchen Node.js zusätzlich in ihrem Kontingent.',
  'providers.cloudpanel.websites': 'Websites',
  'providers.cloudpanel.websitesText':
    'Websites dieses Servers, ihre Datenbanken und die Zuweisung an Kunden.',
  'providers.cloudpanel.toWebsites': 'Zu den Websites',
  'providers.cloudpanel.consoleKey': 'SSH-Schlüssel der Console',
  'providers.cloudpanel.installCommand': 'Installation auf dem Server (als root)',
  'providers.cloudpanel.installCommandHint':
    'Ersetzen Sie die Platzhalter: --from mit den ausgehenden IP-Adressen der Console, --protect-domain und --protect-user mit jeder Site des Betreibers auf diesem Server.',

  // Admin inventory
  'websites.admin.synced': '{seen} Websites abgeglichen, {missing} fehlen auf dem Server',
  'hosting.kind.website': 'Website',
  'hosting.kind.webspace': 'Webspace',

  // Status of websites and their databases
  'websites.status.creating': 'Wird angelegt',
  'websites.status.deleting': 'Wird gelöscht',
  'websites.status.error': 'Unklar',
};
