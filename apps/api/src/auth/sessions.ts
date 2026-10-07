import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../db/client';
import { apiTokens, sessions, users } from '../db/schema';
import { randomToken, sha256 } from '../lib/crypto';
import type { AuthState } from './types';

export const SESSION_COOKIE = 'wl_session';
export const TOKEN_PREFIX = 'wlc';

export interface SessionOptions {
  ttlHours: number;
  secureCookies: boolean;
}

export async function createSession(
  db: Database,
  req: FastifyRequest,
  reply: FastifyReply,
  userId: string,
  mfaPending: boolean,
  options: SessionOptions,
): Promise<string> {
  const raw = randomToken(32);
  const id = sha256(raw);
  // A half logged in session (waiting for TOTP) only lives for 10 minutes.
  const ttlMs = mfaPending ? 10 * 60_000 : options.ttlHours * 3600_000;
  await db.insert(sessions).values({
    id,
    userId,
    mfaPending,
    ip: req.ip,
    userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
    expiresAt: new Date(Date.now() + ttlMs),
  });
  reply.setCookie(SESSION_COOKIE, raw, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: options.secureCookies,
    maxAge: Math.floor(ttlMs / 1000),
  });
  return id;
}

export function clearSessionCookie(reply: FastifyReply, secureCookies: boolean) {
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: secureCookies });
}

export async function resolveSession(db: Database, raw: string, ttlHours: number): Promise<AuthState | null> {
  const id = sha256(raw);
  const row = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const found = row[0];
  if (!found || found.user.status !== 'active') return null;

  // Sliding expiry, written at most every five minutes.
  if (!found.session.mfaPending && Date.now() - found.session.lastSeenAt.getTime() > 5 * 60_000) {
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + ttlHours * 3600_000) })
      .where(eq(sessions.id, id));
  }
  return { user: found.user, sessionId: id, token: null, mfaPending: found.session.mfaPending };
}

export function generateApiToken(): { token: string; prefix: string; hash: string } {
  const prefix = randomToken(6).replace(/[-_]/g, 'x').slice(0, 8);
  const token = `${TOKEN_PREFIX}_${prefix}_${randomToken(32)}`;
  return { token, prefix: `${TOKEN_PREFIX}_${prefix}`, hash: sha256(token) };
}

export async function resolveApiToken(db: Database, raw: string): Promise<AuthState | null> {
  if (!raw.startsWith(`${TOKEN_PREFIX}_`)) return null;
  const rows = await db
    .select({ token: apiTokens, user: users })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(
      and(
        eq(apiTokens.tokenHash, sha256(raw)),
        isNull(apiTokens.revokedAt),
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, new Date())),
      ),
    )
    .limit(1);
  const found = rows[0];
  if (!found || found.user.status !== 'active') return null;

  if (!found.token.lastUsedAt || Date.now() - found.token.lastUsedAt.getTime() > 60_000) {
    await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, found.token.id));
  }
  return { user: found.user, sessionId: null, token: found.token, mfaPending: false };
}
