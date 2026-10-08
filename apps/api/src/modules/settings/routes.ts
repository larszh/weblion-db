import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { IntegrationsDto, MailLogDto, MailSettingsDto, Paginated } from '@weblion/shared';
import type { AppContext } from '../../context';
import { platformScope, requireSession } from '../../auth/access';
import { mailLog, organizations } from '../../db/schema';
import { conflict } from '../../lib/errors';
import { paginationQuery, parse } from '../../lib/validation';
import {
  deleteSmtpConfig,
  isMailAddress,
  resolveSmtp,
  saveSmtpConfig,
  storedSmtpConfig,
  toMailSettingsDto,
} from '../../mail/settings';
import { mailLocale } from '../../mail/templates';

const addressSchema = z
  .string()
  .trim()
  .min(3)
  .max(200)
  .refine(isMailAddress, 'expected "name@example.com" or "Name <name@example.com>"');

const mailSettingsBody = z.object({
  host: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[^\s/]+$/, 'expected a host name or IP address'),
  port: z.number().int().min(1).max(65_535),
  secure: z.boolean(),
  user: z
    .string()
    .trim()
    .max(255)
    .nullish()
    .transform((v) => v || null),
  /** Omitted = keep the stored password, "" = remove it. */
  password: z.string().max(500).optional(),
  from: addressSchema,
  replyTo: z
    .email()
    .max(200)
    .nullish()
    .or(z.literal(''))
    .transform((v) => v || null),
});

const mailLogQuery = paginationQuery.extend({ status: z.enum(['sent', 'failed', 'skipped']).optional() });

/** Stripe mode from the key prefix (sk_live_/rk_live_ vs. sk_test_/rk_test_). */
function stripeMode(key: string | undefined): 'live' | 'test' | null {
  if (!key) return null;
  if (/^(sk|rk)_live_/.test(key)) return 'live';
  if (/^(sk|rk)_test_/.test(key)) return 'test';
  return null;
}

/** Admin settings: mail (SMTP), mail log and the integrations overview. Billing settings live in billing. */
export async function settingsRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, box, env, access, audit } = ctx;

  const mailSettings = async (): Promise<MailSettingsDto> =>
    toMailSettingsDto(await resolveSmtp(db, box, env));

  app.get('/admin/settings/mail', async (req) => {
    requireSession(req);
    await access.assert(req, 'platform:settings', platformScope);
    return mailSettings();
  });

  app.put('/admin/settings/mail', async (req) => {
    requireSession(req);
    await access.assert(req, 'platform:settings', platformScope);
    const body = parse(mailSettingsBody, req.body);
    if ((await resolveSmtp(db, box, env)).source === 'env') {
      throw conflict('SMTP is configured through environment variables (SMTP_*). Change it there.');
    }
    const current = await storedSmtpConfig(db, box);
    const password =
      body.password === undefined ? (current?.password ?? null) : body.password === '' ? null : body.password;
    await saveSmtpConfig(db, box, {
      host: body.host,
      port: body.port,
      secure: body.secure,
      user: body.user,
      password,
      from: body.from,
      replyTo: body.replyTo,
    });
    await audit.record(req, {
      action: 'settings.mail_update',
      resourceType: 'settings',
      resourceId: 'smtp',
      details: {
        host: body.host,
        port: body.port,
        secure: body.secure,
        user: body.user,
        from: body.from,
        replyTo: body.replyTo,
        passwordChanged: body.password !== undefined,
      },
    });
    return mailSettings();
  });

  app.delete('/admin/settings/mail', async (req) => {
    requireSession(req);
    await access.assert(req, 'platform:settings', platformScope);
    await deleteSmtpConfig(db);
    await audit.record(req, { action: 'settings.mail_delete', resourceType: 'settings', resourceId: 'smtp' });
    return mailSettings();
  });

  app.post('/admin/settings/mail/test', async (req) => {
    const auth = requireSession(req);
    await access.assert(req, 'platform:settings', platformScope);
    const { to } = parse(z.object({ to: z.email().max(200) }), req.body);
    const result = await ctx.mail.send(
      'test',
      { sentBy: auth.user.name },
      { to, locale: mailLocale(auth.user.locale) },
    );
    await audit.record(req, {
      action: 'settings.mail_test',
      status: result.status === 'sent' ? 'success' : 'failure',
      resourceType: 'settings',
      resourceId: 'smtp',
      details: { to, status: result.status, error: result.error ?? null },
    });
    return result;
  });

  app.get('/admin/mail-log', async (req): Promise<Paginated<MailLogDto>> => {
    await access.assert(req, 'platform:settings', platformScope);
    const { page, perPage, status } = parse(mailLogQuery, req.query);
    const where: SQL | undefined = and(status ? eq(mailLog.status, status) : undefined);
    const [rows, totals] = await Promise.all([
      db
        .select({ entry: mailLog, orgName: organizations.name })
        .from(mailLog)
        .leftJoin(organizations, eq(organizations.id, mailLog.orgId))
        .where(where)
        .orderBy(desc(mailLog.createdAt), desc(mailLog.id))
        .limit(perPage)
        .offset((page - 1) * perPage),
      db.select({ n: count() }).from(mailLog).where(where),
    ]);
    return {
      items: rows.map(({ entry, orgName }) => ({
        id: entry.id,
        to: entry.to,
        subject: entry.subject,
        template: entry.template,
        status: entry.status,
        error: entry.error,
        org: entry.orgId && orgName ? { id: entry.orgId, name: orgName } : null,
        createdAt: entry.createdAt.toISOString(),
      })),
      total: totals[0]?.n ?? 0,
      page,
      perPage,
    };
  });

  app.get('/admin/integrations', async (req): Promise<IntegrationsDto> => {
    await access.assert(req, 'platform:access', platformScope);
    const smtp = await resolveSmtp(db, box, env);
    const stripeMethods = env.STRIPE_PAYMENT_METHODS.split(',').map((m) => m.trim().toLowerCase());
    return {
      mail: { configured: smtp.config !== null, source: smtp.source },
      stripe: {
        configured: !!env.STRIPE_SECRET_KEY,
        mode: stripeMode(env.STRIPE_SECRET_KEY),
        webhookConfigured: !!env.STRIPE_WEBHOOK_SECRET,
        // Only meaningful with Stripe set up; the default method list contains twint.
        twint: !!env.STRIPE_SECRET_KEY && stripeMethods.includes('twint'),
      },
      zoho: await ctx.zoho.status(),
    };
  });
}
