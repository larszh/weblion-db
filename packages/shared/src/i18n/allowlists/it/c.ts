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
  ],
  typographyOk: [],
};
