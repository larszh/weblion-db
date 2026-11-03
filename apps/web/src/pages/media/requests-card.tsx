import { ExternalLink, Info } from 'lucide-react';
import type { MediaAccountDto, MediaRequestsInfoDto } from '@weblion/shared';
import { formatNumber, formatRelative } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { Card, CardBody, CardHeader, CopyButton, Mono } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/menu';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { PanelLink, safePanelUrl } from '@/pages/hosting/bits';
import { REQUEST_TYPES, requestQuotaUsage, requestTypeText } from './bits';

/**
 * The requests add-on (Seerr) on the customer page: where the accounts sign in, what the
 * allowance includes, and per account the numbers the sync read (open, approved, available,
 * quota used). Only rendered while the organization has the add-on on an instance whose Seerr
 * is active (the API leaves `requests` out otherwise). Never titles: the console has none.
 */
export function MediaRequestsCard({
  requests,
  accounts,
}: {
  requests: MediaRequestsInfoDto;
  accounts: MediaAccountDto[];
}) {
  const { t, locale } = useI18n();
  const url = safePanelUrl(requests.url);
  // Accounts the API marks for requests (gone ones have no view and are left out).
  const rows = accounts.flatMap((account) => (account.requests ? [{ account, view: account.requests }] : []));
  const n = (value: number | undefined) => (value === undefined ? '–' : formatNumber(value, locale));
  return (
    <Card>
      <CardHeader
        title={t('media.requests.title')}
        description={t('media.requests.text')}
        actions={
          url && (
            <PanelLink href={url} variant="secondary" size="sm">
              {t('media.requests.open')}
            </PanelLink>
          )
        }
      />
      <CardBody className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="min-w-0">
            <p className="text-xs text-muted">{t('media.requests.address')}</p>
            {url ? (
              <div className="mt-1 flex min-w-0 items-center gap-1 rounded-lg border border-border bg-surface-2 px-3 py-2">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-w-0 flex-1 items-center gap-1 text-sm text-primary-text hover:underline"
                >
                  <Mono className="truncate">{url}</Mono>
                  <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                </a>
                <CopyButton value={url} label={t('media.requests.copyAddress')} />
              </div>
            ) : (
              <p className="mt-1 text-sm text-subtle">–</p>
            )}
            <p className="mt-1.5 text-sm text-text">{t('media.requests.signIn')}</p>
            <p className="mt-1 text-xs text-muted">{t('media.requests.devicesHint')}</p>
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted">{t('media.requests.included')}</p>
            <dl className="mt-1 space-y-1 text-sm">
              {REQUEST_TYPES.map((type) => (
                <div key={type} className="flex flex-wrap gap-x-2">
                  <dt className="font-medium text-text">
                    {t(type === 'movies' ? 'media.requests.movies' : 'media.requests.tv')}:
                  </dt>
                  <dd className={requests.access[type] ? 'text-text' : 'text-subtle'}>
                    {requestTypeText(t, type, requests.access)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </CardBody>
      {rows.length > 0 && (
        <Table>
          <THead>
            <tr>
              <TH>{t('media.col.login')}</TH>
              <TH className="hidden text-right sm:table-cell">{t('media.requests.col.pending')}</TH>
              <TH className="hidden text-right sm:table-cell">{t('media.requests.col.approved')}</TH>
              <TH className="hidden text-right sm:table-cell">{t('media.requests.col.available')}</TH>
              <TH className="hidden sm:table-cell">{t('media.requests.col.quota')}</TH>
            </tr>
          </THead>
          <TBody>
            {rows.map(({ account: a, view }) => {
              const counts = view.counts;
              const quota = requestQuotaUsage(t, requests.access, counts);
              const quotaCell = quota.length > 0 ? quota : [t('media.requests.unlimited')];
              // A disabled account has no request rights: its quota means nothing.
              const showQuota = view.ready && a.enabled;
              return (
                <TR key={a.id}>
                  <TD className="max-w-[260px]">
                    <Mono className="block truncate font-medium text-text">{a.username}</Mono>
                    {!view.ready && (
                      <Tooltip content={t('media.requests.notReadyHint')}>
                        <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted">
                          <Info className="size-3.5" aria-hidden /> {t('media.requests.notReady')}
                        </span>
                      </Tooltip>
                    )}
                    {!a.enabled && (
                      <p className="mt-0.5 text-xs text-muted">{t('media.requests.disabled')}</p>
                    )}
                    {/* Numbers and quota move below the login name on narrow screens. */}
                    {counts && (
                      <div className="mt-0.5 text-xs text-text sm:hidden">
                        {t('media.requests.totals', {
                          pending: n(counts.pending),
                          approved: n(counts.approved),
                          available: n(counts.available),
                        })}
                      </div>
                    )}
                    {showQuota && (
                      <div className="mt-0.5 text-xs text-muted sm:hidden">{quotaCell.join(' · ')}</div>
                    )}
                  </TD>
                  <TD className="hidden text-right text-sm tabular sm:table-cell">{n(counts?.pending)}</TD>
                  <TD className="hidden text-right text-sm tabular sm:table-cell">{n(counts?.approved)}</TD>
                  <TD className="hidden text-right text-sm tabular sm:table-cell">{n(counts?.available)}</TD>
                  <TD className="hidden text-sm sm:table-cell">
                    {showQuota ? (
                      quotaCell.map((line) => (
                        <span key={line} className="block whitespace-nowrap">
                          {line}
                        </span>
                      ))
                    ) : (
                      <span className="text-subtle">–</span>
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
      <div className="space-y-1 border-t border-border px-5 py-3 text-xs text-muted">
        {requests.syncedAt && (
          <p>{t('media.requests.syncedAt', { when: formatRelative(requests.syncedAt, locale) })}</p>
        )}
        <p>{t('media.requests.privacy')}</p>
      </div>
    </Card>
  );
}
