import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CloudDownload, HardDrive, Link2, Pencil, Plus, Search, Trash2, Unlink, Users } from 'lucide-react';
import {
  MODULE_DEFS,
  type AdminOrgDto,
  type CloudAccountDto,
  type CloudAllowanceDto,
  type Permission,
  type ProviderConnectionDto,
} from '@weblion/shared';
import { formatBytes } from '@/lib/format';
import { useI18n, type TFunction } from '@/lib/i18n';
import { useAdminOrgs, useAdminProviders, useMe } from '@/lib/queries';
import {
  useAdminCloudAccounts,
  useAdminCloudAllowance,
  useAssignCloudAccount,
  useDeleteAdminCloudAllowance,
  useImportCloudAccount,
  useSetAdminCloudAllowance,
  useUnmanagedCloudUsers,
  type UnmanagedCloudUser,
} from '@/lib/api/cloud';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import {
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
  Select,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ProviderBadge } from '@/components/server-bits';
import {
  AccountStatusBadge,
  AllowanceFigures,
  GIB,
  LastLogin,
  LoginName,
  QuotaUsage,
  formatQuota,
  parseGb,
} from '@/pages/cloud/bits';

/** Cloud storage in the admin area: allowances per customer and the account inventory. */

/** Connections that can hold cloud accounts: Nextcloud, and the demo cloud (not the flavored demos). */
export const isCloudProvider = (
  p: Pick<ProviderConnectionDto, 'type'> & { summary?: Record<string, string> },
) => p.type === 'nextcloud' || (p.type === 'demo' && !p.summary?.flavor);

export const useCloudProviders = () => {
  const providers = useAdminProviders();
  return { ...providers, data: providers.data?.filter(isCloudProvider) };
};

function usePlatformCan() {
  const me = useMe();
  const perms = me.data?.platformPermissions ?? [];
  return (permission: Permission) => perms.includes(permission);
}

// --- Allowance card (customer detail) ------------------------------------------------

/**
 * Cloud storage allowance of an organization: which instance, how much storage and how
 * many accounts. `parent` is the reseller (if any), whose module the customer needs.
 */
export function CloudAllowanceAdminCard({
  org,
  parent,
  canWrite,
}: {
  org: AdminOrgDto;
  parent: AdminOrgDto | undefined;
  canWrite: boolean;
}) {
  const { t } = useI18n();
  const allowance = useAdminCloudAllowance(org.id);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const remove = useDeleteAdminCloudAllowance(org.id, t('storage.allowance.removed'), () =>
    setRemoving(false),
  );
  const data = allowance.data ?? null;
  // Like the API: only without accounts and, for a reseller, without customer allowances.
  const removeBlocked = !data
    ? null
    : data.accounts > 0
      ? t('storage.allowance.removeBlocked')
      : data.customers > 0
        ? t('storage.allowance.removeBlockedCustomers', { n: data.customers })
        : null;

  return (
    <Card>
      <CardHeader
        title={t('nav.cloud')}
        description={t('storage.admin.cardText')}
        actions={
          canWrite &&
          !allowance.isPending &&
          !allowance.isError && (
            <Button
              size="sm"
              icon={data ? <Pencil className="size-4" /> : <Plus className="size-4" />}
              onClick={() => setEditing(true)}
            >
              {data ? t('common.edit') : t('storage.allowance.setUp')}
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
              to={`/admin/hosting?tab=cloud&org=${org.id}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-primary-text hover:bg-surface-3"
            >
              <Users className="size-3.5" /> {t('storage.admin.showAccounts')}
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
                {t('storage.allowance.remove')}
              </Button>
            )}
          </div>
          {canWrite && removeBlocked && <p className="text-xs text-muted">{removeBlocked}</p>}
        </CardBody>
      ) : (
        <EmptyState
          className="py-8"
          icon={<HardDrive className="size-6" />}
          title={t('storage.admin.none')}
          description={t('storage.admin.noneText')}
        />
      )}
      {editing && (
        <AdminAllowanceDialog org={org} parent={parent} current={data} onClose={() => setEditing(false)} />
      )}
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t('storage.allowance.removeTitle', { name: org.name })}
        description={t('storage.allowance.removeText')}
        confirmLabel={t('storage.allowance.remove')}
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
    </Card>
  );
}

function AdminAllowanceDialog({
  org,
  parent,
  current,
  onClose,
}: {
  org: AdminOrgDto;
  parent: AdminOrgDto | undefined;
  current: CloudAllowanceDto | null;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const providers = useCloudProviders();
  const [providerId, setProviderId] = useState(current?.provider?.id ?? '');
  const [quota, setQuota] = useState(current ? String(Math.ceil(current.quotaBytes / GIB)) : '100');
  const [maxAccounts, setMaxAccounts] = useState(current?.maxAccounts?.toString() ?? '');
  const [enableModule, setEnableModule] = useState(true);
  const save = useSetAdminCloudAllowance(org.id, t('storage.allowance.saved'), onClose);

  const options = providers.data ?? [];
  const selected = providerId || options[0]?.id || '';
  const hasModule = org.modules.includes('storage');
  const moduleLabel = MODULE_DEFS.storage.label[locale];
  const resellerLacks = !!parent && !parent.modules.includes('storage');
  // The instance can only change while nothing lives on the current one (no accounts and,
  // for a reseller, no customer allowances).
  const instanceLocked = !!current && (current.accounts > 0 || current.customers > 0);
  const minGb = current ? Math.max(1, Math.ceil(current.allocatedBytes / GIB)) : 1;
  const minAccounts = current?.accounts ?? 0;

  const quotaGb = parseGb(quota);
  const quotaError =
    quotaGb === null
      ? t('storage.quota.invalid')
      : quotaGb < minGb
        ? t('storage.allowance.belowAllocated', { size: formatQuota(minGb * GIB, locale) })
        : null;
  const max = maxAccounts.trim() === '' ? null : parseGb(maxAccounts);
  const maxError =
    maxAccounts.trim() !== '' && max === null
      ? t('storage.allowance.maxInvalid')
      : max !== null && max < minAccounts
        ? t('storage.allowance.maxBelowAccounts', { n: minAccounts })
        : null;
  const blocked =
    !selected ||
    quotaGb === null ||
    !!quotaError ||
    !!maxError ||
    (!hasModule && enableModule && resellerLacks);

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={
        current
          ? t('storage.allowance.editTitle', { name: org.name })
          : t('storage.allowance.setUpTitle', { name: org.name })
      }
      description={t('storage.allowance.dialogText')}
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
              quotaGb !== null &&
              save.mutate({
                providerId: selected,
                quotaGb,
                maxAccounts: max,
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
        {providers.isError ? (
          <ErrorState error={providers.error} onRetry={() => void providers.refetch()} />
        ) : options.length === 0 && !providers.isPending ? (
          <Notice tone="warning">
            {t('storage.admin.noInstance')}{' '}
            <Link to="/admin/providers" className="font-medium underline underline-offset-2">
              {t('hosting.admin.toProviders')}
            </Link>
          </Notice>
        ) : (
          <Field
            label={t('storage.instance')}
            htmlFor="ca-provider"
            hint={
              !instanceLocked
                ? t('storage.allowance.instanceHint')
                : current.accounts > 0
                  ? t('storage.allowance.instanceLocked')
                  : t('storage.allowance.instanceLockedCustomers')
            }
          >
            <Select
              id="ca-provider"
              value={selected}
              onChange={(e) => setProviderId(e.target.value)}
              disabled={instanceLocked || providers.isPending}
            >
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.location.label}
                  {p.enabled ? '' : ` (${t('providers.disabledBadge')})`}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('storage.allowance.quota')}
            htmlFor="ca-quota"
            error={quotaError}
            hint={
              current && current.allocatedBytes > 0
                ? t('storage.allowance.allocatedHint', { size: formatQuota(current.allocatedBytes, locale) })
                : undefined
            }
          >
            <div className="flex items-center gap-2">
              <Input
                id="ca-quota"
                type="number"
                inputMode="numeric"
                min={minGb}
                step={1}
                value={quota}
                onChange={(e) => setQuota(e.target.value)}
                className="tabular"
              />
              <span className="text-sm text-muted">GB</span>
            </div>
          </Field>
          <Field
            label={t('storage.allowance.maxAccounts')}
            htmlFor="ca-max"
            error={maxError}
            hint={t('storage.allowance.maxAccountsHint')}
          >
            <Input
              id="ca-max"
              type="number"
              inputMode="numeric"
              min={Math.max(1, minAccounts)}
              step={1}
              value={maxAccounts}
              onChange={(e) => setMaxAccounts(e.target.value)}
              placeholder={t('storage.allowance.unlimited')}
              className="tabular"
            />
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
                  {t('storage.allowance.enableModuleHint', { org: org.name })}
                </span>
              </span>
            </label>
            {enableModule && resellerLacks && parent && (
              <Notice tone="warning">
                {t('hosting.admin.resellerLacks', { reseller: parent.name, module: moduleLabel })}
              </Notice>
            )}
            {!enableModule && (
              <Notice tone="info">{t('storage.allowance.moduleOff', { module: moduleLabel })}</Notice>
            )}
          </>
        )}
        {org.kind === 'reseller' && <Notice tone="info">{t('storage.allowance.resellerHint')}</Notice>}
      </div>
    </Dialog>
  );
}

// --- Organization picker ---------------------------------------------------------------

function orgLabel(t: TFunction, org: AdminOrgDto): string {
  const parts = [org.name];
  if (org.kind === 'reseller') parts.push(t('hosting.admin.kindReseller'));
  if (org.kind === 'internal') parts.push(t('hosting.admin.kindInternal'));
  if (org.status === 'suspended') parts.push(t('hosting.admin.suspended'));
  if (!org.modules.includes('storage')) parts.push(t('storage.admin.noModule'));
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
  const all = orgs.data ?? [];
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
      <Field label={t('hosting.col.customer')} htmlFor={id} hint={t('storage.admin.needsAllowance')}>
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

// --- Account inventory (tab of Domains & Webspaces) ------------------------------------

export function AdminCloudTab() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const can = usePlatformCan();
  const canAssign = can('platform:org:write');
  const [params, setParams] = useSearchParams();
  const orgId = params.get('org') ?? undefined;
  const providerParam = params.get('provider') ?? undefined;
  const [q, setQ] = useState('');
  const providers = useCloudProviders();
  const orgs = useAdminOrgs();
  const cloudProviders = providers.data ?? [];
  // The hosting tabs share ?provider=, so only a cloud instance counts here.
  const providerId = cloudProviders.some((p) => p.id === providerParam) ? providerParam : undefined;
  const accounts = useAdminCloudAccounts({ q: q.trim() || undefined, orgId, providerId });
  const [assigning, setAssigning] = useState<CloudAccountDto | null>(null);

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-6">
      <Notice tone="info">
        {t('storage.admin.tabHint')}{' '}
        <Link to="/admin/customers" className="font-medium underline underline-offset-2">
          {t('nav.admin.customers')}
        </Link>
      </Notice>
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('storage.admin.search')}
              className="pl-9"
              aria-label={t('common.search')}
            />
          </div>
          <Select
            value={orgId ?? ''}
            onChange={(e) => set('org', e.target.value)}
            className="w-auto max-w-[260px]"
            aria-label={t('storage.admin.filterCustomer')}
          >
            <option value="">{t('storage.admin.allCustomers')}</option>
            {(orgs.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
          {cloudProviders.length > 1 && (
            <Select
              value={providerId ?? ''}
              onChange={(e) => set('provider', e.target.value)}
              className="w-auto"
              aria-label={t('storage.admin.filterInstance')}
            >
              <option value="">{t('storage.admin.allInstances')}</option>
              {cloudProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </div>
        {accounts.isError ? (
          <div className="p-5">
            <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />
          </div>
        ) : accounts.isPending ? (
          <LoadingBlock rows={5} />
        ) : accounts.data.length === 0 ? (
          <EmptyState
            icon={<HardDrive className="size-6" />}
            title={t('storage.admin.empty')}
            description={t('storage.admin.emptyText')}
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>{t('storage.col.login')}</TH>
                <TH className="hidden lg:table-cell">{t('storage.col.name')}</TH>
                <TH>{t('storage.col.storage')}</TH>
                <TH className="hidden sm:table-cell">{t('storage.col.status')}</TH>
                <TH>{t('hosting.col.customer')}</TH>
                <TH className="hidden xl:table-cell">{t('storage.col.lastLogin')}</TH>
                {canAssign && <TH />}
              </tr>
            </THead>
            <TBody>
              {accounts.data.map((a) => (
                <TR key={a.id} onClick={a.org ? () => navigate(`/o/${a.org!.slug}/cloud`) : undefined}>
                  <TD className="max-w-[280px]">
                    <div onClick={(e) => e.stopPropagation()}>
                      <LoginName username={a.username} />
                    </div>
                    <ProviderBadge type={a.provider.type} name={a.provider.name} className="mt-0.5" />
                  </TD>
                  <TD className="hidden max-w-[240px] lg:table-cell">
                    <div className="truncate">{a.displayName ?? <span className="text-subtle">–</span>}</div>
                    <div className="truncate text-xs text-muted">{a.email}</div>
                  </TD>
                  <TD>
                    <QuotaUsage usedBytes={a.usedBytes} quotaBytes={a.quotaBytes} />
                  </TD>
                  <TD className="hidden sm:table-cell">
                    <AccountStatusBadge account={a} />
                  </TD>
                  <TD>
                    {a.org ? (
                      <Link
                        to={`/admin/customers/${a.org.id}`}
                        className="text-sm whitespace-nowrap text-text hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {a.org.name}
                      </Link>
                    ) : (
                      <span className="text-sm text-warning">{t('hosting.admin.unassigned')}</span>
                    )}
                  </TD>
                  <TD className="hidden text-sm xl:table-cell">
                    <LastLogin value={a.lastLoginAt} />
                  </TD>
                  {canAssign && (
                    <TD className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant={a.org ? 'ghost' : 'secondary'}
                        icon={<Link2 className="size-3.5" />}
                        onClick={() => setAssigning(a)}
                      >
                        {a.org ? t('hosting.admin.reassign') : t('hosting.admin.assign')}
                      </Button>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {cloudProviders.length > 0 && (
        <UnmanagedUsers providers={cloudProviders} initialProviderId={providerId} canImport={canAssign} />
      )}
      {assigning && (
        <AssignAccountDialog key={assigning.id} account={assigning} onClose={() => setAssigning(null)} />
      )}
    </div>
  );
}

function AssignAccountDialog({ account, onClose }: { account: CloudAccountDto; onClose: () => void }) {
  const { t } = useI18n();
  const current = account.org;
  const [orgId, setOrgId] = useState(current?.id ?? '');
  const [unassigning, setUnassigning] = useState(false);
  const assign = useAssignCloudAccount(
    (a, target) =>
      target
        ? t('hosting.admin.assigned', { name: a.username })
        : t('hosting.admin.unassignedDone', { name: a.username }),
    onClose,
  );
  const changed = orgId !== (current?.id ?? '');
  return (
    <>
      <Dialog
        open
        onOpenChange={(o) => !o && onClose()}
        title={t('hosting.admin.assignTitle', { name: account.username })}
        description={t('storage.admin.assignText', { instance: account.provider.name })}
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
              disabled={!orgId || !changed}
              loading={assign.isPending && !unassigning}
              onClick={() => assign.mutate({ id: account.id, orgId })}
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
          <OrgSelect id="cl-assign-org" value={orgId} onChange={setOrgId} emptyLabel="–" />
          <p className="text-xs text-muted">{t('storage.admin.assignQuotaHint')}</p>
        </div>
      </Dialog>
      <ConfirmDialog
        open={unassigning}
        onOpenChange={setUnassigning}
        title={t('hosting.admin.unassignTitle', { name: account.username })}
        description={t('storage.admin.unassignText', { org: current?.name ?? '' })}
        confirmLabel={t('hosting.admin.unassign')}
        loading={assign.isPending}
        onConfirm={() => assign.mutate({ id: account.id, orgId: null })}
      />
    </>
  );
}

// --- Unmanaged users -------------------------------------------------------------------

function UnmanagedUsers({
  providers,
  initialProviderId,
  canImport,
}: {
  providers: ProviderConnectionDto[];
  initialProviderId?: string;
  canImport: boolean;
}) {
  const { t } = useI18n();
  const [providerId, setProviderId] = useState(initialProviderId ?? providers[0]!.id);
  const [loaded, setLoaded] = useState(false);
  const [importing, setImporting] = useState<UnmanagedCloudUser | null>(null);
  const users = useUnmanagedCloudUsers(providerId, loaded);
  const provider = providers.find((p) => p.id === providerId) ?? providers[0]!;

  return (
    <Card>
      <CardHeader
        title={t('storage.unmanaged.title')}
        description={t('storage.unmanaged.text')}
        actions={
          <>
            {providers.length > 1 && (
              <Select
                value={provider.id}
                onChange={(e) => setProviderId(e.target.value)}
                className="h-8 w-auto"
                aria-label={t('storage.instance')}
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
            <Button
              size="sm"
              icon={<CloudDownload className="size-4" />}
              loading={loaded && users.isFetching}
              onClick={() => (loaded ? void users.refetch() : setLoaded(true))}
            >
              {loaded ? t('storage.unmanaged.reload') : t('storage.unmanaged.load')}
            </Button>
          </>
        }
      />
      {!loaded ? (
        <CardBody>
          <p className="text-sm text-muted">{t('storage.unmanaged.hint', { instance: provider.name })}</p>
        </CardBody>
      ) : users.isError ? (
        <div className="p-5">
          <ErrorState error={users.error} onRetry={() => void users.refetch()} />
        </div>
      ) : users.isPending ? (
        <LoadingBlock rows={3} />
      ) : users.data.length === 0 ? (
        <EmptyState className="py-8" title={t('storage.unmanaged.empty', { instance: provider.name })} />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>{t('storage.col.login')}</TH>
              <TH className="hidden md:table-cell">{t('storage.col.name')}</TH>
              <TH>{t('storage.col.storage')}</TH>
              <TH className="hidden sm:table-cell">{t('storage.col.status')}</TH>
              {canImport && <TH />}
            </tr>
          </THead>
          <TBody>
            {users.data.map((u) => (
              <TR key={u.username}>
                <TD className="max-w-[260px]">
                  <Mono className="block truncate font-medium text-text">{u.username}</Mono>
                </TD>
                <TD className="hidden max-w-[240px] md:table-cell">
                  <div className="truncate">{u.displayName ?? <span className="text-subtle">–</span>}</div>
                  <div className="truncate text-xs text-muted">{u.email}</div>
                </TD>
                <TD>
                  <QuotaUsage usedBytes={u.usedBytes} quotaBytes={u.quotaBytes} />
                </TD>
                <TD className="hidden sm:table-cell">
                  <AccountStatusBadge account={{ enabled: u.enabled, missingSince: null }} />
                </TD>
                {canImport && (
                  <TD className="text-right">
                    <Button
                      size="sm"
                      icon={<CloudDownload className="size-3.5" />}
                      onClick={() => setImporting(u)}
                    >
                      {t('storage.unmanaged.import')}
                    </Button>
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {importing && (
        <ImportDialog
          key={importing.username}
          user={importing}
          provider={provider}
          onClose={() => setImporting(null)}
        />
      )}
    </Card>
  );
}

function ImportDialog({
  user,
  provider,
  onClose,
}: {
  user: UnmanagedCloudUser;
  provider: ProviderConnectionDto;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const [orgId, setOrgId] = useState('');
  const importUser = useImportCloudAccount(
    (a) => t('storage.unmanaged.imported', { username: a.username }),
    onClose,
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('storage.unmanaged.importTitle', { username: user.username })}
      description={t('storage.unmanaged.importText')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={importUser.isPending}
            onClick={() =>
              importUser.mutate({ providerId: provider.id, username: user.username, orgId: orgId || null })
            }
          >
            {t('storage.unmanaged.import')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm">
          <div className="min-w-0">
            <dt className="text-xs text-muted">{t('storage.instance')}</dt>
            <dd className="truncate">{provider.name}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted">{t('storage.quota')}</dt>
            <dd className="truncate tabular">
              {user.quotaBytes === null
                ? t('storage.allowance.unlimited')
                : formatQuota(user.quotaBytes, locale)}
              {user.usedBytes !== null && (
                <span className="text-muted">
                  {' '}
                  · {t('storage.quota.used', { used: formatBytes(user.usedBytes) })}
                </span>
              )}
            </dd>
          </div>
        </dl>
        <OrgSelect
          id="cl-import-org"
          value={orgId}
          onChange={setOrgId}
          emptyLabel={t('storage.unmanaged.noCustomer')}
        />
        {user.quotaBytes === null && <Notice tone="info">{t('storage.unmanaged.unlimitedHint')}</Notice>}
      </div>
    </Dialog>
  );
}
