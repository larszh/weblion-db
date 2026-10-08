import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Globe, Layers, Mail, MailWarning, Server } from 'lucide-react';
import {
  MODULE_DEFS,
  MODULES,
  type ModuleKey,
  type OrgCounts,
  type OrgKind,
  type OrgStatus,
} from '@weblion/shared';
import { cn } from '@/lib/cn';
import { ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MailResult } from '@/lib/api/admin';
import type { TranslationKey } from '@/i18n/de';
import { Switch } from '@/components/ui/menu';
import { Badge, CopyButton, ErrorState, Mono, Notice } from '@/components/ui/primitives';

/** Shared pieces of the reseller area and the customer management in the admin area. */

// --- Tabs --------------------------------------------------------------------------

export interface TabDef<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  show?: boolean;
}

/** The active tab from ?tab=, falling back to the first visible one. */
export function useTabParam<T extends string>(tabs: TabDef<T>[]): [T, (value: T) => void] {
  const [params, setParams] = useSearchParams();
  const visible = tabs.filter((tab) => tab.show !== false);
  const first = visible[0]?.value as T;
  const requested = params.get('tab');
  const current = visible.find((tab) => tab.value === requested)?.value ?? first;
  const set = (value: T) => {
    const next = new URLSearchParams(params);
    if (value === first) next.delete('tab');
    else next.set('tab', value);
    setParams(next, { replace: true });
  };
  return [current, set];
}

export function TabBar<T extends string>({
  tabs,
  current,
  onChange,
  label,
}: {
  tabs: TabDef<T>[];
  current: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="mb-6 overflow-x-auto border-b border-border">
      <nav className="-mb-px flex min-w-max gap-1" aria-label={label}>
        {tabs
          .filter((tab) => tab.show !== false)
          .map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => onChange(tab.value)}
              className={cn(
                'inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors [&>svg]:size-4',
                current === tab.value
                  ? 'border-brand-blue text-primary-text'
                  : 'border-transparent text-muted hover:border-border-strong hover:text-text',
              )}
              aria-current={current === tab.value ? 'page' : undefined}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
      </nav>
    </div>
  );
}

// --- Organization kind -------------------------------------------------------------

export const kindKey = (kind: OrgKind): TranslationKey => `admin.kind.${kind}`;

export function KindBadge({ kind }: { kind: OrgKind }) {
  const { t } = useI18n();
  return (
    <Badge tone={kind === 'internal' ? 'primary' : kind === 'reseller' ? 'info' : 'neutral'}>
      {t(kindKey(kind))}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: OrgStatus }) {
  const { t } = useI18n();
  return (
    <Badge tone={status === 'active' ? 'success' : 'danger'}>
      {status === 'active' ? t('orgStatus.active') : t('orgStatus.suspended')}
    </Badge>
  );
}

/**
 * Server, domain and web space counts as small icons. Types whose module is off are left
 * out unless something is still attached.
 */
export function ResourceCounts({ counts, modules }: { counts: OrgCounts; modules: ModuleKey[] }) {
  const { t } = useI18n();
  const items = [
    { module: 'servers', icon: <Server />, n: counts.servers, label: t('nav.servers') },
    { module: 'dns', icon: <Globe />, n: counts.domains, label: t('admin.resources.domains') },
    { module: 'webhosting', icon: <Layers />, n: counts.webspaces, label: t('admin.resources.webspaces') },
  ].filter((i) => modules.includes(i.module as ModuleKey) || i.n > 0);
  if (items.length === 0) return <span className="text-subtle">–</span>;
  return (
    <div className="flex items-center gap-3 text-sm text-muted">
      {items.map((i) => (
        <span
          key={i.module}
          className="inline-flex items-center gap-1 tabular [&>svg]:size-3.5"
          title={i.label}
          aria-label={`${i.label}: ${i.n}`}
        >
          {i.icon}
          {i.n}
        </span>
      ))}
    </div>
  );
}

// --- Modules -----------------------------------------------------------------------

export function ModuleBadges({ modules, empty = '–' }: { modules: ModuleKey[]; empty?: string }) {
  const { locale } = useI18n();
  if (modules.length === 0) return <span className="text-subtle">{empty}</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {modules.map((m) => (
        <Badge key={m} tone="primary">
          {MODULE_DEFS[m].label[locale]}
        </Badge>
      ))}
    </div>
  );
}

/**
 * One row per module with a switch. Modules outside `available` (what the reseller has)
 * can only be switched off, with `unavailableHint` explaining why.
 */
export function ModuleSwitches({
  value,
  onToggle,
  available,
  unavailableHint,
  disabled,
}: {
  value: ModuleKey[];
  onToggle: (module: ModuleKey, on: boolean) => void;
  available?: ModuleKey[];
  unavailableHint?: string;
  disabled?: boolean;
}) {
  const { locale } = useI18n();
  return (
    <div className="divide-y divide-border">
      {MODULES.map((m) => {
        const on = value.includes(m);
        const locked = !!available && !available.includes(m) && !on;
        return (
          <label
            key={m}
            className={cn(
              'flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0',
              locked && 'opacity-60',
            )}
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium text-text">{MODULE_DEFS[m].label[locale]}</span>
              <span className="block text-xs text-muted">{MODULE_DEFS[m].description[locale]}</span>
              {available && !available.includes(m) && unavailableHint && (
                <span className="mt-0.5 block text-xs text-warning">{unavailableHint}</span>
              )}
            </span>
            <Switch
              checked={on}
              disabled={disabled || locked}
              onCheckedChange={(checked) => onToggle(m, checked)}
              label={MODULE_DEFS[m].label[locale]}
            />
          </label>
        );
      })}
    </div>
  );
}

/** Checkbox list for create dialogs. Only `available` modules are offered. */
export function ModuleCheckboxes({
  value,
  onChange,
  available = [...MODULES],
}: {
  value: ModuleKey[];
  onChange: (modules: ModuleKey[]) => void;
  available?: readonly ModuleKey[];
}) {
  const { locale } = useI18n();
  return (
    <div className="space-y-2">
      {MODULES.filter((m) => available.includes(m)).map((m) => (
        <label
          key={m}
          className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-surface-2"
        >
          <input
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
            checked={value.includes(m)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? MODULES.filter((k) => k === m || value.includes(k))
                  : value.filter((k) => k !== m),
              )
            }
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-text">{MODULE_DEFS[m].label[locale]}</span>
            <span className="block text-xs text-muted">{MODULE_DEFS[m].description[locale]}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

// --- Invitations -------------------------------------------------------------------

/** Invitation link with copy button and whether the email went out. */
export function InviteResult({
  link,
  mail,
  email,
}: {
  link: string | null;
  mail: MailResult | null;
  email?: string;
}) {
  const { t } = useI18n();
  if (!link) return null;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{t('admin.invite.link')}</p>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
        <Mono className="min-w-0 flex-1 truncate">{link}</Mono>
        <CopyButton value={link} />
      </div>
      {mail?.status === 'sent' ? (
        <Notice tone="success" icon={<Mail className="size-4" />}>
          {t('admin.invite.mailSent', { email: email ?? '' })}
        </Notice>
      ) : mail?.status === 'failed' ? (
        <Notice tone="warning" icon={<MailWarning className="size-4" />} title={t('admin.invite.mailFailed')}>
          {mail.error}
        </Notice>
      ) : (
        <Notice tone="info" icon={<Mail className="size-4" />}>
          {t('admin.invite.mailSkipped')}
        </Notice>
      )}
    </div>
  );
}

// --- Delete blockers ---------------------------------------------------------------

const BLOCKERS = [
  'customers',
  'servers',
  'domains',
  'webspaces',
  'invoices',
  'payments',
  'creditTransactions',
  'services',
] as const;
type Blocker = (typeof BLOCKERS)[number];

/** The counts a 409 on organization delete carries, or null for any other error. */
function blockersOf(error: unknown): Partial<Record<Blocker, number>> | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const details = error.details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  const counts: Partial<Record<Blocker, number>> = {};
  for (const key of BLOCKERS) {
    const n = (details as Record<string, unknown>)[key];
    if (typeof n === 'number' && n > 0) counts[key] = n;
  }
  return Object.keys(counts).length > 0 ? counts : null;
}

/** Explains why an organization can't be deleted (409), or shows any other error. */
export function DeleteError({ error }: { error: unknown }) {
  const { t } = useI18n();
  if (!error) return null;
  const blockers = blockersOf(error);
  if (!blockers) return <ErrorState error={error} />;
  const billing = !!(
    blockers.invoices ||
    blockers.payments ||
    blockers.creditTransactions ||
    blockers.services
  );
  return (
    <Notice tone="danger" title={t('admin.delete.blocked')}>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {BLOCKERS.filter((k) => blockers[k]).map((k) => (
          <li key={k}>{t(`admin.blocker.${k}`, { n: blockers[k] })}</li>
        ))}
      </ul>
      <p className="mt-2">{billing ? t('admin.delete.billingHint') : t('admin.delete.moveHint')}</p>
    </Notice>
  );
}
