import nodemailer, { type Transporter } from 'nodemailer';
import type { FastifyBaseLogger } from 'fastify';
import type { Env } from '../config/env';
import type { Database } from '../db/client';
import { mailLog } from '../db/schema';
import type { SecretBox } from '../lib/crypto';
import { renderMail, type RenderedMail } from './templates';
import { configFingerprint, resolveSmtp, senderAddress, type SmtpConfig } from './settings';
import type { Mailer, MailOptions, MailResult, MailTemplateName, MailTemplates } from './types';

/** Builds a nodemailer transport for one SMTP configuration. Replaceable in tests. */
export type TransportFactory = (config: SmtpConfig) => Transporter;

const TIMEOUT_MS = 10_000;

export const smtpTransport: TransportFactory = (config) =>
  nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.password ?? '' } : undefined,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 1000);

/**
 * SMTP delivery via nodemailer. Settings come from env or the admin area (mail/settings.ts)
 * and are read on every send, so changes apply without a restart; the transport is reused
 * as long as the settings stay the same. Every send leaves one row in mail_log.
 */
export class MailService implements Mailer {
  private factory: TransportFactory = smtpTransport;
  private cached: { key: string; transport: Transporter } | null = null;

  constructor(
    private readonly db: Database,
    private readonly box: SecretBox,
    private readonly env: Env,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** For tests: deliver through e.g. a nodemailer jsonTransport or a custom transport. */
  useTransportFactory(factory: TransportFactory): void {
    this.factory = factory;
    this.reset();
  }

  async isConfigured(): Promise<boolean> {
    try {
      return (await resolveSmtp(this.db, this.box, this.env)).config !== null;
    } catch (err) {
      this.log.error({ err }, 'mail settings could not be read');
      return false;
    }
  }

  async send<T extends MailTemplateName>(
    template: T,
    data: MailTemplates[T],
    options: MailOptions,
  ): Promise<MailResult> {
    const to = (Array.isArray(options.to) ? options.to : [options.to]).map((a) => a.trim()).filter(Boolean);
    let rendered: RenderedMail | null = null;
    let result: MailResult;
    try {
      rendered = renderMail(template, data, options.locale ?? 'de');
      result = await this.deliver(rendered, to, options);
    } catch (err) {
      result = { status: 'failed', error: errorMessage(err) };
    }
    if (result.status === 'failed') {
      this.log.warn({ template, error: result.error }, 'mail delivery failed');
    }
    await this.record(template, to, rendered?.subject ?? template, result, options.orgId ?? null);
    return result;
  }

  private async deliver(rendered: RenderedMail, to: string[], options: MailOptions): Promise<MailResult> {
    if (to.length === 0) return { status: 'skipped', error: 'No recipient' };
    const { config } = await resolveSmtp(this.db, this.box, this.env);
    if (!config) return { status: 'skipped', error: 'SMTP is not configured' };
    try {
      await this.transport(config).sendMail({
        from: senderAddress(config, this.env.APP_URL),
        to,
        replyTo: options.replyTo || config.replyTo || undefined,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        attachments: options.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      });
      return { status: 'sent' };
    } catch (err) {
      // A broken connection may poison the pooled transport: start fresh next time.
      this.reset();
      return { status: 'failed', error: errorMessage(err) };
    }
  }

  private transport(config: SmtpConfig): Transporter {
    const key = configFingerprint(config);
    if (this.cached?.key !== key) {
      this.reset();
      this.cached = { key, transport: this.factory(config) };
    }
    return this.cached.transport;
  }

  private reset(): void {
    try {
      this.cached?.transport.close();
    } catch {
      // nothing to clean up
    }
    this.cached = null;
  }

  private async record(
    template: MailTemplateName,
    to: string[],
    subject: string,
    result: MailResult,
    orgId: string | null,
  ): Promise<void> {
    try {
      await this.db.insert(mailLog).values({
        to: to.join(', ').slice(0, 2000) || '-',
        subject: subject.slice(0, 500),
        template,
        status: result.status,
        error: result.error ?? null,
        orgId,
      });
    } catch (err) {
      this.log.error({ err, template }, 'failed to write mail log');
    }
  }
}
