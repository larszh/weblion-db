import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { InvoiceDetailDto } from '@weblion/shared';
import { de } from '@weblion/shared/i18n/de';
import { withI18n } from '@/test/i18n';
import { InvoiceDocument } from './invoice-view';

/** An open invoice of a French-speaking customer, viewed in a German UI. */
const invoice: InvoiceDetailDto = {
  id: 'b1e2c3d4-0000-4000-8000-000000000001',
  number: 'R-2026-0042',
  org: { id: 'b1e2c3d4-0000-4000-8000-000000000002', name: 'Lingua SA', slug: 'lingua' },
  issuer: { orgId: null, name: 'weblion.one GmbH' },
  status: 'open',
  currency: 'CHF',
  issueDate: '2026-11-02',
  dueDate: '2026-12-02',
  subtotal: 10000,
  taxTotal: 810,
  total: 10810,
  amountPaid: 0,
  amountDue: 10810,
  overdue: false,
  zoho: null,
  sentAt: null,
  paidAt: null,
  createdAt: '2026-11-02T08:00:00.000Z',
  lines: [],
  taxBreakdown: [],
  billingAddress: null,
  notes: null,
  voidReason: null,
  payments: [],
  can: { edit: false, finalize: false, void: false, markPaid: false, pay: false, send: false },
  payMethods: [],
  locale: 'fr',
};

describe('InvoiceDocument', () => {
  it('shows the invoice language with its flag next to the dates (i18n 9)', () => {
    const html = renderToStaticMarkup(withI18n(<InvoiceDocument invoice={invoice} />, 'de'));
    // The row follows the due date, so the reader sees in which language the PDF and the mails go out.
    expect(html).toMatch(
      new RegExp(`${de['billing.doc.dueDate']}</dt>.*?<dt[^>]*>${de['billing.invoice.locale']}</dt>`),
    );
    // Native name and the French flag (decorative: the name is written next to it), not the UI language.
    expect(html).toMatch(/<svg viewBox="0 0 3 2"[^>]*aria-hidden="true"><rect[^>]*fill="#002654"/);
    expect(html).toContain('Français</span>');
    expect(html).not.toContain('Französisch');
  });
});
