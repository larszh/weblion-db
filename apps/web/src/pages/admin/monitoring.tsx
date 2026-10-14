import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ExternalLink,
  HeartPulse,
  Link2,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Unlink,
  Users,
} from 'lucide-react';
import {
  MODULE_DEFS,
  MONITOR_DEFAULT_MAX_MONITORS,
  MONITOR_DEFAULT_MIN_INTERVAL_SECONDS,
  MONITOR_MAX_MONITORS_LIMIT,
  MONITOR_MIN_INTERVAL_SECONDS,
  MONITOR_ORIGINS,
  MONITOR_STATUSES,
  MONITOR_STATUS_PAGE_SLUG_PATTERN,
  type AdminOrgDto,
  type MonitorAllowanceDto,
  type MonitorDto,
  type MonitorOrigin,
  type MonitorStatus,
  type MonitorStatusPageDto,
  type MonitoringInstanceDto,
  type Permission,
} from '@weblion/shared';
import type { TranslationKey } from '@/i18n/de';
import { ApiError } from '@/lib/api';
import { formatNumber, formatRelative } from '@/lib/format';
import { useI18n, type TFunction } from '@/lib/i18n';
import { useAdminOrgs, useAdminProviders, useMe } from '@/lib/queries';
import { useProviderSync } from '@/lib/api/hosting';
import {
  isMonitoringProvider,
  useAdminMonitorAllowance,
  useAdminMonitors,
  useAdminStatusPages,
  useAssignMonitor,
  useBulkAssignMonitors,
  useDeleteAdminMonitorAllowance,
  useDeleteStatusPage,
  useKumaSignIn,
  useKumaSignOut,
  useMonitoringInstances,
  useSetAdminMonitorAllowance,
  useSetStatusPage,
  type AdminMonitorFilters,
} from '@/lib/api/monitoring';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Menu, MenuItem, MenuLabel } from '@/components/ui/menu';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Mono,
  Notice,
  PageHeader,
  Select,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ProviderBadge } from '@/components/server-bits';
import { safePanelUrl } from '@/pages/hosting/bits';
import {
  KindLabel,
  MissingHint,
  MonitorStatusBadge,
  errorDetail,
  errorPath,
  intervalChoices,
  intervalLabel,
  monitorErrorText,
  useMonitorError,
} from '@/pages/monitoring/bits';

/**
 * Monitors of every Uptime Kuma connection (/admin/monitoring, ?provider=<id> filters by
 * instance, like the link of the provider detail page): instances with their management
 * sign-in, the inventory and its assignment. The allowance card of an organization lives here
 * too and is rendered in Admin > Customers.
 */

const MODULE = 'monitoring' as const;
/** Default maximum of a new reseller allowance (customers get 10, MONITOR_DEFAULT_MAX_MONITORS). */
const RESELLER_DEFAULT_MAX_MONITORS = 50;

function usePlatformCan() {
  const me = useMe();
  const perms = me.data?.platformPermissions ?? [];
  return (permission: Permission) => perms.includes(permission);
}

const asId = (value: string | null) => (value && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined);

const useMonitoringProviders = () => {
  const providers = useAdminProviders();
  return { ...providers, data: providers.data?.filter(isMonitoringProvider) };
};

const STATUS_LABEL = (status: MonitorStatus) => `uptime.status.${status}` as TranslationKey;
const ORIGIN_LABEL: Record<MonitorOrigin, TranslationKey> = {
  kuma: 'uptime.origin.kuma',
  console: 'uptime.origin.console',
};

type Pending =
  | { kind: 'assign'; monitor: MonitorDto }
  | { kind: 'bulk'; instance: MonitoringInstanceDto }
  | { kind: 'signIn'; instance: MonitoringInstanceDto }
  | { kind: 'signOut'; instance: MonitoringInstanceDto }
  | null;

export function AdminMonitoringPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const can = usePlatformCan();
  const canAssign = can('platform:server:assign');
  const [params, setParams] = useSearchParams();
  // Ids from the address only when they are ids: anything else would make the list fail.
  const providerId = asId(params.get('provider'));
  const orgId = asId(params.get('org'));
  const assignedParam = params.get('assigned');
  const assigned = assignedParam === 'true' || assignedParam === 'false' ? assignedParam : undefined;
  const originParam = params.get('origin');
  const origin = MONITOR_ORIGINS.find((o) => o === originParam);
  const statusParam = params.get('status');
  const status = MONITOR_STATUSES.find((s) => s === statusParam);
  const [q, setQ] = useState('');
  const providers = useAdminProviders();
  const monitoringProviders = (providers.data ?? []).filter(isMonitoringProvider);
  const orgs = useAdminOrgs();
  const filters: AdminMonitorFilters = {
    q: q.trim() || undefined,
    providerId,
    orgId,
    assigned,
    origin,
    status,
  };
  const monitors = useAdminMonitors(filters);
  const [pending, setPending] = useState<Pending>(null);
  const close = () => setPending(null);
  const sync = useProviderSync((r) => {
    const synced = t('uptime.admin.synced', {
      seen: r.monitors?.seen ?? 0,
      missing: r.monitors?.missing ?? 0,
    });
    return r.monitors?.managementError
      ? `${synced}. ${t('uptime.admin.syncManagementError', { error: r.monitors.managementError })}`
      : synced;
  });

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value && value !== 'all') next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  // A ?provider= of another kind of connection (or a removed one) still filters: keep it selectable.
  const unknownProvider =
    !!providerId && !providers.isPending && !monitoringProviders.some((p) => p.id === providerId);
  const list = monitors.data ?? [];

  return (
    <>
      <PageHeader
        title={t('nav.admin.uptime')}
        description={t('uptime.admin.subtitle')}
        actions={
          monitoringProviders.length === 1 ? (
            <Button
              icon={<RefreshCw className="size-4" />}
              loading={sync.isPending}
              onClick={() => sync.mutate(monitoringProviders[0]!.id)}
            >
              {t('uptime.admin.sync')}
            </Button>
          ) : monitoringProviders.length > 1 ? (
            <Menu
              trigger={
                <Button icon={<RefreshCw className="size-4" />} loading={sync.isPending}>
                  {t('uptime.admin.sync')}
                </Button>
              }
            >
              <MenuLabel>{t('uptime.admin.syncWhich')}</MenuLabel>
              {monitoringProviders.map((p) => (
                <MenuItem
                  key={p.id}
                  icon={<RefreshCw />}
                  onSelect={() => sync.mutate(p.id)}
                  hint={p.location.label}
                >
                  {p.name}
                </MenuItem>
              ))}
            </Menu>
          ) : null
        }
      />

      <div className="space-y-6">
        <InstancesCard
          canSignIn={can('platform:provider:write')}
          canAssign={canAssign}
          onPending={setPending}
        />

        <Card>
          <CardHeader title={t('uptime.admin.inventory')} description={t('uptime.admin.inventoryText')} />
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('uptime.admin.search')}
                className="pl-9"
                aria-label={t('common.search')}
              />
            </div>
            {(monitoringProviders.length > 1 || unknownProvider) && (
              <Select
                value={providerId ?? ''}
                onChange={(e) => set('provider', e.target.value)}
                className="w-auto max-w-[240px]"
                aria-label={t('uptime.admin.filterInstance')}
              >
                <option value="">{t('uptime.admin.allInstances')}</option>
                {monitoringProviders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                {unknownProvider && (
                  <option value={providerId}>
                    {(providers.data ?? []).find((p) => p.id === providerId)?.name ?? providerId}
                  </option>
                )}
              </Select>
            )}
            <Select
              value={orgId ?? ''}
              onChange={(e) => set('org', e.target.value)}
              className="w-auto max-w-[240px]"
              aria-label={t('uptime.admin.filterCustomer')}
            >
              <option value="">{t('uptime.admin.allCustomers')}</option>
              {(orgs.data ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
            <Select
              value={assigned ?? 'all'}
              onChange={(e) => set('assigned', e.target.value)}
              className="w-auto"
              aria-label={t('hosting.admin.filterAssigned')}
            >
              <option value="all">{t('hosting.admin.all')}</option>
              <option value="true">{t('hosting.admin.onlyAssigned')}</option>
              <option value="false">{t('hosting.admin.onlyUnassigned')}</option>
            </Select>
            <Select
              value={origin ?? 'all'}
              onChange={(e) => set('origin', e.target.value)}
              className="w-auto"
              aria-label={t('uptime.admin.filterOrigin')}
            >
              <option value="all">{t('uptime.admin.allOrigins')}</option>
              {MONITOR_ORIGINS.map((o) => (
                <option key={o} value={o}>
                  {t(ORIGIN_LABEL[o])}
                </option>
              ))}
            </Select>
            <Select
              value={status ?? 'all'}
              onChange={(e) => set('status', e.target.value)}
              className="w-auto"
              aria-label={t('uptime.filter.label')}
            >
              <option value="all">{t('uptime.filter.all')}</option>
              {MONITOR_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(STATUS_LABEL(s))}
                </option>
              ))}
            </Select>
          </div>
          {monitors.isError ? (
            <div className="p-5">
              <ErrorState error={monitors.error} onRetry={() => void monitors.refetch()} />
            </div>
          ) : monitors.isPending ? (
            <LoadingBlock rows={5} />
          ) : list.length === 0 ? (
            <EmptyState
              icon={<HeartPulse className="size-6" />}
              title={t('uptime.admin.empty')}
              description={t('uptime.admin.emptyText')}
            />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>{t('uptime.col.status')}</TH>
                  <TH>{t('uptime.col.name')}</TH>
                  <TH className="hidden 2xl:table-cell">{t('uptime.col.target')}</TH>
                  <TH className="hidden lg:table-cell">{t('uptime.col.type')}</TH>
                  <TH>{t('hosting.col.customer')}</TH>
                  <TH className="hidden lg:table-cell">{t('uptime.col.instance')}</TH>
                  <TH className="hidden sm:table-cell">{t('uptime.col.origin')}</TH>
                  <TH className="hidden 2xl:table-cell">{t('uptime.col.lastSync')}</TH>
                  {canAssign && <TH />}
                </tr>
              </THead>
              <TBody>
                {list.map((m) => (
                  <TR
                    key={m.id}
                    onClick={m.org ? () => navigate(`/o/${m.org!.slug}/monitoring/${m.id}`) : undefined}
                  >
                    <TD className="w-0">
                      <MonitorStatusBadge status={m.status} />
                    </TD>
                    <TD className="max-w-[280px]">
                      <div className="truncate font-medium text-text">{m.name}</div>
                      {m.target && <Mono className="block truncate text-muted 2xl:hidden">{m.target}</Mono>}
                      <MissingHint missingSince={m.missingSince} active={m.active} className="mt-0.5" />
                    </TD>
                    <TD className="hidden max-w-[280px] 2xl:table-cell">
                      {m.target ? (
                        <Mono className="block truncate text-muted">{m.target}</Mono>
                      ) : (
                        <span className="text-subtle">–</span>
                      )}
                    </TD>
                    <TD className="hidden lg:table-cell">
                      <KindLabel type={m.type} />
                    </TD>
                    <TD>
                      {m.org ? (
                        <Link
                          to={`/admin/customers/${m.org.id}`}
                          className="text-sm whitespace-nowrap text-text hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {m.org.name}
                        </Link>
                      ) : (
                        <Badge tone="warning">{t('hosting.admin.unassigned')}</Badge>
                      )}
                    </TD>
                    <TD className="hidden lg:table-cell">
                      <span className="inline-flex max-w-[200px] items-center gap-2">
                        <ProviderBadge type={m.provider.type} name={m.provider.name} />
                        <span className="truncate text-sm text-muted">{m.provider.name}</span>
                      </span>
                    </TD>
                    <TD className="hidden sm:table-cell">
                      <Badge tone={m.origin === 'console' ? 'primary' : 'neutral'}>
                        {t(ORIGIN_LABEL[m.origin])}
                      </Badge>
                    </TD>
                    <TD className="hidden text-sm whitespace-nowrap text-muted 2xl:table-cell">
                      {m.lastSyncedAt ? formatRelative(m.lastSyncedAt, locale) : '–'}
                    </TD>
                    {canAssign && (
                      <TD className="text-right" onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="sm"
                          variant={m.org ? 'ghost' : 'secondary'}
                          icon={<Link2 className="size-3.5" />}
                          onClick={() => setPending({ kind: 'assign', monitor: m })}
                        >
                          {m.org ? t('hosting.admin.reassign') : t('hosting.admin.assign')}
                        </Button>
                      </TD>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>

      {pending?.kind === 'assign' && (
        <AssignMonitorDialog key={pending.monitor.id} monitor={pending.monitor} onClose={close} />
      )}
      {pending?.kind === 'bulk' && (
        <BulkAssignDialog key={pending.instance.provider.id} instance={pending.instance} onClose={close} />
      )}
      {pending?.kind === 'signIn' && (
        <KumaSignInDialog key={pending.instance.provider.id} instance={pending.instance} onClose={close} />
      )}
      {pending?.kind === 'signOut' && <KumaSignOutDialog instance={pending.instance} onClose={close} />}
    </>
  );
}

// --- Instances -----------------------------------------------------------------------------

const MANAGEMENT_TONE = { off: 'neutral', ok: 'success', error: 'danger' } as const;
const MANAGEMENT_LABEL: Record<MonitoringInstanceDto['management'], TranslationKey> = {
  off: 'uptime.admin.management.off',
  ok: 'uptime.admin.management.ok',
  error: 'uptime.admin.management.error',
};

function InstancesCard({
  canSignIn,
  canAssign,
  onPending,
}: {
  canSignIn: boolean;
  canAssign: boolean;
  onPending: (pending: Pending) => void;
}) {
  const { t, locale } = useI18n();
  const instances = useMonitoringInstances();
  const list = instances.data ?? [];

  return (
    <Card>
      <CardHeader title={t('uptime.admin.instances')} description={t('uptime.admin.instancesText')} />
      {instances.isError ? (
        <div className="p-5">
          <ErrorState error={instances.error} onRetry={() => void instances.refetch()} />
        </div>
      ) : instances.isPending ? (
        <LoadingBlock rows={2} />
      ) : list.length === 0 ? (
        <EmptyState
          className="py-8"
          icon={<HeartPulse className="size-6" />}
          title={t('uptime.admin.noInstances')}
          description={t('uptime.admin.noInstancesText')}
          action={
            <Link to="/admin/providers" className="text-sm font-medium text-primary-text hover:underline">
              {t('hosting.admin.toProviders')}
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-border">
          {list.map((i) => {
            const unassigned = Math.max(0, i.monitors - i.assigned);
            const kuma = i.provider.type === 'uptimekuma';
            return (
              <li key={i.provider.id} className="flex flex-wrap items-start gap-x-6 gap-y-3 px-5 py-4">
                <div className="min-w-[220px] flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <ProviderBadge type={i.provider.type} name={i.provider.name} />
                    <Link
                      to={`/admin/providers/${i.provider.id}`}
                      className="font-medium text-text hover:underline"
                    >
                      {i.provider.name}
                    </Link>
                    {i.version && <Mono className="text-muted">{i.version}</Mono>}
                  </div>
                  <p className="text-sm text-muted">
                    {t('uptime.admin.instanceCounts', {
                      monitors: formatNumber(i.monitors, locale),
                      assigned: formatNumber(i.assigned, locale),
                    })}
                  </p>
                  {/* Only with a known version: an unreachable instance reports nothing at all. */}
                  {i.version && !i.uptimeMetrics && (
                    <p className="text-xs text-muted">{t('uptime.admin.needs21')}</p>
                  )}
                </div>
                <div className="min-w-[200px] flex-1 space-y-1">
                  <Badge tone={MANAGEMENT_TONE[i.management]}>{t(MANAGEMENT_LABEL[i.management])}</Badge>
                  {i.management === 'error' && i.managementError && (
                    <p className="text-xs break-words text-danger">{i.managementError}</p>
                  )}
                  {kuma && i.managedBy === 'env' && (
                    <p className="text-xs text-muted">{t('uptime.admin.envSession')}</p>
                  )}
                  {!kuma && <p className="text-xs text-muted">{t('uptime.admin.demoManagement')}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {kuma && i.managedBy === 'ui' && canSignIn && (
                    <>
                      <Button
                        size="sm"
                        variant={i.management === 'off' ? 'secondary' : 'ghost'}
                        icon={<LogIn className="size-3.5" />}
                        onClick={() => onPending({ kind: 'signIn', instance: i })}
                      >
                        {i.management === 'off' ? t('uptime.admin.signIn') : t('uptime.admin.signInAgain')}
                      </Button>
                      {i.management !== 'off' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<LogOut className="size-3.5" />}
                          onClick={() => onPending({ kind: 'signOut', instance: i })}
                        >
                          {t('uptime.admin.signOut')}
                        </Button>
                      )}
                    </>
                  )}
                  {canAssign && unassigned > 0 && (
                    <Button
                      size="sm"
                      icon={<Users className="size-3.5" />}
                      onClick={() => onPending({ kind: 'bulk', instance: i })}
                    >
                      {t('uptime.admin.bulkAssign')}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/**
 * Signs an instance in for management. Only the session token Uptime Kuma hands out is stored;
 * user name, password and two-factor code are sent once and dropped with the dialog.
 */
function KumaSignInDialog({ instance, onClose }: { instance: MonitoringInstanceDto; onClose: () => void }) {
  const { t } = useI18n();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [totpError, setTotpError] = useState<string | null>(null);
  const signIn = useKumaSignIn(instance.provider.id, {
    success: (r) =>
      r.version
        ? t('uptime.admin.signedInVersion', { name: r.provider.name, version: r.version })
        : t('uptime.admin.signedIn', { name: r.provider.name }),
    onSuccess: () => close(),
    error: (err) => {
      if (err instanceof ApiError && err.code === 'totp_required') {
        setNeedTotp(true);
        return null;
      }
      if (err instanceof ApiError && err.code === 'totp_invalid') {
        setNeedTotp(true);
        setTotp('');
        setTotpError(t('uptime.error.totp_invalid'));
        return null;
      }
      return monitorErrorText(t, err);
    },
  });
  // Nothing of the form outlives the dialog: state goes with it, the mutation is reset.
  const close = () => {
    setPassword('');
    setTotp('');
    signIn.reset();
    onClose();
  };
  const totpValid = /^\d{6}$/.test(totp.trim());
  const ready = !!username.trim() && !!password && (!needTotp || totpValid);

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={t('uptime.admin.signInTitle', { name: instance.provider.name })}
      description={t('uptime.admin.signInText')}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="kuma-sign-in"
            disabled={!ready}
            loading={signIn.isPending}
          >
            {t('uptime.admin.signIn')}
          </Button>
        </>
      }
    >
      <form
        id="kuma-sign-in"
        className="space-y-4"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready || signIn.isPending) return;
          setTotpError(null);
          signIn.mutate({
            username: username.trim(),
            password,
            ...(needTotp ? { totp: totp.trim() } : {}),
          });
        }}
      >
        <Notice tone="info">{t('uptime.admin.signInTokenOnly')}</Notice>
        {needTotp && !totpError && <Notice tone="warning">{t('uptime.error.totp_required')}</Notice>}
        <Field label={t('uptime.admin.username')} htmlFor="ks-user">
          <Input
            id="ks-user"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
            autoFocus
            maxLength={200}
          />
        </Field>
        <Field label={t('uptime.admin.password')} htmlFor="ks-password">
          <Input
            id="ks-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            maxLength={500}
          />
        </Field>
        {needTotp && (
          <Field
            label={t('uptime.admin.totp')}
            htmlFor="ks-totp"
            error={totpError ?? (totp && !totpValid ? t('uptime.admin.totpInvalid') : undefined)}
            hint={t('uptime.admin.totpHint')}
          >
            <Input
              id="ks-totp"
              value={totp}
              onChange={(e) => {
                setTotp(e.target.value);
                setTotpError(null);
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              className="tabular"
            />
          </Field>
        )}
      </form>
    </Dialog>
  );
}

function KumaSignOutDialog({ instance, onClose }: { instance: MonitoringInstanceDto; onClose: () => void }) {
  const { t } = useI18n();
  const signOut = useKumaSignOut(instance.provider.id, {
    success: t('uptime.admin.signedOut', { name: instance.provider.name }),
    onSuccess: onClose,
  });
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('uptime.admin.signOutTitle', { name: instance.provider.name })}
      description={t('uptime.admin.signOutText')}
      confirmLabel={t('uptime.admin.signOut')}
      loading={signOut.isPending}
      onConfirm={() => signOut.mutate(undefined)}
    />
  );
}

// --- Assignment ----------------------------------------------------------------------------

function orgLabel(t: TFunction, org: AdminOrgDto): string {
  const parts = [org.name];
  if (org.kind === 'reseller') parts.push(t('hosting.admin.kindReseller'));
  if (org.kind === 'internal') parts.push(t('hosting.admin.kindInternal'));
  if (org.status === 'suspended') parts.push(t('hosting.admin.suspended'));
  if (!org.modules.includes(MODULE)) parts.push(t('uptime.admin.noModule'));
  return parts.join(' · ');
}

/** Organizations without a reseller first, then one group per reseller (like the hosting assign dialog). */
function OrgSelect({
  id,
  value,
  onChange,
  emptyLabel,
}: {
  id: string;
  value: string;
  onChange: (orgId: string) => void;
  emptyLabel: string;
}) {
  const { t } = useI18n();
  const orgs = useAdminOrgs();
  const [filter, setFilter] = useState('');
  const all = useMemo(() => orgs.data ?? [], [orgs.data]);
  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const match = (o: AdminOrgDto) =>
      !needle || o.name.toLowerCase().includes(needle) || o.slug.includes(needle) || o.id === value;
    const direct = all.filter((o) => !o.parent && match(o));
    const below = new Map<string, { name: string; orgs: AdminOrgDto[] }>();
    for (const o of all) {
      if (!o.parent || !match(o)) continue;
      const group = below.get(o.parent.id) ?? { name: o.parent.name, orgs: [] };
      group.orgs.push(o);
      below.set(o.parent.id, group);
    }
    return { direct, below: [...below.values()] };
  }, [all, filter, value]);

  if (orgs.isError) return <ErrorState error={orgs.error} onRetry={() => void orgs.refetch()} />;
  return (
    <>
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
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={orgs.isPending}>
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
    </>
  );
}

/** The module switch of an assignment: the checkbox, or why it cannot be switched on. */
function ModuleChoice({
  target,
  enable,
  onEnable,
}: {
  target: AdminOrgDto | undefined;
  enable: boolean;
  onEnable: (value: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const orgs = useAdminOrgs();
  if (!target) return null;
  const label = MODULE_DEFS[MODULE].label[locale];
  if (target.modules.includes(MODULE)) {
    return <p className="text-sm text-muted">{t('hosting.admin.moduleActive', { module: label })}</p>;
  }
  const parent = target.parent ? orgs.data?.find((o) => o.id === target.parent?.id) : undefined;
  const resellerLacks = !!parent && !parent.modules.includes(MODULE);
  return (
    <>
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-surface-2">
        <input
          type="checkbox"
          className="mt-1 size-4 accent-[var(--primary)]"
          checked={enable}
          onChange={(e) => onEnable(e.target.checked)}
        />
        <span>
          <span className="block text-sm font-medium">
            {t('hosting.admin.enableModule', { module: label })}
          </span>
          <span className="block text-xs text-muted">
            {t('hosting.admin.enableModuleHint', { org: target.name })}
          </span>
        </span>
      </label>
      {enable && resellerLacks && parent && (
        <Notice tone="warning">
          {t('hosting.admin.resellerLacks', { reseller: parent.name, module: label })}
        </Notice>
      )}
      {!enable && <Notice tone="info">{t('uptime.admin.moduleOffAssign', { module: label })}</Notice>}
    </>
  );
}

function AssignMonitorDialog({ monitor, onClose }: { monitor: MonitorDto; onClose: () => void }) {
  const { t } = useI18n();
  const orgs = useAdminOrgs();
  const monitorError = useMonitorError();
  const current = monitor.org;
  const [orgId, setOrgId] = useState(current?.id ?? '');
  const [enable, setEnable] = useState(true);
  const [unassigning, setUnassigning] = useState(false);
  const target = orgs.data?.find((o) => o.id === orgId);
  const changed = orgId !== (current?.id ?? '');
  // Console monitors count against an allowance on their instance; staff may move them anyway.
  const allowance = useAdminMonitorAllowance(orgId, monitor.origin === 'console' && changed && !!orgId);
  const noAllowance =
    monitor.origin === 'console' &&
    changed &&
    !!orgId &&
    allowance.isSuccess &&
    allowance.data?.provider?.id !== monitor.provider.id;
  const assign = useAssignMonitor({
    success: (m, vars) =>
      vars.orgId
        ? t('hosting.admin.assigned', { name: m.name })
        : t('hosting.admin.unassignedDone', { name: m.name }),
    onSuccess: onClose,
    error: monitorError,
  });
  const resellerLacks =
    !!target &&
    !target.modules.includes(MODULE) &&
    enable &&
    !!target.parent &&
    !orgs.data?.find((o) => o.id === target.parent?.id)?.modules.includes(MODULE);

  return (
    <>
      <Dialog
        open
        onOpenChange={(o) => !o && onClose()}
        title={t('hosting.admin.assignTitle', { name: monitor.name })}
        description={t('uptime.admin.assignText', { instance: monitor.provider.name })}
        footer={
          <>
            {current && (
              <Button
                variant="danger-soft"
                className="mr-auto"
                icon={<Unlink className="size-4" />}
                onClick={() => setUnassigning(true)}
              >
                {t('hosting.admin.unassign')}
              </Button>
            )}
            <Button variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={!orgId || !changed || resellerLacks}
              loading={assign.isPending && !unassigning}
              onClick={() =>
                assign.mutate({
                  id: monitor.id,
                  orgId,
                  enableModule: enable && !!target && !target.modules.includes(MODULE),
                })
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
          <OrgSelect id="mon-assign-org" value={orgId} onChange={setOrgId} emptyLabel="–" />
          <ModuleChoice target={target} enable={enable} onEnable={setEnable} />
          {noAllowance && <Notice tone="warning">{t('uptime.admin.consoleNoAllowance')}</Notice>}
          {monitor.origin === 'kuma' && (
            <p className="text-xs text-muted">{t('uptime.admin.kumaReadOnly')}</p>
          )}
        </div>
      </Dialog>
      <ConfirmDialog
        open={unassigning}
        onOpenChange={setUnassigning}
        title={t('hosting.admin.unassignTitle', { name: monitor.name })}
        description={t('uptime.admin.unassignText', { org: current?.name ?? '' })}
        confirmLabel={t('hosting.admin.unassign')}
        loading={assign.isPending}
        onConfirm={() => assign.mutate({ id: monitor.id, orgId: null, enableModule: false })}
      />
    </>
  );
}

/** Every unassigned monitor of an instance to one organization (a dedicated instance). */
function BulkAssignDialog({ instance, onClose }: { instance: MonitoringInstanceDto; onClose: () => void }) {
  const { t, locale } = useI18n();
  const orgs = useAdminOrgs();
  const monitorError = useMonitorError();
  const [orgId, setOrgId] = useState('');
  const [enable, setEnable] = useState(true);
  const target = orgs.data?.find((o) => o.id === orgId);
  const count = Math.max(0, instance.monitors - instance.assigned);
  const bulk = useBulkAssignMonitors({
    success: (r) =>
      t('uptime.admin.bulkAssigned', { n: formatNumber(r.assigned, locale), org: target?.name ?? '' }),
    onSuccess: onClose,
    error: monitorError,
  });
  const resellerLacks =
    !!target &&
    !target.modules.includes(MODULE) &&
    enable &&
    !!target.parent &&
    !orgs.data?.find((o) => o.id === target.parent?.id)?.modules.includes(MODULE);

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('uptime.admin.bulkTitle', { name: instance.provider.name })}
      description={t('uptime.admin.bulkText', { n: formatNumber(count, locale) })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!orgId || resellerLacks}
            loading={bulk.isPending}
            onClick={() =>
              bulk.mutate({
                providerId: instance.provider.id,
                orgId,
                enableModule: enable && !!target && !target.modules.includes(MODULE),
              })
            }
          >
            {t('uptime.admin.bulkAssign')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <OrgSelect id="mon-bulk-org" value={orgId} onChange={setOrgId} emptyLabel="–" />
        <ModuleChoice target={target} enable={enable} onEnable={setEnable} />
      </div>
    </Dialog>
  );
}

// --- Allowance and status pages (customer detail) -----------------------------------------

/**
 * Monitoring allowance and status page links of an organization, on the overview tab of
 * Admin > Customers next to the cloud storage allowance. Shows itself for organizations with the
 * module or data, and to staff who may set it up; renders nothing otherwise.
 */
export function MonitorAllowanceAdminCard({
  org,
  parent,
  canWrite,
}: {
  org: AdminOrgDto;
  parent: AdminOrgDto | undefined;
  canWrite: boolean;
}) {
  const { t } = useI18n();
  const providers = useMonitoringProviders();
  const allowance = useAdminMonitorAllowance(org.id);
  const pages = useAdminStatusPages(org.id);
  const monitorError = useMonitorError();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState<MonitorStatusPageDto | null>(null);
  const remove = useDeleteAdminMonitorAllowance(org.id, {
    success: t('uptime.allowance.removed'),
    onSuccess: () => setRemoving(false),
    error: monitorError,
  });
  const unlink = useDeleteStatusPage(org.id, {
    success: (_r, page) => t('uptime.statusPage.removed', { slug: page.slug }),
    onSuccess: () => setUnlinking(null),
    error: monitorError,
  });
  const data = allowance.data ?? null;
  const pageList = pages.data ?? [];
  const hasInstances = (providers.data ?? []).length > 0;
  const show = org.modules.includes(MODULE) || !!data || pageList.length > 0 || (canWrite && hasInstances);
  if (!show) return null;

  // Like the API: only without console monitors and, for a reseller, without customer allowances.
  const removeBlocked = !data
    ? null
    : data.monitors > 0
      ? t('uptime.allowance.removeBlocked', { n: data.monitors })
      : data.customers > 0
        ? t('uptime.allowance.removeBlockedCustomers', { n: data.customers })
        : null;

  return (
    <Card>
      <CardHeader
        title={t('nav.uptime')}
        description={t('uptime.admin.cardText')}
        actions={
          canWrite &&
          !allowance.isPending &&
          !allowance.isError && (
            <Button
              size="sm"
              icon={data ? <Pencil className="size-4" /> : <Plus className="size-4" />}
              onClick={() => setEditing(true)}
            >
              {data ? t('common.edit') : t('uptime.allowance.setUp')}
            </Button>
          )
        }
      />
      {allowance.isPending ? (
        <LoadingBlock rows={2} />
      ) : allowance.isError ? (
        <div className="p-5">
          <ErrorState error={allowance.error} onRetry={() => void allowance.refetch()} />
        </div>
      ) : data ? (
        <CardBody className="space-y-4">
          <AllowanceFigures allowance={data} />
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/admin/monitoring?org=${org.id}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-primary-text hover:bg-surface-3"
            >
              <HeartPulse className="size-3.5" /> {t('uptime.admin.showMonitors')}
            </Link>
            {canWrite && (
              <Button
                size="sm"
                variant="danger-soft"
                className="ml-auto"
                icon={<Trash2 className="size-3.5" />}
                disabled={!!removeBlocked}
                title={removeBlocked ?? undefined}
                onClick={() => setRemoving(true)}
              >
                {t('uptime.allowance.remove')}
              </Button>
            )}
          </div>
          {canWrite && removeBlocked && <p className="text-xs text-muted">{removeBlocked}</p>}
        </CardBody>
      ) : (
        <EmptyState
          className="py-8"
          icon={<HeartPulse className="size-6" />}
          title={t('uptime.admin.noAllowance')}
          description={t('uptime.admin.noAllowanceText')}
        />
      )}

      <div className="border-t border-border">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-2">
          <div>
            <h4 className="text-sm font-semibold text-text">{t('uptime.statusPages')}</h4>
            <p className="text-xs text-muted">{t('uptime.statusPage.text')}</p>
          </div>
          {canWrite && hasInstances && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Plus className="size-4" />}
              onClick={() => setLinking(true)}
            >
              {t('uptime.statusPage.add')}
            </Button>
          )}
        </div>
        {pages.isError ? (
          <div className="px-5 pb-4">
            <ErrorState error={pages.error} onRetry={() => void pages.refetch()} />
          </div>
        ) : pages.isPending ? (
          <LoadingBlock rows={1} />
        ) : pageList.length === 0 ? (
          <p className="px-5 pb-4 text-sm text-muted">{t('uptime.statusPage.none')}</p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {pageList.map((p) => {
              const href = safePanelUrl(p.url);
              return (
                <li key={p.provider.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-text">
                      <Mono>{p.slug}</Mono>
                      <span className="ml-2 text-xs text-muted">{p.provider.name}</span>
                    </div>
                    {href && (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex max-w-full items-center gap-1 text-xs text-primary-text hover:underline"
                      >
                        <span className="truncate">{p.url}</span>
                        <ExternalLink className="size-3 shrink-0" aria-hidden />
                      </a>
                    )}
                  </div>
                  {canWrite && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Unlink className="size-3.5" />}
                      onClick={() => setUnlinking(p)}
                    >
                      {t('uptime.statusPage.remove')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {editing && (
        <AdminAllowanceDialog org={org} parent={parent} current={data} onClose={() => setEditing(false)} />
      )}
      {linking && <StatusPageDialog org={org} pages={pageList} onClose={() => setLinking(false)} />}
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t('uptime.allowance.removeTitle', { name: org.name })}
        description={t('uptime.allowance.removeText')}
        confirmLabel={t('uptime.allowance.remove')}
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
      <ConfirmDialog
        open={unlinking !== null}
        onOpenChange={(o) => !o && setUnlinking(null)}
        title={t('uptime.statusPage.removeTitle', { slug: unlinking?.slug ?? '' })}
        description={t('uptime.statusPage.removeText', { org: org.name })}
        confirmLabel={t('uptime.statusPage.remove')}
        loading={unlink.isPending}
        onConfirm={() => unlinking && unlink.mutate(unlinking)}
      />
    </Card>
  );
}

/** Figures of an allowance: instance, monitors against the maximum, minimum interval. */
function AllowanceFigures({ allowance }: { allowance: MonitorAllowanceDto }) {
  const { t, locale } = useI18n();
  return (
    <dl className="grid gap-4 text-sm sm:grid-cols-3">
      <div className="min-w-0">
        <dt className="text-xs text-muted">{t('uptime.allowance.instance')}</dt>
        <dd className="mt-1 truncate font-medium text-text">{allowance.provider?.name ?? '–'}</dd>
        <dd className="mt-1">
          <Badge tone={allowance.management ? 'success' : 'warning'}>
            {allowance.management ? t('uptime.admin.management.ok') : t('uptime.admin.management.off')}
          </Badge>
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted">{t('uptime.allowance.monitors')}</dt>
        <dd className="mt-1 font-semibold text-text tabular">
          {t('uptime.allowance.used', {
            n: formatNumber(allowance.committed, locale),
            max: formatNumber(allowance.maxMonitors, locale),
          })}
        </dd>
        {allowance.customers > 0 && (
          <dd className="mt-1 text-xs text-muted">
            {t('uptime.allowance.toCustomers', {
              n: formatNumber(allowance.customerMonitors, locale),
              customers: allowance.customers,
            })}
          </dd>
        )}
      </div>
      <div>
        <dt className="text-xs text-muted">{t('uptime.allowance.minInterval')}</dt>
        <dd className="mt-1 font-semibold text-text">{intervalLabel(t, allowance.minIntervalSeconds)}</dd>
      </div>
    </dl>
  );
}

/** Whole numbers from 1 on, else null. */
const parseCount = (value: string): number | null => {
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
};

function AdminAllowanceDialog({
  org,
  parent,
  current,
  onClose,
}: {
  org: AdminOrgDto;
  parent: AdminOrgDto | undefined;
  current: MonitorAllowanceDto | null;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const instances = useMonitoringInstances();
  const monitorError = useMonitorError();
  const reseller = org.kind === 'reseller';
  const [providerId, setProviderId] = useState(current?.provider?.id ?? '');
  const [max, setMax] = useState(
    String(current?.maxMonitors ?? (reseller ? RESELLER_DEFAULT_MAX_MONITORS : MONITOR_DEFAULT_MAX_MONITORS)),
  );
  const [minInterval, setMinInterval] = useState(
    current?.minIntervalSeconds ?? MONITOR_DEFAULT_MIN_INTERVAL_SECONDS,
  );
  const [enableModule, setEnableModule] = useState(true);
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const save = useSetAdminMonitorAllowance(org.id, {
    success: t('uptime.allowance.saved'),
    onSuccess: onClose,
    error: (err) => {
      const path = errorPath(err);
      if (path === 'maxMonitors' || path === 'minIntervalSeconds') {
        setFieldError({ field: path, message: errorDetail(err) ?? monitorErrorText(t, err) });
        return null;
      }
      return monitorError(err);
    },
  });

  // Creating monitors needs an instance signed in for management.
  const managed = (instances.data ?? []).filter((i) => i.management === 'ok');
  const options = [...managed];
  if (current?.provider && !options.some((i) => i.provider.id === current.provider!.id)) {
    const known = (instances.data ?? []).find((i) => i.provider.id === current.provider!.id);
    if (known) options.push(known);
  }
  const selected = providerId || options[0]?.provider.id || '';
  const selectedInstance = options.find((i) => i.provider.id === selected);
  // The instance can only change while nothing lives on the current one.
  const instanceLocked = !!current && (current.monitors > 0 || current.customers > 0);
  const sameInstance = !!current && current.provider?.id === selected;
  const minMonitors = Math.max(1, sameInstance ? current.committed : 0);
  const hasModule = org.modules.includes(MODULE);
  const moduleLabel = MODULE_DEFS[MODULE].label[locale];
  const resellerLacks = !!parent && !parent.modules.includes(MODULE);
  const choices = intervalChoices(MONITOR_MIN_INTERVAL_SECONDS, minInterval);

  const maxMonitors = parseCount(max);
  const maxError =
    fieldError?.field === 'maxMonitors'
      ? fieldError.message
      : maxMonitors === null || maxMonitors > MONITOR_MAX_MONITORS_LIMIT
        ? t('uptime.allowance.maxInvalid')
        : maxMonitors < minMonitors
          ? t('uptime.allowance.maxBelowCommitted', { n: minMonitors })
          : null;
  const blocked =
    !selected ||
    maxMonitors === null ||
    !!maxError ||
    (selectedInstance ? selectedInstance.management !== 'ok' : true) ||
    (!hasModule && enableModule && resellerLacks);

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={
        current
          ? t('uptime.allowance.editTitle', { name: org.name })
          : t('uptime.allowance.setUpTitle', { name: org.name })
      }
      description={t('uptime.allowance.dialogText')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={blocked}
            loading={save.isPending}
            onClick={() =>
              maxMonitors !== null &&
              save.mutate({
                providerId: selected,
                maxMonitors,
                minIntervalSeconds: minInterval,
                enableModule: enableModule && !hasModule,
              })
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {instances.isError ? (
          <ErrorState error={instances.error} onRetry={() => void instances.refetch()} />
        ) : instances.isPending ? (
          <LoadingBlock rows={1} />
        ) : options.length === 0 ? (
          <Notice tone="warning">{t('uptime.allowance.noManagedInstance')}</Notice>
        ) : (
          <Field
            label={t('uptime.allowance.instance')}
            htmlFor="ma-provider"
            hint={
              instanceLocked
                ? current.monitors > 0
                  ? t('uptime.allowance.instanceLocked')
                  : t('uptime.allowance.instanceLockedCustomers')
                : t('uptime.allowance.instanceHint')
            }
          >
            <Select
              id="ma-provider"
              value={selected}
              onChange={(e) => setProviderId(e.target.value)}
              disabled={instanceLocked}
            >
              {options.map((i) => (
                <option key={i.provider.id} value={i.provider.id}>
                  {i.provider.name}
                  {i.management === 'ok' ? '' : ` (${t('uptime.admin.management.off')})`}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {selectedInstance && selectedInstance.management !== 'ok' && (
          <Notice tone="warning">{t('uptime.allowance.notManaged')}</Notice>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('uptime.allowance.maxMonitors')}
            htmlFor="ma-max"
            error={maxError}
            hint={reseller ? t('uptime.allowance.maxResellerHint') : undefined}
          >
            <Input
              id="ma-max"
              type="number"
              inputMode="numeric"
              min={minMonitors}
              max={MONITOR_MAX_MONITORS_LIMIT}
              step={1}
              value={max}
              onChange={(e) => {
                setMax(e.target.value);
                setFieldError(null);
              }}
              className="tabular"
            />
          </Field>
          <Field
            label={t('uptime.allowance.minInterval')}
            htmlFor="ma-interval"
            error={fieldError?.field === 'minIntervalSeconds' ? fieldError.message : undefined}
            hint={t('uptime.allowance.minIntervalHint')}
          >
            <Select
              id="ma-interval"
              value={String(minInterval)}
              onChange={(e) => {
                setMinInterval(Number(e.target.value));
                setFieldError(null);
              }}
            >
              {choices.map((s) => (
                <option key={s} value={s}>
                  {intervalLabel(t, s)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {hasModule ? (
          <p className="text-sm text-muted">{t('hosting.admin.moduleActive', { module: moduleLabel })}</p>
        ) : (
          <>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-surface-2">
              <input
                type="checkbox"
                className="mt-1 size-4 accent-[var(--primary)]"
                checked={enableModule}
                onChange={(e) => setEnableModule(e.target.checked)}
              />
              <span>
                <span className="block text-sm font-medium">
                  {t('hosting.admin.enableModule', { module: moduleLabel })}
                </span>
                <span className="block text-xs text-muted">
                  {t('hosting.admin.enableModuleHint', { org: org.name })}
                </span>
              </span>
            </label>
            {enableModule && resellerLacks && parent && (
              <Notice tone="warning">
                {t('hosting.admin.resellerLacks', { reseller: parent.name, module: moduleLabel })}
              </Notice>
            )}
          </>
        )}
        {reseller && <Notice tone="info">{t('uptime.allowance.resellerHint')}</Notice>}
      </div>
    </Dialog>
  );
}

/** Links a status page staff created in Uptime Kuma; the API checks that it exists there. */
function StatusPageDialog({
  org,
  pages,
  onClose,
}: {
  org: AdminOrgDto;
  pages: MonitorStatusPageDto[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const providers = useMonitoringProviders();
  const monitorError = useMonitorError();
  const options = providers.data ?? [];
  const [providerId, setProviderId] = useState(options[0]?.id ?? '');
  const [slug, setSlug] = useState('');
  const [url, setUrl] = useState('');
  const [slugError, setSlugError] = useState<string | null>(null);
  const selected = providerId || options[0]?.id || '';
  const existing = pages.find((p) => p.provider.id === selected);
  const normalized = slug.trim().toLowerCase();
  const save = useSetStatusPage(org.id, {
    success: (p) => t('uptime.statusPage.saved', { slug: p.slug }),
    onSuccess: onClose,
    error: (err) => {
      // 422: Uptime Kuma has no status page with this slug.
      if (err instanceof ApiError && err.status === 422) {
        setSlugError(t('uptime.statusPage.notFound', { slug: normalized }));
        return null;
      }
      if (errorPath(err) === 'slug') {
        setSlugError(t('uptime.statusPage.slugInvalid'));
        return null;
      }
      return monitorError(err);
    },
  });
  const slugInvalid = !!normalized && !MONITOR_STATUS_PAGE_SLUG_PATTERN.test(normalized);
  const urlInvalid = !!url.trim() && !safePanelUrl(url.trim());

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('uptime.statusPage.addTitle', { name: org.name })}
      description={t('uptime.statusPage.dialogText')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!selected || !normalized || slugInvalid || urlInvalid}
            loading={save.isPending}
            onClick={() => {
              setSlugError(null);
              save.mutate({ providerId: selected, slug: normalized, url: url.trim() });
            }}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {options.length > 1 && (
          <Field label={t('uptime.allowance.instance')} htmlFor="sp-provider">
            <Select id="sp-provider" value={selected} onChange={(e) => setProviderId(e.target.value)}>
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {existing && <Notice tone="info">{t('uptime.statusPage.replaces', { slug: existing.slug })}</Notice>}
        <Field
          label={t('uptime.statusPage.slug')}
          htmlFor="sp-slug"
          error={slugError ?? (slugInvalid ? t('uptime.statusPage.slugInvalid') : undefined)}
          hint={t('uptime.statusPage.slugHint')}
        >
          <Input
            id="sp-slug"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugError(null);
            }}
            placeholder="muster-ag"
            className="font-mono"
            maxLength={64}
            spellCheck={false}
            autoFocus
          />
        </Field>
        <Field
          label={t('uptime.statusPage.url')}
          htmlFor="sp-url"
          error={urlInvalid ? t('uptime.statusPage.urlInvalid') : undefined}
          hint={t('uptime.statusPage.urlHint')}
        >
          <Input
            id="sp-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://status.example.ch"
            className="font-mono"
            maxLength={500}
            inputMode="url"
            spellCheck={false}
          />
        </Field>
      </div>
    </Dialog>
  );
}
