import PDFDocument from 'pdfkit';
import { SwissQRBill } from 'swissqrbill/pdf';
import { isQRIBAN } from 'swissqrbill/utils';
import { invoiceTotals, type InvoiceIssuerSettings } from '@weblion/shared';
import type { Invoice, InvoiceLine, Organization } from '../../db/schema';
import type { BillingAddress } from './dto';
import { formatDateCH } from './dates';

/**
 * Invoice PDF: A4, recipient in the left window of a C5/DL envelope, line items, tax
 * breakdown, totals and, when the issuer has an IBAN, a Swiss QR bill on its own page.
 * Uses the PDF standard fonts, so no font files need to ship with the API.
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
}

const number2 = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantityFormat = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 3 });

const regionNames = new Intl.DisplayNames(['de'], { type: 'region' });

const money = (minor: number) => number2.format(minor / 100);

function countryName(code: string): string {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}
const rate = (bp: number) => `${quantityFormat.format(bp / 100)} %`;

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

function addressLines(a: {
  companyName?: string | null;
  contactName?: string | null;
  line1?: string | null;
  line2?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
}): string[] {
  return [
    a.companyName,
    a.contactName,
    a.line1,
    a.line2,
    [a.postalCode, a.city].filter(Boolean).join(' '),
    a.country && a.country !== 'CH' ? countryName(a.country) : null,
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
    message: `Rechnung ${invoice.number}`,
  };
}

export async function renderInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  const { invoice, lines, org, issuer, address } = input;
  const draft = invoice.status === 'draft';
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 20 * MM, bottom: 15 * MM, left: LEFT, right: PAGE.width - RIGHT },
    bufferPages: true,
    info: {
      Title: invoice.number ? `Rechnung ${invoice.number}` : 'Rechnungsentwurf',
      Author: issuer.name,
      Subject: `Rechnung an ${org.name}`,
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
    ...addressLines({ ...issuer, companyName: issuer.companyName }),
    issuer.email,
    issuer.phone,
    issuer.website,
    issuer.vatId ? `MWST-Nr. ${issuer.vatId}` : null,
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
  const recipient = address ? addressLines(address) : [org.name];
  font(true)
    .fontSize(10)
    .fillColor(INK)
    .text(recipient[0] ?? org.name, LEFT, 55 * MM, { width: 85 * MM });
  font()
    .fontSize(10)
    .text(recipient.slice(1).join('\n'), { width: 85 * MM });

  // --- Invoice meta (right column) ----------------------------------------------------
  const meta: [string, string][] = [
    ['Rechnungsnummer', invoice.number ?? 'Entwurf'],
    ['Rechnungsdatum', formatDateCH(invoice.issueDate) || '-'],
    ['Fällig am', formatDateCH(invoice.dueDate) || '-'],
    ['Kundennummer', org.slug],
  ];
  if (address?.vatId) meta.push(['Ihre MWST-Nr.', address.vatId]);
  if (invoice.status === 'paid') meta.push(['Status', 'Bezahlt']);
  if (invoice.status === 'void') meta.push(['Status', 'Storniert']);
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
  font(true)
    .fontSize(16)
    .fillColor(INK)
    .text(invoice.number ? `Rechnung ${invoice.number}` : 'Rechnungsentwurf', LEFT, y);
  y = doc.y + 12;

  // --- Line items ---------------------------------------------------------------------
  const cols = [
    { key: 'pos', label: 'Pos.', width: 26, align: 'left' as const },
    { key: 'desc', label: 'Beschreibung', width: WIDTH - 26 - 62 - 72 - 42 - 76, align: 'left' as const },
    { key: 'qty', label: 'Menge', width: 62, align: 'right' as const },
    { key: 'price', label: 'Preis', width: 72, align: 'right' as const },
    { key: 'tax', label: 'MWST', width: 42, align: 'right' as const },
    { key: 'total', label: `Betrag ${invoice.currency}`, width: 76, align: 'right' as const },
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
        ? `Zeitraum ${formatDateCH(line.periodStart)}${line.periodEnd ? ` - ${formatDateCH(line.periodEnd)}` : ''}`
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
    { label: 'Zwischensumme netto', value: money(totals.subtotal) },
  ];
  for (const b of totals.breakdown) {
    rows.push({ label: `MWST ${rate(b.rateBp)} auf ${money(b.net)}`, value: money(b.tax) });
  }
  rows.push({ label: `Total ${invoice.currency}`, value: money(totals.total), bold: true, rule: true });
  if (invoice.amountPaid > 0 && invoice.status !== 'void') {
    rows.push({ label: 'Bereits bezahlt', value: `-${money(invoice.amountPaid)}` });
    rows.push({
      label: `Offener Betrag ${invoice.currency}`,
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
  const paragraphs: string[] = [];
  if (invoice.status === 'open' || draft) {
    const until = formatDateCH(invoice.dueDate);
    paragraphs.push(until ? `Zahlbar bis ${until}.` : 'Zahlbar innert der vereinbarten Frist.');
    if (issuer.iban) {
      paragraphs.push(
        `Bitte überweisen Sie den Betrag auf ${issuer.iban.replace(/(.{4})/g, '$1 ').trim()}` +
          `${issuer.bankName ? ` (${issuer.bankName})` : ''}` +
          `${invoice.number ? ` mit dem Vermerk "Rechnung ${invoice.number}"` : ''}.`,
      );
    }
    if (qr) paragraphs.push('Den Zahlteil mit QR-Code finden Sie auf der letzten Seite.');
  } else if (invoice.status === 'paid') {
    paragraphs.push('Diese Rechnung ist bezahlt. Vielen Dank.');
  } else if (invoice.status === 'void') {
    paragraphs.push(
      `Diese Rechnung wurde storniert.${invoice.voidReason ? ` Grund: ${invoice.voidReason}` : ''}`,
    );
  }
  if (invoice.notes) paragraphs.push(invoice.notes);
  if (issuer.invoiceFooter) paragraphs.push(issuer.invoiceFooter);

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
    issuer.vatId ? `MWST-Nr. ${issuer.vatId}` : null,
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
    doc.text(`Seite ${i - range.start + 1} von ${range.count}`, RIGHT - 60, PAGE.height - 16 * MM, {
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
        .text('ENTWURF', 0, PAGE.height / 2 - 55, { width: PAGE.width, align: 'center', lineBreak: false });
      doc.restore();
    }
    doc.page.margins.bottom = bottom;
  }

  // --- Swiss QR bill on its own page --------------------------------------------------
  if (qr) {
    try {
      const bill = new SwissQRBill(qr, { language: 'DE' });
      doc.addPage({ size: 'A4', margin: 0 });
      font(true)
        .fontSize(12)
        .fillColor(INK)
        .text(`Zahlteil zu Rechnung ${invoice.number}`, LEFT, 20 * MM, { width: WIDTH });
      font()
        .fontSize(9)
        .fillColor(MUTED)
        .text(`${issuer.name}  ·  fällig am ${formatDateCH(invoice.dueDate)}`, LEFT, doc.y + 4, {
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
