/**
 * Telefonie (Modul "phone", 3CX): Navigation, Provider-Formular, Reseller-Ressourcen und API
 * Explorer. Die Seiten der Organisation und des Admin-Bereichs ergänzen ihre Keys mit dem
 * Präfix "phone." (plus wenige nav/provider/explorer/admin-Keys).
 */
export const phoneDe = {
  'nav.phone': 'Telefonie',
  'nav.admin.phone': 'Telefonanlagen',
  'perm.group.phone': 'Telefonie',

  // Admin
  'phone.admin.synced': '{seen} Telefonanlagen abgeglichen, {missing} nicht mehr gefunden',

  // Provider form
  'providers.threecx.help':
    '3CX V20 mit Enterprise-Lizenz. In der 3CX-Verwaltung unter Integrationen > API einen eigenen API-Client nur für weblion.one anlegen: Client-ID wählen, "XAPI Access Enabled" aktivieren, die Standardgruppe und die Rolle System Admin wählen. Den API-Schlüssel zeigt 3CX nur einmal an.',
  'providers.threecx.url': 'Adresse der Telefonanlage',
  'providers.threecx.urlHint':
    'https://… mit Port, falls nicht 443, z. B. https://muster.3cx.ch. Unter dieser Adresse öffnen auch Ihre Kunden den 3CX-Webclient.',
  'providers.threecx.urlInvalid': 'Eine https-Adresse ohne Pfad, z. B. https://muster.3cx.ch:5001.',
  'providers.threecx.clientId': 'Client-ID',
  'providers.threecx.clientIdHint':
    'Die Client-ID des API-Clients, z. B. weblion. Nicht in anderen Programmen verwenden: 3CX erlaubt pro Client nur ein gültiges Token.',
  'providers.threecx.clientIdInvalid':
    'Nur Buchstaben, Ziffern, Punkt, Bindestrich und Unterstrich, höchstens 64 Zeichen.',
  'providers.threecx.clientSecret': 'API-Schlüssel',
  'providers.threecx.clientSecretHint': 'Wird verschlüsselt gespeichert und nie mehr angezeigt.',
  'providers.threecx.phoneText':
    'Diese Verbindung liefert eine Telefonanlage. Weisen Sie sie im Admin-Bereich einem Kunden zu.',
  'providers.threecx.toPhone': 'Zu den Telefonanlagen',

  // Reseller resources
  'admin.resources.title.phone_system': 'Telefonanlagen',
  'admin.resources.empty.phone_system': 'Diesem Kunden sind keine Telefonanlagen zugewiesen.',
  'admin.resources.assign.phone_system': 'Telefonanlage zuweisen',
  'admin.resources.phoneSystems': 'Telefonanlagen',
  'admin.blocker.phoneSystems': 'Telefonanlagen: {n}',

  // API explorer
  'explorer.threecxPath':
    'XAPI-Pfade relativ zu /xapi/v1, z. B. /Users?$top=10. Passwörter, PINs, Lizenzschlüssel und Provisioning-Links in Antworten werden ausgeblendet.',
  'explorer.threecxBodyHint':
    'GET und DELETE senden die Parameter als Query, POST und PATCH als JSON, z. B. { "FirstName": "Anna" }.',
} as const;
