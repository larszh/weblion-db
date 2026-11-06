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
  ],
  typographyOk: [],
};
