import type { TranslationKey } from './types';
import { coreNl } from './sections/core.nl';
import { adminNl } from './sections/admin.nl';
import { aiNl } from './sections/ai.nl';
import { translationsNl } from './sections/translations.nl';
import { hostingNl } from './sections/hosting.nl';
import { cloudflareNl } from './sections/cloudflare.nl';
import { websitesNl } from './sections/websites.nl';
import { mailNl } from './sections/mail.nl';
import { billingNl } from './sections/billing.nl';
import { cloudNl } from './sections/cloud.nl';
import { storageNl } from './sections/storage.nl';
import { phoneNl } from './sections/phone.nl';
import { mediaNl } from './sections/media.nl';
import { uptimeNl } from './sections/uptime.nl';

/** Marker for the build check of the locale chunks (i18n 5.4); the loader reads it, so it stays in the chunk. */
export const I18N_CHUNK = 'wl-i18n-chunk:nl';

/** Dutch, partial: missing keys fall back to English (fallbackChain). */
export const nl: Partial<Record<TranslationKey, string>> = {
  ...coreNl,
  ...adminNl,
  ...aiNl,
  ...translationsNl,
  ...hostingNl,
  ...cloudflareNl,
  ...websitesNl,
  ...mailNl,
  ...billingNl,
  ...cloudNl,
  ...storageNl,
  ...phoneNl,
  ...mediaNl,
  ...uptimeNl,
};
