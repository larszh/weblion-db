import type { FastifyInstance } from 'fastify';
import { isLocale } from '@weblion/shared';
import type { AppContext } from '../../context';
import { notFound } from '../../lib/errors';

/** True when an If-None-Match header names the tag: exact, weak (W/"...") or one of a comma list. */
export function etagMatches(header: string | string[] | undefined, etag: string): boolean {
  if (!header) return false;
  const tags = (Array.isArray(header) ? header.join(',') : header).split(',');
  return tags.some((raw) => {
    const tag = raw.trim();
    return tag === '*' || tag === etag || tag.replace(/^W\//, '') === etag;
  });
}

/**
 * Translation routes. The foundation implements only A1 (i18n 13); U1 adds the admin routes A2 to A16 here
 * and the AI and job routes in ai-routes.ts.
 */
export async function i18nRoutes(app: FastifyInstance, ctx: AppContext) {
  // A1, public: the login page needs the overrides before anyone is signed in. The texts are UI texts the
  // public bundle carries anyway; email.* and pdf.* never leave the server.
  app.get<{ Params: { locale: string } }>(
    '/i18n/overrides/:locale',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { locale } = req.params;
      if (!isLocale(locale)) throw notFound('Locale');
      const { etag, body } = ctx.i18n.payload(locale);
      // no-cache: the browser revalidates every time; the web sends If-None-Match itself (i18n 5.3).
      reply.header('etag', etag).header('cache-control', 'no-cache');
      if (etagMatches(req.headers['if-none-match'], etag)) return reply.status(304).send();
      return body;
    },
  );
}
