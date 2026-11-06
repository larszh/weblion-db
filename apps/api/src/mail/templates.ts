import {
  fallbackChain,
  interpolate,
  intlLocale,
  normalizeLocale,
  type I18nParams,
  type Locale,
  type OrgRole,
  type ServerTranslationKey,
} from '@weblion/shared';
import { loadCatalog } from '@weblion/shared/i18n/catalog';
import type { Tr } from '../i18n/service';
import type { MailLocale, MailTemplateName, MailTemplates } from './types';

/**
 * Email templates from the email.* keys (i18n 8.2, plan O15). Every template is described as a short list of
 * blocks that render to both the plain text part and the HTML part, so the two never drift apart and every
 * interpolated value goes through one escaping function. The texts come from a translator `Tr` of the mail's
 * language: MailService passes the I18nService's (overrides included); without one the compiled texts with
 * the fallback chain fr, it, nl -> en -> de are used.
 */

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

type Block =
  | { p: string }
  /** Label/value rows, e.g. amount and due date. */
  | { facts: [string, string][] }
  | { button: { label: string; href: string } }
  /** Small grey print below the main content. */
  | { note: string };

interface Content {
  subject: string;
  heading: string;
  blocks: Block[];
}

const BRAND = 'weblion.one';
const TEAL = '#00C8CB';
/** Dark text on the teal brand color keeps the contrast readable (white would not). */
const ON_TEAL = '#0f1b2d';
const TEXT = '#0f1b2d';
const MUTED = '#5a6a7e';
const SUBTLE = '#8593a5';
const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * The compiled texts of a locale without overrides, along the fallback chain (fr -> en -> de). For callers
 * without the I18nService (tests, scripts); the service's translator adds the overrides on top.
 */
export function catalogTranslator(locale: Locale): Tr {
  const catalog = loadCatalog();
  const chain = fallbackChain(locale);
  return (key: ServerTranslationKey, params?: I18nParams) => {
    for (const l of chain) {
      const value = catalog.bundles[l][key];
      if (value !== undefined) return interpolate(value, params);
    }
    return interpolate(key, params);
  };
}

/** Role name as shown in the console (the core keys role.*), for the invitation template. */
export function roleLabel(role: OrgRole, tr: Tr): string {
  return tr(`role.${role}`);
}

/** A stored language (users.locale) as a mail language; unknown values give German. */
export function mailLocale(value: string | null | undefined): MailLocale {
  return normalizeLocale(value) ?? 'de';
}

/** Date for mail texts in the mail language, e.g. "14. Oktober 2026" or "14 October 2026" (Swiss time). */
export function mailDate(date: Date, locale: MailLocale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: 'long',
    timeZone: 'Europe/Zurich',
  }).format(date);
}

type Builders = { [K in MailTemplateName]: (data: MailTemplates[K], tr: Tr) => Content };

/** The closing line of the billing mails: "Freundliche Grüsse" and the issuer's name below it. */
const closing = (tr: Tr, issuer: string) => `${tr('email.common.closing')}\n${issuer}`;

const TEMPLATES: Builders = {
  invitation: (d, tr) => {
    const inviter = d.inviterName ?? tr('email.invitation.someone');
    return {
      subject: tr('email.invitation.subject', { org: d.orgName }),
      heading: tr('email.invitation.heading', { org: d.orgName }),
      blocks: [
        { p: tr('email.common.greeting') },
        { p: tr('email.invitation.text', { inviter, org: d.orgName }) },
        {
          facts: [
            [tr('email.invitation.role'), d.role],
            [tr('email.invitation.validUntil'), d.expiresAt],
          ],
        },
        { button: { label: tr('email.invitation.button'), href: d.link } },
        { note: tr('email.invitation.note') },
      ],
    };
  },

  invoice: (d, tr) => {
    const names = { number: d.invoiceNumber, issuer: d.issuerName, org: d.orgName };
    return {
      subject: tr(d.paid ? 'email.invoice.subjectPaid' : 'email.invoice.subject', names),
      heading: tr('email.invoice.heading', names),
      blocks: [
        { p: tr('email.common.greeting') },
        { p: tr('email.invoice.text', names) },
        {
          facts: [
            [tr('email.invoice.amount'), d.total],
            d.paid
              ? [tr('email.invoice.status'), tr('email.invoice.statusPaid')]
              : [tr('email.invoice.dueDate'), d.dueDate],
          ],
        },
        { p: tr(d.paid ? 'email.invoice.paidText' : 'email.invoice.openText') },
        { button: { label: tr('email.invoice.button'), href: d.link } },
        { p: closing(tr, d.issuerName) },
      ],
    };
  },

  invoice_reminder: (d, tr) => {
    const names = { number: d.invoiceNumber, org: d.orgName };
    return {
      subject: tr('email.reminder.subject', names),
      heading: tr('email.reminder.heading'),
      blocks: [
        { p: tr('email.common.greeting') },
        { p: tr('email.reminder.text', names) },
        {
          facts: [
            [tr('email.reminder.amountDue'), d.amountDue],
            [tr('email.reminder.dueSince'), d.dueDate],
          ],
        },
        { button: { label: tr('email.reminder.button'), href: d.link } },
        { note: tr('email.reminder.note') },
        { p: closing(tr, d.issuerName) },
      ],
    };
  },

  payment_received: (d, tr) => ({
    subject: tr('email.payment.subject', { amount: d.amount }),
    heading: tr('email.payment.heading'),
    blocks: [
      { p: tr('email.common.greeting') },
      { p: tr('email.payment.text', { org: d.orgName }) },
      {
        facts: [
          [tr('email.payment.amount'), d.amount],
          ...(d.invoiceNumber ? [[tr('email.payment.invoice'), d.invoiceNumber] as [string, string]] : []),
        ],
      },
      { button: { label: tr('email.payment.button'), href: d.link } },
    ],
  }),

  credit_booked: (d, tr) => ({
    subject: tr('email.credit.subject', { amount: d.amount }),
    heading: tr('email.credit.heading'),
    blocks: [
      { p: tr('email.common.greeting') },
      { p: tr('email.credit.text', { org: d.orgName }) },
      {
        facts: [
          [tr('email.credit.amount'), d.amount],
          [tr('email.credit.description'), d.description],
          [tr('email.credit.balance'), d.balance],
        ],
      },
      { button: { label: tr('email.credit.button'), href: d.link } },
    ],
  }),

  test: (d, tr) => ({
    subject: tr('email.test.subject'),
    heading: tr('email.test.heading'),
    blocks: [{ p: tr('email.test.text', { name: d.sentBy }) }, { p: tr('email.test.check') }],
  }),

  ai_budget: (d, tr) => {
    const values = { month: d.month, spent: d.spent, budget: d.budget, percent: d.percent };
    const kind = d.kind === 'warning' ? 'warning' : 'exhausted';
    return {
      subject: tr(`email.aiBudget.${kind}.subject`, values),
      heading: tr(`email.aiBudget.${kind}.heading`, values),
      blocks: [
        { p: tr(`email.aiBudget.${kind}.text`, values) },
        { button: { label: tr('email.aiBudget.button'), href: d.link } },
      ],
    };
  },
};

/**
 * Renders a template in a language. `tr` is the translator of that language (MailService passes
 * ctx.i18n.translator(locale), overrides included); without it the compiled texts are used.
 */
export function renderMail<T extends MailTemplateName>(
  template: T,
  data: MailTemplates[T],
  locale: MailLocale = 'de',
  tr: Tr = catalogTranslator(locale),
): RenderedMail {
  const content = (TEMPLATES[template] as (d: MailTemplates[T], tr: Tr) => Content)(data, tr);
  // Header injection: a subject is one line, whatever the data contains.
  const subject = content.subject.replace(/[\r\n]+/g, ' ').trim();
  const layout = { footer: tr('email.layout.footer'), buttonFallback: tr('email.layout.buttonFallback') };
  return { subject, text: renderText(content, layout), html: renderHtml(content, subject, locale, layout) };
}

/** The texts of the layout around every template. */
interface Layout {
  footer: string;
  buttonFallback: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only http(s) links become clickable, anything else (javascript:, data:) is dropped. */
function safeHref(href: string): string | null {
  return /^https?:\/\//i.test(href) ? href : null;
}

const html = (value: string) => escapeHtml(value).replace(/\n/g, '<br>');

function renderText(content: Content, layout: Layout): string {
  const parts: string[] = [content.heading, ''];
  for (const block of content.blocks) {
    if ('p' in block) parts.push(block.p, '');
    else if ('note' in block) parts.push(block.note, '');
    else if ('facts' in block) parts.push(...block.facts.map(([k, v]) => `${k}: ${v}`), '');
    else parts.push(`${block.button.label}: ${block.button.href}`, '');
  }
  parts.push('--', layout.footer);
  return parts.join('\n');
}

function renderHtml(content: Content, subject: string, locale: MailLocale, layout: Layout): string {
  const body = content.blocks.map((block) => renderBlock(block, layout)).join('\n');
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f5f8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f5f8;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:8px;">
<tr><td style="background-color:${TEAL};border-radius:8px 8px 0 0;padding:18px 32px;font-family:${FONT};font-size:20px;font-weight:bold;letter-spacing:0.2px;color:${ON_TEAL};">${BRAND}</td></tr>
<tr><td style="padding:32px;font-family:${FONT};font-size:15px;line-height:1.6;color:${TEXT};">
<h1 style="margin:0 0 20px 0;font-family:${FONT};font-size:22px;line-height:1.3;color:${TEXT};">${html(content.heading)}</h1>
${body}
</td></tr>
</table>
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr><td style="padding:16px 32px;font-family:${FONT};font-size:12px;line-height:1.5;color:${SUBTLE};text-align:center;">${html(layout.footer)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}

function renderBlock(block: Block, layout: Layout): string {
  if ('p' in block) return `<p style="margin:0 0 16px 0;">${html(block.p)}</p>`;
  if ('note' in block) {
    return `<p style="margin:0 0 16px 0;font-size:13px;color:${MUTED};">${html(block.note)}</p>`;
  }
  if ('facts' in block) {
    const rows = block.facts
      .map(
        ([k, v]) =>
          `<tr><td style="padding:4px 16px 4px 0;font-family:${FONT};font-size:14px;color:${MUTED};white-space:nowrap;vertical-align:top;">${html(k)}</td><td style="padding:4px 0;font-family:${FONT};font-size:14px;font-weight:bold;color:${TEXT};">${html(v)}</td></tr>`,
      )
      .join('');
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;">${rows}</table>`;
  }
  const href = safeHref(block.button.href);
  if (!href) return `<p style="margin:0 0 16px 0;">${html(block.button.label)}</p>`;
  const link = escapeHtml(href);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;"><tr><td style="background-color:${TEAL};border-radius:6px;"><a href="${link}" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:15px;font-weight:bold;color:${ON_TEAL};text-decoration:none;border-radius:6px;">${html(block.button.label)}</a></td></tr></table>
<p style="margin:0 0 16px 0;font-size:12px;line-height:1.5;color:${SUBTLE};">${html(layout.buttonFallback)}<br><a href="${link}" style="color:${MUTED};word-break:break-all;">${link}</a></p>`;
}
