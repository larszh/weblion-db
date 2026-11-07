import type { TranslationKey } from './types';
import { coreIt } from './sections/core.it';
import { adminIt } from './sections/admin.it';
import { aiIt } from './sections/ai.it';
import { translationsIt } from './sections/translations.it';
import { hostingIt } from './sections/hosting.it';
import { cloudflareIt } from './sections/cloudflare.it';
import { websitesIt } from './sections/websites.it';
import { mailIt } from './sections/mail.it';
import { billingIt } from './sections/billing.it';
import { cloudIt } from './sections/cloud.it';
import { storageIt } from './sections/storage.it';
import { phoneIt } from './sections/phone.it';
import { mediaIt } from './sections/media.it';
import { uptimeIt } from './sections/uptime.it';

/** Marker for the build check of the locale chunks (i18n 5.4); the loader reads it, so it stays in the chunk. */
export const I18N_CHUNK = 'wl-i18n-chunk:it';

/** Italian, partial: missing keys fall back to English (fallbackChain). */
export const it: Partial<Record<TranslationKey, string>> = {
  ...coreIt,
  ...adminIt,
  ...aiIt,
  ...translationsIt,
  ...hostingIt,
  ...cloudflareIt,
  ...websitesIt,
  ...mailIt,
  ...billingIt,
  ...cloudIt,
  ...storageIt,
  ...phoneIt,
  ...mediaIt,
  ...uptimeIt,
};
