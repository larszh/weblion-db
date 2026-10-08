import type { ReactNode } from 'react';
import { Layers, Receipt, Repeat, Wallet } from 'lucide-react';
import { formatMoney, type BillingSummaryDto } from '@weblion/shared';
import { useI18n } from '@/lib/i18n';
import { Skeleton } from '@/components/ui/primitives';
import { StatCard } from './bits';

/** The four numbers on top of the customer view and the seller panel. */
export function SummaryCards({
  summary,
  balanceAction,
}: {
  summary: BillingSummaryDto;
  /** Shown below the balance, e.g. "Guthaben aufladen". */
  balanceAction?: { label: ReactNode; onClick: () => void };
}) {
  const { t, locale } = useI18n();
  const money = (v: number) => formatMoney(v, summary.currency, locale);
  const overdue = summary.overdueTotal > 0;
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <StatCard
        icon={<Wallet />}
        label={t('billing.summary.balance')}
        value={money(summary.balance)}
        sub={
          balanceAction ? (
            <button
              type="button"
              onClick={balanceAction.onClick}
              className="font-medium text-primary-text hover:underline"
            >
              {balanceAction.label}
            </button>
          ) : (
            t('billing.summary.balanceHint')
          )
        }
      />
      <StatCard
        icon={<Receipt />}
        label={t('billing.summary.open')}
        value={money(summary.openTotal)}
        tone={overdue ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'}
        highlight={overdue}
        sub={
          overdue
            ? t('billing.summary.overdue', { amount: money(summary.overdueTotal) })
            : t('billing.summary.openCount', { n: summary.openCount })
        }
      />
      <StatCard
        icon={<Repeat />}
        label={t('billing.summary.monthly')}
        value={money(summary.monthlyRecurring)}
        tone="bg-info-soft text-primary-text"
        sub={t('billing.summary.monthlyHint')}
      />
      <StatCard
        icon={<Layers />}
        label={t('billing.summary.services')}
        value={summary.activeServices}
        tone="bg-success-soft text-success"
        sub={t('billing.summary.seller', { name: summary.seller.name })}
      />
    </div>
  );
}

export function SummarySkeleton() {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-[84px] rounded-xl" />
      ))}
    </div>
  );
}
