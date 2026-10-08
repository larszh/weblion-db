import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatMoney, type InvoiceDto, type ServiceDto } from '@weblion/shared';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useZohoConfigured, type CreditPageDto } from '@/lib/api/billing';
import { Mono } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import {
  InvoiceStatusBadge,
  PriceText,
  ServiceResource,
  ServiceStatusBadge,
  SignedAmount,
  ZohoBadge,
  useBillingLabels,
} from './bits';
import { formatDay, formatQuantity } from './money';

/** Tables shared by the customer view, the seller panel and the admin overview. */

export function InvoiceTable({
  items,
  href,
  onOpen,
  showCustomer,
  showIssuer,
  showZoho,
}: {
  items: InvoiceDto[];
  /** Where a row leads. Either this or onOpen. */
  href?: (invoice: InvoiceDto) => string;
  onOpen?: (invoice: InvoiceDto) => void;
  showCustomer?: boolean;
  showIssuer?: boolean;
  showZoho?: boolean;
}) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const zohoConfigured = useZohoConfigured();
  const open = (invoice: InvoiceDto) => (href ? navigate(href(invoice)) : onOpen?.(invoice));
  const number = (invoice: InvoiceDto) =>
    invoice.number ? <Mono className="text-text">{invoice.number}</Mono> : t('billing.status.draft');
  return (
    <Table>
      <THead>
        <tr>
          <TH>{t('billing.col.number')}</TH>
          {showCustomer && <TH>{t('billing.col.customer')}</TH>}
          {showIssuer && <TH className="hidden lg:table-cell">{t('billing.col.issuer')}</TH>}
          <TH className="hidden sm:table-cell">{t('billing.col.date')}</TH>
          <TH className="hidden md:table-cell">{t('billing.col.due')}</TH>
          <TH className="hidden text-right md:table-cell">{t('billing.col.total')}</TH>
          <TH className="text-right">{t('billing.col.amountDue')}</TH>
          <TH>{t('billing.col.status')}</TH>
          {showZoho && <TH className="hidden xl:table-cell">{t('billing.col.zoho')}</TH>}
        </tr>
      </THead>
      <TBody>
        {items.map((invoice) => (
          <TR key={invoice.id} onClick={() => open(invoice)}>
            <TD className="whitespace-nowrap">
              {href ? (
                <Link
                  to={href(invoice)}
                  onClick={(e) => e.stopPropagation()}
                  className="font-medium text-primary-text hover:underline"
                >
                  {number(invoice)}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    open(invoice);
                  }}
                  className="font-medium text-primary-text hover:underline"
                >
                  {number(invoice)}
                </button>
              )}
            </TD>
            {showCustomer && (
              <TD className="max-w-[200px] truncate" title={invoice.org.name}>
                {invoice.org.name}
              </TD>
            )}
            {showIssuer && (
              <TD className="hidden max-w-[160px] truncate text-muted lg:table-cell">
                {invoice.issuer.name}
              </TD>
            )}
            <TD className="hidden whitespace-nowrap text-muted sm:table-cell">
              {invoice.issueDate ? formatDay(invoice.issueDate, locale) : '–'}
            </TD>
            <TD
              className={cn(
                'hidden whitespace-nowrap md:table-cell',
                invoice.overdue ? 'font-medium text-danger' : 'text-muted',
              )}
            >
              {invoice.dueDate ? formatDay(invoice.dueDate, locale) : '–'}
            </TD>
            <TD className="hidden text-right whitespace-nowrap tabular md:table-cell">
              {formatMoney(invoice.total, invoice.currency, locale)}
            </TD>
            <TD
              className={cn(
                'text-right whitespace-nowrap tabular',
                invoice.status === 'open' ? 'font-medium' : 'text-muted',
                invoice.overdue && 'text-danger',
              )}
            >
              {invoice.status === 'open' ? formatMoney(invoice.amountDue, invoice.currency, locale) : '–'}
            </TD>
            <TD>
              <InvoiceStatusBadge invoice={invoice} />
            </TD>
            {showZoho && (
              <TD className="hidden xl:table-cell">
                {invoice.zoho &&
                invoice.status !== 'draft' &&
                (zohoConfigured !== false || invoice.zoho.status) ? (
                  <ZohoBadge zoho={invoice.zoho} />
                ) : null}
              </TD>
            )}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

/** Credit movements with the balance after each one. */
export function CreditTable({
  data,
  invoiceHref,
}: {
  data: CreditPageDto;
  invoiceHref?: (invoiceId: string) => string;
}) {
  const { t, locale } = useI18n();
  const labels = useBillingLabels();
  return (
    <Table>
      <THead>
        <tr>
          <TH>{t('billing.col.date')}</TH>
          <TH>{t('billing.col.description')}</TH>
          <TH className="hidden md:table-cell">{t('billing.col.type')}</TH>
          <TH className="text-right">{t('billing.col.amount')}</TH>
          <TH className="hidden text-right sm:table-cell">{t('billing.col.balance')}</TH>
        </tr>
      </THead>
      <TBody>
        {data.items.map((tx) => (
          <tr key={tx.id}>
            <TD className="whitespace-nowrap text-muted">{formatDate(tx.createdAt, locale)}</TD>
            <TD className="min-w-[180px]">
              <div className="text-text">{tx.description}</div>
              <div className="text-xs text-muted">
                {tx.invoice &&
                  (invoiceHref ? (
                    <Link to={invoiceHref(tx.invoice.id)} className="text-primary-text hover:underline">
                      {t('billing.credit.forInvoice', { number: tx.invoice.number ?? '' })}
                    </Link>
                  ) : (
                    t('billing.credit.forInvoice', { number: tx.invoice.number ?? '' })
                  ))}
                {tx.invoice && tx.createdBy && ' · '}
                {tx.createdBy && t('billing.credit.by', { name: tx.createdBy.name })}
              </div>
            </TD>
            <TD className="hidden text-muted md:table-cell">{labels.creditType(tx.type)}</TD>
            <TD className="text-right">
              <SignedAmount amount={tx.amount} currency={tx.currency} />
            </TD>
            <TD className="hidden text-right whitespace-nowrap text-muted tabular sm:table-cell">
              {formatMoney(tx.balanceAfter, tx.currency, locale)}
            </TD>
          </tr>
        ))}
      </TBody>
    </Table>
  );
}

/** Services ("Dienste") with price, interval and next billing date. */
export function ServiceTable({
  services,
  base,
  linkable,
  actions,
}: {
  services: ServiceDto[];
  /** /o/<slug> of the customer, to link resources. */
  base?: string;
  /** Whether the resource of a service has a page to link to. Default: yes. */
  linkable?: (service: ServiceDto) => boolean;
  actions?: (service: ServiceDto) => ReactNode;
}) {
  const { t, locale } = useI18n();
  const labels = useBillingLabels();
  return (
    <Table>
      <THead>
        <tr>
          <TH>{t('billing.col.service')}</TH>
          <TH className="hidden lg:table-cell">{t('billing.col.resource')}</TH>
          <TH className="text-right">{t('billing.col.price')}</TH>
          <TH className="hidden md:table-cell">{t('billing.col.nextBilling')}</TH>
          <TH>{t('billing.col.status')}</TH>
          {actions && <TH />}
        </tr>
      </THead>
      <TBody>
        {services.map((s) => (
          <tr key={s.id} className={s.status === 'cancelled' ? 'opacity-70' : undefined}>
            <TD className="min-w-[180px]">
              <div className="font-medium text-text">{s.name}</div>
              <div className="text-xs text-muted">
                {[s.description, s.module ? labels.module(s.module) : null].filter(Boolean).join(' · ')}
              </div>
              <div className="mt-1 lg:hidden">
                {s.resource && (
                  <ServiceResource resource={s.resource} base={base} linkable={linkable?.(s) ?? true} />
                )}
              </div>
            </TD>
            <TD className="hidden lg:table-cell">
              <ServiceResource resource={s.resource} base={base} linkable={linkable?.(s) ?? true} />
            </TD>
            <TD className="text-right">
              <PriceText amount={s.unitPrice} currency={s.currency} interval={s.interval} />
              {s.quantity !== 1 && (
                <div className="text-xs text-muted tabular">
                  {t('billing.service.quantity', { quantity: formatQuantity(s.quantity, locale) })}
                </div>
              )}
            </TD>
            <TD className="hidden whitespace-nowrap md:table-cell">
              {s.status === 'cancelled' ? (
                <span className="text-muted">
                  {s.endsAt ? t('billing.service.endsAt', { date: formatDay(s.endsAt, locale) }) : '–'}
                </span>
              ) : s.nextBillingAt ? (
                <span className="text-text">{formatDay(s.nextBillingAt, locale)}</span>
              ) : (
                <span className="text-muted">
                  {s.interval === 'once' ? t('billing.service.billedOnce') : '–'}
                </span>
              )}
              <div className="text-xs text-muted">{labels.interval(s.interval)}</div>
            </TD>
            <TD>
              <ServiceStatusBadge status={s.status} />
            </TD>
            {actions && <TD className="w-10 text-right">{actions(s)}</TD>}
          </tr>
        ))}
      </TBody>
    </Table>
  );
}
