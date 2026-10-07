import type { FastifyBaseLogger } from 'fastify';
import type { Env } from '../config/env';
import type { Database } from '../db/client';
import type { SecretBox } from '../lib/crypto';
import type { Mailer, MailOptions, MailResult, MailTemplateName, MailTemplates } from './types';

/**
 * PLACEHOLDER: replaced by the real SMTP implementation (nodemailer, settings from env or
 * the encrypted "smtp" row in the settings table, mail_log entries, templates).
 * Until then every mail is skipped.
 */
export class MailService implements Mailer {
  constructor(
    private readonly db: Database,
    private readonly box: SecretBox,
    private readonly env: Env,
    private readonly log: FastifyBaseLogger,
  ) {}

  async isConfigured(): Promise<boolean> {
    return false;
  }

  async send<T extends MailTemplateName>(
    template: T,
    _data: MailTemplates[T],
    options: MailOptions,
  ): Promise<MailResult> {
    this.log.debug({ template, to: options.to }, 'mail skipped (not implemented yet)');
    return { status: 'skipped', error: 'SMTP is not configured' };
  }
}
