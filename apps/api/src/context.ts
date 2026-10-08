import type { FastifyBaseLogger } from 'fastify';
import type { AuditService } from './audit';
import type { AccessService } from './auth/access';
import type { Env } from './config/env';
import type { Database } from './db/client';
import type { SecretBox } from './lib/crypto';
import type { ProviderRegistry } from './providers/registry';
import type { ConsoleTickets } from './modules/servers/console';
import type { SyncService } from './jobs/sync';
import type { Mailer } from './mail/types';
import type { ZohoService } from './integrations/zoho';

/** Everything route modules need, wired once at startup. */
export interface AppContext {
  env: Env;
  db: Database;
  box: SecretBox;
  log: FastifyBaseLogger;
  providers: ProviderRegistry;
  access: AccessService;
  audit: AuditService;
  consoleTickets: ConsoleTickets;
  sync: SyncService;
  mail: Mailer;
  zoho: ZohoService;
  secureCookies: boolean;
}
