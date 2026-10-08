import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { CreditCard, FileText, Layers, MapPin, PiggyBank, Plus, Smartphone, Wallet } from 'lucide-react';
import { formatMoney, type BillingSummaryDto } from '@weblion/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { useApiMutation } from '@/lib/queries';
import {
  useBillingProfile,
  useBillingSummary,
  useOrgCredit,
  useOrgInvoices,
  useOrgPayments,
  useOrgServices,
  type CheckoutResult,
  type InvoiceFilter,
} from '@/lib/api/billing';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Notice,
  PageHeader,
  Select,
} from '@/components/ui/primitives';
import { BackLink, NoBillingAccess, Pager, PaymentReturnNotice, TabCount, Tabs, useTabParam } from './bits';
import { InvoiceView, PaymentsTable } from './invoice-view';
import { moneyInput, parseMoney } from './money';
import { BillingProfileForm } from './profile-form';
import { SummaryCards, SummarySkeleton } from './summary';
import { CreditTable, InvoiceTable, ServiceTable } from './tables';

/** Billing of the current organization as its members see it ("Abrechnung"). */

const TABS = ['invoices', 'credit', 'services', 'payments', 'address'] as const;
type Tab = (typeof TABS)[number];

/** Stripe accepts top-ups from CHF 5 to 10'000 (minor units, see the API). */
const TOPUP_MIN = 500;
const TOPUP_MAX = 1_000_000;
const TOPUP_PRESETS = [2000, 5000, 10_000, 20_000];

type OnlineMethod = 'card' | 'twint';
const onlineMethods = (summary: BillingSummaryDto | undefined): OnlineMethod[] =>
  (summary?.payMethods ?? []).filter((m): m is OnlineMethod => m === 'card' || m === 'twint');

function TopupDialog({
  open,
  onOpenChange,
  summary,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: BillingSummaryDto;
}) {
  const { t, locale } = useI18n();
  const { org } = useOrg();
  const methods = onlineMethods(summary);
  const [amount, setAmount] = useState('50.00');
  const [method, setMethod] = useState<OnlineMethod>(methods[0] ?? 'card');
  const parsed = parseMoney(amount);
  const valid = parsed !== null && parsed >= TOPUP_MIN && parsed <= TOPUP_MAX;
  const topup = useApiMutation(
    () => api.post<CheckoutResult>(`/orgs/${org.id}/credit/topup`, { amount: parsed, method }),
    {
      onSuccess: (result) => {
        if (/^https?:\/\//.test(result.checkoutUrl)) window.location.assign(result.checkoutUrl);
      },
    },
  );
  const redirecting = topup.isSuccess;
  const money = (v: number) => formatMoney(v, summary.currency, locale);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={t('billing.topup.title')}
      description={t('billing.topup.text')}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!valid || redirecting}
            loading={topup.isPending || redirecting}
            onClick={() => topup.mutate(undefined)}
          >
            {t('billing.topup.confirm', { amount: valid ? money(parsed) : '' })}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label={`${t('billing.col.amount')} (${summary.currency})`}
          htmlFor="topup-amount"
          hint={t('billing.topup.limits', { min: money(TOPUP_MIN), max: money(TOPUP_MAX) })}
          error={amount.trim() && !valid ? t('billing.topup.amountError') : undefined}
        >
          <Input
            id="topup-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="tabular"
            autoFocus
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          {TOPUP_PRESETS.map((preset) => (
            <Button
              key={preset}
              size="sm"
              variant={parsed === preset ? 'primary' : 'secondary'}
              onClick={() => setAmount(moneyInput(preset))}
            >
              {money(preset)}
            </Button>
          ))}
        </div>
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-[13px] font-medium text-text">{t('billing.col.method')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {methods.map((m) => (
              <label
                key={m}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors',
                  method === m
                    ? 'border-brand-blue bg-primary-soft text-primary-text'
                    : 'border-border-strong text-text hover:bg-surface-3',
                )}
              >
                <input
                  type="radio"
                  name="topup-method"
                  value={m}
                  checked={method === m}
                  onChange={() => setMethod(m)}
                  className="sr-only"
                />
                {m === 'card' ? <CreditCard className="size-4" /> : <Smartphone className="size-4" />}
                <span className="font-medium">{t(`billing.method.${m}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="text-xs text-muted">{t('billing.topup.stripeHint')}</p>
      </div>
    </Dialog>
  );
}

function InvoicesTab() {
  const { t } = useI18n();
  const { org, base } = useOrg();
  const [status, setStatus] = useState<InvoiceFilter>('');
  const [page, setPage] = useState(1);
  const invoices = useOrgInvoices(org.id, { status, page });
  return (
    <Card>
      <CardHeader
        title={t('billing.tab.invoices')}
        actions={
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
            <option value="open">{t('billing.status.open')}</option>
            <option value="overdue">{t('billing.status.overdue')}</option>
            <option value="paid">{t('billing.status.paid')}</option>
            <option value="void">{t('billing.status.void')}</option>
          </Select>
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
          description={status ? undefined : t('billing.invoices.noneText')}
        />
      ) : (
        <>
          <InvoiceTable items={invoices.data.items} href={(i) => `${base}/billing/invoices/${i.id}`} />
          <Pager
            page={invoices.data.page}
            perPage={invoices.data.perPage}
            total={invoices.data.total}
            onChange={setPage}
          />
        </>
      )}
    </Card>
  );
}

function CreditTab({ summary, onTopup }: { summary: BillingSummaryDto | undefined; onTopup?: () => void }) {
  const { t, locale } = useI18n();
  const { org, base } = useOrg();
  const [page, setPage] = useState(1);
  const credit = useOrgCredit(org.id, page);
  return (
    <Card>
      <CardHeader
        title={t('billing.tab.credit')}
        description={
          credit.data
            ? t('billing.credit.balanceNow', {
                amount: formatMoney(credit.data.balance, credit.data.currency, locale),
              })
            : undefined
        }
        actions={
          onTopup && (
            <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={onTopup}>
              {t('billing.topup.action')}
            </Button>
          )
        }
      />
      {!onTopup && summary?.seller.orgId && (
        <div className="border-b border-border px-5 py-3 text-sm text-muted">
          {t('billing.credit.viaReseller', { name: summary.seller.name })}
        </div>
      )}
      {credit.isPending ? (
        <LoadingBlock />
      ) : credit.isError ? (
        <div className="p-5">
          <ErrorState error={credit.error} onRetry={() => void credit.refetch()} />
        </div>
      ) : credit.data.items.length === 0 ? (
        <EmptyState
          icon={<PiggyBank className="size-6" />}
          title={t('billing.credit.none')}
          description={t('billing.credit.noneText')}
        />
      ) : (
        <>
          <CreditTable data={credit.data} invoiceHref={(id) => `${base}/billing/invoices/${id}`} />
          <Pager
            page={credit.data.page}
            perPage={credit.data.perPage}
            total={credit.data.total}
            onChange={setPage}
          />
        </>
      )}
    </Card>
  );
}

function ServicesTab() {
  const { t } = useI18n();
  const { org, base, hasModule } = useOrg();
  const services = useOrgServices(org.id);
  return (
    <Card>
      <CardHeader title={t('billing.tab.services')} description={t('billing.services.customerText')} />
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
          description={t('billing.services.noneText')}
        />
      ) : (
        <ServiceTable
          services={services.data}
          // Resources of a deactivated module have no page to link to.
          base={base}
          linkable={(s) =>
            !s.resource ||
            hasModule(
              s.resource.type === 'server' ? 'servers' : s.resource.type === 'domain' ? 'dns' : 'webhosting',
            )
          }
        />
      )}
    </Card>
  );
}

function PaymentsTab() {
  const { t } = useI18n();
  const { org } = useOrg();
  const payments = useOrgPayments(org.id);
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

function AddressTab() {
  const { org, can } = useOrg();
  const profile = useBillingProfile(org.id);
  if (profile.isPending) {
    return (
      <Card>
        <LoadingBlock rows={5} />
      </Card>
    );
  }
  if (profile.isError) return <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />;
  return <BillingProfileForm profile={profile.data} mode="customer" readOnly={!can('billing:write')} />;
}

export function BillingPage() {
  const { t } = useI18n();
  const { org, can } = useOrg();
  const [tab, setTab] = useTabParam(TABS, 'invoices');
  const [topupOpen, setTopupOpen] = useState(false);
  const allowed = can('billing:read');
  const summary = useBillingSummary(org.id, allowed);

  if (!allowed) {
    return (
      <>
        <PageHeader title={t('nav.billing')} />
        <NoBillingAccess />
      </>
    );
  }

  const canTopup = can('billing:pay') && onlineMethods(summary.data).length > 0;
  const openTopup = canTopup ? () => setTopupOpen(true) : undefined;
  const tabs: { key: Tab; label: string; icon: ReactNode; badge?: ReactNode }[] = [
    {
      key: 'invoices',
      label: t('billing.tab.invoices'),
      icon: <FileText />,
      badge: summary.data && (
        <TabCount n={summary.data.openCount} tone={summary.data.overdueTotal > 0 ? 'danger' : 'neutral'} />
      ),
    },
    { key: 'credit', label: t('billing.tab.credit'), icon: <Wallet /> },
    { key: 'services', label: t('billing.tab.services'), icon: <Layers /> },
    { key: 'payments', label: t('billing.tab.payments'), icon: <CreditCard /> },
    { key: 'address', label: t('billing.tab.address'), icon: <MapPin /> },
  ];

  return (
    <>
      <PageHeader
        title={t('nav.billing')}
        description={
          summary.data
            ? t('billing.subtitle', { seller: summary.data.seller.name })
            : t('billing.subtitleShort')
        }
        actions={
          canTopup && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setTopupOpen(true)}>
              {t('billing.topup.action')}
            </Button>
          )
        }
      />
      <PaymentReturnNotice kind="topup" />
      {summary.isPending ? (
        <SummarySkeleton />
      ) : summary.isError ? (
        <div className="mb-6">
          <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
        </div>
      ) : (
        <>
          {summary.data.overdueTotal > 0 && (
            <Notice tone="danger" className="mb-6" title={t('billing.overdueNotice')}>
              {t('billing.overdueNoticeText')}
            </Notice>
          )}
          <SummaryCards
            summary={summary.data}
            balanceAction={openTopup && { label: t('billing.topup.action'), onClick: openTopup }}
          />
        </>
      )}
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'invoices' && <InvoicesTab />}
      {tab === 'credit' && <CreditTab summary={summary.data} onTopup={openTopup} />}
      {tab === 'services' && <ServicesTab />}
      {tab === 'payments' && <PaymentsTab />}
      {tab === 'address' && <AddressTab />}
      {summary.data && canTopup && (
        <TopupDialog open={topupOpen} onOpenChange={setTopupOpen} summary={summary.data} />
      )}
    </>
  );
}

export function InvoicePage() {
  const { t } = useI18n();
  const { base, can } = useOrg();
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const back = <BackLink to={`${base}/billing`}>{t('billing.backToBilling')}</BackLink>;
  if (!can('billing:read') || !invoiceId) {
    return (
      <>
        {back}
        <NoBillingAccess />
      </>
    );
  }
  return (
    <InvoiceView
      invoiceId={invoiceId}
      perspective="customer"
      back={
        <>
          {back}
          <PaymentReturnNotice kind="invoice" />
        </>
      }
    />
  );
}
