import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  MEDIA_MAX_BITRATE_MBIT,
  mediaActivityDay,
  type MediaAccess,
  type MediaAccountDto,
  type MediaAccountIssue,
  type MediaAllowanceDto,
  type MediaLibraryRef,
} from '@weblion/shared';
import type { TranslationKey } from '@/i18n/de';
import { cn } from '@/lib/cn';
import { formatNumber, type Locale } from '@/lib/format';
import { useI18n, type TFunction } from '@/lib/i18n';
import { Badge, CopyButton, Mono } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/menu';
import { ProviderBadge } from '@/components/server-bits';
import { safePanelUrl } from '@/pages/hosting/bits';

/** Shared pieces of the streaming pages (customer view, admin and reseller cards). */

// --- Status --------------------------------------------------------------------------

export type MediaStatus = 'missing' | 'locked' | 'disabled' | 'noPassword' | 'active';

/** One status per account, the most pressing first: gone, locked, disabled, without password. */
export function mediaStatus(
  account: Pick<MediaAccountDto, 'missingSince' | 'enabled' | 'hasPassword' | 'issues'>,
): MediaStatus {
  if (account.missingSince) return 'missing';
  if (account.issues.includes('locked_out')) return 'locked';
  if (!account.enabled) return 'disabled';
  if (!account.hasPassword || account.issues.includes('no_password')) return 'noPassword';
  return 'active';
}

const STATUS: Record<
  MediaStatus,
  { tone: 'success' | 'neutral' | 'warning' | 'danger'; key: TranslationKey }
> = {
  active: { tone: 'success', key: 'media.status.active' },
  disabled: { tone: 'neutral', key: 'media.status.disabled' },
  locked: { tone: 'warning', key: 'media.status.locked' },
  noPassword: { tone: 'warning', key: 'media.status.noPassword' },
  missing: { tone: 'danger', key: 'media.status.missing' },
};

const STATUS_HINT: Partial<Record<MediaStatus, TranslationKey>> = {
  locked: 'media.status.lockedHint',
  noPassword: 'media.status.noPasswordHint',
  missing: 'media.status.missingHint',
};

export function MediaStatusBadge({
  account,
}: {
  account: Pick<MediaAccountDto, 'missingSince' | 'enabled' | 'hasPassword' | 'issues'>;
}) {
  const { t } = useI18n();
  const status = mediaStatus(account);
  const badge = <Badge tone={STATUS[status].tone}>{t(STATUS[status].key)}</Badge>;
  const hint = STATUS_HINT[status];
  if (!hint) return badge;
  return (
    <Tooltip content={t(hint)}>
      <span className="inline-flex">{badge}</span>
    </Tooltip>
  );
}

// --- Issues (admin) ------------------------------------------------------------------

const ISSUE: Record<
  MediaAccountIssue,
  { label: TranslationKey; text: TranslationKey; tone: 'warning' | 'danger' }
> = {
  policy: { label: 'media.issue.policy', text: 'media.issue.policy.text', tone: 'warning' },
  administrator: {
    label: 'media.issue.administrator',
    text: 'media.issue.administrator.text',
    tone: 'danger',
  },
  blocked_folders: {
    label: 'media.issue.blocked_folders',
    text: 'media.issue.blocked_folders.text',
    tone: 'danger',
  },
  no_password: { label: 'media.issue.no_password', text: 'media.issue.no_password.text', tone: 'danger' },
  locked_out: { label: 'media.issue.locked_out', text: 'media.issue.locked_out.text', tone: 'warning' },
  no_allowance: { label: 'media.issue.no_allowance', text: 'media.issue.no_allowance.text', tone: 'warning' },
};

/** Problems the sync found, each with its explanation as tooltip. */
export function IssueBadges({ issues, className }: { issues: MediaAccountIssue[]; className?: string }) {
  const { t } = useI18n();
  if (issues.length === 0) return <span className="text-subtle">–</span>;
  return (
    <span className={cn('inline-flex flex-wrap gap-1', className)}>
      {issues.map((issue) => (
        <Tooltip key={issue} content={t(ISSUE[issue].text)}>
          <span className="inline-flex">
            <Badge tone={ISSUE[issue].tone}>{t(ISSUE[issue].label)}</Badge>
          </span>
        </Tooltip>
      ))}
    </span>
  );
}

// --- Last activity -------------------------------------------------------------------

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const intlLocale = (locale: Locale) => (locale === 'de' ? 'de-CH' : 'en-GB');

/** Today's calendar day where the days of last activity are counted (Europe/Zurich). */
export function mediaToday(now: Date = new Date()): string {
  return mediaActivityDay(now.toISOString()) ?? now.toISOString().slice(0, 10);
}

/** The calendar day before "YYYY-MM-DD", by the calendar alone (no time zone involved). */
export function previousDay(day: string): string | null {
  const m = DAY.exec(day);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - 1)).toISOString().slice(0, 10);
}

export type ActivityDayKind = 'never' | 'today' | 'yesterday' | 'date';

/** How a day of last activity reads against today (both "YYYY-MM-DD" in Europe/Zurich). */
export function activityDayKind(day: string | null, today: string): ActivityDayKind {
  if (!day || !DAY.test(day)) return 'never';
  // A day after today only comes from clocks a little ahead: it is today as well.
  if (day >= today) return 'today';
  return day === previousDay(today) ? 'yesterday' : 'date';
}

/** "11. Okt. 2026" or "11 Oct 2026" from the day alone, never a time. */
export function formatMediaDay(day: string, locale: Locale): string {
  const m = DAY.exec(day);
  if (!m) return day;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function activityDayText(t: TFunction, locale: Locale, day: string | null, today: string): string {
  const kind = activityDayKind(day, today);
  if (kind === 'never' || !day) return t('media.activity.never');
  if (kind === 'today') return t('media.activity.today');
  if (kind === 'yesterday') return t('media.activity.yesterday');
  return formatMediaDay(day, locale);
}

/** The calendar day of the last activity: Heute, Gestern or the date. Never the time of day. */
export function ActivityDay({ day }: { day: string | null }) {
  const { t, locale } = useI18n();
  const text = activityDayText(t, locale, day, mediaToday());
  return <span className={cn('whitespace-nowrap', !day && 'text-subtle')}>{text}</span>;
}

// --- Login names and passwords --------------------------------------------------------

/** "anna-kemaro"; while nothing is typed "…-kemaro". */
export function usernamePreview(name: string, code: string): string {
  return `${name || '…'}-${code}`;
}

/** "abcd efgh ijkm npqr": a generated password in groups of four, for reading it out. */
export function groupPassword(password: string): string {
  const chars = [...password];
  const groups: string[] = [];
  for (let i = 0; i < chars.length; i += 4) groups.push(chars.slice(i, i + 4).join(''));
  return groups.join(' ');
}

/** Login name in monospace with a copy button. */
export function LoginName({ username, className }: { username: string; className?: string }) {
  const { t } = useI18n();
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1', className)}>
      <Mono className="truncate font-medium text-text">{username}</Mono>
      <CopyButton value={username} label={t('media.copyLogin')} />
    </span>
  );
}

// --- Allowance -----------------------------------------------------------------------

/** "8 Mbit/s"; null is the server's own setting. */
export function formatBitrate(mbit: number | null, locale: Locale, t: TFunction): string {
  return mbit === null ? t('media.allowance.serverBitrate') : `${formatNumber(mbit, locale)} Mbit/s`;
}

/** The access part of an allowance, to compare it with another one (mediaAccessExceeds). */
export function mediaAccessOfDto(
  allowance: Pick<MediaAllowanceDto, 'libraries' | 'maxStreams' | 'downloads' | 'remoteBitrateMbit'>,
): MediaAccess {
  return {
    libraryIds: allowance.libraries.map((l) => l.id),
    maxStreams: allowance.maxStreams,
    downloads: allowance.downloads,
    remoteBitrateMbit: allowance.remoteBitrateMbit,
  };
}

/** Accounts of the organization itself (for a reseller without what it handed to its customers). */
export const ownMediaAccounts = (allowance: Pick<MediaAllowanceDto, 'accounts' | 'customerAccounts'>) =>
  Math.max(0, allowance.accounts - allowance.customerAccounts);

/** Every account of the allowance is taken (own accounts plus a reseller's hand-outs). */
export const mediaAllowanceFull = (allowance: Pick<MediaAllowanceDto, 'accounts' | 'maxAccounts'>) =>
  allowance.accounts >= allowance.maxAccounts;

/** A whole number from 1 up, or null. */
export function parseCount(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/** Bitrate choice of the allowance dialogs: the server's setting, a preset or an own value. */
export type BitrateChoice = 'server' | 'custom' | `${number}`;

export function bitrateChoiceOf(mbit: number | null, presets: readonly number[]): BitrateChoice {
  if (mbit === null) return 'server';
  return presets.includes(mbit) ? (String(mbit) as BitrateChoice) : 'custom';
}

export type BitrateIssue = 'invalid' | 'tooHigh' | 'serverNotAllowed';

/**
 * The limit in Mbit/s the choice stands for (null = the server's setting), or what is wrong
 * with it. `cap`: a reseller's own limit, which a customer cannot exceed or leave for the
 * server's setting.
 */
export function readBitrate(
  choice: BitrateChoice,
  custom: string,
  cap: number | null = null,
): { value: number | null; issue: BitrateIssue | null } {
  if (choice === 'server') return { value: null, issue: cap === null ? null : 'serverNotAllowed' };
  const value = parseCount(choice === 'custom' ? custom : choice);
  if (value === null || value > MEDIA_MAX_BITRATE_MBIT) return { value: null, issue: 'invalid' };
  if (cap !== null && value > cap) return { value, issue: 'tooHigh' };
  return { value, issue: null };
}

/** Library names as small chips; libraries gone from the instance are struck through. */
export function LibraryChips({ libraries, className }: { libraries: MediaLibraryRef[]; className?: string }) {
  const { t } = useI18n();
  if (libraries.length === 0) return <span className="text-sm text-subtle">–</span>;
  return (
    <span className={cn('flex flex-wrap gap-1.5', className)}>
      {libraries.map((library) =>
        library.missing ? (
          <Tooltip key={library.id} content={t('media.library.missing')}>
            <span className="inline-flex">
              <Badge tone="danger" className="line-through">
                {library.name}
              </Badge>
            </span>
          </Tooltip>
        ) : (
          <Badge key={library.id} tone="primary">
            {library.name}
          </Badge>
        ),
      )}
    </span>
  );
}

function Figure({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-lg leading-snug font-semibold break-words text-text tabular">{value}</dd>
    </div>
  );
}

/**
 * Key figures of an allowance: accounts, streams, downloads, bitrate outside the server's
 * network, the libraries and the instance. Used on the customer page and in the admin and
 * reseller cards.
 */
export function MediaAllowanceFigures({
  allowance,
  showInstance = true,
  showCode = false,
  extra,
}: {
  allowance: MediaAllowanceDto;
  showInstance?: boolean;
  showCode?: boolean;
  extra?: ReactNode;
}) {
  const { t, locale } = useI18n();
  const url = safePanelUrl(allowance.provider?.url);
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Figure
          label={t('media.figure.accounts')}
          value={t('media.figure.accountsOf', { n: allowance.accounts, max: allowance.maxAccounts })}
        />
        <Figure
          label={t('media.figure.streams')}
          value={t('media.figure.streamsValue', { n: formatNumber(allowance.maxStreams, locale) })}
        />
        <Figure
          label={t('media.figure.downloads')}
          value={allowance.downloads ? t('media.figure.downloadsOn') : t('media.figure.downloadsOff')}
        />
        <Figure
          label={t('media.figure.bitrate')}
          value={
            allowance.remoteBitrateMbit === null
              ? formatBitrate(null, locale, t)
              : t('media.figure.bitrateUpTo', { rate: formatBitrate(allowance.remoteBitrateMbit, locale, t) })
          }
        />
      </dl>
      <div>
        <p className="mb-1.5 text-xs text-muted">{t('media.figure.libraries')}</p>
        <LibraryChips libraries={allowance.libraries} />
      </div>
      <p className="text-xs text-muted">{t('media.allowance.streamsHint')}</p>
      {allowance.customers > 0 && (
        <p className="text-xs text-muted">
          {t('media.allowance.toCustomers', { n: allowance.customerAccounts })}
        </p>
      )}
      {extra}
      {(showCode || (showInstance && allowance.provider)) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border pt-3 text-sm text-muted">
          {showInstance && allowance.provider && (
            <>
              <span>{t('media.instance')}:</span>
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
            </>
          )}
          {showCode && (
            <span className={cn('inline-flex items-center gap-1.5', showInstance && 'sm:ml-auto')}>
              {t('media.allowance.code')}:{' '}
              <Mono className="font-medium text-text">{allowance.accountCode}</Mono>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
