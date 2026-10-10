import type { cloudflareDe } from './cloudflare.de';

export const cloudflareEn: Record<keyof typeof cloudflareDe, string> = {
  // Provider form
  'providers.cloudflare.help':
    'Create a token of its own for all zones of the account in the Cloudflare dashboard under My Profile > API Tokens (not the Global API Key). Cloudflare allows 1200 API requests per 5 minutes and user: a Cloudflare user of its own for the console works best.',
  'providers.cloudflare.token': 'API token',
  'providers.cloudflare.tokenHint':
    'API Tokens > Create Token > Custom token, zone resources "All zones from an account".',
  'providers.cloudflare.permissions': 'Permissions needed: {permissions}',
  'providers.cloudflare.accountId': 'Account ID',
  'providers.cloudflare.accountIdHint':
    "Optional, on the account's home page in the dashboard. Needed to create zones (moving DNS to Cloudflare), and limits the zone list to this account.",
  'providers.cloudflare.accountIdInvalid': 'The account ID has 32 characters (0-9, a-f).',
  'providers.cloudflare.baseUrl': 'API base URL',
  'providers.cloudflare.baseUrlHint': 'Default: {url}',
  'providers.cloudflare.zones': 'DNS zones',
  'providers.cloudflare.zonesText':
    'DNS zones of this account and their assignment to customers. New zones show up after the next sync.',
  'providers.cloudflare.toZones': 'Go to zones',

  // API explorer
  'explorer.cloudflarePath':
    'Paths relative to /client/v4, e.g. /zones/<zone_id>/dns_records. Secrets in answers are hidden, API tokens cannot be managed here.',
} as const;
