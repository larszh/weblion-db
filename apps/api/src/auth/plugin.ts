import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/client';
import { forbidden } from '../lib/errors';
import { resolveApiToken, resolveSession, SESSION_COOKIE } from './sessions';
import './types';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface AuthPluginOptions {
  db: Database;
  appUrl: string;
  sessionTtlHours: number;
}

/**
 * Resolves the caller for every API request: either `Authorization: Bearer <token>`
 * or the session cookie. Cookie authenticated writes must carry `X-Requested-With`
 * and, if the browser sends one, a matching Origin. Together with SameSite=Lax that
 * shuts the door on cross site request forgery.
 */
export const authPlugin = fp<AuthPluginOptions>(async (app: FastifyInstance, opts) => {
  const allowedOrigin = new URL(opts.appUrl).origin;

  app.decorateRequest('auth', null);
  app.decorateRequest('accessCache', null as unknown as Map<string, unknown>);

  app.addHook('onRequest', async (req) => {
    req.accessCache = new Map();
    req.auth = null;
    if (!req.url.startsWith('/api/')) return;

    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      req.auth = await resolveApiToken(opts.db, header.slice(7).trim());
      return;
    }

    const raw = req.cookies[SESSION_COOKIE];
    if (!raw) return;
    req.auth = await resolveSession(opts.db, raw, opts.sessionTtlHours);

    if (req.auth && !SAFE_METHODS.has(req.method)) {
      if (!req.headers['x-requested-with']) throw forbidden('Missing X-Requested-With header');
      const origin = req.headers.origin;
      if (origin && origin !== allowedOrigin && !isSameHost(origin, req.headers.host)) {
        throw forbidden('Cross origin request rejected');
      }
    }
  });
});

function isSameHost(origin: string, host: string | undefined): boolean {
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}
