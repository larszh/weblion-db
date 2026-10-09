import type { ReactNode } from 'react';
import { ExternalLink, Lock, LockOpen, PackageX, SearchX } from 'lucide-react';
import { MODULE_DEFS, type ModuleKey, type WebspaceResources } from '@weblion/shared';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatMemoryMb, formatNumber } from '@/lib/format';
import { useI18n, type TFunction } from '@/lib/i18n';
import { Badge, Card, EmptyState, ErrorState } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/menu';

/** Shared pieces of the domain and web space pages (customer views and admin inventory). */

const DAY = 86_400_000;

type Tone = 'neutral' | 'success' | 'warning' | 'danger';

/**
 * Provider status strings are free text (24fire: "OK", transfer states, ...). Known good
 * values are shown as "Aktiv", anything else as reported, with a tone that fits.
 */
export function domainStatus(
  t: TFunction,
  domain: { status: string | null; missingSince: string | null },
  terminated = false,
): { tone: Tone; label: string } {
  if (domain.missingSince) return { tone: 'danger', label: t('hosting.status.missing') };
  if (terminated) return { tone: 'danger', label: t('hosting.status.terminated') };
  const status = domain.status?.trim();
  if (!status) return { tone: 'neutral', label: t('hosting.status.unknown') };
  if (/^(ok|active|aktiv|registered)$/i.test(status))
    return { tone: 'success', label: t('hosting.status.active') };
  if (/expire|delet|terminat|cancel|lock|fail|error/i.test(status)) return { tone: 'danger', label: status };
  if (/transfer|pending|wait|process|order/i.test(status)) return { tone: 'warning', label: status };
  return { tone: 'neutral', label: status };
}

export function DomainStatusBadge({
  domain,
  terminated,
}: {
  domain: { status: string | null; missingSince: string | null };
  terminated?: boolean;
}) {
  const { t } = useI18n();
  const s = domainStatus(t, domain, terminated);
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

/** Expiry date, highlighted when it is close and the domain does not renew by itself. */
export function ExpiryText({
  expiresAt,
  autoRenew,
  className,
}: {
  expiresAt: string | null;
  autoRenew?: boolean | null;
  className?: string;
}) {
  const { t, locale } = useI18n();
  if (!expiresAt) return <span className={cn('text-subtle', className)}>–</span>;
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / DAY);
  const soon = Number.isFinite(days) && days <= 30;
  const urgent = soon && autoRenew !== true;
  const text = (
    <span className={cn(urgent ? 'font-medium text-warning' : undefined, className)}>
      {formatDate(expiresAt, locale, false)}
    </span>
  );
  if (!soon) return text;
  return (
    <Tooltip
      content={
        days < 0
          ? t('hosting.expiry.past')
          : autoRenew
            ? t('hosting.expiry.soonRenews', { days })
            : t('hosting.expiry.soon', { days })
      }
    >
      {text}
    </Tooltip>
  );
}

/** `long` spells the setting out for places without a column header. */
export function AutoRenewBadge({ value, long }: { value: boolean | null; long?: boolean }) {
  const { t } = useI18n();
  if (value === null) return long ? null : <span className="text-subtle">–</span>;
  return value ? (
    <Badge tone="success">{long ? t('hosting.autoRenew.onLong') : t('hosting.autoRenew.on')}</Badge>
  ) : (
    <Badge tone="warning">{long ? t('hosting.autoRenew.offLong') : t('hosting.autoRenew.off')}</Badge>
  );
}

/** Transfer lock. Providers that do not report it show "–" (or nothing with `long`). */
export function LockBadge({ locked, long }: { locked: boolean | null | undefined; long?: boolean }) {
  const { t } = useI18n();
  if (locked === null || locked === undefined) return long ? null : <span className="text-subtle">–</span>;
  return locked ? (
    <Badge tone="success">
      <Lock className="size-3" aria-hidden />
      {long ? t('hosting.lock.onLong') : t('hosting.lock.on')}
    </Badge>
  ) : (
    <Badge tone="warning">
      <LockOpen className="size-3" aria-hidden />
      {long ? t('hosting.lock.offLong') : t('hosting.lock.off')}
    </Badge>
  );
}

/** Shown when the service module is not activated for the organization. */
export function ModuleOffState({ module }: { module: ModuleKey }) {
  const { t, locale } = useI18n();
  return (
    <EmptyState
      icon={<PackageX className="size-6" />}
      title={t('hosting.moduleOff.title', { module: MODULE_DEFS[module].label[locale] })}
      description={t('hosting.moduleOff.text')}
    />
  );
}

/**
 * Error of a detail page. The API answers 404 for resources the user may not see, which
 * reads better as a plain "not found" than as the raw API message.
 */
export function DetailError({
  error,
  onRetry,
  kind,
}: {
  error: unknown;
  onRetry: () => void;
  kind: 'domain' | 'webspace';
}) {
  const { t } = useI18n();
  if (error instanceof ApiError && error.status === 404) {
    return (
      <Card>
        <EmptyState
          icon={<SearchX className="size-6" />}
          title={kind === 'domain' ? t('hosting.notFound.domain') : t('hosting.notFound.webspace')}
          description={t('hosting.notFound.text')}
        />
      </Card>
    );
  }
  return <ErrorState error={error} onRetry={onRetry} />;
}

export interface ResourceItem {
  key: string;
  label: string;
  value: string;
}

const count = (value: number | null, locale: 'de' | 'en') =>
  value === null ? '–' : formatNumber(value, locale);

/** Web space limits in display order. Missing values show as "–". */
export function resourceItems(
  t: TFunction,
  locale: 'de' | 'en',
  resources: WebspaceResources | null,
): ResourceItem[] {
  const r = resources;
  return [
    { key: 'domains', label: t('hosting.res.domains'), value: count(r?.domains ?? null, locale) },
    { key: 'subdomains', label: t('hosting.res.subdomains'), value: count(r?.subdomains ?? null, locale) },
    { key: 'emails', label: t('hosting.res.emails'), value: count(r?.emails ?? null, locale) },
    { key: 'databases', label: t('hosting.res.databases'), value: count(r?.databases ?? null, locale) },
    { key: 'storage', label: t('hosting.res.storage'), value: formatMemoryMb(r?.storageMb ?? null) },
    {
      key: 'traffic',
      label: t('hosting.res.traffic'),
      // The provider reports no number for plans without a traffic limit.
      value: !r
        ? '–'
        : r.trafficGb === null
          ? t('hosting.res.unlimited')
          : t('hosting.res.perMonth', { value: `${formatNumber(r.trafficGb, locale)} GB` }),
    },
  ];
}

/** Provider data only ever links to http(s) addresses. */
export function safePanelUrl(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

/** A link to the control panel that looks like a button and opens in a new tab. */
export function PanelLink({
  href,
  children,
  variant = 'primary',
  size = 'md',
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary';
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex shrink-0 items-center rounded-lg font-medium whitespace-nowrap transition-colors',
        variant === 'primary'
          ? 'bg-primary text-white shadow-card hover:bg-primary-hover'
          : 'border border-border bg-surface text-text shadow-card hover:bg-surface-3',
        size === 'sm' ? 'h-8 gap-1.5 px-3 text-[13px]' : 'h-9 gap-2 px-4 text-sm',
        className,
      )}
    >
      <ExternalLink className={size === 'sm' ? 'size-3.5' : 'size-4'} aria-hidden />
      {children}
    </a>
  );
}
