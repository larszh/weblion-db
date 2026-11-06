import { and, eq } from 'drizzle-orm';
import type { Locale, TranslationCleanupInput, TranslationCleanupResultDto } from '@weblion/shared';
import type { DbOrTx } from '../db/client';
import { translationOverrides } from '../db/schema';
import type { I18nService } from './service';

/**
 * Writes of translation_overrides (i18n 14.2). Every caller runs ctx.i18n.reload() after its transaction
 * committed, so the change is live at once on this instance and within 15 s on the others.
 */

/** Inserts or replaces the override of one cell. */
export async function saveOverride(
  tx: DbOrTx,
  input: {
    key: string;
    locale: Locale;
    value: string;
    origin: 'manual' | 'ai';
    reviewed: boolean;
    sourceHash: string;
    demo?: boolean;
    userId: string | null;
  },
): Promise<void> {
  const values = {
    value: input.value,
    origin: input.origin,
    reviewed: input.reviewed,
    sourceHash: input.sourceHash,
    demo: input.demo ?? false,
    updatedBy: input.userId,
    // Set explicitly on update too: the refresh signature of I18nService compares max(updated_at).
    updatedAt: new Date(),
  };
  await tx
    .insert(translationOverrides)
    .values({ key: input.key, locale: input.locale, ...values })
    .onConflictDoUpdate({ target: [translationOverrides.key, translationOverrides.locale], set: values });
}

/** Deletes the override; false when there was none. */
export async function revertOverride(tx: DbOrTx, key: string, locale: Locale): Promise<boolean> {
  const rows = await tx
    .delete(translationOverrides)
    .where(and(eq(translationOverrides.key, key), eq(translationOverrides.locale, locale)))
    .returning({ key: translationOverrides.key });
  return rows.length > 0;
}

/** false when there is no override. */
export async function setReviewed(
  tx: DbOrTx,
  key: string,
  locale: Locale,
  reviewed: boolean,
  userId: string,
): Promise<boolean> {
  const rows = await tx
    .update(translationOverrides)
    .set({ reviewed, updatedBy: userId, updatedAt: new Date() })
    .where(and(eq(translationOverrides.key, key), eq(translationOverrides.locale, locale)))
    .returning({ key: translationOverrides.key });
  return rows.length > 0;
}

/** A7 (i18n 14.2): 409 not_stale when the cell is current. U1 implements it. */
export async function confirmCurrent(
  _tx: DbOrTx,
  _i18n: I18nService,
  _key: string,
  _locale: Locale,
  _userId: string,
): Promise<void> {
  throw new Error('not implemented');
}

/** A8 (i18n 14.2). U1 implements it. */
export async function cleanup(
  _tx: DbOrTx,
  _i18n: I18nService,
  _input: TranslationCleanupInput,
): Promise<TranslationCleanupResultDto> {
  throw new Error('not implemented');
}

/**
 * In the transaction of PUT /admin/ai/key (ai 5.4, plan O11): with a real key the demo emulator is gone, so
 * its pseudo translations must not stay. Returns the number of rows deleted.
 */
export async function deleteDemoOverrides(tx: DbOrTx): Promise<number> {
  const rows = await tx
    .delete(translationOverrides)
    .where(eq(translationOverrides.demo, true))
    .returning({ key: translationOverrides.key });
  return rows.length;
}
