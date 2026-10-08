import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { MailSettingsDto } from '@weblion/shared';
import type { Env } from '../config/env';
import type { DbOrTx } from '../db/client';
import { settings } from '../db/schema';
import type { SecretBox } from '../lib/crypto';

/**
 * Where SMTP settings come from: SMTP_* environment variables win (read-only in the UI),
 * otherwise the admin area stores them encrypted in the settings table (key "smtp").
 */

export type MailSource = MailSettingsDto['source'];

export interface SmtpConfig {
  host: string;
  port: number;
  /** true = implicit TLS (465), false = STARTTLS when the server offers it. */
  secure: boolean;
  user: string | null;
  password: string | null;
  /** e.g. "weblion.one <noreply@weblion.one>" */
  from: string | null;
  replyTo: string | null;
}

export interface ResolvedSmtp {
  source: MailSource;
  config: SmtpConfig | null;
}

const SETTINGS_KEY = 'smtp';

/** Stored row: the whole config as one encrypted JSON blob, password included. */
interface StoredSmtp {
  enc: string;
}

export function envSmtpConfig(env: Env): SmtpConfig | null {
  if (!env.SMTP_HOST) return null;
  return {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER ?? null,
    password: env.SMTP_PASSWORD ?? null,
    from: env.SMTP_FROM ?? null,
    replyTo: env.SMTP_REPLY_TO ?? null,
  };
}

/** Settings saved in the admin area. null when none are saved or they can't be decrypted. */
export async function storedSmtpConfig(db: DbOrTx, box: SecretBox): Promise<SmtpConfig | null> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, SETTINGS_KEY) });
  const stored = row?.value as StoredSmtp | undefined;
  if (!stored?.enc) return null;
  try {
    return box.decryptJson<SmtpConfig>(stored.enc);
  } catch {
    // ENCRYPTION_KEY changed: behave as if nothing was saved, the admin enters it again.
    return null;
  }
}

export async function resolveSmtp(db: DbOrTx, box: SecretBox, env: Env): Promise<ResolvedSmtp> {
  const fromEnv = envSmtpConfig(env);
  if (fromEnv) return { source: 'env', config: fromEnv };
  const stored = await storedSmtpConfig(db, box);
  return stored ? { source: 'ui', config: stored } : { source: 'none', config: null };
}

export async function saveSmtpConfig(db: DbOrTx, box: SecretBox, config: SmtpConfig): Promise<void> {
  const value: StoredSmtp = { enc: box.encryptJson(config) };
  await db
    .insert(settings)
    .values({ key: SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

export async function deleteSmtpConfig(db: DbOrTx): Promise<void> {
  await db.delete(settings).where(eq(settings.key, SETTINGS_KEY));
}

/** What the admin area shows. Never contains the password. */
export function toMailSettingsDto({ source, config }: ResolvedSmtp): MailSettingsDto {
  return {
    source,
    host: config?.host ?? null,
    port: config?.port ?? 587,
    secure: config?.secure ?? false,
    user: config?.user ?? null,
    passwordSet: !!config?.password,
    from: config?.from ?? null,
    replyTo: config?.replyTo ?? null,
  };
}

/** Cache key for a transport. A hash, so the password is not kept around as a map key. */
export function configFingerprint(config: SmtpConfig): string {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex');
}

/** Sender address: the configured one, else the SMTP user if it is an address, else noreply@<panel host>. */
export function senderAddress(config: SmtpConfig, appUrl: string): string {
  if (config.from) return config.from;
  if (config.user?.includes('@')) return config.user;
  let host = 'localhost';
  try {
    host = new URL(appUrl).hostname || host;
  } catch {
    // keep localhost
  }
  return `weblion.one <noreply@${host}>`;
}

const plainAddress = z.email();

/** "name@example.com" or "Name <name@example.com>", one line. */
export function isMailAddress(value: string): boolean {
  if (/[\r\n]/.test(value)) return false;
  const match = /^(?:"?[^"<>]*"?\s*<([^<>\s]+)>|([^<>\s]+))$/.exec(value.trim());
  const address = match?.[1] ?? match?.[2];
  return !!address && plainAddress.safeParse(address).success;
}
