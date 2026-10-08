import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronLeft, Globe, Layers, Loader2, Lock, Server, X, XCircle } from 'lucide-react';
import {
  MODULE_DEFS,
  formatMoney,
  type BillingInterval,
  type CreditType,
  type InvoiceDto,
  type ModuleKey,
  type PaymentMethod,
  type PaymentStatus,
  type ServiceDto,
  type ServiceResourceType,
  type ServiceStatus,
  type ZohoSyncStatus,
} from '@weblion/shared';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { useOptionalOrg } from '@/lib/org-context';
import { useMe } from '@/lib/queries';
import { billingKeys, usePayment } from '@/lib/api/billing';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, Notice } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/menu';

/** Small pieces shared by the billing pages (customer, seller, admin). */

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

export function InvoiceStatusBadge({
  invoice,
}: {
  invoice: Pick<InvoiceDto, 'status' | 'overdue' | 'amountPaid'>;
}) {
  const { t } = useI18n();
  if (invoice.status === 'open' && invoice.overdue)
    return <Badge tone="danger">{t('billing.status.overdue')}</Badge>;
  if (invoice.status === 'open' && invoice.amountPaid > 0)
    return <Badge tone="warning">{t('billing.status.partial')}</Badge>;
  const tone: Record<InvoiceDto['status'], Tone> = {
    draft: 'neutral',
    open: 'info',
    paid: 'success',
    void: 'neutral',
  };
  return (
    <Badge tone={tone[invoice.status]} className={invoice.status === 'void' ? 'line-through' : undefined}>
      {t(`billing.status.${invoice.status}`)}
    </Badge>
  );
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const { t } = useI18n();
  const tone: Record<PaymentStatus, Tone> = {
    pending: 'warning',
    succeeded: 'success',
    failed: 'danger',
    cancelled: 'neutral',
    refunded: 'neutral',
  };
  return <Badge tone={tone[status]}>{t(`billing.payStatus.${status}`)}</Badge>;
}

export function ServiceStatusBadge({ status }: { status: ServiceStatus }) {
  const { t } = useI18n();
  const tone: Record<ServiceStatus, Tone> = { active: 'success', suspended: 'warning', cancelled: 'neutral' };
  return <Badge tone={tone[status]}>{t(`billing.serviceStatus.${status}`)}</Badge>;
}

/** Zoho Books sync state of a platform invoice. The error text is shown as tooltip. */
export function ZohoBadge({ zoho }: { zoho: InvoiceDto['zoho'] }) {
  const { t } = useI18n();
  if (!zoho) return null;
  const status: ZohoSyncStatus | 'none' = zoho.status ?? 'none';
  const tone: Record<ZohoSyncStatus | 'none', Tone> = {
    none: 'neutral',
    pending: 'warning',
    synced: 'success',
    error: 'danger',
    skipped: 'neutral',
  };
  const badge = <Badge tone={tone[status]}>{t(`billing.zoho.${status}`)}</Badge>;
  return zoho.error ? <Tooltip content={zoho.error}>{badge}</Tooltip> : badge;
}

export function useBillingLabels() {
  const { t, locale } = useI18n();
  return {
    interval: (i: BillingInterval) => t(`billing.interval.${i}`),
    method: (m: PaymentMethod) => t(`billing.method.${m}`),
    creditType: (c: CreditType) => t(`billing.creditType.${c}`),
    module: (m: ModuleKey | null) => (m ? MODULE_DEFS[m].label[locale] : t('billing.module.none')),
  };
}

/** Price with its interval, e.g. "CHF 19.00 / Monat". */
export function PriceText({
  amount,
  currency,
  interval,
}: {
  amount: number;
  currency: string;
  interval: BillingInterval;
}) {
  const { t, locale } = useI18n();
  return (
    <span className="whitespace-nowrap tabular">
      {formatMoney(amount, currency, locale)}
      {interval !== 'once' && <span className="text-muted"> / {t(`billing.per.${interval}`)}</span>}
    </span>
  );
}

/**
 * Tabs in the style of the server detail page. `pills` is the quieter variant for tabs
 * inside a tab, e.g. the seller panel embedded in a customer detail page.
 */
export function Tabs<K extends string>({
  tabs,
  value,
  onChange,
  className,
  variant = 'underline',
}: {
  tabs: { key: K; label: ReactNode; badge?: ReactNode; icon?: ReactNode }[];
  value: K;
  onChange: (key: K) => void;
  className?: string;
  variant?: 'underline' | 'pills';
}) {
  const { t } = useI18n();
  if (variant === 'pills') {
    return (
      <div className={cn('mb-4 overflow-x-auto', className)}>
        <div
          className="inline-flex min-w-max gap-1 rounded-lg border border-border bg-surface-2 p-1"
          role="tablist"
          aria-label={t('billing.tabs')}
        >
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={tab.key === value}
              onClick={() => onChange(tab.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors [&>svg]:size-4',
                tab.key === value
                  ? 'bg-surface text-text shadow-card'
                  : 'text-muted hover:bg-surface-3 hover:text-text',
              )}
            >
              {tab.icon}
              {tab.label}
              {tab.badge}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className={cn('mb-6 overflow-x-auto border-b border-border', className)}>
      <div className="-mb-px flex min-w-max gap-1" role="tablist" aria-label={t('billing.tabs')}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={tab.key === value}
            onClick={() => onChange(tab.key)}
            className={cn(
              'inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors [&>svg]:size-4',
              tab.key === value
                ? 'border-brand-blue text-primary-text'
                : 'border-transparent text-muted hover:border-border-strong hover:text-text',
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.badge}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Small count next to a tab label. */
export function TabCount({ n, tone = 'neutral' }: { n: number; tone?: 'neutral' | 'danger' }) {
  if (n <= 0) return null;
  return (
    <span
      className={cn(
        'rounded-full px-1.5 text-[11px] leading-[18px] font-semibold tabular',
        tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-surface-3 text-muted',
      )}
    >
      {n}
    </span>
  );
}

/**
 * Tab selection in a query parameter (?tab= by default), so a reload or a shared link keeps
 * it. Embedded panels use their own parameter so they don't fight with the page's tabs.
 */
export function useTabParam<K extends string>(
  keys: readonly K[],
  fallback: K,
  param = 'tab',
): [K, (key: K) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get(param);
  const value = keys.includes(raw as K) ? (raw as K) : fallback;
  const set = (key: K) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (key === fallback) next.delete(param);
        else next.set(param, key);
        return next;
      },
      { replace: true },
    );
  };
  return [value, set];
}

export function StatCard({
  icon,
  label,
  value,
  sub,
  tone = 'bg-primary-soft text-primary-text',
  highlight,
}: {
  icon: ReactNode;
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: string;
  /** Draws attention, e.g. to an overdue amount. */
  highlight?: boolean;
}) {
  return (
    <Card className={cn('flex items-start gap-4 px-4 py-3 sm:px-5 sm:py-4', highlight && 'border-danger/40')}>
      <div
        className={cn(
          'hidden size-10 shrink-0 items-center justify-center rounded-lg sm:flex [&>svg]:size-5',
          tone,
        )}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-sm text-muted sm:truncate">{label}</div>
        <div
          className={cn('text-lg font-semibold tabular sm:text-xl', highlight ? 'text-danger' : 'text-text')}
        >
          {value}
        </div>
        {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
      </div>
    </Card>
  );
}

export function Pager({
  page,
  perPage,
  total,
  onChange,
  label,
}: {
  page: number;
  perPage: number;
  total: number;
  onChange: (page: number) => void;
  label?: ReactNode;
}) {
  const { t } = useI18n();
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (total <= perPage && !label) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm">
      <span className="text-muted">
        {label}
        {label && pages > 1 && ' · '}
        {pages > 1 && t('common.pageOf', { page, total: pages })}
      </span>
      {pages > 1 && (
        <div className="flex gap-2">
          <Button size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
            {t('common.prev')}
          </Button>
          <Button size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>
            {t('common.next')}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Amount with sign and color, for credit movements. */
export function SignedAmount({ amount, currency }: { amount: number; currency: string }) {
  const { locale } = useI18n();
  return (
    <span className={cn('whitespace-nowrap tabular', amount < 0 ? 'text-danger' : 'text-success')}>
      {amount > 0 ? '+' : ''}
      {formatMoney(amount, currency, locale)}
    </span>
  );
}

/**
 * Result of a Stripe Checkout, read from ?payment=success|cancel&pid=<paymentId> after the
 * redirect back. A success is confirmed by polling the payment (the API asks Stripe as
 * well) for up to 30 s. A cancel needs no polling: nothing was charged.
 */
export function PaymentReturnNotice({ kind }: { kind: 'invoice' | 'topup' }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const outcome = params.get('payment');
  const pid = params.get('pid');
  const [timedOut, setTimedOut] = useState(false);
  const polling = outcome === 'success' && !!pid && !timedOut;
  const payment = usePayment(outcome === 'success' ? pid : null, polling);
  const status = payment.data?.status;

  useEffect(() => {
    if (outcome !== 'success' || !pid) return;
    setTimedOut(false);
    const timer = setTimeout(() => setTimedOut(true), 30_000);
    return () => clearTimeout(timer);
  }, [outcome, pid]);

  useEffect(() => {
    if (status && status !== 'pending') void qc.invalidateQueries({ queryKey: billingKeys.all });
  }, [status, qc]);

  if (outcome !== 'success' && outcome !== 'cancel') return null;

  const dismiss = () =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('payment');
        next.delete('pid');
        return next;
      },
      { replace: true },
    );
  const wrap = (
    tone: 'info' | 'success' | 'warning' | 'danger',
    icon: ReactNode,
    title: string,
    text?: ReactNode,
  ) => (
    <div className="relative mb-6" role="status">
      <Notice tone={tone} icon={icon} title={title} className="pr-11">
        {text}
      </Notice>
      <button
        type="button"
        onClick={dismiss}
        className="absolute top-2.5 right-2.5 rounded p-1 text-muted hover:bg-surface-3 hover:text-text"
        aria-label={t('common.close')}
      >
        <X className="size-4" />
      </button>
    </div>
  );

  if (outcome === 'cancel') {
    return wrap(
      'warning',
      <XCircle className="size-4" />,
      t('billing.return.cancelled'),
      t('billing.return.cancelledText'),
    );
  }
  if (payment.isError) {
    return wrap(
      'danger',
      <XCircle className="size-4" />,
      t('billing.return.unknown'),
      errorMessage(payment.error),
    );
  }
  if (!payment.data || status === 'pending') {
    return timedOut
      ? wrap('info', <Loader2 className="size-4" />, t('billing.return.slow'), t('billing.return.slowText'))
      : wrap(
          'info',
          <Loader2 className="size-4 animate-spin" />,
          t('billing.return.checking'),
          t('billing.return.checkingText'),
        );
  }
  const amount = formatMoney(payment.data.amount, payment.data.currency, locale);
  if (status === 'succeeded') {
    return wrap(
      'success',
      <CheckCircle2 className="size-4" />,
      kind === 'topup' ? t('billing.return.toppedUp', { amount }) : t('billing.return.paid', { amount }),
      t('billing.return.thanks'),
    );
  }
  if (status === 'failed') {
    return wrap(
      'danger',
      <XCircle className="size-4" />,
      t('billing.return.failed'),
      payment.data.error ?? t('billing.return.failedText'),
    );
  }
  return wrap(
    'warning',
    <XCircle className="size-4" />,
    t('billing.return.cancelled'),
    t('billing.return.cancelledText'),
  );
}

const resourceIcon: Record<ServiceResourceType, ReactNode> = {
  server: <Server className="size-3.5" />,
  domain: <Globe className="size-3.5" />,
  webspace: <Layers className="size-3.5" />,
};

const resourcePath: Record<ServiceResourceType, string> = {
  server: 'servers',
  domain: 'domains',
  webspace: 'webhosting',
};

/**
 * The resource a service is linked to. With `base` (/o/<slug>) it links to the resource
 * page, as long as the module is active for the organization; otherwise plain text.
 */
export function ServiceResource({
  resource,
  base,
  linkable = true,
}: {
  resource: ServiceDto['resource'];
  base?: string;
  linkable?: boolean;
}) {
  const { t } = useI18n();
  if (!resource) return <span className="text-subtle">–</span>;
  const label = (
    <>
      <span className="shrink-0 text-subtle">{resourceIcon[resource.type]}</span>
      <span className="truncate">{resource.name ?? t('billing.resource.gone')}</span>
    </>
  );
  if (base && linkable && resource.name) {
    return (
      <Link
        to={`${base}/${resourcePath[resource.type]}/${resource.id}`}
        className="inline-flex max-w-[220px] items-center gap-1.5 text-primary-text hover:underline"
      >
        {label}
      </Link>
    );
  }
  return <span className="inline-flex max-w-[220px] items-center gap-1.5 text-text">{label}</span>;
}

/**
 * Whether the current user may change the billing of customers of `sellerOrgId` (null =
 * the platform). Mirrors canActAsSeller in the API: platform:billing:write for platform
 * customers, reseller:billing on the reseller for its customers (superadmins pass both).
 * Only used to hide buttons; the API decides.
 */
export function useSellerWrite(sellerOrgId: string | null | undefined): boolean {
  const me = useMe();
  const orgCtx = useOptionalOrg();
  if (sellerOrgId === undefined || !me.data) return false;
  const platform = me.data.platformPermissions;
  if (sellerOrgId === null) return platform.includes('platform:billing:write');
  if (me.data.user.platformRole === 'superadmin') return true;
  return orgCtx?.org.id === sellerOrgId && orgCtx.can('reseller:billing');
}

export function NoBillingAccess({ title, text }: { title?: ReactNode; text?: ReactNode }) {
  const { t } = useI18n();
  return (
    <Card>
      <EmptyState
        icon={<Lock className="size-6" />}
        title={title ?? t('billing.noAccess')}
        description={text ?? t('billing.noAccessText')}
      />
    </Card>
  );
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-text"
    >
      <ChevronLeft className="size-4" />
      {children}
    </Link>
  );
}
