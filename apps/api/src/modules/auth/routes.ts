import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { SessionDto } from '@weblion/shared';
import type { AppContext } from '../../context';
import { requireSession } from '../../auth/access';
import { clearSessionCookie, createSession } from '../../auth/sessions';
import { invitations, memberships, organizations, sessions, users, type User } from '../../db/schema';
import { getDummyHash, hashPassword, sha256, verifyPassword } from '../../lib/crypto';
import { buildMe } from '../../lib/dto';
import { badRequest, conflict, forbidden, locked, notFound, unauthorized } from '../../lib/errors';
import { generateTotpSecret, totpSetupPayload, verifyTotp } from '../../lib/totp';
import { parse, passwordSchema } from '../../lib/validation';

const MAX_FAILED = 10;
const LOCK_MINUTES = 15;

const loginBody = z.object({ email: z.email().max(200), password: z.string().min(1).max(200) });
const mfaBody = z.object({ code: z.string().min(6).max(10) });

export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, audit, box } = ctx;
  const sessionOptions = { ttlHours: ctx.env.SESSION_TTL_HOURS, secureCookies: ctx.secureCookies };
  const loginRateLimit = { config: { rateLimit: { max: ctx.env.LOGIN_RATE_LIMIT, timeWindow: '1 minute' } } };

  async function registerFailure(user: User) {
    const failed = user.failedLogins + 1;
    await db
      .update(users)
      .set({
        failedLogins: failed,
        lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil,
      })
      .where(eq(users.id, user.id));
  }

  async function completeLogin(req: FastifyRequest, reply: FastifyReply, user: User) {
    const [updated] = await db
      .update(users)
      .set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(eq(users.id, user.id))
      .returning();
    const sessionId = await createSession(db, req, reply, user.id, false, sessionOptions);
    const auth = { user: updated ?? user, sessionId, token: null, mfaPending: false };
    req.auth = auth;
    await audit.record(req, { action: 'auth.login', resourceType: 'user', resourceId: user.id });
    return buildMe(db, auth);
  }

  app.post('/auth/login', loginRateLimit, async (req, reply) => {
    const body = parse(loginBody, req.body);
    const user = await db.query.users.findFirst({ where: sql`lower(${users.email}) = lower(${body.email})` });

    if (!user || !user.passwordHash) {
      await verifyPassword(body.password, await getDummyHash());
      await audit.record(req, {
        action: 'auth.login',
        status: 'failure',
        actorUserId: null,
        actorName: body.email,
        details: { reason: 'unknown_user' },
      });
      throw unauthorized('Invalid email or password');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw locked('Too many failed attempts. Try again in a few minutes.');
    }
    if (!(await verifyPassword(body.password, user.passwordHash))) {
      await registerFailure(user);
      await audit.record(req, {
        action: 'auth.login',
        status: 'failure',
        actorUserId: user.id,
        actorName: user.name,
        details: { reason: 'bad_password' },
      });
      throw unauthorized('Invalid email or password');
    }
    if (user.status !== 'active') throw forbidden('This account is disabled');

    if (user.totpEnabled) {
      await createSession(db, req, reply, user.id, true, sessionOptions);
      return { mfaRequired: true };
    }
    return completeLogin(req, reply, user);
  });

  app.post('/auth/login/mfa', loginRateLimit, async (req, reply) => {
    const auth = req.auth;
    if (!auth?.mfaPending || !auth.sessionId) throw unauthorized('No pending login');
    const { code } = parse(mfaBody, req.body);
    const user = auth.user;
    if (user.lockedUntil && user.lockedUntil > new Date()) throw locked('Too many failed attempts');
    if (!user.totpSecretEnc || !verifyTotp(box.decrypt(user.totpSecretEnc), code)) {
      await registerFailure(user);
      await audit.record(req, { action: 'auth.mfa', status: 'failure', details: { reason: 'bad_code' } });
      throw unauthorized('Invalid code');
    }
    await db.delete(sessions).where(eq(sessions.id, auth.sessionId));
    return completeLogin(req, reply, user);
  });

  app.post('/auth/logout', async (req, reply) => {
    if (req.auth?.sessionId) {
      await db.delete(sessions).where(eq(sessions.id, req.auth.sessionId));
      await audit.record(req, { action: 'auth.logout' });
    }
    clearSessionCookie(reply, ctx.secureCookies);
    return { ok: true };
  });

  app.get('/auth/me', async (req) => {
    if (!req.auth) throw unauthorized();
    return buildMe(db, req.auth);
  });

  app.patch('/auth/me', async (req) => {
    const auth = requireSession(req);
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(100).optional(),
        locale: z.enum(['de', 'en']).optional(),
      }),
      req.body,
    );
    const [user] = await db.update(users).set(body).where(eq(users.id, auth.user.id)).returning();
    return buildMe(db, { ...auth, user: user! });
  });

  app.post('/auth/password', async (req) => {
    const auth = requireSession(req);
    const body = parse(
      z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }),
      req.body,
    );
    if (!auth.user.passwordHash || !(await verifyPassword(body.currentPassword, auth.user.passwordHash))) {
      throw badRequest('Current password is wrong');
    }
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(body.newPassword) })
      .where(eq(users.id, auth.user.id));
    // Sign out everywhere else.
    await db.delete(sessions).where(and(eq(sessions.userId, auth.user.id), ne(sessions.id, auth.sessionId!)));
    await audit.record(req, {
      action: 'auth.password_change',
      resourceType: 'user',
      resourceId: auth.user.id,
    });
    return { ok: true };
  });

  // --- Two factor authentication -------------------------------------------------

  app.post('/auth/mfa/setup', async (req) => {
    const auth = requireSession(req);
    if (auth.user.totpEnabled) throw conflict('Two factor authentication is already enabled');
    const secret = generateTotpSecret();
    await db
      .update(users)
      .set({ totpSecretEnc: box.encrypt(secret) })
      .where(eq(users.id, auth.user.id));
    return totpSetupPayload(secret, auth.user.email);
  });

  app.post('/auth/mfa/enable', async (req) => {
    const auth = requireSession(req);
    const { code } = parse(mfaBody, req.body);
    if (!auth.user.totpSecretEnc) throw badRequest('Start the setup first');
    if (!verifyTotp(box.decrypt(auth.user.totpSecretEnc), code)) throw badRequest('Invalid code');
    await db.update(users).set({ totpEnabled: true }).where(eq(users.id, auth.user.id));
    await audit.record(req, { action: 'auth.mfa_enable', resourceType: 'user', resourceId: auth.user.id });
    return { ok: true };
  });

  app.post('/auth/mfa/disable', async (req) => {
    const auth = requireSession(req);
    const { password } = parse(z.object({ password: z.string().min(1) }), req.body);
    if (!auth.user.passwordHash || !(await verifyPassword(password, auth.user.passwordHash))) {
      throw badRequest('Password is wrong');
    }
    await db.update(users).set({ totpEnabled: false, totpSecretEnc: null }).where(eq(users.id, auth.user.id));
    await audit.record(req, { action: 'auth.mfa_disable', resourceType: 'user', resourceId: auth.user.id });
    return { ok: true };
  });

  // --- Sessions -------------------------------------------------------------------

  app.get('/auth/sessions', async (req): Promise<SessionDto[]> => {
    const auth = requireSession(req);
    const rows = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, auth.user.id),
          eq(sessions.mfaPending, false),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .orderBy(sql`${sessions.lastSeenAt} desc`);
    return rows.map((s) => ({
      id: s.id.slice(0, 16),
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      ip: s.ip,
      userAgent: s.userAgent,
      current: s.id === auth.sessionId,
    }));
  });

  app.delete('/auth/sessions/:id', async (req) => {
    const auth = requireSession(req);
    const { id } = parse(z.object({ id: z.string().regex(/^[a-f0-9]{16}$/) }), req.params);
    await db
      .delete(sessions)
      .where(
        and(
          eq(sessions.userId, auth.user.id),
          sql`left(${sessions.id}, 16) = ${id}`,
          ne(sessions.id, auth.sessionId!),
        ),
      );
    await audit.record(req, {
      action: 'auth.session_revoke',
      resourceType: 'user',
      resourceId: auth.user.id,
    });
    return { ok: true };
  });

  // --- Invitations ----------------------------------------------------------------

  async function loadInvitation(token: string) {
    const rows = await db
      .select({ invitation: invitations, org: organizations })
      .from(invitations)
      .innerJoin(organizations, eq(organizations.id, invitations.orgId))
      .where(
        and(
          eq(invitations.tokenHash, sha256(token)),
          isNull(invitations.acceptedAt),
          gt(invitations.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!rows[0]) throw notFound('Invitation');
    return rows[0];
  }

  app.get('/auth/invitations/:token', async (req) => {
    const { token } = parse(z.object({ token: z.string().min(20).max(100) }), req.params);
    const { invitation, org } = await loadInvitation(token);
    const existing = await db.query.users.findFirst({
      where: sql`lower(${users.email}) = lower(${invitation.email})`,
    });
    return {
      email: invitation.email,
      orgName: org.name,
      role: invitation.role,
      userExists: !!existing,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  });

  app.post('/auth/invitations/:token/accept', loginRateLimit, async (req, reply) => {
    const { token } = parse(z.object({ token: z.string().min(20).max(100) }), req.params);
    const body = parse(
      z.object({ name: z.string().trim().min(1).max(100).optional(), password: passwordSchema.optional() }),
      req.body ?? {},
    );
    const { invitation, org } = await loadInvitation(token);
    let user = await db.query.users.findFirst({
      where: sql`lower(${users.email}) = lower(${invitation.email})`,
    });

    if (user) {
      // Existing accounts accept while logged in, so nobody can attach an account they do not own.
      if (!req.auth || req.auth.mfaPending || req.auth.user.id !== user.id) {
        throw unauthorized('Please sign in as the invited user first');
      }
    } else {
      if (!body.name || !body.password) throw badRequest('Name and password are required');
      [user] = await db
        .insert(users)
        .values({ email: invitation.email, name: body.name, passwordHash: await hashPassword(body.password) })
        .returning();
    }

    await db.transaction(async (tx) => {
      await tx
        .insert(memberships)
        .values({ orgId: invitation.orgId, userId: user!.id, role: invitation.role })
        .onConflictDoNothing();
      await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, invitation.id));
    });

    if (!req.auth) await createSession(db, req, reply, user!.id, false, sessionOptions);
    req.auth = req.auth ?? { user: user!, sessionId: null, token: null, mfaPending: false };
    await audit.record(req, {
      action: 'member.join',
      orgId: org.id,
      resourceType: 'user',
      resourceId: user!.id,
      details: { role: invitation.role, via: 'invitation' },
    });
    return { ok: true, orgSlug: org.slug };
  });
}
