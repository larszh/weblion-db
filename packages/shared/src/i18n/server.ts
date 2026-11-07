import type { Locale } from './locales';
import type { SectionName, ServerTranslationKey } from './types';
import { de } from './de';
import { en } from './en';
import { fr } from './fr';
import { it } from './it';
import { nl } from './nl';
import { coreDe } from './sections/core.de';
import { coreEn } from './sections/core.en';
import { coreFr } from './sections/core.fr';
import { coreIt } from './sections/core.it';
import { coreNl } from './sections/core.nl';
import { adminDe } from './sections/admin.de';
import { adminEn } from './sections/admin.en';
import { adminFr } from './sections/admin.fr';
import { adminIt } from './sections/admin.it';
import { adminNl } from './sections/admin.nl';
import { aiDe } from './sections/ai.de';
import { aiEn } from './sections/ai.en';
import { aiFr } from './sections/ai.fr';
import { aiIt } from './sections/ai.it';
import { aiNl } from './sections/ai.nl';
import { translationsDe } from './sections/translations.de';
import { translationsEn } from './sections/translations.en';
import { translationsFr } from './sections/translations.fr';
import { translationsIt } from './sections/translations.it';
import { translationsNl } from './sections/translations.nl';
import { emailDe } from './sections/email.de';
import { emailEn } from './sections/email.en';
import { emailFr } from './sections/email.fr';
import { emailIt } from './sections/email.it';
import { emailNl } from './sections/email.nl';
import { pdfDe } from './sections/pdf.de';
import { pdfEn } from './sections/pdf.en';
import { pdfFr } from './sections/pdf.fr';
import { pdfIt } from './sections/pdf.it';
import { pdfNl } from './sections/pdf.nl';
import { hostingDe } from './sections/hosting.de';
import { hostingEn } from './sections/hosting.en';
import { hostingFr } from './sections/hosting.fr';
import { hostingIt } from './sections/hosting.it';
import { hostingNl } from './sections/hosting.nl';
import { cloudflareDe } from './sections/cloudflare.de';
import { cloudflareEn } from './sections/cloudflare.en';
import { cloudflareFr } from './sections/cloudflare.fr';
import { cloudflareIt } from './sections/cloudflare.it';
import { cloudflareNl } from './sections/cloudflare.nl';
import { websitesDe } from './sections/websites.de';
import { websitesEn } from './sections/websites.en';
import { websitesFr } from './sections/websites.fr';
import { websitesIt } from './sections/websites.it';
import { websitesNl } from './sections/websites.nl';
import { mailDe } from './sections/mail.de';
import { mailEn } from './sections/mail.en';
import { mailFr } from './sections/mail.fr';
import { mailIt } from './sections/mail.it';
import { mailNl } from './sections/mail.nl';
import { billingDe } from './sections/billing.de';
import { billingEn } from './sections/billing.en';
import { billingFr } from './sections/billing.fr';
import { billingIt } from './sections/billing.it';
import { billingNl } from './sections/billing.nl';
import { cloudDe } from './sections/cloud.de';
import { cloudEn } from './sections/cloud.en';
import { cloudFr } from './sections/cloud.fr';
import { cloudIt } from './sections/cloud.it';
import { cloudNl } from './sections/cloud.nl';
import { storageDe } from './sections/storage.de';
import { storageEn } from './sections/storage.en';
import { storageFr } from './sections/storage.fr';
import { storageIt } from './sections/storage.it';
import { storageNl } from './sections/storage.nl';
import { phoneDe } from './sections/phone.de';
import { phoneEn } from './sections/phone.en';
import { phoneFr } from './sections/phone.fr';
import { phoneIt } from './sections/phone.it';
import { phoneNl } from './sections/phone.nl';
import { mediaDe } from './sections/media.de';
import { mediaEn } from './sections/media.en';
import { mediaFr } from './sections/media.fr';
import { mediaIt } from './sections/media.it';
import { mediaNl } from './sections/media.nl';
import { uptimeDe } from './sections/uptime.de';
import { uptimeEn } from './sections/uptime.en';
import { uptimeFr } from './sections/uptime.fr';
import { uptimeIt } from './sections/uptime.it';
import { uptimeNl } from './sections/uptime.nl';

/**
 * Dictionaries of the API: the web aggregators plus the server-only sections email and pdf (plan O33). Never
 * imported by the web (lib/i18n-imports.test.ts, U2).
 */
export const serverDe = { ...de, ...emailDe, ...pdfDe } as const;
export const serverEn: Record<ServerTranslationKey, string> = { ...en, ...emailEn, ...pdfEn };
export const serverFr: Partial<Record<ServerTranslationKey, string>> = { ...fr, ...emailFr, ...pdfFr };
export const serverIt: Partial<Record<ServerTranslationKey, string>> = { ...it, ...emailIt, ...pdfIt };
export const serverNl: Partial<Record<ServerTranslationKey, string>> = { ...nl, ...emailNl, ...pdfNl };

/** fr, it and nl section files are partial; their values are strings wherever a key is present. */
const texts = (section: object): Readonly<Record<string, string>> =>
  section as Readonly<Record<string, string>>;

/** Every section in every locale, for the catalog, the stamp script and the report. */
export const SECTION_SOURCES: Record<SectionName, Record<Locale, Readonly<Record<string, string>>>> = {
  core: { de: texts(coreDe), en: texts(coreEn), fr: texts(coreFr), it: texts(coreIt), nl: texts(coreNl) },
  admin: {
    de: texts(adminDe),
    en: texts(adminEn),
    fr: texts(adminFr),
    it: texts(adminIt),
    nl: texts(adminNl),
  },
  ai: { de: texts(aiDe), en: texts(aiEn), fr: texts(aiFr), it: texts(aiIt), nl: texts(aiNl) },
  translations: {
    de: texts(translationsDe),
    en: texts(translationsEn),
    fr: texts(translationsFr),
    it: texts(translationsIt),
    nl: texts(translationsNl),
  },
  email: {
    de: texts(emailDe),
    en: texts(emailEn),
    fr: texts(emailFr),
    it: texts(emailIt),
    nl: texts(emailNl),
  },
  pdf: { de: texts(pdfDe), en: texts(pdfEn), fr: texts(pdfFr), it: texts(pdfIt), nl: texts(pdfNl) },
  hosting: {
    de: texts(hostingDe),
    en: texts(hostingEn),
    fr: texts(hostingFr),
    it: texts(hostingIt),
    nl: texts(hostingNl),
  },
  cloudflare: {
    de: texts(cloudflareDe),
    en: texts(cloudflareEn),
    fr: texts(cloudflareFr),
    it: texts(cloudflareIt),
    nl: texts(cloudflareNl),
  },
  websites: {
    de: texts(websitesDe),
    en: texts(websitesEn),
    fr: texts(websitesFr),
    it: texts(websitesIt),
    nl: texts(websitesNl),
  },
  mail: { de: texts(mailDe), en: texts(mailEn), fr: texts(mailFr), it: texts(mailIt), nl: texts(mailNl) },
  billing: {
    de: texts(billingDe),
    en: texts(billingEn),
    fr: texts(billingFr),
    it: texts(billingIt),
    nl: texts(billingNl),
  },
  cloud: {
    de: texts(cloudDe),
    en: texts(cloudEn),
    fr: texts(cloudFr),
    it: texts(cloudIt),
    nl: texts(cloudNl),
  },
  storage: {
    de: texts(storageDe),
    en: texts(storageEn),
    fr: texts(storageFr),
    it: texts(storageIt),
    nl: texts(storageNl),
  },
  phone: {
    de: texts(phoneDe),
    en: texts(phoneEn),
    fr: texts(phoneFr),
    it: texts(phoneIt),
    nl: texts(phoneNl),
  },
  media: {
    de: texts(mediaDe),
    en: texts(mediaEn),
    fr: texts(mediaFr),
    it: texts(mediaIt),
    nl: texts(mediaNl),
  },
  uptime: {
    de: texts(uptimeDe),
    en: texts(uptimeEn),
    fr: texts(uptimeFr),
    it: texts(uptimeIt),
    nl: texts(uptimeNl),
  },
};
