import type { Allowlist } from '../../checks';

/**
 * False positives of the heuristic checks 3 to 6 and 11 (i18n 19.4) for locale it, translation group
 * C (sections billing, cloud, storage, phone, media, uptime). Owned by unit T-it-c (plan 7.1). Every entry is a key of
 * one of these sections, with a comment in English that says why the check is wrong for it.
 */
export const allowlist: Allowlist = {
  germanOk: [],
  informalOk: [],
  lengthOk: [],
  glossaryOk: [
    // "{n} Rechnung(en)": the German writes singular and plural at once; Italian uses the plural "fatture" with
    // the count as a label ("Fatture aperte: {n}"), and the plural does not contain the singular "fattura".
    'billing.summary.openCount',
    'billing.admin.count',
    'billing.admin.zohoErrors',
    // "Reseller" is plural here ("nur für Reseller"); the Italian plural "rivenditori" does not contain the
    // singular "rivenditore" that the check looks for.
    'billing.products.notReseller',
    // A menu path of the Hetzner Console, which has no Italian interface: the labels stay in English as the
    // reader sees them there ("API tokens", "Generate API token"), so "token API" cannot appear.
    'providers.hetzner.tokenHint',
    // "das Abmelden" is signing devices out of Jellyfin (the action "Disconnetti tutti i dispositivi"), rendered
    // as "disconnessione"; the glossary's "esci" is the console's own sign-out button and does not fit here.
    'media.devices.failed',
    'media.requests.sessionHint',
    // "Verwaltung" here is the management sign-in of an Uptime Kuma instance (the console may create and change
    // monitors there), rendered as "gestione"; the glossary's "amministrazione" is the weblion admin area.
    'uptime.managementOff',
    'uptime.managementError',
    'uptime.noHistory',
    'uptime.admin.subtitle',
    'uptime.admin.syncManagementError',
    'uptime.admin.instancesText',
    'uptime.admin.management.ok',
    'uptime.admin.management.error',
    'uptime.admin.demoManagement',
    'uptime.admin.signIn',
    'uptime.admin.signInTitle',
    'uptime.admin.signedIn',
    'uptime.admin.signedInVersion',
    'uptime.allowance.instanceHint',
    'uptime.allowance.noManagedInstance',
    'uptime.allowance.notManaged',
    'providers.uptimekuma.management',
    'providers.uptimekuma.managementHint',
    'explorer.uptimekumaPath',
    'explorer.uptimekumaBodyHint',
    // The button signs the Uptime Kuma instance out of management ("Disconnetti"); the glossary's "Esci" is the
    // user's own sign-out of the console and would read as logging out.
    'uptime.admin.signOut',
  ],
  typographyOk: [],
};
