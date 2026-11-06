import type { cloudDe } from './cloud.de';

export const cloudNl: Partial<Record<keyof typeof cloudDe, string>> = {
  'plans.title': 'Servertype wijzigen',
  'plans.subtitle': 'CPU, werkgeheugen en schijf worden bepaald door het servertype.',
  'plans.type': 'Type',
  'plans.price': 'Prijs/maand',
  'plans.priceFrom': 'vanaf {price}',
  'plans.priceStaff':
    'Prijzen zijn inkoopprijzen bij de provider (bruto per maand) en alleen zichtbaar voor weblion.one.',
  'plans.current': 'Huidig',
  'plans.deprecated': 'Wordt uitgefaseerd',
  'plans.dedicated': 'Dedicated',
  'plans.diskTooSmall': 'Schijf te klein',
  'plans.diskTooSmallHint':
    'De schijf van de server is {disk} GB. Types met een kleinere schijf zijn niet mogelijk, omdat een schijf niet kan worden verkleind.',
  'plans.empty': 'Geen passende servertypes gevonden',
  'plans.select': 'Kies een servertype.',
  'plans.upgradeDisk': 'Schijf vergroten tot {disk} GB',
  'plans.upgradeDiskHint':
    'Een grotere schijf kan niet meer worden verkleind. Daarna is geen overstap naar een type met een kleinere schijf meer mogelijk. Zonder deze optie blijft de schijf op {current} GB en kan de wijziging ongedaan worden gemaakt.',
  'plans.hetznerOff':
    'Hetzner wijzigt het servertype alleen als de server is uitgeschakeld. Sluit de server eerst af onder Energiebeheer en start hem daarna weer.',
  'plans.hint': 'Een ander servertype verandert de kosten en kan een herstart vereisen.',
  'plans.confirmText': 'De server wordt omgezet naar {plan} ({cores} vCPU, {memory} RAM).',
  'plans.confirmDisk': 'De schijf groeit naar {disk} GB. Dit kan niet ongedaan worden gemaakt.',
  'inventory.plan': 'Servertype',
  'inventory.location': 'Locatie',
  'inventory.image': 'Image',
  'inventory.createTextPlans': 'Maakt een server met een vast servertype op de gekozen locatie aan.',
  'inventory.createHintPlans':
    'De server draait na korte tijd en wordt vanaf dan door de provider gefactureerd. Hij verschijnt in de inventaris, het resultaat staat in het auditlog. Een rootwachtwoord stelt u daarna in bij de instellingen van de server.',
  'inventory.notInLocation': 'niet op deze locatie',
  'inventory.archImage': 'Type met {arch}: kies een passende image.',
  'inventory.importHint.hetzner': 'De numerieke server-ID uit de Hetzner Console, bijv. 42817193.',
  'providers.hetzner.token': 'API-token',
  'providers.hetzner.tokenHint':
    'Hetzner Console > Project > Security > API tokens > Generate API token, recht "Read & Write".',
  'providers.hetzner.help':
    'Eén verbinding per Hetzner-project: een token ziet alleen de servers van het project waarin het is aangemaakt. Hetzner meldt de locatie per server, land en stad zijn hier alleen de standaard.',
  'providers.baseUrlDefault': 'Standaard: {url}',
  'explorer.hetznerPath':
    'Paden relatief ten opzichte van /v1, bijv. /servers/<id>/actions. Rootwachtwoorden en consoletoegang worden verborgen.',
  'explorer.bodyHintJson': 'Wordt als JSON naar de provider verstuurd.',
  'backups.hetznerHint':
    'Back-ups moeten bij Hetzner voor deze server zijn geactiveerd (kost 20 % van de serverprijs). Hetzner bewaart de laatste 7. Herstellen overschrijft de schijf met de back-up.',
  'snapshots.hetznerHint':
    'Snapshots slaan de schijf op zonder werkgeheugen en kosten bij Hetzner per GB per maand. Terugzetten overschrijft de schijf met de snapshot.',
  'delete.hetznerHint': 'Hetzner verwijdert de server ook als deze draait, direct en met alle gegevens.',
  'password.title': 'Rootwachtwoord',
  'password.subtitle': 'Stelt een nieuw, willekeurig wachtwoord in voor root.',
  'password.hint':
    'De server moet draaien. Afhankelijk van de provider is de QEMU Guest Agent in de gast nodig (Linux).',
  'password.reset': 'Wachtwoord opnieuw instellen',
  'password.confirmTitle': 'Rootwachtwoord van {name} opnieuw instellen?',
  'password.confirmText': 'Het huidige wachtwoord werkt daarna niet meer.',
  'password.newTitle': 'Nieuw rootwachtwoord',
  'password.newText':
    'Het wachtwoord wordt alleen nu getoond en nergens opgeslagen. Kopieer het naar een veilige plek.',
  'password.none': 'De provider heeft geen wachtwoord teruggegeven.',
};
