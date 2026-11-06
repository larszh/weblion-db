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
import type { I18nService } from './i18n/service';
import type { TranslationJobRunner } from './i18n/jobs';

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
  /** Server texts with the overrides of the translation admin (i18n 8.1). */
  i18n: I18nService;
  /** Mass Translate jobs (i18n 12.8); started by index.ts when I18N_JOB_ENABLED. */
  i18nJobs: TranslationJobRunner;
  secureCookies: boolean;
}
