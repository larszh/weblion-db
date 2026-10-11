import { Link } from 'react-router-dom';
import { ArrowRight, Mail } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { useOrgMailDomains } from '@/lib/api/mail';
import { Card, CardBody, CardHeader, ErrorState, LoadingBlock } from '@/components/ui/primitives';
import { MailDomainStatusBadge, countOf } from './bits';

/** How many mail domains the card lists before "show all". */
const PREVIEW_ROWS = 5;

/**
 * Mail card of the organization dashboard: mail domains, mailboxes used of what the domains
 * allow together, and a link to the mail page. Rendered by pages/org/dashboard.tsx when the
 * "mail" module is active and the user has mail:read.
 */
export function MailCard() {
  const { t, locale } = useI18n();
  const { org, base } = useOrg();
  const domains = useOrgMailDomains(org.id);
  const list = domains.data ?? [];
  const used = list.reduce((sum, d) => sum + (d.usage?.mailboxes ?? 0), 0);
  const max = list.reduce((sum, d) => sum + (d.limits?.maxMailboxes ?? 0), 0);

  return (
    <Card>
      <CardHeader
        title={t('nav.mail')}
        description={
          list.length > 0
            ? t(list.length === 1 ? 'dashboard.mail.summaryOne' : 'dashboard.mail.summary', {
                domains: list.length,
                mailboxes: countOf(t, locale, used, max),
              })
            : undefined
        }
        actions={
          <Link
            to={`${base}/mail`}
            className="inline-flex items-center gap-1 text-sm font-medium text-primary-text hover:underline"
          >
            {t('common.showAll')} <ArrowRight className="size-3.5" />
          </Link>
        }
      />
      {domains.isPending ? (
        <LoadingBlock rows={2} />
      ) : domains.isError ? (
        <div className="p-5">
          <ErrorState error={domains.error} onRetry={() => void domains.refetch()} />
        </div>
      ) : list.length === 0 ? (
        <CardBody className="text-sm text-muted">{t('dashboard.mail.none')}</CardBody>
      ) : (
        <ul className="divide-y divide-border">
          {list.slice(0, PREVIEW_ROWS).map((d) => (
            <li key={d.id}>
              <Link
                to={`${base}/mail/${d.id}`}
                className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2"
              >
                <Mail className="size-4 shrink-0 text-subtle" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{d.name}</span>
                {d.limits && d.usage && (
                  <span className="hidden text-sm whitespace-nowrap text-muted tabular sm:inline">
                    {t('dashboard.mail.mailboxes', {
                      count: countOf(t, locale, d.usage.mailboxes, d.limits.maxMailboxes),
                    })}
                  </span>
                )}
                <MailDomainStatusBadge domain={d} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
