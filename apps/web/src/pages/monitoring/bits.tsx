import { SearchX } from 'lucide-react';
import {
  MONITOR_DEFAULT_INTERVAL_SECONDS,
  MONITOR_INTERVAL_CHOICES,
  MONITOR_MAX_INTERVAL_SECONDS,
  MONITOR_MIN_INTERVAL_SECONDS,
  MONITOR_NAME_MAX,
  MONITOR_STATUS_CODE_PATTERN,
  monitorTargetIssues,
  type MetricRange,
  type MonitorAllowanceDto,
  type MonitorConfig,
  type MonitorDto,
  type MonitorHistoryPoint,
  type MonitorHistoryRange,
  type MonitorInputIssue,
  type MonitorKind,
  type MonitorStatus,
  type MonitorTargetInput,
} from '@weblion/shared';
import type { TranslationKey } from '@/i18n/de';
import { ApiError, errorMessage } from '@/lib/api';
import type { CreateMonitorInput, MonitorPatchInput } from '@/lib/api/monitoring';
import { cn } from '@/lib/cn';
import { formatRelative, type Locale } from '@/lib/format';
import { useI18n, type TFunction } from '@/lib/i18n';
import { Badge, Card, EmptyState, ErrorState, Mono } from '@/components/ui/primitives';

/** Shared pieces of the monitoring pages (customer list and detail, related card, admin area). */

const intl = (locale: Locale) => (locale === 'de' ? 'de-CH' : 'en-GB');

// --- Status ------------------------------------------------------------------------------

const STATUS_STYLE: Record<MonitorStatus, { dot: string; text: string }> = {
  up: { dot: 'bg-success', text: 'text-success' },
  down: { dot: 'bg-danger', text: 'text-danger' },
  pending: { dot: 'bg-warning', text: 'text-warning' },
  maintenance: { dot: 'bg-brand-blue', text: 'text-primary-text' },
  paused: { dot: 'bg-border-strong', text: 'text-muted' },
  unknown: { dot: 'border border-border-strong bg-transparent', text: 'text-subtle' },
};

/** Dot and label: up green, down red, pending amber, maintenance blue, paused grey, unknown outlined. */
export function MonitorStatusBadge({ status, className }: { status: MonitorStatus; className?: string }) {
  const { t } = useI18n();
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.unknown;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 text-sm font-medium whitespace-nowrap',
        s.text,
        className,
      )}
    >
      <span className={cn('inline-block size-2.5 shrink-0 rounded-full', s.dot)} aria-hidden />
      {t(`uptime.status.${status}` as TranslationKey)}
    </span>
  );
}

/** Down first, then by name (like the API orders related monitors). */
export function sortMonitors<T extends Pick<MonitorDto, 'status' | 'name'>>(list: readonly T[]): T[] {
  return [...list].sort(
    (a, b) =>
      Number(b.status === 'down') - Number(a.status === 'down') ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
}

export const STATUS_FILTERS = ['all', 'down', 'up', 'paused'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/** Search over name and target, plus the status filter of the list. */
export function filterMonitors<T extends Pick<MonitorDto, 'status' | 'name' | 'target'>>(
  list: readonly T[],
  q: string,
  status: StatusFilter,
): T[] {
  const needle = q.trim().toLowerCase();
  return list.filter(
    (m) =>
      (status === 'all' || m.status === status) &&
      (!needle || m.name.toLowerCase().includes(needle) || !!m.target?.toLowerCase().includes(needle)),
  );
}

// --- Figures -----------------------------------------------------------------------------

/**
 * Uptime ratio (0..1) as a percentage, floored to two decimals: 0.99996 is 99.99 %, never
 * 100 % unless it is exactly 1. The small epsilon keeps ratios like 0.57 (5699.999... in
 * floating point) at 57.00 %.
 */
export function formatUptime(ratio: number | null | undefined, locale: Locale): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '–';
  const clamped = Math.min(1, Math.max(0, ratio));
  if (clamped === 1) return '100 %';
  const hundredths = Math.floor(clamped * 10_000 + 1e-9) / 100;
  const text = new Intl.NumberFormat(intl(locale), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.min(hundredths, 99.99));
  return `${text} %`;
}

/** Response time in ms ("182 ms"), seconds from one second on ("1.25 s"). */
export function formatResponse(ms: number | null | undefined, locale: Locale): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '–';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  const digits = seconds < 10 ? 2 : 1;
  return `${new Intl.NumberFormat(intl(locale), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(seconds)} s`;
}

export type CertLevel = 'danger' | 'warning' | 'ok';

/** Red when invalid or below 7 days, amber below 21 days, else fine. null without certificate facts. */
export function certLevel(
  days: number | null | undefined,
  valid: boolean | null | undefined,
): CertLevel | null {
  const hasDays = typeof days === 'number' && Number.isFinite(days);
  if (!hasDays && (valid === null || valid === undefined)) return null;
  if (valid === false || (hasDays && days < 7)) return 'danger';
  if (hasDays && days < 21) return 'warning';
  return 'ok';
}

/** Days until the certificate expires, coloured by certLevel. Nothing for checks without TLS. */
export function CertBadge({
  days,
  valid,
  className,
}: {
  days: number | null | undefined;
  valid: boolean | null | undefined;
  className?: string;
}) {
  const { t } = useI18n();
  const level = certLevel(days, valid);
  if (!level) return <span className={cn('text-subtle', className)}>–</span>;
  const hasDays = typeof days === 'number' && Number.isFinite(days);
  const text =
    hasDays && days < 0
      ? t('uptime.cert.expired')
      : hasDays
        ? t(days === 1 ? 'uptime.cert.day' : 'uptime.cert.days', { n: days })
        : t('uptime.cert.invalid');
  if (level === 'ok') return <span className={cn('text-sm text-muted', className)}>{text}</span>;
  return (
    <Badge
      tone={level === 'danger' ? 'danger' : 'warning'}
      className={className}
      title={valid === false ? t('uptime.cert.invalid') : undefined}
    >
      {valid === false && hasDays && days >= 0 ? `${t('uptime.cert.invalid')} · ${text}` : text}
    </Badge>
  );
}

const KINDS: Record<string, TranslationKey> = {
  http: 'uptime.kind.http',
  keyword: 'uptime.kind.keyword',
  ping: 'uptime.kind.ping',
  port: 'uptime.kind.port',
};

/** HTTP(S), Keyword, Ping, Port; other Kuma types as they are, in mono. */
export function KindLabel({ type, className }: { type: string; className?: string }) {
  const { t } = useI18n();
  const key = Object.hasOwn(KINDS, type) ? KINDS[type] : undefined;
  if (key) return <span className={cn('text-sm whitespace-nowrap', className)}>{t(key)}</span>;
  return <Mono className={cn('text-muted', className)}>{type}</Mono>;
}

/** "1 Minute", "20 Sekunden", "1 Stunde". */
export function intervalLabel(t: TFunction, seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return '–';
  if (seconds % 3600 === 0) {
    const n = seconds / 3600;
    return t(n === 1 ? 'uptime.interval.hour' : 'uptime.interval.hours', { n });
  }
  if (seconds % 60 === 0) {
    const n = seconds / 60;
    return t(n === 1 ? 'uptime.interval.minute' : 'uptime.interval.minutes', { n });
  }
  return t(seconds === 1 ? 'uptime.interval.second' : 'uptime.interval.seconds', { n: seconds });
}

/**
 * Interval choices from the allowance's minimum on. A current value outside the list (set in
 * Uptime Kuma) stays selectable, so an edit does not change it unasked.
 */
export function intervalChoices(minSeconds: number, current?: number | null): number[] {
  const floor = Math.max(minSeconds, MONITOR_MIN_INTERVAL_SECONDS);
  const choices: number[] = MONITOR_INTERVAL_CHOICES.filter((c) => c >= floor);
  if (
    typeof current === 'number' &&
    Number.isInteger(current) &&
    current <= MONITOR_MAX_INTERVAL_SECONDS &&
    !choices.includes(current)
  ) {
    choices.push(current);
    choices.sort((a, b) => a - b);
  }
  return choices;
}

/** "200-299, 301" to ["200-299", "301"]; null when an entry is no status code or range (1 to 10 entries). */
export function parseStatusCodes(text: string): string[] | null {
  const codes = text
    .split(/[,;\s]+/)
    .map((c) => c.trim())
    .filter(Boolean);
  if (codes.length === 0 || codes.length > 10) return null;
  if (!codes.every((c) => MONITOR_STATUS_CODE_PATTERN.test(c))) return null;
  return [...new Set(codes)];
}

/** Monitors the organization may still create on its allowance. */
export const freeMonitorSlots = (allowance: Pick<MonitorAllowanceDto, 'maxMonitors' | 'committed'>) =>
  Math.max(0, allowance.maxMonitors - allowance.committed);

// --- History -----------------------------------------------------------------------------

/** The chart's axis format: single checks and 24 h by the hour, 7 d and 30 d by the day. */
export const CHART_RANGE: Record<MonitorHistoryRange, MetricRange> = {
  recent: 'hour',
  '24h': 'day',
  '7d': 'week',
  '30d': 'month',
};

/** 24 h when available, else the last checks of the status page, else the first one there is. */
export function defaultHistoryRange(ranges: readonly MonitorHistoryRange[]): MonitorHistoryRange | null {
  if (ranges.includes('24h')) return '24h';
  if (ranges.includes('recent')) return 'recent';
  return ranges[0] ?? null;
}

export type StripTone = 'down' | 'up' | 'maintenance' | 'none';

/** One cell of the availability strip: red with any failed check, green with a good one, blue for maintenance only. */
export function stripTone(point: Pick<MonitorHistoryPoint, 'up' | 'down' | 'maintenance'>): StripTone {
  if (point.down > 0) return 'down';
  if (point.up > 0) return 'up';
  if (point.maintenance > 0) return 'maintenance';
  return 'none';
}

const STRIP_CLASS: Record<StripTone, string> = {
  down: 'bg-danger',
  up: 'bg-success',
  maintenance: 'bg-brand-blue',
  none: 'bg-surface-3',
};

/** A thin bar under the chart, one cell per point of the history. */
export function AvailabilityStrip({ points }: { points: MonitorHistoryPoint[] }) {
  const { t, locale } = useI18n();
  if (points.length === 0) return null;
  const time = new Intl.DateTimeFormat(intl(locale), { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <div
      className="flex h-2 w-full gap-px overflow-hidden rounded-sm"
      aria-label={t('uptime.strip')}
      role="img"
    >
      {points.map((p) => {
        const tone = stripTone(p);
        return (
          <span
            key={p.t}
            className={cn('h-full min-w-0 flex-1', STRIP_CLASS[tone])}
            title={`${time.format(new Date(p.t * 1000))}: ${t(`uptime.strip.${tone}` as TranslationKey)}`}
          />
        );
      })}
    </div>
  );
}

// --- Missing rows ------------------------------------------------------------------------

/** Rows the instance did not report in the last sync: paused, deleted, or Uptime Kuma restarting. */
export function MissingHint({
  missingSince,
  active,
  className,
}: {
  missingSince: string | null;
  active: boolean | null;
  className?: string;
}) {
  const { t, locale } = useI18n();
  if (!missingSince) return null;
  const when = formatRelative(missingSince, locale);
  return (
    <p className={cn('text-xs text-warning', className)}>
      {active === false ? t('uptime.missing.paused', { when }) : t('uptime.missing.text', { when })}
    </p>
  );
}

/** Instances (provider connections) the monitors come from. */
export const instanceCount = (monitors: readonly Pick<MonitorDto, 'provider'>[]) =>
  new Set(monitors.map((m) => m.provider.id)).size;

/** Targets only link out when they are http(s) addresses. */
export function targetHref(target: string | null | undefined): string | null {
  return target && /^https?:\/\//i.test(target) ? target : null;
}

// --- Errors ------------------------------------------------------------------------------

/** The field the API names for a validation error (details[0].path), if any. */
export function errorPath(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 400 || !Array.isArray(err.details)) return null;
  const path = (err.details[0] as { path?: unknown } | undefined)?.path;
  return typeof path === 'string' && path ? (path.split('.')[0] ?? null) : null;
}

/** The API's message for that field (details[0].message). */
export function errorDetail(err: unknown): string | null {
  if (!(err instanceof ApiError) || !Array.isArray(err.details)) return null;
  const message = (err.details[0] as { message?: unknown } | undefined)?.message;
  return typeof message === 'string' && message ? message : null;
}

/** Codes of the monitoring API whose refusal reads better in the user's language. */
const ERROR_CODES: Record<string, TranslationKey> = {
  monitor_limit: 'uptime.error.monitor_limit',
  no_allowance: 'uptime.error.no_allowance',
  read_only_monitor: 'uptime.error.read_only_monitor',
  totp_required: 'uptime.error.totp_required',
  totp_invalid: 'uptime.error.totp_invalid',
};

/**
 * Error text for toasts and forms: the monitoring codes of the API in the user's language
 * (with the API's figures after the summary for a full allowance), everything else (validation,
 * Uptime Kuma's own texts) as the API says it.
 */
export function monitorErrorText(t: TFunction, err: unknown): string {
  if (err instanceof ApiError) {
    const key = ERROR_CODES[err.code];
    if (key) return err.code === 'monitor_limit' ? `${t(key)} ${err.message}` : t(key);
  }
  return errorMessage(err);
}

export function useMonitorError(): (err: unknown) => string {
  const { t } = useI18n();
  return (err) => monitorErrorText(t, err);
}

/** The shared target checks in the user's language (the shared helper speaks English). */
export function targetIssueText(t: TFunction, issue: MonitorInputIssue): string {
  switch (issue.path) {
    case 'url':
      if (/user name|password/i.test(issue.message)) return t('uptime.form.urlCredentials');
      if (/at most/i.test(issue.message)) return t('uptime.form.urlTooLong');
      return t('uptime.form.urlInvalid');
    case 'keyword':
      return /at most/i.test(issue.message)
        ? t('uptime.form.keywordTooLong')
        : t('uptime.form.keywordRequired');
    case 'hostname':
      return t('uptime.form.hostnameInvalid');
    case 'port':
      return t('uptime.form.portInvalid');
  }
}

/**
 * Error of the detail page. The API answers 404 for monitors the user may not see, which reads
 * better as a plain "not found" than as the raw API message.
 */
export function MonitorDetailError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useI18n();
  if (error instanceof ApiError && error.status === 404) {
    return (
      <Card>
        <EmptyState
          icon={<SearchX className="size-6" />}
          title={t('uptime.notFound')}
          description={t('hosting.notFound.text')}
        />
      </Card>
    );
  }
  return <ErrorState error={error} onRetry={onRetry} />;
}

// --- Form --------------------------------------------------------------------------------

/** What the create and edit dialog holds; numbers stay text until they are checked. */
export interface MonitorFormState {
  kind: MonitorKind;
  name: string;
  url: string;
  hostname: string;
  port: string;
  keyword: string;
  invertKeyword: boolean;
  intervalSeconds: number;
  method: 'GET' | 'HEAD';
  /** Comma separated, e.g. "200-299, 301". */
  statusCodes: string;
  ignoreTls: boolean;
}

export type MonitorFormField =
  'name' | 'url' | 'hostname' | 'port' | 'keyword' | 'intervalSeconds' | 'acceptedStatusCodes';

export const isWebKind = (kind: MonitorKind) => kind === 'http' || kind === 'keyword';

/** A new HTTP(S) monitor checking every minute, or at the allowance's minimum when that is longer. */
export function emptyMonitorForm(minIntervalSeconds: number): MonitorFormState {
  const choices = intervalChoices(minIntervalSeconds);
  return {
    kind: 'http',
    name: '',
    url: 'https://',
    hostname: '',
    port: '',
    keyword: '',
    invertKeyword: false,
    intervalSeconds: choices.includes(MONITOR_DEFAULT_INTERVAL_SECONDS)
      ? MONITOR_DEFAULT_INTERVAL_SECONDS
      : (choices[0] ?? MONITOR_DEFAULT_INTERVAL_SECONDS),
    method: 'GET',
    statusCodes: '200-299',
    ignoreTls: false,
  };
}

/** The form of an existing monitor, from its configuration in Uptime Kuma when it was readable. */
export function monitorFormFrom(
  monitor: Pick<MonitorDto, 'kind' | 'name' | 'intervalSeconds'>,
  config: MonitorConfig | null,
): MonitorFormState {
  return {
    kind: monitor.kind ?? 'http',
    name: monitor.name,
    url: config?.url ?? '',
    hostname: config?.hostname ?? '',
    port: config?.port !== null && config?.port !== undefined ? String(config.port) : '',
    keyword: config?.keyword ?? '',
    invertKeyword: config?.invertKeyword ?? false,
    intervalSeconds: config?.intervalSeconds ?? monitor.intervalSeconds ?? MONITOR_DEFAULT_INTERVAL_SECONDS,
    method: config?.method?.toUpperCase() === 'HEAD' ? 'HEAD' : 'GET',
    statusCodes: (config?.acceptedStatusCodes.length ? config.acceptedStatusCodes : ['200-299']).join(', '),
    ignoreTls: config?.ignoreTls ?? false,
  };
}

const parsePort = (value: string): number | null => (/^\d{1,5}$/.test(value.trim()) ? Number(value) : null);

/** The target fields of the form's kind, as the shared checks take them. */
export function formTarget(form: MonitorFormState): MonitorTargetInput {
  const web = isWebKind(form.kind);
  return {
    kind: form.kind,
    url: web ? form.url.trim() : null,
    hostname: web ? null : form.hostname.trim(),
    port: form.kind === 'port' ? parsePort(form.port) : null,
    keyword: form.kind === 'keyword' ? form.keyword : null,
  };
}

/**
 * Problems of the form, per field, in the user's language. `targetEditable` is false while the
 * configuration in Uptime Kuma cannot be read: then only name and interval change.
 */
export function monitorFormIssues(
  t: TFunction,
  form: MonitorFormState,
  targetEditable = true,
): Partial<Record<MonitorFormField, string>> {
  const issues: Partial<Record<MonitorFormField, string>> = {};
  const name = form.name.trim();
  if (!name) issues.name = t('uptime.form.nameRequired');
  else if (name.length > MONITOR_NAME_MAX)
    issues.name = t('uptime.form.nameTooLong', { n: MONITOR_NAME_MAX });
  else if (/[\u0000-\u001f\u007f]/.test(name)) issues.name = t('uptime.form.nameInvalid');
  if (!targetEditable) return issues;
  for (const issue of monitorTargetIssues(formTarget(form))) {
    issues[issue.path] ??= targetIssueText(t, issue);
  }
  if (isWebKind(form.kind) && !parseStatusCodes(form.statusCodes)) {
    issues.acceptedStatusCodes = t('uptime.form.statusCodesInvalid');
  }
  return issues;
}

/** The body of a new monitor: only the fields of its kind. */
export function createMonitorBody(form: MonitorFormState): CreateMonitorInput {
  const target = formTarget(form);
  const web = isWebKind(form.kind);
  return {
    kind: form.kind,
    name: form.name.trim(),
    ...(web ? { url: target.url } : { hostname: target.hostname }),
    ...(form.kind === 'port' ? { port: target.port } : {}),
    ...(form.kind === 'keyword' ? { keyword: form.keyword, invertKeyword: form.invertKeyword } : {}),
    ...(web
      ? {
          method: form.method,
          acceptedStatusCodes: parseStatusCodes(form.statusCodes) ?? ['200-299'],
          ignoreTls: form.ignoreTls,
        }
      : {}),
    intervalSeconds: form.intervalSeconds,
  };
}

/**
 * What changed against the form the dialog started with. Unchanged fields are left out: the
 * address Uptime Kuma reports has secret-looking query values masked, and sending it back would
 * store the mask. Target fields only when `targetEditable`.
 */
export function monitorPatch(
  initial: MonitorFormState,
  form: MonitorFormState,
  targetEditable = true,
): MonitorPatchInput {
  const patch: MonitorPatchInput = {};
  if (form.name.trim() !== initial.name.trim()) patch.name = form.name.trim();
  if (form.intervalSeconds !== initial.intervalSeconds) patch.intervalSeconds = form.intervalSeconds;
  if (!targetEditable) return patch;
  const web = isWebKind(form.kind);
  if (web && form.url.trim() !== initial.url.trim()) patch.url = form.url.trim();
  if (!web && form.hostname.trim() !== initial.hostname.trim()) patch.hostname = form.hostname.trim();
  if (form.kind === 'port' && form.port.trim() !== initial.port.trim()) patch.port = parsePort(form.port);
  if (form.kind === 'keyword') {
    if (form.keyword !== initial.keyword) patch.keyword = form.keyword;
    if (form.invertKeyword !== initial.invertKeyword) patch.invertKeyword = form.invertKeyword;
  }
  if (web) {
    if (form.method !== initial.method) patch.method = form.method;
    const codes = parseStatusCodes(form.statusCodes);
    const before = parseStatusCodes(initial.statusCodes);
    if (codes && codes.join(',') !== (before ?? []).join(',')) patch.acceptedStatusCodes = codes;
    if (form.ignoreTls !== initial.ignoreTls) patch.ignoreTls = form.ignoreTls;
  }
  return patch;
}
