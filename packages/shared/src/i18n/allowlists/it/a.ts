import type { Allowlist } from '../../checks';

/**
 * False positives of the heuristic checks 3 to 6 and 11 (i18n 19.4) for locale it, translation group
 * A (sections core, admin, ai, translations, email, pdf). Owned by unit T-it-a (plan 7.1). Every entry is a key of
 * one of these sections, with a comment in English that says why the check is wrong for it.
 */
export const allowlist: Allowlist = {
  germanOk: [],
  informalOk: [],
  lengthOk: [],
  glossaryOk: [
    // "Reseller" is plural here ("{resellers} Reseller"); the Italian plural "rivenditori" does not contain the
    // singular "rivenditore" the check looks for.
    'admin.stat.orgsSub',
    // A file name: the words of "bozza di fattura" are joined by hyphens ("Bozza-fattura-{id}.pdf"), as the
    // German file name joins "Rechnungsentwurf" to the id, so the spaced term cannot appear.
    'pdf.invoice.draftFilename',
    // "beim Abmelden" is the noun "on signing out", rendered with the verb "quando esce"; the glossary term
    // "esci" is the label of the sign-out button and would not fit this sentence.
    'ai.assistant.sessionHint',
    // A button: Italian buttons use the short imperative "Rifiuta" (rule 3, like "Salva", "Annulla"); the
    // glossary infinitive "rifiutare" is used in the running texts of the same feature.
    'ai.org.declineConfirm.action',
  ],
  typographyOk: [],
};
