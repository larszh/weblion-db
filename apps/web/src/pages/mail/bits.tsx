import { useId, type ReactNode } from 'react';
import { Check, SearchX, X } from 'lucide-react';
import {
  MAIL_PASSWORD_MAX,
  MAIL_PASSWORD_MIN,
  mailPasswordIssues,
  type Location,
  type MailDomainDto,
  type MailDomainLimits,
  type MailDomainUsage,
  type MailLimitDetails,
  type MailPasswordIssue,
  type MailPasswordPolicy,
  type MailRateLimit,
  type MailboxState,
} from '@weblion/shared';
import { ApiError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatNumber, type Locale } from '@/lib/format';
import { useI18n, type TFunction } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  Badge,
  Card,
  CopyButton,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Mono,
  Notice,
  Select,
  UsageBar,
} from '@/components/ui/primitives';
import { Flag } from '@/components/server-bits';
import { SIZE_UNITS, formatMailSize, type SizeUnit, type SizeValue } from './units';

/** Shared pieces of the e-mail pages (customer views, admin tab and dashboard card). */

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/** Gone at Mailcow, relay domain, inactive or active. */
export function mailDomainStatus(
  t: TFunction,
  domain: Pick<MailDomainDto, 'active' | 'relay' | 'missingSince'>,
): { tone: Tone; label: string } {
  if (domain.missingSince) return { tone: 'danger', label: t('mail.status.missing') };
  if (domain.relay) return { tone: 'info', label: t('mail.status.relay') };
  if (!domain.active) return { tone: 'neutral', label: t('mail.status.inactive') };
  return { tone: 'success', label: t('mail.status.active') };
}

export function MailDomainStatusBadge({
  domain,
}: {
  domain: Pick<MailDomainDto, 'active' | 'relay' | 'missingSince'>;
}) {
  const { t } = useI18n();
  const s = mailDomainStatus(t, domain);
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const STATE_TONE: Record<MailboxState, Tone> = {
  active: 'success',
  login_disabled: 'warning',
  inactive: 'neutral',
};

export function MailboxStateBadge({ state }: { state: MailboxState }) {
  const { t } = useI18n();
  return <Badge tone={STATE_TONE[state]}>{t(`mail.state.${state}`)}</Badge>;
}

/** Unicode name, with the ASCII form Mailcow uses below it when they differ (IDN). */
export function MailDomainName({
  name,
  asciiName,
  className,
}: {
  name: string;
  asciiName: string;
  className?: string;
}) {
  return (
    <span className={cn('block min-w-0', className)}>
      <span className="block truncate font-medium text-text">{name}</span>
      {asciiName !== name && <Mono className="block truncate text-xs text-muted">{asciiName}</Mono>}
    </span>
  );
}

/** "3 von 10". */
export const countOf = (t: TFunction, locale: Locale, n: number, max: number) =>
  t('mail.count.of', { n: formatNumber(n, locale), max: formatNumber(max, locale) });

/** Share of the domain's storage that is handed out to mailboxes, in percent. */
export const allocatedPercent = (limits: MailDomainLimits, usage: MailDomainUsage) =>
  limits.quotaBytes > 0 ? (usage.allocatedBytes / limits.quotaBytes) * 100 : 0;

/** Storage of a mail domain: what the mailboxes are given of the domain's storage, and what they store. */
export function StorageUsage({
  limits,
  usage,
  className,
}: {
  limits: MailDomainLimits | null;
  usage: MailDomainUsage | null;
  className?: string;
}) {
  const { t, locale } = useI18n();
  if (!limits || !usage) return <span className="text-subtle">–</span>;
  return (
    <div className={cn('min-w-[170px]', className)}>
      <div className="text-xs whitespace-nowrap text-muted tabular">
        {t('mail.storage.allocated', {
          allocated: formatMailSize(usage.allocatedBytes, locale),
          quota: formatMailSize(limits.quotaBytes, locale),
        })}
      </div>
      <UsageBar value={allocatedPercent(limits, usage)} className="mt-1" />
      <div className="mt-1 text-xs whitespace-nowrap text-subtle tabular">
        {t('mail.storage.used', { used: formatMailSize(usage.usedBytes, locale) })}
      </div>
    </div>
  );
}

/** Usage of one mailbox against its size. A size of 0 has no limit (created outside the panel). */
export function MailboxUsage({
  usedBytes,
  quotaBytes,
  className,
}: {
  usedBytes: number;
  quotaBytes: number;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const used = formatMailSize(usedBytes, locale);
  const over = quotaBytes > 0 && usedBytes > quotaBytes;
  return (
    <div className={cn('min-w-[140px]', className)}>
      <div
        className={cn('text-xs whitespace-nowrap tabular', over ? 'font-medium text-danger' : 'text-muted')}
      >
        {quotaBytes === 0
          ? t('mail.mailbox.usageUnlimited', { used })
          : t('mail.mailbox.usage', { used, quota: formatMailSize(quotaBytes, locale) })}
      </div>
      {quotaBytes > 0 && <UsageBar value={(usedBytes / quotaBytes) * 100} className="mt-1" />}
    </div>
  );
}

/** Flag and city of the instance; the name (and mail host where known) on hover. */
export function MailServer({
  location,
  title,
  className,
}: {
  location: Location;
  title?: string;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-sm', className)} title={title}>
      <Flag country={location.country} />
      <span className="truncate">{location.city ?? location.label}</span>
    </span>
  );
}

/** "500 Nachrichten pro Stunde", or "keines". */
export function rateLimitText(t: TFunction, locale: Locale, rate: MailRateLimit | null): string {
  if (!rate) return t('mail.rate.none');
  return t('mail.rate.value', {
    n: formatNumber(rate.value, locale),
    frame: t(`mail.rate.frame.${rate.frame}`),
  });
}

/**
 * Error of the detail page. The API answers 404 for mail domains the user may not see,
 * which reads better as a plain "not found" than as the raw API message.
 */
export function MailDetailError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useI18n();
  if (error instanceof ApiError && error.status === 404) {
    return (
      <Card>
        <EmptyState
          icon={<SearchX className="size-6" />}
          title={t('mail.notFound')}
          description={t('hosting.notFound.text')}
        />
      </Card>
    );
  }
  return <ErrorState error={error} onRetry={onRetry} />;
}

const isLimitDetails = (value: unknown): value is MailLimitDetails => {
  const d = value as Partial<MailLimitDetails> | null;
  return (
    !!d &&
    typeof d.max === 'number' &&
    typeof d.used === 'number' &&
    (d.limit === 'mailboxes' || d.limit === 'aliases' || d.limit === 'storage' || d.limit === 'mailboxSize')
  );
};

/**
 * Error text for a toast: the panel's limit checks (409 "mail_limit") and the refused delete
 * of a non-empty domain read in the user's language, everything else as the API says it.
 */
export function mailErrorText(t: TFunction, locale: Locale, err: unknown): string {
  if (err instanceof ApiError && err.code === 'mail_limit' && isLimitDetails(err.details)) {
    const d = err.details;
    switch (d.limit) {
      case 'mailboxes':
        return t('mail.limit.mailboxes', { max: formatNumber(d.max, locale) });
      case 'aliases':
        return t('mail.limit.aliases', { max: formatNumber(d.max, locale) });
      case 'storage':
        return t('mail.limit.storage', {
          max: formatMailSize(d.max, locale),
          used: formatMailSize(d.used, locale),
        });
      case 'mailboxSize':
        return t('mail.limit.mailboxSize', { max: formatMailSize(d.max, locale) });
    }
  }
  if (err instanceof ApiError && err.code === 'domain_not_empty') {
    const n = (err.details as { mailboxes?: unknown } | null)?.mailboxes;
    if (typeof n === 'number') return t('mail.admin.deleteNotEmpty', { n });
  }
  return errorMessage(err);
}

export function useMailError(): (err: unknown) => string {
  const { t, locale } = useI18n();
  return (err) => mailErrorText(t, locale, err);
}

// --- Size input ------------------------------------------------------------------------

/** A number with the unit MB or GB (binary). The value is kept as typed; see toMib. */
export function SizeInput({
  id,
  size,
  onChange,
  invalid,
  disabled,
  placeholder,
}: {
  id: string;
  size: SizeValue;
  onChange: (size: SizeValue) => void;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={size.value}
        onChange={(e) => onChange({ ...size, value: e.target.value })}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid}
        className="w-32 tabular"
      />
      <Select
        value={size.unit}
        onChange={(e) => onChange({ ...size, unit: e.target.value as SizeUnit })}
        disabled={disabled}
        className="w-20"
        aria-label={t('mail.units.unit')}
      >
        {SIZE_UNITS.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </Select>
    </div>
  );
}

// --- Passwords -------------------------------------------------------------------------

export type PasswordMode = 'generate' | 'choose';

/** The panel's own rules when Mailcow's policy cannot be read (as in mailPasswordIssues). */
const PANEL_POLICY: MailPasswordPolicy = {
  minLength: 0,
  letters: true,
  mixedCase: true,
  digits: true,
  specialChars: false,
};

/** Whether a chosen password may be sent: no issue left and the repetition matches. */
export const passwordReady = (
  mode: PasswordMode,
  password: string,
  repeat: string,
  policy: MailPasswordPolicy | null,
) => mode === 'generate' || (mailPasswordIssues(password, policy).length === 0 && password === repeat);

/** The rules that apply, one line each; length, ASCII and maximum only when relevant. */
function passwordRules(
  t: TFunction,
  password: string,
  policy: MailPasswordPolicy | null,
): { key: MailPasswordIssue; label: string; ok: boolean }[] {
  const p = policy ?? PANEL_POLICY;
  const issues = new Set(mailPasswordIssues(password, policy));
  const rules: { key: MailPasswordIssue; label: string }[] = [
    { key: 'length', label: t('mail.password.rule.length', { n: Math.max(MAIL_PASSWORD_MIN, p.minLength) }) },
  ];
  if (p.letters) rules.push({ key: 'letters', label: t('mail.password.rule.letters') });
  if (p.mixedCase) rules.push({ key: 'mixedCase', label: t('mail.password.rule.mixedCase') });
  if (p.digits) rules.push({ key: 'digits', label: t('mail.password.rule.digits') });
  if (p.specialChars) rules.push({ key: 'specialChars', label: t('mail.password.rule.specialChars') });
  if (issues.has('characters')) rules.push({ key: 'characters', label: t('mail.password.rule.characters') });
  if (issues.has('tooLong'))
    rules.push({ key: 'tooLong', label: t('mail.password.rule.tooLong', { n: MAIL_PASSWORD_MAX }) });
  return rules.map((r) => ({ ...r, ok: !issues.has(r.key) }));
}

/** "Sicheres Passwort erzeugen" (default) or "Passwort selbst festlegen" with a checklist. */
export function PasswordChoice({
  mode,
  onMode,
  password,
  onPassword,
  repeat,
  onRepeat,
  policy,
}: {
  mode: PasswordMode;
  onMode: (mode: PasswordMode) => void;
  password: string;
  onPassword: (value: string) => void;
  repeat: string;
  onRepeat: (value: string) => void;
  policy: MailPasswordPolicy | null;
}) {
  const { t } = useI18n();
  const id = useId();
  const rules = passwordRules(t, password, policy);
  const mismatch = repeat !== '' && repeat !== password;
  return (
    <fieldset className="space-y-3">
      <legend className="mb-1.5 text-[13px] font-medium text-text">{t('mail.password.label')}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {(['generate', 'choose'] as const).map((value) => (
          <label
            key={value}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors',
              mode === value
                ? 'border-brand-blue bg-primary-soft text-primary-text'
                : 'border-border-strong text-text hover:bg-surface-3',
            )}
          >
            <input
              type="radio"
              name={`${id}-mode`}
              value={value}
              checked={mode === value}
              onChange={() => onMode(value)}
              className="mt-1 size-4 accent-[var(--primary)]"
            />
            <span className="min-w-0">
              <span className="block font-medium">{t(`mail.password.${value}`)}</span>
              <span className={cn('mt-0.5 block text-xs', mode === value ? 'opacity-90' : 'text-muted')}>
                {t(`mail.password.${value}Text`)}
              </span>
            </span>
          </label>
        ))}
      </div>
      {mode === 'choose' && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('mail.password.new')} htmlFor={`${id}-pw`}>
              <Input
                id={`${id}-pw`}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => onPassword(e.target.value)}
                maxLength={MAIL_PASSWORD_MAX + 1}
              />
            </Field>
            <Field
              label={t('mail.password.repeat')}
              htmlFor={`${id}-repeat`}
              error={mismatch ? t('mail.password.mismatch') : undefined}
            >
              <Input
                id={`${id}-repeat`}
                type="password"
                autoComplete="new-password"
                value={repeat}
                onChange={(e) => onRepeat(e.target.value)}
                maxLength={MAIL_PASSWORD_MAX + 1}
                aria-invalid={mismatch}
              />
            </Field>
          </div>
          <ul className="space-y-1 text-xs" aria-label={t('mail.password.rules')}>
            {rules.map((r) => (
              <li
                key={r.key}
                className={cn('flex items-center gap-1.5', r.ok ? 'text-success' : 'text-muted')}
              >
                {r.ok ? <Check className="size-3.5" aria-hidden /> : <X className="size-3.5" aria-hidden />}
                {r.label}
              </li>
            ))}
          </ul>
          {!policy && <p className="text-xs text-muted">{t('mail.password.noPolicy')}</p>}
        </div>
      )}
    </fieldset>
  );
}

export interface ShownMailPassword {
  title: string;
  address: string;
  password: string;
  /** Mail server for IMAP and SMTP, null when unknown. */
  mailHost: string | null;
}

/**
 * A generated mailbox password, shown once with the address above it and the server below.
 * The console never stores it.
 */
export function MailPasswordDialog({
  shown,
  onClose,
}: {
  shown: ShownMailPassword | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      open={!!shown}
      onOpenChange={(o) => !o && onClose()}
      title={shown?.title ?? t('password.newTitle')}
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('common.done')}
        </Button>
      }
    >
      {shown && (
        <div className="space-y-3">
          <InfoRow label={t('mail.col.address')} value={shown.address} />
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
            <Mono className="text-base break-all text-text">{shown.password}</Mono>
            <CopyButton value={shown.password} />
          </div>
          <Notice tone="warning">{t('password.newText')}</Notice>
          {shown.mailHost && (
            <div className="space-y-1.5 border-t border-border pt-3">
              <InfoRow label={t('mail.client.imapHost')} value={shown.mailHost} />
              <InfoRow label={t('mail.client.smtpHost')} value={shown.mailHost} />
              <p className="text-xs text-muted">{t('mail.client.username')}</p>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

function InfoRow({ label, value }: { label: ReactNode; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted">{label}</span>
      <span className="flex min-w-0 items-center gap-1">
        <Mono className="truncate text-text">{value}</Mono>
        <CopyButton value={value} />
      </span>
    </div>
  );
}
