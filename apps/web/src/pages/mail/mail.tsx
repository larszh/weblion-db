import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Search } from 'lucide-react';
import { formatRelative } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { useOrgMailDomains } from '@/lib/api/mail';
import {
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingBlock,
  Notice,
  PageHeader,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ModuleOffState } from '@/pages/hosting/bits';
import { MailDomainName, MailDomainStatusBadge, MailServer, StorageUsage, countOf } from './bits';

/** Mail domains of an organization (/o/:slug/mail): limits, usage and status per domain. */
export function MailDomainsPage() {
  const { t, locale } = useI18n();
  const { org, base, can, hasModule } = useOrg();
  const navigate = useNavigate();
  const moduleOn = hasModule('mail');
  const canRead = can('mail:read');
  const domains = useOrgMailDomains(org.id, canRead);
  const [q, setQ] = useState('');

  const all = domains.data ?? [];
  // The search only shows for longer lists. Below that, a leftover search must not hide domains.
  const searchable = all.length > 8;
  const needle = searchable ? q.trim().toLowerCase() : '';
  const list = all.filter(
    (d) => !needle || d.name.toLowerCase().includes(needle) || d.asciiName.includes(needle),
  );
  const lastSync = all
    .map((d) => d.lastSyncedAt)
    .filter((v): v is string => !!v)
    .sort()
    .at(-1);

  let body;
  if (!canRead || (!moduleOn && domains.isError)) {
    body = (
      <Card>{moduleOn ? <EmptyState title={t('mail.noAccess')} /> : <ModuleOffState module="mail" />}</Card>
    );
  } else if (domains.isPending) {
    body = <LoadingBlock rows={4} />;
  } else if (domains.isError) {
    body = <ErrorState error={domains.error} onRetry={() => void domains.refetch()} />;
  } else if (all.length === 0) {
    body = (
      <Card>
        {moduleOn ? (
          <EmptyState
            icon={<Mail className="size-6" />}
            title={t('mail.none.title')}
            description={
              org.parent ? t('mail.none.textReseller', { reseller: org.parent.name }) : t('mail.none.text')
            }
          />
        ) : (
          <ModuleOffState module="mail" />
        )}
      </Card>
    );
  } else {
    body = (
      <>
        {!moduleOn && (
          <Notice tone="warning" className="mb-4">
            {t('hosting.moduleOff.staff')}
          </Notice>
        )}
        <Card>
          {searchable && (
            <div className="border-b border-border px-4 py-3">
              <div className="relative max-w-sm">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t('mail.search')}
                  className="pl-9"
                  aria-label={t('mail.search')}
                />
              </div>
            </div>
          )}
          {list.length === 0 ? (
            <EmptyState icon={<Search className="size-6" />} title={t('hosting.noMatch')} />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>{t('mail.col.domain')}</TH>
                  <TH className="hidden sm:table-cell">{t('mail.col.mailboxes')}</TH>
                  <TH className="hidden lg:table-cell">{t('mail.col.aliases')}</TH>
                  <TH className="hidden md:table-cell">{t('mail.col.storage')}</TH>
                  <TH className="hidden sm:table-cell">{t('mail.col.status')}</TH>
                  <TH className="hidden xl:table-cell">{t('mail.col.server')}</TH>
                </tr>
              </THead>
              <TBody>
                {list.map((d) => {
                  const mailboxes =
                    d.limits && d.usage ? countOf(t, locale, d.usage.mailboxes, d.limits.maxMailboxes) : '–';
                  return (
                    <TR key={d.id} onClick={() => navigate(`${base}/mail/${d.id}`)}>
                      <TD className="max-w-[300px]">
                        <div className="flex items-center gap-3">
                          <Mail className="size-4 shrink-0 text-muted" aria-hidden />
                          <Link
                            to={`${base}/mail/${d.id}`}
                            className="min-w-0 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MailDomainName name={d.name} asciiName={d.asciiName} />
                          </Link>
                        </div>
                        {/* Counts, status and storage move below the name on narrow screens. */}
                        <div className="mt-1.5 space-y-1.5 pl-7 sm:hidden">
                          <div className="text-xs text-muted">
                            {t('mail.col.mailboxes')}: {mailboxes}
                          </div>
                          <MailDomainStatusBadge domain={d} />
                        </div>
                        <div className="mt-1.5 pl-7 md:hidden">
                          <StorageUsage limits={d.limits} usage={d.usage} className="max-w-[240px]" />
                        </div>
                      </TD>
                      <TD className="hidden whitespace-nowrap tabular sm:table-cell">{mailboxes}</TD>
                      <TD className="hidden whitespace-nowrap tabular lg:table-cell">
                        {d.limits && d.usage ? countOf(t, locale, d.usage.aliases, d.limits.maxAliases) : '–'}
                      </TD>
                      <TD className="hidden md:table-cell">
                        <StorageUsage limits={d.limits} usage={d.usage} />
                      </TD>
                      <TD className="hidden sm:table-cell">
                        <MailDomainStatusBadge domain={d} />
                      </TD>
                      <TD className="hidden xl:table-cell">
                        <MailServer location={d.location} title={d.provider.name} />
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </Card>
        {lastSync && (
          <p className="mt-3 text-xs text-muted">
            {t('mail.lastSync', { when: formatRelative(lastSync, locale) })}
          </p>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('nav.mail')} description={t('mail.subtitle')} />
      {body}
    </>
  );
}
