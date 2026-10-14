import { Link } from 'react-router-dom';
import { ArrowRight, Phone } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { useOrgPhoneSystems } from '@/lib/api/phone';
import { Card, CardBody, CardHeader, ErrorState, LoadingBlock } from '@/components/ui/primitives';
import { PhoneStatusBadge, ofMax } from './bits';

/** How many phone systems the card lists before "show all". */
const PREVIEW_ROWS = 5;

/**
 * Telephony card of the organization dashboard: phone systems with status, calls in progress of
 * what the license allows and users, and a link to the phone page. Rendered by
 * pages/org/dashboard.tsx when the "phone" module is active and the user has phone:read.
 */
export function PhoneCard() {
  const { t, locale } = useI18n();
  const { org, base } = useOrg();
  const systems = useOrgPhoneSystems(org.id);
  const list = systems.data ?? [];

  return (
    <Card>
      <CardHeader
        title={t('nav.phone')}
        description={
          list.length > 0
            ? list.length === 1
              ? t('phone.dashboard.summaryOne')
              : t('phone.dashboard.summary', { n: list.length })
            : undefined
        }
        actions={
          <Link
            to={`${base}/phone`}
            className="inline-flex items-center gap-1 text-sm font-medium text-primary-text hover:underline"
          >
            {t('common.showAll')} <ArrowRight className="size-3.5" />
          </Link>
        }
      />
      {systems.isPending ? (
        <LoadingBlock rows={2} />
      ) : systems.isError ? (
        <div className="p-5">
          <ErrorState error={systems.error} onRetry={() => void systems.refetch()} />
        </div>
      ) : list.length === 0 ? (
        <CardBody className="text-sm text-muted">{t('phone.dashboard.empty')}</CardBody>
      ) : (
        <ul className="divide-y divide-border">
          {list.slice(0, PREVIEW_ROWS).map((s) => (
            <li key={s.id}>
              <Link
                to={`${base}/phone/${s.id}`}
                className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2"
              >
                <Phone className="size-4 shrink-0 text-subtle" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{s.name}</span>
                {s.info && (
                  <span className="hidden text-sm whitespace-nowrap text-muted tabular sm:inline">
                    {t('phone.dashboard.calls', {
                      value: ofMax(s.info.activeCalls, s.info.maxSimCalls, locale),
                    })}
                    {' · '}
                    {t('phone.dashboard.users', { value: ofMax(s.info.users, s.info.maxUsers, locale) })}
                  </span>
                )}
                <PhoneStatusBadge status={s.status} missing={s.missingSince} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
