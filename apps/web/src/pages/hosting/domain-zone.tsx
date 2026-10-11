import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Copy, RefreshCw } from 'lucide-react';
import type { DomainDetailDto, LinkedDomain } from '@weblion/shared';
import { cn } from '@/lib/cn';
import { formatDate, formatRelative } from '@/lib/format';
import { useI18n, type TFunction } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { useZoneActivationCheck } from '@/lib/api/zones';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CopyButton,
  KeyValue,
  Mono,
  Notice,
} from '@/components/ui/primitives';
import { ProviderBadge } from '@/components/server-bits';
import { DomainStatusBadge, linkedStatus } from './bits';
import { sameNameservers } from './dns-format';

/**
 * DNS zones (domain kind "zone", Cloudflare): the overview of a zone and the cards that link a
 * registration and the zone of the same name.
 */

/** Zone status in lower case; the live info knows it better than the synced row. */
export function zoneState(domain: DomainDetailDto): string {
  return (domain.info?.zone?.status ?? domain.status ?? '').trim().toLowerCase();
}

/** Router link that looks like a small button. */
export function ButtonLink({
  to,
  children,
  icon,
  variant = 'secondary',
  onClick,
}: {
  to: string;
  children: ReactNode;
  icon?: ReactNode;
  variant?: 'primary' | 'secondary';
  onClick?: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap shadow-card transition-colors',
        variant === 'primary'
          ? 'bg-primary text-white hover:bg-primary-hover'
          : 'border border-border bg-surface text-text hover:bg-surface-3',
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

/** Copies all name servers at once, one per line (what registrar forms usually take). */
export function CopyAllButton({ values }: { values: string[] }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      onClick={() =>
        void navigator.clipboard
          .writeText(values.join('\n'))
          .then(() => setCopied(true))
          .catch(() => undefined)
      }
    >
      {copied ? t('hosting.zone.copied') : t('hosting.zone.copyAll')}
    </Button>
  );
}

/** Host names one per line, so none breaks in the middle. */
function MonoLines({ values, className }: { values: string[]; className?: string }) {
  return (
    <span className="block">
      {values.map((value) => (
        <Mono key={value} className={cn('block break-all', className)}>
          {value}
        </Mono>
      ))}
    </span>
  );
}

export function NameserverList({ nameservers }: { nameservers: string[] }) {
  return (
    <ul className="divide-y divide-border">
      {nameservers.map((ns) => (
        <li key={ns} className="flex items-center gap-2 py-2">
          <Mono className="min-w-0 flex-1 truncate text-text">{ns}</Mono>
          <CopyButton value={ns} />
        </li>
      ))}
    </ul>
  );
}

/** Link target of a linked row, only within the organization the page belongs to. */
function useLinkedPath(linked: LinkedDomain | null, tab?: 'dns'): string | null {
  const { org, base } = useOrg();
  if (!linked || linked.org?.id !== org.id) return null;
  return `${base}/domains/${linked.id}${tab ? `?tab=${tab}` : ''}`;
}

function zoneTypeLabel(t: TFunction, type: string | null): string {
  switch (type) {
    case 'full':
      return t('hosting.zone.type.full');
    case 'partial':
      return t('hosting.zone.type.partial');
    case 'secondary':
      return t('hosting.zone.type.secondary');
    default:
      return type ?? '–';
  }
}

/** "Übersicht" tab of a zone: delegation and activation, zone facts, the registration. */
export function ZoneOverview({ domain }: { domain: DomainDetailDto }) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <ZoneStatusCard domain={domain} />
      <ZoneDetailsCard domain={domain} />
      {domain.registration && <RegistrationLinkCard domain={domain} registration={domain.registration} />}
    </div>
  );
}

function ZoneStatusCard({ domain }: { domain: DomainDetailDto }) {
  const { t } = useI18n();
  const provider = domain.provider.name;
  const zone = domain.info?.zone ?? null;
  const status = zoneState(domain);
  const pending = status === 'pending' || status === 'initializing';
  const nameservers = domain.info?.nameservers ?? [];
  const registration = domain.registration;
  const registrationPath = useLinkedPath(registration);
  const delegated = !!registration && sameNameservers(registration.nameservers, nameservers);
  // The provider re-checks pending zones only (the API answers 409 otherwise).
  const canCheck =
    status === 'pending' && !domain.missingSince && domain.permissions.includes('domain:manage');
  const check = useZoneActivationCheck(domain.id, {
    success: t('hosting.zone.checkActivationDone', { provider }),
  });

  return (
    <Card>
      <CardHeader
        title={t('hosting.zone.title')}
        description={pending ? undefined : t('hosting.zone.text', { provider })}
        actions={<DomainStatusBadge domain={domain} />}
      />
      <CardBody className="space-y-4">
        {pending && (
          <Notice tone="warning" title={t('hosting.zone.pendingTitle')}>
            {t('hosting.zone.pendingText', { provider })}
          </Notice>
        )}
        {status === 'moved' && <Notice tone="danger">{t('hosting.zone.movedText', { provider })}</Notice>}
        {zone?.paused && (
          <Notice tone="info" title={t('hosting.zone.paused')}>
            {t('hosting.zone.pausedText', { provider })}
          </Notice>
        )}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-text">
              {pending ? t('hosting.zone.nameserversToSet') : t('hosting.domain.nameservers')}
            </p>
            {pending && nameservers.length > 1 && <CopyAllButton values={nameservers} />}
          </div>
          {nameservers.length === 0 ? (
            <p className="py-2 text-sm text-muted">{t('hosting.domain.noNameservers')}</p>
          ) : (
            <NameserverList nameservers={nameservers} />
          )}
        </div>
        {pending && zone && zone.originalNameservers.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-muted">{t('hosting.zone.originalNameservers')}</p>
            <MonoLines values={zone.originalNameservers} className="text-muted" />
          </div>
        )}
        {pending &&
          registration &&
          (delegated ? (
            <Notice tone="info">{t('hosting.zone.nsMatch', { provider })}</Notice>
          ) : (
            registrationPath && (
              <ButtonLink to={registrationPath} icon={<ArrowRight className="size-3.5" />}>
                {t('hosting.zone.openRegistration', { registrar: registration.provider.name })}
              </ButtonLink>
            )
          ))}
        {canCheck && (
          <div className="-mx-5 space-y-2 border-t border-border px-5 pt-4">
            <Button
              size="sm"
              icon={<RefreshCw className="size-3.5" />}
              loading={check.isPending}
              onClick={() => check.mutate()}
            >
              {t('hosting.zone.checkActivation')}
            </Button>
            <p className="text-xs text-muted">{t('hosting.zone.checkActivationHint', { provider })}</p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function ZoneDetailsCard({ domain }: { domain: DomainDetailDto }) {
  const { t, locale } = useI18n();
  const info = domain.info;
  const zone = info?.zone ?? null;
  const pending = ['pending', 'initializing'].includes(zoneState(domain));
  const original = zone?.originalNameservers ?? [];

  return (
    <Card>
      <CardHeader title={t('hosting.domain.details')} />
      <CardBody className="py-1">
        <KeyValue
          items={[
            { label: t('hosting.zone.type'), value: zoneTypeLabel(t, zone?.type ?? null) },
            ...(zone?.plan ? [{ label: t('hosting.zone.plan'), value: zone.plan }] : []),
            {
              label: t('hosting.zone.createdAt'),
              value: formatDate(info?.createdAt ?? null, locale, false),
            },
            {
              label: t('hosting.zone.activatedAt'),
              value: formatDate(zone?.activatedAt ?? null, locale, false),
            },
            ...(zone?.originalRegistrar
              ? [{ label: t('hosting.zone.originalRegistrar'), value: zone.originalRegistrar }]
              : []),
            // While pending the status card shows them next to the ones to set.
            ...(!pending && original.length > 0
              ? [
                  {
                    label: t('hosting.zone.originalNameservers'),
                    value: <MonoLines values={original} />,
                  },
                ]
              : []),
            {
              label: t('hosting.lastSync'),
              value: domain.lastSyncedAt ? formatRelative(domain.lastSyncedAt, locale) : '–',
            },
          ]}
        />
      </CardBody>
    </Card>
  );
}

/** The registration of the same name, where the name servers of the zone are set. */
function RegistrationLinkCard({
  domain,
  registration,
}: {
  domain: DomainDetailDto;
  registration: LinkedDomain;
}) {
  const { t } = useI18n();
  const path = useLinkedPath(registration);
  const registrar = registration.provider.name;
  const zoneNameservers = domain.info?.nameservers ?? [];
  const delegated = sameNameservers(registration.nameservers, zoneNameservers);

  return (
    <Card>
      <CardHeader
        title={t('hosting.zone.registrationTitle')}
        description={t('hosting.zone.registrationText', { registrar })}
      />
      <CardBody className="space-y-3 py-1 pb-4">
        <KeyValue
          items={[
            {
              label: t('hosting.zone.registrar'),
              value: (
                <span className="inline-flex items-center gap-2">
                  <ProviderBadge type={registration.provider.type} name={registrar} />
                  <span className="truncate">{registrar}</span>
                </span>
              ),
            },
            {
              label: t('hosting.col.status'),
              value: (
                <DomainStatusBadge
                  domain={{ status: registration.status, missingSince: null }}
                  kind={registration.kind}
                />
              ),
            },
            {
              label: t('hosting.zone.delegation'),
              value:
                registration.nameservers.length === 0 ? (
                  '–'
                ) : (
                  <div className="space-y-1">
                    <MonoLines values={registration.nameservers} />
                    {zoneNameservers.length > 0 && (
                      <Badge tone={delegated ? 'success' : 'warning'}>
                        {delegated ? t('hosting.zone.delegationOk') : t('hosting.zone.delegationOther')}
                      </Badge>
                    )}
                  </div>
                ),
            },
          ]}
        />
        {path && (
          <ButtonLink to={path} icon={<ArrowRight className="size-3.5" />}>
            {t('hosting.zone.openRegistration', { registrar })}
          </ButtonLink>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * DNS tab of a registration whose name servers point away from the registrar while a zone of
 * the same name exists (e.g. at Cloudflare): the records that count are in that zone.
 */
export function DnsElsewhereCard({ domain, zone }: { domain: DomainDetailDto; zone: LinkedDomain }) {
  const { t } = useI18n();
  const path = useLinkedPath(zone, 'dns');
  const provider = zone.provider.name;
  return (
    <Card>
      <CardBody className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text">
            {t('hosting.dnsZone.title', { provider })}
            <DomainStatusBadge domain={{ status: zone.status, missingSince: null }} kind={zone.kind} />
          </p>
          <p className="text-sm text-muted">
            {zone.active
              ? t('hosting.dnsZone.text', { name: domain.name, provider })
              : t('hosting.dnsZone.notActive', {
                  name: domain.name,
                  provider,
                  status: linkedStatus(t, zone).label,
                })}
          </p>
          {!path && <p className="text-xs text-muted">{t('hosting.dnsZone.otherOrg')}</p>}
        </div>
        {path && (
          <ButtonLink to={path} variant="primary" icon={<ArrowRight className="size-3.5" />}>
            {t('hosting.dnsZone.open')}
          </ButtonLink>
        )}
      </CardBody>
    </Card>
  );
}

/** Line under the name servers of a registration: where its DNS zone is and how it stands. */
export function DnsZoneLine({ zone }: { zone: LinkedDomain }) {
  const { t } = useI18n();
  const path = useLinkedPath(zone);
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-2.5 pb-1 text-xs text-muted">
      <span>
        {t('hosting.dnsZone.nsLine', { provider: zone.provider.name, status: linkedStatus(t, zone).label })}
      </span>
      {path && (
        <Link to={path} className="font-medium text-primary-text hover:underline">
          {t('hosting.dnsZone.open')}
        </Link>
      )}
    </p>
  );
}
