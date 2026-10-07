import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import type { Database } from './db/client';
import { auditLogs } from './db/schema';

export interface AuditEntry {
  action: string;
  orgId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  status?: 'success' | 'failure' | 'denied';
  details?: Record<string, unknown> | null;
  /** Overrides the actor taken from the request, e.g. for failed logins. */
  actorUserId?: string | null;
  actorName?: string | null;
}

/** Append-only audit trail. Writing never fails the request that triggered it. */
export class AuditService {
  constructor(
    private readonly db: Database,
    private readonly log: FastifyBaseLogger,
  ) {}

  async record(req: FastifyRequest | null, entry: AuditEntry): Promise<void> {
    const auth = req?.auth ?? null;
    try {
      await this.db.insert(auditLogs).values({
        action: entry.action,
        orgId: entry.orgId ?? null,
        resourceType: entry.resourceType ?? null,
        resourceId: entry.resourceId ?? null,
        status: entry.status ?? 'success',
        details: entry.details ?? null,
        actorUserId: entry.actorUserId !== undefined ? entry.actorUserId : (auth?.user.id ?? null),
        actorTokenId: auth?.token?.id ?? null,
        actorName:
          entry.actorName !== undefined
            ? entry.actorName
            : auth
              ? `${auth.user.name}${auth.token ? ` (Token ${auth.token.name})` : ''}`
              : null,
        ip: req?.ip ?? null,
        userAgent: req?.headers['user-agent']?.slice(0, 300) ?? null,
      });
    } catch (err) {
      this.log.error({ err, entry }, 'failed to write audit log');
    }
  }
}
