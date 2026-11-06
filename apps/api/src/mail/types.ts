import type { Locale } from '@weblion/shared';

/**
 * Mail contract used by every module that sends email. The implementation lives in
 * mail/service.ts (SMTP via nodemailer, settings from env or the admin area).
 *
 * Modules never build raw emails: they pick a template and pass its data. Templates
 * render German or English (mail/templates.ts) and share one HTML layout.
 */

/**
 * Any of the five console languages, so senders pass the recipient's users.locale as it is. Until the
 * templates render from the email.* keys, fr, it and nl get the English texts (plan 2.8).
 */
export type MailLocale = Locale;

export interface MailTemplates {
  /** Someone was invited to an organization (also used for new customer owners). */
  invitation: {
    orgName: string;
    inviterName: string | null;
    /** Translated role name. */
    role: string;
    link: string;
    expiresAt: string;
  };
  /** A finalized invoice. The PDF goes along as attachment. */
  invoice: {
    orgName: string;
    issuerName: string;
    invoiceNumber: string;
    /** Formatted, e.g. "CHF 123.45" */
    total: string;
    dueDate: string;
    link: string;
    /** True when the invoice is already fully paid (e.g. from credit). */
    paid: boolean;
  };
  /** Reminder for an overdue invoice. */
  invoice_reminder: {
    orgName: string;
    issuerName: string;
    invoiceNumber: string;
    amountDue: string;
    dueDate: string;
    link: string;
  };
  /** An online or manual payment was booked. */
  payment_received: {
    orgName: string;
    amount: string;
    invoiceNumber: string | null;
    link: string;
  };
  /** Credit was booked to the customer's account. */
  credit_booked: {
    orgName: string;
    amount: string;
    balance: string;
    description: string;
    link: string;
  };
  /** Test message from the admin area. */
  test: { sentBy: string };
  /** The monthly AI budget passed the warning mark or is used up (ai 7.2). */
  ai_budget: {
    kind: 'warning' | 'exhausted';
    /** Formatted in the mail language, e.g. "November 2026". */
    month: string;
    /** e.g. "USD 81.20" */
    spent: string;
    /** e.g. "USD 100.00" */
    budget: string;
    /** Rounded down; shown only for 'warning'. */
    percent: number;
    /** `${APP_URL}/admin/ai` */
    link: string;
  };
}

export type MailTemplateName = keyof MailTemplates;

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface MailOptions {
  to: string | string[];
  locale?: MailLocale;
  replyTo?: string | null;
  attachments?: MailAttachment[];
  /** For the mail log, so admins can filter by customer. */
  orgId?: string | null;
}

export interface MailResult {
  status: 'sent' | 'failed' | 'skipped';
  error?: string;
}

export interface Mailer {
  /** True when SMTP is configured (env or admin area). */
  isConfigured(): Promise<boolean>;
  /**
   * Renders and sends a template. Never throws: failures are logged to mail_log and
   * returned, so a broken SMTP server can't fail the request that triggered the mail.
   */
  send<T extends MailTemplateName>(
    template: T,
    data: MailTemplates[T],
    options: MailOptions,
  ): Promise<MailResult>;
}
