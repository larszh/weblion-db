import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ExternalLink, Link2, MoreHorizontal, Phone, Plus, RefreshCw, Search, Unlink } from 'lucide-react';
import { MODULE_DEFS, type AdminOrgDto, type Permission, type PhoneSystemDto } from '@weblion/shared';
import { formatDate, formatRelative } from '@/lib/format';
import { useI18n, type TFunction } from '@/lib/i18n';
import { useAdminOrgs, useAdminProviders, useMe } from '@/lib/queries';
import { useProviderSync } from '@/lib/api/hosting';
import {
  isPhoneProvider,
  useAdminPhoneSystems,
  useAssignPhoneSystem,
  type AdminPhoneFilters,
} from '@/lib/api/phone';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Menu, MenuItem, MenuLabel, MenuSeparator, Tooltip } from '@/components/ui/menu';
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
  PageHeader,
  Select,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ProviderBadge } from '@/components/server-bits';
import {
  EditionLabel,
  LicenseText,
  PHONE_STATUS_TONE,
  TrunksFigure,
  UsersFigure,
  reasonText,
  usePhoneError,
} from '@/pages/phone/bits';

/**
 * Phone systems of every connection with their assignment (/admin/phone). `?provider=` filters
 * by connection (the provider detail page links here with it), `?assigned=` and `?org=` too.
 */

type Pending =
  { kind: 'assign'; system: PhoneSystemDto } | { kind: 'unassign'; system: PhoneSystemDto } | null;

function usePlatformCan() {
  const me = useMe();
  const perms = me.data?.platformPermissions ?? [];
  return (permission: Permission) => perms.includes(permission);
}

export function AdminPhonePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const can = usePlatformCan();
  const canAssign = can('platform:server:assign');
  const [params, setParams] = useSearchParams();
  const assignedParam = params.get('assigned');
  const assigned = assignedParam === 'true' || assignedParam === 'false' ? assignedParam : undefined;
  const orgId = params.get('org') ?? undefined;
  const providerId = params.get('provider') ?? undefined;
  const [q, setQ] = useState('');
  const providers = useAdminProviders();
  const orgs = useAdminOrgs();
  const phoneProviders = (providers.data ?? []).filter(isPhoneProvider);
  const filters: AdminPhoneFilters = { q: q.trim() || undefined, assigned, providerId, orgId };
  const systems = useAdminPhoneSystems(filters);
  const [pending, setPending] = useState<Pending>(null);
  const close = () => setPending(null);
  const phoneError = usePhoneError();
  const unassign = useAssignPhoneSystem({
    success: (r) => t('phone.admin.unassignedDone', { name: r.name }),
    onSuccess: close,
    error: phoneError,
  });
  const sync = useProviderSync((r) =>
    t('phone.admin.synced', { seen: r.phoneSystems?.seen ?? 0, missing: r.phoneSystems?.missing ?? 0 }),
  );

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value && value !== 'all') next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const list = systems.data ?? [];
  // A ?provider= of another kind of connection (or a removed one) still filters: keep it selectable.
  const unknownProvider =
    !!providerId && !providers.isPending && !phoneProviders.some((p) => p.id === providerId);

  return (
    <>
      <PageHeader
        title={t('nav.admin.phone')}
        description={t('phone.admin.subtitle')}
        actions={
          <>
            {can('platform:provider:write') && (
              <Button icon={<Plus className="size-4" />} onClick={() => navigate('/admin/providers')}>
                {t('phone.admin.addProvider')}
              </Button>
            )}
            {phoneProviders.length === 1 ? (
              <Button
                icon={<RefreshCw className="size-4" />}
                loading={sync.isPending}
                onClick={() => sync.mutate(phoneProviders[0]!.id)}
              >
                {t('phone.admin.sync')}
              </Button>
            ) : phoneProviders.length > 1 ? (
              <Menu
                trigger={
                  <Button icon={<RefreshCw className="size-4" />} loading={sync.isPending}>
                    {t('phone.admin.sync')}
                  </Button>
                }
              >
                <MenuLabel>{t('phone.admin.syncWhich')}</MenuLabel>
                {phoneProviders.map((p) => (
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
            ) : null}
          </>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('phone.admin.search')}
              className="pl-9"
              aria-label={t('common.search')}
            />
          </div>
          {(phoneProviders.length > 1 || unknownProvider) && (
            <Select
              value={providerId ?? ''}
              onChange={(e) => set('provider', e.target.value)}
              className="w-auto max-w-[240px]"
              aria-label={t('phone.admin.filterProvider')}
            >
              <option value="">{t('phone.admin.allProviders')}</option>
              {phoneProviders.map((p) => (
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
            value={assigned ?? 'all'}
            onChange={(e) => set('assigned', e.target.value)}
            className="w-auto"
            aria-label={t('phone.admin.filterAssigned')}
          >
            <option value="all">{t('phone.admin.all')}</option>
            <option value="true">{t('phone.admin.onlyAssigned')}</option>
            <option value="false">{t('phone.admin.onlyUnassigned')}</option>
          </Select>
          <Select
            value={orgId ?? ''}
            onChange={(e) => set('org', e.target.value)}
            className="w-auto max-w-[260px]"
            aria-label={t('phone.admin.filterCustomer')}
          >
            <option value="">{t('phone.admin.allCustomers')}</option>
            {(orgs.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>
        {systems.isError ? (
          <div className="p-5">
            <ErrorState error={systems.error} onRetry={() => void systems.refetch()} />
          </div>
        ) : systems.isPending ? (
          <LoadingBlock rows={5} />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Phone className="size-6" />}
            title={t('phone.admin.empty')}
            description={t('phone.admin.emptyText')}
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>{t('phone.admin.col.name')}</TH>
                <TH className="hidden lg:table-cell">{t('phone.admin.col.provider')}</TH>
                <TH>{t('phone.admin.col.customer')}</TH>
                <TH className="hidden sm:table-cell">{t('phone.admin.col.status')}</TH>
                <TH className="hidden 2xl:table-cell">{t('phone.admin.col.version')}</TH>
                <TH className="hidden 2xl:table-cell">{t('phone.admin.col.edition')}</TH>
                <TH className="hidden md:table-cell">{t('phone.admin.col.license')}</TH>
                <TH className="hidden lg:table-cell">{t('phone.admin.col.users')}</TH>
                <TH className="hidden xl:table-cell">{t('phone.admin.col.trunks')}</TH>
                <TH className="hidden 2xl:table-cell">{t('phone.admin.col.synced')}</TH>
                <TH />
              </tr>
            </THead>
            <TBody>
              {list.map((s) => (
                <SystemRow key={s.id} system={s} canAssign={canAssign} onPending={setPending} />
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {pending?.kind === 'assign' && (
        <AssignPhoneSystemDialog key={pending.system.id} system={pending.system} onClose={close} />
      )}
      <ConfirmDialog
        open={pending?.kind === 'unassign'}
        onOpenChange={(o) => !o && !unassign.isPending && close()}
        title={t('phone.admin.unassignTitle', { name: pending?.system.name ?? '' })}
        description={t('phone.admin.unassignText', { org: pending?.system.org?.name ?? '' })}
        confirmLabel={t('phone.admin.unassign')}
        loading={unassign.isPending}
        onConfirm={() =>
          pending && unassign.mutate({ id: pending.system.id, orgId: null, enableModule: false })
        }
      />
    </>
  );
}

function SystemRow({
  system: s,
  canAssign,
  onPending,
}: {
  system: PhoneSystemDto;
  canAssign: boolean;
  onPending: (pending: Pending) => void;
}) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const consoleUrl = s.org ? `/o/${s.org.slug}/phone/${s.id}` : null;
  return (
    <TR onClick={consoleUrl ? () => navigate(consoleUrl) : undefined}>
      <TD className="max-w-[280px]">
        <div className="flex items-center gap-3">
          <Phone className="size-4 shrink-0 text-muted" aria-hidden />
          <div className="min-w-0">
            <div className="truncate font-medium text-text">{s.name}</div>
            {s.info?.fqdn && <Mono className="block truncate text-xs text-muted">{s.info.fqdn}</Mono>}
            <div className="mt-1 flex flex-wrap items-center gap-1.5 lg:hidden">
              <ProviderBadge type={s.provider.type} name={s.provider.name} />
              <span className="sm:hidden">
                <StatusCell system={s} />
              </span>
            </div>
          </div>
        </div>
      </TD>
      <TD className="hidden lg:table-cell">
        <span className="inline-flex max-w-[220px] items-center gap-2">
          <ProviderBadge type={s.provider.type} name={s.provider.name} />
          <Link
            to={`/admin/providers/${s.provider.id}`}
            className="truncate text-sm text-text hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {s.provider.name}
          </Link>
        </span>
      </TD>
      <TD>
        {s.org ? (
          <Link
            to={`/admin/customers/${s.org.id}`}
            className="text-sm whitespace-nowrap text-text hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {s.org.name}
          </Link>
        ) : (
          <Badge tone="warning">{t('phone.admin.unassigned')}</Badge>
        )}
      </TD>
      <TD className="hidden sm:table-cell">
        <StatusCell system={s} />
      </TD>
      <TD className="hidden whitespace-nowrap 2xl:table-cell">
        {s.info?.version ? <Mono>{s.info.version}</Mono> : <span className="text-subtle">–</span>}
      </TD>
      <TD className="hidden whitespace-nowrap 2xl:table-cell">
        {s.info?.edition ? (
          <EditionLabel edition={s.info.edition} productCode={s.info.productCode} />
        ) : (
          <span className="text-subtle">–</span>
        )}
      </TD>
      <TD className="hidden text-sm whitespace-nowrap md:table-cell">
        <LicenseText expiresAt={s.info?.licenseExpiresAt} prefix={false} />
      </TD>
      <TD className="hidden whitespace-nowrap lg:table-cell">
        <UsersFigure info={s.info} />
      </TD>
      <TD className="hidden whitespace-nowrap xl:table-cell">
        <TrunksFigure info={s.info} />
      </TD>
      <TD className="hidden text-sm whitespace-nowrap text-muted 2xl:table-cell">
        {s.lastSyncedAt ? formatRelative(s.lastSyncedAt, locale) : '–'}
      </TD>
      <TD className="w-12 text-right" onClick={(e) => e.stopPropagation()}>
        {(consoleUrl || canAssign) && (
          <Menu
            trigger={
              <Button
                size="icon"
                variant="ghost"
                aria-label={t('common.actions')}
                title={t('common.actions')}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            }
          >
            {consoleUrl && s.org && (
              <MenuItem icon={<ExternalLink />} onSelect={() => navigate(consoleUrl)} hint={s.org.name}>
                {t('phone.admin.openInConsole')}
              </MenuItem>
            )}
            {consoleUrl && canAssign && <MenuSeparator />}
            {canAssign && (
              <MenuItem icon={<Link2 />} onSelect={() => onPending({ kind: 'assign', system: s })}>
                {s.org ? t('phone.admin.reassign') : t('phone.admin.assign')}
              </MenuItem>
            )}
            {canAssign && s.org && (
              <MenuItem icon={<Unlink />} onSelect={() => onPending({ kind: 'unassign', system: s })}>
                {t('phone.admin.unassign')}
              </MenuItem>
            )}
          </Menu>
        )}
      </TD>
    </TR>
  );
}

/** Status with the reasons on hover, and the date for phone systems the provider no longer reports. */
function StatusCell({ system }: { system: PhoneSystemDto }) {
  const { t, locale } = useI18n();
  const badge = <Badge tone={PHONE_STATUS_TONE[system.status]}>{t(`phone.status.${system.status}`)}</Badge>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {system.statusReasons.length > 0 ? (
        <Tooltip content={system.statusReasons.map((r) => reasonText(t, r)).join(' ')}>
          <span tabIndex={0}>{badge}</span>
        </Tooltip>
      ) : (
        badge
      )}
      {system.missingSince && (
        <Badge tone="danger">
          {t('phone.admin.missingSince', { date: formatDate(system.missingSince, locale, false) })}
        </Badge>
      )}
    </span>
  );
}

// --- Assignment ------------------------------------------------------------------------

function orgLabel(t: TFunction, org: AdminOrgDto): string {
  const parts = [org.name];
  if (org.kind === 'reseller') parts.push(t('hosting.admin.kindReseller'));
  if (org.kind === 'internal') parts.push(t('hosting.admin.kindInternal'));
  if (org.status === 'suspended') parts.push(t('hosting.admin.suspended'));
  return parts.join(' · ');
}

/**
 * Customer select (organizations without a reseller first, then one group per reseller) and the
 * module switch. The reseller of a customer needs the module itself (the API checks it too).
 */
function AssignPhoneSystemDialog({ system, onClose }: { system: PhoneSystemDto; onClose: () => void }) {
  const { t, locale } = useI18n();
  const orgs = useAdminOrgs();
  const current = system.org;
  const [orgId, setOrgId] = useState(current?.id ?? '');
  const [filter, setFilter] = useState('');
  const [enableModule, setEnableModule] = useState(true);
  const moduleLabel = MODULE_DEFS.phone.label[locale];
  const all = orgs.data ?? [];
  const byId = new Map(all.map((o) => [o.id, o]));
  const selected = byId.get(orgId) ?? null;
  const reseller = selected?.parent ? (byId.get(selected.parent.id) ?? null) : null;
  const hasModule = !!selected?.modules.includes('phone');
  const resellerLacks = !!reseller && !reseller.modules.includes('phone');
  const assign = useAssignPhoneSystem({
    success: (r) => t('phone.admin.assigned', { name: r.name, org: r.org?.name ?? '' }),
    onSuccess: onClose,
    error: usePhoneError(),
  });

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

  const changed = orgId !== (current?.id ?? '');
  const blocked = !orgId || !changed || (!hasModule && enableModule && resellerLacks);

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !assign.isPending && onClose()}
      title={t('phone.admin.assignTitle', { name: system.name })}
      description={t('phone.admin.assignText')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={assign.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={blocked}
            loading={assign.isPending}
            onClick={() => assign.mutate({ id: system.id, orgId, enableModule: enableModule && !hasModule })}
          >
            {current ? t('phone.admin.reassign') : t('phone.admin.assign')}
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
        {orgs.isError ? (
          <ErrorState error={orgs.error} onRetry={() => void orgs.refetch()} />
        ) : (
          <>
            {all.length > 8 && (
              <Field label={t('hosting.admin.findCustomer')} htmlFor="phone-assign-filter">
                <Input
                  id="phone-assign-filter"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={t('common.search')}
                />
              </Field>
            )}
            <Field label={t('phone.admin.col.customer')} htmlFor="phone-assign-org">
              <Select
                id="phone-assign-org"
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
                disabled={orgs.isPending}
              >
                <option value="">–</option>
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
        )}
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
                  onChange={(e) => setEnableModule(e.target.checked)}
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
                <Notice tone="info">{t('phone.admin.moduleOff', { module: moduleLabel })}</Notice>
              )}
            </>
          ))}
      </div>
    </Dialog>
  );
}
