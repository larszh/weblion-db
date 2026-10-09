import { count, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { DEFAULT_INTERNAL_BOUNDARY, type Location, type ProviderType } from '@weblion/shared';
import type { Env } from './config/env';
import type { Database } from './db/client';
import { memberships, organizations, projects, providerConnections, users } from './db/schema';
import { hashPassword, type SecretBox } from './lib/crypto';
import type {
  DemoConfig,
  Fire24Config,
  HetznerConfig,
  JokerConfig,
  NextcloudConfig,
  ProviderConfig,
  ProxmoxConfig,
} from './providers/types';

/** Creates the first superadmin and the weblion organization on an empty database. */
export async function ensureBootstrapAdmin(db: Database, env: Env, log: FastifyBaseLogger): Promise<void> {
  const [row] = await db.select({ n: count() }).from(users);
  if ((row?.n ?? 0) > 0) return;
  if (!env.BOOTSTRAP_ADMIN_EMAIL || !env.BOOTSTRAP_ADMIN_PASSWORD) {
    log.warn(
      'No users exist yet. Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD to create the first admin.',
    );
    return;
  }
  await db.transaction(async (tx) => {
    const [admin] = await tx
      .insert(users)
      .values({
        email: env.BOOTSTRAP_ADMIN_EMAIL!.toLowerCase(),
        name: env.BOOTSTRAP_ADMIN_NAME,
        platformRole: 'superadmin',
        passwordHash: await hashPassword(env.BOOTSTRAP_ADMIN_PASSWORD!),
      })
      .returning();
    const [org] = await tx
      .insert(organizations)
      .values({ name: 'weblion.one', slug: 'weblion', kind: 'internal', boundary: DEFAULT_INTERNAL_BOUNDARY })
      .onConflictDoNothing()
      .returning();
    if (org) {
      await tx.insert(projects).values({ orgId: org.id, name: 'Infrastruktur' });
      await tx.insert(memberships).values({ orgId: org.id, userId: admin!.id, role: 'owner' });
    }
  });
  log.info({ email: env.BOOTSTRAP_ADMIN_EMAIL }, 'created bootstrap superadmin');
}

interface EnvProvider {
  key: string;
  type: ProviderType;
  name: string;
  location: Location;
  config: ProviderConfig;
}

function envProviders(env: Env): EnvProvider[] {
  const list: EnvProvider[] = [];
  if (env.FIRE24_API_KEY) {
    list.push({
      key: 'fire24',
      type: 'fire24',
      name: env.FIRE24_NAME,
      location: { country: env.FIRE24_COUNTRY, city: env.FIRE24_CITY, label: `${env.FIRE24_CITY} (24fire)` },
      config: { apiKey: env.FIRE24_API_KEY, baseUrl: env.FIRE24_BASE_URL } satisfies Fire24Config,
    });
  }
  if (env.PROXMOX_URL && env.PROXMOX_TOKEN_ID && env.PROXMOX_TOKEN_SECRET) {
    list.push({
      key: 'proxmox',
      type: 'proxmox',
      name: env.PROXMOX_NAME,
      location: {
        country: env.PROXMOX_COUNTRY,
        city: env.PROXMOX_CITY,
        label: `${env.PROXMOX_CITY} (on-prem)`,
      },
      config: {
        baseUrl: env.PROXMOX_URL,
        tokenId: env.PROXMOX_TOKEN_ID,
        tokenSecret: env.PROXMOX_TOKEN_SECRET,
        verifyTls: env.PROXMOX_VERIFY_TLS,
        ...(env.PROXMOX_BACKUP_STORAGE ? { backupStorage: env.PROXMOX_BACKUP_STORAGE } : {}),
      } satisfies ProxmoxConfig,
    });
  }
  if (env.HETZNER_API_TOKEN) {
    list.push({
      key: 'hetzner',
      type: 'hetzner',
      name: env.HETZNER_NAME,
      // Each server reports its own location (Falkenstein, Nürnberg, Helsinki, ...).
      location: { country: 'DE', city: 'Hetzner', label: 'Hetzner Cloud' },
      config: { apiToken: env.HETZNER_API_TOKEN, baseUrl: env.HETZNER_BASE_URL } satisfies HetznerConfig,
    });
  }
  if (env.NEXTCLOUD_URL && env.NEXTCLOUD_USER && env.NEXTCLOUD_APP_PASSWORD) {
    list.push({
      key: 'nextcloud',
      type: 'nextcloud',
      name: env.NEXTCLOUD_NAME,
      location: {
        country: env.NEXTCLOUD_COUNTRY,
        city: env.NEXTCLOUD_CITY,
        label: `${env.NEXTCLOUD_CITY} (Nextcloud)`,
      },
      config: {
        baseUrl: env.NEXTCLOUD_URL,
        username: env.NEXTCLOUD_USER,
        appPassword: env.NEXTCLOUD_APP_PASSWORD,
      } satisfies NextcloudConfig,
    });
  }
  if (env.JOKER_API_KEY || (env.JOKER_USERNAME && env.JOKER_PASSWORD)) {
    list.push({
      key: 'joker',
      type: 'joker',
      name: env.JOKER_NAME,
      location: { country: 'DE', city: 'Düsseldorf', label: 'Joker.com (Registrar)' },
      config: {
        baseUrl: env.JOKER_BASE_URL,
        ...(env.JOKER_API_KEY
          ? { apiKey: env.JOKER_API_KEY }
          : { username: env.JOKER_USERNAME, password: env.JOKER_PASSWORD }),
      } satisfies JokerConfig,
    });
  }
  if (env.ENABLE_DEMO_PROVIDER) {
    list.push({
      key: 'demo',
      type: 'demo',
      name: 'Demo Cloud',
      location: { country: 'CH', city: 'Demo', label: 'Demo (simuliert)' },
      config: { seed: 42, servers: 8 } satisfies DemoConfig,
    });
  }
  return list;
}

/**
 * Provider credentials can come from environment variables (recommended for the
 * weblion-owned 24fire account and the Proxmox cluster). They are stored encrypted and
 * refreshed on every boot, so rotating a key means changing the env and restarting.
 */
export async function syncEnvProviders(
  db: Database,
  box: SecretBox,
  env: Env,
  log: FastifyBaseLogger,
): Promise<void> {
  for (const p of envProviders(env)) {
    const existing = await db.query.providerConnections.findFirst({
      where: eq(providerConnections.envKey, p.key),
    });
    if (!existing) {
      await db.insert(providerConnections).values({
        type: p.type,
        name: p.name,
        location: p.location,
        configEnc: box.encryptJson(p.config),
        managedBy: 'env',
        envKey: p.key,
      });
      log.info({ provider: p.name }, 'registered provider from environment');
      continue;
    }
    let changed = true;
    try {
      changed = JSON.stringify(box.decryptJson(existing.configEnc)) !== JSON.stringify(p.config);
    } catch {
      log.warn(
        { provider: p.name },
        'stored provider credentials could not be decrypted, replacing them from environment',
      );
    }
    if (changed || existing.type !== p.type) {
      await db
        .update(providerConnections)
        .set({ type: p.type, configEnc: box.encryptJson(p.config), status: 'unknown', lastError: null })
        .where(eq(providerConnections.id, existing.id));
      log.info({ provider: p.name }, 'updated provider credentials from environment');
    }
  }
}
