import type { cloudDe } from './cloud.de';

export const cloudEn: Record<keyof typeof cloudDe, string> = {
  // Rescale with plans
  'plans.title': 'Change server type',
  'plans.subtitle': 'CPU, memory and disk follow from the server type.',
  'plans.type': 'Type',
  'plans.price': 'Price/month',
  'plans.priceFrom': 'from {price}',
  'plans.priceStaff':
    'Prices are purchase prices at the provider (gross per month), visible to weblion.one staff only.',
  'plans.current': 'Current',
  'plans.deprecated': 'Deprecated',
  'plans.dedicated': 'Dedicated',
  'plans.diskTooSmall': 'Disk too small',
  'plans.diskTooSmallHint':
    'The server disk has {disk} GB. Types with a smaller disk are not possible because a disk cannot shrink.',
  'plans.empty': 'No matching server types found',
  'plans.select': 'Choose a server type.',
  'plans.upgradeDisk': 'Grow the disk to {disk} GB',
  'plans.upgradeDiskHint':
    'A larger disk cannot be shrunk again. Afterwards there is no way back to a type with a smaller disk. Without this option the disk stays at {current} GB and the change can be undone.',
  'plans.hetznerOff':
    'Hetzner only changes the server type while the server is off. Shut it down under Power first and start it again afterwards.',
  'plans.hint': 'Another server type changes the costs and may need a reboot.',
  'plans.confirmText': 'The server changes to {plan} ({cores} vCPU, {memory} memory).',
  'plans.confirmDisk': 'The disk grows to {disk} GB. This cannot be undone.',

  // Create dialog
  'inventory.plan': 'Server type',
  'inventory.location': 'Location',
  'inventory.image': 'Image',
  'inventory.createTextPlans': 'Creates a server of a fixed server type at the chosen location.',
  'inventory.createHintPlans':
    'The server is up shortly and billed by the provider from then on. It shows up in the inventory, the result is in the audit log. Set a root password afterwards in the server settings.',
  'inventory.notInLocation': 'not at this location',
  'inventory.archImage': '{arch} type: choose a matching image.',
  'inventory.importHint.hetzner': 'The numeric server ID from the Hetzner Console, e.g. 42817193.',

  // Provider form
  'providers.hetzner.token': 'API token',
  'providers.hetzner.tokenHint':
    'Hetzner Console > project > Security > API tokens > Generate API token, permission "Read & Write".',
  'providers.hetzner.help':
    'One connection per Hetzner project: a token only sees the servers of the project it was created in. Hetzner reports the location per server, country and city here are only the default.',
  'providers.baseUrlDefault': 'Default: {url}',

  // Explorer
  'explorer.hetznerPath':
    'Paths relative to /v1, e.g. /servers/<id>/actions. Root passwords and console access are hidden.',
  'explorer.bodyHintJson': 'Sent to the provider as JSON.',

  // Hints in the server tabs
  'backups.hetznerHint':
    'Backups have to be enabled for this server at Hetzner (costs 20 % of the server price). Hetzner keeps the latest 7. Restoring overwrites the disk with the backup.',
  'snapshots.hetznerHint':
    'Snapshots save the disk without memory and are billed per GB and month at Hetzner. Rolling back overwrites the disk with the snapshot.',
  'delete.hetznerHint': 'Hetzner deletes the server even while it is running, right away and with all data.',

  // Root password
  'password.title': 'Root password',
  'password.subtitle': 'Sets a new random password for root.',
  'password.hint':
    'The server has to be running. Depending on the provider the QEMU guest agent is needed in the guest (Linux).',
  'password.reset': 'Reset password',
  'password.confirmTitle': 'Reset the root password of {name}?',
  'password.confirmText': 'The previous password stops working.',
  'password.newTitle': 'New root password',
  'password.newText': 'The password is shown only now and stored nowhere. Copy it to a safe place.',
  'password.none': 'The provider returned no password.',
};
