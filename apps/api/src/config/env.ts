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

  // Hetzner Cloud (one project per token).
  HETZNER_API_TOKEN: optionalString,
  HETZNER_BASE_URL: z.string().url().default('https://api.hetzner.cloud/v1'),
  HETZNER_NAME: z.string().default('Hetzner Cloud'),

  // Nextcloud (cloud storage). An admin account and an app password of it.
  NEXTCLOUD_URL: optionalString,
  NEXTCLOUD_USER: optionalString,
  NEXTCLOUD_APP_PASSWORD: optionalString,
  NEXTCLOUD_NAME: z.string().default('Nextcloud'),
  NEXTCLOUD_COUNTRY: z.string().default('CH'),
  NEXTCLOUD_CITY: z.string().default('Zürich'),

  // Mailcow (e-mail). A read-write API key; the console's IPs must be on the key's allow list.
  MAILCOW_URL: optionalString,
  MAILCOW_API_KEY: optionalString,
  /** Public host name for MX, IMAP, SMTP and webmail. Default: host of MAILCOW_URL. */
  MAILCOW_MAIL_HOST: optionalString,
  MAILCOW_NAME: z.string().default('Mailcow'),
  MAILCOW_COUNTRY: z.string().default('CH'),
  MAILCOW_CITY: z.string().default('Zürich'),

  // CloudPanel (websites). The first server; more in Admin > Provider. The console logs in as
  // CLOUDPANEL_USER with an ed25519 key and pins the server's ed25519 host key.
  CLOUDPANEL_HOST: optionalString,
  CLOUDPANEL_PORT: z.coerce.number().int().min(1).max(65535).default(22),
  CLOUDPANEL_USER: z.string().default('weblion-agent'),
  /** Unencrypted OpenSSH private key; "\n" sequences stand for line breaks (one-line env files). */
  CLOUDPANEL_PRIVATE_KEY: optionalString.transform((v) => v?.replace(/\\n/g, '\n')),
  /** Path of the private key file, read on boot when CLOUDPANEL_PRIVATE_KEY is empty. */
  CLOUDPANEL_PRIVATE_KEY_FILE: optionalString,
  /** "SHA256:..." of the server's ed25519 host key (ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub). */
  CLOUDPANEL_HOST_KEY: optionalString,
  /** Host customers use for SFTP/SSH. Default: CLOUDPANEL_HOST. */
  CLOUDPANEL_ACCESS_HOST: optionalString,
  CLOUDPANEL_NAME: z.string().default('CloudPanel'),
  CLOUDPANEL_COUNTRY: z.string().default('CH'),
  CLOUDPANEL_CITY: z.string().default('Zürich'),

  // Joker.com domains (DMAPI). An API key, or reseller username and password.
  JOKER_API_KEY: optionalString,
  JOKER_USERNAME: optionalString,
  JOKER_PASSWORD: optionalString,
  JOKER_BASE_URL: z.string().url().default('https://dmapi.joker.com/request'),
  JOKER_NAME: z.string().default('Joker.com'),

  // Cloudflare DNS zones and CDN. A custom API token (Zone:Edit, DNS:Edit, Zone Settings:Edit,
  // Cache Purge:Purge); the account id is only needed to create zones (DNS move).
  CLOUDFLARE_API_TOKEN: optionalString,
  CLOUDFLARE_ACCOUNT_ID: optionalString
    .transform((v) => v?.trim().toLowerCase())
    .refine((v) => v === undefined || /^[0-9a-f]{32}$/.test(v), 'expected the 32 character account id'),
  CLOUDFLARE_BASE_URL: z.string().url().default('https://api.cloudflare.com/client/v4'),
  CLOUDFLARE_NAME: z.string().default('Cloudflare'),

  // E-mail (SMTP). When SMTP_HOST is set, these win over the settings in the admin area.
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  /** true = implicit TLS (port 465). false = STARTTLS when the server offers it. */
  SMTP_SECURE: bool(false),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  /** e.g. "weblion.one <noreply@weblion.one>" */
  SMTP_FROM: optionalString,
  SMTP_REPLY_TO: optionalString,

  // Online payments through Stripe Checkout (cards and TWINT). Optional.
  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  /** Payment methods offered in Checkout. TWINT needs CHF and must be enabled in Stripe. */
  STRIPE_PAYMENT_METHODS: z.string().default('card,twint'),
  STRIPE_API_BASE: z.string().url().default('https://api.stripe.com'),

  // Zoho Books (accounting). Optional; invoices and payments issued by the platform are pushed there.
  ZOHO_CLIENT_ID: optionalString,
  ZOHO_CLIENT_SECRET: optionalString,
  ZOHO_REFRESH_TOKEN: optionalString,
  ZOHO_ORGANIZATION_ID: optionalString,
  /** Data center of the Zoho account: accounts.zoho.eu for EU, accounts.zoho.com for US. */
  ZOHO_ACCOUNTS_URL: z.string().url().default('https://accounts.zoho.eu'),
  ZOHO_API_URL: z.string().url().default('https://www.zohoapis.eu/books/v3'),
  /** Zoho tax id per rate in basis points, e.g. "810:1234567890,0:0987654321". */
  ZOHO_TAX_IDS: optionalString,

  /** Daily job that turns due services into invoices. */
  BILLING_JOB_ENABLED: bool(true),

  ENABLE_DEMO_PROVIDER: bool(false),
  /** A second demo connection that simulates a Cloudflare account (needs ENABLE_DEMO_PROVIDER). */
  ENABLE_DEMO_CLOUDFLARE: bool(false),
  /** A further demo connection that simulates a CloudPanel server (needs ENABLE_DEMO_PROVIDER). */
  ENABLE_DEMO_CLOUDPANEL: bool(false),
  /** Public resolvers the website DNS check asks (comma separated). */
  DNS_CHECK_RESOLVERS: z.string().default('1.1.1.1,9.9.9.9'),
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
