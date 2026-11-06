import PDFDocument from 'pdfkit';
import { SwissQRBill } from 'swissqrbill/pdf';
import { isQRIBAN } from 'swissqrbill/utils';
import { intlLocale, invoiceTotals, type InvoiceIssuerSettings, type Locale } from '@weblion/shared';
import type { Invoice, InvoiceLine, Organization } from '../../db/schema';
import type { Tr } from '../../i18n/service';
import type { BillingAddress } from './dto';
import { formatDateCH } from './dates';

/**
 * Invoice PDF: A4, recipient in the left window of a C5/DL envelope, line items, tax
 * breakdown, totals and, when the issuer has an IBAN, a Swiss QR bill on its own page.
 * Uses the PDF standard fonts, so no font files need to ship with the API: every pdf.* text
 * must be encodable in Windows-1252 (i18n 8.3).
 *
 * Texts come from the pdf.* keys in the invoice's language and are computed first
 * (invoicePdfTexts), so they can be tested without parsing a PDF. Numbers, amounts and dates
 * stay Swiss in every language (plan decision 2), and the payment reference stays the German
 * "Rechnung <Nr>" so bank reconciliation never depends on the customer's language.
 */

const MM = 72 / 25.4;
const TEAL = '#00C8CB';
const INK = '#1f2933';
const MUTED = '#6b7280';
const RULE = '#d9dee3';

const PAGE = { width: 595.28, height: 841.89 };
const LEFT = 22 * MM;
const RIGHT = PAGE.width - 18 * MM;
const WIDTH = RIGHT - LEFT;
/** Content stops here, the footer lives below. */
const CONTENT_BOTTOM = PAGE.height - 30 * MM;

const QR_CURRENCIES = ['CHF', 'EUR'] as const;

export interface InvoicePdfInput {
  invoice: Invoice;
  lines: InvoiceLine[];
  org: Pick<Organization, 'name' | 'slug'>;
  /** Snapshot for finalized invoices, current settings for drafts. */
  issuer: InvoiceIssuerSettings;
  address: BillingAddress | null;
  /** The invoice's language (invoices.locale, else the billing language for drafts). */
  locale: Locale;
  /** ctx.i18n.translator(locale): the pdf.* texts with their overrides. */
  tr: Tr;
}

// Swiss formats in every language, like the QR bill and the bank statement (i18n 2.3, 8.3).
const number2 = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantityFormat = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 3 });

const money = (minor: number) => number2.format(minor / 100);

const regionNames = new Map<Locale, Intl.DisplayNames | null>();

/** The name of a country in the invoice language ("Deutschland", "Allemagne", "Germany"). */
function countryName(code: string, locale: Locale): string {
  if (!regionNames.has(locale)) {
    try {
      regionNames.set(locale, new Intl.DisplayNames([intlLocale(locale)], { type: 'region' }));
    } catch {
      regionNames.set(locale, null);
    }
  }
  try {
    return regionNames.get(locale)?.of(code) ?? code;
  } catch {
    return code;
  }
}
const rate = (bp: number) => `${quantityFormat.format(bp / 100)} %`;

/** The language of the QR bill's payment part; swissqrbill has DE, EN, FR, IT, so Dutch uses English. */
export function qrBillLanguage(locale: Locale): 'DE' | 'EN' | 'FR' | 'IT' {
  return ({ de: 'DE', en: 'EN', fr: 'FR', it: 'IT', nl: 'EN' } as const)[locale];
}

/** The payment reference in the QR message and the transfer paragraph: German in every language. */
export function paymentReference(invoiceNumber: string): string {
  return `Rechnung ${invoiceNumber}`;
}

/**
 * 27 digit QR reference for QR-IBANs: the digits of the invoice number, zero padded to 26,
 * plus the recursive mod 10 check digit.
 */
export function qrReference(invoiceNumber: string): string {
  const digits = invoiceNumber.replace(/\D/g, '').slice(-26).padStart(26, '0');
  return digits + mod10CheckDigit(digits);
}

export function mod10CheckDigit(digits: string): string {
  const table = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5];
  let carry = 0;
  for (const ch of digits) carry = table[(carry + Number(ch)) % 10]!;
  return String((10 - carry) % 10);
}

function addressLines(
  a: {
    companyName?: string | null;
    contactName?: string | null;
    line1?: string | null;
    line2?: string | null;
    postalCode?: string | null;
    city?: string | null;
    country?: string | null;
  },
  locale: Locale,
): string[] {
  return [
    a.companyName,
    a.contactName,
    a.line1,
    a.line2,
    [a.postalCode, a.city].filter(Boolean).join(' '),
    a.country && a.country !== 'CH' ? countryName(a.country, locale) : null,
  ].filter((l): l is string => !!l && l.trim() !== '');
}

/** QR bill data, or null when the issuer's details are not complete enough for one. */
function qrBillData(input: InvoicePdfInput) {
  const { invoice, issuer, address } = input;
  const due = invoice.total - invoice.amountPaid;
  const currency = QR_CURRENCIES.find((c) => c === invoice.currency);
  if (
    invoice.status !== 'open' ||
    due <= 0 ||
    !currency ||
    !invoice.number ||
    !issuer.iban ||
    !issuer.line1 ||
    !issuer.postalCode ||
    !issuer.city
  ) {
    return null;
  }
  const debtorName = address?.companyName || address?.contactName;
  const debtor =
    address && debtorName && address.line1 && address.postalCode && address.city
      ? {
          name: debtorName.slice(0, 70),
          address: address.line1.slice(0, 70),
          zip: address.postalCode,
          city: address.city.slice(0, 35),
          country: address.country || 'CH',
        }
      : undefined;
  return {
    currency,
    amount: due / 100,
    creditor: {
      account: issuer.iban,
      name: (issuer.companyName || issuer.name).slice(0, 70),
      address: issuer.line1.slice(0, 70),
      zip: issuer.postalCode,
      city: issuer.city.slice(0, 35),
      country: issuer.country || 'CH',
    },
    ...(debtor ? { debtor } : {}),
    // A QR-IBAN requires a QR reference. With a normal IBAN the invoice number goes into
    // the unstructured message, printed under "Zusätzliche Informationen".
    ...(isQRIBAN(issuer.iban) ? { reference: qrReference(invoice.number) } : {}),
    message: paymentReference(invoice.number),
  };
}

/** Every text of the PDF for one input: labels, title, paragraphs, the patterns of lines and pages. */
export interface InvoicePdfTexts {
  /** Heading and metadata title: "Rechnung WL-2026-00001", or "Rechnungsentwurf" for a draft. */
  title: string;
  subject: string;
  /** The watermark of a draft, in capitals. */
  draftMark: string;
  /** "MWST-Nr. CHE-..." of the issuer, or null without a VAT number. */
  issuerVat: string | null;
  meta: [string, string][];
  columns: {
    position: string;
    description: string;
    quantity: string;
    price: string;
    tax: string;
    amount: string;
  };
  /** The billing period below a line's description ("Zeitraum 01.10.2026 - 31.10.2026"). */
  period(start: string, end: string | null): string;
  subtotal: string;
  /** "MWST 8.1 % auf 100.00" */
  taxLine(rate: string, net: string): string;
  total: string;
  paid: string;
  due: string;
  /** Payment terms and status, then the notes and the issuer's invoice footer as stored. */
  paragraphs: string[];
  /** "Seite 1 von 2" */
  page(page: number, pages: number): string;
  /** Heading and due line of the QR bill page, null without a QR bill. */
  qr: { heading: string; due: string } | null;
  /** The language of the payment part. */
  qrLanguage: 'DE' | 'EN' | 'FR' | 'IT';
}

export function invoicePdfTexts(input: InvoicePdfInput): InvoicePdfTexts {
  const { invoice, org, issuer, address, tr, locale } = input;
  const draft = invoice.status === 'draft';
  const currency = invoice.currency;

  const meta: [string, string][] = [
    [tr('pdf.invoice.meta.number'), invoice.number ?? tr('pdf.invoice.meta.draft')],
    [tr('pdf.invoice.meta.issueDate'), formatDateCH(invoice.issueDate) || '-'],
    [tr('pdf.invoice.meta.dueDate'), formatDateCH(invoice.dueDate) || '-'],
    [tr('pdf.invoice.meta.customerNumber'), org.slug],
  ];
  if (address?.vatId) meta.push([tr('pdf.invoice.meta.customerVat'), address.vatId]);
  if (invoice.status === 'paid') meta.push([tr('pdf.invoice.meta.status'), tr('pdf.invoice.status.paid')]);
  if (invoice.status === 'void') meta.push([tr('pdf.invoice.meta.status'), tr('pdf.invoice.status.void')]);

  const qr = draft ? null : qrBillData(input);
  const paragraphs: string[] = [];
  if (invoice.status === 'open' || draft) {
    const until = formatDateCH(invoice.dueDate);
    paragraphs.push(
      until ? tr('pdf.invoice.terms.payUntil', { date: until }) : tr('pdf.invoice.terms.payTerms'),
    );
    if (issuer.iban) {
      // Four variants, because the word order around the bank and the reference differs between languages.
      const values = {
        iban: issuer.iban.replace(/(.{4})/g, '$1 ').trim(),
        bank: issuer.bankName ?? '',
        reference: invoice.number ? paymentReference(invoice.number) : '',
      };
      const key = issuer.bankName
        ? invoice.number
          ? 'pdf.invoice.terms.transferBankRef'
          : 'pdf.invoice.terms.transferBank'
        : invoice.number
          ? 'pdf.invoice.terms.transferRef'
          : 'pdf.invoice.terms.transfer';
      paragraphs.push(tr(key, values));
    }
    if (qr) paragraphs.push(tr('pdf.invoice.terms.qrHint'));
  } else if (invoice.status === 'paid') {
    paragraphs.push(tr('pdf.invoice.terms.paid'));
  } else if (invoice.status === 'void') {
    paragraphs.push(
      invoice.voidReason
        ? tr('pdf.invoice.terms.voidReason', { reason: invoice.voidReason })
        : tr('pdf.invoice.terms.void'),
    );
  }
  // Stored texts stay as stored, in whatever language they were written.
  if (invoice.notes) paragraphs.push(invoice.notes);
  if (issuer.invoiceFooter) paragraphs.push(issuer.invoiceFooter);

  return {
    title: invoice.number
      ? tr('pdf.invoice.title', { number: invoice.number })
      : tr('pdf.invoice.draftTitle'),
    subject: tr('pdf.invoice.subject', { org: org.name }),
    draftMark: tr('pdf.invoice.draftMark'),
    issuerVat: issuer.vatId ? tr('pdf.invoice.issuerVat', { vatId: issuer.vatId }) : null,
    meta,
    columns: {
      position: tr('pdf.invoice.col.position'),
      description: tr('pdf.invoice.col.description'),
      quantity: tr('pdf.invoice.col.quantity'),
      price: tr('pdf.invoice.col.price'),
      tax: tr('pdf.invoice.col.tax'),
      amount: tr('pdf.invoice.col.amount', { currency }),
    },
    period: (start, end) =>
      end ? tr('pdf.invoice.line.period', { start, end }) : tr('pdf.invoice.line.periodStart', { start }),
    subtotal: tr('pdf.invoice.totals.subtotal'),
    taxLine: (rateText, net) => tr('pdf.invoice.totals.tax', { rate: rateText, net }),
    total: tr('pdf.invoice.totals.total', { currency }),
    paid: tr('pdf.invoice.totals.paid'),
    due: tr('pdf.invoice.totals.due', { currency }),
    paragraphs,
    page: (page, pages) => tr('pdf.invoice.footer.page', { page, pages }),
    qr:
      qr && invoice.number
        ? {
            heading: tr('pdf.invoice.qr.heading', { number: invoice.number }),
            due: tr('pdf.invoice.qr.due', { issuer: issuer.name, date: formatDateCH(invoice.dueDate) }),
          }
        : null,
    qrLanguage: qrBillLanguage(locale),
  };
}

export async function renderInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  const { invoice, lines, org, issuer, address, locale } = input;
  const texts = invoicePdfTexts(input);
  const draft = invoice.status === 'draft';
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 20 * MM, bottom: 15 * MM, left: LEFT, right: PAGE.width - RIGHT },
    bufferPages: true,
    lang: intlLocale(locale),
    info: {
      Title: texts.title,
      Author: issuer.name,
      Subject: texts.subject,
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const font = (bold = false) => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');

  // --- Header: issuer ---------------------------------------------------------------
  doc.rect(0, 0, PAGE.width, 4).fill(TEAL);
  font(true)
    .fontSize(17)
    .fillColor(INK)
    .text(issuer.name, LEFT, 15 * MM, { width: WIDTH * 0.55 });
  const issuerBlock = [
    ...addressLines({ ...issuer, companyName: issuer.companyName }, locale),
    issuer.email,
    issuer.phone,
    issuer.website,
    texts.issuerVat,
  ].filter((l): l is string => !!l);
  font()
    .fontSize(8)
    .fillColor(MUTED)
    .text(issuerBlock.join('\n'), LEFT + WIDTH * 0.55, 15 * MM, { width: WIDTH * 0.45, align: 'right' });

  // --- Recipient in the envelope window (left, 45 mm from the top) --------------------
  const sender = [
    issuer.companyName || issuer.name,
    issuer.line1,
    [issuer.postalCode, issuer.city].join(' ').trim(),
  ]
    .filter(Boolean)
    .join(', ');
  font()
    .fontSize(6.5)
    .fillColor(MUTED)
    .text(sender, LEFT, 49 * MM, { width: 85 * MM, underline: true, lineBreak: false, ellipsis: true });
  const recipient = address ? addressLines(address, locale) : [org.name];
  font(true)
    .fontSize(10)
    .fillColor(INK)
    .text(recipient[0] ?? org.name, LEFT, 55 * MM, { width: 85 * MM });
  font()
    .fontSize(10)
    .text(recipient.slice(1).join('\n'), { width: 85 * MM });

  // --- Invoice meta (right column) ----------------------------------------------------
  const meta = texts.meta;
  const metaX = LEFT + 100 * MM;
  let y = 55 * MM;
  for (const [label, value] of meta) {
    font()
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(label, metaX, y, { width: 32 * MM });
    font(true)
      .fontSize(8.5)
      .fillColor(INK)
      .text(value, metaX + 32 * MM, y, { width: RIGHT - metaX - 32 * MM, align: 'right' });
    y += 13;
  }

  // --- Title --------------------------------------------------------------------------
  y = Math.max(y, 55 * MM + 75) + 22;
  font(true).fontSize(16).fillColor(INK).text(texts.title, LEFT, y);
  y = doc.y + 12;

  // --- Line items ---------------------------------------------------------------------
  const cols = [
    { key: 'pos', label: texts.columns.position, width: 26, align: 'left' as const },
    {
      key: 'desc',
      label: texts.columns.description,
      width: WIDTH - 26 - 62 - 72 - 42 - 76,
      align: 'left' as const,
    },
    { key: 'qty', label: texts.columns.quantity, width: 62, align: 'right' as const },
    { key: 'price', label: texts.columns.price, width: 72, align: 'right' as const },
    { key: 'tax', label: texts.columns.tax, width: 42, align: 'right' as const },
    { key: 'total', label: texts.columns.amount, width: 76, align: 'right' as const },
  ];
  const tableHeader = () => {
    let x = LEFT;
    font(true).fontSize(8).fillColor(MUTED);
    for (const col of cols) {
      doc.text(col.label, x, y, { width: col.width, align: col.align });
      x += col.width;
    }
    y += 13;
    doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(1.2).strokeColor(TEAL).stroke();
    y += 6;
  };
  const newPage = () => {
    doc.addPage();
    y = doc.page.margins.top;
  };
  tableHeader();

  for (const line of lines) {
    const period =
      line.periodStart && !line.description.includes(formatDateCH(line.periodStart))
        ? texts.period(formatDateCH(line.periodStart), line.periodEnd ? formatDateCH(line.periodEnd) : null)
        : null;
    const descWidth = cols[1]!.width - 8;
    font().fontSize(9);
    const textHeight =
      doc.heightOfString(line.description, { width: descWidth }) +
      (period ? doc.fontSize(7.5).heightOfString(period, { width: descWidth }) + 2 : 0);
    const rowHeight = Math.max(textHeight, 11) + 8;
    if (y + rowHeight > CONTENT_BOTTOM) {
      newPage();
      tableHeader();
    }
    const cells: Record<string, string> = {
      pos: String(line.position),
      qty: `${quantityFormat.format(line.quantity)}${line.unit ? ` ${line.unit}` : ''}`,
      price: money(line.unitPrice),
      tax: rate(line.taxRateBp),
      total: money(line.total),
    };
    let x = LEFT;
    for (const col of cols) {
      if (col.key === 'desc') {
        font().fontSize(9).fillColor(INK).text(line.description, x, y, { width: descWidth });
        if (period)
          font()
            .fontSize(7.5)
            .fillColor(MUTED)
            .text(period, x, doc.y + 2, { width: descWidth });
      } else {
        font()
          .fontSize(9)
          .fillColor(INK)
          .text(cells[col.key] ?? '', x, y, { width: col.width, align: col.align });
      }
      x += col.width;
    }
    y += rowHeight;
    doc
      .moveTo(LEFT, y - 4)
      .lineTo(RIGHT, y - 4)
      .lineWidth(0.5)
      .strokeColor(RULE)
      .stroke();
  }

  // --- Totals -------------------------------------------------------------------------
  const totals = invoiceTotals(lines);
  const rows: { label: string; value: string; bold?: boolean; rule?: boolean }[] = [
    { label: texts.subtotal, value: money(totals.subtotal) },
  ];
  for (const b of totals.breakdown) {
    rows.push({ label: texts.taxLine(rate(b.rateBp), money(b.net)), value: money(b.tax) });
  }
  rows.push({ label: texts.total, value: money(totals.total), bold: true, rule: true });
  if (invoice.amountPaid > 0 && invoice.status !== 'void') {
    rows.push({ label: texts.paid, value: `-${money(invoice.amountPaid)}` });
    rows.push({
      label: texts.due,
      value: money(Math.max(0, totals.total - invoice.amountPaid)),
      bold: true,
    });
  }
  const totalsHeight = rows.length * 15 + 12;
  if (y + totalsHeight > CONTENT_BOTTOM) newPage();
  y += 6;
  const labelX = RIGHT - 230;
  for (const row of rows) {
    if (row.rule) {
      doc
        .moveTo(labelX, y - 3)
        .lineTo(RIGHT, y - 3)
        .lineWidth(1.2)
        .strokeColor(TEAL)
        .stroke();
      y += 3;
    }
    font(row.bold)
      .fontSize(row.bold ? 10 : 9)
      .fillColor(INK)
      .text(row.label, labelX, y, { width: 150 });
    font(row.bold)
      .fontSize(row.bold ? 10 : 9)
      .text(row.value, labelX + 150, y, { width: 80, align: 'right' });
    y += 15;
  }

  // --- Payment terms, notes, footer text ----------------------------------------------
  const qr = draft ? null : qrBillData(input);
  const paragraphs = texts.paragraphs;

  y += 14;
  for (const p of paragraphs) {
    font().fontSize(9);
    const h = doc.heightOfString(p, { width: WIDTH });
    if (y + h > CONTENT_BOTTOM) newPage();
    doc.fillColor(INK).text(p, LEFT, y, { width: WIDTH });
    y = doc.y + 6;
  }

  // --- Footer and watermark on every page ---------------------------------------------
  const footer = [
    issuer.companyName || issuer.name,
    [issuer.line1, [issuer.postalCode, issuer.city].join(' ').trim()].filter(Boolean).join(', '),
    issuer.email,
    issuer.website,
    texts.issuerVat,
  ]
    .filter(Boolean)
    .join('  ·  ');
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing into the bottom margin must not trigger an automatic page break.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .moveTo(LEFT, PAGE.height - 18 * MM)
      .lineTo(RIGHT, PAGE.height - 18 * MM)
      .lineWidth(0.5)
      .strokeColor(RULE)
      .stroke();
    font()
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(footer, LEFT, PAGE.height - 16 * MM, { width: WIDTH - 60, lineBreak: false, ellipsis: true });
    doc.text(texts.page(i - range.start + 1, range.count), RIGHT - 60, PAGE.height - 16 * MM, {
      width: 60,
      align: 'right',
      lineBreak: false,
    });
    if (draft) {
      doc.save();
      doc.rotate(-35, { origin: [PAGE.width / 2, PAGE.height / 2] });
      font(true)
        .fontSize(110)
        .fillColor(TEAL)
        .fillOpacity(0.13)
        .text(texts.draftMark, 0, PAGE.height / 2 - 55, {
          width: PAGE.width,
          align: 'center',
          lineBreak: false,
        });
      doc.restore();
    }
    doc.page.margins.bottom = bottom;
  }

  // --- Swiss QR bill on its own page --------------------------------------------------
  if (qr && texts.qr) {
    try {
      const bill = new SwissQRBill(qr, { language: texts.qrLanguage });
      doc.addPage({ size: 'A4', margin: 0 });
      font(true)
        .fontSize(12)
        .fillColor(INK)
        .text(texts.qr.heading, LEFT, 20 * MM, { width: WIDTH });
      font()
        .fontSize(9)
        .fillColor(MUTED)
        .text(texts.qr.due, LEFT, doc.y + 4, {
          width: WIDTH,
        });
      // The payment part draws in the current fill color, which must be plain black.
      doc.fillColor('black').fillOpacity(1);
      bill.attachTo(doc, 0, PAGE.height - SwissQRBill.height);
    } catch {
      // Invalid issuer data (e.g. an IBAN the QR standard rejects): the invoice still
      // goes out, just without the payment part.
    }
  }

  doc.end();
  return done;
}
