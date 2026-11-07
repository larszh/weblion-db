import type { TranslationKey } from './types';
import { coreFr } from './sections/core.fr';
import { adminFr } from './sections/admin.fr';
import { aiFr } from './sections/ai.fr';
import { translationsFr } from './sections/translations.fr';
import { hostingFr } from './sections/hosting.fr';
import { cloudflareFr } from './sections/cloudflare.fr';
import { websitesFr } from './sections/websites.fr';
import { mailFr } from './sections/mail.fr';
import { billingFr } from './sections/billing.fr';
import { cloudFr } from './sections/cloud.fr';
import { storageFr } from './sections/storage.fr';
import { phoneFr } from './sections/phone.fr';
import { mediaFr } from './sections/media.fr';
import { uptimeFr } from './sections/uptime.fr';

/** Marker for the build check of the locale chunks (i18n 5.4); the loader reads it, so it stays in the chunk. */
export const I18N_CHUNK = 'wl-i18n-chunk:fr';

/** French, partial: missing keys fall back to English (fallbackChain). */
export const fr: Partial<Record<TranslationKey, string>> = {
  ...coreFr,
  ...adminFr,
  ...aiFr,
  ...translationsFr,
  ...hostingFr,
  ...cloudflareFr,
  ...websitesFr,
  ...mailFr,
  ...billingFr,
  ...cloudFr,
  ...storageFr,
  ...phoneFr,
  ...mediaFr,
  ...uptimeFr,
};
