import { z } from 'zod';

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()),
    );

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  TRUST_PROXY: bool(true),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /** Public URL of the panel, used for invite links and origin checks. */
  APP_URL: z.string().url().default('http://localhost:5173'),
  /** 32 random bytes, base64 encoded. Encrypts provider credentials and TOTP secrets at rest. */
  ENCRYPTION_KEY: z.string().min(1, 'ENCRYPTION_KEY is required (openssl rand -base64 32)'),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .positive()
    .default(24 * 7),
  /** Login attempts per IP and minute. */
  LOGIN_RATE_LIMIT: z.coerce.number().int().positive().default(10),

  BOOTSTRAP_ADMIN_EMAIL: optionalString,
  BOOTSTRAP_ADMIN_PASSWORD: optionalString,
  BOOTSTRAP_ADMIN_NAME: z.string().default('weblion Admin'),

  FIRE24_API_KEY: optionalString,
  FIRE24_BASE_URL: z.string().url().default('https://manage.24fire.de'),
  FIRE24_NAME: z.string().default('24fire'),
  FIRE24_COUNTRY: z.string().default('DE'),
  FIRE24_CITY: z.string().default('Rechenzentrum DE'),

  PROXMOX_URL: optionalString,
  PROXMOX_TOKEN_ID: optionalString,
  PROXMOX_TOKEN_SECRET: optionalString,
  PROXMOX_VERIFY_TLS: bool(true),
  PROXMOX_NAME: z.string().default('Proxmox Zürich'),
  PROXMOX_COUNTRY: z.string().default('CH'),
  PROXMOX_CITY: z.string().default('Zürich'),
  /** Storage that receives backups created from the panel (vzdump target). */
  PROXMOX_BACKUP_STORAGE: optionalString,

  ENABLE_DEMO_PROVIDER: bool(false),
  SYNC_INTERVAL_SECONDS: z.coerce.number().int().min(15).default(120),
  /** Serve the built web app from the API process (single container deployments). */
  WEB_DIST_DIR: optionalString,
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${lines}`);
  }
  return parsed.data;
}
