import { Link } from 'react-router-dom';
import { ChevronRight, History } from 'lucide-react';
import type { EndedEarlyServiceDto } from '@weblion/shared';
import { useI18n } from '@/lib/i18n';
import { useEndedEarlyServices } from '@/lib/api/billing';
import { Card, CardHeader } from '@/components/ui/primitives';
import { formatDay } from './money';

/**
 * "Früher gekündigte Dienste prüfen": services a cancellation to a later date ended at once (until the fix of
 * November 2026) and that were not billed since. On the staff billing overview (the platform's customers) and on
 * a reseller's customer list (its own customers); each row leads to the customer's services, where the seller
 * restores the cancellation. Shown only while there is one, a failed load hides it like an empty list.
 */
export function EndedEarlyCard({
  resellerOrgId,
  customerHref,
  className,
}: {
  /** null: the platform's customers (staff), else the customers of this reseller. */
  resellerOrgId: string | null;
  /** The services tab of the customer's billing. */
  customerHref: (customerId: string) => string;
  className?: string;
}) {
  const list = useEndedEarlyServices(resellerOrgId);
  if (!list.data || list.data.length === 0) return null;
  return <EndedEarlyList items={list.data} customerHref={customerHref} className={className} />;
}

/** The card itself, apart for tests. */
export function EndedEarlyList({
  items,
  customerHref,
  className,
}: {
  items: EndedEarlyServiceDto[];
  customerHref: (customerId: string) => string;
  className?: string;
}) {
  const { t, locale } = useI18n();
  return (
    <Card className={className}>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <History className="size-4 shrink-0 text-warning" />
            {t('billing.endedEarly.title')}
          </span>
        }
        description={t('billing.endedEarly.text')}
      />
      <ul className="divide-y divide-border">
        {items.map((s) => (
          <li key={s.serviceId}>
            <Link
              to={customerHref(s.customer.id)}
              className="flex min-h-11 items-center gap-3 px-5 py-3 hover:bg-surface-3"
            >
              <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                <span className="min-w-0">
                  <span className="block font-medium text-text [overflow-wrap:anywhere]">
                    {s.customer.name}
                  </span>
                  <span className="block text-sm text-muted [overflow-wrap:anywhere]">{s.name}</span>
                </span>
                <span className="text-sm whitespace-nowrap text-warning">
                  {t('billing.service.cancelledPer', { date: formatDay(s.endsAt, locale) })}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-subtle" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
