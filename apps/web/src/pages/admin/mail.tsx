import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ExternalLink, Gauge, Link2, Mail, MoreHorizontal, Plus, Search, Trash2, Unlink } from 'lucide-react';
import {
  MAIL_DEFAULT_DKIM_KEY_SIZE,
  MAIL_DEFAULT_LIMITS,
  MAIL_DKIM_KEY_SIZES,
  MAIL_RATE_LIMIT_FRAMES,
  MODULE_DEFS,
  mailDomainAscii,
  mailLimitsIssue,
  type AdminOrgDto,
  type MailDkimKeySize,
  type MailDomainDto,
  type MailDomainLimits,
  type MailDomainUsage,
  type MailRateLimitFrame,
  type Permission,
  type ProviderConnectionDto,
} from '@weblion/shared';
import { formatDate, formatNumber, type Locale } from '@/lib/format';
import { useI18n, type TFunction } from '@/lib/i18n';
import { useAdminOrgs, useAdminProviders, useMe } from '@/lib/queries';
import {
  useAdminMailDomains,
  useAssignMailDomain,
  useCreateMailDomain,
  useDeleteMailDomain,
  useUpdateMailDomain,
  type MailDomainPatchInput,
  type MailLimitsInput,
} from '@/lib/api/mail';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Menu, MenuItem, MenuSeparator, Switch } from '@/components/ui/menu';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Mono,
  Notice,
  Select,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ProviderBadge } from '@/components/server-bits';
import {
  MailDomainName,
  SizeInput,
  StorageUsage,
  countOf,
  mailDomainStatus,
  useMailError,
} from '@/pages/mail/bits';
import { MIB, formatMailSize, fromBytes, toMib, type SizeValue } from '@/pages/mail/units';

/** E-mail in the admin area: the mail domain inventory of every Mailcow instance. */

/**
 * Connections that can have mail domains: Mailcow, and the demo provider's simulation. The
 * opt-in Cloudflare demo is a demo connection as well but simulates DNS zones only.
 */
export const isMailProvider = (
  p: Pick<ProviderConnectionDto, 'type'> & { summary?: Record<string, string> },
) => p.type === 'mailcow' || (p.type === 'demo' && p.summary?.flavor !== 'cloudflare');

const useMailProviders = () => {
  const providers = useAdminProviders();
  return { ...providers, data: providers.data?.filter(isMailProvider) };
};

function usePlatformCan() {
  const me = useMe();
  const perms = me.data?.platformPermissions ?? [];
  return (permission: Permission) => perms.includes(permission);
}

/** Status with the date for domains that are gone at Mailcow. */
function StatusCell({ domain }: { domain: MailDomainDto }) {
  const { t, locale } = useI18n();
  const s = mailDomainStatus(t, domain);
  return (
    <Badge tone={s.tone}>
      {domain.missingSince
        ? t('mail.admin.missingSince', { date: formatDate(domain.missingSince, locale, false) })
        : s.label}
    </Badge>
  );
}

// --- Inventory (tab of Domains & Webspaces) --------------------------------------------

type Pending =
  | { kind: 'assign'; domain: MailDomainDto }
  | { kind: 'unassign'; domain: MailDomainDto }
  | { kind: 'limits'; domain: MailDomainDto }
  | { kind: 'delete'; domain: MailDomainDto }
  | null;

/** "E-Mail-Domains" tab of Admin > Domains & Webspaces. */
export function AdminMailTab() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const can = usePlatformCan();
  const canAssign = can('platform:server:assign');
  const canWrite = can('platform:mail:write');
  const [params, setParams] = useSearchParams();
  const assignedParam = params.get('assigned');
  const assigned = assignedParam === 'true' || assignedParam === 'false' ? assignedParam : undefined;
  const orgId = params.get('org') ?? undefined;
  const providerParam = params.get('provider') ?? undefined;
  const [q, setQ] = useState('');
  const providers = useMailProviders();
  const orgs = useAdminOrgs();
  const mailProviders = providers.data ?? [];
  // The hosting tabs share ?provider=, so only a mail instance counts here.
  const providerId = mailProviders.some((p) => p.id === providerParam) ? providerParam : undefined;
  const domains = useAdminMailDomains({ q: q.trim() || undefined, assigned, providerId, orgId });
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const close = () => setPending(null);
  const mailError = useMailError();
  const unassign = useAssignMailDomain({
    success: (d) => t('hosting.admin.unassignedDone', { name: d.name }),
    onSuccess: close,
    error: mailError,
  });

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value && value !== 'all') next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const list = domains.data ?? [];
  const showActions = canAssign || canWrite || list.some((d) => d.org);

  return (
    <div className="space-y-4">
      <Notice tone="info">
        {t('mail.admin.tabHint')}{' '}
        <Link to="/admin/providers" className="font-medium underline underline-offset-2">
          {t('hosting.admin.toProviders')}
        </Link>
      </Notice>
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('mail.admin.search')}
              className="pl-9"
              aria-label={t('common.search')}
            />
          </div>
          <Select
            value={assigned ?? 'all'}
            onChange={(e) => set('assigned', e.target.value)}
            className="w-auto"
            aria-label={t('hosting.admin.filterAssigned')}
          >
            <option value="all">{t('hosting.admin.all')}</option>
            <option value="false">{t('hosting.admin.onlyUnassigned')}</option>
            <option value="true">{t('hosting.admin.onlyAssigned')}</option>
          </Select>
          {mailProviders.length > 1 && (
            <Select
              value={providerId ?? ''}
              onChange={(e) => set('provider', e.target.value)}
              className="w-auto"
              aria-label={t('mail.admin.filterInstance')}
            >
              <option value="">{t('mail.admin.allInstances')}</option>
              {mailProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
          <Select
            value={orgId ?? ''}
            onChange={(e) => set('org', e.target.value)}
            className="w-auto max-w-[260px]"
            aria-label={t('mail.admin.filterCustomer')}
          >
            <option value="">{t('mail.admin.allCustomers')}</option>
            {(orgs.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
          {canWrite && (
            <Button
              variant="primary"
              icon={<Plus className="size-4" />}
              disabled={providers.isPending || mailProviders.length === 0}
              title={
                !providers.isPending && mailProviders.length === 0 ? t('mail.admin.noInstance') : undefined
              }
              onClick={() => setCreating(true)}
            >
              {t('mail.admin.create')}
            </Button>
          )}
        </div>
        {domains.isError ? (
          <div className="p-5">
            <ErrorState error={domains.error} onRetry={() => void domains.refetch()} />
          </div>
        ) : domains.isPending ? (
          <LoadingBlock rows={5} />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Mail className="size-6" />}
            title={t('mail.admin.empty')}
            description={t('mail.admin.emptyText')}
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>{t('mail.col.domain')}</TH>
                <TH>{t('hosting.col.customer')}</TH>
                <TH className="hidden lg:table-cell">{t('mail.col.instance')}</TH>
                <TH className="hidden sm:table-cell">{t('mail.col.mailboxes')}</TH>
                <TH className="hidden md:table-cell">{t('mail.col.storage')}</TH>
                <TH className="hidden sm:table-cell">{t('mail.col.status')}</TH>
                {showActions && <TH />}
              </tr>
            </THead>
            <TBody>
              {list.map((d) => (
                <TR key={d.id} onClick={d.org ? () => navigate(`/o/${d.org!.slug}/mail/${d.id}`) : undefined}>
                  <TD className="max-w-[280px]">
                    <div className="flex items-center gap-3">
                      <Mail className="size-4 shrink-0 text-muted" aria-hidden />
                      <MailDomainName name={d.name} asciiName={d.asciiName} />
                    </div>
                    <div className="mt-1 pl-7 lg:hidden">
                      <ProviderBadge type={d.provider.type} name={d.provider.name} />
                    </div>
                  </TD>
                  <TD>
                    {d.org ? (
                      <Link
                        to={`/admin/customers/${d.org.id}`}
                        className="text-sm whitespace-nowrap text-text hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {d.org.name}
                      </Link>
                    ) : (
                      <span className="text-sm text-warning">{t('hosting.admin.unassigned')}</span>
                    )}
                  </TD>
                  <TD className="hidden lg:table-cell">
                    <span className="inline-flex items-center gap-2">
                      <ProviderBadge type={d.provider.type} name={d.provider.name} />
                      <span className="truncate text-sm text-muted">{d.location.label}</span>
                    </span>
                  </TD>
                  <TD className="hidden whitespace-nowrap tabular sm:table-cell">
                    {d.limits && d.usage ? countOf(t, locale, d.usage.mailboxes, d.limits.maxMailboxes) : '–'}
                  </TD>
                  <TD className="hidden md:table-cell">
                    <StorageUsage limits={d.limits} usage={d.usage} />
                  </TD>
                  <TD className="hidden sm:table-cell">
                    <StatusCell domain={d} />
                  </TD>
                  {showActions && (
                    <TD className="w-12 text-right" onClick={(e) => e.stopPropagation()}>
                      <DomainMenu
                        domain={d}
                        canAssign={canAssign}
                        canWrite={canWrite}
                        onOpen={() => d.org && navigate(`/o/${d.org.slug}/mail/${d.id}`)}
                        onPending={setPending}
                      />
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {creating && (
        <CreateMailDomainDialog
          providers={mailProviders}
          initialProviderId={providerId}
          onClose={() => setCreating(false)}
        />
      )}
      {pending?.kind === 'assign' && (
        <AssignMailDomainDialog key={pending.domain.id} domain={pending.domain} onClose={close} />
      )}
      {pending?.kind === 'limits' && (
        <MailDomainLimitsDialog key={pending.domain.id} domain={pending.domain} onClose={close} />
      )}
      {pending?.kind === 'delete' && (
        <DeleteMailDomainDialog key={pending.domain.id} domain={pending.domain} onClose={close} />
      )}
      <ConfirmDialog
        open={pending?.kind === 'unassign'}
        onOpenChange={(o) => !o && close()}
        title={t('hosting.admin.unassignTitle', { name: pending?.domain.name ?? '' })}
        description={t('mail.admin.unassignText', { org: pending?.domain.org?.name ?? '' })}
        confirmLabel={t('hosting.admin.unassign')}
        loading={unassign.isPending}
        onConfirm={() =>
          pending && unassign.mutate({ id: pending.domain.id, orgId: null, enableModule: false })
        }
      />
    </div>
  );
}

function DomainMenu({
  domain,
  canAssign,
  canWrite,
  onOpen,
  onPending,
}: {
  domain: MailDomainDto;
  canAssign: boolean;
  canWrite: boolean;
  onOpen: () => void;
  onPending: (pending: Pending) => void;
}) {
  const { t } = useI18n();
  if (!domain.org && !canAssign && !canWrite) return null;
  return (
    <Menu
      trigger={
        <Button size="icon" variant="ghost" aria-label={t('common.actions')} title={t('common.actions')}>
          <MoreHorizontal className="size-4" />
        </Button>
      }
    >
      {domain.org && (
        <MenuItem icon={<ExternalLink />} onSelect={onOpen} hint={domain.org.name}>
          {t('mail.admin.open')}
        </MenuItem>
      )}
      {canAssign && (
        <MenuItem icon={<Link2 />} onSelect={() => onPending({ kind: 'assign', domain })}>
          {domain.org ? t('mail.admin.reassign') : t('hosting.admin.assign')}
        </MenuItem>
      )}
      {canAssign && domain.org && (
        <MenuItem icon={<Unlink />} onSelect={() => onPending({ kind: 'unassign', domain })}>
          {t('hosting.admin.unassign')}
        </MenuItem>
      )}
      {canWrite && (
        <>
          {(domain.org || canAssign) && <MenuSeparator />}
          <MenuItem
            icon={<Gauge />}
            onSelect={() => onPending({ kind: 'limits', domain })}
            disabled={!!domain.missingSince || !domain.limits}
          >
            {t('mail.admin.limits')}
          </MenuItem>
          <MenuItem icon={<Trash2 />} danger onSelect={() => onPending({ kind: 'delete', domain })}>
            {t('common.delete')}
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

// --- Organization picker ---------------------------------------------------------------

function orgLabel(t: TFunction, org: AdminOrgDto): string {
  const parts = [org.name];
  if (org.kind === 'reseller') parts.push(t('hosting.admin.kindReseller'));
  if (org.kind === 'internal') parts.push(t('hosting.admin.kindInternal'));
  if (org.status === 'suspended') parts.push(t('hosting.admin.suspended'));
  return parts.join(' · ');
}

/**
 * Customer select (organizations without a reseller first, then one group per reseller) and
 * the module switch. The reseller of a customer needs the module itself (checked by the API).
 */
function OrgPicker({
  id,
  orgId,
  onOrgId,
  enableModule,
  onEnableModule,
  emptyLabel,
}: {
  id: string;
  orgId: string;
  onOrgId: (orgId: string) => void;
  enableModule: boolean;
  onEnableModule: (value: boolean) => void;
  emptyLabel: string;
}) {
  const { t, locale } = useI18n();
  const orgs = useAdminOrgs();
  const [filter, setFilter] = useState('');
  const all = orgs.data ?? [];
  const byId = new Map(all.map((o) => [o.id, o]));
  const selected = byId.get(orgId) ?? null;
  const reseller = selected?.parent ? (byId.get(selected.parent.id) ?? null) : null;
  const hasModule = !!selected?.modules.includes('mail');
  const resellerLacks = !!reseller && !reseller.modules.includes('mail');
  const moduleLabel = MODULE_DEFS.mail.label[locale];

  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const match = (o: AdminOrgDto) =>
      !needle || o.name.toLowerCase().includes(needle) || o.slug.includes(needle) || o.id === orgId;
    const direct = all.filter((o) => !o.parent && match(o));
    const below = new Map<string, { name: string; orgs: AdminOrgDto[] }>();
    for (const o of all) {
      if (!o.parent || !match(o)) continue;
      const group = below.get(o.parent.id) ?? { name: o.parent.name, orgs: [] };
      group.orgs.push(o);
      below.set(o.parent.id, group);
    }
    return { direct, below: [...below.values()] };
  }, [all, filter, orgId]);

  if (orgs.isError) return <ErrorState error={orgs.error} onRetry={() => void orgs.refetch()} />;
  return (
    <div className="space-y-3">
      {all.length > 8 && (
        <Field label={t('hosting.admin.findCustomer')} htmlFor={`${id}-filter`}>
          <Input
            id={`${id}-filter`}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('common.search')}
          />
        </Field>
      )}
      <Field label={t('hosting.col.customer')} htmlFor={id}>
        <Select id={id} value={orgId} onChange={(e) => onOrgId(e.target.value)} disabled={orgs.isPending}>
          <option value="">{emptyLabel}</option>
          {groups.direct.length > 0 && (
            <optgroup label={t('hosting.admin.groupDirect')}>
              {groups.direct.map((o) => (
                <option key={o.id} value={o.id}>
                  {orgLabel(t, o)}
                </option>
              ))}
            </optgroup>
          )}
          {groups.below.map((g) => (
            <optgroup key={g.name} label={t('hosting.admin.groupReseller', { name: g.name })}>
              {g.orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {orgLabel(t, o)}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </Field>
      {selected &&
        (hasModule ? (
          <p className="text-sm text-muted">{t('hosting.admin.moduleActive', { module: moduleLabel })}</p>
        ) : (
          <>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-surface-2">
              <input
                type="checkbox"
                className="mt-1 size-4 accent-[var(--primary)]"
                checked={enableModule}
                onChange={(e) => onEnableModule(e.target.checked)}
              />
              <span>
                <span className="block text-sm font-medium">
                  {t('hosting.admin.enableModule', { module: moduleLabel })}
                </span>
                <span className="block text-xs text-muted">
                  {t('hosting.admin.enableModuleHint', { org: selected.name })}
                </span>
              </span>
            </label>
            {enableModule && resellerLacks && reseller && (
              <Notice tone="warning">
                {t('hosting.admin.resellerLacks', { reseller: reseller.name, module: moduleLabel })}
              </Notice>
            )}
            {!enableModule && (
              <Notice tone="info">{t('mail.admin.moduleOff', { module: moduleLabel })}</Notice>
            )}
          </>
        ))}
    </div>
  );
}

/** Whether the picked organization can take the mail domain (its reseller must have the module). */
function useOrgBlocked(orgId: string, enableModule: boolean): { hasModule: boolean; blocked: boolean } {
  const orgs = useAdminOrgs();
  const all = orgs.data ?? [];
  const selected = all.find((o) => o.id === orgId) ?? null;
  const reseller = selected?.parent ? all.find((o) => o.id === selected.parent!.id) : undefined;
  const hasModule = !!selected?.modules.includes('mail');
  const resellerLacks = !!reseller && !reseller.modules.includes('mail');
  return { hasModule, blocked: !!selected && !hasModule && enableModule && resellerLacks };
}

// --- Limits form -----------------------------------------------------------------------

interface LimitsForm {
  maxMailboxes: string;
  maxAliases: string;
  quota: SizeValue;
  defaultQuota: SizeValue;
  maxQuota: SizeValue;
  rateOn: boolean;
  rateValue: string;
  rateFrame: MailRateLimitFrame;
}

type LimitsErrors = Partial<Record<keyof LimitsForm, string>>;

function formFromLimits(limits: MailDomainLimits | null): LimitsForm {
  const mib = (bytes: number) => fromBytes(bytes);
  if (!limits) {
    return {
      maxMailboxes: String(MAIL_DEFAULT_LIMITS.maxMailboxes),
      maxAliases: String(MAIL_DEFAULT_LIMITS.maxAliases),
      quota: mib(MAIL_DEFAULT_LIMITS.quotaMb * MIB),
      defaultQuota: mib(MAIL_DEFAULT_LIMITS.defaultMailboxQuotaMb * MIB),
      maxQuota: mib(MAIL_DEFAULT_LIMITS.maxMailboxQuotaMb * MIB),
      rateOn: false,
      rateValue: '500',
      rateFrame: 'h',
    };
  }
  return {
    maxMailboxes: String(limits.maxMailboxes),
    maxAliases: String(limits.maxAliases),
    quota: mib(limits.quotaBytes),
    defaultQuota: mib(limits.defaultMailboxQuotaBytes),
    maxQuota: mib(limits.maxMailboxQuotaBytes),
    rateOn: !!limits.rateLimit,
    rateValue: String(limits.rateLimit?.value ?? 500),
    rateFrame: limits.rateLimit?.frame ?? 'h',
  };
}

const wholeNumber = (value: string, min: number, max: number): number | null => {
  if (!/^\d{1,9}$/.test(value.trim())) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
};

/**
 * Limits in MiB from the form, with one message per field that is not valid. With `usage`
 * (changing a domain) a limit below what is in use is refused like Mailcow does.
 */
function readLimits(
  t: TFunction,
  locale: Locale,
  form: LimitsForm,
  usage: MailDomainUsage | null,
): { limits: MailLimitsInput | null; errors: LimitsErrors } {
  const errors: LimitsErrors = {};
  const maxMailboxes = wholeNumber(form.maxMailboxes, 0, 100_000);
  if (maxMailboxes === null)
    errors.maxMailboxes = t('mail.admin.numberRange', { min: 0, max: formatNumber(100_000, locale) });
  else if (usage && maxMailboxes < usage.mailboxes)
    errors.maxMailboxes = t('mail.admin.belowUsage', { n: usage.mailboxes });
  const maxAliases = wholeNumber(form.maxAliases, 1, 100_000);
  if (maxAliases === null)
    errors.maxAliases = t('mail.admin.numberRange', { min: 1, max: formatNumber(100_000, locale) });
  else if (usage && maxAliases < usage.aliases)
    errors.maxAliases = t('mail.admin.belowUsage', { n: usage.aliases });

  const quotaMb = toMib(form.quota.value, form.quota.unit);
  const defaultMailboxQuotaMb = toMib(form.defaultQuota.value, form.defaultQuota.unit);
  const maxMailboxQuotaMb = toMib(form.maxQuota.value, form.maxQuota.unit);
  if (quotaMb === null) errors.quota = t('mail.units.invalid');
  else if (usage && quotaMb * MIB < usage.allocatedBytes)
    errors.quota = t('mail.admin.belowAllocated', { size: formatMailSize(usage.allocatedBytes, locale) });
  if (defaultMailboxQuotaMb === null) errors.defaultQuota = t('mail.units.invalid');
  if (maxMailboxQuotaMb === null) errors.maxQuota = t('mail.units.invalid');
  if (quotaMb !== null && defaultMailboxQuotaMb !== null && maxMailboxQuotaMb !== null) {
    // Mailcow's ordering rule: default <= maximum mailbox size <= domain storage.
    const issue = mailLimitsIssue({ quotaMb, defaultMailboxQuotaMb, maxMailboxQuotaMb });
    if (issue && defaultMailboxQuotaMb > maxMailboxQuotaMb)
      errors.defaultQuota = t('mail.admin.defaultAboveMax');
    else if (issue) errors.maxQuota = t('mail.admin.maxAboveQuota');
  }

  const rateValue = form.rateOn ? wholeNumber(form.rateValue, 1, 1_000_000) : null;
  if (form.rateOn && rateValue === null)
    errors.rateValue = t('mail.admin.numberRange', { min: 1, max: formatNumber(1_000_000, locale) });

  if (
    Object.keys(errors).length > 0 ||
    maxMailboxes === null ||
    maxAliases === null ||
    quotaMb === null ||
    defaultMailboxQuotaMb === null ||
    maxMailboxQuotaMb === null
  ) {
    return { limits: null, errors };
  }
  return {
    limits: {
      maxMailboxes,
      maxAliases,
      quotaMb,
      defaultMailboxQuotaMb,
      maxMailboxQuotaMb,
      rateLimit: form.rateOn && rateValue !== null ? { value: rateValue, frame: form.rateFrame } : null,
    },
    errors,
  };
}

function LimitsFields({
  id,
  form,
  onChange,
  errors,
  usage,
}: {
  id: string;
  form: LimitsForm;
  onChange: (form: LimitsForm) => void;
  errors: LimitsErrors;
  usage: MailDomainUsage | null;
}) {
  const { t, locale } = useI18n();
  const set = <K extends keyof LimitsForm>(key: K, value: LimitsForm[K]) =>
    onChange({ ...form, [key]: value });
  const inUse = (value: string) => (usage ? t('mail.admin.inUse', { value }) : undefined);
  return (
    <fieldset className="space-y-4">
      <legend className="mb-1 text-[13px] font-semibold text-text">{t('mail.admin.limitsSection')}</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t('mail.limits.mailboxes')}
          htmlFor={`${id}-mailboxes`}
          error={errors.maxMailboxes}
          hint={inUse(String(usage?.mailboxes ?? 0))}
        >
          <Input
            id={`${id}-mailboxes`}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={form.maxMailboxes}
            onChange={(e) => set('maxMailboxes', e.target.value)}
            className="w-32 tabular"
          />
        </Field>
        <Field
          label={t('mail.limits.aliases')}
          htmlFor={`${id}-aliases`}
          error={errors.maxAliases}
          hint={inUse(String(usage?.aliases ?? 0))}
        >
          <Input
            id={`${id}-aliases`}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={form.maxAliases}
            onChange={(e) => set('maxAliases', e.target.value)}
            className="w-32 tabular"
          />
        </Field>
        <Field
          label={t('mail.admin.quota')}
          htmlFor={`${id}-quota`}
          error={errors.quota}
          hint={usage ? inUse(formatMailSize(usage.allocatedBytes, locale)) : t('mail.admin.quotaHint')}
        >
          <SizeInput
            id={`${id}-quota`}
            size={form.quota}
            onChange={(v) => set('quota', v)}
            invalid={!!errors.quota}
          />
        </Field>
        <div className="hidden sm:block" />
        <Field label={t('mail.limits.defaultSize')} htmlFor={`${id}-default`} error={errors.defaultQuota}>
          <SizeInput
            id={`${id}-default`}
            size={form.defaultQuota}
            onChange={(v) => set('defaultQuota', v)}
            invalid={!!errors.defaultQuota}
          />
        </Field>
        <Field label={t('mail.limits.maxSize')} htmlFor={`${id}-max`} error={errors.maxQuota}>
          <SizeInput
            id={`${id}-max`}
            size={form.maxQuota}
            onChange={(v) => set('maxQuota', v)}
            invalid={!!errors.maxQuota}
          />
        </Field>
      </div>
      <div className="space-y-2 rounded-lg border border-border px-3 py-2.5">
        <label className="flex items-center justify-between gap-3">
          <span>
            <span className="block text-sm font-medium text-text">{t('mail.limits.rateLimit')}</span>
            <span className="block text-xs text-muted">{t('mail.admin.rateHint')}</span>
          </span>
          <Switch
            checked={form.rateOn}
            onCheckedChange={(v) => set('rateOn', v)}
            label={t('mail.limits.rateLimit')}
          />
        </label>
        {form.rateOn && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={form.rateValue}
              onChange={(e) => set('rateValue', e.target.value)}
              className="w-32 tabular"
              aria-label={t('mail.admin.rateValue')}
              aria-invalid={!!errors.rateValue}
            />
            <span className="text-sm text-muted">{t('mail.admin.rateMessages')}</span>
            <Select
              value={form.rateFrame}
              onChange={(e) => set('rateFrame', e.target.value as MailRateLimitFrame)}
              className="w-auto"
              aria-label={t('mail.admin.rateFrame')}
            >
              {MAIL_RATE_LIMIT_FRAMES.map((f) => (
                <option key={f} value={f}>
                  {t(`mail.rate.frame.${f}`)}
                </option>
              ))}
            </Select>
            {errors.rateValue && <p className="w-full text-xs text-danger">{errors.rateValue}</p>}
          </div>
        )}
      </div>
    </fieldset>
  );
}

// --- Create ----------------------------------------------------------------------------

function CreateMailDomainDialog({
  providers,
  initialProviderId,
  onClose,
}: {
  providers: ProviderConnectionDto[];
  initialProviderId?: string;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const mailError = useMailError();
  // One instance: preselected. Several: the one the list is filtered by, else the admin picks.
  const [providerId, setProviderId] = useState(
    providers.length === 1 ? providers[0]!.id : (initialProviderId ?? ''),
  );
  const [domain, setDomain] = useState('');
  const [description, setDescription] = useState('');
  const [form, setForm] = useState<LimitsForm>(() => formFromLimits(null));
  const [dkimKeySize, setDkimKeySize] = useState<MailDkimKeySize>(MAIL_DEFAULT_DKIM_KEY_SIZE);
  const [restartSogo, setRestartSogo] = useState(true);
  const [orgId, setOrgId] = useState('');
  const [enableModule, setEnableModule] = useState(true);
  const create = useCreateMailDomain({
    success: (r) => t('mail.admin.created', { name: r.domain.name }),
    onSuccess: (r) => {
      onClose();
      if (r.warnings.length > 0)
        toast.warning(t('mail.admin.warnings'), { description: r.warnings.join(' ') });
    },
    error: mailError,
  });
  const org = useOrgBlocked(orgId, enableModule);

  const typed = domain.trim().toLowerCase().replace(/\.$/, '');
  const ascii = typed ? mailDomainAscii(typed) : null;
  const domainError = typed && !ascii ? t('mail.admin.domainInvalid') : null;
  const { limits, errors } = readLimits(t, locale, form, null);
  const blocked = !providerId || !ascii || !limits || description.trim().length > 255 || org.blocked;

  const submit = () => {
    if (blocked || !ascii || !limits || create.isPending) return;
    create.mutate({
      providerId,
      domain: ascii,
      description: description.trim() || null,
      limits,
      dkimKeySize,
      restartSogo,
      orgId: orgId || null,
      enableModule: !!orgId && enableModule && !org.hasModule,
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !create.isPending && onClose()}
      title={t('mail.admin.createTitle')}
      description={t('mail.admin.createText')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={blocked} loading={create.isPending} onClick={submit}>
            {t('mail.admin.create')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {create.isPending && <Notice tone="info">{t('mail.admin.creating')}</Notice>}
        <Field
          label={t('mail.col.instance')}
          htmlFor="md-provider"
          hint={providers.length > 1 ? t('mail.admin.instanceHint') : undefined}
        >
          <Select id="md-provider" value={providerId} onChange={(e) => setProviderId(e.target.value)}>
            {providers.length !== 1 && <option value="">{t('mail.admin.chooseInstance')}</option>}
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.location.label}
                {p.enabled ? '' : ` (${t('providers.disabledBadge')})`}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('mail.col.domain')}
            htmlFor="md-domain"
            error={domainError}
            hint={
              ascii && ascii !== typed ? (
                <>
                  {t('mail.admin.asciiPreview')} <Mono className="text-text">{ascii}</Mono>
                </>
              ) : (
                t('mail.admin.domainHint')
              )
            }
          >
            <Input
              id="md-domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="kunde.ch"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={253}
              autoFocus
              aria-invalid={!!domainError}
            />
          </Field>
          <Field
            label={t('mail.admin.description')}
            htmlFor="md-description"
            hint={t('common.optional')}
            error={description.trim().length > 255 ? t('mail.admin.descriptionTooLong') : undefined}
          >
            <Input
              id="md-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('mail.admin.descriptionPlaceholder')}
              maxLength={256}
            />
          </Field>
        </div>
        <LimitsFields id="md" form={form} onChange={setForm} errors={errors} usage={null} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('mail.admin.dkimKeySize')} htmlFor="md-dkim" hint={t('mail.dns.dkimSizeHint')}>
            <Select
              id="md-dkim"
              value={dkimKeySize}
              onChange={(e) => setDkimKeySize(Number(e.target.value) as MailDkimKeySize)}
            >
              {MAIL_DKIM_KEY_SIZES.map((size) => (
                <option key={size} value={size}>
                  {t('mail.dns.dkimBits', { n: size })}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-surface-2">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-[var(--primary)]"
            checked={restartSogo}
            onChange={(e) => setRestartSogo(e.target.checked)}
          />
          <span>
            <span className="block text-sm font-medium">{t('mail.admin.restartSogo')}</span>
            <span className="block text-xs text-muted">{t('mail.admin.restartSogoHint')}</span>
          </span>
        </label>
        <OrgPicker
          id="md-org"
          orgId={orgId}
          onOrgId={setOrgId}
          enableModule={enableModule}
          onEnableModule={setEnableModule}
          emptyLabel={t('mail.admin.noCustomer')}
        />
        <button type="submit" className="sr-only" aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}

// --- Limits ----------------------------------------------------------------------------

const sameRate = (a: MailLimitsInput['rateLimit'], b: MailLimitsInput['rateLimit']) =>
  a === null || b === null ? a === b : a.value === b.value && a.frame === b.frame;

function MailDomainLimitsDialog({ domain, onClose }: { domain: MailDomainDto; onClose: () => void }) {
  const { t, locale } = useI18n();
  const mailError = useMailError();
  const current = domain.limits;
  const [form, setForm] = useState<LimitsForm>(() => formFromLimits(current));
  const [active, setActive] = useState(domain.active);
  const update = useUpdateMailDomain({
    success: (r) => t('mail.admin.limitsSaved', { name: r.domain.name }),
    onSuccess: onClose,
    error: mailError,
  });
  const { limits, errors } = readLimits(t, locale, form, domain.usage);

  const patch: MailDomainPatchInput = {};
  if (limits && current) {
    const changed: Partial<MailLimitsInput> = {};
    if (limits.maxMailboxes !== current.maxMailboxes) changed.maxMailboxes = limits.maxMailboxes;
    if (limits.maxAliases !== current.maxAliases) changed.maxAliases = limits.maxAliases;
    if (limits.quotaMb * MIB !== current.quotaBytes) changed.quotaMb = limits.quotaMb;
    if (limits.defaultMailboxQuotaMb * MIB !== current.defaultMailboxQuotaBytes)
      changed.defaultMailboxQuotaMb = limits.defaultMailboxQuotaMb;
    if (limits.maxMailboxQuotaMb * MIB !== current.maxMailboxQuotaBytes)
      changed.maxMailboxQuotaMb = limits.maxMailboxQuotaMb;
    if (!sameRate(limits.rateLimit, current.rateLimit)) changed.rateLimit = limits.rateLimit;
    if (Object.keys(changed).length > 0) patch.limits = changed;
  }
  if (active !== domain.active) patch.active = active;
  const blocked = !limits || Object.keys(patch).length === 0;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('mail.admin.limitsTitle', { name: domain.name })}
      description={t('mail.admin.limitsText')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={blocked}
            loading={update.isPending}
            onClick={() => !blocked && update.mutate({ id: domain.id, patch })}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <LimitsFields id="ml" form={form} onChange={setForm} errors={errors} usage={domain.usage} />
        <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
          <span>
            <span className="block text-sm font-medium text-text">{t('mail.admin.active')}</span>
            <span className="block text-xs text-muted">{t('mail.admin.activeHint')}</span>
          </span>
          <Switch checked={active} onCheckedChange={setActive} label={t('mail.admin.active')} />
        </label>
        {domain.org && (
          <p className="text-xs text-muted">{t('mail.admin.limitsCustomer', { org: domain.org.name })}</p>
        )}
      </div>
    </Dialog>
  );
}

// --- Delete ----------------------------------------------------------------------------

function DeleteMailDomainDialog({ domain, onClose }: { domain: MailDomainDto; onClose: () => void }) {
  const { t } = useI18n();
  const mailError = useMailError();
  const [deleteDkim, setDeleteDkim] = useState(true);
  const remove = useDeleteMailDomain({
    success: () => t('mail.admin.deleted', { name: domain.name }),
    onSuccess: (r) => {
      onClose();
      if (r.warnings.length > 0)
        toast.warning(t('mail.admin.warnings'), { description: r.warnings.join(' ') });
    },
    error: mailError,
  });
  // Mailcow only deletes empty domains. A domain gone at Mailcow only leaves its row behind.
  const mailboxes = domain.missingSince ? 0 : (domain.usage?.mailboxes ?? 0);

  if (mailboxes > 0) {
    return (
      <Dialog
        open
        onOpenChange={(o) => !o && onClose()}
        title={t('mail.admin.deleteTitle', { name: domain.name })}
        size="sm"
        footer={
          <Button variant="primary" onClick={onClose}>
            {t('common.close')}
          </Button>
        }
      >
        <Notice tone="warning">{t('mail.admin.deleteNotEmpty', { n: mailboxes })}</Notice>
        {domain.org && (
          <p className="mt-3 text-sm text-muted">
            {t('mail.admin.deleteNotEmptyHint', { org: domain.org.name })}
          </p>
        )}
      </Dialog>
    );
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('mail.admin.deleteTitle', { name: domain.name })}
      confirmLabel={t('mail.admin.deleteConfirm')}
      confirmText={domain.name}
      loading={remove.isPending}
      onConfirm={() => remove.mutate({ id: domain.id, confirm: domain.asciiName, deleteDkim })}
    >
      <div className="mb-4 space-y-3">
        <Notice tone="danger" title={t('mail.admin.deleteWarningTitle')}>
          {domain.missingSince ? t('mail.admin.deleteGone') : t('mail.admin.deleteText')}
          {domain.org && (
            <span className="mt-1 block">{t('mail.admin.deleteAssigned', { org: domain.org.name })}</span>
          )}
        </Notice>
        {!domain.missingSince && (
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-surface-2">
            <input
              type="checkbox"
              className="mt-1 size-4 accent-[var(--primary)]"
              checked={deleteDkim}
              onChange={(e) => setDeleteDkim(e.target.checked)}
            />
            <span>
              <span className="block text-sm font-medium">{t('mail.admin.deleteDkim')}</span>
              <span className="block text-xs text-muted">{t('mail.admin.deleteDkimHint')}</span>
            </span>
          </label>
        )}
      </div>
    </ConfirmDialog>
  );
}

// --- Assign ----------------------------------------------------------------------------

function AssignMailDomainDialog({ domain, onClose }: { domain: MailDomainDto; onClose: () => void }) {
  const { t } = useI18n();
  const mailError = useMailError();
  const current = domain.org;
  const [orgId, setOrgId] = useState(current?.id ?? '');
  const [enableModule, setEnableModule] = useState(true);
  const org = useOrgBlocked(orgId, enableModule);
  const assign = useAssignMailDomain({
    success: (d) => t('hosting.admin.assigned', { name: d.name }),
    onSuccess: onClose,
    error: mailError,
  });
  const changed = orgId !== (current?.id ?? '');
  const blocked = !orgId || !changed || org.blocked;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('hosting.admin.assignTitle', { name: domain.name })}
      description={t('mail.admin.assignText')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={blocked}
            loading={assign.isPending}
            onClick={() =>
              assign.mutate({ id: domain.id, orgId, enableModule: enableModule && !org.hasModule })
            }
          >
            {t('hosting.admin.assign')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {current && (
          <p className="text-sm text-muted">
            {t('hosting.admin.currentlyAt')} <span className="font-medium text-text">{current.name}</span>
          </p>
        )}
        <OrgPicker
          id="ma-org"
          orgId={orgId}
          onOrgId={setOrgId}
          enableModule={enableModule}
          onEnableModule={setEnableModule}
          emptyLabel="–"
        />
      </div>
    </Dialog>
  );
}
