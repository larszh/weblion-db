import {
  buildCatalog,
  type CatalogSources,
  type I18nCatalog,
  type Stamp,
  type StampFiles,
} from '@weblion/shared/i18n/catalog';
import { TARGET_LOCALES, type Locale, type SectionName, type TargetLocale } from '@weblion/shared';
import { sourceHash } from '../src/i18n/hash';

/**
 * A small catalog for the translation admin and Mass Translate tests (i18n 20.1): about 40 keys over four
 * sections (core, admin, ai, email), with the two legal keys, a server-only email key, placeholders, line
 * breaks, a key without letters, compiled translations in some languages and one stale stamp.
 */

type Texts = Record<string, string>;

const CORE_DE: Texts = {
  'common.save': 'Speichern',
  'common.cancel': 'Abbrechen',
  'common.delete': 'Löschen',
  'common.edit': 'Bearbeiten',
  'common.search': 'Suchen…',
  'common.none': '–',
  'nav.dashboard': 'Übersicht',
  'nav.servers': 'Server',
  'nav.billing': 'Abrechnung',
  'nav.settings': 'Einstellungen',
  'login.hero.title': 'Ihre Server. Ein Panel.',
  'login.hero.text': 'Melden Sie sich an, um Ihre Server zu verwalten.',
  'servers.count': '{count} Server',
  'servers.status.running': 'Läuft',
  'servers.status.stopped': 'Gestoppt',
  'servers.rename.title': 'Server {name} umbenennen',
  'servers.delete.text': 'Der Server {name} wird gelöscht.\nDas kann nicht rückgängig gemacht werden.',
  'billing.invoice.title': 'Rechnung {number}',
  'billing.invoice.paid': 'Die Rechnung {number} ist bezahlt.',
  'billing.invoice.status.invoiced': 'Verrechnet',
  'billing.invoice.total': 'Total {amount}',
  'mail.greeting': 'Freundliche Grüsse',
  'mail.signature': 'Ihr weblion.one Team',
  'help.link': 'Mehr dazu unter https://weblion.one/hilfe',
  'help.contact': 'Schreiben Sie an support@weblion.one',
  'help.notice': 'Der Hinweis steht unter ai.notice.text.',
};

const CORE_EN: Texts = {
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.search': 'Search…',
  'common.none': '–',
  'nav.dashboard': 'Overview',
  'nav.servers': 'Servers',
  'nav.billing': 'Billing',
  'nav.settings': 'Settings',
  'login.hero.title': 'Your servers. One panel.',
  'login.hero.text': 'Sign in to manage your servers.',
  'servers.count': '{count} servers',
  'servers.status.running': 'Running',
  'servers.status.stopped': 'Stopped',
  'servers.rename.title': 'Rename server {name}',
  'servers.delete.text': 'The server {name} is deleted.\nThis cannot be undone.',
  'billing.invoice.title': 'Invoice {number}',
  'billing.invoice.paid': 'Invoice {number} is paid.',
  'billing.invoice.status.invoiced': 'Invoiced',
  'billing.invoice.total': 'Total {amount}',
  'mail.greeting': 'Kind regards',
  'mail.signature': 'Your weblion.one team',
  'help.link': 'More at https://weblion.one/help',
  'help.contact': 'Write to support@weblion.one',
  'help.notice': 'The notice is at ai.notice.text.',
};

const CORE_FR: Texts = {
  'common.save': 'Enregistrer',
  'common.cancel': 'Annuler',
  'nav.servers': 'Serveurs',
  'billing.invoice.title': 'Facture {number}',
  'billing.invoice.status.invoiced': 'Facturé',
  // Stale: its stamp names an older German text (see STALE).
  'servers.status.running': 'En marche',
};

const CORE_IT: Texts = {
  'common.save': 'Salva',
  'nav.servers': 'Server',
};

const CORE_NL: Texts = {
  'common.save': 'Opslaan',
};

const ADMIN_DE: Texts = {
  'admin.ai.title': 'KI',
  'admin.ai.subtitle': 'Claude für die Konsole einrichten.',
  'admin.users.title': 'Benutzer',
};
const ADMIN_EN: Texts = {
  'admin.ai.title': 'AI',
  'admin.ai.subtitle': 'Set up Claude for the console.',
  'admin.users.title': 'Users',
};

const AI_DE: Texts = {
  'ai.notice.title': 'Datenschutzhinweis',
  'ai.notice.text': 'Ihre Anfrage wird an Claude von Anthropic gesendet.',
  'ai.assistant.title': 'KI-Assistent',
  'ai.assistant.placeholder': 'Fragen Sie etwas zu {org}',
};
const AI_EN: Texts = {
  'ai.notice.title': 'Privacy notice',
  'ai.notice.text': 'Your request is sent to Claude by Anthropic.',
  'ai.assistant.title': 'AI assistant',
  'ai.assistant.placeholder': 'Ask something about {org}',
};
const AI_FR: Texts = {
  'ai.notice.title': 'Avis de confidentialité',
};

const EMAIL_DE: Texts = {
  'email.invitation.subject': 'Einladung zu {org}',
  'email.invitation.text': 'Hallo {name}\nSie wurden eingeladen.',
};
const EMAIL_EN: Texts = {
  'email.invitation.subject': 'Invitation to {org}',
  'email.invitation.text': 'Hello {name}\nYou were invited.',
};

/** Keys whose compiled fr value is stamped against another German text. */
export const STALE_FR = ['servers.status.running'] as const;

export interface TestCatalogOptions {
  /** More German keys per section (with English as `EN <German>` unless given). */
  extra?: Partial<Record<SectionName, { de: Texts; en?: Texts }>>;
}

/** The section texts of the test catalog. */
export function testSources(options: TestCatalogOptions = {}): CatalogSources {
  const sources: Record<string, Partial<Record<Locale, Texts>>> = {
    core: {
      de: { ...CORE_DE },
      en: { ...CORE_EN },
      fr: { ...CORE_FR },
      it: { ...CORE_IT },
      nl: { ...CORE_NL },
    },
    admin: { de: { ...ADMIN_DE }, en: { ...ADMIN_EN } },
    ai: { de: { ...AI_DE }, en: { ...AI_EN }, fr: { ...AI_FR } },
    email: { de: { ...EMAIL_DE }, en: { ...EMAIL_EN } },
  };
  for (const [section, texts] of Object.entries(options.extra ?? {})) {
    const target = (sources[section] ??= { de: {}, en: {} });
    Object.assign(target.de!, texts!.de);
    target.en ??= {};
    for (const [key, de] of Object.entries(texts!.de)) target.en[key] = texts!.en?.[key] ?? `EN ${de}`;
  }
  return sources as CatalogSources;
}

/** Stamps for every compiled translation, current except STALE_FR. */
export function testStamps(sources: CatalogSources): Partial<StampFiles> {
  const stamps = {} as Record<TargetLocale, Partial<Record<SectionName, Record<string, Stamp>>>>;
  for (const locale of TARGET_LOCALES) {
    stamps[locale] = {};
    for (const [section, texts] of Object.entries(sources) as [
      SectionName,
      Partial<Record<Locale, Texts>>,
    ][]) {
      const file: Record<string, Stamp> = {};
      for (const [key, value] of Object.entries(texts[locale] ?? {})) {
        const de = texts.de?.[key] ?? '';
        const stale = locale === 'fr' && (STALE_FR as readonly string[]).includes(key);
        file[key] = [sourceHash(stale ? 'Läuft gerade' : de), sourceHash(value)];
      }
      stamps[locale][section] = file;
    }
  }
  return stamps;
}

/** The test catalog (buildCatalog with the fixture sources and stamps). */
export function testCatalog(options: TestCatalogOptions = {}): I18nCatalog {
  const sources = testSources(options);
  return buildCatalog(sources, testStamps(sources));
}
