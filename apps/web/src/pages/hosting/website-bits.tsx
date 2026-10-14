import { useId, type ReactNode } from 'react';
import { Check, ShieldAlert, ShieldCheck, ShieldX, X } from 'lucide-react';
import {
  SITE_USER_PATTERN,
  WEBSITE_DB_SUFFIX_PATTERN,
  websiteDatabaseName,
  websiteDatabasePrefix,
  websiteDomainAscii,
  websitePasswordIssues,
  type CreatableWebsiteType,
  type Location,
  type WebsiteAllowanceDto,
  type WebsiteCertificate,
  type WebsiteDnsCheckDto,
  type WebsiteDnsStatus,
  type WebsiteFacts,
  type WebspaceDto,
} from '@weblion/shared';
import { ApiError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatBytes, formatDate, formatNumber, formatRelative, type Locale } from '@/lib/format';
import { useI18n, type TFunction } from '@/lib/i18n';
import { Tooltip } from '@/components/ui/menu';
import { Badge, CopyButton, Field, Input, Mono } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Flag, ProviderBadge } from '@/components/server-bits';

/**
 * Shared pieces of the website pages (customer list and detail, admin and reseller cards):
 * pure helpers (tested in website-bits.test.ts) and the small components built on them.
 */

const DAY = 86_400_000;

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

// --- Certificate -----------------------------------------------------------------------

/**
 * none: the server reports no certificate. invalid: the self-signed certificate CloudPanel
 * gives every new site, which browsers do not trust. letsEncrypt / other: a certificate with
 * its expiry (other = another issuer, e.g. one the operator imported, or issuer unknown).
 */
export type CertificateKind = 'none' | 'invalid' | 'letsEncrypt' | 'other';

export interface CertificateState {
  kind: CertificateKind;
  /** ok from 30 days on, warning below 30 days, danger below 14 days, expired, invalid or none. */
  level: 'ok' | 'warning' | 'danger';
  expiresAt: string | null;
  /** Whole days left (negative once expired), null when the expiry is not known. */
  days: number | null;
}

/**
 * Publicly trusted certificates are valid for at most 398 days (CA/Browser Forum), CloudPanel's
 * self-signed one for ten years. The server only says "not Let's Encrypt", so a certificate of
 * another issuer that runs longer than this (or has no known expiry) counts as self-signed.
 */
export const TRUSTED_MAX_DAYS = 398;

export function certificateState(cert: WebsiteCertificate | null, now = Date.now()): CertificateState {
  if (!cert) return { kind: 'none', level: 'danger', expiresAt: null, days: null };
  const expires = cert.expiresAt ? Date.parse(cert.expiresAt) : Number.NaN;
  const known = Number.isFinite(expires);
  const left = expires - now;
  if (cert.letsEncrypt === false && (!known || left > TRUSTED_MAX_DAYS * DAY)) {
    return { kind: 'invalid', level: 'danger', expiresAt: cert.expiresAt, days: null };
  }
  const kind: CertificateKind = cert.letsEncrypt ? 'letsEncrypt' : 'other';
  if (!known) return { kind, level: 'ok', expiresAt: null, days: null };
  const level = left < 14 * DAY ? 'danger' : left < 30 * DAY ? 'warning' : 'ok';
  return { kind, level, expiresAt: cert.expiresAt, days: Math.floor(left / DAY) };
}

const CERT_TEXT_TONE = {
  ok: 'text-text',
  warning: 'font-medium text-warning',
  danger: 'font-medium text-danger',
};

/** "Let's Encrypt bis 9.1.2027", amber below 30 days, red below 14 days or without a valid certificate. */
export function CertificateText({
  certificate,
  className,
  icon,
}: {
  certificate: WebsiteCertificate | null;
  className?: string;
  icon?: boolean;
}) {
  const { t, locale } = useI18n();
  const s = certificateState(certificate);
  const date = formatDate(s.expiresAt, locale, false);
  const text =
    s.kind === 'none'
      ? t('websites.ssl.none')
      : s.kind === 'invalid'
        ? t('websites.ssl.invalid')
        : s.days !== null && s.days < 0
          ? t('websites.ssl.expired', { date })
          : !s.expiresAt
            ? s.kind === 'letsEncrypt'
              ? t('websites.ssl.letsEncryptOnly')
              : t('websites.ssl.unknownExpiry')
            : s.kind === 'letsEncrypt'
              ? t('websites.ssl.letsEncrypt', { date })
              : t('websites.ssl.until', { date });
  const Icon = s.level === 'ok' ? ShieldCheck : s.level === 'warning' ? ShieldAlert : ShieldX;
  const tip =
    s.kind === 'invalid'
      ? t('websites.ssl.invalidHint')
      : s.kind === 'none'
        ? t('websites.ssl.noneHint')
        : s.days !== null && s.days >= 0 && s.level !== 'ok'
          ? t('websites.ssl.daysLeft', { days: s.days })
          : null;
  const content = (
    <span className={cn('inline-flex items-center gap-1.5', CERT_TEXT_TONE[s.level], className)}>
      {icon && <Icon className="size-3.5 shrink-0" aria-hidden />}
      {text}
    </span>
  );
  return tip ? <Tooltip content={tip}>{content}</Tooltip> : content;
}

// --- Type, status, usage ---------------------------------------------------------------

/** "PHP 8.4 · WordPress", "Statisch", "Node.js 22". */
export function websiteTypeLabel(
  t: TFunction,
  site: Pick<WebsiteFacts, 'type' | 'phpVersion' | 'nodejsVersion' | 'application'>,
): string {
  switch (site.type) {
    case 'php':
      return [site.phpVersion ? `PHP ${site.phpVersion}` : 'PHP', site.application]
        .filter(Boolean)
        .join(' · ');
    case 'nodejs':
      return site.nodejsVersion ? `Node.js ${site.nodejsVersion}` : 'Node.js';
    default:
      return t(`websites.type.${site.type}`);
  }
}

export function WebsiteTypeBadge({ site }: { site: WebsiteFacts | null }) {
  const { t } = useI18n();
  if (!site) return null;
  return <Badge tone="info">{websiteTypeLabel(t, site)}</Badge>;
}

/** Badges for a website that is not simply active: creating, deleting, unknown state, missing. */
export function WebsiteStatusBadges({ website }: { website: Pick<WebspaceDto, 'status' | 'missingSince'> }) {
  const { t } = useI18n();
  return (
    <>
      {website.status !== 'active' && (
        <Badge tone={website.status === 'error' ? 'danger' : 'warning'}>
          {t(`websites.status.${website.status}`)}
        </Badge>
      )}
      {website.missingSince && <Badge tone="danger">{t('websites.status.missing')}</Badge>}
    </>
  );
}

/** Files plus databases, null while the server has not measured anything yet. */
export function websiteUsageBytes(site: Pick<WebsiteFacts, 'diskBytes' | 'databaseBytes'>): number | null {
  if (site.diskBytes === null && site.databaseBytes === null) return null;
  return (site.diskBytes ?? 0) + (site.databaseBytes ?? 0);
}

/** "865 MB · gemessen vor 3 Stunden", or "noch nicht gemessen". */
export function usageText(
  t: TFunction,
  locale: Locale,
  site: Pick<WebsiteFacts, 'diskBytes' | 'databaseBytes' | 'usageMeasuredAt'>,
): string {
  const bytes = websiteUsageBytes(site);
  if (bytes === null) return t('websites.usage.notMeasured');
  return site.usageMeasuredAt
    ? t('websites.usage.measured', {
        size: formatBytes(bytes),
        when: formatRelative(site.usageMeasuredAt, locale),
      })
    : formatBytes(bytes);
}

/** Flag and city of the CloudPanel instance a website lives on. */
export function InstanceLocation({ location, className }: { location: Location; className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <Flag country={location.country} />
      <span className="truncate">{location.city ?? location.label}</span>
    </span>
  );
}

// --- DNS ---------------------------------------------------------------------------------

export const DNS_STATUS_TONE: Record<WebsiteDnsStatus, Tone> = {
  ok: 'success',
  elsewhere: 'warning',
  missing: 'danger',
  error: 'neutral',
};

export function DnsStatusBadge({ status }: { status: WebsiteDnsStatus }) {
  const { t } = useI18n();
  return <Badge tone={DNS_STATUS_TONE[status]}>{t(`websites.dns.status.${status}`)}</Badge>;
}

/**
 * One spelling per address, so "2001:DB8::10" and "2001:db8:0:0:0:0:0:10" compare equal:
 * lower case, "::" expanded, leading zeros of each group dropped. IPv4 stays as it is.
 */
export function normalizeIp(ip: string): string {
  const value = ip.trim().toLowerCase();
  if (!value.includes(':')) return value;
  const [head = '', tail] = value.split('::');
  const front = head ? head.split(':') : [];
  const back = tail === undefined ? null : tail ? tail.split(':') : [];
  const groups =
    back === null
      ? front
      : [...front, ...Array<string>(Math.max(0, 8 - front.length - back.length)).fill('0'), ...back];
  return groups.map((g) => g.replace(/^0+(?=.)/, '')).join(':');
}

const sameIp = (a: string, b: string) => normalizeIp(a) === normalizeIp(b);

export interface ExpectedDnsRecord {
  name: string;
  type: 'A' | 'AAAA';
  value: string;
  /** Public DNS answers with this address already. */
  present: boolean;
}

/** The A and AAAA records the domain and its www counterpart need, each with "present". */
export function expectedDnsRecords(
  check: Pick<WebsiteDnsCheckDto, 'expected' | 'names'>,
): ExpectedDnsRecord[] {
  return check.names.flatMap((n) => [
    ...check.expected.ipv4.map((ip) => ({
      name: n.name,
      type: 'A' as const,
      value: ip,
      present: n.a.some((a) => sameIp(a, ip)),
    })),
    ...check.expected.ipv6.map((ip) => ({
      name: n.name,
      type: 'AAAA' as const,
      value: ip,
      present: n.aaaa.some((a) => sameIp(a, ip)),
    })),
  ]);
}

/** Addresses public DNS answers that are not the server's (CDN, old host): they must go. */
export function foreignDnsAnswers(check: Pick<WebsiteDnsCheckDto, 'expected' | 'names'>): string[] {
  const expected = [...check.expected.ipv4, ...check.expected.ipv6];
  const foreign = check.names.flatMap((n) =>
    [...n.a, ...n.aaaa].filter((ip) => !expected.some((e) => sameIp(e, ip))),
  );
  return [...new Set(foreign)];
}

/**
 * Why a certificate cannot be issued yet, worst first: a lookup failed, a name points
 * elsewhere, a name has no record. null when both names are fine.
 */
export function dnsBlocker(
  check: Pick<WebsiteDnsCheckDto, 'names' | 'ready'>,
): Exclude<WebsiteDnsStatus, 'ok'> | null {
  if (check.ready) return null;
  for (const status of ['error', 'elsewhere', 'missing'] as const) {
    if (check.names.some((n) => n.status === status)) return status;
  }
  return 'missing';
}

/** Addresses public DNS answers for one name, the server's own ones marked. */
function DnsAnswers({ values, expected }: { values: string[]; expected: string[] }) {
  if (values.length === 0) return <span className="text-subtle">–</span>;
  return (
    <ul className="space-y-0.5">
      {values.map((ip) => {
        const own = expected.some((e) => sameIp(e, ip));
        return (
          <li
            key={ip}
            className={cn('font-mono text-[12.5px] break-all', own ? 'text-text' : 'text-warning')}
          >
            {ip}
          </li>
        );
      })}
    </ul>
  );
}

/** What public DNS answers for the domain and its www counterpart, with a status per name. */
export function DnsCheckTable({ check }: { check: WebsiteDnsCheckDto }) {
  const { t } = useI18n();
  return (
    <Table>
      <THead>
        <tr>
          <TH>{t('websites.dns.name')}</TH>
          <TH>A</TH>
          <TH>AAAA</TH>
          <TH>{t('websites.dns.statusCol')}</TH>
        </tr>
      </THead>
      <TBody>
        {check.names.map((n) => (
          <TR key={n.name}>
            <TD className="align-top">
              <Mono className="break-all text-text">{n.name}</Mono>
            </TD>
            <TD className="align-top">
              <DnsAnswers values={n.a} expected={check.expected.ipv4} />
            </TD>
            <TD className="align-top">
              <DnsAnswers values={n.aaaa} expected={check.expected.ipv6} />
            </TD>
            <TD className="align-top">
              <DnsStatusBadge status={n.status} />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

/** The records to create at the DNS provider, each with a copy button and whether it exists. */
export function ExpectedDnsTable({
  check,
  onlyMissing = false,
}: {
  check: Pick<WebsiteDnsCheckDto, 'expected' | 'names'>;
  onlyMissing?: boolean;
}) {
  const { t } = useI18n();
  const records = expectedDnsRecords(check).filter((r) => !onlyMissing || !r.present);
  if (records.length === 0) return null;
  return (
    <Table>
      <THead>
        <tr>
          <TH>{t('websites.dns.name')}</TH>
          <TH>{t('websites.dns.type')}</TH>
          <TH>{t('websites.dns.value')}</TH>
          {!onlyMissing && <TH>{t('websites.dns.statusCol')}</TH>}
        </tr>
      </THead>
      <TBody>
        {records.map((r) => (
          <TR key={`${r.name} ${r.type} ${r.value}`}>
            <TD>
              <CopyValue value={r.name} />
            </TD>
            <TD className="font-mono text-[12.5px]">{r.type}</TD>
            <TD>
              <CopyValue value={r.value} />
            </TD>
            {!onlyMissing && (
              <TD>
                {r.present ? (
                  <span className="inline-flex items-center gap-1 text-sm text-success">
                    <Check className="size-3.5" aria-hidden /> {t('websites.dns.present')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-sm text-muted">
                    <X className="size-3.5" aria-hidden /> {t('websites.dns.absent')}
                  </span>
                )}
              </TD>
            )}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

// --- Databases ---------------------------------------------------------------------------

export type DatabaseNameIssue = 'siteUser' | 'empty' | 'suffix' | 'length';

/** "shop_mueller_" + suffix as the user types it, with the full name or why there is none. */
export function databaseNamePreview(
  siteUser: string,
  suffix: string,
): { prefix: string; name: string | null; issue: DatabaseNameIssue | null } {
  const prefix = `${websiteDatabasePrefix(siteUser)}_`;
  if (!SITE_USER_PATTERN.test(siteUser)) return { prefix, name: null, issue: 'siteUser' };
  if (!suffix) return { prefix, name: null, issue: 'empty' };
  if (!WEBSITE_DB_SUFFIX_PATTERN.test(suffix)) return { prefix, name: null, issue: 'suffix' };
  const name = websiteDatabaseName(siteUser, suffix);
  return name ? { prefix, name, issue: null } : { prefix, name: null, issue: 'length' };
}

/** WordPress and WooCommerce need a database; the create dialog switches it on for them. */
export const templateWantsDatabase = (template: string | null | undefined) =>
  !!template && /^(wordpress|woocommerce)\b/i.test(template);

/** Suggested suffix: "wp" for WordPress sites, "db" otherwise. */
export const defaultDatabaseSuffix = (template: string | null | undefined) =>
  templateWantsDatabase(template) ? 'wp' : 'db';

// --- Lists and allowances --------------------------------------------------------------

/** Websites first (by name), then web spaces in the order the API sent them. */
export function websitesFirst<T extends Pick<WebspaceDto, 'kind' | 'name'>>(items: T[]): T[] {
  const websites = items.filter((w) => w.kind === 'website').sort((a, b) => a.name.localeCompare(b.name));
  return [...websites, ...items.filter((w) => w.kind !== 'website')];
}

/** What the allowance still has room for (never negative). */
export function allowanceRoom(
  allowance: Pick<WebsiteAllowanceDto, 'maxSites' | 'sites' | 'maxDatabases' | 'databases'>,
) {
  return {
    sites: Math.max(0, allowance.maxSites - allowance.sites),
    databases: Math.max(0, allowance.maxDatabases - allowance.databases),
  };
}

/** A whole number from a form field (0 allowed), or null. */
export function parseCount(value: string, max: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n <= max ? n : null;
}

export const ALLOWANCE_MAX_SITES = 1000;
export const ALLOWANCE_MAX_DATABASES = 5000;

/** "Websites 3 von 5", "Datenbanken 4 von 10", the allowed types and (optionally) the instance. */
export function WebsiteAllowanceFigures({
  allowance,
  showInstance = true,
  extra,
}: {
  allowance: WebsiteAllowanceDto;
  showInstance?: boolean;
  extra?: ReactNode;
}) {
  const { t, locale } = useI18n();
  const n = (value: number) => formatNumber(value, locale);
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <Figure
          label={t('websites.allowance.sites')}
          value={t('websites.allowance.of', { n: n(allowance.sites), max: n(allowance.maxSites) })}
          over={allowance.sites > allowance.maxSites}
        />
        <Figure
          label={t('websites.allowance.databases')}
          value={t('websites.allowance.of', { n: n(allowance.databases), max: n(allowance.maxDatabases) })}
          over={allowance.databases > allowance.maxDatabases}
        />
        <div className="col-span-2 min-w-0 sm:col-span-1">
          <dt className="truncate text-xs text-muted">{t('websites.allowance.types')}</dt>
          <dd className="mt-1 flex flex-wrap gap-1">
            {allowance.siteTypes.map((type) => (
              <Badge key={type} tone="neutral">
                {t(`websites.type.${type}`)}
              </Badge>
            ))}
          </dd>
        </div>
      </dl>
      {allowance.customers > 0 && (
        <p className="text-xs text-muted">
          {t('websites.allowance.customersIncluded', { n: allowance.customers })}
        </p>
      )}
      {extra}
      {showInstance && allowance.provider && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border pt-3 text-sm text-muted">
          <span>{t('websites.allowance.instance')}:</span>
          <span className="inline-flex items-center gap-1.5">
            <ProviderBadge type={allowance.provider.type} name={allowance.provider.name} />
            <span className="font-medium text-text">{allowance.provider.name}</span>
          </span>
          <InstanceLocation location={allowance.provider.location} />
        </div>
      )}
    </div>
  );
}

function Figure({ label, value, over }: { label: string; value: string; over?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-muted">{label}</dt>
      <dd className={cn('mt-0.5 truncate text-lg font-semibold tabular', over ? 'text-danger' : 'text-text')}>
        {value}
      </dd>
    </div>
  );
}

/** Checkboxes for the site types of an allowance. `disabled` types show their reason. */
export function SiteTypeChoice({
  value,
  onChange,
  offered,
  disabled = {},
}: {
  value: CreatableWebsiteType[];
  onChange: (value: CreatableWebsiteType[]) => void;
  offered: readonly CreatableWebsiteType[];
  disabled?: Partial<Record<CreatableWebsiteType, string>>;
}) {
  const { t } = useI18n();
  return (
    <fieldset>
      <legend className="mb-1.5 text-[13px] font-medium text-text">{t('websites.allowance.types')}</legend>
      <div className="space-y-1.5">
        {offered.map((type) => {
          const reason = disabled[type];
          const checked = value.includes(type);
          return (
            <label
              key={type}
              className={cn(
                'flex items-start gap-2.5 text-sm',
                reason && !checked ? 'cursor-not-allowed text-muted' : 'cursor-pointer text-text',
              )}
            >
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-[var(--primary)]"
                checked={checked}
                // A type that is no longer offered can still be removed.
                disabled={!!reason && !checked}
                onChange={(e) =>
                  onChange(e.target.checked ? [...value, type] : value.filter((v) => v !== type))
                }
              />
              <span>
                <span className="block">{t(`websites.type.${type}`)}</span>
                {reason && <span className="block text-xs text-muted">{reason}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

// --- Errors ------------------------------------------------------------------------------

/** Field the API names for an error: details.field (409 exists) or details[0].path (400). */
export function errorField(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const d = err.details as unknown;
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    const field = (d as { field?: unknown }).field;
    if (typeof field === 'string' && field) return field;
  }
  if (Array.isArray(d) && d.length > 0) {
    const path = (d[0] as { path?: unknown } | null)?.path;
    if (typeof path === 'string' && path) return path.split('.')[0] ?? null;
    if (Array.isArray(path) && typeof path[0] === 'string') return path[0];
  }
  return null;
}

/**
 * The server may have finished the change: the API's 502 website_error ("may have been
 * created", the sync settles it) or a 504 timeout. Other failures left everything as it was.
 */
export function outcomeUnknown(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  return err.status === 504 || (err.status === 502 && err.code === 'website_error');
}

const ERROR_CODES = [
  'no_allowance',
  'allowance_exceeded',
  'type_not_allowed',
  'dns_not_ready',
  'website_busy',
  'website_error',
  'website_missing',
  'busy',
  'timeout',
] as const;

const EXISTS_FIELDS = ['domain', 'siteUser', 'database'] as const;

/**
 * Error text for toasts and forms: the website codes of the API in the user's language,
 * everything else (validation, provider texts) as the API says it.
 */
export function websiteErrorText(t: TFunction, err: unknown): string {
  if (err instanceof ApiError) {
    // 502 website_error: the server may have done it; 409 website_error: an earlier change.
    if (err.code === 'website_error' && err.status === 502) return t('websites.errors.unknownOutcomeText');
    const code = ERROR_CODES.find((c) => c === err.code);
    if (code) return t(`websites.errors.${code}`);
    if (err.code === 'exists') {
      const field = EXISTS_FIELDS.find((f) => f === errorField(err));
      if (field) return t(`websites.errors.exists.${field}`);
    }
  }
  return errorMessage(err);
}

export function useWebsiteError(): (err: unknown) => string {
  const { t } = useI18n();
  return (err) => websiteErrorText(t, err);
}

// --- Passwords ---------------------------------------------------------------------------

export type PasswordMode = 'generate' | 'choose';

/** Whether the chosen password may be sent (generated ones always). */
export const passwordReady = (mode: PasswordMode, password: string) =>
  mode === 'generate' || websitePasswordIssues(password).length === 0;

/** "Generieren" (default) or "Eigenes Passwort" with the rules of the server. */
export function WebsitePasswordChoice({
  mode,
  onMode,
  password,
  onPassword,
  label,
}: {
  mode: PasswordMode;
  onMode: (mode: PasswordMode) => void;
  password: string;
  onPassword: (value: string) => void;
  label?: string;
}) {
  const { t } = useI18n();
  const id = useId();
  const issues = websitePasswordIssues(password);
  const rules = [
    { key: 'length', label: t('websites.password.rule.length'), ok: !issues.includes('length') },
    { key: 'characters', label: t('websites.password.rule.characters'), ok: !issues.includes('characters') },
  ];
  return (
    <fieldset className="space-y-3">
      <legend className="mb-1.5 text-[13px] font-medium text-text">
        {label ?? t('websites.password.label')}
      </legend>
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
              <span className="block font-medium">{t(`websites.password.${value}`)}</span>
              <span className={cn('mt-0.5 block text-xs', mode === value ? 'opacity-90' : 'text-muted')}>
                {t(`websites.password.${value}Text`)}
              </span>
            </span>
          </label>
        ))}
      </div>
      {mode === 'choose' && (
        <Field label={t('websites.password.own')} htmlFor={`${id}-pw`}>
          <Input
            id={`${id}-pw`}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => onPassword(e.target.value)}
            maxLength={129}
            className="font-mono"
          />
          <ul className="space-y-1 pt-1 text-xs" aria-label={t('websites.password.rules')}>
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
        </Field>
      )}
    </fieldset>
  );
}

// --- Small display helpers ---------------------------------------------------------------

/** ASCII (punycode) form of a website's domain; the DTO name is the Unicode form. */
export const asciiDomain = (name: string) => websiteDomainAscii(name) ?? name.toLowerCase();

/** The website itself; browsers open IDN domains with their punycode name. */
export const websiteUrl = (name: string) => `https://${asciiDomain(name)}`;

/**
 * The domain as the delete route expects it (Unicode or ASCII form), when the typed text
 * names the website. Case and surrounding blanks do not matter.
 */
export function deleteConfirmValue(typed: string, name: string): string | null {
  const value = typed.trim().toLowerCase();
  if (!value) return null;
  if (value === name.toLowerCase()) return name;
  const ascii = asciiDomain(name);
  return value === ascii ? ascii : null;
}

/** A value in monospace with a copy button, for access data. */
export function CopyValue({ value, className }: { value: string | null | undefined; className?: string }) {
  if (!value) return <span className="text-subtle">–</span>;
  return (
    <span className={cn('inline-flex max-w-full items-start gap-1', className)}>
      <Mono className="min-w-0 break-all text-text">{value}</Mono>
      <CopyButton value={value} className="-mt-0.5" />
    </span>
  );
}

/** "ssh user@host" (with -p for other ports), ready to paste. */
export const sshCommand = (username: string, host: string, port: number) =>
  port === 22 ? `ssh ${username}@${host}` : `ssh -p ${port} ${username}@${host}`;

/** sftp:// link for file managers (FileZilla, Cyberduck, Finder via apps). */
export const sftpUrl = (username: string, host: string, port: number) =>
  port === 22 ? `sftp://${username}@${host}` : `sftp://${username}@${host}:${port}`;

/** SSH tunnel for database tools on the own computer (no phpMyAdmin on the server). */
export const sshTunnelCommand = (username: string, host: string, port: number) =>
  `ssh -L 3306:127.0.0.1:3306 ${port === 22 ? '' : `-p ${port} `}${username}@${host}`;
