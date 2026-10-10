/**
 * Feste Server-Typen und Standorte (Hetzner Cloud, Demo), Root-Passwort und Hinweise für
 * Hetzner in den Server-Tabs, im Admin-Bereich und im API Explorer.
 */
export const cloudDe = {
  // Rescale with plans
  'plans.title': 'Server-Typ ändern',
  'plans.subtitle': 'CPU, Arbeitsspeicher und Disk ergeben sich aus dem Server-Typ.',
  'plans.type': 'Typ',
  'plans.price': 'Preis/Monat',
  'plans.priceFrom': 'ab {price}',
  'plans.priceStaff':
    'Preise sind Einkaufspreise beim Provider (brutto pro Monat) und nur für weblion.one sichtbar.',
  'plans.current': 'Aktuell',
  'plans.deprecated': 'Auslaufend',
  'plans.dedicated': 'Dediziert',
  'plans.diskTooSmall': 'Disk zu klein',
  'plans.diskTooSmallHint':
    'Die Disk des Servers hat {disk} GB. Typen mit kleinerer Disk sind nicht möglich, weil sich eine Disk nicht verkleinern lässt.',
  'plans.empty': 'Keine passenden Server-Typen gefunden',
  'plans.select': 'Wählen Sie einen Server-Typ.',
  'plans.upgradeDisk': 'Disk auf {disk} GB vergrössern',
  'plans.upgradeDiskHint':
    'Eine grössere Disk lässt sich nicht mehr verkleinern. Danach ist kein Wechsel auf einen Typ mit kleinerer Disk mehr möglich. Ohne diese Option bleibt die Disk bei {current} GB und der Wechsel lässt sich rückgängig machen.',
  'plans.hetznerOff':
    'Hetzner ändert den Server-Typ nur bei ausgeschaltetem Server. Fahren Sie ihn vorher unter Energie herunter und starten Sie ihn danach wieder.',
  'plans.hint': 'Ein anderer Server-Typ ändert die Kosten und kann einen Neustart erfordern.',
  'plans.confirmText': 'Der Server wird auf {plan} umgestellt ({cores} vCPU, {memory} RAM).',
  'plans.confirmDisk': 'Die Disk wächst auf {disk} GB. Das lässt sich nicht rückgängig machen.',

  // Create dialog
  'inventory.plan': 'Server-Typ',
  'inventory.location': 'Standort',
  'inventory.image': 'Image',
  'inventory.createTextPlans': 'Erstellt einen Server mit festem Server-Typ am gewählten Standort.',
  'inventory.createHintPlans':
    'Der Server läuft nach kurzer Zeit und wird ab dann vom Provider berechnet. Er erscheint im Inventar, das Ergebnis steht im Audit-Log. Ein Root-Passwort setzen Sie danach in den Einstellungen des Servers.',
  'inventory.notInLocation': 'nicht an diesem Standort',
  'inventory.archImage': 'Typ mit {arch}: Wählen Sie ein passendes Image.',
  'inventory.importHint.hetzner': 'Die numerische Server-ID aus der Hetzner Console, z.B. 42817193.',

  // Provider form
  'providers.hetzner.token': 'API-Token',
  'providers.hetzner.tokenHint':
    'Hetzner Console > Projekt > Sicherheit > API-Tokens > API-Token generieren, Berechtigung "Lesen & Schreiben".',
  'providers.hetzner.help':
    'Eine Verbindung pro Hetzner-Projekt: Ein Token sieht nur die Server des Projekts, in dem es erstellt wurde. Den Standort meldet Hetzner pro Server, Land und Stadt hier sind nur der Standard.',
  'providers.baseUrlDefault': 'Standard: {url}',

  // Explorer
  'explorer.hetznerPath':
    'Pfade relativ zu /v1, z.B. /servers/<id>/actions. Root-Passwörter und Konsolen-Zugänge werden ausgeblendet.',
  'explorer.bodyHintJson': 'Wird als JSON an den Provider gesendet.',

  // Hints in the server tabs
  'backups.hetznerHint':
    'Backups müssen bei Hetzner für diesen Server aktiviert sein (kostet 20 % des Serverpreises). Hetzner behält die letzten 7. Wiederherstellen überschreibt die Disk mit dem Backup.',
  'snapshots.hetznerHint':
    'Snapshots sichern die Disk ohne Arbeitsspeicher und kosten bei Hetzner pro GB und Monat. Zurückspielen überschreibt die Disk mit dem Snapshot.',
  'delete.hetznerHint': 'Hetzner löscht den Server auch im laufenden Betrieb, sofort und mit allen Daten.',

  // Root password
  'password.title': 'Root-Passwort',
  'password.subtitle': 'Setzt ein neues, zufälliges Passwort für root.',
  'password.hint':
    'Der Server muss laufen. Je nach Provider braucht es den QEMU Guest Agent im Gast (Linux).',
  'password.reset': 'Passwort zurücksetzen',
  'password.confirmTitle': 'Root-Passwort von {name} zurücksetzen?',
  'password.confirmText': 'Das bisherige Passwort funktioniert danach nicht mehr.',
  'password.newTitle': 'Neues Root-Passwort',
  'password.newText':
    'Das Passwort wird nur jetzt angezeigt und nirgends gespeichert. Kopieren Sie es an einen sicheren Ort.',
  'password.none': 'Der Provider hat kein Passwort zurückgegeben.',
} as const;
