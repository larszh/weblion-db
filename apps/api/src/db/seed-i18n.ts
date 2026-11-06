import { asc, eq } from 'drizzle-orm';
import type { Locale, ServerTranslationKey } from '@weblion/shared';
import { loadCatalog } from '@weblion/shared/i18n/catalog';
import { sourceHash } from '../i18n/hash';
import type { Database } from './client';
import { translationOverrides, users } from './schema';

/**
 * The three overrides of a fresh demo database (i18n 21.3): one per state the translation admin shows, so the
 * badges and filters have something to show before anyone edits a text. Not demo rows (demo = false): they are
 * seed data, not results of a demo job, so saving a real key keeps them.
 */
const DEMO_OVERRIDES: {
  key: ServerTranslationKey;
  locale: Locale;
  value: string;
  origin: 'manual' | 'ai';
  reviewed: boolean;
  /** The German text the value counts as written against; null = the current one. */
  writtenAgainst: string | null;
}[] = [
  // "Manuell", current. Each value differs from the compiled text, or "Aufräumen" would count it as already in the
  // code and delete the example.
  {
    key: 'common.save',
    locale: 'fr',
    value: 'Sauvegarder',
    origin: 'manual',
    reviewed: true,
    writtenAgainst: null,
  },
  // "KI, ungeprüft", listed by the filter "Ungeprüft".
  {
    key: 'nav.billing',
    locale: 'it',
    value: 'Fatture',
    origin: 'ai',
    reviewed: false,
    writtenAgainst: null,
  },
  // "Veraltet": written against an older German text, until someone confirms it.
  {
    key: 'login.hero.title',
    locale: 'nl',
    value: 'Uw servers. Eén panel.',
    origin: 'manual',
    reviewed: true,
    writtenAgainst: 'Ihre Server. Ein Dashboard.',
  },
];

/** Inserts the demo overrides that are missing (`on conflict do nothing`), as the bootstrap admin when one exists. */
export async function insertI18nDemo(db: Database): Promise<void> {
  const catalog = loadCatalog();
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.platformRole, 'superadmin'))
    .orderBy(asc(users.createdAt))
    .limit(1);
  const rows = DEMO_OVERRIDES.filter((o) => catalog.has(o.key)).map((o) => ({
    key: o.key,
    locale: o.locale,
    value: o.value,
    origin: o.origin,
    reviewed: o.reviewed,
    sourceHash: sourceHash(o.writtenAgainst ?? catalog.bundles.de[o.key] ?? o.key),
    demo: false,
    updatedBy: admin?.id ?? null,
  }));
  if (rows.length === 0) return;
  await db.insert(translationOverrides).values(rows).onConflictDoNothing();
}

/**
 * Demo data of the translation admin, called at the end of seedDemo. The test suites seed every database through
 * seedDemo as well, so they start with these rows; a test that asserts the exact override rows it wrote empties
 * the table first.
 */
export async function seedI18nDemo(db: Database): Promise<void> {
  await insertI18nDemo(db);
}
