import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  DEFAULT_TAX_RATE_BP,
  formatMoney,
  invoiceTotals,
  lineTotal,
  type InvoiceDetailDto,
  type InvoiceLineInput,
  type ProductDto,
} from '@weblion/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { useApiMutation } from '@/lib/queries';
import { billingKeys, useIssuerOf, useProducts, useSellerCustomer } from '@/lib/api/billing';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/primitives';
import {
  formatDay,
  formatRate,
  moneyInput,
  parseMoney,
  parsePercent,
  parseQuantity,
  percentInput,
  showPeriod,
  unitForInterval,
} from './money';

/** Editor for invoice drafts: create one for a customer or change an existing draft. */

interface LineDraft {
  key: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  /** Percent. Empty means the customer's or issuer's default rate. */
  taxRate: string;
  serviceId: string | null;
  periodStart: string | null;
  periodEnd: string | null;
}

let lineSeq = 0;
const nextKey = () => `line-${++lineSeq}`;

const emptyLine = (): LineDraft => ({
  key: nextKey(),
  description: '',
  quantity: '1',
  unit: '',
  unitPrice: '',
  taxRate: '',
  serviceId: null,
  periodStart: null,
  periodEnd: null,
});

interface ParsedLine {
  description: string | null;
  quantity: number | null;
  unitPrice: number | null;
  /** undefined = invalid, null = default rate */
  taxRateBp: number | null | undefined;
}

function parseLine(line: LineDraft): ParsedLine {
  return {
    description: line.description.trim() || null,
    quantity: parseQuantity(line.quantity),
    unitPrice: parseMoney(line.unitPrice),
    taxRateBp: line.taxRate.trim() === '' ? null : (parsePercent(line.taxRate) ?? undefined),
  };
}

const lineValid = (p: ParsedLine) =>
  p.description !== null && p.quantity !== null && p.unitPrice !== null && p.taxRateBp !== undefined;

export function InvoiceEditorDialog({
  open,
  onOpenChange,
  customerOrgId,
  sellerOrgId,
  invoice,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerOrgId: string;
  /** Who bills the customer: a reseller organization or null for the platform. */
  sellerOrgId: string | null;
  /** The draft to change. Without it a new draft is created. */
  invoice?: InvoiceDetailDto | null;
  onSaved?: (invoice: InvoiceDetailDto) => void;
}) {
  const { t, locale } = useI18n();
  const customer = useSellerCustomer(customerOrgId, open);
  const issuer = useIssuerOf(sellerOrgId, open);
  const products = useProducts(sellerOrgId, { active: true, enabled: open });
  const currency = invoice?.currency ?? customer.data?.profile.currency ?? 'CHF';
  const defaultRate = customer.data?.profile.taxRateBp ?? issuer?.defaultTaxRateBp ?? DEFAULT_TAX_RATE_BP;

  const [lines, setLines] = useState<LineDraft[]>([]);
  const [notes, setNotes] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSubmitted(false);
    if (invoice) {
      setLines(
        invoice.lines.map((l) => ({
          key: nextKey(),
          description: l.description,
          quantity: String(l.quantity),
          unit: l.unit ?? '',
          unitPrice: moneyInput(l.unitPrice),
          taxRate: percentInput(l.taxRateBp),
          serviceId: l.serviceId,
          periodStart: l.periodStart,
          periodEnd: l.periodEnd,
        })),
      );
      setNotes(invoice.notes ?? '');
      setIssueDate(invoice.issueDate ?? '');
      setDueDate(invoice.dueDate ?? '');
    } else {
      setLines([emptyLine()]);
      setNotes('');
      setIssueDate('');
      setDueDate('');
    }
  }, [open, invoice]);

  const parsed = lines.map(parseLine);
  const valid = parsed.length > 0 && parsed.every(lineValid);
  const datesValid = !issueDate || !dueDate || dueDate >= issueDate;

  const totals = useMemo(
    () =>
      invoiceTotals(
        parsed
          .filter((p) => p.quantity !== null && p.unitPrice !== null && p.taxRateBp !== undefined)
          .map((p) => ({
            quantity: p.quantity!,
            unitPrice: p.unitPrice!,
            taxRateBp: p.taxRateBp ?? defaultRate,
          })),
      ),
    [parsed, defaultRate],
  );

  const catalog = (products.data ?? []).filter((p) => p.currency === currency);

  const update = (key: string, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const addProduct = (product: ProductDto) =>
    setLines((prev) => {
      const line: LineDraft = {
        ...emptyLine(),
        description: product.description ? `${product.name}, ${product.description}` : product.name,
        unit: unitForInterval(product.interval, locale),
        unitPrice: moneyInput(product.unitPrice),
        taxRate: percentInput(product.taxRateBp),
      };
      // Replace the untouched empty line a new draft starts with.
      const blank = prev.length === 1 && !prev[0]!.description && !prev[0]!.unitPrice;
      return blank ? [line] : [...prev, line];
    });

  const body = () => ({
    lines: lines.map((l, i): InvoiceLineInput => {
      const p = parsed[i]!;
      return {
        description: p.description!,
        quantity: p.quantity!,
        unit: l.unit.trim() || null,
        unitPrice: p.unitPrice!,
        taxRateBp: p.taxRateBp ?? null,
        serviceId: l.serviceId,
        periodStart: l.periodStart,
        periodEnd: l.periodEnd,
      };
    }),
    notes: notes.trim() || null,
    issueDate: issueDate || null,
    dueDate: dueDate || null,
  });

  const save = useApiMutation(
    () =>
      invoice
        ? api.patch<InvoiceDetailDto>(`/invoices/${invoice.id}`, body())
        : api.post<InvoiceDetailDto>(`/billing/customers/${customerOrgId}/invoices`, body()),
    {
      success: invoice ? t('billing.editor.saved') : t('billing.editor.created'),
      invalidate: [billingKeys.all],
      onSuccess: (saved) => {
        onOpenChange(false);
        onSaved?.(saved);
      },
    },
  );

  const submit = () => {
    setSubmitted(true);
    if (valid && datesValid) save.mutate(undefined);
  };

  const bad = (invalid: boolean, value: string) =>
    invalid && (submitted || value.trim() !== '') ? 'border-danger focus:border-danger' : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title={invoice ? t('billing.editor.editTitle') : t('billing.editor.createTitle')}
      description={
        customer.data ? t('billing.editor.for', { name: customer.data.org.name, currency }) : undefined
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            {invoice ? t('common.save') : t('billing.editor.saveDraft')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <div className="mb-2 hidden grid-cols-[minmax(0,1fr)_76px_84px_112px_76px_104px_32px] gap-2 px-0.5 text-xs font-medium tracking-wide text-muted uppercase md:grid">
            <span>{t('billing.line.description')}</span>
            <span>{t('billing.line.quantity')}</span>
            <span>{t('billing.line.unit')}</span>
            <span>{t('billing.line.unitPrice')}</span>
            <span>{t('billing.line.tax')}</span>
            <span className="text-right">{t('billing.line.total')}</span>
            <span />
          </div>
          <div className="space-y-2">
            {lines.map((line, i) => {
              const p = parsed[i]!;
              const net =
                p.quantity !== null && p.unitPrice !== null ? lineTotal(p.quantity, p.unitPrice) : null;
              return (
                <div
                  key={line.key}
                  className="grid grid-cols-2 gap-2 rounded-lg border border-border p-3 md:grid-cols-[minmax(0,1fr)_76px_84px_112px_76px_104px_32px] md:items-start md:border-0 md:p-0"
                >
                  <label className="col-span-2 block md:col-span-1">
                    <span className="mb-1 block text-xs text-muted md:hidden">
                      {t('billing.line.description')}
                    </span>
                    <Input
                      value={line.description}
                      onChange={(e) => update(line.key, { description: e.target.value })}
                      placeholder={t('billing.line.descriptionPlaceholder')}
                      aria-label={t('billing.line.description')}
                      maxLength={500}
                      className={bad(p.description === null, line.description)}
                    />
                    {showPeriod(line) && (
                      <span className="mt-1 block text-xs text-muted">
                        {t('billing.line.period', {
                          from: formatDay(line.periodStart, locale),
                          to: formatDay(line.periodEnd, locale),
                        })}
                      </span>
                    )}
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-muted md:hidden">
                      {t('billing.line.quantity')}
                    </span>
                    <Input
                      value={line.quantity}
                      onChange={(e) => update(line.key, { quantity: e.target.value })}
                      inputMode="decimal"
                      aria-label={t('billing.line.quantity')}
                      className={cn('text-right tabular', bad(p.quantity === null, line.quantity))}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-muted md:hidden">{t('billing.line.unit')}</span>
                    <Input
                      value={line.unit}
                      onChange={(e) => update(line.key, { unit: e.target.value })}
                      placeholder={t('billing.line.unitPlaceholder')}
                      aria-label={t('billing.line.unit')}
                      maxLength={20}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-muted md:hidden">
                      {t('billing.line.unitPrice')} ({currency})
                    </span>
                    <Input
                      value={line.unitPrice}
                      onChange={(e) => update(line.key, { unitPrice: e.target.value })}
                      inputMode="decimal"
                      placeholder="0.00"
                      aria-label={t('billing.line.unitPrice')}
                      className={cn('text-right tabular', bad(p.unitPrice === null, line.unitPrice))}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-muted md:hidden">
                      {t('billing.line.tax')} (%)
                    </span>
                    <Input
                      value={line.taxRate}
                      onChange={(e) => update(line.key, { taxRate: e.target.value })}
                      inputMode="decimal"
                      placeholder={percentInput(defaultRate)}
                      aria-label={t('billing.line.tax')}
                      title={t('billing.line.taxHint')}
                      className={cn('text-right tabular', bad(p.taxRateBp === undefined, line.taxRate))}
                    />
                  </label>
                  <div className="flex h-9 items-center justify-end text-sm font-medium tabular md:pr-1">
                    {net === null ? '–' : formatMoney(net, currency, locale)}
                  </div>
                  <div className="flex h-9 items-center justify-end">
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={lines.length <= 1}
                      onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                      aria-label={t('billing.line.remove')}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              icon={<Plus className="size-4" />}
              onClick={() => setLines((prev) => [...prev, emptyLine()])}
            >
              {t('billing.line.add')}
            </Button>
            {catalog.length > 0 && (
              <Select
                value=""
                onChange={(e) => {
                  const product = catalog.find((p) => p.id === e.target.value);
                  if (product) addProduct(product);
                }}
                className="h-8 w-auto max-w-full text-[13px]"
                aria-label={t('billing.line.fromProduct')}
              >
                <option value="">{t('billing.line.fromProduct')}</option>
                {catalog.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {formatMoney(p.unitPrice, p.currency, locale)}
                  </option>
                ))}
              </Select>
            )}
          </div>
          {submitted && !valid && <p className="mt-2 text-xs text-danger">{t('billing.editor.invalid')}</p>}
        </div>

        <div className="flex justify-end">
          <dl className="w-full space-y-1.5 text-sm sm:w-80">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">{t('billing.doc.subtotal')}</dt>
              <dd className="tabular">{formatMoney(totals.subtotal, currency, locale)}</dd>
            </div>
            {totals.breakdown.map((b) => (
              <div key={b.rateBp} className="flex justify-between gap-4">
                <dt className="text-muted">
                  {t('billing.doc.taxLine', {
                    rate: formatRate(b.rateBp, locale),
                    net: formatMoney(b.net, currency, locale),
                  })}
                </dt>
                <dd className="tabular">{formatMoney(b.tax, currency, locale)}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-4 border-t border-border pt-1.5 font-semibold">
              <dt>{t('billing.doc.total')}</dt>
              <dd className="tabular">{formatMoney(totals.total, currency, locale)}</dd>
            </div>
          </dl>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('billing.doc.issueDate')} htmlFor="inv-issue" hint={t('billing.editor.issueHint')}>
            <Input
              id="inv-issue"
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
            />
          </Field>
          <Field
            label={t('billing.doc.dueDate')}
            htmlFor="inv-due"
            hint={t('billing.editor.dueHint')}
            error={!datesValid ? t('billing.editor.dueBeforeIssue') : undefined}
          >
            <Input id="inv-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <Field label={t('billing.doc.notes')} htmlFor="inv-notes" hint={t('billing.editor.notesHint')}>
          <Textarea
            id="inv-notes"
            rows={3}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}
