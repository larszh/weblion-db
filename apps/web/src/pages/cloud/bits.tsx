import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { CLOUD_MIN_QUOTA_BYTES, type CloudAccountDto, type CloudAllowanceDto } from '@weblion/shared';
import { cn } from '@/lib/cn';
import { formatBytes, formatNumber, formatRelative, type Locale } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { Badge, CopyButton, Mono } from '@/components/ui/primitives';
import { ProviderBadge } from '@/components/server-bits';
import { safePanelUrl } from '@/pages/hosting/bits';

/** Shared pieces of the cloud storage pages (customer view, admin and reseller cards). */

/** Quotas are handed out in whole GB (1 GB = CLOUD_MIN_QUOTA_BYTES = 1 GiB, like the API). */
export const GIB = CLOUD_MIN_QUOTA_BYTES;

/** Nextcloud user ids are at most 64 characters long (checked by the API as well). */
export const MAX_USERNAME_LENGTH = 64;

/** A quota as it was booked ("10 GB"). Odd sizes (imported accounts) read like other sizes. */
export function formatQuota(bytes: number | null | undefined, locale: Locale): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '–';
  const gb = bytes / GIB;
  return Number.isInteger(gb) ? `${formatNumber(gb, locale)} GB` : formatBytes(bytes);
}

/** Whole GB of an allowance that are not handed out yet. */
export function freeGb(allowance: Pick<CloudAllowanceDto, 'quotaBytes' | 'allocatedBytes'>): number {
  return Math.max(0, Math.floor((allowance.quotaBytes - allowance.allocatedBytes) / GIB));
}

/** What an account counts with in its allowance: its quota, or what it uses without one. */
export const countedBytes = (account: Pick<CloudAccountDto, 'quotaBytes' | 'usedBytes'>): number =>
  account.quotaBytes ?? account.usedBytes ?? 0;

/** Whole GB from a form field, or null when it is no positive integer. */
export function parseGb(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

export type UsageLevel = 'ok' | 'warning' | 'over';

/** Warn above 90 % of the quota, error once an account uses more than its quota. */
export function usageLevel(usedBytes: number | null, quotaBytes: number | null): UsageLevel {
  if (usedBytes === null || quotaBytes === null || quotaBytes <= 0) return 'ok';
  if (usedBytes > quotaBytes) return 'over';
  return usedBytes / quotaBytes > 0.9 ? 'warning' : 'ok';
}

const LEVEL_BAR: Record<UsageLevel, string> = {
  ok: 'bg-brand-teal',
  warning: 'bg-warning',
  over: 'bg-danger',
};

/** Usage of one account against its quota, with a bar. Unlimited quotas show the usage only. */
export function QuotaUsage({
  usedBytes,
  quotaBytes,
  className,
}: {
  usedBytes: number | null;
  quotaBytes: number | null;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const level = usageLevel(usedBytes, quotaBytes);
  const used = usedBytes === null ? '–' : formatBytes(usedBytes);
  const pct = quotaBytes && usedBytes !== null ? Math.min(100, (usedBytes / quotaBytes) * 100) : 0;
  return (
    <div className={cn('min-w-[150px]', className)}>
      <div
        className={cn(
          'text-xs whitespace-nowrap tabular',
          level === 'over' ? 'font-medium text-danger' : level === 'warning' ? 'text-warning' : 'text-muted',
        )}
      >
        {quotaBytes === null
          ? t('storage.usage.unlimited', { used })
          : t('storage.usage.of', { used, quota: formatQuota(quotaBytes, locale) })}
      </div>
      {quotaBytes !== null && (
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
          <div
            className={cn('h-full rounded-full transition-[width]', LEVEL_BAR[level])}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {level === 'over' && <div className="mt-1 text-xs text-danger">{t('storage.usage.over')}</div>}
    </div>
  );
}

/** Active, disabled, or gone at the instance. */
export function AccountStatusBadge({
  account,
}: {
  account: Pick<CloudAccountDto, 'enabled' | 'missingSince'>;
}) {
  const { t } = useI18n();
  if (account.missingSince) return <Badge tone="danger">{t('storage.status.missing')}</Badge>;
  return account.enabled ? (
    <Badge tone="success">{t('storage.status.active')}</Badge>
  ) : (
    <Badge tone="neutral">{t('storage.status.disabled')}</Badge>
  );
}

export function LastLogin({ value }: { value: string | null }) {
  const { t, locale } = useI18n();
  if (!value) return <span className="text-subtle">{t('storage.lastLogin.never')}</span>;
  return <span className="whitespace-nowrap">{formatRelative(value, locale)}</span>;
}

/** Login name in monospace with a copy button. */
export function LoginName({ username, className }: { username: string; className?: string }) {
  const { t } = useI18n();
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1', className)}>
      <Mono className="truncate font-medium text-text">{username}</Mono>
      <CopyButton value={username} label={t('storage.copyLogin')} />
    </span>
  );
}

/**
 * Allowance as one bar: what the accounts use (dark) inside what is handed out to them
 * (light) inside the booked storage, with a legend.
 */
export function AllowanceMeter({
  allowance,
  className,
}: {
  allowance: Pick<CloudAllowanceDto, 'quotaBytes' | 'allocatedBytes' | 'usedBytes'>;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const { quotaBytes, allocatedBytes, usedBytes } = allowance;
  const pct = (bytes: number) => (quotaBytes > 0 ? Math.min(100, (bytes / quotaBytes) * 100) : 0);
  const over = allocatedBytes > quotaBytes;
  return (
    <div className={className}>
      <div
        className="relative h-2.5 w-full overflow-hidden rounded-full bg-surface-3"
        role="img"
        aria-label={t('storage.meter.label', {
          allocated: formatQuota(allocatedBytes, locale),
          used: formatBytes(usedBytes),
          quota: formatQuota(quotaBytes, locale),
        })}
      >
        <div
          className={cn('absolute inset-y-0 left-0 rounded-full', over ? 'bg-danger/40' : 'bg-brand-blue/30')}
          style={{ width: `${pct(allocatedBytes)}%` }}
        />
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-brand-blue"
          style={{ width: `${pct(usedBytes)}%` }}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <Legend className="bg-brand-blue">
          {t('storage.meter.used')}{' '}
          <span className="font-medium text-text tabular">{formatBytes(usedBytes)}</span>
        </Legend>
        <Legend className={over ? 'bg-danger/40' : 'bg-brand-blue/30'}>
          {t('storage.meter.allocated')}{' '}
          <span className="font-medium text-text tabular">{formatQuota(allocatedBytes, locale)}</span>
        </Legend>
        <Legend className="bg-surface-3 ring-1 ring-border-strong ring-inset">
          {t('storage.meter.free')}{' '}
          <span className="font-medium text-text tabular">
            {formatQuota(Math.max(0, quotaBytes - allocatedBytes), locale)}
          </span>
        </Legend>
      </div>
    </div>
  );
}

function Legend({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('size-2.5 shrink-0 rounded-full', className)} aria-hidden />
      <span>{children}</span>
    </span>
  );
}

/** Accounts in use against the maximum ("3 / 10", or "3 / unlimited"). */
export function accountsText(
  t: ReturnType<typeof useI18n>['t'],
  allowance: Pick<CloudAllowanceDto, 'accounts' | 'maxAccounts'>,
): string {
  return allowance.maxAccounts === null
    ? t('storage.accounts.ofUnlimited', { n: allowance.accounts })
    : t('storage.accounts.of', { n: allowance.accounts, max: allowance.maxAccounts });
}

/**
 * Key figures of an allowance: booked storage, the bar, accounts and the instance. Used on
 * the customer page and in the admin and reseller cards.
 */
export function AllowanceFigures({
  allowance,
  showInstance = true,
  extra,
}: {
  allowance: CloudAllowanceDto;
  showInstance?: boolean;
  extra?: ReactNode;
}) {
  const { t, locale } = useI18n();
  const url = safePanelUrl(allowance.provider?.url);
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Figure label={t('storage.figure.booked')} value={formatQuota(allowance.quotaBytes, locale)} />
        <Figure label={t('storage.figure.allocated')} value={formatQuota(allowance.allocatedBytes, locale)} />
        <Figure label={t('storage.figure.used')} value={formatBytes(allowance.usedBytes)} />
        <Figure label={t('storage.figure.accounts')} value={accountsText(t, allowance)} />
      </dl>
      <AllowanceMeter allowance={allowance} />
      {extra}
      {showInstance && allowance.provider && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border pt-3 text-sm text-muted">
          <span>{t('storage.instance')}:</span>
          <span className="inline-flex items-center gap-1.5">
            <ProviderBadge type={allowance.provider.type} name={allowance.provider.name} />
            <span className="font-medium text-text">{allowance.provider.name}</span>
          </span>
          {url && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-w-0 items-center gap-1 text-primary-text hover:underline"
              >
                <Mono className="truncate">{url}</Mono>
                <ExternalLink className="size-3.5 shrink-0" aria-hidden />
              </a>
              <CopyButton value={url} />
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-lg font-semibold text-text tabular">{value}</dd>
    </div>
  );
}
