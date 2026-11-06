import type { Allowlist } from '../../checks';

/**
 * False positives of the heuristic checks 3 to 6 and 11 (i18n 19.4) for locale fr, translation group
 * B (sections hosting, cloudflare, websites, mail). Owned by unit T-fr-b (plan 7.1). Every entry is a key of
 * one of these sections, with a comment in English that says why the check is wrong for it.
 */
export const allowlist: Allowlist = {
  germanOk: [],
  informalOk: [],
  lengthOk: [],
  glossaryOk: [
    // "API-Tokens" here are Cloudflare API tokens ("jetons API"), not the AI usage tokens of the glossary entry.
    'providers.cloudflare.help',
    'providers.cloudflare.tokenHint',
    'explorer.cloudflarePath',
    // "Website-Kontingent" is an allowance of several websites: French says "contingent de sites web" (plural),
    // which the substring check for "site web" does not match.
    'websites.list.noAllowance',
    'websites.list.noAllowanceText',
    'websites.list.noAllowanceReseller',
    'websites.allowance.title',
    'websites.allowance.setUpTitle',
    'websites.allowance.editTitle',
    'websites.allowance.instanceLocked',
    'websites.allowance.resellerNone',
    'websites.allowance.saved',
    'websites.allowance.removeTitle',
    'websites.allowance.removeBlockedCustomers',
    'websites.allowance.removed',
    'websites.allowance.none',
    'websites.reseller.none',
    'websites.reseller.noPool',
    'websites.errors.no_allowance',
    // "DNS-Verwaltung" is DNS management, not the staff administration area of the glossary entry
    // ("Verwaltung" -> "administration"); French says "gestion DNS".
    'mail.dns.toZone',
    'mail.dns.explain.conflicts',
  ],
  typographyOk: [
    // A list of allowed password characters: the space before "!" and ":" separates literal characters, it is
    // not punctuation spacing.
    'websites.password.rule.characters',
  ],
};
