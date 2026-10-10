import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import pino from 'pino';
import { eq, sql } from 'drizzle-orm';
import { buildApp } from '../src/app';
import { ensureBootstrapAdmin, syncEnvProviders } from '../src/bootstrap';
import { loadEnv } from '../src/config/env';
import { createDb, type Database } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { providerConnections } from '../src/db/schema';
import { seedDemo } from '../src/db/seed';
import { SecretBox } from '../src/lib/crypto';
import { DemoAdapter } from '../src/providers/demo/adapter';
import type { AppContext } from '../src/context';

export const ADMIN = { email: 'admin@test.local', password: 'admin-password-123' };
export const DEMO_PASSWORD = 'demo-password-123';

export interface TestApp {
  app: FastifyInstance;
  ctx: AppContext;
  db: Database;
  close: () => Promise<void>;
}

export interface TestAppOptions {
  /** Extra environment variables, e.g. { ENABLE_DEMO_CLOUDFLARE: 'true' }. */
  env?: Record<string, string>;
}

/** Fresh schema, migrations, bootstrap admin, demo provider synced and seeded. */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://weblion:weblion@localhost:5432/weblion_test',
    APP_URL: 'http://localhost:5173',
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    BOOTSTRAP_ADMIN_EMAIL: ADMIN.email,
    BOOTSTRAP_ADMIN_PASSWORD: ADMIN.password,
    ENABLE_DEMO_PROVIDER: 'true',
    LOG_LEVEL: 'fatal',
    LOGIN_RATE_LIMIT: '1000',
    ...options.env,
  });
  const { db, pool } = createDb(env.DATABASE_URL);
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);

  DemoAdapter.reset();
  const { app, ctx } = await buildApp({ env, db, pool, logger: false });
  const log = pino({ level: 'silent' });
  await ensureBootstrapAdmin(db, env, log);
  await syncEnvProviders(db, new SecretBox(env.ENCRYPTION_KEY), env, log);
  // The demo cloud; further demo connections (e.g. demo-cloudflare) are synced by the tests.
  const demo = await db.query.providerConnections.findFirst({
    where: eq(providerConnections.envKey, 'demo'),
  });
  await ctx.sync.syncConnection(demo!);
  await seedDemo(db, DEMO_PASSWORD);
  await app.ready();

  return {
    app,
    ctx,
    db,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

/** Minimal cookie aware client around fastify.inject. */
export class Client {
  private cookie: string | null = null;
  public bearer: string | null = null;

  constructor(private readonly app: FastifyInstance) {}

  async request(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await this.app.inject({
      method: method as 'GET',
      url: `/api/v1${url}`,
      payload: body === undefined ? undefined : (body as object),
      headers: {
        'x-requested-with': 'test',
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(this.bearer ? { authorization: `Bearer ${this.bearer}` } : {}),
        ...headers,
      },
    });
    const setCookie = res.cookies.find((c) => c.name === 'wl_session');
    if (setCookie) this.cookie = setCookie.value ? `wl_session=${setCookie.value}` : null;
    return res;
  }

  get = (url: string) => this.request('GET', url);
  post = (url: string, body: unknown = {}) => this.request('POST', url, body);
  patch = (url: string, body: unknown) => this.request('PATCH', url, body);
  del = (url: string, body?: unknown) => this.request('DELETE', url, body);

  async login(email: string, password = DEMO_PASSWORD) {
    const res = await this.post('/auth/login', { email, password });
    if (res.statusCode !== 200) throw new Error(`login failed for ${email}: ${res.body}`);
    return res.json();
  }
}

export function json<T = any>(res: LightMyRequestResponse): T {
  return res.json() as T;
}
