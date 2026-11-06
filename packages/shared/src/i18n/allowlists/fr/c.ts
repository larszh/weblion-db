import type { Allowlist } from '../../checks';

/**
 * False positives of the heuristic checks 3 to 6 and 11 (i18n 19.4) for locale fr, translation group
 * C (sections billing, cloud, storage, phone, media, uptime). Owned by unit T-fr-c (plan 7.1). Every entry is a key of
 * one of these sections, with a comment in English that says why the check is wrong for it.
 */
export const allowlist: Allowlist = {
  germanOk: [],
  informalOk: [],
  lengthOk: [],
  glossaryOk: [
    // "in Rechnung stellen" is the German idiom for "to bill"; French says "facturer", not "mettre en facture".
    'billing.services.customerText',
    // Same idiom "in Rechnung gestellt": "est facturé" is the natural French.
    'billing.service.addText',
    // The menu path names labels of the Hetzner Console, which has no French interface; they stay in English
    // ("Project", "Generate API token") so the reader finds them, so "projet" and "jeton API" cannot appear.
    'providers.hetzner.tokenHint',
    // "das Abmelden" (of devices) is a noun here, and the console signs devices out: French uses the noun
    // "déconnexion", not the reflexive verb "se déconnecter" (signing yourself out).
    'media.devices.failed',
    // Same noun "dem Abmelden aller Geräte": "la déconnexion de tous les appareils".
    'media.requests.sessionHint',
  ],
  typographyOk: [],
};
