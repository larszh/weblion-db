import pino from 'pino';
import { eq } from 'drizzle-orm';
import { loadEnv } from '../config/env';
import { createDb } from './client';
import { runMigrations } from './migrate';
import { seedDemo } from './seed';
import { ensureBootstrapAdmin, syncEnvProviders } from '../bootstrap';
import { SecretBox } from '../lib/crypto';
import { ProviderRegistry } from '../providers/registry';
import { SyncService } from '../jobs/sync';
import { providerConnections } from './schema';

const env = loadEnv();
if (!env.ENABLE_DEMO_PROVIDER) {
  console.error('Refusing to seed: set ENABLE_DEMO_PROVIDER=true (demo data is meant for development).');
  process.exit(1);
}
const log = pino({ level: 'info' });
const { db, pool } = createDb(env.DATABASE_URL);
await runMigrations(db);
await ensureBootstrapAdmin(db, env, log);
const box = new SecretBox(env.ENCRYPTION_KEY);
await syncEnvProviders(db, box, env, log);

const sync = new SyncService(db, pool, new ProviderRegistry(db, box), log);
const demo = await db.query.providerConnections.findFirst({ where: eq(providerConnections.envKey, 'demo') });
if (demo) await sync.syncConnection(demo);
// The demo Cloudflare (ENABLE_DEMO_CLOUDFLARE) after the registrar, so the seed finds its zones.
const demoCloudflare = await db.query.providerConnections.findFirst({
  where: eq(providerConnections.envKey, 'demo-cloudflare'),
});
if (demoCloudflare) await sync.syncConnection(demoCloudflare);
// The demo CloudPanel (ENABLE_DEMO_CLOUDPANEL), so the seed finds its websites.
const demoCloudPanel = await db.query.providerConnections.findFirst({
  where: eq(providerConnections.envKey, 'demo-cloudpanel'),
});
if (demoCloudPanel) await sync.syncConnection(demoCloudPanel);

const password = process.env.SEED_PASSWORD ?? 'demo-password-123';
const created = await seedDemo(db, password);
console.log(created.length ? created.map((l) => `  + ${l}`).join('\n') : '  nothing new');
console.log(`Demo users share the password "${password}".`);
await pool.end();
