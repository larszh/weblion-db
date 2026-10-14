import { Link } from 'react-router-dom';
import { SearchX } from 'lucide-react';
import {
  PHONE_EMAIL_MAX_LENGTH,
  PHONE_EXTENSION_MAX_DIGITS,
  PHONE_EXTENSION_MIN_DIGITS,
  PHONE_LANGUAGES,
  PHONE_LICENSE_WARN_DAYS,
  PHONE_NAME_MAX_LENGTH,
  isValidExtension,
  isValidExternalNumber,
  normalizeExternalNumber,
  type Permission,
  type PhoneEdition,
  type PhoneLanguage,
  type PhoneRingGroup,
  type PhoneStatusReason,
  type PhoneSystemInfo,
  type PhoneSystemStatus,
  type PhoneUser,
  type PhoneUserCreateBody,
  type PhoneUserDto,
  type PhoneUserPatchBody,
} from '@weblion/shared';
import { ApiError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatNumber, type Locale } from '@/lib/format';
import { useI18n, type TFunction } from '@/lib/i18n';
import { Badge, Card, EmptyState, ErrorState, Notice, UsageBar } from '@/components/ui/primitives';

/** Shared pieces of the telephony pages (customer views, admin page and dashboard card). */

type Tone = 'neutral' | 'success' | 'warning' | 'danger';

export const PHONE_STATUS_TONE: Record<PhoneSystemStatus, Tone> = {
  ok: 'success',
  warning: 'warning',
  error: 'danger',
  unknown: 'neutral',
};

/** Reasons that make a phone system an error (as in phoneSystemHealth); the others warn. */
export const PHONE_ERROR_REASONS: readonly PhoneStatusReason[] = [
  'unreachable',
  'not_activated',
  'license_inactive',
  'license_expired',
];

export const reasonTone = (reason: PhoneStatusReason): 'danger' | 'warning' =>
  PHONE_ERROR_REASONS.includes(reason) ? 'danger' : 'warning';

/** Errors first, then warnings, each in the order the API sent them. */
export const sortReasons = (reasons: readonly PhoneStatusReason[]): PhoneStatusReason[] =>
  [...reasons].sort((a, b) => Number(reasonTone(a) === 'warning') - Number(reasonTone(b) === 'warning'));

const DAY = 86_400_000;

/** "3 / 16", "3" without a maximum, "–" when unknown. */
export function ofMax(n: number | null | undefined, max: number | null | undefined, locale: Locale): string {
  if (n === null || n === undefined) return '–';
  if (max === null || max === undefined) return formatNumber(n, locale);
  return `${formatNumber(n, locale)} / ${formatNumber(max, locale)}`;
}

/** Share of `max` for a usage bar, null when either is unknown or there is no maximum. */
export function percentOf(n: number | null | undefined, max: number | null | undefined): number | null {
  if (n === null || n === undefined || max === null || max === undefined || max <= 0) return null;
  return Math.min(100, Math.max(0, (n / max) * 100));
}

/** Display name, else first and last name, else the extension number. */
export function phoneUserName(
  user: Pick<PhoneUser, 'displayName' | 'firstName' | 'lastName' | 'number'>,
): string {
  const display = user.displayName?.trim();
  if (display) return display;
  const name = [user.firstName, user.lastName]
    .map((v) => v?.trim())
    .filter(Boolean)
    .join(' ');
  return name || user.number;
}

export const isPhoneLanguage = (value: string | null | undefined): value is PhoneLanguage =>
  !!value && (PHONE_LANGUAGES as readonly string[]).includes(value);

/** The languages the panel offers by name; null is the PBX's default, others as reported. */
export function languageLabel(t: TFunction, code: string | null | undefined): string {
  const value = code?.trim().toLowerCase() ?? '';
  if (!value) return t('phone.user.language.default');
  return isPhoneLanguage(value) ? t(`phone.language.${value}`) : value;
}

export type LicenseState = 'none' | 'valid' | 'expiring' | 'expired';

/** Expired, within the warning window of phoneSystemHealth (PHONE_LICENSE_WARN_DAYS), or valid. */
export function licenseState(
  expiresAt: string | null | undefined,
  warnDays: number,
  now = Date.now(),
): LicenseState {
  const at = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  if (Number.isNaN(at)) return 'none';
  if (at <= now) return 'expired';
  return at - now <= warnDays * DAY ? 'expiring' : 'valid';
}

/** Client side search of the users tab: extension, names and e-mail address. */
export function matchesPhoneUser(user: PhoneUser, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [user.number, user.displayName, user.firstName, user.lastName, user.email].some((v) =>
    v?.toLowerCase().includes(needle),
  );
}

/** Users that can join a ring group: people that are not a member yet, by extension. */
export function ringGroupCandidates(
  users: PhoneUserDto[],
  group: Pick<PhoneRingGroup, 'members'>,
): PhoneUserDto[] {
  const members = new Set(group.members.map((m) => m.number));
  return users
    .filter((u) => !u.system && !members.has(u.number))
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
}

/** "101 Ben Beispiel": the PBX's name of the member, else the user's name, else the number only. */
export function memberLabel(
  member: PhoneRingGroup['members'][number],
  users: PhoneUser[] | undefined,
): string {
  const user = users?.find((u) => u.number === member.number);
  const name = member.name?.trim() || (user ? phoneUserName(user) : '');
  return name && name !== member.number ? `${member.number} ${name}` : member.number;
}

/** "800 Zentrale" for toasts and dialog titles. */
export const ringGroupLabel = (group: Pick<PhoneRingGroup, 'number' | 'name'>) =>
  [group.number, group.name?.trim()].filter(Boolean).join(' ');

// --- Permissions -----------------------------------------------------------------------

/**
 * Administrators of the PBX and system users (fax, AI agents) are protected: only weblion staff
 * (platform:provider:write) delete them or change their e-mail address. The API checks the same.
 */
const mayTouch = (user: Pick<PhoneUserDto, 'protected'>, platform: readonly Permission[]) =>
  !user.protected || platform.includes('platform:provider:write');

export const canDeletePhoneUser = (
  user: Pick<PhoneUserDto, 'protected'>,
  system: readonly Permission[],
  platform: readonly Permission[],
) => system.includes('phone:write') && mayTouch(user, platform);

/** The PBX sends access mails to this address, so changing it needs phone:credentials. */
export const canChangePhoneEmail = (
  user: Pick<PhoneUserDto, 'protected'>,
  system: readonly Permission[],
  platform: readonly Permission[],
) => system.includes('phone:credentials') && mayTouch(user, platform);

// --- User form -------------------------------------------------------------------------

export interface PhoneUserForm {
  number: string;
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  outboundCallerId: string;
  /** "" = the PBX's default. Edit: a code outside PHONE_LANGUAGES stays as the PBX has it. */
  language: string;
  sendWelcome: boolean;
}

export const PHONE_USER_FIELDS = [
  'number',
  'firstName',
  'lastName',
  'email',
  'mobile',
  'outboundCallerId',
  'language',
] as const;
export type PhoneUserField = (typeof PHONE_USER_FIELDS)[number];

export type PhoneUserIssue = 'required' | 'tooLong' | 'invalid';
export type PhoneUserIssues = Partial<Record<PhoneUserField, PhoneUserIssue>>;

/** The API takes external numbers with separators up to this length before it cleans them. */
const EXTERNAL_RAW_MAX = 40;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const emptyPhoneUserForm = (number = ''): PhoneUserForm => ({
  number,
  firstName: '',
  lastName: '',
  email: '',
  mobile: '',
  outboundCallerId: '',
  language: '',
  sendWelcome: true,
});

export const phoneUserFormFrom = (user: PhoneUser): PhoneUserForm => ({
  number: user.number,
  firstName: user.firstName ?? '',
  lastName: user.lastName ?? '',
  email: user.email ?? '',
  mobile: user.mobile ?? '',
  outboundCallerId: user.outboundCallerId ?? '',
  language: user.language?.trim().toLowerCase() ?? '',
  sendWelcome: false,
});

function externalIssue(value: string): PhoneUserIssue | undefined {
  if (value.length > EXTERNAL_RAW_MAX) return 'tooLong';
  const normalized = normalizeExternalNumber(value);
  return normalized !== null && !isValidExternalNumber(normalized) ? 'invalid' : undefined;
}

/**
 * Client side checks with the shared rules, the same the API applies. Create: `original` is
 * null and the number is checked (empty lets the PBX pick). Edit: only what the user may change
 * and what differs from `original`; an empty first name or e-mail address and an external number
 * the PBX already has are kept.
 */
export function phoneUserFormIssues(
  form: PhoneUserForm,
  numberLength: number | null,
  original: PhoneUser | null = null,
  emailEditable = true,
): PhoneUserIssues {
  const issues: PhoneUserIssues = {};
  if (!original) {
    const number = form.number.trim();
    if (number && !isValidExtension(number, numberLength)) issues.number = 'invalid';
  }
  const first = form.firstName.trim();
  if (first.length > PHONE_NAME_MAX_LENGTH) issues.firstName = 'tooLong';
  else if (!first && (!original || (original.firstName ?? '').trim() !== '')) issues.firstName = 'required';
  if (form.lastName.trim().length > PHONE_NAME_MAX_LENGTH) issues.lastName = 'tooLong';
  if (emailEditable) {
    const email = form.email.trim();
    const unchanged = !!original && email.toLowerCase() === (original.email ?? '').toLowerCase();
    if (!unchanged) {
      if (!email) issues.email = 'required';
      else if (email.length > PHONE_EMAIL_MAX_LENGTH) issues.email = 'tooLong';
      else if (!EMAIL_PATTERN.test(email)) issues.email = 'invalid';
    }
  }
  // A number the PBX already has is kept as it is, even when the panel would not take it.
  const same = (value: string, current: string | null) =>
    !!original && normalizeExternalNumber(value) === normalizeExternalNumber(current);
  const mobile = same(form.mobile, original?.mobile ?? null) ? undefined : externalIssue(form.mobile);
  if (mobile) issues.mobile = mobile;
  const outbound = same(form.outboundCallerId, original?.outboundCallerId ?? null)
    ? undefined
    : externalIssue(form.outboundCallerId);
  if (outbound) issues.outboundCallerId = outbound;
  return issues;
}

/** Body of POST /phone-systems/:id/users: empty optional fields are null, an empty number is left out. */
export function phoneUserCreateBody(form: PhoneUserForm): PhoneUserCreateBody {
  const number = form.number.trim();
  return {
    ...(number ? { number } : {}),
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim() || null,
    email: form.email.trim().toLowerCase(),
    mobile: normalizeExternalNumber(form.mobile),
    outboundCallerId: normalizeExternalNumber(form.outboundCallerId),
    language: isPhoneLanguage(form.language) ? form.language : null,
    sendWelcome: form.sendWelcome,
  };
}

/** Body of PATCH /phone-systems/:id/users/:userId: only the fields that differ from `user`. */
export function phoneUserPatchBody(
  user: PhoneUser,
  form: PhoneUserForm,
  emailEditable: boolean,
): PhoneUserPatchBody {
  const patch: PhoneUserPatchBody = {};
  const firstName = form.firstName.trim();
  if (firstName && firstName !== (user.firstName ?? '').trim()) patch.firstName = firstName;
  const lastName = form.lastName.trim() || null;
  if (lastName !== ((user.lastName ?? '').trim() || null)) patch.lastName = lastName;
  const email = form.email.trim().toLowerCase();
  if (emailEditable && email && email !== (user.email ?? '').toLowerCase()) patch.email = email;
  const mobile = normalizeExternalNumber(form.mobile);
  if (mobile !== normalizeExternalNumber(user.mobile)) patch.mobile = mobile;
  const outbound = normalizeExternalNumber(form.outboundCallerId);
  if (outbound !== normalizeExternalNumber(user.outboundCallerId)) patch.outboundCallerId = outbound;
  const language = form.language.trim().toLowerCase() || null;
  if (language !== (user.language?.trim().toLowerCase() || null)) {
    // A code the panel does not offer cannot be chosen, only kept.
    if (language === null) patch.language = null;
    else if (isPhoneLanguage(language)) patch.language = language;
  }
  return patch;
}

/** 3CX property names in the PBX's validation answers (details.target), by form field. */
const XAPI_FIELDS: Record<string, PhoneUserField> = {
  number: 'number',
  firstname: 'firstName',
  lastname: 'lastName',
  emailaddress: 'email',
  mobile: 'mobile',
  outboundcallerid: 'outboundCallerId',
  language: 'language',
};

const asField = (value: unknown): PhoneUserField | null => {
  if (typeof value !== 'string') return null;
  const head = value.split('.')[0] ?? '';
  return (PHONE_USER_FIELDS as readonly string[]).includes(head) ? (head as PhoneUserField) : null;
};

/**
 * The form field an API error belongs to, or null for a general error: the panel's field
 * errors (details `[{ path }]`), the PBX's refusals of a property (details `{ target }`), and a
 * taken extension number (409 "The extension number ... is in use").
 */
export function phoneErrorField(err: unknown): PhoneUserField | null {
  if (!(err instanceof ApiError)) return null;
  if (err.status === 409 && err.code === 'conflict' && /extension number/i.test(err.message)) return 'number';
  if (err.status !== 400) return null;
  const d = err.details as unknown;
  if (Array.isArray(d)) {
    for (const entry of d) {
      const field = asField((entry as { path?: unknown } | null)?.path);
      if (field) return field;
    }
    return null;
  }
  if (d && typeof d === 'object') {
    const target = (d as { target?: unknown }).target;
    if (typeof target === 'string') return XAPI_FIELDS[target.trim().toLowerCase()] ?? null;
  }
  return null;
}

/** Text of a client side issue at its field. */
export function phoneIssueText(
  t: TFunction,
  field: PhoneUserField,
  issue: PhoneUserIssue,
  numberLength: number | null,
): string {
  if (field === 'number') return numberRuleText(t, numberLength, 'invalid');
  if (field === 'email') {
    if (issue === 'required') return t('phone.user.emailRequired');
    if (issue === 'tooLong') return t('phone.user.tooLong', { max: PHONE_EMAIL_MAX_LENGTH });
    return t('phone.user.emailInvalid');
  }
  if (field === 'mobile' || field === 'outboundCallerId') {
    return issue === 'tooLong'
      ? t('phone.user.tooLong', { max: EXTERNAL_RAW_MAX })
      : t('phone.user.externalInvalid');
  }
  if (issue === 'required') return t('phone.user.firstNameRequired');
  return t('phone.user.tooLong', { max: PHONE_NAME_MAX_LENGTH });
}

/** "3 Ziffern" or "2 bis 10 Ziffern", as hint or as error. */
export function numberRuleText(t: TFunction, numberLength: number | null, kind: 'hint' | 'invalid'): string {
  const exact = numberLength !== null && numberLength > 0;
  if (kind === 'hint') {
    return exact
      ? t('phone.user.numberHint', { n: numberLength })
      : t('phone.user.numberHintRange', { min: PHONE_EXTENSION_MIN_DIGITS, max: PHONE_EXTENSION_MAX_DIGITS });
  }
  return exact
    ? t('phone.user.numberInvalid', { n: numberLength })
    : t('phone.user.numberInvalidRange', {
        min: PHONE_EXTENSION_MIN_DIGITS,
        max: PHONE_EXTENSION_MAX_DIGITS,
      });
}

/**
 * Text of an API error at its field: the panel's own checks in the user's language, a taken
 * number as such, the PBX's refusals as the API words them (they carry the PBX's reason).
 */
export function phoneServerFieldText(
  t: TFunction,
  err: unknown,
  field: PhoneUserField,
  numberLength: number | null,
): string {
  if (!(err instanceof ApiError)) return errorMessage(err);
  if (err.status === 409) return t('phone.user.numberTaken');
  if (!Array.isArray(err.details)) return err.message;
  if (field === 'number') return numberRuleText(t, numberLength, 'invalid');
  if (field === 'email') return t('phone.user.emailInvalid');
  if (field === 'mobile' || field === 'outboundCallerId') return t('phone.user.externalInvalid');
  return errorMessage(err);
}

/** Error text for a toast: the license limit reads in the user's language, the rest as the API says it. */
export function phoneErrorText(t: TFunction, err: unknown): string {
  if (err instanceof ApiError && err.code === 'phone_user_limit') return t('phone.user.limitReached');
  return errorMessage(err);
}

export function usePhoneError(): (err: unknown) => string {
  const { t } = useI18n();
  return (err) => phoneErrorText(t, err);
}

// --- Components ------------------------------------------------------------------------

export function PhoneStatusBadge({
  status,
  missing,
  className,
}: {
  status: PhoneSystemStatus;
  /** missingSince of the phone system: the provider does not report it any more. */
  missing?: string | null;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1.5', className)}>
      <Badge tone={PHONE_STATUS_TONE[status]}>{t(`phone.status.${status}`)}</Badge>
      {missing && <Badge tone="danger">{t('phone.missing')}</Badge>}
    </span>
  );
}

/** One line per reason, errors red, warnings yellow. */
export function StatusReasons({ reasons, className }: { reasons: PhoneStatusReason[]; className?: string }) {
  const { t } = useI18n();
  if (reasons.length === 0) return null;
  const sorted = sortReasons(reasons);
  return (
    <div className={cn('space-y-2', className)}>
      {sorted.map((reason) => (
        <Notice key={reason} tone={reasonTone(reason)}>
          {reasonText(t, reason)}
        </Notice>
      ))}
    </div>
  );
}

export function reasonText(t: TFunction, reason: PhoneStatusReason): string {
  return reason === 'license_expiring'
    ? t('phone.reason.license_expiring', { days: PHONE_LICENSE_WARN_DAYS })
    : t(`phone.reason.${reason}`);
}

export function editionLabel(t: TFunction, edition: PhoneEdition | null | undefined): string {
  return edition ? t(`phone.edition.${edition}`) : '–';
}

export function EditionLabel({
  edition,
  productCode,
}: {
  edition: PhoneEdition | null;
  productCode?: string | null;
}) {
  const { t } = useI18n();
  return (
    <span>
      {editionLabel(t, edition)}
      {productCode && <span className="text-muted"> · {productCode}</span>}
    </span>
  );
}

/** "bis 31.01.2027", warning colour within 30 days, "abgelaufen" in red when past. */
export function LicenseText({
  expiresAt,
  className,
  prefix = true,
}: {
  expiresAt: string | null | undefined;
  className?: string;
  /** "bis" before the date (lists and cards); off where the label already says it. */
  prefix?: boolean;
}) {
  const { t, locale } = useI18n();
  const state = licenseState(expiresAt, PHONE_LICENSE_WARN_DAYS);
  if (state === 'none' || !expiresAt) return <span className={cn('text-subtle', className)}>–</span>;
  const date = formatDate(expiresAt, locale, false);
  if (state === 'expired') {
    return (
      <span className={cn('font-medium text-danger', className)}>{t('phone.license.expired', { date })}</span>
    );
  }
  return (
    <span className={cn(state === 'expiring' && 'font-medium text-warning', className)}>
      {prefix ? t('phone.license.until', { date }) : date}
    </span>
  );
}

/** Calls in progress of what the license allows, with a bar. */
export function CallsMeter({ info, className }: { info: PhoneSystemInfo | null; className?: string }) {
  const { locale } = useI18n();
  const pct = percentOf(info?.activeCalls, info?.maxSimCalls);
  return (
    <div className={cn('min-w-[120px]', className)}>
      <div className="text-sm text-text tabular">{ofMax(info?.activeCalls, info?.maxSimCalls, locale)}</div>
      {pct !== null && <UsageBar value={pct} className="mt-1" />}
    </div>
  );
}

/** Users, with the maximum only when the license enforces one. */
export function UsersFigure({ info, className }: { info: PhoneSystemInfo | null; className?: string }) {
  const { locale } = useI18n();
  const full = !!info && info.maxUsers !== null && info.users !== null && info.users >= info.maxUsers;
  return (
    <span className={cn('tabular', full && 'font-medium text-warning', className)}>
      {ofMax(info?.users, info?.maxUsers, locale)}
    </span>
  );
}

/** Registered trunks of all trunks. */
export function TrunksFigure({ info, className }: { info: PhoneSystemInfo | null; className?: string }) {
  const { locale } = useI18n();
  const down =
    !!info &&
    info.trunksTotal !== null &&
    info.trunksRegistered !== null &&
    info.trunksRegistered < info.trunksTotal;
  return (
    <span className={cn('tabular', down && 'font-medium text-warning', className)}>
      {ofMax(info?.trunksRegistered, info?.trunksTotal, locale)}
    </span>
  );
}

/** Green dot "Angemeldet" or grey "Nicht angemeldet"; nothing when the PBX does not say. */
export function RegisteredDot({ registered }: { registered: boolean | null }) {
  const { t } = useI18n();
  if (registered === null) return <span className="text-subtle">–</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm whitespace-nowrap">
      <span
        className={cn('size-2 rounded-full', registered ? 'bg-success' : 'bg-border-strong')}
        aria-hidden
      />
      {registered ? t('phone.user.registered') : t('phone.user.notRegistered')}
    </span>
  );
}

/**
 * Error of the detail page. The API answers 404 for phone systems the user may not see, which
 * reads better as a plain "not found" with the way back than as the raw API message.
 */
export function PhoneDetailError({
  error,
  onRetry,
  back,
}: {
  error: unknown;
  onRetry: () => void;
  back: string;
}) {
  const { t } = useI18n();
  if (error instanceof ApiError && error.status === 404) {
    return (
      <Card>
        <EmptyState
          icon={<SearchX className="size-6" />}
          title={t('phone.notFound')}
          description={t('hosting.notFound.text')}
          action={
            <Link to={back} className="text-sm font-medium text-primary-text hover:underline">
              {t('phone.backToList')}
            </Link>
          }
        />
      </Card>
    );
  }
  return <ErrorState error={error} onRetry={onRetry} />;
}
