import { useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Cable, ChevronLeft, LayoutGrid, Pencil, Phone, PhoneForwarded, Users } from 'lucide-react';
import type { PhoneCapability, PhoneSystemDetailDto } from '@weblion/shared';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatRelative } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { usePhoneSystem } from '@/lib/api/phone';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, KeyValue, LoadingBlock, Mono, Notice } from '@/components/ui/primitives';
import { ProviderBadge } from '@/components/server-bits';
import { PanelLink, safePanelUrl } from '@/pages/hosting/bits';
import {
  CallsMeter,
  EditionLabel,
  LicenseText,
  PhoneDetailError,
  PhoneStatusBadge,
  StatusReasons,
  TrunksFigure,
  UsersFigure,
  ofMax,
} from './bits';
import { RenamePhoneSystemDialog } from './dialogs';
import { UsersTab } from './users';
import { RingGroupsTab } from './ring-groups';
import { TrunksTab } from './trunks';

/** One phone system (/o/:slug/phone/:systemId): facts read live, users, ring groups and trunks. */
export function PhoneSystemPage() {
  const { t } = useI18n();
  const { systemId } = useParams();
  const { base } = useOrg();
  const system = usePhoneSystem(systemId);

  return (
    <>
      <Link
        to={`${base}/phone`}
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text"
      >
        <ChevronLeft className="size-4" /> {t('nav.phone')}
      </Link>
      {system.data ? (
        // A failed background refetch keeps the view (and its open dialogs).
        <>
          {system.isError && (
            <Notice tone="warning" title={t('phone.refreshError')} className="mb-4">
              <span className="block break-words">{errorMessage(system.error)}</span>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                loading={system.isFetching}
                onClick={() => void system.refetch()}
              >
                {t('common.retry')}
              </Button>
            </Notice>
          )}
          <PhoneSystemView system={system.data} />
        </>
      ) : system.isPending ? (
        <LoadingBlock rows={6} />
      ) : (
        <PhoneDetailError error={system.error} onRetry={() => void system.refetch()} back={`${base}/phone`} />
      )}
    </>
  );
}

type PhoneTab = 'overview' | 'users' | 'ring-groups' | 'trunks';

function PhoneSystemView({ system }: { system: PhoneSystemDetailDto }) {
  const { t, locale } = useI18n();
  const [params, setParams] = useSearchParams();
  const [renaming, setRenaming] = useState(false);
  const webClient = safePanelUrl(system.webClientUrl);
  const has = (capability: PhoneCapability) => system.capabilities.includes(capability);
  // Tabs whose capability the provider lacks are hidden.
  const tabs: { value: PhoneTab; label: string; icon: ReactNode }[] = [
    { value: 'overview', label: t('phone.tab.overview'), icon: <LayoutGrid className="size-4" /> },
    ...(has('users')
      ? [{ value: 'users' as const, label: t('phone.tab.users'), icon: <Users className="size-4" /> }]
      : []),
    ...(has('ringGroups')
      ? [
          {
            value: 'ring-groups' as const,
            label: t('phone.tab.ringGroups'),
            icon: <PhoneForwarded className="size-4" />,
          },
        ]
      : []),
    ...(has('trunks')
      ? [{ value: 'trunks' as const, label: t('phone.tab.trunks'), icon: <Cable className="size-4" /> }]
      : []),
  ];
  const tabParam = params.get('tab');
  const tab: PhoneTab = tabs.find((x) => x.value === tabParam)?.value ?? 'overview';

  const select = (value: PhoneTab) => {
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
            <Phone className="size-5 text-muted" aria-hidden />
            <h1 className="font-display truncate text-2xl font-semibold tracking-tight text-text">
              {system.name}
            </h1>
            <PhoneStatusBadge status={system.status} missing={system.missingSince} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted">
            <ProviderBadge type={system.provider.type} name={system.provider.name} />
            {system.info?.fqdn && system.info.fqdn !== system.name && <Mono>{system.info.fqdn}</Mono>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {system.permissions.includes('phone:write') && (
            <Button icon={<Pencil className="size-4" />} onClick={() => setRenaming(true)}>
              {t('phone.rename')}
            </Button>
          )}
          {webClient && <PanelLink href={webClient}>{t('phone.openWebClient')}</PanelLink>}
        </div>
      </div>

      {system.liveError && (
        <Notice tone="warning" title={t('phone.liveError')}>
          {t('phone.liveErrorText')}
          <span className="mt-1 block font-mono text-xs break-words">{system.liveError}</span>
        </Notice>
      )}
      {system.missingSince && (
        <Notice tone="danger" title={t('phone.missingTitle')}>
          {t('phone.missingText', { date: formatDate(system.missingSince, locale) })}
        </Notice>
      )}
      <StatusReasons reasons={system.statusReasons} />

      {tabs.length > 1 && (
        <div className="overflow-x-auto border-b border-border">
          <nav className="-mb-px flex min-w-max gap-1" aria-label={t('phone.tab.label')}>
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

      {tab === 'users' ? (
        <UsersTab system={system} />
      ) : tab === 'ring-groups' ? (
        <RingGroupsTab system={system} />
      ) : tab === 'trunks' ? (
        <TrunksTab system={system} />
      ) : (
        <OverviewTab system={system} />
      )}

      {renaming && <RenamePhoneSystemDialog system={system} onClose={() => setRenaming(false)} />}
    </div>
  );
}

/** Facts of the phone system. The product code comes only for platform staff (the API leaves it out). */
function OverviewTab({ system }: { system: PhoneSystemDetailDto }) {
  const { t, locale } = useI18n();
  const info = system.info;
  const dash = <span className="text-subtle">–</span>;
  const webClient = safePanelUrl(system.webClientUrl);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t('phone.fact.title')} />
        <CardBody className="py-1">
          {!info ? (
            <p className="py-3 text-sm text-muted">{t('phone.noFacts')}</p>
          ) : (
            <KeyValue
              items={[
                {
                  label: t('phone.fact.status'),
                  value: <PhoneStatusBadge status={system.status} missing={system.missingSince} />,
                },
                { label: t('phone.fact.fqdn'), value: info.fqdn ? <Mono>{info.fqdn}</Mono> : dash },
                { label: t('phone.fact.version'), value: info.version ? <Mono>{info.version}</Mono> : dash },
                {
                  label: t('phone.fact.edition'),
                  value: <EditionLabel edition={info.edition} productCode={info.productCode} />,
                },
                {
                  label: t('phone.fact.license'),
                  value: <LicenseText expiresAt={info.licenseExpiresAt} prefix={false} />,
                },
                {
                  label: t('phone.fact.maintenance'),
                  value: info.maintenanceExpiresAt
                    ? formatDate(info.maintenanceExpiresAt, locale, false)
                    : dash,
                },
                { label: t('phone.fact.calls'), value: <CallsMeter info={info} className="max-w-[220px]" /> },
                { label: t('phone.fact.users'), value: <UsersFigure info={info} /> },
                {
                  label: t('phone.fact.extensions'),
                  value: (
                    <span className="tabular">
                      {ofMax(info.extensionsRegistered, info.extensionsTotal, locale)}
                    </span>
                  ),
                },
                { label: t('phone.fact.trunks'), value: <TrunksFigure info={info} /> },
                {
                  label: t('phone.fact.numberLength'),
                  value:
                    info.numberLength !== null
                      ? t('phone.fact.numberLengthValue', { n: info.numberLength })
                      : dash,
                },
                {
                  label: t('phone.fact.synced'),
                  value: system.lastSyncedAt ? formatRelative(system.lastSyncedAt, locale) : dash,
                },
                ...(webClient
                  ? [
                      {
                        label: t('phone.fact.webClient'),
                        value: (
                          <a
                            href={webClient}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-[12.5px] break-all text-primary-text hover:underline"
                          >
                            {webClient}
                          </a>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </CardBody>
      </Card>
      <Notice tone="info">{t('phone.licenseNote')}</Notice>
    </div>
  );
}
