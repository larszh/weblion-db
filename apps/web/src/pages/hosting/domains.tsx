import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Gauge, Globe, LayoutGrid, ListTree, Search } from 'lucide-react';
import type { DomainDetailDto } from '@weblion/shared';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { useDomain, useDomains } from '@/lib/api/hosting';
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
import { Flag, ProviderBadge } from '@/components/server-bits';
import {
  AutoRenewBadge,
  DetailError,
  DomainKindBadge,
  DomainStatusBadge,
  ExpiryText,
  LockBadge,
  ModuleOffState,
  ZoneExpiry,
} from './bits';
import { DomainOverview } from './domain-overview';
import { DomainDns } from './domain-dns';
import { DomainCdn } from './domain-cdn';

// --- List ----------------------------------------------------------------------------

export function DomainsPage() {
  const { t } = useI18n();
  const { org, base, hasModule } = useOrg();
  const navigate = useNavigate();
  const domains = useDomains(org.id);
  const [q, setQ] = useState('');
  const moduleOn = hasModule('dns');
  const needle = q.trim().toLowerCase();
  const list = (domains.data ?? []).filter((d) => !needle || d.name.toLowerCase().includes(needle));

  return (
    <>
      <PageHeader title={t('nav.domains')} description={t('hosting.domains.subtitle')} />
      {!moduleOn && !!domains.data?.length && (
        <Notice tone="warning" className="mb-4">
          {t('hosting.moduleOff.staff')}
        </Notice>
      )}
      <Card>
        {domains.isPending ? (
          <LoadingBlock />
        ) : domains.isError ? (
          <div className="p-5">
            <ErrorState error={domains.error} onRetry={() => void domains.refetch()} />
          </div>
        ) : domains.data.length === 0 ? (
          moduleOn ? (
            <EmptyState
              icon={<Globe className="size-6" />}
              title={t('hosting.domains.empty')}
              description={t('hosting.domains.emptyText')}
            />
          ) : (
            <ModuleOffState module="dns" />
          )
        ) : (
          <>
            {domains.data.length > 5 && (
              <div className="border-b border-border px-4 py-3">
                <div className="relative max-w-sm">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
                  <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={t('hosting.domains.search')}
                    className="pl-9"
                    aria-label={t('hosting.domains.search')}
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
                    <TH>{t('hosting.col.domain')}</TH>
                    <TH>{t('hosting.col.status')}</TH>
                    <TH>{t('hosting.col.expires')}</TH>
                    <TH className="hidden sm:table-cell">{t('hosting.col.autoRenew')}</TH>
                    <TH className="hidden md:table-cell">{t('hosting.col.location')}</TH>
                  </tr>
                </THead>
                <TBody>
                  {list.map((d) => (
                    <TR key={d.id} onClick={() => navigate(`${base}/domains/${d.id}`)}>
                      <TD>
                        <div className="flex items-center gap-3">
                          <Globe className="size-4 shrink-0 text-muted" aria-hidden />
                          <div className="min-w-0">
                            <Link
                              to={`${base}/domains/${d.id}`}
                              className="block truncate font-medium text-text hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {d.name}
                            </Link>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                              <ProviderBadge type={d.provider.type} name={d.provider.name} />
                              {d.kind === 'zone' && <DomainKindBadge kind="zone" />}
                            </div>
                          </div>
                        </div>
                      </TD>
                      <TD>
                        <DomainStatusBadge domain={d} />
                      </TD>
                      <TD className="whitespace-nowrap">
                        {d.kind === 'zone' ? (
                          <ZoneExpiry />
                        ) : (
                          <ExpiryText expiresAt={d.expiresAt} autoRenew={d.autoRenew} />
                        )}
                      </TD>
                      <TD className="hidden sm:table-cell">
                        {d.kind === 'zone' ? (
                          <span className="text-subtle">–</span>
                        ) : (
                          <AutoRenewBadge value={d.autoRenew} />
                        )}
                      </TD>
                      <TD className="hidden md:table-cell">
                        <span className="inline-flex items-center gap-2 text-sm">
                          <Flag country={d.location.country} />
                          <span className="truncate">{d.location.city ?? d.location.label}</span>
                        </span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </>
        )}
      </Card>
    </>
  );
}

// --- Detail --------------------------------------------------------------------------

export function DomainDetailPage() {
  const { t } = useI18n();
  const { domainId } = useParams();
  const { base } = useOrg();
  const domain = useDomain(domainId);

  return (
    <>
      <Link
        to={`${base}/domains`}
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text"
      >
        <ChevronLeft className="size-4" /> {t('nav.domains')}
      </Link>
      {domain.isPending ? (
        <LoadingBlock rows={6} />
      ) : domain.isError || !domain.data ? (
        <DetailError kind="domain" error={domain.error} onRetry={() => void domain.refetch()} />
      ) : (
        <DomainView domain={domain.data} />
      )}
    </>
  );
}

type DomainTab = 'overview' | 'dns' | 'cdn';

function DomainView({ domain }: { domain: DomainDetailDto }) {
  const { t, locale } = useI18n();
  const [params, setParams] = useSearchParams();
  const info = domain.info;
  const terminated = info?.terminated ?? false;
  const autoRenew = info?.autoRenew ?? domain.autoRenew;
  const isZone = domain.kind === 'zone';
  const hasDns = domain.capabilities.includes('dns');
  const hasCdn = domain.capabilities.includes('cdn');
  const tabParam = params.get('tab');
  const tab: DomainTab =
    hasDns && tabParam === 'dns' ? 'dns' : hasCdn && tabParam === 'cdn' ? 'cdn' : 'overview';
  const tabs: { value: DomainTab; label: string; icon: ReactNode }[] = [
    { value: 'overview', label: t('hosting.tab.overview'), icon: <LayoutGrid className="size-4" /> },
    ...(hasDns
      ? [{ value: 'dns' as const, label: t('hosting.tab.dns'), icon: <ListTree className="size-4" /> }]
      : []),
    ...(hasCdn
      ? [{ value: 'cdn' as const, label: t('hosting.cdn.tab'), icon: <Gauge className="size-4" /> }]
      : []),
  ];

  const select = (value: DomainTab) => {
    const next = new URLSearchParams(params);
    if (value === 'overview') next.delete('tab');
    else next.set('tab', value);
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <Globe className="size-5 text-muted" aria-hidden />
            <h1 className="font-display truncate text-2xl font-semibold tracking-tight text-text">
              {domain.name}
            </h1>
            <DomainStatusBadge domain={domain} terminated={terminated} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted">
            {isZone ? (
              // A zone has no expiry, renewal or transfer lock: those belong to the registration.
              <span>{t('hosting.zone.hostedAt', { provider: domain.provider.name })}</span>
            ) : (
              <>
                <span className="inline-flex items-center gap-1.5">
                  {t('hosting.col.expires')}:
                  <ExpiryText
                    expiresAt={info?.expiresAt ?? domain.expiresAt}
                    autoRenew={autoRenew}
                    className="text-text"
                  />
                </span>
                <AutoRenewBadge value={autoRenew} long />
                <LockBadge locked={info?.locked} long />
              </>
            )}
            <span className="inline-flex items-center gap-2">
              <Flag country={domain.location.country} />
              {domain.location.city ?? domain.location.label}
            </span>
            <ProviderBadge type={domain.provider.type} name={domain.provider.name} />
          </div>
        </div>
      </div>

      {domain.liveError && (
        <Notice tone="warning" title={t('hosting.liveError.title')}>
          {t('hosting.liveError.text', { provider: domain.provider.name })}
          <span className="mt-1 block font-mono text-xs break-words">{domain.liveError}</span>
        </Notice>
      )}
      {domain.missingSince && (
        <Notice tone="danger" title={t('hosting.missing.title')}>
          {t('hosting.missing.domain', { date: formatDate(domain.missingSince, locale) })}
        </Notice>
      )}

      {tabs.length > 1 && (
        <div className="overflow-x-auto border-b border-border">
          <nav className="-mb-px flex min-w-max gap-1" aria-label={t('hosting.tab.label')}>
            {tabs.map(({ value, label, icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => select(value)}
                className={cn(
                  'inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
                  tab === value
                    ? 'border-brand-blue text-primary-text'
                    : 'border-transparent text-muted hover:border-border-strong hover:text-text',
                )}
                aria-current={tab === value ? 'page' : undefined}
              >
                {icon}
                {label}
              </button>
            ))}
          </nav>
        </div>
      )}

      {tab === 'dns' ? (
        <DomainDns domain={domain} />
      ) : tab === 'cdn' ? (
        <DomainCdn domain={domain} />
      ) : (
        <DomainOverview domain={domain} />
      )}
    </div>
  );
}
