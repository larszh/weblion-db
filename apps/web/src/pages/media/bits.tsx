import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  MEDIA_MAX_BITRATE_MBIT,
  MEDIA_REQUESTS_DEFAULT,
  MEDIA_REQUEST_QUOTA_DAYS_MAX,
  MEDIA_REQUEST_QUOTA_MAX,
  mediaActivityDay,
  mediaRequestsExceed,
  normalizeMediaRequests,
  normalizeQuickConnectCode,
  type MediaConnectError,
  type MediaAccess,
  type MediaAccountDto,
  type MediaAccountIssue,
  type MediaAccountRequestsDto,
  type MediaAllowanceDto,
  type MediaLibraryRef,
  type MediaRequestQuota,
  type MediaRequestsAccess,
  type MediaRequestsConflict,
} from '@weblion/shared';
import type { TranslationKey } from '@weblion/shared';
import { ApiError } from '@/lib/api';
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
  seerr_missing: {
    label: 'media.issue.seerr_missing',
    text: 'media.issue.seerr_missing.text',
    tone: 'warning',
  },
  seerr_drift: { label: 'media.issue.seerr_drift', text: 'media.issue.seerr_drift.text', tone: 'warning' },
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

// --- Connect a TV (Quick Connect) -----------------------------------------------------

/**
 * The code field of "Fernseher verbinden": the code to send (null while it is none) and whether
 * to say so yet. Incomplete input is no error; letters, a 7th digit or a leading 0 are.
 */
export function quickConnectField(value: string): { code: string | null; invalid: boolean } {
  const code = normalizeQuickConnectCode(value);
  const digits = value.replace(/[\s-]/g, '');
  return { code, invalid: code === null && (/\D/.test(digits) || digits.length >= 6) };
}

const CONNECT_ERROR: Record<MediaConnectError, TranslationKey> = {
  quick_connect_code: 'media.connect.error.code',
  quick_connect_off: 'media.connect.error.off',
  quick_connect_failed: 'media.connect.error.failed',
  stream_limit: 'media.connect.error.limit',
  account_disabled: 'media.connect.error.disabled',
};

/** The text of a refused connection; null for errors that bring their own message. */
export function connectErrorKey(err: unknown): TranslationKey | null {
  if (!(err instanceof ApiError)) return null;
  if (err.status === 429) return 'media.connect.error.tooMany';
  if (err.status !== 409) return null;
  return (CONNECT_ERROR as Partial<Record<string, TranslationKey>>)[err.code] ?? null;
}

/** MaxActiveSessions from the details of a 409 "stream_limit", for the text; null otherwise. */
export function streamLimitOf(err: unknown): number | null {
  if (!(err instanceof ApiError) || err.code !== 'stream_limit') return null;
  const max = (err.details as { maxStreams?: unknown } | undefined)?.maxStreams;
  return typeof max === 'number' && Number.isFinite(max) ? max : null;
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

// --- Requests (Seerr add-on) ------------------------------------------------------------

export type MediaRequestType = 'movies' | 'tv';
export const REQUEST_TYPES: readonly MediaRequestType[] = ['movies', 'tv'];

const quotaOf = (access: MediaRequestsAccess, type: MediaRequestType): MediaRequestQuota | null =>
  type === 'movies' ? access.movieQuota : access.tvQuota;

/** What one type of the add-on allows: "bis 5 Filme in 30 Tagen pro Zugang", "ohne Grenze" or "nicht enthalten". */
export function requestTypeText(
  t: TFunction,
  type: MediaRequestType,
  access: MediaRequestsAccess | null,
): string {
  if (!access?.[type]) return t('media.requests.notIncluded');
  const quota = quotaOf(access, type);
  if (!quota) return t('media.requests.unlimited');
  return t(type === 'movies' ? 'media.requests.movieQuota' : 'media.requests.tvQuota', {
    limit: quota.limit,
    days: quota.days,
  });
}

/** The types of the add-on in one phrase: "Filme und Serien", "Filme" or "Serien". */
export function requestTypesText(t: TFunction, access: MediaRequestsAccess): string {
  if (access.movies && access.tv) return t('media.requests.figureBoth');
  return access.movies ? t('media.requests.movies') : t('media.requests.tv');
}

/**
 * Quota used by one account, one line per type with a limit ("Filme: 2 von 5"). Empty when no
 * included type has a limit. A number the sync has not read yet shows as "–".
 */
export function requestQuotaUsage(
  t: TFunction,
  access: MediaRequestsAccess,
  counts: MediaAccountRequestsDto | null,
): string[] {
  const lines: string[] = [];
  if (access.movies && access.movieQuota) {
    lines.push(
      t('media.requests.quotaMovies', { used: counts?.movieUsed ?? '–', limit: access.movieQuota.limit }),
    );
  }
  if (access.tv && access.tvQuota) {
    lines.push(
      t('media.requests.quotaSeasons', { used: counts?.tvUsed ?? '–', limit: access.tvQuota.limit }),
    );
  }
  return lines;
}

/** The add-on as the allowance dialogs edit it: a limit per type or none, as typed. */
export interface MediaRequestsForm {
  on: boolean;
  movies: boolean;
  tv: boolean;
  movieLimited: boolean;
  movieLimit: string;
  movieDays: string;
  tvLimited: boolean;
  tvLimit: string;
  tvDays: string;
}

/**
 * The form for an add-on (null: off). Types that are off, and the add-on while it is off, start
 * from `defaults`: the standard suggestion for staff, the reseller's own add-on for a reseller.
 */
export function mediaRequestsFormFrom(
  value: MediaRequestsAccess | null,
  defaults: MediaRequestsAccess = MEDIA_REQUESTS_DEFAULT,
): MediaRequestsForm {
  const start = (type: MediaRequestType) => {
    const quota = value?.[type] ? quotaOf(value, type) : quotaOf(defaults, type);
    // Without a limit the inputs still hold a sensible number for when a limit is chosen.
    const shown = quota ?? quotaOf(defaults, type) ?? quotaOf(MEDIA_REQUESTS_DEFAULT, type)!;
    return { limited: quota !== null, limit: String(shown.limit), days: String(shown.days) };
  };
  const movie = start('movies');
  const tv = start('tv');
  return {
    on: value !== null,
    movies: value ? value.movies : defaults.movies,
    tv: value ? value.tv : defaults.tv,
    movieLimited: movie.limited,
    movieLimit: movie.limit,
    movieDays: movie.days,
    tvLimited: tv.limited,
    tvLimit: tv.limit,
    tvDays: tv.days,
  };
}

export type MediaRequestsErrors = Record<
  'types' | 'movies' | 'movieLimit' | 'movieDays' | 'tv' | 'tvLimit' | 'tvDays',
  string | null
>;

const NO_REQUEST_ERRORS: MediaRequestsErrors = {
  types: null,
  movies: null,
  movieLimit: null,
  movieDays: null,
  tv: null,
  tvLimit: null,
  tvDays: null,
};

/** A whole number from 1 to max, or null. */
const readRange = (value: string, max: number): number | null => {
  const n = parseCount(value);
  return n !== null && n <= max ? n : null;
};

/**
 * The add-on to send (null: off) and the error of each field; `valid` false while something is
 * wrong. "No requests" is the add-on off, never a limit of 0 (Seerr reads 0 as no limit).
 * `cap`: a reseller's own add-on, which a customer cannot exceed (null: the reseller has none);
 * undefined for staff.
 */
export function readMediaRequestsForm(
  t: TFunction,
  form: MediaRequestsForm,
  cap?: MediaRequestsAccess | null,
): {
  value: MediaRequestsAccess | null;
  valid: boolean;
  errors: MediaRequestsErrors;
  conflicts: MediaRequestsConflict[];
} {
  if (!form.on) return { value: null, valid: true, errors: NO_REQUEST_ERRORS, conflicts: [] };
  const errors: MediaRequestsErrors = { ...NO_REQUEST_ERRORS };
  if (!form.movies && !form.tv) errors.types = t('media.requests.typeRequired');
  const readQuota = (type: MediaRequestType): MediaRequestQuota | null => {
    const movies = type === 'movies';
    if (!form[type] || !(movies ? form.movieLimited : form.tvLimited)) return null;
    const limit = readRange(movies ? form.movieLimit : form.tvLimit, MEDIA_REQUEST_QUOTA_MAX);
    const days = readRange(movies ? form.movieDays : form.tvDays, MEDIA_REQUEST_QUOTA_DAYS_MAX);
    if (limit === null) {
      errors[movies ? 'movieLimit' : 'tvLimit'] = t('media.requests.quotaInvalid', {
        max: MEDIA_REQUEST_QUOTA_MAX,
      });
    }
    if (days === null) {
      errors[movies ? 'movieDays' : 'tvDays'] = t('media.requests.daysInvalid', {
        max: MEDIA_REQUEST_QUOTA_DAYS_MAX,
      });
    }
    return limit !== null && days !== null ? { limit, days } : null;
  };
  const movieQuota = readQuota('movies');
  const tvQuota = readQuota('tv');
  const typed = Object.values(errors).every((e) => e === null);
  const value = typed
    ? normalizeMediaRequests({ movies: form.movies, tv: form.tv, movieQuota, tvQuota })
    : null;
  const conflicts = value && cap !== undefined ? mediaRequestsExceed(value, cap) : [];
  const capped = t('media.reseller.requestsCap');
  if (conflicts.includes('requestsMovies') || conflicts.includes('movieQuota')) errors.movies = capped;
  if (conflicts.includes('requestsTv') || conflicts.includes('tvQuota')) errors.tv = capped;
  const valid = typed && conflicts.length === 0;
  return { value: valid ? value : null, valid, errors, conflicts };
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
 * network, the requests add-on (where the caller sees it and it is on, with the totals in the
 * admin and reseller views), the libraries and the instance. Used on the customer page and in
 * the admin and reseller cards.
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
  const requests = allowance.requests ?? null;
  // Totals belong to the admin and reseller views, and only while the add-on is on.
  const totals = requests ? allowance.requestTotals : undefined;
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
        {/* Only where the caller sees the add-on and it is on (absent or null: nothing of it). */}
        {requests && (
          <div className="col-span-2 min-w-0">
            <dt className="truncate text-xs text-muted">{t('media.requests.figure')}</dt>
            <dd className="mt-0.5 text-lg leading-snug font-semibold break-words text-text">
              {requestTypesText(t, requests)}
            </dd>
            <dd className="mt-0.5 space-y-0.5 text-xs text-muted">
              {REQUEST_TYPES.filter((type) => requests[type]).map((type) => (
                <p key={type}>
                  {t(type === 'movies' ? 'media.requests.movies' : 'media.requests.tv')}:{' '}
                  {requestTypeText(t, type, requests)}
                </p>
              ))}
              {totals && (
                <p>
                  {t('media.requests.totals', {
                    pending: formatNumber(totals.pending, locale),
                    approved: formatNumber(totals.approved, locale),
                    available: formatNumber(totals.available, locale),
                  })}
                </p>
              )}
            </dd>
          </div>
        )}
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
