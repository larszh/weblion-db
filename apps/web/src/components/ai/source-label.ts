import type { TranslationKey } from '@weblion/shared';
import type { TFunction } from '@/lib/i18n';

/**
 * The label of a console source in the assistant. A list tool (list_domains, get_billing_overview and so on)
 * sends no title, and the API falls back to the path, so a link read "/o/muster-ag/domains". Such a path to a
 * section page of an organization gets the section's navigation label in the viewer's language instead.
 */
const SECTION_LABELS: Record<string, TranslationKey> = {
  servers: 'nav.servers',
  domains: 'nav.domains',
  webhosting: 'nav.webhosting',
  mail: 'nav.mail',
  monitoring: 'nav.uptime',
  billing: 'nav.billing',
  audit: 'nav.audit',
  cloud: 'nav.cloud',
  phone: 'nav.phone',
  media: 'nav.media',
};

export function sourceLabel(source: { label: string; path: string }, t: TFunction): string {
  if (source.label !== source.path) return source.label;
  const section = /^\/o\/[^/?]+\/([a-z]+)\/?$/.exec(source.path)?.[1];
  const key = section ? SECTION_LABELS[section] : undefined;
  return key ? t(key) : source.label;
}
