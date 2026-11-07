import { eq } from 'drizzle-orm';
import {
  AI_DEFAULT_MODEL,
  AI_FEATURES,
  isAiModel,
  type AiFeature,
  type AiGoLiveDto,
  type AiModel,
} from '@weblion/shared';
import type { Env } from '../../config/env';
import type { DbOrTx } from '../../db/client';
import { settings } from '../../db/schema';
import type { SecretBox } from '../../lib/crypto';

/**
 * The settings rows of the AI module (plan 3.2, ai 5.1, 5.2): `ai` holds the KI page settings as plain JSON,
 * `ai_key` the API key saved on the KI page, encrypted like the SMTP settings.
 */

export const AI_SETTINGS_KEY = 'ai';
export const AI_KEY_SETTINGS_KEY = 'ai_key';

export interface StoredAiSettings {
  /** Master switch. */
  enabled: boolean;
  model: AiModel;
  /** A missing feature is on. */
  features: Partial<Record<AiFeature, boolean>>;
  budgetUsd: number;
  warnPercent: number;
  dailyOrgLimit: number;
  dailyUserLimit: number;
  /** Data notice acknowledgement (user id). */
  notice: { checkedAt: string; checkedBy: string } | null;
  goLive: (Omit<AiGoLiveDto, 'confirmedBy'> & { confirmedBy: string | null }) | null;
}

/** StoredAiSettings with every default applied. */
export interface AiSettings extends Omit<StoredAiSettings, 'features'> {
  features: Record<AiFeature, boolean>;
}

/** Ranges of PUT /admin/ai/settings (ai 5.1). */
export const AI_SETTING_RANGES = {
  budgetUsd: { min: 0, max: 100_000 },
  warnPercent: { min: 10, max: 99 },
  dailyOrgLimit: { min: 1, max: 10_000 },
  dailyUserLimit: { min: 1, max: 10_000 },
} as const;

/** The defaults of plan 3.2. The master switch starts on only with the demo provider (never in production). */
export function defaultAiSettings(env: Env): AiSettings {
  return {
    enabled: env.ENABLE_DEMO_PROVIDER,
    model: AI_DEFAULT_MODEL,
    features: Object.fromEntries(AI_FEATURES.map((f) => [f, true])) as Record<AiFeature, boolean>,
    budgetUsd: 100,
    warnPercent: 80,
    dailyOrgLimit: 200,
    dailyUserLimit: 50,
    notice: null,
    goLive: null,
  };
}

function inRange(value: unknown, range: { min: number; max: number }, integer: boolean): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= range.min &&
    value <= range.max &&
    (!integer || Number.isInteger(value))
  );
}

/** The `ai` row with the defaults applied; a field that is missing or out of range falls back to its default. */
export async function readAiSettings(db: DbOrTx, env: Env): Promise<AiSettings> {
  const defaults = defaultAiSettings(env);
  const row = await db.query.settings.findFirst({ where: eq(settings.key, AI_SETTINGS_KEY) });
  const stored = (row?.value ?? null) as Partial<StoredAiSettings> | null;
  if (!stored || typeof stored !== 'object') return defaults;
  const r = AI_SETTING_RANGES;
  return {
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : defaults.enabled,
    model: typeof stored.model === 'string' && isAiModel(stored.model) ? stored.model : defaults.model,
    features: Object.fromEntries(AI_FEATURES.map((f) => [f, stored.features?.[f] !== false])) as Record<
      AiFeature,
      boolean
    >,
    budgetUsd: inRange(stored.budgetUsd, r.budgetUsd, false) ? stored.budgetUsd : defaults.budgetUsd,
    warnPercent: inRange(stored.warnPercent, r.warnPercent, true) ? stored.warnPercent : defaults.warnPercent,
    dailyOrgLimit: inRange(stored.dailyOrgLimit, r.dailyOrgLimit, true)
      ? stored.dailyOrgLimit
      : defaults.dailyOrgLimit,
    dailyUserLimit: inRange(stored.dailyUserLimit, r.dailyUserLimit, true)
      ? stored.dailyUserLimit
      : defaults.dailyUserLimit,
    notice: stored.notice ?? null,
    goLive: stored.goLive ?? null,
  };
}

export async function saveAiSettings(db: DbOrTx, value: StoredAiSettings): Promise<void> {
  await db
    .insert(settings)
    .values({ key: AI_SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

export type ResolvedAiKey =
  | { source: 'ui' | 'env'; key: string; demo: false }
  /** demo = env.ENABLE_DEMO_PROVIDER: the emulator answers (ai 14). */
  | { source: 'none'; key: null; demo: boolean };

interface StoredAiKey {
  enc: string;
}

/** The decrypted value of the `ai_key` row. */
interface AiKeyValue {
  key: string;
  savedAt: string;
  savedBy: string | null;
}

/** null when the row is missing or cannot be decrypted after an ENCRYPTION_KEY change (like storedSmtpConfig). */
export async function storedAiKey(db: DbOrTx, box: SecretBox): Promise<AiKeyValue | null> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, AI_KEY_SETTINGS_KEY) });
  const stored = row?.value as StoredAiKey | undefined;
  if (!stored?.enc) return null;
  try {
    const value = box.decryptJson<AiKeyValue>(stored.enc);
    return typeof value?.key === 'string' && value.key ? value : null;
  } catch {
    // ENCRYPTION_KEY changed: behave as if nothing was saved, the owner saves the key again.
    return null;
  }
}

/** The whole value is encrypted, the key and who saved it, exactly like saveSmtpConfig. */
export async function saveAiKey(tx: DbOrTx, box: SecretBox, key: string, userId: string): Promise<void> {
  const value: StoredAiKey = {
    enc: box.encryptJson({ key, savedAt: new Date().toISOString(), savedBy: userId } satisfies AiKeyValue),
  };
  await tx
    .insert(settings)
    .values({ key: AI_KEY_SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

/** false when no key was saved. */
export async function deleteAiKey(tx: DbOrTx): Promise<boolean> {
  const rows = await tx
    .delete(settings)
    .where(eq(settings.key, AI_KEY_SETTINGS_KEY))
    .returning({ key: settings.key });
  return rows.length > 0;
}

/**
 * The saved key wins over ANTHROPIC_API_KEY (plan decision 17). This is the reverse of SMTP on purpose: a leaked
 * key can be rotated on the KI page without a redeploy, and the env key stays a fallback for fresh installations.
 */
export async function resolveAiKey(db: DbOrTx, box: SecretBox, env: Env): Promise<ResolvedAiKey> {
  const stored = await storedAiKey(db, box);
  if (stored) return { source: 'ui', key: stored.key, demo: false };
  if (env.ANTHROPIC_API_KEY) return { source: 'env', key: env.ANTHROPIC_API_KEY, demo: false };
  return { source: 'none', key: null, demo: env.ENABLE_DEMO_PROVIDER };
}

/** PUT /admin/ai/key: a normal key from the Claude Console (ai 5.2). Admin API keys are refused before this. */
export const AI_KEY_PATTERN = /^sk-ant-[A-Za-z0-9_-]{16,300}$/;
export const AI_ADMIN_KEY_PREFIX = 'sk-ant-admin';
