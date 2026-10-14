/**
 * Monitoring (Modul "monitoring", Uptime Kuma): Navigation, Provider-Formular, Reseller-Ressourcen,
 * Dashboard und API Explorer. Die Seiten der Organisation und des Admin-Bereichs ergänzen ihre
 * Keys mit dem Präfix "uptime." (das Präfix "monitoring." gehört dem Verfügbarkeits-Tab der
 * Server), plus wenige nav/provider/explorer/admin-Keys.
 */
export const uptimeDe = {
  'nav.uptime': 'Monitoring',
  'nav.admin.uptime': 'Monitoring',
  'perm.group.monitoring': 'Monitoring',

  // Admin
  'uptime.admin.synced': '{seen} Monitore abgeglichen, {missing} nicht mehr gemeldet',

  // Provider form
  'providers.uptimekuma.help':
    'Uptime Kuma 2.x. Erstellen Sie in Uptime Kuma unter Einstellungen > API-Schlüssel einen Schlüssel ohne Ablaufdatum nur für weblion.one. Achtung: Mit dem ersten API-Schlüssel akzeptiert /metrics keine Anmeldung mit Benutzername und Passwort mehr.',
  'providers.uptimekuma.url': 'Adresse der Uptime-Kuma-Instanz',
  'providers.uptimekuma.urlHint': 'https://… ohne Pfad, z. B. https://status.weblion.one.',
  'providers.uptimekuma.urlInvalid':
    'Eine http- oder https-Adresse ohne Pfad, z. B. https://status.weblion.one.',
  'providers.uptimekuma.httpWarning':
    'Ohne https geht der API-Schlüssel unverschlüsselt über das Netz. Nur in einem privaten Netz verwenden.',
  'providers.uptimekuma.apiKey': 'API-Schlüssel',
  'providers.uptimekuma.apiKeyHint':
    'Beginnt mit uk, z. B. uk3_… Wird verschlüsselt gespeichert und nie mehr angezeigt.',
  'providers.uptimekuma.apiKeyInvalid':
    'Ein API-Schlüssel von Uptime Kuma beginnt mit uk, seiner Nummer und einem Unterstrich, z. B. uk3_…',
  'providers.uptimekuma.management': 'Verwaltung',
  'providers.uptimekuma.managementHint':
    'Damit Kunden eigene Monitore anlegen können, melden Sie die Instanz unter Admin > Monitoring für die Verwaltung an.',
  'providers.uptimekuma.managementOn': 'Angemeldet',
  'providers.uptimekuma.managementOff': 'Nur lesen',
  'providers.uptimekuma.monitorsText':
    'Diese Verbindung liefert Monitore. Weisen Sie sie im Admin-Bereich unter Monitoring Kunden zu.',
  'providers.uptimekuma.toMonitors': 'Zu den Monitoren',

  // Reseller resources, delete blockers and dashboard
  'admin.resources.title.monitor': 'Monitore',
  'admin.resources.empty.monitor': 'Diesem Kunden sind keine Monitore zugewiesen.',
  'admin.resources.assign.monitor': 'Monitor zuweisen',
  'admin.resources.monitors': 'Monitore',
  'admin.blocker.monitors': 'Monitore: {n}',
  'admin.blocker.monitorAllowances': 'Monitoring-Kontingent',

  // API explorer
  'explorer.uptimekumaPath':
    'HTTP-Pfade relativ zur Adresse der Instanz (/metrics, /api/status-page/<slug>, /api/status-page/heartbeat/<slug>, /api/badge/<id>/<art>, /api/entry-page) oder socket/<Ereignis> der Verwaltung, z. B. socket/getMonitor?args=[1]. Geheimnisse der Monitore werden in Antworten ausgeblendet.',
  'explorer.uptimekumaBodyHint':
    'Schreibende Socket-Ereignisse mit POST und den Argumenten als Liste, z. B. { "args": [12] } für socket/pauseMonitor. Dafür muss die Instanz für die Verwaltung angemeldet sein.',
} as const;
