import type { OrgRole } from '@weblion/shared';
import type { MailLocale, MailTemplateName, MailTemplates } from './types';

/**
 * Email templates in German and English. Every template is described as a short list of
 * blocks that render to both the plain text part and the HTML part, so the two never drift
 * apart and every interpolated value goes through one escaping function.
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

const ROLE_LABELS: Record<OrgRole, Record<MailLocale, string>> = {
  owner: { de: 'Owner', en: 'Owner' },
  admin: { de: 'Admin', en: 'Admin' },
  member: { de: 'Member', en: 'Member' },
  restricted: { de: 'Eingeschränkt', en: 'Restricted' },
  viewer: { de: 'Nur lesen', en: 'Read only' },
  billing: { de: 'Buchhaltung', en: 'Billing' },
};

/** Role name as shown in the console, for the invitation template. */
export function roleLabel(role: OrgRole, locale: MailLocale): string {
  return ROLE_LABELS[role]?.[locale] ?? role;
}

export function mailLocale(value: string | null | undefined): MailLocale {
  return value?.toLowerCase().startsWith('en') ? 'en' : 'de';
}

/** Date for mail texts, e.g. "14. Oktober 2026" or "14 October 2026" (Swiss time). */
export function mailDate(date: Date, locale: MailLocale): string {
  return new Intl.DateTimeFormat(locale === 'de' ? 'de-CH' : 'en-GB', {
    dateStyle: 'long',
    timeZone: 'Europe/Zurich',
  }).format(date);
}

type Builders = { [K in MailTemplateName]: (data: MailTemplates[K], locale: MailLocale) => Content };

const TEMPLATES: Builders = {
  invitation: (d, l) => {
    const inviter = d.inviterName ?? (l === 'de' ? 'Jemand' : 'Someone');
    return l === 'de'
      ? {
          subject: `Einladung zu ${d.orgName} auf ${BRAND}`,
          heading: `Einladung zu ${d.orgName}`,
          blocks: [
            { p: 'Guten Tag' },
            { p: `${inviter} hat Sie eingeladen, der Organisation ${d.orgName} auf ${BRAND} beizutreten.` },
            {
              facts: [
                ['Rolle', d.role],
                ['Gültig bis', d.expiresAt],
              ],
            },
            { button: { label: 'Einladung annehmen', href: d.link } },
            {
              note: 'Falls Sie diese Einladung nicht erwartet haben, können Sie diese E-Mail ignorieren.',
            },
          ],
        }
      : {
          subject: `Invitation to ${d.orgName} on ${BRAND}`,
          heading: `Invitation to ${d.orgName}`,
          blocks: [
            { p: 'Hello' },
            { p: `${inviter} invited you to join the organization ${d.orgName} on ${BRAND}.` },
            {
              facts: [
                ['Role', d.role],
                ['Valid until', d.expiresAt],
              ],
            },
            { button: { label: 'Accept invitation', href: d.link } },
            { note: 'If you did not expect this invitation, you can ignore this email.' },
          ],
        };
  },

  invoice: (d, l) =>
    l === 'de'
      ? {
          subject: `Rechnung ${d.invoiceNumber} von ${d.issuerName}${d.paid ? ' (bezahlt)' : ''}`,
          heading: `Rechnung ${d.invoiceNumber}`,
          blocks: [
            { p: 'Guten Tag' },
            { p: `Im Anhang finden Sie die Rechnung ${d.invoiceNumber} für ${d.orgName}.` },
            {
              facts: [['Betrag', d.total], d.paid ? ['Status', 'Bezahlt'] : ['Zahlbar bis', d.dueDate]],
            },
            {
              p: d.paid
                ? 'Die Rechnung ist bereits bezahlt, Sie müssen nichts weiter tun.'
                : 'Sie können die Rechnung auch in der Konsole ansehen und bezahlen.',
            },
            { button: { label: 'Rechnung ansehen', href: d.link } },
            { p: `Freundliche Grüsse\n${d.issuerName}` },
          ],
        }
      : {
          subject: `Invoice ${d.invoiceNumber} from ${d.issuerName}${d.paid ? ' (paid)' : ''}`,
          heading: `Invoice ${d.invoiceNumber}`,
          blocks: [
            { p: 'Hello' },
            { p: `Please find attached invoice ${d.invoiceNumber} for ${d.orgName}.` },
            {
              facts: [['Amount', d.total], d.paid ? ['Status', 'Paid'] : ['Due date', d.dueDate]],
            },
            {
              p: d.paid
                ? 'The invoice is already paid, there is nothing left to do.'
                : 'You can also view and pay the invoice in the console.',
            },
            { button: { label: 'View invoice', href: d.link } },
            { p: `Kind regards\n${d.issuerName}` },
          ],
        },

  invoice_reminder: (d, l) =>
    l === 'de'
      ? {
          subject: `Zahlungserinnerung: Rechnung ${d.invoiceNumber}`,
          heading: 'Zahlungserinnerung',
          blocks: [
            { p: 'Guten Tag' },
            {
              p: `Die Rechnung ${d.invoiceNumber} für ${d.orgName} ist noch offen. Bitte begleichen Sie den offenen Betrag.`,
            },
            {
              facts: [
                ['Offener Betrag', d.amountDue],
                ['Fällig seit', d.dueDate],
              ],
            },
            { button: { label: 'Rechnung ansehen', href: d.link } },
            {
              note: 'Falls Sie die Zahlung bereits ausgelöst haben, betrachten Sie diese E-Mail als erledigt.',
            },
            { p: `Freundliche Grüsse\n${d.issuerName}` },
          ],
        }
      : {
          subject: `Payment reminder: invoice ${d.invoiceNumber}`,
          heading: 'Payment reminder',
          blocks: [
            { p: 'Hello' },
            { p: `Invoice ${d.invoiceNumber} for ${d.orgName} is still open. Please pay the amount due.` },
            {
              facts: [
                ['Amount due', d.amountDue],
                ['Due since', d.dueDate],
              ],
            },
            { button: { label: 'View invoice', href: d.link } },
            { note: 'If you have already paid, please ignore this email.' },
            { p: `Kind regards\n${d.issuerName}` },
          ],
        },

  payment_received: (d, l) =>
    l === 'de'
      ? {
          subject: `Zahlung erhalten: ${d.amount}`,
          heading: 'Vielen Dank für Ihre Zahlung',
          blocks: [
            { p: 'Guten Tag' },
            { p: `Wir haben Ihre Zahlung für ${d.orgName} erhalten.` },
            {
              facts: [
                ['Betrag', d.amount],
                ...(d.invoiceNumber ? [['Rechnung', d.invoiceNumber] as [string, string]] : []),
              ],
            },
            { button: { label: 'Zur Abrechnung', href: d.link } },
          ],
        }
      : {
          subject: `Payment received: ${d.amount}`,
          heading: 'Thank you for your payment',
          blocks: [
            { p: 'Hello' },
            { p: `We have received your payment for ${d.orgName}.` },
            {
              facts: [
                ['Amount', d.amount],
                ...(d.invoiceNumber ? [['Invoice', d.invoiceNumber] as [string, string]] : []),
              ],
            },
            { button: { label: 'Go to billing', href: d.link } },
          ],
        },

  credit_booked: (d, l) =>
    l === 'de'
      ? {
          subject: `Guthaben verbucht: ${d.amount}`,
          heading: 'Guthaben verbucht',
          blocks: [
            { p: 'Guten Tag' },
            { p: `Auf dem Konto von ${d.orgName} wurde eine Gutschrift oder Korrektur verbucht.` },
            {
              facts: [
                ['Betrag', d.amount],
                ['Beschreibung', d.description],
                ['Neues Guthaben', d.balance],
              ],
            },
            { button: { label: 'Guthaben ansehen', href: d.link } },
          ],
        }
      : {
          subject: `Credit booked: ${d.amount}`,
          heading: 'Credit booked',
          blocks: [
            { p: 'Hello' },
            { p: `A credit or correction was booked to the account of ${d.orgName}.` },
            {
              facts: [
                ['Amount', d.amount],
                ['Description', d.description],
                ['New balance', d.balance],
              ],
            },
            { button: { label: 'View credit', href: d.link } },
          ],
        },

  test: (d, l) =>
    l === 'de'
      ? {
          subject: `Test-E-Mail von ${BRAND}`,
          heading: 'Der E-Mail-Versand funktioniert',
          blocks: [
            { p: `Diese Test-E-Mail wurde von ${d.sentBy} im Adminbereich ausgelöst.` },
            { p: 'Wenn Sie diese Nachricht lesen, sind die SMTP-Einstellungen korrekt.' },
          ],
        }
      : {
          subject: `Test email from ${BRAND}`,
          heading: 'Email delivery works',
          blocks: [
            { p: `This test email was sent by ${d.sentBy} from the admin area.` },
            { p: 'If you can read this message, the SMTP settings are correct.' },
          ],
        },
};

const FOOTER: Record<MailLocale, string> = {
  de: `Diese E-Mail wurde automatisch von ${BRAND} versendet.`,
  en: `This email was sent automatically by ${BRAND}.`,
};

const BUTTON_FALLBACK: Record<MailLocale, string> = {
  de: 'Falls der Button nicht funktioniert, öffnen Sie diesen Link:',
  en: 'If the button does not work, open this link:',
};

export function renderMail<T extends MailTemplateName>(
  template: T,
  data: MailTemplates[T],
  locale: MailLocale = 'de',
): RenderedMail {
  const content = (TEMPLATES[template] as (d: MailTemplates[T], l: MailLocale) => Content)(data, locale);
  // Header injection: a subject is one line, whatever the data contains.
  const subject = content.subject.replace(/[\r\n]+/g, ' ').trim();
  return { subject, text: renderText(content, locale), html: renderHtml(content, subject, locale) };
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

function renderText(content: Content, locale: MailLocale): string {
  const parts: string[] = [content.heading, ''];
  for (const block of content.blocks) {
    if ('p' in block) parts.push(block.p, '');
    else if ('note' in block) parts.push(block.note, '');
    else if ('facts' in block) parts.push(...block.facts.map(([k, v]) => `${k}: ${v}`), '');
    else parts.push(`${block.button.label}: ${block.button.href}`, '');
  }
  parts.push('--', FOOTER[locale]);
  return parts.join('\n');
}

function renderHtml(content: Content, subject: string, locale: MailLocale): string {
  const body = content.blocks.map((block) => renderBlock(block, locale)).join('\n');
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
<tr><td style="padding:16px 32px;font-family:${FONT};font-size:12px;line-height:1.5;color:${SUBTLE};text-align:center;">${html(FOOTER[locale])}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}

function renderBlock(block: Block, locale: MailLocale): string {
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
<p style="margin:0 0 16px 0;font-size:12px;line-height:1.5;color:${SUBTLE};">${html(BUTTON_FALLBACK[locale])}<br><a href="${link}" style="color:${MUTED};word-break:break-all;">${link}</a></p>`;
}
