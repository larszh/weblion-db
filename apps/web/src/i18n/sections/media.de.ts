/**
 * Streaming (Modul "media", Jellyfin): Navigation, Provider-Formular, Reseller-Übersicht,
 * Lösch-Blocker, Dashboard und API Explorer. Die Seiten der Organisation, des Admin-Bereichs und
 * des Resellers ergänzen ihre Keys mit dem Präfix "media.".
 */
export const mediaDe = {
  'nav.media': 'Streaming',
  'nav.admin.media': 'Streaming',
  'perm.group.media': 'Streaming',

  // Admin, dashboard
  'media.admin.synced':
    '{seen} Streaming-Zugänge abgeglichen, {missing} nicht mehr gefunden, {repaired} Richtlinien angepasst',
  'media.dashboardSub': '{n} von {max} Zugängen',

  // Provider form
  'providers.jellyfin.help':
    'Jellyfin 10.10 oder neuer (10.11 empfohlen) mit abgeschlossener Ersteinrichtung. Erstellen Sie im Jellyfin-Dashboard unter API-Schlüssel einen eigenen Schlüssel nur für weblion.one. Der Schlüssel hat volle Administratorrechte.',
  'providers.jellyfin.url': 'Adresse der Instanz',
  'providers.jellyfin.urlHint':
    'Die Adresse, die Ihre Kunden in den Jellyfin-Apps eingeben, mit Pfad, falls Jellyfin unter einem Basis-Pfad läuft, z. B. https://media.weblion.one.',
  'providers.jellyfin.urlInvalid':
    'Eine http- oder https-Adresse ohne Abfrage und ohne Zugangsdaten, ein Pfad nur für den Basis-Pfad von Jellyfin, z. B. https://media.weblion.one.',
  'providers.jellyfin.httpWarning':
    'Ohne https gehen API-Schlüssel und Passwörter unverschlüsselt über das Netz. Nur in einem privaten Netz verwenden.',
  'providers.jellyfin.apiKey': 'API-Schlüssel',
  'providers.jellyfin.apiKeyHint':
    'Dashboard > API-Schlüssel > Hinzufügen, App-Name z. B. weblion.one. 32 Zeichen aus 0-9 und a-f. Wird verschlüsselt gespeichert und nie mehr angezeigt.',
  'providers.jellyfin.apiKeyInvalid': 'Ein Jellyfin-API-Schlüssel hat genau 32 Zeichen aus 0-9 und a-f.',
  'providers.jellyfin.accountsText':
    'Streaming-Zugänge dieser Instanz, Kontingente der Kunden und Übernahme von Benutzern, die direkt in Jellyfin angelegt wurden.',
  'providers.jellyfin.toAccounts': 'Zu den Streaming-Zugängen',

  // Reseller overview, delete blockers
  'admin.resources.mediaAccounts': 'Streaming-Zugänge',
  'admin.blocker.mediaAccounts': 'Streaming-Zugänge: {n}',
  'admin.blocker.mediaAllowances': 'Streaming-Kontingent',

  // API explorer
  'explorer.jellyfinPath':
    'Pfade relativ zur Adresse der Instanz, z. B. /Users oder /Library/VirtualFolders. Schlüssel, Zugriffstoken und Passwörter in Antworten werden ausgeblendet. /Auth/Keys und Anmelde-Endpunkte sind gesperrt.',
  'explorer.jellyfinBodyHint':
    'GET und DELETE senden die Parameter als Query, POST als JSON. Eine Richtlinie (POST /Users/<id>/Policy) immer vollständig senden: Jellyfin setzt fehlende Felder zurück.',
} as const;
