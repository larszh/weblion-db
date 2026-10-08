import { useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import {
  Ban,
  ChevronLeft,
  CreditCard,
  FileText,
  Layers,
  MapPin,
  MoreHorizontal,
  Pause,
  Pencil,
  PiggyBank,
  Play,
  Plus,
  Wallet,
  Zap,
} from 'lucide-react';
import { formatMoney, type ServiceDto } from '@weblion/shared';
import { ApiError, api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApiMutation } from '@/lib/queries';
import {
  billingKeys,
  useIssuerOf,
  useSellerCredit,
  useSellerCustomer,
  useSellerInvoices,
  useSellerPayments,
  useSellerServices,
  useZohoConfigured,
  type InvoiceFilter,
} from '@/lib/api/billing';
import { Button } from '@/components/ui/button';
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/menu';
import {
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingBlock,
  Notice,
  Select,
} from '@/components/ui/primitives';
import { NoBillingAccess, Pager, TabCount, Tabs, useTabParam } from './bits';
import { InvoiceEditorDialog } from './invoice-editor';
import { InvoiceView, PaymentsTable } from './invoice-view';
import { BillingProfileForm } from './profile-form';
import {
  AddServiceDialog,
  CancelServiceDialog,
  CreditBookDialog,
  EditServiceDialog,
  GenerateDialog,
} from './seller-dialogs';
import { formatDay } from './money';
import { SummaryCards, SummarySkeleton } from './summary';
import { CreditTable, InvoiceTable, ServiceTable } from './tables';

/**
 * Billing of one customer as its seller sees it: the platform for its customers (admin
 * customer detail), a reseller for its own customers (reseller customer detail). Sections
 * live in ?billing=, an opened invoice in ?invoice=, so the page's own ?tab= stays intact.
 */

const SECTIONS = ['invoices', 'services', 'credit', 'payments', 'profile'] as const;

type Customer = NonNullable<ReturnType<typeof useSellerCustomer>['data']>;

/** The current URL with ?invoice= set or removed, keeping the page's other parameters. */
function useInvoiceParam(): [string | null, (id: string | null) => void, (id: string) => string] {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const set = (id: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set('invoice', id);
      else next.delete('invoice');
      return next;
    });
  const href = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('invoice', id);
    return `${pathname}?${next.toString()}`;
  };
  return [params.get('invoice'), set, href];
}

function InvoicesSection({
  customer,
  canWrite,
  openInvoice,
}: {
  customer: Customer;
  canWrite: boolean;
  openInvoice: (id: string) => void;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<InvoiceFilter>('');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<null | 'create' | 'generate'>(null);
  const invoices = useSellerInvoices(customer.org.id, { status, page });
  const zohoConfigured = useZohoConfigured();
  const platform = !customer.seller.orgId;
  return (
    <Card>
      <CardHeader
        title={t('billing.tab.invoices')}
        actions={
          <>
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as InvoiceFilter);
                setPage(1);
              }}
              className="h-8 w-auto text-[13px]"
              aria-label={t('billing.filter.status')}
            >
              <option value="">{t('billing.filter.all')}</option>
              <option value="draft">{t('billing.filter.drafts')}</option>
              <option value="open">{t('billing.status.open')}</option>
              <option value="overdue">{t('billing.status.overdue')}</option>
              <option value="paid">{t('billing.status.paid')}</option>
              <option value="void">{t('billing.status.void')}</option>
            </Select>
            {canWrite && (
              <>
                <Button size="sm" icon={<Zap className="size-4" />} onClick={() => setDialog('generate')}>
                  {t('billing.generate.action')}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Plus className="size-4" />}
                  onClick={() => setDialog('create')}
                >
                  {t('billing.invoice.create')}
                </Button>
              </>
            )}
          </>
        }
      />
      {invoices.isPending ? (
        <LoadingBlock />
      ) : invoices.isError ? (
        <div className="p-5">
          <ErrorState error={invoices.error} onRetry={() => void invoices.refetch()} />
        </div>
      ) : invoices.data.items.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-6" />}
          title={status ? t('billing.invoices.noneFiltered') : t('billing.invoices.none')}
          description={status ? undefined : t('billing.invoices.noneSeller')}
        />
      ) : (
        <>
          <InvoiceTable
            items={invoices.data.items}
            onOpen={(i) => openInvoice(i.id)}
            showZoho={platform && zohoConfigured !== false}
          />
          <Pager
            page={invoices.data.page}
            perPage={invoices.data.perPage}
            total={invoices.data.total}
            onChange={setPage}
          />
        </>
      )}
      {canWrite && (
        <>
          <InvoiceEditorDialog
            open={dialog === 'create'}
            onOpenChange={(o) => !o && setDialog(null)}
            customerOrgId={customer.org.id}
            sellerOrgId={customer.seller.orgId}
            onSaved={(invoice) => openInvoice(invoice.id)}
          />
          <GenerateDialog
            open={dialog === 'generate'}
            onOpenChange={(o) => !o && setDialog(null)}
            customer={customer}
            onGenerated={openInvoice}
          />
        </>
      )}
    </Card>
  );
}

function ServicesSection({
  customer,
  canWrite,
  defaultTaxRateBp,
}: {
  customer: Customer;
  canWrite: boolean;
  defaultTaxRateBp: number | undefined;
}) {
  const { t, locale } = useI18n();
  const services = useSellerServices(customer.org.id);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ServiceDto | null>(null);
  const [cancelling, setCancelling] = useState<ServiceDto | null>(null);
  const setStatus = useApiMutation(
    ({ service, status }: { service: ServiceDto; status: 'active' | 'suspended' }) =>
      api.patch<ServiceDto>(`/services/${service.id}`, { status }),
    {
      success: (s) =>
        s.status === 'suspended'
          ? t('billing.service.suspended', { name: s.name })
          : s.nextBillingAt
            ? t('billing.service.resumedOn', { name: s.name, date: formatDay(s.nextBillingAt, locale) })
            : t('billing.service.resumed', { name: s.name }),
      invalidate: [billingKeys.all],
    },
  );
  const taxDefault = customer.profile.taxRateBp ?? defaultTaxRateBp;

  return (
    <Card>
      <CardHeader
        title={t('billing.tab.services')}
        description={t('billing.services.sellerText')}
        actions={
          canWrite && (
            <Button
              size="sm"
              variant="primary"
              icon={<Plus className="size-4" />}
              onClick={() => setAdding(true)}
            >
              {t('billing.service.add')}
            </Button>
          )
        }
      />
      {services.isPending ? (
        <LoadingBlock />
      ) : services.isError ? (
        <div className="p-5">
          <ErrorState error={services.error} onRetry={() => void services.refetch()} />
        </div>
      ) : services.data.length === 0 ? (
        <EmptyState
          icon={<Layers className="size-6" />}
          title={t('billing.services.none')}
          description={t('billing.services.noneSeller')}
          action={
            canWrite && (
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
                {t('billing.service.add')}
              </Button>
            )
          }
        />
      ) : (
        <ServiceTable
          services={services.data}
          actions={
            canWrite
              ? (s) =>
                  s.status === 'cancelled' ? null : (
                    <Menu
                      trigger={
                        <Button size="icon" variant="ghost" aria-label={t('common.actions')}>
                          <MoreHorizontal className="size-4" />
                        </Button>
                      }
                    >
                      <MenuItem icon={<Pencil />} onSelect={() => setEditing(s)}>
                        {t('common.edit')}
                      </MenuItem>
                      {s.status === 'active' ? (
                        <MenuItem
                          icon={<Pause />}
                          hint={t('billing.service.suspendHint')}
                          onSelect={() => setStatus.mutate({ service: s, status: 'suspended' })}
                        >
                          {t('billing.service.suspend')}
                        </MenuItem>
                      ) : (
                        <MenuItem
                          icon={<Play />}
                          hint={t('billing.service.resumeHint')}
                          onSelect={() => setStatus.mutate({ service: s, status: 'active' })}
                        >
                          {t('billing.service.resume')}
                        </MenuItem>
                      )}
                      <MenuSeparator />
                      <MenuItem icon={<Ban />} danger onSelect={() => setCancelling(s)}>
                        {t('billing.service.cancel')}
                      </MenuItem>
                    </Menu>
                  )
              : undefined
          }
        />
      )}
      {canWrite && (
        <>
          <AddServiceDialog
            open={adding}
            onOpenChange={setAdding}
            customer={customer}
            defaultTaxRateBp={defaultTaxRateBp}
          />
          <EditServiceDialog
            service={editing}
            onOpenChange={(o) => !o && setEditing(null)}
            defaultTaxRateBp={taxDefault}
          />
          <CancelServiceDialog service={cancelling} onOpenChange={(o) => !o && setCancelling(null)} />
        </>
      )}
    </Card>
  );
}

function CreditSection({
  customer,
  canWrite,
  invoiceHref,
}: {
  customer: Customer;
  canWrite: boolean;
  invoiceHref: (id: string) => string;
}) {
  const { t, locale } = useI18n();
  const [page, setPage] = useState(1);
  const [booking, setBooking] = useState(false);
  const credit = useSellerCredit(customer.org.id, page);
  return (
    <Card>
      <CardHeader
        title={t('billing.tab.credit')}
        description={t('billing.credit.balanceNow', {
          amount: formatMoney(customer.summary.balance, customer.summary.currency, locale),
        })}
        actions={
          canWrite && (
            <Button
              size="sm"
              variant="primary"
              icon={<Plus className="size-4" />}
              onClick={() => setBooking(true)}
            >
              {t('billing.book.action')}
            </Button>
          )
        }
      />
      {credit.isPending ? (
        <LoadingBlock />
      ) : credit.isError ? (
        <div className="p-5">
          <ErrorState error={credit.error} onRetry={() => void credit.refetch()} />
        </div>
      ) : credit.data.items.length === 0 ? (
        <EmptyState icon={<PiggyBank className="size-6" />} title={t('billing.credit.none')} />
      ) : (
        <>
          <CreditTable data={credit.data} invoiceHref={invoiceHref} />
          <Pager
            page={credit.data.page}
            perPage={credit.data.perPage}
            total={credit.data.total}
            onChange={setPage}
          />
        </>
      )}
      {canWrite && <CreditBookDialog open={booking} onOpenChange={setBooking} customer={customer} />}
    </Card>
  );
}

function PaymentsSection({ customer }: { customer: Customer }) {
  const { t } = useI18n();
  const payments = useSellerPayments(customer.org.id);
  return (
    <Card>
      <CardHeader title={t('billing.tab.payments')} />
      {payments.isPending ? (
        <LoadingBlock />
      ) : payments.isError ? (
        <div className="p-5">
          <ErrorState error={payments.error} onRetry={() => void payments.refetch()} />
        </div>
      ) : payments.data.length === 0 ? (
        <EmptyState icon={<CreditCard className="size-6" />} title={t('billing.payments.none')} />
      ) : (
        <PaymentsTable payments={payments.data} showInvoice />
      )}
    </Card>
  );
}

export function SellerBillingPanel({ orgId }: { orgId: string }) {
  const { t } = useI18n();
  const customer = useSellerCustomer(orgId);
  const sellerOrgId = customer.data?.seller.orgId;
  const canWrite = customer.data?.can.write ?? false;
  const issuer = useIssuerOf(sellerOrgId ?? null, customer.isSuccess);
  const [section, setSection] = useTabParam(SECTIONS, 'invoices', 'billing');
  const [invoiceId, setInvoiceId, invoiceHref] = useInvoiceParam();
  const [booking, setBooking] = useState(false);

  if (customer.isPending) {
    return (
      <>
        <SummarySkeleton />
        <Card>
          <LoadingBlock />
        </Card>
      </>
    );
  }
  if (customer.isError) {
    return customer.error instanceof ApiError && customer.error.status === 404 ? (
      <NoBillingAccess text={t('billing.seller.noAccessText')} />
    ) : (
      <ErrorState error={customer.error} onRetry={() => void customer.refetch()} />
    );
  }
  const data = customer.data;

  if (invoiceId) {
    return (
      <InvoiceView
        invoiceId={invoiceId}
        perspective="seller"
        embedded
        onDeleted={() => setInvoiceId(null)}
        back={
          <button
            type="button"
            onClick={() => setInvoiceId(null)}
            className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-text"
          >
            <ChevronLeft className="size-4" />
            {t('billing.seller.backToInvoices')}
          </button>
        }
      />
    );
  }

  const tabs = [
    {
      key: 'invoices' as const,
      label: t('billing.tab.invoices'),
      icon: <FileText />,
      badge: (
        <TabCount n={data.summary.openCount} tone={data.summary.overdueTotal > 0 ? 'danger' : 'neutral'} />
      ),
    },
    { key: 'services' as const, label: t('billing.tab.services'), icon: <Layers /> },
    { key: 'credit' as const, label: t('billing.tab.credit'), icon: <Wallet /> },
    { key: 'payments' as const, label: t('billing.tab.payments'), icon: <CreditCard /> },
    { key: 'profile' as const, label: t('billing.tab.address'), icon: <MapPin /> },
  ];

  return (
    <div>
      {data.seller.orgId && !canWrite && (
        <Notice tone="info" className="mb-4">
          {t('billing.seller.readOnlyReseller', { name: data.seller.name })}
        </Notice>
      )}
      <SummaryCards
        summary={data.summary}
        balanceAction={
          canWrite ? { label: t('billing.book.action'), onClick: () => setBooking(true) } : undefined
        }
      />
      <Tabs tabs={tabs} value={section} onChange={setSection} variant="pills" />
      {section === 'invoices' && (
        <InvoicesSection customer={data} canWrite={canWrite} openInvoice={setInvoiceId} />
      )}
      {section === 'services' && (
        <ServicesSection customer={data} canWrite={canWrite} defaultTaxRateBp={issuer?.defaultTaxRateBp} />
      )}
      {section === 'credit' && (
        <CreditSection customer={data} canWrite={canWrite} invoiceHref={invoiceHref} />
      )}
      {section === 'payments' && <PaymentsSection customer={data} />}
      {section === 'profile' && (
        <BillingProfileForm
          profile={data.profile}
          mode="seller"
          readOnly={!canWrite}
          defaultTaxRateBp={issuer?.defaultTaxRateBp}
        />
      )}
      {canWrite && <CreditBookDialog open={booking} onOpenChange={setBooking} customer={data} />}
    </div>
  );
}
