import type { ApiToken, User } from '../db/schema';

export interface AuthState {
  user: User;
  /** Set when authenticated with a session cookie. */
  sessionId: string | null;
  /** Set when authenticated with an API token. */
  token: ApiToken | null;
  /** Password was correct but the second factor is still missing. */
  mfaPending: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthState | null;
    /** Per request cache for access subjects, keyed by organization id. */
    accessCache: Map<string, unknown>;
  }
}
