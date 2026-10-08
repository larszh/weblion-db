import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Building2,
  CalendarCheck,
  ChevronLeft,
  FilePen,
  FileText,
  PiggyBank,
  Receipt,
  RefreshCw,
  Repeat,
  Search,
  Settings2,
  Tags,
} from 'lucide-react';
import { formatMoney } from '@weblion/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { useApiMutation, useMe } from '@/lib/queries';
import {
  billingKeys,
  useAdminInvoices,
  useBillingStats,
  useInvoice,
  useZohoConfigured,
  type AdminInvoiceParams,
  type InvoiceFilter,
} from '@/lib/api/billing';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Input,
  LoadingBlock,
  Notice,
  PageHeader,
  Select,
} from '@/components/ui/primitives';
import { NoBillingAccess, Pager, StatCard } from './bits';
import { InvoiceView } from './invoice-view';
import { SummarySkeleton } from './summary';
import { InvoiceTable } from './tables';

/** Platform billing overview (/admin/billing) and one invoice in the admin area. */

const STATUS_FILTERS: InvoiceFilter[] = ['', 'draft', 'open', 'overdue', 'paid', 'void'];
const ISSUER_FILTERS = ['all', 'platform', 'reseller'] as const;

/** Filters live in the URL, so the way back from an invoice keeps them. */
function useInvoiceFilters(): [
  Required<Omit<AdminInvoiceParams, 'perPage'>>,
  (patch: Partial<AdminInvoiceParams>) => void,
] {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const issuer = params.get('issuer') ?? 'all';
  const value = {
    status: (STATUS_FILTERS as string[]).includes(status) ? (status as InvoiceFilter) : '',
    issuer: (ISSUER_FILTERS as readonly string[]).includes(issuer) ? (issuer as 'all') : 'all',
    q: params.get('q') ?? '',
    page: Math.max(1, Number(params.get('page')) || 1),
  };
  // Changing a filter goes back to the first page. Defaults are left out of the URL.
  const set = useCallback(
    (patch: Partial<AdminInvoiceParams>) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, v] of Object.entries({ page: 1, ...patch })) {
            const empty =
              v === '' || v === undefined || (key === 'issuer' && v === 'all') || (key === 'page' && v === 1);
            if (empty) next.delete(key);
            else next.set(key, String(v));
          }
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  return [value, set];
}

function Stats() {
  const { t, locale } = useI18n();
  const me = useMe();
  const canWrite = me.data?.platformPermissions.includes('platform:billing:write') ?? false;
  const stats = useBillingStats();
  const zohoConfigured = useZohoConfigured();
  const [, setFilters] = useInvoiceFilters();
  const syncPending = useApiMutation(
    () => api.post<{ synced: number; failed: number }>('/admin/integrations/zoho/sync-pending'),
    {
      success: (r) => t('billing.admin.zohoSynced', { synced: r.synced, failed: r.failed }),
      invalidate: [billingKeys.all, ['admin']],
    },
  );

  if (stats.isPending) return <SummarySkeleton />;
  if (stats.isError) {
    return (
      <div className="mb-6">
        <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
      </div>
    );
  }
  const s = stats.data;
  const money = (v: number) => formatMoney(v, s.currency, locale);
  const overdue = s.overdueTotal > 0;
  return (
    <>
      {s.zohoErrors > 0 && (
        <Notice
          tone="danger"
          className="mb-6"
          icon={<AlertTriangle className="size-4" />}
          title={t('billing.admin.zohoErrors', { n: s.zohoErrors })}
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span>{t('billing.admin.zohoErrorsText')}</span>
            {canWrite && (
              <Button
                size="sm"
                variant="secondary"
                icon={<RefreshCw className="size-4" />}
                loading={syncPending.isPending}
                onClick={() => syncPending.mutate(undefined)}
              >
                {t('billing.admin.zohoRetry')}
              </Button>
            )}
          </div>
        </Notice>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          icon={<Receipt />}
          label={t('billing.summary.open')}
          value={money(s.openTotal)}
          tone="bg-warning-soft text-warning"
          sub={t('billing.summary.openCount', { n: s.openCount })}
        />
        <StatCard
          icon={<AlertTriangle />}
          label={t('billing.admin.overdue')}
          value={money(s.overdueTotal)}
          tone={overdue ? 'bg-danger-soft text-danger' : 'bg-surface-3 text-muted'}
          highlight={overdue}
          sub={t('billing.summary.openCount', { n: s.overdueCount })}
        />
        <StatCard
          icon={<CalendarCheck />}
          label={t('billing.admin.paidThisMonth')}
          value={money(s.paidThisMonth)}
          tone="bg-success-soft text-success"
          sub={t('billing.admin.paidThisMonthHint')}
        />
        <StatCard
          icon={<Repeat />}
          label={t('billing.summary.monthly')}
          value={money(s.monthlyRecurring)}
          tone="bg-info-soft text-primary-text"
          sub={t('billing.summary.monthlyHint')}
        />
      </div>
      <div className="mb-6 flex flex-wrap gap-2 text-sm">
        <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 shadow-card">
          <PiggyBank className="size-4 text-muted" />
          <span className="text-muted">{t('billing.admin.creditOutstanding')}</span>
          <span className="font-medium tabular">{money(s.creditOutstanding)}</span>
        </span>
        <button
          type="button"
          onClick={() => setFilters({ status: 'draft', issuer: 'platform' })}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 shadow-card hover:bg-surface-3"
        >
          <FilePen className="size-4 text-muted" />
          <span className="text-muted">{t('billing.admin.drafts')}</span>
          <span className="font-medium tabular">{s.draftCount}</span>
        </button>
        {(zohoConfigured !== false || s.zohoErrors > 0) && (
          <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 shadow-card">
            <RefreshCw className="size-4 text-muted" />
            <span className="text-muted">{t('billing.admin.zohoErrorCount')}</span>
            <span className={cn('font-medium tabular', s.zohoErrors > 0 && 'text-danger')}>
              {s.zohoErrors}
            </span>
          </span>
        )}
      </div>
    </>
  );
}

function InvoiceList() {
  const { t } = useI18n();
  const [filters, setFilters] = useInvoiceFilters();
  const [search, setSearch] = useState(filters.q);
  useEffect(() => setSearch(filters.q), [filters.q]);
  // Search after a short pause in typing.
  useEffect(() => {
    if (search.trim() === filters.q) return;
    const timer = setTimeout(() => setFilters({ q: search.trim() }), 300);
    return () => clearTimeout(timer);
  }, [search, filters.q, setFilters]);
  const invoices = useAdminInvoices({
    status: filters.status,
    issuer: filters.issuer,
    q: filters.q || undefined,
    page: filters.page,
  });
  const filtered = !!(filters.status || filters.q || filters.issuer !== 'all');
  const zohoConfigured = useZohoConfigured();

  return (
    <Card>
      <CardHeader
        title={t('billing.admin.invoices')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('billing.admin.search')}
                aria-label={t('billing.admin.search')}
                className="h-8 w-full pl-8 text-[13px] sm:w-56"
                maxLength={100}
              />
            </div>
            <Select
              value={filters.status}
              onChange={(e) => setFilters({ status: e.target.value as InvoiceFilter })}
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
            <Select
              value={filters.issuer}
              onChange={(e) => setFilters({ issuer: e.target.value as AdminInvoiceParams['issuer'] })}
              className="h-8 w-auto text-[13px]"
              aria-label={t('billing.filter.issuer')}
            >
              <option value="all">{t('billing.filter.issuerAll')}</option>
              <option value="platform">{t('billing.filter.issuerPlatform')}</option>
              <option value="reseller">{t('billing.filter.issuerReseller')}</option>
            </Select>
          </div>
        }
      />
      {invoices.isPending ? (
        <LoadingBlock rows={5} />
      ) : invoices.isError ? (
        <div className="p-5">
          <ErrorState error={invoices.error} onRetry={() => void invoices.refetch()} />
        </div>
      ) : invoices.data.items.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-6" />}
          title={filtered ? t('billing.invoices.noneFiltered') : t('billing.invoices.none')}
          description={filtered ? undefined : t('billing.admin.noneText')}
        />
      ) : (
        <>
          <InvoiceTable
            items={invoices.data.items}
            href={(i) => `/admin/billing/invoices/${i.id}`}
            showCustomer
            showIssuer
            showZoho={zohoConfigured !== false}
          />
          <Pager
            page={invoices.data.page}
            perPage={invoices.data.perPage}
            total={invoices.data.total}
            onChange={(page) => setFilters({ page })}
            label={t('billing.admin.count', { n: invoices.data.total })}
          />
        </>
      )}
    </Card>
  );
}

function usePlatformBillingRead(): boolean | undefined {
  const me = useMe();
  if (!me.data) return undefined;
  const perms = me.data.platformPermissions;
  return perms.includes('platform:billing:read') || perms.includes('platform:billing:write');
}

const linkButton =
  'inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium text-text shadow-card hover:bg-surface-3';

export function AdminBillingPage() {
  const { t } = useI18n();
  const allowed = usePlatformBillingRead();
  if (allowed === false) {
    return (
      <>
        <PageHeader title={t('nav.admin.billing')} />
        <NoBillingAccess />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title={t('nav.admin.billing')}
        description={t('billing.admin.subtitle')}
        actions={
          <>
            <Link to="/admin/products" className={linkButton}>
              <Tags className="size-4" />
              {t('nav.admin.products')}
            </Link>
            <Link to="/admin/settings?tab=billing" className={linkButton}>
              <Settings2 className="size-4" />
              {t('billing.admin.settingsLink')}
            </Link>
          </>
        }
      />
      {allowed && (
        <>
          <Stats />
          <InvoiceList />
        </>
      )}
    </>
  );
}

export function AdminInvoicePage() {
  const { t } = useI18n();
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const allowed = usePlatformBillingRead();
  // Same query as the view below; only used for the link to the customer.
  const invoice = useInvoice(allowed ? invoiceId : undefined);
  const back = (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <Link
        to="/admin/billing"
        className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-text"
      >
        <ChevronLeft className="size-4" />
        {t('billing.admin.back')}
      </Link>
      {invoice.data && (
        <Link
          to={`/admin/customers/${invoice.data.org.id}?tab=billing`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-text hover:underline"
        >
          <Building2 className="size-4" />
          {t('billing.admin.openCustomer', { name: invoice.data.org.name })}
        </Link>
      )}
    </div>
  );
  if (allowed === false || !invoiceId) {
    return (
      <>
        {back}
        <NoBillingAccess />
      </>
    );
  }
  if (allowed === undefined) return <LoadingBlock rows={6} />;
  return <InvoiceView invoiceId={invoiceId} perspective="seller" back={back} />;
}
