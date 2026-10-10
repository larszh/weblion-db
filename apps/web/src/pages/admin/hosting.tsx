import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  CalendarPlus,
  Globe,
  HardDrive,
  Layers,
  Link2,
  Mail,
  MoreHorizontal,
  RefreshCw,
  RotateCw,
  Search,
  Unlink,
} from 'lucide-react';
import {
  MODULE_DEFS,
  type AdminOrgDto,
  type DomainDto,
  type ModuleKey,
  type WebspaceDto,
} from '@weblion/shared';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { useAdminOrgs, useAdminProviders, useMe } from '@/lib/queries';
import {
  useAdminDomains,
  useAdminWebspaces,
  useAssignHosting,
  useProviderSync,
  type AdminHostingFilters,
  type DomainActionResult,
} from '@/lib/api/hosting';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/components/ui/menu';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Notice,
  PageHeader,
  Select,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Flag, ProviderBadge } from '@/components/server-bits';
import { AutoRenewBadge, DomainStatusBadge, ExpiryText, resourceItems } from '@/pages/hosting/bits';
import {
  ActionResultNotice,
  AutoRenewDialog,
  RenewDialog,
  useCanRenew,
  type RenewalTarget,
} from '@/pages/hosting/domain-actions';
import { AdminCloudTab, isCloudProvider } from './cloud';
import { AdminMailTab, isMailProvider } from './mail';

type Tab = 'domains' | 'webspaces' | 'cloud' | 'mail';
type Item = { type: 'domain'; row: DomainDto } | { type: 'webspace'; row: WebspaceDto };

const MODULE_OF: Record<Item['type'], ModuleKey> = { domain: 'dns', webspace: 'webhosting' };

/**
 * Provider types that have domains or web spaces. Proxmox has neither, Joker.com only
 * domains, Cloudflare only DNS zones.
 */
const HOSTING_PROVIDERS = new Set(['fire24', 'joker', 'cloudflare', 'demo']);

export function AdminHostingPage() {
  const { t } = useI18n();
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: Tab =
    tabParam === 'webspaces' || tabParam === 'cloud' || tabParam === 'mail' ? tabParam : 'domains';
  const assignedParam = params.get('assigned');
  const assigned = assignedParam === 'true' || assignedParam === 'false' ? assignedParam : undefined;
  const providerId = params.get('provider') ?? undefined;
  const [q, setQ] = useState('');
  const filters: AdminHostingFilters = { q: q.trim() || undefined, assigned, providerId };
  const providers = useAdminProviders();
  // The sync button covers what the tab shows: cloud instances on the cloud tab, mail
  // servers on the mail tab.
  const hostingProviders = (providers.data ?? []).filter((p) =>
    tab === 'cloud' ? isCloudProvider(p) : tab === 'mail' ? isMailProvider(p) : HOSTING_PROVIDERS.has(p.type),
  );
  const perms = me.data?.platformPermissions ?? [];
  const canAssign = perms.includes('platform:server:assign');
  const [assigning, setAssigning] = useState<Item | null>(null);
  const sync = useProviderSync((r) =>
    tab === 'cloud'
      ? t('storage.admin.synced', {
          seen: r.cloudAccounts?.seen ?? 0,
          missing: r.cloudAccounts?.missing ?? 0,
        })
      : tab === 'mail'
        ? t('mail.admin.synced', { seen: r.mailDomains?.seen ?? 0, missing: r.mailDomains?.missing ?? 0 })
        : t('hosting.admin.synced', {
            domains: r.domains?.seen ?? 0,
            webspaces: r.webspaces?.seen ?? 0,
            servers: r.seen,
          }),
  );

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value && value !== 'all') next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title={t('nav.admin.hosting')}
        description={t('hosting.admin.subtitle')}
        actions={
          hostingProviders.length === 1 ? (
            <Button
              icon={<RefreshCw className="size-4" />}
              loading={sync.isPending}
              onClick={() => sync.mutate(hostingProviders[0]!.id)}
            >
              {t('hosting.admin.sync')}
            </Button>
          ) : hostingProviders.length > 1 ? (
            <Menu
              trigger={
                <Button icon={<RefreshCw className="size-4" />} loading={sync.isPending}>
                  {t('hosting.admin.sync')}
                </Button>
              }
            >
              <MenuLabel>{t('hosting.admin.syncWhich')}</MenuLabel>
              {hostingProviders.map((p) => (
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

      <div className="mb-4 overflow-x-auto border-b border-border">
        <nav className="-mb-px flex min-w-max gap-1" aria-label={t('nav.admin.hosting')}>
          {(
            [
              ['domains', 'hosting.admin.tab.domains', <Globe key="d" className="size-4" />],
              ['webspaces', 'hosting.admin.tab.webspaces', <Layers key="w" className="size-4" />],
              ['cloud', 'storage.admin.tab', <HardDrive key="c" className="size-4" />],
              ['mail', 'mail.admin.tab', <Mail key="m" className="size-4" />],
            ] as const
          ).map(([value, label, icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => set('tab', value === 'domains' ? '' : value)}
              className={cn(
                'inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
                tab === value
                  ? 'border-brand-blue text-primary-text'
                  : 'border-transparent text-muted hover:border-border-strong hover:text-text',
              )}
              aria-current={tab === value ? 'page' : undefined}
            >
              {icon}
              {t(label)}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'cloud' ? (
        <AdminCloudTab />
      ) : tab === 'mail' ? (
        <AdminMailTab />
      ) : (
        <>
          <Notice tone="info" className="mb-4">
            {tab === 'domains' ? t('hosting.admin.orderDomains') : t('hosting.admin.orderWebspaces')}{' '}
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
                  placeholder={
                    tab === 'domains' ? t('hosting.admin.searchDomains') : t('hosting.admin.searchWebspaces')
                  }
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
              {hostingProviders.length > 1 && (
                <Select
                  value={providerId ?? ''}
                  onChange={(e) => set('provider', e.target.value)}
                  className="w-auto"
                  aria-label={t('hosting.admin.filterProvider')}
                >
                  <option value="">{t('hosting.admin.allProviders')}</option>
                  {hostingProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              )}
            </div>
            {tab === 'domains' ? (
              <DomainInventory
                filters={filters}
                canAssign={canAssign}
                onAssign={(row) => setAssigning({ type: 'domain', row })}
              />
            ) : (
              <WebspaceInventory
                filters={filters}
                canAssign={canAssign}
                onAssign={(row) => setAssigning({ type: 'webspace', row })}
              />
            )}
          </Card>
        </>
      )}
      {assigning && (
        <AssignDialog key={assigning.row.id} item={assigning} onClose={() => setAssigning(null)} />
      )}
    </>
  );
}

function CustomerCell({ org }: { org: DomainDto['org'] }) {
  const { t } = useI18n();
  if (!org) return <span className="text-sm text-warning">{t('hosting.admin.unassigned')}</span>;
  return (
    <Link
      to={`/admin/customers/${org.id}`}
      className="text-sm text-text hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      {org.name}
    </Link>
  );
}

function AssignButton({ assigned, onClick }: { assigned: boolean; onClick: () => void }) {
  const { t } = useI18n();
  return (
    <Button
      size="sm"
      variant={assigned ? 'ghost' : 'secondary'}
      icon={<Link2 className="size-3.5" />}
      onClick={onClick}
    >
      {assigned ? t('hosting.admin.reassign') : t('hosting.admin.assign')}
    </Button>
  );
}

function InventoryState({
  query,
  empty,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  empty: { icon: ReactNode; title: string; text: string } | null;
}) {
  if (query.isError)
    return (
      <div className="p-5">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  if (query.isPending) return <LoadingBlock rows={5} />;
  if (empty) return <EmptyState icon={empty.icon} title={empty.title} description={empty.text} />;
  return null;
}

function DomainInventory({
  filters,
  canAssign,
  onAssign,
}: {
  filters: AdminHostingFilters;
  canAssign: boolean;
  onAssign: (row: DomainDto) => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const domains = useAdminDomains(filters);
  const canRenew = useCanRenew();
  /** Open renewal dialog: auto-renew switch (with the target state) or a manual renewal. */
  const [renewal, setRenewal] = useState<
    | { kind: 'auto'; domain: RenewalTarget; enabled: boolean }
    | { kind: 'renew'; domain: RenewalTarget }
    | null
  >(null);
  const [done, setDone] = useState<{ title: string; result: DomainActionResult; provider: string } | null>(
    null,
  );
  const renewable = (d: DomainDto) =>
    canRenew && (d.capabilities.includes('autoRenew') || d.capabilities.includes('renew'));
  const showActions = canAssign || (domains.data ?? []).some(renewable);
  if (!domains.data || domains.data.length === 0) {
    return (
      <InventoryState
        query={domains}
        empty={{
          icon: <Globe className="size-6" />,
          title: t('hosting.admin.emptyDomains'),
          text: t('hosting.admin.emptyText'),
        }}
      />
    );
  }
  return (
    <>
      {done && (
        <div className="border-b border-border px-4 py-3">
          <ActionResultNotice title={done.title} result={done.result} provider={done.provider} />
        </div>
      )}
      <Table>
        <THead>
          <tr>
            <TH>{t('hosting.col.domain')}</TH>
            <TH className="hidden sm:table-cell">{t('hosting.col.status')}</TH>
            <TH className="hidden md:table-cell">{t('hosting.col.expires')}</TH>
            <TH className="hidden xl:table-cell">{t('hosting.col.autoRenew')}</TH>
            <TH>{t('hosting.col.customer')}</TH>
            <TH className="hidden lg:table-cell">{t('hosting.col.location')}</TH>
            {showActions && <TH />}
          </tr>
        </THead>
        <TBody>
          {domains.data.map((d) => (
            <TR key={d.id} onClick={d.org ? () => navigate(`/o/${d.org!.slug}/domains/${d.id}`) : undefined}>
              <TD>
                <div className="flex items-center gap-3">
                  <Globe className="size-4 shrink-0 text-muted" aria-hidden />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-text">{d.name}</div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <ProviderBadge type={d.provider.type} name={d.provider.name} />
                      {d.missingSince && <Badge tone="danger">{t('hosting.status.missing')}</Badge>}
                    </div>
                  </div>
                </div>
              </TD>
              <TD className="hidden sm:table-cell">
                <DomainStatusBadge domain={d} />
              </TD>
              <TD className="hidden whitespace-nowrap md:table-cell">
                <ExpiryText expiresAt={d.expiresAt} autoRenew={d.autoRenew} />
              </TD>
              <TD className="hidden xl:table-cell">
                <AutoRenewBadge value={d.autoRenew} />
              </TD>
              <TD>
                <CustomerCell org={d.org} />
              </TD>
              <TD className="hidden lg:table-cell">
                <span className="inline-flex items-center gap-2 text-sm">
                  <Flag country={d.location.country} />
                  <span className="truncate">{d.location.city ?? d.location.label}</span>
                </span>
              </TD>
              {showActions && (
                <TD className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  <div className="inline-flex items-center gap-1">
                    {canAssign && <AssignButton assigned={!!d.org} onClick={() => onAssign(d)} />}
                    {renewable(d) && (
                      <RenewalMenu
                        domain={d}
                        onAutoRenew={(enabled) =>
                          setRenewal({ kind: 'auto', domain: renewalTarget(d), enabled })
                        }
                        onRenew={() => setRenewal({ kind: 'renew', domain: renewalTarget(d) })}
                      />
                    )}
                  </div>
                </TD>
              )}
            </TR>
          ))}
        </TBody>
      </Table>
      {renewal?.kind === 'auto' && (
        <AutoRenewDialog
          domain={renewal.domain}
          enabled={renewal.enabled}
          onClose={() => setRenewal(null)}
          onDone={(result) =>
            setDone({
              title: renewal.enabled
                ? t('hosting.renewal.enabledToast', { name: renewal.domain.name })
                : t('hosting.renewal.disabledToast', { name: renewal.domain.name }),
              result,
              provider: renewal.domain.provider.name,
            })
          }
        />
      )}
      {renewal?.kind === 'renew' && (
        <RenewDialog
          domain={renewal.domain}
          onClose={() => setRenewal(null)}
          onDone={(result) =>
            setDone({
              title: t('hosting.renewal.renewedToast', { name: renewal.domain.name }),
              result,
              provider: renewal.domain.provider.name,
            })
          }
        />
      )}
    </>
  );
}

const renewalTarget = (d: DomainDto): RenewalTarget => ({
  id: d.id,
  name: d.name,
  expiresAt: d.expiresAt,
  provider: d.provider,
});

/** Platform staff only (platform:domain:write): registrar renewals cost money. */
function RenewalMenu({
  domain,
  onAutoRenew,
  onRenew,
}: {
  domain: DomainDto;
  onAutoRenew: (enabled: boolean) => void;
  onRenew: () => void;
}) {
  const { t } = useI18n();
  const caps = domain.capabilities;
  return (
    <Menu
      trigger={
        <Button size="icon" variant="ghost" aria-label={t('common.actions')} title={t('common.actions')}>
          <MoreHorizontal className="size-4" />
        </Button>
      }
    >
      <MenuLabel>{t('hosting.renewal.title')}</MenuLabel>
      {caps.includes('autoRenew') && (
        <MenuItem
          icon={<RotateCw />}
          onSelect={() => onAutoRenew(domain.autoRenew !== true)}
          hint={
            domain.autoRenew === true
              ? t('hosting.autoRenew.onLong')
              : domain.autoRenew === false
                ? t('hosting.autoRenew.offLong')
                : undefined
          }
        >
          {domain.autoRenew === true ? t('hosting.admin.autoRenewOff') : t('hosting.admin.autoRenewOn')}
        </MenuItem>
      )}
      {caps.includes('autoRenew') && caps.includes('renew') && <MenuSeparator />}
      {caps.includes('renew') && (
        <MenuItem icon={<CalendarPlus />} onSelect={onRenew}>
          {t('hosting.admin.renewNow')}
        </MenuItem>
      )}
    </Menu>
  );
}

function WebspaceInventory({
  filters,
  canAssign,
  onAssign,
}: {
  filters: AdminHostingFilters;
  canAssign: boolean;
  onAssign: (row: WebspaceDto) => void;
}) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const webspaces = useAdminWebspaces(filters);
  if (!webspaces.data || webspaces.data.length === 0) {
    return (
      <InventoryState
        query={webspaces}
        empty={{
          icon: <Layers className="size-6" />,
          title: t('hosting.admin.emptyWebspaces'),
          text: t('hosting.admin.emptyText'),
        }}
      />
    );
  }
  return (
    <Table>
      <THead>
        <tr>
          <TH>{t('hosting.col.webspace')}</TH>
          <TH className="hidden md:table-cell">{t('hosting.col.resources')}</TH>
          <TH className="hidden lg:table-cell">{t('hosting.col.expires')}</TH>
          <TH>{t('hosting.col.customer')}</TH>
          {canAssign && <TH />}
        </tr>
      </THead>
      <TBody>
        {webspaces.data.map((w) => {
          const res = Object.fromEntries(resourceItems(t, locale, w.resources).map((r) => [r.key, r.value]));
          return (
            <TR
              key={w.id}
              onClick={w.org ? () => navigate(`/o/${w.org!.slug}/webhosting/${w.id}`) : undefined}
            >
              <TD>
                <div className="flex items-center gap-3">
                  <Layers className="size-4 shrink-0 text-muted" aria-hidden />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-text">{w.name}</div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <ProviderBadge type={w.provider.type} name={w.provider.name} />
                      <Flag country={w.location.country} />
                      {w.missingSince && <Badge tone="danger">{t('hosting.status.missing')}</Badge>}
                    </div>
                  </div>
                </div>
              </TD>
              <TD className="hidden text-sm whitespace-nowrap text-muted md:table-cell">
                {t('hosting.admin.resourcesLine', {
                  storage: res.storage,
                  emails: res.emails,
                  databases: res.databases,
                })}
              </TD>
              <TD className="hidden whitespace-nowrap lg:table-cell">
                <ExpiryText expiresAt={w.expiresAt} />
              </TD>
              <TD>
                <CustomerCell org={w.org} />
              </TD>
              {canAssign && (
                <TD className="text-right" onClick={(e) => e.stopPropagation()}>
                  <AssignButton assigned={!!w.org} onClick={() => onAssign(w)} />
                </TD>
              )}
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

function orgLabel(t: ReturnType<typeof useI18n>['t'], org: AdminOrgDto): string {
  const parts = [org.name];
  if (org.kind === 'reseller') parts.push(t('hosting.admin.kindReseller'));
  if (org.kind === 'internal') parts.push(t('hosting.admin.kindInternal'));
  if (org.status === 'suspended') parts.push(t('hosting.admin.suspended'));
  return parts.join(' · ');
}

function AssignDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const { t, locale } = useI18n();
  const orgs = useAdminOrgs();
  const current = item.row.org;
  const [orgId, setOrgId] = useState(current?.id ?? '');
  const [filter, setFilter] = useState('');
  const [enableModule, setEnableModule] = useState(true);
  const [unassigning, setUnassigning] = useState(false);
  const module = MODULE_OF[item.type];
  const moduleLabel = MODULE_DEFS[module].label[locale];
  const assign = useAssignHosting({
    success: (vars) =>
      vars.orgId
        ? t('hosting.admin.assigned', { name: item.row.name })
        : t('hosting.admin.unassignedDone', { name: item.row.name }),
    onSuccess: onClose,
  });

  const all = orgs.data ?? [];
  const byId = new Map(all.map((o) => [o.id, o]));
  const selected = byId.get(orgId) ?? null;
  const reseller = selected?.parent ? (byId.get(selected.parent.id) ?? null) : null;
  const hasModule = !!selected?.modules.includes(module);
  const resellerLacks = !!reseller && !reseller.modules.includes(module);

  // Organizations without a reseller first, then one group per reseller.
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
    <>
      <Dialog
        open
        onOpenChange={(o) => !o && onClose()}
        title={t('hosting.admin.assignTitle', { name: item.row.name })}
        description={
          item.type === 'domain' ? t('hosting.admin.assignTextDomain') : t('hosting.admin.assignTextWebspace')
        }
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
              disabled={blocked}
              loading={assign.isPending && !unassigning}
              onClick={() =>
                assign.mutate({
                  type: item.type,
                  id: item.row.id,
                  orgId,
                  enableModule: enableModule && !hasModule,
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
          {orgs.isError ? (
            <ErrorState error={orgs.error} onRetry={() => void orgs.refetch()} />
          ) : (
            <>
              {all.length > 8 && (
                <Field label={t('hosting.admin.findCustomer')} htmlFor="hs-filter">
                  <Input
                    id="hs-filter"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder={t('common.search')}
                  />
                </Field>
              )}
              <Field label={t('hosting.col.customer')} htmlFor="hs-org">
                <Select
                  id="hs-org"
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
                  <Notice tone="info">
                    {item.type === 'domain'
                      ? t('hosting.admin.moduleOffDomain', { module: moduleLabel })
                      : t('hosting.admin.moduleOffWebspace', { module: moduleLabel })}
                  </Notice>
                )}
              </>
            ))}
        </div>
      </Dialog>
      <ConfirmDialog
        open={unassigning}
        onOpenChange={setUnassigning}
        title={t('hosting.admin.unassignTitle', { name: item.row.name })}
        description={t('hosting.admin.unassignText', { org: current?.name ?? '' })}
        confirmLabel={t('hosting.admin.unassign')}
        loading={assign.isPending}
        onConfirm={() =>
          assign.mutate({ type: item.type, id: item.row.id, orgId: null, enableModule: false })
        }
      />
    </>
  );
}
