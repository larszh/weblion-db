import { coreDe } from './sections/core.de';
import { adminDe } from './sections/admin.de';
import { aiDe } from './sections/ai.de';
import { translationsDe } from './sections/translations.de';
import { hostingDe } from './sections/hosting.de';
import { cloudflareDe } from './sections/cloudflare.de';
import { websitesDe } from './sections/websites.de';
import { mailDe } from './sections/mail.de';
import { billingDe } from './sections/billing.de';
import { cloudDe } from './sections/cloud.de';
import { storageDe } from './sections/storage.de';
import { phoneDe } from './sections/phone.de';
import { mediaDe } from './sections/media.de';
import { uptimeDe } from './sections/uptime.de';

/** Marker for the build check of the locale chunks (i18n 5.4); the loader reads it, so it stays in the chunk. */
export const I18N_CHUNK = 'wl-i18n-chunk:de';

/** German, the source: every web key (14 sections, no email and no pdf, plan O33). */
export const de = {
  ...coreDe,
  ...adminDe,
  ...aiDe,
  ...translationsDe,
  ...hostingDe,
  ...cloudflareDe,
  ...websitesDe,
  ...mailDe,
  ...billingDe,
  ...cloudDe,
  ...storageDe,
  ...phoneDe,
  ...mediaDe,
  ...uptimeDe,
} as const;
