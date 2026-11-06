import type { TargetLocale } from './locales';

/** One binding term of the translation guide (i18n 19.3). The API seeds translation_glossary from these. */
export interface GlossaryTerm {
  /** German term, or the name kept in every language. */
  term: string;
  /** Never translated: the value must contain the term unchanged. */
  keep: boolean;
  translations: Partial<Record<TargetLocale, string>>;
  /** Context of the term, for translators and the Mass Translate prompt. */
  note?: string | null;
}

const t = (
  term: string,
  en: string,
  fr: string,
  it: string,
  nl: string,
  note: string | null = null,
): GlossaryTerm => ({ term, keep: false, translations: { en, fr, it, nl }, note });

const keep = (term: string, note: string | null = null): GlossaryTerm => ({
  term,
  keep: true,
  translations: {},
  note,
});

/**
 * The term table of i18n 19.3 (with the AI rows of plan 7.3) and the names of rule 10 as keep entries. Check 6
 * (checks.ts) applies a term only where it stands as a word of its own in the German text.
 */
export const DEFAULT_GLOSSARY: readonly GlossaryTerm[] = [
  t('Organisation', 'organization', 'organisation', 'organizzazione', 'organisatie'),
  t('Mitglied', 'member', 'membre', 'membro', 'lid'),
  t('Rolle', 'role', 'rôle', 'ruolo', 'rol'),
  t('Kunde', 'customer', 'client', 'cliente', 'klant'),
  t('Reseller', 'reseller', 'revendeur', 'rivenditore', 'reseller'),
  t('Abrechnung', 'billing', 'facturation', 'fatturazione', 'facturering'),
  t('Rechnung', 'invoice', 'facture', 'fattura', 'factuur'),
  t('Rechnungsentwurf', 'draft invoice', 'brouillon de facture', 'bozza di fattura', 'conceptfactuur'),
  t('Gutschrift', 'credit note', 'note de crédit', 'nota di credito', 'creditnota'),
  t('Guthaben', 'credit', 'crédit', 'credito', 'tegoed'),
  t('Zahlung', 'payment', 'paiement', 'pagamento', 'betaling'),
  t(
    'Zahlungserinnerung',
    'payment reminder',
    'rappel de paiement',
    'sollecito di pagamento',
    'betalingsherinnering',
  ),
  t('Fälligkeit', 'due date', 'échéance', 'scadenza', 'vervaldatum'),
  t('MWST', 'VAT', 'TVA', 'IVA', 'btw'),
  t('QR-Rechnung', 'QR-bill', 'QR-facture', 'QR-fattura', 'QR-factuur'),
  t('Zahlteil', 'payment part', 'section paiement', 'sezione pagamento', 'betaalgedeelte'),
  t('Dienst', 'service', 'service', 'servizio', 'dienst', 'Billing: a service a customer is billed for.'),
  t('Produkt', 'product', 'produit', 'prodotto', 'product'),
  t('Kontingent', 'allowance', 'contingent', 'contingente', 'quotum'),
  t('Server', 'server', 'serveur', 'server', 'server'),
  t('Projekt', 'project', 'projet', 'progetto', 'project'),
  t('Domain', 'domain', 'domaine', 'dominio', 'domein'),
  t('DNS-Eintrag', 'DNS record', 'enregistrement DNS', 'record DNS', 'DNS-record'),
  t('Webspace', 'web space', 'espace web', 'spazio web', 'webruimte'),
  t('Website', 'website', 'site web', 'sito web', 'website'),
  t('Postfach', 'mailbox', 'boîte e-mail', 'casella e-mail', 'mailbox'),
  t('Weiterleitung', 'forwarding', 'redirection', 'inoltro', 'doorsturing'),
  t('Cloud-Speicher', 'cloud storage', 'stockage cloud', 'archiviazione cloud', 'cloudopslag'),
  t('Telefonanlage', 'phone system', 'central téléphonique', 'centralino', 'telefooncentrale'),
  t('Nebenstelle', 'extension', 'numéro interne', 'interno', 'toestel'),
  t('Monitor', 'monitor', 'sonde', 'monitor', 'monitor', 'Monitoring: one check of Uptime Kuma.'),
  t('Backup', 'backup', 'sauvegarde', 'backup', 'back-up'),
  t('Snapshot', 'snapshot', 'snapshot', 'snapshot', 'snapshot'),
  t('Konsole', 'console', 'console', 'console', 'console'),
  t('Einstellungen', 'settings', 'paramètres', 'impostazioni', 'instellingen'),
  t(
    'Verwaltung',
    'administration',
    'administration',
    'amministrazione',
    'beheer',
    'The admin area of weblion staff.',
  ),
  t('Anmelden', 'sign in', 'se connecter', 'accedi', 'inloggen'),
  t('Abmelden', 'sign out', 'se déconnecter', 'esci', 'uitloggen'),
  t('Passwort', 'password', 'mot de passe', 'password', 'wachtwoord'),
  t(
    'Zwei-Faktor-Authentifizierung',
    'two-factor authentication',
    'authentification à deux facteurs',
    'autenticazione a due fattori',
    'tweestapsverificatie',
  ),
  t('Audit-Log', 'audit log', "journal d'audit", 'registro di audit', 'auditlog'),
  t('Access Policy', 'access policy', "politique d'accès", 'policy di accesso', 'toegangsbeleid'),
  t('API-Token', 'API token', 'jeton API', 'token API', 'API-token'),
  t('Speichern', 'Save', 'Enregistrer', 'Salva', 'Opslaan'),
  t('Abbrechen', 'Cancel', 'Annuler', 'Annulla', 'Annuleren'),
  t('Löschen', 'Delete', 'Supprimer', 'Elimina', 'Verwijderen'),
  t('Bearbeiten', 'Edit', 'Modifier', 'Modifica', 'Bewerken'),
  t('Streaming-Zugang', 'streaming account', 'accès streaming', 'accesso streaming', 'streamingaccount'),

  // AI terms (plan 7.3)
  t('KI', 'AI', 'IA', 'IA', 'AI'),
  t('KI-Assistent', 'AI assistant', 'assistant IA', 'assistente IA', 'AI-assistent'),
  t('Tokens', 'tokens', 'tokens', 'token', 'tokens', 'AI usage: input and output tokens of a model.'),
  t(
    'Datenschutzhinweis',
    'privacy notice',
    'avis de confidentialité',
    'informativa sulla privacy',
    'privacyverklaring',
  ),
  t('Übersetzung', 'translation', 'traduction', 'traduzione', 'vertaling'),
  t('Glossar', 'glossary', 'glossaire', 'glossario', 'woordenlijst'),
  t('Vorschlag', 'proposal', 'proposition', 'proposta', 'voorstel'),
  t('Demo-Modus', 'demo mode', 'mode démo', 'modalità demo', 'demomodus'),
  t('Ablehnen', 'decline', 'refuser', 'rifiutare', 'weigeren', 'Declining the AI features.'),

  // Names that stay names in every language (rule 10, plan 7.3)
  keep('weblion.one'),
  keep('24fire'),
  keep('Proxmox'),
  keep('Hetzner'),
  keep('Cloudflare'),
  keep('CloudPanel'),
  keep('Plesk'),
  keep('Mailcow'),
  keep('Nextcloud'),
  keep('3CX'),
  keep('Jellyfin'),
  keep('Seerr'),
  keep('Uptime Kuma'),
  keep('Stripe'),
  keep('TWINT'),
  keep('Zoho'),
  keep('Joker'),
  keep('Anthropic'),
  keep('Claude'),
  keep('Claude Opus 5.5'),
  keep('Claude Sonnet 5.5'),
  keep('Claude Haiku 5.5'),
  keep('Claude Console'),
  keep('SFTP'),
  keep('SSH'),
  keep('IMAP'),
  keep('SMTP'),
  keep('DNS'),
  keep('DKIM'),
  keep('SPF'),
  keep('DMARC'),
  keep('MX'),
  keep('CNAME'),
  keep('TXT'),
  keep('ISO'),
  keep('IPv4'),
  keep('IPv6'),
  keep('API'),
  keep('URL'),
  keep('CDN'),
  keep('SSL'),
  keep('TLS'),
  keep('USD'),
  keep('CHF'),
  keep('ANTHROPIC_API_KEY', 'Environment variable name.'),
  keep('ENCRYPTION_KEY', 'Environment variable name.'),
];
