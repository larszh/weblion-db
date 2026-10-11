import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import type pg from 'pg';
import type { ApiErrorBody } from '@weblion/shared';
import type { Env } from './config/env';
import type { Database } from './db/client';
import type { AppContext } from './context';
import { AuditService } from './audit';
import { AccessService } from './auth/access';
import { authPlugin } from './auth/plugin';
import { SecretBox } from './lib/crypto';
import { AppError } from './lib/errors';
import { ProviderRegistry } from './providers/registry';
import { SyncService } from './jobs/sync';
import { ConsoleTickets, consoleRoutes } from './modules/servers/console';
import { authRoutes } from './modules/auth/routes';
import { orgRoutes } from './modules/orgs/routes';
import { policyRoutes } from './modules/policies/routes';
import { projectRoutes } from './modules/projects/routes';
import { tokenRoutes } from './modules/tokens/routes';
import { auditRoutes } from './modules/audit/routes';
import { serverRoutes } from './modules/servers/routes';
import { adminRoutes } from './modules/admin/routes';
import { metaRoutes } from './modules/meta/routes';
import { billingRoutes } from './modules/billing/routes';
import { paymentRoutes } from './modules/payments/routes';
import { hostingRoutes } from './modules/hosting/routes';
import { zoneRoutes } from './modules/hosting/zones';
import { cloudRoutes } from './modules/cloud/routes';
import { mailRoutes } from './modules/mail/routes';
import { resellerRoutes } from './modules/reseller/routes';
import { settingsRoutes } from './modules/settings/routes';
import { MailService } from './mail/service';
import { ZohoService } from './integrations/zoho';

export interface BuildOptions {
  env: Env;
  db: Database;
  pool: pg.Pool;
  logger?: boolean;
}

export async function buildApp({
  env,
  db,
  pool,
  logger = true,
}: BuildOptions): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const app = Fastify({
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    // Path parameters up to an e-mail address of 254 characters (Fastify's default is 100).
    routerOptions: { maxParamLength: 512 },
    logger: logger
      ? {
          level: env.LOG_LEVEL,
          redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
          ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
        }
      : false,
  });

  const box = new SecretBox(env.ENCRYPTION_KEY);
  const providers = new ProviderRegistry(db, box);
  const ctx: AppContext = {
    env,
    db,
    box,
    log: app.log,
    providers,
    access: new AccessService(db),
    audit: new AuditService(db, app.log),
    consoleTickets: new ConsoleTickets(),
    sync: new SyncService(db, pool, providers, app.log),
    mail: new MailService(db, box, env, app.log),
    zoho: new ZohoService(db, env, app.log),
    secureCookies: env.APP_URL.startsWith('https://'),
  };

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        frameAncestors: ["'none'"],
        // Only force https sub-requests when the panel itself is served over https.
        upgradeInsecureRequests: ctx.secureCookies ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute' });
  await app.register(websocket, {
    options: {
      maxPayload: 16 * 1024 * 1024,
      // noVNC asks for the "binary" subprotocol.
      handleProtocols: (protocols: Set<string>) => (protocols.has('binary') ? 'binary' : false),
    },
  });
  await app.register(authPlugin, { db, appUrl: env.APP_URL, sessionTtlHours: env.SESSION_TTL_HOURS });

  app.setErrorHandler((error: FastifyError | AppError, req, reply) => {
    if (error instanceof AppError) {
      if (error.statusCode >= 500) req.log.error({ err: error }, error.message);
      const body: ApiErrorBody = {
        error: { code: error.code, message: error.message, details: error.details },
      };
      return reply.status(error.statusCode).send(body);
    }
    const status = error.statusCode ?? 500;
    if (status >= 500) req.log.error({ err: error }, 'unhandled error');
    const body: ApiErrorBody = {
      error: {
        code: status === 429 ? 'rate_limited' : status >= 500 ? 'internal_error' : 'bad_request',
        message: status >= 500 ? 'Internal server error' : error.message,
      },
    };
    return reply.status(status).send(body);
  });

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/readyz', async (_req, reply) => {
    try {
      await pool.query('select 1');
      return { ok: true };
    } catch {
      return reply.status(503).send({ ok: false });
    }
  });

  await app.register(
    async (api) => {
      for (const register of [
        metaRoutes,
        authRoutes,
        orgRoutes,
        policyRoutes,
        projectRoutes,
        tokenRoutes,
        auditRoutes,
        serverRoutes,
        consoleRoutes,
        adminRoutes,
        hostingRoutes,
        zoneRoutes,
        cloudRoutes,
        mailRoutes,
        billingRoutes,
        paymentRoutes,
        resellerRoutes,
        settingsRoutes,
      ]) {
        await register(api, ctx);
      }
      api.setNotFoundHandler((req, reply) => {
        const body: ApiErrorBody = {
          error: { code: 'not_found', message: `Route ${req.method} ${req.url} not found` },
        };
        return reply.status(404).send(body);
      });
    },
    { prefix: '/api/v1' },
  );

  // Optional: serve the built web app (single container deployments).
  const webDist = env.WEB_DIST_DIR ? resolve(env.WEB_DIST_DIR) : null;
  if (webDist && existsSync(resolve(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false, maxAge: '1h' });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.status(404).send({ error: { code: 'not_found', message: 'Not found' } });
      }
      return reply.type('text/html').sendFile('index.html', { maxAge: 0 });
    });
  }

  return { app, ctx };
}
