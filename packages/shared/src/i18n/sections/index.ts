/**
 * The 16 dictionary sections (i18n 3.2). A section is a pair of files `<section>.<locale>.ts` per locale; the
 * order here is the German key order of the catalog, the stamp files and the translation admin.
 */
export const SECTIONS = [
  'core',
  'admin',
  'ai',
  'translations',
  'email',
  'pdf',
  'hosting',
  'cloudflare',
  'websites',
  'mail',
  'billing',
  'cloud',
  'storage',
  'phone',
  'media',
  'uptime',
] as const;

/** Texts only the API renders (e-mails, invoice PDF). No web aggregator includes them (O33). */
export const SERVER_ONLY_SECTIONS = ['email', 'pdf'] as const;

type Section = (typeof SECTIONS)[number];
type ServerOnlySection = (typeof SERVER_ONLY_SECTIONS)[number];
export type WebSection = Exclude<Section, ServerOnlySection>;

/** The 14 sections of the web aggregators, in SECTIONS order. */
export const WEB_SECTIONS: readonly WebSection[] = SECTIONS.filter(
  (s): s is WebSection => !(SERVER_ONLY_SECTIONS as readonly string[]).includes(s),
);

/** Translation groups of plan 7.1 (units T-<locale>-<group>, allowlist files allowlists/<locale>/<group>.ts). */
export const SECTION_GROUPS: Record<'a' | 'b' | 'c', readonly Section[]> = {
  a: ['core', 'admin', 'ai', 'translations', 'email', 'pdf'],
  b: ['hosting', 'cloudflare', 'websites', 'mail'],
  c: ['billing', 'cloud', 'storage', 'phone', 'media', 'uptime'],
};
export type SectionGroup = keyof typeof SECTION_GROUPS;
