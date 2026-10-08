import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  Ban,
  CheckCircle2,
  CreditCard,
  FileDown,
  FileSearch,
  Mail,
  Pencil,
  RefreshCw,
  Send,
  Smartphone,
  Trash2,
  Wallet,
} from 'lucide-react';
import {
  formatMoney,
  type InvoiceDetailDto,
  type InvoiceDto,
  type PaymentDto,
  type PaymentMethod,
} from '@weblion/shared';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useApiMutation, useMe } from '@/lib/queries';
import {
  billingKeys,
  useInvoice,
  useZohoConfigured,
  type MailSendResult,
  type PayResult,
} from '@/lib/api/billing';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/menu';
import {
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Mono,
  Notice,
  Select,
  Textarea,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import { InvoiceStatusBadge, PaymentStatusBadge, ZohoBadge, useBillingLabels } from './bits';
import { InvoiceEditorDialog } from './invoice-editor';
import { formatDay, formatQuantity, formatRate, moneyInput, parseMoney, showPeriod } from './money';

/**
 * One invoice: the document, what the viewer can pay with, the payment history and, for
 * the issuer, the actions of the invoice lifecycle. Used by the customer invoice page, the
 * admin invoice page and the seller panel. What is shown follows the `can` flags and
 * `payMethods` the API computed for the current user.
 */

export const pdfUrl = (invoiceId: string) => `/api/v1/invoices/${invoiceId}/pdf`;

export function invoiceTitle(
  t: ReturnType<typeof useI18n>['t'],
  invoice: Pick<InvoiceDto, 'number' | 'status'>,
) {
  return invoice.number
    ? t('billing.invoice.title', { number: invoice.number })
    : t('billing.invoice.draftTitle');
}

// --- Document -----------------------------------------------------------------------------

function AddressBlock({ address }: { address: InvoiceDetailDto['billingAddress'] }) {
  const { t } = useI18n();
  if (!address) return <p className="text-sm text-muted">–</p>;
  const city = [address.postalCode, address.city].filter(Boolean).join(' ');
  return (
    <address className="text-sm leading-relaxed text-text not-italic">
      {address.companyName && <div className="font-medium">{address.companyName}</div>}
      {address.contactName && <div>{address.contactName}</div>}
      {address.line1 && <div>{address.line1}</div>}
      {address.line2 && <div>{address.line2}</div>}
      {(city || address.country !== 'CH') && (
        <div>
          {city}
          {address.country !== 'CH' && <span>{city ? `, ${address.country}` : address.country}</span>}
        </div>
      )}
      {address.vatId && (
        <div className="mt-1 text-muted">{t('billing.doc.vatId', { id: address.vatId })}</div>
      )}
      {address.email && <div className="text-muted">{address.email}</div>}
    </address>
  );
}

export function InvoiceDocument({ invoice }: { invoice: InvoiceDetailDto }) {
  const { t, locale } = useI18n();
  const money = (v: number) => formatMoney(v, invoice.currency, locale);
  const draft = invoice.status === 'draft';
  return (
    <Card className="relative overflow-hidden">
      {invoice.status === 'void' && (
        <div className="border-b border-border bg-surface-2 px-6 py-2 text-sm font-medium text-muted sm:px-10">
          {t('billing.doc.voidBanner')}
        </div>
      )}
      <div className="space-y-8 px-5 py-6 sm:px-10 sm:py-9">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="text-xs font-medium tracking-wide text-muted uppercase">
              {t('billing.doc.from')}
            </div>
            <div className="mt-1 font-display text-lg font-semibold text-text">{invoice.issuer.name}</div>
          </div>
          <div className="text-right">
            <div
              className={cn(
                'font-display text-2xl font-semibold tracking-tight',
                draft ? 'text-subtle' : 'text-text',
              )}
            >
              {draft ? t('billing.doc.draft') : t('billing.doc.invoice')}
            </div>
            {invoice.number && <Mono className="text-muted">{invoice.number}</Mono>}
          </div>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 text-xs font-medium tracking-wide text-muted uppercase">
              {t('billing.doc.to')}
            </div>
            <AddressBlock address={invoice.billingAddress} />
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 self-start text-sm sm:justify-self-end">
            <dt className="text-muted">{t('billing.doc.number')}</dt>
            <dd className="text-right tabular">{invoice.number ?? '–'}</dd>
            <dt className="text-muted">{t('billing.doc.issueDate')}</dt>
            <dd className="text-right tabular">
              {invoice.issueDate ? formatDay(invoice.issueDate, locale) : t('billing.doc.onFinalize')}
            </dd>
            <dt className="text-muted">{t('billing.doc.dueDate')}</dt>
            <dd className={cn('text-right tabular', invoice.overdue && 'font-medium text-danger')}>
              {invoice.dueDate ? formatDay(invoice.dueDate, locale) : t('billing.doc.onFinalize')}
            </dd>
            <dt className="text-muted">{t('billing.doc.customer')}</dt>
            <dd className="text-right">{invoice.org.name}</dd>
          </dl>
        </div>

        <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[540px] text-sm">
            <thead>
              <tr className="border-b border-border-strong text-left text-xs font-medium tracking-wide text-muted uppercase">
                <th className="py-2 pr-3 font-medium">{t('billing.line.description')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('billing.line.quantity')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('billing.line.unitPrice')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('billing.line.tax')}</th>
                <th className="py-2 pl-3 text-right font-medium">{t('billing.line.total')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {invoice.lines.map((line) => (
                <tr key={line.id} className="align-top">
                  <td className="py-2.5 pr-3">
                    <div className="whitespace-pre-line text-text">{line.description}</div>
                    {showPeriod(line) && (
                      <div className="text-xs text-muted">
                        {t('billing.line.period', {
                          from: formatDay(line.periodStart, locale),
                          to: formatDay(line.periodEnd, locale),
                        })}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap tabular">
                    {formatQuantity(line.quantity, locale)}
                    {line.unit && <span className="text-muted"> {line.unit}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap tabular">
                    {money(line.unitPrice)}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap text-muted tabular">
                    {formatRate(line.taxRateBp, locale)}
                  </td>
                  <td className="py-2.5 pl-3 text-right whitespace-nowrap tabular">{money(line.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end">
          <dl className="w-full space-y-1.5 text-sm sm:w-96">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">{t('billing.doc.subtotal')}</dt>
              <dd className="tabular">{money(invoice.subtotal)}</dd>
            </div>
            {invoice.taxBreakdown.map((b) => (
              <div key={b.rateBp} className="flex justify-between gap-4">
                <dt className="text-muted">
                  {t('billing.doc.taxLine', { rate: formatRate(b.rateBp, locale), net: money(b.net) })}
                </dt>
                <dd className="tabular">{money(b.tax)}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-4 border-t border-border-strong pt-2 text-base font-semibold">
              <dt>{t('billing.doc.total')}</dt>
              <dd className="tabular">{money(invoice.total)}</dd>
            </div>
            {invoice.amountPaid > 0 && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted">{t('billing.doc.paid')}</dt>
                <dd className="tabular">−{money(invoice.amountPaid)}</dd>
              </div>
            )}
            {invoice.status === 'open' && (
              <div
                className={cn(
                  'flex justify-between gap-4 rounded-lg px-3 py-2 font-semibold',
                  invoice.overdue ? 'bg-danger-soft text-danger' : 'bg-primary-soft text-primary-text',
                )}
              >
                <dt>{t('billing.doc.amountDue')}</dt>
                <dd className="tabular">{money(invoice.amountDue)}</dd>
              </div>
            )}
          </dl>
        </div>

        {invoice.notes && (
          <div className="border-t border-border pt-4 text-sm whitespace-pre-line text-muted">
            {invoice.notes}
          </div>
        )}
      </div>
    </Card>
  );
}

// --- Paying ------------------------------------------------------------------------------

type PayMethod = 'credit' | 'card' | 'twint';
const isPayMethod = (m: PaymentMethod): m is PayMethod => m === 'credit' || m === 'card' || m === 'twint';

const methodIcon: Record<PayMethod, ReactNode> = {
  credit: <Wallet className="size-4" />,
  card: <CreditCard className="size-4" />,
  twint: <Smartphone className="size-4" />,
};

/** Amount due and the payment buttons. Card and TWINT redirect to Stripe Checkout. */
function PayCard({ invoice, asSeller }: { invoice: InvoiceDetailDto; asSeller: boolean }) {
  const { t, locale } = useI18n();
  const [confirmCredit, setConfirmCredit] = useState(false);
  const money = (v: number) => formatMoney(v, invoice.currency, locale);
  const pay = useApiMutation(
    (method: PayMethod) => api.post<PayResult>(`/invoices/${invoice.id}/pay`, { method }),
    {
      invalidate: (method) => (method === 'credit' ? [billingKeys.all] : []),
      success: (result) =>
        'checkoutUrl' in result
          ? null
          : result.status === 'paid'
            ? t('billing.pay.creditPaid', { amount: money(result.amount) })
            : t('billing.pay.creditPartial', { amount: money(result.amount) }),
      onSuccess: (result) => {
        setConfirmCredit(false);
        if ('checkoutUrl' in result && /^https?:\/\//.test(result.checkoutUrl)) {
          window.location.assign(result.checkoutUrl);
        }
      },
    },
  );
  // The issuer sees "credit" only, a customer every method it may use.
  const redirecting = pay.isSuccess && 'checkoutUrl' in (pay.data ?? {});

  if (invoice.status === 'paid') {
    return (
      <Card>
        <CardBody className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
          <div>
            <p className="font-semibold text-text">{t('billing.pay.isPaid')}</p>
            <p className="text-sm text-muted">
              {invoice.paidAt
                ? t('billing.pay.paidOn', { date: formatDate(invoice.paidAt, locale, false) })
                : null}
            </p>
          </div>
        </CardBody>
      </Card>
    );
  }
  if (invoice.status !== 'open') return null;

  return (
    <Card>
      <CardBody className="space-y-4">
        <div>
          <div className="text-sm text-muted">{t('billing.doc.amountDue')}</div>
          <div
            className={cn('text-2xl font-semibold tabular', invoice.overdue ? 'text-danger' : 'text-text')}
          >
            {money(invoice.amountDue)}
          </div>
          {invoice.dueDate && (
            <div className={cn('text-sm', invoice.overdue ? 'font-medium text-danger' : 'text-muted')}>
              {invoice.overdue
                ? t('billing.pay.overdueSince', { date: formatDay(invoice.dueDate, locale) })
                : t('billing.pay.dueOn', { date: formatDay(invoice.dueDate, locale) })}
            </div>
          )}
        </div>
        {invoice.payMethods.length > 0 ? (
          <div className="flex flex-col gap-2">
            {invoice.payMethods.filter(isPayMethod).map((method) => (
              <Button
                key={method}
                variant={method === 'credit' ? 'secondary' : 'primary'}
                icon={methodIcon[method]}
                className="w-full justify-center"
                loading={pay.isPending && pay.variables === method}
                disabled={pay.isPending || redirecting}
                onClick={() => (method === 'credit' ? setConfirmCredit(true) : pay.mutate(method))}
              >
                {t(`billing.pay.with.${method}`)}
              </Button>
            ))}
            {redirecting && <p className="text-xs text-muted">{t('billing.pay.redirecting')}</p>}
          </div>
        ) : asSeller ? null : (
          <p className="text-sm text-muted">{t('billing.pay.bankTransfer')}</p>
        )}
      </CardBody>
      <ConfirmDialog
        open={confirmCredit}
        onOpenChange={setConfirmCredit}
        danger={false}
        title={t('billing.pay.creditTitle')}
        description={asSeller ? t('billing.pay.creditTextSeller') : t('billing.pay.creditText')}
        confirmLabel={t('billing.pay.with.credit')}
        loading={pay.isPending}
        onConfirm={() => pay.mutate('credit')}
      />
    </Card>
  );
}

export function PaymentsTable({
  payments,
  showInvoice,
}: {
  payments: PaymentDto[];
  showInvoice?: ReactNode;
}) {
  const { t, locale } = useI18n();
  const labels = useBillingLabels();
  return (
    <Table>
      <THead>
        <tr>
          <TH>{t('billing.col.date')}</TH>
          <TH>{t('billing.col.method')}</TH>
          {showInvoice && <TH className="hidden sm:table-cell">{t('billing.col.invoice')}</TH>}
          <TH className="text-right">{t('billing.col.amount')}</TH>
          <TH>{t('billing.col.status')}</TH>
        </tr>
      </THead>
      <TBody>
        {payments.map((p) => (
          <tr key={p.id}>
            <TD className="whitespace-nowrap text-muted">
              {formatDate(p.completedAt ?? p.createdAt, locale)}
            </TD>
            <TD>
              <div>{labels.method(p.method)}</div>
              {p.reference && <div className="max-w-[220px] truncate text-xs text-muted">{p.reference}</div>}
            </TD>
            {showInvoice && (
              <TD className="hidden sm:table-cell">
                {p.invoice ? (
                  <Mono>{p.invoice.number ?? '–'}</Mono>
                ) : (
                  <span className="text-muted">{t('billing.payments.topup')}</span>
                )}
              </TD>
            )}
            <TD className="text-right whitespace-nowrap tabular">
              {formatMoney(p.amount, p.currency, locale)}
            </TD>
            <TD>
              <PaymentStatusBadge status={p.status} />
              {p.error && (
                <div
                  className={cn(
                    'mt-0.5 max-w-[200px] text-xs',
                    p.status === 'succeeded' ? 'text-warning' : 'text-danger',
                  )}
                >
                  {p.error}
                </div>
              )}
            </TD>
          </tr>
        ))}
      </TBody>
    </Table>
  );
}

/** Compact payment history for the narrow column next to the invoice. */
function PaymentList({ payments }: { payments: PaymentDto[] }) {
  const { locale } = useI18n();
  const labels = useBillingLabels();
  return (
    <ul className="divide-y divide-border">
      {payments.map((p) => (
        <li key={p.id} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
          <div className="min-w-0">
            <div className="text-text">{labels.method(p.method)}</div>
            <div className="text-xs text-muted">{formatDate(p.completedAt ?? p.createdAt, locale)}</div>
            {p.reference && <div className="truncate text-xs text-muted">{p.reference}</div>}
            {p.error && (
              <div className={cn('text-xs', p.status === 'succeeded' ? 'text-warning' : 'text-danger')}>
                {p.error}
              </div>
            )}
          </div>
          <div className="shrink-0 text-right">
            <div className="font-medium tabular">{formatMoney(p.amount, p.currency, locale)}</div>
            <PaymentStatusBadge status={p.status} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// --- Issuer actions ----------------------------------------------------------------------

function FinalizeDialog({
  invoice,
  open,
  onOpenChange,
}: {
  invoice: InvoiceDetailDto;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useI18n();
  const [send, setSend] = useState(true);
  useEffect(() => {
    if (open) setSend(true);
  }, [open]);
  const finalize = useApiMutation(
    () => api.post<InvoiceDetailDto>(`/invoices/${invoice.id}/finalize`, { send }),
    {
      success: (inv) => t('billing.finalize.done', { number: inv.number ?? '' }),
      invalidate: [billingKeys.all],
      onSuccess: () => onOpenChange(false),
    },
  );
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      danger={false}
      title={t('billing.finalize.title')}
      description={t('billing.finalize.text')}
      confirmLabel={t('billing.finalize.confirm')}
      loading={finalize.isPending}
      onConfirm={() => finalize.mutate(undefined)}
    >
      <label className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
        <span>
          <span className="block text-sm font-medium text-text">{t('billing.finalize.send')}</span>
          <span className="block text-xs text-muted">{t('billing.finalize.sendHint')}</span>
        </span>
        <Switch checked={send} onCheckedChange={setSend} label={t('billing.finalize.send')} />
      </label>
    </ConfirmDialog>
  );
}

function VoidDialog({
  invoice,
  open,
  onOpenChange,
}: {
  invoice: InvoiceDetailDto;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const voidIt = useApiMutation(
    () => api.post<InvoiceDetailDto>(`/invoices/${invoice.id}/void`, { reason: reason.trim() }),
    {
      success: t('billing.void.done'),
      invalidate: [billingKeys.all],
      onSuccess: () => {
        setReason('');
        onOpenChange(false);
      },
    },
  );
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={t('billing.void.title', { number: invoice.number ?? '' })}
      description={t('billing.void.text')}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={!reason.trim()}
            loading={voidIt.isPending}
            onClick={() => voidIt.mutate(undefined)}
          >
            {t('billing.void.confirm')}
          </Button>
        </>
      }
    >
      <Field label={t('billing.void.reason')} htmlFor="void-reason" hint={t('billing.void.reasonHint')}>
        <Textarea
          id="void-reason"
          rows={3}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('billing.void.reasonPlaceholder')}
          autoFocus
        />
      </Field>
    </Dialog>
  );
}

function MarkPaidDialog({
  invoice,
  open,
  onOpenChange,
}: {
  invoice: InvoiceDetailDto;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const [amount, setAmount] = useState(() => moneyInput(invoice.amountDue));
  const [method, setMethod] = useState<'bank_transfer' | 'cash' | 'other'>('bank_transfer');
  const [reference, setReference] = useState('');
  const [notify, setNotify] = useState(false);
  // Start from the current amount due each time the dialog opens (it changes after part payments).
  useEffect(() => {
    if (!open) return;
    setAmount(moneyInput(invoice.amountDue));
    setMethod('bank_transfer');
    setReference('');
    setNotify(false);
  }, [open, invoice.amountDue]);
  const parsed = parseMoney(amount);
  const valid = parsed !== null && parsed > 0 && parsed <= invoice.amountDue;
  const markPaid = useApiMutation(
    () =>
      api.post<InvoiceDetailDto>(`/invoices/${invoice.id}/mark-paid`, {
        amount: parsed,
        method,
        reference: reference.trim() || null,
        notify,
      }),
    {
      success: t('billing.markPaid.done'),
      invalidate: [billingKeys.all],
      onSuccess: () => onOpenChange(false),
    },
  );
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={t('billing.markPaid.title')}
      description={t('billing.markPaid.text', {
        amount: formatMoney(invoice.amountDue, invoice.currency, locale),
      })}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            loading={markPaid.isPending}
            onClick={() => markPaid.mutate(undefined)}
          >
            {t('billing.markPaid.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label={`${t('billing.col.amount')} (${invoice.currency})`}
          htmlFor="mp-amount"
          error={amount && !valid ? t('billing.markPaid.amountError') : undefined}
        >
          <Input
            id="mp-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="tabular"
          />
        </Field>
        <Field label={t('billing.col.method')} htmlFor="mp-method">
          <Select id="mp-method" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            <option value="bank_transfer">{t('billing.method.bank_transfer')}</option>
            <option value="cash">{t('billing.method.cash')}</option>
            <option value="other">{t('billing.method.other')}</option>
          </Select>
        </Field>
        <Field label={t('billing.markPaid.reference')} htmlFor="mp-ref" hint={t('common.optional')}>
          <Input
            id="mp-ref"
            value={reference}
            maxLength={200}
            onChange={(e) => setReference(e.target.value)}
            placeholder={t('billing.markPaid.referencePlaceholder')}
          />
        </Field>
        <label className="flex items-center justify-between gap-4">
          <span className="text-sm text-text">{t('billing.markPaid.notify')}</span>
          <Switch checked={notify} onCheckedChange={setNotify} label={t('billing.markPaid.notify')} />
        </label>
      </div>
    </Dialog>
  );
}

function sendToast(t: ReturnType<typeof useI18n>['t'], result: MailSendResult) {
  if (result.status === 'sent') toast.success(t('billing.send.sent'));
  else if (result.status === 'skipped') toast.warning(t('billing.send.skipped'));
  else toast.error(t('billing.send.failed', { error: result.error ?? '' }));
}

/** Toolbar with the issuer's actions. Renders nothing for customers. */
function IssuerActions({ invoice, onDeleted }: { invoice: InvoiceDetailDto; onDeleted?: () => void }) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState<null | 'edit' | 'finalize' | 'void' | 'paid' | 'delete'>(null);
  const close = (o: boolean) => !o && setDialog(null);
  const send = useApiMutation(() => api.post<MailSendResult>(`/invoices/${invoice.id}/send`), {
    invalidate: [billingKeys.all],
    onSuccess: (result) => sendToast(t, result),
  });
  const remove = useApiMutation(() => api.del(`/invoices/${invoice.id}`), {
    success: t('billing.delete.done'),
    invalidate: [billingKeys.all],
    onSuccess: () => {
      setDialog(null);
      onDeleted?.();
    },
  });
  const { can } = invoice;
  if (!can.edit && !can.finalize && !can.markPaid && !can.void && !can.send) return null;
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {can.finalize && (
          <Button
            variant="primary"
            icon={<CheckCircle2 className="size-4" />}
            onClick={() => setDialog('finalize')}
          >
            {t('billing.finalize.action')}
          </Button>
        )}
        {can.edit && (
          <Button icon={<Pencil className="size-4" />} onClick={() => setDialog('edit')}>
            {t('common.edit')}
          </Button>
        )}
        {can.markPaid && (
          <Button variant="primary" icon={<Wallet className="size-4" />} onClick={() => setDialog('paid')}>
            {t('billing.markPaid.action')}
          </Button>
        )}
        {can.send && (
          <Button
            icon={invoice.sentAt ? <Mail className="size-4" /> : <Send className="size-4" />}
            loading={send.isPending}
            onClick={() => send.mutate(undefined)}
          >
            {invoice.sentAt ? t('billing.send.again') : t('billing.send.action')}
          </Button>
        )}
        {can.void && (
          <Button variant="danger-soft" icon={<Ban className="size-4" />} onClick={() => setDialog('void')}>
            {t('billing.void.action')}
          </Button>
        )}
        {can.edit && (
          <Button
            variant="danger-soft"
            icon={<Trash2 className="size-4" />}
            onClick={() => setDialog('delete')}
          >
            {t('common.delete')}
          </Button>
        )}
      </div>
      {can.edit && (
        <InvoiceEditorDialog
          open={dialog === 'edit'}
          onOpenChange={close}
          customerOrgId={invoice.org.id}
          sellerOrgId={invoice.issuer.orgId}
          invoice={invoice}
        />
      )}
      {can.finalize && <FinalizeDialog invoice={invoice} open={dialog === 'finalize'} onOpenChange={close} />}
      {can.void && <VoidDialog invoice={invoice} open={dialog === 'void'} onOpenChange={close} />}
      {can.markPaid && <MarkPaidDialog invoice={invoice} open={dialog === 'paid'} onOpenChange={close} />}
      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={close}
        title={t('billing.delete.title')}
        description={t('billing.delete.text')}
        confirmLabel={t('common.delete')}
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
    </>
  );
}

/** Zoho Books state of a platform invoice, with a manual resync for platform:billing:write. */
function ZohoCard({ invoice }: { invoice: InvoiceDetailDto }) {
  const { t, locale } = useI18n();
  const me = useMe();
  const mayWrite = me.data?.platformPermissions.includes('platform:billing:write') ?? false;
  const sync = useApiMutation(() => api.post<InvoiceDto>(`/invoices/${invoice.id}/zoho-sync`), {
    invalidate: [billingKeys.all],
    onSuccess: (result) => {
      if (result.zoho?.status === 'error')
        toast.error(t('billing.zoho.syncFailed', { error: result.zoho.error ?? '' }));
      else toast.success(t('billing.zoho.syncDone'));
    },
  });
  const configured = useZohoConfigured();
  if (!invoice.zoho || invoice.status === 'draft') return null;
  const { zoho } = invoice;
  // Nothing to show or retry while Zoho Books is not set up and the invoice never went there.
  if (configured === false && !zoho.status) return null;
  return (
    <Card>
      <CardHeader
        title={t('billing.zoho.title')}
        actions={
          mayWrite &&
          configured !== false && (
            <Button
              size="sm"
              icon={<RefreshCw className="size-4" />}
              loading={sync.isPending}
              onClick={() => sync.mutate(undefined)}
            >
              {t('billing.zoho.resync')}
            </Button>
          )
        }
      />
      <CardBody className="space-y-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted">{t('billing.col.status')}</span>
          <ZohoBadge zoho={zoho} />
        </div>
        {zoho.invoiceId && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted">{t('billing.zoho.id')}</span>
            <Mono>{zoho.invoiceId}</Mono>
          </div>
        )}
        {zoho.error && (
          <Notice tone="danger" className="mt-2">
            {zoho.error}
          </Notice>
        )}
        {invoice.sentAt && (
          <p className="pt-1 text-xs text-muted">
            {t('billing.invoice.sentAt', { date: formatDate(invoice.sentAt, locale) })}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

// --- Composed view ------------------------------------------------------------------------

export function InvoiceView({
  invoiceId,
  perspective,
  back,
  onDeleted,
  embedded,
}: {
  invoiceId: string;
  /** customer: the billed organization's view. seller: the issuer's (admin, reseller). */
  perspective: 'customer' | 'seller';
  /** Link or button back to the list, shown above the title. */
  back?: ReactNode;
  onDeleted?: () => void;
  /** Inside another page (seller panel): smaller heading. */
  embedded?: boolean;
}) {
  const { t, locale } = useI18n();
  const query = useInvoice(invoiceId);
  const zohoConfigured = useZohoConfigured();

  if (query.isPending) {
    return (
      <>
        {back}
        <LoadingBlock rows={6} />
      </>
    );
  }
  if (query.isError) {
    return (
      <>
        {back}
        {query.error instanceof ApiError && query.error.status === 404 ? (
          <Card>
            <EmptyState
              icon={<FileSearch className="size-6" />}
              title={t('billing.invoice.notFound')}
              description={t('billing.invoice.notFoundText')}
            />
          </Card>
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )}
      </>
    );
  }
  const invoice = query.data;
  const issuerView = perspective === 'seller';
  const { can } = invoice;
  const hasActions = can.edit || can.finalize || can.markPaid || can.void || can.send;
  const Heading = embedded ? 'h2' : 'h1';

  return (
    <>
      {back}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">
            {issuerView ? invoice.org.name : invoice.issuer.name}
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Heading
              className={cn(
                'font-display font-semibold tracking-tight text-text',
                embedded ? 'text-xl' : 'text-2xl',
              )}
            >
              {invoiceTitle(t, invoice)}
            </Heading>
            <InvoiceStatusBadge invoice={invoice} />
            {invoice.zoho &&
              invoice.status !== 'draft' &&
              (zohoConfigured !== false || invoice.zoho.status) && <ZohoBadge zoho={invoice.zoho} />}
          </div>
          <p className="mt-1 text-sm text-muted">
            {invoice.issueDate
              ? t('billing.invoice.meta', {
                  date: formatDay(invoice.issueDate, locale),
                  total: formatMoney(invoice.total, invoice.currency, locale),
                })
              : t('billing.invoice.draftMeta', {
                  total: formatMoney(invoice.total, invoice.currency, locale),
                })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={pdfUrl(invoice.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium whitespace-nowrap text-text shadow-card transition-colors hover:bg-surface-3"
          >
            <FileDown className="size-4" />
            {invoice.status === 'draft' ? t('billing.invoice.pdfPreview') : t('billing.invoice.pdf')}
          </a>
        </div>
      </div>

      {hasActions && (
        <div className="mb-6">
          <IssuerActions invoice={invoice} onDeleted={onDeleted} />
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <InvoiceDocument invoice={invoice} />
        </div>
        <aside className="order-first space-y-4 xl:order-none">
          <PayCard invoice={invoice} asSeller={issuerView} />
          {invoice.status === 'void' && (
            <Card>
              <CardBody className="flex items-start gap-3">
                <Ban className="mt-0.5 size-5 shrink-0 text-muted" />
                <div className="min-w-0 text-sm">
                  <p className="text-muted">{t('billing.invoice.voidText')}</p>
                  {invoice.voidReason && (
                    <p className="mt-1 break-words text-text">
                      {t('billing.invoice.voidReason', { reason: invoice.voidReason })}
                    </p>
                  )}
                </div>
              </CardBody>
            </Card>
          )}
          <ZohoCard invoice={invoice} />
          {invoice.status !== 'draft' && (
            <Card>
              <CardHeader title={t('billing.invoice.payments')} />
              {invoice.payments.length === 0 ? (
                <p className="px-5 py-4 text-sm text-muted">{t('billing.invoice.noPayments')}</p>
              ) : (
                <PaymentList payments={invoice.payments} />
              )}
            </Card>
          )}
          {issuerView && invoice.sentAt && !invoice.zoho && (
            <p className="px-1 text-xs text-muted">
              {t('billing.invoice.sentAt', { date: formatDate(invoice.sentAt, locale) })}
            </p>
          )}
          {issuerView && invoice.status === 'draft' && (
            <Notice tone="info">{t('billing.invoice.draftHint')}</Notice>
          )}
        </aside>
      </div>
    </>
  );
}
