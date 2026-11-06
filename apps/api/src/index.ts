import { loadEnv } from './config/env';
import { createDb } from './db/client';
import { runMigrations } from './db/migrate';
import { buildApp } from './app';
import { ensureBootstrapAdmin, syncEnvProviders } from './bootstrap';
import { SecretBox } from './lib/crypto';
import { BillingJob } from './modules/billing/recurring';

async function main() {
  const env = loadEnv();
  const { db, pool } = createDb(env.DATABASE_URL);
  await runMigrations(db);

  const { app, ctx } = await buildApp({ env, db, pool });
  await ensureBootstrapAdmin(db, env, app.log);
  await syncEnvProviders(db, new SecretBox(env.ENCRYPTION_KEY), env, app.log);

  ctx.sync.start(env.SYNC_INTERVAL_SECONDS);
  const billingJob = new BillingJob(ctx, pool);
  if (env.BILLING_JOB_ENABLED) billingJob.start();
  ctx.i18n.start();
  // Secondary processes set I18N_JOB_ENABLED=false; the runner's advisory lock guards the rest.
  if (env.I18N_JOB_ENABLED) ctx.i18nJobs.start();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    ctx.sync.stop();
    billingJob.stop();
    ctx.i18n.stop();
    // Re-queues a job this process owns, so the next start (here or elsewhere) resumes it.
    await ctx.i18nJobs.stop();
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
