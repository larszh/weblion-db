import type { Allowlist } from '../../checks';

/**
 * False positives of the heuristic checks 3 to 6 and 11 (i18n 19.4) for locale it, translation group
 * B (sections hosting, cloudflare, websites, mail). Owned by unit T-it-b (plan 7.1). Every entry is a key of
 * one of these sections, with a comment in English that says why the check is wrong for it.
 */
export const allowlist: Allowlist = {
  germanOk: [],
  informalOk: [],
  lengthOk: [],
  glossaryOk: [
    // "Weiterleitung" of a web address (HTTP redirect) is "reindirizzamento"; the glossary's "inoltro" is the
    // e-mail forwarding term and would be wrong for a URL redirect.
    'hosting.dns.typeLabel.HTTP_REDIRECT',
    'hosting.dns.typeLabel.HTTP_FRAME',
    // German "Reseller" is plural here; the Italian plural "rivenditori" does not contain the singular form.
    'hosting.admin.groupDirect',
    // "Website-Kontingent" is an allowance of websites (plural); Italian says "contingente di siti web", and the
    // plural "siti web" does not contain the singular glossary form "sito web".
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
    // "DNS-Verwaltung" is the DNS management page of a domain, "gestione DNS"; the glossary's "amministrazione"
    // is reserved for the weblion admin area.
    'mail.dns.toZone',
    'mail.dns.explain.conflicts',
  ],
  typographyOk: [],
};
