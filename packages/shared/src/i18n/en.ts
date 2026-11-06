import type { TranslationKey } from './types';
import { coreEn } from './sections/core.en';
import { adminEn } from './sections/admin.en';
import { aiEn } from './sections/ai.en';
import { translationsEn } from './sections/translations.en';
import { hostingEn } from './sections/hosting.en';
import { cloudflareEn } from './sections/cloudflare.en';
import { websitesEn } from './sections/websites.en';
import { mailEn } from './sections/mail.en';
import { billingEn } from './sections/billing.en';
import { cloudEn } from './sections/cloud.en';
import { storageEn } from './sections/storage.en';
import { phoneEn } from './sections/phone.en';
import { mediaEn } from './sections/media.en';
import { uptimeEn } from './sections/uptime.en';

/** Marker for the build check of the locale chunks (i18n 5.4); the loader reads it, so it stays in the chunk. */
export const I18N_CHUNK = 'wl-i18n-chunk:en';

/** English, complete by type: a missing key fails the typecheck. */
export const en: Record<TranslationKey, string> = {
  ...coreEn,
  ...adminEn,
  ...aiEn,
  ...translationsEn,
  ...hostingEn,
  ...cloudflareEn,
  ...websitesEn,
  ...mailEn,
  ...billingEn,
  ...cloudEn,
  ...storageEn,
  ...phoneEn,
  ...mediaEn,
  ...uptimeEn,
};
