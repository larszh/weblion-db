import type { Allowlist } from '../../checks';

/**
 * False positives of the heuristic checks 3 to 6 and 11 (i18n 19.4) for locale fr, translation group
 * A (sections core, admin, ai, translations, email, pdf). Owned by unit T-fr-a (plan 7.1). Every entry is a key of
 * one of these sections, with a comment in English that says why the check is wrong for it.
 */
export const allowlist: Allowlist = {
  germanOk: [],
  informalOk: [],
  lengthOk: [],
  glossaryOk: [
    // "Tokens" in these German texts means API tokens, which are "jetons API" in French; the glossary term
    // "Tokens" (fr "tokens") is about the input and output tokens of an AI model only.
    'nav.tokens',
    'perm.apitoken:read',
    'perm.apitoken:write',
    'tokens.subtitle',
    'tokens.empty',
    'tokens.emptyText',
    // "Abmelden" here signs out another session or device: the transitive "Déconnecter" is right, the
    // reflexive glossary form "se déconnecter" (signing oneself out) would be wrong on that button.
    'account.sessions.revoke',
    // A file name: "projet de facture" is joined with hyphens like the German and English file names, so the
    // glossary term with spaces cannot appear literally.
    'pdf.invoice.draftFilename',
  ],
  typographyOk: [],
};
