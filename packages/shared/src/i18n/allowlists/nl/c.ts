import type { Allowlist } from '../../checks';

/**
 * False positives of the heuristic checks 3 to 6 and 11 (i18n 19.4) for locale nl, translation group
 * C (sections billing, cloud, storage, phone, media, uptime). Owned by unit T-nl-c (plan 7.1). Every entry is a key of
 * one of these sections, with a comment in English that says why the check is wrong for it.
 */
export const allowlist: Allowlist = {
  germanOk: [],
  informalOk: [],
  lengthOk: [],
  glossaryOk: [
    // German "Rechnung(en)" is a singular-or-plural form. The Dutch puts the count after a colon and uses the
    // plural "facturen", which is the glossary term "factuur" in the plural but does not contain the singular.
    'billing.summary.openCount',
    'billing.admin.count',
    'billing.admin.zohoErrors',
  ],
  typographyOk: [],
};
