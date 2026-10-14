import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Clapperboard,
  CloudDownload,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Unlink,
  Users,
} from 'lucide-react';
import {
  MEDIA_MAX_STREAMS,
  MODULE_DEFS,
  isMediaAccountCode,
  mediaAccessExceeds,
  type AdminOrgDto,
  type MediaAccessConflict,
  type MediaAccountDto,
  type MediaAllowanceDto,
  type MediaInstanceDto,
  type MediaPolicyApplyResult,
  type Permission,
  type ProviderConnectionDto,
  type UnmanagedMediaUserDto,
} from '@weblion/shared';
import type { TranslationKey } from '@/i18n/de';
import { useI18n, type TFunction } from '@/lib/i18n';
import { useAdminOrgs, useAdminProviders, useMe } from '@/lib/queries';
import { useProviderSync } from '@/lib/api/hosting';
import {
  useAdminMediaAccounts,
  useAdminMediaAllowance,
  useAssignMediaAccount,
  useDeleteAdminMediaAllowance,
  useImportMediaUser,
  useMediaInstances,
  useMediaLibraries,
  useRepairMediaAccount,
  useSetAdminMediaAllowance,
  useUnmanagedMediaUsers,
  type AdminMediaFilters,
} from '@/lib/api/media';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { MenuItem, Switch } from '@/components/ui/menu';
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
import { Flag, ProviderBadge } from '@/components/server-bits';
import { safePanelUrl } from '@/pages/hosting/bits';
import {
  ActivityDay,
  IssueBadges,
  LoginName,
  MediaAllowanceFigures,
  MediaStatusBadge,
  mediaAccessOfDto,
  mediaAllowanceFull,
  ownMediaAccounts,
} from '@/pages/media/bits';
import {
  MediaAccessFields,
  MediaAccountActions,
  MediaPasswordDialog,
  PolicyFailures,
  mediaAccessFormFrom,
  readMediaAccessForm,
  type ShownMediaPassword,
} from '@/pages/media/dialogs';

/**
 * Streaming on every Jellyfin connection (/admin/media, ?provider=<id> preselects the
 * instance): instances, the account inventory, the import of users created in Jellyfin,
 * assignment and policy repair. Allowances are set on the customer (MediaAllowanceAdminCard).
 */

/** Connections with streaming: Jellyfin, and the demo without a flavor (Cloudflare, CloudPanel have none). */
export const isMediaProvider = (
  p: Pick<ProviderConnectionDto, 'type'> & { summary?: Record<string, string> },
) => p.type === 'jellyfin' || (p.type === 'demo' && !p.summary?.flavor);

const useMediaProviders = () => {
  const providers = useAdminProviders();
  return { ...providers, data: providers.data?.filter(isMediaProvider) };
};

function usePlatformCan() {
  const me = useMe();
  const perms = me.data?.platformPermissions ?? [];
  return (permission: Permission) => perms.includes(permission);
}

const CONFLICT_KEY: Record<MediaAccessConflict | 'accounts', TranslationKey> = {
  libraries: 'media.conflict.libraries',
  streams: 'media.conflict.streams',
  downloads: 'media.conflict.downloads',
  bitrate: 'media.conflict.bitrate',
  accounts: 'media.conflict.accounts',
};

const conflictList = (t: TFunction, conflicts: (MediaAccessConflict | 'accounts')[]) =>
  conflicts.map((c) => t(CONFLICT_KEY[c])).join(', ');

// --- Page ----------------------------------------------------------------------------

export function AdminMediaPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const can = usePlatformCan();
  const canManage = can('platform:media:write');
  const [params, setParams] = useSearchParams();
  const providerParam = params.get('provider') ?? undefined;
  const orgId = params.get('org') ?? undefined;
  const onlyIssues = params.get('issues') === 'true';
  const [q, setQ] = useState('');
  const providers = useMediaProviders();
  const allProviders = useAdminProviders();
  const orgs = useAdminOrgs();
  const mediaProviders = providers.data ?? [];
  const filters: AdminMediaFilters = {
    q: q.trim() || undefined,
    orgId,
    providerId: providerParam,
    issues: onlyIssues ? 'true' : undefined,
  };
  const accounts = useAdminMediaAccounts(filters);
  const [assigning, setAssigning] = useState<MediaAccountDto | null>(null);
  const [shown, setShown] = useState<ShownMediaPassword | null>(null);
  const repair = useRepairMediaAccount((a) => t('media.admin.repaired', { username: a.username }));

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  // A ?provider= of another kind of connection (or a removed one) still filters: keep it selectable.
  const unknownProvider =
    !!providerParam && !providers.isPending && !mediaProviders.some((p) => p.id === providerParam);
  const list = accounts.data ?? [];

  return (
    <>
      <PageHeader
        title={t('nav.admin.media')}
        description={t('media.admin.subtitle')}
        actions={
          can('platform:provider:write') && (
            <Button icon={<Plus className="size-4" />} onClick={() => navigate('/admin/providers')}>
              {t('media.admin.addProvider')}
            </Button>
          )
        }
      />

      <div className="space-y-6">
        <Notice tone="info">
          {t('media.admin.hint')}{' '}
          <Link to="/admin/customers" className="font-medium underline underline-offset-2">
            {t('nav.admin.customers')}
          </Link>
        </Notice>

        <InstancesCard />

        <Card>
          <CardHeader title={t('media.admin.accounts')} description={t('media.admin.accountsText')} />
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('media.admin.search')}
                className="pl-9"
                aria-label={t('common.search')}
              />
            </div>
            <Select
              value={orgId ?? ''}
              onChange={(e) => set('org', e.target.value)}
              className="w-auto max-w-[240px]"
              aria-label={t('media.admin.filterCustomer')}
            >
              <option value="">{t('media.admin.allCustomers')}</option>
              {(orgs.data ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
            {(mediaProviders.length > 1 || unknownProvider) && (
              <Select
                value={providerParam ?? ''}
                onChange={(e) => set('provider', e.target.value)}
                className="w-auto max-w-[240px]"
                aria-label={t('media.admin.filterInstance')}
              >
                <option value="">{t('media.admin.allInstances')}</option>
                {mediaProviders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                {unknownProvider && (
                  <option value={providerParam}>
                    {(allProviders.data ?? []).find((p) => p.id === providerParam)?.name ?? providerParam}
                  </option>
                )}
              </Select>
            )}
            <label className="flex items-center gap-2 text-sm text-text">
              <Switch
                checked={onlyIssues}
                onCheckedChange={(on) => set('issues', on ? 'true' : '')}
                label={t('media.admin.onlyIssues')}
              />
              {t('media.admin.onlyIssues')}
            </label>
          </div>
          {accounts.isError ? (
            <div className="p-5">
              <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />
            </div>
          ) : accounts.isPending ? (
            <LoadingBlock rows={5} />
          ) : list.length === 0 ? (
            <EmptyState
              icon={<Clapperboard className="size-6" />}
              title={t('media.admin.empty')}
              description={t('media.admin.emptyText')}
            />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>{t('media.col.login')}</TH>
                  <TH>{t('hosting.col.customer')}</TH>
                  <TH className="hidden lg:table-cell">{t('media.instance')}</TH>
                  <TH className="hidden sm:table-cell">{t('media.col.status')}</TH>
                  <TH className="hidden md:table-cell">{t('media.col.issues')}</TH>
                  <TH className="hidden xl:table-cell">{t('media.col.lastActive')}</TH>
                  <TH />
                </tr>
              </THead>
              <TBody>
                {list.map((a) => {
                  const repairable = a.issues.includes('policy') || a.issues.includes('administrator');
                  return (
                    <TR key={a.id} onClick={a.org ? () => navigate(`/o/${a.org!.slug}/media`) : undefined}>
                      <TD className="max-w-[280px]">
                        <div onClick={(e) => e.stopPropagation()}>
                          <LoginName username={a.username} />
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1 md:hidden">
                          <span className="sm:hidden">
                            <MediaStatusBadge account={a} />
                          </span>
                          {a.issues.length > 0 && <IssueBadges issues={a.issues} />}
                        </div>
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
                      <TD className="hidden lg:table-cell">
                        <span className="inline-flex items-center gap-1.5 text-sm whitespace-nowrap">
                          <ProviderBadge type={a.provider.type} name={a.provider.name} />
                          {a.provider.name}
                        </span>
                      </TD>
                      <TD className="hidden sm:table-cell">
                        <MediaStatusBadge account={a} />
                      </TD>
                      <TD className="hidden md:table-cell">
                        <IssueBadges issues={a.issues} />
                      </TD>
                      <TD className="hidden text-sm xl:table-cell">
                        <ActivityDay day={a.lastActiveOn} />
                      </TD>
                      <TD className="w-12 text-right" onClick={(e) => e.stopPropagation()}>
                        <MediaAccountActions
                          account={a}
                          onPassword={setShown}
                          allowPassword={false}
                          before={
                            canManage && (
                              <>
                                <MenuItem icon={<Link2 />} onSelect={() => setAssigning(a)}>
                                  {a.org ? t('media.admin.reassign') : t('media.admin.assign')}
                                </MenuItem>
                                {repairable && !a.missingSince && a.org && (
                                  <MenuItem
                                    icon={<ShieldCheck />}
                                    onSelect={() => repair.mutate(a)}
                                    disabled={repair.isPending}
                                    hint={t('media.admin.repairHint')}
                                  >
                                    {t('media.admin.repair')}
                                  </MenuItem>
                                )}
                              </>
                            )
                          }
                        />
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
          {list.length >= 1000 && (
            <p className="border-t border-border px-5 py-3 text-xs text-muted">{t('media.admin.limited')}</p>
          )}
        </Card>

        {mediaProviders.length > 0 && (
          <UnmanagedUsers
            key={providerParam ?? 'all'}
            providers={mediaProviders}
            initialProviderId={mediaProviders.some((p) => p.id === providerParam) ? providerParam : undefined}
            canImport={canManage}
            onPassword={setShown}
          />
        )}
      </div>

      {assigning && (
        <AssignMediaAccountDialog key={assigning.id} account={assigning} onClose={() => setAssigning(null)} />
      )}
      <MediaPasswordDialog shown={shown} onClose={() => setShown(null)} />
    </>
  );
}

// --- Instances -----------------------------------------------------------------------

function usageOf(
  t: TFunction,
  organizations: number,
): { tone: 'success' | 'primary' | 'neutral'; label: string } {
  if (organizations === 0) return { tone: 'neutral', label: t('media.admin.usage.unused') };
  if (organizations === 1) return { tone: 'success', label: t('media.admin.usage.dedicated') };
  return { tone: 'primary', label: t('media.admin.usage.shared') };
}

function InstancesCard() {
  const { t } = useI18n();
  const instances = useMediaInstances();
  const sync = useProviderSync((r) => {
    const counts = r.mediaAccounts;
    const synced = t('media.admin.synced', {
      seen: counts?.seen ?? 0,
      missing: counts?.missing ?? 0,
      repaired: counts?.repaired ?? 0,
    });
    return counts && counts.repairFailed > 0
      ? `${synced}. ${t('media.admin.syncRepairFailed', { n: counts.repairFailed })}`
      : synced;
  });
  const list = instances.data ?? [];

  return (
    <Card>
      <CardHeader title={t('media.admin.instances')} description={t('media.admin.instancesText')} />
      {instances.isError ? (
        <div className="p-5">
          <ErrorState error={instances.error} onRetry={() => void instances.refetch()} />
        </div>
      ) : instances.isPending ? (
        <LoadingBlock rows={2} />
      ) : list.length === 0 ? (
        <EmptyState
          className="py-8"
          icon={<Clapperboard className="size-6" />}
          title={t('media.admin.noInstances')}
          description={t('media.admin.noInstancesText')}
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>{t('media.instance')}</TH>
              <TH className="hidden md:table-cell">{t('media.admin.col.usage')}</TH>
              <TH>{t('media.admin.col.accounts')}</TH>
              <TH className="hidden lg:table-cell">{t('media.admin.col.active')}</TH>
              <TH className="hidden xl:table-cell">{t('media.admin.col.quickConnect')}</TH>
              <TH />
            </tr>
          </THead>
          <TBody>
            {list.map((instance) => (
              <InstanceRow
                key={instance.provider.id}
                instance={instance}
                syncing={sync.isPending && sync.variables === instance.provider.id}
                onSync={() => sync.mutate(instance.provider.id)}
              />
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

function InstanceRow({
  instance,
  syncing,
  onSync,
}: {
  instance: MediaInstanceDto;
  syncing: boolean;
  onSync: () => void;
}) {
  const { t } = useI18n();
  const { provider, live } = instance;
  const usage = usageOf(t, instance.organizations);
  const url = safePanelUrl(provider.url);
  return (
    <TR>
      <TD className="max-w-[340px]">
        <div className="flex flex-wrap items-center gap-1.5">
          <ProviderBadge type={provider.type} name={provider.name} />
          <span className="font-medium text-text">{provider.name}</span>
          <Flag country={instance.location.country} />
          {!provider.enabled && <Badge tone="neutral">{t('providers.disabledBadge')}</Badge>}
        </div>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 block truncate text-primary-text hover:underline"
          >
            <Mono>{url}</Mono>
          </a>
        )}
        <div className="mt-0.5 text-xs text-muted">
          {live
            ? [live.serverName, live.version ? `Jellyfin ${live.version}` : null]
                .filter(Boolean)
                .join(' · ') || '–'
            : null}
        </div>
        {instance.error && <p className="mt-1 text-xs break-words text-danger">{instance.error}</p>}
        <div className="mt-1 md:hidden">
          <Badge tone={usage.tone}>{usage.label}</Badge>
        </div>
      </TD>
      <TD className="hidden md:table-cell">
        <Badge tone={usage.tone}>{usage.label}</Badge>
        <div className="mt-0.5 text-xs text-muted">
          {t('media.admin.orgCount', { n: instance.organizations })}
        </div>
      </TD>
      <TD>
        <div className="text-sm tabular">{instance.accounts}</div>
        {instance.accountsWithIssues > 0 && (
          <Link
            to={`/admin/media?provider=${provider.id}&issues=true`}
            className="text-xs whitespace-nowrap text-warning hover:underline"
          >
            {t('media.admin.withIssues', { n: instance.accountsWithIssues })}
          </Link>
        )}
        {live && (
          <div className="text-xs whitespace-nowrap text-muted">
            {t('media.admin.users', { n: live.users, libraries: live.libraries })}
          </div>
        )}
      </TD>
      <TD className="hidden text-sm whitespace-nowrap lg:table-cell">
        {live ? t('media.admin.activeNow', { sessions: live.activeSessions, playing: live.playing }) : '–'}
      </TD>
      <TD className="hidden text-sm xl:table-cell">
        {!live || live.quickConnect === null ? (
          <span className="text-subtle">{t('media.admin.quickConnect.unknown')}</span>
        ) : live.quickConnect ? (
          <Badge tone="success">{t('media.admin.quickConnect.on')}</Badge>
        ) : (
          <Badge tone="warning">{t('media.admin.quickConnect.off')}</Badge>
        )}
      </TD>
      <TD className="text-right">
        <div className="inline-flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw className="size-3.5" />}
            loading={syncing}
            onClick={onSync}
          >
            <span className="hidden sm:inline">{t('media.admin.sync')}</span>
          </Button>
          <Link
            to={`/admin/providers/${provider.id}`}
            className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-3 hover:text-text"
            title={t('media.admin.toProvider')}
            aria-label={t('media.admin.toProvider')}
          >
            <Settings2 className="size-4" />
          </Link>
        </div>
      </TD>
    </TR>
  );
}

// --- Organization picker ---------------------------------------------------------------

function orgLabel(t: TFunction, org: AdminOrgDto): string {
  const parts = [org.name];
  if (org.kind === 'reseller') parts.push(t('hosting.admin.kindReseller'));
  if (org.kind === 'internal') parts.push(t('hosting.admin.kindInternal'));
  if (org.status === 'suspended') parts.push(t('hosting.admin.suspended'));
  if (!org.modules.includes('media')) parts.push(t('media.admin.noModule'));
  return parts.join(' · ');
}

/** Organizations without a reseller first, then one group per reseller. */
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

/**
 * The allowance of the organization an account goes to: it must be on the account's instance
 * (else the API refuses); beyond its maximum is allowed for staff, with a warning.
 */
function TargetAllowance({ orgId, providerId }: { orgId: string; providerId: string }) {
  const { t } = useI18n();
  const allowance = useAdminMediaAllowance(orgId);
  if (allowance.isPending) return <LoadingBlock rows={1} />;
  if (allowance.isError)
    return <ErrorState error={allowance.error} onRetry={() => void allowance.refetch()} />;
  const data = allowance.data;
  if (!data) return <Notice tone="warning">{t('media.admin.targetNone')}</Notice>;
  if (data.provider?.id !== providerId) {
    return (
      <Notice tone="warning">
        {t('media.admin.targetOtherInstance', { instance: data.provider?.name ?? '–' })}
      </Notice>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">
        {t('media.admin.targetAllowance', {
          n: data.accounts,
          max: data.maxAccounts,
          code: data.accountCode,
        })}
      </p>
      {mediaAllowanceFull(data) && <Notice tone="warning">{t('media.admin.targetFull')}</Notice>}
    </div>
  );
}

// --- Assign ----------------------------------------------------------------------------

function AssignMediaAccountDialog({ account, onClose }: { account: MediaAccountDto; onClose: () => void }) {
  const { t } = useI18n();
  const current = account.org;
  const [orgId, setOrgId] = useState(current?.id ?? '');
  const [unassigning, setUnassigning] = useState(false);
  const assign = useAssignMediaAccount(
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
        description={t('media.admin.assignText', { instance: account.provider.name })}
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
          <OrgSelect id="ma-assign-org" value={orgId} onChange={setOrgId} emptyLabel="–" />
          {orgId && changed && <TargetAllowance orgId={orgId} providerId={account.provider.id} />}
          <p className="text-xs text-muted">{t('media.admin.assignHint')}</p>
        </div>
      </Dialog>
      <ConfirmDialog
        open={unassigning}
        onOpenChange={setUnassigning}
        title={t('hosting.admin.unassignTitle', { name: account.username })}
        description={t('media.admin.unassignText', { org: current?.name ?? '' })}
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
  onPassword,
}: {
  providers: ProviderConnectionDto[];
  initialProviderId?: string;
  canImport: boolean;
  onPassword: (shown: ShownMediaPassword) => void;
}) {
  const { t } = useI18n();
  const [providerId, setProviderId] = useState(initialProviderId ?? providers[0]!.id);
  const [loaded, setLoaded] = useState(false);
  const [importing, setImporting] = useState<UnmanagedMediaUserDto | null>(null);
  const provider = providers.find((p) => p.id === providerId) ?? providers[0]!;
  const users = useUnmanagedMediaUsers(provider.id, loaded);

  return (
    <Card>
      <CardHeader
        title={t('media.unmanaged.title')}
        description={t('media.unmanaged.text')}
        actions={
          <>
            {providers.length > 1 && (
              <Select
                value={provider.id}
                onChange={(e) => setProviderId(e.target.value)}
                className="h-8 w-auto"
                aria-label={t('media.instance')}
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
              {loaded ? t('media.unmanaged.reload') : t('media.unmanaged.load')}
            </Button>
          </>
        }
      />
      {!loaded ? (
        <CardBody>
          <p className="text-sm text-muted">{t('media.unmanaged.hint', { instance: provider.name })}</p>
        </CardBody>
      ) : users.isError ? (
        <div className="p-5">
          <ErrorState error={users.error} onRetry={() => void users.refetch()} />
        </div>
      ) : users.isPending ? (
        <LoadingBlock rows={3} />
      ) : users.data.length === 0 ? (
        <EmptyState className="py-8" title={t('media.unmanaged.empty', { instance: provider.name })} />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>{t('media.col.login')}</TH>
              <TH className="hidden sm:table-cell">{t('media.col.status')}</TH>
              <TH className="hidden md:table-cell">{t('media.unmanaged.col.password')}</TH>
              <TH className="hidden lg:table-cell">{t('media.col.lastActive')}</TH>
              <TH />
            </tr>
          </THead>
          <TBody>
            {users.data.map((u) => (
              <TR key={u.userId}>
                <TD className="max-w-[260px]">
                  <Mono className="block truncate font-medium text-text">{u.username}</Mono>
                  {u.administrator && <Badge tone="danger">{t('media.unmanaged.administrator')}</Badge>}
                </TD>
                <TD className="hidden sm:table-cell">
                  <MediaStatusBadge
                    account={{
                      enabled: u.enabled,
                      hasPassword: u.hasPassword,
                      missingSince: null,
                      issues: [],
                    }}
                  />
                </TD>
                <TD className="hidden text-sm md:table-cell">
                  {u.hasPassword ? (
                    t('media.unmanaged.yes')
                  ) : (
                    <span className="text-warning">{t('media.unmanaged.no')}</span>
                  )}
                </TD>
                <TD className="hidden text-sm lg:table-cell">
                  <ActivityDay day={u.lastActiveOn} />
                </TD>
                <TD className="text-right">
                  {u.blocked ? (
                    <span className="text-xs text-muted">
                      {u.blocked === 'administrator'
                        ? t('media.unmanaged.blocked.administrator')
                        : t('media.unmanaged.blocked.blocked_folders')}
                    </span>
                  ) : (
                    canImport && (
                      <Button
                        size="sm"
                        icon={<CloudDownload className="size-3.5" />}
                        onClick={() => setImporting(u)}
                      >
                        {t('media.unmanaged.import')}
                      </Button>
                    )
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {importing && (
        <ImportMediaUserDialog
          key={importing.userId}
          user={importing}
          provider={provider}
          onClose={() => setImporting(null)}
          onPassword={onPassword}
        />
      )}
    </Card>
  );
}

function ImportMediaUserDialog({
  user,
  provider,
  onClose,
  onPassword,
}: {
  user: UnmanagedMediaUserDto;
  provider: ProviderConnectionDto;
  onClose: () => void;
  onPassword: (shown: ShownMediaPassword) => void;
}) {
  const { t } = useI18n();
  const [orgId, setOrgId] = useState('');
  // A user without a password signs in with the name alone: it is only taken over with a new one.
  const [setPassword, setSetPassword] = useState(!user.hasPassword);
  const importUser = useImportMediaUser(
    (r) => t('media.unmanaged.imported', { username: r.account.username }),
    (r) => {
      onClose();
      if (r.password) {
        onPassword({
          title: t('media.unmanaged.passwordTitle'),
          username: r.account.username,
          password: r.password,
          loginUrl: r.account.loginUrl,
        });
      }
    },
  );
  const forced = !user.hasPassword;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('media.unmanaged.importTitle', { username: user.username })}
      description={t('media.unmanaged.importText')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={importUser.isPending}
            onClick={() =>
              importUser.mutate({
                providerId: provider.id,
                userId: user.userId,
                orgId: orgId || null,
                setPassword: setPassword || forced,
              })
            }
          >
            {t('media.unmanaged.import')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm">
          <div className="min-w-0">
            <dt className="text-xs text-muted">{t('media.instance')}</dt>
            <dd className="truncate">{provider.name}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted">{t('media.col.lastActive')}</dt>
            <dd className="truncate">
              <ActivityDay day={user.lastActiveOn} />
            </dd>
          </div>
        </dl>
        <OrgSelect
          id="ma-import-org"
          value={orgId}
          onChange={setOrgId}
          emptyLabel={t('media.unmanaged.noCustomer')}
        />
        {orgId ? (
          <>
            <TargetAllowance orgId={orgId} providerId={provider.id} />
            <p className="text-xs text-muted">{t('media.unmanaged.policyHint')}</p>
          </>
        ) : (
          <p className="text-xs text-muted">{t('media.unmanaged.noCustomerHint')}</p>
        )}
        <div className="flex items-start justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text">{t('media.unmanaged.setPassword')}</p>
            <p className="text-xs text-muted">
              {forced ? t('media.unmanaged.setPasswordForced') : t('media.unmanaged.setPasswordHint')}
            </p>
          </div>
          <Switch
            checked={setPassword || forced}
            onCheckedChange={setSetPassword}
            disabled={forced}
            label={t('media.unmanaged.setPassword')}
          />
        </div>
      </div>
    </Dialog>
  );
}

// --- Allowance card (customer detail) ------------------------------------------------

/**
 * Streaming allowance of an organization (instance, account code, accounts, libraries,
 * streams, downloads, bitrate), on the overview tab of Admin > Customers below the cloud
 * storage allowance. Writes need platform:media:write besides the page's write mode. Renders
 * nothing while no streaming instance is connected and the organization has no allowance.
 */
export function MediaAllowanceAdminCard({
  org,
  parent,
  canWrite,
}: {
  org: AdminOrgDto;
  parent: AdminOrgDto | undefined;
  canWrite: boolean;
}) {
  const { t } = useI18n();
  const can = usePlatformCan();
  const canEdit = canWrite && can('platform:media:write');
  const providers = useMediaProviders();
  const allowance = useAdminMediaAllowance(org.id);
  const parentAllowance = useAdminMediaAllowance(parent?.id ?? '');
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [failed, setFailed] = useState<MediaPolicyApplyResult['failed']>([]);
  const remove = useDeleteAdminMediaAllowance(org.id, t('media.allowance.removed'), () => setRemoving(false));
  const data = allowance.data ?? null;
  const pool = parent ? (parentAllowance.data ?? null) : null;

  if (
    !allowance.isPending &&
    !allowance.isError &&
    !data &&
    !providers.isPending &&
    (providers.data ?? []).length === 0
  ) {
    return null;
  }

  // Like the API: only without own accounts and, for a reseller, without customer allowances.
  const removeBlocked = !data
    ? null
    : ownMediaAccounts(data) > 0
      ? t('media.allowance.removeBlocked')
      : data.customers > 0
        ? t('media.allowance.removeBlockedCustomers', { n: data.customers })
        : null;
  const beyondParent = data && pool ? mediaAccessExceeds(mediaAccessOfDto(data), mediaAccessOfDto(pool)) : [];

  return (
    <Card>
      <CardHeader
        title={t('nav.media')}
        description={t('media.admin.cardText')}
        actions={
          canEdit &&
          !allowance.isPending &&
          !allowance.isError && (
            <Button
              size="sm"
              icon={data ? <Pencil className="size-4" /> : <Plus className="size-4" />}
              onClick={() => setEditing(true)}
            >
              {data ? t('common.edit') : t('media.allowance.setUp')}
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
          <MediaAllowanceFigures allowance={data} showCode />
          {beyondParent.length > 0 && parent && (
            <Notice tone="warning">
              {t('media.allowance.beyondParent', {
                reseller: parent.name,
                list: conflictList(t, beyondParent),
              })}
            </Notice>
          )}
          {failed.length > 0 && <PolicyFailures failed={failed} onDismiss={() => setFailed([])} />}
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/admin/media?org=${org.id}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-primary-text hover:bg-surface-3"
            >
              <Users className="size-3.5" /> {t('media.admin.showAccounts')}
            </Link>
            {canEdit && (
              <Button
                size="sm"
                variant="danger-soft"
                className="ml-auto"
                icon={<Trash2 className="size-3.5" />}
                disabled={!!removeBlocked}
                title={removeBlocked ?? undefined}
                onClick={() => setRemoving(true)}
              >
                {t('media.allowance.remove')}
              </Button>
            )}
          </div>
          {canEdit && removeBlocked && <p className="text-xs text-muted">{removeBlocked}</p>}
        </CardBody>
      ) : (
        <EmptyState
          className="py-8"
          icon={<Clapperboard className="size-6" />}
          title={t('media.admin.none')}
          description={t('media.admin.noneText')}
        />
      )}
      {editing && (
        <MediaAllowanceDialog
          org={org}
          parent={parent}
          parentAllowance={pool}
          current={data}
          onClose={() => setEditing(false)}
          onFailed={setFailed}
        />
      )}
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t('media.allowance.removeTitle', { name: org.name })}
        description={t('media.allowance.removeText')}
        confirmLabel={t('media.allowance.remove')}
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
    </Card>
  );
}

function MediaAllowanceDialog({
  org,
  parent,
  parentAllowance,
  current,
  onClose,
  onFailed,
}: {
  org: AdminOrgDto;
  parent: AdminOrgDto | undefined;
  parentAllowance: MediaAllowanceDto | null;
  current: MediaAllowanceDto | null;
  onClose: () => void;
  onFailed: (failed: MediaPolicyApplyResult['failed']) => void;
}) {
  const { t, locale } = useI18n();
  const providers = useMediaProviders();
  const options = providers.data ?? [];
  const currentProvider = current?.provider?.id ?? '';
  const [providerId, setProviderId] = useState(currentProvider);
  const selected = providerId || options[0]?.id || '';
  const [code, setCode] = useState(current?.accountCode ?? '');
  const [form, setForm] = useState(() =>
    mediaAccessFormFrom(current, { maxAccounts: 5, maxStreams: 2, remoteBitrateMbit: null }),
  );
  const [enableModule, setEnableModule] = useState(true);
  const libraries = useMediaLibraries(selected);
  const save = useSetAdminMediaAllowance(
    org.id,
    (r) =>
      r.policy.applied > 0
        ? `${t('media.allowance.saved')}. ${t('media.allowance.applied', { n: r.policy.applied })}`
        : t('media.allowance.saved'),
    (r) => {
      onFailed(r.policy.failed);
      onClose();
    },
  );

  const live = libraries.data ?? [];
  const hasModule = org.modules.includes('media');
  const moduleLabel = MODULE_DEFS.media.label[locale];
  const resellerLacks = !!parent && !parent.modules.includes('media');
  // The instance can only change while nothing lives on the current one (no accounts and, for a
  // reseller, no customer allowances); the code only while the organization has no own accounts.
  const instanceLocked = !!current && (current.accounts > 0 || current.customers > 0);
  const codeLocked = !!current && ownMediaAccounts(current) > 0;
  const sameInstance = !!current && selected === currentProvider;
  // Granted libraries the instance no longer has: shown, and dropped on saving.
  const gone =
    sameInstance && libraries.isSuccess
      ? current.libraries.filter((l) => !live.some((x) => x.id === l.id))
      : [];

  const { body, errors } = readMediaAccessForm(t, form, {
    libraryIds: live.map((l) => l.id),
    minAccounts: sameInstance ? current.accounts : 0,
    maxAccounts: null,
    maxStreams: MEDIA_MAX_STREAMS,
    downloads: true,
    bitrateCap: null,
  });
  const codeValue = code.trim().toLowerCase();
  const codeError = codeValue && !isMediaAccountCode(codeValue) ? t('media.allowance.codeInvalid') : null;
  const sendCode = codeValue !== '' && codeValue !== current?.accountCode;
  const outside = useMemo(
    () =>
      parentAllowance
        ? new Set(live.filter((l) => !parentAllowance.libraries.some((p) => p.id === l.id)).map((l) => l.id))
        : undefined,
    [live, parentAllowance],
  );
  const beyond =
    body && parentAllowance
      ? mediaAccessExceeds(
          {
            libraryIds: body.libraryIds,
            maxStreams: body.maxStreams,
            downloads: body.downloads,
            remoteBitrateMbit: body.remoteBitrateMbit,
          },
          mediaAccessOfDto(parentAllowance),
        )
      : [];
  const blocked =
    !selected || !body || !!codeError || libraries.isPending || (!hasModule && enableModule && resellerLacks);

  const pickInstance = (next: string) => {
    setProviderId(next);
    // Library ids belong to one instance: back on the current one its libraries are granted again.
    setForm((f) => ({
      ...f,
      libraryIds: current && next === currentProvider ? current.libraries.map((l) => l.id) : [],
    }));
  };

  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onClose()}
      title={
        current
          ? t('media.allowance.editTitle', { name: org.name })
          : t('media.allowance.setUpTitle', { name: org.name })
      }
      description={t('media.allowance.dialogText')}
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
              body &&
              save.mutate({
                providerId: selected,
                ...(sendCode ? { accountCode: codeValue } : {}),
                ...body,
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
            {t('media.admin.noInstance')}{' '}
            <Link to="/admin/providers" className="font-medium underline underline-offset-2">
              {t('hosting.admin.toProviders')}
            </Link>
          </Notice>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('media.instance')}
              htmlFor="mal-provider"
              hint={instanceLocked ? t('media.allowance.instanceLocked') : t('media.allowance.instanceHint')}
            >
              <Select
                id="mal-provider"
                value={selected}
                onChange={(e) => pickInstance(e.target.value)}
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
            <Field
              label={t('media.allowance.code')}
              htmlFor="mal-code"
              error={codeError}
              hint={codeLocked ? t('media.allowance.codeLocked') : t('media.allowance.codeHint')}
            >
              <Input
                id="mal-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toLowerCase().replace(/\s+/g, ''))}
                placeholder={t('media.allowance.codeGenerated')}
                disabled={codeLocked}
                maxLength={12}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                className="font-mono"
              />
            </Field>
          </div>
        )}

        {selected && (
          <MediaAccessFields
            id="mal"
            form={form}
            onChange={setForm}
            errors={errors}
            limits={{
              libraryIds: live.map((l) => l.id),
              minAccounts: sameInstance ? current.accounts : 0,
              maxAccounts: null,
              maxStreams: MEDIA_MAX_STREAMS,
              downloads: true,
              bitrateCap: null,
            }}
            libraries={live}
            librariesPending={libraries.isPending}
            librariesError={libraries.isError ? libraries.error : null}
            onRetryLibraries={() => void libraries.refetch()}
            outside={outside}
            gone={gone}
            accountsHint={
              current && current.accounts > 0
                ? t('media.allowance.accountsUsed', { n: current.accounts })
                : t('media.allowance.maxAccountsHint')
            }
          />
        )}

        {parent && !parentAllowance && (
          <Notice tone="info">{t('media.allowance.parentNone', { reseller: parent.name })}</Notice>
        )}
        {parent && beyond.length > 0 && (
          <Notice tone="warning">
            {t('media.allowance.beyondParent', { reseller: parent.name, list: conflictList(t, beyond) })}
          </Notice>
        )}

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
                  {t('media.allowance.enableModuleHint', { org: org.name })}
                </span>
              </span>
            </label>
            {enableModule && resellerLacks && parent && (
              <Notice tone="warning">
                {t('hosting.admin.resellerLacks', { reseller: parent.name, module: moduleLabel })}
              </Notice>
            )}
            {!enableModule && (
              <Notice tone="info">{t('media.allowance.moduleOff', { module: moduleLabel })}</Notice>
            )}
          </>
        )}
        {org.kind === 'reseller' && <Notice tone="info">{t('media.allowance.resellerHint')}</Notice>}
        <p className="text-xs text-muted">{t('media.allowance.policyHint')}</p>
      </div>
    </Dialog>
  );
}
