import { LOCALES, TARGET_LOCALES, type Locale, type TargetLocale } from './locales';
import { SECTIONS, SERVER_ONLY_SECTIONS } from './sections';
import { SECTION_SOURCES } from './server';
import type { SectionName, ServerTranslationKey } from './types';
// The 64 stamp files (i18n 4.2), imported statically: the set never changes at runtime, every file exists from
// the foundation on (fr, it and nl start as {}), and the API bundler inlines them.
import enCoreStamps from './stamps/en/core.json';
import enAdminStamps from './stamps/en/admin.json';
import enAiStamps from './stamps/en/ai.json';
import enTranslationsStamps from './stamps/en/translations.json';
import enEmailStamps from './stamps/en/email.json';
import enPdfStamps from './stamps/en/pdf.json';
import enHostingStamps from './stamps/en/hosting.json';
import enCloudflareStamps from './stamps/en/cloudflare.json';
import enWebsitesStamps from './stamps/en/websites.json';
import enMailStamps from './stamps/en/mail.json';
import enBillingStamps from './stamps/en/billing.json';
import enCloudStamps from './stamps/en/cloud.json';
import enStorageStamps from './stamps/en/storage.json';
import enPhoneStamps from './stamps/en/phone.json';
import enMediaStamps from './stamps/en/media.json';
import enUptimeStamps from './stamps/en/uptime.json';
import frCoreStamps from './stamps/fr/core.json';
import frAdminStamps from './stamps/fr/admin.json';
import frAiStamps from './stamps/fr/ai.json';
import frTranslationsStamps from './stamps/fr/translations.json';
import frEmailStamps from './stamps/fr/email.json';
import frPdfStamps from './stamps/fr/pdf.json';
import frHostingStamps from './stamps/fr/hosting.json';
import frCloudflareStamps from './stamps/fr/cloudflare.json';
import frWebsitesStamps from './stamps/fr/websites.json';
import frMailStamps from './stamps/fr/mail.json';
import frBillingStamps from './stamps/fr/billing.json';
import frCloudStamps from './stamps/fr/cloud.json';
import frStorageStamps from './stamps/fr/storage.json';
import frPhoneStamps from './stamps/fr/phone.json';
import frMediaStamps from './stamps/fr/media.json';
import frUptimeStamps from './stamps/fr/uptime.json';
import itCoreStamps from './stamps/it/core.json';
import itAdminStamps from './stamps/it/admin.json';
import itAiStamps from './stamps/it/ai.json';
import itTranslationsStamps from './stamps/it/translations.json';
import itEmailStamps from './stamps/it/email.json';
import itPdfStamps from './stamps/it/pdf.json';
import itHostingStamps from './stamps/it/hosting.json';
import itCloudflareStamps from './stamps/it/cloudflare.json';
import itWebsitesStamps from './stamps/it/websites.json';
import itMailStamps from './stamps/it/mail.json';
import itBillingStamps from './stamps/it/billing.json';
import itCloudStamps from './stamps/it/cloud.json';
import itStorageStamps from './stamps/it/storage.json';
import itPhoneStamps from './stamps/it/phone.json';
import itMediaStamps from './stamps/it/media.json';
import itUptimeStamps from './stamps/it/uptime.json';
import nlCoreStamps from './stamps/nl/core.json';
import nlAdminStamps from './stamps/nl/admin.json';
import nlAiStamps from './stamps/nl/ai.json';
import nlTranslationsStamps from './stamps/nl/translations.json';
import nlEmailStamps from './stamps/nl/email.json';
import nlPdfStamps from './stamps/nl/pdf.json';
import nlHostingStamps from './stamps/nl/hosting.json';
import nlCloudflareStamps from './stamps/nl/cloudflare.json';
import nlWebsitesStamps from './stamps/nl/websites.json';
import nlMailStamps from './stamps/nl/mail.json';
import nlBillingStamps from './stamps/nl/billing.json';
import nlCloudStamps from './stamps/nl/cloud.json';
import nlStorageStamps from './stamps/nl/storage.json';
import nlPhoneStamps from './stamps/nl/phone.json';
import nlMediaStamps from './stamps/nl/media.json';
import nlUptimeStamps from './stamps/nl/uptime.json';

/** [hash of the German text the translation was written against, hash of the translation when stamped] (i18n 4.2). */
export type Stamp = readonly [sourceHash: string, valueHash: string];
export type StampFiles = Record<TargetLocale, Partial<Record<SectionName, Readonly<Record<string, Stamp>>>>>;

/** Section texts per locale as buildCatalog takes them; tests pass a few sections only. */
export type CatalogSources = Partial<
  Record<SectionName, Partial<Record<Locale, Readonly<Record<string, string | undefined>>>>>
>;

/** The immutable view of every compiled text the API works with (I18nService, filters, scripts). */
export interface I18nCatalog {
  /** Every key in German order: section by section in SECTIONS order, inside a section in file order. */
  keys: readonly ServerTranslationKey[];
  sections: readonly SectionName[];
  sectionOf(key: string): SectionName | undefined;
  has(key: string): key is ServerTranslationKey;
  /** Compiled values per locale (de and en complete, the others partial). */
  bundles: Record<Locale, Readonly<Partial<Record<ServerTranslationKey, string>>>>;
  stamps: Record<TargetLocale, Readonly<Partial<Record<ServerTranslationKey, Stamp>>>>;
  /** Keys of the sections email and pdf; never sent to the web (i18n 13). */
  serverOnly: ReadonlySet<string>;
}

type RawStampFile = Readonly<Record<string, readonly string[]>>;

const RAW_STAMPS: Record<TargetLocale, Record<SectionName, RawStampFile>> = {
  en: {
    core: enCoreStamps,
    admin: enAdminStamps,
    ai: enAiStamps,
    translations: enTranslationsStamps,
    email: enEmailStamps,
    pdf: enPdfStamps,
    hosting: enHostingStamps,
    cloudflare: enCloudflareStamps,
    websites: enWebsitesStamps,
    mail: enMailStamps,
    billing: enBillingStamps,
    cloud: enCloudStamps,
    storage: enStorageStamps,
    phone: enPhoneStamps,
    media: enMediaStamps,
    uptime: enUptimeStamps,
  },
  fr: {
    core: frCoreStamps,
    admin: frAdminStamps,
    ai: frAiStamps,
    translations: frTranslationsStamps,
    email: frEmailStamps,
    pdf: frPdfStamps,
    hosting: frHostingStamps,
    cloudflare: frCloudflareStamps,
    websites: frWebsitesStamps,
    mail: frMailStamps,
    billing: frBillingStamps,
    cloud: frCloudStamps,
    storage: frStorageStamps,
    phone: frPhoneStamps,
    media: frMediaStamps,
    uptime: frUptimeStamps,
  },
  it: {
    core: itCoreStamps,
    admin: itAdminStamps,
    ai: itAiStamps,
    translations: itTranslationsStamps,
    email: itEmailStamps,
    pdf: itPdfStamps,
    hosting: itHostingStamps,
    cloudflare: itCloudflareStamps,
    websites: itWebsitesStamps,
    mail: itMailStamps,
    billing: itBillingStamps,
    cloud: itCloudStamps,
    storage: itStorageStamps,
    phone: itPhoneStamps,
    media: itMediaStamps,
    uptime: itUptimeStamps,
  },
  nl: {
    core: nlCoreStamps,
    admin: nlAdminStamps,
    ai: nlAiStamps,
    translations: nlTranslationsStamps,
    email: nlEmailStamps,
    pdf: nlPdfStamps,
    hosting: nlHostingStamps,
    cloudflare: nlCloudflareStamps,
    websites: nlWebsitesStamps,
    mail: nlMailStamps,
    billing: nlBillingStamps,
    cloud: nlCloudStamps,
    storage: nlStorageStamps,
    phone: nlPhoneStamps,
    media: nlMediaStamps,
    uptime: nlUptimeStamps,
  },
};

/** Checks the shape of one stamp file: every value a pair of hex hashes. */
function stampFile(
  locale: TargetLocale,
  section: SectionName,
  raw: RawStampFile,
): Readonly<Record<string, Stamp>> {
  const out: Record<string, Stamp> = {};
  for (const [key, pair] of Object.entries(raw)) {
    const [sourceHash, valueHash] = pair;
    if (pair.length !== 2 || typeof sourceHash !== 'string' || typeof valueHash !== 'string') {
      throw new Error(`stamps/${locale}/${section}.json: the stamp of ${key} is not a pair of hashes`);
    }
    out[key] = [sourceHash, valueHash];
  }
  return out;
}

/** The stamp files of the repository, validated. */
export function repositoryStamps(): StampFiles {
  const result = {} as StampFiles;
  for (const locale of TARGET_LOCALES) {
    result[locale] = {};
    for (const section of SECTIONS)
      result[locale][section] = stampFile(locale, section, RAW_STAMPS[locale][section]);
  }
  return result;
}

/**
 * Builds a catalog. The defaults are the repository sections and the 64 stamp files. Keys a section of another
 * locale has but German does not are left out (check 1 reports them); a key defined in two sections belongs to
 * the first one (check 1 reports it too).
 */
export function buildCatalog(
  sources: CatalogSources = SECTION_SOURCES,
  stamps: Partial<StampFiles> = repositoryStamps(),
): I18nCatalog {
  const keys: string[] = [];
  const sectionByKey = new Map<string, SectionName>();
  const sections: SectionName[] = [];
  const bundles = Object.fromEntries(LOCALES.map((l) => [l, {}])) as Record<Locale, Record<string, string>>;
  const stampMaps = Object.fromEntries(TARGET_LOCALES.map((l) => [l, {}])) as Record<
    TargetLocale,
    Record<string, Stamp>
  >;
  const serverOnly = new Set<string>();

  for (const section of SECTIONS) {
    const texts = sources[section];
    const german = texts?.de;
    if (!texts || !german) continue;
    sections.push(section);
    const own: string[] = [];
    for (const [key, value] of Object.entries(german)) {
      if (typeof value !== 'string' || sectionByKey.has(key)) continue;
      sectionByKey.set(key, section);
      keys.push(key);
      own.push(key);
      if ((SERVER_ONLY_SECTIONS as readonly string[]).includes(section)) serverOnly.add(key);
    }
    for (const locale of LOCALES) {
      const values = texts[locale];
      if (!values) continue;
      for (const key of own) {
        const value = values[key];
        if (typeof value === 'string') bundles[locale][key] = value;
      }
    }
    for (const locale of TARGET_LOCALES) {
      const file = stamps[locale]?.[section];
      if (!file) continue;
      for (const key of own) {
        const stamp = file[key];
        if (stamp) stampMaps[locale][key] = stamp;
      }
    }
  }

  return {
    keys: keys as ServerTranslationKey[],
    sections,
    sectionOf: (key) => sectionByKey.get(key),
    has: (key): key is ServerTranslationKey => sectionByKey.has(key),
    bundles,
    stamps: stampMaps,
    serverOnly,
  };
}

let cached: I18nCatalog | null = null;

/** buildCatalog() once, memoized. */
export function loadCatalog(): I18nCatalog {
  cached ??= buildCatalog();
  return cached;
}
