import { loadEnv } from './config/env';
import { createDb } from './db/client';
import { runMigrations } from './db/migrate';
import { buildApp } from './app';
import { ensureBootstrapAdmin, syncEnvProviders } from './bootstrap';
import { SecretBox } from './lib/crypto';

async function main() {
  const env = loadEnv();
  const { db, pool } = createDb(env.DATABASE_URL);
  await runMigrations(db);

  const { app, ctx } = await buildApp({ env, db, pool });
  await ensureBootstrapAdmin(db, env, app.log);
  await syncEnvProviders(db, new SecretBox(env.ENCRYPTION_KEY), env, app.log);

  ctx.sync.start(env.SYNC_INTERVAL_SECONDS);

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    ctx.sync.stop();
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: env.HOST, port: env.PORT });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
