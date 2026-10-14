import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, CloudDownload, Eraser, Globe, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  CREATABLE_WEBSITE_TYPES,
  MODULE_DEFS,
  NODEJS_VERSIONS,
  type AdminOrgDto,
  type CreatableWebsiteType,
  type Permission,
  type ProviderConnectionDto,
  type UnmanagedWebsiteDto,
  type WebsiteAllowanceDto,
  type WebsiteServerOptions,
  type WebspaceDto,
} from '@weblion/shared';
import { errorMessage } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { useI18n, type TFunction } from '@/lib/i18n';
import { useAdminOrgs, useAdminProviders, useMe } from '@/lib/queries';
import {
  useAdminCreateWebsite,
  useAdminWebsiteAllowance,
  useAdminWebsiteOptions,
  useAdminWebsites,
  useAdoptWebsite,
  useDeleteAdminWebsiteAllowance,
  useSetAdminWebsiteAllowance,
  useUnmanagedWebsites,
} from '@/lib/api/websites';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
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
  Select,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ProviderBadge } from '@/components/server-bits';
import {
  ALLOWANCE_MAX_DATABASES,
  ALLOWANCE_MAX_SITES,
  CopyValue,
  InstanceLocation,
  SiteTypeChoice,
  WebsiteAllowanceFigures,
  WebsiteStatusBadges,
  outcomeUnknown,
  ownWebsiteUsage,
  parseCount,
} from '@/pages/hosting/website-bits';
import {
  CreatingNotice,
  CredentialsFooter,
  CredentialsPanel,
  DialogError,
  ForgetWebsiteDialog,
  WebsiteFormFields,
  formFieldOf,
  shownFromCreated,
  useSubmitError,
  useWebsiteForm,
  type ShownCredentials,
  type WebsiteFormChoices,
} from '@/pages/hosting/website-dialogs';

/**
 * Websites in the admin area: the panel on the web space tab (create for a customer, sites
 * the console does not manage, clean-up) and the website allowance of a customer.
 */

/** Connections that have websites (CloudPanel servers, and the opt-in demo CloudPanel). */
export const isWebsiteProvider = (p: Pick<ProviderConnectionDto, 'type' | 'summary'>) =>
  p.type === 'cloudpanel' || (p.type === 'demo' && p.summary?.flavor === 'cloudpanel');

const useWebsiteProviders = () => {
  const providers = useAdminProviders();
  return { ...providers, data: providers.data?.filter(isWebsiteProvider) };
};

function usePlatformCan() {
  const me = useMe();
  const perms = me.data?.platformPermissions ?? [];
  return (permission: Permission) => perms.includes(permission);
}

/** Node.js sites are allowed on the instance (connection config; the server must allow them too). */
const nodejsAllowed = (p: Pick<ProviderConnectionDto, 'summary'> | undefined) =>
  p?.summary?.nodejs === 'true';

const splitList = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** "8.4" before "8.3" before "7.4". */
const newestFirst = (a: string, b: string) => {
  const [aMajor = 0, aMinor = 0] = a.split('.').map(Number);
  const [bMajor = 0, bMinor = 0] = b.split('.').map(Number);
  return bMajor - aMajor || bMinor - aMinor;
};

/** What staff can choose on an instance, as the server answers (every application and type it has). */
export const serverStaffChoices = (options: WebsiteServerOptions): WebsiteFormChoices => ({
  types: options.types,
  phpVersions: options.phpVersions,
  defaultPhpVersion: options.defaultPhpVersion,
  templates: options.templates.map((tpl) => tpl.name),
  nodejsVersions: options.nodejsVersions,
  room: null,
});

/**
 * Fallback while the server cannot be asked: the connection config (defaults as on the server
 * side) and any template typed as text; the server checks every value again.
 */
export function staffChoices(p: Pick<ProviderConnectionDto, 'summary'>): WebsiteFormChoices {
  const php = splitList(p.summary.phpVersions);
  const phpVersions = (php.length > 0 ? php : ['8.3', '8.4']).sort(newestFirst);
  const templates = splitList(p.summary.templates).filter((name) => !name.endsWith('*'));
  return {
    types: nodejsAllowed(p) ? CREATABLE_WEBSITE_TYPES : ['php', 'static'],
    phpVersions,
    defaultPhpVersion: phpVersions[0] ?? null,
    templates: null,
    templateSuggestions: templates.length > 0 ? templates : ['Generic', 'WordPress', 'WooCommerce'],
    nodejsVersions: NODEJS_VERSIONS.filter((v) => Number(v) >= 20).reverse(),
    room: null,
  };
}

// --- Panel on the web space tab --------------------------------------------------------

/**
 * Websites part of the web space tab in Admin > Domains & Webspaces: create for a customer,
 * unmanaged sites of the server, adoption, clean-up of unassigned and missing websites.
 * `providerId` is the tab's provider filter (undefined: all website instances).
 */
export function AdminWebsitesPanel({ providerId }: { providerId?: string }) {
  const { t } = useI18n();
  const can = usePlatformCan();
  const providers = useWebsiteProviders();
  const all = providers.data ?? [];
  const scoped = providerId ? all.filter((p) => p.id === providerId) : all;
  // The dialog keeps the instances it was opened with, whatever the filter does meanwhile.
  const [creating, setCreating] = useState<ProviderConnectionDto[] | null>(null);
  const [forgetting, setForgetting] = useState<WebspaceDto | null>(null);
  const websites = useAdminWebsites({ providerId }, scoped.length > 0);
  const canWrite = can('platform:website:write');

  const list = websites.data ?? [];
  const cleanUp = list.filter((w) => !w.org || w.missingSince);
  const unassigned = list.filter((w) => !w.org).length;
  const missing = list.filter((w) => w.missingSince).length;

  return (
    <>
      {scoped.length > 0 && (
        <div className="mb-6 space-y-6">
          <Card>
            <CardHeader
              title={
                <span className="inline-flex items-center gap-2">
                  <Globe className="size-4 text-muted" aria-hidden />
                  {t('websites.admin.title')}
                </span>
              }
              description={t('websites.admin.text')}
              actions={
                canWrite && (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Plus className="size-4" />}
                    onClick={() => setCreating(scoped)}
                  >
                    {t('websites.list.create')}
                  </Button>
                )
              }
            />
            {websites.isError ? (
              <div className="p-5">
                <ErrorState error={websites.error} onRetry={() => void websites.refetch()} />
              </div>
            ) : websites.isPending ? (
              <LoadingBlock rows={1} />
            ) : (
              <>
                <CardBody className="text-sm text-muted">
                  {t('websites.admin.counts', { n: list.length, unassigned, missing })}
                </CardBody>
                {cleanUp.length > 0 && (
                  <Table>
                    <THead>
                      <tr>
                        <TH>{t('websites.admin.website')}</TH>
                        <TH className="hidden md:table-cell">{t('websites.admin.instance')}</TH>
                        <TH>{t('websites.admin.state')}</TH>
                        {canWrite && <TH />}
                      </tr>
                    </THead>
                    <TBody>
                      {cleanUp.map((w) => (
                        <TR key={w.id}>
                          <TD>
                            <div className="truncate font-medium text-text">{w.name}</div>
                            {w.org && <div className="truncate text-xs text-muted">{w.org.name}</div>}
                          </TD>
                          <TD className="hidden md:table-cell">
                            <span className="inline-flex items-center gap-2 text-sm">
                              <ProviderBadge type={w.provider.type} name={w.provider.name} />
                              {w.provider.name}
                            </span>
                          </TD>
                          <TD>
                            <span className="flex flex-wrap gap-1">
                              {!w.org && <Badge tone="warning">{t('hosting.admin.unassigned')}</Badge>}
                              <WebsiteStatusBadges website={w} />
                            </span>
                          </TD>
                          {canWrite && (
                            <TD className="text-right">
                              <Button
                                size="sm"
                                variant="ghost"
                                icon={<Eraser className="size-3.5" />}
                                onClick={() => setForgetting(w)}
                              >
                                {t('websites.admin.forget')}
                              </Button>
                            </TD>
                          )}
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </>
            )}
          </Card>
          {can('platform:provider:read') && (
            <UnmanagedSites key={providerId ?? 'all'} providers={scoped} canAdopt={canWrite} />
          )}
        </div>
      )}
      {creating && creating.length > 0 && (
        <AdminCreateWebsiteDialog providers={creating} onClose={() => setCreating(null)} />
      )}
      {forgetting && <ForgetWebsiteDialog website={forgetting} onClose={() => setForgetting(null)} />}
    </>
  );
}

/** Staff create on any website instance, for any organization or unassigned, without allowance. */
function AdminCreateWebsiteDialog({
  providers,
  onClose,
}: {
  providers: ProviderConnectionDto[];
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const orgs = useAdminOrgs();
  const [providerId, setProviderId] = useState(providers[0]!.id);
  const [orgId, setOrgId] = useState('');
  const provider = providers.find((p) => p.id === providerId) ?? providers[0]!;
  const serverOptions = useAdminWebsiteOptions(provider.id);
  const choices = useMemo(
    () => (serverOptions.data ? serverStaffChoices(serverOptions.data) : staffChoices(provider)),
    [serverOptions.data, provider],
  );
  const form = useWebsiteForm(choices);
  const [shown, setShown] = useState<ShownCredentials | null>(null);
  const [saved, setSaved] = useState(false);
  const create = useAdminCreateWebsite({
    success: (r) => t('websites.create.done', { domain: r.website.name }),
    onSuccess: (r) => setShown(shownFromCreated(r)),
    error: false,
  });
  const org = orgs.data?.find((o) => o.id === orgId);
  const moduleLabel = MODULE_DEFS.webhosting.label[locale];
  const request = form.request ? { ...form.request, providerId: provider.id, orgId: orgId || null } : null;
  const submitted = useSubmitError(create.error);
  const serverError = submitted.errorFor(request);
  const generalError = serverError && !formFieldOf(serverError) ? serverError : null;

  if (shown) {
    return (
      <Dialog
        open
        onOpenChange={(o) => !o && saved && onClose()}
        title={t('websites.creds.title')}
        description={t('websites.creds.text')}
        size="lg"
        footer={<CredentialsFooter saved={saved} onSaved={setSaved} onClose={onClose} />}
      >
        <CredentialsPanel shown={shown} />
      </Dialog>
    );
  }

  const submit = () => {
    if (!request || create.isPending || serverOptions.isPending || outcomeUnknown(create.error)) return;
    submitted.sent(request);
    create.mutate(request);
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !create.isPending && onClose()}
      title={t('websites.admin.createTitle')}
      description={t('websites.admin.createText')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" disabled={create.isPending} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!request || serverOptions.isPending || outcomeUnknown(create.error)}
            loading={create.isPending}
            onClick={submit}
          >
            {t('websites.create.submit')}
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('websites.admin.instance')} htmlFor="aw-provider">
            <Select
              id="aw-provider"
              value={provider.id}
              onChange={(e) => setProviderId(e.target.value)}
              disabled={create.isPending || providers.length === 1}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.location.label}
                  {p.enabled ? '' : ` (${t('providers.disabledBadge')})`}
                </option>
              ))}
            </Select>
          </Field>
          <WebsiteOrgSelect id="aw-org" value={orgId} onChange={setOrgId} disabled={create.isPending} />
        </div>
        {org && !org.modules.includes('webhosting') && (
          <Notice tone="info">
            {t('websites.admin.enablesModule', { org: org.name, module: moduleLabel })}
          </Notice>
        )}
        <Notice tone="info">{t('websites.admin.noAllowanceCheck')}</Notice>
        {serverOptions.isError && (
          <Notice tone="warning" title={t('websites.admin.optionsError')}>
            <span className="block break-words">{errorMessage(serverOptions.error)}</span>
          </Notice>
        )}
        {serverOptions.isPending ? (
          <LoadingBlock />
        ) : (
          <WebsiteFormFields
            form={form}
            choices={choices}
            serverError={serverError}
            disabled={create.isPending}
          />
        )}
        {create.isPending ? (
          <CreatingNotice />
        ) : (
          <DialogError error={generalError} unknownHint={t('websites.admin.unknownHint')} />
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function orgLabel(t: TFunction, org: AdminOrgDto): string {
  const parts = [org.name];
  if (org.kind === 'reseller') parts.push(t('hosting.admin.kindReseller'));
  if (org.kind === 'internal') parts.push(t('hosting.admin.kindInternal'));
  if (org.status === 'suspended') parts.push(t('hosting.admin.suspended'));
  return parts.join(' · ');
}

/** Organizations without a reseller first, then one group per reseller; empty = unassigned. */
function WebsiteOrgSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (orgId: string) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const orgs = useAdminOrgs();
  const all = orgs.data ?? [];
  const groups = useMemo(() => {
    const direct = all.filter((o) => !o.parent);
    const below = new Map<string, { name: string; orgs: AdminOrgDto[] }>();
    for (const o of all) {
      if (!o.parent) continue;
      const group = below.get(o.parent.id) ?? { name: o.parent.name, orgs: [] };
      group.orgs.push(o);
      below.set(o.parent.id, group);
    }
    return { direct, below: [...below.values()] };
  }, [all]);

  if (orgs.isError) return <ErrorState error={orgs.error} onRetry={() => void orgs.refetch()} />;
  return (
    <Field label={t('hosting.col.customer')} htmlFor={id} hint={t('websites.admin.orgHint')}>
      <Select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || orgs.isPending}
      >
        <option value="">{t('hosting.admin.unassigned')}</option>
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
  );
}

// --- Unmanaged sites -------------------------------------------------------------------

/**
 * Sites on a CloudPanel server the console does not manage, read live when opened. Protected
 * sites (the console's own, operator sites) can never be adopted. Without remote adoption
 * (the default) root adopts on the server and the next sync brings the website in.
 */
function UnmanagedSites({ providers, canAdopt }: { providers: ProviderConnectionDto[]; canAdopt: boolean }) {
  const { t } = useI18n();
  const [providerId, setProviderId] = useState(providers[0]!.id);
  const [open, setOpen] = useState(false);
  const [adopting, setAdopting] = useState<UnmanagedWebsiteDto | null>(null);
  const provider = providers.find((p) => p.id === providerId) ?? providers[0]!;
  const sites = useUnmanagedWebsites(provider.id, open);
  const adopt = useAdoptWebsite(provider.id, {
    success: (w) => t('websites.admin.adopted', { domain: w.name }),
    onSuccess: () => setAdopting(null),
  });
  const data = sites.data;

  return (
    <Card>
      <CardHeader
        title={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-left hover:underline"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
          >
            {open ? (
              <ChevronDown className="size-4" aria-hidden />
            ) : (
              <ChevronRight className="size-4" aria-hidden />
            )}
            {t('websites.admin.unmanagedTitle', { instance: provider.name })}
          </button>
        }
        description={t('websites.admin.unmanagedText')}
        actions={
          <>
            {providers.length > 1 && (
              <Select
                value={provider.id}
                onChange={(e) => setProviderId(e.target.value)}
                className="h-8 w-auto"
                aria-label={t('websites.admin.instance')}
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
              loading={open && sites.isFetching}
              onClick={() => (open ? void sites.refetch() : setOpen(true))}
            >
              {open ? t('websites.admin.unmanagedReload') : t('websites.admin.unmanagedLoad')}
            </Button>
          </>
        }
      />
      {!open ? null : sites.isError ? (
        <div className="p-5">
          <ErrorState error={sites.error} onRetry={() => void sites.refetch()} />
        </div>
      ) : sites.isPending || !data ? (
        <LoadingBlock rows={2} />
      ) : data.sites.length === 0 ? (
        <EmptyState
          className="py-8"
          title={t('websites.admin.unmanagedEmpty', { instance: provider.name })}
        />
      ) : (
        <>
          <Table>
            <THead>
              <tr>
                <TH>{t('websites.admin.website')}</TH>
                <TH className="hidden sm:table-cell">{t('websites.runtime.type')}</TH>
                <TH className="hidden md:table-cell">{t('websites.access.username')}</TH>
                <TH>{t('websites.admin.adoptCol')}</TH>
              </tr>
            </THead>
            <TBody>
              {data.sites.map((site) => (
                <TR key={site.domain}>
                  <TD>
                    <Mono className="font-medium text-text">{site.domain}</Mono>
                    {site.protected && (
                      <Badge tone="danger" className="ml-2">
                        {t('websites.admin.protected')}
                      </Badge>
                    )}
                  </TD>
                  <TD className="hidden sm:table-cell">{t(`websites.type.${site.type}`)}</TD>
                  <TD className="hidden md:table-cell">
                    <Mono>{site.siteUser}</Mono>
                  </TD>
                  <TD>
                    {site.protected ? (
                      <span className="text-sm text-muted">{t('websites.admin.protectedHint')}</span>
                    ) : data.allowRemoteAdopt && canAdopt ? (
                      <Button size="sm" onClick={() => setAdopting(site)}>
                        {t('websites.admin.adopt')}
                      </Button>
                    ) : (
                      <CopyValue value={`sudo weblion-clp adopt ${site.domain}`} />
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <CardBody className="border-t border-border text-xs text-muted">
            {data.allowRemoteAdopt
              ? t('websites.admin.adoptRemoteHint')
              : t('websites.admin.adoptServerHint')}
          </CardBody>
        </>
      )}
      <ConfirmDialog
        open={!!adopting}
        onOpenChange={(o) => !o && !adopt.isPending && setAdopting(null)}
        title={t('websites.admin.adoptTitle', { domain: adopting?.domain ?? '' })}
        description={t('websites.admin.adoptText')}
        confirmLabel={t('websites.admin.adopt')}
        danger={false}
        loading={adopt.isPending}
        onConfirm={() => adopting && adopt.mutate({ domain: adopting.domain })}
      />
    </Card>
  );
}

// --- Allowance card (customer detail) ------------------------------------------------

/**
 * Website allowance of an organization: instance, maximum websites and databases, site
 * types. `parent` is the reseller (if any): the customer's allowance comes out of the
 * reseller's, on the reseller's instance.
 */
export function WebsiteAllowanceAdminCard({
  org,
  parent,
  canWrite,
}: {
  org: AdminOrgDto;
  parent: AdminOrgDto | undefined;
  canWrite: boolean;
}) {
  const { t } = useI18n();
  const allowance = useAdminWebsiteAllowance(org.id);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const remove = useDeleteAdminWebsiteAllowance(org.id, {
    success: t('websites.allowance.removed'),
    onSuccess: () => setRemoving(false),
  });
  const data = allowance.data ?? null;
  // Like the API: only without websites and, for a reseller, without customer allowances.
  const removeBlocked = !data
    ? null
    : data.customers > 0
      ? t('websites.allowance.removeBlockedCustomers', { n: data.customers })
      : data.sites > 0
        ? t('websites.allowance.removeBlocked', { n: data.sites })
        : null;

  return (
    <Card>
      <CardHeader
        title={t('websites.allowance.title')}
        description={t('websites.allowance.adminText')}
        actions={
          canWrite &&
          !allowance.isPending &&
          !allowance.isError && (
            <Button
              size="sm"
              icon={data ? <Pencil className="size-4" /> : <Plus className="size-4" />}
              onClick={() => setEditing(true)}
            >
              {data ? t('common.edit') : t('websites.allowance.setUp')}
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
          <WebsiteAllowanceFigures allowance={data} />
          <div className="flex flex-wrap items-center gap-2">
            {data.provider && (
              <Link
                to={`/admin/hosting?tab=webspaces&provider=${data.provider.id}`}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-primary-text hover:bg-surface-3"
              >
                <Globe className="size-3.5" /> {t('websites.allowance.showWebsites')}
              </Link>
            )}
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
                {t('websites.allowance.remove')}
              </Button>
            )}
          </div>
          {canWrite && removeBlocked && <p className="text-xs text-muted">{removeBlocked}</p>}
        </CardBody>
      ) : (
        <EmptyState
          className="py-8"
          icon={<Globe className="size-6" />}
          title={t('websites.allowance.none')}
          description={t('websites.allowance.noneText')}
        />
      )}
      {editing && (
        <AdminWebsiteAllowanceDialog
          org={org}
          parent={parent}
          current={data}
          onClose={() => setEditing(false)}
        />
      )}
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t('websites.allowance.removeTitle', { name: org.name })}
        description={t('websites.allowance.removeText')}
        confirmLabel={t('websites.allowance.remove')}
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
    </Card>
  );
}

function AdminWebsiteAllowanceDialog({
  org,
  parent,
  current,
  onClose,
}: {
  org: AdminOrgDto;
  parent: AdminOrgDto | undefined;
  current: WebsiteAllowanceDto | null;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const providers = useWebsiteProviders();
  const resellerAllowance = useAdminWebsiteAllowance(parent?.id ?? '', !!parent);
  const pool = parent ? (resellerAllowance.data ?? null) : null;
  const [providerId, setProviderId] = useState(current?.provider?.id ?? '');
  const [maxSites, setMaxSites] = useState(String(current?.maxSites ?? 3));
  const [maxDatabases, setMaxDatabases] = useState(String(current?.maxDatabases ?? 5));
  const [types, setTypes] = useState<CreatableWebsiteType[]>(current?.siteTypes ?? ['php', 'static']);
  const [enableModule, setEnableModule] = useState(true);
  const save = useSetAdminWebsiteAllowance(org.id, {
    success: t('websites.allowance.saved'),
    onSuccess: onClose,
    error: false,
  });

  const options = providers.data ?? [];
  // A reseller's customer gets its websites on the reseller's instance.
  const selected = pool?.provider?.id ?? (providerId || options[0]?.id || '');
  const instance = options.find((p) => p.id === selected);
  const instanceLocked = !!pool || (!!current && current.customers > 0);
  const hasModule = org.modules.includes('webhosting');
  const moduleLabel = MODULE_DEFS.webhosting.label[locale];
  const resellerLacks = !!parent && !parent.modules.includes('webhosting');
  const n = (value: number) => formatNumber(value, locale);

  // Committed already: own websites and databases, plus a reseller's customer maxima. Without
  // an allowance the API reports no counts, but the organization's websites count all the same.
  const existing = useAdminWebsites({ orgId: org.id }, !current);
  const own = ownWebsiteUsage(existing.data ?? []);
  const minSites = current?.sites ?? own.sites;
  const minDatabases = current?.databases ?? own.databases;
  // What the reseller has left for this customer (its current maxima are part of the commitment).
  const maxSitesLeft = pool ? pool.maxSites - pool.sites + (current?.maxSites ?? 0) : ALLOWANCE_MAX_SITES;
  const maxDatabasesLeft = pool
    ? pool.maxDatabases - pool.databases + (current?.maxDatabases ?? 0)
    : ALLOWANCE_MAX_DATABASES;
  const sites = parseCount(maxSites, ALLOWANCE_MAX_SITES);
  const databases = parseCount(maxDatabases, ALLOWANCE_MAX_DATABASES);
  const sitesError =
    sites === null
      ? t('websites.allowance.countInvalid')
      : sites < minSites
        ? t('websites.allowance.belowSites', { n: n(minSites) })
        : sites > maxSitesLeft
          ? t('websites.allowance.poolSites', { n: n(Math.max(0, maxSitesLeft)) })
          : null;
  const databasesError =
    databases === null
      ? t('websites.allowance.countInvalid')
      : databases < minDatabases
        ? t('websites.allowance.belowDatabases', { n: n(minDatabases) })
        : databases > maxDatabasesLeft
          ? t('websites.allowance.poolDatabases', { n: n(Math.max(0, maxDatabasesLeft)) })
          : null;

  const disabledTypes: Partial<Record<CreatableWebsiteType, string>> = {};
  for (const type of CREATABLE_WEBSITE_TYPES) {
    if (pool && !pool.siteTypes.includes(type)) {
      disabledTypes[type] = t('websites.allowance.notInPool', { reseller: parent?.name ?? '' });
    } else if (type === 'nodejs' && !nodejsAllowed(instance)) {
      disabledTypes[type] = t('websites.allowance.nodejsOff');
    }
  }
  const typesError = types.length === 0 ? t('websites.allowance.typesRequired') : null;
  const blocked =
    !selected ||
    (!current && existing.isPending) ||
    sites === null ||
    databases === null ||
    !!sitesError ||
    !!databasesError ||
    !!typesError ||
    (!!parent && !pool) ||
    (!hasModule && enableModule && resellerLacks);

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !save.isPending && onClose()}
      title={
        current
          ? t('websites.allowance.editTitle', { name: org.name })
          : t('websites.allowance.setUpTitle', { name: org.name })
      }
      description={t('websites.allowance.dialogText')}
      footer={
        <>
          <Button variant="ghost" disabled={save.isPending} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={blocked}
            loading={save.isPending}
            onClick={() =>
              sites !== null &&
              databases !== null &&
              save.mutate({
                providerId: selected,
                maxSites: sites,
                maxDatabases: databases,
                siteTypes: CREATABLE_WEBSITE_TYPES.filter((type) => types.includes(type)),
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
        {parent && resellerAllowance.isPending ? (
          <LoadingBlock rows={1} />
        ) : parent && !pool ? (
          <Notice tone="warning">{t('websites.allowance.resellerNone', { reseller: parent.name })}</Notice>
        ) : providers.isError ? (
          <ErrorState error={providers.error} onRetry={() => void providers.refetch()} />
        ) : options.length === 0 && !providers.isPending ? (
          <Notice tone="warning">
            {t('websites.allowance.noInstance')}{' '}
            <Link to="/admin/providers" className="font-medium underline underline-offset-2">
              {t('hosting.admin.toProviders')}
            </Link>
          </Notice>
        ) : (
          <Field
            label={t('websites.admin.instance')}
            htmlFor="wa-provider"
            hint={
              pool
                ? t('websites.allowance.instanceReseller', { reseller: parent?.name ?? '' })
                : instanceLocked
                  ? t('websites.allowance.instanceLocked')
                  : t('websites.allowance.instanceHint')
            }
          >
            <Select
              id="wa-provider"
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
            label={t('websites.allowance.maxSites')}
            htmlFor="wa-sites"
            error={sitesError}
            hint={
              pool
                ? t('websites.allowance.poolLeft', { n: n(Math.max(0, maxSitesLeft)) })
                : minSites > 0
                  ? t('websites.allowance.committed', { n: n(minSites) })
                  : undefined
            }
          >
            <Input
              id="wa-sites"
              type="number"
              inputMode="numeric"
              min={minSites}
              step={1}
              value={maxSites}
              onChange={(e) => setMaxSites(e.target.value)}
              className="tabular"
            />
          </Field>
          <Field
            label={t('websites.allowance.maxDatabases')}
            htmlFor="wa-dbs"
            error={databasesError}
            hint={
              pool
                ? t('websites.allowance.poolLeft', { n: n(Math.max(0, maxDatabasesLeft)) })
                : minDatabases > 0
                  ? t('websites.allowance.committed', { n: n(minDatabases) })
                  : undefined
            }
          >
            <Input
              id="wa-dbs"
              type="number"
              inputMode="numeric"
              min={minDatabases}
              step={1}
              value={maxDatabases}
              onChange={(e) => setMaxDatabases(e.target.value)}
              className="tabular"
            />
          </Field>
        </div>
        <div>
          <SiteTypeChoice
            value={types}
            onChange={setTypes}
            offered={CREATABLE_WEBSITE_TYPES}
            disabled={disabledTypes}
          />
          {typesError && <p className="mt-1.5 text-xs text-danger">{typesError}</p>}
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
                  {t('websites.allowance.enableModuleHint', { org: org.name })}
                </span>
              </span>
            </label>
            {enableModule && resellerLacks && parent && (
              <Notice tone="warning">
                {t('hosting.admin.resellerLacks', { reseller: parent.name, module: moduleLabel })}
              </Notice>
            )}
            {!enableModule && (
              <Notice tone="info">{t('websites.allowance.moduleOff', { module: moduleLabel })}</Notice>
            )}
          </>
        )}
        {org.kind === 'reseller' && <Notice tone="info">{t('websites.allowance.resellerHint')}</Notice>}
        <DialogError error={save.error} />
        {current?.provider && selected !== current.provider.id && current.sites > 0 && (
          <p className="text-xs text-muted">
            {t('websites.allowance.instanceChange', { instance: current.provider.name })}
          </p>
        )}
        {instance && <InstanceLine provider={instance} />}
      </div>
    </Dialog>
  );
}

function InstanceLine({ provider }: { provider: ProviderConnectionDto }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border pt-3 text-sm text-muted">
      <span>{t('websites.admin.instance')}:</span>
      <span className="font-medium text-text">{provider.name}</span>
      <InstanceLocation location={provider.location} />
      <span>
        {nodejsAllowed(provider) ? t('websites.allowance.nodejsOn') : t('websites.allowance.nodejsOffShort')}
      </span>
    </div>
  );
}
