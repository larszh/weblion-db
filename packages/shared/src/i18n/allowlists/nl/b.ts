import type { Allowlist } from '../../checks';

/**
 * False positives of the heuristic checks 3 to 6 and 11 (i18n 19.4) for locale nl, translation group
 * B (sections hosting, cloudflare, websites, mail). Owned by unit T-nl-b (plan 7.1). Every entry is a key of
 * one of these sections, with a comment in English that says why the check is wrong for it.
 */
export const allowlist: Allowlist = {
  germanOk: [],
  informalOk: [],
  lengthOk: [],
  glossaryOk: [
    // "Speichern Sie" is an imperative in a sentence, not the Save button; Dutch says "Bewaar ... nu" (keep them
    // safe), which matches the confirm checkbox "Ik heb de inloggegevens bewaard".
    'websites.creds.text',
  ],
  typographyOk: [],
};
